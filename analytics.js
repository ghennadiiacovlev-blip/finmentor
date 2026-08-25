(function () {
  'use strict';

  var GA4_ID = window.FM_GA4_ID || 'G-94L9B8WZ12';
  var CONSENT_KEY = 'finmentor_cookie_consent';
  var loaded = false;
  var configured = false;
  var bannerMounted = false;

  function getChoice() {
    try { return localStorage.getItem(CONSENT_KEY) || ''; } catch (e) { return ''; }
  }

  function setChoice(choice) {
    try { localStorage.setItem(CONSENT_KEY, choice); } catch (e) {}
  }

  function isRomanian() {
    return (document.documentElement.lang || '').toLowerCase().indexOf('ro') === 0 || /(^|\/)ro\//.test(location.pathname);
  }

  // Before consent we intentionally discard analytics events instead of queuing
  // them for later transmission. Google code itself is not loaded until consent.
  function noopGtag() {}
  if (typeof window.gtag !== 'function') window.gtag = noopGtag;

  function realGtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
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

  window.FMAnalytics = {
    measurementId: GA4_ID,
    load: loadAnalytics,
    initConsentUi: initConsentUi,
    consent: function (choice) {
      choose(choice, document.querySelector('.fm-cookie[data-fm-analytics-consent="1"]'));
    },
    getConsent: getChoice,
    isLoaded: function () { return loaded; }
  };

  if (getChoice() === 'accept') loadAnalytics();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConsentUi, { once: true });
  } else {
    initConsentUi();
  }
})();
