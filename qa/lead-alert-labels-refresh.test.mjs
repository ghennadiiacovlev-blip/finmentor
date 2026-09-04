#!/usr/bin/env node
// FINMENTOR — OWNER CORRECTION 2026-09-04: «🗂 В Nurture» → «🗂 В наблюдение», regression-proofed.
//
//   node qa/lead-alert-labels-refresh.test.mjs
//
// Offline. Drives the pure functions of scripts/refresh-lead-alert-labels.mjs:
//   * on the tracked Command Center candidate that still carries the OLD label (the live stand-in),
//     the refresh rewrites exactly the two module-carrying nodes, keeps every node tail byte-exact,
//     and leaves edges, settings, credentials and every other node untouched;
//   * callback_data is byte-identical before and after — a visible label is not a callback contract;
//   * on the refreshed candidates the refresh is a no-op (idempotent);
//   * a tampered candidate (callback changed, tail changed, another label changed) is refused.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { sources, splitNode, refreshWorkflow, verifyRefresh, WORKFLOWS, OLD_LABEL, NEW_LABEL } from '../scripts/refresh-lead-alert-labels.mjs';

// The line the actions module ends with, used to lift just the module out of a node body.
const END_ACTIONS = '// =================== END FINMENTOR LEAD ALERT ACTIONS ===================';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a).slice(0, 200) + ', want ' + JSON.stringify(b).slice(0, 200) + ')'); };
const load = (f) => JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', f), 'utf8'));
const byName = (w, n) => w.nodes.find((x) => x.name === n);

const SRC = sources();
const CC_SPEC = WORKFLOWS.find((w) => w.label === 'Command Center');
const OLD_CC = load('lead-command-center-edit-noop-candidate.json');   // still carries «В Nurture»

console.log('\nFINMENTOR — Lead Alert label refresh, regression gate\n');

check('the current module carries the new label and the same callback_data grammar', () => {
  const A = new Function(SRC.actionsBlock + '\n; return LAA;')();
  eq(A.LABEL.nurture, NEW_LABEL, 'label');
  eq(A.callbackData('nurture', 'FIN-1'), 'nurture|FIN-1', 'nurture callback');
  eq(A.callbackData('snooze', 'FIN-1'), 'snooze|FIN-1|24', 'snooze callback');
  eq(A.callbackData('discovery', 'FIN-1'), 'stage|FIN-1|Discovery Scheduled', 'discovery callback');
  eq(A.callbackData('done', 'FIN-1'), 'done|FIN-1', 'done callback');
  eq(A.callbackData('docs', 'FIN-1'), 'docs|FIN-1', 'docs callback');
  assert(!SRC.actionsBlock.includes(OLD_LABEL), 'the old label survives in the module');
});

check('the live stand-in (edit-no-op Command Center candidate) carries the OLD label in both module nodes', () => {
  for (const n of CC_SPEC.codeNodes) { assert(byName(OLD_CC, n).parameters.jsCode.includes(OLD_LABEL), n + ' lacks the old label'); }
});

let refreshed;
check('refresh rewrites exactly the two module-carrying nodes and nothing else', () => {
  const r = refreshWorkflow(OLD_CC, CC_SPEC, SRC);
  refreshed = r.next;
  eq(JSON.stringify(r.touched), JSON.stringify(['Find & Build Update', 'Verify Mutation']), 'touched');
  eq(verifyRefresh(OLD_CC, refreshed, CC_SPEC, SRC).join(' | '), '', 'verify');
  const changed = refreshed.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(byName(OLD_CC, n.name))).map((n) => n.name);
  eq(JSON.stringify(changed), JSON.stringify(['Find & Build Update', 'Verify Mutation']), 'changed nodes');
  eq(JSON.stringify(refreshed.connections), JSON.stringify(OLD_CC.connections), 'connections');
  eq(JSON.stringify(refreshed.settings), JSON.stringify(OLD_CC.settings), 'settings');
});

check('every rewritten node keeps its tail byte-for-byte; only the module blocks are replaced', () => {
  for (const n of CC_SPEC.codeNodes) {
    const before = splitNode(byName(OLD_CC, n).parameters.jsCode);
    const after = splitNode(byName(refreshed, n).parameters.jsCode);
    eq(after.tail, before.tail, n + ' tail');
    eq(after.actions, SRC.actionsBlock, n + ' actions block');
    assert(!after.actions.includes(OLD_LABEL) && after.actions.includes(NEW_LABEL), n + ' label');
    assert(before.tail.includes('STAGE 2') || before.tail.length > 200, n + ' tail is suspiciously short');
  }
  // Find & Build Update also carries the presenter and tz blocks; Verify Mutation carries the presenter only.
  const f = splitNode(byName(refreshed, 'Find & Build Update').parameters.jsCode);
  const v = splitNode(byName(refreshed, 'Verify Mutation').parameters.jsCode);
  assert(f.la === SRC.laBlock && f.tz === SRC.tzBlock, 'Find & Build Update blocks');
  assert(v.la === SRC.laBlock && v.tz === '', 'Verify Mutation blocks');
});

check('the refreshed Command Center still decides and rebuilds keyboards with the new label (executed)', () => {
  const code = byName(refreshed, 'Find & Build Update').parameters.jsCode;
  const head = code.slice(0, code.indexOf('// ── STAGE 2'));
  const A = new Function(head + '\n; return LAA;')();
  const kb = A.keyboard('priority', { deal_stage: 'Qualified', sla_status: 'Active' }, 'FIN-1');
  eq(JSON.stringify(kb.map((r) => r.map((b) => b.text))), JSON.stringify([['✅ Обработано', '⏰ На 24 часа'], ['📞 Discovery', '📄 Документы'], [NEW_LABEL]]), 'keyboard labels');
  eq(JSON.stringify(kb.map((r) => r.map((b) => b.callback_data))), JSON.stringify([['done|FIN-1', 'snooze|FIN-1|24'], ['stage|FIN-1|Discovery Scheduled', 'docs|FIN-1'], ['nurture|FIN-1']]), 'keyboard callbacks');
});

// GATE 2, 2026-09-04. The keyboard-only workflows (SLA, Follow-up) deliberately still carry the
// PRE-terminal-close copy of the actions module: the owner scoped the Won/Lost correction to the
// Command Center, so those two were not redeployed. That is a real, bounded divergence and it is
// asserted as such rather than waved through — the only permitted difference is the terminal-close
// addition, and the KEYBOARD OUTPUT they actually use must stay byte-identical.
const TERMINAL_ONLY = ['COMMAND_ONLY', 'storedTerminalStage', "if (c === 'won')", "if (c === 'lost')"];

check('the keyboard candidates diverge from the module ONLY by the terminal close, with identical keyboards', () => {
  for (const spec of WORKFLOWS.filter((w) => w.label !== 'Command Center')) {
    const cand = load(spec.candidate);
    const r = refreshWorkflow(cand, spec, SRC);
    assert(!JSON.stringify(cand).includes(OLD_LABEL), spec.label + ' carries the old label');
    if (!spec.codeNodes.length) { eq(JSON.stringify(r.touched), '[]', spec.label + ' touched'); continue; }
    // Whatever the refresh would change must be the terminal close and nothing else.
    for (const name of spec.codeNodes) {
      const before = byName(cand, name).parameters.jsCode;
      const after = byName(r.next, name).parameters.jsCode;
      for (const token of TERMINAL_ONLY) {
        assert(before.indexOf(token) === -1, spec.label + '/' + name + ' already carries ' + token);
        assert(after.indexOf(token) !== -1, spec.label + '/' + name + ' refresh did not add ' + token);
      }
      // The keyboard each side produces — the ONLY thing these nodes consume — must be identical.
      const kbOf = (code) => {
        const head = code.slice(0, code.indexOf(END_ACTIONS) + END_ACTIONS.length);
        const M = new Function(head + '\n; return LAA;')();
        const out = [];
        for (const kind of ['new_lead', 'priority', 'followup']) {
          for (const st of ['New', 'Qualified', 'Discovery Scheduled', 'Documents Requested', 'Won', 'Lost', 'Nurture', 'ceva necunoscut']) {
            const rows = M.keyboard(kind, { deal_stage: st, sla_status: 'Active' }, 'FIN-1');
            out.push([kind, st, M.shape(rows), rows.map((rr) => rr.map((b) => [b.text, b.callback_data]))]);
          }
        }
        return JSON.stringify(out);
      };
      eq(kbOf(after), kbOf(before), spec.label + '/' + name + ': the terminal close changed a keyboard');
    }
  }
  // The Command Center's LABELS candidate is the artifact of the earlier label checkpoint. It is
  // deliberately left at that point in time — the terminal close ships through its own candidate
  // (.uat/<id>.terminal-close-candidate.json), and back-dating this one would misrepresent what
  // the label deploy actually contained. So the same bounded rule applies: the only thing a
  // refresh would add is the terminal close.
  const cc = load('lead-command-center-labels-candidate.json');
  const ccRefreshed = refreshWorkflow(cc, CC_SPEC, SRC);
  for (const name of CC_SPEC.codeNodes) {
    const before = byName(cc, name).parameters.jsCode;
    const after = byName(ccRefreshed.next, name).parameters.jsCode;
    for (const token of TERMINAL_ONLY) {
      assert(before.indexOf(token) === -1, 'CC labels candidate already carries ' + token);
      assert(after.indexOf(token) !== -1, 'CC labels candidate refresh did not add ' + token);
    }
  }
  assert(!JSON.stringify(cc).includes(OLD_LABEL), 'Command Center labels candidate carries the old label');
});

check('Lead Intake NEW LEAD keyboard: one label changed, callback_data byte-identical, two buttons per row', () => {
  const spec = WORKFLOWS.find((w) => w.label === 'Lead Intake');
  const cand = load(spec.candidate);
  const kb = byName(cand, 'Telegram Lead Alert').parameters.inlineKeyboard.rows.map((r) => r.row.buttons);
  eq(JSON.stringify(kb.map((r) => r.map((b) => b.text))), JSON.stringify([['📞 Discovery', '📄 Документы'], ['⏰ На 24 часа', NEW_LABEL]]), 'labels');
  eq(JSON.stringify(kb.map((r) => r.map((b) => b.additionalFields.callback_data))), JSON.stringify([['=stage|{{$json.lead_id}}|Discovery Scheduled', '=docs|{{$json.lead_id}}'], ['=snooze|{{$json.lead_id}}|24', '=nurture|{{$json.lead_id}}']]), 'callback_data');
  for (const r of kb) { assert(r.length <= 2, 'more than two buttons in a row'); }
});

check('tampering is refused: a changed callback, a changed tail, a second label, an edited CRM node', () => {
  const li = WORKFLOWS.find((w) => w.label === 'Lead Intake'); const liCand = load(li.candidate);
  const t1 = JSON.parse(JSON.stringify(liCand)); byName(t1, 'Telegram Lead Alert').parameters.inlineKeyboard.rows[1].row.buttons[1].additionalFields.callback_data = '=watch|{{$json.lead_id}}';
  assert(verifyRefresh(liCand, t1, li, SRC).length > 0, 'a callback change was accepted');
  const t2 = JSON.parse(JSON.stringify(liCand)); byName(t2, 'Telegram Lead Alert').parameters.inlineKeyboard.rows[0].row.buttons[0].text = '📞 Звонок';
  assert(verifyRefresh(liCand, t2, li, SRC).length > 0, 'a second label change was accepted');
  const t3 = JSON.parse(JSON.stringify(refreshed)); byName(t3, 'Find & Build Update').parameters.jsCode += '\n// tampered';
  assert(verifyRefresh(OLD_CC, t3, CC_SPEC, SRC).length > 0, 'a tail change was accepted');
  const t4 = JSON.parse(JSON.stringify(refreshed)); const other = t4.nodes.find((n) => !CC_SPEC.codeNodes.includes(n.name)); other.parameters = Object.assign({}, other.parameters, { __x: 1 });
  assert(verifyRefresh(OLD_CC, t4, CC_SPEC, SRC).length > 0, 'an undeclared node change was accepted');
});

check('splitNode refuses layouts it does not recognise', () => {
  for (const bad of ['', 'const x = 1;', '// ===================== FINMENTOR LEAD ALERT ACTIONS\nno end marker']) {
    let threw = false; try { splitNode(bad); } catch (e) { threw = true; }
    assert(threw, 'accepted: ' + JSON.stringify(bad).slice(0, 40));
  }
});

check('deterministic: the refreshed candidate is byte-identical across runs', () => {
  eq(JSON.stringify(refreshWorkflow(OLD_CC, CC_SPEC, SRC).next), JSON.stringify(refreshed), 'nondeterministic');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
