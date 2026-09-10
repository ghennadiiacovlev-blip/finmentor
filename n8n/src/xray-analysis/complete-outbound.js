// FINMENTOR Lead Intelligence v1 — confirm the Telegram Client Transport result.
// Only a confirmed `{ ok: true }` delivery is logged as a successful outbound contact.

// __LEAD_INTELLIGENCE_RENDER__ (inlined by the builder)

const transport = $input.first().json || {};
const verdict = $('Review POST Verdict').first().json || {};
const delivered = transport.ok === true || String(transport.ok).toLowerCase() === 'true';
return [{ json: {
  delivered,
  http_status: delivered ? 200 : 502,
  activity_row: delivered ? verdict.activity_row : null,
  html: delivered
    ? LI_RENDER.renderMessagePage('Сообщение отправлено', 'Доставка через FINMENTOR Client Transport подтверждена.', 'DELIVERED')
    : LI_RENDER.renderMessagePage('Сообщение не отправлено', 'Транспорт не подтвердил доставку. Запись об успешном контакте не создана.', 'DELIVERY_FAILED')
} }];
