#!/usr/bin/env node
// FINMENTOR — the acknowledgement expression, evaluated for every keyboard shape.
//
//   node qa/lead-alerts-ack-expression.test.mjs
//
// Offline. No tenant, no network, no Telegram, no Sheets, no production writes.
//
// ── WHY THIS GATE EXISTS ──────────────────────────────────────────────────────────────────────
//
// Execution 5055 — the first real tap of the Stage 2 action lifecycle — wrote the CRM correctly,
// edited the alert correctly, and then failed on the last node with Telegram 400 «message text is
// empty». The cause was entirely inside a parameter expression:
//
//   $('Route Edit Shape').first().json.reply_text
//
// Route Edit Shape is a four-output Switch. A Switch sends each item down exactly ONE branch and
// `.first()` reads branch 0, so for three of the four shapes the expression resolved an empty
// branch. Every offline gate passed, because every offline gate either executes Code nodes or
// reads graph wiring — and a Telegram node's text expression is neither.
//
// So this gate evaluates the ACTUAL parameter expressions from the candidate, on items produced by
// the candidate's ACTUAL Code nodes, routed through the switch the way n8n routes them. It asserts
// two things the tap proved were not equivalent:
//
//   1. every successful action route yields a NON-EMPTY acknowledgement, on every branch;
//   2. no success acknowledgement is reachable before the mutation is verified.
//
// And it pins the defect twice over: by driving branches 1, 2 and 3 — not just branch 0 — and by
// re-running the whole thing against the PRE-FIX candidate, which must FAIL. A gate that cannot
// fail on the graph that actually broke is not evidence.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);

const X = require_(join(HERE, 'n8n-expression.js'));
const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const A = new Function(ACTIONS_SRC + '; return LAA;')();

const FIXED = join(ROOT, 'n8n', 'candidate', 'lead-command-center-ack-fix-candidate.json');
// The graph as it stood when it failed in production. Kept as a fixture on purpose.
const PRE_FIX = join(ROOT, 'n8n', 'candidate', 'lead-command-center-stage2-candidate.json');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

// ── the graph under test ──────────────────────────────────────────────────────────────────────

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const WF = load(FIXED);
const nodeOf = (wf, name) => wf.nodes.find((n) => n.name === name);
const codeOf = (wf, name) => String((nodeOf(wf, name) || { parameters: {} }).parameters.jsCode || '');

const EDIT_FOR_BRANCH = ['Edit Alert (5)', 'Edit Alert (4)', 'Edit Alert (3)', 'Edit Alert (0)'];

// The Code-node environment, as n8n provides it for `runOnceForAllItems`. Items come back in both
// shapes a Code node may return; n8n normalises them and so must this.
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
const ORIGIN_TEXT = 'FINMENTOR · NEW LEAD\n\nMega Parc SRL\nГенеральный директор';
const ORIGIN_ENTITIES = [{ type: 'bold', offset: 0, length: 20 }, { type: 'bold', offset: 22, length: 13 }];

const ROW = {
  lead_id: LEAD, company: 'Mega Parc SRL', name: 'Iacovlev', deal_stage: 'Qualified',
  sla_status: 'Active', next_follow_up_at: '2026-08-30T22:13:38.231Z', documents_requested_at: '',
  sla_snooze_until: '', last_contacted_at: '', priority: 'HOT', status: 'Qualified'
};

// ── one tap, through the candidate, to the acknowledgement ────────────────────────────────────
//
// Everything below the identity gate is the candidate's own bytes. The two Sheets nodes are the
// only simulation: the writer maps exactly the keys it is handed (autoMapInputData), so applying
// the projection to the row IS the write.
function drive(wf, opts) {
  const o = opts || {};
  const row = o.row || ROW;
  const kind = o.kind || 'new_lead';
  const originKb = A.keyboard(kind === 'priority' ? 'priority' : 'new_lead', o.originState || row, LEAD);
  const update = {
    update_id: 1,
    callback_query: {
      id: 'cbq', data: o.callbackData,
      from: { id: OWNER, is_bot: false },
      message: {
        message_id: 145, chat: { id: OWNER, type: 'private' },
        text: ORIGIN_TEXT, entities: ORIGIN_ENTITIES,
        reply_markup: { inline_keyboard: originKb.map((r) => r.map((b) => ({ text: b.text, callback_data: b.callback_data }))) }
      }
    }
  };

  const identity = runCode(codeOf(wf, 'Verify Telegram Identity'), {}, [update]);
  assert(identity.length === 1, 'the identity gate dropped the owner tap');
  const N = { 'Verify Telegram Identity': identity, 'Settings to Object': [{ settings: SETTINGS }] };
  const parsed = runCode(codeOf(wf, 'Parse Lead Command v2'), N, identity);
  assert(parsed.length === 1, 'the parser dropped the owner tap');
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

  // the switch, routed as n8n routes it
  const branch = X.switchBranch(nodeOf(wf, 'Route Edit Shape'), N, { json: routed });
  assert(branch.index >= 0 && branch.index < 4, 'the item routed to no edit node (shape ' + routed.kb_shape + ')');

  // ONE branch carries the item. The other three are empty — which is the entire finding.
  const branches = [[], [], [], []];
  branches[branch.index] = [{ json: routed }];
  N['Route Edit Shape'] = branches;

  return { decided, verified, routed, branch, nodes: N };
}

// Evaluate a node's parameter against the outputs a run produced.
const evalParam = (wf, node, path, nodes, current) => {
  const parts = path.split('.');
  let p = nodeOf(wf, node).parameters;
  for (const k of parts) { p = p[k]; }
  return X.evaluate(p, nodes, current);
};

// The item `Telegram Update Reply` actually receives: the raw Telegram envelope on success, and
// n8n's error object on a failed edit (the Edit Alert nodes carry onError continueRegularOutput).
const EDIT_OK = { json: { ok: true, result: { message_id: 145, edit_date: 1788185961, text: ORIGIN_TEXT } } };
const EDIT_FAILED = { json: { error: { message: 'Bad Request: message is not modified' } } };

// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log('');
console.log('ACK EXPRESSION — every keyboard shape, on the branch it actually takes');

// Each case is chosen to land on a DIFFERENT switch branch. Branch 0 is the one the broken
// expression happened to work on, so the other three are the point.
const CASES = [
  { name: 'PRIORITY · snooze · 5 buttons', kind: 'priority', callbackData: 'snooze|' + LEAD + '|24', row: ROW, shape: 'KB221', branch: 0 },
  // snooze leaves deal_stage alone and is repeatable, so all four NEW LEAD actions survive it —
  // which is what puts this case on branch 1. `docs` would land on KB21, not KB22.
  { name: 'NEW LEAD · snooze · 4 buttons', kind: 'new_lead', callbackData: 'snooze|' + LEAD + '|24', row: ROW, shape: 'KB22', branch: 1 },
  { name: 'NEW LEAD · snooze after docs · 3 buttons', kind: 'new_lead', callbackData: 'snooze|' + LEAD + '|24', row: Object.assign({}, ROW, { deal_stage: 'Documents Requested' }), shape: 'KB21', branch: 2 },
  { name: 'NEW LEAD · nurture · keyboard cleared', kind: 'new_lead', callbackData: 'nurture|' + LEAD, row: ROW, shape: 'NONE', branch: 3 },
  { name: 'PRIORITY · done · keyboard cleared', kind: 'priority', callbackData: 'done|' + LEAD, row: ROW, shape: 'NONE', branch: 3 }
];

const seenBranches = new Set();

for (const c of CASES) {
  check(c.name + ' — routes to ' + c.shape + ' and acknowledges', () => {
    const r = drive(WF, c);
    eq(String(r.routed.kb_shape), c.shape, 'wrong keyboard shape');
    eq(r.branch.index, c.branch, 'wrong switch branch');
    eq(r.branch.key, c.shape, 'wrong switch output key');
    assert(!r.branch.fallback, 'the item fell through to the fallback output');
    seenBranches.add(r.branch.index);

    // the edit node for this branch renders
    const editNode = EDIT_FOR_BRANCH[r.branch.index];
    const item = { json: r.routed };
    const chat = evalParam(WF, editNode, 'chatId', r.nodes, item);
    const mid = evalParam(WF, editNode, 'messageId', r.nodes, item);
    const body = evalParam(WF, editNode, 'text', r.nodes, item);
    assert(chat.ok && chat.rendered.length > 0, editNode + ': chatId is empty');
    assert(mid.ok && mid.rendered.length > 0, editNode + ': messageId is empty');
    assert(body.ok && body.rendered.length > 0, editNode + ': the edited body is empty');
    eq(body.rendered, String(r.routed.edit_html), editNode + ': the edited body is not the rebuilt alert');

    // every button expression resolves — a shape whose kb is shorter than its node would render
    // `undefined` into a live keyboard
    const kbRows = ((nodeOf(WF, editNode).parameters.inlineKeyboard || {}).rows) || [];
    let buttons = 0;
    for (const row of kbRows) {
      for (const b of (row.row.buttons || [])) {
        const t = X.evaluate(b.text, r.nodes, item);
        const d = X.evaluate(b.additionalFields.callback_data, r.nodes, item);
        assert(t.ok && t.rendered.length > 0, editNode + ': a button label is empty');
        assert(d.ok && d.rendered.length > 0, editNode + ': a button callback_data is empty');
        buttons++;
      }
    }
    eq(buttons, r.routed.kb.flat().length, editNode + ': the node renders a different number of buttons than the keyboard has');

    // THE ACKNOWLEDGEMENT — the assertion the live tap had to buy
    const ack = evalParam(WF, 'Telegram Update Reply', 'text', r.nodes, EDIT_OK);
    assert(ack.ok, 'the acknowledgement expression threw: ' + ack.error);
    assert(ack.rendered.trim().length > 0, 'THE ACKNOWLEDGEMENT IS EMPTY on branch ' + r.branch.index + ' (' + c.shape + ')');
    eq(ack.rendered, String(r.routed.reply_text), 'the acknowledgement is not the copy the decision produced');
    assert(/FINMENTOR/.test(ack.rendered), 'the acknowledgement lost its header');
    assert(!/undefined|NaN|\[object/.test(ack.rendered), 'a formatting hole is visible in the acknowledgement');

    const to = evalParam(WF, 'Telegram Update Reply', 'chatId', r.nodes, EDIT_OK);
    assert(to.ok && to.rendered.length > 0, 'the acknowledgement has no destination');
    eq(to.rendered, String(OWNER), 'the acknowledgement goes to the owner');

    // and the presentation-failure copy on the same branch
    const failAck = evalParam(WF, 'Telegram Update Reply', 'text', r.nodes, EDIT_FAILED);
    assert(failAck.ok && failAck.rendered.trim().length > 0, 'the presentation-failure copy is empty on branch ' + r.branch.index);
    eq(failAck.rendered, String(r.routed.reply_text_presentation_failed), 'the presentation-failure copy is not the one the decision produced');
  });
}

check('EVERY SWITCH BRANCH EXERCISED — including the three the broken expression could not serve', () => {
  eq([...seenBranches].sort().join(','), '0,1,2,3', 'not every branch of Route Edit Shape was driven');
});

// ── the refusal routes ────────────────────────────────────────────────────────────────────────

console.log('');
console.log('REFUSAL ROUTES — a refused tap still refreshes the keyboard, and still speaks');

const REFUSALS = [
  { name: 'ALREADY_APPLIED', kind: 'new_lead', callbackData: 'docs|' + LEAD, row: Object.assign({}, ROW, { deal_stage: 'Documents Requested' }) },
  { name: 'TERMINAL', kind: 'new_lead', callbackData: 'docs|' + LEAD, row: Object.assign({}, ROW, { deal_stage: 'Won' }) },
  { name: 'STATE_CHANGED', kind: 'new_lead', callbackData: 'done|' + LEAD, row: ROW },
  { name: 'NOT_FOUND', kind: 'new_lead', callbackData: 'docs|FIN-nope', row: ROW }
];

for (const c of REFUSALS) {
  check(c.name + ' — no write, and a non-empty refusal on its own branch', () => {
    const r = drive(WF, c);
    eq(r.decided._allowed, false, 'a refusal was allowed');
    assert(!('_upd' in r.decided), 'a refusal carries an update');
    assert(r.verified === null, 'a refusal reached the verification node');
    const ack = evalParam(WF, 'Telegram Update Reply', 'text', r.nodes, EDIT_OK);
    assert(ack.ok, 'the refusal expression threw: ' + ack.error);
    assert(ack.rendered.trim().length > 0, 'THE REFUSAL COPY IS EMPTY on branch ' + r.branch.index);
    eq(ack.rendered, String(r.decided.reply_text), 'the refusal is not the copy the decision produced');
    // a refusal must never read as a completed action
    assert(!/ACTION UPDATED|STAGE UPDATED|FOLLOW-UP UPDATED/.test(ack.rendered), 'a refusal claims an action was applied');
  });
}

check('UNVERIFIED WRITE — the failure reply is non-empty and claims nothing', () => {
  // the Sheets node returned without throwing and wrote nothing
  const r = drive(WF, { kind: 'new_lead', callbackData: 'docs|' + LEAD, row: ROW, writeRow: (row) => Object.assign({}, row) });
  eq(r.unverified, true, 'a silent no-op write was treated as verified');
  eq(r.verified._verified, false, 'the read-back did not reject the no-op');
  const reply = evalParam(WF, 'Telegram Write Failed Reply', 'text', r.nodes, { json: r.verified });
  assert(reply.ok && reply.rendered.trim().length > 0, 'the write-failure reply is empty');
  assert(!/ACTION UPDATED|STAGE UPDATED|FOLLOW-UP UPDATED/.test(reply.rendered), 'the write-failure reply claims success');
});

// ── the acknowledgement cannot precede verification ───────────────────────────────────────────

console.log('');
console.log('ACK ORDER — a success acknowledgement is unreachable before the mutation is proven');

check('the only feeders of the acknowledgement are the four edit nodes', () => {
  const feeders = (name) => Object.keys(WF.connections).filter((k) =>
    (WF.connections[k].main || []).some((arr) => (arr || []).some((c) => c.node === name)));
  eq(feeders('Telegram Update Reply').sort().join(','), EDIT_FOR_BRANCH.slice().sort().join(','), 'something else can speak the acknowledgement');
  for (const e of EDIT_FOR_BRANCH) { eq(feeders(e).join(','), 'Route Edit Shape', e + ' has a feeder other than the router'); }
  eq(feeders('Route Edit Shape').sort().join(','), 'IF Action Allowed,IF Verified', 'the router has an unexpected feeder');
  eq(feeders('IF Verified').join(','), 'Verify Mutation', 'the verification gate has an unexpected feeder');
  eq(feeders('Verify Mutation').join(','), 'Get Pipeline (Verify)', 'the verification does not run on the read-back');
  eq(feeders('Get Pipeline (Verify)').join(','), 'Update Pipeline Row', 'the read-back does not follow the write');
  eq(feeders('Update Pipeline Row').join(','), 'Build Sparse Update', 'the writer has a feeder other than the sparse projection');
});

check('the success branch of the router is fed only by IF Verified output 0', () => {
  const outs = (name, i) => (((WF.connections[name] || {}).main || [])[i] || []).map((c) => c.node);
  eq(outs('IF Verified', 0).join(','), 'Route Edit Shape', 'a verified write does not refresh the keyboard');
  eq(outs('IF Verified', 1).join(','), 'Telegram Write Failed Reply', 'an unproven write does not report itself');
  eq(outs('IF Action Allowed', 0).join(','), 'Build Sparse Update', 'an allowed action does not reach the projection');
  eq(outs('IF Action Allowed', 1).join(','), 'Route Edit Shape', 'a refused action does not refresh the keyboard');
});

check('the fast acknowledgement claims no outcome', () => {
  const ack = nodeOf(WF, 'Answer Callback Query');
  eq(ack.parameters.resource, 'callback', 'the fast acknowledgement is not answerCallbackQuery');
  const text = String((ack.parameters.additionalFields || {}).text || '');
  assert(text.length > 0, 'the fast acknowledgement is empty');
  assert(!/выполн|готов|обработан|успешн|сохран/i.test(text), 'the fast acknowledgement claims an outcome: ' + text);
});

// ── the regression pin ────────────────────────────────────────────────────────────────────────

console.log('');
console.log('REGRESSION PIN — a bare accessor on a multi-output node must fail this gate');

check('no parameter anywhere addresses a multi-output routing node with a bare accessor', () => {
  const hits = X.unsafeRoutingReferences(WF);
  assert(hits.length === 0, 'unsafe reference(s): ' + hits.map((h) => h.node + '.' + h.parameterPath + " -> $('" + h.reference + "')." + h.accessor + '()').join('; '));
});

check('the multi-output nodes are actually detected — the scan is not vacuous', () => {
  const multi = X.multiOutputNames(WF);
  for (const n of ['Route Edit Shape', 'IF Verified', 'IF Action Allowed', 'IF Row Found', 'Route Command Mode', 'IF Has Callback']) {
    assert(multi.has(n), n + ' is not recognised as multi-output');
  }
  assert(!multi.has('Find & Build Update'), 'a Code node was wrongly treated as multi-output');
  assert(!multi.has('Verify Mutation'), 'a Code node was wrongly treated as multi-output');
});

check('THE PRE-FIX GRAPH FAILS THIS GATE — on the exact defect execution 5055 hit', () => {
  const broken = load(PRE_FIX);
  const hits = X.unsafeRoutingReferences(broken);
  assert(hits.length > 0, 'the static scan does not flag the graph that actually broke');
  assert(hits.some((h) => h.node === 'Telegram Update Reply' && h.reference === 'Route Edit Shape'),
    'the static scan flags something other than the real defect');

  // and dynamically: driving the pre-fix graph onto a non-zero branch yields an empty ack
  const r = drive(broken, { kind: 'new_lead', callbackData: 'docs|' + LEAD, row: ROW });
  assert(r.branch.index !== 0, 'the reproduction did not leave branch 0, so it proves nothing');
  const ack = evalParam(broken, 'Telegram Update Reply', 'text', r.nodes, EDIT_OK);
  eq(ack.rendered.trim(), '', 'the pre-fix graph did NOT reproduce the empty acknowledgement — the model is wrong');
  assert(String(r.routed.reply_text || '').length > 0, 'the copy was missing too, so this reproduces the wrong defect');
});

check('branch 0 is exactly why the defect hid — the pre-fix graph works there and only there', () => {
  const broken = load(PRE_FIX);
  const r = drive(broken, { kind: 'priority', callbackData: 'snooze|' + LEAD + '|24', row: ROW });
  eq(r.branch.index, 0, 'this case no longer lands on branch 0');
  const ack = evalParam(broken, 'Telegram Update Reply', 'text', r.nodes, EDIT_OK);
  assert(ack.rendered.trim().length > 0, 'even branch 0 was empty, so the diagnosis is wrong');
});

check('the two candidates differ in exactly one parameter on one node', () => {
  const broken = load(PRE_FIX);
  eq(WF.nodes.length, broken.nodes.length, 'the node count moved');
  eq(JSON.stringify(WF.connections), JSON.stringify(broken.connections), 'the connections moved');
  const changed = WF.nodes.filter((n) => {
    const b = broken.nodes.find((x) => x.name === n.name);
    return !b || JSON.stringify(b.parameters) !== JSON.stringify(n.parameters);
  }).map((n) => n.name);
  eq(changed.join(','), 'Telegram Update Reply', 'more than the acknowledgement node changed');
  const b = broken.nodes.find((x) => x.name === 'Telegram Update Reply').parameters;
  const a = nodeOf(WF, 'Telegram Update Reply').parameters;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  eq(keys.join(','), 'text', 'more than the text parameter changed');
});

// ── the evaluator itself ──────────────────────────────────────────────────────────────────────

console.log('');
console.log('THE EVALUATOR — the one rule this all rests on');

check('.first() defaults to output branch 0, which is the whole finding', () => {
  const outputs = { Router: [[], [{ json: { v: 'branch one' } }]] };
  eq(X.evaluate("={{ $('Router').first().json.v }}", outputs, {}).rendered, '', 'branch 0 was not the default');
  eq(X.evaluate("={{ $('Router').first(1).json.v }}", outputs, {}).rendered, 'branch one', 'an explicit branch index was ignored');
  eq(X.evaluate("={{ $('Router').all(1).length }}", outputs, {}).rendered, '1', 'all(branch) is wrong');
});

check('a single-output node is unambiguous under the same accessor', () => {
  const outputs = { Decide: [{ json: { reply_text: 'копия' } }] };
  eq(X.evaluate("={{ $('Decide').first().json.reply_text }}", outputs, {}).rendered, 'копия', 'a single-output node did not resolve');
});

check('a literal parameter is passed through, and a mixed template concatenates', () => {
  eq(X.evaluate('plain', {}, {}).rendered, 'plain', 'a literal was evaluated');
  eq(X.evaluate('=a{{ 1 + 1 }}b', {}, {}).rendered, 'a2b', 'a mixed template did not concatenate');
  eq(X.evaluate('={{ $json.n }}', {}, { json: { n: 7 } }).value, 7, 'a single block did not keep its type');
});

check('a throwing expression is reported, not silently rendered as content', () => {
  const r = X.evaluate("={{ $('Nope').first().json.x }}", {}, {});
  eq(r.ok, false, 'a reference to an unexecuted node was accepted');
  eq(r.rendered, '', 'a failed expression rendered something');
});

console.log('');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
console.log('  Offline: no tenant, no Telegram, no Sheets, no mutation.');
if (failures.length) { process.exit(1); }
