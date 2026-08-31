#!/usr/bin/env node
// FINMENTOR — the ONE real tap, read back from the tenant.
//
//   node scripts/verify-lead-alert-tap-live.mjs
//   node scripts/verify-lead-alert-tap-live.mjs --execution 5055
//
// READ-ONLY. Every tenant call is a GET. Nothing is written, nothing is restored, no second tap
// is performed. The frozen pre-tap row is used for COMPARISON and rollback readiness only.
//
// ── WHAT THIS IS THE ONLY PROOF OF ────────────────────────────────────────────────────────────
//
// scripts/verify-lead-alert-actions-live.mjs proved the deployed BYTES decide correctly. It could
// not prove that n8n runs them: no trigger fired, no Sheets node ran, no editMessageText was
// attempted. This reads the execution that a real tap produced, so every claim below comes from
// what the platform actually did — the pre-image the decision saw, the projection the writer was
// handed, the row as Sheets read it back, and the Message object Telegram returned from the edit.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const require_ = createRequire(import.meta.url);

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

const CC = 'qF9tonlHHIxc8MDd';
const LEAD_ID = 'FIN-1788113619104-582';
const ACTION = 'docs';
const FREEZE = join(OUT_DIR, 'pipeline-row-' + LEAD_ID + '.pre-tap.json');
// Everything before this is a pre-Stage-2 execution and cannot be the tap.
const DEPLOYED_AT = '2026-08-31T13:15:16.249Z';

const argv = process.argv.slice(2);
const PINNED = argv.includes('--execution') ? argv[argv.indexOf('--execution') + 1] : null;

const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const A = new Function(ACTIONS_SRC + '; return LAA;')();

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { failures.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));
const eqw = (a, b, m) => want(a === b, m + (a === b ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'));
const say = (m) => console.log(m);
const die = (m) => { console.error('\nSTOPPED: ' + m); process.exit(1); };

async function get(path) {
  const r = await fetch(BASE + '/api/v1' + path, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { die('GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
  return r.json();
}

say('');
say('THE REAL TAP — 📄 Документы on ' + LEAD_ID);
say('='.repeat(78));

// ── find the execution the tap produced ───────────────────────────────────────────────────────
say('');
say('0. the execution');

let EX = null;
{
  if (PINNED) {
    EX = await get('/executions/' + PINNED + '?includeData=true');
  } else {
    const list = await get('/executions?workflowId=' + CC + '&limit=10');
    const after = (list.data || []).filter((e) => String(e.startedAt) > DEPLOYED_AT);
    if (!after.length) {
      say('');
      say('  No Command Center execution since the Stage 2 deploy (' + DEPLOYED_AT + ').');
      say('  The tap has not reached n8n yet. Re-run once it has.');
      say('');
      process.exit(2);
    }
    EX = await get('/executions/' + after[0].id + '?includeData=true');
  }
  say('        execution ' + EX.id + '  ' + EX.status + '  ' + EX.startedAt + '  mode=' + EX.mode);
  want(String(EX.startedAt) > DEPLOYED_AT, 'the execution is AFTER the Stage 2 deploy, so it ran the new graph');
  // Reported, not assumed. A live tap exists to find out; asserting success up front would have
  // hidden the very thing this run found.
  want(EX.status === 'success', 'the execution finished without an error (status: ' + EX.status + ')');
  eqw(EX.mode, 'webhook', 'it was driven by the Telegram trigger, not by a manual run');
}

const RD = ((EX.data || {}).resultData || {}).runData || {};
const ran = (n) => Object.prototype.hasOwnProperty.call(RD, n);
const outOf = (n) => (((((RD[n] || [])[0] || {}).data || {}).main || [])[0] || []).map((x) => x.json);
const startedAt = (n) => ((RD[n] || [])[0] || {}).startTime || 0;

// ── 1. the lifecycle actually ran, in order ───────────────────────────────────────────────────
say('');
say('1. the Command Center execution — every node, in the order it ran');

const ORDER = [
  'Telegram Command Trigger', 'Verify Telegram Identity', 'Read Settings', 'Settings to Object',
  'Parse Lead Command v2', 'Route Command Mode', 'Get Pipeline (Update)', 'Find & Build Update',
  'IF Row Found', 'IF Action Allowed', 'Build Sparse Update', 'Update Pipeline Row',
  'Get Pipeline (Verify)', 'Verify Mutation', 'IF Verified', 'Route Edit Shape'
];
{
  for (const n of ORDER) { want(ran(n), 'ran: ' + n); }
  const seq = Object.keys(RD).map((n) => [n, startedAt(n)]).sort((a, b) => a[1] - b[1]);
  say('');
  for (const [n, t] of seq) { say('        ' + new Date(t).toISOString() + '  ' + n); }
  say('');
  const before = (a, b) => startedAt(a) <= startedAt(b);
  want(before('Verify Telegram Identity', 'Read Settings'), 'identity was checked before the policy sheet was read');
  want(before('Get Pipeline (Update)', 'Find & Build Update'), 'the decision ran on the fresh read');
  want(before('Find & Build Update', 'Build Sparse Update'), 'the projection was built from the decision');
  want(before('Build Sparse Update', 'Update Pipeline Row'), 'the writer was fed by the projection');
  want(before('Update Pipeline Row', 'Get Pipeline (Verify)'), 'the read-back happened after the write');
  want(before('Get Pipeline (Verify)', 'Verify Mutation'), 'the mutation was proven from the read-back');
}

// ── 2. what the tap carried ───────────────────────────────────────────────────────────────────
say('');
say('2. the tap, as Telegram delivered it');

let ORIGIN_KIND = 'new_lead';
const IDENT = outOf('Verify Telegram Identity')[0] || {};
const PARSED = outOf('Parse Lead Command v2')[0] || {};
{
  eqw(IDENT.verified, true, 'the identity gate authenticated the tap');
  eqw(IDENT.is_callback, true, 'it was a button tap, not a typed command');
  eqw(String(IDENT.verified_chat_id), String(IDENT.verified_from_id), 'the private-chat invariant held (chat id === sender id)');
  // Which alert the owner happened to tap decides the action set. Reading it from the delivered
  // reply_markup is the whole point of the origin_had_done discriminator, so it is REPORTED here
  // and used below — not asserted to a value chosen in advance.
  ORIGIN_KIND = A.originKind(IDENT.origin_had_done === true);
  ok('the origin keyboard was read as ' + ORIGIN_KIND.toUpperCase().replace('_', ' ') + ' (origin_had_done=' + IDENT.origin_had_done + ')');
  want(typeof IDENT.message_id === 'number', 'the edit target arrived: message_id ' + IDENT.message_id);
  eqw(PARSED.mode, 'update', 'parsed as an action');
  eqw(PARSED.command, 'docs', 'the command is docs');
  eqw(PARSED.lead_id, LEAD_ID, 'against the expected lead');
  eqw(String(IDENT.text), 'docs|' + LEAD_ID, 'the callback_data is the byte-identical legacy string');
}

// ── 3. the pre-image, the projection, the post-image ──────────────────────────────────────────
say('');
say('3. the write — pre-image, projection, post-image');

const PRE = outOf('Get Pipeline (Update)').find((r) => String(r.lead_id) === LEAD_ID);
const SPARSE = outOf('Build Sparse Update')[0] || {};
const POST = outOf('Get Pipeline (Verify)').find((r) => String(r.lead_id) === LEAD_ID);
const DECIDED = outOf('Find & Build Update')[0] || {};
const VERIFIED = outOf('Verify Mutation')[0] || {};
{
  if (!PRE) { die('the execution carries no pre-image row for ' + LEAD_ID); }
  if (!POST) { die('the execution carries no post-image row for ' + LEAD_ID); }

  eqw(DECIDED._allowed, true, 'the action was allowed from the freshly read row');
  eqw(DECIDED._action, ACTION, 'and it was the docs action');
  eqw(DECIDED._reason, '', 'with no refusal reason');

  // the projection is exactly lead_id + the owned columns, and nothing else reached the writer
  const owned = ['lead_id'].concat(A.OWNED[ACTION]).sort();
  eqw(Object.keys(SPARSE).sort().join(', '), owned.join(', '), 'the writer was handed lead_id + owned columns ONLY');

  // the four values the owner named
  eqw(String(POST.deal_stage), 'Documents Requested', 'deal_stage = Documents Requested');
  want(String(POST.documents_requested_at || '').length > 0, 'documents_requested_at was written: ' + POST.documents_requested_at);
  want(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(String(POST.documents_requested_at)), 'documents_requested_at is an ISO UTC instant');
  const t0 = new Date(String(SPARSE.documents_requested_at)).getTime();
  const t1 = new Date(String(SPARSE.next_follow_up_at)).getTime();
  eqw(t1 - t0, 48 * 3600 * 1000, 'next_follow_up_at is exactly tap + 48h, as the docs action specifies');
  eqw(String(POST.next_follow_up_at), String(SPARSE.next_follow_up_at), 'next_follow_up_at reads back exactly as written');
  eqw(String(POST.documents_requested_at), String(SPARSE.documents_requested_at), 'documents_requested_at reads back exactly as written');
  want(/Z$/.test(String(POST.next_follow_up_at)), 'storage stayed UTC');

  // the two the owner named as MUST NOT move
  eqw(String(POST.sla_status), 'Active', 'sla_status remained Active');
  eqw(String(POST.sla_status), String(PRE.sla_status), 'sla_status is byte-identical to the pre-image');
  eqw(String(POST.last_contacted_at), String(PRE.last_contacted_at), 'last_contacted_at is unchanged');

  // and everything else
  const untouched = A.untouchedFields(ACTION, PRE);
  const moved = untouched.filter((k) => k in POST && String(PRE[k]) !== String(POST[k]));
  want(moved.length === 0, untouched.length + ' unrelated columns are byte-identical across the write'
    + (moved.length ? ' (MOVED: ' + moved.map((k) => k + ': ' + JSON.stringify(PRE[k]) + ' -> ' + JSON.stringify(POST[k])).join('; ') + ')' : ''));

  eqw(VERIFIED._verified, true, 'the read-back PROVED the mutation');
  eqw(JSON.stringify(VERIFIED._mismatched), '[]', 'nothing mismatched');
}

// ── 4. the frozen pre-tap state, for comparison and rollback readiness ────────────────────────
say('');
say('4. the frozen pre-tap state — comparison only, nothing restored');
{
  if (!existsSync(FREEZE)) { bad('the pre-tap freeze is missing: ' + FREEZE); }
  else {
    const FZ = JSON.parse(readFileSync(FREEZE, 'utf8'));
    const BOOKKEEPING = ['last_activity_at', 'last_sla_alert_at', 'days_in_stage', 'updated_at'];
    const drifted = Object.keys(FZ).filter((k) => k in PRE && String(FZ[k]) !== String(PRE[k]) && !BOOKKEEPING.includes(k));
    want(drifted.length === 0, 'the pre-image the tap saw matches the freeze'
      + (drifted.length ? ' EXCEPT: ' + drifted.join(', ') : ''));
    const owned = A.OWNED[ACTION];
    say('');
    say('        ROLLBACK READY — restoring would mean writing these three values back:');
    for (const k of owned) { say('          ' + k.padEnd(24) + JSON.stringify(FZ[k]) + '   (now ' + JSON.stringify(POST[k]) + ')'); }
    say('        Nothing was restored. Nothing was written by this script.');
  }
}

// ── 5. the Telegram edit ──────────────────────────────────────────────────────────────────────
say('');
say('5. the alert message, as Telegram returned it from the edit');

const editNode = Object.keys(RD).find((n) => n.startsWith('Edit Alert ('));
let EDITED = null;
{
  want(!!editNode, 'an Edit Alert node ran' + (editNode ? ': ' + editNode : ''));
  if (editNode) {
    // The Telegram node hands back the raw API envelope, not a flattened Message.
    const envelope = outOf(editNode)[0] || {};
    eqw(envelope.ok, true, 'Telegram accepted the edit (ok:true)');
    EDITED = envelope.result || {};
    const SHAPE_NODE = { KB221: 'Edit Alert (5)', KB22: 'Edit Alert (4)', KB21: 'Edit Alert (3)', NONE: 'Edit Alert (0)' };
    eqw(String(editNode), SHAPE_NODE[String(VERIFIED.kb_shape)],
      'the shape router sent ' + VERIFIED.kb_shape + ' to the edit node that renders it');

    // Telegram's own edited marker
    want(typeof EDITED.edit_date === 'number' && EDITED.edit_date > 0,
      'Telegram accepted the edit and stamped it: edit_date ' + EDITED.edit_date + ' (' + new Date((EDITED.edit_date || 0) * 1000).toISOString() + ')');
    eqw(Number(EDITED.message_id), Number(IDENT.message_id), 'it edited the message the tap came from, not a new one');

    // the visible text and the formatting survived
    eqw(String(EDITED.text), String(IDENT.message_text), 'the visible text is byte-identical to what the owner was reading');
    const before = JSON.stringify(IDENT.message_entities || []);
    const after = JSON.stringify(EDITED.entities || []);
    eqw(after, before, 'every entity — type, offset, length — survived the round trip');

    // the keyboard
    const kb = ((EDITED.reply_markup || {}).inline_keyboard) || [];
    const flat = kb.flat();
    want(kb.length > 0, 'the edited message carries a keyboard (' + kb.length + ' rows, ' + flat.length + ' buttons)');
    want(kb.every((r) => r.length <= 2), 'no row carries more than 2 buttons');
    want(!flat.some((b) => String(b.callback_data || '').startsWith('docs|')), '📄 Документы is GONE — the action just taken is not offered again');
    want(!flat.some((b) => String(b.callback_data || '').startsWith('won|')), 'no won button was emitted');

    // and it is exactly what the POST-write state allows, computed independently from the module
    const expect = A.keyboard(ORIGIN_KIND, POST, LEAD_ID);
    eqw(JSON.stringify(flat.map((b) => b.callback_data)),
      JSON.stringify(expect.flat().map((b) => b.callback_data)),
      'the keyboard is exactly what the POST-WRITE state allows, recomputed independently');
    eqw(JSON.stringify(kb.map((r) => r.length)), JSON.stringify(expect.map((r) => r.length)), 'and in the approved row shape');
    say('');
    say('        ' + kb.map((r) => r.map((b) => b.text).join(' | ')).join('\n        '));
  }
}

// ── 6. the acknowledgement order ──────────────────────────────────────────────────────────────
say('');
say('6. nothing claimed success before the write was proven');
{
  // Two different things, deliberately. `Answer Callback Query` is Telegram's spinner: it must fire
  // within seconds or the client shows a failure, so it runs early — and says only «Обрабатываю…»,
  // claiming no outcome. The OUTCOME is spoken by `Telegram Update Reply`, and the graph gives it
  // no feeder except an Edit Alert node.
  const ackText = String((((EX.workflowData || {}).nodes || []).find((n) => n.name === 'Answer Callback Query') || { parameters: {} })
    .parameters.additionalFields?.text || '');
  want(!/выполн|готов|обработан|успешн|сохран/i.test(ackText),
    'the fast acknowledgement claims no outcome: ' + JSON.stringify(ackText));

  const replyRun = (RD['Telegram Update Reply'] || [])[0] || {};
  want(ran('Telegram Update Reply') && !replyRun.error,
    'the confirmation was SENT' + (replyRun.error ? ' — IT WAS NOT: ' + (replyRun.error.description || replyRun.error.message) : ''));
  if (ran('Telegram Update Reply')) {
    const t = startedAt('Telegram Update Reply');
    want(t >= startedAt('Update Pipeline Row'), 'the confirmation came AFTER the write');
    want(t >= startedAt('Get Pipeline (Verify)'), 'the confirmation came AFTER the read-back');
    want(t >= startedAt('Verify Mutation'), 'the confirmation came AFTER the mutation was proven');
    if (editNode) { want(t >= startedAt(editNode), 'the confirmation came AFTER the keyboard was refreshed'); }
    want(!ran('Telegram Write Failed Reply'), 'the write-failed branch did not run');
    const reply = outOf('Telegram Update Reply')[0] || {};
    say('');
    say('        ' + String(reply.text || DECIDED.reply_text || '').split('\n').join('\n        '));
  }
}

// ── the record ────────────────────────────────────────────────────────────────────────────────
say('');
say('7. exact before / after');
say('='.repeat(78));
{
  const FZ = existsSync(FREEZE) ? JSON.parse(readFileSync(FREEZE, 'utf8')) : {};
  const watch = ['deal_stage', 'documents_requested_at', 'next_follow_up_at', 'sla_status',
    'last_contacted_at', 'status', 'priority', 'next_action', 'sla_snooze_until', 'company'];
  say('');
  say('  column                     frozen pre-tap            pre-image (tap)           post-image (read-back)');
  say('  ' + '-'.repeat(104));
  for (const k of watch) {
    const c = (v) => (v === '' || v == null ? '(empty)' : String(v)).slice(0, 24).padEnd(26);
    const mark = String(PRE[k]) !== String(POST[k]) ? '  <= CHANGED' : '';
    say('  ' + k.padEnd(27) + c(FZ[k]) + c(PRE[k]) + c(POST[k]) + mark);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const rec = {
    execution_id: EX.id, started_at: EX.startedAt, status: EX.status, action: ACTION, lead_id: LEAD_ID,
    projection_written: SPARSE, pre_image: PRE, post_image: POST,
    verified: VERIFIED._verified, mismatched: VERIFIED._mismatched,
    edited: EDITED ? { message_id: EDITED.message_id, edit_date: EDITED.edit_date, keyboard: (EDITED.reply_markup || {}).inline_keyboard } : null
  };
  writeFileSync(join(OUT_DIR, 'lead-alert-tap-' + EX.id + '.json'), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  say('');
  say('  record: .uat/lead-alert-tap-' + EX.id + '.json');
}

say('');
say('='.repeat(78));
say('  ' + pass + ' passed, ' + failures.length + ' failed');
say('');
say('  Read-only: no PUT, no POST, no restore, no second tap. The row is left as the tap left it.');
say('');
if (failures.length) { process.exit(1); }
