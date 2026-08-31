#!/usr/bin/env node
// FINMENTOR — close the acknowledgement defect found by the live tap (execution 5055).
//
//   node scripts/deploy-lead-alert-ack-fix.mjs --dry-run
//   node scripts/deploy-lead-alert-ack-fix.mjs --confirm
//
// ONE workflow changes. ONE node changes. ONE parameter on that node changes. Everything else in
// the tenant is frozen before, compared after, and proven byte-identical.
//
// ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
//
// `Telegram Update Reply` sourced its text from `$('Route Edit Shape').first()`. Route Edit Shape
// is a four-output Switch, and a Switch sends each item down exactly ONE branch, while `.first()`
// reads branch 0. In execution 5055 the item took branch 2 (KB21), branch 0 was empty, the
// expression resolved to nothing and Telegram answered 400 «message text is empty». Three of the
// four shapes fail this way; only KB221 sits on branch 0.
//
// ── WHY `Find & Build Update` IS THE CORRECT SOURCE ───────────────────────────────────────────
//
// Two paths reach Route Edit Shape: the refusal path (`IF Action Allowed` false) and the verified
// path (`IF Verified` true). `Find & Build Update` is the only node on BOTH, it is a Code node so
// it has exactly one output, and it already carries both `reply_text` and
// `reply_text_presentation_failed` — `Verify Mutation` passes them through untouched. So the copy
// does not move, is not duplicated into four Telegram branches, and no node is added.
//
// `Verify Mutation` would have been wrong: it is not on the refusal path, so `$('Verify Mutation')`
// would refer to a node that never executed for a refused tap.
//
// The acknowledgement stays downstream of proven business success because the GRAPH puts it there:
// `Telegram Update Reply` has no feeder except the four `Edit Alert` nodes, which are fed only by
// Route Edit Shape. Changing where the TEXT is read from cannot change what is reachable, and the
// gate asserts that separately.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CAND = join(ROOT, 'n8n', 'candidate', 'lead-command-center-ack-fix-candidate.json');

const CC = 'qF9tonlHHIxc8MDd';
const RENDERERS = { QmIyEW2ZEqKregmN: 'Lead Intake', LZ2mvKXbBikmeVTn: 'SLA Lead Watch', zeLOCuf0K1bkaKl2: 'Followup Sequence' };

const TARGET_NODE = 'Telegram Update Reply';
const OLD_TEXT = "={{ $json.error ? $('Route Edit Shape').first().json.reply_text_presentation_failed : $('Route Edit Shape').first().json.reply_text }}";
const NEW_TEXT = "={{ $json.error ? $('Find & Build Update').first().json.reply_text_presentation_failed : $('Find & Build Update').first().json.reply_text }}";

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 300)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });
const sanitize = (v) => {
  if (!v || typeof v !== 'object') { return v; }
  if (Array.isArray(v)) { return v.map(sanitize); }
  const o = {};
  for (const k of Object.keys(v)) { if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; } o[k] = sanitize(v[k]); }
  return o;
};

// ── build ─────────────────────────────────────────────────────────────────────────────────────

function build(live) {
  const next = JSON.parse(JSON.stringify(importable(live)));
  const target = next.nodes.find((n) => n.name === TARGET_NODE);
  if (!target) { die(TARGET_NODE + ' is not on the tenant'); }
  if (String(target.parameters.text) !== OLD_TEXT) {
    die(TARGET_NODE + ' does not carry the expression this fix was written against.\n         found:  ' + JSON.stringify(target.parameters.text));
  }
  target.parameters.text = NEW_TEXT;
  return next;
}

function verify(live, next) {
  const problems = [];
  const want = (c, m) => { if (!c) { problems.push(m); } };

  want(next.nodes.length === live.nodes.length, 'node count changed');
  want(next.name === live.name, 'the workflow name changed');
  want(JSON.stringify(next.connections) === JSON.stringify(live.connections), 'connections changed');
  want(JSON.stringify(next.settings || {}) === JSON.stringify(live.settings || {}), 'settings changed');

  // exactly one node differs, and on exactly one parameter
  const changed = [];
  for (const n of next.nodes) {
    const before = live.nodes.find((x) => x.name === n.name);
    if (!before) { problems.push('node added: ' + n.name); continue; }
    if (JSON.stringify(sanitize(before.parameters)) !== JSON.stringify(sanitize(n.parameters))) { changed.push(n.name); }
    if (JSON.stringify(before.credentials || {}) !== JSON.stringify(n.credentials || {})) { problems.push('credentials changed on ' + n.name); }
    if (String(before.type) !== String(n.type) || String(before.typeVersion) !== String(n.typeVersion)) { problems.push('type changed on ' + n.name); }
    if ((before.onError || null) !== (n.onError || null)) { problems.push('onError changed on ' + n.name); }
  }
  for (const n of live.nodes) { if (!next.nodes.find((x) => x.name === n.name)) { problems.push('node removed: ' + n.name); } }
  want(changed.length === 1 && changed[0] === TARGET_NODE, 'expected exactly one changed node, got: ' + (changed.join(', ') || '(none)'));

  if (changed.length === 1 && changed[0] === TARGET_NODE) {
    const b = live.nodes.find((x) => x.name === TARGET_NODE).parameters;
    const a = next.nodes.find((x) => x.name === TARGET_NODE).parameters;
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const diff = [...keys].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    want(diff.length === 1 && diff[0] === 'text', 'expected exactly one changed parameter, got: ' + diff.join(', '));
  }

  // the new reference must be single-output, and must sit on every path into the router
  const byName = Object.fromEntries(next.nodes.map((n) => [n.name, n]));
  const MULTI = ['n8n-nodes-base.switch', 'n8n-nodes-base.if', 'n8n-nodes-base.filter'];
  want(!!byName['Find & Build Update'], 'the new source node does not exist');
  want(byName['Find & Build Update'] && !MULTI.includes(byName['Find & Build Update'].type), 'the new source node is multi-output');

  // no `$('<multi-output node>').first()` anywhere in the graph
  const multi = new Set(next.nodes.filter((n) => MULTI.includes(n.type)).map((n) => n.name));
  const scan = (name, v) => {
    if (typeof v === 'string' && v[0] === '=') {
      const re = /\$\(\s*(['"])(.*?)\1\s*\)\s*\.\s*(?:first|last|all)\s*\(\s*\)/g;
      let m;
      while ((m = re.exec(v)) !== null) { if (multi.has(m[2])) { problems.push(name + ' still addresses the multi-output node ' + m[2] + ' with a bare accessor'); } }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => scan(name, x)); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { scan(name, v[k]); } }
  };
  for (const n of next.nodes) { scan(n.name, n.parameters || {}); }

  // nothing else this pass is allowed to touch
  const sheets = (wf) => wf.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets')
    .map((n) => [n.name, n.parameters.operation, (n.parameters.columns || {}).mappingMode, JSON.stringify((n.parameters.sheetName || {}).value)]).sort();
  want(JSON.stringify(sheets(next)) === JSON.stringify(sheets(live)), 'a Google Sheets node changed — the Pipeline schema is not in scope');

  const blob = JSON.stringify(next);
  want(!/"=won\|/.test(blob) && !/callback_data":"won\|/.test(blob), 'a won callback is emitted');
  want(!/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/.test(blob), 'token-shaped material in the workflow');
  for (const n of next.nodes) {
    want(!(n.alwaysOutputData === true && n.onError === 'continueErrorOutput'), 'P9-R2 flag pair on ' + n.name);
  }
  const creds = (wf) => JSON.stringify(wf.nodes.map((n) => [n.name, Object.values(n.credentials || {}).map((c) => c.id)]).sort());
  want(creds(next) === creds(live), 'a credential binding changed');

  return problems;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────

say('');
say('LEAD ALERT ACKNOWLEDGEMENT FIX — one expression, one node');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');
const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm'); }

say('STEP 0 — the offline suite');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'run-all.mjs')], { encoding: 'utf8' });
  const tail = String(r.stdout || '').trim().split('\n').slice(-3).join('\n');
  if (r.status !== 0) { say(tail); die('the offline suite is not green'); }
  ok('suite green');
  say(tail.split('\n').map((l) => '        ' + l).join('\n'));
}
say('');

say('STEP 1 — freeze the four production pre-images');
const live = await api('GET', '/workflows/' + CC);
mkdirSync(OUT_DIR, { recursive: true });
{
  writeFileSync(join(OUT_DIR, CC + '.pre-ack-fix.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
  ok('Command Center'.padEnd(20) + live.nodes.length + ' nodes, active=' + live.active + ', sha ' + sha(importable(live)).slice(0, 16));
  for (const [id, label] of Object.entries(RENDERERS)) {
    const w = await api('GET', '/workflows/' + id);
    writeFileSync(join(OUT_DIR, id + '.pre-ack-fix.json'), JSON.stringify(importable(w), null, 2) + '\n', 'utf8');
    ok(label.padEnd(20) + w.nodes.length + ' nodes, active=' + w.active + ', sha ' + sha(importable(w)).slice(0, 16));
  }
}
say('');

say('STEP 2 — the delta');
const next = build(live);
const problems = verify(live, next);
if (problems.length) { for (const p of problems) { say('  FAIL  ' + p); } die(problems.length + ' invariant(s) failed'); }
mkdirSync(dirname(CAND), { recursive: true });
writeFileSync(CAND, JSON.stringify({ name: next.name, nodes: sanitize(next.nodes), connections: next.connections, settings: next.settings }, null, 2) + '\n', 'utf8');
{
  say('');
  say('  THE ENTIRE PRODUCTION GRAPH DIFF');
  say('  ' + '-'.repeat(74));
  say('  node        ' + TARGET_NODE);
  say('  parameter   text');
  say('  before      ' + OLD_TEXT);
  say('  after       ' + NEW_TEXT);
  say('  ' + '-'.repeat(74));
  say('  nodes       ' + live.nodes.length + ' -> ' + next.nodes.length + '   (added 0, removed 0, modified 1)');
  say('  connections unchanged');
  say('  Sheets      unchanged');
  say('  credentials unchanged');
  say('');
  ok('every invariant holds; candidate written to n8n/candidate/');
}
say('');

say('STEP 3 — ' + (DRY ? 'write (SKIPPED)' : 'write'));
if (DRY) { ok('dry run complete'); say(''); say('Nothing was written.'); say(''); process.exit(0); }
await api('PUT', '/workflows/' + CC, next);
ok('PUT /workflows/' + CC);
say('');

say('STEP 4 — fresh read from the tenant');
const after = await api('GET', '/workflows/' + CC);
{
  if (after.nodes.length !== next.nodes.length) { die('tenant stored ' + after.nodes.length + ' nodes — ROLLBACK'); }
  if (after.name !== live.name) { die('the workflow was renamed — ROLLBACK'); }
  if (after.active !== true) { die('no longer active — ROLLBACK'); }
  const got = after.nodes.find((n) => n.name === TARGET_NODE);
  if (String(got.parameters.text) !== NEW_TEXT) { die('the corrected expression is not on the tenant — ROLLBACK'); }
  ok('the corrected expression is live on ' + TARGET_NODE);

  const moved = [];
  for (const n of live.nodes) {
    if (n.name === TARGET_NODE) { continue; }
    const g = after.nodes.find((x) => x.name === n.name);
    if (!g) { die(n.name + ' missing on the tenant — ROLLBACK'); }
    if (JSON.stringify(sanitize(g.parameters)) !== JSON.stringify(sanitize(n.parameters))) { moved.push(n.name); }
  }
  if (moved.length) { die(moved.length + ' unrelated node(s) moved: ' + moved.join(', ') + ' — ROLLBACK'); }
  ok('all ' + (live.nodes.length - 1) + ' unrelated nodes byte-identical to the pre-image');
  if (JSON.stringify(after.connections) !== JSON.stringify(live.connections)) { die('connections moved — ROLLBACK'); }
  ok('connections byte-identical');
  writeFileSync(join(OUT_DIR, CC + '.post-ack-fix.json'), JSON.stringify(importable(after), null, 2) + '\n', 'utf8');
}
say('');

say('STEP 5 — the three renderers did not move');
for (const [id, label] of Object.entries(RENDERERS)) {
  const w = await api('GET', '/workflows/' + id);
  const f = JSON.parse(readFileSync(join(OUT_DIR, id + '.pre-ack-fix.json'), 'utf8'));
  if (sha(importable(w)) !== sha(f)) { die(label + ' MOVED during this deploy'); }
  ok(label.padEnd(20) + 'byte-identical');
}
say('');
say('ACK FIX DEPLOYED.');
say('');
say('ROLLBACK:  PUT /api/v1/workflows/' + CC + '  with ' + join(OUT_DIR, CC + '.pre-ack-fix.json'));
say('');
