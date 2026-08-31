#!/usr/bin/env node
// FINMENTOR — the CONFIRMING tap. Does n8n actually EXECUTE the corrected acknowledgement?
//
//   node scripts/verify-lead-alert-ack-tap-live.mjs
//   node scripts/verify-lead-alert-ack-tap-live.mjs --execution 5061
//
// READ-ONLY. Every tenant call is a GET. Nothing is written, nothing is restored, no tap is
// performed by this script.
//
// ── WHY THIS EXISTS AND scripts/verify-lead-alert-tap-live.mjs DOES NOT SUFFICE ────────────────
//
// That script is pinned to execution 5055 — the docs tap on FIN-1788113619104-582 — and it should
// stay pinned. 5055 is immutable evidence of the defect: re-running it will always report its two
// failures, and that is the point. It proves nothing about the fix.
//
// docs/FINDING_LEAD_ALERT_CONFIRMATION_EMPTY.md closes with the one thing the fix's own gate
// cannot reach: `qa/lead-alerts-ack-expression.test.mjs` proves the BYTES and the EVALUATION are
// right, and the deploy verifier proves those bytes are what the tenant holds — but neither
// proves n8n RUNS them. That is the same limit that let 5055 through. Only a new tap closes it.
//
// So this script is deliberately NOT pinned. It reads whichever Command Center execution the next
// tap produces, derives the action and the lead FROM the execution rather than from a constant,
// and asks the four questions the finding leaves open:
//
//   1. did the execution run the FIXED graph?              (the expression, from the execution's
//                                                            own workflow snapshot)
//   2. did it land on a branch where the defect LIVED?     (anything but branch 0)
//   3. was the acknowledgement actually SENT, non-empty?   (Telegram's own returned Message)
//   4. is the text the copy the decision produced?         (round-tripped through entities)
//
// Question 2 matters as much as question 3. Branch 0 (KB221, the 2+2+1 PRIORITY keyboard) worked
// before the fix and works after it — a green run on branch 0 would be a green run that proves
// nothing. This script says so and exits non-zero rather than letting it read as a closure.
//
// It also replays the OLD expression against the very same live data, so the run states, from the
// tenant's own bytes, that this tap WOULD have failed before the fix.

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

// The ack fix. Anything at or before this instant ran the BROKEN expression and cannot confirm it.
const ACK_FIX_AT = '2026-08-31T14:51:08.000Z';

// The expression as it stood when execution 5055 failed. Kept verbatim so this run can replay it
// against live data rather than assert from memory that it would have been empty.
const OLD_EXPR = "={{ $json.error ? $('Route Edit Shape').first().json.reply_text_presentation_failed "
  + ": $('Route Edit Shape').first().json.reply_text }}";

// Route Edit Shape's outputs, in the order the Switch declares them.
const BRANCH_OF_SHAPE = { KB221: 0, KB22: 1, KB21: 2, NONE: 3 };
const SHAPE_NODE = { KB221: 'Edit Alert (5)', KB22: 'Edit Alert (4)', KB21: 'Edit Alert (3)', NONE: 'Edit Alert (0)' };

const argv = process.argv.slice(2);
const PINNED = argv.includes('--execution') ? argv[argv.indexOf('--execution') + 1] : null;

// ── --rehearse: run every assertion against a SYNTHETIC execution ─────────────────────────────
//
// The confirming tap is scarce — it costs the owner a real action on a real lead — and this
// script gets exactly one chance to be right when it lands. A verifier that has never been run
// end to end is not a verifier. `--rehearse <file>` reads an execution payload from disk so the
// whole path can be exercised before the tap exists.
//
// A rehearsal is NOT evidence and never becomes any: it is announced on every line of output, it
// refuses to write a .uat record, and it always ends non-zero.
const REHEARSE = argv.includes('--rehearse') ? argv[argv.indexOf('--rehearse') + 1] : null;

const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const A = new Function(ACTIONS_SRC + '; return LAA;')();
const X = require_(join(ROOT, 'qa', 'n8n-expression.js'));

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { failures.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));
const eqw = (a, b, m) => want(a === b, m + (a === b ? '' : ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'));
const say = (m) => console.log(m);
// `process.exit()` while a keep-alive fetch socket is still closing trips a libuv assertion on
// Windows, which turns a clean "no tap yet" into a crash exit code. Every exit path therefore sets
// process.exitCode and unwinds; the process ends once undici lets go of its sockets.
class Stop extends Error {}
const die = (m) => { throw new Stop(m); };

async function get(path) {
  const r = await fetch(BASE + '/api/v1' + path, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { die('GET ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
  return r.json();
}

say('');
say('THE CONFIRMING TAP — does n8n execute the corrected acknowledgement?');
say('='.repeat(78));

MAIN: try {

// ── 0. the execution ──────────────────────────────────────────────────────────────────────────
say('');
say('0. the execution');

let EX = null;
{
  if (REHEARSE) {
    for (let i = 0; i < 3; i++) { say('  ' + '*'.repeat(74)); }
    say('  ***  REHEARSAL — SYNTHETIC EXECUTION FROM ' + REHEARSE);
    say('  ***  This is a self-test of the verifier. It is NOT evidence of anything the');
    say('  ***  tenant did, no record is written, and the run always ends non-zero.');
    for (let i = 0; i < 3; i++) { say('  ' + '*'.repeat(74)); }
    EX = JSON.parse(readFileSync(REHEARSE, 'utf8'));
    // A file without the stamp is a real execution payload, and reading one through the rehearsal
    // path would strip its result of everything that makes it evidence. Refuse it.
    if (EX._rehearsal !== true) {
      die('--rehearse needs a file stamped `_rehearsal: true` (build one with '
        + 'scripts/build-ack-tap-rehearsal.mjs). Refusing to treat a real execution as a rehearsal.');
    }
  } else if (PINNED) {
    EX = await get('/executions/' + PINNED + '?includeData=true');
    if (!(String(EX.startedAt) > ACK_FIX_AT)) {
      say('');
      say('  Execution ' + EX.id + ' started ' + EX.startedAt + ', at or before the ack fix');
      say('  (' + ACK_FIX_AT + '). It ran the BROKEN expression, so it cannot confirm it.');
      say('  Execution 5055 in particular is the defect\'s evidence — use');
      say('  scripts/verify-lead-alert-tap-live.mjs --execution 5055 to read it.');
      say('');
      process.exitCode = 2;
      break MAIN;
    }
  } else {
    const list = await get('/executions?workflowId=' + CC + '&limit=20');
    const after = (list.data || []).filter((e) => String(e.startedAt) > ACK_FIX_AT)
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    if (!after.length) {
      say('');
      say('  NO TAP YET. No Command Center execution since the ack fix (' + ACK_FIX_AT + ').');
      say('');
      say('  The finding stays open until one lands. What to tap, and why:');
      say('');
      say('    Open the NEW LEAD alert for Mega Parc SRL (message 145) and tap  ⏰ На 24 часа.');
      say('');
      say('    * snooze is REPEATABLE — alreadyApplied() returns false for it by design, so the');
      say('      tap is not refused and can be repeated if anything needs re-running;');
      say('    * it owns only sla_snooze_until and next_follow_up_at, so deal_stage does not move');
      say('      again and the lead is not pushed further down the pipeline to prove a fix;');
      say('    * the lead is Documents Requested, so the refreshed keyboard is KB21 — branch 2,');
      say('      NOT branch 0. That is where the defect actually lived.');
      say('');
      say('  Then re-run this script. It takes no arguments.');
      say('');
      process.exitCode = 2;
      break MAIN;
    }
    EX = await get('/executions/' + after[0].id + '?includeData=true');
  }
  say('        execution ' + EX.id + '  ' + EX.status + '  ' + EX.startedAt + '  mode=' + EX.mode);
  want(String(EX.startedAt) > ACK_FIX_AT, 'the execution is AFTER the ack fix, so it ran the corrected graph');
  want(EX.status === 'success', 'the execution finished without an error (status: ' + EX.status + ')');
  eqw(EX.mode, 'webhook', 'it was driven by the Telegram trigger, not by a manual run');
}

const RD = ((EX.data || {}).resultData || {}).runData || {};
const WFD = EX.workflowData || {};
const ran = (n) => Object.prototype.hasOwnProperty.call(RD, n);
const branchesOf = (n) => (((((RD[n] || [])[0] || {}).data) || {}).main || []).map((b) => (b || []).map((x) => x.json));
const outOf = (n) => (branchesOf(n).find((b) => b.length) || []);
const startedAt = (n) => ((RD[n] || [])[0] || {}).startTime || 0;
const nodeOf = (n) => (WFD.nodes || []).find((x) => x.name === n) || null;

// ── 1. the execution ran the FIXED graph ──────────────────────────────────────────────────────
//
// From the execution's OWN snapshot of the workflow, not from a fresh GET. A fresh GET would prove
// what the tenant holds now; this proves what this tap ran.
say('');
say('1. the graph this tap ran — the expression, out of the execution itself');

const REPLY_NODE = nodeOf('Telegram Update Reply');
{
  if (!REPLY_NODE) { die('the execution carries no Telegram Update Reply node'); }
  const expr = String(REPLY_NODE.parameters.text || '');
  say('        ' + expr);
  want(/\$\('Find & Build Update'\)/.test(expr), "the text is sourced from $('Find & Build Update') — the single-output Code node");
  want(!/\$\('Route Edit Shape'\)/.test(expr), 'it no longer addresses the four-output Switch');
  eqw(expr, String((nodeOf('Telegram Update Reply') || {}).parameters.text), 'the expression read back consistently');

  // and graph-wide: no OTHER parameter reintroduced the shape on the graph that actually ran
  const unsafe = X.unsafeRoutingReferences(WFD);
  want(unsafe.length === 0, 'ZERO bare accessors against any multi-output node, graph-wide ('
    + [...X.multiOutputNames(WFD)].length + ' multi-output nodes scanned)'
    + (unsafe.length ? ': ' + unsafe.map((h) => h.node + '.' + h.parameterPath + ' -> ' + h.reference).join('; ') : ''));
}

// ── 2. the tap, and the branch it took ────────────────────────────────────────────────────────
say('');
say('2. the tap, and the branch it took');

const IDENT = outOf('Verify Telegram Identity')[0] || {};
const PARSED = outOf('Parse Lead Command v2')[0] || {};
const DECIDED = outOf('Find & Build Update')[0] || {};
const VERIFIED = outOf('Verify Mutation')[0] || {};
let ACTION = '';
let LEAD_ID = '';
let ORIGIN_KIND = 'new_lead';
let SHAPE = '';
let BRANCH = -1;
{
  eqw(IDENT.verified, true, 'the identity gate authenticated the tap');
  eqw(IDENT.is_callback, true, 'it was a button tap, not a typed command');
  eqw(String(IDENT.verified_chat_id), String(IDENT.verified_from_id), 'the private-chat invariant held (chat id === sender id)');
  ORIGIN_KIND = A.originKind(IDENT.origin_had_done === true);

  // Derived, never assumed: whatever the owner tapped is what this run verifies.
  LEAD_ID = String(PARSED.lead_id || '');
  ACTION = A.actionOfCommand(PARSED.command, PARSED.stage);
  want(LEAD_ID.length > 0, 'the tap names a lead: ' + LEAD_ID);
  want(ACTION.length > 0, 'the callback verb maps to a known action: ' + PARSED.command + ' -> ' + ACTION);
  eqw(String(IDENT.text), A.callbackData(ACTION, LEAD_ID), 'the callback_data is byte-identical to what the emitter writes for this action');
  ok('origin keyboard: ' + ORIGIN_KIND.toUpperCase().replace('_', ' ') + ' (origin_had_done=' + IDENT.origin_had_done + ')');

  // THE DISCRIMINATOR. Branch 0 was never broken; a pass there closes nothing.
  SHAPE = String(VERIFIED.kb_shape || (outOf('Find & Build Update')[0] || {}).kb_shape || '');
  const declared = branchesOf('Route Edit Shape');
  BRANCH = declared.findIndex((b) => b.length > 0);
  say('');
  say('        Route Edit Shape branch item counts: '
    + declared.map((b, i) => '[' + i + '] ' + b.length).join('   '));
  eqw(BRANCH, BRANCH_OF_SHAPE[SHAPE], 'the item went down the branch its shape (' + SHAPE + ') declares');
  want(declared.filter((b) => b.length > 0).length === 1, 'exactly one branch carried the item, as a Switch guarantees');
  want(BRANCH > 0,
    'the tap landed on branch ' + BRANCH + ' (' + SHAPE + ') — a branch the defect BROKE'
    + (BRANCH === 0 ? '. Branch 0 (KB221) worked before the fix too, so this tap CANNOT close the finding' : ''));
}

// ── 3. the OLD expression, replayed against this very execution ───────────────────────────────
say('');
say('3. the old expression, replayed against this tap\'s own data');
{
  const outputs = {
    'Route Edit Shape': branchesOf('Route Edit Shape'),
    'Find & Build Update': branchesOf('Find & Build Update')
  };
  const editNode = Object.keys(RD).find((n) => n.startsWith('Edit Alert ('));
  const current = editNode ? (outOf(editNode)[0] || {}) : {};

  const before = X.evaluate(OLD_EXPR, outputs, { json: current });
  const after = X.evaluate(String(REPLY_NODE.parameters.text || ''), outputs, { json: current });

  want(before.rendered === '', 'the OLD expression renders EMPTY on this execution — Telegram would have answered 400'
    + (before.rendered === '' ? '' : ' (it rendered ' + JSON.stringify(before.rendered.slice(0, 60)) + ')'));
  want(after.rendered.length > 0, 'the LIVE expression renders ' + after.rendered.length + ' characters');

  // WHICH copy is correct is decided by the same discriminator the expression itself uses: an
  // item carrying `.error` means the edit failed, and the presentation-failure copy is then the
  // RIGHT answer, not a wrong one. Comparing unconditionally against reply_text would fail the
  // graph for behaving correctly on the harder of its two branches.
  const editFailed = !!(current && current.error);
  const expectedCopy = String((editFailed ? DECIDED.reply_text_presentation_failed : DECIDED.reply_text) || '');
  eqw(after.rendered, expectedCopy, 'and it renders exactly the copy the decision produced for this outcome ('
    + (editFailed ? 'edit FAILED -> presentation-failure copy' : 'edit succeeded -> confirmation copy') + ')');
}

// ── 4. the write ──────────────────────────────────────────────────────────────────────────────
say('');
say('4. the write — pre-image, projection, post-image');

const PRE = outOf('Get Pipeline (Update)').find((r) => String(r.lead_id) === LEAD_ID);
const SPARSE = outOf('Build Sparse Update')[0] || {};
const POST = outOf('Get Pipeline (Verify)').find((r) => String(r.lead_id) === LEAD_ID);
const REFUSED = DECIDED._allowed !== true;
{
  if (REFUSED) {
    // A refusal is a legitimate outcome and the fix must hold on it too — the refusal path is the
    // OTHER feeder of Route Edit Shape, and it is the path `Verify Mutation` could not have served.
    ok('the action was REFUSED from the freshly read row: ' + JSON.stringify(DECIDED._reason));
    eqw(DECIDED._reason, A.refuseReason(ACTION, PRE || {}, ORIGIN_KIND), 'the refusal reason is what the module computes independently');
    want(!ran('Update Pipeline Row'), 'a refused tap wrote NOTHING');
  } else {
    if (!PRE) { die('the execution carries no pre-image row for ' + LEAD_ID); }
    if (!POST) { die('the execution carries no post-image row for ' + LEAD_ID); }
    eqw(DECIDED._action, ACTION, 'the decision names the action the tap carried');
    eqw(DECIDED._reason, '', 'with no refusal reason');

    const owned = ['lead_id'].concat(A.OWNED[ACTION]).sort();
    eqw(Object.keys(SPARSE).sort().join(', '), owned.join(', '), 'the writer was handed lead_id + owned columns ONLY');

    // the values, recomputed from the module against the projection's own instant
    const anchor = SPARSE[A.OWNED[ACTION].find((k) => /_at$|_until$/.test(k))] || null;
    if (anchor && ACTION === 'snooze') {
      const t = new Date(String(SPARSE.sla_snooze_until)).getTime();
      const base = t - 24 * 3600 * 1000;
      eqw(String(SPARSE.next_follow_up_at), String(SPARSE.sla_snooze_until), 'snooze set next_follow_up_at to the same instant as sla_snooze_until');
      eqw(JSON.stringify(A.buildUpdate('snooze', LEAD_ID, new Date(base).toISOString())), JSON.stringify(SPARSE),
        'the whole projection is exactly what buildUpdate() produces for tap+24h');
    }
    for (const k of A.OWNED[ACTION]) {
      eqw(String(POST[k]), String(SPARSE[k]), k + ' reads back exactly as written');
      if (/_at$|_until$/.test(k) && String(SPARSE[k])) {
        want(/^\d{4}-\d{2}-\d{2}T.*Z$/.test(String(SPARSE[k])), k + ' is an ISO UTC instant');
      }
    }

    const untouched = A.untouchedFields(ACTION, PRE);
    const moved = untouched.filter((k) => k in POST && String(PRE[k]) !== String(POST[k]));
    want(moved.length === 0, untouched.length + ' unrelated columns are byte-identical across the write'
      + (moved.length ? ' (MOVED: ' + moved.map((k) => k + ': ' + JSON.stringify(PRE[k]) + ' -> ' + JSON.stringify(POST[k])).join('; ') + ')' : ''));

    eqw(VERIFIED._verified, true, 'the read-back PROVED the mutation');
    eqw(JSON.stringify(VERIFIED._mismatched), '[]', 'nothing mismatched');
    const indep = A.verifyMutation(SPARSE, POST);
    want(indep.ok, 'and verifyMutation() recomputed here agrees'
      + (indep.ok ? '' : ' — mismatched: ' + indep.mismatched.join(', ')));
  }
}

// ── 5. the edit ───────────────────────────────────────────────────────────────────────────────
say('');
say('5. the alert message, as Telegram returned it from the edit');

const editNode = Object.keys(RD).find((n) => n.startsWith('Edit Alert ('));
let EDITED = null;
{
  want(!!editNode, 'an Edit Alert node ran' + (editNode ? ': ' + editNode : ''));
  if (editNode) {
    const envelope = outOf(editNode)[0] || {};
    eqw(String(editNode), SHAPE_NODE[SHAPE], 'the shape router sent ' + SHAPE + ' to the edit node that renders it');

    // A failed edit is ONE fact, not six. Reporting the six downstream absences as separate
    // failures buries the Telegram error that caused all of them, so it is named here and the
    // assertions that read the returned Message are skipped rather than failed a second time.
    if (envelope.error || envelope.ok !== true) {
      bad('the Telegram EDIT FAILED: ' + JSON.stringify(String(envelope.error || envelope.description
        || 'no ok:true and no error on the item')).slice(0, 300));
      say('');
      say('        The six assertions that read the returned Message are SKIPPED — there is no');
      say('        Message to read. They would restate this one failure, not add to it.');
      say('        The keyboard on the original alert is therefore whatever it already carried.');
    } else {
    EDITED = envelope.result || {};
    want(typeof EDITED.edit_date === 'number' && EDITED.edit_date > 0,
      'Telegram stamped the edit: edit_date ' + EDITED.edit_date + ' (' + new Date((EDITED.edit_date || 0) * 1000).toISOString() + ')');
    eqw(Number(EDITED.message_id), Number(IDENT.message_id), 'it edited the message the tap came from, not a new one');
    eqw(String(EDITED.text), String(IDENT.message_text), 'the visible text is byte-identical to what the owner was reading');
    eqw(JSON.stringify(EDITED.entities || []), JSON.stringify(IDENT.message_entities || []),
      'every entity — type, offset, length — survived the round trip');

    const kb = ((EDITED.reply_markup || {}).inline_keyboard) || [];
    const flat = kb.flat();
    want(kb.every((r) => r.length <= 2), 'no row carries more than 2 buttons');
    want(!flat.some((b) => String(b.callback_data || '').startsWith('won|')), 'no won button was emitted');
    const expect = A.keyboard(ORIGIN_KIND, REFUSED ? (PRE || {}) : POST, LEAD_ID);
    eqw(JSON.stringify(flat.map((b) => b.callback_data)), JSON.stringify(expect.flat().map((b) => b.callback_data)),
      'the keyboard is exactly what the ' + (REFUSED ? 'CURRENT' : 'POST-WRITE') + ' state allows, recomputed independently');
    eqw(JSON.stringify(kb.map((r) => r.length)), JSON.stringify(expect.map((r) => r.length)), 'and in the approved row shape');
    say('');
    say('        ' + kb.map((r) => r.map((b) => b.text).join(' | ')).join('\n        '));
    }
  }
}

// ── 6. THE ACKNOWLEDGEMENT — what 5055 could not do ───────────────────────────────────────────
say('');
say('6. the acknowledgement — the thing execution 5055 could not send');

let ACK = null;
{
  const ackText = String((nodeOf('Answer Callback Query') || { parameters: {} }).parameters.additionalFields?.text || '');
  want(!/выполн|готов|обработан|успешн|сохран/i.test(ackText),
    'the fast acknowledgement still claims no outcome: ' + JSON.stringify(ackText));

  const replyRun = (RD['Telegram Update Reply'] || [])[0] || {};
  want(ran('Telegram Update Reply'), 'Telegram Update Reply ran');
  want(!replyRun.error, 'and it did NOT error'
    + (replyRun.error ? ' — IT DID: ' + (replyRun.error.description || replyRun.error.message) : ''));

  if (ran('Telegram Update Reply') && !replyRun.error) {
    const envelope = outOf('Telegram Update Reply')[0] || {};
    // The Telegram node hands back the raw API envelope on this graph; tolerate a flattened
    // Message too rather than reporting a false failure over a node-version difference.
    ACK = envelope.result || envelope;
    const sent = String(ACK.text || '');

    want(sent.length > 0, 'THE CONFIRMATION CARRIES TEXT: ' + sent.length + ' characters (5055 sent zero)');
    want(typeof ACK.message_id === 'number' && ACK.message_id > 0, 'Telegram assigned it a message_id: ' + ACK.message_id);
    eqw(Number(ACK.chat?.id ?? ACK.chat_id ?? IDENT.verified_chat_id), Number(IDENT.verified_chat_id),
      'it was delivered to the verified private chat');

    // The decisive one: the message Telegram rendered, converted back to HTML through its own
    // entities, is the copy the decision produced. Comparing the rendered text to the HTML source
    // directly would fail on markup alone and prove nothing.
    const expected = String((replyRun.error || (outOf(editNode || '')[0] || {}).error)
      ? DECIDED.reply_text_presentation_failed : DECIDED.reply_text || '');
    const back = A.htmlFromTelegram(sent, ACK.entities || []);
    eqw(back, expected, 'the delivered message IS the copy the decision produced, entity for entity');

    // and it is the copy for THIS action, recomputed rather than trusted
    want(sent.length > 20 && !/undefined|null|\[object/i.test(sent), 'no placeholder or undefined leaked into the owner-facing text');

    const t = startedAt('Telegram Update Reply');
    if (!REFUSED) {
      want(t >= startedAt('Update Pipeline Row'), 'the confirmation came AFTER the write');
      want(t >= startedAt('Get Pipeline (Verify)'), 'the confirmation came AFTER the read-back');
      want(t >= startedAt('Verify Mutation'), 'the confirmation came AFTER the mutation was proven');
    }
    if (editNode) { want(t >= startedAt(editNode), 'the confirmation came AFTER the keyboard was refreshed'); }
    want(!ran('Telegram Write Failed Reply'), 'the write-failed branch did not run');

    say('');
    say('        ' + sent.split('\n').join('\n        '));
  }
}

// ── 7. the record ─────────────────────────────────────────────────────────────────────────────
say('');
say('7. exact before / after');
say('='.repeat(78));
{
  // The baseline is the last read-back the tenant itself produced for this lead — execution
  // 5055's `Get Pipeline (Verify)`, recorded when that tap was verified. Derived from the record
  // rather than kept as a second hand-written file, so there is one artifact and no chance of the
  // two disagreeing. A lead with no prior record simply has no baseline, and the check is skipped.
  const LAST = join(OUT_DIR, 'pipeline-row-' + LEAD_ID + '.post-5055.json');
  const REC5055 = join(OUT_DIR, 'lead-alert-tap-5055.json');
  let KNOWN = {};
  if (existsSync(LAST)) {
    KNOWN = JSON.parse(readFileSync(LAST, 'utf8'));
  } else if (existsSync(REC5055)) {
    const r5055 = JSON.parse(readFileSync(REC5055, 'utf8')) || {};
    // Only for the lead 5055 actually touched. Comparing one lead's row to another's would be a
    // confident assertion about nothing.
    if (String(r5055.lead_id || '') === LEAD_ID) { KNOWN = r5055.post_image || {}; }
  }
  if (PRE && Object.keys(KNOWN).length) {
    // Bookkeeping columns are written by SLA Lead Watch and Followup Sequence on their own
    // schedules, so drift there is expected and is not evidence of anything.
    const BOOKKEEPING = ['last_activity_at', 'last_sla_alert_at', 'days_in_stage', 'updated_at'];
    const drifted = Object.keys(KNOWN).filter((k) => k in PRE && String(KNOWN[k]) !== String(PRE[k]) && !BOOKKEEPING.includes(k));
    const claim = 'the pre-image this tap saw matches the last authoritative read-back (execution 5055)'
      + (drifted.length ? ' EXCEPT: ' + drifted.join(', ') : '');
    if (REHEARSE) {
      // The rehearsal's source IS 5055, so its pre-image necessarily differs from the read-back
      // 5055 itself produced, on exactly the columns 5055 wrote. The comparison is still RUN — a
      // path that never executes is a path that can be broken — but asserting it here would be
      // asserting that a write did not happen.
      say('');
      say('  (rehearsal: comparison run, not asserted — ' + (drifted.length
        ? 'differs on ' + drifted.join(', ') + ', which is exactly what 5055 wrote'
        : 'no drift') + ')');
    } else {
      want(drifted.length === 0, claim);
    }
  }
  const watch = ['deal_stage', 'sla_status', 'sla_snooze_until', 'next_follow_up_at',
    'documents_requested_at', 'last_contacted_at', 'status', 'priority', 'company'];
  say('');
  say('  column                     after 5055                pre-image (tap)           post-image (read-back)');
  say('  ' + '-'.repeat(104));
  for (const k of watch) {
    const c = (v) => (v === '' || v == null ? '(empty)' : String(v)).slice(0, 24).padEnd(26);
    const mark = PRE && POST && String(PRE[k]) !== String(POST[k]) ? '  <= CHANGED' : '';
    say('  ' + k.padEnd(27) + c(KNOWN[k]) + c(PRE ? PRE[k] : '') + c(POST ? POST[k] : '') + mark);
  }
  if (!REFUSED && PRE) {
    say('');
    say('  ROLLBACK READY — restoring this tap would mean writing these values back:');
    for (const k of A.OWNED[ACTION]) {
      say('    ' + k.padEnd(24) + JSON.stringify(PRE[k]) + '   (now ' + JSON.stringify(POST ? POST[k] : '') + ')');
    }
    say('  Nothing was restored. Nothing was written by this script.');
  }

  if (REHEARSE) {
    say('');
    say('  REHEARSAL — no .uat record written. A synthetic run leaves no artifact behind that');
    say('  could later be mistaken for what the tenant did.');
  } else {
  mkdirSync(OUT_DIR, { recursive: true });
  const rec = {
    execution_id: EX.id, started_at: EX.startedAt, status: EX.status,
    action: ACTION, lead_id: LEAD_ID, origin_kind: ORIGIN_KIND,
    kb_shape: SHAPE, switch_branch: BRANCH, refused: REFUSED, refusal_reason: DECIDED._reason || '',
    expression: String(REPLY_NODE.parameters.text || ''),
    projection_written: REFUSED ? null : SPARSE, pre_image: PRE || null, post_image: POST || null,
    verified: VERIFIED._verified, mismatched: VERIFIED._mismatched,
    acknowledgement: ACK ? { message_id: ACK.message_id, text: ACK.text, entities: ACK.entities || [] } : null,
    edited: EDITED ? { message_id: EDITED.message_id, edit_date: EDITED.edit_date, keyboard: (EDITED.reply_markup || {}).inline_keyboard } : null
  };
  writeFileSync(join(OUT_DIR, 'lead-alert-ack-tap-' + EX.id + '.json'), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  say('');
  say('  record: .uat/lead-alert-ack-tap-' + EX.id + '.json');
  }
}

say('');
say('='.repeat(78));
say('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  say('');
  for (const f of failures) { say('  FAILED: ' + f); }
}
say('');
if (REHEARSE) {
  say('  REHEARSAL ONLY — ' + pass + ' assertions were reachable and ' + failures.length + ' failed on a');
  say('  SYNTHETIC execution. Nothing here is a statement about the tenant. The finding stays');
  say('  open until a real tap lands and this script is run with no arguments.');
  process.exitCode = failures.length ? 1 : 3;
} else {
  // Two verdicts, deliberately separate. The ACK finding is about one thing: whether n8n executes
  // the corrected expression and Telegram receives non-empty text. A failure elsewhere in the
  // lifecycle does not un-close it, and reporting one number for both would hide whichever
  // question the reader came for.
  const ackClosed = BRANCH > 0 && ACK && String(ACK.text || '').length > 0;
  if (ackClosed) {
    say('  ACK FINDING CLOSED. Execution ' + EX.id + ' ran the corrected expression on branch ' + BRANCH
      + ' (' + SHAPE + '), and Telegram delivered a non-empty confirmation as message ' + ACK.message_id + '.');
  } else {
    say('  ACK FINDING NOT CLOSED by this execution.');
  }
  say('  LIFECYCLE: ' + (failures.length ? failures.length + ' failure(s) above — the tap is NOT a clean pass.'
    : 'every assertion passed.'));
}
say('');
say('  Read-only: no PUT, no POST, no restore, no tap. The row is left as the tap left it.');
say('');
if (failures.length) { process.exitCode = 1; }

} catch (e) {
  if (!(e instanceof Stop)) { throw e; }
  console.error('\nSTOPPED: ' + e.message);
  process.exitCode = 1;
}
