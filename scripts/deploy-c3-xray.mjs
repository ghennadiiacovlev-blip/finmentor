#!/usr/bin/env node
// FINMENTOR — C3: deploy the X-Ray Analysis v2 candidate onto the LIVE X-Ray workflow.
//
//   node scripts/deploy-c3-xray.mjs --dry-run       compile, compare with live, write nothing
//   node scripts/deploy-c3-xray.mjs --confirm       PUT, fresh-read, verify
//
// WHAT CHANGES (see docs/C3_CODEX_CORRECTION_REVIEW.md, C1 section):
//   sweep  : Validate + Store Rows is fail-closed (a broken model contract is ANALYSIS_FAILED),
//            IF Analysis Valid forks to the owner alert or the validation failure notice.
//   review : the one-tap GET promotion is retired. GET renders a read-only page with a confirmation
//            form; POST promotes (bounded 32-byte token), projects to Pipeline, and publishes the
//            curated customer result to the Data Table XRay_Client_Results.
//
// The candidate is the tracked SDK source (n8n/candidate/xray-analysis-workflow.sdk.js, built from
// n8n/src/xray-analysis/*), compiled offline by scripts/lib/compile-workflow-sdk.mjs. Node ids,
// the GET webhook id and the workflow settings (error workflow, timezone) are carried from live.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { keepRollback } from './lib/rollback-artifact.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compileFile } from './lib/compile-workflow-sdk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
export const XRAY_ID = 'tNSMRoKlFB52vjge';
export const XRAY_NAME = 'FINMENTOR X-Ray Analysis';
export const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js');
// The live GET webhook was named 'Review Webhook' by C1; the candidate names it by method.
export const RENAMED = { 'Review Webhook': 'Review GET Webhook', 'Read Analysis For Review': 'Read Analysis For Review GET', 'Review Verdict': 'Review POST Verdict' };

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

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

// Pure: the candidate as it will be sent, given the live workflow.
export function prepareXray(live) {
  const liveBy = Object.fromEntries(live.nodes.map((n) => [n.name, n]));
  const ids = {}; const webhookIds = {};
  for (const [oldName, newName] of Object.entries(RENAMED)) { if (liveBy[oldName]) { ids[newName] = liveBy[oldName].id; if (liveBy[oldName].webhookId) { webhookIds[newName] = liveBy[oldName].webhookId; } } }
  for (const n of live.nodes) { if (!RENAMED[n.name]) { ids[n.name] = n.id; if (n.webhookId) { webhookIds[n.name] = n.webhookId; } } }
  const cand = compileFile(CANDIDATE, { ids, webhookIds, settings: live.settings || {} });
  cand.name = live.name;
  // keep live positions for nodes that already exist, so the canvas does not jump
  for (const n of cand.nodes) { const l = liveBy[n.name] || liveBy[Object.keys(RENAMED).find((k) => RENAMED[k] === n.name) || '']; if (l && l.position) { n.position = l.position; } }
  const f = [];
  if (cand.nodes.some((n) => n.type === 'n8n-nodes-base.postgres')) { f.push('a Postgres node in the X-Ray candidate'); }
  if (!cand.nodes.some((n) => n.name === 'Publish Curated Client Result' && n.type === 'n8n-nodes-base.dataTable')) { f.push('no client-result publisher'); }
  const get = cand.nodes.find((n) => n.name === 'Review GET Webhook'); const post = cand.nodes.find((n) => n.name === 'Review POST Webhook');
  if (!get || !post || get.parameters.path !== post.parameters.path || get.parameters.httpMethod !== 'GET' || post.parameters.httpMethod !== 'POST') { f.push('the review GET/POST pair is not on one path'); }
  const getChain = new Set(); const walk = (n) => { for (const b of ((cand.connections[n] || {}).main || [])) { for (const e of b) { if (!getChain.has(e.node)) { getChain.add(e.node); walk(e.node); } } } }; walk('Review GET Webhook');
  for (const n of getChain) { const t = cand.nodes.find((x) => x.name === n); if (t && (t.type === 'n8n-nodes-base.dataTable' || (t.type === 'n8n-nodes-base.googleSheets' && t.parameters.operation !== 'read'))) { f.push('the GET chain reaches a writer: ' + n); } }
  return { cand, failures: f };
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c3-xray.mjs');
if (isMain) {
  try {
    if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
    if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm (or --dry-run first)'); }
    mkdirSync(OUT_DIR, { recursive: true });
    say(''); say('C3 — X-Ray Analysis v2: fail-closed validation, GET/POST review, customer result publisher'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE'); say('');
    const live = await api('GET', '/workflows/' + XRAY_ID);
    if (live.name !== XRAY_NAME) { die('live workflow is not the X-Ray Analysis: ' + live.name); }
    const rb = keepRollback(join(OUT_DIR, XRAY_ID + '.pre-c3-xray.json'), JSON.stringify(importable(live), null, 2) + '\n');
    if (rb.aside) { ok('rollback artifact KEPT (live differs from it); fresh read saved to ' + rb.aside.replace(ROOT, '.')); }
    else { ok('rollback artifact: .uat/' + XRAY_ID + '.pre-c3-xray.json (' + live.nodes.length + ' nodes, active=' + live.active + ')' + (rb.written ? '' : ' — unchanged')); }
    const { cand, failures } = prepareXray(live);
    if (failures.length) { die(failures.join(' | ')); }
    const liveNames = live.nodes.map((n) => n.name); const candNames = cand.nodes.map((n) => n.name);
    say('  nodes ' + live.nodes.length + ' -> ' + cand.nodes.length);
    say('  added   : ' + candNames.filter((n) => liveNames.indexOf(n) === -1).join(', '));
    say('  removed : ' + liveNames.filter((n) => candNames.indexOf(n) === -1).join(', '));
    const norm = (n) => JSON.stringify({ p: n.parameters, t: n.type, v: n.typeVersion, a: n.alwaysOutputData === true, e: n.onError || null, r: n.retryOnFail === true, c: n.credentials || null }).split('\\r\\n').join('\\n').split('\\r').join('');
    const rewritten = cand.nodes.filter((n) => { const l = live.nodes.find((x) => x.name === n.name); return l && norm(l) !== norm(n); }).map((n) => n.name);
    say('  rewritten: ' + (rewritten.join(', ') || '—'));
    const unchanged = cand.nodes.filter((n) => { const l = live.nodes.find((x) => x.name === n.name); return l && norm(l) === norm(n); }).length;
    ok(unchanged + ' live nodes are reproduced byte-for-byte by the offline compiler (calibration)');
    if (JSON.stringify(cand.settings) !== JSON.stringify(live.settings || {})) { die('settings differ'); }
    writeFileSync(join(OUT_DIR, XRAY_ID + '.c3-xray-candidate.json'), JSON.stringify(importable(cand), null, 2) + '\n', 'utf8');
    if (DRY) { say('\nDRY RUN — nothing written. Candidate saved to .uat/' + XRAY_ID + '.c3-xray-candidate.json'); }
    else {
      await api('PUT', '/workflows/' + XRAY_ID, importable(cand), 3);
      ok('X-Ray updated');
      const after = await api('GET', '/workflows/' + XRAY_ID);
      const missing = candNames.filter((n) => !after.nodes.some((x) => x.name === n));
      if (missing.length) { bad('missing after deploy: ' + missing.join(', ')); } else { ok('fresh read: every candidate node present (' + after.nodes.length + ' nodes)'); }
      if (!after.active) { bad('the X-Ray workflow is NOT active'); } else { ok('active'); }
      const v2 = after.nodes.find((n) => n.name === 'Validate + Store Rows');
      if (!v2 || v2.parameters.jsCode.indexOf("ANALYSIS_VERSION = 'xray-v2'") === -1) { bad('the live validator is not v2'); } else { ok('live validator is xray-v2'); }
      writeFileSync(join(OUT_DIR, XRAY_ID + '.deployed-c3-xray.json'), JSON.stringify(importable(after), null, 2) + '\n', 'utf8');
      say('\n  rollback: PUT /api/v1/workflows/' + XRAY_ID + ' with .uat/' + XRAY_ID + '.pre-c3-xray.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
