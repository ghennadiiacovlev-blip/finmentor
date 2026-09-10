// FINMENTOR Lead Intelligence v1 — apply CLIENT_NOTIFIED only after confirmed delivery.

// __LEAD_INTELLIGENCE_NOTIFICATION__ (inlined by the builder)
// __LEAD_INTELLIGENCE_RENDER__ (inlined by the builder)

const transport = $input.first().json || {};
const verdict = $('Review POST Verdict').first().json || {};
const delivered = transport.ok === true || String(transport.ok).toLowerCase() === 'true';
const state = LI_NOTIFY.notificationState(verdict.source_row || {}, delivered ? Object.assign({}, transport, { ok: true }) : { ok: false }, new Date().toISOString());
return [{ json: {
  delivered: state.updated === true,
  update_row: state.update_row,
  pipeline_row: state.pipeline_row,
  activity_row: state.activity_row,
  http_status: 200,
  html: state.updated
    ? LI_RENDER.renderMessagePage('Клиент уведомлён', 'Результат доступен, доставка в Telegram подтверждена.', 'CLIENT_NOTIFIED')
    : LI_RENDER.renderMessagePage('Результат готов', 'Автоматическая доставка не подтверждена. Результат остаётся доступным; уведомите клиента вручную.', 'CLIENT_READY')
} }];
