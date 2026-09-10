// FINMENTOR Lead Intelligence v1 — explicit owner POST actions.
//
// Token authority is per analysis, time-bounded and compared in constant time. GET never reaches
// this node. Source facts remain immutable; only the derived brief, curated client draft and the
// narrow Pipeline/Activities projections may be updated.

// __LEAD_INTELLIGENCE_ACTIONS__ (inlined by the builder)
// __LEAD_INTELLIGENCE_RENDER__ (inlined by the builder)

const crypto = require('crypto');
const request = $('Review POST Webhook').first().json || {};
const body = request.body && typeof request.body === 'object' ? request.body : {};
const analysisId = String(body.a || '').trim().slice(0, 120);
const token = String(body.t || '').trim().slice(0, 80);
// Compatibility for already-issued review forms: an authenticated POST without an action means
// approve. Newly rendered forms always state their action explicitly.
if (!body.action) body.action = 'approve';
const all = $input.all().map((i) => i.json || {});
const storeError = all.some((r) => r.error || r.errorMessage);
const row = all.find((r) => !r.error && !r.errorMessage && String(r.analysis_id || '') === analysisId);

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length || x.length < 32) return false;
  return crypto.timingSafeEqual(x, y);
}
function expired(r) {
  const t = Date.parse(String((r || {}).review_token_expires_at || ''));
  return !Number.isFinite(t) || t <= Date.now();
}

let result;
if (storeError) {
  result = { ok: false, code: 'STORE_UNAVAILABLE', message: 'Не удалось проверить хранилище. Повторите позже.', persist_analysis: false, publish_client: false };
} else if (!analysisId || !token || !row || !same(row.review_token, token) || expired(row) || String(row.review_status || '') === 'ANALYSIS_FAILED') {
  result = { ok: false, code: 'DENIED', message: 'Ссылка недействительна, истекла или анализ недоступен.', persist_analysis: false, publish_client: false };
} else {
  result = LI_ACTIONS.handleOwnerAction({ row, body, now: new Date().toISOString() });
}

const status = result.ok ? 200 : result.code === 'STORE_UNAVAILABLE' ? 503 : result.code === 'DENIED' ? 403 : 409;
const titles = {
  OWNER_EDITED: 'Изменения сохранены', CLIENT_READY: 'Готово для клиента', ALREADY_READY: 'Уже готово',
  CALL_CAPTURED: 'Разговор сохранён', CLIENT_NOTIFIED: 'Уведомление сохранено', DENIED: 'Доступ отклонён',
  STORE_UNAVAILABLE: 'Временно недоступно'
};
const auth = { analysis_id: analysisId, token };
const html = result.code === 'OUTBOUND_PREVIEW'
  ? LI_RENDER.renderOutboundConfirm(result.outbound_preview, auth)
  : LI_RENDER.renderMessagePage(titles[result.code] || (result.ok ? 'Готово' : 'Действие не выполнено'), result.message, result.code || '');

return [{ json: Object.assign({}, result, {
  verdict: result.code,
  proceed_update: result.persist_analysis === true,
  http_status: status,
  analysis_id: analysisId,
  lead_id: row ? String(row.lead_id || '') : '',
  source_row: result.ok ? row : null,
  html
}) }];
