#!/usr/bin/env node
// FINMENTOR — let the spine read the SESSION from whichever session node ran.
//
//   node scripts/deploy-session-resolver.mjs --dry-run
//   node scripts/deploy-session-resolver.mjs --confirm
//
// ── THE DEFECT, AND WHY IT IS MY OWN INCOMPLETE FIX ────────────────────────────────────────────
//
// The premium branch replaces TWO nodes: the session resolver and the response builder. When the
// transport failure was diagnosed I found thirteen nodes hard-referencing `$('Build Bot Response')`
// and fixed all thirteen — and never asked the same question about `$('Get Bot Session')`. Eleven
// nodes reference that one, and the premium path does not execute it either.
//
// So the chain dies at `Issuance Gate` with "Node 'Get Bot Session' hasn't been executed", which is
// AFTER `Send Client Message`. The owner therefore SAW a correct reply and the run still failed —
// and, decisively, `Save Bot Session` sits downstream of the failure and never ran.
//
// ── WHY THAT PRODUCED THE WRONG SCREEN ─────────────────────────────────────────────────────────
//
// Because the session is never written, every message is judged against a stale row. Live evidence:
// execution 4364 moved the state to TG_FREEFORM_PROBLEM, but the sheet still read
// BUSINESS_MODEL_SELECTED; execution 4367 (the free text) therefore evaluated
// `awaiting_problem = (state === 'TG_FREEFORM_PROBLEM')` as FALSE, fell past the free-text branch
// in `decide()`, and reached its final line — `return screen('TG_ENTRY')`.
//
// One cause, two symptoms: a failing execution and a conversation that cannot advance.
//
// ── THE FIX ────────────────────────────────────────────────────────────────────────────────────
//
// The same resolver already proven for the response builder. When the premium session node has not
// executed, the expression reduces to exactly what is there today, character for character, and the
// deploy proves it by reversing the token and requiring each node back byte-for-byte.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const LEGACY = "$('Get Bot Session')";
const PREMIUM_NODE = 'Get Bot Session (Premium)';
const RESOLVER = "($('" + PREMIUM_NODE + "').isExecuted ? $('" + PREMIUM_NODE + "') : $('Get Bot Session'))";
// Neither session node may resolve itself, and the legacy node's own comment must not be rewritten
// — that would break the "every existing node byte-identical" guarantee for a comment.
const SKIP = ['Get Bot Session', PREMIUM_NODE];

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
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
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
say('Session dependency: resolve the session from whichever node ran');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

say('STEP 1 — fresh read');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('  name       : ' + live.name);
say('  nodes      : ' + live.nodes.length + '   active: ' + live.active);
say('  structural : ' + beforeStruct);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-session-resolver.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-session-resolver.json');
say('');

say('STEP 2 — substitute the reference, and nothing else');
const patched = JSON.parse(JSON.stringify(live));
const touched = [];
for (const n of patched.nodes) {
  if (SKIP.indexOf(n.name) !== -1) { continue; }
  let hits = 0;
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') { return; }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.indexOf(LEGACY) !== -1) {
        hits += v.split(LEGACY).length - 1;
        obj[k] = v.split(LEGACY).join(RESOLVER);
      } else if (v && typeof v === 'object') { walk(v); }
    }
  };
  walk(n.parameters);
  if (hits) { touched.push({ name: n.name, type: n.type.replace('n8n-nodes-base.', ''), hits: hits }); }
}
if (!touched.length) { die('no node references ' + LEGACY + ' — nothing to do, or the reference changed shape'); }
for (const t of touched) { say('  ' + t.name.padEnd(34) + ' [' + t.type + ']  ' + t.hits + ' reference' + (t.hits > 1 ? 's' : '')); }
ok(touched.length + ' nodes updated, ' + touched.reduce((a, t) => a + t.hits, 0) + ' references in total');
say('');

say('STEP 3 — prove nothing else moved');
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('settings changed'); }
  if (patched.name !== live.name) { die('name changed'); }
  ok('node count, connections, settings and name unchanged');

  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name).sort();
  if (changed.join('|') !== touched.map((t) => t.name).sort().join('|')) { die('nodes changed beyond the substitution: ' + changed.join(', ')); }
  ok('exactly the ' + changed.length + ' intended nodes differ');

  for (const n of patched.nodes) {
    const was = live.nodes.find((x) => x.name === n.name);
    const undone = JSON.stringify(n).split(JSON.stringify(RESOLVER).slice(1, -1)).join(JSON.stringify(LEGACY).slice(1, -1));
    if (undone !== JSON.stringify(was)) { die(n.name + ': the change is not a pure substitution of the reference'); }
  }
  ok('every change is a PURE substitution — reversing the token restores each node byte-for-byte');

  for (const name of SKIP) {
    if (JSON.stringify(patched.nodes.find((n) => n.name === name)) !== JSON.stringify(live.nodes.find((n) => n.name === name))) {
      die(name + ' was modified and must not be');
    }
  }
  ok('both session nodes untouched, including the legacy node\'s own comment');

  const legacyResp = patched.nodes.find((n) => n.name === 'Build Bot Response');
  if (JSON.stringify(legacyResp) !== JSON.stringify(live.nodes.find((n) => n.name === 'Build Bot Response'))) { die('the legacy response builder changed'); }
  ok('the legacy response builder is untouched');

  for (const n of patched.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
    if (n.type !== 'n8n-nodes-base.code') { continue; }
    if (!touched.find((t) => t.name === n.name)) { continue; }
    try { new Function(String(n.parameters.jsCode).replace(/\$\(/g, '__ref(').replace(/\$input/g, '__input').replace(/\$json/g, '__json')); }
    catch (e) { die(n.name + ': the patched body does not parse: ' + e.message); }
  }
  ok('every patched Code node parses; P9-R2 flag pair absent');

  // The previous resolver must still be in place — this fix must not undo it.
  const bt = patched.nodes.find((n) => n.name === 'Build Transport Request');
  if (String(bt.parameters.jsCode).indexOf("$('Build Bot Response (Premium)').isExecuted") === -1) {
    die('the response resolver is gone from Build Transport Request — refusing to regress it');
  }
  ok('the earlier response resolver is still in place');
}
say('');

if (DRY) {
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.session-resolver-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
  say('DRY RUN — nothing written. Candidate saved to .uat/.');
  say('');
} else {
  say('STEP 4 — writing');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(patched), 3);
  ok('written');
  say('');
  say('STEP 5 — fresh read and verify');
  const after = await api('GET', '/workflows/' + CONCIERGE_ID);
  let good = true;
  if (structural(after.nodes, after.connections) !== beforeStruct) { bad('structural hash moved'); good = false; }
  else { ok('structural hash identical'); }
  if (after.name !== live.name) { bad('renamed'); good = false; } else { ok('name unchanged'); }
  if (!after.active) { bad('NOT active'); good = false; } else { ok('active'); }
  const still = after.nodes.filter((n) => SKIP.indexOf(n.name) === -1 &&
    JSON.stringify(n.parameters).indexOf(LEGACY) !== -1 &&
    JSON.stringify(n.parameters).indexOf('isExecuted') === -1);
  if (still.length) { bad('nodes still hard-reference the legacy session node: ' + still.map((n) => n.name).join(', ')); good = false; }
  else { ok('no node hard-references the legacy session node any more'); }
  if (!(after.settings || {}).errorWorkflow) { bad('errorWorkflow binding lost'); good = false; }
  else { ok('error monitor binding intact'); }
  say('');
  say(good ? '  SESSION RESOLVER = PASS' : '  SESSION RESOLVER = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-session-resolver.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
