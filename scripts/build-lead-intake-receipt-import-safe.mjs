#!/usr/bin/env node
// FINMENTOR — build the SAFE MANUAL IMPORT artifact for the B.2.1-C receipt candidate (P6.1).
//
//   node scripts/build-lead-intake-receipt-import-safe.mjs
//
// REPO-ONLY. Reads the canonical audited candidate and writes a deployment wrapper beside it.
// It never contacts n8n, never mutates the canonical artifact, never touches a live workflow.
//
// The canonical candidate is a faithful derivative of the production export and therefore
// still carries the production workflow id, active = true, and the live public webhook path.
// It MUST NOT be hand-imported. This script produces the file that may be.
//
// The transformation and its verification live in n8n/src/import-safe/import-safe.js. Read
// that file's header for what is stripped and why -- including three identity carriers the
// brief did not list, found by reading the candidate rather than trusting its top-level keys.
//
// This script REFUSES TO WRITE unless the output verifies. A safe-import artifact that is not
// provably safe is worse than none: its whole value is that the owner can import it without
// re-auditing 425 KB by hand, and that value is only real if the check ran.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'import-safe', 'import-safe.js'));

const IN = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json');
const OUT_DIR = join(ROOT, 'n8n', 'candidate');
const OUT = join(OUT_DIR, 'lead-intake-internal-receipt-IMPORT-SAFE.json');

const canonicalRaw = readFileSync(IN, 'utf8');
const canonical = JSON.parse(canonicalRaw);

// The canonical artifact is the audit anchor. Prove up front that the hazards this wrapper
// exists to remove are actually present -- if they ever stop being present, this script's
// premise has changed and that should be noticed here, not discovered downstream.
const hazards = [];
if (canonical.id !== S.PRODUCTION_WORKFLOW_ID) {
  hazards.push('canonical id is no longer ' + S.PRODUCTION_WORKFLOW_ID + ' (got ' + JSON.stringify(canonical.id) + ')');
}
if (canonical.active !== true) {
  hazards.push('canonical active is no longer true (got ' + JSON.stringify(canonical.active) + ')');
}
const canonHooks = S.nodesOfType(canonical, S.WEBHOOK_TYPE);
if (canonHooks.length !== 1 || (canonHooks[0].parameters || {}).path !== S.PRODUCTION_WEBHOOK_PATH) {
  hazards.push('canonical no longer carries exactly one webhook on path ' + S.PRODUCTION_WEBHOOK_PATH);
}
if (hazards.length) {
  console.error('REFUSING TO BUILD: the canonical candidate is not the shape this wrapper was written for.');
  hazards.forEach((h) => console.error('  - ' + h));
  console.error('Re-read the candidate and update n8n/src/import-safe/import-safe.js deliberately.');
  process.exit(1);
}

const safe = S.buildImportSafe(canonical);

// Verify BEFORE writing, against the canonical parsed independently of the transform.
const verdict = S.verifyImportSafe(canonical, safe);
if (!verdict.ok) {
  console.error('REFUSING TO WRITE: the generated artifact failed import-safety verification.');
  verdict.failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, S.serializeImportSafe(safe), 'utf8');

// The canonical must be untouched. Prove it by re-reading from disk rather than asserting it.
const canonicalAfter = readFileSync(IN, 'utf8');
if (canonicalAfter !== canonicalRaw) {
  console.error('FATAL: the canonical candidate changed on disk during this run.');
  process.exit(1);
}

const hook = S.nodesOfType(safe, S.WEBHOOK_TYPE)[0];
console.log('import-safe written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  name:            ' + safe.name);
console.log('  active:          ' + safe.active);
console.log('  top-level id:    ' + (Object.prototype.hasOwnProperty.call(safe, 'id') ? 'PRESENT' : 'ABSENT'));
console.log('  nodes:           ' + safe.nodes.length);
console.log('  webhook:         disabled=' + hook.disabled + ' path=' + hook.parameters.path
  + ' webhookId=' + (Object.prototype.hasOwnProperty.call(hook, 'webhookId') ? 'PRESENT' : 'ABSENT'));
console.log('  canonical:       UNCHANGED');
console.log('  verification:    PASS');
