#!/usr/bin/env node
// FINMENTOR — C3.2: the Concierge adopts the Mini App commit of the current cycle. EXECUTED.
//
//   node qa/c3-cycle-commit-adoption.test.mjs
//
// Offline. Drives the pure transform the deploy script applies to the live Concierge
// (scripts/deploy-c3-concierge-commit.mjs), RUNS the adoption code, and then feeds its output
// through the two consumers that decide the customer's screen and the cycle:
//
//   * the C3.1-spliced `Get Bot Session (Premium)` (tracked live fixture + the C3.1 splice),
//     which must now rotate on p|new_y — the rotation that was unreachable live;
//   * n8n/src/premium-ux/tg-state-machine.js `decide`, the module the response node is
//     generated from, which must now render TG_SUBMITTED with «Начать новый вопрос».
//
// ── THE LIVE DEFECT THIS GATE HOLDS CLOSED (2026-09-03) ────────────────────────────────────────
//
// A brief submitted through the Mini App committed the cycle in MiniApp_App_Sessions only.
// Bot_Sessions still said lead_id '' → isCommitted false → the terminal screen never rendered →
// «Начать новый вопрос» never appeared → the only rotate (p|new_y) was unreachable, while
// «Открыть бриф» kept resolving the same (correctly authoritative) submitted cycle.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { splicePremiumSession } from '../scripts/deploy-c3-concierge-cycle.mjs';
import {
  patchConciergeCommit, verifyCommitPatch, readNode, adoptNode, ADOPT_CODE, READ_KEY_EXPR,
  OWNER_GATE, FIND_SESSION, PREMIUM_SESSION, READ_NODE, ADOPT_NODE, SESSIONS_TABLE
} from '../scripts/deploy-c3-concierge-commit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const nodeRequire = createRequire(import.meta.url);
const SM = nodeRequire(join(ROOT, 'n8n', 'src', 'premium-ux', 'tg-state-machine.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const LIVE_CODE = readFileSync(join(ROOT, 'qa', 'fixtures', 'concierge-get-bot-session-premium.live.js'), 'utf8').replace(/\r\n/g, '\n');
const GATE_CODE = splicePremiumSession(LIVE_CODE);

const USER = '551662084';
const CYCLE = 'C-551662084-1787947744615';
const LEAD = 'FIN-1788113619104-582';
const KEY = 'sub_' + 'b'.repeat(32);

// The live owner row on 2026-09-03 17:56 UTC, as Cycle Projection Guard emitted it: a submitted
// cycle that Bot_Sessions does not know is submitted.
const liveRow = (over) => Object.assign({
  session_id: 'S-551662084-1787628873105', chat_id: USER, user_id: USER, username: 'x', first_name: 'I', last_name: 'G', language: 'ru',
  state: 'TG_CONFIRM_CONTEXT', status: 'active', consent: '', consent_cycle_id: '', consent_at: '',
  lead_id: '', lead_cycle_id: '', lead_sent_at: '', lead_intake_ok: '', previous_lead_id: 'TG-551662084-1787629189806',
  cycle_id: CYCLE, submission_key: KEY, free_text_request: 'Компания сталкивается с финансовыми трудностями',
  draft_state: '', draft_step: '', context_extracted_json: '', context_confirmed: '', append_text: ''
}, over || {});

// The live MiniApp_App_Sessions rows of that user: the legacy row (cycle '') and the submitted one.
const appRows = () => [
  { id: 1, app_session_id: 'AS-' + '1'.repeat(64), telegram_user_id: USER, cycle_id: '', state: 'submitted', lead_id: LEAD, updated_at: '2026-08-30T18:13:41.955Z' },
  { id: 2, app_session_id: 'AS-' + '2'.repeat(64), telegram_user_id: USER, cycle_id: CYCLE, state: 'submitted', lead_id: LEAD, updated_at: '2026-09-03T17:40:14.400Z' }
];

function runAdopt(base, items) {
  const $ = (n) => {
    if (n !== FIND_SESSION) { throw new Error("$('" + n + "') not provided"); }
    return { first: () => ({ json: base }) };
  };
  const $input = { all: () => items.map((j) => ({ json: j })), first: () => ({ json: items[0] }) };
  return new Function('$', '$input', 'require', ADOPT_CODE)($, $input, nodeRequire)[0].json;
}

function runGate(sessionRow, input) {
  const p = Object.assign({ chat_id: USER, user_id: USER, message_text: '', callback_data: '' }, input || {});
  const $ = (n) => {
    if (n !== 'Parse Telegram Update') { throw new Error("$('" + n + "') not provided"); }
    return { first: () => ({ json: p }) };
  };
  const $input = { all: () => [{ json: sessionRow }], first: () => ({ json: sessionRow }) };
  return new Function('$', '$input', 'require', GATE_CODE)($, $input, nodeRequire)[0].json;
}

// The auth snapshot exactly as the generated response node builds it from the gate's output.
const authOf = (s) => ({
  cycle_id: String(s.cycle_id || ''), lead_id: String(s.lead_id || ''), lead_cycle_id: String(s.lead_cycle_id || ''),
  has_draft: String(s.draft_state || '') === 'draft', draft_step: String(s.draft_step || ''), context_extracted: {},
  awaiting_problem: String(s.state || '') === 'TG_FREEFORM_PROBLEM', awaiting_append: String(s.state || '') === 'TG_APPEND_MESSAGE'
});

console.log('C3.2 — Concierge adopts the Mini App commit (executed)');
console.log('');

// ── 1. the adoption itself ─────────────────────────────────────────────────────────────────────

check('the LIVE defect row: the submitted app session of the CURRENT cycle is adopted as the committed lead', () => {
  const s = runAdopt(liveRow(), appRows());
  eq(s.__cycle_commit_adoption, 'ADOPTED', 'not adopted');
  eq(s.lead_id, LEAD, 'lead_id');
  eq(s.lead_cycle_id, CYCLE, 'lead_cycle_id');
  eq(s.lead_sent_at, '2026-09-03T17:40:14.400Z', 'lead_sent_at should be the commit time');
  eq(s.cycle_id, CYCLE, 'the cycle moved');
  eq(s.submission_key, KEY, 'the key moved');
  eq(s.state, 'TG_CONFIRM_CONTEXT', 'the persisted state was rewritten by the adoption (the machine decides that)');
  eq(s.free_text_request, liveRow().free_text_request, 'unrelated columns were touched');
});

check('NOTHING is adopted from: another user, another cycle, a draft, a submitted row without a lead, the legacy row', () => {
  const cases = [
    ['another user', { telegram_user_id: '999', cycle_id: CYCLE, state: 'submitted', lead_id: LEAD }],
    ['another cycle', { telegram_user_id: USER, cycle_id: 'C-551662084-1', state: 'submitted', lead_id: LEAD }],
    ['a draft', { telegram_user_id: USER, cycle_id: CYCLE, state: 'draft', lead_id: '' }],
    ['a draft carrying a stray lead', { telegram_user_id: USER, cycle_id: CYCLE, state: 'draft', lead_id: LEAD }],
    ['submitted without a lead', { telegram_user_id: USER, cycle_id: CYCLE, state: 'submitted', lead_id: '' }],
    ['the legacy row', { telegram_user_id: USER, cycle_id: '', state: 'submitted', lead_id: LEAD }],
    ['a row with no app_session_id', { app_session_id: '', telegram_user_id: USER, cycle_id: CYCLE, state: 'submitted', lead_id: LEAD }]
  ];
  for (const [label, row] of cases) {
    const r = Object.assign({ id: 9, app_session_id: 'AS-' + '9'.repeat(64), updated_at: '2026-09-03T00:00:00.000Z' }, row);
    const s = runAdopt(liveRow(), [r]);
    eq(s.__cycle_commit_adoption, 'NOT_SUBMITTED', label + ' was adopted');
    eq(s.lead_id, '', label + ' set a lead');
    eq(s.lead_cycle_id, '', label + ' set a lead cycle');
  }
});

check('a store OUTAGE, an ABSENT row (alwaysOutputData empty item) and a NO-CYCLE session pass the row through unchanged', () => {
  const base = liveRow();
  const outage = runAdopt(base, [{ error: { message: 'store down' } }]);
  eq(outage.__cycle_commit_adoption, 'STORE_ERROR', 'outage');
  eq(outage.lead_id, '', 'an outage adopted a lead');
  const errMsg = runAdopt(base, [{ errorMessage: 'x' }, appRows()[1]]);
  eq(errMsg.__cycle_commit_adoption, 'STORE_ERROR', 'a partial outage adopted');
  const absent = runAdopt(base, [{}]);
  eq(absent.__cycle_commit_adoption, 'NOT_SUBMITTED', 'absent');
  eq(absent.lead_id, '', 'absent adopted a lead');
  const noCycle = runAdopt(liveRow({ cycle_id: '' }), appRows());
  eq(noCycle.__cycle_commit_adoption, 'NO_CYCLE', 'no cycle');
  eq(noCycle.lead_id, '', 'a no-cycle session adopted a lead');
  // and the pass-through is byte-faithful apart from the annotation
  const strip = (o) => { const c = Object.assign({}, o); delete c.__cycle_commit_adoption; return JSON.stringify(c); };
  eq(strip(outage), JSON.stringify(base), 'the outage pass-through altered the row');
  eq(strip(absent), JSON.stringify(base), 'the absent pass-through altered the row');
});

check('a row that ALREADY carries a lead for this cycle is left alone (the sheet wins over the read model)', () => {
  const s = runAdopt(liveRow({ lead_id: 'FIN-OTHER', lead_cycle_id: CYCLE, lead_sent_at: 't0' }), appRows());
  eq(s.__cycle_commit_adoption, 'ALREADY_COMMITTED', 'adoption state');
  eq(s.lead_id, 'FIN-OTHER', 'the persisted lead was overwritten');
  eq(s.lead_sent_at, 't0', 'lead_sent_at overwritten');
});

check('a persisted lead from ANOTHER cycle does not block the adoption of this cycle\'s commit', () => {
  const s = runAdopt(liveRow({ lead_id: 'FIN-OLD', lead_cycle_id: 'C-551662084-1' }), appRows());
  eq(s.__cycle_commit_adoption, 'ADOPTED', 'adoption state');
  eq(s.lead_id, LEAD, 'lead_id');
  eq(s.lead_cycle_id, CYCLE, 'lead_cycle_id');
});

check('two submitted rows for the same cycle: the most recently updated wins, deterministically', () => {
  const rows = appRows().concat([{ id: 3, app_session_id: 'AS-' + '3'.repeat(64), telegram_user_id: USER, cycle_id: CYCLE, state: 'submitted', lead_id: 'FIN-NEWER', updated_at: '2026-09-03T18:00:00.000Z' }]);
  eq(runAdopt(liveRow(), rows).lead_id, 'FIN-NEWER', 'newest commit');
  eq(runAdopt(liveRow(), rows.slice().reverse()).lead_id, 'FIN-NEWER', 'order-dependent');
});

// ── 2. the consumers: the rotation becomes reachable, the terminal screen renders ──────────────

check('END TO END — adopted row → cycle gate: p|new_y ROTATES (new cycle, higher sequence, new key, old lead archived)', () => {
  const adopted = runAdopt(liveRow(), appRows());
  const s = runGate(adopted, { callback_data: 'p|new_y' });
  eq(s.cycle_reset, 'restart', 'the rotation did not happen');
  assert(/^C-551662084-\d+$/.test(s.cycle_id) && s.cycle_id !== CYCLE, 'no new cycle: ' + s.cycle_id);
  assert(BigInt(s.cycle_id.split('-').pop()) > BigInt(CYCLE.split('-').pop()), 'the new sequence is not higher');
  eq(s.lead_id, '', 'the lead was not cleared on the new cycle');
  assert(String(s.previous_lead_id).indexOf(LEAD) !== -1, 'the old lead was not archived');
  eq(s.__submission_key_action, 'MINT', 'no fresh submission key');
  assert(s.submission_key !== KEY, 'the key did not move with the cycle');
  eq(s.__submission_key_preallocate, true, 'no receipt preallocation');
  eq(s.state, 'MENU', 'the reset state');
});

check('CONTROL — the SAME row WITHOUT adoption does not rotate on p|new_y (this is the live defect, reproduced)', () => {
  const s = runGate(liveRow(), { callback_data: 'p|new_y' });
  eq(s.cycle_reset, '', 'rotated without a committed lead');
  eq(s.cycle_id, CYCLE, 'the cycle moved');
});

check('END TO END — adopted row → decide(): /start, a free text and «Открыть бриф» all land on TG_SUBMITTED with «Начать новый вопрос»', () => {
  const auth = authOf(runAdopt(liveRow(), appRows()));
  assert(SM.isCommitted(auth), 'the adopted snapshot is not committed');
  for (const input of [{ kind: 'command', value: '/start' }, { kind: 'text', value: 'ещё одна проблема' }, { kind: 'callback', value: 'p|open' }, { kind: 'callback', value: 'p|describe' }]) {
    const out = SM.decide(auth, input);
    eq(out.state, 'TG_SUBMITTED', JSON.stringify(input) + ' did not land on the terminal screen');
    assert((out.copy.actions || []).indexOf('Начать новый вопрос') !== -1, JSON.stringify(input) + ' does not offer «Начать новый вопрос»');
    eq(out.rotate, false, JSON.stringify(input) + ' rotated');
  }
  // the explicit path: «Начать новый вопрос» → confirmation → confirmed → THE rotate
  const confirm = SM.decide(auth, { kind: 'callback', value: 'p|new' });
  eq(confirm.state, 'TG_NEW_REQUEST_CONFIRM', 'no confirmation screen');
  const rotate = SM.decide(auth, { kind: 'callback', value: 'p|new_y' });
  eq(rotate.rotate, true, 'the confirmed action did not rotate');
  eq(rotate.state, 'TG_ENTRY', 'the new cycle does not start at entry');
});

check('CONTROL — the un-adopted live row lands a free text on qualification (the defect the owner saw)', () => {
  const auth = authOf(liveRow({ state: 'TG_FREEFORM_PROBLEM' }));
  assert(!SM.isCommitted(auth), 'the live row is committed without adoption');
  eq(SM.decide(auth, { kind: 'text', value: 'Компания сталкивается с финансовыми трудностями' }).state, 'TG_CONFIRM_CONTEXT', 'the defect no longer reproduces from the fixture');
});

check('AFTER the rotation the next turn adopts nothing (the new cycle has no submitted session) and a duplicate tap cannot rotate again', () => {
  const rotated = runGate(runAdopt(liveRow(), appRows()), { callback_data: 'p|new_y' });
  // Bot_Sessions now holds the new cycle with no lead; the app sessions are unchanged
  const nextBase = liveRow({ cycle_id: rotated.cycle_id, lead_id: '', lead_cycle_id: '', previous_lead_id: rotated.previous_lead_id, submission_key: rotated.submission_key, state: 'TG_ENTRY' });
  const next = runAdopt(nextBase, appRows());
  eq(next.__cycle_commit_adoption, 'NOT_SUBMITTED', 'the old commit was adopted onto the new cycle');
  eq(next.lead_id, '', 'a lead leaked into the new cycle');
  const dup = runGate(next, { callback_data: 'p|new_y' });
  eq(dup.cycle_reset, '', 'a duplicate tap rotated again');
  eq(dup.cycle_id, rotated.cycle_id, 'the cycle moved on the duplicate tap');
  assert(!SM.isCommitted(authOf(next)), 'the new cycle is committed');
  eq(SM.decide(authOf(next), { kind: 'command', value: '/start' }).state, 'TG_ENTRY', 'the new cycle does not start fresh');
});

// ── 3. the splice ──────────────────────────────────────────────────────────────────────────────

function fixtureGraph() {
  return {
    name: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED',
    settings: { executionOrder: 'v1', errorWorkflow: 'RBiFLhVjizMkAzrK' },
    nodes: [
      { name: 'Parse Telegram Update', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: '' } },
      { name: 'Read Bot Sessions', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, position: [0, 0], parameters: {}, credentials: { googleSheetsOAuth2Api: { id: 'g', name: 'g' } } },
      { name: FIND_SESSION, type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: '' } },
      { name: OWNER_GATE, type: 'n8n-nodes-base.if', typeVersion: 2, position: [0, 0], parameters: {} },
      { name: PREMIUM_SESSION, type: 'n8n-nodes-base.code', typeVersion: 2, position: [100, 100], parameters: { jsCode: GATE_CODE } },
      { name: 'Get Bot Session', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: LIVE_CODE } },
      { name: 'Save Bot Session', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, position: [0, 0], parameters: {}, credentials: { googleSheetsOAuth2Api: { id: 'g', name: 'g' } } }
    ],
    connections: {
      'Parse Telegram Update': { main: [[{ node: 'Read Bot Sessions', type: 'main', index: 0 }]] },
      'Read Bot Sessions': { main: [[{ node: FIND_SESSION, type: 'main', index: 0 }]] },
      [FIND_SESSION]: { main: [[{ node: OWNER_GATE, type: 'main', index: 0 }]] },
      [OWNER_GATE]: { main: [[{ node: PREMIUM_SESSION, type: 'main', index: 0 }], [{ node: 'Get Bot Session', type: 'main', index: 0 }]] }
    }
  };
}

check('the splice adds exactly the two nodes on the PREMIUM branch, moves one edge, keeps the legacy branch, adds no credential and no Sheets node', () => {
  const live = fixtureGraph();
  const patched = patchConciergeCommit(live);
  const f = verifyCommitPatch(live, patched);
  eq(f.length, 0, 'refused: ' + f.join(' | '));
  eq(patched.nodes.length, live.nodes.length + 2, 'node count');
  eq(patched.connections[OWNER_GATE].main[0][0].node, READ_NODE, 'premium branch');
  eq(patched.connections[OWNER_GATE].main[1][0].node, 'Get Bot Session', 'legacy branch');
  eq(patched.connections[READ_NODE].main[0][0].node, ADOPT_NODE, 'read -> adopt');
  eq(patched.connections[ADOPT_NODE].main[0][0].node, PREMIUM_SESSION, 'adopt -> gate');
  eq(JSON.stringify(live), JSON.stringify(fixtureGraph()), 'the live object was mutated');
});

check('the splice REFUSES a graph that is not the C3.1 Concierge, and refuses to apply twice', () => {
  const noC31 = fixtureGraph();
  noC31.nodes.find((n) => n.name === PREMIUM_SESSION).parameters.jsCode = LIVE_CODE;
  let err = null;
  try { patchConciergeCommit(noC31); } catch (e) { err = e; }
  assert(err && /deploy C3\.1 first/.test(err.message), 'a pre-C3.1 gate was spliced');
  const twice = patchConciergeCommit(fixtureGraph());
  err = null;
  try { patchConciergeCommit(twice); } catch (e) { err = e; }
  assert(err && /already exist/.test(err.message), 'a second splice was accepted');
  const wrongEdge = fixtureGraph();
  wrongEdge.connections[OWNER_GATE].main[0].push({ node: 'Get Bot Session', type: 'main', index: 0 });
  err = null;
  try { patchConciergeCommit(wrongEdge); } catch (e) { err = e; }
  assert(err && /expected form/.test(err.message), 'an unexpected premium edge was spliced blindly');
});

check('the verifier catches a moved legacy branch, a credential, a Sheets node, and the P9-R2 flag pair', () => {
  const live = fixtureGraph();
  const good = patchConciergeCommit(live);
  const moved = JSON.parse(JSON.stringify(good));
  moved.connections[OWNER_GATE].main[1] = [{ node: READ_NODE, type: 'main', index: 0 }];
  assert(verifyCommitPatch(live, moved).some((x) => /legacy/.test(x)), 'a moved legacy branch passed');
  const cred = JSON.parse(JSON.stringify(good));
  cred.nodes.find((n) => n.name === READ_NODE).credentials = { x: { id: '1', name: '1' } };
  assert(verifyCommitPatch(live, cred).some((x) => /credential/.test(x)), 'a new credential passed');
  const sheets = JSON.parse(JSON.stringify(good));
  sheets.nodes.find((n) => n.name === READ_NODE).type = 'n8n-nodes-base.googleSheets';
  assert(verifyCommitPatch(live, sheets).some((x) => /Sheets authority|not a read/.test(x)), 'a Sheets read passed');
  const pair = JSON.parse(JSON.stringify(good));
  pair.nodes.find((n) => n.name === READ_NODE).onError = 'continueErrorOutput';
  assert(verifyCommitPatch(live, pair).some((x) => /P9-R2/.test(x)), 'the flag pair passed');
});

check('the read node reads MiniApp_App_Sessions by the Telegram user of the session row, fail-open on outage, never silent on absence', () => {
  const n = readNode([0, 0]);
  eq(n.type, 'n8n-nodes-base.dataTable', 'type');
  eq(n.parameters.operation, 'get', 'operation');
  eq(n.parameters.dataTableId.value, SESSIONS_TABLE, 'table');
  eq(n.parameters.returnAll, true, 'returnAll — a second submitted row must be visible');
  eq(n.parameters.filters.conditions.length, 1, 'one filter');
  eq(n.parameters.filters.conditions[0].keyName, 'telegram_user_id', 'filter column');
  eq(n.parameters.filters.conditions[0].keyValue, READ_KEY_EXPR, 'filter value');
  assert(READ_KEY_EXPR.indexOf("$('" + FIND_SESSION + "')") !== -1 && /user_id/.test(READ_KEY_EXPR) && /chat_id/.test(READ_KEY_EXPR), 'the user binding is not user_id-else-chat_id from ' + FIND_SESSION);
  eq(n.alwaysOutputData, true, 'alwaysOutputData');
  eq(n.onError, 'continueRegularOutput', 'onError');
  assert(!n.credentials, 'a credential');
  const a = adoptNode([0, 0]);
  eq(a.type, 'n8n-nodes-base.code', 'adopt type');
  eq(a.parameters.jsCode, ADOPT_CODE, 'adopt code');
  new Function('$', '$input', 'require', ADOPT_CODE);
});

console.log('');
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' failed');
  for (const f of failures) { console.log('  - ' + f); }
  process.exit(1);
}
console.log(pass + ' passed, 0 failed');
