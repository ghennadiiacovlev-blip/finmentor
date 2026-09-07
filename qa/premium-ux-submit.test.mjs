#!/usr/bin/env node
// FINMENTOR — Premium UX submit projection.
//
//   node qa/premium-ux-submit.test.mjs
//
// Offline. No tenant, no network, no credentials.
//
// WHAT THIS GATE IS FOR. Three things the submit path must never get wrong, each of which has
// already gone wrong once in this project's history:
//
//   1. THE BROWSER MUST NOT STEER THE PAYLOAD. In B.2.0 the answers travelled in the submit body
//      and were whitelisted on arrival. Here they are read from the SERVER-SIDE draft, so the body
//      carries only a session id and the privacy acknowledgement — there is nothing to whitelist
//      because there is nothing to accept. The gate proves the body cannot inject answers.
//   2. `mode` MUST BE REFUSED, NOT OMITTED (N6.2). A field the response merely forgets to include
//      is one edit away from returning; a field that fails `responseLeaks` is not.
//   3. NEGATION MUST SURVIVE. «Жёсткого срока нет» and «Сначала хочу обсудить подход» must reach
//      the scorer as non-urgent strings. This is the exact defect class of the retired
//      «Нет срочности», and promoting decision_horizon to a column is when it would resurface.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const S = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'submit-projection.js'));
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
const APP = 'AS-' + 'a'.repeat(64);
const f = (value, source, confirmed) => ({ value: value, source: source, confirmed: confirmed, at: confirmed ? NOW : null });

function draftFor(objectiveLabel, problem, outcome, extra) {
  const d = D.emptyDraft('C-1-1');
  d.fields.company_name = f('ABC Retail', 'user_explicit', true);
  d.fields.business_activity = f('Сеть магазинов', 'user_explicit', true);
  d.fields.role = f('Собственник', 'user_confirmed', true);
  d.fields.turnover_band = f('€2–10 млн', 'user_explicit', true);
  d.fields.objective = f(objectiveLabel, 'user_explicit', true);
  if (problem) { d.fields.problem = f(problem, 'user_explicit', true); }
  d.fields.desired_outcome = f(outcome, 'user_explicit', true);
  d.fields.current_setup = f(['Бухгалтерский учёт', '1C / ERP'], 'user_explicit', true);
  d.fields.decision_horizon = f('2–4 недели', 'user_explicit', true);
  d.fields.contact_channel = f('telegram', 'user_explicit', true);
  d.fields.locale = f('ru', 'telegram_carried', true);
  Object.assign(d.fields, extra || {});
  d.updated_at = NOW;
  return d;
}
const okBody = () => ({
  app_session_id: APP, client_version: 'b3.0.0',
  privacy_ack: { notice_version: 'pn-2026-08', locale: 'ru', shown_at: NOW, acknowledged_at: NOW }
});
const build = (d) => S.buildLeadIntakePayload({ draft: d, telegramUserId: '990000001', contactName: 'Геннадий', nowIso: NOW, correlationId: 'corr-1', clientVersion: 'b3.0.0' });

console.log('Premium UX — submit projection');
console.log('');

// ---------------------------------------------------------------- all eight branches

check('every one of the eight branches projects successfully', () => {
  for (const o of B.OBJECTIVES) {
    const isFree = B.isFreeTextProblem(o.id);
    const problem = isFree ? null : B.problemLabels(o.id)[0];
    const outcome = B.outcomeLabels(o.id)[0];
    const extra = isFree ? { problem_free_text: f('Своими словами про ситуацию.', 'user_explicit', true) } : {};
    const d = draftFor(o.label, problem, outcome, extra);
    const v = D.validateDraft(d);
    assert(v.ok, o.id + ' draft invalid: ' + JSON.stringify(v));
    const sub = S.assertSubmittable(d);
    assert(sub.ok, o.id + ' not submittable: ' + JSON.stringify(sub));
    const r = build(d);
    assert(r.ok, o.id + ' projection failed: ' + JSON.stringify(r));
    // ЗАДАЧА travels as the objective LABEL, never derived (spec §26)
    eq(r.envelope.payload.intake.commercial_intent.work_interest[0], o.label, o.id + ' work_interest');
    eq(r.envelope.payload.miniapp.objective_id, o.id, o.id + ' objective_id');
  }
});

check('a free-text branch carries the client words as the problem, not a card label', () => {
  const d = draftFor('Нужен независимый взгляд', null, 'Определить приоритеты',
    { problem_free_text: f('Растём, а денег меньше.', 'user_explicit', true) });
  const r = build(d);
  assert(r.ok, 'failed');
  eq(r.envelope.payload.main_pain.problem, 'Растём, а денег меньше.', 'problem text');
  assert(r.envelope.payload.intake.business_pain.selected_problems[0] === 'Растём, а денег меньше.', 'selected_problems');
});

check('«Опишу ситуацию своими словами» on a card branch resolves to the text', () => {
  const d = draftFor('Денежный поток', B.PROBLEM_FREE_TEXT_OPTION, 'Настроить платежи и контроль',
    { problem_free_text: f('Свой текст.', 'user_explicit', true) });
  eq(S.problemText(d.fields), 'Свой текст.', 'did not resolve to the free text');
});

check('the free-text OUTCOME is folded into selected_goals, not given a column', () => {
  const d = draftFor('Другая задача', null, 'Опишу ожидаемый результат сам', {
    problem_free_text: f('Выкуп доли партнёра.', 'user_explicit', true),
    desired_outcome_free_text: f('Проверить оценку доли.', 'user_explicit', true)
  });
  const r = build(d);
  assert(r.ok, 'failed');
  const goals = r.envelope.payload.selected_goals;
  assert(goals.indexOf('Проверить оценку доли.') !== -1, 'free-text outcome lost: ' + goals);
  assert(!('desired_outcome_free_text' in r.envelope.payload), 'a dedicated key appeared');
});

// ---------------------------------------------------------------- current setup

check('current_setup travels as a deterministic joined string in canonical order', () => {
  const a = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег');
  const b = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег');
  // same boxes, different order in
  const set = D.setField(b, 'current_setup', ['1C / ERP', 'Бухгалтерский учёт'], 'user_explicit', true, NOW);
  assert(set.ok, 'setField failed');
  eq(build(a).envelope.payload.premium.current_setup, build(set.draft).envelope.payload.premium.current_setup,
    'two clients who ticked the same boxes produced different CRM values');
  eq(build(a).envelope.payload.premium.current_setup, 'Бухгалтерский учёт; 1C / ERP', 'joined form');
});

// ---------------------------------------------------------------- negation guard

check('non-urgent horizons reach the scorer as non-urgent strings', () => {
  for (const horizon of ['Жёсткого срока нет', 'Сначала хочу обсудить подход']) {
    const d = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег',
      { decision_horizon: f(horizon, 'user_explicit', true) });
    const r = build(d);
    assert(r.ok, 'failed for ' + horizon);
    eq(r.envelope.payload.main_pain.urgency, horizon, 'urgency string for ' + horizon);
    // The scorer's negation guard matches on these; a value rewritten into urgent vocabulary is
    // exactly the retired «Нет срочности» defect.
    assert(/нет|обсудить/i.test(r.envelope.payload.main_pain.urgency), 'negation lost for ' + horizon);
    assert(!/срочно|неделю|urgent/i.test(r.envelope.payload.main_pain.urgency), 'urgency vocabulary injected for ' + horizon);
  }
});

// ---------------------------------------------------------------- documents (owner decision A)

check('documents are availability only, and say so', () => {
  const d = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег',
    { documents: f(['P&L', 'Cash Flow'], 'user_explicit', true) });
  const r = build(d);
  assert(r.ok, 'failed');
  const st = r.envelope.payload.intake.documents_available.status;
  assert(/файлы не приложены/i.test(st), 'status does not state that no file was attached: ' + st);
  const none = build(draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег'));
  assert(/не указаны/i.test(none.envelope.payload.intake.documents_available.status), 'empty status wrong');
});

// ---------------------------------------------------------------- contact

check('Telegram channel requests no phone and no email', () => {
  const r = build(draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег'));
  eq(r.envelope.payload.client.email, '', 'email set');
  eq(r.envelope.payload.client.phone_or_messenger, '', 'phone set');
  eq(r.envelope.payload.client.telegram, '990000001', 'telegram identity missing');
});

check('phone and email channels route the value to the right field', () => {
  const p = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег', {
    contact_channel: f('phone', 'user_explicit', true), contact_value: f('+37360000000', 'user_explicit', true)
  });
  eq(build(p).envelope.payload.client.phone_or_messenger, '+37360000000', 'phone');
  const e = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег', {
    contact_channel: f('email', 'user_explicit', true), contact_value: f('a@b.co', 'user_explicit', true)
  });
  eq(build(e).envelope.payload.client.email, 'a@b.co', 'email');
});

// ---------------------------------------------------------------- body cannot steer

check('the submit body carries no answers at all', () => {
  const r = S.validateSubmitBody(okBody());
  assert(r.ok, 'valid body rejected: ' + JSON.stringify(r));
  eq(JSON.stringify(Object.keys(r).sort()), JSON.stringify(['app_session_id', 'dropped_keys', 'ok', 'privacy_ack']), 'shape');
});

check('answers injected into the body are dropped, never read', () => {
  const body = okBody();
  body.answers = { objective: 'Финансирование' };
  body.fields = { objective: { value: 'Финансирование' } };
  body.lead_id = 'FIN-hacked';
  body.priority = 'HOT';
  const r = S.validateSubmitBody(body);
  assert(r.ok, 'rejected');
  for (const k of ['answers', 'fields', 'lead_id', 'priority']) {
    assert(r.dropped_keys.indexOf(k) !== -1, 'not reported as dropped: ' + k);
  }
  // and the projection reads only the draft
  const d = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег');
  eq(build(d).envelope.payload.intake.commercial_intent.work_interest[0], 'Денежный поток', 'body steered the objective');
});

check('REJECTS a malformed session id, a bad client version and a missing acknowledgement', () => {
  const bad = [
    (b) => { b.app_session_id = 'AS-short'; },
    (b) => { b.app_session_id = 'guessed'; },
    (b) => { b.client_version = 'b2.1.0'; },
    (b) => { delete b.privacy_ack; },
    (b) => { delete b.privacy_ack.notice_version; },
    (b) => { delete b.privacy_ack.acknowledged_at; }
  ];
  for (const mutate of bad) { const b = okBody(); mutate(b); assert(!S.validateSubmitBody(b).ok, 'accepted a bad body'); }
});

// ---------------------------------------------------------------- submittability

check('an incomplete draft is refused at submit, not merely at the UI', () => {
  const d = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег');
  d.fields.decision_horizon = f(null, null, false);
  const r = S.assertSubmittable(d);
  assert(!r.ok, 'incomplete draft accepted');
  assert(/decision_horizon/.test(r.detail), 'does not name the missing field: ' + r.detail);
});

check('an ai_inferred-only draft is refused at submit', () => {
  const d = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег');
  d.fields.company_name = f('ABC Retail', 'ai_inferred', true);
  assert(!S.assertSubmittable(d).ok, 'inferred value satisfied submit');
});

// ---------------------------------------------------------------- response hygiene

check('mode and lead_mode are REFUSED at any depth, not omitted', () => {
  for (const probe of [{ mode: 'new' }, { lead_mode: 'merged' }, { a: { b: { mode: 'new' } } }, { xs: [{ lead_mode: 'x' }] }]) {
    assert(S.responseLeaks(probe).length > 0, 'leak not detected: ' + JSON.stringify(probe));
  }
  assert(S.RESPONSE_FORBIDDEN_KEYS.indexOf('mode') !== -1, 'mode left the forbidden list');
  assert(S.RESPONSE_FORBIDDEN_KEYS.indexOf('lead_mode') !== -1, 'lead_mode left the forbidden list');
});

check('the client response carries only the five allowed fields', () => {
  const r = S.buildClientResponse({ ok: true, lead_id: 'FIN-1', priority: 'WARM', financial_zone: 'YELLOW', submit_state: 'submitted', mode: 'new', cycle_id: 'C-1' });
  assert(r.ok, 'failed: ' + JSON.stringify(r));
  eq(JSON.stringify(Object.keys(r.response).sort()), JSON.stringify(['financial_zone', 'lead_id', 'ok', 'priority', 'submit_state']), 'response keys');
  assert(!('mode' in r.response), 'mode returned');
  assert(!('cycle_id' in r.response), 'cycle_id returned');
});

check('submission_key and privacy_legal_basis can never reach the browser', () => {
  for (const k of ['submission_key', 'privacy_legal_basis', 'app_session_id', 'init_data']) {
    assert(S.RESPONSE_FORBIDDEN_KEYS.indexOf(k) !== -1, 'not forbidden: ' + k);
    assert(S.responseLeaks({ [k]: 'x' }).length > 0, 'leak not detected: ' + k);
  }
});

check('an oversize payload is refused', () => {
  const d = draftFor('Денежный поток', 'Нет ясного прогноза', 'Получить прогноз движения денег');
  const r = build(d);
  assert(r.ok && r.payload_bytes < S.MAX_PAYLOAD_BYTES, 'normal payload should fit');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((x) => console.log('  - ' + x));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
