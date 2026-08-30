#!/usr/bin/env node
// FINMENTOR — deploy the caller-side receipt preallocation contract.
//
//   node scripts/deploy-receipt-preallocation.mjs --dry-run
//   node scripts/deploy-receipt-preallocation.mjs --confirm
//
// ONE WORKFLOW. SEVEN NEW NODES. ONE REWIRED EDGE. NOTHING ELSE.
//
//   ELiPdw4mdxQbBaan  the submit endpoint
//     + Receipt Probe            exact-key read of Submission_Receipts
//     + Receipt Probe Verdict    preallocate ONLY on a clean read of zero rows
//     + IF Receipt Needed
//     + Preallocate Receipt      the Concierge row, field for field
//     + Receipt Readback         a fresh read is the only thing that may authorise the call
//     + Receipt Verdict          exactly one row, exact raw key, non-empty state
//     + IF Receipt Present
//     ~ IF Privacy Recorded true-branch: Build Intake Payload -> Receipt Probe
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
//
// Lead Intake has no INSERT into Submission_Receipts. All four of its receipt writes are UPDATEs
// filtered on submission_key plus a commit_state, and Receipt Read Verdict says so plainly: "a
// missing row is a broken invariant, not permission to proceed." The Concierge satisfies that with
// Receipt Preallocate. The Mini App never did, so the second real submit reached the receipt gate
// and was refused with RECEIPT_ABSENT_INVARIANT_BROKEN.
//
// Lead Intake is CORRECT and is not touched. The caller is what changed.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. The offline suite must pass first, in full.
//   2. Exactly the seven declared nodes may be added; none removed, none renamed.
//   3. Every pre-existing node must be byte-identical, including the privacy write and verdict.
//   4. Only the one declared connection edge may change.
//   5. Settings, webhook route and the privacy credential must be identical.
//   6. Lead Intake, the Concierge and the Gateway are not opened for writing at all.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const SUBMIT_ID = 'ELiPdw4mdxQbBaan';
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const PRIVACY_CRED = { id: 'Jsfozg8CsclIdCRo', name: 'FINMENTOR Privacy Audit Writer' };

const NEW_NODES = ['Receipt Probe', 'Receipt Probe Verdict', 'IF Receipt Needed',
  'Preallocate Receipt', 'Receipt Readback', 'Receipt Verdict', 'IF Receipt Present'];

const CONFIRM = process.argv.indexOf('--confirm') !== -1;
const say = (m) => console.log(m);
const ok = (m) => console.log('  ok    ' + m);
const die = (m) => { console.error('  FAIL  ' + m); process.exit(1); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY || '';
if (!BASE || !KEY) { die('N8N_BASE_URL and N8N_FIX_API_KEY must be set'); }

async function api(method, path, body) {
  const r = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) { die(method + ' ' + path + ' -> ' + r.status + ' ' + t.slice(0, 300)); }
  return t ? JSON.parse(t) : null;
}
const structural = (w) => JSON.stringify({ nodes: w.nodes, connections: w.connections, settings: w.settings });

say('\nFINMENTOR — receipt preallocation contract\n');

// ── 0. gates ───────────────────────────────────────────────────────────────────────────────────
say('STEP 0 — the offline suite');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'run-all.mjs')], { encoding: 'utf8' });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const m = out.match(/(\d+)\/(\d+) gates passed/g);
  if (!m) { die('could not read the gate tally'); }
  const last = m[m.length - 1];
  const parts = last.match(/(\d+)\/(\d+)/);
  if (parts[1] !== parts[2] || r.status !== 0) { die('the suite is not green: ' + last); }
  if (!/assertion floors: PASS/.test(out)) { die('assertion floors did not pass'); }
  const a = out.match(/TOTAL ASSERTIONS: (\d+)/);
  ok(last + (a ? ', ' + a[1] + ' assertions' : '') + ', floors PASS');
}
say('');

// ── 1. the untouched neighbours, hashed BEFORE ─────────────────────────────────────────────────
say('STEP 1 — the workflows this must not touch');
const neighbours = {};
for (const [id, label] of [[LEAD_INTAKE_ID, 'Lead Intake'], [CONCIERGE_ID, 'Concierge'], [GATEWAY_ID, 'Gateway']]) {
  const w = await api('GET', '/workflows/' + id);
  neighbours[id] = { label, hash: sha(structural(w)) };
  ok(label.padEnd(12) + ' ' + neighbours[id].hash.slice(0, 24) + '  (recorded, not opened for writing)');
}
say('');

// ── 2. owner identity ──────────────────────────────────────────────────────────────────────────
say('STEP 2 — owner identity, read from the live Concierge');
let OWNER_ID = '';
{
  const c = await api('GET', '/workflows/' + CONCIERGE_ID);
  const st = c.nodes.find((n) => n.name === 'Settings to Object');
  const m = String((st && st.parameters.jsCode) || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  if (!m) { die('could not read owner_chat_id from the live Concierge'); }
  OWNER_ID = m[1];
  ok('owner identity resolved (value withheld from this log)');
}
say('');

// ── 3. the live submit endpoint ────────────────────────────────────────────────────────────────
say('STEP 3 — the live submit endpoint (' + SUBMIT_ID + ')');
const live = await api('GET', '/workflows/' + SUBMIT_ID);
ok('live structural hash: ' + sha(structural(live)).slice(0, 32));
{
  if (live.nodes.some((n) => NEW_NODES.indexOf(n.name) !== -1)) {
    die('the receipt nodes are ALREADY live — this is not the state this deploy expects');
  }
  ok('confirmed the gap is still present: no receipt node on the submit endpoint');
  const pw = live.nodes.find((n) => n.name === 'Write Privacy Acknowledgement');
  if (!(pw.parameters.options || {}).queryReplacement) { die('the binding fix is missing from live'); }
  ok('the privacy binding fix is present and will be carried forward untouched');
}
say('');

// ── 4. the candidate ───────────────────────────────────────────────────────────────────────────
say('STEP 4 — the resolved candidate');
const M = await import('./build-premium-endpoints.mjs');
const cand = M.resolveEndpoint(
  JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-submit-endpoint-candidate.json'), 'utf8')),
  { ownerId: OWNER_ID, leadIntakeId: LEAD_INTAKE_ID, privacyCredId: PRIVACY_CRED.id }
);
{
  const pg = cand.nodes.find((n) => n.type === 'n8n-nodes-base.postgres');
  pg.credentials = { postgres: PRIVACY_CRED };
  const liveHook = live.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const candHook = cand.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (JSON.stringify(liveHook.parameters) !== JSON.stringify(candHook.parameters)) { die('the webhook route or mode changed'); }
  candHook.webhookId = liveHook.webhookId;
  if (/__[A-Z_]+__/.test(JSON.stringify(cand))) { die('a placeholder survived resolution'); }
  ok('credential attached, webhookId carried, no placeholder reaches the tenant');
}
say('');

// ── 5. the diff ────────────────────────────────────────────────────────────────────────────────
say('STEP 5 — exactly seven added nodes, one rewired edge');
{
  const liveNames = live.nodes.map((n) => n.name);
  const candNames = cand.nodes.map((n) => n.name);
  const added = candNames.filter((n) => liveNames.indexOf(n) === -1).sort();
  const removed = liveNames.filter((n) => candNames.indexOf(n) === -1);
  if (removed.length) { die('nodes would be REMOVED: ' + removed.join(', ')); }
  if (JSON.stringify(added) !== JSON.stringify(NEW_NODES.slice().sort())) {
    die('added nodes are not the seven declared: ' + added.join(', '));
  }
  ok('added: ' + added.join(', '));

  const strip = (n) => JSON.stringify(Object.assign({}, n, { id: undefined, position: undefined }));
  const changed = [];
  for (const l of live.nodes) {
    const c = cand.nodes.find((n) => n.name === l.name);
    if (strip(l) !== strip(c)) { changed.push(l.name); }
  }
  if (changed.length) { die('pre-existing nodes would CHANGE behaviour: ' + changed.join(', ')); }
  ok('all ' + live.nodes.length + ' pre-existing nodes byte-identical (position excluded — layout, not behaviour)');

  if (JSON.stringify(live.settings) !== JSON.stringify(cand.settings)) { die('settings changed'); }
  ok('settings byte-identical (retention still off)');

  const edges = [];
  for (const k of Object.keys(cand.connections)) {
    if (JSON.stringify(live.connections[k]) !== JSON.stringify(cand.connections[k])) { edges.push(k); }
  }
  const wantEdges = ['IF Privacy Recorded'].concat(NEW_NODES.filter((n) => n !== 'IF Receipt Present'))
    .concat(['IF Receipt Present']).sort();
  const gotEdges = edges.slice().sort();
  const unexpected = gotEdges.filter((e) => wantEdges.indexOf(e) === -1);
  if (unexpected.length) { die('unexpected connection changes: ' + unexpected.join(', ')); }
  ok('connection changes confined to IF Privacy Recorded and the seven new nodes');

  const t = cand.connections['IF Privacy Recorded'].main;
  if (t[0][0].node !== 'Receipt Probe') { die('the privacy true-branch does not enter the receipt contract'); }
  if (t[1][0].node !== 'Respond Submit Unresolved') { die('the privacy false-branch changed'); }
  ok('privacy true-branch -> Receipt Probe; false-branch unchanged');

  const into = [];
  for (const [src, c] of Object.entries(cand.connections)) {
    (c.main || []).forEach((br) => (br || []).forEach((x) => { if (x.node === 'Build Intake Payload') { into.push(src); } }));
  }
  if (into.length !== 1 || into[0] !== 'IF Receipt Present') {
    die('Lead Intake is reachable without a proven receipt, via: ' + into.join(', '));
  }
  ok('the ONLY path to Lead Intake is through IF Receipt Present');

  const ins = cand.nodes.find((n) => n.name === 'Preallocate Receipt');
  if (ins.parameters.operation !== 'insert') { die('Preallocate Receipt is not an insert'); }
  if (ins.parameters.dataTableId.value !== 'Submission_Receipts') { die('a SECOND receipt store was introduced'); }
  const v = ins.parameters.columns.value;
  if (Object.keys(v).length !== 11) { die('the receipt row does not carry the Concierge eleven columns'); }
  if (v.commit_state !== 'READY') { die('the initial commit_state is not READY'); }
  ok('preallocation writes the Concierge row into the Concierge store, commit_state READY');
}
say('');

// ── 6. rollback ────────────────────────────────────────────────────────────────────────────────
say('STEP 6 — rollback');
mkdirSync(OUT_DIR, { recursive: true });
const rollback = join(OUT_DIR, SUBMIT_ID + '.pre-receipt-contract.json');
if (!existsSync(rollback)) { writeFileSync(rollback, JSON.stringify(live, null, 2), 'utf8'); }
ok('rollback: ' + rollback);
say('');

if (!CONFIRM) { say('DRY RUN — nothing was written. Re-run with --confirm to deploy.\n'); process.exit(0); }

// ── 7. write, read back, and re-hash the neighbours ────────────────────────────────────────────
say('STEP 7 — write');
await api('PUT', '/workflows/' + SUBMIT_ID, {
  name: live.name, nodes: cand.nodes, connections: cand.connections, settings: cand.settings
});
ok('written');

const after = await api('GET', '/workflows/' + SUBMIT_ID);
{
  for (const n of NEW_NODES) {
    if (!after.nodes.find((x) => x.name === n)) { die('the tenant did not store ' + n); }
  }
  ok('all seven receipt nodes present on the tenant');
  const strip = (n) => JSON.stringify(Object.assign({}, n, { id: undefined, webhookId: undefined }));
  const diff = cand.nodes.filter((c) => strip(after.nodes.find((x) => x.name === c.name)) !== strip(c));
  if (diff.length) { die('read-back differs from the candidate: ' + diff.map((d) => d.name).join(', ')); }
  ok('read-back equals the candidate exactly');
  const pw = after.nodes.find((n) => n.name === 'Write Privacy Acknowledgement');
  if (String((pw.parameters.options || {}).queryReplacement).split(',').length !== 7) { die('the privacy binding was damaged'); }
  ok('the privacy binding survived unchanged');
}

for (const [id, rec] of Object.entries(neighbours)) {
  const w = await api('GET', '/workflows/' + id);
  if (sha(structural(w)) !== rec.hash) { die(rec.label + ' CHANGED during this deploy'); }
  ok(rec.label.padEnd(12) + ' unchanged');
}
say('\nDEPLOYED. Seven nodes added, one edge rewired, nothing else.\n');
