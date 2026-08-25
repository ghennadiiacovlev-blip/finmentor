from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly 1 match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


analytics_marker = "  function initConsentUi() {\n"
analytics_insert = """  function getAttributionContext(timeoutMs) {
    return new Promise(function (resolve) {
      var out = { analytics_consent: getChoice() === 'accept' };
      if (!out.analytics_consent || !configured || typeof window.gtag !== 'function' || window.gtag === noopGtag) {
        resolve(out);
        return;
      }

      var finished = false;
      var pending = 2;
      var waitMs = (typeof timeoutMs === 'number' && timeoutMs >= 0) ? timeoutMs : 1800;
      var timer = window.setTimeout(finish, waitMs);

      function finish() {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        resolve(out);
      }

      function capture(key, value) {
        if (finished) return;
        var clean = String(value === undefined || value === null ? '' : value).trim().slice(0, 120);
        if (clean) out[key] = clean;
        pending -= 1;
        if (pending <= 0) finish();
      }

      try {
        window.gtag('get', GA4_ID, 'client_id', function (value) { capture('ga_client_id', value); });
        window.gtag('get', GA4_ID, 'session_id', function (value) { capture('ga_session_id', value); });
      } catch (e) {
        finish();
      }
    });
  }

  function enrichLeadPayload(payload, timeoutMs) {
    payload = (payload && typeof payload === 'object') ? payload : {};
    payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};

    return getAttributionContext(timeoutMs).then(function (context) {
      payload.meta.analytics_consent = !!context.analytics_consent;
      delete payload.meta.ga_client_id;
      delete payload.meta.ga_session_id;
      if (context.ga_client_id) payload.meta.ga_client_id = context.ga_client_id;
      if (context.ga_session_id) payload.meta.ga_session_id = context.ga_session_id;
      return payload;
    }, function () {
      payload.meta.analytics_consent = getChoice() === 'accept';
      delete payload.meta.ga_client_id;
      delete payload.meta.ga_session_id;
      return payload;
    });
  }

"""
replace_once('analytics.js', analytics_marker, analytics_insert + analytics_marker)

replace_once(
    'analytics.js',
    "    getConsent: getChoice,\n    isLoaded: function () { return loaded; }\n",
    "    getConsent: getChoice,\n    getAttributionContext: getAttributionContext,\n    enrichLeadPayload: enrichLeadPayload,\n    isLoaded: function () { return loaded; }\n",
)

main_old = """      if (submit) submit.disabled = true;
      postLeadPayload(payload).then(function () {
        thankYou('contact');
      }).catch(function () {
"""
main_new = """      if (submit) submit.disabled = true;
      var enrichPromise = Promise.resolve(payload);
      if (window.FMAnalytics && typeof window.FMAnalytics.enrichLeadPayload === 'function') {
        try { enrichPromise = window.FMAnalytics.enrichLeadPayload(payload, 1800); } catch (e) {}
      } else {
        payload.meta.analytics_consent = false;
      }
      enrichPromise.catch(function () { return payload; }).then(function (enrichedPayload) {
        payload = enrichedPayload || payload;
        return postLeadPayload(payload);
      }).then(function () {
        thankYou('contact');
      }).catch(function () {
"""
replace_once('main.js', main_old, main_new)

q_old = """    setSubmitting(true);
    postQuestionnairePayload(payload)
      .then(function () {
"""
q_new = """    setSubmitting(true);
    var enrichPromise = Promise.resolve(payload);
    if (window.FMAnalytics && typeof window.FMAnalytics.enrichLeadPayload === 'function') {
      try { enrichPromise = window.FMAnalytics.enrichLeadPayload(payload, 1800); } catch (e) {}
    } else {
      payload.meta = payload.meta || {};
      payload.meta.analytics_consent = false;
    }
    enrichPromise.catch(function () { return payload; }).then(function (enrichedPayload) {
      payload = enrichedPayload || payload;
      return postQuestionnairePayload(payload);
    })
      .then(function () {
"""
replace_once('questionnaire.html', q_old, q_new)
replace_once('ro/questionnaire.html', q_old, q_new)
