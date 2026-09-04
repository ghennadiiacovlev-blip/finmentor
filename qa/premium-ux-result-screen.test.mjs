#!/usr/bin/env node
// FINMENTOR — C3.4: the customer result screen, driven through the REAL client.
//
//   node qa/premium-ux-result-screen.test.mjs
//
// Offline. Boots app-premium/app.js, net.js and content.js against a stubbed Gateway and asserts
// on the screen the client actually renders. SIMULATED evidence.
//
// WHAT IS HELD.
//   1. A committed session whose bootstrap carries a CLIENT_READY result renders the RESULT — in
//      the client's language, from the server's own labels — and nothing else: no token, no raw
//      analysis, no internal status, no draft.
//   2. A committed session with no result (PENDING) renders the approved success screen with the
//      pending note, and never a partial analysis.
//   3. A malformed or over-wide result is reduced or refused by net.js before any screen sees it.
//   4. CYCLE_UNRESOLVED and a retryable store outage each get their own honest bootstrap-failure
//      copy; everything else keeps the approved generic copy.
//   5. The result screen is terminal: one action, and it is leaving.
//   6. The executive presentation: title «Результат анализа», the score as «47 / 100» in the hero,
//      the zone wording once, the plan as fixed stages («Этап 1 · Дни 1–7»), and the no-score copy
//      («Оценка не рассчитана», disclaimer variant B) when the server sends no number.
//      qa/premium-ux-result-render.test.mjs holds the full golden render matrix.

import { boot, byClass, text, all, OK_BOOTSTRAP } from './lib/miniapp-harness.mjs';

let pass = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const GATEWAY = 'finmentor-miniapp-gateway';

const RESULT_RU = {
  locale: 'ru',
  labels: { product: 'Финансовый рентген бизнеса', condition: 'Финансовое состояние', score: 'Оценка', zone: 'Зона риска', maturity: 'Зрелость финансового управления', risks: 'Ключевые риски', priorities: 'Приоритеты управления', plan: 'План финансовых действий на 30 дней', tomorrow: 'Следующее действие', next: 'Рекомендация FINMENTOR' },
  score: 47, zone: 'ORANGE', zone_label: 'Оранжевая зона',
  maturity: { score_1_to_5: 2, label: 'Реактивное управление', rationale: 'Нет P&L.' },
  summary: 'Бизнес имеет кассовые разрывы.',
  key_risks: [{ title: 'Кассовые разрывы', category: 'cash', evidence: 'из анкеты', potential_impact: 'x', priority: 'HIGH' }],
  management_priorities: ['Платёжный календарь', 'Управленческий P&L'],
  plan_30_days: { days_1_7: [{ action: 'Собрать остатки', owner_role: 'Собственник', expected_output: 'Таблица остатков', control_or_kpi: 'ежедневно', priority: 'HIGH' }], days_8_14: [], days_15_21: [], days_22_30: [{ action: 'Утвердить бюджет', owner_role: 'CFO', expected_output: 'Бюджет', control_or_kpi: 'ежемесячно', priority: 'MEDIUM' }] },
  tomorrow_actions: ['Назначить ответственного'],
  recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', label: 'Финансовый health-check', rationale: 'Нужна полная диагностика.' }
};
const RESULT_RO = Object.assign({}, RESULT_RU, {
  locale: 'ro',
  labels: { product: 'Test de sănătate financiară FINMENTOR', condition: 'Starea financiară', score: 'Scor', zone: 'Zona de risc', maturity: 'Maturitatea managementului financiar', risks: 'Riscuri-cheie', priorities: 'Priorități de management', plan: 'Plan de acțiune financiară pentru 30 de zile', tomorrow: 'Următoarea acțiune', next: 'Recomandarea FINMENTOR' },
  zone_label: 'Zonă portocalie', summary: 'Afacerea are decalaje de numerar.',
  maturity: { score_1_to_5: 2, label: 'Control reactiv', rationale: 'Nu există P&L managerial.' },
  key_risks: [{ title: 'Decalaje de numerar', category: 'cash', evidence: 'din chestionar', potential_impact: 'x', priority: 'HIGH' }],
  management_priorities: ['Calendar de plăți', 'P&L managerial'],
  plan_30_days: { days_1_7: [{ action: 'Colectați soldurile', owner_role: 'Proprietar', expected_output: 'Tabel de solduri', control_or_kpi: 'zilnic', priority: 'HIGH' }], days_8_14: [], days_15_21: [], days_22_30: [] },
  tomorrow_actions: ['Desemnați un responsabil'],
  recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', label: 'Diagnostic financiar complet', rationale: 'Este necesară o diagnoză completă.' }
});

// Things the server never publishes and the client must never print, whatever it is handed.
const NEVER = ['review_token', 'analysis_json', 'AI_DRAFT', 'ANALYSIS_FAILED', 'request_id', 'validation_errors', 'fabrication_flags', 'owner_note', 'ai_user_prompt', 'CLIENT_READY'];

async function bootWith(bootstrapBody, languageCode) {
  const h = boot({
    languageCode: languageCode || 'ru',
    responder: ({ url }) => {
      if (url.indexOf(GATEWAY) !== -1) { return { status: 200, body: bootstrapBody }; }
      return { status: 200, body: { ok: true } };
    }
  });
  await h.settle();
  await h.settle();
  return h;
}
const committed = (extra) => Object.assign({}, OK_BOOTSTRAP, { state: 'submitted', resumed: true, draft: null }, extra || {});
const screenText = (h) => text(h.main);
const buttons = (h) => byClass(h.main, 'btn');
// The exact text of one node — the pending note on the success screen also contains the words
// «Результат анализа», so absence of the result TITLE is an exact-node question, not a substring one.
const nodeText = (h, s) => all(h.main).some((n) => n.textContent === s);
const count = (t, s) => t.split(s).length - 1;

console.log('\nFINMENTOR — C3.4 customer result screen (executed through the real client)\n');

await check('RESULT_RU — a committed session with a CLIENT_READY result renders the RU result, from the server labels', async () => {
  const h = await bootWith(committed({ result: RESULT_RU, result_state: 'CLIENT_READY' }));
  eq(h.state(), 'APP_RESULT', 'state');
  const t = screenText(h);
  for (const s of ['Финансовый рентген бизнеса', 'Результат анализа', '/ 100', 'Оранжевая зона', 'Финансовое состояние:', 'Зрелость финансового управления:', '2/5', 'Резюме', 'Бизнес имеет кассовые разрывы.', '2 из 5 — Реактивное управление', 'Ключевые риски', 'Кассовые разрывы', 'высокий приоритет', 'из анкеты', 'Приоритеты управления', 'Платёжный календарь', 'План финансовых действий на 30 дней', 'Этап 1 · Дни 1–7', 'Собрать остатки', 'Таблица остатков', 'Этап 4 · Дни 22–30', 'Следующее действие', 'Назначить ответственного', 'Рекомендация FINMENTOR', 'Финансовый health-check', 'не аудит']) {
    assert(t.indexOf(s) !== -1, 'missing on screen: ' + s);
  }
  assert(t.indexOf('Дни 8–14') === -1, 'an empty week was rendered');
  assert(t.indexOf('Дни 15–21') === -1, 'an empty week was rendered');
  assert(t.indexOf('days_') === -1, 'a plan storage key reached the screen');
  eq(byClass(h.main, 'xr-score-num')[0].textContent, '47', 'the hero score numeral');
  eq(count(t, 'Оранжевая зона'), 1, 'the zone wording must appear exactly once');
  assert(t.indexOf('Оценка не рассчитана') === -1 && t.indexOf('Без оценки') === -1, 'a no-score wording appeared with a score');
  assert(t.indexOf('Результат готов') === -1 && t.indexOf('Кратко') === -1, 'retired result copy is still on screen');
});

await check('RESULT_RO — the same session in RO renders the RO product name and RO shell strings, never the retired name', async () => {
  const h = await bootWith(committed({ locale: 'ro', result: RESULT_RO, result_state: 'CLIENT_READY' }), 'ro');
  eq(h.state(), 'APP_RESULT', 'state');
  const t = screenText(h);
  for (const s of ['Test de sănătate financiară FINMENTOR', 'Rezultatul analizei', '/ 100', 'Zonă portocalie', 'Starea financiară:', 'Rezumat', '2 din 5 — Control reactiv', 'Etapa 1 · Zilele 1–7', 'prioritate ridicată', 'Diagnostic financiar complet', 'Înapoi în Telegram', 'Nu este un audit']) {
    assert(t.indexOf(s) !== -1, 'missing on screen: ' + s);
  }
  assert(t.indexOf('Radiografia Financiară') === -1, 'the retired RO product name appeared');
  assert(!/[А-Яа-яЁё]/.test(t.replace(/P&L/g, '')), 'Russian text on the RO result screen: ' + t.slice(0, 200));
});

await check('RESULT_NO_SCORE — a result without a number says so once, prints no zone wording, and carries the no-score disclaimer', async () => {
  const h = await bootWith(committed({ result: Object.assign({}, RESULT_RU, { score: null, zone: 'UNKNOWN', zone_label: 'Без оценки' }), result_state: 'CLIENT_READY' }));
  eq(h.state(), 'APP_RESULT', 'state');
  const t = screenText(h);
  eq(count(t, 'Оценка не рассчитана'), 1, 'the no-score line must appear exactly once');
  assert(t.indexOf('Недостаточно исходных данных для количественной оценки.') !== -1, 'the no-score note is missing');
  assert(t.indexOf('Без оценки') === -1, 'the zone wording was printed without a score');
  assert(t.indexOf('/ 100') === -1 && t.indexOf('из 100') === -1, 'a score scale was printed without a score');
  assert(t.indexOf('Предварительный вывод сформирован на основании доступной информации.') !== -1, 'disclaimer variant B is missing');
  assert(t.indexOf('детали консультант уточнит') === -1, 'disclaimer variant A appeared without a score');
  assert(t.indexOf('не аудит') !== -1, 'the disclaimer lost «не аудит»');
  eq(byClass(h.main, 'xr-score-num').length, 0, 'a score numeral rendered without a score');
  assert(t.indexOf('2/5') !== -1, 'the maturity metric is missing on the no-score path');
});

await check('RESULT_TERMINAL — one action, it leaves, and no back affordance', async () => {
  const h = await bootWith(committed({ result: RESULT_RU, result_state: 'CLIENT_READY' }));
  const b = buttons(h);
  eq(b.length, 1, 'button count');
  eq(b[0].textContent, 'Вернуться в Telegram', 'the only action is not leaving');
  eq(h.back.hidden, true, 'the back button is visible on a terminal screen');
  b[0].fire('click');
  eq(h.closed.count, 1, 'the close did not reach Telegram exactly once');
});

await check('RESULT_CURATED — nothing internal is printed even if the server (or a proxy) handed it over', async () => {
  const wide = Object.assign({}, RESULT_RU, { review_token: 'a'.repeat(64), analysis_json: '{"x":1}', request_id: 'req-1', validation_errors: 'z', confidence: 'LOW', fabrication_flags: '12%', owner_note: 'secret', internal: { ai_user_prompt: 'prompt' } });
  const h = await bootWith(committed({ result: wide, result_state: 'CLIENT_READY', review_token: 'b'.repeat(64), lead_id: 'FIN-1' }));
  eq(h.state(), 'APP_RESULT', 'state');
  const t = screenText(h);
  for (const k of NEVER) { assert(t.indexOf(k) === -1, 'printed ' + k); }
  for (const v of ['a'.repeat(64), 'b'.repeat(64), 'req-1', 'secret', 'prompt', 'LOW', '12%', 'FIN-1']) { assert(t.indexOf(v) === -1, 'printed the value ' + v); }
  // and net.js kept only the curated keys
  const kept = Object.keys(h.win.FM_NET.clientResult()).sort().join(',');
  eq(kept, 'key_risks,labels,locale,management_priorities,maturity,plan_30_days,recommended_next_step,score,summary,tomorrow_actions,zone,zone_label', 'net.js kept a non-curated key');
});

await check('RESULT_PENDING — a committed session without a result shows the approved success screen and the pending note, never a partial analysis', async () => {
  const h = await bootWith(committed({ result: null, result_state: 'PENDING' }));
  eq(h.state(), 'APP_SUCCESS', 'state');
  const t = screenText(h);
  assert(t.indexOf('Результат анализа появится здесь после проверки консультантом FINMENTOR.') !== -1, 'the pending note is missing');
  assert(!nodeText(h, 'Результат анализа'), 'the result title appeared without a result');
  eq(byClass(h.main, 'xr-hero').length, 0, 'the result hero rendered without a result');
  eq(h.win.FM_NET.resultState(), 'PENDING', 'result state');
});

await check('RESULT_SHAPE — a malformed result (no labels, an array, a string) is refused by net.js and the success screen shows', async () => {
  for (const bad of [{ score: 47 }, [1, 2], 'CLIENT_READY', 42, { labels: 'x', score: 1 }]) {
    const h = await bootWith(committed({ result: bad, result_state: 'CLIENT_READY' }));
    eq(h.state(), 'APP_SUCCESS', 'state for ' + JSON.stringify(bad));
    eq(h.win.FM_NET.clientResult(), null, 'a malformed result was kept for ' + JSON.stringify(bad));
  }
});

await check('RESULT_DRAFT_ONLY — a DRAFT session never renders a result even if one is attached', async () => {
  const h = await bootWith(Object.assign({}, OK_BOOTSTRAP, { result: RESULT_RU, result_state: 'CLIENT_READY' }));
  assert(h.state() !== 'APP_RESULT', 'a draft session rendered the result screen');
  assert(!nodeText(h, 'Результат анализа'), 'the result title appeared on a draft');
  eq(byClass(h.main, 'xr-hero').length, 0, 'the result hero rendered on a draft');
});

await check('BOOT_CYCLE_UNRESOLVED — the Gateway refusal gets its own copy: return to the chat, nothing sent, no retry', async () => {
  for (const [lang, title, line] of [['ru', 'Откройте форму из чата', 'Вернитесь в чат с ботом'], ['ro', 'Deschideți formularul din chat', 'Reveniți în chatul cu botul']]) {
    const h = await bootWith({ ok: false, error_code: 'CYCLE_UNRESOLVED', retryable: false }, lang);
    eq(h.state(), 'APP_BOOT_FAILURE', lang + ' state');
    const t = screenText(h);
    assert(t.indexOf(title) !== -1 && t.indexOf(line) !== -1, lang + ': cycle copy missing: ' + t.slice(0, 160));
    eq(buttons(h).length, 1, lang + ': a retry was offered');
    assert(h.win.FM_NET.bootstrapCount() === 1, lang + ': the bootstrap was retried');
  }
});

await check('BOOT_OUTAGE — a retryable store outage says temporary, nothing sent, reopen later; a non-retryable refusal keeps the approved generic copy', async () => {
  for (const code of ['APPLICATION_STORE_UNAVAILABLE', 'REPLAY_STORE_UNAVAILABLE']) {
    const h = await bootWith({ ok: false, error_code: code, retryable: true });
    eq(h.state(), 'APP_BOOT_FAILURE', code + ' state');
    assert(screenText(h).indexOf('Сервис временно недоступен') !== -1, code + ': outage copy missing');
    eq(buttons(h).length, 1, code + ': a retry was offered');
  }
  const generic = await bootWith({ ok: false, error_code: 'TG_INITDATA_INVALID', retryable: false });
  assert(screenText(generic).indexOf('Не удалось открыть форму') !== -1, 'the generic copy was replaced');
  const ro = await bootWith({ ok: false, error_code: 'APPLICATION_STORE_UNAVAILABLE', retryable: true }, 'ro');
  assert(screenText(ro).indexOf('Serviciul este temporar indisponibil') !== -1, 'RO outage copy missing');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('\nASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
