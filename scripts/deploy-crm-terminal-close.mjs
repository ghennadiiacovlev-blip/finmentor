#!/usr/bin/env node
// FINMENTOR — GATE 2 P1: give the Command Center the ability to CLOSE a lead (Won / Lost).
//
//   node scripts/deploy-crm-terminal-close.mjs --dry-run   read live, prove the delta, write nothing
//   node scripts/deploy-crm-terminal-close.mjs --confirm    PUT the Command Center, fresh-read, verify
//
// ONE WORKFLOW. `qF9tonlHHIxc8MDd`, two Code nodes, and exactly two kinds of delta:
//
//   1. the inlined `actions.js` block at the head of each node is replaced by the current module,
//      which now maps `won` and `lost` to actions and builds their updates;
//   2. in `Find & Build Update` only, the single `LAA.buildUpdate(...)` call gains the options
//      argument so a supplied `close_reason` reaches the update.
//
// Everything after the module block — the live prefix, the handler body, every other node, the
// connections, the settings, the credentials — must be byte-identical, and the script refuses to
// write if it is not.
//
// WHY THE SPLIT IS SAFE. Each node body starts with the module and ends the module at a fixed
// marker line that the module itself carries. The split is on that literal; a body that does not
// match is a refusal, never a guess.
//
// NOT TOUCHED. SLA Lead Watch and Followup Sequence also carry an inlined copy of this module, but
// they only call `keyboard()` and `shape()`, whose behaviour is unchanged and proven unchanged by
// qa/crm-terminal-close.test.mjs. The owner's boundary for this correction is the Command Center,
// so those two keep the copy they have.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keepRollback } from './lib/rollback-artifact.mjs';
import { inlineCrmStageResolver } from './lib/inline-crm-stage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const lf = (s) => s.replace(/\r\n/g, '\n');

export const WF_ID = 'qF9tonlHHIxc8MDd';
export const NODES = ['Find & Build Update', 'Verify Mutation'];
export const END_MARKER = '// =================== END FINMENTOR LEAD ALERT ACTIONS ===================';
export const CALL_OLD = 'LAA.buildUpdate(action, row.lead_id, nowIso)';
export const CALL_NEW = 'LAA.buildUpdate(action, row.lead_id, nowIso, { closeReason: cmd.close_reason })';

export function currentBlock() {
  const block = inlineCrmStageResolver(
    lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')),
    lf(readFileSync(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'), 'utf8'))
  );
  const i = block.indexOf(END_MARKER);
  if (i === -1) { throw new Error('the module no longer carries its END marker'); }
  // Everything up to and including the marker — the module and nothing after it.
  return block.slice(0, i + END_MARKER.length);
}

export function splitNode(code) {
  const c = lf(String(code || ''));
  if (!c.startsWith('// ===================== FINMENTOR LEAD ALERT ACTIONS')) {
    throw new Error('the node does not start with the actions module');
  }
  const i = c.indexOf(END_MARKER);
  if (i === -1) { throw new Error('the node has no actions END marker'); }
  return { block: c.slice(0, i + END_MARKER.length), rest: c.slice(i + END_MARKER.length) };
}

export function rewrite(live, block) {
  const next = JSON.parse(JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }));
  const touched = [];
  for (const name of NODES) {
    const n = next.nodes.find((x) => x.name === name);
    if (!n || typeof (n.parameters || {}).jsCode !== 'string') { throw new Error('Code node missing: ' + name); }
    const p = splitNode(n.parameters.jsCode);
    let rest = p.rest;
    if (name === 'Find & Build Update') {
      const hits = rest.split(CALL_OLD).length - 1;
      if (hits === 0 && rest.indexOf(CALL_NEW) === -1) { throw new Error('the buildUpdate call was not found and is not already current'); }
      if (hits > 1) { throw new Error('more than one buildUpdate call; refusing to guess'); }
      if (hits === 1) { rest = rest.replace(CALL_OLD, CALL_NEW); }
    }
    const rebuilt = block + rest;
    if (rebuilt !== lf(n.parameters.jsCode)) { n.parameters.jsCode = rebuilt; touched.push(name); }
  }
  return { next, touched };
}

// The delta this deploy is ALLOWED to make, re-derived on the output.
export function verify(live, next, block) {
  const f = [];
  const L = { name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} };
  if (next.name !== L.name) { f.push('renamed'); }
  if (next.nodes.length !== L.nodes.length) { f.push('node count changed'); }
  if (JSON.stringify(next.connections) !== JSON.stringify(L.connections)) { f.push('connections changed'); }
  if (JSON.stringify(next.settings) !== JSON.stringify(L.settings)) { f.push('settings changed'); }
  for (const n of next.nodes) {
    const l = L.nodes.find((x) => x.name === n.name);
    if (!l) { f.push('node added: ' + n.name); continue; }
    if (n.type !== l.type || n.typeVersion !== l.typeVersion || (n.disabled === true) !== (l.disabled === true)) { f.push(n.name + ': type/version/disabled changed'); }
    if (JSON.stringify(n.credentials || null) !== JSON.stringify(l.credentials || null)) { f.push(n.name + ': credentials changed'); }
    if (NODES.indexOf(n.name) === -1) {
      if (JSON.stringify(n) !== JSON.stringify(l)) { f.push('undeclared node changed: ' + n.name); }
      continue;
    }
    for (const k of Object.keys(n.parameters).filter((k) => k !== 'jsCode')) {
      if (JSON.stringify(n.parameters[k]) !== JSON.stringify(l.parameters[k])) { f.push(n.name + ': parameter changed: ' + k); }
    }
    const before = splitNode(l.parameters.jsCode);
    const after = splitNode(n.parameters.jsCode);
    if (after.block !== block) { f.push(n.name + ': the module block is not the current module'); }
    if (n.name === 'Find & Build Update') {
      // The ONLY permitted change outside the module block, and it must be exactly this one.
      if (before.rest.replace(CALL_OLD, CALL_NEW) !== after.rest) { f.push(n.name + ': the handler body changed beyond the buildUpdate call'); }
      if (after.rest.indexOf(CALL_NEW) === -1) { f.push(n.name + ': the close_reason argument is missing'); }
      if (after.rest.indexOf(CALL_OLD) !== -1) { f.push(n.name + ': an old buildUpdate call survives'); }
    } else if (before.rest !== after.rest) {
      f.push(n.name + ': the live tail is not byte-identical');
    }
  }
  // the module must actually carry the correction
  for (const need of ["if (c === 'won') { return 'won'; }", "if (c === 'lost') { return 'lost'; }", 'storedTerminalStage', 'COMMAND_ONLY']) {
    if (block.indexOf(need) === -1) { f.push('the module block is missing: ' + need); }
  }
  return f;
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-crm-terminal-close.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const CONFIRM = args.includes('--confirm');
  const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const READ_KEY = process.env.N8N_API_KEY;
  const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
  const say = (m) => console.log(m);
  const ok = (m) => say('  PASS  ' + m);
  const die = (m) => { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); };
  const api = async (m, p, b) => {
    const res = await fetch(BASE + '/api/v1' + p, { method: m, headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}), body: b ? JSON.stringify(b) : undefined });
    const t = await res.text();
    if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
    return t ? JSON.parse(t) : null;
  };
  try {
    if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
    if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm (or --dry-run first)'); }
    mkdirSync(OUT_DIR, { recursive: true });
    say(''); say('GATE 2 — Command Center: the owner can close a lead (Won / Lost)'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN — nothing is written to the tenant' : '  MODE: LIVE'); say('');

    const block = currentBlock();
    const live = await api('GET', '/workflows/' + WF_ID);
    const body = JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }, null, 2) + '\n';
    const rb = keepRollback(join(OUT_DIR, WF_ID + '.pre-terminal-close.json'), body);
    say('  live: "' + live.name + '"  ' + live.nodes.length + ' nodes  active=' + live.active);
    say('  rollback: ' + (rb.written ? '.uat/' + WF_ID + '.pre-terminal-close.json' : rb.aside ? 'KEPT (prior preserved; fresh read aside)' : 'KEPT (unchanged)'));

    const { next, touched } = rewrite(live, block);
    const f = verify(live, next, block);
    if (f.length) { die(f.join(' | ')); }
    say('  rewritten: ' + (touched.join(', ') || 'nothing (already current)'));
    for (const name of NODES) {
      const before = splitNode(live.nodes.find((n) => n.name === name).parameters.jsCode);
      say('     ' + name.padEnd(22) + 'module block ' + before.block.length + ' -> ' + block.length + ' chars'
        + (name === 'Find & Build Update' ? '   + buildUpdate gains { closeReason }' : '   tail byte-identical'));
    }
    ok('the only delta is the module block, plus the single buildUpdate call in Find & Build Update');
    writeFileSync(join(OUT_DIR, WF_ID + '.terminal-close-candidate.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');

    if (DRY) { say('\nDRY RUN — nothing written to the tenant.'); }
    else if (!touched.length) { ok('already current, not written'); }
    else {
      await api('PUT', '/workflows/' + WF_ID, next);
      const after = await api('GET', '/workflows/' + WF_ID);
      const g = verify(live, { name: after.name, nodes: after.nodes, connections: after.connections, settings: after.settings || {} }, block);
      if (g.length) { say('  FAIL  post-deploy: ' + g.join(' | ')); }
      else { ok('written and read back, active=' + after.active); }
      const fb = after.nodes.find((n) => n.name === 'Find & Build Update').parameters.jsCode;
      say('  live now maps won   : ' + (fb.indexOf("if (c === 'won') { return 'won'; }") !== -1));
      say('  live now maps lost  : ' + (fb.indexOf("if (c === 'lost') { return 'lost'; }") !== -1));
      say('  live passes reason  : ' + (fb.indexOf(CALL_NEW) !== -1));
      say('\n  rollback: PUT /api/v1/workflows/' + WF_ID + ' with .uat/' + WF_ID + '.pre-terminal-close.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
