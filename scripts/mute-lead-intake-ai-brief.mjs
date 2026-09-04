#!/usr/bin/env node
// FINMENTOR — A5 (OWNER DECISION 2026-09-04): one X-Ray analysis = ONE authoritative owner card.
// The Lead Intake workflow still sends a second, overlapping plain-text «FINMENTOR AI BRIEF» for
// every HOT lead (node "Telegram AI Work Plan"). This script DISABLES that ONE Telegram node and
// nothing else: the AI lane keeps running and keeps writing AI_Plans; only the duplicate message
// stops. Reversible: the node is disabled, not removed, and the pre-image is kept.
//
//   node scripts/mute-lead-intake-ai-brief.mjs --dry-run     read, prove the delta, write nothing
//   node scripts/mute-lead-intake-ai-brief.mjs --confirm     PUT, fresh-read, verify
//
// REFUSES: any change to routing, triggers, credentials, callback keyboards, the AI lane, or any
// other node — the candidate is the live workflow with exactly one `disabled: true` added.
// SECRETS: N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keepRollback } from './lib/rollback-artifact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
export const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
export const LEAD_INTAKE_NAME = 'FINMENTOR Lead Intake PREMIUM FINAL';
export const MUTED_NODE = 'Telegram AI Work Plan';
export const FEEDER_NODE = 'Build Short AI Telegram';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); }
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

async function api(m, p, b) {
  const res = await fetch(BASE + '/api/v1' + p, { method: m,
    headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
    body: b ? JSON.stringify(b) : undefined });
  const t = await res.text();
  if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
  return t ? JSON.parse(t) : null;
}

// Pure: the candidate is live + one flag. Exported for the gate.
export function muteCandidate(live) {
  const out = JSON.parse(JSON.stringify(importable(live)));
  const n = out.nodes.find((x) => x.name === MUTED_NODE);
  if (!n) { throw new Error('node not found: ' + MUTED_NODE); }
  if (n.type !== 'n8n-nodes-base.telegram') { throw new Error(MUTED_NODE + ' is not a Telegram node: ' + n.type); }
  n.disabled = true;
  return out;
}
export function verifyDelta(live, cand) {
  const f = [];
  const L = importable(live);
  if (L.nodes.length !== cand.nodes.length) { f.push('node count changed'); }
  for (const c of cand.nodes) {
    const l = L.nodes.find((x) => x.name === c.name);
    if (!l) { f.push('node added: ' + c.name); continue; }
    const strip = (n) => { const k = JSON.parse(JSON.stringify(n)); delete k.disabled; return JSON.stringify(k); };
    if (strip(l) !== strip(c)) { f.push('node changed beyond the flag: ' + c.name); }
    if ((l.disabled === true) !== (c.disabled === true) && c.name !== MUTED_NODE) { f.push('disabled flag moved on ' + c.name); }
  }
  if (JSON.stringify(L.connections) !== JSON.stringify(cand.connections)) { f.push('connections changed'); }
  if (JSON.stringify(L.settings) !== JSON.stringify(cand.settings)) { f.push('settings changed'); }
  if (L.name !== cand.name) { f.push('renamed'); }
  const m = cand.nodes.find((x) => x.name === MUTED_NODE);
  if (!m || m.disabled !== true) { f.push(MUTED_NODE + ' is not disabled in the candidate'); }
  const feeder = (cand.connections[FEEDER_NODE] || {}).main || [];
  if (!feeder.flat().some((e) => e && e.node === MUTED_NODE)) { f.push(FEEDER_NODE + ' no longer feeds ' + MUTED_NODE + ' (the edge must stay; only the node is muted)'); }
  return f;
}

const isMain = process.argv[1] && process.argv[1].endsWith('mute-lead-intake-ai-brief.mjs');
if (isMain) {
  try {
    if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
    if (!DRY && !CONFIRM) { die('this modifies a live workflow; re-run with --confirm (or --dry-run first)'); }
    mkdirSync(OUT_DIR, { recursive: true });
    say(''); say('A5 — mute the duplicate «FINMENTOR AI BRIEF» (Lead Intake node ' + MUTED_NODE + ')'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE'); say('');
    const live = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
    if (live.name !== LEAD_INTAKE_NAME) { die('live workflow is not Lead Intake: ' + live.name); }
    const rb = keepRollback(join(OUT_DIR, LEAD_INTAKE_ID + '.pre-mute-ai-brief.json'), JSON.stringify(importable(live), null, 2) + '\n');
    if (rb.aside) { ok('rollback artifact KEPT (live differs from it); fresh read saved to ' + rb.aside.replace(ROOT, '.')); }
    else { ok('rollback artifact: .uat/' + LEAD_INTAKE_ID + '.pre-mute-ai-brief.json (' + live.nodes.length + ' nodes, active=' + live.active + ')' + (rb.written ? '' : ' — unchanged')); }
    const node = live.nodes.find((x) => x.name === MUTED_NODE);
    if (!node) { die('node not found: ' + MUTED_NODE); }
    say('  live ' + MUTED_NODE + ': type ' + node.type + ', disabled=' + (node.disabled === true) + ', parse_mode=' + JSON.stringify(((node.parameters || {}).additionalFields || {}).parse_mode));
    if (node.disabled === true) { ok('already muted — nothing to do'); }
    const cand = muteCandidate(live);
    const f = verifyDelta(live, cand);
    if (f.length) { die('delta refused: ' + f.join(' | ')); }
    ok('delta verified: ' + live.nodes.length + ' nodes, ONE flag (disabled: true on ' + MUTED_NODE + '), edges/settings/credentials untouched');
    writeFileSync(join(OUT_DIR, LEAD_INTAKE_ID + '.mute-ai-brief-candidate.json'), JSON.stringify(cand, null, 2) + '\n', 'utf8');
    if (DRY) { say('\nDRY RUN — nothing written. Candidate saved to .uat/' + LEAD_INTAKE_ID + '.mute-ai-brief-candidate.json'); }
    else {
      await api('PUT', '/workflows/' + LEAD_INTAKE_ID, cand);
      ok('Lead Intake updated');
      const after = await api('GET', '/workflows/' + LEAD_INTAKE_ID);
      const post = verifyDelta(live, after);
      if (post.length) { bad('post-deploy verification: ' + post.join(' | ')); } else { ok('fresh read: only ' + MUTED_NODE + ' is disabled; everything else byte-equal'); }
      if (!after.active) { bad('Lead Intake is NOT active'); } else { ok('active'); }
      say('\n  rollback: PUT /api/v1/workflows/' + LEAD_INTAKE_ID + ' with ' + (rb.aside ? rb.aside.replace(ROOT, '.') : '.uat/' + LEAD_INTAKE_ID + '.pre-mute-ai-brief.json'));
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
