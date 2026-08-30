/* FINMENTOR Premium Mini App — the network layer.
 *
 * Three calls, and nothing else:
 *
 *   bootstrap()            POST  <gateway>          initData  -> app_session_id
 *   saveDraft(step, f)     PUT   <session endpoint> draft fields, server-side
 *   submit(ack)            POST  <submit endpoint>  session id + privacy acknowledgement
 *
 * ── WHAT THE CLIENT IS NOT ALLOWED TO SEND ──────────────────────────────────────────────────────
 *
 * `submit` carries the session id and the privacy acknowledgement, and NOTHING ELSE. The answers
 * already live server-side, written one screen at a time by `saveDraft`, so there is nothing to
 * whitelist on arrival because there is nothing to accept. An injected `answers`, `lead_id` or
 * `priority` is not filtered out — it is simply never read. `assertSubmitBody` below enforces the
 * same shape from this side, so a future edit cannot quietly widen it.
 *
 * ── SUCCESS IS `ok === true`, AND NOTHING ELSE ──────────────────────────────────────────────────
 *
 * Not HTTP 2xx. Not "the request did not throw". Not a parseable body. That rule is what stops the
 * app showing «Обращение передано» over a failed write — the same class of defect as the Gateway
 * answering 409 to an outage (P9-R2) and Lead Intake reaching a write on one (P9-R4).
 *
 * ── RETRY, AND WHY IT CANNOT DOUBLE-SUBMIT ──────────────────────────────────────────────────────
 *
 * Retry re-sends the SAME app_session_id and the SAME acknowledgement timestamps. Server-side:
 *
 *   · the submission key is derived from the session, so Lead Intake dedup sees one request;
 *   · the privacy store has a unique index on submission_key and treats 23505 as already-recorded;
 *   · `submitted` is terminal, so a retry after a committed submission is refused, not merged.
 *
 * The client therefore does not need — and must not invent — its own idempotency key. What it must
 * do is never mutate the acknowledgement on retry, which `submit()` guarantees by taking the ack
 * captured at the first attempt.
 *
 * ── ENDPOINTS ARE INJECTED AT DEPLOY TIME ───────────────────────────────────────────────────────
 *
 * `window.FM_ENDPOINTS` is written by the host page. If it is missing or still holds placeholders,
 * `configured()` is false and the app stays in its offline state rather than pretending.
 */
(function () {
  'use strict';

  var PLACEHOLDER = /__[A-Z0-9_]+__/;
  var TIMEOUT_MS = 20000;

  function endpoints() {
    var e = window.FM_ENDPOINTS || {};
    return {
      gateway: String(e.gateway || ''),
      session: String(e.session || ''),
      submit: String(e.submit || '')
    };
  }

  function configured() {
    var e = endpoints();
    if (!e.gateway || !e.session || !e.submit) { return false; }
    return !(PLACEHOLDER.test(e.gateway) || PLACEHOLDER.test(e.session) || PLACEHOLDER.test(e.submit));
  }

  // Every failure this layer can produce, as a closed set. The UI maps these to approved copy; an
  // unmapped code renders the generic failure screen rather than a raw message.
  // A code the client does not know is downgraded to BAD_RESPONSE, which is non-retryable. That
  // is a safe default and a bad user experience, so the list below is the FULL set the three
  // deployed endpoints can return — read out of their response nodes, not guessed. A gate holds
  // it against them.
  var CODES = {
    NOT_CONFIGURED: 'NOT_CONFIGURED',     // no endpoints — offline candidate
    NO_TELEGRAM: 'NO_TELEGRAM',           // not running inside Telegram
    NETWORK: 'NETWORK',                   // transport failed
    TIMEOUT: 'TIMEOUT',                   // no answer in time
    BAD_RESPONSE: 'BAD_RESPONSE',         // answered, but not with ok:true — see the rule above

    // ── Gateway ──────────────────────────────────────────────────────────────────────────────
    BAD_REQUEST: 'BAD_REQUEST',
    CLIENT_VERSION_UNSUPPORTED: 'CLIENT_VERSION_UNSUPPORTED',
    TG_INITDATA_MISSING: 'TG_INITDATA_MISSING',
    TG_INITDATA_INVALID: 'TG_INITDATA_INVALID',
    TG_INITDATA_EXPIRED: 'TG_INITDATA_EXPIRED',
    TG_INITDATA_FUTURE: 'TG_INITDATA_FUTURE',
    TG_USER_MISSING: 'TG_USER_MISSING',
    TG_USER_INVALID: 'TG_USER_INVALID',
    TG_USER_BOT: 'TG_USER_BOT',
    RATE_LIMITED: 'RATE_LIMITED',
    TEMPORARY_BACKEND_ERROR: 'TEMPORARY_BACKEND_ERROR',
    // G5 said this signed context was already spent. It is NOT a transport failure and must
    // never be retried with the same initData — the client cannot mint a new one, so the only
    // recovery is reopening the Mini App.
    REPLAY_REFUSED: 'REPLAY_REFUSED',
    REPLAY_STORE_UNAVAILABLE: 'REPLAY_STORE_UNAVAILABLE',

    // ── session and submit ───────────────────────────────────────────────────────────────────
    SESSION_INVALID: 'SESSION_INVALID',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    NOT_AUTHORISED: 'NOT_AUTHORISED',
    SUBMIT_IN_PROGRESS: 'SUBMIT_IN_PROGRESS',
    CONSENT_REQUIRED: 'CONSENT_REQUIRED',
    DRAFT_EMPTY: 'DRAFT_EMPTY',
    PRIVACY_UNRESOLVED: 'PRIVACY_UNRESOLVED',
    SUBMIT_UNRESOLVED: 'SUBMIT_UNRESOLVED'
  };

  // The Gateway REQUIRES this exact string in the bootstrap body and rejects anything else with
  // CLIENT_VERSION_UNSUPPORTED. It is the Gateway's wire version, not the Mini App build number.
  var GATEWAY_CLIENT_VERSION = 'b2.1.0';

  function fail(code, retryable, detail) {
    return { ok: false, error_code: code, retryable: retryable === true, detail: detail || '' };
  }

  // One place where a response becomes a verdict.
  function verdict(res, body) {
    if (!body || typeof body !== 'object') { return fail(CODES.BAD_RESPONSE, true); }
    if (body.ok === true) { return { ok: true, body: body }; }
    var code = String(body.error_code || CODES.BAD_RESPONSE);
    // The server states retryability; the client does not infer it from a status code.
    var retryable = body.retryable === true;
    return fail(CODES[code] ? code : CODES.BAD_RESPONSE, retryable, String(res && res.status || ''));
  }

  function request(url, method, payload) {
    if (!configured()) { return Promise.resolve(fail(CODES.NOT_CONFIGURED, false)); }
    var controller = null;
    var timer = null;
    try { controller = new AbortController(); } catch (e) { controller = null; }
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (controller) {
      opts.signal = controller.signal;
      timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, TIMEOUT_MS);
    }
    return fetch(url, opts).then(function (res) {
      if (timer) { clearTimeout(timer); }
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        return verdict(res, body);
      });
    }).catch(function (e) {
      if (timer) { clearTimeout(timer); }
      var aborted = e && (e.name === 'AbortError' || String(e).indexOf('abort') !== -1);
      return fail(aborted ? CODES.TIMEOUT : CODES.NETWORK, true, '');
    });
  }

  // ---------------------------------------------------------------- session

  // `state` and `draft` come back from the Gateway when it RESUMES an existing session rather
  // than minting one. They are the client's own answers returning to it; nothing else crosses.
  var session = { id: '', expires_at: '', locale: '', state: '', resumed: false, draft: null };

  // The Mini App never mints its own identity. It hands Telegram's initData to the Gateway, which
  // validates the signature, claims the replay ledger and issues an opaque session id. The raw
  // initData is used for this one call and is never stored, logged or re-sent.
  // ONE BOOTSTRAP PER PAGE LIFECYCLE, ENFORCED HERE RATHER THAN BY THE CALLER.
  //
  // The promise is memoised, so every later call — a re-render, a second entry into the start
  // screen, a defensive call somewhere in app.js — receives the SAME result without a second
  // request. A caller cannot replay the signed context by accident, because a caller cannot
  // reach the request at all after the first one.
  //
  // AND IT IS NEVER RETRIED WITH THE SAME initData. A transport failure leaves it unknowable
  // whether G5 claimed the key: the INSERT may have committed and the response been lost. Re-
  // sending would either be refused as a replay or, worse, mint a second session for one signed
  // context. The client cannot mint fresh initData — only reopening the Mini App does — so the
  // recovery for a failed bootstrap is to reopen, and app.js says exactly that.
  var bootstrapPromise = null;
  var bootstrapAttempts = 0;

  function bootstrap(locale) {
    if (bootstrapPromise) { return bootstrapPromise; }
    bootstrapPromise = runBootstrap(locale);
    return bootstrapPromise;
  }

  function runBootstrap(locale) {
    bootstrapAttempts++;
    var tg = window.Telegram && window.Telegram.WebApp;
    var initData = tg && tg.initData ? String(tg.initData) : '';
    if (!initData) { return Promise.resolve(fail(CODES.NO_TELEGRAM, false)); }

    // The Gateway validates three things about the BODY before it looks at the signature:
    // content type, client_version against its allow-list, and locale against its allow-list.
    // Sending init_data alone returns 400 CLIENT_VERSION_UNSUPPORTED and never reaches Ed25519.
    var body = {
      init_data: initData,
      client_version: GATEWAY_CLIENT_VERSION,
      locale: locale === 'ro' ? 'ro' : 'ru'
    };
    // The only reference this module ever held is dropped now. `body.init_data` is cleared as
    // soon as the request has been serialised, below, so nothing survives the call.
    initData = '';

    return request(endpoints().gateway, 'POST', body).then(function (r) {
      body.init_data = '';
      if (!r.ok) { return r; }
      var id = String(r.body.app_session_id || '');
      if (!/^AS-[0-9a-f]{64}$/.test(id)) {
        return fail(CODES.BAD_RESPONSE, false, 'malformed session id');
      }
      session.id = id;
      session.expires_at = String(r.body.expires_at || '');
      session.locale = String(r.body.locale || 'ru');
      session.state = String(r.body.state || 'draft');
      session.resumed = r.body.resumed === true;
      // Shape-checked here so a malformed stored draft cannot reach the app as one.
      var d = r.body.draft;
      session.draft = (d && typeof d === 'object' && !Array.isArray(d) &&
        d.fields && typeof d.fields === 'object' && !Array.isArray(d.fields)) ? d : null;
      return { ok: true, body: r.body };
    }, function (e) { body.init_data = ''; throw e; });
  }

  // For the gate and the app: has bootstrap been attempted, and did it settle a session?
  function bootstrapCount() { return bootstrapAttempts; }
  function ready() { return session.id !== ''; }

  function sessionId() { return session.id; }
  function expiresAt() { return session.expires_at; }
  function sessionState() { return session.state; }
  function wasResumed() { return session.resumed === true; }
  // The stored draft, or null. The app hydrates from it; nothing else reads it.
  function resumedDraft() { return session.draft; }

  // The server is authoritative on expiry; this is a courtesy check so the app can stop asking
  // questions it already knows will be refused. It is never used to EXTEND anything.
  function likelyExpired() {
    if (!session.expires_at) { return false; }
    return new Date(session.expires_at).getTime() <= Date.now();
  }

  // ---------------------------------------------------------------- draft

  // `fields` is the provenance envelope: { name: { value, source, confirmed } }. The server
  // re-validates every entry; this only refuses to send a shape that is obviously wrong, so a
  // client bug surfaces here rather than as a 400 the user sees.
  var SOURCES = ['user_explicit', 'user_confirmed', 'telegram_carried', 'ai_inferred'];

  function assertDraftFields(fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) { return 'fields must be an object'; }
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) { continue; }
      var f = fields[k];
      if (!f || typeof f !== 'object' || Array.isArray(f)) { return 'field ' + k + ' is not an envelope'; }
      if (typeof f.confirmed !== 'boolean') { return 'field ' + k + ' has no confirmed flag'; }
      if (f.source !== null && SOURCES.indexOf(f.source) === -1) { return 'field ' + k + ' has an unknown source'; }
    }
    return '';
  }

  function saveDraft(step, fields) {
    if (!session.id) { return Promise.resolve(fail(CODES.SESSION_INVALID, false)); }
    var bad = assertDraftFields(fields);
    if (bad) { return Promise.resolve(fail(CODES.BAD_RESPONSE, false, bad)); }
    return request(endpoints().session, 'PUT', {
      app_session_id: session.id,
      step: String(step || ''),
      fields: fields
    });
  }

  // ---------------------------------------------------------------- submit

  // The ONLY keys the submit body may contain.
  var SUBMIT_KEYS = ['app_session_id', 'privacy_ack'];
  var ACK_KEYS = ['notice_version', 'locale', 'shown_at', 'acknowledged_at'];

  function assertSubmitBody(body) {
    var k;
    for (k in body) {
      if (!Object.prototype.hasOwnProperty.call(body, k)) { continue; }
      if (SUBMIT_KEYS.indexOf(k) === -1) { return 'submit body may not carry ' + k; }
    }
    for (k in body.privacy_ack) {
      if (!Object.prototype.hasOwnProperty.call(body.privacy_ack, k)) { continue; }
      if (ACK_KEYS.indexOf(k) === -1) { return 'privacy_ack may not carry ' + k; }
    }
    return '';
  }

  // `ack` is captured ONCE, when the client acknowledges the notice, and is passed unchanged on
  // every retry. Re-stamping `acknowledged_at` on a retry would write a second, contradictory
  // record of when consent was given — and, worse, would look like a fresh acknowledgement.
  function submit(ack) {
    if (!session.id) { return Promise.resolve(fail(CODES.SESSION_INVALID, false)); }
    if (!ack || !ack.notice_version || !ack.shown_at || !ack.acknowledged_at) {
      return Promise.resolve(fail(CODES.CONSENT_REQUIRED, false));
    }
    var body = {
      app_session_id: session.id,
      privacy_ack: {
        notice_version: String(ack.notice_version),
        locale: String(ack.locale || session.locale || 'ru'),
        shown_at: String(ack.shown_at),
        acknowledged_at: String(ack.acknowledged_at)
      }
    };
    var bad = assertSubmitBody(body);
    if (bad) { return Promise.resolve(fail(CODES.BAD_RESPONSE, false, bad)); }
    return request(endpoints().submit, 'POST', body);
  }

  // ---------------------------------------------------------------- what the UI may conclude

  // SUCCESS IS ok === true, INCLUDING A REPLAY OF A COMMITTED SUBMISSION.
  //
  // The endpoint answers a submit against an already-`submitted` session with
  // { ok: true, already: true, lead_id }. That is the truthful answer — the brief WAS accepted —
  // and rendering the failure screen over it was the mirror image of showing «Обращение
  // передано» over a failed write. `verdict()` already treats ok:true as success; this exposes
  // the fact so the UI can tell the two apart if it ever needs to.
  function isCommitted(r) { return !!r && r.ok === true; }
  function wasAlreadyCommitted(r) { return !!r && r.ok === true && !!r.body && r.body.already === true; }

  // Retryability is STATED BY THE SERVER and never inferred from a status code. The three codes
  // below are the client's own, produced without a server answer, and each is classified once:
  //
  //   NETWORK / TIMEOUT   the request may or may not have been processed. For SUBMIT that is
  //                       safe to retry — the submission key is derived from the session, so the
  //                       server collapses a duplicate. For BOOTSTRAP it is not, and bootstrap
  //                       never retries at all.
  //   NOT_CONFIGURED      a build fault. Retrying changes nothing.
  var CLIENT_RETRYABLE = { NETWORK: true, TIMEOUT: true };
  function retryable(r) {
    if (!r || r.ok === true) { return false; }
    if (CLIENT_RETRYABLE[r.error_code]) { return true; }
    return r.retryable === true;
  }

  window.FM_NET = {
    CODES: CODES,
    GATEWAY_CLIENT_VERSION: GATEWAY_CLIENT_VERSION,
    configured: configured,
    endpoints: endpoints,
    bootstrap: bootstrap,
    bootstrapCount: bootstrapCount,
    ready: ready,
    isCommitted: isCommitted,
    wasAlreadyCommitted: wasAlreadyCommitted,
    retryable: retryable,
    sessionId: sessionId,
    sessionState: sessionState,
    wasResumed: wasResumed,
    resumedDraft: resumedDraft,
    expiresAt: expiresAt,
    likelyExpired: likelyExpired,
    saveDraft: saveDraft,
    submit: submit,
    assertDraftFields: assertDraftFields,
    assertSubmitBody: assertSubmitBody
  };
})();
