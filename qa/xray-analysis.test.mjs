// FINMENTOR — X-Ray Analysis engine gates (C1).
//
// Runs the n8n Code-node bodies under n8n/src/xray-analysis/ in a minimal sandbox that
// emulates $input / $('Node') / require('crypto'), so the contract can be proven offline:
//   * PII never reaches the prompt, even when pasted into free text
//   * score and zone are copied from deterministic input, never from the model
//   * the output contract is capped and normalised
//   * fabricated figures are flagged and lower confidence
//   * the review action needs the per-row token, is constant-time, and is idempotent
//   * pending selection is fail-closed and consent-gated

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'n8n', 'src', 'xray-analysis');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const labelsSrc = read('labels.js').replace(/if \(typeof module[\s\S]*$/, '');

let passed = 0; let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// Sandbox: runs a Code node body with the given $input items and named node outputs.
function runNode(body, { input = [], nodes = {} } = {}) {
  const $input = { all: () => input.map(j => ({ json: j })), first: () => ({ json: input[0] }) };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('no node ' + name);
    const items = nodes[name].map(j => ({ json: j }));
    return { all: () => items, first: () => items[0] };
  };
  const req = (m) => { if (m === 'crypto') return crypto; throw new Error('require blocked: ' + m); };
  const fn = new Function('$input', '$', 'require', 'Buffer', body);
  return fn($input, $, req, Buffer);
}

const settings = { owner_chat_id: '1', xray_analysis_enabled: true, xray_ai_model: 'gpt-4.1', xray_analysis_since: '2026-09-01T00:00:00.000Z', xray_max_per_run: 3, xray_review_base_url: 'https://n8n.test/webhook/finmentor-xray-review', crm_url: 'https://docs.google.com/x' };

// ---------- settings ----------
{
  const out = runNode(read('settings.js'), { input: [{ key: 'owner_chat_id', value: '42' }, { key: 'xray_max_per_run', value: '50' }, { key: 'xray_analysis_since', value: 'garbage' }] });
  const s = out[0].json.settings;
  check('settings: owner chat id read from Settings', s.owner_chat_id === '42');
  check('settings: per-run cap clamped to 10', s.xray_max_per_run === 10);
  check('settings: invalid since falls back to program start', s.xray_analysis_since === '2026-09-03T00:00:00.000Z');
  check('settings: default model gpt-4.1', s.xray_ai_model === 'gpt-4.1');
}

// ---------- select pending ----------
const pipeline = [
  { lead_id: 'L-1', priority: 'HOT', status: 'Qualified', created_at: '2026-09-02T10:00:00Z' },
  { lead_id: 'L-2', priority: 'COLD', status: 'Nurture', created_at: '2026-09-02T11:00:00Z' },
  { lead_id: 'L-3', priority: 'INCOMPLETE', status: 'Incomplete lead', created_at: '2026-09-02T12:00:00Z' },
  { lead_id: 'L-old', priority: 'HOT', status: 'Qualified', created_at: '2026-08-01T12:00:00Z' },
  { lead_id: 'L-4', priority: 'WARM', status: 'New', created_at: '2026-09-02T13:00:00Z' },
  { lead_id: 'L-5', priority: 'WARM', status: 'New', created_at: '2026-09-02T14:00:00Z' }
];
{
  const out = runNode(read('select-pending.js'), { input: [{ lead_id: 'L-1', review_status: 'AI_DRAFT' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  const ids = out.map(i => i.json.lead_id);
  check('pending: analysed lead excluded', !ids.includes('L-1'));
  check('pending: INCOMPLETE (no consent) never analysed', !ids.includes('L-3'));
  check('pending: leads before xray_analysis_since excluded', !ids.includes('L-old'));
  check('pending: capped at xray_max_per_run, oldest first', ids.join(',') === 'L-2,L-4,L-5', ids.join(','));
}
{
  const out = runNode(read('select-pending.js'), { input: [{ error: 'read failed' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('pending: FAIL CLOSED when the analysis ledger is unreadable', out.length === 0);
  const out2 = runNode(read('select-pending.js'), { input: [{}], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': [{ error: 'x' }] } });
  check('pending: FAIL CLOSED when Pipeline is unreadable', out2.length === 0);
  const out3 = runNode(read('select-pending.js'), { input: [{}], nodes: { 'Settings to Object': [{ settings: { ...settings, xray_analysis_enabled: false } }], 'Read Pipeline': pipeline } });
  check('pending: master switch off yields nothing', out3.length === 0);
  const out4 = runNode(read('select-pending.js'), { input: [{}], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('pending: empty ledger (alwaysOutputData {}) is treated as no analyses', out4.length === 3);
}

// ---------- build input ----------
const rawRu = {
  tool: 'xray_extended', source: 'website_questionnaire',
  meta: { page_url: 'https://www.finmentor.md/questionnaire.html?utm_source=x', request_id: 'req-1', ga_client_id: 'GA1.2.3', analytics_consent: true, site_language: 'ru' },
  client: { name: 'Иван Петров', email: 'ivan@example.com', phone_or_messenger: '+373 69 123 456', telegram: '@ivanp', company: 'ООО Пример', language: 'Русский' },
  diagnostic: { completed: true, score: 47, traffic_light: 'ORANGE', risk_zones: ['cash_flow', 'margin', 'kpi_dashboard'], business_model: 'Retail', urgency: '1 месяц', main_pain: 'Кассовые разрывы' },
  answers: { extended_intake: { comment: 'Пишите на ivan@example.com или +373 69 123 456, оборот 1 200 000 EUR' } },
  intake: { company_profile: { industry: 'Retail', turnover_range: '€1–2M' }, financial_control: { q_f1: 'Нет' } },
  completion: { completion_score: 92, data_quality_hint: 'ok' }
};
const pipeRu = { lead_id: 'L-2', request_id: 'req-1', company: 'ООО Пример', financial_zone: 'ORANGE', priority: 'HOT', business_model: 'Retail', industry_category: 'Retail', turnover_range: '€1–2M', employees_range: '10–50', main_pain: 'Кассовые разрывы', selected_problems: 'a, b', selected_goals: 'c', documents_status: 'Есть', selected_documents: 'P&L', work_interest: 'Внедрение системы', critical_flags: '', source_page: 'https://www.finmentor.md/questionnaire.html', created_at: '2026-09-02T11:00:00Z' };
const leadRowRu = { 'Lead ID': 'L-2', 'Raw JSON': JSON.stringify(rawRu), 'Diagnostic Score': '47', 'Language': 'Русский', 'Page URL': 'https://www.finmentor.md/questionnaire.html', 'Tool': 'xray_extended', 'Data Quality Hint': 'ok' };

let inputItem;
{
  const out = runNode(read('build-input.js'), { input: [leadRowRu], nodes: { 'Select Pending Leads': [pipeRu], 'Settings to Object': [{ settings }] } });
  check('input: one item per pending lead', out.length === 1);
  inputItem = out[0].json;
  check('input: locale RU detected', inputItem.locale === 'ru');
  check('input: deterministic score carried (47)', inputItem.score === 47);
  check('input: deterministic zone carried from Pipeline (ORANGE)', inputItem.zone === 'ORANGE');
  const prompt = inputItem.ai_user_prompt + inputItem.ai_system_prompt;
  check('input: no email in prompt', !/ivan@example\.com/.test(prompt));
  check('input: no phone in prompt', !/69 123 456/.test(prompt));
  check('input: no handle in prompt', !/@ivanp/.test(prompt));
  check('input: no person/company name in prompt', !/Иван Петров|ООО Пример/.test(prompt));
  check('input: no ga_client_id / request_id / url in prompt', !/GA1\.2\.3|req-1|finmentor\.md/.test(prompt));
  check('input: turnover statement from free text survives scrubbing (business fact)', /1 200 000 EUR/.test(prompt));
  check('input: system prompt forbids changing score/zone (RU)', /Не пересчитывай/.test(inputItem.ai_system_prompt));
  check('input: contract lists plan_30_days weeks', /days_22_30/.test(inputItem.ai_user_prompt));
  check('input: source channel website_xray', inputItem.source_channel === 'website_xray');
}
{
  const rawRo = { ...rawRu, meta: { ...rawRu.meta, site_language: 'ro', page_url: 'https://www.finmentor.md/ro/questionnaire.html' } };
  const out = runNode(read('build-input.js'), { input: [{ ...leadRowRu, 'Lead ID': 'L-4', 'Raw JSON': JSON.stringify(rawRo) }], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-4', source_page: 'https://www.finmentor.md/ro/questionnaire.html' }], 'Settings to Object': [{ settings }] } });
  check('input: RO locale from site_language', out[0].json.locale === 'ro');
  check('input: RO system prompt is Romanian and formal', /dumneavoastră/.test(out[0].json.ai_system_prompt) && /DATE INSUFICIENTE/.test(out[0].json.ai_system_prompt));
}
{
  // Mini App / Concierge lead: no Leads row, no score
  const out = runNode(read('build-input.js'), { input: [], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-5', financial_zone: 'UNKNOWN', source_page: '' }], 'Settings to Object': [{ settings }] } });
  check('input: lead without questionnaire row still analysed', out.length === 1);
  check('input: missing score becomes INSUFFICIENT DATA, not a number', out[0].json.score === null && /INSUFFICIENT DATA/.test(out[0].json.ai_user_prompt));
  check('input: zone UNKNOWN carried', out[0].json.zone === 'UNKNOWN');
}
{
  // Leak guard: a forbidden key that survives sanitisation must skip the lead
  const leaky = { ...pipeRu, lead_id: 'L-6', main_pain: 'call me at ivan@example.com' };
  const out = runNode(read('build-input.js'), { input: [], nodes: { 'Select Pending Leads': [leaky], 'Settings to Object': [{ settings }] } });
  check('input: PII in a Pipeline field is scrubbed, lead still analysed', out.length === 1 && !/ivan@example/.test(out[0].json.ai_user_prompt));
}

// ---------- validate ----------
const goodPlan = {
  executive_summary: 'Бизнес имеет кассовые разрывы. Управленческий отчёт о прибылях и убытках (P&L) не ведётся.',
  financial_maturity: { score_1_to_5: 2, label: 'Реактивное управление', rationale: 'Нет P&L.' },
  key_risks: [1, 2, 3, 4, 5, 6, 7].map(i => ({ category: 'cash', title: 'Риск ' + i, evidence: 'из анкеты', potential_impact: 'x', priority: 'high' })),
  data_gaps: [{ missing_information: 'Остатки денег', why_it_matters: 'y', how_to_obtain: 'z' }],
  management_priorities: ['П1', 'П2', 'П3', 'П4'],
  plan_30_days: { days_1_7: [{ action: 'Платёжный календарь', owner_role: 'Собственник', expected_output: 'Календарь', control_or_kpi: 'Еженедельно', priority: 'HIGH' }], days_8_14: [{ action: 'A' }], days_15_21: [], days_22_30: [{ action: 'B', priority: 'weird' }] },
  tomorrow_actions: ['a', 'b', 'c', 'd'],
  documents_required: ['Выписки'],
  recommended_next_step: { product: 'SOMETHING_ELSE', rationale: 'r' },
  confidence: 'HIGH',
  limitations: [],
  score: 99, zone: 'GREEN'
};
function aiResp(obj) { return { output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n' + JSON.stringify(obj) + '\n```' }] }] }; }
const validateSrc = read('validate-analysis.js').replace('// __XRAY_LABELS__ (inlined by the builder)', labelsSrc);
{
  const out = runNode(validateSrc, { input: [aiResp(goodPlan)], nodes: { 'Build Analysis Input': [inputItem], 'Settings to Object': [{ settings }] } });
  const r = out[0].json.analysis_row; const a = JSON.parse(r.analysis_json);
  check('validate: score is deterministic (47), model value 99 ignored', r.score === 47);
  check('validate: zone is deterministic (ORANGE), model value GREEN ignored', r.zone === 'ORANGE' && !('score' in a) && !('zone' in a));
  check('validate: key_risks capped at 5', a.key_risks.length === 5);
  check('validate: management_priorities capped at 3', a.management_priorities.length === 3);
  check('validate: tomorrow_actions capped at 3', a.tomorrow_actions.length === 3);
  check('validate: unknown product falls back to DISCOVERY_CALL', a.recommended_next_step.product === 'DISCOVERY_CALL' && /Discovery Call/.test(r.next_step_label));
  check('validate: priority normalised (high -> HIGH, weird -> MEDIUM)', a.key_risks[0].priority === 'HIGH' && a.plan_30_days.days_22_30[0].priority === 'MEDIUM');
  check('validate: review_status AI_DRAFT with a 32-hex review token', r.review_status === 'AI_DRAFT' && /^[0-9a-f]{32}$/.test(r.review_token));
  check('validate: maturity 2 carried', r.maturity_score === 2 && out[0].json.pipeline_row.xray_maturity === 2);
  check('validate: no fabrication flags on clean plan', r.fabrication_flags === '' && r.confidence === 'HIGH');
  check('validate: pipeline projection is narrow (no JSON)', !('analysis_json' in out[0].json.pipeline_row) && out[0].json.pipeline_row.xray_analysis_status === 'AI_DRAFT');
  const alert = out[0].json.owner_alert;
  check('owner alert: RU structure per C1.7', /ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ/.test(alert.text) && /47 из 100/.test(alert.text) && /ОРАНЖЕВАЯ ЗОНА/.test(alert.text) && /2 из 5/.test(alert.text) && /ГОТОВ К ПРОВЕРКЕ/.test(alert.text));
  check('owner alert: no raw JSON exposed', !/\{"/.test(alert.text));
  check('owner alert: review link carries analysis id and token', alert.review_url.includes('a=' + encodeURIComponent(r.analysis_id)) && alert.review_url.includes('t=' + r.review_token));
}
{
  const fab = { ...goodPlan, executive_summary: 'Выручка компании составляет 3 500 000 EUR, маржа 12%.' , key_risks: [{ title: 'Долг 850 000 MDL', category: 'debt', evidence: 'x', potential_impact: 'y', priority: 'HIGH' }] };
  const out = runNode(validateSrc, { input: [aiResp(fab)], nodes: { 'Build Analysis Input': [inputItem], 'Settings to Object': [{ settings }] } });
  const r = out[0].json.analysis_row;
  check('validate: fabricated figures flagged', r.fabrication_flags.length > 0, r.fabrication_flags);
  check('validate: fabricated figures force confidence LOW', r.confidence === 'LOW');
  check('validate: owner told to check figures', /Проверить цифры/.test(out[0].json.owner_alert.text));
  const clean = { ...goodPlan, executive_summary: 'Указанный оборот 1 200 000 EUR требует контроля.' };
  const out2 = runNode(validateSrc, { input: [aiResp(clean)], nodes: { 'Build Analysis Input': [inputItem], 'Settings to Object': [{ settings }] } });
  check('validate: figure present in input is not flagged', out2[0].json.analysis_row.fabrication_flags === '');
  const kpi = { ...goodPlan, plan_30_days: { ...goodPlan.plan_30_days, days_15_21: [{ action: 'Маржа по категориям', owner_role: 'Аналитик', expected_output: 'Отчёт по 12 000 SKU', control_or_kpi: 'Маржа посчитана для >80% продаж', priority: 'MEDIUM' }] } };
  const out3 = runNode(validateSrc, { input: [aiResp(kpi)], nodes: { 'Build Analysis Input': [inputItem], 'Settings to Object': [{ settings }] } });
  check('validate: KPI targets and expected outputs are never flagged as fabricated', out3[0].json.analysis_row.fabrication_flags === '' && out3[0].json.analysis_row.confidence === 'HIGH', out3[0].json.analysis_row.fabrication_flags);
  check('owner alert: parentheses preserved (HTML parse mode)', /(Discovery Call)/.test(out3[0].json.owner_alert.text));
}
{
  const out = runNode(validateSrc, { input: [{ output_text: 'not json at all' }], nodes: { 'Build Analysis Input': [inputItem], 'Settings to Object': [{ settings }] } });
  const r = out[0].json.analysis_row; const a = JSON.parse(r.analysis_json);
  check('validate: unparseable model output still yields an AI_DRAFT row with LOW confidence', r.review_status === 'AI_DRAFT' && r.confidence === 'LOW' && /ручная проверка/.test(a.limitations[0]));
  check('validate: unparseable output summary is INSUFFICIENT marker, never fabricated', a.executive_summary === 'НЕДОСТАТОЧНО ДАННЫХ');
}
{
  const roInput = { ...inputItem, locale: 'ro' };
  const out = runNode(validateSrc, { input: [aiResp({ ...goodPlan, recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', rationale: 'r' } })], nodes: { 'Build Analysis Input': [roInput], 'Settings to Object': [{ settings }] } });
  const r = out[0].json.analysis_row;
  check('validate: RO next-step label is Romanian', /Diagnostic financiar complet/.test(r.next_step_label) && r.locale === 'ro');
  check('owner alert: stays RU for the owner and states client language RO', /Язык клиента: RO/.test(out[0].json.owner_alert.text));
}

// ---------- analysis failed ----------
{
  const out = runNode(read('analysis-failed.js'), { input: [{ error: { message: 'Rate limit reached (429)' } }], nodes: { 'Build Analysis Input': [inputItem] } });
  const r = out[0].json.analysis_row;
  check('failed: ANALYSIS_FAILED row written with error class only', r.review_status === 'ANALYSIS_FAILED' && r.executive_summary === 'ANALYSIS_FAILED: RATE_LIMIT' && r.analysis_json === '');
  check('failed: owner notice carries no prompt or payload', !/ai_user_prompt|projection/.test(out[0].json.owner_text));
}

// ---------- review verdict ----------
const reviewSrc = read('review-verdict.js');
const ledgerRow = { analysis_id: 'XA-1', lead_id: 'L-2', locale: 'ru', review_status: 'AI_DRAFT', review_token: 'a'.repeat(32) };
function review(q, rows) { return runNode(reviewSrc, { input: rows, nodes: { 'Review Webhook': [{ query: q }] } })[0].json; }
{
  const ok = review({ a: 'XA-1', t: 'a'.repeat(32) }, [ledgerRow]);
  check('review: correct token promotes to CLIENT_READY', ok.verdict === 'PROMOTE' && ok.update_row.review_status === 'CLIENT_READY' && ok.http_status === 200);
  check('review: pipeline projection updated on promote', ok.pipeline_row.xray_analysis_status === 'CLIENT_READY' && ok.pipeline_row.lead_id === 'L-2');
  const bad = review({ a: 'XA-1', t: 'b'.repeat(32) }, [ledgerRow]);
  check('review: wrong token denied (403), nothing written', bad.verdict === 'DENIED' && bad.update_row === null && bad.http_status === 403);
  const short = review({ a: 'XA-1', t: 'a' }, [ledgerRow]);
  check('review: prefix of the token denied', short.verdict === 'DENIED');
  const missing = review({ a: 'XA-9', t: 'a'.repeat(32) }, []);
  check('review: unknown analysis denied', missing.verdict === 'DENIED');
  const again = review({ a: 'XA-1', t: 'a'.repeat(32) }, [{ ...ledgerRow, review_status: 'CLIENT_READY' }]);
  check('review: second tap is idempotent (ALREADY_READY, no write)', again.verdict === 'ALREADY_READY' && again.update_row === null && again.http_status === 200);
  const failedRow = review({ a: 'XA-1', t: 'a'.repeat(32) }, [{ ...ledgerRow, review_status: 'ANALYSIS_FAILED' }]);
  check('review: a failed analysis can never be promoted', failedRow.verdict === 'DENIED');
  check('review: response is HTML without technical labels for denied', /Доступ отклонён/.test(bad.html) && !/AI_DRAFT/.test(bad.html));
}

// ---------- labels ----------
{
  const L = runNode(labelsSrc + '\nreturn { XRAY_LABELS, xrayZoneLabel };', {});
  check('labels: RU zone lines match the standard', L.xrayZoneLabel('ru', 'ORANGE').line === 'Существенные пробелы в финансовом управлении');
  check('labels: RO zone lines exist for all zones', ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN'].every(z => L.XRAY_LABELS.ro.zone[z] && L.XRAY_LABELS.ro.zone[z].line));
  check('labels: unknown locale defaults to RU', L.xrayZoneLabel('en', 'RED').name === 'КРАСНАЯ ЗОНА');
}

console.log(`\nxray-analysis: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
