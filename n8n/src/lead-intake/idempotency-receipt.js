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
  'committed_at',       // when the Pipeline commit was observed; empty unless COMMITTED
  'aborted_at',         // when an operator PROVED no commit happened; empty unless ABORTED
  'abort_reason',       // constrained vocabulary, never free text — see ABORT_REASONS
  'correlation_id'      // server-minted, for tracing one attempt through the logs
];

// ABORTED added in P1.1 (F4), and its MEANING was corrected in P1.2 (F5).
//
// P1.1 had it authorise a same-key retry, and that was internally contradictory. The stable
// key is derived from (telegram_user_id, cycle_id), so a "fresh" attempt after an abort
// carries THE SAME key. But the ledger holds exactly one receipt per key for all time and
// ABORTED is terminal, so the new intent could not satisfy insert-if-absent. Every way out of
// that was forbidden: deleting the row, overwriting ABORTED, weakening uniqueness, or writing
// a second receipt for one key.
//
// The resolution is that ABORTED is a property of the KEY, not of one attempt:
//
//     "this submission was proven not to have committed, AND this key is now closed."
//
// So an abort does NOT license another submit under the same key. Recovery is a NEW
// authoritative cycle — which mints a new key — and that is the mechanism the Concierge
// already provides and Phase B.2.1 already proves. Nothing new is invented: an aborted cycle
// is simply a superseded one.
//
// What ABORTED still earns, now that it no longer authorises retry:
//   * an immutable record that an operator investigated and PROVED no commit, which a
//     deletion would destroy;
//   * an explicit terminal state, so a stuck key stops looking like a PENDING row that
//     someone will eventually be tempted to delete;
//   * a defined end for the runbook that is not "remove the evidence".
const COMMIT_STATES = ['PENDING', 'COMMITTED', 'ABORTED'];

// The only reason an abort may carry. A constrained vocabulary rather than free text, because
// an operator note is exactly where a customer name or a phone number ends up.
const ABORT_REASONS = ['PROVEN_NO_PIPELINE_COMMIT'];

// Both COMMITTED and ABORTED are terminal. A receipt describes one outcome for one key,
// permanently. ABORTED cannot be promoted to COMMITTED: if an operator aborts a receipt whose
// lead did in fact exist, the correct repair is a new cycle — not rewriting history so the
// ledger agrees with the second opinion.
const TRANSITIONS = {
  PENDING: ['COMMITTED', 'ABORTED'],
  COMMITTED: [],
  ABORTED: []
};

function canTransition(from, to) {
  const f = normValue(from);
  const t = normValue(to);
  if (COMMIT_STATES.indexOf(f) === -1 || COMMIT_STATES.indexOf(t) === -1) { return false; }
  return (TRANSITIONS[f] || []).indexOf(t) !== -1;
}

// WHO MAY TOUCH THE LEDGER AT ALL (P1.3).
//
// The threat this closes is a denial of service, and it is cheap to mount. The stable key is
// GUESSABLE by construction — `miniapp:<telegram_user_id>:<cycle_id>`, where Telegram ids are
// numeric and cycle ids are date-shaped. If Lead Intake wrote receipts from a body field,
// anyone could POST the public webhook with a guessed key and plant a PENDING receipt for a
// victim. The real Mini App submission would then find a foreign PENDING row, answer
// CANNOT_ANSWER for ever, and never be able to submit — without the attacker touching the
// Mini App, a session or a credential.
//
// So receipt authority is a property of the ROUTE. It is never read from the body, never from
// a header, and never from anything a caller can assert. This reuses the mechanism commit
// a224aa2 deployed for lead identity, which is safe by construction rather than by checking:
// on the public path the `Internal Auth Entry` node never ran, `$()` throws, and provenance
// is false. There is nothing to forge because there is nothing to present.
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
  // Stated so a deployment cannot satisfy this by adding a marker somewhere else.
  marker_in_body_is_not_provenance: true
};

// May this execution touch the ledger, and with which key?
//
// `provenanceTrusted` must be the literal boolean `true`. The string 'true', the number 1, a
// truthy object — all are shapes a JSON body can produce, and all are refused. A caller who
// can influence this value at all has already lost the argument, so the check is deliberately
// the strictest one available rather than a truthiness test.
function resolveReceiptKey(opts) {
  const o = opts || {};
  if (o.provenanceTrusted !== true) {
    return { allowed: false, reason: 'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', key: '' };
  }
  if (!isValidKey(o.idempotencyKey)) {
    return { allowed: false, reason: 'KEY_INVALID', key: '' };
  }
  return { allowed: true, reason: 'TRUSTED_ROUTE', key: o.idempotencyKey };
}

// The uniqueness rule, stated as data so a deployment can be checked against it.
const UNIQUENESS_RULE = {
  unique_on: 'idempotency_key',
  // P1.3 — "for all time" was withdrawn: it contradicted P1-L8, which requires a retention
  // policy because the key contains a personal identifier. The precise invariant is in
  // RECEIPT_LIFECYCLE_INVARIANT; the cardinality rule is about CONCURRENT rows.
  cardinality: 'never more than one receipt row per key, for as long as any row exists',
  enforced_by: 'atomic insert-if-absent in the store',
  // Defence in depth: even where the store cannot enforce it, two rows for one key are
  // DETECTED and fail closed rather than one being picked arbitrarily.
  if_unenforceable: 'duplicate rows for a key resolve to CANNOT_ANSWER, never to a winner'
};

// HOW LONG A RECEIPT MUST LIVE (P1.3).
//
// "One receipt per key, for all time" and "P1-L8 requires a retention policy" cannot both be
// requirements, and leaving the contradiction in place would have let whoever implements
// retention pick either reading. The resolution turns on a property the gateway already has:
//
//   a submit arriving on a SUPERSEDED cycle is refused at §9.2 with CYCLE_SUPERSEDED,
//   BEFORE the ledger is consulted at all.
//
// So an old key becomes structurally unreachable the moment its cycle is superseded — and a
// receipt that can never be looked up again is safe to delete. Deleting one whose cycle can
// still be presented is NOT safe: the lookup would find nothing, read the absence as
// NOT_COMMITTED, release the claim and authorise a fresh submit for a key that may already
// have a lead.
//
// Retention therefore does not conflict with recovery, provided deletion follows supersession
// rather than a clock alone. The duration remains an OWNER input; the ordering does not.
const RECEIPT_LIFECYCLE_INVARIANT = {
  must_exist_while: 'the key can still be presented — i.e. its cycle can still pass the ' +
    'authority and session guards',
  never_expires_while: 'the cycle is current or still recoverable',
  deletion_preconditions: [
    'the receipt is terminal (COMMITTED or ABORTED) — never PENDING',
    'the cycle is IRREVERSIBLY superseded, so the key can no longer reach the ledger',
    'the approved retention period has elapsed'
  ],
  forbidden: [
    'deletion that turns a still-acceptable key into an ABSENCE',
    'deletion used to reopen a key for a fresh submit',
    'deletion of a PENDING receipt to make a lookup answer'
  ],
  retention_duration: 'OWNER INPUT — no canonical FINMENTOR retention policy defines one'
};

// Is deleting this receipt safe? Every condition must hold; there is no "usually fine".
function mayDeleteReceipt(opts) {
  const o = opts || {};
  const state = normValue(o.commitState);
  if (state !== 'COMMITTED' && state !== 'ABORTED') {
    return { ok: false, reason: 'RECEIPT_NOT_TERMINAL' };
  }
  if (o.cycleIrreversiblySuperseded !== true) {
    // The load-bearing one. While the cycle can still be presented, deleting the receipt
    // manufactures an absence that reads as "nothing was created".
    return { ok: false, reason: 'CYCLE_STILL_ACCEPTABLE' };
  }
  if (o.retentionPeriodElapsed !== true) {
    return { ok: false, reason: 'RETENTION_PERIOD_NOT_ELAPSED' };
  }
  return { ok: true, reason: 'SAFE_TO_DELETE' };
}

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
//
// P1.3 — creating an intent is the poisoning vector, so provenance is REQUIRED here rather
// than checked by a caller who might forget. It is not possible to build an intent record
// without asserting a trusted route, which means a public-path execution cannot construct one
// even by accident.
function buildIntent(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  // Validate the RAW value, not a trimmed copy: the reader refuses a padded key, so a
  // writer that quietly repaired one would create a receipt under a key the reader would
  // never look up in that form. Writer and reader must agree on what a key IS.
  const key = o.idempotencyKey;
  if (!isValidKey(key)) { return { ok: false, reason: 'KEY_INVALID' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }

  // F6 — the correlation id is the ONLY receipt field that reaches a log line, so it must not
  // be derived from the key. Seeding it with anything containing the key would put the
  // Telegram identifier straight back into the logs the digest was just removed from. Caught
  // in practice: a test fixture built it as 'CID-' + key and the leak assertion fired.
  const correlationId = normValue(o.correlationId) || newCorrelationId();
  if (correlationId.indexOf(key) !== -1) {
    return { ok: false, reason: 'CORRELATION_ID_DERIVED_FROM_KEY' };
  }

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
      aborted_at: '',
      abort_reason: '',
      correlation_id: correlationId
    }
  };
}

// Phase 2. Written AFTER the Pipeline write returns success, BEFORE the respond node.
// A commit patch without a canonical lead id is refused: "committed" and "we do not know
// what we created" must never be the same record.
function buildCommit(opts) {
  const o = opts || {};
  // Same gate as the intent: binding a canonical lead id to a receipt is a ledger write, and
  // a public-path execution must not be able to construct one.
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
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

// Operator-only. Written when a canonical Pipeline commit has been PROVEN not to exist for
// this submission — never merely because a receipt looks stuck, and never to make a lookup
// return an absence.
function buildAbort(opts) {
  const o = opts || {};
  const key = o.idempotencyKey;
  if (!isValidKey(key)) { return { ok: false, reason: 'KEY_INVALID' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  const why = normValue(o.abortReason);
  if (ABORT_REASONS.indexOf(why) === -1) { return { ok: false, reason: 'ABORT_REASON_INVALID' }; }
  return {
    ok: true,
    key: key,
    patch: { commit_state: 'ABORTED', aborted_at: now, abort_reason: why }
  };
}

// May this abort be applied to the row that is actually there?
//
// Only a PENDING receipt may be aborted. Aborting a COMMITTED one would discard the only
// evidence that resolves an ambiguity — the exact opposite of what the ledger is for — and
// re-aborting an ABORTED one is a no-op that should be visible rather than silent.
function planAbort(existingRow) {
  if (!existingRow || typeof existingRow !== 'object') {
    return { ok: false, action: 'REFUSE', reason: 'NO_RECEIPT_ROW' };
  }
  const state = normValue(existingRow.commit_state);
  if (state === 'COMMITTED') {
    return { ok: false, action: 'REFUSE', reason: 'CANNOT_ABORT_A_COMMITTED_RECEIPT' };
  }
  if (state === 'ABORTED') {
    return { ok: true, action: 'ALREADY_ABORTED', reason: 'IDEMPOTENT_REPEAT' };
  }
  if (state !== 'PENDING') {
    return { ok: false, action: 'REFUSE', reason: 'UNKNOWN_STATE' };
  }
  return { ok: true, action: 'ABORT' };
}

// ---------------------------------------------------------------- classification

const VERDICT = {
  COMMITTED: 'COMMITTED',
  ABSENT: 'ABSENT',            // caller decides whether absence is provable
  CANNOT_ANSWER: 'CANNOT_ANSWER'
};

// F5 — the reason an ABORTED key fails closed. Named rather than folded into a generic
// refusal, because the operator action it implies is specific and different: not "wait and
// retry", but "issue a new cycle". It is a SERVER LOG reason; the browser still sees only the
// existing three-state adapter contract, so no fourth client-visible outcome was invented.
const ABORTED_REASON = 'ABORTED_REQUIRES_NEW_CYCLE';

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

  // F1 — THE STORE'S CONTRACT IS EXACT-KEY LOOKUP, AND A BROKEN CONTRACT PROVES NOTHING.
  //
  // The earlier version FILTERED foreign rows away and then judged what was left. That is
  // unsafe in a specific and severe way: a store that answered readByKey(K) with a row for
  // some other key would filter down to zero rows, classify as ABSENT, and — with
  // read-after-write affirmed — become NOT_COMMITTED. The gateway would then release the
  // claim and submit again, against a store that had just demonstrated it cannot be trusted
  // to answer by key at all.
  //
  // So no filtering. EVERY returned row must be exactly this key, compared as a RAW string
  // with no trimming: the query key and the writer are both exact-form already, so a padded
  // stored key is a corrupted record, not a match to be repaired. Any deviation, and the
  // whole response is discarded as a contract violation.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'LOOKUP_CONTRACT_VIOLATION' };
    }
    const stored = r.idempotency_key;
    if (typeof stored !== 'string' || stored === '') {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'RECEIPT_KEY_MISSING' };
    }
    if (stored !== key) {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'LOOKUP_CONTRACT_VIOLATION' };
    }
  }

  // Only a clean, genuinely empty exact-key result may become an absence.
  if (rows.length === 0) {
    return { verdict: VERDICT.ABSENT, reason: 'NO_RECEIPT' };
  }
  if (rows.length > 1) {
    // Two receipts for one key means the uniqueness rule was not enforced. Picking a winner
    // would be guessing about a lead that may already exist.
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'DUPLICATE_RECEIPTS' };
  }

  const row = rows[0];
  const state = normValue(row.commit_state);

  if (state === 'ABORTED') {
    // F5 — an operator proved no canonical commit exists AND closed this key. That is NOT a
    // licence to submit again under the same key: the receipt is terminal and unique, so a
    // fresh intent for this key could not be written even if the gateway tried. Fail closed
    // and name the operator action, which is a new authoritative cycle.
    return {
      verdict: VERDICT.CANNOT_ANSWER,
      reason: ABORTED_REASON,
      correlation_id: normValue(row.correlation_id)
    };
  }

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
    // The receipt's own server-minted id, so a log line can be correlated without deriving
    // anything from the key (F6).
    correlation_id: normValue(row.correlation_id),
    lead_id: leadId,
    lead_mode: normValue(row.lead_mode),
    lead_priority: normValue(row.lead_priority),
    financial_zone: normValue(row.financial_zone)
  };
}

// ---------------------------------------------------------------- logging

// F6 — THE KEY DIGEST IS GONE, and the claim that went with it is withdrawn.
//
// P1.1 logged a truncated SHA-256 of the stable key and called it "not reversible into an
// identity". That contradicted this design's own §3.1, which rejects plain SHA-256 as
// meaningful pseudonymisation precisely because the input space is enumerable: Telegram ids
// are numeric and cycle ids are date-shaped, so the whole space is brute-forced in seconds.
// Both claims could not stand. A deterministic, unsalted digest of an identifier is a
// PSEUDONYMOUS IDENTIFIER, not anonymised data, and calling it otherwise is the kind of
// overclaim that ends up quoted in a privacy review.
//
// So the digest is not softened, it is REMOVED — and nothing replaced it, because nothing
// needed to. `correlation_id` is already server-minted (crypto.randomUUID), already stored on
// the receipt, and contains no Telegram identifier of any kind. It correlates log lines about
// one submission perfectly well, which was the digest's only job. No new field, no new
// secret, no HMAC introduced for logging.
//
// The only shape permitted in a log line: no key, no digest of the key, no identity, no lead
// id, no contact data.
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
  KEY_PREFIX,
  KEY_RE,
  RECEIPT_FIELDS,
  COMMIT_STATES,
  TRANSITIONS,
  UNIQUENESS_RULE,
  RECEIPT_AUTHORITY,
  RECEIPT_LIFECYCLE_INVARIANT,
  ABSENCE_PROOF_PRECONDITIONS,
  ABORT_REASONS,
  VERDICT,
  ABORTED_REASON,
  normValue,
  isValidKey,
  parseKey,
  canTransition,
  resolveReceiptKey,
  mayDeleteReceipt,
  buildIntent,
  buildCommit,
  planCommit,
  buildAbort,
  planAbort,
  classifyRows,
  receiptLogView,
  newCorrelationId
};
