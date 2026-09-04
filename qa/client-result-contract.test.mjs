#!/usr/bin/env node
// FINMENTOR — C3 step 5: the curated CLIENT_READY result contract, held equal across its three holders.
//
//   node qa/client-result-contract.test.mjs
//
// Offline. THE MISMATCH THIS CLOSES (found live, 2026-09-04): the Mini App result screen renders
// `zone_label` (condition line) and `summary` (headline text), and the X-Ray publisher writes both
// into XRay_Client_Results.result_json — but the Gateway's `Attach Client Result` allow-list did
// not carry them, so a customer's result screen lost its condition wording and its summary.
// Nothing crashed, which is exactly why no gate caught it: each holder was internally consistent
// and nothing compared them.
//
// WHAT IS HELD.
//   1. Mini App RESULT_KEYS (app-premium/net.js)  ⊆  Gateway allow-list (built candidate)   — every
//      key the screen renders reaches it.
//   2. Gateway allow-list  ⊆  Mini App RESULT_KEYS — the Gateway exposes nothing the screen does not
//      require (the inverse safety condition).
//   3. The builder's exported constant equals the allow-list compiled into the candidate — the
//      tracked candidate is not stale.
//   4. The X-Ray publisher's result_json keys equal the allow-list — what is published is exactly
//      what is let through.
//   5. No internal/raw field is in any holder: review token, analysis_json, request id, confidence,
//      fabrication flags, validation errors, prompt, model, review status, reviewed_at, ids.
//   6. EXECUTED: the candidate's `Attach Client Result` code, handed a CLIENT_READY row whose
//      result_json carries the full curated result PLUS injected internal keys, returns exactly the
//      curated keys — `zone_label` and `summary` pass through by value, the injected keys do not.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { CLIENT_RESULT_KEYS } from '../scripts/build-miniapp-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// ── the three holders ──────────────────────────────────────────────────────────────────────────

// 1. the Mini App: RESULT_KEYS as written in net.js (the page is compiled from it)
const netSrc = readFileSync(join(ROOT, 'app-premium', 'net.js'), 'utf8');
const hostMatch = /var RESULT_KEYS = \[([\s\S]*?)\];/.exec(netSrc);
const HOST_KEYS = hostMatch ? hostMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];

// 2. the Gateway: the allow-list compiled into the tracked candidate's Attach Client Result node
const WF = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));
const attachCode = String((WF.nodes.find((n) => n.name === 'Attach Client Result') || { parameters: {} }).parameters.jsCode || '');
const gwMatch = /const allowed = (\[[^\]]*\])/.exec(attachCode);
const GATEWAY_KEYS = gwMatch ? JSON.parse(gwMatch[1]) : [];

// 3. the X-Ray publisher: run build-client-result.js on a full, valid analysis and read the keys
const publisherSrc = readFileSync(join(ROOT, 'n8n', 'src', 'xray-analysis', 'build-client-result.js'), 'utf8');
function runNode(body, { input = [], nodes = {} } = {}) {
  const $input = { all: () => input.map((j) => ({ json: j })), first: () => ({ json: input[0] }) };
  const $ = (name) => {
    if (!(name in nodes)) { throw new Error('no node ' + name); }
    const items = nodes[name].map((j) => ({ json: j }));
    return { all: () => items, first: () => items[0], item: items[0], isExecuted: true };
  };
  const req = (m) => { if (m === 'crypto') { return crypto; } throw new Error('require blocked: ' + m); };
  return new Function('$input', '$', 'require', 'Buffer', body)($input, $, req, Buffer);
}
const week = (n) => [{ action: 'Действие ' + n, owner_role: 'Собственник', expected_output: 'Результат', control_or_kpi: 'KPI', priority: 'HIGH' }];
const ANALYSIS = {
  executive_summary: 'Бизнес имеет кассовые разрывы.',
  financial_maturity: { score_1_to_5: 2, label: 'Реактивное управление', rationale: 'Нет P&L.' },
  key_risks: [{ category: 'cash', title: 'Кассовые разрывы', evidence: 'из анкеты', potential_impact: 'x', priority: 'HIGH' }],
  data_gaps: [], management_priorities: ['Платёжный календарь'],
  plan_30_days: { days_1_7: week(1), days_8_14: week(2), days_15_21: week(3), days_22_30: week(4) },
  tomorrow_actions: ['Назначить ответственного'], documents_required: [],
  recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', label: 'Финансовый health-check', rationale: 'Нужна полная диагностика.' },
  confidence: 'LOW', limitations: ['Цифры, не подтверждённые входными данными: 12mil']
};
const TOKEN = 'a'.repeat(64);
const LEDGER_ROW = {
  analysis_id: 'XA-L-1-ABC', lead_id: 'L-1', request_id: 'fmr_' + 'f'.repeat(32), locale: 'ru', created_at: '2026-09-04T04:31:12.046Z',
  analysis_version: 'xray-v2', model: 'gpt-4.1', score: 47, zone: 'ORANGE', maturity_score: 2, primary_risk: 'Кассовые разрывы',
  analysis_json: JSON.stringify(ANALYSIS), plan_30d_json: JSON.stringify(ANALYSIS.plan_30_days), review_status: 'AI_DRAFT', reviewed_at: '',
  review_token: TOKEN, review_token_expires_at: '2026-10-04T04:31:12.048Z', confidence: 'LOW', fabrication_flags: '12mil', validation_errors: '',
  source_channel: 'website_xray', executive_summary: ANALYSIS.executive_summary, recommended_next_step: 'FINANCIAL_HEALTH_CHECK', next_step_label: 'Финансовый health-check', customer_notified_at: ''
};
const published = runNode(publisherSrc, { nodes: { 'Review POST Verdict': [{ proceed_update: true, source_row: LEDGER_ROW }] } });
const PUBLISHED_ROW = published[0] ? published[0].json : {};
const PUBLISHED_RESULT = (() => { try { return JSON.parse(String(PUBLISHED_ROW.result_json || 'null')); } catch (e) { return null; } })() || {};
const PUBLISHER_KEYS = Object.keys(PUBLISHED_RESULT);

// Fields that exist upstream and must never reach any holder of the client contract.
const FORBIDDEN = ['review_token', 'review_token_expires_at', 'analysis_json', 'plan_30d_json', 'request_id', 'confidence', 'fabrication_flags',
  'validation_errors', 'limitations', 'data_gaps', 'documents_required', 'prompt', 'ai_user_prompt', 'model', 'analysis_version', 'reviewed_at',
  'review_status', 'executive_summary', 'analysis_id', 'lead_id', 'owner_note', 'customer_notified_at', 'source_channel', 'primary_risk', 'maturity_score', 'created_at'];

const sorted = (a) => a.slice().sort().join(',');

console.log('\nFINMENTOR — C3 step 5: curated CLIENT_READY result contract (three holders, one list)\n');

check('the three holders were read: Mini App RESULT_KEYS, Gateway allow-list, publisher result_json', () => {
  assert(HOST_KEYS.length >= 10, 'RESULT_KEYS not found in app-premium/net.js');
  assert(GATEWAY_KEYS.length >= 10, 'allow-list not found in the candidate Attach Client Result');
  assert(PUBLISHER_KEYS.length >= 10, 'the publisher produced no result_json: ' + JSON.stringify(published).slice(0, 120));
});

// 1. every key the screen renders reaches it
for (const k of HOST_KEYS) {
  check('screen -> gateway: Mini App RESULT_KEYS.' + k + ' is in the Gateway allow-list', () => assert(GATEWAY_KEYS.includes(k), k + ' is dropped by the Gateway'));
}
// 2. the inverse: the Gateway exposes nothing the screen does not require
for (const k of GATEWAY_KEYS) {
  check('gateway -> screen: allow-list.' + k + ' is required by the Mini App RESULT_KEYS', () => assert(HOST_KEYS.includes(k), k + ' is let through but never rendered'));
}
check('the two lists are the same set, in the same size', () => eq(sorted(GATEWAY_KEYS), sorted(HOST_KEYS), 'sets differ'));
check('the regression itself: zone_label and summary are in the Gateway allow-list', () => {
  assert(GATEWAY_KEYS.includes('zone_label'), 'zone_label missing'); assert(GATEWAY_KEYS.includes('summary'), 'summary missing');
});

// 3. the tracked candidate is built from the exported constant
check('builder constant CLIENT_RESULT_KEYS equals the allow-list compiled into the candidate (candidate not stale)', () => eq(sorted(CLIENT_RESULT_KEYS), sorted(GATEWAY_KEYS), 'rebuild the candidate: node scripts/build-miniapp-gateway.mjs'));
check('builder constant order is the Mini App order (one list, copied verbatim)', () => eq(CLIENT_RESULT_KEYS.join(','), HOST_KEYS.join(','), 'order differs'));

// 4. what is published is exactly what is let through
check('publisher result_json keys == Gateway allow-list', () => eq(sorted(PUBLISHER_KEYS), sorted(GATEWAY_KEYS), 'publisher and gateway disagree'));
check('publisher row columns are the live XRay_Client_Results columns', () => eq(sorted(Object.keys(PUBLISHED_ROW)), 'analysis_id,lead_id,locale,published_at,result_json,review_status,score,zone', 'columns'));
check('publisher writes zone_label and summary by value', () => {
  eq(PUBLISHED_RESULT.zone_label, 'Оранжевая зона', 'zone_label'); eq(PUBLISHED_RESULT.summary, ANALYSIS.executive_summary, 'summary');
});

// 5. no internal field anywhere in the contract
for (const k of FORBIDDEN) {
  check('forbidden key never in the contract: ' + k, () => {
    assert(!GATEWAY_KEYS.includes(k), 'in the Gateway allow-list'); assert(!HOST_KEYS.includes(k), 'in the Mini App RESULT_KEYS'); assert(!PUBLISHER_KEYS.includes(k), 'in the published result_json');
  });
}
check('the published result_json text carries no token, request id, ledger id or confidence internals', () => {
  const text = String(PUBLISHED_ROW.result_json);
  for (const s of [TOKEN, 'fmr_', 'XA-L-1', 'confidence', 'fabrication', '12mil', 'AI_DRAFT', 'ANALYSIS_FAILED', 'gpt-4.1']) { assert(!text.includes(s), 'contains ' + s); }
});

// 6. EXECUTED: the Gateway node itself, with internals injected next to the curated keys
check('EXECUTED: Attach Client Result passes zone_label and summary through and strips every injected internal key', () => {
  const session = { app_session_id: 'AS-' + 'c'.repeat(64), lead_id: 'L-1', state: 'submitted', __response: { app_session_id: 'AS-' + 'c'.repeat(64), state: 'submitted' } };
  const injected = Object.assign({}, PUBLISHED_RESULT, { review_token: TOKEN, analysis_json: '{}', request_id: 'fmr_x', confidence: 'LOW', fabrication_flags: '12mil', prompt: 'p', model: 'gpt-4.1', reviewed_at: 'now', review_status: 'CLIENT_READY', lead_id: 'L-1', analysis_id: 'XA-L-1-ABC' });
  const row = Object.assign({}, PUBLISHED_ROW, { id: 1, result_json: JSON.stringify(injected) });
  const handle = (items) => ({ first: () => ({ json: items[0] }), all: () => items.map((j) => ({ json: j })), isExecuted: true });
  const fn = new Function('$', '$input', 'require', attachCode);
  const out = fn((n) => { if (n !== 'Resolve Session') { throw new Error('unexpected node read: ' + n); } return handle([session]); }, handle([row]), () => { throw new Error('require()'); })[0].json;
  eq(out.__response.result_state, 'CLIENT_READY', 'result_state');
  const r = out.__response.result;
  eq(sorted(Object.keys(r)), sorted(GATEWAY_KEYS), 'the attached result is not exactly the allow-list');
  eq(r.zone_label, PUBLISHED_RESULT.zone_label, 'zone_label did not pass through');
  eq(r.summary, PUBLISHED_RESULT.summary, 'summary did not pass through');
  eq(JSON.stringify(r.labels), JSON.stringify(PUBLISHED_RESULT.labels), 'labels changed');
  for (const k of FORBIDDEN) { assert(!(k in r), k + ' leaked through the Gateway'); }
  assert(!('lead_id' in out.__response), 'lead_id leaked into the client response');
});
check('EXECUTED: a non-CLIENT_READY row still yields result null / PENDING (semantics unchanged by the fix)', () => {
  const session = { app_session_id: 'AS-' + 'c'.repeat(64), lead_id: 'L-1', state: 'submitted', __response: {} };
  const handle = (items) => ({ first: () => ({ json: items[0] }), all: () => items.map((j) => ({ json: j })), isExecuted: true });
  const fn = new Function('$', '$input', 'require', attachCode);
  for (const bad of [[Object.assign({}, PUBLISHED_ROW, { review_status: 'AI_DRAFT' })], [Object.assign({}, PUBLISHED_ROW, { lead_id: 'L-2' })], []]) {
    const out = fn(() => handle([session]), handle(bad), () => { throw new Error('require()'); })[0].json;
    eq(out.__response.result, null, 'a result was attached'); eq(out.__response.result_state, 'PENDING', 'result_state');
  }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
