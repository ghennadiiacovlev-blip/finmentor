#!/usr/bin/env node
// FINMENTOR — context extraction and TG_CONFIRM_CONTEXT (the thirteen hard rules).
//
//   node qa/premium-ux-extraction.test.mjs
//
// Offline. No tenant, no network, no model call.
//
// The rule that carries the most weight here is rule 3: an AI-inferred value NEVER causes a smart
// skip. It is asserted from both ends — that `canSkip` refuses `ai_inferred`, and that nothing in
// the extraction path can produce a field that is anything other than `ai_inferred` and unconfirmed
// until the client explicitly says «Всё верно».

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const X = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'context-extraction.js'));
const D = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'draft-contract.js'));
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const NOW = '2026-08-29T12:00:00.000Z';
const pipeline = (text) => X.normalise(X.extractDeterministic(text));

// Build a draft carrying the extraction, the way the endpoint will.
function draftWith(text) {
  const d = D.emptyDraft('ru');
  const fields = X.toDraftFields(pipeline(text), NOW);
  for (const k of Object.keys(fields)) { d.fields[k] = fields[k]; }
  return d;
}

console.log('Premium UX — context extraction and confirmation');
console.log('');

// ---------------------------------------------------------------- the named scenarios

const GOOD = 'Я собственник, у нас ООО «Ромашка», мы занимаемся оптовой торговлей. ' +
             'Постоянно возникают кассовые разрывы, платежный календарь никто не ведет, ликвидность непредсказуема.';

check('good structured free text yields company, role and objective', () => {
  const r = pipeline(GOOD);
  eq(r.fields.company_name, 'Ромашка', 'company');
  eq(r.fields.role, 'Собственник', 'role');
  eq(r.fields.objective, 'cash_flow', 'objective');
  assert(r.fields.problem_summary && r.fields.problem_summary.length > 20, 'no problem summary');
});

check('partial free text yields only what is actually stated', () => {
  const r = pipeline('Нужно навести порядок в управленческой отчетности и бюджетировании.');
  eq(r.fields.objective, 'financial_management', 'objective');
  eq(r.fields.company_name, undefined, 'company invented');
  eq(r.fields.role, undefined, 'role invented');
});

check('no company mentioned means no company proposed', () => {
  const r = pipeline('У нас постоянные кассовые разрывы и не хватает денег на выплаты.');
  eq(r.fields.company_name, undefined, 'a company name was invented');
  eq(r.fields.objective, 'cash_flow', 'objective');
});

check('no scale is EVER inferred, even when the text describes size', () => {
  for (const t of ['У нас небольшая компания, оборот скромный.',
                   'Мы крупный холдинг с оборотом около 30 миллионов евро.',
                   'Оборот 5 млн евро в год, кассовые разрывы постоянные.']) {
    const r = pipeline(t);
    eq(r.fields.turnover_band, undefined, 'a turnover band was inferred from: ' + t);
  }
  assert(X.EXTRACTABLE.indexOf('turnover_band') === -1, 'turnover_band is extractable at all');
  assert(X.DRAFT_BACKED.indexOf('turnover_band') === -1, 'turnover_band is draft-backed by extraction');
});

check('an AMBIGUOUS objective stays unknown rather than being guessed', () => {
  // Cash-flow vocabulary and profitability vocabulary in equal measure. A tie must not resolve.
  const r = pipeline('Есть и кассовые разрывы, и падает маржинальность, себестоимость растет, ликвидность плохая.');
  eq(r.fields.objective, undefined, 'an ambiguous message produced an objective');
});

check('unsupported objective wording produces no objective', () => {
  for (const t of ['Нужно помочь с наймом персонала и мотивацией команды.',
                   'Хотим сделать редизайн сайта и настроить рекламу.',
                   'Просто хочу поговорить.']) {
    eq(pipeline(t).fields.objective, undefined, 'invented an objective for: ' + t);
  }
});

check('a model proposal outside the taxonomy is REFUSED, not coerced', () => {
  const r = X.normalise({ objective: 'Оптимизация налогов', company_name: 'ООО Тест' });
  eq(r.fields.objective, undefined, 'an off-taxonomy objective survived');
  assert(r.dropped.some((d) => d.indexOf('objective') === 0), 'the refusal was not reported');
  eq(r.fields.company_name, 'ООО Тест', 'a legitimate field was lost');
});

check('independent_view and other are never inferable', () => {
  for (const v of ['independent_view', 'other', 'Нужен независимый взгляд', 'Другая задача']) {
    eq(X.normalise({ objective: v }).fields.objective, undefined, 'inferred ' + v);
  }
  // They remain real options the client can choose.
  assert(B.OBJECTIVE_IDS.indexOf('independent_view') !== -1, 'independent_view left the taxonomy');
  assert(B.OBJECTIVE_IDS.indexOf('other') !== -1, 'other left the taxonomy');
});

check('a proposal may only touch the six supported fields', () => {
  const r = X.normalise({
    company_name: 'ООО Тест', role: 'Собственник', objective: 'cash_flow',
    business_activity: 'оптовая торговля', problem_summary: 'кассовые разрывы',
    turnover_band: '€2–10 млн', contact_value: 'x@example.test', problem: 'что-то',
    diagnosis: 'компания в кризисе', important_context: 'секрет'
  });
  eq(Object.keys(r.fields).sort().join(','), 'business_activity,company_name,objective,problem_summary,role', 'surviving fields');
  for (const forbidden of ['turnover_band', 'contact_value', 'problem', 'diagnosis', 'important_context']) {
    assert(r.dropped.indexOf(forbidden) !== -1, forbidden + ' was dropped silently rather than reported');
  }
});

check('a role stated as a REQUIREMENT is not read as the client\'s role', () => {
  eq(pipeline('Нам нужен финансовый директор на аутсорсе.').fields.role, undefined,
    'a requirement was read as the role');
  eq(pipeline('Я финансовый директор, ищу помощь с отчетностью.').fields.role, 'Финансовый директор', 'first-person role');
});

// ---------------------------------------------------------------- rules 2 and 3

check('everything extraction produces is ai_inferred and unconfirmed', () => {
  const fields = X.toDraftFields(pipeline(GOOD), NOW);
  assert(Object.keys(fields).length > 0, 'nothing was produced to check');
  for (const k of Object.keys(fields)) {
    eq(fields[k].source, 'ai_inferred', k + ' source');
    eq(fields[k].confirmed, false, k + ' confirmed');
  }
});

check('ai_inferred NEVER smart-skips — the rule, from the contract side', () => {
  for (const value of ['Ромашка', 'cash_flow']) {
    eq(D.canSkip({ value: value, source: 'ai_inferred', confirmed: false }, 'company_name'), false, 'unconfirmed');
    // Even a forged `confirmed: true` on an ai_inferred field must not skip.
    eq(D.canSkip({ value: value, source: 'ai_inferred', confirmed: true }, 'company_name'), false, 'forged confirmed');
  }
});

check('ai_inferred NEVER smart-skips — the rule, from the extraction side', () => {
  const d = draftWith(GOOD);
  for (const name of X.DRAFT_BACKED) {
    const f = d.fields[name];
    if (!f || f.value === null) { continue; }
    eq(D.canSkip(f, name), false, name + ' would be skipped on an AI guess');
  }
  // The first question the client is asked is therefore still the first unanswered one.
  const state = D.nextState(d);
  assert(String(state).indexOf('APP_') === 0, 'nextState is not an app state: ' + state);
  eq(state, 'APP_COMPANY', 'extraction moved the client past a question it only guessed at');
});

// ---------------------------------------------------------------- rules 4, 5, 6

check('the confirmation screen renders ONLY non-empty values, and no fake labels', () => {
  const r = pipeline('Нужно навести порядок в управленческой отчетности.');
  const sections = X.shownSections(r, '');
  const keys = sections.map((s) => s.key);
  assert(keys.indexOf('objective') !== -1, 'the objective it did find is missing');
  assert(keys.indexOf('company_name') === -1, 'an empty company rendered a label');
  assert(keys.indexOf('turnover_band') === -1, 'an unasked scale rendered a label');
  for (const s of sections) {
    assert(String(s.value).trim() !== '', 'section ' + s.key + ' has an empty value');
    assert(String(s.value).indexOf('—') === -1, 'an em-dash placeholder reached the screen');
  }
});

check('a completely empty extraction renders NOTHING to confirm', () => {
  const sections = X.shownSections(pipeline(''), '');
  eq(sections.length, 0, 'an empty extraction produced sections');
});

check('«Всё верно» promotes exactly the values that were SHOWN', () => {
  const r = pipeline(GOOD);
  const d = draftWith(GOOD);
  const sections = X.shownSections(r, '');
  const res = X.promoteShown(d, sections, NOW);
  assert(res.ok, 'promotion failed: ' + JSON.stringify(res));
  for (const name of res.promoted) {
    eq(res.draft.fields[name].source, 'user_confirmed', name + ' source after confirmation');
    eq(res.draft.fields[name].confirmed, true, name + ' confirmed after confirmation');
  }
  assert(res.promoted.indexOf('company_name') !== -1, 'a shown value was not promoted');
  assert(res.promoted.indexOf('objective') !== -1, 'a shown objective was not promoted');
});

check('a value that was NOT shown is not promoted by the tap', () => {
  const r = pipeline(GOOD);
  const d = draftWith(GOOD);
  // Simulate a screen that showed only the company — the objective must stay a guess.
  const partial = X.shownSections(r, '').filter((s) => s.key === 'company_name');
  const res = X.promoteShown(d, partial, NOW);
  assert(res.ok, 'promotion failed');
  eq(res.draft.fields.company_name.source, 'user_confirmed', 'shown value');
  eq(res.draft.fields.objective.source, 'ai_inferred', 'an unshown value was promoted by a tap the client never saw');
  eq(res.draft.fields.objective.confirmed, false, 'unshown value confirmed');
});

check('user_confirmed DOES smart-skip — the whole point of asking', () => {
  // The state must be one whose ONLY requirement is a field the confirmation screen shows.
  // APP_COMPANY is not that state: it also requires `business_activity`, which extraction may
  // prefill but which TG_CONFIRM_CONTEXT does not display — so rule 5 rightly refuses to promote
  // it, and the screen cannot settle it. APP_ROLE is the honest test.
  const d = draftWith(GOOD);
  const withCompany = D.setField(
    D.setField(d, 'company_name', 'ООО Ромашка', 'user_explicit', true, NOW).draft,
    'business_activity', 'оптовая торговля', 'user_explicit', true, NOW).draft;
  eq(D.nextState(withCompany), 'APP_ROLE', 'starting point');

  const res = X.promoteShown(withCompany, X.shownSections(pipeline(GOOD), ''), NOW);
  assert(res.ok, 'promotion failed: ' + JSON.stringify(res));
  assert(res.promoted.indexOf('role') !== -1, 'role was not promoted');
  eq(D.canSkip(res.draft.fields.role, 'role'), true, 'a confirmed role still does not skip');
  eq(D.nextState(res.draft), 'APP_SCALE', 'confirmation did not advance past the confirmed question');
});

check('a field extraction prefills but never SHOWS can be neither confirmed nor skipped', () => {
  // `business_activity` is the case. Owner rule 1 allows extracting it "where supported"; the
  // approved confirmation screen does not show it, so it stays a prefill. That is the correct
  // outcome, not a gap: the client sees it on the app screen and answers there.
  const d = draftWith(GOOD);
  eq(d.fields.business_activity.source, 'ai_inferred', 'source');
  const shownKeys = X.shownSections(pipeline(GOOD), '').map((x) => x.key);
  assert(shownKeys.indexOf('business_activity') === -1, 'business_activity reached the confirmation screen');
  const res = X.promoteShown(d, X.shownSections(pipeline(GOOD), ''), NOW);
  eq(res.draft.fields.business_activity.source, 'ai_inferred', 'an unshown field was promoted');
  eq(D.canSkip(res.draft.fields.business_activity, 'business_activity'), false, 'an unshown guess would skip a question');
  eq(D.nextState(res.draft), 'APP_COMPANY', 'the company question was skipped on a guess');
});

check('«Исправить» discards the guess rather than keeping it around', () => {
  const d = draftWith(GOOD);
  assert(d.fields.company_name.value, 'nothing to discard');
  const cleared = X.discard(d);
  for (const name of X.DRAFT_BACKED) {
    eq(cleared.fields[name].value, null, name + ' survived the correction');
    eq(cleared.fields[name].source, null, name + ' kept its source');
    eq(cleared.fields[name].confirmed, false, name + ' stayed confirmed');
  }
  eq(D.nextState(cleared), 'APP_COMPANY', 'correction did not return to the first question');
});

check('«Исправить» does NOT discard anything the client stated themselves', () => {
  const d = draftWith(GOOD);
  d.fields.role = { value: 'Финансовый директор', source: 'user_explicit', confirmed: true, at: NOW };
  const cleared = X.discard(d);
  eq(cleared.fields.role.value, 'Финансовый директор', 'a user_explicit value was discarded');
  eq(cleared.fields.role.source, 'user_explicit', 'a user_explicit source was reset');
  eq(cleared.fields.company_name.value, null, 'the AI guess was not discarded');
});

check('a wrong AI guess corrected by the user ends as the user\'s value', () => {
  // Extraction proposes «Ромашка»; the client corrects it to something else.
  const d = draftWith(GOOD);
  eq(d.fields.company_name.value, 'Ромашка', 'setup');
  const cleared = X.discard(d);
  const set = D.setField(cleared, 'company_name', 'ООО Василёк', 'user_explicit', true, NOW);
  assert(set.ok, 'the corrected value was refused: ' + JSON.stringify(set));
  eq(set.draft.fields.company_name.value, 'ООО Василёк', 'value');
  eq(set.draft.fields.company_name.source, 'user_explicit', 'source');
  eq(D.canSkip(set.draft.fields.company_name, 'company_name'), true, 'the corrected value does not skip');
});

// ---------------------------------------------------------------- rules 10-13

check('extraction performs no I/O and touches no lead, cycle or initData', () => {
  const src = require('node:fs').readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', 'context-extraction.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const f of ['fetch(', 'http', 'lead_id', 'cycle_id', 'init_data', 'initdata',
                   'insert into', 'update ', 'rotate']) {
    assert(code.toLowerCase().indexOf(f) === -1, 'extraction references: ' + f);
  }
});

check('the module is a pure function — same input, same output, no mutation', () => {
  const input = { company_name: 'ООО Тест', objective: 'cash_flow' };
  const snapshot = JSON.stringify(input);
  const a = JSON.stringify(X.normalise(input));
  const b = JSON.stringify(X.normalise(input));
  eq(a, b, 'not deterministic');
  eq(JSON.stringify(input), snapshot, 'the input was mutated');
  const d = draftWith(GOOD);
  const before = JSON.stringify(d);
  X.discard(d);
  X.promoteShown(d, X.shownSections(pipeline(GOOD), ''), NOW);
  eq(JSON.stringify(d), before, 'the draft was mutated in place');
});

check('long free text is bounded, and the summary never exceeds its cap', () => {
  const r = pipeline('кассовые разрывы. '.repeat(200));
  assert(r.fields.problem_summary.length <= X.MAX_LEN.problem_summary + 1, 'summary over cap: ' + r.fields.problem_summary.length);
  const long = X.normalise({ company_name: 'Я'.repeat(500), role: 'Р'.repeat(500) });
  assert(long.fields.company_name.length <= 200, 'company over cap');
  assert(long.fields.role.length <= 200, 'role over cap');
});

check('malformed proposals do not throw', () => {
  for (const bad of [null, undefined, 'a string', 42, [], [{ objective: 'cash_flow' }], { objective: { id: 'x' } }]) {
    const r = X.normalise(bad);
    assert(r && r.fields && typeof r.fields === 'object', 'normalise returned nothing for ' + JSON.stringify(bad));
  }
  for (const bad of [null, undefined, '', 0]) {
    const r = X.extractDeterministic(bad);
    assert(r && typeof r === 'object', 'extractDeterministic threw on ' + JSON.stringify(bad));
  }
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
