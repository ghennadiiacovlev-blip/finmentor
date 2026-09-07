#!/usr/bin/env node
// FINMENTOR — build the REST-API import projection for the B.2.1-C Concierge issuer (P7.3).
//
//   node scripts/build-concierge-issuer-api-import.mjs
//
// REPO-ONLY. Reads the IMPORT-SAFE wrapper and writes the four-field projection that
// POST /api/v1/workflows will accept. It never contacts n8n and never mutates its input.
//
// Run scripts/build-concierge-issuer-import-safe.mjs first: this script's input is the WRAPPER,
// never the canonical candidate, so that the projection inherits the wrapper's proven safety
// properties instead of re-deriving them from a file that still carries the production id and
// an enabled Telegram trigger.
//
// The transformation, the dropped-field analysis and the post-deploy assertions live in
// n8n/src/concierge-api-import/concierge-api-import.js. Read its header before deploying: the
// endpoint drops both `active: false` and `meta` -- which is where the DO-NOT-ACTIVATE warning
// lives -- so the disabled trigger inside `nodes` is the ONLY safety guard that survives the
// projection, and whether the server preserves it cannot be established offline.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'concierge-import-safe', 'concierge-import-safe.js'));
const A = require(join(ROOT, 'n8n', 'src', 'concierge-api-import', 'concierge-api-import.js'));

const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json');
const OUT_DIR = join(ROOT, 'n8n', 'candidate');
const OUT = join(OUT_DIR, 'concierge-issuer-API-IMPORT.json');

const safeRaw = readFileSync(IN, 'utf8');
const safe = JSON.parse(safeRaw);

// Prove up front that the INPUT is the artifact this projection was written for. Fed the
// canonical candidate by mistake, this script would otherwise happily produce a four-field
// document carrying an ENABLED Telegram trigger bound to the live client bot -- and a create
// call made from it would be one activation away from taking every client message. Refuse
// before building, not after.
const wrong = [];
if (Object.prototype.hasOwnProperty.call(safe, 'id')) {
  wrong.push('input has a top-level id -- this looks like the canonical candidate, not the wrapper');
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
if (S.enabledTriggerNodes(safe).length !== 0) {
  wrong.push('input has ' + S.enabledTriggerNodes(safe).length + ' ENABLED trigger node(s) -- '
    + 'the interlock is absent and this is not the neutralised wrapper');
}
if (wrong.length) {
  console.error('REFUSING TO BUILD: the input is not the IMPORT-SAFE wrapper.');
  wrong.forEach((w) => console.error('  - ' + w));
  console.error('Rebuild it first: node scripts/build-concierge-issuer-import-safe.mjs');
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

const trig = S.nodeByName(api, S.TRIGGER_NODE_NAME);
console.log('api-import written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  fields:          ' + Object.keys(api).join(', '));
console.log('  dropped:         ' + A.DROPPED_FIELDS.join(', '));
console.log('  name:            ' + api.name);
console.log('  nodes:           ' + api.nodes.length);
console.log('  trigger:         disabled=' + trig.disabled
  + ' webhookId=' + (Object.prototype.hasOwnProperty.call(trig, 'webhookId') ? 'PRESENT' : 'ABSENT'));
console.log('  enabled triggers:' + S.enabledTriggerNodes(api).length + '  <- the only guard that survived');
console.log('  data tables:     ' + S.nodesOfType(api, S.DATA_TABLE_TYPE).length);
console.log('  availableInMCP:  ' + api.settings.availableInMCP);
console.log('  errorWorkflow:   ' + api.settings.errorWorkflow + '  (live Error Monitor, preserved verbatim)');
console.log('  wrapper:         UNCHANGED');
console.log('  verification:    PASS');
console.log('');
console.log('The endpoint rejects `active` AND `meta`. Both of the wrapper\'s out-of-graph guards');
console.log('are therefore gone, and the disabled trigger is all that is left. These MUST be');
console.log('verified against the live object after creation, in this order:');
A.POST_DEPLOY_ASSERTIONS.forEach((a) => console.log('  - ' + a));
