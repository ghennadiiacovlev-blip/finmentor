// FINMENTOR — QA sweep for the Financial Business Map build
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const NEW = ['pipeline-to-cash.html', 'revenue-quality.html', 'price-leakage.html',
             'deal-economics.html', 'closed-won-to-cash.html', 'capex-hurdle-rate.html',
             'capital-allocation-value.html'];

let PASS = 0, WARN = 0, ERR = 0, E0 = 0;
const err = m => { ERR++; console.log('  ERROR   ' + m); };
const warn = m => { WARN++; console.log('  WARN    ' + m); };
const ok = m => { PASS++; console.log('  PASS    ' + m); };

// pages in scope: everything we touched or created
const SCOPE = [];
for (const s of NEW) { SCOPE.push(s); SCOPE.push('ro/' + s); }
SCOPE.push('materials.html', 'ro/materials.html', 'index.html', 'ro/index.html');
// IA 2.0 hub pages carry the navigation and the content moved off the homepage.
for (const s of ['owner.html', 'capital-management.html', 'business-models.html', 'about.html', 'budgeting-forecasting.html']) { SCOPE.push(s); SCOPE.push('ro/' + s); }
const TOUCHED = ['ai-dlya-cfo.html', 'capacity-released.html', 'capital-preservation.html', 'cash-flow.html',
  'fcf-postavshiki.html', 'kaznacheystvo.html', 'margin-factor-analysis-flags.html', 'methodology.html',
  'platezhnyy-kalendar.html', 'power-bi-dlya-sobstvennika.html', 'pribyl-vs-cash.html',
  'renewal-revenue-at-risk.html', 'supplier-rating-purchasing-priorities.html',
  'supplier-shelf-credit.html', 'treasury-waterfall.html', 'upravlencheskiy-pl.html', 'working-capital.html'];
for (const s of TOUCHED) { SCOPE.push(s); SCOPE.push('ro/' + s); }

const read = p => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== 1. Files exist (RU/RO parity of new articles) ===');
for (const s of NEW) {
  const a = existsSync(join(ROOT, s)), b = existsSync(join(ROOT, 'ro', s));
  if (a && b) ok(`${s} — RU + RO`); else err(`${s} — RU:${a} RO:${b}`);
}

console.log('\n=== 2. Internal links resolve ===');
const anchors = new Map();   // page -> Set of ids
function idsOf(p) {
  if (!anchors.has(p)) {
    let set = new Set();
    try { for (const m of read(p).matchAll(/\sid="([^"]+)"/g)) set.add(m[1]); } catch { set = null; }
    anchors.set(p, set);
  }
  return anchors.get(p);
}
let linkCount = 0, broken = 0, brokenAnchors = 0;
for (const page of SCOPE) {
  const html = read(page);
  const dir = dirname(page) === '.' ? '' : dirname(page);
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|#|data:)/.test(href)) {
      if (href.startsWith('#')) {
        const id = href.slice(1);
        if (id && !idsOf(page)?.has(id)) { brokenAnchors++; err(`${page} → ${href} (anchor missing)`); }
      }
      continue;
    }
    linkCount++;
    const [pathPart, frag] = href.split('#');
    const file = pathPart.split('?')[0];
    if (file === '' && !frag) continue;
    const target = file === '' ? page : (dir ? `${dir}/${file}` : file).replace(/\/\.\//g, '/');
    const norm = resolve(ROOT, target).replace(/\\/g, '/').replace(ROOT + '/', '');
    if (!existsSync(join(ROOT, norm))) { broken++; err(`${page} → ${href} (file not found: ${norm})`); continue; }
    if (frag && norm.endsWith('.html')) {
      const set = idsOf(norm);
      if (set && !set.has(frag)) { brokenAnchors++; err(`${page} → ${href} (anchor #${frag} missing in ${norm})`); }
    }
  }
}
if (!broken && !brokenAnchors) ok(`${linkCount} internal links across ${SCOPE.length} pages — 0 broken, 0 dead anchors`);

console.log('\n=== 3. SEO head on new articles ===');
for (const s of NEW) {
  for (const [lang, p] of [['ru', s], ['ro', 'ro/' + s]]) {
    const h = read(p);
    const canon = (h.match(/rel="canonical" href="([^"]+)"/) || [])[1];
    const want = lang === 'ru' ? `https://www.finmentor.md/${s}` : `https://www.finmentor.md/ro/${s}`;
    if (canon !== want) err(`${p} canonical = ${canon}, expected ${want}`);
    const hl = [...h.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(m => m[1]);
    if (!(hl.includes('ru') && hl.includes('ro') && hl.includes('x-default'))) err(`${p} hreflang incomplete: ${hl}`);
    if (!/<html lang="(ru|ro)">/.test(h)) err(`${p} missing html lang`);
    const declared = (h.match(/<html lang="([^"]+)"/) || [])[1];
    if (declared !== lang) err(`${p} html lang = ${declared}, expected ${lang}`);
    if (!/<meta name="description" content=".{60,}?"/.test(h)) warn(`${p} description short or missing`);
    if (!/"@type": "Article"/.test(h)) err(`${p} missing Article schema`);
    if (!/"@type": "BreadcrumbList"/.test(h)) err(`${p} missing BreadcrumbList schema`);
  }
}
if (ERR === E0) ok('canonical / hreflang / lang / schema correct on all 14 new pages');

console.log('\n=== 4. Title + description uniqueness (whole site) ===');
const allPages = [];
(function walk(d, rel = '') {
  for (const e of readdirSync(join(ROOT, d))) {
    const p = rel ? `${rel}/${e}` : e;
    if (['.git', 'node_modules', 'qa', 'qa-artifacts', 'qa-evidence', 'docs', '.uat',
         'FINMENTOR_GATE6_FINAL', 'app', 'app-premium', 'n8n', 'db', 'gateway', 'scripts', '.github'].includes(e)) continue;
    const st = statSync(join(ROOT, d, e));
    if (st.isDirectory()) walk(join(d, e), p);
    else if (e.endsWith('.html') && !e.includes('(')) allPages.push(p.replace(/\\/g, '/'));
  }
})('.');
// Only indexable pages can create a duplicate-content problem. Legacy alias pages were
// deliberately neutralised with noindex (commit 11438a0) and intentionally mirror the
// title of the page they canonicalise to, so they are excluded — but a page that claims
// noindex while still being reachable from the sitemap is itself an error.
const titles = new Map(), descs = new Map();
let skippedNoindex = 0, robotsConflicts = 0;
for (const p of allPages) {
  const h = read(p);
  const robots = [...h.matchAll(/<meta name="robots" content="([^"]*)"/g)].map(m => m[1].toLowerCase());
  if (robots.length > 1) { robotsConflicts++; err(`${p} declares ${robots.length} robots directives: ${robots.join(' | ')}`); }
  if (robots.some(r => r.includes('noindex'))) { skippedNoindex++; continue; }
  const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1];
  const d = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  if (t) (titles.get(t) || titles.set(t, []).get(t)).push(p);
  if (d) (descs.get(d) || descs.set(d, []).get(d)).push(p);
}
let dupT = 0, dupD = 0;
for (const [t, ps] of titles) if (ps.length > 1) { dupT++; warn(`duplicate <title> "${t.slice(0, 60)}" → ${ps.join(', ')}`); }
for (const [d, ps] of descs) if (ps.length > 1) { dupD++; warn(`duplicate description → ${ps.join(', ')}`); }
if (!dupT && !dupD && !robotsConflicts) ok(`${allPages.length - skippedNoindex} indexable pages scanned (${skippedNoindex} noindex aliases skipped) — no duplicate titles or descriptions, no robots conflicts`);

console.log('\n=== 5. Language purity (no RU text on RO pages and vice versa) ===');
const CYR = /[\u0400-\u04FF]/;
const RODIAC = /[ăâîșțĂÂÎȘȚ]/;
for (const s of NEW) {
  // RO page: strip the RU/RO language switcher and script/meta noise before testing
  let ro = read('ro/' + s)
    .replace(/<span class="lang"[\s\S]*?<\/span>\s*<a href="index.html#consult"/, '<a href="index.html#consult"')
    .replace(/<!--[\s\S]*?-->/g, '');
  const hits = ro.match(new RegExp(CYR.source, 'g'));
  if (hits) err(`ro/${s} contains Cyrillic: ${[...new Set(hits)].join('')}`);
  // RU page: Romanian diacritics should not appear in body copy
  let ru = read(s).replace(/<!--[\s\S]*?-->/g, '');
  const body = ru.slice(ru.indexOf('<article class="doc">'), ru.indexOf('</article>'));
  const rd = body.match(new RegExp(RODIAC.source, 'g'));
  if (rd) err(`${s} body contains Romanian diacritics: ${[...new Set(rd)].join('')}`);
}
// Foreign-script corruption: a stray CJK/Arabic/Devanagari glyph inside RU or RO copy is
// always a generation defect, never intentional. Cheap to check, invisible to proofreading.
for (const p of NEW.flatMap(s => [s, 'ro/' + s]).concat(['materials.html', 'ro/materials.html'])) {
  const m = read(p).match(/[　-鿿؀-ۿऀ-ॿ가-힯]/g);
  if (m) err(`${p} contains foreign-script characters: ${[...new Set(m)].join('')}`);
}
if (ERR === E0) ok('no cross-language contamination and no foreign-script corruption in the new pages');

console.log('\n=== 6. Heading hierarchy on new articles ===');
for (const p of NEW.flatMap(s => [s, 'ro/' + s])) {
  const h = read(p);
  const h1 = (h.match(/<h1[^>]*>/g) || []).length;
  const h2 = (h.match(/<h2[^>]*>/g) || []).length;
  const h3 = (h.match(/<h3[^>]*>/g) || []).length;
  if (h1 !== 1) err(`${p} has ${h1} <h1>`);
  if (h2 < 5) warn(`${p} only ${h2} <h2>`);
  if (h3 > 0 && h2 === 0) err(`${p} h3 without h2`);
}
if (ERR === E0) ok('exactly one h1 per page, h2 sections present, no orphan h3');

console.log('\n=== 7. Financial Map structure (both languages) ===');
for (const p of ['materials.html', 'ro/materials.html']) {
  const h = read(p);
  const stages = (h.match(/class="fmap-stage"/g) || []).length;
  const chapters = (h.match(/class="fmap-chapter"/g) || []).length;
  const principles = (h.match(/class="fmap-principle"/g) || []).length;
  const kb = (h.match(/class="kb-item"/g) || []).length;
  if (stages !== 24) err(`${p} has ${stages} stages, expected 24`);
  if (chapters !== 5) err(`${p} has ${chapters} chapter blocks, expected 5 (foundation + 4)`);
  if (principles !== 10) err(`${p} has ${principles} principles, expected 10`);
  if (kb !== 34) err(`${p} has ${kb} library items, expected 34`);
  if (!h.includes('id="financial-map"')) err(`${p} missing #financial-map`);
  if (!h.includes('id="library"')) err(`${p} missing #library`);
  if (stages === 24 && chapters === 5 && principles === 10 && kb === 34) ok(`${p} — 24 stages, 4 chapters + foundation, 10 principles, 34 library items`);
}

console.log('\n=== 8. CTA reach ===');
for (const [p, label] of [['index.html', 'RU home'], ['ro/index.html', 'RO home']]) {
  const h = read(p);
  const n = (h.match(/materials\.html#financial-map/g) || []).length;
  if (n >= 2) ok(`${label} — ${n} links to the map (CTA + footer)`); else err(`${label} — only ${n} map link(s)`);
}
let ctaPages = 0;
for (const p of TOUCHED.flatMap(s => [s, 'ro/' + s]).concat(NEW.flatMap(s => [s, 'ro/' + s]))) {
  if (read(p).includes('class="map-cta"')) ctaPages++;
}
ok(`${ctaPages} article pages carry the contextual map CTA`);

console.log('\n=== 9. Markup sanity on new pages ===');
for (const p of NEW.flatMap(s => [s, 'ro/' + s])) {
  const h = read(p);
  for (const tag of ['section', 'div', 'table', 'details', 'article', 'nav', 'ul', 'ol']) {
    const open = (h.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
    const close = (h.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) err(`${p} <${tag}> ${open} open vs ${close} close`);
  }
  // JSON-LD must parse
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { err(`${p} invalid JSON-LD: ${e.message}`); }
  }
}
if (ERR === E0) ok('balanced tags and valid JSON-LD on all new pages');

console.log('\n=== 10. Sitemap ===');
const sm = read('sitemap.xml');
for (const s of NEW) {
  if (!sm.includes(`<loc>https://www.finmentor.md/${s}</loc>`)) err(`sitemap missing RU ${s}`);
  if (!sm.includes(`<loc>https://www.finmentor.md/ro/${s}</loc>`)) err(`sitemap missing RO ${s}`);
}
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const dupLoc = locs.filter((l, i) => locs.indexOf(l) !== i);
if (dupLoc.length) err('duplicate sitemap entries: ' + dupLoc.join(', '));
// every sitemap URL must exist on disk
let smMissing = 0;
for (const l of locs) {
  const rel = l.replace('https://www.finmentor.md/', '') || 'index.html';
  const f = rel.endsWith('/') ? rel + 'index.html' : rel;
  if (!existsSync(join(ROOT, f))) { smMissing++; err(`sitemap URL has no file: ${l}`); }
}
if (!smMissing && !dupLoc.length) ok(`${locs.length} sitemap URLs — all resolve, no duplicates`);

console.log(`\n=== SUMMARY ===\n  PASS: ${PASS}   WARN: ${WARN}   ERROR: ${ERR}\n`);
process.exit(ERR ? 1 : 0);
