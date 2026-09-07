#!/usr/bin/env node
// FINMENTOR — P7.5R: the redactor, the artifact classification, and the three-way materializer.
//
//   node qa/materializer.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. P7.5 deployed a broken production workflow while every check said yes.
// The checks were comparative, and the defect was present on both sides of every comparison.
// This gate defends the three things that make that impossible to repeat:
//
//   §2   the redactor can tell a CONCRETE SECRET from an N8N EXPRESSION
//   §1   no tracked artifact is production-deployable, whether or not it looks clean
//   §3   deployment is materialized from LIVE, with the tracked candidate supplying a PATCH
//
// The live workflow is simulated here by a fixture built from the tracked reference — the one
// marker it carries is a hardcoded id, so replacing it with a concrete value yields a document
// that redacts back to the reference exactly. That makes the whole pipeline testable offline.
//
// NO TEST PRINTS A SECRET. The fixtures use obviously-synthetic values.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));
const MZ = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'materializer.js'));
const P = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'concierge-cutover-policy.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const clone = (v) => JSON.parse(JSON.stringify(v));

// Fixture secrets are ASSEMBLED FROM PARTS on purpose. The runtime values still match the
// real patterns, so the redactor is genuinely exercised — but no credential-shaped literal
// exists in this source file, so scripts/secret-scan.mjs has nothing to flag. A test that
// forces the secret scanner to be suppressed would be a test that quietly weakens it.
const FAKE_TOKEN = '1234567890' + ':' + 'AAH' + 'fake'.repeat(8);
const FAKE_SK = 'sk' + '-' + 'abcdefghijklmnopqrstuvwxyz';

// `A` here is the FROZEN pre-P7.5R export -- see n8n/history/README.md. Everything in §3 and
// §12 is the three-way input of that one cutover: A_pre, the Model-B candidate B, and a
// synthetic live built from A_pre. Against the tracked reference these become A == B, which is
// not a cutover at all and tests nothing.
const A = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history',
  'mppzthlkSJFr6Kle.pre-P7-5R-cutover.json'), 'utf8'));
const B = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json'), 'utf8'));
const CLASS = JSON.parse(readFileSync(join(ROOT, 'n8n', 'artifact-classification.json'), 'utf8'));
const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);

// A synthetic "live" document: the tracked reference with its one marker replaced by a concrete
// (obviously fake) id, so R(L) == A by construction.
const SYNTHETIC_ID = '900000999';
const L = JSON.parse(JSON.stringify(A).split('<REDACTED_CHAT_ID>').join(SYNTHETIC_ID));

// ================================================================ 1. §2 the redactor

console.log('\n-- §2 the redactor distinguishes a secret from an expression --');

check('an n8n EXPRESSION under a chat-id field is PRESERVED byte-for-byte', () => {
  // The exact value P7.5 destroyed.
  [
    '={{ $json.chat_id }}',
    "={{ $('Parse Telegram Update').item.json.chat_id }}",
    '={{ $json.tokenized_value }}',
    '={{ $json.chat_id || $json.body.chat_id }}'
  ].forEach((expr) => {
    eq(R.redactChatValue(expr), expr, 'expression was altered: ' + expr);
    const doc = R.redactWorkflow({ nodes: [{ name: 'n', parameters: { chat_id: expr } }] });
    eq(doc.nodes[0].parameters.chat_id, expr, 'expression altered inside a workflow: ' + expr);
  });
});

check('a CONCRETE chat id is redacted', () => {
  ['123456789', '900000741', '1234567890123'.slice(0, 12)].forEach((id) => {
    eq(R.redactChatValue(id), R.MARKER_CHAT, 'concrete id survived: ' + id);
  });
  const doc = R.redactWorkflow({ nodes: [{ name: 'n', parameters: { chat_id: '123456789' } }] });
  eq(doc.nodes[0].parameters.chat_id, R.MARKER_CHAT, 'concrete id survived inside a workflow');
});

check('a numeric chat id is redacted', () => {
  const doc = R.redactWorkflow({ nodes: [{ name: 'n', parameters: { chatId: 123456789 } }] });
  eq(doc.nodes[0].parameters.chatId, R.MARKER_CHAT, 'numeric id survived');
});

check('a bot token literal is redacted wherever it appears', () => {
  const tok = FAKE_TOKEN;
  const doc = R.redactWorkflow({ nodes: [{ name: 'n', parameters: { url: 'https://api/' + tok, note: tok } }] });
  const blob = JSON.stringify(doc);
  assert(blob.indexOf(tok) === -1, 'a bot token survived redaction');
  assert(blob.indexOf(R.MARKER_TOKEN) !== -1, 'no token marker was written');
});

check('API key literals are redacted', () => {
  const doc = R.redactWorkflow({ nodes: [{ name: 'n', parameters: { a: FAKE_SK, b: 'AIza' + 'x'.repeat(35) } }] });
  const blob = JSON.stringify(doc);
  assert(!/sk-abcdefghij/.test(blob), 'an sk- key survived');
  assert(!/AIzaxxxx/.test(blob), 'an AIza key survived');
});

check('an expression whose VARIABLE is named token is preserved', () => {
  // The field name and the variable name are both irrelevant. Only a literal secret matters.
  const e = '={{ $json.token }}';
  eq(R.redactLiteralSecrets(e), e, 'an expression naming a token variable was altered');
  const doc = R.redactWorkflow({ nodes: [{ name: 'n', parameters: { chat_id: e, token: e } }] });
  eq(doc.nodes[0].parameters.chat_id, e, 'altered under a chat field');
  eq(doc.nodes[0].parameters.token, e, 'altered under a token field');
});

check('an expression CONTAINING a literal secret loses the secret, keeps the expression', () => {
  const tok = FAKE_TOKEN;
  const out = R.redactChatValue('={{ "' + tok + '" }}');
  assert(out.indexOf(tok) === -1, 'the embedded token survived');
  assert(out.indexOf('={{') === 0, 'the expression wrapper was destroyed');
});

check('a hardcoded id inside a Code body is redacted; a canonical sheet gid is not', () => {
  const code = "const owner = '123456789'; const gid = '1584265787';";
  const out = R.redactCodeBody(code);
  assert(out.indexOf('123456789') === -1, 'a hardcoded owner id survived');
  assert(out.indexOf('1584265787') !== -1, 'a canonical sheet gid was wrongly redacted');
});

check('THE REGRESSION: the tracked reference now holds real transport expressions', () => {
  P.REQUIRED_EXPRESSIONS.forEach((r) => {
    const n = byName(A, r.node);
    let v = n.parameters; r.path.forEach((s) => { v = v[s]; });
    eq(v, r.value, 'the tracked reference lost the transport expression for ' + r.node);
  });
});

check('the PowerShell redactor carries the same expression guard', () => {
  // A structural check, and labelled as one: it proves the corrected rule is present in the
  // PowerShell implementation used for committed snapshots. It does not claim behavioural
  // equivalence with the JS module, which would need to execute pwsh.
  const ps = readFileSync(join(ROOT, 'scripts', 'n8n-lib.ps1'), 'utf8');
  assert(/\\d\{6,12\}/.test(ps), 'the PS chat rule no longer matches only concrete digit runs');
  assert(!/\[\^"\]\*', '<REDACTED_CHAT_ID>'/.test(ps), 'the PS field-name-only rule is still present');
});

// ================================================================ 2. §1 classification

console.log('\n-- §1 no tracked artifact is production-deployable --');

check('every tracked artifact is classified and none is production-deployable', () => {
  assert(CLASS.artifacts.length >= 20, 'the classification covers only ' + CLASS.artifacts.length + ' artifacts');
  eq(CLASS.counts.production_deployable, 0, 'an artifact claims to be production-deployable');
  CLASS.artifacts.forEach((a) => {
    eq(a.deployable_to_production, false, a.path + ' is marked production-deployable');
    assert(['REDACTED_REFERENCE_ONLY', 'REVIEW_REFERENCE', 'INSTRUMENT'].indexOf(a.class) !== -1,
      'unknown class on ' + a.path);
  });
});

check('no production export or candidate chain is a DEPLOY SOURCE', () => {
  // This asserted class === REDACTED_REFERENCE_ONLY until the Lead Intake reference was
  // rebaselined onto the corrected redactor. R(L) == L for that workflow: every chatId is a
  // node-reference EXPRESSION, not a concrete id, so there is genuinely nothing to redact and
  // the file legitimately became REVIEW_REFERENCE ("no markers, still not a deploy source").
  //
  // Marker count was never the safety property. Not being a deploy source is, and that is what
  // is asserted now -- for the named artifacts and, below, for every artifact in the file.
  const NON_DEPLOY = ['REDACTED_REFERENCE_ONLY', 'REVIEW_REFERENCE'];
  ['mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json',
    'concierge-issuer-candidate.json', 'concierge-issuer-IMPORT-SAFE.json',
    'concierge-issuer-API-IMPORT.json', 'lead-intake-internal-receipt-candidate.json',
    'lead-intake-internal-receipt-IMPORT-SAFE.json', 'lead-intake-internal-receipt-API-IMPORT.json'
  ].forEach((base) => {
    const a = CLASS.artifacts.find((x) => x.path.endsWith(base));
    assert(a, 'not classified: ' + base);
    assert(NON_DEPLOY.indexOf(a.class) !== -1, base + ' carries a deploy-capable class: ' + a.class);
    eq(a.deployable_to_production, false, base + ' is marked production-deployable');
    eq(a.deployable_as_disposable, false, base + ' is marked disposable-deployable');
  });
  // The invariant the whole classification exists for, over EVERY artifact, not just these.
  eq(CLASS.artifacts.filter((a) => a.deployable_to_production).length, 0,
    'an artifact is marked production-deployable');
  eq(CLASS.counts.production_deployable, 0, 'the counts disagree with the artifacts');
});

check('the classification is not stale', () => {
  CLASS.artifacts.forEach((a) => {
    const doc = JSON.parse(readFileSync(join(ROOT, a.path), 'utf8'));
    const n = R.findMarkers(doc).reduce((s, m) => s + m.count, 0);
    eq(n, a.marker_total, 'marker count drifted for ' + a.path + '; re-run the classifier');
  });
});

// ================================================================ 3. §3 the materializer

console.log('\n-- §3 three-way materialization --');

const POLICY = P.CONCIERGE_CUTOVER_POLICY;
// The seal history is a REQUIRED input -- see the SEAL_PREFLIGHT stage. These runs replay
// P7.5R, whose own prior cutover is not in the file, so the honest fixture is a clean history:
// "no prior cutover recorded" is the state that made P7.5R deployable at the time.
const NO_PRIOR_CUTOVER = { records: [] };
const run = (over) => MZ.materializeDeployment(Object.assign({
  redactedReference: A, desiredReference: B, liveWorkflow: L, approvedDiffPolicy: POLICY,
  sealFile: NO_PRIOR_CUTOVER
}, over || {}));

check('CONTROL: the real three-way input materializes', () => {
  const v = run();
  assert(v.ok, v.stage + ': ' + v.failures.join(' | '));
  eq(v.stage, 'MATERIALIZED', 'wrong stage');
  eq(v.cLive.nodes.length, L.nodes.length + P.APPROVED_ADDED_NODES.length, 'wrong node count');
});

check('C_live takes untouched values from LIVE, never from the redacted reference', () => {
  // The heart of the model. `Send Client Message` is not in the delta, so its parameters come
  // from L. Even if the reference were still broken, the deployed object would not be.
  const v = run();
  P.REQUIRED_EXPRESSIONS.forEach((r) => {
    const n = byName(v.cLive, r.node);
    let val = n.parameters; r.path.forEach((s) => { val = val[s]; });
    eq(val, r.value, 'transport expression not taken from live for ' + r.node);
  });
  // And the value only LIVE has: the concrete id in Settings to Object.
  assert(JSON.stringify(byName(v.cLive, 'Settings to Object')).indexOf(SYNTHETIC_ID) !== -1,
    'the live-only concrete value was not carried through');
});

check('C_live carries only the four deployable fields, and no `active`', () => {
  const v = run();
  eq(JSON.stringify(Object.keys(v.cLive).sort()), JSON.stringify(['connections', 'name', 'nodes', 'settings']), 'field set');
  assert(!Object.prototype.hasOwnProperty.call(v.cLive, 'active'), '`active` must be absent');
  eq(v.cLive.name, L.name, 'the workflow name did not come from live');
});

check('the evidence object is safe to print', () => {
  const v = run();
  const blob = JSON.stringify(v.evidence);
  assert(blob.indexOf(SYNTHETIC_ID) === -1, 'a live value leaked into the evidence object');
  assert(/[0-9a-f]{64}/.test(blob), 'the evidence carries no hashes');
  eq(v.evidence.retainedFromLive.join(','), 'name', 'the retained-from-live record is wrong');
});

console.log('\n-- §12 the mandatory mutation battery --');

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

// 0. The seal preflight is the first gate, and it is fail-closed on ABSENCE. These three sit
//    at the top of the battery because they refuse before any of the three documents is even
//    looked at -- which is the point: an unsealed prior cutover is not a fact about this
//    deployment's inputs, it is a fact about whether there may be a deployment at all.
mustRefuse('a deployment with NO seal history supplied at all', {
  sealFile: undefined
}, 'SEAL_PREFLIGHT', 'no baseline seal file supplied');

mustRefuse('a deployment whose PREVIOUS cutover was never sealed', {
  sealFile: { records: [{ workflowId: P.PRODUCTION_WORKFLOW_ID, phase: 'P7.5R', status: 'BASELINE_UNSEALED' }] }
}, 'SEAL_PREFLIGHT', 'BASELINE_UNSEALED');

mustRefuse('a policy that names no production workflow, so no seal history can be found', {
  approvedDiffPolicy: (() => { const m = clone(POLICY); delete m.productionWorkflowId; return m; })()
}, 'SEAL_PREFLIGHT', 'names no productionWorkflowId');

check('CONTROL: a SEALED prior cutover does NOT block the next deployment', () => {
  // The gate must be a gate, not a wall. Without this the two refusals above would also pass
  // for a materializer that refused everything.
  const v = run({ sealFile: { records: [
    { workflowId: P.PRODUCTION_WORKFLOW_ID, phase: 'P7.0', status: 'SEALED' }
  ] } });
  assert(v.ok, 'a sealed prior cutover was refused: ' + v.stage + ': ' + v.failures.join(' | '));
  eq(v.evidence.steps.sealPreflight.ok, true, 'the seal preflight is not recorded in the evidence');
});

check('the seal preflight runs BEFORE the input check, not after', () => {
  // Ordering is load-bearing. If an unsealed baseline were diagnosed as BASELINE_DRIFT, the
  // obvious repair is to rebaseline from live until the check goes quiet -- the exact silent
  // rebaseline §8 exists to prevent. Proven by handing it an input that is ALSO invalid on
  // other grounds and requiring the seal to be the reported reason.
  const v = run({
    liveWorkflow: A,   // a redacted artifact: an INPUT-stage failure on its own
    sealFile: { records: [{ workflowId: P.PRODUCTION_WORKFLOW_ID, phase: 'P7.5R', status: 'BASELINE_UNSEALED' }] }
  });
  assert(!v.ok, 'this input should not have materialized');
  eq(v.stage, 'SEAL_PREFLIGHT', 'the seal preflight did not run first');
});

// 1. A and B both carry the same marker -> direct deployment still refused.
check('REFUSES: (1) a marker shared by A and B cannot be deployed from disk', () => {
  // The exact P7.5 shape: the defect is on both sides, so no comparison can see it. The
  // absolute invariant does, because it looks only at the artifact.
  const marked = clone(B);
  byName(marked, 'Send Client Message').parameters.workflowInputs.value.chat_id = R.MARKER_CHAT;
  const markedA = clone(A);
  byName(markedA, 'Send Client Message').parameters.workflowInputs.value.chat_id = R.MARKER_CHAT;
  // Deploying B directly (the P7.5 mistake) — the invariants reject it outright.
  const direct = MZ.absoluteInvariants(
    { name: marked.name, nodes: marked.nodes, connections: marked.connections, settings: marked.settings },
    L, POLICY);
  assert(!direct.ok, 'a marker-carrying artifact passed the absolute invariants');
  assert(direct.failures.some((f) => /redaction marker/.test(f)), 'wrong reason: ' + direct.failures.join(' | '));
});

// 2. L redacts to something other than A -> baseline drift.
mustRefuse('(2) live has drifted from the tracked reference', {
  liveWorkflow: (() => { const m = clone(L); byName(m, 'Build Bot Response').parameters.jsCode += ' '; return m; })()
}, 'BASELINE_DRIFT', 'Build Bot Response');

// 3. B changes an unapproved path.
mustRefuse('(3) the candidate changes an unapproved node', {
  desiredReference: (() => { const m = clone(B); byName(m, 'Answer Callback Query').parameters.operation = 'sendMessage'; return m; })()
}, 'POLICY', 'unapproved node modified');

// 4. The approved delta would overwrite a transport expression.
mustRefuse('(4) an approved delta that overwrites the Telegram chat expression', {
  desiredReference: (() => { const m = clone(B); byName(m, 'Send Client Message').parameters.workflowInputs.value.chat_id = '={{ $json.other }}'; return m; })()
}, 'POLICY', 'unapproved node modified: Send Client Message');

// 5. C_live would contain a redaction marker.
mustRefuse('(5) an approved node whose new body carries a marker', {
  desiredReference: (() => { const m = clone(B); byName(m, 'Get Bot Session').parameters.jsCode = "const o='" + R.MARKER_CHAT + "';"; return m; })()
}, 'ABSOLUTE_INVARIANTS', 'redaction marker');

// 6. Telegram credential changes.
mustRefuse('(6) the Telegram credential changes', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, P.TRIGGER_NODE_NAME).credentials.telegramApi.id = 'SOMEOTHERCRED';
    return m;
  })()
}, 'POLICY', 'unapproved node modified: ' + P.TRIGGER_NODE_NAME);

// 7. webhookId changes.
mustRefuse('(7) the trigger webhookId changes', {
  desiredReference: (() => { const m = clone(B); byName(m, P.TRIGGER_NODE_NAME).webhookId = 'deadbeef'; return m; })()
}, 'POLICY', 'unapproved node modified');

// 8. Trigger count changes.
mustRefuse('(8) a second trigger is added', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ name: 'Extra Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3, position: [0, 0], parameters: {} });
    return m;
  })()
}, 'POLICY', 'unapproved node added');

// 9. A Code body changes outside the approved set.
mustRefuse('(9) a Code body changes outside the approved set', {
  desiredReference: (() => { const m = clone(B); byName(m, 'Build Bot Response').parameters.jsCode += '// x'; return m; })()
}, 'POLICY', 'unapproved node modified: Build Bot Response');

// 11. A tracked redacted artifact supplied as the live workflow.
mustRefuse('(11) a tracked redacted artifact supplied as the LIVE workflow', {
  liveWorkflow: A
}, 'INPUT', 'already contains redaction markers');

// A node removal is never approvable.
mustRefuse('a node removal, which no policy may approve', {
  desiredReference: (() => { const m = clone(B); m.nodes = m.nodes.filter((n) => n.name !== 'Answer Callback Query'); return m; })()
}, 'POLICY', 'not on the approved-removals allowlist');

// An unapproved credential on an added node.
mustRefuse('an added node carrying an unapproved credential type', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, 'Issuance Gate').credentials = { telegramApi: { id: 'X', name: 'Y' } };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'unapproved credential type');

check('REFUSES: (10) the evidence never carries a live literal', () => {
  // Mutation 10 in the brief: a sensitive literal appearing in logs or evidence is a failure.
  // Checked by planting a distinctive literal in L and requiring it never to surface.
  const planted = clone(L);
  byName(planted, 'Settings to Object').parameters.jsCode =
    byName(planted, 'Settings to Object').parameters.jsCode.split(SYNTHETIC_ID).join('900000123');
  const v = MZ.materializeDeployment({
    redactedReference: A, desiredReference: B, liveWorkflow: planted, approvedDiffPolicy: POLICY,
    sealFile: NO_PRIOR_CUTOVER
  });
  const blob = JSON.stringify(v.evidence) + JSON.stringify(v.delta || []) + (v.failures || []).join(' ');
  assert(blob.indexOf('900000123') === -1, 'a live literal reached the evidence or the delta');
});

check('an introduced literal chat identity is refused', () => {
  const m = clone(B);
  byName(m, 'Issuance Gate').parameters.chat_id = '987654321';
  const v = run({ desiredReference: m });
  assert(!v.ok, 'an introduced literal identity was accepted');
});

// ================================================================ 4. §3 allowlisted removal

console.log('\n-- §3 allowlisted node removal --');

const RS = {
  name: 'Read Settings',
  id: '9b55cfcc-b422-4147-a79f-04bd42386f4c',
  klass: 'HOT_PATH_CONFIG',
  inbound: ['Telegram Client Trigger'],
  outbound: ['Settings to Object'],
  allowCredentialBearing: true
};
// Removing a node inherently rewires its neighbours, so the fixture policy approves those two
// sources as well. That is not a loosening: the removal rule still has to match id and edges
// exactly, which is what these mutations exercise.
const withRemoval = (rule) => Object.assign({}, POLICY, {
  approvedRemovals: [rule || RS],
  approvedRewiredSources: (POLICY.approvedRewiredSources || []).concat(['Telegram Client Trigger', 'Read Settings'])
});

// A desired reference with Read Settings gone, so computeDelta emits removeNode.
const B_NO_RS = (() => {
  const m = clone(B);
  m.nodes = m.nodes.filter((n) => n.name !== RS.name);
  delete m.connections[RS.name];
  m.connections['Telegram Client Trigger'] = {
    main: (m.connections['Telegram Client Trigger'].main || [])
      .map((br) => (br || []).filter((l) => l.node !== RS.name))
  };
  return m;
})();

check('MUTATION: an UNAPPROVED removal is refused', () => {
  const v = run({ desiredReference: B_NO_RS, approvedDiffPolicy: Object.assign({}, POLICY, { approvedRewiredSources: (POLICY.approvedRewiredSources || []).concat(['Telegram Client Trigger', 'Read Settings']) }) });
  assert(!v.ok, 'an unapproved removal was accepted');
  eq(v.stage, 'POLICY', 'wrong stage');
  assert(v.failures.some((f) => /not on the approved-removals allowlist/.test(f)),
    'wrong reason: ' + v.failures.join(' | '));
});

check('MUTATION: a removal rule with the WRONG node id is refused', () => {
  const bad = Object.assign({}, RS, { id: '00000000-0000-0000-0000-000000000000' });
  const v = run({ desiredReference: B_NO_RS, approvedDiffPolicy: withRemoval(bad) });
  assert(!v.ok, 'a wrong-id removal was accepted');
  assert(v.failures.some((f) => /id mismatch/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('MUTATION: a removal rule with the WRONG node name matches nothing', () => {
  const bad = Object.assign({}, RS, { name: 'Read Settingz' });
  const v = run({ desiredReference: B_NO_RS, approvedDiffPolicy: withRemoval(bad) });
  assert(!v.ok, 'a wrong-name rule authorised a removal');
});

check('MUTATION: a removal whose declared EDGES do not match live is refused', () => {
  const bad = Object.assign({}, RS, { outbound: ['Some Other Node'] });
  const v = run({ desiredReference: B_NO_RS, approvedDiffPolicy: withRemoval(bad) });
  assert(!v.ok, 'a removal with unaccounted edges was accepted');
  assert(v.failures.some((f) => /outbound edges/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('MUTATION: removing a CREDENTIAL-BEARING node without authorisation is refused', () => {
  const bad = Object.assign({}, RS, { allowCredentialBearing: false });
  const v = run({ desiredReference: B_NO_RS, approvedDiffPolicy: withRemoval(bad) });
  assert(!v.ok, 'a credential-bearing node was removed without authorisation');
  assert(v.failures.some((f) => /credential-bearing/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('CONTROL: the approved removal SUCCEEDS and leaves no dangling edge', () => {
  const v = run({ desiredReference: B_NO_RS, approvedDiffPolicy: withRemoval() });
  assert(v.ok, v.stage + ': ' + v.failures.join(' | '));
  assert(!v.cLive.nodes.some((n) => n.name === RS.name), 'the node survived');
  const names = new Set(v.cLive.nodes.map((n) => n.name));
  Object.keys(v.cLive.connections).forEach((src) => {
    assert(names.has(src), 'dangling source ' + src);
    (v.cLive.connections[src].main || []).forEach((br) => (br || []).forEach((l) => {
      assert(names.has(l.node), 'dangling target ' + l.node);
    }));
  });
});

// ================================================================ 5. §8 baseline sealing

console.log('\n-- §8 baseline sealing: a cutover invalidates its own reference --');

const SEALM = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'baseline-seal.js'));
const SEALFILE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'baseline-seal.json'), 'utf8'));

// The MECHANISM, on a synthetic record. This used to assert that the repository's own P7.5R
// record was BASELINE_UNSEALED, which conflated two different things: whether the gate works,
// and whether a particular cutover happens to be sealed today. Sealing P7.5R is the expected,
// desired outcome -- and it made the mechanism test go red for succeeding at its purpose. The
// gate is tested on a record built here; the repository's real state is asserted separately,
// below, where it belongs.
check('MUTATION: a cutover that was never sealed REFUSES the next deploy', () => {
  const f = { records: [{ workflowId: 'X', phase: 'P0', status: SEALM.UNSEALED }] };
  const v = SEALM.preflightSealCheck(f, 'X');
  assert(!v.ok, 'an unsealed prior cutover allowed the next deploy');
  assert(/BASELINE_UNSEALED/.test(v.reason), 'wrong reason: ' + v.reason);
});

check('MUTATION: the MOST RECENT record decides, not the best one', () => {
  // A sealed history followed by an unsealed cutover must still refuse. Scanning for "is there
  // a sealed record" instead of "is the last one sealed" would pass this and be wrong.
  const f = { records: [
    { workflowId: 'X', phase: 'P0', status: SEALM.SEALED },
    { workflowId: 'X', phase: 'P1', status: SEALM.UNSEALED }
  ] };
  assert(!SEALM.preflightSealCheck(f, 'X').ok, 'an unsealed cutover after a sealed one was allowed');
});

check('a workflow with no cutover history is allowed', () => {
  assert(SEALM.preflightSealCheck(SEALFILE, 'QmIyEW2ZEqKregmN').ok, 'a first deployment was refused');
});

// ---- the repository's own state, which is a different claim from the mechanism ----------

const CONCIERGE_RECORDS = (SEALFILE.records || []).filter((r) => r.workflowId === 'mppzthlkSJFr6Kle');
const LATEST = CONCIERGE_RECORDS[CONCIERGE_RECORDS.length - 1];

// One frozen pre-state per sealed phase. This table IS the chain, and it is what stops
// n8n/history/ from becoming a pile of copies nobody can vouch for.
const FROZEN = {
  'P7.5R': { file: 'mppzthlkSJFr6Kle.pre-P7-5R-cutover.json', nodes: 33 },
  'P8.3A': { file: 'mppzthlkSJFr6Kle.pre-P8-3A-cutover.json', nodes: 45 },
  'P8.4B-WRITE-B': { file: 'mppzthlkSJFr6Kle.pre-write-b.json', nodes: 50 }
};

check('the LATEST Concierge cutover is SEALED, so the next deploy is not refused on baseline grounds', () => {
  assert(LATEST, 'no mppzthlkSJFr6Kle record at all');
  eq(LATEST.phase, 'P8.4B-WRITE-B', 'the most recent Concierge record is not the phase this repo last deployed');
  eq(LATEST.status, SEALM.SEALED, 'the latest cutover is still unsealed');
  assert(SEALM.preflightSealCheck(SEALFILE, 'mppzthlkSJFr6Kle').ok, 'the sealed record still refuses');
});

check('NO record is left UNSEALED -- an unsealed phase anywhere blocks the next deployment', () => {
  // Every workflow, not just the Concierge: an unsealed record fails the NEXT deployment of that
  // workflow closed, so one left behind anywhere is a trap set for a later phase.
  const open = (SEALFILE.records || []).filter((r) => r.status !== SEALM.SEALED);
  eq(open.length, 0, 'unsealed phases: ' + open.map((r) => r.workflowId + '/' + r.phase).join(', '));
});

check('THE CHAIN: each cutover deployed FROM the state the previous one deployed TO', () => {
  // The property that makes the history a chain rather than a list. A gap here means some
  // production change happened outside this tooling and nobody recorded it.
  for (let i = 1; i < CONCIERGE_RECORDS.length; i++) {
    eq(CONCIERGE_RECORDS[i].preVersionId, CONCIERGE_RECORDS[i - 1].postVersionId,
      CONCIERGE_RECORDS[i].phase + ' did not start from where ' + CONCIERGE_RECORDS[i - 1].phase + ' ended');
  }
});

check('EVERY seal record is EVIDENCE, not an assertion: every hash is present and a sha256', () => {
  // Applied to the whole chain, not just the tip. A record that stopped carrying its proof the
  // moment a newer one landed would make the history unfalsifiable.
  CONCIERGE_RECORDS.forEach((rec) => {
    ['deployedTargetSha', 'postLiveRedactedSha'].forEach((k) => {
      assert(/^[0-9a-f]{64}$/.test(rec[k] || ''), rec.phase + ': ' + k + ' is not a sha256');
    });
    assert(rec.sealProof, rec.phase + ': the record carries no seal proof');
    assert(/^[0-9a-f]{64}$/.test(rec.sealProof.approvedRedactedSha || ''),
      rec.phase + ': approvedRedactedSha is not a sha256');
    eq(rec.sealProof.versionChainVerified, true, rec.phase + ': the version chain was not verified');
    assert(rec.sealedAt && !isNaN(Date.parse(rec.sealedAt)), rec.phase + ': sealedAt is not a timestamp');
  });
});

check('THE ANCHOR: each frozen history export is the state its phase actually deployed FROM', () => {
  // Without this, n8n/history/ is just a copy somebody made, and the gates above are testing
  // arithmetic against a fixture nobody can vouch for. The version chain is what makes it
  // evidence: each frozen export must carry the exact preVersionId its seal recorded.
  CONCIERGE_RECORDS.forEach((rec) => {
    const f = FROZEN[rec.phase];
    assert(f, rec.phase + ' has no frozen pre-state in the table -- freeze it or drop the record');
    const frozen = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history', f.file), 'utf8'));
    eq(frozen.versionId, rec.preVersionId, 'the frozen pre-' + rec.phase + ' export is not the recorded pre-state');
    eq(frozen.nodes.length, f.nodes,
      'the frozen pre-' + rec.phase + ' export is no longer the ' + f.nodes + '-node graph');
  });
  // A is the pre-P7.5R fixture the arithmetic gates above run on; keep it pinned by identity.
  eq(A.versionId, FROZEN['P7.5R'] && CONCIERGE_RECORDS[0].preVersionId, 'the P7.5R fixture moved');
});

check('THE OTHER END: the tracked reference is the state the LATEST cutover deployed TO', () => {
  const tracked = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
    'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
  eq(tracked.versionId, LATEST.postVersionId, 'the tracked reference is not the sealed post-state');
  eq(tracked.nodes.length, LATEST.nodeCount, 'the tracked reference node count contradicts the record');
  // A_next entered git as R(L_post). If it carries no markers, redaction did not run -- the
  // P7.5 defect in reverse, and the one thing a seal must never do.
  assert(R.findMarkers(tracked).length > 0, 'the sealed reference carries no redaction markers');
});

check('a SEALED record allows the next deploy', () => {
  const f = { records: [{ workflowId: 'X', phase: 'P0', status: SEALM.SEALED }] };
  assert(SEALM.preflightSealCheck(f, 'X').ok, 'a sealed record still refused');
});

check('MUTATION: arbitrary live drift cannot be rebaselined', () => {
  // The whole point: A_next is accepted because live matches the APPROVED target, never
  // because it is whatever live happens to be.
  const v = run();
  assert(v.ok, 'setup failed: ' + v.failures.join(' | '));
  const drifted = clone(L);
  byName(drifted, 'Build Bot Response').parameters.jsCode += '// someone edited production';
  const s = SEALM.sealBaseline({ cLive: v.cLive, lPost: drifted });
  assert(!s.ok, 'arbitrary live drift was sealed as the new baseline');
  assert(s.failures.some((f) => /does NOT match the approved target/.test(f)),
    'wrong reason: ' + s.failures.join(' | '));
});

check('CONTROL: the approved target, read back from live, seals', () => {
  const v = run();
  const lPost = Object.assign({}, L, {
    name: v.cLive.name, nodes: v.cLive.nodes, connections: v.cLive.connections,
    settings: v.cLive.settings, versionId: 'post-1'
  });
  const s = SEALM.sealBaseline({ cLive: v.cLive, lPost: lPost });
  assert(s.ok, 'the approved target failed to seal: ' + (s.failures || []).join(' | '));
  assert(s.aNext, 'no next baseline produced');
  eq(s.evidence.versionId, 'post-1', 'the seal did not record the post versionId');
});

check('MUTATION: a REDACTED document supplied as post-deploy live is refused', () => {
  const v = run();
  const s = SEALM.sealBaseline({ cLive: v.cLive, lPost: A });
  assert(!s.ok, 'a redacted document was accepted as live');
  assert(s.failures.some((f) => /not a live export/.test(f)), 'wrong reason: ' + s.failures.join(' | '));
});

check('the seal record carries hashes and metadata only, never a workflow body', () => {
  const v = run();
  const lPost = Object.assign({}, L, {
    name: v.cLive.name, nodes: v.cLive.nodes, connections: v.cLive.connections,
    settings: v.cLive.settings, versionId: 'post-2'
  });
  const s = SEALM.sealBaseline({ cLive: v.cLive, lPost: lPost });
  const rec = SEALM.buildSealRecord({ workflowId: 'W', phase: 'P8.3A', status: SEALM.SEALED, evidence: s.evidence });
  const blob = JSON.stringify(rec);
  assert(!/jsCode|parameters|credentials/.test(blob), 'the seal record carries workflow content');
  assert(blob.indexOf(SYNTHETIC_ID) === -1, 'a live literal reached the seal record');
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
