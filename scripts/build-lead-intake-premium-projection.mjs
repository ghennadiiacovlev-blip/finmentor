#!/usr/bin/env node
// FINMENTOR — Lead Intake projection candidate for Pipeline BP/BQ/BR.
//
//   node scripts/build-lead-intake-premium-projection.mjs --live <live-export.json>
//
// REPO-ONLY. Emits n8n/candidate/lead-intake-premium-projection-candidate.json and never contacts
// n8n. It is a CANDIDATE, not a deployment.
//
// WHAT IT CHANGES — exactly two nodes, additively:
//
//   Build Pipeline Row   three fields appended to the returned row object
//   Save to Pipeline     three mapped values + three schema entries appended
//
// WHY IT PATCHES A LIVE EXPORT RATHER THAN GENERATING A WORKFLOW. `FINMENTOR Lead Intake PREMIUM
// FINAL` has 102 nodes and is CLOSED at GO. Regenerating it from a builder would put every one of
// those nodes at risk for the sake of three columns. So this reads the live export, applies a
// narrow delta, and then asserts — on the OUTPUT, not on intent — that nothing else moved.
//
// THE INVARIANTS BELOW ARE THE POINT. Any of them failing means the delta is wrong and the file is
// not written. In particular:
//
//   * `Save to Pipeline` must still be `defineBelow`. F16 — `autoMapInputData` appends a column for
//     every unknown key — is what silently widened this workbook twice. The three columns now exist
//     in the sheet precisely so the writer never has to discover them.
//   * No node may gain `alwaysOutputData` beside `continueErrorOutput`. That pair is what made the
//     Gateway answer 409 to an outage and Lead Intake reach a write on one (P9-R2 / P9-R4).
//   * Every other node must be byte-identical to the live export.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-projection-candidate.json');

export const ROW_NODE = 'Build Pipeline Row';
export const WRITER_NODE = 'Save to Pipeline';

// BP / BQ / BR, in sheet order. `important_context` is free text; `decision_horizon` and
// `current_setup` are closed vocabularies on the client, but nothing here validates them — the
// draft contract already did, and re-validating in the projection would create a second authority.
export const NEW_FIELDS = ['current_setup', 'decision_horizon', 'important_context'];

const args = process.argv.slice(2);
const livePath = args[args.indexOf('--live') + 1];
if (!livePath || livePath.startsWith('--')) {
  console.error('usage: node scripts/build-lead-intake-premium-projection.mjs --live <live-export.json>');
  process.exit(1);
}

const live = JSON.parse(readFileSync(livePath, 'utf8'));

// Resource locators in a live export carry `cachedResultUrl` — the full production spreadsheet
// URL — and `cachedResultName`. Those are display caches n8n rebuilds on open; the `value` is the
// real reference. A tracked artifact must not carry them: an `activeVersion` blob leaked the
// production spreadsheet id into a harness artifact once already.
//
// The sanitisation is applied to the BASE as well as the candidate, so the drift check below
// compares like with like and cannot mistake a stripped cache for a real change.
function sanitize(nodes) {
  const strip = (v) => {
    if (!v || typeof v !== 'object') { return v; }
    if (Array.isArray(v)) { return v.map(strip); }
    const out = {};
    for (const k of Object.keys(v)) {
      if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; }
      out[k] = strip(v[k]);
    }
    return out;
  };
  return strip(nodes);
}

const baseNodes = sanitize(JSON.parse(JSON.stringify(live.nodes)));
const cachesStripped = JSON.stringify(live.nodes).split('"cachedResult').length - 1;

// Only the four keys n8n needs to import a workflow. An `activeVersion` blob leaked the production
// spreadsheet id into a tracked artifact once; an allowlist prevents the whole class, where deleting
// known-bad keys would not.
const candidate = {
  name: '[CANDIDATE] ' + live.name + ' — Pipeline BP/BQ/BR projection',
  nodes: JSON.parse(JSON.stringify(baseNodes)),
  connections: JSON.parse(JSON.stringify(live.connections)),
  settings: JSON.parse(JSON.stringify(live.settings || {}))
};

const fail = [];
const node = (n) => candidate.nodes.find((x) => x.name === n);

// ------------------------------------------------------------------ 1. Build Pipeline Row

const row = node(ROW_NODE);
if (!row) { fail.push('missing node: ' + ROW_NODE); }

if (row) {
  const before = row.parameters.jsCode;
  // The row object is built inline inside the return statement — there is no `row` variable to
  // attach to. An earlier deploy script assumed one and its guard correctly refused to splice
  // blindly, so the anchor here is the LAST field of the attribution block, which is stable and
  // unique.
  const anchor = "      first_touch_at: String(__first.captured_at || '')";
  if (before.indexOf(anchor) === -1) {
    fail.push(ROW_NODE + ': anchor not found — the row object changed shape; do not splice blindly');
  } else if (NEW_FIELDS.some((f) => before.indexOf(f + ':') !== -1)) {
    fail.push(ROW_NODE + ': the premium fields are already present — this delta has been applied');
  } else {
    const added = [
      anchor + ',',
      '',
      '      // --- Premium UX projection (Pipeline BP:BR) ---',
      '      // Added 2026-08-29 after the BP/BQ/BR header migration. Before it, these three values',
      '      // travelled here and landed only in raw_json: present, but not queryable. `pick` gives',
      "      // the same empty-string-not-undefined normalisation every other field gets, so a lead",
      '      // that never went through the Premium Mini App writes three empty cells rather than',
      '      // three holes.',
      '      current_setup: pick(item.current_setup),',
      '      decision_horizon: pick(item.decision_horizon),',
      '      important_context: pick(item.important_context)'
    ].join('\n');
    row.parameters.jsCode = before.replace(anchor, added);
  }
}

// ------------------------------------------------------------------ 2. Save to Pipeline

const writer = node(WRITER_NODE);
if (!writer) { fail.push('missing node: ' + WRITER_NODE); }

if (writer) {
  const cols = writer.parameters.columns;
  if (cols.mappingMode !== 'defineBelow') {
    fail.push(WRITER_NODE + ': mapping mode is ' + cols.mappingMode + ', not defineBelow — refusing to touch it');
  } else if (NEW_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(cols.value, f))) {
    fail.push(WRITER_NODE + ': the premium columns are already mapped — this delta has been applied');
  } else {
    for (const f of NEW_FIELDS) {
      cols.value[f] = '={{$json.' + f + '}}';
      cols.schema.push({
        id: f, displayName: f, required: false, defaultMatch: false,
        display: true, type: 'string', canBeUsedToMatch: true
      });
    }
  }
}

// ------------------------------------------------------------------ 3. Invariants, on the output

const liveNodes = baseNodes;
const CHANGED = [ROW_NODE, WRITER_NODE];

if (candidate.nodes.length !== liveNodes.length) {
  fail.push('node count moved: ' + liveNodes.length + ' -> ' + candidate.nodes.length);
}
if (JSON.stringify(candidate.connections) !== JSON.stringify(live.connections)) {
  fail.push('the connection graph changed — this delta must not rewire anything');
}

// Every node that is NOT one of the two must be byte-identical.
const drift = [];
for (const n of candidate.nodes) {
  if (CHANGED.indexOf(n.name) !== -1) { continue; }
  const was = liveNodes.find((x) => x.name === n.name);
  if (!was) { drift.push(n.name + ' (new)'); continue; }
  if (JSON.stringify(n) !== JSON.stringify(was)) { drift.push(n.name); }
}
if (drift.length) { fail.push('UNRELATED DRIFT in ' + drift.length + ' node(s): ' + drift.slice(0, 8).join(', ')); }

// The two changed nodes must have changed ONLY where intended.
if (row) {
  const was = liveNodes.find((x) => x.name === ROW_NODE);
  const a = Object.assign({}, was, { parameters: Object.assign({}, was.parameters, { jsCode: null }) });
  const b = Object.assign({}, row, { parameters: Object.assign({}, row.parameters, { jsCode: null }) });
  if (JSON.stringify(a) !== JSON.stringify(b)) { fail.push(ROW_NODE + ': something other than jsCode changed'); }
  for (const f of NEW_FIELDS) {
    if (row.parameters.jsCode.indexOf(f + ': pick(item.' + f + ')') === -1) { fail.push(ROW_NODE + ': ' + f + ' not projected'); }
  }
}
if (writer) {
  const was = liveNodes.find((x) => x.name === WRITER_NODE);
  const keysWas = Object.keys(was.parameters.columns.value);
  const keysNow = Object.keys(writer.parameters.columns.value);
  if (keysNow.length !== keysWas.length + 3) { fail.push(WRITER_NODE + ': expected exactly 3 new mapped keys, got ' + (keysNow.length - keysWas.length)); }
  for (const k of keysWas) {
    if (writer.parameters.columns.value[k] !== was.parameters.columns.value[k]) { fail.push(WRITER_NODE + ': existing mapping changed: ' + k); }
  }
  if (writer.parameters.columns.mappingMode !== 'defineBelow') { fail.push(WRITER_NODE + ': mapping mode is no longer defineBelow'); }
  if (writer.parameters.operation !== was.parameters.operation) { fail.push(WRITER_NODE + ': operation changed'); }
}

// The P9-R2 / P9-R4 flag pair, checked across the whole candidate rather than the delta: a
// regression anywhere in 102 nodes is still a regression this artifact would carry.
for (const n of candidate.nodes) {
  if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') {
    fail.push('P9-R2 FLAG PAIR on node: ' + n.name);
  }
}

// No production identifier may reach a tracked artifact.
const text = JSON.stringify(candidate);
for (const leak of ['cachedResultUrl', 'activeVersion', 'versionId', 'shared', 'pinData']) {
  if (text.indexOf('"' + leak + '"') !== -1) { fail.push('leaked key in the candidate: ' + leak); }
}

// ------------------------------------------------------------------ 4. Emit, or refuse

if (fail.length) {
  console.error('');
  console.error('REFUSING TO WRITE the Lead Intake projection candidate:');
  for (const f of fail) { console.error('  - ' + f); }
  console.error('');
  process.exit(1);
}

const liveForHash = { nodes: baseNodes, connections: live.connections };
const structural = (w) => crypto.createHash('sha256').update(JSON.stringify({
  n: w.nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null, n.alwaysOutputData || null]),
  c: w.connections
})).digest('hex');

const json = JSON.stringify(candidate, null, 2) + '\n';
writeFileSync(OUT, json, 'utf8');

console.log('');
console.log('Lead Intake premium projection candidate');
console.log('  source (live)      : ' + live.name + '  (' + liveNodes.length + ' nodes)');
console.log('  display caches     : ' + cachesStripped + ' stripped (cachedResultUrl / cachedResultName)');
console.log('  out                : n8n/candidate/lead-intake-premium-projection-candidate.json');
console.log('  nodes changed      : ' + CHANGED.join(', ') + '   (2 of ' + liveNodes.length + ')');
console.log('  columns projected  : ' + NEW_FIELDS.join(', '));
console.log('  mapping mode       : defineBelow (unchanged)');
console.log('  connections        : identical');
console.log('  unrelated drift    : NONE');
console.log('  P9-R2 flag pair    : ABSENT across all ' + candidate.nodes.length + ' nodes');
console.log('');
console.log('  structural sha256  : ' + structural(liveForHash));
console.log('    (identical before and after — this delta adds no node and no edge)');
console.log('  candidate sha256   : ' + crypto.createHash('sha256').update(json).digest('hex'));
console.log('');
