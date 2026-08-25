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

function runNormalize({ payload, headers = {}, settings = {} }) {
  const named = {
    'Validate Payload': item({ payload }),
    'Settings to Object': item({ settings }),
    'Webhook': item({ headers })
  };
  const fn = new Function('$input', '$', '$now', normalizeSrc);
  const out = fn(item({ payload }), (n) => named[n], new Date().toISOString());
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

check('a correct internal key restores strong lead_id identity', () => {
  const n = runNormalize({
    payload: basePayload({ lead_id: 'TG-12345-1755000000000', tool: 'telegram_client_concierge' }),
    headers: { 'x-finmentor-internal-key': 'the-real-key' },
    settings: { internal_intake_key: 'the-real-key' }
  });
  assert(n.provenance_trusted === true, 'correct key was not trusted');
  assert(n.lead_id === 'TG-12345-1755000000000', 'trusted caller identity not honoured: ' + n.lead_id);
});

check('a trusted caller can select its own existing row', () => {
  const own = Object.assign({}, VICTIM_ROW, { lead_id: 'TG-12345-1755000000000', telegram: '@tguser' });
  const n = runNormalize({
    payload: basePayload({ lead_id: 'TG-12345-1755000000000' }),
    headers: { 'x-finmentor-internal-key': 'k' },
    settings: { internal_intake_key: 'k' }
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

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('\nLEAD INTAKE TRUST GATE: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('LEAD INTAKE TRUST GATE: PASS');
