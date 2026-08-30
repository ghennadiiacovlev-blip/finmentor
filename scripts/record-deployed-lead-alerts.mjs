#!/usr/bin/env node
// FINMENTOR — record what is CURRENTLY deployed on the five alert workflows.
//
//   node scripts/record-deployed-lead-alerts.mjs
//
// READ-ONLY against n8n. Writes n8n/history/<id>.deployed-lead-alerts.json.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// scripts/deploy-lead-alerts-presentation.mjs refuses to write a workflow that is not in a state it
// created — either the pre-deploy snapshot, or the record of its own last write. The first
// deployment of this pass predated that record, so a copy correction had nothing to compare
// against and the guard, correctly, refused.
//
// This closes that gap ONCE, and it does not rubber-stamp. It re-derives the same guarantee the
// deploy script checks: the live workflow may differ from its snapshot ONLY in the nodes this pass
// declares, and the graph, settings, triggers and credentials must be untouched. If someone else
// edited one of these workflows, this refuses to record it as ours — which is exactly the case the
// guard existed to catch, so bypassing it here would defeat the whole arrangement.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const TARGETS = [
  ['imeJIDeNyaWDyXzh', 'Daily Lead Digest', ['Build Daily Digest', 'Telegram Daily Digest']],
  ['LZ2mvKXbBikmeVTn', 'SLA Lead Watch', ['SLA Select', 'Telegram SLA Alert']],
  ['zeLOCuf0K1bkaKl2', 'Followup Sequence', ['Build Followup Plan', 'Telegram Followup Reminder']],
  ['RBiFLhVjizMkAzrK', 'Error Monitor', ['Build Error Alert', 'Telegram Error Alert']],
  ['QmIyEW2ZEqKregmN', 'Lead Intake', ['Build Premium Telegram Brief', 'Build Warm Telegram Alert',
    'Build Incomplete Telegram Alert', 'Telegram Lead Alert', 'Telegram Warm Alert', 'Telegram Incomplete Alert']]
];

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });
const body = (wf) => JSON.stringify(importable(wf), null, 2) + '\n';
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }

console.log('');
console.log('Lead Alerts — record the deployed state');
console.log('='.repeat(78));

for (const [id, label, declared] of TARGETS) {
  const snapPath = join(ROOT, 'n8n', 'history', id + '.pre-lead-alerts-presentation.json');
  if (!existsSync(snapPath)) { die(label + ': no snapshot to compare against'); }
  const snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));

  const res = await fetch(BASE + '/api/v1/workflows/' + id, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!res.ok) { die(label + ': GET -> ' + res.status); }
  const live = await res.json();

  // The same guarantee the deploy script enforces, re-derived here rather than assumed.
  if (live.nodes.length !== snapshot.nodes.length) { die(label + ': node count differs from the snapshot'); }
  if (JSON.stringify(live.connections) !== JSON.stringify(snapshot.connections)) { die(label + ': the graph moved'); }
  if (JSON.stringify(live.settings || {}) !== JSON.stringify(snapshot.settings || {})) { die(label + ': settings changed'); }
  const changed = [];
  for (const n of live.nodes) {
    const was = snapshot.nodes.find((x) => x.name === n.name);
    if (!was) { die(label + ': a node was added — ' + n.name); }
    if (JSON.stringify(n) !== JSON.stringify(was)) { changed.push(n.name); }
  }
  for (const c of changed) {
    if (declared.indexOf(c) === -1) {
      die(label + ': ' + c + ' differs from the snapshot but is NOT one this pass declares. Someone ' +
          'else edited this workflow — do not record it as ours.');
    }
  }

  const out = join(ROOT, 'n8n', 'history', id + '.deployed-lead-alerts.json');
  writeFileSync(out, body(live), 'utf8');
  console.log('  ' + label.padEnd(20) + ' sha ' + sha(body(live)).slice(0, 16) +
    '   changed vs snapshot: ' + (changed.length ? changed.join(', ') : 'none'));
}

console.log('');
console.log('  Recorded. The pre-deploy snapshots are untouched and remain the rollback.');
console.log('');
