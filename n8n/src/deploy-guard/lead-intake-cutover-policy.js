// FINMENTOR — LEAD INTAKE internal Model-B route: the approved-diff policy.
//
// GENERATED ONCE from the reviewed candidate, then TRACKED AND REVIEWED as source. That
// distinction is the whole point. Regenerating it from the candidate would make it a mirror and
// therefore vacuous -- it could never disagree. Committed, it is a written-down statement of what
// this cutover is allowed to be, so a LATER edit to the candidate is refused at deploy time by a
// file somebody reviewed. qa/lead-intake-cutover-policy.test.mjs asserts the two still agree.
//
// WHAT THIS CUTOVER IS. The Lead Intake workflow gains a SECOND ENTRY POINT: an internal
// executeWorkflowTrigger carrying the Model-B receipt critical section, beside the existing
// public webhook. Nothing about the public route changes -- same node, same id, same webhookId,
// same parameters, pinned to LIVE rather than merely unchanged in the candidate.
//
// THE HAZARD THAT SHAPES THIS FILE. Adding an entry point is the single change an attacker most
// wants. The materializer refused ANY trigger-count change until this phase, and that refusal was
// right; what replaces it is not a relaxation but a specification. `approvedAddedTriggers` names
// the one new trigger by name AND type AND id, and the type pin is load-bearing: the difference
// between an executeWorkflowTrigger and a webhook is the difference between an internal entry and
// a second PUBLIC one, and that must never be a detail nobody had to write down.
//
// THE OTHER HAZARD IS DUPLICATE LEADS. Both Pipeline writes keep exactly one inbound edge, and
// they are the same sources they had live. 43 new nodes may not point at them.

'use strict';

const PRODUCTION_WORKFLOW_ID = 'QmIyEW2ZEqKregmN';

// ---------------------------------------------------------------- the public route, untouched
//
// This node is the website's lead path. The phase is forbidden to change it, so it is pinned
// three ways: as the trigger identity, by its webhookId, and by every parameter equalling LIVE.

const PUBLIC_WEBHOOK_NODE = 'Webhook';
const PUBLIC_WEBHOOK_ID = 'e0ce5df2-f4cd-4b72-b2ac-4f44686a6be4';
const PUBLIC_WEBHOOK_IMMUTABLE_PARAMS = ['path', 'httpMethod', 'responseMode', 'options'];

// ---------------------------------------------------------------- the second entry point
//
// executeWorkflowTrigger, NOT a webhook: reachable only by a parent workflow inside the tenant,
// never from the internet. Pinned by id so a different node cannot take the approved name.

const INTERNAL_TRIGGER_NODE = 'Internal Subworkflow Trigger';
const INTERNAL_TRIGGER_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
const INTERNAL_TRIGGER_ID = 'p51-01-trigger';

// ---------------------------------------------------------------- the pipeline writes
//
// "No duplicate lead" is a fan-in property, not a code property. Each write keeps EXACTLY the one
// source it has live; 43 added nodes may not grow an edge into either.

const PIPELINE_WRITE_NEW = 'Save to Pipeline';
const PIPELINE_WRITE_NEW_SOURCE = 'Build Pipeline Row';
const PIPELINE_WRITE_MERGE = 'Update Pipeline (Merge)';
const PIPELINE_WRITE_MERGE_SOURCE = 'Build Merge Update';

// ---------------------------------------------------------------- added nodes
//
// 43 nodes, each pinned by id as well as name.

const APPROVED_ADDED_NODES = [
  'Internal Subworkflow Trigger',
  'Internal Auth Entry',
  'IF Internal Fault',
  'Internal Result (Fault)',
  'Internal Envelope Unwrap',
  'Internal Flag',
  'Correlation Guard',
  'IF Correlation OK',
  'Internal Result (Correlation)',
  'Receipt Gate',
  'IF Receipt Fault',
  'IF Receipt Required',
  'Receipt Exact Read',
  'Receipt Read Verdict',
  'IF Receipt Claimable',
  'IF Receipt Is Retry',
  'Receipt Retry Settlement',
  'Retry Settlement Verdict',
  'IF Retry Settled',
  'Internal Result (Retry)',
  'Receipt Claim',
  'Claim Verdict',
  'IF Claim Won',
  'Internal Result (Unresolved)',
  'IF Internal (New)',
  'Receipt Commit (New)',
  'Commit Verdict (New)',
  'IF Committed (New)',
  'Internal Result (New)',
  'IF Internal (Merge)',
  'Receipt Commit (Merge)',
  'Commit Verdict (Merge)',
  'IF Committed (Merge)',
  'Internal Result (Merge)',
  'IF Internal (Retry)',
  'IF Internal (Invalid)',
  'Internal Result (Invalid)',
  'IF Internal (Infra)',
  'Internal Result (Infra)',
  'IF Internal (PipelineFailed)',
  'Internal Result (PipelineFailed)',
  'IF Internal (MergeFailed)',
  'Internal Result (MergeFailed)'
];

const ADDED_NODE_IDS = {
  'Internal Subworkflow Trigger': 'p51-01-trigger',
  'Internal Auth Entry': 'p51-02-code',
  'IF Internal Fault': 'p51-04-if',
  'Internal Result (Fault)': 'p51-05-code',
  'Internal Envelope Unwrap': 'p51-06-code',
  'Internal Flag': 'p51-07-code',
  'Correlation Guard': 'p51-08-code',
  'IF Correlation OK': 'p51-10-if',
  'Internal Result (Correlation)': 'p51-11-code',
  'Receipt Gate': 'p51-12-code',
  'IF Receipt Fault': 'p51-14-if',
  'IF Receipt Required': 'p51-16-if',
  'Receipt Exact Read': 'p51-17-read',
  'Receipt Read Verdict': 'p51-18-code',
  'IF Receipt Claimable': 'p51-20-if',
  'IF Receipt Is Retry': 'p51-22-if',
  'Receipt Retry Settlement': 'p51-23-retry-settle',
  'Retry Settlement Verdict': 'p51-24-code',
  'IF Retry Settled': 'p51-26-if',
  'Internal Result (Retry)': 'p51-27-code',
  'Receipt Claim': 'p51-28-claim',
  'Claim Verdict': 'p51-29-code',
  'IF Claim Won': 'p51-31-if',
  'Internal Result (Unresolved)': 'p51-32-code',
  'IF Internal (New)': 'p51-34-if',
  'Receipt Commit (New)': 'p51-35-commit',
  'Commit Verdict (New)': 'p51-36-code',
  'IF Committed (New)': 'p51-38-if',
  'Internal Result (New)': 'p51-39-code',
  'IF Internal (Merge)': 'p51-41-if',
  'Receipt Commit (Merge)': 'p51-42-commit',
  'Commit Verdict (Merge)': 'p51-43-code',
  'IF Committed (Merge)': 'p51-45-if',
  'Internal Result (Merge)': 'p51-46-code',
  'IF Internal (Retry)': 'p51-48-if',
  'IF Internal (Invalid)': 'p51-50-if',
  'Internal Result (Invalid)': 'p51-51-code',
  'IF Internal (Infra)': 'p51-53-if',
  'Internal Result (Infra)': 'p51-54-code',
  'IF Internal (PipelineFailed)': 'p51-56-if',
  'Internal Result (PipelineFailed)': 'p51-57-code',
  'IF Internal (MergeFailed)': 'p51-59-if',
  'Internal Result (MergeFailed)': 'p51-60-code'
};

// ---------------------------------------------------------------- rewires
//
// 9 PRE-EXISTING sources are rewired; the added nodes wire themselves, which the
// materializer allows because they are in APPROVED_ADDED_NODES.

const APPROVED_REWIRED_SOURCES = [
  'Dedup Guard',
  'IF Is Retry',
  'IF Valid',
  'Normalize + Score Lead',
  'Read Pipeline (Dedup)',
  'Read Settings',
  'Save to Pipeline',
  'Update Pipeline (Merge)',
  'Validate Payload'
];

// The exact post-cutover edge set for every source this delta touches. Handed to the materializer
// as pinnedOutEdges -- declared AND enforced, which is the lesson P8.3A paid for.
const APPROVED_EDGES = {
  'Claim Verdict': [['IF Claim Won']],
  'Commit Verdict (Merge)': [['IF Committed (Merge)']],
  'Commit Verdict (New)': [['IF Committed (New)']],
  'Correlation Guard': [['IF Correlation OK']],
  'Dedup Guard': [['Receipt Gate']],
  'IF Claim Won': [['IF Is New'],['Internal Result (Unresolved)']],
  'IF Committed (Merge)': [['Internal Result (Merge)'],['Internal Result (Unresolved)']],
  'IF Committed (New)': [['Internal Result (New)'],['Internal Result (Unresolved)']],
  'IF Correlation OK': [['Read Pipeline (Dedup)'],['Internal Result (Correlation)']],
  'IF Internal (Infra)': [['Internal Result (Infra)'],['Respond Infra Failed']],
  'IF Internal (Invalid)': [['Internal Result (Invalid)'],['Respond Invalid']],
  'IF Internal (Merge)': [['Receipt Commit (Merge)'],['Respond Merged']],
  'IF Internal (MergeFailed)': [['Internal Result (MergeFailed)'],['Respond Merge Failed']],
  'IF Internal (New)': [['Receipt Commit (New)'],['Respond New Lead']],
  'IF Internal (PipelineFailed)': [['Internal Result (PipelineFailed)'],['Respond Pipeline Failed']],
  'IF Internal (Retry)': [['Internal Result (Retry)'],['Respond Retry']],
  'IF Internal Fault': [['Internal Result (Fault)'],['Internal Envelope Unwrap']],
  'IF Is Retry': [['IF Internal (Retry)'],['Build Merge Update']],
  'IF Receipt Claimable': [['IF Receipt Is Retry'],['Internal Result (Unresolved)']],
  'IF Receipt Fault': [['Internal Result (Unresolved)'],['IF Receipt Required']],
  'IF Receipt Is Retry': [['Receipt Retry Settlement'],['Receipt Claim']],
  'IF Receipt Required': [['Receipt Exact Read'],['IF Is New']],
  'IF Retry Settled': [['Internal Result (Retry)'],['Internal Result (Unresolved)']],
  'IF Valid': [['Read Settings'],['IF Internal (Invalid)']],
  'Internal Auth Entry': [['IF Internal Fault']],
  'Internal Envelope Unwrap': [['Validate Payload']],
  'Internal Flag': [['IF Valid']],
  'Internal Subworkflow Trigger': [['Internal Auth Entry']],
  'Normalize + Score Lead': [['Correlation Guard']],
  'Read Pipeline (Dedup)': [['Dedup Guard'],['IF Internal (Infra)']],
  'Read Settings': [['Settings to Object'],['IF Internal (Infra)']],
  'Receipt Claim': [['Claim Verdict']],
  'Receipt Commit (Merge)': [['Commit Verdict (Merge)']],
  'Receipt Commit (New)': [['Commit Verdict (New)']],
  'Receipt Exact Read': [['Receipt Read Verdict']],
  'Receipt Gate': [['IF Receipt Fault']],
  'Receipt Read Verdict': [['IF Receipt Claimable']],
  'Receipt Retry Settlement': [['Retry Settlement Verdict']],
  'Retry Settlement Verdict': [['IF Retry Settled']],
  'Save to Pipeline': [['IF Internal (New)'],['IF Internal (PipelineFailed)']],
  'Update Pipeline (Merge)': [['IF Internal (Merge)'],['IF Internal (MergeFailed)']],
  'Validate Payload': [['Internal Flag']]
};

const LEAD_INTAKE_CUTOVER_POLICY = {
  label: 'lead-intake-internal-model-b-route',
  productionWorkflowId: PRODUCTION_WORKFLOW_ID,

  approvedAddedNodes: APPROVED_ADDED_NODES,
  approvedModifiedNodes: [],
  approvedModifiedFields: [],
  approvedRewiredSources: APPROVED_REWIRED_SOURCES,
  approvedRemovals: [],

  approvedTopLevel: [],
  topLevelFromLive: ['name'],

  // The PUBLIC webhook is the pinned trigger identity. The internal entry is additive and is
  // approved separately and narrowly below.
  triggerNode: PUBLIC_WEBHOOK_NODE,
  expectedWebhookId: PUBLIC_WEBHOOK_ID,

  // Closed by default: any trigger not named here is refused, exactly as before this phase.
  approvedAddedTriggers: [
    { name: INTERNAL_TRIGGER_NODE, type: INTERNAL_TRIGGER_TYPE, id: INTERNAL_TRIGGER_ID }
  ],

  // No added node carries a credential. Stated, so one appearing is a refusal rather than a diff.
  approvedNewNodeCredentials: [],

  protectedFanIn: [
    { node: PIPELINE_WRITE_NEW, allowedSources: [PIPELINE_WRITE_NEW_SOURCE], exactly: 1 },
    { node: PIPELINE_WRITE_MERGE, allowedSources: [PIPELINE_WRITE_MERGE_SOURCE], exactly: 1 }
  ],

  pinnedOutEdges: APPROVED_EDGES,

  // The website's route, pinned to LIVE value-by-value rather than trusted to be unchanged.
  immutableNodeParams: [
    { node: PUBLIC_WEBHOOK_NODE, paths: PUBLIC_WEBHOOK_IMMUTABLE_PARAMS.map((k) => 'parameters.' + k) }
  ],

  requiredExpressions: []
};

module.exports = {
  PRODUCTION_WORKFLOW_ID,
  PUBLIC_WEBHOOK_NODE,
  PUBLIC_WEBHOOK_ID,
  PUBLIC_WEBHOOK_IMMUTABLE_PARAMS,
  INTERNAL_TRIGGER_NODE,
  INTERNAL_TRIGGER_TYPE,
  INTERNAL_TRIGGER_ID,
  PIPELINE_WRITE_NEW,
  PIPELINE_WRITE_NEW_SOURCE,
  PIPELINE_WRITE_MERGE,
  PIPELINE_WRITE_MERGE_SOURCE,
  APPROVED_ADDED_NODES,
  ADDED_NODE_IDS,
  APPROVED_REWIRED_SOURCES,
  APPROVED_EDGES,
  LEAD_INTAKE_CUTOVER_POLICY
};
