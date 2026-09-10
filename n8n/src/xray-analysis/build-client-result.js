// FINMENTOR X-Ray Analysis — "Build Curated Client Result".
//
// Runs ONLY on explicit approval (CLIENT_READY, or ALREADY_READY as an idempotent repair). Emits
// exactly one row for the n8n Data Table `XRay_Client_Results`, which is the ONLY store the Mini
// App Gateway reads for the customer result — upserted by lead_id, so a lead has one published
// result and re-promotion replaces it.
//
// CURATED. result_json carries the customer-facing analysis and nothing else: locale, product
// labels, score, zone, maturity, key risks, management priorities, the 30-day plan, tomorrow's
// actions and the FINMENTOR recommendation. No review token, no raw model response, no owner
// notes, no prompt, no request id, no confidence/fabrication internals, no AI_DRAFT or
// ANALYSIS_FAILED — a draft or failed row never reaches this node (the verdict refuses them).

const v = $('Review POST Verdict').first().json || {};
const row = v.source_row || {};
const leadId = String(row.lead_id || '').trim();
const analysisId = String(row.analysis_id || '').trim();
const leadKey = leadId.replace(/[^A-Za-z0-9_-]/g, '');
const sourceState = String(row.review_status || '');
const publishableSourceStates = ['AI_DRAFT', 'OWNER_REVIEW', 'OWNER_EDITED', 'CLIENT_READY'];

// Defence in depth. Review POST is the primary authority, but the publisher independently requires
// strict stored eligibility, a publishable source state and the canonical analysis/lead binding.
// Missing, stringified or malformed eligibility is not authority. The separate client_visible bit
// is the customer access grant; review/delivery history remains in review_status.
if (v.publish_client !== true
  || row.client_result_eligible !== true
  || !publishableSourceStates.includes(sourceState)
  || !leadId || !analysisId || !leadKey
  || !analysisId.startsWith('XA-' + leadKey + '-')) return [];
let a = v.client_draft && typeof v.client_draft === 'object' ? v.client_draft : null;
if (!a) { try { a = JSON.parse(String(row.client_result_draft_json || row.analysis_json || 'null')); } catch (e) { a = null; } }
if (!a || typeof a !== 'object' || Array.isArray(a)) return [];

const locale = row.locale === 'ro' ? 'ro' : 'ru';
const labels = locale === 'ro'
  ? { product: 'Test financiar FINMENTOR', condition: 'Starea financiară', score: 'Scor', zone: 'Zona de risc', maturity: 'Maturitatea managementului financiar', risks: 'Riscuri-cheie', priorities: 'Priorități de management', plan: 'Plan de acțiune financiară pentru 30 de zile', tomorrow: 'Următoarea acțiune', next: 'Recomandarea FINMENTOR' }
  : { product: 'Финансовый рентген бизнеса', condition: 'Финансовое состояние', score: 'Оценка', zone: 'Зона риска', maturity: 'Зрелость финансового управления', risks: 'Ключевые риски', priorities: 'Приоритеты управления', plan: 'План финансовых действий на 30 дней', tomorrow: 'Следующее действие', next: 'Рекомендация FINMENTOR' };
const zones = locale === 'ro'
  ? { GREEN: 'Zonă verde', YELLOW: 'Zonă galbenă', ORANGE: 'Zonă portocalie', RED: 'Zonă roșie', UNKNOWN: 'Fără scor' }
  : { GREEN: 'Зелёная зона', YELLOW: 'Жёлтая зона', ORANGE: 'Оранжевая зона', RED: 'Красная зона', UNKNOWN: 'Без оценки' };
const zone = ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN'].includes(String(row.zone)) ? String(row.zone) : 'UNKNOWN';
const str = (x, n) => String(x == null ? '' : x).slice(0, n || 600);
const action = (x) => x && typeof x === 'object' ? { action: str(x.action, 300), owner_role: str(x.owner_role, 80), expected_output: str(x.expected_output, 300), control_or_kpi: str(x.control_or_kpi, 200), priority: str(x.priority, 10) } : null;
const week = (w) => (Array.isArray(w) ? w : []).map(action).filter(Boolean).slice(0, 6);

const result = {
  locale,
  labels,
  score: row.score === '' || row.score === undefined || row.score === null ? null : Number(row.score),
  zone,
  zone_label: zones[zone],
  maturity: a.financial_maturity && typeof a.financial_maturity === 'object'
    ? { score_1_to_5: a.financial_maturity.score_1_to_5, label: str(a.financial_maturity.label, 120), rationale: str(a.financial_maturity.rationale, 800) }
    : null,
  summary: str(a.executive_summary, 2500),
  key_risks: (Array.isArray(a.key_risks) ? a.key_risks : []).map(r => r && typeof r === 'object' ? { title: str(r.title, 160), category: str(r.category, 80), evidence: str(r.evidence, 500), potential_impact: str(r.potential_impact, 500), priority: str(r.priority, 10) } : null).filter(Boolean).slice(0, 5),
  management_priorities: (Array.isArray(a.management_priorities) ? a.management_priorities : []).map(p => str(p, 300)).slice(0, 3),
  plan_30_days: {
    days_1_7: week((a.plan_30_days || {}).days_1_7), days_8_14: week((a.plan_30_days || {}).days_8_14),
    days_15_21: week((a.plan_30_days || {}).days_15_21), days_22_30: week((a.plan_30_days || {}).days_22_30)
  },
  tomorrow_actions: (Array.isArray(a.tomorrow_actions) ? a.tomorrow_actions : []).map(p => str(p, 300)).slice(0, 3),
  recommended_next_step: a.recommended_next_step && typeof a.recommended_next_step === 'object'
    ? { product: str(a.recommended_next_step.product, 40), label: str(a.recommended_next_step.label, 160), rationale: str(a.recommended_next_step.rationale, 600) }
    : null
};

// The Data Table row: exactly the target XRay_Client_Results schema. client_visible is a boolean
// access authority, not a review/delivery status; legacy missing values therefore remain hidden.
return [{ json: {
  analysis_id: analysisId,
  lead_id: leadId,
  locale,
  published_at: new Date().toISOString(),
  result_json: JSON.stringify(result),
  review_status: 'CLIENT_READY',
  client_visible: true,
  score: result.score === null ? '' : String(result.score),
  zone
} }];
