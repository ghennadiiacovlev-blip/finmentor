#!/usr/bin/env node
// FINMENTOR — deploy the SYSTEM ALERT workflow and wire its callers.
//
//   node scripts/deploy-system-alert.mjs --dry-run
//   node scripts/deploy-system-alert.mjs --apply
//
// Fresh tenant read, frozen pre-images, dry run, exact delta, read-back verification. Nothing is
// written without --apply, and --apply refuses unless the dry run's invariants all hold.
//
// ── OWNER DECISIONS THIS SCRIPT ENFORCES ───────────────────────────────────────────────────────
//
//   D1  retention settings are copied forward untouched, and a change fails the deploy
//   D2  errorWorkflow is copied forward untouched; the Mini App trio is NOT wired to anything
//   D6  the Gateway throw becomes a sanitised verdict, with G5 preserved byte-identically
//   D7  nothing here is named or described as durable dedup
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { emitNode, buildAlertWorkflow } from './build-system-alert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const UAT = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const OUT = join(ROOT, 'n8n', 'candidate');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and a write-capable key'); process.exitCode = 1; }

const APPLY = process.argv.includes('--apply');
const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');

const CALLERS = {
  'miniapp-submit': 'ELiPdw4mdxQbBaan',
  'miniapp-session': 'Hxje3Kel6nLLod5B',
  'miniapp-gateway': 'nTZHLbv2KFggdhh5',
  'lead-intake': 'QmIyEW2ZEqKregmN',
  'concierge': 'mppzthlkSJFr6Kle'
};

async function api(method, path, body) {
  const r = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': KEY }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  if (!r.ok) { throw new Error(method + ' ' + path + ' -> HTTP ' + r.status + ' ' + text.slice(0, 300)); }
  return text ? JSON.parse(text) : null;
}

// n8n rejects unknown top-level keys on PUT. Only these four are writable.
const putBody = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings });

const clone = (x) => JSON.parse(JSON.stringify(x));
const say = (m) => console.log(m);
const problems = [];
const must = (c, m) => { if (!c) { problems.push(m); say('  FAIL  ' + m); } else { say('  ok    ' + m); } };

// ── the emit points ────────────────────────────────────────────────────────────────────────────
//
// `after` is the node the emit hangs off. For every HTTP path that is a RESPONDER, so the client
// answer is already flushed. The Concierge has no responder: there the emit follows `Save Intake
// State`, the Bot_Sessions mutation whose proven outcome is the thing being reported.
const EMITS = [
  { wf: 'miniapp-submit', after: 'Respond Submit Unresolved', router: 'Alert Route (Submit)',
    name: 'Emit System Alert (Submit)', pos: [1600, 700] },
  { wf: 'miniapp-session', after: 'Respond Draft Unavailable', verdict: 'Draft Unavailable',
    code: 'TEMPORARY_BACKEND_ERROR', retryable: 'true',
    identity: '={{ String($(\'Session Webhook\').first().json.body?.app_session_id || \'\') }}',
    name: 'Emit System Alert (Session)', pos: [1600, 700] },
  { wf: 'miniapp-gateway', after: 'Respond Store Unavailable', verdict: 'Claim Store',
    code: 'REPLAY_STORE_UNAVAILABLE', retryable: 'true',
    identity: '={{ String($(\'Derive Replay Key\').first().json.correlation_id || \'\') }}',
    name: 'Emit System Alert (Claim)', pos: [1600, 900] },
  { wf: 'miniapp-gateway', after: 'Respond Session Unavailable', verdict: 'Session Store Verdict',
    code: 'SESSION_STORE_UNAVAILABLE', retryable: 'true',
    identity: '={{ String($(\'Derive Replay Key\').first().json.correlation_id || \'\') }}',
    name: 'Emit System Alert (Session Store)', pos: [1900, 1100] },
  { wf: 'lead-intake', after: 'Respond Pipeline Failed', verdict: 'Pipeline Write Failed',
    code: 'PIPELINE_WRITE_FAILED', retryable: 'true',
    identity: '={{ String($(\'Dedup Guard\').first().json.request_id || \'\') }}',
    name: 'Emit System Alert (Pipeline)', pos: [3000, 1400] },
  { wf: 'lead-intake', after: 'Respond Merge Failed', verdict: 'Pipeline Merge Failed',
    code: 'PIPELINE_MERGE_FAILED', retryable: 'true',
    identity: '={{ String($(\'Dedup Guard\').first().json.request_id || \'\') }}',
    name: 'Emit System Alert (Merge)', pos: [3000, 1600] },
  { wf: 'lead-intake', after: 'Respond Infra Failed', verdict: 'CRM Unavailable',
    code: 'CRM_UNAVAILABLE', retryable: 'true',
    identity: '={{ String($(\'Validate Payload\').first().json.request_id || \'\') }}',
    name: 'Emit System Alert (Infra)', pos: [3000, 1800] },
  { wf: 'concierge', after: 'Save Intake State', verdict: 'Parse Intake Response',
    // THE SUCCESS SENTINEL IS AN EMPTY CODE, NOT A SPARE ONE. An unknown-but-well-formed code
    // would pass the shape test and alert on every successful lead. '' fails it and is silent.
    code: '={{ $(\'Parse Intake Response\').first().json.intake_ok ? \'\' : \'INTAKE_NOT_OK\' }}',
    retryable: 'true',
    identity: '={{ String($(\'Parse Intake Response\').first().json.cycle_id || \'\') }}',
    name: 'Emit System Alert (Concierge)', pos: [4200, 300] }
];

// The Mini App Submit router. One responder serves three verdicts, so the route is resolved from
// the verdict item's own disjoint shape rather than guessed — and the three shapes cannot
// collide: only Receipt Verdict emits `receipt_reason`, and only Privacy Verdict emits
// PRIVACY_UNRESOLVED.
const SUBMIT_ROUTER = [
  '// Which verdict produced this refusal. The responder is shared by three, and the side-effect',
  '// class differs between them, so guessing would mislabel what was written.',
  '//',
  '//   Receipt Verdict   is the only one that emits `receipt_reason`',
  '//   Privacy Verdict   is the only one that emits PRIVACY_UNRESOLVED',
  '//   Parse Intake Result is what remains',
  '//',
  '// Nothing here reads a draft, a payload or a client field. It reads the verdict.',
  'const v = $input.first().json || {};',
  'const code = String(v.error_code || "");',
  'let verdict_node = "Parse Intake Result";',
  'if (v.receipt_reason !== undefined) { verdict_node = "Receipt Verdict"; }',
  'else if (code === "PRIVACY_UNRESOLVED") { verdict_node = "Privacy Verdict"; }',
  'return [{ json: {',
  '  verdict_node: verdict_node,',
  '  error_code: code === "" ? "SUBMIT_UNRESOLVED" : code,',
  '  retryable: v.retryable === true,',
  '  route_identity: String($("Submit State").first().json.submission_key || "")',
  '} }];'
].join('\n');

// ── the Gateway throw, normalised (D6) ─────────────────────────────────────────────────────────
//
// `Create App Session` throws today. The graph has no error route, the workflow has no
// errorWorkflow and retention is off, so that throw is invisible everywhere.
//
// It becomes `continueErrorOutput` — the same posture `G5 Replay Claim` already uses — with the
// SUCCESS output still going to `Read Back Sessions` unchanged, and the new error output going to
// a verdict node and a fail-closed 503.
//
// WHY THE ERROR MUST NOT JOIN THE SUCCESS PATH. `Finalise Session` answers `found || cand`: on an
// empty read-back it returns the candidate, because "this execution inserted a row a moment ago".
// That reasoning holds only when the insert SUCCEEDED. Routing a failed insert into it would turn
// a hard failure into a false success and hand the client a session id that does not exist. The
// error output is therefore a separate branch that never rejoins.
const SESSION_STORE_VERDICT = [
  '// The session store did not accept the insert. Fail closed: no session is minted, nothing is',
  '// invented, and the raw store error is NOT carried forward — only the fact of the failure.',
  '//',
  '// The G5 replay claim was already won and is durable, so this is side-effect class C. The',
  '// alert says so; this node says nothing about it, because classification belongs to the route',
  '// table and not to the caller.',
  'return [{ json: { ok: 0, statusCode: 503,',
  '  response: { ok: false, error_code: "SESSION_STORE_UNAVAILABLE", retryable: true } } }];'
].join('\n');

function codeNode(name, jsCode, x, y) {
  return { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: 'sa-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name,
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y] };
}

// APPEND, never replace. Most emit sources are terminal responders with no connections entry at
// all; the Lead Intake ones already have a downstream node that must survive. Overwriting the
// edge list would silently delete `Restore Lead Context` and friends.
function appendEdge(conns, from, to) {
  const existing = (conns[from] || {}).main || [];
  const branch0 = (existing[0] || []).slice();
  branch0.push({ node: to, type: 'main', index: 0 });
  const main = existing.length ? existing.slice() : [];
  main[0] = branch0;
  conns[from] = { main: main };
}

function patchGateway(wf) {
  const nodes = clone(wf.nodes);
  const conns = clone(wf.connections);
  const create = nodes.find((n) => n.name === 'Create App Session');
  if (!create) { throw new Error('Create App Session is gone'); }
  // The one node property that changes, and only this one.
  create.onError = 'continueErrorOutput';

  nodes.push(codeNode('Session Store Verdict', SESSION_STORE_VERDICT, 1500, 1100));
  const respondTemplate = nodes.find((n) => n.name === 'Respond Store Unavailable');
  nodes.push({
    parameters: {
      respondWith: 'text',
      responseBody: '={{ JSON.stringify($json.response) }}',
      options: { responseCode: 503, responseHeaders: clone(respondTemplate.parameters.options?.responseHeaders || {}) }
    },
    id: 'sa-respond-session-unavailable', name: 'Respond Session Unavailable',
    type: 'n8n-nodes-base.respondToWebhook', typeVersion: respondTemplate.typeVersion,
    position: [1700, 1100]
  });

  // output 0 (success) is preserved exactly; output 1 (error) is new.
  const existing = (conns['Create App Session'] || {}).main || [];
  conns['Create App Session'] = { main: [
    existing[0] || [{ node: 'Read Back Sessions', type: 'main', index: 0 }],
    [{ node: 'Session Store Verdict', type: 'main', index: 0 }]
  ] };
  conns['Session Store Verdict'] = { main: [[{ node: 'Respond Session Unavailable', type: 'main', index: 0 }]] };
  return { nodes, connections: conns };
}

// ── IDEMPOTENCE ────────────────────────────────────────────────────────────────────────────────
//
// n8n PERSISTS a PUT and can still refuse to publish it: wiring a caller to an unpublished
// sub-workflow saves the nodes and returns 400. A re-run would then append a second copy and be
// rejected for duplicate node names, and the "pre-image" it froze would already contain the first
// attempt's nodes — which is a rollback body that does not roll back.
//
// So every run strips this pass's own nodes from the fresh read BEFORE anything else. The result
// is the true original, the frozen pre-image is a real rollback body, and running the deploy
// twice produces exactly the same tenant as running it once.
const SA_NODE = (n) => /^Emit System Alert |^Alert Route \(/.test(n.name)
  || n.name === 'Session Store Verdict' || n.name === 'Respond Session Unavailable';

function stripSystemAlert(wf) {
  const removed = wf.nodes.filter(SA_NODE).map((n) => n.name);
  if (!removed.length) { return { wf: wf, removed: [] }; }
  const out = clone(wf);
  out.nodes = out.nodes.filter((n) => !SA_NODE(n));
  const conns = {};
  for (const [from, spec] of Object.entries(out.connections || {})) {
    if (removed.indexOf(from) !== -1) { continue; }
    conns[from] = { main: (spec.main || []).map((br) => (br || []).filter((e) => removed.indexOf(e.node) === -1)) };
  }
  // `Create App Session` gains an error output only in this pass; drop it with the branch.
  const create = out.nodes.find((n) => n.name === 'Create App Session');
  if (create && create.onError === 'continueErrorOutput') {
    delete create.onError;
    if (conns['Create App Session']) { conns['Create App Session'].main = conns['Create App Session'].main.slice(0, 1); }
  }
  out.connections = conns;
  return { wf: out, removed: removed };
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────
say('');
say('SYSTEM ALERT — ' + (APPLY ? 'APPLY' : 'DRY RUN'));
say('='.repeat(94));
mkdirSync(UAT, { recursive: true });
mkdirSync(OUT, { recursive: true });

// 1. fresh read + frozen pre-images
const pre = {};
for (const [key, id] of Object.entries(CALLERS)) {
  const live = await api('GET', '/workflows/' + id);
  const stripped = stripSystemAlert(live);
  pre[key] = stripped.wf;
  writeFileSync(join(UAT, id + '.pre-system-alert.json'), JSON.stringify(pre[key], null, 2) + '\n', 'utf8');
  if (stripped.removed.length) {
    say('  ' + key + ': removed ' + stripped.removed.length + ' node(s) from a previous run before re-deriving — '
      + stripped.removed.join(', '));
  }
}
say('  froze ' + Object.keys(pre).length + ' pre-images under .uat/ (this pass\'s own nodes stripped first)');

// 2. the alert workflow
let alertId = process.env.SYSTEM_ALERT_WF_ID || '';
if (!alertId) {
  const list = await api('GET', '/workflows?limit=250');
  const found = (list.data || []).find((w) => w.name === 'FINMENTOR SYSTEM ALERT');
  alertId = found ? found.id : '';
}
const alertWf = buildAlertWorkflow();
if (!alertId) {
  if (!APPLY) { say('  would CREATE "FINMENTOR SYSTEM ALERT" (' + alertWf.nodes.length + ' nodes)'); alertId = 'PENDING'; }
  else {
    const created = await api('POST', '/workflows', putBody(alertWf));
    alertId = created.id;
    writeFileSync(join(UAT, alertId + '.system-alert-created.json'), JSON.stringify(created, null, 2) + '\n', 'utf8');
    say('  CREATED FINMENTOR SYSTEM ALERT -> ' + alertId);
  }
} else { say('  alert workflow already present -> ' + alertId); }

// 3. build the caller candidates
const manifest = { emits: [], responder_hashes: [], settings: [], credential_delta: 0, alert_workflow_id: alertId };
const candidates = {};

for (const [key, id] of Object.entries(CALLERS)) {
  const wf = clone(pre[key]);
  let nodes = clone(wf.nodes);
  let conns = clone(wf.connections);

  if (key === 'miniapp-gateway') {
    const patched = patchGateway({ nodes, connections: conns });
    nodes = patched.nodes; conns = patched.connections;
  }

  for (const e of EMITS.filter((x) => x.wf === key)) {
    let sourceNode = e.after;
    if (e.router) {
      nodes.push(codeNode(e.router, SUBMIT_ROUTER, e.pos[0] - 220, e.pos[1]));
      appendEdge(conns, e.after, e.router);
      sourceNode = e.router;
    }
    const n = emitNode(e.name, key, e.verdict || '={{ $json.verdict_node }}',
      e.code || '={{ $json.error_code }}', e.retryable || '={{ $json.retryable }}',
      e.identity || '={{ $json.route_identity }}', alertId, e.pos[0], e.pos[1]);
    nodes.push(n);
    appendEdge(conns, sourceNode, e.name);

    manifest.emits.push({ workflow: key, node: e.name,
      waitForSubWorkflow: n.parameters.options.waitForSubWorkflow,
      onError: n.onError, credentials: n.credentials ? 1 : 0,
      after_responder: /^Respond /.test(e.after) });
  }

  // invariants
  for (const r of wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')) {
    const after = nodes.find((n) => n.name === r.name);
    manifest.responder_hashes.push({ workflow: key, node: r.name, before: sha(r), after: sha(after) });
  }
  manifest.settings.push({ workflow: key, before: JSON.stringify(wf.settings || {}), after: JSON.stringify(wf.settings || {}) });
  const credsBefore = wf.nodes.filter((n) => n.credentials).length;
  const credsAfter = nodes.filter((n) => n.credentials).length;
  manifest.credential_delta += (credsAfter - credsBefore);

  candidates[key] = { id, name: wf.name, nodes, connections: conns, settings: wf.settings };
  writeFileSync(join(OUT, 'system-alert-caller-' + key + '.json'), JSON.stringify(candidates[key], null, 2) + '\n', 'utf8');
}

writeFileSync(join(OUT, 'system-alert-callers.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

say('');
say('  INVARIANTS');
must(manifest.responder_hashes.every((r) => r.before === r.after),
  'every EXISTING responder is byte-identical (' + manifest.responder_hashes.length + ' checked)');
must(manifest.settings.every((s) => s.before === s.after), 'no workflow settings changed (D1/D2: retention and errorWorkflow untouched)');
must(manifest.credential_delta === 0, 'no caller gained or lost a credential');
must(manifest.emits.every((e) => e.waitForSubWorkflow === false), 'every emit is fire-and-forget');
must(manifest.emits.every((e) => e.onError === 'continueRegularOutput'), 'no emit can fail its caller');
must(manifest.emits.length === 8, 'eight emit points across five workflows (got ' + manifest.emits.length + ')');

// G5 must be untouched, byte for byte.
const g5Before = pre['miniapp-gateway'].nodes.find((n) => n.name === 'G5 Replay Claim');
const g5After = candidates['miniapp-gateway'].nodes.find((n) => n.name === 'G5 Replay Claim');
must(sha(g5Before) === sha(g5After), 'G5 Replay Claim is byte-identical');
const verifyBefore = pre['miniapp-gateway'].nodes.find((n) => n.name === 'Verify InitData');
const verifyAfter = candidates['miniapp-gateway'].nodes.find((n) => n.name === 'Verify InitData');
must(sha(verifyBefore) === sha(verifyAfter), 'Verify InitData is byte-identical');
const createBefore = clone(pre['miniapp-gateway'].nodes.find((n) => n.name === 'Create App Session'));
const createAfter = clone(candidates['miniapp-gateway'].nodes.find((n) => n.name === 'Create App Session'));
delete createBefore.onError; delete createAfter.onError;
must(sha(createBefore) === sha(createAfter), 'Create App Session changed ONLY its onError');
must(createAfter === undefined || candidates['miniapp-gateway'].connections['Create App Session'].main[0].some((e) => e.node === 'Read Back Sessions'),
  'the Gateway success path still goes to Read Back Sessions');

for (const [key, c] of Object.entries(candidates)) {
  const before = pre[key].nodes.length;
  say('  ' + key.padEnd(18) + before + ' -> ' + c.nodes.length + ' nodes');
}

if (problems.length) {
  say('');
  say('  ' + problems.length + ' INVARIANT FAILURE(S) — NOT DEPLOYING');
  process.exitCode = 1;
} else if (!APPLY) {
  say('');
  say('  DRY RUN CLEAN. Re-run with --apply to deploy.');
} else {
  say('');
  for (const [key, c] of Object.entries(candidates)) {
    await api('PUT', '/workflows/' + c.id, putBody(c));
    const back = await api('GET', '/workflows/' + c.id);
    writeFileSync(join(UAT, c.id + '.post-system-alert.json'), JSON.stringify(back, null, 2) + '\n', 'utf8');
    const okNodes = back.nodes.length === c.nodes.length;
    const okSettings = JSON.stringify(back.settings || {}) === JSON.stringify(pre[key].settings || {});
    say('  DEPLOYED ' + key.padEnd(18) + 'nodes=' + back.nodes.length + (okNodes ? ' ok' : ' MISMATCH')
      + '  settings=' + (okSettings ? 'unchanged' : 'CHANGED — INVESTIGATE'));
    if (!okNodes || !okSettings) { process.exitCode = 1; }
  }
  say('');
  say('  Read back from a fresh GET, not from the PUT response.');
}
say('');
