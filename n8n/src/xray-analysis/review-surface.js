// GET is read-only.  It renders the analysis and an explicit POST confirmation form.
const crypto = require('crypto');
const q = ($('Review GET Webhook').first().json.query) || {};
const analysisId = String(q.a || '').trim().slice(0, 120);
const token = String(q.t || '').trim().slice(0, 80);
const all = $input.all().map(i => i.json);
const storeError = all.some(r => r && r.error);
const row = all.find(r => r && !r.error && String(r.analysis_id || '') === analysisId);
function same(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && x.length === 64 && crypto.timingSafeEqual(x, y); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function shell(title, body) { return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title><style>body{font-family:system-ui;background:#0b1220;color:#e6edf3;margin:0;padding:24px;line-height:1.5}main{max-width:760px;margin:auto;background:#111a2e;border-radius:16px;padding:28px}section{border-top:1px solid #26334d;padding-top:14px;margin-top:14px}button{background:#35c47c;border:0;border-radius:9px;padding:12px 18px;font-weight:700}pre{white-space:pre-wrap}</style></head><body><main><h1>' + esc(title) + '</h1>' + body + '</main></body></html>'; }
let status = 403; let html;
const expired = row && (!row.review_token_expires_at || Date.parse(row.review_token_expires_at) <= Date.now());
if (storeError) { status = 503; html = shell('FINMENTOR · Временно недоступно', '<p>Не удалось проверить хранилище. Повторите позже.</p>'); }
else if (!analysisId || !token || !row || !same(row.review_token, token) || expired || !['AI_DRAFT', 'CLIENT_READY'].includes(String(row.review_status))) {
  html = shell('FINMENTOR · Доступ отклонён', '<p>Ссылка недействительна, истекла или анализ недоступен.</p>');
} else if (String(row.review_status) === 'CLIENT_READY') {
  status = 200; html = shell('FINMENTOR · Уже готово', '<p>Этот анализ уже был подтверждён.</p>');
} else {
  let analysis = {}; try { analysis = JSON.parse(String(row.analysis_json || '{}')); } catch (e) { analysis = {}; }
  const risks = Array.isArray(analysis.key_risks) ? analysis.key_risks.map(r => '<li><strong>' + esc(r.title) + '</strong>: ' + esc(r.evidence) + '</li>').join('') : '';
  const weeks = analysis.plan_30_days && typeof analysis.plan_30_days === 'object' ? Object.entries(analysis.plan_30_days).map(([k, actions]) => '<section><h3>' + esc(k) + '</h3><ul>' + (Array.isArray(actions) ? actions.map(a => '<li>' + esc(a.action) + ' — ' + esc(a.expected_output) + '</li>').join('') : '') + '</ul></section>').join('') : '';
  const review = '<section><h2>Предварительный анализ</h2><p>' + esc(analysis.executive_summary) + '</p><ul>' + risks + '</ul>' + weeks + '</section>';
  const form = '<form method="post" action=""><input type="hidden" name="a" value="' + esc(analysisId) + '"><input type="hidden" name="t" value="' + esc(token) + '"><p><button type="submit">Подтвердить CLIENT_READY</button></p></form>';
  status = 200; html = shell('FINMENTOR · Проверка анализа', review + form);
}
return [{ json: { http_status: status, html } }];
