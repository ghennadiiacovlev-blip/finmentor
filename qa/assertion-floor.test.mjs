#!/usr/bin/env node
// FINMENTOR — the assertion-floor mechanism's own gate.
//
//   node qa/assertion-floor.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. Every other gate in this repo defends some behaviour. This one
// defends the thing that notices when a gate stops defending anything. Until P7.3 step 2 it
// had no test at all, and the consequence was visible: CI carried a hand-maintained duplicate
// of the assertion floor that had drifted 412 assertions behind the real suite, leaving room
// for an entire gate to be emptied without the build going red.
//
// The fix removed the duplicate. This gate is what keeps the surviving mechanism honest, and
// it is deliberately adversarial: a floor checker that cannot fail is worth exactly as much as
// a stale one.
//
// THE END-TO-END PROOF. The unit mutations below exercise evaluateFloors() directly, which
// proves the decision procedure. That is not the same as proving THE BUILD goes red. So this
// gate also spawns qa/run-all.mjs for real against a deliberately-raised baseline, through the
// FINMENTOR_ASSERTION_BASELINE seam, and requires a non-zero exit. That is the claim §10 asked
// for, made end to end rather than by inference.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const F = require(join(HERE, 'assertion-floor.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const BASELINE_PATH = join(HERE, 'assertion-baseline.json');
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

// ---------------------------------------------------------------- the recursion guard
//
// This gate's end-to-end proof spawns qa/run-all.mjs, and run-all.mjs runs this gate. Without
// a base case that is an infinite regress -- discovered the honest way, by writing it and
// watching it never terminate.
//
// The nested invocation reports its recorded floor and exits. That keeps the OUTER claim
// intact: the spawned run-all still executes every OTHER gate for real, still totals them, and
// still has to fail against the raised baseline. Only this one gate is short-circuited, and it
// is short-circuited to the value that makes the outer arithmetic honest rather than to
// something flattering.
if (process.env.FINMENTOR_FLOOR_NESTED === '1') {
  const own = BASELINE.gates['assertion-floor.test.mjs'];
  console.log('  (nested invocation: recursion guard -- see qa/assertion-floor.test.mjs)');
  console.log('PASS  ' + own + ' checks passed, 0 failed');
  process.exit(0);
}
const RUN_ALL = readFileSync(join(HERE, 'run-all.mjs'), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));

// A synthetic run that exactly meets the recorded floors. Every mutation below starts here, so
// each one changes exactly one thing.
const atFloor = () => Object.keys(BASELINE.gates).map((file) => ({ file, assertions: BASELINE.gates[file] }));

// ================================================================ 1. the baseline itself

console.log('\n-- the recorded baseline is coherent --');

check('the baseline is self-consistent: total equals the sum of the per-gate floors', () => {
  const v = F.baselineIsSelfConsistent(BASELINE);
  assert(v.ok, v.reason);
});

check('every gate in the runner has a recorded floor, and no floor is orphaned', () => {
  // Parsed out of the runner's GATES table rather than duplicated here, so this cannot drift.
  const files = [...RUN_ALL.matchAll(/'([a-z0-9-]+\.test\.mjs)'/g)].map((m) => m[1]);
  assert(files.length > 0, 'could not parse the GATES table out of run-all.mjs');
  const recorded = Object.keys(BASELINE.gates).sort();
  const inRunner = [...new Set(files)].sort();
  eq(JSON.stringify(inRunner), JSON.stringify(recorded),
    'the runner gate list and the baseline gate list disagree');
});

check('no recorded floor is zero or negative', () => {
  Object.keys(BASELINE.gates).forEach((k) => {
    assert(Number.isInteger(BASELINE.gates[k]) && BASELINE.gates[k] > 0,
      'floor for ' + k + ' is ' + BASELINE.gates[k]);
  });
});

check('the mechanism is actually wired into the runner, not merely present', () => {
  assert(/assertion-floor\.js/.test(RUN_ALL), 'run-all.mjs does not require qa/assertion-floor.js');
  assert(/evaluateFloors\s*\(/.test(RUN_ALL), 'run-all.mjs never calls evaluateFloors');
  assert(/baselineIsSelfConsistent\s*\(/.test(RUN_ALL), 'run-all.mjs never calls baselineIsSelfConsistent');
  assert(/TOTAL ASSERTIONS:/.test(RUN_ALL), 'run-all.mjs no longer prints the total CI greps for');
  assert(/gates passed/.test(RUN_ALL), 'run-all.mjs no longer prints the gate tally CI greps for');
});

check('CI no longer carries a second, hand-maintained copy of the floor', () => {
  // The duplicate is what drifted. Its absence is the fix, so its absence is asserted.
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'finmentor-quality-gates.yml'), 'utf8');
  assert(!/ASSERTION_BASELINE:\s*'?\d/.test(ci),
    'the workflow still pins a literal ASSERTION_BASELINE; that duplicate is what went stale');
  assert(/assertion-baseline\.json/.test(ci),
    'the workflow does not reference the canonical baseline file');
});

// ================================================================ 2. the control

console.log('\n-- the control: a run that meets its floors is accepted --');

check('CONTROL: a run exactly at the floors passes', () => {
  const v = F.evaluateFloors(atFloor(), BASELINE);
  assert(v.ok, 'a compliant run was rejected: ' + v.failures.join(' | '));
});

check('CONTROL: a run above the floors passes, and says what to raise', () => {
  const r = atFloor();
  r[0].assertions += 5;
  const v = F.evaluateFloors(r, BASELINE);
  assert(v.ok, 'a growing run was rejected: ' + v.failures.join(' | '));
  assert(v.notes.length >= 1, 'growth produced no note telling the maintainer to raise the floor');
});

// ================================================================ 3. the mutation battery

console.log('\n-- the mechanism rejects every way coverage can be lost --');

function mustReject(label, mutateResults, mutateBaseline, expectSubstring) {
  check('REJECTS: ' + label, () => {
    const r = atFloor();
    const b = clone(BASELINE);
    if (mutateResults) { mutateResults(r); }
    if (mutateBaseline) { mutateBaseline(b); }
    const v = F.evaluateFloors(r, b);
    assert(!v.ok, 'the mechanism ACCEPTED: ' + label);
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'rejected, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

mustReject('one gate loses a single assertion', (r) => { r[0].assertions -= 1; }, null, 'per-gate floor breached');
mustReject('SUBSTANTIAL LOSS: the largest gate is emptied to zero', (r) => {
  const biggest = r.reduce((a, b) => (b.assertions > a.assertions ? b : a));
  biggest.assertions = 0;
}, null, 'per-gate floor breached');
mustReject('EVERY gate is emptied to zero', (r) => { r.forEach((x) => { x.assertions = 0; }); }, null, 'total assertions fell');
mustReject('THE TRADE: one gate loses ten while another gains ten', (r) => {
  // The exact failure a total-only floor cannot see, and the reason per-gate floors exist.
  const a = r.find((x) => x.assertions >= 20);
  const b = r.find((x) => x !== a);
  a.assertions -= 10; b.assertions += 10;
}, null, 'per-gate floor breached');
mustReject('a gate is deleted from the runner', (r) => { r.pop(); }, null, 'gate removed from the runner');
mustReject('a gate runs but has no recorded floor', (r) => {
  r.push({ file: 'brand-new.test.mjs', assertions: 3 });
}, null, 'no assertion floor recorded');
mustReject('a gate tally could not be read', (r) => { r[0].assertions = null; }, null, 'unreadable assertion tally');
mustReject('the baseline has no gates map', null, (b) => { delete b.gates; }, 'missing or has no');
mustReject('a run with no gates at all', (r) => { r.length = 0; }, null, 'gate removed from the runner');

check('REJECTS: a baseline whose total disagrees with its own per-gate floors', () => {
  const b = clone(BASELINE);
  b.total = b.total - 100;
  const v = F.baselineIsSelfConsistent(b);
  assert(!v.ok, 'an incoherent baseline was accepted');
  assert(/per-gate floors sum to/.test(v.reason), 'wrong reason: ' + v.reason);
});

check('REJECTS: lowering a floor does NOT rescue a gate that lost coverage elsewhere', () => {
  // Lowering a floor is the one edit that defeats the file. It cannot be prevented in code --
  // but it must not be silent, and it must not hide a SECOND gate's loss.
  const r = atFloor();
  const b = clone(BASELINE);
  r[0].assertions -= 10; b.gates[r[0].file] -= 10;   // the "fix"
  r[1].assertions -= 1;                               // the loss it would have masked
  const v = F.evaluateFloors(r, b);
  assert(!v.ok, 'a lowered floor masked a second gate losing coverage');
  assert(v.failures.some((f) => f.includes(r[1].file)), 'the surviving loss was not reported');
});

// ================================================================ 4. end to end: the build goes red

console.log('\n-- end to end: a coverage drop actually fails the build --');

check('run-all.mjs EXITS NON-ZERO against a raised baseline', () => {
  // The strongest form of the claim §10 asked for. Every recorded floor is raised by one, which
  // is exactly equivalent to every gate having lost one assertion. The real runner is spawned,
  // the real gates run, and the process must fail.
  const dir = mkdtempSync(join(tmpdir(), 'finmentor-floor-'));
  const raised = clone(BASELINE);
  Object.keys(raised.gates).forEach((k) => { raised.gates[k] += 1; });
  raised.total = Object.keys(raised.gates).reduce((n, k) => n + raised.gates[k], 0);
  const path = join(dir, 'raised-baseline.json');
  writeFileSync(path, JSON.stringify(raised, null, 2) + '\n', 'utf8');

  const r = spawnSync(process.execPath, [join(HERE, 'run-all.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { FINMENTOR_ASSERTION_BASELINE: path , FINMENTOR_FLOOR_NESTED: '1' })
  });
  assert(r.status !== 0, 'run-all.mjs exited 0 against a baseline every gate falls short of');
  const out = (r.stdout || '') + (r.stderr || '');
  assert(/assertion floor breached/.test(out), 'it failed, but not for the floor: ' + out.slice(-400));
});

check('run-all.mjs EXITS NON-ZERO on an incoherent baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'finmentor-floor-'));
  const broken = clone(BASELINE);
  broken.total = 1;
  const path = join(dir, 'incoherent-baseline.json');
  writeFileSync(path, JSON.stringify(broken, null, 2) + '\n', 'utf8');

  const r = spawnSync(process.execPath, [join(HERE, 'run-all.mjs')], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { FINMENTOR_ASSERTION_BASELINE: path , FINMENTOR_FLOOR_NESTED: '1' })
  });
  assert(r.status !== 0, 'run-all.mjs accepted a baseline that contradicts itself');
  const out = (r.stdout || '') + (r.stderr || '');
  assert(/not self-consistent/.test(out), 'it failed, but not for coherence: ' + out.slice(-400));
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
