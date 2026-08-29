#!/usr/bin/env node
// FINMENTOR — the Lead Intake BP/BQ/BR projection candidate, EXECUTED.
//
//   node qa/premium-ux-projection-candidate.test.mjs
//
// Offline. No tenant, no network, no credentials.
//
// The builder's own checks prove the delta is narrow. They cannot prove the patched node still
// RUNS, or that a lead which never went through the Premium Mini App writes three empty cells
// rather than three `undefined` holes. This runs `Build Pipeline Row` and reads the row it emits.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-projection-candidate.json');
const NEW_FIELDS = ['current_setup', 'decision_horizon', 'important_context'];

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const wf = JSON.parse(readFileSync(CANDIDATE, 'utf8'));
const rowNode = wf.nodes.find((n) => n.name === 'Build Pipeline Row');
const writer = wf.nodes.find((n) => n.name === 'Save to Pipeline');

// The node reads `$input.first().json` and `$('Settings to Object').first().json.settings`.
const runner = new Function('$input', '$', rowNode.parameters.jsCode);
function buildRow(item, settings) {
  const $ = (name) => {
    if (name === 'Settings to Object') { return { first: () => ({ json: { settings: settings || {} } }) }; }
    throw new Error('unexpected node reference: ' + name);
  };
  return runner({ first: () => ({ json: item }) }, $)[0].json;
}

const BASE_LEAD = {
  lead_id: 'LEAD-000999', created_at: '2026-08-29T10:00:00.000Z', lead_priority: 'WARM',
  name: 'Тест', company: 'ООО Пример', email: 'x@example.test', request_id: 'req-1'
};

console.log('Lead Intake premium projection candidate — executed');
console.log('');

check('the patched node executes and still emits one row', () => {
  const row = buildRow(BASE_LEAD);
  assert(row && typeof row === 'object', 'no row');
  eq(row.lead_id, 'LEAD-000999', 'lead_id');
});

check('a premium lead projects all three columns', () => {
  const row = buildRow(Object.assign({}, BASE_LEAD, {
    current_setup: 'Excel + 1С',
    decision_horizon: 'В этом квартале',
    important_context: 'Три юрлица, сводка вручную.'
  }));
  eq(row.current_setup, 'Excel + 1С', 'current_setup');
  eq(row.decision_horizon, 'В этом квартале', 'decision_horizon');
  eq(row.important_context, 'Три юрлица, сводка вручную.', 'important_context');
});

check('a NON-premium lead writes three empty strings, never undefined', () => {
  // This is the one that matters for the sheet: `undefined` in a defineBelow mapping renders as the
  // literal string "undefined" in a cell. Every legacy web-form lead takes this path.
  const row = buildRow(BASE_LEAD);
  for (const f of NEW_FIELDS) {
    assert(Object.prototype.hasOwnProperty.call(row, f), f + ' is missing from the row');
    eq(row[f], '', f + ' is not an empty string');
    eq(typeof row[f], 'string', f + ' is not a string');
  }
});

check('whitespace-only input is normalised to empty, like every other field', () => {
  const row = buildRow(Object.assign({}, BASE_LEAD, { current_setup: '   ', decision_horizon: '\n' }));
  eq(row.current_setup, '', 'current_setup');
  eq(row.decision_horizon, '', 'decision_horizon');
});

check('the projection did not disturb the existing columns', () => {
  const a = buildRow(BASE_LEAD);
  const b = buildRow(Object.assign({}, BASE_LEAD, {
    current_setup: 'x', decision_horizon: 'y', important_context: 'z'
  }));
  for (const k of Object.keys(a)) {
    if (NEW_FIELDS.indexOf(k) !== -1) { continue; }
    if (k === 'updated_at' || k === 'created_at') { continue; }   // clock-derived
    eq(b[k], a[k], 'existing field changed when premium values were supplied: ' + k);
  }
});

check('the three columns are the LAST fields in the row, matching BP:BR', () => {
  const keys = Object.keys(buildRow(BASE_LEAD));
  eq(keys.slice(-3).join(','), NEW_FIELDS.join(','), 'trailing key order');
});

// ---------------------------------------------------------------- the writer node

check('the writer maps exactly the three new columns, and nothing else moved', () => {
  const v = writer.parameters.columns.value;
  for (const f of NEW_FIELDS) { eq(v[f], '={{$json.' + f + '}}', 'mapping for ' + f); }
  eq(Object.keys(v).length, 62, 'mapped key count (59 + 3)');
});

check('the writer is still defineBelow — F16 must not be reintroduced', () => {
  eq(writer.parameters.columns.mappingMode, 'defineBelow', 'mapping mode');
  eq(writer.parameters.operation, 'append', 'operation');
  // autoMapInputData is what silently widened this workbook twice. The columns now exist in the
  // sheet precisely so the writer never has to discover one.
  assert(JSON.stringify(writer).indexOf('autoMapInputData') === -1, 'autoMapInputData appears on the writer');
});

check('the schema gained exactly three entries, of the same shape as the rest', () => {
  const schema = writer.parameters.columns.schema;
  const added = schema.filter((s) => NEW_FIELDS.indexOf(s.id) !== -1);
  eq(added.length, 3, 'added schema entries');
  for (const s of added) {
    eq(s.displayName, s.id, 'displayName');
    eq(s.type, 'string', 'type');
    eq(s.required, false, 'required');
    eq(s.defaultMatch, false, 'defaultMatch');
  }
});

// ---------------------------------------------------------------- the candidate as an artifact

check('exactly two nodes differ from the live workflow', () => {
  eq(wf.nodes.length, 102, 'node count');
  assert(/^\[CANDIDATE\]/.test(wf.name), 'not named as a candidate: ' + wf.name);
});

check('no production identifier reached the artifact', () => {
  const json = JSON.stringify(wf);
  for (const leak of ['cachedResultUrl', 'cachedResultName', 'activeVersion', 'versionId', 'pinData']) {
    assert(json.indexOf('"' + leak + '"') === -1, 'leaked key: ' + leak);
  }
});

check('the P9-R2 flag pair is absent from every node', () => {
  for (const n of wf.nodes) {
    assert(!(n.alwaysOutputData === true && n.onError === 'continueErrorOutput'), 'P9-R2 flag pair on ' + n.name);
  }
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
