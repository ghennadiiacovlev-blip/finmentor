// FINMENTOR X-Ray Analysis — "Review POST Verdict".
//
// POST /webhook/finmentor-xray-review   body: a=<analysis_id>&t=<review_token>
//
// The owner's review action. The Telegram alert button opens the GET page (read-only: it
// renders the draft and a confirmation form and mutates nothing — a link preview, a proxy or a
// curious tap cannot promote anything). The form POSTs here, and only here does AI_DRAFT
// become CLIENT_READY. (C3 correction review, 2026-09-03: the C1 one-tap GET promotion was a
// state-changing GET and is retired.)
//
// Authority is the per-row single-purpose token minted when the row was written — 32 random
// bytes, bounded by review_token_expires_at — compared in constant time. There is no shared
// secret and a leaked link exposes exactly one analysis for a bounded time. Idempotent: a second
// confirmation answers ALREADY_READY and re-runs the customer-result publication, so a
// publication that failed after the sheet moved is repaired by tapping again.
//
// Input: $input = XRay_Analysis rows matching analysis_id (0..1), $('Review POST Webhook') = body.

// __XRAY_OWNER_CARDS__ (inlined by the builder)

const crypto = require('crypto');
const request = $('Review POST Webhook').first().json || {};
const body = request.body && typeof request.body === 'object' ? request.body : {};
const analysisId = String(body.a || '').trim().slice(0, 120);
const token = String(body.t || '').trim().slice(0, 80);
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

let verdict = 'DENIED'; let httpStatus = 403;
if (storeError) { verdict = 'STORE_UNAVAILABLE'; httpStatus = 503; }
else if (analysisId && token && row && same(row.review_token, token) && !expired(row)) {
  const state = String(row.review_status || '');
  if (state === 'AI_DRAFT') { verdict = 'PROMOTE'; httpStatus = 200; }
  else if (state === 'CLIENT_READY') { verdict = 'ALREADY_READY'; httpStatus = 200; }
}
const proceed = verdict === 'PROMOTE' || verdict === 'ALREADY_READY';

const now = new Date().toISOString();
const reviewedAt = verdict === 'ALREADY_READY' && row && String(row.reviewed_at || '') !== '' ? String(row.reviewed_at) : now;
const page = (title, body) => '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' + title + '</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e6edf3;margin:0;padding:32px;line-height:1.5}main{max-width:520px;margin:0 auto;background:#111a2e;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{margin:0 0 8px;color:#b8c4d6}code{color:#e6edf3}</style></head><body><main><h1>' + title + '</h1>' + body + '</main></body></html>';
const leadIdSafe = row ? String(row.lead_id || '').replace(/[<>&"']/g, '') : '';

return [{ json: {
  verdict,
  proceed_update: proceed,
  http_status: httpStatus,
  analysis_id: analysisId,
  lead_id: row ? String(row.lead_id || '') : '',
  locale: row && row.locale === 'ro' ? 'ro' : 'ru',
  reviewed_at: reviewedAt,
  update_row: proceed ? { analysis_id: analysisId, review_status: 'CLIENT_READY', reviewed_at: reviewedAt } : null,
  pipeline_row: proceed ? { lead_id: String(row.lead_id || ''), xray_analysis_status: 'CLIENT_READY', updated_at: now, last_activity_at: now } : null,
  source_row: proceed ? row : null,
  // ✅ Анализ подтверждён — the ONE follow-up message, sent only on the first promotion (a repeated
  // confirmation is ALREADY_READY and stays silent). Rendered here, sent by the Telegram node the
  // builder places after the HTTP response; '' when there is nothing to announce.
  notify_owner: verdict === 'PROMOTE',
  owner_approved_text: verdict === 'PROMOTE' ? XRAY_OWNER_CARDS.renderApproved({ company: row.company, locale: row.locale }) : '',
  html: verdict === 'PROMOTE'
    ? page('FINMENTOR · Готово для клиента', '<p>Анализ подтверждён и открыт клиенту в Mini App.</p><p>Lead ID: <code>' + leadIdSafe + '</code></p>')
    : verdict === 'ALREADY_READY'
      ? page('FINMENTOR · Уже готово', '<p>Этот анализ уже был открыт клиенту ранее.</p><p>Lead ID: <code>' + leadIdSafe + '</code></p>')
      : verdict === 'STORE_UNAVAILABLE'
        ? page('FINMENTOR · Временно недоступно', '<p>Не удалось проверить хранилище. Повторите позже.</p>')
        : page('FINMENTOR · Доступ отклонён', '<p>Ссылка недействительна, истекла или анализ не найден.</p>')
} }];
