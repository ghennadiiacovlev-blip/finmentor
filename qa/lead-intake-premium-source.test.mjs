#!/usr/bin/env node
// FINMENTOR — Pipeline BP/BQ/BR actually receives the premium values. EXECUTED.
//
//   node qa/lead-intake-premium-source.test.mjs
//
// Offline. No tenant, no network, no credentials, and no lead is created anywhere.
//
// ── WHY THIS GATE EXISTS, AND WHY THE OLD ONE PASSED ───────────────────────────────────────────
//
// `qa/premium-ux-projection-candidate.test.mjs` proved the three columns are emitted, and it was
// green the whole time the columns were empty in production. It fed the node a fixture with
// `current_setup` sitting on the item:
//
//     buildRow({ ...BASE_LEAD, current_setup: 'Excel + 1С', ... })
//
// Nothing in the system produces that item. `Normalize + Score Lead` does not lift
// `payload.premium` onto the item — the word "premium" does not occur in it — so the real item
// carries those values ONLY inside `raw_json`. The gate tested the consumer against a shape the
// producer never emits, which is the same failure as a QA fake that models an error as a bare
// string: green offline, empty in the sheet.
//
// So every assertion here builds its item the way the live workflow does: premium inside the
// serialised payload, and nothing on the item itself. The fixture is taken from the real lead
// FIN-1788113619104-582.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-source-candidate.json');
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
const node = (n) => wf.nodes.find((x) => x.name === n);
const rowNode = node('Build Pipeline Row');
const writer = node('Save to Pipeline');
const mergeBuilder = node('Build Merge Update');
const mergeWriter = node('Update Pipeline (Merge)');

const runner = new Function('$input', '$', rowNode.parameters.jsCode);
function buildRow(item, settings) {
  const $ = (name) => {
    if (name === 'Settings to Object') { return { first: () => ({ json: { settings: settings || {} } }) }; }
    throw new Error('unexpected node reference: ' + name);
  };
  return runner({ first: () => ({ json: item }) }, $)[0].json;
}

// The payload as the Mini App delivers it, and as normalize preserves it verbatim in raw_json.
const PREMIUM = {
  current_setup: 'Excel / ручные отчёты; План-факт; CFO / финансовая команда',
  decision_horizon: '2–4 недели',
  important_context: ''
};
const payload = (over) => JSON.stringify(Object.assign({
  tool: 'miniapp_premium_brief',
  meta: { request_id: 'sub_' + 'a'.repeat(32), analytics_consent: true,
    attribution_first_touch: { utm_source: 'telegram', captured_at: '2026-08-30T14:23:42.783Z' } },
  premium: PREMIUM
}, over || {}));

// The item exactly as `Normalize + Score Lead` emits it: premium lives in raw_json and NOWHERE
// else. Anything that reads `item.current_setup` gets undefined, which is the defect.
const lead = (over) => Object.assign({
  lead_id: 'FIN-1788113619104-582', created_at: '2026-08-30T18:13:38.231Z',
  lead_priority: 'HOT', name: 'Iacovlev', company: 'Mega Parc SRL',
  telegram: '551662084', request_id: 'sub_' + 'a'.repeat(32),
  raw_json: payload()
}, over || {});

console.log('Lead Intake — Pipeline BP/BQ/BR source, executed against the REAL item shape');
console.log('');

// ── the defect, and its fix ───────────────────────────────────────────────────────────────────

check('the item the producer really emits carries premium ONLY in raw_json', () => {
  const it = lead();
  for (const f of NEW_FIELDS) {
    eq(it[f], undefined, 'the fixture put ' + f + ' on the item — that is not what normalize emits');
  }
  assert(JSON.parse(it.raw_json).premium.current_setup.length > 0, 'the fixture lost the premium block');
});

check('BP/BQ — a premium lead now projects the values the client actually sent', () => {
  const row = buildRow(lead());
  eq(row.current_setup, PREMIUM.current_setup, 'BP current_setup');
  eq(row.decision_horizon, PREMIUM.decision_horizon, 'BQ decision_horizon');
});

check('BR — an empty important_context stays empty, and that is not a defect', () => {
  eq(buildRow(lead()).important_context, '', 'BR important_context');
});

check('BR — a NON-empty important_context is projected', () => {
  const row = buildRow(lead({ raw_json: payload({
    premium: Object.assign({}, PREMIUM, { important_context: 'Через месяц встреча с банком.' })
  }) }));
  eq(row.important_context, 'Через месяц встреча с банком.', 'BR important_context');
});

check('the node still runs, and the rest of the row is untouched', () => {
  const row = buildRow(lead());
  eq(row.lead_id, 'FIN-1788113619104-582', 'lead_id');
  eq(row.company, 'Mega Parc SRL', 'company');
  eq(row.priority, 'HOT', 'priority');
  eq(row.request_id, 'sub_' + 'a'.repeat(32), 'request_id');
  // The attribution meta is read from the SAME parse the premium block now shares.
  eq(row.analytics_consent, 'TRUE', 'analytics_consent from meta');
  eq(row.first_touch_at, '2026-08-30T14:23:42.783Z', 'first_touch_at from meta');
  eq(row.utm_source_first, 'telegram', 'utm_source_first from meta');
});

// ── it must not break anything that is not a Premium lead ─────────────────────────────────────

check('a lead with no premium block writes three empty strings, never undefined', () => {
  // `undefined` in a defineBelow mapping renders as the literal string "undefined" in the sheet.
  const row = buildRow(lead({ raw_json: JSON.stringify({ meta: {} }) }));
  for (const f of NEW_FIELDS) { eq(row[f], '', f + ' on a non-premium lead'); }
});

check('a lead with NO raw_json at all still builds a row', () => {
  const row = buildRow(lead({ raw_json: undefined }));
  for (const f of NEW_FIELDS) { eq(row[f], '', f); }
  eq(row.lead_id, 'FIN-1788113619104-582', 'lead_id');
});

check('malformed raw_json never breaks the CRM write', () => {
  const row = buildRow(lead({ raw_json: '{not json' }));
  for (const f of NEW_FIELDS) { eq(row[f], '', f); }
  eq(row.lead_id, 'FIN-1788113619104-582', 'lead_id');
});

check('a premium block of the wrong TYPE is ignored rather than spread', () => {
  for (const bad of ['a string', 42, null, ['a', 'b']]) {
    const row = buildRow(lead({ raw_json: JSON.stringify({ meta: {}, premium: bad }) }));
    for (const f of NEW_FIELDS) { eq(row[f], '', f + ' with premium=' + JSON.stringify(bad)); }
  }
});

check('an item that DOES carry the fields top-level still works, as a second source', () => {
  // If normalize ever lifts them, that must not become a regression.
  const row = buildRow(lead({ raw_json: JSON.stringify({ meta: {} }), current_setup: 'Excel + 1С' }));
  eq(row.current_setup, 'Excel + 1С', 'the item fallback');
});

// ── F16 containment: the merge path, and the writers ──────────────────────────────────────────

check('F16 — Save to Pipeline is still append + defineBelow, mapping all three', () => {
  eq(writer.parameters.operation, 'append', 'operation');
  eq(writer.parameters.columns.mappingMode, 'defineBelow', 'mappingMode');
  for (const f of NEW_FIELDS) {
    assert(Object.prototype.hasOwnProperty.call(writer.parameters.columns.value, f), 'unmapped: ' + f);
  }
  // defineBelow writes the named columns and only those, so no key can append a header.
  eq(Object.keys(writer.parameters.columns.value).length, 62, 'the new-lead writer gained or lost a column');
});

check('F16 — the MERGE writer is autoMapInputData, so its BUILDER is the containment', () => {
  eq(mergeWriter.parameters.operation, 'update', 'merge writer operation');
  eq(mergeWriter.parameters.columns.mappingMode, 'autoMapInputData', 'merge writer mapping mode');
  // autoMapInputData writes a column for every key in the item, and appends a header for any it
  // does not find. That is F16, and it widened this workbook twice. It is correct HERE — a merge
  // must advance only the fields it carries and must not erase the rest — which is exactly why the
  // three keys must never enter this builder's output.
  const js = String(mergeBuilder.parameters.jsCode || '');
  for (const f of NEW_FIELDS) {
    assert(js.indexOf(f) === -1, MERGE_MSG(f));
  }
});
function MERGE_MSG(f) {
  return 'Build Merge Update mentions ' + f + ' — it feeds an autoMap writer, so every merge would ' +
    'write that column, and a merge that did not carry a value would erase it';
}

check('F16 — no OTHER Sheets writer learned the three keys', () => {
  for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets')) {
    if (n.name === 'Save to Pipeline') { continue; }
    const v = (n.parameters.columns || {}).value || {};
    for (const f of NEW_FIELDS) {
      assert(!Object.prototype.hasOwnProperty.call(v, f), n.name + ' now maps ' + f);
    }
  }
});

check('the merge path cannot reach Build Pipeline Row, so the new read is new-lead only', () => {
  const feeders = [];
  for (const [src, c] of Object.entries(wf.connections)) {
    (c.main || []).forEach((br) => (br || []).forEach((e) => { if (e.node === 'Build Pipeline Row') { feeders.push(src); } }));
  }
  eq(JSON.stringify(feeders), JSON.stringify(['IF Is New']), 'Build Pipeline Row feeders');
});

// ── the delta is narrow ───────────────────────────────────────────────────────────────────────

check('exactly one node differs from the deployed workflow, and it is Build Pipeline Row', () => {
  // The builder asserts this while writing. Re-asserted here against the artifact that ships.
  eq(wf.nodes.length, 102, 'node count');
  const js = String(rowNode.parameters.jsCode);
  assert(js.indexOf('__premium') !== -1, 'the premium source is missing');
  assert(js.indexOf('JSON.parse(item.raw_json') !== -1, 'the defensive parse is missing');
  for (const f of NEW_FIELDS) {
    assert(js.indexOf('pick(__premium.' + f + ', item.' + f + ')') !== -1, 'field read not rewritten: ' + f);
  }
});

check('no node carries the P9-R2 flag pair', () => {
  for (const n of wf.nodes) {
    assert(!(n.alwaysOutputData === true && n.onError === 'continueErrorOutput'), 'P9-R2 pair on ' + n.name);
  }
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('ASSERTIONS: ' + pass + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
process.exit(failures.length ? 1 : 0);
