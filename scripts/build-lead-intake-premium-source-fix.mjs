#!/usr/bin/env node
// FINMENTOR — Pipeline BP/BQ/BR: give the projection a source. ONE NODE.
//
//   node scripts/build-lead-intake-premium-source-fix.mjs --live <live-export.json>
//
// REPO-ONLY. Emits n8n/candidate/lead-intake-premium-source-candidate.json and never contacts n8n.
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────────
//
// The BP/BQ/BR contract was built in two halves and only one of them was written.
//
//   CONSUMER (live, deployed 2026-08-29):  Build Pipeline Row returns
//                                            current_setup:    pick(item.current_setup)
//                                            decision_horizon: pick(item.decision_horizon)
//                                            important_context: pick(item.important_context)
//                                          and Save to Pipeline maps all three, defineBelow,
//                                          with schema entries, into headers that exist.
//
//   PRODUCER:                              nothing. `Normalize + Score Lead` never lifts
//                                          `payload.premium.*` onto the item — the string
//                                          "premium" does not appear in it at all.
//
// So `item.current_setup` is undefined on every lead that has ever run, `pick` normalises it to
// '', and three empty cells are written. Measured on the real Mini App lead FIN-1788113619104-582:
// the payload carried «Excel / ручные отчёты; План-факт; CFO / финансовая команда» and «2–4 недели»,
// and the row got ''. The values were never lost in transit — they were never read.
//
// ── THE FIX, AND WHY IT IS IN THIS NODE ────────────────────────────────────────────────────────
//
// `Build Pipeline Row` ALREADY parses `item.raw_json` — defensively, in one line, to recover the
// attribution `meta` that normalize preserved verbatim. `premium` sits in the same blob, put there
// by the same normalize step. So the source is already in this node's hand; it simply was not read.
//
// The alternative was to teach `Normalize + Score Lead` to lift three fields. That is an 18 KB
// node feeding dedup, scoring, routing, the alerts and the AI plan — every consumer in the
// workflow. Reading a field that is already present, in the node that already parses the blob it
// is present in, changes one node and can affect nothing else.
//
//   before  const __meta = (function () { try { return JSON.parse(item.raw_json || '{}').meta || {}; } catch (e) { return {}; } })();
//   after   the parse is hoisted once, __meta reads from it unchanged, and __premium joins it
//
//   before  current_setup: pick(item.current_setup)
//   after   current_setup: pick(__premium.current_setup, item.current_setup)
//
// `item.*` is kept as the second source so a future normalize that DOES lift them keeps working,
// and so a lead that never went through the Mini App still writes '' rather than a hole.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. Exactly one node may differ: Build Pipeline Row. Every other node byte-identical.
//   2. Connections and settings byte-identical — no node added, removed, renamed or rewired.
//   3. `Save to Pipeline` must still be `append` + `defineBelow` with the same 62 keys. F16:
//      autoMapInputData appends a column per unknown key, and it widened this workbook twice.
//   4. No node may gain `alwaysOutputData` beside `continueErrorOutput` (P9-R2).
//   5. The merge path must not learn the three keys — see the gate.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-source-candidate.json');

export const ROW_NODE = 'Build Pipeline Row';
export const WRITER_NODE = 'Save to Pipeline';
export const MERGE_BUILDER = 'Build Merge Update';
export const MERGE_WRITER = 'Update Pipeline (Merge)';
export const NEW_FIELDS = ['current_setup', 'decision_horizon', 'important_context'];

export const META_BEFORE =
  "const __meta = (function () { try { return JSON.parse(item.raw_json || '{}').meta || {}; } catch (e) { return {}; } })();";

export const META_AFTER = [
  "const __payload = (function () { try { return JSON.parse(item.raw_json || '{}'); } catch (e) { return {}; } })();",
  "const __meta = (__payload.meta && typeof __payload.meta === 'object') ? __payload.meta : {};",
  '',
  '// --- Premium UX projection SOURCE (Pipeline BP:BR) ---',
  '// The three columns were added on 2026-08-29 reading item.current_setup and friends. Nothing',
  '// ever set them: normalize does not lift payload.premium onto the item, so every lead since has',
  '// written three empty cells. The values were always here, in the same blob the attribution meta',
  '// above is read from. Fall back to item.* so a normalize that lifts them later still wins, and',
  '// so a lead that never saw the Premium Mini App writes \'\' rather than a hole.',
  "const __premium = (__payload.premium && typeof __payload.premium === 'object') ? __payload.premium : {};"
].join('\n');

export const FIELD_REWRITES = NEW_FIELDS.map((f) => [
  'pick(item.' + f + ')',
  'pick(__premium.' + f + ', item.' + f + ')'
]);

// Same sanitisation as the projection builder: a live export carries cachedResultUrl, which is the
// production spreadsheet URL, and a tracked artifact must not.
export function sanitize(v) {
  if (!v || typeof v !== 'object') { return v; }
  if (Array.isArray(v)) { return v.map(sanitize); }
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; }
    out[k] = sanitize(v[k]);
  }
  return out;
}

// Applies the delta to one live export. Exported so the gate can build and execute it without
// shelling out, and so the gate is testing this function rather than a copy of its intent.
export function buildCandidate(live) {
  const fail = [];
  const candidate = {
    name: '[CANDIDATE] ' + live.name + ' — Pipeline BP/BQ/BR source fix',
    nodes: sanitize(JSON.parse(JSON.stringify(live.nodes))),
    connections: JSON.parse(JSON.stringify(live.connections)),
    settings: JSON.parse(JSON.stringify(live.settings || {}))
  };
  const row = candidate.nodes.find((n) => n.name === ROW_NODE);
  if (!row) { return { fail: ['missing node: ' + ROW_NODE], candidate: null }; }

  let js = String(row.parameters.jsCode || '');

  if (js.indexOf('__premium') !== -1) { fail.push(ROW_NODE + ': the delta has already been applied'); }
  if (js.indexOf(META_BEFORE) === -1) {
    fail.push(ROW_NODE + ': the attribution parse is not the line this delta knows; do not splice blindly');
  } else {
    js = js.replace(META_BEFORE, () => META_AFTER);
  }
  for (const [before, after] of FIELD_REWRITES) {
    if (js.indexOf(before) === -1) { fail.push(ROW_NODE + ': field read not found: ' + before); continue; }
    if (js.indexOf(before, js.indexOf(before) + 1) !== -1) { fail.push(ROW_NODE + ': ambiguous field read: ' + before); continue; }
    js = js.replace(before, () => after);
  }
  row.parameters.jsCode = js;

  // ── invariants, on the OUTPUT rather than on intent ──────────────────────────────────────────
  const base = sanitize(JSON.parse(JSON.stringify(live.nodes)));
  const differing = candidate.nodes.filter((n, i) => JSON.stringify(n) !== JSON.stringify(base[i]));
  if (differing.length !== 1 || differing[0].name !== ROW_NODE) {
    fail.push('exactly one node may differ; got: ' + (differing.map((n) => n.name).join(', ') || 'none'));
  }
  if (JSON.stringify(candidate.connections) !== JSON.stringify(live.connections)) { fail.push('connections changed'); }
  if (JSON.stringify(candidate.settings) !== JSON.stringify(live.settings || {})) { fail.push('settings changed'); }
  if (candidate.nodes.length !== live.nodes.length) { fail.push('node count changed'); }

  const writer = candidate.nodes.find((n) => n.name === WRITER_NODE);
  if (!writer) { fail.push('missing node: ' + WRITER_NODE); }
  else {
    const cols = writer.parameters.columns || {};
    if (writer.parameters.operation !== 'append') { fail.push(WRITER_NODE + ' is no longer an append'); }
    if (cols.mappingMode !== 'defineBelow') { fail.push(WRITER_NODE + ' left defineBelow — F16 would append a column per unknown key'); }
    for (const f of NEW_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(cols.value || {}, f)) { fail.push(WRITER_NODE + ' does not map ' + f); }
    }
  }
  // The merge path must stay ignorant of these keys: its writer is autoMapInputData, so a key that
  // appeared in its builder's output would write a column on every merge.
  const mergeBuilder = candidate.nodes.find((n) => n.name === MERGE_BUILDER);
  if (mergeBuilder) {
    const mjs = String(mergeBuilder.parameters.jsCode || '');
    for (const f of NEW_FIELDS) {
      if (mjs.indexOf(f) !== -1) { fail.push(MERGE_BUILDER + ' now mentions ' + f + ' — it feeds an autoMap writer'); }
    }
  }
  for (const n of candidate.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') {
      fail.push('P9-R2 flag pair on ' + n.name);
    }
  }
  return { fail, candidate };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-lead-intake-premium-source-fix.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const livePath = args[args.indexOf('--live') + 1];
  if (args.indexOf('--live') === -1 || !livePath || livePath.startsWith('--')) {
    console.error('usage: node scripts/build-lead-intake-premium-source-fix.mjs --live <live-export.json>');
    process.exit(1);
  }
  const live = JSON.parse(readFileSync(livePath, 'utf8'));
  const { fail, candidate } = buildCandidate(live);
  const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

  console.log('');
  console.log('Lead Intake — Pipeline BP/BQ/BR source fix');
  console.log('='.repeat(78));
  console.log('  live nodes        : ' + live.nodes.length);
  if (fail.length) {
    console.error('\nREFUSING — the delta is not safe:');
    for (const f of fail) { console.error('  FAIL  ' + f); }
    process.exit(1);
  }
  const row = candidate.nodes.find((n) => n.name === ROW_NODE);
  console.log('  node changed      : ' + ROW_NODE + ' (and only it)');
  console.log('  reads now         : ' + NEW_FIELDS.map((f) => '__premium.' + f).join(', '));
  console.log('  writer            : append + defineBelow, all three mapped');
  console.log('  merge builder     : does not mention the three keys');
  console.log('  candidate sha     : ' + sha(candidate).slice(0, 32));
  console.log('  jsCode bytes      : ' + String(row.parameters.jsCode).length);
  writeFileSync(OUT, JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  console.log('  written           : ' + OUT);
  console.log('');
}
