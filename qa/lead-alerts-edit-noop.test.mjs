#!/usr/bin/env node
// FINMENTOR — a no-op keyboard refresh is not a failure, and nothing else is a no-op.
//
//   node qa/lead-alerts-edit-noop.test.mjs
//
// Offline. No tenant, no network, no Telegram, no Sheets, no production writes.
//
// ── WHY THIS GATE EXISTS ──────────────────────────────────────────────────────────────────────
//
// Execution 5062 — the Stage 2 confirming tap — wrote the CRM correctly, proved the mutation, and
// then told the owner «Не удалось обновить кнопки в сообщении.» The write was right and the
// keyboard was right; the edit was simply a no-op, because snooze changes no button and
// `deal_stage` did not move. Telegram answered
//
//   Bad Request: message is not modified: specified new message content and reply markup are
//   exactly the same as a current content and reply markup of the message
//
// and the graph treated any `$json.error` as a presentation failure.
//
// ── WHAT IT GUARDS, AND WHY BOTH HALVES ARE CHECKED ───────────────────────────────────────────
//
// The classification lives in TWO places that must agree: `LAA.classifyEdit()` in
// n8n/src/lead-alerts/actions.js, and the parameter expression on `Telegram Update Reply`, which
// is where an n8n Telegram node can carry logic at all. Testing only the function would prove
// nothing about the graph — that is exactly the blind spot execution 5055 cost a live tap to find.
// So every scenario is run through BOTH, and they are asserted to agree.
//
// The danger in a fix like this is not that the exception fails to fire. It is that the exception
// fires too widely and launders a real failure into a success acknowledgement. So six of the eleven
// scenarios are errors that must STILL FAIL, and the widening ones — a substring rather than a
// prefix, an unreadable error object — are tested explicitly.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);

const X = require_(join(HERE, 'n8n-expression.js'));
const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const A = new Function(ACTIONS_SRC + '; return LAA;')();

// 2026-09-04: the current Command Center candidate is the label refresh (module blocks re-inlined,
// «В наблюдение»); the edit-no-op fix it builds on is byte-preserved in its tail.
const FIXED = join(ROOT, 'n8n', 'candidate', 'lead-command-center-labels-candidate.json');
// The graph execution 5062 actually ran. Kept as the fixture this gate must FAIL on.
const PRE_FIX = join(ROOT, 'n8n', 'candidate', 'lead-command-center-ack-fix-candidate.json');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const WF = load(FIXED);
const nodeOf = (wf, name) => wf.nodes.find((n) => n.name === name);
const codeOf = (wf, name) => String((nodeOf(wf, name) || { parameters: {} }).parameters.jsCode || '');

// ── the Code-node environment n8n provides ────────────────────────────────────────────────────
const unwrap = (it) => (it && typeof it === 'object' && Object.prototype.hasOwnProperty.call(it, 'json') ? it.json : it);
function runCode(code, nodes, inputItems) {
  const handle = (items) => ({
    first: () => { if (!items.length) { throw new Error('first() on an empty node'); } return items[0]; },
    all: () => items, isExecuted: true
  });
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) { throw new Error("$('" + name + "') not provided"); }
    return handle(nodes[name].map((j) => ({ json: j })));
  };
  return new Function('$', '$input', code)($, handle((inputItems || []).map((j) => ({ json: j })))).map(unwrap);
}

const SETTINGS = { allowed_chat_ids: '551662084', timezone: 'Europe/Chisinau', sla_hot_hours: 4 };
const OWNER = 551662084;
const LEAD = 'FIN-1788113619104-582';
const ORIGIN_TEXT = 'FINMENTOR · PRIORITY\n\nMega Parc SRL\n\nПочему требует внимания\nНет ответа больше 4 часов.';
const ORIGIN_ENTITIES = [{ type: 'bold', offset: 0, length: 20 }, { type: 'bold', offset: 22, length: 13 }];

// The row as execution 5062 actually read it: Documents Requested, Active, nothing snoozed.
const ROW_5062 = {
  lead_id: LEAD, company: 'Mega Parc SRL', name: 'Iacovlev', deal_stage: 'Documents Requested',
  sla_status: 'Active', next_follow_up_at: '2026-09-02T14:19:14.875Z',
  documents_requested_at: '2026-08-31T14:19:14.875Z', sla_snooze_until: '',
  last_contacted_at: '', priority: 'HOT', status: 'Qualified'
};

// Drive the candidate's own Code nodes to the point where the edit runs.
function drive(wf, opts) {
  const o = opts || {};
  const row = o.row || ROW_5062;
  const kind = o.kind || 'priority';
  const originKb = A.keyboard(kind, o.originState || row, LEAD);
  const update = {
    update_id: 1,
    callback_query: {
      id: 'cbq', data: o.callbackData,
      from: { id: OWNER, is_bot: false },
      message: {
        message_id: 147, chat: { id: OWNER, type: 'private' },
        text: ORIGIN_TEXT, entities: ORIGIN_ENTITIES,
        reply_markup: { inline_keyboard: originKb.map((r) => r.map((b) => ({ text: b.text, callback_data: b.callback_data }))) }
      }
    }
  };
  const identity = runCode(codeOf(wf, 'Verify Telegram Identity'), {}, [update]);
  assert(identity.length === 1, 'the identity gate dropped the owner tap');
  const N = { 'Verify Telegram Identity': identity, 'Settings to Object': [{ settings: SETTINGS }] };
  const parsed = runCode(codeOf(wf, 'Parse Lead Command v2'), N, identity);
  N['Parse Lead Command v2'] = parsed;

  const decided = runCode(codeOf(wf, 'Find & Build Update'), N, o.rows || [row])[0];
  N['Find & Build Update'] = [decided];

  let routed = decided;
  let verified = null;
  if (decided._allowed === true) {
    const sparse = runCode(codeOf(wf, 'Build Sparse Update'), N, [decided])[0];
    const written = o.writeRow ? o.writeRow(row, sparse) : Object.assign({}, row, sparse);
    verified = runCode(codeOf(wf, 'Verify Mutation'), N, [written])[0];
    N['Verify Mutation'] = [verified];
    if (verified._verified !== true) { return { decided, verified, unverified: true, nodes: N }; }
    routed = verified;
  }
  const branch = X.switchBranch(nodeOf(wf, 'Route Edit Shape'), N, { json: routed });
  const branches = [[], [], [], []];
  branches[branch.index] = [{ json: routed }];
  N['Route Edit Shape'] = branches;
  return { decided, verified, routed, branch, nodes: N };
}

const ackOf = (wf, nodes, editItem) =>
  X.evaluate(nodeOf(wf, 'Telegram Update Reply').parameters.text, nodes, { json: editItem });

// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('EDIT NO-OP — the exception is exact, and everything else still fails closed');

// The message Telegram actually returned to execution 5062, character for character.
const REAL_5062 = 'Bad Request: message is not modified: specified new message content and reply '
  + 'markup are exactly the same as a current content and reply markup of the message';

// ── the eleven scenarios ──────────────────────────────────────────────────────────────────────
//
// `item` is what `Telegram Update Reply` actually receives from an Edit Alert node carrying
// onError: continueRegularOutput — the raw Telegram envelope on success, n8n's error otherwise.
const SCENARIOS = [
  { id: 'A',  name: 'execution 5062, exact string — message is not modified',
    item: { error: REAL_5062 }, outcome: 'EDIT_NOOP' },
  { id: 'A2', name: 'the same error as an OBJECT — n8n surfaces both shapes',
    item: { error: { message: REAL_5062 } }, outcome: 'EDIT_NOOP' },
  { id: 'A3', name: 'the short form of the same class',
    item: { error: 'Bad Request: message is not modified' }, outcome: 'EDIT_NOOP' },
  { id: 'B',  name: 'the edit changed the keyboard — Telegram returns a Message',
    item: { ok: true, result: { message_id: 147, edit_date: 1788190660, text: ORIGIN_TEXT } }, outcome: 'EDIT_UPDATED' },
  { id: 'C',  name: 'message not found — MUST still fail',
    item: { error: 'Bad Request: message to edit not found' }, outcome: 'EDIT_FAILED' },
  { id: 'D',  name: 'malformed markup — MUST still fail',
    item: { error: "Bad Request: can't parse entities: Unsupported start tag \"foo\" at byte offset 12" }, outcome: 'EDIT_FAILED' },
  { id: 'E',  name: 'an arbitrary 400 — MUST still fail',
    item: { error: 'Bad Request: chat not found' }, outcome: 'EDIT_FAILED' },
  { id: 'F1', name: '401 Unauthorized — MUST still fail',
    item: { error: 'Unauthorized' }, outcome: 'EDIT_FAILED' },
  { id: 'F2', name: '403 Forbidden — MUST still fail',
    item: { error: 'Forbidden: bot was blocked by the user' }, outcome: 'EDIT_FAILED' },
  // The two ways a careless implementation would widen the exception.
  { id: 'W1', name: 'an error that merely MENTIONS the phrase — prefix, never substring',
    item: { error: 'Bad Request: failed because message is not modified downstream' }, outcome: 'EDIT_FAILED' },
  { id: 'W2', name: 'an error object this cannot read — fails CLOSED',
    item: { error: {} }, outcome: 'EDIT_FAILED' }
];

// One drive, reused: the classification does not depend on which action was taken.
const RUN = drive(WF, { kind: 'priority', callbackData: 'snooze|' + LEAD + '|24', row: ROW_5062 });

check('the tap under test is the 5062 shape — snooze, allowed, verified, KB22 on branch 1', () => {
  eq(RUN.decided._action, 'snooze', 'wrong action');
  eq(RUN.decided._allowed, true, 'the action was refused');
  eq(RUN.verified._verified, true, 'the mutation was not verified');
  eq(String(RUN.routed.kb_shape), 'KB22', 'wrong keyboard shape');
  eq(RUN.branch.index, 1, 'wrong switch branch');
  // and the keyboard really is unchanged, which is WHY the edit is a no-op
  const before = A.keyboard('priority', ROW_5062, LEAD);
  assert(A.sameKeyboard(before, RUN.routed.kb),
    'the post-write keyboard differs from the one already shown — this is not the no-op case');
});

check('the decision emits THREE distinct copies', () => {
  const d = RUN.routed;
  for (const k of ['reply_text', 'reply_text_presentation_noop', 'reply_text_presentation_failed']) {
    assert(typeof d[k] === 'string' && d[k].trim().length > 0, k + ' is missing or empty');
  }
  assert(d.reply_text !== d.reply_text_presentation_noop, 'the no-op copy is identical to the plain confirmation');
  assert(d.reply_text_presentation_noop !== d.reply_text_presentation_failed, 'the no-op copy is identical to the failure copy');
  // requirement: the no-op copy must not claim Telegram changed anything, and must not alarm
  assert(!/Не удалось/.test(d.reply_text_presentation_noop), 'the no-op copy still reports a failure');
  assert(/актуальны/.test(d.reply_text_presentation_noop), 'the no-op copy does not say the presentation was already current');
  // it still carries the business outcome, which is the authority
  assert(d.reply_text_presentation_noop.indexOf(d.reply_text) === 0,
    'the no-op copy does not begin with the proven business confirmation');
});

for (const s of SCENARIOS) {
  check(s.id + '. ' + s.name + ' -> ' + s.outcome, () => {
    // half one: the pure function
    eq(A.classifyEdit(s.item), s.outcome, 'classifyEdit() disagrees');

    // half two: the parameter expression the graph actually runs
    const ack = ackOf(WF, RUN.nodes, s.item);
    assert(ack.ok, 'the acknowledgement expression threw: ' + ack.error);
    assert(ack.rendered.trim().length > 0, 'THE ACKNOWLEDGEMENT IS EMPTY');

    // and they must agree: the expression must render the copy the function selects
    const key = A.editCopyKey(s.outcome);
    eq(ack.rendered, String(RUN.routed[key]),
      'the expression rendered a different copy than ' + key + ' — function and graph disagree');

    // a failure must never be laundered into a success acknowledgement
    if (s.outcome === 'EDIT_FAILED') {
      assert(/Не удалось обновить кнопки/.test(ack.rendered),
        'an EDIT_FAILED outcome did NOT produce the failure copy — the exception is too wide');
      assert(ack.rendered !== String(RUN.routed.reply_text_presentation_noop),
        'a real failure was answered with the no-op copy');
    } else {
      assert(!/Не удалось обновить кнопки/.test(ack.rendered),
        'a successful outcome reported a presentation failure');
    }
  });
}

check('G. an unverified write can never reach the acknowledgement', () => {
  // structural, not behavioural: IF Verified routes a failed verification away from the edit path
  // entirely, so there is no item for any classification to act on.
  const conns = WF.connections['IF Verified'];
  assert(conns && Array.isArray(conns.main) && conns.main.length === 2, 'IF Verified does not have two outputs');
  const truthy = conns.main[0].map((c) => c.node);
  const falsy = conns.main[1].map((c) => c.node);
  eq(JSON.stringify(truthy), JSON.stringify(['Route Edit Shape']), 'the verified path no longer goes to the router');
  assert(falsy.indexOf('Telegram Write Failed Reply') !== -1, 'the unverified path does not go to the failure reply');
  assert(falsy.indexOf('Route Edit Shape') === -1, 'an UNVERIFIED write can reach the edit path');

  // and behaviourally: a write that does not land is never verified
  const r = drive(WF, {
    kind: 'priority', callbackData: 'snooze|' + LEAD + '|24', row: ROW_5062,
    writeRow: (row) => Object.assign({}, row) // the sheet silently kept the old values
  });
  eq(r.unverified, true, 'a lost write was reported as verified');
  eq(r.verified._verified, false, '_verified is not false');
  assert(r.verified._mismatched.length > 0, 'nothing was reported as mismatched');
});

check('the acknowledgement ordering is untouched — write, read-back, verify, edit, acknowledge', () => {
  const c = WF.connections;
  const to = (n) => (c[n] && c[n].main ? c[n].main.map((b) => b.map((x) => x.node)) : []);
  assert(to('Update Pipeline Row')[0].indexOf('Get Pipeline (Verify)') !== -1, 'the read-back does not follow the write');
  assert(to('Get Pipeline (Verify)')[0].indexOf('Verify Mutation') !== -1, 'the verification does not follow the read-back');
  assert(to('Verify Mutation')[0].indexOf('IF Verified') !== -1, 'the verification does not gate');
  for (const e of ['Edit Alert (5)', 'Edit Alert (4)', 'Edit Alert (3)', 'Edit Alert (0)']) {
    assert(to(e)[0].indexOf('Telegram Update Reply') !== -1, e + ' does not feed the acknowledgement');
    eq(nodeOf(WF, e).onError, 'continueRegularOutput',
      e + ': without continueRegularOutput a failed edit never reaches the classifier');
  }
});

check('no bare accessor against a multi-output node survives anywhere in the graph', () => {
  const hits = X.unsafeRoutingReferences(WF);
  eq(hits.length, 0, 'unsafe routing references: ' + hits.map((h) => h.node + '.' + h.parameterPath).join(', '));
});

// ── the gate must FAIL on the graph that actually broke ───────────────────────────────────────
check('it FAILS on the pre-fix candidate — the graph execution 5062 ran', () => {
  assert(existsSync(PRE_FIX), 'the pre-fix candidate fixture is missing: ' + PRE_FIX);
  const OLD = load(PRE_FIX);
  const r = drive(OLD, { kind: 'priority', callbackData: 'snooze|' + LEAD + '|24', row: ROW_5062 });

  // it has no third copy at all
  assert(r.routed.reply_text_presentation_noop === undefined,
    'the pre-fix decision already emits a no-op copy — this is not the pre-fix graph');

  // and its expression answers the 5062 error with the FAILURE copy
  const ack = ackOf(OLD, r.nodes, { error: REAL_5062 });
  assert(ack.ok && ack.rendered.trim().length > 0, 'the pre-fix acknowledgement is empty — wrong fixture');
  eq(ack.rendered, String(r.routed.reply_text_presentation_failed),
    'the pre-fix graph did NOT answer a no-op with the failure copy');
  assert(/Не удалось обновить кнопки/.test(ack.rendered),
    'the pre-fix graph did not report the false failure this fix removes');
});

console.log('');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('');
  for (const f of failures) { console.log('  FAILED: ' + f); }
  process.exitCode = 1;
}
console.log('');
