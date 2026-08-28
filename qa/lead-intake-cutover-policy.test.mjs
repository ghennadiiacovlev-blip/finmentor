#!/usr/bin/env node
// FINMENTOR — LEAD INTAKE internal Model-B route: the approved-diff policy, and the mutations
// it must refuse.
//
//   node qa/lead-intake-cutover-policy.test.mjs
//
// Offline: no tenant, no credential, no network. A = the 57-node tracked production reference,
// B = the 100-node internal-route candidate, L = a synthetic live built from A so R(L) == A
// holds by construction.
//
// WHAT THIS GATE IS FOR. This cutover adds 43 nodes and A SECOND ENTRY POINT to the workflow
// that receives every lead the business gets. Two things can go wrong that a diff review would
// not catch, and both are represented below as mutations that land INSIDE an approved class:
//
//   1. THE ENTRY POINT. Until this phase the materializer refused any trigger-count change
//      outright. That refusal was correct and it is not relaxed here -- it is made specific.
//      A second WEBHOOK would be a second PUBLIC door onto the lead pipeline; the approved
//      trigger is an executeWorkflowTrigger, reachable only from inside the tenant. The type
//      pin is what separates those two, so mutation (T2) swaps exactly that and must be refused.
//
//   2. DUPLICATE LEADS. "No duplicate lead" is a fan-in property, not a code property. 43 new
//      nodes exist; any one of them growing an edge into Save to Pipeline or Update Pipeline
//      (Merge) writes a second row for one submission. Mutations (P1)/(P2) do exactly that.
//
// The CONTROL matters as much as the refusals: a policy that rejects everything would pass every
// mutation and deploy nothing.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));
const MZ = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'materializer.js'));
const P = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'lead-intake-cutover-policy.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const clone = (v) => JSON.parse(JSON.stringify(v));

const A = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
  'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
const B = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate',
  'lead-intake-internal-receipt-candidate.json'), 'utf8'));
const SEALFILE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'baseline-seal.json'), 'utf8'));

// R(L) == A by construction: the tracked reference with its marker replaced by an obviously
// fake concrete id.
const SYNTHETIC_ID = '900000999';
const L = JSON.parse(JSON.stringify(A).split('<REDACTED_CHAT_ID>').join(SYNTHETIC_ID));

const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);
const POLICY = P.LEAD_INTAKE_CUTOVER_POLICY;
const run = (over) => MZ.materializeDeployment(Object.assign({
  redactedReference: A, desiredReference: B, liveWorkflow: L,
  approvedDiffPolicy: POLICY, sealFile: SEALFILE
}, over || {}));

const outEdges = (wf, src) => (((wf.connections || {})[src] || {}).main || [])
  .map((br) => (br || []).map((l) => l.node));
const inEdges = (wf, target) => {
  const r = [];
  Object.keys(wf.connections || {}).forEach((s) => {
    ((wf.connections[s] || {}).main || []).forEach((br) => (br || []).forEach((l) => {
      if (l && l.node === target && r.indexOf(s) === -1) { r.push(s); }
    }));
  });
  return r.sort();
};
const isTrigger = (t) => /trigger$/i.test(String(t)) || String(t) === 'n8n-nodes-base.webhook';

console.log('\nFINMENTOR Lead Intake internal-route cutover policy\n');
console.log('-- the shape of the approved delta --');

check('the delta is exactly +43 nodes, no removals, no field changes', () => {
  eq(A.nodes.length, 57, 'the baseline is not the 57-node production reference');
  eq(B.nodes.length, 100, 'the candidate is not the 100-node internal-route target');
  const ops = MZ.computeDelta(A, B);
  const n = (op) => ops.filter((o) => o.op === op).length;
  eq(n('addNode'), 43, 'wrong number of added nodes');
  eq(n('removeNode'), 0, 'this cutover removes nothing');
  eq(n('setNodeField'), 0, 'this cutover changes no executable field on an inherited node');
  eq(n('setTopLevel'), 1, 'only the review name may differ at top level');
  eq(ops.filter((o) => o.op === 'setTopLevel')[0].field, 'name', 'a top-level field other than name changed');
});

check('every added node is pinned by BOTH id and name', () => {
  eq(P.APPROVED_ADDED_NODES.length, 43, 'the approved list is not 43 nodes');
  P.APPROVED_ADDED_NODES.forEach((name) => {
    const node = byName(B, name);
    assert(node, 'the candidate has no node ' + name);
    eq(node.id, P.ADDED_NODE_IDS[name], 'added node id drifted for ' + name);
  });
  eq(Object.keys(P.ADDED_NODE_IDS).length, 43, 'the id table and the approved list disagree');
});

check('the pinned edge set is exactly the candidate post-cutover edge set', () => {
  Object.keys(P.APPROVED_EDGES).forEach((src) => {
    eq(JSON.stringify(outEdges(B, src)), JSON.stringify(P.APPROVED_EDGES[src]),
      'edges from ' + src + ' are not the approved set');
  });
  eq(POLICY.pinnedOutEdges, P.APPROVED_EDGES, 'the declared edge set is not the one handed to the materializer');
});

console.log('\n-- the public route this phase may not touch --');

check('the public webhook is the SAME node, id and webhookId in the candidate', () => {
  const a = byName(A, P.PUBLIC_WEBHOOK_NODE);
  const b = byName(B, P.PUBLIC_WEBHOOK_NODE);
  assert(a && b, 'the public webhook is missing');
  eq(b.id, a.id, 'the public webhook node id changed');
  eq(b.webhookId, a.webhookId, 'the public webhook webhookId changed');
  eq(b.webhookId, P.PUBLIC_WEBHOOK_ID, 'the pinned webhookId is not the live one');
  eq(JSON.stringify(b.parameters), JSON.stringify(a.parameters), 'the public webhook parameters changed');
});

check('exactly ONE public entry point exists after the cutover', () => {
  const webhooks = B.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  eq(webhooks.length, 1, 'the candidate has ' + webhooks.length + ' webhook nodes');
  eq(webhooks[0].name, P.PUBLIC_WEBHOOK_NODE, 'the sole webhook is not the approved one');
});

check('the second entry point is INTERNAL, not public, and pinned three ways', () => {
  const t = byName(B, P.INTERNAL_TRIGGER_NODE);
  assert(t, 'the internal trigger is absent');
  eq(t.type, P.INTERNAL_TRIGGER_TYPE, 'the internal entry is not an executeWorkflowTrigger');
  eq(t.id, P.INTERNAL_TRIGGER_ID, 'the internal trigger id drifted');
  assert(!t.webhookId, 'the internal trigger carries a webhookId — it is reachable from outside');
  const rule = POLICY.approvedAddedTriggers.filter((r) => r.name === P.INTERNAL_TRIGGER_NODE)[0];
  assert(rule, 'the policy does not approve the internal trigger');
  eq(rule.type, P.INTERNAL_TRIGGER_TYPE, 'the policy approves the wrong trigger type');
  eq(POLICY.approvedAddedTriggers.length, 1, 'more than one trigger is approved for addition');
});

console.log('\n-- no duplicate lead: the pipeline writes --');

check('both Pipeline writes keep EXACTLY the one inbound edge they have live', () => {
  [[P.PIPELINE_WRITE_NEW, P.PIPELINE_WRITE_NEW_SOURCE],
    [P.PIPELINE_WRITE_MERGE, P.PIPELINE_WRITE_MERGE_SOURCE]].forEach(([node, src]) => {
    const live = inEdges(L, node);
    const cand = inEdges(B, node);
    eq(JSON.stringify(cand), JSON.stringify([src]), node + ' fan-in changed in the candidate');
    eq(JSON.stringify(live), JSON.stringify([src]), node + ' fan-in is not what live has');
  });
});

check('no added node reaches a Pipeline write', () => {
  P.APPROVED_ADDED_NODES.forEach((n) => {
    const outs = outEdges(B, n).flat();
    [P.PIPELINE_WRITE_NEW, P.PIPELINE_WRITE_MERGE].forEach((w) => {
      assert(outs.indexOf(w) === -1, n + ' writes to ' + w);
    });
  });
});

console.log('\n-- CONTROL --');

check('CONTROL: the real three-way input materializes to 100 nodes', () => {
  const v = run();
  assert(v.ok, 'materialization refused at ' + v.stage + ': ' + (v.failures || []).join(' | '));
  eq(v.cLive.nodes.length, 100, 'the materialized target is not 100 nodes');
  eq(v.cLive.nodes.filter((n) => isTrigger(n.type)).length, 2, 'the target does not have exactly 2 entry points');
  eq(R.findMarkers(v.cLive).length, 0, 'the materialized target carries redaction markers');
});

check('CONTROL: the public webhook keeps its LIVE values in the materialized target', () => {
  const v = run();
  const c = byName(v.cLive, P.PUBLIC_WEBHOOK_NODE);
  const l = byName(L, P.PUBLIC_WEBHOOK_NODE);
  eq(JSON.stringify(c.parameters), JSON.stringify(l.parameters), 'the public route parameters moved');
  eq(c.webhookId, l.webhookId, 'the public webhookId moved');
});

console.log('\n-- the mandatory mutation battery --');

function mustRefuse(label, over, expectStage, expectSubstring) {
  check('REFUSES: ' + label, () => {
    const v = run(over);
    assert(!v.ok, 'materialization SUCCEEDED for: ' + label);
    if (expectStage) { eq(v.stage, expectStage, 'wrong stage for ' + label); }
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'refused, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

// ---- the entry point ----------------------------------------------------------------------

mustRefuse('(T1) a SECOND PUBLIC WEBHOOK is added beside the approved internal entry', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ id: 'evil-webhook', name: 'Webhook Alt', type: 'n8n-nodes-base.webhook',
      typeVersion: 2, position: [0, 900], webhookId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      parameters: { path: 'lead-intake-alt', httpMethod: 'POST' } });
    return m;
  })()
}, 'POLICY', 'unapproved node added: Webhook Alt');

mustRefuse('(T2) THE TYPE PIN: the approved internal entry is swapped for a PUBLIC webhook', {
  // Same node name, same id, still "an added trigger the policy names". Only the type differs,
  // and that difference is an internal entry becoming a second public door onto the lead pipeline.
  desiredReference: (() => {
    const m = clone(B);
    const t = byName(m, P.INTERNAL_TRIGGER_NODE);
    t.type = 'n8n-nodes-base.webhook';
    t.webhookId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    t.parameters = { path: 'internal-alt', httpMethod: 'POST' };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'is a n8n-nodes-base.webhook, the policy approves ' + P.INTERNAL_TRIGGER_TYPE);

mustRefuse('(T3) the approved internal entry is a different node wearing the approved name', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, P.INTERNAL_TRIGGER_NODE).id = 'someone-elses-node';
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'has an unapproved id');

mustRefuse('(T4) COVERAGE: a policy that forgets to approve the trigger gets the old refusal', {
  approvedDiffPolicy: (() => {
    const pol = clone(POLICY);
    pol.approvedAddedTriggers = [];
    return pol;
  })()
}, 'ABSOLUTE_INVARIANTS', 'unapproved trigger added: ' + P.INTERNAL_TRIGGER_NODE);

mustRefuse('(T5) the PUBLIC webhook is deleted while the internal entry is added', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes = m.nodes.filter((n) => n.name !== P.PUBLIC_WEBHOOK_NODE);
    return m;
  })()
}, 'POLICY', 'not on the approved-removals allowlist');

// ---- duplicate leads ------------------------------------------------------------------------

mustRefuse('(P1) an added node grows an edge into Save to Pipeline — a second lead row', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Receipt Commit (New)'] = {
      main: [[{ node: P.PIPELINE_WRITE_NEW, type: 'main', index: 0 }]]
    };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'protected node ' + P.PIPELINE_WRITE_NEW + ' is fed by Receipt Commit (New)');

mustRefuse('(P2) an added node grows an edge into Update Pipeline (Merge)', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Receipt Commit (Merge)'] = {
      main: [[{ node: P.PIPELINE_WRITE_MERGE, type: 'main', index: 0 }]]
    };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'protected node ' + P.PIPELINE_WRITE_MERGE + ' is fed by Receipt Commit (Merge)');

// ---- the public route ------------------------------------------------------------------------

// Refused at POLICY, one stage EARLIER than immutableNodeParams would catch it: this cutover
// approves no modified node at all, so touching the webhook's parameters is already outside the
// delta. immutableNodeParams stays as the second net for the day some field IS granted here.
mustRefuse('(W1) the public webhook PATH is changed', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, P.PUBLIC_WEBHOOK_NODE).parameters.path = 'lead-intake-v2';
    return m;
  })()
}, 'POLICY', 'unapproved node modified: ' + P.PUBLIC_WEBHOOK_NODE);

mustRefuse('(W2) the public webhookId is repointed', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, P.PUBLIC_WEBHOOK_NODE).webhookId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    return m;
  })()
}, 'POLICY', 'unapproved node modified');

// ---- ordinary policy width -------------------------------------------------------------------

mustRefuse('(1) an extra node, even one that looks like the receipt set', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ id: 'li-extra', name: 'Receipt Commit (Retry)', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [2500, 420], parameters: { jsCode: 'return items;' } });
    return m;
  })()
}, 'POLICY', 'unapproved node added: Receipt Commit (Retry)');

mustRefuse('(2) an approved node missing from the candidate', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes = m.nodes.filter((n) => n.name !== 'Receipt Claim');
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'Receipt Claim');

mustRefuse('(3) an unapproved rewire of an inherited node', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Build Pipeline Row'] = { main: [[{ node: 'Internal Flag', type: 'main', index: 0 }]] };
    return m;
  })()
}, 'POLICY', 'unapproved rewire: Build Pipeline Row');

mustRefuse('(4) an added node re-points a pinned out-edge', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Internal Envelope Unwrap'] = { main: [[{ node: 'Internal Flag', type: 'main', index: 0 }]] };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'pinned out-edges differ on Internal Envelope Unwrap');

mustRefuse('(5) COVERAGE: an added node whose out-edges no pin entry approves', {
  approvedDiffPolicy: (() => {
    const pol = clone(POLICY);
    delete pol.pinnedOutEdges['Receipt Gate'];
    return pol;
  })()
}, 'ABSOLUTE_INVARIANTS', 'Receipt Gate has outgoing edges that no pinnedOutEdges entry approves');

mustRefuse('(6) an added node carrying a credential', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, 'Receipt Claim').credentials = { googleSheetsOAuth2Api: { id: 'X', name: 'Y' } };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'unapproved credential type');

mustRefuse('(7) live drifted from the tracked baseline', {
  liveWorkflow: (() => {
    const m = clone(L);
    byName(m, 'Validate Payload').parameters.jsCode += '// someone edited production';
    return m;
  })()
}, 'BASELINE_DRIFT');

mustRefuse('(8) a tracked redacted artifact supplied as the LIVE workflow', {
  liveWorkflow: A
}, 'INPUT', 'already contains redaction markers');

check('REFUSES: the evidence never carries a live literal', () => {
  const planted = clone(L);
  const n = byName(planted, 'Validate Payload');
  n.parameters.jsCode = 'const x = "' + SYNTHETIC_ID + '";\n' + n.parameters.jsCode;
  const v = run({ liveWorkflow: planted });
  const blob = JSON.stringify(v.evidence) + JSON.stringify(v.delta || []) + (v.failures || []).join(' ');
  assert(blob.indexOf(SYNTHETIC_ID) === -1, 'a live literal reached the evidence or the delta');
});

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
