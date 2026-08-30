#!/usr/bin/env node
// FINMENTOR — prove the DEPLOYED projection against the REAL successful submission.
//
//   node scripts/verify-premium-projection-live.mjs
//
// READ ONLY. It issues GETs and nothing else. It creates no lead, replays no submission, starts no
// execution and writes no row.
//
// It takes the node code that is on the tenant right now, and the item that the real successful
// Mini App submission actually produced — read back from retained execution 4837, not from a
// fixture — and runs one against the other. That is the closest thing to a production proof that
// does not put a second lead in the Pipeline.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const EXECUTION_ID = '4837';
const ROW_NODE = 'Build Pipeline Row';
const WRITER_NODE = 'Save to Pipeline';
const MERGE_BUILDER = 'Build Merge Update';
const MERGE_WRITER = 'Update Pipeline (Merge)';
const NEW_FIELDS = ['current_setup', 'decision_horizon', 'important_context'];

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

let pass = 0;
const fail = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));
const eqw = (a, b, m) => want(a === b, m + (a === b ? '' : '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'));

const get = async (p) => {
  const r = await fetch(BASE + '/api/v1' + p, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { console.error('STOPPED: GET ' + p + ' -> ' + r.status); process.exit(1); }
  return r.json();
};

console.log('');
console.log('DEPLOYED PIPELINE PROJECTION — proven against the real successful submission');
console.log('='.repeat(78));
console.log('');

const wf = await get('/workflows/' + LEAD_INTAKE_ID);
const node = (n) => wf.nodes.find((x) => x.name === n);
const deployedJs = String(node(ROW_NODE).parameters.jsCode || '');

console.log('THE DEPLOYED NODE');
want(wf.nodes.length === 102, 'the workflow still has 102 nodes');
want(deployedJs.indexOf('__premium') !== -1, 'the deployed node reads the premium block');
for (const f of NEW_FIELDS) {
  want(deployedJs.indexOf('pick(__premium.' + f + ', item.' + f + ')') === -1 ? false : true,
    'deployed read for ' + f + ' is __premium first, item second');
}
console.log('');

// ── the real item, read back from the retained execution ───────────────────────────────────────
console.log('THE REAL ITEM (retained execution ' + EXECUTION_ID + ', not a fixture)');
const ex = await get('/executions/' + EXECUTION_ID + '?includeData=true');
const runData = ex.data.resultData.runData;
const outOf = (n) => {
  const r = runData[n] && runData[n][0];
  if (!r) { return null; }
  const items = ((r.data || {}).main || [[]])[0] || [];
  return items[0] ? items[0].json : null;
};
const realItem = outOf('Normalize + Score Lead');
const oldRow = outOf(ROW_NODE);
const unwrap = outOf('Internal Envelope Unwrap');
const sourcePremium = (unwrap && unwrap.body && unwrap.body.premium) || {};

want(!!realItem, 'the normalized item that produced the lead was recovered');
want(realItem.lead_id === 'FIN-1788113619104-582', 'it is the item for the canonical lead: ' + realItem.lead_id);
for (const f of NEW_FIELDS) {
  want(realItem[f] === undefined, 'the real item carries NO top-level ' + f + ' — this is the defect');
}
want(typeof realItem.raw_json === 'string' && JSON.parse(realItem.raw_json).premium !== undefined,
  'and it carries the premium block inside raw_json, where it always was');
console.log('');

console.log('THE AUTHORITATIVE SOURCE VALUES');
for (const f of NEW_FIELDS) { console.log('    body.premium.' + f.padEnd(18) + '= ' + JSON.stringify(sourcePremium[f])); }
console.log('');

// ── run the deployed code against it ───────────────────────────────────────────────────────────
console.log('THE DEPLOYED CODE, RUN AGAINST THAT ITEM');
const settings = (outOf('Settings to Object') || {}).settings || {};
const runner = new Function('$input', '$', deployedJs);
const $ = (name) => {
  if (name === 'Settings to Object') { return { first: () => ({ json: { settings } }) }; }
  throw new Error('unexpected node reference: ' + name);
};
let newRow = null;
try { newRow = runner({ first: () => ({ json: realItem }) }, $)[0].json; }
catch (e) { bad('the deployed node threw on the real item: ' + e.message); }

if (newRow) {
  eqw(newRow.current_setup, sourcePremium.current_setup, 'BP current_setup = the authoritative source value');
  eqw(newRow.decision_horizon, sourcePremium.decision_horizon, 'BQ decision_horizon = the authoritative source value');
  eqw(newRow.important_context, '', 'BR important_context stays empty — it is empty at source');
  want(sourcePremium.important_context === '', 'and the source really is empty, so BR is not a defect');

  console.log('');
  console.log('BEFORE / AFTER, on the same real item');
  for (const f of NEW_FIELDS) {
    console.log('    ' + f.padEnd(18) + JSON.stringify(oldRow ? oldRow[f] : null) + '  ->  ' + JSON.stringify(newRow[f]));
  }
  console.log('');

  console.log('NOTHING ELSE MOVED');
  const oldKeys = Object.keys(oldRow || {});
  const newKeys = Object.keys(newRow);
  eqw(JSON.stringify(newKeys), JSON.stringify(oldKeys), 'the row has exactly the same keys, in the same order — no accidental new key');
  const changed = newKeys.filter((k) => JSON.stringify(newRow[k]) !== JSON.stringify((oldRow || {})[k]));
  const expected = ['current_setup', 'decision_horizon', 'updated_at'];
  want(changed.every((k) => expected.indexOf(k) !== -1),
    'only the two repaired fields changed (plus updated_at, which is Date.now): ' + changed.join(', '));
}
console.log('');

// ── the writers ────────────────────────────────────────────────────────────────────────────────
console.log('NO HEADER APPEND, NO MERGE ERASURE, NO AUTOMAP CONTAMINATION');
{
  const w = node(WRITER_NODE);
  eqw(w.parameters.operation, 'append', WRITER_NODE + ' is an append');
  eqw(w.parameters.columns.mappingMode, 'defineBelow', WRITER_NODE + ' is defineBelow — it CANNOT append a header');
  eqw(Object.keys(w.parameters.columns.value).length, 62, WRITER_NODE + ' maps exactly 62 columns');
  for (const f of NEW_FIELDS) {
    want(Object.prototype.hasOwnProperty.call(w.parameters.columns.value, f), WRITER_NODE + ' maps ' + f + ' to its existing column');
  }
  const mw = node(MERGE_WRITER);
  eqw(mw.parameters.columns.mappingMode, 'autoMapInputData', MERGE_WRITER + ' is unchanged (autoMap, as designed for a merge)');
  const mb = String(node(MERGE_BUILDER).parameters.jsCode || '');
  for (const f of NEW_FIELDS) {
    want(mb.indexOf(f) === -1, MERGE_BUILDER + ' still does not mention ' + f + ' — so no merge can write or erase that column');
  }
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) {
    if (n.name === WRITER_NODE) { continue; }
    const v = (n.parameters.columns || {}).value || {};
    for (const f of NEW_FIELDS) {
      want(!Object.prototype.hasOwnProperty.call(v, f), n.name + ' does not map ' + f);
    }
  }
}

console.log('');
console.log('='.repeat(78));
if (fail.length) {
  console.log('FAILURES (' + fail.length + '):');
  fail.forEach((f) => console.log('  - ' + f));
}
console.log('CHECKS: ' + pass + ' passed' + (fail.length ? ', ' + fail.length + ' FAILED' : '') + '. Nothing was written by this script.');
console.log('');
process.exit(fail.length ? 1 : 0);
