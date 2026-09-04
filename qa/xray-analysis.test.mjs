// FINMENTOR — X-Ray Analysis engine gates (C1, corrected in C3).
//
// Runs the n8n Code-node bodies under n8n/src/xray-analysis/ in a minimal sandbox that
// emulates $input / $('Node') / require('crypto'), so the contract can be proven offline:
//   * PII never reaches the prompt, even when pasted into free text          (SIMULATED)
//   * score and zone are copied from deterministic input, never from the model (SIMULATED)
//   * a broken model contract is ANALYSIS_FAILED, never a draft                (SIMULATED)
//   * within a valid contract the output is capped and normalised              (SIMULATED)
//   * fabricated figures are flagged and lower confidence                      (SIMULATED)
//   * the review GET is read-only; only the POST promotes, with a bounded per-row token,
//     constant-time, idempotent, and it publishes ONLY a curated customer result (SIMULATED)
//   * pending selection is fail-closed and consent-gated                       (SIMULATED)
//   * the built workflow wires exactly that and nothing wider                  (STATIC)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { sdk, CLIENT_RESULT_TABLE, REVIEW_PATH } from '../scripts/build-xray-analysis-workflow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'n8n', 'src', 'xray-analysis');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const labelsSrc = read('labels.js').replace(/if \(typeof module[\s\S]*$/, '');
// The owner cards, spliced exactly as the builder splices them (presentation only).
const cardsSrc = read('owner-cards.js').replace(/if \(typeof module[\s\S]*$/, '');
const withCards = (src) => src.replace('// __XRAY_OWNER_CARDS__ (inlined by the builder)', cardsSrc);

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
    return { all: () => items, first: () => items[0], item: items[0], isExecuted: true };
  };
  const req = (m) => { if (m === 'crypto') return crypto; throw new Error('require blocked: ' + m); };
  const fn = new Function('$input', '$', 'require', 'Buffer', body);
  return fn($input, $, req, Buffer);
}

const settings = { owner_chat_id: '1', xray_analysis_enabled: true, xray_ai_model: 'gpt-4.1', xray_analysis_since: '2026-09-01T00:00:00.000Z', xray_max_per_run: 3, xray_review_base_url: 'https://n8n.test/webhook/finmentor-xray-review', crm_url: 'https://crm.test' };

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
  const failedLedger = runNode(read('select-pending.js'), { input: [{ lead_id: 'L-1', review_status: 'ANALYSIS_FAILED' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('pending: an ANALYSIS_FAILED row stops the sweep from looping on the lead', !failedLedger.map(i => i.json.lead_id).includes('L-1'));
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
const pipeRu = { lead_id: 'L-2', request_id: 'req-1', company: 'ООО Пример', financial_zone: 'ORANGE', priority: 'HOT', business_model: 'Retail', industry_category: 'Retail', turnover_range: '€1–2M', employees_range: '10–50', main_pain: 'Кассовые разрывы', selected_problems: 'a, b', selected_goals: 'c', documents_status: 'partial', selected_documents: 'bank', work_interest: 'cfo', critical_flags: '', source_page: 'https://www.finmentor.md/questionnaire.html', created_at: '2026-09-02T11:00:00Z' };
const leadRowRu = { 'Lead ID': 'L-2', 'Raw JSON': JSON.stringify(rawRu), 'Diagnostic Score': '47', 'Language': 'Русский', 'Page URL': 'https://www.finmentor.md/questionnaire.html', 'Tool': 'xray_extended', 'Data Quality Hint': 'ok' };

let inputItem;
{
  const out = runNode(read('build-input.js'), { input: [leadRowRu], nodes: { 'Select Pending Leads': [pipeRu], 'Settings to Object': [{ settings }] } });
  check('input: one item per pending lead', out.length === 1);
  inputItem = out[0].json;
  check('input: locale RU detected', inputItem.locale === 'ru');
  check('input: deterministic score carried (47)', inputItem.score === 47);
  check('input: deterministic zone carried from Pipeline (ORANGE)', inputItem.zone === 'ORANGE');
  check('input: analysis version xray-v2 stamped', inputItem.analysis_version === 'xray-v2');
  const prompt = inputItem.ai_user_prompt + inputItem.ai_system_prompt;
  check('input: no email in prompt', !/ivan@example\.com/.test(prompt));
  check('input: no phone in prompt', !/69 123 456/.test(prompt));
  check('input: no handle in prompt', !/@ivanp/.test(prompt));
  check('input: no person/company name in prompt', !/Иван Петров|ООО Пример/.test(prompt));
  check('input: no ga_client_id / request_id / url in prompt', !/GA1\.2\.3|req-1|finmentor\.md/.test(prompt));
  check('input: turnover statement from free text survives scrubbing (business fact)', /1 200 000 EUR/.test(prompt));
  check('input: the questionnaire content reaches the model (the analysis is not built from codes alone)', /Кассовые разрывы/.test(prompt) && /q_f1/.test(prompt));
  check('input: system prompt forbids changing score/zone (RU)', /Не пересчитывай/.test(inputItem.ai_system_prompt));
  check('input: contract lists plan_30_days weeks', /days_22_30/.test(inputItem.ai_user_prompt));
  check('input: source channel website_xray', inputItem.source_channel === 'website_xray');
}
{
  const rawRo = { ...rawRu, meta: { ...rawRu.meta, site_language: 'ro', page_url: 'https://www.finmentor.md/ro/questionnaire.html' } };
  const out = runNode(read('build-input.js'), { input: [{ ...leadRowRu, 'Lead ID': 'L-4', 'Raw JSON': JSON.stringify(rawRo) }], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-4', source_page: 'https://www.finmentor.md/ro/questionnaire.html' }], 'Settings to Object': [{ settings }] } });
  check('input: RO locale from site_language', out[0].json.locale === 'ro');
  check('input: RO system prompt is Romanian and formal', /dumneavoastră/.test(out[0].json.ai_system_prompt) && /DATE INSUFICIENTE/.test(out[0].json.ai_system_prompt));
  check('input: RO prompt names the RO product, never the retired name', /Test de sănătate financiară/.test(out[0].json.ai_system_prompt) && !/Radiografia Financiară/.test(out[0].json.ai_system_prompt));
}
{
  // Mini App / Concierge lead: no Leads row, no score
  const out = runNode(read('build-input.js'), { input: [], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-5', financial_zone: 'UNKNOWN', source_page: '' }], 'Settings to Object': [{ settings }] } });
  check('input: lead without questionnaire row still analysed', out.length === 1);
  check('input: missing score becomes INSUFFICIENT DATA, not a number', out[0].json.score === null && /INSUFFICIENT DATA/.test(out[0].json.ai_user_prompt));
  check('input: zone UNKNOWN carried', out[0].json.zone === 'UNKNOWN');
  const odd = runNode(read('build-input.js'), { input: [], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-7', financial_zone: 'purple <script>' }], 'Settings to Object': [{ settings }] } });
  check('input: a zone outside the vocabulary is UNKNOWN, never a free string', odd[0].json.zone === 'UNKNOWN' && !/purple/.test(odd[0].json.ai_user_prompt));
}
{
  // Leak guard: a forbidden key that survives sanitisation must skip the lead
  const leaky = { ...pipeRu, lead_id: 'L-6', main_pain: 'call me at ivan@example.com' };
  const out = runNode(read('build-input.js'), { input: [], nodes: { 'Select Pending Leads': [leaky], 'Settings to Object': [{ settings }] } });
  check('input: PII in a Pipeline field is scrubbed, lead still analysed', out.length === 1 && !/ivan@example/.test(out[0].json.ai_user_prompt));
}

// ---------- validate ----------
const act = (a, over) => Object.assign({ action: a, owner_role: 'Собственник', expected_output: 'Результат', control_or_kpi: 'Еженедельно', priority: 'HIGH' }, over || {});
const goodPlan = {
  executive_summary: 'Бизнес имеет кассовые разрывы. Управленческий отчёт о прибылях и убытках (P&L) не ведётся.',
  financial_maturity: { score_1_to_5: 2, label: 'Реактивное управление', rationale: 'Нет P&L.' },
  key_risks: [1, 2, 3, 4, 5, 6, 7].map(i => ({ category: 'cash', title: 'Риск ' + i, evidence: 'из анкеты', potential_impact: 'x', priority: 'high' })),
  data_gaps: [{ missing_information: 'Остатки денег', why_it_matters: 'y', how_to_obtain: 'z' }],
  management_priorities: ['П1', 'П2', 'П3', 'П4'],
  plan_30_days: { days_1_7: [act('Платёжный календарь')], days_8_14: [{ action: 'A' }], days_15_21: [act('Сверка')], days_22_30: [{ action: 'B', priority: 'weird' }] },
  tomorrow_actions: ['a', 'b', 'c', 'd'],
  documents_required: ['Выписки'],
  recommended_next_step: { product: 'SOMETHING_ELSE', rationale: 'r' },
  confidence: 'HIGH',
  limitations: [],
  score: 99, zone: 'GREEN', extra_key: 'dropped'
};
function aiResp(obj) { return { output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n' + JSON.stringify(obj) + '\n```' }] }] }; }
const validateSrc = withCards(read('validate-analysis.js').replace('// __XRAY_LABELS__ (inlined by the builder)', labelsSrc));
const validate = (resp, inp) => runNode(validateSrc, { input: [resp], nodes: { 'Build Analysis Input': [inp || inputItem], 'Settings to Object': [{ settings }] } })[0].json;
let draftRow;
{
  const o = validate(aiResp(goodPlan));
  const r = o.analysis_row; const a = JSON.parse(r.analysis_json);
  draftRow = r;
  check('validate: a valid contract is AI_DRAFT and is_valid', o.is_valid === true && r.review_status === 'AI_DRAFT' && r.validation_errors === '');
  check('validate: score is deterministic (47), model value 99 ignored', r.score === 47);
  check('validate: zone is deterministic (ORANGE), model value GREEN ignored', r.zone === 'ORANGE' && !('score' in a) && !('zone' in a) && !('extra_key' in a));
  check('validate: key_risks capped at 5', a.key_risks.length === 5);
  check('validate: management_priorities capped at 3', a.management_priorities.length === 3);
  check('validate: tomorrow_actions capped at 3', a.tomorrow_actions.length === 3);
  check('validate: unknown product falls back to DISCOVERY_CALL', a.recommended_next_step.product === 'DISCOVERY_CALL' && /Discovery Call/.test(r.next_step_label));
  check('validate: priority normalised (high -> HIGH, weird -> MEDIUM)', a.key_risks[0].priority === 'HIGH' && a.plan_30_days.days_22_30[0].priority === 'MEDIUM');
  check('validate: review token is 32 random bytes (64 hex) and bounded in time', /^[0-9a-f]{64}$/.test(r.review_token) && Date.parse(r.review_token_expires_at) > Date.now() + 20 * 24 * 3600 * 1000);
  check('validate: analysis version xray-v2 on the row', r.analysis_version === 'xray-v2');
  check('validate: maturity 2 carried', r.maturity_score === 2 && o.pipeline_row.xray_maturity === 2);
  check('validate: no fabrication flags on clean plan', r.fabrication_flags === '' && r.confidence === 'HIGH');
  check('validate: pipeline projection is narrow (no JSON)', !('analysis_json' in o.pipeline_row) && o.pipeline_row.xray_analysis_status === 'AI_DRAFT');
  const alert = o.owner_alert;
  check('owner alert: premium RU card (2026-09-04) — header, score/100, zone wording, maturity /5, status', /^📊 <b>FINMENTOR · Финансовый рентген<\/b>/.test(alert.text) && /<b>47 \/ 100<\/b> · 🟠 <b>Существенные пробелы<\/b>/.test(alert.text) && /<b>Зрелость финансового управления:<\/b> 2\/5/.test(alert.text) && /<b>Статус:<\/b> ожидает проверки консультанта/.test(alert.text));
  check('owner alert: no raw JSON exposed', !/\{"/.test(alert.text));
  check('owner alert: no Lead ID, no raw enum, no confidence, no token in the visible body', !/Lead ID|L-2|ORANGE|AI_DRAFT|HIGH|Достоверность|[0-9a-f]{64}/.test(alert.text));
  check('owner alert: priorities as ①②③, key risk and RU recommendation present', /① П1\n② П2\n③ П3/.test(alert.text) && /<b>Ключевой риск<\/b>\nРиск 1/.test(alert.text) && /<b>Рекомендация FINMENTOR<\/b>\nДиагностическая встреча \(Discovery Call\)/.test(alert.text));
  check('owner alert: no verification line on a clean HIGH-confidence analysis', !/Требуется проверка/.test(alert.text));
  check('owner alert: review link carries analysis id and token', alert.review_url.includes('a=' + encodeURIComponent(r.analysis_id)) && alert.review_url.includes('t=' + r.review_token));
  const o2 = validate(aiResp(goodPlan));
  check('validate: two analyses of one lead never share an id or a token', o2.analysis_row.analysis_id !== r.analysis_id && o2.analysis_row.review_token !== r.review_token);
}
{
  const fab = { ...goodPlan, executive_summary: 'Выручка компании составляет 3 500 000 EUR, маржа 12%.', key_risks: [{ title: 'Долг 850 000 MDL', category: 'debt', evidence: 'x', potential_impact: 'y', priority: 'HIGH' }] };
  const o = validate(aiResp(fab));
  const r = o.analysis_row;
  check('validate: fabricated figures FLAGGED (not failed) — the owner decides', o.is_valid === true && r.review_status === 'AI_DRAFT' && r.fabrication_flags.length > 0, r.fabrication_flags);
  check('validate: fabricated figures force confidence LOW', r.confidence === 'LOW');
  check('validate: owner told to verify source data — ONE professional line, never the raw flag', /⚠️ <b>Требуется проверка исходных данных<\/b>/.test(o.owner_alert.text) && !/Проверить цифры|3500000|850000/.test(o.owner_alert.text));
  const clean = { ...goodPlan, executive_summary: 'Указанный оборот 1 200 000 EUR требует контроля.' };
  check('validate: figure present in input is not flagged', validate(aiResp(clean)).analysis_row.fabrication_flags === '');
  const kpi = { ...goodPlan, plan_30_days: { ...goodPlan.plan_30_days, days_15_21: [{ action: 'Маржа по категориям', owner_role: 'Аналитик', expected_output: 'Отчёт по 12 000 SKU', control_or_kpi: 'Маржа посчитана для >80% продаж', priority: 'MEDIUM' }] } };
  const o3 = validate(aiResp(kpi));
  check('validate: KPI targets and expected outputs are never flagged as fabricated (live RO finding)', o3.analysis_row.fabrication_flags === '' && o3.analysis_row.confidence === 'HIGH', o3.analysis_row.fabrication_flags);
  check('owner alert: parentheses preserved (HTML parse mode)', /\(Discovery Call\)/.test(o3.owner_alert.text));
}
{
  // FAIL CLOSED: a broken contract is ANALYSIS_FAILED, never a draft
  const cases = [
    ['not JSON', { output_text: 'not json at all' }],
    ['a JSON array', { output_text: '[1,2]' }],
    ['missing key_risks', aiResp((() => { const x = structuredClone(goodPlan); delete x.key_risks; return x; })())],
    ['missing plan_30_days', aiResp((() => { const x = structuredClone(goodPlan); delete x.plan_30_days; return x; })())],
    ['missing executive_summary', aiResp({ ...goodPlan, executive_summary: '   ' })],
    ['an empty week', aiResp({ ...goodPlan, plan_30_days: { ...goodPlan.plan_30_days, days_15_21: [] } })],
    ['a missing week', aiResp((() => { const x = structuredClone(goodPlan); delete x.plan_30_days.days_22_30; return x; })())],
    ['no usable risk', aiResp({ ...goodPlan, key_risks: [{ category: 'x' }] })],
    ['maturity out of range', aiResp({ ...goodPlan, financial_maturity: { score_1_to_5: 9, label: 'x', rationale: 'y' } })],
    ['recommended_next_step not an object', aiResp({ ...goodPlan, recommended_next_step: 'FINANCIAL_HEALTH_CHECK' })]
  ];
  for (const [name, resp] of cases) {
    const o = validate(resp);
    const r = o.analysis_row;
    check('validate FAIL CLOSED: ' + name + ' -> ANALYSIS_FAILED, no token, no draft JSON, pipeline says FAILED',
      o.is_valid === false && r.review_status === 'ANALYSIS_FAILED' && r.review_token === '' && r.review_token_expires_at === '' && r.analysis_json === '' && r.validation_errors !== '' && o.pipeline_row.xray_analysis_status === 'ANALYSIS_FAILED' && o.owner_alert === null && /^❌ <b>FINMENTOR · Анализ не сформирован<\/b>/.test(o.owner_text) && /Удалить строку этого анализа/.test(o.owner_text),
      JSON.stringify({ v: o.is_valid, s: r.review_status, e: r.validation_errors }));
  }
  check('validate FAIL CLOSED: the failed row still carries the deterministic score and zone', validate({ output_text: 'x' }).analysis_row.score === 47 && validate({ output_text: 'x' }).analysis_row.zone === 'ORANGE');
  check('validate FAIL CLOSED: the failure notice names no prompt, payload, token, Lead ID or raw error class', !/ai_user_prompt|projection|review_token|Lead ID|L-2|MODEL_OUTPUT_INVALID|not json/.test(validate({ output_text: 'x' }).owner_text) && /Модель вернула ответ вне контракта анализа/.test(validate({ output_text: 'x' }).owner_text));
}
{
  const roInput = { ...inputItem, locale: 'ro' };
  const o = validate(aiResp({ ...goodPlan, recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', rationale: 'r' } }), roInput);
  check('validate: RO next-step label is Romanian', /Diagnostic financiar complet/.test(o.analysis_row.next_step_label) && o.analysis_row.locale === 'ro');
  check('owner alert: stays RU for the owner and states client language as metadata only', /Клиент: RO/.test(o.owner_alert.text) && !/Diagnostic financiar/.test(o.owner_alert.text) && /Комплексная финансовая диагностика/.test(o.owner_alert.text));
}

// ---------- analysis failed (OpenAI error output) ----------
{
  const out = runNode(withCards(read('analysis-failed.js')), { input: [{ error: { message: 'Rate limit reached (429)' } }], nodes: { 'Build Analysis Input': [inputItem] } });
  const r = out[0].json.analysis_row;
  check('failed: ANALYSIS_FAILED row written with error class only', r.review_status === 'ANALYSIS_FAILED' && r.executive_summary === 'ANALYSIS_FAILED: RATE_LIMIT' && r.analysis_json === '' && r.validation_errors === 'UPSTREAM_RATE_LIMIT');
  check('failed: no token, no expiry, version xray-v2', r.review_token === '' && r.review_token_expires_at === '' && r.analysis_version === 'xray-v2');
  check('failed: owner notice carries no prompt, payload, Lead ID or raw class, names the cause in Russian and says how to retry', !/ai_user_prompt|projection|Lead ID|L-2|RATE_LIMIT/.test(out[0].json.owner_text) && /Превышен лимит запросов к модели/.test(out[0].json.owner_text) && /Удалить строку этого анализа/.test(out[0].json.owner_text));
}

// ---------- review: GET is read-only ----------
const surfaceSrc = read('review-surface.js');
const TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();
const ledgerRow = { ...draftRow, analysis_id: 'XA-1', lead_id: 'L-2', locale: 'ru', review_status: 'AI_DRAFT', review_token: TOKEN, review_token_expires_at: FUTURE, reviewed_at: '' };
function surface(q, rows) { return runNode(surfaceSrc, { input: rows, nodes: { 'Review GET Webhook': [{ query: q }] } })[0].json; }
{
  const before = JSON.stringify(ledgerRow);
  const page = surface({ a: 'XA-1', t: TOKEN }, [ledgerRow]);
  check('review GET: renders the draft and a POST confirmation form (200)', page.http_status === 200 && /method="post"/.test(page.html) && /name="t"/.test(page.html) && /Ключевые риски/.test(page.html));
  check('review GET: mutates nothing and emits no update row', JSON.stringify(ledgerRow) === before && !('update_row' in page) && !('pipeline_row' in page));
  check('review GET: the page never states CLIENT_READY for a draft', !/CLIENT_READY/.test(page.html));
  check('review GET: wrong token 403', surface({ a: 'XA-1', t: 'b'.repeat(64) }, [ledgerRow]).http_status === 403);
  check('review GET: token prefix 403', surface({ a: 'XA-1', t: TOKEN.slice(0, 40) }, [ledgerRow]).http_status === 403);
  check('review GET: expired token 403', surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_token_expires_at: PAST }]).http_status === 403);
  check('review GET: a row with no expiry (pre-v2) is refused, not trusted', surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_token_expires_at: '' }]).http_status === 403);
  check('review GET: unknown analysis 403', surface({ a: 'XA-9', t: TOKEN }, [{}]).http_status === 403);
  check('review GET: a failed analysis is not rendered', surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'ANALYSIS_FAILED' }]).http_status === 403);
  check('review GET: already CLIENT_READY shows "already", no form', (() => { const p = surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'CLIENT_READY' }]); return p.http_status === 200 && /Уже готово/.test(p.html) && !/method="post"/.test(p.html); })());
  check('review GET: an unreadable store is 503, not 403', surface({ a: 'XA-1', t: TOKEN }, [{ error: 'store down' }]).http_status === 503);
  check('review GET: HTML escapes the draft content', /&lt;script&gt;/.test(surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, analysis_json: JSON.stringify({ ...JSON.parse(ledgerRow.analysis_json), executive_summary: '<script>x</script>' }) }]).html));
}

// ---------- review: POST promotes ----------
const reviewSrc = withCards(read('review-verdict.js'));
function review(body, rows) { return runNode(reviewSrc, { input: rows, nodes: { 'Review POST Webhook': [{ body }] } })[0].json; }
{
  const ok = review({ a: 'XA-1', t: TOKEN }, [ledgerRow]);
  check('review POST: correct token promotes to CLIENT_READY', ok.verdict === 'PROMOTE' && ok.proceed_update === true && ok.update_row.review_status === 'CLIENT_READY' && ok.http_status === 200);
  check('review POST: pipeline projection updated on promote', ok.pipeline_row.xray_analysis_status === 'CLIENT_READY' && ok.pipeline_row.lead_id === 'L-2');
  check('review POST: the source row travels to the publisher only on promotion', ok.source_row && ok.source_row.analysis_id === 'XA-1');
  const bad = review({ a: 'XA-1', t: 'b'.repeat(64) }, [ledgerRow]);
  check('review POST: wrong token denied (403), nothing written', bad.verdict === 'DENIED' && bad.proceed_update === false && bad.update_row === null && bad.source_row === null && bad.http_status === 403);
  check('review POST: prefix of the token denied', review({ a: 'XA-1', t: TOKEN.slice(0, 40) }, [ledgerRow]).verdict === 'DENIED');
  check('review POST: expired token denied', review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_token_expires_at: PAST }]).verdict === 'DENIED');
  check('review POST: a row with no expiry is denied', review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_token_expires_at: '' }]).verdict === 'DENIED');
  check('review POST: unknown analysis denied', review({ a: 'XA-9', t: TOKEN }, []).verdict === 'DENIED');
  check('review POST: query-string parameters are ignored (no body -> denied)', runNode(reviewSrc, { input: [ledgerRow], nodes: { 'Review POST Webhook': [{ query: { a: 'XA-1', t: TOKEN } }] } })[0].json.verdict === 'DENIED');
  const again = review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'CLIENT_READY', reviewed_at: '2026-09-03T10:00:00.000Z' }]);
  check('review POST: second confirmation is idempotent (ALREADY_READY, original reviewed_at kept, publication repaired)', again.verdict === 'ALREADY_READY' && again.proceed_update === true && again.update_row.reviewed_at === '2026-09-03T10:00:00.000Z' && again.http_status === 200);
  check('review POST: a failed analysis can never be promoted', review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'ANALYSIS_FAILED' }]).verdict === 'DENIED');
  const down = review({ a: 'XA-1', t: TOKEN }, [{ error: 'store down' }]);
  check('review POST: an unreadable store is STORE_UNAVAILABLE 503, never a promotion', down.verdict === 'STORE_UNAVAILABLE' && down.http_status === 503 && down.proceed_update === false);
  check('review POST: response is HTML without technical labels for denied', /Доступ отклонён/.test(bad.html) && !/AI_DRAFT/.test(bad.html));
}

// ---------- the curated customer result ----------
const clientSrc = read('build-client-result.js');
const publish = (verdict) => runNode(clientSrc, { nodes: { 'Review POST Verdict': [verdict] } });
{
  const ok = review({ a: 'XA-1', t: TOKEN }, [ledgerRow]);
  const rows = publish(ok);
  check('client result: exactly one row on promotion', rows.length === 1);
  const row = rows[0].json;
  check('client result: the row is exactly the live XRay_Client_Results columns', Object.keys(row).sort().join(',') === 'analysis_id,lead_id,locale,published_at,result_json,review_status,score,zone');
  check('client result: keyed by lead, CLIENT_READY, deterministic score and zone', row.lead_id === 'L-2' && row.review_status === 'CLIENT_READY' && row.score === '47' && row.zone === 'ORANGE');
  const result = JSON.parse(row.result_json);
  check('client result: RU product name', result.labels.product === 'Финансовый рентген бизнеса');
  check('client result: carries condition/score, risk zone, maturity, key risks, priorities, 30-day plan, next action, recommendation',
    result.score === 47 && result.zone === 'ORANGE' && result.zone_label && result.maturity && result.maturity.score_1_to_5 === 2 && result.key_risks.length === 5 && result.management_priorities.length === 3 && Object.keys(result.plan_30_days).length === 4 && result.tomorrow_actions.length === 3 && result.recommended_next_step && result.recommended_next_step.label && result.summary);
  const text = row.result_json;
  for (const k of ['review_token', 'request_id', 'lead_id', 'analysis_id', 'model', 'confidence', 'fabrication', 'prompt', 'raw', 'notes', 'AI_DRAFT', 'ANALYSIS_FAILED', 'validation_errors', 'source_channel', TOKEN]) {
    check('client result: never exposes ' + k, !text.includes(k));
  }
  const ro = publish(review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, locale: 'ro' }]));
  check('client result: RO product name, never the retired one', JSON.parse(ro[0].json.result_json).labels.product === 'Test de sănătate financiară FINMENTOR' && !JSON.stringify(ro).includes('Radiografia Financiară'));
  check('client result: nothing is published for a denied verdict', publish(review({ a: 'XA-1', t: 'b'.repeat(64) }, [ledgerRow])).length === 0);
  check('client result: nothing is published for a failed analysis even if forced', publish({ proceed_update: true, source_row: { ...ledgerRow, review_status: 'ANALYSIS_FAILED' } }).length === 0);
  check('client result: nothing is published for a row without a lead', publish({ proceed_update: true, source_row: { ...ledgerRow, lead_id: '' } }).length === 0);
  check('client result: unparseable analysis JSON publishes nothing', publish({ proceed_update: true, source_row: { ...ledgerRow, analysis_json: '{oops' } }).length === 0);
  check('client result: ALREADY_READY re-publishes (idempotent repair)', publish(review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'CLIENT_READY' }])).length === 1);
}

// ---------- the built workflow (STATIC) ----------
{
  const getChain = sdk.slice(sdk.indexOf('.add(reviewGetWebhook)'), sdk.indexOf('.add(reviewPostWebhook)'));
  const postChain = sdk.slice(sdk.indexOf('.add(reviewPostWebhook)'));
  check('workflow: GET and POST review triggers share the path', /name: 'Review GET Webhook', parameters: \{ httpMethod: 'GET', path: "finmentor-xray-review"/.test(sdk) && /name: 'Review POST Webhook', parameters: \{ httpMethod: 'POST', path: "finmentor-xray-review"/.test(sdk) && REVIEW_PATH === 'finmentor-xray-review');
  check('workflow: the GET chain reads, renders and responds — it reaches no writer', /readForReviewGet/.test(getChain) && /reviewSurface/.test(getChain) && !/promote|publish|updatePipeline|ifPromote/i.test(getChain));
  check('workflow: the POST chain promotes, projects, publishes the curated result, responds, THEN notifies the owner on the first promotion only', /reviewVerdict/.test(postChain) && /ifPromote/.test(postChain) && /promoteAnalysis\.to\(pipelineStatusRow\.to\(updatePipelineStatus\.to\(buildClientResult\.to\(publishClientResult\.to\(respondPromoted\.to\(ifFirstPromotion\.onTrue\(ownerApprovedNotice\)\)/.test(postChain));
  check('workflow: the approved notice is gated on notify_owner, reads owner_approved_text, same owner chat and bot credential, and sits AFTER the HTTP response', /name: 'IF First Promotion'[\s\S]*?notify_owner/.test(sdk) && /name: 'Telegram Analysis Approved'[\s\S]*?owner_chat_id[\s\S]*?owner_approved_text[\s\S]*?parse_mode: 'HTML'[\s\S]*?telegramApi: \{ id: 'Mj41qrGHfrthCtAw'/.test(sdk) && postChain.indexOf('respondPromoted') < postChain.indexOf('ownerApprovedNotice'));
  check('workflow: the GET chain still reaches no Telegram node', !/ownerApprovedNotice|ownerAlert/.test(getChain));
  check('workflow: the publisher is a credential-free Data Table upsert on ' + CLIENT_RESULT_TABLE + ' keyed by lead_id', /name: 'Publish Curated Client Result'[\s\S]*?operation: 'upsert', dataTableId: \{ __rl: true, mode: 'name', value: "XRay_Client_Results" \}[\s\S]*?keyName: 'lead_id'/.test(sdk) && !/Publish Curated Client Result[\s\S]{0,600}credentials/.test(sdk));
  check('workflow: the sweep forks on validity — owner alert for a draft, failure notice otherwise', /\.to\(ifAnalysisValid\s+\.onTrue\(ownerAlert\)\s+\.onFalse\(validationFailureNotice\)\)/.test(sdk));
  check('workflow: no Postgres, no claim table, no new credential', !/n8n-nodes-base\.postgres/.test(sdk) && !/finmentor_xray_analysis_claims/.test(sdk) && (sdk.match(/credentials: \{ (googleSheetsOAuth2Api|telegramApi|openAiApi)/g) || []).every(Boolean) && !/postgres:/.test(sdk));
  check('workflow: the failure path still records ANALYSIS_FAILED and notifies', /aiAnalysis\s+\.onError\(failedRowBuild\.to\(failedRow\.to\(saveFailed\.to\(ownerFailureNotice\)\)\)\)/.test(sdk));
  check('workflow: every HTML responder is no-store, noindex, no-referrer', (sdk.match(/text\/html; charset=utf-8/g) || []).length === 3 && (sdk.match(/Referrer-Policy/g) || []).length === 3);
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
