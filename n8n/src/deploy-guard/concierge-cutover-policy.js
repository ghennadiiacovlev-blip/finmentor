// FINMENTOR — the approved-diff policy for the Concierge Model-B cutover.
//
// The materializer is generic. This file is the only place that knows what the Concierge cutover
// is allowed to change, and it is written out by hand rather than derived from the diff — so a
// change that is not already understood cannot classify itself as understood.
//
// Everything here was audited by qa/concierge-issuer-candidate.test.mjs and exercised live in
// P7.3 step 2 (issuance, preallocation, readback) and P7.4 (authority reread, stale-context
// refusal).

'use strict';

const BOT_CREDENTIAL_ID = '2JnVm0BIX0Z8tvBf';
const TRIGGER_WEBHOOK_ID = 'fa4cd08a-6959-4db5-890d-03755a0aa42d';
const TRIGGER_NODE_NAME = 'Telegram Client Trigger';
const PRODUCTION_WORKFLOW_ID = 'mppzthlkSJFr6Kle';

// The twelve issuance/authority nodes Model B adds.
const APPROVED_ADDED_NODES = [
  'Issuance Gate', 'IF Issuance Fault', 'IF Preallocation Required',
  'Receipt Preallocate', 'Receipt Readback', 'Issuance Verdict',
  'IF Authority May Advance', 'Build Issuance Failure Event',
  'Authority Reread', 'Authority Verdict', 'IF Authority Current',
  'Build Stale Authority Event'
];

// The five inherited Code nodes Model B modifies, and why. `parameters` only — a credential or
// type change on even a declared node is not covered by the audit and is rejected.
const APPROVED_MODIFIED_NODES = {
  'Get Bot Session': 'mints submission_key on a new cycle; NEVER_BACKFILL otherwise',
  'Find Session': 'carries the persisted submission_key through to the cycle gate',
  'Build Session Row': 'adds submission_key to the authority row',
  'Build Intake State Row': 'adds submission_key so a later write cannot blank it',
  'Build Confirmation State Row': 'adds submission_key so a later write cannot blank it'
};

// Two pre-existing production nodes are rewired into the issuance path. The other approved
// rewire sources are the new nodes' own outgoing edges, which the materializer allows because
// they are in APPROVED_ADDED_NODES.
const APPROVED_REWIRED_SOURCES = ['IF Message Delivered', 'IF Lead Ready'];

// THE THREE EXPRESSIONS P7.5 DESTROYED.
//
// Checked by VALUE against the materialized artifact alone. This is the check that would have
// stopped the first cutover: it does not ask "does this differ from the reference", it asks
// "is this the expression the transport needs", and there is exactly one right answer.
const CHAT_EXPRESSION = '={{ $json.chat_id }}';
const REQUIRED_EXPRESSIONS = [
  { node: 'Send Client Message', path: ['workflowInputs', 'value', 'chat_id'], value: CHAT_EXPRESSION },
  { node: 'Send Intake Confirmation', path: ['workflowInputs', 'value', 'chat_id'], value: CHAT_EXPRESSION },
  { node: 'Send Recovery Message', path: ['workflowInputs', 'value', 'chat_id'], value: CHAT_EXPRESSION }
];

const CONCIERGE_CUTOVER_POLICY = {
  label: 'concierge-model-b-cutover',
  productionWorkflowId: PRODUCTION_WORKFLOW_ID,

  approvedAddedNodes: APPROVED_ADDED_NODES,
  approvedModifiedNodes: APPROVED_MODIFIED_NODES,
  approvedModifiedFields: ['parameters'],
  approvedRewiredSources: APPROVED_REWIRED_SOURCES,

  // The workflow name and settings come from LIVE. The candidate is named
  // "...B21C ISSUER CANDIDATE" and renaming the live workflow is a visible change Model B does
  // not require, so no top-level change is approved at all.
  approvedTopLevel: [],

  // The candidate carries a review name; production keeps its own. Declared here so the
  // difference is recorded as "comes from LIVE" rather than silently ignored or wrongly applied.
  topLevelFromLive: ['name'],

  triggerNode: TRIGGER_NODE_NAME,
  expectedCredentialId: BOT_CREDENTIAL_ID,
  expectedWebhookId: TRIGGER_WEBHOOK_ID,

  // The two added Data Table nodes are credential-free; the added Sheets read inherits the
  // existing Sheets credential. No other credential type may appear on an added node.
  approvedNewNodeCredentials: ['googleSheetsOAuth2Api'],

  requiredExpressions: REQUIRED_EXPRESSIONS
};

module.exports = {
  BOT_CREDENTIAL_ID,
  TRIGGER_WEBHOOK_ID,
  TRIGGER_NODE_NAME,
  PRODUCTION_WORKFLOW_ID,
  APPROVED_ADDED_NODES,
  APPROVED_MODIFIED_NODES,
  APPROVED_REWIRED_SOURCES,
  CHAT_EXPRESSION,
  REQUIRED_EXPRESSIONS,
  CONCIERGE_CUTOVER_POLICY
};
