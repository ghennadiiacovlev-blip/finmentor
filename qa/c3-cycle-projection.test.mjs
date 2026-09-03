#!/usr/bin/env node
// FINMENTOR — C3.1: the authoritative cycle projection, Concierge side. EXECUTED.
//
//   node qa/c3-cycle-projection.test.mjs
//
// Offline. Drives the SAME pure transforms the deploy script applies to the live Concierge
// (scripts/deploy-c3-concierge-cycle.mjs) against a tracked fixture of the live
// `Get Bot Session (Premium)` node, and RUNS the spliced code. What is asserted is therefore the
// code that ships, not a description of it.
//
// ── THE TWO FACTS THIS GATE HOLDS ──────────────────────────────────────────────────────────────
//
//   1. The premium machine's CONFIRMED rotations are persisted as real cycle resets — a new cycle,
//      a new submission key, the old lead archived — and NOTHING ELSE rotates. Before C3.1 the
//      response node cleared the cycle in its own output and Build Session Row re-attached the
//      old one, so the customer's confirmed "new request" was never persisted.
//
//   2. The projection is written BEFORE the session is persisted, and a failed projection write
//      on a rotation turn ABORTS the turn. The Gateway therefore sees the new cycle or nothing —
//      never the old one after a rotation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  splicePremiumSession, patchConcierge, verifyPatched, GUARD_CODE, projectionNode,
  PREMIUM_SESSION, BUILD_ROW, SAVE_SESSION, PROJECT_NODE, GUARD_NODE, PROJECTION_TABLE
} from '../scripts/deploy-c3-concierge-cycle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const nodeRequire = createRequire(import.meta.url);

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const LIVE_CODE = readFileSync(join(ROOT, 'qa', 'fixtures', 'concierge-get-bot-session-premium.live.js'), 'utf8').replace(/\r\n/g, '\n');
const SPLICED = splicePremiumSession(LIVE_CODE);

const CHAT = '551662084';
const CYCLE = 'C-551662084-1756900000000';
const KEY = 'sub_' + 'a'.repeat(32);

// Run the spliced premium session node exactly as n8n would: $('Parse Telegram Update') for the
// message, $input for the Bot_Sessions row, require('crypto') for the mint.
function runSession(sessionRow, input) {
  const p = Object.assign({ chat_id: CHAT, user_id: CHAT, message_text: '', callback_data: '' }, input || {});
  const $ = (n) => {
    if (n !== 'Parse Telegram Update') { throw new Error("$('" + n + "') not provided"); }
    return { first: () => ({ json: p }) };
  };
  const $input = { all: () => [{ json: sessionRow }], first: () => ({ json: sessionRow }) };
  return new Function('$', '$input', 'require', SPLICED)($, $input, nodeRequire)[0].json;
}

const committed = (over) => Object.assign({
  chat_id: CHAT, user_id: CHAT, cycle_id: CYCLE, lead_id: 'FIN-1', lead_cycle_id: CYCLE, lead_sent_at: '2026-09-01T00:00:00.000Z',
  lead_intake_ok: 'true', submission_key: KEY, consent: 'yes', consent_cycle_id: CYCLE, consent_at: '2026-09-01T00:00:00.000Z',
  state: 'TG_SUBMITTED', status: 'active', draft_state: '', draft_step: '', context_extracted_json: '{"x":1}', context_confirmed: 'true', append_text: 'later'
}, over || {});
const drafting = (over) => Object.assign(committed(), {
  lead_id: '', lead_cycle_id: '', lead_sent_at: '', lead_intake_ok: '', consent: '', consent_cycle_id: '', consent_at: '',
  state: 'TG_OPEN_BRIEF', draft_state: 'draft', draft_step: 'objective'
}, over || {});

console.log('C3.1 — Concierge cycle projection (executed)');
console.log('');

// ── 1. the splice itself ───────────────────────────────────────────────────────────────────────

check('the splice applies to the tracked live node exactly once and still parses', () => {
  assert(SPLICED !== LIVE_CODE, 'nothing changed');
  assert(SPLICED.indexOf('isPremiumRotate') !== -1, 'the premium rotation is missing');
  eq((SPLICED.match(/isPremiumRotate/g) || []).length, 2, 'the premium rotation flag is declared and read exactly once each');
  new Function('$', '$input', 'require', SPLICED);
  let again = null;
  try { splicePremiumSession(SPLICED); } catch (e) { again = e; }
  assert(again, 'a second splice was accepted');
  // and the live fixture is what the builder said it would be: the /start reset neutered
  assert(/if \(false\) \{ reset = 'start'; \}/.test(LIVE_CODE), 'the fixture is not the premium node (the /start reset is live)');
  assert(/mintSubmissionKey/.test(LIVE_CODE), 'the fixture predates the P7.2 issuer');
});

// ── 2. the confirmed rotations persist ─────────────────────────────────────────────────────────

check('«Начать новый вопрос» CONFIRMED on a committed cycle: a new cycle, a new key, the lead archived', () => {
  const s = runSession(committed(), { callback_data: 'p|new_y' });
  eq(s.cycle_reset, 'restart', 'not a reset');
  assert(s.cycle_id !== CYCLE && /^C-551662084-\d+$/.test(s.cycle_id), 'no new cycle: ' + s.cycle_id);
  eq(s.lead_id, '', 'the lead was not cleared');
  eq(s.lead_cycle_id, '', 'lead_cycle_id');
  assert(String(s.previous_lead_id).indexOf('FIN-1') !== -1, 'the old lead was not archived');
  eq(s.consent, '', 'consent from the old cycle survived');
  eq(s.__submission_key_action, 'MINT', 'no fresh submission key was minted with the new cycle');
  assert(/^sub_[0-9a-f]{32}$/.test(s.submission_key) && s.submission_key !== KEY, 'the key did not move with the cycle');
  eq(s.__submission_key_preallocate, true, 'the receipt preallocation was not requested');
  // the premium draft columns belong to the cycle
  for (const k of ['draft_state', 'draft_step', 'context_extracted_json', 'context_confirmed', 'append_text']) {
    eq(String(s[k] || ''), '', k + ' survived the rotation');
  }
});

check('the confirmed discard of an UNCOMMITTED cycle rotates and archives nothing', () => {
  const s = runSession(drafting(), { callback_data: 'p|restart_y' });
  eq(s.cycle_reset, 'restart', 'not a reset');
  assert(s.cycle_id !== CYCLE, 'no new cycle');
  eq(String(s.previous_lead_id || ''), '', 'a lead was archived that did not exist');
  eq(s.__submission_key_action, 'MINT', 'no fresh key');
  eq(s.draft_state, '', 'the draft marker survived');
});

check('a DUPLICATE tap does not rotate twice', () => {
  const first = runSession(committed(), { callback_data: 'p|new_y' });
  const second = runSession(first, { callback_data: 'p|new_y' });
  eq(second.cycle_reset, '', 'the duplicate tap rotated again');
  eq(second.cycle_id, first.cycle_id, 'the cycle moved on the duplicate tap');
  eq(second.__submission_key_action, 'CARRY', 'a second key was minted');
  eq(second.submission_key, first.submission_key, 'the key changed on the duplicate tap');
});

check('NOTHING ELSE rotates: /start, /menu, the unconfirmed taps, appends, free text, stray callbacks', () => {
  const inputs = [
    { message_text: '/start' }, { message_text: '/menu' }, { message_text: 'hello' },
    { callback_data: 'p|new' }, { callback_data: 'p|restart' }, { callback_data: 'p|append' }, { callback_data: 'p|back' },
    { callback_data: 'p|open' }, { callback_data: 'p|resume' }, { callback_data: 'p|describe' }, { callback_data: 'p|brief' },
    { callback_data: 'p|ctx_ok' }, { callback_data: 'p|ctx_fix' }, { callback_data: 'p|retry' },
    // the confirmed actions on the WRONG kind of cycle
    { callback_data: 'p|restart_y', _row: committed() },
    { callback_data: 'p|new_y', _row: drafting() }
  ];
  for (const i of inputs) {
    const row = i._row || committed();
    const s = runSession(row, i);
    eq(s.cycle_reset, '', JSON.stringify(i.message_text || i.callback_data) + ' rotated the cycle');
    eq(s.cycle_id, CYCLE, JSON.stringify(i.message_text || i.callback_data) + ' changed the cycle');
    eq(s.lead_id, row.lead_id, JSON.stringify(i.message_text || i.callback_data) + ' touched the lead');
  }
});

check('the legacy m|diag restart and the no-cycle bootstrap are unchanged', () => {
  const r = runSession(committed(), { callback_data: 'm|diag' });
  eq(r.cycle_reset, 'restart', 'm|diag on a finished cycle no longer restarts');
  const b = runSession(committed({ cycle_id: '', lead_id: '', lead_cycle_id: '', consent: '', submission_key: '' }), { message_text: 'hi' });
  eq(b.cycle_reset, 'bootstrap', 'a session with no cycle no longer bootstraps one');
  assert(/^C-551662084-\d+$/.test(b.cycle_id), 'no cycle minted on bootstrap');
  // and the neutered /start stays neutered
  eq(runSession(committed(), { message_text: '/start' }).cycle_reset, '', '/start resets again');
});

check('a rotation on a session with NO cycle is not a premium rotation (there is nothing to rotate from)', () => {
  const s = runSession(committed({ cycle_id: '', lead_id: '', lead_cycle_id: '' }), { callback_data: 'p|restart_y' });
  eq(s.cycle_reset, 'bootstrap', 'a no-cycle session should bootstrap, not restart');
});

// ── 3. the projection write and its guard ──────────────────────────────────────────────────────

function runGuard(inputItem, sessionRow, premiumOut) {
  const $ = (n) => {
    if (n === BUILD_ROW) { return { first: () => ({ json: sessionRow }) }; }
    if (n === PREMIUM_SESSION) { return { isExecuted: true, first: () => ({ json: premiumOut }) }; }
    throw new Error("$('" + n + "') not provided");
  };
  const $input = { first: () => ({ json: inputItem }), all: () => [{ json: inputItem }] };
  return new Function('$', '$input', 'require', GUARD_CODE)($, $input, nodeRequire)[0].json;
}

check('the guard re-emits the session row UNCHANGED on a successful projection write', () => {
  const row = { chat_id: CHAT, cycle_id: CYCLE, state: 'TG_ENTRY', notes: 'n' };
  const out = runGuard({ id: 1, telegram_user_id: CHAT, cycle_id: CYCLE }, row, { cycle_reset: 'restart' });
  eq(JSON.stringify(out), JSON.stringify(row), 'the row was altered');
});

check('a FAILED projection write on a ROTATION turn aborts the turn — the rotation is not persisted', () => {
  const row = { chat_id: CHAT, cycle_id: 'C-551662084-2' };
  let err = null;
  try { runGuard({ error: { message: 'store down' } }, row, { cycle_reset: 'restart' }); } catch (e) { err = e; }
  assert(err && /CYCLE_PROJECTION_FAILED/.test(err.message), 'the turn continued to Save Bot Session with a stale projection');
  assert(/store down/.test(err.message), 'the cause is not carried');
  // the bootstrap mint is a rotation too
  err = null;
  try { runGuard({ errorMessage: 'x' }, row, { cycle_reset: 'bootstrap' }); } catch (e) { err = e; }
  assert(err, 'a failed projection on a bootstrap mint was tolerated');
});

check('a FAILED projection write on an ordinary turn is tolerated — the cycle did not move', () => {
  const row = { chat_id: CHAT, cycle_id: CYCLE };
  const out = runGuard({ error: { message: 'store down' } }, row, { cycle_reset: '' });
  eq(JSON.stringify(out), JSON.stringify(row), 'the row was altered');
});

check('the projection node is an upsert keyed by the Telegram user, on the projection table, with the error output routed', () => {
  const n = projectionNode([0, 0]);
  eq(n.type, 'n8n-nodes-base.dataTable', 'type');
  eq(n.parameters.operation, 'upsert', 'not an upsert');
  eq(n.parameters.dataTableId.value, PROJECTION_TABLE, 'table');
  eq(n.parameters.filters.conditions[0].keyName, 'telegram_user_id', 'match key');
  eq(Object.keys(n.parameters.columns.value).sort().join(','), 'cycle_id,cycle_reset,projected_at,telegram_user_id', 'columns');
  eq(n.onError, 'continueErrorOutput', 'the error output is not routed');
  assert(!n.alwaysOutputData, 'the P9-R2 flag pair');
  assert(!n.credentials, 'a credential on the projection write');
});

// ── 4. the graph patch ─────────────────────────────────────────────────────────────────────────

function fixtureLive() {
  return {
    name: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED',
    nodes: [
      { id: 'a', name: 'Find Session', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: 'return [];' } },
      { id: 'b', name: PREMIUM_SESSION, type: 'n8n-nodes-base.code', typeVersion: 2, position: [100, 0], parameters: { jsCode: LIVE_CODE } },
      { id: 'c', name: 'Get Bot Session', type: 'n8n-nodes-base.code', typeVersion: 2, position: [100, 100], parameters: { jsCode: 'return [];' } },
      { id: 'd', name: BUILD_ROW, type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: 'return [];' } },
      { id: 'e', name: SAVE_SESSION, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [300, 0], parameters: { operation: 'appendOrUpdate' }, credentials: { googleSheetsOAuth2Api: { id: 'x', name: 'Google Sheets OAuth2 API' } }, onError: 'continueRegularOutput' },
      { id: 'f', name: 'IF Authority Write OK', type: 'n8n-nodes-base.if', typeVersion: 2, position: [400, 0], parameters: {} }
    ],
    connections: {
      'Find Session': { main: [[{ node: PREMIUM_SESSION, type: 'main', index: 0 }]] },
      [BUILD_ROW]: { main: [[{ node: SAVE_SESSION, type: 'main', index: 0 }]] },
      [SAVE_SESSION]: { main: [[{ node: 'IF Authority Write OK', type: 'main', index: 0 }]] }
    },
    settings: { executionOrder: 'v1', errorWorkflow: 'RBiFLhVjizMkAzrK' }
  };
}

check('the patch changes EXACTLY the premium session node, adds the two nodes, and splits ONE edge', () => {
  const live = fixtureLive();
  const patched = patchConcierge(live);
  const f = verifyPatched(live, patched);
  eq(f.join(' | '), '', 'verification');
  eq(patched.connections[BUILD_ROW].main[0][0].node, PROJECT_NODE, BUILD_ROW + ' edge');
  eq(patched.connections[PROJECT_NODE].main[0][0].node, GUARD_NODE, 'success output');
  eq(patched.connections[PROJECT_NODE].main[1][0].node, GUARD_NODE, 'error output');
  eq(patched.connections[GUARD_NODE].main[0][0].node, SAVE_SESSION, 'guard edge');
  eq(JSON.stringify(patched.connections[SAVE_SESSION]), JSON.stringify(live.connections[SAVE_SESSION]), 'downstream edge moved');
  // ORDER: the projection is written before the session; the session write cannot be reached
  // from Build Session Row without passing the projection and the guard.
  const path = [];
  let cur = BUILD_ROW;
  while (cur && path.length < 6) { path.push(cur); cur = ((patched.connections[cur] || {}).main || [[]])[0][0] && patched.connections[cur].main[0][0].node; }
  eq(path.slice(0, 4).join(' -> '), [BUILD_ROW, PROJECT_NODE, GUARD_NODE, SAVE_SESSION].join(' -> '), 'write order');
});

check('the patch REFUSES an unexpected graph and a second application', () => {
  const live = fixtureLive();
  live.connections[BUILD_ROW] = { main: [[{ node: 'IF Authority Write OK', type: 'main', index: 0 }]] };
  let err = null;
  try { patchConcierge(live); } catch (e) { err = e; }
  assert(err && /expected form/.test(err.message), 'an unexpected graph was spliced');
  const once = patchConcierge(fixtureLive());
  err = null;
  try { patchConcierge(once); } catch (e) { err = e; }
  assert(err, 'the patch applied twice');
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
