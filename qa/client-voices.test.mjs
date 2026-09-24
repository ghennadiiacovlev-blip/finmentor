#!/usr/bin/env node
// FINMENTOR — Client voices gate.
//
// Offline, cwd-independent, exits non-zero on failure. Proves that the curated testimonial
// module can never show anything the client has not approved, that the production data file
// carries no placeholder praise, that RU/RO read one data source, and that the design mock
// stays out of every public page.
//
//   node qa/client-voices.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

const DATA = require(join(ROOT, 'data', 'testimonials.js'));
const CV = require(join(ROOT, 'client-voices.js'));
const REQUIRED = ['id', 'language', 'quote', 'person_display', 'role', 'industry', 'company_display', 'company_permission', 'date', 'source', 'consent_status', 'is_published', 'featured'];
const PAGES = { 'index.html': 'ru', 'ro/index.html': 'ro' };

// ------------------------------------------------------------------ data file contract
check('data/testimonials.js loads and exposes { version, entries[] }', () => {
  assert(DATA && Array.isArray(DATA.entries) && typeof DATA.version === 'number', 'shape');
});

check('every entry carries the full schema with sane values', () => {
  for (const e of DATA.entries) {
    for (const k of REQUIRED) assert(Object.prototype.hasOwnProperty.call(e, k), e.id + ' missing ' + k);
    assert(['ru', 'ro'].includes(e.language), e.id + ' language');
    assert(['approved', 'pending', 'declined'].includes(e.consent_status), e.id + ' consent_status');
    assert(typeof e.is_published === 'boolean' && typeof e.featured === 'boolean' && typeof e.company_permission === 'boolean', e.id + ' booleans');
    assert(/^\d{4}(-\d{2})?$/.test(String(e.date)), e.id + ' date');
  }
  const ids = DATA.entries.map((e) => e.id);
  assert(new Set(ids).size === ids.length, 'duplicate ids');
});

check('no entry is published without approved consent', () => {
  for (const e of DATA.entries) assert(!(e.is_published && e.consent_status !== 'approved'), e.id + ' published without consent');
});

check('company names appear only with explicit permission', () => {
  for (const e of DATA.entries) assert(!(e.company_display && e.company_permission !== true), e.id + ' company shown without permission');
});

check('production data contains no placeholder praise, numbers or outcome claims', () => {
  const src = read('data/testimonials.js');
  const body = src.slice(src.indexOf('entries:'));
  const banned = /transformed|excellent service|highly recommend|рекоменд|отличн|лучш|счастлив|\d+\s?%|ROI|прибыль выросла|profit(ul)? a crescut|lorem/i;
  assert(!banned.test(body), 'banned phrase found: ' + (body.match(banned) || [])[0]);
  for (const e of DATA.entries) assert(!/\d/.test(e.quote), e.id + ' quote contains digits');
});

check('the data file declares no preview flag (that belongs to the mock only)', () => {
  assert(DATA.preview !== true, 'preview flag in production data');
});

// ------------------------------------------------------------------ selection rule
const fx = (over) => Object.assign({ id: 'x', language: 'ru', quote: 'Слова клиента.', person_display: '', role: 'Собственник', industry: '', company_display: '', company_permission: false, date: '2026', source: 's', consent_status: 'approved', is_published: true, featured: false }, over);

check('selectVoices: only published + approved + same-language entries, featured first, max 3', () => {
  const data = { entries: [
    fx({ id: 'a' }), fx({ id: 'b', is_published: false }), fx({ id: 'c', consent_status: 'pending' }),
    fx({ id: 'd', language: 'ro' }), fx({ id: 'e', featured: true }), fx({ id: 'f' }), fx({ id: 'g' }), fx({ id: 'h', consent_status: 'declined' }),
  ] };
  const ru = CV.selectVoices(data, 'ru').map((e) => e.id);
  assert(ru.join(',') === 'e,a,f', 'ru selection ' + ru.join(','));
  const ro = CV.selectVoices(data, 'ro').map((e) => e.id);
  assert(ro.join(',') === 'd', 'ro selection ' + ro.join(','));
  assert(CV.selectVoices({ entries: [] }, 'ru').length === 0 && CV.selectVoices(null, 'ru').length === 0, 'empty / null');
});

check('selectVoices: an empty quote is never shown', () => {
  assert(CV.selectVoices({ entries: [fx({ quote: '   ' })] }, 'ru').length === 0, 'blank quote rendered');
});

check('attribution: name + role, role + industry, or anonymous fallback; company only with permission', () => {
  let a = CV.attribution(fx({ person_display: 'Имя', role: 'Собственник', industry: 'розница', date: '2026-03' }), 'ru');
  assert(a.who === 'Имя' && a.meta === 'Собственник · розница · 2026', 'name form: ' + JSON.stringify(a));
  a = CV.attribution(fx({ role: 'Собственник', industry: 'дистрибуция' }), 'ru');
  assert(a.who === 'Собственник' && a.meta === 'дистрибуция · 2026', 'role form: ' + JSON.stringify(a));
  a = CV.attribution(fx({ role: '', industry: '', date: '' }), 'ru');
  assert(a.who === 'Анонимно · Собственник бизнеса' && a.meta === '', 'anonymous ru: ' + JSON.stringify(a));
  a = CV.attribution(fx({ role: '', industry: '', date: '' }), 'ro');
  assert(a.who === 'Anonim · Proprietar de afacere', 'anonymous ro');
  a = CV.attribution(fx({ company_display: 'ACME', company_permission: false }), 'ru');
  assert(!a.meta.includes('ACME'), 'company leaked without permission');
  a = CV.attribution(fx({ company_display: 'ACME', company_permission: true }), 'ru');
  assert(a.meta.includes('ACME'), 'company withheld despite permission');
});

// ------------------------------------------------------------------ renderer safety
check('renderer never writes HTML from data (textContent only)', () => {
  const src = read('client-voices.js');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), 'HTML sink found');
});

function fakeDom() {
  const mk = (tag) => {
    const n = { tag, attrs: {}, children: [], className: '', textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      get firstChild() { return this.children[0] || null; },
      querySelector(sel) { return find(this, sel); } };
    return n;
  };
  const matches = (n, sel) => sel.startsWith('[') ? Object.prototype.hasOwnProperty.call(n.attrs, sel.slice(1, -1)) : false;
  const find = (n, sel) => { for (const c of n.children) { if (matches(c, sel)) return c; const d = find(c, sel); if (d) return d; } return null; };
  const doc = { createElement: mk, querySelector: (sel) => find(doc, sel), children: [] };
  const section = mk('section'); section.setAttribute('data-client-voices', ''); section.setAttribute('data-lang', 'ru'); section.setAttribute('hidden', '');
  const head = mk('div'); head.setAttribute('data-client-voices-head', ''); section.appendChild(head);
  const list = mk('div'); list.setAttribute('data-client-voices-list', ''); section.appendChild(list);
  doc.children.push(section);
  return { doc, section, list, head };
}
const texts = (n, out = []) => { if (n.textContent) out.push(n.textContent); n.children.forEach((c) => texts(c, out)); return out; };

check('render: with no eligible entry the section stays hidden and empty', () => {
  const { doc, section, list } = fakeDom();
  assert(CV.render(doc, { entries: [fx({ is_published: false })] }) === 0, 'rendered something');
  assert('hidden' in section.attrs && list.children.length === 0, 'section not hidden/empty');
});

check('render: eligible entries unhide the section — one featured, up to two secondary, escaped text', () => {
  const { doc, section, list } = fakeDom();
  const n = CV.render(doc, { entries: [fx({ id: '1', quote: '<b>x</b> & y', featured: true }), fx({ id: '2' }), fx({ id: '3' }), fx({ id: '4' })] });
  assert(n === 3, 'count ' + n);
  assert(!('hidden' in section.attrs), 'still hidden');
  assert(list.children[0].className.includes('client-voices__featured'), 'featured first');
  assert(list.children[1].className === 'client-voices__aside' && list.children[1].children.length === 2, 'two secondary');
  assert(texts(list).includes('<b>x</b> & y'), 'quote must be literal text, never parsed');
});

check('render: the preview marker appears only for preview data', () => {
  let d = fakeDom(); CV.render(d.doc, { entries: [fx()] });
  assert(!texts(d.head).some((t) => /DESIGN MOCK/.test(t)), 'marker on production-shaped data');
  d = fakeDom(); CV.render(d.doc, { preview: true, entries: [fx()] });
  assert(texts(d.head).some((t) => /DESIGN MOCK/.test(t)), 'marker missing on preview data');
});

check('shipped files run in a browser-like window and leave the skeleton hidden with today\'s data', () => {
  const { doc, section } = fakeDom();
  doc.readyState = 'complete'; doc.addEventListener = () => {};
  const win = { document: doc }; win.window = win;
  vm.runInNewContext(read('data/testimonials.js'), win, { filename: 'data/testimonials.js' });
  vm.runInNewContext(read('client-voices.js'), win, { filename: 'client-voices.js' });
  assert(win.FM_TESTIMONIALS && win.FMClientVoices, 'globals');
  assert('hidden' in section.attrs, 'section became visible with no approved testimonial');
});

// ------------------------------------------------------------------ pages
for (const [page, lang] of Object.entries(PAGES)) {
  const html = read(page);
  const prefix = page.startsWith('ro/') ? '../' : '';
  check(`${page}: one hidden skeleton, placed between Practice and Materials, no hard-coded quote`, () => {
    const m = html.match(/<section class="client-voices[^>]*>/g) || [];
    assert(m.length === 1, m.length + ' skeletons');
    assert(m[0].includes('data-client-voices') && m[0].includes(`data-lang="${lang}"`) && /\bhidden\b/.test(m[0]), 'attributes: ' + m[0]);
    const i = html.indexOf(m[0]);
    assert(html.indexOf('id="cases" data-practice') < i && i < html.indexOf('id="knowledge"'), 'placement');
    const inner = html.slice(i, html.indexOf('</section>', i));
    assert(!/<blockquote|<figure/.test(inner), 'quote markup hard-coded in HTML');
    assert(/data-client-voices-list><\/div>/.test(inner), 'list container must ship empty');
  });
  check(`${page}: loads data/testimonials.js then client-voices.js before main.js`, () => {
    const a = html.indexOf(`<script src="${prefix}data/testimonials.js"></script>`);
    const b = html.indexOf(`<script src="${prefix}client-voices.js"></script>`);
    const c = html.indexOf(`<script src="${prefix}main.js"></script>`);
    assert(a !== -1 && b !== -1 && c !== -1 && a < b && b < c, 'order a=' + a + ' b=' + b + ' c=' + c);
  });
}

check('no public page references the design mock', () => {
  const walk = (dir, out = []) => { for (const n of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, n.name); if (n.isDirectory()) { if (!/^(\.git|qa|qa-artifacts|qa-evidence|docs|node_modules|db|n8n|app|app-premium|gateway|scripts)$/.test(n.name)) walk(p, out); } else if (/\.(html|js)$/.test(n.name)) out.push(p); } return out; };
  // A load reference (script src, import, require) — not a prose mention inside a comment.
  const hits = walk(ROOT).filter((p) => /(src=|import\b|require\().*client-voices\.mock|MOCK_TESTIMONIALS/.test(readFileSync(p, 'utf8')));
  assert(hits.length === 0, 'mock referenced by: ' + hits.join(', '));
});

check('the design mock is marked non-public and every mock entry is flagged preview', () => {
  const src = read('qa/fixtures/client-voices.mock.mjs');
  assert(/NOT PUBLIC/.test(src) && /preview: true/.test(src), 'marking');
  assert(!/id: '(?!mock-)/.test(src), 'mock ids must start with mock-');
});

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error('\n' + failures.join('\n')); process.exit(1); }
