// FINMENTOR — AI_SAFE_PROJECTION.
//
// Deployed as the n8n Code node "Build AI Work Plan Prompt" in Lead Intake.
//
// The previous prompt sent the model the lead's name, company, email, phone and Telegram
// handle, plus JSON.stringify(raw) — the entire client payload, which also carries the
// submission page URL and its query string, ga_client_id, ga_session_id, consent metadata,
// referrer and every free-text answer. None of that is needed to produce a CFO work plan.
//
// The model now sees only business and diagnostic attributes. Identity stays server-side:
// the workflow already knows which lead this plan belongs to, so the model never needs to.
//
// Three independent layers, so no single mistake leaks a field:
//   1. allowlist  — only named business fields and named raw sections are copied
//   2. key denylist — any key that looks like contact/analytics/identity data is dropped,
//                     at any depth, even inside an allowlisted section
//   3. value scrub — emails, phone-like runs, @handles and URLs are removed from every
//                    surviving string, so PII pasted into a free-text answer is caught
//
// Finally the serialised projection is re-inspected. If anything forbidden survived, the
// AI branch emits nothing rather than sending the payload. Fail closed.

// ---- layer 1: what the model is allowed to see -----------------------------------------
const AI_SAFE_CARD_FIELDS = [
  'business_model', 'industry_category', 'turnover_range', 'employees_range', 'has_cfo',
  'lead_priority', 'financial_zone', 'priority_reason', 'diagnostic_score', 'urgency',
  'main_pain', 'selected_problems', 'selected_goals', 'selected_documents',
  'documents_status', 'work_interest', 'preferred_meeting_format', 'critical_flags',
  'next_action', 'role', 'site_language'
];

// Sections of the raw questionnaire that describe the business rather than the person.
// 'lead' and 'meta' are deliberately absent: those hold contact data and analytics context.
const AI_SAFE_RAW_SECTIONS = [
  'answers', 'signals', 'diagnostic', 'business_profile', 'completion', 'main_pain', 'tool'
];

// ---- layer 2: keys that may never reach the model --------------------------------------
const FORBIDDEN_KEY = /(e?mail|phone|tel(?:egram|ephone)?$|telegram|whatsapp|viber|contact|first_?name|last_?name|full_?name|^name$|company|lead_?id|request_?id|client_?id|session_?id|^sid$|^ga_|utm_|consent|referrer|url|href|link|ip_?addr|user_?agent|cookie|token|password)/i;

// ---- layer 3: value-level scrubbing ----------------------------------------------------
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const HANDLE_RE = /(^|\s)@[A-Za-z0-9_]{3,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

const MAX_STRING = 600;
const MAX_ARRAY = 40;
const MAX_DEPTH = 6;

function scrubString(value) {
  return String(value)
    .replace(EMAIL_RE, '[contact removed]')
    .replace(URL_RE, '[link removed]')
    .replace(HANDLE_RE, '$1[handle removed]')
    .replace(PHONE_RE, '[contact removed]')
    .slice(0, MAX_STRING);
}

function sanitize(value, depth) {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const clean = scrubString(value).trim();
    return clean === '' ? undefined : clean;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const entry of value.slice(0, MAX_ARRAY)) {
      const clean = sanitize(entry, depth + 1);
      if (clean !== undefined) out.push(clean);
    }
    return out.length ? out : undefined;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      const clean = sanitize(value[key], depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function buildAiSafeProjection(item, raw) {
  const card = {};
  for (const field of AI_SAFE_CARD_FIELDS) {
    if (FORBIDDEN_KEY.test(field)) continue;
    const clean = sanitize(item[field], 1);
    if (clean !== undefined) card[field] = clean;
  }

  const questionnaire = {};
  for (const section of AI_SAFE_RAW_SECTIONS) {
    const clean = sanitize(raw[section], 1);
    if (clean !== undefined) questionnaire[section] = clean;
  }

  return { card, questionnaire };
}

// Post-build assertion. Catches anything the layers above missed, including a future field
// added upstream. Returns a reason string when the projection must not be sent.
//
// These deliberately do not reuse the scrubbing regexes above: those carry the /g flag,
// which makes .test() stateful via lastIndex and would skip matches on alternate calls.
const DETECT_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DETECT_PHONE = /\+?\d[\d\s().-]{6,}\d/;
const DETECT_URL = /\b(?:https?:\/\/|www\.)\S+/i;

function projectionLeak(projection) {
  const text = JSON.stringify(projection);
  if (DETECT_EMAIL.test(text)) return 'email-shaped value';
  if (DETECT_PHONE.test(text)) return 'phone-shaped value';
  if (DETECT_URL.test(text)) return 'url';
  for (const key of ['ga_client_id', 'ga_session_id', 'analytics_consent', 'request_id', 'lead_id']) {
    if (text.includes(key)) return 'forbidden key ' + key;
  }
  return '';
}

module.exports = {
  AI_SAFE_CARD_FIELDS,
  AI_SAFE_RAW_SECTIONS,
  FORBIDDEN_KEY,
  scrubString,
  sanitize,
  buildAiSafeProjection,
  projectionLeak
};
