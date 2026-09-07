#!/usr/bin/env node
// FINMENTOR — C3.1 / C3.4: deploy the Gateway candidate (authoritative cycle + customer result)
// onto the LIVE Mini App Gateway, preserving the live-only nodes the candidate does not model.
//
//   node scripts/deploy-c3-gateway-cycle.mjs --dry-run     prove the merge, write nothing
//   node scripts/deploy-c3-gateway-cycle.mjs --confirm     PUT, then fresh-read and verify
//
// WHY A MERGE AND NOT A REPLACE. The live Gateway carries four nodes deployed after the tracked
// candidate was cut (the session-store failure branch and the two SYSTEM ALERT callers). They are
// tracked as their own candidates and proven live; the Gateway builder deliberately does not
// model them. So this script takes the freshly built candidate as the AUTHORITY for every node it
// declares, keeps every live-only node byte-identical, and merges edges per output index: a branch
// the candidate declares wins, a branch only the live graph has is kept.
//
// WHAT IT REFUSES. Any live node the candidate declares whose live form differs from the tracked
// baseline in a way this script did not expect; any credential appearing on a node other than the
// G5 claim; the P9-R2 flag pair; a rename; a deactivation. It never touches another workflow.
//
// C3 (2026-09-03). The candidate now declares the session-store failure branch itself (every
// unreadable or unproven store answers 503 APPLICATION_STORE_UNAVAILABLE from ONE responder), so
// the two P9-R2 live-only nodes that used to carry that branch — `Session Store Verdict` and
// `Respond Session Unavailable` — are RETIRED by this deploy: removed, not orphaned. Their alert
// caller `Emit System Alert (Session Store)` is kept and re-attached to the new responder.
//
// SECRETS. N8N_API_KEY from the environment only, never printed. The deploy needs a key with write
// scope; N8N_FIX_API_KEY is honoured first for compatibility with the older deploy scripts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { keepRollback } from './lib/rollback-artifact.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildGateway, verifyGateway, NODES, G5_CLAIM_NODE, SUPABASE_CREDENTIAL, CYCLE_PROJECTION_TABLE, CLIENT_RESULT_TABLE } from './build-miniapp-gateway.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

export const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
export const GATEWAY_NAME = 'FINMENTOR Mini App Gateway';
// Live-only nodes, tracked elsewhere (gw-store-failure-h*, system-alert-caller-miniapp-gateway).
export const LIVE_ONLY_NODES = ['Emit System Alert (Claim)', 'Emit System Alert (Session Store)'];
// P9-R2 nodes superseded by the candidate's own store-failure responder; dropped by the merge.
export const RETIRED_LIVE_NODES = ['Session Store Verdict', 'Respond Session Unavailable'];
export const SYSTEM_ALERT_ID = 'ID700kTo6EXffwry';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(m, p, b, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + p, { method: m,
        headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
        body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

// ---------------------------------------------------------------- the merge (pure, exported for the gate)

export function mergeGateway(live, candidate) {
  const out = JSON.parse(JSON.stringify(live));
  const liveByName = Object.fromEntries(out.nodes.map((n) => [n.name, n]));
  const candByName = Object.fromEntries(candidate.nodes.map((n) => [n.name, n]));

  // every candidate node is authoritative; live id/position are kept when the node exists
  const nodes = [];
  for (const c of candidate.nodes) {
    const l = liveByName[c.name];
    const n = JSON.parse(JSON.stringify(c));
    if (l) { n.id = l.id; n.position = l.position; if (l.webhookId) { n.webhookId = l.webhookId; } }
    nodes.push(n);
  }
  // every live-only node is kept byte-identical
  for (const l of out.nodes) {
    if (candByName[l.name]) { continue; }
    if (RETIRED_LIVE_NODES.indexOf(l.name) !== -1) { continue; }
    if (LIVE_ONLY_NODES.indexOf(l.name) === -1) { throw new Error('unexpected live-only node: ' + l.name); }
    nodes.push(JSON.parse(JSON.stringify(l)));
  }
  out.nodes = nodes;

  // edges: per source, per output index — candidate branch wins, live-only branch is kept
  const conns = {};
  const sources = new Set([...Object.keys(candidate.connections), ...Object.keys(out.connections || {})]);
  for (const s of sources) {
    const c = (candidate.connections[s] || {}).main || [];
    const l = ((out.connections || {})[s] || {}).main || [];
    if (!candByName[s] && !liveByName[s]) { continue; }
    if (RETIRED_LIVE_NODES.indexOf(s) !== -1) { continue; }
    const len = Math.max(c.length, l.length);
    const main = [];
    for (let i = 0; i < len; i++) {
      const branch = c[i] !== undefined ? c[i] : (l[i] || []);
      main.push(branch.filter((e) => RETIRED_LIVE_NODES.indexOf(e.node) === -1));
    }
    conns[s] = { main };
  }
  out.connections = conns;
  if (liveByName['Emit System Alert (Session Store)']) {
    out.connections['Respond Application Store Unavailable'] = { main: [[{ node: 'Emit System Alert (Session Store)', type: 'main', index: 0 }]] };
  }
  out.settings = candidate.settings;
  out.name = candidate.name;
  return out;
}

export function verifyMerged(w) {
  const f = [];
  const names = w.nodes.map((n) => n.name);
  for (const n of NODES) { if (names.indexOf(n) === -1) { f.push('missing candidate node: ' + n); } }
  for (const n of LIVE_ONLY_NODES) { if (names.indexOf(n) === -1) { f.push('missing live-only node: ' + n); } }
  if (new Set(names).size !== names.length) { f.push('duplicate node names'); }
  for (const n of RETIRED_LIVE_NODES) { if (names.indexOf(n) !== -1) { f.push('retired node still present: ' + n); } }
  const cred = w.nodes.filter((n) => n.credentials);
  if (cred.length !== 1 || cred[0].name !== G5_CLAIM_NODE || (cred[0].credentials.postgres || {}).id !== SUPABASE_CREDENTIAL.id) {
    f.push('credential boundary violated: ' + cred.map((n) => n.name).join(', '));
  }
  if (w.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres').length !== 1) { f.push('a second Postgres node exists'); }
  for (const n of w.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { f.push('P9-R2 flag pair on ' + n.name); }
    if (n.type === 'n8n-nodes-base.googleSheets' || n.type === 'n8n-nodes-base.httpRequest') { f.push('forbidden node type on ' + n.name); }
    if (n.type === 'n8n-nodes-base.executeWorkflow') {
      const id = String(((n.parameters || {}).workflowId || {}).value || '');
      if (id !== SYSTEM_ALERT_ID) { f.push(n.name + ' calls a workflow other than SYSTEM ALERT: ' + id); }
    }
  }
  const c = w.connections;
  const first = (s, i) => ((((c[s] || {}).main || [])[i] || [])[0] || {}).node;
  if (first('IF Claim Won', 0) !== 'Read Cycle Projection') { f.push('IF Claim Won true branch'); }
  if (first('Read Cycle Projection', 0) !== 'Build App Session') { f.push('projection read edge'); }
  if (first('Build App Session', 0) !== 'IF Cycle Store Readable') { f.push('cycle store gate edge'); }
  if (first('IF Cycle Resolved', 1) !== 'Respond Cycle Unresolved') { f.push('unresolved branch'); }
  if (first('IF Create Session', 1) !== 'IF Session Committed') { f.push('resume branch'); }
  if (first('Create App Session', 0) !== 'Read Back Sessions') { f.push('create edge'); }
  if (first('Create App Session', 1) !== 'Respond Application Store Unavailable') { f.push('session create failure is not fail-closed'); }
  if (first('Respond Store Unavailable', 0) !== 'Emit System Alert (Claim)') { f.push('the claim alert edge was lost'); }
  if (first('Respond Application Store Unavailable', 0) !== 'Emit System Alert (Session Store)') { f.push('the application-store alert edge was lost'); }
  const j = JSON.stringify(w);
  if (j.indexOf(CYCLE_PROJECTION_TABLE) === -1) { f.push('no cycle projection read'); }
  if (j.indexOf(CLIENT_RESULT_TABLE) === -1) { f.push('no client result read'); }
  if (w.settings.saveDataSuccessExecution !== 'none' || w.settings.saveDataErrorExecution !== 'none') { f.push('execution retention'); }
  return f;
}

// ---------------------------------------------------------------- main

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c3-gateway-cycle.mjs');
if (isMain) {
  if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
  if (!DRY && !CONFIRM) { die('this modifies a live workflow; re-run with --confirm (or --dry-run first)'); }
  mkdirSync(OUT_DIR, { recursive: true });

  say('');
  say('C3.1 / C3.4 — Mini App Gateway: authoritative cycle + customer result');
  say('='.repeat(78));
  say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
  say('');

  const live = await api('GET', '/workflows/' + GATEWAY_ID);
  if (live.name !== GATEWAY_NAME) { die('live workflow is not the Gateway: ' + live.name); }
  const rb = keepRollback(join(OUT_DIR, GATEWAY_ID + '.pre-c3-cycle.json'), JSON.stringify(importable(live), null, 2) + '\n');
  if (rb.aside) { ok('rollback artifact KEPT (live differs from it); fresh read saved to ' + rb.aside.replace(ROOT, '.')); }
  else { ok('rollback artifact: .uat/' + GATEWAY_ID + '.pre-c3-cycle.json (' + live.nodes.length + ' nodes, active=' + live.active + ')' + (rb.written ? '' : ' — unchanged')); }

  const candidate = buildGateway({});
  const v = verifyGateway(candidate);
  if (!v.ok) { die('the candidate fails its own verification: ' + v.failures.join(' | ')); }
  ok('candidate built and verified (' + candidate.nodes.length + ' nodes)');

  // Live nodes the candidate declares must be either identical to the candidate already, or be
  // exactly the nodes this deploy changes. Anything else is unexpected drift.
  const EXPECTED_CHANGED = ['IF Claim Won', 'Build App Session', 'Read User Sessions', 'Resolve Session', 'Finalise Session', 'IF Create Session', 'Create App Session', 'Read Back Sessions', 'Read Client Result', 'Attach Client Result'];
  // The live verifier was deployed from a CRLF checkout (LIVE, 2026-09-03: 261 of 262 lines differ
  // by a trailing \r and nothing else). Line endings are not drift; the candidate wins and
  // rewrites the node in LF.
  const norm = (n) => JSON.stringify({ p: n.parameters, t: n.type, v: n.typeVersion, a: n.alwaysOutputData === true, e: n.onError || null, d: n.disabled === true }).split('\\r\\n').join('\\n').split('\\r').join('');
  const liveByName = Object.fromEntries(live.nodes.map((n) => [n.name, n]));
  const drift = [];
  for (const c of candidate.nodes) {
    const l = liveByName[c.name];
    if (!l) { continue; }
    if (norm(l) !== norm(c) && EXPECTED_CHANGED.indexOf(c.name) === -1) { drift.push(c.name); }
  }
  if (drift.length) { die('live nodes differ from the candidate outside the expected change set: ' + drift.join(', ')); }
  ok('every pre-existing candidate node is either unchanged or in the expected change set');
  const added = candidate.nodes.filter((c) => !liveByName[c.name]).map((c) => c.name);
  say('  nodes added      : ' + added.join(', '));
  say('  nodes rewritten  : ' + EXPECTED_CHANGED.filter((n) => liveByName[n] && norm(liveByName[n]) !== norm(candidate.nodes.find((c) => c.name === n))).join(', '));

  const merged = mergeGateway(live, candidate);
  const failures = verifyMerged(merged);
  if (failures.length) { die('merged graph refused: ' + failures.join(' | ')); }
  ok('merged graph verified: ' + merged.nodes.length + ' nodes, alert callers preserved, ' + RETIRED_LIVE_NODES.join(' + ') + ' retired');

  writeFileSync(join(OUT_DIR, GATEWAY_ID + '.c3-cycle-candidate.json'), JSON.stringify(importable(merged), null, 2) + '\n', 'utf8');
  // No process.exit() here: on Node 24 / Windows it trips a libuv assertion (UV_HANDLE_CLOSING)
  // while fetch keep-alive handles are still open, and the dry run then exits 127 AFTER printing
  // its verdict (seen 2026-09-04). Fall through instead; the process ends when the loop drains.
  if (DRY) { say('\nDRY RUN — nothing written. Merged candidate saved to .uat/' + GATEWAY_ID + '.c3-cycle-candidate.json'); }
  else {
  await api('PUT', '/workflows/' + GATEWAY_ID, importable(merged), 3);
  ok('Gateway updated');
  const after = await api('GET', '/workflows/' + GATEWAY_ID);
  const post = verifyMerged(after);
  if (post.length) { bad('post-deploy verification: ' + post.join(' | ')); }
  else { ok('fresh read verified (' + after.nodes.length + ' nodes)'); }
  if (!after.active) { bad('the Gateway is NOT active'); } else { ok('Gateway active'); }
  if (after.name !== GATEWAY_NAME) { bad('renamed'); }
  const bs = after.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode;
  // The refusal items (cycle_store_error, cycle_unresolved) carry cycle_id '' by design; only the
  // SESSION ROW may never. Same pattern as qa/premium-ux-resume.test.mjs.
  if (/cycle_id:\s*'',\s*\n\s*replay_key/.test(bs.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))) { bad('the live Build App Session still stamps an empty cycle on the session row'); }
  else { ok('live Build App Session resolves the cycle from ' + CYCLE_PROJECTION_TABLE); }
  say('');
  // The rollback for THIS deploy is what was live a moment ago. When the named artefact was KEPT
  // (it predates an earlier deploy), that is the timestamped fresh read, not the old capture.
  say('  rollback: PUT /api/v1/workflows/' + GATEWAY_ID + ' with ' + (rb.aside ? rb.aside.replace(ROOT, '.') : '.uat/' + GATEWAY_ID + '.pre-c3-cycle.json'));
  say('');
  }
}
