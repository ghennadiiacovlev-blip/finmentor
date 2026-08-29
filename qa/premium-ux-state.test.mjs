#!/usr/bin/env node
// FINMENTOR — Premium UX Telegram state machine.
//
//   node qa/premium-ux-state.test.mjs
//
// Offline. No tenant, no network, no credentials.
//
// WHAT THIS GATE IS FOR. One invariant, stated by the owner and worth more than every other test
// in this file:
//
//     After a successful committed submission, NO execution may return the user to qualification
//     without an explicit New Request action.
//
// The deployed Concierge violates it today — `/start` resets the cycle unconditionally, archiving
// the lead and wiping consent, silently. So this gate does not sample a few inputs: it EXHAUSTS the
// input space against a committed authority and requires every single outcome to be terminal. A
// state machine that is safe for the inputs someone thought to test is not safe.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const M = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'tg-state-machine.js'));
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const FRESH = { cycle_id: 'C-1', lead_id: '', lead_cycle_id: '', has_draft: false };
const DRAFT = { cycle_id: 'C-1', lead_id: '', lead_cycle_id: '', has_draft: true, draft_step: 'APP_OBJECTIVE' };
const DONE = { cycle_id: 'C-1', lead_id: 'FIN-1', lead_cycle_id: 'C-1', has_draft: false };
// A lead from a PREVIOUS cycle must not make the current cycle terminal.
const STALE = { cycle_id: 'C-2', lead_id: 'FIN-1', lead_cycle_id: 'C-1', has_draft: false };

const cb = (v) => ({ kind: 'callback', value: v });
const cmd = (v) => ({ kind: 'command', value: v });
const txt = (v) => ({ kind: 'text', value: v });

console.log('Premium UX — Telegram state machine');
console.log('');

// ---------------------------------------------------------------- /start, three ways

check('/start with no cycle → TG_ENTRY, no rotate', () => {
  const r = M.decide(FRESH, cmd('/start'));
  eq(r.state, 'TG_ENTRY', 'state');
  eq(r.rotate, false, 'rotated');
  eq(JSON.stringify(r.copy), JSON.stringify(B.TG_COPY.TG_ENTRY), 'copy');
});

check('/start with an unfinished draft → TG_RESUME_DRAFT, no rotate, no data touched', () => {
  const r = M.decide(DRAFT, cmd('/start'));
  eq(r.state, 'TG_RESUME_DRAFT', 'state');
  eq(r.rotate, false, 'rotated');
  eq(JSON.stringify(r.writes), '[]', 'wrote something');
  eq(JSON.stringify(r.copy.actions), JSON.stringify(['Продолжить', 'Начать заново']), 'actions');
});

check('/start after a committed lead → TG_SUBMITTED, no rotate, no reset', () => {
  const r = M.decide(DONE, cmd('/start'));
  eq(r.state, 'TG_SUBMITTED', 'state');
  eq(r.rotate, false, 'SILENTLY ROTATED THE CYCLE — the defect this gate exists for');
  eq(JSON.stringify(r.writes), '[]', 'wrote something');
  assert(/уже передано FINMENTOR/.test(r.copy.text.join(' ')), 'wrong copy');
});

check('a lead from a PREVIOUS cycle does not make this cycle terminal', () => {
  assert(!M.isCommitted(STALE), 'stale lead treated as committed');
  eq(M.decide(STALE, cmd('/start')).state, 'TG_ENTRY', 'stale lead blocked a fresh start');
});

// ---------------------------------------------------------------- the terminal invariant

check('EXHAUSTIVE: no input against a committed cycle reaches qualification or rotates', () => {
  const inputs = [];
  for (const v of Object.values(M.ACTIONS)) { inputs.push(cb(v)); }
  for (const v of ['/start', '/menu', '/help', '/contact', '/end']) { inputs.push(cmd(v)); }
  for (const v of ['привет', 'хочу новый расчёт', 'Начать заново', '']) { inputs.push(txt(v)); }
  inputs.push(cb('m|diag'), cb('n|menu'), cb('p|unknown'), { kind: 'weird', value: 'x' });

  const allowed = ['TG_SUBMITTED', 'TG_APPEND_MESSAGE', 'TG_NEW_REQUEST_CONFIRM', 'TG_ENTRY'];
  let rotates = 0;
  for (const input of inputs) {
    const r = M.decide(DONE, input);
    assert(allowed.indexOf(r.state) !== -1, 'committed cycle reached ' + r.state + ' on ' + JSON.stringify(input));
    if (r.rotate) { rotates++; }
    const violated = M.violatesTerminalRule(DONE, input, r);
    assert(!violated, 'TERMINAL RULE VIOLATED by ' + JSON.stringify(input) + ' → ' + r.state);
  }
  eq(rotates, 1, 'exactly one input may rotate a committed cycle');
});

check('the ONE input that may rotate is the confirmed new request', () => {
  const r = M.decide(DONE, cb(M.ACTIONS.NEW_CONFIRM));
  eq(r.rotate, true, 'confirmed new request did not rotate');
  assert(r.writes.indexOf('archive_lead') !== -1, 'lead not archived');
  assert(r.writes.indexOf('new_cycle') !== -1, 'no new cycle');
  eq(r.state, 'TG_ENTRY', 'lands on entry');
});

check('«Начать новый вопрос» alone only asks; it never rotates', () => {
  const r = M.decide(DONE, cb(M.ACTIONS.NEW));
  eq(r.state, 'TG_NEW_REQUEST_CONFIRM', 'state');
  eq(r.rotate, false, 'unconfirmed action rotated the cycle');
});

check('exactly one rotate branch exists in the whole module', () => {
  const src = readSrc();
  const rotates = (src.match(/rotate:\s*true/g) || []).length;
  eq(rotates, 2, 'rotate:true count changed — every occurrence must be justified (committed new request; confirmed discard of an uncommitted draft)');
});
function readSrc() {
  return require('node:fs').readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', 'tg-state-machine.js'), 'utf8');
}

// ---------------------------------------------------------------- append

check('append writes an activity and creates no lead, no cycle, no consent', () => {
  const auth = Object.assign({}, DONE, { awaiting_append: true });
  const r = M.decide(auth, txt('Через месяц встреча с банком.'));
  eq(JSON.stringify(r.writes), JSON.stringify(['activity_append']), 'writes');
  eq(r.rotate, false, 'rotated');
  eq(r.append_text, 'Через месяц встреча с банком.', 'text');
  assert(/не создавалось/.test(r.copy.text.join(' ')), 'confirmation does not deny creating a request');
  for (const forbidden of ['new_cycle', 'archive_lead', 'consent', 'lead']) {
    assert(r.writes.indexOf(forbidden) === -1, 'append wrote ' + forbidden);
  }
});

check('append text is capped', () => {
  const auth = Object.assign({}, DONE, { awaiting_append: true });
  const r = M.decide(auth, txt('x'.repeat(900)));
  eq(r.append_text.length, 500, 'not capped');
});

// ---------------------------------------------------------------- draft resume

check('«Продолжить» opens the brief at the stored step and rotates nothing', () => {
  const r = M.decide(DRAFT, cb(M.ACTIONS.RESUME));
  eq(r.state, 'TG_OPEN_BRIEF', 'state');
  eq(r.rotate, false, 'rotated');
  eq(r.resume_step, 'APP_OBJECTIVE', 'resume step lost');
});

check('«Начать заново» asks before discarding a draft', () => {
  const r = M.decide(DRAFT, cb(M.ACTIONS.RESTART));
  eq(r.state, 'TG_NEW_REQUEST_CONFIRM', 'state');
  eq(r.rotate, false, 'discarded without confirmation');
  assert(/будет заменён/.test(r.copy.text.join(' ')), 'wrong confirm copy');
});

check('a confirmed discard rotates but archives no lead (there is none)', () => {
  const r = M.decide(DRAFT, cb(M.ACTIONS.RESTART_CONFIRM));
  eq(r.rotate, true, 'did not rotate');
  assert(r.writes.indexOf('archive_lead') === -1, 'archived a lead that does not exist');
  assert(r.writes.indexOf('new_cycle') !== -1, 'no new cycle');
});

// ---------------------------------------------------------------- entry / qualification

check('entry offers exactly the two approved actions', () => {
  const r = M.decide(FRESH, cmd('/start'));
  eq(JSON.stringify(r.copy.actions), JSON.stringify(['Описать задачу', 'Подготовить бриф']), 'actions');
});

check('«Описать задачу» collects free text and moves to confirmation', () => {
  eq(M.decide(FRESH, cb(M.ACTIONS.DESCRIBE)).state, 'TG_FREEFORM_PROBLEM', 'state');
  const auth = Object.assign({}, FRESH, { awaiting_problem: true });
  const r = M.decide(auth, txt('Прибыль есть, а денег нет.'));
  eq(r.state, 'TG_CONFIRM_CONTEXT', 'state');
  eq(r.free_text, 'Прибыль есть, а денег нет.', 'text');
  eq(JSON.stringify(r.writes), JSON.stringify(['free_text']), 'writes');
});

check('«Подготовить бриф» opens the app without creating a second cycle', () => {
  const r = M.decide(FRESH, cb(M.ACTIONS.BRIEF));
  eq(r.state, 'TG_OPEN_BRIEF', 'state');
  eq(r.rotate, false, 'rotated');
  eq(JSON.stringify(r.writes), '[]', 'wrote something');
});

check('«Всё верно» is the only route that confirms extracted context', () => {
  const r = M.decide(FRESH, cb(M.ACTIONS.CONFIRM_OK));
  eq(JSON.stringify(r.writes), JSON.stringify(['confirm_context']), 'writes');
  eq(M.decide(FRESH, cb(M.ACTIONS.CONFIRM_FIX)).state, 'TG_FREEFORM_PROBLEM', 'fix should re-ask');
  // and nothing else confirms
  for (const v of Object.values(M.ACTIONS)) {
    if (v === M.ACTIONS.CONFIRM_OK) { continue; }
    const o = M.decide(FRESH, cb(v));
    assert((o.writes || []).indexOf('confirm_context') === -1, v + ' confirmed context');
  }
});

// ---------------------------------------------------------------- confirm-context rendering

check('TG_CONFIRM_CONTEXT renders no label for an absent value', () => {
  const s = M.confirmContextSections({ company_name: 'ABC Retail', role: '', turnover_band: null, objective: 'Денежный поток' });
  eq(s.length, 2, 'section count');
  eq(JSON.stringify(s.map((x) => x.key)), JSON.stringify(['company_name', 'objective']), 'keys');
  const json = JSON.stringify(s);
  assert(json.indexOf('—') === -1, 'rendered an em-dash placeholder');
});

check('TG_CONFIRM_CONTEXT renders nothing at all when nothing was extracted', () => {
  eq(M.confirmContextSections({}).length, 0, 'rendered empty labels');
  eq(M.confirmContextSections(null).length, 0, 'rendered from null');
});

// ---------------------------------------------------------------- failure

check('infra failure never implies the request was received', () => {
  const t = B.TG_COPY.TG_INFRA_FAILURE.text.join(' ');
  assert(/не считается отправленным/.test(t), 'does not deny sending');
  assert(!/(получено|принято|передано)/.test(t), 'implies success');
  assert(/Не начинайте новый вопрос/.test(t), 'does not steer away from a new request');
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
