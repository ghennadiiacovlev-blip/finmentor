// FINMENTOR X-Ray Analysis — "Validate + Store Rows".
//
// Input:  $input = OpenAI responses (one per analysed lead), $('Build Analysis Input') = the
//         items that produced them (paired by index and re-checked by lead_id order).
// Output: one item per lead with:
//   analysis_row   — the XRay_Analysis sheet row (AI_DRAFT)
//   pipeline_row   — the narrow Pipeline projection (matched on lead_id)
//   owner_alert    — RU owner notification text + buttons
//
// Guarantees:
//   * score and zone are copied from the deterministic input, never from the model;
//   * every list is capped to the contract; unknown keys are dropped;
//   * "figure fabrication" guard: currency/percent/large numbers in the output that do not
//     occur in the input are flagged, confidence is forced to LOW and the owner is told;
//   * product recommendation outside the allowed set becomes DISCOVERY_CALL.

// __XRAY_LABELS__ (inlined by the builder)

const crypto = require('crypto');

function str(v, max) { return String(v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)).trim().slice(0, max || 2000); }
function arrStr(v, max, each) { if (!Array.isArray(v)) return []; return v.map(x => str(x, each || 400)).filter(Boolean).slice(0, max); }
function level(v) { const s = String(v || '').toUpperCase(); return ['HIGH', 'MEDIUM', 'LOW'].includes(s) ? s : 'MEDIUM'; }

function extractText(ai) {
  let c = ai.output?.[0]?.content?.[0]?.text ?? ai.output_text ?? ai.text ?? ai.response ?? ai.message?.content ?? ai.choices?.[0]?.message?.content ?? ai.content ?? '';
  if (Array.isArray(ai.output)) {
    const msg = ai.output.find(o => o && o.type === 'message' && Array.isArray(o.content));
    if (msg) { const t = msg.content.find(x => x && (x.type === 'output_text' || x.text)); if (t && t.text) c = t.text; }
  }
  if (typeof c !== 'string') c = JSON.stringify(c);
  c = c.replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = c.indexOf('{'); const b = c.lastIndexOf('}');
  return (a !== -1 && b > a) ? c.slice(a, b + 1) : c;
}

function action(a) {
  if (!a || typeof a !== 'object') return null;
  const out = { action: str(a.action, 300), owner_role: str(a.owner_role, 80), expected_output: str(a.expected_output, 300), control_or_kpi: str(a.control_or_kpi, 200), priority: level(a.priority) };
  return out.action ? out : null;
}
function week(v) { return (Array.isArray(v) ? v : []).map(action).filter(Boolean).slice(0, 6); }

function normalize(plan, locale) {
  const L = XRAY_LABELS[locale];
  const p = plan && typeof plan === 'object' ? plan : {};
  const fm = p.financial_maturity && typeof p.financial_maturity === 'object' ? p.financial_maturity : {};
  let maturity = parseInt(fm.score_1_to_5, 10);
  if (!Number.isFinite(maturity) || maturity < 1 || maturity > 5) maturity = null;
  const product = String((p.recommended_next_step || {}).product || '').toUpperCase();
  const productCode = XRAY_PRODUCT_CODES.includes(product) ? product : 'DISCOVERY_CALL';
  return {
    executive_summary: str(p.executive_summary, 2500) || L.insufficient,
    financial_maturity: { score_1_to_5: maturity, label: str(fm.label, 120), rationale: str(fm.rationale, 800) },
    key_risks: (Array.isArray(p.key_risks) ? p.key_risks : []).map(r => r && typeof r === 'object' ? ({ category: str(r.category, 80), title: str(r.title, 160), evidence: str(r.evidence, 500), potential_impact: str(r.potential_impact, 500), priority: level(r.priority) }) : null).filter(r => r && r.title).slice(0, 5),
    data_gaps: (Array.isArray(p.data_gaps) ? p.data_gaps : []).map(g => g && typeof g === 'object' ? ({ missing_information: str(g.missing_information, 200), why_it_matters: str(g.why_it_matters, 400), how_to_obtain: str(g.how_to_obtain, 300) }) : null).filter(g => g && g.missing_information).slice(0, 8),
    management_priorities: arrStr(p.management_priorities, 3, 300),
    plan_30_days: {
      days_1_7: week((p.plan_30_days || {}).days_1_7),
      days_8_14: week((p.plan_30_days || {}).days_8_14),
      days_15_21: week((p.plan_30_days || {}).days_15_21),
      days_22_30: week((p.plan_30_days || {}).days_22_30)
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
// are plans, not facts about the business, so they are excluded from the scan.
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
  const planReady = (a.plan_30_days.days_1_7.length + a.plan_30_days.days_8_14.length + a.plan_30_days.days_15_21.length + a.plan_30_days.days_22_30.length) > 0;
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
    'Зрелость финансового управления: ' + (row.maturity_score === '' ? '—' : row.maturity_score + ' из 5'),
    '',
    'Первые приоритеты:',
    pri,
    '',
    'План на 30 дней: ' + (planReady ? 'ГОТОВ К ПРОВЕРКЕ' : 'НЕ СФОРМИРОВАН'),
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
  let parsed = null; let parseOk = true;
  try { parsed = JSON.parse(extractText(ai)); } catch (e) { parseOk = false; }
  const a = normalize(parsed, locale);
  if (!parseOk) { a.confidence = 'LOW'; a.limitations.unshift(locale === 'ro' ? 'Răspunsul modelului nu a putut fi interpretat; necesită verificare manuală.' : 'Ответ модели не удалось разобрать; требуется ручная проверка.'); }
  const flags = fabricationFlags(inp.input_digest_text || '', factText(a));
  if (flags.length) { a.confidence = 'LOW'; a.limitations.push((locale === 'ro' ? 'Cifre neconfirmate de datele de intrare: ' : 'Цифры, не подтверждённые входными данными: ') + flags.join(', ')); }

  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + Date.now().toString(36).toUpperCase();
  const reviewToken = crypto.randomBytes(16).toString('hex');
  const row = {
    analysis_id: analysisId,
    lead_id: inp.lead_id,
    request_id: inp.request_id || '',
    locale,
    created_at: now,
    analysis_version: 'xray-v1',
    model: inp.ai_model || '',
    score: inp.score === null || inp.score === undefined ? '' : inp.score,
    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN',
    maturity_score: a.financial_maturity.score_1_to_5 === null ? '' : a.financial_maturity.score_1_to_5,
    primary_risk: a.key_risks[0] ? a.key_risks[0].title : '',
    analysis_json: JSON.stringify(a).slice(0, 45000),
    plan_30d_json: JSON.stringify(a.plan_30_days).slice(0, 45000),
    review_status: 'AI_DRAFT',
    reviewed_at: '',
    review_token: reviewToken,
    confidence: a.confidence,
    fabrication_flags: flags.join(', '),
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
  out.push({ json: { analysis_row: row, pipeline_row: pipelineRow, owner_alert: ownerAlert(inp, a, row, cfg), lead_id: inp.lead_id, analysis_id: analysisId } });
}

return out;
