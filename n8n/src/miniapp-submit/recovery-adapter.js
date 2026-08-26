// FINMENTOR — G1 recovery adapter (gateway side).
//
// The implementation of `leadIntake.lookup` that `submit-contract.js`'s
// RECOVERY_ADAPTER_CONTRACT has declared and required since N6.1, and that nothing in the
// repository has provided until now. Built on the durable submission receipt ledger
// (`n8n/src/lead-intake/idempotency-receipt.js`), never on Pipeline, Bot_Sessions or the
// read-model Data Table.
//
// Its whole job is to turn "what does the ledger say about this key" into the three answers
// the submit handler already knows how to act on, and to be relentlessly conservative about
// which of the three it picks:
//
//   { ok: true,  known: true,  body }  COMMITTED      — a lead exists; replay it verbatim
//   { ok: true,  known: false }        NOT_COMMITTED  — provably nothing was created
//   { ok: false }                      CANNOT_ANSWER  — ambiguity preserved
//
// NOT_COMMITTED is the only answer that may release a claim and permit a fresh Lead Intake
// call, so it is the only one that can create a duplicate lead if it is wrong. It is
// therefore the answer this module works hardest to withhold: absence of a receipt is
// reported as NOT_COMMITTED **only** when the store affirms it can support that inference,
// and as CANNOT_ANSWER otherwise. An adapter that guesses here is worse than no adapter,
// because the gateway's structural blocker at least fails safe.
//
// STORE CONTRACT (injected — this module performs no I/O):
//
//   store.capabilities()   -> { exact_key_lookup, atomic_insert_if_absent, read_after_write }
//   store.readByKey(key)   -> { ok, rows }        exact key equality; never a scan
//
// `capabilities()` is not decoration. Each flag gates a specific inference, so a store that
// has not proven a property cannot accidentally be trusted for it:
//
//   exact_key_lookup     false -> the adapter refuses to exist at all
//   read_after_write     false -> absence can never mean NOT_COMMITTED
//   atomic_insert_if_absent    -> reported for the writer's benefit; duplicates still fail
//                                 closed here regardless
//
// The offline gate injects an in-memory double. THAT DOUBLE IS NOT THE STORE. It models the
// contract so the decision logic can be proven with no tenant; it proves nothing about
// durability, atomicity or read-after-write in the live n8n Data Table, which is exactly why
// G1 stays open until the live canaries in the plan document run.

const R = require('../lead-intake/idempotency-receipt.js');

// Answers, as data, so a test asserts against the contract rather than against a literal.
const ANSWER = {
  committed: (body) => ({ ok: true, known: true, body: body }),
  notCommitted: () => ({ ok: true, known: false }),
  cannotAnswer: () => ({ ok: false })
};

function readCapabilities(store) {
  if (!store || typeof store.capabilities !== 'function') { return null; }
  let caps;
  try { caps = store.capabilities(); } catch (e) { return null; }
  if (!caps || typeof caps !== 'object') { return null; }
  return {
    exact_key_lookup: caps.exact_key_lookup === true,
    atomic_insert_if_absent: caps.atomic_insert_if_absent === true,
    read_after_write: caps.read_after_write === true
  };
}

// Every capability an ACTIVATION store must affirm. Not a preference list: each one gates an
// inference the gateway will make on the strength of this adapter existing.
const REQUIRED_CAPABILITIES = ['exact_key_lookup', 'atomic_insert_if_absent', 'read_after_write'];

// Is this store fit to back an ACTIVATION recovery adapter?
//
// P1.1 (F2) made this strictly stronger, and the reason is a real hazard rather than
// tidiness. `recoveryAdapterStatus` in submit-contract.js decides the gateway is unblocked by
// finding a callable `lookup` — nothing more. So an adapter built over a store that had only
// proven exact-key lookup would REMOVE PRE_ACTIVATION_BLOCKED while two of the three
// properties the recovery depends on were still unproven. The blocker would come off early,
// and it is the blocker that currently guarantees no unrecoverable submission is ever started.
//
//   exact_key_lookup        — without it the store must scan, which is not a lookup
//   atomic_insert_if_absent — without it two receipts can exist for one key, and the ledger
//                             cannot hold its own uniqueness rule
//   read_after_write        — without it absence can never mean NOT_COMMITTED, so the adapter
//                             could never release a claim and is not a recovery at all
//
// Each is reported under its own reason so a deployment learns WHICH property it is missing.
function assessStore(store) {
  if (!store || typeof store.readByKey !== 'function') {
    return { ok: false, reason: 'STORE_MISSING' };
  }
  const caps = readCapabilities(store);
  if (!caps) { return { ok: false, reason: 'CAPABILITIES_UNREADABLE' }; }
  if (!caps.exact_key_lookup) { return { ok: false, reason: 'NO_EXACT_KEY_LOOKUP', capabilities: caps }; }
  if (!caps.atomic_insert_if_absent) { return { ok: false, reason: 'NO_ATOMIC_INSERT_IF_ABSENT', capabilities: caps }; }
  if (!caps.read_after_write) { return { ok: false, reason: 'NO_READ_AFTER_WRITE', capabilities: caps }; }
  return { ok: true, capabilities: caps };
}

// A capability flag is an ASSERTION, not a measurement. Affirming all three does not make a
// store durable across a workflow redeploy or an n8n restart, and nothing in this file
// claims otherwise: durability stays a LIVE canary prerequisite (P1-L4). What the gate buys
// is that a store which has not even claimed the properties can never unblock the gateway.
const CAPABILITY_CAVEAT =
  'capabilities are self-declared; durability across redeploy/restart is proven only by the ' +
  'live canaries, never by this flag';

// Build the adapter, or refuse.
//
// Refusing returns `{ ok: false }` and NO `lookup` function, on purpose: `recoveryAdapterStatus`
// in submit-contract.js decides the gateway is blocked by looking for a callable `lookup`, so
// an unusable store must not produce an object that merely fails later. A blocked deployment
// has to look blocked at the moment it is wired, not at the moment a user submits.
// The single resolver both constructors use, so the diagnostic probe can never drift from
// the adapter it is meant to diagnose.
function buildLookup(store, caps, onLog) {
  function log(view) { if (onLog) { try { onLog(view); } catch (e) { /* logging never decides */ } } }

  return function lookup(idempotencyKey) {
    // Nothing below may throw into the submit handler. The handler has a top-level catch
    // (G3), but a lookup that throws would be classified by throw-site rather than by what
    // the ledger actually said, which loses information the ledger had.
    try {
      // The caller cannot steer this. The key is minted server-side by the handler from the
      // app session's telegram_user_id and the authoritative cycle_id; a value that does not
      // have the exact server key shape did not come from there, and is refused rather than
      // looked up. This is the last line of defence for T9/T10 — the validator already drops
      // caller idempotency_key, lead_id, request_id and cycle_id before this point.
      if (!R.isValidKey(idempotencyKey)) {
        log(R.receiptLogView({ verdict: 'CANNOT_ANSWER', reason: 'KEY_INVALID' }));
        return ANSWER.cannotAnswer();
      }

      let read;
      try { read = store.readByKey(idempotencyKey); } catch (e) { read = null; }
      if (!read || read.ok !== true) {
        // The store could not tell us. Ambiguity is preserved, never gambled on.
        log(R.receiptLogView({
          verdict: 'CANNOT_ANSWER', reason: 'STORE_UNAVAILABLE'
        }));
        return ANSWER.cannotAnswer();
      }

      const verdict = R.classifyRows(read.rows, idempotencyKey);

      if (verdict.verdict === R.VERDICT.COMMITTED) {
        log(R.receiptLogView({
          commitState: 'COMMITTED',
          canonicalLeadId: verdict.lead_id,
          verdict: verdict.verdict,
          reason: verdict.reason,
          correlationId: verdict.correlation_id
        }));
        // Exactly the canonical-success shape `canonicalResult` parses. `mode` is carried
        // because the handler logs it; it does not cross TB-1 (owner decision, N6.2).
        return ANSWER.committed({
          ok: true,
          lead_id: verdict.lead_id,
          mode: verdict.lead_mode,
          priority: verdict.lead_priority,
          financial_zone: verdict.financial_zone
        });
      }

      if (verdict.verdict === R.VERDICT.ABSENT) {
        // THE ONE INFERENCE THAT CAN CREATE A DUPLICATE LEAD IF IT IS WRONG.
        //
        // No receipt means no Pipeline write happened for this key — but ONLY because the
        // intent row is written before the Pipeline write, and only if this store makes a
        // committed intent visible to the very next read. Without read-after-write, "no
        // row" may simply be a row not visible yet, and answering NOT_COMMITTED would
        // release the claim and submit again into a lead that already exists.
        if (!caps.read_after_write) {
          log(R.receiptLogView({
            verdict: 'CANNOT_ANSWER',
            reason: 'ABSENCE_NOT_PROVABLE_WITHOUT_READ_AFTER_WRITE'
          }));
          return ANSWER.cannotAnswer();
        }
        log(R.receiptLogView({
          verdict: 'NOT_COMMITTED', reason: verdict.reason
        }));
        return ANSWER.notCommitted();
      }

      // DUPLICATE_RECEIPTS, PENDING_UNRESOLVED, COMMITTED_WITHOUT_LEAD, UNKNOWN_STATE,
      // ROWS_UNREADABLE — every one of them preserves ambiguity.
      log(R.receiptLogView({
        verdict: 'CANNOT_ANSWER', reason: verdict.reason
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
    // Absence is only a usable answer when the store supports the inference. Surfaced so a
    // deployment can see, without reading code, whether it bought recovery or merely
    // bought the ability to recognise a success.
    absence_provable: caps.read_after_write,
    adapter: { lookup: lookup }
  };
}

// Operator / test tooling ONLY.
//
// Deliberately a DIFFERENT constructor returning a method named `probe`, never `lookup`.
// That naming is the whole safety property: `recoveryAdapterStatus` unblocks the gateway by
// finding a callable `lookup`, so an object that has no `lookup` cannot satisfy it however
// it is wired. A probe over a partially-proven store can therefore be used to inspect the
// ledger during a canary run without silently removing PRE_ACTIVATION_BLOCKED.
//
// It needs exact-key lookup — a probe that scanned would be lying about what it inspected —
// but tolerates the other two being unproven, and answers conservatively when they are:
// absence still degrades to "cannot answer" unless read-after-write is affirmed.
function createDiagnosticProbe(store) {
  if (!store || typeof store.readByKey !== 'function') {
    return { ok: false, reason: 'STORE_MISSING', probe: null };
  }
  const caps = readCapabilities(store);
  if (!caps) { return { ok: false, reason: 'CAPABILITIES_UNREADABLE', probe: null }; }
  if (!caps.exact_key_lookup) { return { ok: false, reason: 'NO_EXACT_KEY_LOOKUP', probe: null }; }

  // Built through the same code path, so the probe cannot drift from the real adapter.
  const inner = buildLookup(store, caps, null);
  return {
    ok: true,
    reason: 'DIAGNOSTIC_ONLY',
    capabilities: caps,
    activation_capable: caps.atomic_insert_if_absent && caps.read_after_write,
    // NOT named `lookup`. See the comment above — this is load-bearing.
    probe: inner
  };
}

module.exports = {
  ANSWER,
  REQUIRED_CAPABILITIES,
  CAPABILITY_CAVEAT,
  assessStore,
  readCapabilities,
  createRecoveryAdapter,
  createDiagnosticProbe
};
