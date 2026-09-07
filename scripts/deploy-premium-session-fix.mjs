#!/usr/bin/env node
// FINMENTOR — repair the premium session node on the live Concierge.
//
//   node scripts/deploy-premium-session-fix.mjs --dry-run
//   node scripts/deploy-premium-session-fix.mjs --confirm
//
// LIVE. It replaces the jsCode of ONE node — `Get Bot Session (Premium)` — and nothing else.
//
// ── WHAT WENT WRONG ────────────────────────────────────────────────────────────────────────────
//
// The premium session node is the live cycle-semantics gate with the /start reset removed. The
// removal was done by COMMENTING OUT the line — and that line is the head of an if/else chain, so
// the first `else` was orphaned and the node threw `SyntaxError: Unexpected token 'else'`.
//
// The owner's two real /start messages (executions 4221 and 4223) reached n8n, passed the owner
// gate, routed to the premium branch, and died there. No response node ran, so the bot said
// nothing at all — no greeting, no error, silence.
//
// ── WHY A ONE-NODE PATCH AND NOT A REDEPLOY ────────────────────────────────────────────────────
//
// The full deploy script compares the live workflow against the PRE-premium rollback artifact and
// stops on drift. The premium branch is deployed now, so that check would correctly refuse — and
// working around it would defeat the guard that protects this workflow. Patching the single broken
// node keeps the diff provably one node, the way the Gateway TTL change was done.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const NODE = 'Get Bot Session (Premium)';
const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

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
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 200)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const structural = (nodes, connections) => sha({
  n: nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null, n.alwaysOutputData || null]), c: connections });
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

if (!BASE || !READ_KEY || !WRITE_KEY) { die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('this modifies the live Concierge; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

say('');
say('Premium session node repair — one node, one body');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('STEP 1 — fresh read');
say('  name       : ' + live.name);
say('  nodes      : ' + live.nodes.length + '   active: ' + live.active);
say('  structural : ' + beforeStruct);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-session-fix.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-session-fix.json');
say('');

const target = live.nodes.find((n) => n.name === NODE);
if (!target) { die('the live workflow has no node named ' + NODE); }
const fixed = JSON.parse(readFileSync(CANDIDATE, 'utf8')).nodes.find((n) => n.name === NODE);
if (!fixed) { die('the candidate has no node named ' + NODE); }

say('STEP 2 — the corrected body must parse, and must fix the specific defect');
{
  // The exact check that was missing when this shipped.
  try { new Function(fixed.parameters.jsCode.replace(/\$\(/g, '__ref(').replace(/\$input/g, '__input')); }
  catch (e) { die('the corrected body STILL does not parse: ' + e.message); }
  ok('the corrected body parses');

  const broken = target.parameters.jsCode;
  try {
    new Function(broken.replace(/\$\(/g, '__ref(').replace(/\$input/g, '__input'));
    bad('the DEPLOYED body parses — the defect is not what this repair assumes; stop and re-diagnose');
    die('refusing to deploy a fix for a defect that is not present');
  } catch (e) { ok('the deployed body does NOT parse (' + String(e.message).slice(0, 60) + ') — the defect is confirmed live'); }

  const code = fixed.parameters.jsCode;
  const exec = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  if (/if \(isStart\) reset = /.test(exec)) { die('the /start reset is executable again on the premium path'); }
  ok('the /start reset is still neutralised on the premium path');
  for (const keep of ['SUBMISSION_KEY_RE', 'hasNoCycle', 'isRestart', 'cycle_reset', '__submission_key_action']) {
    if (code.indexOf(keep) === -1) { die('the corrected body lost ' + keep); }
  }
  ok('cycle semantics and submission-key issuance intact');
}
say('');

say('STEP 3 — the diff must be exactly one node body');
const patched = JSON.parse(JSON.stringify(live));
patched.nodes.find((n) => n.name === NODE).parameters.jsCode = fixed.parameters.jsCode;
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('settings changed'); }
  const changed = patched.nodes.filter((n) => {
    const was = live.nodes.find((x) => x.name === n.name);
    return !was || JSON.stringify(n) !== JSON.stringify(was);
  }).map((n) => n.name);
  if (changed.join(',') !== NODE) { die('nodes changed beyond the repair: ' + changed.join(', ')); }
  ok('exactly one node differs: ' + NODE);

  const a = live.nodes.find((n) => n.name === NODE);
  const b = patched.nodes.find((n) => n.name === NODE);
  const strip = (n) => JSON.stringify(Object.assign({}, n, { parameters: Object.assign({}, n.parameters, { jsCode: null }) }));
  if (strip(a) !== strip(b)) { die(NODE + ': something other than jsCode changed'); }
  ok('only jsCode changed on that node');

  // The legacy path must still be exactly as it was.
  const legacy = patched.nodes.find((n) => n.name === 'Get Bot Session');
  if (!/if \(isStart\) reset = 'start';/.test(legacy.parameters.jsCode)) { die('the LEGACY session node lost its /start reset'); }
  ok('the legacy path is untouched and keeps its /start reset');
}
say('');

if (DRY) { say('DRY RUN — nothing written.'); say(''); }
else {
  say('STEP 4 — writing');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(patched), 3);
  ok('written');
  say('');

  say('STEP 5 — fresh read and verify');
  const after = await api('GET', '/workflows/' + CONCIERGE_ID);
  let good = true;
  if (structural(after.nodes, after.connections) !== beforeStruct) { bad('structural hash moved'); good = false; }
  else { ok('structural hash identical'); }
  if (after.name !== live.name) { bad('the workflow was renamed: ' + after.name); good = false; }
  else { ok('name unchanged: ' + after.name); }
  if (!after.active) { bad('the Concierge is NOT active'); good = false; }
  else { ok('active'); }

  const nowNode = after.nodes.find((n) => n.name === NODE);
  try { new Function(nowNode.parameters.jsCode.replace(/\$\(/g, '__ref(').replace(/\$input/g, '__input')); ok('the DEPLOYED body now parses'); }
  catch (e) { bad('the deployed body still does not parse: ' + e.message); good = false; }

  const drift = after.nodes.filter((n) => {
    if (n.name === NODE) { return false; }
    const was = live.nodes.find((x) => x.name === n.name);
    return !was || JSON.stringify(n) !== JSON.stringify(was);
  }).map((n) => n.name);
  if (drift.length) { bad('post-deploy drift: ' + drift.join(', ')); good = false; }
  else { ok('all ' + (after.nodes.length - 1) + ' other nodes byte-identical'); }

  say('');
  say(good ? '  SESSION NODE REPAIR = PASS' : '  SESSION NODE REPAIR = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-session-fix.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
