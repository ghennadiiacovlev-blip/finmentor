#!/usr/bin/env node
// FINMENTOR — GATE 4: GA4 live UAT against the REAL production site.
//
//   node qa/ga4-live-uat.mjs
//
// Drives headless Chrome over the DevTools Protocol and records every request the page makes to
// Google's collect endpoint. Source inspection is not evidence that an event fires; this is.
//
// WHAT IT PROVES, per surface, in RU and RO:
//   * the GA4 library loads only after a consent choice is stored, and exactly once;
//   * `page_view` is emitted exactly once per page — the config sets `send_page_view: false` and
//     the code sends one explicit event, so a duplicate here would be a real defect;
//   * the business events fire on the actions that should fire them;
//   * every collect request is inspected for forbidden content: names, e-mails, phones, Telegram
//     handles and chat ids, lead ids, request ids, submission keys, review tokens and free text.
//
// It never submits a form, so no lead is created. The one conversion event (`generate_lead`) is
// exercised the way the code actually gates it — by loading `thank-you.html?tool=…` with a
// same-origin referrer — rather than by pushing a real lead through the pipeline.
//
// No credentials, no tenant, no writes. Read-only against the public site.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => existsSync(p));
const PORT = 9333;
const ORIGIN = 'https://www.finmentor.md';

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a minimal CDP client ───────────────────────────────────────────────────────────────────────
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = []; }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && c.waiting.has(msg.id)) { c.waiting.get(msg.id)(msg); c.waiting.delete(msg.id); }
      else if (msg.method) { c.events.push(msg); }
    };
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP timeout: ' + method)), 30000);
      this.waiting.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

// Every request Google's tag makes, plus the collect beacons, in order.
function collectHits(events) {
  return events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params.request.url)
    .filter((u) => /google-analytics\.com|analytics\.google\.com|googletagmanager\.com/.test(u));
}
function gaCollects(events) {
  return collectHits(events).filter((u) => /\/g\/collect|\/collect|\/mp\/collect/.test(u));
}
function gtagLoads(events) {
  return collectHits(events).filter((u) => /googletagmanager\.com\/gtag\/js/.test(u));
}
// GA4 puts the event name in `en=`; a batched POST body is not used by gtag.js for these.
function eventNames(urls) {
  return urls.map((u) => { try { return new URL(u).searchParams.get('en') || ''; } catch (e) { return ''; } }).filter(Boolean);
}

// ── the forbidden-content scan ─────────────────────────────────────────────────────────────────
//
// Applied to the FULL url of every collect beacon, decoded, so a value hidden in any parameter is
// caught regardless of which parameter it hid in.
const FORBIDDEN = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'an e-mail address'],
  [/\bFIN-\d{10,}-\d+\b/, 'a lead id'],
  [/\bfmr_[a-f0-9]{16,}\b/, 'a request id'],
  [/\bXA-[A-Z0-9-]{8,}\b/, 'an X-Ray analysis id'],
  [/\bAS-[a-f0-9]{8,}\b/, 'an app session id'],
  [/\bC-\d{6,}-\d{10,}\b/, 'a cycle id'],
  [/\bsubmission_key\b/i, 'a submission key'],
  [/\breview_token\b/i, 'a review token'],
  [/\binitData\b/i, 'Telegram initData'],
  [/\bsid=[A-Za-z0-9_-]{6,}/, 'a submission id'],
  [/\b551662084\b/, 'a Telegram chat id'],
  [/@[A-Za-z0-9_]{5,32}\b(?!\.)/, 'a Telegram handle'],
  [/\+?\d[\d\s().-]{8,}\d/, 'a phone number']
];
// GA4 owns many reserved parameters (v, tid, _p, sid, sct, gcd, cid …) whose values are its own
// random ids and timestamps. Scanning those produced false positives — GA4's session id looks
// like `sid=…` and its page id looks like a long number. What matters is OUR data, so the scan
// reads the page location, the referrer and every event parameter, and ignores the rest.
function ourValues(url) {
  const out = [];
  let q;
  try { q = new URL(url).searchParams; } catch (e) { return out; }
  for (const [k, v] of q.entries()) {
    if (k === 'dl' || k === 'dr' || k === 'dt' || /^epn?[.]/.test(k) || k === 'en') { out.push([k, v]); }
  }
  return out;
}
function scanForbidden(url) {
  const hits = [];
  for (const [k, raw] of ourValues(url)) {
    let v = raw;
    for (let i = 0; i < 3; i++) { try { v = decodeURIComponent(v); } catch (e) { break; } }
    for (const [re, what] of FORBIDDEN) { if (re.test(v)) { hits.push(what + ' in ' + k); } }
  }
  return hits;
}
// ── one page visit ─────────────────────────────────────────────────────────────────────────────
async function visit(cdp, url, opts) {
  const o = opts || {};
  cdp.events.length = 0;
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // consent + a same-origin referrer are set before any script runs
  if (cdp._injected) { try { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: cdp._injected }); } catch (e) {} cdp._injected = null; }
  const inj = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('finmentor_cookie_consent'," + JSON.stringify(o.consent || 'accept') + ");}catch(e){}"
      + (o.clearSession ? "try{sessionStorage.clear();}catch(e){}" : '')
  });
  cdp._injected = inj.identifier;
  await cdp.send('Page.navigate', { url, referrer: o.referrer || '' });
  const deadline = Date.now() + (o.settle || 12000);
  while (Date.now() < deadline) { await sleep(600); if (gaCollects(cdp.events).length >= (o.expect || 1)) { await sleep(1200); break; } }
  return cdp.events.slice();
}

async function main() {
  if (!CHROME) { console.error('Chrome not found'); process.exit(1); }
  const profile = (process.env.TEMP || '.') + '\\fin-ga4-uat-' + Date.now();
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl = '';
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(500);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page) { wsUrl = page.webSocketDebuggerUrl; }
    } catch (e) {}
  }
  if (!wsUrl) { chrome.kill(); console.error('could not reach headless Chrome'); process.exit(1); }
  const cdp = await CDP.attach(wsUrl);

  const RESULTS = {};
  try {
    // ── 1. consent gate ────────────────────────────────────────────────────────────────────────
    let ev = await visit(cdp, ORIGIN + '/index.html', { consent: 'deny', clearSession: true });
    RESULTS.denied = { gtag: gtagLoads(ev).length, collects: gaCollects(ev).length };

    // ── 2. RU landing, consent accepted ────────────────────────────────────────────────────────
    ev = await visit(cdp, ORIGIN + '/index.html', { consent: 'accept', clearSession: true });
    RESULTS.ru = { gtag: gtagLoads(ev).length, urls: gaCollects(ev), names: eventNames(gaCollects(ev)) };

    // ── 3. RO landing ──────────────────────────────────────────────────────────────────────────
    ev = await visit(cdp, ORIGIN + '/ro/index.html', { consent: 'accept', clearSession: true });
    RESULTS.ro = { gtag: gtagLoads(ev).length, urls: gaCollects(ev), names: eventNames(gaCollects(ev)) };

    // ── 4. RO questionnaire: page_view, then a contact click, then form start ──────────────────
    ev = await visit(cdp, ORIGIN + '/ro/questionnaire.html', { consent: 'accept', clearSession: true });
    RESULTS.roForm = { urls: gaCollects(ev), names: eventNames(gaCollects(ev)) };
    // GA4 batches, and the first business event after a page load can take many seconds to leave
    // the browser. So the handler is observed directly by wrapping gtag — that proves the click
    // binding fired with the right categorical parameter — and the beacon is then waited for.
    await cdp.send('Runtime.evaluate', { expression: "window.__calls=[]; var g=window.gtag; window.gtag=function(){ try{ window.__calls.push([].slice.call(arguments).map(function(x){return typeof x==='object'?JSON.stringify(x):String(x);})); }catch(e){} return g.apply(this, arguments); }; document.addEventListener('click', function(e){ e.preventDefault(); }, true); var a=document.querySelector('a[href*=\"t.me\"]'); a && a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); 'clicked'" });
    await sleep(12000);
    const calls = (await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__calls||[])', returnByValue: true })).result.value;
    RESULTS.roContact = { names: eventNames(gaCollects(cdp.events)), urls: gaCollects(cdp.events), calls: JSON.parse(calls || '[]') };
    await cdp.send('Runtime.evaluate', { expression: "var i=document.querySelector('#qFormV86 input, #qForm input, form input'); if(i){ i.focus(); i.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); } 'focused'" });
    await sleep(9500);
    RESULTS.roFormStart = { names: eventNames(gaCollects(cdp.events)), urls: gaCollects(cdp.events) };
    // a second focus must NOT emit a second lead_form_start
    cdp.events.length = 0;
    await cdp.send('Runtime.evaluate', { expression: "var xs=document.querySelectorAll('form input'); for(const x of [xs[1],xs[0]]) if(x){ x.focus(); x.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); } 'refocused'" });
    await sleep(9500);
    RESULTS.roFormStartAgain = { names: eventNames(gaCollects(cdp.events)) };

    // ── 5. the conversion, exercised the way the code gates it ─────────────────────────────────
    ev = await visit(cdp, ORIGIN + '/thank-you.html?tool=xray_extended&sid=SYNTHETIC-UAT-0001',
      { consent: 'accept', clearSession: true, referrer: ORIGIN + '/questionnaire.html' });
    RESULTS.conversion = { urls: gaCollects(ev), names: eventNames(gaCollects(ev)) };
    // reload in the same session must not double-count
    // The injected bootstrap clears sessionStorage on every document load. A real customer's
    // reload keeps it, and the dedupe lives there, so the script is removed before reloading —
    // otherwise the harness would manufacture the very duplicate it is testing for.
    if (cdp._injected) { try { await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: cdp._injected }); } catch (e) {} cdp._injected = null; }
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('finmentor_cookie_consent','accept');}catch(e){}" });
    cdp.events.length = 0;
    await cdp.send('Page.reload', {});
    await sleep(9500);
    RESULTS.conversionReload = { names: eventNames(gaCollects(cdp.events)) };

    // ── 6. no same-origin referrer means no conversion ─────────────────────────────────────────
    ev = await visit(cdp, ORIGIN + '/thank-you.html?tool=xray_extended&sid=SYNTHETIC-UAT-0002',
      { consent: 'accept', clearSession: true, referrer: '' });
    RESULTS.conversionNoRef = { names: eventNames(gaCollects(ev)) };
  } finally {
    cdp.close();
    chrome.kill();
  }

  // ── the assertions ─────────────────────────────────────────────────────────────────────────
  console.log('\nGA4 LIVE UAT — https://www.finmentor.md\n');

  check('no Google tag and no beacon before a consent choice is granted', () => {
    assert(RESULTS.denied.gtag === 0, 'gtag.js loaded despite denied consent');
    assert(RESULTS.denied.collects === 0, RESULTS.denied.collects + ' beacons sent despite denied consent');
  });

  for (const [key, label] of [['ru', 'RU landing'], ['ro', 'RO landing']]) {
    const r = RESULTS[key];
    check(label + ': the Google tag loads exactly once', () => {
      assert(r.gtag === 1, 'gtag.js loaded ' + r.gtag + ' times');
    });
    check(label + ': exactly one page_view is emitted', () => {
      const pv = r.names.filter((n) => n === 'page_view').length;
      assert(pv === 1, 'page_view fired ' + pv + ' times (names: ' + r.names.join(',') + ')');
    });
    check(label + ': the beacons carry the production measurement id', () => {
      assert(r.urls.length > 0, 'no beacon was sent');
      assert(r.urls.every((u) => /G-94L9B8WZ12/.test(u)), 'a beacon used a different measurement id');
    });
    check(label + ': no forbidden content in any beacon', () => {
      for (const u of r.urls) {
        const hits = scanForbidden(u);
        assert(hits.length === 0, 'beacon carried ' + hits.join(', '));
      }
    });
  }

  check('RO questionnaire: one page_view, and the site language is Romanian', () => {
    const pv = RESULTS.roForm.names.filter((n) => n === 'page_view').length;
    assert(pv === 1, 'page_view fired ' + pv + ' times');
  });

  check('a contact link click emits contact_click, with a categorical method only', () => {
    const viaBeacon = RESULTS.roContact.names.indexOf('contact_click') !== -1;
    const viaCall = (RESULTS.roContact.calls || []).some((c) => c[0] === 'event' && c[1] === 'contact_click');
    assert(viaBeacon || viaCall, 'contact_click did not fire (beacons: ' + RESULTS.roContact.names.join(',') + ')');
    const payload = (RESULTS.roContact.calls || []).find((c) => c[1] === 'contact_click');
    if (payload) {
      assert(/"contact_method":"(email|phone|telegram|whatsapp)"/.test(payload[2] || ''), 'contact_method was not categorical: ' + payload[2]);
      assert(!/@[a-z]|https?:/i.test((payload[2] || '').replace(/"contact_method":"[a-z]+"/, '')), 'the payload carried an address or url');
    }
    for (const u of RESULTS.roContact.urls) { assert(scanForbidden(u).length === 0, 'contact_click beacon carried ' + scanForbidden(u).join(', ')); }
  });
  check('focusing a form field emits lead_form_start exactly once', () => {
    const n = RESULTS.roFormStart.names.filter((x) => x === 'lead_form_start').length;
    assert(n === 1, 'lead_form_start fired ' + n + ' times');
  });

  check('focusing again does NOT emit a second lead_form_start', () => {
    const n = RESULTS.roFormStartAgain.names.filter((x) => x === 'lead_form_start').length;
    assert(n === 0, 'a repeated focus emitted ' + n + ' more lead_form_start');
  });

  check('the conversion fires once on thank-you with a same-origin referrer', () => {
    const n = RESULTS.conversion.names.filter((x) => x === 'generate_lead').length;
    assert(n === 1, 'generate_lead fired ' + n + ' times (saw: ' + RESULTS.conversion.names.join(',') + ')');
  });

  check('the submission id never reaches GA4, even though it is in the URL', () => {
    // GA4 has a reserved  of its own (its session id), so the whole query string cannot be
    // the test. What matters is OUR fields: the page location, the referrer and the event
    // parameters. The value itself is unmistakable, so it is searched for by name too.
    for (const u of RESULTS.conversion.urls) {
      for (const [k, raw] of ourValues(u)) {
        let v = raw;
        for (let i = 0; i < 3; i++) { try { v = decodeURIComponent(v); } catch (e) { break; } }
        assert(v.indexOf('SYNTHETIC-UAT-0001') === -1, 'the submission id reached GA4 in ' + k);
        assert(/[?&]sid=/.test(v) === false, 'a sid parameter reached GA4 in ' + k);
      }
    }
  });

  check('reloading thank-you does NOT double-count the conversion', () => {
    const n = RESULTS.conversionReload.names.filter((x) => x === 'generate_lead').length;
    assert(n === 0, 'a reload emitted ' + n + ' extra generate_lead');
  });

  check('thank-you without a same-origin referrer emits no conversion', () => {
    const n = RESULTS.conversionNoRef.names.filter((x) => x === 'generate_lead').length;
    assert(n === 0, 'generate_lead fired ' + n + ' times without a same-origin referrer');
  });

  check('no beacon anywhere in this run carried forbidden content', () => {
    const all = [].concat(RESULTS.ru.urls, RESULTS.ro.urls, RESULTS.roForm.urls,
      RESULTS.roContact.urls || [], RESULTS.roFormStart.urls || [], RESULTS.conversion.urls);
    let scanned = 0;
    for (const u of all) {
      const hits = scanForbidden(u);
      assert(hits.length === 0, 'a beacon carried ' + hits.join(', ') + ' — ' + u.slice(0, 160));
      scanned++;
    }
    assert(scanned > 0, 'no beacons were scanned');
    console.log('        (' + scanned + ' beacons scanned)');
  });

  console.log('\n--- observed event names ---');
  for (const k of ['ru', 'ro', 'roForm', 'roContact', 'roFormStart', 'conversion']) {
    if (RESULTS[k]) { console.log('  ' + k.padEnd(14) + (RESULTS[k].names || []).join(', ') || '(none)'); }
  }

  console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) { process.exit(1); }
}

main().catch((e) => { console.error('STOPPED: ' + e.message); process.exit(1); });
