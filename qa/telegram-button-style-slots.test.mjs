#!/usr/bin/env node
// FINMENTOR — which keyboard slots may carry a literal style, proven by enumeration.
//
//   node qa/telegram-button-style-slots.test.mjs
//
// Offline. No tenant, no network, no Telegram, no Sheets, no production writes.
//
// WHAT THIS GATE IS FOR. The owner matrix is per ACTION, but three of the five live keyboards
// address their buttons by POSITION, filling fixed slots from `$json.kb[row][col]`. A literal
// style on a slot is therefore a claim about every lead state that can reach it, and that claim is
// false for some slots: `chooseActions` hides Discovery at Discovery Scheduled and Документы at
// Documents Requested, so a four-button keyboard's second row starts with whichever survived.
//
// Writing a style there would emphasise the wrong verb. Writing an EMPTY style to avoid that is
// worse — Bot API answers 400 and the owner alert is lost. So this gate fixes the verdict for
// every slot: which are determined, which are ambiguous, and what the deploy is therefore allowed
// to write. A future edit that widens an action set, reorders a set or adds a kind to a renderer
// flips a slot's verdict and fails here, before it can reach a live keyboard.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);
const lf = (s) => s.replace(/\r\n/g, '\n');

const { inlineCrmStageResolver } = await import('file://' + join(ROOT, 'scripts', 'lib', 'inline-crm-stage.mjs').replace(/\\/g, '/'));
const ACTIONS_SRC = inlineCrmStageResolver(
  lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')),
  lf(readFileSync(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'), 'utf8'))
);
const LAA = new Function(ACTIONS_SRC + '\n; return LAA;')();
const SLOTS = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'style-slots.js'));
const DEPLOY = await import('file://' + join(ROOT, 'scripts', 'deploy-telegram-button-styles.mjs').replace(/\\/g, '/'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const plan = SLOTS.deployPlan(LAA);
const byNode = {};
for (const p of plan) { byNode[p.node] = p; }
const slotOf = (node, r, c) => byNode[node].slots.find((s) => s.row === r && s.col === c);

// ── the frozen matrix ──────────────────────────────────────────────────────────────────────────

check('the style matrix is exactly the owner-approved one: done=success, discovery=primary, nothing else', () => {
  eq(LAA.STYLE, { done: 'success', discovery: 'primary' }, 'STYLE');
});

check('no neutral verb carries a style entry', () => {
  for (const a of ['snooze', 'docs', 'nurture']) { assert(LAA.STYLE[a] === undefined, a + ' must have no style entry'); }
});

check('danger is never emitted anywhere in the plan', () => {
  for (const p of plan) { for (const a of p.assignments) { assert(a.style !== 'danger', p.node + ' emits danger'); } }
});

check('every planned style is a valid Bot API value and never an empty string', () => {
  for (const p of plan) {
    for (const a of p.assignments) {
      assert(LAA.STYLE_VALUES.indexOf(a.style) !== -1, p.node + ' emits ' + JSON.stringify(a.style));
      assert(a.style !== '', p.node + ' emits an empty style, which is a 400');
    }
  }
});

// ── determinism: the whole point ───────────────────────────────────────────────────────────────

check('every planned assignment sits on a slot with exactly one possible style', () => {
  for (const p of plan) {
    for (const a of p.assignments) {
      const s = slotOf(p.node, a.row, a.col);
      assert(s.determined, p.node + ' [' + a.row + '][' + a.col + '] is not determined: ' + s.styles.join('|'));
      eq(s.styles, [a.style], p.node + ' [' + a.row + '][' + a.col + '] style set');
    }
  }
});

check('no ambiguous slot is ever assigned a style', () => {
  for (const p of plan) {
    for (const amb of p.ambiguous) {
      assert(!p.assignments.some((a) => a.row === amb.row && a.col === amb.col), p.node + ' assigns a style to an ambiguous slot');
    }
  }
});

check('every renderer reaches at least one state, so no verdict rests on an empty enumeration', () => {
  for (const p of plan) { assert(p.reachable > 0, p.node + ' had no reachable state — its verdict would be vacuous'); }
});

check('the enumeration actually exercises the hiding rules that create the ambiguity', () => {
  const kb = (state) => LAA.keyboard('priority', state, 'X').flat().map((b) => b.action);
  assert(kb({ deal_stage: 'Qualified', sla_status: 'Active' }).indexOf('discovery') !== -1, 'discovery should be offered at Qualified');
  assert(kb({ deal_stage: 'Discovery Scheduled', sla_status: 'Active' }).indexOf('discovery') === -1, 'discovery must be hidden at Discovery Scheduled');
  assert(kb({ deal_stage: 'Documents Requested', sla_status: 'Active' }).indexOf('docs') === -1, 'docs must be hidden at Documents Requested');
});

check('Discovery and Документы can never both be hidden, so the sender shapes stay KB221 and KB22', () => {
  const shapes = {};
  for (const st of SLOTS.states()) { const s = LAA.shape(LAA.keyboard('priority', st, 'X')); shapes[s] = true; }
  eq(Object.keys(shapes).sort(), ['KB22', 'KB221', 'NONE'], 'priority shapes');
});

// ── the recorded verdict, so a flip fails loudly ───────────────────────────────────────────────

check('the five-button sender slots are fully determined: success on Обработано, primary on Discovery', () => {
  for (const node of ['Telegram SLA Alert', 'Telegram Followup Reminder', 'Edit Alert (5)']) {
    eq(byNode[node].assignments.map((a) => [a.row, a.col, a.style, a.action]),
      [[0, 0, 'success', 'done'], [1, 0, 'primary', 'discovery']], node + ' assignments');
    eq(byNode[node].ambiguous, [], node + ' must have no ambiguous slot');
  }
});

check('the four-button senders carry success only, and their second row is the known gap', () => {
  for (const node of ['Telegram SLA Alert (4)', 'Telegram Followup Reminder (4)']) {
    eq(byNode[node].assignments.map((a) => [a.row, a.col, a.style, a.action]), [[0, 0, 'success', 'done']], node + ' assignments');
    eq(byNode[node].ambiguous.map((a) => [a.row, a.col, a.actions]), [[1, 0, ['discovery', 'docs']]], node + ' gap');
  }
});

check('the Command Center edit nodes that serve both kinds carry no style at all', () => {
  for (const node of ['Edit Alert (4)', 'Edit Alert (3)']) {
    eq(byNode[node].assignments, [], node + ' must stay neutral');
    assert(byNode[node].ambiguous.length > 0, node + ' should be recorded as ambiguous');
  }
});

check('Edit Alert (4) is ambiguous precisely because success and primary compete for the same slot', () => {
  const s = slotOf('Edit Alert (4)', 0, 0);
  eq(s.actions, ['discovery', 'done'], 'Edit Alert (4)[0][0] actions');
  eq(s.styles, ['primary', 'success'], 'Edit Alert (4)[0][0] styles');
});

check('the Command Center serves both kinds, which is what makes its shorter shapes ambiguous', () => {
  eq(LAA.originKind(true), 'priority', 'origin with Обработано');
  eq(LAA.originKind(false), 'new_lead', 'origin without Обработано');
});

// ── the deploy plan ────────────────────────────────────────────────────────────────────────────

check('the deploy declares exactly the five owner surfaces and no other node', () => {
  eq(DEPLOY.buildPlan().map((e) => e.workflowId + '/' + e.node).sort(), [
    'LZ2mvKXbBikmeVTn/Telegram SLA Alert', 'LZ2mvKXbBikmeVTn/Telegram SLA Alert (4)',
    'QmIyEW2ZEqKregmN/Telegram Lead Alert', 'qF9tonlHHIxc8MDd/Edit Alert (3)',
    'qF9tonlHHIxc8MDd/Edit Alert (4)', 'qF9tonlHHIxc8MDd/Edit Alert (5)',
    'tNSMRoKlFB52vjge/Telegram Owner Alert',
    'zeLOCuf0K1bkaKl2/Telegram Followup Reminder', 'zeLOCuf0K1bkaKl2/Telegram Followup Reminder (4)'
  ], 'declared nodes');
});

check('a literal NEW LEAD button is matched by its callback verb, not its position', () => {
  eq(DEPLOY.styleForCallback('=stage|{{$json.lead_id}}|Discovery Scheduled'), 'primary', 'discovery');
  eq(DEPLOY.styleForCallback('=docs|{{$json.lead_id}}'), null, 'docs');
  eq(DEPLOY.styleForCallback('=snooze|{{$json.lead_id}}|24'), null, 'snooze');
  eq(DEPLOY.styleForCallback('=nurture|{{$json.lead_id}}'), null, 'nurture');
  eq(DEPLOY.styleForCallback('=done|{{$json.lead_id}}'), 'success', 'done');
  eq(DEPLOY.styleForCallback('=won|X'), null, 'an unrouted verb gets no style');
  eq(DEPLOY.styleForCallback(''), null, 'empty callback gets no style');
});

// ── the deploy may change nothing but a style key ───────────────────────────────────────────────

const fakeLive = () => ({
  name: 'W', settings: {}, connections: { A: { main: [[]] } },
  nodes: [{
    name: 'Telegram Lead Alert', type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
    credentials: { telegramApi: { id: 'X', name: 'Y' } },
    parameters: {
      inlineKeyboard: {
        rows: [{ row: { buttons: [
          { text: '📞 Discovery', additionalFields: { callback_data: '=stage|{{$json.lead_id}}|Discovery Scheduled' } },
          { text: '📄 Документы', additionalFields: { callback_data: '=docs|{{$json.lead_id}}' } }
        ] } }]
      }
    }
  }]
});
const NEW_LEAD_ENTRY = [{ workflowId: 'QmIyEW2ZEqKregmN', workflow: 'Lead Intake', node: 'Telegram Lead Alert', match: 'callback-verb' }];

check('applying the plan adds primary to Discovery and leaves Документы with no style key at all', () => {
  const { next } = DEPLOY.applyPlan(fakeLive(), NEW_LEAD_ENTRY);
  const bs = next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons;
  eq(bs[0].additionalFields.style, 'primary', 'Discovery');
  assert(!('style' in bs[1].additionalFields), 'Документы must carry no style key, not an empty one');
});

check('applying the plan leaves labels and callback_data byte-identical', () => {
  const live = fakeLive();
  const { next } = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
  const a = live.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons;
  const b = next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons;
  for (let i = 0; i < a.length; i++) {
    eq(b[i].text, a[i].text, 'label ' + i);
    eq(b[i].additionalFields.callback_data, a[i].additionalFields.callback_data, 'callback_data ' + i);
  }
});

check('re-applying the plan is idempotent — a second run changes nothing', () => {
  const live = fakeLive();
  const one = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
  const two = DEPLOY.applyPlan(one.next, NEW_LEAD_ENTRY);
  eq(two.deltas, [], 'second run deltas');
  eq(JSON.stringify(two.next), JSON.stringify(one.next), 'second run body');
});

check('the verifier accepts a style-only delta', () => {
  const live = fakeLive();
  const { next } = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
  eq(DEPLOY.verifyStylesOnly(live, next, NEW_LEAD_ENTRY), [], 'style-only delta');
});

check('the verifier refuses a changed callback_data', () => {
  const live = fakeLive();
  const { next } = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
  next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields.callback_data = '=stage|X|Won';
  assert(DEPLOY.verifyStylesOnly(live, next, NEW_LEAD_ENTRY).some((m) => /callback_data changed/.test(m)), 'must refuse');
});

check('the verifier refuses a changed label', () => {
  const live = fakeLive();
  const { next } = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
  next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons[0].text = '📞 Звонок';
  assert(DEPLOY.verifyStylesOnly(live, next, NEW_LEAD_ENTRY).some((m) => /label changed/.test(m)), 'must refuse');
});

check('the verifier refuses an empty style, a danger style and an unknown style', () => {
  for (const [v, re] of [['', /empty style/], ['danger', /danger is not in the approved matrix/], ['blue', /unsupported style/]]) {
    const live = fakeLive();
    const { next } = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
    next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields.style = v;
    assert(DEPLOY.verifyStylesOnly(live, next, NEW_LEAD_ENTRY).some((m) => re.test(m)), 'must refuse ' + JSON.stringify(v));
  }
});

check('the verifier refuses a dropped or added button, and a changed credential', () => {
  const live1 = fakeLive();
  const n1 = DEPLOY.applyPlan(live1, NEW_LEAD_ENTRY).next;
  n1.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons.pop();
  assert(DEPLOY.verifyStylesOnly(live1, n1, NEW_LEAD_ENTRY).some((m) => /width changed/.test(m)), 'must refuse a dropped button');
  const live2 = fakeLive();
  const n2 = DEPLOY.applyPlan(live2, NEW_LEAD_ENTRY).next;
  n2.nodes[0].credentials.telegramApi.id = 'OTHER';
  assert(DEPLOY.verifyStylesOnly(live2, n2, NEW_LEAD_ENTRY).some((m) => /credentials changed/.test(m)), 'must refuse a credential change');
});

check('the verifier refuses a style on a node the plan never declared', () => {
  const live = fakeLive();
  const { next } = DEPLOY.applyPlan(live, NEW_LEAD_ENTRY);
  next.nodes.push({
    name: 'Some Other Alert', type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
    parameters: { inlineKeyboard: { rows: [{ row: { buttons: [{ text: 'x', additionalFields: { callback_data: 'y', style: 'primary' } }] } }] } }
  });
  const f = DEPLOY.verifyStylesOnly(live, next, NEW_LEAD_ENTRY);
  assert(f.some((m) => /node added|styled but not declared/.test(m)), 'must refuse: ' + f.join('|'));
});

check('the verifier refuses a changed connection or setting', () => {
  const live1 = fakeLive();
  const n1 = DEPLOY.applyPlan(live1, NEW_LEAD_ENTRY).next;
  n1.connections.A.main[0].push({ node: 'Z', type: 'main', index: 0 });
  assert(DEPLOY.verifyStylesOnly(live1, n1, NEW_LEAD_ENTRY).some((m) => /connections changed/.test(m)), 'must refuse');
  const live2 = fakeLive();
  const n2 = DEPLOY.applyPlan(live2, NEW_LEAD_ENTRY).next;
  n2.settings.executionOrder = 'v0';
  assert(DEPLOY.verifyStylesOnly(live2, n2, NEW_LEAD_ENTRY).some((m) => /settings changed/.test(m)), 'must refuse');
});

check('the X-Ray owner alert is styled by label because its buttons carry no callback_data', () => {
  const live = {
    name: 'X', settings: {}, connections: {},
    nodes: [{
      name: 'Telegram Owner Alert', type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
      parameters: { inlineKeyboard: { rows: [
        { row: { buttons: [{ text: '✅ Проверить анализ', additionalFields: { url: '=u1' } }] } },
        { row: { buttons: [{ text: '📊 Карточка лида', additionalFields: { url: '=u2' } }] } }
      ] } }
    }]
  };
  const entry = [{ workflowId: 'tNSMRoKlFB52vjge', workflow: 'X-Ray', node: 'Telegram Owner Alert', match: 'label' }];
  const { next } = DEPLOY.applyPlan(live, entry);
  eq(next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields.style, 'success', 'review button');
  eq(next.nodes[0].parameters.inlineKeyboard.rows[1].row.buttons[0].additionalFields.style, 'primary', 'CRM button');
  eq(DEPLOY.verifyStylesOnly(live, next, entry), [], 'style-only');
  assert(next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields.url === '=u1', 'url preserved');
});

check('an unknown X-Ray label gets no style rather than a guessed one', () => {
  const live = {
    name: 'X', settings: {}, connections: {},
    nodes: [{ name: 'Telegram Owner Alert', type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
      parameters: { inlineKeyboard: { rows: [{ row: { buttons: [{ text: '🆕 Что-то новое', additionalFields: { url: '=u' } }] } }] } } }]
  };
  const { next } = DEPLOY.applyPlan(live, [{ node: 'Telegram Owner Alert', match: 'label', workflow: 'X-Ray' }]);
  assert(!('style' in next.nodes[0].parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields), 'must stay neutral');
});

// ── the contract the styles must not disturb ───────────────────────────────────────────────────

check('callback_data for all five verbs is unchanged by the style work', () => {
  eq(LAA.callbackData ? null : null, null, 'noop');
  const kb = LAA.keyboard('priority', { deal_stage: 'Qualified', sla_status: 'Active' }, 'FIN-1');
  eq(kb.flat().map((b) => b.callback_data), [
    'done|FIN-1', 'snooze|FIN-1|24', 'stage|FIN-1|Discovery Scheduled', 'docs|FIN-1', 'nurture|FIN-1'
  ], 'callback grammar');
});

check('sameKeyboard compares only text and callback_data, so a style can never affect no-op detection', () => {
  const a = [[{ text: 'A', callback_data: 'done|1' }]];
  const b = [[{ text: 'A', callback_data: 'done|1', style: 'success' }]];
  assert(LAA.sameKeyboard(a, b), 'a style must not make two keyboards differ');
});

check('the NEW LEAD set still omits Обработано, so its keyboard can never show success', () => {
  const kb = LAA.keyboard('new_lead', { deal_stage: 'New', sla_status: 'Active' }, 'FIN-1');
  assert(kb.flat().every((b) => b.action !== 'done'), 'new_lead must not offer done');
  assert(kb.flat().filter((b) => b.style).every((b) => b.style === 'primary'), 'new_lead may only carry primary');
});

check('at most one emphasis of each kind appears in any keyboard, for every reachable state', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const st of SLOTS.states()) {
      const flat = LAA.keyboard(kind, st, 'X').flat();
      for (const v of ['success', 'primary']) {
        const n = flat.filter((b) => b.style === v).length;
        assert(n <= 1, kind + ' ' + JSON.stringify(st) + ' has ' + n + ' ' + v + ' buttons');
      }
    }
  }
});

check('no keyboard ever exceeds two buttons in a row, styles or not', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const st of SLOTS.states()) {
      for (const row of LAA.keyboard(kind, st, 'X')) { assert(row.length <= 2, kind + ' produced a row of ' + row.length); }
    }
  }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
