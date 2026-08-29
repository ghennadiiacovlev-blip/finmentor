#!/usr/bin/env node
// FINMENTOR — why does the owner gate never match?
//
//   node scripts/diagnose-owner-gate.mjs --confirm
//
// DISPOSABLE. The proof run showed the OWNER routing to the LEGACY branch — the gate fails closed,
// which is the safe direction, but it means the premium path is unreachable and UAT cannot run.
//
// Rather than guess at the IF node's condition shape, this prints what the two sides of the
// comparison actually evaluate to, from inside a workflow, using the same expressions the deployed
// gate uses.

import { fileURLToPath } from 'node:url';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
const PATH = 'p12/gate-diag';
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }

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
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1000); }
  }
  throw last;
}
async function hit(body) {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(BASE + '/webhook/' + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await res.text();
      if (res.status !== 404) { return t; }
    } catch (e) { /* */ }
    await sleep(1200);
  }
  return '';
}

const live = await api('GET', '/workflows/mppzthlkSJFr6Kle');
const gate = live.nodes.find((n) => n.name === 'Premium Owner Gate');
console.log('');
console.log('DEPLOYED gate condition, verbatim:');
console.log(JSON.stringify(gate.parameters.conditions, null, 2));
console.log('');

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };

// Evaluate both sides in a Code node, where the values are visible rather than compared.
const PROBE = [
  'const p = $("Parse Telegram Update").first().json;',
  'const s = $("Settings to Object").first().json;',
  'const left = String(p.chat_id || "");',
  'const right = String((s.settings || {}).owner_chat_id || "");',
  'return [{ json: {',
  '  left: left, leftType: typeof p.chat_id, leftLen: left.length,',
  '  right: right, rightLen: right.length,',
  '  equal: left === right,',
  '  settingsKeys: Object.keys(s || {}),',
  '  parseKeys: Object.keys(p || {})',
  '} }];'
].join('\n');

const wf = {
  name: '[TEMP] P12 gate diagnostic',
  settings: SETTINGS,
  nodes: [
    { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
      id: 'd-hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
        jsCode: 'return [{ json: { settings: { owner_chat_id: String(($json.body || {}).owner || "") } } }];' },
      id: 'd-set', name: 'Settings to Object', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
        jsCode: 'const b = $("Hook").first().json.body || {}; return [{ json: { chat_id: b.chat_id, message_text: "/start", callback_data: "" } }];' },
      id: 'd-parse', name: 'Parse Telegram Update', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 0] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: PROBE },
      id: 'd-probe', name: 'Probe', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600, 0] },
    { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } },
      id: 'd-resp', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [800, 0] }
  ],
  connections: {
    Hook: { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
    'Settings to Object': { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
    'Parse Telegram Update': { main: [[{ node: 'Probe', type: 'main', index: 0 }]] },
    Probe: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] }
  }
};

let id = null;
try {
  id = (await api('POST', '/workflows', wf)).id;
  await api('POST', '/workflows/' + id + '/activate');
  // Arbitrary but EQUAL: the question is whether the gate matches when both sides agree.
  const out = await hit({ chat_id: '999888777', owner: '999888777' });
  console.log('both sides, evaluated inside a workflow:');
  console.log('  ' + out.slice(0, 500));
} finally {
  if (id) {
    try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) { /* */ }
    for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } }
    console.log('  diagnostic workflow deleted');
  }
}
console.log('');
