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
//
//   3. (C3) The projection is ONE IMMUTABLE ROW PER (user, cycle), keyed by authority_key and
//      carrying the numeric cycle_sequence, so a stale turn can only touch its own row and can
//      never overwrite a newer authoritative cycle. The live v1 graph upgrades in place.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  splicePremiumSession, patchConcierge, verifyPatched, upgradeConcierge, verifyUpgraded, GUARD_CODE, projectionInputNode, projectionNode, guardNode,
  PREMIUM_SESSION, BUILD_ROW, SAVE_SESSION, PREP_NODE, PROJECT_NODE, GUARD_NODE, PROJECTION_TABLE
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

function runGuard(inputItem, sessionRow, premiumOut, prepOut) {
  const $ = (n) => {
    if (n === BUILD_ROW) { return { first: () => ({ json: sessionRow }) }; }
    if (n === PREMIUM_SESSION) { return { isExecuted: true, first: () => ({ json: premiumOut }) }; }
    if (n === PREP_NODE) { return { first: () => ({ json: prepOut || { projection_invalid: 0 } }) }; }
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

check('a FAILED projection write on an ordinary turn is tolerated — the cycle did not move, its row already exists', () => {
  const row = { chat_id: CHAT, cycle_id: CYCLE };
  const out = runGuard({ error: { message: 'store down' } }, row, { cycle_reset: '' });
  eq(JSON.stringify(out), JSON.stringify(row), 'the row was altered');
});

check('an UNPROJECTABLE cycle aborts a rotation turn and is tolerated on an ordinary turn', () => {
  const row = { chat_id: CHAT, cycle_id: 'garbage' };
  let err = null;
  try { runGuard({ id: 1 }, row, { cycle_reset: 'restart' }, { projection_invalid: 1 }); } catch (e) { err = e; }
  assert(err && /CYCLE_PROJECTION_FAILED/.test(err.message) && /not projectable/.test(err.message), 'a rotation to an unprojectable cycle was persisted');
  const out = runGuard({ id: 1 }, row, { cycle_reset: '' }, { projection_invalid: 1 });
  eq(JSON.stringify(out), JSON.stringify(row), 'an ordinary turn on a legacy cycle was aborted');
});

check('the projection input creates one immutable user+cycle authority key', () => {
  const n = projectionInputNode([0, 0]);
  const row = { chat_id: CHAT, user_id: CHAT, cycle_id: 'C-' + CHAT + '-42' };
  const $ = (name) => {
    if (name === BUILD_ROW) return { first: () => ({ json: row }) };
    if (name === PREMIUM_SESSION) return { isExecuted: true, first: () => ({ json: { cycle_id: row.cycle_id, cycle_reset: 'restart' } }) };
    throw new Error("$('" + name + "') not provided");
  };
  const out = new Function('$', n.parameters.jsCode)($)[0].json;
  eq(out.authority_key, CHAT + '|' + row.cycle_id, 'authority key');
  eq(out.cycle_sequence, '42', 'cycle sequence');
  eq(out.telegram_user_id, CHAT, 'user binding');
  eq(out.cycle_id, row.cycle_id, 'cycle binding');
  eq(out.projection_invalid, 0, 'a valid cycle marked invalid');
  eq(out.cycle_reset, 'restart', 'the rotation marker is not carried');
  // a cycle minted for ANOTHER user, or a legacy shape, never becomes an authority row
  const bad = (cycle) => {
    const $$ = (name) => name === BUILD_ROW ? { first: () => ({ json: { chat_id: CHAT, user_id: CHAT, cycle_id: cycle } }) } : { isExecuted: true, first: () => ({ json: { cycle_id: cycle, cycle_reset: '' } }) };
    return new Function('$', n.parameters.jsCode)($$)[0].json;
  };
  for (const cycle of ['C-999-42', 'garbage', '', 'C-' + CHAT + '-x', "C-" + CHAT + "-1' or 1=1"]) {
    const o = bad(cycle);
    eq(o.projection_invalid, 1, JSON.stringify(cycle) + ' was projected');
    eq(o.cycle_id, '', JSON.stringify(cycle) + ' carried a cycle');
    eq(o.authority_key, CHAT + '|LEGACY', JSON.stringify(cycle) + ' minted an authority key');
  }
  // and a session row with no user is an exception: nothing can be keyed
  let err = null;
  try { new Function('$', n.parameters.jsCode)((name) => name === BUILD_ROW ? { first: () => ({ json: { cycle_id: row.cycle_id } }) } : { isExecuted: true, first: () => ({ json: {} }) }); } catch (e) { err = e; }
  assert(err && /CYCLE_PROJECTION_INVALID/.test(err.message), 'a user-less row was projected');
});

check('MONOTONIC — a stale turn can only touch its own row: two cycles project to two keys, and the older key never carries the newer cycle', () => {
  const n = projectionInputNode([0, 0]);
  const run = (cycle) => {
    const $$ = (name) => name === BUILD_ROW ? { first: () => ({ json: { chat_id: CHAT, user_id: CHAT, cycle_id: cycle } }) } : { isExecuted: true, first: () => ({ json: { cycle_id: cycle, cycle_reset: '' } }) };
    return new Function('$', n.parameters.jsCode)($$)[0].json;
  };
  const older = run('C-' + CHAT + '-1756900000000');
  const newer = run('C-' + CHAT + '-1756900001000');
  assert(older.authority_key !== newer.authority_key, 'two cycles share one row key — a stale turn could overwrite the newer cycle');
  assert(BigInt(newer.cycle_sequence) > BigInt(older.cycle_sequence), 'the sequence is not monotonic');
  // the upsert matches on THAT key, so the older turn's write lands on the older row only
  eq(projectionNode([0, 0]).parameters.filters.conditions[0].keyValue, '={{ $json.authority_key }}', 'the upsert does not match on the authority key');
});

check('the projection node is an upsert keyed by immutable user+cycle authority, with the error output routed', () => {
  const n = projectionNode([0, 0]);
  eq(n.type, 'n8n-nodes-base.dataTable', 'type');
  eq(n.parameters.operation, 'upsert', 'not an upsert');
  eq(n.parameters.dataTableId.value, PROJECTION_TABLE, 'table');
  eq(n.parameters.filters.conditions[0].keyName, 'authority_key', 'match key');
  eq(Object.keys(n.parameters.columns.value).sort().join(','), 'authority_key,cycle_id,cycle_reset,cycle_sequence,projected_at,telegram_user_id', 'columns');
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

check('the patch changes EXACTLY the premium session node, adds three authority nodes, and splits ONE edge', () => {
  const live = fixtureLive();
  const patched = patchConcierge(live);
  const f = verifyPatched(live, patched);
  eq(f.join(' | '), '', 'verification');
  eq(patched.connections[BUILD_ROW].main[0][0].node, PREP_NODE, BUILD_ROW + ' edge');
  eq(patched.connections[PREP_NODE].main[0][0].node, PROJECT_NODE, 'prepare edge');
  eq(patched.connections[PROJECT_NODE].main[0][0].node, GUARD_NODE, 'success output');
  eq(patched.connections[PROJECT_NODE].main[1][0].node, GUARD_NODE, 'error output');
  eq(patched.connections[GUARD_NODE].main[0][0].node, SAVE_SESSION, 'guard edge');
  eq(JSON.stringify(patched.connections[SAVE_SESSION]), JSON.stringify(live.connections[SAVE_SESSION]), 'downstream edge moved');
  // ORDER: the projection is written before the session; the session write cannot be reached
  // from Build Session Row without passing the projection and the guard.
  const path = [];
  let cur = BUILD_ROW;
  while (cur && path.length < 6) { path.push(cur); cur = ((patched.connections[cur] || {}).main || [[]])[0][0] && patched.connections[cur].main[0][0].node; }
  eq(path.slice(0, 5).join(' -> '), [BUILD_ROW, PREP_NODE, PROJECT_NODE, GUARD_NODE, SAVE_SESSION].join(' -> '), 'write order');
});

check('UPGRADE — the live v1 graph (one row per user) converts in place: Prepare inserted, Project Cycle re-keyed, guard rewritten, nothing else', () => {
  // the v1 form: the premium node already spliced, the old pair already in the chain
  const v1 = fixtureLive();
  v1.nodes.find((n) => n.name === PREMIUM_SESSION).parameters.jsCode = SPLICED;
  v1.nodes.push({ id: 'p1', name: PROJECT_NODE, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position: [400, 160], onError: 'continueErrorOutput',
    parameters: { resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'name', value: PROJECTION_TABLE }, matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'telegram_user_id', condition: 'eq', keyValue: '={{ String($json.user_id || $json.chat_id || "") }}' }] },
      columns: { mappingMode: 'defineBelow', matchingColumns: [], value: { telegram_user_id: '', cycle_id: '', cycle_reset: '', projected_at: '' }, schema: [] }, options: {} } });
  v1.nodes.push({ id: 'g1', name: GUARD_NODE, type: 'n8n-nodes-base.code', typeVersion: 2, position: [600, 160], parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: '// v1 guard\nreturn [{ json: $("Build Session Row").first().json }];' } });
  v1.connections[BUILD_ROW] = { main: [[{ node: PROJECT_NODE, type: 'main', index: 0 }]] };
  v1.connections[PROJECT_NODE] = { main: [[{ node: GUARD_NODE, type: 'main', index: 0 }], [{ node: GUARD_NODE, type: 'main', index: 0 }]] };
  v1.connections[GUARD_NODE] = { main: [[{ node: SAVE_SESSION, type: 'main', index: 0 }]] };

  const up = upgradeConcierge(v1);
  eq(verifyUpgraded(v1, up).join(' | '), '', 'verification');
  const path = [];
  let cur = BUILD_ROW;
  while (cur && path.length < 6) { path.push(cur); cur = ((up.connections[cur] || {}).main || [[]])[0][0] && up.connections[cur].main[0][0].node; }
  eq(path.slice(0, 5).join(' -> '), [BUILD_ROW, PREP_NODE, PROJECT_NODE, GUARD_NODE, SAVE_SESSION].join(' -> '), 'write order');
  const proj = up.nodes.find((n) => n.name === PROJECT_NODE);
  eq(proj.id, 'p1', 'the live node identity was not kept');
  eq(JSON.stringify(proj.parameters), JSON.stringify(projectionNode([0, 0]).parameters), 'the projection parameters are not the tracked ones');
  eq(up.nodes.find((n) => n.name === GUARD_NODE).parameters.jsCode, GUARD_CODE, 'the guard was not rewritten');
  eq(up.nodes.find((n) => n.name === PREMIUM_SESSION).parameters.jsCode, SPLICED, 'the premium node was touched');
  // refusals: not v1, already upgraded, unspliced premium node
  let err = null;
  try { upgradeConcierge(fixtureLive()); } catch (e) { err = e; }
  assert(err && /missing anchor/.test(err.message), 'a fresh graph was "upgraded"');
  err = null;
  try { upgradeConcierge(up); } catch (e) { err = e; }
  assert(err && /already upgraded/.test(err.message), 'the upgrade applied twice');
  const unspliced = JSON.parse(JSON.stringify(v1));
  unspliced.nodes.find((n) => n.name === PREMIUM_SESSION).parameters.jsCode = LIVE_CODE;
  err = null;
  try { upgradeConcierge(unspliced); } catch (e) { err = e; }
  assert(err && /not spliced/.test(err.message), 'an unspliced premium node was upgraded');
  // and the fresh patch produces the SAME nodes the upgrade does
  const fresh = patchConcierge(fixtureLive());
  for (const name of [PREP_NODE, PROJECT_NODE, GUARD_NODE]) {
    eq(JSON.stringify(fresh.nodes.find((n) => n.name === name).parameters), JSON.stringify(up.nodes.find((n) => n.name === name).parameters), name + ' differs between patch and upgrade');
  }
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
