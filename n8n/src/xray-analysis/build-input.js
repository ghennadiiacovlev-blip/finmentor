// FINMENTOR X-Ray Analysis — "Build Analysis Input".
//
// Input:  $input = Leads rows matched by "Lead ID" (0..N), $('Select Pending Leads') = the
//         Pipeline rows being analysed.
// Output: one item per pending lead carrying the deterministic facts, the PII-safe
//         projection, the locale, the prompts and the JSON contract the model must return.
//
// The model NEVER receives the raw lead object.  The projection below is an explicit,
// closed allowlist of bounded questionnaire codes and deterministic numeric facts.  Free
// text is deliberately excluded: removing forbidden keys from an otherwise arbitrary
// object is not an adequate privacy boundary.
//
// Deterministic score and zone come from the CRM row (Pipeline.financial_zone is the
// authoritative zone; the score is Leads."Diagnostic Score" or raw.diagnostic.score). They
// are carried on the item, never asked of the model, and never overwritten downstream.

// ---- PII-safe projection core ----------------------------------------------------------
const ZONES = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN']);
const RISK_CODES = new Set([
  'cash_flow', 'liquidity', 'margin', 'profitability', 'working_capital',
  'receivables', 'payables', 'debt', 'tax', 'reporting', 'budgeting',
  'payment_calendar', 'management_accounting', 'kpi_dashboard'
]);
const BUSINESS_CODES = new Set([
  'retail', 'wholesale', 'ecommerce', 'services', 'professional_services', 'it',
  'manufacturing', 'construction', 'transport', 'horeca', 'agriculture',
  'real_estate', 'commerce', 'production', 'other', 'unknown'
]);
const PRIORITY_CODES = new Set(['HOT', 'WARM', 'COLD', 'INCOMPLETE']);
const DATA_QUALITY_CODES = new Set(['high', 'medium', 'low', 'ok', 'incomplete', 'unknown']);

function enumCode(value, allowed, transform) {
  const raw = String(value === undefined || value === null ? '' : value).trim();
  const code = transform === 'upper' ? raw.toUpperCase() : raw.toLowerCase();
  return allowed.has(code) ? code : undefined;
}
function boundedPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : undefined;
}
function safeRiskCodes(value) {
  return asArray(value).map(v => enumCode(v, RISK_CODES)).filter(Boolean).slice(0, 5);
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
// This code runs once for each item that WON the database claim.  Never enumerate the
// earlier pending list here: doing so would let a losing execution analyse another item.
const claim = $('Analysis Claim Verdict').item.json;
const leadId = String(claim.lead_id || '').trim();
const pipe = $('Select Pending Leads').all().map(i => i.json).find(r => String(r.lead_id || '').trim() === leadId) || {};
const leadRow = $input.first().json || {};
if (!leadId || Number(claim.claim_won) !== 1 || (leadRow && leadRow.error)) throw new Error('XRAY_INPUT_AUTHORITY_UNAVAILABLE');

{
  let raw = {};
  try { raw = leadRow['Raw JSON'] ? JSON.parse(leadRow['Raw JSON']) : {}; } catch (e) { raw = {}; }
  if (!raw || typeof raw !== 'object') raw = {};

  const locale = detectLocale(pipe, raw, leadRow);
  const diagnostic = raw.diagnostic || {};
  const score = num(pick(diagnostic.score, leadRow['Diagnostic Score']));
  const zone = enumCode(pick(pipe.financial_zone, diagnostic.traffic_light, leadRow['Financial Zone'], 'UNKNOWN'), ZONES, 'upper') || 'UNKNOWN';
  const tool = String(pick(raw.tool, leadRow['Tool'], pipe.source_page && String(pipe.source_page).includes('questionnaire') ? 'xray_extended' : '')).toLowerCase();
  const sourceChannel = tool.includes('xray') ? 'website_xray' : tool.includes('mini_scan') ? 'website_mini_scan' : (raw.premium || raw.brief || /miniapp|concierge|telegram/.test(String(raw.source || ''))) ? 'telegram_premium' : 'other';

  // Closed allowlist.  In particular, company/name/address/contact fields, request/GA ids,
  // URLs and every free-text answer have no path into this object.
  const facts = {
    deterministic_score_0_100: score === null ? 'INSUFFICIENT DATA' : score,
    deterministic_zone: zone,
    scored_by_xray_questionnaire: score !== null,
    risk_zones_from_questionnaire: safeRiskCodes(diagnostic.risk_zones),
    business_model_code: enumCode(pick(diagnostic.business_model_key, pipe.industry_category), BUSINESS_CODES),
    lead_priority_code: enumCode(pipe.priority, PRIORITY_CODES, 'upper'),
    data_quality_code: enumCode(pick(leadRow['Data Quality Hint'], raw.completion && raw.completion.data_quality_hint), DATA_QUALITY_CODES),
    completion_score_percent: boundedPercent(raw.completion && raw.completion.completion_score),
    locale
  };
  for (const key of Object.keys(facts)) if (facts[key] === undefined || (Array.isArray(facts[key]) && !facts[key].length)) delete facts[key];
  const projection = { approved_business_financial_facts: facts };

  return {
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
      claim_key: leadId + '|xray-v2',
      risk_zones: facts.risk_zones_from_questionnaire || [],
      input_digest_text: JSON.stringify(projection),
      ai_model: String(($('Settings to Object').first().json.settings || {}).xray_ai_model || 'gpt-4.1'),
      ai_system_prompt: systemPrompt(locale),
      ai_user_prompt: userPrompt(locale, facts, projection)
    }
  };
}
