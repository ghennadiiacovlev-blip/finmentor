#!/usr/bin/env node
// FINMENTOR — P9-R4: the minimal remediation for the confirmed Lead Intake dedup fail-open.
//
//   node scripts/build-lead-intake-dedup-remediation.mjs
//
// REPO-ONLY. Emits n8n/candidate/lead-intake-dedup-fix-candidate.json and prints the
// field-level diff against the tracked production export. It never contacts n8n.
//
// ============================== THE DEFECT ==============================
//
// Confirmed live in P9-R3 (docs/P9_R3_LEAD_INTAKE_DEDUP_OUTAGE_PROOF.md). `Read Pipeline
// (Dedup)` carried `alwaysOutputData: true` with `onError: 'continueErrorOutput'`. A Sheets
// failure therefore emitted on BOTH outputs: the error item on output 1, and a synthetic `{}` on
// output 0. `Dedup Guard` filtered the synthetic item away, `rows` became `[]`, the verdict was
// `new`, and the execution reached `Save to Pipeline` — a write. `Respond New Lead` won the race
// against `Respond Infra Failed`, so the caller received `{"ok":true,"mode":"new"}` at HTTP 200.
//
// ============================== WHY THIS SHAPE OF FIX ==============================
//
// Two measured facts ruled out every cheaper option:
//
//   1. The output-0 item on failure was BYTE-IDENTICAL to the legitimately-empty-read item
//      (`{"json":{},"pairedItem":[{"item":0,"input":0}]}`), so no check on Dedup Guard's input
//      could distinguish them while the error lived on a separate output.
//   2. The success branch ran to COMPLETION before the error branch started, so no cross-branch
//      lookup, and no "Stop: CRM Unavailable will get there first" argument, could work.
//
// scripts/probe-n8n-error-output-semantics.mjs then measured the alternative directly, on a
// four-node disposable workflow:
//
//   onError                  throw -> outputs   output 0 receives
//   continueErrorOutput      [1, 1]             {}                      <- indistinguishable
//   continueRegularOutput    [1]                { error: <message> }    <- distinguishable
//
// Under `continueRegularOutput` the error item REPLACES the synthetic one, and there is only one
// branch — so no race, no second responder, no parallel write path, structurally rather than by
// ordering luck. `alwaysOutputData` stays, because it is still what lets a legitimately EMPTY
// Pipeline sheet yield an item instead of stalling the graph; it simply can no longer manufacture
// a success item on a failure.
//
// ============================== THE MINIMAL DELTA ==============================
//
// Two nodes and two connections. Nothing else in the 102-node graph is touched.
//
//   Read Pipeline (Dedup)   onError: continueErrorOutput -> continueRegularOutput
//                           alwaysOutputData: unchanged (still true, and still required)
//                           parameters: unchanged
//   Dedup Guard             jsCode: v2 -> v3 (the read verdict, from the canonical source file)
//                           onError: (absent) -> continueErrorOutput
//                           alwaysOutputData: unchanged (still absent — a throw must yield no item)
//   connections             Read Pipeline (Dedup) main[1] -> IF Internal (Infra)   REMOVED
//                           Dedup Guard          main[1] -> IF Internal (Infra)   ADDED
//
// The error contract itself is NOT changed: `IF Internal (Infra)`, `Respond Infra Failed`
// (numeric 503, CRM_UNAVAILABLE, retryable: true), `Internal Result (Infra)` and
// `Stop: CRM Unavailable` are production's own nodes, untouched. The fix routes to the contract
// that already existed and never ran alone.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');
const GUARD_SRC = join(ROOT, 'n8n', 'src', 'lead-intake', 'dedup-guard.js');
const OUT = join(ROOT, 'n8n', 'candidate', 'lead-intake-dedup-fix-candidate.json');

export const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
export const DEDUP_NODE = 'Read Pipeline (Dedup)';
export const GUARD_NODE = 'Dedup Guard';
export const INFRA_NODE = 'IF Internal (Infra)';
export const WRITE_NODE = 'Save to Pipeline';

// The only nodes and connection endpoints this remediation may touch.
export const TOUCHED_NODES = [DEDUP_NODE, GUARD_NODE];

const clone = (x) => JSON.parse(JSON.stringify(x));
const lf = (s) => s.replace(/\r\n/g, '\n');

// The canonical Dedup Guard source. qa/lead-intake-trust.test.mjs binds this file to the
// deployed node, so the fix is authored there and spliced here rather than written twice.
export function guardSource() { return lf(readFileSync(GUARD_SRC, 'utf8')).replace(/\n+$/, '\n').replace(/\n$/, ''); }

export function remediate(wf) {
  const out = clone(wf);
  const byName = (n) => out.nodes.find((x) => x.name === n);

  const read = byName(DEDUP_NODE);
  if (!read) { throw new Error('the graph has no node named ' + DEDUP_NODE); }
  if (read.onError !== 'continueErrorOutput') {
    throw new Error(DEDUP_NODE + ' is not in the pre-remediation state (onError=' + read.onError + ')');
  }
  if (read.alwaysOutputData !== true) {
    throw new Error(DEDUP_NODE + ' no longer carries alwaysOutputData; the empty-sheet case would stall');
  }
  read.onError = 'continueRegularOutput';

  const guard = byName(GUARD_NODE);
  if (!guard) { throw new Error('the graph has no node named ' + GUARD_NODE); }
  if (guard.alwaysOutputData === true) {
    throw new Error(GUARD_NODE + ' carries alwaysOutputData; a throw there would still emit a success item');
  }
  guard.parameters = Object.assign({}, guard.parameters, { jsCode: guardSource() });
  guard.onError = 'continueErrorOutput';

  // The read no longer has an error output; the guard does.
  const c = out.connections;
  if (!c[DEDUP_NODE] || c[DEDUP_NODE].main.length !== 2) {
    throw new Error(DEDUP_NODE + ' does not have the expected two outputs');
  }
  const infraTarget = c[DEDUP_NODE].main[1];
  if (!infraTarget || !infraTarget.length || infraTarget[0].node !== INFRA_NODE) {
    throw new Error(DEDUP_NODE + ' error output does not currently go to ' + INFRA_NODE);
  }
  c[DEDUP_NODE] = { main: [c[DEDUP_NODE].main[0]] };
  if (!c[GUARD_NODE] || c[GUARD_NODE].main.length !== 1) {
    throw new Error(GUARD_NODE + ' does not have the expected single output');
  }
  c[GUARD_NODE] = { main: [c[GUARD_NODE].main[0], clone(infraTarget)] };

  return out;
}

// ---------------------------------------------------------------- field-level diff

const EXECUTABLE_FIELDS = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled',
  'webhookId', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData',
  'continueOnFail', 'executeOnce'];

export function diff(before, after) {
  const changes = [];
  const bn = {}; for (const n of before.nodes) { bn[n.name] = n; }
  const an = {}; for (const n of after.nodes) { an[n.name] = n; }

  for (const name of new Set([...Object.keys(bn), ...Object.keys(an)])) {
    if (!bn[name]) { changes.push({ node: name, field: '(node)', from: '(absent)', to: '(added)' }); continue; }
    if (!an[name]) { changes.push({ node: name, field: '(node)', from: '(present)', to: '(removed)' }); continue; }
    for (const f of EXECUTABLE_FIELDS) {
      const b = JSON.stringify(bn[name][f] ?? null);
      const a = JSON.stringify(an[name][f] ?? null);
      if (b !== a) {
        changes.push({
          node: name, field: f,
          from: f === 'parameters' ? '(' + b.length + ' bytes)' : b,
          to: f === 'parameters' ? '(' + a.length + ' bytes)' : a
        });
      }
    }
  }
  for (const name of new Set([...Object.keys(before.connections), ...Object.keys(after.connections)])) {
    const b = JSON.stringify(before.connections[name] ?? null);
    const a = JSON.stringify(after.connections[name] ?? null);
    if (b !== a) { changes.push({ node: name, field: 'connections', from: b, to: a }); }
  }
  const bs = JSON.stringify(before.settings ?? null);
  const as = JSON.stringify(after.settings ?? null);
  if (bs !== as) { changes.push({ node: '(workflow)', field: 'settings', from: bs, to: as }); }
  if (before.name !== after.name) { changes.push({ node: '(workflow)', field: 'name', from: before.name, to: after.name }); }
  return changes;
}

// The diff must contain ONLY the minimum remediation. Anything else is drift and must stop a
// deploy rather than ride along with it.
export function verifyDiff(changes) {
  const f = [];
  const allowed = new Set([
    DEDUP_NODE + '|onError',
    GUARD_NODE + '|parameters',
    GUARD_NODE + '|onError',
    DEDUP_NODE + '|connections',
    GUARD_NODE + '|connections'
  ]);
  for (const c of changes) {
    const key = c.node + '|' + c.field;
    if (!allowed.has(key)) { f.push('UNEXPECTED CHANGE: ' + c.node + '.' + c.field + '  ' + c.from + ' -> ' + c.to); }
  }
  for (const key of allowed) {
    if (!changes.some((c) => c.node + '|' + c.field === key)) { f.push('MISSING CHANGE: ' + key.replace('|', '.')); }
  }
  return { ok: f.length === 0, failures: f };
}

// Absolute invariants on the remediated graph alone. A comparative check cannot see a defect
// present on both sides — the P7.5 lesson, carried over from the materializer.
export function verifyRemediated(wf) {
  const f = [];
  const byName = (n) => wf.nodes.find((x) => x.name === n);
  const read = byName(DEDUP_NODE);
  const guard = byName(GUARD_NODE);

  if (!read || read.onError !== 'continueRegularOutput') { f.push('the dedup read does not route its failure to the regular output'); }
  if (!read || read.alwaysOutputData !== true) { f.push('the dedup read lost alwaysOutputData; an empty Pipeline sheet would stall'); }
  if (!guard || guard.onError !== 'continueErrorOutput') { f.push('Dedup Guard does not route its error output'); }
  if (guard && guard.alwaysOutputData === true) { f.push('Dedup Guard carries alwaysOutputData; a throw would still emit a success item'); }

  // No node anywhere may carry the defect pair again.
  const pair = wf.nodes.filter((n) => n.alwaysOutputData === true && n.onError === 'continueErrorOutput');
  if (pair.length) { f.push('the P9-R2 flag pair is present on: ' + pair.map((n) => n.name).join(', ')); }

  // The read must have exactly one output, and it must lead to the guard.
  const rc = wf.connections[DEDUP_NODE];
  if (!rc || rc.main.length !== 1) { f.push('the dedup read still has a second output'); }
  else if ((rc.main[0][0] || {}).node !== GUARD_NODE) { f.push('the dedup read does not feed ' + GUARD_NODE); }

  // The guard must carry the error contract.
  const gc = wf.connections[GUARD_NODE];
  if (!gc || gc.main.length !== 2) { f.push('Dedup Guard does not have both outputs wired'); }
  else if ((gc.main[1][0] || {}).node !== INFRA_NODE) { f.push('Dedup Guard error output does not go to ' + INFRA_NODE); }

  // The guard's code must actually fail closed, and must still be the canonical source.
  const code = (guard && guard.parameters.jsCode) || '';
  if (code.indexOf('DEDUP_READ_FAULT') === -1) { f.push('Dedup Guard does not fail closed on a faulted read'); }
  if (code.indexOf('PIPELINE_FIELDS') === -1) { f.push('Dedup Guard has no positive row classification'); }
  if (lf(code) !== guardSource()) { f.push('Dedup Guard is not byte-identical to n8n/src/lead-intake/dedup-guard.js'); }

  // The response contract must be untouched.
  const resp = byName('Respond Infra Failed');
  if (!resp || resp.parameters.options.responseCode !== 503) { f.push('Respond Infra Failed is not a numeric 503'); }
  if (!resp || String(resp.parameters.responseBody).indexOf('CRM_UNAVAILABLE') === -1) { f.push('Respond Infra Failed lost its error_code'); }
  if (!resp || String(resp.parameters.responseBody).indexOf('retryable: true') === -1) { f.push('Respond Infra Failed lost retryable: true'); }

  return { ok: f.length === 0, failures: f };
}

function serialize(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

const isMain = process.argv[1] && process.argv[1].endsWith('build-lead-intake-dedup-remediation.mjs');
if (isMain) {
  const before = JSON.parse(readFileSync(SRC, 'utf8'));
  // Deploy only the four fields the update schema accepts; an export also carries an
  // `activeVersion` blob, a full second copy of the graph (P9-R3).
  const base = { name: before.name, nodes: before.nodes, connections: before.connections, settings: before.settings };

  // IDEMPOTENT ACROSS THE DEPLOY BOUNDARY. Once the fix is live the tracked export IS the
  // remediated graph, and remediate() correctly refuses to apply twice. The candidate must still
  // be reproducible and still be checked, so in that state the export's own deployable fields
  // ARE the candidate and only the absolute invariants apply — there is no longer a delta to
  // verify, because it is already in the baseline.
  const readNode = base.nodes.find((n) => n.name === DEDUP_NODE);
  const alreadyFixed = readNode && readNode.onError === 'continueRegularOutput';
  const after = alreadyFixed ? base : remediate(base);

  console.log('P9-R4 Lead Intake dedup fail-open — minimal remediation');
  console.log('');
  if (alreadyFixed) {
    console.log('The tracked export is ALREADY the remediated graph, so there is no delta to show.');
    console.log('The candidate is reproduced from it and re-checked against the absolute invariants.');
    console.log('');
  } else {
    const changes = diff(base, after);
    const dv = verifyDiff(changes);
    console.log('FIELD-LEVEL DIFF vs the tracked production export:');
    console.log('');
    for (const c of changes) {
      console.log('  ' + c.node);
      console.log('    ' + c.field + ':');
      console.log('      from ' + c.from);
      console.log('      to   ' + c.to);
    }
    console.log('');
    console.log('  total changes: ' + changes.length + '  (nodes touched: ' + TOUCHED_NODES.join(', ') + ')');
    console.log('  nodes unchanged: ' + (base.nodes.length - TOUCHED_NODES.length) + ' of ' + base.nodes.length);
    console.log('');
    if (!dv.ok) { console.error('REFUSING TO WRITE: the diff is not the minimum remediation.'); dv.failures.forEach((x) => console.error('  - ' + x)); process.exit(1); }
    console.log('  diff verification      : PASS (only the declared changes, and all of them)');
  }

  const rv = verifyRemediated(after);
  if (!rv.ok) { console.error('REFUSING TO WRITE: the remediated graph fails its absolute invariants.'); rv.failures.forEach((x) => console.error('  - ' + x)); process.exit(1); }

  writeFileSync(OUT, serialize(after), 'utf8');
  console.log('  absolute invariants    : PASS');
  console.log('  flag pair anywhere     : ABSENT');
  console.log('  candidate              : n8n/candidate/lead-intake-dedup-fix-candidate.json');
}
