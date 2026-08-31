/*
 * FINMENTOR — lead submission transport.
 *
 * Included by index.html, ro/index.html, questionnaire.html, ro/questionnaire.html,
 * working-capital-scan.html and ro/working-capital-scan.html. Every public lead the site sends
 * goes through postLead(); there is no other path to the lead webhook.
 *
 * ── THE CONTRACT THIS FILE OWNS ────────────────────────────────────────────────────────────
 *
 *   ONE LOGICAL SUBMISSION = ONE request_id
 *   TWO SUCCESSIVE GENUINE SUBMISSIONS = TWO DISTINCT request_id VALUES
 *
 * The previous version minted one id PER ATTEMPT. It reused an id already on the payload — but
 * all four submitters build their payload INSIDE the submit handler, so a visitor who pressed
 * send again after a timeout arrived with a fresh object and got a fresh id:
 *
 *     var requestId = String(payload.meta.request_id || options.requestId || '') || newRequestId();
 *
 * An id minted per attempt is a correlation reference. It is not an idempotency key, and calling
 * it one does not make it survive the retry it exists for. If the first request COMMITTED and its
 * response was lost, the retry was — to the server — a different request. The pre-identity file is
 * frozen at qa/fixtures/lead-transport.pre-identity.js so the regression suite can keep proving
 * that defect after this fix shipped.
 *
 * ── THE LIFECYCLE, EXACTLY ─────────────────────────────────────────────────────────────────
 *
 *   A  first POST of a logical submission   mint fmr_<32 lc hex> from a CSPRNG, persist in
 *                                           sessionStorage under the tool's slot
 *   B  retry after timeout / lost response  reuse EXACTLY the same token
 *   C  reload before terminal success       reuse EXACTLY the same token
 *   D  validation error before settlement   reuse EXACTLY the same token — a rejected payload is
 *                                           still the same logical submission
 *   E  IDEMPOTENCY_CONFLICT (409)           the slot is marked CONFLICT. The token is RETAINED,
 *                                           nothing is rotated, and a further postLead on this
 *                                           slot is refused BEFORE the network call. There is no
 *                                           automatic retry and no automatic new identity
 *   F  authoritative settlement             the token is retired to the slot's tombstone, so the
 *                                           NEXT genuine submission mints a new one
 *   G  explicit "new request" action        beginNewSubmission() retires the token the same way,
 *                                           and is the ONLY exit from CONFLICT
 *   H  back / forward navigation            a retired token can never be re-offered: reuse
 *                                           requires t !== '' AND t !== the tombstone, and the
 *                                           retirement is written to sessionStorage AND to the
 *                                           in-memory fallback, so a bfcache restore of this
 *                                           script's closure cannot resurrect it
 *
 * Content is NOT part of the slot. An earlier draft re-minted on a payload fingerprint change,
 * which was rejected: it makes editing-then-resending a silent identity rotation, which is
 * exactly what (E) forbids. If the first attempt never settled there is no row to conflict with
 * and the edit simply lands; if it DID settle, the edit is a genuinely new intent and must be a
 * deliberate new submission, not an automatic one.
 *
 * ── SUCCESS IS SERVER-AUTHORITATIVE ────────────────────────────────────────────────────────
 *
 * HTTP 2xx does not retire a token. The business contract does. Lead Intake answers a settled
 * submission from exactly three responders — `Respond New Lead` (mode `new`), `Respond Retry`
 * (mode `retry`) and `Respond Merged` (mode `merged`) — and all three carry `ok:true` AND a
 * non-empty canonical `lead_id`. That pair is the proof, and nothing less is:
 *
 *   HTTP 200 + ok:false        -> token RETAINED (a 2xx from a proxy or an error page reads the same)
 *   HTTP 200 + ok:true, no id  -> token RETAINED (not a canonical settlement result)
 *   timeout after the server settled -> token RETAINED; the retry carries it, the server resolves
 *                                 the same canonical lead, and THAT response retires it
 *
 * ── THE ONE DELIBERATE BEHAVIOUR REGRESSION ────────────────────────────────────────────────
 *
 * `newRequestId()` no longer falls back to `Date.now()` + `Math.random()`. A token that cannot be
 * minted with a CSPRNG is not collision-resistant, and shipping one under an idempotency contract
 * is a lie the server cannot detect. The transport rejects with `identity_unavailable` and each
 * caller's existing "copy your answers / write to the bot" failure copy is shown. That path needs
 * a browser with no Web Crypto at all.
 */
(function () {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 12000;
  var SLOT_PREFIX = 'fm_sub_';
  // Fallback for a browser that refuses sessionStorage (private mode, blocked site data). It
  // survives retries within the page, which is the common case, but not a reload.
  var memory = {};

  /* --------------------------------------------------------------- identity minting */

  // Canonical PUBLIC shape: fmr_<32 lowercase hex>. The dashed randomUUID spelling is folded to
  // the same 32 hex characters so the value the browser sends, the value persisted in Pipeline
  // column AZ and the value in the thank-you `sid` are one string.
  //
  // Returns '' when no CSPRNG is available. See the regression note above.
  function newRequestId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'fmr_' + String(window.crypto.randomUUID()).replace(/-/g, '').toLowerCase();
      }
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
        var hex = '';
        for (var i = 0; i < buf.length; i++) { hex += ('0' + buf[i].toString(16)).slice(-2); }
        return 'fmr_' + hex;
      }
    } catch (e) {}
    return '';
  }

  /* ------------------------------------------------------------- the submission slot */
  //
  // One record per tool. Two tools open in one tab are two logical submissions and must not share
  // a token; two attempts at one tool are one submission and must.
  //
  //   { t: <active token or ''>, d: <retired token or ''>, s: 'idle' | 'active' | 'conflict' }
  //
  // `d` is the tombstone, and it is why (H) holds rather than merely being unlikely: a token is
  // only ever re-offered when it is BOTH present and not the retired one.

  function slotKey(slot) { return SLOT_PREFIX + String(slot || 'lead'); }

  function emptyRecord() { return { t: '', d: '', s: 'idle' }; }

  function readSlot(slot) {
    var raw = '';
    // sessionStorage is authoritative whenever it is readable. The in-memory copy is consulted
    // only when it is not, so a bfcache restore that keeps this closure alive cannot present a
    // stale ACTIVE record over a retirement the storage already recorded.
    try { raw = window.sessionStorage.getItem(slotKey(slot)) || ''; }
    catch (e) { raw = memory[slotKey(slot)] || ''; }
    if (!raw) { return emptyRecord(); }
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== 'object') { return emptyRecord(); }
      return {
        t: String(o.t || ''),
        d: String(o.d || ''),
        s: (o.s === 'active' || o.s === 'conflict') ? o.s : 'idle'
      };
    } catch (e) { return emptyRecord(); }
  }

  function writeSlot(slot, record) {
    var raw = JSON.stringify(record);
    memory[slotKey(slot)] = raw;
    try { window.sessionStorage.setItem(slotKey(slot), raw); } catch (e) {}
  }

  // Retire the active token. Used by (F) an authoritative settlement and (G) an explicit new
  // request. The token moves to the tombstone rather than being deleted, so it can never be
  // handed out again by this slot.
  function retire(slot) {
    var rec = readSlot(slot);
    writeSlot(slot, { t: '', d: rec.t || rec.d || '', s: 'idle' });
  }

  // (G) — the ONLY exit from CONFLICT, and the only thing that lets a slot mint again after a
  // settlement. It is deliberately a separate, explicit call: nothing in the failure paths
  // reaches it, so no identity is ever rotated without a user action.
  function beginNewSubmission(slot) { retire(slot); }

  function slotState(slot) { return readSlot(slot).s; }

  // The idempotency token for THIS logical submission. Mints on first use, reuses on every retry
  // and every reload until the submission terminates.
  function submissionToken(slot) {
    var rec = readSlot(slot);
    if (rec.t && rec.t !== rec.d) { return rec.t; }
    var token = newRequestId();
    if (!token) { return ''; }
    writeSlot(slot, { t: token, d: rec.d, s: 'active' });
    return token;
  }

  /* ---------------------------------------------------------------------- transport */

  function transportError(code, detail) {
    var err = new Error(code);
    err.fmCode = code;
    if (detail !== undefined) err.fmDetail = detail;
    return err;
  }

  function parseJson(text) {
    try {
      var body = JSON.parse(text);
      return (body && typeof body === 'object') ? body : null;
    } catch (e) { return null; }
  }

  // The business contract, stated once. Transport success is not business success.
  function isSettled(body) {
    return !!body && body.ok === true && typeof body.lead_id === 'string' && body.lead_id.trim() !== '';
  }

  /*
   * Resolves with { ok:true, body, requestId, leadId, mode } only on an authoritative settlement.
   * Rejects with err.fmCode set to one of:
   *   webhook_not_configured | identity_unavailable | identity_conflict_pending
   *   timeout | network
   *   http_<status>        the server refused; err.fmStatus and err.fmErrorCode carry the detail
   *   invalid_response     2xx without a parseable JSON body
   *   rejected             2xx JSON but not an authoritative settlement
   */
  function postLead(url, payload, options) {
    options = options || {};
    if (!url) return Promise.reject(transportError('webhook_not_configured'));

    payload = (payload && typeof payload === 'object') ? payload : {};
    payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};

    var slot = options.slot || payload.tool || 'lead';

    // (E) — a conflicted slot is terminal. Refused HERE, before the network call, so a caller
    // that re-arms its button cannot turn a conflict into an automatic retry.
    if (slotState(slot) === 'conflict') {
      return Promise.reject(transportError('identity_conflict_pending'));
    }

    // An id already on the payload, or passed explicitly, still wins: a caller that owns its own
    // identity keeps it. Everything else goes through the slot.
    var requestId = String(payload.meta.request_id || options.requestId || '');
    var owned = false;
    if (!requestId) { requestId = submissionToken(slot); owned = true; }
    if (!requestId) return Promise.reject(transportError('identity_unavailable'));
    payload.meta.request_id = requestId;

    var timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = window.AbortController ? new window.AbortController() : null;
    var timedOut = false;
    var timer = controller ? window.setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, timeoutMs) : null;

    function clear() { if (timer) window.clearTimeout(timer); }

    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-FINMENTOR-Request-Id': requestId
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clear();
      return res.text().then(function (text) {
        var body = parseJson(text);

        if (!res.ok) {
          var err = transportError('http_' + res.status, res.status);
          err.fmStatus = res.status;
          err.fmBody = body;
          err.fmErrorCode = (body && typeof body.error_code === 'string') ? body.error_code : '';
          // (E) — the terminal identity refusal. The token is RETAINED and the slot is sealed:
          // this submission cannot be sent again under this identity, and no new identity is
          // minted until the caller asks for one explicitly.
          if (res.status === 409 && err.fmErrorCode === 'IDEMPOTENCY_CONFLICT' && owned) {
            var rec = readSlot(slot);
            writeSlot(slot, { t: rec.t, d: rec.d, s: 'conflict' });
          }
          throw err;
        }

        if (!body) throw transportError('invalid_response');
        // Not a durable commit. The token is retained: (R) a 2xx that is not a settlement — an
        // edge error page, a proxy, a business refusal — must never retire an identity.
        if (!isSettled(body)) throw transportError('rejected', body);

        // (F) — authoritative settlement. Retiring here, and only here, is what makes the next
        // genuine submission from this tab a new request rather than a replay of this one.
        if (owned) { retire(slot); }
        return { ok: true, body: body, requestId: requestId, leadId: String(body.lead_id), mode: String(body.mode || '') };
      });
    }, function (err) {
      clear();
      if (timedOut || (err && err.name === 'AbortError')) throw transportError('timeout');
      throw transportError('network');
    });
  }

  /* ------------------------------------------------------------------ caller helpers */

  // Is this rejection the terminal identity conflict? Used by the submitters so the conflict copy
  // is decided in one place rather than by four different status-code tests.
  function isIdentityConflict(err) {
    if (!err) return false;
    if (err.fmCode === 'identity_conflict_pending') return true;
    return err.fmStatus === 409 && err.fmErrorCode === 'IDEMPOTENCY_CONFLICT';
  }

  // (G) rendered once, here, so all four submitters get the same control rather than four
  // near-identical fragments. Deliberately plain: this pass does not redesign the public UX.
  function newRequestControl(container, slot, label, onReset) {
    if (!container || !container.appendChild) return null;
    var existing = container.querySelector && container.querySelector('[data-fm-new-request]');
    if (existing) return existing;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-fm-new-request', '1');
    btn.className = 'fm-new-request';
    btn.textContent = label || 'Начать новую заявку';
    btn.style.cssText = 'display:inline-block;margin-top:10px;padding:8px 14px;font:inherit;'
      + 'cursor:pointer;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit';
    btn.addEventListener('click', function () {
      beginNewSubmission(slot);
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      if (typeof onReset === 'function') onReset();
    });
    container.appendChild(btn);
    return btn;
  }

  // thank-you.html?tool=<tool>&sid=<requestId>
  // sid lets GA4 dedupe on the actual submission rather than on the tool name, so a second
  // legitimate lead from the same tool in the same tab is still counted.
  function thankYouUrl(tool, requestId, base) {
    var url = (base || 'thank-you.html') + '?tool=' + encodeURIComponent(tool || '');
    if (requestId) url += '&sid=' + encodeURIComponent(requestId);
    return url;
  }

  window.FMLeadTransport = {
    postLead: postLead,
    newRequestId: newRequestId,
    thankYouUrl: thankYouUrl,
    isIdentityConflict: isIdentityConflict,
    newRequestControl: newRequestControl,
    beginNewSubmission: beginNewSubmission,
    // Exposed so the regression suite can drive the lifecycle directly, and so a caller that
    // needs the token before the POST (a multi-step submit) can ask for it.
    submissionToken: submissionToken,
    slotState: slotState
  };
})();
