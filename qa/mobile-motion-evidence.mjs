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
// Pass 2 owner-review set: identical viewport, scroll, start point, engine and content state for
// both labels ("before" from the production worktree, "pass2" from the branch).
//   node qa/mobile-motion-evidence.mjs --only record2 --label before|pass2 --out <dir>
const LABEL = argOf('--label') || PHASE;
const OUT2 = argOf('--out') || join(ROOT, 'qa-artifacts', 'mobile-motion-pass-2');
const RECORD2 = [
  { id: '01_homepage_390', path: '/', width: 390, height: 844 },
  { id: '02_homepage_430', path: '/', width: 430, height: 932 },
  { id: '03_about_390', path: '/about.html', width: 390, height: 844 },
  { id: '04_practice_390', path: '/cases.html', width: 390, height: 844 },
  { id: '05_real-estate_390', path: '/real-estate-control-system.html', width: 390, height: 844 },
  { id: '06_materials_390', path: '/materials.html', width: 390, height: 844 },
];
const PHOTO_SEL = '.industries__figure, [data-fx="unveil"], .capital-management, .fx-stage__media';
const DESKTOP_WIDTHS = [1024, 1280, 1440, 1728];
const DESKTOP_PAGES = ['/', '/about.html', '/business-models.html', '/capital-management.html'];
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
function contactSheet(video, rec, outDir = EVI) {
  if (!FFMPEG) return null;
  const dir = mkdtempSync(join(tmpdir(), 'fm-frames-'));
  // A third of the device width keeps a whole 16–25 s scroll under ~1 MB per sheet.
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-r', '2', '-vf', `scale=${Math.round(rec.width / 3)}:-1`, join(dir, 'f_%03d.png')], { encoding: 'utf8' });
  if (r.status !== 0) { console.log('ffmpeg: ' + r.stderr); return null; }
  const frames = readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => join(dir, f));
  if (!frames.length) return null;
  const sheet = join(outDir, `${rec.name}-sheet.png`);
  writeFileSync(sheet, tileFrames(frames, { cols: 6 }));
  rmSync(dir, { recursive: true, force: true });
  return sheet;
}

// Four full-size frames at given seconds — initial → entering → reveal → settled — in one strip.
function keyStages(video, name, times, outDir) {
  if (!FFMPEG) return null;
  const dir = mkdtempSync(join(tmpdir(), 'fm-stages-'));
  const frames = [];
  times.forEach((t, i) => {
    const f = join(dir, `s_${i}.png`);
    const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', f], { encoding: 'utf8' });
    if (r.status === 0 && existsSync(f)) frames.push(f);
  });
  if (frames.length < 2) { rmSync(dir, { recursive: true, force: true }); return null; }
  const strip = join(outDir, `${name}-stages.png`);
  writeFileSync(strip, tileFrames(frames, { cols: 4, gap: 10 }));
  rmSync(dir, { recursive: true, force: true });
  return strip;
}

// ── 5. Pass 2 owner-review recordings: before vs pass2, same everything ─────────────────
if (ONLY === 'record2') {
  mkdirSync(OUT2, { recursive: true });
  const browser = await webkit.launch();
  for (const rec of RECORD2) {
    const ctx = await browser.newContext({ viewport: { width: rec.width, height: rec.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, recordVideo: { dir: OUT2, size: { width: rec.width, height: rec.height } } });
    await ctx.addInitScript(BOOT(langOf(rec.path)));
    const page = await ctx.newPage();
    await page.goto(ORIGIN + rec.path, { waitUntil: 'load' });
    await sleep(900);
    // Where the first editorial photograph sits, so the key-stage strip can be cut around it.
    const photoY = await page.evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(PHOTO_SEL)})].find(e=>e.getBoundingClientRect().top+scrollY>innerHeight*0.6);return el?Math.round(el.getBoundingClientRect().top+scrollY):null;})()`);
    const docH = await page.evaluate('document.documentElement.scrollHeight');
    const t0 = Date.now();
    await page.evaluate(SLOW_SCROLL);
    const scrollMs = Date.now() - t0;
    const video = page.video();
    await ctx.close();
    const out = join(OUT2, `${rec.id}_${LABEL}.webm`);
    renameSync(await video.path(), out);
    const sheet = contactSheet(out, { name: `${rec.id}_${LABEL}`, width: rec.width }, OUT2);
    const strip = stagesFor(out, rec, LABEL, photoY, docH, scrollMs);
    results.recordings.push({ id: rec.id, label: LABEL, path: rec.path, width: rec.width, height: rec.height, photoY, docH, scrollMs, video: out, sheet, strip });
    console.log(`record2 ${rec.id}_${LABEL}: photoY=${photoY} scroll=${scrollMs}ms sheet=${!!sheet} strip=${!!strip}`);
  }
  await browser.close();
}

// Rebuild only the key-stage strips from recordings already on disk (uses the measured scroll
// pace stored in evidence_record2_<label>.json):  --only stages2 --label before|pass2 --out <dir>
if (ONLY === 'stages2') {
  const manifest = JSON.parse(readFileSync(join(OUT2, `evidence_record2_${LABEL}.json`), 'utf8'));
  const browser = await webkit.launch();
  for (const r of manifest.recordings) {
    let docH = r.docH;
    if (!docH) { // older manifest: read the page height once, same viewport
      const ctx = await browser.newContext({ viewport: { width: r.width, height: r.height || (r.width === 430 ? 932 : 844) }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(BOOT(langOf(r.path)));
      const page = await ctx.newPage(); await page.goto(ORIGIN + r.path, { waitUntil: 'load' }); await sleep(600);
      docH = await page.evaluate('document.documentElement.scrollHeight'); await ctx.close();
    }
    const rec = { id: r.id, width: r.width, height: r.height || (r.width === 430 ? 932 : 844) };
    r.strip = stagesFor(r.video, rec, LABEL, r.photoY, docH, r.scrollMs);
    r.docH = docH;
    console.log(`stages2 ${r.id}_${LABEL}: ${r.strip ? 'ok' : 'no photograph after the first viewport'}`);
  }
  await browser.close();
  writeFileSync(join(OUT2, `evidence_record2_${LABEL}.json`), JSON.stringify(manifest, null, 2));
}

// Key stages around the first editorial photograph, cut at the MEASURED scroll pace of that
// recording: initial (photo still below the trigger) → entering → mid-reveal → settled.
function stagesFor(video, rec, label, photoY, docH, scrollMs) {
  if (photoY === null || !docH || !scrollMs) return null;
  const pace = Math.max(1, (docH - rec.height) / Math.max(1, (scrollMs - 1500) / 1000)); // px/s
  const tPhoto = 0.9 + Math.max(0, photoY - rec.height * 0.75) / pace;
  return keyStages(video, `${rec.id}_${label}`, [Math.max(0.3, tPhoto - 0.5), tPhoto + 0.25, tPhoto + 0.7, tPhoto + 1.6], OUT2);
}

// ── 6. Desktop freeze proof: computed motion styles + settled end-state screenshots ──────
if (ONLY === 'desktop') {
  mkdirSync(OUT2, { recursive: true });
  const browser = await launchChromium();
  const desktop = [];
  for (const width of DESKTOP_WIDTHS) for (const path of DESKTOP_PAGES) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(BOOT('ru'));
    const page = await ctx.newPage();
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
    await sleep(600);
    const styles = await page.evaluate(`(()=>{const pick=['transition-duration','transition-delay','transition-timing-function','transform','clip-path','opacity','animation-name','animation-duration'];
      const sel=['.reveal','.overline','.section-title','.hero__media img','.capital-management__media img','.industries__figure img','[data-fx]','[data-fx="unveil"] img','.fx-stage__media img','.package .m-c'];
      const out={};for(const s of sel){const e=document.querySelector(s);if(!e)continue;const c=getComputedStyle(e);out[s]={};for(const p of pick)out[s][p]=c.getPropertyValue(p);}
      out.__stepsRoot=getComputedStyle(document.body).getPropertyValue('--m-dur')+'|'+getComputedStyle(document.body).getPropertyValue('--m-scale');return out;})()`);
    await page.evaluate(AUDIT_SCROLL);
    await page.evaluate('window.scrollTo(0,0)'); await sleep(400);
    const shot = join(OUT2, `desktop_${path.replace(/[^a-z]+/gi, '') || 'home'}_${width}_${LABEL}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    desktop.push({ path, width, styles, shot });
    console.log(`desktop ${path} @${width}: styles captured, end-state screenshot`);
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT2, `desktop_${LABEL}.json`), JSON.stringify(desktop, null, 2));
}

// Pass 2 review modes write their own manifest beside the recordings, never into the phase set.
if (ONLY === 'record2' || ONLY === 'desktop' || ONLY === 'stages2') {
  if (ONLY !== 'stages2') writeFileSync(join(OUT2, `evidence_${ONLY}_${LABEL}.json`), JSON.stringify(results, null, 2));
  server.close();
  console.log('done →', OUT2);
  process.exit(0);
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
