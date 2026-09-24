/* ============================================================================
   FINMENTOR — client-voices.js
   Renders the curated «Client voices» module from data/testimonials.js into the
   hidden skeleton <section id="client-voices" data-client-voices hidden> and
   unhides it ONLY when at least one entry passes the publication rule:

     is_published === true && consent_status === 'approved' && language === page

   Composition: one featured quote (the main weight) + up to two quieter ruled
   quotes. Everything is written with textContent — no HTML from data ever
   reaches the DOM. No carousel, no autoplay, no counters; motion is the site's
   own .reveal pass (main.js runs after this file), which honours reduced motion.

   Runs before main.js. Exposed for QA as window.FMClientVoices / module.exports.
   FINMENTOR — proprietary website content and implementation.
   © 2026 FINMENTOR / Ghennadi Iacovlev. All rights reserved.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) { module.exports = api; }
  if (root) {
    root.FMClientVoices = api;
    if (root.document) {
      var run = function () { try { api.render(root.document, root.FM_TESTIMONIALS); } catch (e) { /* skeleton stays hidden */ } };
      if (root.document.readyState === 'loading') { root.document.addEventListener('DOMContentLoaded', run); }
      else { run(); }
    }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var MAX_SECONDARY = 2;
  var ANON = { ru: 'Анонимно · Собственник бизнеса', ro: 'Anonim · Proprietar de afacere' };

  function eligible(entry, lang) {
    return !!entry && entry.is_published === true && entry.consent_status === 'approved'
      && entry.language === lang && typeof entry.quote === 'string' && entry.quote.trim() !== '';
  }

  /* The entries to show for a page language: featured first (at most one), then
     the others in file order, capped at 1 + MAX_SECONDARY. */
  function selectVoices(data, lang) {
    var entries = (data && Array.isArray(data.entries)) ? data.entries : [];
    var list = [];
    for (var i = 0; i < entries.length; i++) { if (eligible(entries[i], lang)) { list.push(entries[i]); } }
    if (!list.length) { return []; }
    var featured = null;
    for (var j = 0; j < list.length; j++) { if (list[j].featured === true) { featured = list[j]; break; } }
    if (!featured) { featured = list[0]; }
    var rest = [];
    for (var k = 0; k < list.length && rest.length < MAX_SECONDARY; k++) { if (list[k] !== featured) { rest.push(list[k]); } }
    return [featured].concat(rest);
  }

  /* Two attribution lines, built only from what the client approved. */
  function attribution(entry, lang) {
    var who = (entry.person_display || '').trim();
    var meta = [];
    if (who) { if (entry.role) { meta.push(entry.role); } }
    else { who = (entry.role || '').trim() || ANON[lang] || ANON.ru; }
    if (entry.industry) { meta.push(entry.industry); }
    if (entry.company_permission === true && entry.company_display) { meta.push(entry.company_display); }
    if (entry.date) { meta.push(String(entry.date).slice(0, 4)); }
    return { who: who, meta: meta.join(' · ') };
  }

  function el(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function figure(doc, entry, lang, delay) {
    var fig = el(doc, 'figure', 'client-voices__voice reveal');
    if (delay) { fig.setAttribute('data-reveal-delay', String(delay)); }
    var bq = el(doc, 'blockquote', 'client-voices__quote');
    bq.appendChild(el(doc, 'p', null, entry.quote.trim()));
    fig.appendChild(bq);
    var attr = attribution(entry, lang);
    var cap = el(doc, 'figcaption', 'client-voices__attr');
    cap.appendChild(el(doc, 'span', 'client-voices__who', attr.who));
    if (attr.meta) { cap.appendChild(el(doc, 'span', 'client-voices__meta', attr.meta)); }
    fig.appendChild(cap);
    return fig;
  }

  /* Returns the number of voices rendered (0 leaves the section hidden). */
  function render(doc, data) {
    if (!doc || typeof doc.querySelector !== 'function') { return 0; }
    var section = doc.querySelector('[data-client-voices]');
    if (!section) { return 0; }
    var lang = (section.getAttribute('data-lang') || 'ru').toLowerCase();
    var voices = selectVoices(data, lang);
    var list = section.querySelector('[data-client-voices-list]');
    if (!voices.length || !list) { section.setAttribute('hidden', ''); return 0; }

    while (list.firstChild) { list.removeChild(list.firstChild); }
    var featured = figure(doc, voices[0], lang, 1);
    featured.className = 'client-voices__voice client-voices__featured reveal';
    list.appendChild(featured);
    if (voices.length > 1) {
      var aside = el(doc, 'div', 'client-voices__aside');
      for (var i = 1; i < voices.length; i++) { aside.appendChild(figure(doc, voices[i], lang, 1 + i)); }
      list.appendChild(aside);
    }
    /* Design-preview data (never the production file) announces itself. */
    var head = section.querySelector('[data-client-voices-head]');
    if (head && data && data.preview === true) { head.appendChild(el(doc, 'span', 'client-voices__mock', 'DESIGN MOCK · NOT PUBLIC')); }
    section.removeAttribute('hidden');
    return voices.length;
  }

  return { selectVoices: selectVoices, attribution: attribution, render: render, MAX_SECONDARY: MAX_SECONDARY };
});
