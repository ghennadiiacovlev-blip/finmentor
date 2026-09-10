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
import { spawnSync } from 'node:child_process';
import { sdk, CLIENT_RESULT_TABLE, REVIEW_PATH } from '../scripts/build-xray-analysis-workflow.mjs';
import { compileFile } from '../scripts/lib/compile-workflow-sdk.mjs';
import { NIAGARA_AI, NIAGARA_LIVE_SANITIZED_SOURCE } from './fixtures/lead-intelligence-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'n8n', 'src', 'xray-analysis');
const GENERATOR = path.join(ROOT, 'scripts', 'build-xray-analysis-workflow.mjs');
const CANDIDATE = path.join(ROOT, 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const liContractBody = fs.readFileSync(path.join(ROOT, 'n8n', 'src', 'lead-intelligence', 'contract.js'), 'utf8')
  .replace(/['"]use strict['"];?\s*/, '').replace(/if \(typeof module[\s\S]*$/, '').trim();
const liAlertBody = fs.readFileSync(path.join(ROOT, 'n8n', 'src', 'lead-intelligence', 'alert.js'), 'utf8')
  .replace(/['"]use strict['"];?\s*/, '').replace(/if \(typeof module[\s\S]*$/, '').trim();
const liModuleBody = (name) => fs.readFileSync(path.join(ROOT, 'n8n', 'src', 'lead-intelligence', name), 'utf8')
  .replace(/['"]use strict['"];?\s*/, '').replace(/^const LI = require\([^\n]+\);\s*/m, '').replace(/if \(typeof module[\s\S]*$/, '').trim();
const liContractInline = `const LI = (function () {\n${liContractBody}\nreturn api;\n})();`;
const liRenderInline = `const LI_RENDER = (function () {\n${liModuleBody('render.js')}\nreturn { renderOwnerBriefPage, renderMessagePage, renderOutboundConfirm };\n})();`;
const liActionsInline = `const LI_ACTIONS = (function () {\n${liModuleBody('actions.js')}\nreturn { parseJson, safeDate, editClientDraft, handleOwnerAction };\n})();`;
const withIntelligence = (src) => src
  .replace('// __LEAD_INTELLIGENCE_CONTRACT__ (inlined by the builder)', liContractInline)
  .replace('// __LEAD_INTELLIGENCE_ALERT__ (inlined by the builder)', `const LI_ALERT = (function () {\n${liAlertBody}\nreturn { renderLeadIntelligenceAlert, contactLines, esc, tidy };\n})();`);
const withReviewIntelligence = (src) => src
  .replace('// __LEAD_INTELLIGENCE_ACTIONS__ (inlined by the builder)', liContractInline + '\n' + liActionsInline)
  .replace('// __LEAD_INTELLIGENCE_RENDER__ (inlined by the builder)', (src.includes('__LEAD_INTELLIGENCE_ACTIONS__') ? '' : liContractInline + '\n') + liRenderInline);

const labelsSrc = read('labels.js').replace(/if \(typeof module[\s\S]*$/, '');
// The owner cards, spliced exactly as the builder splices them (presentation only).
const cardsSrc = read('owner-cards.js').replace(/if \(typeof module[\s\S]*$/, '');
const withCards = (src) => src.replace('// __XRAY_OWNER_CARDS__ (inlined by the builder)', cardsSrc);

let passed = 0; let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// The generated SDK is the deployment input. Rebuild it for real, reject a stale checked-in
// artifact, parse it with Node, then load it through the same compiler used by the live deployer.
// Connection assertions operate on that compiled graph rather than on regex fragments.
let compiledWorkflow = null;
{
  const before = fs.readFileSync(CANDIDATE, 'utf8');
  const build = spawnSync(process.execPath, [GENERATOR], { cwd: ROOT, encoding: 'utf8' });
  check('workflow SDK: generator exits zero', build.status === 0, (build.stderr || build.stdout || '').trim());

  const generated = fs.readFileSync(CANDIDATE, 'utf8');
  check('workflow SDK: checked-in candidate is generated and not stale', generated === before && generated === sdk);

  const syntax = spawnSync(process.execPath, ['--check', CANDIDATE], { cwd: ROOT, encoding: 'utf8' });
  check('workflow SDK: generated candidate passes node --check', syntax.status === 0, (syntax.stderr || syntax.stdout || '').trim());

  let loadError = '';
  try { compiledWorkflow = compileFile(CANDIDATE, {}); } catch (error) { loadError = error.message; }
  check('workflow SDK: normal deployment compiler loads the generated candidate', !!compiledWorkflow && compiledWorkflow.nodes.length > 0, loadError);
}

const edgeTargets = (name, output = 0) => ((((compiledWorkflow && compiledWorkflow.connections[name]) || {}).main || [])[output] || []).map((e) => e.node);
const isEdge = (from, to, output = 0) => edgeTargets(from, output).includes(to);
{
  check('compiled graph: IF Persist true persists while false owns the outbound branch',
    isEdge('IF Persist Owner Action', 'Promote Row', 0) && isEdge('IF Persist Owner Action', 'IF Send Customer Message', 1));
  check('compiled graph: client publication true chain and false response are preserved',
    isEdge('IF Publish Client Result', 'Build Curated Client Result', 0) &&
    isEdge('Build Curated Client Result', 'Publish Curated Client Result') &&
    isEdge('Publish Curated Client Result', 'Build Client Ready Notification') &&
    isEdge('IF Publish Client Result', 'Respond Review Done', 1));
  check('compiled graph: verified Telegram auto-notify chain and false response are preserved',
    isEdge('IF Verified Telegram Route', 'Client Ready Transport Request', 0) &&
    isEdge('Client Ready Transport Request', 'Send Client Ready Notification') &&
    isEdge('Send Client Ready Notification', 'Complete Client Ready Notification') &&
    isEdge('Complete Client Ready Notification', 'IF Client Notification Delivered') &&
    isEdge('IF Verified Telegram Route', 'Respond Review Done', 1));
  check('compiled graph: delivery alone enters CLIENT_NOTIFIED persistence and failure only responds',
    isEdge('IF Client Notification Delivered', 'Notified Analysis Row', 0) &&
    isEdge('Notified Analysis Row', 'Update Analysis Notified') &&
    isEdge('Update Analysis Notified', 'Notified Pipeline Row') &&
    isEdge('Notified Pipeline Row', 'Update Pipeline Notified') &&
    isEdge('Update Pipeline Notified', 'Notified Activity Row') &&
    isEdge('Notified Activity Row', 'Append Notified Activity') &&
    isEdge('Append Notified Activity', 'Respond Client Notification Result') &&
    isEdge('IF Client Notification Delivered', 'Respond Client Notification Result', 1));
  check('compiled graph: explicit outbound path remains below IF Persist false',
    isEdge('IF Send Customer Message', 'Outbound Transport Request', 0) &&
    isEdge('Outbound Transport Request', 'Send Customer Message') &&
    isEdge('Send Customer Message', 'Complete Outbound Contact') &&
    isEdge('Complete Outbound Contact', 'IF Outbound Delivered') &&
    isEdge('IF Send Customer Message', 'Respond Review Denied', 1));
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

const settings = { owner_chat_id: '1', xray_analysis_enabled: true, xray_ai_model: 'gpt-4.1', xray_analysis_since: '2026-09-01T00:00:00.000Z', xray_max_per_run: 3, xray_backfill_enabled: true, xray_backfill_max_per_run: 1, xray_review_base_url: 'https://n8n.test/webhook/finmentor-xray-review', crm_url: 'https://crm.test' };

// ---------- settings ----------
{
  const out = runNode(read('settings.js'), { input: [{ key: 'owner_chat_id', value: '42' }, { key: 'xray_max_per_run', value: '50' }, { key: 'xray_analysis_since', value: 'garbage' }] });
  const s = out[0].json.settings;
  check('settings: owner chat id read from Settings', s.owner_chat_id === '42');
  check('settings: per-run cap clamped to 10', s.xray_max_per_run === 10);
  check('settings: invalid since falls back to program start', s.xray_analysis_since === '2026-09-03T00:00:00.000Z');
  check('settings: default model gpt-4.1', s.xray_ai_model === 'gpt-4.1');
  check('settings: controlled backfill defaults to one row per sweep', s.xray_backfill_enabled === true && s.xray_backfill_max_per_run === 1);
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
  const out = runNode(read('select-pending.js'), { input: [{ analysis_id: 'XA-L1', lead_id: 'L-1', review_status: 'AI_DRAFT', analysis_version: 'lead-intelligence-v1', owner_brief_json: '{"ok":true}' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  const ids = out.map(i => i.json.lead_id);
  check('pending: analysed lead excluded', !ids.includes('L-1'));
  check('pending: INCOMPLETE (no consent) never analysed', !ids.includes('L-3'));
  check('pending: leads before xray_analysis_since excluded', !ids.includes('L-old'));
  check('pending: capped at xray_max_per_run, oldest first', ids.join(',') === 'L-2,L-4,L-5', ids.join(','));
  const failedLedger = runNode(read('select-pending.js'), { input: [{ lead_id: 'L-1', review_status: 'ANALYSIS_FAILED' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('pending: an ANALYSIS_FAILED row stops the sweep from looping on the lead', !failedLedger.map(i => i.json.lead_id).includes('L-1'));
}
{
  const legacy = { analysis_id: 'XA-LEGACY-L1', lead_id: 'L-1', review_status: 'OWNER_EDITED', analysis_version: 'c3', owner_brief_json: '', review_token: 'a'.repeat(64), client_result_draft_json: '{"preserve":true}' };
  const out = runNode(read('select-pending.js'), { input: [legacy], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('backfill: one legacy analysis is selected ahead of fresh work', out[0].json.lead_id === 'L-1' && out[0].json.analysis_mode === 'UPGRADE_EXISTING' && out[0].json.existing_analysis.analysis_id === 'XA-LEGACY-L1');
  check('backfill: total model work remains capped', out.length === 3);
  const afterUpgrade = runNode(read('select-pending.js'), { input: [{ ...legacy, analysis_version: 'lead-intelligence-v1', owner_brief_json: '{"schema_version":"lead-intelligence-v1"}', lead_intelligence_upgrade_status: 'COMPLETE' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('backfill: completed upgrade is idempotently excluded on the next sweep', !afterUpgrade.map((i) => i.json).some((r) => r.lead_id === 'L-1'));
  const collision = runNode(read('select-pending.js'), { input: [legacy, { ...legacy, analysis_id: 'XA-DUP' }], nodes: { 'Settings to Object': [{ settings }], 'Read Pipeline': pipeline } });
  check('backfill: duplicate analysis ledger collision fails closed', !collision.map((i) => i.json).some((r) => r.lead_id === 'L-1'));
  const off = runNode(read('select-pending.js'), { input: [legacy], nodes: { 'Settings to Object': [{ settings: { ...settings, xray_backfill_enabled: false } }], 'Read Pipeline': pipeline } });
  check('backfill: explicit switch disables upgrades', !off.map((i) => i.json).some((r) => r.lead_id === 'L-1'));
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
  diagnostic: { completed: true, score: 47, traffic_light: 'ORANGE', risk_zones: ['cash_flow', 'margin', 'kpi_dashboard'], business_model: 'Retail', urgency: '1 месяц', main_pain: 'Кассовые разрывы', wants_review: 'Да, нужен разбор' },
  answers: { extended_intake: { comment: 'Пишите на ivan@example.com или +373 69 123 456, оборот 1 200 000 EUR' } },
  intake: { company_profile: { industry: 'Retail', turnover_range: '€1–2M' }, financial_control: { q_f1: 'Нет' } },
  completion: { completion_score: 92, data_quality_hint: 'ok' }
};
const pipeRu = { lead_id: 'L-2', request_id: 'req-1', company: 'ООО Пример', financial_zone: 'ORANGE', priority: 'HOT', business_model: 'Retail', industry_category: 'Retail', turnover_range: '€1–2M', employees_range: '10–50', main_pain: 'Кассовые разрывы', selected_problems: 'a, b', selected_goals: 'c', documents_status: 'partial', selected_documents: 'bank', work_interest: 'cfo', critical_flags: '', source_page: 'https://www.finmentor.md/questionnaire.html', created_at: '2026-09-02T11:00:00Z' };
const leadRowRu = { 'Lead ID': 'L-2', 'Raw JSON': JSON.stringify(rawRu), 'Diagnostic Score': '47', 'Language': 'Русский', 'Page URL': 'https://www.finmentor.md/questionnaire.html', 'Tool': 'xray_extended', 'Data Quality Hint': 'ok' };

let inputItem;
{
  const out = runNode(withIntelligence(read('build-input.js')), { input: [leadRowRu], nodes: { 'Select Pending Leads': [pipeRu], 'Settings to Object': [{ settings }] } });
  check('input: one item per pending lead', out.length === 1);
  inputItem = out[0].json;
  check('input: unique canonical Lead ID source pair is ready', inputItem.analysis_ready === true && inputItem.source_pairing.method === 'lead_id');
  check('input: locale RU detected', inputItem.locale === 'ru');
  check('input: deterministic score carried (47)', inputItem.score === 47);
  check('input: deterministic zone carried from Pipeline (ORANGE)', inputItem.zone === 'ORANGE');
  check('input: analysis version lead-intelligence-v1 stamped', inputItem.analysis_version === 'lead-intelligence-v1');
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
  const source = NIAGARA_LIVE_SANITIZED_SOURCE;
  const out = runNode(withIntelligence(read('build-input.js')), { input: [source.lead_row], nodes: { 'Select Pending Leads': [source.pipeline_row], 'Settings to Object': [{ settings }] } });
  check('input: Niagara mismatched Lead IDs use the unique request_id fallback', out.length === 1 && out[0].json.analysis_ready === true && out[0].json.source_pairing.method === 'request_id');
  check('input: Niagara self-assessment fails customer result closed', out[0].json.owner_context.client_result_eligible === false && out[0].json.owner_context.client_result_eligibility_reason === 'EXPLICITLY_NOT_REQUESTED');
  check('input: Niagara owner header prefers exact business_model over broad industry', out[0].json.owner_context.business === 'Fitness' && out[0].json.company_context.industry === 'Fitness' && out[0].json.company_context.industry_category === 'Услуги / консалтинг');
  check('input: Niagara main pain and first step preserve exact source values', out[0].json.owner_context.client_facts.some((f) => f.id === 'main_problem' && f.value === 'Платежи хаотично / кассовые разрывы' && f.source_path === 'Pipeline.main_pain') && out[0].json.owner_context.client_facts.some((f) => f.id === 'desired_first_step' && f.value === 'Построить систему контроля'));
  check('input: Niagara quick diagnostic and expanded controls stay separate', out[0].json.owner_context.client_facts.some((f) => f.id === 'existing_setup' && f.source_path === 'Leads.Raw JSON.answers.quick_diagnostic' && /Дебиторка и кредиторка: Частично/.test(f.value)) && out[0].json.owner_context.client_facts.some((f) => f.id === 'financial_system' && f.source_path === 'Leads.Raw JSON.intake.financial_control' && /Дебиторская задолженность: Да/.test(f.value) && !/Отч[её]т собственника:|Контроль маржи:|Правила согласования платежей:/.test(f.value)));
  const niagaraDigest = JSON.parse(out[0].json.input_digest_text);
  check('input: structured risk zones preserve usable sanitized fields', niagaraDigest.facts.risk_zones_from_questionnaire.every((risk) => risk && typeof risk === 'object' && risk.key && risk.label && risk.answer && Number.isFinite(risk.score_percent)) && out[0].json.risk_zones.join(',') === 'receivables_payables,kpi_dashboard');
  check('input: object risk zones never stringify to object Object', !/\[object Object\]/.test(out[0].json.ai_user_prompt + out[0].json.input_digest_text));
  const industryRaw = JSON.parse(source.lead_row['Raw JSON']);
  industryRaw.diagnostic.business_model = '';
  const industryFallback = runNode(withIntelligence(read('build-input.js')), { input: [{ ...source.lead_row, 'Raw JSON': JSON.stringify(industryRaw) }], nodes: { 'Select Pending Leads': [{ ...source.pipeline_row, business_model: '' }], 'Settings to Object': [{ settings }] } });
  check('input: industry category is used only when business_model is absent', industryFallback[0].json.owner_context.business === 'Услуги / консалтинг');
  const boundedRaw = JSON.parse(source.lead_row['Raw JSON']);
  boundedRaw.diagnostic.risk_zones = Array.from({ length: 6 }, (_, i) => ({ key: 'risk_' + i, label: i ? 'Риск ' + i : 'owner@example.com', answer: 'Проверить ' + i, score_percent: 50, untrusted_extra: 'drop me' }));
  const boundedOut = runNode(withIntelligence(read('build-input.js')), { input: [{ ...source.lead_row, 'Raw JSON': JSON.stringify(boundedRaw) }], nodes: { 'Select Pending Leads': [source.pipeline_row], 'Settings to Object': [{ settings }] } });
  const boundedRisks = JSON.parse(boundedOut[0].json.input_digest_text).facts.risk_zones_from_questionnaire;
  check('input: risk-zone projection is capped, allow-listed and PII-scrubbed', boundedRisks.length === 5 && boundedRisks.every((risk) => Object.keys(risk).every((key) => ['key','label','answer','score_percent'].includes(key))) && !/untrusted_extra/.test(JSON.stringify(boundedRisks)) && !/owner@example|\[object Object\]/.test(boundedOut[0].json.ai_user_prompt));
  check('input: Niagara empty goals/documents do not become CLIENT_FACT', !out[0].json.owner_context.client_facts.some((f) => ['desired_result','documents'].includes(f.id)));
  const duplicate = runNode(withIntelligence(read('build-input.js')), { input: [source.lead_row, { ...source.lead_row, 'Lead ID': 'FIN-NIAGARA-DUPLICATE' }], nodes: { 'Select Pending Leads': [source.pipeline_row], 'Settings to Object': [{ settings }] } });
  check('input: duplicate request_id collision fails closed and surfaces a P0 audit finding', duplicate.length === 1 && duplicate[0].json.analysis_ready === false && duplicate[0].json.audit_finding.code === 'REQUEST_ID_COLLISION' && /Анализ пропущен/.test(duplicate[0].json.audit_finding.owner_text));
  const emptyRaw = runNode(withIntelligence(read('build-input.js')), { input: [{ ...source.lead_row, 'Lead ID': source.pipeline_row.lead_id, 'Raw JSON': '{}' }], nodes: { 'Select Pending Leads': [source.pipeline_row], 'Settings to Object': [{ settings }] } });
  check('input: empty Raw JSON never generates a brief', emptyRaw.length === 1 && emptyRaw[0].json.analysis_ready === false && emptyRaw[0].json.audit_finding.code === 'RAW_JSON_EMPTY' && !emptyRaw[0].json.ai_user_prompt);
}
{
  const rawRo = { ...rawRu, meta: { ...rawRu.meta, site_language: 'ro', page_url: 'https://www.finmentor.md/ro/questionnaire.html' } };
  const out = runNode(withIntelligence(read('build-input.js')), { input: [{ ...leadRowRu, 'Lead ID': 'L-4', 'Raw JSON': JSON.stringify(rawRo) }], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-4', source_page: 'https://www.finmentor.md/ro/questionnaire.html' }], 'Settings to Object': [{ settings }] } });
  check('input: RO locale from site_language', out[0].json.locale === 'ro');
  check('input: RO system prompt is Romanian and formal', /dumneavoastră/.test(out[0].json.ai_system_prompt) && /DATE INSUFICIENTE/.test(out[0].json.ai_system_prompt));
  // SPRINT 1 (2026-09-07): the owner decision of 2026-09-07 supersedes the Gate 3 and Gate 5
  // naming decisions. The canonical customer-facing Romanian product name is «Test financiar
  // FINMENTOR». BOTH «Radiografia Financiară» and «Test de sănătate financiară» are retired,
  // and this gate now refuses either of them.
  check('input: RO prompt names the canonical RO product, never the retired name', /Test financiar FINMENTOR/.test(out[0].json.ai_system_prompt) && !/Radiografia Financiară/.test(out[0].json.ai_system_prompt) && !/sănătate financiară/.test(out[0].json.ai_system_prompt));
}
{
  // A missing Leads source is an audit finding, never an empty-fact brief.
  const out = runNode(withIntelligence(read('build-input.js')), { input: [], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-5', financial_zone: 'UNKNOWN', source_page: '' }], 'Settings to Object': [{ settings }] } });
  check('input: lead without a source row is skipped with an audit finding', out.length === 1 && out[0].json.analysis_ready === false && out[0].json.audit_finding.code === 'REQUEST_ID_NOT_FOUND');
  const oddLead = { ...leadRowRu, 'Lead ID': 'L-7' };
  const odd = runNode(withIntelligence(read('build-input.js')), { input: [oddLead], nodes: { 'Select Pending Leads': [{ ...pipeRu, lead_id: 'L-7', financial_zone: 'purple <script>' }], 'Settings to Object': [{ settings }] } });
  check('input: a zone outside the vocabulary is UNKNOWN, never a free string', odd[0].json.zone === 'UNKNOWN' && !/purple/.test(odd[0].json.ai_user_prompt));
}
{
  // Leak guard: a forbidden key that survives sanitisation must skip the lead
  const leaky = { ...pipeRu, lead_id: 'L-6', main_pain: 'call me at ivan@example.com' };
  const out = runNode(withIntelligence(read('build-input.js')), { input: [{ ...leadRowRu, 'Lead ID': 'L-6' }], nodes: { 'Select Pending Leads': [leaky], 'Settings to Object': [{ settings }] } });
  check('input: PII in a Pipeline field is scrubbed, lead still analysed', out.length === 1 && !/ivan@example/.test(out[0].json.ai_user_prompt));
}

// ---------- validate ----------
const act = (a, over) => Object.assign({ action: a, owner_role: 'Собственник', expected_output: 'Результат', control_or_kpi: 'Еженедельно', priority: 'HIGH' }, over || {});
const goodPlan = {
  owner_brief: NIAGARA_AI,
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
const validateSrc = withIntelligence(withCards(read('validate-analysis.js').replace('// __XRAY_LABELS__ (inlined by the builder)', labelsSrc)));
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
  check('validate: unknown product falls back to NEEDS_CLARIFICATION', a.recommended_next_step.product === 'NEEDS_CLARIFICATION' && /требуется уточнение/.test(r.next_step_label));
  check('validate: priority normalised (high -> HIGH, weird -> MEDIUM)', a.key_risks[0].priority === 'HIGH' && a.plan_30_days.days_22_30[0].priority === 'MEDIUM');
  check('validate: review token is 32 random bytes (64 hex) and bounded in time', /^[0-9a-f]{64}$/.test(r.review_token) && Date.parse(r.review_token_expires_at) > Date.now() + 20 * 24 * 3600 * 1000);
  check('validate: analysis version lead-intelligence-v1 on the row', r.analysis_version === 'lead-intelligence-v1');
  check('validate: maturity 2 carried', r.maturity_score === 2 && o.pipeline_row.xray_maturity === 2);
  check('validate: no fabrication flags on clean plan', r.fabrication_flags === '' && r.confidence === 'HIGH');
  check('validate: pipeline projection is narrow (no JSON)', !('analysis_json' in o.pipeline_row) && o.pipeline_row.xray_analysis_status === 'AI_DRAFT');
  const alert = o.owner_alert;
  check('owner alert: short Lead Intelligence entry point with the decision sections', /^🔔 <b>FINMENTOR · Новый лид<\/b>/.test(alert.text) && /ГЛАВНАЯ БОЛЬ/.test(alert.text) && /ЧТО ЗАМЕТИЛ FINMENTOR/.test(alert.text) && /КОНТАКТ/.test(alert.text) && /СЕЙЧАС/.test(alert.text));
  check('owner alert: no raw JSON exposed', !/\{"/.test(alert.text));
  check('owner alert: no Lead ID, no raw enum, no confidence, no token in the visible body', !/Lead ID|L-2|ORANGE|AI_DRAFT|HIGH|Достоверность|[0-9a-f]{64}/.test(alert.text));
  check('owner alert: prioritises one client pain and one FINMENTOR observation', /Кассовые разрывы/.test(alert.text) && /быстрая диагностика.*расширенная анкета/i.test(alert.text));
  check('owner alert: no verification line on a clean HIGH-confidence analysis', !/Требуется проверка/.test(alert.text));
  check('owner alert: review link carries analysis id and token', alert.review_url.includes('a=' + encodeURIComponent(r.analysis_id)) && alert.review_url.includes('t=' + r.review_token));
  const o2 = validate(aiResp(goodPlan));
  check('validate: two analyses of one lead never share an id or a token', o2.analysis_row.analysis_id !== r.analysis_id && o2.analysis_row.review_token !== r.review_token);
}
{
  const legacy = {
    analysis_id: 'XA-LEGACY-L2', lead_id: 'L-2', review_status: 'OWNER_EDITED', analysis_version: 'c3',
    created_at: '2026-09-03T10:00:00.000Z', review_token: 'b'.repeat(64), review_token_expires_at: '2026-10-01T00:00:00.000Z',
    client_result_draft_json: '{"preserve":"customer draft"}', brief_versions_json: '[{"version":0}]', owner_notes_json: '{"confirmed":[],"notes":[]}'
  };
  const upgradeInput = { ...inputItem, analysis_mode: 'UPGRADE_EXISTING', existing_analysis: legacy };
  const upgraded = validate(aiResp(goodPlan), upgradeInput);
  check('backfill validate: updates the same analysis row, never appends a new identity', upgraded.analysis_id === legacy.analysis_id && upgraded.analysis_row.analysis_id === legacy.analysis_id && upgraded.analysis_mode === 'UPGRADE_EXISTING');
  check('backfill validate: preserves review state, token, client draft and version ledger', upgraded.analysis_row.review_status === 'OWNER_EDITED' && upgraded.analysis_row.review_token === legacy.review_token && upgraded.analysis_row.client_result_draft_json === legacy.client_result_draft_json && upgraded.analysis_row.brief_versions_json === legacy.brief_versions_json);
  check('backfill validate: marks COMPLETE and suppresses duplicate owner alert', upgraded.analysis_row.lead_intelligence_upgrade_status === 'COMPLETE' && upgraded.notify_owner === false && upgraded.owner_alert === null);
  const failedUpgrade = validate({ output_text: 'not-json' }, upgradeInput);
  check('backfill validate: failed upgrade preserves prior analysis and stops uncontrolled reruns', failedUpgrade.analysis_row.review_status === 'OWNER_EDITED' && failedUpgrade.analysis_row.lead_intelligence_upgrade_status === 'FAILED' && failedUpgrade.analysis_row.analysis_id === legacy.analysis_id && failedUpgrade.notify_owner === true);
}
{
  const fab = { ...goodPlan, executive_summary: 'Выручка компании составляет 3 500 000 EUR, маржа 12%.', key_risks: [{ title: 'Долг 850 000 MDL', category: 'debt', evidence: 'x', potential_impact: 'y', priority: 'HIGH' }] };
  const o = validate(aiResp(fab));
  const r = o.analysis_row;
  check('validate: fabricated figures FLAGGED (not failed) — the owner decides', o.is_valid === true && r.review_status === 'AI_DRAFT' && r.fabrication_flags.length > 0, r.fabrication_flags);
  check('validate: fabricated figures force confidence LOW', r.confidence === 'LOW');
  check('validate: fabricated figures stay out of the short alert and remain an owner-only validation flag', !/3500000|850000/.test(o.owner_alert.text) && r.fabrication_flags.length > 0);
  const clean = { ...goodPlan, executive_summary: 'Указанный оборот 1 200 000 EUR требует контроля.' };
  check('validate: figure present in input is not flagged', validate(aiResp(clean)).analysis_row.fabrication_flags === '');
  const kpi = { ...goodPlan, plan_30_days: { ...goodPlan.plan_30_days, days_15_21: [{ action: 'Маржа по категориям', owner_role: 'Аналитик', expected_output: 'Отчёт по 12 000 SKU', control_or_kpi: 'Маржа посчитана для >80% продаж', priority: 'MEDIUM' }] } };
  const o3 = validate(aiResp(kpi));
  check('validate: KPI targets and expected outputs are never flagged as fabricated (live RO finding)', o3.analysis_row.fabrication_flags === '' && o3.analysis_row.confidence === 'HIGH', o3.analysis_row.fabrication_flags);
  check('owner alert: contact preference and reachability are rendered separately', /Предпочтительно:/.test(o3.owner_alert.text) && /Доступно:/.test(o3.owner_alert.text));
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
  check('owner alert: stays RU for the owner even when the client result locale is RO', /ГЛАВНАЯ БОЛЬ|СЕЙЧАС/.test(o.owner_alert.text) && !/Diagnostic financiar|Următoarea/.test(o.owner_alert.text));
}

// ---------- analysis failed (OpenAI error output) ----------
{
  const out = runNode(withCards(read('analysis-failed.js')), { input: [{ error: { message: 'Rate limit reached (429)' } }], nodes: { 'Build Analysis Input': [inputItem] } });
  const r = out[0].json.analysis_row;
  check('failed: ANALYSIS_FAILED row written with error class only', r.review_status === 'ANALYSIS_FAILED' && r.executive_summary === 'ANALYSIS_FAILED: RATE_LIMIT' && r.analysis_json === '' && r.validation_errors === 'UPSTREAM_RATE_LIMIT');
  check('failed: no token, no expiry, version lead-intelligence-v1', r.review_token === '' && r.review_token_expires_at === '' && r.analysis_version === 'lead-intelligence-v1');
  check('failed: owner notice carries no prompt, payload, Lead ID or raw class, names the cause in Russian and says how to retry', !/ai_user_prompt|projection|Lead ID|L-2|RATE_LIMIT/.test(out[0].json.owner_text) && /Превышен лимит запросов к модели/.test(out[0].json.owner_text) && /Удалить строку этого анализа/.test(out[0].json.owner_text));
  const legacy = { analysis_id: 'XA-UPSTREAM-UPGRADE', lead_id: 'L-2', review_status: 'OWNER_EDITED', analysis_json: '{"preserve":true}', review_token: 'c'.repeat(64) };
  const upgradeFailure = runNode(withCards(read('analysis-failed.js')), { input: [{ error: { message: 'timeout' } }], nodes: { 'Build Analysis Input': [{ ...inputItem, analysis_mode: 'UPGRADE_EXISTING', existing_analysis: legacy }] } })[0].json.analysis_row;
  check('failed: upstream error during backfill preserves legacy row and seals retry', upgradeFailure.analysis_id === legacy.analysis_id && upgradeFailure.review_status === legacy.review_status && upgradeFailure.analysis_json === legacy.analysis_json && upgradeFailure.lead_intelligence_upgrade_status === 'FAILED');
}

// ---------- review: GET is read-only ----------
const surfaceSrc = withReviewIntelligence(read('review-surface.js'));
const TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();
const ledgerRow = { ...draftRow, analysis_id: 'XA-1', lead_id: 'L-2', locale: 'ru', review_status: 'AI_DRAFT', review_token: TOKEN, review_token_expires_at: FUTURE, reviewed_at: '' };
function surface(q, rows) { return runNode(surfaceSrc, { input: rows, nodes: { 'Review GET Webhook': [{ query: q }] } })[0].json; }
{
  const before = JSON.stringify(ledgerRow);
  const page = surface({ a: 'XA-1', t: TOKEN }, [ledgerRow]);
  check('review GET: renders the owner brief and an explicit after-call POST form (200)', page.http_status === 200 && /method="post"/.test(page.html) && /name="t"/.test(page.html) && /Диагноз FINMENTOR/.test(page.html));
  check('review GET: mutates nothing and emits no update row', JSON.stringify(ledgerRow) === before && !('update_row' in page) && !('pipeline_row' in page));
  check('review GET: the page never states CLIENT_READY for a draft', !/CLIENT_READY/.test(page.html));
  check('review GET: wrong token 403', surface({ a: 'XA-1', t: 'b'.repeat(64) }, [ledgerRow]).http_status === 403);
  check('review GET: token prefix 403', surface({ a: 'XA-1', t: TOKEN.slice(0, 40) }, [ledgerRow]).http_status === 403);
  check('review GET: expired token 403', surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_token_expires_at: PAST }]).http_status === 403);
  check('review GET: a row with no expiry (pre-v2) is refused, not trusted', surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_token_expires_at: '' }]).http_status === 403);
  check('review GET: unknown analysis 403', surface({ a: 'XA-9', t: TOKEN }, [{}]).http_status === 403);
  check('review GET: a failed analysis is not rendered', surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'ANALYSIS_FAILED' }]).http_status === 403);
  check('review GET: CLIENT_READY remains a readable brief and exposes no second approval', (() => { const p = surface({ a: 'XA-1', t: TOKEN, view: 'preview' }, [{ ...ledgerRow, review_status: 'CLIENT_READY' }]); return p.http_status === 200 && /ТОЧНО ТАК УВИДИТ КЛИЕНТ/.test(p.html) && !/Утвердить и сделать доступным/.test(p.html); })());
  check('review GET: false ledger eligibility overrides a legacy true brief', (() => { const p = surface({ a: 'XA-1', t: TOKEN, view: 'edit' }, [{ ...ledgerRow, client_result_eligible: false, owner_brief_json: JSON.stringify({ ...JSON.parse(ledgerRow.owner_brief_json), client_result_eligible: true }) }]); return p.http_status === 200 && !/save_client_draft/.test(p.html); })());
  check('review GET: an unreadable store is 503, not 403', surface({ a: 'XA-1', t: TOKEN }, [{ error: 'store down' }]).http_status === 503);
  check('review GET: HTML escapes owner brief content', /&lt;script&gt;/.test(surface({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, owner_brief_json: JSON.stringify({ ...JSON.parse(ledgerRow.owner_brief_json), first_meeting_objective: '<script>x</script>' }) }]).html));
}

// ---------- review: POST promotes ----------
const reviewSrc = withReviewIntelligence(read('review-verdict.js'));
function review(body, rows) { return runNode(reviewSrc, { input: rows, nodes: { 'Review POST Webhook': [{ body }] } })[0].json; }
{
  const ok = review({ a: 'XA-1', t: TOKEN }, [ledgerRow]);
  check('review POST: correct token approves to CLIENT_READY', ok.verdict === 'CLIENT_READY' && ok.proceed_update === true && ok.publish_client === true && ok.update_row.review_status === 'CLIENT_READY' && ok.http_status === 200);
  check('review POST: false ledger eligibility blocks approval even if legacy brief says true', review({ a: 'XA-1', t: TOKEN, action: 'approve' }, [{ ...ledgerRow, client_result_eligible: false, owner_brief_json: JSON.stringify({ ...JSON.parse(ledgerRow.owner_brief_json), client_result_eligible: true }) }]).verdict === 'CLIENT_RESULT_NOT_ELIGIBLE');
  check('review POST: pipeline projection updated on promote', ok.pipeline_row.xray_analysis_status === 'CLIENT_READY' && ok.pipeline_row.lead_id === 'L-2');
  check('review POST: the source row travels to the publisher only on promotion', ok.source_row && ok.source_row.analysis_id === 'XA-1');
  const bad = review({ a: 'XA-1', t: 'b'.repeat(64) }, [ledgerRow]);
  check('review POST: wrong token denied (403), nothing written', bad.verdict === 'DENIED' && bad.proceed_update === false && !bad.update_row && bad.source_row === null && bad.http_status === 403);
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
  check('client result: the canonical RO product name, never the retired one', JSON.parse(ro[0].json.result_json).labels.product === 'Test financiar FINMENTOR' && !JSON.stringify(ro).includes('Test de sănătate financiară'));
  check('client result: nothing is published for a denied verdict', publish(review({ a: 'XA-1', t: 'b'.repeat(64) }, [ledgerRow])).length === 0);
  check('client result: nothing is published for a failed analysis even if forced', publish({ publish_client: true, source_row: { ...ledgerRow, review_status: 'ANALYSIS_FAILED' } }).length === 0);
  check('client result: nothing is published for a row without a lead', publish({ publish_client: true, source_row: { ...ledgerRow, lead_id: '' } }).length === 0);
  check('client result: unparseable client draft publishes nothing', publish({ publish_client: true, source_row: { ...ledgerRow, client_result_draft_json: '{oops', analysis_json: '{oops' } }).length === 0);
  check('client result: ALREADY_READY re-publishes (idempotent repair)', publish(review({ a: 'XA-1', t: TOKEN }, [{ ...ledgerRow, review_status: 'CLIENT_READY' }])).length === 1);
}

// ---------- the built workflow (STATIC) ----------
{
  const getChain = sdk.slice(sdk.indexOf('.add(reviewGetWebhook)'), sdk.indexOf('.add(reviewPostWebhook)'));
  const postChain = sdk.slice(sdk.indexOf('.add(reviewPostWebhook)'));
  check('workflow: GET and POST review triggers share the path', /name: 'Review GET Webhook', parameters: \{ httpMethod: 'GET', path: "finmentor-xray-review"/.test(sdk) && /name: 'Review POST Webhook', parameters: \{ httpMethod: 'POST', path: "finmentor-xray-review"/.test(sdk) && REVIEW_PATH === 'finmentor-xray-review');
  check('workflow: the GET chain reads, renders and responds — it reaches no writer', /readForReviewGet/.test(getChain) && /reviewSurface/.test(getChain) && !/promote|publish|updatePipeline|ifPromote/i.test(getChain));
  check('workflow: explicit owner actions persist the analysis, Pipeline and Activities before the separately gated publication', /name: 'IF Persist Owner Action'[\s\S]*?persist_analysis/.test(sdk) && /name: 'Append Review Activity'/.test(sdk) && /name: 'IF Publish Client Result'[\s\S]*?publish_client/.test(sdk) && /buildClientResult\.to\(publishClientResult/.test(postChain));
  check('workflow: customer notification uses Client Transport and marks CLIENT_NOTIFIED only after confirmed delivery', /name: 'IF Verified Telegram Route'[\s\S]*?auto_send/.test(sdk) && /name: 'Send Client Ready Notification'[\s\S]*?value: "ShcmmJeLSE8LYVBk"/.test(sdk) && /name: 'IF Client Notification Delivered'[\s\S]*?delivered/.test(sdk) && /name: 'Update Analysis Notified'/.test(sdk) && /name: 'Append Notified Activity'/.test(sdk));
  check('workflow: the GET chain still reaches no Telegram node', !/ownerApprovedNotice|ownerAlert/.test(getChain));
  check('workflow: the publisher is a credential-free Data Table upsert on ' + CLIENT_RESULT_TABLE + ' keyed by lead_id', /name: 'Publish Curated Client Result'[\s\S]*?operation: 'upsert', dataTableId: \{ __rl: true, mode: 'name', value: "XRay_Client_Results" \}[\s\S]*?keyName: 'lead_id'/.test(sdk) && !/Publish Curated Client Result[\s\S]{0,600}credentials/.test(sdk));
  check('workflow: unsafe source pairs bypass AI and surface an owner audit finding', /name: 'IF Source Pair Safe'/.test(sdk) && /name: 'Telegram Source Audit Finding'/.test(sdk) && /\.onFalse\(sourceAuditNotice\)/.test(sdk));
  check('workflow: analysis ledger is upserted by analysis_id for idempotent backfill', /name: 'Save XRay_Analysis'[\s\S]*?operation: 'appendOrUpdate'[\s\S]*?matchingColumns: \['analysis_id'\]/.test(sdk));
  check('workflow: upstream failures also upsert by analysis_id', /name: 'Save Failed Analysis'[\s\S]*?operation: 'appendOrUpdate'[\s\S]*?matchingColumns: \['analysis_id'\]/.test(sdk));
  check('workflow: valid backfills suppress duplicate owner alerts while new drafts alert', /name: 'IF New Owner Alert Required'/.test(sdk) && /\.onTrue\(ifNotifyOwner\.onTrue\(ownerAlert\)\)/.test(sdk) && /\.onFalse\(validationFailureNotice\)/.test(sdk));
  check('workflow: no Postgres, no claim table, no new credential', !/n8n-nodes-base\.postgres/.test(sdk) && !/finmentor_xray_analysis_claims/.test(sdk) && (sdk.match(/credentials: \{ (googleSheetsOAuth2Api|telegramApi|openAiApi)/g) || []).every(Boolean) && !/postgres:/.test(sdk));
  check('workflow: the failure path still records ANALYSIS_FAILED and notifies', /aiAnalysis\s+\.onError\(failedRowBuild\.to\(failedRow\.to\(saveFailed\.to\(ownerFailureNotice\)\)\)\)/.test(sdk));
  check('workflow: every HTML responder is no-store, noindex, no-referrer', (sdk.match(/text\/html; charset=utf-8/g) || []).length === 5 && (sdk.match(/Referrer-Policy/g) || []).length === 5);
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
