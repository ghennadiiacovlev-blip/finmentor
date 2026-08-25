// FINMENTOR — Mini App resume read-model projection (B.2.1-B, Phase 10).
//
// Deployed into two n8n Code nodes: the mirror helper that publishes the derived row, and
// the fast read node that serves Mini App resume. Bot_Sessions stays the sole authority;
// the Data Table is a derived, non-authoritative read model.
//
// This module exists because the PR #10 QA runs got the *verification* wrong, not the CAS
// primitive. Two defects, both closed here:
//
//   1. The conditional publish set omitted mirrored fields (session_id, and on the live
//      path also urgency, consent_at and lead_intake_ok). A stale session_id of S-CAS
//      survived a generation that intended S-GEN-A2.
//   2. projection_version was recomputed from the helper's *intended* payload, so the hash
//      matched even though the stored row did not. A verifier that hashes what it meant to
//      write can never detect an incomplete write.
//
// The rule enforced here: derived-state equality is always computed from the row actually
// read back out of the Data Table, field-by-field, over the complete field set.
//
// n8n Cloud Code-sandbox constraints (proven in B.2.1-A): require('crypto') is available,
// WebCrypto and URLSearchParams are not. Nothing here needs either.

const crypto = require('crypto');

// The complete mirrored projection, in canonical hash order. Adding a field here changes
// every projection_version, which is intended: a schema change must invalidate the cache.
const PROJECTION_FIELDS = [
  'chat_id',
  'session_id',
  'state',
  'status',
  'selected_service',
  'business_model',
  'main_pain',
  'urgency',
  'consent',
  'lead_id',
  'cycle_id',
  'consent_cycle_id',
  'consent_at',
  'lead_cycle_id',
  'lead_intake_ok'
];

// Cache-control metadata. Written by the helper, never hashed, never sent to the browser.
const CONTROL_FIELDS = [
  'cache_valid',
  'sync_token',
  'projection_version',
  'source_updated_at',
  'mirror_updated_at'
];

// n8n Data Table's own row metadata.
const DATA_TABLE_INTERNALS = ['id', 'createdAt', 'updatedAt'];

// Never mirrored out of Bot_Sessions, even if a future authoritative row grows them.
const NEVER_MIRROR = ['notes', 'previous_lead_id', 'raw', 'raw_json', 'payload', 'init_data'];

// Fields the browser receives. A strict whitelist, disjoint from CONTROL_FIELDS.
const CLIENT_FIELDS = [
  'state',
  'status',
  'selected_service',
  'business_model',
  'main_pain',
  'urgency'
];

// Google Sheets hands back strings; the Data Table round-trips booleans and numbers as
// themselves. Both sides must normalise to the same scalar, or a boolean true would hash
// differently from the string 'true' it was read back as.
function normValue(v) {
  if (v === null || v === undefined) { return ''; }
  if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
  if (typeof v === 'number') { return String(v); }
  return String(v).trim();
}

// Deterministic serialisation. JSON.stringify on each key and value keeps a value that
// contains the separator from forging a field boundary.
function canonicalize(projection) {
  const parts = [];
  for (let i = 0; i < PROJECTION_FIELDS.length; i++) {
    const f = PROJECTION_FIELDS[i];
    parts.push(JSON.stringify(f) + ':' + JSON.stringify(normValue(projection[f])));
  }
  return parts.join('\n');
}

function projectionVersion(projection) {
  return crypto.createHash('sha256').update(canonicalize(projection), 'utf8').digest('hex');
}

// Build the safe projection from an authoritative Bot_Sessions row. Allowlist only, so raw
// and legacy columns cannot reach the derived table by accident.
function buildSafeProjection(authRow) {
  const row = authRow || {};
  const out = {};
  for (let i = 0; i < PROJECTION_FIELDS.length; i++) {
    const f = PROJECTION_FIELDS[i];
    out[f] = normValue(row[f]);
  }
  return out;
}

// Reduce a stored Data Table row to its projection, dropping control metadata and n8n
// internals. Absent keys stay absent so storedRowDefects can see the omission.
function stripStoredRow(row) {
  const src = row || {};
  const out = {};
  for (let i = 0; i < PROJECTION_FIELDS.length; i++) {
    const f = PROJECTION_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(src, f)) {
      out[f] = normValue(src[f]);
    }
  }
  return out;
}

// A derived row is malformed if any mirrored field is missing outright, if the lookup key
// is empty, or if a never-mirror field leaked in. A blank cycle_id is NOT malformed:
// legacy blank-cycle rows legitimately exist and are handled by the cycle evaluator.
function storedRowDefects(row) {
  const src = row || {};
  const defects = [];
  for (let i = 0; i < PROJECTION_FIELDS.length; i++) {
    const f = PROJECTION_FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(src, f)) { defects.push('missing_field:' + f); }
  }
  if (normValue(src.chat_id) === '') { defects.push('empty_chat_id'); }
  for (let j = 0; j < NEVER_MIRROR.length; j++) {
    if (Object.prototype.hasOwnProperty.call(src, NEVER_MIRROR[j])) {
      defects.push('forbidden_field:' + NEVER_MIRROR[j]);
    }
  }
  return defects;
}

function diffProjections(expected, actual) {
  const diff = [];
  for (let i = 0; i < PROJECTION_FIELDS.length; i++) {
    const f = PROJECTION_FIELDS[i];
    if (normValue(expected[f]) !== normValue(actual[f])) { diff.push(f); }
  }
  return diff;
}

// Post-publish verification. rows is the limit-2 read-back; expected is the projection
// built from the authoritative re-read. The version is recomputed from the STORED row.
function verifyStoredRow(opts) {
  const o = opts || {};
  const rows = o.rows || [];
  const commitToken = o.commitToken;
  const expected = o.expected || {};

  if (o.error) { return { ok: false, reason: 'DATA_TABLE_ERROR' }; }
  if (rows.length === 0) { return { ok: false, reason: 'MISSING_ROW' }; }
  if (rows.length > 1) { return { ok: false, reason: 'DUPLICATE_ROWS', row_count: rows.length }; }

  const row = rows[0];
  if (normValue(row.sync_token) !== normValue(commitToken)) {
    return { ok: false, reason: 'TOKEN_MISMATCH' };
  }
  if (normValue(row.cache_valid) !== 'true') {
    return { ok: false, reason: 'NOT_PUBLISHED' };
  }

  const defects = storedRowDefects(row);
  if (defects.length) { return { ok: false, reason: 'MALFORMED_ROW', defects: defects }; }

  const stored = stripStoredRow(row);
  const diff = diffProjections(expected, stored);
  if (diff.length) { return { ok: false, reason: 'FIELD_MISMATCH', fields: diff }; }

  // Hashed from the stored projection. This is the line that would have caught the
  // reversed-order session_id defect.
  const storedVersion = projectionVersion(stored);
  if (storedVersion !== normValue(row.projection_version)) {
    return { ok: false, reason: 'VERSION_MISMATCH' };
  }
  if (storedVersion !== projectionVersion(expected)) {
    return { ok: false, reason: 'VERSION_MISMATCH' };
  }
  return { ok: true, reason: 'VERIFIED', projection_version: storedVersion, projection: stored };
}

// Mini App fast read. rows is the limit-2 lookup by chat_id. Limit 2 is deliberate: a
// limit-1 read cannot distinguish a healthy row from the first of two corrupted ones.
function evaluateFastRead(opts) {
  const o = opts || {};
  const rows = o.rows || [];
  if (o.error) { return { decision: 'FALLBACK', reason: 'DATA_TABLE_ERROR' }; }
  if (rows.length === 0) { return { decision: 'FALLBACK', reason: 'MISS' }; }
  if (rows.length > 1) { return { decision: 'FALLBACK', reason: 'DUPLICATE_ROWS', row_count: rows.length }; }

  const row = rows[0];
  if (normValue(row.cache_valid) !== 'true') { return { decision: 'FALLBACK', reason: 'TOMBSTONE' }; }

  const defects = storedRowDefects(row);
  if (defects.length) { return { decision: 'FALLBACK', reason: 'MALFORMED_ROW', defects: defects }; }

  const stored = stripStoredRow(row);
  if (projectionVersion(stored) !== normValue(row.projection_version)) {
    return { decision: 'FALLBACK', reason: 'VERSION_MISMATCH' };
  }
  return { decision: 'HIT', reason: 'CACHE_VALID', projection: stored };
}

// Read-only cycle evaluation. Blank cycle_id never validates a blank consent/lead binding.
function evaluateCycle(projection) {
  const p = projection || {};
  const cycleId = normValue(p.cycle_id);
  const consentCurrent = cycleId !== '' &&
    normValue(p.consent) === 'yes' &&
    normValue(p.consent_cycle_id) === cycleId;
  const leadCurrent = cycleId !== '' &&
    normValue(p.lead_id) !== '' &&
    normValue(p.lead_cycle_id) === cycleId;
  return { cycle_id: cycleId, consent_current: consentCurrent, lead_current: leadCurrent };
}

// The Mini App response. Whitelist only, and asserted disjoint from control metadata.
// cycle_created is structurally false: resume never mints a cycle.
function buildClientResume(projection, source) {
  const p = projection || {};
  const cycle = evaluateCycle(p);
  const resume = {};
  for (let i = 0; i < CLIENT_FIELDS.length; i++) {
    resume[CLIENT_FIELDS[i]] = normValue(p[CLIENT_FIELDS[i]]);
  }
  return {
    ok: true,
    resume: resume,
    consent_current: cycle.consent_current,
    lead_current: cycle.lead_current,
    resume_source: source,
    cycle_created: false,
    cycle_reset: 'none',
    writes: { sheets_writes: 0, data_table_writes: 0, lead_intake_calls: 0, consent_writes: 0 }
  };
}

// Recursive leak check over anything about to be returned to the browser. Identity and
// control metadata are both forbidden in the client response.
function leakFields(obj) {
  const forbidden = CONTROL_FIELDS.concat(DATA_TABLE_INTERNALS).concat(NEVER_MIRROR)
    .concat(['chat_id', 'session_id', 'lead_id', 'cycle_id', 'consent_cycle_id', 'lead_cycle_id']);
  const found = [];
  function walk(node) {
    if (!node || typeof node !== 'object') { return; }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) { walk(node[i]); }
      return;
    }
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      if (forbidden.indexOf(keys[i]) !== -1 && found.indexOf(keys[i]) === -1) { found.push(keys[i]); }
      walk(node[keys[i]]);
    }
  }
  walk(obj);
  return found;
}

module.exports = {
  PROJECTION_FIELDS,
  CONTROL_FIELDS,
  DATA_TABLE_INTERNALS,
  NEVER_MIRROR,
  CLIENT_FIELDS,
  normValue,
  canonicalize,
  projectionVersion,
  buildSafeProjection,
  stripStoredRow,
  storedRowDefects,
  diffProjections,
  verifyStoredRow,
  evaluateFastRead,
  evaluateCycle,
  buildClientResume,
  leakFields
};
