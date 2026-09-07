#!/usr/bin/env node
// FINMENTOR — real rendered visual evidence for the release candidate.
//
//   node qa/visual-evidence.mjs
//   node qa/visual-evidence.mjs --keep <dir>     also write the retained screenshots into <dir>
//
// Drives the locally installed Chrome over the DevTools protocol. No Playwright, no Puppeteer, no
// npm install — Node's built-in WebSocket speaks CDP directly, so this runs on a clean checkout.
//
// WHY THIS EXISTS. Source metrics cannot see a wrapped heading, a clipped price or a CTA that
// leaves the viewport. The terminology pass lengthened many customer strings — «Управленческий
// отчёт о прибыли и убытках» is more than twice the width of «P&L», and `Sistem de management
// financiar al activelor imobiliare` is four times the width of `Real Estate Control System` —
// and a 390px phone is where that shows up first. This renders the real pages at the two widths
// the release cares about and MEASURES them, then keeps the screenshots as evidence.
//
// WHAT IT ASSERTS, and why each one is a real customer defect rather than a taste:
//
//   * horizontal overflow — the page scrolls sideways on a phone;
//   * VISIBLE TEXT OUTSIDE THE VIEWPORT — any element that paints a sentence must paint it left
//                          of the right edge and right of the left edge, not only the CTAs;
//   * clipped text       — an element's content is taller or wider than the box drawing it, or it
//                          reaches past an ancestor that hides its overflow, so a customer reads
//                          half a sentence;
//   * zero-height text   — an element with text and no painted box: the string is in the DOM and
//                          on nobody's screen;
//   * CTA overflow       — a button's text spills outside its own border, or the button leaves
//                          the viewport;
//   * package titles     — the pricing cards' names render on one line, unbroken;
//   * the 390px HEADER   — one navigation, not two; nothing clipped, nothing overlapping;
//   * RU/RO parity       — the two language editions of the same page render the same structure.
//
// AND WHAT IT REFUSES TO CERTIFY FROM A SHELL. The Mini App and the customer X-Ray result are
// screenshotted in POPULATED states — a brief mid-answer, the review memo, the success screen and
// the promoted analysis — driven through the app's own API off the local fixtures the golden
// render gate already holds. Nothing here contacts a production service: the Gateway is answered
// by a stub inside the page, and every endpoint points at `preview.invalid`.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { RESULT_FIXTURES } from './fixtures/client-result-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 8099;
const ORIGIN = 'http://127.0.0.1:' + PORT;

const keepIdx = process.argv.indexOf('--keep');
const KEEP_DIR = keepIdx !== -1 ? process.argv[keepIdx + 1] : null;
const SHOT_DIR = join(ROOT, 'qa-artifacts', 'visual');
mkdirSync(SHOT_DIR, { recursive: true });
if (KEEP_DIR) { mkdirSync(KEEP_DIR, { recursive: true }); }

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA.replace(/\\/g, '/') + '/Google/Chrome/Application/chrome.exe' : '',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find((p) => p && existsSync(p));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };

// ── a static server for the site under test ──────────────────────────────────────────────────
//
// file:// would work for most of these pages and would silently change the ones that matter:
// module scripts, the consent-aware analytics loader and anything reading `location.origin` all
// behave differently off an origin. The evidence has to come from the page as it is served.
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) { p += 'index.html'; }
  const abs = normalize(join(ROOT, p));
  if (!abs.startsWith(normalize(ROOT)) || !existsSync(abs)) { res.writeHead(404); res.end('not found'); return; }
  try {
    const body = readFileSync(abs);
    res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});

// ── the smallest CDP client that can do this job ─────────────────────────────────────────────
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      events.get(msg.method).forEach((fn) => fn(msg.params));
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('could not connect to Chrome')));
  });
  return {
    ready,
    on(method, fn) { if (!events.has(method)) { events.set(method, []); } events.get(method).push(fn); },
    send(method, params) {
      const n = ++id;
      return new Promise((resolve, reject) => {
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params: params || {} }));
      });
    },
    close() { ws.close(); }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url) {
  const res = await fetch(url);
  return res.json();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// DETERMINISTIC CAPTURE
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Half-painted logos and headings in earlier runs were not a layout defect — they were the shot
// arriving before the page had finished becoming itself. Four things had to be pinned:
//
//   1. ANIMATION. Every transition, animation, smooth scroll and reveal is switched off by a
//      stylesheet injected before the document runs, so a capture never lands mid-tween.
//   2. FONTS. `document.fonts.ready` alone resolves while faces are still pending; the loop below
//      waits for it AND for `document.fonts.status === 'loaded'` with no face left in 'loading'.
//      (Chrome is started with external hosts blackholed, so the webfont requests fail fast and
//      the fallback stack is what paints — deterministically, on every run.)
//   3. LAYOUT. A signature of the document's own geometry is sampled until two consecutive reads
//      agree, so lazy images and late scripts cannot move the page under the shot.
//   4. PAINT. Two animation frames after the last layout, and then the target heading/logo is
//      required to have non-zero painted bounds before the screenshot is taken at all.
const QA_DETERMINISM_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important; animation-delay: 0s !important;
    animation-iteration-count: 1 !important; animation-play-state: paused !important;
    transition-duration: 0s !important; transition-delay: 0s !important;
  }
  html, body, * { scroll-behavior: auto !important; }
  .reveal, [data-reveal-delay] { opacity: 1 !important; transform: none !important; }
`;

// Run in the page, before anything else on it.
const DETERMINISM_BOOTSTRAP = `(() => {
  try {
    const style = document.createElement('style');
    style.id = '__fm_qa_determinism';
    style.textContent = ${JSON.stringify(QA_DETERMINISM_CSS)};
    const put = () => (document.head || document.documentElement).appendChild(style);
    if (document.head) { put(); } else { document.addEventListener('readystatechange', put, { once: true }); }
    // A page that scrolls itself smoothly during capture is a page that moves under the shot.
    const raw = window.scrollTo.bind(window);
    window.scrollTo = function (a, b) {
      if (a && typeof a === 'object') { return raw({ top: a.top || 0, left: a.left || 0, behavior: 'auto' }); }
      return raw(a, b);
    };
  } catch (e) { /* a page that will not take the stylesheet is measured as it is */ }
})();`;

// Waits for fonts, then for layout to stop moving, then for two painted frames. Returns a report
// so the run can ASSERT determinism rather than assume it.
const SETTLE = `(async () => {
  const report = { fontsReady: false, fontStatus: '', pendingFaces: [], layoutSamples: 0, stable: false, frames: 0 };
  try {
    if (document.fonts) {
      await document.fonts.ready;
      report.fontsReady = true;
      for (let i = 0; i < 40 && document.fonts.status !== 'loaded'; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      report.fontStatus = document.fonts.status;
      document.fonts.forEach((f) => { if (f.status === 'loading') { report.pendingFaces.push(f.family + ' ' + f.weight); } });
    } else {
      report.fontsReady = true; report.fontStatus = 'unsupported';
    }
  } catch (e) { report.fontStatus = 'error:' + e.message; }

  const signature = () => {
    const de = document.documentElement, b = document.body;
    const parts = [de.scrollWidth, de.scrollHeight, de.clientWidth, de.clientHeight,
      b ? b.scrollHeight : 0, document.querySelectorAll('*').length, Math.round(window.scrollY)];
    for (const sel of ['h1', 'header', '.doc-bar', '.logo', '.brand', '.packages', 'main']) {
      const el = document.querySelector(sel);
      if (!el) { parts.push(-1); continue; }
      const r = el.getBoundingClientRect();
      parts.push(Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height));
    }
    return parts.join(',');
  };
  let last = null, agreed = 0;
  for (let i = 0; i < 60 && agreed < 2; i++) {
    const s = signature();
    report.layoutSamples++;
    agreed = (s === last) ? agreed + 1 : 0;
    last = s;
    if (agreed < 2) { await new Promise((r) => setTimeout(r, 100)); }
  }
  report.stable = agreed >= 2;

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  report.frames = 2;
  return report;
})()`;

// The heading/logo the shot is FOR. If this has no painted box, the page is not ready and the
// screenshot would be evidence of nothing.
const PAINTED = `(() => {
  const out = { anchors: [], missing: [] };
  const wanted = ['h1', '.logo', '.brand', '.topbar .brand', '.hero__title', '.doc-bar .logo'];
  let found = 0;
  for (const sel of wanted) {
    const el = document.querySelector(sel);
    if (!el) { continue; }
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') { continue; }
    const r = el.getBoundingClientRect();
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    const entry = { sel, text, w: Math.round(r.width), h: Math.round(r.height) };
    if (r.width > 0 && r.height > 0) { found++; out.anchors.push(entry); } else { out.missing.push(entry); }
  }
  out.ok = found > 0;
  return out;
})()`;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE MEASUREMENT, run inside the page
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Everything is read from the RENDERED box model. A rule that fires on a source string would be
// the same blind spot this file exists to close.
//
// The text sweep covers EVERY element that paints its own sentence — not a hand-picked list of
// tags and not only the CTAs. An element qualifies when it owns a direct, non-whitespace text
// node; that is exactly the set a customer reads.
const MEASURE = `(() => {
  const vw = window.innerWidth;
  const TOL = 2;
  const out = { width: vw, overflow: null, clipped: [], ctaOverflow: [], offscreen: [], textOutside: [],
    textZeroBox: [], packageTitles: [], header: null, h1: null, lang: document.documentElement.lang,
    textElements: 0, scrollContainers: [] };
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) { out.overflow = { scrollWidth: de.scrollWidth, viewport: vw }; }

  const cs = (el) => getComputedStyle(el);
  // RENDERED, not "its own computed style looks fine". getComputedStyle(el).display is the
  // element's OWN value: a link inside a display:none desktop nav still reports 'block', and a
  // closed <details> still hands out a box for its body. Reading those as painted turned the
  // whole hidden mobile navigation and every collapsed FAQ answer into findings. checkVisibility
  // answers the question actually being asked — is this on the customer's screen — and covers
  // ancestor display, visibility, opacity and content-visibility in one call.
  const rendered = (el) => (el.checkVisibility
    ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })
    : el.getClientRects().length > 0);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return rendered(el) && r.width > 0 && r.height > 0;
  };
  const label = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70);

  // ── what is allowed to sit outside a box, and why ──────────────────────────────────────────
  //
  // Two categories, both DECLARED rather than inferred, because "it scrolls on purpose" and "it
  // is broken" look identical to a box-model reading:
  //
  //   * INTENTIONAL SCROLL CONTAINERS — a box whose job is to scroll its own content. Its
  //     children are measured against its SCROLL box, not its client box.
  //   * DELIBERATELY OFF-SCREEN — skip links and screen-reader-only text, which are supposed to
  //     be outside the viewport until focused.
  const SCROLL_OK = '[data-qa-scroll], .mobile-menu, .fa-panel, .fa-body, .table-scroll, .scroller, .marquee, .sysmap__track';
  const OFFSCREEN_OK = '.skip-link, .skip, .visually-hidden, .sr-only, [data-qa-offscreen]';
  const intentionalScroll = (el) => !!(el.closest && el.closest(SCROLL_OK));
  const intentionalOffscreen = (el) => !!(el.closest && el.closest(OFFSCREEN_OK));
  // A 1x1 clipped box is the classic screen-reader idiom even without a class name on it.
  const srOnlyBox = (el) => { const r = el.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; };

  for (const el of document.querySelectorAll(SCROLL_OK)) {
    if (visible(el)) { out.scrollContainers.push({ cls: String(el.className || el.tagName), sw: el.scrollWidth, cw: el.clientWidth }); }
  }

  // The nearest ancestor (self included) that HIDES overflow. That box is the element's available
  // space; anything painted past it is a sentence the customer reads half of.
  const clipper = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const s = cs(n);
      const hides = (a) => a === 'hidden' || a === 'clip';
      if ((hides(s.overflowX) || hides(s.overflowY)) && !intentionalScroll(n)) { return n; }
      n = n.parentElement;
    }
    return null;
  };

  // ── THE TEXT SWEEP ─────────────────────────────────────────────────────────────────────────
  const ownsText = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) { return true; }
    }
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    if (!ownsText(el)) { continue; }
    if (!rendered(el)) { continue; }
    const s = cs(el);
    if (el.closest('[hidden]') || el.closest('[aria-hidden="true"]')) { continue; }
    if (intentionalOffscreen(el)) { continue; }
    const r = el.getBoundingClientRect();

    // ZERO-HEIGHT TEXT — the string is in the DOM and on nobody's screen.
    if (r.height <= 0 || r.width <= 0) {
      if (!srOnlyBox(el) || (r.height === 0 && r.width === 0)) {
        out.textZeroBox.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), text: label(el) });
      }
      continue;
    }
    if (srOnlyBox(el)) { continue; }
    out.textElements++;

    // VISIBLE TEXT OUTSIDE THE VIEWPORT.
    if (r.left < -TOL || r.right > vw + TOL) {
      out.textOutside.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), text: label(el),
        left: Math.round(r.left), right: Math.round(r.right), vw });
      continue;
    }

    // CLIPPED TEXT — by the element's own hidden overflow, or by an ancestor's.
    if (!intentionalScroll(el) && s.textOverflow !== 'ellipsis') {
      const hides = (a) => a === 'hidden' || a === 'clip';
      if ((hides(s.overflowX) || hides(s.overflowY)) &&
          (el.scrollHeight > el.clientHeight + TOL || el.scrollWidth > el.clientWidth + TOL)) {
        out.clipped.push({ tag: el.tagName, text: label(el), by: 'self',
          sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
        continue;
      }
      const box = clipper(el.parentElement);
      if (box && box !== el) {
        const b = box.getBoundingClientRect();
        // The clipping edge is the PADDING box, which is what a rect gives for a box with no
        // border; the border width is added back so a bordered card is not read as clipping its
        // own content by its own frame.
        const bs = cs(box);
        const pad = (v) => parseFloat(v) || 0;
        const bl = b.left + pad(bs.borderLeftWidth), br = b.right - pad(bs.borderRightWidth);
        const bt = b.top + pad(bs.borderTopWidth), bb = b.bottom - pad(bs.borderBottomWidth);
        if (r.right > br + TOL || r.left < bl - TOL || r.bottom > bb + TOL || r.top < bt - TOL) {
          out.clipped.push({ tag: el.tagName, text: label(el), by: 'ancestor',
            box: String(box.className || box.tagName).slice(0, 40),
            r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
            b: [Math.round(bl), Math.round(bt), Math.round(br), Math.round(bb)] });
        }
      }
    }
  }

  // CTA OVERFLOW. The button's own text wider than the button, or the button outside the viewport.
  for (const el of document.querySelectorAll('a.btn, button.btn, .btn, [data-ga^="click_"]')) {
    if (!visible(el)) { continue; }
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) { out.offscreen.push({ text: label(el), left: Math.round(r.left), right: Math.round(r.right) }); }
    if (el.scrollWidth > el.clientWidth + 2) { out.ctaOverflow.push({ text: label(el), sw: el.scrollWidth, cw: el.clientWidth }); }
  }

  // ── THE HEADER, measured as a customer meets it ────────────────────────────────────────────
  //
  // At 390px there must be ONE navigation. The defect this closes shipped as a second, unstyled
  // desktop nav painted beside the burger on the thank-you pages: no rule matched its class name,
  // so it never went away, and it pushed the language buttons over the logo.
  {
    const bar = document.querySelector('header.doc-bar, header.header, header');
    if (bar) {
      const barRect = bar.getBoundingClientRect();
      const h = { present: true, rect: [Math.round(barRect.left), Math.round(barRect.top), Math.round(barRect.right), Math.round(barRect.bottom)],
        navs: [], logo: null, burger: null, langGroups: [], overlaps: [], outside: [] };
      for (const nav of bar.querySelectorAll('nav')) {
        if (!visible(nav)) { continue; }
        const r = nav.getBoundingClientRect();
        h.navs.push({ cls: String(nav.className || '(no class)'), links: nav.querySelectorAll('a').length,
          w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) });
      }
      const logo = bar.querySelector('.logo, .brand');
      if (logo && visible(logo)) {
        const r = logo.getBoundingClientRect();
        h.logo = { text: label(logo), w: Math.round(r.width), h: Math.round(r.height),
          left: Math.round(r.left), right: Math.round(r.right),
          clipped: logo.scrollWidth > logo.clientWidth + 2 || logo.scrollHeight > logo.clientHeight + 2 };
      }
      const home = bar.querySelector('.q-back, .doc-back, a[href$="index.html"], a[href="/"], a[href="../"]');
      h.homeLink = home && visible(home) ? label(home) : null;
      const burger = bar.querySelector('.burger, #burger');
      if (burger && visible(burger)) {
        const r = burger.getBoundingClientRect();
        h.burger = { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
      }
      for (const lg of bar.querySelectorAll('.lang')) {
        if (!visible(lg)) { continue; }
        const r = lg.getBoundingClientRect();
        h.langGroups.push({ w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right) });
      }
      // Pairwise overlap of the bar's own controls. Two of these sharing pixels is a collision a
      // customer taps the wrong half of.
      const controls = [...bar.querySelectorAll('.logo, .brand, .burger, #burger, .lang, nav, .btn')]
        .filter((el) => visible(el) && !el.closest('.lang, nav') || el.matches('.lang, nav'))
        .filter(visible);
      const seen = [];
      for (const el of controls) {
        // A control nested inside another control is not a collision with its own parent.
        if (seen.some((s) => s.el.contains(el) || el.contains(s.el))) { seen.push({ el, r: el.getBoundingClientRect() }); continue; }
        const r = el.getBoundingClientRect();
        for (const s of seen) {
          if (s.el.contains(el) || el.contains(s.el)) { continue; }
          const o = Math.min(r.right, s.r.right) - Math.max(r.left, s.r.left);
          const ov = Math.min(r.bottom, s.r.bottom) - Math.max(r.top, s.r.top);
          if (o > 1 && ov > 1) {
            h.overlaps.push({ a: String(el.className || el.tagName).slice(0, 30), b: String(s.el.className || s.el.tagName).slice(0, 30), x: Math.round(o), y: Math.round(ov) });
          }
        }
        seen.push({ el, r });
        if (r.left < -TOL || r.right > vw + TOL) {
          h.outside.push({ cls: String(el.className || el.tagName).slice(0, 30), left: Math.round(r.left), right: Math.round(r.right) });
        }
      }
      out.header = h;
    } else {
      out.header = { present: false };
    }
  }

  // PACKAGE TITLES. The pricing cards are where a renamed product breaks a layout first.
  for (const el of document.querySelectorAll('.package__name, .package__price, .package__goal')) {
    if (!visible(el)) { continue; }
    const r = el.getBoundingClientRect();
    out.packageTitles.push({ cls: el.className, text: label(el), w: Math.round(r.width), h: Math.round(r.height), lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight || '20')) });
  }

  // THE NAVY/GOLD CONTRACT, read off the rendered pixels rather than off the stylesheet. A token
  // that is defined but overridden, or a CTA that lost its accent to a cascade change, is exactly
  // what a source check cannot see.
  // Colours come back from getComputedStyle as rgb()/rgba(). The alpha is kept, because a fully
  // transparent background is the signal that the paint is coming from somewhere else.
  const parseColor = (v) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(v || '');
    if (!m) { return null; }
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const opaque = (c) => c && c.a > 0.05 && isFinite(c.r);
  out.brand = { rootBg: null, primaryCta: null };
  {
    // A page paints its ground on <body> or on <html>; whichever is opaque is the one a customer
    // sees.
    for (const el of [document.body, document.documentElement]) {
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (opaque(c)) { out.brand.rootBg = [c.r, c.g, c.b]; break; }
    }
    const cta = [...document.querySelectorAll('.btn--primary')].find(visible);
    if (cta) {
      // The gold is painted by a GRADIENT. backgroundColor is then rgba(0,0,0,0), and a check that
      // reads only that reports "not gold" for a button every screenshot shows as gold. The
      // gradient's own stops are averaged instead.
      const cs2 = getComputedStyle(cta);
      const flat = parseColor(cs2.backgroundColor);
      let bg = opaque(flat) ? [flat.r, flat.g, flat.b] : null;
      let src = 'color';
      if (!bg) {
        const stops = [...(cs2.backgroundImage || '').matchAll(/rgba?\\(([^)]+)\\)/g)]
          .map((m) => m[1].split(',').map((n) => parseFloat(n)))
          .filter((p) => p.length < 4 || p[3] > 0.05);
        if (stops.length) {
          bg = [0, 1, 2].map((i) => Math.round(stops.reduce((a, c) => a + c[i], 0) / stops.length));
          src = 'gradient';
        }
      }
      out.brand.primaryCta = { bg: bg, text: label(cta), src: src };
    }
  }

  const h1 = document.querySelector('h1');
  if (h1) { const r = h1.getBoundingClientRect(); out.h1 = { text: label(h1), w: Math.round(r.width), h: Math.round(r.height) }; }
  return out;
})()`;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// MINI APP AND X-RAY — REAL CUSTOMER STATES, OFF LOCAL FIXTURES
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// The Mini App is not certified from its offline error shell. Each scenario below answers the
// Gateway INSIDE the page with a fixture, so the real net.js parses it, the real app.js hydrates
// from it and the real screens render. `preview.invalid` never resolves; nothing leaves the box.
const SESSION_ID = 'AS-' + 'a'.repeat(64);
const HOUR = 3600 * 1000;
const iso = (delta) => new Date(Date.now() + delta).toISOString();

// A resumed brief the customer already started, in the shape net.js shape-checks.
const RESUMED_DRAFT = {
  v: 1,
  step: 'APP_PROBLEM',
  fields: {
    company_name: { value: 'Alfa Grup', source: 'user_explicit', confirmed: true, at: iso(-2 * HOUR) },
    business_activity: { value: 'Сеть продовольственных магазинов, 6 точек', source: 'user_explicit', confirmed: true, at: iso(-2 * HOUR) },
    role: { value: 'Собственник', source: 'user_explicit', confirmed: true, at: iso(-2 * HOUR) },
    contact_name: { value: 'Ghennadi', source: 'telegram_carried', confirmed: true, at: iso(-2 * HOUR) },
    contact_channel: { value: 'telegram', source: 'user_explicit', confirmed: true, at: iso(-HOUR) }
  }
};

const bootstrapBody = (over) => Object.assign({
  ok: true, app_session_id: SESSION_ID, expires_at: iso(48 * HOUR), locale: 'ru',
  state: 'draft', resumed: false, draft: null
}, over || {});

// The seed runs in the page AFTER bootstrap has settled. It uses the app's own `set()` and
// `goto()` — a harness that wrote `state` directly would be screenshotting a screen the app can
// never actually reach.
const SEED_BRIEF = `(() => {
  const C = window.FM_CONTENT, A = window.FM_APP;
  if (!C || !A) { return { ok: false, why: 'the app did not boot' }; }
  const obj = C.OBJECTIVES.find((o) => o.id === 'cash_flow') || C.OBJECTIVES[0];
  const problems = C.PROBLEMS[obj.id], outcomes = C.OUTCOMES[obj.id];
  A.set('company_name', 'Alfa Grup', 'user_explicit', true);
  A.set('business_activity', 'Сеть продовольственных магазинов, 6 точек', 'user_explicit', true);
  A.set('role', 'Собственник', 'user_explicit', true);
  A.set('turnover_band', C.SCALE_OPTIONS[2], 'user_explicit', true);
  // The draft stores the objective LABEL, not its id — objective() resolves by label, and the
  // question screens dereference C.PROBLEMS[o.id] from what that lookup returns.
  A.set('objective', obj.label, 'user_explicit', true);
  A.set('problem', problems.options[0][0], 'user_explicit', true);
  A.set('desired_outcome', outcomes.options[0][0], 'user_explicit', true);
  A.set('current_setup', [C.CURRENT_SETUP.options[0], C.CURRENT_SETUP.options[2]], 'user_explicit', true);
  A.set('decision_horizon', C.DECISION_HORIZON.options[1][0], 'user_explicit', true);
  A.set('documents', [C.DOCUMENTS.options[0], C.DOCUMENTS.options[1]], 'user_explicit', true);
  A.set('contact_channel', 'telegram', 'user_explicit', true);
  A.set('contact_value', '@ghennadi', 'telegram_carried', true);
  A.set('contact_name', 'Ghennadi', 'telegram_carried', true);
  A.set('important_context', 'Через месяц переговоры с банком по кредитной линии; нужен понятный прогноз денежного потока.', 'user_explicit', true);
  return { ok: true, objective: obj.id };
})()`;

const gotoScreen = (screen) => `(() => {
  if (!window.FM_APP) { return { ok: false, why: 'the app did not boot' }; }
  window.FM_APP.goto('${screen}');
  return { ok: true, state: window.FM_APP.current() };
})()`;

// The stub the Mini App surfaces are opened behind.
function miniappSeed(bootstrap) {
  return `(() => {
    const REAL = ${JSON.stringify(bootstrap)};
    const EP = { gateway: 'https://preview.invalid/webhook/finmentor-miniapp-gateway',
      session: 'https://preview.invalid/webhook/finmentor-miniapp-session',
      submit:  'https://preview.invalid/webhook/finmentor-miniapp-submit' };
    // index.html sets FM_ENDPOINTS to build placeholders inline; the app reads that as OFFLINE.
    // A plain assignment here would be overwritten by that inline script, so the property refuses
    // to be reassigned instead.
    try {
      Object.defineProperty(window, 'FM_ENDPOINTS', { get: () => EP, set: () => {}, configurable: true });
    } catch (e) { window.FM_ENDPOINTS = EP; }
    window.Telegram = window.Telegram || {};
    window.Telegram.WebApp = {
      initData: 'user=%7B%22id%22%3A551662084%2C%22first_name%22%3A%22Ghennadi%22%7D&auth_date=1788000000&signature=x&hash=y',
      initDataUnsafe: { user: { id: 551662084, first_name: 'Ghennadi', language_code: 'ru' } },
      ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, close() {}
    };
    const real = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (url, init) {
      const u = String(url);
      const answer = (body) => Promise.resolve({ status: 200, ok: true,
        text: () => Promise.resolve(JSON.stringify(body)), json: () => Promise.resolve(body) });
      if (u.indexOf('miniapp-gateway') !== -1) { return answer(REAL); }
      if (u.indexOf('preview.invalid') !== -1) { return answer({ ok: true }); }
      return real ? real(url, init) : answer({ ok: true });
    };
  })();`;
}

// ── the surfaces the release cares about ─────────────────────────────────────────────────────
//
// `seed` is injected before the document; `after` runs once the app has settled. Together they
// produce a POPULATED customer state rather than a shell.
const SURFACES = [
  { id: 'ru-homepage', url: '/index.html', widths: [390, 1440] },
  { id: 'ro-homepage', url: '/ro/index.html', widths: [390, 1440] },
  { id: 'ru-questionnaire', url: '/questionnaire.html', widths: [390, 1440] },
  { id: 'ro-questionnaire', url: '/ro/questionnaire.html', widths: [390, 1440] },
  { id: 'ru-packages', url: '/index.html', widths: [390, 1440], anchor: '.packages' },
  { id: 'ro-packages', url: '/ro/index.html', widths: [390, 1440], anchor: '.packages' },
  { id: 'ru-monthly-pricing', url: '/monthly-cfo-support.html', widths: [390, 1440] },
  { id: 'ro-monthly-pricing', url: '/ro/monthly-cfo-support.html', widths: [390, 1440] },
  { id: 'ru-real-estate', url: '/real-estate-control-system.html', widths: [390, 1440] },
  { id: 'ro-real-estate', url: '/ro/real-estate-control-system.html', widths: [390, 1440] },
  { id: 'thank-you', url: '/thank-you.html', widths: [390, 1440] },
  { id: 'ro-thank-you', url: '/ro/thank-you.html', widths: [390, 1440] },

  // The legacy B.2.0 prototype, still served from the site root.
  { id: 'miniapp-start', url: '/app/index.html', widths: [390, 1440] },

  // ── the premium Mini App, in the states a customer actually meets ─────────────────────────
  { id: 'miniapp-entry', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody()) },
  { id: 'miniapp-populated', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [SEED_BRIEF, gotoScreen('APP_PROBLEM')] },
  { id: 'miniapp-review', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [SEED_BRIEF, gotoScreen('APP_REVIEW')] },
  { id: 'miniapp-edit', url: '/app-premium/index.html', widths: [390],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [SEED_BRIEF, gotoScreen('APP_EDIT_SELECTOR')] },
  { id: 'miniapp-success', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ state: 'submitted', resumed: true, draft: RESUMED_DRAFT })) },
  { id: 'miniapp-expired', url: '/app-premium/index.html', widths: [390],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [gotoScreen('APP_SESSION_EXPIRED')] },
  { id: 'miniapp-boot-failure', url: '/app-premium/index.html', widths: [390],
    seed: miniappSeed({ ok: false, error_code: 'GATEWAY_UNAVAILABLE', retryable: true }) },

  // ── the customer X-Ray result, promoted to CLIENT_READY ───────────────────────────────────
  { id: 'xray-result-ru', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ state: 'submitted', resumed: true, draft: RESUMED_DRAFT,
      result: RESULT_FIXTURES['ru-score'] })) },
  { id: 'xray-result-ro', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ state: 'submitted', resumed: true, locale: 'ro', draft: RESUMED_DRAFT,
      result: RESULT_FIXTURES['ro-score'] })) }
];

// Surfaces that are a Mini App WebView, not a site page: no site header, no language gate, and
// no navy/gold site chrome contract to read off the body.
const MINIAPP = (id) => /^(miniapp|xray)/.test(id);

const results = {};
const settleReports = {};
// The text a customer actually reads on each surface, so a populated state can be asserted as
// populated rather than merely rendered.
const renderedText = {};

(async () => {
  if (!CHROME) {
    console.error('VISUAL EVIDENCE: BLOCKED — no Chrome binary found. Looked in Program Files and LOCALAPPDATA.');
    process.exit(2);
  }
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('FINMENTOR visual evidence');
  console.log('  chrome : ' + CHROME);
  console.log('  serving: ' + ROOT);
  console.log('');

  const profile = join(ROOT, 'qa-artifacts', 'chrome-profile');
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9222', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--disable-lcd-text', '--font-render-hinting=none',
    '--disable-extensions', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    await sleep(250);
    try { targets = await httpJson('http://127.0.0.1:9222/json/list'); } catch (e) { /* not up yet */ }
  }
  if (!targets) { console.error('VISUAL EVIDENCE: BLOCKED — Chrome did not open a debugging port'); process.exit(2); }

  const version = await httpJson('http://127.0.0.1:9222/json/version');
  console.log('  ' + version['Browser'] + '\n');

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const c = cdp(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Runtime.enable');

  const evaluate = async (expression, awaitPromise) => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) {
      throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    }
    return r.result.value;
  };

  for (const s of SURFACES) {
    for (const w of s.widths) {
      const height = w === 390 ? 844 : 900;
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: w, height, deviceScaleFactor: 1, mobile: w === 390,
        screenWidth: w, screenHeight: height
      });
      // Two shells stand between a fresh browser and the page a customer reads, and both must be
      // satisfied BEFORE the document runs or the evidence is a picture of the shell:
      //
      //   * the Telegram bridge, which the Mini App asks for before it renders anything;
      //   * the LANGUAGE GATE. `/index.html` shows a full-screen ROMÂNĂ / РУССКИЙ chooser until
      //     `localStorage.finmentor_language` is set. Without it every Russian screenshot in this
      //     run was the chooser — identical bytes for the home page and the packages section,
      //     which looked like evidence and showed nothing.
      //
      // The determinism bootstrap goes first, so the animation kill switch is in place before the
      // first frame rather than after it.
      const seedLang = s.url.startsWith('/ro/') ? 'ro' : 'ru';
      await c.send('Page.addScriptToEvaluateOnNewDocument', {
        source: DETERMINISM_BOOTSTRAP
          + (s.seed || 'window.Telegram=window.Telegram||{};window.Telegram.WebApp=window.Telegram.WebApp||{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},initData:"",initDataUnsafe:{},themeParams:{},MainButton:{show(){},hide(){},setText(){},onClick(){}},BackButton:{show(){},hide(){},onClick(){}}};')
          + 'try{localStorage.setItem("finmentor_language","' + seedLang + '");}catch(e){}'
      });

      await c.send('Page.navigate', { url: ORIGIN + s.url });
      await sleep(500);
      // The site opens with an animated intro overlay and reveal-on-scroll sections. Evidence has
      // to be of the page a customer reads, not of its first frame. (The determinism stylesheet
      // has already frozen the animations; this removes the overlays they were driving.)
      await evaluate(`(() => {
        document.documentElement.classList.add('intro-skip');
        for (const sel of ['#intro', '.intro', '.intro-overlay', '#cookieBar', '.cookie-bar']) {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible', 'revealed', 'in-view'));
        window.scrollTo(0, 0);
      })()`);

      // Drive the surface into the customer state it is evidence OF.
      if (s.after) {
        // The app boots through one asynchronous bootstrap; the seed cannot run before it lands.
        await evaluate(`(async () => {
          for (let i = 0; i < 100; i++) {
            if (window.FM_APP && window.FM_APP.current && window.FM_APP.current() !== 'APP_STARTING') { return window.FM_APP.current(); }
            await new Promise((r) => setTimeout(r, 50));
          }
          return window.FM_APP ? window.FM_APP.current() : 'no-app';
        })()`, true);
        for (const step of s.after) {
          const r = await evaluate(step);
          if (r && r.ok === false) { throw new Error(s.id + '@' + w + ': ' + r.why); }
        }
      }

      if (s.anchor) {
        // Scrolled AFTER the reveal pass: before it, the section is collapsed and the shot lands
        // on the hero instead of the surface under test.
        const found = await evaluate(`(() => { const el = document.querySelector('${s.anchor}'); if (!el) { return false; } el.scrollIntoView({ block: 'start' }); return true; })()`);
        if (!found) { throw new Error(s.id + ': the anchor ' + s.anchor + ' is not on the page'); }
        // PROVE THE SCROLL LANDED, and force it if it did not. `scroll-behavior: smooth` plus the
        // site's own scroll handling swallowed scrollIntoView on the Russian home page: the shot
        // came out byte-identical to the hero and looked like evidence while showing nothing.
        const jump = `(() => {
          const el = document.querySelector('${s.anchor}');
          const y = el.getBoundingClientRect().top + window.scrollY;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, y);
          return { y: Math.round(window.scrollY), top: Math.round(el.getBoundingClientRect().top) };
        })()`;
        let at = await evaluate(jump);
        if (Math.abs(at.top) > 120) { at = await evaluate(jump); }
        if (at.y < 100) { throw new Error(s.id + ': the page never scrolled to ' + s.anchor + ' (scrollY ' + at.y + ')'); }
      }

      // The consent bar is re-created by the analytics loader after the first paint. It is a real
      // part of the page and has its own gate; here it would simply cover the surface under test,
      // so it is removed last, before the settle.
      await evaluate(`document.querySelectorAll('#cookieBar,.cookie-bar,[id*="cookie"],[class*="cookie"]').forEach((el) => el.remove())`);

      // ── DETERMINISM GATE. Fonts, then layout, then two painted frames, then a painted anchor.
      const settled = await evaluate(SETTLE, true);
      const painted = await evaluate(PAINTED);
      settleReports[s.id + '@' + w] = { settle: settled, painted };

      const m = await evaluate(MEASURE);
      m.miniapp = MINIAPP(s.id);
      results[s.id + '@' + w] = m;
      // textContent, NOT innerText: the kickers and section labels are uppercased in CSS, and
      // innerText returns what the transform painted, so a needle in the approved copy would never
      // match the string the page is actually built from.
      renderedText[s.id + '@' + w] = await evaluate(`(() => {
        // Scripts and styles are text nodes too; the Mini App's inline endpoint block would land in
        // the evidence as customer copy. They are dropped from a clone so the page is untouched.
        const c = document.body.cloneNode(true);
        c.querySelectorAll('script,style,template,noscript').forEach((n) => n.remove());
        return (c.textContent || '').replace(/\\s+/g, ' ').trim();
      })()`);

      const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const name = s.id + '-' + w + '.png';
      writeFileSync(join(SHOT_DIR, name), Buffer.from(shot.data, 'base64'));
      process.stdout.write('  rendered ' + (s.id + '@' + w).padEnd(28) + ' ' + name
        + (settled.stable ? '' : '  [LAYOUT NOT STABLE]') + '\n');
    }
  }

  c.close();
  chrome.kill();
  server.close();

  console.log('');
  writeFileSync(join(SHOT_DIR, 'measurements.json'), JSON.stringify(results, null, 2), 'utf8');
  writeFileSync(join(SHOT_DIR, 'capture-determinism.json'), JSON.stringify(settleReports, null, 2), 'utf8');
  // The copy each surface actually painted, kept beside the screenshots: a reviewer can grep the
  // evidence for a string instead of reading twenty PNGs.
  writeFileSync(join(SHOT_DIR, 'rendered-text.json'), JSON.stringify(renderedText, null, 2), 'utf8');

  // ── the assertions ─────────────────────────────────────────────────────────────────────────
  const all = Object.entries(results);
  const site = all.filter(([, r]) => !r.miniapp);

  check('FONT / PAINT INCOMPLETE CAPTURES = 0 — every shot was taken of a settled, painted page', () => {
    const bad = [];
    for (const [k, r] of Object.entries(settleReports)) {
      if (!r.settle.fontsReady) { bad.push(k + ': document.fonts never became ready'); }
      if (r.settle.fontStatus !== 'loaded' && r.settle.fontStatus !== 'unsupported') {
        bad.push(k + ': fonts settled as "' + r.settle.fontStatus + '"');
      }
      if (r.settle.pendingFaces.length) { bad.push(k + ': faces still loading — ' + r.settle.pendingFaces.join(', ')); }
      if (!r.settle.stable) { bad.push(k + ': layout was still moving after ' + r.settle.layoutSamples + ' samples'); }
      if (r.settle.frames < 2) { bad.push(k + ': captured without two painted frames'); }
      if (!r.painted.ok) { bad.push(k + ': no heading or logo had painted bounds'); }
      for (const miss of r.painted.missing) { bad.push(k + ': ' + miss.sel + ' painted 0x0 — "' + miss.text + '"'); }
    }
    assert(bad.length === 0, bad.length + ' capture(s) not deterministic: ' + bad.slice(0, 6).join(' | '));
  });

  check('DOCUMENT HORIZONTAL OVERFLOW = 0 — no page scrolls sideways at 390px or 1440px', () => {
    const bad = all.filter(([, r]) => r.overflow).map(([k, r]) => k + ' (' + r.overflow.scrollWidth + ' > ' + r.overflow.viewport + ')');
    assert(bad.length === 0, bad.length + ' surface(s) overflow: ' + bad.join(', '));
  });

  check('VISIBLE TEXT OUTSIDE VIEWPORT = 0 — every painted sentence is inside the frame', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const t of r.textOutside) {
        bad.push(k + ': <' + t.tag.toLowerCase() + '.' + t.cls + '> ' + t.left + '..' + t.right + ' of ' + t.vw + ' — ' + t.text);
      }
    }
    assert(bad.length === 0, bad.length + ' element(s) outside the viewport: ' + bad.slice(0, 6).join(' | '));
  });

  check('CLIPPED TEXT = 0 — no box hides a sentence it is drawing', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const c2 of r.clipped) {
        bad.push(k + ': <' + c2.tag.toLowerCase() + '> ' + (c2.by === 'self'
          ? '(' + c2.sw + 'x' + c2.sh + ' in ' + c2.cw + 'x' + c2.ch + ')'
          : 'past .' + c2.box) + ' — ' + c2.text);
      }
    }
    assert(bad.length === 0, bad.length + ' clipped element(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('ZERO-HEIGHT TEXT = 0 — no customer string renders with no box', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const t of r.textZeroBox) { bad.push(k + ': <' + t.tag.toLowerCase() + '.' + t.cls + '> ' + t.text); }
    }
    assert(bad.length === 0, bad.length + ' element(s) with text and no painted box: ' + bad.slice(0, 6).join(' | '));
  });

  check('every audited surface actually carried customer text to measure', () => {
    const bad = all.filter(([, r]) => r.textElements < 8).map(([k, r]) => k + ' (' + r.textElements + ')');
    assert(bad.length === 0, 'too few measured text elements — the surface is probably a shell: ' + bad.join(', '));
  });

  check('CTA OVERFLOW = 0 — every call to action fits its button and the viewport', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const c2 of r.ctaOverflow) { bad.push(k + ': text ' + c2.sw + 'px in a ' + c2.cw + 'px button — ' + c2.text); }
      for (const c2 of r.offscreen) { bad.push(k + ': offscreen ' + c2.left + '..' + c2.right + ' — ' + c2.text); }
    }
    assert(bad.length === 0, bad.length + ' CTA problem(s): ' + bad.slice(0, 5).join(' | '));
  });

  check('HEADER COLLISION = 0 — at 390px one navigation, nothing clipped, nothing overlapping', () => {
    const bad = [];
    for (const [k, r] of site) {
      if (!k.endsWith('@390')) { continue; }
      const h = r.header;
      if (!h || !h.present) { bad.push(k + ': no header element'); continue; }
      // COMPETING NAVIGATION. On a phone the bar carries the burger; a second, in-bar nav painted
      // beside it is the defect this closes.
      if (h.navs.length > 0 && h.burger) {
        bad.push(k + ': ' + h.navs.length + ' in-bar nav(s) visible beside the burger — ' + h.navs.map((n) => n.cls).join(', '));
      }
      if (h.navs.length > 1) { bad.push(k + ': ' + h.navs.length + ' competing navigations — ' + h.navs.map((n) => n.cls).join(', ')); }
      if (!h.logo) { bad.push(k + ': the logo is not painted in the header'); }
      else {
        if (h.logo.clipped) { bad.push(k + ': the logo is clipped — "' + h.logo.text + '"'); }
        if (h.logo.left < -2 || h.logo.right > r.width + 2) { bad.push(k + ': the logo sits at ' + h.logo.left + '..' + h.logo.right + ' of ' + r.width); }
      }
      if (h.langGroups.length > 1) { bad.push(k + ': ' + h.langGroups.length + ' language controls painted at once'); }
      for (const o of h.overlaps) { bad.push(k + ': ' + o.a + ' overlaps ' + o.b + ' by ' + o.x + 'x' + o.y + 'px'); }
      for (const o of h.outside) { bad.push(k + ': ' + o.cls + ' leaves the bar at ' + o.left + '..' + o.right); }
      // ESSENTIAL NAVIGATION MUST EXIST — but the funnel pages carry it as a single "back to the
      // home page" link rather than a menu, which is navigation a customer can use, not navigation
      // that has been hidden.
      if (h.navs.length === 0 && !h.burger && !h.homeLink) {
        bad.push(k + ': no navigation at all — neither an in-bar nav, a burger, nor a home link');
      }
    }
    assert(bad.length === 0, bad.length + ' header defect(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('PACKAGE TITLE BREAKAGE = 0 — every package name renders whole', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const t of r.packageTitles) {
        if (!/package__name/.test(t.cls)) { continue; }
        assert(t.text.length > 0, k + ': an empty package name');
        if (t.w < 40 || t.h < 10) { bad.push(k + ': ' + t.text + ' collapsed to ' + t.w + 'x' + t.h); }
      }
    }
    assert(bad.length === 0, bad.join(' | '));
  });

  check('MINI APP POPULATED / REVIEW / SUCCESS = PASS — real states, not the error shell', () => {
    const need = {
      'miniapp-populated': ['Alfa Grup', null],
      'miniapp-review': ['Alfa Grup', 'Confidential brief'],
      'miniapp-success': [null, null]
    };
    const bad = [];
    for (const [id] of Object.entries(need)) {
      for (const w of [390, 1440]) {
        const r = results[id + '@' + w];
        if (!r) { continue; }
        if (r.textElements < 4) { bad.push(id + '@' + w + ' rendered only ' + r.textElements + ' text elements'); }
        if (r.h1 && /не удалось|offline|ошибка/i.test(r.h1.text)) { bad.push(id + '@' + w + ' is an error screen: ' + r.h1.text); }
      }
    }
    // The review memo must carry the answers the customer gave, read off the rendered page.
    for (const w of [390, 1440]) {
      const rv = renderedText['miniapp-review@' + w];
      if (rv === undefined) { continue; }
      for (const needle of ['Alfa Grup', 'Собственник', 'Confidential brief']) {
        if (rv.indexOf(needle) === -1) { bad.push('miniapp-review@' + w + ' does not show "' + needle + '"'); }
      }
    }
    for (const w of [390, 1440]) {
      const rv = renderedText['miniapp-populated@' + w];
      if (rv === undefined) { continue; }
      if (rv.length < 120) { bad.push('miniapp-populated@' + w + ' rendered almost nothing'); }
    }
    assert(bad.length === 0, bad.join(' | '));
  });

  check('X-RAY POPULATED RESULT = PASS — the promoted analysis renders for the customer', () => {
    const bad = [];
    for (const [id, needles] of [['xray-result-ru', ['Финансовый рентген бизнеса', 'Ключевые риски', 'Оранжевая зона']],
      ['xray-result-ro', ['Test financiar FINMENTOR', 'Riscuri-cheie']]]) {
      for (const w of [390, 1440]) {
        const rv = renderedText[id + '@' + w];
        if (rv === undefined) { bad.push(id + '@' + w + ' was never rendered'); continue; }
        for (const n of needles) { if (rv.indexOf(n) === -1) { bad.push(id + '@' + w + ' does not show "' + n + '"'); } }
      }
    }
    assert(bad.length === 0, bad.join(' | '));
  });

  check('RU/RO VISUAL PARITY = PASS — the two editions render the same structure', () => {
    const pairs = [['ru-homepage', 'ro-homepage'], ['ru-questionnaire', 'ro-questionnaire'],
      ['ru-packages', 'ro-packages'], ['ru-monthly-pricing', 'ro-monthly-pricing'],
      ['ru-real-estate', 'ro-real-estate'], ['thank-you', 'ro-thank-you']];
    for (const [ru, ro] of pairs) {
      for (const w of [390, 1440]) {
        const a = results[ru + '@' + w], b = results[ro + '@' + w];
        assert(a && b, 'a measurement is missing for ' + ru + '/' + ro + '@' + w);
        assert(a.lang.slice(0, 2) === 'ru' && b.lang.slice(0, 2) === 'ro', ru + '/' + ro + ' declare ' + a.lang + '/' + b.lang);
        assert(a.packageTitles.length === b.packageTitles.length,
          ru + ' shows ' + a.packageTitles.length + ' package fields, ' + ro + ' shows ' + b.packageTitles.length + ' @' + w);
        assert(!!a.h1 === !!b.h1, ru + '/' + ro + ' disagree on having an H1 @' + w);
        assert(!!(a.header && a.header.present) === !!(b.header && b.header.present), ru + '/' + ro + ' disagree on having a header @' + w);
        if (w === 390 && a.header && a.header.present) {
          assert(a.header.navs.length === b.header.navs.length,
            ru + '/' + ro + ' show ' + a.header.navs.length + '/' + b.header.navs.length + ' in-bar navs @390');
        }
      }
    }
  });

  check('NAVY/GOLD VISUAL CONTRACT = PASS — read off the rendered pixels', () => {
    // The brand is a dark navy ground with a gold primary action. Both are asserted from what
    // Chrome actually painted: a token that is defined but overridden, or a CTA that lost its
    // accent to a cascade change, is invisible to a stylesheet check.
    //
    // The bands are deliberately wide. This is not a colour-picker test — it distinguishes
    // "navy and gold" from "something else entirely", which is the failure worth catching.
    const bad = [];
    for (const [k, r] of all) {
      const b = r.brand || {};
      if (!b.rootBg) { bad.push(k + ': no page background could be read'); continue; }
      const [br, bg, bb] = b.rootBg;
      const darkNavy = bb >= br && bb > 20 && br < 90 && bg < 90 && (br + bg + bb) < 210;
      if (!darkNavy) { bad.push(k + ': ground is rgb(' + b.rootBg.join(',') + '), not navy'); }
      // The Mini App error screen and the thank-you page carry no primary CTA; where one exists
      // it must be gold.
      if (b.primaryCta && b.primaryCta.bg) {
        const [cr, cg, cb] = b.primaryCta.bg;
        const gold = cr > 140 && cg > 110 && cb < Math.min(cr, cg) && (cr - cb) > 60;
        if (!gold) { bad.push(k + ': primary CTA is rgb(' + b.primaryCta.bg.join(',') + '), not gold — ' + b.primaryCta.text); }
      }
    }
    assert(bad.length === 0, bad.length + ' brand deviation(s): ' + bad.slice(0, 4).join(' | '));
  });

  check('every required surface was actually rendered and measured', () => {
    for (const s of SURFACES) {
      for (const w of s.widths) {
        const r = results[s.id + '@' + w];
        assert(r, 'no measurement for ' + s.id + '@' + w);
        assert(r.width === w, s.id + ' rendered at ' + r.width + ', expected ' + w);
      }
    }
    // The release's own required set, named rather than implied.
    const REQUIRED_390 = ['ru-homepage', 'ro-homepage', 'ru-questionnaire', 'ro-questionnaire',
      'ru-packages', 'ro-packages', 'ru-real-estate', 'thank-you',
      'miniapp-populated', 'miniapp-review', 'miniapp-success', 'xray-result-ru'];
    const REQUIRED_1440 = ['ru-homepage', 'ro-homepage', 'ru-questionnaire', 'ru-packages',
      'miniapp-populated', 'miniapp-review', 'xray-result-ru'];
    for (const id of REQUIRED_390) { assert(results[id + '@390'], 'the required 390px surface ' + id + ' is missing'); }
    for (const id of REQUIRED_1440) { assert(results[id + '@1440'], 'the required 1440px surface ' + id + ' is missing'); }
  });

  check('no shell stood in front of the page — the shots are of the site', () => {
    // The language gate and the consent bar both cover the whole surface. When either survives,
    // every screenshot of that page is the same picture of the shell, and two surfaces that
    // should differ come out byte-identical. That is the shape this checks for.
    const shots = new Map();
    for (const s of SURFACES) {
      for (const w of s.widths) {
        const bytes = readFileSync(join(SHOT_DIR, s.id + '-' + w + '.png'));
        const key = w + ':' + createHash('sha256').update(bytes).digest('hex');
        if (shots.has(key)) {
          throw new Error(s.id + '@' + w + ' is byte-identical to ' + shots.get(key)
            + ' — a shell is covering the page, or the section was never reached');
        }
        shots.set(key, s.id + '@' + w);
      }
    }
    // …and the measured H1 must be the page's, not the chooser's.
    for (const [k, r] of all) {
      if (!r.h1) { continue; }
      assert(!/^(LIMB|ЯЗЫК|ROMÂNĂ|РУССКИЙ)/i.test(r.h1.text), k + ' measured the language gate: ' + r.h1.text);
    }
  });

  if (KEEP_DIR) {
    const RETAIN = ['ru-homepage-390', 'ro-homepage-390', 'ru-questionnaire-390', 'ro-questionnaire-390',
      'ru-packages-390', 'ro-packages-390', 'ru-real-estate-390', 'thank-you-390',
      'miniapp-populated-390', 'miniapp-review-390', 'miniapp-success-390', 'xray-result-ru-390',
      'ru-homepage-1440', 'ro-homepage-1440', 'ru-questionnaire-1440', 'ru-packages-1440',
      'miniapp-populated-1440', 'miniapp-review-1440', 'xray-result-ru-1440'];
    const manifest = { generatedBy: 'qa/visual-evidence.mjs', chrome: version['Browser'], shots: {} };
    for (const n of RETAIN) {
      const bytes = readFileSync(join(SHOT_DIR, n + '.png'));
      writeFileSync(join(KEEP_DIR, n + '.png'), bytes);
      // The evidence is only evidence if a reviewer can prove the file in the tree is the file the
      // run produced, so each retained shot carries its own digest.
      manifest.shots[n + '.png'] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    }
    writeFileSync(join(KEEP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    writeFileSync(join(KEEP_DIR, 'measurements.json'), JSON.stringify(results, null, 2), 'utf8');
    writeFileSync(join(KEEP_DIR, 'capture-determinism.json'), JSON.stringify(settleReports, null, 2), 'utf8');
    console.log('  retained ' + RETAIN.length + ' screenshots in ' + KEEP_DIR);
  }

  console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach((f) => console.error('  - ' + f)); process.exit(1); }
})();
