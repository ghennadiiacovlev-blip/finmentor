#!/usr/bin/env node
// FINMENTOR — C3.4: the customer result screen, GOLDEN RENDER matrix.
//
//   node qa/premium-ux-result-render.test.mjs
//
// Offline. Boots the real app-premium/app.js, net.js and content.js (qa/lib/miniapp-harness.mjs)
// against a stubbed Gateway whose bootstrap carries a CLIENT_READY result, and holds the
// PRESENTATION of that result: what the hero prints, in which order the sections come, how the
// 30-day plan is staged, which disclaimer variant is chosen, and what must never appear.
// qa/premium-ux-result-screen.test.mjs holds the behavioural contract (state, curation, terminal
// action); this gate holds the deliverable's shape. SIMULATED evidence.
//
// WHAT IS HELD.
//   1. RU with a score: kicker = server product label, title «Результат анализа», hero «47 / 100»,
//      the zone wording exactly once, maturity «2/5» in the hero and «2 из 5 — label» in its
//      section, sections in the fixed order, disclaimer variant A.
//   2. RU without a score: «Оценка не рассчитана» exactly once with its note; no «Без оценки», no
//      scale, no zone line; disclaimer variant B; «не аудит» kept.
//   3. RO with a score and RO without a score: the same, in RO, with no Cyrillic on screen.
//   4. A 600-character summary renders whole.
//   5. Four stages with more than three actions each: three per stage, fixed stage labels, no
//      days_* key on screen.
//   6. Missing optional sections leave no trace: no kicker, no empty node.
//   7. Forbidden tokens never appear, even when handed over as values.
//   8. Exactly one .btn, and the back affordance is hidden.

import { boot, byClass, text, all, OK_BOOTSTRAP } from './lib/miniapp-harness.mjs';
import { RESULT_RU_SCORE, RESULT_RU_NOSCORE, RESULT_RO_SCORE, RESULT_RO_NOSCORE, LABELS_RU } from './fixtures/client-result-fixtures.mjs';

let pass = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const GATEWAY = 'finmentor-miniapp-gateway';

async function render(result, languageCode) {
  const body = Object.assign({}, OK_BOOTSTRAP, { state: 'submitted', resumed: true, draft: null, locale: result.locale, result, result_state: 'CLIENT_READY' });
  const h = boot({
    languageCode: languageCode || result.locale || 'ru',
    responder: ({ url }) => (url.indexOf(GATEWAY) !== -1 ? { status: 200, body } : { status: 200, body: { ok: true } })
  });
  await h.settle();
  await h.settle();
  eq(h.state(), 'APP_RESULT', 'state');
  return h;
}
const screenText = (h) => text(h.main);
const count = (t, s) => t.split(s).length - 1;
const nodes = (h, cls) => byClass(h.main, cls);
const nodeTexts = (h, cls) => nodes(h, cls).map((n) => n.textContent);
const kickers = (h) => nodeTexts(h, 'kicker');
const cyrillic = (t) => /[А-Яа-яЁё]/.test(t.replace(/P&L/g, ''));

// Things that must never be on a customer's screen — system words and storage keys.
const FORBIDDEN = ['CLIENT_READY', 'AI_DRAFT', 'zone_label', 'summary', 'confidence', 'days_', 'review_token', 'score_1_to_5', 'expected_output', 'owner_role', 'control_or_kpi', 'potential_impact', 'UNKNOWN', 'ORANGE', 'FINANCIAL_HEALTH_CHECK'];

const SECTION_ORDER_RU = ['Резюме', LABELS_RU.maturity, LABELS_RU.risks, LABELS_RU.priorities, LABELS_RU.plan, LABELS_RU.tomorrow, LABELS_RU.next];

console.log('\nFINMENTOR — C3.4 customer result screen: golden render matrix (executed through the real client)\n');

await check('RU_SCORE — kicker, title, hero «47 / 100», zone once, maturity in the hero, sections in order, disclaimer A', async () => {
  const h = await render(RESULT_RU_SCORE);
  const t = screenText(h);
  const ks = kickers(h);
  eq(ks[0], 'Финансовый рентген бизнеса', 'the first kicker is the server product label');
  assert(nodes(h, 'xr-heading').length === 1 && nodes(h, 'xr-heading')[0].textContent === 'Результат анализа', 'the title');
  eq(nodes(h, 'xr-hero').length, 1, 'one hero');
  eq(nodeTexts(h, 'xr-score-num')[0], '47', 'the score numeral');
  eq(nodeTexts(h, 'xr-score-of')[0], '/ 100', 'the score scale');
  eq(nodes(h, 'xr-score-none').length, 0, 'no-score line rendered with a score');
  eq(count(t, 'Оранжевая зона'), 1, 'the zone wording appears exactly once');
  const metrics = nodes(h, 'xr-metric').map((m) => m.children.map((c) => c.textContent).join(' '));
  eq(metrics.join(' | '), 'Финансовое состояние: Оранжевая зона | Зрелость финансового управления: 2/5', 'the hero metric lines');
  eq(ks.slice(1).join(' | '), SECTION_ORDER_RU.join(' | '), 'the section order');
  assert(t.indexOf('2 из 5 — Реактивное управление') !== -1, 'the maturity section line');
  assert(t.indexOf(RESULT_RU_SCORE.maturity.rationale) !== -1, 'the maturity rationale');
  assert(t.indexOf(RESULT_RU_SCORE.summary) !== -1, 'the summary paragraph');
  eq(nodes(h, 'xr-risks').length, 1, 'one risks section');
  eq(byClass(nodes(h, 'xr-risks')[0], 'xr-item').length, 5, 'five risks');
  eq(nodeTexts(h, 'xr-tag').join(','), 'высокий приоритет,высокий приоритет,средний приоритет,средний приоритет,низкий приоритет', 'priority tags');
  assert(nodeTexts(h, 'xr-sub').indexOf(RESULT_RU_SCORE.key_risks[0].evidence) !== -1, 'evidence on its own line');
  eq(byClass(nodes(h, 'xr-priorities')[0], 'xr-item').length, 3, 'three priorities');
  eq(byClass(nodes(h, 'xr-tomorrow')[0], 'xr-item').length, 3, 'three next-day actions');
  eq(nodeTexts(h, 'xr-next').length, 1, 'one recommendation section');
  assert(t.indexOf('Финансовый health-check') !== -1 && t.indexOf(RESULT_RU_SCORE.recommended_next_step.rationale) !== -1, 'the recommendation label and rationale');
  eq(nodeTexts(h, 'xr-disclaimer')[0], 'Предварительный анализ на основе ваших ответов. Это не аудит и не финансовая отчётность; детали консультант уточнит в разговоре.', 'disclaimer variant A');
  assert(t.indexOf('Предварительный вывод сформирован') === -1, 'disclaimer variant B leaked onto the scored screen');
  assert(t.indexOf('Оценка не рассчитана') === -1 && t.indexOf('Без оценки') === -1, 'no-score wording on a scored screen');
});

await check('RU_NOSCORE — «Оценка не рассчитана» exactly once with its note; no «Без оценки», no scale, no zone line; disclaimer B', async () => {
  const h = await render(RESULT_RU_NOSCORE);
  const t = screenText(h);
  eq(count(t, 'Оценка не рассчитана'), 1, 'the no-score line appears exactly once');
  eq(nodeTexts(h, 'xr-score-none')[0], 'Оценка не рассчитана', 'the no-score node');
  eq(nodeTexts(h, 'xr-note')[0], 'Недостаточно исходных данных для количественной оценки.', 'the no-score note');
  assert(t.indexOf('Без оценки') === -1, '«Без оценки» was printed');
  assert(t.indexOf('/ 100') === -1 && t.indexOf('из 100') === -1, 'a scale was printed without a score');
  eq(nodes(h, 'xr-score-num').length, 0, 'a numeral rendered without a score');
  assert(t.indexOf('Финансовое состояние') === -1, 'the zone line was printed without a score');
  const metrics = nodes(h, 'xr-metric').map((m) => m.children.map((c) => c.textContent).join(' '));
  eq(metrics.join(' | '), 'Зрелость финансового управления: 2/5', 'only the maturity metric remains in the hero');
  eq(nodeTexts(h, 'xr-disclaimer')[0], 'Предварительный вывод сформирован на основании доступной информации. Для точной финансовой оценки потребуется уточнение исходных данных. Это не аудит и не финансовая отчётность.', 'disclaimer variant B');
  assert(t.indexOf('детали консультант уточнит') === -1, 'disclaimer variant A leaked onto the unscored screen');
  assert(t.indexOf('не аудит') !== -1, '«не аудит» is missing');
  eq(kickers(h).slice(1).join(' | '), SECTION_ORDER_RU.join(' | '), 'the section order is unchanged without a score');
});

await check('RO_SCORE — the RO shell strings and the RO server labels; nothing Cyrillic', async () => {
  const h = await render(RESULT_RO_SCORE, 'ro');
  const t = screenText(h);
  eq(kickers(h)[0], 'Test de sănătate financiară FINMENTOR', 'the RO product label');
  eq(nodeTexts(h, 'xr-heading')[0], 'Rezultatul analizei', 'the RO title');
  eq(nodeTexts(h, 'xr-score-num')[0], '47', 'the score numeral');
  eq(nodeTexts(h, 'xr-score-of')[0], '/ 100', 'the score scale');
  eq(count(t, 'Zonă portocalie'), 1, 'the RO zone wording appears exactly once');
  const metrics = nodes(h, 'xr-metric').map((m) => m.children.map((c) => c.textContent).join(' '));
  eq(metrics.join(' | '), 'Starea financiară: Zonă portocalie | Maturitatea managementului financiar: 2/5', 'the RO hero metric lines');
  eq(kickers(h).slice(1)[0], 'Rezumat', 'the RO summary kicker');
  assert(t.indexOf('2 din 5 — Control reactiv') !== -1, 'the RO maturity section line');
  eq(nodeTexts(h, 'xr-stage-label').join(' | '), 'Etapa 1 · Zilele 1–7 | Etapa 2 · Zilele 8–14 | Etapa 3 · Zilele 15–21 | Etapa 4 · Zilele 22–30', 'the RO stage labels');
  eq(nodeTexts(h, 'xr-tag')[0], 'prioritate ridicată', 'the RO priority tag');
  assert(t.indexOf('Diagnostic financiar complet') !== -1, 'the RO recommendation');
  assert(t.indexOf('Nu este un audit') !== -1, 'the RO disclaimer');
  eq(nodeTexts(h, 'btn')[0], 'Înapoi în Telegram', 'the RO action');
  assert(!cyrillic(t), 'Cyrillic on the RO screen: ' + t.slice(0, 200));
  assert(t.indexOf('Radiografia Financiară') === -1, 'the retired RO product name');
});

await check('RO_NOSCORE — «Scorul nu a fost calculat» once, no «Fără scor», RO disclaimer B; nothing Cyrillic', async () => {
  const h = await render(RESULT_RO_NOSCORE, 'ro');
  const t = screenText(h);
  eq(count(t, 'Scorul nu a fost calculat'), 1, 'the RO no-score line appears exactly once');
  eq(nodeTexts(h, 'xr-note')[0], 'Date de intrare insuficiente pentru o evaluare cantitativă.', 'the RO no-score note');
  assert(t.indexOf('Fără scor') === -1, '«Fără scor» was printed');
  assert(t.indexOf('/ 100') === -1 && t.indexOf('din 100') === -1, 'a scale was printed without a score');
  assert(t.indexOf('Starea financiară') === -1, 'the zone line was printed without a score');
  eq(nodeTexts(h, 'xr-disclaimer')[0], 'Concluzia preliminară a fost formulată pe baza informațiilor disponibile. Pentru o evaluare financiară exactă va fi necesară clarificarea datelor de intrare. Nu este un audit și nici o situație financiară.', 'the RO disclaimer variant B');
  assert(t.indexOf('detaliile vor fi clarificate') === -1, 'the RO disclaimer variant A leaked');
  assert(!cyrillic(t), 'Cyrillic on the RO screen: ' + t.slice(0, 200));
});

await check('LONG_SUMMARY — a 600-character summary renders whole, in one paragraph, untruncated', async () => {
  const sentence = 'Управленческая отчётность отсутствует, а платежи планируются по остатку на счёте. ';
  let long = '';
  while (long.length < 600) { long += sentence; }
  long = long.slice(0, 600);
  eq(long.length, 600, 'fixture length');
  const h = await render(Object.assign({}, RESULT_RU_SCORE, { summary: long }));
  const paras = nodeTexts(h, 'xr-para');
  eq(paras.length, 1, 'one summary paragraph');
  eq(paras[0], long, 'the summary text');
  eq(paras[0].length, 600, 'the summary length');
});

await check('PLAN_STAGES — four stages of four actions render three each under fixed stage labels; no days_* key', async () => {
  const many = (n) => Array.from({ length: 4 }, (_, i) => ({ action: 'Действие ' + n + '.' + (i + 1), owner_role: 'Собственник', expected_output: 'Результат ' + n + '.' + (i + 1), control_or_kpi: 'еженедельно', priority: 'HIGH' }));
  const h = await render(Object.assign({}, RESULT_RU_SCORE, { plan_30_days: { days_1_7: many(1), days_8_14: many(2), days_15_21: many(3), days_22_30: many(4) } }));
  const t = screenText(h);
  const stages = nodes(h, 'xr-stage');
  eq(stages.length, 4, 'four stages');
  eq(nodeTexts(h, 'xr-stage-label').join(' | '), 'Этап 1 · Дни 1–7 | Этап 2 · Дни 8–14 | Этап 3 · Дни 15–21 | Этап 4 · Дни 22–30', 'the stage labels');
  stages.forEach((st, i) => {
    const items = byClass(st, 'xr-item');
    eq(items.length, 3, 'stage ' + (i + 1) + ' action count');
    eq(byClass(st, 'xr-n').map((n) => n.textContent).join(','), '1,2,3', 'stage ' + (i + 1) + ' numbering restarts');
    assert(text(st).indexOf('Действие ' + (i + 1) + '.4') === -1, 'stage ' + (i + 1) + ' rendered a fourth action');
    assert(text(st).indexOf('Результат ' + (i + 1) + '.1') !== -1, 'stage ' + (i + 1) + ' lost the expected output line');
  });
  assert(t.indexOf('days_') === -1, 'a days_* key reached the screen');
  eq(nodes(h, 'xr-plan').length, 1, 'one plan section');
});

await check('PLAN_GAPS — an empty middle stage is skipped and the later stage keeps its own number; a wholly empty plan has no section', async () => {
  const one = [{ action: 'Собрать остатки', owner_role: 'Собственник', expected_output: 'Таблица остатков', control_or_kpi: 'ежедневно', priority: 'HIGH' }];
  const h = await render(Object.assign({}, RESULT_RU_SCORE, { plan_30_days: { days_1_7: one, days_8_14: [], days_15_21: [], days_22_30: one } }));
  eq(nodeTexts(h, 'xr-stage-label').join(' | '), 'Этап 1 · Дни 1–7 | Этап 4 · Дни 22–30', 'the surviving stage labels');
  const empty = await render(Object.assign({}, RESULT_RU_SCORE, { plan_30_days: { days_1_7: [], days_8_14: [], days_15_21: [], days_22_30: [] } }));
  eq(nodes(empty, 'xr-plan').length, 0, 'a plan section rendered for an empty plan');
  assert(kickers(empty).indexOf(LABELS_RU.plan) === -1, 'the plan kicker rendered for an empty plan');
});

await check('OPTIONAL_SECTIONS — no tomorrow, no recommendation, no maturity: the sections are absent and no kicker is empty', async () => {
  const r = Object.assign({}, RESULT_RU_SCORE);
  delete r.tomorrow_actions; delete r.recommended_next_step; delete r.maturity;
  const h = await render(r);
  const ks = kickers(h);
  eq(ks.join(' | '), [LABELS_RU.product, 'Резюме', LABELS_RU.risks, LABELS_RU.priorities, LABELS_RU.plan].join(' | '), 'the kickers that remain');
  assert(ks.every((k) => k && k.trim()), 'an empty kicker rendered');
  eq(nodes(h, 'xr-tomorrow').length + nodes(h, 'xr-next').length + nodes(h, 'xr-maturity').length, 0, 'an absent section rendered');
  const metrics = nodes(h, 'xr-metric').map((m) => m.children.map((c) => c.textContent).join(' '));
  eq(metrics.join(' | '), 'Финансовое состояние: Оранжевая зона', 'the maturity metric rendered without maturity');
  assert(!all(h.main).some((n) => n.className && /xr-|kicker|quiet|xr-para/.test(n.className) && n.textContent === '' && n.children.length === 0), 'an empty text node rendered');
  // Labels the server did not send leave the content unlabelled rather than printing a blank.
  const noLabels = await render(Object.assign({}, RESULT_RU_SCORE, { labels: { product: 'Финансовый рентген бизнеса' } }));
  assert(kickers(noLabels).every((k) => k && k.trim()), 'a missing server label rendered as an empty kicker');
  eq(nodes(noLabels, 'xr-risks').length, 1, 'the risks still render without a label');
});

await check('FORBIDDEN — system words and storage keys never appear, even when handed over as values', async () => {
  const wide = Object.assign({}, RESULT_RU_SCORE, { review_token: 'a'.repeat(64), confidence: 'LOW', analysis_json: '{"x":1}', internal: { ai_user_prompt: 'prompt' } });
  for (const r of [wide, RESULT_RU_NOSCORE, RESULT_RO_SCORE, RESULT_RO_NOSCORE]) {
    const h = await render(r, r.locale);
    const t = screenText(h);
    for (const k of FORBIDDEN) { assert(t.indexOf(k) === -1, 'printed ' + k + ' for ' + r.locale + (r.score === null ? '-noscore' : '-score')); }
    assert(t.indexOf('a'.repeat(64)) === -1 && t.indexOf('prompt') === -1 && t.indexOf('LOW') === -1, 'printed an internal value');
  }
});

await check('TERMINAL — exactly one .btn, it is the return action, and the back affordance is hidden', async () => {
  for (const r of [RESULT_RU_SCORE, RESULT_RU_NOSCORE, RESULT_RO_SCORE, RESULT_RO_NOSCORE]) {
    const h = await render(r, r.locale);
    const b = nodes(h, 'btn');
    eq(b.length, 1, 'button count for ' + r.locale);
    eq(b[0].textContent, r.locale === 'ro' ? 'Înapoi în Telegram' : 'Вернуться в Telegram', 'the action for ' + r.locale);
    eq(h.back.hidden, true, 'the back button is visible for ' + r.locale);
    // The action is the last thing on the screen, after the disclaimer.
    const kids = h.main.children[0].children;
    assert(kids[kids.length - 1].className === 'actions', 'the action is not the last block');
    assert(kids.some((k) => k.className === 'xr-disclaimer'), 'the disclaimer is missing for ' + r.locale);
    b[0].fire('click');
    eq(h.closed.count, 1, 'the close did not reach Telegram exactly once');
  }
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('\nASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed, 0 failed');
