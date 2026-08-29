#!/usr/bin/env node
// FINMENTOR — P9-R3: drive the isolated Lead Intake dedup-outage harness against the live tenant.
//
//   node scripts/run-lead-intake-dedup-harness.mjs            (preflight only, deploys nothing)
//   node scripts/run-lead-intake-dedup-harness.mjs --run
//
// WHAT THIS DOES, AND WHAT IT REFUSES TO DO.
//
// It deploys two DISPOSABLE harness workflows on new routes, drives real HTTP requests at them,
// reads `runData` per node, and deletes everything it created. It never writes to Lead Intake
// PREMIUM FINAL, never touches the production Google Sheets credential, never touches the
// FINMENTOR_LEADS_CRM spreadsheet or the Submission_Receipts data table, and never writes a row
// anywhere. The harnesses carry no Sheets, Telegram, data-table or OpenAI node at all — except
// H2's single dedup read, which is the node under test and points at a credential that cannot
// authenticate.
//
// It ABORTS before deploying if the live Lead Intake is not a field-level match for the tracked
// export, because a harness that mirrors a stale graph proves nothing about what is deployed. It
// also aborts if the flag pair under test is no longer present in production — in that case the
// finding is already moot and this run would be theatre.
//
// Teardown runs in a finally block. If teardown itself fails, the script says so loudly and
// names the ids that must be removed by hand.
//
// SECRETS. Reads use N8N_API_KEY, writes use N8N_FIX_API_KEY, both from the environment only.
// The disposable credential's material is generated here, never printed, and dies with it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import {
  buildHarness, verifyHarness, divergenceAllowlist,
  LEAD_INTAKE_ID, H1_PATH, H2_PATH, H1_NAME, H2_NAME,
  CREDENTIAL_PLACEHOLDER, DOCUMENT_PLACEHOLDER,
  DEDUP_NODE, GUARD_NODE, WRITE_NODE, BUILD_ROW_NODE
} from './build-lead-intake-dedup-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC_PATH = join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');

const RUN = process.argv.includes('--run');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fidelity of the live graph

// The executable graph only: ids and positions are cosmetic and move when the editor is opened.
function normalise(wf) {
  const nodes = {};
  for (const n of wf.nodes) {
    nodes[n.name] = {
      type: n.type,
      typeVersion: n.typeVersion,
      parameters: n.parameters,
      credentials: n.credentials ? Object.fromEntries(Object.entries(n.credentials).map(([k, v]) => [k, v.id])) : null,
      alwaysOutputData: n.alwaysOutputData === true,
      onError: n.onError ?? null,
      disabled: n.disabled === true
    };
  }
  return { nodes, connections: wf.connections, settings: wf.settings };
}

function compareGraphs(live, tracked) {
  const L = normalise(live), T = normalise(tracked);
  const diffs = [];
  const names = new Set([...Object.keys(L.nodes), ...Object.keys(T.nodes)]);
  for (const n of names) {
    if (!L.nodes[n]) { diffs.push('node only in the tracked export: ' + n); continue; }
    if (!T.nodes[n]) { diffs.push('node only in the LIVE graph: ' + n); continue; }
    if (JSON.stringify(L.nodes[n]) !== JSON.stringify(T.nodes[n])) { diffs.push('node differs: ' + n); }
  }
  if (JSON.stringify(L.connections) !== JSON.stringify(T.connections)) { diffs.push('the connection map differs'); }
  if (JSON.stringify(L.settings) !== JSON.stringify(T.settings)) { diffs.push('settings differ'); }
  return diffs;
}

// ---------------------------------------------------------------- runData reading

// n8n stores per-node run records under data.resultData.runData. A node absent from that object
// DID NOT RUN — which is exactly the question this harness exists to answer.
function runDataOf(exec) {
  const d = exec && exec.data && exec.data.resultData;
  return (d && d.runData) || {};
}

// Item counts per output branch. `[1, 1]` on a node with the flag pair is the signature: the
// error item on output 1 AND a synthetic empty item on output 0.
function outputsOf(runData, name) {
  const runs = runData[name];
  if (!runs || !runs.length) { return null; }
  const main = (runs[0].data && runs[0].data.main) || [];
  return main.map((b) => (b === null || b === undefined ? 0 : b.length));
}

function ranNode(runData, name) { return Array.isArray(runData[name]) && runData[name].length > 0; }

// Which Respond to Webhook nodes actually executed. With the flag pair BOTH branches run, so
// more than one can fire and whichever ran FIRST committed the HTTP response; the others became
// no-ops. Naming them is the only way to say what the caller was told and why.
const RESPOND_NODES = ['Respond Invalid', 'Respond New Lead', 'Respond Retry', 'Respond Merged',
  'Respond Infra Failed', 'Respond Pipeline Failed', 'Respond Merge Failed'];
function respondersOf(runData) { return RESPOND_NODES.filter((n) => ranNode(runData, n)); }

function firstJson(runData, name, branch) {
  const runs = runData[name];
  if (!runs || !runs.length) { return null; }
  const main = (runs[0].data && runs[0].data.main) || [];
  const b = main[branch || 0];
  return (b && b[0] && b[0].json) || null;
}

// ---------------------------------------------------------------- shots

const created = {};
let credentialId = null;

// Contact fields MUST sit under `client`. `Normalize + Score Lead` reads
// `pick(client.email, lead.email)` — a top-level `email` is never seen, so a payload shaped that
// way leaves `email_norm` empty and the `dup` control can never match however correct the rest
// of the harness is. The first run of this script made exactly that mistake and the control
// caught it, which is the entire reason the controls are here.
async function shot(path, mode) {
  const nonce = 'p9r3-' + crypto.randomBytes(10).toString('hex');
  const body = {
    tool: 'p9r3_harness',
    client: {
      name: 'P9R3 Harness',
      company: 'P9R3 Harness Co',
      email: nonce + '@example.invalid'
    },
    harness_dedup: mode,
    harness_nonce: nonce
  };
  let res = null, text = '';
  // A freshly activated webhook can 404 for a moment. Nothing else is retried.
  for (let i = 0; i < 6; i++) {
    res = await fetch(BASE + '/webhook/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    text = await res.text();
    if (res.status !== 404) { break; }
    await sleep(1000);
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
  return { status: res.status, body: json, raw: text.slice(0, 300), nonce, sent: body };
}

// Correlate by NONCE, never by recency. Shots run back to back and executions are persisted
// asynchronously, so "the newest execution started since I fired" can legitimately be the
// PREVIOUS shot's — which silently attributes one mode's runData to another mode. The first run
// of this script did exactly that and produced four identical rows. The nonce is read back out
// of the execution's own Webhook body, so a mismatch cannot pass.
async function executionForNonce(workflowId, nonce) {
  for (let i = 0; i < 20; i++) {
    const list = await api('GET', '/executions?workflowId=' + workflowId + '&limit=10');
    for (const row of (list && list.data) || []) {
      const full = await api('GET', '/executions/' + row.id + '?includeData=true');
      const rd = runDataOf(full);
      const wh = firstJson(rd, 'Webhook', 0);
      const got = wh && wh.body && wh.body.harness_nonce;
      if (got === nonce) { return full; }
    }
    await sleep(1000);
  }
  return null;
}

// ---------------------------------------------------------------- main

async function main() {
  say('');
  say('P9-R3 — Lead Intake dedup-read outage: isolated diagnosis');
  say('='.repeat(78));
  say('');
  say('Question: on a Pipeline dedup READ failure, does the success branch reach');
  say('          ' + WRITE_NODE + ' — a write — while the error branch answers CRM unavailable?');
  say('');

  // ---------------- preflight ----------------
  say('PREFLIGHT');
  const tracked = JSON.parse(readFileSync(SRC_PATH, 'utf8'));
  const live = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
  ok('live Lead Intake fetched: ' + live.name + '  (' + live.nodes.length + ' nodes, active=' + live.active + ')');

  const diffs = compareGraphs(live, tracked);
  if (diffs.length) {
    diffs.forEach((d) => bad(d));
    die('the LIVE Lead Intake does not match the tracked export. A harness mirroring a stale graph proves nothing.');
  }
  ok('live graph is a field-level match for the tracked export (0 differences)');

  const liveDedup = live.nodes.find((n) => n.name === DEDUP_NODE);
  if (!liveDedup) { die('the live graph has no node named ' + DEDUP_NODE); }
  if (liveDedup.alwaysOutputData !== true || liveDedup.onError !== 'continueErrorOutput') {
    die('the live ' + DEDUP_NODE + ' no longer carries alwaysOutputData + continueErrorOutput. The finding is moot; this run would be theatre.');
  }
  ok('the defect under test is present in PRODUCTION: ' + DEDUP_NODE + ' has alwaysOutputData + continueErrorOutput');

  const allow = divergenceAllowlist(tracked);
  const h1 = buildHarness(tracked, 'h1');
  const h2 = buildHarness(tracked, 'h2');
  for (const [v, wf] of [['h1', h1], ['h2', h2]]) {
    const r = verifyHarness(tracked, wf, v);
    if (!r.ok) { r.failures.forEach((x) => bad(x)); die(v.toUpperCase() + ' failed its own gate.'); }
  }
  ok('both harnesses rebuilt from the tracked export and re-verified');
  ok(allow.length + ' declared divergences, ' + (tracked.nodes.length - allow.length) + ' nodes byte-identical, connection map identical');

  if (!RUN) {
    say('');
    say('Preflight only. Nothing was deployed. Re-run with --run to drive the harness.');
    return;
  }
  if (!WRITE_KEY) { die('N8N_FIX_API_KEY is not set; refusing to deploy.'); }

  const results = {};
  try {
    // ---------------- disposable credential (H2) ----------------
    say('');
    say('DEPLOY');
    const cred = await api('POST', '/credentials', {
      name: 'P9-R3 dead sheets (disposable)',
      type: 'googleSheetsOAuth2Api',
      data: {
        clientId: 'p9r3-' + crypto.randomBytes(16).toString('hex') + '.apps.googleusercontent.invalid',
        clientSecret: crypto.randomBytes(24).toString('base64url')
      }
    }, true);
    credentialId = cred.id;
    ok('disposable Sheets credential created (no token, cannot authenticate): ' + credentialId);

    // ---------------- deploy ----------------
    for (const [key, wf, name] of [['h1', h1, H1_NAME], ['h2', h2, H2_NAME]]) {
      const payload = JSON.parse(
        JSON.stringify(wf)
          .split(CREDENTIAL_PLACEHOLDER).join(credentialId)
          .split(DOCUMENT_PLACEHOLDER).join('p9r3-nonexistent-' + crypto.randomBytes(8).toString('hex'))
      );
      const made = await api('POST', '/workflows', payload, true);
      created[key] = made.id;
      await api('POST', '/workflows/' + made.id + '/activate', null, true);
      ok(key.toUpperCase() + ' deployed and activated: ' + made.id + '  (' + name + ')');
    }

    // ---------------- drive H1 ----------------
    say('');
    say('H1 — credential-free stand-in read');
    say('-'.repeat(78));
    for (const mode of ['none', 'dup', 'new', 'down']) {
      const r = await shot(H1_PATH, mode);
      const exec = await executionForNonce(created.h1, r.nonce);
      if (!exec) { bad('mode ' + mode + ': no execution matched the nonce; cannot read runData'); continue; }
      const rd = runDataOf(exec);
      results['h1:' + mode] = {
        http: r.status,
        response: r.body,
        execStatus: exec.status,
        dedupOutputs: outputsOf(rd, DEDUP_NODE),
        guardRan: ranNode(rd, GUARD_NODE),
        guardVerdict: (() => { const j = firstJson(rd, GUARD_NODE, 0); return j ? { dedup_mode: j.dedup_mode, dedup_match_by: j.dedup_match_by, dedup_tier: j.dedup_tier, existing_lead_id: j.existing_lead_id } : null; })(),
        buildRowRan: ranNode(rd, BUILD_ROW_NODE),
        writeRan: ranNode(rd, WRITE_NODE),
        writeReached: !!(firstJson(rd, WRITE_NODE, 0) || {}).__harness_write_reached,
        infraRan: ranNode(rd, 'IF Internal (Infra)'),
        respondInfraRan: ranNode(rd, 'Respond Infra Failed'),
        mergeRan: ranNode(rd, 'Build Merge Update'),
        responders: respondersOf(rd),
        nodesRun: Object.keys(rd).length
      };
      const x = results['h1:' + mode];
      say('  mode=' + mode.padEnd(5) + ' HTTP ' + x.http + '  exec=' + x.execStatus +
        '  dedupOutputs=' + JSON.stringify(x.dedupOutputs) +
        '  guard=' + (x.guardVerdict ? x.guardVerdict.dedup_mode : 'DID NOT RUN') +
        '  buildRow=' + (x.buildRowRan ? 'RAN' : 'no') +
        '  WRITE=' + (x.writeReached ? 'REACHED' : 'not reached') +
        '  errorBranch=' + (x.infraRan ? 'ran' : 'no'));
      say('           responders=' + JSON.stringify(x.responders) + '  caller got: ' + JSON.stringify(x.response));
    }

    // ---------------- drive H2 ----------------
    say('');
    say('H2 — the REAL Google Sheets node against a credential that cannot authenticate');
    say('-'.repeat(78));
    {
      const r = await shot(H2_PATH, 'down');
      const exec = await executionForNonce(created.h2, r.nonce);
      if (!exec) { bad('H2: no execution matched the nonce; cannot read runData'); }
      else {
        const rd = runDataOf(exec);
        results['h2:real'] = {
          http: r.status,
          response: r.body,
          execStatus: exec.status,
          dedupOutputs: outputsOf(rd, DEDUP_NODE),
          guardRan: ranNode(rd, GUARD_NODE),
          guardVerdict: (() => { const j = firstJson(rd, GUARD_NODE, 0); return j ? { dedup_mode: j.dedup_mode } : null; })(),
          buildRowRan: ranNode(rd, BUILD_ROW_NODE),
          writeRan: ranNode(rd, WRITE_NODE),
          writeReached: !!(firstJson(rd, WRITE_NODE, 0) || {}).__harness_write_reached,
          infraRan: ranNode(rd, 'IF Internal (Infra)'),
          respondInfraRan: ranNode(rd, 'Respond Infra Failed'),
          responders: respondersOf(rd),
        nodesRun: Object.keys(rd).length
        };
        const x = results['h2:real'];
        say('  real Sheets node  HTTP ' + x.http + '  exec=' + x.execStatus +
          '  dedupOutputs=' + JSON.stringify(x.dedupOutputs) +
          '  guard=' + (x.guardVerdict ? x.guardVerdict.dedup_mode : 'DID NOT RUN') +
          '  buildRow=' + (x.buildRowRan ? 'RAN' : 'no') +
          '  WRITE=' + (x.writeReached ? 'REACHED' : 'not reached') +
          '  errorBranch=' + (x.infraRan ? 'ran' : 'no'));
        say('           responders=' + JSON.stringify(x.responders) + '  caller got: ' + JSON.stringify(x.response));
      }
    }

    // ---------------- verdict ----------------
    say('');
    say('VERDICT');
    say('='.repeat(78));
    verdict(results);
  } finally {
    say('');
    say('TEARDOWN');
    let leaked = [];
    for (const [key, id] of Object.entries(created)) {
      try {
        try { await api('POST', '/workflows/' + id + '/deactivate', null, true); } catch (e) { /* may already be off */ }
        // n8n answers DELETE with 409 "still being unpublished" for a few seconds after a
        // webhook workflow is deactivated. A single DELETE therefore leaks a live harness.
        let gone = false;
        for (let i = 0; i < 8; i++) {
          try { await api('DELETE', '/workflows/' + id, null, true); gone = true; break; }
          catch (e) { await sleep(1500); }
        }
        if (gone) { ok(key.toUpperCase() + ' deleted: ' + id); } else { leaked.push(key.toUpperCase() + ' workflow ' + id); }
      } catch (e) { leaked.push(key.toUpperCase() + ' workflow ' + id); }
    }
    if (credentialId) {
      try { await api('DELETE', '/credentials/' + credentialId, null, true); ok('disposable credential deleted: ' + credentialId); }
      catch (e) { leaked.push('credential ' + credentialId); }
    }
    // Prove they are gone rather than assuming the DELETE meant it.
    for (const [key, id] of Object.entries(created)) {
      try { await api('GET', '/workflows/' + id); leaked.push(key.toUpperCase() + ' workflow ' + id + ' (still readable)'); }
      catch (e) { /* expected: 404 */ }
    }
    if (leaked.length) {
      console.error('');
      console.error('*** TEARDOWN INCOMPLETE. REMOVE BY HAND: ***');
      leaked.forEach((x) => console.error('    ' + x));
      process.exitCode = 1;
    } else {
      ok('nothing left behind');
    }
  }
}

function verdict(r) {
  const down = r['h1:down'], none = r['h1:none'], dup = r['h1:dup'], nw = r['h1:new'], real = r['h2:real'];
  const f = [];

  // Controls first. Without them a harness that fails everything looks like a pass.
  if (!dup || dup.buildRowRan || dup.writeReached) { f.push('CONTROL FAILED: a genuine duplicate reached the write path'); }
  else { ok('control: a genuine duplicate MERGED and did not write'); }
  if (!nw || !nw.buildRowRan || !nw.writeReached) { f.push('CONTROL FAILED: a genuine new lead did NOT reach the write path'); }
  else { ok('control: a genuine new lead reached the write path, so this harness can detect a write'); }

  if (f.length) {
    f.forEach((x) => bad(x));
    say('');
    say('The controls did not hold, so nothing below can be trusted. NO VERDICT.');
    return;
  }

  // The finding.
  if (!down) { bad('no result for the outage shot'); return; }
  const bothOutputs = Array.isArray(down.dedupOutputs) && down.dedupOutputs.length === 2 && down.dedupOutputs[0] >= 1 && down.dedupOutputs[1] >= 1;
  if (bothOutputs) { ok('outage: the dedup read fired BOTH outputs — ' + JSON.stringify(down.dedupOutputs) + ' (the alwaysOutputData signature)'); }
  else { bad('outage: the dedup read did NOT fire both outputs — ' + JSON.stringify(down.dedupOutputs)); }

  if (down.writeReached) { bad('outage: the success branch REACHED ' + WRITE_NODE + ' — the finding is CONFIRMED'); }
  else { ok('outage: the success branch did NOT reach ' + WRITE_NODE); }

  if (down.infraRan) { ok('outage: the error branch also ran (IF Internal (Infra))'); }
  else { bad('outage: the error branch did NOT run'); }

  // What the caller was actually TOLD. The finding predicted the short error branch would very
  // probably win this race — "IF Internal (Infra) -> Respond Infra Failed is two nodes" against
  // six on the success side — and treated that as a partial mask. It is worth grading rather
  // than assuming, because whichever Respond to Webhook runs FIRST commits the response and the
  // other becomes a no-op.
  if (Array.isArray(down.responders) && down.responders.length > 1) {
    bad('outage: MORE THAN ONE respond node fired — ' + JSON.stringify(down.responders) + '; the first one committed the response');
  }
  if (down.response && down.response.ok === true) {
    bad('outage: the caller was told SUCCESS, not CRM unavailable — ' + JSON.stringify(down.response));
  } else {
    ok('outage: the caller was told the CRM was unavailable');
  }

  // The heart of it: is an outage distinguishable from a legitimately empty read?
  if (none && down.guardVerdict && none.guardVerdict) {
    const same = JSON.stringify(down.guardVerdict) === JSON.stringify(none.guardVerdict);
    if (same) { bad('AMBIGUITY: ' + GUARD_NODE + ' emitted an IDENTICAL verdict for an OUTAGE and for a legitimately EMPTY read — ' + JSON.stringify(down.guardVerdict)); }
    else { ok(GUARD_NODE + ' distinguished the outage from an empty read'); }
  }

  // H2 confirms the stand-in was not the reason.
  if (real) {
    const same = JSON.stringify(real.dedupOutputs) === JSON.stringify(down.dedupOutputs) &&
      real.writeReached === down.writeReached;
    if (same) { ok('H2: the REAL Google Sheets node behaved identically to the stand-in, so the Code node was not the cause'); }
    else { bad('H2: the REAL Sheets node behaved DIFFERENTLY from the stand-in — outputs ' + JSON.stringify(real.dedupOutputs) + ', write ' + (real.writeReached ? 'REACHED' : 'not reached')); }
  }

  say('');
  if (down.writeReached) {
    say('FINDING CONFIRMED. A dedup-read outage travels the success branch as a NEW lead and');
    say('reaches ' + WRITE_NODE + '. In production that node is a Google Sheets append: a read');
    say('outage could create the duplicate the read exists to prevent.');
    if (down.response && down.response.ok === true) {
      say('');
      say('AND WORSE THAN THE FINDING PREDICTED. Both respond nodes fired and the SUCCESS one won:');
      say('the caller is told ok:true with a fresh lead_id, not that the CRM was unavailable. The');
      say('finding treated the short error branch winning that race as a partial mask. It does not');
      say('win it. So an outage is invisible from the caller\'s side as well as from the sheet\'s.');
    }
  } else {
    say('FINDING NOT CONFIRMED on this path. See the per-node results above before concluding.');
  }
}

main().catch((e) => { console.error('\nERROR: ' + e.message); process.exit(1); });
