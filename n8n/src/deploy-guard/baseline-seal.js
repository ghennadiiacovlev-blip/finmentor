// FINMENTOR — post-cutover baseline sealing.
//
// WHY THIS EXISTS.
//
// The three-way materializer requires `R(L) == A`: the redaction of the live workflow must equal
// the tracked reference. P8.3 found the obvious consequence nobody had written down —
//
//     EVERY SUCCESSFUL CUTOVER INVALIDATES THE REFERENCE IT USED.
//
// After P7.5R deployed 45 nodes, the tracked reference was still the 33-node pre-Model-B export.
// The next deployment's preflight would have failed on baseline drift that was not drift at all;
// it was our own change, unrecorded. And the temptation at that moment — rebaseline from live so
// the check passes — is precisely the silent rebaseline the model exists to prevent.
//
// So sealing is not bookkeeping. It is the step that keeps `R(L) == A` meaningful across more
// than one deployment.
//
// THE RULE. `A_next = R(L_post)` is accepted for ONE reason only: because `L_post` matches the
// materialized target that was just approved. Not because it is live, not because it is newer.
// If the post-deploy live state does not match what was approved, the seal is REFUSED — and a
// refused seal is a louder signal than a failed preflight, because it means production is
// something nobody sanctioned.
//
// FAIL CLOSED. If a cutover succeeds and sealing does not, production is fine and needs no
// rollback — but the tooling must refuse the NEXT deployment until the baseline is sealed.
// Otherwise the unsealed state quietly becomes the new normal and the next preflight compares
// against a reference that describes neither the old production nor the new one.

'use strict';

const { createHash } = require('crypto');
const R = require('./redactor.js');
const MZ = require('./materializer.js');

const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');

const SEALED = 'SEALED';
const UNSEALED = 'BASELINE_UNSEALED';

// Is this workflow clear to deploy? A workflow with no history is; one whose most recent record
// is unsealed is not.
function preflightSealCheck(sealFile, workflowId) {
  const records = ((sealFile || {}).records || []).filter((r) => r.workflowId === workflowId);
  if (records.length === 0) {
    return { ok: true, reason: 'no prior cutover recorded for ' + workflowId };
  }
  const last = records[records.length - 1];
  if (last.status !== SEALED) {
    return {
      ok: false,
      reason: 'the previous cutover of ' + workflowId + ' (' + (last.phase || 'unknown phase')
        + ') is ' + last.status + '. The tracked reference does not describe current production, '
        + 'so `R(L) == A` cannot mean anything. Seal it before deploying again.'
    };
  }
  return { ok: true, reason: 'previous cutover sealed', last: last };
}

// Verifies that the post-deploy live workflow really is the approved target, then produces the
// next tracked reference.
//
//   cLive   the materialized four-field target that was deployed
//   lPost   the fresh live workflow read back AFTER the deploy
//
// Returns { ok, aNext, evidence, failures }. `aNext` is REDACTED and is the only thing that may
// enter git.
function sealBaseline(input) {
  const cLive = input.cLive;
  const lPost = input.lPost;
  const failures = [];

  if (!cLive || !lPost) {
    return { ok: false, failures: ['sealBaseline needs both the deployed target and the post-deploy live workflow'] };
  }

  // A live export is never redacted. If it is, we are not looking at live.
  if (R.hasMarkers(lPost)) {
    failures.push('the post-deploy workflow contains redaction markers; it is not a live export');
  }

  const aNext = R.redactWorkflow(lPost);

  // THE acceptance test: does live match what was approved? Compared on the safety-relevant
  // surface, after redacting BOTH sides so the comparison is like-for-like.
  const approvedRedacted = R.redactWorkflow({
    name: cLive.name, nodes: cLive.nodes, connections: cLive.connections, settings: cLive.settings
  });
  const eq = MZ.baselineEquivalence(approvedRedacted, aNext);
  if (!eq.ok) {
    failures.push('post-deploy live does NOT match the approved target on ' + eq.diffs.length
      + ' field(s): ' + eq.diffs.slice(0, 8).join(', ')
      + ' — refusing to seal. Production is something that was not approved.');
  }

  // A_next must still be a redacted document. Sealing an unredacted workflow into git would be
  // the P7.5 defect in reverse.
  if (aNext && R.findMarkers(aNext).length === 0) {
    // Not an error by itself — a workflow with no concrete identities has nothing to redact —
    // but it is worth recording, because it is unusual for a real production export.
  }

  const evidence = {
    deployedTargetSha: sha(cLive),
    postLiveSha: sha(lPost),
    postLiveRedactedSha: sha(aNext),
    approvedRedactedSha: sha(approvedRedacted),
    matches: eq.ok,
    versionId: lPost.versionId || '',
    nodeCount: (lPost.nodes || []).length
  };

  if (failures.length) { return { ok: false, failures: failures, evidence: evidence }; }
  return { ok: true, aNext: aNext, evidence: evidence, failures: [] };
}

// Builds the record appended to the seal file. Hashes and metadata only — never a workflow body.
function buildSealRecord(input) {
  return {
    workflowId: input.workflowId,
    phase: input.phase,
    status: input.status === SEALED ? SEALED : UNSEALED,
    sealedAt: input.sealedAt || '',
    preVersionId: input.preVersionId || '',
    postVersionId: (input.evidence || {}).versionId || '',
    deployedTargetSha: (input.evidence || {}).deployedTargetSha || '',
    postLiveRedactedSha: (input.evidence || {}).postLiveRedactedSha || '',
    trackedReferencePath: input.trackedReferencePath || '',
    nodeCount: (input.evidence || {}).nodeCount || null
  };
}

module.exports = { SEALED, UNSEALED, preflightSealCheck, sealBaseline, buildSealRecord };
