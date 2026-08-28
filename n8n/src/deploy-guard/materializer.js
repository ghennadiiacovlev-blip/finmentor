// FINMENTOR — the three-way live deployment materializer.
//
// WHY THIS EXISTS.
//
// P7.5 deployed a production workflow generated from a tracked export. The export is redacted
// before it reaches git — correctly — so the artifact carried `<REDACTED_CHAT_ID>` where
// production carried `={{ $json.chat_id }}`, and the live bot lost its ability to reply.
//
// Every gate said yes. 31 differences classified, zero unexpected, and the live readback's
// fingerprint matched the artifact exactly. All true, and all worthless: the artifact was
// compared against the SAME redacted source it was generated from, and a marker present on both
// sides of a diff is invisible to that diff.
//
// The lesson is not "use an unredacted export". That would fix this instance and leave the shape
// intact: a full production object assembled offline and pushed over the live one, with every
// field it did not mean to change coming along for the ride.
//
// THE MODEL. Three documents, and the tracked ones only ever describe a PATCH:
//
//   A   tracked REDACTED reference     what production looked like, as far as git may know
//   B   tracked desired candidate      A plus the reviewed change, deterministically derived
//   L   fresh UNREDACTED live workflow the only thing that knows the real values
//
//   1.  R(L) must equal A on every safety-relevant field.  Otherwise production has drifted
//       from what was reviewed, and nothing may be deployed.
//   2.  delta = B - A.  Every path must be approved by policy.
//   3.  C_live = apply(delta, L).  ONLY the approved paths are taken from B.
//   4.  C_live - L must equal the approved delta, exactly.
//   5.  C_live must independently satisfy the absolute invariants.
//
// Step 3 is the one that matters. `Send Client Message` is not in the approved delta, so its
// parameters are never read from B — they come from L, real expression and all. The redaction
// cannot reach the deployed object because the redacted document is never a source for anything
// the delta does not name.
//
// Step 5 is the second thing P7.5 lacked. Steps 1-4 are all COMPARATIVE, and a comparative check
// cannot see a defect present on both sides. The absolute invariants are checked against C_live
// alone, with no reference document involved.
//
// THIS MODULE IS GENERIC. It knows nothing about the Concierge. The caller supplies A, B, L and
// a policy; n8n/src/deploy-guard/concierge-cutover-policy.js is one such policy and the Lead
// Intake chain can have another.
//
// SECRETS. L and C_live are sensitive. This module returns them to its caller and never logs
// them. Its `evidence` object contains hashes, counts and path names only — it is designed to be
// safe to print and to commit.

'use strict';

const { createHash } = require('crypto');
const R = require('./redactor.js');

// Fields that carry behaviour. A difference here is a real change.
const EXECUTABLE_FIELDS = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled',
  'webhookId', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData',
  'continueOnFail', 'executeOnce'];

// Top-level fields the update schema accepts. Nothing else may be deployed.
const DEPLOYABLE_FIELDS = ['name', 'nodes', 'connections', 'settings'];

// Top-level fields that legitimately differ between a live workflow and a tracked export, and
// which say nothing about behaviour.
const IGNORED_TOP_LEVEL = ['id', 'versionId', 'activeVersionId', 'versionCounter', 'createdAt',
  'updatedAt', 'triggerCount', 'sourceWorkflowId', 'shared', 'activeVersion', 'isArchived',
  'active', 'tags', 'meta', 'staticData', 'description', 'nodeGroups', 'pinData', 'scopes',
  'canExecute', 'parentFolderId'];

const clone = (v) => JSON.parse(JSON.stringify(v));
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');
const nodeMap = (wf) => { const m = {}; (wf.nodes || []).forEach((n) => { m[n.name] = n; }); return m; };

// ---------------------------------------------------------------- step 1: baseline equivalence

// R(L) must equal A on every safety-relevant field. Position and notes are cosmetic; node ids
// and the top-level metadata above are not behaviour.
function baselineEquivalence(A, RL) {
  const diffs = [];
  const an = nodeMap(A);
  const rn = nodeMap(RL);

  const aNames = Object.keys(an).sort();
  const rNames = Object.keys(rn).sort();
  if (JSON.stringify(aNames) !== JSON.stringify(rNames)) {
    const missing = aNames.filter((n) => rNames.indexOf(n) === -1);
    const extra = rNames.filter((n) => aNames.indexOf(n) === -1);
    if (missing.length) { diffs.push('node(s) in the tracked reference but not live: ' + missing.join(', ')); }
    if (extra.length) { diffs.push('node(s) live but not in the tracked reference: ' + extra.join(', ')); }
  }

  aNames.forEach((name) => {
    const a = an[name];
    const r = rn[name];
    if (!r) { return; }
    EXECUTABLE_FIELDS.forEach((k) => {
      if (JSON.stringify(a[k]) !== JSON.stringify(r[k])) { diffs.push('nodes[' + name + '].' + k); }
    });
  });

  if (JSON.stringify(A.connections) !== JSON.stringify(RL.connections)) { diffs.push('connections'); }
  if (JSON.stringify(A.settings) !== JSON.stringify(RL.settings)) { diffs.push('settings'); }
  if (A.name !== RL.name) { diffs.push('name'); }

  return { ok: diffs.length === 0, diffs: diffs };
}

// ---------------------------------------------------------------- step 2: the delta

// A -> B expressed as node-level and top-level operations. Deliberately NOT raw JSON paths: an
// n8n graph is keyed by node name, and a patch that speaks in node names is one a reviewer can
// read.
function computeDelta(A, B) {
  const ops = [];
  const an = nodeMap(A);
  const bn = nodeMap(B);

  Object.keys(bn).forEach((name) => {
    if (!an[name]) { ops.push({ op: 'addNode', node: name }); }
  });
  Object.keys(an).forEach((name) => {
    if (!bn[name]) { ops.push({ op: 'removeNode', node: name }); }
  });
  Object.keys(an).forEach((name) => {
    if (!bn[name]) { return; }
    EXECUTABLE_FIELDS.forEach((k) => {
      if (JSON.stringify(an[name][k]) !== JSON.stringify(bn[name][k])) {
        ops.push({ op: 'setNodeField', node: name, field: k });
      }
    });
  });

  const srcs = new Set(Object.keys(A.connections || {}).concat(Object.keys(B.connections || {})));
  srcs.forEach((src) => {
    if (JSON.stringify((A.connections || {})[src]) !== JSON.stringify((B.connections || {})[src])) {
      ops.push({ op: 'setConnections', source: src });
    }
  });

  ['name', 'settings'].forEach((k) => {
    if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) { ops.push({ op: 'setTopLevel', field: k }); }
  });

  return ops;
}

// ---------------------------------------------------------------- step 2b: policy

// Some differences between A and B are properties of the REVIEW candidate rather than desired
// production changes. The Concierge candidate is named "...B21C ISSUER CANDIDATE" so a reviewer
// can tell it apart on the canvas; production must keep its own name.
//
// Such fields are declared in policy.topLevelFromLive and removed from the delta BEFORE
// validation, with the removal recorded. They are not silently dropped and they are not
// approved-and-applied — they are stated as "this value comes from LIVE", which is the only
// description that is true.
function partitionDelta(ops, policy) {
  const fromLive = (policy || {}).topLevelFromLive || [];
  const retained = [];
  const kept = ops.filter((o) => {
    if (o.op === 'setTopLevel' && fromLive.indexOf(o.field) !== -1) { retained.push(o.field); return false; }
    return true;
  });
  return { ops: kept, retainedFromLive: retained };
}

function validateDelta(ops, policy) {
  const p = policy || {};
  const added = p.approvedAddedNodes || [];
  const modified = p.approvedModifiedNodes || {};
  const rewired = p.approvedRewiredSources || [];
  const topLevel = p.approvedTopLevel || [];
  const fields = p.approvedModifiedFields || ['parameters'];

  const rejected = [];
  ops.forEach((o) => {
    if (o.op === 'addNode') {
      if (added.indexOf(o.node) === -1) { rejected.push('unapproved node added: ' + o.node); }
    } else if (o.op === 'removeNode') {
      // Removal is approvable ONLY through an exact, fully-specified allowlist entry. Until
      // P8.3A it was refused outright, which was safe but left dead nodes in production
      // forever. The bar below is high enough that an accidental removal cannot clear it.
      const rule = (p.approvedRemovals || []).find((r) => r && r.name === o.node);
      if (!rule) {
        rejected.push('node removal is not on the approved-removals allowlist: ' + o.node);
      } else if (!rule.id || !rule.name) {
        rejected.push('removal rule for ' + o.node + ' must name BOTH the exact node id and name');
      } else if (!rule.klass) {
        rejected.push('removal rule for ' + o.node + ' has no approved removal class');
      } else if (!Array.isArray(rule.inbound) || !Array.isArray(rule.outbound)) {
        rejected.push('removal rule for ' + o.node + ' must account for its inbound and outbound edges explicitly');
      }
    } else if (o.op === 'setNodeField') {
      if (!Object.prototype.hasOwnProperty.call(modified, o.node)) {
        rejected.push('unapproved node modified: ' + o.node + '.' + o.field);
      } else if (fields.indexOf(o.field) === -1) {
        rejected.push('approved node ' + o.node + ' changed a field policy does not allow: ' + o.field);
      }
    } else if (o.op === 'setConnections') {
      if (rewired.indexOf(o.source) === -1 && added.indexOf(o.source) === -1) {
        rejected.push('unapproved rewire: ' + o.source);
      }
    } else if (o.op === 'setTopLevel') {
      if (topLevel.indexOf(o.field) === -1) { rejected.push('unapproved top-level change: ' + o.field); }
    } else {
      rejected.push('unknown operation: ' + JSON.stringify(o.op));
    }
  });
  return { ok: rejected.length === 0, rejected: rejected };
}

// ---------------------------------------------------------------- step 3: apply

// C_live = apply(delta, L). Values come from B ONLY for the paths the delta names. Everything
// else — every untouched node, every field of a touched node the delta did not name, the whole
// of `name` and `settings` unless explicitly approved — comes from L.
function applyDelta(L, B, ops, policy) {
  const out = clone(L);
  const bn = nodeMap(B);
  const idx = {};
  out.nodes.forEach((n, i) => { idx[n.name] = i; });

  ops.forEach((o) => {
    if (o.op === 'addNode') {
      out.nodes.push(clone(bn[o.node]));
      idx[o.node] = out.nodes.length - 1;
    } else if (o.op === 'removeNode') {
      // The removal is verified against LIVE, not against the reference: the identity that
      // matters is the one being deleted from production. Both id and name must match, and the
      // edges around it must be exactly what the rule declared — a node whose wiring has
      // changed since the rule was written is not the node the rule approved.
      const rule = ((policy || {}).approvedRemovals || []).find((r) => r.name === o.node);
      const live = out.nodes.find((n) => n.name === o.node);
      if (!live) { throw new Error('removal names a node the live workflow does not have: ' + o.node); }
      if (live.id !== rule.id) {
        throw new Error('removal id mismatch for ' + o.node + ': live id is not the approved one');
      }
      const inbound = [];
      Object.keys(out.connections || {}).forEach((src) => {
        ((out.connections[src] || {}).main || []).forEach((br) => (br || []).forEach((l) => {
          if (l && l.node === o.node && inbound.indexOf(src) === -1) { inbound.push(src); }
        }));
      });
      const outbound = [...new Set((((out.connections || {})[o.node] || {}).main || [])
        .flat().map((l) => l.node))];
      const same = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
      if (!same(inbound, rule.inbound)) {
        throw new Error('removal of ' + o.node + ': live inbound edges ' + JSON.stringify(inbound)
          + ' do not match the approved ' + JSON.stringify(rule.inbound));
      }
      if (!same(outbound, rule.outbound)) {
        throw new Error('removal of ' + o.node + ': live outbound edges ' + JSON.stringify(outbound)
          + ' do not match the approved ' + JSON.stringify(rule.outbound));
      }
      // Drop the node and every edge that mentioned it. Leaving a dangling reference would be a
      // graph n8n cannot load.
      out.nodes = out.nodes.filter((n) => n.name !== o.node);
      delete out.connections[o.node];
      Object.keys(out.connections).forEach((src) => {
        out.connections[src].main = (out.connections[src].main || [])
          .map((br) => (br || []).filter((l) => l.node !== o.node));
      });
      Object.keys(idx).forEach((k) => { delete idx[k]; });
      out.nodes.forEach((n, i) => { idx[n.name] = i; });
    } else if (o.op === 'setNodeField') {
      const i = idx[o.node];
      if (i === undefined) { throw new Error('delta names a node the live workflow does not have: ' + o.node); }
      const v = bn[o.node][o.field];
      if (v === undefined) { delete out.nodes[i][o.field]; } else { out.nodes[i][o.field] = clone(v); }
    } else if (o.op === 'setConnections') {
      out.connections = out.connections || {};
      const v = (B.connections || {})[o.source];
      if (v === undefined) { delete out.connections[o.source]; } else { out.connections[o.source] = clone(v); }
    } else if (o.op === 'setTopLevel') {
      out[o.field] = clone(B[o.field]);
    }
  });

  // The deployable projection: only the four fields the update schema accepts.
  const deployable = {};
  DEPLOYABLE_FIELDS.forEach((k) => { if (out[k] !== undefined) { deployable[k] = out[k]; } });
  return deployable;
}

// ---------------------------------------------------------------- step 4: L -> C_live

// The differences between the live workflow and the materialized one must correspond exactly to
// the approved delta — no more, and no fewer.
function verifyAppliedDelta(L, C, ops) {
  const problems = [];
  const ln = nodeMap(L);
  const cn = nodeMap(C);

  const expectedAdded = ops.filter((o) => o.op === 'addNode').map((o) => o.node).sort();
  const actualAdded = Object.keys(cn).filter((n) => !ln[n]).sort();
  if (JSON.stringify(expectedAdded) !== JSON.stringify(actualAdded)) {
    problems.push('added nodes are ' + JSON.stringify(actualAdded) + ', delta says ' + JSON.stringify(expectedAdded));
  }
  const expectedRemoved = ops.filter((o) => o.op === 'removeNode').map((o) => o.node).sort();
  const removed = Object.keys(ln).filter((n) => !cn[n]).sort();
  if (JSON.stringify(removed) !== JSON.stringify(expectedRemoved)) {
    problems.push('removed nodes are ' + JSON.stringify(removed) + ', delta says ' + JSON.stringify(expectedRemoved));
  }

  const expectedFields = {};
  ops.filter((o) => o.op === 'setNodeField').forEach((o) => {
    expectedFields[o.node] = expectedFields[o.node] || [];
    expectedFields[o.node].push(o.field);
  });

  Object.keys(ln).forEach((name) => {
    const l = ln[name];
    const c = cn[name];
    if (!c) { return; }
    EXECUTABLE_FIELDS.forEach((k) => {
      const differs = JSON.stringify(l[k]) !== JSON.stringify(c[k]);
      const approved = (expectedFields[name] || []).indexOf(k) !== -1;
      if (differs && !approved) { problems.push('UNAPPROVED change to nodes[' + name + '].' + k); }
      if (!differs && approved) {
        // Not a failure in itself — B and L may already agree — but it must be visible, because
        // a delta that changes nothing is a delta that was computed against the wrong baseline.
        problems.push('delta claims nodes[' + name + '].' + k + ' changes, but live already matches');
      }
    });
  });

  const expectedSrcs = ops.filter((o) => o.op === 'setConnections').map((o) => o.source).sort();
  const actualSrcs = [...new Set(Object.keys(L.connections || {}).concat(Object.keys(C.connections || {})))]
    .filter((s) => JSON.stringify((L.connections || {})[s]) !== JSON.stringify((C.connections || {})[s])).sort();
  if (JSON.stringify(expectedSrcs) !== JSON.stringify(actualSrcs)) {
    problems.push('rewired sources are ' + JSON.stringify(actualSrcs) + ', delta says ' + JSON.stringify(expectedSrcs));
  }

  const topOps = ops.filter((o) => o.op === 'setTopLevel').map((o) => o.field);
  ['name', 'settings'].forEach((k) => {
    const differs = JSON.stringify(L[k]) !== JSON.stringify(C[k]);
    if (differs && topOps.indexOf(k) === -1) { problems.push('UNAPPROVED top-level change: ' + k); }
  });

  return { ok: problems.length === 0, problems: problems };
}

// ---------------------------------------------------------------- step 5: absolute invariants

// Checked against C_live ALONE. No reference document is involved, because a comparative check
// cannot see a defect that is present on both sides — which is exactly how P7.5 passed.
function absoluteInvariants(C, L, policy) {
  const p = policy || {};
  const failures = [];
  const fail = (m) => failures.push(m);
  const cn = nodeMap(C);
  const ln = nodeMap(L);

  // 1. No redaction marker, anywhere, of any shape.
  const markers = R.findMarkers(C);
  if (markers.length) {
    fail('redaction marker(s) in the materialized artifact: '
      + markers.map((m) => m.marker + ' x' + m.count).join(', ')
      + ' on node(s): ' + R.markedNodes(C).join(', '));
  }

  // 2. Declared semantic expressions, checked by value and not by diff.
  (p.requiredExpressions || []).forEach((r) => {
    const n = cn[r.node];
    if (!n) { fail('required node absent: ' + r.node); return; }
    let v = n.parameters;
    for (const seg of r.path) { v = (v === undefined || v === null) ? undefined : v[seg]; }
    if (v !== r.value) {
      fail('node ' + r.node + ' parameter ' + r.path.join('.') + ' is not the required expression'
        + ' (got ' + JSON.stringify(v) + ')');
    }
  });

  // 3. Trigger topology and identity.
  const isTrigger = (t) => /trigger$/i.test(String(t)) || String(t) === 'n8n-nodes-base.webhook';
  const cTrig = (C.nodes || []).filter((n) => isTrigger(n.type));
  const lTrig = (L.nodes || []).filter((n) => isTrigger(n.type));

  // 3a. ADDED TRIGGERS. An entry point is the one thing an attacker most wants to add, so this
  //     was an absolute refusal: trigger count may not move. That is right for the Concierge and
  //     wrong for a workflow whose whole phase IS a second entry point -- Lead Intake's internal
  //     Model-B route is an executeWorkflowTrigger beside the existing public webhook.
  //
  //     So the rule is not relaxed, it is made SPECIFIC, and it stays closed by default: a
  //     trigger may appear only if the policy names it by name AND type AND id, only if it is
  //     also an approved added node, and NO trigger may ever disappear or change. A policy that
  //     forgets to list one gets the old refusal. Type is pinned because the difference between
  //     an executeWorkflowTrigger and a webhook is the difference between an internal entry and
  //     a second PUBLIC one, and that must never be a detail nobody had to write down.
  const approvedTrigs = p.approvedAddedTriggers || [];
  const lTrigNames = lTrig.map((n) => n.name);
  const addedTrigs = cTrig.filter((n) => lTrigNames.indexOf(n.name) === -1);
  const goneTrigs = lTrig.filter((n) => !cn[n.name]);
  goneTrigs.forEach((n) => { fail('a trigger was removed: ' + n.name); });
  addedTrigs.forEach((n) => {
    const rule = approvedTrigs.filter((r) => r.name === n.name)[0];
    if (!rule) { fail('unapproved trigger added: ' + n.name + ' (' + n.type + ')'); return; }
    if (rule.type !== n.type) {
      fail('added trigger ' + n.name + ' is a ' + n.type + ', the policy approves ' + rule.type);
    }
    if (rule.id && n.id !== rule.id) { fail('added trigger ' + n.name + ' has an unapproved id'); }
    if ((p.approvedAddedNodes || []).indexOf(n.name) === -1) {
      fail('trigger ' + n.name + ' is approved as a trigger but is not an approved added node');
    }
  });
  // A pin nobody satisfied is not a pin: every approved trigger must actually be there.
  approvedTrigs.forEach((r) => {
    if (!cn[r.name]) { fail('approved added trigger is missing from the candidate: ' + r.name); }
  });
  if (cTrig.length !== lTrig.length + addedTrigs.length - goneTrigs.length) {
    fail('trigger count changed: ' + lTrig.length + ' -> ' + cTrig.length);
  }
  if (p.triggerNode) {
    const c = cn[p.triggerNode];
    const l = ln[p.triggerNode];
    if (!c) { fail('the trigger node is absent: ' + p.triggerNode); }
    else if (!l) { fail('the live workflow has no node named ' + p.triggerNode); }
    else {
      if (c.type !== l.type) { fail('trigger type changed'); }
      if (JSON.stringify(c.credentials) !== JSON.stringify(l.credentials)) { fail('trigger credential changed'); }
      if (c.webhookId !== l.webhookId) { fail('trigger webhookId changed'); }
      if (JSON.stringify(c.disabled) !== JSON.stringify(l.disabled)) { fail('trigger enabled/disabled state changed'); }
      if (p.expectedCredentialId) {
        const got = ((c.credentials || {}).telegramApi || {}).id;
        if (got !== p.expectedCredentialId) { fail('trigger credential id is not the expected one'); }
      }
      if (p.expectedWebhookId && c.webhookId !== p.expectedWebhookId) { fail('trigger webhookId is not the expected one'); }
    }
  }

  // 4. No credential may appear that the live workflow did not already have on that node.
  Object.keys(cn).forEach((name) => {
    const c = cn[name];
    const l = ln[name];
    if (!c.credentials) { return; }
    if (!l) {
      const allowed = p.approvedNewNodeCredentials || [];
      Object.keys(c.credentials).forEach((k) => {
        if (allowed.indexOf(k) === -1) { fail('added node ' + name + ' carries an unapproved credential type: ' + k); }
      });
      return;
    }
    if (JSON.stringify(c.credentials) !== JSON.stringify(l.credentials)) {
      fail('credential reference changed on existing node: ' + name);
    }
  });

  // 4b. Removals may never touch a trigger, a credential-bearing node, or anything the policy
  //     has not separately authorised. A removal that takes a credential with it is not a
  //     cleanup, it is an outage.
  const removedNames = Object.keys(ln).filter((n) => !cn[n]);
  removedNames.forEach((name) => {
    const l = ln[name];
    const rule = (p.approvedRemovals || []).find((r) => r.name === name);
    if (!rule) { fail('node ' + name + ' was removed without an approved-removals entry'); return; }
    const isTrigger = /trigger$/i.test(String(l.type)) || String(l.type) === 'n8n-nodes-base.webhook';
    if (isTrigger && rule.allowTrigger !== true) {
      fail('removal of TRIGGER node ' + name + ' requires explicit separate authorisation');
    }
    if (l.credentials && rule.allowCredentialBearing !== true) {
      fail('removal of credential-bearing node ' + name + ' requires explicit separate authorisation');
    }
  });

  // 4c. No dangling connection may survive a removal — a reference to a node that is gone is a
  //     graph n8n cannot load.
  const names = new Set((C.nodes || []).map((n) => n.name));
  Object.keys(C.connections || {}).forEach((src) => {
    if (!names.has(src)) { fail('connections reference a removed source node: ' + src); }
    ((C.connections[src] || {}).main || []).forEach((br) => (br || []).forEach((l) => {
      if (l && !names.has(l.node)) { fail('connection from ' + src + ' targets a removed node: ' + l.node); }
    }));
  });

  // 4d. PROTECTED FAN-IN. An added node may wire itself freely — that is what "new graph" means,
  //     and validateDelta allows it. But for a node whose SAFETY PROPERTY IS ITS FAN-IN, that
  //     freedom is a hole: the P8.3A battery proved a new node could route an edge straight back
  //     into the authority write, recreating the second write path P8.2R withdrew, and every
  //     stage passed it. Approving a node is not approving where it points.
  (p.protectedFanIn || []).forEach((rule) => {
    const inbound = [];
    Object.keys(C.connections || {}).forEach((src) => {
      ((C.connections[src] || {}).main || []).forEach((br) => (br || []).forEach((l) => {
        if (l && l.node === rule.node && inbound.indexOf(src) === -1) { inbound.push(src); }
      }));
    });
    const allowed = rule.allowedSources || [];
    inbound.forEach((s) => {
      if (allowed.indexOf(s) === -1) {
        fail('protected node ' + rule.node + ' is fed by ' + s + ', which is not an approved source');
      }
    });
    if (rule.exactly !== undefined && inbound.length !== rule.exactly) {
      fail('protected node ' + rule.node + ' has ' + inbound.length
        + ' incoming edge(s), and exactly ' + rule.exactly + ' is approved');
    }
  });

  // 4d-i. APPROVED REMOVALS MUST ACTUALLY HAPPEN. `approvedRemovals` was only ever read as a
  //     PERMISSION — "you may delete this" — so a delta that simply did not perform the removal
  //     produced no op at all and nothing objected. P8.4B is where that matters: the whole point
  //     of the migration is that the PUBLIC HTTP submit stops existing, and a candidate that kept
  //     it while adding the internal call would have deployed both paths and passed.
  (p.approvedRemovals || []).forEach((rule) => {
    if (cn[rule.name]) {
      fail('approved removal was NOT performed: ' + rule.name + ' is still in the candidate');
    }
  });

  // 4d-ii. PINNED PARAMETERS ON ADDED NODES. `approvedAddedNodes` approves a node by NAME, and
  //     until this phase that was all it approved: the node's parameters were unconstrained, so
  //     an approved name could carry any body at all. `immutableNodeParams` could not help --
  //     it pins a candidate value to its LIVE counterpart, and an added node has none.
  //
  //     That is the same hole `pinnedOutEdges` closed for edges, one level down. Write B's
  //     battery found it three ways: the Execute Workflow target could be repointed at another
  //     workflow, made a caller-steerable EXPRESSION, or the handoff body could be rewritten to
  //     take the submission_key from the request or mint a fresh one -- each of them inside an
  //     "approved" node, each materializing cleanly.
  //
  //     `equals` pins an exact value; `sha256` pins a whole body without reproducing it here.
  (p.pinnedAddedNodeParams || []).forEach((rule) => {
    const c = cn[rule.node];
    if (!c) { fail('pinned added node is absent: ' + rule.node); return; }
    let v = c;
    String(rule.path).split('.').forEach((k) => { v = (v == null ? v : v[k]); });
    if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
      if (v !== rule.equals) {
        fail('pinned parameter differs on ' + rule.node + '.' + rule.path
          + ': candidate has ' + JSON.stringify(v) + ', policy approves ' + JSON.stringify(rule.equals));
      }
    }
    if (rule.sha256) {
      const got = sha(typeof v === 'string' ? v : JSON.stringify(v));
      if (got !== rule.sha256) {
        fail('pinned parameter body changed on ' + rule.node + '.' + rule.path
          + ' (sha ' + got.slice(0, 12) + ' vs approved ' + String(rule.sha256).slice(0, 12) + ')');
      }
    }
    if (rule.mustNotMatch && typeof v === 'string' && new RegExp(rule.mustNotMatch).test(v)) {
      fail('pinned parameter on ' + rule.node + '.' + rule.path + ' matches a forbidden pattern: ' + rule.mustNotMatch);
    }
  });

  // 4e. IMMUTABLE PARAMETER PATHS. `approvedModifiedFields` is coarse: granting `parameters` to a
  //     node so it can drop a header also grants it the URL. The battery proved that too — the
  //     public Lead Intake route could be repointed inside an approved field. These paths must
  //     equal LIVE even on a node the policy otherwise allows to change.
  (p.immutableNodeParams || []).forEach((rule) => {
    const c = cn[rule.node];
    const l = ln[rule.node];
    if (!c || !l) { return; }
    (rule.paths || []).forEach((path) => {
      const read = (n) => String(path).split('.').reduce((v, k) => (v === undefined || v === null ? v : v[k]), n);
      if (JSON.stringify(read(c)) !== JSON.stringify(read(l))) {
        fail('immutable parameter changed on ' + rule.node + ': ' + path);
      }
    });
  });

  // 4f. PINNED OUT-EDGES. `protectedFanIn` guards a node by who may point AT it, which needs
  //     the hazard named in advance. This is the other direction and is closed by default: a
  //     source listed here must have EXACTLY the branches listed, and every node the delta adds
  //     or rewires MUST be listed. P8.3A declared an APPROVED_EDGES map, called it "the exact
  //     post-cutover edge set", and never passed it to the materializer — so it constrained a
  //     QA assertion over the sources it happened to name, and nothing at deploy time. An added
  //     node that grew its FIRST outgoing edge was in neither set and materialized cleanly.
  const pinned = p.pinnedOutEdges;
  if (pinned) {
    const outOf = (src) => ((((C.connections || {})[src] || {}).main) || [])
      .map((br) => (br || []).map((l) => l.node));
    Object.keys(pinned).forEach((src) => {
      if (JSON.stringify(outOf(src)) !== JSON.stringify(pinned[src])) {
        fail('pinned out-edges differ on ' + src + ': candidate has '
          + JSON.stringify(outOf(src)) + ', policy approves ' + JSON.stringify(pinned[src]));
      }
    });
    // A pin nobody wrote is not a pin. Coverage is the half that makes this closed by default.
    (p.approvedAddedNodes || []).concat(p.approvedRewiredSources || []).forEach((n) => {
      if ((C.connections || {})[n] && !Object.prototype.hasOwnProperty.call(pinned, n)) {
        fail('node ' + n + ' has outgoing edges that no pinnedOutEdges entry approves');
      }
    });
  }

  // 5. Settings.
  if (!C.settings || C.settings.availableInMCP !== false) { fail('settings.availableInMCP must be exactly false'); }

  // 6. Only the deployable fields.
  const extra = Object.keys(C).filter((k) => DEPLOYABLE_FIELDS.indexOf(k) === -1);
  if (extra.length) { fail('the artifact carries fields the update schema rejects: ' + extra.join(', ')); }
  if (Object.prototype.hasOwnProperty.call(C, 'active')) {
    fail('`active` must be absent — the live lifecycle is preserved by construction');
  }

  // 7. No literal Telegram identity may be INTRODUCED that the live workflow did not already
  //    carry. Compares the multiset of concrete digit literals, never their values.
  const literals = (wf) => {
    const found = [];
    const walk = (v, key) => {
      if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
      if (v && typeof v === 'object') { Object.keys(v).forEach((k) => walk(v[k], k)); return; }
      if (typeof v === 'string' && R.CHAT_FIELD_RE.test(String(key)) && R.isConcreteChatId(v)) {
        found.push(sha(v).slice(0, 12));
      }
    };
    walk(wf, '');
    return found.sort();
  };
  const lLit = literals(L);
  const cLit = literals(C);
  const introduced = cLit.filter((x) => { const i = lLit.indexOf(x); if (i === -1) { return true; } lLit.splice(i, 1); return false; });
  if (introduced.length) {
    fail(introduced.length + ' literal chat identit(ies) introduced that the live workflow did not carry');
  }

  return { ok: failures.length === 0, failures: failures };
}

// ---------------------------------------------------------------- the whole thing

function materializeDeployment(input) {
  const A = input.redactedReference;
  const B = input.desiredReference;
  const L = input.liveWorkflow;
  const policy = input.approvedDiffPolicy || {};

  const evidence = {
    redactedReferenceSha: sha(A),
    desiredReferenceSha: sha(B),
    liveBaselineSha: sha(L),
    steps: {}
  };

  // ---- stage 0: has the PREVIOUS cutover of this workflow been sealed? --------------------
  //
  // This runs before everything else because it is not a question about these three documents;
  // it is the question of whether deploying this workflow at all is permitted right now. An
  // unsealed prior cutover means `A` describes neither the production that was, nor the one
  // that is, so every check below would be comparing against a reference that means nothing --
  // and BASELINE_DRIFT would be the diagnosis, which is the wrong one and invites the exact
  // repair the model exists to prevent: rebaseline from live until the check goes quiet.
  //
  // FAIL CLOSED ON ABSENCE. A caller that supplies no seal file is refused, rather than
  // defaulting to "allowed". §8 shipped this rule as a library function with a unit test and no
  // caller, so nothing was actually gated by it; requiring the input is what makes every driver
  // inherit the gate instead of remembering to ask for it.
  //
  // Required lazily: baseline-seal.js requires this module for baselineEquivalence, so a
  // top-level require here would be a cycle and would see a half-built exports object.
  const SEAL = require('./baseline-seal.js');
  const wid = policy.productionWorkflowId;
  if (!input.sealFile) {
    return { ok: false, stage: 'SEAL_PREFLIGHT', evidence: evidence, failures: [
      'no baseline seal file supplied; a deployment cannot be authorised without knowing '
      + 'whether the previous cutover of this workflow was sealed'
    ] };
  }
  if (!wid) {
    return { ok: false, stage: 'SEAL_PREFLIGHT', evidence: evidence, failures: [
      'the policy names no productionWorkflowId, so the seal history cannot be looked up'
    ] };
  }
  const sealOk = SEAL.preflightSealCheck(input.sealFile, wid);
  evidence.steps.sealPreflight = { ok: sealOk.ok, workflowId: wid };
  if (!sealOk.ok) {
    return { ok: false, stage: 'SEAL_PREFLIGHT', evidence: evidence, failures: [sealOk.reason] };
  }

  // A tracked reference is allowed — expected, even — to be redacted. A LIVE workflow never is.
  if (R.hasMarkers(L)) {
    evidence.steps.liveIsRedacted = false;
    return { ok: false, stage: 'INPUT', failures: ['the supplied live workflow already contains redaction markers; it is not a live export'], evidence: evidence };
  }

  const RL = R.redactWorkflow(L);
  evidence.liveRedactedSha = sha(RL);

  const base = baselineEquivalence(A, RL);
  evidence.steps.baselineEquivalence = { ok: base.ok, diffCount: base.diffs.length };
  if (!base.ok) {
    return { ok: false, stage: 'BASELINE_DRIFT', failures: base.diffs, evidence: evidence };
  }

  const rawOps = computeDelta(A, B);
  const part = partitionDelta(rawOps, policy);
  const ops = part.ops;
  evidence.retainedFromLive = part.retainedFromLive;
  evidence.steps.delta = {
    total: ops.length,
    addNode: ops.filter((o) => o.op === 'addNode').length,
    setNodeField: ops.filter((o) => o.op === 'setNodeField').length,
    setConnections: ops.filter((o) => o.op === 'setConnections').length,
    setTopLevel: ops.filter((o) => o.op === 'setTopLevel').length,
    removeNode: ops.filter((o) => o.op === 'removeNode').length
  };

  const pol = validateDelta(ops, policy);
  evidence.steps.policy = { ok: pol.ok, rejectedCount: pol.rejected.length };
  if (!pol.ok) {
    return { ok: false, stage: 'POLICY', failures: pol.rejected, evidence: evidence, delta: ops };
  }

  let C;
  try { C = applyDelta(L, B, ops, policy); }
  catch (e) { return { ok: false, stage: 'APPLY', failures: [e.message], evidence: evidence, delta: ops }; }
  evidence.materializedSha = sha(C);

  const applied = verifyAppliedDelta(L, C, ops);
  evidence.steps.appliedDelta = { ok: applied.ok, problemCount: applied.problems.length };
  if (!applied.ok) {
    return { ok: false, stage: 'APPLIED_DELTA', failures: applied.problems, evidence: evidence, delta: ops };
  }

  const abs = absoluteInvariants(C, L, policy);
  evidence.steps.absoluteInvariants = { ok: abs.ok, failureCount: abs.failures.length };
  if (!abs.ok) {
    return { ok: false, stage: 'ABSOLUTE_INVARIANTS', failures: abs.failures, evidence: evidence, delta: ops };
  }

  return { ok: true, stage: 'MATERIALIZED', cLive: C, delta: ops, evidence: evidence, failures: [] };
}

module.exports = {
  EXECUTABLE_FIELDS,
  DEPLOYABLE_FIELDS,
  IGNORED_TOP_LEVEL,
  sha,
  baselineEquivalence,
  computeDelta,
  partitionDelta,
  validateDelta,
  applyDelta,
  verifyAppliedDelta,
  absoluteInvariants,
  materializeDeployment
};
