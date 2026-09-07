#!/usr/bin/env node
// FINMENTOR — P8.3A §8: seal the P7.5R baseline.
//
//   node scripts/seal-p75r-baseline.mjs <ephemeral-live.json>            # proof only
//   node scripts/seal-p75r-baseline.mjs <ephemeral-live.json> --apply    # write A_next
//
// NO PRODUCTION WRITE. This stage reads live and writes only to the repository. There is no
// fetch() here and no write key is read, so the stage cannot mutate the tenant even by mistake.
//
// WHAT IS BEING PROVED.
//
// P7.5R deployed 45 nodes. The tracked reference `A` is still the 33-node pre-Model-B export, so
// `R(L) == A` cannot hold and every later deployment fails closed. Sealing replaces A with
// `R(L_post)` — but ONLY after proving that `L_post` is the target P7.5R actually approved.
//
// The acceptance test is offline-computable, which is what makes this a proof rather than a
// rubber stamp. At P7.5R time `R(L_pre) == A` held. The materializer takes values from B only on
// the paths the delta names and everything else from its base document, so redacting the
// approved target gives the same result whether it was applied to `L_pre` or to `A`:
//
//     R(C_approved) == R(applyDelta(delta(A,B), L_pre)) == applyDelta(delta(A,B), A)
//
// So we rebuild the approved target from tracked inputs alone, and require the FRESH live read to
// match it. If production is anything else, sealing is REFUSED — and that refusal means
// production is something nobody sanctioned, which is louder than a failed preflight.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));
const MZ = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'materializer.js'));
const SEAL = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'baseline-seal.js'));
const P = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'concierge-cutover-policy.js'));

const A_PATH = join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json');
const B_PATH = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const SEAL_PATH = join(ROOT, 'n8n', 'baseline-seal.json');
const PHASE = 'P7.5R';
const WID = P.PRODUCTION_WORKFLOW_ID;

const livePath = process.argv[2];
const apply = process.argv.indexOf('--apply') !== -1;
if (!livePath) {
  console.error('usage: node scripts/seal-p75r-baseline.mjs <live.json> [--apply]');
  process.exit(2);
}
const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
if (norm(livePath).indexOf(norm(ROOT)) === 0) {
  console.error('REFUSING: the live export must be ephemeral and outside the repository.');
  process.exit(1);
}

const A = JSON.parse(readFileSync(A_PATH, 'utf8'));
const B = JSON.parse(readFileSync(B_PATH, 'utf8'));
const L = JSON.parse(readFileSync(livePath, 'utf8'));
const sealFile = JSON.parse(readFileSync(SEAL_PATH, 'utf8'));

if (R.hasMarkers(L)) {
  console.error('REFUSING: the supplied live export contains redaction markers; it is not a live export.');
  process.exit(1);
}

const records = (sealFile.records || []).filter((r) => r.workflowId === WID);
const rec = records[records.length - 1];
if (!rec) { console.error('REFUSING: no ' + PHASE + ' record to seal.'); process.exit(1); }
if (rec.status === SEAL.SEALED) {
  console.log('Nothing to do: the most recent ' + WID + ' record is already SEALED.');
  process.exit(0);
}

console.log('P7.5R baseline seal  [' + (apply ? 'APPLY' : 'PROOF ONLY') + ']   NO PRODUCTION WRITE');
console.log('');
console.log('  workflow               : ' + WID);
console.log('  record phase / status  : ' + rec.phase + ' / ' + rec.status);
console.log('  A tracked nodes        : ' + (A.nodes || []).length);
console.log('  B candidate nodes      : ' + (B.nodes || []).length);
console.log('  L live nodes           : ' + (L.nodes || []).length);

// ---- precondition: live must still BE the version P7.5R produced ------------------------
//
// The offline acceptance test below compares graphs. This compares identity: if production has
// been rewritten since P7.5R — even back to something that happens to match — the version chain
// is broken and the record postVersionId no longer describes live.
console.log('');
console.log('  recorded postVersionId : ' + rec.postVersionId);
console.log('  live versionId         : ' + L.versionId);
const versionMatches = L.versionId === rec.postVersionId;
console.log('  version chain intact   : ' + (versionMatches ? 'YES' : 'NO'));
if (!versionMatches) {
  console.error('\nREFUSING TO SEAL: live is not the version P7.5R deployed. Production has been');
  console.error('changed by something outside this tooling. Investigate before sealing anything.');
  process.exit(1);
}

// ---- rebuild the approved P7.5R target from tracked inputs alone ------------------------
const rawOps = MZ.computeDelta(A, B);
const part = MZ.partitionDelta(rawOps, P.CONCIERGE_CUTOVER_POLICY);
const ops = part.ops;
const pol = MZ.validateDelta(ops, P.CONCIERGE_CUTOVER_POLICY);

console.log('');
console.log('  delta A -> B           : ' + ops.length + ' ops  (add ' + ops.filter((o) => o.op === 'addNode').length
  + ', setField ' + ops.filter((o) => o.op === 'setNodeField').length
  + ', rewire ' + ops.filter((o) => o.op === 'setConnections').length
  + ', remove ' + ops.filter((o) => o.op === 'removeNode').length + ')');
console.log('  retained from live     : ' + (part.retainedFromLive.join(', ') || 'none'));
console.log('  policy                 : ' + (pol.ok ? 'PASS' : 'REJECTED ' + pol.rejected.length));
if (!pol.ok) {
  console.error('\nREFUSING: the A -> B delta is not the approved P7.5R delta:');
  pol.rejected.slice(0, 20).forEach((f) => console.error('  - ' + f));
  process.exit(1);
}

let cApproved;
try { cApproved = MZ.applyDelta(A, B, ops, P.CONCIERGE_CUTOVER_POLICY); }
catch (e) { console.error('\nREFUSING: could not rebuild the approved target: ' + e.message); process.exit(1); }
console.log('  C_approved nodes       : ' + cApproved.nodes.length + '   (rebuilt offline from A and B)');

// ---- the acceptance test ----------------------------------------------------------------
const s = SEAL.sealBaseline({ cLive: cApproved, lPost: L });

console.log('');
console.log('  R(L_current) sha       : ' + s.evidence.postLiveRedactedSha);
console.log('  R(C_approved) sha      : ' + s.evidence.approvedRedactedSha);
console.log('  live == approved       : ' + (s.evidence.matches ? 'YES' : 'NO'));
console.log('  markers in A_next      : ' + (s.aNext ? R.findMarkers(s.aNext).length : '(not produced)'));

if (!s.ok) {
  console.error('\nSEAL REFUSED:');
  s.failures.forEach((f) => console.error('  - ' + f));
  console.error('\nProduction is not the target that was approved. This is louder than a failed');
  console.error('preflight: it means live is something nobody sanctioned. Do not rebaseline.');
  process.exit(1);
}

// A_next is what enters git. It must be redacted, and it must not be the live document.
if (R.findMarkers(s.aNext).length === 0) {
  console.error('\nREFUSING: A_next carries no redaction markers. A production export always has');
  console.error('concrete identities to redact; writing this into git would be the P7.5 defect in reverse.');
  process.exit(1);
}

console.log('');
console.log('  ACCEPTANCE: live IS the approved P7.5R target. The seal is a proof.');

if (!apply) {
  console.log('\nPROOF ONLY. Nothing written. Re-run with --apply to seal.');
  process.exit(0);
}

// ---- write A_next and seal the record ---------------------------------------------------
writeFileSync(A_PATH, JSON.stringify(s.aNext, null, 2) + '\n', 'utf8');

// buildSealRecord derives deployedTargetSha from the evidence, but C_approved was rebuilt from A
// rather than from L_pre, so its hash is not the artifact P7.5R actually PUT. The recorded value
// is the true one and is preserved; the rebuilt hash is recorded separately as the proof input
// it is.
const next = SEAL.buildSealRecord({
  workflowId: WID, phase: PHASE, status: SEAL.SEALED,
  sealedAt: new Date().toISOString(),
  preVersionId: rec.preVersionId,
  trackedReferencePath: rec.trackedReferencePath,
  evidence: s.evidence
});
next.deployedTargetSha = rec.deployedTargetSha;
next.sealProof = {
  method: 'offline rebuild: applyDelta(delta(A,B), A), redacted, compared to R(L_current)',
  approvedRedactedSha: s.evidence.approvedRedactedSha,
  rebuiltTargetSha: s.evidence.deployedTargetSha,
  versionChainVerified: true
};
next._note = rec._note;

sealFile.records = (sealFile.records || []).map((r) => (r === rec ? next : r));
writeFileSync(SEAL_PATH, JSON.stringify(sealFile, null, 2) + '\n', 'utf8');

console.log('');
console.log('  written: ' + A_PATH.split(/[\\/]/).pop());
console.log('  written: baseline-seal.json   -> ' + PHASE + ' = ' + SEAL.SEALED);
console.log('  A_next nodes           : ' + s.aNext.nodes.length);
console.log('  A_next markers         : ' + R.findMarkers(s.aNext).length);
console.log('\nSEALED. The next deployment of ' + WID + ' is no longer refused on baseline grounds.');
