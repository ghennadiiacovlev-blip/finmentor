// FINMENTOR X-Ray Analysis — "Build Analysis Input".
//
// Input:  $input = Leads rows matched by "Lead ID" (0..N), $('Select Pending Leads') = the
//         Pipeline rows being analysed.
// Output: one item per pending lead carrying the deterministic facts, the PII-safe
//         projection, the locale, the prompts and the JSON contract the model must return.
//
// The model NEVER sees identity. Three layers (allowlist, key denylist, value scrub) are the
// same core as Lead Intake's ai-safe-projection.js, then the serialised projection is
// re-inspected and the lead is skipped if anything identifying survived. Fail closed.
//
// Deterministic score and zone come from the CRM row (Pipeline.financial_zone is the
// authoritative zone; the score is Leads."Diagnostic Score" or raw.diagnostic.score). They
// are carried on the item, never asked of the model, and never overwritten downstream.

// ---- PII-safe projection core (mirror of n8n/src/lead-intake/ai-safe-projection.js) ------
const FORBIDDEN_KEY = /(e?mail|phone|tel(?:egram|ephone)?$|telegram|whatsapp|viber|contact|first_?name|last_?name|full_?name|^name$|company$|company_name|lead_?id|request_?id|client_?id|session_?id|^sid$|^ga_|utm_|consent|referrer|url|href|link|ip_?addr|user_?agent|cookie|token|password|initdata|chat_?id|user_?id)/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const HANDLE_RE = /(^|\s)@[A-Za-z0-9_]{3,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;
// A digit run is a phone unless it is a thousands-grouped amount ("1 200 000", "1.200.000",
// "1,200,000") that does not start with "+", "(" or a leading zero. Amounts are business facts
// the analysis must be allowed to cite; phones never are.
const MONEY_GROUPED = /^\d{1,3}(?:[ .,]\d{3})+$/;
function looksLikePhone(token) {
  const t = String(token).trim();
  if (/^[+(0]/.test(t)) return true;
  if (MONEY_GROUPED.test(t)) return false;
  return true;
}
const MAX_STRING = 700;
const MAX_ARRAY = 40;
const MAX_DEPTH = 6;

function scrubString(value) {
  return String(value)
    .replace(EMAIL_RE, '[contact removed]')
    .replace(URL_RE, '[link removed]')
    .replace(HANDLE_RE, '$1[handle removed]')
    .replace(PHONE_RE, m => looksLikePhone(m) ? '[contact removed]' : m)
    .slice(0, MAX_STRING);
}
function sanitize(value, depth) {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') { const c = scrubString(value).trim(); return c === '' ? undefined : c; }
  if (Array.isArray(value)) {
    const out = [];
    for (const e of value.slice(0, MAX_ARRAY)) { const c = sanitize(e, depth + 1); if (c !== undefined) out.push(c); }
    return out.length ? out : undefined;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) { if (FORBIDDEN_KEY.test(k)) continue; const c = sanitize(value[k], depth + 1); if (c !== undefined) out[k] = c; }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
const DETECT_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DETECT_URL = /\b(?:https?:\/\/|www\.)\S+/i;
function projectionLeak(projection) {
  const text = JSON.stringify(projection);
  if (DETECT_EMAIL.test(text)) return 'email-shaped value';
  const phoneish = (text.match(PHONE_RE) || []).filter(looksLikePhone);
  if (phoneish.length) return 'phone-shaped value';
  if (DETECT_URL.test(text)) return 'url';
  for (const key of ['ga_client_id', 'ga_session_id', 'analytics_consent', 'request_id', 'lead_id', 'telegram', 'email', 'phone']) {
    if (text.includes('"' + key + '"')) return 'forbidden key ' + key;
  }
  return '';
}

// ---- helpers --------------------------------------------------------------------------
function pick(...values) { for (const v of values) { if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; }
function num(v) { const n = Number(v); return (String(v ?? '').trim() !== '' && Number.isFinite(n)) ? n : null; }
function asArray(x) { if (!x) return []; if (Array.isArray(x)) return x.map(String).filter(s => s.trim()); if (typeof x === 'string') return x.split(',').map(s => s.trim()).filter(Boolean); return [String(x)]; }

function detectLocale(pipe, raw, leadRow) {
  const meta = raw.meta || {};
  const pages = [meta.page_url, pipe.source_page, raw.page_url, raw.source_page, leadRow['Page URL']].map(x => String(x || '').toLowerCase());
  if (String(meta.site_language || raw.site_language || raw.locale || (raw.premium && raw.premium.locale) || '').toLowerCase().startsWith('ro')) return 'ro';
  if (pages.some(p => p.includes('/ro/'))) return 'ro';
  const lang = String(pick(leadRow['Language'], raw.client && raw.client.language)).toLowerCase();
  if (/румын|român|romana|\bro\b/.test(lang)) return 'ro';
  return 'ru';
}

const ALLOWED_PRODUCTS = ['FINANCIAL_HEALTH_CHECK', 'BUSINESS_CONTROL_SYSTEM', 'MONTHLY_CFO_SUPPORT', 'DISCOVERY_CALL'];

const CONTRACT = {
  executive_summary: 'string, 3-6 sentences',
  financial_maturity: { score_1_to_5: 'integer 1-5', label: 'string', rationale: 'string' },
  key_risks: [{ category: 'string', title: 'string', evidence: 'string — only facts from the input', potential_impact: 'string', priority: 'HIGH|MEDIUM|LOW' }],
  data_gaps: [{ missing_information: 'string', why_it_matters: 'string', how_to_obtain: 'string' }],
  management_priorities: ['string (max 3)'],
  plan_30_days: {
    days_1_7: [{ action: 'string', owner_role: 'string', expected_output: 'string', control_or_kpi: 'string', priority: 'HIGH|MEDIUM|LOW' }],
    days_8_14: ['same shape'], days_15_21: ['same shape'], days_22_30: ['same shape']
  },
  tomorrow_actions: ['string (max 3)'],
  documents_required: ['string'],
  recommended_next_step: { product: ALLOWED_PRODUCTS.join('|'), rationale: 'string' },
  confidence: 'HIGH|MEDIUM|LOW',
  limitations: ['string']
};

function systemPrompt(locale) {
  if (locale === 'ro') {
    return [
      'Ești FINMENTOR CFO Analyst — director financiar cu experiență în management financiar pentru IMM-uri din Republica Moldova și România.',
      'Sarcina: interpretezi rezultatul unui Test de sănătate financiară FINMENTOR și pregătești o evaluare financiară preliminară și un plan de acțiune financiară pentru 30 de zile.',
      'REGULI STRICTE:',
      '1. Scorul (0–100) și zona sunt CALCULATE DETERMINIST și îți sunt date. Nu le recalcula, nu le contesta, nu le modifica.',
      '2. Nu inventa cifre: fără venituri, solduri de numerar, datorii, marje, expuneri fiscale sau situații financiare care nu apar explicit în date. Dacă o informație lipsește, scrie exact «DATE INSUFICIENTE» în locul ei și adaug-o la data_gaps.',
      '3. Nu formula concluzii juridice sau fiscale. Nu promite rezultate financiare garantate.',
      '4. Separă faptele (din date) de ipoteze; ipotezele se marchează cu «ipoteză:».',
      '5. Datele sunt anonimizate: nu te adresa persoanei pe nume și nu cere date de contact.',
      '6. Scrie în limba română profesională, registru formal (dumneavoastră). Termenii englezești apar doar în paranteză la prima menționare, de ex. «Flux de numerar (Cash Flow)».',
      '7. Terminologie: Flux de numerar, Cont managerial de profit și pierdere (P&L), Capital circulant, Creanțe, Datorii către furnizori, Lichiditate, Rentabilitate, Raportare managerială, Panou de indicatori-cheie.',
      '8. Produse FINMENTOR permise pentru recommended_next_step.product: ' + ALLOWED_PRODUCTS.join(', ') + '.',
      '9. Răspunde STRICT cu un singur obiect JSON conform contractului. Fără markdown, fără text înainte sau după JSON.'
    ].join('\n');
  }
  return [
    'Ты — FINMENTOR CFO Analyst: финансовый директор с опытом управленческого учёта для малого и среднего бизнеса Молдовы и Румынии.',
    'Задача: интерпретировать результат Финансового рентгена бизнеса (Financial X-Ray) FINMENTOR и подготовить предварительный финансовый анализ и план финансовых действий на 30 дней.',
    'ЖЁСТКИЕ ПРАВИЛА:',
    '1. Оценка (0–100) и зона РАССЧИТАНЫ ДЕТЕРМИНИРОВАННО и переданы тебе. Не пересчитывай, не оспаривай и не меняй их.',
    '2. Не выдумывай цифры: никакой выручки, остатков денег, долгов, маржи, налоговых рисков или финансовой отчётности, которых нет в данных явно. Если информации нет — пиши ровно «НЕДОСТАТОЧНО ДАННЫХ» и добавь пункт в data_gaps.',
    '3. Не делай юридических и налоговых заключений. Не обещай гарантированный финансовый результат.',
    '4. Отделяй факты (из данных) от гипотез; гипотезы помечай словом «гипотеза:».',
    '5. Данные обезличены: не обращайся к человеку по имени и не запрашивай контакты.',
    '6. Пиши на профессиональном экономическом русском языке. Английские термины — только в скобках при первом упоминании, например «Движение денежных средств (Cash Flow)».',
    '7. Терминология: Движение денежных средств, Управленческий отчёт о прибылях и убытках (P&L), Оборотный капитал, Дебиторская задолженность, Кредиторская задолженность, Ликвидность, Рентабельность, Управленческая отчётность, Панель ключевых показателей.',
    '8. Допустимые продукты FINMENTOR для recommended_next_step.product: ' + ALLOWED_PRODUCTS.join(', ') + '.',
    '9. Верни СТРОГО один JSON-объект по контракту. Без markdown, без текста до и после JSON.'
  ].join('\n');
}

function userPrompt(locale, facts, projection) {
  const head = locale === 'ro'
    ? 'DATE DETERMINISTE (nu se modifică):'
    : 'ДЕТЕРМИНИРОВАННЫЕ ДАННЫЕ (не изменяются):';
  const body = locale === 'ro' ? 'RĂSPUNSURILE ȘI CONTEXTUL AFACERII (anonimizate):' : 'ОТВЕТЫ И КОНТЕКСТ БИЗНЕСА (обезличено):';
  const tail = locale === 'ro'
    ? 'CONTRACT JSON (respectă exact cheile; maxim 5 key_risks, maxim 3 management_priorities, maxim 3 tomorrow_actions; fiecare săptămână 2–4 acțiuni):'
    : 'JSON-КОНТРАКТ (соблюдай ключи точно; не более 5 key_risks, не более 3 management_priorities, не более 3 tomorrow_actions; в каждой неделе 2–4 действия):';
  return [head, JSON.stringify(facts, null, 2), '', body, JSON.stringify(projection, null, 2), '', tail, JSON.stringify(CONTRACT, null, 2)].join('\n');
}

// ---- pairing --------------------------------------------------------------------------
const leadRows = $input.all().map(i => i.json).filter(r => r && !r.error);
const byLeadId = {};
for (const r of leadRows) { const id = String(r['Lead ID'] || r.lead_id || '').trim(); if (id && !byLeadId[id]) byLeadId[id] = r; }

const pending = $('Select Pending Leads').all().map(i => i.json);
const out = [];

for (const pipe of pending) {
  const leadId = String(pipe.lead_id || '').trim();
  const leadRow = byLeadId[leadId] || {};
  let raw = {};
  try { raw = leadRow['Raw JSON'] ? JSON.parse(leadRow['Raw JSON']) : {}; } catch (e) { raw = {}; }
  if (!raw || typeof raw !== 'object') raw = {};

  const locale = detectLocale(pipe, raw, leadRow);
  const diagnostic = raw.diagnostic || {};
  const score = num(pick(diagnostic.score, leadRow['Diagnostic Score']));
  // Bounded vocabulary: anything outside the five zones is UNKNOWN, never a free string in the prompt.
  const zoneRaw = String(pick(pipe.financial_zone, diagnostic.traffic_light, leadRow['Financial Zone'], 'UNKNOWN')).trim().toUpperCase();
  const zone = ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN'].includes(zoneRaw) ? zoneRaw : 'UNKNOWN';
  const tool = String(pick(raw.tool, leadRow['Tool'], pipe.source_page && String(pipe.source_page).includes('questionnaire') ? 'xray_extended' : '')).toLowerCase();
  const sourceChannel = tool.includes('xray') ? 'website_xray' : tool.includes('mini_scan') ? 'website_mini_scan' : (raw.premium || raw.brief || /miniapp|concierge|telegram/.test(String(raw.source || ''))) ? 'telegram_premium' : 'other';

  const facts = {
    deterministic_score_0_100: score === null ? 'INSUFFICIENT DATA' : score,
    deterministic_zone: zone,
    scored_by_xray_questionnaire: score !== null,
    risk_zones_from_questionnaire: asArray(diagnostic.risk_zones).slice(0, 5),
    business_model: pick(pipe.business_model, diagnostic.business_model),
    industry_category: pick(pipe.industry_category),
    turnover_range: pick(pipe.turnover_range),
    employees_range: pick(pipe.employees_range),
    urgency: pick(diagnostic.urgency, pipe.urgency),
    lead_priority_internal: pick(pipe.priority),
    main_pain: pick(pipe.main_pain, diagnostic.main_pain),
    selected_problems: asArray(pipe.selected_problems),
    selected_goals: asArray(pipe.selected_goals),
    documents_status: pick(pipe.documents_status),
    documents_available: asArray(pipe.selected_documents),
    work_interest: asArray(pipe.work_interest),
    data_quality: pick(leadRow['Data Quality Hint'], raw.completion && raw.completion.data_quality_hint),
    completion_score_percent: (function (n) { return n !== null && n >= 0 && n <= 100 ? Math.round(n) : null; })(num(raw.completion && raw.completion.completion_score)),
    critical_flags: pick(pipe.critical_flags),
    locale
  };

  const projection = {};
  for (const section of ['answers', 'signals', 'diagnostic', 'business_profile', 'completion', 'main_pain', 'financial_system', 'intake', 'premium', 'brief']) {
    const clean = sanitize(raw[section], 1);
    if (clean !== undefined) projection[section] = clean;
  }
  const factsClean = sanitize(facts, 1) || {};
  const leak = projectionLeak({ facts: factsClean, projection });
  if (leak) continue; // fail closed: this lead is skipped this run and stays pending

  out.push({
    json: {
      lead_id: leadId,
      request_id: String(pipe.request_id || ''),
      locale,
      source_channel: sourceChannel,
      company: String(pipe.company || ''),
      created_at_lead: String(pipe.created_at || ''),
      score: score,
      zone,
      analysis_version: 'xray-v2',
      risk_zones: facts.risk_zones_from_questionnaire,
      input_digest_text: JSON.stringify({ facts: factsClean, projection }),
      ai_model: String(($('Settings to Object').first().json.settings || {}).xray_ai_model || 'gpt-4.1'),
      ai_system_prompt: systemPrompt(locale),
      ai_user_prompt: userPrompt(locale, factsClean, projection)
    }
  });
}

return out;
