#!/usr/bin/env node
// FINMENTOR V1 — X-Ray retry contract gate.
//
//   node qa/v1-xray-retry-contract.test.mjs
//
// Offline. Runs the tracked Code-node bodies (select-pending, analysis-failed, validate-analysis,
// owner-cards) in the same minimal sandbox as qa/xray-analysis.test.mjs and proves the retry
// authority introduced on 2026-09-16: the lead's NEWEST failed request is retried, request-scoped
// and bounded, regardless of how many historical ledger rows the canonical lead has; successful
// requests are never reprocessed; and the owner copy promises a retry only when one is possible.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { MARKERS, NODE_SOURCE, PATCHED_NODES, isApplied, patchXrayRetryContract, protectedShape, readRetrySources } from '../scripts/lib/v1-xray-retry-contract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readRetrySources(ROOT);
const cards = readFileSync(join(ROOT, 'n8n', 'src', 'xray-analysis', 'owner-cards.js'), 'utf8').replace(/if \(typeof module[\s\S]*$/, '');
const CARDS = new Function(cards + '\nreturn XRAY_OWNER_CARDS;')();

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};
function runNode(body, { input = [], nodes = {}, paired = null } = {}) {
  const items = input.map((j, i) => paired ? { json: j, pairedItem: { item: paired[i] } } : { json: j });
  const $input = { all: () => items, first: () => items[0] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('no node ' + name);
    const items = nodes[name].map((j) => ({ json: j }));
    return { all: () => items, first: () => items[0], item: items[0], isExecuted: true };
  };
  const req = (m) => { if (m === 'crypto') return crypto; throw new Error('require blocked: ' + m); };
  return new Function('$input', '$', 'require', 'Buffer', body)($input, $, req, Buffer);
}

const settings = { owner_chat_id: '1', xray_analysis_enabled: true, xray_ai_model: 'gpt-4.1', xray_analysis_since: '2026-09-01T00:00:00.000Z', xray_max_per_run: 3 };
const PAST = '2020-01-01T00:00:00.000Z';
const pipeline = [{ lead_id: 'FIN-CANON', request_id: 'fmr_' + 'a'.repeat(32), priority: 'HOT', status: 'Qualified', created_at: '2026-09-15T10:54:14.685Z', xray_analysis_id: 'XA-OLD-F', xray_analysis_status: 'ANALYSIS_FAILED' }];
const failedRow = (analysisId, requestId, createdAt, attempt, extra = {}) => ({
  analysis_id: analysisId, lead_id: 'FIN-CANON', request_id: requestId, created_at: createdAt,
  review_status: 'ANALYSIS_FAILED', analysis_json: '', owner_brief_json: '', model: 'gpt-4.1',
  validation_errors: 'UPSTREAM_RATE_LIMIT|ATTEMPT=' + attempt + '|MAX=3|NEXT=' + PAST + '|ERROR=The service is receiving too many requests from you',
  ...extra
});
const successRow = (analysisId, requestId, createdAt) => ({
  analysis_id: analysisId, lead_id: 'FIN-CANON', request_id: requestId, created_at: createdAt,
  review_status: 'CLIENT_READY', analysis_json: '{"ok":true}', owner_brief_json: '{"ok":true}'
});
const select = (ledger, pipe = pipeline) => runNode(sources.selectPending, {
  input: ledger, nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipe, 'Read XRay_Analysis': ledger }
});

// The live 15:26 case: an exhausted website analysis plus the new merged request's failed row.
const OLD_EXHAUSTED = failedRow('XA-OLD-F', 'fmr_' + 'a'.repeat(32), '2026-09-15T11:00:11.725Z', 3);
const NEW_FAILED = failedRow('XA-NEW-F', 'sub_' + 'b'.repeat(32), '2026-09-16T12:26:30.169Z', 1);

check('INCIDENT — the previous rule never retried a lead with two ledger rows', () => {
  // Reconstructed from the pre-correction source: exactly one ledger row was required.
  const legacyRule = (rows) => rows.length === 1;
  eq(legacyRule([OLD_EXHAUSTED, NEW_FAILED]), false, 'legacy rule');
});

check('multiple historical ledger rows do not prevent retry of the exact newest failed request', () => {
  const out = select([OLD_EXHAUSTED, NEW_FAILED]);
  eq(out.length, 1, 'selected count');
  eq(out[0].json.analysis_mode, 'RETRY_FAILED', 'mode');
  eq(out[0].json.existing_analysis.analysis_id, 'XA-NEW-F', 'newest failed row is the authority');
  eq(out[0].json.request_id, 'sub_' + 'b'.repeat(32), 'retry carries the failed request identity, not the canonical lead request');
  eq(out[0].json.lead_id, 'FIN-CANON', 'canonical lead retained');
});

check('the exhausted historical failure is never selected, alone or beside the new request', () => {
  eq(select([OLD_EXHAUSTED]), [], 'exhausted alone');
  const out = select([OLD_EXHAUSTED, NEW_FAILED]);
  assert(out.every((item) => item.json.existing_analysis.analysis_id !== 'XA-OLD-F'), 'exhausted row selected');
});

check('a published success beside a newer failed request does not block the retry and is not reprocessed', () => {
  const published = successRow('XA-PUB', 'fmr_' + 'c'.repeat(32), '2026-09-04T05:11:08.465Z');
  const out = select([published, NEW_FAILED]);
  eq(out.length, 1, 'selected count');
  eq(out[0].json.existing_analysis.analysis_id, 'XA-NEW-F', 'retry target');
  eq(out.some((item) => item.json.existing_analysis.analysis_id === 'XA-PUB'), false, 'success reprocessed');
});

check('a successful request is never analysed twice: a success for the same request_id ends retries', () => {
  const sameRequestSuccess = successRow('XA-NEW-OK', 'sub_' + 'b'.repeat(32), '2026-09-16T12:00:00.000Z');
  eq(select([OLD_EXHAUSTED, sameRequestSuccess, NEW_FAILED]), [], 'retried a request that already succeeded');
});

check('the newest row wins: a newer success after an older failure means nothing is pending', () => {
  const newerSuccess = successRow('XA-NEWER', 'sub_' + 'd'.repeat(32), '2026-09-16T13:00:00.000Z');
  eq(select([NEW_FAILED, newerSuccess]), [], 'older failed request retried past a newer success');
});

check('retry is bounded: attempt three is never selected, attempt two is', () => {
  eq(select([OLD_EXHAUSTED, failedRow('XA-NEW-F', 'sub_' + 'b'.repeat(32), '2026-09-16T12:26:30.169Z', 3)]), [], 'attempt 3 retried');
  eq(select([OLD_EXHAUSTED, failedRow('XA-NEW-F', 'sub_' + 'b'.repeat(32), '2026-09-16T12:26:30.169Z', 2)]).length, 1, 'attempt 2 not retried');
});

check('retry waits for NEXT and fails closed on an ambiguous newest row', () => {
  const future = failedRow('XA-NEW-F', 'sub_' + 'b'.repeat(32), '2026-09-16T12:26:30.169Z', 1,
    { validation_errors: 'UPSTREAM_RATE_LIMIT|ATTEMPT=1|MAX=3|NEXT=2999-01-01T00:00:00.000Z' });
  eq(select([OLD_EXHAUSTED, future]), [], 'retried before NEXT');
  const twin = failedRow('XA-TWIN-F', 'sub_' + 'e'.repeat(32), '2026-09-16T12:26:30.169Z', 1);
  eq(select([NEW_FAILED, twin]), [], 'ambiguous newest rows were not failed closed');
});

check('the schedule sweep cannot select an unrelated historic request of the same lead', () => {
  const out = select([OLD_EXHAUSTED, successRow('XA-PUB', 'fmr_' + 'c'.repeat(32), '2026-09-04T05:11:08.465Z'), NEW_FAILED]);
  eq(out.map((item) => item.json.request_id), ['sub_' + 'b'.repeat(32)], 'request identities selected');
});

check('a failed row that never reached the model (empty model) is inert: no per-sweep audit loop', () => {
  const ghost = failedRow('XA-TG-GHOST-F', 'C-1-2', '2026-09-16T14:00:18.565Z', 1, { lead_id: 'TG-LEGACY', model: '' });
  const tgPipeline = [{ lead_id: 'TG-LEGACY', request_id: '', priority: 'WARM', status: 'New', created_at: '2026-09-11T12:35:38.994Z' }];
  eq(select([ghost], tgPipeline), [], 'ghost row retried');
  eq(select([ghost, { ...ghost, analysis_id: 'XA-TG-GHOST-2-F', created_at: '2026-09-16T05:00:17.297Z' }], tgPipeline), [], 'ghost rows retried');
  const real = { ...ghost, analysis_id: 'XA-TG-REAL-F', created_at: '2026-09-16T15:00:00.000Z', model: 'gpt-4.1' };
  eq(select([ghost, real], tgPipeline).length, 1, 'a real newest failure is still retried');
});

check('single-row leads keep the exact previous behaviour (identity of the ledger row preserved)', () => {
  const only = failedRow('XA-ONLY-F', 'req', '2026-09-10T00:00:00.000Z', 1);
  const out = select([only]);
  eq(out.length, 1, 'count');
  assert(out[0].json.existing_analysis === only, 'ledger row object identity changed');
  eq(out[0].json.request_id, 'req', 'request id carried');
});

check('a retry never re-alerts the owner (notify_owner false) and is capped at one per lead', () => {
  const out = select([OLD_EXHAUSTED, NEW_FAILED]);
  eq(out.length, 1, 'exactly one retry per lead');
  const failed = runNode(sources.analysisFailed, {
    input: [{ error: 'The service is receiving too many requests from you' }],
    nodes: { 'Build Analysis Input': [{ lead_id: 'FIN-CANON', request_id: out[0].json.request_id, company: 'X', locale: 'ru',
      analysis_mode: 'RETRY_FAILED', existing_analysis: out[0].json.existing_analysis, xray_analysis_id: 'XA-OLD-F' }] }
  })[0].json;
  eq(failed.notify_owner, false, 'retry re-alerted the owner');
  eq(failed.analysis_id, 'XA-NEW-F', 'retry wrote a second ledger row instead of updating in place');
  eq(failed.retry_attempt, 2, 'attempt');
  eq(failed.retry_exhausted, false, 'exhausted at attempt two');
  eq(failed.retry_possible, true, 'retry_possible at attempt two');
});

check('retry copy matches retry truth: possible → promised; exhausted → not promised, System Alert carries the cause', () => {
  const run = (attempt) => runNode(sources.analysisFailed, {
    input: [{ error: 'The service is receiving too many requests from you' }],
    nodes: { 'Build Analysis Input': [{ lead_id: 'FIN-CANON', request_id: 'sub_x', company: 'X', locale: 'ru',
      analysis_mode: attempt > 1 ? 'RETRY_FAILED' : 'NEW_REQUEST_ANALYSIS',
      existing_analysis: attempt > 1 ? failedRow('XA-X-F', 'sub_x', PAST, attempt - 1) : null }] }
  })[0].json;
  const first = run(1);
  eq(first.retry_possible, true, 'first failure retry_possible');
  assert(/будет безопасно повторён/.test(first.owner_text), 'first failure must promise the retry it will get');
  const last = run(3);
  eq(last.retry_exhausted, true, 'third failure exhausted');
  eq(last.retry_possible, false, 'third failure retry_possible');
  assert(!/будет безопасно повторён/.test(last.owner_text), 'exhausted failure still promised a retry');
  assert(/Безопасные повторы завершены/.test(last.owner_text), 'exhausted wording missing');
  assert(!/too many requests/i.test(last.owner_text) && !/RATE_LIMIT/.test(last.owner_text), 'technical cause leaked into the owner card');
  assert(/UPSTREAM_RATE_LIMIT\|ATTEMPT=3\|MAX=3/.test(last.analysis_row.validation_errors), 'ledger evidence missing');
});

check('renderFailed derives the recovery line from retry_possible / retry_exhausted only', () => {
  const promised = CARDS.renderFailed({ company: 'X', locale: 'ru', lead_id: 'FIN-1', retry_possible: true, retry_exhausted: false });
  const denied = CARDS.renderFailed({ company: 'X', locale: 'ru', lead_id: 'FIN-1', retry_possible: false, retry_exhausted: false });
  const legacy = CARDS.renderFailed({ company: 'X', locale: 'ru', lead_id: 'FIN-1' });
  assert(/будет безопасно повторён/.test(promised), 'possible retry not promised');
  assert(!/будет безопасно повторён/.test(denied) && /Безопасные повторы завершены/.test(denied), 'impossible retry still promised');
  assert(/будет безопасно повторён/.test(legacy), 'legacy callers (no flag) changed wording');
});

check('the validation-failure path emits the same retry truth', () => {
  assert(sources.validateAnalysis.includes('retry_possible: !exhausted'), 'validate-analysis lacks retry_possible');
  assert(sources.validateAnalysis.includes('retry_exhausted: exhausted, retry_possible: !exhausted'), 'validate-analysis card call lacks retry_possible');
});

check('the patcher replaces exactly the three Code nodes and refuses double application', () => {
  const fixture = { name: 'xray fixture', connections: {}, nodes: PATCHED_NODES.map((name) => ({ name, type: 'n8n-nodes-base.code', parameters: { jsCode: '// old' }, position: [0, 0] }))
    .concat([{ name: 'AI X-Ray Analysis', type: '@n8n/n8n-nodes-langchain.openAi', parameters: { modelId: 'x' }, retryOnFail: true, maxTries: 2, waitBetweenTries: 3000 },
      { name: 'Every 10 Minutes', type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: {} } }]) };
  const out = patchXrayRetryContract(fixture, sources);
  assert(isApplied(out, sources), 'not applied');
  for (const name of PATCHED_NODES) for (const marker of MARKERS[NODE_SOURCE[name]]) assert(out.nodes.find((n) => n.name === name).parameters.jsCode.includes(marker), name + ' marker missing: ' + marker);
  eq(protectedShape(out), protectedShape(fixture), 'protected shape');
  eq(out.nodes.length, fixture.nodes.length, 'node count');
  let twice = '';
  try { patchXrayRetryContract(out, sources); } catch (error) { twice = error.message; }
  assert(twice.includes('already applied'), 'double application accepted: ' + twice);
  // a partially corrected live shape (one node still old) is completed, not refused
  const partial = JSON.parse(JSON.stringify(out));
  partial.nodes.find((n) => n.name === 'Analysis Failed Row').parameters.jsCode = '// stale';
  const completed = patchXrayRetryContract(partial, sources);
  assert(isApplied(completed, sources), 'partial shape not completed');
});

// ── output ↔ input pairing (the 14:00Z misattribution) ─────────────────────────────────────────

const SAFE_TG = { lead_id: 'TG-LEGACY', request_id: 'C-1-2', company: '', locale: 'ru', analysis_mode: 'RETRY_FAILED',
  existing_analysis: failedRow('XA-TG-F', 'C-1-2', '2026-09-16T05:00:17.297Z', 1, { lead_id: 'TG-LEGACY' }), xray_analysis_id: '' };
const AUDIT_TG = { analysis_ready: false, analysis_mode: 'RETRY_FAILED', lead_id: 'TG-LEGACY', request_id: 'C-1-2',
  audit_finding: { severity: 'P0', code: 'REQUEST_ID_NOT_FOUND', detail: '', owner_text: 'x' } };
const SAFE_FIN = { analysis_ready: true, lead_id: 'FIN-CANON', request_id: 'sub_' + 'b'.repeat(32), company: 'IMC', locale: 'ro',
  analysis_mode: 'RETRY_FAILED', existing_analysis: NEW_FAILED, xray_analysis_id: 'XA-OLD-F', ai_model: 'gpt-4.1', source_channel: 'telegram_premium' };

check('INCIDENT — an audit finding ahead of a safe item no longer steals the failure of the next lead', () => {
  const out = runNode(sources.analysisFailed, {
    input: [{ error: 'The service is receiving too many requests from you' }], paired: [0],
    nodes: { 'Build Analysis Input': [AUDIT_TG, SAFE_FIN] }
  });
  eq(out.length, 1, 'one failure row');
  eq(out[0].json.lead_id, 'FIN-CANON', 'failure attributed to the wrong lead');
  eq(out[0].json.analysis_id, 'XA-NEW-F', 'failure did not update the failed row in place');
  eq(out[0].json.retry_attempt, 2, 'attempt did not advance');
});

check('pairing follows pairedItem, not position, when a batch splits between success and error', () => {
  const secondFailed = { ...SAFE_FIN, lead_id: 'FIN-SECOND', request_id: 'sub_' + 'c'.repeat(32), analysis_mode: 'NEW_REQUEST_ANALYSIS', existing_analysis: null };
  const out = runNode(sources.analysisFailed, {
    input: [{ error: 'boom' }], paired: [1],
    nodes: { 'Build Analysis Input': [SAFE_FIN, secondFailed] }
  });
  eq(out[0].json.lead_id, 'FIN-SECOND', 'error item paired by position instead of pairedItem');
  const valid = runNode(sources.validateAnalysis, {
    input: [{ output: 'not json' }], paired: [1],
    nodes: { 'Build Analysis Input': [SAFE_FIN, secondFailed], 'Settings to Object': [{ settings }] }
  });
  eq(valid[0].json.lead_id, 'FIN-SECOND', 'validation output paired by position instead of pairedItem');
  eq(valid[0].json.retry_possible, true, 'validation failure retry truth');
});

check('without pairedItem (offline harness) the safe-only index pairing still skips audit findings', () => {
  const out = runNode(sources.analysisFailed, {
    input: [{ error: 'The service is receiving too many requests from you' }],
    nodes: { 'Build Analysis Input': [AUDIT_TG, SAFE_FIN] }
  });
  eq(out[0].json.lead_id, 'FIN-CANON', 'audit finding was paired');
});

check('a legacy failed row (concierge C-… request) retries by lead_id instead of an audit finding every sweep', () => {
  const leads = [
    { 'Lead ID': 'TG-LEGACY', 'Request ID': '', 'Raw JSON': JSON.stringify({ source: 'telegram_concierge', client: { company: 'Legacy SRL' }, premium: {} }) },
    { 'Lead ID': 'FIN-SUB', 'Request ID': 'sub_' + 'b'.repeat(32), 'Raw JSON': JSON.stringify({ source: 'telegram_miniapp', client: { company: 'IMC' }, premium: {}, request_id: 'sub_' + 'b'.repeat(32) }) }
  ];
  const run = (pipe) => runNode(sources.buildInput, { input: leads, nodes: { 'Select Pending Leads': [pipe], 'Settings to Object': [{ settings }] } })[0].json;
  const legacy = run({ lead_id: 'TG-LEGACY', request_id: 'C-1-2', analysis_mode: 'RETRY_FAILED', priority: 'WARM', status: 'New', created_at: '2026-09-11T00:00:00Z', existing_analysis: SAFE_TG.existing_analysis });
  eq(legacy.analysis_ready, true, 'legacy retry became an audit finding: ' + JSON.stringify(legacy.audit_finding || {}));
  eq(legacy.source_pairing.method, 'lead_id', 'legacy retry pairing method');
  const merged = run({ lead_id: 'FIN-CANON', request_id: 'sub_' + 'b'.repeat(32), analysis_mode: 'RETRY_FAILED', priority: 'HOT', status: 'Qualified', created_at: '2026-09-15T00:00:00Z', existing_analysis: NEW_FAILED });
  eq(merged.analysis_ready, true, 'merged retry not built');
  eq(merged.source_pairing.method, 'request_id', 'merged retry must keep its request authority');
  const missing = run({ lead_id: 'FIN-CANON', request_id: 'sub_' + 'f'.repeat(32), analysis_mode: 'RETRY_FAILED', priority: 'HOT', status: 'Qualified', created_at: '2026-09-15T00:00:00Z', existing_analysis: NEW_FAILED });
  eq(missing.analysis_ready, false, 'a submission retry whose archived request is missing must fail closed');
  eq(missing.audit_finding.code, 'REQUEST_ID_NOT_FOUND', 'fail-closed code');
});

console.log('\nV1 X-Ray retry contract: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const failure of failures) console.log('  ' + failure);
  process.exit(1);
}
