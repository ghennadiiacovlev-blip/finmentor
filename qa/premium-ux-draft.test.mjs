#!/usr/bin/env node
// FINMENTOR — Premium UX draft + provenance contract.
//
//   node qa/premium-ux-draft.test.mjs
//
// Offline. No tenant, no network, no credentials.
//
// WHAT THIS GATE IS FOR. The smart-skip rule is the one place where a plausible implementation is
// also a wrong one: skipping on a value the system merely GUESSED looks identical, in the UI, to
// skipping on a value the client actually gave. So this gate does not check that the happy path
// works — it checks that every wrong way to skip is refused. `ai_inferred` gets its own block, and
// so does `telegram_carried` on a field that was never approved for carrying.
//
// It also holds the draft validator against the shapes a hostile or stale client would send:
// unknown fields, forbidden keys, cross-branch pairings, oversize bodies.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
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

const NOW = '2026-08-29T10:00:00.000Z';
const f = (value, source, confirmed) => ({ value: value, source: source, confirmed: confirmed, at: confirmed ? NOW : null });

// A complete, valid Cash Flow draft — the fixture the negative cases mutate.
function fullDraft() {
  const d = D.emptyDraft('C-1-1');
  d.fields.company_name = f('ABC Retail', 'user_explicit', true);
  d.fields.business_activity = f('Сеть магазинов', 'user_explicit', true);
  d.fields.role = f('Собственник', 'user_confirmed', true);
  d.fields.turnover_band = f('€2–10 млн', 'user_explicit', true);
  d.fields.objective = f('Денежный поток', 'user_explicit', true);
  d.fields.problem = f('Прибыль есть, денег не хватает', 'user_explicit', true);
  d.fields.desired_outcome = f('Получить прогноз движения денег', 'user_explicit', true);
  d.fields.current_setup = f(['Бухгалтерский учёт', '1C / ERP'], 'user_explicit', true);
  d.fields.decision_horizon = f('2–4 недели', 'user_explicit', true);
  d.fields.contact_channel = f('telegram', 'user_explicit', true);
  d.fields.locale = f('ru', 'telegram_carried', true);
  d.updated_at = NOW;
  return d;
}

console.log('Premium UX — draft and provenance');
console.log('');

// ---------------------------------------------------------------- the skip rule

check('user_explicit + confirmed skips', () => {
  assert(D.canSkip(f('ABC', 'user_explicit', true), 'company_name'), 'did not skip');
});

check('user_confirmed + confirmed skips', () => {
  assert(D.canSkip(f('Собственник', 'user_confirmed', true), 'role'), 'did not skip');
});

check('ai_inferred NEVER skips, however confirmed the flag claims to be', () => {
  assert(!D.canSkip(f('ABC Retail', 'ai_inferred', true), 'company_name'), 'ai_inferred skipped with confirmed:true');
  assert(!D.canSkip(f('ABC Retail', 'ai_inferred', false), 'company_name'), 'ai_inferred skipped');
  // and it must not skip for ANY field name, including the approved carried ones
  for (const name of D.APPROVED_CARRIED) {
    assert(!D.canSkip(f('x', 'ai_inferred', true), name), 'ai_inferred skipped an approved-carried field: ' + name);
  }
});

check('telegram_carried skips ONLY the approved identity fields', () => {
  for (const name of D.APPROVED_CARRIED) {
    assert(D.canSkip(f('x', 'telegram_carried', true), name), 'approved carried field did not skip: ' + name);
  }
  for (const name of ['company_name', 'objective', 'problem', 'turnover_band', 'role', 'current_setup']) {
    assert(!D.canSkip(f('x', 'telegram_carried', true), name), 'unapproved field skipped on telegram_carried: ' + name);
  }
});

check('role is NOT an approved carried field', () => {
  assert(D.APPROVED_CARRIED.indexOf('role') === -1, 'role became carry-skippable');
});

check('confirmed:false never skips, whatever the source', () => {
  for (const s of D.SOURCES) { assert(!D.canSkip(f('x', s, false), 'company_name'), 'skipped unconfirmed: ' + s); }
});

check('an empty or absent value never skips even when confirmed', () => {
  assert(!D.canSkip(f('', 'user_explicit', true), 'company_name'), 'empty string skipped');
  assert(!D.canSkip(f(null, 'user_explicit', true), 'company_name'), 'null skipped');
  assert(!D.canSkip(f([], 'user_explicit', true), 'current_setup'), 'empty array skipped');
  assert(!D.canSkip(undefined, 'company_name'), 'undefined skipped');
});

check('an unknown source never skips', () => {
  assert(!D.canSkip({ value: 'x', source: 'trust_me', confirmed: true, at: NOW }, 'company_name'), 'unknown source skipped');
  assert(!D.canSkip({ value: 'x', source: null, confirmed: true, at: NOW }, 'company_name'), 'null source skipped');
});

// ---------------------------------------------------------------- resume / next state

check('an empty draft asks for company first', () => {
  eq(D.nextState(D.emptyDraft('C-1')), 'APP_COMPANY', 'first state');
});

check('resume lands on the first unsettled field, skipping settled ones', () => {
  const d = D.emptyDraft('C-1');
  d.fields.company_name = f('ABC', 'user_explicit', true);
  d.fields.business_activity = f('Retail', 'user_explicit', true);
  d.fields.role = f('Собственник', 'user_confirmed', true);
  eq(D.nextState(d), 'APP_SCALE', 'should resume at scale');
});

check('an ai_inferred value does NOT advance the resume point', () => {
  const d = D.emptyDraft('C-1');
  d.fields.company_name = f('ABC', 'ai_inferred', true);
  eq(D.nextState(d), 'APP_COMPANY', 'ai_inferred advanced the flow');
});

check('a complete draft reaches review; optional fields never block', () => {
  const d = fullDraft();
  eq(D.nextState(d), 'APP_REVIEW', 'not review-ready');
  assert(D.isReviewReady(d), 'isReviewReady false');
  eq(JSON.stringify(D.outstanding(d)), '[]', 'outstanding not empty');
  // documents and important_context are untouched in the fixture and must not block
  eq(d.fields.documents.value, null, 'fixture assumption');
  eq(d.fields.important_context.value, null, 'fixture assumption');
});

check('a free-text branch requires its text before review', () => {
  const d = D.emptyDraft('C-1');
  for (const k of ['company_name', 'business_activity']) { d.fields[k] = f('x', 'user_explicit', true); }
  d.fields.role = f('Собственник', 'user_confirmed', true);
  d.fields.turnover_band = f('€2–10 млн', 'user_explicit', true);
  d.fields.objective = f('Нужен независимый взгляд', 'user_explicit', true);
  d.fields.desired_outcome = f('Определить приоритеты', 'user_explicit', true);
  d.fields.current_setup = f(['Бухгалтерский учёт'], 'user_explicit', true);
  d.fields.decision_horizon = f('1–3 месяца', 'user_explicit', true);
  d.fields.contact_channel = f('telegram', 'user_explicit', true);
  assert(D.outstanding(d).length > 0, 'free-text branch reached review with no text');
  d.fields.problem_free_text = f('Не понимаю, куда уходят деньги.', 'user_explicit', true);
  eq(JSON.stringify(D.outstanding(d)), '[]', 'still outstanding after text supplied');
});

check('the free-text OUTCOME option requires its text', () => {
  const d = fullDraft();
  d.fields.objective = f('Другая задача', 'user_explicit', true);
  d.fields.problem = f(null, null, false);
  d.fields.problem_free_text = f('Партнёр предлагает выкупить долю.', 'user_explicit', true);
  d.fields.desired_outcome = f('Опишу ожидаемый результат сам', 'user_explicit', true);
  assert(D.outstanding(d).indexOf('desired_outcome_free_text') !== -1, 'free-text outcome not required');
});

// ---------------------------------------------------------------- validation

check('the full fixture validates', () => {
  const r = D.validateDraft(fullDraft());
  assert(r.ok, 'valid draft rejected: ' + JSON.stringify(r));
});

check('REJECTS an unknown field', () => {
  const d = fullDraft();
  d.fields.favourite_colour = f('gold', 'user_explicit', true);
  assert(!D.validateDraft(d).ok, 'unknown field accepted');
});

check('REJECTS every forbidden key', () => {
  for (const k of D.FORBIDDEN_KEYS) {
    const d = fullDraft();
    d.fields[k] = f('x', 'user_explicit', true);
    const r = D.validateDraft(d);
    assert(!r.ok, 'forbidden key accepted: ' + k);
  }
});

check('REJECTS an out-of-vocabulary enum value', () => {
  const d = fullDraft();
  d.fields.turnover_band = f('€100 млрд', 'user_explicit', true);
  assert(!D.validateDraft(d).ok, 'unknown band accepted');
  const d2 = fullDraft();
  d2.fields.decision_horizon = f('когда-нибудь', 'user_explicit', true);
  assert(!D.validateDraft(d2).ok, 'unknown horizon accepted');
});

check('REJECTS a multi-select value outside the eleven, and duplicates', () => {
  const d = fullDraft();
  d.fields.current_setup = f(['Бухгалтерский учёт', 'SAP'], 'user_explicit', true);
  assert(!D.validateDraft(d).ok, 'unknown setup value accepted');
  const d2 = fullDraft();
  d2.fields.current_setup = f(['Бюджет', 'Бюджет'], 'user_explicit', true);
  assert(!D.validateDraft(d2).ok, 'duplicate setup value accepted');
});

check('REJECTS a problem from another branch', () => {
  const d = fullDraft();
  d.fields.problem = f('Покупка объекта', 'user_explicit', true); // real estate problem, cash flow objective
  assert(!D.validateDraft(d).ok, 'cross-branch problem accepted');
});

check('REJECTS an outcome from another branch', () => {
  const d = fullDraft();
  d.fields.desired_outcome = f('Определить максимальную цену покупки', 'user_explicit', true);
  assert(!D.validateDraft(d).ok, 'cross-branch outcome accepted');
});

check('REJECTS a diagnostic card on a free-text branch', () => {
  const d = fullDraft();
  d.fields.objective = f('Нужен независимый взгляд', 'user_explicit', true);
  assert(!D.validateDraft(d).ok, 'card problem accepted on a free-text branch');
});

check('REJECTS a problem or outcome with no objective', () => {
  const d = D.emptyDraft('C-1');
  d.fields.problem = f('Нет ясного прогноза', 'user_explicit', true);
  assert(!D.validateDraft(d).ok, 'problem accepted without an objective');
});

check('REJECTS confirmed:true with no value', () => {
  const d = fullDraft();
  d.fields.company_name = { value: null, source: 'user_explicit', confirmed: true, at: NOW };
  assert(!D.validateDraft(d).ok, 'confirmed-without-value accepted');
});

check('REJECTS a bad source, a non-boolean confirmed, and extra field keys', () => {
  const bad = [
    (d) => { d.fields.company_name.source = 'vibes'; },
    (d) => { d.fields.company_name.confirmed = 'yes'; },
    (d) => { d.fields.company_name.provenance = 'x'; }
  ];
  for (const mutate of bad) { const d = fullDraft(); mutate(d); assert(!D.validateDraft(d).ok, 'accepted a malformed field'); }
});

check('REJECTS a wrong version and extra top-level keys', () => {
  const d = fullDraft(); d.v = 2;
  assert(!D.validateDraft(d).ok, 'wrong version accepted');
  const d2 = fullDraft(); d2.injected = true;
  assert(!D.validateDraft(d2).ok, 'extra top-level key accepted');
});

check('REJECTS an oversize draft', () => {
  const d = fullDraft();
  d.fields.important_context = f('x'.repeat(400), 'user_explicit', true);
  assert(D.validateDraft(d).ok, 'a 400-char context should fit');
  const d2 = fullDraft();
  d2.fields.important_context = { value: 'x'.repeat(600), source: 'user_explicit', confirmed: true, at: NOW };
  assert(!D.validateDraft(d2).ok, 'over-long free text accepted');
});

// ---------------------------------------------------------------- mutation

check('setField canonicalises multi-select order', () => {
  const d = D.emptyDraft('C-1');
  const r = D.setField(d, 'current_setup', ['Бюджет', 'Бухгалтерский учёт'], 'user_explicit', true, NOW);
  assert(r.ok, 'setField failed: ' + JSON.stringify(r));
  // canonical order is the spec order: Бухгалтерский учёт comes first
  eq(JSON.stringify(r.draft.fields.current_setup.value), JSON.stringify(['Бухгалтерский учёт', 'Бюджет']), 'not canonicalised');
});

check('setField refuses an unknown field and a bad source', () => {
  const d = D.emptyDraft('C-1');
  assert(!D.setField(d, 'nope', 'x', 'user_explicit', true, NOW).ok, 'unknown field set');
  assert(!D.setField(d, 'company_name', 'x', 'guessed', true, NOW).ok, 'bad source set');
});

check('setField does not mutate the input draft', () => {
  const d = D.emptyDraft('C-1');
  const before = JSON.stringify(d);
  D.setField(d, 'company_name', 'ABC', 'user_explicit', true, NOW);
  eq(JSON.stringify(d), before, 'input draft was mutated');
});

check('confirmContext is the ONLY promotion out of ai_inferred, and it is explicit', () => {
  const d = D.emptyDraft('C-1');
  d.fields.company_name = f('ABC Retail', 'ai_inferred', false);
  d.fields.objective = f('Денежный поток', 'ai_inferred', false);
  assert(!D.canSkip(d.fields.company_name, 'company_name'), 'inferred skipped before confirmation');
  const r = D.confirmContext(d, ['company_name', 'objective'], NOW);
  assert(r.ok, 'confirmContext failed: ' + JSON.stringify(r));
  eq(r.draft.fields.company_name.source, 'user_confirmed', 'not promoted');
  assert(D.canSkip(r.draft.fields.company_name, 'company_name'), 'still not skippable after explicit confirmation');
});

check('confirmContext never invents a value for an empty field', () => {
  const d = D.emptyDraft('C-1');
  const r = D.confirmContext(d, D.FIELD_NAMES, NOW);
  assert(r.ok, 'failed');
  for (const n of D.FIELD_NAMES) {
    eq(r.draft.fields[n].value, null, 'value appeared for ' + n);
    assert(!D.canSkip(r.draft.fields[n], n), 'empty field became skippable: ' + n);
  }
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f2) => console.log('  - ' + f2));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
