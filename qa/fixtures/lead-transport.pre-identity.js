/*
 * FROZEN FIXTURE — the PRE-IDENTITY lead transport, exactly as deployed from 2026-08-25 to
 * 2026-08-31. Not loaded by any page and never will be.
 *
 * It exists so qa/lead-intake-request-identity.test.mjs case B-0 keeps proving the defect the
 * identity lifecycle was built for: ONE IDENTITY PER ATTEMPT, not per submission. Read against
 * the live lead-transport.js instead, that case would turn green the moment the fix deployed,
 * and the record of WHY the lifecycle exists would be gone with it.
 *
 * Do not edit. Do not include. Do not "fix".
 */
/*
 * FINMENTOR — lead submission transport.
 *
 * Every submitter previously treated any HTTP 2xx as success and never read the response
 * body. Lead Intake answers 200 with {ok:true} only after the canonical Pipeline commit,
 * but it can also answer 2xx in shapes that are not a durable commit, and a proxy or edge
 * error page can return 2xx as well. Redirecting to thank-you on status alone therefore
 * risks telling a client we captured a lead that we did not.
 *
 * Success here means all three of: HTTP 2xx, a JSON body, and body.ok === true.
 *
 * The transport also owns the request identity. One id is generated per submission attempt
 * and travels in payload.meta.request_id, which gives the server a stable idempotency key
 * and gives GA4 a per-submission conversion dedup key instead of a per-tool one.
 */
(function () {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 12000;

  function newRequestId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'fmr_' + window.crypto.randomUUID();
      }
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
        var hex = '';
        for (var i = 0; i < buf.length; i++) hex += ('0' + buf[i].toString(16)).slice(-2);
        return 'fmr_' + hex;
      }
    } catch (e) {}
    return 'fmr_' + Date.now().toString(16) + '_' + Math.random().toString(16).slice(2, 10);
  }

  function transportError(code, detail) {
    var err = new Error(code);
    err.fmCode = code;
    if (detail !== undefined) err.fmDetail = detail;
    return err;
  }

  /*
   * Resolves with { ok:true, body, requestId } only on a confirmed durable commit.
   * Rejects with err.fmCode set to one of:
   *   webhook_not_configured | timeout | network
   *   http_<status>        transport reached the server but it refused
   *   invalid_response     2xx without a parseable JSON body
   *   rejected             2xx JSON but ok !== true
   */
  function postLead(url, payload, options) {
    options = options || {};
    if (!url) return Promise.reject(transportError('webhook_not_configured'));

    payload = (payload && typeof payload === 'object') ? payload : {};
    payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};

    // Reuse an id already attached to this payload so a user retry after a network
    // failure is recognised by the server as the same submission, not a new lead.
    var requestId = String(payload.meta.request_id || options.requestId || '') || newRequestId();
    payload.meta.request_id = requestId;

    var timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    var controller = window.AbortController ? new AbortController() : null;
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
      if (!res.ok) throw transportError('http_' + res.status, res.status);
      return res.text().then(function (text) {
        var body;
        try {
          body = JSON.parse(text);
        } catch (e) {
          throw transportError('invalid_response');
        }
        if (!body || typeof body !== 'object') throw transportError('invalid_response');
        // The canonical success contract. Anything else is not a durable commit.
        if (body.ok !== true) throw transportError('rejected', body);
        return { ok: true, body: body, requestId: requestId };
      });
    }, function (err) {
      clear();
      if (timedOut || (err && err.name === 'AbortError')) throw transportError('timeout');
      throw transportError('network');
    });
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
    thankYouUrl: thankYouUrl
  };
})();
