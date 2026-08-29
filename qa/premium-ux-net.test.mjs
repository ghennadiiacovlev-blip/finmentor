#!/usr/bin/env node
// FINMENTOR — the Mini App network layer, and the controlled failure path.
//
//   node qa/premium-ux-net.test.mjs
//
// Offline. `fetch`, `window` and `Telegram` are stubs; no request leaves this process.
//
// The two properties that matter most, and why:
//
//   1. SUCCESS IS `ok === true`. A 200 carrying `{ok:false}`, a 200 carrying garbage, and a 200
//      carrying nothing must all be failures. Showing «Обращение передано» over a failed write is
//      the same defect class as the Gateway answering 409 to an outage (P9-R2).
//   2. RETRY MUST NOT DOUBLE-SUBMIT. The client sends the same session id and the SAME
//      acknowledgement timestamps every time. A retry that re-stamps `acknowledged_at` would write
//      a second, contradictory record of when consent was given.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; console.log('  PASS  ' + name); })
    .catch((e) => { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); });
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// ---------------------------------------------------------------- harness

const SESSION_ID = 'AS-' + 'a'.repeat(64);
let sent = [];
let responder = () => ({ status: 200, body: { ok: true } });

const win = {
  FM_ENDPOINTS: { gateway: 'https://n8n.test/webhook/gw', session: 'https://n8n.test/webhook/se', submit: 'https://n8n.test/webhook/su' },
  Telegram: { WebApp: { initData: 'user=%7B%22id%22%3A1%7D&auth_date=1788000000&hash=abc' } }
};

function stubFetch(url, opts) {
  const body = JSON.parse(opts.body);
  sent.push({ url, method: opts.method, body });
  const r = responder({ url, method: opts.method, body });
  if (r.throws) { return Promise.reject(Object.assign(new Error(r.throws), { name: r.name || 'TypeError' })); }
  return Promise.resolve({
    status: r.status,
    text: () => Promise.resolve(r.raw !== undefined ? r.raw : JSON.stringify(r.body))
  });
}

// Load net.js into a scope with the stubs in place. It attaches itself to `window`.
const src = readFileSync(join(ROOT, 'app-premium', 'net.js'), 'utf8');
new Function('window', 'fetch', 'setTimeout', 'clearTimeout', 'AbortController', src)(
  win, stubFetch, setTimeout, clearTimeout, globalThis.AbortController
);
const NET = win.FM_NET;

const reset = () => { sent = []; responder = () => ({ status: 200, body: { ok: true } }); };

console.log('Premium UX — Mini App network layer');
console.log('');

// ---------------------------------------------------------------- configuration

await check('placeholder endpoints mean NOT configured — the app must not pretend', () => {
  const real = win.FM_ENDPOINTS;
  win.FM_ENDPOINTS = { gateway: '__PREMIUM_GATEWAY_URL__', session: '__PREMIUM_SESSION_URL__', submit: '__PREMIUM_SUBMIT_URL__' };
  eq(NET.configured(), false, 'placeholders reported as configured');
  win.FM_ENDPOINTS = {};
  eq(NET.configured(), false, 'missing endpoints reported as configured');
  win.FM_ENDPOINTS = real;
  eq(NET.configured(), true, 'real endpoints reported as unconfigured');
});

await check('an unconfigured app makes no request at all', async () => {
  reset();
  const real = win.FM_ENDPOINTS;
  win.FM_ENDPOINTS = { gateway: '__PREMIUM_GATEWAY_URL__', session: 'x', submit: 'y' };
  const r = await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  eq(r.ok, false, 'unconfigured submit reported ok');
  eq(sent.length, 0, 'a request was sent with placeholder endpoints');
  win.FM_ENDPOINTS = real;
});

// ---------------------------------------------------------------- bootstrap

await check('bootstrap hands initData to the Gateway and keeps the opaque id', async () => {
  reset();
  responder = () => ({ status: 200, body: { ok: true, app_session_id: SESSION_ID, expires_at: '2026-09-01T10:00:00.000Z', locale: 'ru' } });
  const r = await NET.bootstrap();
  assert(r.ok, 'bootstrap failed: ' + JSON.stringify(r));
  eq(sent.length, 1, 'request count');
  eq(sent[0].method, 'POST', 'method');
  eq(sent[0].body.init_data, win.Telegram.WebApp.initData, 'initData was not sent');
  eq(NET.sessionId(), SESSION_ID, 'session id');
});

await check('a malformed session id is REFUSED rather than stored', async () => {
  reset();
  responder = () => ({ status: 200, body: { ok: true, app_session_id: 'not-a-session' } });
  const r = await NET.bootstrap();
  eq(r.ok, false, 'a malformed id was accepted');
  eq(NET.sessionId(), '', 'a malformed id was stored');
  // Restore a good session for the rest of the run.
  responder = () => ({ status: 200, body: { ok: true, app_session_id: SESSION_ID, expires_at: '2026-09-01T10:00:00.000Z', locale: 'ru' } });
  await NET.bootstrap();
});

await check('outside Telegram, bootstrap fails and is NOT retryable', async () => {
  reset();
  const tg = win.Telegram;
  win.Telegram = null;
  const r = await NET.bootstrap();
  eq(r.ok, false, 'bootstrapped without Telegram');
  eq(r.error_code, 'NO_TELEGRAM', 'code');
  eq(r.retryable, false, 'retrying will not summon Telegram');
  eq(sent.length, 0, 'a request was sent without initData');
  win.Telegram = tg;
  responder = () => ({ status: 200, body: { ok: true, app_session_id: SESSION_ID } });
  await NET.bootstrap();
});

// ---------------------------------------------------------------- success is ok === true

await check('a 200 carrying ok:false is a FAILURE', async () => {
  reset();
  responder = () => ({ status: 200, body: { ok: false, error_code: 'SESSION_EXPIRED', retryable: false } });
  const r = await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  eq(r.ok, false, 'ok:false treated as success');
  eq(r.error_code, 'SESSION_EXPIRED', 'code');
  eq(r.retryable, false, 'retryability');
});

await check('a 200 carrying garbage, or nothing, is a FAILURE', async () => {
  for (const raw of ['<html>maintenance</html>', '', 'null', '[]']) {
    reset();
    responder = () => ({ status: 200, raw: raw });
    const r = await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
    eq(r.ok, false, 'accepted as success: ' + JSON.stringify(raw));
  }
});

await check('a 500 that somehow says ok:true is still not trusted as a shape we invented', async () => {
  // The rule is `ok === true`, so this DOES pass — and that is deliberate. The server is the
  // authority on its own verdict; the client must not second-guess it from a status code, in
  // either direction. This test pins the rule so a future edit cannot quietly add status logic.
  reset();
  responder = () => ({ status: 500, body: { ok: true, lead_id: 'LEAD-1' } });
  const r = await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  eq(r.ok, true, 'the client second-guessed the server verdict from a status code');
});

await check('a transport failure is retryable; a timeout is retryable', async () => {
  reset();
  responder = () => ({ throws: 'network down', name: 'TypeError' });
  const a = await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  eq(a.ok, false, 'network failure reported ok');
  eq(a.error_code, 'NETWORK', 'code');
  eq(a.retryable, true, 'a network failure must be retryable');

  reset();
  responder = () => ({ throws: 'aborted', name: 'AbortError' });
  const b = await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  eq(b.error_code, 'TIMEOUT', 'timeout code');
  eq(b.retryable, true, 'a timeout must be retryable');
});

// ---------------------------------------------------------------- the submit body

await check('the submit body carries the session id and the acknowledgement, and NOTHING else', async () => {
  reset();
  await NET.submit({ notice_version: 'v1', locale: 'ru', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  eq(sent.length, 1, 'request count');
  const b = sent[0].body;
  eq(Object.keys(b).sort().join(','), 'app_session_id,privacy_ack', 'submit body keys');
  eq(Object.keys(b.privacy_ack).sort().join(','), 'acknowledged_at,locale,notice_version,shown_at', 'ack keys');
  eq(b.app_session_id, SESSION_ID, 'session id');
});

await check('no answer, contact detail or lead id can ride along on a submit', async () => {
  reset();
  await NET.submit({
    notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z',
    answers: { company_name: 'X' }, lead_id: 'LEAD-1', priority: 'HOT', contact_value: 'x@example.test'
  });
  const j = JSON.stringify(sent[0].body);
  for (const forbidden of ['answers', 'company_name', 'lead_id', 'priority', 'contact_value']) {
    assert(j.indexOf(forbidden) === -1, 'the submit body carried ' + forbidden);
  }
});

await check('an acknowledgement missing a timestamp is refused BEFORE any request', async () => {
  for (const ack of [null, {}, { notice_version: 'v1' },
                     { notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z' }]) {
    reset();
    const r = await NET.submit(ack);
    eq(r.ok, false, 'incomplete ack accepted: ' + JSON.stringify(ack));
    eq(r.error_code, 'CONSENT_REQUIRED', 'code');
    eq(sent.length, 0, 'a request was sent without a complete acknowledgement');
  }
});

// ---------------------------------------------------------------- retry must not duplicate

await check('RETRY sends the identical body — same session, same acknowledgement instants', async () => {
  reset();
  const ack = { notice_version: 'v1', locale: 'ru', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' };
  responder = () => ({ status: 200, body: { ok: false, error_code: 'INTAKE_NOT_OK', retryable: true } });
  await NET.submit(ack);
  await NET.submit(ack);
  await NET.submit(ack);
  eq(sent.length, 3, 'attempt count');
  const first = JSON.stringify(sent[0].body);
  eq(JSON.stringify(sent[1].body), first, 'the second attempt differed from the first');
  eq(JSON.stringify(sent[2].body), first, 'the third attempt differed from the first');
  eq(sent[0].body.privacy_ack.acknowledged_at, ack.acknowledged_at, 'the acknowledgement instant was re-stamped');
});

await check('the client mints NO idempotency key of its own', async () => {
  reset();
  await NET.submit({ notice_version: 'v1', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:01:00.000Z' });
  const j = JSON.stringify(sent[0].body);
  for (const invented of ['idempotency', 'request_id', 'submission_key', 'nonce', 'attempt']) {
    assert(j.toLowerCase().indexOf(invented) === -1, 'the client invented ' + invented + '; the server derives it from the session');
  }
});

// ---------------------------------------------------------------- draft

await check('a draft write carries the provenance envelope and the step', async () => {
  reset();
  const r = await NET.saveDraft('APP_OBJECTIVE', {
    objective: { value: 'Денежный поток', source: 'user_explicit', confirmed: true }
  });
  assert(r.ok, 'draft write failed: ' + JSON.stringify(r));
  eq(sent[0].method, 'PUT', 'method');
  eq(sent[0].body.step, 'APP_OBJECTIVE', 'step');
  eq(sent[0].body.fields.objective.source, 'user_explicit', 'source');
  eq(sent[0].body.app_session_id, SESSION_ID, 'session id');
});

await check('a malformed provenance envelope is refused BEFORE any request', async () => {
  const bad = [
    { objective: 'Денежный поток' },
    { objective: { value: 'x', source: 'user_explicit' } },
    { objective: { value: 'x', source: 'invented_source', confirmed: true } },
    { objective: [] }
  ];
  for (const fields of bad) {
    reset();
    const r = await NET.saveDraft('APP_OBJECTIVE', fields);
    eq(r.ok, false, 'accepted: ' + JSON.stringify(fields));
    eq(sent.length, 0, 'a request was sent with a malformed envelope');
  }
});

await check('ai_inferred is a legal STORED source — it just never confirms itself', async () => {
  reset();
  const r = await NET.saveDraft('APP_COMPANY', {
    company_name: { value: 'Ромашка', source: 'ai_inferred', confirmed: false }
  });
  assert(r.ok, 'a legitimate ai_inferred prefill was refused');
  eq(sent[0].body.fields.company_name.confirmed, false, 'an ai_inferred prefill was sent as confirmed');
});

// ---------------------------------------------------------------- expiry

await check('the client treats server expiry as authoritative and never extends it', async () => {
  const src2 = readFileSync(join(ROOT, 'app-premium', 'net.js'), 'utf8');
  const code = src2.split('\n').filter((l) => !/^\s*[/*]/.test(l)).join('\n');
  assert(code.indexOf('expires_at') !== -1, 'the client does not read expires_at at all');
  for (const f of ['setExpires', 'extend', 'refreshSession', 'renew']) {
    assert(code.indexOf(f) === -1, 'the client can ' + f);
  }
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
