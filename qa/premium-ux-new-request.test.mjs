#!/usr/bin/env node
// FINMENTOR — the new-request path, and the one action allowed to rotate a cycle.
//
//   node qa/premium-ux-new-request.test.mjs
//
// THE DEFECT THIS PINS. «Начать новый вопрос» appears on three screens. The label -> action map was
// global, so on TG_NEW_REQUEST_CONFIRM the primary button carried `p|new` — the action that OPENS
// the confirmation. Tapping it re-rendered the same screen, forever. `p|new_y`, the only rotate in
// the machine, was bound to «Да, начать новый вопрос», which no screen renders: from Telegram a
// client could never start a new question.
//
// Driven through the BUILT node body, because the defect was in the adapter's keyboard builder and
// not in the state machine — a test against `decide()` alone passes while the product is broken.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const M = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'tg-state-machine.js'));

const wf = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json'), 'utf8'));
const body = wf.nodes.find((n) => n.name === 'Build Bot Response (Premium)').parameters.jsCode;
const runner = new Function('$input', body);
const run = (src) => runner({ first: () => ({ json: src }) })[0].json;

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ' — ' + e.message); console.log('  FAIL  ' + name + ' — ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const CHAT = '777000';
const CYCLE = 'CY-2026-08-30-abcdef';
const LEAD = 'LEAD-000123';
const committed = (e) => Object.assign({
  chat_id: CHAT, cycle_id: CYCLE, lead_id: LEAD, lead_cycle_id: CYCLE, state: 'TG_SUBMITTED'
}, e || {});
const buttons = (r) => (r.reply_markup.inline_keyboard || []).map((row) => [row[0].text, row[0].callback_data]);
// A rotation is observable in the session the node hands on: the lead is archived and the cycle
// cleared for the issuer to re-mint. Asserted on the OUTPUT, not on a flag we could mis-read.
const rotated = (r) => String(r.session.cycle_id || '') === '' && String(r.session.lead_id || '') === '';

console.log('Premium UX — the new-request path');
console.log('');

// ---------------------------------------------------------------- the three actions

check('the three actions are distinct and named as the machine defines them', () => {
  eq(M.ACTIONS.NEW, 'p|new', 'open action');
  eq(M.ACTIONS.NEW_CONFIRM, 'p|new_y', 'confirm action');
  eq(M.ACTIONS.BACK, 'p|back', 'cancel action');
  assert(M.ACTIONS.NEW !== M.ACTIONS.NEW_CONFIRM, 'open and confirm are the same action');
});

check('the confirmation screen\'s primary button invokes the CONFIRM action', () => {
  const r = run({ session: committed(), callback_data: 'p|new' });
  eq(r.debug.state_after, 'TG_NEW_REQUEST_CONFIRM', 'state');
  eq(JSON.stringify(buttons(r)), JSON.stringify([
    ['Начать новый вопрос', 'p|new_y'],
    ['Вернуться', 'p|back']
  ]), 'the confirmation buttons');
});

check('the same label on the screens that OPEN the confirmation still opens it', () => {
  const submitted = run({ session: committed(), message_text: '/start' });
  const appendDone = run({ session: committed({ state: 'TG_APPEND_MESSAGE' }), message_text: 'Ещё деталь.' });
  for (const [name, r] of [['TG_SUBMITTED', submitted], ['TG_APPEND_MESSAGE.done', appendDone]]) {
    const b = buttons(r).find((x) => x[0] === 'Начать новый вопрос');
    assert(b, name + ' lost the new-request button');
    eq(b[1], 'p|new', name + ' must OPEN the confirmation, not confirm it');
  }
});

check('the discard confirmation is untouched — it reuses the state id but not the label', () => {
  const drafting = { chat_id: CHAT, cycle_id: CYCLE, lead_id: '', lead_cycle_id: '', draft_state: 'draft', draft_step: 'objective', state: 'TG_ENTRY' };
  const r = run({ session: drafting, callback_data: 'p|restart' });
  eq(JSON.stringify(buttons(r)), JSON.stringify([
    ['Начать новое', 'p|restart_y'],
    ['Вернуться', 'p|back']
  ]), 'the discard confirmation buttons changed');
});

// ---------------------------------------------------------------- rotation invariants

check('committed + /start: no rotation', () => {
  const r = run({ session: committed(), message_text: '/start' });
  eq(r.debug.state_after, 'TG_SUBMITTED', 'state');
  assert(!rotated(r), 'a cycle was rotated by /start');
  eq(r.session.lead_id, LEAD, 'the committed lead was disturbed');
});

check('committed + opening the confirmation: no rotation', () => {
  const r = run({ session: committed(), callback_data: 'p|new' });
  assert(!rotated(r), 'opening the confirmation rotated the cycle');
  eq(r.session.lead_id, LEAD, 'the committed lead was disturbed');
});

check('confirmation + Вернуться: no rotation, committed request unchanged', () => {
  const r = run({ session: committed({ state: 'TG_NEW_REQUEST_CONFIRM' }), callback_data: 'p|back' });
  eq(r.debug.state_after, 'TG_SUBMITTED', 'state');
  assert(!rotated(r), 'cancelling rotated the cycle');
  eq(r.session.lead_id, LEAD, 'lead_id changed');
  eq(r.session.cycle_id, CYCLE, 'cycle_id changed');
});

check('confirmation + Начать новый вопрос: exactly one rotation, old lead archived', () => {
  const r = run({ session: committed({ state: 'TG_NEW_REQUEST_CONFIRM' }), callback_data: 'p|new_y' });
  eq(r.debug.state_after, 'TG_ENTRY', 'state');
  assert(rotated(r), 'the confirmed action did NOT rotate the cycle');
  eq(r.session.archived_lead_id, LEAD, 'the old lead was not archived');
  eq(String(r.session.draft_state || ''), '', 'the draft was not cleared');
  eq(String(r.session.context_extracted_json || ''), '', 'stale extracted context survived the rotation');
});

check('a second identical tap does not rotate again', () => {
  // After the first rotation the session is no longer committed and carries no cycle. A duplicate
  // callback — a double tap, or Telegram redelivering — must not rotate again.
  //
  // `archived_lead_id` is the WRONG thing to assert on: the first rotation writes it and every
  // later response carries it forward, so a test that reads it reports a second archive that never
  // happened. `debug.rotate` and `debug.writes` are what the node actually decided this turn.
  const first = run({ session: committed({ state: 'TG_NEW_REQUEST_CONFIRM' }), callback_data: 'p|new_y' });
  eq(first.debug.rotate, true, 'the first tap did not rotate');
  eq(first.debug.writes, 'archive_lead,new_cycle', 'the first tap wrote something else');

  const second = run({ session: Object.assign({}, first.session, { state: first.debug.state_after }), callback_data: 'p|new_y' });
  eq(second.debug.rotate, false, 'the duplicate tap rotated a second time');
  eq(String(second.debug.writes || ''), '', 'the duplicate tap wrote: ' + second.debug.writes);
  eq(second.session.archived_lead_id, first.session.archived_lead_id, 'the duplicate tap archived a different lead');
});

check('no other callback rotates the cycle', () => {
  const ACTIONS = ['p|describe', 'p|brief', 'p|ctx_ok', 'p|ctx_fix', 'p|open', 'p|resume',
    'p|restart', 'p|append', 'p|new', 'p|back', 'p|retry', 'p|bogus'];
  for (const a of ACTIONS) {
    const r = run({ session: committed(), callback_data: a });
    assert(!rotated(r), a + ' rotated the cycle from a committed session');
    eq(r.session.lead_id, LEAD, a + ' disturbed the committed lead');
  }
  // And on an UNCOMMITTED draft, only the confirmed discard rotates.
  const drafting = { chat_id: CHAT, cycle_id: CYCLE, lead_id: '', lead_cycle_id: '', draft_state: 'draft', draft_step: 'objective', state: 'TG_ENTRY' };
  for (const a of ACTIONS) {
    const r = run({ session: Object.assign({}, drafting), callback_data: a });
    assert(!rotated(r), a + ' rotated an uncommitted cycle');
  }
  const discard = run({ session: Object.assign({}, drafting), callback_data: 'p|restart_y' });
  assert(rotated(discard), 'the confirmed discard did not rotate');
  assert(!discard.session.archived_lead_id, 'the discard archived a lead that does not exist');
});

check('rotation alone creates no lead and asks for no privacy acknowledgement', () => {
  const r = run({ session: committed({ state: 'TG_NEW_REQUEST_CONFIRM' }), callback_data: 'p|new_y' });
  // `lead_ready` is what tells the spine to call Lead Intake. Starting a new question is not a
  // submission, so nothing downstream may fire until the client actually submits one.
  assert(r.lead_ready !== true, 'rotation set lead_ready — Lead Intake would be called');
  const j = JSON.stringify(r);
  for (const k of ['privacy_ack', 'privacy_acknowledged', 'consent']) {
    assert(j.indexOf('"' + k + '":true') === -1, 'rotation recorded ' + k);
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
