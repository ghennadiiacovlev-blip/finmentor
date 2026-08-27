#!/usr/bin/env node
// FINMENTOR — build the SAFE MANUAL IMPORT artifact for the B.2.1-C Concierge issuer (P7.3).
//
//   node scripts/build-concierge-issuer-import-safe.mjs
//
// REPO-ONLY. Reads the canonical audited candidate and writes a deployment wrapper beside it.
// It never contacts n8n, never mutates the canonical artifact, never touches a live workflow.
//
// The canonical candidate is a faithful derivative of the production export and therefore
// still carries the production workflow id, active = true, and a Telegram trigger bound to the
// live client bot. It MUST NOT be hand-imported. This script produces the file that may be.
//
// The transformation and its verification live in
// n8n/src/concierge-import-safe/concierge-import-safe.js. Read that file's header for what is
// stripped and why -- in particular for why the Concierge's hazard is worse than Lead Intake's
// and why the interlock is "zero enabled triggers" rather than a neutered endpoint path.
//
// This script REFUSES TO WRITE unless the output verifies. A safe-import artifact that is not
// provably safe is worse than none: its whole value is that the owner can import it without
// re-auditing the file by hand, and that value is only real if the check ran.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'concierge-import-safe', 'concierge-import-safe.js'));

const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const PROD = join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json');
const OUT_DIR = join(ROOT, 'n8n', 'candidate');
const OUT = join(OUT_DIR, 'concierge-issuer-IMPORT-SAFE.json');

const canonicalRaw = readFileSync(IN, 'utf8');
const canonical = JSON.parse(canonicalRaw);
const production = JSON.parse(readFileSync(PROD, 'utf8'));

// The canonical artifact is the audit anchor. Prove up front that the hazards this wrapper
// exists to remove are actually present -- if they ever stop being present, this script's
// premise has changed and that should be noticed here, not discovered downstream.
const hazards = [];
if (canonical.id !== S.PRODUCTION_WORKFLOW_ID) {
  hazards.push('canonical id is no longer ' + S.PRODUCTION_WORKFLOW_ID
    + ' (got ' + JSON.stringify(canonical.id) + ')');
}
if (canonical.active !== true) {
  hazards.push('canonical active is no longer true (got ' + JSON.stringify(canonical.active) + ')');
}

const canonTrigger = S.nodeByName(canonical, S.TRIGGER_NODE_NAME);
if (!canonTrigger || canonTrigger.type !== S.TELEGRAM_TRIGGER_TYPE) {
  hazards.push('canonical no longer carries a telegramTrigger named ' + S.TRIGGER_NODE_NAME);
} else {
  if (canonTrigger.disabled === true) {
    hazards.push('canonical trigger is already disabled -- the wrapper has nothing to neutralise');
  }
  if (canonTrigger.webhookId !== S.PRODUCTION_TRIGGER_WEBHOOK_ID) {
    hazards.push('canonical trigger webhookId is not the production one '
      + S.PRODUCTION_TRIGGER_WEBHOOK_ID + ' (got ' + JSON.stringify(canonTrigger.webhookId) + ')');
  }
}

// THE hazard, stated against production rather than asserted: the candidate's trigger is bound
// to the same bot credential as the live Concierge trigger. If that ever stops being true the
// takeover reasoning in the module header no longer applies and must be re-read.
const prodTrigger = S.nodeByName(production, S.TRIGGER_NODE_NAME);
if (!prodTrigger) {
  hazards.push('the production export has no node named ' + S.TRIGGER_NODE_NAME);
} else if (canonTrigger
    && JSON.stringify(prodTrigger.credentials) !== JSON.stringify(canonTrigger.credentials)) {
  hazards.push('the candidate trigger credential no longer matches the LIVE trigger credential; '
    + 'the activation-takeover hazard this wrapper guards is not the one described');
}

if (hazards.length) {
  console.error('REFUSING TO BUILD: the canonical candidate is not the shape this wrapper was written for.');
  hazards.forEach((h) => console.error('  - ' + h));
  console.error('Re-read the candidate and update n8n/src/concierge-import-safe/concierge-import-safe.js deliberately.');
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

const trig = S.nodeByName(safe, S.TRIGGER_NODE_NAME);
console.log('import-safe written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  name:            ' + safe.name);
console.log('  active:          ' + safe.active);
console.log('  top-level id:    ' + (Object.prototype.hasOwnProperty.call(safe, 'id') ? 'PRESENT' : 'ABSENT'));
console.log('  nodes:           ' + safe.nodes.length);
console.log('  trigger:         disabled=' + trig.disabled
  + ' webhookId=' + (Object.prototype.hasOwnProperty.call(trig, 'webhookId') ? 'PRESENT' : 'ABSENT')
  + ' credential=' + trig.credentials.telegramApi.id + ' (KEPT, by design)');
console.log('  enabled triggers:' + S.enabledTriggerNodes(safe).length + '  <- the interlock');
console.log('  issuer nodes:    ' + S.ISSUER_NODES.filter((n) => S.nodeByName(safe, n)).length
  + '/' + S.ISSUER_NODES.length);
console.log('  canonical:       UNCHANGED');
console.log('  verification:    PASS');
