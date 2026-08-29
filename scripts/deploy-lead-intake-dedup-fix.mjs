#!/usr/bin/env node
// FINMENTOR — P9-R4: deploy the minimal dedup fail-open remediation to Lead Intake PREMIUM FINAL.
//
//   node scripts/deploy-lead-intake-dedup-fix.mjs            (preflight only, deploys nothing)
//   node scripts/deploy-lead-intake-dedup-fix.mjs --deploy
//
// THE DEPLOYMENT MODEL. This does NOT push a tracked artifact. n8n/src/deploy-guard/materializer.js
// exists because P7.5 deployed a workflow generated from a tracked export and took every field it
// did not mean to change along for the ride. The same discipline applies here:
//
//   A   the tracked export      n8n/production/QmIyEW2ZEqKregmN...json
//   B   the reviewed change     the remediation, expressed as a FUNCTION rather than a document
//   L   the fresh live workflow the only thing that knows production's real values
//
//   1.  L must equal A on every executable field. Otherwise production has drifted from what was
//       reviewed and NOTHING is deployed.
//   2.  C_live = remediate(L). The delta is applied to the LIVE graph, so no field the delta does
//       not name can be sourced from a document.
//   3.  diff(L, C_live) must be EXACTLY the five declared changes — no more, and no fewer.
//   4.  C_live must independently satisfy the absolute invariants. Steps 1-3 are comparative, and
//       a comparative check cannot see a defect present on both sides.
//   5.  The readback after the PUT must equal C_live on every executable field.
//
// The pre-deploy live graph is written to n8n/history/ before anything is sent, so a rollback is
// a file rather than a reconstruction.
//
// SECRETS. Reads use N8N_API_KEY, the single write uses N8N_FIX_API_KEY, both from the
// environment only. Nothing is printed but node names, field names and counts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  remediate, diff, verifyDiff, verifyRemediated,
  LEAD_INTAKE_ID, DEDUP_NODE, GUARD_NODE
} from './build-lead-intake-dedup-remediation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC_PATH = join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');
const HISTORY = join(ROOT, 'n8n', 'history', 'QmIyEW2ZEqKregmN.pre-p9r4-dedup-fix.json');

const DEPLOY = process.argv.includes('--deploy');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

function die(m) { console.error('\nABORTED: ' + m); process.exit(1); }
function ok(m) { console.log('  PASS  ' + m); }
function bad(m) { console.log('  FAIL  ' + m); }
function say(m) { console.log(m); }

if (!BASE) { die('N8N_BASE_URL is not set.'); }
if (!READ_KEY) { die('N8N_API_KEY is not set.'); }

async function api(method, path, body, write) {
  const key = write ? WRITE_KEY : READ_KEY;
  if (write && !key) { throw new Error('N8N_FIX_API_KEY is not set; refusing to write.'); }
  if (method !== 'GET' && !write) { throw new Error('refusing ' + method + ' without the write key'); }
  const res = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
  if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + text.slice(0, 300)); }
  return json;
}

function normalise(wf) {
  const nodes = {};
  for (const n of wf.nodes) {
    nodes[n.name] = {
      type: n.type, typeVersion: n.typeVersion, parameters: n.parameters,
      credentials: n.credentials ? Object.fromEntries(Object.entries(n.credentials).map(([k, v]) => [k, v.id])) : null,
      alwaysOutputData: n.alwaysOutputData === true,
      onError: n.onError ?? null,
      disabled: n.disabled === true
    };
  }
  return { nodes, connections: wf.connections, settings: wf.settings };
}

function compare(a, b) {
  const A = normalise(a), B = normalise(b);
  const out = [];
  for (const n of new Set([...Object.keys(A.nodes), ...Object.keys(B.nodes)])) {
    if (!A.nodes[n]) { out.push('node only on the right: ' + n); continue; }
    if (!B.nodes[n]) { out.push('node only on the left: ' + n); continue; }
    if (JSON.stringify(A.nodes[n]) !== JSON.stringify(B.nodes[n])) { out.push('node differs: ' + n); }
  }
  if (JSON.stringify(A.connections) !== JSON.stringify(B.connections)) { out.push('connections differ'); }
  if (JSON.stringify(A.settings) !== JSON.stringify(B.settings)) { out.push('settings differ'); }
  return out;
}

const deployable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings });

async function main() {
  say('');
  say('P9-R4 — deploy the Lead Intake dedup fail-open remediation');
  say('='.repeat(78));
  say('');

  const A = JSON.parse(readFileSync(SRC_PATH, 'utf8'));
  const L = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
  ok('live fetched: ' + L.name + '  (' + L.nodes.length + ' nodes, active=' + L.active + ')');

  // ---- step 1: L must equal A ----
  const drift = compare(L, A);
  if (drift.length) {
    drift.forEach((d) => bad(d));
    die('the LIVE workflow has drifted from the tracked export. STOP — nothing is deployed.');
  }
  ok('step 1  L == A on every executable field (0 differences)');

  const liveDedup = L.nodes.find((n) => n.name === DEDUP_NODE);
  if (liveDedup.onError === 'continueRegularOutput') {
    say('');
    say('The live ' + DEDUP_NODE + ' is ALREADY remediated. Nothing to deploy.');
    return;
  }

  // ---- step 2: C_live = remediate(L) ----
  const C = remediate(deployable(L));
  ok('step 2  C_live = remediate(L)  — the delta applied to the LIVE graph, not to a document');

  // ---- step 3: the diff must be exactly the declared change ----
  const changes = diff(deployable(L), C);
  const dv = verifyDiff(changes);
  say('');
  say('        FIELD-LEVEL DIFF  L -> C_live');
  for (const c of changes) {
    say('          ' + c.node + '.' + c.field);
    say('            from ' + String(c.from).slice(0, 150));
    say('            to   ' + String(c.to).slice(0, 150));
  }
  say('');
  if (!dv.ok) { dv.failures.forEach((x) => bad(x)); die('the diff is not the minimum remediation. STOP.'); }
  ok('step 3  the diff is EXACTLY the ' + changes.length + ' declared changes, across ' +
    new Set(changes.map((c) => c.node)).size + ' nodes; ' + (L.nodes.length - 2) + ' of ' + L.nodes.length + ' nodes untouched');

  // ---- step 4: absolute invariants on C_live alone ----
  const rv = verifyRemediated(C);
  if (!rv.ok) { rv.failures.forEach((x) => bad(x)); die('C_live fails its absolute invariants. STOP.'); }
  ok('step 4  C_live satisfies the absolute invariants (flag pair absent graph-wide; 503 contract intact)');

  if (!DEPLOY) {
    say('');
    say('Preflight only. Nothing was deployed. Re-run with --deploy.');
    return;
  }
  if (!WRITE_KEY) { die('N8N_FIX_API_KEY is not set; refusing to deploy.'); }

  // ---- rollback point ----
  writeFileSync(HISTORY, JSON.stringify(L, null, 2) + '\n', 'utf8');
  ok('rollback point written: n8n/history/QmIyEW2ZEqKregmN.pre-p9r4-dedup-fix.json');

  // ---- the single write ----
  await api('PUT', '/workflows/' + LEAD_INTAKE_ID, C, true);
  ok('PUT /workflows/' + LEAD_INTAKE_ID + ' accepted');

  // ---- step 5: readback ----
  const R = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
  const back = compare(R, C);
  if (back.length) {
    back.forEach((d) => bad(d));
    die('the READBACK does not match what was deployed. Investigate before doing anything else; '
      + 'the rollback point is n8n/history/QmIyEW2ZEqKregmN.pre-p9r4-dedup-fix.json');
  }
  ok('step 5  readback == C_live on every executable field');
  ok('live active flag: ' + R.active);

  // Refresh the tracked export so the repo describes what is deployed. The WHOLE readback is
  // written, not the old export with new nodes spliced in: a live export also carries an
  // `activeVersion` blob — an entire second copy of the graph (P9-R3) — and carrying the
  // PRE-deploy one forward would leave a stale duplicate of the defective graph in the repo,
  // which is exactly the kind of second copy that caused trouble in the first place.
  writeFileSync(SRC_PATH, JSON.stringify(R, null, 2) + '\n', 'utf8');
  ok('tracked export refreshed from the readback (whole document, no spliced-in stale blob)');

  say('');
  say('DEPLOYED. Re-run the harness against the deployed structure:');
  say('  node scripts/run-lead-intake-dedup-harness.mjs --run --remediated');
}

main().catch((e) => { console.error('\nERROR: ' + e.message); process.exit(1); });
