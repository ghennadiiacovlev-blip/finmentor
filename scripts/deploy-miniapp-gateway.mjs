#!/usr/bin/env node
// FINMENTOR — P9-R2 STEP 1: deploy the Mini App Gateway candidate to the live workflow.
//
//   node scripts/deploy-miniapp-gateway.mjs              dry run: prove the diff, change nothing
//   node scripts/deploy-miniapp-gateway.mjs --deploy     PUT, then prove the result
//
// WHY THIS EXISTS. P9-R1 was redeployed by hand and the evidence for "exactly three fields
// changed" was assembled afterwards. This makes the diff the GATE rather than the write-up: the
// script states the changes it intends BEFORE writing, refuses to write if the live graph differs
// from the expected baseline in any other way, and re-proves the result afterwards.
//
// It writes to ONE workflow and nothing else. It never touches Supabase, Neon, the G5 credential,
// Lead Intake, F17, or any other workflow, and it never activates or deactivates anything.
//
// SECRETS. Reads use N8N_API_KEY, the single write uses N8N_FIX_API_KEY, both from the
// environment only. Neither is printed.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const GATEWAY_NAME = 'FINMENTOR Mini App Gateway';
const G5_CLAIM_NODE = 'G5 Replay Claim';
const SUPABASE_CREDENTIAL_ID = 'B6wRirWfjqoASXU3';
const BASELINE_COMMIT = 'd8c3b5e';           // the candidate the live graph is expected to match
const DEPLOY = process.argv.includes('--deploy');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

function die(m) { console.error('\nABORTED: ' + m); process.exit(1); }
function ok(m) { console.log('  PASS  ' + m); }
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

// ---------------------------------------------------------------- the executable graph only
//
// Byte-identical to normalise() in run-gateway-store-failure-harness.mjs, deliberately: that
// script's preflight refuses to build a harness unless the live graph matches the candidate under
// this exact function, so using the same one makes the harness an INDEPENDENT re-check of this
// deploy rather than a restatement of it. Ids and positions are cosmetic and move when someone
// opens the editor, so they are excluded here and asserted separately below.
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
  return JSON.stringify({ nodes, connections: wf.connections, settings: wf.settings });
}

// A FIELD-level diff, so "what changed" is a list of paths and value pairs rather than a blob
// comparison that can only say same/different.
function fieldDiff(a, b) {
  const out = [];
  const walk = (x, y, path) => {
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(x) && isObj(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { walk(x[k], y[k], path ? path + '.' + k : k); }
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) { out.push({ path, from: x, to: y }); }
  };
  walk(a, b, '');
  return out;
}

function graphOf(wf) {
  const nodes = {};
  for (const n of wf.nodes) {
    nodes[n.name] = {
      type: n.type, typeVersion: n.typeVersion, parameters: n.parameters,
      credentials: n.credentials ? Object.fromEntries(Object.entries(n.credentials).map(([k, v]) => [k, v.id])) : null,
      alwaysOutputData: n.alwaysOutputData === true, onError: n.onError ?? null, disabled: n.disabled === true
    };
  }
  return { nodes, connections: wf.connections, settings: wf.settings };
}

function show(d) {
  const trim = (v) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s === undefined) { return '(absent)'; }
    return s.length > 150 ? s.slice(0, 150) + ' …(' + s.length + ' chars)' : s;
  };
  for (const c of d) {
    say('      ' + c.path);
    say('        from: ' + trim(c.from));
    say('        to  : ' + trim(c.to));
  }
}

// The complete, exhaustive list of what P9-R2 is allowed to change. Anything else is drift.
const INTENDED = [
  'nodes.' + G5_CLAIM_NODE + '.parameters.query',
  'nodes.' + G5_CLAIM_NODE + '.alwaysOutputData',
  'nodes.Claim Verdict.parameters.jsCode'
];

async function main() {
  const candidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));

  say('');
  say('== BEFORE ==================================================');
  const before = await api('GET', '/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  if (before.name !== GATEWAY_NAME) { die('workflow ' + GATEWAY_ID + ' is named "' + before.name + '", not the Gateway.'); }
  ok('workflow ' + GATEWAY_ID + ' is ' + GATEWAY_NAME);
  if (!before.active) { die('the Gateway is INACTIVE. Refusing to deploy into an unexpected state.'); }
  ok('the Gateway is ACTIVE (and this script never changes activation)');
  say('  live nodes: ' + before.nodes.length);

  // 1. The live graph must be exactly the previous candidate. If someone edited it in the UI, the
  //    "three intended changes" claim would be false and the edit would be silently overwritten.
  let baselineRaw = null;
  try {
    baselineRaw = execFileSync('git', ['show', BASELINE_COMMIT + ':n8n/candidate/miniapp-gateway-candidate.json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) { die('cannot read the baseline candidate from ' + BASELINE_COMMIT + ': ' + e.message); }
  const baseline = JSON.parse(baselineRaw);

  const driftFromBaseline = fieldDiff(graphOf(baseline), graphOf(before));
  if (driftFromBaseline.length !== 0) {
    say('  the LIVE graph differs from the ' + BASELINE_COMMIT + ' candidate:');
    show(driftFromBaseline);
    die('the live Gateway is not the expected baseline. Someone changed it outside the repo; resolve that before deploying.');
  }
  ok('live graph is a field-level match for the ' + BASELINE_COMMIT + ' candidate — ZERO pre-existing drift');

  // 2. State the intended change set, and refuse anything outside it.
  say('');
  say('== INTENDED CHANGES ========================================');
  const intended = fieldDiff(graphOf(before), graphOf(candidate));
  show(intended);
  const paths = intended.map((c) => c.path).sort();
  const unexpected = paths.filter((p) => !INTENDED.includes(p));
  const missing = INTENDED.filter((p) => !paths.includes(p));
  if (unexpected.length) { die('UNRELATED DRIFT in the candidate: ' + unexpected.join(', ')); }
  if (missing.length) { die('the candidate is missing an intended change: ' + missing.join(', ')); }
  if (paths.length !== 3) { die('expected exactly 3 changed fields, found ' + paths.length); }
  ok('exactly 3 changed fields, all three intended, zero unrelated drift');

  // 3. Invariants the candidate must satisfy no matter what the diff says.
  const check = (name, cond, detail) => { if (!cond) { die(name + (detail ? ' -> ' + detail : '')); } ok(name); };
  const cnodes = candidate.nodes;
  check('13 nodes', cnodes.length === 13, 'found ' + cnodes.length);
  check('node names and ids are unchanged',
    JSON.stringify(before.nodes.map((n) => [n.id, n.name]).sort()) === JSON.stringify(cnodes.map((n) => [n.id, n.name]).sort()));
  const webhooks = cnodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  check('exactly one public Gateway entry', webhooks.length === 1, webhooks.length + ' webhook nodes');
  const creds = cnodes.filter((n) => n.credentials);
  check('exactly one credential-bearing node, and it is the Postgres claim',
    creds.length === 1 && creds[0].name === G5_CLAIM_NODE && creds[0].type === 'n8n-nodes-base.postgres', JSON.stringify(creds.map((n) => n.name)));
  check('the credential is FINMENTOR Supabase G5, unchanged',
    creds[0].credentials.postgres.id === SUPABASE_CREDENTIAL_ID);
  const respond = cnodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  check('the same four Respond nodes', respond.length === 4, respond.length + ' respond nodes');
  const codes = Object.fromEntries(respond.map((n) => [n.name, n.parameters.options.responseCode]));
  check('response codes are numeric 200 / 409 / 503 plus the dynamic rejection',
    codes['Respond Bootstrap OK'] === 200 && codes['Respond Replay Refused'] === 409 &&
    codes['Respond Store Unavailable'] === 503 && String(codes['Respond Rejected']).includes('{{'), JSON.stringify(codes));
  check('the connection map is unchanged',
    JSON.stringify(before.connections) === JSON.stringify(candidate.connections));
  check('execution retention is off',
    candidate.settings.saveDataSuccessExecution === 'none' && candidate.settings.saveDataErrorExecution === 'none' &&
    candidate.settings.saveManualExecutions === false && candidate.settings.saveExecutionProgress === false);
  check('availableInMCP is false', candidate.settings.availableInMCP === false);
  check('no Neon credential anywhere', JSON.stringify(candidate).indexOf('Neon') === -1);
  const types = new Set(cnodes.map((n) => n.type));
  check('no Sheets / HTTP / sub-workflow node types',
    !['n8n-nodes-base.googleSheets', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.executeWorkflow'].some((t) => types.has(t)),
    [...types].join(', '));

  // 4. The P9-R2 semantics themselves, read off the artifact about to be written.
  const claimQ = cnodes.find((n) => n.name === G5_CLAIM_NODE).parameters.query;
  check('atomic INSERT ... ON CONFLICT DO NOTHING remains authoritative',
    /insert into public\.telegram_initdata_replays/i.test(claimQ) && /on conflict \(replay_key\) do nothing/i.test(claimQ));
  check('no SELECT-before-INSERT arbitration',
    !/\bselect\b/i.test(claimQ.slice(0, claimQ.search(/insert\s+into/i))));
  check('the query states a `claimed` verdict', /\bas\s+claimed\b/i.test(claimQ));
  check('no schema change: the INSERT still writes the same three columns',
    /\(replay_key, expires_at, correlation_id\)/.test(claimQ));
  check('alwaysOutputData is absent from the claim node',
    !cnodes.find((n) => n.name === G5_CLAIM_NODE).alwaysOutputData);

  if (!DEPLOY) {
    say('');
    say('== DRY RUN — nothing was written ============================');
    say('Re-run with --deploy to apply the three changes above.');
    return;
  }

  // 5. The single write. Only the four mutable fields are sent.
  say('');
  say('== DEPLOY ==================================================');
  await api('PUT', '/workflows/' + GATEWAY_ID, {
    name: candidate.name,
    nodes: candidate.nodes,
    connections: candidate.connections,
    settings: candidate.settings
  }, true);
  ok('PUT /workflows/' + GATEWAY_ID);

  say('');
  say('== AFTER ===================================================');
  const after = await api('GET', '/workflows/' + GATEWAY_ID + '?excludePinnedData=true');

  const residual = fieldDiff(graphOf(candidate), graphOf(after));
  if (residual.length !== 0) {
    say('  the DEPLOYED graph differs from the candidate:');
    show(residual);
    die('the deploy did not land exactly. The live graph is NOT the candidate.');
  }
  ok('deployed graph is a field-level match for the candidate — IDENTICAL');
  if (normalise(after) !== normalise(candidate)) { die('normalise() disagrees with the field diff; investigate before trusting either.'); }
  ok('the harness preflight normalisation agrees');

  const landed = fieldDiff(graphOf(before), graphOf(after));
  say('  fields changed on the live graph: ' + landed.length);
  show(landed);
  const landedPaths = landed.map((c) => c.path).sort();
  if (JSON.stringify(landedPaths) !== JSON.stringify([...INTENDED].sort())) {
    die('the live graph changed in ways that were not intended: ' + landedPaths.join(', '));
  }
  ok('exactly the three intended fields changed, and nothing else');

  check('still ACTIVE', after.active === true);
  check('still 13 nodes', after.nodes.length === 13);
  check('still exactly one credential, on the claim node',
    after.nodes.filter((n) => n.credentials).length === 1 &&
    after.nodes.find((n) => n.credentials).name === G5_CLAIM_NODE);
  check('still the FINMENTOR Supabase G5 credential',
    after.nodes.find((n) => n.credentials).credentials.postgres.id === SUPABASE_CREDENTIAL_ID);
  check('still four Respond nodes with numeric codes',
    after.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').length === 4 &&
    after.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
      .every((n) => typeof n.parameters.options.responseCode === 'number' || String(n.parameters.options.responseCode).includes('{{')));
  check('retention still off',
    after.settings.saveDataSuccessExecution === 'none' && after.settings.saveDataErrorExecution === 'none');

  const execs = await api('GET', '/executions?workflowId=' + GATEWAY_ID + '&limit=5');
  say('  retained executions on the Gateway: ' + (execs.data || []).length);

  say('');
  say('== RESULT: DEPLOYED, three fields, zero unrelated drift =====');
}

main().catch((e) => die(e.message));
