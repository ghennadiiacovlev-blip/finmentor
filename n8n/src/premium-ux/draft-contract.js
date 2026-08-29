// FINMENTOR Premium UX — the draft + provenance contract.
//
// Implements Phase 2 §7 and the Phase 3 smart-skip rule. Pure logic, no I/O, so the whole model is
// provable offline; qa/premium-ux-draft.test.mjs drives it.
//
// WHAT THIS IS FOR. The approved rule is "FINMENTOR asks only what it does not already know", and
// the dangerous half of that rule is the word "know". A value the system GUESSED is not knowledge.
// So every field carries its provenance, and the skip predicate reads the provenance rather than
// the value. `ai_inferred` can prefill a control; it can never close a question.
//
// WHERE IT LIVES. MiniApp_App_Sessions.draft_json — an unconstrained string column that already
// exists (live, verified). No schema change anywhere: not in the data table, not in Bot_Sessions
// (frozen at AZ by F17), not in Pipeline.

'use strict';

const B = require('./branches.js');

const DRAFT_VERSION = 1;
const MAX_DRAFT_BYTES = 16384;   // Gateway contract §12 body ceiling
const MAX_FREE_TEXT = 500;       // spec-wide free-text cap
const MAX_SHORT_TEXT = 200;

// The closed source vocabulary. Nothing outside this set may be stored.
const SOURCES = ['user_explicit', 'user_confirmed', 'telegram_carried', 'ai_inferred'];

// Only these fields may EVER skip on `telegram_carried`. Deliberately short.
//
// Note on `role`: the approved Entry screen renders «Геннадий · Собственник» as one carried line,
// but Telegram supplies only the NAME. Role is established in TG_CONFIRM_CONTEXT and is therefore
// `user_confirmed`, not `telegram_carried` — it is not in this list. The line may still render as
// designed; the provenance simply differs per half.
const APPROVED_CARRIED = ['contact_name', 'locale', 'contact_channel'];

// Every field the draft may hold, with its shape. `multi` fields store an array; everything else a
// string. An unknown key is rejected rather than ignored, so the browser cannot widen the model.
const FIELDS = {
  company_name:              { kind: 'text',  max: MAX_SHORT_TEXT },
  business_activity:         { kind: 'text',  max: MAX_SHORT_TEXT },
  role:                      { kind: 'text',  max: MAX_SHORT_TEXT },
  turnover_band:             { kind: 'enum',  values: () => B.SCALE_OPTIONS },
  objective:                 { kind: 'enum',  values: () => B.OBJECTIVE_LABELS },
  problem:                   { kind: 'branch_enum', of: 'problem' },
  problem_free_text:         { kind: 'text',  max: MAX_FREE_TEXT },
  desired_outcome:           { kind: 'branch_enum', of: 'outcome' },
  desired_outcome_free_text: { kind: 'text',  max: MAX_FREE_TEXT },
  current_setup:             { kind: 'multi', values: () => B.CURRENT_SETUP.options },
  decision_horizon:          { kind: 'enum',  values: () => B.DECISION_HORIZON.options.map((o) => o[0]) },
  documents:                 { kind: 'multi', values: () => B.DOCUMENTS.options },
  contact_channel:           { kind: 'enum',  values: () => B.CONTACT.options.map((o) => o.id) },
  contact_value:             { kind: 'text',  max: MAX_SHORT_TEXT },
  important_context:         { kind: 'text',  max: MAX_FREE_TEXT },
  locale:                    { kind: 'enum',  values: () => ['ru', 'ro'] }
};
const FIELD_NAMES = Object.keys(FIELDS);

// Fields a client is never asked for and which therefore never appear in a draft. Listed so a
// stale or hostile client sending them is refused loudly rather than silently ignored.
const FORBIDDEN_KEYS = [
  'telegram_user_id', 'chat_id', 'init_data', 'hash', 'signature',
  'lead_id', 'canonical_lead_id', 'cycle_id', 'consent', 'consent_at',
  'consent_cycle_id', 'submission_key', 'privacy_legal_basis', 'submit_state',
  'priority', 'financial_zone', 'request_id'
];

const isStr = (v) => typeof v === 'string';
const byteLength = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.codePointAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : (i++, 4); } return n; };

function fail(code, detail) { return { ok: false, error_code: code, detail: detail || '' }; }

// ---------------------------------------------------------------- an empty draft

function emptyDraft(cycleId) {
  const fields = {};
  for (const name of FIELD_NAMES) { fields[name] = { value: null, source: null, confirmed: false, at: null }; }
  return { v: DRAFT_VERSION, cycle_id: String(cycleId || ''), step: 'APP_BOOTSTRAP', updated_at: null, fields: fields };
}

// ---------------------------------------------------------------- the skip predicate
//
// THE RULE, in one place. A question may be skipped only when the client actually settled it:
// stated it, confirmed it, or it is one of the few identity values carried from Telegram and
// explicitly approved for carrying. `ai_inferred` never satisfies it, alone or in combination.
function canSkip(field, name) {
  if (!field || field.confirmed !== true) { return false; }
  if (field.value === null || field.value === undefined || field.value === '') { return false; }
  if (Array.isArray(field.value) && field.value.length === 0) { return false; }
  if (field.source === 'user_explicit' || field.source === 'user_confirmed') { return true; }
  if (field.source === 'telegram_carried') { return APPROVED_CARRIED.indexOf(name) !== -1; }
  return false; // ai_inferred, null, or anything unrecognised
}

// The first state whose field is not settled — what a resume lands on.
const ASK_ORDER = [
  ['APP_COMPANY', ['company_name', 'business_activity']],
  ['APP_ROLE', ['role']],
  ['APP_SCALE', ['turnover_band']],
  ['APP_OBJECTIVE', ['objective']],
  ['APP_PROBLEM', ['problem']],
  ['APP_DESIRED_OUTCOME', ['desired_outcome']],
  ['APP_CURRENT_SETUP', ['current_setup']],
  ['APP_DECISION_HORIZON', ['decision_horizon']],
  ['APP_DOCUMENTS', []],            // optional — never blocks
  ['APP_CONTACT', ['contact_channel']],
  ['APP_IMPORTANT_CONTEXT', []],    // optional — never blocks
  ['APP_REVIEW', []]
];

// What a given draft actually has to answer. Branch-aware, because the mandatory field for
// APP_PROBLEM is not the same field on every branch: a card branch settles it with `problem`,
// while «Нужен независимый взгляд» and «Другая задача» have no cards at all and settle it with
// `problem_free_text`. The same applies to the one free-text OUTCOME option. Computing this in one
// place is what stops `nextState` and `outstanding` disagreeing — they must never do that, because
// one drives the UI and the other guards submit.
function requiredFor(state, draft) {
  const f = (draft && draft.fields) || {};
  const base = (ASK_ORDER.find((x) => x[0] === state) || [null, []])[1];
  const obj = f.objective && f.objective.value ? B.objectiveByLabel(f.objective.value) : null;

  if (state === 'APP_PROBLEM') {
    if (!obj) { return ['objective']; }
    if (B.isFreeTextProblem(obj.id)) { return ['problem_free_text']; }
    // A card branch where the client chose «Опишу ситуацию своими словами» owes the text too.
    if (f.problem && f.problem.value === B.PROBLEM_FREE_TEXT_OPTION) { return ['problem', 'problem_free_text']; }
    return ['problem'];
  }
  if (state === 'APP_DESIRED_OUTCOME') {
    if (f.desired_outcome && f.desired_outcome.value === B.OUTCOME_FREE_TEXT_OPTION) {
      return ['desired_outcome', 'desired_outcome_free_text'];
    }
    return base;
  }
  return base;
}

function nextState(draft) {
  const f = (draft && draft.fields) || {};
  for (const [state] of ASK_ORDER) {
    for (const name of requiredFor(state, draft)) {
      if (!canSkip(f[name], name)) { return state; }
    }
  }
  return 'APP_REVIEW';
}

function outstanding(draft) {
  const f = (draft && draft.fields) || {};
  const out = [];
  for (const [state] of ASK_ORDER) {
    for (const name of requiredFor(state, draft)) {
      if (!canSkip(f[name], name) && out.indexOf(name) === -1) { out.push(name); }
    }
  }
  return out;
}

// Review may be reached only when everything mandatory is settled.
function isReviewReady(draft) { return outstanding(draft).length === 0; }

// ---------------------------------------------------------------- validation

function validateField(name, entry) {
  const spec = FIELDS[name];
  if (!spec) { return fail('BAD_REQUEST', 'UNKNOWN_FIELD:' + name); }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { return fail('BAD_REQUEST', 'FIELD_NOT_OBJECT:' + name); }

  const allowed = ['value', 'source', 'confirmed', 'at'];
  for (const k of Object.keys(entry)) { if (allowed.indexOf(k) === -1) { return fail('BAD_REQUEST', 'FIELD_EXTRA_KEY:' + name + '.' + k); } }
  if (typeof entry.confirmed !== 'boolean') { return fail('BAD_REQUEST', 'CONFIRMED_NOT_BOOLEAN:' + name); }
  if (entry.source !== null && SOURCES.indexOf(entry.source) === -1) { return fail('BAD_REQUEST', 'BAD_SOURCE:' + name); }
  if (entry.at !== null && !isStr(entry.at)) { return fail('BAD_REQUEST', 'BAD_AT:' + name); }

  const v = entry.value;
  if (v === null) {
    if (entry.confirmed === true) { return fail('BAD_REQUEST', 'CONFIRMED_WITHOUT_VALUE:' + name); }
    return { ok: true };
  }

  if (spec.kind === 'multi') {
    if (!Array.isArray(v)) { return fail('BAD_REQUEST', 'NOT_ARRAY:' + name); }
    const allowedValues = spec.values();
    const seen = new Set();
    for (const x of v) {
      if (!isStr(x)) { return fail('BAD_REQUEST', 'NOT_STRING_ITEM:' + name); }
      if (allowedValues.indexOf(x) === -1) { return fail('BAD_REQUEST', 'VALUE_NOT_ALLOWED:' + name + ':' + x); }
      if (seen.has(x)) { return fail('BAD_REQUEST', 'DUPLICATE_ITEM:' + name + ':' + x); }
      seen.add(x);
    }
    return { ok: true };
  }

  if (!isStr(v)) { return fail('BAD_REQUEST', 'NOT_STRING:' + name); }

  if (spec.kind === 'text') {
    if (v.length > spec.max) { return fail('BAD_REQUEST', 'TOO_LONG:' + name); }
    return { ok: true };
  }
  if (spec.kind === 'enum') {
    if (spec.values().indexOf(v) === -1) { return fail('BAD_REQUEST', 'VALUE_NOT_ALLOWED:' + name); }
    return { ok: true };
  }
  return { ok: true }; // branch_enum is checked in validateDraft, where the objective is known
}

// A problem / outcome value must belong to the branch the client actually chose. This is what
// stops a caller pairing "Недвижимость / сделка" with a Cash Flow problem.
function validateBranchCoherence(fields) {
  const objLabel = fields.objective && fields.objective.value;
  if (!objLabel) {
    for (const n of ['problem', 'desired_outcome']) {
      if (fields[n] && fields[n].value) { return fail('BAD_REQUEST', 'BRANCH_WITHOUT_OBJECTIVE:' + n); }
    }
    return { ok: true };
  }
  const obj = B.objectiveByLabel(objLabel);
  if (!obj) { return fail('BAD_REQUEST', 'UNKNOWN_OBJECTIVE'); }

  const pv = fields.problem && fields.problem.value;
  if (pv) {
    if (B.isFreeTextProblem(obj.id)) { return fail('BAD_REQUEST', 'PROBLEM_CARD_ON_FREE_TEXT_BRANCH'); }
    if (B.problemLabels(obj.id).indexOf(pv) === -1) { return fail('BAD_REQUEST', 'PROBLEM_NOT_IN_BRANCH'); }
  }
  const ov = fields.desired_outcome && fields.desired_outcome.value;
  if (ov && B.outcomeLabels(obj.id).indexOf(ov) === -1) { return fail('BAD_REQUEST', 'OUTCOME_NOT_IN_BRANCH'); }

  // Free-text branches must carry their text; card branches must not invent one unless the client
  // chose «Опишу ситуацию своими словами».
  const ft = fields.problem_free_text && fields.problem_free_text.value;
  if (ft && !B.isFreeTextProblem(obj.id) && pv !== B.PROBLEM_FREE_TEXT_OPTION) {
    return fail('BAD_REQUEST', 'UNEXPECTED_PROBLEM_FREE_TEXT');
  }
  const oft = fields.desired_outcome_free_text && fields.desired_outcome_free_text.value;
  if (oft && ov !== B.OUTCOME_FREE_TEXT_OPTION) { return fail('BAD_REQUEST', 'UNEXPECTED_OUTCOME_FREE_TEXT'); }
  return { ok: true };
}

function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) { return fail('BAD_REQUEST', 'DRAFT_NOT_OBJECT'); }
  if (draft.v !== DRAFT_VERSION) { return fail('BAD_REQUEST', 'BAD_VERSION'); }

  const top = ['v', 'cycle_id', 'step', 'updated_at', 'fields'];
  for (const k of Object.keys(draft)) { if (top.indexOf(k) === -1) { return fail('BAD_REQUEST', 'DRAFT_EXTRA_KEY:' + k); } }
  if (!draft.fields || typeof draft.fields !== 'object' || Array.isArray(draft.fields)) { return fail('BAD_REQUEST', 'FIELDS_NOT_OBJECT'); }

  for (const k of Object.keys(draft.fields)) {
    if (FORBIDDEN_KEYS.indexOf(k) !== -1) { return fail('BAD_REQUEST', 'FORBIDDEN_KEY:' + k); }
    const r = validateField(k, draft.fields[k]);
    if (!r.ok) { return r; }
  }
  const coh = validateBranchCoherence(draft.fields);
  if (!coh.ok) { return coh; }

  let serialised;
  try { serialised = JSON.stringify(draft); }
  catch (e) { return fail('BAD_REQUEST', 'DRAFT_UNSERIALISABLE'); }
  const bytes = byteLength(serialised);
  if (bytes > MAX_DRAFT_BYTES) { return fail('BAD_REQUEST', 'DRAFT_TOO_LARGE'); }

  return { ok: true, bytes: bytes };
}

// ---------------------------------------------------------------- mutation

// Set one field. `at` is supplied by the caller (the node), never read from the browser.
function setField(draft, name, value, source, confirmed, nowIso) {
  if (!FIELDS[name]) { return fail('BAD_REQUEST', 'UNKNOWN_FIELD:' + name); }
  if (SOURCES.indexOf(source) === -1) { return fail('BAD_REQUEST', 'BAD_SOURCE:' + name); }
  const next = JSON.parse(JSON.stringify(draft));
  let v = value;
  // Canonical order for multi-selects, so two clients who ticked the same boxes in a different
  // order produce the same stored value and the same CRM cell.
  if (FIELDS[name].kind === 'multi' && Array.isArray(v)) {
    const order = FIELDS[name].values();
    v = order.filter((x) => v.indexOf(x) !== -1);
  }
  next.fields[name] = { value: v, source: source, confirmed: confirmed === true, at: confirmed === true ? String(nowIso) : null };
  next.updated_at = String(nowIso);
  const r = validateDraft(next);
  if (!r.ok) { return r; }
  return { ok: true, draft: next };
}

// TG_CONFIRM_CONTEXT «Всё верно» — promote every shown ai_inferred value to user_confirmed.
// This is the ONLY route out of ai_inferred, and it requires an explicit client action.
function confirmContext(draft, names, nowIso) {
  const next = JSON.parse(JSON.stringify(draft));
  for (const name of names) {
    const f = next.fields[name];
    if (!f || f.value === null || f.value === '') { continue; }
    if (f.source === 'ai_inferred' || f.source === 'telegram_carried') {
      f.source = 'user_confirmed';
      f.confirmed = true;
      f.at = String(nowIso);
    }
  }
  next.updated_at = String(nowIso);
  const r = validateDraft(next);
  if (!r.ok) { return r; }
  return { ok: true, draft: next };
}

module.exports = {
  DRAFT_VERSION, MAX_DRAFT_BYTES, MAX_FREE_TEXT, SOURCES, APPROVED_CARRIED,
  FIELDS, FIELD_NAMES, FORBIDDEN_KEYS, ASK_ORDER,
  emptyDraft, canSkip, requiredFor, nextState, outstanding, isReviewReady,
  validateField, validateBranchCoherence, validateDraft, setField, confirmContext
};
