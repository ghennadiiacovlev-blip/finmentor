// FINMENTOR — P8.4B (WRITE B): the approved-diff policy for the Concierge internal handoff.
//
// The Concierge stops POSTing leads to Lead Intake's public webhook and calls the internal
// executeWorkflowTrigger Write A deployed. One node is removed, two are added, three sources
// are rewired, and nothing else in a 50-node customer-facing bot may move.
//
// THE HAZARDS THIS FILE EXISTS TO STOP, in the order they would hurt:
//
//   1. A PUBLIC FALLBACK. If the HTTP call survives anywhere — as a retry arm, an error branch,
//      a second node — the migration is cosmetic and the untrusted path is still live. The
//      removal is allowlisted by exact id and exact edges, and the battery proves a
//      reintroduced HTTP submit is refused.
//   2. A STEERABLE TARGET. An Execute Workflow id supplied by expression is a node that can be
//      pointed anywhere. The target is pinned as a LITERAL and the battery proves an expression
//      is refused.
//   3. A CALLER-CONTROLLED OR RE-MINTED KEY. The submission_key must be the one the receipt was
//      preallocated with. Minted again at handoff it orphans the receipt; taken from the body it
//      is a capability the caller chose. Both are refused.
//   4. TB-1 LEAKAGE. submission_key and mode are internal; neither may reach a client-facing
//      node. Pinned as immutable parameters on every customer-facing node.

'use strict';

const P83A = require('./concierge-p83a-cutover-policy.js');

const PRODUCTION_WORKFLOW_ID = 'mppzthlkSJFr6Kle';
const LEAD_INTAKE_WORKFLOW_ID = 'QmIyEW2ZEqKregmN';

const TRIGGER_NODE_NAME = P83A.TRIGGER_NODE_NAME;
const BOT_CREDENTIAL_ID = P83A.BOT_CREDENTIAL_ID;
const TRIGGER_WEBHOOK_ID = P83A.TRIGGER_WEBHOOK_ID;

const HANDOFF_BUILDER = 'Build Internal Handoff';
const HANDOFF_CALLER = 'Send Lead to Intake (Internal)';
const REMOVED_HTTP_NODE = 'Send Lead to Intake';

const APPROVED_ADDED_NODES = [HANDOFF_BUILDER, HANDOFF_CALLER];
const ADDED_NODE_IDS = {
  'Build Internal Handoff': 'p84b-01-build-handoff',
  'Send Lead to Intake (Internal)': 'p84b-02-internal-handoff'
};

// The public HTTP submit, removed by exact identity and exact live wiring. It carries no
// credential — the public route never needed one, which is precisely why it was replaceable.
const APPROVED_REMOVALS = [
  {
    id: 'b43d5227-8eaa-4e98-94d7-f901fc5c3255',
    name: REMOVED_HTTP_NODE,
    klass: 'PUBLIC_HANDOFF_RETIRED',
    inbound: ['IF Lead Already Sent'],
    outbound: ['Parse Intake Response'],
    allowTrigger: false,
    allowCredentialBearing: false,
    reason: 'the public Lead Intake webhook submit is replaced by the structural internal route; '
      + 'leaving it in the graph would keep an untrusted path one edge away from live'
  }
];

const APPROVED_REWIRED_SOURCES = ['IF Lead Already Sent', REMOVED_HTTP_NODE];

const APPROVED_EDGES = {
  'IF Lead Already Sent': [['Build Intake Transport Request'], [HANDOFF_BUILDER]],
  'Build Internal Handoff': [[HANDOFF_CALLER]],
  'Send Lead to Intake (Internal)': [['Parse Intake Response']]
};

// TB-1. These nodes speak to the customer. Their parameters are pinned to LIVE value-by-value,
// so neither the key nor the internal mode can be added to a message, a button or a payload.
const USER_FACING_NODES = P83A.USER_FACING_NODES;

const AUTHORITY_WRITE_NODE = P83A.AUTHORITY_WRITE_NODE;
const AUTHORITY_WRITE_SOLE_SOURCE = P83A.AUTHORITY_WRITE_SOLE_SOURCE;
const BOT_EVENT_WRITE_NODE = P83A.BOT_EVENT_WRITE_NODE;
const BOT_EVENT_WRITE_SOURCES = P83A.BOT_EVENT_WRITE_SOURCES;

// The node the authoritative key comes from. Receipt Preallocate writes the receipt with exactly
// this reference, so the handoff and the receipt cannot disagree about which key the cycle owns.
const AUTHORITATIVE_KEY_SOURCE = 'Issuance Gate';
const AUTHORITATIVE_KEY_FIELD = '__submission_key';

const CONCIERGE_INTERNAL_HANDOFF_POLICY = {
  label: 'concierge-internal-handoff-migration',
  productionWorkflowId: PRODUCTION_WORKFLOW_ID,

  approvedAddedNodes: APPROVED_ADDED_NODES,
  approvedModifiedNodes: {},
  approvedModifiedFields: [],
  approvedRewiredSources: APPROVED_REWIRED_SOURCES,
  approvedRemovals: APPROVED_REMOVALS,

  approvedTopLevel: [],
  topLevelFromLive: ['name'],

  triggerNode: TRIGGER_NODE_NAME,
  expectedCredentialId: BOT_CREDENTIAL_ID,
  expectedWebhookId: TRIGGER_WEBHOOK_ID,

  // No trigger may be added. Closed by default.
  approvedAddedTriggers: [],

  // Neither added node carries a credential: the internal call needs none, which is the point.
  approvedNewNodeCredentials: [],

  protectedFanIn: [
    { node: AUTHORITY_WRITE_NODE, allowedSources: [AUTHORITY_WRITE_SOLE_SOURCE], exactly: 1 },
    { node: BOT_EVENT_WRITE_NODE, allowedSources: BOT_EVENT_WRITE_SOURCES, exactly: 7 }
  ],

  pinnedOutEdges: APPROVED_EDGES,

  // APPROVING A NODE BY NAME APPROVES NOTHING INSIDE IT. Until this phase an added node's
  // parameters were unconstrained, so "Send Lead to Intake (Internal)" could have been pointed at
  // any workflow, or made steerable by expression, and the handoff body could have taken the
  // submission_key from the request or minted a fresh one — all inside approved names. The
  // battery found all three. The target is pinned by value; the body is pinned whole, by hash.
  pinnedAddedNodeParams: [
    {
      node: HANDOFF_CALLER,
      path: 'parameters.workflowId.value',
      equals: LEAD_INTAKE_WORKFLOW_ID,
      // An expression here would make the call dynamically steerable by whatever reaches it.
      mustNotMatch: '^='
    },
    { node: HANDOFF_CALLER, path: 'parameters.workflowId.mode', equals: 'id' },
    {
      node: HANDOFF_BUILDER,
      path: 'parameters.jsCode',
      sha256: '9a41dc1d5059f07f1f6e6f01c8fcd0bd9a9660b71641f2a6095e9be2073f6f65'
    }
  ],

  // Every customer-facing node pinned to LIVE, so this delta cannot alter a message, a keyboard
  // or the transport body while it is busy changing the handoff.
  immutableNodeParams: USER_FACING_NODES.map((n) => ({ node: n, paths: ['parameters'] })),

  requiredExpressions: P83A.REQUIRED_EXPRESSIONS
};

module.exports = {
  PRODUCTION_WORKFLOW_ID,
  LEAD_INTAKE_WORKFLOW_ID,
  TRIGGER_NODE_NAME,
  BOT_CREDENTIAL_ID,
  TRIGGER_WEBHOOK_ID,
  HANDOFF_BUILDER,
  HANDOFF_CALLER,
  REMOVED_HTTP_NODE,
  APPROVED_ADDED_NODES,
  ADDED_NODE_IDS,
  APPROVED_REMOVALS,
  APPROVED_REWIRED_SOURCES,
  APPROVED_EDGES,
  USER_FACING_NODES,
  AUTHORITY_WRITE_NODE,
  AUTHORITY_WRITE_SOLE_SOURCE,
  BOT_EVENT_WRITE_NODE,
  BOT_EVENT_WRITE_SOURCES,
  AUTHORITATIVE_KEY_SOURCE,
  AUTHORITATIVE_KEY_FIELD,
  CONCIERGE_INTERNAL_HANDOFF_POLICY
};
