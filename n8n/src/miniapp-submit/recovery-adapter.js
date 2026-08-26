// FINMENTOR — G1 recovery adapter (gateway side, P3 preallocation architecture).
//
// The implementation of `leadIntake.lookup` that RECOVERY_ADAPTER_CONTRACT requires, built on
// the preallocated submission receipt (`n8n/src/lead-intake/idempotency-receipt.js`).
//
// WHAT CHANGED IN P3, and it is the safety model rather than the plumbing.
//
// The three answers the submit handler acts on are unchanged:
//
//   { ok: true,  known: true,  body }  COMMITTED      — a lead exists; replay it verbatim
//   { ok: true,  known: false }        NOT_COMMITTED  — no handoff began; one attempt allowed
//   { ok: false }                      CANNOT_ANSWER  — ambiguity preserved
//
// What changed is WHERE `known: false` comes from. It used to come from ABSENCE — no row
// found, therefore nothing was created — an inference that could authorise a duplicate lead
// if the store was merely slow to show a row that existed. It now comes from a READY receipt:
// a row that is positively there and positively unclaimed.
//
// So absence is no longer an answer at all. A missing receipt for a current authoritative
// cycle means the preallocation invariant is broken, and the only safe response is
// CANNOT_ANSWER. There is no code path from "I saw nothing" to "go ahead and submit".
//
// CAPABILITY CONSEQUENCE. `read_after_write` was a SAFETY prerequisite under the old model,
// because the absence inference depended on it. It is not any more: a stale read can only
// show READY when the state has already moved, and the conditional claim then fails with
// updated_rows = 0 rather than handing out a second handoff. Read-after-write is therefore
// demoted to a LIVENESS property — it affects whether recovery works promptly, not whether it
// is safe. `conditional_update` takes its place as required, because it is now the primitive
// the entire design rests on.
//
// STORE CONTRACT (injected — this module performs no I/O):
//
//   store.capabilities()   -> { exact_key_lookup, conditional_update, read_after_write }
//   store.readByKey(key)   -> { ok, rows }   exact key equality; never a scan
//
// The offline gate injects an in-memory double. THAT DOUBLE IS NOT THE STORE. It models the
// contract so the decision logic can be proven with no tenant; it proves nothing about the
// live conditional-update semantics, which is the P3 canary.

const R = require('../lead-intake/idempotency-receipt.js');

const ANSWER = {
  committed: (body) => ({ ok: true, known: true, body: body }),
  notCommitted: () => ({ ok: true, known: false }),
  cannotAnswer: () => ({ ok: false })
};

// Required for an ACTIVATION adapter. `atomic_insert_if_absent` is GONE from this list — P2
// proved the platform does not have it, and the preallocation design no longer needs it:
// uniqueness moved from the store to the key generator.
const REQUIRED_CAPABILITIES = ['exact_key_lookup', 'conditional_update'];

// Declared so nobody re-adds read-after-write as a safety gate without reading why it moved.
const CAPABILITY_NOTES = {
  exact_key_lookup: 'required — a scan is not a lookup',
  conditional_update: 'required — the load-bearing primitive: claim and commit are both ' +
    'conditional updates that must affect exactly one row',
  read_after_write: 'LIVENESS ONLY since P3 — absence never authorises a submit, so a stale ' +
    'read cannot cause a duplicate; it can only delay recovery',
  atomic_insert_if_absent: 'NOT REQUIRED since P3 — proved absent in P2, and designed out by ' +
    'preallocating under a random key'
};

// A capability flag is an ASSERTION, not a measurement. Affirming them does not make a store
// durable across a redeploy or restart: that stays a live canary and nothing here claims it.
const CAPABILITY_CAVEAT =
  'capabilities are self-declared; durability across redeploy/restart, and the real semantics ' +
  'of conditional update under concurrency, are proven only by the live canaries';

function readCapabilities(store) {
  if (!store || typeof store.capabilities !== 'function') { return null; }
  let caps;
  try { caps = store.capabilities(); } catch (e) { return null; }
  if (!caps || typeof caps !== 'object') { return null; }
  return {
    exact_key_lookup: caps.exact_key_lookup === true,
    conditional_update: caps.conditional_update === true,
    read_after_write: caps.read_after_write === true
  };
}

function assessStore(store) {
  if (!store || typeof store.readByKey !== 'function') {
    return { ok: false, reason: 'STORE_MISSING' };
  }
  const caps = readCapabilities(store);
  if (!caps) { return { ok: false, reason: 'CAPABILITIES_UNREADABLE' }; }
  if (!caps.exact_key_lookup) { return { ok: false, reason: 'NO_EXACT_KEY_LOOKUP', capabilities: caps }; }
  if (!caps.conditional_update) { return { ok: false, reason: 'NO_CONDITIONAL_UPDATE', capabilities: caps }; }
  return { ok: true, capabilities: caps };
}

// The single resolver both constructors use, so the diagnostic probe can never drift from the
// adapter it is meant to diagnose.
function buildLookup(store, caps, onLog) {
  function log(view) { if (onLog) { try { onLog(view); } catch (e) { /* logging never decides */ } } }

  return function lookup(submissionKey) {
    try {
      // The caller cannot steer this. The key is read by the gateway from the AUTHORITATIVE
      // Bot_Sessions row; a value that is not the exact minted shape did not come from there.
      if (!R.isValidSubmissionKey(submissionKey)) {
        log(R.receiptLogView({ verdict: 'CANNOT_ANSWER', reason: 'SUBMISSION_KEY_INVALID' }));
        return ANSWER.cannotAnswer();
      }

      let read;
      try { read = store.readByKey(submissionKey); } catch (e) { read = null; }
      if (!read || read.ok !== true) {
        // The store's verdict is judged BEFORE its rows: ok:false with rows:[] must never be
        // read as "nothing is there".
        log(R.receiptLogView({ verdict: 'CANNOT_ANSWER', reason: 'STORE_UNAVAILABLE' }));
        return ANSWER.cannotAnswer();
      }

      const verdict = R.classifyRows(read.rows, submissionKey);

      if (verdict.verdict === R.VERDICT.COMMITTED) {
        log(R.receiptLogView({
          commitState: 'COMMITTED',
          canonicalLeadId: verdict.lead_id,
          verdict: verdict.verdict,
          reason: verdict.reason,
          correlationId: verdict.correlation_id
        }));
        return ANSWER.committed({
          ok: true,
          lead_id: verdict.lead_id,
          mode: verdict.lead_mode,
          priority: verdict.lead_priority,
          financial_zone: verdict.financial_zone
        });
      }

      if (verdict.verdict === R.VERDICT.READY) {
        // The only answer that releases a claim — and it is now POSITIVE evidence: the
        // receipt is there and nothing has claimed it. Note what this is not: it is not an
        // inference from an empty result set, so it does not depend on read-after-write.
        log(R.receiptLogView({
          commitState: 'READY',
          verdict: verdict.verdict,
          reason: verdict.reason,
          correlationId: verdict.correlation_id
        }));
        return ANSWER.notCommitted();
      }

      // IN_FLIGHT, ABORTED, ABSENT (broken invariant), duplicates, malformed rows, unreadable
      // rows — every one preserves ambiguity.
      log(R.receiptLogView({
        verdict: 'CANNOT_ANSWER',
        reason: verdict.reason,
        correlationId: verdict.correlation_id
      }));
      return ANSWER.cannotAnswer();
    } catch (e) {
      // The thrown value is never read: a message can carry a key, a row or a lead id.
      return ANSWER.cannotAnswer();
    }
  };
}

function createRecoveryAdapter(store, opts) {
  const assessment = assessStore(store);
  if (!assessment.ok) {
    return { ok: false, reason: assessment.reason, adapter: null };
  }
  const caps = assessment.capabilities;
  const onLog = opts && typeof opts.onLog === 'function' ? opts.onLog : null;
  const lookup = buildLookup(store, caps, onLog);

  return {
    ok: true,
    reason: 'READY',
    capabilities: caps,
    // Kept as a reported property rather than a gate: under P3 it is a liveness signal.
    read_after_write_liveness: caps.read_after_write,
    adapter: { lookup: lookup }
  };
}

// Operator / test tooling ONLY. Exposes `probe`, never `lookup`, so it can never satisfy
// `recoveryAdapterStatus` and can never remove PRE_ACTIVATION_BLOCKED however it is wired.
function createDiagnosticProbe(store) {
  if (!store || typeof store.readByKey !== 'function') {
    return { ok: false, reason: 'STORE_MISSING', probe: null };
  }
  const caps = readCapabilities(store);
  if (!caps) { return { ok: false, reason: 'CAPABILITIES_UNREADABLE', probe: null }; }
  if (!caps.exact_key_lookup) { return { ok: false, reason: 'NO_EXACT_KEY_LOOKUP', probe: null }; }

  const inner = buildLookup(store, caps, null);
  return {
    ok: true,
    reason: 'DIAGNOSTIC_ONLY',
    capabilities: caps,
    activation_capable: caps.conditional_update === true,
    probe: inner
  };
}

module.exports = {
  ANSWER,
  REQUIRED_CAPABILITIES,
  CAPABILITY_NOTES,
  CAPABILITY_CAVEAT,
  assessStore,
  readCapabilities,
  createRecoveryAdapter,
  createDiagnosticProbe
};
