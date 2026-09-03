// POST authenticates an explicit confirmation.  It does not itself mutate any store.
const crypto = require('crypto');
const request = $('Review POST Webhook').first().json;
const body = request.body && typeof request.body === 'object' ? request.body : {};
const analysisId = String(body.a || '').trim().slice(0, 120);
const token = String(body.t || '').trim().slice(0, 80);
const all = $input.all().map(i => i.json);
const storeError = all.some(r => r && r.error);
const row = all.find(r => r && !r.error && String(r.analysis_id || '') === analysisId);
function same(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && x.length === 64 && crypto.timingSafeEqual(x, y); }
let verdict = 'DENIED'; let httpStatus = 403;
if (storeError) { verdict = 'STORE_UNAVAILABLE'; httpStatus = 503; }
else if (analysisId && token && row && same(row.review_token, token) && row.review_token_expires_at && Date.parse(row.review_token_expires_at) > Date.now()) {
  const state = String(row.review_status || '');
  if (state === 'AI_DRAFT' || state === 'CLIENT_READY') { verdict = 'CAS_REQUEST'; httpStatus = 200; }
}
return [{ json: {
  verdict, http_status: httpStatus, analysis_id: analysisId,
  lead_id: row ? String(row.lead_id || '') : '', locale: row && row.locale === 'ro' ? 'ro' : 'ru',
  claim_key: row ? String(row.lead_id || '') + '|' + String(row.analysis_version || '') : '',
  sheet_state: row ? String(row.review_status || '') : '', source_row: row || null
} }];
