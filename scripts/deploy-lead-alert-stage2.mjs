#!/usr/bin/env node
// FINMENTOR — Lead Alert action lifecycle, STAGE 2.
//
//   node scripts/deploy-lead-alert-stage2.mjs --dry-run
//   node scripts/deploy-lead-alert-stage2.mjs --confirm
//
// ONE workflow changes: the Lead Command Center (qF9tonlHHIxc8MDd). The three alert renderers are
// Stage 1 and are only re-hashed here to prove they did not move.
//
// ── THE ORDER, WHICH IS THE POINT ─────────────────────────────────────────────────────────────
//
//   authenticate callback -> parse action + lead_id -> FRESH Pipeline read
//   -> recompute whether the action is allowed NOW -> sparse write of owned fields only
//   -> FRESH read-back -> prove the mutation -> recompute the keyboard from POST-WRITE state
//   -> reconstruct the original message -> editMessageText -> and only then acknowledge
//
// No success is spoken before the write is proven. A failed edit reports the action applied and
// the buttons not refreshed, and never retries the mutation.
//
// ── THE PRESENTATION ADAPTER IS SEPARABLE, ON PURPOSE ─────────────────────────────────────────
//
// editMessageText is the CURRENT adapter, chosen because n8n exposes no editMessageReplyMarkup and
// an HTTP Request cannot reuse the Telegram credential (Telegram carries its secret in the URL
// path; n8n's generic injection writes headers, query strings and bodies). Everything that decides
// business outcomes — authentication, the action rules, the fresh read, the sparse mutation, the
// read-back, duplicate/stale handling, the acknowledgement semantics — lives in
// `Find & Build Update` and `Verify Mutation` and never mentions how the message is edited. Swapping
// in editMessageReplyMarkup later replaces the four `Edit Alert` nodes and nothing else.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CAND = join(ROOT, 'n8n', 'candidate', 'lead-command-center-stage2-candidate.json');

const CC = 'qF9tonlHHIxc8MDd';
const RENDERERS = { QmIyEW2ZEqKregmN: 'Lead Intake', LZ2mvKXbBikmeVTn: 'SLA Lead Watch', zeLOCuf0K1bkaKl2: 'Followup Sequence' };

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
const structural = (wf) => JSON.stringify({
  nodes: wf.nodes.map((n) => [n.name, n.type, n.typeVersion, n.parameters, n.onError || null, n.alwaysOutputData || false]),
  connections: wf.connections, settings: wf.settings || {}
});
const sanitize = (v) => {
  if (!v || typeof v !== 'object') { return v; }
  if (Array.isArray(v)) { return v.map(sanitize); }
  const o = {};
  for (const k of Object.keys(v)) { if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; } o[k] = sanitize(v[k]); }
  return o;
};

const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const PRESENTER_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8').replace(/\r\n/g, '\n');
// The presenter ships as a CommonJS module; inside a Code node it becomes an IIFE assigned to LA,
// the same way the deployed alert builders already consume it.
const LA_BLOCK = 'const LA = (function () {\n' + PRESENTER_SRC.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n';
// tz.js the same way. The decision node needs the REAL Europe/Chisinau offset for the
// confirmation copy — a hard-coded 180 would silently print summer time all winter.
const TZ_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'), 'utf8').replace(/\r\n/g, '\n');
const TZ_BLOCK = 'const LATZ = (function () {\n' + TZ_SRC.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n';

// ── the three replaced node bodies ────────────────────────────────────────────────────────────

const VERIFY_IDENTITY_TAIL = `
// ── STAGE 2 — the MINIMUM Telegram identifiers needed to edit the originating message ────────
//
// All of it comes from the update the Telegram Trigger authenticated with its secret token. None
// of it is accepted from an HTTP body, and none of it is used for authorisation: the owner check
// above is unchanged and still decides everything.
//
// Why each field is here, and why nothing else is:
//   message_id        the edit target
//   message_chat_id   the edit target's chat; taken from the message, not from the caller
//   message_text      Telegram gives the bot's own message as PLAIN text
//   message_entities  ...plus the formatting, which is the only way to rebuild it unchanged
//   origin_had_done   ONE boolean: did the alert offer «Обработано»? That distinguishes a NEW LEAD
//                     keyboard from a PRIORITY/FOLLOW-UP one without touching callback_data.
const __m = isCallback ? (cq && cq.message) : null;
const __rm = __m && __m.reply_markup && Array.isArray(__m.reply_markup.inline_keyboard)
  ? __m.reply_markup.inline_keyboard : [];
let __hadDone = false;
for (const __row of __rm) {
  for (const __b of (__row || [])) {
    if (__b && typeof __b.callback_data === 'string' && __b.callback_data.indexOf('done|') === 0) { __hadDone = true; }
  }
}
out[0].json.message_id = __m && typeof __m.message_id === 'number' ? __m.message_id : null;
out[0].json.message_chat_id = __m && __m.chat && __m.chat.id != null ? String(__m.chat.id) : '';
out[0].json.message_text = __m && typeof __m.text === 'string' ? __m.text : '';
out[0].json.message_entities = __m && Array.isArray(__m.entities) ? __m.entities : [];
out[0].json.origin_had_done = __hadDone;
return out;
`;

function patchVerifyIdentity(src) {
  const anchor = 'return [{\n  json: {\n    verified: true,';
  if (src.indexOf(anchor) === -1) { die('Verify Telegram Identity: return anchor not found'); }
  return src.replace(anchor, () => 'const out = [{\n  json: {\n    verified: true,')
    .replace(/\n\}\];\s*$/, '\n}];\n' + VERIFY_IDENTITY_TAIL);
}

function patchParseCommand(src) {
  const anchor = `    chat_id: chatId, from_id: fromId, callback_query_id: cbId, is_callback: isCb,`;
  if (src.indexOf(anchor) === -1) { die('Parse Lead Command v2: base() anchor not found'); }
  return src.replace(anchor, () => anchor + `
    // STAGE 2 — carried through untouched from the authenticated identity gate. Nothing here is
    // read from the message body, and none of it participates in authorisation.
    message_id: v.message_id ?? null,
    message_chat_id: String(v.message_chat_id ?? ''),
    message_text: String(v.message_text ?? ''),
    message_entities: Array.isArray(v.message_entities) ? v.message_entities : [],
    origin_had_done: v.origin_had_done === true,`);
}

const DECIDE_SRC = ACTIONS_SRC + '\n' + LA_BLOCK + TZ_BLOCK + `
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
  // owner stops looking at actions that are no longer possible.
  const kb = LAA.keyboard(kind, row, row.lead_id);
  const text = LAA.refusal(LA, reason, company);
  return [{ json: Object.assign({}, base, {
    _found: true, _allowed: false, _reason: reason, company: company,
    kb: kb, kb_shape: LAA.shape(kb), edit_html: editHtml,
    reply_text: text, reply_text_presentation_failed: text
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
  reply_text_presentation_failed: LAA.presentationFailure(LA, action, company, upd, OFFSET)
}) }];
`;

const SPARSE_SRC = `// STAGE 2 — the ONLY item that reaches the Sheets writer.
//
// \`Update Pipeline Row\` maps with autoMapInputData, so it writes exactly the keys present here.
// Projecting to lead_id plus the action's owned columns is what makes the write sparse: the
// previous builder carried fifteen pre-read columns and two taps seconds apart overwrote each
// other's unrelated values.
const d = $('Find & Build Update').first().json;
return [{ json: d._upd }];
`;

const VERIFY_SRC = ACTIONS_SRC + '\n' + LA_BLOCK + `
// ── STAGE 2 — prove the mutation from a FRESH read-back ───────────────────────────────────────
//
// The owner is not told an action succeeded because a Sheets node did not throw. Every field the
// action claimed to write is compared against the row as it now reads.
const d = $('Find & Build Update').first().json;
const rows = $input.all().map((i) => i.json);
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
const row = rows.find((r) => norm(r.lead_id) === norm(d.lead_id));

if (!row) {
  return [{ json: Object.assign({}, d, { _verified: false, _mismatched: ['row disappeared'],
    reply_text: LAA.refusal(LA, '', d.company) }) }];
}
const v = LAA.verifyMutation(d._upd, row);
if (!v.ok) {
  return [{ json: Object.assign({}, d, { _verified: false, _mismatched: v.mismatched,
    reply_text: LAA.refusal(LA, '', d.company) }) }];
}
// Verified. The keyboard is recomputed from the POST-WRITE row, so the action just taken
// disappears and a terminal state clears the keyboard entirely.
const kb = LAA.keyboard(d._kind, row, row.lead_id);
return [{ json: Object.assign({}, d, {
  _verified: true, _mismatched: [],
  kb: kb, kb_shape: LAA.shape(kb)
}) }];
`;

// ── new node factories ────────────────────────────────────────────────────────────────────────

const code = (name, jsCode, pos, id) => ({
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
  type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, id, name
});
const iff = (name, left, right, pos, id) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: id + '-c', leftValue: left, rightValue: right, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and'
    },
    options: {}
  },
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos, id, name
});
const editNode = (name, shape, pos, id, cred) => {
  const counts = shape === 'NONE' ? [] : shape.replace('KB', '').split('').map(Number);
  const p = {
    resource: 'message', operation: 'editMessageText', messageType: 'message',
    chatId: '={{ $json.message_chat_id }}',
    messageId: '={{ $json.message_id }}',
    text: '={{ $json.edit_html }}',
    replyMarkup: counts.length ? 'inlineKeyboard' : 'none',
    additionalFields: { appendAttribution: false, parse_mode: 'HTML' }
  };
  if (counts.length) {
    p.inlineKeyboard = {
      rows: counts.map((n, r) => ({
        row: {
          buttons: Array.from({ length: n }, (_, c) => ({
            text: '={{ $json.kb[' + r + '][' + c + '].text }}',
            additionalFields: { callback_data: '={{ $json.kb[' + r + '][' + c + '].callback_data }}' }
          }))
        }
      }))
    };
  }
  return {
    parameters: p, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: pos, id, name,
    // A failed edit must NOT look like a failed action, and must NOT retry the mutation.
    onError: 'continueRegularOutput',
    credentials: { telegramApi: cred }
  };
};

// ── build ─────────────────────────────────────────────────────────────────────────────────────

function build(live) {
  const next = JSON.parse(JSON.stringify(importable(live)));
  const N = (n) => next.nodes.find((x) => x.name === n);
  const cred = (N('Answer Callback Query').credentials || {}).telegramApi;
  if (!cred) { die('cannot find the existing Telegram credential on Answer Callback Query'); }

  // ── replaced bodies
  N('Verify Telegram Identity').parameters.jsCode = patchVerifyIdentity(String(N('Verify Telegram Identity').parameters.jsCode).replace(/\r\n/g, '\n'));
  N('Parse Lead Command v2').parameters.jsCode = patchParseCommand(String(N('Parse Lead Command v2').parameters.jsCode).replace(/\r\n/g, '\n'));
  N('Find & Build Update').parameters.jsCode = DECIDE_SRC;

  // Neutral acknowledgement — it may never claim success (D9). It was already textless; the text
  // is now explicit so nobody later reads the silence as an accident.
  N('Answer Callback Query').parameters = Object.assign({}, N('Answer Callback Query').parameters, {
    additionalFields: { text: 'Обрабатываю…' }
  });

  const P = N('Find & Build Update').position || [0, 0];
  const at = (dx, dy) => [P[0] + dx, P[1] + dy];

  const added = [
    iff('IF Action Allowed', '={{ $json._allowed }}', true, at(220, 200), 's2-if-allowed'),
    code('Build Sparse Update', SPARSE_SRC, at(440, 200), 's2-sparse'),
    Object.assign(JSON.parse(JSON.stringify(N('Get Pipeline (Update)'))), { name: 'Get Pipeline (Verify)', id: 's2-verify-read', position: at(880, 200) }),
    code('Verify Mutation', VERIFY_SRC, at(1100, 200), 's2-verify'),
    iff('IF Verified', '={{ $json._verified }}', true, at(1320, 200), 's2-if-verified'),
    {
      parameters: {
        rules: {
          values: ['KB221', 'KB22', 'KB21', 'NONE'].map((s, i) => ({
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
              conditions: [{ id: 's2-shape-' + i, leftValue: '={{ String($json.kb_shape) }}', rightValue: s, operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and'
            },
            outputKey: s
          }))
        },
        options: { fallbackOutput: 3 }
      },
      type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: at(1540, 200), id: 's2-shape', name: 'Route Edit Shape'
    },
    editNode('Edit Alert (5)', 'KB221', at(1780, 60), 's2-edit-5', cred),
    editNode('Edit Alert (4)', 'KB22', at(1780, 180), 's2-edit-4', cred),
    editNode('Edit Alert (3)', 'KB21', at(1780, 300), 's2-edit-3', cred),
    editNode('Edit Alert (0)', 'NONE', at(1780, 420), 's2-edit-0', cred),
    {
      parameters: {
        chatId: "={{ $('Find & Build Update').first().json.chat_id }}",
        text: "={{ String($('Verify Mutation').first().json.reply_text || '').replace(/<[^>]+>/g, '').replace(/\\r/g, '').trim() }}",
        additionalFields: { appendAttribution: false, parse_mode: '' }
      },
      type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: at(1540, 420), id: 's2-write-failed', name: 'Telegram Write Failed Reply',
      credentials: { telegramApi: cred }
    }
  ];
  for (const n of added) { next.nodes.push(n); }

  // The acknowledgement now speaks LAST, and tells the truth about a failed edit.
  N('Telegram Update Reply').parameters = Object.assign({}, N('Telegram Update Reply').parameters, {
    chatId: "={{ $('Find & Build Update').first().json.chat_id }}",
    text: "={{ $json.error"
      + " ? $('Route Edit Shape').first().json.reply_text_presentation_failed"
      + " : $('Route Edit Shape').first().json.reply_text }}",
    additionalFields: { appendAttribution: false, parse_mode: 'HTML' }
  });
  N('Telegram Update Reply').position = at(2000, 200);

  // ── rewiring
  const C = next.connections;
  C['IF Row Found'] = { main: [[{ node: 'IF Action Allowed', type: 'main', index: 0 }], [{ node: 'Telegram Not Found Reply', type: 'main', index: 0 }]] };
  C['IF Action Allowed'] = { main: [[{ node: 'Build Sparse Update', type: 'main', index: 0 }], [{ node: 'Route Edit Shape', type: 'main', index: 0 }]] };
  C['Build Sparse Update'] = { main: [[{ node: 'Update Pipeline Row', type: 'main', index: 0 }]] };
  C['Update Pipeline Row'] = { main: [[
    { node: 'Build Status Log', type: 'main', index: 0 },
    { node: 'Build CC Activity', type: 'main', index: 0 },
    { node: 'Get Pipeline (Verify)', type: 'main', index: 0 }
  ]] };
  C['Get Pipeline (Verify)'] = { main: [[{ node: 'Verify Mutation', type: 'main', index: 0 }]] };
  C['Verify Mutation'] = { main: [[{ node: 'IF Verified', type: 'main', index: 0 }]] };
  C['IF Verified'] = { main: [[{ node: 'Route Edit Shape', type: 'main', index: 0 }], [{ node: 'Telegram Write Failed Reply', type: 'main', index: 0 }]] };
  C['Route Edit Shape'] = { main: [
    [{ node: 'Edit Alert (5)', type: 'main', index: 0 }],
    [{ node: 'Edit Alert (4)', type: 'main', index: 0 }],
    [{ node: 'Edit Alert (3)', type: 'main', index: 0 }],
    [{ node: 'Edit Alert (0)', type: 'main', index: 0 }]
  ] };
  for (const e of ['Edit Alert (5)', 'Edit Alert (4)', 'Edit Alert (3)', 'Edit Alert (0)']) {
    C[e] = { main: [[{ node: 'Telegram Update Reply', type: 'main', index: 0 }]] };
  }
  return { next, added: added.map((n) => n.name) };
}

// ── invariants ────────────────────────────────────────────────────────────────────────────────

function verify(live, built) {
  const problems = [];
  const want = (c, m) => { if (!c) { problems.push(m); } };
  const { next, added } = built;
  const MODIFIED = ['Verify Telegram Identity', 'Parse Lead Command v2', 'Find & Build Update', 'Answer Callback Query', 'Telegram Update Reply'];

  want(next.nodes.length === live.nodes.length + added.length, 'node count moved by ' + (next.nodes.length - live.nodes.length));
  for (let i = 0; i < live.nodes.length; i++) {
    const a = live.nodes[i];
    const b = next.nodes[i];
    want(b && b.name === a.name, 'node order changed at ' + i);
    if (!b || MODIFIED.includes(a.name)) { continue; }
    want(JSON.stringify(a) === JSON.stringify(b), 'node changed but should not have: ' + a.name);
  }
  // authorisation must be untouched
  const vi = String(next.nodes.find((n) => n.name === 'Verify Telegram Identity').parameters.jsCode);
  for (const p of [
    'if (String(chatId) !== String(fromId)) return [];',
    "if (!msg.chat || msg.chat.type !== 'private') return [];",
    'if (from.is_bot === true) return [];'
  ]) { want(vi.includes(p), 'the identity gate was weakened: ' + p.slice(0, 40)); }
  const pc = String(next.nodes.find((n) => n.name === 'Parse Lead Command v2').parameters.jsCode);
  want(pc.includes('if (!allowed.includes(fromId)) return [];'), 'the allowlist check was weakened');
  want(pc.includes('if (allowed.length === 0) return [];'), 'deny-all-when-unset was weakened');

  // no broad autoMap write: the writer's only feeder is the sparse projector
  const w = next.nodes.find((n) => n.name === 'Update Pipeline Row');
  want((w.parameters.columns || {}).mappingMode === 'autoMapInputData', 'the writer mapping changed');
  const feeders = Object.entries(next.connections).filter(([, o]) => (o.main || []).some((br) => (br || []).some((t) => t.node === 'Update Pipeline Row'))).map(([s]) => s);
  want(JSON.stringify(feeders) === JSON.stringify(['Build Sparse Update']), 'the writer has feeders other than the sparse projector: ' + feeders.join(','));
  const sp = String(next.nodes.find((n) => n.name === 'Build Sparse Update').parameters.jsCode);
  want(sp.includes('return [{ json: d._upd }];'), 'the sparse projector does not project the update');

  // no new callback verb, no won emitted
  const blob = JSON.stringify(next.nodes);
  want(!/"=won\|/.test(blob) && !/callback_data":"won\|/.test(blob), 'a won callback is emitted');

  // no Sheets schema change
  const sheets = (wf) => (wf.nodes || []).filter((n) => n.type === 'n8n-nodes-base.googleSheets').map((n) => [n.parameters.operation, (n.parameters.columns || {}).mappingMode, JSON.stringify((n.parameters.sheetName || {}).value)]);
  const before = sheets(live).sort();
  const after = sheets(next).sort();
  want(after.length === before.length + 1, 'unexpected number of Sheets nodes: ' + after.length);

  // no token material anywhere
  want(!/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/.test(blob), 'token-shaped material in the workflow');

  for (const n of next.nodes) {
    want(!(n.alwaysOutputData === true && n.onError === 'continueErrorOutput'), 'P9-R2 flag pair on ' + n.name);
  }
  return problems;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────

say('');
say('LEAD ALERT ACTION LIFECYCLE — STAGE 2');
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

say('STEP 1 — the frozen baseline still matches the tenant');
const live = await api('GET', '/workflows/' + CC);
{
  const frozen = JSON.parse(readFileSync(join(OUT_DIR, CC + '.pre-stage2.json'), 'utf8'));
  if (sha(importable(live)) !== sha(frozen)) { die('the Command Center has CHANGED since the Stage 2 freeze — re-freeze and re-review'); }
  ok('Command Center matches the Stage 2 freeze: ' + live.nodes.length + ' nodes, active=' + live.active);
  for (const [id, label] of Object.entries(RENDERERS)) {
    const w = await api('GET', '/workflows/' + id);
    const f = JSON.parse(readFileSync(join(OUT_DIR, id + '.pre-stage2.json'), 'utf8'));
    if (sha(importable(w)) !== sha(f)) { die(label + ' drifted since the Stage 2 freeze'); }
    ok(label.padEnd(20) + 'unchanged (' + w.nodes.length + ' nodes)');
  }
}
say('');

say('STEP 2 — the delta');
const built = build(live);
const problems = verify(live, built);
if (problems.length) { for (const p of problems) { say('  FAIL  ' + p); } die(problems.length + ' invariant(s) failed'); }
mkdirSync(dirname(CAND), { recursive: true });
writeFileSync(CAND, JSON.stringify({ name: built.next.name, nodes: sanitize(built.next.nodes), connections: built.next.connections, settings: built.next.settings }, null, 2) + '\n', 'utf8');
say('  nodes      ' + live.nodes.length + ' -> ' + built.next.nodes.length + '   (+' + built.added.length + ')');
say('  added      ' + built.added.join(', '));
say('  modified   Verify Telegram Identity, Parse Lead Command v2, Find & Build Update, Answer Callback Query, Telegram Update Reply');
say('  removed    (none)');
ok('every invariant holds; candidate written to n8n/candidate/');
say('');

say('STEP 3 — ' + (DRY ? 'write (SKIPPED)' : 'write'));
if (DRY) { ok('dry run complete'); say(''); say('Nothing was written.'); say(''); process.exit(0); }
writeFileSync(join(OUT_DIR, CC + '.pre-stage2-deploy.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
await api('PUT', '/workflows/' + CC, built.next);
ok('PUT /workflows/' + CC);
say('');

say('STEP 4 — read-back from the tenant');
const after = await api('GET', '/workflows/' + CC);
{
  if (after.nodes.length !== built.next.nodes.length) { die('tenant stored ' + after.nodes.length + ' nodes — ROLLBACK'); }
  if (after.name !== live.name) { die('the workflow was renamed — ROLLBACK'); }
  if (after.active !== true) { die('no longer active — ROLLBACK'); }
  for (const n of built.next.nodes) {
    const g = after.nodes.find((x) => x.name === n.name);
    if (!g) { die(n.name + ' missing on the tenant — ROLLBACK'); }
    if (JSON.stringify(g.parameters) !== JSON.stringify(n.parameters)) { die(n.name + ' does not match what was sent — ROLLBACK'); }
  }
  if (JSON.stringify(after.connections) !== JSON.stringify(built.next.connections)) { die('connections do not match — ROLLBACK'); }
  ok('deployed graph matches the candidate: ' + after.nodes.length + ' nodes, active');
  writeFileSync(join(OUT_DIR, CC + '.post-stage2.json'), JSON.stringify(importable(after), null, 2) + '\n', 'utf8');
}
say('');

say('STEP 5 — the renderers did not move');
for (const [id, label] of Object.entries(RENDERERS)) {
  const w = await api('GET', '/workflows/' + id);
  const f = JSON.parse(readFileSync(join(OUT_DIR, id + '.pre-stage2.json'), 'utf8'));
  if (sha(importable(w)) !== sha(f)) { die(label + ' MOVED during this deploy'); }
  ok(label.padEnd(20) + 'byte-identical');
}
say('');
say('STAGE 2 DEPLOYED.');
say('');
say('ROLLBACK:  PUT /api/v1/workflows/' + CC + '  with ' + join(OUT_DIR, CC + '.pre-stage2.json'));
say('');
