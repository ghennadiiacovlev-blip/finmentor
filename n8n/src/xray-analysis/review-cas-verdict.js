// The PostgreSQL compare-and-set is authoritative.  Only an explicit CLIENT_READY state
// allows the idempotent sheet/result projection to run.
const request = $('Review POST Verdict').first().json;
const rows = $input.all().map(i => i.json);
const r = rows.length === 1 ? rows[0] : {};
const state = String(r.authority_status || '');
const casWon = Number(r.cas_won) === 1;
const proceed = request.verdict === 'CAS_REQUEST' && state === 'CLIENT_READY';
const now = new Date().toISOString();
return [{ json: {
  verdict: proceed ? (casWon ? 'PROMOTED' : 'ALREADY_READY') : 'DENIED',
  proceed_update: proceed, http_status: proceed ? 200 : 409,
  update_row: proceed ? { analysis_id: request.analysis_id, review_status: 'CLIENT_READY', reviewed_at: now } : null,
  pipeline_row: proceed ? { lead_id: request.lead_id, xray_analysis_status: 'CLIENT_READY', updated_at: now, last_activity_at: now } : null,
  source_row: request.source_row, locale: request.locale
} }];
