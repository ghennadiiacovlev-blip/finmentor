#!/usr/bin/env node
// FINMENTOR — the Lead Alert ACTION LIFECYCLE, proven against the TENANT.
//
//   node scripts/verify-lead-alert-actions-live.mjs
//   node scripts/verify-lead-alert-actions-live.mjs --print     (also print the rendered artefacts)
//
// READ-ONLY. Every tenant call is a GET. No PUT, no POST, no workflow created or deleted, no
// execution started, no Telegram send, no Sheets write. Nothing changes and no message reaches the
// owner.
//
// ── WHY THIS EXISTS SEPARATELY FROM THE OFFLINE GATE ──────────────────────────────────────────
//
// qa/lead-alerts-actions.test.mjs executes the module in n8n/src/. The Stage 2 deploy then proved
// the candidate landed. Neither proves the third thing: that the bytes now sitting in the live
// workflow, executed in the order the live connections impose, decide correctly for the REAL
// Pipeline row. This pulls the Code-node source back OUT of the tenant and runs THAT.
//
// ── WHAT IT CLOSES, AND WHAT IT EXPLICITLY DOES NOT ───────────────────────────────────────────
//
//   CLOSES   the deployed graph is the reviewed candidate, byte for byte;
//            the lifecycle is wired in the required order — fresh read, decide, sparse write,
//            fresh read-back, prove, recompute keyboard, edit, and only then reply;
//            the deployed decision bytes produce the right verdict, the right sparse projection,
//            the right read-back verdict, the right post-write keyboard and the right owner copy,
//            for the real row and the real alert the owner last received for it.
//
//   DOES NOT n8n itself is not exercised. No Telegram trigger fires here, no Sheets node runs, no
//            editMessageText is attempted. Every claim below is about bytes and wiring, not about
//            a run. Only a real tap closes that, and a real tap needs the owner.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);

const PRINT = process.argv.includes('--print');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

const CC = 'qF9tonlHHIxc8MDd';
const SLA = 'LZ2mvKXbBikmeVTn';
const LEAD_ID = 'FIN-1788113619104-582';
const CAND = join(ROOT, 'n8n', 'candidate', 'lead-command-center-stage2-candidate.json');
const FREEZE = join(ROOT, '.uat', 'pipeline-row-' + LEAD_ID + '.pre-tap.json');

// ── the reviewed sources, for provenance and for EXPECTATIONS ─────────────────────────────────
//
// Expectations come from the repo module; behaviour comes from the tenant. Deriving both from the
// tenant would make every assertion below tautological.
const ACTIONS_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n');
const PRESENTER_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8').replace(/\r\n/g, '\n');
const TZ_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'), 'utf8').replace(/\r\n/g, '\n');
const LA_BLOCK = 'const LA = (function () {\n' + PRESENTER_SRC.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n';
const TZ_BLOCK = 'const LATZ = (function () {\n' + TZ_SRC.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n';
const A = new Function(ACTIONS_SRC + '; return LAA;')();
const { toTelegram } = require_(join(ROOT, 'qa', 'telegram-emulator.js'));

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
const sanitize = (v) => {
  if (!v || typeof v !== 'object') { return v; }
  if (Array.isArray(v)) { return v.map(sanitize); }
  const o = {};
  for (const k of Object.keys(v)) { if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; } o[k] = sanitize(v[k]); }
  return o;
};

// n8n accepts both item shapes a Code node can return — `{ json: {...} }` and a bare object —
// and normalises them before the next node sees them. The deployed nodes use both, so the harness
// has to normalise too, or a downstream `$('...').first().json` reads undefined.
const unwrap = (it) => (it && typeof it === 'object' && Object.prototype.hasOwnProperty.call(it, 'json') ? it.json : it);

// The Code-node environment, as n8n provides it for `runOnceForAllItems`.
function runNode(code, nodes, inputItems) {
  const handle = (items) => ({
    first: () => { if (!items.length) { throw new Error('first() on an empty node'); } return items[0]; },
    all: () => items, isExecuted: true
  });
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) { throw new Error("$('" + name + "') not provided"); }
    return handle(nodes[name].map((j) => ({ json: j })));
  };
  return new Function('$', '$input', code)($, handle((inputItems || []).map((j) => ({ json: j }))));
}

say('');
say('LEAD ALERT ACTION LIFECYCLE — LIVE VERIFICATION (READ-ONLY)');
say('='.repeat(78));

// ══════════════════════════════════════════════════════════════════════════════════════════════
say('');
say('A. the deployed graph IS the reviewed candidate');

const live = await get('/workflows/' + CC);
const nodeOf = (name) => live.nodes.find((n) => n.name === name);
const codeOf = (name) => String((nodeOf(name) || { parameters: {} }).parameters.jsCode || '');

{
  want(live.active === true, 'the Command Center is active on the tenant');
  eqw(live.nodes.length, 33, 'node count');
  if (!existsSync(CAND)) { die('the reviewed candidate is missing: ' + CAND); }
  const cand = JSON.parse(readFileSync(CAND, 'utf8'));
  eqw(cand.nodes.length, live.nodes.length, 'the candidate and the tenant agree on node count');
  const drift = [];
  for (const c of cand.nodes) {
    const l = nodeOf(c.name);
    if (!l) { drift.push(c.name + ': missing on the tenant'); continue; }
    if (l.type !== c.type) { drift.push(c.name + ': type'); }
    if (String(l.typeVersion) !== String(c.typeVersion)) { drift.push(c.name + ': typeVersion'); }
    if (JSON.stringify(sanitize(l.parameters)) !== JSON.stringify(sanitize(c.parameters))) { drift.push(c.name + ': parameters'); }
  }
  want(drift.length === 0, 'every reviewed node is on the tenant unchanged' + (drift.length ? ': ' + drift.join('; ') : ''));
  want(JSON.stringify(live.connections) === JSON.stringify(cand.connections), 'the connections are the reviewed connections');
  eqw(live.name, cand.name, 'the workflow was not renamed');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
say('');
say('B. the decision module on the tenant is the reviewed module');

{
  for (const n of ['Find & Build Update', 'Verify Mutation']) {
    const src = codeOf(n);
    want(src.startsWith(ACTIONS_SRC), n + ' opens with the reviewed actions module, byte for byte');
    want(src.includes(LA_BLOCK), n + ' carries the reviewed presenter');
  }
  // The decision node needs the real Chisinau offset for the confirmation copy; the read-back node
  // renders no clock and must not carry a second one.
  want(codeOf('Find & Build Update').includes(TZ_BLOCK), 'Find & Build Update carries the reviewed timezone module');
  want(!codeOf('Verify Mutation').includes(TZ_BLOCK), 'Verify Mutation does not carry a second clock');
  // and the splice is not a dead branch: the module resolves a real offset, both halves of the year
  const TZ = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'));
  eqw(TZ.tzOffsetMinutes('Europe/Chisinau', new Date('2026-01-15T12:00:00Z')), 120, 'the timezone module knows winter');
  eqw(TZ.tzOffsetMinutes('Europe/Chisinau', new Date('2026-07-15T12:00:00Z')), 180, 'the timezone module knows summer');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
say('');
say('C. the lifecycle is wired in the required order');

const SHAPES = new Set(((nodeOf('Route Edit Shape').parameters.rules || {}).values || []).map((v) => v.outputKey));

{
  const outs = (name, idx) => (((live.connections[name] || {}).main || [])[idx] || []).map((c) => c.node);
  const feeders = (name) => Object.keys(live.connections).filter((k) =>
    ((live.connections[k].main || []).some((arr) => (arr || []).some((c) => c.node === name))));

  want(outs('Telegram Command Trigger', 0).join() === 'Verify Telegram Identity', 'the trigger reaches the identity gate first');
  want(outs('Verify Telegram Identity', 0).join() === 'Read Settings', 'authorisation policy is read only after identity');
  want(outs('Get Pipeline (Update)', 0).join() === 'Find & Build Update', 'the decision runs on a FRESH read');
  want(outs('IF Row Found', 0).join() === 'IF Action Allowed', 'a found row is judged before anything is written');
  want(outs('IF Action Allowed', 0).join() === 'Build Sparse Update', 'an allowed action is projected before the write');
  want(outs('IF Action Allowed', 1).join() === 'Route Edit Shape', 'a REFUSED action reaches no writer — it only refreshes the keyboard');
  eqw(feeders('Update Pipeline Row').join(), 'Build Sparse Update', 'the writer has exactly one feeder, and it is the sparse projection');
  want(outs('Update Pipeline Row', 0).includes('Get Pipeline (Verify)'), 'the write is followed by a fresh read-back');
  want(outs('Get Pipeline (Verify)', 0).join() === 'Verify Mutation', 'the read-back is what proves the mutation');
  want(outs('Verify Mutation', 0).join() === 'IF Verified', 'the proof gates what happens next');
  want(outs('IF Verified', 0).join() === 'Route Edit Shape', 'only a PROVEN write refreshes the keyboard');
  want(outs('IF Verified', 1).join() === 'Telegram Write Failed Reply', 'an unproven write tells the owner so');

  const edits = live.nodes.filter((n) => n.name.startsWith('Edit Alert (')).map((n) => n.name);
  eqw(edits.length, 4, 'one edit node per keyboard shape');
  eqw(SHAPES.size, 4, 'the shape router names four shapes');
  for (const e of edits) { want(outs(e, 0).join() === 'Telegram Update Reply', e + ' speaks the confirmation only AFTER the edit'); }
  eqw(feeders('Telegram Update Reply').sort().join(), edits.slice().sort().join(),
    'nothing reaches the confirmation except an edit — no success is spoken before the write is proven');

  // the fast acknowledgement is the Telegram spinner, not a business claim
  const ack = nodeOf('Answer Callback Query');
  eqw(ack.parameters.resource, 'callback', 'the fast acknowledgement is answerCallbackQuery');
  want(!/выполн|готов|обработан|успешн/i.test(String((ack.parameters.additionalFields || {}).text || '')),
    'the fast acknowledgement claims no outcome, it only says work started');

  // the writer must map exactly what it is handed
  eqw((nodeOf('Update Pipeline Row').parameters.columns || {}).mappingMode, 'autoMapInputData',
    'the writer maps its input, which is what makes the projection the sparseness');

  const blob = JSON.stringify(live);
  want(!/"=won\|/.test(blob) && !/callback_data":"won\|/.test(blob), 'no won button is emitted anywhere in the graph');
  want(!/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/.test(blob), 'no token-shaped material in the graph');
  const pairs = live.nodes.filter((n) => n.alwaysOutputData === true && n.onError === 'continueErrorOutput').map((n) => n.name);
  want(pairs.length === 0, 'no node carries the alwaysOutputData + continueErrorOutput pair' + (pairs.length ? ': ' + pairs.join(', ') : ''));
  const creds = new Set(live.nodes.flatMap((n) => Object.values(n.credentials || {}).map((c) => c.id)));
  eqw(creds.size, 2, 'exactly two credentials in the graph (Telegram + Sheets)');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
say('');
say('D. the real row, and the real alert the owner last received for it');

let ROW = null;
let ORIGIN_HTML = '';
let SETTINGS = null;
{
  // The newest SLA run carries the Pipeline as it reads today, and — when it alerted — the exact
  // HTML that reached the owner's screen. Both come from execution data: still a GET.
  const list = await get('/executions?workflowId=' + SLA + '&limit=20&status=success');
  for (const e of list.data) {
    const full = await get('/executions/' + e.id + '?includeData=true');
    const rd = ((full.data || {}).resultData || {}).runData || {};
    const outOf = (n) => (((((rd[n] || [])[0] || {}).data || {}).main || [])[0] || []).map((x) => x.json);
    if (!SETTINGS && outOf('Settings to Object').length) { SETTINGS = outOf('Settings to Object')[0].settings || {}; }
    if (!ROW) {
      const r = outOf('Get Pipeline Rows').find((x) => String(x.lead_id) === LEAD_ID);
      if (r) { ROW = r; say('        Pipeline read from execution ' + e.id + ' (' + full.startedAt + ')'); }
    }
    if (!ORIGIN_HTML) {
      const s = outOf('SLA Select').find((x) => String(x.lead_id) === LEAD_ID);
      if (s && s.alert_html) { ORIGIN_HTML = String(s.alert_html); say('        alert HTML from execution ' + e.id + ' (' + full.startedAt + ')'); }
    }
    if (ROW && ORIGIN_HTML && SETTINGS) { break; }
  }
  if (!ROW) { die('no recent SLA execution carries the Pipeline row ' + LEAD_ID); }
  if (!ORIGIN_HTML) { die('no recent SLA execution carries a rendered alert for ' + LEAD_ID); }
  if (!SETTINGS) { die('no recent SLA execution carries the Settings sheet'); }

  want(String(SETTINGS.allowed_chat_ids || '').trim().length > 0, 'the live allowlist is not empty (an empty one denies everyone)');
  eqw(String(SETTINGS.timezone), 'Europe/Chisinau', 'the live timezone');
  eqw(String(ROW.deal_stage), 'Qualified', 'the live row is at the stage the freeze recorded');
  eqw(String(ROW.sla_status), 'Active', 'the live SLA status is the one the freeze recorded');
  if (existsSync(FREEZE)) {
    const fz = JSON.parse(readFileSync(FREEZE, 'utf8'));
    const BOOKKEEPING = ['last_activity_at', 'last_sla_alert_at', 'days_in_stage', 'updated_at'];
    const moved = Object.keys(fz).filter((k) => k in ROW && String(fz[k]) !== String(ROW[k]));
    want(moved.every((k) => BOOKKEEPING.includes(k)),
      'the row has not drifted since the pre-tap freeze except on SLA bookkeeping' + (moved.length ? ' (moved: ' + moved.join(', ') + ')' : ''));
  }
  want(Object.keys(ROW).length > 50, 'the live row is wide enough for an unrelated-column proof (' + Object.keys(ROW).length + ' columns)');
}

const OWNER = String(SETTINGS.allowed_chat_ids).split(',')[0].trim();
const ORIGIN = toTelegram(ORIGIN_HTML);
want(A.htmlFromTelegram(ORIGIN.text, ORIGIN.entities) === ORIGIN_HTML,
  'the REAL alert the owner received rebuilds byte-identically from text + entities');

// ══════════════════════════════════════════════════════════════════════════════════════════════
say('');
say('E. the deployed bytes, driven end to end for the real row');

const IDENTITY = codeOf('Verify Telegram Identity');
const PARSE = codeOf('Parse Lead Command v2');
const DECIDE = codeOf('Find & Build Update');
const SPARSE = codeOf('Build Sparse Update');
const VERIFY = codeOf('Verify Mutation');

// One tap, through the graph, in the order the connections impose. The two Sheets nodes are the
// only things simulated: `writeRow` applies exactly the projection the writer was handed, which is
// precisely what autoMapInputData does.
function tap(callbackData, row, kind, opts) {
  const o = opts || {};
  const originKb = A.keyboard(kind, o.originState || row, LEAD_ID);
  const update = {
    update_id: 1,
    callback_query: {
      id: 'cbq-test', data: callbackData,
      from: { id: Number(OWNER), is_bot: false },
      message: {
        message_id: 4242, chat: { id: Number(OWNER), type: 'private' },
        text: ORIGIN.text, entities: ORIGIN.entities,
        reply_markup: { inline_keyboard: originKb.map((r) => r.map((b) => ({ text: b.text, callback_data: b.callback_data }))) }
      }
    }
  };
  const id = runNode(IDENTITY, {}, [update]).map(unwrap);
  if (!id.length) { return { dropped: true }; }
  const N = { 'Verify Telegram Identity': id, 'Settings to Object': [{ settings: SETTINGS }] };
  const parsed = runNode(PARSE, N, id).map(unwrap);
  if (!parsed.length) { return { dropped: true }; }
  N['Parse Lead Command v2'] = parsed;

  const rows = (o.rows || [row]);
  const decided = unwrap(runNode(DECIDE, N, rows)[0]);
  N['Find & Build Update'] = [decided];
  if (decided._allowed !== true) { return { identity: id[0], parsed: parsed[0], decided: decided }; }

  const sparse = unwrap(runNode(SPARSE, N, [decided])[0]);
  const written = o.writeRow ? o.writeRow(row, sparse) : Object.assign({}, row, sparse);
  const verified = unwrap(runNode(VERIFY, N, [written])[0]);
  return { identity: id[0], parsed: parsed[0], decided: decided, sparse: sparse, written: written, verified: verified };
}

// ── every action the owner can actually tap, from the real state ──────────────────────────────
const KIND = 'priority';                    // the SLA alert offers «Обработано»
const OFFERED = A.keyboard(KIND, ROW, LEAD_ID).flat();
want(OFFERED.length > 0, 'the real row offers ' + OFFERED.length + ' buttons on a PRIORITY alert');

const printed = [];
for (const btn of OFFERED) {
  const label = btn.action;
  const r = tap(btn.callback_data, ROW, KIND);
  if (r.dropped) { bad(label + ': the owner\'s own tap was dropped by the identity gate'); continue; }

  eqw(r.identity.origin_had_done, true, label + ': the origin keyboard is read as a PRIORITY one');
  eqw(r.identity.message_id, 4242, label + ': the edit target survives the identity gate');
  eqw(r.parsed.mode, 'update', label + ': parsed as an action');
  eqw(r.parsed.lead_id, LEAD_ID, label + ': parsed the right lead');
  eqw(r.decided._allowed, true, label + ': allowed from the freshly read row');
  eqw(r.decided._action, label, label + ': the command resolved to its own action');

  // requirement 5 — the projection IS the sparseness
  const owned = ['lead_id'].concat(A.OWNED[label] || []).sort();
  eqw(Object.keys(r.sparse).sort().join(), owned.join(), label + ': the writer is handed lead_id + owned columns only');
  const untouched = A.untouchedFields(label, ROW);
  const changed = untouched.filter((k) => String(r.written[k]) !== String(ROW[k]));
  want(changed.length === 0, label + ': ' + untouched.length + ' unrelated columns survive the write' + (changed.length ? ' (moved: ' + changed.join(', ') + ')' : ''));

  // requirement 12 — the read-back proves it, and the keyboard is recomputed from POST-write state
  eqw(r.verified._verified, true, label + ': the read-back proves the mutation');
  eqw(JSON.stringify(r.verified._mismatched), '[]', label + ': nothing mismatched');
  // The keyboard is recomputed from the POST-write row, so it offers an action if and only if the
  // rules still allow that action in the state the write produced. For everything except snooze
  // that means the action just taken disappears; snooze survives on purpose (D11 — «отложить ещё
  // на 24 часа» is a real instruction), and asserting it disappears would assert away the decision.
  const after = (r.verified.kb || []).flat();
  const offeredAfter = after.map((b) => b.action).sort();
  const allowedAfter = OFFERED.map((b) => b.action).filter((a) => A.refuseReason(a, r.written, KIND) === '').sort();
  eqw(offeredAfter.join(), allowedAfter.join(), label + ': the post-write keyboard is exactly what the post-write state allows');
  eqw(after.some((b) => b.action === label), A.refuseReason(label, r.written, KIND) === '',
    label + ': the action just taken survives only if a repeat is still a real instruction');
  want(SHAPES.has(String(r.verified.kb_shape)), label + ': the shape ' + r.verified.kb_shape + ' has an edit node');
  want(!after.some((b) => String(b.callback_data).startsWith('won|')), label + ': no won button after the write');

  // the message survives the edit, and the confirmation is truthful
  eqw(r.decided.edit_html, ORIGIN_HTML, label + ': the alert body is rebuilt byte-identically for the edit');
  const heads = (String(r.decided.reply_text).match(/FINMENTOR/g) || []).length;
  eqw(heads, 1, label + ': the confirmation carries exactly one FINMENTOR header');
  want(!/undefined|NaN|\[object/.test(String(r.decided.reply_text)), label + ': no formatting hole in the confirmation');
  eqw(typeof r.decided._offset, 'number', label + ': the confirmation clock resolved a real offset');

  // requirement 12 — a second identical tap performs NO write
  // requirement 12 — a second identical tap performs NO write. WHICH refusal it earns depends on
  // what the first tap did to the row: `done` and `nurture` close the lead, so the repeat is
  // refused as TERMINAL rather than as ALREADY_APPLIED. Both are no-write refusals; pinning the
  // wrong one of the two would have failed a correct system.
  const repeatAllowed = A.refuseReason(label, r.written, KIND) === '';
  const dup = tap(btn.callback_data, r.written, KIND, { originState: ROW });
  if (repeatAllowed) {
    eqw(dup.decided._allowed, true, label + ': a repeat is allowed, and the module says so');
  } else {
    eqw(dup.decided._allowed, false, label + ': a duplicate tap is refused');
    eqw(dup.decided._reason, A.refuseReason(label, r.written, KIND), label + ': and refused for the reason the post-write state warrants');
    want(['ALREADY_APPLIED', 'TERMINAL'].includes(dup.decided._reason), label + ': the refusal is a no-write refusal');
    want(!('_upd' in dup.decided), label + ': a refused tap carries no update, so no writer can be fed');
  }
  printed.push({ label: label, reply: r.decided.reply_text, kb: r.verified.kb });
}

// ── snooze is deliberately NOT idempotent-by-state ────────────────────────────────────────────
{
  const snooze = OFFERED.find((b) => b.action === 'snooze');
  if (snooze) {
    const first = tap(snooze.callback_data, ROW, KIND);
    const second = tap(snooze.callback_data, first.written, KIND, { originState: ROW });
    eqw(second.decided._allowed, true, 'snooze: «отложить ещё на 24 часа» is a real instruction, not a duplicate');
    want(String(second.sparse.next_follow_up_at) >= String(first.sparse.next_follow_up_at),
      'snooze: the second tap re-bases from the second tap');
    want(/Z$/.test(String(first.sparse.next_follow_up_at)), 'snooze: storage stays UTC');
    want(!('sla_status' in first.sparse), 'snooze: sla_status is not an owned column');
  } else { bad('snooze is not offered on the real row — the case cannot be proven'); }
}

// ── the refusals ──────────────────────────────────────────────────────────────────────────────
{
  const docs = OFFERED.find((b) => b.action === 'docs') || OFFERED[0];

  // stale: an action from the OTHER origin set, which the current state no longer offers
  const stale = tap('done|' + LEAD_ID, ROW, 'new_lead');
  eqw(stale.decided._allowed, false, 'a tap from a keyboard the state no longer offers is refused');
  eqw(stale.decided._reason, 'STATE_CHANGED', 'and refused as stale, not as already applied');

  // terminal
  const won = Object.assign({}, ROW, { deal_stage: 'Won' });
  const term = tap(docs.callback_data, won, KIND);
  eqw(term.decided._allowed, false, 'a tap on a closed lead is refused');
  eqw(term.decided._reason, 'TERMINAL', 'and refused as terminal');

  // not found
  const nf = tap(docs.callback_data.replace(LEAD_ID, 'FIN-does-not-exist'), ROW, KIND, { rows: [ROW] });
  eqw(nf.decided._found, false, 'a lead the fresh read cannot see is NOT_FOUND');
  eqw(nf.decided._allowed, false, 'and nothing is written for it');
  want(!/undefined|NaN/.test(String(nf.decided.reply_text)), 'the not-found copy has no formatting hole');

  for (const r of [stale, term, nf]) {
    want(!('_upd' in r.decided), 'a refusal carries no update');
    want(SHAPES.has(String(r.decided.kb_shape)), 'a refusal still routes to an edit node (' + r.decided.kb_shape + ')');
    eqw(r.decided.edit_html, r.decided._found ? ORIGIN_HTML : '', 'a refusal rebuilds the body it is about to re-send');
  }
}

// ── the write that did not land ───────────────────────────────────────────────────────────────
{
  const docs = OFFERED.find((b) => b.action === 'docs') || OFFERED[0];
  // the Sheets node returned without throwing, and wrote nothing
  const half = tap(docs.callback_data, ROW, KIND, { writeRow: (row) => Object.assign({}, row) });
  eqw(half.verified._verified, false, 'a silent no-op write is NOT reported as success');
  want((half.verified._mismatched || []).length > 0, 'and the columns that failed to move are named');
  want(!/успешн|готово|обработан/i.test(String(half.verified.reply_text)), 'the failure copy claims no success');
  const gone = tap(docs.callback_data, ROW, KIND, { writeRow: () => ({ lead_id: 'SOMETHING-ELSE' }) });
  eqw(gone.verified._verified, false, 'a row that vanished between write and read-back is not success either');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
if (PRINT) {
  say('');
  say('F. what the owner would see');
  say('='.repeat(78));
  for (const p of printed) {
    say('');
    say('── ' + p.label + ' ' + '─'.repeat(Math.max(3, 70 - p.label.length)));
    say(p.reply);
    say('   keyboard: ' + (p.kb.length ? p.kb.map((r) => r.map((b) => b.text).join(' | ')).join('   //   ') : '(cleared)'));
  }
}

say('');
say('='.repeat(78));
say('  ' + pass + ' passed, ' + failures.length + ' failed');
say('');
say('  Read-only: no PUT, no POST, no execution, no Telegram send, no Sheets write.');
say('  NOT PROVEN HERE: that n8n runs this graph. Only a real tap closes that.');
say('');
if (failures.length) { process.exit(1); }
