// FINMENTOR Premium UX — the submit projection.
//
// Turns a validated draft into the Lead Intake envelope, and defines what the browser may see.
// Pure logic; qa/premium-ux-submit.test.mjs drives it.
//
// WHAT CHANGED FROM B.2.0, AND WHAT DID NOT. This replaces the answer vocabulary in
// n8n/src/miniapp-submit/submit-contract.js — that module's `ANSWER_SCHEMA` describes the retired
// B.2.0 diagnostic (sector/turnover/cash/profit/treasury/kpi/pain/urgency). The SECURITY posture is
// carried over unchanged and deliberately re-stated here rather than re-derived:
//
//   * the browser cannot steer identity, scoring or cycle state (UNTRUSTED_BODY_KEYS);
//   * `mode` / `lead_mode` are REFUSED at any depth, not merely omitted (N6.2);
//   * answers are read from the SERVER-SIDE draft, never from the submit body.
//
// The last point is stronger than B.2.0 was. In B.2.0 the browser posted its answers with the
// submit call; here the draft already lives in MiniApp_App_Sessions, so submit carries only the
// session id and the privacy acknowledgement. There is nothing to whitelist because there is
// nothing to accept.

'use strict';

const B = require('./branches.js');
const D = require('./draft-contract.js');

const MAX_PAYLOAD_BYTES = 32768;
const ALLOWED_CLIENT_VERSIONS = ['b3.0.0'];

// Body keys the browser may not assert. Presence is not an error — a stale client may still send
// them — but the value is dropped and never read.
const UNTRUSTED_BODY_KEYS = [
  'telegram_user_id', 'chat_id', 'lead_id', 'canonical_lead_id', 'cycle_id',
  'consent_cycle_id', 'consent_at', 'consent_source', 'lead_cycle_id',
  'priority', 'lead_priority', 'financial_zone', 'risk_zone', 'score_zone',
  'submit_state', 'idempotency_key', 'request_id', 'provenance_trusted',
  'internal_route', '__internal_route', 'init_data',
  // new in Premium UX: answers no longer travel in the body at all
  'answers', 'fields', 'draft', 'contact'
];

const CLIENT_RESPONSE_FIELDS = ['ok', 'lead_id', 'priority', 'financial_zone', 'submit_state'];

const RESPONSE_FORBIDDEN_KEYS = [
  'mode', 'lead_mode',
  'init_data', 'hash', 'signature', 'bot_token', 'token', 'credential',
  'chat_id', 'telegram_user_id', 'session_id', 'app_session_id', 'cycle_id',
  'consent_cycle_id', 'lead_cycle_id', 'consent_at', 'idempotency_key',
  'submission_key', 'privacy_legal_basis',
  'raw_json', 'row', 'row_number', 'id', 'notes', 'workflow_id'
];

const byteLength = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.codePointAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : (i++, 4); } return n; };
const str = (v) => String(v === null || v === undefined ? '' : v).trim();
function fail(code, detail) { return { ok: false, error_code: code, detail: detail || '' }; }

// ---------------------------------------------------------------- submit body

// The whole submit body. Four keys, and one of them is optional.
function validateSubmitBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) { return fail('BAD_REQUEST', 'BODY_NOT_OBJECT'); }
  const app = str(body.app_session_id);
  if (!/^AS-[0-9a-f]{64}$/.test(app)) { return fail('BAD_REQUEST', 'BAD_APP_SESSION_ID'); }
  if (body.client_version !== undefined && ALLOWED_CLIENT_VERSIONS.indexOf(str(body.client_version)) === -1) {
    return fail('CLIENT_VERSION_UNSUPPORTED', 'CLIENT_VERSION');
  }
  const ack = body.privacy_ack;
  if (!ack || typeof ack !== 'object' || Array.isArray(ack)) { return fail('BAD_REQUEST', 'PRIVACY_ACK_MISSING'); }
  for (const k of ['notice_version', 'locale', 'shown_at', 'acknowledged_at']) {
    if (!str(ack[k])) { return fail('BAD_REQUEST', 'PRIVACY_ACK_INCOMPLETE:' + k); }
  }
  const dropped = UNTRUSTED_BODY_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
  return { ok: true, app_session_id: app, privacy_ack: ack, dropped_keys: dropped };
}

// ---------------------------------------------------------------- readiness

// Everything mandatory settled, per the draft contract. Called server-side against the STORED
// draft, so a client cannot submit its way past an unanswered question.
function assertSubmittable(draft) {
  const v = D.validateDraft(draft);
  if (!v.ok) { return v; }
  const missing = D.outstanding(draft);
  if (missing.length) { return fail('BAD_REQUEST', 'DRAFT_INCOMPLETE:' + missing.join(',')); }
  return { ok: true };
}

// ---------------------------------------------------------------- projection

const val = (f, name) => {
  const e = f[name];
  if (!e || e.value === null || e.value === undefined) { return ''; }
  return Array.isArray(e.value) ? e.value.join('; ') : String(e.value);
};

// Problem as the CRM should read it: the chosen card, or the client's own words on a free-text
// branch. Never both, never a summary of the two.
function problemText(fields) {
  const objLabel = val(fields, 'objective');
  const obj = B.objectiveByLabel(objLabel);
  if (obj && B.isFreeTextProblem(obj.id)) { return val(fields, 'problem_free_text'); }
  const p = val(fields, 'problem');
  if (p === B.PROBLEM_FREE_TEXT_OPTION) { return val(fields, 'problem_free_text') || p; }
  return p;
}

// Desired outcome, with the one free-text form folded in — OWNER DECISION A: no new column, the
// free text is appended to `selected_goals` rather than given a home of its own.
function outcomeText(fields) {
  const o = val(fields, 'desired_outcome');
  if (o === B.OUTCOME_FREE_TEXT_OPTION) {
    const free = val(fields, 'desired_outcome_free_text');
    return free ? o + ': ' + free : o;
  }
  return o;
}

// Documents in v1 are AVAILABILITY, not files (OWNER DECISION A). `documents_status` states that
// plainly so nobody downstream reads `selected_documents` as an attachment manifest.
function documentsProjection(fields) {
  const list = fields.documents && Array.isArray(fields.documents.value) ? fields.documents.value : [];
  return {
    selected_documents: list.join('; '),
    documents_status: list.length ? 'Указаны доступные материалы (файлы не приложены)' : 'Материалы не указаны'
  };
}

// Contact channel is DERIVED, not stored as a column (OWNER DECISION A).
function contactProjection(fields, telegramUserId) {
  const channel = val(fields, 'contact_channel');
  const value = val(fields, 'contact_value');
  const out = { email: '', phone_or_messenger: '', telegram: str(telegramUserId) };
  if (channel === 'email') { out.email = value; }
  else if (channel === 'phone') { out.phone_or_messenger = value; }
  // 'telegram' → the validated Telegram id is already the reply channel; nothing else is asked.
  return out;
}

// The Lead Intake envelope. Every path below is one Normalize + Score Lead already reads, so
// Lead Intake needs NO change to receive this — Phase 1 §A.
function buildLeadIntakePayload(opts) {
  const o = opts || {};
  const draft = o.draft;
  const fields = (draft && draft.fields) || {};
  const objLabel = val(fields, 'objective');
  const obj = B.objectiveByLabel(objLabel);
  if (!obj) { return fail('BAD_REQUEST', 'UNKNOWN_OBJECTIVE'); }

  const contact = contactProjection(fields, o.telegramUserId);
  const docs = documentsProjection(fields);
  const problem = problemText(fields);
  const outcome = outcomeText(fields);
  const horizon = val(fields, 'decision_horizon');
  const setup = val(fields, 'current_setup');
  const important = val(fields, 'important_context');

  const payload = {
    tool: 'miniapp_premium_brief',
    created_at: str(o.nowIso),
    client: {
      name: val(fields, 'company_name') ? str(o.contactName) : str(o.contactName),
      company: val(fields, 'company_name'),
      role: val(fields, 'role'),
      email: contact.email,
      phone_or_messenger: contact.phone_or_messenger,
      telegram: contact.telegram,
      language: val(fields, 'locale') || 'ru'
    },
    // ЗАДАЧА is the objective LABEL, never a derived phrase (spec §26). It reaches Pipeline
    // `work_interest` through this path.
    answers: {
      business_model: val(fields, 'business_activity'),
      revenue_range: val(fields, 'turnover_band'),
      main_pain: problem
    },
    main_pain: {
      problem: problem,
      // Decision horizon is the urgency string the scorer reads. «Жёсткого срока нет» and
      // «Сначала хочу обсудить подход» must stay NON-urgent through the existing negation guard;
      // qa asserts this rather than trusting it.
      urgency: horizon
    },
    business_profile: {
      industry_category: val(fields, 'business_activity'),
      turnover_range: val(fields, 'turnover_band')
    },
    intake: {
      consent: { privacy_accepted: true },
      commercial_intent: { work_interest: [obj.label] },
      business_pain: { selected_problems: [problem], urgency: horizon },
      documents_available: { status: docs.documents_status, selected_documents: docs.selected_documents ? [docs.selected_documents] : [] }
    },
    // Desired outcome → the existing, previously unused `selected_goals` column.
    selected_goals: outcome,
    // The three normalised projections Phase 2 proposed as BP/BQ/BR. They travel today and are
    // captured in raw_json; they reach columns only once F1 is approved and E1/E2 are deployed.
    premium: {
      current_setup: setup,
      decision_horizon: horizon,
      important_context: important
    },
    meta: {
      consent: true,
      request_id: str(o.correlationId),
      page_url: 'telegram_miniapp_premium',
      utm_source: 'telegram',
      utm_medium: 'miniapp'
    },
    miniapp: { client_version: str(o.clientVersion), objective_id: obj.id }
  };

  // THE SOURCE MARKER IS telegram_miniapp, EXACTLY.
  //
  // Lead Intake's Internal Auth Entry compares it with ===, and anything else is refused as
  // ENVELOPE_SOURCE_INVALID before the payload is looked at. This module said
  // 'telegram_miniapp_premium' — a value nothing accepts — and had never been executed against
  // the live authenticator to find out. The Concierge sends the same marker from
  // Build Internal Handoff; qa/concierge-internal-handoff.test.mjs pins it there and
  // qa/premium-ux-submit-idempotency.test.mjs now pins it here.
  const envelope = { source: 'telegram_miniapp', payload: payload };
  let bytes;
  try { bytes = byteLength(JSON.stringify(envelope)); }
  catch (e) { return fail('BAD_REQUEST', 'PAYLOAD_UNSERIALISABLE'); }
  if (bytes > MAX_PAYLOAD_BYTES) { return fail('BAD_REQUEST', 'PAYLOAD_TOO_LARGE'); }
  return { ok: true, envelope: envelope, payload_bytes: bytes };
}

// ---------------------------------------------------------------- response hygiene

// Refuse, don't omit. A forbidden key at any nesting depth fails the response rather than being
// quietly stripped — N6.2, carried over verbatim in intent.
function responseLeaks(obj, path) {
  const found = [];
  const walk = (v, p) => {
    if (!v || typeof v !== 'object') { return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
    for (const k of Object.keys(v)) {
      if (RESPONSE_FORBIDDEN_KEYS.indexOf(k) !== -1) { found.push((p ? p + '.' : '') + k); }
      walk(v[k], (p ? p + '.' : '') + k);
    }
  };
  walk(obj, path || '');
  return found;
}

function buildClientResponse(result) {
  const out = {};
  for (const k of CLIENT_RESPONSE_FIELDS) { if (result[k] !== undefined) { out[k] = result[k]; } }
  const leaks = responseLeaks(out);
  if (leaks.length) { return fail('BAD_REQUEST', 'RESPONSE_LEAK:' + leaks.join(',')); }
  return { ok: true, response: out };
}

module.exports = {
  MAX_PAYLOAD_BYTES, ALLOWED_CLIENT_VERSIONS,
  UNTRUSTED_BODY_KEYS, CLIENT_RESPONSE_FIELDS, RESPONSE_FORBIDDEN_KEYS,
  validateSubmitBody, assertSubmittable,
  problemText, outcomeText, documentsProjection, contactProjection,
  buildLeadIntakePayload, responseLeaks, buildClientResponse
};
