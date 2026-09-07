#!/usr/bin/env node
// FINMENTOR — prove the HTML entry screen before it is deployed.
//
//   node scripts/prove-html-entry.mjs --confirm
//
// LIVE but ISOLATED, and it sends nothing to Telegram. The harness stops at the transport
// VALIDATOR — the last node before a `Render *` Telegram node — and reports exactly what the
// renderer would receive.
//
// It replays the OWNER'S REAL /start (execution 4239) through the CANDIDATE premium response node
// and the CANDIDATE transport node, so what is proved is what would be deployed.
//
// Three things have to hold at once, and the third is the one worth stating: the copy must be
// exactly the approved text, it must be marked for HTML rendering, and THE BUTTONS MUST NOT HAVE
// MOVED. A presentation change that quietly altered a callback payload would break the flow one
// tap later, where it would look like a different bug entirely.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const TRANSPORT_ID = 'ShcmmJeLSE8LYVBk';
const PREMIUM_EXECUTION = 4239;
const PATH = 'p16/html-entry';

const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const WANT_TEXT = B.TG_COPY.TG_ENTRY.text.join('\n\n');
const WANT_ACTIONS = B.TG_COPY.TG_ENTRY.actions;

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
      const r = await fetch(BASE + '/webhook/' + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
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
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return [{ json: ' + JSON.stringify(payload) + ' }];' },
  id: 'pin-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name: name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos || [0, 0]
});

say('');
say('PREMIUM TG_ENTRY — HTML, replayed from the owner\'s real /start');
say('='.repeat(78));
say('');

const conc = JSON.parse(readFileSync(join(OUT_DIR, CONCIERGE_ID + '.html-candidate.json'), 'utf8'));
const tr = JSON.parse(readFileSync(join(OUT_DIR, TRANSPORT_ID + '.html-candidate.json'), 'utf8'));
const gate = conc.nodes.find((n) => n.name === 'Premium Owner Gate');
const sess = conc.nodes.find((n) => n.name === 'Get Bot Session (Premium)');
const resp = conc.nodes.find((n) => n.name === 'Build Bot Response (Premium)');
const bt = conc.nodes.find((n) => n.name === 'Build Transport Request');
const val = tr.nodes.find((n) => n.name === 'Validate Transport Payload');
if (!gate || !sess || !resp || !bt || !val) { bad('a candidate node is missing'); process.exit(1); }
ok('loaded the candidate nodes');

let premium = null;
try {
  const e = await api('GET', '/executions/' + PREMIUM_EXECUTION + '?includeData=true');
  const rd = (e.data && e.data.resultData && e.data.resultData.runData) || {};
  premium = { parse: rd['Parse Telegram Update'][0].data.main[0][0].json,
              session: rd['Find Session'][0].data.main[0][0].json };
  OWNER = String(premium.parse.chat_id || '');
  ok('recovered the owner\'s real /start from execution ' + PREMIUM_EXECUTION);
} catch (err) { bad('could not recover the real update — refusing to substitute a synthetic one'); process.exit(1); }
say('');

const wf = {
  name: '[TEMP] P16 html entry', settings: SETTINGS,
  nodes: [
    { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
      id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    pin('Settings to Object', { settings: { owner_chat_id: OWNER } }, [200, -200]),
    pin('Parse Telegram Update', premium.parse, [400, -200]),
    pin('Find Session', premium.session, [600, 0]),
    Object.assign(JSON.parse(JSON.stringify(gate)), { position: [800, 0] }),
    Object.assign(JSON.parse(JSON.stringify(sess)), { position: [1000, 0] }),
    Object.assign(JSON.parse(JSON.stringify(resp)), { position: [1200, 0] }),
    Object.assign(JSON.parse(JSON.stringify(bt)), { position: [1400, 0] }),
    Object.assign(JSON.parse(JSON.stringify(val)), { position: [1600, 0], onError: 'continueRegularOutput' }),
    { parameters: { respondWith: 'json',
        responseBody: '={{ JSON.stringify({ valid: $json.valid, error_code: $json.error_code, layout: $json.layout, text: $json.text, kb: $json.kb }) }}',
        options: { responseCode: 200 } },
      id: 'x', name: 'Report', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1800, 0] }
  ],
  connections: {
    Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
    'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
    'Parse Telegram Update': { main: [[{ node: 'Find Session', type: 'main', index: 0 }]] },
    'Find Session': { main: [[{ node: 'Premium Owner Gate', type: 'main', index: 0 }]] },
    'Premium Owner Gate': { main: [[{ node: 'Get Bot Session (Premium)', type: 'main', index: 0 }], []] },
    'Get Bot Session (Premium)': { main: [[{ node: 'Build Bot Response (Premium)', type: 'main', index: 0 }]] },
    'Build Bot Response (Premium)': { main: [[{ node: 'Build Transport Request', type: 'main', index: 0 }]] },
    'Build Transport Request': { main: [[{ node: 'Validate Transport Payload', type: 'main', index: 0 }]] },
    'Validate Transport Payload': { main: [[{ node: 'Report', type: 'main', index: 0 }]] }
  }
};
for (const n of wf.nodes) {
  if (/telegram|googleSheets|dataTable|executeWorkflow|postgres/i.test(n.type)) { bad('the harness would contain a side-effecting node: ' + n.name); }
}
if (failures.length) { process.exit(1); }
ok('harness contains no Telegram, Sheets, data-table, sub-workflow or database node');
say('');

let id = null;
try {
  id = (await api('POST', '/workflows', wf)).id;
  await api('POST', '/workflows/' + id + '/activate');
  const r = await hit({});
  if (!r.body || r.body.valid !== true) {
    bad('the replay did not produce a valid payload: ' + redact(r.raw).slice(0, 250));
  } else {
    const b = r.body;
    say('  layout : ' + b.layout);
    say('  buttons: ' + JSON.stringify((b.kb || []).map((row) => row[0])));
    say('');
    say('  ---- text as Telegram would receive it ----');
    for (const line of String(b.text || '').split('\n')) { say('  | ' + line); }
    say('  -------------------------------------------');
    say('');

    if (b.text === WANT_TEXT) { ok('the text is EXACTLY the approved copy, byte for byte'); }
    else {
      bad('the text differs from the approved copy');
      say('        got  len ' + String(b.text || '').length + ', want len ' + WANT_TEXT.length);
    }
    if (b.layout === 'L2_C_HTML') { ok('layout is L2_C_HTML — it will render through the HTML renderer'); }
    else { bad('layout is ' + b.layout + ', expected L2_C_HTML (the tags would show as literal text)'); }

    // The HTML contract.
    const tags = [...String(b.text || '').matchAll(/<\/?([a-z-]+)[^>]*>/g)].map((m) => m[1]);
    const ALLOWED = ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'tg-spoiler'];
    const bad_tags = [...new Set(tags)].filter((t) => ALLOWED.indexOf(t) === -1);
    if (!bad_tags.length) { ok('only Telegram-supported tags are used: ' + [...new Set(tags)].join(', ')); }
    else { bad('unsupported tags: ' + bad_tags.join(', ')); }
    const opens = (String(b.text).match(/<(b|i)>/g) || []).length;
    const closes = (String(b.text).match(/<\/(b|i)>/g) || []).length;
    if (opens === closes && opens > 0) { ok('tags balanced (' + opens + ' pairs) — Telegram will not reject the message'); }
    else { bad('tags unbalanced: ' + opens + ' open, ' + closes + ' close'); }
    if (!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(b.text))) { ok('no emoji'); }
    else { bad('the copy contains an emoji'); }
    if (!/(\*\*|__|\[[^\]]+\]\([^)]+\))/.test(String(b.text))) { ok('no Markdown'); }
    else { bad('the copy contains Markdown'); }
    if (String(b.text).length <= 4096) { ok('length ' + String(b.text).length + ' is within the Telegram cap'); }
    else { bad('the message exceeds 4096 characters'); }

    // THE BUTTONS MUST NOT HAVE MOVED.
    const labels = (b.kb || []).map((row) => row[0] && row[0].text);
    const datas = (b.kb || []).map((row) => row[0] && row[0].callback_data);
    if (JSON.stringify(labels) === JSON.stringify(WANT_ACTIONS)) { ok('button labels unchanged: ' + JSON.stringify(labels)); }
    else { bad('button labels are ' + JSON.stringify(labels) + ', expected ' + JSON.stringify(WANT_ACTIONS)); }
    if (JSON.stringify(datas) === JSON.stringify(['p|describe', 'p|brief'])) { ok('callback payloads unchanged: p|describe, p|brief'); }
    else { bad('callback payloads are ' + JSON.stringify(datas) + ', expected ["p|describe","p|brief"]'); }
    for (const row of (b.kb || [])) {
      for (const btn of row) {
        if (btn.url !== undefined || btn.web_app !== undefined) { bad('an entry button acquired a url or web_app: ' + JSON.stringify(btn)); }
      }
    }
    ok('neither entry button became a URL or Web App button');
  }
} catch (e) {
  bad('harness failed: ' + redact(String(e.message)).slice(0, 200));
} finally {
  if (id) {
    try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) {}
    for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } }
    ok('harness deleted');
  }
}

say('');
say(failures.length ? '  HTML ENTRY PROOF = FAIL' : '  HTML ENTRY PROOF = PASS');
if (failures.length) { say(''); for (const f of failures) { say('    - ' + f); } process.exitCode = 1; }
say('');
