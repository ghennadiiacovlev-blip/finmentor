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

// Is this store fit to back a recovery adapter at all?
//
// Deliberately strict. A store without exact-key lookup would have to scan, and a scan over
// Pipeline or over the ledger is not a lookup — it is the thing RECOVERY_ADAPTER_CONTRACT
// names as unacceptable. Refusing here keeps the gateway's PRE_ACTIVATION_BLOCKED behaviour
// in force rather than replacing it with a worse adapter.
function assessStore(store) {
  if (!store || typeof store.readByKey !== 'function') {
    return { ok: false, reason: 'STORE_MISSING' };
  }
  const caps = readCapabilities(store);
  if (!caps) { return { ok: false, reason: 'CAPABILITIES_UNREADABLE' }; }
  if (!caps.exact_key_lookup) { return { ok: false, reason: 'NO_EXACT_KEY_LOOKUP' }; }
  return { ok: true, capabilities: caps };
}

// Build the adapter, or refuse.
//
// Refusing returns `{ ok: false }` and NO `lookup` function, on purpose: `recoveryAdapterStatus`
// in submit-contract.js decides the gateway is blocked by looking for a callable `lookup`, so
// an unusable store must not produce an object that merely fails later. A blocked deployment
// has to look blocked at the moment it is wired, not at the moment a user submits.
function createRecoveryAdapter(store, opts) {
  const assessment = assessStore(store);
  if (!assessment.ok) {
    return { ok: false, reason: assessment.reason, adapter: null };
  }
  const caps = assessment.capabilities;
  const onLog = opts && typeof opts.onLog === 'function' ? opts.onLog : null;

  function log(view) { if (onLog) { try { onLog(view); } catch (e) { /* logging never decides */ } } }

  function lookup(idempotencyKey) {
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
          idempotencyKey: idempotencyKey, verdict: 'CANNOT_ANSWER', reason: 'STORE_UNAVAILABLE'
        }));
        return ANSWER.cannotAnswer();
      }

      const verdict = R.classifyRows(read.rows, idempotencyKey);

      if (verdict.verdict === R.VERDICT.COMMITTED) {
        log(R.receiptLogView({
          idempotencyKey: idempotencyKey,
          commitState: 'COMMITTED',
          canonicalLeadId: verdict.lead_id,
          verdict: verdict.verdict,
          reason: verdict.reason
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
            idempotencyKey: idempotencyKey,
            verdict: 'CANNOT_ANSWER',
            reason: 'ABSENCE_NOT_PROVABLE_WITHOUT_READ_AFTER_WRITE'
          }));
          return ANSWER.cannotAnswer();
        }
        log(R.receiptLogView({
          idempotencyKey: idempotencyKey, verdict: 'NOT_COMMITTED', reason: verdict.reason
        }));
        return ANSWER.notCommitted();
      }

      // DUPLICATE_RECEIPTS, PENDING_UNRESOLVED, COMMITTED_WITHOUT_LEAD, UNKNOWN_STATE,
      // ROWS_UNREADABLE — every one of them preserves ambiguity.
      log(R.receiptLogView({
        idempotencyKey: idempotencyKey, verdict: 'CANNOT_ANSWER', reason: verdict.reason
      }));
      return ANSWER.cannotAnswer();
    } catch (e) {
      // The thrown value is never read: a message can carry a key, a row or a lead id.
      return ANSWER.cannotAnswer();
    }
  }

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

module.exports = {
  ANSWER,
  assessStore,
  readCapabilities,
  createRecoveryAdapter
};
