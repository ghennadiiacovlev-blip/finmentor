#!/usr/bin/env node
// FINMENTOR — A5 (2026-09-04): the duplicate «FINMENTOR AI BRIEF» suppression, regression-proofed.
//
//   node qa/ai-brief-suppression.test.mjs
//
// Offline. Drives the pure functions of scripts/mute-lead-intake-ai-brief.mjs against the tracked
// Lead Intake candidate (the full 109-node workflow as inlined for the presentation pass) and the
// tracked X-Ray candidate, and proves that the prepared change:
//   * disables ONLY the Telegram node that sends the overlapping AI brief;
//   * leaves NEW LEAD (HOT / WARM / INCOMPLETE) Telegram nodes enabled and byte-identical;
//   * never touches the X-Ray workflow (review-required and approved notices live there);
//   * changes no edge (lead creation, CRM writes, AI_Plans sheet write all keep their wiring);
//   * changes no non-Telegram node, no credential, no setting, no name.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { muteCandidate, verifyDelta, MUTED_NODE, FEEDER_NODE, LEAD_INTAKE_ID } from '../scripts/mute-lead-intake-ai-brief.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const live = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-alerts-lead-intake-candidate.json'), 'utf8'));
const xray = readFileSync(join(ROOT, 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js'), 'utf8');
const NEW_LEAD_TG = ['Telegram Lead Alert', 'Telegram Warm Alert', 'Telegram Incomplete Alert'];
const byName = (w, n) => w.nodes.find((x) => x.name === n);
const outEdges = (w, n) => ((w.connections[n] || {}).main || []).flat().map((e) => e.node);

console.log('\nFINMENTOR — duplicate AI BRIEF suppression, regression gate\n');

check('the stand-in is the Lead Intake workflow with all four owner Telegram nodes present', () => {
  eq(live.name, 'FINMENTOR Lead Intake PREMIUM FINAL', 'name');
  for (const n of NEW_LEAD_TG.concat([MUTED_NODE])) { assert(byName(live, n) && byName(live, n).type === 'n8n-nodes-base.telegram', 'missing Telegram node ' + n); }
  eq(LEAD_INTAKE_ID, 'QmIyEW2ZEqKregmN', 'the script targets the Lead Intake id');
});

const cand = muteCandidate(live);

check('exactly ONE node changes, and it is the AI brief sender (disabled, not removed)', () => {
  eq(cand.nodes.length, live.nodes.length, 'node count');
  const changed = cand.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(byName(live, n.name))).map((n) => n.name);
  eq(JSON.stringify(changed), JSON.stringify([MUTED_NODE]), 'changed nodes');
  eq(byName(cand, MUTED_NODE).disabled, true, 'disabled flag');
  const strip = (n) => { const k = JSON.parse(JSON.stringify(n)); delete k.disabled; return JSON.stringify(k); };
  eq(strip(byName(cand, MUTED_NODE)), strip(byName(live, MUTED_NODE)), 'the muted node changed beyond the flag');
});

check('NEW LEAD alerts (HOT, WARM, INCOMPLETE) stay enabled and byte-identical', () => {
  for (const n of NEW_LEAD_TG) {
    assert(byName(cand, n).disabled !== true, n + ' was disabled');
    eq(JSON.stringify(byName(cand, n)), JSON.stringify(byName(live, n)), n + ' changed');
  }
});

check('X-RAY REVIEW REQUIRED and X-RAY APPROVED live in the X-Ray workflow, which the script never touches', () => {
  assert(/name: 'Telegram Owner Alert'/.test(xray) && /name: 'Telegram Analysis Approved'/.test(xray), 'the X-Ray notices are not where expected');
  assert(!byName(live, 'Telegram Owner Alert') && !byName(live, 'Telegram Analysis Approved'), 'the X-Ray notices appear in Lead Intake');
  assert(!/QmIyEW2ZEqKregmN|Telegram AI Work Plan/.test(xray), 'the X-Ray candidate references the Lead Intake brief');
});

check('no edge moves: lead creation, CRM writes, the AI_Plans write and the alert routing keep their wiring', () => {
  eq(JSON.stringify(cand.connections), JSON.stringify(live.connections), 'connections');
  eq(JSON.stringify(cand.settings), JSON.stringify(live.settings), 'settings');
  eq(cand.name, live.name, 'name');
  assert(outEdges(live, FEEDER_NODE).includes(MUTED_NODE), 'the feeder no longer feeds the brief');
  eq(outEdges(live, MUTED_NODE).length, 0, 'the brief sender has downstream nodes — muting it would suppress more than a message');
  // the AI plan row still reaches the sheet through its own branch, not through the muted node
  const parse = outEdges(live, 'Parse AI Plan');
  assert(parse.includes('Build Short AI Telegram') && parse.includes('Build AI Plan Row'), 'the AI_Plans branch is not a sibling of the brief');
  assert(outEdges(live, 'Build AI Plan Row').includes('Save AI Plan'), 'Save AI Plan lost its feeder');
});

check('no non-Telegram side effect changes: every Sheets, Code, Set, IF, HTTP and webhook node is byte-identical', () => {
  for (const n of live.nodes) {
    if (n.type === 'n8n-nodes-base.telegram') { continue; }
    eq(JSON.stringify(byName(cand, n.name)), JSON.stringify(n), n.name + ' changed');
  }
  const sheets = live.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets').length;
  eq(cand.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets').length, sheets, 'Sheets node count');
});

check('credentials, chat routing and triggers are untouched', () => {
  for (const n of cand.nodes) {
    const l = byName(live, n.name);
    eq(JSON.stringify(n.credentials || null), JSON.stringify(l.credentials || null), n.name + ' credentials');
    if (n.type === 'n8n-nodes-base.telegram') { eq(n.parameters.chatId, l.parameters.chatId, n.name + ' chatId'); }
    if (/trigger|webhook/i.test(n.type)) { eq(JSON.stringify(n), JSON.stringify(l), n.name + ' trigger changed'); }
  }
});

check('verifyDelta accepts the prepared candidate and refuses anything wider', () => {
  eq(verifyDelta(live, cand).join(' | '), '', 'the prepared delta was refused');
  const wider = JSON.parse(JSON.stringify(cand)); byName(wider, 'Telegram Lead Alert').disabled = true;
  assert(verifyDelta(live, wider).length > 0, 'disabling NEW LEAD was accepted');
  const rewired = JSON.parse(JSON.stringify(cand)); delete rewired.connections[FEEDER_NODE];
  assert(verifyDelta(live, rewired).length > 0, 'a removed edge was accepted');
  const edited = JSON.parse(JSON.stringify(cand)); byName(edited, 'Save Lead to CRM').parameters.__x = 1;
  assert(verifyDelta(live, edited).length > 0, 'a CRM write change was accepted');
  const undone = JSON.parse(JSON.stringify(live)); assert(verifyDelta(live, undone).length > 0, 'an unchanged workflow was accepted as muted');
});

check('deterministic: the candidate is byte-identical across runs', () => {
  eq(JSON.stringify(muteCandidate(live)), JSON.stringify(cand), 'nondeterministic candidate');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
