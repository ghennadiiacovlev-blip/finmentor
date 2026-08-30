#!/usr/bin/env node
// FINMENTOR — repair BP/BQ on the ONE real UAT Pipeline row. Two cells, one row, nothing else.
//
//   node scripts/repair-uat-pipeline-row.mjs --dry-run
//   node scripts/repair-uat-pipeline-row.mjs --confirm
//
//   Pipeline row  lead_id = FIN-1788113619104-582  AND  request_id = sub_37643f…
//     BP current_setup     '' -> the authoritative value
//     BQ decision_horizon  '' -> the authoritative value
//     BR important_context '' -> UNTOUCHED (legitimately empty at source)
//
// ── WHY A DISPOSABLE WORKFLOW ──────────────────────────────────────────────────────────────────
//
// The production Sheets credential is domain-restricted: F17 proved it blocks raw
// sheets.googleapis.com from an HTTP Request node, and that control is sound and must not be
// weakened to fix two cells. The Google Sheets NODE is the only path the credential admits, so the
// read and the write each run in a workflow that is created, used once, and deleted. The same
// method as the P10 header migration.
//
// ── THE TWO SOURCES, AND WHY IT REFUSES WITHOUT BOTH ───────────────────────────────────────────
//
//   A  retained Lead Intake execution 4837 — `body.premium`, the payload as delivered
//   B  MiniApp_App_Sessions draft_json — the session that produced this lead, still `submitted`
//      and still carrying the canonical lead id, with each answer `user_explicit`/`confirmed`
//
// B is canonicalised with the Premium UX contract's own rule — an array joins with '; ' — rather
// than with a rule invented here. If A and B disagree on any field, nothing is written: a repair
// that has to pick a winner is a guess, and a guess does not belong in a CRM.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────────────────────────
//
//   1. The row is identified by lead_id AND request_id together. Never by company name.
//   2. Exactly one row may match.
//   3. BP and BQ must currently be empty. If they are not, someone else has been here.
//   4. important_context must be empty in BOTH sources, or it is not the row this script knows.
//   5. The update maps THREE named columns — lead_id, current_setup, decision_horizon — and is
//      `defineBelow`. Never autoMapInputData, which would write every key it was handed and append
//      a header for any it did not find (F16).
//   6. After the write, every other cell must be value-identical to the pre-image.
//   7. Pre- and post-images are written to .uat/ before and after.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const LEAD_ID = 'FIN-1788113619104-582';
const SUBMISSION_KEY = 'sub_37643f0937d982e1c7e8978f82264936';
const EXECUTION_ID = '4837';
const SESSION_TABLE_ID = 'LRme88caqxFzTLqW';
const DOC_ID = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A';
const SHEET_GID = 1883973304;
const SHEETS_CRED = { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' };
const REPAIR_FIELDS = ['current_setup', 'decision_horizon'];

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

async function api(method, path, body, key) {
  const res = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key || (method === 'GET' ? READ_KEY : WRITE_KEY) },
                           body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await res.text();
  if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 300)); }
  return t ? JSON.parse(t) : null;
}

// The contract's own canonicalisation. Not a rule invented here.
const canon = (v) => (v === null || v === undefined) ? '' : (Array.isArray(v) ? v.join('; ') : String(v));

say('');
say('UAT PIPELINE ROW REPAIR — ' + LEAD_ID);
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written to the sheet' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this writes to the production Pipeline; re-run with --confirm (or --dry-run first)'); }

mkdirSync(OUT_DIR, { recursive: true });

// ── 1. source A — the retained execution ───────────────────────────────────────────────────────
say('STEP 1 — source A: retained Lead Intake execution ' + EXECUTION_ID);
const ex = await api('GET', '/executions/' + EXECUTION_ID + '?includeData=true');
const runData = ex.data.resultData.runData;
const outOf = (n) => {
  const r = runData[n] && runData[n][0];
  if (!r) { return null; }
  const items = ((r.data || {}).main || [[]])[0] || [];
  return items[0] ? items[0].json : null;
};
const unwrap = outOf('Internal Envelope Unwrap');
const A = (unwrap && unwrap.body && unwrap.body.premium) || null;
if (!A) { die('execution ' + EXECUTION_ID + ' no longer carries body.premium'); }
const commit = outOf('Commit Verdict (New)') || {};
if (String(commit.lead_id) !== LEAD_ID) { die('execution ' + EXECUTION_ID + ' committed ' + commit.lead_id + ', not ' + LEAD_ID); }
if (String(commit.request_id) !== SUBMISSION_KEY) { die('execution ' + EXECUTION_ID + ' carries a different submission key'); }
ok('execution ' + EXECUTION_ID + ' committed ' + LEAD_ID + ' under ' + SUBMISSION_KEY.slice(0, 16) + '…');
for (const f of REPAIR_FIELDS) { say('        A.' + f.padEnd(18) + '= ' + JSON.stringify(A[f])); }
say('        A.important_context = ' + JSON.stringify(A.important_context));
say('');

// ── 2. source B — the submitted session draft ──────────────────────────────────────────────────
say('STEP 2 — source B: the submitted Mini App session draft');
const rows = (await api('GET', '/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data || [];
const session = rows.find((r) => String(r.lead_id) === LEAD_ID);
if (!session) { die('no MiniApp_App_Sessions row carries ' + LEAD_ID); }
if (String(session.state) !== 'submitted') { die('the session is in state ' + session.state + ', not submitted'); }
const draft = JSON.parse(session.draft_json || '{}');
const B = {};
for (const f of REPAIR_FIELDS.concat(['important_context'])) {
  const e = (draft.fields || {})[f] || {};
  B[f] = canon(e.value);
  if (f !== 'important_context') {
    if (e.confirmed !== true) { die('source B: ' + f + ' is not confirmed'); }
    if (e.source !== 'user_explicit') { die('source B: ' + f + ' is ' + e.source + ', not user_explicit'); }
  }
}
ok('session ' + String(session.app_session_id).slice(0, 20) + '… is submitted and carries ' + LEAD_ID);
for (const f of REPAIR_FIELDS) { say('        B.' + f.padEnd(18) + '= ' + JSON.stringify(B[f])); }
say('        B.important_context = ' + JSON.stringify(B.important_context));
say('');

// ── 3. the two sources must agree ──────────────────────────────────────────────────────────────
say('STEP 3 — the two sources must agree, field by field');
const REPAIR = {};
for (const f of REPAIR_FIELDS) {
  if (canon(A[f]) !== B[f]) { die('sources DISAGREE on ' + f + ': A=' + JSON.stringify(A[f]) + ' B=' + JSON.stringify(B[f])); }
  if (!canon(A[f])) { die(f + ' is empty in both sources — there is nothing to repair'); }
  REPAIR[f] = canon(A[f]);
  ok(f + ': both sources agree');
}
if (canon(A.important_context) !== '' || B.important_context !== '') {
  die('important_context is NOT empty in both sources — this script only repairs a row whose BR is legitimately empty');
}
ok('important_context is empty in both sources — BR stays untouched');
say('');

// ── 4. the disposable reader ───────────────────────────────────────────────────────────────────
const created = [];
// Deletion is retried and VERIFIED. A first run swallowed the errors and left two disposable
// readers on the tenant: deactivate had returned 200 and the delete that followed it had not
// landed, and nothing said so. A cleanup that cannot fail loudly is not a cleanup.
const cleanup = async () => {
  const ids = created.splice(0);
  for (const id of ids) {
    for (let i = 0; i < 4; i++) {
      await api('POST', '/workflows/' + id + '/deactivate').catch(() => {});
      const gone = await api('DELETE', '/workflows/' + id).then(() => true).catch(() => false);
      if (gone) { break; }
      await sleep(1500);
    }
    const still = await api('GET', '/workflows/' + id).then(() => true).catch(() => false);
    if (still) { console.error('  WARN  disposable workflow ' + id + ' could NOT be deleted — remove it by hand'); }
  }
};
process.on('exit', () => { if (created.length) { console.error('WARNING: disposable workflows left behind: ' + created.join(', ')); } });

const sheetsNode = (name, params, pos) => ({
  parameters: Object.assign({
    documentId: { __rl: true, value: DOC_ID, mode: 'list' },
    sheetName: { __rl: true, value: SHEET_GID, mode: 'list' }
  }, params),
  id: 'n-' + name.replace(/\W/g, ''), name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7,
  position: pos, credentials: { googleSheetsOAuth2Api: SHEETS_CRED }
});

async function runDisposable(name, path, nodes, connections) {
  const wf = await api('POST', '/workflows', { name, nodes, connections, settings: {} });
  created.push(wf.id);
  await api('POST', '/workflows/' + wf.id + '/activate');
  await sleep(2500);
  let last = null;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(BASE + '/webhook/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const t = await r.text();
    if (r.ok) { try { return JSON.parse(t); } catch (e) { return { __raw: t }; } }
    last = r.status + ' ' + t.slice(0, 200);
    await sleep(2000);
  }
  throw new Error('disposable ' + name + ' did not answer: ' + last);
}

const readerNodes = (path) => ([
  { parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', options: {} },
    id: 'n-wh', name: 'WH', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
  sheetsNode('Read Row', {
    filtersUI: { values: [{ lookupColumn: 'lead_id', lookupValue: LEAD_ID }] },
    options: {}
  }, [240, 0])
]);
const readerConns = { WH: { main: [[{ node: 'Read Row', type: 'main', index: 0 }]] } };

say('STEP 4 — pre-image, read through a disposable Sheets reader');
const readPath = 'zz-uat-row-read-' + crypto.randomBytes(4).toString('hex');
let pre = null;
try {
  const out = await runDisposable('ZZ UAT ROW READ', readPath, readerNodes(readPath), readerConns);
  const list = Array.isArray(out) ? out : [out];
  const matches = list.filter((r) => r && String(r.lead_id) === LEAD_ID);
  if (matches.length !== 1) { throw new Error('expected exactly 1 matching row, got ' + matches.length); }
  pre = matches[0];
} catch (e) { await cleanup(); die('could not read the row: ' + e.message); }
await cleanup();

ok('exactly one row matches lead_id ' + LEAD_ID);
if (String(pre.request_id) !== SUBMISSION_KEY) {
  die('the row carries request_id ' + JSON.stringify(pre.request_id) + ', not the submission key — WRONG ROW');
}
ok('and its request_id is the submission key — identity confirmed on two fields');
for (const f of REPAIR_FIELDS) {
  if (String(pre[f] || '') !== '') { die(f + ' is already ' + JSON.stringify(pre[f]) + ' — someone else has been here; not overwriting'); }
}
ok('BP and BQ are both empty, as expected');
if (String(pre.important_context || '') !== '') { die('BR is not empty on the row — this is not the row this script knows'); }
ok('BR is empty and will not be written');
const prePath = join(OUT_DIR, 'pipeline-row-' + LEAD_ID + '.pre-repair.json');
writeFileSync(prePath, JSON.stringify(pre, null, 2) + '\n', 'utf8');
ok('pre-image: ' + prePath + '  (' + Object.keys(pre).length + ' columns, sha ' + sha(pre).slice(0, 16) + ')');
say('');

if (DRY) {
  say('DRY RUN — the write below was NOT performed.');
  say('  would set current_setup    = ' + JSON.stringify(REPAIR.current_setup));
  say('  would set decision_horizon = ' + JSON.stringify(REPAIR.decision_horizon));
  say('  would leave every other cell untouched, including important_context.');
  say('');
  process.exit(0);
}

// ── 5. the disposable writer ───────────────────────────────────────────────────────────────────
say('STEP 5 — the write: three named columns, defineBelow, matched on lead_id');
const writePath = 'zz-uat-row-write-' + crypto.randomBytes(4).toString('hex');
const writerNodes = [
  { parameters: { httpMethod: 'POST', path: writePath, responseMode: 'lastNode', options: {} },
    id: 'n-wh', name: 'WH', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
  sheetsNode('Repair Row', {
    operation: 'update',
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: ['lead_id'],
      value: {
        lead_id: LEAD_ID,
        current_setup: REPAIR.current_setup,
        decision_horizon: REPAIR.decision_horizon
      }
    },
    options: {}
  }, [240, 0])
];
try {
  await runDisposable('ZZ UAT ROW REPAIR', writePath, writerNodes,
    { WH: { main: [[{ node: 'Repair Row', type: 'main', index: 0 }]] } });
  ok('the update ran');
} catch (e) { await cleanup(); die('the repair write failed: ' + e.message + ' — the row is unchanged unless the post-image says otherwise'); }
await cleanup();
say('');

// ── 6. post-image, and the cell-by-cell comparison ─────────────────────────────────────────────
say('STEP 6 — post-image, and every other cell');
const readPath2 = 'zz-uat-row-read-' + crypto.randomBytes(4).toString('hex');
let post = null;
try {
  const out = await runDisposable('ZZ UAT ROW READ', readPath2, readerNodes(readPath2), readerConns);
  const list = Array.isArray(out) ? out : [out];
  const matches = list.filter((r) => r && String(r.lead_id) === LEAD_ID);
  if (matches.length !== 1) { throw new Error('expected exactly 1 matching row, got ' + matches.length); }
  post = matches[0];
} catch (e) { await cleanup(); die('could not re-read the row: ' + e.message); }
await cleanup();

const postPath = join(OUT_DIR, 'pipeline-row-' + LEAD_ID + '.post-repair.json');
writeFileSync(postPath, JSON.stringify(post, null, 2) + '\n', 'utf8');

const keys = [...new Set(Object.keys(pre).concat(Object.keys(post)))];
const changed = keys.filter((k) => String(pre[k] === undefined ? '' : pre[k]) !== String(post[k] === undefined ? '' : post[k]));
for (const f of REPAIR_FIELDS) {
  if (String(post[f]) !== REPAIR[f]) { die(f + ' is ' + JSON.stringify(post[f]) + ', expected ' + JSON.stringify(REPAIR[f]) + ' — ROLLBACK from ' + prePath); }
  ok(f + ' = the authoritative value');
}
if (String(post.important_context || '') !== '') { die('BR was written — ROLLBACK from ' + prePath); }
ok('BR important_context is still empty');
if (JSON.stringify(changed.sort()) !== JSON.stringify(REPAIR_FIELDS.slice().sort())) {
  die('cells changed beyond the two repaired: ' + changed.join(', ') + ' — ROLLBACK from ' + prePath);
}
ok('exactly two cells changed: ' + changed.join(', '));
ok('all ' + (keys.length - changed.length) + ' other columns are value-identical to the pre-image');
ok('post-image: ' + postPath);
say('');
say('REPAIRED. Rollback: the pre-image at ' + prePath + ' holds every original cell value.');
say('');
