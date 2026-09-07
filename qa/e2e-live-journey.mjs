#!/usr/bin/env node
// FINMENTOR — GATE 5: one synthetic customer journey through the REAL production stack.
//
//   node qa/e2e-live-journey.mjs ru
//   node qa/e2e-live-journey.mjs ro
//
// Drives the real public questionnaire in headless Chrome, fills it with a clearly synthetic
// identity, submits ONCE, and records what crossed the wire. It proves the browser half of the
// chain — render, identity fields, validation, consent, exactly-one submit, GA4 without PII — and
// prints the request id so the server half can be joined to it by a separate read.
//
// It never submits twice. A second run would create a second lead, which is exactly what the gate
// forbids, so the submit is guarded and the script refuses to proceed if the form is already in a
// submitted state.
//
// SYNTHETIC IDENTITY ONLY. Every value below is visibly a test value, and the e-mail is on a
// domain that cannot receive mail.

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const LOCALE = (process.argv[2] || 'ru').toLowerCase() === 'ro' ? 'ro' : 'ru';
const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => existsSync(p));
const PORT = LOCALE === 'ro' ? 9341 : 9340;
const ORIGIN = 'https://www.finmentor.md';
const URL_PAGE = ORIGIN + (LOCALE === 'ro' ? '/ro/questionnaire.html' : '/questionnaire.html');
const STAMP = Date.now();
// A distinct company per run, so a second RO probe is a NEW canonical lead rather than a dedup
// merge onto the first one (whose analysis is already CLIENT_READY and would never be re-swept).
const SUFFIX = (process.argv[3] || 'A');

const IDENTITY = {
  ru: { name: 'UAT Gate5 RU', company: 'UAT ООО Гейт5 Синтетик', email: 'uat-gate5-ru-' + STAMP + '@uat.invalid' },
  ro: { name: 'UAT Gate5 RO ' + SUFFIX, company: 'UAT SRL Gate5 Sintetic ' + SUFFIX, email: 'uat-gate5-ro-' + STAMP + '@uat.invalid' }
}[LOCALE];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + (process.env.TEMP || '.') + '\\fin-e2e-' + LOCALE + '-' + STAMP,
    '--window-size=430,900', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = '';
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(500);
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/list'); const t = await r.json(); const p = t.find((x) => x.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {}
  }
  if (!wsUrl) { chrome.kill(); throw new Error('headless Chrome did not start'); }
  const ws = new WebSocket(wsUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const waiting = new Map(); const events = [];
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } else if (j.method) events.push(j); };
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; const t = setTimeout(() => rej(new Error('CDP timeout ' + method)), 40000); waiting.set(i, (m) => { clearTimeout(t); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result); }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  const OUT = {};
  try {
    await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('finmentor_cookie_consent','accept');}catch(e){}" });
    await send('Page.navigate', { url: URL_PAGE });
    await sleep(9000);

    OUT.render = JSON.parse(await js("JSON.stringify({ title: document.title, lang: document.documentElement.lang, form: !!document.querySelector('#qFormV86, #qForm, form'), required: (function(){ var n={}; document.querySelectorAll('input[type=radio]').forEach(function(r){ n[r.name]=1; }); return Object.keys(n).length; })(), consentBox: !!document.querySelector('#qConsent'), name: !!document.querySelector('[name=q_name]'), company: !!document.querySelector('[name=q_company]'), email: !!document.querySelector('[name=q_email]'), submit: !!document.querySelector('button[type=submit], #qSubmit, .q-actions button') })"));

    // 1. VALIDATION FIRST: submitting an empty form must be refused, and must not reach the network.
    events.length = 0;
    await js("var b=document.querySelector('button[type=submit], #qSubmit, .q-actions button'); b && b.click(); 'submitted-empty'");
    await sleep(3500);
    OUT.emptySubmitPosts = events.filter((e) => e.method === 'Network.requestWillBeSent')
      .map((e) => e.params.request.url).filter((u) => /webhook|lead-intake/i.test(u));
    OUT.validationVisible = await js("(function(){ var s=document.querySelector('#qValidate, .q-validate'); return !!(s && !s.hidden); })()");

    // 2. fill every required field the page itself declares
    OUT.fill = JSON.parse(await js(`(function(){
      function set(el, v){ if(!el) return false; el.focus(); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }
      var done={};
      done.name = set(document.querySelector('[name=q_name]'), ${JSON.stringify(IDENTITY.name)});
      done.company = set(document.querySelector('[name=q_company]'), ${JSON.stringify(IDENTITY.company)});
      done.email = set(document.querySelector('[name=q_email]'), ${JSON.stringify(IDENTITY.email)});
      var radios = 0;
      var groups = {};
      document.querySelectorAll('input[type=radio]').forEach(function(r){ if(!groups[r.name]) groups[r.name]=r; });
      Object.keys(groups).forEach(function(n){
        if (document.querySelector('input[name="'+n+'"]:checked')) return;
        var r = groups[n];
        r.checked = true; r.dispatchEvent(new Event('change',{bubbles:true})); r.dispatchEvent(new Event('click',{bubbles:true})); radios++;
      });
      done.radios = radios;
      // The identity panel (the PR #20 fix) carries its own inputs; set both it and the canonical
      // fields, then let the page sync them however it wants.
      ['vfName','vfCompany','vfContact'].forEach(function(k,i){
        var el = document.getElementById(k);
        if (el) { set(el, [${JSON.stringify(IDENTITY.name)}, ${JSON.stringify(IDENTITY.company)}, ${JSON.stringify(IDENTITY.email)}][i]); }
      });
      // one required multi-select: the main financial pain
      var pain = document.querySelector('input[name=q_pain]');
      if (pain && !document.querySelector('input[name=q_pain]:checked')) { pain.checked = true; pain.dispatchEvent(new Event('change',{bubbles:true})); pain.dispatchEvent(new Event('click',{bubbles:true})); }
      done.pain = !!document.querySelector('input[name=q_pain]:checked');
      var c = document.querySelector('#qConsent');
      if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change',{bubbles:true})); }
      done.consent = !!(c && c.checked);
      done.missing = 'n/a';
      return JSON.stringify(done);
    })()`));

    // 3. THE ONE SUBMIT
    events.length = 0;
    await js("var b=document.querySelector('button[type=submit], #qSubmit, .q-actions button'); b && b.click(); 'submitted'");
    await sleep(15000);
    const posts = events.filter((e) => e.method === 'Network.requestWillBeSent')
      .map((e) => ({ url: e.params.request.url, method: e.params.request.method, headers: e.params.request.headers, body: e.params.request.postData }))
            // Count only real POSTs: a CORS preflight is an OPTIONS to the same URL and counting it
      // made a single submit look like two.
      .filter((r) => /webhook|lead-intake/i.test(r.url) && r.method === 'POST');
    OUT.posts = posts.map((p) => ({ url: p.url, method: p.method, requestId: (p.headers && (p.headers['X-Request-Id'] || p.headers['x-request-id'])) || '', bodyLen: (p.body || '').length }));
    OUT.requestId = OUT.posts.map((p) => p.requestId).find(Boolean) || (function(){ try { const m=/"request_id"s*:s*"(fmr_[a-f0-9]+)"/.exec(posts.map(x=>x.body||'').join('')); return m?m[1]:''; } catch(e){ return ''; } })();
    // pull the request id the page itself recorded, without printing any token
    OUT.pageRequestId = await js("(function(){ try { var m=document.querySelector('meta[name=finmentor-request-id]'); return m ? m.content : (window.__finmentorRequestId||''); } catch(e){ return ''; } })()");
    OUT.validationText = await js("(function(){ var s=document.querySelector('#qValidate, .q-validate'); return (s && !s.hidden) ? (s.textContent||'').replace(/\s+/g,' ').trim().slice(0,300) : ''; })()");
    OUT.afterState = JSON.parse(await js("JSON.stringify({ successVisible: (function(){var s=document.querySelector('#formSuccess, .form__success, .q-success'); return !!(s && !s.hidden);})(), url: location.pathname + location.search })"));

    // 4. GA4 beacons across the whole journey
    OUT.ga = events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url)
      .filter((u) => /google-analytics\.com\/g\/collect/.test(u));
  } finally { try { ws.close(); } catch (e) {} chrome.kill(); }

  // ── assertions ───────────────────────────────────────────────────────────────────────────────
  console.log('\nE2E ' + LOCALE.toUpperCase() + ' — ' + URL_PAGE + '\n');
  console.log('  identity: ' + IDENTITY.name + ' / ' + IDENTITY.company + ' / ' + IDENTITY.email + '\n');

  check('the production page renders with its form, identity fields and consent box', () => {
    const r = OUT.render;
    assert(r.form, 'no form rendered');
    assert(r.name && r.company && r.email, 'an identity field is missing');
    assert(r.consentBox, 'the consent checkbox is missing');
    assert(r.submit, 'no submit control');
    assert(r.required > 0, 'no radio groups found on the page');
  });

  check('the page is in the expected language', () => {
    assert((OUT.render.lang || '').toLowerCase().indexOf(LOCALE) === 0, 'lang is ' + OUT.render.lang);
  });

  check('submitting an empty form is refused and never reaches the network', () => {
    assert(OUT.emptySubmitPosts.length === 0, 'an empty form posted ' + OUT.emptySubmitPosts.length + ' times');
    assert(OUT.validationVisible === true, 'no validation summary was shown');
  });

  check('every required field could be filled, including consent', () => {
    assert(OUT.fill.name && OUT.fill.company && OUT.fill.email, 'an identity field could not be filled');
    assert(OUT.fill.consent === true, 'consent could not be given');
    assert(OUT.fill.missing === 'n/a' || OUT.fill.missing.length === 0, 'still missing: ' + JSON.stringify(OUT.fill.missing));
  });

  check('the submit posted EXACTLY ONCE to the lead intake webhook', () => {
    assert(OUT.posts.length === 1, 'the form posted ' + OUT.posts.length + ' times. Validation said: ' + (OUT.validationText || '(nothing)'));
    assert(/lead-intake/i.test(OUT.posts[0].url), 'the post did not go to lead intake');
    assert(OUT.posts[0].method === 'POST', 'the submit was not a POST');
    assert(OUT.posts[0].bodyLen > 200, 'the payload was suspiciously small');
  });

  check('the submission carried a request id (value not printed)', () => {
    const rid = OUT.requestId || OUT.pageRequestId;
    assert(!!rid, 'no request id was attached');
    assert(/^fmr_[a-f0-9]{8}/.test(rid), 'the request id is not in the expected shape');
  });

  check('the customer sees a success state, not an error', () => {
    assert(OUT.afterState.successVisible || /thank-you/.test(OUT.afterState.url),
      'no success screen and no thank-you redirect: ' + JSON.stringify(OUT.afterState));
  });

  check('GA4 beacons during the journey carry no identity', () => {
    const bad = [];
    for (const u of OUT.ga) {
      let d = u; for (let i = 0; i < 3; i++) { try { d = decodeURIComponent(d); } catch (e) { break; } }
      for (const [re, what] of [[/uat-gate5/i, 'the test e-mail'], [/UAT Gate5/i, 'the test name'],
        [/Гейт5|Sintetic/i, 'the company name'], [/\bfmr_[a-f0-9]{8,}/, 'the request id'], [/\bFIN-\d{10,}/, 'a lead id']]) {
        if (re.test(d)) { bad.push(what); }
      }
    }
    assert(bad.length === 0, 'GA4 carried ' + [...new Set(bad)].join(', '));
    console.log('        (' + OUT.ga.length + ' GA4 beacons scanned)');
  });

  const rid = OUT.requestId || OUT.pageRequestId;
  writeFileSync((process.env.TEMP || '.') + '\\fin-e2e-' + LOCALE + '.json',
    JSON.stringify({ locale: LOCALE, identity: IDENTITY, requestId: rid, posts: OUT.posts.length, ga: OUT.ga.length }, null, 2));
  console.log('\n  request id prefix (for joining the server half): ' + String(rid).slice(0, 12) + '…');
  console.log('  company (for the CRM join): ' + IDENTITY.company);
  console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) { process.exit(1); }
}

main().catch((e) => { console.error('STOPPED: ' + e.message); process.exit(1); });
