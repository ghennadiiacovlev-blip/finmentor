#!/usr/bin/env node
// FINMENTOR — Mini App consent + submit gate (B.2.1-C).
//
// Executes the QA matrix the gateway contract already specifies for this slice:
// docs/PHASE_B2_1_GATEWAY_CONTRACT.md §13 "Consent", "Submit/idempotency" and "Security",
// against §8 (consent), §9 (submit sequence), §10 (idempotency), §11 (urgency semantic
// guard) and §12 (HTTP/security controls).
//
// Offline by construction. The app-session store, Bot_Sessions and Lead Intake are injected
// doubles that implement the same conditional-update and canonical-response semantics as
// the live components, so the code under test here is the code that would deploy. Nothing
// in this file needs a tenant, a credential, a webhook or a network.
//
// What this gate CANNOT prove is stated plainly in the B.2.1-C closure doc: a real Telegram
// initData canary, a real Lead Intake response and a real n8n Data Table CAS under live
// execution overlap are all marked LIVE PROOF REQUIRED there. This gate proves the logic;
// it does not claim the deployment.
//
// Assertion-based, non-zero exit on failure, paths resolved from this file not from cwd.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = join(HERE, '..', 'n8n', 'src', 'miniapp-submit');
const C = require(join(SRC, 'submit-contract.js'));
const H = require(join(SRC, 'submit-handler.js'));

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
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// ---------------------------------------------------------------- test doubles

const NOW = '2026-08-26T02:00:00.000Z';
const CLOCK = { now: () => NOW };
const SESSION_ID = 'AS-0123456789abcdef0123';
const CHAT = '551662084';
const CYCLE = 'C-2026-08-26-01';
// P3 — the recovery key is the AUTHORITATIVE preallocated submission_key, not a value
// derived from identity. The caller still cannot steer it; it just comes from a safer place.
const AUTH_SUBMISSION_KEY = 'sub_' + '1'.repeat(32);

// Shared ordered event log, so a test can assert that the authoritative commit happened
// BEFORE the derived mirror ran rather than merely that both happened.
let EVENTS = [];

// App-session store. claim() is a conditional update on the current submit_state: the same
// compare-and-set the live store must provide, and the reason two concurrent submits cannot
// both reach the Lead Intake call.
function makeSessions(initial) {
  const row = Object.assign({
    app_session_id: SESSION_ID,
    telegram_user_id: CHAT,
    chat_id: CHAT,
    cycle_id: CYCLE,
    submit_state: 'draft',
    lead_id: '',
    expires_at: '2026-08-26T03:00:00.000Z'
  }, initial || {});
  return {
    row,
    stats: { reads: 0, claims: 0, updates: 0 },
    missing: false,
    read(id) {
      this.stats.reads++;
      if (this.missing || id !== row.app_session_id) { return { ok: false, session: null }; }
      return { ok: true, session: Object.assign({}, row) };
    },
    claim(id, spec) {
      this.stats.claims++;
      EVENTS.push('session_claim');
      if (id !== row.app_session_id) { return { ok: true, updated_rows: 0 }; }
      if (row.submit_state !== spec.from) { return { ok: true, updated_rows: 0 }; }
      row.submit_state = spec.to;
      Object.assign(row, spec.patch || {});
      return { ok: true, updated_rows: 1 };
    },
    update(id, patch) {
      this.stats.updates++;
      EVENTS.push('session_update:' + (patch.submit_state || 'patch'));
      Object.assign(row, patch);
      return { ok: true };
    }
  };
}

// The header set the LIVE Bot_Sessions sheet has TODAY. The three N6.2 classification
// columns are deliberately absent, because a fixture that pretends they exist would hide the
// deployment prerequisite instead of proving it.
const LIVE_AUTHORITY_COLUMNS = [
  'chat_id', 'cycle_id', 'consent', 'consent_cycle_id', 'consent_at', 'consent_source',
  'lead_id', 'lead_cycle_id', 'lead_intake_ok', 'updated_at', 'submission_key'
];

// The header set a deployment that has satisfied AUTHORITY_SCHEMA_PRECONDITION will have.
// Tests of post-deployment behaviour use this; a dedicated test proves the difference between
// the two lists is exactly the precondition and nothing else.
const MIGRATED_AUTHORITY_COLUMNS = LIVE_AUTHORITY_COLUMNS.concat(['lead_mode', 'lead_priority', 'financial_zone']);

// Bot_Sessions double. Same read/write contract the read-model mirror helper is injected
// with, so authority behaves identically across both slices.
//
// `columns` models the sheet's header row. A patch key with no header is DROPPED, not
// rejected — which is what Google Sheets actually does, and precisely why the deployment
// precondition has to fail closed: an unmigrated sheet accepts the classification write and
// silently keeps none of it.
function makeAuthority(initial, columns) {
  const row = Object.assign({
    chat_id: CHAT,
    cycle_id: CYCLE,
    // P3 — preallocated at cycle issuance by the Concierge. A current cycle always has one.
    submission_key: 'sub_' + '1'.repeat(32),
    consent: '',
    consent_cycle_id: '',
    consent_at: '',
    lead_id: '',
    lead_cycle_id: ''
  }, initial || {});
  return {
    row,
    columns: (columns || MIGRATED_AUTHORITY_COLUMNS).slice(),
    dropped: [],
    stats: { reads: 0, writes: 0 },
    failWrite: null,
    missing: false,
    read(chatId) {
      this.stats.reads++;
      if (this.missing) { return { ok: false, row: null }; }
      return { ok: true, row: Object.assign({}, row) };
    },
    write(chatId, patch) {
      this.stats.writes++;
      const kind = patch.lead_id !== undefined ? 'lead' : 'consent';
      EVENTS.push('authority_write:' + kind);
      if (this.failWrite === kind) { return { ok: false }; }
      Object.keys(patch).forEach((k) => {
        // No header, no write, no error. See the comment above makeAuthority.
        if (this.columns.indexOf(k) === -1) { this.dropped.push(k); return; }
        row[k] = patch[k];
      });
      return { ok: true };
    }
  };
}

// Lead Intake double. `calls` records the exact envelopes handed downstream, which is how
// "exactly one Intake call" is asserted rather than assumed.
function makeIntake(behaviour) {
  const b = behaviour || {};
  return {
    calls: [],
    lookups: [],
    submit(req) {
      this.calls.push(req);
      EVENTS.push('intake_submit');
      if (b.ambiguous) { return { ok: false, ambiguous: true }; }
      if (b.body) { return { ok: true, body: b.body }; }
      return {
        ok: true,
        body: { ok: true, lead_id: 'FIN-1756171200-042', mode: 'new', priority: 'WARM', financial_zone: 'YELLOW' }
      };
    },
    lookup(key) {
      this.lookups.push(key);
      if (b.lookup === undefined) { return { ok: false }; }
      return b.lookup;
    }
  };
}

const GOOD_ANSWERS = {
  sector: 'retail', turnover: 'lt100k', cash: 'unclear', profit: 'partial',
  treasury: 'unclear', kpi: 'partial', pain: 'reporting', urgency: 'none'
};

function body(over) {
  return Object.assign({
    app_session_id: SESSION_ID,
    client_version: 'b2.1.0',
    consent: 'yes',
    answers: Object.assign({}, GOOD_ANSWERS),
    contact: { name: 'Ion', company: 'ACME SRL', direct: '+37360123456' }
  }, over || {});
}

function run(over, wiring) {
  EVENTS = [];
  const w = wiring || {};
  const sessions = w.sessions || makeSessions();
  const authority = w.authority || makeAuthority();
  const leadIntake = w.leadIntake || makeIntake();
  const mirrored = [];
  const out = H.handleSubmit({
    headers: w.headers || { 'content-type': 'application/json' },
    body: over === null ? null : body(over),
    sessions,
    authority,
    leadIntake,
    mirror: w.noMirror ? undefined : (id) => {
      EVENTS.push('mirror');
      // G3 -- the derived refresh raising, as a closed Data Table or a quota error would.
      if (w.mirrorThrows) { throw new Error('data table unavailable'); }
      mirrored.push(id);
    },
    clock: CLOCK,
    locale: 'ru',
    // A fixed correlation id where a test asserts on it; server-minted otherwise.
    correlationId: w.correlationId,
    rateLimited: w.rateLimited === true
  });
  return { out, sessions, authority, leadIntake, mirrored, events: EVENTS.slice() };
}

// ------------------------------------------------- §12 transport and schema guards

check('non-JSON content type is refused before anything is read', () => {
  const r = run({}, { headers: { 'content-type': 'text/plain' } });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'content type not refused');
  eq(r.leadIntake.calls.length, 0, 'Intake called on a refused content type');
  eq(r.sessions.stats.reads, 0, 'session read before the transport guard');
});

check('oversized body is refused', () => {
  const r = run({ padding: 'x'.repeat(C.MAX_BODY_BYTES) });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'oversized body accepted');
  eq(r.leadIntake.calls.length, 0, 'Intake called on an oversized body');
});

check('rate limiting refuses with a retryable code and zero effects', () => {
  const r = run({}, { rateLimited: true });
  eq(r.out.response.error_code, 'RATE_LIMITED', 'not rate limited');
  eq(r.out.response.retryable, true, 'rate limit not marked retryable');
  eq(r.leadIntake.calls.length, 0, 'Intake called while rate limited');
});

check('unsupported client version is refused', () => {
  const r = run({ client_version: 'b9.9.9' });
  eq(r.out.response.error_code, 'CLIENT_VERSION_UNSUPPORTED', 'version not refused');
});

check('malformed app_session_id is refused as a missing session', () => {
  const r = run({ app_session_id: 'short' });
  eq(r.out.response.error_code, 'SESSION_MISSING', 'bad session id accepted');
});

check('unknown answer key is refused, not silently dropped', () => {
  const r = run({ answers: Object.assign({}, GOOD_ANSWERS, { headcount: '10' }) });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'unknown answer key accepted');
  eq(r.out.log.stage, 'ANSWER_KEY_UNKNOWN', 'wrong rejection stage');
});

check('unknown answer value is refused', () => {
  const r = run({ answers: Object.assign({}, GOOD_ANSWERS, { urgency: 'yesterday' }) });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'unknown answer value accepted');
  eq(r.out.log.stage, 'ANSWER_VALUE_UNKNOWN', 'wrong rejection stage');
});

check('missing required answer is refused', () => {
  const a = Object.assign({}, GOOD_ANSWERS);
  delete a.treasury;
  const r = run({ answers: a });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'incomplete answers accepted');
});

check('unknown contact key is refused', () => {
  const r = run({ contact: { name: 'Ion', company: 'ACME', direct: '', iban: 'MD00' } });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'unknown contact key accepted');
});

check('free text beyond the browser limit is refused', () => {
  const r = run({ answers: Object.assign({}, GOOD_ANSWERS, { context: 'x'.repeat(C.MAX_FREE_TEXT + 1) }) });
  eq(r.out.response.error_code, 'BAD_REQUEST', 'overlong free text accepted');
});

check('free text is stored as data: control characters and formulas are neutralised', () => {
  const withCtrl = 'line' + String.fromCharCode(10) + 'break' + String.fromCharCode(0);
  eq(C.sanitiseText(withCtrl), 'line break', 'control characters survived');
  eq(C.sanitiseText('=SUM(A1)'), String.fromCharCode(39) + '=SUM(A1)', 'formula not neutralised');
  eq(C.sanitiseText('@import'), String.fromCharCode(39) + '@import', 'at-prefix not neutralised');
});

check('consent must be the literal yes or no decision', () => {
  eq(run({ consent: 'true' }).out.response.error_code, 'CONSENT_REQUIRED', 'string true accepted as consent');
  eq(run({ consent: true }).out.response.error_code, 'CONSENT_REQUIRED', 'boolean accepted as consent');
  eq(run({ consent: 1 }).out.response.error_code, 'CONSENT_REQUIRED', 'number accepted as consent');
  eq(run({ consent: undefined }).out.response.error_code, 'CONSENT_REQUIRED', 'absent consent accepted');
});

// ------------------------------------------------- §12 caller cannot steer identity

check('browser-supplied lead_id is ignored and recorded, never honoured', () => {
  const r = run({ lead_id: 'FIN-VICTIM-0001', canonical_lead_id: 'FIN-VICTIM-0001' });
  eq(r.out.ok, true, 'submit rejected');
  assert(r.out.log.untrusted_fields_ignored.indexOf('lead_id') !== -1, 'lead_id not recorded as ignored');
  const sent = JSON.stringify(r.leadIntake.calls[0].envelope);
  assert(sent.indexOf('FIN-VICTIM-0001') === -1, 'caller lead_id reached Lead Intake');
  eq(r.out.response.lead_id, 'FIN-1756171200-042', 'caller lead_id became canonical identity');
});

check('the Lead Intake payload carries no lead_id key at all', () => {
  const r = run({});
  const p = r.leadIntake.calls[0].envelope.payload;
  eq(Object.prototype.hasOwnProperty.call(p, 'lead_id'), false, 'payload asserts a lead_id');
  eq(Object.prototype.hasOwnProperty.call(p, '__internal_route'), false, 'payload asserts provenance');
  eq(Object.prototype.hasOwnProperty.call(p, 'provenance_trusted'), false, 'payload asserts provenance');
});

check('caller request_id cannot become the payload request_id', () => {
  const r = run({ request_id: 'attacker-chosen' });
  const p = r.leadIntake.calls[0].envelope.payload;
  assert(p.meta.request_id !== 'attacker-chosen', 'caller request_id was forwarded');
  eq(p.meta.request_id, r.out.log.correlation_id, 'request_id is not the server correlation id');
});

check('request_id cannot steer the idempotency key', () => {
  const r = run({ request_id: 'miniapp:999:C-OTHER', idempotency_key: 'miniapp:999:C-OTHER' });
  eq(r.leadIntake.calls[0].idempotency_key, 'miniapp:' + CHAT + ':' + CYCLE, 'key was steered by the caller');
});

check('the idempotency key is built only from server-owned values', () => {
  eq(C.idempotencyKey(CHAT, CYCLE), 'miniapp:' + CHAT + ':' + CYCLE, 'key shape drifted from §10');
  eq(C.idempotencyKey('', CYCLE), null, 'key built without a Telegram id');
  eq(C.idempotencyKey(CHAT, ''), null, 'key built without a cycle');
  eq(C.idempotencyKey('not-a-number', CYCLE), null, 'non-numeric Telegram id accepted');
});

check('browser-supplied cycle, consent and scoring fields are ignored', () => {
  const r = run({
    cycle_id: 'C-FORGED', consent_at: '1999-01-01T00:00:00.000Z',
    priority: 'HOT', financial_zone: 'RED', submit_state: 'submitted'
  });
  eq(r.out.ok, true, 'submit rejected');
  eq(r.authority.row.consent_cycle_id, CYCLE, 'forged cycle became the consent cycle');
  eq(r.authority.row.consent_at, NOW, 'browser timestamp became the consent stamp');
  eq(r.out.response.priority, 'WARM', 'browser priority overrode the canonical result');
  eq(r.out.response.financial_zone, 'YELLOW', 'browser zone overrode the canonical result');
});

// ------------------------------------------------- §12 no leakage to the browser

check('the success response leaks no identity or control field', () => {
  const r = run({});
  eq(C.responseLeaks(r.out.response).length, 0, 'success response leaked ' + C.responseLeaks(r.out.response).join(','));
  const keys = Object.keys(r.out.response).sort();
  eq(keys.join(','), C.CLIENT_RESPONSE_FIELDS.slice().sort().join(','), 'success response is not the §9 whitelist');
});

check('error responses expose only code and retryability', () => {
  const r = run({ answers: Object.assign({}, GOOD_ANSWERS, { sector: 'banking' }) });
  eq(Object.keys(r.out.response).sort().join(','), 'error_code,ok,retryable', 'error response shape drifted');
  eq(C.responseLeaks(r.out.response).length, 0, 'error response leaked a forbidden field');
  eq(r.out.response.detail, undefined, 'rejection detail reached the browser');
});

check('contact details and init_data are never written to the accept log', () => {
  const r = run({});
  const logged = JSON.stringify(r.out.log);
  assert(logged.indexOf('+37360123456') === -1, 'direct contact reached the log');
  assert(logged.indexOf('ACME SRL') === -1, 'company reached the log');
  assert(logged.indexOf('init_data') === -1, 'init_data reached the log');
});

// ------------------------------------------------- §13 session and cycle

check('an unknown app session is refused', () => {
  const s = makeSessions(); s.missing = true;
  const r = run({}, { sessions: s });
  eq(r.out.response.error_code, 'SESSION_INVALID', 'unknown session accepted');
  eq(r.leadIntake.calls.length, 0, 'Intake called for an unknown session');
});

check('an expired app session is refused', () => {
  const r = run({}, { sessions: makeSessions({ expires_at: '2026-08-26T01:00:00.000Z' }) });
  eq(r.out.response.error_code, 'SESSION_EXPIRED', 'expired session accepted');
  eq(r.leadIntake.calls.length, 0, 'Intake called for an expired session');
});

check('a session resolving to another chat is refused as an identity failure', () => {
  const r = run({}, {
    sessions: makeSessions({ chat_id: '900000009', telegram_user_id: '900000009' }),
    authority: makeAuthority({ chat_id: CHAT })
  });
  eq(r.out.response.error_code, 'SESSION_INVALID', 'chat mismatch accepted');
  eq(r.leadIntake.calls.length, 0, 'Intake called across an identity mismatch');
});

check('an unreadable authority is a temporary backend error, never a fresh submit', () => {
  const a = makeAuthority(); a.missing = true;
  const r = run({}, { authority: a });
  eq(r.out.response.error_code, 'TEMPORARY_BACKEND_ERROR', 'unreadable authority not surfaced');
  eq(r.out.response.retryable, true, 'not marked retryable');
  eq(r.leadIntake.calls.length, 0, 'Intake called without authority');
});

check('a session bound to a superseded cycle is refused', () => {
  const r = run({}, {
    sessions: makeSessions({ cycle_id: 'C-OLD' }),
    authority: makeAuthority({ cycle_id: 'C-NEW' })
  });
  eq(r.out.response.error_code, 'CYCLE_SUPERSEDED', 'stale cycle binding accepted');
  eq(r.leadIntake.calls.length, 0, 'Intake called on a superseded cycle');
  eq(r.authority.stats.writes, 0, 'authority written on a superseded cycle');
});

check('an authority row with no cycle cannot be submitted against', () => {
  const r = run({}, { authority: makeAuthority({ cycle_id: '' }), sessions: makeSessions({ cycle_id: '' }) });
  eq(r.out.response.error_code, 'CYCLE_SUPERSEDED', 'blank cycle accepted');
  eq(r.leadIntake.calls.length, 0, 'Intake called with no cycle');
});

// ------------------------------------------------- §8 consent

check('consent NO performs zero Lead Intake calls and zero writes', () => {
  const r = run({ consent: 'no' });
  eq(r.out.ok, true, 'NO treated as an error');
  eq(r.out.response.consent, 'no', 'NO not reported back');
  eq(r.leadIntake.calls.length, 0, 'NO called Lead Intake');
  eq(r.authority.stats.writes, 0, 'NO wrote to authority');
  eq(r.mirrored.length, 0, 'NO refreshed the read model');
});

check('consent NO leaves the submit state where it was', () => {
  const r = run({ consent: 'no' });
  eq(r.sessions.row.submit_state, 'draft', 'NO moved the submit state');
  eq(r.out.response.submit_state, 'draft', 'NO reported a moved state');
});

check('consent YES on the current cycle is eligible and stamped server-side', () => {
  const d = C.evaluateConsent({ consent: 'yes', authorityCycleId: CYCLE, sessionCycleId: CYCLE, nowIso: NOW });
  eq(d.eligible, true, 'current-cycle consent refused');
  eq(d.stamp.consent, 'yes', 'stamp consent wrong');
  eq(d.stamp.consent_cycle_id, CYCLE, 'stamp bound to the wrong cycle');
  eq(d.stamp.consent_at, NOW, 'stamp not server-timed');
  eq(d.stamp.consent_source, 'telegram_miniapp', 'stamp source wrong');
});

check('consent from another cycle is invalid', () => {
  const d = C.evaluateConsent({ consent: 'yes', authorityCycleId: 'C-NEW', sessionCycleId: 'C-OLD', nowIso: NOW });
  eq(d.eligible, false, 'stale-cycle consent accepted');
  eq(d.lead_intake_allowed, false, 'stale-cycle consent allowed Intake');
  eq(d.error_code, 'CONSENT_STALE_CYCLE', 'wrong error code');
});

check('consent commits to authority before Lead Intake is called', () => {
  const r = run({});
  const consentAt = r.events.indexOf('authority_write:consent');
  const intakeAt = r.events.indexOf('intake_submit');
  assert(consentAt !== -1, 'consent never committed');
  assert(consentAt < intakeAt, 'Intake called before consent was stamped');
  eq(r.authority.row.consent, 'yes', 'consent not persisted');
  eq(r.authority.row.consent_cycle_id, CYCLE, 'consent not bound to the current cycle');
});

check('a failed consent write stops the submit before Lead Intake', () => {
  const a = makeAuthority(); a.failWrite = 'consent';
  const r = run({}, { authority: a });
  eq(r.out.response.error_code, 'TEMPORARY_BACKEND_ERROR', 'failed consent write not surfaced');
  eq(r.leadIntake.calls.length, 0, 'Intake called after a failed consent write');
});

// ------------------------------------------------- §11 urgency semantic guard

check('urgency none stays negative and does not escalate downstream', () => {
  eq(C.URGENCY_RU.none, 'Нет срочности', 'none no longer maps to the negative string');
  eq(C.wouldEscalateInLeadIntake(C.URGENCY_RU.none), false, 'urgency none would escalate priority');
  eq(C.wouldEscalateInLeadIntake(C.URGENCY_RU.month), false, 'urgency month would escalate priority');
  eq(C.wouldEscalateInLeadIntake(C.URGENCY_RU.quarter), false, 'urgency quarter would escalate priority');
});

check('urgency now is the only Mini App value that escalates', () => {
  eq(C.wouldEscalateInLeadIntake(C.URGENCY_RU.now), true, 'urgency now fails to escalate');
  const escalating = Object.keys(C.URGENCY_RU).filter((k) => C.wouldEscalateInLeadIntake(C.URGENCY_RU[k]));
  eq(escalating.join(','), 'now', 'the escalating set is not exactly {now}');
});

check('the urgency string handed to Lead Intake comes from the whitelist, not the browser', () => {
  const r = run({});
  const p = r.leadIntake.calls[0].envelope.payload;
  eq(p.main_pain.urgency, 'Нет срочности', 'urgency projection drifted');
  eq(C.wouldEscalateInLeadIntake(p.main_pain.urgency), false, 'the submitted urgency escalates');
});

check('the copied Lead Intake urgency rules still match the deployed scorer', () => {
  // Drift guard: these regexes are duplicated into submit-contract.js so §11 is provable
  // offline. If the scorer's rules change, this fails here instead of silently letting
  // `urgency = none` start escalating again.
  const src = readFileSync(join(HERE, '..', 'n8n', 'src', 'lead-intake', 'normalize-score-lead.js'), 'utf8');
  C.LEAD_INTAKE_URGENT_PATTERNS.forEach((re) => {
    assert(src.indexOf(re.toString()) !== -1, 'urgent pattern drifted from Lead Intake: ' + re);
  });
  C.LEAD_INTAKE_NEGATION.forEach((re) => {
    assert(src.indexOf(re.toString()) !== -1, 'negation pattern drifted from Lead Intake: ' + re);
  });
});

// ------------------------------------------------- §9 payload projection

check('the envelope matches the shape the existing Lead Intake parses', () => {
  const r = run({});
  const env = r.leadIntake.calls[0].envelope;
  eq(env.source, 'telegram_miniapp', 'source drifted');
  eq(env.payload.tool, 'miniapp_diagnostic', 'tool drifted');
  eq(env.payload.meta.consent, true, 'consent flag absent from meta');
  eq(env.payload.intake.consent.privacy_accepted, true, 'privacy consent absent');
  eq(env.payload.client.telegram, CHAT, 'Telegram reply channel absent');
  eq(env.payload.client.name, 'Ion', 'contact name not forwarded');
});

check('only whitelisted answers reach the payload, mapped to CRM vocabulary', () => {
  const r = run({});
  const p = r.leadIntake.calls[0].envelope.payload;
  eq(p.answers.business_model, 'Торговля', 'sector mapping drifted');
  eq(p.answers.revenue_range, 'до 100k EUR', 'turnover mapping drifted');
  eq(p.main_pain.problem, 'Нет управленческой отчётности', 'pain mapping drifted');
  eq(p.miniapp.answers_raw.sector, 'retail', 'raw slug not carried for machine use');
});

check('free text is carried as sanitised data', () => {
  const r = run({ answers: Object.assign({}, GOOD_ANSWERS, { context: '  =cmd  ' }) });
  const p = r.leadIntake.calls[0].envelope.payload;
  eq(p.free_text, String.fromCharCode(39) + '=cmd', 'free text not sanitised before forwarding');
});

// ------------------------------------------------- §10 idempotency and state

check('the submit state machine is monotonic toward submitted', () => {
  eq(C.canTransition('draft', 'submitting'), true, 'draft cannot claim');
  eq(C.canTransition('submitting', 'submitted'), true, 'submitting cannot complete');
  eq(C.canTransition('submitting', 'retryable_error'), true, 'submitting cannot fail');
  eq(C.canTransition('retryable_error', 'submitting'), true, 'a failed attempt cannot retry');
  eq(C.canTransition('submitted', 'draft'), false, 'submitted moved back to draft');
  eq(C.canTransition('submitted', 'submitting'), false, 'submitted moved back to submitting');
  eq(C.canTransition('submitted', 'retryable_error'), false, 'submitted moved to an error state');
  eq(C.canTransition('draft', 'submitted'), false, 'submitted reached without claiming');
});

check('a new lead makes exactly one Intake call and one canonical result', () => {
  const r = run({});
  eq(r.leadIntake.calls.length, 1, 'Intake call count');
  eq(r.out.response.lead_id, 'FIN-1756171200-042', 'canonical lead id not returned');
  // N6.2 -- mode is internal now. It is asserted on the LOG, which is where it lives.
  eq(r.out.log.lead_mode, 'new', 'mode drifted');
  eq(r.out.response.mode, undefined, 'mode crossed TB-1 on a fresh success');
  eq(r.out.response.submit_state, 'submitted', 'submit state not terminal');
  eq(r.sessions.row.submit_state, 'submitted', 'session state not terminal');
  eq(r.authority.row.lead_id, 'FIN-1756171200-042', 'canonical lead not persisted to authority');
  eq(r.authority.row.lead_cycle_id, CYCLE, 'lead not bound to the current cycle');
});

check('a merge makes exactly one Intake call and returns the existing canonical lead', () => {
  const intake = makeIntake({ body: { ok: true, lead_id: 'FIN-EXISTING-007', mode: 'merged', priority: 'HOT', financial_zone: 'RED' } });
  const r = run({}, { leadIntake: intake });
  eq(r.leadIntake.calls.length, 1, 'Intake call count');
  eq(r.out.response.lead_id, 'FIN-EXISTING-007', 'existing canonical lead not returned');
  eq(r.out.log.lead_mode, 'merged', 'merge mode lost from the log');
  eq(r.out.response.mode, undefined, 'a merge was disclosed to the browser');
  eq(r.out.response.ok, true, 'merge not reported as a normal success');
});

check('a client retry after a known success makes zero extra Intake calls', () => {
  const first = run({});
  EVENTS = [];
  const again = H.handleSubmit({
    headers: { 'content-type': 'application/json' },
    body: body(),
    sessions: first.sessions,
    authority: first.authority,
    leadIntake: first.leadIntake,
    mirror: () => { EVENTS.push('mirror'); },
    clock: CLOCK
  });
  eq(first.leadIntake.calls.length, 1, 'a second Intake call was made');
  eq(again.response.lead_id, 'FIN-1756171200-042', 'the prior canonical success was not replayed');
  eq(again.log.idempotent_replay, true, 'replay not recorded');
  eq(again.log.counters.lead_intake_calls, 0, 'the replay counted an Intake call');
});

check('a confirmation retry resolves from authority when the session record lagged', () => {
  // The crash window: authority committed the lead, the session update never landed.
  const sessions = makeSessions({ submit_state: 'submitting', lead_id: '' });
  const authority = makeAuthority({ lead_id: 'FIN-COMMITTED-11', lead_cycle_id: CYCLE, consent: 'yes', consent_cycle_id: CYCLE });
  const r = run({}, { sessions, authority });
  eq(r.leadIntake.calls.length, 0, 'a duplicate Intake call was made after a lagging session');
  eq(r.out.response.lead_id, 'FIN-COMMITTED-11', 'the committed lead was not recovered');
  eq(r.out.log.resolved_from, 'authority', 'not resolved from authority');
  eq(r.sessions.row.submit_state, 'submitted', 'the lagging session was not converged');
});

check('a lead bound to an older cycle is not mistaken for this cycle result', () => {
  const authority = makeAuthority({ lead_id: 'FIN-LAST-CYCLE', lead_cycle_id: 'C-OLD' });
  const r = run({}, { authority });
  eq(r.leadIntake.calls.length, 1, 'the previous cycle lead suppressed a legitimate submit');
  eq(r.out.response.lead_id, 'FIN-1756171200-042', 'the stale lead was returned as this cycle result');
});

check('an ambiguous downstream outcome is not retried inside the same request', () => {
  const intake = makeIntake({ ambiguous: true });
  const r = run({}, { leadIntake: intake });
  eq(r.leadIntake.calls.length, 1, 'Intake was called more than once on ambiguity');
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'ambiguity not surfaced');
  eq(r.out.response.retryable, true, 'ambiguity not marked retryable');
  eq(r.sessions.row.submit_state, 'submitting', 'the ambiguous claim was released');
  eq(r.mirrored.length, 0, 'the read model was refreshed on an unresolved submit');
});

check('the retry after ambiguity resolves state first and makes zero extra Intake calls', () => {
  const sessions = makeSessions({ submit_state: 'submitting' });
  const intake = makeIntake({
    lookup: { ok: true, known: true, body: { ok: true, lead_id: 'FIN-RECOVERED-9', mode: 'new', priority: 'WARM', financial_zone: 'YELLOW' } }
  });
  const r = run({}, { sessions, leadIntake: intake });
  eq(r.leadIntake.calls.length, 0, 'a duplicate Intake call followed an ambiguous attempt');
  eq(r.leadIntake.lookups[0], AUTH_SUBMISSION_KEY, 'lookup used the wrong key');
  eq(r.out.response.lead_id, 'FIN-RECOVERED-9', 'the recovered lead was not returned');
  eq(r.out.log.resolved_from, 'lookup', 'not resolved via lookup');
});

check('a lookup that genuinely knows nothing permits exactly one fresh attempt', () => {
  const sessions = makeSessions({ submit_state: 'submitting' });
  const intake = makeIntake({ lookup: { ok: true, known: false } });
  const r = run({}, { sessions, leadIntake: intake });
  eq(r.leadIntake.calls.length, 1, 'the fresh attempt count is wrong');
  eq(r.out.response.lead_id, 'FIN-1756171200-042', 'the fresh attempt did not complete');
});

check('a lookup that cannot answer keeps the ambiguity rather than guessing', () => {
  const sessions = makeSessions({ submit_state: 'submitting' });
  const intake = makeIntake({ lookup: { ok: false } });
  const r = run({}, { sessions, leadIntake: intake });
  eq(r.leadIntake.calls.length, 0, 'Intake was called while the outcome was still unknown');
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'unresolved ambiguity not surfaced');
});

check('two concurrent submits cannot both reach Lead Intake', () => {
  const sessions = makeSessions();
  const authority = makeAuthority();
  const intake = makeIntake();
  // The competing request wins the claim first; this one must lose the compare-and-set.
  sessions.claim(SESSION_ID, { from: 'draft', to: 'submitting', patch: {} });
  const r = run({}, { sessions, authority, leadIntake: intake });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'the losing request was not held back');
  eq(intake.calls.length, 0, 'the losing request called Lead Intake');
});

check('a claim lost to a state change is refused as in progress', () => {
  const sessions = makeSessions();
  const original = sessions.claim.bind(sessions);
  sessions.claim = function (id, spec) {
    // Model the row moving under us between the read and the compare-and-set.
    sessions.row.submit_state = 'submitting';
    return original(id, spec);
  };
  const r = run({}, { sessions });
  eq(r.out.response.error_code, 'SUBMIT_IN_PROGRESS', 'a lost claim was not refused');
  eq(r.out.response.retryable, true, 'a lost claim is not retryable');
  eq(r.leadIntake.calls.length, 0, 'a lost claim still called Lead Intake');
});

// ------------------------------------------------- §9 error recovery

check('a downstream response without ok true is never treated as success', () => {
  const intake = makeIntake({ body: { ok: false, lead_id: 'FIN-NOT-REAL' } });
  const r = run({}, { leadIntake: intake });
  eq(r.out.ok, false, 'a non-ok downstream response was reported as success');
  eq(r.out.response.error_code, 'TEMPORARY_BACKEND_ERROR', 'wrong error code');
  eq(r.sessions.row.submit_state, 'retryable_error', 'the failed attempt was not made retryable');
  eq(r.authority.row.lead_id, '', 'a lead id was persisted from a failed call');
  eq(r.mirrored.length, 0, 'the read model was refreshed after a failure');
});

check('an ok response without a canonical lead id is a failure', () => {
  const intake = makeIntake({ body: { ok: true, mode: 'new' } });
  const r = run({}, { leadIntake: intake });
  eq(r.out.ok, false, 'an empty canonical result was accepted');
  eq(C.canonicalResultIsNull === undefined, true, 'contract shape changed unexpectedly');
  eq(H.canonicalResult({ ok: true, lead_id: '' }), null, 'blank lead id passed canonical checking');
});

check('a failed canonical persist does not report success to the client', () => {
  const a = makeAuthority(); a.failWrite = 'lead';
  const r = run({}, { authority: a });
  eq(r.out.ok, false, 'success reported without a committed binding');
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'wrong recovery code');
  eq(r.sessions.row.submit_state, 'submitting', 'the claim was released before recovery');
  eq(r.mirrored.length, 0, 'the read model mirrored an uncommitted binding');
});

check('a retryable_error may be retried and reaches exactly one Intake call', () => {
  const sessions = makeSessions({ submit_state: 'retryable_error' });
  const r = run({}, { sessions });
  eq(r.leadIntake.calls.length, 1, 'the retry Intake call count is wrong');
  eq(r.out.response.submit_state, 'submitted', 'the retry did not complete');
});

// ------------------------------------------------- authority-first ordering

check('the authoritative commit always precedes the derived mirror', () => {
  const r = run({});
  const leadWrite = r.events.indexOf('authority_write:lead');
  const mirror = r.events.indexOf('mirror');
  assert(leadWrite !== -1, 'the canonical lead never committed to authority');
  assert(mirror !== -1, 'the read model was never refreshed');
  assert(leadWrite < mirror, 'the read model was mirrored before the authoritative commit');
  eq(r.mirrored[0], CHAT, 'the mirror ran for the wrong chat');
});

check('the full happy-path effect order matches the §9 sequence', () => {
  const r = run({});
  const order = r.events.filter((e) => e !== 'session_claim' && e.indexOf('session_update') !== 0);
  eq(order.join(' -> '),
    'authority_write:consent -> intake_submit -> authority_write:lead -> mirror',
    'the submit sequence drifted from §9');
});

check('every branch reports its own side-effect counters', () => {
  eq(run({ consent: 'no' }).out.log.counters.lead_intake_calls, 0, 'NO counted an Intake call');
  eq(run({}).out.log.counters.lead_intake_calls, 1, 'the happy path counter is wrong');
  eq(run({}).out.log.counters.authority_writes, 2, 'the happy path authority write count is wrong');
  eq(run({}).out.log.counters.mirror_runs, 1, 'the happy path mirror count is wrong');
  const guard = run({}, { headers: { 'content-type': 'text/plain' } });
  eq(guard.out.log.counters.authority_writes, 0, 'a refused request wrote to authority');
});

// ------------------------------------- G1 durable idempotency recovery (N6.1)
//
// The threat model recorded that `leadIntake.lookup` is an injected capability with no
// backing store in this repository, and that without it an interrupted submit stranded its
// (user, cycle) at SUBMIT_UNRESOLVED forever. These checks prove the STATE MACHINE around
// that capability. They do not, and cannot, prove that durable production idempotency
// exists -- no offline double can establish durability of a store that is not written yet.

console.log('\nG1. RECOVERY ADAPTER STATE MACHINE');

// An Intake double with no lookup at all: the repository's actual situation today.
function makeIntakeNoLookup() {
  const i = makeIntake();
  delete i.lookup;
  return i;
}

const INTERRUPTED = { submit_state: 'submitting', idempotency_key: 'miniapp:' + CHAT + ':' + CYCLE };
const PRIOR_BODY = { ok: true, lead_id: 'FIN-1756000000-777', mode: 'merged', priority: 'HOT', financial_zone: 'RED' };

check('(a) a prior committed submit is found by lookup and returned without a second call', () => {
  const r = run({}, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntake({ lookup: { ok: true, known: true, body: PRIOR_BODY } })
  });
  assert(r.out.ok, 'a recoverable prior commit was not returned');
  eq(r.out.response.lead_id, 'FIN-1756000000-777', 'the prior canonical lead was not returned');
  eq(r.leadIntake.calls.length, 0, 'a second Lead Intake call was made after recovery');
  eq(r.out.log.resolved_from, 'lookup', 'recovery was not attributed to the lookup');
  eq(r.out.log.idempotent_replay, true, 'a recovered submit was not marked as a replay');
});

check('(b) a prior submit the downstream never created permits exactly one fresh attempt', () => {
  const r = run({}, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntake({ lookup: { ok: true, known: false } })
  });
  assert(r.out.ok, 'a provably-uncommitted attempt was not allowed to retry');
  eq(r.leadIntake.calls.length, 1, 'the fresh attempt did not make exactly one Intake call');
  eq(r.sessions.row.submit_state, 'submitted', 'the retry did not reach submitted');
});

check('(c) an absent recovery adapter blocks rather than stranding the submission', () => {
  const r = run({}, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntakeNoLookup()
  });
  assert(!r.out.ok, 'an unrecoverable interrupted submit was accepted');
  eq(r.out.response.error_code, 'PRE_ACTIVATION_BLOCKED', 'the deployment fault was reported as something else');
  eq(r.out.response.retryable, true, 'the client was told to give up on a recoverable submission');
  eq(r.out.log.stage, 'RECOVERY_ADAPTER_MISSING', 'the blocking reason was not named');
  // The claim is preserved: releasing it would permit a duplicate for an unknown outcome.
  eq(r.sessions.row.submit_state, 'submitting', 'the blocked path released the claim');
  eq(r.leadIntake.calls.length, 0, 'a blocked submission still called Lead Intake');
  eq(r.authority.stats.writes, 0, 'a blocked submission wrote to authority');
});

check('(c2) a blocked interrupted submit is still recoverable by an operator authority write', () => {
  // The documented recovery: an operator writes the canonical binding to Bot_Sessions.
  // The authority branch then resolves it on the next attempt, with no adapter involved.
  const sessions = makeSessions(INTERRUPTED);
  const blocked = run({}, { sessions, leadIntake: makeIntakeNoLookup() });
  eq(blocked.out.response.error_code, 'PRE_ACTIVATION_BLOCKED', 'precondition: not blocked');

  const authority = makeAuthority({ lead_id: 'FIN-OPERATOR-BOUND', lead_cycle_id: CYCLE });
  const after = run({}, { sessions, authority, leadIntake: makeIntakeNoLookup() });
  assert(after.out.ok, 'an operator-bound lead did not recover the submission');
  eq(after.out.response.lead_id, 'FIN-OPERATOR-BOUND', 'the operator binding was not returned');
  eq(after.leadIntake.calls.length, 0, 'recovery made a Lead Intake call');
});

check('(d) a lookup that errors preserves ambiguity and the claim', () => {
  const r = run({}, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntake({ lookup: { ok: false } })
  });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'a lookup error was not reported as unresolved');
  eq(r.out.log.detail, 'CANNOT_ANSWER', 'the lookup answer was not recorded');
  eq(r.sessions.row.submit_state, 'submitting', 'an unanswered lookup released the claim');
  eq(r.leadIntake.calls.length, 0, 'an unanswered lookup was followed by a submit');
});

check('(d2) a lookup that knows a record but cannot name it never releases the claim', () => {
  // `known: true` asserts something exists. A body with no canonical lead id therefore means
  // "created but unnameable" -- ambiguity, not absence. Releasing here would duplicate.
  const r = run({}, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntake({ lookup: { ok: true, known: true, body: { ok: true, lead_id: '' } } })
  });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'an unusable known record was not treated as ambiguous');
  eq(r.out.log.detail, 'KNOWN_UNUSABLE_BODY', 'the unusable-body answer was not recorded');
  eq(r.leadIntake.calls.length, 0, 'an unusable known record triggered a duplicate submit');
  eq(r.sessions.row.submit_state, 'submitting', 'an unusable known record released the claim');
});

check('(e) an ambiguous downstream outcome leaves the claim in place for the resolver', () => {
  const r = run({}, { leadIntake: makeIntake({ ambiguous: true }) });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'ambiguity was not reported as unresolved');
  eq(r.sessions.row.submit_state, 'submitting', 'ambiguity did not leave the claim for the resolver');
  eq(r.leadIntake.calls.length, 1, 'ambiguity was retried inside the same request');
});

check('(f) a retry after a known commit makes zero further Intake calls', () => {
  const sessions = makeSessions();
  const first = run({}, { sessions });
  eq(first.leadIntake.calls.length, 1, 'precondition: the first submit did not call Intake once');
  const retry = run({}, { sessions, leadIntake: makeIntake({ lookup: { ok: false } }) });
  assert(retry.out.ok, 'the retry after a known commit was refused');
  eq(retry.out.response.lead_id, first.out.response.lead_id, 'the retry returned a different lead');
  eq(retry.leadIntake.calls.length, 0, 'the retry called Lead Intake again');
  eq(retry.leadIntake.lookups.length, 0, 'the retry consulted lookup despite knowing the answer');
});

check('(g) a retry after a proven non-commit makes exactly one Intake call', () => {
  const sessions = makeSessions(INTERRUPTED);
  const r = run({}, { sessions, leadIntake: makeIntake({ lookup: { ok: true, known: false } }) });
  eq(r.leadIntake.lookups.length, 1, 'the retry did not consult the recovery adapter');
  eq(r.leadIntake.calls.length, 1, 'a proven non-commit did not produce exactly one attempt');
});

check('(h) a caller-supplied request_id cannot steer which submission is recovered', () => {
  const r = run({ request_id: 'miniapp:999999999:C-ATTACKER' }, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntake({ lookup: { ok: true, known: true, body: PRIOR_BODY } })
  });
  eq(r.leadIntake.lookups.length, 1, 'the adapter was not consulted');
  eq(r.leadIntake.lookups[0], AUTH_SUBMISSION_KEY, 'the caller steered the lookup key');
  assert(r.out.log.untrusted_fields_ignored.indexOf('request_id') !== -1,
    'the hostile request_id was not recorded as ignored');
});

check('(i) a caller-supplied lead_id cannot satisfy a recovery', () => {
  const r = run({ lead_id: 'FIN-ATTACKER-0001' }, {
    sessions: makeSessions(INTERRUPTED),
    leadIntake: makeIntake({ lookup: { ok: false } })
  });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'a caller lead_id resolved an ambiguous submit');
  assert(!Object.prototype.hasOwnProperty.call(r.out.response, 'lead_id'),
    'an error response carried a lead_id');
  eq(JSON.stringify(r.out).indexOf('FIN-ATTACKER-0001'), -1, 'the caller lead_id survived anywhere in the result');
});

check('a fresh submit is refused outright when no recovery adapter is deployed', () => {
  // The structural half of the blocker: with no way to recover an ambiguous outcome, no
  // irreversible handoff is started, so an unrecoverable state cannot be created at all.
  const r = run({}, { leadIntake: makeIntakeNoLookup() });
  assert(!r.out.ok, 'an irreversible submit was started with no recovery path');
  eq(r.out.response.error_code, 'PRE_ACTIVATION_BLOCKED', 'the blocker did not fire on a fresh submit');
  eq(r.authority.stats.writes, 0, 'the blocked submit stamped consent to authority');
  eq(r.sessions.stats.claims, 0, 'the blocked submit claimed the session');
  eq(r.out.log.counters.lead_intake_calls, 0, 'the blocked submit called Lead Intake');
});

check('consent NO still works with no recovery adapter, because it risks nothing', () => {
  const r = run({ consent: 'no' }, { leadIntake: makeIntakeNoLookup() });
  assert(r.out.ok, 'a zero-effect consent NO was blocked by the adapter guard');
  eq(r.out.log.counters.lead_intake_calls, 0, 'consent NO called Lead Intake');
  eq(r.out.log.counters.authority_writes, 0, 'consent NO wrote to authority');
});

check('the recovery adapter contract is declared, not left implicit', () => {
  const k = C.RECOVERY_ADAPTER_CONTRACT;
  eq(k.method, 'leadIntake.lookup', 'the required adapter is not named');
  eq(k.key_shape, 'miniapp:<telegram_user_id>:<cycle_id>', 'the stable key shape drifted');
  assert(k.requirements.length >= 5, 'the adapter requirements were thinned out');
  eq(C.recoveryAdapterStatus(null).available, false, 'a null client was reported as available');
  eq(C.recoveryAdapterStatus({}).available, false, 'a client with no lookup was reported as available');
  eq(C.recoveryAdapterStatus({ lookup: () => ({}) }).available, true, 'a real lookup was not detected');
  eq(C.STATUS.PRE_ACTIVATION_BLOCKED, 503, 'the blocked status code drifted');
});

// ------------------------------------- G2 cycle reset racing an in-flight submit (N6.1)
//
// The invariant: no irreversible Lead Intake handoff unless the authoritative cycle being
// submitted is still the cycle that owns this operation's claim.

console.log('\nG2. CYCLE RESET DURING AN IN-FLIGHT SUBMIT');

const NEW_CYCLE = 'C-2026-08-26-02';

// Authority whose row can be mutated between reads, which is how a Concierge cycle reset
// landing mid-handler is modelled: read 1 is the §9.2 cycle read, read 2 is the guard.
function makeRacingAuthority(mutateAfterRead, mutation, initial) {
  const a = makeAuthority(initial);
  const inner = a.read.bind(a);
  let n = 0;
  a.read = function (chatId) {
    n++;
    const out = inner(chatId);
    if (n === mutateAfterRead) { Object.assign(a.row, mutation); }
    return out;
  };
  return a;
}

check('(1) an unchanged cycle proceeds through the guard to exactly one handoff', () => {
  const r = run({});
  assert(r.out.ok, 'an unchanged cycle was refused');
  eq(r.out.log.counters.handoff_guards, 1, 'the pre-handoff guard did not run');
  eq(r.leadIntake.calls.length, 1, 'the happy path did not make exactly one Intake call');
  eq(r.authority.row.lead_cycle_id, CYCLE, 'the lead was bound to the wrong cycle');
});

check('(2) a cycle reset before the handoff stops the submit with no Intake call', () => {
  const authority = makeRacingAuthority(1, { cycle_id: NEW_CYCLE });
  const r = run({}, { authority });
  assert(!r.out.ok, 'a submit on a superseded cycle was accepted');
  eq(r.out.response.error_code, 'CYCLE_SUPERSEDED', 'the reset was not reported as superseded');
  eq(r.out.log.stage, 'CYCLE_RESET_IN_FLIGHT', 'the reset stage was not named');
  eq(r.leadIntake.calls.length, 0, 'the stale request handed off to Lead Intake');
  eq(r.out.log.counters.handoff_guards, 1, 'the guard did not run');
});

check('(2b) a cycle reset binds no lead and leaves the new cycle untouched', () => {
  const authority = makeRacingAuthority(1, { cycle_id: NEW_CYCLE });
  const r = run({}, { authority });
  eq(authority.row.cycle_id, NEW_CYCLE, 'the stale request mutated the new cycle');
  eq(C.normValue(authority.row.lead_id), '', 'a lead was bound during a cycle reset');
  eq(C.normValue(authority.row.lead_cycle_id), '', 'a lead cycle was bound during a cycle reset');
  // The consent stamp written before the reset belongs to the OLD cycle and must not be
  // readable as consent for the new one.
  assert(C.normValue(authority.row.consent_cycle_id) !== NEW_CYCLE,
    'the stale consent stamp was carried onto the new cycle');
  eq(r.out.log.counters.mirror_runs, 0, 'the derived read model was refreshed for a refused submit');
});

check('(3) a session re-bound to the new cycle is refused at the guard', () => {
  const sessions = makeSessions();
  const authority = makeAuthority();
  const inner = sessions.read.bind(sessions);
  let n = 0;
  sessions.read = function (id) {
    n++;
    // The first read is §9.1. By the guard's read the session has been re-bound, which is
    // what §6 requires to happen when the authoritative cycle changes.
    if (n >= 2) { sessions.row.cycle_id = NEW_CYCLE; }
    return inner(id);
  };
  const r = run({}, { sessions, authority });
  assert(!r.out.ok, 'a re-bound session was allowed to hand off');
  eq(r.out.response.error_code, 'CYCLE_SUPERSEDED', 'a re-bound session was not reported as superseded');
  eq(r.out.log.stage, 'SESSION_REBOUND', 'the re-bind stage was not named');
  eq(r.leadIntake.calls.length, 0, 'a re-bound session handed off to Lead Intake');
});

check('(4) an operation whose claim was taken over does not hand off', () => {
  const sessions = makeSessions();
  const inner = sessions.read.bind(sessions);
  let n = 0;
  sessions.read = function (id) {
    n++;
    // Between the claim and the guard, another operation takes ownership of the claim.
    if (n >= 2) { sessions.row.claim_owner = 'other-operation-correlation-id'; }
    return inner(id);
  };
  const r = run({}, { sessions });
  assert(!r.out.ok, 'an operation handed off using another operation\'s claim');
  eq(r.out.response.error_code, 'SUBMIT_IN_PROGRESS', 'a reassigned claim was not reported as in progress');
  eq(r.out.log.stage, 'CLAIM_REASSIGNED', 'the claim takeover stage was not named');
  eq(r.leadIntake.calls.length, 0, 'a reassigned claim still reached Lead Intake');
});

check('(4b) an illegal submit_state at the moment of handoff is refused', () => {
  const sessions = makeSessions();
  const inner = sessions.read.bind(sessions);
  let n = 0;
  sessions.read = function (id) {
    n++;
    if (n >= 2) { sessions.row.submit_state = 'submitted'; }
    return inner(id);
  };
  const r = run({}, { sessions });
  assert(!r.out.ok, 'a handoff proceeded from an illegal state');
  eq(r.out.log.stage, 'HANDOFF_STATE_ILLEGAL', 'the illegal-state stage was not named');
  eq(r.leadIntake.calls.length, 0, 'an illegal state still reached Lead Intake');
});

check('(4c) consent withdrawn between the stamp and the handoff stops the submit', () => {
  const authority = makeRacingAuthority(1, { consent: 'no', consent_cycle_id: '' });
  // The consent write lands after read 1, so force the withdrawal to survive it.
  const innerWrite = authority.write.bind(authority);
  let wrote = 0;
  authority.write = function (chatId, patch) {
    const out = innerWrite(chatId, patch);
    wrote++;
    if (wrote === 1) { authority.row.consent = 'no'; authority.row.consent_cycle_id = ''; }
    return out;
  };
  const r = run({}, { authority });
  assert(!r.out.ok, 'a submit proceeded without current consent at the handoff');
  eq(r.out.response.error_code, 'CONSENT_STALE_CYCLE', 'withdrawn consent was not reported correctly');
  eq(r.out.log.stage, 'CONSENT_INVALID_AT_HANDOFF', 'the consent-at-handoff stage was not named');
  eq(r.leadIntake.calls.length, 0, 'a submit without consent reached Lead Intake');
});

check('(5) a refused stale request writes nothing at all after the guard fails', () => {
  const authority = makeRacingAuthority(1, { cycle_id: NEW_CYCLE });
  const sessions = makeSessions();
  const r = run({}, { authority, sessions });
  // One authority write (the consent stamp, before the reset was observable) and one
  // session claim. Nothing after the guard: no lead write, no state change, no release.
  eq(r.out.log.counters.authority_writes, 1, 'the refused request wrote to authority after the guard');
  eq(sessions.row.submit_state, 'submitting', 'the stale request mutated the claim it no longer owned');
  eq(sessions.stats.updates, 0, 'the stale request updated the session after the guard failed');
  eq(r.out.log.counters.lead_intake_calls, 0, 'the refused request called Lead Intake');
});

check('(6) reversed completion order: the later operation owns the claim and the earlier stands down', () => {
  // A claims first; B then takes the claim; A reaches its guard last. A must not hand off,
  // and B's ownership must survive A's refusal.
  const sessions = makeSessions();
  const inner = sessions.read.bind(sessions);
  let n = 0;
  sessions.read = function (id) {
    n++;
    if (n >= 2) { sessions.row.claim_owner = 'operation-B'; }
    return inner(id);
  };
  const a = run({}, { sessions });
  assert(!a.out.ok, 'the earlier operation handed off after being superseded');
  eq(sessions.row.claim_owner, 'operation-B', 'the earlier operation clobbered the later claim');
  eq(sessions.row.submit_state, 'submitting', 'the earlier operation released the later claim');
  eq(a.leadIntake.calls.length, 0, 'the superseded operation called Lead Intake');
});

check('(7) a submit on the new cycle still succeeds after the stale one is rejected', () => {
  const authority = makeRacingAuthority(1, { cycle_id: NEW_CYCLE });
  const stale = run({}, { authority });
  eq(stale.out.response.error_code, 'CYCLE_SUPERSEDED', 'precondition: the stale submit was not rejected');

  // The client re-bootstraps: a fresh session bound to the new cycle, fresh authority state.
  const fresh = run({}, {
    sessions: makeSessions({ cycle_id: NEW_CYCLE }),
    authority: makeAuthority({ cycle_id: NEW_CYCLE })
  });
  assert(fresh.out.ok, 'the new-cycle submit was refused after a stale rejection');
  eq(fresh.leadIntake.calls.length, 1, 'the new-cycle submit did not make exactly one Intake call');
  eq(fresh.authority.row.lead_cycle_id, NEW_CYCLE, 'the new lead was bound to the wrong cycle');
  eq(fresh.authority.row.consent_cycle_id, NEW_CYCLE, 'consent was stamped for the wrong cycle');
});

check('the guard runs on every path that reaches a handoff, and only there', () => {
  eq(run({}).out.log.counters.handoff_guards, 1, 'the happy path skipped the guard');
  eq(run({ consent: 'no' }).out.log.counters.handoff_guards, 0, 'consent NO ran a handoff guard');
  const blocked = run({}, { leadIntake: makeIntakeNoLookup() });
  eq(blocked.out.log.counters.handoff_guards, 0, 'a blocked submit ran a handoff guard');
  const replay = run({}, { sessions: makeSessions({ submit_state: 'submitted', lead_id: 'FIN-X' }) });
  eq(replay.out.log.counters.handoff_guards, 0, 'an idempotent replay ran a handoff guard');
});


// ------------------------------------- G3 no throw leaves the handler (N6.2)
//
// Every client is injected, so every client can throw: an HTTP node raising on a 5xx, a
// Sheets client raising on a quota error, a Data Table client raising on a closed table.
// The defect was that any of them turned an in-flight submit into an unhandled node error.
// The fix is not "catch everything and return 503" -- that would be worse than the throw,
// because a throw from inside the Lead Intake call and a throw before it need OPPOSITE
// answers. These checks pin that distinction.

const CID = 'CID-N62-FIXED';
const COUNTER_KEYS = [
  'lead_intake_calls', 'lead_intake_lookups', 'authority_writes',
  'session_writes', 'mirror_runs', 'handoff_guards', 'mirror_failures'
];

function makeThrowingSessionRead() {
  const sessions = makeSessions();
  // The message deliberately carries the chat id, so a leak into the response or the log
  // is detectable rather than theoretical.
  sessions.read = () => { throw new Error('sheets quota exceeded for chat ' + CHAT); };
  return sessions;
}

function makeThrowingIntakeSubmit() {
  const intake = makeIntake();
  intake.submit = () => { throw new Error('ECONNRESET https://n8n.invalid/webhook/lead-intake'); };
  return intake;
}

function makeThrowingLeadWrite() {
  const authority = makeAuthority();
  const original = authority.write;
  authority.write = function (chatId, patch) {
    if (patch.lead_id !== undefined) { throw new Error('authority write exploded'); }
    return original.call(this, chatId, patch);
  };
  return authority;
}

check('(G3) a mirror that throws leaves the submit successful, not unresolved', () => {
  const r = run({}, { mirrorThrows: true });
  eq(r.out.ok, true, 'a derived-refresh failure was allowed to fail the submit');
  eq(r.out.status_code, 200, 'status downgraded by a derived failure');
  eq(r.out.response.ok, true, 'the client was told a committed submit had failed');
  assert(r.out.response.lead_id !== '', 'the canonical lead id was withheld');
  eq(r.out.log.counters.mirror_failures, 1, 'the mirror failure was not recorded');
  eq(r.out.log.counters.mirror_runs, 0, 'a throwing mirror was counted as a run');
});

check('(G3) the authoritative commit survives a throwing mirror intact', () => {
  const r = run({}, { mirrorThrows: true });
  eq(r.authority.row.lead_id, 'FIN-1756171200-042', 'the authority binding was lost');
  eq(r.authority.row.lead_cycle_id, CYCLE, 'the cycle binding was lost');
  eq(r.sessions.row.submit_state, 'submitted', 'the session was not moved to submitted');
  eq(r.leadIntake.calls.length, 1, 'the mirror failure changed the Intake call count');
});

check('(G3) a throw BEFORE the handoff is a plain retryable backend error', () => {
  const r = run({}, { sessions: makeThrowingSessionRead(), correlationId: CID });
  eq(r.out.ok, false, 'a thrown client produced a success');
  eq(r.out.status_code, 503, 'wrong transport status for an uncaught throw');
  eq(r.out.response.error_code, 'TEMPORARY_BACKEND_ERROR', 'wrong code before the handoff');
  eq(r.out.response.retryable, true, 'a safely retryable condition was marked final');
  eq(r.out.log.stage, 'UNCAUGHT_BEFORE_HANDOFF', 'the throw site was not classified');
  eq(r.leadIntake.calls.length, 0, 'a Lead Intake call happened on a pre-handoff throw');
  eq(r.authority.stats.writes, 0, 'a pre-handoff throw wrote to authority');
});

check('(G3) a throw AT the handoff is SUBMIT_UNRESOLVED, never a retryable error', () => {
  const r = run({}, { leadIntake: makeThrowingIntakeSubmit(), correlationId: CID });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'a possible lead was reported as retryable');
  eq(r.out.log.stage, 'UNCAUGHT_AFTER_HANDOFF', 'the throw site was not classified');
  // The whole reason the marker exists: the counter is incremented only once the call has
  // RETURNED, so on a throw from inside submit() it still reads zero and cannot classify.
  eq(r.out.log.counters.lead_intake_calls, 0, 'the fixture no longer exercises the marker');
});

check('(G3) a throw at the handoff preserves the claim and the submitting state', () => {
  const r = run({}, { leadIntake: makeThrowingIntakeSubmit(), correlationId: CID });
  eq(r.sessions.row.submit_state, 'submitting', 'the state was downgraded after a possible lead');
  eq(r.sessions.row.claim_owner, CID, 'the claim owner was cleared by the catch');
  eq(r.sessions.row.idempotency_key, 'miniapp:' + CHAT + ':' + CYCLE, 'the claim key was lost');
});

check('(G3) a throw AFTER the Intake call returns is also unresolved', () => {
  const r = run({}, { authority: makeThrowingLeadWrite(), correlationId: CID });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'a committed lead was reported as retryable');
  eq(r.out.log.stage, 'UNCAUGHT_AFTER_HANDOFF', 'the throw site was not classified');
  eq(r.leadIntake.calls.length, 1, 'the lead was never actually created in this fixture');
  eq(r.sessions.row.submit_state, 'submitting', 'the state was downgraded after a real lead');
});

check('(G3) the two throw sites get opposite answers, which is the point', () => {
  const before = run({}, { sessions: makeThrowingSessionRead(), correlationId: CID });
  const after = run({}, { leadIntake: makeThrowingIntakeSubmit(), correlationId: CID });
  assert(before.out.response.error_code !== after.out.response.error_code,
    'a blanket catch would collapse both throw sites into one answer');
  eq(before.out.response.error_code, 'TEMPORARY_BACKEND_ERROR', 'pre-handoff answer drifted');
  eq(after.out.response.error_code, 'SUBMIT_UNRESOLVED', 'post-handoff answer drifted');
});

check('(G3) a thrown value never reaches the response or the log', () => {
  const r = run({}, { sessions: makeThrowingSessionRead(), correlationId: CID });
  const serialised = JSON.stringify(r.out);
  assert(serialised.indexOf(CHAT) === -1, 'the thrown message leaked the chat id');
  assert(serialised.indexOf('quota') === -1, 'the thrown message reached the caller or the log');
  const r2 = run({}, { leadIntake: makeThrowingIntakeSubmit(), correlationId: CID });
  const serialised2 = JSON.stringify(r2.out);
  assert(serialised2.indexOf('n8n.invalid') === -1, 'the thrown message leaked an internal URL');
  assert(serialised2.indexOf('ECONNRESET') === -1, 'a downstream diagnostic reached the caller');
});

check('(G3) a caught throw still returns the full accounting block', () => {
  const r = run({}, { sessions: makeThrowingSessionRead(), correlationId: CID });
  eq(r.out.log.correlation_id, CID, 'the correlation id was lost on the thrown path');
  COUNTER_KEYS.forEach((k) => {
    assert(Object.prototype.hasOwnProperty.call(r.out.log.counters, k),
      'counter ' + k + ' is missing from a caught-throw response');
  });
});

// ------------------------------------- G6 the classification survives a retry (N6.2)

const MERGED_BODY = { ok: true, lead_id: 'FIN-G6-0001', mode: 'merged', priority: 'HOT', financial_zone: 'RED' };
const MERGED_BODY_TB1 = { ok: true, lead_id: 'FIN-G6-TB1', mode: 'merged', priority: 'HOT', financial_zone: 'RED' };

check('(G6) a successful submit persists the classification to AUTHORITY', () => {
  const authority = makeAuthority();
  const r = run({}, { authority, leadIntake: makeIntake({ body: MERGED_BODY }) });
  eq(r.out.log.lead_mode, 'merged', 'the live classification was not recorded');
  eq(r.out.response.mode, undefined, 'a merge was disclosed to the browser');
  eq(authority.row.lead_mode, 'merged', 'authority never learned the mode');
  eq(authority.row.lead_priority, 'HOT', 'authority never learned the priority');
  eq(authority.row.financial_zone, 'RED', 'authority never learned the financial zone');
});

check('(G6) a retry resolved from authority returns the REAL classification', () => {
  const authority = makeAuthority();
  run({}, { authority, leadIntake: makeIntake({ body: MERGED_BODY }) });
  // The session lagged behind the authoritative commit -- a crash between the two writes.
  const r = run({}, { authority, sessions: makeSessions(), leadIntake: makeIntake({ body: MERGED_BODY }) });
  eq(r.out.log.resolved_from, 'authority', 'the fixture no longer exercises the authority branch');
  eq(r.leadIntake.calls.length, 0, 'a replay called Lead Intake again');
  eq(r.out.log.lead_mode, 'merged', 'the recovered mode was not recorded on the replay');
  eq(r.out.response.mode, undefined, 'a merge was disclosed to the browser on replay');
  eq(r.out.response.priority, 'HOT', 'the priority was replaced by the clamp default');
  eq(r.out.response.financial_zone, 'RED', 'the financial zone was replaced by the clamp default');
  eq(r.out.log.classification_recovered, true, 'a recovered classification was reported as absent');
});

check('(G6) an authority row with no classification says so instead of guessing', () => {
  const authority = makeAuthority({ lead_id: 'FIN-LEGACY-0001', lead_cycle_id: CYCLE });
  const r = run({}, { authority, sessions: makeSessions() });
  eq(r.out.log.resolved_from, 'authority', 'the fixture no longer exercises the authority branch');
  eq(r.out.log.classification_recovered, false, 'a clamp default was reported as a recovered value');
  // The response still carries the defaults, because the contract's mode vocabulary has no
  // unknown member. What changed is that the log no longer presents them as recovered.
  eq(r.out.response.lead_id, 'FIN-LEGACY-0001', 'the canonical lead id was not recovered');
  eq(r.out.log.lead_mode, '', 'an absent mode was reported as a value');
  eq(r.out.log.lead_mode_known, false, 'an absent mode was reported as a known vocabulary value');
  eq(r.out.response.priority, 'COLD', 'the clamp default drifted');
  eq(r.out.response.financial_zone, 'UNKNOWN', 'the clamp default drifted');
});

// ------------------------------------- G7 request_id is not a dedup key (N6.2)

function makeFlakyIntake() {
  let n = 0;
  const intake = makeIntake();
  intake.submit = function (req) {
    this.calls.push(req);
    EVENTS.push('intake_submit');
    n++;
    // First attempt fails recoverably, so a second attempt genuinely reaches the call and
    // two real envelopes can be compared.
    if (n === 1) { return { ok: true, body: { ok: false } }; }
    return { ok: true, body: { ok: true, lead_id: 'FIN-G7-0001', mode: 'new', priority: 'WARM', financial_zone: 'YELLOW' } };
  };
  return intake;
}

check('(G7) two attempts share one idempotency key and carry different request_ids', () => {
  const sessions = makeSessions();
  const authority = makeAuthority();
  const leadIntake = makeFlakyIntake();
  const first = run({}, { sessions, authority, leadIntake });
  eq(first.out.response.error_code, 'TEMPORARY_BACKEND_ERROR', 'the fixture no longer fails first');
  const second = run({}, { sessions, authority, leadIntake });
  eq(second.out.response.ok, true, 'the retry did not succeed');
  eq(leadIntake.calls.length, 2, 'the fixture no longer produces two real attempts');
  eq(leadIntake.calls[0].idempotency_key, leadIntake.calls[1].idempotency_key,
    'the idempotency key is not stable across attempts');
  const a = leadIntake.calls[0].envelope.payload.meta.request_id;
  const b = leadIntake.calls[1].envelope.payload.meta.request_id;
  assert(a !== b, 'request_id was stable across attempts, which would invite it to be read as a dedup key');
});

check('(G7) the outbound envelope carries no idempotency key at all', () => {
  // This is the G1 precondition stated as a test rather than as prose: nothing downstream
  // can be indexed by the stable key, because the stable key never travels with the payload.
  const r = run({});
  const call = r.leadIntake.calls[0];
  assert(call.idempotency_key !== undefined, 'the key is not passed beside the envelope any more');
  const keys = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    Object.keys(node).forEach((k) => { keys.push(k); walk(node[k]); });
  }(call.envelope));
  assert(keys.indexOf('idempotency_key') === -1, 'the envelope now carries an idempotency key');
  assert(keys.indexOf('idempotency-key') === -1, 'the envelope now carries an idempotency key');
});

check('(G7) the request_id semantics are a declared contract, not a comment', () => {
  const d = C.REQUEST_ID_SEMANTICS;
  assert(d && typeof d === 'object', 'REQUEST_ID_SEMANTICS is not exported');
  eq(d.field, 'meta.request_id', 'the declared field drifted');
  eq(d.is_deduplication_key, false, 'request_id was declared a deduplication key');
  eq(d.stable_across_attempts, false, 'request_id was declared stable across attempts');
  eq(d.downstream_idempotency_key_present, false,
    'the declaration claims a downstream key exists -- if that became true, G1 is buildable and this must be revisited');
});

// ------------------------------------- T32 / T25 open test recommendations (N6.2)

check('(T32) submitted with no canonical lead anywhere is never downgraded', () => {
  const sessions = makeSessions({ submit_state: 'submitted', lead_id: '' });
  const leadIntake = makeIntake({ lookup: { ok: true, known: false } });
  const r = run({}, { sessions, leadIntake });
  eq(r.out.response.error_code, 'SUBMIT_UNRESOLVED', 'an illegal state was resolved rather than reported');
  eq(r.out.log.detail, 'NOT_COMMITTED', 'the lookup answer was not recorded');
  eq(r.sessions.row.submit_state, 'submitted', 'a terminal state was moved backwards');
  eq(r.leadIntake.calls.length, 0, 'a lead was created for a session already claiming submitted');
  eq(r.out.log.counters.authority_writes, 0, 'an illegal state wrote to authority');
  eq(r.out.log.counters.session_writes, 0, 'an illegal state wrote to the session store');
});

check('(T25) no analytics identifier ever reaches the Lead Intake envelope', () => {
  const r = run({});
  const keys = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    Object.keys(node).forEach((k) => { keys.push(k); walk(node[k]); });
  }(r.leadIntake.calls[0].envelope));
  const analytics = keys.filter((k) => /^ga_/.test(k) || k === 'analytics_consent' ||
    k === 'client_id' || k === 'session_id' || k === 'measurement_id');
  eq(analytics.length, 0, 'analytics identifiers reached the envelope: ' + analytics.join(', '));
});


// ------------------------------- OWNER DECISION: mode must not cross TB-1 (N6.2)
//
// The rule: the browser must not be able to determine from the response whether its lead was
// new, merged, a retry or a duplicate. Gateway contract §9 used to define `mode` in the
// success body while also requiring that the UI not disclose duplication -- a field in the
// body is readable in devtools whatever the UI renders, so the two could not both hold.
//
// These checks cover every branch that returns a body, because "not in the happy path" is
// not the same guarantee as "not anywhere".

console.log('\nMODE CLIENT EXPOSURE');

function responseKeysDeep(obj) {
  const keys = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    Object.keys(node).forEach((k) => { keys.push(k); walk(node[k]); });
  }(obj));
  return keys;
}

function assertNoModeAnywhere(response, where) {
  const keys = responseKeysDeep(response);
  assert(keys.indexOf('mode') === -1, 'mode reached the browser in ' + where);
  assert(keys.indexOf('lead_mode') === -1, 'lead_mode reached the browser in ' + where);
  eq(C.responseLeaks(response).length, 0, where + ' leaked ' + C.responseLeaks(response).join(','));
}

check('mode is not in the client whitelist, and is actively refused', () => {
  eq(C.CLIENT_RESPONSE_FIELDS.indexOf('mode'), -1, 'mode is still a client response field');
  eq(C.CLIENT_RESPONSE_FIELDS.length, 5, 'the client whitelist is not the expected five fields');
  // Omission and refusal are different guarantees. This is the refusal.
  assert(C.RESPONSE_FORBIDDEN_KEYS.indexOf('mode') !== -1, 'mode is not a forbidden response key');
  assert(C.RESPONSE_FORBIDDEN_KEYS.indexOf('lead_mode') !== -1, 'lead_mode is not a forbidden response key');
  eq(C.responseLeaks({ ok: true, mode: 'merged' }).join(','), 'mode', 'a response carrying mode was not flagged');
  eq(C.responseLeaks({ ok: true, meta: { detail: { lead_mode: 'merged' } } }).join(','), 'lead_mode',
    'a NESTED lead_mode was not flagged');
});

check('buildSubmitSuccess cannot emit mode even when handed one', () => {
  const out = C.buildSubmitSuccess({ lead_id: 'FIN-X', mode: 'merged', priority: 'HOT', financial_zone: 'RED' });
  eq(out.mode, undefined, 'buildSubmitSuccess still emits mode');
  eq(Object.keys(out).sort().join(','), C.CLIENT_RESPONSE_FIELDS.slice().sort().join(','),
    'the success body is not exactly the whitelist');
  // The rest of the classification is unaffected -- this decision is about mode only.
  eq(out.priority, 'HOT', 'priority was lost with mode');
  eq(out.financial_zone, 'RED', 'financial zone was lost with mode');
});

check('no branch that returns a body discloses mode', () => {
  assertNoModeAnywhere(run({}).out.response, 'a fresh success');
  assertNoModeAnywhere(run({}, { leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) }).out.response, 'a merged success');
  assertNoModeAnywhere(run({ consent: 'no' }).out.response, 'a consent-NO accept');
  assertNoModeAnywhere(run({ answers: Object.assign({}, GOOD_ANSWERS, { sector: 'banking' }) }).out.response, 'a validation error');
  assertNoModeAnywhere(run({}, { leadIntake: makeIntake({ ambiguous: true }) }).out.response, 'an ambiguous outcome');
});

check('no REPLAY branch discloses mode, whichever source resolved it', () => {
  // session
  const fromSession = run({}, { sessions: makeSessions({ submit_state: 'submitted', lead_id: 'FIN-S', mode: 'merged' }) });
  eq(fromSession.out.log.resolved_from, 'session', 'fixture drifted off the session branch');
  assertNoModeAnywhere(fromSession.out.response, 'a session-resolved replay');

  // authority
  const authority = makeAuthority();
  run({}, { authority, leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) });
  const fromAuthority = run({}, { authority, sessions: makeSessions(), leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) });
  eq(fromAuthority.out.log.resolved_from, 'authority', 'fixture drifted off the authority branch');
  assertNoModeAnywhere(fromAuthority.out.response, 'an authority-resolved replay');

  // lookup
  const fromLookup = run({}, {
    sessions: makeSessions({ submit_state: 'submitting' }),
    leadIntake: makeIntake({ lookup: { ok: true, known: true, body: MERGED_BODY_TB1 } })
  });
  eq(fromLookup.out.log.resolved_from, 'lookup', 'fixture drifted off the lookup branch');
  assertNoModeAnywhere(fromLookup.out.response, 'a lookup-resolved replay');
});

check('internal observability is not weakened: every resolved path logs mode', () => {
  eq(run({}, { leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) }).out.log.lead_mode, 'merged',
    'a fresh success stopped logging mode');
  const fromSession = run({}, { sessions: makeSessions({ submit_state: 'submitted', lead_id: 'FIN-S', mode: 'merged' }) });
  eq(fromSession.out.log.lead_mode, 'merged', 'a session-resolved replay stopped logging mode');
  const fromLookup = run({}, {
    sessions: makeSessions({ submit_state: 'submitting' }),
    leadIntake: makeIntake({ lookup: { ok: true, known: true, body: MERGED_BODY_TB1 } })
  });
  eq(fromLookup.out.log.lead_mode, 'merged', 'a lookup-resolved replay stopped logging mode');
});

check('the logged mode is the OBSERVED value, not one clamped into the vocabulary', () => {
  // Canary L7 has to see what Lead Intake actually said. A value coerced to 'new' would
  // destroy exactly the evidence the canary exists to collect.
  const odd = { ok: true, lead_id: 'FIN-ODD-1', mode: 'reopened', priority: 'HOT', financial_zone: 'RED' };
  const r = run({}, { leadIntake: makeIntake({ body: odd }) });
  eq(r.out.log.lead_mode, 'reopened', 'an unexpected downstream mode was clamped in the log');
  eq(r.out.log.lead_mode_known, false, 'a vocabulary drift was not flagged');
  assertNoModeAnywhere(r.out.response, 'a success with an unexpected mode');
  eq(C.internalMode('merged').known, true, 'a known mode was flagged unknown');
});

// ------------------------- OWNER DECISION: Bot_Sessions schema precondition (N6.2)
//
// Approved as a DEPLOYMENT PREREQUISITE only. Nothing here touches a live sheet. These
// checks pin the declared contract and prove the preflight fails closed -- and, deliberately,
// that the fixture does NOT paper over the fact that the live sheet lacks the columns today.

console.log('\nBOT_SESSIONS SCHEMA PRECONDITION');

check('the precondition is a declared contract with fail-closed semantics', () => {
  const p = C.AUTHORITY_SCHEMA_PRECONDITION;
  assert(p && typeof p === 'object', 'AUTHORITY_SCHEMA_PRECONDITION is not exported');
  eq(p.store, 'Bot_Sessions', 'the precondition names the wrong store');
  eq(p.fail_mode, 'FAIL_CLOSED', 'the precondition does not declare fail-closed');
  eq(p.silent_default_permitted, false, 'the precondition permits a silent default');
  eq(p.columns.map((c) => c.name).join(','), 'lead_mode,lead_priority,financial_zone',
    'the required column set drifted');
  p.columns.forEach((c) => {
    assert(c.semantics && c.semantics.length > 10, c.name + ' has no documented semantics');
    assert(Array.isArray(c.vocabulary) && c.vocabulary.length, c.name + ' has no declared vocabulary');
    assert(c.on_absent && c.on_absent.length > 10, c.name + ' does not say what absence costs');
  });
  eq(C.AUTHORITY_SCHEMA_PRECONDITION.columns.find((c) => c.name === 'lead_mode').crosses_tb1, false,
    'lead_mode is declared as crossing TB-1, which the owner decision forbids');
});

check('the preflight fails closed on absent, partial and unreadable headers', () => {
  const absent = C.authoritySchemaPreflight(LIVE_AUTHORITY_COLUMNS);
  eq(absent.deploy, false, 'the preflight cleared a deployment against the live schema');
  eq(absent.reason, 'COLUMNS_ABSENT', 'the refusal reason drifted');
  eq(absent.missing.join(','), 'lead_mode,lead_priority,financial_zone', 'the missing set is wrong');

  const partial = C.authoritySchemaPreflight(LIVE_AUTHORITY_COLUMNS.concat(['lead_mode']));
  eq(partial.deploy, false, 'a partial migration cleared the preflight');
  eq(partial.missing.join(','), 'lead_priority,financial_zone', 'the partial missing set is wrong');

  // "We could not check" and "it is fine" must never be the same answer.
  [null, undefined, 'lead_mode', {}, 42].forEach((bad) => {
    const r = C.authoritySchemaPreflight(bad);
    eq(r.deploy, false, 'an unreadable header list (' + JSON.stringify(bad) + ') cleared the preflight');
    eq(r.reason, 'HEADERS_UNREADABLE', 'an unreadable header list was misreported');
  });
});

check('the preflight clears only a fully migrated sheet', () => {
  const ok = C.authoritySchemaPreflight(MIGRATED_AUTHORITY_COLUMNS);
  eq(ok.deploy, true, 'a fully migrated sheet was refused');
  eq(ok.reason, 'SATISFIED', 'the pass reason drifted');
  eq(ok.missing.length, 0, 'a satisfied preflight still reported missing columns');
  // Header text is compared, not column count: a mistyped header is an absent column.
  const typo = LIVE_AUTHORITY_COLUMNS.concat(['leadmode', 'lead_priority', 'financial_zone']);
  eq(C.authoritySchemaPreflight(typo).deploy, false, 'a mistyped header passed as present');
});

check('the fixtures do not hide the live prerequisite', () => {
  // The optimistic fixture is exactly the live schema plus the precondition columns, and
  // nothing else. If someone widens the fixture to make a test pass, this fails.
  const extra = MIGRATED_AUTHORITY_COLUMNS.filter((c) => LIVE_AUTHORITY_COLUMNS.indexOf(c) === -1);
  eq(extra.join(','), C.AUTHORITY_SCHEMA_PRECONDITION.columns.map((c) => c.name).join(','),
    'the migrated fixture differs from the live schema by something other than the precondition');
  C.AUTHORITY_SCHEMA_PRECONDITION.columns.forEach((c) => {
    eq(LIVE_AUTHORITY_COLUMNS.indexOf(c.name), -1,
      c.name + ' is modelled as already present in the live schema, which hides the prerequisite');
  });
});

check('against TODAY live schema the classification write is silently dropped', () => {
  // This is the failure the precondition exists to prevent, demonstrated rather than
  // asserted in prose: the write succeeds, the sheet keeps none of it, nothing errors.
  const authority = makeAuthority(undefined, LIVE_AUTHORITY_COLUMNS);
  const r = run({}, { authority, leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) });
  eq(r.out.response.ok, true, 'the submit itself failed, which is not what an unmigrated sheet does');
  eq(authority.row.lead_id, 'FIN-G6-TB1', 'the lead binding was lost, so the fixture is wrong');
  eq(authority.row.lead_mode, undefined, 'the fixture stored a column the live sheet does not have');
  eq(authority.dropped.sort().join(','), 'financial_zone,lead_mode,lead_priority',
    'the dropped-column set drifted');
  eq(C.authoritySchemaPreflight(authority.columns).deploy, false,
    'the preflight would have cleared this deployment');
});

check('an unmigrated sheet cannot recover the classification on a retry', () => {
  // The consequence of the drop above, one request later: this is why the preflight refuses
  // rather than letting a deployment proceed and fall back.
  const authority = makeAuthority(undefined, LIVE_AUTHORITY_COLUMNS);
  run({}, { authority, leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) });
  const retry = run({}, { authority, sessions: makeSessions(), leadIntake: makeIntake({ body: MERGED_BODY_TB1 }) });
  eq(retry.out.log.resolved_from, 'authority', 'fixture drifted off the authority branch');
  eq(retry.out.log.classification_recovered, false, 'an unmigrated sheet claimed a recovered classification');
  eq(retry.out.log.lead_mode, '', 'a dropped column produced a value from nowhere');
  // And still nothing crosses TB-1.
  assertNoModeAnywhere(retry.out.response, 'an unmigrated authority replay');
});

check('(P3) a current cycle with no preallocated submission_key fails closed', () => {
  // The preallocation invariant, enforced at the gateway: a current authoritative cycle is
  // REQUIRED to have a receipt key. Its absence is a broken invariant, and must never be read
  // as an empty ledger that permits a fresh submit — that was the duplicate-lead path.
  const authority = makeAuthority();
  delete authority.row.submission_key;
  const r = run({}, { authority });
  eq(r.out.ok, false, 'a cycle with no submission key was allowed to submit');
  eq(r.out.response.error_code, 'PRE_ACTIVATION_BLOCKED', 'the missing key was not reported as blocked');
  eq(r.out.log.stage, 'SUBMISSION_KEY_MISSING_ON_AUTHORITY', 'the stage was not named');
  eq(r.leadIntake.calls.length, 0, 'a broken invariant reached Lead Intake');
  eq(r.authority.stats.writes, 0, 'a broken invariant wrote to authority');
});

check('(P3) the recovery lookup is asked with the AUTHORITATIVE submission key', () => {
  // Not the derived miniapp:<user>:<cycle> value, which P2/P3 retired: two issuers minting in
  // one millisecond derive the same key, and the ledger cannot arbitrate that.
  const authority = makeAuthority();
  authority.row.submission_key = 'sub_' + 'b'.repeat(32);
  const sessions = makeSessions({ submit_state: 'submitting' });
  const leadIntake = makeIntake({ lookup: { ok: true, known: false } });
  const r = run({}, { sessions, authority, leadIntake });
  eq(r.leadIntake.lookups[0], 'sub_' + 'b'.repeat(32), 'the lookup did not use the authority key');
  assert(String(r.leadIntake.lookups[0]).indexOf('miniapp:') === -1,
    'the retired derived key is still being used for recovery');
});

// ---------------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
