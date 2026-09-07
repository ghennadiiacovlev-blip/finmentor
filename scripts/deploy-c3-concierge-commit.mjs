#!/usr/bin/env node
// FINMENTOR — C3.2: the Concierge ADOPTS the Mini App submission of the current cycle, so the
// terminal screen — and with it «Начать новый вопрос», the only customer-visible rotation —
// actually renders after a brief is submitted.
//
//   node scripts/deploy-c3-concierge-commit.mjs --dry-run     prove the splice, write nothing
//   node scripts/deploy-c3-concierge-commit.mjs --confirm     PUT, then fresh-read and verify
//
// ── THE LIVE DEFECT (2026-09-03, owner test in the real client bot) ──────────────────────────
//
// The customer submitted a brief through the Mini App (MiniApp_App_Sessions row: state =
// submitted, lead_id = FIN-…, cycle_id = C-…). Nothing wrote that commit back to Bot_Sessions:
// the Submit endpoint owns no Sheets authority (by design — see
// docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md), Lead Intake writes Pipeline/CRM only,
// and the Phase 2 contract's "lead_id → BS" was never implemented. So the Concierge's authority
// snapshot still said lead_id '' for the submitted cycle:
//
//     isCommitted(auth) === false  →  decide() treats every input as qualification
//                                  →  TG_SUBMITTED never renders
//                                  →  «Начать новый вопрос» never appears
//                                  →  p|new_y (THE ONLY ROTATE) is unreachable
//
// while «Открыть бриф» → Gateway → the projection (correctly) resolves the same cycle → the
// submitted session for that cycle wins → «Принято». The Gateway was right; the bot was blind.
//
// ── THE CORRECTION (smallest that closes it) ─────────────────────────────────────────────────
//
// Two nodes on the PREMIUM branch only, between `Premium Owner Gate` and the cycle gate:
//
//     Premium Owner Gate -> Read Cycle Commit -> Adopt Cycle Commit -> Get Bot Session (Premium)
//
// `Read Cycle Commit` reads MiniApp_App_Sessions for this Telegram user (a Data Table the
// Concierge already writes, no credential, alwaysOutputData + continueRegularOutput — the same
// posture as the Gateway's own read). `Adopt Cycle Commit` re-emits the Bot_Sessions row and,
// ONLY IF a submitted session with a lead exists for the row's CURRENT cycle, sets
// lead_id / lead_cycle_id (and lead_sent_at when empty) on it. Nothing else changes:
//
//   * the cycle gate then sees premiumCommitted === true, so p|new_y rotates exactly as C3.1
//     proved offline — new cycle, new submission key, the old lead archived to previous_lead_id;
//   * the response node sees isCommitted === true, so the terminal screen renders and the
//     terminal rule holds: a stray text on a submitted cycle can no longer reach qualification;
//   * Build Session Row persists the adopted lead into Bot_Sessions — the contract's
//     "lead_id → BS", performed lazily by the one workflow that already owns that sheet;
//   * a store outage or an absent row adopts NOTHING (the row passes through unchanged), which is
//     today's behaviour, not a new failure mode; the Gateway still refuses to resume across cycles.
//
// The submitted app session is never written. No Sheets authority moves. The owner-only release
// gate, G5, the server-side cycle authority and the CUSTOMER block are untouched.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { keepRollback } from './lib/rollback-artifact.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

export const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
export const CONCIERGE_NAME = 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED';
export const OWNER_GATE = 'Premium Owner Gate';
export const FIND_SESSION = 'Find Session';
export const PREMIUM_SESSION = 'Get Bot Session (Premium)';
export const READ_NODE = 'Read Cycle Commit';
export const ADOPT_NODE = 'Adopt Cycle Commit';
export const SESSIONS_TABLE = 'MiniApp_App_Sessions';
export const SESSIONS_COLUMNS = ['app_session_id', 'telegram_user_id', 'cycle_id', 'state', 'lead_id', 'updated_at'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

// ── the two nodes ────────────────────────────────────────────────────────────────────────────

// The Telegram user, exactly as Prepare Cycle Projection binds it: user_id, else chat_id.
export const READ_KEY_EXPR = "={{ String($('" + FIND_SESSION + "').first().json.user_id || $('" + FIND_SESSION + "').first().json.chat_id || '') }}";

export function readNode(position) {
  return {
    parameters: {
      resource: 'row', operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: SESSIONS_TABLE },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'telegram_user_id', condition: 'eq', keyValue: READ_KEY_EXPR }] },
      returnAll: true
    },
    id: 'c3-read-cycle-commit', name: READ_NODE, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: position,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    notes: 'C3.2 — the Mini App sessions of this user. alwaysOutputData so an ABSENT row still reaches the adoption (which then adopts nothing); continueRegularOutput so an outage is an item with .error, never a silent stop.'
  };
}

export const ADOPT_CODE = [
  '// [C3.2] Adopt Cycle Commit — the Concierge learns that the CURRENT cycle was submitted.',
  '//',
  '// The Mini App submit commits a cycle in MiniApp_App_Sessions (state submitted, lead_id set)',
  '// and nothing writes that back to Bot_Sessions. Without it the authority snapshot says',
  '// lead_id "" for a submitted cycle, the terminal screen never renders, and the only rotation',
  '// (p|new_y) is unreachable — proven live 2026-09-03.',
  '//',
  '// RULE. Adopt ONLY a submitted session that carries a lead AND belongs to this user AND to',
  '// the row\'s CURRENT cycle. A store outage, an absent row, a draft, another cycle, or a row',
  '// that already carries a lead for this cycle: pass the session row through UNCHANGED. The',
  '// app session itself is never written here.',
  "const base = $('" + FIND_SESSION + "').first().json || {};",
  "const str = v => String(v == null ? '' : v).trim();",
  "const items = $input.all().map(i => i.json).filter(r => r && typeof r === 'object' && !Array.isArray(r));",
  'const storeError = items.some(r => r.error || r.errorMessage);',
  'const s = Object.assign({}, base);',
  'const user = str(s.user_id || s.chat_id);',
  'const cycle = str(s.cycle_id);',
  "let adoption = 'NONE';",
  "if (storeError) { adoption = 'STORE_ERROR'; }",
  "else if (user === '' || cycle === '') { adoption = 'NO_CYCLE'; }",
  "else if (str(s.lead_id) !== '' && str(s.lead_cycle_id) === cycle) { adoption = 'ALREADY_COMMITTED'; }",
  'else {',
  '  const committed = items',
  "    .filter(r => str(r.app_session_id) !== '')",
  '    .filter(r => str(r.telegram_user_id) === user)',
  '    .filter(r => str(r.cycle_id) === cycle)',
  "    .filter(r => str(r.state) === 'submitted')",
  "    .filter(r => str(r.lead_id) !== '');",
  "  committed.sort((a, b) => { const ta = str(a.updated_at), tb = str(b.updated_at); if (ta !== tb) { return ta < tb ? 1 : -1; } return Number(b.id || 0) - Number(a.id || 0); });",
  '  if (committed.length) {',
  '    s.lead_id = str(committed[0].lead_id);',
  '    s.lead_cycle_id = cycle;',
  "    if (str(s.lead_sent_at) === '') { s.lead_sent_at = str(committed[0].updated_at) || new Date().toISOString(); }",
  "    adoption = 'ADOPTED';",
  "  } else { adoption = 'NOT_SUBMITTED'; }",
  '}',
  's.__cycle_commit_adoption = adoption;',
  'return [{ json: s }];'
].join('\n');

export function adoptNode(position) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ADOPT_CODE },
    id: 'c3-adopt-cycle-commit', name: ADOPT_NODE, type: 'n8n-nodes-base.code', typeVersion: 2, position: position
  };
}

// ── the splice ───────────────────────────────────────────────────────────────────────────────

export function patchConciergeCommit(live) {
  const w = JSON.parse(JSON.stringify(live));
  const byName = (n) => w.nodes.find((x) => x.name === n);
  for (const n of [OWNER_GATE, FIND_SESSION, PREMIUM_SESSION]) { if (!byName(n)) { throw new Error('missing anchor node: ' + n); } }
  if (byName(READ_NODE) || byName(ADOPT_NODE)) { throw new Error('the adoption nodes already exist'); }
  if (String(byName(PREMIUM_SESSION).parameters.jsCode).indexOf('isPremiumRotate') === -1) { throw new Error(PREMIUM_SESSION + ' is not the C3.1 gate (no isPremiumRotate) — deploy C3.1 first'); }

  const edge = (w.connections[OWNER_GATE] || {}).main;
  if (!edge || edge.length < 1 || !edge[0] || edge[0].length !== 1 || edge[0][0].node !== PREMIUM_SESSION) {
    throw new Error(OWNER_GATE + ' output 0 does not feed ' + PREMIUM_SESSION + ' alone — the graph is not in the expected form');
  }
  const pos = byName(PREMIUM_SESSION).position || [0, 0];
  w.nodes.push(readNode([pos[0] - 360, pos[1] - 160]));
  w.nodes.push(adoptNode([pos[0] - 180, pos[1] - 160]));
  w.connections[OWNER_GATE] = { main: edge.map((outs, i) => (i === 0 ? [{ node: READ_NODE, type: 'main', index: 0 }] : outs)) };
  w.connections[READ_NODE] = { main: [[{ node: ADOPT_NODE, type: 'main', index: 0 }]] };
  w.connections[ADOPT_NODE] = { main: [[{ node: PREMIUM_SESSION, type: 'main', index: 0 }]] };
  return w;
}

export function verifyCommitPatch(live, patched) {
  const f = [];
  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name).sort();
  const want = [ADOPT_NODE, READ_NODE].sort();
  if (JSON.stringify(changed) !== JSON.stringify(want)) { f.push('changed nodes: ' + changed.join(', ') + ' (want ' + want.join(', ') + ')'); }
  if (patched.nodes.length !== live.nodes.length + 2) { f.push('node count ' + live.nodes.length + ' -> ' + patched.nodes.length); }
  for (const s of Object.keys(live.connections)) {
    if (s === OWNER_GATE) { continue; }
    if (JSON.stringify(live.connections[s]) !== JSON.stringify(patched.connections[s])) { f.push('edge moved: ' + s); }
  }
  const edge = (n, i) => ((((patched.connections[n] || {}).main || [])[i] || [])[0] || {}).node;
  if (edge(OWNER_GATE, 0) !== READ_NODE || edge(READ_NODE, 0) !== ADOPT_NODE || edge(ADOPT_NODE, 0) !== PREMIUM_SESSION) {
    f.push('the premium entry is not ' + [OWNER_GATE, READ_NODE, ADOPT_NODE, PREMIUM_SESSION].join(' -> '));
  }
  const liveGate = ((live.connections[OWNER_GATE] || {}).main || []);
  const patchedGate = ((patched.connections[OWNER_GATE] || {}).main || []);
  if (JSON.stringify(liveGate.slice(1)) !== JSON.stringify(patchedGate.slice(1))) { f.push('the legacy (non-owner) branch of ' + OWNER_GATE + ' moved'); }
  for (const n of patched.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { f.push('P9-R2 flag pair on ' + n.name); }
  }
  const cred = patched.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort();
  const credBefore = live.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort();
  if (JSON.stringify(cred) !== JSON.stringify(credBefore)) { f.push('credentials changed'); }
  const rd = patched.nodes.find((n) => n.name === READ_NODE);
  if (!rd || rd.parameters.operation !== 'get' || rd.parameters.dataTableId.value !== SESSIONS_TABLE) { f.push(READ_NODE + ' is not a read of ' + SESSIONS_TABLE); }
  if (!rd || rd.credentials) { f.push(READ_NODE + ' carries a credential'); }
  const sheets = patched.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets').length;
  const sheetsBefore = live.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets').length;
  if (sheets !== sheetsBefore) { f.push('Sheets authority changed: ' + sheetsBefore + ' -> ' + sheets + ' nodes'); }
  try { new Function('$', '$input', 'require', ADOPT_CODE); } catch (e) { f.push(ADOPT_NODE + ' does not parse: ' + e.message); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { f.push('settings changed'); }
  return f;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c3-concierge-commit.mjs');
if (isMain) {
  if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
  if (!DRY && !CONFIRM) { die('this modifies a live workflow; re-run with --confirm (or --dry-run first)'); }
  mkdirSync(OUT_DIR, { recursive: true });

  say('');
  say('C3.2 — Concierge: adopt the Mini App commit of the current cycle (the terminal screen and the rotation become reachable)');
  say('='.repeat(78));
  say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
  say('');

  const live = await api('GET', '/workflows/' + CONCIERGE_ID);
  if (live.name !== CONCIERGE_NAME) { die('live workflow is not the Concierge: ' + live.name); }
  const rb = keepRollback(join(OUT_DIR, CONCIERGE_ID + '.pre-c3-commit.json'), JSON.stringify(importable(live), null, 2) + '\n');
  if (rb.aside) { ok('rollback artifact KEPT (live differs from it); fresh read saved to ' + rb.aside.replace(ROOT, '.')); }
  else { ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-c3-commit.json (' + live.nodes.length + ' nodes, active=' + live.active + ')' + (rb.written ? '' : ' — unchanged')); }

  const tables = await api('GET', '/data-tables?limit=100');
  const table = ((tables && tables.data) || []).find((t) => t.name === SESSIONS_TABLE);
  if (!table) { die('the Data Table ' + SESSIONS_TABLE + ' does not exist'); }
  const cols = (table.columns || []).map((c) => c.name);
  for (const c of SESSIONS_COLUMNS) { if (cols.indexOf(c) === -1) { die(SESSIONS_TABLE + ' lacks the column ' + c); } }
  ok(SESSIONS_TABLE + ' carries every column the adoption reads (' + SESSIONS_COLUMNS.join(', ') + ')');

  const byName = (n) => live.nodes.find((x) => x.name === n);
  if (byName(READ_NODE) || byName(ADOPT_NODE)) { die('the live Concierge already carries ' + READ_NODE + ' / ' + ADOPT_NODE + ' — nothing to do'); }
  let patched;
  try { patched = patchConciergeCommit(live); } catch (e) { die(e.message); }
  const f = verifyCommitPatch(live, patched);
  if (f.length) { die('patched graph refused: ' + f.join(' | ')); }
  ok('exactly ' + READ_NODE + ' + ' + ADOPT_NODE + ' added on the premium branch, one edge split, nothing else (' + live.nodes.length + ' -> ' + patched.nodes.length + ' nodes)');

  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.c3-commit-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
  if (DRY) { say('\nDRY RUN — nothing written. Candidate saved to .uat/' + CONCIERGE_ID + '.c3-commit-candidate.json'); }
  else {
    await api('PUT', '/workflows/' + CONCIERGE_ID, importable(patched), 3);
    ok('Concierge updated');
    const after = await api('GET', '/workflows/' + CONCIERGE_ID);
    if (!after.active) { bad('the Concierge is NOT active'); } else { ok('Concierge active'); }
    if (after.name !== CONCIERGE_NAME) { bad('renamed'); }
    // Targeted fresh-read checks (n8n re-serialises nodes on the way back, so a byte comparison
    // against the candidate is the wrong instrument here; the facts below are the deploy).
    const e2 = (n, i) => ((((after.connections[n] || {}).main || [])[i] || [])[0] || {}).node;
    if (after.nodes.length !== live.nodes.length + 2) { bad('node count ' + live.nodes.length + ' -> ' + after.nodes.length); } else { ok(after.nodes.length + ' nodes (+2)'); }
    if (e2(OWNER_GATE, 0) !== READ_NODE || e2(READ_NODE, 0) !== ADOPT_NODE || e2(ADOPT_NODE, 0) !== PREMIUM_SESSION) { bad('the premium entry is not ' + [OWNER_GATE, READ_NODE, ADOPT_NODE, PREMIUM_SESSION].join(' -> ')); } else { ok(OWNER_GATE + ' -> ' + READ_NODE + ' -> ' + ADOPT_NODE + ' -> ' + PREMIUM_SESSION); }
    const legacyLive = (((live.connections[OWNER_GATE] || {}).main || [])[1] || []).map((x) => x.node).join(',');
    const legacyAfter = (((after.connections[OWNER_GATE] || {}).main || [])[1] || []).map((x) => x.node).join(',');
    if (legacyLive !== legacyAfter) { bad('the legacy branch moved: ' + legacyLive + ' -> ' + legacyAfter); } else { ok('legacy (non-owner) branch unchanged: ' + legacyAfter); }
    const rd2 = after.nodes.find((n) => n.name === READ_NODE);
    const ad2 = after.nodes.find((n) => n.name === ADOPT_NODE);
    if (!rd2 || rd2.parameters.dataTableId.value !== SESSIONS_TABLE || rd2.onError !== 'continueRegularOutput' || rd2.alwaysOutputData !== true) { bad(READ_NODE + ' is not the candidate read'); } else { ok(READ_NODE + ' reads ' + SESSIONS_TABLE + ', alwaysOutputData + continueRegularOutput'); }
    if (!ad2 || ad2.parameters.jsCode !== ADOPT_CODE) { bad(ADOPT_NODE + ' code differs from source'); } else { ok(ADOPT_NODE + ' byte-identical to source'); }
    const credAfter = after.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort().join('|');
    const credLive = live.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort().join('|');
    if (credAfter !== credLive) { bad('credentials changed'); } else { ok('credentials unchanged'); }
    if (String((after.settings || {}).errorWorkflow || '') !== String((live.settings || {}).errorWorkflow || '')) { bad('errorWorkflow binding changed'); } else { ok('error monitor binding unchanged'); }
    say('');
    say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + ' with .uat/' + CONCIERGE_ID + '.pre-c3-commit.json');
    say('');
  }
}
