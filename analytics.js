(function () {
  'use strict';

  var GA4_ID = window.FM_GA4_ID || 'G-94L98WZ12';
  var CONSENT_KEY = 'finmentor_cookie_consent';
  var loaded = false;
  var configured = false;
  var bannerMounted = false;
  var businessTrackingMounted = false;

  function getChoice() {
    try { return localStorage.getItem(CONSENT_KEY) || ''; } catch (e) { return ''; }
  }

  function setChoice(choice) {
    try { localStorage.setItem(CONSENT_KEY, choice); } catch (e) {}
  }

  function isRomanian() {
    return (document.documentElement.lang || '').toLowerCase().indexOf('ro') === 0 || /(^|\/)ro\//.test(location.pathname);
  }

  function pageSlug() {
    var path = (location.pathname || '/').replace(/\/+$/, '');
    if (!path || path === '' || path === '/index.html' || path === '/ro' || path === '/ro/index.html') return 'index';
    var name = path.split('/').pop() || 'index';
    return name.replace(/\.html$/i, '').replace(/[^a-z0-9_-]+/ig, '-').slice(0, 80) || 'index';
  }

  function safeBusinessParams(params) {
    var allow = {
      source: true,
      page_slug: true,
      site_language: true,
      form_name: true,
      lead_type: true,
      contact_method: true,
      file_extension: true,
      file_name: true
    };
    var out = {};
    Object.keys(params || {}).forEach(function (key) {
      if (!allow[key]) return;
      var value = params[key];
      if (value === undefined || value === null) return;
      out[key] = String(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[email]')
        .replace(/\+?\d[\d\s().-]{6,}\d/g, '[phone]')
        .slice(0, 100);
    });
    return out;
  }

  // Before consent we intentionally discard analytics events instead of queuing
  // them for later transmission. Google code itself is not loaded until consent.
  function noopGtag() {}
  if (typeof window.gtag !== 'function') window.gtag = noopGtag;

  function realGtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  function trackBusiness(name, params) {
    if (getChoice() !== 'accept' || !loaded || !configured || typeof window.gtag !== 'function') return false;
    try {
      window.gtag('event', name, safeBusinessParams(params || {}));
      return true;
    } catch (e) {
      return false;
    }
  }

  function sameOriginReferrer() {
    if (!document.referrer) return false;
    try {
      var ref = new URL(document.referrer);
      return ref.origin === location.origin && !/\/thank-you\.html$/i.test(ref.pathname || '');
    } catch (e) {
      return false;
    }
  }

  function emitConfirmedLead() {
    if (!/\/thank-you\.html$/i.test(location.pathname || '')) return;

    var tool = '';
    try { tool = (new URLSearchParams(location.search || '')).get('tool') || ''; } catch (e) {}
    if (tool !== 'contact' && tool !== 'xray_extended') return;
    if (!sameOriginReferrer()) return;

    var dedupeKey = 'finmentor_ga4_generate_lead:' + tool;
    try {
      if (sessionStorage.getItem(dedupeKey) === '1') return;
      sessionStorage.setItem(dedupeKey, '1');
    } catch (e) {}

    trackBusiness('generate_lead', {
      source: 'website',
      page_slug: 'thank-you',
      site_language: document.documentElement.lang || '',
      form_name: tool === 'xray_extended' ? 'financial_xray' : 'consultation',
      lead_type: tool === 'xray_extended' ? 'financial_xray' : 'consultation'
    });
  }

  function contactMethod(href) {
    href = String(href || '');
    if (/^mailto:/i.test(href)) return 'email';
    if (/^tel:/i.test(href)) return 'phone';
    if (/(^|\/\/)(t\.me|telegram\.me)\//i.test(href)) return 'telegram';
    if (/(^|\/\/)(wa\.me|api\.whatsapp\.com|www\.whatsapp\.com)\//i.test(href)) return 'whatsapp';
    return '';
  }

  function downloadMeta(anchor, href) {
    var raw = String(href || '').split('#')[0].split('?')[0];
    var match = raw.match(/\.([a-z0-9]{2,8})$/i);
    var ext = match ? match[1].toLowerCase() : '';
    var allowed = /^(pdf|csv|xls|xlsx|doc|docx|ppt|pptx|zip)$/;
    if (!anchor.hasAttribute('download') && !allowed.test(ext)) return null;
    var name = raw.split('/').pop() || anchor.getAttribute('download') || '';
    return {
      file_extension: ext || 'download',
      file_name: decodeURIComponent(name || '').slice(0, 100)
    };
  }

  function formNameForTarget(target) {
    if (!target || !target.closest) return '';
    if (target.closest('#consultForm')) return 'consultation';
    if (target.closest('#qFormV86') || target.closest('#qForm')) return 'financial_xray';
    return '';
  }

  function markFormStart(formName) {
    if (!formName) return;
    var key = 'finmentor_ga4_form_start:' + formName + ':' + (location.pathname || '/');
    try {
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
    } catch (e) {}
    trackBusiness('lead_form_start', {
      source: 'website',
      page_slug: pageSlug(),
      site_language: document.documentElement.lang || '',
      form_name: formName
    });
  }

  function initBusinessTracking() {
    if (businessTrackingMounted) return;
    businessTrackingMounted = true;

    document.addEventListener('focusin', function (e) {
      markFormStart(formNameForTarget(e.target));
    }, true);

    document.addEventListener('click', function (e) {
      var anchor = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!anchor) return;

      var href = anchor.getAttribute('href') || '';
      var method = contactMethod(href);
      if (method) {
        trackBusiness('contact_click', {
          source: 'website',
          page_slug: pageSlug(),
          site_language: document.documentElement.lang || '',
          contact_method: method
        });
      }

      var file = downloadMeta(anchor, href);
      if (file) {
        trackBusiness('resource_download', {
          source: 'website',
          page_slug: pageSlug(),
          site_language: document.documentElement.lang || '',
          file_extension: file.file_extension,
          file_name: file.file_name
        });
      }
    }, true);
  }

  function configure() {
    if (configured) return;
    configured = true;

    window.gtag('js', new Date());
    window.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });

    var debug = false;
    try { debug = new URLSearchParams(location.search).get('debug_ga4') === '1'; } catch (e) {}

    // Disable the automatic page_view and send exactly one explicit page_view.
    // This makes dynamically-loaded GA deterministic and avoids duplicates.
    window.gtag('config', GA4_ID, {
      send_page_view: false,
      debug_mode: debug,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });

    window.gtag('event', 'page_view', {
      page_location: location.href,
      page_title: document.title,
      page_path: location.pathname + location.search,
      language: document.documentElement.lang || '',
      debug_mode: debug
    });

    emitConfirmedLead();

    if (debug) {
      window.gtag('event', 'ga4_debug_ping', {
        debug_mode: true,
        page_slug: location.pathname || '/',
        source: 'finmentor_debug_test'
      });
    }
  }

  function loadAnalytics() {
    if (loaded) return;
    loaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = realGtag;

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    script.setAttribute('data-finmentor-ga4', GA4_ID);
    script.onerror = function () {
      loaded = false;
      try { console.warn('FINMENTOR GA4: gtag.js failed to load'); } catch (e) {}
    };
    document.head.appendChild(script);

    // gtag commands are queued in dataLayer and processed when gtag.js is ready.
    configure();
  }

  function closeBanner(banner) {
    if (!banner) return;
    banner.classList.add('is-hiding');
    window.setTimeout(function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 220);
  }

  function choose(choice, banner) {
    if (choice !== 'accept') choice = 'deny';
    setChoice(choice);

    if (choice === 'accept') {
      loadAnalytics();
    } else {
      // No Google Analytics script is loaded for denied consent.
      window.gtag = noopGtag;
    }

    closeBanner(banner);
  }

  function getAttributionContext(timeoutMs) {
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

  function initConsentUi() {
    if (bannerMounted) return;

    var existing = document.querySelector('.fm-cookie[data-fm-analytics-consent="1"]');
    if (existing) { bannerMounted = true; return; }

    var choice = getChoice();
    if (choice === 'accept') { loadAnalytics(); return; }
    if (choice === 'deny') return;
    if (!document.body) return;

    var ro = isRomanian();
    var banner = document.createElement('div');
    banner.className = 'fm-cookie';
    banner.setAttribute('data-fm-analytics-consent', '1');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', ro ? 'Setările cookies FINMENTOR' : 'Настройки cookies FINMENTOR');
    banner.innerHTML =
      '<div class="fm-cookie__text"><strong>' + (ro ? 'Cookies și analitică' : 'Cookies и аналитика') + '</strong><span>' +
      (ro ? 'FINMENTOR folosește cookies tehnice și Google Analytics numai cu acordul dvs. Datele personale nu se trimit în GA4.' : 'FINMENTOR использует технические cookies и Google Analytics только с вашего согласия. Персональные данные в GA4 не отправляются.') +
      '</span></div>' +
      '<div class="fm-cookie__actions">' +
      '<button type="button" class="btn btn--ghost btn--sm" data-cookie-choice="deny">' + (ro ? 'Doar cele necesare' : 'Только необходимые') + '</button>' +
      '<button type="button" class="btn btn--primary btn--sm" data-cookie-choice="accept">' + (ro ? 'Accept' : 'Принять') + '</button>' +
      '</div>';

    banner.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-cookie-choice]') : null;
      if (!btn) return;
      choose(btn.getAttribute('data-cookie-choice') || 'deny', banner);
    });

    document.body.appendChild(banner);
    bannerMounted = true;
  }

  initBusinessTracking();

  window.FMAnalytics = {
    measurementId: GA4_ID,
    load: loadAnalytics,
    track: trackBusiness,
    initConsentUi: initConsentUi,
    consent: function (choice) {
      choose(choice, document.querySelector('.fm-cookie[data-fm-analytics-consent="1"]'));
    },
    getConsent: getChoice,
    getAttributionContext: getAttributionContext,
    enrichLeadPayload: enrichLeadPayload,
    isLoaded: function () { return loaded; }
  };

  if (getChoice() === 'accept') loadAnalytics();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConsentUi, { once: true });
  } else {
    initConsentUi();
  }
})();
