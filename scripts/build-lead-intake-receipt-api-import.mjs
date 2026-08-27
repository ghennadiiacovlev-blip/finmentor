#!/usr/bin/env node
// FINMENTOR — build the REST-API import projection for the B.2.1-C receipt candidate (P6.2).
//
//   node scripts/build-lead-intake-receipt-api-import.mjs
//
// REPO-ONLY. Reads the proven IMPORT-SAFE wrapper and writes the four-field projection that
// POST /api/v1/workflows will accept. It never contacts n8n, never mutates its input, never
// touches a live workflow. Deployment is a separate, explicitly guarded step:
// scripts/deploy-b21c-canary.ps1.
//
// The input is the WRAPPER, not the canonical candidate — see the header of
// n8n/src/api-import/api-import.js for why that is the load-bearing decision.
//
// This script REFUSES TO WRITE unless the output verifies. A deployment artifact that is not
// provably a faithful subset is worse than none: its entire value is that the graph reaches
// n8n without passing through a transcription step, and that value is only real if the check
// actually ran.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'import-safe', 'import-safe.js'));
const A = require(join(ROOT, 'n8n', 'src', 'api-import', 'api-import.js'));

const IN = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-IMPORT-SAFE.json');
const OUT_DIR = join(ROOT, 'n8n', 'candidate');
const OUT = join(OUT_DIR, 'lead-intake-internal-receipt-API-IMPORT.json');

const safeRaw = readFileSync(IN, 'utf8');
const safe = JSON.parse(safeRaw);

// Prove up front that the INPUT is the artifact this projection was written for. Fed the
// canonical candidate by mistake, this script would otherwise happily produce a four-field
// document carrying the production identity and the live webhook path — and a create call
// made from it would collide with production. Refuse before building, not after.
const wrong = [];
if (Object.prototype.hasOwnProperty.call(safe, 'id')) {
  wrong.push('input has a top-level id — this looks like the canonical candidate, not the wrapper');
}
if (safe.name !== S.IMPORT_SAFE_NAME) {
  wrong.push('input name is ' + JSON.stringify(safe.name) + ', expected ' + JSON.stringify(S.IMPORT_SAFE_NAME));
}
if (safe.active !== false) {
  wrong.push('input active is ' + JSON.stringify(safe.active) + ', expected false');
}
if (!safe.meta || safe.meta.finmentor_import_safe !== true) {
  wrong.push('input does not carry meta.finmentor_import_safe === true');
}
if (wrong.length) {
  console.error('REFUSING TO BUILD: the input is not the IMPORT-SAFE wrapper.');
  wrong.forEach((w) => console.error('  - ' + w));
  console.error('Rebuild it first: node scripts/build-lead-intake-receipt-import-safe.mjs');
  process.exit(1);
}

const api = A.buildApiImport(safe);

// Verify BEFORE writing, against the wrapper parsed independently of the transform.
const verdict = A.verifyApiImport(safe, api);
if (!verdict.ok) {
  console.error('REFUSING TO WRITE: the generated projection failed verification.');
  verdict.failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, A.serializeApiImport(api), 'utf8');

// The wrapper must be untouched. Prove it by re-reading from disk rather than asserting it.
const safeAfter = readFileSync(IN, 'utf8');
if (safeAfter !== safeRaw) {
  console.error('FATAL: the IMPORT-SAFE wrapper changed on disk during this run.');
  process.exit(1);
}

const hook = S.nodesOfType(api, S.WEBHOOK_TYPE)[0];
console.log('api-import written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  fields:          ' + Object.keys(api).join(', '));
console.log('  dropped:         ' + A.DROPPED_FIELDS.join(', '));
console.log('  name:            ' + api.name);
console.log('  nodes:           ' + api.nodes.length);
console.log('  webhook:         disabled=' + hook.disabled + ' path=' + hook.parameters.path);
console.log('  availableInMCP:  ' + api.settings.availableInMCP);
console.log('  errorWorkflow:   ' + api.settings.errorWorkflow + '  (live Error Monitor, preserved verbatim)');
console.log('  wrapper:         UNCHANGED');
console.log('  verification:    PASS');
console.log('');
console.log('`active` could NOT be carried — the endpoint rejects it. These MUST be verified');
console.log('against the live object after creation (scripts/deploy-b21c-canary.ps1 does it):');
A.POST_DEPLOY_ASSERTIONS.forEach((a) => console.log('  - ' + a));
