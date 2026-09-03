// FINMENTOR X-Ray Analysis — "Render Review Surface".
//
// GET /webhook/finmentor-xray-review?a=<analysis_id>&t=<review_token>
//
// READ-ONLY. Renders the draft for the owner and an explicit confirmation form that POSTs the
// same two parameters back. Nothing here mutates a store: a Telegram link preview, a proxy
// prefetch or a mistaken tap sees a page, not a promotion. The same per-row token, compared in
// constant time and bounded in time, gates the page; a wrong or expired link sees nothing.
//
// Input: $input = XRay_Analysis rows matching analysis_id (0..1), $('Review GET Webhook') = query.

const crypto = require('crypto');
const q = ($('Review GET Webhook').first().json || {}).query || {};
const analysisId = String(q.a || '').trim().slice(0, 120);
const token = String(q.t || '').trim().slice(0, 80);
const all = $input.all().map(i => i.json);
const storeError = all.some(r => r && (r.error || r.errorMessage));
const row = all.find(r => r && !r.error && !r.errorMessage && String(r.analysis_id || '') === analysisId);

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length || x.length < 32) return false;
  return crypto.timingSafeEqual(x, y);
}
function expired(r) {
  const t = Date.parse(String(r.review_token_expires_at || ''));
  return !Number.isFinite(t) || t <= Date.now();
}
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function shell(title, body) {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf3;margin:0;padding:24px;line-height:1.5}main{max-width:760px;margin:auto;background:#111a2e;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 12px}h2{font-size:17px;margin:18px 0 8px}h3{font-size:15px;margin:14px 0 6px;color:#b8c4d6}section{border-top:1px solid #26334d;padding-top:14px;margin-top:14px}p{margin:0 0 8px;color:#b8c4d6}li{margin:0 0 6px}button{background:#35c47c;color:#06120c;border:0;border-radius:9px;padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer}.meta{color:#8b98ad;font-size:13px}</style></head><body><main><h1>' + esc(title) + '</h1>' + body + '</main></body></html>';
}

let status = 403; let html;
if (storeError) {
  status = 503; html = shell('FINMENTOR · Временно недоступно', '<p>Не удалось проверить хранилище. Повторите позже.</p>');
} else if (!analysisId || !token || !row || !same(row.review_token, token) || expired(row) || !['AI_DRAFT', 'CLIENT_READY'].includes(String(row.review_status || ''))) {
  html = shell('FINMENTOR · Доступ отклонён', '<p>Ссылка недействительна, истекла или анализ недоступен.</p>');
} else if (String(row.review_status) === 'CLIENT_READY') {
  status = 200; html = shell('FINMENTOR · Уже готово', '<p>Этот анализ уже был подтверждён и открыт клиенту.</p><p class="meta">Lead ID: ' + esc(row.lead_id) + '</p>');
} else {
  let a = {}; try { a = JSON.parse(String(row.analysis_json || '{}')) || {}; } catch (e) { a = {}; }
  const list = (items, f) => Array.isArray(items) && items.length ? '<ul>' + items.map(f).join('') + '</ul>' : '<p>—</p>';
  const risks = list(a.key_risks, r => '<li><strong>' + esc(r && r.title) + '</strong> (' + esc(r && r.priority) + '): ' + esc(r && r.evidence) + '</li>');
  const priorities = list(a.management_priorities, p => '<li>' + esc(p) + '</li>');
  const tomorrow = list(a.tomorrow_actions, p => '<li>' + esc(p) + '</li>');
  const plan = a.plan_30_days && typeof a.plan_30_days === 'object'
    ? Object.entries(a.plan_30_days).map(([k, actions]) => '<h3>' + esc(k) + '</h3>' + list(actions, x => '<li>' + esc(x && x.action) + ' — ' + esc(x && x.expected_output) + '</li>')).join('')
    : '<p>—</p>';
  const fm = a.financial_maturity || {};
  const head = '<p class="meta">Lead ID: ' + esc(row.lead_id) + ' · Язык клиента: ' + (row.locale === 'ro' ? 'RO' : 'RU') + ' · Оценка: ' + esc(row.score === '' ? 'нет данных' : row.score + ' из 100') + ' · Зона: ' + esc(row.zone) + ' · Достоверность: ' + esc(row.confidence) + (row.fabrication_flags ? ' · ⚠️ проверить цифры: ' + esc(row.fabrication_flags) : '') + '</p>';
  const review = '<section><h2>Предварительный анализ</h2><p>' + esc(a.executive_summary) + '</p><h3>Зрелость финансового управления: ' + esc(fm.score_1_to_5) + ' из 5 — ' + esc(fm.label) + '</h3><p>' + esc(fm.rationale) + '</p><h2>Ключевые риски</h2>' + risks + '<h2>Приоритеты управления</h2>' + priorities + '<h2>План на 30 дней</h2>' + plan + '<h2>Действия на завтра</h2>' + tomorrow + '<h2>Следующий шаг</h2><p>' + esc((a.recommended_next_step || {}).label) + ' — ' + esc((a.recommended_next_step || {}).rationale) + '</p></section>';
  const form = '<section><form method="post" action=""><input type="hidden" name="a" value="' + esc(analysisId) + '"><input type="hidden" name="t" value="' + esc(token) + '"><p>Подтверждение открывает результат клиенту в Mini App. Отменить это действие нельзя.</p><p><button type="submit">Подтвердить и открыть клиенту</button></p></form></section>';
  status = 200; html = shell('FINMENTOR · Проверка анализа', head + review + form);
}
return [{ json: { http_status: status, html } }];
