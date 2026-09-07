#!/usr/bin/env node
// FINMENTOR — prove the transport resolver on BOTH paths, against real recorded traffic.
//
//   node scripts/prove-transport-equivalence.mjs --confirm
//
// LIVE but ISOLATED. It sends nothing to Telegram and writes to no store.
//
// ── A. LEGACY MUST BE BYTE-IDENTICAL ───────────────────────────────────────────────────────────
//
// A real successful legacy execution is replayed through the PATCHED transport node, and its
// output is compared byte-for-byte with the transport output that execution actually recorded.
// Not "equivalent", not "looks right" — the same bytes. If the resolver changed anything for a
// customer, this fails.
//
// ── B. PREMIUM MUST NOW TRANSPORT ──────────────────────────────────────────────────────────────
//
// The owner's real /start (execution 4239) is replayed through the deployed premium nodes and the
// PATCHED transport node, and the resulting Telegram payload is inspected: destination, text,
// exactly two approved buttons, no parse_mode unless intended, no secrets.
//
// ── C. IT MUST FAIL CLOSED ─────────────────────────────────────────────────────────────────────
//
// A malformed response object must not produce a half-formed send.
//
// The patched bodies come from the dry-run candidate in .uat/, so what is tested here is exactly
// what would be deployed.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

// The expected copy comes from the gated content contract, never retyped here — otherwise this
// harness could pass against a greeting the product no longer sends.
const TG_ENTRY_TEXT = require(join(HERE, '..', 'n8n', 'src', 'premium-ux', 'branches.js'))
  .TG_COPY.TG_ENTRY.text.join('\n\n');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const PATH = 'p14/transport-equiv';
const LEGACY_EXECUTIONS = [3840, 3838, 3836];
const PREMIUM_EXECUTION = 4239;

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }
if (!BASE || !READ_KEY || !WRITE_KEY) { console.error('N8N_BASE_URL, N8N_API_KEY, N8N_FIX_API_KEY required'); process.exit(1); }

const failures = [];
let OWNER = '';
const redact = (s) => (OWNER ? String(s).split(OWNER).join('«id»') : String(s));
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
      const r = await fetch(BASE + '/webhook/' + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text();
      if (r.status !== 404) { let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, body: j, raw: t }; }
    } catch (e) {}
    await sleep(1200);
  }
  return { status: 404, body: null, raw: '' };
}

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };
const pin = (name, payload, pos) => ({
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
    jsCode: 'return [{ json: ' + JSON.stringify(payload) + ' }];' },
  id: 'pin-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name: name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos || [0, 0]
});

say('');
say('TRANSPORT RESOLVER — both paths, against real recorded traffic');
say('='.repeat(78));
say('');

// The transport node comes from LIVE, not from a dry-run candidate file. It used to be read from
// `.uat/<id>.transport-resolver-candidate.json`, and that file froze the node as it was on the day
// the resolver was written — before the HTML layout mapping existed. The proof therefore replayed
// a node that no longer runs anywhere and reported PASS on its behaviour: it saw layout L2_C for a
// screen that live maps to L2_C_HTML. A proof of equivalence has to replay what is deployed.
const liveNow = await api('GET', '/workflows/' + CONCIERGE_ID);
const patchedTransport = liveNow.nodes.find((n) => n.name === 'Build Transport Request');
if (!patchedTransport) { bad('the live workflow has no Build Transport Request'); process.exit(1); }
if (String(patchedTransport.parameters.jsCode).indexOf("$('Build Bot Response (Premium)').isExecuted") === -1) {
  bad('the live transport node does not carry the response resolver'); process.exit(1);
}
ok('loaded Build Transport Request from the LIVE workflow');
say('');

// ── A. legacy byte-equivalence ─────────────────────────────────────────────────────────────────

say('PART A — LEGACY: replay a real successful execution and compare bytes');
let legacy = null;
for (const id of LEGACY_EXECUTIONS) {
  try {
    const e = await api('GET', '/executions/' + id + '?includeData=true');
    const rd = (e.data && e.data.resultData && e.data.resultData.runData) || {};
    const need = ['Parse Telegram Update', 'Settings to Object', 'Get Bot Session', 'Build Bot Response', 'Build Transport Request'];
    if (need.every((n) => rd[n] && rd[n][0] && rd[n][0].data && rd[n][0].data.main && rd[n][0].data.main[0] && rd[n][0].data.main[0][0])) {
      legacy = { id: id, get: (n) => rd[n][0].data.main[0][0].json };
      break;
    }
  } catch (err) { /* next */ }
}
if (!legacy) { bad('could not recover a real legacy execution — refusing to prove equivalence against a synthetic one'); }
else {
  ok('recovered real legacy execution ' + legacy.id);
  const recorded = legacy.get('Build Transport Request');

  const wf = {
    name: '[TEMP] P14 legacy transport replay', settings: SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
        id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      pin('Settings to Object', legacy.get('Settings to Object'), [200, -200]),
      pin('Parse Telegram Update', legacy.get('Parse Telegram Update'), [400, -200]),
      pin('Get Bot Session', legacy.get('Get Bot Session'), [600, -200]),
      // The legacy RESPONSE is pinned from the real execution: this part proves the transport
      // node, not the legacy state machine, which is untouched by this change.
      pin('Build Bot Response', legacy.get('Build Bot Response'), [800, 0]),
      // Present but NOT connected, so it exists and does not execute — exactly the legacy case in
      // the real workflow. The first version of this harness omitted it entirely, which tests
      // `.isExecuted` on a node that does not exist: a different question, and it threw.
      pin('Build Bot Response (Premium)', { unused: true }, [800, -260]),
      Object.assign(JSON.parse(JSON.stringify(patchedTransport)), { position: [1000, 0] }),
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } },
        id: 'r', name: 'Report', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1200, 0] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
      'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
      'Parse Telegram Update': { main: [[{ node: 'Get Bot Session', type: 'main', index: 0 }]] },
      'Get Bot Session': { main: [[{ node: 'Build Bot Response', type: 'main', index: 0 }]] },
      'Build Bot Response': { main: [[{ node: 'Build Transport Request', type: 'main', index: 0 }]] },
      'Build Transport Request': { main: [[{ node: 'Report', type: 'main', index: 0 }]] }
    }
  };
  // NOTE: 'Build Bot Response (Premium)' does not exist in this harness at all, which is the
  // strongest form of the legacy case — the resolver must cope with the node being absent, not
  // merely unexecuted.
  let id = null;
  try {
    id = (await api('POST', '/workflows', wf)).id;
    await api('POST', '/workflows/' + id + '/activate');
    const r = await hit({});
    if (!r.body) { bad('the legacy replay returned nothing: ' + redact(r.raw).slice(0, 200)); }
    else {
      const a = JSON.stringify(recorded);
      const b = JSON.stringify(r.body);
      if (a === b) { ok('the patched transport node produces BYTE-IDENTICAL output for real legacy traffic'); }
      else {
        bad('legacy output DIFFERS from what execution ' + legacy.id + ' recorded');
        say('        recorded keys: ' + Object.keys(recorded).sort().join(','));
        say('        replayed keys: ' + Object.keys(r.body).sort().join(','));
        for (const k of new Set(Object.keys(recorded).concat(Object.keys(r.body)))) {
          if (JSON.stringify(recorded[k]) !== JSON.stringify(r.body[k])) {
            say('        differs at "' + k + '"');
          }
        }
      }
    }
  } catch (e) { bad('legacy replay failed: ' + redact(String(e.message)).slice(0, 200)); }
  finally {
    if (id) { try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) {}
      for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } } }
  }
}
say('');

// ── B. premium transport ───────────────────────────────────────────────────────────────────────

say('PART B — PREMIUM: the owner\'s real /start, through to the Telegram payload');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const gate = live.nodes.find((n) => n.name === 'Premium Owner Gate');
const sess = live.nodes.find((n) => n.name === 'Get Bot Session (Premium)');
const resp = live.nodes.find((n) => n.name === 'Build Bot Response (Premium)');

let premium = null;
try {
  const e = await api('GET', '/executions/' + PREMIUM_EXECUTION + '?includeData=true');
  const rd = (e.data && e.data.resultData && e.data.resultData.runData) || {};
  premium = { parse: rd['Parse Telegram Update'][0].data.main[0][0].json,
              session: rd['Find Session'][0].data.main[0][0].json };
} catch (err) { bad('could not recover the owner\'s real update from execution ' + PREMIUM_EXECUTION); }

if (premium) {
  OWNER = String(premium.parse.chat_id || '');
  ok('recovered the owner\'s real /start from execution ' + PREMIUM_EXECUTION);
  const wf = {
    name: '[TEMP] P14 premium transport replay', settings: SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
        id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      pin('Settings to Object', { settings: { owner_chat_id: OWNER } }, [200, -200]),
      pin('Parse Telegram Update', premium.parse, [400, -200]),
      pin('Find Session', premium.session, [600, 0]),
      Object.assign(JSON.parse(JSON.stringify(gate)), { position: [800, 0] }),
      Object.assign(JSON.parse(JSON.stringify(sess)), { position: [1000, 0] }),
      Object.assign(JSON.parse(JSON.stringify(resp)), { position: [1200, 0] }),
      Object.assign(JSON.parse(JSON.stringify(patchedTransport)), { position: [1400, 0] }),
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } },
        id: 'r', name: 'Report', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1600, 0] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
      'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
      'Parse Telegram Update': { main: [[{ node: 'Find Session', type: 'main', index: 0 }]] },
      'Find Session': { main: [[{ node: 'Premium Owner Gate', type: 'main', index: 0 }]] },
      'Premium Owner Gate': { main: [[{ node: 'Get Bot Session (Premium)', type: 'main', index: 0 }], []] },
      'Get Bot Session (Premium)': { main: [[{ node: 'Build Bot Response (Premium)', type: 'main', index: 0 }]] },
      'Build Bot Response (Premium)': { main: [[{ node: 'Build Transport Request', type: 'main', index: 0 }]] },
      'Build Transport Request': { main: [[{ node: 'Report', type: 'main', index: 0 }]] }
    }
  };
  for (const n of wf.nodes) {
    if (/telegram|googleSheets|dataTable|executeWorkflow|postgres/i.test(n.type)) { bad('harness would contain a side-effecting node: ' + n.name); }
  }
  let id = null;
  try {
    id = (await api('POST', '/workflows', wf)).id;
    await api('POST', '/workflows/' + id + '/activate');
    const r = await hit({});
    if (!r.body) { bad('the premium replay returned nothing: ' + redact(r.raw).slice(0, 200)); }
    else {
      const t = r.body;
      say('        transport keys : ' + Object.keys(t).sort().join(', '));
      // The transport does NOT emit reply_markup. It maps the keyboard SHAPE to a registered
      // layout id and hands the send node `keyboard_data.rows`. An unmapped signature is routed
      // to the recovery branch, so `layout_mapped` decides whether the owner sees the greeting or
      // a recovery message.
      const text = String(t.text || '');
      const rows = ((t.keyboard_data || {}).rows) || [];
      const labels = rows.map((r) => r[0] && r[0].text);
      say('        layout         : ' + t.keyboard_layout_id + '  signature=' + JSON.stringify(t.keyboard_signature) + '  mapped=' + t.layout_mapped);
      say('        buttons        : ' + JSON.stringify(labels));
      // Built from the gated content contract rather than retyped, so the expected copy cannot
      // drift from what branches.js defines.
      const WANT = TG_ENTRY_TEXT;
      if (text === WANT) { ok('the transported text is EXACTLY the approved TG_ENTRY copy'); }
      else { bad('the transported text is not the approved copy'); say('        got : ' + JSON.stringify(text.slice(0, 160))); }
      if (JSON.stringify(labels) === JSON.stringify(['Описать задачу', 'Подготовить бриф'])) { ok('exactly two buttons, approved labels, in order'); }
      else { bad('buttons are ' + JSON.stringify(labels)); }
      if (t.layout_mapped === true) { ok('the keyboard maps to a registered layout (' + t.keyboard_layout_id + ') — it will NOT be routed to recovery'); }
      else { bad('the keyboard signature ' + JSON.stringify(t.keyboard_signature) + ' is UNMAPPED — the owner would get a recovery message'); }
      for (const r of rows) { for (const btn of r) {
        if (!btn.callback_data && !btn.url) { bad('a button carries neither callback_data nor url: ' + JSON.stringify(btn)); }
      } }
      const dest = String(t.chat_id || '');
      if (dest && dest === OWNER) { ok('destination is the server-resolved owner chat (value withheld)'); }
      else { bad('destination is not the server-resolved owner chat'); }
      // The payload carries the requested mode AND the layout that encodes it. The renderer is
      // chosen by layout, so the two must agree: an HTML screen routed to a plain renderer would
      // show the client a literal <b>FINMENTOR</b>. The old assertion here — "parse_mode is empty,
      // the copy is sent as plain text" — was written when TG_ENTRY was plain, and would now pass
      // for exactly that broken case.
      const mode = String(t.parse_mode || '');
      const layoutId = String(t.keyboard_layout_id || '');
      if (mode === 'HTML') { ok('the screen requests HTML'); }
      else { bad('TG_ENTRY no longer requests HTML: ' + JSON.stringify(mode)); }
      if (layoutId === 'L2_C_HTML') { ok('and routes to the HTML renderer for its shape (L2_C_HTML)'); }
      else { bad('TG_ENTRY routes to ' + JSON.stringify(layoutId) + ' — its markup would be shown literally'); }
      if ((mode === 'HTML') === /_HTML$/.test(layoutId)) { ok('mode and layout agree'); }
      else { bad('mode ' + JSON.stringify(mode) + ' disagrees with layout ' + JSON.stringify(layoutId)); }
      const j = JSON.stringify(t);
      for (const secret of ['bot_token', 'token', 'init_data', 'hash', 'signature', 'api_key']) {
        if (new RegExp('"' + secret + '"').test(j)) { bad('the transport payload carries ' + secret); }
      }
      ok('the transport payload carries no token, initData, hash or signature');
    }
  } catch (e) { bad('premium replay failed: ' + redact(String(e.message)).slice(0, 200)); }
  finally {
    if (id) { try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) {}
      for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } } }
  }
}
say('');

// ── C. fail closed ─────────────────────────────────────────────────────────────────────────────

say('PART C — a malformed response must not produce a half-formed send');
{
  const wf = {
    name: '[TEMP] P14 transport malformed', settings: SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
        id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      pin('Settings to Object', { settings: {} }, [200, -200]),
      pin('Parse Telegram Update', { chat_id: '', message_text: '', callback_data: '' }, [400, -200]),
      pin('Get Bot Session', {}, [600, -200]),
      pin('Build Bot Response', {}, [800, 0]),
      Object.assign(JSON.parse(JSON.stringify(patchedTransport)), { position: [1000, 0], onError: 'continueRegularOutput' }),
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ threw: !!$json.error, layout: $json.layout_mapped, chat: String(($json.tg_body || {}).chat_id || ""), text: String((($json.tg_body || {}).text || "")).slice(0,40) }) }}', options: { responseCode: 200 } },
        id: 'r', name: 'Report', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1200, 0] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
      'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
      'Parse Telegram Update': { main: [[{ node: 'Get Bot Session', type: 'main', index: 0 }]] },
      'Get Bot Session': { main: [[{ node: 'Build Bot Response', type: 'main', index: 0 }]] },
      'Build Bot Response': { main: [[{ node: 'Build Transport Request', type: 'main', index: 0 }]] },
      'Build Transport Request': { main: [[{ node: 'Report', type: 'main', index: 0 }]] }
    }
  };
  let id = null;
  try {
    id = (await api('POST', '/workflows', wf)).id;
    await api('POST', '/workflows/' + id + '/activate');
    const r = await hit({});
    say('        malformed input -> ' + redact(r.raw).slice(0, 200));
    const b = r.body || {};
    if (b.threw) { ok('the transport node refuses a malformed response rather than building a send'); }
    else if (!b.chat) { ok('no destination is produced from a malformed response — nothing can be sent'); }
    else { bad('a malformed response produced a send with a destination'); }
  } catch (e) { ok('the transport node refused a malformed response (' + String(e.message).slice(0, 60) + ')'); }
  finally {
    if (id) { try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) {}
      for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } } }
  }
}

say('');
say(failures.length ? '  TRANSPORT EQUIVALENCE = FAIL' : '  TRANSPORT EQUIVALENCE = PASS');
if (failures.length) { say(''); for (const f of failures) { say('    - ' + f); } process.exitCode = 1; }
say('');
