#!/usr/bin/env node
// FINMENTOR V1 — a committed PUBLIC (website) merge reaches the single X-Ray owner alert.
//
// 2026-09-18 RU incident. Website Financial X-Ray request fmr_30250d2a7f4d4f088634188971829d61
// merged by email into FIN-1789469658573-427 (Leads row 30, Pipeline row 23 merge update,
// Activities row 190 lead_merged) and produced no owner alert: every eligible lead's legacy intake
// alert is suppressed in favour of the X-Ray owner alert, and Build C3 Intelligence Request
// returned nothing for a public merge, so X-Ray was never invoked and no ledger row was written.
//
// These checks EXECUTE the tracked node sources: the Lead Intake dispatcher, the X-Ray C3 target
// validator and the X-Ray pending selector, against the incident's own identifiers.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  NODE_NAME, OLD_PUBLIC_BRANCH, graphFacts, isApplied, isPreImage, patch, preImage, protectedShape, readReplacement
} from '../scripts/lib/v1-public-merge-owner-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const intakeRequest = src('n8n/src/lead-intake/c3-intelligence-request.js');
const xrayTarget = src('n8n/src/xray-analysis/c3-target.js');
const selectPending = src('n8n/src/xray-analysis/select-pending.js');
const buildInput = src('n8n/src/xray-analysis/build-input.js');

let passed = 0; const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};
function handle(values) {
  const items = values.map((json) => ({ json }));
  return { first: () => items[0], all: () => items, item: items[0], isExecuted: true };
}
function runCode(code, named = {}, input = [{}]) {
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(named, name)) throw new Error('node not executed: ' + name);
    return handle(named[name]);
  };
  return new Function('$', '$input', code)($, handle(input));
}

// ── the incident, exactly as the ledgers recorded it ─────────────────────────────────────────
const CANONICAL = 'FIN-1789469658573-427';
const REQUEST = 'fmr_30250d2a7f4d4f088634188971829d61';
const mergedContext = { provenance_trusted: false, lead_id: CANONICAL, submission_lead_id: 'fm-mu6xhpg2-jceo0n',
  request_id: REQUEST, lead_priority: 'HOT', status: 'Merged into ' + CANONICAL, dedup_escalated: false };
const publicMergeCommitted = {
  'Restore Lead Context (Merged)': [mergedContext],
  'Update Pipeline (Merge)': [{}],
  'Respond Merged': [{}]
};
const settings = [{ settings: { xray_analysis_enabled: true, xray_analysis_since: '2020-01-01', xray_max_per_run: 3 } }];
const pipelineRow = { lead_id: CANONICAL, created_at: '2026-09-15T10:54:14.685Z', priority: 'HOT', status: 'Qualified',
  request_id: 'fmr_9b18a35783ba447cb6fcf074adebd142', company: 'IMC GROUP SRL' };
// The canonical lead's ledger before the incident: earlier requests, two of them exhausted.
const priorLedger = [
  { lead_id: CANONICAL, analysis_id: 'XA-FIN-1789469658573-427-E413605CA330-F', request_id: 'sub_ff414c543ea2c9b9856279367fe958d2', review_status: 'AI_DRAFT', model: 'gpt-4.1', created_at: '2026-09-17T05:33:03.609Z', owner_brief_json: '{}' },
  { lead_id: CANONICAL, analysis_id: 'XA-FIN-1789469658573-427-E23B4122A6FF', request_id: 'sub_4d9a4639810d80cbdea58779f953a762', review_status: 'AI_DRAFT', model: 'gpt-4.1', created_at: '2026-09-17T09:15:16.393Z', owner_brief_json: '{}' },
  { lead_id: CANONICAL, analysis_id: 'XA-FIN-1789469658573-427-7A6180EBED82-F', request_id: 'sub_34a6e8299f283f70a5465e2822f619a3', review_status: 'ANALYSIS_FAILED', model: 'gpt-4.1', created_at: '2026-09-17T10:31:08.906Z', validation_errors: 'MODEL_OUTPUT_INVALID|ATTEMPT=3|MAX=3|ERROR=owner brief must be Russian' },
  { lead_id: CANONICAL, analysis_id: 'XA-FIN-1789469658573-427-F96A13D00466-F', request_id: 'sub_e38a04a70ae3488aa6a5d7b88f9e1f35', review_status: 'ANALYSIS_FAILED', model: 'gpt-4.1', created_at: '2026-09-17T12:42:53.740Z', validation_errors: 'MODEL_OUTPUT_INVALID|ATTEMPT=3|MAX=3|ERROR=owner brief must be Russian' }
];
const select = (target, ledger) => runCode(selectPending, {
  'Settings to Object': settings, 'Read XRay_Analysis': ledger, 'Read Pipeline': [pipelineRow], 'Validate C3 Lead Target': [target]
}, ledger);

console.log('\nV1 PUBLIC MERGE → SINGLE X-RAY OWNER ALERT');

let envelope = null;
check('the incident request dispatches one closed merged owner-intelligence envelope', () => {
  const out = runCode(intakeRequest, publicMergeCommitted);
  eq(out, [{ json: {
    event: 'ELIGIBLE_MERGE_COMMITTED', lead_id: CANONICAL, request_id: REQUEST, eligible: true,
    commit_authority: 'PUBLIC_PIPELINE_MERGE', source_workflow_id: 'QmIyEW2ZEqKregmN', settlement_mode: 'merged'
  } }], 'public merge envelope');
  envelope = out[0].json;
});

let target = null;
check('X-Ray accepts the public merge as a request-scoped merged target', () => {
  target = runCode(xrayTarget, {}, [envelope])[0].json;
  eq(target, { c3_targeted: true, c3_target_eligible: true, c3_target_lead_id: CANONICAL, c3_request_id: REQUEST, c3_settlement_mode: 'merged' }, 'target');
});

check('the newest request is analysed once even though older requests of the lead are exhausted', () => {
  const out = select(target, priorLedger);
  eq(out.length, 1, 'exactly one selection');
  eq(out[0].json.analysis_mode, 'NEW_REQUEST_ANALYSIS', 'mode');
  eq(out[0].json.request_id, REQUEST, 'the new request, not the Pipeline request_id');
  eq(out[0].json.lead_id, CANONICAL, 'canonical lead');
});

check('a request that already has a ledger row is never analysed or alerted twice', () => {
  const ledger = priorLedger.concat([{ lead_id: CANONICAL, analysis_id: 'XA-NEW', request_id: REQUEST, review_status: 'AI_DRAFT', model: 'gpt-4.1', created_at: '2026-09-18T12:25:00Z' }]);
  eq(select(target, ledger), [], 'second dispatch of the same request');
});

check('X-Ray pairs the exact website archive row by Raw JSON meta.request_id', () => {
  assert(/parsed\.raw\.meta && parsed\.raw\.meta\.request_id/.test(buildInput), 'build-input no longer reads Raw JSON meta.request_id');
  assert(/NEW_REQUEST_ANALYSIS/.test(buildInput), 'build-input no longer scopes merged requests');
});

check('a public merge without Pipeline merge commit proof dispatches nothing', () => {
  eq(runCode(intakeRequest, { 'Restore Lead Context (Merged)': [mergedContext] }), [], 'no commit proof');
  eq(runCode(intakeRequest, { 'Restore Lead Context (Merged)': [mergedContext], 'Respond Merged': [{}] }), [], 'responder without Pipeline update');
  eq(runCode(intakeRequest, { 'Restore Lead Context (Merged)': [mergedContext], 'Update Pipeline (Merge)': [{}] }), [], 'Pipeline update without responder');
});

check('a public merge with a caller-shaped request id fails closed', () => {
  let error = '';
  try {
    runCode(intakeRequest, Object.assign({}, publicMergeCommitted, { 'Restore Lead Context (Merged)': [Object.assign({}, mergedContext, { request_id: 'caller-controlled' })] }));
  } catch (caught) { error = caught.message; }
  eq(error, 'C3_PUBLIC_REQUEST_ID_INVALID', 'identity validation');
});

check('an INCOMPLETE public merge is dispatched ineligible and selects no backlog', () => {
  const out = runCode(intakeRequest, Object.assign({}, publicMergeCommitted, {
    'Restore Lead Context (Merged)': [Object.assign({}, mergedContext, { lead_priority: 'INCOMPLETE', status: 'Incomplete Lead' })]
  }));
  eq(out[0].json.eligible, false, 'eligibility');
  const t = runCode(xrayTarget, {}, [out[0].json])[0].json;
  eq(select(t, priorLedger), [], 'ineligible target must finish empty');
});

check('public new leads and internal merges keep their exact authority', () => {
  const pub = runCode(intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: false, lead_id: 'FIN-PUBLIC', request_id: 'fmr_' + 'a'.repeat(32), lead_priority: 'WARM', status: 'New' }],
    'Respond New Lead': [{}], 'Save to Pipeline': [{}]
  })[0].json;
  eq([pub.event, pub.commit_authority, pub.settlement_mode], ['ELIGIBLE_NEW_COMMITTED', 'PUBLIC_PIPELINE_COMMIT', undefined], 'public new');
  const internal = runCode(intakeRequest, {
    'Restore Lead Context (Merged)': [{ provenance_trusted: true, lead_id: 'FIN-CANON', request_id: 'sub_current', lead_priority: 'HOT', status: 'Merged into FIN-CANON' }],
    'Commit Verdict (Merge)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  })[0].json;
  eq([internal.event, internal.commit_authority], ['ELIGIBLE_MERGE_COMMITTED', 'RECEIPT_COMMIT_MERGE'], 'internal merge');
  eq(runCode(intakeRequest, {
    'Restore Lead Context (Merged)': [{ provenance_trusted: true, lead_id: 'FIN-CANON', request_id: 'sub_current' }],
    'Commit Verdict (Merge)': [{ __commit_updated_rows: 0, __commit_ok: 0 }]
  }), [], 'uncommitted internal merge');
});

// ── the deploy library: pre-image pinning and the one-node delta ──────────────────────────────
const replacement = readReplacement(ROOT);
const old = preImage(replacement);
const wf = (code) => ({ name: 'Lead Intake', nodes: [{ name: NODE_NAME, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: code } }], connections: {}, settings: {} });

check('the reconstructed pre-image is the deployed public-merge refusal and behaves as the incident did', () => {
  eq(old.split(OLD_PUBLIC_BRANCH).length, 2, 'old branch occurs once');
  assert(!old.includes('PUBLIC_PIPELINE_MERGE'), 'pre-image must not know the new authority');
  eq(runCode(old, publicMergeCommitted), [], 'the pre-image refuses the committed public merge');
  assert(isPreImage(wf(old), replacement) && !isApplied(wf(old), replacement), 'pre-image recognition');
});

check('patch changes exactly the one node code and refuses any other pre-image', () => {
  const out = patch(wf(old), replacement);
  assert(isApplied(out, replacement), 'candidate not applied');
  eq(JSON.stringify(protectedShape(out)), JSON.stringify(protectedShape(wf(old))), 'protected shape');
  let error = '';
  try { patch(wf(old + '\n// drift'), replacement); } catch (caught) { error = caught.message; }
  assert(/not the expected pre-image/.test(error), 'drifted live node accepted');
  error = '';
  try { patch(out, replacement); } catch (caught) { error = caught.message; }
  assert(/already applied/.test(error), 'double apply accepted');
});

// A minimal graph with the live topology the correction relies on.
const code = (name, jsCode = 'return $input.all();') => ({ name, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode } });
const guard = '// V1\nif (__v1Lead.provenance_trusted === true || __v1Eligible) return [];\n';
const link = (...names) => ({ main: names.map((n) => (n ? [{ node: n, type: 'main', index: 0 }] : [])) });
const topology = () => ({
  name: 'Lead Intake',
  nodes: [code('Update Pipeline (Merge)'), code('IF Internal (Merge)'), code('Respond Merged'), code('Respond Retry'), code('Build Intake Activity'),
    code('Restore Lead Context (Merged)'), code('Save Lead to CRM'), code(NODE_NAME), code('Receipt Commit (Merge)'), code('IF Internal (MergeFailed)'),
    { name: 'Run Owner Intelligence (C3)', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { value: 'tNSMRoKlFB52vjge' } } },
    code('Build Premium Telegram Brief', guard), code('Build Warm Telegram Alert', guard), code('Build Incomplete Telegram Alert', guard)],
  connections: {
    'Update Pipeline (Merge)': link('IF Internal (Merge)', 'IF Internal (MergeFailed)'),
    'IF Internal (Merge)': link('Receipt Commit (Merge)', 'Respond Merged'),
    'Respond Merged': link('Restore Lead Context (Merged)'),
    'Respond Retry': link('Build Intake Activity'),
    'Restore Lead Context (Merged)': link('Save Lead to CRM'),
    'Save Lead to CRM': link(NODE_NAME),
    [NODE_NAME]: link('Run Owner Intelligence (C3)')
  },
  settings: {}
});

check('the live-topology graph facts hold and each unsafe rewiring is refused', () => {
  eq(graphFacts(topology()).length, 10, 'fact count');
  const mutations = {
    'retry reaches the dispatcher': (g) => { g.connections['Respond Retry'] = link('Restore Lead Context (Merged)'); },
    'a second path into Respond Merged': (g) => { g.connections['Respond Retry'] = link('Respond Merged'); },
    'a failed Pipeline merge reaches IF Internal (Merge)': (g) => { g.connections['Update Pipeline (Merge)'] = link('IF Internal (Merge)', 'IF Internal (Merge)'); },
    'the dispatcher feeds a second node': (g) => { g.connections[NODE_NAME] = link('Run Owner Intelligence (C3)', 'Build Intake Activity'); },
    'owner intelligence targets another workflow': (g) => { g.nodes.find((n) => n.name === 'Run Owner Intelligence (C3)').parameters.workflowId.value = 'other'; },
    'an intake alert stops suppressing eligible leads': (g) => { g.nodes.find((n) => n.name === 'Build Warm Telegram Alert').parameters.jsCode = 'return $input.all();'; }
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const g = topology(); mutate(g);
    let refused = false;
    try { graphFacts(g); } catch (e) { refused = true; }
    assert(refused, 'graph mutation accepted: ' + label);
  }
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
