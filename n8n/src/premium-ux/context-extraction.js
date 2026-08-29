// FINMENTOR Premium UX — structured context extraction from free text.
//
// The mechanism that makes TG_CONFIRM_CONTEXT reachable. Until now the state existed, was gated and
// was unreachable, because nothing populated the values it renders.
//
// ── WHAT THIS MODULE IS, AND IS NOT ────────────────────────────────────────────────────────────
//
// It is the GATEKEEPER over extraction, not the extractor's brain. An upstream step — a model, or
// the conservative deterministic pass in `extractDeterministic()` below — PROPOSES a structured
// object. `normalise()` decides what, if anything, is allowed through.
//
// That split is the whole design. A model can say anything; this module can only emit values drawn
// from the approved vocabularies, on the approved fields, marked `ai_inferred` and unconfirmed. An
// unrestricted diagnosis cannot reach the draft because there is no code path that carries one.
//
// ── THE RULES, AND WHERE EACH IS ENFORCED ──────────────────────────────────────────────────────
//
//   1. Only the six supported fields survive. Anything else is DROPPED — `EXTRACTABLE`.
//   2. Everything emitted is `source: 'ai_inferred'`, `confirmed: false` — `toDraftFields()`.
//   3. `ai_inferred` never skips a question. Enforced in draft-contract.js `canSkip()`, which
//      returns false for it; this module never sets `confirmed: true`, so it cannot bypass that.
//   4. TG_CONFIRM_CONTEXT renders only non-empty values — `branches.confirmContextSections()`.
//   5. «Всё верно» promotes ONLY what was shown — `promoteShown()`.
//   6. «Исправить» discards the proposal entirely — `discard()`. Correction must not begin from a
//      silently retained wrong guess.
//   8. `objective` maps only to the exact eight-objective taxonomy — `OBJECTIVE_PATTERNS`.
//   9. Ambiguity yields UNKNOWN, never a guess — every classifier here returns null on a tie, and
//      `turnover_band` is never inferred from prose at all.
//
// (Rules 7, 10, 11, 12 and 13 are properties of what this module does NOT do: it performs no I/O,
// creates no lead, rotates no cycle, and never sees Telegram initData. It is a pure function.)
//
// ── WHY `turnover_band` IS NEVER INFERRED ──────────────────────────────────────────────────────
//
// The approved scale bands are money ranges, and one of them is «Предпочитаю не указывать» — an
// explicit refusal. Guessing a band from «у нас небольшая компания» would put a number in a
// consultant's brief that the client never gave, and would make «Предпочитаю не указывать»
// unreachable by inference. It stays a question.

'use strict';

const B = require('./branches.js');

// Rule 1. The only fields extraction may propose. `problem_summary` is display-only: it is shown on
// the confirmation screen but is NOT a draft field — the client's own words are stored verbatim as
// free text, and the branch `problem` remains a question with approved options.
const EXTRACTABLE = ['company_name', 'business_activity', 'role', 'objective', 'problem_summary'];

// Which of those actually become draft fields on confirmation.
const DRAFT_BACKED = ['company_name', 'business_activity', 'role', 'objective'];

const MAX_LEN = { company_name: 200, business_activity: 200, role: 200, problem_summary: 300 };

const str = (v) => String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ');
const norm = (v) => str(v).toLowerCase().replace(/ё/g, 'е');

// ---------------------------------------------------------------- objective (rule 8, rule 9)

// Deliberately narrow. Each objective is recognised only by vocabulary that is unambiguous for it;
// a phrase that fits two objectives scores both and the tie resolves to UNKNOWN.
//
// `independent_view` and `other` are NOT inferable. «Нужен независимый взгляд» is a statement about
// what the client wants from FINMENTOR, not about their situation, and inferring it from a vague
// message would turn "we could not tell" into a product answer. «Другая задача» is the same failure
// wearing a different label. Both remain choices the client makes.
const OBJECTIVE_PATTERNS = {
  financial_management: [
    'управленческ', 'управленческий учет', 'отчетност', 'отчетно', 'бюджет', 'бюджетирован',
    'финансовая функция', 'финансовый директор', 'cfo', 'консолидац', 'закрытие месяца',
    'план-факт', 'планфакт', 'учетная политика'
  ],
  profitability: [
    'маржинальност', 'маржа', 'себестоимост', 'рентабельност', 'прибыльност', 'юнит-экономик',
    'юнит экономик', 'снизить расходы', 'сократить расходы', 'издержк', 'убыточн'
  ],
  cash_flow: [
    'кассовый разрыв', 'кассовые разрывы', 'денежный поток', 'денежного потока', 'cash flow',
    'cashflow', 'ликвидност', 'нехватка денег', 'не хватает денег', 'платежный календар',
    'дебиторск', 'оборотный капитал'
  ],
  investment: [
    'финмодел', 'финансовая модель', 'финансовую модель', 'новый проект', 'новое направление',
    'окупаемост', 'доходность проекта', 'сценарн', 'инвестиционный проект', 'запуск производства'
  ],
  real_estate: [
    'недвижимост', 'помещени', 'здани', 'участок земли', 'аренда помещ', 'купить объект',
    'продажа объекта', 'коммерческая недвижимост'
  ],
  financing: [
    'кредит', 'банк', 'банковск', 'инвестор', 'привлечь финансирован', 'привлечение финансирован',
    'структура капитала', 'заем', 'заём', 'лизинг', 'рефинансир'
  ]
};

// Rule 8 + rule 9. Returns an objective id from the approved taxonomy, or null.
function classifyObjective(text) {
  const t = norm(text);
  if (!t) { return null; }
  const scores = {};
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const id of Object.keys(OBJECTIVE_PATTERNS)) {
    let n = 0;
    for (const p of OBJECTIVE_PATTERNS[id]) { if (t.indexOf(p) !== -1) { n += 1; } }
    if (n === 0) { continue; }
    scores[id] = n;
    if (n > bestScore) { best = id; bestScore = n; tie = false; }
    else if (n === bestScore) { tie = true; }
  }
  if (!best || tie) { return null; }              // rule 9: ambiguity stays unknown
  // A single incidental keyword is not a classification. Two independent signals, or one signal in
  // a short focused message, is the threshold.
  if (bestScore < 2 && t.length > 160) { return null; }
  // The id must exist in the approved taxonomy. If the taxonomy is ever edited, this fails closed.
  return B.OBJECTIVE_IDS.indexOf(best) !== -1 ? best : null;
}

// ---------------------------------------------------------------- company / role (rule 9)

// Company names in free text are quoted, or follow an explicit legal form. Anything looser produces
// false positives — «мы работаем с крупными клиентами» is not a company called «крупными».
const COMPANY_PATTERNS = [
  /«([^»]{2,80})»/,
  /"([^"]{2,80})"/,
  /(?:^|[^А-Яа-яЁёA-Za-z])(?:ООО|АО|ЗАО|ИП|SRL|SA|S\.R\.L\.|GmbH|LLC|Ltd)\s+«?"?([A-Za-zА-Яа-яЁё0-9 .&'-]{2,60})»?"?/i
];

function extractCompany(text) {
  const raw = str(text);
  for (const re of COMPANY_PATTERNS) {
    const m = raw.match(re);
    if (m && str(m[1])) { return str(m[1]).slice(0, MAX_LEN.company_name); }
  }
  return null;
}

// Only first-person role statements. «нам нужен финансовый директор» is a requirement, not a role,
// and must not become «Ваша роль: финансовый директор» on a confirmation screen.
const ROLE_PATTERNS = [
  { re: /(?:^|[^А-Яа-яЁёA-Za-z])(?:я|мы|Я|Мы)\s+(?:—|-|это)?\s*(собственник|учредител[а-яё]*|основател[а-яё]*|владел[а-яё]*)/i, label: 'Собственник' },
  { re: /(?:^|[^А-Яа-яЁёA-Za-z])(?:я|мы|Я|Мы)\s+(?:—|-|это)?\s*(генеральн[а-яё]+ директор|ген\.?\s?директор|CEO)/i, label: 'Генеральный директор' },
  { re: /(?:^|[^А-Яа-яЁёA-Za-z])(?:я|мы|Я|Мы)\s+(?:—|-|это)?\s*(финансов[а-яё]+ директор|CFO)/i, label: 'Финансовый директор' },
  { re: /(?:^|[^А-Яа-яЁёA-Za-z])(?:я|мы|Я|Мы)\s+(?:—|-|это)?\s*(главн[а-яё]+ бухгалтер|финансов[а-яё]+ менеджер|руководител[а-яё]*)/i, label: 'Руководитель' },
  { re: /^\s*(?:я\s+)?(собственник|основател[а-яё]*|владел[а-яё]*)\b/i, label: 'Собственник' }
];

function extractRole(text) {
  const raw = str(text);
  for (const p of ROLE_PATTERNS) { if (p.re.test(raw)) { return p.label; } }
  return null;
}

// ---------------------------------------------------------------- business activity

// A short activity phrase, only from an explicit self-description. No inference from context.
const ACTIVITY_PATTERNS = [
  /(?:^|[^А-Яа-яЁёA-Za-z])(?:мы|компания|фирма)\s+(?:занимаемся|занимается|специализируемся|специализируется)\s+(?:на\s+|в\s+)?([А-Яа-яЁёA-Za-z ,-]{4,70})/i,
  /(?:^|[^А-Яа-яЁёA-Za-z])у\s+нас\s+(?:сеть|производство|магазин[а-яё]*|ресторан[а-яё]*|склад[а-яё]*)\s+([А-Яа-яЁёA-Za-z ,-]{3,60})/i
];

function extractActivity(text) {
  const raw = str(text);
  for (const re of ACTIVITY_PATTERNS) {
    const m = raw.match(re);
    if (m && str(m[1]).length >= 4) {
      return str(m[1]).replace(/[.,;:]+$/, '').slice(0, MAX_LEN.business_activity);
    }
  }
  return null;
}

// ---------------------------------------------------------------- the deterministic pass

// The baseline proposer. Conservative by construction: everything it cannot establish, it leaves
// null. It is also the fallback when no model is configured — the confirmation screen then shows
// whatever little it found, or is skipped entirely.
function extractDeterministic(text) {
  const raw = str(text);
  if (!raw) { return {}; }
  const summary = raw.length > MAX_LEN.problem_summary
    ? raw.slice(0, MAX_LEN.problem_summary).replace(/\s+\S*$/, '') + '…'
    : raw;
  return {
    company_name: extractCompany(raw),
    business_activity: extractActivity(raw),
    role: extractRole(raw),
    objective: classifyObjective(raw),
    problem_summary: summary
  };
}

// ---------------------------------------------------------------- normalisation (the gate)

// Takes ANY proposal — from a model or from the pass above — and returns only what is permitted.
// `dropped` names everything refused, so a proposal that tried to widen the surface is visible
// rather than silently trimmed.
function normalise(proposal) {
  const p = (proposal && typeof proposal === 'object' && !Array.isArray(proposal)) ? proposal : {};
  const out = {};
  const dropped = [];

  for (const key of Object.keys(p)) {
    if (EXTRACTABLE.indexOf(key) === -1) { dropped.push(key); }
  }

  for (const field of EXTRACTABLE) {
    const v = p[field];
    if (v === null || v === undefined) { continue; }
    if (typeof v === 'object') { dropped.push(field + ':not-a-scalar'); continue; }

    if (field === 'objective') {
      // Rule 8. A model may return a label, an id, or something invented. Only an exact match on
      // the approved taxonomy survives; `independent_view` and `other` are not inferable.
      const raw = str(v);
      let id = null;
      if (B.OBJECTIVE_IDS.indexOf(raw) !== -1) { id = raw; }
      else {
        const byLabel = B.objectiveByLabel ? B.objectiveByLabel(raw) : null;
        if (byLabel) { id = byLabel.id; }
      }
      if (!id || id === 'independent_view' || id === 'other') {
        if (raw) { dropped.push('objective:' + raw.slice(0, 40)); }
        continue;
      }
      out.objective = id;
      continue;
    }

    const s = str(v);
    if (!s) { continue; }
    out[field] = s.slice(0, MAX_LEN[field] || 200);
  }

  return { fields: out, dropped: dropped };
}

// ---------------------------------------------------------------- the draft envelope (rule 2)

// Everything extraction produces enters the draft as `ai_inferred` and unconfirmed. There is no
// parameter to change that, which is why rule 3 cannot be violated from here: `canSkip()` in
// draft-contract.js returns false for `ai_inferred`, and this never writes anything else.
function toDraftFields(normalised, nowIso) {
  const out = {};
  const f = (normalised && normalised.fields) || {};
  for (const name of DRAFT_BACKED) {
    if (f[name] === undefined) { continue; }
    let value = f[name];
    if (name === 'objective') {
      // The draft contract validates `objective` against B.OBJECTIVE_LABELS, not against ids.
      // The id is the taxonomy-safe internal form — it is what `normalise` can guarantee — and the
      // label is what the draft is allowed to hold. Converting here keeps both true; writing the
      // id straight into the draft produced VALUE_NOT_ALLOWED, which is the contract doing its job.
      const o = B.objectiveById(value);
      if (!o) { continue; }
      value = o.label;
    }
    out[name] = { value: value, source: 'ai_inferred', confirmed: false, at: String(nowIso) };
  }
  return out;
}

// What TG_CONFIRM_CONTEXT will render. Rule 4: a field with no value produces no label, so the
// screen never shows «Компания: —».
function shownSections(normalised, turnoverBand) {
  const f = (normalised && normalised.fields) || {};
  const objective = f.objective ? (B.objectiveById(f.objective) || {}).label : '';
  return B.TG_COPY && B.TG_COPY.TG_CONFIRM_CONTEXT
    ? require('./tg-state-machine.js').confirmContextSections({
        company_name: f.company_name || '',
        role: f.role || '',
        // Never inferred (see the header). Carried only if the client already answered it.
        turnover_band: str(turnoverBand),
        objective: objective || '',
        problem_summary: f.problem_summary || ''
      })
    : [];
}

// Rule 5. «Всё верно» promotes ONLY the fields that were actually on screen. A value extraction
// produced but did not display cannot be confirmed by a tap the client never saw.
function promoteShown(draft, sections, nowIso) {
  const D = require('./draft-contract.js');
  const shown = (sections || []).map((s) => s.key).filter((k) => DRAFT_BACKED.indexOf(k) !== -1);
  if (!shown.length) { return { ok: true, draft: draft, promoted: [] }; }
  const r = D.confirmContext(draft, shown, nowIso);
  if (!r.ok) { return r; }
  return { ok: true, draft: r.draft, promoted: shown };
}

// Rule 6. «Исправить» removes the proposal rather than leaving it in place unconfirmed. Leaving it
// would mean a later screen prefilled with a guess the client has just rejected.
function discard(draft) {
  const next = JSON.parse(JSON.stringify(draft));
  for (const name of DRAFT_BACKED) {
    const f = next.fields[name];
    if (f && f.source === 'ai_inferred' && f.confirmed !== true) {
      next.fields[name] = { value: null, source: null, confirmed: false, at: null };
    }
  }
  return next;
}

module.exports = {
  EXTRACTABLE, DRAFT_BACKED, MAX_LEN, OBJECTIVE_PATTERNS,
  classifyObjective, extractCompany, extractRole, extractActivity,
  extractDeterministic, normalise, toDraftFields, shownSections, promoteShown, discard
};
