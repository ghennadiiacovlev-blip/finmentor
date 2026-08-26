// FINMENTOR — durable submission receipt (G1).
//
// Canonical scope: docs/PHASE_B2_1C_G1_DURABLE_RECOVERY_PLAN.md. This is the LEAD INTAKE
// side of G1: the pure logic that decides what a receipt record contains, when it may move
// state, and what a set of rows read back for a key actually proves.
//
// WHAT PROBLEM THIS SOLVES, precisely.
//
// The Lead Intake graph commits canonically at `Save to Pipeline` (new) or
// `Update Pipeline (Merge)` (merged), and `Respond New Lead` / `Respond Merged` fire
// IMMEDIATELY afterwards — before the CRM sheet, Telegram, the AI plan and the dashboard.
// So the dangerous window is narrow and real: the Pipeline row exists, and the caller may
// never learn its `lead_id`. Nothing in the tenant is indexed by the gateway's stable key,
// so a retry cannot ask "did my submission commit?" — it can only submit again and risk a
// duplicate. That is G1.
//
// WHY TWO PHASES, and why one phase cannot work.
//
// A receipt written only after the Pipeline commit leaves absence ambiguous forever: no row
// could mean "never submitted" or "committed, then died before the receipt". Neither answer
// is safe to guess, so a one-phase receipt can never prove NOT_COMMITTED — it only ever
// proves COMMITTED, and G1's whole difficulty is the other half.
//
// So the receipt is written TWICE:
//
//   1. INTENT  — `commit_state: PENDING`, written BEFORE the Pipeline write.
//   2. COMMIT  — `commit_state: COMMITTED` + `canonical_lead_id`, written AFTER the Pipeline
//                write returns success and BEFORE the respond node.
//
// That ordering is what makes absence provable. If the intent write strictly precedes every
// Pipeline write for a key, then no row for that key means no Pipeline write happened for
// it. The preconditions this rests on are stated in `ABSENCE_PROOF_PRECONDITIONS` and are
// enforced in code, not assumed — see `recovery-adapter.js`, which downgrades absence to
// "cannot answer" whenever they are not proven.
//
// WHAT THIS IS NOT.
//
// Not a second CRM. The ledger answers exactly one question — "did the submission for this
// key reach a canonical Pipeline commit, and which lead did it produce" — and is never
// consulted for lead state, never written by the gateway, never read by the Mini App and
// never mirrored into the read model. `Pipeline` remains canonical for lead state and
// `Bot_Sessions` remains authority for cycle, consent and the canonical lead binding.
//
// Every dependency is INJECTED. This file performs no I/O whatsoever.

const crypto = require('crypto');

// ---------------------------------------------------------------- key

// The stable key, server-derived, exactly as submit-contract.js mints it. Validated here as
// well as there because this module must never accept a key that reached it by any other
// route — a caller-supplied string must fail the shape check, not merely be untrusted.
const KEY_PREFIX = 'miniapp:';
const KEY_RE = /^miniapp:[0-9]{1,20}:[A-Za-z0-9._-]{1,64}$/;

function normValue(v) {
  if (v === null || v === undefined) { return ''; }
  return String(v).trim();
}

// EXACT form only. Deliberately no trimming: normalising the query key would let
// 'miniapp:1:C ' and 'miniapp:1:C' both resolve to one receipt, which is two distinct
// strings mapping to one durable record — the precise ambiguity a keyed ledger exists to
// remove. A padded key did not come from the server minter, so it is refused, not repaired.
function isValidKey(key) {
  if (typeof key !== 'string') { return false; }
  if (key.length === 0 || key.length > 128) { return false; }
  return KEY_RE.test(key);
}

// The key embeds the Telegram user id and the cycle id, which is deliberate: it means the
// ledger needs NO separate identity column, so those values are stored once rather than
// twice. Callers that need the parts derive them; the ledger does not duplicate them.
function parseKey(key) {
  if (!isValidKey(key)) { return { ok: false, reason: 'KEY_INVALID' }; }
  const rest = key.slice(KEY_PREFIX.length);
  const cut = rest.indexOf(':');
  return {
    ok: true,
    telegram_user_id: rest.slice(0, cut),
    cycle_id: rest.slice(cut + 1)
  };
}

// ---------------------------------------------------------------- schema

// Minimal by construction. Every field is here because a named requirement needs it, and
// the ones a reader might expect are deliberately ABSENT:
//
//   telegram_user_id / cycle_id — derivable from the key; storing them again would
//                                 duplicate an identifier for no gain.
//   contact / answers / free text — the ledger resolves an outcome, it does not describe a
//                                   lead. Pipeline already holds the lead.
//   init_data / hash / tokens     — never, anywhere, under any circumstance.
//   request_id                    — NOT a deduplication key (REQUEST_ID_SEMANTICS). Storing
//                                   it here would invite exactly the confusion G7 records.
const RECEIPT_FIELDS = [
  'idempotency_key',    // unique. The ONLY lookup key. Exact match, never a prefix or scan.
  'commit_state',       // PENDING | COMMITTED
  'canonical_lead_id',  // empty while PENDING; written exactly once, at COMMITTED
  'lead_mode',          // new | merged — needed to replay the canonical success verbatim
  'lead_priority',      // ditto
  'financial_zone',     // ditto
  'created_at',         // when intent was written
  'committed_at',       // when the Pipeline commit was observed; empty while PENDING
  'correlation_id'      // server-minted, for tracing one attempt through the logs
];

const COMMIT_STATES = ['PENDING', 'COMMITTED'];

// COMMITTED is terminal. There is no path back to PENDING and no path to a second lead id:
// a receipt describes one outcome for one key, permanently.
const TRANSITIONS = {
  PENDING: ['COMMITTED'],
  COMMITTED: []
};

function canTransition(from, to) {
  const f = normValue(from);
  const t = normValue(to);
  if (COMMIT_STATES.indexOf(f) === -1 || COMMIT_STATES.indexOf(t) === -1) { return false; }
  return (TRANSITIONS[f] || []).indexOf(t) !== -1;
}

// The uniqueness rule, stated as data so a deployment can be checked against it.
const UNIQUENESS_RULE = {
  unique_on: 'idempotency_key',
  cardinality: 'exactly one receipt row per key, for all time',
  enforced_by: 'atomic insert-if-absent in the store',
  // Defence in depth: even where the store cannot enforce it, two rows for one key are
  // DETECTED and fail closed rather than one being picked arbitrarily.
  if_unenforceable: 'duplicate rows for a key resolve to CANNOT_ANSWER, never to a winner'
};

// The preconditions under which "no row" is a PROOF of "did not commit" rather than merely
// an absence. Enforced by recovery-adapter.js; each one that cannot be shown to hold
// downgrades absence to CANNOT_ANSWER.
const ABSENCE_PROOF_PRECONDITIONS = [
  'intent-before-commit: the PENDING receipt is written before the Pipeline write, always',
  'no pre-ledger submissions: the gateway refuses to submit at all without a recovery ' +
    'adapter (PRE_ACTIVATION_BLOCKED), so no key can predate the ledger',
  'read-after-write: a committed intent row is visible to the next read of that key',
  'exact-key lookup: the read selects by key equality, never by scan or prefix'
];

// ---------------------------------------------------------------- records

function newCorrelationId() { return crypto.randomUUID(); }

// Phase 1. Written BEFORE the Pipeline write. Claims nothing about a lead.
function buildIntent(opts) {
  const o = opts || {};
  // Validate the RAW value, not a trimmed copy: the reader refuses a padded key, so a
  // writer that quietly repaired one would create a receipt under a key the reader would
  // never look up in that form. Writer and reader must agree on what a key IS.
  const key = o.idempotencyKey;
  if (!isValidKey(key)) { return { ok: false, reason: 'KEY_INVALID' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  return {
    ok: true,
    record: {
      idempotency_key: key,
      commit_state: 'PENDING',
      canonical_lead_id: '',
      lead_mode: '',
      lead_priority: '',
      financial_zone: '',
      created_at: now,
      committed_at: '',
      correlation_id: normValue(o.correlationId) || newCorrelationId()
    }
  };
}

// Phase 2. Written AFTER the Pipeline write returns success, BEFORE the respond node.
// A commit patch without a canonical lead id is refused: "committed" and "we do not know
// what we created" must never be the same record.
function buildCommit(opts) {
  const o = opts || {};
  // Validate the RAW value, not a trimmed copy: the reader refuses a padded key, so a
  // writer that quietly repaired one would create a receipt under a key the reader would
  // never look up in that form. Writer and reader must agree on what a key IS.
  const key = o.idempotencyKey;
  if (!isValidKey(key)) { return { ok: false, reason: 'KEY_INVALID' }; }
  const leadId = normValue(o.canonicalLeadId);
  if (leadId === '') { return { ok: false, reason: 'LEAD_ID_MISSING' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  return {
    ok: true,
    key: key,
    patch: {
      commit_state: 'COMMITTED',
      canonical_lead_id: leadId,
      lead_mode: normValue(o.leadMode),
      lead_priority: normValue(o.leadPriority),
      financial_zone: normValue(o.financialZone),
      committed_at: now
    }
  };
}

// May this commit be applied to the row that is actually there?
//
// The case this exists for: a receipt already COMMITTED to lead A, and something now tries
// to commit it to lead B. That is one receipt pointing at two leads, and it must fail
// closed — writing it would destroy the only evidence that resolves the earlier ambiguity.
// A repeat commit to the SAME lead is not a conflict; it is a retry of the second phase and
// is safely idempotent.
function planCommit(existingRow, proposedLeadId) {
  const proposed = normValue(proposedLeadId);
  if (proposed === '') { return { ok: false, action: 'REFUSE', reason: 'LEAD_ID_MISSING' }; }
  if (!existingRow || typeof existingRow !== 'object') {
    return { ok: false, action: 'REFUSE', reason: 'NO_INTENT_ROW' };
  }
  const state = normValue(existingRow.commit_state);
  const existingLead = normValue(existingRow.canonical_lead_id);

  if (state === 'PENDING') {
    if (existingLead !== '' && existingLead !== proposed) {
      return { ok: false, action: 'REFUSE', reason: 'PENDING_ROW_ALREADY_NAMES_ANOTHER_LEAD' };
    }
    return { ok: true, action: 'COMMIT' };
  }
  if (state === 'COMMITTED') {
    if (existingLead === proposed) {
      return { ok: true, action: 'ALREADY_COMMITTED_SAME', reason: 'IDEMPOTENT_REPEAT' };
    }
    return { ok: false, action: 'REFUSE', reason: 'CONFLICTING_LEAD_ID' };
  }
  return { ok: false, action: 'REFUSE', reason: 'UNKNOWN_STATE' };
}

// ---------------------------------------------------------------- classification

const VERDICT = {
  COMMITTED: 'COMMITTED',
  ABSENT: 'ABSENT',            // caller decides whether absence is provable
  CANNOT_ANSWER: 'CANNOT_ANSWER'
};

// What does this set of rows, read back for this key, actually prove?
//
// Every ambiguous shape resolves to CANNOT_ANSWER. That is the whole discipline: the only
// answer permitted to release a claim for a fresh attempt is a positive, provable absence,
// and this function never produces one on its own — it reports ABSENT and lets the adapter,
// which knows whether the preconditions hold, decide what absence is worth.
function classifyRows(rows, key) {
  if (!isValidKey(key)) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'KEY_INVALID' };
  }
  if (!Array.isArray(rows)) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'ROWS_UNREADABLE' };
  }

  // Exact key equality only. A prefix or substring match here would be a scan wearing a
  // lookup's clothes, and would let one cycle's receipt answer for another.
  // The stored value is trimmed (a store may pad a cell); the QUERY key is not — it was
  // already required to be exact above.
  const mine = rows.filter((r) => r && typeof r === 'object' &&
    normValue(r.idempotency_key) === key);

  if (mine.length === 0) {
    return { verdict: VERDICT.ABSENT, reason: 'NO_RECEIPT' };
  }
  if (mine.length > 1) {
    // Two receipts for one key means the uniqueness rule was not enforced. Picking a winner
    // would be guessing about a lead that may already exist.
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'DUPLICATE_RECEIPTS' };
  }

  const row = mine[0];
  const state = normValue(row.commit_state);

  if (state === 'PENDING') {
    // The intent committed; whether the Pipeline write did is exactly what we cannot see.
    // This is the residual ambiguous window, and it is resolved by an operator, never by
    // guessing and never by submitting again.
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'PENDING_UNRESOLVED' };
  }
  if (state !== 'COMMITTED') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'UNKNOWN_STATE' };
  }

  const leadId = normValue(row.canonical_lead_id);
  if (leadId === '') {
    // "Committed" asserting no lead is a malformed receipt, not a negative answer.
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'COMMITTED_WITHOUT_LEAD' };
  }

  return {
    verdict: VERDICT.COMMITTED,
    reason: 'RECEIPT_COMMITTED',
    lead_id: leadId,
    lead_mode: normValue(row.lead_mode),
    lead_priority: normValue(row.lead_priority),
    financial_zone: normValue(row.financial_zone)
  };
}

// ---------------------------------------------------------------- logging

// The key embeds a real Telegram user id, so the raw key must not reach a log line. A
// truncated digest is enough to correlate two log entries about the same submission and is
// not reversible into an identity.
function keyDigest(key) {
  const k = normValue(key);
  if (k === '') { return ''; }
  return crypto.createHash('sha256').update(k, 'utf8').digest('hex').slice(0, 16);
}

// The only shape permitted in a log line. No key, no identity, no lead contact data.
function receiptLogView(opts) {
  const o = opts || {};
  return {
    key_digest: keyDigest(o.idempotencyKey),
    commit_state: normValue(o.commitState),
    has_lead_id: normValue(o.canonicalLeadId) !== '',
    verdict: normValue(o.verdict),
    reason: normValue(o.reason),
    correlation_id: normValue(o.correlationId)
  };
}

module.exports = {
  KEY_PREFIX,
  KEY_RE,
  RECEIPT_FIELDS,
  COMMIT_STATES,
  TRANSITIONS,
  UNIQUENESS_RULE,
  ABSENCE_PROOF_PRECONDITIONS,
  VERDICT,
  normValue,
  isValidKey,
  parseKey,
  canTransition,
  buildIntent,
  buildCommit,
  planCommit,
  classifyRows,
  keyDigest,
  receiptLogView,
  newCorrelationId
};
