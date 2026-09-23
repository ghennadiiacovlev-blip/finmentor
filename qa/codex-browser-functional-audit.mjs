#!/usr/bin/env node
// Temporary release-audit harness: dependency-free local Chrome/CDP functional checks.
// It never submits valid data and blocks non-local network resolution.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' };

function localServer() {
  return createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
}

class CDP {
  constructor(url) { this.url = url; this.seq = 0; this.pending = new Map(); this.listeners = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket open timeout')), 5000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(msg.error.message)); else waiter.resolve(msg.result || {});
        return;
      }
      for (const fn of this.listeners.get(msg.method) || []) fn(msg.params || {});
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  once(method, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const fn = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn));
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.listeners.set(method, (this.listeners.get(method) || []).filter((x) => x !== fn));
        reject(new Error(method + ' timeout'));
      }, timeout);
      this.on(method, fn);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitForTarget(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((x) => x.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('Chrome CDP target did not appear');
}

async function main() {
  assert(existsSync(chrome), 'Chrome executable missing');
  const server = localServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sitePort = server.address().port;
  const debugPort = 9337;
  const profile = mkdtempSync(join(tmpdir(), 'finmentor-codex-browser-'));
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });

  let cdp;
  try {
    cdp = new CDP(await waitForTarget(debugPort));
    await cdp.open();
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable'), cdp.send('Log.enable')]);
    const localOrigin = `http://127.0.0.1:${sitePort}`;
    const exceptions = [];
    const consoleErrors = [];
    const localFailures = [];
    const requests = new Map();
    cdp.on('Runtime.exceptionThrown', (p) => exceptions.push(p.exceptionDetails?.text || 'exception'));
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry?.level !== 'error') return;
      const expectedBlockedExternal = /ERR_NAME_NOT_RESOLVED/.test(p.entry.text || '')
        && p.entry.url && !p.entry.url.startsWith(localOrigin);
      if (!expectedBlockedExternal) consoleErrors.push((p.entry.url ? p.entry.url + ': ' : '') + p.entry.text);
    });
    cdp.on('Network.requestWillBeSent', (p) => requests.set(p.requestId, p.request.url));
    cdp.on('Network.loadingFailed', (p) => {
      const url = requests.get(p.requestId) || '';
      if (!url.startsWith(localOrigin) || (p.errorText || '').includes('ERR_ABORTED')) return;
      localFailures.push(`${p.errorText || 'loadingFailed'} ${url}`);
    });
    cdp.on('Network.responseReceived', (p) => { if (p.response.url.startsWith(localOrigin) && p.response.status >= 400) localFailures.push(`${p.response.status} ${p.response.url}`); });

    async function evaluate(expression) {
      const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || 'evaluation failed');
      return out.result?.value;
    }
    async function navigate(path) {
      console.log('NAVIGATE=' + path);
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: localOrigin + path });
      await loaded;
      await sleep(120);
    }
    async function waitPath(path) {
      for (let i = 0; i < 80; i++) {
        if (await evaluate('location.pathname') === path && await evaluate('document.readyState') === 'complete') return;
        await sleep(100);
      }
      throw new Error('history navigation did not reach ' + path);
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const routes = ['/index.html', '/ro/index.html', '/about.html', '/capital-management.html', '/business-models.html', '/materials.html', '/supplier-shelf-credit.html', '/cfo-consultation.html', '/questionnaire.html', '/ro/questionnaire.html', '/privacy.html', '/terms.html', '/thank-you.html', '/404.html'];
    const pageResults = [];
    for (const route of routes) {
      const failureStart = localFailures.length;
      const exceptionStart = exceptions.length;
      await navigate(route);
      const state = await evaluate(`(() => ({
        title: document.title,
        lang: document.documentElement.lang,
        h1: document.querySelectorAll('h1').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
        ready: document.readyState
      }))()`);
      assert(state.ready === 'complete', route + ' did not complete');
      assert(state.h1 === 1, route + ' has ' + state.h1 + ' H1 elements');
      assert(state.overflow <= 1, route + ' overflows by ' + state.overflow + 'px');
      assert(state.brokenImages.length === 0, route + ' broken images: ' + state.brokenImages.join(', '));
      assert(localFailures.length === failureStart, route + ' had a local request failure: ' + localFailures.slice(failureStart).join(' | '));
      assert(exceptions.length === exceptionStart, route + ' had an uncaught exception');
      pageResults.push({ route, ...state });
    }

    await navigate('/index.html');
    console.log('INTERACTION=DESKTOP_NAV_KEYBOARD');
    const desktopNavReady = await evaluate(`(() => { const b=document.querySelector('.nav__toggle'); if(!b)return false; b.focus(); return document.activeElement===b; })()`);
    assert(desktopNavReady, 'desktop disclosure navigation toggle was not focusable');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown' });
    await sleep(80);
    const desktopNavOpen = await evaluate(`(() => { const b=document.querySelector('.nav__toggle'),p=b&&b.closest('.nav__item'); return {expanded:b&&b.getAttribute('aria-expanded'),open:!!p&&p.classList.contains('is-open'),linkFocused:!!document.activeElement&&!!document.activeElement.closest('.nav__panel')}; })()`);
    assert(desktopNavOpen.expanded === 'true' && desktopNavOpen.open && desktopNavOpen.linkFocused, 'ArrowDown did not open desktop navigation and move focus into its panel');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await sleep(80);
    const desktopNavClosed = await evaluate(`(() => { const b=document.querySelector('.nav__toggle'),p=b&&b.closest('.nav__item'); return {expanded:b&&b.getAttribute('aria-expanded'),open:!!p&&p.classList.contains('is-open'),focusReturned:document.activeElement===b}; })()`);
    assert(desktopNavClosed.expanded === 'false' && !desktopNavClosed.open && desktopNavClosed.focusReturned, 'Escape did not close desktop navigation and restore focus');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate('/index.html');
    console.log('INTERACTION=MOBILE_MENU');
    const menuOpened = await evaluate(`(() => {
      const b = document.querySelector('#burger, [data-menu-toggle], .menu-toggle, .mobile-menu-toggle');
      if (!b) return { button: false };
      b.click();
      const d = document.querySelector('.mobile-menu, .nav-mobile, [data-qa-drawer]');
      return { button: true, expanded: b.getAttribute('aria-expanded'), open: !!d && (d.classList.contains('is-open') || d.classList.contains('open') || getComputedStyle(d).visibility !== 'hidden') };
    })()`);
    assert(menuOpened.button && menuOpened.open && menuOpened.expanded === 'true', 'mobile menu did not open accessibly');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
    await sleep(100);
    const menuClosed = await evaluate(`(() => { const b=document.querySelector('#burger, [data-menu-toggle], .menu-toggle, .mobile-menu-toggle'); const d=document.querySelector('.mobile-menu, .nav-mobile, [data-qa-drawer]'); return { expanded:b&&b.getAttribute('aria-expanded'), open:!!d&&(d.classList.contains('is-open')||d.classList.contains('open')) }; })()`);
    assert(menuClosed.expanded === 'false' && !menuClosed.open, 'Escape did not close the mobile menu');

    const disclosure = await evaluate(`(() => { const s=document.querySelector('[data-formats] details summary, .packages details summary'); if(!s)return {found:false}; const d=s.closest('details'); const before=d.open; s.click(); return {found:true,before,after:d.open}; })()`);
    assert(disclosure.found && disclosure.before !== disclosure.after, 'format disclosure did not toggle');

    const homepageInvalid = await evaluate(`(() => { const f=document.getElementById('consultForm'); f.querySelector('button[type="submit"]').click(); return { invalid:f.querySelectorAll(':invalid').length, successHidden:document.getElementById('formSuccess').hidden, buttonDisabled:f.querySelector('button[type="submit"]').disabled }; })()`);
    assert(homepageInvalid.invalid > 0 && homepageInvalid.successHidden && !homepageInvalid.buttonDisabled, 'homepage empty form validation failed or locked submission');

    const homepageSuccess = await evaluate(`(async () => {
      const f=document.getElementById('consultForm'); let calls=0;
      f.querySelector('[name="name"]').value='Audit User';
      f.querySelector('[name="contact"]').value='audit@example.com';
      f.querySelector('[name="consent"]').checked=true;
      window.FMLeadTransport.postLead=() => { calls++; return Promise.resolve({ok:true,requestId:'audit-request'}); };
      window.FMLeadTransport.thankYouUrl=() => '#audit-success';
      f.querySelector('button[type="submit"]').click();
      await new Promise(r=>setTimeout(r,120));
      return {calls,hash:location.hash,disabled:f.querySelector('button[type="submit"]').disabled};
    })()`);
    assert(homepageSuccess.calls === 1 && homepageSuccess.hash === '#audit-success', 'homepage success route did not use one confirmed submission');

    await navigate('/index.html');
    const homepageFailure = await evaluate(`(async () => {
      const f=document.getElementById('consultForm'); let calls=0;
      f.querySelector('[name="name"]').value='Audit User';
      f.querySelector('[name="contact"]').value='audit@example.com';
      f.querySelector('[name="consent"]').checked=true;
      window.FMLeadTransport.postLead=() => { calls++; return Promise.reject(new Error('audit_failure')); };
      f.querySelector('button[type="submit"]').click();
      await new Promise(r=>setTimeout(r,120));
      return {calls,fallback:!document.getElementById('formSuccess').hidden,disabled:f.querySelector('button[type="submit"]').disabled};
    })()`);
    assert(homepageFailure.calls === 1 && homepageFailure.fallback && !homepageFailure.disabled, 'homepage failure state is not recoverable');

    await navigate('/questionnaire.html');
    console.log('INTERACTION=XRAY_VALIDATION');
    const xrayInvalid = await evaluate(`(() => { const f=document.getElementById('qFormV86'); f.querySelector('button[type="submit"]').click(); const box=document.getElementById('qValidate'); return { boxVisible:box && !box.hidden, list:(document.getElementById('qValidateList')||{}).children?.length||0, errors:f.querySelectorAll('.is-error,[aria-invalid="true"]').length, successHidden:document.getElementById('qSuccess').hidden, buttonDisabled:f.querySelector('button[type="submit"]').disabled }; })()`);
    assert(xrayInvalid.boxVisible && xrayInvalid.list > 0 && xrayInvalid.errors > 0 && xrayInvalid.successHidden && !xrayInvalid.buttonDisabled, 'X-Ray empty validation did not expose recoverable errors');

    const fillXray = `(() => {
      const f=document.getElementById('qFormV86'), seen=new Set();
      for (const el of f.elements) {
        if (el.disabled || ['hidden','submit','button','reset'].includes(el.type)) continue;
        if (el.type === 'radio') { if (!seen.has(el.name)) { el.checked=true; seen.add(el.name); } }
        else if (el.type === 'checkbox') el.checked=true;
        else if (el.tagName === 'SELECT') { const option=[...el.options].find(o=>o.value); if(option) el.value=option.value; }
        else if (el.type === 'number') el.value='10';
        else if (/email/i.test(el.name||el.id)) el.value='audit@example.com';
        else if (/telegram/i.test(el.name||el.id)) el.value='@audit';
        else if (/contact/i.test(el.name||el.id)) el.value='audit@example.com';
        else if (/company|business/i.test(el.name||el.id)) el.value='Audit Company';
        else if (/name/i.test(el.name||el.id)) el.value='Audit User';
        else el.value='Audit response';
        el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      }
      return f;
    })()`;
    const xraySuccess = await evaluate(`(async () => {
      const f=${fillXray}; let calls=0;
      window.FMLeadTransport.postLead=() => { calls++; return Promise.resolve({ok:true,requestId:'audit-xray'}); };
      window.FMLeadTransport.thankYouUrl=() => '#audit-xray-success';
      f.querySelector('button[type="submit"]').click();
      await new Promise(r=>setTimeout(r,180));
      return {calls,hash:location.hash,summaryHidden:document.getElementById('qValidate').hidden};
    })()`);
    assert(xraySuccess.calls === 1 && xraySuccess.hash === '#audit-xray-success' && xraySuccess.summaryHidden, 'X-Ray valid success flow failed');

    await navigate('/questionnaire.html');
    const xrayFailure = await evaluate(`(async () => {
      const f=${fillXray}; let calls=0;
      window.FMLeadTransport.postLead=() => { calls++; return Promise.reject(new Error('audit_failure')); };
      f.querySelector('button[type="submit"]').click();
      await new Promise(r=>setTimeout(r,180));
      return {calls,fallback:!document.getElementById('qSuccess').hidden,disabled:f.querySelector('button[type="submit"]').disabled};
    })()`);
    assert(xrayFailure.calls === 1 && xrayFailure.fallback && !xrayFailure.disabled, 'X-Ray failure state is not recoverable');

    await navigate('/ro/index.html');
    const roHomepage = await evaluate(`(async () => {
      const f=document.getElementById('consultForm');
      f.querySelector('button[type="submit"]').click();
      const emptyErrors=f.querySelectorAll('.is-error').length;
      f.querySelector('[name="name"]').value='Audit User'; f.querySelector('[name="contact"]').value='audit@example.com'; f.querySelector('[name="consent"]').checked=true;
      let calls=0; window.FMLeadTransport.postLead=()=>{calls++;return Promise.resolve({ok:true,requestId:'audit-ro'});}; window.FMLeadTransport.thankYouUrl=()=> '#audit-ro-success';
      f.querySelector('button[type="submit"]').click(); await new Promise(r=>setTimeout(r,120));
      return {emptyErrors,calls,hash:location.hash};
    })()`);
    assert(roHomepage.emptyErrors > 0 && roHomepage.calls === 1 && roHomepage.hash === '#audit-ro-success', 'RO homepage validation/success flow failed');

    await navigate('/ro/questionnaire.html');
    const roXray = await evaluate(`(async () => {
      const f=document.getElementById('qFormV86'); f.querySelector('button[type="submit"]').click();
      const emptyVisible=!document.getElementById('qValidate').hidden;
      ${fillXray}; let calls=0; window.FMLeadTransport.postLead=()=>{calls++;return Promise.resolve({ok:true,requestId:'audit-ro-xray'});}; window.FMLeadTransport.thankYouUrl=()=> '#audit-ro-xray-success';
      f.querySelector('button[type="submit"]').click(); await new Promise(r=>setTimeout(r,180));
      return {emptyVisible,calls,hash:location.hash};
    })()`);
    assert(roXray.emptyVisible && roXray.calls === 1 && roXray.hash === '#audit-ro-xray-success', 'RO X-Ray validation/success flow failed');

    await navigate('/index.html');
    console.log('INTERACTION=HISTORY_CLICK');
    const nextLoad = cdp.once('Page.loadEventFired');
    const clicked = await evaluate(`(() => { const a=[...document.querySelectorAll('a')].find(x => /about\.html$/.test(x.getAttribute('href')||'')); if(!a)return false; a.click(); return true; })()`);
    assert(clicked, 'About link unavailable for history test');
    await nextLoad;
    console.log('INTERACTION=HISTORY_BACK');
    let history = await cdp.send('Page.getNavigationHistory');
    assert(history.currentIndex > 0, 'browser history did not record internal navigation');
    await cdp.send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1].id });
    await waitPath('/index.html');
    assert((await evaluate('location.pathname')) === '/index.html', 'browser back did not return home');
    history = await cdp.send('Page.getNavigationHistory');
    console.log('INTERACTION=HISTORY_FORWARD');
    await cdp.send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex + 1].id });
    await waitPath('/about.html');
    assert((await evaluate('location.pathname')) === '/about.html', 'browser forward did not restore About');

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    console.log('INTERACTION=REDUCED_MOTION');
    await navigate('/index.html');
    const reduced = await evaluate(`({ matches: matchMedia('(prefers-reduced-motion: reduce)').matches, hiddenReveal: [...document.querySelectorAll('.reveal')].filter(x => getComputedStyle(x).opacity === '0').length, behavior: getComputedStyle(document.documentElement).scrollBehavior })`);
    assert(reduced.matches && reduced.hiddenReveal === 0, 'reduced-motion mode leaves content hidden');

    assert(consoleErrors.length === 0, 'console errors: ' + consoleErrors.slice(0, 4).join(' | '));
    console.log('BROWSER_ROUTES_PASS=' + pageResults.length);
    console.log('LOCAL_REQUEST_FAILURES=' + localFailures.length);
    console.log('UNCAUGHT_EXCEPTIONS=' + exceptions.length);
    console.log('CONSOLE_ERRORS=' + consoleErrors.length);
    console.log('MOBILE_MENU_OPEN_CLOSE_ESC=PASS');
    console.log('DISCLOSURE_TOGGLE=PASS');
    console.log('HOMEPAGE_EMPTY_VALIDATION=PASS');
    console.log('HOMEPAGE_SUCCESS_FAILURE_STUBBED=PASS');
    console.log('XRAY_EMPTY_VALIDATION=PASS');
    console.log('XRAY_SUCCESS_FAILURE_STUBBED=PASS');
    console.log('RO_FORM_PARITY_STUBBED=PASS');
    console.log('BACK_FORWARD=PASS');
    console.log('REDUCED_MOTION_CONTENT=PASS');
  } finally {
    if (cdp) cdp.close();
    proc.kill();
    server.close();
    // Chrome can retain Windows file handles briefly after kill. Cleanup must never mask the
    // actual audit result, so retry only this verified mkdtemp directory and then leave it for
    // the OS temp cleaner if Chrome still owns a handle.
    for (let attempt = 0; attempt < 6; attempt++) {
      try { rmSync(profile, { recursive: true, force: true }); break; }
      catch { await sleep(250); }
    }
  }
}

main().catch((error) => { console.error('BROWSER_AUDIT_FAIL=' + error.stack); process.exitCode = 1; });
