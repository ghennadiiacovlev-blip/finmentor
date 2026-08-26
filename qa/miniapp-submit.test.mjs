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

// Bot_Sessions double. Same read/write contract the read-model mirror helper is injected
// with, so authority behaves identically across both slices.
function makeAuthority(initial) {
  const row = Object.assign({
    chat_id: CHAT,
    cycle_id: CYCLE,
    consent: '',
    consent_cycle_id: '',
    consent_at: '',
    lead_id: '',
    lead_cycle_id: ''
  }, initial || {});
  return {
    row,
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
      Object.assign(row, patch);
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
    mirror: w.noMirror ? undefined : (id) => { EVENTS.push('mirror'); mirrored.push(id); },
    clock: CLOCK,
    locale: 'ru',
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
  eq(r.out.response.mode, 'new', 'mode drifted');
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
  eq(r.out.response.mode, 'merged', 'merge mode lost');
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
  eq(r.leadIntake.lookups[0], 'miniapp:' + CHAT + ':' + CYCLE, 'lookup used the wrong key');
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

// ---------------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
