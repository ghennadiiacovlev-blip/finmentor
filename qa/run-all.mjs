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

const HERE = dirname(fileURLToPath(import.meta.url));

const GATES = [
  ['Command Center authorisation', 'command-center-auth.test.mjs'],
  ['Lead Intake trust boundary', 'lead-intake-trust.test.mjs'],
  ['AI safe projection', 'ai-safe-projection.test.mjs'],
  ['Error Monitor alert', 'error-alert.test.mjs'],
  ['Website contract', 'website-contract.test.mjs'],
  ['n8n export hygiene', 'n8n-manifest-drift.test.mjs'],
  ['Mini App read-model consistency', 'miniapp-readmodel.test.mjs']
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
