#!/usr/bin/env node
// FINMENTOR — OWNER CORRECTION 2026-09-04: the visible button label «🗂 В Nurture» becomes
// «🗂 В наблюдение». callback_data, chat ids, credentials, edges and every decision are untouched.
//
//   node scripts/refresh-lead-alert-labels.mjs --dry-run     read live, prove the delta, write candidates
//   node scripts/refresh-lead-alert-labels.mjs --confirm     PUT the four workflows, fresh-read, verify
//
// WHERE THE LABEL LIVES. n8n/src/lead-alerts/actions.js (LABEL.nurture) is inlined as a text block
// into four workflows: the Command Center (`Find & Build Update`, `Verify Mutation` — both also
// carry the presenter/tz blocks), the SLA watch and the Follow-up sequence (`Build … Keyboard`),
// and the Lead Intake NEW LEAD keyboard as a literal button. This script re-inlines the CURRENT
// module (and, where present, the current presenter/tz blocks) and relabels the literal button.
//
// HOW IT STAYS PRESENTATION-ONLY. Every rewritten Code node is split at fixed markers — the end of
// the actions block, the end of the presenter IIFE, the end of the tz IIFE — and the TAIL after the
// last block is kept byte-for-byte. Any node whose layout does not match these markers exactly is a
// refusal, never a guess. verifyRefresh() re-derives all of it on the output.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { inlineCrmStageResolver } from './lib/inline-crm-stage.mjs';
import { keepRollback } from './lib/rollback-artifact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CAND_DIR = join(ROOT, 'n8n', 'candidate');
const lf = (s) => s.replace(/\r\n/g, '\n');

export const OLD_LABEL = '🗂 В Nurture';
export const NEW_LABEL = '🗂 В наблюдение';
export const END_MARKER = '// =================== END FINMENTOR LEAD ALERT ACTIONS ===================';
export const WORKFLOWS = [
  { id: 'qF9tonlHHIxc8MDd', label: 'Command Center', codeNodes: ['Find & Build Update', 'Verify Mutation'], keyboardNodes: [], candidate: 'lead-command-center-labels-candidate.json' },
  { id: 'LZ2mvKXbBikmeVTn', label: 'SLA Lead Watch', codeNodes: ['Build SLA Alert Keyboard'], keyboardNodes: [], candidate: 'LZ2mvKXbBikmeVTn.alert-keyboards-candidate.json' },
  { id: 'zeLOCuf0K1bkaKl2', label: 'Followup Sequence', codeNodes: ['Build Followup Alert Keyboard'], keyboardNodes: [], candidate: 'zeLOCuf0K1bkaKl2.alert-keyboards-candidate.json' },
  { id: 'QmIyEW2ZEqKregmN', label: 'Lead Intake', codeNodes: [], keyboardNodes: ['Telegram Lead Alert'], candidate: 'QmIyEW2ZEqKregmN.alert-keyboards-candidate.json' }
];

export function sources() {
  const actions = inlineCrmStageResolver(
    lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')),
    lf(readFileSync(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'), 'utf8')));
  const presenter = lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8'));
  const tz = lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'), 'utf8'));
  if (!actions.includes(END_MARKER)) { throw new Error('actions.js lost its END marker'); }
  if (!actions.includes("nurture: '" + NEW_LABEL + "'")) { throw new Error('actions.js does not carry the new label'); }
  return {
    actionsBlock: actions.slice(0, actions.indexOf(END_MARKER) + END_MARKER.length),
    laBlock: 'const LA = (function () {\n' + presenter.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n',
    tzBlock: 'const LATZ = (function () {\n' + tz.replace(/module\.exports\s*=\s*/, 'return ') + '\n})();\n'
  };
}

// Split a live node body into [actions block, la block?, tz block?, tail]. Refuses unknown layouts.
export function splitNode(code) {
  const c = lf(String(code || ''));
  const i = c.indexOf(END_MARKER);
  if (i === -1) { throw new Error('no END marker'); }
  if (!c.startsWith('// ===================== FINMENTOR LEAD ALERT ACTIONS')) { throw new Error('the node does not start with the actions block'); }
  if (c.indexOf(END_MARKER, i + 1) !== -1) { throw new Error('two END markers'); }
  let rest = c.slice(i + END_MARKER.length);
  const out = { actions: c.slice(0, i + END_MARKER.length), gap: '', la: '', tz: '', tail: '' };
  // The deploys assembled ACTIONS_SRC (which ends with the marker and the file's newline) + '\n' +
  // LA_BLOCK + TZ_BLOCK? + TAIL. So after the marker: a blank line, then `const LA = (function () {`.
  const LA_OPEN = 'const LA = (function () {\n';
  const LA_CLOSE = '\n};\n\n})();\n';        // the presenter's return object, its trailing newline, the IIFE close
  const TZ_OPEN = 'const LATZ = (function () {\n';
  const TZ_CLOSE = '\n})();\n';
  const gap = /^\n+/.exec(rest);
  if (gap && rest.slice(gap[0].length).startsWith(LA_OPEN)) {
    out.gap = gap[0];
    rest = rest.slice(gap[0].length);
    const laEnd = rest.indexOf(LA_CLOSE);
    if (laEnd === -1) { throw new Error('presenter block has no end'); }
    out.la = rest.slice(0, laEnd + LA_CLOSE.length);
    rest = rest.slice(laEnd + LA_CLOSE.length);
    if (rest.startsWith(TZ_OPEN)) {
      const tzEnd = rest.indexOf(TZ_CLOSE, TZ_OPEN.length);
      if (tzEnd === -1) { throw new Error('tz block has no end'); }
      out.tz = rest.slice(0, tzEnd + TZ_CLOSE.length);
      rest = rest.slice(tzEnd + TZ_CLOSE.length);
    }
  }
  out.tail = rest;
  return out;
}

export function refreshWorkflow(live, spec, src) {
  const next = JSON.parse(JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }));
  const touched = [];
  for (const name of spec.codeNodes) {
    const n = next.nodes.find((x) => x.name === name);
    if (!n || !n.parameters || typeof n.parameters.jsCode !== 'string') { throw new Error(spec.label + ': Code node missing: ' + name); }
    const parts = splitNode(n.parameters.jsCode);
    if (!parts.actions.includes("nurture: '" + OLD_LABEL + "'") && !parts.actions.includes("nurture: '" + NEW_LABEL + "'")) { throw new Error(spec.label + '/' + name + ': the actions block carries no nurture label'); }
    const la = parts.la ? src.laBlock : '';
    const tz = parts.tz ? src.tzBlock : '';
    const rebuilt = src.actionsBlock + parts.gap + la + tz + parts.tail;
    if (rebuilt !== lf(n.parameters.jsCode)) { n.parameters.jsCode = rebuilt; touched.push(name); }
  }
  for (const name of spec.keyboardNodes) {
    const n = next.nodes.find((x) => x.name === name);
    if (!n || !n.parameters || !n.parameters.inlineKeyboard) { throw new Error(spec.label + ': keyboard node missing: ' + name); }
    let hits = 0;
    for (const r of n.parameters.inlineKeyboard.rows || []) {
      for (const b of (r.row || {}).buttons || []) { if (b.text === OLD_LABEL) { b.text = NEW_LABEL; hits++; } }
    }
    if (hits) { touched.push(name); }
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
  const allowed = new Set(spec.codeNodes.concat(spec.keyboardNodes));
  for (const n of next.nodes) {
    const l = L.nodes.find((x) => x.name === n.name);
    if (!l) { f.push('node added: ' + n.name); continue; }
    const same = JSON.stringify(n) === JSON.stringify(l);
    if (!allowed.has(n.name)) { if (!same) { f.push('undeclared node changed: ' + n.name); } continue; }
    if (JSON.stringify(n.credentials || null) !== JSON.stringify(l.credentials || null)) { f.push(n.name + ': credentials changed'); }
    if (n.type !== l.type || n.typeVersion !== l.typeVersion || (n.disabled === true) !== (l.disabled === true)) { f.push(n.name + ': type/version/disabled changed'); }
    if (spec.codeNodes.includes(n.name)) {
      const before = splitNode(l.parameters.jsCode); const after = splitNode(n.parameters.jsCode);
      if (before.tail !== after.tail) { f.push(n.name + ': the node tail is not byte-identical'); }
      if (before.gap !== after.gap) { f.push(n.name + ': the block join changed'); }
      if (after.actions !== src.actionsBlock) { f.push(n.name + ': the actions block is not the current module'); }
      if (!!before.la !== !!after.la || !!before.tz !== !!after.tz) { f.push(n.name + ': block layout changed'); }
      if (after.la && after.la !== src.laBlock) { f.push(n.name + ': presenter block is not the current module'); }
      if (after.tz && after.tz !== src.tzBlock) { f.push(n.name + ': tz block is not the current module'); }
      if (/В Nurture/.test(n.parameters.jsCode)) { f.push(n.name + ': the old label survives'); }
      const other = Object.keys(n.parameters).filter((k) => k !== 'jsCode');
      for (const k of other) { if (JSON.stringify(n.parameters[k]) !== JSON.stringify(l.parameters[k])) { f.push(n.name + ': parameter changed: ' + k); } }
    } else {
      const flat = (kb) => ((kb || {}).rows || []).map((r) => ((r.row || {}).buttons || []).map((b) => [b.text, JSON.stringify(b.additionalFields || {})]));
      const a = flat(l.parameters.inlineKeyboard); const b = flat(n.parameters.inlineKeyboard);
      if (JSON.stringify(a.map((r) => r.map((x) => x[1]))) !== JSON.stringify(b.map((r) => r.map((x) => x[1])))) { f.push(n.name + ': callback_data or button fields changed'); }
      const labelDiff = a.flat().filter((x, i) => x[0] !== b.flat()[i][0]);
      for (const x of labelDiff) { if (x[0] !== OLD_LABEL) { f.push(n.name + ': a label other than the nurture one changed: ' + x[0]); } }
      const others = Object.keys(n.parameters).filter((k) => k !== 'inlineKeyboard');
      for (const k of others) { if (JSON.stringify(n.parameters[k]) !== JSON.stringify(l.parameters[k])) { f.push(n.name + ': parameter changed: ' + k); } }
      if (JSON.stringify(n.parameters.inlineKeyboard).includes(OLD_LABEL)) { f.push(n.name + ': the old label survives'); }
    }
  }
  return f;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('refresh-lead-alert-labels.mjs');
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
    say(''); say('LEAD ALERT LABELS — «' + OLD_LABEL + '» → «' + NEW_LABEL + '», callback_data untouched'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE'); say('');
    const src = sources();
    const plan = [];
    for (const spec of WORKFLOWS) {
      const live = await api('GET', '/workflows/' + spec.id);
      const rb = keepRollback(join(OUT_DIR, spec.id + '.pre-labels.json'), JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }, null, 2) + '\n');
      const { next, touched } = refreshWorkflow(live, spec, src);
      const f = verifyRefresh(live, next, spec, src);
      if (f.length) { die(spec.label + ': ' + f.join(' | ')); }
      say('  ' + spec.label.padEnd(18) + live.nodes.length + ' nodes, active=' + live.active + '  rewritten: ' + (touched.join(', ') || 'nothing (already current)') + (rb.aside ? '  rollback KEPT, fresh read aside' : '  rollback: .uat/' + spec.id + '.pre-labels.json'));
      writeFileSync(join(CAND_DIR, spec.candidate), JSON.stringify(next, null, 2) + '\n', 'utf8');
      plan.push({ spec, live, next, touched });
    }
    ok('four candidates written to n8n/candidate/; every delta is module blocks + one button label');
    if (DRY) { say('\nDRY RUN — nothing written to the tenant.'); }
    else {
      for (const p of plan) {
        if (!p.touched.length) { ok(p.spec.label + ': already current, not written'); continue; }
        await api('PUT', '/workflows/' + p.spec.id, p.next);
        const after = await api('GET', '/workflows/' + p.spec.id);
        const f = verifyRefresh(p.live, after, p.spec, src);
        if (f.length) { bad(p.spec.label + ' post-deploy: ' + f.join(' | ')); } else { ok(p.spec.label + ': written and read back, active=' + after.active); }
      }
      say('\n  rollback: PUT each /api/v1/workflows/<id> with .uat/<id>.pre-labels.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
