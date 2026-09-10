#!/usr/bin/env node
// FINMENTOR Lead Intelligence v1 — deterministic owner-brief, provenance and lifecycle QA.
import { createRequire } from 'node:module';
import { NIAGARA_AI, NIAGARA_BRIEF, NIAGARA_CLIENT_DRAFT, NIAGARA_CONTEXT, NIAGARA_LIVE_SANITIZED_SOURCE, NIAGARA_ROW } from './fixtures/lead-intelligence-fixtures.mjs';

const require = createRequire(import.meta.url);
const LI = require('../n8n/src/lead-intelligence/contract.js');
const ALERT = require('../n8n/src/lead-intelligence/alert.js');
const RENDER = require('../n8n/src/lead-intelligence/render.js');
const ACTIONS = require('../n8n/src/lead-intelligence/actions.js');
const NOTIFY = require('../n8n/src/lead-intelligence/notification.js');

let passed = 0; let failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nFINMENTOR — Lead Intelligence v1\n');

// CONTACT — preference is never used as reachability evidence.
const niagaraContact = NIAGARA_BRIEF.contact;
check('Niagara: preferred channel is Telegram', niagaraContact.preferred_contact_channel === 'telegram');
check('Niagara: Telegram is not reachable without a route', niagaraContact.telegram.reachable === false);
check('Niagara: exact not-connected warning exists', niagaraContact.telegram.reason === 'Telegram-контакт не подключён');
check('Niagara: phone remains reachable', niagaraContact.reachable_channels.some((x) => x.key === 'phone' && x.value === '+373 60 123 456'));
check('Niagara: email remains reachable', niagaraContact.reachable_channels.some((x) => x.key === 'email' && x.value === 'alexander@niagara.example'));
check('phone-only contact', LI.buildReachability({ preferred_contact_channel: 'phone', phone: '+40 721 111 222' }).reachable_channels.map((x) => x.key).join() === 'phone');
check('email-only contact', LI.buildReachability({ preferred_contact_channel: 'email', email: 'owner@example.ro' }).reachable_channels.map((x) => x.key).join() === 'email');
check('verified Mini App numeric Telegram route', LI.buildReachability({ preferred_contact_channel: 'telegram', telegram: '551662084', source_channel: 'telegram_premium' }).telegram.verified === true);
check('website numeric Telegram value is not trusted', LI.buildReachability({ preferred_contact_channel: 'telegram', telegram: '551662084', source_channel: 'website_xray' }).telegram.verified === false);
check('valid explicit Telegram username is reachable', LI.buildReachability({ preferred_contact_channel: 'telegram', telegram_username: '@alexander_fin' }).telegram.verified === true);
check('no-contact case remains empty', LI.buildReachability({ preferred_contact_channel: 'telegram' }).reachable_channels.length === 0);

// PROVENANCE and OWNER BRIEF.
check('Niagara brief contract passes', LI.briefErrors(NIAGARA_BRIEF).length === 0, LI.briefErrors(NIAGARA_BRIEF).join('; '));
check('every displayed client fact is source-derived', NIAGARA_BRIEF.client_facts.every((x) => x.kind === 'CLIENT_FACT' && x.source_path));
check('Niagara live-derived source uses mismatched Lead IDs and one request_id', NIAGARA_LIVE_SANITIZED_SOURCE.lead_row['Lead ID'] !== NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.lead_id && NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.request_id === NIAGARA_LIVE_SANITIZED_SOURCE.request_id);
const niagaraRaw = JSON.parse(NIAGARA_LIVE_SANITIZED_SOURCE.lead_row['Raw JSON']);
check('Niagara keeps review preference separate from requested first step', niagaraRaw.diagnostic.wants_review === 'Пока только самооценка' && niagaraRaw.intake.business_pain.desired_first_step === 'Построить систему контроля');
check('Niagara Pipeline main pain preserves exact source wording', NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.main_pain === 'Платежи хаотично / кассовые разрывы' && NIAGARA_BRIEF.client_facts.find((x) => x.id === 'main_problem').value === 'Платежи хаотично / кассовые разрывы');
check('Niagara keeps the specific business model ahead of industry category', NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.business_model === 'Fitness' && NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.industry_category === 'Услуги / консалтинг' && NIAGARA_BRIEF.header.business === 'Fitness');
check('Niagara expanded controls preserve exact yes and blank values', niagaraRaw.intake.financial_control.receivables_control === 'Да' && niagaraRaw.intake.financial_control.payables_control === 'Да' && ['owner_report','margin_control','payment_approval_rules'].every((key) => niagaraRaw.intake.financial_control[key] === ''));
check('Niagara quick and expanded control layers remain separate CLIENT_FACTs', NIAGARA_BRIEF.client_facts.some((x) => x.id === 'existing_setup' && x.source_path === 'Leads.Raw JSON.answers.quick_diagnostic' && /Дебиторка и кредиторка: Частично/.test(x.value) && /KPI, риски и отклонения: Частично, разрозненно/.test(x.value)) && NIAGARA_BRIEF.client_facts.some((x) => x.id === 'financial_system' && x.source_path === 'Leads.Raw JSON.intake.financial_control' && /Дебиторская задолженность: Да/.test(x.value) && /Кредиторская задолженность: Да/.test(x.value)));
check('Niagara blank expanded controls are never fabricated as CLIENT_FACT values', !/Отч[её]т собственника:|Контроль маржи:|Правила согласования платежей:/.test(NIAGARA_BRIEF.client_facts.find((x) => x.id === 'financial_system').value));
check('Niagara selected goals/documents stay empty instead of becoming facts', !NIAGARA_BRIEF.client_facts.some((x) => ['desired_result','documents'].includes(x.id)));
check('desired_first_step is exact and explicitly labelled as client-selected', NIAGARA_BRIEF.client_facts.some((x) => x.id === 'desired_first_step' && x.value === 'Построить систему контроля' && x.label === 'Первый шаг, выбранный клиентом' && /business_pain\.desired_first_step/.test(x.source_path)));
check('Niagara self-assessment is not customer-result eligible', NIAGARA_BRIEF.client_result_eligible === false && NIAGARA_BRIEF.client_result_eligibility_reason === 'EXPLICITLY_NOT_REQUESTED');
check('website source alone never grants client result', LI.clientResultEligibility({ source_channel: 'website_xray', explicit_request: '' }).eligible === false);
check('explicit supported journey request grants client result', LI.clientResultEligibility({ source_channel: 'website_xray', explicit_request: 'Да, нужен разбор' }).eligible === true);
check('every diagnosis is interpretation', NIAGARA_BRIEF.diagnoses.every((x) => x.kind === 'FINMENTOR_INTERPRETATION'));
check('every unknown is explicitly needs-verification', NIAGARA_BRIEF.unknowns.every((x) => x.kind === 'NEEDS_VERIFICATION'));
check('diagnosis evidence only references known facts', NIAGARA_BRIEF.diagnoses.every((x) => x.evidence_fact_ids.every((id) => NIAGARA_BRIEF.client_facts.some((f) => f.id === id))));
check('unknown evidence id is dropped instead of invented', LI.normalizeOwnerBrief({ ...NIAGARA_AI, diagnoses: [{ conclusion: 'x', evidence_fact_ids: ['not-a-f-fact'] }, ...NIAGARA_AI.diagnoses.slice(1)] }, NIAGARA_CONTEXT).diagnoses[0].evidence_fact_ids.length === 0);
check('Niagara source-layer contradiction is a FINMENTOR diagnosis', /быстрая диагностика.*частичн.*расширенная анкета.*оба контроля есть/i.test(NIAGARA_BRIEF.diagnoses[0].conclusion) && NIAGARA_BRIEF.diagnoses[0].evidence_fact_ids.includes('existing_setup') && NIAGARA_BRIEF.diagnoses[0].evidence_fact_ids.includes('financial_system'));
check('Niagara source-layer contradiction is explicitly NEEDS_VERIFICATION', NIAGARA_BRIEF.unknowns.some((x) => /быстрая диагностика.*частичн.*расширенная анкета.*«Да»/i.test(x.item)));
check('Niagara does not conclude another reporting system is needed', !/нужна новая система отч[её]тности/i.test(JSON.stringify(NIAGARA_BRIEF)));
for (const direction of ['прогноз', 'плат[её]ж', 'дебитор', 'CAPEX', 'финансирован', 'дисциплин']) {
  check('Niagara investigation direction: ' + direction, new RegExp(direction, 'i').test(JSON.stringify(NIAGARA_BRIEF)));
}
check('first-meeting objective is specific', /сверить противоречивые ответы.*источник хаотичных платежей/i.test(NIAGARA_BRIEF.first_meeting_objective));
check('opening uses the exact Niagara source-layer contradiction', /Платежи хаотично \/ кассовые разрывы.*быстрая диагностика.*частичн.*расширенная анкета.*«Да»/i.test(NIAGARA_BRIEF.conversation_opening));
check('opening never mentions AI', !/\bAI\b|искусственн/i.test(NIAGARA_BRIEF.conversation_opening));
check('discovery has 5–7 questions', NIAGARA_BRIEF.discovery_questions.length >= 5 && NIAGARA_BRIEF.discovery_questions.length <= 7);
check('every discovery question has a purpose', NIAGARA_BRIEF.discovery_questions.every((x) => x.question && x.why));
check('discovery questions reference actual facts/hypotheses', NIAGARA_BRIEF.discovery_questions.every((x) => /прогноз|разрыв|Cash Flow|плат[её]ж|дебитор|CAPEX|финансирован|решени/i.test(x.question + ' ' + x.why)));
check('solution is a hypothesis with rationale', NIAGARA_BRIEF.solution_hypothesis.kind === 'FINMENTOR_INTERPRETATION' && !!NIAGARA_BRIEF.solution_hypothesis.rationale);
check('solution has confirmation conditions', NIAGARA_BRIEF.solution_hypothesis.confirmation_conditions.length >= 1);
check('solution allows needs clarification', LI.normalizeOwnerBrief({ ...NIAGARA_AI, solution_hypothesis: { product: 'NOT_A_PRODUCT', rationale: 'Нужно уточнить.', confirmation_conditions: ['Данные получены.'] } }, NIAGARA_CONTEXT).solution_hypothesis.product === 'NEEDS_CLARIFICATION');
check('no automatic expensive upsell', NIAGARA_BRIEF.solution_hypothesis.product !== 'CFO_AI_CONTROL');
check('commercial intent stays unconfirmed', NIAGARA_BRIEF.header.commercial_intent === 'Не подтверждён');
check('next action has action/purpose/success', ['action','purpose','success_condition'].every((k) => !!NIAGARA_BRIEF.next_action[k]));
check('score is secondary data, preserved deterministically', NIAGARA_BRIEF.header.diagnostic_score === 82 && NIAGARA_BRIEF.header.financial_zone === 'GREEN');
const noScore = LI.normalizeOwnerBrief(NIAGARA_AI, { ...NIAGARA_CONTEXT, diagnostic_score: null, financial_zone: 'UNKNOWN' });
check('no diagnostic score remains null', noScore.header.diagnostic_score === null && noScore.header.financial_zone === 'UNKNOWN');
for (const source of ['website_xray','telegram_premium','both']) {
  const b = LI.normalizeOwnerBrief(NIAGARA_AI, { ...NIAGARA_CONTEXT, source });
  check('source accepted: ' + source, b.header.source === source);
}
const incomplete = LI.normalizeOwnerBrief({ ...NIAGARA_AI, unknowns: [{ item: 'Контактное лицо не указано.', why: 'Нужен адресат первой беседы.' }] }, { ...NIAGARA_CONTEXT, contact_name: '', phone: '', email: '', client_facts: NIAGARA_CONTEXT.client_facts.slice(0, 1) });
check('incomplete client remains a brief, not invented data', incomplete.header.contact_name === '' && incomplete.client_facts.length === 1 && incomplete.unknowns[0].kind === 'NEEDS_VERIFICATION');

// TELEGRAM alert — 10–15 second entry point.
const alert = ALERT.renderLeadIntelligenceAlert({
  company: 'Niagara club', contact_name: 'Александр', role: 'CEO', business: 'Фитнес', scale: '1–5 млн EUR · 100+ сотрудников',
  main_pain: NIAGARA_BRIEF.client_facts[0].value, observation: NIAGARA_BRIEF.diagnoses[0].conclusion,
  contact: niagaraContact, next_action: NIAGARA_BRIEF.next_action.action
});
check('alert has required short header', /^🔔 <b>FINMENTOR · Новый лид<\/b>/.test(alert));
for (const heading of ['ГЛАВНАЯ БОЛЬ','ЧТО ЗАМЕТИЛ FINMENTOR','КОНТАКТ','СЕЙЧАС']) check('alert section ' + heading, alert.includes('<b>' + heading + '</b>'));
check('alert shows preferred Telegram separately', /Предпочтительно: Telegram/.test(alert));
check('alert shows Telegram not connected', /Telegram-контакт не подключён/.test(alert));
check('alert keeps phone and email available', /Телефон: \+373 60 123 456/.test(alert) && /Email: alexander@niagara\.example/.test(alert));
check('alert contains no Lead ID or raw enum', !/FIN-NIAGARA|AI_DRAFT|CLIENT_READY|\bGREEN\b/.test(alert));
check('alert remains below Telegram limit', alert.length < 1200);
check('alert escapes client values', /A &lt; B/.test(ALERT.renderLeadIntelligenceAlert({ company: 'A < B', contact: {}, main_pain: 'x', observation: 'y', next_action: 'z' })));

// RENDER — memo hierarchy and progressive disclosure.
const auth = { analysis_id: 'XA-NIAGARA-UAT', token: 'a'.repeat(64) };
const html = RENDER.renderOwnerBriefPage({ brief: NIAGARA_BRIEF, row: NIAGARA_ROW, client_draft: NIAGARA_CLIENT_DRAFT, auth });
const ELIGIBLE_BRIEF = { ...NIAGARA_BRIEF, client_result_eligible: true, client_result_eligibility_reason: 'EXPLICITLY_REQUESTED' };
const ELIGIBLE_ROW = { ...NIAGARA_ROW, client_result_eligible: true, owner_brief_json: JSON.stringify(ELIGIBLE_BRIEF) };
for (const title of ['01','Что говорит клиент','02','Диагноз FINMENTOR','03','Карта боли','04','Что нужно проверить','05','Цель первой встречи','06','Как начать разговор','07','Вопросы первой встречи','08','Рабочая гипотеза решения','09','Следующее действие']) check('owner brief renders ' + title, html.includes(title));
check('fact/interpretation/verify labels are visible', /КЛИЕНТ ГОВОРИТ/.test(html) && /FINMENTOR ВИДИТ/.test(html) && /НУЖНО ПРОВЕРИТЬ/.test(html));
check('brief does not visibly expose Lead ID', !/>\s*FIN-NIAGARA-UAT\s*</.test(html));
check('brief uses progressive-disclosure drawers', ['Исходные ответы','История','Контакты'].every((x) => html.includes('<summary>' + x + '</summary>')));
check('after-call form has five outcomes and exactly three capture fields', (html.match(/name="conversation_outcome"/g) || []).length === 5 && (html.match(/<textarea/g) || []).length === 3 && html.includes('name="next_step_and_date"') && !html.includes('name="next_step_date"'));
check('mobile CSS is present', /@media\(max-width:760px\)/.test(html));
check('executive path is visibly ordered pain to next action', ['pain','insight','verify','conversation','solution','next-action'].every((stage, i, all) => html.indexOf('data-stage="' + stage + '"') > (i ? html.indexOf('data-stage="' + all[i - 1] + '"') : -1)));
check('hero prioritises pain insight contact and next action', /hero-priority/.test(html) && /Главная боль/.test(html) && /Вывод FINMENTOR/.test(html) && /Контакт сейчас/.test(html) && /Следующее действие/.test(html));
check('Niagara owner-only navigation exposes exactly two primary actions', (html.match(/data-primary-action/g) || []).length === 2 && !/<details class="action-overflow">/.test(html));
check('long hostile text is escaped and bounded', (() => { const hostile = LI.normalizeOwnerBrief({ ...NIAGARA_AI, conversation_opening: '<script>' + 'x'.repeat(5000) }, NIAGARA_CONTEXT); const out = RENDER.renderOwnerBriefPage({ brief: hostile, row: NIAGARA_ROW, client_draft: NIAGARA_CLIENT_DRAFT, auth }); return !out.includes('<script>') && hostile.conversation_opening.length <= 900; })());
const blockedEditHtml = RENDER.renderOwnerBriefPage({ brief: NIAGARA_BRIEF, row: NIAGARA_ROW, client_draft: NIAGARA_CLIENT_DRAFT, auth, mode: 'edit' });
check('Niagara direct editor route is visibly blocked', /Клиентский результат не предусмотрен/.test(blockedEditHtml) && !/save_client_draft/.test(blockedEditHtml));
const editHtml = RENDER.renderOwnerBriefPage({ brief: ELIGIBLE_BRIEF, row: ELIGIBLE_ROW, client_draft: NIAGARA_CLIENT_DRAFT, auth, mode: 'edit' });
check('editor locks score/zone/original answers', !/name="score"|name="zone"|name="client_facts"/.test(editHtml));
check('editor includes only fast customer fields', ['executive_summary','maturity_rationale','key_risks','management_priorities','plan_days_1_7','tomorrow_actions','recommendation_label','recommendation_rationale'].every((x) => editHtml.includes('name="' + x + '"')));
const previewHtml = RENDER.renderOwnerBriefPage({ brief: ELIGIBLE_BRIEF, row: ELIGIBLE_ROW, client_draft: NIAGARA_CLIENT_DRAFT, auth, mode: 'preview' });
check('preview declares exact customer view', /ТОЧНО ТАК УВИДИТ КЛИЕНТ/.test(previewHtml));
check('preview uses saved customer draft', previewHtml.includes(NIAGARA_CLIENT_DRAFT.executive_summary) && previewHtml.includes(NIAGARA_CLIENT_DRAFT.recommended_next_step.rationale));
const eligibleNav = RENDER.renderOwnerBriefPage({ brief: ELIGIBLE_BRIEF, row: ELIGIBLE_ROW, client_draft: NIAGARA_CLIENT_DRAFT, auth });
check('eligible mobile action model keeps two primary actions plus overflow', (eligibleNav.match(/data-primary-action/g) || []).length === 2 && /<details class="action-overflow">/.test(eligibleNav));
check('RO owner page keeps html locale when requested', /<html lang="ro">/.test(RENDER.renderOwnerBriefPage({ brief: NIAGARA_BRIEF, row: { ...NIAGARA_ROW, locale: 'ro' }, client_draft: NIAGARA_CLIENT_DRAFT, auth })));

// OWNER ACTIONS — save/preview do not publish; approval does; after-call never rewrites facts.
const editBody = {
  action: 'save_client_draft', executive_summary: 'Отредактированный вывод.', maturity_rationale: 'Проверено владельцем.',
  key_risks: 'Ликвидность | Анкета | Срыв платежей', management_priorities: 'Приоритет 1',
  plan_days_1_7: 'Действие 1', plan_days_8_14: 'Действие 2', plan_days_15_21: 'Действие 3', plan_days_22_30: 'Действие 4',
  tomorrow_actions: 'Собрать данные', recommendation_label: 'Financial Health Check', recommendation_rationale: 'Сначала диагностика.'
};
const saved = ACTIONS.handleOwnerAction({ row: ELIGIBLE_ROW, body: editBody, now: '2026-09-10T07:00:00.000Z' });
check('draft save moves to OWNER_EDITED', saved.ok && saved.update_row.review_status === 'OWNER_EDITED');
check('draft save does not publish', saved.publish_client === false);
check('draft save cannot edit product code', JSON.parse(saved.update_row.client_result_draft_json).recommended_next_step.product === 'FINANCIAL_HEALTH_CHECK');
check('ineligible result cannot be edited', ACTIONS.handleOwnerAction({ row: { ...NIAGARA_ROW, client_result_eligible: false, owner_brief_json: JSON.stringify({ ...NIAGARA_BRIEF, client_result_eligible: false }) }, body: editBody }).code === 'CLIENT_RESULT_NOT_ELIGIBLE');
check('legacy brief eligibility cannot override false ledger authority', ACTIONS.handleOwnerAction({ row: { ...NIAGARA_ROW, client_result_eligible: false, owner_brief_json: JSON.stringify({ ...NIAGARA_BRIEF, client_result_eligible: true }) }, body: editBody }).code === 'CLIENT_RESULT_NOT_ELIGIBLE');
const approved = ACTIONS.handleOwnerAction({ row: { ...ELIGIBLE_ROW, review_status: 'OWNER_EDITED' }, body: { action: 'approve' }, now: '2026-09-10T07:05:00.000Z' });
check('approve is the only action that publishes', approved.ok && approved.publish_client === true && approved.update_row.review_status === 'CLIENT_READY');
check('CLIENT_READY does not mark notified', !('customer_notified_at' in approved.update_row));
const repeatApprove = ACTIONS.handleOwnerAction({ row: { ...ELIGIBLE_ROW, review_status: 'CLIENT_READY' }, body: { action: 'approve' } });
check('repeat approve is an idempotent CLIENT_READY publication repair', repeatApprove.ok && repeatApprove.code === 'ALREADY_READY' && repeatApprove.update_row.review_status === 'CLIENT_READY' && !('customer_notified_at' in repeatApprove.update_row));
const originalFacts = JSON.stringify(NIAGARA_BRIEF.client_facts);
const called = ACTIONS.handleOwnerAction({ row: NIAGARA_ROW, body: { action: 'after_call', conversation_outcome: 'HYPOTHESIS_CHANGED', confirmed: 'Разрывы повторяются ежемесячно.', changed: 'CAPEX не является причиной.', next_step_and_date: 'Получить ageing дебиторки — 15.09.2026' }, now: '2026-09-10T07:10:00.000Z' });
const calledBrief = JSON.parse(called.update_row.owner_brief_json);
check('after-call capture succeeds', called.ok && called.code === 'CALL_CAPTURED');
check('owner confirmed fact has higher-authority provenance', calledBrief.owner_confirmed_facts.at(-1).kind === 'OWNER_CONFIRMED_FACT');
check('owner note provenance stays separate', calledBrief.owner_notes.at(-1).kind === 'OWNER_NOTE');
check('after-call leaves client source facts byte-identical', JSON.stringify(calledBrief.client_facts) === originalFacts);
check('after-call increments intelligence version', calledBrief.intelligence_version === NIAGARA_BRIEF.intelligence_version + 1);
check('after-call retains previous version for audit', JSON.parse(called.update_row.brief_versions_json).length === 1);
check('after-call refreshes CFO diagnosis from owner provenance', JSON.stringify(calledBrief.diagnoses) !== JSON.stringify(NIAGARA_BRIEF.diagnoses) && calledBrief.diagnoses[0].owner_evidence_ids.length === 1);
check('after-call refreshes unknowns and discovery questions', JSON.stringify(calledBrief.unknowns) !== JSON.stringify(NIAGARA_BRIEF.unknowns) && JSON.stringify(calledBrief.discovery_questions) !== JSON.stringify(NIAGARA_BRIEF.discovery_questions));
check('after-call changed hypothesis fails solution closed to clarification', calledBrief.solution_hypothesis.product === 'NEEDS_CLARIFICATION' && calledBrief.solution_hypothesis.owner_note_ids === undefined && calledBrief.solution_hypothesis.rationale !== NIAGARA_BRIEF.solution_hypothesis.rationale);
check('after-call reconciliation records owner evidence on solution', calledBrief.solution_hypothesis.kind === 'FINMENTOR_INTERPRETATION' && calledBrief.solution_hypothesis.confirmation_conditions[0].includes('CAPEX не является причиной'));
check('after-call writes minimum Pipeline fields', called.pipeline_row.next_action === 'Получить ageing дебиторки' && called.pipeline_row.next_follow_up_at === '2026-09-15' && called.pipeline_row.conversation_outcome === 'HYPOTHESIS_CHANGED');
check('after-call emits human activity', called.activity_row.action === 'conversation_captured' && !/workflow|node/i.test(called.activity_row.detail));

// NOTIFICATION — success only, manual route and no viewed inference.
const tgBrief = { ...ELIGIBLE_BRIEF, contact: LI.buildReachability({ preferred_contact_channel: 'telegram', telegram: '551662084', source_channel: 'telegram_premium' }) };
const nreq = NOTIFY.clientNotification({ row: { ...ELIGIBLE_ROW, review_status: 'CLIENT_READY' }, brief: tgBrief, client_result_url: 'https://app.finmentor.test/result' });
check('verified Telegram route builds transport request', nreq.eligible === true && nreq.request.chat_id === '551662084' && nreq.request.keyboard_layout_id === 'L1_W');
check('Niagara self-assessment cannot auto-notify', NOTIFY.clientNotification({ row: { ...NIAGARA_ROW, review_status: 'CLIENT_READY' }, brief: NIAGARA_BRIEF, client_result_url: 'https://app.finmentor.test/result' }).reason === 'RESULT_NOT_READY_OR_NOT_ELIGIBLE');
check('stringified ledger eligibility cannot auto-notify', NOTIFY.clientNotification({ row: { ...ELIGIBLE_ROW, review_status: 'CLIENT_READY', client_result_eligible: 'true' }, brief: tgBrief, client_result_url: 'https://app.finmentor.test/result' }).reason === 'RESULT_NOT_READY_OR_NOT_ELIGIBLE');
check('failed Telegram send does not mark notified', NOTIFY.notificationState(NIAGARA_ROW, { ok: false }).updated === false);
check('stringified ledger eligibility cannot mark a delivery', NOTIFY.notificationState({ ...ELIGIBLE_ROW, client_result_eligible: 'true' }, { ok: true, message_id: '10' }).updated === false);
const delivered = NOTIFY.notificationState(ELIGIBLE_ROW, { ok: true, message_id: '10' }, '2026-09-10T07:20:00.000Z');
check('successful send marks CLIENT_NOTIFIED', delivered.updated && delivered.update_row.review_status === 'CLIENT_NOTIFIED' && delivered.update_row.customer_notified_at);
check('successful send logs outbound activity', delivered.activity_row.action === 'client_notified');
const manual = ACTIONS.handleOwnerAction({ row: { ...ELIGIBLE_ROW, review_status: 'CLIENT_READY' }, body: { action: 'manual_notify', notification_channel: 'email' }, now: '2026-09-10T07:30:00.000Z' });
check('manual notification records channel/timestamp/actor', manual.ok && manual.update_row.customer_notification_channel === 'email' && manual.update_row.customer_notified_at && manual.update_row.customer_notification_actor === 'owner:review');
check('manual notification logs activity', manual.activity_row.action === 'client_notified_manual');
check('ineligible CLIENT_READY cannot fabricate a manual notification', ACTIONS.handleOwnerAction({ row: { ...NIAGARA_ROW, review_status: 'CLIENT_READY' }, body: { action: 'manual_notify', notification_channel: 'email' } }).code === 'CLIENT_RESULT_NOT_ELIGIBLE');
check('stringified eligibility cannot fabricate a manual notification', ACTIONS.handleOwnerAction({ row: { ...ELIGIBLE_ROW, client_result_eligible: 'true', review_status: 'CLIENT_READY' }, body: { action: 'manual_notify', notification_channel: 'email' } }).code === 'CLIENT_RESULT_NOT_ELIGIBLE');
check('no code path infers CLIENT_VIEWED', !/CLIENT_VIEWED/.test(JSON.stringify([saved, approved, called, nreq, delivered, manual])));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
