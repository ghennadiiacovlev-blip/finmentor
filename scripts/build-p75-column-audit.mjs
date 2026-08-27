#!/usr/bin/env node
// FINMENTOR — P7.5 §1: build the READ-ONLY Bot_Sessions trailing-column audit.
//
//   node scripts/build-p75-column-audit.mjs
//
// REPO-ONLY. Emits a four-field REST create body for a disposable workflow that READS the full
// width of Bot_Sessions and reports the shape of its tail. It deletes nothing and it cannot:
// there is no delete operation anywhere in it.
//
// WHY A NEW AUDIT WHEN scripts/p71b-column-sweep.ps1 ALREADY EXISTS.
//
// The P7.1b sweep does the audit and the delete in one guarded execution, using the Sheets v4
// REST API through an HTTP Request node -- deliberately, because `deleteDimension` takes an
// explicit 0-based half-open range that cannot be off by one silently, and because it is ONE
// atomic request rather than six.
//
// That design is blocked, and the block is correct. The Google Sheets credential carries a
// domain restriction forbidding its use in any HTTP Request node:
//
//     NodeOperationError: This credential is configured to prevent use within an HTTP Request
//     or GraphQL node
//
// P7.1 already met this and recorded it as "a sound control ... a blocker, not a complaint."
// It fires on the FIRST node, so even the sweep's read-only AUDIT mode cannot run. Relaxing a
// deliberate security control to make a hygiene task convenient is not a trade this phase will
// make, so the audit is rebuilt on the Sheets NODE, which the restriction permits.
//
// WHY THIS AUDIT DOES NOT ALSO DELETE. The Sheets node cannot express a column range. At
// typeVersion 4.7 the node's `startIndex` and `numberToDelete` parameters are declared only for
// `toDelete: "rows"`; the `columns` case exposes no index parameters at all. Deleting columns
// through it would mean guessing undeclared parameter names against a live customer sheet, and
// a destructive off-by-one is not recoverable by noticing it afterwards. So this artifact
// proves the preconditions and stops. The deletion path is stated in
// docs/P7_5_PRODUCTION_CONCIERGE_CUTOVER.md §1 and needs one owner action.
//
// NO CUSTOMER DATA LEAVES THIS WORKFLOW. The Code node emits header names, counts, booleans and
// column letters only -- never a cell value from any customer row.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json');
const OUT = join(ROOT, 'n8n', 'candidate', 'p75-column-audit.json');

const wrapper = JSON.parse(readFileSync(IN, 'utf8'));
const readNode = wrapper.nodes.find((n) => n.name === 'Read Bot Sessions');
const sheetsCred = JSON.parse(JSON.stringify(readNode.credentials));
const wideParams = JSON.parse(JSON.stringify(readNode.parameters));

// TWO changes from the audited read, and the second one is the whole reason this works.
//
// 1. The range widens A:AV -> A:BZ. A:AV is the production window and would not show the
//    residue at all.
//
// 2. `headerRow: 1, firstDataRow: 1` -- the header row is returned AS DATA.
//
// The second is not a flourish. The Sheets node returns each row as an object keyed by header
// and OMITS keys whose cell is empty, so a column that is blank on every row is completely
// invisible to a normal read. The first version of this audit did exactly that and reported all
// six dead columns "absent" -- which was an artifact of the method, not a fact about the sheet.
// That is the same class of non-evidence as "the node did not error".
//
// Reading the header row as data fixes it: in that row every existing column carries its own
// NAME as its value, so nothing is empty and nothing can hide. A column that shows up there
// exists; one that does not, does not.
wideParams.options = Object.assign({}, wideParams.options || {}, {
  dataLocationOnSheet: {
    values: { rangeDefinition: 'specifyRangeA1', range: 'A:BZ' }
  }
});
wideParams.options.dataLocationOnSheet = {
  values: { rangeDefinition: 'specifyRange', range: 'A:BZ', headerRow: 1, firstDataRow: 1 }
};

const AUDIT_CODE = [
  "// P7.5 §1 read-only audit of the Bot_Sessions tail. Emits header names, counts, booleans and",
  "// column letters ONLY -- never a customer cell value.",
  "const EXPECTED_KEEP = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'];",
  "// NINE, not the six P7.1b listed. P7.5 measured three MORE: __do_write, __mode and __before,",
  "// appended by the P7.4 state tool, whose Tool Plan emitted them alongside the row and whose",
  "// write node carries Save Bot Session's autoMapInputData. That is F16 firing again, caused by",
  "// this project's own instrumentation rather than by production.",
  "const EXPECTED_DEAD = ['key', '__rows_seen', '__advance', '__reason', '__verified_submission_key', 'p71_absent_column', '__do_write', '__mode', '__before'];",
  "",
  "const all = $input.all().map(i => i.json);",
  "// Item 0 is the HEADER ROW echoed as data (headerRow=1, firstDataRow=1). Its keys are the",
  "// sheet's real columns -- including every column that is empty on all customer rows, which a",
  "// normal read cannot see at all because the node omits keys for empty cells.",
  "const headerEcho = all.length ? all[0] : {};",
  "const rows = all.slice(1);",
  "const headerSet = Object.keys(headerEcho).filter(k => k !== 'row_number');",
  "",
  "const letter = (i) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };",
  "",
  "// P3 -- every cell of every DEAD header must be empty on every row.",
  "const nonEmpty = {};",
  "EXPECTED_DEAD.forEach(h => { nonEmpty[h] = 0; });",
  "rows.forEach(r => EXPECTED_DEAD.forEach(h => {",
  "  const v = (r || {})[h];",
  "  if (v !== undefined && v !== null && String(v).trim() !== '') { nonEmpty[h]++; }",
  "}));",
  "",
  "// P5 -- no synthetic 900000xxx row may be left behind.",
  "const synthetic = rows.filter(r => /^900000\\d{3}$/.test(String((r || {}).chat_id || '').trim())).length;",
  "",
  "// Any header the audit did not expect at all.",
  "const known = EXPECTED_KEEP.concat(EXPECTED_DEAD);",
  "const tailStart = headerSet.findIndex(h => h === 'submission_key');",
  "const tail = tailStart === -1 ? [] : headerSet.slice(tailStart);",
  "const unexpectedTail = tail.filter(h => known.indexOf(h) === -1);",
  "",
  "return [{ json: {",
  "  __audit: 'P75_COLUMN_TAIL',",
  "  total_rows: rows.length,",
  "  header_echo_first: headerSet.slice(0,3),",
  "  total_headers: headerSet.length,",
  "  header_tail_from_submission_key: tail.map((h, i) => letter(tailStart + i) + ' ' + h),",
  "  keep_expected: EXPECTED_KEEP,",
  "  dead_expected: EXPECTED_DEAD,",
  "  dead_present: EXPECTED_DEAD.filter(h => headerSet.indexOf(h) !== -1),",
  "  dead_absent: EXPECTED_DEAD.filter(h => headerSet.indexOf(h) === -1),",
  "  dead_are_physically_trailing: tail.length === EXPECTED_KEEP.length + EXPECTED_DEAD.length",
  "    && EXPECTED_KEEP.every((h, i) => tail[i] === h)",
  "    && EXPECTED_DEAD.every((h, i) => tail[EXPECTED_KEEP.length + i] === h),",
  "  dead_nonempty_cell_counts: nonEmpty,",
  "  dead_all_empty: EXPECTED_DEAD.every(h => nonEmpty[h] === 0),",
  "  unexpected_tail_headers: unexpectedTail,",
  "  synthetic_9000007xx_rows: synthetic,",
  "  first_header: headerSet[0] || '',",
  "  last_header: headerSet[headerSet.length - 1] || ''",
  "} }];"
].join('\n');

const wf = {
  name: 'FINMENTOR P75 COLUMN AUDIT Bot_Sessions tail (READ-ONLY, DISPOSABLE)',
  nodes: [
    {
      parameters: { inputSource: 'passthrough' },
      id: 'p75-ca-entry', name: 'Audit Entry',
      type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2, position: [0, 0]
    },
    {
      parameters: wideParams,
      id: 'p75-ca-read', name: 'Audit Read Wide',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [220, 0],
      credentials: sheetsCred,
      notes: 'Read Bot Sessions parameters VERBATIM except the range, widened A:AV -> A:BZ so the '
        + 'residue is visible and "nothing past BE" is measured rather than assumed.'
    },
    {
      parameters: { jsCode: AUDIT_CODE },
      id: 'p75-ca-report', name: 'Audit Report',
      type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0]
    }
  ],
  connections: {
    'Audit Entry': { main: [[{ node: 'Audit Read Wide', type: 'main', index: 0 }]] },
    'Audit Read Wide': { main: [[{ node: 'Audit Report', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false }
};

const blob = JSON.stringify(wf);
const bad = [];
if (/telegram/i.test(blob)) { bad.push('a Telegram reference appears'); }
if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest')) { bad.push('an httpRequest node is present'); }
if (/"operation"\s*:\s*"(delete|deleteRows|append|update|appendOrUpdate)"/.test(blob)) {
  bad.push('a mutating operation appears -- this artifact must be read-only');
}
if (bad.length) { bad.forEach((b) => console.error('REFUSING: ' + b)); process.exit(1); }

writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n', 'utf8');
console.log('column audit written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  nodes:          ' + wf.nodes.length);
console.log('  range:          ' + wideParams.options.range);
console.log('  mutating ops:   0  (read-only by construction)');
console.log('  httpRequest:    0  (the credential forbids it, and correctly)');
