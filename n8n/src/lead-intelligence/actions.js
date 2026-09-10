// FINMENTOR Lead Intelligence v1 — explicit owner actions.
//
// Pure state transition logic. Token/row authority is checked by the surrounding X-Ray review
// node before this module runs. No action ever rewrites source facts.
'use strict';

const LI = require('./contract.js');

function parseJson(value, fallback) {
  try { const v = JSON.parse(String(value || '')); return v && typeof v === 'object' ? v : fallback; }
  catch (e) { return fallback; }
}
function safeDate(value) {
  const v = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function nextActionInput(body) {
  const b = body || {};
  let nextStep = LI.text(b.next_step, 600);
  let nextDate = safeDate(b.next_step_date);
  const combined = LI.text(b.next_step_and_date, 800);
  if (!combined) return { nextStep, nextDate };
  const iso = combined.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const local = combined.match(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b/);
  const match = iso || local;
  if (!nextDate && match) nextDate = iso ? match[0] : match[3] + '-' + match[2] + '-' + match[1];
  if (!nextStep) {
    let cleaned = match ? combined.replace(match[0], '') : combined;
    cleaned = cleaned.replace(/\s+(?:до|на)\s*$/i, '').replace(/[\s·—–,;:-]+$/g, '').trim();
    nextStep = LI.text(cleaned || combined, 600);
  }
  return { nextStep, nextDate };
}
function allowedState(state, list) { return list.includes(String(state || '')); }
function activity(row, now, action, detail, channel) {
  return {
    activity_id: String(row.lead_id || 'lead') + '-li-' + Date.parse(now), ts: now,
    lead_id: String(row.lead_id || ''), actor: 'owner:review', channel: channel || 'owner_console',
    action, detail: LI.text(detail, 1500)
  };
}

function normalAction(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { action: LI.text(v.action || value, 400), owner_role: LI.text(v.owner_role, 100), expected_output: LI.text(v.expected_output, 400), control_or_kpi: LI.text(v.control_or_kpi, 250), priority: ['HIGH','MEDIUM','LOW'].includes(String(v.priority).toUpperCase()) ? String(v.priority).toUpperCase() : 'MEDIUM' };
}

function editClientDraft(current, body) {
  const c = JSON.parse(JSON.stringify(current || {})); const b = body || {};
  c.executive_summary = LI.text(b.executive_summary, 2500);
  c.financial_maturity = c.financial_maturity && typeof c.financial_maturity === 'object' ? c.financial_maturity : {};
  // score_1_to_5 and label stay untouched; only the explanation is editable.
  c.financial_maturity.rationale = LI.text(b.maturity_rationale, 1000);
  c.key_risks = LI.lines(b.key_risks, 5, 1200).map((line) => {
    const parts = String(line).split('|').map((x) => LI.text(x, 500));
    return { title: parts[0], category: '', evidence: parts[1] || '', potential_impact: parts[2] || '', priority: 'MEDIUM' };
  }).filter((x) => x.title);
  c.management_priorities = LI.lines(b.management_priorities, 3, 400);
  c.plan_30_days = c.plan_30_days && typeof c.plan_30_days === 'object' ? c.plan_30_days : {};
  for (const key of ['days_1_7','days_8_14','days_15_21','days_22_30']) {
    c.plan_30_days[key] = LI.lines(b['plan_' + key], 6, 500).map(normalAction).filter((x) => x.action);
  }
  c.tomorrow_actions = LI.lines(b.tomorrow_actions, 3, 400);
  c.recommended_next_step = c.recommended_next_step && typeof c.recommended_next_step === 'object' ? c.recommended_next_step : {};
  // Product code is locked. Owner edits the customer-facing label and rationale only.
  c.recommended_next_step.label = LI.text(b.recommendation_label, 200);
  c.recommended_next_step.rationale = LI.text(b.recommendation_rationale, 800);
  return c;
}

function actionError(code, message) { return { ok: false, code, message, persist_analysis: false, publish_client: false }; }

function handleOwnerAction(input) {
  const i = input || {}; const row = i.row || {}; const body = i.body || {};
  const action = LI.text(body.action, 60); const now = i.now || new Date().toISOString();
  const state = String(row.review_status || '');
  const brief = parseJson(row.owner_brief_json, parseJson(row.analysis_json, {}).owner_brief || {});
  const clientDraft = parseJson(row.client_result_draft_json, parseJson(row.analysis_json, {}));
  const eligible = row.client_result_eligible === true || String(row.client_result_eligible).toLowerCase() === 'true' || brief.client_result_eligible === true;

  if (action === 'save_client_draft') {
    if (!eligible) return actionError('CLIENT_RESULT_NOT_ELIGIBLE', 'Для этого обращения клиентский результат не предусмотрен.');
    if (!allowedState(state, ['AI_DRAFT','OWNER_REVIEW','OWNER_EDITED'])) return actionError('STATE_CONFLICT', 'Результат уже опубликован или недоступен для редактирования.');
    const edited = editClientDraft(clientDraft, body);
    if (!edited.executive_summary || !edited.key_risks.length || !edited.management_priorities.length) return actionError('CLIENT_DRAFT_INCOMPLETE', 'Заполните краткий вывод, риски и приоритеты.');
    return {
      ok: true, code: 'OWNER_EDITED', persist_analysis: true, publish_client: false,
      update_row: { analysis_id: row.analysis_id, review_status: 'OWNER_EDITED', client_result_draft_json: JSON.stringify(edited), owner_edited_at: now },
      pipeline_row: { lead_id: row.lead_id, xray_analysis_status: 'OWNER_EDITED', updated_at: now, last_activity_at: now },
      activity_row: activity(row, now, 'client_result_edited', 'Клиентская версия сохранена; публикация не выполнена.'),
      client_draft: edited, message: 'Изменения сохранены. Клиент ещё не видит результат.'
    };
  }

  if (action === 'approve') {
    if (!eligible) return actionError('CLIENT_RESULT_NOT_ELIGIBLE', 'Клиентский результат не был обещан в этом пути.');
    if (state === 'CLIENT_READY') {
      return {
        ok: true, code: 'ALREADY_READY', persist_analysis: true, publish_client: true,
        update_row: { analysis_id: row.analysis_id, review_status: 'CLIENT_READY', reviewed_at: row.reviewed_at || now, client_result_draft_json: JSON.stringify(clientDraft) },
        pipeline_row: { lead_id: row.lead_id, xray_analysis_status: 'CLIENT_READY', updated_at: now, last_activity_at: row.last_activity_at || now },
        activity_row: activity(row, now, 'client_result_ready_reconfirmed', 'Публикация готового клиентского результата проверена повторно.'), client_draft: clientDraft,
        message: 'Результат уже доступен клиенту. Публикация проверена повторно.'
      };
    }
    if (!allowedState(state, ['AI_DRAFT','OWNER_REVIEW','OWNER_EDITED'])) return actionError('STATE_CONFLICT', state === 'CLIENT_NOTIFIED' || state === 'CLIENT_VIEWED' ? 'Результат уже доступен клиенту.' : 'Результат нельзя опубликовать из текущего состояния.');
    if (!clientDraft || !LI.text(clientDraft.executive_summary) || !Array.isArray(clientDraft.key_risks)) return actionError('CLIENT_DRAFT_INCOMPLETE', 'Клиентская версия не готова.');
    return {
      ok: true, code: 'CLIENT_READY', persist_analysis: true, publish_client: true,
      update_row: { analysis_id: row.analysis_id, review_status: 'CLIENT_READY', reviewed_at: now, client_result_draft_json: JSON.stringify(clientDraft) },
      pipeline_row: { lead_id: row.lead_id, xray_analysis_status: 'CLIENT_READY', updated_at: now, last_activity_at: now },
      activity_row: activity(row, now, 'client_result_ready', 'Результат утверждён и доступен клиенту; уведомление ещё не подтверждено.'),
      client_draft: clientDraft, message: 'Результат утверждён и доступен клиенту.'
    };
  }

  if (action === 'after_call') {
    const outcome = String(body.conversation_outcome || '').toUpperCase();
    if (!LI.OUTCOME_CODES.includes(outcome)) return actionError('OUTCOME_REQUIRED', 'Выберите результат разговора.');
    const confirmed = LI.text(body.confirmed, 1200); const changed = LI.text(body.changed, 1200);
    const { nextStep, nextDate } = nextActionInput(body);
    const nextBrief = JSON.parse(JSON.stringify(brief || {}));
    const version = Number(nextBrief.intelligence_version || 1) + 1;
    nextBrief.intelligence_version = version;
    nextBrief.generated_at = now;
    nextBrief.owner_confirmed_facts = Array.isArray(nextBrief.owner_confirmed_facts) ? nextBrief.owner_confirmed_facts : [];
    nextBrief.owner_notes = Array.isArray(nextBrief.owner_notes) ? nextBrief.owner_notes : [];
    if (confirmed) nextBrief.owner_confirmed_facts.push({ kind: LI.INFORMATION_KIND.OWNER_CONFIRMED_FACT, text: confirmed, at: now, actor: 'owner:review' });
    if (changed) nextBrief.owner_notes.push({ kind: LI.INFORMATION_KIND.OWNER_NOTE, text: changed, at: now, actor: 'owner:review' });
    nextBrief.header = nextBrief.header || {};
    nextBrief.next_action = nextBrief.next_action || {};
    if (nextStep) { nextBrief.header.next_action = nextStep; nextBrief.next_action.action = nextStep; }
    if (nextDate) { nextBrief.header.next_action_date = nextDate; nextBrief.next_action.due_date = nextDate; }
    nextBrief.history = Array.isArray(nextBrief.history) ? nextBrief.history : [];
    nextBrief.history.push({ at: now, label: 'Разговор зафиксирован владельцем' });
    const versions = parseJson(row.brief_versions_json, []);
    const prior = Array.isArray(versions) ? versions : [];
    prior.push({ version: Number(brief.intelligence_version || 1), at: brief.generated_at || row.created_at || now, brief });
    while (prior.length > 5 || JSON.stringify(prior).length > 45000) prior.shift();
    const updateState = allowedState(state, ['AI_DRAFT','OWNER_REVIEW','OWNER_EDITED']) ? 'OWNER_EDITED' : state;
    return {
      ok: true, code: 'CALL_CAPTURED', persist_analysis: true, publish_client: false,
      update_row: { analysis_id: row.analysis_id, review_status: updateState, owner_brief_json: JSON.stringify(nextBrief), brief_versions_json: JSON.stringify(prior), owner_notes_json: JSON.stringify({ confirmed: nextBrief.owner_confirmed_facts, notes: nextBrief.owner_notes }), conversation_outcome: outcome, last_owner_update_at: now },
      pipeline_row: { lead_id: row.lead_id, conversation_outcome: outcome, last_contacted_at: now, next_action: nextStep, next_follow_up_at: nextDate, updated_at: now, last_activity_at: now },
      activity_row: activity(row, now, 'conversation_captured', 'outcome=' + outcome + (nextStep ? '; next=' + nextStep : '') + (nextDate ? '; date=' + nextDate : '')),
      brief: nextBrief, message: 'Разговор сохранён. Исходные ответы клиента не изменены.'
    };
  }

  if (action === 'manual_notify') {
    if (state !== 'CLIENT_READY') return actionError('STATE_CONFLICT', 'Сначала результат должен стать доступен клиенту.');
    const channel = LI.channelKey(body.notification_channel);
    if (!channel) return actionError('CHANNEL_REQUIRED', 'Укажите канал ручного уведомления.');
    return {
      ok: true, code: 'CLIENT_NOTIFIED', persist_analysis: true, publish_client: false,
      update_row: { analysis_id: row.analysis_id, review_status: 'CLIENT_NOTIFIED', customer_notified_at: now, customer_notification_channel: channel, customer_notification_actor: 'owner:review' },
      pipeline_row: { lead_id: row.lead_id, xray_analysis_status: 'CLIENT_NOTIFIED', updated_at: now, last_activity_at: now },
      activity_row: activity(row, now, 'client_notified_manual', 'channel=' + channel),
      message: 'Ручное уведомление зафиксировано.'
    };
  }

  if (action === 'preview_outbound' || action === 'send_outbound') {
    const route = brief && brief.contact && brief.contact.telegram;
    const chatId = route && LI.telegramNumeric(route.route || route.chat_id);
    if (!(route && route.reachable && route.verified && chatId)) return actionError('VERIFIED_TELEGRAM_ROUTE_UNAVAILABLE', 'Подтверждённый Telegram-маршрут недоступен.');
    const message = LI.text(body.outbound_message, 1200);
    if (!message) return actionError('MESSAGE_REQUIRED', 'Введите сообщение клиенту.');
    if (action === 'preview_outbound') {
      return {
        ok: true, code: 'OUTBOUND_PREVIEW', persist_analysis: false, publish_client: false, send_customer: false,
        outbound_preview: { recipient: (brief.header || {}).company || (brief.header || {}).contact_name || 'клиенту', message },
        message: 'Проверьте адресата и текст перед отправкой.'
      };
    }
    return {
      ok: true, code: 'SEND_CUSTOMER', persist_analysis: false, publish_client: false, send_customer: true,
      transport_request: {
        chat_id: String(chatId), text: message, keyboard_layout_id: 'L0_NONE', keyboard_data: { rows: [] },
        parse_mode: '', disable_preview: true,
        correlation_id: String(row.analysis_id || row.lead_id || 'lead') + ':owner-contact:' + Date.parse(now)
      },
      activity_row: activity(row, now, 'outbound_contact', 'Telegram-сообщение отправлено владельцем через Client Transport.', 'telegram'),
      message: 'Сообщение отправляется через FINMENTOR Client Transport.'
    };
  }

  return actionError('UNKNOWN_ACTION', 'Действие не распознано.');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseJson, safeDate, editClientDraft, handleOwnerAction };
