#!/usr/bin/env node
// FINMENTOR — send ONE fresh owner alert for a named lead, from its CURRENT live Pipeline state.
//
//   node scripts/send-fresh-lead-alert-uat.mjs --dry-run
//   node scripts/send-fresh-lead-alert-uat.mjs --confirm
//
// ── WHAT IT DOES AND DOES NOT TOUCH ───────────────────────────────────────────────────────────
//
// It sends ONE Telegram message. It writes NOTHING to the Pipeline: no `last_sla_alert_at`, no
// Status_Log, no Activity. The production SLA path writes those because it alerts on a schedule
// and must not spam; this alert is a single UAT press requested by the owner, so the bookkeeping
// that exists to rate-limit a scheduler has no business firing.
//
// No action is replayed. No row is restored. No button is pressed.
//
// ── WHY A DISPOSABLE WORKFLOW ─────────────────────────────────────────────────────────────────
//
// The Sheets and Telegram credentials live in n8n and are reachable only through n8n's own nodes.
// So the read and the send each run in a workflow that is created, used once, and deleted — the
// same method as scripts/repair-uat-pipeline-row.mjs.
//
// ── THE PRESENTATION IS PRODUCTION'S, NOT THIS SCRIPT'S ───────────────────────────────────────
//
// The alert body, the keyboard and the Telegram node are COPIED BYTE-FOR-BYTE from the live
// `FINMENTOR SLA Lead Watch PREMIUM FINAL` (LZ2mvKXbBikmeVTn), fetched fresh at run time:
//
//   Read Settings · Settings to Object · Get Pipeline Rows   — verbatim
//   Build SLA Alert Keyboard · SLA Keyboard Shape            — verbatim
//   Telegram SLA Alert (4)                                   — verbatim
//
// Exactly ONE node is this script's own: the renderer that stands in for `SLA Select`. It reuses
// SLA Select's own inlined prelude (tz + presenter + actions, byte-identical) and its own model
// construction; what it drops is the SELECTION — the HOT/WARM, stage, overdue and anti-spam
// filters that decide which leads a SCHEDULED sweep alerts on. Those filters are why the lead is
// not being alerted right now (it was last alerted inside the repeat window), and they are not a
// statement about whether this alert is correct. Everything the owner will read is rendered by
// `LA.renderPriority` and `LAA.keyboard`, unchanged.
//
// ── WHAT IT REFUSES ───────────────────────────────────────────────────────────────────────────
//
//   1. exactly one Pipeline row may match the lead id;
//   2. the keyboard must be derived from the row it just read, and must match this script's own
//      independent recomputation;
//   3. no button may offer an action the current state already is (D11) — for a lead at
//      `Documents Requested` that means NO 📄 Документы;
//   4. no row may carry more than two buttons;
//   5. the shape must be KB22, which is the only shape `Telegram SLA Alert (4)` renders — a
//      mismatch aborts before anything is sent rather than sending a truncated keyboard;
//   6. after the send, the delivered message is read back from Telegram's own response and
//      compared to the offline render, entity for entity and button for button.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const require_ = createRequire(import.meta.url);

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const SLA_WF = 'LZ2mvKXbBikmeVTn';
const LEAD_ID = 'FIN-1788113619104-582';
const EXPECT_SHAPE = 'KB22';
const KIND = 'priority';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const say = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (v) => JSON.stringify(v);
class Stop extends Error {}
const die = (m) => { throw new Stop(m); };

let pass = 0;
const failures = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { failures.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));
const eqw = (a, b, m) => want(a === b, m + (a === b ? '' : '\n            got  ' + j(a) + '\n            want ' + j(b)));

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

const LA = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'));
const LATZ = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'));
const LAA = new Function(
  readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n')
  + '; return LAA;')();

const created = [];
process.on('exit', () => {
  if (created.length) { console.error('WARNING: disposable workflows left behind: ' + created.join(', ')); }
});

async function cleanup() {
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
}

async function runDisposable(name, path, nodes, connections) {
  const wf = await api('POST', '/workflows', { name, nodes, connections, settings: {} });
  created.push(wf.id);
  await api('POST', '/workflows/' + wf.id + '/activate');
  await sleep(2500);
  let last = null;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(BASE + '/webhook/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const t = await r.text();
    if (r.ok) { try { return JSON.parse(t); } catch (e) { return { __raw: t }; } }
    last = r.status + ' ' + t.slice(0, 300);
    await sleep(2000);
  }
  throw new Error('disposable ' + name + ' did not answer: ' + last);
}

say('');
say('FRESH OWNER ALERT — ' + LEAD_ID);
say('='.repeat(78));
say('  MODE: ' + (DRY ? 'DRY RUN — nothing is sent' : 'LIVE — one Telegram message will be sent'));

MAIN: try {
  const missing = [];
  if (!BASE) { missing.push('N8N_BASE_URL'); }
  if (!READ_KEY) { missing.push('N8N_API_KEY'); }
  if (!WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
  if (missing.length) { die('set these first: ' + missing.join(', ')); }
  if (!DRY && !CONFIRM) { die('this sends a real Telegram message; re-run with --confirm (or --dry-run first)'); }

  mkdirSync(OUT_DIR, { recursive: true });

  // ── 1. the production emitter, fetched fresh ────────────────────────────────────────────────
  say('');
  say('1. the production emitter — copied, not re-implemented');

  const SLA = await api('GET', '/workflows/' + SLA_WF);
  const src = (n) => {
    const found = (SLA.nodes || []).find((x) => x.name === n);
    if (!found) { die('the live SLA workflow has no node named ' + j(n)); }
    return JSON.parse(JSON.stringify(found));
  };
  say('        source: ' + SLA.name + '  (' + SLA_WF + ', ' + (SLA.nodes || []).length + ' nodes, active ' + SLA.active + ')');

  const nRead = src('Read Settings');
  const nSettings = src('Settings to Object');
  const nRows = src('Get Pipeline Rows');
  const nKb = src('Build SLA Alert Keyboard');
  const nShape = src('SLA Keyboard Shape');
  const nSend = src('Telegram SLA Alert (4)');
  const nSelect = src('SLA Select');

  for (const n of [nRead, nSettings, nRows, nKb, nShape, nSend]) { ok('copied verbatim: ' + n.name); }
  say('        Telegram credential: ' + j((nSend.credentials || {}).telegramApi));
  say('        Sheets credential:   ' + j((nRows.credentials || {}).googleSheetsOAuth2Api));

  // The renderer reuses SLA Select's OWN inlined prelude — tz + presenter + actions, byte for
  // byte as deployed — and replaces only the tail that decides WHICH leads a scheduled sweep
  // alerts on.
  const selectSrc = String(nSelect.parameters.jsCode).replace(/\r\n/g, '\n');
  const lines = selectSrc.split('\n');
  let lastWrap = -1;
  lines.forEach((l, i) => { if (/^\}\)\(\);\s*$/.test(l)) { lastWrap = i; } });
  if (lastWrap < 0) { die('could not find the end of SLA Select\'s inlined prelude'); }
  const PRELUDE = lines.slice(0, lastWrap + 1).join('\n');
  ok('reused SLA Select\'s inlined prelude verbatim (' + (lastWrap + 1) + ' lines: tz + presenter + actions)');

  const RENDER_TAIL = `

// ── UAT — ONE named lead, rendered from its CURRENT row ──────────────────────────────────────
//
// The PRESENTATION below is production's, unchanged: the same model fields, the same
// LA.renderPriority, the same offset resolution. What is deliberately absent is the SELECTION —
// the HOT/WARM, stop-stage, overdue and anti-spam filters that decide which leads a SCHEDULED
// sweep alerts on. This alert is not scheduled; it was asked for, by lead id.
//
// It writes nothing. There is no Mark SLA Alerted downstream, so last_sla_alert_at does not move.
const cfg = $('Settings to Object').first().json.settings || {};
const rows = $('Get Pipeline Rows').all().map((i) => i.json);
const now = new Date();
const TARGET = ${JSON.stringify(LEAD_ID)};

function val(r) { for (var i = 1; i < arguments.length; i++) { var k = arguments[i];
  if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') { return String(r[k]).trim(); } } return ''; }
function hoursSince(ts) { const d = new Date(ts); return Number.isNaN(d.getTime()) ? Infinity : (now - d) / 36e5; }

const matches = rows.filter((x) => String(x.lead_id == null ? '' : x.lead_id).trim() === TARGET);
if (matches.length !== 1) { throw new Error('expected exactly 1 Pipeline row for ' + TARGET + ', found ' + matches.length); }
const r = matches[0];

const priority = val(r, 'priority').toUpperCase();
const slaHours = priority === 'HOT' ? Number(cfg.sla_hot_hours || 4) : Number(cfg.sla_warm_hours || 24);
const follow = val(r, 'next_follow_up_at');
const createdAt = val(r, 'created_at');
const overdueByFollow = follow ? (new Date(follow) < now) : false;

const company = val(r, 'company') || '—';
const action = val(r, 'next_action') || 'связаться с лидом';
const OFFSET = LATZ.tzOffsetMinutes(cfg.timezone || 'Europe/Chisinau', now);

const reason = overdueByFollow
  ? 'Запланированный контакт просрочен.'
  : 'Нет ответа больше ' + slaHours + ' ' + LA.plural(slaHours, 'часа', 'часов', 'часов') + '.';
const dueAt = overdueByFollow ? follow
  : (createdAt ? new Date(new Date(createdAt).getTime() + slaHours * 36e5).toISOString() : '');

const alert_html = LA.renderPriority({
  company: company, reason: reason, nextAction: action, dueAt: dueAt,
  now: now.toISOString(), offsetMinutes: OFFSET, leadId: TARGET
});

return [{ json: {
  lead_id: TARGET, company: company, name: val(r, 'name') || '—',
  financial_zone: val(r, 'financial_zone') || '—', priority: priority,
  alert_html: alert_html,
  _row: r, _settings: cfg, _offset: OFFSET, _reason: reason, _due_at: dueAt, _now: now.toISOString()
} }];
`;

  const codeNode = (name, jsCode, pos) => ({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
    id: 'n-' + crypto.randomBytes(6).toString('hex'), name,
    type: 'n8n-nodes-base.code', typeVersion: 2, position: pos
  });
  const reposition = (n, pos, id) => { n.position = pos; n.id = id || ('n-' + crypto.randomBytes(6).toString('hex')); return n; };
  const webhook = (path) => ({
    parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', options: {} },
    id: 'n-wh', name: 'WH', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [-260, 0]
  });

  // ── 2. read the CURRENT row ─────────────────────────────────────────────────────────────────
  say('');
  say('2. the current live Pipeline row, read through a disposable reader');

  const readerPath = 'uat-alert-read-' + crypto.randomBytes(8).toString('hex');
  const readerNodes = [
    webhook(readerPath),
    reposition(JSON.parse(j(nRead)), [-40, 0]),
    reposition(JSON.parse(j(nSettings)), [180, 0]),
    reposition(JSON.parse(j(nRows)), [400, 0]),
    codeNode('Pick Row', `
const cfg = $('Settings to Object').first().json.settings || {};
const rows = $input.all().map((i) => i.json);
const t = ${JSON.stringify(LEAD_ID)};
const matches = rows.filter((x) => String(x.lead_id == null ? '' : x.lead_id).trim() === t);
return [{ json: { matched: matches.length, row: matches[0] || null, settings: cfg, total_rows: rows.length } }];
`, [620, 0])
  ];
  const readerConns = {
    WH: { main: [[{ node: 'Read Settings', type: 'main', index: 0 }]] },
    'Read Settings': { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
    'Settings to Object': { main: [[{ node: 'Get Pipeline Rows', type: 'main', index: 0 }]] },
    'Get Pipeline Rows': { main: [[{ node: 'Pick Row', type: 'main', index: 0 }]] }
  };

  const read = await runDisposable('reader', readerPath, readerNodes, readerConns);
  await cleanup();

  const R = Array.isArray(read) ? read[0] : read;
  if (!R || !R.row) { die('the reader returned no row for ' + LEAD_ID + ' (' + j(R && R.matched) + ' matches)'); }
  const ROW = R.row;
  const SETTINGS = R.settings || {};
  eqw(Number(R.matched), 1, 'exactly ONE Pipeline row matches ' + LEAD_ID + ' (of ' + R.total_rows + ' rows)');
  say('');
  for (const k of ['company', 'priority', 'deal_stage', 'sla_status', 'sla_snooze_until',
    'next_follow_up_at', 'documents_requested_at', 'last_contacted_at', 'last_sla_alert_at']) {
    say('        ' + k.padEnd(24) + j(ROW[k]));
  }
  say('');
  eqw(String(ROW.deal_stage), 'Documents Requested', 'the row is at deal_stage Documents Requested, as expected');

  // ── 3. the keyboard the current state allows ────────────────────────────────────────────────
  say('');
  say('3. the keyboard, derived from that row and recomputed here independently');

  const KB = LAA.keyboard(KIND, ROW, LEAD_ID);
  const SHAPE = LAA.shape(KB);
  const flat = KB.flat();
  say('');
  for (const row of KB) { say('        ' + row.map((b) => b.text).join('   |   ')); }
  say('');
  for (const b of flat) { say('        ' + b.text.padEnd(18) + b.callback_data); }
  say('');
  eqw(SHAPE, EXPECT_SHAPE, 'the shape is ' + EXPECT_SHAPE + ' — the only shape Telegram SLA Alert (4) renders');
  want(!flat.some((b) => String(b.callback_data).startsWith('docs|')),
    '📄 Документы is NOT offered — the lead is already at Documents Requested (D11)');
  want(KB.every((r) => r.length <= 2), 'no row carries more than 2 buttons');
  want(!flat.some((b) => String(b.callback_data).startsWith('won|')), 'no won button');
  want(flat.some((b) => String(b.callback_data) === LAA.callbackData('snooze', LEAD_ID)),
    '⏰ На 24 часа is present, with callback_data ' + j(LAA.callbackData('snooze', LEAD_ID)));
  const expectedActions = LAA.chooseActions(KIND, ROW);
  eqw(j(flat.map((b) => b.text)), j(expectedActions.map((a) => LAA.LABEL[a])),
    'every button is exactly what chooseActions() allows for this row, in order');

  // ── 4. the alert body, rendered offline for comparison ──────────────────────────────────────
  say('');
  say('4. the alert body, rendered offline with the same production code');

  const now = new Date();
  const priority = String(ROW.priority || '').toUpperCase();
  const slaHours = priority === 'HOT' ? Number(SETTINGS.sla_hot_hours || 4) : Number(SETTINGS.sla_warm_hours || 24);
  const follow = String(ROW.next_follow_up_at || '').trim();
  const createdAt = String(ROW.created_at || '').trim();
  const overdueByFollow = follow ? (new Date(follow) < now) : false;
  const OFFSET = LATZ.tzOffsetMinutes(SETTINGS.timezone || 'Europe/Chisinau', now);
  const reason = overdueByFollow ? 'Запланированный контакт просрочен.'
    : 'Нет ответа больше ' + slaHours + ' ' + LA.plural(slaHours, 'часа', 'часов', 'часов') + '.';
  const dueAt = overdueByFollow ? follow
    : (createdAt ? new Date(new Date(createdAt).getTime() + slaHours * 36e5).toISOString() : '');
  const HTML = LA.renderPriority({
    company: String(ROW.company || '—'), reason, nextAction: String(ROW.next_action || 'связаться с лидом'),
    dueAt, now: now.toISOString(), offsetMinutes: OFFSET, leadId: LEAD_ID
  });
  const v = LA.validate(HTML) || [];
  want(v.length === 0, 'the rendered HTML passes the presenter\'s own validate()'
    + (v.length ? ': ' + v.join('; ') : ''));
  say('');
  say(HTML.split('\n').map((l) => '        ' + l).join('\n'));
  say('');

  if (DRY) {
    say('='.repeat(78));
    say('  ' + pass + ' passed, ' + failures.length + ' failed');
    say('');
    say('  DRY RUN — nothing was sent. No Telegram message, no Pipeline write, no button pressed.');
    say('  Re-run with --confirm to send exactly this alert.');
    say('');
    if (failures.length) { process.exitCode = 1; }
    break MAIN;
  }
  if (failures.length) { die(failures.length + ' checks failed before sending — nothing was sent'); }

  // ── 5. send ─────────────────────────────────────────────────────────────────────────────────
  say('');
  say('5. sending — one message, through production\'s own Telegram node');

  const senderPath = 'uat-alert-send-' + crypto.randomBytes(8).toString('hex');
  const senderNodes = [
    webhook(senderPath),
    reposition(JSON.parse(j(nRead)), [-40, 0]),
    reposition(JSON.parse(j(nSettings)), [180, 0]),
    reposition(JSON.parse(j(nRows)), [400, 0]),
    codeNode('Render Alert (UAT)', PRELUDE + RENDER_TAIL, [620, 0]),
    reposition(JSON.parse(j(nKb)), [840, 0]),
    reposition(JSON.parse(j(nShape)), [1060, 0]),
    reposition(JSON.parse(j(nSend)), [1280, 100]),
    codeNode('Refuse Unexpected Shape', `
throw new Error('the keyboard came out as ' + $json.kb_shape + ', not ${EXPECT_SHAPE} — nothing was sent');
`, [1280, -120])
  ];
  const senderConns = {
    WH: { main: [[{ node: 'Read Settings', type: 'main', index: 0 }]] },
    'Read Settings': { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
    'Settings to Object': { main: [[{ node: 'Get Pipeline Rows', type: 'main', index: 0 }]] },
    'Get Pipeline Rows': { main: [[{ node: 'Render Alert (UAT)', type: 'main', index: 0 }]] },
    'Render Alert (UAT)': { main: [[{ node: 'Build SLA Alert Keyboard', type: 'main', index: 0 }]] },
    'Build SLA Alert Keyboard': { main: [[{ node: 'SLA Keyboard Shape', type: 'main', index: 0 }]] },
    // out0 is KB221, which this sender cannot render. It refuses instead of truncating.
    'SLA Keyboard Shape': {
      main: [
        [{ node: 'Refuse Unexpected Shape', type: 'main', index: 0 }],
        [{ node: 'Telegram SLA Alert (4)', type: 'main', index: 0 }]
      ]
    }
  };
  want(!senderNodes.some((n) => /googleSheets/.test(String(n.type)) && /update|append/i.test(j(n.parameters.operation || ''))),
    'the sender contains NO Sheets write node — nothing can be written to the Pipeline');

  const sent = await runDisposable('sender', senderPath, senderNodes, senderConns);
  await cleanup();

  const env = Array.isArray(sent) ? sent[0] : sent;
  const MSG = (env && env.result) ? env.result : env;
  if (!MSG || !MSG.message_id) { die('the send returned no Message: ' + j(env).slice(0, 400)); }

  // ── 6. verify what Telegram actually delivered ──────────────────────────────────────────────
  say('');
  say('6. the delivered message, read back from Telegram\'s own response');

  ok('Telegram accepted the send: message_id ' + MSG.message_id);
  eqw(String(MSG.chat && MSG.chat.id), String(SETTINGS.owner_chat_id), 'delivered to the owner chat');
  const back = LAA.htmlFromTelegram(String(MSG.text || ''), MSG.entities || []);
  want(String(MSG.text || '').length > 0, 'the message carries text: ' + String(MSG.text || '').length + ' characters');
  const dkb = ((MSG.reply_markup || {}).inline_keyboard) || [];
  const dflat = dkb.flat();
  eqw(j(dkb.map((r) => r.length)), j(KB.map((r) => r.length)), 'the delivered keyboard has the recomputed row shape');
  eqw(j(dflat.map((b) => b.text)), j(flat.map((b) => b.text)), 'every button label matches');
  eqw(j(dflat.map((b) => b.callback_data)), j(flat.map((b) => b.callback_data)), 'every callback_data matches');
  want(!dflat.some((b) => String(b.callback_data || '').startsWith('docs|')), '📄 Документы is absent from the delivered keyboard');
  want(dkb.every((r) => r.length <= 2), 'no delivered row carries more than 2 buttons');
  // The body is compared as Telegram renders it — plain text plus entities — because the alert is
  // sent as HTML and comes back parsed. The offline render and the sent one are produced seconds
  // apart, and every clock-dependent value in this message is day-granular, so they must be equal;
  // if they ever are not, that is a real difference and is reported as one rather than tolerated.
  const { toTelegram } = require_(join(ROOT, 'qa', 'telegram-emulator.js'));
  const offline = toTelegram(HTML);
  eqw(String(MSG.text || ''), offline.text, 'the delivered body is exactly the offline render, character for character');
  eqw(back, LAA.htmlFromTelegram(offline.text, offline.entities),
    'and its entities round-trip to the same HTML — every bold, every line');
  say('');
  say(String(MSG.text || '').split('\n').map((l) => '        ' + l).join('\n'));
  say('');
  for (const row of dkb) { say('        ' + row.map((b) => b.text).join('   |   ')); }

  const rec = {
    sent_at: new Date().toISOString(), lead_id: LEAD_ID,
    message_id: MSG.message_id, chat_id: MSG.chat && MSG.chat.id,
    kb_shape: SHAPE, keyboard: dkb, text: MSG.text, entities: MSG.entities || [],
    row_at_send: ROW, wrote_to_pipeline: false
  };
  writeFileSync(join(OUT_DIR, 'fresh-alert-' + LEAD_ID + '-' + MSG.message_id + '.json'),
    JSON.stringify(rec, null, 2) + '\n', 'utf8');

  say('');
  say('='.repeat(78));
  say('  ' + pass + ' passed, ' + failures.length + ' failed');
  say('');
  say('  record: .uat/fresh-alert-' + LEAD_ID + '-' + MSG.message_id + '.json');
  say('  Nothing was written to the Pipeline. No action replayed, no row restored, no button pressed.');
  say('');
  if (failures.length) { process.exitCode = 1; }
} catch (e) {
  // Cleanup first, always: a disposable left activated on the tenant is a live webhook.
  await cleanup().catch(() => {});
  console.error('\nSTOPPED: ' + (e && e.message));
  if (!(e instanceof Stop) && e && e.stack) { console.error(e.stack.split('\n').slice(1, 4).join('\n')); }
  process.exitCode = 1;
}
