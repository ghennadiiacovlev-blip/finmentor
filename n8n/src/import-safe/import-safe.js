// FINMENTOR — P6.1 safe manual-import transformation for the B.2.1-C receipt candidate.
//
// WHY THIS EXISTS.
//
// The canonical audited candidate, n8n/candidate/lead-intake-internal-receipt-candidate.json,
// is a FAITHFUL derivative of the live production export. That faithfulness is the point --
// it is what makes the 57 inherited nodes auditable against production -- and it is also what
// makes the file dangerous to hand-import, because it still carries:
//
//   * the production workflow identity   id = QmIyEW2ZEqKregmN
//   * the production lifecycle state     active = true
//   * the production public endpoint     Webhook.path = finmentor-lead-intake
//
// Importing it as-is could collide with, or shadow, the live Lead Intake workflow and its
// public POST endpoint. This module produces a DEPLOYMENT WRAPPER that is safe to import by
// hand, without touching the canonical artifact and without altering one byte of graph
// semantics.
//
// THREE HAZARDS THE BRIEF DID NOT LIST, FOUND BY READING THE FILE (P6.1 step 1).
//
//   1. `activeVersion` is a SECOND FULL COPY of the graph (57 nodes, its own connections)
//      carrying `workflowId: QmIyEW2ZEqKregmN`, `versionId`, an `authors` string, a
//      `workflowPublishHistory` entry with a `userId`, and -- critically -- a second copy of
//      the Webhook node still bearing path `finmentor-lead-intake`. Stripping the top-level
//      `id` while keeping this would leave the production identity in the file three more
//      times and an un-neutralised production endpoint in a shadow graph.
//
//   2. `shared` carries `workflowId`, `projectId`, a `creatorId` UUID and the owner's name
//      and email address. Production identity plus personal data, neither of which belongs in
//      a deployment wrapper.
//
//   3. `meta.finmentor_source_export` embeds the production workflow id in its filename, and
//      `meta.finmentor_not_deployed: true` is a statement that stops being true the moment
//      this wrapper is imported on purpose.
//
// The brief's removal list is therefore EXTENDED, deliberately and visibly, by
// STRIPPED_DISCOVERED and the meta rewrite. Every one of those extra differences is declared
// in APPROVED_DIFF_PATHS below and asserted exactly, so the extension is auditable rather
// than silent.
//
// WHAT THIS MODULE MUST NEVER DO: change graph semantics. No Code body, no connection, no
// credential reference, no node parameter other than the public Webhook's own path is
// touched. verifyImportSafe() proves that independently, by diffing the two documents and
// requiring the set of differing paths to equal the approved set EXACTLY -- it does not
// re-run the transform, so a bug in the transform cannot pass its own check.

'use strict';

// ---------------------------------------------------------------- constants

const PRODUCTION_WORKFLOW_ID = 'QmIyEW2ZEqKregmN';
const PRODUCTION_WEBHOOK_PATH = 'finmentor-lead-intake';

const IMPORT_SAFE_NAME = 'FINMENTOR Lead Intake INTERNAL B21C RECEIPT CANARY';
const INERT_WEBHOOK_PATH = '__disabled_b21c_internal_candidate';

const INTERNAL_TRIGGER_NAME = 'Internal Subworkflow Trigger';
const INTERNAL_TRIGGER_TYPE = 'n8n-nodes-base.executeWorkflowTrigger';
const INTERNAL_AUTH_ENTRY = 'Internal Auth Entry';

const WEBHOOK_TYPE = 'n8n-nodes-base.webhook';
const RESPOND_TYPE = 'n8n-nodes-base.respondToWebhook';
const CODE_TYPE = 'n8n-nodes-base.code';
const TELEGRAM_TYPE = 'n8n-nodes-base.telegram';

// Lifecycle / identity fields named by the P6.1 brief.
const STRIPPED_BRIEF = [
  'id', 'activeVersionId', 'versionId', 'versionCounter',
  'createdAt', 'updatedAt', 'sourceWorkflowId', 'triggerCount'
];

// Additional carriers of production identity found by reading the file. See the header.
const STRIPPED_DISCOVERED = ['shared', 'activeVersion'];

const STRIPPED_TOP_LEVEL = STRIPPED_BRIEF.concat(STRIPPED_DISCOVERED);

const IMPORT_SAFE_GENERATOR = 'scripts/build-lead-intake-receipt-import-safe.mjs';

// The exact, complete set of paths on which IMPORT-SAFE may differ from the canonical
// candidate. Anything else is a semantic change and fails verification.
const APPROVED_DIFF_PATHS = STRIPPED_TOP_LEVEL
  .concat([
    'name',
    'active',
    'isArchived',
    'meta.finmentor_source_export',
    'meta.finmentor_not_deployed',
    'meta.finmentor_import_safe',
    'meta.finmentor_import_safe_generated_by'
  ]);

// Per-webhook-node paths, appended once the webhook node's index is known.
function webhookDiffPaths(index) {
  return [
    'nodes[' + index + '].disabled',
    'nodes[' + index + '].webhookId',
    'nodes[' + index + '].parameters.path'
  ];
}

// ---------------------------------------------------------------- helpers

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function webhookNodeIndexes(wf) {
  const out = [];
  (wf.nodes || []).forEach((n, i) => { if (n && n.type === WEBHOOK_TYPE) { out.push(i); } });
  return out;
}

function nodesOfType(wf, type) { return (wf.nodes || []).filter((n) => n && n.type === type); }

// ---------------------------------------------------------------- the transform

function buildImportSafe(canonical) {
  const wf = clone(canonical);

  // 1. Strip every carrier of production identity and lifecycle state.
  STRIPPED_TOP_LEVEL.forEach((k) => { delete wf[k]; });

  // 2. A distinct name, inert lifecycle. isArchived is set explicitly even though the
  //    canonical already reads false, because "explicitly false" and "happens to be false"
  //    are different guarantees and only one of them survives an upstream re-export.
  wf.name = IMPORT_SAFE_NAME;
  wf.active = false;
  wf.isArchived = false;

  // 3. Provenance that does not smuggle the production id back in, and does not keep
  //    asserting "not deployed" about a file built expressly to be deployed.
  if (wf.meta && typeof wf.meta === 'object') {
    if (typeof wf.meta.finmentor_source_export === 'string') {
      wf.meta.finmentor_source_export =
        wf.meta.finmentor_source_export.split(PRODUCTION_WORKFLOW_ID + '.').join('');
    }
    wf.meta.finmentor_not_deployed = false;
    wf.meta.finmentor_import_safe = true;
    wf.meta.finmentor_import_safe_generated_by = IMPORT_SAFE_GENERATOR;
  }

  // 4. Neutralise the public webhook. The NODE IS KEPT and KEPT UNDER ITS OWN NAME -- n8n
  //    resolves connections and $('...') expressions by node name, so renaming or deleting it
  //    would be a semantic change to a graph that is supposed to stay byte-faithful.
  //    Disabled + inert path + no inherited registration id makes it incapable of serving,
  //    while leaving every reference to it intact.
  webhookNodeIndexes(wf).forEach((i) => {
    const n = wf.nodes[i];
    n.disabled = true;
    delete n.webhookId;
    n.parameters = n.parameters || {};
    n.parameters.path = INERT_WEBHOOK_PATH;
  });

  return wf;
}

function serializeImportSafe(wf) {
  // Byte-for-byte the same convention as the canonical generator: 2-space JSON, trailing LF.
  return JSON.stringify(wf, null, 2) + '\n';
}

// ---------------------------------------------------------------- diffing

// Every path at which two documents differ, including keys present in one and absent in the
// other. Order-insensitive for object keys; index-sensitive for arrays.
function diffPaths(a, b, prefix, acc) {
  acc = acc || [];
  prefix = prefix || '';

  const aIsObj = a !== null && typeof a === 'object';
  const bIsObj = b !== null && typeof b === 'object';

  if (!aIsObj || !bIsObj) {
    if (JSON.stringify(a) !== JSON.stringify(b)) { acc.push(prefix); }
    return acc;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { acc.push(prefix); return acc; }

  if (Array.isArray(a)) {
    if (a.length !== b.length) { acc.push(prefix + '.length'); }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) { diffPaths(a[i], b[i], prefix + '[' + i + ']', acc); }
    return acc;
  }

  const keys = {};
  Object.keys(a).forEach((k) => { keys[k] = true; });
  Object.keys(b).forEach((k) => { keys[k] = true; });
  Object.keys(keys).sort().forEach((k) => {
    const p = prefix ? prefix + '.' + k : k;
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    if (!inA || !inB) { acc.push(p); return; }
    diffPaths(a[k], b[k], p, acc);
  });
  return acc;
}

// ---------------------------------------------------------------- route analysis

// Branch-aware reachability from the internal trigger.
//
// A naive BFS is USELESS here and would produce a false negative: every `Respond *` node is
// wired to the FALSE output of an `IF Internal (*)` gate, and a BFS that follows both outputs
// therefore "reaches" all seven of them from the internal trigger. The runtime does not. On
// the internal route __internal === 1, so each of those gates takes output[0] only.
//
// This walker models that: at an `IF Internal (*)` gate it follows output 0 alone. That is
// the honest proof, and it is backed structurally by respondNodesAreGatedOff() below, which
// shows the property holds by construction rather than by traversal.
function isInternalGate(name) { return /^IF Internal \(/.test(String(name)); }

function reachableFromInternal(wf, opts) {
  opts = opts || {};
  const conns = wf.connections || {};
  const excluded = new Set(opts.exclude || []);
  const start = INTERNAL_TRIGGER_NAME;
  const seen = new Set([start]);
  const queue = [start];

  while (queue.length) {
    const cur = queue.shift();
    const c = conns[cur];
    if (!c || !c.main) { continue; }
    c.main.forEach((branch, outIndex) => {
      // The gate discriminates: internal execution takes the true branch only.
      if (isInternalGate(cur) && outIndex !== 0) { return; }
      (branch || []).forEach((link) => {
        if (!link || !link.node) { return; }
        if (excluded.has(link.node)) { return; }
        if (!seen.has(link.node)) { seen.add(link.node); queue.push(link.node); }
      });
    });
  }
  return seen;
}

// Structural proof, independent of traversal: every respondToWebhook node's ENTIRE inbound
// edge set originates at output index 1 (false) of an `IF Internal (*)` gate. If that holds,
// no internal execution can terminate in a RespondToWebhook regardless of path.
function respondNodesAreGatedOff(wf) {
  const respondNames = new Set(nodesOfType(wf, RESPOND_TYPE).map((n) => n.name));
  const bad = [];
  const inbound = {};
  respondNames.forEach((n) => { inbound[n] = 0; });

  Object.keys(wf.connections || {}).forEach((src) => {
    const c = wf.connections[src];
    if (!c || !c.main) { return; }
    c.main.forEach((branch, outIndex) => {
      (branch || []).forEach((link) => {
        if (!link || !respondNames.has(link.node)) { return; }
        inbound[link.node]++;
        if (!isInternalGate(src) || outIndex !== 1) {
          bad.push(src + ' out[' + outIndex + '] -> ' + link.node);
        }
      });
    });
  });

  const unfed = Object.keys(inbound).filter((n) => inbound[n] === 0);
  return { ok: bad.length === 0 && unfed.length === 0, badEdges: bad, unfed: unfed };
}

// ---------------------------------------------------------------- verification

// Proves IMPORT-SAFE differs from canonical ONLY by the approved transformation, and that it
// satisfies every import-safety property.
//
// Deliberately does NOT call buildImportSafe(). Re-running the transform and comparing would
// only prove the transform is deterministic; a wrong transform would pass. Every assertion
// below reads the two documents directly.
function verifyImportSafe(canonical, safe) {
  const failures = [];
  const fail = (m) => { failures.push(m); };

  // --- top-level identity and lifecycle -------------------------------------------------
  STRIPPED_TOP_LEVEL.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(safe, k)) {
      fail('top-level field must be absent from IMPORT-SAFE: ' + k);
    }
  });

  if (safe.name !== IMPORT_SAFE_NAME) { fail('name is not the canary name: ' + JSON.stringify(safe.name)); }
  if (safe.active !== false) { fail('active must be exactly false, got ' + JSON.stringify(safe.active)); }
  if (safe.isArchived !== false) { fail('isArchived must be exactly false, got ' + JSON.stringify(safe.isArchived)); }

  // The production id must not survive ANYWHERE in the document, under any key. This is the
  // check that catches activeVersion.workflowId and shared[].workflowId.
  const serialized = JSON.stringify(safe);
  if (serialized.indexOf(PRODUCTION_WORKFLOW_ID) !== -1) {
    fail('the production workflow id ' + PRODUCTION_WORKFLOW_ID + ' still appears in IMPORT-SAFE');
  }

  // --- the public webhook ---------------------------------------------------------------
  const safeHooks = nodesOfType(safe, WEBHOOK_TYPE);
  const canonHooks = nodesOfType(canonical, WEBHOOK_TYPE);
  if (safeHooks.length !== canonHooks.length) {
    fail('webhook node count changed: ' + canonHooks.length + ' -> ' + safeHooks.length);
  }
  safeHooks.forEach((n) => {
    if (n.disabled !== true) { fail('webhook node ' + JSON.stringify(n.name) + ' is not disabled'); }
    if (Object.prototype.hasOwnProperty.call(n, 'webhookId')) {
      fail('webhook node ' + JSON.stringify(n.name) + ' still carries an inherited webhookId');
    }
    const path = n.parameters && n.parameters.path;
    if (path === PRODUCTION_WEBHOOK_PATH) {
      fail('webhook node ' + JSON.stringify(n.name) + ' still serves the production path');
    }
    if (path !== INERT_WEBHOOK_PATH) {
      fail('webhook node ' + JSON.stringify(n.name) + ' path is not the inert path, got ' + JSON.stringify(path));
    }
  });
  // The production path must not survive anywhere in the RUNTIME-BEARING part of the
  // document -- nodes, connections, settings -- which is where a shadow graph copy such as
  // `activeVersion` would hide a second, still-enabled webhook.
  //
  // Scoped to that subtree on purpose. A whole-document substring scan also matches
  // meta.finmentor_source_export, whose value is the source EXPORT FILENAME
  // "finmentor-lead-intake-premium-final.json" -- provenance text, not an endpoint. Failing
  // on that would be the check misreading a filename as a route.
  const runtimeSerialized = JSON.stringify({
    nodes: safe.nodes, connections: safe.connections, settings: safe.settings
  });
  if (runtimeSerialized.indexOf(PRODUCTION_WEBHOOK_PATH) !== -1) {
    fail('the production webhook path ' + PRODUCTION_WEBHOOK_PATH + ' still appears in the IMPORT-SAFE runtime graph');
  }
  // And no node anywhere may declare it as a path parameter, whatever the node's type.
  (safe.nodes || []).forEach((n) => {
    if (n && n.parameters && n.parameters.path === PRODUCTION_WEBHOOK_PATH) {
      fail('node ' + JSON.stringify(n.name) + ' declares the production path');
    }
  });

  // --- graph fidelity -------------------------------------------------------------------
  const cNodes = canonical.nodes || [];
  const sNodes = safe.nodes || [];
  if (cNodes.length !== sNodes.length) {
    fail('node count changed: ' + cNodes.length + ' -> ' + sNodes.length);
  }

  if (JSON.stringify(canonical.connections) !== JSON.stringify(safe.connections)) {
    fail('connections are not byte-identical to the canonical candidate');
  }

  // Code bodies, byte for byte, matched by node name so a reordering cannot hide a swap.
  const sByName = {};
  sNodes.forEach((n) => { sByName[n.name] = n; });
  nodesOfType(canonical, CODE_TYPE).forEach((cn) => {
    const sn = sByName[cn.name];
    if (!sn) { fail('code node missing from IMPORT-SAFE: ' + cn.name); return; }
    const a = (cn.parameters || {}).jsCode;
    const b = (sn.parameters || {}).jsCode;
    if (a !== b) { fail('jsCode differs for code node ' + JSON.stringify(cn.name)); }
  });

  // Credential references unchanged, node for node.
  cNodes.forEach((cn) => {
    const sn = sByName[cn.name];
    if (!sn) { fail('node missing from IMPORT-SAFE: ' + cn.name); return; }
    if (JSON.stringify(cn.credentials) !== JSON.stringify(sn.credentials)) {
      fail('credential reference changed on node ' + JSON.stringify(cn.name));
    }
  });

  // --- no new capability introduced -----------------------------------------------------
  if (nodesOfType(safe, TELEGRAM_TYPE).length !== nodesOfType(canonical, TELEGRAM_TYPE).length) {
    fail('the Telegram node count changed');
  }
  if (nodesOfType(safe, RESPOND_TYPE).length !== nodesOfType(canonical, RESPOND_TYPE).length) {
    fail('the respondToWebhook node count changed');
  }
  if (!safe.settings || safe.settings.availableInMCP !== false) {
    fail('settings.availableInMCP must be exactly false');
  }
  if (JSON.stringify(canonical.settings) !== JSON.stringify(safe.settings)) {
    fail('settings changed');
  }

  // --- the internal route -------------------------------------------------------------
  const triggers = (safe.nodes || []).filter((n) => n.type === INTERNAL_TRIGGER_TYPE);
  if (triggers.length !== 1) { fail('expected exactly one executeWorkflowTrigger, found ' + triggers.length); }
  if (triggers.length === 1 && triggers[0].name !== INTERNAL_TRIGGER_NAME) {
    fail('the executeWorkflowTrigger is not named ' + INTERNAL_TRIGGER_NAME);
  }

  // The strongest form of "the internal route does not need the webhook": remove the webhook
  // node from consideration entirely, not merely disable it, and require the route to stand.
  const hookNames = safeHooks.map((n) => n.name);
  const reach = reachableFromInternal(safe, { exclude: hookNames });
  if (!reach.has(INTERNAL_AUTH_ENTRY)) {
    fail(INTERNAL_AUTH_ENTRY + ' is not reachable from the internal trigger without the webhook');
  }
  hookNames.forEach((h) => {
    if (reach.has(h)) { fail('the webhook node ' + JSON.stringify(h) + ' is reachable from the internal trigger'); }
  });

  const reachedResponders = nodesOfType(safe, RESPOND_TYPE)
    .map((n) => n.name).filter((n) => reach.has(n));
  if (reachedResponders.length) {
    fail('internal route reaches respondToWebhook node(s): ' + reachedResponders.join(', '));
  }

  const gated = respondNodesAreGatedOff(safe);
  if (!gated.ok) {
    if (gated.badEdges.length) {
      fail('respondToWebhook node fed from outside an IF Internal false branch: ' + gated.badEdges.join(' ; '));
    }
    if (gated.unfed.length) {
      fail('respondToWebhook node with no inbound edge: ' + gated.unfed.join(', '));
    }
  }

  // Internal terminals -- both success and failure -- must be reachable.
  const internalResults = (safe.nodes || [])
    .map((n) => n.name).filter((n) => /^Internal Result \(/.test(n));
  if (internalResults.length === 0) { fail('no Internal Result terminals found'); }
  internalResults.forEach((n) => {
    if (!reach.has(n)) { fail('internal terminal not reachable from the internal trigger: ' + n); }
  });

  // --- the exhaustive residual diff -----------------------------------------------------
  // Everything above is a property check. This is the closure: the COMPLETE set of paths at
  // which the two documents differ must equal the approved set exactly. A change anywhere
  // else -- one byte of a Code body, one connection, one parameter -- shows up here.
  let approved = APPROVED_DIFF_PATHS.slice();
  webhookNodeIndexes(canonical).forEach((i) => { approved = approved.concat(webhookDiffPaths(i)); });

  const actual = diffPaths(canonical, safe);
  const approvedSet = new Set(approved);
  const unexpected = actual.filter((p) => !approvedSet.has(p));
  if (unexpected.length) {
    fail('unapproved difference(s) from the canonical candidate: ' + unexpected.slice(0, 12).join(', ')
      + (unexpected.length > 12 ? ' (+' + (unexpected.length - 12) + ' more)' : ''));
  }

  return { ok: failures.length === 0, failures: failures };
}

module.exports = {
  PRODUCTION_WORKFLOW_ID,
  PRODUCTION_WEBHOOK_PATH,
  IMPORT_SAFE_NAME,
  INERT_WEBHOOK_PATH,
  INTERNAL_TRIGGER_NAME,
  INTERNAL_TRIGGER_TYPE,
  INTERNAL_AUTH_ENTRY,
  WEBHOOK_TYPE,
  RESPOND_TYPE,
  CODE_TYPE,
  TELEGRAM_TYPE,
  STRIPPED_BRIEF,
  STRIPPED_DISCOVERED,
  STRIPPED_TOP_LEVEL,
  APPROVED_DIFF_PATHS,
  IMPORT_SAFE_GENERATOR,
  webhookDiffPaths,
  webhookNodeIndexes,
  nodesOfType,
  buildImportSafe,
  serializeImportSafe,
  diffPaths,
  reachableFromInternal,
  respondNodesAreGatedOff,
  verifyImportSafe
};
