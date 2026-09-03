#!/usr/bin/env node
// FINMENTOR — Lead Alert action UX, STAGE 1: PRESENTATION ONLY.
//
//   node scripts/deploy-lead-alert-keyboards.mjs --dry-run
//   node scripts/deploy-lead-alert-keyboards.mjs --confirm
//
// Changes what the owner SEES. Changes nothing about what a tap DOES.
//
// ── WHY EACH WORKFLOW GETS A DIFFERENT SIZE OF CHANGE ─────────────────────────────────────────
//
// Measured, not assumed:
//
//   LEAD INTAKE   `Route by Lead Priority` sends ONLY `lead_priority === 'HOT'` to
//                 `Build Premium Telegram Brief`. `Build Pipeline Row` maps HOT to
//                 deal_stage 'Qualified' with sla_status 'Active' — never terminal, never
//                 Discovery Scheduled, never Documents Requested. So the NEW LEAD keyboard is
//                 ALWAYS the same 2+2 shape, and this is ONE PARAMETER on ONE NODE. No new node,
//                 no routing, no state lookup, on the 106-node workflow that is closed at GO.
//
//   SLA / FOLLOWUP  Both already exclude terminal leads upstream — `STOP_STAGES` and `isClosed()`
//                 drop won/lost/closed/nurture/incomplete, and sla_status done/nurture — so the
//                 empty keyboard is unreachable there. But a lead at 'Discovery Scheduled' or
//                 'Documents Requested' DOES alert, and the owner-approved rule hides the action
//                 that is already the current state. That is two shapes, and an n8n Telegram node
//                 has a fixed row count, so it is two nodes plus a router.
//
// ── WHAT IS DELIBERATELY NOT TOUCHED ──────────────────────────────────────────────────────────
//
// callback_data is byte-identical to production, so the existing Command Center keeps receiving
// exactly what it receives today and every alert already in the owner's history keeps working.
// The legacy `won|` route stays wired; this change only stops EMITTING that button.
//
// No mutation semantics, no Pipeline writer, no message_id, no keyboard editing, no acknowledgement
// order, no Command Center node. Those are Stage 2 and the script asserts their absence.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { inlineCrmStageResolver } from './lib/inline-crm-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CAND_DIR = join(ROOT, 'n8n', 'candidate');

const LEAD_INTAKE = 'QmIyEW2ZEqKregmN';
const SLA = 'LZ2mvKXbBikmeVTn';
const FOLLOWUP = 'zeLOCuf0K1bkaKl2';
const COMMAND_CENTER = 'qF9tonlHHIxc8MDd';

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

// ── the keyboard, from the gated module ───────────────────────────────────────────────────────
const ACTIONS_SRC = inlineCrmStageResolver(
  readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8').replace(/\r\n/g, '\n'),
  readFileSync(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'), 'utf8').replace(/\r\n/g, '\n'));
const LAA = new Function(ACTIONS_SRC + '; return LAA;')();

const btn = (text, cb) => ({ text, additionalFields: { callback_data: cb } });
const rowsParam = (rows) => ({ rows: rows.map((r) => ({ row: { buttons: r } })) });

// NEW LEAD: the four actions are fixed, so the labels and callbacks are literals and the only
// expression is the lead id — exactly the shape production already uses.
function newLeadKeyboard() {
  const k = LAA.keyboard('new_lead', { deal_stage: 'Qualified', sla_status: 'Active' }, '__ID__');
  if (LAA.shape(k) !== 'KB22') { die('the module no longer yields KB22 for a HOT new lead'); }
  return rowsParam(k.map((row) => row.map((b) => btn(b.text, '=' + b.callback_data.replace('__ID__', '{{$json.lead_id}}')))));
}

// SLA / FOLLOWUP: the row CONTENT varies, so each slot is filled from the computed `kb` array —
// the pattern the Telegram Client Transport already uses for its dynamic keyboards.
function slotKeyboard(shape) {
  const counts = shape.replace('KB', '').split('').map(Number);
  return rowsParam(counts.map((n, r) => {
    const row = [];
    for (let c = 0; c < n; c++) {
      row.push(btn('={{ $json.kb[' + r + '][' + c + '].text }}',
        '={{ $json.kb[' + r + '][' + c + '].callback_data }}'));
    }
    return row;
  }));
}

// The keyboard builder. It reads the Pipeline rows the workflow ALREADY read — no new Sheets call,
// no edit to the node that decides which leads alert — joins on lead_id, and adds two fields.
function keyboardBuilderCode(kind) {
  return ACTIONS_SRC + '\n'
    + '// STAGE 1 — presentation only. Adds `kb` and `kb_shape`; changes nothing else on the item.\n'
    + '//\n'
    + '// State comes from the Pipeline rows this workflow already read upstream, so no selection\n'
    + '// node is edited and no additional Sheets read is performed. A lead that cannot be found\n'
    + '// falls back to the FULL keyboard, which is exactly what production shows today.\n'
    + 'function __state(leadId) {\n'
    + '  try {\n'
    + "    const rows = $('Get Pipeline Rows').all().map((i) => i.json);\n"
    + "    const t = String(leadId == null ? '' : leadId).trim().toLowerCase();\n"
    + "    const r = rows.find((x) => String(x.lead_id == null ? '' : x.lead_id).trim().toLowerCase() === t);\n"
    + '    return r ? { deal_stage: r.deal_stage, sla_status: r.sla_status } : {};\n'
    + '  } catch (e) { return {}; }\n'
    + '}\n'
    + 'return $input.all().map(function (i) {\n'
    + '  const j = i.json;\n'
    + "  const rows = LAA.keyboard('" + kind + "', __state(j.lead_id), j.lead_id);\n"
    + '  return { json: Object.assign({}, j, { kb: rows, kb_shape: LAA.shape(rows) }) };\n'
    + '});\n';
}

const shapeIf = (name, pos) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id: 'kb-shape-cond',
        leftValue: '={{ String($json.kb_shape) }}',
        rightValue: 'KB221',
        operator: { type: 'string', operation: 'equals' }
      }],
      combinator: 'and'
    },
    options: {}
  },
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: pos,
  id: 'kb-shape-if-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name
});

// ── build the three deltas ────────────────────────────────────────────────────────────────────

function buildLeadIntake(live) {
  const next = JSON.parse(JSON.stringify(importable(live)));
  const node = next.nodes.find((n) => n.name === 'Telegram Lead Alert');
  if (!node) { die('Lead Intake: Telegram Lead Alert is missing'); }
  node.parameters = Object.assign({}, node.parameters, { inlineKeyboard: newLeadKeyboard() });
  return { next, added: [], touched: ['Telegram Lead Alert'] };
}

function buildSlotted(live, cfg) {
  const next = JSON.parse(JSON.stringify(importable(live)));
  const tg = next.nodes.find((n) => n.name === cfg.telegramNode);
  if (!tg) { die(cfg.label + ': ' + cfg.telegramNode + ' is missing'); }
  const feeder = Object.entries(live.connections)
    .filter(([, o]) => (o.main || []).some((br) => (br || []).some((t) => t.node === cfg.telegramNode)))
    .map(([s]) => s);
  if (feeder.length !== 1) { die(cfg.label + ': expected exactly one feeder, got ' + feeder.join(',')); }
  const from = feeder[0];
  const pos = tg.position || [0, 0];

  // the full-shape node is the EXISTING one, re-slotted
  tg.parameters = Object.assign({}, tg.parameters, { inlineKeyboard: slotKeyboard('KB221') });

  const builder = {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: keyboardBuilderCode(cfg.kind) },
    type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [pos[0] - 220, pos[1] + 180],
    id: 'kb-build-' + cfg.kind, name: cfg.builderName
  };
  const iff = shapeIf(cfg.ifName, [pos[0] - 40, pos[1] + 180]);
  const reduced = JSON.parse(JSON.stringify(tg));
  reduced.name = cfg.reducedName;
  reduced.id = 'kb-tg-4-' + cfg.kind;
  reduced.position = [pos[0] + 200, pos[1] + 220];
  reduced.parameters = Object.assign({}, tg.parameters, { inlineKeyboard: slotKeyboard('KB22') });
  if (reduced.webhookId) { delete reduced.webhookId; }

  next.nodes.push(builder, iff, reduced);
  next.connections[from] = JSON.parse(JSON.stringify(live.connections[from]));
  for (const br of (next.connections[from].main || [])) {
    for (const t of (br || [])) { if (t.node === cfg.telegramNode) { t.node = cfg.builderName; } }
  }
  next.connections[cfg.builderName] = { main: [[{ node: cfg.ifName, type: 'main', index: 0 }]] };
  next.connections[cfg.ifName] = {
    main: [
      [{ node: cfg.telegramNode, type: 'main', index: 0 }],
      [{ node: cfg.reducedName, type: 'main', index: 0 }]
    ]
  };
  return { next, added: [cfg.builderName, cfg.ifName, cfg.reducedName], touched: [cfg.telegramNode] };
}

// ── invariants, asserted on the OUTPUT ────────────────────────────────────────────────────────

function verifyPresentationOnly(live, built, label) {
  const problems = [];
  const want = (c, m) => { if (!c) { problems.push(label + ': ' + m); } };
  const { next, added, touched } = built;

  want(next.nodes.length === live.nodes.length + added.length,
    'node count moved by ' + (next.nodes.length - live.nodes.length) + ', expected +' + added.length);

  // every pre-existing node except the re-keyboarded Telegram nodes must be byte-identical
  for (let i = 0; i < live.nodes.length; i++) {
    const a = live.nodes[i];
    const b = next.nodes[i];
    want(b && b.name === a.name, 'node order changed at ' + i);
    if (!b) { continue; }
    if (touched.includes(a.name)) {
      const ca = JSON.parse(JSON.stringify(a));
      const cb = JSON.parse(JSON.stringify(b));
      delete ca.parameters.inlineKeyboard;
      delete cb.parameters.inlineKeyboard;
      want(JSON.stringify(ca) === JSON.stringify(cb), a.name + ' changed beyond its inlineKeyboard');
      continue;
    }
    want(JSON.stringify(a) === JSON.stringify(b), 'node changed but should not have: ' + a.name);
  }

  // no Sheets node may be added, changed or removed — this is presentation only
  const sheets = (wf) => (wf.nodes || []).filter((n) => n.type === 'n8n-nodes-base.googleSheets')
    .map((n) => [n.name, n.parameters.operation, JSON.stringify(n.parameters.columns || null)]);
  want(JSON.stringify(sheets(live)) === JSON.stringify(sheets(next)), 'a Google Sheets node changed');

  // no P9-R2 flag pair anywhere
  for (const n of next.nodes) {
    want(!(n.alwaysOutputData === true && n.onError === 'continueErrorOutput'),
      'alwaysOutputData beside continueErrorOutput on ' + n.name);
  }

  // the callback contract is byte-identical to production
  const cbs = (wf) => {
    const out = [];
    const walk = (v) => {
      if (!v || typeof v !== 'object') { return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      for (const [k, x] of Object.entries(v)) {
        if (k === 'callback_data' && typeof x === 'string') { out.push(x); }
        walk(x);
      }
    };
    walk(wf.nodes);
    return out.sort();
  };
  const before = cbs(live);
  const after = cbs(next);
  // Production's single-row keyboard is replaced, so the SET of emitted callbacks may shrink
  // (Won disappears) but no NEW callback verb may appear.
  const verbs = (list) => [...new Set(list.map((s) => String(s).replace(/^=/, '').split('|')[0]))].sort();
  for (const v of verbs(after)) {
    want(verbs(before).includes(v) || v.startsWith('{{'), 'a new callback verb appeared: ' + v);
  }
  want(!after.some((s) => /(^|\|)=?won\|/.test(s) || /^=?won\|/.test(String(s).replace(/^=/, ''))),
    'a won callback is still emitted');

  return problems;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────

say('');
say('LEAD ALERT ACTION UX — STAGE 1, PRESENTATION ONLY');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites live workflows; re-run with --confirm (or --dry-run first)'); }

say('STEP 0 — the offline suite');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'run-all.mjs')], { encoding: 'utf8' });
  const tail = String(r.stdout || '').trim().split('\n').slice(-3).join('\n');
  if (r.status !== 0) { say(tail); die('the offline suite is not green; nothing is deployed from a red tree'); }
  ok('suite green');
  say(tail.split('\n').map((l) => '        ' + l).join('\n'));
}
say('');

say('STEP 1 — live workflows, pre-images and rollback artifacts');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CAND_DIR, { recursive: true });
const live = {};
for (const [id, label] of [[LEAD_INTAKE, 'Lead Intake'], [SLA, 'SLA Lead Watch'], [FOLLOWUP, 'Followup Sequence']]) {
  live[id] = await api('GET', '/workflows/' + id);
  const p = join(OUT_DIR, id + '.pre-alert-keyboards.json');
  const body = JSON.stringify(importable(live[id]), null, 2) + '\n';
  if (existsSync(p) && !args.includes('--refresh-rollback')) {
    if (sha(readFileSync(p, 'utf8')) !== sha(body)) { die(label + ' changed since the rollback was captured; re-run the dry run'); }
  } else { writeFileSync(p, body, 'utf8'); }
  ok(label.padEnd(20) + live[id].nodes.length + ' nodes, active=' + live[id].active + '  rollback: ' + p);
}
const ccBefore = await api('GET', '/workflows/' + COMMAND_CENTER);
const ccHash = sha(structural(ccBefore));
ok('Command Center hashed before: ' + ccHash.slice(0, 16));
say('');

say('STEP 2 — the deltas');
const built = {
  [LEAD_INTAKE]: buildLeadIntake(live[LEAD_INTAKE]),
  [SLA]: buildSlotted(live[SLA], {
    label: 'SLA', kind: 'priority', telegramNode: 'Telegram SLA Alert',
    builderName: 'Build SLA Alert Keyboard', ifName: 'SLA Keyboard Shape', reducedName: 'Telegram SLA Alert (4)'
  }),
  [FOLLOWUP]: buildSlotted(live[FOLLOWUP], {
    label: 'Followup', kind: 'followup', telegramNode: 'Telegram Followup Reminder',
    builderName: 'Build Followup Alert Keyboard', ifName: 'Followup Keyboard Shape', reducedName: 'Telegram Followup Reminder (4)'
  })
};
let problems = [];
for (const [id, label] of [[LEAD_INTAKE, 'Lead Intake'], [SLA, 'SLA Lead Watch'], [FOLLOWUP, 'Followup Sequence']]) {
  problems = problems.concat(verifyPresentationOnly(live[id], built[id], label));
  const b = built[id];
  say('  ' + label.padEnd(20) + '+' + b.added.length + ' nodes  (' + (b.added.join(', ') || 'none') + ')'
    + '   re-keyboarded: ' + b.touched.join(', '));
  writeFileSync(join(CAND_DIR, id + '.alert-keyboards-candidate.json'),
    JSON.stringify({ name: b.next.name, nodes: sanitize(b.next.nodes), connections: b.next.connections, settings: b.next.settings }, null, 2) + '\n', 'utf8');
}
if (problems.length) { for (const p of problems) { say('  FAIL  ' + p); } die(problems.length + ' invariant(s) failed'); }
ok('presentation-only invariants hold for all three');
ok('no Google Sheets node added, removed or changed anywhere');
ok('no new callback verb; no won callback emitted');
say('');

say('STEP 3 — ' + (DRY ? 'write (SKIPPED: dry run)' : 'write'));
if (DRY) {
  ok('dry run complete — candidates written to n8n/candidate/');
  say('');
  say('Nothing was written to the tenant.');
  say('');
  process.exit(0);
}
for (const [id, label] of [[LEAD_INTAKE, 'Lead Intake'], [SLA, 'SLA Lead Watch'], [FOLLOWUP, 'Followup Sequence']]) {
  await api('PUT', '/workflows/' + id, built[id].next);
  ok('PUT ' + label);
}
say('');

say('STEP 4 — read-back verification');
for (const [id, label] of [[LEAD_INTAKE, 'Lead Intake'], [SLA, 'SLA Lead Watch'], [FOLLOWUP, 'Followup Sequence']]) {
  const after = await api('GET', '/workflows/' + id);
  const expect = built[id].next;
  if (after.nodes.length !== expect.nodes.length) { die(label + ': tenant stored ' + after.nodes.length + ' nodes — ROLLBACK'); }
  if (after.name !== live[id].name) { die(label + ': the workflow was renamed — ROLLBACK'); }
  if (after.active !== true) { die(label + ': no longer active — ROLLBACK'); }
  for (const n of expect.nodes) {
    const got = after.nodes.find((x) => x.name === n.name);
    if (!got) { die(label + ': ' + n.name + ' is missing on the tenant — ROLLBACK'); }
    if (JSON.stringify(got.parameters) !== JSON.stringify(n.parameters)) { die(label + ': ' + n.name + ' does not match what was sent — ROLLBACK'); }
  }
  if (JSON.stringify(after.connections) !== JSON.stringify(expect.connections)) { die(label + ': connections do not match — ROLLBACK'); }
  ok(label.padEnd(20) + after.nodes.length + ' nodes, active, parameters and connections match');
  writeFileSync(join(OUT_DIR, id + '.post-alert-keyboards.json'), JSON.stringify(importable(after), null, 2) + '\n', 'utf8');
}
say('');

say('STEP 5 — the Command Center must not have moved');
const ccAfter = await api('GET', '/workflows/' + COMMAND_CENTER);
if (sha(structural(ccAfter)) !== ccHash) { die('the Command Center CHANGED during this deploy — investigate immediately'); }
ok('Command Center byte-identical: ' + ccHash.slice(0, 16));
ok('no mutation semantics, no Pipeline writer, no message_id, no keyboard editing were touched');
say('');
say('STAGE 1 DEPLOYED — presentation only.');
say('');
say('ROLLBACK:  PUT each id with its .uat/<id>.pre-alert-keyboards.json');
say('');
