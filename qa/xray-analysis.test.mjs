#!/usr/bin/env node
// C1 source checkpoint. Evidence: STATIC for graph/SQL checks, SIMULATED for Code-node execution.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'n8n', 'src', 'xray-analysis');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const labels = read('labels.js').replace(/if \(typeof module[\s\S]*$/, '');
let passed = 0; const failures = [];
function check(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failures.push(name + ': ' + e.message); console.log('FAIL ' + name + ' — ' + e.message); } }
const assert = (v, m) => { if (!v) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
function runNode(body, { input = [], nodes = {} } = {}) {
  const items = xs => xs.map(json => ({ json }));
  const handle = xs => ({ all: () => items(xs), first: () => ({ json: xs[0] || {} }), item: { json: xs[0] || {} }, isExecuted: true });
  const $ = name => { if (!(name in nodes)) throw new Error('no node ' + name); return handle(nodes[name]); };
  const fn = new Function('$input', '$', 'require', 'Buffer', body);
  const out = fn(handle(input), $, m => { if (m === 'crypto') return crypto; throw new Error('require blocked'); }, Buffer);
  if (!out) return [];
  return (Array.isArray(out) ? out : [out]).map(x => x.json);
}

const settings = { xray_ai_model: 'gpt-4.1', xray_review_base_url: 'https://n8n.test/webhook/finmentor-xray-review', crm_url: 'https://crm.test' };
const leadId = 'L-2';
const raw = {
  tool: 'xray_extended',
  meta: { page_url: 'https://finmentor.md/?request_id=req-1', request_id: 'req-1', ga_client_id: 'GA1.2.3', site_language: 'ru' },
  client: { name: 'Ivan Petrov', company: 'Acme Legal SRL', email: 'ivan@example.com', phone: '+373 69 123 456', telegram: '@ivanp', address: 'Strada Test 10' },
  diagnostic: { score: 47, traffic_light: 'ORANGE', risk_zones: ['cash_flow', 'margin'], business_model: 'Ivan Petrov', business_model_key: 'retail' },
  answers: { main_pain: 'Ivan Petrov at Acme Legal SRL, Strada Test 10; ivan@example.com; +37369123456; @ivanp; https://private.test; request req-1; GA1.2.3', nested: { note: 'identifier-secret' } },
  completion: { completion_score: 92, data_quality_hint: 'ok' }
};
const pipe = { lead_id: leadId, request_id: 'req-1', company: 'Acme Legal SRL', financial_zone: 'ORANGE', priority: 'HOT', industry_category: 'Ivan Petrov', main_pain: 'private free text', created_at: '2026-09-02T00:00:00Z' };
const lead = { 'Lead ID': leadId, 'Raw JSON': JSON.stringify(raw), 'Diagnostic Score': '47' };
let aiInput;

check('SIMULATED: explicit allowlist excludes names, company, address, contacts, URL and identifiers', () => {
  const out = runNode(read('build-input.js'), { input: [lead], nodes: {
    'Analysis Claim Verdict': [{ claim_won: 1, lead_id: leadId }], 'Select Pending Leads': [pipe], 'Settings to Object': [{ settings }]
  } });
  eq(out.length, 1, 'output count'); aiInput = out[0];
  const prompt = aiInput.ai_system_prompt + aiInput.ai_user_prompt + aiInput.input_digest_text;
  for (const secret of ['Ivan Petrov', 'Acme Legal SRL', 'Strada Test 10', 'ivan@example.com', '+37369123456', '@ivanp', 'private.test', 'req-1', 'GA1.2.3', 'identifier-secret', 'private free text']) assert(!prompt.includes(secret), 'leaked ' + secret);
  assert(prompt.includes('cash_flow') && prompt.includes('retail'), 'approved categorical facts missing');
  eq(aiInput.score, 47, 'deterministic score'); eq(aiInput.zone, 'ORANGE', 'deterministic zone');
  eq(aiInput.analysis_version, 'xray-v2', 'analysis version');
});

const action = suffix => ({ action: 'Prepare cash flow control ' + suffix, owner_role: 'Finance manager', expected_output: 'Approved control report', control_or_kpi: 'Qualitative completion check', priority: 'HIGH' });
const goodPlan = {
  executive_summary: 'The available questionnaire signals indicate gaps in cash flow control. Management reporting should be formalised.',
  financial_maturity: { score_1_to_5: 2, label: 'Reactive control', rationale: 'Management controls are incomplete.' },
  key_risks: [{ category: 'cash_flow', title: 'Cash flow visibility', evidence: 'The questionnaire flags cash flow.', potential_impact: 'Decisions may be delayed.', priority: 'HIGH' }],
  data_gaps: [{ missing_information: 'Current cash position', why_it_matters: 'It supports liquidity decisions.', how_to_obtain: 'Prepare a reconciled statement.' }],
  management_priorities: ['Formalise cash flow review'],
  plan_30_days: { days_1_7: [action('A'), action('B')], days_8_14: [action('C'), action('D')], days_15_21: [action('E'), action('F')], days_22_30: [action('G'), action('H')] },
  tomorrow_actions: ['Assign the finance owner'], documents_required: ['Management reports'],
  recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', rationale: 'A structured diagnostic is appropriate.' },
  confidence: 'MEDIUM', limitations: []
};
const validate = read('validate-analysis.js').replace('// __XRAY_LABELS__ (inlined by the builder)', labels);
const aiResponse = value => ({ output_text: typeof value === 'string' ? value : JSON.stringify(value) });
const validateOne = value => runNode(validate, { input: [aiResponse(value)], nodes: { 'Build Analysis Input': [aiInput], 'Settings to Object': [{ settings }] } })[0];

check('SIMULATED: valid strict contract becomes AI_DRAFT without changing score or zone', () => {
  const o = validateOne(goodPlan); const row = o.analysis_row;
  assert(o.is_valid === true, 'not valid'); eq(row.review_status, 'AI_DRAFT', 'state');
  eq(row.score, 47, 'score'); eq(row.zone, 'ORANGE', 'zone');
  assert(/^[0-9a-f]{64}$/.test(row.review_token), 'review token is not 256-bit');
  assert(Date.parse(row.review_token_expires_at) > Date.now(), 'review token not bounded');
  const stored = JSON.parse(row.analysis_json); assert(!('score' in stored) && !('zone' in stored), 'model authority survived');
  for (const week of Object.values(stored.plan_30_days)) eq(week.length, 2, 'week length');
});

for (const [name, value] of [
  ['invalid JSON', '{not-json'],
  ['missing schema field', (() => { const x = structuredClone(goodPlan); delete x.key_risks; return x; })()],
  ['invalid maturity', { ...goodPlan, financial_maturity: { ...goodPlan.financial_maturity, score_1_to_5: 9 } }],
  ['malformed risks', { ...goodPlan, key_risks: [{ title: 'Only title' }] }],
  ['missing plan', (() => { const x = structuredClone(goodPlan); delete x.plan_30_days; return x; })()],
  ['missing week', (() => { const x = structuredClone(goodPlan); delete x.plan_30_days.days_15_21; return x; })()],
  ['one action in period', (() => { const x = structuredClone(goodPlan); x.plan_30_days.days_1_7 = [action('one')]; return x; })()],
  ['invalid action shape', (() => { const x = structuredClone(goodPlan); delete x.plan_30_days.days_1_7[0].owner_role; return x; })()],
  ['invalid product', { ...goodPlan, recommended_next_step: { product: 'FAKE', rationale: 'x' } }]
]) check('SIMULATED: ' + name + ' becomes ANALYSIS_FAILED and has no token', () => {
  const o = validateOne(value); eq(o.is_valid, false, 'valid flag'); eq(o.analysis_row.review_status, 'ANALYSIS_FAILED', 'state');
  eq(o.analysis_row.review_token, '', 'token'); eq(o.analysis_row.analysis_json, '', 'model JSON stored');
});

check('SIMULATED: fabricated factual figure fails closed', () => {
  const x = structuredClone(goodPlan); x.key_risks[0].evidence = 'Revenue is 3500000 EUR and margin is 12%.';
  const o = validateOne(x); eq(o.analysis_row.review_status, 'ANALYSIS_FAILED', 'state');
  assert(o.analysis_row.validation_errors.includes('factual contract violation'), 'reason absent');
});

check('STATIC+SIMULATED: overlapping sweep claim has one winner for lead_id + analysis_version', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0004_preproduction_authority.up.sql'), 'utf8');
  const builder = fs.readFileSync(path.join(ROOT, 'scripts/build-xray-analysis-workflow.mjs'), 'utf8');
  assert(/primary key \(lead_id, analysis_version\)/i.test(sql), 'unique authority missing');
  assert(/on conflict \(lead_id, analysis_version\) do nothing/i.test(builder), 'atomic conflict rule missing');
  const claims = new Set(); const claim = key => claims.has(key) ? 0 : (claims.add(key), 1);
  eq(claim(leadId + '|xray-v2') + claim(leadId + '|xray-v2'), 1, 'winner count');
});

const ledger = { ...validateOne(goodPlan).analysis_row, analysis_id: 'XA-1', review_token_expires_at: '2099-01-01T00:00:00.000Z' };
check('SIMULATED: GET renders review/confirmation and cannot mutate', () => {
  const before = JSON.stringify(ledger);
  const out = runNode(read('review-surface.js'), { input: [ledger], nodes: { 'Review GET Webhook': [{ query: { a: 'XA-1', t: ledger.review_token } }] } })[0];
  eq(out.http_status, 200, 'status'); assert(/method="post"/.test(out.html), 'POST confirmation absent');
  eq(JSON.stringify(ledger), before, 'GET mutated row'); assert(!/review_status[^<]*CLIENT_READY/.test(out.html), 'GET claims promotion');
});
function post(row, token = row.review_token) { return runNode(read('review-verdict.js'), { input: [row], nodes: { 'Review POST Webhook': [{ body: { a: row.analysis_id, t: token } }] } })[0]; }
check('SIMULATED: POST token/status checks are fail closed', () => {
  eq(post(ledger).verdict, 'CAS_REQUEST', 'valid request');
  eq(post(ledger, 'b'.repeat(64)).verdict, 'DENIED', 'wrong token');
  eq(post({ ...ledger, review_token_expires_at: '2020-01-01T00:00:00Z' }).verdict, 'DENIED', 'expired');
  eq(post({ ...ledger, review_status: 'ANALYSIS_FAILED' }).verdict, 'DENIED', 'failed');
});
check('SIMULATED: CAS permits AI_DRAFT transition and repeated CLIENT_READY idempotently', () => {
  const req = post(ledger);
  const first = runNode(read('review-cas-verdict.js'), { input: [{ authority_status: 'CLIENT_READY', cas_won: 1 }], nodes: { 'Review POST Verdict': [req] } })[0];
  const again = runNode(read('review-cas-verdict.js'), { input: [{ authority_status: 'CLIENT_READY', cas_won: 0 }], nodes: { 'Review POST Verdict': [req] } })[0];
  eq(first.verdict, 'PROMOTED', 'first'); eq(again.verdict, 'ALREADY_READY', 'repeat'); assert(first.proceed_update && again.proceed_update, 'projection repair disabled');
});

check('SIMULATED: CLIENT_READY publisher is curated; draft/failed are unavailable', () => {
  const cas = { proceed_update: true, source_row: { ...ledger, review_status: 'AI_DRAFT' } };
  const out = runNode(read('build-client-result.js'), { nodes: { 'Review CAS Verdict': [cas] } });
  eq(out.length, 1, 'published count'); const result = JSON.parse(out[0].result_json);
  eq(result.labels.product, 'Финансовый рентген бизнеса', 'RU product');
  const text = JSON.stringify(result); for (const k of ['review_token', 'request_id', 'lead_id', 'model', 'confidence', 'prompt', 'raw']) assert(!text.includes(k), 'exposed ' + k);
  const ro = runNode(read('build-client-result.js'), { nodes: { 'Review CAS Verdict': [{ ...cas, source_row: { ...ledger, locale: 'ro' } }] } });
  eq(JSON.parse(ro[0].result_json).labels.product, 'Test de sănătate financiară FINMENTOR', 'RO product');
  assert(!JSON.stringify(ro).includes('Radiografia Financiară FINMENTOR'), 'obsolete RO product');
  eq(runNode(read('build-client-result.js'), { nodes: { 'Review CAS Verdict': [{ proceed_update: false, source_row: ledger }] } }).length, 0, 'draft exposed');
  eq(runNode(read('build-client-result.js'), { nodes: { 'Review CAS Verdict': [{ proceed_update: true, source_row: { ...ledger, review_status: 'ANALYSIS_FAILED' } }] } }).length, 0, 'failed exposed');
});

console.log('\nxray-analysis: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
