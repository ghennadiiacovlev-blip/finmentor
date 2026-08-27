#!/usr/bin/env node
// FINMENTOR — run a workflow-create response through the auto-assigned credential guard.
//
//   node scripts/check-auto-credentials.mjs <response.json>
//   echo '<json>' | node scripts/check-auto-credentials.mjs -
//
// This is the CLI the deployment flow actually pipes through. Its exit code is the verdict:
// 0 = safe to proceed, 1 = AUTO_ASSIGNED_CREDENTIAL_REFUSED.
//
// The allowlist is EMPTY and not configurable from the command line. That is deliberate: this
// script exists for canary, harness, probe and driver creation, where the correct allowlist is
// empty, and a `--allow` flag would be a way to make the guard say yes under time pressure.
// A deployment that genuinely needs an allowlist should call evaluateCreateResponse() directly
// with the rules written down in its own source.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const G = require(join(HERE, '..', 'n8n', 'src', 'deploy-guard', 'auto-credential-guard.js'));

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/check-auto-credentials.mjs <response.json|->');
  process.exit(2);
}

let text;
try {
  text = arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');
} catch (e) {
  console.error('cannot read ' + arg + ': ' + e.message);
  process.exit(2);
}

let response;
try {
  response = JSON.parse(text);
} catch (e) {
  // Unparseable is refused, not skipped. "We could not look" and "nothing was assigned" must
  // never collapse into one outcome.
  console.error('AUTO_ASSIGNED_CREDENTIAL_REFUSED: the create response is not parseable JSON');
  process.exit(1);
}

const v = G.evaluateCreateResponse(response, G.HARNESS_ALLOWLIST);
console.log(v.verdict);
console.log('  ' + v.message);
if (v.assigned.length) {
  // Names, types and ids only. Never a credential's contents.
  v.assigned.forEach((a) => {
    console.log('  - node "' + a.nodeName + '"  type=' + a.credentialType
      + '  name="' + a.credentialName + '"' + (a.credentialId ? '  id=' + a.credentialId : ''));
  });
}
process.exit(v.ok ? 0 : 1);
