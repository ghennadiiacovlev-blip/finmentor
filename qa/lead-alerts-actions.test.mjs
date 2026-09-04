#!/usr/bin/env node
// FINMENTOR — Lead Alert action UX: the owner decisions D1–D11, proven offline.
//
//   node qa/lead-alerts-actions.test.mjs
//
// Offline. No tenant, no network, no Telegram, no Sheets, no production writes.
//
// WHAT THIS GATE IS FOR. The audit found every button wired and complete, and the defect entirely
// in presentation and lifecycle: six buttons in one Telegram row truncated to «D… Sn… Di…», a
// keyboard that stayed live after the action, an «✅ Done» label on a mutation that only closes an
// SLA, and a read-modify-write that carried fifteen pre-read columns into every update.
//
// Each owner decision is a case below, named by its decision number, so a future edit that
// silently reverts one fails with the decision it broke rather than with a diff.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);

const LA = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'));
const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const A = new Function(ACTIONS_SRC + '; return LAA;')();
const { toTelegram } = require_(join(HERE, 'telegram-emulator.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const LEAD = 'FIN-1788000000000-909';
const layout = (kind, state) => A.keyboard(kind, state, LEAD)
  .map((r) => r.map((b) => b.text).join(' | ')).join('  //  ');
const labels = (kind, state) => A.keyboard(kind, state, LEAD).map((r) => r.map((b) => b.text));

console.log('');
console.log('FINMENTOR Lead Alert action UX — owner decisions D1–D11');
console.log('');

// ══════════════════════════════════════════════ D1 / D3 — what the owner sees

console.log('D1 / D3 — labels and the retired Won button');

check('D1 no emitter offers Won, on any alert kind, in any state', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const state of [{}, { deal_stage: 'New' }, { deal_stage: 'Qualified', sla_status: 'Active' },
      { deal_stage: 'Discovery Scheduled' }, { deal_stage: 'Documents Requested' }]) {
      const flat = A.keyboard(kind, state, LEAD).flat();
      assert(!flat.some((b) => /won/i.test(b.callback_data)), kind + ' emits a won callback');
      assert(!flat.some((b) => /Won|🏆/.test(b.text)), kind + ' shows a Won label');
    }
  }
});

check('D1 the legacy won callback contract is untouched by this module', () => {
  // The Command Center still routes `won|<id>`; this module simply never emits it. Historical
  // Telegram messages keep working, which is the whole point of not renaming callbacks.
  eq(A.callbackData('won', LEAD), '', 'the module invented a won emitter');
  assert(!Object.prototype.hasOwnProperty.call(A.OWNED, 'won'), 'the module claims won columns');
});

check('D3 the five owner-facing labels are exactly these', () => {
  eq(A.LABEL.done, '✅ Обработано', 'done label');
  eq(A.LABEL.snooze, '⏰ На 24 часа', 'snooze label');
  eq(A.LABEL.discovery, '📞 Discovery', 'discovery label');
  eq(A.LABEL.docs, '📄 Документы', 'docs label');
  eq(A.LABEL.nurture, '🗂 В наблюдение', 'nurture label');
});

check('D3 (2026-09-04) every visible label is Russian or an approved product term — no «Nurture», no raw English verbs', () => {
  const all = Object.values(A.LABEL);
  for (const l of all) { assert(!/Nurture/.test(l), 'the English «Nurture» is visible: ' + l); }
  eq(JSON.stringify(all), JSON.stringify(['✅ Обработано', '⏰ На 24 часа', '📞 Discovery', '📄 Документы', '🗂 В наблюдение']), 'the approved label set');
});

check('D3 no forbidden English label is reachable', () => {
  const all = Object.values(A.LABEL).join(' ');
  for (const bad of ['Done', 'Snooze', 'Docs', 'Won', 'Выполнено']) {
    assert(!new RegExp('\\b' + bad + '\\b').test(all), 'a forbidden label is visible: ' + bad);
  }
  // «Discovery» IS permitted — it is the owner-approved label for that action.
  assert(/Discovery/.test(all), 'the approved Discovery label is missing');
});

check('D3 callback_data is byte-identical to what production already sends', () => {
  eq(A.callbackData('done', LEAD), 'done|' + LEAD, 'done');
  eq(A.callbackData('snooze', LEAD), 'snooze|' + LEAD + '|24', 'snooze');
  eq(A.callbackData('discovery', LEAD), 'stage|' + LEAD + '|Discovery Scheduled', 'discovery');
  eq(A.callbackData('docs', LEAD), 'docs|' + LEAD, 'docs');
  eq(A.callbackData('nurture', LEAD), 'nurture|' + LEAD, 'nurture');
});

// ══════════════════════════════════════════════ D2 — the approved action sets

console.log('');
console.log('D2 — context-aware action sets');

check('D2 NEW LEAD is exactly [Discovery|Документы] / [На 24 часа|В наблюдение]', () => {
  const rows = labels('new_lead', { deal_stage: 'Qualified', sla_status: 'Active' });
  eq(JSON.stringify(rows), JSON.stringify([
    ['📞 Discovery', '📄 Документы'],
    ['⏰ На 24 часа', '🗂 В наблюдение']
  ]), 'NEW LEAD layout');
});

check('D2 NEW LEAD shows neither Обработано nor Won', () => {
  const flat = labels('new_lead', { deal_stage: 'Qualified' }).flat();
  assert(!flat.includes('✅ Обработано'), 'NEW LEAD offers the SLA-closing action');
  eq(flat.length, 4, 'NEW LEAD action count');
});

check('D2 PRIORITY is exactly [Обработано|На 24 часа] / [Discovery|Документы] / [В наблюдение]', () => {
  const rows = labels('priority', { deal_stage: 'Qualified', sla_status: 'Active' });
  eq(JSON.stringify(rows), JSON.stringify([
    ['✅ Обработано', '⏰ На 24 часа'],
    ['📞 Discovery', '📄 Документы'],
    ['🗂 В наблюдение']
  ]), 'PRIORITY layout');
});

check('D2 FOLLOW-UP has the same set as PRIORITY', () => {
  const p = JSON.stringify(labels('priority', { deal_stage: 'New' }));
  const f = JSON.stringify(labels('followup', { deal_stage: 'New' }));
  eq(f, p, 'FOLLOW-UP layout differs from PRIORITY');
});

check('D2 the action that is already the current state is hidden', () => {
  const disc = labels('priority', { deal_stage: 'Discovery Scheduled' }).flat();
  assert(!disc.includes('📞 Discovery'), 'Discovery offered on a lead already at that stage');
  assert(disc.includes('📄 Документы'), 'Документы was wrongly hidden too');
  const docs = labels('priority', { deal_stage: 'Documents Requested' }).flat();
  assert(!docs.includes('📄 Документы'), 'Документы offered on a lead already at that stage');
  assert(docs.includes('📞 Discovery'), 'Discovery was wrongly hidden too');
});

check('D2 terminal states render NO keyboard at all', () => {
  for (const state of [{ sla_status: 'Done' }, { sla_status: 'Nurture' },
    { deal_stage: 'Nurture' }, { deal_stage: 'Won' },
    { deal_stage: 'Won', sla_status: 'Active' }, { sla_status: 'done' }]) {
    for (const kind of ['new_lead', 'priority', 'followup']) {
      eq(A.keyboard(kind, state, LEAD).length, 0,
        kind + ' rendered a keyboard for a terminal state ' + JSON.stringify(state));
      eq(A.shape(A.keyboard(kind, state, LEAD)), 'NONE', 'shape for ' + JSON.stringify(state));
    }
  }
});

check('D2 a non-terminal lead with an unknown stage still gets the full set', () => {
  // No new taxonomy: anything that is not a listed terminal value is actionable.
  eq(labels('priority', { deal_stage: 'Proposal Sent', sla_status: 'Active' }).flat().length, 5,
    'an unrecognised stage lost its actions');
});

// ══════════════════════════════════════════════ D3 — the layout rule that fixes truncation

console.log('');
console.log('D3 — never more than two buttons in a row');

check('D3 no row anywhere exceeds two buttons', () => {
  const states = [{}, { deal_stage: 'New' }, { deal_stage: 'Qualified' },
    { deal_stage: 'Discovery Scheduled' }, { deal_stage: 'Documents Requested' },
    { deal_stage: 'Proposal Sent', sla_status: 'Snoozed' }];
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const s of states) {
      for (const row of A.keyboard(kind, s, LEAD)) {
        assert(row.length <= 2, kind + ' ' + JSON.stringify(s) + ' produced a row of ' + row.length);
        assert(row.length >= 1, 'an empty row was produced — Telegram rejects it');
      }
    }
  }
});

check('D3 the deployed six-in-a-row keyboard is impossible to produce', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    const rows = A.keyboard(kind, { deal_stage: 'New' }, LEAD);
    assert(rows.every((r) => r.length <= 2), 'a wide row survived');
    assert(rows.flat().length <= 5, kind + ' offers more than five actions');
  }
});

// An n8n Telegram node has a FIXED number of rows and a fixed number of buttons per row, so each
// distinct shape needs its own node. This case exists to tell the renderer authors exactly how
// many nodes to build — and, more importantly, to fail if a future rule introduces a shape no node
// can render, which would silently drop the keyboard.
//
// The state list is DERIVED from every value the rules actually branch on, not hand-picked. An
// earlier version of this case asserted NEW LEAD could only ever be KB22 or NONE, on the reasoning
// that a fresh lead is never at Discovery or Documents. That reasoning was wrong: `Build Merge
// Update` preserves an existing `deal_stage`, so a merged lead can already be at either — and the
// gate caught it rather than the owner discovering a missing keyboard in Telegram.
check('D3 the shapes each renderer must provide, derived from the rules themselves', () => {
  const stages = ['', 'New', 'Qualified', 'Incomplete', 'Proposal Sent',
    'Discovery Scheduled', 'Documents Requested', 'Nurture', 'Won'];
  const slas = ['', 'Active', 'Snoozed', 'Done', 'Nurture'];
  const shapesFor = (kind) => {
    const seen = new Set();
    for (const deal_stage of stages) {
      for (const sla_status of slas) { seen.add(A.shape(A.keyboard(kind, { deal_stage, sla_status }, LEAD))); }
    }
    return [...seen].sort();
  };
  const nl = shapesFor('new_lead');
  const pr = shapesFor('priority');
  const fu = shapesFor('followup');
  console.log('        NEW LEAD  -> ' + nl.join(', '));
  console.log('        PRIORITY  -> ' + pr.join(', '));
  console.log('        FOLLOW-UP -> ' + fu.join(', '));

  eq(JSON.stringify(nl), JSON.stringify(['KB21', 'KB22', 'NONE']), 'NEW LEAD shape set');
  eq(JSON.stringify(pr), JSON.stringify(['KB22', 'KB221', 'NONE']), 'PRIORITY shape set');
  eq(JSON.stringify(fu), JSON.stringify(pr), 'FOLLOW-UP must need the same shapes as PRIORITY');

  // Every shape is renderable: rows within 1..2 buttons, and a row count Telegram accepts.
  for (const s of [...new Set([...nl, ...pr, ...fu])]) {
    if (s === 'NONE') { continue; }
    assert(/^KB[12]{1,3}$/.test(s), 'unrenderable shape: ' + s);
  }
});

// ══════════════════════════════════════════════ D10 — sparse, action-owned updates

console.log('');
console.log('D10 — sparse updates: an action writes only the columns it owns');

const NOW = '2026-09-01T12:30:00.000Z';

check('D10 each action writes exactly the owner-approved column set', () => {
  const want = {
    done: ['lead_id', 'sla_status', 'last_contacted_at'],
    snooze: ['lead_id', 'sla_snooze_until', 'next_follow_up_at'],
    discovery: ['lead_id', 'deal_stage'],
    docs: ['lead_id', 'deal_stage', 'documents_requested_at', 'next_follow_up_at'],
    nurture: ['lead_id', 'deal_stage', 'sla_status']
  };
  for (const [action, cols] of Object.entries(want)) {
    const upd = A.buildUpdate(action, LEAD, NOW);
    eq(JSON.stringify(Object.keys(upd).sort()), JSON.stringify([...cols].sort()),
      action + ' writes the wrong column set');
  }
});

check('D10 no pre-read Pipeline column can leak into an update', () => {
  // The deployed builder copied fifteen columns forward. These must never appear again.
  const forbidden = ['company', 'name', 'email', 'phone', 'telegram', 'priority', 'financial_zone',
    'status', 'next_action', 'owner_note', 'close_reason', 'deal_value_estimate', 'meeting_date',
    'proposal_sent_at', 'created_at', 'request_id', 'utm_source', 'comment', 'responsible'];
  for (const action of ['done', 'snooze', 'discovery', 'docs', 'nurture']) {
    const keys = Object.keys(A.buildUpdate(action, LEAD, NOW));
    for (const f of forbidden) {
      assert(!keys.includes(f), action + ' would overwrite the unrelated column ' + f);
    }
  }
});

check('D10 unrelated columns survive an action, proven by applying it to a full row', () => {
  // Models `Update Pipeline Row`: operation=update, autoMapInputData, matched on lead_id — it
  // writes the keys PRESENT on the item and leaves every other column alone.
  const row = {
    lead_id: LEAD, company: 'Mega Park SRL', name: 'Ion Popescu', email: 'ion@mega.md',
    phone: '', telegram: '@ion', deal_stage: 'Qualified', sla_status: 'Active',
    priority: 'HOT', financial_zone: 'ORANGE', next_action: 'Ответить сегодня',
    owner_note: 'звонил в пятницу', request_id: 'fmr_' + 'a'.repeat(32),
    created_at: '2026-08-30T08:00:00.000Z', next_follow_up_at: '2026-09-01T08:00:00.000Z',
    documents_requested_at: '', last_contacted_at: '', sla_snooze_until: '',
    utm_source: 'newsletter', comment: 'merge 2026-08-30'
  };
  const before = JSON.parse(JSON.stringify(row));
  const upd = A.buildUpdate('done', LEAD, NOW);
  const after = Object.assign({}, row, upd);
  for (const k of Object.keys(before)) {
    if (['sla_status', 'last_contacted_at'].includes(k)) { continue; }
    eq(after[k], before[k], 'done changed the unrelated column ' + k);
  }
  eq(after.sla_status, 'Done', 'done did not close the SLA');
  eq(after.last_contacted_at, NOW, 'done did not stamp last_contacted_at');
});

check('D10 the arithmetic is the measured business action, unchanged', () => {
  eq(A.buildUpdate('snooze', LEAD, NOW).next_follow_up_at, '2026-09-02T12:30:00.000Z', 'snooze +24h');
  eq(A.buildUpdate('snooze', LEAD, NOW).sla_snooze_until, '2026-09-02T12:30:00.000Z', 'snooze until');
  assert(!('sla_status' in A.buildUpdate('snooze', LEAD, NOW)), 'snooze still writes sla_status');
  eq(A.buildUpdate('docs', LEAD, NOW).next_follow_up_at, '2026-09-03T12:30:00.000Z', 'docs +48h');
  eq(A.buildUpdate('discovery', LEAD, NOW).deal_stage, 'Discovery Scheduled', 'discovery stage');
  // D5 — Discovery creates no follow-up and no due date. That is the measured behaviour.
  assert(!('next_follow_up_at' in A.buildUpdate('discovery', LEAD, NOW)), 'discovery invented a follow-up');
  assert(!('meeting_date' in A.buildUpdate('discovery', LEAD, NOW)), 'discovery invented a meeting');
});

check('D10 snooze re-bases from the tap and does not compound', () => {
  const first = A.buildUpdate('snooze', LEAD, '2026-09-01T12:00:00.000Z').next_follow_up_at;
  const second = A.buildUpdate('snooze', LEAD, '2026-09-01T12:05:00.000Z').next_follow_up_at;
  eq(first, '2026-09-02T12:00:00.000Z', 'first snooze');
  eq(second, '2026-09-02T12:05:00.000Z', 'second snooze compounded instead of re-basing');
});

check('D10 the residual race is declared, not claimed away', () => {
  eq(A.RESIDUAL_RACE.prevented, false, 'the module claims a protection the stack cannot provide');
  assert(/last writer wins/.test(A.RESIDUAL_RACE.behaviour), 'the residual behaviour is not stated');
  assert(/NOT affected/.test(A.RESIDUAL_RACE.unrelated_columns), 'the fixed part is not stated');
});

// ══════════════════════════════════════════════ D11 — duplicate and stale taps

console.log('');
console.log('D11 — duplicate, stale and malformed taps');

check('D11 a duplicate tap on an already-applied action performs no write', () => {
  eq(A.refuseReason('done', { sla_status: 'Done' }), 'TERMINAL', 'done on a Done lead');
  eq(A.refuseReason('discovery', { deal_stage: 'Discovery Scheduled' }), 'ALREADY_APPLIED', 'discovery twice');
  eq(A.refuseReason('docs', { deal_stage: 'Documents Requested' }), 'ALREADY_APPLIED', 'docs twice');
  eq(A.refuseReason('nurture', { deal_stage: 'Nurture', sla_status: 'Nurture' }), 'TERMINAL', 'nurture twice');
});

check('D11 a repeated snooze is allowed, because it is a real instruction', () => {
  eq(A.refuseReason('snooze', { sla_status: 'Snoozed', deal_stage: 'Qualified' }), '',
    'a second snooze was refused');
  eq(A.alreadyApplied('snooze', { sla_status: 'Snoozed' }), false, 'snooze treated as idempotent-by-state');
});

check('D11 a tap on an alert whose lead has since gone terminal is refused', () => {
  for (const action of ['done', 'snooze', 'discovery', 'docs', 'nurture']) {
    eq(A.refuseReason(action, { deal_stage: 'Won' }), 'TERMINAL', action + ' after Won');
    eq(A.refuseReason(action, { sla_status: 'Nurture' }), 'TERMINAL', action + ' after Nurture');
  }
});

check('D11 a malformed or unknown callback maps to no action and no update', () => {
  for (const bad of ['', 'bogus', 'DROP TABLE', 'stage']) {
    eq(A.actionOfCommand(bad, ''), '', 'unknown command produced an action: ' + bad);
  }
  eq(A.refuseReason('', { deal_stage: 'New' }), 'UNKNOWN_ACTION', 'unknown action not refused');
  eq(A.buildUpdate('', LEAD, NOW), null, 'an unknown action produced an update');
  eq(A.buildUpdate('won', LEAD, NOW), null, 'won produced an update from this module');
});

check('D11 the legacy stage verb maps to Discovery only for the Discovery target', () => {
  eq(A.actionOfCommand('stage', 'Discovery Scheduled'), 'discovery', 'the deployed discovery callback');
  eq(A.actionOfCommand('stage', 'Proposal Sent'), '', 'an arbitrary stage verb became an action');
});

// ══════════════════════════════════════════════ D4–D7 — the confirmations

console.log('');
console.log('D4–D7 — the owner-facing confirmation');

const CHISINAU = 180;   // Europe/Chisinau, summer. The renderers pass the real offset.

check('D4 snooze shows the resulting local time, not a UTC timestamp', () => {
  const upd = A.buildUpdate('snooze', LEAD, '2026-08-31T12:30:00.000Z');
  const html = A.confirm(LA, 'snooze', 'Mega Park SRL', upd, CHISINAU);
  assert(/Отложено/.test(html), 'the status is not stated');
  assert(/Вернуться к контакту/.test(html), 'the resulting time is not labelled');
  assert(/1 сентября · 15:30/.test(html), 'the local Chisinau time is wrong: ' + html);
  assert(!/2026-09-01T/.test(html), 'a raw UTC timestamp leaked to the owner');
  // Storage stays UTC — only the presentation converts.
  eq(upd.next_follow_up_at, '2026-09-01T12:30:00.000Z', 'storage was converted');
});

check('D5 discovery does NOT claim a meeting was scheduled', () => {
  const html = A.confirm(LA, 'discovery', 'Mega Park SRL', A.buildUpdate('discovery', LEAD, NOW), CHISINAU);
  assert(/Discovery/.test(html), 'the stage is not stated');
  assert(/Встреча не назначена/.test(html), 'the truthful caveat is missing');
  for (const lie of ['Звонок назначен', 'Встреча назначена', 'Discovery Call назначен']) {
    assert(!html.includes(lie), 'the confirmation claims something untrue: ' + lie);
  }
});

check('D6 documents shows the stage and the next contact in local time', () => {
  const upd = A.buildUpdate('docs', LEAD, '2026-08-31T12:30:00.000Z');
  const html = A.confirm(LA, 'docs', 'Mega Park SRL', upd, CHISINAU);
  assert(/Запрошены документы/.test(html), 'the result is not stated');
  assert(/Следующий контакт/.test(html), 'the next contact is not labelled');
  assert(/2 сентября · 15:30/.test(html), 'the +48h local time is wrong: ' + html);
});

check('D7 done says Обработано and does not imply the deal is closed', () => {
  const html = A.confirm(LA, 'done', 'Mega Park SRL', A.buildUpdate('done', LEAD, NOW), CHISINAU);
  assert(/Обработано/.test(html), 'the status is not stated');
  assert(!/Выполнено/.test(html), 'the forbidden wording is present');
  for (const lie of ['Сделка закрыта', 'Сделка выиграна', 'Лид закрыт']) {
    assert(!html.includes(lie), 'the confirmation implies closure: ' + lie);
  }
  assert(/SLA закрыт/.test(html), 'what actually changed is not explained');
});

check('D4–D7 every confirmation is premium, escaped and emoji-free in the body', () => {
  for (const action of ['done', 'snooze', 'discovery', 'docs', 'nurture']) {
    const html = A.confirm(LA, action, '<script>Alfa & Co</script>', A.buildUpdate(action, LEAD, NOW), CHISINAU);
    assert(/^<b>FINMENTOR · /.test(html), action + ': no premium header');
    assert(!/FINMENTOR · FINMENTOR/.test(html), action + ': the FINMENTOR prefix is doubled');
    assert(!/<script>/.test(html), action + ': the company name was not escaped');
    assert(/&lt;script&gt;/.test(html), action + ': escaping did not happen');
    assert(!/[✅⏰📞📄🗂🏆]/.test(html), action + ': an icon leaked into the body');
    assert(!/undefined|NaN|null/.test(html), action + ': a formatting hole is visible');
  }
});

check('D11 the refusals are premium, harmless and leak nothing', () => {
  const applied = A.refusal(LA, 'ALREADY_APPLIED', 'Mega Park SRL');
  assert(/Действие уже применено/.test(applied), 'the already-applied wording is missing');
  const terminal = A.refusal(LA, 'TERMINAL', 'Mega Park SRL');
  assert(/изменения не внесены/i.test(terminal), 'the refusal does not say nothing changed');
  const missing = A.refusal(LA, 'NOT_FOUND', '');
  assert(/не найден/i.test(missing), 'the not-found wording is missing');
  for (const html of [applied, terminal, missing]) {
    assert(!/[✅⏰📞📄🗂]/.test(html), 'an icon leaked into a refusal body');
    assert(!/undefined|NaN/.test(html), 'a formatting hole is visible');
  }
});

// ══════════════════════════════════════════════ editing the original alert

console.log('');
console.log('D8 — rebuilding the alert HTML so the keyboard can be edited without downgrading it');

// n8n's Telegram node has no reply-markup-only edit; `editMessageText` REQUIRES `text`. Telegram
// hands the callback plain text plus entities, so the edit has to rebuild the HTML — and if that
// rebuild is not byte-exact the owner watches a premium alert lose its formatting the moment they
// press a button. These cases prove the round-trip on the REAL renderer output.
//
// `toTelegram` models what Telegram does to an outgoing HTML message: strips the tags, records
// offsets in UTF-16 code units, unescapes entities. It lives in qa/telegram-emulator.js so that the
// live verifier drives the deployed nodes with the SAME emulator this gate proves the round trip
// against — two emulators would let the gate pass on bytes the tenant never sees.

const SAMPLE = {
  'NEW LEAD': LA.renderNewLead({
    company: 'Mega Parc SRL', role: 'Генеральный директор',
    objective: 'Нет своевременной управленческой отчётности',
    situation: 'Retail · Retail · €500 тыс. – €2 млн', priority: 'HOT', zone: 'UNKNOWN',
    nextAction: 'Ответить сегодня / предложить Discovery Call',
    source: 'miniapp_diagnostic', contactChannel: 'telegram', contactValue: '551662084',
    leadId: 'FIN-1788113619104-582'
  }),
  PRIORITY: LA.renderPriority({
    company: 'Alfa & <Grup> SRL', reason: 'Запланированный контакт просрочен.',
    nextAction: 'Ответить сегодня', dueAt: '2026-08-30T09:00:00.000Z',
    now: '2026-09-01T09:00:00.000Z', offsetMinutes: 180, leadId: 'FIN-1'
  }),
  'FOLLOW-UP': LA.renderFollowUp({
    now: '2026-09-01T09:00:00.000Z', offsetMinutes: 180,
    items: [{ company: 'Vinaria Bostavan', action: 'Запросить документы', dueAt: '2026-09-01T12:00:00.000Z', leadId: 'FIN-2' }]
  })
};

check('D8 every real alert survives the text→entities→HTML round-trip byte-identically', () => {
  for (const [name, html] of Object.entries(SAMPLE)) {
    const { text, entities } = toTelegram(html);
    const back = A.htmlFromTelegram(text, entities);
    eq(back, html, name + ' did not round-trip');
    assert(entities.length > 0, name + ' produced no entities — the helper is not exercising anything');
  }
});

check('D8 the round-trip preserves the characters that break naive rebuilds', () => {
  // A company name with & and angle brackets is the classic way a rebuild corrupts a message.
  const html = LA.renderNewLead({
    company: 'Alfa & <Grup> "Co"', role: '', objective: 'a < b & c > d', situation: '',
    priority: 'WARM', zone: 'RED', nextAction: '', source: 'contact',
    contactChannel: 'email', contactValue: 'x@y.md', leadId: 'FIN-3'
  });
  const { text, entities } = toTelegram(html);
  eq(A.htmlFromTelegram(text, entities), html, 'escaping did not survive the round-trip');
  assert(/&amp;/.test(html) && /&lt;/.test(html), 'the fixture did not actually contain escapes');
});

check('D8 nested and adjacent entities nest correctly, and unknown types degrade to plain text', () => {
  const nested = A.htmlFromTelegram('abcdef', [
    { type: 'bold', offset: 0, length: 6 }, { type: 'italic', offset: 2, length: 2 }
  ]);
  eq(nested, '<b>ab<i>cd</i>ef</b>', 'nesting is wrong');
  const adjacent = A.htmlFromTelegram('abcd', [
    { type: 'bold', offset: 0, length: 2 }, { type: 'code', offset: 2, length: 2 }
  ]);
  eq(adjacent, '<b>ab</b><code>cd</code>', 'adjacent entities are wrong');
  // An unrecognised entity must not invent a tag; the text survives unstyled.
  eq(A.htmlFromTelegram('abc', [{ type: 'custom_emoji', offset: 0, length: 3 }]), 'abc',
    'an unknown entity type produced markup');
  eq(A.htmlFromTelegram('a<b', []), 'a&lt;b', 'plain text was not escaped');
});

check('D8 the origin action set is derived from the keyboard, not from callback_data', () => {
  // A NEW LEAD alert never offers «Обработано», so a `done|` button is the discriminator. This is
  // one boolean carried through the callback path — not a new callback vocabulary, and not the
  // whole keyboard.
  eq(A.originKind(false), 'new_lead', 'no done button should mean the NEW LEAD set');
  eq(A.originKind(true), 'priority', 'a done button should mean the PRIORITY/FOLLOW-UP set');
  const nl = A.keyboard('new_lead', { deal_stage: 'Qualified' }, 'FIN-1').flat();
  assert(!nl.some((b) => b.callback_data.startsWith('done|')), 'the NEW LEAD set contains done — the discriminator is invalid');
  const pr = A.keyboard('priority', { deal_stage: 'Qualified' }, 'FIN-1').flat();
  assert(pr.some((b) => b.callback_data.startsWith('done|')), 'the PRIORITY set lacks done — the discriminator is invalid');
});

// ══════════════════════════════════════════════ STAGE 2 — the callback lifecycle

console.log('');
console.log('STAGE 2 — the gates named in requirement 12');

// Pinned fixtures. Each exists because it is a way the reconstruction could plausibly break, and
// the round-trip must hold for every one of them.
const FIXTURES = {
  bold: '<b>Mega Parc SRL</b>',
  code: '<code>FIN-1788113619104-582</code>',
  'mixed Cyrillic/Latin': '<b>Vinaria Bostavan · Кишинёв</b>\nRetail · Розница',
  ampersand: '<b>Alfa &amp; Co</b>\nP&amp;L и cash flow',
  'angle brackets': '<b>Alfa &lt;Grup&gt; SRL</b>\na &lt; b &gt; c',
  'emoji in text': '<b>Mega Parc</b>\n★ приоритет · €500 тыс.',
  'nested entities': '<b>Всё <i>очень</i> срочно</b>',
  'adjacent entities': '<b>abc</b><code>def</code>',
  'no entities at all': 'просто текст без разметки'
};

check('HTML ROUND TRIP — every pinned fixture reproduces byte-identically', () => {
  for (const [name, html] of Object.entries(FIXTURES)) {
    const { text, entities } = toTelegram(html);
    eq(A.htmlFromTelegram(text, entities), html, 'fixture did not round-trip: ' + name);
  }
});

check('TEXT PRESERVATION — the visible characters are untouched by the round-trip', () => {
  for (const [name, html] of Object.entries(FIXTURES)) {
    const before = toTelegram(html);
    const after = toTelegram(A.htmlFromTelegram(before.text, before.entities));
    eq(after.text, before.text, 'visible text changed for: ' + name);
  }
});

check('ENTITY PRESERVATION — offsets, lengths and types survive unchanged', () => {
  for (const [name, html] of Object.entries(FIXTURES)) {
    const before = toTelegram(html);
    const after = toTelegram(A.htmlFromTelegram(before.text, before.entities));
    eq(JSON.stringify(after.entities), JSON.stringify(before.entities), 'entities changed for: ' + name);
  }
});

check('CLIENT TEXT ESCAPING — client-controlled text is escaped before any tag is added', () => {
  eq(A.htmlFromTelegram('<script>alert(1)</script>', []), '&lt;script&gt;alert(1)&lt;/script&gt;', 'raw markup survived');
  eq(A.htmlFromTelegram('a & b', []), 'a &amp; b', 'ampersand not escaped');
  // Escaping happens on the text INSIDE an entity too, not only outside it.
  eq(A.htmlFromTelegram('<b>x', [{ type: 'bold', offset: 0, length: 4 }]), '<b>&lt;b&gt;x</b>', 'text inside an entity was not escaped');
});

check('MALFORMED ENTITY FAIL-SAFE — bad ranges degrade to safe plain text, never to broken markup', () => {
  // Crossing ranges are something Telegram never emits; producing crossed tags would make the
  // edit fail and strand the owner's keyboard, so the whole message degrades to escaped text.
  eq(A.htmlFromTelegram('abcdef', [{ type: 'bold', offset: 0, length: 4 }, { type: 'italic', offset: 2, length: 4 }]),
    'abcdef', 'crossing entities did not fail safe');
  // Out-of-range, negative and zero-length entities are dropped rather than clamped: clamping
  // would silently move formatting onto different characters.
  eq(A.htmlFromTelegram('abc', [{ type: 'bold', offset: 1, length: 99 }]), 'abc', 'overlong range not dropped');
  eq(A.htmlFromTelegram('abc', [{ type: 'bold', offset: -1, length: 2 }]), 'abc', 'negative offset not dropped');
  eq(A.htmlFromTelegram('abc', [{ type: 'bold', offset: 0, length: 0 }]), 'abc', 'zero length not dropped');
  // The fail-safe still escapes. Both ranges are individually VALID here and genuinely cross, so
  // nothing is dropped and the whole message degrades. (An earlier version of this case used an
  // out-of-range entity, which is dropped rather than crossing — it proved the wrong thing.)
  eq(A.htmlFromTelegram('a<bcde', [{ type: 'bold', offset: 0, length: 4 }, { type: 'italic', offset: 2, length: 4 }]),
    'a&lt;bcde', 'the fail-safe did not escape');
  // and a dropped-but-not-crossing entity leaves the remaining valid formatting intact
  eq(A.htmlFromTelegram('a<b', [{ type: 'bold', offset: 0, length: 3 }, { type: 'italic', offset: 1, length: 99 }]),
    '<b>a&lt;b</b>', 'a dropped entity wrongly discarded the valid one');
  assert(A.entitiesCross([{ offset: 0, length: 4 }, { offset: 2, length: 4 }]), 'crossing not detected');
  assert(!A.entitiesCross([{ offset: 0, length: 6 }, { offset: 2, length: 2 }]), 'containment misread as crossing');
});

check('NO HTML RECONSTRUCTION SHORTCUT — Markdown is never produced', () => {
  for (const html of Object.values(FIXTURES)) {
    const { text, entities } = toTelegram(html);
    const out = A.htmlFromTelegram(text, entities);
    assert(!/\*\*|__|\[.*\]\(.*\)/.test(out), 'markdown appeared in the output');
  }
});

check('FRESH READ BEFORE WRITE — every verdict is computed from the row, not from the alert', () => {
  // The same tap, judged against two different fresh rows, must give two different verdicts.
  eq(A.refuseReason('docs', { deal_stage: 'Qualified', sla_status: 'Active' }, 'new_lead'), '', 'allowed on a fresh lead');
  eq(A.refuseReason('docs', { deal_stage: 'Documents Requested' }, 'new_lead'), 'ALREADY_APPLIED', 'already applied');
  eq(A.refuseReason('docs', { deal_stage: 'Won' }, 'new_lead'), 'TERMINAL', 'terminal');
  eq(A.refuseReason('done', { deal_stage: 'Qualified', sla_status: 'Active' }, 'new_lead'), 'STATE_CHANGED',
    'an action outside the current set is not flagged as stale');
});

check('SPARSE UPDATE — requirement 5, field for field', () => {
  const want = {
    discovery: ['lead_id', 'deal_stage'],
    docs: ['lead_id', 'deal_stage', 'documents_requested_at', 'next_follow_up_at'],
    snooze: ['lead_id', 'sla_snooze_until', 'next_follow_up_at'],
    nurture: ['lead_id', 'deal_stage', 'sla_status']
  };
  for (const [action, cols] of Object.entries(want)) {
    eq(JSON.stringify(Object.keys(A.buildUpdate(action, LEAD, NOW)).sort()), JSON.stringify([...cols].sort()),
      action + ' does not match requirement 5');
  }
});

check('POST-WRITE READBACK — a mutation is only successful if the row proves it', () => {
  const upd = A.buildUpdate('docs', LEAD, NOW);
  const good = Object.assign({ company: 'Mega Parc SRL' }, upd);
  eq(A.verifyMutation(upd, good).ok, true, 'a correct row was rejected');
  const partial = Object.assign({}, good, { next_follow_up_at: '' });
  eq(A.verifyMutation(upd, partial).ok, false, 'a partial write was accepted');
  eq(JSON.stringify(A.verifyMutation(upd, partial).mismatched), JSON.stringify(['next_follow_up_at']), 'wrong mismatch');
  eq(A.verifyMutation(upd, {}).ok, false, 'an empty row was accepted');
});

check('UNRELATED FIELD PRESERVATION — proven against the full tracked Pipeline schema', () => {
  const schemaWorkflow = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history', 'LZ2mvKXbBikmeVTn.pre-lead-alerts-presentation.json'), 'utf8'));
  const schemaNode = schemaWorkflow.nodes.find((n) => n.name === 'Update Pipeline SLA');
  const columns = schemaNode.parameters.columns.schema.map((c) => c.id);
  assert(columns.length >= 52, 'the tracked Pipeline schema was unexpectedly narrowed');
  const pre = Object.fromEntries(columns.map((k) => [k, 'unchanged:' + k]));
  Object.assign(pre, { lead_id: LEAD, deal_stage: 'Qualified', sla_status: 'Active' });
  for (const action of ['discovery', 'docs', 'snooze', 'nurture', 'done']) {
    const upd = A.buildUpdate(action, pre.lead_id, NOW);
    const after = Object.assign({}, pre, upd);
    for (const k of A.untouchedFields(action, pre)) {
      eq(after[k], pre[k], action + ' changed the unrelated column ' + k);
    }
    // It is the complete 52-column tracked schema, so this is not a small synthetic happy path.
    assert(A.untouchedFields(action, pre).length > 45, 'the pre-image is too small to prove anything');
  }
});

check('ACK AFTER WRITE — the success copy is a function of the verified update, not of the tap', () => {
  // confirm() takes the update that was written and read back. There is no code path that renders
  // a success message without one.
  const upd = A.buildUpdate('docs', LEAD, '2026-08-31T12:30:00.000Z');
  const html = A.confirm(LA, 'docs', 'Mega Parc SRL', upd, 180);
  assert(/2 сентября · 15:30/.test(html), 'the confirmation does not carry the written value');
  eq(A.confirm(LA, 'docs', 'Mega Parc SRL', { lead_id: LEAD }, 180).includes('undefined'), false,
    'a missing value rendered as undefined');
});

check('CURRENT ACTION REMOVED — after the write, the action just taken is gone', () => {
  for (const [action, post] of [
    ['discovery', { deal_stage: 'Discovery Scheduled', sla_status: 'Active' }],
    ['docs', { deal_stage: 'Documents Requested', sla_status: 'Active' }]
  ]) {
    for (const kind of ['new_lead', 'priority']) {
      const after = A.keyboard(kind, post, LEAD).flat().map((b) => b.action);
      assert(!after.includes(action), kind + ': ' + action + ' survived its own action');
      assert(after.length > 0, kind + ': the keyboard emptied unexpectedly');
    }
  }
});

check('TERMINAL KEYBOARD EMPTY — nurture and done clear the keyboard entirely', () => {
  eq(A.shape(A.keyboard('new_lead', { deal_stage: 'Nurture', sla_status: 'Nurture' }, LEAD)), 'NONE', 'after nurture');
  eq(A.shape(A.keyboard('priority', { deal_stage: 'Qualified', sla_status: 'Done' }, LEAD)), 'NONE', 'after done');
});

check('SNOOZE REBASE — a second snooze re-bases from the second tap and writes no status', () => {
  const a = A.buildUpdate('snooze', LEAD, '2026-09-01T12:00:00.000Z');
  const b = A.buildUpdate('snooze', LEAD, '2026-09-01T12:05:00.000Z');
  eq(a.next_follow_up_at, '2026-09-02T12:00:00.000Z', 'first');
  eq(b.next_follow_up_at, '2026-09-02T12:05:00.000Z', 'second compounded rather than re-based');
  assert(!('sla_status' in b), 'snooze writes sla_status, which requirement 5 excludes');
  eq(A.refuseReason('snooze', { deal_stage: 'Qualified', sla_status: 'Active', sla_snooze_until: a.sla_snooze_until }, 'priority'),
    '', 'a deliberate second snooze was refused');
});

check('DUPLICATE TAP NO WRITE / STALE TAP NO WRITE — the refusals carry no update', () => {
  for (const [reason, row] of [
    ['ALREADY_APPLIED', { deal_stage: 'Documents Requested' }],
    ['TERMINAL', { deal_stage: 'Won' }],
    ['STATE_CHANGED', { deal_stage: 'Qualified', sla_status: 'Active' }]
  ]) {
    const action = reason === 'STATE_CHANGED' ? 'done' : 'docs';
    eq(A.refuseReason(action, row, 'new_lead'), reason, 'wrong reason for ' + reason);
    const copy = A.refusal(LA, reason, 'Mega Parc SRL');
    assert(!/undefined|NaN/.test(copy), reason + ': a formatting hole is visible');
    assert(!/qF9tonlHHIxc8MDd|execution|workflow/i.test(copy), reason + ': internal identifiers leaked');
  }
  assert(/Действие уже применено/.test(A.refusal(LA, 'ALREADY_APPLIED', 'X')), 'duplicate copy');
  assert(/Статус лида уже изменился/.test(A.refusal(LA, 'STATE_CHANGED', 'X')), 'stale copy');
});

check('PRESENTATION FAILURE != BUSINESS FAILURE', () => {
  const upd = A.buildUpdate('docs', LEAD, '2026-08-31T12:30:00.000Z');
  const html = A.presentationFailure(LA, 'docs', 'Mega Parc SRL', upd, 180);
  assert(/Запрошены документы/.test(html), 'the applied action is not reported');
  assert(/Не удалось обновить кнопки/.test(html), 'the presentation failure is not reported');
  assert(!/не удалось применить|изменения не внесены/i.test(html), 'it reads as a business failure');
});

check('MESSAGE-NOT-MODIFIED is only accepted when the keyboard is provably identical', () => {
  const a = A.keyboard('priority', { deal_stage: 'Qualified', sla_status: 'Active' }, LEAD);
  const b = A.keyboard('priority', { deal_stage: 'Qualified', sla_status: 'Active' }, LEAD);
  const c = A.keyboard('priority', { deal_stage: 'Discovery Scheduled', sla_status: 'Active' }, LEAD);
  eq(A.sameKeyboard(a, b), true, 'identical keyboards not recognised');
  eq(A.sameKeyboard(a, c), false, 'different keyboards treated as identical');
  eq(A.sameKeyboard(a, []), false, 'an empty keyboard treated as identical');
});

check('CALLBACK VOCABULARY UNCHANGED — the verbs are exactly the deployed five', () => {
  const verbs = new Set();
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const state of [{ deal_stage: 'New' }, { deal_stage: 'Discovery Scheduled' }, { deal_stage: 'Documents Requested' }]) {
      for (const b of A.keyboard(kind, state, LEAD).flat()) { verbs.add(b.callback_data.split('|')[0]); }
    }
  }
  eq([...verbs].sort().join(','), 'docs,done,nurture,snooze,stage', 'the callback vocabulary changed');
});

// ══════════════════════════════════════════════ the module is one source of truth

console.log('');
console.log('the keyboard and the mutation cannot drift apart');

check('every emitted button maps to an action the handler owns columns for', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const b of A.keyboard(kind, { deal_stage: 'New' }, LEAD).flat()) {
      const parts = b.callback_data.split('|');
      const action = A.actionOfCommand(parts[0], parts[2] || '');
      assert(action !== '', kind + ': ' + b.callback_data + ' maps to no action');
      assert(Object.prototype.hasOwnProperty.call(A.OWNED, action), action + ' owns no columns');
      const upd = A.buildUpdate(action, LEAD, NOW);
      eq(JSON.stringify(Object.keys(upd).filter((k) => k !== 'lead_id').sort()),
        JSON.stringify([...A.OWNED[action]].sort()), action + ': OWNED disagrees with buildUpdate');
    }
  }
});

check('the hidden-action rule and the refusal rule agree', () => {
  // A button hidden because it is already the current state must also be refused if tapped from
  // an older alert. If these two ever disagree, the owner gets a button that does nothing.
  for (const state of [{ deal_stage: 'Discovery Scheduled' }, { deal_stage: 'Documents Requested' }]) {
    const offered = A.keyboard('priority', state, LEAD).flat()
      .map((b) => A.actionOfCommand(b.callback_data.split('|')[0], b.callback_data.split('|')[2] || ''));
    for (const action of ['discovery', 'docs']) {
      const hidden = !offered.includes(action);
      const refused = A.refuseReason(action, state) !== '';
      eq(hidden, refused, action + ' hidden=' + hidden + ' but refused=' + refused
        + ' for ' + JSON.stringify(state));
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('');
  for (const f of failures) { console.log('  FAILED  ' + f); }
  process.exit(1);
}
console.log('');
console.log('  Offline: no tenant, no Telegram, no Sheets, no mutation.');
console.log('');
