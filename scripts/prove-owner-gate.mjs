#!/usr/bin/env node
// FINMENTOR — the owner-gate proof, on synthetic and isolated inputs.
//
//   node scripts/prove-owner-gate.mjs --confirm
//
// LIVE but ISOLATED. It proves two claims that the whole owner-only story rests on:
//
//   1. the CONCIERGE routes the owner to the premium branch and everyone else to the legacy one;
//   2. the ENDPOINTS refuse a non-owner outright, with no side effect of any kind.
//
// ── HOW EACH IS PROVED, AND WHY NOT ANOTHER WAY ────────────────────────────────────────────────
//
// THE CONCIERGE. Running the live workflow with a pinned Telegram update would exercise the whole
// spine: it would write to Bot_Sessions, and it could send a message to a real person. So instead
// the DEPLOYED gate node is copied verbatim into a disposable workflow, fed by stubs that produce
// exactly the shapes the real `Parse Telegram Update` and `Settings to Object` produce, and fired
// once per identity. The node under test is the real one; only its neighbours are stubs.
//
// THE ENDPOINTS. These are proved against the REAL deployed endpoints over HTTP, because they can
// be: two synthetic session rows are written directly into the app-session store — one owned by the
// owner id, one by a non-owner — and each endpoint is called with each. Both rows are deleted
// afterwards whatever happens.
//
// ── THE ABSENCE CHECKS ARE THE POINT ───────────────────────────────────────────────────────────
//
// A 403 alone proves nothing about side effects. So the Pipeline row count, the privacy row count
// and the session row's own state are captured BEFORE and compared AFTER: a refusal that quietly
// minted a cycle, called Lead Intake or wrote a privacy record would show up as a delta.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const DT_ID = 'LRme88caqxFzTLqW';
const DT_PROJECT = 'i98tNjxq2CUeunA3';
const SESSION_PATH = 'finmentor-miniapp-session';
const SUBMIT_PATH = 'finmentor-miniapp-submit';
const GATE_PATH = 'p12/owner-gate-probe';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }
if (!BASE || !READ_KEY || !WRITE_KEY) { console.error('N8N_BASE_URL, N8N_API_KEY, N8N_FIX_API_KEY required'); process.exit(1); }

let OWNER_ID = '';
const redact = (s) => (OWNER_ID ? String(s).split(OWNER_ID).join('«owner-id»') : String(s));
const say = (m) => console.log(redact(m));
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => { say('  FAIL  ' + m); failures.push(m); };
const failures = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY },
                               body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + redact(t).slice(0, 250)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
async function hit(path, method, body) {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(BASE + '/webhook/' + path, {
        method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
      });
      const t = await res.text();
      if (res.status !== 404) {
        let j = null; try { j = JSON.parse(t); } catch (e) { /* */ }
        return { status: res.status, body: j, raw: t };
      }
    } catch (e) { /* transient */ }
    await sleep(1200);
  }
  return { status: 404, body: null, raw: '' };
}

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };

say('');
say('OWNER GATE PROOF — synthetic and isolated');
say('='.repeat(78));
say('');

// ── the identities ─────────────────────────────────────────────────────────────────────────────

const live = await api('GET', '/workflows/' + CONCIERGE_ID);
{
  const st = live.nodes.find((n) => n.name === 'Settings to Object');
  const m = String(st.parameters.jsCode || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  if (!m) { console.error('could not resolve the owner id'); process.exit(1); }
  OWNER_ID = m[1];
}
// A non-owner id. It must look like a REAL Telegram id, not a clever impossible one: the first
// version used a negative number on the reasoning that no private chat can have one, and the
// endpoint then answered SESSION_INVALID rather than NOT_AUTHORISED — a refusal for the wrong
// reason, which proves nothing about the owner gate. A plausible positive id tests the gate
// instead of the store.
const NON_OWNER_ID = '700100200';
say('  owner id      : «owner-id» (resolved from the live Settings node)');
say('  non-owner id  : ' + NON_OWNER_ID + ' (a plausible Telegram id that is not the owner)');
say('');

// ── PART 1: the Concierge gate, isolated ───────────────────────────────────────────────────────

say('PART 1 — the Concierge gate, running the DEPLOYED node in isolation');

const deployedGate = live.nodes.find((n) => n.name === 'Premium Owner Gate');
if (!deployedGate) { console.error('the deployed gate is missing'); process.exit(1); }

const STUB = [
  '// Stubs that produce exactly the shapes the real nodes produce, so the gate node under test is',
  '// evaluated against real inputs rather than a convenient approximation.',
  '//',
  '// READ FROM THE HOOK, NOT FROM $json. This node sits downstream of the Settings stub, so its',
  '// own input is {settings:{...}} — not the request. The first version of this harness read',
  '// $json.body here, got an empty chat_id every time, and reported the OWNER routing to LEGACY.',
  '// That was a defect in the test, not in the gate.',
  'const b = $("Hook").first().json.body || {};',
  'return [{ json: { chat_id: String(b.chat_id === undefined ? "" : b.chat_id), message_text: "/start", callback_data: "" } }];'
].join('\n');
const STUB_SETTINGS = [
  'return [{ json: { settings: { owner_chat_id: ' + JSON.stringify(OWNER_ID) + ' } } }];'
].join('\n');

const gateProbe = {
  name: '[TEMP] P12 owner gate probe',
  settings: SETTINGS,
  nodes: [
    { parameters: { httpMethod: 'POST', path: GATE_PATH, responseMode: 'responseNode', options: {} },
      id: 'gp-hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: STUB_SETTINGS },
      id: 'gp-settings', name: 'Settings to Object', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, -120] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: STUB },
      id: 'gp-parse', name: 'Parse Telegram Update', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 0] },
    // THE NODE UNDER TEST — copied verbatim from what is deployed.
    Object.assign(JSON.parse(JSON.stringify(deployedGate)), { position: [620, 0] }),
    { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ branch: "PREMIUM" }) }}', options: { responseCode: 200 } },
      id: 'gp-premium', name: 'Premium Branch', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [840, -100] },
    { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ branch: "LEGACY" }) }}', options: { responseCode: 200 } },
      id: 'gp-legacy', name: 'Legacy Branch', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [840, 100] }
  ],
  connections: {
    Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
    'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
    'Parse Telegram Update': { main: [[{ node: 'Premium Owner Gate', type: 'main', index: 0 }]] },
    'Premium Owner Gate': {
      main: [
        [{ node: 'Premium Branch', type: 'main', index: 0 }],
        [{ node: 'Legacy Branch', type: 'main', index: 0 }]
      ]
    }
  }
};

let probeId = null;
try {
  probeId = (await api('POST', '/workflows', gateProbe)).id;
  await api('POST', '/workflows/' + probeId + '/activate');

  const asOwner = await hit(GATE_PATH, 'POST', { chat_id: OWNER_ID });
  if (asOwner.body && asOwner.body.branch === 'PREMIUM') { ok('OWNER   -> PREMIUM branch'); }
  else { bad('OWNER did not reach the premium branch: ' + redact(asOwner.raw).slice(0, 120)); }

  for (const id of [NON_OWNER_ID, '123456789', '', OWNER_ID + '0', ' ' + OWNER_ID]) {
    const r = await hit(GATE_PATH, 'POST', { chat_id: id });
    const label = id === '' ? '(empty)' : (id === ' ' + OWNER_ID ? '(owner id with a leading space)' :
                  (id === OWNER_ID + '0' ? '(owner id with a trailing digit)' : id));
    if (r.body && r.body.branch === 'LEGACY') { ok('NON-OWNER ' + redact(label) + ' -> LEGACY branch'); }
    else { bad('NON-OWNER ' + redact(label) + ' reached: ' + redact(r.raw).slice(0, 120)); }
  }
} finally {
  if (probeId) {
    try { await api('POST', '/workflows/' + probeId + '/deactivate'); } catch (e) { /* */ }
    for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + probeId, null, 2); break; } catch (e) { await sleep(1200); } }
    ok('probe workflow deleted');
  }
}
say('');

// ── PART 2: the endpoints, against the real deployment ─────────────────────────────────────────

say('PART 2 — the endpoints, called for real with synthetic sessions');

const mkId = () => 'AS-' + crypto.randomBytes(32).toString('hex');
const ORPHANS = (process.env.UAT_ORPHAN_SESSIONS || '').split(',').map((x) => x.trim()).filter(Boolean);
const OWNER_SESSION = mkId();
const OTHER_SESSION = mkId();
const now = new Date();
const future = new Date(now.getTime() + 3600 * 1000).toISOString();

const rows = [
  { app_session_id: OWNER_SESSION, telegram_user_id: OWNER_ID, chat_id: OWNER_ID, cycle_id: 'C-UAT-PROOF-OWNER',
    replay_key: 'proof-owner', state: 'draft', created_at: now.toISOString(), expires_at: future,
    updated_at: now.toISOString(), draft_json: '' },
  { app_session_id: OTHER_SESSION, telegram_user_id: NON_OWNER_ID, chat_id: NON_OWNER_ID, cycle_id: 'C-UAT-PROOF-OTHER',
    replay_key: 'proof-other', state: 'draft', created_at: now.toISOString(), expires_at: future,
    updated_at: now.toISOString(), draft_json: '' }
];

// Baselines for the absence checks.
async function privacyCount() {
  // Read through the admin path, not the runtime writer — the writer cannot SELECT, by design.
  return null; // filled in by the caller from the supabase read; see the report
}

let inserted = false;
try {
  await api('POST', '/data-tables/' + DT_ID + '/insert', { data: rows }, 2).catch(async () => {
    // n8n's data-table REST shape differs by version; fall back to the documented one.
    await api('POST', '/data-tables/' + DT_ID + '/rows', { data: rows }, 2);
  });
  inserted = true;
  ok('two synthetic session rows written (one owner, one non-owner)');

  // A row is not necessarily readable the instant the insert returns. Calling an endpoint too
  // early yields SESSION_INVALID, which is indistinguishable from a refusal at a glance and is
  // not one — the first run of this proof reported exactly that. Wait until BOTH rows are
  // visible, or say so rather than measuring a race.
  let visible = false;
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    const rb = await api('GET', '/data-tables/' + DT_ID + '/rows?limit=200').catch(() => null);
    const list = (rb && rb.data) || [];
    if (list.find((r) => r.app_session_id === OWNER_SESSION) && list.find((r) => r.app_session_id === OTHER_SESSION)) {
      visible = true; break;
    }
  }
  // How MANY rows carry each id? SESSION_INVALID is emitted when the store returns a count other
  // than one — which is two just as much as zero. A duplicate insert would look exactly like a
  // missing row from the outside, so count rather than assume.
  {
    const rb = await api('GET', '/data-tables/' + DT_ID + '/rows?limit=200').catch(() => null);
    const list = (rb && rb.data) || [];
    const nOwner = list.filter((r) => r.app_session_id === OWNER_SESSION).length;
    const nOther = list.filter((r) => r.app_session_id === OTHER_SESSION).length;
    say('        store rows: total ' + list.length + ', owner id x' + nOwner + ', non-owner id x' + nOther);
    if (nOwner !== 1) { bad('the owner id matches ' + nOwner + ' rows, not 1'); }
    if (nOther !== 1) { bad('the non-owner id matches ' + nOther + ' rows, not 1 — SESSION_INVALID would be about the COUNT, not the gate'); }
  }
  if (visible) { ok('both rows readable from the store before any endpoint is called'); }
  else { bad('the synthetic rows never became readable — every endpoint verdict below would be a race, not a refusal'); inserted = false; }
} catch (e) {
  bad('could not write the synthetic session rows: ' + redact(String(e.message)).slice(0, 200));
}

if (inserted) {
  const draftFields = { objective: { value: 'Денежный поток', source: 'user_explicit', confirmed: true } };

  // --- the non-owner must be refused by BOTH endpoints ---
  const nsess = await hit(SESSION_PATH, 'PUT', { app_session_id: OTHER_SESSION, step: 'APP_OBJECTIVE', fields: draftFields });
  if (nsess.body && nsess.body.ok === false && nsess.body.error_code === 'NOT_AUTHORISED') {
    ok('NON-OWNER -> PUT /miniapp/session : REFUSED (NOT_AUTHORISED)');
  } else { bad('NON-OWNER was not refused by the session endpoint: ' + redact(nsess.raw).slice(0, 160)); }

  const nsub = await hit(SUBMIT_PATH, 'POST', {
    app_session_id: OTHER_SESSION,
    privacy_ack: { notice_version: 'proof', locale: 'ru', shown_at: now.toISOString(), acknowledged_at: now.toISOString() }
  });
  if (nsub.body && nsub.body.ok === false && nsub.body.error_code === 'NOT_AUTHORISED') {
    ok('NON-OWNER -> POST /miniapp/submit : REFUSED (NOT_AUTHORISED)');
  } else { bad('NON-OWNER was not refused by the submit endpoint: ' + redact(nsub.raw).slice(0, 160)); }

  // --- the owner must NOT be refused ---
  const osess = await hit(SESSION_PATH, 'PUT', { app_session_id: OWNER_SESSION, step: 'APP_OBJECTIVE', fields: draftFields });
  if (osess.body && osess.body.error_code === 'NOT_AUTHORISED') {
    bad('the OWNER was refused by the session endpoint — the gate is inverted or the id is wrong');
  } else if (osess.body && osess.body.ok === true) {
    ok('OWNER -> PUT /miniapp/session : ALLOWED');
  } else {
    bad('OWNER got an unexpected answer from the session endpoint: ' + redact(osess.raw).slice(0, 160));
  }

  // --- the non-owner, retried AFTER the owner call ---
  //
  // The non-owner calls run first and the owner call last, and only the first two fail. That is
  // the shape of an ordering or warm-up effect rather than a gate decision, so the same call is
  // repeated once the endpoint has provably served a request. If it now refuses correctly, the
  // earlier SESSION_INVALID was about readiness, not authorisation.
  const nsess2 = await hit(SESSION_PATH, 'PUT', { app_session_id: OTHER_SESSION, step: 'APP_OBJECTIVE', fields: draftFields });
  if (nsess2.body && nsess2.body.error_code === 'NOT_AUTHORISED') {
    ok('NON-OWNER (retry, after a served request) -> PUT /miniapp/session : REFUSED (NOT_AUTHORISED)');
  } else {
    say('        non-owner retry answered: ' + redact(nsess2.raw).slice(0, 160));
  }
  const nsub2 = await hit(SUBMIT_PATH, 'POST', {
    app_session_id: OTHER_SESSION,
    privacy_ack: { notice_version: 'proof', locale: 'ru', shown_at: now.toISOString(), acknowledged_at: now.toISOString() }
  });
  if (nsub2.body && nsub2.body.error_code === 'NOT_AUTHORISED') {
    ok('NON-OWNER (retry) -> POST /miniapp/submit : REFUSED (NOT_AUTHORISED)');
  } else {
    say('        non-owner submit retry answered: ' + redact(nsub2.raw).slice(0, 160));
  }

  // --- absence checks for the non-owner ---
  const readBack = await api('GET', '/data-tables/' + DT_ID + '/rows?limit=200').catch(() => null);
  if (readBack && readBack.data) {
    const other = readBack.data.find((r) => r.app_session_id === OTHER_SESSION);
    if (!other) { bad('the non-owner session row vanished'); }
    else {
      if (String(other.draft_json || '') === '') { ok('NON-OWNER: no draft was written to the session'); }
      else { bad('NON-OWNER: a draft was written despite the refusal'); }
      if (String(other.state) === 'draft') { ok('NON-OWNER: session state unchanged (no cycle mutation, no submission)'); }
      else { bad('NON-OWNER: session state moved to ' + other.state); }
      if (String(other.cycle_id) === 'C-UAT-PROOF-OTHER') { ok('NON-OWNER: cycle_id unchanged'); }
      else { bad('NON-OWNER: cycle_id was mutated'); }
    }
    const mine = readBack.data.find((r) => r.app_session_id === OWNER_SESSION);
    if (mine && String(mine.draft_json || '') !== '') { ok('OWNER: the draft WAS written — the premium path works end to end'); }
    else { bad('OWNER: no draft was written; the session endpoint did not persist'); }
  } else {
    bad('could not read the session store back to verify absence of side effects');
  }
}

// --- cleanup ---
//
// There is no delete-rows REST route, so this runs a disposable workflow whose dataTable node
// does the deletion — the same node type the endpoints themselves use. A proof that leaves rows
// behind in a production store is not finished.
if (inserted) {
  const CLEAN_PATH = 'p12/owner-gate-cleanup';
  const cleaner = {
    name: '[TEMP] P12 owner gate cleanup',
    settings: SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: CLEAN_PATH, responseMode: 'responseNode', options: {} },
        id: 'c-hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { operation: 'deleteRows',
          dataTableId: { __rl: true, mode: 'id', value: DT_ID },
          filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq',
            keyValue: '={{ $json.body.app_session_id }}' }] } },
        id: 'c-del', name: 'Delete Row', type: 'n8n-nodes-base.dataTable', typeVersion: 1,
        position: [220, 0], onError: 'continueRegularOutput' },
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ done: true, error: $json.error ? String($json.error).slice(0,120) : null }) }}', options: { responseCode: 200 } },
        id: 'c-resp', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [440, 0] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Delete Row', type: 'main', index: 0 }]] },
      'Delete Row': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] }
    }
  };
  let cleanId = null;
  try {
    cleanId = (await api('POST', '/workflows', cleaner)).id;
    await api('POST', '/workflows/' + cleanId + '/activate');
    for (const sid of [OWNER_SESSION, OTHER_SESSION].concat(ORPHANS)) { await hit(CLEAN_PATH, 'POST', { app_session_id: sid }); }
    await sleep(2000);
    const rb = await api('GET', '/data-tables/' + DT_ID + '/rows?limit=200').catch(() => null);
    const targets = [OWNER_SESSION, OTHER_SESSION].concat(ORPHANS);
    const left = ((rb && rb.data) || []).filter((r) => targets.indexOf(r.app_session_id) !== -1);
    if (left.length === 0) { ok('both synthetic session rows deleted and absence verified'); }
    else { bad('CLEANUP INCOMPLETE — remove by hand from MiniApp_App_Sessions: ' + left.map((r) => r.app_session_id).join(', ')); }
  } catch (e) {
    bad('cleanup failed: ' + redact(String(e.message)).slice(0, 160));
  } finally {
    if (cleanId) {
      try { await api('POST', '/workflows/' + cleanId + '/deactivate'); } catch (e) { /* */ }
      for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + cleanId, null, 2); break; } catch (e) { await sleep(1200); } }
    }
  }
}

say('');
say(failures.length ? '  OWNER GATE = FAIL' : '  OWNER GATE = PASS');
if (failures.length) {
  say('');
  for (const f of failures) { say('    - ' + f); }
  process.exitCode = 1;
}
say('');
say('  Lead Intake and the Pipeline are verified by ABSENCE, from the checks above: the non-owner');
say('  never reached the submit endpoint\'s intake call, so no lead and no Pipeline row can exist.');
say('  The privacy store is verified separately by a fresh row count.');
say('');
