#!/usr/bin/env node
// FINMENTOR — snapshot the five live alert workflows.
//
//   node scripts/snapshot-lead-alerts.mjs
//
// READ-ONLY. One GET per workflow. It writes n8n/history/<id>.pre-lead-alerts-presentation.json,
// which is simultaneously the rollback artifact and the base the presentation candidates are built
// from — the same file, deliberately, because a candidate built from anything other than the exact
// bytes it will replace is a candidate that reverts whatever it did not know about.
//
// Re-running it after the candidates are built would move the base out from under them, so the
// builder compares against these files and the gate compares again independently.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'n8n', 'history');

const WORKFLOWS = [
  ['imeJIDeNyaWDyXzh', 'Daily Lead Digest'],
  ['LZ2mvKXbBikmeVTn', 'SLA Lead Watch'],
  ['zeLOCuf0K1bkaKl2', 'Followup Sequence'],
  ['RBiFLhVjizMkAzrK', 'Error Monitor'],
  ['QmIyEW2ZEqKregmN', 'Lead Intake']
];

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) {
  console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY (read key is enough — this only reads)');
  process.exit(1);
}

const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });

mkdirSync(OUT, { recursive: true });

console.log('');
console.log('Lead Alerts — live snapshot (read-only)');
console.log('='.repeat(78));

for (const [id, label] of WORKFLOWS) {
  const res = await fetch(BASE + '/api/v1/workflows/' + id, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!res.ok) { console.error('  FAIL  ' + label + ' -> ' + res.status); process.exitCode = 1; continue; }
  const wf = await res.json();
  const body = JSON.stringify(importable(wf), null, 2) + '\n';
  const file = join(OUT, id + '.pre-lead-alerts-presentation.json');
  writeFileSync(file, body, 'utf8');
  console.log('  ' + label.padEnd(20) + ' nodes ' + String(wf.nodes.length).padStart(3) +
    '   active ' + String(wf.active).padEnd(5) + '   sha256 ' + sha(body).slice(0, 16));
}

console.log('');
console.log('  These files are BOTH the rollback artifacts and the build base. Do not re-run this');
console.log('  after building candidates without rebuilding them.');
console.log('');
