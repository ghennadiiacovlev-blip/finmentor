// Normalize + Score Lead v2.1 (Phase A).
// KEY FIX 1: completion_score (полнота анкеты) больше НИКОГДА не формирует financial_zone.
// KEY FIX 2: отрицания ("Нет срочности", "Пока ничего не подготовлено") не повышают квалификацию.
const v = $('Validate Payload').first().json;
const incoming = v.payload || {};
const source = v.source || 'website';

const client = incoming.client || {};
const lead = incoming.lead || {};
const diagnostic = incoming.diagnostic || {};
const intake = incoming.intake || {};
const automation = incoming.automation || {};
const signals = incoming.signals || {};
const meta = incoming.meta || {};
const attribution = incoming.attribution || {};
const businessProfile = incoming.business_profile || {};
const mainPainObj = incoming.main_pain || {};
const financialSystem = incoming.financial_system || {};
const urgencyRisks = intake.urgency_and_risks || {};
const industrySpecific = intake.industry_specific || {};

function pick(...values) { for (const x of values) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; } return ''; }
function lower(x) { return String(x ?? '').toLowerCase().replace(/ё/g, 'е').trim(); }
function asArray(x) { if (!x) return []; if (Array.isArray(x)) return x.map(String).filter(s => s.trim() !== ''); if (typeof x === 'string') return x.split(',').map(s => s.trim()).filter(Boolean); return [String(x)].filter(s => s.trim() !== ''); }
function joinArray(x) { return asArray(x).join(', '); }
// NEGATIONS: любой отрицательный ответ отменяет положительный сигнал, даже если содержит ключевое слово.
const NEGATION = [/\bнет\b/, /^нет/, /нет срочн/, /не срочн/, /без срочн/, /не горит/, /ничего/, /отсутств/, /не планир/, /не готов/, /не подготовл/, /\bno\b/, /\bnone\b/, /not urgent/, /nothing/];
function isNegative(text) { const s = lower(text); return s !== '' && NEGATION.some(r => r.test(s)); }
function hits(text, patterns) { const s = lower(text); if (!s) return false; if (isNegative(s)) return false; return patterns.some(r => r.test(s)); }
function arrHits(arr, patterns) { return asArray(arr).some(x => hits(x, patterns)); }
function isYes(x) { const s = lower(x); return s !== '' && !isNegative(s) && /^(да|есть|yes|true|готов)/.test(s); }

// ---------- identity / contacts ----------
const createdAt = pick(incoming.created_at, new Date().toISOString());
// Canonical lead identity is server-owned.
//
// This previously read `pick(incoming.lead_id, ...)`, so a caller-supplied lead_id became
// the canonical identity AND, downstream in Dedup Guard, selected which existing CRM row a
// submission merged into. A public request that named a known lead_id could therefore
// steer itself into somebody else's Pipeline row.
//
// A caller value is now only a correlation reference. It is honoured as identity solely
// when the request proves provenance with the shared internal key held in Settings, which
// is how the Telegram Concierge updates the lead it already owns. When that key is not
// configured, no caller is trusted and every submission gets a fresh server-minted id.
const submissionLeadId = String(incoming.lead_id ?? '').trim().slice(0, 80);
const requestId = String(meta.request_id ?? incoming.request_id ?? '').trim().slice(0, 80);

const internalKey = String((function () {
  try { return $('Settings to Object').first().json.settings.internal_intake_key || ''; } catch (e) { return ''; }
})()).trim();
const presentedKey = String((function () {
  try { return ($('Webhook').first().json.headers || {})['x-finmentor-internal-key'] || ''; } catch (e) { return ''; }
})()).trim();
const provenanceTrusted = internalKey !== '' && presentedKey !== '' && presentedKey === internalKey;

const leadId = (provenanceTrusted && submissionLeadId)
  ? submissionLeadId
  : `FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const tool = pick(incoming.tool, 'unknown');
const name = pick(client.name, lead.name);
const company = pick(client.company, lead.company);
const role = pick(client.role);
const emailRaw = pick(client.email, lead.email);
function normalizePhoneIdentity(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  // An email address or a Telegram handle is never a phone number.
  if (s.includes('@')) return '';
  if (/telegram|t\.me/i.test(s)) return '';
  // Take the leading portion only, so '+373 60 123 456 (Viber)' still normalises, then
  // require it to be composed purely of phone punctuation and digits. Anything containing
  // letters is not a number.
  const core = s.split(/[(,;]/)[0].trim();
  if (!/^[+\d][\d\s().\-\/]*$/.test(core)) return '';
  const d = core.replace(/[^\d]/g, '');
  return (d.length >= 6 && d.length <= 15) ? d : '';
}

const phoneRaw = pick(client.phone_or_messenger, lead.contact, lead.phone, client.phone);
const telegramRaw = pick(client.telegram, lead.telegram);
const emailNorm = (() => { const e = lower(emailRaw); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''; })();
// A phone identity may only be derived from something actually shaped like a phone.
//
// phoneRaw falls back to lead.contact, which on the consultation form is usually an email.
// The old rule stripped every non-digit and accepted any 6-15 digit run, so
// 'qa-20260825-202641@example.com' normalised to the "phone" 20260825202641. That is a
// trust-boundary hole of the same family as the caller lead_id one: an attacker could
// register an address whose digits equal a victim's phone number and be merged into that
// victim's Pipeline row. Found by live remediation QA, not by either audit.
const phoneNorm = normalizePhoneIdentity(phoneRaw);
const telegramNorm = (() => { let s = lower(telegramRaw); if (!s) return ''; s = s.replace(/^telegram(\s*chat_id)?\s*:\s*/, '').replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '').trim(); return (/^[a-z0-9_]{3,32}$/.test(s) || /^\d{5,20}$/.test(s)) ? s : ''; })();
const hasRawContact = [emailRaw, phoneRaw, telegramRaw].some(x => String(x || '').trim() !== '');
const hasValidContact = !!(emailNorm || phoneNorm || telegramNorm);

const consentTrue = meta.consent === true || String(meta.consent).toLowerCase() === 'true' || incoming.consent?.privacy_accepted === true || intake.consent?.privacy_accepted === true || client.consent === true || String(client.consent).toLowerCase() === 'true';

// ---------- business context ----------
const businessModel = pick(incoming.answers?.business_model, diagnostic.business_model, diagnostic.business_model_key, signals.model, industrySpecific.model_label, industrySpecific.model_key, attribution.model, incoming.tracking_safe?.business_model);
const industryCategory = pick(intake.company_profile?.industry_category, businessProfile.industry_category);
const turnoverRange = pick(intake.company_profile?.turnover_range, businessProfile.turnover_range, incoming.answers?.revenue_range);
const employeesRange = pick(intake.company_profile?.employees_range, businessProfile.employees_range);
const hasCfo = pick(incoming.answers?.has_cfo, intake.company_profile?.has_cfo, financialSystem.has_cfo);
const urgency = pick(mainPainObj.urgency, diagnostic.urgency, signals.urgency, intake.business_pain?.urgency, urgencyRisks.timeline);
const firstStep = pick(automation.recommended_next_step, diagnostic.first_step, signals.first_step, mainPainObj.desired_first_step, intake.business_pain?.desired_first_step);
const mainPain = pick(incoming.answers?.main_pain, diagnostic.main_pain, mainPainObj.problem, joinArray(intake.business_pain?.selected_problems), joinArray(incoming.answers?.extended_intake?.selected_pains), signals.main_pain);
const selectedProblems = joinArray(intake.business_pain?.selected_problems || incoming.answers?.extended_intake?.selected_pains);
const selectedGoals = joinArray(intake.goals?.selected_goals || incoming.answers?.extended_intake?.goals);
const selectedDocumentsArr = asArray(intake.documents_available?.selected_documents || incoming.answers?.extended_intake?.documents);
const selectedDocuments = selectedDocumentsArr.join(', ');
const documentsStatus = pick(intake.documents_available?.status, financialSystem.documents_status);
const workInterestArray = asArray(intake.commercial_intent?.work_interest || incoming.answers?.extended_intake?.work_interest);
const workInterest = workInterestArray.join(', ');
const expectedOutcomes = asArray(intake.goals?.expected_meeting_outcomes);
const preferredMeetingFormat = pick(client.preferred_meeting_format, mainPainObj.preferred_meeting_format, intake.business_pain?.preferred_meeting_format);

// ---------- SCORES: completion vs diagnostic (разделены) ----------
const completionRaw = pick(incoming.completion?.completion_score, intake.completion?.completion_score);
const completionNum = Number(completionRaw);
const completionScore = (String(completionRaw).trim() !== '' && Number.isFinite(completionNum)) ? completionNum : '';
const diagRaw = pick(diagnostic.score, diagnostic.diagnostic_score, incoming.diagnostic_score, signals.diagnostic_score);
const diagNum = Number(diagRaw);
const diagnosticScore = (String(diagRaw).trim() !== '' && Number.isFinite(diagNum)) ? diagNum : '';

function mapZoneLabel(x) { const s = String(x || '').toUpperCase(); if (!s.trim()) return ''; if (s.includes('RED') || s.includes('КРАС')) return 'RED'; if (s.includes('ORANGE') || s.includes('ОРАНЖ')) return 'ORANGE'; if (s.includes('YELLOW') || s.includes('ЖЕЛТ') || s.includes('ЖЁЛТ')) return 'YELLOW'; if (s.includes('GREEN') || s.includes('ЗЕЛ')) return 'GREEN'; return ''; }
let financialZone = mapZoneLabel(pick(diagnostic.traffic_light, diagnostic.risk_zone, incoming.risk_zone, signals.score_zone));
let zoneSource = financialZone ? 'diagnostic_label' : '';
if (!financialZone && diagnosticScore !== '') {
  financialZone = diagnosticScore >= 85 ? 'GREEN' : diagnosticScore >= 70 ? 'YELLOW' : diagnosticScore >= 50 ? 'ORANGE' : 'RED';
  zoneSource = 'diagnostic_score';
}
if (!financialZone) { financialZone = 'UNKNOWN'; zoneSource = completionScore !== '' ? 'insufficient_financial_data (completion_score не используется для зоны)' : 'insufficient_financial_data'; }

// ---------- signals ----------
const realDocuments = selectedDocumentsArr.filter(d => !isNegative(d));
const docsStatusPositive = isYes(documentsStatus);
const hasDocumentsSignal = realDocuments.length > 0 || docsStatusPositive;
const documentsDeclared = selectedDocumentsArr.length > 0 && realDocuments.length === 0;

const urgent = hits(urgency, [/срочн/, /горит/, /^1 месяц/, /сегодня/, /недел/, /\bhigh\b/]);

const criticalFlags = [];
if (isYes(urgencyRisks.critical_cash_problem)) criticalFlags.push('критическая проблема с деньгами');
if (isYes(urgencyRisks.overdue_payments)) criticalFlags.push('есть просроченные платежи');
if (isYes(urgencyRisks.bank_supplier_investor_pressure)) criticalFlags.push('давление банка / поставщиков / инвесторов');
if (isYes(urgencyRisks.owner_finance_team_conflict)) criticalFlags.push('конфликт собственника и финансовой команды');
if (isYes(urgencyRisks.business_stop_risk)) criticalFlags.push('риск остановки бизнеса');
if (industrySpecific.loans_or_investors && !isNegative(industrySpecific.loans_or_investors)) criticalFlags.push(`финансирование / обязательства: ${industrySpecific.loans_or_investors}`);
if (hits(industrySpecific.capex_or_projects, [/отдельные проекты/, /capex/])) criticalFlags.push('есть CAPEX / отдельные проекты');

const strongCommercialIntent = arrHits(workInterestArray, [/внедрение системы/, /регулярный контроль/, /cfo/, /автоматизаци/, /power bi/, /dashboard/, /дашборд/]);
const lightCommercialIntent = arrHits(workInterestArray, [/разовая диагностика/, /диагностик/, /консультаци/]);
const explicitMeetingIntent = hits(firstStep, [/discovery/, /разбор/, /встреч/, /звонок/]) || expectedOutcomes.filter(x => !isNegative(x)).length > 0 || intake.consent?.wants_preliminary_meeting_plan === true;
const hasConcretePain = (Boolean(mainPain) && !isNegative(mainPain)) || asArray(selectedProblems).filter(x => !isNegative(x)).length > 0;
const wantsImplementationNow = strongCommercialIntent && urgent;
const hasHighFinancialRisk = financialZone === 'RED' || financialZone === 'ORANGE' || criticalFlags.length > 0;
const hasImmediateMeetingRequest = hits(firstStep, [/discovery call/, /разбор сегодня/, /срочный разбор/]) || (hits(preferredMeetingFormat, [/личная встреча/]) && urgent);

// ---------- PRIORITY (централизованные правила + объяснимые причины) ----------
let leadPriority = 'COLD';
let status = 'Nurture';
let reasons = [];
if (!hasValidContact || !consentTrue) {
  leadPriority = 'INCOMPLETE';
  status = 'Incomplete lead';
  if (!hasValidContact) reasons.push(hasRawContact ? 'контакт указан, но не распознан (проверить вручную)' : 'нет контакта для связи');
  if (!consentTrue) reasons.push('нет явного согласия на обработку данных');
} else if (urgent || hasHighFinancialRisk || wantsImplementationNow || hasImmediateMeetingRequest) {
  leadPriority = 'HOT';
  status = 'Qualified';
  if (urgent) reasons.push(`срочность: ${urgency}`);
  if (financialZone === 'RED' || financialZone === 'ORANGE') reasons.push(`финансовая зона ${financialZone} (источник: ${zoneSource})`);
  if (criticalFlags.length) reasons.push(`критические флаги: ${criticalFlags.join('; ')}`);
  if (wantsImplementationNow) reasons.push('интерес к внедрению + близкий срок');
  if (hasImmediateMeetingRequest) reasons.push('явный запрос на срочную встречу');
} else if (financialZone === 'YELLOW' || hasConcretePain || lightCommercialIntent || strongCommercialIntent || hasDocumentsSignal || explicitMeetingIntent) {
  leadPriority = 'WARM';
  status = 'New';
  if (financialZone === 'YELLOW') reasons.push('финансовая зона YELLOW');
  if (hasConcretePain) reasons.push(`конкретная боль: ${String(mainPain || selectedProblems).slice(0, 120)}`);
  if (strongCommercialIntent) reasons.push('интерес к внедрению / автоматизации без срочности');
  if (lightCommercialIntent) reasons.push('интерес к диагностике');
  if (hasDocumentsSignal) reasons.push(`подтверждённые данные: ${realDocuments.join(', ') || documentsStatus}`);
  if (explicitMeetingIntent) reasons.push('есть ожидания от встречи / Health Check');
} else {
  reasons.push('контакт и согласие есть, но срочность, боль и коммерческий интерес не выражены');
}
if (documentsDeclared) reasons.push('документы отмечены как неподготовленные — не считается положительным сигналом');
if (financialZone === 'UNKNOWN') reasons.push('финансовая зона не определена: недостаточно финансовых данных');
const priorityReason = reasons.join(' | ');

const nextAction = leadPriority === 'HOT' ? 'Ответить сегодня / предложить Discovery Call'
  : leadPriority === 'WARM' ? 'Назначить Financial Health Check / короткий квалификационный контакт'
  : leadPriority === 'COLD' ? 'Оставить в CRM / nurturing'
  : 'Проверить контакт / consent';

const dqParts = [];
if (completionScore !== '') dqParts.push(`completion=${completionScore}%`);
if (diagnosticScore === '') dqParts.push('diagnostic_score отсутствует');
if (!hasValidContact && hasRawContact) dqParts.push('контакт не распознан');
const dataQualityHint = [pick(intake.completion?.data_quality_hint, incoming.completion?.data_quality_hint), dqParts.join('; ')].filter(Boolean).join(' | ');

return [{ json: {
  lead_id: leadId,
  submission_lead_id: submissionLeadId,
  request_id: requestId,
  provenance_trusted: provenanceTrusted,
  created_at: createdAt,
  tool,
  source,
  lead_priority: leadPriority,
  lead_temperature: leadPriority,
  financial_zone: financialZone,
  zone_source: zoneSource,
  priority_reason: priorityReason,
  status,
  next_action: nextAction,
  name, company, role,
  email: String(emailRaw).trim(), phone: String(phoneRaw).trim(), telegram: String(telegramRaw).trim(),
  email_norm: emailNorm, phone_norm: phoneNorm, telegram_norm: telegramNorm,
  company_norm: lower(company), name_norm: lower(name),
  country: pick(client.country), city: pick(client.city),
  language: pick(client.language, client.preferred_language, 'ru'),
  business_model: businessModel, has_cfo: hasCfo, urgency,
  score_zone: financialZone, risk_zone: financialZone,
  first_step: firstStep, main_pain: mainPain,
  page_url: pick(meta.page_url, incoming.page_url, incoming.source_page),
  referrer: pick(meta.referrer, incoming.referrer),
  utm_source: pick(meta.utm_source, attribution.utm_source),
  utm_medium: pick(meta.utm_medium, attribution.utm_medium),
  utm_campaign: pick(meta.utm_campaign, attribution.utm_campaign),
  utm_content: pick(meta.utm_content, attribution.utm_content),
  utm_term: pick(meta.utm_term, attribution.utm_term),
  consent: consentTrue,
  diagnostic_score: diagnosticScore,
  completion_score: completionScore,
  industry_category: industryCategory, turnover_range: turnoverRange, employees_range: employeesRange,
  selected_problems: selectedProblems, selected_goals: selectedGoals,
  selected_documents: selectedDocuments, documents_status: documentsStatus,
  work_interest: workInterest, preferred_meeting_format: preferredMeetingFormat,
  data_quality_hint: dataQualityHint,
  routing_hint: automation.routing_hint || '',
  human_review_required: automation.human_review_required === true || financialZone === 'UNKNOWN' || (!hasValidContact && hasRawContact),
  critical_flags: criticalFlags.join('; '),
  strong_commercial_intent: strongCommercialIntent,
  light_commercial_intent: lightCommercialIntent,
  explicit_meeting_intent: explicitMeetingIntent,
  has_documents_signal: hasDocumentsSignal,
  raw_json: JSON.stringify(incoming).slice(0, 45000)
} }];