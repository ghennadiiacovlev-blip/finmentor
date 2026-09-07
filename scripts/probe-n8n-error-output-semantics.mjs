#!/usr/bin/env node
// FINMENTOR — P9-R4 probe: what does n8n actually put on output 0 when a node fails?
//
//   node scripts/probe-n8n-error-output-semantics.mjs --run
//
// WHY THIS EXISTS. The P9-R3 diagnosis established two facts that rule out most fixes: the
// synthetic output-0 item on a failure is BYTE-IDENTICAL to the item a legitimately empty read
// produces (`{"json":{},"pairedItem":[...]}`), and the success branch runs to completion BEFORE
// the error branch starts. So no shape check and no cross-branch lookup can work.
//
// That leaves one candidate shape of fix: move the failure onto the REGULAR output
// (`onError: 'continueRegularOutput'`) so there is only ONE branch — no race, no second
// responder, no parallel write path — and have the consumer fail closed on it.
//
// That fix is only sound if n8n puts the ERROR ITEM on output 0, rather than the same anonymous
// `{}` that `alwaysOutputData` manufactures. If it is `{}`, the fix is fail-OPEN and must be
// abandoned. This is not documented clearly enough to build a production remediation on, and
// P9-R1 is the standing reminder that reading configuration is how this class of defect gets
// missed. So it is measured, on a four-node disposable workflow that touches nothing.
//
// It deploys, drives four cases, reads runData, and deletes everything it created.

import crypto from 'node:crypto';

const RUN = process.argv.includes('--run');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

function die(m) { console.error('\nABORTED: ' + m); process.exit(1); }
function say(m) { console.log(m); }
if (!BASE) { die('N8N_BASE_URL is not set.'); }
if (!READ_KEY) { die('N8N_API_KEY is not set.'); }

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PATH = 'p9r4/error-output-probe';

// The node under study. Same flag pair question as the real read: it can throw, or succeed with
// zero rows, and it carries alwaysOutputData exactly as `Read Pipeline (Dedup)` does.
const SOURCE_CODE = [
  "const src = $('Probe Webhook').first().json.body || {};",
  "const mode = String(src.probe_mode || '');",
  "if (mode === 'throw') { throw new Error('PROBE: simulated node failure'); }",
  "if (mode === 'empty') { return []; }",
  "if (mode === 'rows')  { return [{ json: { lead_id: 'L1' } }, { json: { lead_id: 'L2' } }]; }",
  "throw new Error('PROBE: probe_mode must be throw|empty|rows');"
].join('\n');

// The consumer records EXACTLY what arrived, with no interpretation at all.
const SINK_CODE = [
  'const items = $input.all();',
  'return [{ json: {',
  '  count: items.length,',
  '  items: items.map((i) => ({ json: i.json, keys: Object.keys(i.json || {}) })),',
  "  prevNode: (typeof $prevNode !== 'undefined') ? { name: $prevNode.name, outputIndex: $prevNode.outputIndex } : null",
  '} }];'
].join('\n');

function workflow(onError) {
  return {
    name: '[TEMP] P9-R4 error-output semantics probe (' + onError + ')',
    settings: {
      executionOrder: 'v1',
      availableInMCP: false,
      saveExecutionProgress: true,
      saveManualExecutions: true,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all'
    },
    nodes: [
      {
        parameters: { httpMethod: 'POST', path: PATH, options: {}, responseMode: 'responseNode' },
        id: 'probe-webhook', name: 'Probe Webhook', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: [0, 0]
      },
      {
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: SOURCE_CODE },
        id: 'probe-source', name: 'Probe Source', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [220, 0],
        alwaysOutputData: true,
        onError: onError
      },
      {
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: SINK_CODE },
        id: 'probe-sink', name: 'Probe Sink', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [440, -80]
      },
      {
        parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: SINK_CODE },
        id: 'probe-errsink', name: 'Probe Error Sink', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [440, 120]
      },
      {
        parameters: {
          options: { responseCode: 200 }, respondWith: 'json',
          responseBody: '={{ JSON.stringify({ ok: true }) }}'
        },
        id: 'probe-respond', name: 'Probe Respond', type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1, position: [660, -80]
      }
    ],
    connections: {
      'Probe Webhook': { main: [[{ node: 'Probe Source', type: 'main', index: 0 }]] },
      'Probe Source': onError === 'continueErrorOutput'
        ? {
          main: [
            [{ node: 'Probe Sink', type: 'main', index: 0 }],
            [{ node: 'Probe Error Sink', type: 'main', index: 0 }]
          ]
        }
        : { main: [[{ node: 'Probe Sink', type: 'main', index: 0 }]] },
      'Probe Sink': { main: [[{ node: 'Probe Respond', type: 'main', index: 0 }]] }
    }
  };
}

function runDataOf(exec) {
  const d = exec && exec.data && exec.data.resultData;
  return (d && d.runData) || {};
}
function firstJson(rd, name) {
  const runs = rd[name];
  if (!runs || !runs.length) { return null; }
  const main = (runs[0].data && runs[0].data.main) || [];
  return (main[0] && main[0][0] && main[0][0].json) || null;
}
function outputs(rd, name) {
  const runs = rd[name];
  if (!runs || !runs.length) { return null; }
  const main = (runs[0].data && runs[0].data.main) || [];
  return main.map((b) => (b ? b.length : 0));
}

async function drive(mode) {
  const nonce = 'p9r4-' + crypto.randomBytes(8).toString('hex');
  let res = null, text = '';
  for (let i = 0; i < 6; i++) {
    res = await fetch(BASE + '/webhook/' + PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ probe_mode: mode, probe_nonce: nonce })
    });
    text = await res.text();
    if (res.status !== 404) { break; }
    await sleep(1000);
  }
  return { status: res.status, raw: text.slice(0, 200), nonce };
}

async function execFor(wfId, nonce) {
  for (let i = 0; i < 20; i++) {
    const list = await api('GET', '/executions?workflowId=' + wfId + '&limit=10');
    for (const row of (list && list.data) || []) {
      const full = await api('GET', '/executions/' + row.id + '?includeData=true');
      const rd = runDataOf(full);
      const wh = firstJson(rd, 'Probe Webhook');
      if (wh && wh.body && wh.body.probe_nonce === nonce) { return full; }
    }
    await sleep(1000);
  }
  return null;
}

async function main() {
  say('');
  say('P9-R4 PROBE — n8n error-output semantics');
  say('='.repeat(78));
  say('');
  say('Question: with alwaysOutputData:true, what lands on output 0 when the node THROWS,');
  say('          under continueErrorOutput vs continueRegularOutput?');
  if (!RUN) { say('\nDry run. Pass --run to deploy the disposable probe.'); return; }
  if (!WRITE_KEY) { die('N8N_FIX_API_KEY is not set; refusing to deploy.'); }

  for (const onError of ['continueErrorOutput', 'continueRegularOutput']) {
    let id = null;
    say('');
    say('onError = ' + onError);
    say('-'.repeat(78));
    try {
      const made = await api('POST', '/workflows', workflow(onError), true);
      id = made.id;
      await api('POST', '/workflows/' + id + '/activate', null, true);
      for (const mode of ['rows', 'empty', 'throw']) {
        const r = await drive(mode);
        const exec = await execFor(id, r.nonce);
        if (!exec) { say('  ' + mode.padEnd(6) + ' -> no execution matched the nonce'); continue; }
        const rd = runDataOf(exec);
        const sink = firstJson(rd, 'Probe Sink');
        const esink = firstJson(rd, 'Probe Error Sink');
        say('  ' + mode.padEnd(6) + ' HTTP ' + r.status + '  exec=' + exec.status +
          '  Source outputs=' + JSON.stringify(outputs(rd, 'Probe Source')));
        say('         Sink       : ' + (sink ? 'count=' + sink.count + ' items=' + JSON.stringify(sink.items) : 'DID NOT RUN'));
        say('         Error Sink : ' + (esink ? 'count=' + esink.count + ' items=' + JSON.stringify(esink.items) : 'DID NOT RUN'));
      }
    } finally {
      if (id) {
        try { await api('POST', '/workflows/' + id + '/deactivate', null, true); } catch (e) { /* may be off */ }
        let gone = false;
        for (let i = 0; i < 8; i++) {
          try { await api('DELETE', '/workflows/' + id, null, true); gone = true; break; }
          catch (e) { await sleep(1500); }
        }
        say('  teardown: ' + (gone ? 'deleted ' + id : '*** LEAKED ' + id + ' — REMOVE BY HAND ***'));
      }
    }
  }
  say('');
  say('Read the "throw" rows. If Sink ran with an item carrying the error under');
  say('continueRegularOutput, the single-branch fix is sound. If it received a bare {},');
  say('it is fail-open and must be abandoned.');
}

main().catch((e) => { console.error('\nERROR: ' + e.message); process.exit(1); });
