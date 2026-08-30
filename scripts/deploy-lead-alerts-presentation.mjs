#!/usr/bin/env node
// FINMENTOR — deploy the Lead Alerts presentation candidates.
//
//   node scripts/deploy-lead-alerts-presentation.mjs --dry-run
//   node scripts/deploy-lead-alerts-presentation.mjs --confirm
//
// ── WHAT IS BEING WRITTEN ──────────────────────────────────────────────────────────────────────
//
// Five live, ACTIVE production workflows, two of which fire hourly. In each one: the tail of one to
// three builder Code nodes, and the `text` + `parse_mode` of their Telegram nodes. Nothing else.
//
// ── THE FIVE THINGS THIS REFUSES TO DO ─────────────────────────────────────────────────────────
//
//   1. It will not write a workflow whose live bytes differ from the snapshot the candidate was
//      built from. That snapshot is also the rollback artifact, deliberately: a candidate built on
//      anything but the exact bytes it replaces is a candidate that reverts what it did not know.
//   2. It will not write a candidate that adds, removes or renames a node, or moves an edge.
//   3. It will not write a candidate that changes a node the builder did not declare — including
//      every trigger, schedule, Sheets read, Postgres write, If, Switch and credential.
//   4. It will not change any workflow's `active` flag, in either direction.
//   5. It will not proceed at all unless both offline gates pass FIRST. A presentation change that
//      has not been executed against synthetic input is a change that fails on the owner's next
//      real alert, at 08:30, with the message lost.
//
// Each workflow is written and READ BACK before the next is touched, so a failure stops the run
// with at most one workflow changed rather than five half-changed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// workflow id, label, snapshot (= rollback), candidate, declared builder nodes, declared Telegram nodes
const TARGETS = [
  ['imeJIDeNyaWDyXzh', 'Daily Lead Digest',
    'imeJIDeNyaWDyXzh.pre-lead-alerts-presentation.json', 'lead-alerts-daily-digest-candidate.json',
    ['Build Daily Digest'], ['Telegram Daily Digest']],
  ['LZ2mvKXbBikmeVTn', 'SLA Lead Watch',
    'LZ2mvKXbBikmeVTn.pre-lead-alerts-presentation.json', 'lead-alerts-sla-watch-candidate.json',
    ['SLA Select'], ['Telegram SLA Alert']],
  ['zeLOCuf0K1bkaKl2', 'Followup Sequence',
    'zeLOCuf0K1bkaKl2.pre-lead-alerts-presentation.json', 'lead-alerts-followup-candidate.json',
    ['Build Followup Plan'], ['Telegram Followup Reminder']],
  ['RBiFLhVjizMkAzrK', 'Error Monitor',
    'RBiFLhVjizMkAzrK.pre-lead-alerts-presentation.json', 'lead-alerts-error-monitor-candidate.json',
    ['Build Error Alert'], ['Telegram Error Alert']],
  ['QmIyEW2ZEqKregmN', 'Lead Intake',
    'QmIyEW2ZEqKregmN.pre-lead-alerts-presentation.json', 'lead-alerts-lead-intake-candidate.json',
    ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert'],
    ['Telegram Lead Alert', 'Telegram Warm Alert', 'Telegram Incomplete Alert']]
];

const GATES = ['lead-alerts-presentation.test.mjs', 'lead-alerts-candidates.test.mjs'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY },
                               body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 300)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });
const body = (wf) => JSON.stringify(importable(wf), null, 2) + '\n';

say('');
say('FINMENTOR Lead Alerts — presentation deployment');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites five ACTIVE production workflows; re-run with --confirm (or --dry-run first)'); }

// ── 0. the gates run first, and a red gate stops everything ────────────────────────────────────
say('STEP 0 — the offline gates');
for (const g of GATES) {
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', g)], { encoding: 'utf8' });
  const m = /ASSERTIONS: (\d+) passed(?:, (\d+) failed)?/.exec(r.stdout || '');
  if (r.status !== 0 || !m || m[2]) { die(g + ' did not pass:\n' + String(r.stdout || r.stderr).slice(-800)); }
  ok(g + ' — ' + m[1] + ' assertions');
}
say('');

// ── 1. preflight EVERY workflow before writing ANY of them ─────────────────────────────────────
//
// Checking each one as it is written would leave the run half-applied on the third failure. All
// five are proven safe first, then all five are written.
say('STEP 1 — preflight: five workflows, checked before one is touched');
const plan = [];
for (const [id, label, snapFile, candFile, builders, tgs] of TARGETS) {
  const snapPath = join(ROOT, 'n8n', 'history', snapFile);
  const candPath = join(ROOT, 'n8n', 'candidate', candFile);
  if (!existsSync(snapPath)) { die(label + ': no snapshot — run scripts/snapshot-lead-alerts.mjs'); }
  if (!existsSync(candPath)) { die(label + ': no candidate — run scripts/build-lead-alerts-presentation.mjs'); }

  const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
  const candidate = JSON.parse(readFileSync(candPath, 'utf8'));
  const live = await api('GET', '/workflows/' + id);

  say('  ' + label + '  (' + id + ')');

  // 1a. EXPECTED PRE-HASH. The live workflow must be in a state this script put it in, or in
  // the state it started from. Two are acceptable and no others:
  //
  //   · the SNAPSHOT — never deployed, or rolled back;
  //   · the LAST DEPLOYED record — already carrying this pass, being redeployed after a copy fix.
  //
  // The snapshot is never overwritten by a deploy, so the rollback always points at the state
  // before this pass touched anything, however many times the copy is corrected.
  const deployedPath = join(ROOT, 'n8n', 'history', id + '.deployed-lead-alerts.json');
  const snapSha = sha(readFileSync(snapPath, 'utf8'));
  const liveSha = sha(body(live));
  const deployedSha = existsSync(deployedPath) ? sha(readFileSync(deployedPath, 'utf8')) : null;
  if (liveSha === snapSha) {
    ok('    pre-hash matches the pre-deploy snapshot: ' + liveSha.slice(0, 32));
  } else if (deployedSha && liveSha === deployedSha) {
    ok('    pre-hash matches the last deployed record (redeploy): ' + liveSha.slice(0, 32));
  } else {
    say('      snapshot      : ' + snapSha.slice(0, 32));
    if (deployedSha) { say('      last deployed : ' + deployedSha.slice(0, 32)); }
    say('      actual        : ' + liveSha.slice(0, 32));
    die(label + ': the live workflow is in a state this script did not create. Someone edited it. ' +
        'Re-read the live workflow before doing anything else.');
  }

  // 1b. shape
  if (candidate.nodes.length !== live.nodes.length) { die(label + ': the candidate changes the node count'); }
  if (candidate.name !== live.name) { die(label + ': the candidate renames the workflow'); }
  if (JSON.stringify(candidate.connections) !== JSON.stringify(live.connections)) { die(label + ': the connection graph moved'); }
  if (JSON.stringify(candidate.settings || {}) !== JSON.stringify(live.settings || {})) { die(label + ': workflow settings changed'); }
  ok('    +0 / -0 nodes, graph and settings identical');

  // 1c. only the declared nodes differ, and every declared node actually does
  const declared = builders.concat(tgs);
  const changed = [];
  for (const n of candidate.nodes) {
    const was = live.nodes.find((x) => x.name === n.name);
    if (!was) { die(label + ': the candidate introduces ' + n.name); }
    if (JSON.stringify(n) !== JSON.stringify(was)) { changed.push(n.name); }
  }
  for (const n of live.nodes) { if (!candidate.nodes.find((x) => x.name === n.name)) { die(label + ': the candidate removes ' + n.name); } }

  // TWO COMPARISONS, AGAINST TWO DIFFERENT THINGS, AND THEY ANSWER DIFFERENT QUESTIONS.
  //
  //   vs LIVE     — "am I about to clobber something?" Nothing outside the declared set may differ.
  //   vs SNAPSHOT — "did the builder actually do its job?" Every declared node must differ.
  //
  // Running the second one against LIVE was wrong, and the guard caught it on the first redeploy:
  // a Telegram node already carrying this pass is legitimately identical to the candidate, and
  // demanding it differ would forbid ever correcting the copy.
  for (const c of changed) { if (declared.indexOf(c) === -1) { die(label + ': UNDECLARED change to ' + c); } }
  const vsSnapshot = candidate.nodes
    .filter((n) => JSON.stringify(n) !== JSON.stringify(snapshot.nodes.find((x) => x.name === n.name)))
    .map((n) => n.name);
  for (const d of declared) {
    if (vsSnapshot.indexOf(d) === -1) { die(label + ': ' + d + ' is declared as changed but is identical to the snapshot'); }
  }
  ok('    vs snapshot: ' + vsSnapshot.join(', '));
  ok('    vs live: ' + (changed.length ? changed.join(', ') : 'nothing — already current'));

  // 1d. business logic, restated as node types that may not move
  for (const n of live.nodes) {
    if (!/scheduleTrigger|errorTrigger|webhook|executeWorkflowTrigger|googleSheets|dataTable|\.if$|\.switch$|postgres|openAi|telegramTrigger/i.test(n.type)) { continue; }
    const m = candidate.nodes.find((x) => x.name === n.name);
    if (JSON.stringify(m) !== JSON.stringify(n)) { die(label + ': ' + n.name + ' (' + n.type + ') changed — this is not presentation'); }
  }
  ok('    every trigger, schedule, sheet, table, branch and credential is byte-identical');

  // 1e. callback_data — the owner's Done/Snooze buttons ARE the workflow
  for (const t of tgs) {
    const was = live.nodes.find((x) => x.name === t);
    const now = candidate.nodes.find((x) => x.name === t);
    if (JSON.stringify(was.parameters.inlineKeyboard || null) !== JSON.stringify(now.parameters.inlineKeyboard || null)) {
      die(label + '/' + t + ': the inline keyboard changed — callback_data must stay identical');
    }
    if (JSON.stringify(was.parameters.chatId) !== JSON.stringify(now.parameters.chatId)) { die(label + '/' + t + ': chatId changed'); }
    if (JSON.stringify(was.credentials || null) !== JSON.stringify(now.credentials || null)) { die(label + '/' + t + ': credentials changed'); }
    if ((now.parameters.additionalFields || {}).parse_mode !== 'HTML') { die(label + '/' + t + ': parse_mode is not HTML'); }
  }
  ok('    callback_data, chatId and credentials unchanged; parse_mode is HTML');

  plan.push({ id, label, candidate, wasActive: live.active });
}
say('');
ok('all five workflows are safe to write');
say('');

// ── 2. write ───────────────────────────────────────────────────────────────────────────────────
say('STEP 2 — ' + (DRY ? 'write (SKIPPED: dry run)' : 'write, one at a time, each read back before the next'));
if (DRY) {
  ok('dry run complete — re-run with --confirm to deploy');
  say('');
} else {
  for (const step of plan) {
    await api('PUT', '/workflows/' + step.id, importable(step.candidate));
    const after = await api('GET', '/workflows/' + step.id);
    if (sha(body(after)) !== sha(body(step.candidate))) {
      die(step.label + ': the deployed workflow does not match the candidate — ROLLBACK from ' +
          'n8n/history/ before touching anything else');
    }
    if (after.active !== step.wasActive) { die(step.label + ': the active flag changed'); }
    // Record what is now deployed, so a later copy correction can redeploy without the
    // pre-hash check mistaking this pass's own work for someone else's edit.
    writeFileSync(join(ROOT, 'n8n', 'history', step.id + '.deployed-lead-alerts.json'), body(after), 'utf8');
    ok(step.label + ': written and read back, sha ' + sha(body(after)).slice(0, 16) + ', active ' + after.active);
  }
  say('');
  say('DONE. Rollback: PUT n8n/history/<id>.pre-lead-alerts-presentation.json back to /workflows/<id>.');
  say('');
}
