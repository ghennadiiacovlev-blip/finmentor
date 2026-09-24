#!/usr/bin/env node
// FINMENTOR — mobile motion evidence (owner review) and regression numbers.
//
//   node qa/mobile-motion-evidence.mjs --phase before|after [--only record|perf|reduced|webkit]
//
// WHAT IT PRODUCES
//   qa-artifacts/mobile-motion/<phase>/*.webm        WebKit recordings of a slow scroll (not tracked)
//   qa-evidence/mobile-motion/<phase>/*.png          contact sheets extracted from those recordings
//   qa-evidence/mobile-motion/<phase>/metrics.json   Chromium LCP / CLS / long tasks per page and width,
//                                                    WebKit reveal completeness, reduced-motion audit
//
// WebKit is the acceptance browser (iPhone Safari / WKWebView behave like it); Chromium supplies
// the web-vitals numbers (LCP, layout-shift) that WebKit does not expose. Nothing here contacts a
// production service: the site is served from this checkout on a loopback port.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tileFrames } from './lib/png-tile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const PHASE = argOf('--phase') || 'after';
const ONLY = argOf('--only');
const PORT = 8151;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ART = join(ROOT, 'qa-artifacts', 'mobile-motion', PHASE);
const EVI = join(ROOT, 'qa-evidence', 'mobile-motion', PHASE);
mkdirSync(ART, { recursive: true }); mkdirSync(EVI, { recursive: true });

// Playwright lives in the npx cache on this machine (the repo has no npm dependencies).
async function playwright() {
  // The npx-cached copy is the one whose browsers (webkit-2359, chromium-1234) are installed;
  // a newer global install would demand browsers that are not. Prefer the cache.
  const cache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : '';
  const hits = existsSync(cache) ? readdirSync(cache).map((d) => join(cache, d, 'node_modules', 'playwright', 'index.mjs')).filter(existsSync) : [];
  if (hits.length) return import(pathToFileURL(hits[0]).href);
  return import('playwright');
}
const FFMPEG = (() => {
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : '';
  if (!existsSync(base)) return null;
  const dir = readdirSync(base).find((d) => d.startsWith('ffmpeg-'));
  if (!dir) return null;
  const exe = readdirSync(join(base, dir)).find((f) => /^ffmpeg/.test(f));
  return exe ? join(base, dir, exe) : null;
})();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const abs = normalize(join(ROOT, p));
  if (!abs.startsWith(normalize(ROOT)) || !existsSync(abs)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' }); res.end(readFileSync(abs));
});
if (ONLY !== 'sheets') await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const { chromium, webkit } = await playwright();
// Chromium numbers come from the locally installed Google Chrome (no separate download).
const launchChromium = () => chromium.launch({ channel: 'chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRIORITY = ['/', '/about.html', '/cases.html', '/capital-management.html', '/real-estate-control-system.html', '/materials.html', '/questionnaire.html', '/ro/', '/ro/cases.html'];
const RECORD = [
  { name: 'homepage-390-mobile-motion', path: '/', width: 390, height: 844 },
  { name: 'homepage-430-mobile-motion', path: '/', width: 430, height: 932 },
  { name: 'practice-390-mobile-motion', path: '/cases.html', width: 390, height: 844 },
  { name: 'real-estate-390-mobile-motion', path: '/real-estate-control-system.html', width: 390, height: 844 },
  { name: 'ro-homepage-390-mobile-motion', path: '/ro/', width: 390, height: 844 },
];
const BOOT = (lang) => `try{localStorage.setItem('finmentor_language','${lang}');sessionStorage.setItem('fm_intro_played','1');localStorage.setItem('finmentor_cookie_consent','deny');}catch(e){}`;
const langOf = (p) => (p.startsWith('/ro') ? 'ro' : 'ru');
const results = { phase: PHASE, head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(), captured: new Date().toISOString(), perf: [], webkit: [], reduced: [], recordings: [] };

// A slow, human-paced scroll to the end of the page: ~640 px/s in 40 px steps.
const SLOW_SCROLL = `(async()=>{const h=()=>document.documentElement.scrollHeight-innerHeight;for(let y=0;y<h();y+=40){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,62));}window.scrollTo(0,h());await new Promise(r=>setTimeout(r,1500));return scrollY;})()`;
// The audit loops walk faster (~1.6 px/ms) — enough for every observer tick, without the review pace.
const AUDIT_SCROLL = SLOW_SCROLL.replace('y+=40', 'y+=80').replace('setTimeout(r,62)', 'setTimeout(r,50)').replace('setTimeout(r,1500)', 'setTimeout(r,1200)');
// Motion targets still hidden or clipped on screen after the scroll — the "stuck content" check.
const STUCK = `(()=>{const t=[...document.querySelectorAll('.reveal,[data-fx],.m-c')];const vis=t.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight});
  const stuck=vis.filter(e=>{const s=getComputedStyle(e);return parseFloat(s.opacity)<0.9||(s.clipPath&&s.clipPath!=='none'&&!/inset\\(0(px)?(\\s0(px)?){0,3}/.test(s.clipPath))});
  return {targets:t.length,onScreen:vis.length,stuck:stuck.length,samples:stuck.slice(0,4).map(e=>e.className||e.tagName)};})()`;

// ── 1. Chromium web vitals at mobile widths ─────────────────────────────────────────────
if (!ONLY || ONLY === 'perf') {
  const browser = await launchChromium();
  for (const width of [390, 430]) for (const path of PRIORITY) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
    await ctx.addInitScript(BOOT(langOf(path)) + `window.__vitals={lcp:0,cls:0,long:0,shifts:[]};try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__vitals.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput){window.__vitals.cls+=e.value;if(e.value>0.001)window.__vitals.shifts.push({t:Math.round(e.startTime),v:+e.value.toFixed(4)})}}).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver(l=>{for(const e of l.getEntries())window.__vitals.long+=e.duration}).observe({type:'longtask',buffered:true});}catch(e){}`);
    const page = await ctx.newPage();
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
    await sleep(1200);
    const afterLoad = await page.evaluate('({lcp:Math.round(window.__vitals.lcp),cls:+window.__vitals.cls.toFixed(4)})');
    await page.evaluate(AUDIT_SCROLL);
    const v = await page.evaluate('({lcp:Math.round(window.__vitals.lcp),cls:+window.__vitals.cls.toFixed(4),long:Math.round(window.__vitals.long),shifts:window.__vitals.shifts.slice(0,6)})');
    const stuck = await page.evaluate(STUCK);
    results.perf.push({ path, width, lcpMs: v.lcp, clsAfterLoad: afterLoad.cls, clsAfterScroll: v.cls, longTaskMs: v.long, shifts: v.shifts, stuck });
    console.log(`perf ${path} @${width}: LCP ${v.lcp}ms  CLS ${afterLoad.cls} → ${v.cls}  long ${v.long}ms  stuck ${stuck.stuck}/${stuck.onScreen}`);
    await ctx.close();
  }
  await browser.close();
}

// ── 2. WebKit: reveal completeness after a slow scroll, at every mobile width ───────────
if (!ONLY || ONLY === 'webkit') {
  const browser = await webkit.launch();
  for (const width of [320, 390, 430, 820]) for (const path of PRIORITY) {
    const ctx = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 1100 }, deviceScaleFactor: 1, isMobile: width <= 430, hasTouch: true });
    await ctx.addInitScript(BOOT(langOf(path)));
    const page = await ctx.newPage();
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
    await sleep(800);
    const heroPaint = await page.evaluate(`(()=>{const h=document.querySelector('h1');if(!h)return null;const s=getComputedStyle(h);return {opacity:s.opacity,top:Math.round(h.getBoundingClientRect().top)}})()`);
    await page.evaluate(AUDIT_SCROLL);
    const stuck = await page.evaluate(STUCK);
    const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    const notVisible = await page.evaluate(`document.querySelectorAll('.reveal:not(.is-visible):not(.m-instant), [data-fx]:not(.is-visible):not(.m-instant)').length`);
    results.webkit.push({ path, width, heroPaint, overflow, stuck, notRevealedAfterScroll: notVisible });
    console.log(`webkit ${path} @${width}: overflow ${overflow}  stuck ${stuck.stuck}/${stuck.onScreen}  unrevealed ${notVisible}  h1 opacity ${heroPaint && heroPaint.opacity}`);
    await ctx.close();
  }
  await browser.close();
}

// ── 3. WebKit reduced motion: everything visible at once, nothing transformed or clipped ─
if (!ONLY || ONLY === 'reduced') {
  const browser = await webkit.launch();
  for (const path of PRIORITY) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await ctx.addInitScript(BOOT(langOf(path)));
    const page = await ctx.newPage();
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
    await sleep(150);
    const r = await page.evaluate(`(()=>{const t=[...document.querySelectorAll('.reveal,[data-fx],.m-c,.hero__media img,.industries__figure img,.fx-stage__media img')];
      const bad=t.filter(e=>{const s=getComputedStyle(e);return parseFloat(s.opacity)<1||(s.transform&&s.transform!=='none')||(s.clipPath&&s.clipPath!=='none')||(s.animationName&&s.animationName!=='none')});
      return {mjs:document.documentElement.classList.contains('m-js'),targets:t.length,notImmediate:bad.length,samples:bad.slice(0,5).map(e=>e.className||e.tagName)};})()`);
    results.reduced.push({ path, ...r });
    console.log(`reduced ${path}: m-js=${r.mjs} targets ${r.targets} not-immediate ${r.notImmediate} ${r.samples.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
}

// ── 4. WebKit recordings + contact sheets ───────────────────────────────────────────────
if (!ONLY || ONLY === 'record') {
  const browser = await webkit.launch();
  for (const rec of RECORD) {
    const ctx = await browser.newContext({ viewport: { width: rec.width, height: rec.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, recordVideo: { dir: ART, size: { width: rec.width, height: rec.height } } });
    await ctx.addInitScript(BOOT(langOf(rec.path)));
    const page = await ctx.newPage();
    await page.goto(ORIGIN + rec.path, { waitUntil: 'load' });
    await sleep(900);
    await page.evaluate(SLOW_SCROLL);
    const video = page.video();
    await ctx.close();
    const tmp = await video.path();
    const out = join(ART, `${rec.name}.webm`);
    renameSync(tmp, out);
    const sheet = contactSheet(out, rec);
    results.recordings.push({ name: rec.name, path: rec.path, width: rec.width, video: out.replace(ROOT, '.').replace(/\\/g, '/'), sheet: sheet && sheet.replace(ROOT, '.').replace(/\\/g, '/') });
    console.log(`recorded ${rec.name} → ${sheet ? 'sheet ok' : 'no sheet'}`);
  }
  await browser.close();
}
// Sheets only (from recordings already on disk): node qa/mobile-motion-evidence.mjs --phase before --only sheets
if (ONLY === 'sheets') {
  for (const rec of RECORD) {
    const out = join(ART, `${rec.name}.webm`);
    if (!existsSync(out)) { console.log('missing ' + out); continue; }
    const sheet = contactSheet(out, rec);
    results.recordings.push({ name: rec.name, path: rec.path, width: rec.width, video: out.replace(ROOT, '.').replace(/\\/g, '/'), sheet: sheet && sheet.replace(ROOT, '.').replace(/\\/g, '/') });
    console.log(`sheet ${rec.name} → ${sheet ? 'ok' : 'failed'}`);
  }
}

// Two frames per second, half size, six per row: the whole scroll on one reviewable page.
// Playwright's ffmpeg has no tile filter, so frames are extracted and laid out here.
function contactSheet(video, rec) {
  if (!FFMPEG) return null;
  const dir = mkdtempSync(join(tmpdir(), 'fm-frames-'));
  // A third of the device width keeps a whole 16–25 s scroll under ~1 MB per sheet.
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-r', '2', '-vf', `scale=${Math.round(rec.width / 3)}:-1`, join(dir, 'f_%03d.png')], { encoding: 'utf8' });
  if (r.status !== 0) { console.log('ffmpeg: ' + r.stderr); return null; }
  const frames = readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => join(dir, f));
  if (!frames.length) return null;
  const sheet = join(EVI, `${rec.name}-sheet.png`);
  writeFileSync(sheet, tileFrames(frames, { cols: 6 }));
  rmSync(dir, { recursive: true, force: true });
  return sheet;
}

// A partial run (--only …) keeps whatever the earlier phases of this evidence set recorded.
const metricsPath = join(EVI, 'metrics.json');
let merged = results;
if (ONLY && existsSync(metricsPath)) {
  try { const prev = JSON.parse(readFileSync(metricsPath, 'utf8')); merged = { ...prev, captured: results.captured, head: results.head }; } catch {}
  for (const k of ['perf', 'webkit', 'reduced', 'recordings']) if (results[k].length) merged[k] = results[k];
}
writeFileSync(metricsPath, JSON.stringify(merged, null, 2));
server.close();
console.log('done →', EVI);
