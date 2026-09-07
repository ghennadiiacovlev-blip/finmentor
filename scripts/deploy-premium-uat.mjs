#!/usr/bin/env node
// FINMENTOR — OWNER-ONLY RU UAT deployment.
//
//   node scripts/deploy-premium-uat.mjs --dry-run
//   node scripts/deploy-premium-uat.mjs --confirm
//
// LIVE. It deploys the six approved Premium UX artifacts to owner-only surfaces.
//
// ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────────────────────────
//
//   · it does not merge, push, or touch www.finmentor.md;
//   · it does not touch the Gateway. The 72 h TTL was authorised and deployed SEPARATELY by
//     scripts/deploy-gateway-ttl.mjs, which patched one literal in one node and left the other
//     twelve byte-identical. Nothing here re-deploys it.
//   · it does not expose a customer entry point: the Concierge change is ADDITIVE and non-owners
//     reach the same node they reach today;
//   · it does not write a resolved value into any tracked file.
//
// ── IT STOPS ON DRIFT ──────────────────────────────────────────────────────────────────────────
//
// Both live workflows are re-fetched NOW and compared against the rollback artifacts the candidates
// were built from. If either has changed since, the candidate is stale and this refuses to deploy
// it — a candidate built against yesterday's workflow is a candidate that silently reverts whatever
// happened in between.
//
// ── ORDER MATTERS ──────────────────────────────────────────────────────────────────────────────
//
// The Mini App host is deployed FIRST because the Concierge needs its URL; the endpoints before the
// Mini App is pointed at them; the Concierge LAST, because it is the only artifact that changes
// what a person sees. If anything before it fails, the Concierge is never touched and no human is
// affected at all.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const PRIVACY_CRED = { id: 'Jsfozg8CsclIdCRo', name: 'FINMENTOR Privacy Audit Writer' };
const GATEWAY_PATH = 'finmentor-miniapp-gateway';

const ROLLBACK = {
  [LEAD_INTAKE_ID]: join(ROOT, 'n8n', 'history', 'QmIyEW2ZEqKregmN.pre-premium-projection.json'),
  [CONCIERGE_ID]: join(ROOT, 'n8n', 'history', 'mppzthlkSJFr6Kle.pre-premium-ux.json')
};

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
// Once the projection and the Concierge are deployed, the live workflows legitimately differ from
// the pre-deploy rollback artifacts — that is this script's own change, not unrelated drift. So a
// later endpoint-only fix would be blocked by the guard that exists to protect exactly those two
// workflows. `--endpoints-only` redeploys the Mini App host and the two endpoints and does not
// look at, or touch, either production workflow.
const ENDPOINTS_ONLY = args.includes('--endpoints-only');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

let OWNER_ID = '';
const redact = (s) => (OWNER_ID ? String(s).split(OWNER_ID).join('«owner-id»') : String(s));
const say = (m) => console.log(redact(m));
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error(redact('\nSTOPPED: ' + m)); process.exit(1); }

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
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + redact(t).slice(0, 300)); }
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
function sanitize(v) {
  if (!v || typeof v !== 'object') { return v; }
  if (Array.isArray(v)) { return v.map(sanitize); }
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; }
    out[k] = sanitize(v[k]);
  }
  return out;
}
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });

// ── preflight ──────────────────────────────────────────────────────────────────────────────────

say('');
say('OWNER-ONLY RU UAT deployment');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this modifies two production workflows; re-run with --confirm (or --dry-run first)'); }

mkdirSync(OUT_DIR, { recursive: true });

// 1. Resolve the owner identity from the instance, not from this repo. ------------------------
say('STEP 1 — resolve the owner identity from the live Concierge Settings');
const conciergeLive = await api('GET', '/workflows/' + CONCIERGE_ID);
{
  const st = conciergeLive.nodes.find((n) => n.name === 'Settings to Object');
  if (!st) { die('the live Concierge has no Settings to Object node'); }
  const m = String(st.parameters.jsCode || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  if (!m) { die('could not read the owner_chat_id default from the live Settings node'); }
  OWNER_ID = m[1];
  ok('owner identity resolved from the live workflow (value withheld from this log)');
  // The two gates cannot disagree, and that is measured rather than assumed. `Hot Path Config`
  // replaced the Google Sheets `Read Settings` round-trip (it cost a customer their /start reply
  // in production execution #3716) and deliberately does NOT emit owner_chat_id — it is one of the
  // four keys that node lists as dead. So `settings.owner_chat_id` is always undefined at runtime
  // and `Settings to Object` falls back to the compiled default, which is exactly the value read
  // here. No sheet override exists to diverge from.
  const hp = conciergeLive.nodes.find((n) => n.name === 'Hot Path Config');
  const hpCode = String((hp && hp.parameters.jsCode) || '').replace(/\/\/.*$/gm, '');
  if (/owner_chat_id/.test(hpCode)) {
    die('Hot Path Config now emits owner_chat_id — the Concierge gate would follow it while the ' +
        'endpoint gate follows the compiled default. Resolve the two before deploying.');
  }
  ok('the Concierge gate and the endpoint gate read the same value (no Settings override exists)');
}
say('');

// 2. Fresh before-hashes, and a drift check against what the candidates were built from. ------
say('STEP 2 — fresh before-hashes, and a drift check against the rollback artifacts');
const before = {};
for (const [id, label] of (ENDPOINTS_ONLY ? [] : [[LEAD_INTAKE_ID, 'Lead Intake'], [CONCIERGE_ID, 'Concierge']])) {
  const live = id === CONCIERGE_ID ? conciergeLive : await api('GET', '/workflows/' + id);
  const nodes = sanitize(JSON.parse(JSON.stringify(live.nodes)));
  before[id] = { name: live.name, nodes: nodes, connections: live.connections, active: live.active };

  const base = JSON.parse(readFileSync(ROLLBACK[id], 'utf8'));
  const driftNodes = [];
  for (const n of nodes) {
    const was = base.nodes.find((x) => x.name === n.name);
    if (!was) { driftNodes.push(n.name + ' (new since the candidate was built)'); continue; }
    if (JSON.stringify(n) !== JSON.stringify(was)) { driftNodes.push(n.name); }
  }
  for (const n of base.nodes) {
    if (!nodes.find((x) => x.name === n.name)) { driftNodes.push(n.name + ' (removed since)'); }
  }
  const edgeDrift = JSON.stringify(live.connections) !== JSON.stringify(base.connections);

  say('  ' + label + '  (' + id + ')');
  say('      nodes            : ' + nodes.length + '   active: ' + live.active);
  say('      structural sha256: ' + structural(nodes, live.connections));
  if (driftNodes.length || edgeDrift) {
    bad(label + ': the live workflow has CHANGED since the candidate was built');
    for (const d of driftNodes.slice(0, 10)) { say('        - ' + d); }
    if (edgeDrift) { say('        - the connection graph differs'); }
    die('unrelated drift — re-export the live workflow and rebuild the candidate before deploying');
  }
  ok(label + ': no unrelated drift; the candidate is built on exactly this workflow');
  writeFileSync(join(OUT_DIR, id + '.before.json'), JSON.stringify(importable(before[id]), null, 2) + '\n', 'utf8');
}
if (ENDPOINTS_ONLY) { ok('endpoints-only: the two production workflows are not read and not touched'); }
else { ok('rollback artifacts written to ' + OUT_DIR); }
say('');

// 3. Deploy the Mini App host FIRST — the Concierge needs its URL. ----------------------------
say('STEP 3 — Mini App host');
const hostCandidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json'), 'utf8'));
let hostId = null;
let MINIAPP_URL = '';
{
  const existing = await api('GET', '/workflows?limit=200');
  const found = ((existing && existing.data) || []).find((w) => w.name === hostCandidate.name);
  if (found) { hostId = found.id; say('  reusing existing host workflow ' + hostId); }
  MINIAPP_URL = BASE + '/webhook/finmentor-premium-miniapp';
}
const SESSION_URL = BASE + '/webhook/finmentor-miniapp-session';
const SUBMIT_URL = BASE + '/webhook/finmentor-miniapp-submit';
const GATEWAY_URL = BASE + '/webhook/' + GATEWAY_PATH;

// Substitute the endpoints into the hosted page.
{
  const node = hostCandidate.nodes.find((n) => n.name === 'Serve Page');
  let page = node.parameters.responseBody;
  page = page.split('__PREMIUM_GATEWAY_URL__').join(GATEWAY_URL)
             .split('__PREMIUM_SESSION_URL__').join(SESSION_URL)
             .split('__PREMIUM_SUBMIT_URL__').join(SUBMIT_URL);
  if (/__PREMIUM_[A-Z_]+__/.test(page)) { die('an endpoint placeholder survived substitution in the hosted page'); }
  node.parameters.responseBody = page;
}
say('  gateway  : ' + GATEWAY_URL + '   (LIVE, NOT redeployed here; TTL already 72 h)');
say('  session  : ' + SESSION_URL);
say('  submit   : ' + SUBMIT_URL);
say('  mini app : ' + MINIAPP_URL);
say('');

// 4. Substitute into the endpoint candidates. --------------------------------------------------
say('STEP 4 — endpoint candidates');
const endpoints = [];
for (const [file, label] of [['premium-session-endpoint-candidate.json', 'PUT /miniapp/session'],
                             ['premium-submit-endpoint-candidate.json', 'POST /miniapp/submit']]) {
  const wf = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', file), 'utf8'));
  let text = JSON.stringify(wf);
  text = text.split('__OWNER_TELEGRAM_ID__').join(OWNER_ID)
             .split('__LEAD_INTAKE_WORKFLOW_ID__').join(LEAD_INTAKE_ID)
             .split('__PRIVACY_AUDIT_CREDENTIAL_ID__').join(PRIVACY_CRED.id);
  if (/__[A-Z_]{4,}__/.test(text)) {
    die(label + ': a placeholder survived substitution — ' + (text.match(/__[A-Z_]{4,}__/g) || []).join(', '));
  }
  const resolved = JSON.parse(text);
  // The privacy credential must actually be attached, not merely named.
  const privacyNode = resolved.nodes.find((n) => n.type === 'n8n-nodes-base.postgres');
  if (privacyNode) {
    privacyNode.credentials = { postgres: PRIVACY_CRED };
    if (!/privacy\.privacy_acknowledgements/.test(JSON.stringify(privacyNode.parameters))) {
      die(label + ': the privacy node does not target the privacy schema');
    }
    if (/on conflict/i.test(JSON.stringify(privacyNode.parameters))) {
      die(label + ': the privacy insert uses ON CONFLICT, which the writer cannot execute');
    }
  }
  for (const n of resolved.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die(label + ': P9-R2 flag pair on ' + n.name); }
  }
  if (JSON.stringify(resolved).indexOf('NOT_AUTHORISED') === -1) { die(label + ': the owner gate is missing'); }
  endpoints.push({ label, wf: resolved });
  ok(label + ': placeholders resolved, owner gate present, P9-R2 pair absent');
}
say('');

// 5. Substitute the Mini App URL into the Concierge candidate. ---------------------------------
say(ENDPOINTS_ONLY ? 'STEP 5 — Concierge candidate (SKIPPED: endpoints-only)' : 'STEP 5 — Concierge candidate');
const conciergeCandidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json'), 'utf8'));
if (!ENDPOINTS_ONLY) {
  let text = JSON.stringify(conciergeCandidate);
  text = text.split('__PREMIUM_MINIAPP_URL__').join(MINIAPP_URL);
  if (/__[A-Z_]{4,}__/.test(text)) { die('a placeholder survived substitution in the Concierge'); }
  const resolved = JSON.parse(text);

  // The additive shape, verified against what is live RIGHT NOW rather than against a file.
  const liveNodes = before[CONCIERGE_ID].nodes;
  const added = ['Premium Owner Gate', 'Get Bot Session (Premium)', 'Build Bot Response (Premium)'];
  if (resolved.nodes.length !== liveNodes.length + 3) { die('the Concierge candidate is not +3 nodes over what is live'); }
  for (const n of resolved.nodes) {
    if (added.indexOf(n.name) !== -1) { continue; }
    const was = liveNodes.find((x) => x.name === n.name);
    if (!was) { die('the Concierge candidate introduces an unexpected node: ' + n.name); }
    if (JSON.stringify(n) !== JSON.stringify(was)) { die('the Concierge candidate MODIFIES a live node: ' + n.name); }
  }
  const gate = resolved.connections['Premium Owner Gate'];
  if (!gate || gate.main.length !== 2) { die('the owner gate does not have two outputs'); }
  if (gate.main[1][0].node !== 'Get Bot Session') { die('the gate FALSE branch does not lead to the legacy path'); }
  const legacySession = resolved.nodes.find((n) => n.name === 'Get Bot Session');
  if (!/if \(isStart\) reset = 'start';/.test(legacySession.parameters.jsCode)) {
    die('the LIVE session node was modified — non-owners must keep exactly today\'s behaviour');
  }
  for (const n of resolved.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
  }
  conciergeCandidate.__resolved = resolved;
  ok('additive shape verified against the LIVE workflow: +3 nodes, 0 modified, 0 removed');
  ok('the legacy path is byte-identical and keeps its /start reset');
}
say('');

// 6. Lead Intake projection, verified against live. ---------------------------------------------
say(ENDPOINTS_ONLY ? 'STEP 6 — Lead Intake projection (SKIPPED: endpoints-only)' : 'STEP 6 — Lead Intake projection candidate');
const projection = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-projection-candidate.json'), 'utf8'));
if (!ENDPOINTS_ONLY) {
  const liveNodes = before[LEAD_INTAKE_ID].nodes;
  if (projection.nodes.length !== liveNodes.length) { die('the projection candidate changes the node count'); }
  const changed = [];
  for (const n of projection.nodes) {
    const was = liveNodes.find((x) => x.name === n.name);
    if (!was) { die('the projection introduces a node: ' + n.name); }
    if (JSON.stringify(n) !== JSON.stringify(was)) { changed.push(n.name); }
  }
  if (changed.sort().join(',') !== 'Build Pipeline Row,Save to Pipeline') {
    die('the projection touches nodes it must not: ' + changed.join(', '));
  }
  const writer = projection.nodes.find((n) => n.name === 'Save to Pipeline');
  if (writer.parameters.columns.mappingMode !== 'defineBelow') { die('the Pipeline writer is no longer defineBelow (F16)'); }
  for (const n of projection.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
  }
  ok('exactly two nodes differ: Build Pipeline Row, Save to Pipeline');
  ok('the Pipeline writer is still defineBelow');
}
say('');

// ── write ──────────────────────────────────────────────────────────────────────────────────────

if (DRY) {
  say('DRY RUN — nothing was written. Everything above is a check, not a change.');
  say('');
  say('Re-run with --confirm to deploy.');
  say('');
  process.exit(0);
}

say('STEP 7 — deploying');

async function put(id, wf, label) {
  await api('PUT', '/workflows/' + id, importable(wf), 3);
  const after = await api('GET', '/workflows/' + id);
  const nodes = sanitize(JSON.parse(JSON.stringify(after.nodes)));
  ok(label + ': deployed — ' + nodes.length + ' nodes, structural ' + structural(nodes, after.connections).slice(0, 16));
  return after;
}

async function upsert(wf, label) {
  const list = await api('GET', '/workflows?limit=200');
  const found = ((list && list.data) || []).find((w) => w.name === wf.name);
  if (found) {
    await api('PUT', '/workflows/' + found.id, importable(wf), 3);
    ok(label + ': updated (' + found.id + ')');
    return found.id;
  }
  const made = await api('POST', '/workflows', importable(wf), 3);
  ok(label + ': created (' + made.id + ')');
  return made.id;
}

// Host first.
hostId = await upsert(hostCandidate, 'Mini App host');
try { await api('POST', '/workflows/' + hostId + '/activate', null, 2); ok('Mini App host activated'); }
catch (e) { bad('Mini App host activation failed: ' + e.message); }

// Endpoints next.
const endpointIds = {};
for (const e of endpoints) {
  endpointIds[e.label] = await upsert(e.wf, e.label);
  try { await api('POST', '/workflows/' + endpointIds[e.label] + '/activate', null, 2); ok(e.label + ' activated'); }
  catch (err) { bad(e.label + ' activation failed: ' + err.message); }
}

if (!ENDPOINTS_ONLY) {
  // Lead Intake projection.
  await put(LEAD_INTAKE_ID, projection, 'Lead Intake projection');

  // Concierge LAST — the only artifact that changes what a person sees.
  await put(CONCIERGE_ID, conciergeCandidate.__resolved, 'Concierge (owner-gated)');
} else {
  ok('endpoints-only: Lead Intake and the Concierge were not written');
}

say('');
say('STEP 8 — post-deploy verification');
if (!ENDPOINTS_ONLY) {
  const c = await api('GET', '/workflows/' + CONCIERGE_ID);
  const names = c.nodes.map((n) => n.name);
  for (const n of ['Premium Owner Gate', 'Get Bot Session (Premium)', 'Build Bot Response (Premium)']) {
    if (names.indexOf(n) === -1) { bad('post-deploy: ' + n + ' is missing'); } else { ok('post-deploy: ' + n + ' present'); }
  }
  if (!c.active) { bad('post-deploy: the Concierge is NOT active'); } else { ok('post-deploy: the Concierge is active'); }
  const legacy = c.nodes.find((n) => n.name === 'Get Bot Session');
  if (legacy && /if \(isStart\) reset = 'start';/.test(legacy.parameters.jsCode)) { ok('post-deploy: the legacy path is intact'); }
  else { bad('post-deploy: the legacy session node changed'); }

  const li = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
  const w = li.nodes.find((n) => n.name === 'Save to Pipeline');
  const mapped = Object.keys(w.parameters.columns.value);
  for (const col of ['current_setup', 'decision_horizon', 'important_context']) {
    if (mapped.indexOf(col) === -1) { bad('post-deploy: Pipeline column not mapped: ' + col); }
  }
  ok('post-deploy: Pipeline maps ' + mapped.length + ' columns (was ' + (mapped.length - 3) + ')');
  if (!li.active) { bad('post-deploy: Lead Intake is NOT active'); } else { ok('post-deploy: Lead Intake is active'); }
}

say('');
say('DEPLOYED. Rollback artifacts: ' + OUT_DIR);
say('  Lead Intake : PUT /api/v1/workflows/' + LEAD_INTAKE_ID + '  with ' + LEAD_INTAKE_ID + '.before.json');
say('  Concierge   : PUT /api/v1/workflows/' + CONCIERGE_ID + '  with ' + CONCIERGE_ID + '.before.json');
say('  Mini App    : DELETE /api/v1/workflows/' + hostId);
for (const k of Object.keys(endpointIds)) { say('  ' + k + ' : DELETE /api/v1/workflows/' + endpointIds[k]); }
say('');
say('Mini App URL: ' + MINIAPP_URL);
say('');
