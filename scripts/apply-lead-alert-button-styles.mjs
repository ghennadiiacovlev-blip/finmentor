#!/usr/bin/env node
// FINMENTOR — apply the approved button STYLE policy to the ONE literal owner keyboard.
//
//   node scripts/apply-lead-alert-button-styles.mjs            update the tracked candidate
//   node scripts/apply-lead-alert-button-styles.mjs --check    verify it is current, write nothing
//
// REPO-ONLY. Never contacts n8n, never deploys.
//
// WHY A SEPARATE STEP. The NEW LEAD keyboard in Lead Intake is the only owner keyboard whose
// buttons are literals in the node (SLA and Follow-up fill their slots from `$json.kb`). Its
// candidate is produced by scripts/deploy-lead-alert-keyboards.mjs — which is NOT safe to re-run
// now: that script ADDS the Stage-1 keyboard nodes, and they are already live, so a second run
// emits a candidate carrying three duplicated nodes (verified 2026-09-04: SLA 13 -> 16 nodes,
// Follow-up 18 -> 21). This step therefore edits only what the style policy owns: the `style`
// key on the buttons of `Telegram Lead Alert`, matched to the module by callback verb.
//
// A neutral button gets NO style key. An empty style is not a valid Bot API value and Telegram
// answers 400, so absence is the only correct representation of "default".

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'QmIyEW2ZEqKregmN.alert-keyboards-candidate.json');
const NODE = 'Telegram Lead Alert';

const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace('// __CRM_STAGE_RESOLVER__', '');
const LAA = new Function(ACTIONS_SRC + '\n; return LAA;')();

// callback verb -> action name, so a button is matched by the contract it already carries.
const VERB = { stage: 'discovery', docs: 'docs', snooze: 'snooze', nurture: 'nurture', done: 'done' };

export function styleFor(callbackData) {
  const verb = String(callbackData || '').replace(/^=/, '').split('|')[0].trim();
  const action = VERB[verb];
  return action ? (LAA.STYLE[action] || '') : '';
}

export function applyStyles(candidate) {
  const wf = JSON.parse(JSON.stringify(candidate));
  const node = wf.nodes.find((n) => n.name === NODE);
  if (!node || !node.parameters || !node.parameters.inlineKeyboard) { throw new Error('keyboard node missing: ' + NODE); }
  const changed = [];
  for (const row of node.parameters.inlineKeyboard.rows || []) {
    for (const b of (row.row || {}).buttons || []) {
      const af = b.additionalFields || {};
      const want = styleFor(af.callback_data);
      const had = af.style;
      if (want) { if (had !== want) { af.style = want; changed.push(b.text + '→' + want); } }
      else if ('style' in af) { delete af.style; changed.push(b.text + '→(none)'); }
      b.additionalFields = af;
    }
  }
  return { wf, changed };
}

// The delta this step is allowed to make: nothing but `style` keys on that one node.
export function verifyStylesOnly(before, after) {
  const f = [];
  const strip = (wf) => {
    const c = JSON.parse(JSON.stringify(wf));
    const n = c.nodes.find((x) => x.name === NODE);
    if (n) { for (const r of n.parameters.inlineKeyboard.rows || []) { for (const b of (r.row || {}).buttons || []) { delete (b.additionalFields || {}).style; } } }
    return JSON.stringify(c);
  };
  if (strip(before) !== strip(after)) { f.push('something other than a style key changed'); }
  const node = after.nodes.find((x) => x.name === NODE);
  for (const r of node.parameters.inlineKeyboard.rows || []) {
    for (const b of (r.row || {}).buttons || []) {
      const s = (b.additionalFields || {}).style;
      if (s !== undefined && LAA.STYLE_VALUES.indexOf(s) === -1) { f.push('unsupported style on ' + b.text + ': ' + JSON.stringify(s)); }
      if (s === '') { f.push('empty style on ' + b.text + ' would be a 400'); }
    }
  }
  return f;
}

const isMain = process.argv[1] && process.argv[1].endsWith('apply-lead-alert-button-styles.mjs');
if (isMain) {
  const CHECK = process.argv.slice(2).includes('--check');
  const before = JSON.parse(readFileSync(CANDIDATE, 'utf8'));
  const { wf, changed } = applyStyles(before);
  const f = verifyStylesOnly(before, wf);
  if (f.length) { console.error('STOPPED: ' + f.join(' | ')); process.exitCode = 1; }
  else if (CHECK) {
    if (changed.length) { console.error('STOPPED: the candidate is not current — ' + changed.join(', ')); process.exitCode = 1; }
    else { console.log('  PASS  the NEW LEAD keyboard candidate already carries the approved styles'); }
  } else {
    writeFileSync(CANDIDATE, JSON.stringify(wf, null, 2) + '\n', 'utf8');
    console.log('  PASS  styles applied to ' + NODE + ': ' + (changed.join(', ') || 'nothing to change'));
  }
}
