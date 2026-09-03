// Curated customer result projection.  Storage metadata is separate from result_json and
// Gateway returns result_json only.  No token, prompt, raw model response, request id or PII.
const verdict = $('Review CAS Verdict').first().json;
const row = verdict.source_row || {};
if (verdict.proceed_update !== true || String(row.review_status || '') === 'ANALYSIS_FAILED') return [];
let analysis = {}; try { analysis = JSON.parse(String(row.analysis_json || '{}')); } catch (e) { return []; }
const locale = row.locale === 'ro' ? 'ro' : 'ru';
const labels = locale === 'ro'
  ? { product: 'Test de sănătate financiară FINMENTOR', score: 'Scor', zone: 'Zonă', maturity: 'Maturitate financiară', risks: 'Riscuri-cheie', priorities: 'Priorități de management', plan: 'Plan de acțiune pentru 30 de zile', tomorrow: 'Acțiuni pentru mâine', next: 'Următorul pas FINMENTOR' }
  : { product: 'Финансовый рентген бизнеса', score: 'Оценка', zone: 'Зона', maturity: 'Зрелость финансового управления', risks: 'Ключевые риски', priorities: 'Приоритеты управления', plan: 'План действий на 30 дней', tomorrow: 'Действия на завтра', next: 'Следующий шаг FINMENTOR' };
const result = {
  locale, labels, score: row.score === '' ? null : Number(row.score), zone: String(row.zone || 'UNKNOWN'),
  maturity: analysis.financial_maturity, key_risks: analysis.key_risks,
  management_priorities: analysis.management_priorities, plan_30_days: analysis.plan_30_days,
  tomorrow_actions: analysis.tomorrow_actions, recommended_next_step: analysis.recommended_next_step
};
return [{ json: {
  authority_key: String(row.lead_id || '') + '|' + String(row.analysis_version || ''),
  lead_id: String(row.lead_id || ''), analysis_version: String(row.analysis_version || ''),
  review_status: 'CLIENT_READY', published_at: new Date().toISOString(), result_json: JSON.stringify(result)
} }];
