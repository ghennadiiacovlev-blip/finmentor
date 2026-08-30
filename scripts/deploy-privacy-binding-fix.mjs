#!/usr/bin/env node
// FINMENTOR — deploy the privacy parameter binding fix.
//
//   node scripts/deploy-privacy-binding-fix.mjs --dry-run
//   node scripts/deploy-privacy-binding-fix.mjs --confirm
//
// ONE WORKFLOW, TWO NODES, AND NOTHING ELSE.
//
//   ELiPdw4mdxQbBaan  the submit endpoint
//     · Write Privacy Acknowledgement  parameters.options.queryReplacement  {} -> the 7 bindings
//     · Privacy Verdict                jsCode  classify json.message, not json.error alone
//
// ── WHY TWO AND NOT ONE ───────────────────────────────────────────────────────────────────────
//
// The first is the proven root cause: the INSERT declares $1..$7 and options carried nothing, so
// Postgres refused the statement with 42P02 before the transaction began.
//
// The second is what the FIRST one exposes. Until now the privacy INSERT had never once reached
// the unique index, so the duplicate path had never run against a real node. On a disposable table
// with the same node type and typeVersion, a unique violation arrives as
//
//     json.message = 'duplicate key value violates unique constraint "..."'
//     json.error   = a NodeOperationError whose own keys are level, shouldReport, description,
//                    tags, timestamp, context, functionality, name, node, messages
//
// and the verdict tested json.error ALONE. Neither 23505 nor "duplicate key" nor the index name is
// anywhere in that object, so a genuine duplicate scored created=0 already=0 and fell through to
// PRIVACY_UNRESOLVED. That is the retry path: fixing only the binding would make the FIRST retry
// work and strand every later one. Shipping the binding without this is shipping a known trap.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. The offline suite must pass first, in full.
//   2. The live workflow must differ from the candidate in EXACTLY the two declared nodes.
//   3. Within those nodes, only the declared fields may differ.
//   4. Connections, settings, the node set, the webhook route and the credential must be identical.
//   5. No placeholder may reach the tenant, and no literal identity may reach the repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const SUBMIT_ID = 'ELiPdw4mdxQbBaan';
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const PRIVACY_CRED = { id: 'Jsfozg8CsclIdCRo', name: 'FINMENTOR Privacy Audit Writer' };

const PRIVACY_WRITE = 'Write Privacy Acknowledgement';
const PRIVACY_VERDICT = 'Privacy Verdict';

const CONFIRM = process.argv.indexOf('--confirm') !== -1;
const say = (m) => console.log(m);
const ok = (m) => console.log('  ok    ' + m);
const die = (m) => { console.error('  FAIL  ' + m); process.exit(1); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY || '';
if (!BASE || !KEY) { die('N8N_BASE_URL and N8N_FIX_API_KEY must be set'); }

async function api(method, path, body) {
  const r = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  if (!r.ok) { die(method + ' ' + path + ' -> ' + r.status + ' ' + t.slice(0, 300)); }
  return t ? JSON.parse(t) : null;
}

say('\nFINMENTOR — privacy parameter binding fix\n');

// ── 0. the gates ───────────────────────────────────────────────────────────────────────────────
say('STEP 0 — the offline suite');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'run-all.mjs')], { encoding: 'utf8' });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const m = out.match(/(\d+)\/(\d+) gates passed/g);
  if (!m) { die('could not read the gate tally'); }
  const last = m[m.length - 1];
  const parts = last.match(/(\d+)\/(\d+)/);
  if (parts[1] !== parts[2]) { die('the suite is not green: ' + last); }
  if (r.status !== 0) { die('the suite exited non-zero'); }
  const a = out.match(/TOTAL ASSERTIONS: (\d+)/);
  ok(last + (a ? ', ' + a[1] + ' assertions' : ''));
  if (!/assertion floors: PASS/.test(out)) { die('assertion floors did not pass'); }
  ok('assertion floors: PASS');
}
say('');

// ── 1. the owner identity, from the live tenant ────────────────────────────────────────────────
say('STEP 1 — owner identity, read from the live Concierge');
let OWNER_ID = '';
{
  const c = await api('GET', '/workflows/' + CONCIERGE_ID);
  const st = c.nodes.find((n) => n.name === 'Settings to Object');
  const m = String((st && st.parameters.jsCode) || '').match(/owner_chat_id:\s*settings\.owner_chat_id\s*\|\|\s*'(\d+)'/);
  if (!m) { die('could not read owner_chat_id from the live Concierge'); }
  OWNER_ID = m[1];
  ok('owner identity resolved from the live workflow (value withheld from this log)');
}
say('');

// ── 2. the live workflow, read fresh ───────────────────────────────────────────────────────────
say('STEP 2 — the live submit endpoint (' + SUBMIT_ID + ')');
const live = await api('GET', '/workflows/' + SUBMIT_ID);
const liveBody = JSON.stringify({ nodes: live.nodes, connections: live.connections, settings: live.settings });
ok('live structural hash: ' + sha(liveBody).slice(0, 32));
{
  const pw = live.nodes.find((n) => n.name === PRIVACY_WRITE);
  if (!pw) { die('the live workflow has no ' + PRIVACY_WRITE); }
  const qr = (pw.parameters.options || {}).queryReplacement;
  if (qr !== undefined) { die('the live node ALREADY has a queryReplacement — this is not the state this fix expects'); }
  ok('confirmed the live defect is still present: options carries no queryReplacement');
}
say('');

// ── 3. the candidate ───────────────────────────────────────────────────────────────────────────
say('STEP 3 — the resolved candidate');
const M = await import('./build-premium-endpoints.mjs');
const cand = M.resolveEndpoint(
  JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-submit-endpoint-candidate.json'), 'utf8')),
  { ownerId: OWNER_ID, leadIntakeId: LEAD_INTAKE_ID, privacyCredId: PRIVACY_CRED.id }
);
{
  const pg = cand.nodes.find((n) => n.type === 'n8n-nodes-base.postgres');
  if (!pg) { die('the candidate has no privacy write'); }
  pg.credentials = { postgres: PRIVACY_CRED };
  if (/on conflict/i.test(JSON.stringify(pg.parameters))) { die('the insert uses ON CONFLICT; the writer role cannot execute it'); }
  if (JSON.stringify(pg.parameters).indexOf('privacy.privacy_acknowledgements') === -1) { die('the insert does not target the privacy schema'); }
  ok('privacy credential attached; still a plain INSERT into the privacy schema');

  const liveHook = live.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  const candHook = cand.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (JSON.stringify(liveHook.parameters) !== JSON.stringify(candHook.parameters)) { die('the webhook route or mode changed'); }
  candHook.webhookId = liveHook.webhookId;
  ok('webhook route, method and mode unchanged; the tenant webhookId carried across');

  if (/__[A-Z_]+__/.test(JSON.stringify(cand))) { die('a placeholder survived resolution'); }
  ok('no placeholder reaches the tenant');
}
say('');

// ── 4. the diff, and the refusal ───────────────────────────────────────────────────────────────
say('STEP 4 — exactly two nodes may differ');
{
  const liveNames = live.nodes.map((n) => n.name).sort();
  const candNames = cand.nodes.map((n) => n.name).sort();
  if (JSON.stringify(liveNames) !== JSON.stringify(candNames)) { die('the node SET changed; this fix adds and removes nothing'); }
  ok('node set identical (' + liveNames.length + ' nodes)');

  if (JSON.stringify(live.connections) !== JSON.stringify(cand.connections)) { die('connections changed'); }
  ok('connections byte-identical');

  if (JSON.stringify(live.settings) !== JSON.stringify(cand.settings)) { die('settings changed'); }
  ok('settings byte-identical (retention still off)');

  const differing = [];
  for (const c of cand.nodes) {
    const l = live.nodes.find((n) => n.name === c.name);
    const strip = (n) => JSON.stringify(Object.assign({}, n, { id: undefined }));
    if (strip(l) !== strip(c)) { differing.push(c.name); }
  }
  const want = [PRIVACY_WRITE, PRIVACY_VERDICT].sort();
  if (JSON.stringify(differing.sort()) !== JSON.stringify(want)) {
    die('expected exactly ' + want.join(' + ') + ' to differ, got: ' + (differing.length ? differing.join(', ') : '(nothing)'));
  }
  ok('exactly the two declared nodes differ');

  // and WITHIN them, only the declared fields.
  const lw = live.nodes.find((n) => n.name === PRIVACY_WRITE);
  const cw = cand.nodes.find((n) => n.name === PRIVACY_WRITE);
  if (lw.parameters.query !== cw.parameters.query) { die('the SQL changed; only the binding may change'); }
  if (JSON.stringify(lw.credentials) !== JSON.stringify(cw.credentials)) { die('the privacy credential changed'); }
  if (lw.onError !== cw.onError || Boolean(lw.retryOnFail) !== Boolean(cw.retryOnFail)) { die('the error policy changed'); }
  const qr = cw.parameters.options.queryReplacement;
  const segs = String(qr).split(',');
  if (segs.length !== 7) { die('the binding does not carry 7 segments, it carries ' + segs.length); }
  if (!segs.every((s) => /^=\{\{ \$json\.[a-z_]+ \}\}$/.test(s))) { die('a binding segment is not a bare field expression'); }
  ok('privacy write: SQL, credential and error policy unchanged; 7 bound segments added');

  const lv = live.nodes.find((n) => n.name === PRIVACY_VERDICT);
  const cv = cand.nodes.find((n) => n.name === PRIVACY_VERDICT);
  const only = (a, b) => JSON.stringify(Object.assign({}, a, { parameters: null })) === JSON.stringify(Object.assign({}, b, { parameters: null }));
  if (!only(lv, cv)) { die('the verdict node changed outside its parameters'); }
  const lc = String(lv.parameters.jsCode), cc = String(cv.parameters.jsCode);
  if (lc.replace(/\s+/g, '') === cc.replace(/\s+/g, '')) { die('the verdict jsCode did not actually change'); }
  if (cc.indexOf('PRIVACY_UNRESOLVED') === -1) { die('the verdict lost its fail-closed branch'); }
  if (cc.indexOf('j.message') === -1) { die('the verdict still does not read json.message'); }
  if (!/23505\|duplicate key\|privacy_ack_submission_key_uidx/.test(cc)) { die('the verdict lost its duplicate test'); }
  if (cc.indexOf('already_recorded') === -1) { die('the verdict lost the already_recorded state'); }
  ok('verdict: fail-closed branch, duplicate test and already_recorded all still present');
}
say('');

// ── 5. rollback ────────────────────────────────────────────────────────────────────────────────
say('STEP 5 — rollback');
mkdirSync(OUT_DIR, { recursive: true });
const rollback = join(OUT_DIR, SUBMIT_ID + '.pre-binding-fix.json');
if (!existsSync(rollback)) { writeFileSync(rollback, JSON.stringify(live, null, 2), 'utf8'); }
ok('rollback: ' + rollback);
say('');

if (!CONFIRM) {
  say('DRY RUN — nothing was written. Re-run with --confirm to deploy.\n');
  process.exit(0);
}

// ── 6. write, then read back ───────────────────────────────────────────────────────────────────
say('STEP 6 — write');
await api('PUT', '/workflows/' + SUBMIT_ID, {
  name: live.name, nodes: cand.nodes, connections: cand.connections, settings: cand.settings
});
ok('written');

const after = await api('GET', '/workflows/' + SUBMIT_ID);
{
  const pw = after.nodes.find((n) => n.name === PRIVACY_WRITE);
  const qr = (pw.parameters.options || {}).queryReplacement;
  if (!qr || String(qr).split(',').length !== 7) { die('the deployed node does not carry 7 bindings'); }
  ok('deployed binding: 7 segments');
  if ((String(pw.parameters.query).match(/\$\d/g) || []).length !== 7) { die('the deployed query does not declare 7 placeholders'); }
  ok('deployed query: 7 placeholders — declared and bound now agree');

  const pv = after.nodes.find((n) => n.name === PRIVACY_VERDICT);
  if (String(pv.parameters.jsCode).indexOf('j.message') === -1) { die('the deployed verdict does not read json.message'); }
  ok('deployed verdict reads json.message');

  const differing = [];
  for (const c of cand.nodes) {
    const l = after.nodes.find((n) => n.name === c.name);
    const strip = (n) => JSON.stringify(Object.assign({}, n, { id: undefined, webhookId: undefined }));
    if (strip(l) !== strip(c)) { differing.push(c.name); }
  }
  if (differing.length) { die('the tenant stored something other than the candidate: ' + differing.join(', ')); }
  ok('read-back equals the candidate exactly');
}
say('\nDEPLOYED. Two nodes changed. Nothing else.\n');
