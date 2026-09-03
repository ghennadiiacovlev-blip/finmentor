// FINMENTOR X-Ray Analysis — "Review Verdict".
//
// GET /webhook/finmentor-xray-review?a=<analysis_id>&t=<review_token>
//
// The owner's review action for v1: one tap on the Telegram alert button promotes the
// analysis AI_DRAFT -> CLIENT_READY. Authority is the per-row single-purpose token minted
// when the row was written; there is no shared secret and a leaked link exposes exactly one
// analysis. Compared in constant time. Idempotent: a second tap answers "already ready".
//
// Input: $input = XRay_Analysis rows matching analysis_id (0..1), $('Review Webhook') = query.

const crypto = require('crypto');
const q = ($('Review Webhook').first().json.query) || {};
const analysisId = String(q.a || '').trim().slice(0, 120);
const token = String(q.t || '').trim().slice(0, 80);
const rows = $input.all().map(i => i.json).filter(r => r && !r.error && String(r.analysis_id || '') === analysisId);
const row = rows[0];

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

let verdict = 'DENIED';
if (!analysisId || !token || !row) verdict = 'DENIED';
else if (!same(row.review_token, token)) verdict = 'DENIED';
else if (String(row.review_status) === 'CLIENT_READY') verdict = 'ALREADY_READY';
else if (String(row.review_status) === 'ANALYSIS_FAILED') verdict = 'DENIED';
else verdict = 'PROMOTE';

const now = new Date().toISOString();
const page = (title, body) => '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + title + '</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf3;margin:0;padding:32px;line-height:1.5}main{max-width:520px;margin:0 auto;background:#111a2e;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{margin:0 0 8px;color:#b8c4d6}code{color:#e6edf3}</style></head><body><main><h1>' + title + '</h1>' + body + '</main></body></html>';

return [{ json: {
  verdict,
  analysis_id: analysisId,
  lead_id: row ? String(row.lead_id || '') : '',
  locale: row ? String(row.locale || 'ru') : 'ru',
  reviewed_at: now,
  update_row: verdict === 'PROMOTE' ? { analysis_id: analysisId, review_status: 'CLIENT_READY', reviewed_at: now } : null,
  pipeline_row: verdict === 'PROMOTE' ? { lead_id: String(row.lead_id || ''), xray_analysis_status: 'CLIENT_READY', updated_at: now, last_activity_at: now } : null,
  http_status: verdict === 'DENIED' ? 403 : 200,
  html: verdict === 'PROMOTE'
    ? page('FINMENTOR · Готово для клиента', '<p>Анализ переведён в статус <code>CLIENT_READY</code>.</p><p>Lead ID: <code>' + String(row.lead_id || '') + '</code></p><p>Клиент сможет открыть результат в Mini App; уведомление отправит бот.</p>')
    : verdict === 'ALREADY_READY'
      ? page('FINMENTOR · Уже готово', '<p>Этот анализ уже был открыт клиенту ранее.</p><p>Lead ID: <code>' + String(row.lead_id || '') + '</code></p>')
      : page('FINMENTOR · Доступ отклонён', '<p>Ссылка недействительна или анализ не найден.</p>')
} }];
