#!/usr/bin/env node
// FINMENTOR — deploy the owner-approved Telegram button STYLE policy to the live owner alerts.
//
//   node scripts/deploy-telegram-button-styles.mjs --dry-run   fresh-read, build, verify, write nothing
//   node scripts/deploy-telegram-button-styles.mjs --confirm    PUT each workflow, fresh-read, verify
//
// SCOPE. The ONLY delta this script may produce anywhere is a `style` key on a button of a named
// Telegram node. It never touches text, callback_data, rows, order, credentials, triggers, Code
// nodes, connections or settings, and it refuses to write if it finds it has.
//
// TWO KINDS OF KEYBOARD, AND WHY THEY ARE HANDLED DIFFERENTLY.
//
//   literal   Lead Intake's NEW LEAD alert and the X-Ray owner alert hold their buttons in the
//             node. A button is matched by the contract it already carries — its callback verb,
//             or for the X-Ray url buttons its exact label — and the approved style for that
//             action is written. Nothing positional.
//
//   slotted   SLA, Follow-up and the Command Center's edit nodes fill fixed slots from
//             `$json.kb[row][col]`. An n8n Telegram node cannot make a key conditionally absent,
//             and `style: ""` is a 400 that would LOSE an owner alert, so a slot may only carry a
//             literal style when the action landing in it is the same for every reachable lead
//             state. `n8n/src/lead-alerts/style-slots.js` decides that by enumeration; this
//             script applies its verdict and never overrides it.
//
// Ambiguous slots stay neutral and are printed as gaps. That is deliberate: an under-emphasised
// button is a visible, safe shortfall; a wrongly-emphasised one teaches the owner the wrong cue.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { keepRollback } from './lib/rollback-artifact.mjs';
import { inlineCrmStageResolver } from './lib/inline-crm-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, '.uat');
const require_ = createRequire(import.meta.url);
const lf = (s) => s.replace(/\r\n/g, '\n');

const ACTIONS_SRC = inlineCrmStageResolver(
  lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')),
  lf(readFileSync(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'), 'utf8'))
);
const LAA = new Function(ACTIONS_SRC + '\n; return LAA;')();
const SLOTS = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'style-slots.js'));

// callback verb -> action, so a literal button is matched by the contract it already carries.
const VERB = { stage: 'discovery', docs: 'docs', snooze: 'snooze', nurture: 'nurture', done: 'done' };

// The X-Ray owner alert's two buttons are url buttons with no callback_data, so they are matched
// by their exact approved labels. Both are frozen in the owner matrix.
const XRAY_LABELS = { '✅ Проверить анализ': 'success', '📊 Карточка лида': 'primary' };

export function styleForCallback(callbackData) {
  const verb = String(callbackData || '').replace(/^=/, '').split('|')[0].trim();
  const action = VERB[verb];
  return action ? (LAA.STYLE[action] || null) : null;
}

// ── the plan: every node this script may touch, and the style each button must end up with ─────
export function buildPlan() {
  const out = [];
  // literal keyboards, matched by contract
  out.push({
    workflowId: 'QmIyEW2ZEqKregmN', workflow: 'Lead Intake', node: 'Telegram Lead Alert',
    surface: 'NEW LEAD', match: 'callback-verb'
  });
  out.push({
    workflowId: 'tNSMRoKlFB52vjge', workflow: 'X-Ray Analysis', node: 'Telegram Owner Alert',
    surface: 'X-RAY REVIEW', match: 'label'
  });
  // slotted keyboards, positional, only where proven deterministic
  for (const p of SLOTS.deployPlan(LAA)) {
    out.push({
      workflowId: p.workflowId, workflow: p.workflow, node: p.node,
      surface: p.workflow + ' ' + p.shape, match: 'slot',
      assignments: p.assignments, ambiguous: p.ambiguous, shape: p.shape, kinds: p.kinds
    });
  }
  return out;
}

// Applies the plan to one live workflow body. Returns the next body and the per-button deltas.
export function applyPlan(live, entries) {
  const next = JSON.parse(JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }));
  const deltas = [];
  for (const e of entries) {
    const node = next.nodes.find((n) => n.name === e.node);
    if (!node || !node.parameters || !node.parameters.inlineKeyboard) { throw new Error(e.workflow + ': keyboard node missing: ' + e.node); }
    const rows = node.parameters.inlineKeyboard.rows || [];
    rows.forEach((r, ri) => {
      ((r.row || {}).buttons || []).forEach((b, ci) => {
        const af = b.additionalFields || {};
        let want = null;
        if (e.match === 'callback-verb') { want = styleForCallback(af.callback_data); }
        else if (e.match === 'label') { want = XRAY_LABELS[String(b.text || '')] || null; }
        else { const a = (e.assignments || []).find((x) => x.row === ri && x.col === ci); want = a ? a.style : null; }
        const had = Object.prototype.hasOwnProperty.call(af, 'style') ? af.style : undefined;
        if (want) {
          if (had !== want) { af.style = want; deltas.push({ node: e.node, row: ri, col: ci, text: b.text, cb: af.callback_data, from: had === undefined ? '(absent)' : JSON.stringify(had), to: want }); }
        } else if (Object.prototype.hasOwnProperty.call(af, 'style')) {
          delete af.style;
          deltas.push({ node: e.node, row: ri, col: ci, text: b.text, cb: af.callback_data, from: JSON.stringify(had), to: '(absent)' });
        }
        b.additionalFields = af;
      });
    });
  }
  return { next, deltas };
}

// The delta this deploy is ALLOWED to make: nothing but `style` keys, on the named nodes only.
export function verifyStylesOnly(live, next, entries) {
  const f = [];
  const L = { name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} };
  const named = entries.map((e) => e.node);
  const strip = (wf) => {
    const c = JSON.parse(JSON.stringify(wf));
    for (const n of c.nodes) {
      const kb = (n.parameters || {}).inlineKeyboard;
      if (!kb) { continue; }
      for (const r of kb.rows || []) { for (const b of (r.row || {}).buttons || []) { if (b.additionalFields) { delete b.additionalFields.style; } } }
    }
    return JSON.stringify(c);
  };
  if (next.name !== L.name) { f.push('renamed'); }
  if (next.nodes.length !== L.nodes.length) { f.push('node count changed'); }
  if (JSON.stringify(next.connections) !== JSON.stringify(L.connections)) { f.push('connections changed'); }
  if (JSON.stringify(next.settings) !== JSON.stringify(L.settings)) { f.push('settings changed'); }
  if (strip(L) !== strip(next)) { f.push('something other than a style key changed'); }
  for (const n of next.nodes) {
    const l = L.nodes.find((x) => x.name === n.name);
    if (!l) { f.push('node added: ' + n.name); continue; }
    if (n.type !== l.type || n.typeVersion !== l.typeVersion || (n.disabled === true) !== (l.disabled === true)) { f.push(n.name + ': type/version/disabled changed'); }
    if (JSON.stringify(n.credentials || null) !== JSON.stringify(l.credentials || null)) { f.push(n.name + ': credentials changed'); }
    const kb = (n.parameters || {}).inlineKeyboard;
    if (!kb) { continue; }
    const lkb = (l.parameters || {}).inlineKeyboard || { rows: [] };
    if ((kb.rows || []).length !== (lkb.rows || []).length) { f.push(n.name + ': row count changed'); }
    (kb.rows || []).forEach((r, ri) => {
      const lr = (lkb.rows || [])[ri] || { row: { buttons: [] } };
      const bs = (r.row || {}).buttons || []; const lbs = (lr.row || {}).buttons || [];
      if (bs.length !== lbs.length) { f.push(n.name + ': row ' + ri + ' width changed'); }
      bs.forEach((b, ci) => {
        const lb = lbs[ci] || {};
        if (String(b.text) !== String(lb.text)) { f.push(n.name + ' [' + ri + '][' + ci + ']: label changed'); }
        const af = b.additionalFields || {}; const laf = lb.additionalFields || {};
        if (String(af.callback_data) !== String(laf.callback_data)) { f.push(n.name + ' [' + ri + '][' + ci + ']: callback_data changed'); }
        if (String(af.url) !== String(laf.url)) { f.push(n.name + ' [' + ri + '][' + ci + ']: url changed'); }
        const s = af.style;
        if (s !== undefined && LAA.STYLE_VALUES.indexOf(s) === -1) { f.push(n.name + ' [' + ri + '][' + ci + ']: unsupported style ' + JSON.stringify(s)); }
        if (s === '') { f.push(n.name + ' [' + ri + '][' + ci + ']: empty style would be a 400'); }
        if (s === 'danger') { f.push(n.name + ' [' + ri + '][' + ci + ']: danger is not in the approved matrix'); }
        // a style may only appear on a node this deploy declared
        if (s !== undefined && named.indexOf(n.name) === -1) { f.push(n.name + ': styled but not declared in the plan'); }
      });
    });
  }
  return f;
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-telegram-button-styles.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const CONFIRM = args.includes('--confirm');
  const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const READ_KEY = process.env.N8N_API_KEY;
  const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
  const say = (m) => console.log(m);
  const ok = (m) => say('  PASS  ' + m);
  const bad = (m) => say('  FAIL  ' + m);
  const die = (m) => { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); };
  const api = async (m, p, b) => {
    const res = await fetch(BASE + '/api/v1' + p, { method: m, headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}), body: b ? JSON.stringify(b) : undefined });
    const t = await res.text();
    if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
    return t ? JSON.parse(t) : null;
  };
  try {
    if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
    if (!DRY && !CONFIRM) { die('this rewrites live workflows; re-run with --confirm (or --dry-run first)'); }
    mkdirSync(OUT_DIR, { recursive: true });
    say(''); say('TELEGRAM BUTTON STYLES — controlled rollout of the owner-approved matrix'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN — nothing is written to the tenant' : '  MODE: LIVE'); say('');

    const plan = buildPlan();
    const byWorkflow = {};
    for (const e of plan) { (byWorkflow[e.workflowId] = byWorkflow[e.workflowId] || []).push(e); }

    // Deploy order is fixed and each workflow is written exactly once, with every node it owns in
    // the same PUT — so a later write can never overwrite an earlier one's style change.
    const ORDER = ['LZ2mvKXbBikmeVTn', 'zeLOCuf0K1bkaKl2', 'qF9tonlHHIxc8MDd', 'QmIyEW2ZEqKregmN', 'tNSMRoKlFB52vjge'];
    const staged = [];
    for (const id of ORDER) {
      const entries = byWorkflow[id];
      if (!entries) { continue; }
      const live = await api('GET', '/workflows/' + id);
      const body = JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }, null, 2) + '\n';
      const rb = keepRollback(join(OUT_DIR, id + '.pre-button-styles.json'), body);
      const { next, deltas } = applyPlan(live, entries);
      const f = verifyStylesOnly(live, next, entries);
      if (f.length) { die(entries[0].workflow + ': ' + f.join(' | ')); }
      say('  ' + entries[0].workflow.padEnd(20) + String(live.nodes.length).padStart(3) + ' nodes  active=' + live.active
        + '  rollback: ' + (rb.written ? '.uat/' + id + '.pre-button-styles.json' : rb.aside ? 'KEPT (prior preserved; fresh read aside)' : 'KEPT (unchanged)'));
      for (const e of entries) {
        if (e.match === 'slot') {
          say('     ' + e.node.padEnd(30) + e.shape + '  kinds=' + e.kinds.join('+')
            + '  styled: ' + (e.assignments.map((a) => '[' + a.row + '][' + a.col + ']=' + a.style).join(' ') || 'none')
            + (e.ambiguous.length ? '   GAP: ' + e.ambiguous.map((a) => '[' + a.row + '][' + a.col + '] could be ' + a.actions.join('/')) .join(' ') : ''));
        } else { say('     ' + e.node.padEnd(30) + e.surface + '  (' + e.match + ')'); }
      }
      for (const d of deltas) { say('       [' + d.row + '][' + d.col + '] ' + String(d.text).padEnd(24) + ' cb=' + JSON.stringify(d.cb) + '  style ' + d.from + ' -> ' + d.to); }
      if (!deltas.length) { say('       (already current — nothing to write)'); }
      writeFileSync(join(OUT_DIR, id + '.button-styles-candidate.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
      staged.push({ id, entries, live, next, deltas });
    }
    say('');
    ok('every delta is a `style` key on a declared node; labels, callback_data, urls, rows, order, credentials, connections and settings byte-identical');

    if (DRY) { say('\nDRY RUN — nothing written to the tenant.'); }
    else {
      for (const s of staged) {
        if (!s.deltas.length) { ok(s.entries[0].workflow + ': already current, not written'); continue; }
        await api('PUT', '/workflows/' + s.id, s.next);
        const after = await api('GET', '/workflows/' + s.id);
        const f = verifyStylesOnly(s.live, { name: after.name, nodes: after.nodes, connections: after.connections, settings: after.settings || {} }, s.entries);
        const applied = s.deltas.every((d) => {
          const n = after.nodes.find((x) => x.name === d.node);
          const b = ((((n.parameters.inlineKeyboard.rows || [])[d.row] || {}).row || {}).buttons || [])[d.col] || {};
          const s2 = (b.additionalFields || {}).style;
          return d.to === '(absent)' ? s2 === undefined : s2 === d.to;
        });
        if (f.length) { bad(s.entries[0].workflow + ' post-deploy: ' + f.join(' | ')); }
        else if (!applied) { bad(s.entries[0].workflow + ' post-deploy: a style did not read back'); }
        else { ok(s.entries[0].workflow + ': written and read back, active=' + after.active + ', ' + s.deltas.length + ' style key(s)'); }
      }
      say('\n  rollback: PUT each /api/v1/workflows/<id> with .uat/<id>.pre-button-styles.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
