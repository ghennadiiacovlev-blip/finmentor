// FINMENTOR — Mini App consent + submit contract (B.2.1-C).
//
// Canonical scope: docs/PHASE_B2_1_GATEWAY_CONTRACT.md §14 "B.2.1-C — Consent + Submit",
// elaborated by §8 (consent), §9 (submit sequence), §10 (idempotency), §11 (urgency
// semantic guard), §12 (HTTP/security controls) and §13 (QA matrix). Nothing here invents
// scope; every rule below cites the section it implements.
//
// This module is pure logic: schema validation, consent evaluation, the Lead Intake payload
// projection and the submit state machine. It performs no I/O, so it is fully provable
// offline. The orchestration that touches injected clients lives in submit-handler.js.
//
// n8n Cloud Code-sandbox constraints proven in B.2.1-A and restated in §3.5:
// require('crypto') is available; WebCrypto and URLSearchParams are not. Nothing here
// needs either.

const crypto = require('crypto');

// ---------------------------------------------------------------- §12 request guards

const MAX_BODY_BYTES = 16384;      // submit carries answers + contact, so larger than bootstrap
const MAX_PAYLOAD_BYTES = 32768;   // ceiling on what may be handed to Lead Intake
const MAX_FREE_TEXT = 500;         // app/index.html enforces maxlength="500" in the browser
const MAX_CONTACT_FIELD = 200;
const ALLOWED_CLIENT_VERSIONS = ['b2.1.0'];

// §9 — the Mini App answer set, with the exact option values the shipped B.2.0 client can
// emit (app/index.html data-value attributes). A strict value whitelist, not a shape check:
// an unknown value is rejected rather than forwarded, so the Mini App can never widen the
// CRM vocabulary from the browser.
const ANSWER_SCHEMA = {
  sector: ['retail', 'services', 'production', 'real_estate', 'ecommerce', 'other'],
  turnover: ['lt100k', '100k_500k', '500k_2m', '2m_10m', 'gt10m'],
  cash: ['clear', 'partial', 'unclear'],
  profit: ['clear', 'partial', 'unclear'],
  treasury: ['clear', 'partial', 'unclear'],
  kpi: ['clear', 'partial', 'unclear'],
  pain: ['cash_gap', 'margin', 'payments', 'reporting', 'control'],
  urgency: ['now', 'month', 'quarter', 'none']
};
const ANSWER_KEYS = Object.keys(ANSWER_SCHEMA);
const REQUIRED_ANSWERS = ['sector', 'turnover', 'cash', 'profit', 'treasury', 'kpi', 'pain', 'urgency'];
const FREE_TEXT_KEYS = ['context'];

// §9 — contact block. `direct` is the optional phone/email; inside Telegram the Telegram
// identity is the reply channel.
const CONTACT_KEYS = ['name', 'company', 'direct'];

// §7, §12 — the browser may not assert any of these. They are canonical server state:
// identity, cycle binding, consent provenance and CRM scoring. Presence is not an error
// (a stale client may still send them) but the value is dropped and logged, never read.
const UNTRUSTED_BODY_KEYS = [
  'telegram_user_id', 'chat_id', 'lead_id', 'canonical_lead_id', 'cycle_id',
  'consent_cycle_id', 'consent_at', 'consent_source', 'lead_cycle_id',
  'priority', 'lead_priority', 'financial_zone', 'risk_zone', 'score_zone',
  'submit_state', 'idempotency_key', 'request_id', 'provenance_trusted',
  'internal_route', '__internal_route', 'init_data'
];

// §9 success response + §12 "redact/restrict error details". Everything the browser is
// allowed to see. lead_id is deliberately present: §9 returns the canonical lead id.
// OWNER DECISION, N6.2: `mode` is NOT in this list, and must never return to it.
//
// The browser must not be able to determine from the response whether its lead was new,
// merged, a retry or a duplicate. Gateway contract §9 previously did two contradictory
// things at once -- it defined `mode` in the success body and required that "the UI must not
// tell a client they were a duplicate" -- and a field in the response body is readable in
// devtools whatever the UI chooses to render. The contradiction is resolved in favour of the
// rule, not the field.
//
// `mode` is not lost, only reclassified as internal: it is written to authority as
// `lead_mode` and recorded in the server log (see `internalMode`), which is where canary L7
// needs it. See RESPONSE_FORBIDDEN_KEYS -- it is now actively refused, not merely omitted.
const CLIENT_RESPONSE_FIELDS = ['ok', 'lead_id', 'priority', 'financial_zone', 'submit_state'];

// Never returned to the browser under any branch. Distinct from the read-model leak list
// because submit legitimately returns lead_id.
const RESPONSE_FORBIDDEN_KEYS = [
  // N6.2 -- omitting a field and refusing it are different guarantees. `mode` and its
  // authority spelling are listed so that reintroducing either, at any nesting depth and by
  // any route, is caught by `responseLeaks` rather than by someone noticing.
  'mode', 'lead_mode',
  'init_data', 'hash', 'signature', 'bot_token', 'token', 'credential',
  'chat_id', 'telegram_user_id', 'session_id', 'app_session_id', 'cycle_id',
  'consent_cycle_id', 'lead_cycle_id', 'consent_at', 'idempotency_key',
  'raw_json', 'row', 'row_number', 'id', 'notes', 'workflow_id'
];

// §4 error-code vocabulary, extended by the submit-only codes §9/§10 require. Status codes
// are the transport mapping; the browser sees only { ok, error_code, retryable }.
const STATUS = {
  BAD_REQUEST: 400,
  CLIENT_VERSION_UNSUPPORTED: 400,
  SESSION_MISSING: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  CYCLE_SUPERSEDED: 409,
  CONSENT_REQUIRED: 409,
  CONSENT_STALE_CYCLE: 409,
  SUBMIT_IN_PROGRESS: 409,
  SUBMIT_UNRESOLVED: 503,
  PRE_ACTIVATION_BLOCKED: 503,
  RATE_LIMITED: 429,
  TEMPORARY_BACKEND_ERROR: 503
};
const RETRYABLE = {
  SUBMIT_IN_PROGRESS: true,
  SUBMIT_UNRESOLVED: true,
  // Retryable on purpose: the condition is resolved by an operator or by a cycle change,
  // not by the client changing anything. Marking it non-retryable would tell a client to
  // give up on a submission that becomes recoverable the moment the adapter is deployed
  // or the canonical binding is written to authority by hand.
  PRE_ACTIVATION_BLOCKED: true,
  RATE_LIMITED: true,
  TEMPORARY_BACKEND_ERROR: true
};

// ------------------------------------------------- §10 durable recovery adapter (G1)

// The one capability B.2.1-C cannot supply from this repository.
//
// After an AMBIGUOUS downstream outcome — a timeout, a dropped connection, a 5xx that
// arrived after Lead Intake had already accepted the request — the gateway holds no record
// of whether a lead was created. Three identifiers exist and only one of them is usable:
//
//   * `meta.request_id` is regenerated per attempt, so it is a correlation reference and
//     can never be a retry key;
//   * a caller-supplied `lead_id` is untrusted by construction (§12) and must never be
//     able to satisfy a recovery;
//   * `miniapp:<telegram_user_id>:<cycle_id>` is derived solely from server-owned values
//     and is therefore stable across every retry of one logical submission.
//
// The stable key is the only admissible one. Where it is durably recorded decides whether
// recovery is possible at all:
//
//   * `Bot_Sessions` (authority) proves a commit the gateway LEARNED about — it is written
//     by persistCanonical AFTER Intake returns. It cannot prove a commit whose response was
//     lost, because in that case the write never happened.
//   * The app-session store is a claim record with a TTL, and §6 forbids it becoming a
//     second CRM. It cannot be the durable record either.
//
// So the record that settles an ambiguous outcome necessarily lives DOWNSTREAM of the
// gateway, and the gateway must be able to ask for it by the stable key. That question is
// `leadIntake.lookup`, and nothing in this repository answers it.
const RECOVERY_ADAPTER_CONTRACT = {
  method: 'leadIntake.lookup',
  signature: 'lookup(submissionKey) -> { ok: boolean, known: boolean, body?: object }',
  key_shape: 'sub_<32 lowercase hex>',
  key_source: 'Bot_Sessions.submission_key — the AUTHORITATIVE preallocated key',
  server_minted: true,
  browser_may_supply: false,
  derived_from_identity: false,
  // Answers must be distinguishable. `ok:false` means "could not answer" and preserves
  // ambiguity; `ok:true, known:false` is a positive assertion that nothing was created and
  // is the ONLY answer that may release a claim for a fresh attempt.
  responses: {
    committed: '{ ok: true, known: true, body: { ok: true, lead_id: "FIN-...", mode, priority, financial_zone } }',
    not_committed: '{ ok: true, known: false }',
    cannot_answer: '{ ok: false }'
  },
  requirements: [
    'durable: survives gateway restart, workflow redeploy and app-session TTL expiry',
    'PREALLOCATED: the receipt exists before the cycle becomes authoritative, so the submit ' +
      'path only ever performs conditional updates (P3)',
    'indexed by the submission key: a scan over Pipeline rows is not a lookup and is not acceptable',
    'server-side only: no browser-supplied value may select or satisfy a recovery',
    'absence is NEVER an answer: a missing receipt for a current cycle is a broken ' +
      'preallocation invariant and must resolve to CANNOT_ANSWER, never to NOT_COMMITTED'
  ],
  // HISTORICAL, kept because it explains why the key shape changed. P1/P2 used a key derived
  // from telegram_user_id + cycle_id. P2 proved the n8n Data Table has no atomic
  // insert-if-absent, and P3 proved two issuers can mint the same cycle_id in one millisecond
  // — so a derived key could collide with nothing able to arbitrate it. MODEL B replaced it
  // with an opaque random key. See docs/PHASE_B2_1C_G1_P3_PREALLOCATION_DECISION.md.
  superseded_model_a: {
    historical: true,
    key_shape: 'miniapp:<telegram_user_id>:<cycle_id>',
    retired_because: 'derived-key collision under same-millisecond issuance, unarbitrable ' +
      'without insert-if-absent (P2 proved absent)'
  }
};

// Absence of the adapter is a deployment condition, not a request error. It is reported
// with its own code so a blocked deployment is never confused in the logs with a
// transient downstream failure.
// G7 — `meta.request_id` in the outbound envelope is the SERVER correlation id, and a fresh
// one is minted per attempt. It is a correlation reference, never a deduplication key. That
// is by design, and it is stated here as a declared contract rather than left in a comment
// because the failure mode is somebody downstream reading `request_id` as if it deduplicated
// Mini App retries, which it cannot:
//
//   * two attempts at one submission carry DIFFERENT request_ids while sharing ONE
//     submission key, so no downstream index on request_id can collapse a retry;
//   * request_id is NEVER the submission key and never a deduplication identity. Under P3 the
//     submission identity is `submission_key`, minted by the cycle issuer and read from
//     authority -- request_id has no relationship to it at all;
//   * retry safety rests on the PREALLOCATED RECEIPT plus gateway-side resolution
//     (`resolvePriorSubmission`), never on request_id.
//
// Read this next to RECOVERY_ADAPTER_CONTRACT: request_id correlates log lines, and
// submission_key identifies the submission. Conflating them is the failure this exists to
// prevent.
const REQUEST_ID_SEMANTICS = {
  field: 'meta.request_id',
  source: 'server correlation id',
  stable_across_attempts: false,
  is_deduplication_key: false,
  is_submission_key: false,
  submission_identity_is: 'submission_key, from Bot_Sessions',
  retry_safety_rests_on: 'the preallocated receipt plus gateway-side resolution'
};

function recoveryAdapterStatus(leadIntake) {
  if (!leadIntake || typeof leadIntake.lookup !== 'function') {
    return { available: false, reason: 'RECOVERY_ADAPTER_MISSING' };
  }
  return { available: true, reason: 'RECOVERY_ADAPTER_PRESENT' };
}

// ---------------------------------------------------------------- helpers

function normValue(v) {
  if (v === null || v === undefined) { return ''; }
  if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
  if (typeof v === 'number') { return String(v); }
  return String(v).trim();
}

function byteLength(s) { return Buffer.byteLength(String(s), 'utf8'); }

function fail(code, stage, detail) {
  const out = {
    ok: false,
    status_code: STATUS[code] || 400,
    error_code: code,
    retryable: RETRYABLE[code] === true,
    stage: stage
  };
  if (detail) { out.detail = detail; }
  return out;
}

// ---------------------------------------------------------------- §10 state machine

const SUBMIT_STATES = ['draft', 'submitting', 'submitted', 'retryable_error'];

// Monotonic toward `submitted`. The one rule that matters: nothing leaves `submitted`.
const TRANSITIONS = {
  draft: ['submitting'],
  retryable_error: ['submitting'],
  submitting: ['submitted', 'retryable_error'],
  submitted: []
};

function canTransition(from, to) {
  if (SUBMIT_STATES.indexOf(from) === -1 || SUBMIT_STATES.indexOf(to) === -1) { return false; }
  if (from === to) { return from === 'submitted'; }
  return TRANSITIONS[from].indexOf(to) !== -1;
}

// §10 — the idempotency key. Derived only from server-owned values. A caller-supplied
// request_id can never appear here, so it cannot steer which key a submission claims.
// RETIRED in P3.1. The derived key is gone rather than left available: keeping two competing
// submission identities in the codebase is exactly how one of them gets used by accident.
// The submission identity is `Bot_Sessions.submission_key`, minted by the cycle issuer.
// See RECOVERY_ADAPTER_CONTRACT.superseded_model_a for why it was retired.
function idempotencyKey() {
  throw new Error('idempotencyKey is retired (P3.1): use the authoritative submission_key');
}

// ---------------------------------------------------------------- §11 urgency guard

// The Russian strings written into the CRM. `none` MUST stay semantically negative: it is
// the exact case B.2.0 QA recorded and §11 makes contractual — "Нет срочности" must never
// be mapped to an urgency keyword and must not independently escalate priority.
const URGENCY_RU = {
  now: 'Срочно, требуется сейчас',
  month: 'В течение месяца',
  quarter: 'В течение квартала',
  none: 'Нет срочности'
};

// Copied verbatim from n8n/src/lead-intake/normalize-score-lead.js so this module can prove,
// offline, what the *downstream* scorer will do with the string it is handed. The gate
// asserts these literals still match the Intake source, so a change there fails here rather
// than silently re-escalating `urgency = none`.
const LEAD_INTAKE_URGENT_PATTERNS = [/срочн/, /горит/, /^1 месяц/, /сегодня/, /недел/, /\bhigh\b/];
const LEAD_INTAKE_NEGATION = [
  /\bнет\b/, /^нет/, /нет срочн/, /не срочн/, /без срочн/, /не горит/, /ничего/,
  /отсутств/, /не планир/, /не готов/, /не подготовл/, /\bno\b/, /\bnone\b/,
  /not urgent/, /nothing/
];

function lower(x) {
  return String(x === null || x === undefined ? '' : x).toLowerCase().replace(/ё/g, 'е').trim();
}

// Mirrors Lead Intake's `hits()`: a negation cancels a positive signal even when the text
// also contains an urgency keyword.
function wouldEscalateInLeadIntake(text) {
  const s = lower(text);
  if (s === '') { return false; }
  if (LEAD_INTAKE_NEGATION.some(function (r) { return r.test(s); })) { return false; }
  return LEAD_INTAKE_URGENT_PATTERNS.some(function (r) { return r.test(s); });
}

const PAIN_RU = {
  cash_gap: 'Кассовые разрывы',
  margin: 'Непрозрачная маржинальность',
  payments: 'Несистемные платежи',
  reporting: 'Нет управленческой отчётности',
  control: 'Нет управленческого контроля'
};
const SECTOR_RU = {
  retail: 'Торговля',
  services: 'Услуги',
  production: 'Производство',
  real_estate: 'Недвижимость',
  ecommerce: 'E-commerce',
  other: 'Другое'
};
const TURNOVER_RU = {
  lt100k: 'до 100k EUR',
  '100k_500k': '100k–500k EUR',
  '500k_2m': '500k–2M EUR',
  '2m_10m': '2M–10M EUR',
  gt10m: '10M+ EUR'
};

// Strip C0/C1 controls and neutralise a leading spreadsheet formula trigger. Data stays
// data: nothing here is ever evaluated as an expression or a formula.
function sanitiseText(s) {
  const src = String(s);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    // C0 and C1 control characters become a space, so a value can never forge a line
    // boundary in an execution log, a Telegram message or a spreadsheet cell.
    out += (c <= 31 || (c >= 127 && c <= 159)) ? ' ' : src.charAt(i);
  }
  out = out.replace(/\s+/g, ' ').trim();
  // A leading =, +, - or @ is neutralised with a leading apostrophe so a downstream
  // spreadsheet treats the value as text instead of evaluating it as a formula.
  if (/^[=+\-@]/.test(out)) { out = String.fromCharCode(39) + out; }
  return out;
}

// ---------------------------------------------------------------- §9/§12 body validation

// Strict, fail-closed, whitelist-only. Unknown answer keys and unknown answer values are
// rejected rather than dropped, because a value the server does not understand must not
// reach the CRM as if it were understood.
function validateSubmitBody(body) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : null;
  if (!b) { return fail('BAD_REQUEST', 'BODY_SHAPE'); }

  let bytes;
  try { bytes = byteLength(JSON.stringify(b)); }
  catch (e) { return fail('BAD_REQUEST', 'BODY_UNSERIALISABLE'); }
  if (bytes > MAX_BODY_BYTES) { return fail('BAD_REQUEST', 'BODY_TOO_LARGE'); }

  if (ALLOWED_CLIENT_VERSIONS.indexOf(b.client_version) === -1) {
    return fail('CLIENT_VERSION_UNSUPPORTED', 'CLIENT_VERSION');
  }

  const appSessionId = normValue(b.app_session_id);
  if (appSessionId === '' || !/^[A-Za-z0-9_-]{16,128}$/.test(appSessionId)) {
    return fail('SESSION_MISSING', 'APP_SESSION_SHAPE');
  }

  // Recorded, never read. §12: no browser-provided lead_id, cycle_id, priority or
  // financial zone is accepted as authoritative.
  const ignoredUntrusted = [];
  for (let i = 0; i < UNTRUSTED_BODY_KEYS.length; i++) {
    const k = UNTRUSTED_BODY_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(b, k)) { ignoredUntrusted.push(k); }
    if (b.answers && typeof b.answers === 'object' && Object.prototype.hasOwnProperty.call(b.answers, k)) {
      if (ignoredUntrusted.indexOf('answers.' + k) === -1) { ignoredUntrusted.push('answers.' + k); }
    }
    if (b.contact && typeof b.contact === 'object' && Object.prototype.hasOwnProperty.call(b.contact, k)) {
      if (ignoredUntrusted.indexOf('contact.' + k) === -1) { ignoredUntrusted.push('contact.' + k); }
    }
  }

  const rawAnswers = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) ? b.answers : null;
  if (!rawAnswers) { return fail('BAD_REQUEST', 'ANSWERS_SHAPE'); }

  const answers = {};
  const answerKeys = Object.keys(rawAnswers);
  for (let i = 0; i < answerKeys.length; i++) {
    const k = answerKeys[i];
    if (UNTRUSTED_BODY_KEYS.indexOf(k) !== -1) { continue; }
    if (FREE_TEXT_KEYS.indexOf(k) !== -1) { continue; }
    if (ANSWER_KEYS.indexOf(k) === -1) { return fail('BAD_REQUEST', 'ANSWER_KEY_UNKNOWN', k); }
    const v = normValue(rawAnswers[k]);
    if (ANSWER_SCHEMA[k].indexOf(v) === -1) { return fail('BAD_REQUEST', 'ANSWER_VALUE_UNKNOWN', k); }
    answers[k] = v;
  }
  for (let i = 0; i < REQUIRED_ANSWERS.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(answers, REQUIRED_ANSWERS[i])) {
      return fail('BAD_REQUEST', 'ANSWER_MISSING', REQUIRED_ANSWERS[i]);
    }
  }

  // §7 — free text is length-limited and stored as data. Control characters are stripped so
  // the value cannot forge structure in a log line, a Telegram message or a sheet cell, and
  // a leading formula character is neutralised so it is never evaluated as a spreadsheet
  // expression.
  const freeText = {};
  for (let i = 0; i < FREE_TEXT_KEYS.length; i++) {
    const k = FREE_TEXT_KEYS[i];
    if (!Object.prototype.hasOwnProperty.call(rawAnswers, k)) { freeText[k] = ''; continue; }
    const raw = normValue(rawAnswers[k]);
    if (raw.length > MAX_FREE_TEXT) { return fail('BAD_REQUEST', 'FREE_TEXT_TOO_LONG', k); }
    freeText[k] = sanitiseText(raw);
  }

  const rawContact = (b.contact && typeof b.contact === 'object' && !Array.isArray(b.contact)) ? b.contact : {};
  const contact = {};
  const contactKeys = Object.keys(rawContact);
  for (let i = 0; i < contactKeys.length; i++) {
    const k = contactKeys[i];
    if (UNTRUSTED_BODY_KEYS.indexOf(k) !== -1) { continue; }
    if (CONTACT_KEYS.indexOf(k) === -1) { return fail('BAD_REQUEST', 'CONTACT_KEY_UNKNOWN', k); }
    const raw = normValue(rawContact[k]);
    if (raw.length > MAX_CONTACT_FIELD) { return fail('BAD_REQUEST', 'CONTACT_TOO_LONG', k); }
    contact[k] = sanitiseText(raw);
  }
  for (let i = 0; i < CONTACT_KEYS.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(contact, CONTACT_KEYS[i])) { contact[CONTACT_KEYS[i]] = ''; }
  }

  // §8 — consent is a dedicated explicit decision. Only the literal strings decide; a
  // truthy object, the number 1 or the string "true" are not consent.
  const consentRaw = b.consent;
  let consent;
  if (consentRaw === 'yes') { consent = 'yes'; }
  else if (consentRaw === 'no') { consent = 'no'; }
  else { return fail('CONSENT_REQUIRED', 'CONSENT_SHAPE'); }

  return {
    ok: true,
    app_session_id: appSessionId,
    client_version: b.client_version,
    answers: answers,
    free_text: freeText,
    contact: contact,
    consent: consent,
    ignored_untrusted: ignoredUntrusted,
    body_bytes: bytes
  };
}

// ---------------------------------------------------------------- §8 consent

// Consent is evaluated against the AUTHORITATIVE cycle, never the browser's and never the
// app session's alone. A session bound to a superseded cycle cannot carry consent forward:
// §8 "Consent from another cycle is invalid."
function evaluateConsent(opts) {
  const o = opts || {};
  const consent = normValue(o.consent);
  const authorityCycleId = normValue(o.authorityCycleId);
  const sessionCycleId = normValue(o.sessionCycleId);

  if (consent !== 'yes') {
    // §8 — NO must not call Lead Intake. This is an accepted outcome, not an error.
    return { eligible: false, reason: 'CONSENT_NO', lead_intake_allowed: false };
  }
  if (authorityCycleId === '') {
    return { eligible: false, reason: 'CYCLE_MISSING', error_code: 'CYCLE_SUPERSEDED', lead_intake_allowed: false };
  }
  if (sessionCycleId === '' || sessionCycleId !== authorityCycleId) {
    return { eligible: false, reason: 'CONSENT_STALE_CYCLE', error_code: 'CONSENT_STALE_CYCLE', lead_intake_allowed: false };
  }
  return {
    eligible: true,
    reason: 'CONSENT_CURRENT',
    lead_intake_allowed: true,
    // §8 — the stamp is server-built in full. Nothing in it comes from the request body.
    stamp: {
      consent: 'yes',
      consent_cycle_id: authorityCycleId,
      consent_at: normValue(o.nowIso),
      consent_source: 'telegram_miniapp'
    }
  };
}

// ---------------------------------------------------------------- §9.6 Lead Intake payload

// Project the whitelisted Mini App answers onto the lead payload, and wrap it in the
// `{ source, payload }` ENVELOPE.
//
// F10 — read the scope of that envelope precisely, because an earlier version of this very
// comment did not. The envelope is the contract between THIS GATEWAY and the internal
// route's `Internal Auth Entry` node, and nothing further. It is NOT the shape Lead
// Intake's `Validate Payload` parses: that node is INHERITED PRODUCTION and reads the
// WEBHOOK REQUEST shape, `raw.body` / `raw.headers`. `Internal Envelope Unwrap` is the node
// that translates one into the other.
//
// The earlier claim that Lead Intake "already parses { source, payload }" was false, and it
// was load-bearing: the unwrap was built to satisfy it, so every internal submission
// resolved to INVALID_PAYLOAD and the route could not accept a single lead (live exec
// 3583). The seam is now proven by execution in qa/internal-route-contract.test.mjs.
//
// Two omissions from the payload are deliberate and load-bearing:
//
//   * no `lead_id` — a caller-supplied lead_id must never become canonical identity, and
//     downstream Dedup Guard uses it to select a merge target. The gateway is a caller.
//   * no provenance marker — provenance is established by the route n8n authenticates,
//     never by a field in a body.
//
// `request_id` is set from the server correlation id only. It is a correlation reference,
// never an identity selector.
function buildLeadIntakePayload(opts) {
  const o = opts || {};
  const a = o.answers || {};
  const contact = o.contact || {};
  const freeText = o.free_text || {};
  const urgencyText = URGENCY_RU[a.urgency] || '';
  const painText = PAIN_RU[a.pain] || '';

  const payload = {
    tool: 'miniapp_diagnostic',
    created_at: normValue(o.nowIso),
    client: {
      name: contact.name || '',
      company: contact.company || '',
      phone_or_messenger: contact.direct || '',
      // The validated Telegram numeric id. Lead Intake normalises a 5–20 digit run to a
      // telegram identity, which is the reply channel when `direct` is empty in-app.
      telegram: normValue(o.telegramUserId),
      language: normValue(o.locale) || 'ru'
    },
    answers: {
      business_model: SECTOR_RU[a.sector] || '',
      revenue_range: TURNOVER_RU[a.turnover] || '',
      main_pain: painText
    },
    main_pain: {
      problem: painText,
      // §11 — the urgency string the scorer will read. `none` stays negative here.
      urgency: urgencyText
    },
    business_profile: {
      industry_category: SECTOR_RU[a.sector] || '',
      turnover_range: TURNOVER_RU[a.turnover] || ''
    },
    financial_system: {
      cash_visibility: a.cash || '',
      profit_visibility: a.profit || '',
      treasury: a.treasury || '',
      kpi_control: a.kpi || ''
    },
    intake: {
      consent: { privacy_accepted: true }
    },
    meta: {
      consent: true,
      request_id: normValue(o.correlationId),
      page_url: 'telegram_miniapp',
      utm_source: 'telegram',
      utm_medium: 'miniapp'
    },
    // Carried for the human reviewer via Lead Intake's raw_json capture. Sanitised data,
    // never an expression.
    free_text: freeText.context || '',
    miniapp: {
      client_version: normValue(o.clientVersion),
      answers_raw: {
        sector: a.sector || '', turnover: a.turnover || '', cash: a.cash || '',
        profit: a.profit || '', treasury: a.treasury || '', kpi: a.kpi || '',
        pain: a.pain || '', urgency: a.urgency || ''
      }
    }
  };

  const envelope = { source: 'telegram_miniapp', payload: payload };
  let bytes;
  try { bytes = byteLength(JSON.stringify(envelope)); }
  catch (e) { return fail('BAD_REQUEST', 'PAYLOAD_UNSERIALISABLE'); }
  if (bytes > MAX_PAYLOAD_BYTES) { return fail('BAD_REQUEST', 'PAYLOAD_TOO_LARGE'); }

  return { ok: true, envelope: envelope, payload_bytes: bytes };
}

// ---------------------------------------------------------------- §9 client response

// F9 — `retry` is a REAL live Lead Intake outcome, not an anomaly.
//
// The production graph has returned it all along: `Respond Retry` answers
// `mode: 'retry'` when `Dedup Guard` sets `dedup_is_retry`. The vocabulary here listed only
// `new` and `merged`, so a perfectly valid live retry would have been reported by
// `internalMode` as `known: false` and then written verbatim to `Bot_Sessions.lead_mode` —
// an out-of-contract value in authority, produced by the system working correctly.
//
// The fix is to admit the third outcome, not to coerce it. Clamping `retry` to `new` would
// tell an authority-resolved replay that a CRM row was created for this cycle when none was.
//
// This changes NOTHING about what crosses TB-1: `mode` and `lead_mode` stay on
// RESPONSE_FORBIDDEN_KEYS and the browser never sees any of the three.
const ALLOWED_MODES = ['new', 'merged', 'retry'];
const ALLOWED_PRIORITIES = ['HOT', 'WARM', 'COLD', 'INCOMPLETE'];
const ALLOWED_ZONES = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'UNKNOWN'];

// ------------------------------------------- B.2.1-C deployment precondition (owner, N6.2)
//
// These `Bot_Sessions` columns are a DEPLOYMENT PREREQUISITE. They are not created
// here and the live sheet is not touched: what lives in this file is the contract a
// deployment must satisfy before the G6 classification write can land, plus a preflight that
// FAILS CLOSED when it is not satisfied.
//
// P5 ADDED `submission_key`, on evidence rather than assumption. The canonical live writer
// column list appears verbatim in three Code nodes of the live Concierge export
// (n8n/production/mppzthlkSJFr6Kle...json — "Build Session Row", "Build Intake State Row",
// "Build Confirmation State Row"). That list has 36 columns and DOES include cycle_id,
// consent_cycle_id, consent_at, lead_cycle_id and lead_intake_ok — all preserved — but it
// does NOT include submission_key. So the authoritative binding column MODEL B depends on
// does not exist live yet, and appending it is part of the same migration as the three
// classification columns rather than something already done.
//
// This corrected a fixture that had assumed otherwise. Getting it wrong in the optimistic
// direction would have been the expensive mistake: persistCanonical patches by key, and a
// patch key with no header is silently DROPPED by Google Sheets, so a deployment against an
// unmigrated sheet would appear to bind the submission key while storing nothing — and every
// later authority read would then see a current cycle with no submission_key, which is
// PRE_ACTIVATION_BLOCKED for every user on that cycle.
//
// Why fail closed rather than default. Google Sheets silently drops a patch key that has no
// header — the write does not error, it does nothing. The next authority-resolved retry then
// reads a blank and clamps it to a value indistinguishable from a real one, which is exactly
// the defect G6 closed. A silent default would therefore re-open G6 at deployment time,
// invisibly. So an absent column means REFUSE TO DEPLOY, never "deploy and fall back".
const AUTHORITY_SCHEMA_PRECONDITION = {
  store: 'Bot_Sessions',
  required_before: 'B.2.1-C live deployment',
  applies_to: 'the canonical lead binding written by persistCanonical',
  fail_mode: 'FAIL_CLOSED',
  silent_default_permitted: false,
  // Header text must match exactly. Position is deliberately NOT depended on — the writer
  // patches by key and never by column index — but a mistyped header is an absent column as
  // far as the writer is concerned, which is why the preflight compares text, not count.
  header_contract: 'exact lower_snake_case header text in row 1, appended after the existing headers; position not depended upon',
  // Preserved by the migration, never rewritten: these already exist live and carry cycle
  // and consent state that B.2.1-C depends on.
  preserved_existing_columns: [
    'cycle_id', 'consent_cycle_id', 'consent_at', 'lead_cycle_id', 'lead_intake_ok'
  ],
  columns: [
    {
      name: 'submission_key',
      semantics: 'The preallocated MODEL B receipt key for this cycle. Half of the authority ' +
        'binding: authority is (cycle_id AND submission_key), never cycle_id alone.',
      vocabulary: ['sub_<32 lowercase hex>'],
      written_by: 'the Concierge at cycle issuance, AFTER verifyPreallocationReadback confirms the receipt',
      read_by: 'handleSubmit authority read, and the gateway pre-handoff guard',
      crosses_tb1: false,
      on_absent: 'a current cycle can never name a receipt, so every submit on it is ' +
        'PRE_ACTIVATION_BLOCKED and the Mini App cannot hand off at all'
    },
    {
      name: 'lead_mode',
      // F9 — describes the INTERNAL LEAD INTAKE OUTCOME for this cycle, not "was a CRM row
      // created or merged". The looser wording would be wrong for `retry`, which writes no
      // Pipeline row at all: dedup resolved the submission to a row that already existed.
      semantics: 'The internal Lead Intake outcome for this cycle: "new" (a Pipeline row was ' +
        'created), "merged" (an existing row was updated) or "retry" (dedup resolved to an ' +
        'existing row and NO Pipeline write occurred).',
      vocabulary: ALLOWED_MODES,
      written_by: 'persistCanonical, at the authoritative commit',
      read_by: 'resolvePriorSubmission, authority branch',
      crosses_tb1: false,
      on_absent: 'an authority-resolved retry cannot recover the classification'
    },
    {
      name: 'lead_priority',
      // F9 — these are the values needed to REPLAY THE MINI APP RESPONSE for this cycle.
      // That is a weaker and more accurate claim than "the current CRM row priority".
      // On new/merge they correspond to the write-bearing outcome and the Pipeline row was
      // written or updated with them. On RETRY they are what Lead Intake scored for THIS
      // attempt, and the existing Pipeline row is deliberately NOT rewritten — so after a
      // retry these fields may differ from the persisted CRM row, by design. The public retry
      // path is unchanged; this only states accurately what it already does.
      semantics: 'Lead priority as Lead Intake scored it for this cycle, i.e. the value needed ' +
        'to replay the Mini App response. On "retry" the existing Pipeline row is not rewritten, ' +
        'so this is the score for that attempt rather than necessarily the persisted CRM value.',
      vocabulary: ALLOWED_PRIORITIES,
      written_by: 'persistCanonical, at the authoritative commit',
      read_by: 'resolvePriorSubmission, authority branch',
      crosses_tb1: true,
      on_absent: 'an authority-resolved retry reports the clamp default COLD'
    },
    {
      name: 'financial_zone',
      semantics: 'Financial zone as Lead Intake scored it for this cycle, i.e. the value needed ' +
        'to replay the Mini App response. On "retry" the existing Pipeline row is not rewritten, ' +
        'so this is the score for that attempt rather than necessarily the persisted CRM value.',
      vocabulary: ALLOWED_ZONES,
      written_by: 'persistCanonical, at the authoritative commit',
      read_by: 'resolvePriorSubmission, authority branch',
      crosses_tb1: true,
      on_absent: 'an authority-resolved retry reports the clamp default UNKNOWN'
    }
  ]
};

// Preflight for a deployment script. Takes the OBSERVED header row of the live Bot_Sessions
// sheet and answers whether the classification write may be deployed.
//
// Every ambiguous case is a refusal. An unreadable header list is not a pass: "we could not
// check" and "it is fine" are the two answers a preflight must never confuse.
function authoritySchemaPreflight(observedHeaders) {
  const required = AUTHORITY_SCHEMA_PRECONDITION.columns.map((c) => c.name);
  if (!Array.isArray(observedHeaders)) {
    return { ok: false, deploy: false, reason: 'HEADERS_UNREADABLE', missing: required.slice() };
  }
  const seen = observedHeaders.map((h) => normValue(h));
  const missing = required.filter((c) => seen.indexOf(c) === -1);
  if (missing.length) {
    return { ok: false, deploy: false, reason: 'COLUMNS_ABSENT', missing: missing };
  }
  return { ok: true, deploy: true, reason: 'SATISFIED', missing: [] };
}

// Internal observability only — the one place `mode` survives now that it does not cross
// TB-1. Deliberately NOT clamped: canary L7 has to observe what Lead Intake actually said,
// and coercing an unexpected value into the allowed vocabulary would destroy the evidence.
// `known` records whether the observed value was in the vocabulary, so a drift downstream is
// visible in the log instead of being smoothed away.
function internalMode(value) {
  const observed = normValue(value);
  return { observed: observed, known: ALLOWED_MODES.indexOf(observed) !== -1 };
}

// Build the browser response from the canonical Lead Intake result. Whitelist only, and the
// values are re-checked against the allowed vocabulary so a surprising downstream value is
// reported as UNKNOWN rather than passed through verbatim.
//
// §9 — "The UI must not tell a client they were a duplicate." N6.2 makes that structural:
// `mode` is not in the returned object at all, so there is nothing for a client to read and
// nothing for a UI to be trusted to hide. The value still reaches the log through
// `internalMode` and authority through `lead_mode`.
function buildSubmitSuccess(opts) {
  const o = opts || {};
  const priority = ALLOWED_PRIORITIES.indexOf(normValue(o.priority)) !== -1 ? normValue(o.priority) : 'COLD';
  const zone = ALLOWED_ZONES.indexOf(normValue(o.financial_zone)) !== -1 ? normValue(o.financial_zone) : 'UNKNOWN';
  return {
    ok: true,
    lead_id: normValue(o.lead_id),
    priority: priority,
    financial_zone: zone,
    submit_state: 'submitted'
  };
}

// §12 — recursive check that nothing outside the response whitelist reaches the browser.
function responseLeaks(obj) {
  const found = [];
  function walk(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) { walk(node[i]); } return; }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      if (RESPONSE_FORBIDDEN_KEYS.indexOf(keys[i]) !== -1 && found.indexOf(keys[i]) === -1) { found.push(keys[i]); }
      walk(node[keys[i]]);
    }
  }
  walk(obj);
  return found;
}

// §12 — the correlation id is server-generated. Never derived from anything a caller sent.
function newCorrelationId() { return crypto.randomUUID(); }

module.exports = {
  MAX_BODY_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_FREE_TEXT,
  MAX_CONTACT_FIELD,
  ALLOWED_CLIENT_VERSIONS,
  ALLOWED_MODES,
  ALLOWED_PRIORITIES,
  ALLOWED_ZONES,
  ANSWER_SCHEMA,
  ANSWER_KEYS,
  REQUIRED_ANSWERS,
  FREE_TEXT_KEYS,
  CONTACT_KEYS,
  UNTRUSTED_BODY_KEYS,
  CLIENT_RESPONSE_FIELDS,
  RESPONSE_FORBIDDEN_KEYS,
  STATUS,
  RETRYABLE,
  RECOVERY_ADAPTER_CONTRACT,
  REQUEST_ID_SEMANTICS,
  AUTHORITY_SCHEMA_PRECONDITION,
  authoritySchemaPreflight,
  recoveryAdapterStatus,
  SUBMIT_STATES,
  TRANSITIONS,
  URGENCY_RU,
  PAIN_RU,
  SECTOR_RU,
  TURNOVER_RU,
  LEAD_INTAKE_URGENT_PATTERNS,
  LEAD_INTAKE_NEGATION,
  normValue,
  sanitiseText,
  canTransition,
  idempotencyKey,
  wouldEscalateInLeadIntake,
  validateSubmitBody,
  evaluateConsent,
  buildLeadIntakePayload,
  buildSubmitSuccess,
  internalMode,
  responseLeaks,
  newCorrelationId,
  fail
};
