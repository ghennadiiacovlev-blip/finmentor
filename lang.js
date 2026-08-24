/* ============================================================================
   FINMENTOR — lang.js
   Multilingual layer (RU / RO).
   - Root entry gate: first visitor chooses the language before the intro.
   - Preference: localStorage `finmentor_language` (= 'ru' | 'ro').
   - Header / drawer switcher: updates the preference, opens the equivalent page.
   - GA4: language_selector_view, language_selected, language_switched.
   Deep links are always respected: only the root homepage ever gates or
   redirects; inner pages simply record switch clicks.
   ========================================================================== */
/*
  FINMENTOR — proprietary website content and implementation.
  © 2026 FINMENTOR / Ghennadi Iacovlev. All rights reserved.
  Unauthorized copying, redistribution or commercial reuse is prohibited.
  Contact: cfo@finmentor.md
*/

(function () {
  'use strict';

  var KEY = 'finmentor_language';

  function getLang() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function setLang(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }
  function ga(name, params) {
    if (typeof gtag === 'function') { try { gtag('event', name, params || {}); } catch (e) {} }
  }
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  var prefersReduced = false;
  try { prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ------------------------------------------------- ENTRY GATE (root only) */
  function initGate() {
    var gate = document.getElementById('langGate');
    if (!gate) return;
    if (!document.documentElement.classList.contains('lang-gate-pending')) return;

    ga('language_selector_view', { language: 'none' });

    var leaving = false;
    function choose(lang, ev) {
      if (leaving) return;
      leaving = true;
      if (ev && ev.preventDefault) ev.preventDefault();
      setLang(lang);
      ga('language_selected', { language: lang });

      gate.classList.add('is-leaving');
      var delay = prefersReduced ? 0 : 420;

      if (lang === 'ro') {
        // Keep the dark brand background; the Romanian homepage plays the intro.
        window.setTimeout(function () {
          window.location.href = 'ro/' + (window.location.search || '') + (window.location.hash || '');
        }, delay);
        return;
      }

      // Russian: reveal the intro (it was held unrendered) and start it.
      window.setTimeout(function () {
        document.documentElement.classList.remove('lang-gate-pending');
        if (typeof window.__fmStartIntro === 'function') {
          try { window.__fmStartIntro(); } catch (e) {}
        }
        window.setTimeout(function () {
          if (gate.parentNode) gate.parentNode.removeChild(gate);
        }, 650);
      }, delay);
    }

    Array.prototype.forEach.call(gate.querySelectorAll('[data-lang-choice]'), function (btn) {
      btn.addEventListener('click', function (ev) {
        choose(btn.getAttribute('data-lang-choice') === 'ro' ? 'ro' : 'ru', ev);
      });
    });
  }

  /* -------------------------------------------------- SWITCHER (all pages) */
  function initSwitch() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('[data-lang-switch]') : null;
      if (!a) return;
      var lang = a.getAttribute('data-lang-switch') === 'ro' ? 'ro' : 'ru';
      if (lang !== getLang()) {
        setLang(lang);
        ga('language_switched', { language: lang });
      }
      // navigation proceeds via the link's href (equivalent page)
    }, true);
  }

  ready(function () {
    try { initGate(); } catch (e) { if (window.console) console.warn('[finmentor lang]', e); }
    try { initSwitch(); } catch (e) { if (window.console) console.warn('[finmentor lang]', e); }
  });
})();
