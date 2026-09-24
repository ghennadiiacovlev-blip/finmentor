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
     date             'YYYY' | 'YYYY-MM'
     source           string                   where the words come from (e-mail, session, letter)
     consent_status   'approved' | 'pending' | 'declined'
     is_published     boolean
     featured         boolean                  at most one per language carries the main weight

   PUBLICATION RULE — enforced by client-voices.js and qa/client-voices.test.mjs:
     an entry is rendered ONLY when
       is_published === true  AND  consent_status === 'approved'  AND  language === page language.
     company_display is rendered ONLY when company_permission === true.
     Attribution falls back to the role, then to «Анонимно · Собственник бизнеса».
     With no eligible entry the section stays hidden — the site never shows placeholder praise.

   STATUS 2026-09-24: no approved client testimonial exists yet → entries is EMPTY.
   Do not add mock, draft or unapproved text here; the design preview uses
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
    version: 1,
    entries: []
  };
});
