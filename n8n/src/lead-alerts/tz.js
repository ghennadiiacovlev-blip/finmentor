// FINMENTOR — the one clock helper the alert workflows share.
//
// SEPARATE FROM presenter.js ON PURPOSE.
//
// The renderer is asserted to touch no clock, no locale and no `Intl`, because a message whose
// bytes depend on the runtime's ICU build is not reproducible and cannot be gated. But the
// workflows genuinely do hold a timezone — `settings.timezone`, `Europe/Chisinau` — and Chisinau is
// UTC+3 in summer and UTC+2 in winter, so a hard-coded offset would print the wrong hour for five
// months of the year.
//
// So the offset is resolved HERE, once, and handed to the renderer as a number. `Intl` is used in
// exactly this file, where its only output is an integer that the gate can pin.

'use strict';

// Minutes to ADD to UTC to get local time in `tz` at the instant `at`. Returns `fallback` (default
// +180, Chisinau summer time) when the runtime cannot resolve the zone, because an alert with a
// slightly wrong hour is worth more than no alert.
function tzOffsetMinutes(tz, at, fallback) {
  const when = at instanceof Date ? at : new Date(at);
  const def = fallback === undefined ? 180 : fallback;
  if (Number.isNaN(when.getTime())) { return def; }
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: String(tz || 'Europe/Chisinau'), hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const part of dtf.formatToParts(when)) { p[part.type] = part.value; }
    // hour comes back as 24 at midnight under hour12:false on some ICU builds.
    const hour = Number(p.hour) % 24;
    const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
      hour, Number(p.minute), Number(p.second));
    const diff = Math.round((asIfUtc - when.getTime()) / 60000);
    // A sane zone is within ±14 h of UTC. Anything else means the runtime answered nonsense.
    return Math.abs(diff) <= 840 ? diff : def;
  } catch (e) {
    return def;
  }
}

module.exports = { tzOffsetMinutes };
