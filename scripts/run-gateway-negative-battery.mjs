#!/usr/bin/env node
// FINMENTOR — P9 STEP 3A: re-run the approved negative battery against the DEPLOYED Gateway.
//
//   node scripts/run-gateway-negative-battery.mjs
//
// Every case here is one of the eleven already approved in docs/P9_GATEWAY_NEGATIVE_LIVE_PROOF.md
// (§2/3), plus an empty-string `init_data` that exercises the same presence check as an absent
// one. Nothing new is invented: the point is regression, not discovery. P9-R2 changed the claim
// query and the verdict, and `Respond Rejected` is the shared path for 400/401/403 — this is what
// says the change did not disturb it.
//
// NO OWNER ACTION. Every payload is synthetic. Not one of them can carry a valid Telegram
// signature, so not one of them can reach `Derive Replay Key` — which sits downstream of
// `IF Verified` — and therefore none can consume a replay key. That is asserted, not assumed:
// the app-session count and the Gateway execution count are read before and after.
//
// It never writes to any workflow, never touches Supabase, Neon, the G5 credential or any other
// workflow. It only POSTs to the public Gateway route and GETs read-only n8n state.
//
// SECRETS. Reads use N8N_API_KEY. No write key is used or needed. No signed Telegram material
// exists in this process: the forged signatures are random bytes, which is the point.

import crypto from 'node:crypto';

const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const PAGE_ID = 'EU91nSsmqQqIeD8w';
const SESSION_TABLE_ID = 'LRme88caqxFzTLqW';
const ROUTE = 'finmentor-miniapp-gateway';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;

function die(m) { console.error('\nABORTED: ' + m); process.exitCode = 1; throw new Error(m); }
function say(m) { console.log(m); }
if (!BASE) { die('N8N_BASE_URL is not set.'); }
if (!READ_KEY) { die('N8N_API_KEY is not set.'); }

const failures = [];
function must(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

async function api(path) {
  const res = await fetch(BASE + '/api/v1' + path, { headers: { 'X-N8N-API-KEY': READ_KEY } });
  const text = await res.text();
  if (!res.ok) { throw new Error('GET ' + path + ' -> ' + res.status + ' ' + text.slice(0, 200)); }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------- synthetic initData
//
// A FORGED context: the signature is random bytes. It cannot verify against Telegram's production
// Ed25519 key, which is exactly what each 401 case needs. No genuine signed material is used
// anywhere in this file, and none is available to it.
const LF = String.fromCharCode(10);
function forged(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const pairs = [
    ['auth_date', String(over.auth_date !== undefined ? over.auth_date : now - 5)],
    ['query_id', 'NEG-' + crypto.randomBytes(8).toString('hex')],
    ['user', JSON.stringify({ id: 990000002, first_name: 'Negative', is_bot: false, language_code: 'ru' })],
    ['hash', crypto.randomBytes(32).toString('hex')],
    ['signature', crypto.randomBytes(64).toString('base64url')]
  ];
  return pairs.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

async function post(body, contentType) {
  const isString = typeof body === 'string';
  const res = await fetch(BASE + '/webhook/' + ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/json' },
    body: isString ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep raw */ }
  return { status: res.status, data, raw: text };
}

const OK_BODY = (init) => ({ init_data: init, client_version: 'b2.1.0', locale: 'ru' });

// ---------------------------------------------------------------- the approved battery
//
// name, how the request is built, expected HTTP status, expected error_code
const CASES = [
  ['non-JSON content-type', () => post(OK_BODY(forged()), 'text/plain'), 400, 'BAD_REQUEST'],
  ['unsupported client_version', () => post({ init_data: forged(), client_version: 'b9.9.9', locale: 'ru' }), 400, 'CLIENT_VERSION_UNSUPPORTED'],
  ['unsupported locale', () => post({ init_data: forged(), client_version: 'b2.1.0', locale: 'en' }), 400, 'BAD_REQUEST'],
  ['init_data absent', () => post({ client_version: 'b2.1.0', locale: 'ru' }), 400, 'TG_INITDATA_MISSING'],
  ['init_data empty string', () => post(OK_BODY('')), 400, 'TG_INITDATA_MISSING'],

  ['forged signature, fresh auth_date', () => post(OK_BODY(forged())), 401, 'TG_INITDATA_INVALID'],
  ['forged signature, STALE auth_date (2h)', () => post(OK_BODY(forged({ auth_date: Math.floor(Date.now() / 1000) - 7200 }))), 401, 'TG_INITDATA_INVALID'],
  ['forged signature, FUTURE auth_date', () => post(OK_BODY(forged({ auth_date: Math.floor(Date.now() / 1000) + 7200 }))), 401, 'TG_INITDATA_INVALID'],
  ['signature field absent', () => post(OK_BODY(forged().replace(/&signature=[^&]*/, ''))), 401, 'TG_INITDATA_INVALID'],
  ['malformed initData (empty pair)', () => post(OK_BODY(forged() + '&&')), 401, 'TG_INITDATA_INVALID'],
  ['malformed percent-encoding', () => post(OK_BODY(forged() + '&bad=%E0%A4%A')), 401, 'TG_INITDATA_INVALID'],
  ['duplicate key', () => post(OK_BODY(forged() + '&auth_date=' + Math.floor(Date.now() / 1000))), 401, 'TG_INITDATA_INVALID']
];

// Anything that looks like signed material, a secret, or a person. If a rejection body ever
// echoes one of these, the response layer is leaking and the code alone would not have shown it.
const LEAK_NEEDLES = ['query_id=', 'auth_date=', 'signature=', 'hash=', 'init_data', 'initData',
  'bot', 'token', 'password', 'stack', 'Error:', 'at Object', 'postgres', 'supabase',
  'telegram_initdata_replays', '990000002', 'Negative'];

async function main() {
  say('');
  say('== BASELINE (read-only) ===================================');
  const gw = await api('/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  must('the Gateway is the deployed one and ACTIVE', gw.active === true && gw.nodes.length === 13,
    'active=' + gw.active + ' nodes=' + gw.nodes.length);

  const claim = gw.nodes.find((n) => n.name === 'G5 Replay Claim');
  must('P9-R2 is deployed: no alwaysOutputData, CTE query, error output routed',
    !claim.alwaysOutputData && /as claimed/i.test(claim.parameters.query) && claim.onError === 'continueErrorOutput');

  const rejected = gw.nodes.find((n) => n.name === 'Respond Rejected');
  must('Respond Rejected still derives its code from the validator',
    String(rejected.parameters.options.responseCode) === '={{ $json.statusCode }}',
    JSON.stringify(rejected.parameters.options.responseCode));

  const sessionsBefore = (await api('/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data.length;
  const gwExecBefore = (await api('/executions?limit=100&workflowId=' + GATEWAY_ID)).data.length;
  const pageExecBefore = (await api('/executions?limit=100&workflowId=' + PAGE_ID)).data.length;
  say('  app-session rows before      : ' + sessionsBefore);
  say('  Gateway retained executions  : ' + gwExecBefore);
  say('  page retained executions     : ' + pageExecBefore);
  must('Gateway retains zero executions before the battery', gwExecBefore === 0, String(gwExecBefore));

  say('');
  say('== BATTERY ================================================');
  const results = [];
  for (const [name, build, wantStatus, wantCode] of CASES) {
    const r = await build();
    results.push([name, r, wantStatus, wantCode]);
    const got = r.status + ' ' + ((r.data || {}).error_code || '(no code)');
    say('  ' + name.padEnd(42) + ' -> ' + got);
  }

  say('');
  say('== VERDICTS ===============================================');
  for (const [name, r, wantStatus, wantCode] of results) {
    const d = r.data || {};
    must(name + ': HTTP ' + wantStatus, r.status === wantStatus, 'got ' + r.status);
    must(name + ': ' + wantCode, d.error_code === wantCode, 'got ' + JSON.stringify(d.error_code));
    must(name + ': ok:false', d.ok === false, JSON.stringify(d.ok));
    must(name + ': retryable:false', d.retryable === false, JSON.stringify(d.retryable));
    must(name + ': body is exactly the three-key contract',
      Object.keys(d).sort().join(',') === 'error_code,ok,retryable', 'keys: ' + Object.keys(d).join(','));
    must(name + ': mints no app_session_id', d.app_session_id === undefined);
    const raw = String(r.raw || '');
    const leaked = LEAK_NEEDLES.filter((n) => raw.indexOf(n) !== -1);
    must(name + ': leak_fields []', leaked.length === 0, 'leaked: ' + leaked.join(','));
  }

  say('');
  say('== AFTER ==================================================');
  const sessionsAfter = (await api('/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data.length;
  const gwExecAfter = (await api('/executions?limit=100&workflowId=' + GATEWAY_ID)).data.length;
  const pageExecAfter = (await api('/executions?limit=100&workflowId=' + PAGE_ID)).data.length;
  must('NO app session was created by any rejected request', sessionsAfter === sessionsBefore,
    sessionsBefore + ' -> ' + sessionsAfter);
  must('Gateway retained executions still zero', gwExecAfter === 0, String(gwExecAfter));
  must('page retained executions unchanged', pageExecAfter === pageExecBefore,
    pageExecBefore + ' -> ' + pageExecAfter);

  const gwAfter = await api('/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  must('the Gateway graph is unchanged by the battery',
    JSON.stringify(gwAfter.nodes) === JSON.stringify(gw.nodes) &&
    JSON.stringify(gwAfter.connections) === JSON.stringify(gw.connections));
  must('the Gateway is still active', gwAfter.active === true);
  must('FINMENTOR Supabase G5 is still the only Gateway Postgres credential',
    gwAfter.nodes.filter((n) => n.credentials).length === 1 &&
    gwAfter.nodes.find((n) => n.credentials).credentials.postgres.id === 'B6wRirWfjqoASXU3');

  say('');
  say('  NOTE: the replay ledger is in Supabase and is read outside this script.');
  say('        Every case above carries a random signature, so none can pass Ed25519, and');
  say('        Derive Replay Key sits downstream of IF Verified — no case can reach the claim.');

  say('');
  if (failures.length) {
    say('== RESULT: NEGATIVE BATTERY = FAIL ========================');
    failures.forEach((f) => say('  - ' + f));
    process.exitCode = 1;
  } else {
    say('== RESULT: NEGATIVE BATTERY = LIVE PASS ===================');
    say('  ' + CASES.length + ' cases, all deterministic, zero side effects.');
  }
}

main().catch((e) => { console.error('\nABORTED: ' + e.message); process.exitCode = 1; });
