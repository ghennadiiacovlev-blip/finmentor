#!/usr/bin/env node
// FINMENTOR — Premium UX (approved 2026-09-04): re-inline the CURRENT owner presenter into the live
// workflows that carry it, keeping everything else byte-for-byte.
//
//   node scripts/refresh-lead-alerts-presenter.mjs --dry-run     read live, prove the delta, write nothing
//   node scripts/refresh-lead-alerts-presenter.mjs --confirm     PUT the six workflows, fresh-read, verify
//
// WHY NOT deploy-lead-alerts-presentation.mjs. That script refuses unless live equals either its
// pre-presentation snapshot or its last deployed record. Three of the five workflows have moved
// since (keyboards Stage 1, Lead Intake fixes), so it cannot redeploy onto them. This script does
// what a redeploy of a presentation pass IS: it replaces the inlined module block at the head of
// each builder node with the freshly built one and leaves the live prefix + tail untouched.
//
// SHAPE. Lead Alerts builder nodes start with the INLINED block (tz IIFE + presenter IIFE) followed
// by '\n' and the live code. The SYSTEM ALERT `Build System Alert` node carries the presenter IIFE
// between a header comment and an END marker. Both are split at fixed strings; a layout that does
// not match is a refusal, never a guess. verifyRefresh() re-derives everything on the output.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keepRollback } from './lib/rollback-artifact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const lf = (s) => s.replace(/\r\n/g, '\n');

export const LA_OPEN = 'const LA = (function () {';
export const IIFE_CLOSE = '\n})();';
export const WORKFLOWS = [
  { id: 'imeJIDeNyaWDyXzh', label: 'Daily Lead Digest', kind: 'lead-alerts', nodes: ['Build Daily Digest'] },
  { id: 'LZ2mvKXbBikmeVTn', label: 'SLA Lead Watch', kind: 'lead-alerts', nodes: ['SLA Select'] },
  { id: 'zeLOCuf0K1bkaKl2', label: 'Followup Sequence', kind: 'lead-alerts', nodes: ['Build Followup Plan'] },
  { id: 'RBiFLhVjizMkAzrK', label: 'Error Monitor', kind: 'lead-alerts', nodes: ['Build Error Alert'] },
  { id: 'QmIyEW2ZEqKregmN', label: 'Lead Intake', kind: 'lead-alerts', nodes: ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert'] },
  { id: 'ID700kTo6EXffwry', label: 'SYSTEM ALERT', kind: 'system-alert', nodes: ['Build System Alert'] }
];

// The same conversion the builders perform: a CommonJS module becomes an IIFE returning its exports.
function inline(name, src) {
  const marker = 'module.exports = ';
  const i = src.lastIndexOf(marker);
  if (i === -1) { throw new Error(name + ': no module.exports to convert'); }
  return 'const ' + name + ' = (function () {\n' + src.slice(0, i) + '\nreturn ' + src.slice(i + marker.length).replace(/;\s*$/, '') + ';\n})();';
}

export function sources() {
  const presenter = lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8'));
  const tz = lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'), 'utf8'));
  const inlined =
    '// ─── INLINED FROM n8n/src/lead-alerts/tz.js — DO NOT EDIT HERE ───────────────────────────────\n' +
    '// scripts/build-lead-alerts-presentation.mjs regenerates this block. An edit made in the n8n\n' +
    '// editor is lost on the next build and is invisible to qa/lead-alerts-presentation.test.mjs.\n' +
    inline('LATZ', tz) + '\n\n' +
    '// ─── INLINED FROM n8n/src/lead-alerts/presenter.js — DO NOT EDIT HERE ────────────────────────\n' +
    inline('LA', presenter);
  const laOnly = inline('LA', presenter);
  // The layout must stay splittable next time: exactly two IIFE closes in the block (tz, presenter).
  if ((inlined.match(/\n\}\)\(\);/g) || []).length !== 2) { throw new Error('the inlined block does not close exactly twice'); }
  if ((laOnly.match(/\n\}\)\(\);/g) || []).length !== 1) { throw new Error('the presenter IIFE does not close exactly once'); }
  return { inlined, laOnly };
}

// Split a live node body into { block, rest } where block ends at the presenter IIFE close.
export function splitNode(code, kind) {
  const c = lf(String(code || ''));
  const iLA = c.indexOf(LA_OPEN);
  if (iLA === -1) { throw new Error('no presenter block'); }
  const close = c.indexOf(IIFE_CLOSE, iLA);
  if (close === -1) { throw new Error('presenter block has no close'); }
  const end = close + IIFE_CLOSE.length;
  if (kind === 'lead-alerts') {
    if (!c.startsWith('// ─── INLINED FROM n8n/src/lead-alerts/tz.js')) { throw new Error('the node does not start with the INLINED block'); }
    if (c.indexOf('const LATZ = (function () {') === -1 || c.indexOf('const LATZ = (function () {') > iLA) { throw new Error('tz block missing or out of order'); }
    return { head: '', block: c.slice(0, end), rest: c.slice(end) };
  }
  if (kind === 'system-alert') {
    const head = c.slice(0, iLA);
    if (!/INLINED FROM n8n\/src\/lead-alerts\/presenter\.js — DO NOT EDIT HERE/.test(head)) { throw new Error('presenter header missing'); }
    if (!c.slice(end).startsWith('\n// ─── END INLINED MODULE')) { throw new Error('END INLINED MODULE marker missing after the presenter'); }
    return { head, block: c.slice(iLA, end), rest: c.slice(end) };
  }
  throw new Error('unknown kind ' + kind);
}

export function refreshWorkflow(live, spec, src) {
  const next = JSON.parse(JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }));
  const touched = [];
  for (const name of spec.nodes) {
    const n = next.nodes.find((x) => x.name === name);
    if (!n || !n.parameters || typeof n.parameters.jsCode !== 'string') { throw new Error(spec.label + ': Code node missing: ' + name); }
    const p = splitNode(n.parameters.jsCode, spec.kind);
    const fresh = spec.kind === 'lead-alerts' ? src.inlined : src.laOnly;
    const rebuilt = p.head + fresh + p.rest;
    if (rebuilt !== lf(n.parameters.jsCode)) { n.parameters.jsCode = rebuilt; touched.push(name); }
  }
  return { next, touched };
}

export function verifyRefresh(live, next, spec, src) {
  const f = [];
  const L = { name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} };
  if (next.name !== L.name) { f.push('renamed'); }
  if (next.nodes.length !== L.nodes.length) { f.push('node count changed'); }
  if (JSON.stringify(next.connections) !== JSON.stringify(L.connections)) { f.push('connections changed'); }
  if (JSON.stringify(next.settings) !== JSON.stringify(L.settings)) { f.push('settings changed'); }
  const fresh = spec.kind === 'lead-alerts' ? src.inlined : src.laOnly;
  for (const n of next.nodes) {
    const l = L.nodes.find((x) => x.name === n.name);
    if (!l) { f.push('node added: ' + n.name); continue; }
    if (!spec.nodes.includes(n.name)) { if (JSON.stringify(n) !== JSON.stringify(l)) { f.push('undeclared node changed: ' + n.name); } continue; }
    if (JSON.stringify(n.credentials || null) !== JSON.stringify(l.credentials || null)) { f.push(n.name + ': credentials changed'); }
    if (n.type !== l.type || n.typeVersion !== l.typeVersion || (n.disabled === true) !== (l.disabled === true)) { f.push(n.name + ': type/version/disabled changed'); }
    const before = splitNode(l.parameters.jsCode, spec.kind); const after = splitNode(n.parameters.jsCode, spec.kind);
    if (before.rest !== after.rest) { f.push(n.name + ': the live tail is not byte-identical'); }
    if (before.head !== after.head) { f.push(n.name + ': the head is not byte-identical'); }
    if (after.block !== fresh) { f.push(n.name + ': the inlined block is not the current module'); }
    for (const k of Object.keys(n.parameters).filter((k) => k !== 'jsCode')) { if (JSON.stringify(n.parameters[k]) !== JSON.stringify(l.parameters[k])) { f.push(n.name + ': parameter changed: ' + k); } }
  }
  if (next.nodes.some((n) => n.type === 'n8n-nodes-base.telegram' && JSON.stringify(n) !== JSON.stringify(L.nodes.find((x) => x.name === n.name)))) { f.push('a Telegram node changed'); }
  return f;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('refresh-lead-alerts-presenter.mjs');
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
    say(''); say('LEAD ALERTS PRESENTER REFRESH — re-inline the approved owner presenter (2026-09-04)'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE'); say('');
    const src = sources();
    const plan = [];
    for (const spec of WORKFLOWS) {
      const live = await api('GET', '/workflows/' + spec.id);
      const rb = keepRollback(join(OUT_DIR, spec.id + '.pre-presenter-refresh.json'), JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }, null, 2) + '\n');
      const { next, touched } = refreshWorkflow(live, spec, src);
      const f = verifyRefresh(live, next, spec, src);
      if (f.length) { die(spec.label + ': ' + f.join(' | ')); }
      say('  ' + spec.label.padEnd(18) + String(live.nodes.length).padStart(3) + ' nodes, active=' + live.active + '  rewritten: ' + (touched.join(', ') || 'nothing (already current)') + (rb.aside ? '  rollback KEPT, fresh read aside' : '  rollback: .uat/' + spec.id + '.pre-presenter-refresh.json'));
      writeFileSync(join(OUT_DIR, spec.id + '.presenter-refresh-candidate.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
      plan.push({ spec, live, next, touched });
    }
    ok('six candidates written to .uat/; every delta is the inlined presenter block, nothing else');
    if (DRY) { say('\nDRY RUN — nothing written to the tenant.'); }
    else {
      for (const p of plan) {
        if (!p.touched.length) { ok(p.spec.label + ': already current, not written'); continue; }
        await api('PUT', '/workflows/' + p.spec.id, p.next);
        const after = await api('GET', '/workflows/' + p.spec.id);
        const f = verifyRefresh(p.live, after, p.spec, src);
        if (f.length) { bad(p.spec.label + ' post-deploy: ' + f.join(' | ')); } else { ok(p.spec.label + ': written and read back, active=' + after.active); }
      }
      say('\n  rollback: PUT each /api/v1/workflows/<id> with .uat/<id>.pre-presenter-refresh.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
