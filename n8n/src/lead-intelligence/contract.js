// FINMENTOR Lead Intelligence v1 — owner brief contract and provenance guard.
//
// Pure, dependency-free logic. n8n builders inline this module into Code nodes; QA imports it
// directly. Client facts are supplied by deterministic source extraction and can never be created
// by the model. The model may only provide FINMENTOR interpretations and verification questions.

'use strict';

const INFORMATION_KIND = Object.freeze({
  CLIENT_FACT: 'CLIENT_FACT',
  FINMENTOR_INTERPRETATION: 'FINMENTOR_INTERPRETATION',
  NEEDS_VERIFICATION: 'NEEDS_VERIFICATION',
  OWNER_CONFIRMED_FACT: 'OWNER_CONFIRMED_FACT',
  OWNER_NOTE: 'OWNER_NOTE'
});

const CONTACT_LABEL = Object.freeze({ telegram: 'Telegram', phone: 'Телефон', email: 'Email' });
const OUTCOME_CODES = Object.freeze([
  'PROBLEM_CONFIRMED', 'HYPOTHESIS_CHANGED', 'MORE_DATA_NEEDED', 'NO_TASK_NOW', 'READY_TO_DISCUSS'
]);
const PRODUCT_CODES = Object.freeze([
  'CFO_ADVISORY_SESSION', 'FINANCIAL_HEALTH_CHECK', 'BUSINESS_CONTROL_SYSTEM',
  'CFO_CONTROL_PARTNER', 'CFO_AI_CONTROL', 'NEEDS_CLARIFICATION'
]);

function text(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ').trim().slice(0, max || 1200);
}

function lines(value, max, each) {
  const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return source.map((v) => text(v, each || 500)).filter(Boolean).slice(0, max || 10);
}

function channelKey(value) {
  const v = text(value, 60).toLowerCase();
  if (/telegram|телеграм|^tg$/.test(v)) return 'telegram';
  if (/e-?mail|почт/.test(v)) return 'email';
  if (/phone|телефон|звон/.test(v)) return 'phone';
  return '';
}

function validEmail(value) {
  const v = text(value, 180).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : '';
}

function validPhone(value) {
  const raw = text(value, 80);
  if (!raw || raw.includes('@') || /telegram|t\.me/i.test(raw)) return '';
  const core = raw.split(/[(,;]/)[0].trim();
  if (!/^[+\d][\d\s().\-/]*$/.test(core)) return '';
  const digits = core.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15 ? raw : '';
}

function telegramUsername(value) {
  let v = text(value, 80).replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(v) ? '@' + v : '';
}

function telegramNumeric(value) {
  const v = text(value, 30);
  return /^-?\d{5,20}$/.test(v) ? v : '';
}

// Preference is a statement by the client. Reachability is evidence held by FINMENTOR. They are
// intentionally calculated on different paths and never collapsed into a single `contact` value.
function buildReachability(input) {
  const i = input || {};
  const preferred = channelKey(i.preferred_contact_channel || i.contact_channel);
  const phone = validPhone(i.phone);
  const email = validEmail(i.email);
  const username = telegramUsername(i.telegram_username || i.telegram);
  const numeric = telegramNumeric(i.telegram_chat_id || i.telegram_user_id || i.telegram);
  const trustedTelegramFlow = i.telegram_route_verified === true
    || /telegram_premium|telegram_miniapp|concierge|miniapp/i.test(text(i.source_channel, 80));
  const verifiedNumeric = trustedTelegramFlow ? numeric : '';
  const telegram = username || verifiedNumeric;

  const reachable = [];
  if (telegram) reachable.push({ key: 'telegram', label: CONTACT_LABEL.telegram, value: telegram, verified: true });
  if (phone) reachable.push({ key: 'phone', label: CONTACT_LABEL.phone, value: phone, verified: false });
  if (email) reachable.push({ key: 'email', label: CONTACT_LABEL.email, value: email, verified: false });

  return {
    preferred_contact_channel: preferred,
    preferred_label: CONTACT_LABEL[preferred] || 'Не указано',
    reachable_channels: reachable,
    telegram: {
      reachable: !!telegram,
      verified: !!telegram,
      route: telegram,
      reason: telegram ? '' : (preferred === 'telegram' ? 'Telegram-контакт не подключён' : '')
    },
    phone,
    email
  };
}

function fact(id, label, value, sourcePath) {
  const v = text(value, 1000);
  if (!v) return null;
  return {
    id: text(id, 60), label: text(label, 120), value: v,
    source_path: text(sourcePath, 200), kind: INFORMATION_KIND.CLIENT_FACT
  };
}

// Input values must already have been selected from Leads / Raw JSON / Pipeline. The function does
// no inference: labels are presentation, values are passed through from the source snapshot.
function buildClientFacts(source) {
  const s = source || {};
  const out = [
    fact('main_problem', 'Основная проблема', s.main_problem, s.main_problem_source || 'Pipeline.main_pain'),
    fact('existing_setup', 'Что уже есть', lines(s.existing_setup, 8, 160).join('; '), s.existing_setup_source || 'Leads.Raw JSON'),
    fact('desired_result', 'Какой результат хочет получить', s.desired_result, s.desired_result_source || 'Pipeline.selected_goals'),
    fact('urgency', 'Срочность', s.urgency, s.urgency_source || 'Leads.Raw JSON'),
    fact('financial_system', 'Что сообщил о финансовой системе', s.financial_system, s.financial_system_source || 'Leads.Raw JSON'),
    fact('documents', 'Какие материалы доступны', s.documents, s.documents_source || 'Pipeline.selected_documents'),
    fact('capital_context', 'Капитал и финансирование', s.capital_context, s.capital_context_source || 'Leads.Raw JSON')
  ].filter(Boolean);
  return out;
}

function evidenceIds(value, known) {
  return lines(value, 8, 60).filter((id) => known.has(id));
}

function interpretation(item, known) {
  const i = item && typeof item === 'object' ? item : {};
  const conclusion = text(i.conclusion || i.observation, 700);
  if (!conclusion) return null;
  return {
    kind: INFORMATION_KIND.FINMENTOR_INTERPRETATION,
    conclusion,
    evidence_fact_ids: evidenceIds(i.evidence_fact_ids || i.evidence, known),
    hypothesis: text(i.hypothesis, 700),
    economic_implication: text(i.economic_implication, 500)
  };
}

function normalizeOwnerBrief(raw, context) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = context || {};
  const facts = Array.isArray(c.client_facts)
    ? c.client_facts.filter((x) => x && x.kind === INFORMATION_KIND.CLIENT_FACT && text(x.value))
    : [];
  const known = new Set(facts.map((x) => x.id));
  const diagnoses = (Array.isArray(r.diagnoses) ? r.diagnoses : [])
    .map((x) => interpretation(x, known)).filter(Boolean).slice(0, 4);
  const painMap = (Array.isArray(r.pain_map) ? r.pain_map : []).map((p) => {
    const x = p && typeof p === 'object' ? p : {};
    if (!text(x.area)) return null;
    return {
      kind: INFORMATION_KIND.FINMENTOR_INTERPRETATION,
      area: text(x.area, 120), attention: text(x.attention || 'Требует внимания', 80),
      observation: text(x.observation, 500), consequence: text(x.consequence, 500),
      economic_category: text(x.economic_category, 80),
      evidence_fact_ids: evidenceIds(x.evidence_fact_ids || x.evidence, known)
    };
  }).filter(Boolean).slice(0, 4);
  const unknowns = (Array.isArray(r.unknowns) ? r.unknowns : []).map((u) => {
    const x = u && typeof u === 'object' ? u : { item: u };
    const item = text(x.item || x.missing_information, 400);
    return item ? { kind: INFORMATION_KIND.NEEDS_VERIFICATION, item, why: text(x.why || x.why_it_matters, 500) } : null;
  }).filter(Boolean).slice(0, 7);
  const questions = (Array.isArray(r.discovery_questions) ? r.discovery_questions : []).map((q) => {
    const x = q && typeof q === 'object' ? q : {};
    const question = text(x.question, 500); const why = text(x.why || x.purpose, 500);
    return question && why ? { question, why, kind: INFORMATION_KIND.FINMENTOR_INTERPRETATION } : null;
  }).filter(Boolean).slice(0, 7);
  const sh = r.solution_hypothesis && typeof r.solution_hypothesis === 'object' ? r.solution_hypothesis : {};
  const product = PRODUCT_CODES.includes(String(sh.product || '').toUpperCase())
    ? String(sh.product).toUpperCase() : 'NEEDS_CLARIFICATION';
  const nh = r.next_action && typeof r.next_action === 'object' ? r.next_action : {};

  return {
    schema_version: 'lead-intelligence-v1',
    generated_at: text(c.generated_at || new Date().toISOString(), 40),
    intelligence_version: Number(c.intelligence_version) > 0 ? Number(c.intelligence_version) : 1,
    header: {
      company: text(c.company, 160), contact_name: text(c.contact_name, 120), role: text(c.role, 100),
      business: text(c.business, 160), scale: text(c.scale, 160), source: text(c.source, 80),
      lead_status: text(c.lead_status, 100), data_quality: text(c.data_quality || 'Требует проверки', 120),
      commercial_intent: c.commercial_intent_confirmed === true ? text(c.commercial_intent, 160) : 'Не подтверждён',
      next_action: text(c.next_action || nh.action, 300), next_action_date: text(c.next_action_date || nh.due_date, 40),
      diagnostic_score: c.diagnostic_score === '' || c.diagnostic_score === null || c.diagnostic_score === undefined ? null : Number(c.diagnostic_score),
      financial_zone: text(c.financial_zone || 'UNKNOWN', 20)
    },
    contact: c.contact || buildReachability(c),
    client_facts: facts,
    diagnoses,
    pain_map: painMap,
    unknowns,
    first_meeting_objective: text(r.first_meeting_objective, 700),
    conversation_opening: text(r.conversation_opening, 900),
    discovery_questions: questions,
    solution_hypothesis: {
      kind: INFORMATION_KIND.FINMENTOR_INTERPRETATION,
      product,
      format: text(sh.format || 'Сначала требуется уточнение', 220),
      rationale: text(sh.rationale, 700),
      confirmation_conditions: lines(sh.confirmation_conditions, 6, 400),
      if_confirmed: text(sh.if_confirmed, 500),
      do_not_offer_yet: text(sh.do_not_offer_yet, 500)
    },
    next_action: {
      action: text(nh.action || c.next_action, 300), purpose: text(nh.purpose, 500),
      success_condition: text(nh.success_condition, 700), due_date: text(nh.due_date || c.next_action_date, 40)
    },
    owner_confirmed_facts: Array.isArray(c.owner_confirmed_facts) ? c.owner_confirmed_facts.slice(0, 20) : [],
    owner_notes: Array.isArray(c.owner_notes) ? c.owner_notes.slice(0, 20) : [],
    history: Array.isArray(c.history) ? c.history.slice(0, 30) : [],
    client_result_eligible: c.client_result_eligible === true
  };
}

function briefErrors(brief) {
  const b = brief || {}; const errors = [];
  if (!Array.isArray(b.client_facts) || !b.client_facts.length) errors.push('client_facts empty');
  if (!Array.isArray(b.diagnoses) || b.diagnoses.length < 2 || b.diagnoses.length > 4) errors.push('diagnoses must contain 2..4 items');
  if (!Array.isArray(b.pain_map) || b.pain_map.length < 1 || b.pain_map.length > 4) errors.push('pain_map must contain 1..4 items');
  if (!Array.isArray(b.unknowns) || b.unknowns.length < 1 || b.unknowns.length > 7) errors.push('unknowns must contain 1..7 items');
  if (!text(b.first_meeting_objective)) errors.push('first_meeting_objective empty');
  if (!text(b.conversation_opening)) errors.push('conversation_opening empty');
  if (!Array.isArray(b.discovery_questions) || b.discovery_questions.length < 5 || b.discovery_questions.length > 7) errors.push('discovery_questions must contain 5..7 items');
  if ((b.discovery_questions || []).some((q) => !text(q.why))) errors.push('every discovery question needs a purpose');
  if (!text(b.solution_hypothesis && b.solution_hypothesis.rationale)) errors.push('solution rationale empty');
  if (!(b.solution_hypothesis && b.solution_hypothesis.confirmation_conditions || []).length) errors.push('solution confirmation conditions empty');
  if (!text(b.next_action && b.next_action.action) || !text(b.next_action && b.next_action.purpose) || !text(b.next_action && b.next_action.success_condition)) errors.push('next_action incomplete');
  for (const f of b.client_facts || []) if (f.kind !== INFORMATION_KIND.CLIENT_FACT || !f.source_path) errors.push('client fact provenance missing');
  for (const d of b.diagnoses || []) if (d.kind !== INFORMATION_KIND.FINMENTOR_INTERPRETATION) errors.push('diagnosis provenance invalid');
  for (const u of b.unknowns || []) if (u.kind !== INFORMATION_KIND.NEEDS_VERIFICATION) errors.push('unknown provenance invalid');
  return [...new Set(errors)];
}

const api = {
  INFORMATION_KIND, OUTCOME_CODES, PRODUCT_CODES, CONTACT_LABEL,
  text, lines, channelKey, validEmail, validPhone, telegramUsername, telegramNumeric,
  buildReachability, buildClientFacts, normalizeOwnerBrief, briefErrors
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
