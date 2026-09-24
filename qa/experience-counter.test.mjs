#!/usr/bin/env node
// FINMENTOR — professional-experience counter gate.
//
// Offline, cwd-independent, exits non-zero on failure. Proves that the public «N+ лет /
// N+ ani» value is computed — never typed — from the ONE canonical career-start date in
// experience.js, and that the static fallback shipped in the HTML equals today's computed
// value, so a release can never carry a stale number again.
//
//   node qa/experience-counter.test.mjs
//
// The five owner-mandated dates:
//   2026-07-31 → 17   2026-08-01 → 18   2026-09-24 → 18   2027-07-31 → 18   2027-08-01 → 19

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// ------------------------------------------------------------------ the single source
const HELPER = 'experience.js';
const X = require(join(ROOT, HELPER));
const EXPECTED_START = '2008-08-01';
const MANDATORY = [['2026-07-31', 17], ['2026-08-01', 18], ['2026-09-24', 18], ['2027-07-31', 18], ['2027-08-01', 19]];

// Pages that display the counter, with the exact surrounding wording each language keeps.
const PAGES = {
  'index.html':    { lang: 'ru', after: ' лет в корпоративных финансах' },
  'ro/index.html': { lang: 'ro', after: ' ani în finanțe corporative' },
  'about.html':    { lang: 'ru', after: ' лет' },
  'ro/about.html': { lang: 'ro', after: ' ani' },
};
const SPAN = /<span data-experience-years>([^<]*)<\/span>/g;

// Independent re-derivation of today's value, written differently from the helper on purpose.
function independentYears(d) {
  const anniversaryPassed = (d.getMonth() + 1 > 8) || (d.getMonth() + 1 === 8 && d.getDate() >= 1);
  return d.getFullYear() - 2008 - (anniversaryPassed ? 0 : 1);
}
const today = new Date();
const TODAY_VALUE = independentYears(today) + '+';

console.log('Experience counter — canonical start ' + X.FINANCE_CAREER_START_DATE + ', today ' + TODAY_VALUE);

// ------------------------------------------------------------------ calculation rule
check('canonical career start date is 2008-08-01', () => {
  assert(X.FINANCE_CAREER_START_DATE === EXPECTED_START, 'got ' + X.FINANCE_CAREER_START_DATE);
});

for (const [iso, years] of MANDATORY) {
  check(`ISO ${iso} → ${years} (calendar date, not UTC parse)`, () => {
    assert(X.getFinanceExperienceYears(iso) === years, 'got ' + X.getFinanceExperienceYears(iso));
  });
  check(`local Date ${iso} → ${years}`, () => {
    const [y, m, d] = iso.split('-').map(Number);
    assert(X.getFinanceExperienceYears(new Date(y, m - 1, d)) === years, 'got ' + X.getFinanceExperienceYears(new Date(y, m - 1, d)));
  });
}

check('time of day never matters: 31 Jul 23:59:59 → 17, 1 Aug 00:00:00 → 18 (local calendar)', () => {
  assert(X.getFinanceExperienceYears(new Date(2026, 6, 31, 23, 59, 59)) === 17, 'end of 31 July');
  assert(X.getFinanceExperienceYears(new Date(2026, 7, 1, 0, 0, 0)) === 18, 'start of 1 August');
});

check('anniversary logic, not milliseconds: leap day and year-end do not drift', () => {
  assert(X.getFinanceExperienceYears('2028-02-29') === 19, 'leap day 2028');
  assert(X.getFinanceExperienceYears('2028-12-31') === 20, 'year end 2028');
  assert(X.getFinanceExperienceYears('2029-01-01') === 20, 'new year 2029');
  assert(X.getFinanceExperienceYears('2029-07-31') === 20, 'eve of anniversary 2029');
  assert(X.getFinanceExperienceYears('2029-08-01') === 21, 'anniversary 2029');
});

check('formatted value carries the plus sign: 2026-09-24 → "18+"', () => {
  assert(X.formatExperienceYears('2026-09-24') === '18+', 'got ' + X.formatExperienceYears('2026-09-24'));
});

check('invalid input yields null, never NaN / undefined / "[object Object]"', () => {
  for (const bad of ['nope', '2026/09/24', new Date('x'), 42, {}]) {
    assert(X.getFinanceExperienceYears(bad) === null, 'years for ' + String(bad));
    assert(X.formatExperienceYears(bad) === null, 'format for ' + String(bad));
  }
});

check('current date: helper agrees with an independent calendar derivation', () => {
  assert(X.getFinanceExperienceYears() === independentYears(today), 'helper ' + X.getFinanceExperienceYears() + ' vs ' + independentYears(today));
  assert(X.formatExperienceYears() === TODAY_VALUE, 'format ' + X.formatExperienceYears());
});

// ------------------------------------------------------------------ DOM behaviour
function fakeDoc(texts) {
  const nodes = texts.map((t) => ({ textContent: t }));
  return { nodes, querySelectorAll: (sel) => (sel === '[data-experience-years]' ? nodes : []) };
}

check('apply() rewrites a stale node and leaves an in-sync node untouched (no layout shift path)', () => {
  const doc = fakeDoc(['15+', TODAY_VALUE]);
  const changed = X.apply(doc);
  assert(changed === 1, 'changed ' + changed);
  assert(doc.nodes[0].textContent === TODAY_VALUE && doc.nodes[1].textContent === TODAY_VALUE, 'values');
  assert(X.apply(doc) === 0, 'second pass must be a no-op');
});

check('apply() is safe with no document / no nodes / invalid date', () => {
  assert(X.apply(null) === 0, 'null doc');
  assert(X.apply(fakeDoc([])) === 0, 'no nodes');
  const doc = fakeDoc(['18+']);
  assert(X.apply(doc, 'garbage') === 0 && doc.nodes[0].textContent === '18+', 'invalid date must not blank the node');
});

check('shipped file runs in a browser-like window and updates the DOM on load', () => {
  const doc = fakeDoc(['15+']);
  doc.readyState = 'complete';
  doc.addEventListener = () => {};
  const win = { document: doc };
  win.window = win;
  vm.runInNewContext(read(HELPER), win, { filename: HELPER });
  assert(win.FMExperience && typeof win.FMExperience.getFinanceExperienceYears === 'function', 'window.FMExperience');
  assert(doc.nodes[0].textContent === TODAY_VALUE, 'node after load: ' + doc.nodes[0].textContent);
});

// ------------------------------------------------------------------ static fallback + RU / RO
for (const [page, spec] of Object.entries(PAGES)) {
  const html = read(page);
  check(`${page}: static fallback equals today's computed value (${TODAY_VALUE})`, () => {
    const found = [...html.matchAll(SPAN)].map((m) => m[1]);
    assert(found.length >= 1, 'no [data-experience-years] span');
    found.forEach((v) => assert(v === TODAY_VALUE, `fallback "${v}" is stale — run node scripts/sync-experience-fallback.mjs`));
  });
  check(`${page}: ${spec.lang.toUpperCase()} wording follows the same value`, () => {
    const re = new RegExp('<span data-experience-years>[^<]*</span>' + spec.after.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert(re.test(html), 'expected the span to be followed by "' + spec.after + '"');
  });
  check(`${page}: loads experience.js before main.js`, () => {
    const prefix = page.startsWith('ro/') ? '../' : '';
    const a = html.indexOf(`<script src="${prefix}experience.js"></script>`);
    const b = html.indexOf(`<script src="${prefix}main.js"></script>`);
    assert(a !== -1, 'experience.js not loaded');
    assert(b !== -1 && a < b, 'experience.js must precede main.js');
  });
}

check('RU and RO homepages carry the identical numeric value (one calculation)', () => {
  const ru = [...read('index.html').matchAll(SPAN)][0][1];
  const ro = [...read('ro/index.html').matchAll(SPAN)][0][1];
  assert(ru === ro, ru + ' vs ' + ro);
});

// ------------------------------------------------------------------ repository-wide hygiene
function publicSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(ROOT, abs).replace(/\\/g, '/');
      if (/^(\.git|\.uat|\.github|\.claude|qa|qa-artifacts|qa-evidence|docs|db|n8n|scripts|app|app-premium|gateway|images)(\/|$)/.test(rel)) continue;
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      if (/\.(html|js)$/.test(name) && !/ \(\d+\)\.html$/.test(name)) out.push(rel);
    }
  };
  walk(ROOT);
  return out;
}
const SOURCES = publicSources();

check('no stale hard-coded public experience value outside the counter span', () => {
  const stale = /\b\d{1,2}\+?\s*(?:лет в корпоративных|ani în finanțe|years (?:in|of) corporate|de ani în finanțe)/g;
  const hits = [];
  for (const f of SOURCES) {
    const body = read(f).replace(SPAN, '');
    for (const m of body.matchAll(stale)) hits.push(f + ': ' + m[0]);
  }
  assert(hits.length === 0, hits.join('; '));
});

check('exactly one shipped source carries the career start date', () => {
  const carriers = SOURCES.filter((f) => read(f).includes(EXPECTED_START) || /FINANCE_CAREER_START/.test(read(f)));
  assert(carriers.length === 1 && carriers[0] === HELPER, 'carriers: ' + carriers.join(', '));
  const year2008 = SOURCES.filter((f) => f !== HELPER && /\b2008\b/.test(read(f)));
  assert(year2008.length === 0, 'the year 2008 is typed in: ' + year2008.join(', '));
});

check('no counter animation: the span is never a [data-count] target', () => {
  for (const page of Object.keys(PAGES)) {
    assert(!/data-experience-years[^>]*data-count|data-count[^>]*data-experience-years/.test(read(page)), page);
  }
});

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error('\n' + failures.join('\n')); process.exit(1); }
