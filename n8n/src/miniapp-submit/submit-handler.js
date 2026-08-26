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
//
// Injected contracts:
//   sessions.read(appSessionId)                    -> { ok, session }
//   sessions.claim(appSessionId, {from,to,patch})  -> { ok, updated_rows }   conditional CAS
//   sessions.update(appSessionId, patch)           -> { ok }
//   authority.read(chatId)                         -> { ok, row }
//   authority.write(chatId, patch)                 -> { ok }
//   leadIntake.submit({ idempotency_key, envelope })-> { ok, ambiguous, body }
//   leadIntake.lookup(idempotencyKey)              -> { ok, known, body }
//   mirror(chatId)                                 -> optional; derived read model refresh
//   clock.now()                                    -> ISO string
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
    mirror_runs: 0
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
  const wrote = ctx.authority.write(ctx.chatId, {
    lead_id: result.lead_id,
    lead_cycle_id: ctx.cycleId,
    lead_intake_ok: 'true',
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

  if (typeof ctx.mirror === 'function') {
    ctx.mirror(ctx.chatId);
    ctx.counts.mirror_runs++;
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
    if (ctx.leadIntake && typeof ctx.leadIntake.lookup === 'function') {
      const found = ctx.leadIntake.lookup(ctx.idempotencyKey);
      ctx.counts.lead_intake_lookups++;
      if (found && found.ok && found.known) {
        const result = canonicalResult(found.body);
        if (result) { return { resolved: true, source: 'lookup', result: result }; }
      }
      if (!found || !found.ok) {
        // The downstream could not tell us. Ambiguity is preserved, not gambled on.
        return { resolved: false, unresolved: true };
      }
      // Answered, and the key is genuinely unknown downstream: nothing was created, so a
      // fresh attempt is safe. The stale `submitting` claim has to be released first --
      // §10 allows a failure before canonical success to move to `retryable_error`, and
      // without that step the claim would block its own retry forever.
      //
      // A `submitted` record with no canonical lead anywhere is a different animal: the
      // state machine forbids leaving `submitted`, so it stays unresolved for an operator
      // rather than being quietly downgraded into a fresh submission.
      if (state === 'submitted') { return { resolved: false, unresolved: true }; }
      return { resolved: false, unresolved: false, release: true };
    }
    return { resolved: false, unresolved: true };
  }

  return { resolved: false, unresolved: false };
}

// ---------------------------------------------------------------------- §9 entry point

function handleSubmit(opts) {
  const o = opts || {};
  const counts = counters();
  const correlationId = C.normValue(o.correlationId) || C.newCorrelationId();
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

  const idempotencyKey = C.idempotencyKey(telegramUserId, cycleId);
  if (!idempotencyKey) {
    return reject('TEMPORARY_BACKEND_ERROR', 'IDEMPOTENCY_KEY', correlationId, counts);
  }

  const ctx = {
    chatId: chatId,
    cycleId: cycleId,
    appSessionId: v.app_session_id,
    idempotencyKey: idempotencyKey,
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
    return accept(success, correlationId, counts, {
      idempotent_replay: true,
      resolved_from: prior.source,
      untrusted_fields_ignored: v.ignored_untrusted
    });
  }
  if (prior.unresolved) {
    // §10 -- an ambiguous downstream outcome is resolved before another Intake call, and
    // this request is not the place to gamble. The client is told to retry.
    return reject('SUBMIT_UNRESOLVED', 'AMBIGUOUS_PRIOR_ATTEMPT', correlationId, counts);
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
    patch: { idempotency_key: idempotencyKey, claimed_at: stamp }
  });
  counts.session_writes++;
  if (!claim || !claim.ok || claim.updated_rows === 0) {
    return reject('SUBMIT_IN_PROGRESS', 'CLAIM_LOST', correlationId, counts);
  }

  // ---- §9.7 one call, and only one -------------------------------------------------
  const called = o.leadIntake.submit({
    idempotency_key: idempotencyKey,
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
  return accept(C.buildSubmitSuccess(result), correlationId, counts, {
    idempotent_replay: false,
    mode: result.mode,
    payload_bytes: built.payload_bytes,
    untrusted_fields_ignored: v.ignored_untrusted,
    // §12 -- init_data, signatures, contact details and credentials are never logged.
    logged_contact_fields: []
  });
}

module.exports = {
  handleSubmit,
  canonicalResult,
  resolvePriorSubmission,
  persistCanonical,
  counters
};
