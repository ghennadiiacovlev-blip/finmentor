// FINMENTOR Lead Intelligence v1 — customer notification request and truthful state update.
'use strict';

function clientNotification(input) {
  const i = input || {}; const row = i.row || {}; const brief = i.brief || {}; const contact = brief.contact || {};
  if (String(row.review_status) !== 'CLIENT_READY' || brief.client_result_eligible !== true) return { eligible: false, reason: 'RESULT_NOT_READY_OR_NOT_ELIGIBLE' };
  const route = contact.telegram && contact.telegram.verified ? String(contact.telegram.route || '') : '';
  if (!/^\d{5,20}$/.test(route)) return { eligible: false, reason: 'VERIFIED_TELEGRAM_ROUTE_UNAVAILABLE' };
  const url = String(i.client_result_url || '').trim();
  if (!/^https:\/\/\S{3,}$/.test(url)) return { eligible: false, reason: 'CLIENT_RESULT_URL_UNAVAILABLE' };
  const ro = row.locale === 'ro';
  const text = ro
    ? 'Analiza dumneavoastră financiară FINMENTOR este gata.\n\nAm pregătit concluziile principale, riscurile-cheie și acțiunile următoare recomandate.'
    : 'Ваш финансовый разбор FINMENTOR готов.\n\nМы подготовили основные выводы, ключевые риски и рекомендуемые следующие действия.';
  return {
    eligible: true,
    request: {
      chat_id: route, text, keyboard_layout_id: 'L1_W',
      keyboard_data: { rows: [[{ text: ro ? 'Deschide analiza' : 'Открыть разбор', web_app: { url } }]] },
      disable_preview: true,
      correlation_id: 'xray-ready:' + String(row.analysis_id || '').slice(0, 80)
    }
  };
}

function notificationState(row, result, now) {
  if (!result || result.ok !== true) return { updated: false, update_row: null, activity_row: null };
  const at = now || new Date().toISOString();
  return {
    updated: true,
    update_row: { analysis_id: row.analysis_id, review_status: 'CLIENT_NOTIFIED', customer_notified_at: at, customer_notification_channel: 'telegram', customer_notification_actor: 'system:client_transport' },
    pipeline_row: { lead_id: row.lead_id, xray_analysis_status: 'CLIENT_NOTIFIED', updated_at: at, last_activity_at: at },
    activity_row: { activity_id: String(row.lead_id || 'lead') + '-notify-' + Date.parse(at), ts: at, lead_id: row.lead_id, actor: 'system:client_transport', channel: 'telegram', action: 'client_notified', detail: 'delivery confirmed; message_id=' + String(result.message_id || '').slice(0, 40) }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { clientNotification, notificationState };
