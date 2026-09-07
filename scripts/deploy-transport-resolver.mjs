#!/usr/bin/env node
// FINMENTOR — let the spine read the response from whichever builder ran.
//
//   node scripts/deploy-transport-resolver.mjs --dry-run
//   node scripts/deploy-transport-resolver.mjs --confirm
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────────
//
// The premium branch was added as a parallel response builder that rejoins the spine at
// `Build Transport Request`. But thirteen nodes downstream do not read their INPUT — they
// hard-reference the legacy node by name:
//
//     const r = $('Build Bot Response').first().json;
//
// On the premium path that node never executes, so the first consumer throws
// `Node 'Build Bot Response' hasn't been executed` (live execution 4239) and the reply is never
// transported. My "additive branch" was additive in the graph and not in the data flow.
//
// ── THE FIX, AND WHY IT IS THIS ONE ────────────────────────────────────────────────────────────
//
// A premium-only transport adapter would fix exactly one node; the next consumer
// (`Build Session Row`, then `IF Lead Ready`, then `Build Bot Event`) fails identically. All
// thirteen are downstream of transport, so a per-branch adapter means duplicating the spine —
// the broad refactor that was ruled out.
//
// Routing premium traffic through the legacy builder is also ruled out, and rightly: its logic is
// the legacy questionnaire.
//
// So each consumer resolves the response from whichever builder ran:
//
//     ($('Build Bot Response (Premium)').isExecuted ? $('Build Bot Response (Premium)')
//                                                   : $('Build Bot Response')).first().json
//
// LEGACY EQUIVALENCE IS BY CONSTRUCTION. When the premium node has not executed, `.isExecuted` is
// false and the expression reduces to `$('Build Bot Response').first().json` — character for
// character what is there today. Nothing else in any node is touched.
//
// `.isExecuted` was measured, not assumed: it returns false without throwing, in a Code node AND
// inside an IF expression (which cannot contain try/catch). One of the thirteen is an IF.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const LEGACY = "$('Build Bot Response')";
const PREMIUM_NODE = 'Build Bot Response (Premium)';
const RESOLVER = "($('" + PREMIUM_NODE + "').isExecuted ? $('" + PREMIUM_NODE + "') : $('Build Bot Response'))";

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
say('Transport dependency: resolve the response from whichever builder ran');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

// ── 1. read and patch ──────────────────────────────────────────────────────────────────────────

say('STEP 1 — fresh read');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('  name       : ' + live.name);
say('  nodes      : ' + live.nodes.length + '   active: ' + live.active);
say('  structural : ' + beforeStruct);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-transport-resolver.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-transport-resolver.json');
say('');

say('STEP 2 — substitute the reference, and nothing else');
const patched = JSON.parse(JSON.stringify(live));
const touched = [];
for (const n of patched.nodes) {
  if (n.name === PREMIUM_NODE) { continue; }             // the premium builder must not resolve itself
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

// ── 2. invariants ──────────────────────────────────────────────────────────────────────────────

say('STEP 3 — prove nothing else moved');
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('settings changed'); }
  if (patched.name !== live.name) { die('name changed'); }
  ok('node count, connections, settings and name unchanged');

  const changed = patched.nodes.filter((n) => {
    const was = live.nodes.find((x) => x.name === n.name);
    return JSON.stringify(n) !== JSON.stringify(was);
  }).map((n) => n.name).sort();
  const expected = touched.map((t) => t.name).sort();
  if (changed.join('|') !== expected.join('|')) { die('nodes changed beyond the substitution: ' + changed.join(', ')); }
  ok('exactly the ' + changed.length + ' intended nodes differ');

  // THE EQUIVALENCE PROOF: undo the substitution and the node must be byte-identical to what is
  // live. That is what "legacy behaviour is unchanged" means, checked rather than asserted.
  for (const n of patched.nodes) {
    const was = live.nodes.find((x) => x.name === n.name);
    const undone = JSON.stringify(n).split(JSON.stringify(RESOLVER).slice(1, -1)).join(JSON.stringify(LEGACY).slice(1, -1));
    if (undone !== JSON.stringify(was)) { die(n.name + ': the change is not a pure substitution of the reference'); }
  }
  ok('every change is a PURE substitution — reversing the token restores each node byte-for-byte');

  // The premium builder must not have been touched, and the legacy builder must still hold its own
  // logic (it is the node non-owners run).
  const prem = patched.nodes.find((n) => n.name === PREMIUM_NODE);
  if (JSON.stringify(prem) !== JSON.stringify(live.nodes.find((n) => n.name === PREMIUM_NODE))) { die('the premium builder was modified'); }
  ok('the premium builder is untouched');
  const legacyNode = patched.nodes.find((n) => n.name === 'Build Bot Response');
  if (JSON.stringify(legacyNode) !== JSON.stringify(live.nodes.find((n) => n.name === 'Build Bot Response'))) { die('the legacy builder was modified'); }
  ok('the legacy builder is untouched');

  for (const n of patched.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
  }
  ok('P9-R2 flag pair absent');

  // Every patched Code node must still parse.
  for (const n of patched.nodes) {
    if (n.type !== 'n8n-nodes-base.code') { continue; }
    if (!touched.find((t) => t.name === n.name)) { continue; }
    try { new Function(String(n.parameters.jsCode).replace(/\$\(/g, '__ref(').replace(/\$input/g, '__input').replace(/\$json/g, '__json')); }
    catch (e) { die(n.name + ': the patched body does not parse: ' + e.message); }
  }
  ok('every patched Code node still parses');
}
say('');

if (DRY) {
  say('DRY RUN — nothing written.');
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.transport-resolver-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
  say('  candidate written to .uat/ for the equivalence harness');
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
  if (after.name !== live.name) { bad('renamed: ' + after.name); good = false; } else { ok('name unchanged'); }
  if (!after.active) { bad('NOT active'); good = false; } else { ok('active'); }
  const stillLegacyOnly = after.nodes.filter((n) => n.name !== PREMIUM_NODE &&
    JSON.stringify(n.parameters).indexOf(LEGACY) !== -1 &&
    JSON.stringify(n.parameters).indexOf('isExecuted') === -1);
  if (stillLegacyOnly.length) { bad('nodes still hard-reference the legacy builder: ' + stillLegacyOnly.map((n) => n.name).join(', ')); good = false; }
  else { ok('no node hard-references the legacy builder any more'); }
  const errWf = (after.settings || {}).errorWorkflow;
  if (!errWf) { bad('errorWorkflow binding lost — the error monitor would go silent'); good = false; }
  else { ok('error monitor binding intact: ' + errWf); }
  say('');
  say(good ? '  TRANSPORT RESOLVER = PASS' : '  TRANSPORT RESOLVER = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-transport-resolver.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
