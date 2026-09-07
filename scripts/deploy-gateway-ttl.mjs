#!/usr/bin/env node
// FINMENTOR — the authorised one-line Gateway TTL change.
//
//   node scripts/deploy-gateway-ttl.mjs --dry-run
//   node scripts/deploy-gateway-ttl.mjs --confirm
//
// LIVE. It changes the app-session TTL from 1800 s to 259200 s (72 h) and NOTHING else.
//
// ── WHY IT PATCHES THE LIVE NODE INSTEAD OF DEPLOYING THE GENERATED CANDIDATE ──────────────────
//
// `n8n/candidate/miniapp-gateway-candidate.json` is produced by a builder that regenerates the
// whole workflow. Deploying it wholesale would mean trusting the generator to reproduce every one
// of thirteen nodes byte-for-byte — and any place it did not would be unauthorised drift arriving
// under an authorisation for one number.
//
// So this fetches the LIVE workflow and rewrites a single literal inside a single node. The diff is
// then a single value by construction, not by inspection.
//
// ── WHAT IS EXPLICITLY OUT OF SCOPE ────────────────────────────────────────────────────────────
//
// The Telegram initData freshness window, G5 replay semantics, replay-key derivation, the atomic
// claim, BOT_ID, the public contract, response codes, credential topology and execution retention.
// Each is checked byte-for-byte after the patch, and the script refuses to write if any moved.
//
// `expires_at` is a column name shared by the app session and the G5 replay ledger. The replay
// clock is auth_date + 900 and lives in Derive Replay Key; a blanket search for the string would
// measure the wrong thing, so the checks below name the nodes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const MINT_NODE = 'Build App Session';
const OLD_TTL = 'const TTL_SECONDS = 1800;';
const NEW_TTL = 'const TTL_SECONDS = 259200;';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
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
const structural = (nodes, connections) => sha({
  n: nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null, n.alwaysOutputData || null]),
  c: connections
});
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });

say('');
say('Gateway app-session TTL: 1800 s -> 259200 s (72 h)');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

if (!BASE || !READ_KEY || !WRITE_KEY) { die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('this modifies the production Gateway; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

// 1. Fresh read ---------------------------------------------------------------------------------
say('STEP 1 — fresh-read the live Gateway');
const live = await api('GET', '/workflows/' + GATEWAY_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('  name        : ' + live.name);
say('  nodes       : ' + live.nodes.length + '   active: ' + live.active);
say('  structural  : ' + beforeStruct);
writeFileSync(join(OUT_DIR, GATEWAY_ID + '.before.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact written: .uat/' + GATEWAY_ID + '.before.json');
say('');

// 2. Locate the single literal ------------------------------------------------------------------
say('STEP 2 — locate the authorised value');
const mint = live.nodes.find((n) => n.name === MINT_NODE);
if (!mint) { die('the Gateway has no node named ' + MINT_NODE); }
const origCode = mint.parameters.jsCode;
const occurrences = origCode.split(OLD_TTL).length - 1;
if (occurrences === 0) {
  if (origCode.indexOf(NEW_TTL) !== -1) { die('the Gateway already carries the 72 h TTL — nothing to do'); }
  die(MINT_NODE + ': the literal "' + OLD_TTL + '" was not found. Do not splice blindly.');
}
if (occurrences !== 1) { die(MINT_NODE + ': the TTL literal appears ' + occurrences + ' times; expected exactly one'); }
ok(MINT_NODE + ': exactly one occurrence of the authorised literal');
say('');

// 3. Build the patched workflow -----------------------------------------------------------------
const patched = JSON.parse(JSON.stringify(live));
patched.nodes.find((n) => n.name === MINT_NODE).parameters.jsCode = origCode.replace(OLD_TTL, NEW_TTL);

// 4. Prove the diff is exactly one value ---------------------------------------------------------
say('STEP 3 — prove the diff is the single authorised value');
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('the connection graph changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('workflow settings changed'); }

  const changed = [];
  for (const n of patched.nodes) {
    const was = live.nodes.find((x) => x.name === n.name);
    if (!was) { die('a node appeared: ' + n.name); }
    if (JSON.stringify(n) !== JSON.stringify(was)) { changed.push(n.name); }
  }
  for (const n of live.nodes) {
    if (!patched.nodes.find((x) => x.name === n.name)) { die('a node disappeared: ' + n.name); }
  }
  if (changed.join(',') !== MINT_NODE) { die('nodes changed beyond the authorisation: ' + changed.join(', ')); }
  ok('exactly one node differs: ' + MINT_NODE);

  // Everything on that node except jsCode must be identical too.
  const a = Object.assign({}, mint, { parameters: Object.assign({}, mint.parameters, { jsCode: null }) });
  const b = patched.nodes.find((n) => n.name === MINT_NODE);
  const b2 = Object.assign({}, b, { parameters: Object.assign({}, b.parameters, { jsCode: null }) });
  if (JSON.stringify(a) !== JSON.stringify(b2)) { die(MINT_NODE + ': something other than jsCode changed'); }

  // Line-level diff of the one node.
  const before = origCode.split('\n');
  const after = b.parameters.jsCode.split('\n');
  if (before.length !== after.length) { die(MINT_NODE + ': the line count changed'); }
  const lines = [];
  for (let i = 0; i < before.length; i++) { if (before[i] !== after[i]) { lines.push(i + 1); } }
  if (lines.length !== 1) { die(MINT_NODE + ': ' + lines.length + ' lines differ; expected exactly one'); }
  say('');
  say('  EXACT FIELD-LEVEL DIFF (node ' + MINT_NODE + ', line ' + lines[0] + '):');
  say('    - ' + before[lines[0] - 1]);
  say('    + ' + after[lines[0] - 1]);
  say('');
  ok('one line, one value, nothing else');
}

// 5. Prove every out-of-scope property is untouched ----------------------------------------------
say('STEP 4 — prove the out-of-scope Gateway properties are untouched');
{
  const checks = [
    ['G5 replay-key derivation', 'Derive Replay Key'],
    ['G5 atomic claim', 'G5 Replay Claim']
  ];
  for (const [label, node] of checks) {
    const x = live.nodes.find((n) => n.name === node);
    const y = patched.nodes.find((n) => n.name === node);
    if (!x || !y) { die('missing node: ' + node); }
    if (JSON.stringify(x) !== JSON.stringify(y)) { die(label + ': changed'); }
    ok(label + ': byte-identical');
  }

  const derive = live.nodes.find((n) => n.name === 'Derive Replay Key').parameters.jsCode;
  if (!/authDate \+ 900/.test(derive)) { die('the G5 freshness window is no longer auth_date + 900'); }
  if (/259200/.test(derive)) { die('the new TTL leaked into the replay-key derivation'); }
  ok('G5 freshness window: auth_date + 900, unchanged, and the new TTL did not leak into it');

  const claim = live.nodes.find((n) => n.name === 'G5 Replay Claim');
  if (!/on conflict \(replay_key\) do nothing/.test(claim.parameters.query)) { die('the atomic claim lost its conflict clause'); }
  ok('G5 atomic claim: on conflict (replay_key) do nothing, unchanged');

  // Public contract: webhook route, method, and every response node.
  const hookBefore = live.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const hookAfter = patched.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (JSON.stringify(hookBefore) !== JSON.stringify(hookAfter)) { die('the public webhook contract changed'); }
  ok('public contract: route ' + hookBefore.parameters.httpMethod + ' /' + hookBefore.parameters.path + ', unchanged');

  const respBefore = live.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  const respAfter = patched.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  if (JSON.stringify(respBefore) !== JSON.stringify(respAfter)) { die('a response node changed'); }
  ok('response codes: ' + respBefore.length + ' responders, all unchanged');

  // Credential topology.
  const creds = (w) => w.nodes.filter((n) => n.credentials).map((n) => n.name + ':' + Object.keys(n.credentials).join('+') +
    ':' + Object.values(n.credentials).map((c) => c.id).join('+')).sort().join(' | ');
  if (creds(live) !== creds(patched)) { die('credential topology changed'); }
  ok('credential topology: unchanged');

  // Execution retention.
  const ret = (w) => JSON.stringify({
    p: (w.settings || {}).saveExecutionProgress, m: (w.settings || {}).saveManualExecutions,
    e: (w.settings || {}).saveDataErrorExecution, s: (w.settings || {}).saveDataSuccessExecution
  });
  if (ret(live) !== ret(patched)) { die('execution retention settings changed'); }
  say('        retention: ' + ret(live));
  ok('execution retention: unchanged');

  // BOT_ID and no raw initData persistence.
  const build = patched.nodes.find((n) => n.name === MINT_NODE).parameters.jsCode;
  for (const forbidden of ['init_data', 'initData', 'signature', 'auth_date']) {
    if (build.indexOf(forbidden) !== -1) { die(MINT_NODE + ' would persist ' + forbidden); }
  }
  ok('the minted session row carries no initData, signature, hash or auth_date');
}
say('');

if (DRY) {
  say('DRY RUN — nothing was written.');
  say('');
}

// Node on Windows raises a libuv assertion if process.exit() runs while a keep-alive socket is
// still closing, turning a clean dry run into exit code 9. An exit code that lies about success is
// worse than a verbose one, so the write is SKIPPED rather than the process killed.
if (!DRY) {

// 6. Write --------------------------------------------------------------------------------------
say('STEP 5 — writing');
await api('PUT', '/workflows/' + GATEWAY_ID, importable(patched), 3);
ok('Gateway updated');
say('');

// 7. Fresh readback -----------------------------------------------------------------------------
say('STEP 6 — fresh-read and verify');
const after = await api('GET', '/workflows/' + GATEWAY_ID);
let allGood = true;
{
  const afterStruct = structural(after.nodes, after.connections);
  say('  nodes       : ' + after.nodes.length + '   active: ' + after.active);
  say('  structural  : ' + afterStruct);
  if (afterStruct !== beforeStruct) { bad('the structural hash moved — this change adds no node and no edge'); allGood = false; }
  else { ok('structural hash IDENTICAL before and after'); }

  const code = after.nodes.find((n) => n.name === MINT_NODE).parameters.jsCode;
  if (code.indexOf(NEW_TTL) === -1) { bad('the deployed TTL is not 259200'); allGood = false; }
  else { ok('deployed TTL is 259200 s (72 h)'); }
  if (code.indexOf(OLD_TTL) !== -1) { bad('the old 1800 s literal is still present'); allGood = false; }

  const derive = after.nodes.find((n) => n.name === 'Derive Replay Key');
  if (!/authDate \+ 900/.test(derive.parameters.jsCode)) { bad('G5 freshness window changed'); allGood = false; }
  else { ok('G5 freshness window still auth_date + 900'); }

  const claim = after.nodes.find((n) => n.name === 'G5 Replay Claim');
  if (!/on conflict \(replay_key\) do nothing/.test(claim.parameters.query)) { bad('G5 atomic claim changed'); allGood = false; }
  else { ok('G5 atomic claim unchanged'); }

  // Everything except the mint node must still be byte-identical to what was live.
  const drifted = [];
  for (const n of after.nodes) {
    if (n.name === MINT_NODE) { continue; }
    const was = live.nodes.find((x) => x.name === n.name);
    if (!was || JSON.stringify(n) !== JSON.stringify(was)) { drifted.push(n.name); }
  }
  if (drifted.length) { bad('post-deploy drift in: ' + drifted.join(', ')); allGood = false; }
  else { ok('all ' + (after.nodes.length - 1) + ' other nodes byte-identical to the pre-deploy read'); }

  if (!after.active) { bad('the Gateway is NOT active'); allGood = false; }
  else { ok('the Gateway is active'); }

  const ret = after.settings || {};
  if (ret.saveDataSuccessExecution !== 'none' || ret.saveDataErrorExecution !== 'none') {
    bad('execution retention is not off: ' + JSON.stringify(ret));
    allGood = false;
  } else { ok('execution retention off — no raw initData can be persisted in an execution'); }
}
say('');

// 8. Retained executions ------------------------------------------------------------------------
say('STEP 7 — retained executions');
{
  const list = await api('GET', '/executions?workflowId=' + GATEWAY_ID + '&limit=10');
  const n = ((list && list.data) || []).length;
  if (n === 0) { ok('retained executions: 0'); }
  else { bad('retained executions: ' + n + ' (expected 0 with retention off)'); allGood = false; }
}
say('');
say(allGood ? '  GATEWAY 72H TTL = PASS' : '  GATEWAY 72H TTL = FAIL');
say('');
say('  rollback: PUT /api/v1/workflows/' + GATEWAY_ID + '  with .uat/' + GATEWAY_ID + '.before.json');
say('');
if (!allGood) { process.exitCode = 1; }
}

