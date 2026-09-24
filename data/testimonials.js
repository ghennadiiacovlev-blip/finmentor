/* ============================================================================
   FINMENTOR — data/testimonials.js
   The ONE source for the «Client voices» module (index.html, ro/index.html).
   RU and RO pages read this same file; nothing is copied into HTML by hand.

   ENTRY SHAPE
     id               'cv-2026-001'            stable, unique
     language         'ru' | 'ro'              the page edition this text is approved for
     quote            string                   the client's words, 2–4 lines, no numbers
     person_display   string                   what the client approved for display, may be ''
     role             string                   'Собственник', 'Финансовый директор', …
     industry         string                   business type, may be ''
     company_display  string                   '' unless company_permission === true
     company_permission  boolean               explicit written permission to name the company
     anonymous        boolean                  true when publication is approved without identity
     date             'YYYY' | 'YYYY-MM'
     source           string                   where the words come from (e-mail, session, letter)
     consent_status   'approved' | 'approved_anonymous' | 'pending' | 'declined'
     is_published     boolean
     featured         boolean                  at most one per language carries the main weight

   PUBLICATION RULE — enforced by client-voices.js and qa/client-voices.test.mjs:
     an entry is rendered ONLY when
       is_published === true  AND  consent_status is approved for the entry's identity level
       AND language === page language.
     company_display is rendered ONLY when company_permission === true.
     Attribution falls back to the role, then to «Анонимно · Собственник бизнеса».
     With no eligible entry the section stays hidden — the site never shows placeholder praise.

   STATUS 2026-09-24: one real anonymous testimonial is approved and published
   as a RU/RO locale pair. Do not add mock, draft or unapproved text here; the design preview uses
   qa/fixtures/client-voices.mock.mjs, which is never served by the site.

   FINMENTOR — proprietary website content and implementation.
   © 2026 FINMENTOR / Ghennadi Iacovlev. All rights reserved.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) { module.exports = api; }
  if (root) { root.FM_TESTIMONIALS = api; }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  return {
    version: 2,
    entries: [
      {
        id: 'cv-2026-001-ru',
        language: 'ru',
        quote: 'Раньше мы смотрели в основном на выручку и остаток на счёте. Когда собрали финансовую картину целиком, стало понятнее, где клуб действительно зарабатывает, а где деньги просто остаются занятыми.',
        person_display: 'Собственник бизнеса',
        role: '',
        industry: 'фитнес-клуб',
        company_display: '',
        company_permission: false,
        anonymous: true,
        date: '2026',
        source: 'owner-confirmed client feedback',
        consent_status: 'approved_anonymous',
        is_published: true,
        featured: true
      },
      {
        id: 'cv-2026-001-ro',
        language: 'ro',
        quote: 'Înainte ne uitam în principal la venituri și la soldul din cont. După ce am pus imaginea financiară cap la cap, a devenit mai clar unde clubul câștigă cu adevărat și unde banii rămân doar blocați.',
        person_display: 'Proprietar de afacere',
        role: '',
        industry: 'club de fitness',
        company_display: '',
        company_permission: false,
        anonymous: true,
        date: '2026',
        source: 'owner-confirmed client feedback',
        consent_status: 'approved_anonymous',
        is_published: true,
        featured: true
      }
    ]
  };
});
