#!/usr/bin/env node
// FINMENTOR — Client voices design preview (owner review only).
//
//   node qa/client-voices-preview.mjs [outDir]
//
// Serves the site locally with qa/fixtures/client-voices.mock.mjs substituted for
// data/testimonials.js, so the hidden module renders with clearly marked DESIGN MOCK text,
// and captures the section on the RU and RO homepages at the review widths. Nothing here
// touches the repository's data file; the mock never leaves this process.
// Default output: qa-evidence/client-voices/  (client-voices-<width>-<RU|RO>.png + manifest).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MOCK_TESTIMONIALS_JS } from './fixtures/client-voices.mock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = process.argv[2] || join(ROOT, 'qa-evidence', 'client-voices');
const PORT = 8137, DEBUG_PORT = 9137;
mkdirSync(OUT, { recursive: true });

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA.replace(/\\/g, '/') + '/Google/Chrome/Application/chrome.exe' : ''].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('Chrome not found');
const WIDTHS = [1440, 1280, 820, 430, 390, 320];
const PAGES = [{ path: '/index.html', lang: 'ru', tag: 'RU' }, { path: '/ro/index.html', lang: 'ro', tag: 'RO' }];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/data/testimonials.js') { res.writeHead(200, { 'content-type': MIME['.js'] }); res.end(MOCK_TESTIMONIALS_JS); return; }
  const abs = normalize(join(ROOT, p));
  if (!abs.startsWith(normalize(ROOT)) || !existsSync(abs)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(abs));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'fm-voices-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version = null;
for (let i = 0; i < 50 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(); } catch { await sleep(200); } }
if (!version) throw new Error('chrome did not start');

function cdp(url) {
  const ws = new WebSocket(url); let id = 0; const pending = new Map(); const handlers = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    else if (m.method && handlers.has(m.method)) handlers.get(m.method).forEach((fn) => fn(m.params)); });
  return { ready: new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('ws'))); }),
    on(method, fn) { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); },
    send(method, params, sessionId) { const n = ++id; return new Promise((resolve, reject) => { pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params: params || {}, sessionId })); }); },
    close() { ws.close(); } };
}
const browser = cdp(version.webSocketDebuggerUrl); await browser.ready;
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
const send = (m, p) => browser.send(m, p, S);
await send('Page.enable'); await send('Runtime.enable');
let loadResolve = null; browser.on('Page.loadEventFired', () => { if (loadResolve) loadResolve(); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const DETERMINISM = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}
html,body,*{scroll-behavior:auto!important}.reveal,[data-reveal-delay]{opacity:1!important;transform:none!important}.fm-cookie{display:none!important}`;

const manifest = [];
let bootstrapId = null;
for (const motion of ['reduced', 'normal']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion === 'reduced' ? 'reduce' : 'no-preference' }] });
  for (const page of PAGES) for (const width of WIDTHS) {
    if (motion === 'normal' && ![1440, 390].includes(width)) continue;
    const height = width <= 430 ? 844 : width <= 820 ? 1100 : 1000;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
    // One bootstrap at a time: a stale reduced-motion stylesheet must not leak into the motion run.
    if (bootstrapId) { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: bootstrapId }); }
    bootstrapId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('finmentor_language','${page.lang}');sessionStorage.setItem('fm_intro_played','1');
      var s=document.createElement('style');s.textContent=${JSON.stringify(motion === 'reduced' ? DETERMINISM : DETERMINISM.replace('.reveal,[data-reveal-delay]{opacity:1!important;transform:none!important}', ''))};(document.head||document.documentElement).appendChild(s);}catch(e){}` })).identifier;
    const loaded = new Promise((r) => { loadResolve = r; });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${page.path}` });
    await loaded; await sleep(500);
    // Scroll so the section sits below the fixed header (never inside the clip), then let the
    // site's own reveal pass finish under normal motion before measuring.
    await evalJs(`(async()=>{const el=document.getElementById('client-voices');window.scrollTo(0,el.getBoundingClientRect().top+scrollY-160);await new Promise(r=>setTimeout(r,${motion === 'reduced' ? 250 : 3500}));return true;})()`);
    await evalJs(`document.fonts ? document.fonts.ready.then(()=>true) : true`);
    const info = await evalJs(`(()=>{const s=document.getElementById('client-voices');const r=s.getBoundingClientRect();const list=s.querySelector('[data-client-voices-list]');
      const quotes=[...s.querySelectorAll('.client-voices__quote p')].map(p=>{const q=p.getBoundingClientRect();return {w:Math.round(q.width),h:Math.round(q.height),clipped:p.scrollWidth>p.clientWidth+1}});
      const attrs=[...s.querySelectorAll('.client-voices__attr')].map(a=>{const q=a.getBoundingClientRect();return {left:Math.round(q.left)}});
      const visibleReveal=[...s.querySelectorAll('.reveal')].every(e=>getComputedStyle(e).opacity==='1');
      return {hidden:s.hidden, top:Math.round(r.top+scrollY), height:Math.round(r.height), voices:list.querySelectorAll('.client-voices__voice').length, quotes, attrs, visibleReveal,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, sectionOverflow: s.scrollWidth - s.clientWidth };})()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: info.top - 8, width, height: info.height + 16, scale: 1 } });
    const name = motion === 'reduced' ? `client-voices-${width}-${page.tag}.png` : `client-voices-${width}-${page.tag}-motion.png`;
    writeFileSync(join(OUT, name), Buffer.from(shot.data, 'base64'));
    if (motion === 'reduced' && [1440, 390].includes(width)) {
      // context shot: the seam Practice → Client voices → Materials
      const ctx = await evalJs(`(()=>{const a=document.getElementById('cases').getBoundingClientRect();const b=document.getElementById('knowledge').getBoundingClientRect();return {y:Math.round(a.bottom+scrollY-${width <= 430 ? 700 : 900}),h:Math.round(b.top-a.bottom+${width <= 430 ? 700 : 900}+${width <= 430 ? 500 : 700})};})()`);
      const cs = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: ctx.y, width, height: ctx.h, scale: 1 } });
      writeFileSync(join(OUT, `client-voices-flow-${width}-${page.tag}.png`), Buffer.from(cs.data, 'base64'));
    }
    manifest.push({ page: page.path, width, motion, ...info });
    console.log(`${name}  voices=${info.voices} h=${info.height} overflow=${info.overflow}/${info.sectionOverflow} clipped=${info.quotes.some((q) => q.clipped)} reveal=${info.visibleReveal}`);
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ note: 'DESIGN MOCK content — not client testimonials', captured: new Date().toISOString(), surfaces: manifest }, null, 2));
browser.close(); chrome.kill(); server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
console.log('done', manifest.length, 'surfaces →', OUT);
