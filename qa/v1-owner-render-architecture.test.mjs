#!/usr/bin/env node
// FINMENTOR V1 — owner render architecture runtime gate.
//
// Executes the Code-node bodies from the generated n8n workflow. The OpenAI normalizer itself is
// represented by deterministic model outputs so this remains offline; the compiled graph proves
// that production has one core call and at most two owner-render calls.

import crypto from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../scripts/lib/compile-workflow-sdk.mjs';
import { NIAGARA_AI } from './fixtures/lead-intelligence-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = compileFile(join(ROOT, 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js'), {});
const byName = (name) => workflow.nodes.find((node) => node.name === name);
const code = (name) => {
  const node = byName(name);
  if (!node || !node.parameters || !node.parameters.jsCode) throw new Error('missing generated Code node ' + name);
  return node.parameters.jsCode;
};
const outputs = (name, index = 0) => (((workflow.connections[name] || {}).main || [])[index] || []).map((edge) => edge.node);

let passed = 0; const failures = [];
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('PASS ' + name); }
  else { failures.push(name + (detail ? ': ' + detail : '')); console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function item(value, pairedItem) { return value && value.json ? value : { json: value, ...(pairedItem === undefined ? {} : { pairedItem }) }; }
function run(body, { input = [], nodes = {} } = {}) {
  const inputItems = input.map((value) => item(value));
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error('no node ' + name);
    const values = nodes[name].map((value) => item(value));
    return { all: () => values, first: () => values[0], item: values[0], isExecuted: true };
  };
  const req = (name) => { if (name === 'crypto') return crypto; throw new Error('require blocked: ' + name); };
  return new Function('$input', '$', 'require', 'Buffer', body)($input, $, req, Buffer);
}

const settings = { owner_chat_id: '1', xray_ai_model: 'gpt-4.1', xray_review_base_url: 'https://n8n.test/xray', crm_url: 'https://crm.test' };
const roSource = 'Avem dificultăți cu controlul fluxului de numerar pentru următoarele 30 de zile.';
const clientFacts = [
  { id: 'main_problem', kind: 'CLIENT_FACT', label: 'Основная проблема', value: roSource, source_path: 'Leads.Raw JSON.main_pain' },
  { id: 'existing_setup', kind: 'CLIENT_FACT', label: 'Что уже есть', value: 'Există un registru, dar controlul este parțial.', source_path: 'Leads.Raw JSON.answers' },
  { id: 'financial_system', kind: 'CLIENT_FACT', label: 'Финансовая система', value: 'Rapoartele sunt actualizate lunar.', source_path: 'Leads.Raw JSON.diagnostic' },
  { id: 'capital_context', kind: 'CLIENT_FACT', label: 'Капитал и финансирование', value: 'Sunt planificate investiții în 2026.', source_path: 'Leads.Raw JSON.capital' }
];
const input = {
  analysis_ready: true, analysis_mode: 'NEW_REQUEST_ANALYSIS', existing_analysis: null,
  lead_id: 'FIN-CANONICAL', request_id: 'sub_' + 'b'.repeat(32), locale: 'ro', source_channel: 'telegram_miniapp_premium',
  company: 'Compania Exemplu SRL', crm_row: 9, score: 47, zone: 'ORANGE', analysis_version: 'lead-intelligence-v1',
  ai_model: 'gpt-4.1', input_digest_text: JSON.stringify({ facts: clientFacts }),
  xray_analysis_id: 'XA-PUBLISHED-OLDER', xray_score: 51, xray_maturity: 3, xray_primary_risk: 'Prior risk',
  xray_analysis_status: 'CLIENT_READY', xray_next_step: 'Existing',
  owner_context: {
    company: 'Compania Exemplu SRL', contact_name: 'Alexandru Popescu', role: 'Administrator',
    business: 'Servicii pentru companii', scale: '10–49 angajați', source: 'telegram_miniapp_premium',
    lead_status: 'Qualified', qualification: 'HOT', priority_reason: 'Clientul are nevoie de claritate financiară.',
    data_quality: 'Date complete', commercial_intent_confirmed: true, commercial_intent: 'Diagnostic financiar',
    next_action: 'Programați o întâlnire', next_action_date: '2026-09-20', diagnostic_score: 47, financial_zone: 'ORANGE',
    contact: { preferred_contact_channel: 'telegram', preferred_label: 'Telegram', reachable_channels: [{ key: 'telegram', label: 'Telegram', value: '@client', verified: true }] },
    client_facts: clientFacts, client_locale: 'ro', owner_locale: 'ru', client_result_eligible: true,
    client_result_eligibility_reason: 'explicit_request', history: [{ at: '2026-09-17', label: 'Cerere primită' }]
  }
};

const ro = (value) => value === '' ? '' : 'Descriere profesională în limba română';
const roOwner = structuredClone(NIAGARA_AI);
for (const diagnosis of roOwner.diagnoses) {
  diagnosis.conclusion = ro(diagnosis.conclusion); diagnosis.hypothesis = ro(diagnosis.hypothesis); diagnosis.economic_implication = ro(diagnosis.economic_implication);
}
for (const pain of roOwner.pain_map) {
  pain.area = 'Lichiditate'; pain.attention = 'Prioritate ridicată'; pain.observation = ro(pain.observation); pain.consequence = ro(pain.consequence); pain.economic_category = 'capital circulant';
}
for (const unknown of roOwner.unknowns) { unknown.item = ro(unknown.item); unknown.why = ro(unknown.why); }
roOwner.first_meeting_objective = ro(roOwner.first_meeting_objective);
roOwner.conversation_opening = ro(roOwner.conversation_opening);
for (const question of roOwner.discovery_questions) { question.question = 'Care este cauza problemei?'; question.why = 'Pentru a verifica ipoteza.'; }
roOwner.solution_hypothesis.format = 'Diagnostic financiar'; roOwner.solution_hypothesis.rationale = ro(roOwner.solution_hypothesis.rationale);
roOwner.solution_hypothesis.confirmation_conditions = roOwner.solution_hypothesis.confirmation_conditions.map(ro);
roOwner.solution_hypothesis.if_confirmed = ro(roOwner.solution_hypothesis.if_confirmed); roOwner.solution_hypothesis.do_not_offer_yet = ro(roOwner.solution_hypothesis.do_not_offer_yet);
roOwner.next_action.action = 'Programați o întâlnire.'; roOwner.next_action.purpose = ro(roOwner.next_action.purpose); roOwner.next_action.success_condition = ro(roOwner.next_action.success_condition);
roOwner.owner_fact_translations = clientFacts.map((fact) => ({ id: fact.id, value_ru: fact.value }));

const act = (value) => ({ action: value, owner_role: 'Director financiar', expected_output: 'Rezultat verificat', control_or_kpi: 'Control săptămânal', priority: 'HIGH' });
const corePlan = {
  owner_brief: roOwner,
  executive_summary: 'Compania are nevoie de claritate financiară.',
  financial_maturity: { score_1_to_5: 2, label: 'Management reactiv', rationale: 'Lipsește controlul integrat.' },
  key_risks: [{ category: 'cash', title: 'Risc de lichiditate', evidence: 'Răspunsurile clientului', potential_impact: 'Plăți întârziate', priority: 'HIGH' }],
  data_gaps: [], management_priorities: ['Clarificarea lichidității'],
  plan_30_days: { days_1_7: [act('Verificarea fluxului')], days_8_14: [act('Analiza creanțelor')], days_15_21: [act('Scenarii de numerar')], days_22_30: [act('Reguli de control')] },
  tomorrow_actions: ['Solicitați documentele'], documents_required: ['Extrase bancare'],
  recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', rationale: 'Este necesară o verificare.' }, confidence: 'HIGH', limitations: []
};
const ai = (value) => ({ output_text: JSON.stringify(value) });
const commonNodes = { 'Build Analysis Input': [input], 'Settings to Object': [{ settings }] };

let coreCalls = 0;
coreCalls++;
const routed = run(code('Validate + Store Rows'), { input: [ai(corePlan)], nodes: commonNodes })[0].json;
check('RO core with Romanian owner_brief preserves the valid core and routes presentation only', routed.core_analysis_valid === true && routed.owner_render_required === true && !routed.analysis_row);
check('the core route assigns one stable request_id and analysis_id before normalization', routed.request_id === input.request_id && /^XA-/.test(routed.analysis_id) && routed._owner_render_state.analysis_id === routed.analysis_id);
check('normalizer prompt excludes client identity/contact routes', !routed.owner_render_prompt.includes(input.owner_context.contact_name) && !routed.owner_render_prompt.includes('@client') && !routed.owner_render_prompt.includes(input.lead_id));
check('main X-Ray retry prompt has no owner-render correction', !/MANDATORY RETRY CORRECTION/.test(String(input.ai_user_prompt || '')));

const pathName = (parts) => parts.map((part) => typeof part === 'number' ? '[]' : part).join('.').replaceAll('.[]', '[]');
const allowed = (path) => [
  /^header\.(?:role|business|scale|lead_status|priority_reason|data_quality|commercial_intent|next_action)$/,
  /^owner_fact_translations\[\]\.value_ru$/, /^diagnoses\[\]\.(?:conclusion|hypothesis|economic_implication)$/,
  /^pain_map\[\]\.(?:area|attention|observation|consequence|economic_category)$/,
  /^unknowns\[\]\.(?:item|why)$/, /^(?:first_meeting_objective|conversation_opening)$/,
  /^discovery_questions\[\]\.(?:question|why)$/, /^solution_hypothesis\.(?:format|rationale|if_confirmed|do_not_offer_yet)$/,
  /^solution_hypothesis\.confirmation_conditions\[\]$/, /^next_action\.(?:action|purpose|success_condition)$/,
  /^history\[\]\.label$/
].some((re) => re.test(path));
const numericTokens = (value) => String(value).match(/(?:\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b|\b\d+(?:[\s.,]\d+)*\s?(?:%|€|\$|EUR|USD|MDL|RON|lei|руб\.?|млн|млрд|mii|mil(?:ioane)?)?\b)/gi) || [];
function russianSurface(value, parts = []) {
  if (Array.isArray(value)) return value.map((entry, index) => russianSurface(entry, parts.concat(index)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, russianSurface(entry, parts.concat(key))]));
  if (!allowed(pathName(parts)) || typeof value !== 'string' || value === '') return value;
  return 'Профессиональное русское описание' + (numericTokens(value).length ? ' ' + numericTokens(value).join(' ') : '');
}
const validRender = { owner_brief: russianSurface(routed._owner_render_state.render_source) };

// First attempt invalid -> exact error goes to the owner normalizer only.
const invalidRender = structuredClone(validRender);
invalidRender.owner_brief.diagnoses[0].evidence_fact_ids = ['main_problem'];
const firstInvalid = run(code('Validate Owner Render'), {
  input: [ai(invalidRender)], nodes: { ...commonNodes, 'Validate + Store Rows': [routed] }
})[0].json;
check('first owner normalization failure produces one correction attempt', firstInvalid.owner_render_valid === false && firstInvalid.owner_render_attempt === 1);
check('exact owner validation error is fed back to the normalizer only', /EXACT VALIDATION ERROR: [^\n]*diagnoses\[\]\.evidence_fact_ids\[\] immutable value changed/.test(firstInvalid.owner_render_prompt));
check('owner normalization failure does not rerun core X-Ray', coreCalls === 1 && outputs('IF Owner Render Valid', 1).join() === 'Owner Render Correction');

const corrected = run(code('Validate Owner Render Correction'), {
  input: [ai(validRender)], nodes: { ...commonNodes, 'Validate + Store Rows': [routed], 'Validate Owner Render': [firstInvalid] }
})[0];
check('one correction can validate the owner render', corrected.json.owner_render_valid === true && corrected.json.owner_render_attempt === 2);
check('request_id and analysis_id survive both normalization attempts', corrected.json.request_id === input.request_id && corrected.json.analysis_id === routed.analysis_id);

const final = run(code('Revalidate Corrected Analysis'), { input: [corrected], nodes: commonNodes })[0].json;
check('normalized result becomes one successful analysis only after RU validation', final.is_valid === true && final.analysis_row.review_status === 'AI_DRAFT' && final.analysis_id === routed.analysis_id);
check('RO customer-facing result remains Romanian', /Compania are nevoie/.test(JSON.parse(final.analysis_row.client_result_draft_json).executive_summary));
const storedBrief = JSON.parse(final.analysis_row.owner_brief_json);
check('RO source client facts are byte-identical', JSON.stringify(storedBrief.client_facts) === JSON.stringify(clientFacts) && storedBrief.client_facts[0].value === roSource);
check('owner presentation translations do not overwrite source facts', storedBrief.owner_fact_translations[0].value_ru !== storedBrief.client_facts[0].value);
// Company and contact name are deterministic CRM identity, never model output: the owner surface
// must carry them verbatim. Everything else on an owner surface has to be Russian.
const withoutProperNouns = (text) => String(text)
  .split(input.owner_context.company).join('[COMPANY]')
  .split(input.owner_context.contact_name).join('[CONTACT]');
const romanianLeft = (text) => /[ăâîșşțţ]/i.test(withoutProperNouns(text))
  || /\b(?:compania|pentru|este|sunt|lichiditate|clientul|următor)\b/i.test(withoutProperNouns(text));
check('owner alert is Russian-only apart from proper nouns/codes', /Новый лид|КЛЮЧЕВАЯ ПРОБЛЕМА|СЕЙЧАС/.test(final.owner_alert.text) && !romanianLeft(final.owner_alert.text) && final.owner_alert.text.includes(input.owner_context.company));

const surface = run(code('Render Review Surface'), {
  input: [final.analysis_row], nodes: { 'Review GET Webhook': [{ query: { a: final.analysis_id, t: final.analysis_row.review_token } }] }
})[0].json;
check('meeting brief is Russian-only apart from proper nouns/codes', surface.http_status === 200 && /Бриф|Диагноз FINMENTOR|Следующее действие/.test(surface.html) && !romanianLeft(surface.html));
check('one resolved item means one ledger success and one owner alert', [final].length === 1 && !!final.analysis_row && !!final.owner_alert && !Array.isArray(final.owner_alert));
check('compiled workflow has exactly one rich owner alert node and one persistence convergence', workflow.nodes.filter((node) => node.name === 'Telegram Owner Alert').length === 1 && outputs('Resolved Analysis Outcome').join() === 'Analysis Row');
check('compiled workflow has exactly one core model node and no normalizer edge back to it', workflow.nodes.filter((node) => node.name === 'AI X-Ray Analysis').length === 1 && !Object.values(workflow.connections).some((entry) => ((entry.main || []).flat()).some((edge) => edge.node === 'AI X-Ray Analysis' && edge !== workflow.connections['IF Source Pair Safe']?.main?.[0]?.[0])));

// Both attempts invalid -> one terminal marker, no rich owner alert, and no future core retry.
const secondInvalid = run(code('Validate Owner Render Correction'), {
  input: [ai(invalidRender)], nodes: { ...commonNodes, 'Validate + Store Rows': [routed], 'Validate Owner Render': [firstInvalid] }
})[0];
const terminal = run(code('Owner Render Failed Row'), { input: [secondInvalid], nodes: commonNodes })[0].json;
check('normalizer exhaustion emits terminal OWNER_RENDER_FAILED evidence', terminal.owner_render_failed === true && terminal.owner_render_attempt === 2 && /^OWNER_RENDER_FAILED\|ATTEMPT=2\|MAX=2\|ERROR=/.test(terminal.analysis_row.validation_errors));
check('normalizer exhaustion keeps the same request_id and analysis_id', terminal.request_id === input.request_id && terminal.analysis_id === routed.analysis_id && terminal.analysis_row.analysis_id === routed.analysis_id);
check('normalizer exhaustion emits no rich or fallback owner alert', terminal.owner_alert === null && terminal.owner_text === '' && terminal.notify_owner === false);
check('compiled exhaustion route sends OWNER_RENDER_FAILED System Alert', outputs('IF Owner Render Failed', 0).join() === 'Emit System Alert (Owner Render Failed)' && byName('Emit System Alert (Owner Render Failed)').parameters.workflowInputs.value.error_code === 'OWNER_RENDER_FAILED');
const selected = run(code('Select Pending Leads'), {
  input: [terminal.analysis_row],
  nodes: { 'Settings to Object': [{ settings: { ...settings, xray_analysis_enabled: true, xray_analysis_since: '2026-09-01T00:00:00.000Z', xray_max_per_run: 3 } }], 'Read Pipeline': [{ lead_id: input.lead_id, request_id: input.request_id, priority: 'HOT', status: 'Qualified', created_at: '2026-09-17T08:00:00.000Z' }] }
});
check('OWNER_RENDER_FAILED is terminal and cannot re-enter the core retry loop', selected.length === 0 && coreCalls === 1);
check('normalizer maximum attempts is exactly two', byName('Owner Render Normalizer') && byName('Owner Render Correction') && !byName('Owner Render Correction 2'));

// An accepted render whose merged surface the full owner contract still reads as Romanian is the
// last owner-language exit. It must end as terminal presentation evidence, never as a core retry.
const residual = run(code('Revalidate Normalized Analysis'), {
  input: [{ json: { output_text: JSON.stringify(corePlan), __owner_render_completed: true, __owner_render_analysis_id: routed.analysis_id } }],
  nodes: commonNodes
})[0].json;
check('a residual owner-language error after normalization is terminal, not a core retry', residual.is_valid === false && residual.core_analysis_valid === true && residual.owner_render_failed === true
  && residual.retry_possible === false && residual.retry_exhausted === false && residual.notify_owner === false && residual.owner_alert === null
  && residual.analysis_id === routed.analysis_id && /^OWNER_RENDER_FAILED\|ATTEMPT=2\|MAX=2\|ERROR=/.test(residual.analysis_row.validation_errors));
const residualSelected = run(code('Select Pending Leads'), {
  input: [residual.analysis_row],
  nodes: { 'Settings to Object': [{ settings: { ...settings, xray_analysis_enabled: true, xray_analysis_since: '2026-09-01T00:00:00.000Z', xray_max_per_run: 3 } }], 'Read Pipeline': [{ lead_id: input.lead_id, request_id: input.request_id, priority: 'HOT', status: 'Qualified', created_at: '2026-09-17T08:00:00.000Z' }] }
});
check('the residual owner-language exit cannot re-enter the core retry loop', residualSelected.length === 0 && coreCalls === 1);

console.log(`\nv1-owner-render-architecture: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}

