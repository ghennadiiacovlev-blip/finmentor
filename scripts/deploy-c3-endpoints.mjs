#!/usr/bin/env node
// FINMENTOR — C3: deploy the Session and Submit endpoint candidates onto the LIVE endpoints.
//
//   node scripts/deploy-c3-endpoints.mjs --dry-run                 prove, write nothing
//   node scripts/deploy-c3-endpoints.mjs --confirm                 PUT (OWNER_ONLY), read back
//   node scripts/deploy-c3-endpoints.mjs --confirm --release=CUSTOMER
//                                                                  the ONE explicit customer release
//
// WHAT CHANGES (C3, see docs/C3_CODEX_CORRECTION_REVIEW.md):
//   Session : unreadable session store -> 503 SESSION_STORE_UNAVAILABLE (never 401); Save Draft's
//             error output -> 503; Read Back Draft + Verify Draft Persistence before 200; a session
//             id in the query string is BAD_REQUEST; release-mode gate (OWNER_ONLY | CUSTOMER).
//   Submit  : same store/outage rules; Mark Submitted's error output -> 503 (retryable); Read Back
//             Submitted + Verify Submitted Persistence before 200; release-mode gate.
//
// WHAT IT REFUSES. A live endpoint whose webhook route, method, response mode or settings differ
// from the candidate; a placeholder reaching the tenant; a literal identity reaching the repo;
// the customer release without --release=CUSTOMER spelled out; and any state the post-write
// read-back does not reproduce.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back to N8N_API_KEY). Never printed.
// The owner id is read from the live Concierge and withheld from the log.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { resolveEndpoint, verifyEndpoint } from './build-premium-endpoints.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

export const SESSION_ID = 'Hxje3Kel6nLLod5B';
export const SUBMIT_ID = 'ELiPdw4mdxQbBaan';
export const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
export const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
export const PRIVACY_CRED_ID = 'Jsfozg8CsclIdCRo';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const RELEASE = (args.find((a) => a.startsWith('--release=')) || '--release=OWNER_ONLY').slice('--release='.length);
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;

let OWNER_ID = '';
const redact = (s) => (OWNER_ID ? String(s).split(OWNER_ID).join('«owner-id»') : String(s));
const say = (m) => console.log(redact(m));
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error(redact('\nSTOPPED: ' + m)); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });
const body = (w) => JSON.stringify(importable(w), null, 2) + '\n';

async function api(m, p, b, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + p, { method: m,
        headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
        body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + redact(t).slice(0, 300)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}

export const SYSTEM_ALERT_ID = 'ID700kTo6EXffwry';

// The live-only SYSTEM ALERT callers (deployed by scripts/deploy-system-alert.mjs, tracked as
// n8n/candidate/system-alert-caller-miniapp-*.json). The endpoint builder does not model them,
// so the merge keeps them byte-identical, keeps every edge INTO them, and attaches the new
// "the store did not prove the commit" responder to the submit route so a persistence failure
// alerts like any other unresolved submission.
export const LIVE_ONLY = {
  session: { nodes: ['Emit System Alert (Session)'], extraEdges: {} },
  submit: { nodes: ['Alert Route (Submit)', 'Emit System Alert (Submit)'], extraEdges: { 'Respond Submit Persistence Failure': 'Alert Route (Submit)' } }
};

// A persistence failure reaches the alert route with Mark Submitted's ERROR item (no error_code)
// or Verify Submitted Persistence's verdict; the live route would label both "Parse Intake
// Result / SUBMIT_UNRESOLVED". This declared rewrite names them. Everything else is verbatim.
export const ALERT_ROUTE_PERSISTENCE_SPLICE = [
  'if (v.receipt_reason !== undefined) { verdict_node = "Receipt Verdict"; }',
  'if (v.receipt_reason !== undefined) { verdict_node = "Receipt Verdict"; }\n' +
  '// [C3] the persistence branch: Mark Submitted\'s error item, or the read-back verdict.\n' +
  'else if (v.__response && String(v.__response.error_code || "") === "SUBMIT_PERSISTENCE_UNCONFIRMED") { verdict_node = "Verify Submitted Persistence"; }\n' +
  'else if (v.__response && String(v.__response.error_code || "") === "SUBMIT_STORE_UNAVAILABLE") { verdict_node = "Read Back Submitted"; }\n' +
  'else if (code === "" && (v.error !== undefined || v.errorMessage !== undefined)) { verdict_node = "Mark Submitted"; }'
];

export function mergeLiveOnly(live, cand, kind) {
  const spec = LIVE_ONLY[kind];
  const candNames = new Set(cand.nodes.map((n) => n.name));
  const out = JSON.parse(JSON.stringify(cand));
  const f = [];
  for (const name of spec.nodes) {
    const l = live.nodes.find((n) => n.name === name);
    if (!l) { f.push('live-only node missing on the tenant: ' + name); continue; }
    if (candNames.has(name)) { f.push('the candidate models a live-only node: ' + name); continue; }
    const n = JSON.parse(JSON.stringify(l));
    if (name === 'Alert Route (Submit)') {
      const [anchor, replacement] = ALERT_ROUTE_PERSISTENCE_SPLICE;
      const code = String(n.parameters.jsCode || '');
      if (code.split(anchor).length !== 2) { f.push('Alert Route (Submit) anchor not found exactly once'); }
      else if (code.indexOf('Verify Submitted Persistence') === -1) { n.parameters.jsCode = code.replace(anchor, replacement); }
    }
    if (n.type === 'n8n-nodes-base.executeWorkflow' && String(((n.parameters || {}).workflowId || {}).value || '') !== SYSTEM_ALERT_ID) { f.push(name + ' calls a workflow other than SYSTEM ALERT'); }
    out.nodes.push(n);
  }
  // every live edge INTO a live-only node is kept, at the same output index
  for (const [src, c] of Object.entries(live.connections || {})) {
    (c.main || []).forEach((branch, i) => {
      for (const e of branch || []) {
        if (spec.nodes.indexOf(e.node) === -1) { continue; }
        if (!out.nodes.some((n) => n.name === src)) { f.push('live edge from a node the candidate dropped: ' + src + ' -> ' + e.node); continue; }
        out.connections[src] = out.connections[src] || { main: [] };
        while (out.connections[src].main.length <= i) { out.connections[src].main.push([]); }
        if (!out.connections[src].main[i].some((x) => x.node === e.node)) { out.connections[src].main[i].push({ node: e.node, type: 'main', index: e.index || 0 }); }
      }
    });
  }
  for (const [src, dst] of Object.entries(spec.extraEdges)) {
    if (!out.nodes.some((n) => n.name === src)) { f.push('extra edge source missing: ' + src); continue; }
    out.connections[src] = out.connections[src] || { main: [[]] };
    if (!out.connections[src].main[0].some((x) => x.node === dst)) { out.connections[src].main[0].push({ node: dst, type: 'main', index: 0 }); }
  }
  return { merged: out, failures: f };
}

// Pure: the candidate as it will be sent, given the live workflow (webhook id carried, name kept,
// live-only alert callers merged).
export function prepareEndpoint(live, candidateRaw, kind, opts) {
  const resolved = resolveEndpoint(candidateRaw, { ownerId: opts.ownerId, releaseMode: opts.releaseMode, leadIntakeId: LEAD_INTAKE_ID, privacyCredId: PRIVACY_CRED_ID });
  const { merged: cand, failures: f } = mergeLiveOnly(live, resolved, kind);
  const liveHook = live.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const candHook = cand.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (!liveHook || !candHook) { f.push('no webhook node'); }
  else {
    if (JSON.stringify(liveHook.parameters) !== JSON.stringify(candHook.parameters)) { f.push('the ' + kind + ' webhook route changed'); }
    if (liveHook.webhookId) { candHook.webhookId = liveHook.webhookId; }
  }
  cand.name = live.name;
  if (JSON.stringify(cand.settings || {}) !== JSON.stringify(live.settings || {})) { f.push(kind + ' settings differ from live'); }
  const j = JSON.stringify(cand);
  if (/__[A-Z_]{4,}__/.test(j)) { f.push('an unresolved placeholder would reach the tenant'); }
  if (j.indexOf('NOT_AUTHORISED') === -1) { f.push('the release gate is gone'); }
  if (opts.releaseMode === 'CUSTOMER' ? j.indexOf('"OWNER_ONLY"') !== -1 : j.indexOf('"CUSTOMER"') !== -1) { f.push('the release mode did not resolve to ' + opts.releaseMode); }
  if (kind === 'session' && j.indexOf('lead_id') !== -1) { f.push('the draft endpoint mentions a lead'); }
  return { cand, failures: f };
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c3-endpoints.mjs');
if (isMain) {
  if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
  if (!DRY && !CONFIRM) { die('this rewrites two live workflows; re-run with --confirm (or --dry-run first)'); }
  if (RELEASE !== 'OWNER_ONLY' && RELEASE !== 'CUSTOMER') { die('--release must be OWNER_ONLY or CUSTOMER'); }
  mkdirSync(OUT_DIR, { recursive: true });

  say('');
  say('C3 — Session + Submit endpoints: store outages, proven persistence, release gate');
  say('='.repeat(78));
  say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
  say('  RELEASE: ' + RELEASE);
  say('');

  // the owner identity, from the live Concierge (withheld from the log)
  const c = await api('GET', '/workflows/' + CONCIERGE_ID);
  const st = c.nodes.find((n) => n.name === 'Settings to Object');
  const m = String((st && st.parameters.jsCode) || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  if (!m) { die('could not read owner_chat_id from the live Concierge'); }
  OWNER_ID = m[1];
  ok('owner identity resolved from the live Concierge (value withheld)');

  const plan = [];
  for (const [id, kind, file] of [[SESSION_ID, 'session', 'premium-session-endpoint-candidate.json'], [SUBMIT_ID, 'submit', 'premium-submit-endpoint-candidate.json']]) {
    const live = await api('GET', '/workflows/' + id);
    const rollback = join(OUT_DIR, id + '.pre-c3-endpoints.json');
    writeFileSync(rollback, body(live), 'utf8');
    ok(kind + ': rollback artifact ' + rollback.replace(ROOT, '.') + ' (' + live.nodes.length + ' nodes, active=' + live.active + ', sha ' + sha(body(live)).slice(0, 12) + ')');
    const raw = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', file), 'utf8'));
    const v = verifyEndpoint(raw, kind);
    if (!v.ok) { die(kind + ' tracked candidate fails its own gate: ' + v.failures.join(' | ')); }
    const { cand, failures } = prepareEndpoint(live, raw, kind, { ownerId: OWNER_ID, releaseMode: RELEASE });
    if (failures.length) { die(kind + ': ' + failures.join(' | ')); }
    const liveNames = live.nodes.map((n) => n.name);
    const candNames = cand.nodes.map((n) => n.name);
    say('  ' + kind + ': nodes ' + live.nodes.length + ' -> ' + cand.nodes.length + '; added: ' + (candNames.filter((n) => liveNames.indexOf(n) === -1).join(', ') || '—') + '; removed: ' + (liveNames.filter((n) => candNames.indexOf(n) === -1).join(', ') || '—'));
    const norm = (n) => JSON.stringify({ p: n.parameters, t: n.type, v: n.typeVersion, a: n.alwaysOutputData === true, e: n.onError || null });
    const rewritten = cand.nodes.filter((n) => { const l = live.nodes.find((x) => x.name === n.name); return l && norm(l) !== norm(n); }).map((n) => n.name);
    say('  ' + kind + ': rewritten: ' + (rewritten.join(', ') || '—'));
    writeFileSync(join(OUT_DIR, id + '.c3-endpoints-candidate.json'), body(cand), 'utf8');
    plan.push({ id, kind, cand });
  }

  if (DRY) { say('\nDRY RUN — nothing written.'); process.exit(0); }

  for (const { id, kind, cand } of plan) {
    await api('PUT', '/workflows/' + id, importable(cand), 3);
    const after = await api('GET', '/workflows/' + id);
    const drop = (w) => JSON.stringify(importable(w).nodes.map((n) => { const x = Object.assign({}, n); delete x.webhookId; delete x.position; delete x.id; return x; }));
    if (drop(after) !== drop(cand)) { bad(kind + ': the deployed workflow does not match what was sent — roll back from ' + id + '.pre-c3-endpoints.json'); }
    else { ok(kind + ': written and read back (' + after.nodes.length + ' nodes, active ' + after.active + ')'); }
    if (!after.active) { bad(kind + ' is NOT active'); }
    writeFileSync(join(OUT_DIR, id + '.deployed-c3-endpoints.json'), body(after), 'utf8');
  }
  say('');
  say('  rollback: PUT /api/v1/workflows/<id> with .uat/<id>.pre-c3-endpoints.json');
  say('');
}
