// FINMENTOR X-Ray Analysis — "Analysis Failed Row".
//
// Error output of the OpenAI node. Writes an ANALYSIS_FAILED ledger row so the lead is not
// re-analysed on every sweep (the owner deletes the row to retry), and an owner notice
// scrubbed of anything but the error class. No prompt, no payload, no identity leaves here.

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
      created_at: now, analysis_version: 'xray-v1', model: inp.ai_model || '',
      score: inp.score === null || inp.score === undefined ? '' : inp.score, zone: inp.zone || 'UNKNOWN',
      maturity_score: '', primary_risk: '', analysis_json: '', plan_30d_json: '',
      review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', confidence: 'LOW',
      fabrication_flags: '', source_channel: inp.source_channel || '', executive_summary: 'ANALYSIS_FAILED: ' + klass,
      recommended_next_step: '', next_step_label: '', customer_notified_at: ''
    },
    owner_text: 'ФИНАНСОВЫЙ РЕНТГЕН · АНАЛИЗ НЕ ВЫПОЛНЕН\n\nКомпания: ' + (inp.company || '—') + '\nКласс ошибки: ' + klass + '\nLead ID: ' + inp.lead_id + '\n\nСтрока ' + analysisId + ' записана в XRay_Analysis со статусом ANALYSIS_FAILED. Удалите её, чтобы повторить анализ.',
    lead_id: inp.lead_id
  } });
}
return out;
