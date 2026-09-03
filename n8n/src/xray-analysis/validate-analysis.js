// FINMENTOR X-Ray Analysis — strict model-output validator.
//
// A model response has only two outcomes:
//   valid contract -> AI_DRAFT (human review required)
//   any parse/schema/factual-contract failure -> ANALYSIS_FAILED (never promotable)
// Score and zone are copied only from Build Analysis Input.

// __XRAY_LABELS__ (inlined by the builder)

const crypto = require('crypto');
const ANALYSIS_VERSION = 'xray-v2';
const REQUIRED_TOP = [
  'executive_summary', 'financial_maturity', 'key_risks', 'data_gaps',
  'management_priorities', 'plan_30_days', 'tomorrow_actions',
  'documents_required', 'recommended_next_step', 'confidence', 'limitations'
];
const WEEKS = ['days_1_7', 'days_8_14', 'days_15_21', 'days_22_30'];
const LEVELS = ['HIGH', 'MEDIUM', 'LOW'];

function plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function validString(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max; }
function boundedString(v, max) { return String(v).trim().slice(0, max); }
function exactKeys(obj, required, optional) {
  if (!plainObject(obj)) return false;
  const allowed = new Set(required.concat(optional || []));
  return required.every(k => Object.prototype.hasOwnProperty.call(obj, k)) && Object.keys(obj).every(k => allowed.has(k));
}
function extractText(ai) {
  let c = ai.output?.[0]?.content?.[0]?.text ?? ai.output_text ?? ai.text ?? ai.response ?? ai.message?.content ?? ai.choices?.[0]?.message?.content ?? ai.content ?? '';
  if (Array.isArray(ai.output)) {
    const msg = ai.output.find(o => o && o.type === 'message' && Array.isArray(o.content));
    if (msg) {
      const t = msg.content.find(x => x && (x.type === 'output_text' || typeof x.text === 'string'));
      if (t && typeof t.text === 'string') c = t.text;
    }
  }
  return typeof c === 'string' ? c.trim() : '';
}

function validateAction(value, at, errors) {
  const keys = ['action', 'owner_role', 'expected_output', 'control_or_kpi', 'priority'];
  if (!exactKeys(value, keys)) { errors.push(at + ': invalid action shape'); return null; }
  for (const key of keys.slice(0, 4)) if (!validString(value[key], key === 'owner_role' ? 80 : 300)) errors.push(at + '.' + key + ': required bounded string');
  if (!LEVELS.includes(value.priority)) errors.push(at + '.priority: invalid');
  if (errors.some(e => e.startsWith(at + '.'))) return null;
  return {
    action: boundedString(value.action, 300), owner_role: boundedString(value.owner_role, 80),
    expected_output: boundedString(value.expected_output, 300), control_or_kpi: boundedString(value.control_or_kpi, 300),
    priority: value.priority
  };
}

function validateContract(plan, locale) {
  const errors = [];
  if (!exactKeys(plan, REQUIRED_TOP)) return { ok: false, errors: ['top-level schema mismatch'] };
  if (!validString(plan.executive_summary, 2500)) errors.push('executive_summary: required bounded string');

  const fm = plan.financial_maturity;
  if (!exactKeys(fm, ['score_1_to_5', 'label', 'rationale'])) errors.push('financial_maturity: invalid shape');
  else {
    if (!Number.isInteger(fm.score_1_to_5) || fm.score_1_to_5 < 1 || fm.score_1_to_5 > 5) errors.push('financial_maturity.score_1_to_5: invalid');
    if (!validString(fm.label, 120) || !validString(fm.rationale, 800)) errors.push('financial_maturity: label/rationale required');
  }

  if (!Array.isArray(plan.key_risks) || plan.key_risks.length < 1 || plan.key_risks.length > 5) errors.push('key_risks: require 1-5 rows');
  const risks = [];
  for (const [i, risk] of (Array.isArray(plan.key_risks) ? plan.key_risks : []).entries()) {
    const at = 'key_risks[' + i + ']';
    if (!exactKeys(risk, ['category', 'title', 'evidence', 'potential_impact', 'priority'])) { errors.push(at + ': invalid shape'); continue; }
    if (![risk.category, risk.title, risk.evidence, risk.potential_impact].every(v => validString(v, 500))) errors.push(at + ': strings required');
    if (!LEVELS.includes(risk.priority)) errors.push(at + '.priority: invalid');
    risks.push({ category: boundedString(risk.category, 80), title: boundedString(risk.title, 160), evidence: boundedString(risk.evidence, 500), potential_impact: boundedString(risk.potential_impact, 500), priority: risk.priority });
  }

  if (!Array.isArray(plan.data_gaps) || plan.data_gaps.length > 8) errors.push('data_gaps: require array of at most 8');
  const gaps = [];
  for (const [i, gap] of (Array.isArray(plan.data_gaps) ? plan.data_gaps : []).entries()) {
    if (!exactKeys(gap, ['missing_information', 'why_it_matters', 'how_to_obtain']) ||
        !validString(gap.missing_information, 200) || !validString(gap.why_it_matters, 400) || !validString(gap.how_to_obtain, 300)) errors.push('data_gaps[' + i + ']: invalid shape');
    else gaps.push({ missing_information: gap.missing_information.trim(), why_it_matters: gap.why_it_matters.trim(), how_to_obtain: gap.how_to_obtain.trim() });
  }

  function stringList(value, name, min, max, each) {
    if (!Array.isArray(value) || value.length < min || value.length > max || !value.every(v => validString(v, each))) { errors.push(name + ': invalid list'); return []; }
    return value.map(v => v.trim());
  }
  const priorities = stringList(plan.management_priorities, 'management_priorities', 1, 3, 300);
  const tomorrow = stringList(plan.tomorrow_actions, 'tomorrow_actions', 1, 3, 300);
  const documents = stringList(plan.documents_required, 'documents_required', 0, 10, 200);
  const limitations = stringList(plan.limitations, 'limitations', 0, 8, 300);

  if (!exactKeys(plan.plan_30_days, WEEKS)) errors.push('plan_30_days: all four periods required');
  const plan30 = {};
  for (const week of WEEKS) {
    const actions = plainObject(plan.plan_30_days) ? plan.plan_30_days[week] : null;
    if (!Array.isArray(actions) || actions.length < 2 || actions.length > 4) { errors.push('plan_30_days.' + week + ': require 2-4 actions'); plan30[week] = []; continue; }
    plan30[week] = actions.map((a, i) => validateAction(a, 'plan_30_days.' + week + '[' + i + ']', errors)).filter(Boolean);
  }

  const step = plan.recommended_next_step;
  if (!exactKeys(step, ['product', 'rationale']) || !XRAY_PRODUCT_CODES.includes(step.product) || !validString(step.rationale, 600)) errors.push('recommended_next_step: invalid');
  if (!LEVELS.includes(plan.confidence)) errors.push('confidence: invalid');

  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, value: {
    executive_summary: plan.executive_summary.trim(),
    financial_maturity: { score_1_to_5: fm.score_1_to_5, label: fm.label.trim(), rationale: fm.rationale.trim() },
    key_risks: risks, data_gaps: gaps, management_priorities: priorities,
    plan_30_days: plan30, tomorrow_actions: tomorrow, documents_required: documents,
    recommended_next_step: { product: step.product, label: XRAY_LABELS[locale].product[step.product], rationale: step.rationale.trim() },
    confidence: plan.confidence, limitations
  } };
}

// Every currency/percentage/large-number assertion in narrative or action text must already
// exist in the approved input projection.  Derived maturity scoring is deliberately excluded.
const FIGURE_RE = /\b\d[\d .,]*(?:%|EUR|USD|MDL|RON|lei|euro|million|milioane|млн|лей|леев)\b|\b\d{4,}\b/giu;
function figureTokens(value) {
  const set = new Set();
  for (const match of String(value || '').match(FIGURE_RE) || []) set.add(match.replace(/[\s.,]/g, '').toLowerCase());
  return set;
}
function factualView(a) {
  return {
    executive_summary: a.executive_summary, key_risks: a.key_risks, data_gaps: a.data_gaps,
    management_priorities: a.management_priorities, plan_30_days: a.plan_30_days,
    tomorrow_actions: a.tomorrow_actions, documents_required: a.documents_required,
    recommended_next_step: a.recommended_next_step, limitations: a.limitations
  };
}
function fabricationFlags(inputText, analysis) {
  const input = figureTokens(inputText); const output = figureTokens(JSON.stringify(factualView(analysis))); const flags = [];
  for (const token of output) if (!input.has(token)) flags.push(token);
  return flags.slice(0, 12);
}

function ownerAlert(inp, a, row, cfg) {
  const L = XRAY_LABELS.ru;
  const zone = L.zone[XRAY_ZONES.includes(row.zone) ? row.zone : 'UNKNOWN'];
  const text = [
    'ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ', '',
    'Компания: ' + (inp.company || '—'),
    'Язык клиента: ' + (row.locale === 'ro' ? 'RO' : 'RU'), '',
    'Оценка финансового управления: ' + (row.score === '' ? 'нет данных' : row.score + ' из 100'),
    'Зона: ' + zone.name + ' — ' + zone.line, '',
    'Основной риск: ' + a.key_risks[0].title,
    'Зрелость финансового управления: ' + row.maturity_score + ' из 5', '',
    'План на 30 дней: ГОТОВ К ПРОВЕРКЕ',
    'Следующий шаг: ' + a.recommended_next_step.label, '',
    'Статус: ' + L.review.AI_DRAFT,
    'Lead ID: ' + row.lead_id
  ].join('\n').replace(/[<>]/g, '').slice(0, 3900);
  const reviewUrl = String(cfg.xray_review_base_url || '') + '?a=' + encodeURIComponent(row.analysis_id) + '&t=' + encodeURIComponent(row.review_token);
  return { text, review_url: reviewUrl, crm_url: String(cfg.crm_url || '') };
}

function failedOutput(inp, now, errors) {
  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const row = {
    analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale: inp.locale === 'ro' ? 'ro' : 'ru',
    created_at: now, analysis_version: inp.analysis_version || ANALYSIS_VERSION, model: inp.ai_model || '',
    score: inp.score === null || inp.score === undefined ? '' : inp.score,
    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN', maturity_score: '', primary_risk: '',
    analysis_json: '', plan_30d_json: '', review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', review_token_expires_at: '',
    confidence: '', fabrication_flags: '', validation_errors: errors.join('; ').slice(0, 1200), source_channel: inp.source_channel || '',
    executive_summary: 'ANALYSIS_FAILED: MODEL_OUTPUT_INVALID', recommended_next_step: '', next_step_label: '', customer_notified_at: ''
  };
  return { is_valid: false, claim_key: inp.claim_key || (inp.lead_id + '|' + (inp.analysis_version || ANALYSIS_VERSION)), claim_state: 'ANALYSIS_FAILED', analysis_row: row,
    pipeline_row: { lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_analysis_status: 'ANALYSIS_FAILED', updated_at: now, last_activity_at: now },
    owner_text: 'ФИНАНСОВЫЙ РЕНТГЕН · ОШИБКА АНАЛИЗА\nLead ID: ' + inp.lead_id + '\nПричина: MODEL_OUTPUT_INVALID' };
}

const cfg = (function () { try { return $('Settings to Object').first().json.settings || {}; } catch (e) { return {}; } })();
const inputs = $('Build Analysis Input').all().map(i => i.json);
const responses = $input.all().map(i => i.json);
const now = new Date().toISOString();
const out = [];

for (let idx = 0; idx < responses.length; idx++) {
  const inp = inputs[idx]; if (!inp) continue;
  const locale = XRAY_LABELS[inp.locale] ? inp.locale : 'ru';
  const text = extractText(responses[idx] || {});
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { out.push({ json: failedOutput(inp, now, ['invalid JSON']) }); continue; }
  const checked = validateContract(parsed, locale);
  if (!checked.ok) { out.push({ json: failedOutput(inp, now, checked.errors) }); continue; }
  const a = checked.value;
  const flags = fabricationFlags(inp.input_digest_text || '', a);
  if (flags.length) { out.push({ json: failedOutput(inp, now, ['factual contract violation: ' + flags.join(', ')]) }); continue; }

  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const reviewToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = {
    analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale, created_at: now,
    analysis_version: inp.analysis_version || ANALYSIS_VERSION, model: inp.ai_model || '',
    score: inp.score === null || inp.score === undefined ? '' : inp.score,
    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN', maturity_score: a.financial_maturity.score_1_to_5,
    primary_risk: a.key_risks[0].title, analysis_json: JSON.stringify(a).slice(0, 45000),
    plan_30d_json: JSON.stringify(a.plan_30_days).slice(0, 45000), review_status: 'AI_DRAFT', reviewed_at: '',
    review_token: reviewToken, review_token_expires_at: expires, confidence: a.confidence, fabrication_flags: '', validation_errors: '',
    source_channel: inp.source_channel || '', executive_summary: a.executive_summary, recommended_next_step: a.recommended_next_step.product,
    next_step_label: a.recommended_next_step.label, customer_notified_at: ''
  };
  const pipelineRow = {
    lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_score: row.score, xray_maturity: row.maturity_score,
    xray_primary_risk: row.primary_risk, xray_analysis_status: 'AI_DRAFT', xray_next_step: row.next_step_label,
    updated_at: now, last_activity_at: now
  };
  out.push({ json: { is_valid: true, claim_key: inp.claim_key || (inp.lead_id + '|' + row.analysis_version), claim_state: 'AI_DRAFT',
    analysis_row: row, pipeline_row: pipelineRow, owner_alert: ownerAlert(inp, a, row, cfg), lead_id: inp.lead_id, analysis_id: analysisId } });
}

return out;
