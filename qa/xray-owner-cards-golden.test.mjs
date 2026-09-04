#!/usr/bin/env node
// FINMENTOR — X-Ray OWNER cards: deterministic golden renders (OWNER DECISION 2026-09-04).
//
//   node qa/xray-owner-cards-golden.test.mjs
//
// Offline. Drives n8n/src/xray-analysis/owner-cards.js — the module the builder inlines into
// "Validate + Store Rows", "Review POST Verdict" and "Analysis Failed Row" — and pins the EXACT
// rendered Telegram HTML for the cases the owner asked for: with and without a score, every zone,
// the data-quality warning, a long company name, malicious HTML, missing optional fields, the
// approved card and the failure card. Anything that changes a card changes a golden here, on
// purpose and visibly.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const C = require(join(HERE, '..', 'n8n', 'src', 'xray-analysis', 'owner-cards.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + '\n--- got ---\n' + a + '\n--- want ---\n' + b); };

// Tokens that must never appear in an owner card body.
const FORBIDDEN = /Lead ID|review_token|[0-9a-f]{64}|\{"|AI_DRAFT|CLIENT_READY|ANALYSIS_FAILED|\b(ORANGE|RED|YELLOW|GREEN|UNKNOWN|LOW|MEDIUM|HIGH|PARTIAL)\b|Достоверность|Проверить цифры|confidence|prompt|MODEL_OUTPUT_INVALID|RATE_LIMIT|UPSTREAM/;
// Telegram HTML: only <b>, balanced, and no stray angle brackets in the text.
function wellFormed(html) {
  const tags = html.match(/<\/?[^>]*>/g) || [];
  let open = 0;
  for (const t of tags) { assert(/^<\/?b>$/.test(t), 'unexpected tag ' + t); open += t === '<b>' ? 1 : -1; assert(open >= 0, 'closing before opening'); }
  assert(open === 0, 'unbalanced <b>');
  assert(!/[<>]/.test(html.replace(/<\/?b>/g, '')), 'unescaped angle bracket in text');
}

const RU = {
  company: 'ООО Пример', locale: 'ru', context: { industry: 'Торговля / Retail', turnover: '1–5M €', employees: '50–100' },
  score: 47, zone: 'ORANGE', maturity: 2, primary_risk: 'Кассовые разрывы и хаотичность платежей',
  priorities: ['Внедрение управленческого P&L по направлениям', 'Усиление контроля движения денежных средств', 'Контроль кредиторской задолженности'],
  product: 'FINANCIAL_HEALTH_CHECK', needs_verification: false
};

console.log('\nFINMENTOR — X-Ray owner cards, golden renders\n');

check('GOLDEN review card — RU client, score 47, ORANGE, clean data', () => {
  eq(C.renderReview(RU), [
    '📊 <b>FINMENTOR · Финансовый рентген</b>',
    '',
    '<b>ООО Пример</b>',
    'Торговля / Retail · 1–5 млн EUR · 50–100 сотрудников · Клиент: RU',
    '',
    '<b>47 / 100</b> · 🟠 <b>Существенные пробелы</b>',
    '<b>Зрелость финансового управления:</b> 2/5',
    '',
    '<b>Ключевой риск</b>',
    'Кассовые разрывы и хаотичность платежей',
    '',
    '<b>Управленческие приоритеты</b>',
    '① Внедрение управленческого P&amp;L по направлениям',
    '② Усиление контроля движения денежных средств',
    '③ Контроль кредиторской задолженности',
    '',
    '<b>Рекомендация FINMENTOR</b>',
    'Комплексная финансовая диагностика (Financial Health Check)',
    '',
    '<b>Статус:</b> ожидает проверки консультанта'
  ].join('\n'), 'review card');
});

const ROMANIAN = /[ăâîșțĂÂÎȘȚ]|\b(flux|numerar|deficit|marja|managerial|raportare|plăți|plati|furnizori|creanțe|datorii|riscuri|abateri)\b/i;

check('GOLDEN review card — RO client (OWNER CORRECTION): Russian owner wording from canonical risk zones, no Romanian prose, «Клиент: RO»', () => {
  const m = Object.assign({}, RU, {
    company: 'UAT SRL Sintetic Retail', locale: 'ro', context: { industry: 'Comerț / Retail', turnover: '1–5M €', employees: '50–100' },
    score: '', zone: 'UNKNOWN', maturity: 3,
    primary_risk: 'Deficit recurent de numerar', priorities: ['Flux de numerar săptămânal cu scenarii', 'P&L managerial pe direcții', 'Marja pe categorii'],
    risk_zones: ['cash_flow', 'margin', 'kpi_dashboard'], product: 'DISCOVERY_CALL', needs_verification: true
  });
  const t = C.renderReview(m);
  eq(t, [
    '📊 <b>FINMENTOR · Финансовый рентген</b>',
    '',
    '<b>UAT SRL Sintetic Retail</b>',
    '1–5 млн EUR · 50–100 сотрудников · Клиент: RO',
    '',
    '⚪ <b>Недостаточно данных</b>',
    '<b>Зрелость финансового управления:</b> 3/5',
    '',
    '<b>Ключевой риск</b>',
    'Денежный поток (Cash Flow)',
    '',
    '<b>Зоны риска по анкете</b>',
    '① Денежный поток (Cash Flow)',
    '② Реальная маржа',
    '③ KPI, риски и отклонения',
    '',
    '<b>Рекомендация FINMENTOR</b>',
    'Диагностическая встреча (Discovery Call)',
    '',
    '⚠️ <b>Требуется проверка исходных данных</b>',
    '',
    '<b>Статус:</b> ожидает проверки консультанта'
  ].join('\n'), 'RO review card');
  assert(!ROMANIAN.test(t.replace(/Клиент: RO/g, '')), 'Romanian free text leaked into the Russian owner card');
});

check('RO client without canonical risk zones: the card points at the detailed analysis and omits the free-text priorities', () => {
  const t = C.renderReview(Object.assign({}, RU, { locale: 'ro', context: { industry: 'Comerț / Retail', turnover: '', employees: '' }, primary_risk: 'Deficit recurent de numerar', priorities: ['Flux de numerar'], risk_zones: [] }));
  assert(t.indexOf('<b>Ключевой риск</b>\nСм. подробный анализ клиента') !== -1, 'neutral pointer missing');
  assert(t.indexOf('Управленческие приоритеты') === -1 && t.indexOf('Зоны риска по анкете') === -1, 'a priorities block rendered without Russian content');
  assert(t.indexOf('Comerț') === -1 && t.indexOf('Клиент: RO') !== -1, 'Romanian context or missing marker');
  assert(!ROMANIAN.test(t.replace(/Клиент: RO/g, '')), 'Romanian free text leaked');
});

check('ownerSafe: Cyrillic and approved Latin terms pass; Romanian and other Latin prose do not', () => {
  for (const s of ['Кассовые разрывы', 'Retail', 'Управленческий P&L', '1–5M €', 'Power BI', 'Cash Flow']) { assert(C.ownerSafe(s) === true, 'rejected: ' + s); }
  for (const s of ['Deficit recurent de numerar', 'Proprietar', 'Comerț / Retail', 'Plăți haotice', 'Cash flow forecast missing', '']) { assert(C.ownerSafe(s) === false, 'accepted: ' + s); }
});

check('no score: «Недостаточно данных» appears exactly once and no «/ 100» line', () => {
  const t = C.renderReview(Object.assign({}, RU, { score: null, zone: 'UNKNOWN' }));
  eq((t.match(/Недостаточно данных/g) || []).length, 1, 'count');
  assert(t.indexOf('для оценки') === -1, 'the retired UNKNOWN wording survives');
  assert(!/\/ 100/.test(t), 'a score line rendered without a score');
});

for (const [zone, want] of [['RED', '🔴 <b>Критическая зона</b>'], ['ORANGE', '🟠 <b>Существенные пробелы</b>'], ['YELLOW', '🟡 <b>Требует внимания</b>'], ['GREEN', '🟢 <b>Устойчивое управление</b>']]) {
  check('zone ' + zone + ' renders as professional Russian with one icon', () => {
    const t = C.renderReview(Object.assign({}, RU, { zone, score: zone === 'GREEN' ? 84 : 47 }));
    assert(t.indexOf(want) !== -1, 'missing ' + want);
    assert(!new RegExp('\\b' + zone + '\\b').test(t), 'raw enum ' + zone + ' leaked');
  });
}
check('an unknown zone string never renders raw', () => {
  const t = C.renderReview(Object.assign({}, RU, { zone: 'purple <script>' }));
  assert(t.indexOf('⚪ <b>Недостаточно данных</b>') !== -1 && !/purple|script/.test(t), 'raw zone leaked');
});

check('data-quality warning is ONE line, never a bare figure', () => {
  const t = C.renderReview(Object.assign({}, RU, { needs_verification: true }));
  eq((t.match(/⚠️ <b>Требуется проверка исходных данных<\/b>/g) || []).length, 1, 'warning count');
  assert(!/Проверить цифры|12mil|LOW/.test(t), 'raw flag text leaked');
  assert(!/Требуется проверка/.test(C.renderReview(RU)), 'warning shown without a doubt');
});

check('long company name is truncated at 70 with an ellipsis and stays bold', () => {
  const long = 'Общество с ограниченной ответственностью «Международная торгово-производственная компания Северо-Восток и партнёры»';
  const t = C.renderReview(Object.assign({}, RU, { company: long }));
  const m = /<b>([^<]*)<\/b>\n/.exec(t.split('\n\n')[1]);
  assert(m && m[1].length <= 71 && /…$/.test(m[1]), 'company not truncated: ' + (m && m[1]));
  wellFormed(t);
});

check('malicious HTML in company, risk and priorities is escaped, never interpreted', () => {
  const t = C.renderReview(Object.assign({}, RU, { company: 'Alfa <Grup> & Co <b>x</b>', primary_risk: '<i>риск</i> & <a href="x">y</a>', priorities: ['</b><script>alert(1)</script>'] }));
  assert(t.indexOf('<b>Alfa &lt;Grup&gt; &amp; Co &lt;b&gt;x&lt;/b&gt;</b>') !== -1, 'company not escaped');
  assert(t.indexOf('&lt;i&gt;риск&lt;/i&gt; &amp; &lt;a href="x"&gt;y&lt;/a&gt;') !== -1, 'risk not escaped');
  assert(t.indexOf('① &lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;') !== -1, 'priority not escaped');
  wellFormed(t);
});

check('missing optional fields: no context, no risk, no priorities, unknown product, no maturity — sections omitted, no empty headings', () => {
  const t = C.renderReview({ company: '', locale: 'ru', context: null, score: 61, zone: 'YELLOW', maturity: '', primary_risk: '', priorities: [], product: 'SOMETHING', needs_verification: false });
  eq(t, [
    '📊 <b>FINMENTOR · Финансовый рентген</b>',
    '',
    '<b>Компания не указана</b>',
    'Клиент: RU',
    '',
    '<b>61 / 100</b> · 🟡 <b>Требует внимания</b>',
    '',
    '<b>Статус:</b> ожидает проверки консультанта'
  ].join('\n'), 'minimal card');
});

check('priorities are capped at three and numbered ①②③', () => {
  const t = C.renderReview(Object.assign({}, RU, { priorities: ['a', 'b', 'c', 'd', 'e'] }));
  assert(/① a\n② b\n③ c\n\n/.test(t) && !/④|⑤| d\n| e\n/.test(t), 'cap or numbering wrong');
});

check('GOLDEN approved card', () => {
  eq(C.renderApproved({ company: 'Mega Parc SRL', locale: 'ru' }), [
    '✅ <b>FINMENTOR · Анализ подтверждён</b>',
    '',
    '<b>Mega Parc SRL</b>',
    'Клиент: RU',
    '',
    'Результат открыт клиенту в Mini App.',
    '<b>Статус:</b> готово для клиента'
  ].join('\n'), 'approved card');
  assert(/Клиент: RO/.test(C.renderApproved({ company: 'X', locale: 'ro' })), 'RO marker');
  assert(/Компания не указана/.test(C.renderApproved({ locale: 'ru' })), 'legacy row without company');
});

check('GOLDEN failure card — model contract broken', () => {
  eq(C.renderFailed({ company: 'ООО Пример', locale: 'ru', cause: 'MODEL_OUTPUT_INVALID' }), [
    '❌ <b>FINMENTOR · Анализ не сформирован</b>',
    '',
    '<b>ООО Пример</b>',
    'Клиент: RU',
    '',
    '<b>Причина</b>',
    'Модель вернула ответ вне контракта анализа',
    '',
    '<b>Что сделать</b>',
    'Удалить строку этого анализа в XRay_Analysis — на следующем цикле анализ будет выполнен повторно.'
  ].join('\n'), 'failure card');
});
for (const [cause, want] of [['RATE_LIMIT', 'Превышен лимит запросов к модели'], ['AUTH', 'Ошибка доступа к модели'], ['MODEL', 'Модель недоступна'], ['UPSTREAM_TRANSIENT', 'Временный сбой на стороне модели'], ['UNKNOWN', 'Неизвестная ошибка'], ['weird', 'Неизвестная ошибка']]) {
  check('failure cause ' + cause + ' renders as Russian', () => { const t = C.renderFailed({ company: 'X', locale: 'ru', cause }); assert(t.indexOf(want) !== -1 && !new RegExp('\\b' + cause + '\\b').test(t), 'cause text'); });
}

check('every card is well-formed Telegram HTML, carries no forbidden token, and is 100–1000 characters', () => {
  const cards = [
    C.renderReview(RU), C.renderReview(Object.assign({}, RU, { score: '', zone: 'UNKNOWN', needs_verification: true })),
    C.renderApproved({ company: 'X', locale: 'ru' }), C.renderFailed({ company: 'X', locale: 'ru', cause: 'AUTH' })
  ];
  for (const t of cards) {
    wellFormed(t);
    assert(!FORBIDDEN.test(t), 'forbidden token in: ' + t.slice(0, 80));
    assert(t.length >= 100 && t.length <= 1000, 'length ' + t.length);   // the approved card is short by design
  }
  assert(C.renderReview(RU).length >= 500, 'the review card is shorter than the 600–1000 target range allows for a full analysis: ' + C.renderReview(RU).length);
});

check('the client language is metadata only: the card never switches its own language', () => {
  const t = C.renderReview(Object.assign({}, RU, { locale: 'ro' }));
  assert(/Клиент: RO/.test(t) && /Финансовый рентген/.test(t) && /Зрелость финансового управления/.test(t) && /ожидает проверки консультанта/.test(t), 'card language drifted');
});

check('company scale renders in the owner format: «1–5 млн EUR», «500 тыс. – 2 млн EUR», unknown shapes untouched', () => {
  eq(C.scaleLabel('1–5M €'), '1–5 млн EUR', 'M €');
  eq(C.scaleLabel('5-10M €'), '5–10 млн EUR', 'hyphen');
  eq(C.scaleLabel('2–5 mln EUR'), '2–5 млн EUR', 'mln EUR');
  eq(C.scaleLabel('€500 тыс. – €2 млн'), '500 тыс. – 2 млн EUR', 'тыс./млн');
  eq(C.scaleLabel('до 500 тыс. EUR'), 'до 500 тыс. EUR', 'unknown shape kept');
  eq(C.scaleLabel(''), '', 'empty');
  const t = C.renderReview(Object.assign({}, RU, { context: { industry: 'Retail', turnover: '€500 тыс. – €2 млн', employees: '10–20' } }));
  assert(t.indexOf('Retail · 500 тыс. – 2 млн EUR · 10–20 сотрудников · Клиент: RU') !== -1, 'context line: ' + t.split('\n')[3]);
});

check('deterministic: 25 renders of the same model are byte-identical', () => {
  const first = C.renderReview(RU);
  for (let i = 0; i < 25; i++) { eq(C.renderReview(RU), first, 'render ' + i); }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
