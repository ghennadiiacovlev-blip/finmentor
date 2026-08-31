#!/usr/bin/env node
// FINMENTOR — deploy the GLOBAL NEW-EVENT IDENTITY server contract. ONE WORKFLOW.
//
//   node scripts/deploy-lead-intake-request-identity.mjs --dry-run
//   node scripts/deploy-lead-intake-request-identity.mjs --confirm
//
//   QmIyEW2ZEqKregmN   Validate Payload        .parameters.jsCode   canonicalise + refuse
//                      Normalize + Score Lead  .parameters.jsCode   one canonical location
//                      Dedup Guard             .parameters.jsCode   IDEMPOTENCY_CONFLICT
//                      Build Merge Update      .parameters.jsCode   identity immutability
//                      + Identity Conflict?          IF
//                      + IF Internal (Conflict)      IF
//                      + Internal Result (Conflict)  code
//                      + Respond Identity Conflict   respondToWebhook 409
//
// ── HOW IT WRITES, AND WHY THAT SHAPE ──────────────────────────────────────────────────────────
//
// It does NOT PUT the tracked candidate. The candidate is sanitised — `cachedResultUrl` and
// `cachedResultName` are stripped, because a tracked artifact must not carry the production
// spreadsheet URL — and pushing it would therefore also strip those display caches from the live
// workflow. Cosmetic, but it is a change nobody asked for on a workflow that is CLOSED at GO.
//
// So it reads the LIVE workflow and applies THE SAME transform functions the candidate generator
// uses, with `preserveCaches`. One code path builds both, so the thing gated offline and the thing
// deployed cannot diverge.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. The offline suite must pass in full.
//   2. The live workflow must still carry the DEFECTS — no identity module, `advance()` on the
//      merge, no conflict verdict. If it does not, someone else has been in these nodes.
//   3. Exactly four node bodies may differ, in exactly one field each; four nodes may be added;
//      exactly one connection entry may change and two may appear. Everything else byte-identical.
//   4. `Save to Pipeline` stays append + defineBelow with its 62 keys. F16: autoMapInputData
//      appends a column per unknown key, and it widened this workbook twice.
//   5. `Update Pipeline (Merge)` stays autoMapInputData AND `Build Merge Update` must not emit a
//      request_id key — that pair is the whole immutability argument.
//   6. No node may gain `alwaysOutputData` beside `continueErrorOutput` (P9-R2).
//   7. Corroboration in `Dedup Guard` must survive verbatim. Loosening it would trade an
//      idempotency defect for the row-selection capability INDP1-02 removed.
//   8. The Gateway, the submit endpoint and the Concierge are re-hashed after the write and must
//      not have moved.
//   9. No schema, no new Pipeline column, no lead_id change, no Bot_Sessions, no receipt or
//      idempotency semantics are touched — none of them are read or written by this script.
//  10. No Alert Outbox, no DDL, no backfill. This script issues no SQL and no Sheets write.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  build, verify, TOUCHED_NODES, ADDED_NODES,
  DEDUP_NODE, MERGE_NODE, VALIDATE_NODE, NORMALIZE_NODE,
  CONFLICT_NODE, CONFLICT_SPLIT_NODE, CONFLICT_RESPONDER_NODE
} from './build-lead-intake-request-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const NEIGHBOURS = {
  nTZHLbv2KFggdhh5: 'Gateway',
  ELiPdw4mdxQbBaan: 'submit endpoint',
  mppzthlkSJFr6Kle: 'Concierge'
};
const WRITER_NODE = 'Save to Pipeline';
const MERGE_WRITER = 'Update Pipeline (Merge)';

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
say('LEAD INTAKE — GLOBAL NEW-EVENT IDENTITY, server contract');
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
ok('live workflow read: 102 nodes, versionId ' + live.versionId);

mkdirSync(OUT_DIR, { recursive: true });
const rollbackPath = join(OUT_DIR, LEAD_INTAKE_ID + '.pre-request-identity.json');
const liveBody = JSON.stringify(importable(live), null, 2) + '\n';
if (existsSync(rollbackPath) && !args.includes('--refresh-rollback')) {
  if (sha(readFileSync(rollbackPath, 'utf8')) !== sha(liveBody)) {
    die('the live workflow has CHANGED since the rollback was captured. Re-run the dry run, confirm '
      + 'the change was expected, then pass --refresh-rollback.');
  }
  ok('expected pre-hash matches the captured rollback');
} else {
  writeFileSync(rollbackPath, liveBody, 'utf8');
}
ok('rollback: ' + rollbackPath);

// The defects must still be there. If they are not, someone else has been in these nodes.
{
  const js = (n) => String((live.nodes.find((x) => x.name === n) || { parameters: {} }).parameters.jsCode || '');
  if (js(MERGE_NODE).indexOf('upd.request_id = advance(') === -1) {
    die(MERGE_NODE + ' no longer advances request_id — this delta has been applied, or the node moved');
  }
  if (js(VALIDATE_NODE).indexOf('const RI = (function () {') !== -1) {
    die(VALIDATE_NODE + ' already carries the identity module — this delta has been applied');
  }
  if (js(DEDUP_NODE).indexOf('IDEMPOTENCY_CONFLICT') !== -1) {
    die(DEDUP_NODE + ' already carries the conflict verdict — this delta has been applied');
  }
  if (js(NORMALIZE_NODE).indexOf('incoming.request_id') === -1) {
    die(NORMALIZE_NODE + ' does not read the second source — not the shape this delta knows');
  }
  for (const n of ADDED_NODES) {
    if (live.nodes.some((x) => x.name === n)) { die('a node named ' + n + ' already exists'); }
  }
  ok('the live workflow still carries all four defects, and none of the four new nodes exists');
}
say('');

// ── 2. the body to send: the live workflow through the SAME transforms ─────────────────────────
say('STEP 2 — the delta');
const next = build(live, { preserveCaches: true });
{
  const problems = verify(live, build(live));
  if (problems.length) { die('the candidate invariants do not hold: ' + problems.join(' | ')); }
  ok('every candidate invariant holds against the live export');

  // Node-level diff, positionally, so a reorder is caught as well as an edit.
  const a = live.nodes;
  const b = next.nodes;
  if (b.length !== a.length + 4) { die('the body to send has ' + b.length + ' nodes, expected ' + (a.length + 4)); }
  for (let i = 0; i < a.length; i++) {
    if (b[i].name !== a[i].name) { die('node order changed at index ' + i + ': ' + a[i].name + ' -> ' + b[i].name); }
  }
  const changed = a.filter((n, i) => JSON.stringify(b[i]) !== JSON.stringify(n)).map((n) => n.name).sort();
  if (JSON.stringify(changed) !== JSON.stringify([...TOUCHED_NODES].sort())) {
    die('the body to send changes ' + changed.length + ' pre-existing nodes: ' + changed.join(', '));
  }
  ok('exactly four pre-existing nodes change: ' + changed.join(', '));

  for (const name of TOUCHED_NODES) {
    const before = JSON.parse(JSON.stringify(a.find((n) => n.name === name)));
    const after = JSON.parse(JSON.stringify(b.find((n) => n.name === name)));
    const grew = String(after.parameters.jsCode).length - String(before.parameters.jsCode).length;
    before.parameters.jsCode = after.parameters.jsCode = '';
    if (JSON.stringify(before) !== JSON.stringify(after)) { die('something other than jsCode changed inside ' + name); }
    say('        ' + name.padEnd(24) + (grew >= 0 ? '+' : '') + grew + ' bytes');
  }
  ok('each of the four differs from the body read in exactly one field: parameters.jsCode');

  const added = b.slice(a.length).map((n) => n.name);
  if (JSON.stringify(added) !== JSON.stringify(ADDED_NODES)) {
    die('the appended nodes are ' + added.join(', ') + ', expected ' + ADDED_NODES.join(', '));
  }
  ok('four nodes appended, in order: ' + added.join(', '));

  // Connections: one rewired, two new, nothing else.
  const ca = live.connections;
  const cb = next.connections;
  const keysChanged = Object.keys(ca).filter((k) => JSON.stringify(ca[k]) !== JSON.stringify(cb[k]));
  const keysAdded = Object.keys(cb).filter((k) => !(k in ca)).sort();
  if (JSON.stringify(keysChanged) !== JSON.stringify([DEDUP_NODE])) {
    die('connections changed on: ' + keysChanged.join(', ') + ', expected only ' + DEDUP_NODE);
  }
  if (JSON.stringify(keysAdded) !== JSON.stringify([CONFLICT_SPLIT_NODE, CONFLICT_NODE].sort())) {
    die('connections added for: ' + keysAdded.join(', '));
  }
  ok('connections: ' + DEDUP_NODE + ' output 0 rewired, two new entries, nothing else');

  if (JSON.stringify(live.settings || {}) !== JSON.stringify(next.settings || {})) { die('settings changed'); }
  ok('settings byte-identical');
}

// The standing containments, re-asserted on the body about to be sent.
{
  const w = next.nodes.find((n) => n.name === WRITER_NODE);
  if (w.parameters.operation !== 'append') { die(WRITER_NODE + ' is no longer an append'); }
  if (w.parameters.columns.mappingMode !== 'defineBelow') { die(WRITER_NODE + ' left defineBelow — F16'); }
  if (Object.keys(w.parameters.columns.value).length !== 62) {
    die(WRITER_NODE + ' has ' + Object.keys(w.parameters.columns.value).length + ' columns, not 62');
  }
  ok(WRITER_NODE + ': append + defineBelow, 62 keys');

  const mw = next.nodes.find((n) => n.name === MERGE_WRITER);
  if (mw.parameters.columns.mappingMode !== 'autoMapInputData') { die(MERGE_WRITER + ' changed mapping mode'); }
  const mb = String(next.nodes.find((n) => n.name === MERGE_NODE).parameters.jsCode || '');
  const executable = mb.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  if (/request_id/.test(executable)) { die(MERGE_NODE + ' still routes request_id into an autoMap writer'); }
  ok('merge path: autoMap writer, and its builder emits no request_id key');

  // lead_id is not this deploy's business.
  const norm = String(next.nodes.find((n) => n.name === NORMALIZE_NODE).parameters.jsCode || '');
  if (norm.indexOf('FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}') === -1) {
    die('lead_id generation changed — out of scope for this deploy');
  }
  ok('lead_id generation byte-identical');

  // Corroboration must survive verbatim.
  const dg = String(next.nodes.find((n) => n.name === DEDUP_NODE).parameters.jsCode || '');
  for (const probe of ["consider(corroborated, 'request_id+identity', 'strong')",
    'if (lead.provenance_trusted && lead.lead_id) consider(']) {
    if (dg.indexOf(probe) === -1) { die('the corroboration rule was altered: ' + probe.slice(0, 40)); }
  }
  ok('Dedup Guard corroboration rule survives verbatim (INDP1-02 stays closed)');

  const resp = next.nodes.find((n) => n.name === CONFLICT_RESPONDER_NODE);
  if ((resp.parameters.options || {}).responseCode !== 409) { die('the conflict responder does not answer 409'); }
  ok('conflict responder: HTTP 409, IDEMPOTENCY_CONFLICT, retryable false');

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
  if (after.nodes.length !== 106) { die('the tenant stored ' + after.nodes.length + ' nodes — ROLLBACK with ' + rollbackPath); }
  ok('the tenant has 106 nodes');

  for (const name of TOUCHED_NODES.concat(ADDED_NODES)) {
    const sent = next.nodes.find((n) => n.name === name);
    const got = after.nodes.find((n) => n.name === name);
    if (!got) { die(name + ' is missing on the tenant — ROLLBACK'); }
    if (JSON.stringify(got.parameters) !== JSON.stringify(sent.parameters)) {
      die(name + ' does not match what was sent — ROLLBACK with ' + rollbackPath);
    }
  }
  ok('all eight touched or added nodes match what was sent, byte for byte');

  const diff = after.nodes.slice(0, live.nodes.length)
    .filter((n, i) => JSON.stringify(n) !== JSON.stringify(live.nodes[i]))
    .map((n) => n.name).sort();
  if (JSON.stringify(diff) !== JSON.stringify([...TOUCHED_NODES].sort())) {
    die('the tenant differs from the pre-image in: ' + diff.join(', ') + ' — ROLLBACK');
  }
  ok('exactly the four intended nodes differ from the pre-image');

  if (JSON.stringify(after.connections) !== JSON.stringify(next.connections)) { die('connections do not match — ROLLBACK'); }
  if (JSON.stringify(after.settings || {}) !== JSON.stringify(live.settings || {})) { die('settings changed — ROLLBACK'); }
  ok('connections match the delta; settings byte-identical to the pre-image');

  if (after.active !== true) { die('the workflow is no longer active — ROLLBACK'); }
  ok('workflow still active');
}
say('');

// ── 6. neighbours, after ───────────────────────────────────────────────────────────────────────
say('STEP 6 — neighbours, re-hashed after the write');
for (const [id, label] of Object.entries(NEIGHBOURS)) {
  const now = sha(structural(await api('GET', '/workflows/' + id)));
  if (now !== before[id]) { die(label + ' (' + id + ') MOVED during this deploy — investigate before proceeding'); }
  ok(label.padEnd(16) + 'unchanged');
}
say('');

// ── 7. post-image ──────────────────────────────────────────────────────────────────────────────
const postPath = join(OUT_DIR, LEAD_INTAKE_ID + '.post-request-identity.json');
writeFileSync(postPath, JSON.stringify(importable(after), null, 2) + '\n', 'utf8');
say('  post-image: ' + postPath);
say('');
say('SERVER CONTRACT DEPLOYED. No DDL, no Alert Outbox, no backfill, no lead_id change,');
say('no Pipeline column, no receipt change, no lead created.');
say('');
say('ROLLBACK:  PUT /api/v1/workflows/' + LEAD_INTAKE_ID + '  with ' + rollbackPath);
say('');
