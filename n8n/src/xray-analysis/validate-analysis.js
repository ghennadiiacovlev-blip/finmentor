// FINMENTOR X-Ray Analysis — "Validate + Store Rows".
//
// Input:  $input = OpenAI responses (one per analysed lead), $('Build Analysis Input') = the
//         items that produced them (paired by index and re-checked by lead_id order).
// Output: one item per lead with:
//   is_valid       — true: an AI_DRAFT the owner may review; false: ANALYSIS_FAILED, never promotable
//   analysis_row   — the XRay_Analysis sheet row
//   pipeline_row   — the narrow Pipeline projection (matched on lead_id)
//   owner_alert    — RU owner notification text + buttons (valid rows)
//   owner_text     — RU owner failure notice (failed rows)
//
// TWO OUTCOMES, AND ONLY TWO (C3 correction review, 2026-09-03):
//   * the model returned a parseable JSON object carrying every REQUIRED section, with at least
//     one key risk and one action in every week of the plan  -> AI_DRAFT (human review required)
//   * anything else — no JSON, not an object, a required section missing or empty, an empty
//     week — -> ANALYSIS_FAILED. A broken contract never becomes a draft with LOW confidence:
//     the owner is told, the row stops the sweep from looping, and deleting the row retries.
//
// Within a valid contract the content is NORMALISED, not rejected: lists are capped, unknown keys
// dropped, priority levels defaulted, an unknown product becomes DISCOVERY_CALL. The
// figure-fabrication guard FLAGS numbers that do not occur in the input (confidence LOW, the
// owner is told to check them) — it does not fail the analysis, because a KPI target or a
// planning figure is a plan, not a fact, and the owner decides before the customer sees anything.
//
// Score and zone are copied from the deterministic input, never from the model.

// __XRAY_LABELS__ (inlined by the builder)

const crypto = require('crypto');
const ANALYSIS_VERSION = 'xray-v2';
const REVIEW_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUIRED_TOP = ['executive_summary', 'financial_maturity', 'key_risks', 'plan_30_days', 'recommended_next_step'];
const WEEKS = ['days_1_7', 'days_8_14', 'days_15_21', 'days_22_30'];

function str(v, max) { return String(v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)).trim().slice(0, max || 2000); }
function arrStr(v, max, each) { if (!Array.isArray(v)) return []; return v.map(x => str(x, each || 400)).filter(Boolean).slice(0, max); }
function level(v) { const s = String(v || '').toUpperCase(); return ['HIGH', 'MEDIUM', 'LOW'].includes(s) ? s : 'MEDIUM'; }
function plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function extractText(ai) {
  let c = ai.output?.[0]?.content?.[0]?.text ?? ai.output_text ?? ai.text ?? ai.response ?? ai.message?.content ?? ai.choices?.[0]?.message?.content ?? ai.content ?? '';
  if (Array.isArray(ai.output)) {
    const msg = ai.output.find(o => o && o.type === 'message' && Array.isArray(o.content));
    if (msg) { const t = msg.content.find(x => x && (x.type === 'output_text' || typeof x.text === 'string')); if (t && typeof t.text === 'string') c = t.text; }
  }
  if (typeof c !== 'string') c = JSON.stringify(c);
  c = c.replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = c.indexOf('{'); const b = c.lastIndexOf('}');
  return (a !== -1 && b > a) ? c.slice(a, b + 1) : c;
}

// Contract check: the shape a human can review. Returns a list of errors; empty means valid.
function contractErrors(p) {
  const errors = [];
  if (!plainObject(p)) return ['not a JSON object'];
  for (const k of REQUIRED_TOP) { if (!(k in p)) errors.push('missing ' + k); }
  if (errors.length) return errors;
  if (str(p.executive_summary, 2500) === '') errors.push('executive_summary empty');
  if (!plainObject(p.financial_maturity)) errors.push('financial_maturity not an object');
  else {
    const m = parseInt(p.financial_maturity.score_1_to_5, 10);
    if (!Number.isFinite(m) || m < 1 || m > 5) errors.push('financial_maturity.score_1_to_5 out of 1..5');
  }
  const risks = Array.isArray(p.key_risks) ? p.key_risks.filter(r => plainObject(r) && str(r.title, 160) !== '') : [];
  if (!risks.length) errors.push('key_risks empty');
  if (!plainObject(p.plan_30_days)) errors.push('plan_30_days not an object');
  else {
    for (const w of WEEKS) {
      const actions = Array.isArray(p.plan_30_days[w]) ? p.plan_30_days[w].filter(a => plainObject(a) && str(a.action, 300) !== '') : [];
      if (!actions.length) errors.push('plan_30_days.' + w + ' empty');
    }
  }
  if (!plainObject(p.recommended_next_step)) errors.push('recommended_next_step not an object');
  return errors;
}

function action(a) {
  if (!a || typeof a !== 'object') return null;
  const out = { action: str(a.action, 300), owner_role: str(a.owner_role, 80), expected_output: str(a.expected_output, 300), control_or_kpi: str(a.control_or_kpi, 200), priority: level(a.priority) };
  return out.action ? out : null;
}
function week(v) { return (Array.isArray(v) ? v : []).map(action).filter(Boolean).slice(0, 6); }

function normalize(p, locale) {
  const L = XRAY_LABELS[locale];
  const fm = p.financial_maturity;
  const maturity = parseInt(fm.score_1_to_5, 10);
  const product = String((p.recommended_next_step || {}).product || '').toUpperCase();
  const productCode = XRAY_PRODUCT_CODES.includes(product) ? product : 'DISCOVERY_CALL';
  return {
    executive_summary: str(p.executive_summary, 2500),
    financial_maturity: { score_1_to_5: maturity, label: str(fm.label, 120), rationale: str(fm.rationale, 800) },
    key_risks: (Array.isArray(p.key_risks) ? p.key_risks : []).map(r => r && typeof r === 'object' ? ({ category: str(r.category, 80), title: str(r.title, 160), evidence: str(r.evidence, 500), potential_impact: str(r.potential_impact, 500), priority: level(r.priority) }) : null).filter(r => r && r.title).slice(0, 5),
    data_gaps: (Array.isArray(p.data_gaps) ? p.data_gaps : []).map(g => g && typeof g === 'object' ? ({ missing_information: str(g.missing_information, 200), why_it_matters: str(g.why_it_matters, 400), how_to_obtain: str(g.how_to_obtain, 300) }) : null).filter(g => g && g.missing_information).slice(0, 8),
    management_priorities: arrStr(p.management_priorities, 3, 300),
    plan_30_days: {
      days_1_7: week(p.plan_30_days.days_1_7),
      days_8_14: week(p.plan_30_days.days_8_14),
      days_15_21: week(p.plan_30_days.days_15_21),
      days_22_30: week(p.plan_30_days.days_22_30)
    },
    tomorrow_actions: arrStr(p.tomorrow_actions, 3, 300),
    documents_required: arrStr(p.documents_required, 10, 200),
    recommended_next_step: { product: productCode, label: L.product[productCode], rationale: str((p.recommended_next_step || {}).rationale, 600) },
    confidence: level(p.confidence),
    limitations: arrStr(p.limitations, 8, 300)
  };
}

// Figure-fabrication guard. Digits-with-unit tokens and 4+ digit numbers in the output must
// already exist in the input text; otherwise they are flagged. Small bare integers (days,
// scores, ranks) are deliberately not checked.
const MONEY_RE = /\d[\d\s.,]*\s?(?:%|€|\$|eur|usd|mdl|lei|леев|лей|руб|тыс\.?|млн|млрд|mii|mil|milioane|k\b)/gi;
const BIG_RE = /\b\d{4,}\b/g;
function tokens(text) {
  const set = new Set();
  for (const m of String(text).match(MONEY_RE) || []) set.add(m.replace(/[\s.,]/g, '').toLowerCase());
  for (const m of String(text).match(BIG_RE) || []) set.add(m);
  return set;
}
// KPI targets and expected outputs are NEW numbers by nature ("margins for >80% of sales"); they
// are plans, not facts about the business, so they are excluded from the scan. Proven necessary
// on the live RO acceptance run (C1): the guard flagged a KPI target and lowered confidence.
function factText(a) {
  const strip = (x) => Array.isArray(x) ? x.map(strip) : (x && typeof x === 'object')
    ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'control_or_kpi' && k !== 'expected_output').map(([k, v]) => [k, strip(v)]))
    : x;
  return JSON.stringify(strip(a));
}
function fabricationFlags(inputText, outputText) {
  const inp = tokens(inputText); const out = tokens(outputText); const flags = [];
  for (const t of out) { if (!inp.has(t) && !/^(2026|2027|2025|1000|100%)$/.test(t)) flags.push(t); }
  return flags.slice(0, 12);
}

function ownerAlert(inp, a, row, cfg) {
  const L = XRAY_LABELS.ru;
  const z = L.zone[XRAY_ZONES.includes(row.zone) ? row.zone : 'UNKNOWN'];
  const primary = a.key_risks[0] ? a.key_risks[0].title : L.insufficient;
  const pri = a.management_priorities.length ? a.management_priorities.map((p, i) => (i + 1) + '. ' + p).join('\n') : '—';
  const lines = [
    'ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ',
    '',
    'Компания: ' + (inp.company || '—'),
    'Язык клиента: ' + (row.locale === 'ro' ? 'RO' : 'RU'),
    '',
    'Оценка финансового управления: ' + (row.score === '' ? 'нет данных (без анкеты)' : row.score + ' из 100'),
    'Зона: ' + z.name + ' — ' + z.line,
    '',
    'Основной риск: ' + primary,
    'Зрелость финансового управления: ' + row.maturity_score + ' из 5',
    '',
    'Первые приоритеты:',
    pri,
    '',
    'План на 30 дней: ГОТОВ К ПРОВЕРКЕ',
    'Достоверность анализа: ' + a.confidence + (row.fabrication_flags ? '\n⚠️ Проверить цифры: ' + row.fabrication_flags : ''),
    'Следующий шаг: ' + a.recommended_next_step.label,
    '',
    'Статус: ' + L.review.AI_DRAFT,
    'Lead ID: ' + row.lead_id
  ];
  const reviewUrl = String(cfg.xray_review_base_url || '') + '?a=' + encodeURIComponent(row.analysis_id) + '&t=' + encodeURIComponent(row.review_token);
  return {
    // parse_mode HTML on the Telegram node: only angle brackets are unsafe, punctuation stays.
    text: lines.join('\n').replace(/[<>]/g, '').slice(0, 3900),
    review_url: reviewUrl,
    crm_url: String(cfg.crm_url || '')
  };
}

function newAnalysisId(leadId) {
  return 'XA-' + String(leadId).replace(/[^A-Za-z0-9_-]/g, '') + '-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

function failedOutput(inp, now, errors) {
  const analysisId = newAnalysisId(inp.lead_id) + '-F';
  const row = {
    analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale: inp.locale === 'ro' ? 'ro' : 'ru',
    created_at: now, analysis_version: inp.analysis_version || ANALYSIS_VERSION, model: inp.ai_model || '',
    score: inp.score === null || inp.score === undefined ? '' : inp.score,
    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN', maturity_score: '', primary_risk: '',
    analysis_json: '', plan_30d_json: '', review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', review_token_expires_at: '',
    confidence: '', fabrication_flags: '', validation_errors: errors.join('; ').slice(0, 1200), source_channel: inp.source_channel || '',
    executive_summary: 'ANALYSIS_FAILED: MODEL_OUTPUT_INVALID', recommended_next_step: '', next_step_label: '', customer_notified_at: ''
  };
  return {
    is_valid: false, lead_id: inp.lead_id, analysis_id: analysisId, analysis_row: row,
    pipeline_row: { lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_analysis_status: 'ANALYSIS_FAILED', updated_at: now, last_activity_at: now },
    owner_alert: null,
    owner_text: ('ФИНАНСОВЫЙ РЕНТГЕН · АНАЛИЗ НЕ ВЫПОЛНЕН\n\nКомпания: ' + (inp.company || '—') + '\nКласс ошибки: MODEL_OUTPUT_INVALID\nПричина: ' + errors.slice(0, 4).join('; ') + '\nLead ID: ' + inp.lead_id + '\n\nСтрока ' + analysisId + ' записана в XRay_Analysis со статусом ANALYSIS_FAILED. Удалите её, чтобы повторить анализ.').replace(/[<>]/g, '').slice(0, 3900)
  };
}

const cfg = (function () { try { return $('Settings to Object').first().json.settings || {}; } catch (e) { return {}; } })();
const inputs = $('Build Analysis Input').all().map(i => i.json);
const responses = $input.all().map(i => i.json);
const now = new Date().toISOString();
const out = [];

for (let idx = 0; idx < responses.length; idx++) {
  const ai = responses[idx] || {};
  const inp = inputs[idx];
  if (!inp) continue;
  const locale = XRAY_LABELS[inp.locale] ? inp.locale : 'ru';
  let parsed = null;
  try { parsed = JSON.parse(extractText(ai)); } catch (e) { out.push({ json: failedOutput(inp, now, ['invalid JSON']) }); continue; }
  const errors = contractErrors(parsed);
  if (errors.length) { out.push({ json: failedOutput(inp, now, errors) }); continue; }

  const a = normalize(parsed, locale);
  const flags = fabricationFlags(inp.input_digest_text || '', factText(a));
  if (flags.length) { a.confidence = 'LOW'; a.limitations.push((locale === 'ro' ? 'Cifre neconfirmate de datele de intrare: ' : 'Цифры, не подтверждённые входными данными: ') + flags.join(', ')); }

  const analysisId = newAnalysisId(inp.lead_id);
  // 32 random bytes: the per-row review authority. Bounded in time so a leaked link expires.
  const reviewToken = crypto.randomBytes(32).toString('hex');
  const row = {
    analysis_id: analysisId,
    lead_id: inp.lead_id,
    request_id: inp.request_id || '',
    locale,
    created_at: now,
    analysis_version: inp.analysis_version || ANALYSIS_VERSION,
    model: inp.ai_model || '',
    score: inp.score === null || inp.score === undefined ? '' : inp.score,
    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN',
    maturity_score: a.financial_maturity.score_1_to_5,
    primary_risk: a.key_risks[0].title,
    analysis_json: JSON.stringify(a).slice(0, 45000),
    plan_30d_json: JSON.stringify(a.plan_30_days).slice(0, 45000),
    review_status: 'AI_DRAFT',
    reviewed_at: '',
    review_token: reviewToken,
    review_token_expires_at: new Date(Date.now() + REVIEW_TOKEN_TTL_MS).toISOString(),
    confidence: a.confidence,
    fabrication_flags: flags.join(', '),
    validation_errors: '',
    source_channel: inp.source_channel || '',
    executive_summary: a.executive_summary.slice(0, 2500),
    recommended_next_step: a.recommended_next_step.product,
    next_step_label: a.recommended_next_step.label,
    customer_notified_at: ''
  };
  const pipelineRow = {
    lead_id: inp.lead_id,
    xray_analysis_id: analysisId,
    xray_score: row.score,
    xray_maturity: row.maturity_score,
    xray_primary_risk: row.primary_risk,
    xray_analysis_status: 'AI_DRAFT',
    xray_next_step: row.next_step_label,
    updated_at: now,
    last_activity_at: now
  };
  out.push({ json: { is_valid: true, analysis_row: row, pipeline_row: pipelineRow, owner_alert: ownerAlert(inp, a, row, cfg), owner_text: '', lead_id: inp.lead_id, analysis_id: analysisId } });
}

return out;
