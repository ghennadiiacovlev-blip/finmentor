#!/usr/bin/env node
// FINMENTOR — deploy the Mini App bootstrap wiring and the submit idempotency mechanism.
//
//   node scripts/deploy-miniapp-bootstrap.mjs --dry-run
//   node scripts/deploy-miniapp-bootstrap.mjs --confirm
//
// TWO WORKFLOWS, AND NOTHING ELSE.
//
//   KBD7Q94QQnlzgYKJ  the owner-only Mini App host — one node's page body
//   ELiPdw4mdxQbBaan  the submit endpoint — the D3-D7 mechanism, +3 nodes
//
// The Gateway, the session endpoint, Lead Intake, the Concierge, the Transport workflow and every
// alerting workflow are NOT read for writing and NOT touched. The session endpoint was compared and
// differs from its candidate only by the tenant-assigned webhookId, so it is left alone.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. Both offline gates must pass first — including the one that EXECUTES the submit graph. A
//      mechanism that has not been run is a mechanism that fails on the owner's first submission.
//   2. The live workflow must be in a state this script created: the pre-deploy snapshot, or the
//      record of its own last write.
//   3. The host may differ from its candidate ONLY in the page body.
//   4. The submit endpoint may differ ONLY by the three declared new nodes plus the declared
//      rewrites. Its webhook path, method, response mode and settings must be byte-identical, and
//      the tenant's webhookId is carried across rather than regenerated.
//   5. No placeholder may reach the tenant, and no literal identity may reach the repo.
//   6. G5, the 72 h TTL, the owner gate and the privacy ordering must all still be there afterwards.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const HOST_ID = 'KBD7Q94QQnlzgYKJ';
const SUBMIT_ID = 'ELiPdw4mdxQbBaan';
const SESSION_ID = 'Hxje3Kel6nLLod5B';
const GATEWAY_ID = 'nTZHLbv2KFggdhh5';

// The Gateway was a CLOSED surface. This pass reopens it for exactly one thing — resolving which
// session a Telegram user and cycle already own, AFTER verification and the G5 claim — and every
// node it adds is named here. Anything else differing is a refusal.
const GATEWAY_NEW = ['Read User Sessions', 'Resolve Session', 'IF Create Session',
  'Build Session Row', 'Read Back Sessions', 'Finalise Session'];
const GATEWAY_REWRITTEN = ['Respond Bootstrap OK'];
// The verification half, the claim and the mint must be byte-identical afterwards.
const GATEWAY_FROZEN = ['Gateway Webhook', 'Verify InitData', 'IF Verified', 'Respond Rejected',
  'Derive Replay Key', 'G5 Replay Claim', 'Claim Verdict', 'IF Claim Won',
  'Respond Replay Refused', 'Respond Store Unavailable', 'Build App Session', 'Create App Session'];
// One node, one flag. `Read App Session` gains alwaysOutputData so a no-match still produces an
// item — without it Session Verdict never runs and an unknown or expired session answers HTTP 200
// with an empty body, which the client cannot route to the SESSION_EXPIRED screen.
const SESSION_REWRITTEN = ['Read App Session'];
const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const PRIVACY_CRED = { id: 'Jsfozg8CsclIdCRo', name: 'FINMENTOR Privacy Audit Writer' };

const GATES = [
  'premium-ux-bootstrap.test.mjs',
  'premium-ux-submit-idempotency.test.mjs',
  'premium-ux-net.test.mjs',
  'premium-ux-draft.test.mjs',
  'premium-ux-submit.test.mjs',
  'premium-ux-contact-channel.test.mjs',
  'premium-ux-ttl.test.mjs',
  'miniapp-gateway.test.mjs',
  'g5-replay-claim.test.mjs',
  'lead-intake-dedup-remediation.test.mjs',
  'concierge-internal-handoff.test.mjs',
  'premium-ux-resume.test.mjs',
  'gateway-store-failure-harness.test.mjs'
];

// The three nodes this pass adds, and the nodes it rewrites. Anything else differing is a refusal.
const SUBMIT_NEW = ['Privacy Verdict', 'IF Privacy Recorded', 'IF Payload Built'];
// One responder replaces two: the flattening BAD_REQUEST responder is gone, and the echoing one
// is renamed. Net -1 node.
const SUBMIT_RENAMED = { 'Respond Submit Session Invalid': 'Respond Submit Terminal' };
const SUBMIT_DROPPED = ['Respond Submit Rejected'];
// "Read Submit Session" gains alwaysOutputData for the same reason the session read does: a
// no-match must still produce an item, or the verdict node never runs and an unknown session
// answers HTTP 200 with an empty body.
const SUBMIT_REWRITTEN = ['Submit Guard', 'Submit State', 'Read Submit Session',
  'Build Intake Payload', 'Mark Submitted', 'Respond Submit Terminal'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

let OWNER_ID = '';
const redact = (s) => (OWNER_ID ? String(s).split(OWNER_ID).join('«owner-id»') : String(s));
const say = (m) => console.log(redact(m));
const ok = (m) => say('  PASS  ' + m);
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
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });
const body = (wf) => JSON.stringify(importable(wf), null, 2) + '\n';

say('');
say('RU UAT — Mini App bootstrap + submit idempotency');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites two live workflows; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

// ── 0. gates ───────────────────────────────────────────────────────────────────────────────────
say('STEP 0 — the offline gates that stand behind this change');
for (const g of GATES) {
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', g)], { encoding: 'utf8' });
  // The gates print their tally in one of two shapes — "ASSERTIONS: N passed" and
  // "PASS  N checks passed, 0 failed" — so read the LAST one rather than the first, exactly as
  // qa/run-all.mjs does. Reading only one shape made a passing gate look like a failure.
  const all = [...String(r.stdout || '').matchAll(/(\d+)\s+(?:checks\s+)?passed(?:,\s*(\d+)\s+failed)?/g)];
  const m = all.length ? all[all.length - 1] : null;
  if (r.status !== 0 || !m || (m[2] && Number(m[2]) > 0)) {
    die(g + ' did not pass:\n' + String(r.stdout || r.stderr).slice(-700));
  }
  ok(g.padEnd(44) + m[1] + ' assertions');
}
say('');

// ── 1. the owner identity, from the live tenant ────────────────────────────────────────────────
say('STEP 1 — owner identity, read from the live Concierge');
{
  const c = await api('GET', '/workflows/mppzthlkSJFr6Kle');
  const st = c.nodes.find((n) => n.name === 'Settings to Object');
  const m = String((st && st.parameters.jsCode) || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  if (!m) { die('could not read owner_chat_id from the live Concierge'); }
  OWNER_ID = m[1];
  ok('owner identity resolved from the live workflow (value withheld from this log)');
}
say('');

// ── 2. the host ────────────────────────────────────────────────────────────────────────────────
say('STEP 2 — Mini App host (' + HOST_ID + ')');
const hostLive = await api('GET', '/workflows/' + HOST_ID);
const hostRollback = join(OUT_DIR, HOST_ID + '.pre-bootstrap.json');
const hostDeployed = join(OUT_DIR, HOST_ID + '.deployed-bootstrap.json');
{
  const liveBody = body(hostLive);
  const known = [hostRollback, hostDeployed].filter(existsSync).map((f) => sha(readFileSync(f, 'utf8')));
  if (known.length && known.indexOf(sha(liveBody)) === -1) {
    die('the host is in a state this script did not create — someone edited it. Re-read it first.');
  }
  if (!existsSync(hostRollback)) { writeFileSync(hostRollback, liveBody, 'utf8'); }
  ok('pre-hash accepted: ' + sha(liveBody).slice(0, 32));
  ok('rollback: ' + hostRollback);
}
const hostServe = hostLive.nodes.find((n) => n.name === 'Serve Page');
if (!hostServe) { die('the host has no Serve Page node'); }
const livePage = String(hostServe.parameters.responseBody || '');

const hostCandidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json'), 'utf8'));
{
  const urls = {};
  for (const key of ['gateway', 'session', 'submit']) {
    const m = new RegExp(key + ":\\s*'([^']+)'").exec(livePage);
    if (!m) { die('could not read the ' + key + ' endpoint out of the live page'); }
    urls[key] = m[1];
  }
  const serve = hostCandidate.nodes.find((n) => n.name === 'Serve Page');
  let page = String(serve.parameters.responseBody || '')
    .split('__PREMIUM_GATEWAY_URL__').join(urls.gateway)
    .split('__PREMIUM_SESSION_URL__').join(urls.session)
    .split('__PREMIUM_SUBMIT_URL__').join(urls.submit);
  if (/__PREMIUM_[A-Z_]+__/.test(page)) { die('an endpoint placeholder survived substitution'); }
  serve.parameters.responseBody = page;
  ok('endpoints read back out of the LIVE page; the app talks to what it talked to before');

  // The bootstrap wiring must actually be in there.
  const markers = [
    ['function startup()', 'the startup sequence'],
    ['FM_NET.bootstrap(locale)', 'the bootstrap call'],
    ['FM_NET.saveDraft', 'the draft write'],
    ["client_version: GATEWAY_CLIENT_VERSION", 'the client_version the Gateway demands'],
    ['function flushDraft()', 'the save queue'],
    ['APP_BOOT_FAILURE', 'the bootstrap failure screen'],
    ['APP_SESSION_EXPIRED', 'the session failure screen'],
    ['isCommitted(r)', 'the committed-replay success rule']
  ];
  for (const [needle, what] of markers) {
    if (page.indexOf(needle) === -1) { die('the host candidate is stale: ' + what + ' is missing — re-run build-miniapp-host.mjs'); }
  }
  ok('all eight bootstrap markers present in the candidate page');

  const strip = (wf) => JSON.stringify(wf.nodes.map((n) => {
    const p = JSON.parse(JSON.stringify(n.parameters || {}));
    if (n.name === 'Serve Page') { delete p.responseBody; }
    return [n.name, n.type, n.typeVersion, p, n.onError || null];
  }));
  if (strip(hostLive) !== strip(hostCandidate)) { die('the host differs outside the page body'); }
  if (JSON.stringify(hostLive.connections) !== JSON.stringify(hostCandidate.connections)) { die('the host graph moved'); }
  ok('route, headers and graph identical; only the page body changes');
  ok('page: ' + livePage.length + ' -> ' + page.length + ' bytes');
}
say('');

// ── 3. the submit endpoint ─────────────────────────────────────────────────────────────────────
say('STEP 3 — submit endpoint (' + SUBMIT_ID + ')');
const submitLive = await api('GET', '/workflows/' + SUBMIT_ID);
const submitRollback = join(OUT_DIR, SUBMIT_ID + '.pre-idempotency.json');
const submitDeployed = join(OUT_DIR, SUBMIT_ID + '.deployed-idempotency.json');
{
  const liveBody = body(submitLive);
  const known = [submitRollback, submitDeployed].filter(existsSync).map((f) => sha(readFileSync(f, 'utf8')));
  if (known.length && known.indexOf(sha(liveBody)) === -1) {
    die('the submit endpoint is in a state this script did not create — someone edited it.');
  }
  if (!existsSync(submitRollback)) { writeFileSync(submitRollback, liveBody, 'utf8'); }
  ok('pre-hash accepted: ' + sha(liveBody).slice(0, 32));
  ok('rollback: ' + submitRollback);
}

const M = await import('../scripts/build-premium-endpoints.mjs');
const submitCandidate = M.resolveEndpoint(
  JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-submit-endpoint-candidate.json'), 'utf8')),
  { ownerId: OWNER_ID, leadIntakeId: LEAD_INTAKE_ID, privacyCredId: PRIVACY_CRED.id }
);
{
  // The privacy credential must be ATTACHED, not merely named.
  const pg = submitCandidate.nodes.find((n) => n.type === 'n8n-nodes-base.postgres');
  if (!pg) { die('the submit candidate has no privacy write'); }
  pg.credentials = { postgres: PRIVACY_CRED };
  if (/on conflict/i.test(JSON.stringify(pg.parameters))) { die('the privacy insert uses ON CONFLICT; the writer role cannot execute it'); }
  if (JSON.stringify(pg.parameters).indexOf('privacy.privacy_acknowledgements') === -1) { die('the privacy insert does not target the privacy schema'); }
  ok('privacy credential attached; the insert is a plain INSERT into the privacy schema');

  // The tenant assigns webhookId. Carry it over rather than letting n8n mint a new one.
  const liveHook = submitLive.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const candHook = submitCandidate.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (!liveHook || !candHook) { die('the submit endpoint lost its webhook'); }
  if (JSON.stringify(liveHook.parameters) !== JSON.stringify(candHook.parameters)) { die('the webhook route or mode changed'); }
  if (liveHook.webhookId) { candHook.webhookId = liveHook.webhookId; }
  ok('webhook route, method and id unchanged: POST /' + candHook.parameters.path);

  if (JSON.stringify(submitCandidate.settings || {}) !== JSON.stringify(submitLive.settings || {})) { die('workflow settings changed'); }
  ok('workflow settings unchanged (retention still off)');

  // EXACTLY THE DECLARED SHAPE CHANGE — measured against the PRE-PASS SNAPSHOT, not against live.
  //
  // On a redeploy the live workflow already carries this pass's nodes, so comparing shape against
  // it reports 'added: nothing' and refuses a correction. The snapshot is the fixed point: it is
  // what the workflow looked like before this pass touched it, and it is never overwritten.
  const baseline = existsSync(submitRollback)
    ? JSON.parse(readFileSync(submitRollback, 'utf8'))
    : submitLive;
  const liveNames = baseline.nodes.map((n) => n.name);
  const candNames = submitCandidate.nodes.map((n) => n.name);
  const added = candNames.filter((n) => liveNames.indexOf(n) === -1);
  const removed = liveNames.filter((n) => candNames.indexOf(n) === -1);
  const expectAdded = SUBMIT_NEW.concat(Object.values(SUBMIT_RENAMED)).sort();
  const expectRemoved = Object.keys(SUBMIT_RENAMED).concat(SUBMIT_DROPPED).sort();
  if (added.slice().sort().join(',') !== expectAdded.join(',')) { die('unexpected new nodes: ' + added.join(', ')); }
  if (removed.slice().sort().join(',') !== expectRemoved.join(',')) { die('unexpected removed nodes: ' + removed.join(', ')); }
  ok('+' + added.length + ' nodes (' + added.join(', ') + ')');
  ok('-' + removed.length + ' nodes (' + removed.join(', ') + ')');

  // BEHAVIOUR, NOT COORDINATES. Adding three nodes shifts every later node along the canvas, and
  // `position` is layout — it changes nothing about what the workflow does. Comparing it would have
  // reported half the graph as an undeclared rewrite and hidden a real one in the noise.
  const behaviour = (n) => {
    const c = JSON.parse(JSON.stringify(n));
    delete c.position;
    delete c.webhookId;
    return JSON.stringify(c);
  };
  // vs the SNAPSHOT: did this pass rewrite what it said it would?
  const changed = candNames.filter((n) => {
    const was = baseline.nodes.find((x) => x.name === n);
    return was && behaviour(was) !== behaviour(submitCandidate.nodes.find((x) => x.name === n));
  });
  for (const c of changed) {
    if (SUBMIT_REWRITTEN.indexOf(c) === -1) { die('UNDECLARED change to ' + c); }
  }
  ok('rewritten vs snapshot: ' + changed.join(', '));

  // vs LIVE: is this about to clobber anything it did not declare? Every node that differs from
  // the tenant right now must be one this pass owns.
  const owned = SUBMIT_NEW.concat(SUBMIT_REWRITTEN, Object.values(SUBMIT_RENAMED));
  for (const n of submitCandidate.nodes) {
    const now = submitLive.nodes.find((x) => x.name === n.name);
    if (!now) { continue; }
    if (behaviour(now) !== behaviour(n) && owned.indexOf(n.name) === -1) {
      die('about to clobber an undeclared live change to ' + n.name);
    }
  }
  const liveExtra = submitLive.nodes.filter((n) => candNames.indexOf(n.name) === -1 && removed.indexOf(n.name) === -1);
  if (liveExtra.length) { die('the tenant has nodes this pass did not create: ' + liveExtra.map((n) => n.name).join(', ')); }
  ok('nothing undeclared would be clobbered');

  // The invariants that must survive.
  const json = JSON.stringify(submitCandidate);
  if (/__[A-Z_]{4,}__/.test(json)) { die('an unresolved placeholder would reach the tenant'); }
  if (json.indexOf('NOT_AUTHORISED') === -1) { die('the owner-only gate is gone'); }
  if (!/s\.telegram_user_id/.test(json)) { die('the owner gate no longer reads the server-stored identity'); }
  for (const forbidden of ['Verify InitData', 'G5 Replay Claim', 'Derive Replay Key', 'telegram_initdata_replays', 'finmentor-miniapp-gateway']) {
    if (json.indexOf(forbidden) !== -1) { die('the candidate touches the closed bootstrap/G5 surface: ' + forbidden); }
  }
  if (/body\.init_data|\binit_data\s*:/.test(json)) { die('the candidate reads or sends init_data after bootstrap'); }
  if (json.indexOf('googleSheets') !== -1) { die('the submit endpoint writes the CRM directly'); }
  for (const n of submitCandidate.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
  }
  const order = candNames.indexOf('Write Privacy Acknowledgement') < candNames.indexOf('Call Lead Intake');
  if (!order) { die('the acknowledgement is no longer written before the irreversible call'); }
  ok('owner gate, G5 isolation, privacy ordering and the P9-R2 rule all intact');

  // The resolved projection must PARSE. A Code node that does not is a runtime failure on the
  // owner's first submission, and n8n accepts it happily at deploy time.
  for (const n of submitCandidate.nodes) {
    const js = (n.parameters && n.parameters.jsCode) || '';
    if (!js) { continue; }
    try { new Function(js); } catch (e) { die('node ' + n.name + ' does not parse: ' + e.message); }
  }
  ok('every Code node parses, including the 55 KB inlined projection');
}
say('');

// ── 2b. the Gateway ────────────────────────────────────────────────────────────────────────────
say('STEP 2b — Gateway (' + GATEWAY_ID + ') — a previously CLOSED surface');
const gwLive = await api('GET', '/workflows/' + GATEWAY_ID);
const gwRollback = join(OUT_DIR, GATEWAY_ID + '.pre-resume.json');
const gwDeployed = join(OUT_DIR, GATEWAY_ID + '.deployed-resume.json');
const gwCandidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));
{
  const liveBody = body(gwLive);
  const known = [gwRollback, gwDeployed].filter(existsSync).map((f) => sha(readFileSync(f, 'utf8')));
  if (known.length && known.indexOf(sha(liveBody)) === -1) {
    die('the Gateway is in a state this script did not create — someone edited it.');
  }
  if (!existsSync(gwRollback)) { writeFileSync(gwRollback, liveBody, 'utf8'); }
  ok('pre-hash accepted: ' + sha(liveBody).slice(0, 32));
  ok('rollback: ' + gwRollback);

  // The structural hash §9 asks for: names, types, versions, error routing and the graph.
  const structural = (wf) => sha({
    n: wf.nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null, n.alwaysOutputData || null]).sort(),
    c: wf.connections
  });
  const baseline = JSON.parse(readFileSync(gwRollback, 'utf8'));
  say('      structural before : ' + structural(baseline).slice(0, 32));
  say('      structural after  : ' + structural(gwCandidate).slice(0, 32));

  // Carry the tenant's webhook id.
  const liveHook = gwLive.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const candHook = gwCandidate.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (JSON.stringify(liveHook.parameters) !== JSON.stringify(candHook.parameters)) { die('the Gateway route changed'); }
  if (liveHook.webhookId) { candHook.webhookId = liveHook.webhookId; }
  ok('route unchanged: POST /' + candHook.parameters.path);

  // THE EXACT INTENDED DIFF, measured against the pre-pass snapshot.
  const beforeNames = baseline.nodes.map((n) => n.name);
  const afterNames = gwCandidate.nodes.map((n) => n.name);
  const added = afterNames.filter((n) => beforeNames.indexOf(n) === -1).sort();
  const removed = beforeNames.filter((n) => afterNames.indexOf(n) === -1);
  if (added.join(',') !== GATEWAY_NEW.slice().sort().join(',')) { die('unexpected new Gateway nodes: ' + added.join(', ')); }
  if (removed.length) { die('the Gateway loses nodes: ' + removed.join(', ')); }
  ok('+' + added.length + ' nodes (' + added.join(', ') + ')');

  const behaviour3 = (n) => { const c = JSON.parse(JSON.stringify(n)); delete c.position; delete c.webhookId; return JSON.stringify(c); };
  const changed3 = afterNames.filter((n) => {
    const was = baseline.nodes.find((x) => x.name === n);
    return was && behaviour3(was) !== behaviour3(gwCandidate.nodes.find((x) => x.name === n));
  });
  for (const c of changed3) { if (GATEWAY_REWRITTEN.indexOf(c) === -1) { die('UNDECLARED Gateway change to ' + c); } }
  ok('rewritten: ' + (changed3.length ? changed3.join(', ') : 'nothing'));

  // THE FROZEN HALF. Verification, freshness, the claim and the mint are byte-identical.
  for (const name of GATEWAY_FROZEN) {
    const was = baseline.nodes.find((x) => x.name === name);
    const now = gwCandidate.nodes.find((x) => x.name === name);
    if (!was || !now) { die('the Gateway lost ' + name); }
    if (behaviour3(was) !== behaviour3(now)) { die(name + ' CHANGED — it is part of the frozen G5 half'); }
  }
  ok('frozen: ' + GATEWAY_FROZEN.length + ' nodes byte-identical (verification, freshness, claim, mint)');

  // And the invariants restated on the candidate itself.
  const gj = JSON.stringify(gwCandidate);
  const claim = gwCandidate.nodes.find((n) => n.name === 'G5 Replay Claim');
  if (!/on conflict \(replay_key\) do nothing/i.test(String(claim.parameters.query))) { die('the atomic claim is gone'); }
  if (!/as claimed/i.test(String(claim.parameters.query))) { die('the claim verdict column is gone'); }
  if (claim.onError !== 'continueErrorOutput') { die('the store-outage branch is gone'); }
  if (claim.alwaysOutputData) { die('the P9-R2 pair reappeared on the claim'); }
  const cred = gwCandidate.nodes.filter((n) => n.credentials);
  if (cred.length !== 1 || cred[0].name !== 'G5 Replay Claim') { die('the credential moved or multiplied'); }
  if (gj.indexOf('MAX_AUTH_AGE_SECONDS = 900') === -1) { die('Telegram freshness changed'); }
  if (gj.indexOf('TTL_SECONDS = 259200') === -1) { die('the 72 h TTL changed'); }
  if (gwCandidate.settings.saveDataSuccessExecution !== 'none' || gwCandidate.settings.saveDataErrorExecution !== 'none') {
    die('retention is on; raw initData would be persisted');
  }
  if (gj.indexOf('googleSheets') !== -1 || gj.indexOf('executeWorkflow') !== -1) { die('the Gateway reaches further than it did'); }
  ok('G5 claim, freshness, TTL, single credential and zero retention all intact');

  for (const n of gwCandidate.nodes) {
    const js = (n.parameters && n.parameters.jsCode) || '';
    if (js) { try { new Function(js); } catch (e) { die('Gateway node ' + n.name + ' does not parse: ' + e.message); } }
  }
  ok('every Gateway Code node parses');
}
say('');

// ── 3b. the session endpoint ───────────────────────────────────────────────────────────────────
say('STEP 3b — session endpoint (' + SESSION_ID + ')');
const sessionLive = await api('GET', '/workflows/' + SESSION_ID);
const sessionRollback = join(OUT_DIR, SESSION_ID + '.pre-empty-read.json');
const sessionDeployed = join(OUT_DIR, SESSION_ID + '.deployed-empty-read.json');
const sessionCandidate = M.resolveEndpoint(
  JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-session-endpoint-candidate.json'), 'utf8')),
  { ownerId: OWNER_ID, leadIntakeId: LEAD_INTAKE_ID, privacyCredId: PRIVACY_CRED.id }
);
{
  const liveBody = body(sessionLive);
  const known = [sessionRollback, sessionDeployed].filter(existsSync).map((f) => sha(readFileSync(f, 'utf8')));
  if (known.length && known.indexOf(sha(liveBody)) === -1) {
    die('the session endpoint is in a state this script did not create — someone edited it.');
  }
  if (!existsSync(sessionRollback)) { writeFileSync(sessionRollback, liveBody, 'utf8'); }
  ok('pre-hash accepted: ' + sha(liveBody).slice(0, 32));
  ok('rollback: ' + sessionRollback);

  // Carry the tenant's webhook id, as for submit.
  const liveHook = sessionLive.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const candHook = sessionCandidate.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (JSON.stringify(liveHook.parameters) !== JSON.stringify(candHook.parameters)) { die('the session webhook route changed'); }
  if (liveHook.webhookId) { candHook.webhookId = liveHook.webhookId; }

  if (sessionCandidate.nodes.length !== sessionLive.nodes.length) { die('the session endpoint changes node count'); }
  if (JSON.stringify(sessionCandidate.connections) !== JSON.stringify(sessionLive.connections)) { die('the session graph moved'); }
  if (JSON.stringify(sessionCandidate.settings || {}) !== JSON.stringify(sessionLive.settings || {})) { die('session settings changed'); }

  const behaviour2 = (n) => { const c = JSON.parse(JSON.stringify(n)); delete c.position; delete c.webhookId; return JSON.stringify(c); };
  const baseline2 = existsSync(sessionRollback) ? JSON.parse(readFileSync(sessionRollback, 'utf8')) : sessionLive;
  const changed2 = sessionCandidate.nodes.filter((n) => {
    const was = baseline2.nodes.find((x) => x.name === n.name);
    return was && behaviour2(was) !== behaviour2(n);
  }).map((n) => n.name);
  for (const c of changed2) { if (SESSION_REWRITTEN.indexOf(c) === -1) { die('UNDECLARED change to ' + c); } }
  ok('rewritten vs snapshot: ' + (changed2.length ? changed2.join(', ') : 'nothing — already current'));

  const j = JSON.stringify(sessionCandidate);
  if (j.indexOf('NOT_AUTHORISED') === -1) { die('the session owner gate is gone'); }
  if (j.indexOf('lead_id') !== -1) { die('the draft endpoint mentions a lead'); }
  if (/__[A-Z_]{4,}__/.test(j)) { die('an unresolved placeholder would reach the tenant'); }
  ok('owner gate present; the draft endpoint still mentions no lead');
}
say('');

// ── 4. write ───────────────────────────────────────────────────────────────────────────────────
say('STEP 4 — ' + (DRY ? 'write (SKIPPED: dry run)' : 'write, each read back before the next'));
if (DRY) {
  ok('dry run complete — re-run with --confirm to deploy');
  say('');
} else {
  // Order matters: the endpoints first, the host last. The host is the only artifact a human
  // reaches, so if an endpoint write fails nobody is looking at a client pointed at a half-
  // deployed backend.
  for (const [id, label, cand, rec] of [
    [GATEWAY_ID, 'Gateway', gwCandidate, gwDeployed],
    [SESSION_ID, 'session endpoint', sessionCandidate, sessionDeployed],
    [SUBMIT_ID, 'submit endpoint', submitCandidate, submitDeployed],
    [HOST_ID, 'Mini App host', hostCandidate, hostDeployed]
  ]) {
    await api('PUT', '/workflows/' + id, importable(cand));
    const after = await api('GET', '/workflows/' + id);
    const drop = (w) => JSON.stringify(importable(w).nodes.map((n) => { const c = Object.assign({}, n); delete c.webhookId; return c; }));
    if (drop(after) !== drop(cand)) { die(label + ': the deployed workflow does not match what was sent — ROLLBACK'); }
    writeFileSync(rec, body(after), 'utf8');
    ok(label + ': written and read back, sha ' + sha(body(after)).slice(0, 16) + ', active ' + after.active);
  }
  say('');
  say('DONE.');
  say('  rollback host    : ' + hostRollback);
  say('  rollback submit  : ' + submitRollback);
  say('  rollback session : ' + sessionRollback);
  say('  rollback gateway : ' + gwRollback);
  say('');
}
