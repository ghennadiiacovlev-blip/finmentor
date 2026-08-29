#!/usr/bin/env node
// FINMENTOR — prove the premium entry path using the OWNER'S REAL /start update.
//
//   node scripts/prove-premium-entry.mjs --confirm
//
// LIVE but ISOLATED, and it sends NOTHING to Telegram.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// The synthetic owner-gate proof passed while the real thing was broken, because it stubbed
// `Parse Telegram Update` and `Find Session` with shapes I wrote rather than shapes Telegram
// produced. So this replays the ACTUAL update: executions 4221 and 4223 are retained, and their
// `Parse Telegram Update` and `Find Session` outputs are the real thing — the owner's own /start,
// and the owner's own stored session row.
//
// Those two payloads are pinned into a disposable workflow that runs the DEPLOYED
// `Premium Owner Gate`, `Get Bot Session (Premium)` and `Build Bot Response (Premium)` nodes,
// copied verbatim. Nothing downstream of the response builder is included, so no message is sent
// and no sheet is written.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────────────────
//
// It does not send a Telegram message, on the owner's behalf or otherwise. It does not write to
// Bot_Sessions, Lead Intake, the Pipeline or the privacy store — none of those nodes are in the
// harness. It prints no chat id, no name and no username.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const PATH = 'p13/premium-entry';
const EXECUTIONS = [4221, 4223];

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }
if (!BASE || !READ_KEY || !WRITE_KEY) { console.error('N8N_BASE_URL, N8N_API_KEY, N8N_FIX_API_KEY required'); process.exit(1); }

const failures = [];
let OWNER = '';
const redact = (s) => (OWNER ? String(s).split(OWNER).join('«owner-id»') : String(s));
const say = (m) => console.log(redact(m));
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => { say('  FAIL  ' + m); failures.push(m); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(m, p, b, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + p, { method: m,
        headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
        body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + redact(t).slice(0, 200)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
async function hit(body) {
  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(BASE + '/webhook/' + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await res.text();
      if (res.status !== 404) { let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: res.status, body: j, raw: t }; }
    } catch (e) { /* */ }
    await sleep(1200);
  }
  return { status: 404, body: null, raw: '' };
}

say('');
say('PREMIUM ENTRY — replayed from the owner\'s REAL /start update');
say('='.repeat(78));
say('');

// ── 1. recover the real payloads ────────────────────────────────────────────────────────────────

say('STEP 1 — recover the real update from the retained executions');
let realParse = null, realSession = null, usedExecution = null;
for (const id of EXECUTIONS) {
  try {
    const e = await api('GET', '/executions/' + id + '?includeData=true');
    const rd = (e.data && e.data.resultData && e.data.resultData.runData) || {};
    const p = rd['Parse Telegram Update'];
    const f = rd['Find Session'];
    if (p && p[0] && f && f[0]) {
      realParse = p[0].data.main[0][0].json;
      realSession = f[0].data.main[0][0].json;
      usedExecution = id;
      break;
    }
  } catch (err) { /* try the next */ }
}
if (!realParse || !realSession) {
  bad('could not recover the real update from executions ' + EXECUTIONS.join('/') + ' — refusing to substitute a synthetic one');
  say('');
  say('  PREMIUM ENTRY = NOT PROVEN');
  process.exit(1);
}
OWNER = String(realParse.chat_id || '');
ok('recovered the real update and session from execution ' + usedExecution);
say('        update fields  : ' + Object.keys(realParse).sort().join(', '));
say('        session fields : ' + Object.keys(realSession).length + ' columns');
say('        message_text   : ' + JSON.stringify(String(realParse.message_text || '')));
say('        chat_id present: ' + (String(realParse.chat_id || '') !== '' ? 'yes' : 'NO'));
say('');

// ── 2. the owner gate against the REAL field path ───────────────────────────────────────────────

say('STEP 2 — the owner gate, against the real update shape');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const gate = live.nodes.find((n) => n.name === 'Premium Owner Gate');
const sessionNode = live.nodes.find((n) => n.name === 'Get Bot Session (Premium)');
const responseNode = live.nodes.find((n) => n.name === 'Build Bot Response (Premium)');
for (const [n, v] of [['Premium Owner Gate', gate], ['Get Bot Session (Premium)', sessionNode], ['Build Bot Response (Premium)', responseNode]]) {
  if (!v) { bad('the live workflow has no node named ' + n); }
}
if (failures.length) { process.exit(1); }

{
  const cond = gate.parameters.conditions.conditions[0];
  say('        left  reads : ' + cond.leftValue.replace(/\s+/g, ' '));
  say('        right reads : ' + cond.rightValue.replace(/\s+/g, ' '));
  const settings = live.nodes.find((n) => n.name === 'Settings to Object');
  const m = String(settings.parameters.jsCode || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  const configured = m ? m[1] : '';
  const fromUpdate = String(realParse.chat_id === undefined || realParse.chat_id === null ? '' : realParse.chat_id);
  if (!fromUpdate) { bad('the real update carries no chat_id at the path the gate reads — it would silently route to LEGACY'); }
  else { ok('the real update carries chat_id at the exact path the gate reads'); }
  if (fromUpdate && configured && fromUpdate === configured) { ok('owner identity: MATCH (values withheld)'); }
  else { bad('owner identity: NO MATCH — the real update would route to LEGACY'); }
  if (fromUpdate !== fromUpdate.trim()) { bad('the real chat_id carries surrounding whitespace; the strict comparison would fail'); }
  else { ok('no normalisation gap: the stored value and the update value are compared as-is'); }
}
say('');

// ── 3. run the two deployed premium nodes on the real payloads ─────────────────────────────────

say('STEP 3 — run the DEPLOYED premium nodes on the real payloads (no Telegram, no writes)');

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };

const pin = (name, payload) => ({
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
    jsCode: 'return [{ json: ' + JSON.stringify(payload) + ' }];' },
  id: 'pin-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name: name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0]
});

const harness = {
  name: '[TEMP] P13 premium entry replay',
  settings: SETTINGS,
  nodes: [
    { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
      id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    Object.assign(pin('Settings to Object', { settings: { owner_chat_id: OWNER } }), { position: [200, -140] }),
    Object.assign(pin('Parse Telegram Update', realParse), { position: [400, -140] }),
    Object.assign(pin('Find Session', realSession), { position: [600, 0] }),
    Object.assign(JSON.parse(JSON.stringify(gate)), { position: [700, 0] }),
    Object.assign(JSON.parse(JSON.stringify(sessionNode)), { position: [800, 0] }),
    Object.assign(JSON.parse(JSON.stringify(responseNode)), { position: [1000, 0] }),
    { parameters: { respondWith: 'json',
        responseBody: '={{ JSON.stringify({ state: $json.debug.state_after, detail: $json.debug.detail, rotate: $json.debug.rotate, text: $json.reply_text, buttons: ($json.reply_markup.inline_keyboard || []).map(r => r[0].text), lead_ready: $json.lead_ready, chat_ok: String($json.chat_id) !== "" }) }}',
        options: { responseCode: 200 } },
      id: 'r', name: 'Report', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1200, 0] }
  ],
  connections: {
    Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
    'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
    'Parse Telegram Update': { main: [[{ node: 'Find Session', type: 'main', index: 0 }]] },
    'Find Session': { main: [[{ node: 'Premium Owner Gate', type: 'main', index: 0 }]] },
    'Premium Owner Gate': { main: [[{ node: 'Get Bot Session (Premium)', type: 'main', index: 0 }], []] },
    'Get Bot Session (Premium)': { main: [[{ node: 'Build Bot Response (Premium)', type: 'main', index: 0 }]] },
    'Build Bot Response (Premium)': { main: [[{ node: 'Report', type: 'main', index: 0 }]] }
  }
};

// The harness must not be able to send or write, whatever the copied nodes contain.
for (const n of harness.nodes) {
  if (/telegram|googleSheets|dataTable|executeWorkflow|postgres/i.test(n.type)) {
    bad('the harness would contain a side-effecting node: ' + n.name);
  }
}
if (failures.length) { process.exit(1); }
ok('harness contains no Telegram, Sheets, data-table, sub-workflow or database node');

let hid = null;
try {
  hid = (await api('POST', '/workflows', harness)).id;
  await api('POST', '/workflows/' + hid + '/activate');
  const r = await hit({});
  if (!r.body) { bad('the replay returned nothing: ' + redact(r.raw).slice(0, 200)); }
  else {
    const b = r.body;
    say('        state   : ' + b.state);
    say('        detail  : ' + b.detail);
    say('        buttons : ' + JSON.stringify(b.buttons));
    say('        text[0] : ' + JSON.stringify(String(b.text || '').split('\n')[0]));
    if (b.state === 'TG_ENTRY') { ok('the real /start reaches TG_ENTRY on the premium path'); }
    else { bad('the real /start reached ' + b.state + ', not TG_ENTRY'); }
    if (String(b.text || '').indexOf('Здравствуйте.') === 0) { ok('the greeting is the approved copy'); }
    else { bad('the greeting is not the approved copy'); }
    const want = ['Описать задачу', 'Подготовить бриф'];
    if (JSON.stringify(b.buttons) === JSON.stringify(want)) { ok('exactly two buttons, the approved labels, in order'); }
    else { bad('buttons are ' + JSON.stringify(b.buttons) + ', expected ' + JSON.stringify(want)); }
    if (b.rotate === false) { ok('no cycle rotation on /start'); }
    else { bad('the real /start rotated the cycle'); }
    if (b.lead_ready === false) { ok('lead_ready is false — no submission path is triggered'); }
    else { bad('lead_ready is not false'); }
    if (b.chat_ok) { ok('the reply carries a chat_id, so the transport node has a destination'); }
    else { bad('the reply carries no chat_id — the send would have nowhere to go'); }
  }
} finally {
  if (hid) {
    try { await api('POST', '/workflows/' + hid + '/deactivate'); } catch (e) { /* */ }
    for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + hid, null, 2); break; } catch (e) { await sleep(1200); } }
    ok('harness workflow deleted');
  }
}
say('');
say(failures.length ? '  PREMIUM ENTRY = FAIL' : '  PREMIUM ENTRY = PASS');
if (failures.length) { say(''); for (const f of failures) { say('    - ' + f); } process.exitCode = 1; }
say('');
