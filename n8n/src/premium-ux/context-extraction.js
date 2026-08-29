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
//      `turnover_band` is never inferred from PROSE.
//
// (Rules 7, 10, 11, 12 and 13 are properties of what this module does NOT do: it performs no I/O,
// creates no lead, rotates no cycle, and never sees Telegram initData. It is a pure function.)
//
// ── THE LINE THIS MODULE DRAWS ─────────────────────────────────────────────────────────────────
//
// Three categories, and only the first two may produce a value:
//
//   EXPLICIT FACT       the client said it     «Я собственник Demo Retail» -> Demo Retail
//   NORMALISED FACT     arithmetic or a closed vocabulary applied to something explicit
//                       «оборот около 5 млн евро» -> €2–10 млн
//                       «сеть из 6 магазинов»     -> Розничная торговля
//   UNSUPPORTED         everything else — legal form, headcount, geography beyond what was said,
//                       a financing need, a profitability problem inferred from «компания
//                       прибыльная». These stay UNKNOWN however plausible they look.
//
// `turnover_band` was originally never inferred at all, because the bands are money ranges and one
// of them — «Предпочитаю не указывать» — is an explicit refusal. That reasoning still holds for
// prose: «у нас небольшая компания» yields nothing. The owner has authorised the narrow exception
// of a STATED turnover, which is arithmetic rather than inference. The refusal option remains
// unreachable by any code path here: it is a choice the client makes, and a system that can infer
// it has taken that choice away from them.

'use strict';

const B = require('./branches.js');

// Rule 1. The only fields extraction may propose. `problem_summary` is display-only: it is shown on
// the confirmation screen but is NOT a draft field — the client's own words are stored verbatim as
// free text, and the branch `problem` remains a question with approved options.
const EXTRACTABLE = ['company_name', 'business_activity', 'role', 'objective', 'turnover_band', 'problem_summary'];

// Which of those actually become draft fields on confirmation.
const DRAFT_BACKED = ['company_name', 'business_activity', 'role', 'objective', 'turnover_band'];

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
    'кассовый разрыв', 'кассовые разрывы', 'кассовых разрывов', 'кассовыми разрывами',
    'денежный поток', 'денежного потока', 'денежных средств', 'движение денег', 'движения денег',
    'cash flow', 'cashflow', 'ликвидност', 'нехватка денег', 'не хватает денег',
    'платежный календар', 'дебиторск', 'оборотный капитал',
    // The real UAT text says «прогноз движения денежных средств» and «что будет с деньгами через
    // 2–3 месяца». Neither matched any pattern, so a message that names cash flow four times over
    // scored one point and fell under the two-signal threshold.
    'прогноз движения', 'прогноз денег', 'что будет с деньгами', 'кассового разрыва'
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

// A NEGATED current-setup fact is not an objective. «отдельного CFO нет» describes what the client
// has, and the owner's rule is explicit: carry it as draft context, do not turn it into a top-level
// objective. Left in, it scores `financial_management` off the word "cfo" and competes with the
// objective the client actually described. These spans are removed before scoring, and only these.
const NEGATED_SETUP = [
  /(?:отдельн[а-яё]*\s+)?(?:cfo|финансов[а-яё]+\s+директор[а-яё]*)\s*(?:у\s+нас\s+)?нет/gi,
  /нет\s+(?:отдельн[а-яё]*\s+)?(?:cfo|финансов[а-яё]+\s+директор[а-яё]*)/gi,
  /без\s+(?:отдельн[а-яё]*\s+)?(?:cfo|финансов[а-яё]+\s+директор[а-яё]*)/gi,
  /(?:не\s+ведем|не\s+ведём|нет)\s+(?:бюджет[а-яё]*|управленческ[а-яё]+\s+учет[а-яё]*)/gi
];

// Rule 8 + rule 9. Returns an objective id from the approved taxonomy, or null.
function classifyObjective(text) {
  let t = norm(text);
  if (!t) { return null; }
  for (const re of NEGATED_SETUP) { t = t.replace(re, ' '); }
  const scores = {};
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const id of Object.keys(OBJECTIVE_PATTERNS)) {
    // Score DISTINCT evidence, not pattern hits. Several patterns for one objective can match the
    // same words — «отчетности» matches both 'отчетност' and 'отчетно' — which inflated that
    // objective to two signals off a single word and let it beat a genuinely competing one. A
    // pattern that lands where an earlier one already matched adds nothing.
    const spans = [];
    for (const p of OBJECTIVE_PATTERNS[id]) {
      const at = t.indexOf(p);
      if (at === -1) { continue; }
      const end = at + p.length;
      if (spans.some(([s, e]) => at < e && s < end)) { continue; }
      spans.push([at, end]);
    }
    const n = spans.length;
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

// ── COMPANY ────────────────────────────────────────────────────────────────────────────────────
//
// Two tiers, and the difference matters.
//
// TIER 1 — the name is DELIMITED: quotes, or an explicit legal form. The delimiter itself says
// "this is a name", so whatever it wraps is taken.
//
// TIER 2 — the name follows an explicit naming construction («Я собственник X», «Компания X»).
// Here nothing marks where the name ends, so the capture is validated by `looksLikeCompanyName`
// before it is believed. Without that validator this tier turns «Я собственник небольшого
// бизнеса» into a company called «небольшого бизнеса», and — from the real UAT text — «Компания
// прибыльная, но…» into a company called «прибыльная». Both are in the negative tests.
const COMPANY_DELIMITED = [
  /«([^»]{2,80})»/,
  /"([^"]{2,80})"/,
  /(?:^|[^А-Яа-яЁёA-Za-z])(?:ООО|АО|ЗАО|ИП|SRL|SA|S\.R\.L\.|GmbH|LLC|Ltd)\s+«?"?([A-Za-zА-Яа-яЁё0-9 .&'-]{2,60})»?"?/i
];

// The naming constructions the owner named, plus their first-person variants. Each captures up to
// a sentence boundary; the validator does the rest.
const COMPANY_NAMED = [
  /(?:^|[^А-Яа-яЁёA-Za-z])я\s+(?:—|-|это)?\s*(?:собственник|владелец|основатель|учредитель|директор|руководитель)\s+([^.,;:!?()]{2,60})/i,
  /(?:^|[^А-Яа-яЁёA-Za-z])(?:наша\s+компания|у\s+нас\s+компания|компания)\s+([^.,;:!?()]{2,60})/i,
  /(?:^|[^А-Яа-яЁёA-Za-z])(?:мы|бизнес)\s+—\s+([^.,;:!?()]{2,60})/i
];

// Words that mean the capture is a description, not a name. A candidate containing any of them is
// refused outright, however it is capitalised.
const NOT_A_NAME = [
  'компани', 'фирм', 'бизнес', 'предприят', 'организац', 'холдинг', 'группа компаний',
  'магазин', 'сеть', 'производств', 'ресторан', 'склад', 'проект', 'клиент', 'сотрудник',
  'команд', 'отдел', 'оборот', 'выручк', 'прибыл', 'убыт', 'проблем', 'ситуац', 'задач',
  'вопрос', 'директор', 'бухгалтер', 'консультант', 'работа', 'услуг', 'товар', 'рынок',
  'котор', 'этот', 'наш', 'свой', 'небольш', 'крупн', 'средн', 'мал'
];

// A name, not a noun phrase. The capture runs to the next sentence boundary, so it usually carries
// the rest of the sentence with it — «Наша компания Nordis работает пять лет» captures «Nordis
// работает пять лет». The name is therefore the LEADING RUN of name-like tokens: Latin, or
// Capitalised Cyrillic. The run stops at the first ordinary lowercase word, which is where the
// name ends in every construction this module accepts.
//
// An all-lowercase capture has no leading run at all and yields nothing — that single property is
// what keeps «прибыльная», «небольшого бизнеса» and «нескольких магазинов» out.
const nameLike = (token) => {
  const bare = token.replace(/[^A-Za-zА-Яа-яЁё0-9&.'-]/g, '');
  if (!bare) { return false; }
  return /^[A-Za-z]/.test(bare) || /^[А-ЯЁ]/.test(bare);
};

function looksLikeCompanyName(candidate) {
  const s = str(candidate).replace(/^[«"'\s]+|[»"'\s.]+$/g, '');
  if (s.length < 2 || s.length > 60) { return null; }
  const tokens = s.split(/\s+/).filter(Boolean);
  const run = [];
  for (const t of tokens) {
    if (!nameLike(t)) { break; }
    run.push(t);
    if (run.length === 4) { break; }               // a name, not a sentence
  }
  if (!run.length) { return null; }
  const name = run.join(' ').replace(/[.,;:]+$/, '');
  if (name.length < 2) { return null; }
  const low = norm(name);
  for (const w of NOT_A_NAME) { if (low.indexOf(w) !== -1) { return null; } }
  return name;
}

function extractCompany(text) {
  const raw = str(text);
  for (const re of COMPANY_DELIMITED) {
    const m = raw.match(re);
    if (m && str(m[1])) { return str(m[1]).slice(0, MAX_LEN.company_name); }
  }
  for (const re of COMPANY_NAMED) {
    const m = raw.match(re);
    if (!m) { continue; }
    const name = looksLikeCompanyName(m[1]);
    if (name) { return name.slice(0, MAX_LEN.company_name); }
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

// A CLOSED vocabulary, normalised — not a phrase captured out of the sentence. The previous version
// copied whatever followed «мы занимаемся», which is an unrestricted classifier wearing a regex:
// it could put any words at all on a consultant's brief. This can only ever emit one of the labels
// below, and «сеть из 6 магазинов» — an explicit operating fact — normalises to Розничная торговля.
//
// Adding an entry here is a product decision, not a tuning knob. Nothing outside this list exists.
const ACTIVITY_VOCAB = [
  ['Розничная торговля', ['магазин', 'магазинов', 'магазина', 'розниц', 'розничн', 'retail', 'торговая точка', 'торговых точек']],
  ['Оптовая торговля', ['оптов', 'опт ', 'wholesale', 'дистрибуц', 'дистрибьют']],
  ['Производство', ['производств', 'завод', 'цех', 'фабрик', 'manufactur']],
  ['Строительство', ['строительств', 'строительн', 'застройщик', 'девелопер', 'подрядн']],
  ['Общественное питание', ['ресторан', 'кафе', 'общепит', 'кофейн', 'пекарн']],
  ['Логистика и транспорт', ['логистик', 'перевозк', 'транспортн', 'грузопереваз', 'грузоперевоз']],
  ['Сельское хозяйство', ['сельск', 'агрохолдинг', 'агропром', 'фермерск']],
  ['IT и разработка', ['разработк', 'it-компан', 'software', 'saas', 'аутсорсинг разработки']]
];

// Ambiguity fails closed: a message that reads as two activities yields none. A company that both
// manufactures and retails is a real thing, and guessing which one to print is worse than asking.
function extractActivity(text) {
  const t = norm(text);
  if (!t) { return null; }
  const hits = [];
  for (const [label, patterns] of ACTIVITY_VOCAB) {
    for (const p of patterns) {
      if (t.indexOf(p) !== -1) { hits.push(label); break; }
    }
  }
  if (hits.length !== 1) { return null; }
  return hits[0];
}

// ---------------------------------------------------------------- scale, from an explicit number

// The module's original rule was that `turnover_band` is NEVER inferred, because the bands are
// money ranges and one of them is an explicit refusal. That rule stands for PROSE — «у нас
// небольшая компания» still yields nothing. The owner has authorised one narrow exception: an
// EXPLICITLY STATED turnover, which is arithmetic rather than inference.
//
// Three things keep it honest:
//   * a turnover word must be nearby, so a loan amount or a property price is not read as revenue;
//   * the currency must be EUR, because the bands are in euro and a conversion would be a guess;
//   * «Предпочитаю не указывать» can never be produced — it is a client's choice, not a fact.
const TURNOVER_WORDS = ['оборот', 'выручк', 'выручка', 'товарооборот', 'turnover', 'revenue', 'продаж'];
const EUR_WORDS = ['евро', 'eur', '€', 'euro'];

function bandFor(millions) {
  if (!(millions >= 0)) { return null; }
  if (millions < 0.5) { return 'до €500 тыс.'; }
  if (millions < 2) { return '€500 тыс. – €2 млн'; }
  if (millions < 10) { return '€2–10 млн'; }
  if (millions < 50) { return '€10–50 млн'; }
  return '€50 млн+';
}

function extractTurnoverBand(text) {
  const t = norm(text);
  if (!t) { return null; }
  // Amounts, with their unit. `5 млн евро`, `€5 млн`, `около 5,5 млн €`, `500 тыс. евро`, `€5m`.
  const re = /(?:€\s*)?(\d+(?:[.,]\d+)?)\s*(?:–|—|-)?\s*(\d+(?:[.,]\d+)?)?\s*(млн|миллион[а-я]*|тыс|тысяч[а-я]*|млрд|миллиард[а-я]*|m\b|k\b)/g;
  const found = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const around = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30);
    if (!TURNOVER_WORDS.some((w) => around.indexOf(w) !== -1)) { continue; }
    if (!EUR_WORDS.some((w) => around.indexOf(w) !== -1)) { continue; }
    const unit = m[3];
    const mult = /млрд|миллиард/.test(unit) ? 1000 : (/тыс/.test(unit) || unit === 'k' ? 0.001 : 1);
    const lo = parseFloat(String(m[1]).replace(',', '.')) * mult;
    const hi = m[2] === undefined ? lo : parseFloat(String(m[2]).replace(',', '.')) * mult;
    found.push([lo, hi]);
  }
  if (found.length !== 1) { return null; }        // no amount, or several — ask instead of guessing
  const [lo, hi] = found[0];
  const a = bandFor(lo);
  const b = bandFor(hi);
  if (!a || !b || a !== b) { return null; }       // a range straddling two bands is not a band
  return a;
}

// ---------------------------------------------------------------- the deterministic pass

// The baseline proposer. Conservative by construction: everything it cannot establish, it leaves
// null. It is also the fallback when no model is configured — the confirmation screen then shows
// whatever little it found, or is skipped entirely.
// The summary is EXTRACTIVE — the client's own sentences, selected, never rewritten. An abstractive
// summary would have to state something the client did not, which is precisely what is forbidden.
// Sentences that describe the problem or the wanted outcome are kept, in the order they were
// written; if none can be identified the whole message is truncated as before, because a summary
// that silently drops the only thing said is worse than a long one.
const PROBLEM_MARKERS = [
  'разрыв', 'не хватает', 'нехватка', 'проблем', 'сложност', 'непонятно', 'не понима',
  'не видим', 'не вижу', 'нет понимания', 'хочу пон', 'хотим пон', 'нужно', 'нужен', 'нужна',
  'настроить', 'наладить', 'навести порядок', 'что будет', 'прогноз', 'риск', 'падает',
  'снижается', 'растут', 'убыт', 'кассов'
];

function summarise(raw) {
  const sentences = str(raw).split(/(?<=[.!?])\s+/).map((s) => str(s)).filter(Boolean);
  const picked = sentences.filter((s) => {
    const low = norm(s);
    return PROBLEM_MARKERS.some((m) => low.indexOf(m) !== -1);
  });
  const chosen = picked.length ? picked.join(' ') : str(raw);
  return chosen.length > MAX_LEN.problem_summary
    ? chosen.slice(0, MAX_LEN.problem_summary).replace(/\s+\S*$/, '') + '…'
    : chosen;
}

function extractDeterministic(text) {
  const raw = str(text);
  if (!raw) { return {}; }
  return {
    company_name: extractCompany(raw),
    business_activity: extractActivity(raw),
    role: extractRole(raw),
    objective: classifyObjective(raw),
    turnover_band: extractTurnoverBand(raw),
    problem_summary: summarise(raw)
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

    if (field === 'turnover_band') {
      // An enum over the approved bands, and never the refusal. «Предпочитаю не указывать» is a
      // choice the client makes; a system that can infer it has taken that choice away from them.
      const band = str(v);
      if (B.SCALE_OPTIONS.indexOf(band) === -1 || band === 'Предпочитаю не указывать') {
        if (band) { dropped.push('turnover_band:' + band.slice(0, 40)); }
        continue;
      }
      out.turnover_band = band;
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
  ACTIVITY_VOCAB, SCALE_BANDS_FROM_TURNOVER: bandFor,
  classifyObjective, extractCompany, extractRole, extractActivity, extractTurnoverBand,
  looksLikeCompanyName, summarise,
  extractDeterministic, normalise, toDraftFields, shownSections, promoteShown, discard
};
