// FINMENTOR X-Ray Analysis — "Analysis Failed Row".
//
// Error output of the OpenAI node. Writes an ANALYSIS_FAILED ledger row so the lead is not
// re-analysed on every sweep (the owner deletes the row to retry), and an owner notice
// scrubbed of anything but the error class. No prompt, no payload, no identity leaves here.

// __XRAY_OWNER_CARDS__ (inlined by the builder)

const inputs = $('Build Analysis Input').all().map(i => i.json);
const errors = $input.all().map(i => i.json);
const now = new Date().toISOString();
const out = [];

function errorClass(e) {
  const m = String((e && (e.error && (e.error.message || e.error))) || (e && e.message) || '').toLowerCase();
  if (/rate|429|quota|insufficient_quota/.test(m)) return 'RATE_LIMIT';
  if (/401|403|auth|api key|invalid_api_key/.test(m)) return 'AUTH';
  if (/model|404|not found|does not exist/.test(m)) return 'MODEL';
  if (/timeout|timed out|econnreset|502|503|504/.test(m)) return 'UPSTREAM_TRANSIENT';
  return 'UNKNOWN';
}

for (let idx = 0; idx < errors.length; idx++) {
  const inp = inputs[idx];
  if (!inp) continue;
  const klass = errorClass(errors[idx]);
  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + Date.now().toString(36).toUpperCase() + '-F';
  out.push({ json: {
    analysis_row: {
      analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale: inp.locale || 'ru',
      company: String(inp.company || '').slice(0, 120),
      created_at: now, analysis_version: inp.analysis_version || 'xray-v2', model: inp.ai_model || '',
      score: inp.score === null || inp.score === undefined ? '' : inp.score, zone: inp.zone || 'UNKNOWN',
      maturity_score: '', primary_risk: '', analysis_json: '', plan_30d_json: '',
      review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', review_token_expires_at: '', confidence: '',
      fabrication_flags: '', validation_errors: 'UPSTREAM_' + klass, source_channel: inp.source_channel || '', executive_summary: 'ANALYSIS_FAILED: ' + klass,
      recommended_next_step: '', next_step_label: '', customer_notified_at: ''
    },
    is_valid: false,
    // ❌ Анализ не сформирован — the class renders as Russian; no Lead ID, no payload, no prompt.
    owner_text: XRAY_OWNER_CARDS.renderFailed({ company: inp.company, locale: inp.locale, cause: klass }),
    lead_id: inp.lead_id
  } });
}
return out;
