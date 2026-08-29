#!/usr/bin/env node
// FINMENTOR — Pipeline BP/BQ/BR schema migration.
//
//   node scripts/migrate-pipeline-premium-columns.mjs --target snapshot   (prove the mechanism)
//   node scripts/migrate-pipeline-premium-columns.mjs --target production --confirm
//
// Adds exactly three header columns to the Pipeline tab:
//   BP current_setup   BQ decision_horizon   BR important_context
//
// WHY A DISPOSABLE WORKFLOW AND NOT A DIRECT API CALL. The production Sheets credential is
// domain-restricted — F17 proved it blocks raw sheets.googleapis.com from an HTTP Request node,
// and that control is sound and must not be weakened for a schema change. The Google Sheets NODE
// is the only path the credential admits.
//
// WHY THE SNAPSHOT RUNS FIRST. The mechanism is F16's: a Sheets node given a key the header does
// not contain APPENDS that column. F16 is the defect that widened this workbook twice by accident;
// using it deliberately is only defensible if it is first proven on a disposable copy, which is
// the P9-R2/R4 method. `--target snapshot` writes to the copy taken before this migration; only
// after that readback is clean does `--target production --confirm` touch the real sheet.
//
// The update matches a lead_id that cannot exist, so NO ROW IS WRITTEN — the node reconciles the
// header, finds three unknown keys, appends the columns, and matches nothing.
//
// Teardown runs in a finally block and verifies removal by re-reading the id.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const PRODUCTION_DOC = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A';
export const SNAPSHOT_DOC = '1B1ZTvpVyx-de6ck8wfw7asv8Jur9eGheJJEpx__eyNQ';
export const PIPELINE_GID = 1883973304;
export const SHEETS_CRED = 'PzVCuEPa9YF3YSaD';
export const NEW_COLUMNS = ['current_setup', 'decision_horizon', 'important_context'];
export const EXPECTED_LAST_BEFORE = 'BO';
export const PATH = 'p10/pipeline-premium-columns';

const args = process.argv.slice(2);
const targetArg = (args[args.indexOf('--target') + 1]) || '';
const CONFIRM = args.includes('--confirm');
const TARGET = targetArg === 'production' ? 'production' : targetArg === 'snapshot' ? 'snapshot' : null;

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

function die(m) { console.error('\nABORTED: ' + m); process.exit(1); }
function ok(m) { console.log('  PASS  ' + m); }
function say(m) { console.log(m); }
if (!TARGET) { die('--target snapshot | production'); }
if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set.'); }
if (TARGET === 'production' && !CONFIRM) { die('production requires --confirm'); }

const DOC = TARGET === 'production' ? PRODUCTION_DOC : SNAPSHOT_DOC;

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

// The row handed to the Sheets node. `lead_id` is a value that cannot exist, so the update matches
// nothing; the three new keys are what the node reconciles into the header.
const BUILD_ROW = [
  '// Schema-migration payload. It writes NO data: the lead_id below cannot match any row, so the',
  '// update reconciles the header and then matches nothing.',
  'const marker = "__SCHEMA_MIGRATION_NO_MATCH__" + Date.now();',
  'return [{ json: {',
  '  lead_id: marker,',
  NEW_COLUMNS.map((c) => '  ' + c + ': ""').join(',\n') + '',
  '} }];'
].join('\n');

function workflow() {
  return {
    name: '[TEMP] P10 Pipeline premium columns (' + TARGET + ')',
    settings: { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: true, saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' },
    nodes: [
      { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
        id: 'mig-hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: BUILD_ROW },
        id: 'mig-row', name: 'Build Migration Row', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
      { parameters: {
          operation: 'update',
          documentId: { __rl: true, value: DOC, mode: 'id' },
          sheetName: { __rl: true, value: PIPELINE_GID, mode: 'id' },
          columns: { mappingMode: 'autoMapInputData', matchingColumns: ['lead_id'], schema: [], value: {} },
          options: {} },
        id: 'mig-sheets', name: 'Reconcile Header', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [440, 0],
        credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED, name: 'Google Sheets OAuth2 API' } },
        onError: 'continueRegularOutput' },
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ ok: true }) }}', options: { responseCode: 200 } },
        id: 'mig-respond', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [660, 0] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Build Migration Row', type: 'main', index: 0 }]] },
      'Build Migration Row': { main: [[{ node: 'Reconcile Header', type: 'main', index: 0 }]] },
      'Reconcile Header': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] }
    }
  };
}

async function main() {
  say('');
  say('P10 — Pipeline premium columns: ' + TARGET.toUpperCase());
  say('='.repeat(70));
  say('  document      : ' + DOC);
  say('  columns       : ' + NEW_COLUMNS.join(', '));
  say('  mechanism     : Sheets header reconciliation, matching a lead_id that cannot exist');
  say('');

  if (!WRITE_KEY) { die('N8N_FIX_API_KEY is not set.'); }
  let id = null;
  try {
    const made = await api('POST', '/workflows', workflow(), true);
    id = made.id;
    await api('POST', '/workflows/' + id + '/activate', null, true);
    ok('disposable workflow deployed and activated: ' + id);

    let res = null, text = '';
    for (let i = 0; i < 8; i++) {
      res = await fetch(BASE + '/webhook/' + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      text = await res.text();
      if (res.status !== 404) { break; }
      await sleep(1000);
    }
    ok('migration request answered HTTP ' + res.status + ' ' + text.slice(0, 80));

    // Read the execution back rather than trusting the response.
    await sleep(1500);
    const list = await api('GET', '/executions?workflowId=' + id + '&limit=3');
    const rows = (list && list.data) || [];
    if (!rows.length) { say('  NOTE  no execution retained; verify by reading the sheet'); }
    else {
      const full = await api('GET', '/executions/' + rows[0].id + '?includeData=true');
      const rd = (full.data && full.data.resultData && full.data.resultData.runData) || {};
      const sheets = rd['Reconcile Header'];
      const item = sheets && sheets[0] && sheets[0].data && sheets[0].data.main && sheets[0].data.main[0] && sheets[0].data.main[0][0];
      const err = item && item.json && item.json.error;
      say('  execution: ' + full.status + (err ? '  node error: ' + String(err).slice(0, 200) : '  node ok'));
      if (err) { say('  the Sheets node reported an error — read the sheet before assuming failure'); }
    }
  } finally {
    if (id) {
      try { await api('POST', '/workflows/' + id + '/deactivate', null, true); } catch (e) { /* may be off */ }
      let gone = false;
      for (let i = 0; i < 8; i++) {
        try { await api('DELETE', '/workflows/' + id, null, true); gone = true; break; }
        catch (e) { await sleep(1500); }
      }
      if (gone) {
        try { await api('GET', '/workflows/' + id); say('  *** TEARDOWN INCOMPLETE: ' + id + ' still readable'); }
        catch (e) { ok('disposable workflow deleted and absence verified: ' + id); }
      } else { say('  *** TEARDOWN FAILED — REMOVE BY HAND: ' + id); }
    }
  }
  say('');
  say('Now verify by a FRESH authoritative export. This script does not verify its own work.');
}

main().catch((e) => { console.error('\nERROR: ' + e.message); process.exit(1); });
