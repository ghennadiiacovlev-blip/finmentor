#!/usr/bin/env node
// FINMENTOR — C3 step 4 live proof prerequisite: retire the ONE pre-v2 (xray-v1) AI_DRAFT analysis
// row of the SYNTHETIC RO UAT lead so the next sweep re-analyses that lead under the v2 contract
// (32-byte token, review_token_expires_at) and sends a fresh owner alert.
//
//   node scripts/reset-c3-xray-uat-row.mjs --dry-run     read, verify every guard, write nothing
//   node scripts/reset-c3-xray-uat-row.mjs --confirm     delete the one row, fresh-read, verify
//
// WHY. Rows analysed under C1 carry a 32-hex token with no expiry; the v2 review surface refuses
// them by design (docs/C3_OWNER_RUNBOOK.md §4: "delete their XRay_Analysis row to re-analyse under
// v2"). Fresh-read 2026-09-04 04:10Z: XRay_Analysis holds SEED + two xray-v1 rows, both synthetic
// UAT leads of 2026-09-03; no v2 row exists yet. The RU row is CLIENT_READY and stays. The RO row
// is AI_DRAFT and is the one this script retires.
//
// WHAT IT REFUSES (each guard is a hard stop, no partial work):
//   1. the row is identified by analysis_id AND lead_id AND request_id together — never by name;
//   2. it must be analysis_version xray-v1, review_status AI_DRAFT, an empty reviewed_at;
//   3. exactly ONE row may match, and the sheet must hold exactly the three rows the fresh read
//      showed (SEED, the RU CLIENT_READY row, this row) — any other shape means the sheet moved;
//   4. the SEED row and the RU row must be value-identical after the delete;
//   5. the Pipeline is NOT touched: the sweep overwrites xray_analysis_id/status when it re-analyses.
//
// The Sheets credential admits only the Google Sheets NODE, so the read and the delete each run in
// a workflow that is created, used once and deleted (same method as repair-uat-pipeline-row.mjs).
// SECRETS: N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back to N8N_API_KEY). Never printed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const TARGET = {
  analysis_id: 'XA-FIN-1788432493303-321-MTLEK48C',
  lead_id: 'FIN-1788432493303-321',
  request_id: 'fmr_2a965e4456747674631a83fd6389954b',
  analysis_version: 'xray-v1',
  review_status: 'AI_DRAFT'
};
const KEEP = ['XA-SEED', 'XA-FIN-1788432350648-72-MTLEGRPK']; // the rows that must survive untouched
const DOC_ID = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A';
const SHEET_GID = 871569424; // XRay_Analysis
const SHEETS_CRED = { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' };

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

async function api(method, path, body) {
  const res = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await res.text();
  if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 300)); }
  return t ? JSON.parse(t) : null;
}

// ── disposable workflows ───────────────────────────────────────────────────────────────────────
const created = [];
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
    sheetName: { __rl: true, value: SHEET_GID, mode: 'list', cachedResultName: 'XRay_Analysis' }
  }, params),
  id: 'n-' + name.replace(/\W/g, ''), name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7,
  position: pos, credentials: { googleSheetsOAuth2Api: SHEETS_CRED }
});
const webhookNode = (path) => ({
  // responseData allEntries: the default (firstEntryJson) answers with ONE item, i.e. the SEED row only.
  parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', responseData: 'allEntries', options: {} },
  id: 'n-wh', name: 'WH', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0]
});

async function runDisposable(name, path, nodes, connections) {
  const wf = await api('POST', '/workflows', { name, nodes, connections, settings: { executionOrder: 'v1' } });
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

async function readAllRows(label) {
  const path = 'zz-c3-xray-read-' + crypto.randomBytes(4).toString('hex');
  const nodes = [webhookNode(path), sheetsNode('Read XRay_Analysis', { options: {} }, [240, 0])];
  const conns = { WH: { main: [[{ node: 'Read XRay_Analysis', type: 'main', index: 0 }]] } };
  try {
    const out = await runDisposable('ZZ C3 XRAY READ ' + label, path, nodes, conns);
    const list = Array.isArray(out) ? out : [out];
    if (list.some((r) => r && (r.error || r.errorMessage))) { throw new Error('the sheet read reported an error'); }
    return list.filter((r) => r && typeof r === 'object' && String(r.analysis_id || '') !== '');
  } finally { await cleanup(); }
}

const strip = (r) => { const c = Object.assign({}, r); delete c.row_number; return c; };

// ── main ───────────────────────────────────────────────────────────────────────────────────────
say('');
say('C3 step 4 prerequisite — retire the pre-v2 XRay_Analysis row of the synthetic RO UAT lead');
say('='.repeat(90));
say(DRY ? '  MODE: DRY RUN — nothing will be deleted' : '  MODE: LIVE');
say('');
if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('this deletes a row in the production CRM; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

say('STEP 1 — pre-image through a disposable Sheets reader');
const pre = await readAllRows('PRE').catch((e) => die('could not read XRay_Analysis: ' + e.message));
say('        rows: ' + pre.map((r) => r.analysis_id + ' [' + r.analysis_version + '/' + r.review_status + '] row ' + r.row_number).join(' | '));
const matches = pre.filter((r) => String(r.analysis_id) === TARGET.analysis_id);
if (matches.length !== 1) { die('expected exactly 1 row with analysis_id ' + TARGET.analysis_id + ', found ' + matches.length); }
const row = matches[0];
for (const k of Object.keys(TARGET)) {
  if (String(row[k] || '') !== TARGET[k]) { die('the row carries ' + k + ' = ' + JSON.stringify(row[k]) + ', expected ' + JSON.stringify(TARGET[k]) + ' — WRONG ROW, nothing done'); }
}
if (String(row.reviewed_at || '') !== '') { die('the row has reviewed_at set — it is not an untouched draft'); }
if (String(row.review_token_expires_at || '') !== '') { die('the row already carries review_token_expires_at — it is a v2 row, not the pre-v2 draft'); }
ok('exactly one row matches analysis_id + lead_id + request_id, xray-v1, AI_DRAFT, never reviewed');
const others = pre.filter((r) => String(r.analysis_id) !== TARGET.analysis_id).map((r) => String(r.analysis_id)).sort();
if (JSON.stringify(others) !== JSON.stringify(KEEP.slice().sort())) { die('the sheet holds other rows than expected: ' + others.join(', ') + ' — the sheet moved since the fresh read; nothing done'); }
ok('the only other rows are ' + KEEP.join(' and ') + ' (they stay)');
const rowNumber = Number(row.row_number);
if (!Number.isInteger(rowNumber) || rowNumber < 2) { die('row_number is not usable: ' + JSON.stringify(row.row_number)); }
ok('target is sheet row ' + rowNumber);
const prePath = join(OUT_DIR, 'xray-analysis.' + TARGET.analysis_id + '.pre-reset.json');
writeFileSync(prePath, JSON.stringify({ captured_at: new Date().toISOString(), all_rows: pre }, null, 2) + '\n', 'utf8');
ok('pre-image: ' + prePath.replace(ROOT, '.') + ' (sha ' + sha(pre).slice(0, 16) + ')');
say('');

if (DRY) {
  say('DRY RUN — the delete below was NOT performed.');
  say('  would delete sheet row ' + rowNumber + ' (' + TARGET.analysis_id + ', ' + TARGET.lead_id + ') and nothing else');
  say('  the next sweep would then re-analyse ' + TARGET.lead_id + ' under xray-v2 and send a fresh owner alert');
  process.exit(0);
}

say('STEP 2 — delete sheet row ' + rowNumber + ' through a disposable Sheets deleter');
const delPath = 'zz-c3-xray-del-' + crypto.randomBytes(4).toString('hex');
const delNodes = [webhookNode(delPath), sheetsNode('Delete Row', {
  operation: 'delete', toDelete: 'rows', startIndex: rowNumber, numberToDelete: 1
}, [240, 0])];
try {
  await runDisposable('ZZ C3 XRAY DELETE', delPath, delNodes, { WH: { main: [[{ node: 'Delete Row', type: 'main', index: 0 }]] } });
  ok('the delete ran');
} catch (e) { await cleanup(); die('the delete failed: ' + e.message + ' — check the post-image before retrying'); }
await cleanup();
say('');

say('STEP 3 — post-image and the survivors, cell by cell');
const post = await readAllRows('POST').catch((e) => die('could not re-read XRay_Analysis: ' + e.message));
say('        rows: ' + post.map((r) => r.analysis_id + ' [' + r.analysis_version + '/' + r.review_status + '] row ' + r.row_number).join(' | '));
const postPath = join(OUT_DIR, 'xray-analysis.' + TARGET.analysis_id + '.post-reset.json');
writeFileSync(postPath, JSON.stringify({ captured_at: new Date().toISOString(), all_rows: post }, null, 2) + '\n', 'utf8');
if (post.some((r) => String(r.analysis_id) === TARGET.analysis_id)) { die('the row is STILL present after the delete'); }
ok(TARGET.analysis_id + ' is gone');
const ids = post.map((r) => String(r.analysis_id)).sort();
if (JSON.stringify(ids) !== JSON.stringify(KEEP.slice().sort())) { die('unexpected survivors: ' + ids.join(', ')); }
for (const id of KEEP) {
  const a = strip(pre.find((r) => String(r.analysis_id) === id)); const b = strip(post.find((r) => String(r.analysis_id) === id));
  if (JSON.stringify(a) !== JSON.stringify(b)) { die(id + ' CHANGED across the delete — inspect ' + postPath.replace(ROOT, '.')); }
}
ok('SEED and the RU CLIENT_READY row are value-identical to the pre-image');
say('');
say('DONE. The sweep (every 10 min) will re-analyse ' + TARGET.lead_id + ' under xray-v2 and send the owner alert');
say('«ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ … Lead ID: ' + TARGET.lead_id + '» with the button «✅ Проверить и открыть клиенту».');
say('Restore (only if needed): append the row saved in ' + prePath.replace(ROOT, '.') + ' back to XRay_Analysis.');
