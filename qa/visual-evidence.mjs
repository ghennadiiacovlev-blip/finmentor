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

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { RESULT_FIXTURES } from './fixtures/client-result-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 8099;
const ORIGIN = 'http://127.0.0.1:' + PORT;

const keepIdx = process.argv.indexOf('--keep');
const KEEP_DIR = keepIdx !== -1 ? process.argv[keepIdx + 1] : null;
const SHOT_DIR = join(ROOT, 'qa-artifacts', 'visual');

// ── THE SEED ─────────────────────────────────────────────────────────────────────────────────
//
// One fixed number, recorded in the evidence, that makes every draw in the page reproducible.
// It is read by the QA bootstrap only; nothing in the shipped site knows this file exists.
const QA_SEED = 20260907;
// The candidate this evidence is FOR. Screenshots carrying an earlier SHA are not proof of this
// commit, so the manifest records it and the reviewer can compare it against the commit under
// audit rather than trusting the directory name.
const CANDIDATE_SHA = (() => {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch (e) { return 'unknown'; }
})();
const BRANCH = (() => {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch (e) { return 'unknown'; }
})();
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
    // ── 1. SEEDED RANDOM ────────────────────────────────────────────────────────────────────
    //
    // The decorative constellation behind the hero lays its particles out with Math.random(), so
    // every run drew a different starfield and every screenshot of the home page had a different
    // digest. Geometry was identical and the PIXELS were not, which is why the evidence could
    // measure clean and still not be reproducible.
    //
    // This is injected BEFORE the document runs, so the first draw already comes off the seed.
    // mulberry32: 32 bits of state, no dependencies, and the same sequence on every machine.
    // Production keeps the real Math.random — nothing in the shipped site references this.
    (function () {
      var s = ${QA_SEED} >>> 0;
      Math.random = function () {
        s = (s + 0x6D2B79F5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();

    // ── 2. FREEZE THE DECORATIVE ANIMATION ──────────────────────────────────────────────────
    //
    // A seed fixes where the particles START. It does not stop them MOVING: the field advances
    // every frame, so the shot still lands on whichever frame the clock happened to reach.
    //
    // The site's own answer to this is prefers-reduced-motion, which the run emulates — main.js
    // gates the canvases, the cursor loop, the intro overlay, the reveal pass and the counters on
    // it, so under that mode the decorative work never starts and the counters snap straight to
    // their final values. This gate is the belt to that pair of braces: any loop that reschedules
    // ITSELF — the same function object asking for another frame — is delivered once and then
    // dropped, so a future decorative loop that forgets to honour reduced motion cannot put the
    // capture back on a moving page. Finite one-shot callbacks are untouched.
    //
    // The harness keeps a clean reference for its own frame waits, so the settle below can still
    // wait for real painted frames after the gate is in place.
    (function () {
      var raf = window.requestAnimationFrame.bind(window);
      window.__fmQaRaf = raf;
      var seen = new WeakSet();
      var frozen = 0;
      window.__fmQaFrozen = function () { return frozen; };
      window.requestAnimationFrame = function (cb) {
        if (typeof cb === 'function') {
          if (seen.has(cb)) { frozen++; return 0; }
          seen.add(cb);
        }
        return raf(cb);
      };
    })();

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
  const report = { fontsReady: false, fontStatus: '', pendingFaces: [], layoutSamples: 0, stable: false, frames: 0,
    seeded: false, reducedMotion: false, frozenReschedules: 0 };
  // The three determinism switches, read back from the page rather than assumed by the runner.
  report.seeded = typeof window.__fmQaRaf === 'function';
  try { report.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* reported false */ }
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

  // The harness's OWN frame waits go through the clean reference, so the freeze gate above can
  // never starve the thing that proves the page painted.
  const raf = window.__fmQaRaf || window.requestAnimationFrame.bind(window);
  await new Promise((r) => raf(() => raf(r)));
  report.frames = 2;
  try { report.frozenReschedules = window.__fmQaFrozen ? window.__fmQaFrozen() : 0; } catch (e) { /* reported 0 */ }
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
// THE OWNER-APPROVED PACKAGE TITLES, declared ONCE at module scope so the locator that finds them
// in the page and the gate that asserts coverage of them cannot drift apart. `Control Partner` was
// in one and not the other, which is how a protected title went unmeasured while the run said PASS.
const APPROVED_TITLES = ['CFO Control Partner', 'CFO AI Control', 'Monthly CFO Support',
  'Financial Health Check', 'Control Light', 'Control Partner'];

// ── THE LANGUAGE CONTROL, SNAPSHOT AT ONE MOMENT ─────────────────────────────────────────────
//
// A DOM node inside a closed drawer is NOT a language control a customer can reach. The old gate
// accepted `inDrawer` as reachability without ever opening the drawer, which passes on a page
// where the burger is broken, the drawer never opens, or the control inside it is covered.
//
// This snapshot answers only what is true RIGHT NOW: is the control painted, and would a tap at
// its own centre actually land on it. The harness takes one before the burger is pressed, one
// while the drawer is open, and one after it is closed again — and asserts the transition.
const LANG_SNAPSHOT = `(() => {
  const vis = (el) => {
    if (!el) { return false; }
    const r = el.getBoundingClientRect();
    const shown = el.checkVisibility
      ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })
      : el.getClientRects().length > 0;
    return shown && r.width > 0 && r.height > 0;
  };
  // ACTIONABLE = painted, inside the frame, and the thing a tap at its centre reaches. Hit-testing
  // is the only way to see a control that is visible and covered — which is what an open drawer
  // does to the bar underneath it.
  const probe = (el) => {
    if (!vis(el)) { return { painted: false, actionable: false }; }
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const inFrame = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
    const hit = inFrame ? document.elementFromPoint(x, y) : null;
    return { painted: true, inFrame,
      actionable: !!(inFrame && hit && (hit === el || el.contains(hit) || hit.contains(el))),
      centre: { x, y }, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] };
  };
  const DRAWER = '.mobile-menu, .nav-mobile, [data-qa-drawer]';
  const burgerEl = document.querySelector('.burger, #burger');
  const drawerEl = document.querySelector(DRAWER);
  const options = [];
  for (const a of document.querySelectorAll('.lang [data-lang-switch], .lang a, .lang button')) {
    const code = (a.getAttribute('data-lang-switch') || a.getAttribute('lang')
      || (a.textContent || '').trim()).toLowerCase().slice(0, 2);
    if (code !== 'ru' && code !== 'ro') { continue; }
    const cls = String(a.className || '');
    options.push(Object.assign({
      code,
      inDrawer: !!(a.closest && a.closest(DRAWER)),
      active: /\\bis-active\\b|\\bactive\\b|\\bis-current\\b/.test(cls)
        || a.getAttribute('aria-current') !== null || a.getAttribute('aria-selected') === 'true',
      href: a.getAttribute('href') || null,
      disabled: !!a.disabled || a.getAttribute('aria-disabled') === 'true'
    }, probe(a)));
  }
  // Collisions between the controls a customer can currently see and tap.
  const collisions = [];
  const painted = options.filter((o) => o.painted && o.rect);
  for (let i = 0; i < painted.length; i++) {
    for (let j = i + 1; j < painted.length; j++) {
      const a = painted[i].rect, b = painted[j].rect;
      const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (ox > 1 && oy > 1) { collisions.push(painted[i].code + '/' + painted[j].code + ' ' + ox + 'x' + oy); }
    }
  }
  const closeEl = document.querySelector('.mobile-menu__close, [data-menu-close], .drawer__close');
  return {
    lang: document.documentElement.lang,
    burger: burgerEl ? probe(burgerEl) : null,
    drawerRendered: drawerEl ? vis(drawerEl) : false,
    drawerOpenClass: drawerEl ? /is-open|open|active/.test(String(drawerEl.className || '')) : false,
    bodyLocked: /menu-open|nav-open|is-locked|no-scroll/.test(String(document.body.className || '')),
    close: closeEl ? probe(closeEl) : null,
    options, collisions
  };
})()`;

const MEASURE = `(() => {
  const vw = window.innerWidth;
  const TOL = 2;
  const out = { width: vw, overflow: null, clipped: [], ctaOverflow: [], ctaWrap: [], offscreen: [], textOutside: [],
    textZeroBox: [], packageTitles: [], header: null, h1: null, lang: document.documentElement.lang,
    textElements: 0, scrollContainers: [], adjacentInline: [],
    // The Range-measured ink: how many line boxes were graded, and the ones that were cut or left
    // the frame. Counted, so a sweep that silently measured nothing cannot report PASS.
    paintedTextLines: 0, paintedTextElements: 0, paintedTextClipped: [], paintedTextOutside: [] };
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
  const SCROLL_OK = '[data-qa-scroll], .mobile-menu, .fa-panel, .fa-body, .table-scroll, .art-table-wrap, .scroller, .marquee, .sysmap__track';
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

  // ── THE PAINTED TEXT ITSELF, not the box the layout gave it ─────────────────────────────────
  //
  // getBoundingClientRect() is the ELEMENT's border box. It is not where the glyphs are. A block
  // is as wide as its container whatever its text does, so a line that overflows to the right
  // still reports a rect ending neatly at the container edge; and a box whose height was fixed in
  // CSS reports that height while its second and third lines are painted below it and hidden.
  // Both read as clean. The customer reads half a sentence.
  //
  // A Range over a TEXT NODE returns one rect per LINE BOX actually laid out — the real ink. That
  // is what has to be inside the viewport, inside the element's own box when the element hides its
  // overflow, and inside the nearest clipping ancestor.
  const lineBoxes = (el) => {
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue || !n.nodeValue.trim()) { continue; }
      let range;
      try {
        range = document.createRange();
        range.selectNodeContents(n);
      } catch (e) { continue; }
      for (const rr of range.getClientRects()) {
        // Sub-pixel and empty rects are the collapsed whitespace between inline children, not ink.
        if (rr.width > 0.5 && rr.height > 0.5) { rects.push(rr); }
      }
    }
    return rects;
  };
  // The box that actually clips: the PADDING box, which is the border box minus the borders. A
  // bordered card must not be read as clipping its own content with its own frame.
  const clipEdges = (n) => {
    const nr = n.getBoundingClientRect();
    const ns = cs(n);
    const px = (v) => parseFloat(v) || 0;
    return { l: nr.left + px(ns.borderLeftWidth), t: nr.top + px(ns.borderTopWidth),
      r: nr.right - px(ns.borderRightWidth), b: nr.bottom - px(ns.borderBottomWidth) };
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

    // VISIBLE TEXT OUTSIDE THE VIEWPORT. Recorded, but NOT skipped past: the ink sweep at the end
    // of this loop has to run on every element it can, or the count that proves the sweep did its
    // work drops whenever another finding fires and turns into a second alarm for one defect.
    let boxOutside = false;
    if (!intentionalScroll(el) && (r.left < -TOL || r.right > vw + TOL)) {
      boxOutside = true;
      out.textOutside.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), text: label(el),
        left: Math.round(r.left), right: Math.round(r.right), vw });
    }

    // CLIPPED TEXT — by the element's own hidden overflow, or by an ancestor's.
    if (!boxOutside && !intentionalScroll(el) && s.textOverflow !== 'ellipsis') {
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

    // ── AND NOW THE SAME QUESTION ASKED OF THE INK ────────────────────────────────────────────
    //
    // Everything above measured the element. This measures the LINE BOXES the element painted,
    // which is the thing a customer's eye lands on and the only thing that can prove a sentence
    // was not cut. A declared truncation — text-overflow: ellipsis — is skipped, and an
    // intentional scroll container is skipped for the same reason it is skipped above.
    if (!intentionalScroll(el) && s.textOverflow !== 'ellipsis') {
      out.paintedTextElements++;
      const hides2 = (a) => a === 'hidden' || a === 'clip';
      const bounds = [];
      if (hides2(s.overflowX) || hides2(s.overflowY)) { bounds.push(['its own box', clipEdges(el)]); }
      const anc = clipper(el.parentElement);
      if (anc && anc !== el) { bounds.push(['.' + String(anc.className || anc.tagName).slice(0, 40), clipEdges(anc)]); }
      for (const rr of lineBoxes(el)) {
        out.paintedTextLines++;
        if (rr.left < -TOL || rr.right > vw + TOL) {
          out.paintedTextOutside.push({ tag: el.tagName, text: label(el),
            left: Math.round(rr.left), right: Math.round(rr.right), vw });
          continue;
        }
        for (const [why, b] of bounds) {
          if (rr.right > b.r + TOL || rr.left < b.l - TOL || rr.bottom > b.b + TOL || rr.top < b.t - TOL) {
            out.paintedTextClipped.push({ tag: el.tagName, text: label(el), by: why,
              ink: [Math.round(rr.left), Math.round(rr.top), Math.round(rr.right), Math.round(rr.bottom)],
              box: [Math.round(b.l), Math.round(b.t), Math.round(b.r), Math.round(b.b)] });
            break;
          }
        }
      }
    }
  }

  const renderedLineCount = (el) => {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set();
      for (const rr of range.getClientRects()) {
        if (rr.width > 0.5 && rr.height > 0.5) { tops.add(Math.round(rr.top)); }
      }
      return tops.size || 1;
    } catch (e) { return 1; }
  };

  // CTA OVERFLOW. The button's own text must fit, remain inside the viewport and avoid a
  // three-line label that reads like a narrow form control rather than a composed action.
  for (const el of document.querySelectorAll('a.btn, button.btn, .btn, [data-ga^="click_"]')) {
    if (!visible(el)) { continue; }
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) { out.offscreen.push({ text: label(el), left: Math.round(r.left), right: Math.round(r.right) }); }
    if (el.scrollWidth > el.clientWidth + 2) { out.ctaOverflow.push({ text: label(el), sw: el.scrollWidth, cw: el.clientWidth }); }
    if (el.matches('.btn')) {
      const lines = renderedLineCount(el);
      if (lines > 2) { out.ctaWrap.push({ text: label(el), lines, width: Math.round(r.width),
        cls: String(el.className || ''), id: el.id || '', ctaId: el.dataset.ctaId || '' }); }
    }
  }

  // Adjacent inline markup is only a defect when it can concatenate visible title/description
  // text. These are the public components that intentionally render two separate concepts.
  const criticalParents = '.ai-path__step, .ai-decision-grid article, .ai-pain, .retail-feature, .retail-action, .retail-path__step, .cb-factor, .package__term';
  const inlineLike = (d) => d === 'inline' || d === 'inline-block' || d === 'inline-flex' || d === 'inline-grid';
  for (const parent of document.querySelectorAll(criticalParents)) {
    if (!visible(parent)) { continue; }
    const parentDisplay = cs(parent).display;
    if (parentDisplay === 'flex' || parentDisplay === 'inline-flex' || parentDisplay === 'grid' || parentDisplay === 'inline-grid') { continue; }
    const children = [...parent.children].filter(visible);
    for (let i = 1; i < children.length; i++) {
      const a = children[i - 1], b = children[i];
      const between = [];
      let n = a.nextSibling;
      while (n && n !== b) { between.push(n); n = n.nextSibling; }
      const separatingText = between.some((x) => x.nodeType === 3 && /\s/.test(x.nodeValue || ''));
      if (!separatingText && inlineLike(cs(a).display) && inlineLike(cs(b).display)) {
        out.adjacentInline.push({ parent: String(parent.className || parent.tagName), left: label(a), right: label(b) });
      }
    }
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
      // ── THE LANGUAGE CONTROL, as a customer meets it ────────────────────────────────────────
      //
      // Recording that a .lang box exists is not the same as proving a customer can change
      // language: the control must be PAINTED, must offer the other edition, and must show which
      // edition they are reading now. Each option is captured with its own painted box and its
      // own active state so the run can ASSERT all three rather than eyeball a screenshot.
      //
      // The mobile drawer carries its own copy of the control. Both are collected; the assertion
      // only requires that at least one is reachable, because a burger a customer can open is a
      // language control they can reach.
      h.langOptions = [];
      for (const a of document.querySelectorAll('.lang [data-lang-switch], .lang a, .lang button')) {
        const code = (a.getAttribute('data-lang-switch') || a.getAttribute('lang')
          || (a.textContent || '').trim()).toLowerCase().slice(0, 2);
        if (code !== 'ru' && code !== 'ro') { continue; }
        const r = a.getBoundingClientRect();
        const cls = String(a.className || '');
        h.langOptions.push({
          code,
          painted: visible(a) && r.width > 0 && r.height > 0,
          inDrawer: !!(a.closest && a.closest('.mobile-menu, .nav-mobile, [data-qa-drawer]')),
          // "Current" is declared three ways across the site; any of them counts.
          active: /\bis-active\b|\bactive\b|\bis-current\b/.test(cls)
            || a.getAttribute('aria-current') !== null
            || a.getAttribute('aria-selected') === 'true',
          w: Math.round(r.width), h: Math.round(r.height),
          left: Math.round(r.left), right: Math.round(r.right)
        });
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

  // ── THE APPROVED PACKAGE TITLES, found by NAME rather than by class ──────────────────────────
  //
  // The owner-approved titles live in two different components: the home page prices them in
  // .package__name cards, the monthly page heads each tier with an h2. A check bound to one
  // class name proves nothing about the other, so the titles are located by their own text.
  //
  // LINE COUNT is measured from the rendered line boxes, not from height ÷ line-height. A Range
  // over the element's contents returns one rect per line box; counting DISTINCT tops is the
  // number of lines a customer sees, and it stays right when padding, a border or a different
  // line-height would have made the arithmetic lie.
  const APPROVED = ${JSON.stringify(APPROVED_TITLES)};
  // The line boxes of a SUBSTRING of an element's text. The monthly page heads each tier
  // «Control Light · базовый формат»: the heading wrapping after the separator on a phone is the
  // design, and only «Control Light» itself breaking across two lines is the defect. Measuring
  // the whole element would call the first one a failure, so the range is built over exactly the
  // title's own characters, walking the text nodes to convert a string offset into a DOM offset.
  const rangeForText = (el, needle) => {
    const raw = el.textContent || '';
    const at = raw.indexOf(needle);
    if (at === -1) { return null; }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seenLen = 0, start = null, end = null, node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (start === null && seenLen + len > at) { start = [node, at - seenLen]; }
      if (end === null && seenLen + len >= at + needle.length) { end = [node, at + needle.length - seenLen]; }
      seenLen += len;
      if (start && end) { break; }
    }
    if (!start || !end) { return null; }
    const range = document.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    return range;
  };
  const lineCount = (el, needle) => {
    try {
      const range = needle ? rangeForText(el, needle) : null;
      const r2 = range || (() => { const x = document.createRange(); x.selectNodeContents(el); return x; })();
      const tops = new Set();
      for (const rr of r2.getClientRects()) {
        if (rr.width > 0 && rr.height > 0) { tops.add(Math.round(rr.top)); }
      }
      return tops.size || 1;
    } catch (e) { return 1; }
  };
  out.approvedTitles = [];
  for (const el of document.querySelectorAll('h1, h2, h3, h4, .package__name, .card__title, .pkg__name, strong, span, p, li, a')) {
    if (!ownsText(el)) { continue; }
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    // The exact title, or the title followed by the tier separator the cards use.
    const hit = APPROVED.find((t) => text === t || text.indexOf(t + ' ·') === 0);
    if (!hit) { continue; }
    if (!rendered(el)) { continue; }
    const r = el.getBoundingClientRect();
    const s2 = cs(el);
    const box = clipper(el.parentElement);
    let escapes = false;
    if (box && box !== el) {
      const b = box.getBoundingClientRect();
      const pad = (v) => parseFloat(v) || 0;
      escapes = r.right > b.right - pad(s2.borderRightWidth) + TOL || r.left < b.left + pad(s2.borderLeftWidth) - TOL;
    }
    out.approvedTitles.push({
      title: hit, text: text.slice(0, 60), tag: el.tagName,
      w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right),
      painted: r.width > 0 && r.height > 0,
      selfClipped: el.scrollWidth > el.clientWidth + TOL || el.scrollHeight > el.clientHeight + TOL,
      outsideViewport: r.left < -TOL || r.right > vw + TOL,
      escapesCard: escapes,
      lines: lineCount(el, hit),
      elementLines: lineCount(el),
      // …and the title's own INK, not its box: the line boxes the title actually painted have to
      // sit inside whatever clips them, which is the measurement a rect cannot make.
      paintedTextClipped: (() => {
        const bounds = [];
        const hides3 = (a) => a === 'hidden' || a === 'clip';
        if (hides3(s2.overflowX) || hides3(s2.overflowY)) { bounds.push(clipEdges(el)); }
        if (box && box !== el) { bounds.push(clipEdges(box)); }
        if (!bounds.length) { return false; }
        for (const rr of lineBoxes(el)) {
          for (const b of bounds) {
            if (rr.right > b.r + TOL || rr.left < b.l - TOL || rr.bottom > b.b + TOL || rr.top < b.t - TOL) { return true; }
          }
        }
        return false;
      })()
    });
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

// `goto()` NOT THROWING IS NOT A STATE. The app's router can decline a transition, land on a
// guard screen, or route on to somewhere else the moment the draft turns out to be incomplete —
// and every one of those returns quietly. So the request is verified against `current()` here,
// and against state-specific DOM markers by STATE_PROOF below. A screenshot is only evidence of
// the state it actually shows.
const gotoScreen = (screen) => `(() => {
  if (!window.FM_APP) { return { ok: false, why: 'the app did not boot' }; }
  window.FM_APP.goto('${screen}');
  const now = window.FM_APP.current ? window.FM_APP.current() : null;
  if (now !== '${screen}') { return { ok: false, why: 'goto("${screen}") left the app in ' + now }; }
  return { ok: true, state: now };
})()`;

// THE SEMANTIC MARKERS OF EACH SCREEN, read off the DOM the app actually built. `current()` is the
// app's own opinion of where it is; this is what a customer can see, which is the thing the
// evidence claims.
const STATE_PROOF = `(() => {
  const t = (el) => (el && (el.textContent || '').replace(/\\s+/g, ' ').trim()) || '';
  const main = document.getElementById('main');
  // "Actionable" = the control is painted AND is what a tap at its own centre would reach. A
  // button under an overlay is present, visible and untappable, and only hit-testing sees that.
  const actionable = (b) => {
    const r = b.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) { return false; }
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + Math.min(r.height / 2, 20));
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) { return false; }
    const hit = document.elementFromPoint(x, y);
    return !!(hit && (hit === b || b.contains(hit) || hit.contains(b)));
  };
  return {
    state: window.FM_APP && window.FM_APP.current ? window.FM_APP.current() : null,
    mainChildren: main ? main.children.length : 0,
    textLength: t(main).length,
    // POPULATED — a question screen carrying option cards, with the draft's own answer already
    // chosen. Cards with nothing selected is the empty screen, not the resumed one.
    cards: document.querySelectorAll('.card').length,
    cardsSelected: document.querySelectorAll('.card.is-selected, .card[aria-pressed="true"]').length,
    kicker: t(document.querySelector('.kicker')),
    // REVIEW — the memo dossier built from the draft.
    dossier: !!document.querySelector('.dossier'),
    dossierCompany: t(document.querySelector('.dossier .company')),
    memos: document.querySelectorAll('.dossier .memo').length,
    readiness: !!document.querySelector('.readiness'),
    // EDIT — the selector screen, its per-field controls, and the content each one is offering
    // to edit. An edit screen with no rows, or rows with no values, is not the edit state.
    editRows: [...document.querySelectorAll('button.edit-row')].map((b) => ({
      label: t(b.querySelector('i')), value: t(b.querySelector('b')), actionable: actionable(b)
    })),
    // SUCCESS — the confirmation screen.
    orb: !!document.querySelector('.orb'),
    statusLine: t(document.querySelector('.status-line')),
    steps: document.querySelectorAll('.steps .step').length,
    // EXPIRED / ERROR — a terminal screen with its own single action and no back affordance.
    actions: document.querySelectorAll('.actions button').length,
    backHidden: (() => { const b = document.getElementById('back'); return b ? !!b.hidden : null; })()
  };
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
const RESPONSIVE_WIDTHS = [320, 390, 768, 1024, 1440];
const SURFACES = [
  { id: 'ru-homepage', url: '/index.html', widths: RESPONSIVE_WIDTHS },
  { id: 'ro-homepage', url: '/ro/index.html', widths: RESPONSIVE_WIDTHS },
  { id: 'ru-questionnaire', url: '/questionnaire.html', widths: RESPONSIVE_WIDTHS },
  { id: 'ro-questionnaire', url: '/ro/questionnaire.html', widths: RESPONSIVE_WIDTHS },
  { id: 'ru-questionnaire-mid', url: '/questionnaire.html', widths: [390, 1440], anchor: '.q-block:nth-of-type(6)' },
  { id: 'ro-questionnaire-mid', url: '/ro/questionnaire.html', widths: [390, 1440], anchor: '.q-block:nth-of-type(6)' },
  { id: 'ru-questionnaire-submit', url: '/questionnaire.html', widths: [390, 1440], anchor: '.q-actions' },
  { id: 'ro-questionnaire-submit', url: '/ro/questionnaire.html', widths: [390, 1440], anchor: '.q-actions' },
  { id: 'ru-how-we-work', url: '/index.html', widths: [390, 1440], anchor: '.steps' },
  { id: 'ro-how-we-work', url: '/ro/index.html', widths: [390, 1440], anchor: '.steps' },
  { id: 'ru-working-contour', url: '/index.html', widths: [390, 1440], anchor: '#working-contour' },
  { id: 'ro-working-contour', url: '/ro/index.html', widths: [390, 1440], anchor: '#working-contour' },
  { id: 'ru-asset-logic', url: '/index.html', widths: [1440], anchor: '.industries__asset-callout' },
  { id: 'ro-asset-logic', url: '/ro/index.html', widths: [1440], anchor: '.industries__asset-callout' },
  { id: 'ru-packages', url: '/index.html', widths: [390, 1440], anchor: '.packages' },
  { id: 'ro-packages', url: '/ro/index.html', widths: [390, 1440], anchor: '.packages' },
  { id: 'ru-ai-economics', url: '/ai-agent-economics.html', widths: RESPONSIVE_WIDTHS, anchor: '#implementation' },
  { id: 'ro-ai-economics', url: '/ro/ai-agent-economics.html', widths: RESPONSIVE_WIDTHS, anchor: '#implementation' },
  { id: 'ru-long-content', url: '/working-capital.html', widths: RESPONSIVE_WIDTHS, anchor: '.doc' },
  { id: 'ro-long-content', url: '/ro/working-capital.html', widths: RESPONSIVE_WIDTHS, anchor: '.doc' },
  { id: 'ru-business-offer', url: '/index.html', widths: [390], anchor: '#business-control-offer' },
  { id: 'ro-business-offer', url: '/ro/index.html', widths: [390], anchor: '#business-control-offer' },
  { id: 'ru-partner-offer', url: '/index.html', widths: [390], anchor: '#control-partner-offer' },
  { id: 'ro-partner-offer', url: '/ro/index.html', widths: [390], anchor: '#control-partner-offer' },
  { id: 'ru-cfo-consultation', url: '/cfo-consultation.html', widths: [390, 1440] },
  { id: 'ro-cfo-consultation', url: '/ro/cfo-consultation.html', widths: [390, 1440] },
  { id: 'ru-monthly-pricing', url: '/monthly-cfo-support.html', widths: [390, 1440] },
  { id: 'ro-monthly-pricing', url: '/ro/monthly-cfo-support.html', widths: [390, 1440] },
  { id: 'ru-monthly-execution', url: '/monthly-cfo-support.html', widths: [390, 1440], anchor: '#decision-control' },
  { id: 'ro-monthly-execution', url: '/ro/monthly-cfo-support.html', widths: [390, 1440], anchor: '#decision-control' },
  { id: 'ru-real-estate', url: '/real-estate-control-system.html', widths: [390, 1440] },
  { id: 'ro-real-estate', url: '/ro/real-estate-control-system.html', widths: [390, 1440] },
  { id: 'thank-you', url: '/thank-you.html', widths: [390, 1440] },
  { id: 'ro-thank-you', url: '/ro/thank-you.html', widths: [390, 1440] },

  // The legacy B.2.0 prototype, still served from the site root.
  { id: 'miniapp-start', url: '/app/index.html', widths: [390, 1440] },

  // ── the premium Mini App, in the states a customer actually meets ─────────────────────────
  { id: 'miniapp-entry', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody()), expect: 'APP_BOOTSTRAP' },
  // `expect` is the state the screenshot CLAIMS to be evidence of. It is asserted against the
  // app's own `current()` and against the screen's DOM markers, so a shot that silently landed
  // somewhere else cannot be filed as proof of this state.
  { id: 'miniapp-populated', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [SEED_BRIEF, gotoScreen('APP_PROBLEM')], expect: 'APP_PROBLEM' },
  { id: 'miniapp-review', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [SEED_BRIEF, gotoScreen('APP_REVIEW')], expect: 'APP_REVIEW' },
  { id: 'miniapp-edit', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [SEED_BRIEF, gotoScreen('APP_EDIT_SELECTOR')], expect: 'APP_EDIT_SELECTOR' },
  { id: 'miniapp-success', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ state: 'submitted', resumed: true, draft: RESUMED_DRAFT })),
    expect: 'APP_SUCCESS' },
  { id: 'miniapp-expired', url: '/app-premium/index.html', widths: [390],
    seed: miniappSeed(bootstrapBody({ resumed: true, draft: RESUMED_DRAFT })),
    after: [gotoScreen('APP_SESSION_EXPIRED')], expect: 'APP_SESSION_EXPIRED' },
  { id: 'miniapp-boot-failure', url: '/app-premium/index.html', widths: [390],
    seed: miniappSeed({ ok: false, error_code: 'GATEWAY_UNAVAILABLE', retryable: true }),
    expect: 'APP_BOOT_FAILURE' },

  // ── the customer X-Ray result, promoted to CLIENT_READY ───────────────────────────────────
  { id: 'xray-result-ru', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ state: 'submitted', resumed: true, draft: RESUMED_DRAFT,
      result: RESULT_FIXTURES['ru-score'] })), expect: 'APP_RESULT' },
  { id: 'xray-result-ro', url: '/app-premium/index.html', widths: [390, 1440],
    seed: miniappSeed(bootstrapBody({ state: 'submitted', resumed: true, locale: 'ro', draft: RESUMED_DRAFT,
      result: RESULT_FIXTURES['ro-score'] })), expect: 'APP_RESULT' }
];

// Surfaces that are a Mini App WebView, not a site page: no site header, no language gate, and
// no navy/gold site chrome contract to read off the body.
const MINIAPP = (id) => /^(miniapp|xray)/.test(id);

const results = {};
const settleReports = {};
// Per-image release metadata, and the in-run run-A / run-B digests behind it.
const shotMeta = {};
const abPairs = {};
// The text a customer actually reads on each surface, so a populated state can be asserted as
// populated rather than merely rendered.
const renderedText = {};
// The Mini App screen each shot is evidence OF, proven from the app's own state and from the DOM
// markers of that screen — never from "goto() did not throw".
const stateProofs = {};
// What the burger actually did at 390px: the drawer opened through the real UI, what became
// reachable inside it, and whether the bar went back to normal afterwards.
const drawerProbes = {};

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

  // A fresh profile prevents cookies, disk cache and prior hint state from making two otherwise
  // identical release runs paint differently. It is created by this process and removed below.
  const profile = mkdtempSync(join(tmpdir(), 'finmentor-visual-'));
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

  // A REAL TAP, not `el.click()`. Dispatched at viewport coordinates, it goes through the
  // browser's own hit-testing: a burger under an overlay, behind a transparent shim or off the
  // edge does not receive it, which is exactly the failure a synthetic `.click()` hides.
  const tap = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    }
    await sleep(400);
  };

  // ── 6B. THE MOBILE LANGUAGE SWITCH, ACTUALLY OPENED ────────────────────────────────────────
  //
  // Runs AFTER both screenshots, so nothing it does can move a pixel of the retained evidence,
  // and asserts the whole journey rather than the presence of a node: the burger is tappable, the
  // drawer opens because it was tapped, the language controls inside it become painted AND
  // hit-testable, the page's own edition is the current one, the other edition is offered, the
  // options do not collide — and the bar returns to its normal state when the drawer closes.
  const probeDrawer = async () => {
    const P = { probed: false, why: null };
    P.before = await evaluate(LANG_SNAPSHOT);
    const barPainted = P.before.options.filter((o) => !o.inDrawer && o.painted && o.actionable);
    P.barReachable = barPainted.map((o) => o.code);
    if (!P.before.burger || !P.before.burger.painted) {
      // No burger at this width. Then the control is not allowed to be hiding in a drawer: it has
      // to be painted in the bar, and the assertion below says so.
      P.why = 'no burger painted at 390px';
      return P;
    }
    if (!P.before.burger.actionable) { P.why = 'the burger is painted but a tap at its centre does not reach it'; return P; }
    P.probed = true;
    await tap(P.before.burger.centre.x, P.before.burger.centre.y);
    P.open = await evaluate(LANG_SNAPSHOT);
    // Close through the drawer's own close control if it has one, otherwise the burger again.
    const back = (P.open.close && P.open.close.actionable) ? P.open.close.centre
      : (P.open.burger && P.open.burger.actionable ? P.open.burger.centre : null);
    if (back) { await tap(back.x, back.y); }
    P.closedVia = back ? ((P.open.close && P.open.close.actionable) ? 'close control' : 'burger') : null;
    P.after = await evaluate(LANG_SNAPSHOT);
    return P;
  };

  for (const s of SURFACES) {
    for (const w of s.widths) {
      const height = w === 390 ? 844 : 900;
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: w, height, deviceScaleFactor: 1, mobile: w === 390,
        screenWidth: w, screenHeight: height
      });
      // ── REDUCED MOTION: the site's own switch for every decorative animation ────────────────
      //
      // main.js gates the hero constellation, the intro overlay, the custom cursor loop, the
      // reveal pass and the count-up numbers on `prefers-reduced-motion: reduce`. Emulating it
      // here stops the decorative work at its source instead of fighting it frame by frame, and
      // it is a mode a real customer browses in — not a QA-only rendering path.
      //
      // It also FIXES the counters rather than freezing them mid-tween: under reduced motion
      // main.js writes each number's final value straight out, so the evidence shows the figure
      // the customer reads instead of whatever the animation had reached.
      await c.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
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
        const found = await evaluate(`(() => {
          const el = document.querySelector('${s.anchor}');
          if (!el) { return false; }
          document.documentElement.style.scrollBehavior = 'auto';
          el.scrollIntoView({ block: 'start', behavior: 'instant' });
          return true;
        })()`);
        if (!found) { throw new Error(s.id + ': the anchor ' + s.anchor + ' is not on the page'); }
        // Let the real scroll listener settle the fixed header into its compact state before its
        // measured height becomes screenshot headroom. The two header states differ by 12px.
        await sleep(50);
        // PROVE THE SCROLL LANDED, and force it if it did not. `scroll-behavior: smooth` plus the
        // site's own scroll handling swallowed scrollIntoView on the Russian home page: the shot
        // came out byte-identical to the hero and looked like evidence while showing nothing.
        const jump = `(() => {
          const el = document.querySelector('${s.anchor}');
          const bars = [...document.querySelectorAll('header, .doc-bar')].filter((bar) => {
            const bs = getComputedStyle(bar);
            const br = bar.getBoundingClientRect();
            return (bs.position === 'sticky' || bs.position === 'fixed') && br.height > 0;
          });
          const headroom = Math.max(0, ...bars.map((bar) => bar.getBoundingClientRect().height)) + 16;
          const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - headroom);
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, y);
          return { y: Math.round(window.scrollY), top: Math.round(el.getBoundingClientRect().top), headroom: Math.round(headroom) };
        })()`;
        let at = await evaluate(jump);
        if (Math.abs(at.top) > 120) { at = await evaluate(jump); }
        if (at.y < 100) { throw new Error(s.id + ': the page never scrolled to ' + s.anchor + ' (scrollY ' + at.y + ')'); }
      }

      // The consent bar is re-created by the analytics loader after the first paint. It is a real
      // part of the page and has its own gate; here it would simply cover the surface under test,
      // so it is removed last, before the settle.
      await evaluate(`document.querySelectorAll('#cookieBar,.cookie-bar,[id*="cookie"],[class*="cookie"]').forEach((el) => el.remove())`);

      // A pointer left over from the preceding drawer probe can otherwise land on a card or the
      // floating assistant after a viewport resize, producing a valid hover state in only one
      // cross-process run. Park it on empty chrome before every evidence pair.
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });

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

      // The fixed assistant is measured above as part of the public UI. Remove it only from the
      // section-focused pixels so it cannot cover owner evidence or make a crop depend on whether
      // its script won the first-paint race in a fresh browser profile.
      await evaluate(`document.querySelectorAll('.fa-launch,.fa-panel').forEach((el) => el.remove())`);
      await sleep(20);

      // ── PHASE 4, RUN A / RUN B ──────────────────────────────────────────────────────────────
      //
      // The same surface, the same viewport, the same state, the same seed — captured twice, back
      // to back. If anything in the page is still moving under the shot, these two digests differ
      // and the run says so by name. Geometry cannot catch this: a drifting particle field
      // measures identical every time and paints different pixels every time.
      const shotA = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const shotB = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytesA = Buffer.from(shotA.data, 'base64');
      const bytesB = Buffer.from(shotB.data, 'base64');
      const sha = (b) => createHash('sha256').update(b).digest('hex');
      const shaA = sha(bytesA), shaB = sha(bytesB);
      abPairs[s.id + '@' + w] = { a: shaA, b: shaB, stable: shaA === shaB };

      const name = s.id + '-' + w + '.png';
      writeFileSync(join(SHOT_DIR, name), bytesA);
      // Everything a reviewer needs to know about THIS image, recorded beside it.
      shotMeta[name] = {
        candidate_sha: CANDIDATE_SHA,
        branch: BRANCH,
        capture_timestamp: new Date().toISOString(),
        viewport: w + 'x' + height,
        surface_id: s.id,
        language: MINIAPP(s.id) ? (/-ro$/.test(s.id) ? 'ro' : 'ru') : (s.url.startsWith('/ro/') ? 'ro' : 'ru'),
        application_state: s.after ? s.after.length + ' driven step(s)' : (s.seed ? 'seeded bootstrap' : 'as served'),
        screenshot_filename: name,
        sha256: shaA,
        bytes: bytesA.length,
        random_seed: QA_SEED,
        reduced_motion: settled.reducedMotion,
        font_status: settled.fontStatus,
        layout_stable: settled.stable,
        frozen_reschedules: settled.frozenReschedules,
        text_clipping_count: m.clipped.length + m.textZeroBox.length,
        overflow_count: (m.overflow ? 1 : 0) + m.textOutside.length + m.ctaOverflow.length + m.offscreen.length,
        header_collision_count: m.header && m.header.present ? (m.header.overlaps.length + m.header.outside.length) : 0,
        ab_reproducible: shaA === shaB
      };
      // ── THE TWO PROOFS THAT COME AFTER THE PIXELS ─────────────────────────────────────────
      //
      // Both run once the screenshots are already in hand. The drawer probe TAPS things; running
      // it before the capture would put the retained evidence in whatever state it left behind
      // and make the hash-drift gate a lottery. Running it here it cannot touch the evidence and
      // still proves the claim the evidence is filed under.
      if (MINIAPP(s.id)) {
        const proof = await evaluate(STATE_PROOF);
        proof.expected = s.expect || null;
        stateProofs[s.id + '@' + w] = proof;
        // The manifest records the state the app WAS IN, read from the app, instead of "2 driven
        // step(s)" — which said how hard the harness tried, not where it ended up.
        shotMeta[name].application_state = proof.state
          + (s.expect ? (proof.state === s.expect ? ' (as requested)' : ' (REQUESTED ' + s.expect + ')') : '');
      } else if (w < 1440) {
        drawerProbes[s.id + '@' + w] = await probeDrawer();
      }

      process.stdout.write('  rendered ' + (s.id + '@' + w).padEnd(28) + ' ' + name
        + (shaA === shaB ? '' : '  [A/B PIXEL DRIFT]')
        + (settled.stable ? '' : '  [LAYOUT NOT STABLE]') + '\n');
    }
  }

  c.close();
  chrome.kill();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* OS cleanup after exit */ }

  console.log('');
  writeFileSync(join(SHOT_DIR, 'measurements.json'), JSON.stringify(results, null, 2), 'utf8');
  writeFileSync(join(SHOT_DIR, 'capture-determinism.json'), JSON.stringify(settleReports, null, 2), 'utf8');
  // The copy each surface actually painted, kept beside the screenshots: a reviewer can grep the
  // evidence for a string instead of reading twenty PNGs.
  writeFileSync(join(SHOT_DIR, 'rendered-text.json'), JSON.stringify(renderedText, null, 2), 'utf8');
  // The two new proofs, retained beside the images: which Mini App screen each shot is actually
  // of, and what the burger did when it was pressed.
  writeFileSync(join(SHOT_DIR, 'state-proofs.json'), JSON.stringify(stateProofs, null, 2), 'utf8');
  writeFileSync(join(SHOT_DIR, 'drawer-probes.json'), JSON.stringify(drawerProbes, null, 2), 'utf8');

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

  check('SCREENSHOT HASH DRIFT = 0 (RUN A vs RUN B) — the same surface twice, byte for byte', () => {
    // The independent re-audit refused to certify the previous evidence because the PIXELS were
    // not reproducible even though the geometry was. This is that gate: every surface is shot
    // twice in the same session, same viewport, same state, same seed, and the two digests must
    // be identical. A decorative animation still running under the shot fails here by name.
    const bad = [];
    for (const [k, p] of Object.entries(abPairs)) {
      if (!p.stable) { bad.push(k + ': A=' + p.a.slice(0, 12) + ' B=' + p.b.slice(0, 12)); }
    }
    assert(bad.length === 0, bad.length + ' surface(s) drifted between two captures: ' + bad.slice(0, 6).join(' | '));
  });

  check('DETERMINISM SWITCHES ARMED — seeded random and reduced motion held on every surface', () => {
    // The seed and the reduced-motion mode are what MAKE the run above reproducible. If either
    // silently stopped applying, the A/B check could still pass by luck on a quiet page while the
    // evidence as a whole stopped being deterministic. Both are read back from inside the page.
    const bad = [];
    for (const [k, r] of Object.entries(settleReports)) {
      if (!r.settle.seeded) { bad.push(k + ': the seeded-random bootstrap did not run'); }
      if (!r.settle.reducedMotion) { bad.push(k + ': prefers-reduced-motion was not in effect'); }
    }
    assert(bad.length === 0, bad.length + ' surface(s) captured without the determinism switches: ' + bad.slice(0, 6).join(' | '));
  });

  check('DOCUMENT HORIZONTAL OVERFLOW = 0 — audited pages stay inside every responsive viewport', () => {
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

  check('PAINTED TEXT CLIPPING = 0 — the ink itself, not the box, stays inside what draws it', () => {
    // The check above grades the element's rect. This one grades the LINE BOXES the element
    // actually painted, obtained from a Range over each text node — the only measurement that can
    // see a line overflowing a box that reports a tidy rect, or a third line painted under a
    // fixed-height card. Both are half a sentence on a customer's screen.
    const bad = [];
    for (const [k, r] of all) {
      for (const c2 of (r.paintedTextClipped || [])) {
        bad.push(k + ': <' + c2.tag.toLowerCase() + '> ink ' + c2.ink.join(',') + ' past ' + c2.by
          + ' ' + c2.box.join(',') + ' — ' + c2.text);
      }
    }
    assert(bad.length === 0, bad.length + ' clipped painted text run(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('PAINTED TEXT OUTSIDE VIEWPORT = 0 — every line box is inside the frame', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const t of (r.paintedTextOutside || [])) {
        bad.push(k + ': <' + t.tag.toLowerCase() + '> ink ' + t.left + '..' + t.right + ' of ' + t.vw + ' — ' + t.text);
      }
    }
    assert(bad.length === 0, bad.length + ' line box(es) outside the viewport: ' + bad.slice(0, 6).join(' | '));
  });

  check('the painted-text sweep actually measured ink on every surface', () => {
    // A Range sweep that throws, or that finds no text nodes because a selector changed, reports
    // zero findings and looks exactly like a clean pass. It has to prove it did the work.
    //
    // The invariant is structural rather than a magic number: every element the BOX sweep graded
    // owns at least one text node, and every text node that paints produces at least one line
    // box, so the ink count can never be lower than the element count. It holds with room to
    // spare on every surface here (1.05x on the densest, 1.77x on the airiest), and it collapses
    // the moment the Range measurement stops running.
    const bad = all.filter(([, r]) => !(r.paintedTextElements > 0 && r.paintedTextLines >= r.paintedTextElements))
      .map(([k, r]) => k + ' (' + r.paintedTextLines + ' line boxes for ' + r.paintedTextElements + ' eligible text elements)');
    assert(bad.length === 0, 'the painted-text measurement graded less ink than there is text on: ' + bad.join(', '));
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

  check('CTA WRAPPING = PASS — no public action breaks into three or more lines', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const c2 of (r.ctaWrap || [])) {
        bad.push(k + ': ' + c2.lines + ' lines in ' + c2.width + 'px — ' + c2.text);
      }
    }
    assert(bad.length === 0, bad.length + ' over-wrapped CTA(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('CRITICAL INLINE ADJACENCY = 0 — card titles and descriptions cannot concatenate', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const c2 of (r.adjacentInline || [])) {
        bad.push(k + ': .' + c2.parent + ' joins “' + c2.left + '” + “' + c2.right + '”');
      }
    }
    assert(bad.length === 0, bad.length + ' dangerous adjacent inline pair(s): ' + bad.slice(0, 6).join(' | '));
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

  check('APPROVED PACKAGE TITLES = PASS — found by name, whole and on one line at both widths', () => {
    // The owner-approved titles, asserted where a customer actually reads them rather than where
    // a class name happens to be: fully painted, not clipped by their own box, inside the
    // viewport, not escaping their card, and — because the approved design sets them as
    // single-line card headings — on exactly ONE line at 390px and at 1440px.
    // THE PROTECTED LIST IS ITSELF ASSERTED. A hand-maintained "must be found" list is exactly
    // the thing that silently loses a name — `Control Partner` was missing from it, so the tier
    // it names was outside the contract while the gate reported PASS. These six are the approved
    // package titles; dropping one from the locator now fails here.
    const PROTECTED = ['Control Light', 'Control Partner', 'CFO Control Partner', 'CFO AI Control',
      'Monthly CFO Support', 'Financial Health Check'];
    const bad = [];
    for (const want of PROTECTED) {
      if (!APPROVED_TITLES.includes(want)) { bad.push('the locator no longer protects the title "' + want + '"'); }
    }

    const seen = new Set();
    for (const [k, r] of all) {
      for (const t of (r.approvedTitles || [])) {
        seen.add(t.title);
        if (!t.painted) { bad.push(k + ': "' + t.title + '" painted ' + t.w + 'x' + t.h); }
        if (t.selfClipped) { bad.push(k + ': "' + t.title + '" is clipped by its own box'); }
        if (t.outsideViewport) { bad.push(k + ': "' + t.title + '" sits at ' + t.left + '..' + t.right + ' of ' + r.width); }
        if (t.escapesCard) { bad.push(k + ': "' + t.title + '" escapes its card horizontally'); }
        if (t.lines !== 1) { bad.push(k + ': "' + t.title + '" wraps onto ' + t.lines + ' lines'); }
        if (t.paintedTextClipped) { bad.push(k + ': "' + t.title + '" has ink outside the box drawing it'); }
      }
    }

    // COVERAGE IS DERIVED, NOT DECLARED. Every protected title that stands as its own heading in
    // the SOURCE of an audited surface must have been located and measured on that surface. A
    // title that no page carries — `Control Partner` never appears except inside `CFO Control
    // Partner` — is correctly not required, and the day a card is added for it, it becomes
    // required here without anyone remembering to edit a list.
    const AUDITED_SOURCES = [...new Set(SURFACES.filter((s) => !MINIAPP(s.id) && s.url.endsWith('.html'))
      .map((s) => s.url.replace(/^\//, '')))];
    for (const src of AUDITED_SOURCES) {
      const abs = join(ROOT, src);
      if (!existsSync(abs)) { continue; }
      const html = readFileSync(abs, 'utf8');
      for (const t of PROTECTED) {
        const own = new RegExp('>\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(?:·[^<]*)?<');
        if (!own.test(html)) { continue; }
        if (!seen.has(t)) {
          bad.push(src + ' carries the title "' + t + '" but no audited surface measured it');
        }
      }
    }
    assert(bad.length === 0, bad.length + ' package title failure(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('MOBILE LANGUAGE SWITCH REACHABLE = PASS — the drawer was opened, not assumed', () => {
    // The old gate accepted a language link that merely EXISTED inside the mobile drawer as
    // "reachable", without ever opening it. That passes on a page whose burger does not work, or
    // whose drawer never paints, or where the control inside it is covered — none of which a
    // customer can use. This asserts the journey: tap the burger, and the control has to become
    // painted AND hit-testable, with the right edition current and the other one offered.
    const bad = [];
    let probed = 0;
    for (const [k, p] of Object.entries(drawerProbes)) {
      const want = (p.before.lang || 'ru').slice(0, 2) === 'ro' ? 'ro' : 'ru';
      const other = want === 'ro' ? 'ru' : 'ro';

      // A page with no burger has no drawer to hide behind: the control must be painted in the bar.
      if (!p.probed) {
        for (const code of [want, other]) {
          if (!p.barReachable.includes(code)) {
            bad.push(k + ': no burger (' + p.why + ') and ' + code.toUpperCase() + ' is not reachable in the bar either');
          }
        }
        continue;
      }
      probed++;
      // …and on a page that HAS a burger, pressing it has to change something.
      if (!p.open) { bad.push(k + ': the drawer was never measured after the tap'); continue; }
      const opened = p.open.drawerRendered || p.open.drawerOpenClass || p.open.bodyLocked
        || p.open.options.some((o) => o.inDrawer && o.actionable);
      if (!opened) { bad.push(k + ': tapping the burger opened nothing'); continue; }

      const reachable = (code) => p.open.options.some((o) => o.code === code && o.painted && o.actionable)
        || p.before.options.some((o) => o.code === code && !o.inDrawer && o.painted && o.actionable);
      if (!reachable(want)) { bad.push(k + ': with the drawer open, ' + want.toUpperCase() + ' is not a control a tap can reach'); }
      if (!reachable(other)) { bad.push(k + ': LANGUAGE CONTROL MISSING — ' + other.toUpperCase() + ' is not reachable even with the drawer open'); }

      // STATE, read off the controls that are now reachable.
      const live = p.open.options.filter((o) => o.painted && o.actionable);
      const active = new Set(live.filter((o) => o.active).map((o) => o.code));
      if (!active.has(want)) { bad.push(k + ': ' + want.toUpperCase() + ' ACTIVE STATE — the open drawer does not mark this page\'s edition current'); }
      if (active.has(other)) { bad.push(k + ': ' + other.toUpperCase() + ' ACTIVE STATE — the other edition is marked current too'); }
      // The alternate edition must actually go somewhere.
      const alt = live.find((o) => o.code === other);
      if (alt && !alt.href && !alt.disabled === false) { bad.push(k + ': the ' + other.toUpperCase() + ' control has no destination'); }
      for (const c2 of p.open.collisions) { bad.push(k + ': language options collide — ' + c2); }

      // …and the page goes back to normal, or the probe left the site in a state no customer is in.
      if (!p.after) { bad.push(k + ': the bar was never re-measured after closing'); continue; }
      if (p.after.drawerRendered && !p.before.drawerRendered) { bad.push(k + ': the drawer stayed open after it was closed'); }
      if (p.after.bodyLocked && !p.before.bodyLocked) { bad.push(k + ': the page scroll lock survived the drawer'); }
      if (!p.after.burger || !p.after.burger.actionable) { bad.push(k + ': the burger is no longer tappable once the drawer closed'); }
    }
    assert(probed > 0, 'no responsive surface exercised a burger — the drawer probe measured nothing');
    assert(bad.length === 0, bad.length + ' mobile language-switch failure(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('MINI APP STATE PROVEN = PASS — every screen is asserted, not assumed from goto()', () => {
    // `goto()` returning without throwing says the call was made, not that the app arrived. Each
    // state below is proven twice: against the app's own `current()`, and against DOM markers
    // that only that screen builds. A shot filed as evidence of EDIT that is really REVIEW is
    // exactly the kind of thing this closes.
    const MARKERS = {
      APP_PROBLEM: (p) => {
        if (!(p.cards >= 2)) { return 'no option cards on the question screen (' + p.cards + ')'; }
        if (!(p.cardsSelected >= 1)) { return 'no card is selected — this is the empty screen, not the populated one'; }
        if (!p.kicker) { return 'no objective kicker above the question'; }
        return null;
      },
      APP_REVIEW: (p) => {
        if (!p.dossier) { return 'no .dossier — the review memo was not built'; }
        if (!p.dossierCompany) { return 'the review memo names no company'; }
        if (!(p.memos >= 3)) { return 'the review memo has ' + p.memos + ' sections'; }
        if (!p.readiness) { return 'no readiness block'; }
        return null;
      },
      APP_EDIT_SELECTOR: (p) => {
        // The mandate for this state is explicit: an edit MARKER, an edit CONTROL, and the
        // editable content actually rendered.
        if (!(p.editRows.length >= 3)) { return 'the edit screen offers ' + p.editRows.length + ' rows'; }
        if (!p.editRows.every((r) => r.label)) { return 'an edit row has no field label'; }
        const withValue = p.editRows.filter((r) => r.value && r.value !== '—');
        if (!(withValue.length >= 2)) { return 'only ' + withValue.length + ' edit row(s) render the content they edit'; }
        if (!p.editRows.some((r) => r.actionable)) { return 'no edit control is reachable by a tap'; }
        return null;
      },
      APP_SUCCESS: (p) => {
        if (!p.orb) { return 'no confirmation mark'; }
        if (!p.statusLine) { return 'no status line'; }
        if (!(p.steps >= 1)) { return 'no next steps'; }
        if (p.backHidden === false) { return 'a back affordance on a terminal screen'; }
        return null;
      },
      APP_SESSION_EXPIRED: (p) => {
        if (!(p.textLength > 40)) { return 'the expiry screen rendered almost nothing'; }
        if (!(p.actions >= 1)) { return 'the expiry screen offers no action'; }
        if (p.backHidden === false) { return 'a back affordance on a terminal screen'; }
        return null;
      },
      // The error state the Gateway can put a customer in, and the entry screen they land on
      // before any of it — both are captured, so both are proven rather than assumed.
      APP_BOOT_FAILURE: (p) => {
        if (!(p.textLength > 40)) { return 'the failure screen rendered almost nothing'; }
        if (!(p.actions >= 1)) { return 'the failure screen offers no way out'; }
        if (p.backHidden === false) { return 'a back affordance on a terminal screen'; }
        return null;
      },
      APP_BOOTSTRAP: (p) => {
        if (!(p.textLength > 40)) { return 'the entry screen rendered almost nothing'; }
        if (!(p.actions >= 1)) { return 'the entry screen offers no way to start'; }
        return null;
      },
      // The promoted X-Ray analysis, which is the only Mini App screen a customer reads as a
      // RESULT rather than as a form.
      APP_RESULT: (p) => {
        if (!(p.textLength > 200)) { return 'the result screen rendered ' + p.textLength + ' characters'; }
        if (!(p.mainChildren >= 1)) { return 'the result screen built no content'; }
        return null;
      }
    };
    const REQUIRED = ['APP_PROBLEM', 'APP_REVIEW', 'APP_EDIT_SELECTOR', 'APP_SUCCESS',
      'APP_SESSION_EXPIRED', 'APP_BOOT_FAILURE', 'APP_RESULT'];
    const bad = [];
    const proven = new Set();
    for (const [k, p] of Object.entries(stateProofs)) {
      if (!p.expected) { continue; }
      if (p.state !== p.expected) {
        bad.push(k + ': requested ' + p.expected + ', the app is in ' + p.state);
        continue;
      }
      const why = MARKERS[p.expected] ? MARKERS[p.expected](p) : null;
      if (why) { bad.push(k + ' (' + p.expected + '): ' + why); continue; }
      proven.add(p.expected);
    }
    for (const want of REQUIRED) {
      if (!proven.has(want)) { bad.push('no captured surface proved the state ' + want); }
    }
    assert(bad.length === 0, bad.length + ' unproven Mini App state(s): ' + bad.slice(0, 6).join(' | '));
  });

  check('LANGUAGE CONTROL MISSING = 0 / WRONG STATE = 0 / COLLISION = 0', () => {
    // On every captured RU and RO website page a customer must be able to see which edition they
    // are reading and reach the other one. Asserted, not merely recorded: the control has to be
    // PAINTED, offer BOTH codes, and mark the page's own language — and only that one — current.
    const bad = [];
    for (const [k, r] of site) {
      const h = r.header;
      const want = r.lang.slice(0, 2) === 'ro' ? 'ro' : 'ru';
      const other = want === 'ro' ? 'ru' : 'ro';
      if (!h || !h.present) { bad.push(k + ': no header to carry a language control'); continue; }
      const opts = h.langOptions || [];
      if (opts.length === 0) { bad.push(k + ': LANGUAGE CONTROL MISSING — no RU/RO option in the bar or the drawer'); continue; }
      // REACHABLE = painted in the bar, or PROVEN reachable inside a drawer that this run actually
      // opened. `o.inDrawer` on its own is a DOM node behind a closed panel: it satisfied the old
      // gate and satisfies no customer. The drawer probe is the corroboration, and where there is
      // no probe for this surface, only a painted control counts.
      const probe = drawerProbes[k];
      const provenInDrawer = (code) => !!(probe && probe.probed && probe.open
        && probe.open.options.some((o) => o.code === code && o.painted && o.actionable));
      const reachable = (code) => opts.some((o) => o.code === code && o.painted) || provenInDrawer(code);
      if (!reachable(want)) { bad.push(k + ': the current edition (' + want.toUpperCase() + ') has no reachable control'); }
      if (!reachable(other)) { bad.push(k + ': LANGUAGE CONTROL MISSING — ' + other.toUpperCase() + ' is not offered'); }
      // State: the page's own language is the active one, and the other is not.
      const activeCodes = new Set(opts.filter((o) => o.active).map((o) => o.code));
      if (!activeCodes.has(want)) { bad.push(k + ': LANGUAGE CONTROL WRONG STATE — ' + want.toUpperCase() + ' is not marked current'); }
      if (activeCodes.has(other)) { bad.push(k + ': LANGUAGE CONTROL WRONG STATE — ' + other.toUpperCase() + ' is marked current on a ' + want.toUpperCase() + ' page'); }
      // Collision: two painted options sharing pixels is a control a customer taps the wrong half of.
      const painted = opts.filter((o) => o.painted);
      for (let i = 0; i < painted.length; i++) {
        for (let j = i + 1; j < painted.length; j++) {
          const a = painted[i], b = painted[j];
          if (a.code === b.code) { continue; }
          const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (ov > 1) { bad.push(k + ': LANGUAGE CONTROL COLLISION — ' + a.code + '/' + b.code + ' overlap by ' + Math.round(ov) + 'px'); }
        }
      }
    }
    assert(bad.length === 0, bad.length + ' language control defect(s): ' + bad.slice(0, 6).join(' | '));
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

  check('REPAIRED COPY REACHES THE SCREEN — the corrected sentences render, the broken ones do not', () => {
    // The copy gates in qa/website-contract.test.mjs read the SOURCE. This reads what Chrome
    // actually painted, which is the only thing that proves a customer sees the correction: a
    // sentence repaired in a file that some script overwrites at runtime would pass there and
    // fail here. Each entry is a sentence this release repaired.
    const FIXED = {
      'ru-homepage@1440': ['На первичном финансовом разборе обсуждаем', 'какие — поглощают денежные средства',
        'для управления: денежный поток', 'Прибыль есть, денег нет: отчёт о прибыли и убытках'],
      'ro-homepage@1440': ['La discuția financiară inițială discutăm', 'Contabilitatea există',
        'Există comenzi, dar marja', 'Banii „există”, dar sunt blocați',
        'Inteligența artificială (AI) și automatizarea', 'Verificați economia IA',
        'pentru management: flux de numerar', 'Există profit, dar nu sunt bani'],
      'ru-questionnaire@1440': ['Структурированная финансовая оценка'],
      'ro-questionnaire@1440': ['evaluare financiară structurată', 'Există profit, dar nu sunt bani',
        'trebuie pusă ordine?', 'Planific pe termen lung', 'Fluxul de numerar nu este suficient'],
      'ru-how-we-work@1440': ['Сопровождение и контроль исполнения', 'Совместный рабочий контур',
        'Результат строится совместно', 'ограниченное количество проектов одновременно'],
      'ro-how-we-work@1440': ['Parteneriat și controlul execuției', 'Circuit comun de lucru',
        'Rezultatul se construiește împreună', 'număr limitat de proiecte'],
      'ru-cfo-consultation@1440': ['CFO Advisory Session', 'Стратегическая CFO-консультация', 'тему вопроса',
        'какое решение нужно принять', 'не полный data room', 'Когда нужен другой формат', 'сфокусирована на одном заранее определённом решении'],
      'ro-cfo-consultation@1440': ['CFO Advisory Session', 'Sesiune strategică de consultanță CFO', 'tema întrebării',
        'ce decizie trebuie luată', 'nu un dosar complet', 'Când este necesar un alt format', 'unei singure decizii definite în prealabil'],
      'ru-monthly-pricing@1440': ['Сопровождение начинается с профессионального формата', 'Дебиторка по срокам возникновения',
        'Кассовый разрыв и покрытие', 'Крупное внедрение Power BI', 'Управленческая сводка по итогам периода',
        'CFO Control Partner · регулярный контроль', 'CFO AI Control · высокая вовлечённость',
        'Контроль решений и исполнения', 'Регулярные CFO-разборы и управленческие брифы в согласованном ритме',
        'Более высокий уровень вовлечённости CFO в согласованном рабочем контуре', 'Срочные и внеплановые задачи согласовываются отдельно'],
      'ro-monthly-pricing@1440': ['Colaborarea începe cu formatul profesional', 'Vechimea creanțelor', 'Golul de numerar',
        'implementare majoră Power BI', 'Sinteză managerială', 'CFO Control Partner · control regulat',
        'CFO AI Control · implicare ridicată', 'Controlul deciziilor și al execuției',
        'Analize CFO și sinteze manageriale regulate, într-un ritm convenit',
        'Un nivel mai ridicat de implicare a CFO-ului în circuitul de lucru convenit',
        'Sarcinile urgente și neplanificate se convin separat']
    };
    // …and the defects themselves must be gone from the painted page, in either language.
    const BROKEN = ['На Первичный финансовый разбор', 'La Discuție financiară inițială',
      'Profit există, dar bani nu', 'Nu ajunge flux de numerar', 'pusă ordinea',
      'Planific pentru perspectivă', 'inteligența artificială dvs.', 'Contabilitate există',
      'Comenzi există', 'Bani „există”', 'Aging дебиторки', 'Cash gap', 'управленческий summary',
      'Summary managerial', 'Aging-ul creanțelor', 'Control Light',
      'CFO Control Partner · Standard', 'CFO AI Control · Premium', 'Разовая CFO-консультация',
      'Consultație CFO punctuală', 'Границы консультации', 'Граница диагностики',
      'Limitele consultației', 'Limita diagnosticului', 'До 12–16 часов в месяц',
      'Până la 12–16 ore pe lună', 'Еженедельный финансовый разбор',
      'Еженедельный бизнес-бриф и стратегическая сессия', 'Analiză financiară săptămânală',
      'Sinteză de business săptămânală și sesiune strategică', '24/7', 'apeluri nelimitate'];
    const bad = [];
    for (const [k, needles] of Object.entries(FIXED)) {
      const text = renderedText[k];
      if (text === undefined) { bad.push(k + ' was never rendered'); continue; }
      for (const n of needles) { if (text.indexOf(n) === -1) { bad.push(k + ' does not paint "' + n + '"'); } }
    }
    for (const [k, text] of Object.entries(renderedText)) {
      for (const n of BROKEN) { if (text.indexOf(n) !== -1) { bad.push(k + ' still paints the repaired defect "' + n + '"'); } }
    }
    assert(bad.length === 0, bad.length + ' copy defect(s) on the painted page: ' + bad.slice(0, 6).join(' | '));
  });

  check('RU/RO VISUAL PARITY = PASS — the two editions render the same structure', () => {
    const pairs = [['ru-homepage', 'ro-homepage'], ['ru-questionnaire', 'ro-questionnaire'],
      ['ru-how-we-work', 'ro-how-we-work'], ['ru-working-contour', 'ro-working-contour'],
      ['ru-packages', 'ro-packages'], ['ru-cfo-consultation', 'ro-cfo-consultation'], ['ru-monthly-pricing', 'ro-monthly-pricing'],
      ['ru-monthly-execution', 'ro-monthly-execution'],
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
    //
    // Both languages of the X-Ray result, and the Mini App EDIT and SUCCESS screens, are required
    // at both widths: a single-language X-Ray does not certify the Romanian customer's result,
    // and an empty shell does not stand in for a populated review or a success screen.
    const REQUIRED_390 = ['ru-homepage', 'ro-homepage', 'ru-questionnaire', 'ro-questionnaire',
      'ru-how-we-work', 'ro-how-we-work', 'ru-packages', 'ro-packages', 'ru-cfo-consultation', 'ro-cfo-consultation', 'ru-real-estate', 'thank-you',
      'miniapp-populated', 'miniapp-review', 'miniapp-edit', 'miniapp-success',
      'xray-result-ru', 'xray-result-ro'];
    const REQUIRED_1440 = ['ru-homepage', 'ro-homepage', 'ru-questionnaire', 'ro-questionnaire',
      'ru-how-we-work', 'ro-how-we-work', 'ru-packages', 'ro-packages', 'ru-cfo-consultation', 'ro-cfo-consultation',
      'miniapp-populated', 'miniapp-review', 'miniapp-edit', 'miniapp-success',
      'xray-result-ru', 'xray-result-ro'];
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
    // The full required release set at both widths.
    const RETAIN = ['ru-homepage-390', 'ro-homepage-390', 'ru-questionnaire-390', 'ro-questionnaire-390',
      'ru-questionnaire-mid-390', 'ro-questionnaire-mid-390', 'ru-questionnaire-submit-390', 'ro-questionnaire-submit-390',
      'ru-how-we-work-390', 'ro-how-we-work-390', 'ru-working-contour-390', 'ro-working-contour-390',
      'ru-packages-390', 'ro-packages-390', 'ru-ai-economics-390', 'ro-ai-economics-390',
      'ru-long-content-390', 'ro-long-content-390', 'ru-cfo-consultation-390', 'ro-cfo-consultation-390',
      'ru-real-estate-390', 'thank-you-390',
      'miniapp-populated-390', 'miniapp-review-390', 'miniapp-edit-390', 'miniapp-success-390',
      'xray-result-ru-390', 'xray-result-ro-390',
      'ru-homepage-1440', 'ro-homepage-1440', 'ru-questionnaire-1440', 'ro-questionnaire-1440',
      'ru-questionnaire-mid-1440', 'ro-questionnaire-mid-1440', 'ru-questionnaire-submit-1440', 'ro-questionnaire-submit-1440',
      'ru-how-we-work-1440', 'ro-how-we-work-1440', 'ru-working-contour-1440', 'ro-working-contour-1440',
      'ru-asset-logic-1440', 'ro-asset-logic-1440', 'ru-packages-1440', 'ro-packages-1440',
      'ru-ai-economics-1440', 'ro-ai-economics-1440', 'ru-long-content-1440', 'ro-long-content-1440',
      'ru-cfo-consultation-1440', 'ro-cfo-consultation-1440',
      'miniapp-populated-1440', 'miniapp-review-1440', 'miniapp-edit-1440', 'miniapp-success-1440',
      'xray-result-ru-1440', 'xray-result-ro-1440'];

    // ── PHASE 4, THE COLD RUN ────────────────────────────────────────────────────────────────
    //
    // A manifest already in the keep directory is a PREVIOUS run's digests. Comparing against it
    // turns "run it twice and diff by hand" into a gate: delete qa-artifacts, run again, and any
    // retained image whose pixels moved fails the run and is named. Only `sha256` is compared —
    // `capture_timestamp` is required evidence and is volatile by definition.
    let previous = null;
    const prevPath = join(KEEP_DIR, 'manifest.json');
    if (existsSync(prevPath)) {
      try { previous = JSON.parse(readFileSync(prevPath, 'utf8')); } catch (e) { previous = null; }
    }

    const manifest = {
      generatedBy: 'qa/visual-evidence.mjs',
      candidate_sha: CANDIDATE_SHA,
      branch: BRANCH,
      generated_at: new Date().toISOString(),
      chrome: version['Browser'],
      random_seed: QA_SEED,
      reduced_motion: true,
      shots: {}
    };
    const drift = [];
    for (const n of RETAIN) {
      const file = n + '.png';
      const bytes = readFileSync(join(SHOT_DIR, file));
      writeFileSync(join(KEEP_DIR, file), bytes);
      // A retained name with no capture record is itself a finding; it is recorded as an empty
      // entry so the manifest check below names it rather than the run dying here.
      manifest.shots[file] = shotMeta[file] || { screenshot_filename: file };
      const meta = manifest.shots[file];
      if (previous && previous.shots && previous.shots[file] && previous.shots[file].sha256 !== meta.sha256) {
        drift.push(file + ': ' + previous.shots[file].sha256.slice(0, 12) + ' -> ' + meta.sha256.slice(0, 12));
      }
    }
    writeFileSync(join(KEEP_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    writeFileSync(join(KEEP_DIR, 'measurements.json'), JSON.stringify(results, null, 2), 'utf8');
    writeFileSync(join(KEEP_DIR, 'capture-determinism.json'), JSON.stringify(settleReports, null, 2), 'utf8');
    // The copy each surface actually PAINTED. Retained because the release claims a language
    // result, and a claim about language that a reviewer cannot grep is a claim about nothing:
    // the screenshots are viewport-height, so a sentence repaired below the fold is provable
    // from here and from nowhere else in the committed evidence.
    writeFileSync(join(KEEP_DIR, 'rendered-text.json'), JSON.stringify(renderedText, null, 2), 'utf8');
    // The two proofs behind the claims the manifest makes: which Mini App screen each retained
    // shot is actually of, and what pressing the burger at 390px actually did. Both are retained
    // for the same reason as rendered-text.json — a claim a reviewer cannot check is not evidence.
    writeFileSync(join(KEEP_DIR, 'state-proofs.json'), JSON.stringify(stateProofs, null, 2), 'utf8');
    writeFileSync(join(KEEP_DIR, 'drawer-probes.json'), JSON.stringify(drawerProbes, null, 2), 'utf8');
    console.log('  retained ' + RETAIN.length + ' screenshots in ' + KEEP_DIR);

    check('SCREENSHOT HASH DRIFT = 0 (against the previously retained manifest)', () => {
      if (!previous) { console.log('        (no previous manifest — this run establishes the baseline)'); return; }
      assert(previous.shots, 'the previous manifest carries no shots');
      assert(drift.length === 0, drift.length + ' retained image(s) changed pixels: ' + drift.slice(0, 6).join(' | '));
    });

    check('every retained image carries the full release evidence record', () => {
      const NEED = ['candidate_sha', 'branch', 'capture_timestamp', 'viewport', 'surface_id', 'language',
        'application_state', 'screenshot_filename', 'sha256', 'random_seed', 'font_status',
        'layout_stable', 'text_clipping_count', 'overflow_count', 'header_collision_count'];
      const bad = [];
      for (const [file, meta] of Object.entries(manifest.shots)) {
        for (const key of NEED) {
          if (meta[key] === undefined || meta[key] === null || meta[key] === '') { bad.push(file + ': missing ' + key); }
        }
        // Evidence has to be OF the commit under audit. A screenshot carrying an earlier SHA is
        // a picture of a different candidate.
        if (meta.candidate_sha !== CANDIDATE_SHA) { bad.push(file + ': candidate_sha ' + meta.candidate_sha + ' != ' + CANDIDATE_SHA); }
        if (meta.random_seed !== QA_SEED) { bad.push(file + ': random_seed ' + meta.random_seed); }
        if (meta.layout_stable !== true) { bad.push(file + ': layout was not stable'); }
        if (meta.ab_reproducible !== true) { bad.push(file + ': run A and run B disagreed'); }
      }
      assert(bad.length === 0, bad.length + ' manifest defect(s): ' + bad.slice(0, 6).join(' | '));
    });
  }

  console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach((f) => console.error('  - ' + f)); process.exit(1); }
})();
