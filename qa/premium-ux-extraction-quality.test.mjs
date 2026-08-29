#!/usr/bin/env node
// FINMENTOR — extraction QUALITY: the explicit facts must be found, and nothing else may be.
//
//   node qa/premium-ux-extraction-quality.test.mjs
//
// The sibling gate (premium-ux-extraction.test.mjs) proves the GATEKEEPER: that nothing outside the
// approved vocabularies can get through. This one proves the opposite failure — the extractor was
// so conservative that a message stating six facts outright yielded two, and the confirmation
// screen showed the client their own sentence read back to them.
//
// Every positive case here is an EXPLICIT FACT or a NORMALISATION of one. Every negative case is
// something a looser extractor would have guessed.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const X = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'context-extraction.js'));
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ' — ' + e.message); console.log('  FAIL  ' + name + ' — ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };
const fields = (t) => X.normalise(X.extractDeterministic(t)).fields;

console.log('Premium UX — extraction quality');
console.log('');

// ---------------------------------------------------------------- the real owner UAT text

const UAT = 'Я собственник Demo Retail. У нас сеть из 6 магазинов в Молдове, ' +
  'годовой оборот около 5 млн евро. Компания прибыльная, но последние месяцы регулярно ' +
  'возникают кассовые разрывы и не хватает понимания, что будет с деньгами через 2–3 месяца. ' +
  'Используем 1C и бухгалтерский учёт, отдельного CFO нет. Хочу понять причины проблемы и ' +
  'настроить прогноз движения денежных средств. Решение нужно в течение ближайшего месяца.';

check('the real Demo Retail text yields every explicitly stated fact', () => {
  const f = fields(UAT);
  eq(f.company_name, 'Demo Retail', 'company');
  eq(f.role, 'Собственник', 'role');
  eq(f.turnover_band, '€2–10 млн', 'scale');
  eq(f.business_activity, 'Розничная торговля', 'activity');
  eq(f.objective, 'cash_flow', 'objective');
  assert(String(f.problem_summary || '').length > 0, 'no problem summary');
});

check('the problem summary is the client\'s own words, not a rewrite', () => {
  const f = fields(UAT);
  // Extractive: every sentence it emits must appear verbatim in the original.
  for (const s of String(f.problem_summary).replace(/…$/, '').split(/(?<=[.!?])\s+/)) {
    const t = s.trim();
    if (t.length < 12) { continue; }
    assert(UAT.indexOf(t.replace(/…$/, '')) !== -1, 'the summary invented a sentence: ' + t.slice(0, 60));
  }
  assert(String(f.problem_summary).indexOf('кассовые разрывы') !== -1, 'the summary dropped the stated problem');
});

check('nothing unstated is inferred from the same text', () => {
  const f = fields(UAT);
  const j = JSON.stringify(f);
  // Profitability: the client says the company IS profitable. That is not a profitability problem.
  eq(f.objective, 'cash_flow', 'the objective drifted off the stated one');
  // No legal form, no headcount, no financing need, no geography beyond what was said.
  for (const invented of ['ООО', 'SRL', 'сотрудник', 'кредит', 'инвестор', 'Молдова']) {
    assert(j.indexOf(invented) === -1 || String(f.problem_summary).indexOf(invented) !== -1,
      'an unstated fact reached a structured field: ' + invented);
  }
});

// ---------------------------------------------------------------- company: negatives

check('an ordinary noun phrase is never read as a company name', () => {
  const negatives = [
    ['Я собственник небольшого бизнеса.', 'небольшого бизнеса'],
    ['Я собственник компании.', 'компании'],
    ['Компания прибыльная, но есть проблемы.', 'прибыльная'],
    ['Наша компания растёт очень быстро.', 'растёт'],
    ['Я владелец нескольких магазинов.', 'магазинов'],
    ['Я собственник и хочу разобраться.', 'и хочу'],
    ['У нас компания среднего размера.', 'среднего']
  ];
  for (const [text, wrong] of negatives) {
    const c = fields(text).company_name;
    assert(!c || c.indexOf(wrong.split(' ')[0]) === -1,
      JSON.stringify(text) + ' produced company ' + JSON.stringify(c));
  }
});

check('an explicit naming construction IS read as a company name', () => {
  const positives = [
    ['Я собственник Demo Retail.', 'Demo Retail'],
    ['Я владелец Alfa Group, у нас производство.', 'Alfa Group'],
    ['Компания Vector Trade, годовой оборот растёт.', 'Vector Trade'],
    ['Наша компания Nordis работает пять лет.', 'Nordis'],
    ['Мы ООО «Ромашка», занимаемся розницей.', 'Ромашка'],
    ['У нас компания Barza SRL.', 'Barza SRL']
  ];
  for (const [text, want] of positives) {
    eq(fields(text).company_name, want, JSON.stringify(text));
  }
});

check('a quoted or legal-form name still wins, and is not validated away', () => {
  eq(fields('Мы ООО «Северный ветер», у нас производство.').company_name, 'Северный ветер', 'quoted name');
});

// ---------------------------------------------------------------- scale

check('an explicit turnover normalises to the approved band', () => {
  const cases = [
    ['годовой оборот около 5 млн евро', '€2–10 млн'],
    ['оборот 5 млн евро в год', '€2–10 млн'],
    ['выручка €5 млн', '€2–10 млн'],
    ['годовой оборот 800 тыс. евро', '€500 тыс. – €2 млн'],
    ['оборот 300 тыс евро', 'до €500 тыс.'],
    ['выручка 25 млн евро', '€10–50 млн'],
    ['оборот 120 млн евро', '€50 млн+']
  ];
  for (const [text, want] of cases) {
    eq(X.extractTurnoverBand(text), want, JSON.stringify(text));
  }
});

check('every band it can emit is an approved option, and never the refusal', () => {
  for (const v of [0.1, 0.4, 0.6, 1.9, 2, 9.9, 10, 49, 50, 500]) {
    const band = X.SCALE_BANDS_FROM_TURNOVER(v);
    assert(B.SCALE_OPTIONS.indexOf(band) !== -1, v + 'M produced a band that is not approved: ' + band);
    assert(band !== 'Предпочитаю не указывать', 'the refusal option was inferred');
  }
  // And the gate refuses it even if a proposal tries to set it directly.
  const r = X.normalise({ turnover_band: 'Предпочитаю не указывать' });
  assert(r.fields.turnover_band === undefined, 'the refusal survived normalisation');
  assert(r.dropped.some((d) => d.indexOf('turnover_band') === 0), 'the refusal was dropped silently');
});

check('scale stays UNKNOWN without an explicit turnover', () => {
  const negatives = [
    'У нас небольшая компания.',
    'Мы средний бизнес в Молдове.',
    'Компания крупная, работаем давно.',
    'Взяли кредит на 5 млн евро.',              // an amount, but not turnover
    'Купили помещение за 3 млн евро.',          // an amount, but not turnover
    'Оборот примерно 5 млн леев.',              // turnover, but not EUR
    'Оборот вырос в 5 раз.'                     // a multiple, not money
  ];
  for (const t of negatives) {
    eq(X.extractTurnoverBand(t), null, JSON.stringify(t) + ' produced a band');
  }
});

check('a turnover range straddling two bands stays UNKNOWN', () => {
  eq(X.extractTurnoverBand('годовой оборот 8–12 млн евро'), null, 'a straddling range produced a band');
  eq(X.extractTurnoverBand('годовой оборот 3–4 млн евро'), '€2–10 млн', 'a range inside one band should resolve');
});

// ---------------------------------------------------------------- business activity

check('an explicit operating fact normalises to an approved activity', () => {
  const cases = [
    ['У нас сеть из 6 магазинов.', 'Розничная торговля'],
    ['Мы занимаемся оптовой дистрибуцией.', 'Оптовая торговля'],
    ['У нас производство, два цеха.', 'Производство'],
    ['Мы строительная компания, подрядные работы.', 'Строительство'],
    ['У нас ресторан и кофейня.', 'Общественное питание'],
    ['Занимаемся логистикой и перевозками.', 'Логистика и транспорт']
  ];
  for (const [text, want] of cases) { eq(X.extractActivity(text), want, JSON.stringify(text)); }
});

check('the activity vocabulary is CLOSED — only approved labels can be emitted', () => {
  const allowed = X.ACTIVITY_VOCAB.map((v) => v[0]);
  const samples = [UAT, 'У нас сеть магазинов', 'Мы занимаемся разработкой ПО', 'производство мебели'];
  for (const s of samples) {
    const a = X.extractActivity(s);
    if (a === null) { continue; }
    assert(allowed.indexOf(a) !== -1, 'emitted an activity outside the vocabulary: ' + a);
  }
  // And a free phrase can no longer be copied out of the sentence.
  eq(X.extractActivity('Мы занимаемся всем понемногу и ещё кое-чем.'), null, 'a free phrase was captured');
});

check('two activities at once fail closed', () => {
  eq(X.extractActivity('У нас производство и сеть магазинов.'), null, 'an ambiguous activity resolved');
});

// ---------------------------------------------------------------- objective

check('cash flow is recognised from the vocabulary the owner named', () => {
  for (const t of [
    'Постоянные кассовые разрывы, нужен платежный календарь.',
    'Не понимаем движение денежных средств на ближайшие месяцы.',
    'Нужен прогноз движения денежных средств и контроль ликвидности.',
    'Есть кассовый разрыв, не хватает денег на закупки.'
  ]) { eq(X.classifyObjective(t), 'cash_flow', JSON.stringify(t)); }
});

check('a negated setup fact does not become an objective', () => {
  // «отдельного CFO нет» is a current-setup fact. Scored, it competes with the objective the
  // client actually described — and on the real UAT text it did.
  eq(X.classifyObjective('Отдельного CFO нет. Регулярно возникают кассовые разрывы и нужен прогноз движения денежных средств.'),
    'cash_flow', 'the negated CFO mention pulled the objective away');
  eq(X.classifyObjective('У нас нет CFO.'), null, 'a lone negated setup fact produced an objective');
});

check('ambiguity fails closed', () => {
  const ambiguous = [
    'Нужно разобраться с маржинальностью и с кассовыми разрывами.',   // profitability vs cash_flow
    'Думаем про кредит и про новый инвестиционный проект.',           // financing vs investment
    'Хотим навести порядок в отчётности и посчитать себестоимость.'   // fin_management vs profitability
  ];
  for (const t of ambiguous) { eq(X.classifyObjective(t), null, JSON.stringify(t) + ' resolved despite conflict'); }
});

check('a single incidental keyword in a long message does not classify', () => {
  const long = 'Мы работаем давно, команда небольшая, много разных задач по компании, ' +
    'хотелось бы обсудить общее состояние дел и понять, с чего начать, потому что вопросов ' +
    'накопилось много и они очень разные, включая банк.';
  eq(X.classifyObjective(long), null, 'one incidental keyword classified a long vague message');
});

check('the objective is always one of the approved eight, or nothing', () => {
  for (const t of [UAT, 'кассовые разрывы', 'нужен кредит', 'ничего конкретного']) {
    const id = X.classifyObjective(t);
    if (id === null) { continue; }
    assert(B.OBJECTIVE_IDS.indexOf(id) !== -1, 'produced an objective outside the taxonomy: ' + id);
    assert(id !== 'independent_view' && id !== 'other', 'inferred a non-inferable objective: ' + id);
  }
});

// ---------------------------------------------------------------- the confirmation invariant

check('every extracted value is ai_inferred and unconfirmed, however rich', () => {
  const f = X.normalise(X.extractDeterministic(UAT));
  const draft = X.toDraftFields(f, '2026-08-30T00:00:00.000Z');
  const names = Object.keys(draft);
  assert(names.length >= 4, 'the richer extraction produced fewer draft fields than expected');
  for (const n of names) {
    eq(draft[n].source, 'ai_inferred', n + ' source');
    eq(draft[n].confirmed, false, n + ' confirmed');
  }
});

check('ai_inferred still never smart-skips — including the new turnover_band', () => {
  const D = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'draft-contract.js'));
  const f = X.normalise(X.extractDeterministic(UAT));
  const draft = X.toDraftFields(f, '2026-08-30T00:00:00.000Z');
  for (const n of Object.keys(draft)) {
    eq(D.canSkip(draft[n], n), false, n + ' would smart-skip');
    eq(D.canSkip(Object.assign({}, draft[n], { confirmed: true }), n), false, n + ' skips with a forged confirmed flag');
  }
});

check('a richer extraction cannot promote itself — only what was SHOWN is promoted', () => {
  const f = X.normalise(X.extractDeterministic(UAT));
  // business_activity is extracted but is NOT one of the five fields the approved confirmation
  // screen renders, so «Всё верно» must not promote it.
  assert(f.fields.business_activity, 'business_activity was not extracted');
  const shownKeys = Object.keys(B.TG_COPY.TG_CONFIRM_CONTEXT.labels);
  assert(shownKeys.indexOf('business_activity') === -1, 'this test is stale: the screen now shows business_activity');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
