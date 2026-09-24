/* ============================================================================
   FINMENTOR — experience.js
   The ONE source of truth for the professional-experience counter.

   Business rule (owner-approved): the finance career started in AUGUST 2008.
   Every public «N+ лет / N+ ani» value derives from that date and from the
   calendar rule below. No page carries its own number: the static fallback in
   the HTML is generated / verified from this file (scripts/sync-experience-
   fallback.mjs, qa/experience-counter.test.mjs), never edited by hand.

   Calculation — COMPLETED professional years, calendar-anniversary logic:
     years = currentYear - 2008
     minus 1 when the current calendar date is before August 1.
   Not derived from milliseconds: leap years and DST never shift the value.

     2026-07-31 → 17     2026-08-01 → 18     2026-09-24 → 18
     2027-07-31 → 18     2027-08-01 → 19

   Time zone / date safety. The rule is a CALENDAR rule: a new professional
   year starts on the calendar date 1 August. The comparison therefore uses
   the calendar date components (year, month, day) of the supplied Date in
   the environment's local time zone — for a visitor, their own local date;
   for QA, a date constructed from explicit calendar components. UTC is never
   consulted, so no visitor sees the value change at 03:00 local because of a
   UTC midnight, and the only difference two time zones can ever see is the
   ordinary one-day window around 1 August in which their calendar dates
   legitimately differ. An ISO 'YYYY-MM-DD' string is parsed as a calendar
   date too (Date.parse would treat it as UTC midnight, which is exactly the
   ambiguity this file exists to avoid).

   Runtime: loaded on pages that display the counter, after the DOM has been
   parsed and before main.js, and replaces the text of every
   [data-experience-years] node. The node is a plain inline span inside the
   approved trust line — same font, size, weight, colour and spacing — and the
   fallback it ships with already equals the calculated value, so the swap
   produces no visible change and no layout shift. Without JavaScript the
   verified fallback simply stays.

   Exposed as window.FMExperience in the browser and as module.exports under
   CommonJS so the QA gate calls the very same function the site runs.
   ========================================================================== */
/*
  FINMENTOR — proprietary website content and implementation.
  © 2026 FINMENTOR / Ghennadi Iacovlev. All rights reserved.
  Unauthorized copying, redistribution or commercial reuse is prohibited.
  Contact: cfo@finmentor.md
*/

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) { module.exports = api; }
  if (root) {
    root.FMExperience = api;
    if (root.document) {
      var run = function () { try { api.apply(root.document); } catch (e) { /* the verified fallback stays */ } };
      if (root.document.readyState === 'loading') { root.document.addEventListener('DOMContentLoaded', run); }
      else { run(); }
    }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* The canonical career start. Change it HERE and nowhere else. */
  var FINANCE_CAREER_START_DATE = '2008-08-01';

  var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /* Derived from the string above, so the year / month / day exist once. */
  var START = (function () {
    var m = ISO_DATE.exec(FINANCE_CAREER_START_DATE);
    return { year: +m[1], month: +m[2], day: +m[3] };
  })();

  /* Calendar components of `input` in local time. Accepts a Date, an ISO
     'YYYY-MM-DD' string, or nothing (= today). Returns null when the input is
     not a usable date, so callers never propagate NaN. */
  function calendarParts(input) {
    if (input === undefined || input === null) { input = new Date(); }
    if (typeof input === 'string') {
      var m = ISO_DATE.exec(input);
      if (!m) { return null; }
      return { year: +m[1], month: +m[2], day: +m[3] };
    }
    if (Object.prototype.toString.call(input) !== '[object Date]' || isNaN(input.getTime())) { return null; }
    return { year: input.getFullYear(), month: input.getMonth() + 1, day: input.getDate() };
  }

  /* COMPLETED professional years on the given calendar date. */
  function getFinanceExperienceYears(date) {
    var p = calendarParts(date);
    if (!p) { return null; }
    var years = p.year - START.year;
    if (p.month < START.month || (p.month === START.month && p.day < START.day)) { years -= 1; }
    return years;
  }

  /* The public form: «18+». Language-neutral — RU and RO wrap the same value
     in their own words. */
  function formatExperienceYears(date) {
    var years = getFinanceExperienceYears(date);
    return years === null ? null : years + '+';
  }

  /* Writes the current value into every [data-experience-years] node of `doc`.
     Returns the number of nodes updated. A node whose text already matches
     (the normal case, since the fallback is verified) is left untouched. */
  function apply(doc, date) {
    var value = formatExperienceYears(date);
    if (!value || !doc || typeof doc.querySelectorAll !== 'function') { return 0; }
    var nodes = doc.querySelectorAll('[data-experience-years]');
    var changed = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].textContent !== value) { nodes[i].textContent = value; changed++; }
    }
    return changed;
  }

  return {
    FINANCE_CAREER_START_DATE: FINANCE_CAREER_START_DATE,
    getFinanceExperienceYears: getFinanceExperienceYears,
    formatExperienceYears: formatExperienceYears,
    apply: apply
  };
});
