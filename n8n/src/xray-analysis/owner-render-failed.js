// FINMENTOR V1 — terminal owner-render failure.
//
// Both bounded normalization attempts failed. Persist one terminal ANALYSIS_FAILED marker under the
// analysis id minted by the valid core pass, keep the canonical request/lead projection stable, and
// let the workflow emit OWNER_RENDER_FAILED. This row is explicitly ineligible for core retries.

function text(value, max) { return String(value == null ? '' : value).trim().slice(0, max || 1000); }
const inputs = $('Build Analysis Input').all().map((item) => item.json);
const items = $input.all();
const now = new Date().toISOString();
const out = [];
for (let index = 0; index < items.length; index++) {
  const item = items[index];
  const value = item.json || {};
  const p = Array.isArray(item.pairedItem) ? item.pairedItem[0] : item.pairedItem;
  const inputIndex = p && typeof p === 'object' && Number.isInteger(p.item) ? p.item
    : (Number.isInteger(p) ? p : index);
  const inp = inputs[inputIndex];
  if (!inp) continue;
  const existing = inp.existing_analysis && typeof inp.existing_analysis === 'object' ? inp.existing_analysis : {};
  const retrying = inp.analysis_mode === 'RETRY_FAILED' && Object.keys(existing).length > 0;
  const upgrading = inp.analysis_mode === 'UPGRADE_EXISTING' && Object.keys(existing).length > 0;
  const analysisId = text(value.analysis_id || (value._owner_render_state || {}).analysis_id || existing.analysis_id, 180);
  const requestScoped = inp.analysis_mode === 'NEW_REQUEST_ANALYSIS'
    || (retrying && String(inp.xray_analysis_id || '') !== analysisId);
  const validationError = ['OWNER_RENDER_FAILED', 'ATTEMPT=2', 'MAX=2', 'ERROR=' + text(value.owner_render_error, 900)]
    .join('|').slice(0, 1200);
  const failureFields = {
    analysis_id: analysisId,
    lead_id: inp.lead_id,
    request_id: inp.request_id || '',
    locale: inp.locale === 'ro' ? 'ro' : 'ru',
    company: text(inp.company, 120),
    created_at: existing.created_at || now,
    analysis_version: inp.analysis_version || 'lead-intelligence-v1',
    model: inp.ai_model || 'gpt-4.1',
    score: inp.score === null || inp.score === undefined ? '' : inp.score,
    zone: inp.zone || 'UNKNOWN',
    maturity_score: '', primary_risk: '', analysis_json: '', owner_brief_json: '',
    client_result_draft_json: '', plan_30d_json: '', review_status: 'ANALYSIS_FAILED',
    reviewed_at: '', review_token: '', review_token_expires_at: '', confidence: '',
    fabrication_flags: '', validation_errors: validationError, source_channel: inp.source_channel || '',
    executive_summary: 'ANALYSIS_FAILED: OWNER_RENDER_FAILED', recommended_next_step: '', next_step_label: '',
    customer_notified_at: '', lead_intelligence_upgrade_status: upgrading ? 'FAILED' : '',
    lead_intelligence_upgrade_errors: validationError
  };
  const row = Object.assign({}, existing, failureFields);
  const pipelineRow = requestScoped ? {
    lead_id: inp.lead_id,
    xray_analysis_id: String(inp.xray_analysis_id || ''),
    xray_score: inp.xray_score === undefined ? '' : inp.xray_score,
    xray_maturity: inp.xray_maturity === undefined ? '' : inp.xray_maturity,
    xray_primary_risk: String(inp.xray_primary_risk || ''),
    xray_analysis_status: String(inp.xray_analysis_status || ''),
    xray_next_step: String(inp.xray_next_step || ''),
    updated_at: now, last_activity_at: now
  } : {
    lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_analysis_status: 'ANALYSIS_FAILED',
    updated_at: now, last_activity_at: now
  };
  out.push({ json: {
    is_valid: false,
    core_analysis_valid: true,
    owner_render_required: false,
    owner_render_failed: true,
    owner_render_attempt: 2,
    owner_render_error: value.owner_render_error,
    notify_owner: false,
    retry_possible: false,
    retry_exhausted: false,
    lead_id: inp.lead_id,
    request_id: inp.request_id || '',
    analysis_id: analysisId,
    analysis_row: row,
    pipeline_row: pipelineRow,
    owner_alert: null,
    owner_text: ''
  }, pairedItem: { item: inputIndex } });
}
return out;

