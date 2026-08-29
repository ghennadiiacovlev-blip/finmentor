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
  var CODES = {
    NOT_CONFIGURED: 'NOT_CONFIGURED',     // no endpoints — offline candidate
    NO_TELEGRAM: 'NO_TELEGRAM',           // not running inside Telegram
    NETWORK: 'NETWORK',                   // transport failed; retryable
    TIMEOUT: 'TIMEOUT',                   // no answer in time; retryable
    BAD_RESPONSE: 'BAD_RESPONSE',         // answered, but not with ok:true — see the rule above
    SESSION_INVALID: 'SESSION_INVALID',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    SUBMIT_IN_PROGRESS: 'SUBMIT_IN_PROGRESS',
    CONSENT_REQUIRED: 'CONSENT_REQUIRED'
  };

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

  var session = { id: '', expires_at: '', locale: '' };

  // The Mini App never mints its own identity. It hands Telegram's initData to the Gateway, which
  // validates the signature, claims the replay ledger and issues an opaque session id. The raw
  // initData is used for this one call and is never stored, logged or re-sent.
  function bootstrap() {
    var tg = window.Telegram && window.Telegram.WebApp;
    var initData = tg && tg.initData ? String(tg.initData) : '';
    if (!initData) { return Promise.resolve(fail(CODES.NO_TELEGRAM, false)); }
    return request(endpoints().gateway, 'POST', { init_data: initData }).then(function (r) {
      if (!r.ok) { return r; }
      session.id = String(r.body.app_session_id || '');
      session.expires_at = String(r.body.expires_at || '');
      session.locale = String(r.body.locale || 'ru');
      if (!/^AS-[0-9a-f]{64}$/.test(session.id)) {
        session.id = '';
        return fail(CODES.BAD_RESPONSE, false, 'malformed session id');
      }
      return { ok: true, body: r.body };
    });
  }

  function sessionId() { return session.id; }
  function expiresAt() { return session.expires_at; }

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

  window.FM_NET = {
    CODES: CODES,
    configured: configured,
    endpoints: endpoints,
    bootstrap: bootstrap,
    sessionId: sessionId,
    expiresAt: expiresAt,
    likelyExpired: likelyExpired,
    saveDraft: saveDraft,
    submit: submit,
    assertDraftFields: assertDraftFields,
    assertSubmitBody: assertSubmitBody
  };
})();
