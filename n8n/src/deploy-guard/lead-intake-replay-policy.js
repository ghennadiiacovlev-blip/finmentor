// FINMENTOR — P8.4A-R: the approved-diff policy for the COMMITTED-replay correction.
//
// A SEPARATE policy from lead-intake-cutover-policy.js on purpose. That one describes the
// 57 -> 100 internal-route cutover, which is now deployed and sealed. This describes 100 -> 102,
// and keeping them apart is what makes the two writes independently rollbackable.
//
// WHAT THIS CORRECTS. Live execution 3791: replaying an already-COMMITTED submission returned
// SUBMIT_UNRESOLVED with retryable:true. Safe, but not idempotent, and the retry advice is wrong
// for a permanently settled submission. The fix resolves such a replay FROM THE RECEIPT.
//
// THE HAZARD THIS POLICY EXISTS TO STOP is the inverse of the defect: a replay path that WRITES.
// Resolving must read the receipt and nothing else. So both Pipeline writes keep their single
// approved inbound edge, no added node may carry a credential, and the added terminal's
// out-edges are pinned to nothing at all.

'use strict';

const PRODUCTION_WORKFLOW_ID = 'QmIyEW2ZEqKregmN';

const PUBLIC_WEBHOOK_NODE = 'Webhook';
const PUBLIC_WEBHOOK_ID = 'e0ce5df2-f4cd-4b72-b2ac-4f44686a6be4';
const PUBLIC_WEBHOOK_IMMUTABLE_PARAMS = ['path', 'httpMethod', 'responseMode', 'options'];

// The internal entry deployed by Write A. It is INHERITED here, not added, so it must not move.
const INTERNAL_TRIGGER_NODE = 'Internal Subworkflow Trigger';

const PIPELINE_WRITE_NEW = 'Save to Pipeline';
const PIPELINE_WRITE_NEW_SOURCE = 'Build Pipeline Row';
const PIPELINE_WRITE_MERGE = 'Update Pipeline (Merge)';
const PIPELINE_WRITE_MERGE_SOURCE = 'Build Merge Update';

const APPROVED_ADDED_NODES = ['IF Receipt Settled', 'Internal Result (Committed Replay)'];
const ADDED_NODE_IDS = {
  'IF Receipt Settled': 'p84r-01-if-settled',
  'Internal Result (Committed Replay)': 'p84r-02-result-replay'
};

// Exactly one inherited body changes: the verdict that now classifies SETTLED. A MAP, not a
// list — the materializer looks nodes up with hasOwnProperty, so an array silently approves
// nothing and every modification is refused.
const APPROVED_MODIFIED_NODES = {
  'Receipt Read Verdict': {
    field: 'parameters',
    reason: 'classify a COMMITTED receipt carrying a canonical_lead_id as SETTLED, separately '
      + 'from claimable, so a replay resolves without entering the claim/write path'
  }
};
const APPROVED_MODIFIED_FIELDS = ['parameters'];

const APPROVED_REWIRED_SOURCES = ['IF Receipt Claimable'];

// The exact post-correction edge set for every source this delta touches.
const APPROVED_EDGES = {
  'IF Receipt Claimable': [['IF Receipt Is Retry'], ['IF Receipt Settled']],
  'IF Receipt Settled': [['Internal Result (Committed Replay)'], ['Internal Result (Unresolved)']]
};

const LEAD_INTAKE_REPLAY_POLICY = {
  label: 'lead-intake-committed-replay-correction',
  productionWorkflowId: PRODUCTION_WORKFLOW_ID,

  approvedAddedNodes: APPROVED_ADDED_NODES,
  approvedModifiedNodes: APPROVED_MODIFIED_NODES,
  approvedModifiedFields: APPROVED_MODIFIED_FIELDS,
  approvedRewiredSources: APPROVED_REWIRED_SOURCES,
  approvedRemovals: [],

  approvedTopLevel: [],
  topLevelFromLive: ['name'],

  triggerNode: PUBLIC_WEBHOOK_NODE,
  expectedWebhookId: PUBLIC_WEBHOOK_ID,

  // NO trigger may be added by this correction. Closed by default: the empty list means the
  // materializer's original refusal applies to any new entry point.
  approvedAddedTriggers: [],

  approvedNewNodeCredentials: [],

  protectedFanIn: [
    { node: PIPELINE_WRITE_NEW, allowedSources: [PIPELINE_WRITE_NEW_SOURCE], exactly: 1 },
    { node: PIPELINE_WRITE_MERGE, allowedSources: [PIPELINE_WRITE_MERGE_SOURCE], exactly: 1 }
  ],

  pinnedOutEdges: APPROVED_EDGES,

  immutableNodeParams: [
    { node: PUBLIC_WEBHOOK_NODE, paths: PUBLIC_WEBHOOK_IMMUTABLE_PARAMS.map((k) => 'parameters.' + k) }
  ],

  requiredExpressions: []
};

module.exports = {
  PRODUCTION_WORKFLOW_ID,
  PUBLIC_WEBHOOK_NODE,
  PUBLIC_WEBHOOK_ID,
  INTERNAL_TRIGGER_NODE,
  PIPELINE_WRITE_NEW,
  PIPELINE_WRITE_NEW_SOURCE,
  PIPELINE_WRITE_MERGE,
  PIPELINE_WRITE_MERGE_SOURCE,
  APPROVED_ADDED_NODES,
  ADDED_NODE_IDS,
  APPROVED_MODIFIED_NODES,
  APPROVED_REWIRED_SOURCES,
  APPROVED_EDGES,
  LEAD_INTAKE_REPLAY_POLICY
};
