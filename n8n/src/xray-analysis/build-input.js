// FINMENTOR X-Ray Analysis — "Build Analysis Input".
//
// Input:  $input = the complete Leads snapshot, $('Select Pending Leads') = the Pipeline rows
//         being analysed or upgraded.
// Output: one item per pending lead. Safe source pairs carry the prompts; unsafe/missing pairs
//         carry a fail-closed audit finding and never reach the model.
//
// The model NEVER sees identity. Three layers (allowlist, key denylist, value scrub) are the
// same core as Lead Intake's ai-safe-projection.js, then the serialised projection is
// re-inspected and the lead is skipped if anything identifying survived. Fail closed.
//
// Deterministic score and zone come from the CRM row (Pipeline.financial_zone is the
// authoritative zone; the score is Leads."Diagnostic Score" or raw.diagnostic.score). They
// are carried on the item, never asked of the model, and never overwritten downstream.

// __LEAD_INTELLIGENCE_CONTRACT__ (inlined by the builder)

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
function projectRiskZones(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const out = [];
  for (const row of rows.slice(0, 5)) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const projected = {};
      for (const key of ['key', 'label', 'answer']) {
        const clean = sanitize(row[key], 1);
        if (typeof clean === 'string') projected[key] = clean.slice(0, key === 'key' ? 80 : 240);
      }
      const score = num(row.score_percent);
      if (score !== null && score >= 0 && score <= 100) projected.score_percent = Math.round(score);
      if (Object.keys(projected).length) out.push(projected);
      continue;
    }
    const clean = sanitize(row, 1);
    if (typeof clean === 'string') out.push(clean.slice(0, 240));
  }
  return out;
}
function riskZoneKeys(rows) {
  return rows.map((row) => typeof row === 'string' ? row : String(row.key || '')).filter(Boolean).slice(0, 5);
}
function parseRaw(value) {
  if (!String(value || '').trim()) return { ok: false, raw: {}, reason: 'RAW_JSON_EMPTY' };
  try {
    const raw = JSON.parse(String(value));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) return { ok: false, raw: {}, reason: 'RAW_JSON_EMPTY' };
    return { ok: true, raw };
  } catch (e) { return { ok: false, raw: {}, reason: 'RAW_JSON_INVALID' }; }
}
function rowLeadId(row) { return String(pick(row && row['Lead ID'], row && row.lead_id)).trim(); }
function rowRequestId(row) {
  const direct = String(pick(row && row['Request ID'], row && row.request_id)).trim();
  if (direct) return direct;
  const parsed = parseRaw(row && row['Raw JSON']);
  if (!parsed.ok) return '';
  return String(pick(parsed.raw.request_id, parsed.raw.meta && parsed.raw.meta.request_id)).trim();
}
function addIndex(index, key, row) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(row);
}
function auditFinding(pipe, code, detail) {
  const company = String(pipe.company || '').trim();
  const labels = {
    LEADS_READ_UNAVAILABLE: 'источник Leads недоступен',
    LEAD_ID_COLLISION: 'несколько строк Leads имеют один Lead ID',
    REQUEST_ID_MISSING: 'нет безопасного ключа request_id для резервной сверки',
    REQUEST_ID_NOT_FOUND: 'по request_id не найдена строка Leads',
    REQUEST_ID_COLLISION: 'по request_id найдено несколько строк Leads',
    RAW_JSON_EMPTY: 'исходный Raw JSON пуст',
    RAW_JSON_INVALID: 'исходный Raw JSON повреждён'
  };
  const subject = company ? ' · ' + company : '';
  return {
    analysis_ready: false,
    analysis_mode: String(pipe.analysis_mode || 'NEW_ANALYSIS'),
    lead_id: String(pipe.lead_id || ''), request_id: String(pipe.request_id || ''),
    audit_finding: {
      severity: 'P0', code,
      detail: String(detail || ''),
      owner_text: '⚠️ FINMENTOR · Анализ пропущен' + subject + '\n\nПричина: ' + (labels[code] || 'не удалось безопасно сопоставить источник') + '.\nДанные клиента не использованы. Требуется проверка источника.'
    }
  };
}

function detectLocale(pipe, raw, leadRow) {
  const meta = raw.meta || {};
  const pages = [meta.page_url, pipe.source_page, raw.page_url, raw.source_page, leadRow['Page URL']].map(x => String(x || '').toLowerCase());
  if (String(meta.site_language || raw.site_language || raw.locale || (raw.premium && raw.premium.locale) || '').toLowerCase().startsWith('ro')) return 'ro';
  if (pages.some(p => p.includes('/ro/'))) return 'ro';
  const lang = String(pick(leadRow['Language'], raw.client && raw.client.language)).toLowerCase();
  if (/румын|român|romana|\bro\b/.test(lang)) return 'ro';
  return 'ru';
}

const ALLOWED_PRODUCTS = ['CFO_ADVISORY_SESSION', 'FINANCIAL_HEALTH_CHECK', 'BUSINESS_CONTROL_SYSTEM', 'CFO_CONTROL_PARTNER', 'CFO_AI_CONTROL', 'NEEDS_CLARIFICATION'];

const CONTRACT = {
  owner_brief: {
    diagnoses: [{ conclusion: 'professional conclusion, not a repeated answer', evidence_fact_ids: ['ids from CLIENT FACT INDEX only'], hypothesis: 'explicit hypothesis', economic_implication: 'liquidity/profitability/working capital/cost of capital/control consequence without invented amount' }],
    pain_map: [{ area: 'maximum 4 areas', attention: 'short attention state', observation: 'what FINMENTOR sees', consequence: 'why it matters economically', economic_category: 'liquidity|profitability|working capital|cost of capital|cash conversion|asset utilisation|management speed|risk|capital preservation', evidence_fact_ids: ['fact ids'] }],
    unknowns: [{ item: 'what is missing/contradictory/unconfirmed', why: 'why it matters' }],
    first_meeting_objective: 'ONE specific sentence',
    conversation_opening: 'ONE client-specific, non-accusatory senior-CFO opening',
    discovery_questions: [{ question: '5–7 questions in symptom→cause→process→money→capital/risk→decision→result order', why: 'the exact diagnostic purpose' }],
    solution_hypothesis: { product: ALLOWED_PRODUCTS.join('|'), format: 'probable format or clarification first', rationale: 'evidence-based', confirmation_conditions: ['conditions before recommendation'], if_confirmed: 'logical route', do_not_offer_yet: 'optional' },
    next_action: { action: 'owner action', purpose: 'why', success_condition: 'observable outcome', due_date: 'YYYY-MM-DD or empty' }
  },
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
  recommended_next_step: { product: ALLOWED_PRODUCTS.join('|'), label: 'customer-facing label', rationale: 'string' },
  confidence: 'HIGH|MEDIUM|LOW',
  limitations: ['string']
};

function systemPrompt(locale) {
  if (locale === 'ro') {
    return [
      'Ești FINMENTOR CFO Analyst — director financiar cu experiență în management financiar pentru IMM-uri din Republica Moldova și România.',
      'Sarcina: interpretezi rezultatul unui Test financiar FINMENTOR și pregătești o evaluare financiară preliminară și un plan de acțiune financiară pentru 30 de zile.',
      'REGULI STRICTE:',
      '1. Scorul (0–100) și zona sunt CALCULATE DETERMINIST și îți sunt date. Nu le recalcula, nu le contesta, nu le modifica.',
      '2. Nu inventa cifre: fără venituri, solduri de numerar, datorii, marje, expuneri fiscale sau situații financiare care nu apar explicit în date. Dacă o informație lipsește, scrie exact «DATE INSUFICIENTE» în locul ei și adaug-o la data_gaps.',
      '3. Nu formula concluzii juridice sau fiscale. Nu promite rezultate financiare garantate.',
      '4. Separă faptele (din date) de ipoteze; ipotezele se marchează cu «ipoteză:».',
      '5. Datele sunt anonimizate: nu te adresa persoanei pe nume și nu cere date de contact.',
      '6. Scrie în limba română profesională, registru formal (dumneavoastră). Termenii englezești apar doar în paranteză la prima menționare, de ex. «Flux de numerar (Cash Flow)».',
      '7. Terminologie: Flux de numerar, Cont managerial de profit și pierdere (P&L), Capital circulant, Creanțe, Datorii către furnizori, Lichiditate, Rentabilitate, Raportare managerială, Panou de indicatori-cheie.',
      '8. Produse FINMENTOR permise pentru recommended_next_step.product: ' + ALLOWED_PRODUCTS.join(', ') + '.',
      '9. În owner_brief, CLIENT FACT INDEX este singura sursă de fapte. Folosește numai identificatori existenți în evidence_fact_ids. Ipotezele nu sunt fapte.',
      '10. Soluția este o ipoteză de lucru. Dacă dovezile nu ajung, folosește NEEDS_CLARIFICATION. Nu alege automat produsul cel mai scump.',
      '11. Răspunde STRICT cu un singur obiect JSON conform contractului. Fără markdown, fără text înainte sau după JSON.'
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
    '9. В owner_brief ИНДЕКС ФАКТОВ КЛИЕНТА — единственный источник фактов. В evidence_fact_ids используй только существующие идентификаторы. Гипотеза не является фактом.',
    '10. Решение — рабочая гипотеза. Если доказательств недостаточно, используй NEEDS_CLARIFICATION. Не выбирай автоматически самый дорогой продукт.',
    '11. Выявляй материальные противоречия: инструменты могут быть заявлены, но не работать операционно. Не повторяй ответы вместо диагноза.',
    '12. Верни СТРОГО один JSON-объект по контракту. Без markdown, без текста до и после JSON.'
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
  return [head, JSON.stringify(facts, null, 2), '', 'ИНДЕКС ФАКТОВ КЛИЕНТА / CLIENT FACT INDEX:', JSON.stringify(facts.client_fact_index || [], null, 2), '', body, JSON.stringify(projection, null, 2), '', tail, JSON.stringify(CONTRACT, null, 2)].join('\n');
}

function controlSummary(control) {
  const c = control || {};
  const labels = {
    management_pl: 'Управленческий P&L', cash_flow: 'Cash Flow', payment_calendar: 'Платёжный календарь', budget_plan: 'Бюджет',
    receivables_control: 'Дебиторская задолженность', payables_control: 'Кредиторская задолженность',
    owner_report: 'Отчёт собственника', margin_control: 'Контроль маржи', payment_approval_rules: 'Правила согласования платежей'
  };
  return Object.keys(labels).map((k) => ({ key: k, label: labels[k], value: pick(c[k]) })).filter((x) => String(x.value).trim() !== '');
}

function quickControlSummary(raw, diagnostic) {
  const answers = raw && raw.answers && Array.isArray(raw.answers.quick_diagnostic)
    ? raw.answers.quick_diagnostic
    : diagnostic && Array.isArray(diagnostic.answers_short) ? diagnostic.answers_short : [];
  return answers.slice(0, 10).map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
    const label = sanitize(row.label !== undefined ? row.label : row.key, 1);
    const answer = sanitize(row.answer !== undefined ? row.answer : row.value, 1);
    return typeof label === 'string' && typeof answer === 'string' ? label.slice(0, 160) + ': ' + answer.slice(0, 240) : '';
  }).filter(Boolean);
}

function preferredContact(client, raw, sourceChannel) {
  const explicit = pick(client.preferred_contact_channel, client.preferred_contact, raw.preferred_contact_channel, raw.contact_channel);
  if (explicit) return explicit;
  if (client.email) return 'email';
  if (client.phone_or_messenger || client.phone) return 'phone';
  if (/telegram/.test(sourceChannel) && client.telegram) return 'telegram';
  return '';
}

function namedRows(name) {
  try { return $(name).all().map((i) => i.json || {}).filter((r) => !r.error && !r.errorMessage); }
  catch (e) { return []; }
}
function humanHistory(leadId, createdAt) {
  const out = [];
  if (createdAt) out.push({ at: String(createdAt), label: 'Получена заявка' });
  const actionLabels = {
    lead_created: 'Заявка сохранена', qualification_completed: 'Завершена квалификация',
    client_result_ready: 'Анализ утверждён', client_result_edited: 'Клиентская версия отредактирована',
    client_notified_manual: 'Клиент уведомлён вручную', client_notified_telegram: 'Клиент уведомлён в Telegram',
    conversation_captured: 'Разговор зафиксирован', outbound_contact: 'Клиенту отправлено сообщение'
  };
  for (const r of namedRows('Read Activities')) {
    if (String(r.lead_id || r['Lead ID'] || '') !== leadId) continue;
    const key = String(r.action || r.event_type || '').trim();
    const label = actionLabels[key] || String(r.detail || r.description || '').trim();
    if (label) out.push({ at: String(r.ts || r.created_at || r.timestamp || ''), label: label.slice(0, 240) });
  }
  for (const r of namedRows('Read Status_Log')) {
    if (String(r.lead_id || r['Lead ID'] || '') !== leadId) continue;
    const to = String(r.to_status || r.new_status || r.status || '').trim();
    if (to) out.push({ at: String(r.ts || r.changed_at || r.created_at || ''), label: ('Статус изменён: ' + to).slice(0, 240) });
  }
  const seen = new Set();
  return out.filter((x) => { const k = x.at + '|' + x.label; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)).slice(-30);
}

// ---- pairing --------------------------------------------------------------------------
const rawLeadItems = $input.all().map(i => i.json).filter(Boolean);
const leadsReadUnavailable = rawLeadItems.some((r) => r.error || r.errorMessage);
const leadRows = rawLeadItems.filter((r) => !r.error && !r.errorMessage && (rowLeadId(r) || rowRequestId(r) || String(r['Raw JSON'] || '').trim()));
const byLeadId = {}; const byRequestId = {};
for (const r of leadRows) {
  addIndex(byLeadId, rowLeadId(r), r);
  addIndex(byRequestId, rowRequestId(r), r);
}

const pending = $('Select Pending Leads').all().map(i => i.json);
const out = [];

for (const pipe of pending) {
  const leadId = String(pipe.lead_id || '').trim();
  const requestId = String(pipe.request_id || '').trim();
  if (leadsReadUnavailable) { out.push({ json: auditFinding(pipe, 'LEADS_READ_UNAVAILABLE') }); continue; }

  const direct = byLeadId[leadId] || [];
  let leadRow = null; let pairingMethod = '';
  if (direct.length > 1) {
    out.push({ json: auditFinding(pipe, 'LEAD_ID_COLLISION', 'matches=' + direct.length) }); continue;
  }
  if (direct.length === 1) {
    leadRow = direct[0]; pairingMethod = 'lead_id';
  } else {
    if (!requestId) { out.push({ json: auditFinding(pipe, 'REQUEST_ID_MISSING') }); continue; }
    const fallback = byRequestId[requestId] || [];
    if (!fallback.length) { out.push({ json: auditFinding(pipe, 'REQUEST_ID_NOT_FOUND') }); continue; }
    if (fallback.length !== 1) {
      out.push({ json: auditFinding(pipe, 'REQUEST_ID_COLLISION', 'matches=' + fallback.length) }); continue;
    }
    leadRow = fallback[0]; pairingMethod = 'request_id';
  }
  const source = parseRaw(leadRow['Raw JSON']);
  if (!source.ok) { out.push({ json: auditFinding(pipe, source.reason) }); continue; }
  const raw = source.raw;

  const locale = detectLocale(pipe, raw, leadRow);
  const diagnostic = raw.diagnostic || {};
  const score = num(pick(diagnostic.score, leadRow['Diagnostic Score']));
  // Bounded vocabulary: anything outside the five zones is UNKNOWN, never a free string in the prompt.
  const zoneRaw = String(pick(pipe.financial_zone, diagnostic.traffic_light, leadRow['Financial Zone'], 'UNKNOWN')).trim().toUpperCase();
  const zone = ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN'].includes(zoneRaw) ? zoneRaw : 'UNKNOWN';
  const tool = String(pick(raw.tool, leadRow['Tool'], pipe.source_page && String(pipe.source_page).includes('questionnaire') ? 'xray_extended' : '')).toLowerCase();
  const sourceChannel = tool.includes('xray') ? 'website_xray' : tool.includes('mini_scan') ? 'website_mini_scan' : (raw.premium || raw.brief || /miniapp|concierge|telegram/.test(String(raw.source || ''))) ? 'telegram_premium' : 'other';

  const client = raw.client || {};
  const financialControl = (raw.intake && raw.intake.financial_control) || raw.financial_control || {};
  const controls = controlSummary(financialControl);
  const quickControls = quickControlSummary(raw, diagnostic);
  const expandedSetup = controls.filter((x) => /да|есть|регуляр|частич|yes|true/i.test(String(x.value))).map((x) => x.label + ': ' + x.value);
  const existingSetup = quickControls.length ? quickControls : expandedSetup;
  const existingSetupSource = quickControls.length ? 'Leads.Raw JSON.answers.quick_diagnostic' : 'Leads.Raw JSON.intake.financial_control';
  const systemStatus = controls.filter((x) => /receivables|payables|owner_report|margin_control|payment_approval_rules/.test(x.key)).map((x) => x.label + ': ' + x.value).join('; ');
  const industrySpecific = (raw.intake && raw.intake.industry_specific) || raw.industry_specific || {};
  const capitalContext = [pick(industrySpecific.loans_or_investors), pick(industrySpecific.capex_or_projects)].filter(Boolean).join('; ');
  const desiredResult = pick(pipe.selected_goals, raw.selected_goals, raw.intake && raw.intake.goals && raw.intake.goals.selected_goals);
  const desiredFirstStep = pick(raw.intake && raw.intake.business_pain && raw.intake.business_pain.desired_first_step, raw.desired_first_step);
  const preferredChannel = preferredContact(client, raw, sourceChannel);
  const contact = LI.buildReachability({
    preferred_contact_channel: preferredChannel,
    phone: pick(client.phone_or_messenger, client.phone, pipe.phone), email: pick(client.email, pipe.email),
    telegram: pick(client.telegram, pipe.telegram), source_channel: sourceChannel,
    telegram_route_verified: sourceChannel === 'telegram_premium'
  });
  const clientFacts = LI.buildClientFacts({
    main_problem: pick(pipe.main_pain, diagnostic.main_pain, raw.main_pain && raw.main_pain.problem),
    main_problem_source: pipe.main_pain ? 'Pipeline.main_pain' : diagnostic.main_pain ? 'Leads.Raw JSON.diagnostic.main_pain' : 'Leads.Raw JSON.main_pain.problem',
    existing_setup: existingSetup,
    existing_setup_source: existingSetupSource,
    desired_result: desiredResult,
    desired_result_source: pipe.selected_goals ? 'Pipeline.selected_goals' : 'Leads.Raw JSON.intake.goals.selected_goals',
    desired_first_step: desiredFirstStep,
    desired_first_step_source: 'Leads.Raw JSON.intake.business_pain.desired_first_step',
    urgency: pick(diagnostic.urgency, pipe.urgency, raw.main_pain && raw.main_pain.urgency),
    financial_system: systemStatus,
    financial_system_source: 'Leads.Raw JSON.intake.financial_control',
    documents: pick(pipe.selected_documents, raw.intake && raw.intake.documents_available && raw.intake.documents_available.selected_documents),
    documents_source: pipe.selected_documents ? 'Pipeline.selected_documents' : 'Leads.Raw JSON.intake.documents_available.selected_documents',
    capital_context: capitalContext,
    capital_context_source: 'Leads.Raw JSON.intake.industry_specific'
  });

  const eligibilitySignal = diagnostic.wants_review !== undefined ? { value: diagnostic.wants_review, path: 'Leads.Raw JSON.diagnostic.wants_review' }
    : diagnostic.client_result_requested !== undefined ? { value: diagnostic.client_result_requested, path: 'Leads.Raw JSON.diagnostic.client_result_requested' }
    : raw.client_result_requested !== undefined ? { value: raw.client_result_requested, path: 'Leads.Raw JSON.client_result_requested' }
    : raw.premium && raw.premium.client_result_requested !== undefined ? { value: raw.premium.client_result_requested, path: 'Leads.Raw JSON.premium.client_result_requested' }
    : { value: '', path: '' };
  const resultEligibility = LI.clientResultEligibility({ source_channel: sourceChannel, explicit_request: eligibilitySignal.value, source_path: eligibilitySignal.path });

  const projectedRiskZones = projectRiskZones(diagnostic.risk_zones);
  const facts = {
    deterministic_score_0_100: score === null ? 'INSUFFICIENT DATA' : score,
    deterministic_zone: zone,
    scored_by_xray_questionnaire: score !== null,
    risk_zones_from_questionnaire: projectedRiskZones,
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
    locale,
    client_fact_index: clientFacts.map((f) => ({ id: f.id, label: f.label, value: f.value }))
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
      analysis_ready: true,
      analysis_mode: String(pipe.analysis_mode || 'NEW_ANALYSIS'),
      existing_analysis: pipe.existing_analysis && typeof pipe.existing_analysis === 'object' ? pipe.existing_analysis : null,
      source_pairing: { method: pairingMethod, pipeline_lead_id: leadId, leads_lead_id: rowLeadId(leadRow), request_id: requestId },
      lead_id: leadId,
      request_id: requestId,
      locale,
      source_channel: sourceChannel,
      company: String(pipe.company || ''),
      // Owner-card context (classified questionnaire labels, user-explicit, already scrubbed) and
      // the Pipeline row for the «Карточка лида» deep link. Presentation only: not in the prompt.
      company_context: { industry: String(factsClean.business_model || factsClean.industry_category || ''), industry_category: String(factsClean.industry_category || ''), turnover: String(factsClean.turnover_range || ''), employees: String(factsClean.employees_range || '') },
      // PII and contact routes never enter the AI prompt. They travel only to the owner surface.
      owner_context: {
        company: String(pipe.company || client.company || ''), contact_name: String(pipe.name || client.name || ''), role: String(pipe.role || client.role || ''),
        business: String(factsClean.business_model || factsClean.industry_category || ''),
        scale: [String(factsClean.turnover_range || ''), String(factsClean.employees_range || '')].filter(Boolean).join(' · '),
        source: sourceChannel, lead_status: String(pipe.deal_stage || pipe.status || ''),
        data_quality: String(factsClean.data_quality || 'Требует проверки'),
        commercial_intent_confirmed: String(pipe.strong_commercial_intent || '').toLowerCase() === 'true',
        commercial_intent: String(pipe.work_interest || ''), next_action: String(pipe.next_action || ''), next_action_date: String(pipe.next_follow_up_at || ''),
        diagnostic_score: score, financial_zone: zone, contact, client_facts: clientFacts,
        client_result_eligible: resultEligibility.eligible,
        client_result_eligibility_reason: resultEligibility.reason,
        history: humanHistory(leadId, pipe.created_at)
      },
      crm_row: Number.isInteger(Number(pipe.row_number)) ? Number(pipe.row_number) : null,
      created_at_lead: String(pipe.created_at || ''),
      score: score,
      zone,
      analysis_version: 'lead-intelligence-v1',
      risk_zones: riskZoneKeys(projectedRiskZones),
      input_digest_text: JSON.stringify({ facts: factsClean, projection }),
      ai_model: String(($('Settings to Object').first().json.settings || {}).xray_ai_model || 'gpt-4.1'),
      ai_system_prompt: systemPrompt(locale),
      ai_user_prompt: userPrompt(locale, factsClean, projection)
    }
  });
}

return out;
