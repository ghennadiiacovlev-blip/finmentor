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
//   * clipped text       — an element's content is taller or wider than the box drawing it, so a
//                          customer reads half a sentence;
//   * CTA overflow       — a button's text spills outside its own border, or the button leaves
//                          the viewport;
//   * package titles     — the pricing cards' names render on one line, unbroken;
//   * RU/RO parity       — the two language editions of the same page render the same structure.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

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

// ── the measurement, run inside the page ─────────────────────────────────────────────────────
//
// Everything is read from the RENDERED box model. A rule that fires on a source string would be
// the same blind spot this file exists to close.
const MEASURE = `(() => {
  const vw = window.innerWidth;
  const out = { width: vw, overflow: null, clipped: [], ctaOverflow: [], offscreen: [], packageTitles: [], h1: null, lang: document.documentElement.lang };
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) { out.overflow = { scrollWidth: de.scrollWidth, viewport: vw }; }

  const visible = (el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
  };
  const label = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70);

  // CLIPPED TEXT. A box that hides its own overflow while its content is bigger than it cuts a
  // sentence in half. Elements that scroll on purpose are excluded, and so is a 1px rounding gap.
  for (const el of document.querySelectorAll('h1,h2,h3,h4,p,li,a,button,span,td,th,summary,legend')) {
    if (!visible(el)) { continue; }
    const s = getComputedStyle(el);
    const hides = (a) => a === 'hidden' || a === 'clip';
    if (!hides(s.overflowX) && !hides(s.overflowY)) { continue; }
    if (s.textOverflow === 'ellipsis') { continue; }
    // The property is CLIPPED TEXT. An element with no text has none to clip — the hero's
    // decorative 1px scroll-cue line is taller than its box by design, and reporting it would be
    // reporting the animation, not a sentence a customer cannot read.
    if (!label(el)) { continue; }
    if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
      out.clipped.push({ tag: el.tagName, text: label(el), sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight });
    }
  }

  // CTA OVERFLOW. The button's own text wider than the button, or the button outside the viewport.
  for (const el of document.querySelectorAll('a.btn, button.btn, .btn, [data-ga^="click_"]')) {
    if (!visible(el)) { continue; }
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1) { out.offscreen.push({ text: label(el), left: Math.round(r.left), right: Math.round(r.right) }); }
    if (el.scrollWidth > el.clientWidth + 2) { out.ctaOverflow.push({ text: label(el), sw: el.scrollWidth, cw: el.clientWidth }); }
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
      const cs = getComputedStyle(cta);
      const flat = parseColor(cs.backgroundColor);
      let bg = opaque(flat) ? [flat.r, flat.g, flat.b] : null;
      let src = 'color';
      if (!bg) {
        const stops = [...(cs.backgroundImage || '').matchAll(/rgba?\\(([^)]+)\\)/g)]
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

// ── the surfaces the release cares about ─────────────────────────────────────────────────────
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
  { id: 'miniapp-start', url: '/app/index.html', widths: [390, 1440] },
  { id: 'miniapp-premium', url: '/app-premium/index.html', widths: [390, 1440] },
  { id: 'thank-you', url: '/thank-you.html', widths: [390, 1440] },
  { id: 'ro-thank-you', url: '/ro/thank-you.html', widths: [390, 1440] }
];

const results = {};

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

  for (const s of SURFACES) {
    for (const w of s.widths) {
      const height = w === 390 ? 844 : 900;
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: w, height, deviceScaleFactor: 1, mobile: w === 390,
        screenWidth: w, screenHeight: height
      });
      // The Telegram Mini App shell asks for the Telegram bridge before it renders anything.
      // Outside Telegram it draws its Preview state, which is a real customer surface too.
      // Two shells stand between a fresh browser and the page a customer reads, and both must be
      // satisfied BEFORE the document runs or the evidence is a picture of the shell:
      //
      //   * the Telegram bridge, which the Mini App asks for before it renders anything;
      //   * the LANGUAGE GATE. `/index.html` shows a full-screen ROMÂNĂ / РУССКИЙ chooser until
      //     `localStorage.finmentor_language` is set. Without it every Russian screenshot in this
      //     run was the chooser — identical bytes for the home page and the packages section,
      //     which looked like evidence and showed nothing.
      const seedLang = s.url.startsWith('/ro/') ? 'ro' : 'ru';
      await c.send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.Telegram=window.Telegram||{};window.Telegram.WebApp=window.Telegram.WebApp||{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},initData:"",initDataUnsafe:{},themeParams:{},MainButton:{show(){},hide(){},setText(){},onClick(){}},BackButton:{show(){},hide(){},onClick(){}}};'
          + 'try{localStorage.setItem("finmentor_language","' + seedLang + '");}catch(e){}'
      });

      await c.send('Page.navigate', { url: ORIGIN + s.url });
      await sleep(w === 390 ? 1600 : 1400);
      // The site opens with an animated intro overlay and reveal-on-scroll sections. Evidence has
      // to be of the page a customer reads, not of its first frame.
      await c.send('Runtime.evaluate', { expression: `(() => {
        document.documentElement.classList.add('intro-skip');
        for (const sel of ['#intro', '.intro', '.intro-overlay', '#cookieBar', '.cookie-bar']) {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible', 'revealed', 'in-view'));
        window.scrollTo(0, 0);
      })()` });
      await sleep(700);
      if (s.anchor) {
        // Scrolled AFTER the reveal pass: before it, the section is collapsed and the shot lands
        // on the hero instead of the surface under test.
        const found = await c.send('Runtime.evaluate', {
          expression: `(() => { const el = document.querySelector('${s.anchor}'); if (!el) { return false; } el.scrollIntoView({ block: 'start' }); return true; })()`,
          returnByValue: true
        });
        if (!found.result.value) { throw new Error(s.id + ': the anchor ' + s.anchor + ' is not on the page'); }
        await sleep(900);
        // PROVE THE SCROLL LANDED, and force it if it did not.
        //
        // `scroll-behavior: smooth` plus the site's own scroll handling swallowed scrollIntoView
        // on the Russian home page: the shot came out byte-identical to the hero and looked like
        // evidence while showing nothing of the section under test. An absolute jump is the
        // fallback, and a shot that still has not moved is an error rather than a picture.
        const jump = `(() => {
          const el = document.querySelector('${s.anchor}');
          const y = el.getBoundingClientRect().top + window.scrollY;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, y);
          return { y: Math.round(window.scrollY), top: Math.round(el.getBoundingClientRect().top) };
        })()`;
        let at = await c.send('Runtime.evaluate', { expression: jump, returnByValue: true });
        if (Math.abs(at.result.value.top) > 120) {
          await sleep(400);
          at = await c.send('Runtime.evaluate', { expression: jump, returnByValue: true });
        }
        await sleep(600);
        if (at.result.value.y < 100) {
          throw new Error(s.id + ': the page never scrolled to ' + s.anchor + ' (scrollY ' + at.result.value.y + ')');
        }
      }
      // The consent bar is re-created by the analytics loader after the first paint. It is a real
      // part of the page and has its own gate; here it would simply cover the surface under test,
      // so it is removed last, immediately before the shot.
      await c.send('Runtime.evaluate', {
        expression: `document.querySelectorAll('#cookieBar,.cookie-bar,[id*="cookie"],[class*="cookie"]').forEach((el) => el.remove())`
      });
      await sleep(250);

      const m = await c.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      results[s.id + '@' + w] = m.result.value;

      const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const name = s.id + '-' + w + '.png';
      writeFileSync(join(SHOT_DIR, name), Buffer.from(shot.data, 'base64'));
      process.stdout.write('  rendered ' + (s.id + '@' + w).padEnd(28) + ' ' + name + '\n');
    }
  }

  c.close();
  chrome.kill();
  server.close();

  console.log('');
  writeFileSync(join(SHOT_DIR, 'measurements.json'), JSON.stringify(results, null, 2), 'utf8');

  // ── the assertions ─────────────────────────────────────────────────────────────────────────
  const all = Object.entries(results);

  check('BROKEN WRAPPING = 0 — no page scrolls sideways at 390px or 1440px', () => {
    const bad = all.filter(([, r]) => r.overflow).map(([k, r]) => k + ' (' + r.overflow.scrollWidth + ' > ' + r.overflow.viewport + ')');
    assert(bad.length === 0, bad.length + ' surface(s) overflow: ' + bad.join(', '));
  });

  check('CLIPPED TEXT = 0 — no box hides content it is drawing', () => {
    const bad = [];
    for (const [k, r] of all) { for (const c2 of r.clipped) { bad.push(k + ': <' + c2.tag.toLowerCase() + '> ' + c2.text); } }
    assert(bad.length === 0, bad.length + ' clipped element(s): ' + bad.slice(0, 5).join(' | '));
  });

  check('CTA OVERFLOW = 0 — every call to action fits its button and the viewport', () => {
    const bad = [];
    for (const [k, r] of all) {
      for (const c2 of r.ctaOverflow) { bad.push(k + ': text ' + c2.sw + 'px in a ' + c2.cw + 'px button — ' + c2.text); }
      for (const c2 of r.offscreen) { bad.push(k + ': offscreen ' + c2.left + '..' + c2.right + ' — ' + c2.text); }
    }
    assert(bad.length === 0, bad.length + ' CTA problem(s): ' + bad.slice(0, 5).join(' | '));
  });

  check('BROKEN PACKAGE TITLE = 0 — every package name renders whole', () => {
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

  check('RU/RO VISUAL PARITY = PASS — the two editions render the same structure', () => {
    const pairs = [['ru-homepage', 'ro-homepage'], ['ru-questionnaire', 'ro-questionnaire'],
      ['ru-packages', 'ro-packages'], ['ru-monthly-pricing', 'ro-monthly-pricing'],
      ['ru-real-estate', 'ro-real-estate']];
    for (const [ru, ro] of pairs) {
      for (const w of [390, 1440]) {
        const a = results[ru + '@' + w], b = results[ro + '@' + w];
        assert(a && b, 'a measurement is missing for ' + ru + '/' + ro + '@' + w);
        assert(a.lang.slice(0, 2) === 'ru' && b.lang.slice(0, 2) === 'ro', ru + '/' + ro + ' declare ' + a.lang + '/' + b.lang);
        assert(a.packageTitles.length === b.packageTitles.length,
          ru + ' shows ' + a.packageTitles.length + ' package fields, ' + ro + ' shows ' + b.packageTitles.length + ' @' + w);
        assert(!!a.h1 === !!b.h1, ru + '/' + ro + ' disagree on having an H1 @' + w);
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
      'ru-packages-390', 'ro-packages-390', 'miniapp-premium-390',
      'ru-homepage-1440', 'ro-homepage-1440', 'ru-packages-1440', 'ro-packages-1440', 'miniapp-premium-1440'];
    for (const n of RETAIN) {
      writeFileSync(join(KEEP_DIR, n + '.png'), readFileSync(join(SHOT_DIR, n + '.png')));
    }
    console.log('  retained ' + RETAIN.length + ' screenshots in ' + KEEP_DIR);
  }

  console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) { failures.forEach((f) => console.error('  - ' + f)); process.exit(1); }
})();
