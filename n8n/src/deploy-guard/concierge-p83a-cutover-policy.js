// FINMENTOR — the approved-diff policy for the P8.3A Concierge hardening cutover.
//
// The materializer is generic. This file is the only place that knows what P8.3A is allowed to
// change, and — like the P7.5R policy beside it — it is written out BY HAND rather than derived
// from the candidate diff. A policy generated from the diff would approve whatever the diff
// happened to contain, which is not a policy, it is a rubber stamp.
//
// CURRENT  the 45-node sealed production baseline (P7.5R, sealed 2026-08-27)
// TARGET   the 50-node P8.3A candidate            (+6 nodes, -1 node)
//
// APPROVED DELTA CLASSES, and nothing else:
//
//   HOT_PATH_CONFIG                  the pre-reply Google Sheets settings read is replaced by a
//                                    local Code node, removing one round trip before the bot
//                                    answers. `Read Settings` is then physically removed.
//   AUTHORITY_FAILURE_CLASSIFICATION Save Bot Session stops aborting the turn; an ambiguous write
//                                    is re-read and CLASSIFIED. Classification never writes.
//   BOT_EVENT_RESILIENCE             Save Bot Event becomes best-effort: an observability write
//                                    may not break a turn that already answered the customer.
//   SESSION_READ_LATENCY             the session read backoff drops 2000ms -> 750ms.
//
// Optional hygiene, and it IS part of the accepted candidate delta:
//
//   HYGIENE_FAKE_AUTH_REMOVAL        x-finmentor-internal-key is dropped from Send Lead to Intake
//                                    and NOT replaced. It is inert; it merely looks like
//                                    authentication, which is its own small hazard.
//
// STILL FORBIDDEN, and none of it is in this delta: INTERNAL_HANDOFF, any Lead Intake executable
// change, removal of the public Lead Intake route, G5, Supabase, Mini App activation.

'use strict';

const BOT_CREDENTIAL_ID = '2JnVm0BIX0Z8tvBf';
const TRIGGER_WEBHOOK_ID = 'fa4cd08a-6959-4db5-890d-03755a0aa42d';
const TRIGGER_NODE_NAME = 'Telegram Client Trigger';
const PRODUCTION_WORKFLOW_ID = 'mppzthlkSJFr6Kle';

// ---------------------------------------------------------------- added nodes
//
// Pinned by BOTH id and name. The ids are generator-assigned and stable (`p83-*`), so an added
// node whose id does not match is not the node this policy approved, whatever it calls itself.

const APPROVED_ADDED_NODES = [
  'Hot Path Config',
  'IF Authority Write OK',
  'Authority Outcome Reread',
  'Authority Outcome Verdict',
  'IF Authority Committed',
  'Build Authority Unresolved Event'
];

const ADDED_NODE_IDS = {
  'Hot Path Config': 'p83-hotpath-config',
  'IF Authority Write OK': 'p83-if-write-ok',
  'Authority Outcome Reread': 'p83-authority-reread',
  'Authority Outcome Verdict': 'p83-authority-verdict',
  'IF Authority Committed': 'p83-if-committed',
  'Build Authority Unresolved Event': 'p83-unresolved-event'
};

const ADDED_NODE_CLASSES = {
  'Hot Path Config': 'HOT_PATH_CONFIG',
  'IF Authority Write OK': 'AUTHORITY_FAILURE_CLASSIFICATION',
  'Authority Outcome Reread': 'AUTHORITY_FAILURE_CLASSIFICATION',
  'Authority Outcome Verdict': 'AUTHORITY_FAILURE_CLASSIFICATION',
  'IF Authority Committed': 'AUTHORITY_FAILURE_CLASSIFICATION',
  'Build Authority Unresolved Event': 'AUTHORITY_FAILURE_CLASSIFICATION'
};

// ---------------------------------------------------------------- modified nodes
//
// Four inherited nodes, and the exact FIELD each is allowed to change. `parameters` is not
// granted blanket: Send Lead to Intake is the only node that may change it, and what it may
// change inside it is pinned separately by APPROVED_PARAMETER_CHANGES below.

const APPROVED_MODIFIED_NODES = {
  'Save Bot Session': 'AUTHORITY_FAILURE_CLASSIFICATION — onError continueRegularOutput, so an '
    + 'ambiguous write is classified instead of aborting a turn that already answered',
  'Save Bot Event': 'BOT_EVENT_RESILIENCE — onError continueRegularOutput; an observability '
    + 'write may not break the turn',
  'Read Bot Sessions': 'SESSION_READ_LATENCY — waitBetweenTries 2000 -> 750',
  'Send Lead to Intake': 'HYGIENE_FAKE_AUTH_REMOVAL — the inert x-finmentor-internal-key header '
    + 'is dropped and not replaced. URL, method and body are untouched'
};

const APPROVED_MODIFIED_FIELDS = ['parameters', 'onError', 'waitBetweenTries'];

// Which node may change which field. The materializer checks the field is in the approved SET;
// this table is the finer statement, enforced by qa/p83a-cutover-policy.test.mjs, so that
// granting `parameters` for the header removal does not silently grant it to Save Bot Session.
const APPROVED_FIELD_BY_NODE = {
  'Save Bot Session': ['onError'],
  'Save Bot Event': ['onError'],
  'Read Bot Sessions': ['waitBetweenTries'],
  'Send Lead to Intake': ['parameters']
};

// The EXACT before/after of every allowed value change. Written out rather than derived, so a
// different value cannot arrive under an approved field name.
const APPROVED_PARAMETER_CHANGES = [
  { node: 'Save Bot Session', field: 'onError', from: undefined, to: 'continueRegularOutput' },
  { node: 'Save Bot Event', field: 'onError', from: undefined, to: 'continueRegularOutput' },
  { node: 'Read Bot Sessions', field: 'waitBetweenTries', from: 2000, to: 750 },
  { node: 'Send Lead to Intake', field: 'parameters.sendHeaders', from: true, to: false },
  { node: 'Send Lead to Intake', field: 'parameters.headerParameters.parameters', from: 1, to: 0 }
];

const SESSION_READ_BACKOFF_MS = 750;

// ---------------------------------------------------------------- the removal
//
// Read Settings is CREDENTIAL-BEARING (Google Sheets). Its removal therefore carries that
// authorisation explicitly. The credential itself is untouched and three other Sheets nodes keep
// using it — removing a node is not removing a credential.
//
// inbound/outbound are verified against LIVE, not against the reference: the identity that
// matters is the one being deleted from production. A node whose wiring has moved since this
// rule was written is not the node the rule approved.

const APPROVED_REMOVALS = [
  {
    id: '9b55cfcc-b422-4147-a79f-04bd42386f4c',
    name: 'Read Settings',
    klass: 'HOT_PATH_CONFIG',
    inbound: ['Telegram Client Trigger'],
    outbound: ['Settings to Object'],
    allowTrigger: false,
    allowCredentialBearing: true,
    reason: 'replaced by the local Hot Path Config Code node; leaving it unreachable would be '
      + 'permanent cleanup debt, which is what P8.3 left behind'
  }
];

// ---------------------------------------------------------------- rewires
//
// Three PRE-EXISTING sources are rewired. The added nodes rewire themselves, which the
// materializer allows because they are in APPROVED_ADDED_NODES — listing them here as well would
// widen nothing but would blur which edges are new graph and which are surgery on old graph.

const APPROVED_REWIRED_SOURCES = [
  'Telegram Client Trigger',  // -> Hot Path Config instead of Read Settings
  'Read Settings',            // its outgoing edge disappears with the node
  'Save Bot Session'          // -> IF Authority Write OK instead of straight to IF Lead Ready
];

// The exact post-cutover edge set for every source this delta touches. Pinned, so an extra branch
// or a re-pointed target is a rejection rather than a diff nobody read.
const APPROVED_EDGES = {
  'Telegram Client Trigger': [['Hot Path Config', 'IF Has Callback Query']],
  'Hot Path Config': [['Settings to Object']],
  'Save Bot Session': [['IF Authority Write OK']],
  'IF Authority Write OK': [['IF Lead Ready'], ['Authority Outcome Reread']],
  'Authority Outcome Reread': [['Authority Outcome Verdict']],
  'Authority Outcome Verdict': [['IF Authority Committed']],
  'IF Authority Committed': [['IF Lead Ready'], ['Build Authority Unresolved Event']]
};

// ---------------------------------------------------------------- the authority invariants
//
// THE ONE THAT MATTERS. P8.2R withdrew verify-then-retry because of the TOCTOU between the reread
// and the write. What replaced it classifies and stands down. So the graph must show, structurally,
// that there is no second way to reach the authority write.

const AUTHORITY_WRITE_NODE = 'Save Bot Session';
const AUTHORITY_WRITE_SOLE_SOURCE = 'Build Session Row';
const AUTHORITY_CLASSIFY_ONLY_NODES = [
  'IF Authority Write OK', 'Authority Outcome Reread', 'Authority Outcome Verdict',
  'IF Authority Committed', 'Build Authority Unresolved Event'
];

// ---------------------------------------------------------------- what may not move
//
// Every node that renders something a customer sees, or that carries the transport identity.
// Zero user-facing text change is a P8.3A requirement, and "zero" is checked by comparing the
// whole node against LIVE rather than by listing fields.

const USER_FACING_NODES = [
  'Send Client Message', 'Send Intake Confirmation', 'Send Recovery Message',
  'Build Bot Response', 'Answer Callback Query'
];

// The public Lead Intake route. INTERNAL_HANDOFF is not in this phase, so the Concierge still
// calls the public webhook and the call must be byte-identical apart from the dropped header.
const LEAD_INTAKE_NODE = 'Send Lead to Intake';
const LEAD_INTAKE_IMMUTABLE_PARAMS = ['url', 'method', 'jsonBody', 'sendBody', 'specifyBody'];
const FORBIDDEN_INTAKE_TERMS = ['x-finmentor-internal-key', 'internal_intake_key'];

const CHAT_EXPRESSION = '={{ $json.chat_id }}';
const REQUIRED_EXPRESSIONS = [
  { node: 'Send Client Message', path: ['workflowInputs', 'value', 'chat_id'], value: CHAT_EXPRESSION },
  { node: 'Send Intake Confirmation', path: ['workflowInputs', 'value', 'chat_id'], value: CHAT_EXPRESSION },
  { node: 'Send Recovery Message', path: ['workflowInputs', 'value', 'chat_id'], value: CHAT_EXPRESSION }
];

const P83A_CUTOVER_POLICY = {
  label: 'concierge-p83a-hardening-cutover',
  productionWorkflowId: PRODUCTION_WORKFLOW_ID,

  approvedAddedNodes: APPROVED_ADDED_NODES,
  approvedModifiedNodes: APPROVED_MODIFIED_NODES,
  approvedModifiedFields: APPROVED_MODIFIED_FIELDS,
  approvedRewiredSources: APPROVED_REWIRED_SOURCES,
  approvedRemovals: APPROVED_REMOVALS,

  // Nothing top-level changes. The candidate carries a review name; production keeps its own.
  approvedTopLevel: [],
  topLevelFromLive: ['name'],

  triggerNode: TRIGGER_NODE_NAME,
  expectedCredentialId: BOT_CREDENTIAL_ID,
  expectedWebhookId: TRIGGER_WEBHOOK_ID,

  // Authority Outcome Reread is Read Bot Sessions' parameters verbatim, so it inherits the
  // existing Sheets credential. No other credential type may appear on an added node — and
  // notably no telegramApi, which would be a second transport identity.
  approvedNewNodeCredentials: ['googleSheetsOAuth2Api'],

  // THE AUTHORITY WRITE'S FAN-IN IS THE SAFETY PROPERTY, so it is stated to the materializer
  // rather than left to the delta. Approving the five classification nodes is not approving them
  // to point anywhere: without this, any one of them could route an edge back into Save Bot
  // Session and recreate the second write path P8.2R withdrew — the mutation battery proved that
  // exact edge materialized cleanly before this line existed.
  protectedFanIn: [
    { node: AUTHORITY_WRITE_NODE, allowedSources: [AUTHORITY_WRITE_SOLE_SOURCE], exactly: 1 }
  ],

  // `parameters` is granted to Send Lead to Intake so the inert header can be dropped. That grant
  // would otherwise cover the URL and the body as well, which is the public Lead Intake route
  // this phase is explicitly forbidden to touch. Pinned to LIVE instead.
  immutableNodeParams: [
    { node: LEAD_INTAKE_NODE, paths: LEAD_INTAKE_IMMUTABLE_PARAMS.map((k) => 'parameters.' + k) }
  ],

  requiredExpressions: REQUIRED_EXPRESSIONS
};

module.exports = {
  BOT_CREDENTIAL_ID,
  TRIGGER_WEBHOOK_ID,
  TRIGGER_NODE_NAME,
  PRODUCTION_WORKFLOW_ID,
  APPROVED_ADDED_NODES,
  ADDED_NODE_IDS,
  ADDED_NODE_CLASSES,
  APPROVED_MODIFIED_NODES,
  APPROVED_MODIFIED_FIELDS,
  APPROVED_FIELD_BY_NODE,
  APPROVED_PARAMETER_CHANGES,
  SESSION_READ_BACKOFF_MS,
  APPROVED_REMOVALS,
  APPROVED_REWIRED_SOURCES,
  APPROVED_EDGES,
  AUTHORITY_WRITE_NODE,
  AUTHORITY_WRITE_SOLE_SOURCE,
  AUTHORITY_CLASSIFY_ONLY_NODES,
  USER_FACING_NODES,
  LEAD_INTAKE_NODE,
  LEAD_INTAKE_IMMUTABLE_PARAMS,
  FORBIDDEN_INTAKE_TERMS,
  CHAT_EXPRESSION,
  REQUIRED_EXPRESSIONS,
  P83A_CUTOVER_POLICY
};
