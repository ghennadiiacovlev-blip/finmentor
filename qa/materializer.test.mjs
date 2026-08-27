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

const A = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
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

check('both production exports and both candidate chains are REDACTED_REFERENCE_ONLY', () => {
  ['mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json',
    'concierge-issuer-candidate.json', 'concierge-issuer-IMPORT-SAFE.json',
    'concierge-issuer-API-IMPORT.json', 'lead-intake-internal-receipt-candidate.json',
    'lead-intake-internal-receipt-IMPORT-SAFE.json', 'lead-intake-internal-receipt-API-IMPORT.json'
  ].forEach((base) => {
    const a = CLASS.artifacts.find((x) => x.path.endsWith(base));
    assert(a, 'not classified: ' + base);
    eq(a.class, 'REDACTED_REFERENCE_ONLY', base + ' is not REDACTED_REFERENCE_ONLY');
  });
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
const run = (over) => MZ.materializeDeployment(Object.assign({
  redactedReference: A, desiredReference: B, liveWorkflow: L, approvedDiffPolicy: POLICY
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
}, 'POLICY', 'never approved by policy');

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
    redactedReference: A, desiredReference: B, liveWorkflow: planted, approvedDiffPolicy: POLICY
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

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
