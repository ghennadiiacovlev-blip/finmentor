#!/usr/bin/env node
// FINMENTOR — P7.4: build the DISPOSABLE synthetic Bot_Sessions state tool.
//
//   node scripts/build-p74-state-tool.mjs
//
// REPO-ONLY. Emits the four-field REST create body for a disposable workflow that can READ and
// SEED synthetic Bot_Sessions rows in the reserved 900000xxx range, and nothing else.
//
// WHY IT EXISTS. P7.4 has to reach states the Concierge cannot be talked into from a fixture in
// one turn:
//
//   §4  a genuinely LEAD-READY session -- consent in the current cycle, contact name, company,
//       a contact method. Driving that through the real conversation is many turns of guessing
//       callback tokens; seeding the row is the same end state, reached honestly and declared.
//   §5  a stale-context turn, which needs the authority row to be seeded before the run.
//   §7  an old session carrying a real cycle_id and a LITERAL BLANK submission_key -- a row the
//       issuer cannot produce at all, because every mint writes a key.
//
// WHAT IT DELIBERATELY CANNOT DO.
//
//   * It has NO delete path. Deletion stays in the already-proven p73s2 cleanup child, with its
//     six guards. Two tools that can both destroy rows is one more than this phase needs.
//   * It NEVER writes a Submission_Receipts row. §7 is explicit that a receipt must not be
//     fabricated for a historical cycle, and the tool having no way to do it is a better
//     guarantee than the tool choosing not to.
//   * It carries no Telegram node and no Telegram credential.
//
// THE GUARDS.
//   1. chat_id must match /^900000\d{3}$/ -- the reserved synthetic range. Nothing else can be
//      written, whatever is handed in.
//   2. SEED_MERGE refuses unless EXACTLY ONE row already carries that chat_id.
//   3. SEED_NEW refuses if ANY row already carries it, because appendOrUpdate matches on
//      chat_id and would silently overwrite rather than append.
//   4. A field set that tries to write `lead_id` is refused: this tool exists to stage
//      pre-handoff states, and a row carrying a lead id is a row that reached the CRM.
//   5. The write node's parameters are lifted VERBATIM from the audited wrapper's
//      `Save Bot Session`, so a seeded row is written by the same mapping the issuer uses --
//      autoMapInputData, matched on chat_id. A tool that wrote rows a different way would be
//      staging a state the production path cannot actually reach.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json');
const OUT = join(ROOT, 'n8n', 'candidate', 'p74-state-tool.json');

const wrapper = JSON.parse(readFileSync(IN, 'utf8'));
const byName = {};
wrapper.nodes.forEach((n) => { byName[n.name] = n; });

const readNode = byName['Read Bot Sessions'];
const saveNode = byName['Save Bot Session'];
const sheetsCred = JSON.parse(JSON.stringify(readNode.credentials));
const readParams = JSON.parse(JSON.stringify(readNode.parameters));
const saveParams = JSON.parse(JSON.stringify(saveNode.parameters));

const PLAN_CODE = [
  "// P7.4 synthetic state tool -- guards, then plan. See scripts/build-p74-state-tool.mjs.",
  "const want = $('Tool Entry').first().json || {};",
  "const mode = String(want.mode || '').trim().toUpperCase();",
  "const chat = String(want.chat_id == null ? '' : want.chat_id).trim();",
  "const fields = (want.fields && typeof want.fields === 'object') ? want.fields : {};",
  "",
  "// GUARD 1 -- reserved synthetic range only, for every mode.",
  "if (!/^900000\\d{3}$/.test(chat)) { throw new Error('REFUSING: chat_id ' + JSON.stringify(chat) + ' is outside the reserved 900000xxx range'); }",
  "if (['READ', 'SEED_MERGE', 'SEED_NEW'].indexOf(mode) === -1) { throw new Error('REFUSING: unknown mode ' + JSON.stringify(mode)); }",
  "",
  "// GUARD 4 -- never stage a row that looks like it reached the CRM.",
  "if (Object.prototype.hasOwnProperty.call(fields, 'lead_id') && String(fields.lead_id || '').trim() !== '') {",
  "  throw new Error('REFUSING: this tool will not write a non-empty lead_id');",
  "}",
  "",
  "const cell = (r, n) => String(r[n] == null ? '' : r[n]).trim();",
  "const all = $input.all().map(i => i.json).filter(r => r && cell(r, 'chat_id') !== '');",
  "const mine = all.filter(r => cell(r, 'chat_id') === chat);",
  "",
  "if (mode === 'READ') {",
  "  return [{ json: { __do_write: false, mode: mode, chat_id: chat, matched: mine.length, rows: mine } }];",
  "}",
  "",
  "let row = null;",
  "if (mode === 'SEED_MERGE') {",
  "  // GUARD 2 -- merge needs exactly one row to merge into.",
  "  if (mine.length !== 1) { throw new Error('REFUSING SEED_MERGE: ' + mine.length + ' rows carry chat_id ' + chat + ', expected exactly 1'); }",
  "  row = Object.assign({}, mine[0]);",
  "  delete row.row_number;   // a sheet coordinate, not a column",
  "} else {",
  "  // GUARD 3 -- appendOrUpdate matches on chat_id, so an existing row would be OVERWRITTEN.",
  "  if (mine.length !== 0) { throw new Error('REFUSING SEED_NEW: ' + mine.length + ' row(s) already carry chat_id ' + chat + '; appendOrUpdate would overwrite'); }",
  "  row = { chat_id: chat };",
  "}",
  "",
  "Object.keys(fields).forEach(k => { row[k] = fields[k] == null ? '' : fields[k]; });",
  "row.chat_id = chat;",
  "",
  "return [{ json: Object.assign({ __do_write: true, __mode: mode, __before: mine[0] || null }, row) }];"
].join('\n');

const RESULT_CODE = [
  "// Reports what the tool actually did, measured by re-reading the sheet afterwards.",
  "const grab = (fn, f) => { try { return fn(); } catch (e) { return f; } };",
  "const plan = grab(() => $('Tool Plan').first().json, { __absent: true });",
  "const chat = String(plan.chat_id || plan.__chat_id || '').trim() || String($('Tool Entry').first().json.chat_id || '').trim();",
  "const after = grab(() => $('Tool Verify').all().map(i => i.json).filter(r => String(r.chat_id || '').trim() === chat), null);",
  "const cell = (r, n) => String((r || {})[n] == null ? '' : (r || {})[n]).trim();",
  "const one = after && after.length === 1 ? after[0] : null;",
  "return [{ json: {",
  "  __tool: 'P74_STATE',",
  "  mode: plan.__mode || plan.mode || '',",
  "  chat_id: chat,",
  "  wrote: plan.__do_write === true,",
  "  rows_for_chat_after: after === null ? null : after.length,",
  "  observed: one === null ? null : {",
  "    cycle_id: cell(one, 'cycle_id'),",
  "    submission_key: cell(one, 'submission_key'),",
  "    consent: cell(one, 'consent'),",
  "    consent_cycle_id: cell(one, 'consent_cycle_id'),",
  "    contact_name: cell(one, 'contact_name'),",
  "    company: cell(one, 'company'),",
  "    contact_email: cell(one, 'contact_email'),",
  "    selected_service: cell(one, 'selected_service'),",
  "    state: cell(one, 'state'),",
  "    status: cell(one, 'status'),",
  "    lead_id: cell(one, 'lead_id'),",
  "    row_number: one.row_number",
  "  },",
  "  read_rows: plan.rows || null",
  "} }];"
].join('\n');

const wf = {
  name: 'FINMENTOR P74 STATE TOOL synthetic Bot_Sessions (DISPOSABLE)',
  nodes: [
    {
      parameters: { inputSource: 'passthrough' },
      id: 'p74-st-entry', name: 'Tool Entry',
      type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [0, 0],
      notes: 'Test-only entry. Receives { mode, chat_id, fields }. No public URL, no bot.'
    },
    {
      parameters: readParams,
      id: 'p74-st-read', name: 'Tool Read',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [220, 0],
      credentials: sheetsCred,
      notes: 'Parameters lifted VERBATIM from the audited wrapper Read Bot Sessions.'
    },
    {
      parameters: { jsCode: PLAN_CODE },
      id: 'p74-st-plan', name: 'Tool Plan',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0]
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
          conditions: [{
            id: 'p74-st-cond',
            leftValue: '={{ String($json.__do_write) }}',
            operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
            rightValue: 'true'
          }],
          combinator: 'and'
        },
        options: {}
      },
      id: 'p74-st-if', name: 'IF Do Write',
      type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [660, 0]
    },
    {
      parameters: saveParams,
      id: 'p74-st-write', name: 'Tool Write Row',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [880, -100],
      credentials: sheetsCred,
      notes: 'Parameters lifted VERBATIM from the audited wrapper Save Bot Session -- '
        + 'autoMapInputData matched on chat_id, the same mapping the issuer writes through.'
    },
    {
      parameters: readParams,
      id: 'p74-st-verify', name: 'Tool Verify',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [1100, 0],
      credentials: sheetsCred,
      alwaysOutputData: true,
      notes: 'Re-reads AFTER the write so the result is measured, not asserted.'
    },
    {
      parameters: { jsCode: RESULT_CODE },
      id: 'p74-st-result', name: 'Tool Result',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 0]
    }
  ],
  connections: {
    'Tool Entry': { main: [[{ node: 'Tool Read', type: 'main', index: 0 }]] },
    'Tool Read': { main: [[{ node: 'Tool Plan', type: 'main', index: 0 }]] },
    'Tool Plan': { main: [[{ node: 'IF Do Write', type: 'main', index: 0 }]] },
    'IF Do Write': {
      main: [
        [{ node: 'Tool Write Row', type: 'main', index: 0 }],
        [{ node: 'Tool Verify', type: 'main', index: 0 }]
      ]
    },
    'Tool Write Row': { main: [[{ node: 'Tool Verify', type: 'main', index: 0 }]] },
    'Tool Verify': { main: [[{ node: 'Tool Result', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false }
};

const blob = JSON.stringify(wf);
const bad = [];
if (/telegram/i.test(blob)) { bad.push('a Telegram reference appears'); }
if (/dataTable/.test(blob)) { bad.push('a Data Table reference appears -- this tool must not touch receipts'); }
if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest')) { bad.push('an httpRequest node is present'); }
if (wf.nodes.filter((n) => /trigger$/i.test(n.type)).length !== 1) { bad.push('not exactly one trigger'); }
if (/operation.{0,20}delete/i.test(blob)) { bad.push('a delete operation appears -- deletion belongs to the cleanup child'); }
if (bad.length) { bad.forEach((b) => console.error('REFUSING: ' + b)); process.exit(1); }

writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('state tool written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  nodes:          ' + wf.nodes.length);
console.log('  modes:          READ, SEED_MERGE, SEED_NEW  (no delete, no receipts)');
console.log('  telegram refs:  0');
console.log('  availableInMCP: ' + wf.settings.availableInMCP);
