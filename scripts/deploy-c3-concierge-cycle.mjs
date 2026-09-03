#!/usr/bin/env node
// FINMENTOR — C3.1: the Concierge writes the AUTHORITATIVE CYCLE PROJECTION, and the premium
// machine's confirmed rotations actually rotate.
//
//   node scripts/deploy-c3-concierge-cycle.mjs --dry-run     prove the splice, write nothing
//   node scripts/deploy-c3-concierge-cycle.mjs --confirm     PUT, then fresh-read and verify
//
// ── WHAT CHANGES, AND WHY ────────────────────────────────────────────────────────────────────
//
// 1. `Get Bot Session (Premium)` — TWO SPLICES, both in the cycle gate the live node already is:
//
//    a. The premium machine's two confirmed rotations (`p|new_y` on a committed cycle,
//       `p|restart_y` on an uncommitted one) are explicit resets, exactly like the legacy
//       `m|diag` restart. Until now they were not: the premium response node cleared cycle_id
//       and lead_id in ITS output, and `Build Session Row` re-attached both from THIS node — so
//       the rotation the customer confirmed was never persisted and the next /start showed the
//       committed screen again. Routing the rotation through the issuer keeps every P7.2
//       invariant: a new cycle is minted together with a fresh submission_key, preallocated and
//       read back before the authority row advances.
//
//    b. The reset block also clears the premium draft columns (draft_state, draft_step,
//       context_extracted_json, context_confirmed, append_text), which the legacy reset predates.
//
// 2. THREE NODES between `Build Session Row` and `Save Bot Session`:
//
//       Build Session Row -> Prepare Cycle Projection -> Project Cycle -> Cycle Projection Guard -> Save Bot Session
//
//    `Prepare Cycle Projection` derives ONE IMMUTABLE ROW KEY per (user, cycle) — `authority_key`
//    = telegram_user_id|cycle_id — and the numeric `cycle_sequence` (the Date.now() the issuer
//    minted into the cycle id). `Project Cycle` upserts that row into the n8n Data Table
//    `MiniApp_Cycle_Projection` on EVERY turn, BEFORE the session is persisted.
//
//    WHY ONE ROW PER CYCLE AND NOT ONE PER USER (C3, Codex correction ACCEPTED). With a single
//    row per user, a delayed Concierge execution that started BEFORE a rotation and finished
//    after it would upsert the OLD cycle over the new one, and the Gateway would resume the old
//    draft — the exact failure the activation gate forbids. With one row per cycle a stale turn
//    can only touch its own row; the Gateway picks the highest cycle_sequence, so the newest
//    cycle wins regardless of write order. Monotonic, and it needs no new credential or store.
//
//    Ordering is the whole point: the Gateway must see the new cycle or nothing — never the old
//    one after a rotation. On a rotation turn a failed projection write ABORTS the turn (the guard
//    throws, the Error Monitor alerts, Bot_Sessions keeps the old cycle, the projection keeps the
//    old cycle: consistent). On any other turn a failed write is tolerated: the row for this cycle
//    was written on the turn that minted it, so nothing is lost, and a missing projection makes
//    the Gateway refuse, never resume. (Codex proposed aborting EVERY turn on a projection-store
//    error; REJECTED — it trades customer-chat availability for nothing, since a non-rotation turn
//    cannot move the cycle.)
//
//    UPGRADE. The live Concierge already carries the first-generation pair (one row per user,
//    deployed 2026-09-03 11:33Z). `upgradeConcierge` converts that graph in place: the Prepare
//    node is inserted, Project Cycle is re-keyed by authority_key, the guard is rewritten, and
//    nothing else moves. The Data Table gains two columns (authority_key, cycle_sequence) first.
//
//    The guard re-emits the session row so `Save Bot Session` (autoMapInputData) receives
//    exactly what it received before. Nothing downstream changes.
//
// ── WHAT DOES NOT CHANGE ─────────────────────────────────────────────────────────────────────
//
// No Google Sheets authority moves. The Gateway is not touched here (see
// deploy-c3-gateway-cycle.mjs). No credential is added: Data Tables need none, and the Concierge
// already writes one (`Receipt Preallocate`). The owner gate stays as it is in this step.
//
// SECRETS. N8N_API_KEY from the environment only, never printed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

export const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
export const CONCIERGE_NAME = 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED';
export const PREMIUM_SESSION = 'Get Bot Session (Premium)';
export const BUILD_ROW = 'Build Session Row';
export const SAVE_SESSION = 'Save Bot Session';
export const PROJECT_NODE = 'Project Cycle';
export const PREP_NODE = 'Prepare Cycle Projection';
export const GUARD_NODE = 'Cycle Projection Guard';
export const PROJECTION_TABLE = 'MiniApp_Cycle_Projection';

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

// ---------------------------------------------------------------- splice 1: the premium rotations

export const ANCHOR_RESTART = "const isRestart = cb === 'm|diag' && carriesFinishedCycle;";
export const ANCHOR_CHAIN = "else if (isRestart) reset = 'restart';";
export const ANCHOR_RESET_TAIL = "  s.raw_json = ''; s.status = 'active'; s.state = 'MENU'; s.notes = '';";

export const PREMIUM_ROTATE_DECL = [
  ANCHOR_RESTART,
  "// [C3.1] The premium machine's two CONFIRMED rotations are explicit resets, mirroring decide():",
  "// NEW_CONFIRM only on a committed cycle, RESTART_CONFIRM only on an uncommitted one. After the",
  "// first reset the cycle is no longer committed, so a duplicate tap does not match and cannot",
  "// rotate twice. A rotation routed through here mints the new cycle WITH a fresh submission",
  "// key, preallocated and read back — the P7.2 pair moves together, as it must.",
  "const premiumCommitted = str(s.lead_id) !== '' && str(s.lead_cycle_id) === str(s.cycle_id);",
  "const isPremiumRotate = (cb === 'p|new_y' && premiumCommitted) || (cb === 'p|restart_y' && !premiumCommitted && str(s.cycle_id) !== '');"
].join('\n');
export const PREMIUM_CHAIN = "else if (isRestart || isPremiumRotate) reset = 'restart';";
export const PREMIUM_RESET_TAIL = [
  ANCHOR_RESET_TAIL,
  "  // [C3.1] the premium draft columns belong to the cycle too",
  "  s.draft_state = ''; s.draft_step = ''; s.context_extracted_json = ''; s.context_confirmed = ''; s.append_text = '';"
].join('\n');

export function splicePremiumSession(code) {
  for (const a of [ANCHOR_RESTART, ANCHOR_CHAIN, ANCHOR_RESET_TAIL]) {
    if (code.split(a).length !== 2) { throw new Error(PREMIUM_SESSION + ': anchor not found exactly once — do not splice blindly: ' + a); }
  }
  if (code.indexOf('isPremiumRotate') !== -1) { throw new Error(PREMIUM_SESSION + ': already spliced'); }
  return code.replace(ANCHOR_RESTART, PREMIUM_ROTATE_DECL).replace(ANCHOR_CHAIN, PREMIUM_CHAIN).replace(ANCHOR_RESET_TAIL, PREMIUM_RESET_TAIL);
}

// ---------------------------------------------------------------- splice 2: the projection nodes

export const GUARD_CODE = [
  '// [C3.1] Cycle Projection Guard.',
  '//',
  '// Runs after `Project Cycle` on BOTH of its outputs (success, error). It decides whether a',
  '// failed projection write may be tolerated, and re-emits the session row unchanged so',
  '// `Save Bot Session` (autoMapInputData) receives exactly what it always received.',
  '//',
  '// RULE. The Gateway must see the NEW cycle or NOTHING — never the old one. So on a turn that',
  '// minted a cycle (cycle_reset != ""), a failed projection write must not be followed by the',
  '// session write: the turn aborts here, the Error Monitor alerts, and Bot_Sessions keeps the',
  '// previous cycle — which is also what the projection still holds. Consistent, and recoverable',
  '// by the customer repeating the action. On any other turn the cycle did not move; a missing',
  '// or stale-by-nothing projection is tolerated because a missing projection makes the Gateway',
  '// REFUSE (409 CYCLE_UNRESOLVED), never resume.',
  "const row = $('" + BUILD_ROW + "').first().json;",
  "const g = ($('" + PREMIUM_SESSION + "').isExecuted ? $('" + PREMIUM_SESSION + "') : $('Get Bot Session')).first().json || {};",
  'const item = $input.first().json || {};',
  "const prep = $('" + PREP_NODE + "').first().json || {};",
  'const failed = !!(item.error || item.errorMessage);',
  "const invalid = Number(prep.projection_invalid || 0) === 1;",
  "const rotated = String(g.cycle_reset || '') !== '';",
  'if (rotated && (failed || invalid)) {',
  "  const detail = failed ? String((item.error && item.error.message) || item.errorMessage || item.error || 'unknown').slice(0, 200) : 'the minted cycle is not projectable';",
  "  throw new Error('CYCLE_PROJECTION_FAILED: the cycle rotated (' + String(g.cycle_reset) + ') but the projection could not be written; the rotation is NOT persisted. ' + detail);",
  '}',
  'return [{ json: row }];'
].join('\n');

export const PROJECTION_INPUT_CODE = [
  '// [C3] Prepare Cycle Projection — ONE IMMUTABLE ROW KEY PER (user, cycle).',
  '//',
  '// authority_key = telegram_user_id|cycle_id, and cycle_sequence is the Date.now() the issuer',
  '// minted into the cycle id (C-<chat_id>-<ms>). A delayed old turn can therefore update only',
  '// ITS OWN row; the Gateway resolves the highest sequence, so a stale write can never overwrite',
  '// a newer authoritative cycle. The user binding is checked against the cycle id itself.',
  '//',
  '// A cycle that does not parse (legacy shape) is NOT an exception on an ordinary turn: the row',
  '// is written under a LEGACY key with an empty cycle, which the Gateway ignores (it filters on',
  '// the exact cycle shape), and the guard aborts only if this turn claims to have ROTATED.',
  "const row = $('" + BUILD_ROW + "').first().json || {};",
  "const g = ($('" + PREMIUM_SESSION + "').isExecuted ? $('" + PREMIUM_SESSION + "') : $('Get Bot Session')).first().json || {};",
  "const user = String(row.user_id || row.chat_id || '').trim();",
  "const cycle = String(row.cycle_id || g.cycle_id || '').trim();",
  "const match = cycle.match(/^C-([0-9]+)-([0-9]+)$/);",
  "const now = new Date().toISOString();",
  "if (!user) { throw new Error('CYCLE_PROJECTION_INVALID: no Telegram user on the session row'); }",
  "if (!match || match[1] !== user) {",
  "  return [{ json: { authority_key: user + '|LEGACY', telegram_user_id: user, cycle_id: '', cycle_sequence: '', cycle_reset: String(g.cycle_reset || ''), projected_at: now, projection_invalid: 1 } }];",
  '}',
  "return [{ json: { authority_key: user + '|' + cycle, telegram_user_id: user, cycle_id: cycle, cycle_sequence: match[2], cycle_reset: String(g.cycle_reset || ''), projected_at: now, projection_invalid: 0 } }];"
].join('\n');

export function projectionInputNode(position) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: PROJECTION_INPUT_CODE },
    id: 'c3-prepare-cycle', name: PREP_NODE, type: 'n8n-nodes-base.code', typeVersion: 2, position
  };
}

export function projectionNode(position) {
  return {
    parameters: {
      resource: 'row', operation: 'upsert',
      dataTableId: { __rl: true, mode: 'name', value: PROJECTION_TABLE },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'authority_key', condition: 'eq', keyValue: '={{ $json.authority_key }}' }] },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: [],
        value: {
          authority_key: '={{ $json.authority_key }}',
          telegram_user_id: '={{ $json.telegram_user_id }}',
          cycle_id: '={{ $json.cycle_id }}',
          cycle_sequence: '={{ $json.cycle_sequence }}',
          cycle_reset: '={{ $json.cycle_reset }}',
          projected_at: '={{ $json.projected_at }}'
        },
        schema: [
          { id: 'authority_key', displayName: 'authority_key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'telegram_user_id', displayName: 'telegram_user_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'cycle_id', displayName: 'cycle_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'cycle_sequence', displayName: 'cycle_sequence', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'cycle_reset', displayName: 'cycle_reset', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'projected_at', displayName: 'projected_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      },
      options: {}
    },
    id: 'c3-project-cycle', name: PROJECT_NODE, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: position,
    // error output routed, NOT alwaysOutputData — the P9-R2 pair is exactly what this is not
    onError: 'continueErrorOutput'
  };
}

export function guardNode(position) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: GUARD_CODE },
    id: 'c3-cycle-guard', name: GUARD_NODE, type: 'n8n-nodes-base.code', typeVersion: 2, position: position
  };
}

// Pure: takes the live workflow, returns the patched one. Exported so the gate can drive it.
export function patchConcierge(live) {
  const w = JSON.parse(JSON.stringify(live));
  const byName = (n) => w.nodes.find((x) => x.name === n);
  for (const n of [PREMIUM_SESSION, BUILD_ROW, SAVE_SESSION]) { if (!byName(n)) { throw new Error('missing anchor node: ' + n); } }
  if (byName(PREP_NODE) || byName(PROJECT_NODE) || byName(GUARD_NODE)) { throw new Error('the projection nodes already exist'); }

  const ps = byName(PREMIUM_SESSION);
  ps.parameters.jsCode = splicePremiumSession(ps.parameters.jsCode);

  const br = byName(BUILD_ROW);
  const pos = br.position || [0, 0];
  w.nodes.push(projectionInputNode([pos[0] + 180, pos[1] + 160]));
  w.nodes.push(projectionNode([pos[0] + 380, pos[1] + 160]));
  w.nodes.push(guardNode([pos[0] + 580, pos[1] + 160]));

  const edge = (w.connections[BUILD_ROW] || {}).main;
  if (!edge || edge.length !== 1 || edge[0].length !== 1 || edge[0][0].node !== SAVE_SESSION) {
    throw new Error(BUILD_ROW + ' does not feed ' + SAVE_SESSION + ' alone — the graph is not in the expected form');
  }
  w.connections[BUILD_ROW] = { main: [[{ node: PREP_NODE, type: 'main', index: 0 }]] };
  w.connections[PREP_NODE] = { main: [[{ node: PROJECT_NODE, type: 'main', index: 0 }]] };
  w.connections[PROJECT_NODE] = { main: [
    [{ node: GUARD_NODE, type: 'main', index: 0 }],   // success
    [{ node: GUARD_NODE, type: 'main', index: 0 }]    // error: the guard decides
  ] };
  w.connections[GUARD_NODE] = { main: [[{ node: SAVE_SESSION, type: 'main', index: 0 }]] };
  return w;
}

export function verifyPatched(live, patched) {
  const f = [];
  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name).sort();
  const want = [GUARD_NODE, PREMIUM_SESSION, PREP_NODE, PROJECT_NODE].sort();
  if (JSON.stringify(changed) !== JSON.stringify(want)) { f.push('changed nodes: ' + changed.join(', ') + ' (want ' + want.join(', ') + ')'); }
  if (patched.nodes.length !== live.nodes.length + 3) { f.push('node count ' + live.nodes.length + ' -> ' + patched.nodes.length); }
  for (const s of Object.keys(live.connections)) {
    if (s === BUILD_ROW) { continue; }
    if (JSON.stringify(live.connections[s]) !== JSON.stringify(patched.connections[s])) { f.push('edge moved: ' + s); }
  }
  for (const n of patched.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { f.push('P9-R2 flag pair on ' + n.name); }
  }
  const cred = patched.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort();
  const credBefore = live.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort();
  if (JSON.stringify(cred) !== JSON.stringify(credBefore)) { f.push('credentials changed'); }
  const code = patched.nodes.find((n) => n.name === PREMIUM_SESSION).parameters.jsCode;
  try { new Function('$', '$input', 'require', code); } catch (e) { f.push(PREMIUM_SESSION + ' does not parse: ' + e.message); }
  try { new Function('$', '$input', 'require', GUARD_CODE); } catch (e) { f.push(GUARD_NODE + ' does not parse: ' + e.message); }
  try { new Function('$', '$input', 'require', PROJECTION_INPUT_CODE); } catch (e) { f.push(PREP_NODE + ' does not parse: ' + e.message); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { f.push('settings changed'); }
  return f;
}

// ---------------------------------------------------------------- upgrade: v1 (one row per user) -> per-cycle authority

// Pure: takes a live Concierge that ALREADY carries the first-generation pair
// (Build Session Row -> Project Cycle -> Cycle Projection Guard -> Save Bot Session) and returns
// the per-cycle form. Refuses anything else. Exported so the gate can drive it.
export function upgradeConcierge(live) {
  const w = JSON.parse(JSON.stringify(live));
  const byName = (n) => w.nodes.find((x) => x.name === n);
  for (const n of [PREMIUM_SESSION, BUILD_ROW, SAVE_SESSION, PROJECT_NODE, GUARD_NODE]) { if (!byName(n)) { throw new Error('missing anchor node: ' + n); } }
  if (byName(PREP_NODE)) { throw new Error('already upgraded: ' + PREP_NODE + ' exists'); }
  if (String(byName(PREMIUM_SESSION).parameters.jsCode).indexOf('isPremiumRotate') === -1) { throw new Error(PREMIUM_SESSION + ' is not spliced — this is not the v1 graph'); }
  const edge = (n, i) => ((((w.connections[n] || {}).main || [])[i] || [])[0] || {}).node;
  if (edge(BUILD_ROW, 0) !== PROJECT_NODE || edge(PROJECT_NODE, 0) !== GUARD_NODE || edge(PROJECT_NODE, 1) !== GUARD_NODE || edge(GUARD_NODE, 0) !== SAVE_SESSION) {
    throw new Error('the live graph is not the v1 projection chain');
  }
  const proj = byName(PROJECT_NODE);
  const fresh = projectionNode(proj.position || [0, 0]);
  proj.parameters = fresh.parameters; proj.typeVersion = fresh.typeVersion; proj.onError = fresh.onError; delete proj.alwaysOutputData;
  const guard = byName(GUARD_NODE);
  guard.parameters = guardNode(guard.position || [0, 0]).parameters;
  const pos = byName(BUILD_ROW).position || [0, 0];
  w.nodes.push(projectionInputNode([pos[0] + 180, pos[1] + 160]));
  w.connections[BUILD_ROW] = { main: [[{ node: PREP_NODE, type: 'main', index: 0 }]] };
  w.connections[PREP_NODE] = { main: [[{ node: PROJECT_NODE, type: 'main', index: 0 }]] };
  return w;
}

export function verifyUpgraded(live, patched) {
  const f = [];
  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name).sort();
  const want = [GUARD_NODE, PREP_NODE, PROJECT_NODE].sort();
  if (JSON.stringify(changed) !== JSON.stringify(want)) { f.push('changed nodes: ' + changed.join(', ') + ' (want ' + want.join(', ') + ')'); }
  if (patched.nodes.length !== live.nodes.length + 1) { f.push('node count ' + live.nodes.length + ' -> ' + patched.nodes.length); }
  for (const s of Object.keys(live.connections)) {
    if (s === BUILD_ROW) { continue; }
    if (JSON.stringify(live.connections[s]) !== JSON.stringify(patched.connections[s])) { f.push('edge moved: ' + s); }
  }
  const edge = (n, i) => ((((patched.connections[n] || {}).main || [])[i] || [])[0] || {}).node;
  if (edge(BUILD_ROW, 0) !== PREP_NODE || edge(PREP_NODE, 0) !== PROJECT_NODE || edge(PROJECT_NODE, 0) !== GUARD_NODE || edge(PROJECT_NODE, 1) !== GUARD_NODE || edge(GUARD_NODE, 0) !== SAVE_SESSION) { f.push('the write order is not ' + [BUILD_ROW, PREP_NODE, PROJECT_NODE, GUARD_NODE, SAVE_SESSION].join(' -> ')); }
  for (const n of patched.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { f.push('P9-R2 flag pair on ' + n.name); }
  }
  const cred = patched.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort();
  const credBefore = live.nodes.filter((n) => n.credentials).map((n) => JSON.stringify(n.credentials)).sort();
  if (JSON.stringify(cred) !== JSON.stringify(credBefore)) { f.push('credentials changed'); }
  const proj = patched.nodes.find((n) => n.name === PROJECT_NODE);
  if (!proj || proj.parameters.filters.conditions[0].keyName !== 'authority_key') { f.push('the projection is not keyed by authority_key'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { f.push('settings changed'); }
  return f;
}

// ---------------------------------------------------------------- main

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c3-concierge-cycle.mjs');
if (isMain) {
  if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
  if (!DRY && !CONFIRM) { die('this modifies a live workflow; re-run with --confirm (or --dry-run first)'); }
  mkdirSync(OUT_DIR, { recursive: true });

  say('');
  say('C3.1 — Concierge: cycle projection + persisted premium rotation');
  say('='.repeat(78));
  say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
  say('');

  const live = await api('GET', '/workflows/' + CONCIERGE_ID);
  if (live.name !== CONCIERGE_NAME) { die('live workflow is not the Concierge: ' + live.name); }
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-c3-cycle.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
  ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-c3-cycle.json (' + live.nodes.length + ' nodes, active=' + live.active + ')');

  // The projection table must already carry the two per-cycle columns; the upsert would otherwise
  // fail on every turn and the guard would abort every rotation.
  const tables = await api('GET', '/data-tables?limit=100');
  const table = ((tables && tables.data) || []).find((t) => t.name === PROJECTION_TABLE);
  if (!table) { die('the Data Table ' + PROJECTION_TABLE + ' does not exist'); }
  const cols = (table.columns || []).map((c) => c.name);
  for (const c of ['authority_key', 'telegram_user_id', 'cycle_id', 'cycle_sequence', 'cycle_reset', 'projected_at']) {
    if (cols.indexOf(c) === -1) { die(PROJECTION_TABLE + ' lacks the column ' + c + ' — add it first (POST /data-tables/' + table.id + '/columns)'); }
  }
  ok(PROJECTION_TABLE + ' carries every projection column (' + cols.join(', ') + ')');

  const byName = (n) => live.nodes.find((x) => x.name === n);
  let patched;
  if (byName(PREP_NODE)) { die('the live Concierge already carries ' + PREP_NODE + ' — nothing to do'); }
  if (byName(PROJECT_NODE)) {
    try { patched = upgradeConcierge(live); } catch (e) { die(e.message); }
    const f = verifyUpgraded(live, patched);
    if (f.length) { die('upgraded graph refused: ' + f.join(' | ')); }
    ok('UPGRADE: ' + PROJECT_NODE + ' re-keyed by authority_key, ' + GUARD_NODE + ' rewritten, ' + PREP_NODE + ' inserted, nothing else');
  } else {
    try { patched = patchConcierge(live); } catch (e) { die(e.message); }
    const f = verifyPatched(live, patched);
    if (f.length) { die('patched graph refused: ' + f.join(' | ')); }
    ok('exactly ' + PREMIUM_SESSION + ' rewritten, ' + PREP_NODE + ' + ' + PROJECT_NODE + ' + ' + GUARD_NODE + ' added, one edge split, nothing else');
  }

  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.c3-cycle-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
  if (DRY) { say('\nDRY RUN — nothing written. Candidate saved to .uat/' + CONCIERGE_ID + '.c3-cycle-candidate.json'); process.exit(0); }

  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(patched), 3);
  ok('Concierge updated');
  const after = await api('GET', '/workflows/' + CONCIERGE_ID);
  if (!after.active) { bad('the Concierge is NOT active'); } else { ok('Concierge active'); }
  if (after.name !== CONCIERGE_NAME) { bad('renamed'); }
  const p2 = after.nodes.find((n) => n.name === PROJECT_NODE);
  const g2 = after.nodes.find((n) => n.name === GUARD_NODE);
  const r2 = after.nodes.find((n) => n.name === PREP_NODE);
  if (!r2) { bad(PREP_NODE + ' is missing after deploy'); } else { ok(PREP_NODE + ' present'); }
  if (!p2 || p2.parameters.filters.conditions[0].keyName !== 'authority_key') { bad('the live projection is not keyed by authority_key'); } else { ok('live projection keyed by authority_key'); }
  const s2 = after.nodes.find((n) => n.name === PREMIUM_SESSION);
  if (!p2 || !g2) { bad('the projection nodes are missing after deploy'); } else { ok('projection nodes present'); }
  if (!s2 || s2.parameters.jsCode.indexOf('isPremiumRotate') === -1) { bad('the premium rotation splice is missing'); } else { ok('premium rotation splice present'); }
  const e = after.connections[BUILD_ROW].main[0][0].node;
  if (e !== PREP_NODE) { bad(BUILD_ROW + ' feeds ' + e); } else { ok(BUILD_ROW + ' -> ' + PREP_NODE + ' -> ' + PROJECT_NODE + ' -> ' + GUARD_NODE + ' -> ' + SAVE_SESSION); }
  if (String((after.settings || {}).errorWorkflow || '') !== String((live.settings || {}).errorWorkflow || '')) { bad('errorWorkflow binding changed'); } else { ok('error monitor binding unchanged'); }
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + ' with .uat/' + CONCIERGE_ID + '.pre-c3-cycle.json');
  say('');
}
