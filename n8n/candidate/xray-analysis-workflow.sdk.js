import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const sweepTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger', version: 1.4,
  config: { name: 'Every 10 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } } },
  output: [{}]
});

const readSettings = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Settings', executeOnce: true, retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":1871239368,"mode":"list","cachedResultName":"Settings"}, options: {} },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ key: 'owner_chat_id', value: '' }]
});

const settingsToObject = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Settings to Object', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// FINMENTOR X-Ray Analysis — Settings (key/value rows) -> config object.\n// Deployed as the n8n Code node \"Settings to Object\" in the X-Ray Analysis workflow.\n// The Settings tab is the only source of chat ids; nothing is hard-coded here.\n//\n// New keys read by this workflow (all optional, all with safe defaults):\n//   xray_analysis_enabled  true|false          master switch\n//   xray_ai_model          gpt-4.1             model id for the analysis\n//   xray_analysis_since    ISO timestamp       leads created before it are never analysed\n//   xray_max_per_run       3                   cap per sweep, protects the OpenAI budget\n//   xray_review_base_url   https://.../webhook/finmentor-xray-review   the owner review link\n\nconst rows = $input.all().map(i => i.json);\nconst s = {};\nfor (const r of rows) {\n  const k = (r.key ?? r.Key ?? '').toString().trim();\n  if (k) s[k] = (r.value ?? r.Value ?? '').toString().trim();\n}\nfunction bool(v, d) { if (v === undefined || v === '') return d; return ['true', '1', 'yes'].includes(String(v).toLowerCase()); }\nfunction num(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; }\nfunction iso(v, d) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toISOString() : d; }\n\nconst cfg = {\n  owner_chat_id: s.owner_chat_id || '',\n  timezone: s.timezone || 'Europe/Chisinau',\n  xray_analysis_enabled: bool(s.xray_analysis_enabled, true),\n  xray_ai_model: s.xray_ai_model || 'gpt-4.1',\n  xray_analysis_since: iso(s.xray_analysis_since, '2026-09-03T00:00:00.000Z'),\n  xray_max_per_run: Math.min(num(s.xray_max_per_run, 3), 10),\n  xray_review_base_url: s.xray_review_base_url || 'https://ghennadi.app.n8n.cloud/webhook/finmentor-xray-review',\n  crm_url: 'https://docs.google.com/spreadsheets/d/1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A/edit'\n};\nreturn [{ json: { settings: cfg } }];\n" } },
  output: [{ settings: { owner_chat_id: '', xray_ai_model: 'gpt-4.1' } }]
});

const readPipeline = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Pipeline', executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":1883973304,"mode":"list","cachedResultName":"Pipeline"}, options: {} },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ lead_id: '', priority: '', status: '', created_at: '' }]
});

const readAnalysis = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read XRay_Analysis', executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":"XRay_Analysis","mode":"name"}, options: {} },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ analysis_id: '', lead_id: '', review_status: '' }]
});

const selectPending = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Select Pending Leads', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// FINMENTOR X-Ray Analysis — \"Select Pending Leads\".\n//\n// Input: the XRay_Analysis rows ($input), plus Pipeline rows and settings read by name.\n// Output: at most xray_max_per_run Pipeline rows that have NO analysis row yet.\n//\n// FAIL CLOSED. If the XRay_Analysis read errored, nothing is pending: analysing on top of an\n// unreadable ledger would re-run the model and re-alert the owner for every lead.\n//\n// Consent gate. INCOMPLETE leads (no valid contact or no explicit consent) are never sent to\n// the model; Normalize + Score Lead sets that priority exactly when consent is missing.\n\nconst cfg = $('Settings to Object').first().json.settings || {};\nif (cfg.xray_analysis_enabled === false) return [];\n\nconst analysisItems = $input.all().map(i => i.json);\nif (analysisItems.some(r => r && r.error)) return [];\nconst analysed = new Set(analysisItems.map(r => String(r.lead_id || '').trim()).filter(Boolean));\n\nconst pipelineItems = $('Read Pipeline').all().map(i => i.json);\nif (pipelineItems.some(r => r && r.error)) return [];\n\nconst since = Date.parse(cfg.xray_analysis_since || '') || 0;\nconst cap = Number(cfg.xray_max_per_run) > 0 ? Number(cfg.xray_max_per_run) : 3;\n\nfunction ts(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; }\n\nconst pending = pipelineItems\n  .filter(r => r && String(r.lead_id || '').trim() !== '')\n  .filter(r => !analysed.has(String(r.lead_id).trim()))\n  .filter(r => String(r.priority || '').toUpperCase() !== 'INCOMPLETE')\n  .filter(r => String(r.status || '').toLowerCase() !== 'incomplete lead')\n  .filter(r => ts(r.created_at) >= since)\n  .sort((a, b) => ts(a.created_at) - ts(b.created_at))\n  .slice(0, cap);\n\nreturn pending.map(r => ({ json: r }));\n" } },
  output: [{ lead_id: '', priority: '', financial_zone: '', company: '' }]
});

const buildClaim = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Analysis Claim', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Build the only key allowed to claim X-Ray analysis authority.\nconst VERSION = 'xray-v2';\nreturn $input.all().map(item => {\n  const leadId = String(item.json.lead_id || '').trim();\n  if (!leadId) return { json: { claim_valid: false } };\n  return { json: { claim_valid: true, lead_id: leadId, analysis_version: VERSION, claim_key: leadId + '|' + VERSION } };\n});\n" } },
  output: [{ claim_valid: true, lead_id: '', analysis_version: 'xray-v2', claim_key: '' }]
});

const claimAnalysis = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Claim Analysis Authority', onError: 'stopWorkflow',
    parameters: { operation: 'executeQuery', query: "with ins as (\n  insert into public.finmentor_xray_analysis_claims (lead_id, analysis_version, claim_key)\n  values ($1, $2, $3)\n  on conflict (lead_id, analysis_version) do nothing\n  returning claim_key\n) select (select count(*) from ins)::int as claimed",
      options: { queryReplacement: expr('{{ $json.lead_id }},{{ $json.analysis_version }},{{ $json.claim_key }}') } },
    credentials: { postgres: { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' } } },
  output: [{ claimed: 1 }]
});

const claimVerdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Analysis Claim Verdict', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: "// PostgreSQL states the atomic INSERT verdict; row counts or read-before-write never arbitrate.\nconst row = $input.first().json;\nconst claimed = Number(row.claimed);\nconst source = $('Build Analysis Claim').item.json;\nreturn { json: {\n  claim_won: source.claim_valid === true && claimed === 1 ? 1 : 0,\n  lead_id: source.lead_id || '', analysis_version: source.analysis_version || '', claim_key: source.claim_key || ''\n} };\n" } },
  output: [{ claim_won: 1, lead_id: '', analysis_version: 'xray-v2', claim_key: '' }]
});

const ifClaimWon = ifElse({
  version: 2.2,
  config: { name: 'IF Analysis Claim Won', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr('{{ $json.claim_won }}'), operator: { type: 'number', operation: 'equals' }, rightValue: 1 }], combinator: 'and' } } }
});

const readLeadRaw = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Lead Raw', alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":409890193,"mode":"list","cachedResultName":"Leads"},
      filtersUI: { values: [{ lookupColumn: 'Lead ID', lookupValue: expr('{{ $json.lead_id }}') }] }, combineFilters: 'AND', options: {} },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ 'Lead ID': '', 'Raw JSON': '{}', 'Diagnostic Score': '' }]
});

const buildInput = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Analysis Input', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: "// FINMENTOR X-Ray Analysis — \"Build Analysis Input\".\n//\n// Input:  $input = Leads rows matched by \"Lead ID\" (0..N), $('Select Pending Leads') = the\n//         Pipeline rows being analysed.\n// Output: one item per pending lead carrying the deterministic facts, the PII-safe\n//         projection, the locale, the prompts and the JSON contract the model must return.\n//\n// The model NEVER receives the raw lead object.  The projection below is an explicit,\n// closed allowlist of bounded questionnaire codes and deterministic numeric facts.  Free\n// text is deliberately excluded: removing forbidden keys from an otherwise arbitrary\n// object is not an adequate privacy boundary.\n//\n// Deterministic score and zone come from the CRM row (Pipeline.financial_zone is the\n// authoritative zone; the score is Leads.\"Diagnostic Score\" or raw.diagnostic.score). They\n// are carried on the item, never asked of the model, and never overwritten downstream.\n\n// ---- PII-safe projection core ----------------------------------------------------------\nconst ZONES = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN']);\nconst RISK_CODES = new Set([\n  'cash_flow', 'liquidity', 'margin', 'profitability', 'working_capital',\n  'receivables', 'payables', 'debt', 'tax', 'reporting', 'budgeting',\n  'payment_calendar', 'management_accounting', 'kpi_dashboard'\n]);\nconst BUSINESS_CODES = new Set([\n  'retail', 'wholesale', 'ecommerce', 'services', 'professional_services', 'it',\n  'manufacturing', 'construction', 'transport', 'horeca', 'agriculture',\n  'real_estate', 'commerce', 'production', 'other', 'unknown'\n]);\nconst PRIORITY_CODES = new Set(['HOT', 'WARM', 'COLD', 'INCOMPLETE']);\nconst DATA_QUALITY_CODES = new Set(['high', 'medium', 'low', 'ok', 'incomplete', 'unknown']);\n\nfunction enumCode(value, allowed, transform) {\n  const raw = String(value === undefined || value === null ? '' : value).trim();\n  const code = transform === 'upper' ? raw.toUpperCase() : raw.toLowerCase();\n  return allowed.has(code) ? code : undefined;\n}\nfunction boundedPercent(value) {\n  const n = Number(value);\n  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : undefined;\n}\nfunction safeRiskCodes(value) {\n  return asArray(value).map(v => enumCode(v, RISK_CODES)).filter(Boolean).slice(0, 5);\n}\n\n// ---- helpers --------------------------------------------------------------------------\nfunction pick(...values) { for (const v of values) { if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return ''; }\nfunction num(v) { const n = Number(v); return (String(v ?? '').trim() !== '' && Number.isFinite(n)) ? n : null; }\nfunction asArray(x) { if (!x) return []; if (Array.isArray(x)) return x.map(String).filter(s => s.trim()); if (typeof x === 'string') return x.split(',').map(s => s.trim()).filter(Boolean); return [String(x)]; }\n\nfunction detectLocale(pipe, raw, leadRow) {\n  const meta = raw.meta || {};\n  const pages = [meta.page_url, pipe.source_page, raw.page_url, raw.source_page, leadRow['Page URL']].map(x => String(x || '').toLowerCase());\n  if (String(meta.site_language || raw.site_language || raw.locale || (raw.premium && raw.premium.locale) || '').toLowerCase().startsWith('ro')) return 'ro';\n  if (pages.some(p => p.includes('/ro/'))) return 'ro';\n  const lang = String(pick(leadRow['Language'], raw.client && raw.client.language)).toLowerCase();\n  if (/румын|român|romana|\\bro\\b/.test(lang)) return 'ro';\n  return 'ru';\n}\n\nconst ALLOWED_PRODUCTS = ['FINANCIAL_HEALTH_CHECK', 'BUSINESS_CONTROL_SYSTEM', 'MONTHLY_CFO_SUPPORT', 'DISCOVERY_CALL'];\n\nconst CONTRACT = {\n  executive_summary: 'string, 3-6 sentences',\n  financial_maturity: { score_1_to_5: 'integer 1-5', label: 'string', rationale: 'string' },\n  key_risks: [{ category: 'string', title: 'string', evidence: 'string — only facts from the input', potential_impact: 'string', priority: 'HIGH|MEDIUM|LOW' }],\n  data_gaps: [{ missing_information: 'string', why_it_matters: 'string', how_to_obtain: 'string' }],\n  management_priorities: ['string (max 3)'],\n  plan_30_days: {\n    days_1_7: [{ action: 'string', owner_role: 'string', expected_output: 'string', control_or_kpi: 'string', priority: 'HIGH|MEDIUM|LOW' }],\n    days_8_14: ['same shape'], days_15_21: ['same shape'], days_22_30: ['same shape']\n  },\n  tomorrow_actions: ['string (max 3)'],\n  documents_required: ['string'],\n  recommended_next_step: { product: ALLOWED_PRODUCTS.join('|'), rationale: 'string' },\n  confidence: 'HIGH|MEDIUM|LOW',\n  limitations: ['string']\n};\n\nfunction systemPrompt(locale) {\n  if (locale === 'ro') {\n    return [\n      'Ești FINMENTOR CFO Analyst — director financiar cu experiență în management financiar pentru IMM-uri din Republica Moldova și România.',\n      'Sarcina: interpretezi rezultatul unui Test de sănătate financiară FINMENTOR și pregătești o evaluare financiară preliminară și un plan de acțiune financiară pentru 30 de zile.',\n      'REGULI STRICTE:',\n      '1. Scorul (0–100) și zona sunt CALCULATE DETERMINIST și îți sunt date. Nu le recalcula, nu le contesta, nu le modifica.',\n      '2. Nu inventa cifre: fără venituri, solduri de numerar, datorii, marje, expuneri fiscale sau situații financiare care nu apar explicit în date. Dacă o informație lipsește, scrie exact «DATE INSUFICIENTE» în locul ei și adaug-o la data_gaps.',\n      '3. Nu formula concluzii juridice sau fiscale. Nu promite rezultate financiare garantate.',\n      '4. Separă faptele (din date) de ipoteze; ipotezele se marchează cu «ipoteză:».',\n      '5. Datele sunt anonimizate: nu te adresa persoanei pe nume și nu cere date de contact.',\n      '6. Scrie în limba română profesională, registru formal (dumneavoastră). Termenii englezești apar doar în paranteză la prima menționare, de ex. «Flux de numerar (Cash Flow)».',\n      '7. Terminologie: Flux de numerar, Cont managerial de profit și pierdere (P&L), Capital circulant, Creanțe, Datorii către furnizori, Lichiditate, Rentabilitate, Raportare managerială, Panou de indicatori-cheie.',\n      '8. Produse FINMENTOR permise pentru recommended_next_step.product: ' + ALLOWED_PRODUCTS.join(', ') + '.',\n      '9. Răspunde STRICT cu un singur obiect JSON conform contractului. Fără markdown, fără text înainte sau după JSON.'\n    ].join('\\n');\n  }\n  return [\n    'Ты — FINMENTOR CFO Analyst: финансовый директор с опытом управленческого учёта для малого и среднего бизнеса Молдовы и Румынии.',\n    'Задача: интерпретировать результат Финансового рентгена бизнеса (Financial X-Ray) FINMENTOR и подготовить предварительный финансовый анализ и план финансовых действий на 30 дней.',\n    'ЖЁСТКИЕ ПРАВИЛА:',\n    '1. Оценка (0–100) и зона РАССЧИТАНЫ ДЕТЕРМИНИРОВАННО и переданы тебе. Не пересчитывай, не оспаривай и не меняй их.',\n    '2. Не выдумывай цифры: никакой выручки, остатков денег, долгов, маржи, налоговых рисков или финансовой отчётности, которых нет в данных явно. Если информации нет — пиши ровно «НЕДОСТАТОЧНО ДАННЫХ» и добавь пункт в data_gaps.',\n    '3. Не делай юридических и налоговых заключений. Не обещай гарантированный финансовый результат.',\n    '4. Отделяй факты (из данных) от гипотез; гипотезы помечай словом «гипотеза:».',\n    '5. Данные обезличены: не обращайся к человеку по имени и не запрашивай контакты.',\n    '6. Пиши на профессиональном экономическом русском языке. Английские термины — только в скобках при первом упоминании, например «Движение денежных средств (Cash Flow)».',\n    '7. Терминология: Движение денежных средств, Управленческий отчёт о прибылях и убытках (P&L), Оборотный капитал, Дебиторская задолженность, Кредиторская задолженность, Ликвидность, Рентабельность, Управленческая отчётность, Панель ключевых показателей.',\n    '8. Допустимые продукты FINMENTOR для recommended_next_step.product: ' + ALLOWED_PRODUCTS.join(', ') + '.',\n    '9. Верни СТРОГО один JSON-объект по контракту. Без markdown, без текста до и после JSON.'\n  ].join('\\n');\n}\n\nfunction userPrompt(locale, facts, projection) {\n  const head = locale === 'ro'\n    ? 'DATE DETERMINISTE (nu se modifică):'\n    : 'ДЕТЕРМИНИРОВАННЫЕ ДАННЫЕ (не изменяются):';\n  const body = locale === 'ro' ? 'RĂSPUNSURILE ȘI CONTEXTUL AFACERII (anonimizate):' : 'ОТВЕТЫ И КОНТЕКСТ БИЗНЕСА (обезличено):';\n  const tail = locale === 'ro'\n    ? 'CONTRACT JSON (respectă exact cheile; maxim 5 key_risks, maxim 3 management_priorities, maxim 3 tomorrow_actions; fiecare săptămână 2–4 acțiuni):'\n    : 'JSON-КОНТРАКТ (соблюдай ключи точно; не более 5 key_risks, не более 3 management_priorities, не более 3 tomorrow_actions; в каждой неделе 2–4 действия):';\n  return [head, JSON.stringify(facts, null, 2), '', body, JSON.stringify(projection, null, 2), '', tail, JSON.stringify(CONTRACT, null, 2)].join('\\n');\n}\n\n// ---- pairing --------------------------------------------------------------------------\n// This code runs once for each item that WON the database claim.  Never enumerate the\n// earlier pending list here: doing so would let a losing execution analyse another item.\nconst claim = $('Analysis Claim Verdict').item.json;\nconst leadId = String(claim.lead_id || '').trim();\nconst pipe = $('Select Pending Leads').all().map(i => i.json).find(r => String(r.lead_id || '').trim() === leadId) || {};\nconst leadRow = $input.first().json || {};\nif (!leadId || Number(claim.claim_won) !== 1 || (leadRow && leadRow.error)) throw new Error('XRAY_INPUT_AUTHORITY_UNAVAILABLE');\n\n{\n  let raw = {};\n  try { raw = leadRow['Raw JSON'] ? JSON.parse(leadRow['Raw JSON']) : {}; } catch (e) { raw = {}; }\n  if (!raw || typeof raw !== 'object') raw = {};\n\n  const locale = detectLocale(pipe, raw, leadRow);\n  const diagnostic = raw.diagnostic || {};\n  const score = num(pick(diagnostic.score, leadRow['Diagnostic Score']));\n  const zone = enumCode(pick(pipe.financial_zone, diagnostic.traffic_light, leadRow['Financial Zone'], 'UNKNOWN'), ZONES, 'upper') || 'UNKNOWN';\n  const tool = String(pick(raw.tool, leadRow['Tool'], pipe.source_page && String(pipe.source_page).includes('questionnaire') ? 'xray_extended' : '')).toLowerCase();\n  const sourceChannel = tool.includes('xray') ? 'website_xray' : tool.includes('mini_scan') ? 'website_mini_scan' : (raw.premium || raw.brief || /miniapp|concierge|telegram/.test(String(raw.source || ''))) ? 'telegram_premium' : 'other';\n\n  // Closed allowlist.  In particular, company/name/address/contact fields, request/GA ids,\n  // URLs and every free-text answer have no path into this object.\n  const facts = {\n    deterministic_score_0_100: score === null ? 'INSUFFICIENT DATA' : score,\n    deterministic_zone: zone,\n    scored_by_xray_questionnaire: score !== null,\n    risk_zones_from_questionnaire: safeRiskCodes(diagnostic.risk_zones),\n    business_model_code: enumCode(pick(diagnostic.business_model_key, pipe.industry_category), BUSINESS_CODES),\n    lead_priority_code: enumCode(pipe.priority, PRIORITY_CODES, 'upper'),\n    data_quality_code: enumCode(pick(leadRow['Data Quality Hint'], raw.completion && raw.completion.data_quality_hint), DATA_QUALITY_CODES),\n    completion_score_percent: boundedPercent(raw.completion && raw.completion.completion_score),\n    locale\n  };\n  for (const key of Object.keys(facts)) if (facts[key] === undefined || (Array.isArray(facts[key]) && !facts[key].length)) delete facts[key];\n  const projection = { approved_business_financial_facts: facts };\n\n  return {\n    json: {\n      lead_id: leadId,\n      request_id: String(pipe.request_id || ''),\n      locale,\n      source_channel: sourceChannel,\n      company: String(pipe.company || ''),\n      created_at_lead: String(pipe.created_at || ''),\n      score: score,\n      zone,\n      analysis_version: 'xray-v2',\n      claim_key: leadId + '|xray-v2',\n      risk_zones: facts.risk_zones_from_questionnaire || [],\n      input_digest_text: JSON.stringify(projection),\n      ai_model: String(($('Settings to Object').first().json.settings || {}).xray_ai_model || 'gpt-4.1'),\n      ai_system_prompt: systemPrompt(locale),\n      ai_user_prompt: userPrompt(locale, facts, projection)\n    }\n  };\n}\n" } },
  output: [{ lead_id: '', locale: 'ru', score: 47, zone: 'ORANGE', ai_model: 'gpt-4.1', ai_system_prompt: '', ai_user_prompt: '' }]
});

const aiAnalysis = node({
  type: '@n8n/n8n-nodes-langchain.openAi', version: 2.3,
  config: { name: 'AI X-Ray Analysis', onError: 'continueErrorOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    parameters: { resource: 'text', operation: 'response',
      modelId: { __rl: true, mode: 'id', value: expr('{{ $json.ai_model }}') },
      responses: { values: [ { role: 'system', content: expr('{{ $json.ai_system_prompt }}') }, { role: 'user', content: expr('{{ $json.ai_user_prompt }}') } ] },
      simplify: true, builtInTools: {},
      options: { temperature: 0.3, maxTokens: 6000, textFormat: { textOptions: { type: 'json_object' } } } },
    credentials: { openAiApi: { id: 'MC2uu5oVRKPe7iIH', name: 'OpenAI account' } } },
  output: [{ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }]
});

const validateRows = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Validate + Store Rows', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// FINMENTOR X-Ray Analysis — strict model-output validator.\n//\n// A model response has only two outcomes:\n//   valid contract -> AI_DRAFT (human review required)\n//   any parse/schema/factual-contract failure -> ANALYSIS_FAILED (never promotable)\n// Score and zone are copied only from Build Analysis Input.\n\n// FINMENTOR X-Ray Analysis — customer/owner labels (machine-readable copy of\n// docs/FINMENTOR_PRODUCT_LANGUAGE_STANDARD.md). Internal codes stay English.\n//\n// Inlined into n8n Code nodes by scripts/build-xray-analysis-workflow.mjs. Keep it free of\n// require() and of anything n8n's sandbox lacks.\n\nconst XRAY_LABELS = {\n  ru: {\n    zone: {\n      GREEN:   { name: 'ЗЕЛЁНАЯ ЗОНА',    line: 'Устойчивый финансовый контроль' },\n      YELLOW:  { name: 'ЖЁЛТАЯ ЗОНА',     line: 'Отдельные зоны требуют усиления' },\n      ORANGE:  { name: 'ОРАНЖЕВАЯ ЗОНА',  line: 'Существенные пробелы в финансовом управлении' },\n      RED:     { name: 'КРАСНАЯ ЗОНА',    line: 'Высокий риск потери финансового контроля' },\n      UNKNOWN: { name: 'ЗОНА НЕ ОПРЕДЕЛЕНА', line: 'Недостаточно данных для оценки' }\n    },\n    product: {\n      FINANCIAL_HEALTH_CHECK:  'Комплексная финансовая диагностика (Financial Health Check)',\n      BUSINESS_CONTROL_SYSTEM: 'Business Control System — система финансового контроля',\n      MONTHLY_CFO_SUPPORT:     'Monthly CFO Support — ежемесячное сопровождение CFO',\n      DISCOVERY_CALL:          'Диагностическая встреча (Discovery Call)'\n    },\n    review: {\n      AI_DRAFT:        'Предварительный анализ ИИ',\n      OWNER_REVIEW:    'Экспертная проверка FINMENTOR',\n      CLIENT_READY:    'Готово для клиента',\n      ANALYSIS_FAILED: 'Анализ не выполнен'\n    },\n    insufficient: 'НЕДОСТАТОЧНО ДАННЫХ',\n    week: ['Неделя 1 (дни 1–7)', 'Неделя 2 (дни 8–14)', 'Неделя 3 (дни 15–21)', 'Неделя 4 (дни 22–30)']\n  },\n  ro: {\n    zone: {\n      GREEN:   { name: 'ZONA VERDE',      line: 'Control financiar stabil' },\n      YELLOW:  { name: 'ZONA GALBENĂ',    line: 'Anumite zone necesită consolidare' },\n      ORANGE:  { name: 'ZONA PORTOCALIE', line: 'Lacune semnificative în managementul financiar' },\n      RED:     { name: 'ZONA ROȘIE',      line: 'Risc ridicat de pierdere a controlului financiar' },\n      UNKNOWN: { name: 'ZONĂ NEDETERMINATĂ', line: 'Date insuficiente pentru evaluare' }\n    },\n    product: {\n      FINANCIAL_HEALTH_CHECK:  'Diagnostic financiar complet (Financial Health Check)',\n      BUSINESS_CONTROL_SYSTEM: 'Business Control System — sistem de control financiar',\n      MONTHLY_CFO_SUPPORT:     'Monthly CFO Support — asistență CFO lunară',\n      DISCOVERY_CALL:          'Întâlnire de diagnostic (Discovery Call)'\n    },\n    review: {\n      AI_DRAFT:        'Analiză preliminară AI',\n      OWNER_REVIEW:    'Verificare de specialist FINMENTOR',\n      CLIENT_READY:    'Pregătit pentru client',\n      ANALYSIS_FAILED: 'Analiza nu a fost realizată'\n    },\n    insufficient: 'DATE INSUFICIENTE',\n    week: ['Săptămâna 1 (zilele 1–7)', 'Săptămâna 2 (zilele 8–14)', 'Săptămâna 3 (zilele 15–21)', 'Săptămâna 4 (zilele 22–30)']\n  }\n};\n\nconst XRAY_PRODUCT_CODES = ['FINANCIAL_HEALTH_CHECK', 'BUSINESS_CONTROL_SYSTEM', 'MONTHLY_CFO_SUPPORT', 'DISCOVERY_CALL'];\nconst XRAY_ZONES = ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN'];\nconst XRAY_REVIEW_STATES = ['AI_DRAFT', 'OWNER_REVIEW', 'CLIENT_READY', 'ANALYSIS_FAILED'];\n\nfunction xrayLocale(value) {\n  return String(value || '').toLowerCase().slice(0, 2) === 'ro' ? 'ro' : 'ru';\n}\n\nfunction xrayZoneLabel(locale, zone) {\n  const L = XRAY_LABELS[xrayLocale(locale)];\n  const z = XRAY_ZONES.includes(String(zone)) ? String(zone) : 'UNKNOWN';\n  return L.zone[z];\n}\n\nconst crypto = require('crypto');\nconst ANALYSIS_VERSION = 'xray-v2';\nconst REQUIRED_TOP = [\n  'executive_summary', 'financial_maturity', 'key_risks', 'data_gaps',\n  'management_priorities', 'plan_30_days', 'tomorrow_actions',\n  'documents_required', 'recommended_next_step', 'confidence', 'limitations'\n];\nconst WEEKS = ['days_1_7', 'days_8_14', 'days_15_21', 'days_22_30'];\nconst LEVELS = ['HIGH', 'MEDIUM', 'LOW'];\n\nfunction plainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }\nfunction validString(v, max) { return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max; }\nfunction boundedString(v, max) { return String(v).trim().slice(0, max); }\nfunction exactKeys(obj, required, optional) {\n  if (!plainObject(obj)) return false;\n  const allowed = new Set(required.concat(optional || []));\n  return required.every(k => Object.prototype.hasOwnProperty.call(obj, k)) && Object.keys(obj).every(k => allowed.has(k));\n}\nfunction extractText(ai) {\n  let c = ai.output?.[0]?.content?.[0]?.text ?? ai.output_text ?? ai.text ?? ai.response ?? ai.message?.content ?? ai.choices?.[0]?.message?.content ?? ai.content ?? '';\n  if (Array.isArray(ai.output)) {\n    const msg = ai.output.find(o => o && o.type === 'message' && Array.isArray(o.content));\n    if (msg) {\n      const t = msg.content.find(x => x && (x.type === 'output_text' || typeof x.text === 'string'));\n      if (t && typeof t.text === 'string') c = t.text;\n    }\n  }\n  return typeof c === 'string' ? c.trim() : '';\n}\n\nfunction validateAction(value, at, errors) {\n  const keys = ['action', 'owner_role', 'expected_output', 'control_or_kpi', 'priority'];\n  if (!exactKeys(value, keys)) { errors.push(at + ': invalid action shape'); return null; }\n  for (const key of keys.slice(0, 4)) if (!validString(value[key], key === 'owner_role' ? 80 : 300)) errors.push(at + '.' + key + ': required bounded string');\n  if (!LEVELS.includes(value.priority)) errors.push(at + '.priority: invalid');\n  if (errors.some(e => e.startsWith(at + '.'))) return null;\n  return {\n    action: boundedString(value.action, 300), owner_role: boundedString(value.owner_role, 80),\n    expected_output: boundedString(value.expected_output, 300), control_or_kpi: boundedString(value.control_or_kpi, 300),\n    priority: value.priority\n  };\n}\n\nfunction validateContract(plan, locale) {\n  const errors = [];\n  if (!exactKeys(plan, REQUIRED_TOP)) return { ok: false, errors: ['top-level schema mismatch'] };\n  if (!validString(plan.executive_summary, 2500)) errors.push('executive_summary: required bounded string');\n\n  const fm = plan.financial_maturity;\n  if (!exactKeys(fm, ['score_1_to_5', 'label', 'rationale'])) errors.push('financial_maturity: invalid shape');\n  else {\n    if (!Number.isInteger(fm.score_1_to_5) || fm.score_1_to_5 < 1 || fm.score_1_to_5 > 5) errors.push('financial_maturity.score_1_to_5: invalid');\n    if (!validString(fm.label, 120) || !validString(fm.rationale, 800)) errors.push('financial_maturity: label/rationale required');\n  }\n\n  if (!Array.isArray(plan.key_risks) || plan.key_risks.length < 1 || plan.key_risks.length > 5) errors.push('key_risks: require 1-5 rows');\n  const risks = [];\n  for (const [i, risk] of (Array.isArray(plan.key_risks) ? plan.key_risks : []).entries()) {\n    const at = 'key_risks[' + i + ']';\n    if (!exactKeys(risk, ['category', 'title', 'evidence', 'potential_impact', 'priority'])) { errors.push(at + ': invalid shape'); continue; }\n    if (![risk.category, risk.title, risk.evidence, risk.potential_impact].every(v => validString(v, 500))) errors.push(at + ': strings required');\n    if (!LEVELS.includes(risk.priority)) errors.push(at + '.priority: invalid');\n    risks.push({ category: boundedString(risk.category, 80), title: boundedString(risk.title, 160), evidence: boundedString(risk.evidence, 500), potential_impact: boundedString(risk.potential_impact, 500), priority: risk.priority });\n  }\n\n  if (!Array.isArray(plan.data_gaps) || plan.data_gaps.length > 8) errors.push('data_gaps: require array of at most 8');\n  const gaps = [];\n  for (const [i, gap] of (Array.isArray(plan.data_gaps) ? plan.data_gaps : []).entries()) {\n    if (!exactKeys(gap, ['missing_information', 'why_it_matters', 'how_to_obtain']) ||\n        !validString(gap.missing_information, 200) || !validString(gap.why_it_matters, 400) || !validString(gap.how_to_obtain, 300)) errors.push('data_gaps[' + i + ']: invalid shape');\n    else gaps.push({ missing_information: gap.missing_information.trim(), why_it_matters: gap.why_it_matters.trim(), how_to_obtain: gap.how_to_obtain.trim() });\n  }\n\n  function stringList(value, name, min, max, each) {\n    if (!Array.isArray(value) || value.length < min || value.length > max || !value.every(v => validString(v, each))) { errors.push(name + ': invalid list'); return []; }\n    return value.map(v => v.trim());\n  }\n  const priorities = stringList(plan.management_priorities, 'management_priorities', 1, 3, 300);\n  const tomorrow = stringList(plan.tomorrow_actions, 'tomorrow_actions', 1, 3, 300);\n  const documents = stringList(plan.documents_required, 'documents_required', 0, 10, 200);\n  const limitations = stringList(plan.limitations, 'limitations', 0, 8, 300);\n\n  if (!exactKeys(plan.plan_30_days, WEEKS)) errors.push('plan_30_days: all four periods required');\n  const plan30 = {};\n  for (const week of WEEKS) {\n    const actions = plainObject(plan.plan_30_days) ? plan.plan_30_days[week] : null;\n    if (!Array.isArray(actions) || actions.length < 2 || actions.length > 4) { errors.push('plan_30_days.' + week + ': require 2-4 actions'); plan30[week] = []; continue; }\n    plan30[week] = actions.map((a, i) => validateAction(a, 'plan_30_days.' + week + '[' + i + ']', errors)).filter(Boolean);\n  }\n\n  const step = plan.recommended_next_step;\n  if (!exactKeys(step, ['product', 'rationale']) || !XRAY_PRODUCT_CODES.includes(step.product) || !validString(step.rationale, 600)) errors.push('recommended_next_step: invalid');\n  if (!LEVELS.includes(plan.confidence)) errors.push('confidence: invalid');\n\n  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };\n  return { ok: true, value: {\n    executive_summary: plan.executive_summary.trim(),\n    financial_maturity: { score_1_to_5: fm.score_1_to_5, label: fm.label.trim(), rationale: fm.rationale.trim() },\n    key_risks: risks, data_gaps: gaps, management_priorities: priorities,\n    plan_30_days: plan30, tomorrow_actions: tomorrow, documents_required: documents,\n    recommended_next_step: { product: step.product, label: XRAY_LABELS[locale].product[step.product], rationale: step.rationale.trim() },\n    confidence: plan.confidence, limitations\n  } };\n}\n\n// Every currency/percentage/large-number assertion in narrative or action text must already\n// exist in the approved input projection.  Derived maturity scoring is deliberately excluded.\nconst FIGURE_RE = /\\b\\d[\\d .,]*(?:%|EUR|USD|MDL|RON|lei|euro|million|milioane|млн|лей|леев)\\b|\\b\\d{4,}\\b/giu;\nfunction figureTokens(value) {\n  const set = new Set();\n  for (const match of String(value || '').match(FIGURE_RE) || []) set.add(match.replace(/[\\s.,]/g, '').toLowerCase());\n  return set;\n}\nfunction factualView(a) {\n  return {\n    executive_summary: a.executive_summary, key_risks: a.key_risks, data_gaps: a.data_gaps,\n    management_priorities: a.management_priorities, plan_30_days: a.plan_30_days,\n    tomorrow_actions: a.tomorrow_actions, documents_required: a.documents_required,\n    recommended_next_step: a.recommended_next_step, limitations: a.limitations\n  };\n}\nfunction fabricationFlags(inputText, analysis) {\n  const input = figureTokens(inputText); const output = figureTokens(JSON.stringify(factualView(analysis))); const flags = [];\n  for (const token of output) if (!input.has(token)) flags.push(token);\n  return flags.slice(0, 12);\n}\n\nfunction ownerAlert(inp, a, row, cfg) {\n  const L = XRAY_LABELS.ru;\n  const zone = L.zone[XRAY_ZONES.includes(row.zone) ? row.zone : 'UNKNOWN'];\n  const text = [\n    'ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ', '',\n    'Компания: ' + (inp.company || '—'),\n    'Язык клиента: ' + (row.locale === 'ro' ? 'RO' : 'RU'), '',\n    'Оценка финансового управления: ' + (row.score === '' ? 'нет данных' : row.score + ' из 100'),\n    'Зона: ' + zone.name + ' — ' + zone.line, '',\n    'Основной риск: ' + a.key_risks[0].title,\n    'Зрелость финансового управления: ' + row.maturity_score + ' из 5', '',\n    'План на 30 дней: ГОТОВ К ПРОВЕРКЕ',\n    'Следующий шаг: ' + a.recommended_next_step.label, '',\n    'Статус: ' + L.review.AI_DRAFT,\n    'Lead ID: ' + row.lead_id\n  ].join('\\n').replace(/[<>]/g, '').slice(0, 3900);\n  const reviewUrl = String(cfg.xray_review_base_url || '') + '?a=' + encodeURIComponent(row.analysis_id) + '&t=' + encodeURIComponent(row.review_token);\n  return { text, review_url: reviewUrl, crm_url: String(cfg.crm_url || '') };\n}\n\nfunction failedOutput(inp, now, errors) {\n  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();\n  const row = {\n    analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale: inp.locale === 'ro' ? 'ro' : 'ru',\n    created_at: now, analysis_version: inp.analysis_version || ANALYSIS_VERSION, model: inp.ai_model || '',\n    score: inp.score === null || inp.score === undefined ? '' : inp.score,\n    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN', maturity_score: '', primary_risk: '',\n    analysis_json: '', plan_30d_json: '', review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', review_token_expires_at: '',\n    confidence: '', fabrication_flags: '', validation_errors: errors.join('; ').slice(0, 1200), source_channel: inp.source_channel || '',\n    executive_summary: 'ANALYSIS_FAILED: MODEL_OUTPUT_INVALID', recommended_next_step: '', next_step_label: '', customer_notified_at: ''\n  };\n  return { is_valid: false, claim_key: inp.claim_key || (inp.lead_id + '|' + (inp.analysis_version || ANALYSIS_VERSION)), claim_state: 'ANALYSIS_FAILED', analysis_row: row,\n    pipeline_row: { lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_analysis_status: 'ANALYSIS_FAILED', updated_at: now, last_activity_at: now },\n    owner_text: 'ФИНАНСОВЫЙ РЕНТГЕН · ОШИБКА АНАЛИЗА\\nLead ID: ' + inp.lead_id + '\\nПричина: MODEL_OUTPUT_INVALID' };\n}\n\nconst cfg = (function () { try { return $('Settings to Object').first().json.settings || {}; } catch (e) { return {}; } })();\nconst inputs = $('Build Analysis Input').all().map(i => i.json);\nconst responses = $input.all().map(i => i.json);\nconst now = new Date().toISOString();\nconst out = [];\n\nfor (let idx = 0; idx < responses.length; idx++) {\n  const inp = inputs[idx]; if (!inp) continue;\n  const locale = XRAY_LABELS[inp.locale] ? inp.locale : 'ru';\n  const text = extractText(responses[idx] || {});\n  let parsed;\n  try { parsed = JSON.parse(text); }\n  catch (e) { out.push({ json: failedOutput(inp, now, ['invalid JSON']) }); continue; }\n  const checked = validateContract(parsed, locale);\n  if (!checked.ok) { out.push({ json: failedOutput(inp, now, checked.errors) }); continue; }\n  const a = checked.value;\n  const flags = fabricationFlags(inp.input_digest_text || '', a);\n  if (flags.length) { out.push({ json: failedOutput(inp, now, ['factual contract violation: ' + flags.join(', ')]) }); continue; }\n\n  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + crypto.randomBytes(8).toString('hex').toUpperCase();\n  const reviewToken = crypto.randomBytes(32).toString('hex');\n  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();\n  const row = {\n    analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale, created_at: now,\n    analysis_version: inp.analysis_version || ANALYSIS_VERSION, model: inp.ai_model || '',\n    score: inp.score === null || inp.score === undefined ? '' : inp.score,\n    zone: XRAY_ZONES.includes(inp.zone) ? inp.zone : 'UNKNOWN', maturity_score: a.financial_maturity.score_1_to_5,\n    primary_risk: a.key_risks[0].title, analysis_json: JSON.stringify(a).slice(0, 45000),\n    plan_30d_json: JSON.stringify(a.plan_30_days).slice(0, 45000), review_status: 'AI_DRAFT', reviewed_at: '',\n    review_token: reviewToken, review_token_expires_at: expires, confidence: a.confidence, fabrication_flags: '', validation_errors: '',\n    source_channel: inp.source_channel || '', executive_summary: a.executive_summary, recommended_next_step: a.recommended_next_step.product,\n    next_step_label: a.recommended_next_step.label, customer_notified_at: ''\n  };\n  const pipelineRow = {\n    lead_id: inp.lead_id, xray_analysis_id: analysisId, xray_score: row.score, xray_maturity: row.maturity_score,\n    xray_primary_risk: row.primary_risk, xray_analysis_status: 'AI_DRAFT', xray_next_step: row.next_step_label,\n    updated_at: now, last_activity_at: now\n  };\n  out.push({ json: { is_valid: true, claim_key: inp.claim_key || (inp.lead_id + '|' + row.analysis_version), claim_state: 'AI_DRAFT',\n    analysis_row: row, pipeline_row: pipelineRow, owner_alert: ownerAlert(inp, a, row, cfg), lead_id: inp.lead_id, analysis_id: analysisId } });\n}\n\nreturn out;\n" } },
  output: [{ analysis_row: { analysis_id: '', lead_id: '' }, pipeline_row: { lead_id: '' }, owner_alert: { text: '', review_url: '', crm_url: '' } }]
});

const analysisRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Analysis Row', parameters: { mode: 'raw', jsonOutput: expr('{{ JSON.stringify($json.analysis_row) }}'), options: {} } },
  output: [{ analysis_id: '', lead_id: '', review_status: 'AI_DRAFT' }]
});

const saveAnalysis = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Save XRay_Analysis', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'append', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":"XRay_Analysis","mode":"name"},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ analysis_id: '', lead_id: '' }]
});

const persistClaimState = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Persist Analysis Claim State', onError: 'stopWorkflow',
    parameters: { operation: 'executeQuery', query: "update public.finmentor_xray_analysis_claims\nset status = $1, analysis_id = $2\nwhere claim_key = $3 and status = 'CLAIMED'\nreturning claim_key, status",
      options: { queryReplacement: expr("{{ $('Validate + Store Rows').item.json.claim_state }},{{ $('Validate + Store Rows').item.json.analysis_row.analysis_id }},{{ $('Validate + Store Rows').item.json.claim_key }}") } },
    credentials: { postgres: { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' } } },
  output: [{ claim_key: '', status: 'AI_DRAFT' }]
});

const ifAnalysisValid = ifElse({
  version: 2.2,
  config: { name: 'IF Analysis Valid', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr("{{ $('Validate + Store Rows').item.json.is_valid }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } }
});

const pipelineRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Pipeline Row', parameters: { mode: 'raw', jsonOutput: expr("{{ JSON.stringify($('Validate + Store Rows').item.json.pipeline_row) }}"), options: {} } },
  output: [{ lead_id: '', xray_analysis_status: 'AI_DRAFT' }]
});

const updatePipeline = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Update Pipeline X-Ray', retryOnFail: true, onError: 'continueRegularOutput',
    parameters: { resource: 'sheet', operation: 'update', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":1883973304,"mode":"list","cachedResultName":"Pipeline"},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['lead_id'], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ lead_id: '' }]
});

const ownerAlert = node({
  type: 'n8n-nodes-base.telegram', version: 1.2,
  config: { name: 'Telegram Owner Alert', onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'sendMessage',
      chatId: expr("{{ $('Settings to Object').first().json.settings.owner_chat_id }}"),
      text: expr("{{ $('Validate + Store Rows').item.json.owner_alert.text }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: { rows: [
        { row: { buttons: [ { text: '✅ Проверить и открыть клиенту', additionalFields: { url: expr("{{ $('Validate + Store Rows').item.json.owner_alert.review_url }}") } } ] } },
        { row: { buttons: [ { text: '📊 Открыть CRM', additionalFields: { url: expr("{{ $('Validate + Store Rows').item.json.owner_alert.crm_url }}") } } ] } }
      ] },
      additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true } },
    credentials: { telegramApi: { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' } } },
  output: [{ ok: true }]
});

const failedRowBuild = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Analysis Failed Row', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// FINMENTOR X-Ray Analysis — \"Analysis Failed Row\".\n//\n// Error output of the OpenAI node. Writes an ANALYSIS_FAILED ledger row so the lead is not\n// re-analysed on every sweep (the owner deletes the row to retry), and an owner notice\n// scrubbed of anything but the error class. No prompt, no payload, no identity leaves here.\n\nconst inputs = $('Build Analysis Input').all().map(i => i.json);\nconst errors = $input.all().map(i => i.json);\nconst now = new Date().toISOString();\nconst out = [];\n\nfunction errorClass(e) {\n  const m = String((e && (e.error && (e.error.message || e.error))) || (e && e.message) || '').toLowerCase();\n  if (/rate|429|quota|insufficient_quota/.test(m)) return 'RATE_LIMIT';\n  if (/401|403|auth|api key|invalid_api_key/.test(m)) return 'AUTH';\n  if (/model|404|not found|does not exist/.test(m)) return 'MODEL';\n  if (/timeout|timed out|econnreset|502|503|504/.test(m)) return 'UPSTREAM_TRANSIENT';\n  return 'UNKNOWN';\n}\n\nfor (let idx = 0; idx < errors.length; idx++) {\n  const inp = inputs[idx];\n  if (!inp) continue;\n  const klass = errorClass(errors[idx]);\n  const analysisId = 'XA-' + String(inp.lead_id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + Date.now().toString(36).toUpperCase() + '-F';\n  out.push({ json: {\n    analysis_row: {\n      analysis_id: analysisId, lead_id: inp.lead_id, request_id: inp.request_id || '', locale: inp.locale || 'ru',\n      created_at: now, analysis_version: inp.analysis_version || 'xray-v2', model: inp.ai_model || '',\n      score: inp.score === null || inp.score === undefined ? '' : inp.score, zone: inp.zone || 'UNKNOWN',\n      maturity_score: '', primary_risk: '', analysis_json: '', plan_30d_json: '',\n      review_status: 'ANALYSIS_FAILED', reviewed_at: '', review_token: '', review_token_expires_at: '', confidence: '',\n      fabrication_flags: '', validation_errors: 'UPSTREAM_' + klass, source_channel: inp.source_channel || '', executive_summary: 'ANALYSIS_FAILED: ' + klass,\n      recommended_next_step: '', next_step_label: '', customer_notified_at: ''\n    },\n    is_valid: false,\n    claim_key: inp.claim_key || (inp.lead_id + '|' + (inp.analysis_version || 'xray-v2')),\n    claim_state: 'ANALYSIS_FAILED',\n    owner_text: 'ФИНАНСОВЫЙ РЕНТГЕН · АНАЛИЗ НЕ ВЫПОЛНЕН\\n\\nКомпания: ' + (inp.company || '—') + '\\nКласс ошибки: ' + klass + '\\nLead ID: ' + inp.lead_id + '\\n\\nСтрока ' + analysisId + ' записана в XRay_Analysis со статусом ANALYSIS_FAILED.',\n    lead_id: inp.lead_id\n  } });\n}\nreturn out;\n" } },
  output: [{ analysis_row: { analysis_id: '', review_status: 'ANALYSIS_FAILED' }, owner_text: '' }]
});

const failedRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Failed Row', parameters: { mode: 'raw', jsonOutput: expr('{{ JSON.stringify($json.analysis_row) }}'), options: {} } },
  output: [{ analysis_id: '', review_status: 'ANALYSIS_FAILED' }]
});

const saveFailed = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Save Failed Analysis', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'append', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":"XRay_Analysis","mode":"name"},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ analysis_id: '' }]
});

const persistFailedClaim = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Persist Failed Claim State', onError: 'stopWorkflow',
    parameters: { operation: 'executeQuery', query: "update public.finmentor_xray_analysis_claims\nset status = $1, analysis_id = $2\nwhere claim_key = $3 and status = 'CLAIMED'\nreturning claim_key, status",
      options: { queryReplacement: expr("{{ $('Analysis Failed Row').item.json.claim_state }},{{ $('Analysis Failed Row').item.json.analysis_row.analysis_id }},{{ $('Analysis Failed Row').item.json.claim_key }}") } },
    credentials: { postgres: { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' } } },
  output: [{ claim_key: '', status: 'ANALYSIS_FAILED' }]
});

const ownerFailureNotice = node({
  type: 'n8n-nodes-base.telegram', version: 1.2,
  config: { name: 'Telegram Failure Notice', onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'sendMessage',
      chatId: expr("{{ $('Settings to Object').first().json.settings.owner_chat_id }}"),
      text: expr("{{ $('Analysis Failed Row').item.json.owner_text }}"),
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
    credentials: { telegramApi: { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' } } },
  output: [{ ok: true }]
});

const validationFailureNotice = node({
  type: 'n8n-nodes-base.telegram', version: 1.2,
  config: { name: 'Telegram Validation Failure Notice', onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'sendMessage',
      chatId: expr("{{ $('Settings to Object').first().json.settings.owner_chat_id }}"),
      text: expr("{{ $('Validate + Store Rows').item.json.owner_text }}"),
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
    credentials: { telegramApi: { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' } } },
  output: [{ ok: true }]
});

const reviewGetWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Review GET Webhook', parameters: { httpMethod: 'GET', path: 'finmentor-xray-review', responseMode: 'responseNode', options: {} } },
  output: [{ query: { a: 'XA-1', t: 'token' } }]
});

const readForReviewGet = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Analysis For Review GET', alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":"XRay_Analysis","mode":"name"},
      filtersUI: { values: [{ lookupColumn: 'analysis_id', lookupValue: expr('{{ $json.query.a }}') }] }, combineFilters: 'AND', options: {} },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ analysis_id: '', lead_id: '', review_status: 'AI_DRAFT', review_token: '' }]
});

const reviewSurface = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Render Review Surface', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// GET is read-only.  It renders the analysis and an explicit POST confirmation form.\nconst crypto = require('crypto');\nconst q = ($('Review GET Webhook').first().json.query) || {};\nconst analysisId = String(q.a || '').trim().slice(0, 120);\nconst token = String(q.t || '').trim().slice(0, 80);\nconst all = $input.all().map(i => i.json);\nconst storeError = all.some(r => r && r.error);\nconst row = all.find(r => r && !r.error && String(r.analysis_id || '') === analysisId);\nfunction same(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && x.length === 64 && crypto.timingSafeEqual(x, y); }\nfunction esc(v) { return String(v == null ? '' : v).replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c])); }\nfunction shell(title, body) { return '<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>' + esc(title) + '</title><style>body{font-family:system-ui;background:#0b1220;color:#e6edf3;margin:0;padding:24px;line-height:1.5}main{max-width:760px;margin:auto;background:#111a2e;border-radius:16px;padding:28px}section{border-top:1px solid #26334d;padding-top:14px;margin-top:14px}button{background:#35c47c;border:0;border-radius:9px;padding:12px 18px;font-weight:700}pre{white-space:pre-wrap}</style></head><body><main><h1>' + esc(title) + '</h1>' + body + '</main></body></html>'; }\nlet status = 403; let html;\nconst expired = row && (!row.review_token_expires_at || Date.parse(row.review_token_expires_at) <= Date.now());\nif (storeError) { status = 503; html = shell('FINMENTOR · Временно недоступно', '<p>Не удалось проверить хранилище. Повторите позже.</p>'); }\nelse if (!analysisId || !token || !row || !same(row.review_token, token) || expired || !['AI_DRAFT', 'CLIENT_READY'].includes(String(row.review_status))) {\n  html = shell('FINMENTOR · Доступ отклонён', '<p>Ссылка недействительна, истекла или анализ недоступен.</p>');\n} else if (String(row.review_status) === 'CLIENT_READY') {\n  status = 200; html = shell('FINMENTOR · Уже готово', '<p>Этот анализ уже был подтверждён.</p>');\n} else {\n  let analysis = {}; try { analysis = JSON.parse(String(row.analysis_json || '{}')); } catch (e) { analysis = {}; }\n  const risks = Array.isArray(analysis.key_risks) ? analysis.key_risks.map(r => '<li><strong>' + esc(r.title) + '</strong>: ' + esc(r.evidence) + '</li>').join('') : '';\n  const weeks = analysis.plan_30_days && typeof analysis.plan_30_days === 'object' ? Object.entries(analysis.plan_30_days).map(([k, actions]) => '<section><h3>' + esc(k) + '</h3><ul>' + (Array.isArray(actions) ? actions.map(a => '<li>' + esc(a.action) + ' — ' + esc(a.expected_output) + '</li>').join('') : '') + '</ul></section>').join('') : '';\n  const review = '<section><h2>Предварительный анализ</h2><p>' + esc(analysis.executive_summary) + '</p><ul>' + risks + '</ul>' + weeks + '</section>';\n  const form = '<form method=\"post\" action=\"\"><input type=\"hidden\" name=\"a\" value=\"' + esc(analysisId) + '\"><input type=\"hidden\" name=\"t\" value=\"' + esc(token) + '\"><p><button type=\"submit\">Подтвердить CLIENT_READY</button></p></form>';\n  status = 200; html = shell('FINMENTOR · Проверка анализа', review + form);\n}\nreturn [{ json: { http_status: status, html } }];\n" } },
  output: [{ http_status: 200, html: '' }]
});

const respondReviewSurface = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Surface', parameters: { respondWith: 'text', responseBody: expr('{{ $json.html }}'),
    options: { responseCode: expr('{{ $json.http_status }}'), responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Referrer-Policy', value: 'no-referrer' }, { name: 'X-Robots-Tag', value: 'noindex, nofollow' }] } } } },
  output: [{}]
});

const reviewPostWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Review POST Webhook', parameters: { httpMethod: 'POST', path: 'finmentor-xray-review', responseMode: 'responseNode', options: {} } },
  output: [{ body: { a: 'XA-1', t: 'token' } }]
});

const readForReviewPost = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Analysis For Review POST', alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":"XRay_Analysis","mode":"name"},
      filtersUI: { values: [{ lookupColumn: 'analysis_id', lookupValue: expr('{{ $json.body.a }}') }] }, combineFilters: 'AND', options: {} },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ analysis_id: '', lead_id: '', review_status: 'AI_DRAFT', review_token: '' }]
});

const reviewVerdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Review POST Verdict', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// POST authenticates an explicit confirmation.  It does not itself mutate any store.\nconst crypto = require('crypto');\nconst request = $('Review POST Webhook').first().json;\nconst body = request.body && typeof request.body === 'object' ? request.body : {};\nconst analysisId = String(body.a || '').trim().slice(0, 120);\nconst token = String(body.t || '').trim().slice(0, 80);\nconst all = $input.all().map(i => i.json);\nconst storeError = all.some(r => r && r.error);\nconst row = all.find(r => r && !r.error && String(r.analysis_id || '') === analysisId);\nfunction same(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && x.length === 64 && crypto.timingSafeEqual(x, y); }\nlet verdict = 'DENIED'; let httpStatus = 403;\nif (storeError) { verdict = 'STORE_UNAVAILABLE'; httpStatus = 503; }\nelse if (analysisId && token && row && same(row.review_token, token) && row.review_token_expires_at && Date.parse(row.review_token_expires_at) > Date.now()) {\n  const state = String(row.review_status || '');\n  if (state === 'AI_DRAFT' || state === 'CLIENT_READY') { verdict = 'CAS_REQUEST'; httpStatus = 200; }\n}\nreturn [{ json: {\n  verdict, http_status: httpStatus, analysis_id: analysisId,\n  lead_id: row ? String(row.lead_id || '') : '', locale: row && row.locale === 'ro' ? 'ro' : 'ru',\n  claim_key: row ? String(row.lead_id || '') + '|' + String(row.analysis_version || '') : '',\n  sheet_state: row ? String(row.review_status || '') : '', source_row: row || null\n} }];\n" } },
  output: [{ verdict: 'CAS_REQUEST', analysis_id: '', claim_key: '', http_status: 200 }]
});

const ifCasRequest = ifElse({
  version: 2.2,
  config: { name: 'IF CAS Request', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr('{{ $json.verdict }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'CAS_REQUEST' }], combinator: 'and' } } }
});

const reviewCas = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'CAS Review Promotion', onError: 'continueErrorOutput',
    parameters: { operation: 'executeQuery', query: "with changed as (\n  update public.finmentor_xray_analysis_claims\n  set status = 'CLIENT_READY', reviewed_at = now()\n  where claim_key = $1 and analysis_id = $2 and status = 'AI_DRAFT'\n  returning status\n)\nselect coalesce((select status from changed),\n  (select status from public.finmentor_xray_analysis_claims where claim_key = $1 and analysis_id = $2)) as authority_status,\n  (select count(*) from changed)::int as cas_won",
      options: { queryReplacement: expr("{{ $json.claim_key }},{{ $json.analysis_id }}") } },
    credentials: { postgres: { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' } } },
  output: [{ authority_status: 'CLIENT_READY', cas_won: 1 }]
});

const reviewCasVerdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Review CAS Verdict', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// The PostgreSQL compare-and-set is authoritative.  Only an explicit CLIENT_READY state\n// allows the idempotent sheet/result projection to run.\nconst request = $('Review POST Verdict').first().json;\nconst rows = $input.all().map(i => i.json);\nconst r = rows.length === 1 ? rows[0] : {};\nconst state = String(r.authority_status || '');\nconst casWon = Number(r.cas_won) === 1;\nconst proceed = request.verdict === 'CAS_REQUEST' && state === 'CLIENT_READY';\nconst now = new Date().toISOString();\nreturn [{ json: {\n  verdict: proceed ? (casWon ? 'PROMOTED' : 'ALREADY_READY') : 'DENIED',\n  proceed_update: proceed, http_status: proceed ? 200 : 409,\n  update_row: proceed ? { analysis_id: request.analysis_id, review_status: 'CLIENT_READY', reviewed_at: now } : null,\n  pipeline_row: proceed ? { lead_id: request.lead_id, xray_analysis_status: 'CLIENT_READY', updated_at: now, last_activity_at: now } : null,\n  source_row: request.source_row, locale: request.locale\n} }];\n" } },
  output: [{ verdict: 'PROMOTED', proceed_update: true, update_row: {}, pipeline_row: {} }]
});

const ifPromote = ifElse({
  version: 2.2,
  config: { name: 'IF CAS Promoted Or Ready', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr('{{ $json.proceed_update }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } }
});

const promoteRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Promote Row', parameters: { mode: 'raw', jsonOutput: expr('{{ JSON.stringify($json.update_row) }}'), options: {} } },
  output: [{ analysis_id: '', review_status: 'CLIENT_READY' }]
});

const promoteAnalysis = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Promote Analysis', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'update', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":"XRay_Analysis","mode":"name"},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['analysis_id'], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ analysis_id: '' }]
});

const pipelineStatusRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Pipeline Status Row', parameters: { mode: 'raw', jsonOutput: expr("{{ JSON.stringify($('Review CAS Verdict').item.json.pipeline_row) }}"), options: {} } },
  output: [{ lead_id: '', xray_analysis_status: 'CLIENT_READY' }]
});

const updatePipelineStatus = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Update Pipeline Review Status', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'update', documentId: {"__rl":true,"value":"1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A","mode":"list","cachedResultName":"FINMENTOR_LEADS_CRM_PREMIUM_FINAL"}, sheetName: {"__rl":true,"value":1883973304,"mode":"list","cachedResultName":"Pipeline"},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['lead_id'], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } } },
  output: [{ lead_id: '' }]
});

const buildClientResult = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Curated Client Result', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Curated customer result projection.  Storage metadata is separate from result_json and\n// Gateway returns result_json only.  No token, prompt, raw model response, request id or PII.\nconst verdict = $('Review CAS Verdict').first().json;\nconst row = verdict.source_row || {};\nif (verdict.proceed_update !== true || String(row.review_status || '') === 'ANALYSIS_FAILED') return [];\nlet analysis = {}; try { analysis = JSON.parse(String(row.analysis_json || '{}')); } catch (e) { return []; }\nconst locale = row.locale === 'ro' ? 'ro' : 'ru';\nconst labels = locale === 'ro'\n  ? { product: 'Test de sănătate financiară FINMENTOR', score: 'Scor', zone: 'Zonă', maturity: 'Maturitate financiară', risks: 'Riscuri-cheie', priorities: 'Priorități de management', plan: 'Plan de acțiune pentru 30 de zile', tomorrow: 'Acțiuni pentru mâine', next: 'Următorul pas FINMENTOR' }\n  : { product: 'Финансовый рентген бизнеса', score: 'Оценка', zone: 'Зона', maturity: 'Зрелость финансового управления', risks: 'Ключевые риски', priorities: 'Приоритеты управления', plan: 'План действий на 30 дней', tomorrow: 'Действия на завтра', next: 'Следующий шаг FINMENTOR' };\nconst result = {\n  locale, labels, score: row.score === '' ? null : Number(row.score), zone: String(row.zone || 'UNKNOWN'),\n  maturity: analysis.financial_maturity, key_risks: analysis.key_risks,\n  management_priorities: analysis.management_priorities, plan_30_days: analysis.plan_30_days,\n  tomorrow_actions: analysis.tomorrow_actions, recommended_next_step: analysis.recommended_next_step\n};\nreturn [{ json: {\n  authority_key: String(row.lead_id || '') + '|' + String(row.analysis_version || ''),\n  lead_id: String(row.lead_id || ''), analysis_version: String(row.analysis_version || ''),\n  review_status: 'CLIENT_READY', published_at: new Date().toISOString(), result_json: JSON.stringify(result)\n} }];\n" } },
  output: [{ authority_key: '', lead_id: '', review_status: 'CLIENT_READY', result_json: '{}' }]
});

const publishClientResult = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Publish Curated Client Result', onError: 'stopWorkflow',
    parameters: { resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'name', value: "XRay_Client_Results" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: 'authority_key', condition: 'eq', keyValue: expr('{{ $json.authority_key }}') }] },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  output: [{ authority_key: '', review_status: 'CLIENT_READY' }]
});

const respondPromoted = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Done', parameters: { respondWith: 'text', responseBody: '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="robots" content="noindex"><title>FINMENTOR</title><p>Анализ подтверждён и доступен клиенту.</p></html>',
    options: { responseCode: 200, responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'X-Robots-Tag', value: 'noindex, nofollow' }] } } } },
  output: [{}]
});

const respondDenied = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Denied', parameters: { respondWith: 'text', responseBody: '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="robots" content="noindex"><title>FINMENTOR</title><p>Подтверждение отклонено.</p></html>',
    options: { responseCode: expr('{{ $json.http_status }}'), responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'X-Robots-Tag', value: 'noindex, nofollow' }] } } } },
  output: [{}]
});

const respondReviewUnavailable = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Store Unavailable', parameters: { respondWith: 'text', responseBody: '<!doctype html><html lang="ru"><meta charset="utf-8"><p>Хранилище временно недоступно. Повторите позже.</p></html>',
    options: { responseCode: 503, responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Referrer-Policy', value: 'no-referrer' }] } } } },
  output: [{}]
});

export default workflow('finmentor-xray-analysis', 'FINMENTOR X-Ray Analysis')
  .add(sweepTrigger)
  .to(readSettings)
  .to(settingsToObject)
  .to(readPipeline)
  .to(readAnalysis)
  .to(selectPending)
  .to(buildClaim)
  .to(claimAnalysis)
  .to(claimVerdict)
  .to(ifClaimWon
    .onTrue(readLeadRaw))
  .to(buildInput)
  .to(aiAnalysis
    .onError(failedRowBuild.to(failedRow.to(saveFailed.to(persistFailedClaim.to(ownerFailureNotice))))))
  .to(validateRows)
  .to(analysisRow)
  .to(saveAnalysis)
  .to(persistClaimState)
  .to(ifAnalysisValid
    .onTrue(pipelineRow.to(updatePipeline.to(ownerAlert)))
    .onFalse(validationFailureNotice))
  .add(reviewGetWebhook)
  .to(readForReviewGet)
  .to(reviewSurface)
  .to(respondReviewSurface)
  .add(reviewPostWebhook)
  .to(readForReviewPost)
  .to(reviewVerdict)
  .to(ifCasRequest
    .onTrue(reviewCas
      .onError(respondReviewUnavailable)
      .to(reviewCasVerdict)
      .to(ifPromote
        .onTrue(promoteRow.to(promoteAnalysis.to(pipelineStatusRow.to(updatePipelineStatus.to(buildClientResult.to(publishClientResult.to(respondPromoted)))))))
        .onFalse(respondDenied)))
    .onFalse(respondDenied));
