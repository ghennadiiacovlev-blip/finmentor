#!/usr/bin/env node
// FINMENTOR — P8.4B (WRITE B): the Concierge internal handoff, and the mutations it must refuse.
//
//   node qa/concierge-internal-handoff.test.mjs
//
// Offline: no tenant, no credential, no network. A = the sealed 50-node P8.3A Concierge,
// B = the 51-node internal-handoff candidate, L = a synthetic live built from A.
//
// WHAT THIS GATE IS FOR. The migration is one node out and two in, inside a bot that talks to
// customers and owns a receipt state machine. Almost everything that could go wrong here is a
// change that LOOKS like the approved one:
//
//   * an HTTP submit that survives as a retry arm — the public path still live, migration in
//     name only
//   * a target workflow id supplied by expression — a call that can be pointed anywhere
//   * a submission_key taken from the body, or minted again at handoff — a capability the
//     caller chose, or a receipt the cycle can never settle
//
// The key-source checks EXECUTE the deployed builder body rather than grepping it, because
// "reads the authoritative key" is a claim about what the code DOES with its inputs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const R = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'redactor.js'));
const MZ = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'materializer.js'));
const P = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'concierge-internal-handoff-policy.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const clone = (v) => JSON.parse(JSON.stringify(v));

// FROZEN pre-Write-B export -- see n8n/history/README.md. This gate is about the 50 -> 51
// delta Write B DEPLOYED, whose input is a fact about the past: the public HTTP handoff still
// present. The tracked reference has since advanced past it.
const A = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history',
  'mppzthlkSJFr6Kle.pre-write-b.json'), 'utf8'));
const B = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate',
  'concierge-internal-handoff-candidate.json'), 'utf8'));
const SEALFILE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'baseline-seal.json'), 'utf8'));

const SYNTHETIC_ID = '900000999';
const L = JSON.parse(JSON.stringify(A).split('<REDACTED_CHAT_ID>').join(SYNTHETIC_ID));

const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);
const POLICY = P.CONCIERGE_INTERNAL_HANDOFF_POLICY;
const run = (over) => MZ.materializeDeployment(Object.assign({
  redactedReference: A, desiredReference: B, liveWorkflow: L,
  approvedDiffPolicy: POLICY, sealFile: SEALFILE
}, over || {}));
const outs = (wf, s) => ((((wf.connections || {})[s] || {}).main) || []).map((br) => (br || []).map((l) => l.node));

// Execute the deployed handoff builder against a controlled context.
const KEY = 'sub_' + '0'.repeat(30) + 'ff';
function runHandoff(wf, ctx) {
  const c = Object.assign({
    'Issuance Gate': { __submission_key: KEY, __correlation_id: 'CORR-X' },
    'Build Bot Response': { lead_payload: { lead_id: 'TG-1', tool: 'telegram_client_concierge', meta: { consent: true } } },
    'Get Bot Session': { cycle_id: 'C-900000999-1000', consent_cycle_id: 'C-900000999-1000', consent_at: '2026-08-28T00:00:00Z' }
  }, ctx || {});
  const $ = (n) => ({ first: () => ({ json: c[n] || {} }) });
  return new Function('$', byName(wf, P.HANDOFF_BUILDER).parameters.jsCode)($)[0].json;
}

console.log('\nFINMENTOR Concierge internal handoff (Write B)\n');
console.log('-- the shape of the migration --');

check('the delta is exactly +2 nodes, -1 node, no modified bodies', () => {
  eq(A.nodes.length, 50, 'the baseline is not the sealed 50-node P8.3A Concierge');
  eq(B.nodes.length, 51, 'the candidate is not 51 nodes');
  const ops = MZ.computeDelta(A, B);
  const n = (op) => ops.filter((o) => o.op === op).length;
  eq(n('addNode'), 2, 'wrong number of added nodes');
  eq(n('removeNode'), 1, 'wrong number of removed nodes');
  eq(n('setNodeField'), 0, 'this migration modifies no inherited node');
  eq(ops.filter((o) => o.op === 'setTopLevel')[0].field, 'name', 'a top-level field other than name changed');
});

check('every added node is pinned by id, and neither carries a credential', () => {
  P.APPROVED_ADDED_NODES.forEach((name) => {
    const node = byName(B, name);
    assert(node, 'the candidate has no node ' + name);
    eq(node.id, P.ADDED_NODE_IDS[name], 'added node id drifted for ' + name);
    assert(!node.credentials, name + ' carries a credential');
  });
});

check('the removal is fully specified and matches LIVE', () => {
  const r = P.APPROVED_REMOVALS[0];
  const live = byName(L, r.name);
  assert(live, 'the live workflow has no ' + r.name);
  eq(live.id, r.id, 'the approved removal id is not the live id');
  eq(live.type, 'n8n-nodes-base.httpRequest', 'the node being removed is not the public HTTP call');
  assert(!live.credentials, 'the removed node is credential-bearing; re-derive this rule');
  eq(r.allowCredentialBearing, false, 'the rule authorises a credential-bearing removal');
  eq(r.allowTrigger, false, 'the rule authorises removing a trigger');
});

console.log('\n-- the public path is GONE, the internal path is EXACTLY ONE --');

check('ZERO public HTTP Lead Intake submissions remain in the graph', () => {
  assert(!byName(B, P.REMOVED_HTTP_NODE), 'the public HTTP handoff node is still present');
  const http = B.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  const intakeHttp = http.filter((n) => /intake/i.test(JSON.stringify(n.parameters || {})));
  eq(intakeHttp.length, 0, 'an HTTP node still targets Lead Intake: ' + intakeHttp.map((n) => n.name).join(', '));
  // The settings VALUE may still exist in the config nodes -- Settings to Object and Hot Path
  // Config carry lead_intake_webhook_url as inert configuration. What must not exist is a node
  // that SUBMITS with it. A config entry is not a path; an HTTP node is.
  const submitters = B.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest'
    && /lead_intake_webhook_url/.test(JSON.stringify(n.parameters || {})));
  eq(submitters.length, 0, 'an HTTP node still submits to the public intake URL: ' + submitters.map((n) => n.name).join(', '));
});

check('EXACTLY ONE internal handoff, to exactly one target, pinned as a literal', () => {
  const ew = B.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow');
  const toIntake = ew.filter((n) => (n.parameters.workflowId || {}).value === P.LEAD_INTAKE_WORKFLOW_ID);
  eq(toIntake.length, 1, 'there are ' + toIntake.length + ' internal handoffs');
  eq(toIntake[0].name, P.HANDOFF_CALLER, 'the internal handoff is not the approved node');
  const v = toIntake[0].parameters.workflowId.value;
  eq(typeof v, 'string', 'the target id is not a literal string');
  assert(!/^=/.test(v), 'the target workflow id is an EXPRESSION — dynamically steerable');
  eq(v, 'QmIyEW2ZEqKregmN', 'the target is not Lead Intake');
  // the OTHER executeWorkflow nodes are the pre-existing Telegram transport calls, untouched
  ew.filter((n) => n.name !== P.HANDOFF_CALLER).forEach((n) => {
    eq(JSON.stringify(n), JSON.stringify(byName(A, n.name)), 'a pre-existing sub-workflow call changed: ' + n.name);
  });
});

check('the handoff sits on the one lead path, with no fallback arm', () => {
  eq(JSON.stringify(outs(B, 'IF Lead Already Sent')),
    JSON.stringify([['Build Intake Transport Request'], [P.HANDOFF_BUILDER]]), 'the lead branch is not the approved one');
  eq(JSON.stringify(outs(B, P.HANDOFF_BUILDER)), JSON.stringify([[P.HANDOFF_CALLER]]), 'the builder does not feed the caller');
  eq(JSON.stringify(outs(B, P.HANDOFF_CALLER)), JSON.stringify([['Parse Intake Response']]), 'the caller does not feed the parser');
  assert(!B.connections[P.REMOVED_HTTP_NODE], 'the removed node still has connections');
});

console.log('\n-- the authoritative submission_key --');

check('the key comes from Issuance Gate — the node the RECEIPT was preallocated with', () => {
  const src = byName(B, P.HANDOFF_BUILDER).parameters.jsCode;
  const refs = [...new Set([...src.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))].sort();
  eq(JSON.stringify(refs), JSON.stringify(['Build Bot Response', 'Get Bot Session', 'Issuance Gate']),
    'the builder reads nodes outside the approved set: ' + refs.join(', '));
  // the receipt in the LIVE graph is written with exactly this reference
  const prealloc = JSON.stringify(byName(L, 'Receipt Preallocate').parameters);
  assert(prealloc.includes("$('" + P.AUTHORITATIVE_KEY_SOURCE + "').first().json." + P.AUTHORITATIVE_KEY_FIELD),
    'Receipt Preallocate no longer uses the key source this handoff reads — they would disagree');
});

check('EXECUTED: the emitted wrapper carries the authoritative key verbatim', () => {
  const out = runHandoff(B);
  eq(out.submission_key, KEY, 'the wrapper does not carry the Issuance Gate key');
  eq(out.envelope.source, 'telegram_miniapp', 'the internal envelope marker changed');
  assert(out.envelope.payload, 'no payload in the envelope');
  eq(out.envelope.payload.tool, 'telegram_client_concierge', 'lead attribution changed');
  eq(out.envelope.payload.meta.request_id, 'C-900000999-1000', 'the correlation is not the cycle id');
  eq(out.envelope.payload.audit.cycle_id, 'C-900000999-1000', 'the audit cycle id is wrong');
});

check('EXECUTED: NO key is minted at handoff — an absent gate key yields an EMPTY key', () => {
  // The proof that nothing is generated here: with no key upstream, the wrapper carries none.
  // A builder that minted would produce a well-formed key out of nothing.
  const out = runHandoff(B, { 'Issuance Gate': { __correlation_id: 'CORR-X' } });
  eq(out.submission_key, '', 'a submission_key appeared without one upstream — it was MINTED');
  const src = byName(B, P.HANDOFF_BUILDER).parameters.jsCode;
  assert(!/Math\.random|randomUUID|crypto|Date\.now\(\)\s*\.toString\(16\)/.test(src),
    'the builder contains key-minting machinery');
});

check('EXECUTED: the key is never taken from the caller', () => {
  // Feed a hostile body through every node the builder reads. The key must still be the gate's.
  const hostile = { submission_key: 'sub_' + 'e'.repeat(32), __submission_key: 'sub_' + 'e'.repeat(32) };
  const out = runHandoff(B, {
    'Build Bot Response': { lead_payload: Object.assign({ tool: 'telegram_client_concierge' }, hostile) },
    'Get Bot Session': Object.assign({ cycle_id: 'C-900000999-1000' }, hostile)
  });
  eq(out.submission_key, KEY, 'a caller-supplied key reached the wrapper');
});

console.log('\n-- TB-1: nothing internal crosses to the customer --');

check('no client-facing node mentions submission_key or the internal mode', () => {
  P.USER_FACING_NODES.forEach((n) => {
    const node = byName(B, n);
    if (!node) { return; }
    const blob = JSON.stringify(node.parameters || {});
    assert(blob.indexOf('submission_key') === -1, n + ' references submission_key');
  });
  const added = P.APPROVED_ADDED_NODES.map((n) => byName(B, n));
  added.forEach((n) => {
    const blob = JSON.stringify(n.parameters);
    assert(!/reply_text|tg_body|reply_markup/.test(blob), n.name + ' touches client-facing fields');
  });
});

check('every customer-facing node is byte-identical to the baseline', () => {
  P.USER_FACING_NODES.forEach((n) => {
    eq(JSON.stringify(byName(B, n)), JSON.stringify(byName(A, n)), 'customer-facing node changed: ' + n);
  });
});

console.log('\n-- the Concierge invariants Write B may not disturb --');

check('the authority write keeps exactly one incoming edge, and there is no second path', () => {
  const into = [];
  Object.keys(B.connections).forEach((s) => {
    (B.connections[s].main || []).forEach((br) => (br || []).forEach((l) => {
      if (l && l.node === P.AUTHORITY_WRITE_NODE) { into.push(s); }
    }));
  });
  eq(JSON.stringify(into.sort()), JSON.stringify([P.AUTHORITY_WRITE_SOLE_SOURCE]),
    'edges into the authority write: ' + into.join(', '));
});

check('trigger, credential, webhookId, backoff and MCP exposure are untouched', () => {
  eq(JSON.stringify(byName(B, P.TRIGGER_NODE_NAME)), JSON.stringify(byName(A, P.TRIGGER_NODE_NAME)), 'the Telegram trigger changed');
  eq(B.nodes.filter((n) => /trigger$/i.test(n.type)).length, 1, 'trigger count changed');
  eq(byName(B, 'Read Bot Sessions').waitBetweenTries, 750, 'the session read backoff moved');
  eq(byName(B, 'Save Bot Event').onError, 'continueRegularOutput', 'Save Bot Event stopped being best-effort');
  assert(!byName(B, 'Save Bot Event').retryOnFail, 'Save Bot Event gained a retry');
  eq(B.settings.availableInMCP, false, 'availableInMCP is not false');
});

console.log('\n-- CONTROL --');

check('CONTROL: the real three-way input materializes to 51 nodes', () => {
  const v = run();
  assert(v.ok, 'materialization refused at ' + v.stage + ': ' + (v.failures || []).join(' | '));
  eq(v.cLive.nodes.length, 51, 'the materialized target is not 51 nodes');
  eq(R.findMarkers(v.cLive).length, 0, 'the materialized target carries redaction markers');
  assert(!byName(v.cLive, P.REMOVED_HTTP_NODE), 'the public handoff survived materialization');
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

// (1) the public HTTP fallback reintroduced
mustRefuse('(1) a public HTTP Lead Intake fallback is reintroduced', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ id: 'p84b-evil-http', name: 'Send Lead to Intake (Fallback)',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 400],
      parameters: { method: 'POST', url: 'https://example.invalid/webhook/finmentor-lead-intake', sendBody: true } });
    return m;
  })()
}, 'POLICY', 'unapproved node added: Send Lead to Intake (Fallback)');

// (2) a second internal target
mustRefuse('(2) a SECOND internal Execute Workflow target is added', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push({ id: 'p84b-evil-ew', name: 'Send Lead to Intake (Alt)',
      type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [0, 500],
      parameters: { mode: 'each', options: {}, workflowId: { __rl: true, mode: 'id', value: 'QmIyEW2ZEqKregmN' } } });
    return m;
  })()
}, 'POLICY', 'unapproved node added: Send Lead to Intake (Alt)');

// (3) the target workflow id changed
mustRefuse('(3) the target workflow id is repointed', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, P.HANDOFF_CALLER).parameters.workflowId.value = 'ShcmmJeLSE8LYVBk';
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', P.HANDOFF_CALLER);

// (3b) the target made steerable by expression
mustRefuse('(3b) the target workflow id becomes an EXPRESSION', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, P.HANDOFF_CALLER).parameters.workflowId.value = "={{ $json.target_workflow_id }}";
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', P.HANDOFF_CALLER);

// (4)(5) key sourced from the caller / re-minted — refused as an unapproved body change
mustRefuse('(4) the submission_key is sourced from the caller body', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, P.HANDOFF_BUILDER);
    n.parameters.jsCode = n.parameters.jsCode.replace(
      "const key = String(gate.__submission_key || '');",
      "const key = String($('Get Bot Session').first().json.submission_key || gate.__submission_key || '');");
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', P.HANDOFF_BUILDER);

mustRefuse('(5) a NEW submission_key is minted at handoff', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, P.HANDOFF_BUILDER);
    n.parameters.jsCode = n.parameters.jsCode.replace(
      "const key = String(gate.__submission_key || '');",
      "const key = 'sub_' + Array.from({length:32},()=>'0').join('');");
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', P.HANDOFF_BUILDER);

// (6)(7) mode / submission_key exposed to the client
mustRefuse('(6) the internal mode is exposed on a customer-facing node', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, 'Build Bot Response');
    n.parameters.jsCode += "\n// mode leak\n";
    return m;
  })()
}, 'POLICY', 'unapproved node modified: Build Bot Response');

mustRefuse('(7) the submission_key is written into the client transport body', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, 'Build Transport Request');
    n.parameters.jsCode += "\n// key leak\n";
    return m;
  })()
}, 'POLICY', 'unapproved node modified: Build Transport Request');

// (8)(9) Telegram identity
mustRefuse('(8) the Telegram trigger changes', {
  desiredReference: (() => { const m = clone(B); byName(m, P.TRIGGER_NODE_NAME).webhookId = 'deadbeef'; return m; })()
}, 'POLICY', 'unapproved node modified');

mustRefuse('(9) the Telegram credential is repointed', {
  desiredReference: (() => {
    const m = clone(B);
    byName(m, 'Send Client Message').credentials = { telegramApi: { id: 'OTHER', name: 'other' } };
    return m;
  })()
}, 'POLICY', 'unapproved node modified: Send Client Message');

// (10) customer-facing text / button
mustRefuse('(10) a customer-facing keyboard or message changes', {
  desiredReference: (() => {
    const m = clone(B);
    const n = byName(m, 'Build Bot Response');
    n.parameters.jsCode = n.parameters.jsCode.replace('menuKeyboard()', 'menuKeyboard() /* reworded */');
    return m;
  })()
}, 'POLICY', 'unapproved node modified: Build Bot Response');

// (11) a second authority-write path
mustRefuse('(11) a second authority-write path is added', {
  desiredReference: (() => {
    const m = clone(B);
    m.connections[P.HANDOFF_BUILDER] = { main: [[{ node: P.AUTHORITY_WRITE_NODE, type: 'main', index: 0 }]] };
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'protected node ' + P.AUTHORITY_WRITE_NODE);

// and the standing guards
mustRefuse('(12) the approved removal is skipped — the public node stays', {
  desiredReference: (() => {
    const m = clone(B);
    m.nodes.push(clone(byName(A, P.REMOVED_HTTP_NODE)));
    return m;
  })()
}, 'ABSOLUTE_INVARIANTS', 'approved removal was NOT performed: ' + P.REMOVED_HTTP_NODE);

mustRefuse('(13) live drifted from the sealed baseline', {
  liveWorkflow: (() => {
    const m = clone(L);
    byName(m, 'Build Bot Response').parameters.jsCode += '// someone edited production';
    return m;
  })()
}, 'BASELINE_DRIFT');

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
