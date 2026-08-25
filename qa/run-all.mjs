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
  ['Website contract', 'website-contract.test.mjs'],
  ['n8n export hygiene', 'n8n-manifest-drift.test.mjs']
];

const results = [];
for (const [label, file] of GATES) {
  const r = spawnSync(process.execPath, [join(HERE, file)], { encoding: 'utf8' });
  const ok = r.status === 0;
  results.push({ label, file, ok, output: (r.stdout || '') + (r.stderr || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
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
console.log(`\n${results.length}/${results.length} gates passed`);
