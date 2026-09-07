#!/usr/bin/env node
// FINMENTOR — Telegram inline-button STYLE, owner decision 2026-09-04. Presentation only.
//
//   node qa/telegram-button-styles.test.mjs
//
// Offline. Drives n8n/src/lead-alerts/actions.js (the module inlined into the live keyboard
// builders and the Command Center) and the built X-Ray SDK, and holds the whole policy:
// which buttons are emphasised, that neutral buttons carry NO style key at all, and that every
// callback_data, label, order and row composition is byte-identical to what production already
// sends. A style is decoration; nothing here may move a single byte of the handler contract.
//
// TRANSPORT. Bot API `InlineKeyboardButton.style` accepts exactly 'primary' | 'success' |
// 'danger'; omitted means the client's own style. n8n's Telegram node builds each button as
// `{ text }` then `Object.assign(button, additionalFields)`, so the key passes through verbatim —
// which is also why an EMPTY style must never be emitted: Telegram would answer 400.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const ACTIONS_SRC = read('n8n/src/lead-alerts/actions.js').replace('// __CRM_STAGE_RESOLVER__', '');
const A = new Function(ACTIONS_SRC + '\n; return LAA;')();
const XRAY_SDK = read('n8n/candidate/xray-analysis-workflow.sdk.js');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const LEAD = 'FIN-20260904-0001';
const ACTIVE = { deal_stage: 'Qualified', sla_status: 'Active' };
const kb = (kind, state) => A.keyboard(kind, state || ACTIVE, LEAD);
const flat = (rows) => rows.reduce((a, r) => a.concat(r), []);

// What production sent before this change: label, callback, row and position. Nothing here may move.
const BEFORE = {
  new_lead: [
    [['📞 Discovery', 'stage|' + LEAD + '|Discovery Scheduled'], ['📄 Документы', 'docs|' + LEAD]],
    [['⏰ На 24 часа', 'snooze|' + LEAD + '|24'], ['🗂 В наблюдение', 'nurture|' + LEAD]]
  ],
  priority: [
    [['✅ Обработано', 'done|' + LEAD], ['⏰ На 24 часа', 'snooze|' + LEAD + '|24']],
    [['📞 Discovery', 'stage|' + LEAD + '|Discovery Scheduled'], ['📄 Документы', 'docs|' + LEAD]],
    [['🗂 В наблюдение', 'nurture|' + LEAD]]
  ]
};
BEFORE.followup = BEFORE.priority;

console.log('\nFINMENTOR — Telegram button styles: emphasis added, contract frozen\n');

// ── 1. only supported values, and never an empty one ──────────────────────────────────────────
check('1. only primary / success / danger are ever emitted, and a neutral button has NO style key', () => {
  eq(JSON.stringify(A.STYLE_VALUES), JSON.stringify(['primary', 'success', 'danger']), 'the supported set');
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const b of flat(kb(kind))) {
      if ('style' in b) {
        assert(A.STYLE_VALUES.indexOf(b.style) !== -1, kind + '/' + b.action + ': unsupported style ' + JSON.stringify(b.style));
        assert(typeof b.style === 'string' && b.style.length > 0, kind + '/' + b.action + ': empty style would be a 400');
      }
    }
  }
  for (const v of Object.values(A.STYLE)) { assert(A.STYLE_VALUES.indexOf(v) !== -1, 'policy names an unsupported style: ' + v); }
});

// ── 2. callback_data byte-identical ───────────────────────────────────────────────────────────
check('2. callback_data is byte-identical to what production already sends', () => {
  eq(A.callbackData('done', LEAD), 'done|' + LEAD, 'done');
  eq(A.callbackData('snooze', LEAD), 'snooze|' + LEAD + '|24', 'snooze');
  eq(A.callbackData('discovery', LEAD), 'stage|' + LEAD + '|Discovery Scheduled', 'discovery');
  eq(A.callbackData('docs', LEAD), 'docs|' + LEAD, 'docs');
  eq(A.callbackData('nurture', LEAD), 'nurture|' + LEAD, 'nurture');
  eq(A.callbackData('won', LEAD), '', 'won is still never emitted');
  for (const kind of Object.keys(BEFORE)) {
    const got = kb(kind).map((r) => r.map((b) => b.callback_data));
    const want = BEFORE[kind].map((r) => r.map((c) => c[1]));
    eq(JSON.stringify(got), JSON.stringify(want), kind + ': callback_data moved');
  }
});

// ── 3 / 4 / 5. rows, order, labels ────────────────────────────────────────────────────────────
check('3. row count and row composition are unchanged', () => {
  for (const kind of Object.keys(BEFORE)) {
    eq(kb(kind).length, BEFORE[kind].length, kind + ': row count');
    eq(JSON.stringify(kb(kind).map((r) => r.length)), JSON.stringify(BEFORE[kind].map((r) => r.length)), kind + ': buttons per row');
    eq(A.shape(kb(kind)), kind === 'new_lead' ? 'KB22' : 'KB221', kind + ': shape');
  }
});
check('4. button order is unchanged, position by position', () => {
  for (const kind of Object.keys(BEFORE)) {
    const got = kb(kind).map((r) => r.map((b) => b.action));
    eq(JSON.stringify(got), JSON.stringify(kind === 'new_lead'
      ? [['discovery', 'docs'], ['snooze', 'nurture']]
      : [['done', 'snooze'], ['discovery', 'docs'], ['nurture']]), kind + ': order');
  }
});
check('5. button labels are unchanged (the approved copy is frozen)', () => {
  for (const kind of Object.keys(BEFORE)) {
    const got = kb(kind).map((r) => r.map((b) => b.text));
    const want = BEFORE[kind].map((r) => r.map((c) => c[0]));
    eq(JSON.stringify(got), JSON.stringify(want), kind + ': labels');
  }
  eq(JSON.stringify(Object.values(A.LABEL)), JSON.stringify(['✅ Обработано', '⏰ На 24 часа', '📞 Discovery', '📄 Документы', '🗂 В наблюдение']), 'the label set');
});

// ── 6. neutral buttons carry no style ─────────────────────────────────────────────────────────
check('6. snooze, docs and nurture carry no style key at all', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const b of flat(kb(kind))) {
      if (['snooze', 'docs', 'nurture'].indexOf(b.action) !== -1) {
        assert(!('style' in b), kind + '/' + b.action + ' carries style=' + JSON.stringify(b.style));
      }
    }
  }
  for (const a of ['snooze', 'docs', 'nurture']) { assert(!(a in A.STYLE), 'the policy styles ' + a); }
});

// ── 7. no danger without a destructive action ─────────────────────────────────────────────────
check('7. no danger style exists, because no owner-alert action is destructive', () => {
  for (const kind of ['new_lead', 'priority', 'followup']) {
    for (const b of flat(kb(kind))) { assert(b.style !== 'danger', kind + '/' + b.action + ' is red without being destructive'); }
  }
  assert(Object.values(A.STYLE).indexOf('danger') === -1, 'the policy declares a danger button');
  assert(!/style: 'danger'|"style":"danger"/.test(XRAY_SDK), 'the X-Ray keyboard declares a danger button');
});

// ── the emphasis policy itself ────────────────────────────────────────────────────────────────
check('the affirmative close is success and the forward move is primary — one emphasis each', () => {
  const p = kb('priority');
  eq(p[0][0].style, 'success', '«Обработано» is not success');
  eq(p[1][0].style, 'primary', '«Discovery» is not primary');
  for (const kind of ['new_lead', 'priority', 'followup']) {
    const styled = flat(kb(kind)).filter((b) => b.style);
    eq(styled.filter((b) => b.style === 'success').length <= 1, true, kind + ': more than one success');
    eq(styled.filter((b) => b.style === 'primary').length <= 1, true, kind + ': more than one primary');
    assert(styled.length <= 2, kind + ': ' + styled.length + ' emphasised buttons — the keyboard is turning into a rainbow');
  }
});
check('colour never encodes priority or the financial zone', () => {
  const hot = kb('priority', { deal_stage: 'Qualified', sla_status: 'Active', priority: 'HOT', financial_zone: 'RED' });
  const cold = kb('priority', { deal_stage: 'Qualified', sla_status: 'Active', priority: 'COLD', financial_zone: 'GREEN' });
  eq(JSON.stringify(hot.map((r) => r.map((b) => b.style || null))), JSON.stringify(cold.map((r) => r.map((b) => b.style || null))),
    'the keyboard styling changed with priority/zone');
});
check('no custom colour is invented anywhere — only the three API values', () => {
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(JSON.stringify(A.STYLE)), 'a hex colour in the policy');
  const styles = XRAY_SDK.match(/style: '([^']*)'/g) || [];
  for (const s of styles) { assert(/'(primary|success|danger)'/.test(s), 'X-Ray declares ' + s); }
});

// ── 8 / 9. the edit path and the no-op path still hold ────────────────────────────────────────
check('8. the edit-message path rebuilds the SAME keyboard, styles included', () => {
  // `sameKeyboard` decides whether an edit is a no-op; it must still compare the real keyboards.
  const before = kb('priority');
  const after = kb('priority');
  assert(A.sameKeyboard(before, after), 'an unchanged keyboard no longer compares equal');
  const moved = JSON.parse(JSON.stringify(before)); moved[0].reverse();
  assert(!A.sameKeyboard(before, moved), 'a reordered keyboard compares equal');
});
check('9. no-op edit classification is untouched by styling', () => {
  eq(A.classifyEdit({ error: 'Bad Request: message is not modified' }), 'EDIT_NOOP', 'no-op');
  eq(A.classifyEdit({ ok: true, result: { message_id: 1 } }), 'EDIT_UPDATED', 'updated');
  eq(A.classifyEdit({ error: 'Bad Request: message to edit not found' }), 'EDIT_FAILED', 'failed');
});

// ── 10. RU and RO owners see the same keyboard ────────────────────────────────────────────────
check('10. the owner keyboard is one keyboard — it never varies with the client locale', () => {
  // The module takes no locale: the owner console is Russian for every lead (2026-09-04 decision).
  assert(!/locale|language/i.test(ACTIONS_SRC.slice(ACTIONS_SRC.indexOf('function keyboard'), ACTIONS_SRC.indexOf('function shape'))),
    'the keyboard builder reads a locale');
  eq(JSON.stringify(kb('priority')), JSON.stringify(kb('priority')), 'not deterministic');
});

// ── the X-Ray owner alert ─────────────────────────────────────────────────────────────────────
check('X-Ray owner alert: review is success, CRM is primary, urls and labels unchanged', () => {
  assert(/text: '✅ Проверить анализ', additionalFields: \{ url: [\s\S]{0,140}?style: 'success' \}/.test(XRAY_SDK), 'the review button is not success');
  assert(/text: '📊 Карточка лида', additionalFields: \{ url: [\s\S]{0,140}?style: 'primary' \}/.test(XRAY_SDK), 'the CRM button is not primary');
  assert(/owner_alert\.review_url/.test(XRAY_SDK) && /owner_alert\.crm_url/.test(XRAY_SDK), 'a url expression changed');
  // the approved notice has no keyboard, and styling must not have invented one
  const approved = XRAY_SDK.slice(XRAY_SDK.indexOf("name: 'Telegram Analysis Approved'"));
  assert(!/inlineKeyboard/.test(approved.slice(0, 600)), 'the approved notice grew a keyboard');
});

// ── the literal NEW LEAD keyboard candidate ───────────────────────────────────────────────────
check('the NEW LEAD keyboard candidate carries the styles and nothing else moved', () => {
  const cand = JSON.parse(read('n8n/candidate/QmIyEW2ZEqKregmN.alert-keyboards-candidate.json'));
  const node = cand.nodes.find((n) => n.name === 'Telegram Lead Alert');
  const rows = node.parameters.inlineKeyboard.rows.map((r) => r.row.buttons);
  eq(JSON.stringify(rows.map((r) => r.map((b) => b.text))),
    JSON.stringify([['📞 Discovery', '📄 Документы'], ['⏰ На 24 часа', '🗂 В наблюдение']]), 'labels');
  eq(JSON.stringify(rows.map((r) => r.map((b) => b.additionalFields.callback_data))),
    JSON.stringify([['=stage|{{$json.lead_id}}|Discovery Scheduled', '=docs|{{$json.lead_id}}'],
      ['=snooze|{{$json.lead_id}}|24', '=nurture|{{$json.lead_id}}']]), 'callback_data');
  eq(JSON.stringify(rows.map((r) => r.map((b) => b.additionalFields.style || null))),
    JSON.stringify([['primary', null], [null, null]]), 'styles');
  for (const r of rows) { for (const b of r) { assert(b.additionalFields.style !== '', 'an empty style would be a 400: ' + b.text); } }
  // no duplicated nodes: the candidate must mirror live's node set
  const names = cand.nodes.map((n) => n.name);
  eq(names.length, new Set(names).size, 'the candidate carries duplicated nodes');
});

// ── 12. floors are not lowered ────────────────────────────────────────────────────────────────
check('12. the assertion floors for the touched gates were not lowered', () => {
  const base = JSON.parse(read('qa/assertion-baseline.json'));
  const g = base.gates;
  assert(g['lead-alerts-actions.test.mjs'] >= 57, 'the actions floor fell to ' + g['lead-alerts-actions.test.mjs']);
  assert(g['lead-alerts-edit-noop.test.mjs'] >= 17, 'the edit-noop floor fell');
  assert(g['lead-alerts-candidates.test.mjs'] >= 18, 'the candidates floor fell');
  assert(g['xray-analysis.test.mjs'] >= 143, 'the X-Ray floor fell');
});

console.log('\nASSERTIONS: ' + pass + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
