#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { compileFile } from '../scripts/lib/compile-workflow-sdk.mjs';
import { patchRequestContext, protectedShape, readSource } from '../scripts/lib/v1-ro-0832-request-context.mjs';
import { readCorrectionSources } from '../scripts/lib/v1-ro-uat-correction.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readCorrectionSources(ROOT);
const requestId = 'sub_' + 'f'.repeat(32);
const canonicalLeadId = 'FIN-CANON';
let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + ' (got ' + JSON.stringify(actual) + ')');
};
function handle(values) {
  const items = values.map((json) => ({ json }));
  return { first: () => items[0], all: () => items, item: items[0], isExecuted: true };
}
function run(code, nodes = {}, input = []) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('node not executed: ' + name);
    return handle(nodes[name]);
  };
  return new Function('$', '$input', code)($, handle(input));
}
const settings = { xray_analysis_enabled: true, xray_analysis_since: '2020-01-01', xray_max_per_run: 3, xray_ai_model: 'gpt-4.1' };
const envelope = run(sources.intakeRequest, {
  'Restore Lead Context (Merged)': [{ provenance_trusted: true, lead_id: canonicalLeadId, request_id: requestId, lead_priority: 'HOT', status: 'Merged into ' + canonicalLeadId }],
  'Commit Verdict (Merge)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
}, [{}])[0].json;
const target = run(sources.xrayTarget, {}, [envelope])[0].json;
const oldFailure = { analysis_id: 'XA-OLD-F', lead_id: canonicalLeadId, request_id: 'sub_' + 'a'.repeat(32), created_at: '2026-09-16T12:26:30.169Z', review_status: 'ANALYSIS_FAILED', model: 'gpt-4.1', validation_errors: 'UPSTREAM_RATE_LIMIT|ATTEMPT=3|MAX=3' };
const pipeline = { lead_id: canonicalLeadId, request_id: 'fmr_' + 'a'.repeat(32), company: 'IMC GROUP SRL', name: 'Old Name', role: 'Old Role', main_pain: 'Old pain', selected_goals: 'Old goal', priority: 'COLD', financial_zone: 'RED', status: 'Qualified', created_at: '2026-09-15T10:54:14.685Z' };
const select = (ledger) => run(sources.selectPending, {
  'Settings to Object': [{ settings }], 'Read XRay_Analysis': ledger, 'Read Pipeline': [pipeline], 'Validate C3 Lead Target': [target]
});
const raw = JSON.stringify({ source: 'telegram_miniapp', request_id: requestId, client: { company: 'FINMENTOR UAT RO FINAL', name: 'Nume Nou', role: 'Director nou' }, premium: {}, selected_goals: ['Control nou'] });
const archive = { 'Lead ID': 'FIN-SUBMISSION', 'Request ID': requestId, 'Raw JSON': raw, 'Created At': '2026-09-17T05:32:26.241Z', Company: 'FINMENTOR UAT RO FINAL', Name: 'Nume Nou', Role: 'Director nou', Language: 'ro', 'Main Pain': 'Problemă nouă', 'Selected Goals': 'Control nou', 'Financial Zone': 'GREEN', 'Lead Priority': 'HOT' };
const selected = select([oldFailure]);
const analysisInput = run(sources.buildInput, { 'Select Pending Leads': [selected[0].json], 'Settings to Object': [{ settings }] }, [archive])[0].json;
const deployedBuildInput = readSource(ROOT);
let deployedAnalysisInput = null;
let deployedRuntimeError = null;
try {
  deployedAnalysisInput = run(deployedBuildInput, {
    'Select Pending Leads': [selected[0].json],
    'Settings to Object': [{ settings }]
  }, [archive])[0].json;
} catch (error) {
  deployedRuntimeError = error;
}
const candidate = compileFile(join(ROOT, 'n8n/candidate/xray-analysis-workflow.sdk.js'), {});

check('1 same contact may merge into one canonical lead', () => eq(envelope.lead_id, canonicalLeadId, 'canonical lead'));
check('2 merged request keeps a new request id', () => eq(envelope.request_id, requestId, 'request id'));
check('3 exhausted historical request is not authority', () => assert(selected[0].json.request_id === requestId && selected[0].json.request_id !== oldFailure.request_id, 'old request selected'));
check('4 targeted X-Ray receives the exact new request id', () => eq(target.c3_request_id, requestId, 'target request'));
check('5 NEW_REQUEST_ANALYSIS uses exact archived facts', () => {
  eq(analysisInput.source_pairing.method, 'request_id', 'pairing');
  eq(analysisInput.company, 'FINMENTOR UAT RO FINAL', 'company');
  assert(/Problemă nouă/.test(analysisInput.input_digest_text) && !/Old pain/.test(analysisInput.input_digest_text), 'request facts');
  assert(/diagnoses.*2[–-]4/.test(analysisInput.ai_system_prompt), 'diagnosis cardinality contract');
  const fixture = { name: 'fixture', nodes: [{ name: 'Build Analysis Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: '// old' }, position: [0, 0] }], connections: {}, settings: {} };
  const patched = patchRequestContext(fixture, readSource(ROOT));
  eq(protectedShape(patched), protectedShape(fixture), 'bounded patch');
});
check('5a deploy candidate executes with the LI helper bound at runtime', () => {
  assert(!deployedRuntimeError, deployedRuntimeError && deployedRuntimeError.stack || 'runtime failed');
  assert(/const LI = \(function \(\)/.test(deployedBuildInput), 'LI runtime binding missing');
});
check('5b deploy candidate selects the exact archived request', () => {
  eq(deployedAnalysisInput.source_pairing.method, 'request_id', 'pairing');
  eq(deployedAnalysisInput.request_id, requestId, 'request id');
  eq(deployedAnalysisInput.company, 'FINMENTOR UAT RO FINAL', 'company');
  assert(/Problemă nouă/.test(deployedAnalysisInput.input_digest_text) && !/Old pain/.test(deployedAnalysisInput.input_digest_text), 'request facts');
});
check('5c deploy candidate produces valid model input', () => {
  assert(deployedAnalysisInput.analysis_ready === true, 'analysis not ready');
  assert(typeof deployedAnalysisInput.ai_system_prompt === 'string' && deployedAnalysisInput.ai_system_prompt.length > 100, 'system prompt missing');
  assert(typeof deployedAnalysisInput.ai_user_prompt === 'string' && deployedAnalysisInput.ai_user_prompt.length > 100, 'user prompt missing');
});
check('5d deploy candidate preserves RO and the approved diagnoses contract', () => {
  eq(deployedAnalysisInput.locale, 'ro', 'locale');
  assert(/diagnoses.*2[–-]4/.test(deployedAnalysisInput.ai_system_prompt), 'diagnosis cardinality contract');
});
check('6 successful request has exactly one rich owner-alert route', () => {
  eq(candidate.nodes.filter((node) => node.name === 'Telegram Owner Alert').length, 1, 'owner alert nodes');
  eq(candidate.connections['IF New Owner Alert Required'].main[0].map((edge) => edge.node), ['Telegram Owner Alert'], 'owner alert route');
});
check('7 old failure alert is not replayed', () => assert(!selected.some((item) => item.json.request_id === oldFailure.request_id), 'old failure replayed'));
check('8 brief resolves the newest request analysis', () => {
  const brief = (company) => JSON.stringify({ header: { company }, client_facts: [{ id: 'main_problem', value: company + ' pain' }], diagnoses: [{ conclusion: 'Observation' }], unknowns: [], first_meeting_objective: 'Objective', conversation_opening: 'Opening', discovery_questions: [{ question: 'Q', why: 'W' }], solution_hypothesis: { format: 'Discovery' }, next_action: { action: 'Call' }, contact: {} });
  const out = run(sources.precallCode, { 'Parse Lead Command v2': [{ lead_id: canonicalLeadId, chat_id: '1' }] }, [
    { lead_id: canonicalLeadId, analysis_id: 'XA-OLD', created_at: '2026-09-16T00:00:00Z', review_status: 'ANALYSIS_FAILED', owner_brief_json: brief('OLD') },
    { lead_id: canonicalLeadId, analysis_id: 'XA-NEW', created_at: '2026-09-17T05:33:03Z', review_status: 'AI_DRAFT', owner_brief_json: brief('NEW') }
  ])[0].json;
  assert(out.reply_text.includes('NEW') && !out.reply_text.includes('OLD pain'), 'brief authority');
});
check('9 merge does not create a duplicate canonical lead', () => assert(envelope.settlement_mode === 'merged' && envelope.lead_id === canonicalLeadId, 'duplicate lead semantics'));
check('10 same request cannot create duplicate analysis', () => eq(select([oldFailure, { analysis_id: 'XA-NEW', lead_id: canonicalLeadId, request_id: requestId, created_at: '2026-09-17T05:33:03Z', review_status: 'AI_DRAFT' }]), [], 'duplicate analysis'));
check('11 same request cannot create duplicate owner alert', () => eq(select([oldFailure, { analysis_id: 'XA-NEW', lead_id: canonicalLeadId, request_id: requestId, created_at: '2026-09-17T05:33:03Z', review_status: 'AI_DRAFT' }]), [], 'duplicate alert'));
check('12 Romanian locale is preserved', () => eq(analysisInput.locale, 'ro', 'locale'));

console.log('\nV1 RO 08:32 request context: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const failure of failures) console.log('  ' + failure);
  process.exit(1);
}
