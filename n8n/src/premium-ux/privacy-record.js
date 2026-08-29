// FINMENTOR Premium UX — the privacy acknowledgement record.
//
// Builds the row that proves WHICH notice was presented and acknowledged for a consultation
// request. Pure logic; the store itself is designed but NOT created (owner decision B).
// qa/premium-ux-brief.test.mjs drives this alongside the meeting brief.
//
// ONE IMMUTABLE RECORD, NOT AN EVENT STREAM. Owner decision B asked for the smaller defensible
// model, so:
//
//   * `shown_at` is captured client-side and travels WITH the acknowledgement action. No server
//     write happens at show time, so nothing later needs an UPDATE to become "acknowledged" —
//     which is what would have made the append-only claim dishonest.
//   * A "shown but never acknowledged" row has no evidentiary value. The obligation is to prove
//     what was ACKNOWLEDGED, not what was rendered; a row for every impression is a second
//     analytics dataset with none of the benefit.
//   * One row per `submission_key` is idempotent by construction: the retry does
//     `on conflict (submission_key) do nothing`, exactly the CTE shape G5 already proved.
//     An event model would need a join to answer the only question that is ever asked.
//
// WHAT IT MUST NEVER CARRY. The record is deliberately almost empty. It links to the request by an
// opaque `submission_key` — the identity the cycle issuer already mints — and carries no personal
// data at all. `FORBIDDEN` below is refused rather than stripped, so reintroducing any of it fails
// loudly instead of quietly widening a legal record into a second CRM.

'use strict';

const RECORD_KEYS = [
  'submission_key', 'cycle_id',
  'privacy_notice_version', 'privacy_locale',
  'privacy_notice_shown_at', 'privacy_notice_acknowledged_at',
  'privacy_legal_basis',
  'marketing_consent', 'marketing_consent_at'
];

// Refused at any depth. Not "omitted" — refused, so a future edit cannot leak them by accident.
const FORBIDDEN = [
  'init_data', 'hash', 'signature', 'bot_token', 'token', 'credential',
  'telegram_user_id', 'chat_id', 'username', 'first_name', 'last_name',
  'name', 'company', 'email', 'phone', 'telegram', 'contact_value',
  'problem', 'problem_free_text', 'important_context', 'desired_outcome',
  'current_setup', 'documents', 'raw_json', 'lead_id', 'payload'
];

// Until legal review lands, fixtures and candidates use this and nothing else. Owner decision B:
// do not hard-code a final Moldovan legal-basis value yet.
const PENDING_LEGAL_BASIS = 'PENDING_LEGAL_REVIEW';

const str = (v) => String(v === null || v === undefined ? '' : v).trim();
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v);
function fail(code, detail) { return { ok: false, error_code: code, detail: detail || '' }; }

function leaks(obj) {
  const found = [];
  const walk = (v, p) => {
    if (!v || typeof v !== 'object') { return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
    for (const k of Object.keys(v)) {
      if (FORBIDDEN.indexOf(k) !== -1) { found.push((p ? p + '.' : '') + k); }
      walk(v[k], (p ? p + '.' : '') + k);
    }
  };
  walk(obj, '');
  return found;
}

// `submissionKey` is the authoritative opaque identity, read from Bot_Sessions — never from the
// browser. `ack` is the client-supplied acknowledgement envelope, already shape-checked by
// submit-projection.validateSubmitBody.
function buildPrivacyRecord(opts) {
  const o = opts || {};
  const ack = o.ack || {};

  const submissionKey = str(o.submissionKey);
  if (!/^sub_[0-9a-f]{32}$/.test(submissionKey)) { return fail('BAD_REQUEST', 'BAD_SUBMISSION_KEY'); }

  const version = str(ack.notice_version);
  const locale = str(ack.locale);
  if (!version) { return fail('BAD_REQUEST', 'MISSING_NOTICE_VERSION'); }
  if (['ru', 'ro'].indexOf(locale) === -1) { return fail('BAD_REQUEST', 'BAD_LOCALE'); }
  if (!isIso(str(ack.shown_at))) { return fail('BAD_REQUEST', 'BAD_SHOWN_AT'); }
  if (!isIso(str(ack.acknowledged_at))) { return fail('BAD_REQUEST', 'BAD_ACKNOWLEDGED_AT'); }
  if (Date.parse(ack.acknowledged_at) < Date.parse(ack.shown_at)) { return fail('BAD_REQUEST', 'ACK_BEFORE_SHOWN'); }

  // Marketing consent is separate and optional, and is NEVER required to submit. `null` means
  // never asked — structurally distinct from `false`, which means asked and declined.
  let marketing = null;
  let marketingAt = null;
  if (o.marketingConsent !== undefined && o.marketingConsent !== null) {
    if (typeof o.marketingConsent !== 'boolean') { return fail('BAD_REQUEST', 'BAD_MARKETING_CONSENT'); }
    marketing = o.marketingConsent;
    if (marketing === true) {
      if (!isIso(str(o.marketingConsentAt))) { return fail('BAD_REQUEST', 'BAD_MARKETING_CONSENT_AT'); }
      marketingAt = str(o.marketingConsentAt);
    }
  }

  const record = {
    submission_key: submissionKey,
    cycle_id: str(o.cycleId) || null,
    privacy_notice_version: version,
    privacy_locale: locale,
    privacy_notice_shown_at: str(ack.shown_at),
    privacy_notice_acknowledged_at: str(ack.acknowledged_at),
    privacy_legal_basis: str(o.legalBasis) || PENDING_LEGAL_BASIS,
    marketing_consent: marketing,
    marketing_consent_at: marketingAt
  };

  for (const k of Object.keys(record)) { if (RECORD_KEYS.indexOf(k) === -1) { return fail('BAD_REQUEST', 'UNEXPECTED_KEY:' + k); } }
  const found = leaks(record);
  if (found.length) { return fail('BAD_REQUEST', 'PRIVACY_RECORD_LEAK:' + found.join(',')); }

  return { ok: true, record: record };
}

// The insert the endpoint issues. Idempotent by conflict, never by read-then-write: a retry after
// an ambiguous outcome produces no second row and no error.
const INSERT_SQL = [
  'insert into public.privacy_acknowledgements',
  '  (submission_key, cycle_id, privacy_notice_version, privacy_locale,',
  '   privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis,',
  '   marketing_consent, marketing_consent_at)',
  'values ($1, nullif($2, \'\'), $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9::timestamptz)',
  'on conflict (submission_key) do nothing'
].join('\n');

function insertParams(record) {
  return [
    record.submission_key,
    record.cycle_id || '',
    record.privacy_notice_version,
    record.privacy_locale,
    record.privacy_notice_shown_at,
    record.privacy_notice_acknowledged_at,
    record.privacy_legal_basis,
    record.marketing_consent,
    record.marketing_consent_at
  ];
}

module.exports = { RECORD_KEYS, FORBIDDEN, PENDING_LEGAL_BASIS, buildPrivacyRecord, leaks, INSERT_SQL, insertParams };
