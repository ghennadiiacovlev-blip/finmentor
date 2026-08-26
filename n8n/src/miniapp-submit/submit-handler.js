// FINMENTOR — Mini App submit orchestration (B.2.1-C).
//
// Canonical scope: docs/PHASE_B2_1_GATEWAY_CONTRACT.md §14 "B.2.1-C — Consent + Submit",
// implementing §9 (submit sequence, steps 1-10), §10 (idempotency and the monotonic submit
// state machine) and the error-recovery half of the slice. Pure decision logic lives in
// submit-contract.js.
//
// Every dependency is INJECTED, never imported, exactly as the read-model mirror helper
// does it: offline the gate passes deterministic fakes, live the n8n nodes pass real
// clients. That is what makes this slice provable with no tenant, no credential and no
// network — and it is also why the same code path runs in both places.
//
// The invariants this file exists to hold:
//
//   * Bot_Sessions is the authority. The app-session store is a binding/claim record, never
//     a second CRM and never the source of canonical lead identity.
//   * Authority-first: consent and the canonical lead id commit to Bot_Sessions BEFORE the
//     derived read model is touched. The mirror runs only after an authoritative commit.
//   * The caller cannot steer identity. lead_id, cycle_id and request_id from the body are
//     dropped by the validator; the idempotency key is built from server-owned values only.
//   * Exactly one Lead Intake call per (telegram user, cycle). A retry resolves server state
//     first and returns the prior canonical success rather than submitting again.
//   * `submitted` is terminal. Nothing moves it back to `draft`.
//   * No irreversible handoff without a proven-current context. The cycle that owns the
//     claim must still be the authoritative cycle at the moment of the Lead Intake call
//     (G2), and a recovery path for an ambiguous outcome must exist before one is possible
//     at all (G1).
//   * No throw ever leaves this handler. Every client is injected and any of them may
//     throw; what the caller is told depends on whether the irreversible call was reached,
//     never on the thrown value, which is not read at all (G3).
//   * The browser cannot learn whether its lead was new, merged or a duplicate. `mode` does
//     not appear in any client response on any branch; it lives in the server log and in
//     the authority row, and `responseLeaks` refuses it rather than merely omitting it
//     (owner decision, N6.2).
//
// Injected contracts:
//   sessions.read(appSessionId)                    -> { ok, session }
//   sessions.claim(appSessionId, {from,to,patch})  -> { ok, updated_rows }   conditional CAS
//   sessions.update(appSessionId, patch)           -> { ok }
//   authority.read(chatId)                         -> { ok, row }
//   authority.write(chatId, patch)                 -> { ok }
//   leadIntake.submit({ idempotency_key, envelope })-> { ok, ambiguous, body }
//   leadIntake.lookup(submissionKey)               -> { ok, known, body }   REQUIRED
//   mirror(chatId)                                 -> optional; derived read model refresh
//   clock.now()                                    -> ISO string
//
// `leadIntake.lookup` is the one contract that is NOT optional. Its shape and its durability
// requirements are stated in submit-contract.js as RECOVERY_ADAPTER_CONTRACT, and no
// implementation of it exists in this repository. Without it this handler refuses to make a
// fresh Lead Intake call at all -- see the G1 blocker below. That refusal is the closure:
// a submission that cannot be recovered is a submission that is never started.
//
// A `leadIntake.submit` result is a canonical success only when `body.ok === true` and a
// non-empty lead_id came back (§9.8). `ambiguous: true` means the outcome is unknown -- a
// timeout, a dropped connection, a 5xx after the request was accepted -- and is the one
// case that must never be retried inside the same request.

const C = require('./submit-contract.js');

function nowIso(clock) {
  return clock && typeof clock.now === 'function' ? clock.now() : new Date().toISOString();
}

// A zero-effect accounting block returned on every branch. The gate asserts against it, so
// a branch that quietly gained a side effect fails rather than passing unnoticed.
function counters() {
  return {
    lead_intake_calls: 0,
    lead_intake_lookups: 0,
    authority_writes: 0,
    session_writes: 0,
    mirror_runs: 0,
    // G2 — the pre-handoff re-read. Counted so a branch that skipped the guard is visible
    // in the log rather than merely absent from it.
    handoff_guards: 0,
    // G3 — a derived-mirror refresh that threw. The submit still succeeded; this is how a
    // deployment that quietly stopped refreshing the read model shows up in the log instead
    // of nowhere.
    mirror_failures: 0
  };
}

function reject(code, stage, correlationId, counts, detail) {
  const f = C.fail(code, stage, detail);
  return {
    ok: false,
    status_code: f.status_code,
    // §4/§12 -- the browser sees only these three fields. No stage, no detail, no
    // cryptographic or downstream diagnostics.
    response: { ok: false, error_code: code, retryable: f.retryable },
    log: {
      outcome: 'REJECT',
      correlation_id: correlationId,
      error_code: code,
      stage: stage,
      detail: detail || null,
      counters: counts
    }
  };
}

function accept(response, correlationId, counts, extraLog) {
  const log = {
    outcome: 'ACCEPT',
    correlation_id: correlationId,
    counters: counts
  };
  if (extraLog) {
    const keys = Object.keys(extraLog);
    for (let i = 0; i < keys.length; i++) { log[keys[i]] = extraLog[keys[i]]; }
  }
  return { ok: true, status_code: 200, response: response, log: log };
}

// Read the canonical result out of a Lead Intake response body. §9.8: success is
// `response.ok === true`, and a success without a canonical lead id is not a success.
function canonicalResult(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (b.ok !== true) { return null; }
  const leadId = C.normValue(b.lead_id);
  if (leadId === '') { return null; }
  return {
    lead_id: leadId,
    mode: C.normValue(b.mode),
    priority: C.normValue(b.priority || b.lead_priority),
    financial_zone: C.normValue(b.financial_zone)
  };
}

// §9.9 -- persist the canonical lead binding to the AUTHORITY first, then to the app
// session, then refresh the derived read model. The order is the contract: a mirror that
// runs before the authoritative commit would publish a projection of state that does not
// exist yet, which is the defect class INDP2-09 closed in the read model.
function persistCanonical(ctx, result) {
  // G6 -- the classification is persisted to AUTHORITY, not only to the app session. The
  // resolver's authority branch reads these three fields, and until now nothing wrote them:
  // a retry resolved from authority (the crash between the authoritative commit and the
  // session update) reported the clamp defaults `new` / `COLD` / `UNKNOWN` as though they
  // were the real values. Persisting is the option T34 names first. The other half of G6 --
  // whether `mode` should cross to the browser at all -- changes the response shape the
  // gateway contract §9 defines and is recorded as an open decision, not taken here.
  const wrote = ctx.authority.write(ctx.chatId, {
    lead_id: result.lead_id,
    lead_cycle_id: ctx.cycleId,
    lead_intake_ok: 'true',
    lead_mode: result.mode,
    lead_priority: result.priority,
    financial_zone: result.financial_zone,
    updated_at: ctx.nowIso
  });
  ctx.counts.authority_writes++;
  if (!wrote || !wrote.ok) {
    return { ok: false, reason: 'AUTHORITY_LEAD_WRITE_FAILED' };
  }

  ctx.sessions.update(ctx.appSessionId, {
    submit_state: 'submitted',
    lead_id: result.lead_id,
    lead_cycle_id: ctx.cycleId,
    mode: result.mode,
    priority: result.priority,
    financial_zone: result.financial_zone,
    submitted_at: ctx.nowIso
  });
  ctx.counts.session_writes++;

  // G3 -- the mirror is DERIVED, and it runs after the authoritative commit. A mirror that
  // throws cannot unmake the commit that already happened, so the correct answer to a failed
  // refresh is a successful submit plus a recorded failure. Not an unhandled node error --
  // that was the defect -- and deliberately not SUBMIT_UNRESOLVED either, which would tell a
  // client to retry a submission that is complete and canonical. Phase 10 proved the read
  // model falls back to authority whenever the derived row is missing or stale, and canary
  // L11 states the same criterion: submit still succeeds, the next open is correct.
  if (typeof ctx.mirror === 'function') {
    try {
      ctx.mirror(ctx.chatId);
      ctx.counts.mirror_runs++;
    } catch (e) {
      ctx.counts.mirror_failures++;
    }
  }
  return { ok: true };
}

// §10 -- resolve server submit state before considering another Intake call. Returns a
// canonical result when one already exists for this key, otherwise null.
function resolvePriorSubmission(ctx, session) {
  const state = C.normValue(session.submit_state);
  const knownLeadId = C.normValue(session.lead_id);

  // The clean terminal case: the session already carries the canonical lead id.
  if (state === 'submitted' && knownLeadId !== '') {
    return {
      resolved: true,
      source: 'session',
      result: {
        lead_id: knownLeadId,
        mode: C.normValue(session.mode),
        priority: C.normValue(session.priority),
        financial_zone: C.normValue(session.financial_zone)
      }
    };
  }

  // The authority may already know the lead even when the session record does not -- for
  // instance a crash between the authoritative commit and the session update. Authority
  // wins, and only when the binding belongs to THIS cycle.
  const authLeadId = C.normValue(ctx.authorityRow.lead_id);
  const authLeadCycle = C.normValue(ctx.authorityRow.lead_cycle_id);
  if (authLeadId !== '' && authLeadCycle !== '' && authLeadCycle === ctx.cycleId) {
    return {
      resolved: true,
      source: 'authority',
      // G6 -- a row written before the classification fields existed, or by an older
      // deployment, resolves the lead id but not what the lead was classified as. Say so in
      // the log: the response still carries the clamp defaults, because the contract's
      // `mode` vocabulary has no unknown member, and a clamp default indistinguishable from
      // a real value is precisely the defect T34 recorded.
      classification_recovered: C.normValue(ctx.authorityRow.lead_mode) !== '',
      result: {
        lead_id: authLeadId,
        mode: C.normValue(ctx.authorityRow.lead_mode),
        priority: C.normValue(ctx.authorityRow.lead_priority),
        financial_zone: C.normValue(ctx.authorityRow.financial_zone)
      }
    };
  }

  // An interrupted attempt. The only safe way to learn what happened is to ask the
  // downstream for the idempotency key -- never to submit again and see.
  if (state === 'submitting' || state === 'submitted') {
    const adapter = C.recoveryAdapterStatus(ctx.leadIntake);
    if (adapter.available) {
      // The lookup is asked with the SERVER-derived key only. Nothing a caller sent -- not
      // request_id, not lead_id -- reaches this argument, so a caller cannot steer which
      // submission a recovery resolves to.
      // P3 — the recovery lookup uses the AUTHORITATIVE submission_key, minted by the cycle
      // issuer and preallocated with the receipt. It is NOT derived from identity: the old
      // derived key could collide when two issuers minted in the same millisecond, and the
      // ledger has no insert-if-absent to arbitrate that (P2).
      const found = ctx.leadIntake.lookup(ctx.submissionKey);
      ctx.counts.lead_intake_lookups++;
      if (found && found.ok && found.known) {
        const result = canonicalResult(found.body);
        if (result) { return { resolved: true, source: 'lookup', result: result }; }
        // `known: true` is a positive assertion that a record exists. A body that does not
        // yield a canonical lead id therefore means "something was created and we cannot
        // name it" -- which is ambiguity, not absence. Releasing the claim here would risk
        // a duplicate lead, so the claim is preserved and an operator settles it.
        return { resolved: false, unresolved: true, lookup_answer: 'KNOWN_UNUSABLE_BODY' };
      }
      if (!found || !found.ok) {
        // The downstream could not tell us. Ambiguity is preserved, not gambled on.
        return { resolved: false, unresolved: true, lookup_answer: 'CANNOT_ANSWER' };
      }
      // Answered, and the key is genuinely unknown downstream: nothing was created, so a
      // fresh attempt is safe. The stale `submitting` claim has to be released first --
      // §10 allows a failure before canonical success to move to `retryable_error`, and
      // without that step the claim would block its own retry forever.
      //
      // A `submitted` record with no canonical lead anywhere is a different animal: the
      // state machine forbids leaving `submitted`, so it stays unresolved for an operator
      // rather than being quietly downgraded into a fresh submission.
      if (state === 'submitted') { return { resolved: false, unresolved: true, lookup_answer: 'NOT_COMMITTED' }; }
      return { resolved: false, unresolved: false, release: true, lookup_answer: 'NOT_COMMITTED' };
    }
    // G1 -- the recovery adapter is absent. This is a DEPLOYMENT condition, not a request
    // error, and it is reported under its own code so it can never be mistaken in the log
    // for a transient downstream failure.
    //
    // The claim is deliberately NOT released. Releasing it would permit a fresh Lead Intake
    // call for a submission whose outcome is unknown, which is the duplicate this whole
    // mechanism exists to prevent. Two safe recoveries remain open and neither needs this
    // code path: an operator writing the canonical binding to Bot_Sessions (resolved by the
    // `authority` branch above on the next attempt), or a Concierge cycle change, which
    // changes the idempotency key and frees the user without touching the stale claim.
    return { resolved: false, unresolved: true, blocked: true, reason: adapter.reason };
  }

  return { resolved: false, unresolved: false };
}

// ------------------------------------------------------- G2 pre-handoff cycle guard

// Re-read authority and the app session IMMEDIATELY before the irreversible Lead Intake
// call and prove the whole context is still the one that owns the claim.
//
// The defect this closes: the cycle was read once near handler start and never re-checked,
// so a Concierge cycle reset landing mid-flight could not be detected and the lead was
// bound with `lead_cycle_id` from a cycle that no longer existed.
//
// The invariant: no irreversible handoff unless the authoritative cycle being submitted is
// still the same cycle that owns this operation's claim.
//
// This narrows the window to (guard read -> Intake call). It does not eliminate it: without
// a distributed transaction across Bot_Sessions, the session store and Lead Intake, no
// gateway-side check can. The residual is stated in the threat model rather than papered
// over here.
function assertHandoffGuard(ctx) {
  ctx.counts.handoff_guards++;

  const auth = ctx.authority.read(ctx.chatId);
  if (!auth || !auth.ok || !auth.row) {
    return { ok: false, code: 'TEMPORARY_BACKEND_ERROR', stage: 'HANDOFF_AUTHORITY_READ' };
  }
  const row = auth.row;

  // Same identity. A row that now belongs to a different chat is an identity failure.
  const authChatId = C.normValue(row.chat_id);
  if (authChatId !== '' && authChatId !== ctx.chatId) {
    return { ok: false, code: 'SESSION_INVALID', stage: 'HANDOFF_CHAT_MISMATCH' };
  }

  // Same cycle. This is the reset-in-flight check.
  if (C.normValue(row.cycle_id) !== ctx.cycleId) {
    return { ok: false, code: 'CYCLE_SUPERSEDED', stage: 'CYCLE_RESET_IN_FLIGHT' };
  }

  // F3 -- and the SAME SUBMISSION KEY. The dangerous case the cycle check cannot see: a
  // competing issuer won Bot_Sessions with the same cycle_id but its own key, so authority
  // still reads cycle X while the authoritative receipt is now a different one. Handing off
  // here would claim a receipt that is no longer current.
  if (C.normValue(row.submission_key) !== ctx.submissionKey) {
    return { ok: false, code: 'CYCLE_SUPERSEDED', stage: 'SUBMISSION_KEY_DRIFT_IN_FLIGHT' };
  }

  // Consent must still be current for THIS cycle. A consent withdrawn or re-stamped onto a
  // newer cycle between the stamp and the handoff must stop the submit.
  if (C.normValue(row.consent) !== 'yes' || C.normValue(row.consent_cycle_id) !== ctx.cycleId) {
    return { ok: false, code: 'CONSENT_STALE_CYCLE', stage: 'CONSENT_INVALID_AT_HANDOFF' };
  }

  const read = ctx.sessions.read(ctx.appSessionId);
  if (!read || !read.ok || !read.session) {
    return { ok: false, code: 'SESSION_INVALID', stage: 'HANDOFF_SESSION_READ' };
  }
  const session = read.session;

  // The session must not have been re-bound to a newer cycle underneath us.
  if (C.normValue(session.cycle_id) !== ctx.cycleId) {
    return { ok: false, code: 'CYCLE_SUPERSEDED', stage: 'SESSION_REBOUND' };
  }

  // F3 -- nor to a different submission key on the same cycle.
  if (C.normValue(session.submission_key) !== ctx.submissionKey) {
    return { ok: false, code: 'CYCLE_SUPERSEDED', stage: 'SESSION_KEY_REBOUND' };
  }

  // Legal state: only a live claim may hand off.
  if (C.normValue(session.submit_state) !== 'submitting') {
    return { ok: false, code: 'SUBMIT_IN_PROGRESS', stage: 'HANDOFF_STATE_ILLEGAL' };
  }

  // The claim must still belong to THIS operation. The idempotency key alone cannot prove
  // that -- two concurrent submits for one (user, cycle) share it by construction -- so the
  // claim carries a per-operation owner token, which is the server correlation id.
  if (C.normValue(session.claim_owner) !== ctx.correlationId) {
    return { ok: false, code: 'SUBMIT_IN_PROGRESS', stage: 'CLAIM_REASSIGNED' };
  }

  return { ok: true };
}

// ------------------------------------------------------- G3 uncaught-throw classifier

// Classify a thrown injected client by WHERE it threw, because the two cases have opposite
// safe answers and nothing else in the request can tell them apart.
//
// Before the handoff marker is set, no Lead Intake call can have been made. Nothing
// irreversible exists, a retry is free, and TEMPORARY_BACKEND_ERROR says exactly that.
//
// At or after the marker, a lead may or may not exist. The marker is set immediately BEFORE
// the call precisely so that a throw from inside `leadIntake.submit` is not mistaken for one
// just before it -- `lead_intake_calls` cannot make that distinction, because it is only
// incremented once the call has RETURNED. Answering "retryable backend error" here would
// invite the duplicate this whole slice exists to prevent, so the answer is
// SUBMIT_UNRESOLVED: the claim and the `submitting` state are left untouched for the
// resolver to settle on the next attempt.
//
// The thrown value is never read. `detail` is a fixed label rather than the error's message,
// because a message can carry a URL, a row or a contact field (T23, T24, T35), and `reject`
// keeps detail out of the browser response but not out of the log.
function catchToResponse(run) {
  if (run.handoffAttempted === true) {
    return reject('SUBMIT_UNRESOLVED', 'UNCAUGHT_AFTER_HANDOFF', run.correlationId, run.counts,
      'injected client threw at or after the Lead Intake call');
  }
  return reject('TEMPORARY_BACKEND_ERROR', 'UNCAUGHT_BEFORE_HANDOFF', run.correlationId, run.counts,
    'injected client threw before any irreversible call');
}

// ---------------------------------------------------------------------- §9 entry point

// G3 -- the whole sequence runs inside the one try in the slice. Every dependency is
// injected, so every dependency may throw: an n8n HTTP node raising on a 5xx, a Sheets
// client raising on a quota error, a mirror client raising on a closed Data Table. Before
// this, any of those turned an in-flight submit into an unhandled node error with no
// response shape, no counters and no correlation id -- and, after the Intake call, no record
// that a lead might exist.
function handleSubmit(opts) {
  const o = opts || {};
  // Minted before the try so the catch always has one, even for a throw on the first line.
  const run = {
    counts: counters(),
    correlationId: C.normValue(o.correlationId) || C.newCorrelationId(),
    handoffAttempted: false
  };
  try {
    return submitSequence(o, run);
  } catch (e) {
    return catchToResponse(run);
  }
}

function submitSequence(o, run) {
  const counts = run.counts;
  const correlationId = run.correlationId;
  const clock = o.clock;
  const stamp = nowIso(clock);

  // ---- §12 transport guards -------------------------------------------------------
  const headers = o.headers || {};
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '')
    .split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return reject('BAD_REQUEST', 'CONTENT_TYPE', correlationId, counts, 'expected application/json');
  }
  if (o.rateLimited === true) {
    return reject('RATE_LIMITED', 'RATE_LIMIT', correlationId, counts);
  }

  // ---- §9.1 body validation and the untrusted-field drop --------------------------
  const v = C.validateSubmitBody(o.body);
  if (!v.ok) {
    return reject(v.error_code, v.stage, correlationId, counts, v.detail);
  }

  // ---- §9.1 resolve the app session SERVER-SIDE ------------------------------------
  const sessions = o.sessions;
  const read = sessions.read(v.app_session_id);
  if (!read || !read.ok || !read.session) {
    return reject('SESSION_INVALID', 'SESSION_LOOKUP', correlationId, counts);
  }
  const session = read.session;

  const telegramUserId = C.normValue(session.telegram_user_id);
  if (telegramUserId === '' || !/^[0-9]+$/.test(telegramUserId)) {
    return reject('SESSION_INVALID', 'SESSION_IDENTITY', correlationId, counts);
  }

  // §6 -- server-side TTL. An expired binding is not an identity.
  const expiresAt = C.normValue(session.expires_at);
  if (expiresAt !== '' && expiresAt <= stamp) {
    return reject('SESSION_EXPIRED', 'SESSION_TTL', correlationId, counts);
  }

  // ---- §9.2 confirm the session belongs to the CURRENT authoritative cycle ---------
  const chatId = C.normValue(session.chat_id) || telegramUserId;
  const auth = o.authority.read(chatId);
  if (!auth || !auth.ok || !auth.row) {
    return reject('TEMPORARY_BACKEND_ERROR', 'AUTHORITY_READ', correlationId, counts);
  }
  const authorityRow = auth.row;

  // The authoritative row must belong to the same Telegram user the session was issued to.
  // A session id that resolved to somebody else's chat is an identity failure, not a miss.
  const authChatId = C.normValue(authorityRow.chat_id);
  if (authChatId !== '' && authChatId !== chatId) {
    return reject('SESSION_INVALID', 'SESSION_CHAT_MISMATCH', correlationId, counts);
  }

  const cycleId = C.normValue(authorityRow.cycle_id);
  const sessionCycleId = C.normValue(session.cycle_id);
  if (cycleId === '') {
    return reject('CYCLE_SUPERSEDED', 'CYCLE_MISSING', correlationId, counts);
  }
  if (sessionCycleId !== cycleId) {
    // §6 -- the app session is invalidated when the authoritative cycle changes. A submit
    // arriving on the old binding is refused; the client re-bootstraps and re-consents.
    return reject('CYCLE_SUPERSEDED', 'CYCLE_DRIFT', correlationId, counts);
  }

  // P3 — read the preallocated submission key from AUTHORITY. A current cycle is required to
  // have one (the preallocation invariant), so its absence is a broken invariant: it must fail
  // closed, never be read as an empty ledger that permits a fresh submit.
  const submissionKey = C.normValue(authorityRow.submission_key);
  if (submissionKey === '') {
    return reject('PRE_ACTIVATION_BLOCKED', 'SUBMISSION_KEY_MISSING_ON_AUTHORITY', correlationId, counts);
  }

  // F3 — THE CYCLE ID ALONE IS NOT AN IDENTITY.
  //
  // P3 proved two concurrent issuers can mint the SAME cycle_id (it is
  // `C-<chat_id>-<Date.now()>`, 1 ms resolution) while holding DIFFERENT submission keys. So a
  // session bound to cycle X / key A can find authority still showing cycle X — but key B,
  // because the other issuer won Bot_Sessions afterwards. Comparing cycles alone would pass
  // that, and the submit would hand off against a receipt no longer current.
  //
  // The binding is therefore (cycle_id AND submission_key), everywhere.
  const sessionSubmissionKey = C.normValue(session.submission_key);
  if (sessionSubmissionKey === '' || sessionSubmissionKey !== submissionKey) {
    return reject('CYCLE_SUPERSEDED', 'SUBMISSION_KEY_DRIFT', correlationId, counts);
  }

  const ctx = {
    chatId: chatId,
    cycleId: cycleId,
    submissionKey: submissionKey,
    appSessionId: v.app_session_id,
    correlationId: correlationId,
    sessions: sessions,
    authority: o.authority,
    authorityRow: authorityRow,
    leadIntake: o.leadIntake,
    mirror: o.mirror,
    counts: counts,
    nowIso: stamp
  };

  // ---- §9.3 / §10 resolve prior submit state BEFORE anything else -----------------
  //
  // Deliberately ahead of the consent gate: a client retrying after a success it never saw
  // may send anything at all in the consent field, and the already-committed canonical
  // result is the correct answer regardless. Re-running the gate here would let a retry
  // turn a completed submission into an error.
  const prior = resolvePriorSubmission(ctx, session);
  if (prior.resolved) {
    const success = C.buildSubmitSuccess(prior.result);
    // Converge the records that lagged behind, without a second Intake call.
    if (C.normValue(session.submit_state) !== 'submitted' || C.normValue(session.lead_id) === '') {
      sessions.update(v.app_session_id, {
        submit_state: 'submitted',
        lead_id: prior.result.lead_id,
        lead_cycle_id: cycleId,
        mode: prior.result.mode,
        priority: prior.result.priority,
        financial_zone: prior.result.financial_zone
      });
      counts.session_writes++;
    }
    const replayMode = C.internalMode(prior.result.mode);
    return accept(success, correlationId, counts, {
      idempotent_replay: true,
      resolved_from: prior.source,
      // N6.2 -- `mode` no longer crosses TB-1, so the log is the ONLY place it survives.
      // It is recorded on the replay paths too, not just on a fresh success: without this,
      // removing the field from the response would have quietly cost the observability that
      // canary L7 and L8 depend on, which the owner decision explicitly forbids.
      lead_mode: replayMode.observed,
      lead_mode_known: replayMode.known,
      // G6 -- false means the lead id is canonical but mode/priority/zone in the response
      // are clamp defaults, not recovered values. Only the authority branch can report it.
      classification_recovered: prior.classification_recovered !== false,
      untrusted_fields_ignored: v.ignored_untrusted
    });
  }
  if (prior.blocked === true) {
    // G1 -- an interrupted submission exists and the capability that could settle it is not
    // deployed. Distinct code, zero writes, claim preserved. Recovery is an operator writing
    // the canonical binding to authority, or a cycle change; never an automatic re-submit.
    return reject('PRE_ACTIVATION_BLOCKED', prior.reason, correlationId, counts,
      C.RECOVERY_ADAPTER_CONTRACT.method);
  }
  if (prior.unresolved) {
    // §10 -- an ambiguous downstream outcome is resolved before another Intake call, and
    // this request is not the place to gamble. The client is told to retry.
    return reject('SUBMIT_UNRESOLVED', 'AMBIGUOUS_PRIOR_ATTEMPT', correlationId, counts,
      prior.lookup_answer || null);
  }

  // The interrupted attempt provably created nothing. Release the stale claim so the retry
  // below can legally re-acquire it. This is the only path that moves a state backwards,
  // and it can never touch `submitted`: the resolver returns `release` only for a state
  // whose canonical result does not exist.
  let currentState = C.normValue(session.submit_state) || 'draft';
  if (prior.release === true) {
    sessions.update(v.app_session_id, { submit_state: 'retryable_error', released_at: stamp });
    counts.session_writes++;
    currentState = 'retryable_error';
  }

  // ---- §8 consent ------------------------------------------------------------------
  const consent = C.evaluateConsent({
    consent: v.consent,
    authorityCycleId: cycleId,
    sessionCycleId: sessionCycleId,
    nowIso: stamp
  });

  if (!consent.eligible) {
    if (consent.reason === 'CONSENT_NO') {
      // §8 -- NO must not call Lead Intake. An accepted, side-effect-free outcome: the
      // submit state does not move, so the client may still consent later in this cycle.
      return accept(
        { ok: true, consent: 'no', submit_state: C.normValue(session.submit_state) || 'draft' },
        correlationId,
        counts,
        { consent_decision: 'no', untrusted_fields_ignored: v.ignored_untrusted }
      );
    }
    return reject(consent.error_code, 'CONSENT_GATE', correlationId, counts, consent.reason);
  }

  // ---- G1 structural pre-activation blocker ----------------------------------------
  //
  // From here on the request is heading for an IRREVERSIBLE Lead Intake call. If the
  // recovery adapter is not deployed, an interruption anywhere in the remainder of this
  // sequence would leave a submission whose outcome can never be established -- exactly the
  // permanently-stranded state G1 describes.
  //
  // So the blocker is enforced rather than documented: with no adapter there is no fresh
  // handoff, therefore no unrecoverable state can be created in the first place. This is
  // checked AFTER the consent gate on purpose -- `consent: "no"` is a zero-effect accepted
  // outcome that needs no recovery path and must keep working -- and BEFORE the consent
  // stamp, so a blocked deployment performs no writes of any kind.
  const adapter = C.recoveryAdapterStatus(o.leadIntake);
  if (!adapter.available) {
    return reject('PRE_ACTIVATION_BLOCKED', adapter.reason, correlationId, counts,
      C.RECOVERY_ADAPTER_CONTRACT.method);
  }

  // ---- §9.5 stamp current-cycle consent on the AUTHORITY ---------------------------
  const consentWritten = o.authority.write(chatId, {
    consent: consent.stamp.consent,
    consent_cycle_id: consent.stamp.consent_cycle_id,
    consent_at: consent.stamp.consent_at,
    consent_source: consent.stamp.consent_source,
    updated_at: stamp
  });
  counts.authority_writes++;
  if (!consentWritten || !consentWritten.ok) {
    return reject('TEMPORARY_BACKEND_ERROR', 'CONSENT_WRITE', correlationId, counts);
  }

  // ---- §9.6 normalise into the existing Lead Intake payload -------------------------
  const built = C.buildLeadIntakePayload({
    answers: v.answers,
    free_text: v.free_text,
    contact: v.contact,
    telegramUserId: telegramUserId,
    locale: o.locale,
    clientVersion: v.client_version,
    correlationId: correlationId,
    nowIso: stamp
  });
  if (!built.ok) {
    return reject(built.error_code, built.stage, correlationId, counts, built.detail);
  }

  // ---- §10 claim the key, then call Intake exactly once -----------------------------
  //
  // The claim is a conditional update on the CURRENT submit_state. Two concurrent submits
  // for the same session cannot both move draft -> submitting, so only one of them ever
  // reaches the Intake call. The claim happens before the call, not after, so a crash
  // mid-flight leaves `submitting` behind -- which is exactly the ambiguity the resolver
  // above is built to settle.
  const fromState = currentState;
  if (!C.canTransition(fromState, 'submitting')) {
    return reject('SUBMIT_IN_PROGRESS', 'STATE_NOT_CLAIMABLE', correlationId, counts, fromState);
  }
  const claim = sessions.claim(v.app_session_id, {
    from: fromState,
    to: 'submitting',
    // G2 -- `claim_owner` is the per-operation ownership token. The idempotency key cannot
    // serve as one: two concurrent submits for the same (user, cycle) share it by
    // construction, so it identifies the submission, not the operation holding the claim.
    // P3.1 -- the claim records OWNERSHIP only. It must NOT write submission_key back onto
    // the session: the binding is set at bootstrap, and re-stamping it here would silently
    // repair a drift that the pre-handoff guard exists to catch. Found by the mid-request
    // re-bind test, which passed for the wrong reason until this was removed.
    patch: { claimed_at: stamp, claim_owner: correlationId }
  });
  counts.session_writes++;
  if (!claim || !claim.ok || claim.updated_rows === 0) {
    return reject('SUBMIT_IN_PROGRESS', 'CLAIM_LOST', correlationId, counts);
  }

  // ---- G2 the last check before the point of no return ------------------------------
  //
  // On failure this writes NOTHING. Not the session, not authority, and no Intake call.
  // The temptation is to release our own claim on the way out, but the guard fails
  // precisely when the context can no longer be trusted -- and one of its failure modes is
  // that the claim now belongs to a different operation, whose state a stale request must
  // never touch. A session left at `submitting` on a superseded cycle is already dead: the
  // §9.2 cycle check refuses every later request on it, so the user re-bootstraps onto the
  // new cycle and nothing is stranded that was not already gone.
  const guard = assertHandoffGuard(ctx);
  if (!guard.ok) {
    return reject(guard.code, guard.stage, correlationId, counts);
  }

  // ---- §9.7 one call, and only one -------------------------------------------------
  //
  // G3 -- set BEFORE the call and never cleared. From here on an uncaught throw means "a
  // lead may exist", and the top-level catch answers SUBMIT_UNRESOLVED instead of inviting a
  // retry into a duplicate.
  run.handoffAttempted = true;
  // F2 -- the fresh server-to-server call carries the AUTHORITATIVE submission key. Not the
  // retired derived key, not request_id, and nothing the browser can influence: it was read
  // from Bot_Sessions at §9.2 and re-proved unchanged by the handoff guard a moment ago.
  //
  // Lead Intake claims the receipt with it BEFORE writing to Pipeline
  // (LEAD_INTAKE_CLAIM_ORDER), which is what makes this handoff safe rather than merely
  // identified.
  const called = o.leadIntake.submit({
    submission_key: ctx.submissionKey,
    envelope: built.envelope
  });
  counts.lead_intake_calls++;

  if (called && called.ambiguous === true) {
    // §10 -- unknown outcome. The state stays `submitting` on purpose: the next attempt
    // resolves it through lookup rather than re-submitting into a possible duplicate.
    return reject('SUBMIT_UNRESOLVED', 'INTAKE_AMBIGUOUS', correlationId, counts);
  }

  const result = called && called.ok ? canonicalResult(called.body) : null;
  if (!result) {
    // §9.8 -- anything that is not `response.ok === true` with a canonical lead id is a
    // failure. Recoverable: the state drops to retryable_error so the client may retry.
    sessions.update(v.app_session_id, { submit_state: 'retryable_error', failed_at: stamp });
    counts.session_writes++;
    return reject('TEMPORARY_BACKEND_ERROR', 'INTAKE_FAILED', correlationId, counts);
  }

  // ---- §9.9 persist canonical identity before telling the client anything ----------
  const persisted = persistCanonical(ctx, result);
  if (!persisted.ok) {
    // The lead exists downstream but the binding did not commit. Reporting success here
    // would strand a lead the gateway can no longer recognise on retry, so the client is
    // told to retry and the state stays `submitting` for the resolver to settle.
    return reject('SUBMIT_UNRESOLVED', persisted.reason, correlationId, counts);
  }

  // ---- §9.10 one clean success -----------------------------------------------------
  const observedMode = C.internalMode(result.mode);
  return accept(C.buildSubmitSuccess(result), correlationId, counts, {
    idempotent_replay: false,
    // Unclamped on purpose: canary L7 must observe what Lead Intake actually returned, and
    // `lead_mode_known: false` is how a vocabulary drift becomes visible rather than smoothed
    // into `new` by the response clamp -- which no longer exists for mode in any case.
    lead_mode: observedMode.observed,
    lead_mode_known: observedMode.known,
    payload_bytes: built.payload_bytes,
    untrusted_fields_ignored: v.ignored_untrusted,
    // §12 -- init_data, signatures, contact details and credentials are never logged.
    logged_contact_fields: []
  });
}

module.exports = {
  handleSubmit,
  catchToResponse,
  canonicalResult,
  resolvePriorSubmission,
  assertHandoffGuard,
  persistCanonical,
  counters
};
