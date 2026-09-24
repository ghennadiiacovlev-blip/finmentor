#!/usr/bin/env node
// FINMENTOR — keep the static experience-counter fallback in step with experience.js.
//
//   node scripts/sync-experience-fallback.mjs          rewrite every fallback to today's value
//   node scripts/sync-experience-fallback.mjs --check  exit 1 if any fallback is stale (release QA)
//
// The HTML ships «<span data-experience-years>18+</span>» so a visitor without JavaScript still
// reads the right number. That text is NOT a second source of truth: this script derives it from
// the same helper the browser runs, and qa/experience-counter.test.mjs refuses a stale value.
// Run it (or let the gate tell you to) whenever a release is cut after 1 August.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const X = createRequire(import.meta.url)(join(ROOT, 'experience.js'));
const PAGES = ['index.html', 'ro/index.html', 'about.html', 'ro/about.html'];
const SPAN = /(<span data-experience-years>)([^<]*)(<\/span>)/g;
const CHECK = process.argv.includes('--check');

const value = X.formatExperienceYears();
let stale = 0;
for (const page of PAGES) {
  const file = join(ROOT, page);
  const before = readFileSync(file, 'utf8');
  let found = 0;
  const after = before.replace(SPAN, (m, open, current, close) => { found++; return open + value + close; });
  if (!found) { console.log(`WARN  ${page}: no [data-experience-years] span`); continue; }
  if (after === before) { console.log(`OK    ${page}: ${found} fallback(s) already ${value}`); continue; }
  stale++;
  if (CHECK) { console.log(`STALE ${page}: fallback differs from ${value}`); continue; }
  writeFileSync(file, after);
  console.log(`WROTE ${page}: ${found} fallback(s) → ${value}`);
}
if (CHECK && stale) { console.error(`\n${stale} page(s) stale — run without --check to rewrite`); process.exit(1); }
console.log(`\nexperience fallback ${CHECK ? 'checked' : 'synced'} at ${value} (career start ${X.FINANCE_CAREER_START_DATE})`);
