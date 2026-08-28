#!/usr/bin/env node
// FINMENTOR — P8.3A: the approved-diff policy, and the mutations it must refuse.
//
//   node qa/p83a-cutover-policy.test.mjs
//
// Offline: no tenant, no credential, no network. A = the sealed 45-node production baseline,
// B = the 50-node P8.3A candidate, L = a synthetic live built from A so that R(L) == A holds by
// construction.
//
// WHAT THIS GATE IS FOR. The policy is written by hand, so the thing that can go wrong is that
// it is written too WIDE — approving a class of change rather than the change. Every mutation
// below is a plausible edit that lands inside an approved class and must still be refused.
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
const SEALM = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'baseline-seal.js'));
const P = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'concierge-p83a-cutover-policy.js'));

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
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
const B = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-p83-candidate.json'), 'utf8'));
const SEALFILE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'baseline-seal.json'), 'utf8'));

// R(L) == A by construction: the tracked reference with its one marker replaced by an obviously
// fake concrete id.
const SYNTHETIC_ID = '900000999';
const L = JSON.parse(JSON.stringify(A).split('<REDACTED_CHAT_ID>').join(SYNTHETIC_ID));

const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);
const POLICY = P.P83A_CUTOVER_POLICY;
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
  return r;
};

console.log('\nFINMENTOR P8.3A cutover policy\n');
console.log('-- the shape of the approved delta --');

check('the delta is exactly +6 nodes, -1 node, and nothing else structural', () => {
  eq(A.nodes.length, 45, 'the baseline is not the sealed 45-node production reference');
  eq(B.nodes.length, 50, 'the candidate is not the 50-node P8.3A target');
  const ops = MZ.computeDelta(A, B);
  const n = (op) => ops.filter((o) => o.op === op).length;
  eq(n('addNode'), 6, 'wrong number of added nodes');
  eq(n('removeNode'), 1, 'wrong number of removed nodes');
  eq(n('setNodeField'), 4, 'wrong number of modified fields');
  eq(n('setTopLevel'), 1, 'only the review name may differ at top level');
  eq(ops.filter((o) => o.op === 'setTopLevel')[0].field, 'name', 'a top-level field other than name changed');
});

check('every added node is pinned by BOTH id and name, and carries an approval class', () => {
  P.APPROVED_ADDED_NODES.forEach((name) => {
    const node = byName(B, name);
    assert(node, 'the candidate has no node ' + name);
    eq(node.id, P.ADDED_NODE_IDS[name], 'added node id drifted for ' + name);
    assert(P.ADDED_NODE_CLASSES[name], 'no approval class for ' + name);
    assert(['HOT_PATH_CONFIG', 'AUTHORITY_FAILURE_CLASSIFICATION', 'BOT_EVENT_RESILIENCE',
      'SESSION_READ_LATENCY'].indexOf(P.ADDED_NODE_CLASSES[name]) !== -1,
    name + ' carries a class outside the four approved for P8.3A');
  });
  eq(Object.keys(P.ADDED_NODE_IDS).length, 6, 'the id table and the approved list disagree');
});

check('the removal is fully specified: id, name, class, and both edge sets', () => {
  eq(P.APPROVED_REMOVALS.length, 1, 'P8.3A removes exactly one node');
  const r = P.APPROVED_REMOVALS[0];
  eq(r.name, 'Read Settings', 'the removal names a different node');
  const live = byName(L, r.name);
  assert(live, 'the live workflow has no Read Settings to remove');
  eq(live.id, r.id, 'the approved removal id is not the live id');
  eq(JSON.stringify(inEdges(L, r.name)), JSON.stringify(r.inbound), 'live inbound edges differ from the rule');
  eq(JSON.stringify(outEdges(L, r.name).flat()), JSON.stringify(r.outbound), 'live outbound edges differ from the rule');
  // credential-bearing, so the authorisation must be explicit and separate
  assert(live.credentials, 'Read Settings is no longer credential-bearing; re-derive this rule');
  eq(r.allowCredentialBearing, true, 'the credential-bearing removal is not explicitly authorised');
  eq(r.allowTrigger, false, 'the rule authorises removing a trigger');
});

check('the exact parameter changes are pinned by value, not by field name', () => {
  const get = (wf, node, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), byName(wf, node));
  P.APPROVED_PARAMETER_CHANGES.forEach((c) => {
    if (c.field === 'parameters.headerParameters.parameters') {
      eq((get(A, c.node, c.field) || []).length, c.from, c.node + ': wrong header count before');
      eq((get(B, c.node, c.field) || []).length, c.to, c.node + ': wrong header count after');
      return;
    }
    eq(get(A, c.node, c.field), c.from, c.node + '.' + c.field + ' before');
    eq(get(B, c.node, c.field), c.to, c.node + '.' + c.field + ' after');
  });
  eq(byName(B, 'Read Bot Sessions').waitBetweenTries, P.SESSION_READ_BACKOFF_MS, 'the session read backoff is not the approved value');
});

check('the post-cutover edge set is exactly the pinned one', () => {
  Object.keys(P.APPROVED_EDGES).forEach((src) => {
    eq(JSON.stringify(outEdges(B, src)), JSON.stringify(P.APPROVED_EDGES[src]),
      'edges from ' + src + ' are not the approved set');
  });
});

console.log('\n-- the authority invariants --');

check('Save Bot Session has EXACTLY ONE incoming edge, and it is Build Session Row', () => {
  const inc = inEdges(B, P.AUTHORITY_WRITE_NODE);
  eq(inc.length, 1, 'the authority write has ' + inc.length + ' incoming edges: ' + inc.join(', '));
  eq(inc[0], P.AUTHORITY_WRITE_SOLE_SOURCE, 'the authority write is fed by an unapproved source');
});

check('ZERO second authority-write path: no classify node reaches Save Bot Session', () => {
  // P8.2R withdrew verify-then-retry over the TOCTOU between the reread and the write. What
  // replaced it classifies and stands down, so this is checked structurally rather than trusted.
  P.AUTHORITY_CLASSIFY_ONLY_NODES.forEach((n) => {
    const outs = outEdges(B, n).flat();
    assert(outs.indexOf(P.AUTHORITY_WRITE_NODE) === -1, n + ' has an edge back to the authority write');
  });
  eq(byName(B, 'Authority Outcome Reread').onError, 'continueRegularOutput',
    'the classify-only reread can abort the turn');
});

check('the verdict hard-codes __write_allowed false and never ranks cycles', () => {
  const js = byName(B, 'Authority Outcome Verdict').parameters.jsCode;
  assert(/__write_allowed:\s*false/.test(js), 'the verdict does not hard-code __write_allowed false');
  assert(!/>\s*\w*[Ss]tamp|currentStamp/.test(js), 'the verdict ranks cycles');
});

console.log('\n-- what may not move --');

check('ZERO user-facing text change: every customer-visible node is byte-identical to live', () => {
  P.USER_FACING_NODES.forEach((n) => {
    const l = byName(L, n);
    const b = byName(B, n);
    assert(l && b, 'a user-facing node is missing: ' + n);
    eq(JSON.stringify(b.parameters), JSON.stringify(l.parameters), n + ' changed');
  });
});

check('the public Lead Intake route is untouched apart from the dropped header', () => {
  const l = byName(L, P.LEAD_INTAKE_NODE);
  const b = byName(B, P.LEAD_INTAKE_NODE);
  eq(b.type, 'n8n-nodes-base.httpRequest', 'the handoff changed transport; INTERNAL_HANDOFF is not in this phase');
  P.LEAD_INTAKE_IMMUTABLE_PARAMS.forEach((k) => {
    eq(JSON.stringify(b.parameters[k]), JSON.stringify(l.parameters[k]), 'Send Lead to Intake.' + k + ' changed');
  });
  P.FORBIDDEN_INTAKE_TERMS.forEach((t) => {
    assert(JSON.stringify(b).indexOf(t) === -1, 'the fake auth reference survives: ' + t);
  });
});

check('the Telegram identity is pinned and unchanged', () => {
  const l = byName(L, P.TRIGGER_NODE_NAME);
  const b = byName(B, P.TRIGGER_NODE_NAME);
  eq(b.webhookId, l.webhookId, 'trigger webhookId changed');
  eq(b.webhookId, P.TRIGGER_WEBHOOK_ID, 'trigger webhookId is not the expected one');
  eq(JSON.stringify(b.credentials), JSON.stringify(l.credentials), 'trigger credential changed');
  eq(((b.credentials || {}).telegramApi || {}).id, P.BOT_CREDENTIAL_ID, 'trigger credential id drifted');
  eq(B.nodes.filter((n) => /trigger$/i.test(n.type)).length, 1, 'trigger count changed');
});

console.log('\n-- CONTROL --');

check('CONTROL: the real three-way input materializes to 50 nodes', () => {
  const v = run();
  assert(v.ok, v.stage + ': ' + v.failures.join(' | '));
  eq(v.stage, 'MATERIALIZED', 'wrong stage');
  eq(v.cLive.nodes.length, 50, 'wrong node count');
  assert(!byName(v.cLive, 'Read Settings'), 'Read Settings survived the cutover');
  assert(byName(v.cLive, 'Hot Path Config'), 'Hot Path Config is absent');
  eq(v.evidence.retainedFromLive.join(','), 'name', 'the retained-from-live record is wrong');
});

check('CONTROL: C_live keeps the live-only values and the four deployable fields', () => {
  const v = run();
  eq(JSON.stringify(Object.keys(v.cLive).sort()),
    JSON.stringify(['connections', 'name', 'nodes', 'settings']), 'field set');
  eq(v.cLive.name, L.name, 'the workflow name did not come from live');
  eq(v.cLive.settings.availableInMCP, false, 'availableInMCP is not false');
  assert(JSON.stringify(byName(v.cLive, 'Settings to Object')).indexOf(SYNTHETIC_ID) !== -1,
    'the live-only concrete value was not carried through');
  P.REQUIRED_EXPRESSIONS.forEach((r) => {
    let val = byName(v.cLive, r.node).parameters;
    r.path.forEach((s) => { val = val[s]; });
    eq(val, r.value, 'transport expression not taken from live for ' + r.node);
  });
});

check('CONTROL: no dangling edge survives the removal', () => {
  const v = run();
  const names = new Set(v.cLive.nodes.map((n) => n.name));
  Object.keys(v.cLive.connections).forEach((src) => {
    assert(names.has(src), 'dangling source ' + src);
    (v.cLive.connections[src].main || []).forEach((br) => (br || []).forEach((l) => {
      assert(names.has(l.node), 'dangling target ' + l.node);
    }));
  });
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

// 1. EXTRA NODE — a seventh node inside an approved class.
mustRefuse('(1) an extra node, even one that looks like the authority set', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ id: 'p83-extra', name: 'Authority Outcome Retry', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [2500, 420], parameters: { jsCode: 'return items;' } });
    return m;
  })()
}, 'POLICY', 'unapproved node added: Authority Outcome Retry');

// 2. MISSING NODE — an approved addition silently dropped.
mustRefuse('(2) an approved node missing from the candidate', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes = m.nodes.filter((n) => n.name !== 'IF Authority Committed');
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'IF Authority Committed');

// 3. WRONG REMOVAL — a different node deleted, inside the same delta.
mustRefuse('(3) a removal the allowlist does not name', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes = m.nodes.filter((n) => n.name !== 'Answer Callback Query');
    return m;
  })()
}, 'POLICY', 'not on the approved-removals allowlist');

// 3b. The right node, but its live wiring has moved since the rule was written.
mustRefuse('(3b) the approved removal whose LIVE edges no longer match the rule', {
  liveWorkflow: (() => {
    const m = clone(L);
    m.connections['Read Settings'] = { main: [[{ node: 'Build Bot Response', type: 'main', index: 0 }]] };
    return m;
  })()
}, 'BASELINE_DRIFT');

// 4. UNEXPECTED EDGE — the one that would recreate a second authority write.
mustRefuse('(4) an unexpected edge back into the authority write', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Build Authority Unresolved Event'] = {
      main: [[{ node: 'Save Bot Session', type: 'main', index: 0 }]]
    };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'is fed by Build Authority Unresolved Event');

// 4b. An unapproved rewire of a pre-existing source.
mustRefuse('(4b) an unapproved rewire of an inherited node', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['IF Layout Mapped'] = { main: [[{ node: 'Build Bot Event', type: 'main', index: 0 }]] };
    return m;
  })()
}, 'POLICY', 'unapproved rewire: IF Layout Mapped');

// ---- 4c-4f: the pin that was declared and never enforced ----------------------------------
//
// P8.3A wrote APPROVED_EDGES, called it "the exact post-cutover edge set", and handed it to a QA
// assertion only. Nothing passed it to the materializer, so at DEPLOY time it constrained nothing:
// an added node that grew its first outgoing edge was in neither the fan-in set nor the rewire set
// and materialized cleanly. That is how a builder wired straight into a live sheet would have
// shipped. These four fix the asymmetry — 4e is the hole itself, re-opened on purpose.

check('the declared edge set is actually HANDED to the materializer, not just to this file', () => {
  // The whole defect in one assertion: a pin that only a test reads is not a deploy-time control.
  assert(POLICY.pinnedOutEdges, 'the policy declares no pinnedOutEdges — the map gates nothing');
  eq(JSON.stringify(POLICY.pinnedOutEdges), JSON.stringify(P.APPROVED_EDGES),
    'the enforced pin and the declared edge set have drifted apart');
});

mustRefuse('(4c) an approved added node re-points its pinned out-edge', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Build Authority Unresolved Event'] = {
      main: [[{ node: 'Build Bot Response', type: 'main', index: 0 }]]
    };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'pinned out-edges differ on Build Authority Unresolved Event');

mustRefuse('(4d) an approved added node grows an EXTRA branch beyond the pin', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections['Authority Outcome Reread'].main[0].push({ node: 'Save Bot Event', type: 'main', index: 0 });
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'pinned out-edges differ on Authority Outcome Reread');

mustRefuse('(4e) THE HOLE: an added node whose out-edges no pin entry approves', {
  // Closed by default is the half that matters. Enforcing only the sources someone remembered to
  // list is exactly the state P8.3A shipped in, and it is why the discarded signal could have been
  // wired into Save Bot Event by a one-line "fix" with no approval anywhere.
  approvedDiffPolicy: (() => {
    const pol = clone(POLICY);
    delete pol.pinnedOutEdges['Build Authority Unresolved Event'];
    return pol;
  })()
}, 'ABSOLUTE_INVARIANTS', 'Build Authority Unresolved Event has outgoing edges that no pinnedOutEdges entry approves');

mustRefuse('(4f) an EIGHTH writer into the live Bot_Events sheet', {
  // Save Bot Event appends with autoMapInputData over an EMPTY stored schema, so whoever points at
  // it decides the sheet's columns. Seven builders may, and they are named.
  desiredReference: (() => {
    const m = clone(B);
    m.connections['IF Authority Committed'].main[0].push({ node: 'Save Bot Event', type: 'main', index: 0 });
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'protected node Save Bot Event has 8 incoming edge(s)');

// 5. USER-VISIBLE TEXT DRIFT.
mustRefuse('(5) user-visible text drift on a customer-facing node', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, 'Build Bot Response');
    n.parameters.jsCode += "\n// reworded\n";
    return m;
  })()
}, 'POLICY', 'unapproved node modified: Build Bot Response');

// 6. TRIGGER DRIFT.
mustRefuse('(6) the trigger webhookId changes', {
  desiredReference: (() => { const m = clone(B); byName(m, P.TRIGGER_NODE_NAME).webhookId = 'deadbeef'; return m; })()
}, 'POLICY', 'unapproved node modified');

mustRefuse('(6b) a second trigger is added', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ name: 'Extra Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3,
      position: [0, 0], parameters: {} });
    return m;
  })()
}, 'POLICY', 'unapproved node added');

// 7. CREDENTIAL DRIFT.
mustRefuse('(7) an added node carrying an unapproved credential type', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, 'Authority Outcome Verdict').credentials = { telegramApi: { id: 'X', name: 'Y' } };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'unapproved credential type');

mustRefuse('(7b) a credential reference changed on an inherited node', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, 'Save Bot Session').credentials = { googleSheetsOAuth2Api: { id: 'OTHER', name: 'other' } };
    return m;
  })()
}, 'POLICY', 'changed a field policy does not allow: credentials');

// 8. PUBLIC HANDOFF DRIFT — the change this phase is explicitly forbidden to make.
mustRefuse('(8) the public Lead Intake route is repointed', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, 'Send Lead to Intake').parameters.url = 'https://example.invalid/internal';
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'Send Lead to Intake');

mustRefuse('(8b) INTERNAL_HANDOFF smuggled in as a transport change', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, 'Send Lead to Intake');
    n.type = 'n8n-nodes-base.executeWorkflow';
    return m;
  })()
}, 'POLICY', 'changed a field policy does not allow: type');

// 9. The seal gate still governs this cutover.
mustRefuse('(9) an unsealed prior cutover blocks P8.3A', {
  sealFile: { records: [{ workflowId: P.PRODUCTION_WORKFLOW_ID, phase: 'P7.5R', status: 'BASELINE_UNSEALED' }] }
}, 'SEAL_PREFLIGHT', 'BASELINE_UNSEALED');

// 10. Baseline drift is still baseline drift.
mustRefuse('(10) live drifted from the sealed baseline', {
  liveWorkflow: (() => {
    const m = clone(L);
    byName(m, 'Build Bot Response').parameters.jsCode += '// someone edited production';
    return m;
  })()
}, 'BASELINE_DRIFT');

// 11. A tracked redacted artifact supplied as live.
mustRefuse('(11) a tracked redacted artifact supplied as the LIVE workflow', {
  liveWorkflow: A
}, 'INPUT', 'already contains redaction markers');

check('REFUSES: the evidence never carries a live literal', () => {
  const planted = clone(L);
  const n = byName(planted, 'Settings to Object');
  n.parameters.jsCode = n.parameters.jsCode.split(SYNTHETIC_ID).join('900000123');
  const v = run({ liveWorkflow: planted });
  const blob = JSON.stringify(v.evidence) + JSON.stringify(v.delta || []) + (v.failures || []).join(' ');
  assert(blob.indexOf('900000123') === -1, 'a live literal reached the evidence or the delta');
});

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
