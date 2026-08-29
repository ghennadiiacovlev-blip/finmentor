#!/usr/bin/env node
// FINMENTOR — one non-owner session row, alone, against the deployed endpoint.
//
//   node scripts/diagnose-session-read.mjs --confirm
//
// DISPOSABLE. Creates ONE row, calls the endpoint, dumps what the store read actually returns, and
// deletes the row.
//
// The owner-gate proof consistently saw the deployed endpoint answer SESSION_INVALID for a
// non-owner row and ok:true for an owner row, with both rows present exactly once and the deployed
// `Session Verdict` code verified correct. SESSION_INVALID is emitted only when the store read
// returns a row count other than one — so this looks at that read directly, with a single row in
// play, rather than inferring it from an endpoint's verdict.

import crypto from 'node:crypto';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
const DT_ID = 'LRme88caqxFzTLqW';
const SESSION_PATH = 'finmentor-miniapp-session';
const READ_PATH = 'p12/session-read-diag';
const CLEAN_PATH = 'p12/session-read-clean';
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 3); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY },
                               body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 200)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1000); }
  }
  throw last;
}
async function hit(path, method, body) {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(BASE + '/webhook/' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await res.text();
      if (res.status !== 404) { return t; }
    } catch (e) { /* */ }
    await sleep(1200);
  }
  return '(no answer)';
}

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };

const SESSION_ID = 'AS-' + crypto.randomBytes(32).toString('hex');
const now = new Date();
const row = {
  app_session_id: SESSION_ID, telegram_user_id: '700100200', chat_id: '700100200',
  cycle_id: 'C-DIAG', replay_key: 'diag', state: 'draft',
  created_at: now.toISOString(), expires_at: new Date(now.getTime() + 3600000).toISOString(),
  updated_at: now.toISOString(), draft_json: ''
};

console.log('');
console.log('ONE non-owner row, alone');
console.log('='.repeat(78));

let readId = null, cleanId = null;
try {
  await api('POST', '/data-tables/' + DT_ID + '/insert', { data: [row] });
  console.log('  inserted: ' + SESSION_ID.slice(0, 20) + '…  tg=' + row.telegram_user_id);

  // Wait until the REST API can see it.
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    const rb = await api('GET', '/data-tables/' + DT_ID + '/rows?limit=200').catch(() => null);
    const hit1 = ((rb && rb.data) || []).filter((r) => r.app_session_id === SESSION_ID);
    if (hit1.length) {
      console.log('  visible via REST: ' + hit1.length + ' row(s)');
      console.log('  stored verbatim : ' + JSON.stringify(hit1[0]).slice(0, 300));
      break;
    }
  }

  // What does the dataTable node see, with the endpoint's exact filter?
  const readWf = {
    name: '[TEMP] P12 session read diag', settings: SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: READ_PATH, responseMode: 'responseNode', options: {} },
        id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: 'return [{ json: { app_session_id: String(($("Hook").first().json.body || {}).id || "") } }];' },
        id: 'p', name: 'Prep', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0] },
      { parameters: { operation: 'get',
          dataTableId: { __rl: true, mode: 'name', value: 'MiniApp_App_Sessions' },
          filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.app_session_id }}' }] } },
        id: 'g', name: 'Read App Session', type: 'n8n-nodes-base.dataTable', typeVersion: 1,
        position: [400, 0], onError: 'continueRegularOutput', alwaysOutputData: true },
      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: [
            'const items = $input.all().map(i => i.json);',
            'return [{ json: {',
            '  returned: items.length,',
            '  withId: items.filter(r => r && String(r.app_session_id || "").trim() !== "").length,',
            '  keys: items[0] ? Object.keys(items[0]) : [],',
            '  sample: items[0] ? JSON.stringify(items[0]).slice(0, 200) : null',
            '} }];'
          ].join('\n') },
        id: 'r', name: 'Report', type: 'n8n-nodes-base.code', typeVersion: 2, position: [600, 0] },
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } },
        id: 'x', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [800, 0] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Prep', type: 'main', index: 0 }]] },
      Prep: { main: [[{ node: 'Read App Session', type: 'main', index: 0 }]] },
      'Read App Session': { main: [[{ node: 'Report', type: 'main', index: 0 }]] },
      Report: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] }
    }
  };
  readId = (await api('POST', '/workflows', readWf)).id;
  await api('POST', '/workflows/' + readId + '/activate');
  console.log('  dataTable node  : ' + (await hit(READ_PATH, 'POST', { id: SESSION_ID })).slice(0, 320));

  // And the real endpoint, with only this row in play.
  const ep = await hit(SESSION_PATH, 'PUT', {
    app_session_id: SESSION_ID, step: 'APP_OBJECTIVE',
    fields: { objective: { value: 'Денежный поток', source: 'user_explicit', confirmed: true } }
  });
  console.log('  live endpoint   : ' + ep.slice(0, 200));
  console.log('');
  console.log('  WANTED: NOT_AUTHORISED (the owner gate refusing a non-owner).');
  console.log('  SESSION_INVALID here means the store read, not the gate.');
} catch (e) {
  console.log('  ERROR: ' + String(e.message).slice(0, 250));
} finally {
  for (const id of [readId]) {
    if (id) {
      try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) { /* */ }
      for (let i = 0; i < 5; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } }
    }
  }
  // Delete the row through a dataTable node — there is no delete-rows REST route.
  try {
    const cw = {
      name: '[TEMP] P12 session read clean', settings: SETTINGS,
      nodes: [
        { parameters: { httpMethod: 'POST', path: CLEAN_PATH, responseMode: 'responseNode', options: {} },
          id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
        { parameters: { operation: 'deleteRows',
            dataTableId: { __rl: true, mode: 'id', value: DT_ID },
            filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.body.id }}' }] } },
          id: 'd', name: 'Delete Row', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [220, 0], onError: 'continueRegularOutput' },
        { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ done: true }) }}', options: { responseCode: 200 } },
          id: 'x', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [440, 0] }
      ],
      connections: { Hook: { main: [[{ node: 'Delete Row', type: 'main', index: 0 }]] },
        'Delete Row': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] } }
    };
    cleanId = (await api('POST', '/workflows', cw)).id;
    await api('POST', '/workflows/' + cleanId + '/activate');
    await hit(CLEAN_PATH, 'POST', { id: SESSION_ID });
    await sleep(1500);
    const rb = await api('GET', '/data-tables/' + DT_ID + '/rows?limit=200').catch(() => null);
    const left = ((rb && rb.data) || []).filter((r) => r.app_session_id === SESSION_ID);
    console.log('  cleanup         : ' + (left.length === 0 ? 'row deleted, absence verified' : 'STILL PRESENT — remove ' + SESSION_ID));
  } catch (e) {
    console.log('  cleanup FAILED — remove by hand: ' + SESSION_ID);
  } finally {
    if (cleanId) {
      try { await api('POST', '/workflows/' + cleanId + '/deactivate'); } catch (e) { /* */ }
      for (let i = 0; i < 5; i++) { try { await api('DELETE', '/workflows/' + cleanId, null, 2); break; } catch (e) { await sleep(1200); } }
    }
  }
}
console.log('');
