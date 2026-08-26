#!/usr/bin/env node
// FINMENTOR — run every offline regression gate.
//
// Offline by design: no n8n credentials, no network, no browser. Resolves paths from this
// file so it behaves identically from any working directory, and exits non-zero if any
// gate fails.
//
//   node qa/run-all.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));

const GATES = [
  ['Command Center authorisation', 'command-center-auth.test.mjs'],
  ['Lead Intake trust boundary', 'lead-intake-trust.test.mjs'],
  ['AI safe projection', 'ai-safe-projection.test.mjs'],
  ['Error Monitor alert', 'error-alert.test.mjs'],
  ['Website contract', 'website-contract.test.mjs'],
  ['n8n export hygiene', 'n8n-manifest-drift.test.mjs'],
  ['Mini App read-model consistency', 'miniapp-readmodel.test.mjs'],
  ['Mini App consent and submit', 'miniapp-submit.test.mjs'],
  ['G1 durable idempotency receipt', 'idempotency-receipt.test.mjs'],
  ['G1 P5 production integration', 'receipt-integration.test.mjs']
];

// Each gate prints its own tally, in one of two shapes: "N passed, 0 failed" or
// "PASS  N checks passed, 0 failed". Read the last such line rather than counting PASS
// lines, so a gate that prints the word elsewhere cannot inflate the total.
function assertionsFrom(output) {
  const m = [...output.matchAll(/(\d+)\s+(?:checks\s+)?passed\b/g)];
  return m.length ? Number(m[m.length - 1][1]) : null;
}

const results = [];
for (const [label, file] of GATES) {
  const r = spawnSync(process.execPath, [join(HERE, file)], { encoding: 'utf8' });
  const ok = r.status === 0;
  const output = (r.stdout || '') + (r.stderr || '');
  const assertions = assertionsFrom(output);
  results.push({ label, file, ok, output, assertions });
  const n = assertions === null ? '  ?' : String(assertions).padStart(3);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  ${label}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error('\n--- failing gate output ---');
  for (const f of failed) {
    console.error(`\n### ${f.label} (${f.file})`);
    console.error(f.output.split('\n').filter((l) => /FAIL|Error/.test(l)).join('\n'));
  }
  console.error(`\n${results.length - failed.length}/${results.length} gates passed`);
  process.exit(1);
}

// A gate whose tally cannot be read is a failure: a silently empty run must not look green.
const unreadable = results.filter((r) => r.assertions === null);
if (unreadable.length) {
  console.error('\nunreadable assertion tally: ' + unreadable.map((r) => r.file).join(', '));
  process.exit(1);
}

const total = results.reduce((n, r) => n + r.assertions, 0);
console.log(`\n${results.length}/${results.length} gates passed`);
console.log(`TOTAL ASSERTIONS: ${total}`);

// PER-GATE assertion floors, from qa/assertion-baseline.json.
//
// This existed as a documented property before it existed as code: the B.2.1-C closure said
// the runner "fails when a single gate's tally drops, so the eight gates cannot silently
// trade assertions between them", and only a total floor was ever implemented, in the CI
// workflow. A total floor cannot see one gate losing ten checks while another gains ten --
// which is precisely how coverage moves out of the place that needed it. N6.2 makes the
// documented claim true rather than deleting it.
//
// One-directional, like the CI total: a fall fails the run, growth only prints what to
// raise. Lowering a floor to turn a red run green is the one edit that defeats the file.
let baseline = null;
try {
  baseline = JSON.parse(readFileSync(join(HERE, 'assertion-baseline.json'), 'utf8'));
} catch (e) {
  console.error('\nassertion-baseline.json missing or unparseable — the per-gate floor cannot be checked');
  process.exit(1);
}

const drops = [];
const grew = [];
for (const r of results) {
  const floor = baseline.gates ? baseline.gates[r.file] : undefined;
  if (floor === undefined) {
    console.error(`\nno assertion floor recorded for ${r.file} — add one to qa/assertion-baseline.json`);
    process.exit(1);
  }
  if (r.assertions < floor) { drops.push(`${r.file}: ${r.assertions} < ${floor}`); }
  if (r.assertions > floor) { grew.push(`${r.file}: ${floor} -> ${r.assertions}`); }
}

// A gate deleted from GATES cannot be caught by a per-gate floor, because its row is simply
// absent from the results. The recorded gate list is checked too, so removing a gate is as
// loud as emptying one.
const removed = Object.keys(baseline.gates || {}).filter((f) => !results.some((r) => r.file === f));
if (removed.length) {
  console.error('\nFAIL: gate removed from the runner: ' + removed.join(', '));
  process.exit(1);
}

if (drops.length) {
  console.error('\nFAIL: per-gate assertion floor breached — coverage was removed');
  drops.forEach((d) => console.error('  - ' + d));
  process.exit(1);
}
if (total < (baseline.total || 0)) {
  console.error(`\nFAIL: total assertions fell from ${baseline.total} to ${total}`);
  process.exit(1);
}
if (grew.length || total > (baseline.total || 0)) {
  console.log('\nNOTE: assertions grew; raise qa/assertion-baseline.json');
  grew.forEach((g) => console.log('  - ' + g));
  if (total > (baseline.total || 0)) { console.log(`  - total: ${baseline.total} -> ${total}`); }
}
console.log('assertion floors: PASS');
