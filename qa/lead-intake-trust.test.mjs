#!/usr/bin/env node
// FINMENTOR — Lead Intake trust boundary and dedup regression gate.
//
// Runs the real n8n Code-node sources from n8n/src/lead-intake/ against the INDP1-02
// scenarios. Assertion-based, non-zero exit on failure, paths resolved from this file.
//
// The defect: a caller-supplied lead_id became the canonical identity and selected which
// existing Pipeline row a submission merged into, so a public request that named a known
// lead_id could steer itself into another lead's CRM row.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'n8n', 'src', 'lead-intake');

const load = (f) => readFileSync(join(SRC, f), 'utf8');
const normalizeSrc = load('normalize-score-lead.js');
const dedupSrc = load('dedup-guard.js');
const mergeSrc = load('build-merge-update.js');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// ---------------------------------------------------------------- harness
const item = (json) => ({ first: () => ({ json }), all: () => [{ json }] });
const items = (arr) => ({ first: () => ({ json: arr[0] }), all: () => arr.map((json) => ({ json })) });

// internalRoute models the authenticated internal entry node actually having run. On the
// public path the node is absent from the map, so `$()` throws inside the source exactly as
// it does in n8n — which is the fail-closed behaviour under test.
function runNormalize({ payload, headers = {}, settings = {}, internalRoute = false }) {
  const named = {
    'Validate Payload': item({ payload }),
    'Settings to Object': item({ settings }),
    'Webhook': item({ headers })
  };
  if (internalRoute) named['Internal Auth Entry'] = item({ __internal_route: true });
  const fn = new Function('$input', '$', '$now', normalizeSrc);
  const out = fn(item({ payload }), (n) => named[n], new Date().toISOString());
  return out[0].json ? out[0].json : out[0];
}

function runMerge({ lead, settings = {} }) {
  const named = { 'Settings to Object': item({ settings }) };
  const fn = new Function('$input', '$', mergeSrc);
  const out = fn(item(lead), (n) => named[n]);
  return out[0].json ? out[0].json : out[0];
}

function runDedup({ lead, rows }) {
  const named = { 'Normalize + Score Lead': item(lead) };
  const fn = new Function('$input', '$', dedupSrc);
  const out = fn(items(rows.length ? rows : [{}]), (n) => named[n]);
  return out[0].json ? out[0].json : out[0];
}

const VICTIM_ROW = {
  lead_id: 'FIN-1755000000000-111',
  company: 'Victim Holding',
  name: 'Victim Owner',
  email: 'victim@example.com',
  phone: '+37360000001',
  telegram: '@victimowner',
  deal_stage: 'Qualified',
  priority: 'WARM',
  financial_zone: 'YELLOW',
  created_at: new Date(Date.now() - 5 * 3600e3).toISOString(),
  updated_at: new Date(Date.now() - 5 * 3600e3).toISOString()
};

const basePayload = (over = {}) => Object.assign({
  tool: 'contact',
  lead: { name: 'Attacker', contact: 'attacker@example.com', company: 'Attacker Ltd', email: 'attacker@example.com' },
  answers: { business: 'x' },
  signals: {},
  meta: { consent: true, request_id: 'fmr_test_1' }
}, over);

console.log('\nFINMENTOR Lead Intake trust boundary\n');
console.log('CALLER lead_id IS NOT AN IDENTITY OR A SELECTION CAPABILITY');

check('a caller-supplied lead_id does not become the canonical lead_id', () => {
  const n = runNormalize({ payload: basePayload({ lead_id: VICTIM_ROW.lead_id }) });
  assert(n.lead_id !== VICTIM_ROW.lead_id, 'caller lead_id was adopted as canonical identity');
  assert(/^FIN-\d+-\d+$/.test(n.lead_id), 'canonical lead_id is not server-minted: ' + n.lead_id);
  assert(n.submission_lead_id === VICTIM_ROW.lead_id, 'caller value not retained for correlation');
  assert(n.provenance_trusted === false, 'untrusted caller marked as trusted');
});

check('a caller-supplied lead_id cannot select the victim row', () => {
  const n = runNormalize({ payload: basePayload({ lead_id: VICTIM_ROW.lead_id }) });
  const d = runDedup({ lead: n, rows: [VICTIM_ROW] });
  assert(d.existing_lead_id !== VICTIM_ROW.lead_id, 'attacker selected the victim row');
  assert(d.dedup_mode === 'new', 'expected a new lead, got ' + d.dedup_mode);
});

check('a forged internal key header is rejected', () => {
  const n = runNormalize({
    payload: basePayload({ lead_id: VICTIM_ROW.lead_id }),
    headers: { 'x-finmentor-internal-key': 'guessed-value' },
    settings: { internal_intake_key: 'the-real-key' }
  });
  assert(n.provenance_trusted === false, 'wrong key was trusted');
  assert(n.lead_id !== VICTIM_ROW.lead_id, 'wrong key still adopted caller identity');
});

check('an unconfigured internal key trusts nobody, even with a header present', () => {
  const n = runNormalize({
    payload: basePayload({ lead_id: VICTIM_ROW.lead_id }),
    headers: { 'x-finmentor-internal-key': '' },
    settings: { internal_intake_key: '' }
  });
  assert(n.provenance_trusted === false, 'empty key matched empty header');
  assert(n.lead_id !== VICTIM_ROW.lead_id, 'empty key adopted caller identity');
});

check('an empty presented key never matches a configured key', () => {
  const n = runNormalize({
    payload: basePayload({ lead_id: VICTIM_ROW.lead_id }),
    headers: {},
    settings: { internal_intake_key: 'the-real-key' }
  });
  assert(n.provenance_trusted === false, 'missing header was trusted');
});

console.log('\nPROVEN PROVENANCE STILL WORKS (Telegram Concierge path)');

check('the authenticated internal route restores strong lead_id identity', () => {
  // Was a shared key read from the Settings sheet; that is retired (schema doc section 5).
  const n = runNormalize({
    payload: basePayload({ lead_id: 'TG-12345-1755000000000', tool: 'telegram_client_concierge' }),
    internalRoute: true
  });
  assert(n.provenance_trusted === true, 'authenticated internal route was not trusted');
  assert(n.lead_id === 'TG-12345-1755000000000', 'trusted caller identity not honoured: ' + n.lead_id);
});

check('a trusted caller can select its own existing row', () => {
  const own = Object.assign({}, VICTIM_ROW, { lead_id: 'TG-12345-1755000000000', telegram: '@tguser' });
  const n = runNormalize({
    payload: basePayload({ lead_id: 'TG-12345-1755000000000' }),
    internalRoute: true
  });
  const d = runDedup({ lead: n, rows: [own] });
  assert(d.existing_lead_id === 'TG-12345-1755000000000', 'trusted caller could not reach its own row');
  assert(d.dedup_tier === 'strong', 'expected strong tier, got ' + d.dedup_tier);
});

console.log('\nCONTACT-BASED DEDUP IS PRESERVED');

check('a returning lead still merges on email', () => {
  const n = runNormalize({ payload: basePayload({ lead: { name: 'Victim Owner', contact: 'victim@example.com', company: 'Victim Holding', email: 'victim@example.com' } }) });
  const d = runDedup({ lead: n, rows: [VICTIM_ROW] });
  assert(d.dedup_mode === 'duplicate', 'email match lost, got ' + d.dedup_mode);
  assert(d.dedup_match_by === 'email', 'expected email tier, got ' + d.dedup_match_by);
});

check('the Concierge path still merges on telegram identity without a key', () => {
  const n = runNormalize({
    payload: basePayload({ lead: { name: 'TG User', contact: '@victimowner', company: '', telegram: '@victimowner' }, client: { telegram: '@victimowner' } })
  });
  const d = runDedup({ lead: n, rows: [VICTIM_ROW] });
  assert(d.dedup_mode === 'duplicate', 'telegram match lost, got ' + d.dedup_mode);
});

check('a Won row never absorbs a new submission', () => {
  const won = Object.assign({}, VICTIM_ROW, { deal_stage: 'Won' });
  const n = runNormalize({ payload: basePayload({ lead: { name: 'Victim Owner', contact: 'victim@example.com', company: 'Victim Holding', email: 'victim@example.com' } }) });
  const d = runDedup({ lead: n, rows: [won] });
  assert(d.dedup_mode === 'new', 'a Won row absorbed a new submission');
  assert(d.possible_duplicate_of === won.lead_id, 'closed duplicate was not flagged');
});

check('a Lost row never absorbs a new submission', () => {
  const lost = Object.assign({}, VICTIM_ROW, { deal_stage: 'Lost' });
  const n = runNormalize({ payload: basePayload({ lead: { name: 'Victim Owner', contact: 'victim@example.com', company: 'Victim Holding', email: 'victim@example.com' } }) });
  const d = runDedup({ lead: n, rows: [lost] });
  assert(d.dedup_mode === 'new', 'a Lost row absorbed a new submission');
});

console.log('\nESCALATION IS CONSTRAINED');

check('a weak company+name match cannot escalate canonical state', () => {
  const weakRow = Object.assign({}, VICTIM_ROW, {
    email: '', phone: '', telegram: '',
    created_at: new Date(Date.now() - 3600e3).toISOString(),
    updated_at: new Date(Date.now() - 3600e3).toISOString()
  });
  const n = runNormalize({
    payload: basePayload({
      lead: { name: 'Victim Owner', contact: 'other@example.com', company: 'Victim Holding', email: 'other@example.com' },
      diagnostic: { traffic_light: 'RED' },
      signals: { urgency: 'high' }
    })
  });
  const d = runDedup({ lead: Object.assign({}, n, { email_norm: '', phone_norm: '', telegram_norm: '', lead_priority: 'HOT', financial_zone: 'RED' }), rows: [weakRow] });
  if (d.dedup_tier === 'weak') {
    assert(d.dedup_escalated === false, 'a weak match escalated canonical state');
  }
});

check('escalation never lowers priority or zone', () => {
  const hotRow = Object.assign({}, VICTIM_ROW, { priority: 'HOT', financial_zone: 'RED' });
  const n = runNormalize({ payload: basePayload({ lead: { name: 'Victim Owner', contact: 'victim@example.com', company: 'Victim Holding', email: 'victim@example.com' } }) });
  const d = runDedup({ lead: Object.assign({}, n, { lead_priority: 'COLD', financial_zone: 'GREEN' }), rows: [hotRow] });
  assert(d.dedup_escalated === false, 'a lower-priority submission escalated an existing HOT/RED row');
});

console.log('\nPHONE IDENTITY IS ONLY DERIVED FROM PHONE-SHAPED INPUT');

check('an email is never normalised into a phone identity', () => {
  // Found by live QA: phoneRaw falls back to lead.contact, and the old rule stripped every
  // non-digit from it, so a digit-bearing email became a phone identity.
  const n = runNormalize({ payload: basePayload({ lead: { name: 'X', contact: 'qa-20260825-202641@example.com', company: 'X', email: 'qa-20260825-202641@example.com' } }) });
  assert(n.phone_norm === '', 'email produced a phone identity: ' + n.phone_norm);
});

check('a crafted email cannot collide with a real subscriber number', () => {
  const victim = Object.assign({}, VICTIM_ROW, { email: 'victim@example.com', phone: '+373 60 123 456', telegram: '' });
  const n = runNormalize({ payload: basePayload({ lead: { name: 'Attacker', contact: 'x37360123456@evil.example', company: 'Attacker Ltd', email: 'x37360123456@evil.example' } }) });
  assert(n.phone_norm === '', 'crafted email still yielded a phone identity: ' + n.phone_norm);
  const d = runDedup({ lead: n, rows: [victim] });
  assert(d.existing_lead_id !== victim.lead_id, 'crafted email merged into the victim row');
});

check('a genuine phone still normalises', () => {
  const n = runNormalize({ payload: basePayload({ lead: { name: 'X', contact: '+373 60 123 456', company: 'X', email: '' } }) });
  assert(n.phone_norm === '37360123456', 'valid phone lost: ' + n.phone_norm);
});

check('a phone with a trailing annotation still normalises', () => {
  const n = runNormalize({ payload: basePayload({ lead: { name: 'X', contact: '+373 60 123 456 (Viber)', company: 'X', email: '' } }) });
  assert(n.phone_norm === '37360123456', 'annotated phone lost: ' + n.phone_norm);
});

check('a Telegram handle is not a phone', () => {
  const n = runNormalize({ payload: basePayload({ lead: { name: 'X', contact: '@user12345678', company: 'X', email: '' } }) });
  assert(n.phone_norm === '', 'handle produced a phone identity: ' + n.phone_norm);
});

check('a t.me link is not a phone', () => {
  const n = runNormalize({ payload: basePayload({ lead: { name: 'X', contact: 'https://t.me/user12345678', company: 'X', email: '' } }) });
  assert(n.phone_norm === '', 't.me link produced a phone identity: ' + n.phone_norm);
});

check('free text containing a long digit run is not a phone', () => {
  const n = runNormalize({ payload: basePayload({ lead: { name: 'X', contact: 'order 20260825202641 please', company: 'X', email: '' } }) });
  assert(n.phone_norm === '', 'free text produced a phone identity: ' + n.phone_norm);
});

console.log('\nREQUEST CORRELATION');

check('the client request id is carried through for idempotency use', () => {
  const n = runNormalize({ payload: basePayload({ meta: { consent: true, request_id: 'fmr_abc123' } }) });
  assert(n.request_id === 'fmr_abc123', 'request_id lost in normalize: ' + n.request_id);
  const d = runDedup({ lead: n, rows: [] });
  assert(d.request_id === 'fmr_abc123', 'request_id lost in dedup: ' + d.request_id);
});

check('an oversized caller lead_id is truncated, not passed through raw', () => {
  const n = runNormalize({ payload: basePayload({ lead_id: 'A'.repeat(500) }) });
  assert(n.submission_lead_id.length <= 80, 'submission_lead_id not truncated: ' + n.submission_lead_id.length);
});

// ------------------------------------------------- request_id is not a selection capability

console.log('\nrequest_id IS CLIENT-MINTED AND MUST NEVER SELECT A ROW ALONE');

// lead-transport.js mints request_id in the browser and also accepts a caller-supplied
// payload.meta.request_id, so this field is attacker-controllable.
const RID = 'fmr_known_request_id';
const victimWithRid = Object.assign({}, VICTIM_ROW, {
  request_id: RID,
  email: 'victim@example.com',
  phone: '+373 60 111 222',
  telegram: 'victimhandle'
});

check('a known request_id with a different email does NOT merge', () => {
  const n = runNormalize({
    payload: basePayload({
      lead: { name: 'Attacker', contact: 'attacker@example.com', company: 'A', email: 'attacker@example.com' },
      meta: { consent: true, request_id: RID }
    })
  });
  const d = runDedup({ lead: n, rows: [victimWithRid] });
  assert(d.dedup_mode === 'new', 'request_id alone selected a row: mode=' + d.dedup_mode + ' by=' + d.dedup_match_by);
  assert(d.existing_lead_id === '', 'a foreign row was selected: ' + d.existing_lead_id);
  assert(d.dedup_request_id_corroborated === false, 'uncorroborated request_id marked corroborated');
});

check('a known request_id with a different phone and telegram does NOT merge', () => {
  const n = runNormalize({
    payload: basePayload({
      lead: { name: 'Attacker', contact: '+373 79 999 888', company: 'A', email: '', telegram: 'attackerhandle' },
      meta: { consent: true, request_id: RID }
    })
  });
  const d = runDedup({ lead: n, rows: [victimWithRid] });
  assert(d.dedup_mode === 'new', 'request_id + wrong phone/telegram merged: by=' + d.dedup_match_by);
});

check('a request_id match corroborated by email is a same-submission retry', () => {
  const n = runNormalize({
    payload: basePayload({
      lead: { name: 'Victim', contact: 'victim@example.com', company: 'V', email: 'victim@example.com' },
      meta: { consent: true, request_id: RID }
    })
  });
  const d = runDedup({ lead: n, rows: [victimWithRid] });
  assert(d.dedup_mode === 'duplicate', 'corroborated request_id did not match');
  assert(d.dedup_match_by === 'request_id+identity', 'wrong tier label: ' + d.dedup_match_by);
  assert(d.dedup_tier === 'strong', 'corroborated match is not strong: ' + d.dedup_tier);
  assert(d.dedup_request_id_corroborated === true, 'corroboration flag not set');
  assert(d.dedup_is_retry === true, 'corroborated request_id is not treated as a retry');
  assert(d.dedup_escalated === false, 'a retry escalated');
});

check('request_id never steers away from the row the contact identity selects', () => {
  // The attacker's own row carries the stolen request_id; their real identity belongs
  // elsewhere. Selection must follow the identity, never the borrowed key.
  const decoy = Object.assign({}, victimWithRid, { lead_id: 'FIN-DECOY-1' });
  const own = { lead_id: 'FIN-OWN-1', email: 'attacker@example.com', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' };
  const n = runNormalize({
    payload: basePayload({
      lead: { name: 'Attacker', contact: 'attacker@example.com', company: 'A', email: 'attacker@example.com' },
      meta: { consent: true, request_id: RID }
    })
  });
  const d = runDedup({ lead: n, rows: [decoy, own] });
  assert(d.existing_lead_id === 'FIN-OWN-1', 'selected the wrong row: ' + d.existing_lead_id + ' by ' + d.dedup_match_by);
});

check('blank request_ids do not match each other', () => {
  const blankRow = { lead_id: 'FIN-BLANK-1', request_id: '', email: 'other@example.com', created_at: '2026-08-01T00:00:00Z' };
  const n = runNormalize({
    payload: basePayload({
      lead: { name: 'X', contact: 'nomatch@example.com', company: 'X', email: 'nomatch@example.com' },
      meta: { consent: true, request_id: '' }
    })
  });
  const d = runDedup({ lead: n, rows: [blankRow] });
  assert(d.dedup_mode === 'new', 'blank request_ids matched: by=' + d.dedup_match_by);
});

// ---------------------------------------------------- provenance comes from the route only

console.log('\nINTERNAL PROVENANCE IS ROUTE-BASED, NOT A SHEETS SECRET');

check('a payload cannot assert its own provenance', () => {
  for (const hostile of [{ __internal_route: true }, { internal_route: true }, { provenance_trusted: true }]) {
    const n = runNormalize({ payload: basePayload(Object.assign({ lead_id: VICTIM_ROW.lead_id }, hostile)) });
    assert(n.provenance_trusted === false, 'payload asserted provenance via ' + Object.keys(hostile)[0]);
    assert(n.lead_id !== VICTIM_ROW.lead_id, 'caller lead_id adopted via ' + Object.keys(hostile)[0]);
  }
});

check('the retired header and Settings key grant nothing', () => {
  const n = runNormalize({
    payload: basePayload({ lead_id: VICTIM_ROW.lead_id }),
    headers: { 'x-finmentor-internal-key': 'super-secret' },
    settings: { internal_intake_key: 'super-secret' }
  });
  assert(n.provenance_trusted === false, 'the retired Sheets-secret path still grants trust');
  assert(n.lead_id !== VICTIM_ROW.lead_id, 'caller lead_id adopted through the retired path');
});

check('the authenticated internal route does grant provenance', () => {
  const n = runNormalize({ payload: basePayload({ lead_id: VICTIM_ROW.lead_id }), internalRoute: true });
  assert(n.provenance_trusted === true, 'authenticated internal route was not trusted');
  assert(n.lead_id === VICTIM_ROW.lead_id, 'trusted caller lead_id was not honoured: ' + n.lead_id);
});

check('no source reads internal_intake_key any more', () => {
  assert(!normalizeSrc.match(/settings\.internal_intake_key/), 'normalize still reads the Settings secret');
});

// ------------------------------------------------------- merge-path attribution policy

console.log('\nMERGE PATH IMPLEMENTS THE ATTRIBUTION POLICY');

const EXISTING = {
  lead_id: 'FIN-EXIST-1',
  email: 'known@example.com',
  request_id: 'fmr_old',
  analytics_consent: 'TRUE',
  ga_client_id: 'GA1.1.111',
  ga_session_id: 'S111',
  utm_source_first: 'google', utm_medium_first: 'cpc', utm_campaign_first: 'launch',
  first_touch_at: '2026-01-01T00:00:00.000Z',
  utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'launch'
};

const mergeLead = (over = {}) => Object.assign({
  existing_row: EXISTING,
  existing_lead_id: EXISTING.lead_id,
  lead_id: EXISTING.lead_id,
  dedup_match_by: 'email',
  dedup_is_retry: false,
  dedup_escalated: false,
  source: 'website',
  request_id: 'fmr_new',
  utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'august',
  raw_json: JSON.stringify({
    meta: {
      analytics_consent: true, ga_client_id: 'GA1.1.222', ga_session_id: 'S222',
      attribution_first_touch: { utm_source: 'bing', utm_medium: 'organic', utm_campaign: 'other', captured_at: '2026-08-01T00:00:00.000Z' }
    }
  })
}, over);

check('a genuine merge advances last touch and preserves first touch', () => {
  const u = runMerge({ lead: mergeLead() });
  assert(u.utm_source === 'newsletter', 'last touch did not advance: ' + u.utm_source);
  assert(u.utm_medium === 'email' && u.utm_campaign === 'august', 'last touch partly stale');
  assert(u.utm_source_first === 'google', 'first touch overwritten: ' + u.utm_source_first);
  assert(u.first_touch_at === '2026-01-01T00:00:00.000Z', 'first_touch_at overwritten');
  assert(u.request_id === 'fmr_new', 'request_id did not advance: ' + u.request_id);
});

check('a retry changes no attribution at all', () => {
  const u = runMerge({ lead: mergeLead({ dedup_is_retry: true }) });
  assert(u.utm_source === 'google' && u.utm_medium === 'cpc' && u.utm_campaign === 'launch', 'retry moved last touch');
  assert(u.utm_source_first === 'google', 'retry moved first touch');
  assert(u.request_id === 'fmr_old', 'retry rotated the request_id: ' + u.request_id);
  assert(u.ga_client_id === 'GA1.1.111', 'retry rewrote a GA identifier');
  assert(u.analytics_consent === 'TRUE', 'retry rewrote consent');
});

check('a blank later value never erases a known one', () => {
  const u = runMerge({ lead: mergeLead({ utm_source: '', utm_medium: '', utm_campaign: '', request_id: '', raw_json: '{}' }) });
  assert(u.utm_source === 'google', 'blank erased last touch');
  assert(u.utm_source_first === 'google', 'blank erased first touch');
  assert(u.request_id === 'fmr_old', 'blank erased request_id');
  assert(u.ga_client_id === 'GA1.1.111', 'blank erased ga_client_id');
  assert(u.analytics_consent === 'TRUE', 'absent consent key erased consent');
});

check('GA identifiers are written only under accepted consent', () => {
  const consented = runMerge({ lead: mergeLead() });
  assert(consented.ga_client_id === 'GA1.1.222', 'consented GA id not written: ' + consented.ga_client_id);
  assert(consented.ga_session_id === 'S222', 'consented GA session not written');

  const refused = runMerge({ lead: mergeLead({
    raw_json: JSON.stringify({ meta: { analytics_consent: false, ga_client_id: 'GA1.1.333', ga_session_id: 'S333' } })
  }) });
  assert(refused.ga_client_id === 'GA1.1.111', 'GA id written without consent: ' + refused.ga_client_id);
  assert(refused.ga_session_id === 'S111', 'GA session written without consent');
});

check('a later consent=false is recorded but never erases stored identifiers', () => {
  const u = runMerge({ lead: mergeLead({
    raw_json: JSON.stringify({ meta: { analytics_consent: false } })
  }) });
  assert(u.analytics_consent === 'FALSE', 'later refusal not recorded: ' + u.analytics_consent);
  assert(u.ga_client_id === 'GA1.1.111', 'later refusal erased a stored identifier');
  assert(u.ga_session_id === 'S111', 'later refusal erased a stored session id');
});

check('a legacy row with no first touch can be populated once', () => {
  const legacy = Object.assign({}, EXISTING, {
    utm_source_first: '', utm_medium_first: '', utm_campaign_first: '', first_touch_at: ''
  });
  const u = runMerge({ lead: mergeLead({ existing_row: legacy }) });
  assert(u.utm_source_first === 'bing', 'legacy first touch not populated: ' + u.utm_source_first);
  assert(u.first_touch_at === '2026-08-01T00:00:00.000Z', 'legacy first_touch_at not populated');
});

check('a retry cannot populate a legacy blank first touch either', () => {
  const legacy = Object.assign({}, EXISTING, { utm_source_first: '', first_touch_at: '' });
  const u = runMerge({ lead: mergeLead({ existing_row: legacy, dedup_is_retry: true }) });
  assert(u.utm_source_first === '', 'retry wrote first touch: ' + u.utm_source_first);
});

check('the merge never emits contact PII into attribution columns', () => {
  const u = runMerge({ lead: mergeLead() });
  for (const f of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_source_first', 'utm_medium_first', 'utm_campaign_first', 'first_touch_at', 'request_id', 'ga_client_id', 'ga_session_id']) {
    assert(!/@/.test(String(u[f])), f + ' carries an email-like value: ' + u[f]);
  }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('\nLEAD INTAKE TRUST GATE: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('LEAD INTAKE TRUST GATE: PASS');
