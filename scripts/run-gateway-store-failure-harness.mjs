#!/usr/bin/env node
// FINMENTOR — P9-R2: run the isolated store-failure harness against the live tenant.
//
//   node scripts/run-gateway-store-failure-harness.mjs --run
//   node scripts/run-gateway-store-failure-harness.mjs            (preflight only)
//
// WHAT THIS DOES, AND WHAT IT REFUSES TO DO.
//
// It deploys two DISPOSABLE harness workflows on new routes, drives real HTTP requests at them,
// and deletes everything it created. It never writes to the Mini App Gateway, never touches the
// production G5 credential, never touches Supabase or Neon, and never writes a row anywhere.
//
// It ABORTS before deploying if the live Gateway is not a field-level match for the repo
// candidate, because a harness that mirrors a stale graph proves nothing about what is deployed.
//
// Teardown runs in a finally block. If teardown itself fails, the script says so loudly and
// names the ids that must be removed by hand.
//
// SECRETS. Read calls use N8N_API_KEY, writes use N8N_FIX_API_KEY, both from the environment
// only. The disposable store password is generated here, never printed, and dies with the
// credential. The Ed25519 private half never leaves this process.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import {
  H1_PATH, H2_PATH, H1_NAME, H2_NAME, PUBKEY_PLACEHOLDER, CREDENTIAL_PLACEHOLDER,
  PRODUCTION_G5_CREDENTIAL_ID, VERIFY_NODE
} from './build-gateway-store-failure-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const SESSION_TABLE_ID = 'LRme88caqxFzTLqW';
const RUN = process.argv.includes('--run');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!BASE) { die('N8N_BASE_URL is not set.'); }
if (!READ_KEY) { die('N8N_API_KEY is not set.'); }

function die(m) { console.error('\nABORTED: ' + m); process.exit(1); }
function ok(m) { console.log('  PASS  ' + m); }
function say(m) { console.log(m); }

async function api(method, path, body, write) {
  const key = write ? WRITE_KEY : READ_KEY;
  if (write && !key) { throw new Error('N8N_FIX_API_KEY is not set; refusing to write.'); }
  if (method !== 'GET' && !write) { throw new Error('refusing ' + method + ' without the write key'); }
  const res = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
  if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + text.slice(0, 300)); }
  return json;
}

// ---------------------------------------------------------------- fidelity of the live graph

// The executable graph only: ids and positions are cosmetic and move when the editor is opened.
function normalise(wf) {
  const nodes = {};
  for (const n of wf.nodes) {
    nodes[n.name] = {
      type: n.type,
      typeVersion: n.typeVersion,
      parameters: n.parameters,
      credentials: n.credentials ? Object.fromEntries(Object.entries(n.credentials).map(([k, v]) => [k, v.id])) : null,
      alwaysOutputData: n.alwaysOutputData === true,
      onError: n.onError ?? null,
      disabled: n.disabled === true
    };
  }
  return JSON.stringify({ nodes, connections: wf.connections, settings: wf.settings });
}

// ---------------------------------------------------------------- the synthetic signed context

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const HARNESS_PUBKEY_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
const LF = String.fromCharCode(10);

function makeInitData(botId) {
  const user = JSON.stringify({ id: 990000001, first_name: 'Harness', is_bot: false, language_code: 'ru' });
  const pairs = [
    ['auth_date', String(Math.floor(Date.now() / 1000) - 2)],
    ['query_id', 'P9R2-' + crypto.randomBytes(8).toString('hex')],
    ['user', user]
  ];
  // Telegram ships BOTH a legacy HMAC field and the Ed25519 signature. The verifier checks only
  // the signature, and both the verifier canonical and the derivation canonical exclude the HMAC
  // field - but Derive Replay Key REQUIRES it present as 64 hex of digest material. Adding it
  // therefore cannot change the bytes that were signed.
  pairs.push(['hash', crypto.randomBytes(32).toString('hex')]);
  const kept = pairs.filter(([k]) => k !== 'hash' && k !== 'signature').sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonical = botId + ':WebAppData' + LF + kept.map(([k, v]) => k + '=' + v).join(LF);
  const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64url');
  pairs.push(['signature', sig]);
  return pairs.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

// ---------------------------------------------------------------- shots

async function shot(path, extra, attempts) {
  const body = Object.assign(
    { init_data: makeInitData(BOT_ID), client_version: 'b2.1.0', locale: 'ru' },
    extra || {}
  );
  let last = null;
  for (let i = 0; i < (attempts || 1); i++) {
    const res = await fetch(BASE + '/webhook/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep raw */ }
    last = { status: res.status, data, raw: text.slice(0, 400) };
    // A freshly activated webhook can 404 for a moment. Nothing else is retried.
    if (res.status !== 404) { return last; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

// ---------------------------------------------------------------- main

let BOT_ID = null;
const created = { h1: null, h2: null, credential: null };
let failures = [];
function must(name, cond, detail) {
  if (cond) { ok(name); } else { failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

async function main() {
  say('');
  say('== PREFLIGHT ==============================================');

  const gwCandidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));
  const gwLive = await api('GET', '/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  if (gwLive.name !== 'FINMENTOR Mini App Gateway') { die('workflow ' + GATEWAY_ID + ' is not the Gateway.'); }
  if (!gwLive.active) { die('the Gateway is inactive.'); }
  if (normalise(gwLive) !== normalise(gwCandidate)) {
    die('the LIVE Gateway is not a field-level match for the repo candidate. A harness built from a stale graph proves nothing.');
  }
  ok('live Gateway is a field-level match for the repo candidate');

  BOT_ID = /const BOT_ID = '(\d+)'/.exec(gwLive.nodes.find((n) => n.name === VERIFY_NODE).parameters.jsCode)[1];
  ok('bot id read from the live verifier (public value)');

  const codes = {};
  for (const n of gwLive.nodes.filter((x) => x.type === 'n8n-nodes-base.respondToWebhook')) {
    codes[n.name] = n.parameters.options.responseCode;
  }
  must('live Respond Store Unavailable is the NUMBER 503', codes['Respond Store Unavailable'] === 503 && typeof codes['Respond Store Unavailable'] === 'number');
  must('live Respond Bootstrap OK is the NUMBER 200', codes['Respond Bootstrap OK'] === 200);
  must('live Respond Replay Refused is the NUMBER 409', codes['Respond Replay Refused'] === 409);

  const ledgerBefore = null; // Supabase is read outside this script; see the report.
  const sessionsBefore = (await api('GET', '/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data.length;
  ok('production app-session rows before: ' + sessionsBefore);

  // A context signed with the harness key MUST be rejected by the real Gateway. This is the
  // guard that says the harness key cannot be turned against production.
  const probe = await shot('finmentor-miniapp-gateway', {});
  must('the harness key is REJECTED by the production Gateway (401 TG_INITDATA_INVALID)',
    probe.status === 401 && probe.data && probe.data.error_code === 'TG_INITDATA_INVALID',
    'got ' + probe.status + ' ' + JSON.stringify(probe.data));

  const sessionsAfterProbe = (await api('GET', '/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data.length;
  must('the rejected probe minted no app session', sessionsAfterProbe === sessionsBefore,
    sessionsBefore + ' -> ' + sessionsAfterProbe);

  if (!RUN) {
    say('');
    say('PREFLIGHT ONLY: pass --run to deploy, exercise and tear down the harness.');
    return finish(sessionsBefore);
  }

  say('');
  say('== DEPLOY (disposable) ====================================');

  // A dead store: loopback, a port nothing listens on. Connection refused, immediately.
  const deadPassword = crypto.randomBytes(24).toString('base64url');
  const cred = await api('POST', '/credentials', {
    name: 'P9-R2 dead store (disposable)',
    type: 'postgres',
    data: { host: '127.0.0.1', port: 1, database: 'p9r2_no_such_db', user: 'p9r2_nobody', password: deadPassword, ssl: 'disable', maxConnections: 1, allowUnauthorizedCerts: false }
  }, true);
  created.credential = cred.id;
  ok('disposable dead-store credential created (points at 127.0.0.1:1, nothing listens)');

  for (const [key, file, name] of [['h1', 'gw-store-failure-h1-candidate.json', H1_NAME],
                                   ['h2', 'gw-store-failure-h2-candidate.json', H2_NAME]]) {
    let raw = readFileSync(join(ROOT, 'n8n', 'candidate', file), 'utf8');
    raw = raw.split(PUBKEY_PLACEHOLDER).join(HARNESS_PUBKEY_HEX).split(CREDENTIAL_PLACEHOLDER).join(created.credential);
    const wf = JSON.parse(raw);
    if (JSON.stringify(wf).indexOf(PRODUCTION_G5_CREDENTIAL_ID) !== -1) { die('refusing to deploy: production credential present in ' + key); }
    const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
    const made = await api('POST', '/workflows', payload, true);
    created[key] = made.id;
    await api('POST', '/workflows/' + made.id + '/activate', null, true);
    ok(key.toUpperCase() + ' deployed and activated: ' + made.id + '  (' + name + ')');
  }

  say('');
  say('== SHOTS ==================================================');

  const results = {};

  results.down = await shot(H1_PATH, { harness_store: 'down' }, 5);
  say('  H1 store DOWN     -> HTTP ' + results.down.status + '  ' + JSON.stringify(results.down.data));
  results.won = await shot(H1_PATH, { harness_store: 'won' }, 3);
  say('  H1 store WON      -> HTTP ' + results.won.status + '  ' + summarise(results.won.data));
  results.lost = await shot(H1_PATH, { harness_store: 'lost' }, 3);
  say('  H1 store LOST     -> HTTP ' + results.lost.status + '  ' + JSON.stringify(results.lost.data));
  results.unset = await shot(H1_PATH, {}, 3);
  say('  H1 mode UNSET     -> HTTP ' + results.unset.status + '  ' + JSON.stringify(results.unset.data));
  results.dead = await shot(H2_PATH, {}, 5);
  say('  H2 REAL pg, dead  -> HTTP ' + results.dead.status + '  ' + JSON.stringify(results.dead.data));

  say('');
  say('== VERDICTS ===============================================');

  const d = results.down.data || {};
  must('store DOWN answers HTTP 503', results.down.status === 503, 'got ' + results.down.status);
  must('store DOWN answers REPLAY_STORE_UNAVAILABLE', d.error_code === 'REPLAY_STORE_UNAVAILABLE');
  must('store DOWN is not an accept', d.ok === false);
  must('store DOWN mints no app_session_id', d.app_session_id === undefined);
  must('store DOWN is marked retryable', d.retryable === true);
  must('store DOWN leaks nothing but the contract', Object.keys(d).sort().join(',') === 'error_code,ok,retryable',
    'keys: ' + Object.keys(d).join(','));

  const dead = results.dead.data || {};
  must('REAL postgres against a dead store answers HTTP 503', results.dead.status === 503, 'got ' + results.dead.status);
  must('REAL postgres dead store answers REPLAY_STORE_UNAVAILABLE', dead.error_code === 'REPLAY_STORE_UNAVAILABLE');
  must('REAL postgres dead store mints no app_session_id', dead.app_session_id === undefined);
  must('REAL postgres dead store leaks no connection detail', Object.keys(dead).sort().join(',') === 'error_code,ok,retryable',
    'keys: ' + Object.keys(dead).join(','));
  const deadRaw = (results.dead.raw || '').toLowerCase();
  for (const secret of ['127.0.0.1', 'p9r2_nobody', 'p9r2_no_such_db', 'econnrefused', 'password', 'stack']) {
    must('REAL postgres dead store body does not contain "' + secret + '"', deadRaw.indexOf(secret) === -1);
  }

  // The controls. Without these, a harness that 503s on EVERYTHING would look like a pass.
  const w = results.won.data || {};
  must('CONTROL: a WON claim still answers HTTP 200', results.won.status === 200, 'got ' + results.won.status);
  must('CONTROL: a WON claim still issues an app_session_id', typeof w.app_session_id === 'string' && /^AS-[0-9a-f]{64}$/.test(w.app_session_id));
  const l = results.lost.data || {};
  must('CONTROL: a LOST claim still answers HTTP 409', results.lost.status === 409, 'got ' + results.lost.status);
  must('CONTROL: a LOST claim still answers REPLAY_REFUSED', l.error_code === 'REPLAY_REFUSED');
  must('CONTROL: replay semantics are not weakened by the store path', l.ok === false && l.app_session_id === undefined);

  const u = results.unset.data || {};
  must('an UNRECOGNISED store mode fails CLOSED with 503', results.unset.status === 503 && u.error_code === 'REPLAY_STORE_UNAVAILABLE',
    'got ' + results.unset.status + ' ' + JSON.stringify(u));

  say('');
  say('== PRODUCTION UNTOUCHED ===================================');
  const sessionsAfter = (await api('GET', '/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data.length;
  must('production app-session rows unchanged across the whole run', sessionsAfter === sessionsBefore,
    sessionsBefore + ' -> ' + sessionsAfter);
  const gwAfter = await api('GET', '/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  must('the Gateway graph is unchanged', normalise(gwAfter) === normalise(gwLive));
  must('the Gateway is still active', gwAfter.active === true);
  const gwExec = await api('GET', '/executions?limit=100&workflowId=' + GATEWAY_ID);
  must('the Gateway still retains zero executions', gwExec.data.length === 0, 'found ' + gwExec.data.length);

  return finish(sessionsBefore);
}

function summarise(data) {
  if (!data) { return 'null'; }
  const c = Object.assign({}, data);
  if (typeof c.app_session_id === 'string') { c.app_session_id = c.app_session_id.slice(0, 13) + '…'; }
  return JSON.stringify(c);
}

function finish(sessionsBefore) {
  return { sessionsBefore };
}

// n8n answers DELETE with 409 "still being unpublished" for a few seconds after a webhook
// workflow is deactivated. A single DELETE therefore leaks a live harness; retry until it is
// actually gone, and only then believe it.
async function hardDelete(path) {
  let last = null;
  for (let i = 0; i < 12; i++) {
    try { await api('DELETE', path, null, true); return { ok: true }; }
    catch (e) { last = e.message; await new Promise((r) => setTimeout(r, 4000)); }
  }
  return { ok: false, error: last };
}

async function teardown() {
  say('');
  say('== TEARDOWN ===============================================');
  const stuck = [];
  for (const key of ['h1', 'h2']) {
    if (!created[key]) { continue; }
    try {
      await api('POST', '/workflows/' + created[key] + '/deactivate', null, true);
      const r = await hardDelete('/workflows/' + created[key]);
      if (!r.ok) { throw new Error(r.error); }
      ok(key.toUpperCase() + ' deleted (' + created[key] + ')');
    } catch (e) { stuck.push(key + ' workflow ' + created[key] + ': ' + e.message); }
  }
  if (created.credential) {
    try {
      const r = await hardDelete('/credentials/' + created.credential);
      if (!r.ok) { throw new Error(r.error); }
      ok('disposable dead-store credential deleted (' + created.credential + ')');
    } catch (e) { stuck.push('credential ' + created.credential + ': ' + e.message); }
  }
  // Prove they are gone rather than assuming the DELETE meant it.
  for (const key of ['h1', 'h2']) {
    if (!created[key]) { continue; }
    try {
      await api('GET', '/workflows/' + created[key]);
      stuck.push(key + ' workflow ' + created[key] + ' still readable after delete');
    } catch (e) { ok(key.toUpperCase() + ' confirmed gone'); }
  }
  if (stuck.length) {
    console.error('');
    console.error('TEARDOWN INCOMPLETE — remove these by hand:');
    stuck.forEach((s) => console.error('  - ' + s));
    return false;
  }
  return true;
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error('\nERROR: ' + e.message);
  exitCode = 1;
} finally {
  const clean = await teardown();
  if (!clean) { exitCode = 1; }
  say('');
  if (failures.length) {
    say('RESULT: ' + failures.length + ' check(s) FAILED');
    failures.forEach((f) => say('  - ' + f));
    exitCode = 1;
  } else if (RUN) {
    say('RESULT: STORE FAILURE = ISOLATED PASS');
  } else {
    say('RESULT: preflight only');
  }
  process.exit(exitCode);
}
