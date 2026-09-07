#!/usr/bin/env node
// FINMENTOR — P7.3 step 2 §9: build the DISPOSABLE cleanup child.
//
//   node scripts/build-p73s2-cleanup-child.mjs
//
// REPO-ONLY. Emits the four-field REST create body for a disposable workflow that removes the
// two live rows the P7.3 step-2 harness wrote, and nothing else.
//
// WHY A WORKFLOW AND NOT A SCRIPT. Neither store is reachable from this repo directly: the
// Google Sheets rows need the tenant's OAuth credential, and the MCP tool surface has no
// delete-rows operation for a Data Table at all. Both deletes therefore have to happen inside
// n8n. And `test_workflow` PINS credential-bearing nodes, so the deletes must sit in a CHILD
// invoked as a sub-workflow -- exactly the split P7.1's probe used, and for the same reason.
//
// THE GUARDS, because an irreversible delete run from an agent session deserves more than a
// matching chat_id:
//
//   1. The chat id must match /^900000\d{3}$/ -- the reserved synthetic range. A production
//      chat id cannot pass this, whatever is handed in.
//   2. EXACTLY ONE Bot_Sessions row may match. Zero means nothing to do; two or more means the
//      probe's assumptions are wrong and a delete would be a guess.
//   3. That row must ALSO carry the expected session_id, the expected cycle_id and the expected
//      submission_key, all supplied by the caller and all compared exactly. A chat_id match
//      alone does not authorise the delete.
//   4. The row must carry NO lead_id. A row that reached the CRM is not probe residue.
//   5. row_number must be an integer > 1, so the header row can never be the delete target.
//   6. The receipt delete filters on the exact minted submission_key, which is a 32-hex
//      capability no other row can hold by accident.
//
// The read node's parameters are lifted VERBATIM from the audited wrapper's `Read Bot Sessions`
// so the cleanup sees the sheet through the same window the issuer did.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json');
const OUT = join(ROOT, 'n8n', 'candidate', 'p73s2-cleanup-child.json');

const wrapper = JSON.parse(readFileSync(IN, 'utf8'));
const byName = {};
wrapper.nodes.forEach((n) => { byName[n.name] = n; });

const readNode = byName['Read Bot Sessions'];
const sheetsCred = JSON.parse(JSON.stringify(readNode.credentials));
const readParams = JSON.parse(JSON.stringify(readNode.parameters));
const docId = readParams.documentId;
const sheetName = readParams.sheetName;

const SELECT_CODE = [
  "// P7.3 step-2 cleanup target selection. Six guards, all of which must hold before an",
  "// irreversible delete is authorised. See scripts/build-p73s2-cleanup-child.mjs.",
  "const want = $('Cleanup Entry').first().json || {};",
  "const chat = String(want.chat_id == null ? '' : want.chat_id).trim();",
  "const sess = String(want.session_id == null ? '' : want.session_id).trim();",
  "const cyc  = String(want.cycle_id == null ? '' : want.cycle_id).trim();",
  "const key  = String(want.submission_key == null ? '' : want.submission_key).trim();",
  "",
  "// GUARD 1 -- reserved synthetic range only.",
  "if (!/^900000\\d{3}$/.test(chat)) { throw new Error('REFUSING: chat_id ' + JSON.stringify(chat) + ' is outside the reserved 900000xxx range'); }",
  "// A BLANK expected key is allowed, and only blank -- P7.4 §7 stages a legacy row whose",
  "// submission_key is legitimately empty, and the original form of this guard could not clean",
  "// it up at all. It is not a relaxation of the identity check: guard 3 below still requires",
  "// EXACT equality with what the sheet holds, so a blank expectation only ever matches a blank",
  "// cell. What it refuses is a key that is neither blank nor well-formed, which is a caller",
  "// error rather than a state the issuer can produce.",
  "if (key !== '' && !/^sub_[0-9a-f]{32}$/.test(key)) { throw new Error('REFUSING: submission_key is neither blank nor a well-formed minted key'); }",
  "if (!sess || !cyc) { throw new Error('REFUSING: session_id and cycle_id must both be supplied'); }",
  "",
  "const cell = (r, n) => String(r[n] == null ? '' : r[n]).trim();",
  "const rows = $input.all().map(i => i.json).filter(r => r && cell(r, 'chat_id') === chat);",
  "",
  "// GUARD 2 -- exactly one row.",
  "if (rows.length === 0) { return [{ json: { nothing_to_delete: true, reason: 'NO_ROW_MATCHED', chat_id: chat } }]; }",
  "if (rows.length > 1) { throw new Error('REFUSING: ' + rows.length + ' rows carry chat_id ' + chat + '; a delete would be a guess'); }",
  "const t = rows[0];",
  "",
  "// GUARD 3 -- identity beyond chat_id.",
  "if (cell(t, 'session_id') !== sess) { throw new Error('REFUSING: session_id mismatch, sheet has ' + JSON.stringify(cell(t, 'session_id'))); }",
  "if (cell(t, 'cycle_id') !== cyc) { throw new Error('REFUSING: cycle_id mismatch, sheet has ' + JSON.stringify(cell(t, 'cycle_id'))); }",
  "if (cell(t, 'submission_key') !== key) { throw new Error('REFUSING: submission_key mismatch, sheet has ' + JSON.stringify(cell(t, 'submission_key'))); }",
  "",
  "// GUARD 4 -- never delete a row that reached the CRM.",
  "if (cell(t, 'lead_id') !== '') { throw new Error('REFUSING: the row carries lead_id ' + JSON.stringify(cell(t, 'lead_id')) + '; this is not probe residue'); }",
  "",
  "// GUARD 5 -- never target the header row.",
  "const rn = Number(t.row_number);",
  "if (!Number.isInteger(rn) || rn <= 1) { throw new Error('REFUSING: row_number ' + t.row_number + ' is not a data row'); }",
  "",
  "return [{ json: { nothing_to_delete: false, row_number: rn, chat_id: chat, session_id: sess, cycle_id: cyc, submission_key: key } }];"
].join('\n');

const RESULT_CODE = [
  "// Records exactly what was removed, so the cleanup is auditable rather than asserted.",
  "const grab = (fn, f) => { try { return fn(); } catch (e) { return f; } };",
  "const target = grab(() => $('Cleanup Select Target').first().json, { __absent: true });",
  "// alwaysOutputData on the delete node means a run that matched NOTHING still emits one",
  "// synthetic {} item. Counting that as a deletion is the same class of non-evidence as",
  "// 'the node did not error' -- P7.4 caught this reporting a receipt deleted for a row whose",
  "// submission_key was blank, when in fact nothing matched. Empty items are dropped so the",
  "// count is of rows actually removed.",
  "const receiptRaw = grab(() => $('Cleanup Delete Receipt').all().map(i => i.json), null);",
  "const receipt = receiptRaw === null ? null : receiptRaw.filter(r => r && Object.keys(r).length > 0);",
  "const sheetDel = grab(() => $('Cleanup Delete Session Row').first().json, { __absent: true });",
  "const post = grab(() => $('Cleanup Verify Sheet').all().map(i => i.json).filter(r => String(r.chat_id || '').trim() === String(target.chat_id || '')), null);",
  "return [{ json: {",
  "  __cleanup: 'P73S2',",
  "  target: target,",
  "  sheet_delete: sheetDel,",
  "  receipt_rows_deleted: receipt,",
  "  rows_remaining_for_chat: post === null ? null : post.length,",
  "  residue_zero: post !== null && post.length === 0",
  "} }];"
].join('\n');

const wf = {
  name: 'FINMENTOR P73S2 CLEANUP child (DISPOSABLE)',
  nodes: [
    {
      parameters: { inputSource: 'passthrough' },
      id: 'p73s2-cl-entry', name: 'Cleanup Entry',
      type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [0, 0],
      notes: 'Test-only entry. Receives { chat_id, session_id, cycle_id, submission_key }.'
    },
    {
      parameters: readParams,
      id: 'p73s2-cl-read', name: 'Cleanup Read Sessions',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [220, 0],
      credentials: sheetsCred,
      notes: 'Parameters lifted VERBATIM from the audited wrapper Read Bot Sessions.'
    },
    {
      parameters: { jsCode: SELECT_CODE },
      id: 'p73s2-cl-select', name: 'Cleanup Select Target',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0]
    },
    {
      parameters: {
        documentId: docId,
        sheetName: sheetName,
        resource: 'sheet',
        operation: 'delete',
        toDelete: 'rows',
        startIndex: '={{ $json.row_number }}',
        numberToDelete: 1
      },
      id: 'p73s2-cl-delrow', name: 'Cleanup Delete Session Row',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [660, 0],
      credentials: sheetsCred
    },
    {
      parameters: {
        resource: 'row',
        operation: 'deleteRows',
        dataTableId: { __rl: true, mode: 'name', value: 'Submission_Receipts' },
        matchType: 'allConditions',
        filters: {
          conditions: [{
            keyName: 'submission_key',
            condition: 'eq',
            keyValue: "={{ $('Cleanup Select Target').first().json.submission_key }}"
          }]
        },
        options: {}
      },
      id: 'p73s2-cl-delreceipt', name: 'Cleanup Delete Receipt',
      type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [880, 0],
      alwaysOutputData: true
    },
    {
      parameters: readParams,
      id: 'p73s2-cl-verify', name: 'Cleanup Verify Sheet',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [1100, 0],
      credentials: sheetsCred,
      alwaysOutputData: true,
      notes: 'Re-reads the sheet AFTER the delete so residue-zero is measured, not asserted.'
    },
    {
      parameters: { jsCode: RESULT_CODE },
      id: 'p73s2-cl-result', name: 'Cleanup Result',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 0]
    }
  ],
  connections: {
    'Cleanup Entry': { main: [[{ node: 'Cleanup Read Sessions', type: 'main', index: 0 }]] },
    'Cleanup Read Sessions': { main: [[{ node: 'Cleanup Select Target', type: 'main', index: 0 }]] },
    'Cleanup Select Target': { main: [[{ node: 'Cleanup Delete Session Row', type: 'main', index: 0 }]] },
    'Cleanup Delete Session Row': { main: [[{ node: 'Cleanup Delete Receipt', type: 'main', index: 0 }]] },
    'Cleanup Delete Receipt': { main: [[{ node: 'Cleanup Verify Sheet', type: 'main', index: 0 }]] },
    'Cleanup Verify Sheet': { main: [[{ node: 'Cleanup Result', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false }
};

// Refuse to emit anything that could touch Telegram or the live intake.
const blob = JSON.stringify(wf);
const bad = [];
if (/telegram/i.test(blob)) { bad.push('a Telegram reference appears in the cleanup child'); }
if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest')) { bad.push('an httpRequest node is present'); }
if (wf.nodes.filter((n) => /trigger$/i.test(n.type)).length !== 1) { bad.push('not exactly one trigger'); }
if (bad.length) { bad.forEach((b) => console.error('REFUSING: ' + b)); process.exit(1); }

writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('cleanup child written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  nodes:          ' + wf.nodes.length);
console.log('  telegram refs:  0');
console.log('  triggers:       1 (executeWorkflowTrigger)');
console.log('  availableInMCP: ' + wf.settings.availableInMCP);
