#!/usr/bin/env node
// FINMENTOR — Premium UX meeting brief and privacy record.
//
//   node qa/premium-ux-brief.test.mjs
//
// Offline. No tenant, no network, no credentials, and NO privacy store — the store is designed but
// not created (owner decision B), so everything here runs against the record builder alone.
//
// WHAT THIS GATE IS FOR. Two separations that a reader cannot check by eye once the brief is
// rendered:
//
//   1. CLIENT FACTS vs FINMENTOR PREPARATION. On the page they sit under adjacent headings in the
//      same typeface. If a focus line ever leaked into the facts, a consultant would read a thing
//      FINMENTOR generated as a thing the client said — and act on it. The gate proves the halves
//      come from different sources and never share a line.
//   2. WHAT THE PRIVACY RECORD MAY CARRY. It is a legal artefact, not a CRM row. Every personal
//      field is refused rather than stripped, so a future edit that reintroduces one fails here.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const MB = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'meeting-brief.js'));
const PR = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-record.js'));
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
const KEY = 'sub_' + 'a'.repeat(32);

function row(over) {
  return Object.assign({
    company: 'ABC Retail', industry_category: 'Сеть магазинов', role: 'Собственник', turnover_range: '€2–10 млн',
    work_interest: 'Денежный поток',
    main_pain: 'Прибыль есть, денег не хватает',
    selected_goals: 'Получить прогноз движения денег',
    selected_documents: 'P&L; Cash Flow',
    premium: { current_setup: 'Бухгалтерский учёт; 1C / ERP', decision_horizon: '2–4 недели', important_context: 'Через месяц встреча с банком.' }
  }, over || {});
}
const labels = (b) => b.client_facts.map((s) => s.label);

console.log('Premium UX — meeting brief and privacy record');
console.log('');

// ---------------------------------------------------------------- brief structure

check('a full brief carries every section in the approved order', () => {
  const b = MB.buildBrief(row());
  eq(JSON.stringify(labels(b)), JSON.stringify(['ЗАДАЧА', 'ПРОБЛЕМА', 'ОЖИДАЕМЫЙ РЕЗУЛЬТАТ', 'ТЕКУЩАЯ СИСТЕМА', 'ГОРИЗОНТ', 'МАТЕРИАЛЫ', 'ВАЖНО ДО ВСТРЕЧИ']), 'sections');
  eq(b.head.company, 'ABC Retail', 'company');
  eq(b.head.role, 'Собственник', 'role');
});

check('ЗАДАЧА is the objective label, never the problem and never derived', () => {
  const b = MB.buildBrief(row());
  const task = b.client_facts.find((s) => s.label === 'ЗАДАЧА');
  eq(task.lines[0], 'Денежный поток', 'task line');
  assert(task.lines[0] !== 'Прибыль есть, денег не хватает', 'task collapsed into the problem');
  assert(B.OBJECTIVE_LABELS.indexOf(task.lines[0]) !== -1, 'task is not one of the eight objective labels');
});

check('ЗАДАЧА / ПРОБЛЕМА / ОЖИДАЕМЫЙ РЕЗУЛЬТАТ stay three distinct sections', () => {
  const b = MB.buildBrief(row());
  const get = (l) => b.client_facts.find((s) => s.label === l).lines.join(' ');
  const t = get('ЗАДАЧА'), p = get('ПРОБЛЕМА'), o = get('ОЖИДАЕМЫЙ РЕЗУЛЬТАТ');
  assert(t !== p && p !== o && t !== o, 'two sections collapsed into the same value');
});

check('ВАЖНО ДО ВСТРЕЧИ is omitted entirely when empty — no dash, no placeholder', () => {
  const b = MB.buildBrief(row({ premium: { current_setup: 'Бюджет', decision_horizon: '1–3 месяца', important_context: '' } }));
  assert(labels(b).indexOf('ВАЖНО ДО ВСТРЕЧИ') === -1, 'empty section rendered');
  const json = JSON.stringify(b);
  assert(json.indexOf('Важно до встречи: —') === -1, 'dash placeholder rendered');
  assert(json.indexOf(B.IMPORTANT_CONTEXT.placeholder) === -1, 'the placeholder leaked in as content');
});

check('МАТЕРИАЛЫ is omitted when nothing was indicated', () => {
  const b = MB.buildBrief(row({ selected_documents: '' }));
  assert(labels(b).indexOf('МАТЕРИАЛЫ') === -1, 'empty materials section rendered');
});

check('materials readiness is factual only (spec §27)', () => {
  eq(MB.buildBrief(row()).readiness[2].state, 'Материалы — приложены', 'present');
  eq(MB.buildBrief(row({ selected_documents: '' })).readiness[2].state, 'Материалы — не приложены', 'absent');
  const j = JSON.stringify(MB.buildBrief(row()).readiness);
  assert(!/частично|готовы/.test(j), 'subjective materials state reappeared');
});

// ---------------------------------------------------------------- the separation

check('every branch draws its focus from the controlled map, three lines, marked as such', () => {
  for (const o of B.OBJECTIVES) {
    const b = MB.buildBrief(row({ work_interest: o.label }));
    assert(b.preparation, 'no preparation block for ' + o.id);
    eq(b.preparation.source, 'controlled_map', 'source for ' + o.id);
    eq(b.preparation.lines.length, 3, 'line count for ' + o.id);
    eq(JSON.stringify(b.preparation.lines), JSON.stringify(B.FOCUS_MAP[o.id]), 'focus lines for ' + o.id);
    eq(b.preparation.disclaimer, B.FOCUS_DISCLAIMER, 'disclaimer for ' + o.id);
    assert(MB.separationHolds(b), 'separation broken for ' + o.id);
  }
});

check('an unknown objective renders NO focus block rather than a guess', () => {
  const b = MB.buildBrief(row({ work_interest: 'Что-то новое' }));
  eq(b.preparation, null, 'invented a focus for an unknown objective');
  eq(b.objective_id, null, 'objective_id invented');
  assert(MB.separationHolds(b), 'separation broken');
});

check('a focus line can never appear among the client facts', () => {
  // Plant a focus line where the client facts come from and require the separation check to fail.
  const poisoned = MB.buildBrief(row({ main_pain: B.FOCUS_MAP.cash_flow[0] }));
  assert(!MB.separationHolds(poisoned), 'separation check did not notice a focus line inside the client facts');
});

check('the brief contains no free-form generated prose — only client values and map lines', () => {
  const b = MB.buildBrief(row());
  const src = row();
  const allowed = [src.work_interest, src.main_pain, src.selected_goals, src.premium.decision_horizon,
    src.premium.important_context].concat(src.premium.current_setup.split(';').map((s) => s.trim()))
    .concat(src.selected_documents.split(';').map((s) => s.trim()));
  for (const s of b.client_facts) {
    for (const line of s.lines) {
      assert(allowed.indexOf(line) !== -1, 'a client-fact line was not one of the supplied values: ' + line);
    }
  }
});

// ---------------------------------------------------------------- privacy record

const ack = (over) => Object.assign({ notice_version: 'pn-2026-08', locale: 'ru', shown_at: NOW, acknowledged_at: NOW }, over || {});

check('a valid acknowledgement builds one immutable record with both timestamps', () => {
  const r = PR.buildPrivacyRecord({ submissionKey: KEY, cycleId: 'C-1', ack: ack() });
  assert(r.ok, 'rejected: ' + JSON.stringify(r));
  eq(r.record.privacy_notice_shown_at, NOW, 'shown_at');
  eq(r.record.privacy_notice_acknowledged_at, NOW, 'acknowledged_at');
  // no UPDATE is ever needed to turn "shown" into "acknowledged" — both are captured at once
  eq(JSON.stringify(Object.keys(r.record).sort()), JSON.stringify(PR.RECORD_KEYS.slice().sort()), 'record keys');
});

check('legal basis defaults to PENDING_LEGAL_REVIEW and is never invented', () => {
  const r = PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack() });
  eq(r.record.privacy_legal_basis, 'PENDING_LEGAL_REVIEW', 'default legal basis');
  eq(PR.PENDING_LEGAL_BASIS, 'PENDING_LEGAL_REVIEW', 'constant');
});

check('marketing consent is optional, separate, and null when never asked', () => {
  const never = PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack() });
  eq(never.record.marketing_consent, null, 'never-asked is not null');
  eq(never.record.marketing_consent_at, null, 'timestamp set');
  const declined = PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack(), marketingConsent: false });
  eq(declined.record.marketing_consent, false, 'declined');
  eq(declined.record.marketing_consent_at, null, 'declined should carry no timestamp');
  const given = PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack(), marketingConsent: true, marketingConsentAt: NOW });
  eq(given.record.marketing_consent, true, 'given');
  eq(given.record.marketing_consent_at, NOW, 'given timestamp');
});

check('marketing consent is NEVER required to submit', () => {
  const r = PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack() });
  assert(r.ok, 'a submission without marketing consent was refused');
});

check('REJECTS every forbidden personal field, at any depth', () => {
  for (const k of PR.FORBIDDEN) {
    assert(PR.leaks({ [k]: 'x' }).length > 0, 'not detected at top level: ' + k);
    assert(PR.leaks({ a: { b: { [k]: 'x' } } }).length > 0, 'not detected when nested: ' + k);
  }
  const record = PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack() }).record;
  eq(PR.leaks(record).length, 0, 'the real record leaks');
});

check('the record carries no identity, no contact and no client words', () => {
  const json = JSON.stringify(PR.buildPrivacyRecord({ submissionKey: KEY, cycleId: 'C-1', ack: ack() }).record);
  for (const probe of ['ABC Retail', 'Геннадий', '990000001', 'Прибыль есть', 'init_data', '@']) {
    assert(json.indexOf(probe) === -1, 'record contains ' + probe);
  }
});

check('REJECTS a non-opaque or malformed submission key', () => {
  for (const bad of ['', 'FIN-1', '990000001', 'sub_short', 'sub_' + 'z'.repeat(32)]) {
    assert(!PR.buildPrivacyRecord({ submissionKey: bad, ack: ack() }).ok, 'accepted key: ' + bad);
  }
});

check('REJECTS a malformed or dishonest acknowledgement', () => {
  const bad = [
    ack({ notice_version: '' }),
    ack({ locale: 'en' }),
    ack({ shown_at: 'yesterday' }),
    ack({ acknowledged_at: '' }),
    // acknowledged BEFORE it was shown is not a record, it is a contradiction
    ack({ shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T09:00:00.000Z' })
  ];
  for (const a of bad) { assert(!PR.buildPrivacyRecord({ submissionKey: KEY, ack: a }).ok, 'accepted: ' + JSON.stringify(a)); }
});

check('the insert is a PLAIN insert — ON CONFLICT needs a SELECT the writer must not have', () => {
  // Measured against the real privacy_audit_writer role: `on conflict do nothing` fails with
  // permission denied, because ON CONFLICT requires SELECT and the writer is granted INSERT only.
  // Granting SELECT to make the tidier form work would trade the least-privilege property for
  // syntax, so idempotency moves one layer up: the unique index raises 23505 and the caller reads
  // that as "already recorded". Three write attempts for one key left exactly one row.
  assert(!/on conflict/i.test(PR.INSERT_SQL), 'ON CONFLICT is back; it needs SELECT and the writer has none');
  assert(!/update/i.test(PR.INSERT_SQL), 'the insert contains an UPDATE — append-only would be a claim, not a fact');
  assert(!/delete/i.test(PR.INSERT_SQL), 'the insert contains a DELETE');
  assert(/privacy\.privacy_acknowledgements/.test(PR.INSERT_SQL), 'the insert does not target the privacy schema');
  const params = PR.insertParams(PR.buildPrivacyRecord({ submissionKey: KEY, ack: ack() }).record);
  eq(params.length, 7, 'parameter count');
  eq(params[0], KEY, 'first parameter is the opaque key');
});

check('a duplicate write is recognised as already-recorded, not as a failure', () => {
  eq(PR.ALREADY_RECORDED_SQLSTATE, '23505', 'sqlstate');
  assert(PR.isAlreadyRecorded({ code: '23505' }), 'did not recognise 23505');
  assert(PR.isAlreadyRecorded({ message: 'duplicate key value violates unique constraint "x"' }), 'did not recognise the message form');
  assert(!PR.isAlreadyRecorded({ code: '42501' }), 'treated permission denied as already-recorded');
  assert(!PR.isAlreadyRecorded(null), 'treated no error as already-recorded');
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
