#!/usr/bin/env node
// FINMENTOR — typography lock: sans-serif everywhere on the website, no serif face.
//
// The owner's rule is site-wide and final: premium character comes from scale, weight contrast,
// spacing, layout, photography and motion — never from a serif typeface. This gate is static
// (no browser): every stylesheet, inline style block, style attribute and font URL the website
// ships must be free of serif families. The rendered-font proof (CSS.getPlatformFontsForNode on
// every page at 1440 and 390) is recorded in SITE_WIDE_FINAL_QA_REPORT.md.
//
// Documented exceptions are pinned by name rather than tolerated by pattern: server-rendered
// n8n surfaces (Financial X-Ray client review and owner brief) live in sealed workflow code whose
// bytes are fingerprinted by the n8n drift and closure gates. They need a sealed n8n release, not
// a website edit. The live Mini App (app-premium) is byte-sealed by the C2 closure gate in the
// same way. This gate fails if serif spreads to any other file.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const tracked = execSync('git ls-files -z', { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean);

let pass = 0;
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}

// serif families by name, and the generic `serif` keyword (but never `sans-serif`)
const SERIF = /playfair|georgia|times new roman|cormorant|bodoni|garamond|baskerville|didot|merriweather|\blora\b|libre caslon|cambria|constantia|(?<!sans-)\bserif\b/i;
// app-premium is the live Telegram Mini App: its whole tree is byte-sealed by the C2 closure
// gate, so it is a sealed surface like n8n (listed in EXCEPTION), not part of this website pass.
const NOT_WEBSITE = /^(n8n|qa-evidence|qa|docs|scripts|db|app-premium)\//;
const websiteHtml = tracked.filter((f) => f.endsWith('.html') && !NOT_WEBSITE.test(f));
const websiteCss = tracked.filter((f) => f.endsWith('.css') && !NOT_WEBSITE.test(f));
const EXCEPTION = new Set([
  'n8n/candidate/xray-analysis-workflow.sdk.js',
  'n8n/candidate/premium-miniapp-host-candidate.json',
  'n8n/candidate/b21c-test-page-candidate.json',
  'n8n/src/lead-intelligence/render.js',
  // the sealed Mini App (C2 closure hashes the whole app-premium tree)
  'app-premium/app.css',
  'app-premium/index.html',
]);
const fontDecls = (css) => [...css.matchAll(/(?:font-family|font|--font-[\w-]+|--display|--sans|--serif)\s*:\s*([^;}]+)/gi)].map((m) => m[1]);

check('website stylesheets declare no serif family', () => {
  const bad = [];
  for (const f of websiteCss) for (const d of fontDecls(read(f))) if (SERIF.test(d)) bad.push(f + ': ' + d.trim().slice(0, 60));
  assert(websiteCss.length >= 4, 'stylesheet inventory looks wrong: ' + websiteCss.length);
  assert(bad.length === 0, bad.length + ' serif declaration(s): ' + bad.slice(0, 4).join(' | '));
});

check('website pages carry no serif in inline styles or style attributes', () => {
  const bad = [];
  for (const f of websiteHtml) {
    const html = read(f);
    const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
      + '\n' + [...html.matchAll(/\sstyle="([^"]*)"/gi)].map((m) => m[1]).join(';');
    for (const d of fontDecls(inline)) if (SERIF.test(d)) bad.push(f + ': ' + d.trim().slice(0, 60));
  }
  assert(websiteHtml.length >= 90, 'page inventory looks wrong: ' + websiteHtml.length);
  assert(bad.length === 0, bad.length + ' serif declaration(s): ' + bad.slice(0, 4).join(' | '));
});

check('no page requests a serif webfont', () => {
  const bad = [];
  for (const f of websiteHtml) for (const m of read(f).matchAll(/fonts\.googleapis\.com\/css2\?[^"']*/g)) if (SERIF.test(decodeURIComponent(m[0]).replace(/\+/g, ' '))) bad.push(f);
  assert(bad.length === 0, bad.length + ' page(s) load a serif webfont: ' + bad.slice(0, 5).join(', '));
});

check('the display token resolves to Manrope (sans-serif) in every stylesheet that defines it', () => {
  const css = read('style.css');
  const m = css.match(/--font-display\s*:\s*([^;]+);/);
  assert(m && /^\s*"?Manrope"?/.test(m[1]) && /sans-serif\s*$/.test(m[1].trim()), '--font-display is not Manrope-first: ' + (m && m[1]));
  for (const f of websiteCss) for (const d of read(f).matchAll(/--(?:font-display|display)\s*:\s*([^;]+);/g)) assert(!SERIF.test(d[1]), f + ' display token is serif: ' + d[1]);
});

check('serif survives only in the sealed n8n surfaces named above', () => {
  // font declarations only (CSS, and CSS carried inside JS/JSON renderers), so prose that says
  // "serif" or "times" is not mistaken for typography
  const found = tracked.filter((f) => /\.(css|html|js|mjs|json)$/.test(f) && !/^qa\//.test(f) && fontDecls(read(f)).some((d) => SERIF.test(d)));
  const unexpected = found.filter((f) => !EXCEPTION.has(f));
  assert(unexpected.length === 0, 'serif outside the sealed n8n surfaces: ' + unexpected.slice(0, 6).join(', '));
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
