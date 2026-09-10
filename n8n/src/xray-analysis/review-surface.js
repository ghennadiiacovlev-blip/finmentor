// FINMENTOR Lead Intelligence v1 — owner review GET surface.
//
// GET is strictly read-only. The per-analysis token remains bounded and is compared in constant
// time before any owner data is rendered. All writes require an explicit POST action.

// __LEAD_INTELLIGENCE_RENDER__ (inlined by the builder)

const crypto = require('crypto');
const request = $('Review GET Webhook').first().json || {};
const q = request.query && typeof request.query === 'object' ? request.query : {};
const analysisId = String(q.a || '').trim().slice(0, 120);
const token = String(q.t || '').trim().slice(0, 80);
const view = ['brief','contact','edit','preview'].includes(String(q.view || '')) ? String(q.view) : 'brief';
const all = $input.all().map((i) => i.json || {});
const storeError = all.some((r) => r.error || r.errorMessage);
const matches = all.filter((r) => !r.error && !r.errorMessage && String(r.analysis_id || '') === analysisId);
const row = matches.length === 1 ? matches[0] : null;

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length || x.length < 32) return false;
  return crypto.timingSafeEqual(x, y);
}
function expired(r) {
  const t = Date.parse(String((r || {}).review_token_expires_at || ''));
  return !Number.isFinite(t) || t <= Date.now();
}
function parse(value, fallback) {
  try { const v = JSON.parse(String(value || '')); return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback; }
  catch (e) { return fallback; }
}

const allowedStates = ['AI_DRAFT','OWNER_REVIEW','OWNER_EDITED','CLIENT_READY','CLIENT_NOTIFIED','CLIENT_VIEWED'];
let status = 403; let html;
if (storeError) {
  status = 503;
  html = LI_RENDER.renderMessagePage('Временно недоступно', 'Не удалось проверить хранилище. Повторите позже.', '');
} else if (!analysisId || !token || !row || !same(row.review_token, token) || expired(row) || !allowedStates.includes(String(row.review_status || ''))) {
  html = LI_RENDER.renderMessagePage('Доступ отклонён', 'Ссылка недействительна, истекла или анализ недоступен.', '');
} else {
  const analysis = parse(row.analysis_json, {});
  const brief = parse(row.owner_brief_json, analysis.owner_brief || {});
  const clientDraft = parse(row.client_result_draft_json, analysis);
  brief.client_result_eligible = row.client_result_eligible === true;
  const actualView = !brief.client_result_eligible && (view === 'edit' || view === 'preview') ? 'brief' : view;
  status = 200;
  html = LI_RENDER.renderOwnerBriefPage({
    brief, client_draft: clientDraft, row, mode: actualView,
    auth: { analysis_id: analysisId, token }
  });
}

return [{ json: { http_status: status, html } }];
