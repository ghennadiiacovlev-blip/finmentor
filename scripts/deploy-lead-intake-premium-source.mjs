#!/usr/bin/env node
// FINMENTOR — deploy the Pipeline BP/BQ/BR source fix. ONE WORKFLOW, ONE NODE, ONE FIELD.
//
//   node scripts/deploy-lead-intake-premium-source.mjs --dry-run
//   node scripts/deploy-lead-intake-premium-source.mjs --confirm
//
//   QmIyEW2ZEqKregmN   Build Pipeline Row  .parameters.jsCode
//
// ── HOW IT WRITES, AND WHY THAT SHAPE ──────────────────────────────────────────────────────────
//
// It does NOT PUT the tracked candidate. The candidate is sanitised — `cachedResultUrl` and
// `cachedResultName` are stripped, because a tracked artifact must not carry the production
// spreadsheet URL — and pushing it would therefore also strip those display caches from the live
// workflow. Cosmetic, but it is a change nobody asked for, on a 102-node workflow that is CLOSED
// at GO.
//
// So it reads the LIVE workflow, replaces exactly one string inside it — the jsCode of
// `Build Pipeline Row` — and writes that back. The body sent differs from the body read in one
// field, and the script proves it before sending.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. The offline suite must pass in full.
//   2. The live node must still carry the DEFECT. If it does not, this is not the workflow the
//      candidate was built against and nothing is written.
//   3. Exactly one node may differ, in exactly one field. Connections, settings, node count, node
//      order, credentials and every other parameter byte-identical.
//   4. `Save to Pipeline` stays append + defineBelow with its 62 keys. F16: autoMapInputData
//      appends a column per unknown key, and it widened this workbook twice.
//   5. `Update Pipeline (Merge)` stays autoMapInputData AND `Build Merge Update` must not learn the
//      three keys — otherwise every merge would write those columns and erase what it did not carry.
//   6. No node may gain `alwaysOutputData` beside `continueErrorOutput` (P9-R2).
//   7. The Gateway, the submit endpoint and the Concierge are re-hashed after the write and must
//      not have moved.
//   8. No schema, no new column, no Bot_Sessions, no MiniApp_App_Sessions, no receipt or
//      idempotency semantics are touched — none of them are read or written by this script.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const NEIGHBOURS = {
  nTZHLbv2KFggdhh5: 'Gateway',
  ELiPdw4mdxQbBaan: 'submit endpoint',
  mppzthlkSJFr6Kle: 'Concierge'
};
const ROW_NODE = 'Build Pipeline Row';
const WRITER_NODE = 'Save to Pipeline';
const MERGE_BUILDER = 'Build Merge Update';
const MERGE_WRITER = 'Update Pipeline (Merge)';
const NEW_FIELDS = ['current_setup', 'decision_horizon', 'important_context'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

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
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });
// Structural identity of a neighbour: what it DOES, ignoring editor display caches.
const structural = (wf) => JSON.stringify({
  nodes: wf.nodes.map((n) => [n.name, n.type, n.typeVersion, n.parameters, n.onError || null, n.alwaysOutputData || false]),
  connections: wf.connections,
  settings: wf.settings || {}
});

say('');
say('LEAD INTAKE — Pipeline BP/BQ/BR source fix');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm (or --dry-run first)'); }

// ── 0. the suite ───────────────────────────────────────────────────────────────────────────────
say('STEP 0 — the offline suite');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'run-all.mjs')], { encoding: 'utf8' });
  const tail = String(r.stdout || '').trim().split('\n').slice(-3).join('\n');
  if (r.status !== 0) { say(tail); die('the offline suite is not green; nothing is deployed from a red tree'); }
  ok('suite green');
  say(tail.split('\n').map((l) => '        ' + l).join('\n'));
}
say('');

// ── 1. the live workflow, and the rollback ─────────────────────────────────────────────────────
say('STEP 1 — live workflow, and the rollback artifact');
const live = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
if (live.nodes.length !== 102) { die('the live workflow has ' + live.nodes.length + ' nodes, not the 102 this delta knows'); }
const liveRow = live.nodes.find((n) => n.name === ROW_NODE);
if (!liveRow) { die('no node named ' + ROW_NODE); }
const liveJs = String(liveRow.parameters.jsCode || '');
ok('live workflow read: 102 nodes, ' + ROW_NODE + ' is ' + liveJs.length + ' bytes');

mkdirSync(OUT_DIR, { recursive: true });
const rollbackPath = join(OUT_DIR, LEAD_INTAKE_ID + '.pre-premium-source.json');
const liveBody = JSON.stringify(importable(live), null, 2) + '\n';
if (existsSync(rollbackPath) && !args.includes('--refresh-rollback')) {
  if (sha(readFileSync(rollbackPath, 'utf8')) !== sha(liveBody)) {
    die('the live workflow has CHANGED since the rollback was captured. Re-run the dry run, confirm ' +
        'the change was expected, then pass --refresh-rollback.');
  }
  ok('expected pre-hash matches the captured rollback');
} else {
  writeFileSync(rollbackPath, liveBody, 'utf8');
}
ok('rollback: ' + rollbackPath);

// The defect must still be there. If it is not, someone else has been in this node.
if (liveJs.indexOf('__premium') !== -1) { die('the live node already reads __premium — this delta has been applied'); }
for (const f of NEW_FIELDS) {
  if (liveJs.indexOf('pick(item.' + f + ')') === -1) { die('the live node does not read item.' + f + ' — not the shape this delta knows'); }
}
ok('the live node still carries the defect: it reads item.* for all three fields');
say('');

// ── 2. the candidate's node, spliced into the LIVE body ────────────────────────────────────────
say('STEP 2 — candidate');
const cand = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-source-candidate.json'), 'utf8'));
const candRow = cand.nodes.find((n) => n.name === ROW_NODE);
if (!candRow) { die('the candidate has no ' + ROW_NODE); }
const newJs = String(candRow.parameters.jsCode || '');
if (newJs.indexOf('__premium') === -1) { die('the candidate does not read __premium — rebuild it'); }
for (const f of NEW_FIELDS) {
  if (newJs.indexOf('pick(__premium.' + f + ', item.' + f + ')') === -1) { die('the candidate does not rewrite ' + f); }
}
ok('candidate node reads __premium for all three, with item.* as the second source');

// Everything OUTSIDE the node must already be identical between live and candidate; the candidate
// is sanitised, so compare structurally rather than byte-for-byte.
{
  const strip = (wf) => JSON.stringify(wf.nodes.map((n) => [n.name, n.type, n.typeVersion,
    n.name === ROW_NODE ? null : n.parameters, n.onError || null, n.alwaysOutputData || false]));
  if (strip(live) !== strip(cand)) { die('the candidate differs from live outside ' + ROW_NODE + ' — rebuild it against a fresh export'); }
  if (JSON.stringify(live.connections) !== JSON.stringify(cand.connections)) { die('the candidate changes connections'); }
  if (JSON.stringify(live.settings || {}) !== JSON.stringify(cand.settings || {})) { die('the candidate changes settings'); }
}
ok('the candidate differs from live in exactly one node, and nothing else');

// The body to send: the LIVE workflow with one string replaced. Nothing else can move.
const next = JSON.parse(JSON.stringify(live));
next.nodes.find((n) => n.name === ROW_NODE).parameters.jsCode = newJs;
{
  const a = live.nodes, b = next.nodes;
  const diff = b.filter((n, i) => JSON.stringify(n) !== JSON.stringify(a[i]));
  if (diff.length !== 1 || diff[0].name !== ROW_NODE) { die('the body to send differs in ' + diff.length + ' nodes'); }
  const before = JSON.parse(JSON.stringify(a.find((n) => n.name === ROW_NODE)));
  const after = JSON.parse(JSON.stringify(diff[0]));
  before.parameters.jsCode = after.parameters.jsCode = '';
  if (JSON.stringify(before) !== JSON.stringify(after)) { die('something other than jsCode changed inside ' + ROW_NODE); }
  ok('the body to send differs from the body read in exactly one field: ' + ROW_NODE + '.parameters.jsCode');
  say('        ' + liveJs.length + ' bytes -> ' + newJs.length + ' bytes');
}

// F16 and the merge containment, on the body about to be sent.
{
  const w = next.nodes.find((n) => n.name === WRITER_NODE);
  if (w.parameters.operation !== 'append') { die(WRITER_NODE + ' is no longer an append'); }
  if (w.parameters.columns.mappingMode !== 'defineBelow') { die(WRITER_NODE + ' left defineBelow — F16'); }
  if (Object.keys(w.parameters.columns.value).length !== 62) { die(WRITER_NODE + ' gained or lost a column'); }
  for (const f of NEW_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(w.parameters.columns.value, f)) { die(WRITER_NODE + ' does not map ' + f); }
  }
  ok(WRITER_NODE + ': append + defineBelow, 62 keys, all three mapped');

  const mw = next.nodes.find((n) => n.name === MERGE_WRITER);
  if (mw.parameters.columns.mappingMode !== 'autoMapInputData') { die(MERGE_WRITER + ' changed mapping mode'); }
  const mb = String(next.nodes.find((n) => n.name === MERGE_BUILDER).parameters.jsCode || '');
  for (const f of NEW_FIELDS) {
    if (mb.indexOf(f) !== -1) { die(MERGE_BUILDER + ' mentions ' + f + ' — it feeds an autoMap writer'); }
  }
  ok('merge path unchanged: autoMap writer, and its builder still knows none of the three keys');

  for (const n of next.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
  }
  ok('no P9-R2 flag pair anywhere');
}
say('');

// ── 3. neighbours, before ──────────────────────────────────────────────────────────────────────
say('STEP 3 — neighbours, hashed before the write');
const before = {};
for (const [id, label] of Object.entries(NEIGHBOURS)) {
  before[id] = sha(structural(await api('GET', '/workflows/' + id)));
  ok(label.padEnd(16) + before[id].slice(0, 16));
}
say('');

// ── 4. write ───────────────────────────────────────────────────────────────────────────────────
say('STEP 4 — ' + (DRY ? 'write (SKIPPED: dry run)' : 'write'));
if (DRY) {
  ok('dry run complete — re-run with --confirm to deploy');
  say('');
  say('Nothing was written.');
  say('');
  process.exit(0);
}
await api('PUT', '/workflows/' + LEAD_INTAKE_ID, importable(next));
ok('PUT /workflows/' + LEAD_INTAKE_ID);
say('');

// ── 5. read back from the tenant ───────────────────────────────────────────────────────────────
say('STEP 5 — read-back verification');
const after = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
{
  if (after.nodes.length !== 102) { die('the tenant stored ' + after.nodes.length + ' nodes — ROLLBACK'); }
  const afterJs = String(after.nodes.find((n) => n.name === ROW_NODE).parameters.jsCode || '');
  if (afterJs !== newJs) { die('the deployed jsCode does not match what was sent — ROLLBACK with ' + rollbackPath); }
  ok('the deployed ' + ROW_NODE + ' matches the candidate byte for byte');
  for (const f of NEW_FIELDS) {
    if (afterJs.indexOf('pick(__premium.' + f + ', item.' + f + ')') === -1) { die('the tenant is missing the read for ' + f + ' — ROLLBACK'); }
  }
  ok('all three reads verified on the tenant');

  const diff = after.nodes.filter((n, i) => JSON.stringify(n) !== JSON.stringify(live.nodes[i]));
  if (diff.length !== 1 || diff[0].name !== ROW_NODE) {
    die('the tenant differs from the pre-image in ' + diff.length + ' nodes: ' + diff.map((d) => d.name).join(', ') + ' — ROLLBACK');
  }
  ok('exactly one node differs from the pre-image, and it is ' + ROW_NODE);
  if (JSON.stringify(after.connections) !== JSON.stringify(live.connections)) { die('connections changed — ROLLBACK'); }
  if (JSON.stringify(after.settings || {}) !== JSON.stringify(live.settings || {})) { die('settings changed — ROLLBACK'); }
  ok('connections and settings byte-identical');
  if (after.active !== live.active) { die('the active flag changed — ROLLBACK'); }
  ok('active flag unchanged: ' + after.active);

  const w = after.nodes.find((n) => n.name === WRITER_NODE);
  if (w.parameters.columns.mappingMode !== 'defineBelow' || Object.keys(w.parameters.columns.value).length !== 62) {
    die(WRITER_NODE + ' was damaged — ROLLBACK');
  }
  ok(WRITER_NODE + ' still append + defineBelow with 62 keys');
  const mw = after.nodes.find((n) => n.name === MERGE_WRITER);
  if (mw.parameters.columns.mappingMode !== 'autoMapInputData') { die(MERGE_WRITER + ' was damaged — ROLLBACK'); }
  ok(MERGE_WRITER + ' still autoMapInputData, and its builder still knows none of the three keys');
}
say('');

say('STEP 6 — neighbours, hashed after the write');
for (const [id, label] of Object.entries(NEIGHBOURS)) {
  const now = sha(structural(await api('GET', '/workflows/' + id)));
  if (now !== before[id]) { die(label + ' CHANGED during this deploy — ROLLBACK'); }
  ok(label.padEnd(16) + 'unchanged');
}

say('');
say('DEPLOYED. One node, one field. Rollback: PUT ' + rollbackPath + ' to /workflows/' + LEAD_INTAKE_ID + '.');
say('');
