// FINMENTOR X-Ray Analysis — "Analysis Failed Row".
//
// Error output of the OpenAI node. Writes/updates one ANALYSIS_FAILED ledger row with a bounded
// retry instruction. The owner never has to edit Sheets; technical evidence stays in the ledger.

// __XRAY_OWNER_CARDS__ (inlined by the builder)

const inputs = $('Build Analysis Input').all().map(i => i.json);
const errors = $input.all().map(i => i.json);
const now = new Date().toISOString();
const out = [];
const RETRY_MAX = 3;

function messageOf(e) {
  return String((e && (e.error && (e.error.message || e.error))) || (e && e.message) || '').trim();
}
function safeErrorText(e) {
  return messageOf(e).slice(0, 500)
    .replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/\S+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[contact]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[token]')
    .replace(/\b(?:sk|rk|sess)-[A-Za-z0-9_-]{12,}\b/gi, '[token]')
    .replace(/((?:api[_ -]?key|authorization|token|secret)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .replace(/(?<![\w-])\+?\d[\d\s().-]{8,13}\d(?![\w-])/g, '[contact]');
}
function attemptOf(row) {
  const m = /(?:^|[|;])ATTEMPT=(\d+)/i.exec(String((row || {}).validation_errors || ''));
  const n = m ? Number(m[1]) : 1;
  return Number.isInteger(n) && n > 0 ? n : 1;
}
function retryDelayMs(attempt) { return attempt <= 1 ? 5 * 60 * 1000 : 30 * 60 * 1000; }
function contactText(inp) {
  const c = ((inp || {}).owner_context || {}).contact || {};
  const channels = Array.isArray(c.reachable_channels) ? c.reachable_channels : [];
  const chosen = channels.find((x) => x && x.key === c.preferred_contact_channel && String(x.value || '').trim())
    || channels.find((x) => x && String(x.value || '').trim());
  return chosen ? String(chosen.label || 'Контакт').slice(0, 40) + ': ' + String(chosen.value || '').trim().slice(0, 120) : '';
}

function errorClass(e) {
  const m = messageOf(e).toLowerCase();
  if (/rate|429|quota|insufficient_quota|too many requests|overload|capacity/.test(m)) return 'RATE_LIMIT';
  if (/401|403|auth|api key|invalid_api_key/.test(m)) return 'AUTH';
  if (/model|404|not found|does not exist/.test(m)) return 'MODEL';
  if (/timeout|timed out|econnreset|502|503|504/.test(m)) return 'UPSTREAM_TRANSIENT';
  return 'UNKNOWN';
}

for (let idx = 0; idx < errors.length; idx++) {
  const inp = inputs[idx];
  if (!inp) continue;
  const klass = errorClass(errors[idx]);
  const upgrading = inp.analysis_mode === 'UPGRADE_EXISTING' && inp.existing_analysis && typeof inp.existing_analysis === 'object';
  const retrying = inp.analysis_mode === 'RETRY_FAILED' && inp.existing_analysis && typeof inp.existing_analysis === 'object';
  const existing = upgrading || retrying ? inp.existing_analysis : {};
  const analysisId = upgrading || retrying ? String(existing.analysis_id || '') : 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + Date.now().toString(36).toUpperCase() + '-F';
  const attempt = retrying ? attemptOf(existing) + 1 : 1;
  const exhausted = !upgrading && attempt >= RETRY_MAX;
  const next = exhausted || upgrading ? '' : new Date(Date.parse(now) + retryDelayMs(attempt)).toISOString();
  const detail = safeErrorText(errors[idx]) || 'upstream error without message';
  const currentEvidence = ['UPSTREAM_' + klass, 'ATTEMPT=' + attempt, 'MAX=' + RETRY_MAX]
    .concat(next ? ['NEXT=' + next] : [], ['ERROR=' + detail]).join('|').slice(0, 1200);
  const priorEvidence = String(existing.lead_intelligence_upgrade_errors || existing.validation_errors || '').slice(0, 1200);
  const retryHistory = [priorEvidence, currentEvidence].filter(Boolean).join(' || ').slice(-1200);
  const failureRow = {
    analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale: inp.locale || 'ru',
    company: String(inp.company || '').slice(0, 120),
    created_at: retrying ? existing.created_at || now : now, analysis_version: inp.analysis_version || 'lead-intelligence-v1', model: inp.ai_model || '',
    score: inp.score === null || inp.score === undefined ? '' : inp.score, zone: inp.zone || 'UNKNOWN',
    maturity_score: '', primary_risk: '', analysis_json: '', plan_30d_json: '',
    review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', review_token_expires_at: '', confidence: '',
    fabrication_flags: '', validation_errors: currentEvidence, source_channel: inp.source_channel || '', executive_summary: 'ANALYSIS_FAILED: ' + klass,
    recommended_next_step: '', next_step_label: '', customer_notified_at: '', lead_intelligence_upgrade_errors: retryHistory
  };
  const analysisRow = upgrading ? Object.assign({}, existing, {
    analysis_id: analysisId,
    lead_intelligence_upgrade_status: 'FAILED',
    lead_intelligence_upgrade_attempted_at: now,
    lead_intelligence_upgrade_errors: 'UPSTREAM_' + klass
  }) : Object.assign({}, existing, failureRow);
  out.push({ json: {
    analysis_row: analysisRow,
    analysis_mode: upgrading ? 'UPGRADE_EXISTING' : (retrying ? 'RETRY_FAILED' : 'NEW_ANALYSIS'),
    is_valid: false,
    notify_owner: !retrying,
    retry_attempt: attempt,
    retry_exhausted: exhausted,
    error_class: klass,
    // The cause stays in the ledger/System Alert. The owner receives business-safe recovery copy.
    owner_text: XRAY_OWNER_CARDS.renderFailed({
      company: inp.company, locale: inp.locale, lead_id: inp.lead_id,
      contact_text: contactText(inp), next_action: ((inp.owner_context || {}).next_action || ''),
      retry_exhausted: exhausted
    }),
    pipeline_row: {
      lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_analysis_status: 'ANALYSIS_FAILED',
      updated_at: now, last_activity_at: now
    },
    lead_id: inp.lead_id,
    analysis_id: analysisId
  } });
}
return out;
