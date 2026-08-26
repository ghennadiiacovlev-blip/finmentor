// FINMENTOR — preallocated submission receipt (G1, P3 architecture).
//
// Canonical scope: docs/PHASE_B2_1C_G1_P3_PREALLOCATION_DECISION.md.
//
// WHY THIS WAS REDESIGNED.
//
// P2 took the original design to the tenant and it failed: the n8n Data Table has NO atomic
// insert-if-absent. The `dataTable` node's row operations are deleteRows / get / rowExists /
// rowNotExists / insert / update / upsert — `insert` is unconditional, `upsert` is
// match-then-write, and rowExists+insert is the "broad lookup + create" race this design
// forbids. Confirmed live: two inserts of the same key both succeeded. Evidence in
// docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md.
//
// So the submit path can no longer CREATE its receipt. The receipt must already exist.
//
// THE PREALLOCATION INVARIANT — the one sentence this file exists to hold:
//
//     A CURRENT AUTHORITATIVE CYCLE NEVER EXISTS WITHOUT ITS PREALLOCATED RECEIPT.
//
// The receipt is created at cycle issuance, BEFORE the cycle becomes authoritative. The
// submit path then only ever performs CONDITIONAL UPDATES — the one primitive Phase 10 did
// prove live in this tenant.
//
// WHAT THAT BUYS, and it is the whole point:
//
//   * absence stops being an answer. Under the old design "no row" meant "nothing was
//     created, go ahead and submit" — an inference that could create a duplicate lead if the
//     store was merely slow. Now a missing receipt for a current cycle is a BROKEN INVARIANT,
//     and the only safe response is CANNOT_ANSWER. Read-after-write therefore stops being a
//     safety prerequisite (P1-L3) and becomes a liveness property.
//   * READY is POSITIVE evidence that no Lead Intake handoff began. That is what permits a
//     submit, and it is evidence rather than an inference from silence.
//   * the durable key stops being derived from the Telegram identity, so the ledger holds no
//     personal identifier at all — which retires the P1.3 §3.1 privacy compromise outright.
//
// Every dependency is INJECTED. This file performs no I/O whatsoever.

const crypto = require('crypto');

function normValue(v) {
  if (v === null || v === undefined) { return ''; }
  return String(v).trim();
}

// ---------------------------------------------------------------- the submission key

// MODEL B. An opaque, server-minted, cryptographically random key — NOT derived from the
// Telegram user id or the cycle id.
//
// Model A (keep `miniapp:<telegram_user_id>:<cycle_id>` with a strengthened cycle generator)
// was rejected on evidence, not preference. The decisive problem is that the current cycle id
// is `C-<chat_id>-<Date.now()>`: two issuances for one chat in the same millisecond produce
// the IDENTICAL cycle id, and therefore the identical derived receipt key — at which point
// preallocation needs insert-if-absent to arbitrate, which P2 proved does not exist. A
// derived key cannot escape that, because its uniqueness is only ever as good as the cycle
// id's. A random key is unique by construction regardless of what the cycle generator does.
//
// 128 bits from crypto.randomBytes. Stated honestly: this is a PROBABILISTIC guarantee, not
// a mathematical impossibility. At 128 bits the collision probability across any realistic
// number of cycles this business will ever issue is far below the probability of the store
// itself losing a row, which is the correct comparison to make.
const SUBMISSION_KEY_BYTES = 16;
const SUBMISSION_KEY_PREFIX = 'sub_';
const SUBMISSION_KEY_RE = /^sub_[0-9a-f]{32}$/;

function mintSubmissionKey() {
  return SUBMISSION_KEY_PREFIX + crypto.randomBytes(SUBMISSION_KEY_BYTES).toString('hex');
}

// EXACT form only. No trimming, no repair: the key is server-minted, so anything that is not
// exactly the minted shape did not come from the minter.
function isValidSubmissionKey(key) {
  if (typeof key !== 'string') { return false; }
  return SUBMISSION_KEY_RE.test(key);
}

const SUBMISSION_KEY_MODEL = {
  model: 'B — opaque server-minted random key',
  format: 'sub_<32 lowercase hex>',
  entropy_bits: SUBMISSION_KEY_BYTES * 8,
  minted_by: 'the cycle issuer (Concierge), server-side, at cycle issuance',
  persisted_in: 'Bot_Sessions.submission_key, alongside the authoritative cycle',
  derived_from_identity: false,
  guessable: false,
  crosses_tb1: false,
  browser_may_supply: false,
  collision_model: 'probabilistic: 128-bit random. Not claimed impossible — claimed far less ' +
    'likely than the store losing a row'
};

// ---------------------------------------------------------------- receipt authority

// Unchanged from P1.3 and still binding. An unguessable key is NOT a substitute for route
// authentication: P1-L10 remains required. A random key removes the *targeted* poisoning
// threat (an attacker cannot guess a victim's key) but it does not stop an authenticated-
// looking public caller from mutating a key it has somehow learned, and provenance must never
// come from anything a caller can assert.
const RECEIPT_AUTHORITY = {
  source: 'route provenance only',
  proven_by: "$('Internal Auth Entry').first().json.__internal_route === true",
  never_from: [
    'a payload body field',
    'an HTTP header',
    'a query parameter',
    'any caller assertion of any kind'
  ],
  public_route_behaviour: 'receipt controls are IGNORED: no receipt is read, created or updated',
  marker_in_body_is_not_provenance: true,
  // Explicit, because "the key is random now" is exactly the argument someone will make.
  unguessable_key_is_not_a_substitute_for_route_auth: true
};

function resolveReceiptKey(opts) {
  const o = opts || {};
  if (o.provenanceTrusted !== true) {
    return { allowed: false, reason: 'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', key: '' };
  }
  if (!isValidSubmissionKey(o.submissionKey)) {
    return { allowed: false, reason: 'SUBMISSION_KEY_INVALID', key: '' };
  }
  return { allowed: true, reason: 'TRUSTED_ROUTE', key: o.submissionKey };
}

// ---------------------------------------------------------------- schema

// Ten fields. `idempotency_key` is gone, replaced by `submission_key`; the identity fields it
// used to embed are gone with it, so the ledger now holds NO personal identifier.
const RECEIPT_FIELDS = [
  'submission_key',     // unique. The ONLY lookup key. Opaque, random, identity-free
  'commit_state',       // READY | IN_FLIGHT | COMMITTED | ABORTED
  'canonical_lead_id',  // empty until COMMITTED; written exactly once
  'lead_mode',          // needed to replay the canonical success verbatim
  'lead_priority',      // ditto
  'financial_zone',     // ditto
  'created_at',         // when the receipt was PREALLOCATED, at cycle issuance
  'claimed_at',         // when READY -> IN_FLIGHT succeeded
  'settled_at',         // when COMMITTED or ABORTED was recorded
  'correlation_id'      // server-minted; the only field that reaches a log line
];

// READY replaces the old submit-time "insert an intent" step. PENDING was renamed IN_FLIGHT
// because under preallocation both READY and the old PENDING would have been "a row exists
// and no lead is recorded" — two very different situations that must never share a name.
const RECEIPT_STATES = ['READY', 'IN_FLIGHT', 'COMMITTED', 'ABORTED'];

const ABORT_REASONS = ['PROVEN_NO_PIPELINE_COMMIT'];

// COMMITTED and ABORTED are terminal. READY -> ABORTED is permitted: an operator may close a
// key that was preallocated but never used, and doing so is strictly safer than leaving it
// claimable for ever.
const TRANSITIONS = {
  READY: ['IN_FLIGHT', 'ABORTED'],
  IN_FLIGHT: ['COMMITTED', 'ABORTED'],
  COMMITTED: [],
  ABORTED: []
};

function canTransition(from, to) {
  const f = normValue(from);
  const t = normValue(to);
  if (RECEIPT_STATES.indexOf(f) === -1 || RECEIPT_STATES.indexOf(t) === -1) { return false; }
  return (TRANSITIONS[f] || []).indexOf(t) !== -1;
}

// ---------------------------------------------------------------- issuance ordering

// The order is the safety property, so it is declared as data rather than left to whoever
// wires the workflow.
const ISSUANCE_ORDER = [
  '1. mint a new submission_key server-side (random, not derived)',
  '2. create the receipt in state READY',
  '3. CONFIRM the receipt creation succeeded — not "the node did not error", but confirmed',
  '4. only then write the new cycle + submission_key to Bot_Sessions (authority)',
  '5. only after the authority commit may a Mini App session bind to that cycle'
];

const PREALLOCATION_INVARIANT = {
  rule: 'a current authoritative cycle never exists without its preallocated receipt',
  if_receipt_create_fails: 'the authority cycle MUST NOT advance — the old cycle stays current',
  if_authority_write_fails: 'an orphan receipt remains, but no current cycle points to it; ' +
    'harmless, and cleaned up later',
  orphan_receipt_is_never_authority: 'a receipt cannot make itself current — only Bot_Sessions ' +
    'names the authoritative submission_key',
  // The concurrency answer, stated up front because P2/P3 proved issuance is NOT single-writer.
  concurrent_issuance: 'each issuer mints its OWN random key and preallocates its OWN receipt. ' +
    'Both may persist. Bot_Sessions appendOrUpdate decides the winner by last-write-wins, and ' +
    'the gateway only ever uses the key named by the CURRENT authority row. The loser is an ' +
    'orphan that can never satisfy the winner, because the winner reads a different key.',
  data_table_does_not_arbitrate: true
};

// ---------------------------------------------------------------- records

function newCorrelationId() { return crypto.randomUUID(); }

// Step 2 of ISSUANCE_ORDER. Creates the receipt in READY, before the cycle is authoritative.
//
// This is an unconditional INSERT — which is all the platform offers, and which is now SAFE
// precisely because the key is random and minted once. Nothing else will ever try to insert
// this key, so there is nothing for insert-if-absent to arbitrate. That is the trick the whole
// redesign turns on: uniqueness moved from the store to the key generator.
function buildPreallocation(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }

  const correlationId = normValue(o.correlationId) || newCorrelationId();
  if (correlationId.indexOf(gate.key) !== -1) {
    return { ok: false, reason: 'CORRELATION_ID_DERIVED_FROM_KEY' };
  }

  return {
    ok: true,
    record: {
      submission_key: gate.key,
      commit_state: 'READY',
      canonical_lead_id: '',
      lead_mode: '',
      lead_priority: '',
      financial_zone: '',
      created_at: now,
      claimed_at: '',
      settled_at: '',
      correlation_id: correlationId
    }
  };
}

// ---------------------------------------------------------------- conditional updates
//
// Every state change below is expressed as a CONDITIONAL UPDATE SPEC: match on the key AND
// the expected current state, set the new state. The caller must then verify that EXACTLY ONE
// row was affected. Nothing here is an unconditional write.

function updateSpec(key, fromState, toState, patch) {
  return {
    where: { submission_key: key, commit_state: fromState },
    set: Object.assign({ commit_state: toState }, patch || {}),
    expect_updated_rows: 1
  };
}

// READY -> IN_FLIGHT, immediately before the irreversible Pipeline handoff.
function buildClaim(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  return { ok: true, spec: updateSpec(gate.key, 'READY', 'IN_FLIGHT', { claimed_at: now }) };
}

// IN_FLIGHT -> COMMITTED, after the Pipeline commit is observed and BEFORE the response.
function buildCommit(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  const leadId = normValue(o.canonicalLeadId);
  if (leadId === '') { return { ok: false, reason: 'LEAD_ID_MISSING' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  return {
    ok: true,
    spec: updateSpec(gate.key, 'IN_FLIGHT', 'COMMITTED', {
      canonical_lead_id: leadId,
      lead_mode: normValue(o.leadMode),
      lead_priority: normValue(o.leadPriority),
      financial_zone: normValue(o.financialZone),
      settled_at: now
    })
  };
}

// Operator-only. READY or IN_FLIGHT -> ABORTED.
function buildAbort(opts) {
  const o = opts || {};
  const key = o.submissionKey;
  if (!isValidSubmissionKey(key)) { return { ok: false, reason: 'SUBMISSION_KEY_INVALID' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  const why = normValue(o.abortReason);
  if (ABORT_REASONS.indexOf(why) === -1) { return { ok: false, reason: 'ABORT_REASON_INVALID' }; }
  const from = normValue(o.fromState);
  if (from !== 'READY' && from !== 'IN_FLIGHT') {
    return { ok: false, reason: 'ABORT_REQUIRES_READY_OR_IN_FLIGHT' };
  }
  return { ok: true, spec: updateSpec(key, from, 'ABORTED', { settled_at: now, abort_reason: why }) };
}

// THE LOAD-BEARING CHECK.
//
// A conditional update that affected zero rows means somebody else already moved the state.
// One that affected more than one means the key is not unique and nothing can be trusted.
// Neither is a success, and — critically — neither is what a node's own "did not error"
// signal reports. "The HTTP call succeeded" is not evidence that exactly one row changed, and
// treating it as such is how a claim gets handed to two operations at once.
function assertExactlyOneUpdated(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, reason: 'UPDATE_RESULT_UNREADABLE' };
  }
  if (result.ok !== true) { return { ok: false, reason: 'UPDATE_FAILED' }; }
  const n = result.updated_rows;
  if (typeof n !== 'number' || !isFinite(n)) {
    return { ok: false, reason: 'UPDATED_ROWS_UNREADABLE' };
  }
  if (n === 0) { return { ok: false, reason: 'STATE_ALREADY_MOVED' }; }
  if (n > 1) { return { ok: false, reason: 'MULTIPLE_ROWS_AFFECTED' }; }
  return { ok: true, reason: 'EXACTLY_ONE_ROW' };
}

// ---------------------------------------------------------------- classification

const VERDICT = {
  COMMITTED: 'COMMITTED',
  READY: 'READY',                 // positive evidence that no handoff began
  CANNOT_ANSWER: 'CANNOT_ANSWER'
};

const REASONS = {
  ABORTED: 'ABORTED_REQUIRES_NEW_CYCLE',
  // The preallocation invariant is broken. This is never "nothing was created".
  ABSENT: 'RECEIPT_ABSENT_INVARIANT_BROKEN'
};

// What does this set of rows, read back for this key, actually prove?
//
// Note what is NOT here: there is no ABSENT verdict that a caller can turn into "safe to
// submit". Absence is a broken invariant and resolves to CANNOT_ANSWER, full stop.
function classifyRows(rows, key) {
  if (!isValidSubmissionKey(key)) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'SUBMISSION_KEY_INVALID' };
  }
  if (!Array.isArray(rows)) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'ROWS_UNREADABLE' };
  }

  // The store's contract is exact-key lookup, and a broken contract proves nothing — so no
  // filtering. Every returned row must be exactly this key, compared as a raw string.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'LOOKUP_CONTRACT_VIOLATION' };
    }
    const stored = r.submission_key;
    if (typeof stored !== 'string' || stored === '') {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'RECEIPT_KEY_MISSING' };
    }
    if (stored !== key) {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'LOOKUP_CONTRACT_VIOLATION' };
    }
  }

  if (rows.length === 0) {
    // A current authoritative cycle is REQUIRED to have a receipt. Its absence means the
    // preallocation invariant was violated somewhere — never that nothing was created.
    return { verdict: VERDICT.CANNOT_ANSWER, reason: REASONS.ABSENT };
  }
  if (rows.length > 1) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'DUPLICATE_RECEIPTS' };
  }

  const row = rows[0];
  const state = normValue(row.commit_state);
  const correlationId = normValue(row.correlation_id);

  if (state === 'READY') {
    // POSITIVE evidence: the receipt exists and no handoff has been claimed against it.
    return { verdict: VERDICT.READY, reason: 'NO_HANDOFF_BEGAN', correlation_id: correlationId };
  }
  if (state === 'IN_FLIGHT') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'IN_FLIGHT_UNRESOLVED', correlation_id: correlationId };
  }
  if (state === 'ABORTED') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: REASONS.ABORTED, correlation_id: correlationId };
  }
  if (state !== 'COMMITTED') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'UNKNOWN_STATE', correlation_id: correlationId };
  }

  const leadId = normValue(row.canonical_lead_id);
  if (leadId === '') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'COMMITTED_WITHOUT_LEAD', correlation_id: correlationId };
  }

  return {
    verdict: VERDICT.COMMITTED,
    reason: 'RECEIPT_COMMITTED',
    correlation_id: correlationId,
    lead_id: leadId,
    lead_mode: normValue(row.lead_mode),
    lead_priority: normValue(row.lead_priority),
    financial_zone: normValue(row.financial_zone)
  };
}

// ---------------------------------------------------------------- retention

const RECEIPT_LIFECYCLE_INVARIANT = {
  must_exist_while: 'the submission_key is named by a Bot_Sessions row that can still pass the ' +
    'authority and session guards',
  never_expires_while: 'the cycle naming it is current or still recoverable',
  deletion_preconditions: [
    'the receipt is terminal (COMMITTED or ABORTED) or a proven orphan',
    'no current authority row names this submission_key',
    'the approved retention period has elapsed'
  ],
  forbidden: [
    'deletion of a receipt whose key is still named by a current authority row',
    'deletion of a READY or IN_FLIGHT receipt that is still reachable',
    'deletion used to reopen a key'
  ],
  // Materially safer than before: deleting a receipt can no longer manufacture a usable
  // absence, because absence never authorises a submit.
  deletion_cannot_authorise_a_submit: true,
  retention_duration: 'OWNER INPUT — no canonical FINMENTOR retention policy defines one'
};

function mayDeleteReceipt(opts) {
  const o = opts || {};
  const state = normValue(o.commitState);
  const terminal = state === 'COMMITTED' || state === 'ABORTED';
  if (!terminal && o.provenOrphan !== true) {
    return { ok: false, reason: 'RECEIPT_NOT_TERMINAL_AND_NOT_ORPHAN' };
  }
  if (o.namedByCurrentAuthority === true) {
    return { ok: false, reason: 'STILL_NAMED_BY_CURRENT_AUTHORITY' };
  }
  if (o.retentionPeriodElapsed !== true) {
    return { ok: false, reason: 'RETENTION_PERIOD_NOT_ELAPSED' };
  }
  return { ok: true, reason: 'SAFE_TO_DELETE' };
}

// ---------------------------------------------------------------- logging

// The submission key is opaque and identity-free, so it is no longer a personal identifier —
// but it is still a capability-shaped secret-ish value, and there is no operational reason to
// print it. correlation_id remains the field that correlates log lines.
function receiptLogView(opts) {
  const o = opts || {};
  return {
    commit_state: normValue(o.commitState),
    has_lead_id: normValue(o.canonicalLeadId) !== '',
    verdict: normValue(o.verdict),
    reason: normValue(o.reason),
    correlation_id: normValue(o.correlationId)
  };
}

module.exports = {
  SUBMISSION_KEY_PREFIX,
  SUBMISSION_KEY_RE,
  SUBMISSION_KEY_BYTES,
  SUBMISSION_KEY_MODEL,
  RECEIPT_FIELDS,
  RECEIPT_STATES,
  TRANSITIONS,
  ABORT_REASONS,
  RECEIPT_AUTHORITY,
  ISSUANCE_ORDER,
  PREALLOCATION_INVARIANT,
  RECEIPT_LIFECYCLE_INVARIANT,
  VERDICT,
  REASONS,
  normValue,
  mintSubmissionKey,
  isValidSubmissionKey,
  resolveReceiptKey,
  canTransition,
  buildPreallocation,
  buildClaim,
  buildCommit,
  buildAbort,
  updateSpec,
  assertExactlyOneUpdated,
  classifyRows,
  mayDeleteReceipt,
  receiptLogView,
  newCorrelationId
};
