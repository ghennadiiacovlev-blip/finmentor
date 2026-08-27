#!/usr/bin/env node
// FINMENTOR — P7.5R: materialize and (optionally) deploy the Concierge Model-B cutover.
//
//   node scripts/materialize-concierge-cutover.mjs <ephemeral-live.json>            # dry run
//   node scripts/materialize-concierge-cutover.mjs <ephemeral-live.json> --deploy   # PUT it
//
// THE ARTIFACT IS NEVER WRITTEN TO DISK. C_live is built in memory, deployed from memory with
// fetch(), and read back into memory. Nothing sensitive is persisted by this script, so there is
// nothing to forget to delete. The only file it touches is the ephemeral live export it is
// given, which it reads and never rewrites.
//
// WHAT IT PRINTS. Hashes, counts, path names and booleans. No value from the live workflow ever
// reaches stdout — the evidence in the phase document is generated from exactly this output.
//
// The live export must be fetched fresh, outside the repository, by the caller. This script
// refuses a path inside the repo and refuses a document that already carries redaction markers,
// because either means it is not looking at the live workflow.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));
const MZ = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'materializer.js'));
const P = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'concierge-cutover-policy.js'));

const A_PATH = join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json');
const B_PATH = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const BASE = 'https://ghennadi.app.n8n.cloud/api/v1';

const livePath = process.argv[2];
const deploy = process.argv.indexOf('--deploy') !== -1;
if (!livePath) {
  console.error('usage: node scripts/materialize-concierge-cutover.mjs <live.json> [--deploy]');
  process.exit(2);
}
if (livePath.replace(/\\/g, '/').toLowerCase().indexOf(ROOT.replace(/\\/g, '/').toLowerCase()) === 0) {
  console.error('REFUSING: the live export must live outside the repository.');
  process.exit(1);
}

const A = JSON.parse(readFileSync(A_PATH, 'utf8'));
const B = JSON.parse(readFileSync(B_PATH, 'utf8'));
const L = JSON.parse(readFileSync(livePath, 'utf8'));

// The tracked classification is authoritative: neither A nor B may be deployed as-is, whatever
// this script is asked to do.
const CLASS = JSON.parse(readFileSync(join(ROOT, 'n8n', 'artifact-classification.json'), 'utf8'));
const notDeployable = CLASS.artifacts.filter((a) => a.deployable_to_production);
if (notDeployable.length) {
  console.error('REFUSING: the classification marks an artifact production-deployable.');
  process.exit(1);
}

const result = MZ.materializeDeployment({
  redactedReference: A,
  desiredReference: B,
  liveWorkflow: L,
  approvedDiffPolicy: P.CONCIERGE_CUTOVER_POLICY
});

const ev = result.evidence;
console.log('three-way materialization  [' + (deploy ? 'DEPLOY' : 'DRY RUN') + ']');
console.log('  A tracked redacted sha : ' + ev.redactedReferenceSha);
console.log('  B desired candidate sha: ' + ev.desiredReferenceSha);
console.log('  L live baseline sha    : ' + ev.liveBaselineSha);
console.log('  R(L) sha               : ' + (ev.liveRedactedSha || '(not computed)'));
console.log('  R(L) == A              : ' + (ev.steps.baselineEquivalence
  ? (ev.steps.baselineEquivalence.ok ? 'YES' : 'NO (' + ev.steps.baselineEquivalence.diffCount + ' diffs)') : 'n/a'));
if (ev.steps.delta) {
  console.log('  delta A -> B           : ' + ev.steps.delta.total + ' ops  ('
    + 'add ' + ev.steps.delta.addNode + ', setField ' + ev.steps.delta.setNodeField
    + ', rewire ' + ev.steps.delta.setConnections + ', topLevel ' + ev.steps.delta.setTopLevel
    + ', remove ' + ev.steps.delta.removeNode + ')');
}
if (ev.steps.policy) { console.log('  policy                 : ' + (ev.steps.policy.ok ? 'PASS' : 'REJECTED ' + ev.steps.policy.rejectedCount)); }
if (ev.materializedSha) { console.log('  C_live sha             : ' + ev.materializedSha); }
if (ev.steps.appliedDelta) { console.log('  L -> C_live matches delta: ' + (ev.steps.appliedDelta.ok ? 'YES' : 'NO')); }
if (ev.steps.absoluteInvariants) { console.log('  absolute invariants    : ' + (ev.steps.absoluteInvariants.ok ? 'PASS' : 'FAIL')); }
console.log('  stage                  : ' + result.stage);

if (!result.ok) {
  console.error('\nMATERIALIZATION REFUSED at ' + result.stage + ':');
  result.failures.slice(0, 20).forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

const C = result.cLive;
console.log('');
console.log('  C_live fields          : ' + Object.keys(C).join(', '));
console.log('  C_live nodes           : ' + C.nodes.length + '   (live had ' + L.nodes.length + ')');
console.log('  redaction markers      : ' + R.findMarkers(C).length + '   (must be 0)');
P.REQUIRED_EXPRESSIONS.forEach((r) => {
  const n = C.nodes.find((x) => x.name === r.node);
  let v = n.parameters; r.path.forEach((s) => { v = v[s]; });
  console.log('  ' + r.node.padEnd(24) + ' chat_id OK : ' + (v === r.value));
});

if (!deploy) {
  console.log('\nDRY RUN. Nothing was sent. Re-run with --deploy to update ' + P.PRODUCTION_WORKFLOW_ID + '.');
  process.exit(0);
}

// ---------------------------------------------------------------- deploy, from memory

const key = process.env.N8N_FIX_API_KEY;
const readKey = process.env.N8N_API_KEY;
if (!key) { console.error('REFUSING: N8N_FIX_API_KEY is not present in this process.'); process.exit(1); }
if (!readKey) { console.error('REFUSING: N8N_API_KEY is not present; this script will not read with the write key.'); process.exit(1); }

const res = await fetch(BASE + '/workflows/' + P.PRODUCTION_WORKFLOW_ID, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' },
  body: JSON.stringify(C)
});
if (!res.ok) {
  console.error('\nPUT FAILED: ' + res.status + ' ' + res.statusText);
  process.exit(1);
}
console.log('\n  PUT                    : OK (' + res.status + ')');

const back = await (await fetch(BASE + '/workflows/' + P.PRODUCTION_WORKFLOW_ID, {
  // No fallback to the WRITE key. A read that silently borrows write credentials hides which
  // key is in play, and P8 §0 forbids any silent fallback to another key.
  headers: { 'X-N8N-API-KEY': readKey }
})).json();

const bn = {}; (back.nodes || []).forEach((n) => { bn[n.name] = n; });
const trig = bn[P.TRIGGER_NODE_NAME];
const problems = [];
if (back.id !== P.PRODUCTION_WORKFLOW_ID) { problems.push('workflow id changed'); }
if (back.active !== true) { problems.push('active is not true'); }
if (back.nodes.length !== C.nodes.length) { problems.push('node count mismatch'); }
if ((back.nodes.filter((n) => /trigger$/i.test(String(n.type)))).length !== 1) { problems.push('trigger count is not 1'); }
if (!trig || (trig.credentials || {}).telegramApi.id !== P.BOT_CREDENTIAL_ID) { problems.push('trigger credential changed'); }
if (!trig || trig.webhookId !== P.TRIGGER_WEBHOOK_ID) { problems.push('trigger webhookId changed'); }
if (R.findMarkers(back).length) { problems.push('redaction markers in the live readback'); }
if (!back.settings || back.settings.availableInMCP !== false) { problems.push('availableInMCP is not false'); }
P.REQUIRED_EXPRESSIONS.forEach((r) => {
  const n = bn[r.node];
  let v = n && n.parameters; (r.path || []).forEach((s) => { v = (v == null ? v : v[s]); });
  if (v !== r.value) { problems.push('transport expression wrong on ' + r.node); }
});
const drift = [];
Object.keys(bn).forEach((name) => {
  const c = C.nodes.find((x) => x.name === name);
  if (!c) { return; }
  MZ.EXECUTABLE_FIELDS.forEach((k) => {
    if (JSON.stringify(c[k]) !== JSON.stringify(bn[name][k])) { drift.push(name + '.' + k); }
  });
});
if (drift.length) { problems.push('executable drift on readback: ' + drift.slice(0, 6).join(', ')); }

console.log('  readback versionId     : ' + back.versionId);
console.log('  readback active        : ' + back.active);
console.log('  readback nodes         : ' + back.nodes.length);
console.log('  readback markers       : ' + R.findMarkers(back).length);
console.log('  readback exec drift    : ' + (drift.length || 'NONE'));
console.log('  submission_key refs    : ' + (JSON.stringify(back).split('submission_key').length - 1));
console.log('');
if (problems.length) {
  console.error('POST-DEPLOY FIDELITY FAILED:');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}
console.log('POST-DEPLOY FIDELITY: PASS');
