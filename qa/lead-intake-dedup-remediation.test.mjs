#!/usr/bin/env node
// FINMENTOR — P9-R4: the Lead Intake dedup fail-open remediation.
//
//   node qa/lead-intake-dedup-remediation.test.mjs
//
// Offline. No tenant, no network, no Google, no credentials.
//
// WHAT THIS GATE IS FOR. Three things, and the third is the one that matters most in six months.
//
//   1. THE TRANSFORM IS MINIMAL. Applied to the pre-fix graph — the real one, saved to
//      n8n/history/ at deploy time — the remediation produces EXACTLY five field changes across
//      exactly two nodes, and the result is what is actually deployed today.
//   2. THE INVARIANTS HOLD, and the checker that asserts them can REJECT. Every invariant is
//      mutated and the verifier must refuse. P9-R1 is the standing reason: a gate that cannot
//      reject the bad form is decoration.
//   3. THE DEPLOYED CLASSIFICATION LOGIC IS TESTED DIRECTLY. The fail-closed prologue of
//      `Dedup Guard` is executed here, from the canonical source file that is byte-identical to
//      the live node, against the exact item shapes n8n was MEASURED to produce
//      (scripts/probe-n8n-error-output-semantics.mjs). This is the part a future edit is most
//      likely to break silently, because the harness that would catch it costs a live deploy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  remediate, diff, verifyDiff, verifyRemediated, guardSource,
  DEDUP_NODE, GUARD_NODE, INFRA_NODE, WRITE_NODE, TOUCHED_NODES
} from '../scripts/build-lead-intake-dedup-remediation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const clone = (x) => JSON.parse(JSON.stringify(x));

const BEFORE_FULL = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history', 'QmIyEW2ZEqKregmN.pre-p9r4-dedup-fix.json'), 'utf8'));
const DEPLOYED = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
const BEFORE = { name: BEFORE_FULL.name, nodes: BEFORE_FULL.nodes, connections: BEFORE_FULL.connections, settings: BEFORE_FULL.settings };
const AFTER = remediate(BEFORE);
const nodeOf = (wf, n) => wf.nodes.find((x) => x.name === n);

console.log('P9-R4 Lead Intake dedup fail-open remediation');
console.log('');

// ---------------------------------------------------------------- the before state

check('the history file really is the pre-fix graph', () => {
  const d = nodeOf(BEFORE, DEDUP_NODE);
  assert(d, DEDUP_NODE + ' is absent from the history file');
  eq(d.alwaysOutputData, true, 'pre-fix dedup read lacks alwaysOutputData');
  eq(d.onError, 'continueErrorOutput', 'pre-fix dedup read lacks continueErrorOutput');
  eq(BEFORE.connections[DEDUP_NODE].main.length, 2, 'pre-fix dedup read does not have two outputs');
  eq(BEFORE.connections[DEDUP_NODE].main[1][0].node, INFRA_NODE, 'pre-fix error output did not go to ' + INFRA_NODE);
  assert(!nodeOf(BEFORE, GUARD_NODE).onError, 'pre-fix ' + GUARD_NODE + ' already routed an error output');
});

// ---------------------------------------------------------------- minimality

check('the transform changes exactly five fields across exactly two nodes', () => {
  const changes = diff(BEFORE, AFTER);
  eq(changes.length, 5, 'unexpected change count: ' + changes.map((c) => c.node + '.' + c.field).join(', '));
  const nodes = [...new Set(changes.map((c) => c.node))].sort();
  eq(JSON.stringify(nodes), JSON.stringify(TOUCHED_NODES.slice().sort()), 'unexpected nodes touched');
  const v = verifyDiff(changes);
  assert(v.ok, 'verifyDiff rejected the real diff: ' + v.failures.join('; '));
});

check('every other node is byte-identical to the pre-fix graph', () => {
  for (const b of BEFORE.nodes) {
    if (TOUCHED_NODES.indexOf(b.name) !== -1) { continue; }
    const a = nodeOf(AFTER, b.name);
    assert(a, 'node vanished: ' + b.name);
    eq(JSON.stringify(a), JSON.stringify(b), 'untouched node was modified: ' + b.name);
  }
  eq(AFTER.nodes.length, BEFORE.nodes.length, 'node count changed');
  eq(AFTER.settings ? JSON.stringify(AFTER.settings) : null, JSON.stringify(BEFORE.settings), 'settings changed');
});

check('the transform result is what is DEPLOYED today', () => {
  // The gate would otherwise prove a transform nobody is running.
  for (const a of AFTER.nodes) {
    const d = nodeOf(DEPLOYED, a.name);
    assert(d, 'deployed graph is missing node: ' + a.name);
    eq(JSON.stringify(d.parameters), JSON.stringify(a.parameters), 'deployed parameters differ on ' + a.name);
    eq(d.onError ?? null, a.onError ?? null, 'deployed onError differs on ' + a.name);
    eq(d.alwaysOutputData === true, a.alwaysOutputData === true, 'deployed alwaysOutputData differs on ' + a.name);
  }
  eq(JSON.stringify(DEPLOYED.connections), JSON.stringify(AFTER.connections), 'deployed connections differ from the transform');
});

check('the remediation refuses to be applied twice', () => {
  let threw = false;
  try { remediate(AFTER); } catch (e) { threw = true; }
  assert(threw, 'remediate() applied itself to an already-remediated graph');
});

// ---------------------------------------------------------------- the invariants

check('the remediated graph satisfies its absolute invariants', () => {
  const v = verifyRemediated(AFTER);
  assert(v.ok, v.failures.join('; '));
});

check('the fail-open flag pair is absent from the whole deployed graph', () => {
  const pair = DEPLOYED.nodes.filter((n) => n.alwaysOutputData === true && n.onError === 'continueErrorOutput');
  eq(pair.length, 0, 'the pair is present on: ' + pair.map((n) => n.name).join(', '));
});

check('the guard source is byte-identical to the deployed node', () => {
  const lf = (s) => s.replace(/\r\n/g, '\n');
  eq(lf(nodeOf(DEPLOYED, GUARD_NODE).parameters.jsCode), guardSource(),
    'n8n/src/lead-intake/dedup-guard.js has drifted from the deployed Dedup Guard');
});

check('the 503 CRM_UNAVAILABLE contract is untouched by the remediation', () => {
  for (const [label, wf] of [['pre-fix', BEFORE], ['deployed', DEPLOYED]]) {
    const r = nodeOf(wf, 'Respond Infra Failed');
    eq(r.parameters.options.responseCode, 503, label + ' Respond Infra Failed is not a numeric 503');
    assert(String(r.parameters.responseBody).indexOf('CRM_UNAVAILABLE') !== -1, label + ' lost CRM_UNAVAILABLE');
    assert(String(r.parameters.responseBody).indexOf('retryable: true') !== -1, label + ' lost retryable: true');
  }
  // And it is genuinely untouched: identical on both sides of the transform.
  eq(JSON.stringify(nodeOf(AFTER, 'Respond Infra Failed')), JSON.stringify(nodeOf(BEFORE, 'Respond Infra Failed')),
    'the remediation modified the response contract');
});

check('the write path itself is untouched', () => {
  for (const name of [WRITE_NODE, 'Build Pipeline Row', 'IF Is New', INFRA_NODE, 'Stop: CRM Unavailable']) {
    eq(JSON.stringify(nodeOf(AFTER, name)), JSON.stringify(nodeOf(BEFORE, name)), 'the remediation modified ' + name);
  }
});

// ---------------------------------------------------------------- the verifier must REJECT

function mustReject(name, mutate) {
  check('REJECTS: ' + name, () => {
    const wf = clone(AFTER);
    mutate(wf);
    const v = verifyRemediated(wf);
    assert(!v.ok, 'verifyRemediated PASSED a broken graph');
  });
}

mustReject('the read goes back to a separate error output', (wf) => { nodeOf(wf, DEDUP_NODE).onError = 'continueErrorOutput'; });
mustReject('the read loses alwaysOutputData (an empty sheet would stall)', (wf) => { delete nodeOf(wf, DEDUP_NODE).alwaysOutputData; });
mustReject('the guard stops routing its error output', (wf) => { delete nodeOf(wf, GUARD_NODE).onError; });
mustReject('the guard gains alwaysOutputData', (wf) => { nodeOf(wf, GUARD_NODE).alwaysOutputData = true; });
mustReject('the guard stops failing closed', (wf) => {
  nodeOf(wf, GUARD_NODE).parameters.jsCode = 'return $input.all();';
});
mustReject('the guard drifts from its canonical source', (wf) => {
  nodeOf(wf, GUARD_NODE).parameters.jsCode += '\n// DEDUP_READ_FAULT PIPELINE_FIELDS drift';
});
mustReject('the read regains a second output', (wf) => {
  wf.connections[DEDUP_NODE].main.push([{ node: INFRA_NODE, type: 'main', index: 0 }]);
});
mustReject('the guard error output is rewired away from the infra contract', (wf) => {
  wf.connections[GUARD_NODE].main[1] = [{ node: 'Receipt Gate', type: 'main', index: 0 }];
});
mustReject('the response code stops being 503', (wf) => {
  nodeOf(wf, 'Respond Infra Failed').parameters.options.responseCode = 200;
});
mustReject('the response stops being retryable', (wf) => {
  const r = nodeOf(wf, 'Respond Infra Failed');
  r.parameters.responseBody = String(r.parameters.responseBody).replace('retryable: true', 'retryable: false');
});
mustReject('the flag pair reappears on some other node', (wf) => {
  const n = nodeOf(wf, 'Read Settings');
  n.alwaysOutputData = true; n.onError = 'continueErrorOutput';
});

check('REJECTS: a diff carrying an unrelated change', () => {
  const changes = diff(BEFORE, AFTER).concat([{ node: 'Save to Pipeline', field: 'parameters', from: 'a', to: 'b' }]);
  assert(!verifyDiff(changes).ok, 'verifyDiff accepted an unrelated change');
});
check('REJECTS: a diff missing one of the declared changes', () => {
  const changes = diff(BEFORE, AFTER).filter((c) => !(c.node === GUARD_NODE && c.field === 'onError'));
  assert(!verifyDiff(changes).ok, 'verifyDiff accepted an incomplete remediation');
});

// ---------------------------------------------------------------- the deployed classification

// The fail-closed prologue, executed directly. `$input` is the only n8n global it uses, so it
// runs standalone up to the point where the v2 matching logic begins.
const GUARD_CODE = guardSource();
const SPLIT = "const lead = $('Normalize + Score Lead').first().json;";
const PROLOGUE = GUARD_CODE.slice(0, GUARD_CODE.indexOf(SPLIT));

function classify(jsons) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', PROLOGUE + '\nreturn readItems.length;');
  return fn({ all: () => jsons.map((j) => ({ json: j })) });
}
function classifyThrows(jsons) {
  try { classify(jsons); return null; } catch (e) { return e.message; }
}

check('the prologue was actually extracted (the split point still exists)', () => {
  assert(GUARD_CODE.indexOf(SPLIT) > 0, 'the Dedup Guard source no longer contains the split point');
  assert(PROLOGUE.indexOf('DEDUP_READ_FAULT') !== -1, 'the extracted prologue does not contain the fail-closed logic');
});

// These are the exact shapes measured from n8n, not invented ones.
check('A: the empty-sheet marker {} is ACCEPTED (a successful read that matched nothing)', () => {
  eq(classifyThrows([{}]), null, 'the empty marker was rejected; a legitimately empty read would 503');
});
check('B: a Pipeline row is ACCEPTED', () => {
  eq(classifyThrows([{ lead_id: 'L1', email: 'a@b.co' }]), null, 'a real row was rejected');
  eq(classifyThrows([{ lead_id: 'L1' }, { lead_id: 'L2' }]), null, 'multiple real rows were rejected');
});
check('C/D: the n8n error item is REJECTED', () => {
  const m = classifyThrows([{ error: 'The service refused the connection' }]);
  assert(m && m.indexOf('DEDUP_READ_FAULT') === 0, 'the error item was accepted: ' + m);
  assert(m.indexOf('error item') !== -1, 'the message does not identify an error item: ' + m);
});
check('E: an unrecognised item shape is REJECTED', () => {
  const m = classifyThrows([{ unexpected_column: 'x', another: 1 }]);
  assert(m && m.indexOf('DEDUP_READ_FAULT') === 0, 'an unrecognised shape was accepted: ' + m);
  assert(m.indexOf('unrecognised') !== -1, 'the message does not identify an unrecognised shape: ' + m);
});
check('a non-object item is REJECTED', () => {
  assert(classifyThrows(['not an object']), 'a string item was accepted');
  assert(classifyThrows([[1, 2, 3]]), 'an array item was accepted');
  assert(classifyThrows([null]), 'a null item was accepted');
});
check('one bad item among good ones still fails the whole read', () => {
  const m = classifyThrows([{ lead_id: 'L1' }, { error: 'boom' }]);
  assert(m && m.indexOf('DEDUP_READ_FAULT') === 0, 'a mixed batch was accepted: ' + m);
});
check('a row carrying BOTH a recognised field and an error column is treated as a ROW', () => {
  // Deliberate: n8n's failure item carries only `error`. A Pipeline row that happened to have an
  // `error` column must not take the whole intake down, so recognition wins over the error key.
  eq(classifyThrows([{ lead_id: 'L1', error: 'some cell text' }]), null,
    'a real row with an error-named column was treated as a fault');
});
check('no items at all is ACCEPTED (nothing to classify)', () => {
  eq(classifyThrows([]), null, 'an empty item list was rejected');
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
