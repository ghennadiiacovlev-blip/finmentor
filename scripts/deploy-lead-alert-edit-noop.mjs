#!/usr/bin/env node
// FINMENTOR — a no-op keyboard refresh is not a failure. The narrow fix.
//
//   node scripts/deploy-lead-alert-edit-noop.mjs --dry-run
//   node scripts/deploy-lead-alert-edit-noop.mjs --confirm
//
// ONE workflow changes: the Lead Command Center (qF9tonlHHIxc8MDd). TWO node parameters change.
// No node is added or removed, no connection is rewired, no Sheets node is touched, no credential
// is rebound, and no button semantics, mutation logic or lifecycle ordering changes.
//
// ── WHAT IS BEING CLOSED ──────────────────────────────────────────────────────────────────────
//
// Execution 5062: the owner snoozed a PRIORITY alert. Write correct, read-back correct, mutation
// verified — and the keyboard the post-write state allows was IDENTICAL to the one already on the
// message, because snooze is deliberately not idempotent-by-state and `deal_stage` did not move.
// `editMessageText` was a no-op, Telegram answered
//
//   Bad Request: message is not modified: specified new message content and reply markup are
//   exactly the same as a current content and reply markup of the message
//
// and the graph treated any `$json.error` as a presentation failure, so the owner was told the
// buttons could not be updated when they were already right.
//
// ── THE EXCEPTION IS EXACT, AND EVERYTHING ELSE STILL FAILS CLOSED ────────────────────────────
//
// `LAA.classifyEdit()` returns exactly one of EDIT_UPDATED / EDIT_NOOP / EDIT_FAILED. Only
// Telegram's own «Bad Request: message is not modified» class is a no-op, matched at index 0 so
// no other error can carry the phrase in. There is NO blanket 400 rule. «message to edit not
// found», «can't parse entities», «chat not found», «Unauthorized», «Forbidden: bot was blocked»,
// any other 400 and an unreadable error object all remain EDIT_FAILED.
//
// EDIT_UPDATED and EDIT_NOOP both speak success — in both, the business result is done and proven.
// EDIT_FAILED continues to the existing failure copy, unchanged.
//
// ── THE TWO PARAMETERS ────────────────────────────────────────────────────────────────────────
//
//   Find & Build Update .parameters.jsCode   — rebuilt from n8n/src/lead-alerts/actions.js, which
//                                              now carries classifyEdit + presentationNoop, and
//                                              emits a THIRD copy: reply_text_presentation_noop
//   Telegram Update Reply .parameters.text   — a three-way selection that implements
//                                              classifyEdit()'s contract exactly
//
// `Verify Mutation` is deliberately NOT rebuilt. It inlines the same module but uses none of the
// new functions, and it already carries the third copy through its Object.assign. Rebuilding it
// would enlarge the diff to buy nothing.
//
// ── ORDERING IS UNCHANGED ─────────────────────────────────────────────────────────────────────
//
//   business write -> fresh read-back -> Verify Mutation -> edit + classification -> acknowledgement
//
// An unverified write still cannot reach the acknowledgement at all: `IF Verified` routes it to
// `Telegram Write Failed Reply`, and that wiring is not touched here.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CAND = join(ROOT, 'n8n', 'candidate', 'lead-command-center-edit-noop-candidate.json');

const CC = 'qF9tonlHHIxc8MDd';
const DECIDE = 'Find & Build Update';
const REPLY = 'Telegram Update Reply';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const j = (v) => JSON.stringify(v);
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : j(v)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Stop extends Error {}
const die = (m) => { throw new Stop(m); };

async function api(method, path, body) {
  let last = null;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY },
          body ? { 'Content-Type': 'application/json' } : {}),
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

// ── the two new bodies ────────────────────────────────────────────────────────────────────────

const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const PRESENTER_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8').replace(/\r\n/g, '\n');
const TZ_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'), 'utf8').replace(/\r\n/g, '\n');
const LA_BLOCK = 'const LA = (function () {\n' + PRESENTER_SRC.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n';
const TZ_BLOCK = 'const LATZ = (function () {\n' + TZ_SRC.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n';

// The tail is Stage 2's, unchanged except for the THIRD copy on each of the three exits. Every
// decision — which action, whether it is allowed, what is written — is byte-identical.
const DECIDE_TAIL = `
// ── STAGE 2 — decide, from the FRESHLY READ row, what this tap is allowed to do ───────────────
//
// The input is the Pipeline read that ran for THIS callback. Nothing is judged against the state
// the alert was rendered with, which is what makes a stale tap safe.
//
// This node performs NO write and knows nothing about how the message is edited.
const cmd = $('Parse Lead Command v2').first().json;
const rows = $input.all().map((i) => i.json);
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const row = rows.find((r) => norm(r.lead_id) === norm(cmd.lead_id));

const OFFSET = (function () {
  try { return LATZ.tzOffsetMinutes(($('Settings to Object').first().json.settings || {}).timezone || 'Europe/Chisinau', new Date()); }
  catch (e) { return 180; }
})();

const base = {
  chat_id: cmd.chat_id,
  callback_query_id: cmd.callback_query_id,
  command: cmd.command,
  lead_id: cmd.lead_id,
  message_id: cmd.message_id,
  message_chat_id: cmd.message_chat_id,
  is_callback: cmd.is_callback === true,
  // the logger contract, unchanged
  from_stage: row ? String(row.deal_stage || 'New') : '',
  to_stage: row ? String(row.deal_stage || 'New') : '',
  stage_changed: false
};

if (!row) {
  return [{ json: Object.assign({}, base, {
    _found: false, _allowed: false, _reason: 'NOT_FOUND',
    company: '', kb: [], kb_shape: 'NONE', edit_html: '',
    reply_text: LAA.refusal(LA, 'NOT_FOUND', ''),
    reply_text_presentation_noop: LAA.refusal(LA, 'NOT_FOUND', ''),
    reply_text_presentation_failed: LAA.refusal(LA, 'NOT_FOUND', '')
  }) }];
}

const kind = LAA.originKind(cmd.origin_had_done === true);
const action = LAA.actionOfCommand(cmd.command, cmd.stage_value);
const reason = LAA.refuseReason(action, row, kind);
const company = String(row.company || '');
const editHtml = LAA.htmlFromTelegram(cmd.message_text, cmd.message_entities);

if (reason) {
  // Refused: ZERO business write. The keyboard is still refreshed from the current state, so the
  // owner stops looking at actions that are no longer possible. A refusal reads the same however
  // the edit went — there is no outcome to soften and none to apologise for.
  const kb = LAA.keyboard(kind, row, row.lead_id);
  const text = LAA.refusal(LA, reason, company);
  return [{ json: Object.assign({}, base, {
    _found: true, _allowed: false, _reason: reason, company: company,
    kb: kb, kb_shape: LAA.shape(kb), edit_html: editHtml,
    reply_text: text, reply_text_presentation_noop: text, reply_text_presentation_failed: text
  }) }];
}

// Allowed. The sparse update is built here and projected by the next node; this node never
// touches the sheet.
const nowIso = new Date().toISOString();
const upd = LAA.buildUpdate(action, row.lead_id, nowIso);
const toStage = upd.deal_stage != null ? String(upd.deal_stage) : String(row.deal_stage || 'New');
return [{ json: Object.assign({}, base, {
  _found: true, _allowed: true, _reason: '', _action: action, _kind: kind,
  _upd: upd, _offset: OFFSET, company: company,
  from_stage: String(row.deal_stage || 'New'),
  to_stage: toStage,
  stage_changed: toStage !== String(row.deal_stage || 'New'),
  edit_html: editHtml,
  reply_text: LAA.confirm(LA, action, company, upd, OFFSET),
  reply_text_presentation_noop: LAA.presentationNoop(LA, action, company, upd, OFFSET),
  reply_text_presentation_failed: LAA.presentationFailure(LA, action, company, upd, OFFSET)
}) }];
`;

const DECIDE_SRC = ACTIONS_SRC + '\n' + LA_BLOCK + TZ_BLOCK + DECIDE_TAIL;

// The acknowledgement selection. It implements LAA.classifyEdit()'s contract in the one place an
// n8n Telegram node can carry logic, and qa/lead-alerts-edit-noop.test.mjs asserts the expression
// and the function agree on every scenario rather than trusting that they were written together.
const REPLY_EXPR = "={{ ($json.error === undefined || $json.error === null || $json.error === '')"
  + " ? $('" + DECIDE + "').first().json.reply_text"
  + " : (String(($json.error && $json.error.message) || ($json.error && $json.error.description) || $json.error || '')"
  + ".indexOf('Bad Request: message is not modified') === 0"
  + " ? $('" + DECIDE + "').first().json.reply_text_presentation_noop"
  + " : $('" + DECIDE + "').first().json.reply_text_presentation_failed) }}";

// ══════════════════════════════════════════════════════════════════════════════════════════════

say('');
say('EDIT NO-OP FIX — two parameters, one workflow');
say('='.repeat(78));
say('  MODE: ' + (DRY ? 'DRY RUN — nothing is written to the tenant' : 'LIVE'));

MAIN: try {
  const missing = [];
  if (!BASE) { missing.push('N8N_BASE_URL'); }
  if (!READ_KEY) { missing.push('N8N_API_KEY'); }
  if (!CONFIRM && !DRY) { missing.push('--dry-run or --confirm'); }
  if (CONFIRM && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
  if (missing.length) { die('missing: ' + missing.join(', ')); }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(dirname(CAND), { recursive: true });

  // ── 1. the live graph ───────────────────────────────────────────────────────────────────────
  say('');
  say('1. the live Command Center');
  const live = await api('GET', '/workflows/' + CC);
  say('        ' + live.name + '   nodes ' + live.nodes.length + '   active ' + live.active
    + '   updatedAt ' + live.updatedAt);
  if (live.nodes.length !== 33) { die('expected 33 nodes, found ' + live.nodes.length); }

  const liveDecide = live.nodes.find((n) => n.name === DECIDE);
  const liveReply = live.nodes.find((n) => n.name === REPLY);
  if (!liveDecide) { die('no node named ' + j(DECIDE)); }
  if (!liveReply) { die('no node named ' + j(REPLY)); }

  // Refuse to run against a graph that is not the one this fix was written for.
  if (!/\$\('Find & Build Update'\)/.test(String(liveReply.parameters.text))) {
    die(REPLY + ' does not carry the ack fix — deploy scripts/deploy-lead-alert-ack-fix.mjs first');
  }
  ok('the ack fix is present, so this builds on the graph 5062 ran');
  if (String(liveDecide.parameters.jsCode).indexOf('reply_text_presentation_noop') !== -1) {
    die('the live ' + DECIDE + ' already emits reply_text_presentation_noop — nothing to deploy');
  }
  ok('the live graph does NOT yet classify a no-op edit');

  // ── 2. the candidate ────────────────────────────────────────────────────────────────────────
  say('');
  say('2. the candidate');
  const next = JSON.parse(j(importable(live)));
  const N = (n) => next.nodes.find((x) => x.name === n);
  N(DECIDE).parameters.jsCode = DECIDE_SRC;
  N(REPLY).parameters.text = REPLY_EXPR;
  writeFileSync(CAND, JSON.stringify(next, null, 2) + '\n', 'utf8');
  ok('written: n8n/candidate/' + CAND.split(/[\\/]/).pop());

  // ── 3. the diff, proven minimal ─────────────────────────────────────────────────────────────
  say('');
  say('3. the production diff');

  const byName = (wf) => new Map(wf.nodes.map((n) => [n.name, n]));
  const L = byName(live);
  const C = byName(next);
  const added = [...C.keys()].filter((n) => !L.has(n));
  const removed = [...L.keys()].filter((n) => !C.has(n));
  if (added.length) { die('the candidate ADDS nodes: ' + added.join(', ')); }
  if (removed.length) { die('the candidate REMOVES nodes: ' + removed.join(', ')); }
  ok('no node added, no node removed — ' + next.nodes.length + ' nodes');

  if (j(next.connections) !== j(live.connections)) { die('the candidate rewires connections'); }
  ok('connections byte-identical — no rewiring, no lifecycle change');

  const differing = [...L.keys()].filter((n) => j(L.get(n)) !== j(C.get(n)));
  if (j(differing.slice().sort()) !== j([DECIDE, REPLY].slice().sort())) {
    die('expected exactly ' + j([DECIDE, REPLY]) + ' to differ, got ' + j(differing));
  }
  ok('exactly TWO nodes differ: ' + differing.join(', '));

  for (const nm of differing) {
    const a = L.get(nm);
    const b = C.get(nm);
    const topKeys = Object.keys(Object.assign({}, a, b)).filter((k) => j(a[k]) !== j(b[k]));
    if (j(topKeys) !== j(['parameters'])) { die(nm + ': more than `parameters` differs: ' + j(topKeys)); }
    const pk = Object.keys(Object.assign({}, a.parameters, b.parameters)).filter((k) => j(a.parameters[k]) !== j(b.parameters[k]));
    const wantKey = nm === DECIDE ? ['jsCode'] : ['text'];
    if (j(pk) !== j(wantKey)) { die(nm + ': expected only ' + j(wantKey) + ' to change, got ' + j(pk)); }
    ok(nm + ': only parameters.' + wantKey[0] + ' changes (type, id, position, credentials, onError untouched)');
  }

  const sheets = live.nodes.filter((n) => String(n.type).includes('googleSheets'));
  const sheetsMoved = sheets.filter((n) => j(n) !== j(C.get(n.name)));
  if (sheetsMoved.length) { die('a Google Sheets node changed: ' + sheetsMoved.map((n) => n.name).join(', ')); }
  ok('all ' + sheets.length + ' Google Sheets nodes byte-identical — no mutation logic touched');

  const credOf = (nodes) => nodes.filter((n) => n.credentials).map((n) => n.name + ' -> ' + j(n.credentials)).sort();
  if (j(credOf(live.nodes)) !== j(credOf(next.nodes))) { die('credentials changed'); }
  ok(live.nodes.filter((n) => n.credentials).length + ' credential-bearing nodes, none rebound');

  const untouched = [...L.keys()].filter((n) => n !== DECIDE && n !== REPLY);
  const moved = untouched.filter((n) => j(L.get(n)) !== j(C.get(n)));
  if (moved.length) { die('unrelated nodes changed: ' + moved.join(', ')); }
  ok('all ' + untouched.length + ' unrelated nodes byte-identical');

  // the edit nodes keep the onError that makes classification possible at all
  for (const n of next.nodes.filter((x) => x.name.startsWith('Edit Alert ('))) {
    if (n.onError !== 'continueRegularOutput') { die(n.name + ': onError is ' + n.onError); }
  }
  ok('all four Edit Alert nodes keep onError continueRegularOutput');

  // ── 4. what actually changed inside the two parameters ──────────────────────────────────────
  say('');
  say('4. inside the two parameters');
  const beforeDecide = String(liveDecide.parameters.jsCode).replace(/\r\n/g, '\n');
  const afterDecide = String(N(DECIDE).parameters.jsCode);
  const countOf = (s, t) => s.split(t).length - 1;
  say('        ' + DECIDE + ':');
  say('          reply_text_presentation_noop  ' + countOf(beforeDecide, 'reply_text_presentation_noop')
    + ' -> ' + countOf(afterDecide, 'reply_text_presentation_noop') + ' occurrences (three exits)');
  say('          classifyEdit / presentationNoop now inlined: '
    + (afterDecide.indexOf('function classifyEdit') !== -1 && afterDecide.indexOf('function presentationNoop') !== -1));
  say('          sha ' + sha(beforeDecide).slice(0, 12) + ' -> ' + sha(afterDecide).slice(0, 12));
  say('');
  say('        ' + REPLY + ':');
  say('          BEFORE  ' + String(liveReply.parameters.text));
  say('          AFTER   ' + REPLY_EXPR);
  say('');

  // The decisions must be untouched: every LAA call the tail makes is the same, in the same order.
  const callsOf = (s) => (s.match(/LAA\.[a-zA-Z]+\(/g) || []).join(',');
  const tailOf = (s) => s.slice(s.lastIndexOf('// ── STAGE 2 — decide'));
  const beforeCalls = callsOf(tailOf(beforeDecide));
  const afterCalls = callsOf(tailOf(afterDecide));
  const addedCalls = afterCalls.split(',').filter((c) => c && beforeCalls.split(',').indexOf(c) === -1);
  if (beforeCalls.split(',').some((c) => c && afterCalls.split(',').indexOf(c) === -1)) {
    die('the decision tail LOST a call: ' + beforeCalls + ' -> ' + afterCalls);
  }
  ok('the decision tail makes every call it made before; added only: ' + j([...new Set(addedCalls)]));

  if (DRY) {
    say('');
    say('='.repeat(78));
    say('  DRY RUN — nothing was written. Candidate is on disk for the gate to drive.');
    say('  Next:  node qa/lead-alerts-edit-noop.test.mjs');
    say('         node scripts/deploy-lead-alert-edit-noop.mjs --confirm');
    say('');
    break MAIN;
  }

  // ── 5. deploy ───────────────────────────────────────────────────────────────────────────────
  say('');
  say('5. deploy');
  const PRE = join(OUT_DIR, CC + '.pre-edit-noop.json');
  writeFileSync(PRE, JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
  ok('pre-image frozen: .uat/' + CC + '.pre-edit-noop.json');

  await api('PUT', '/workflows/' + CC, importable(next));
  say('        PUT accepted');
  await sleep(1500);

  // ── 6. read back from the tenant ────────────────────────────────────────────────────────────
  say('');
  say('6. read-back — from the tenant, not from the PUT');
  const after = await api('GET', '/workflows/' + CC);
  const A = byName(after);
  writeFileSync(join(OUT_DIR, CC + '.post-edit-noop.json'), JSON.stringify(importable(after), null, 2) + '\n', 'utf8');

  if (after.nodes.length !== live.nodes.length) { die('node count changed: ' + after.nodes.length); }
  ok('node count unchanged: ' + after.nodes.length);
  if (after.name !== live.name) { die('the workflow was RENAMED to ' + j(after.name)); }
  ok('name unchanged: ' + after.name);
  if (after.active !== true) { die('the workflow is not active'); }
  ok('active true');
  if (j(after.connections) !== j(live.connections)) { die('connections changed on the tenant'); }
  ok('connections byte-identical on the tenant');

  const liveNow = (n) => A.get(n);
  if (String(liveNow(REPLY).parameters.text) !== REPLY_EXPR) { die(REPLY + ' did not take the new expression'); }
  ok(REPLY + ' carries the three-way selection, byte for byte');
  if (String(liveNow(DECIDE).parameters.jsCode).replace(/\r\n/g, '\n') !== DECIDE_SRC) {
    die(DECIDE + ' did not take the new body');
  }
  ok(DECIDE + ' carries the rebuilt decision body, byte for byte');

  const movedAfter = [...L.keys()].filter((n) => n !== DECIDE && n !== REPLY && j(L.get(n)) !== j(A.get(n)));
  if (movedAfter.length) { die('unrelated nodes changed on the tenant: ' + movedAfter.join(', ')); }
  ok('all ' + untouched.length + ' unrelated nodes byte-identical on the tenant');
  if (j(credOf(after.nodes)) !== j(credOf(live.nodes))) { die('credentials changed on the tenant'); }
  ok('credentials unchanged on the tenant');

  say('');
  say('='.repeat(78));
  say('  DEPLOYED ' + new Date().toISOString() + ' to ' + CC);
  say('  Rollback: PUT /api/v1/workflows/' + CC + ' with .uat/' + CC + '.pre-edit-noop.json');
  say('');
} catch (e) {
  console.error('\nSTOPPED: ' + (e && e.message));
  process.exitCode = 1;
}
