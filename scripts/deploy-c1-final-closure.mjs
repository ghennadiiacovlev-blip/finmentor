#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — guarded C1 production cutover.
//
//   node scripts/deploy-c1-final-closure.mjs --dry-run
//   node scripts/deploy-c1-final-closure.mjs --confirm
//
// Every candidate is derived from the same-turn production backup under
// .uat/c1-final-closure/pre. Before the first write this script fresh-reads all targets and
// refuses the entire cutover if any byte has drifted. Writes are read back one at a time. Any
// failure restores every workflow already written, in reverse order, from the fresh preflight
// copies. The public Concierge is deliberately last, so none of the new entry actions is exposed
// before its downstream surfaces are ready.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRE = join(ROOT, '.uat', 'c1-final-closure', 'pre');
const CANDIDATES = join(ROOT, '.uat', 'c1-final-closure', 'candidates');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY || '';
const WRITE_KEY = process.env.N8N_FIX_API_KEY || '';
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

const TARGETS = [
  ['nTZHLbv2KFggdhh5', 'Mini App Gateway'],
  ['KBD7Q94QQnlzgYKJ', 'Premium Mini App host'],
  ['QmIyEW2ZEqKregmN', 'Lead Intake'],
  ['tNSMRoKlFB52vjge', 'X-Ray Analysis'],
  ['qF9tonlHHIxc8MDd', 'Lead Command Center'],
  ['imeJIDeNyaWDyXzh', 'Daily Lead Digest'],
  ['LZ2mvKXbBikmeVTn', 'SLA Lead Watch'],
  ['zeLOCuf0K1bkaKl2', 'Followup Sequence'],
  ['ID700kTo6EXffwry', 'SYSTEM ALERT'],
  ['RBiFLhVjizMkAzrK', 'Error Monitor'],
  ['mppzthlkSJFr6Kle', 'Telegram Client Concierge']
];

const say = (value) => console.log(value);
const pass = (value) => say('  PASS  ' + value);
const fail = (value) => { throw new Error(value); };
const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (value) => JSON.stringify(value);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const parse = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const importable = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings || {}
});

function prePath(id) {
  const name = readdirSync(PRE).find((file) => file.startsWith(id + '.') && file.endsWith('.json'));
  if (!name) fail(id + ': same-turn production backup is missing');
  return join(PRE, name);
}

function candidatePath(id) {
  return join(CANDIDATES, id + '.candidate.json');
}

function normaliseVolatile(workflow) {
  const out = clone(importable(workflow));
  for (const node of out.nodes) {
    // n8n may regenerate irrelevant webhookId metadata on Telegram sendMessage nodes during PUT.
    // Trigger/webhook ids remain exact; only this proven non-trigger exception is normalised.
    if (node.type === 'n8n-nodes-base.telegram' && (node.parameters || {}).operation === 'sendMessage') {
      delete node.webhookId;
    }
  }
  return out;
}

function sameExact(a, b) {
  return json(importable(a)) === json(importable(b));
}

function sameReadback(a, b) {
  return json(normaliseVolatile(a)) === json(normaliseVolatile(b));
}

function normaliseCheckpointRedactions(id, workflow) {
  const out = clone(importable(workflow));
  if (id !== 'ID700kTo6EXffwry') return out;
  const node = out.nodes.find((item) => item.name === 'Settings to Object');
  if (!node || !node.parameters || typeof node.parameters.jsCode !== 'string') {
    fail(id + ': Settings to Object is missing');
  }
  const before = node.parameters.jsCode;
  node.parameters.jsCode = before.replace(
    /String\(settings\.owner_chat_id \|\| "(?:[0-9]+|<REDACTED_CHAT_ID>)"\)/g,
    'String(settings.owner_chat_id || "<REDACTED_CHAT_ID>")'
  );
  const matches = node.parameters.jsCode.match(/<REDACTED_CHAT_ID>/g) || [];
  if (matches.length !== 1) fail(id + ': owner fallback redaction shape is not singular');
  return out;
}

function sameCheckpoint(id, checkpoint, live) {
  return json(normaliseCheckpointRedactions(id, checkpoint)) === json(normaliseCheckpointRedactions(id, live));
}

function hydrateRuntimeCandidate(id, candidate, live) {
  const out = clone(candidate);
  if (id !== 'ID700kTo6EXffwry') return out;
  const at = out.nodes.findIndex((node) => node.name === 'Settings to Object');
  const liveNode = live.nodes.find((node) => node.name === 'Settings to Object');
  if (at < 0 || !liveNode) fail(id + ': cannot hydrate the live owner-destination node');
  out.nodes[at] = clone(liveNode);
  return out;
}

function redactedArtifact(id, workflow) {
  const out = clone(workflow);
  if (id !== 'ID700kTo6EXffwry') return out;
  const visit = (value) => {
    if (typeof value === 'string') {
      return value.replace(/String\(settings\.owner_chat_id \|\| "[0-9]+"\)/g,
        'String(settings.owner_chat_id || "<REDACTED_CHAT_ID>")');
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) value[key] = visit(value[key]);
    }
    return value;
  };
  visit(out);
  return out;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getWorkflow(id, tries = 4) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(BASE + '/api/v1/workflows/' + id, {
        headers: { 'X-N8N-API-KEY': READ_KEY }
      });
      const text = await response.text();
      if (!response.ok) throw new Error('GET ' + id + ' -> ' + response.status + ' ' + text.slice(0, 300));
      return JSON.parse(text);
    } catch (error) {
      last = error;
      if (attempt < tries) await wait(900 * attempt);
    }
  }
  throw last;
}

async function putWorkflow(id, workflow) {
  const response = await fetch(BASE + '/api/v1/workflows/' + id, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': WRITE_KEY, 'Content-Type': 'application/json' },
    body: json(importable(workflow))
  });
  const text = await response.text();
  if (!response.ok) throw new Error('PUT ' + id + ' -> ' + response.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function gate() {
  const run = spawnSync(process.execPath, [join(ROOT, 'qa', 'c1-final-closure-live.test.mjs')], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (run.status !== 0) {
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    fail('offline C1 gate is red' + (run.error ? ': ' + run.error.message : ' (exit ' + run.status + ')'));
  }
  pass('offline C1 gate: 35/35');
}

async function rollback(applied, fresh, artifactDir) {
  const results = [];
  for (const [id, label] of [...applied].reverse()) {
    try {
      await putWorkflow(id, fresh.get(id));
      const restored = await getWorkflow(id);
      if (!sameReadback(fresh.get(id), restored)) fail(label + ': rollback read-back mismatch');
      writeJson(join(artifactDir, id + '.rollback-readback.json'), redactedArtifact(id, restored));
      results.push({ id, label, restored: true, active: restored.active });
      say('  ROLLBACK PASS  ' + label);
    } catch (error) {
      results.push({ id, label, restored: false, error: error.message });
      say('  ROLLBACK FAIL  ' + label + ': ' + error.message);
    }
  }
  writeJson(join(artifactDir, 'rollback.json'), results);
  return results.every((row) => row.restored === true);
}

say('');
say('FINMENTOR C1 — guarded final-closure cutover');
say(DRY ? 'MODE: DRY RUN (read-only)' : 'MODE: LIVE');
say('');

if (!DRY && !CONFIRM) fail('use --dry-run or explicitly pass --confirm');
if (!BASE || !READ_KEY || (!DRY && !WRITE_KEY)) {
  fail('missing ' + [!BASE && 'N8N_BASE_URL', !READ_KEY && 'N8N_API_KEY', !DRY && !WRITE_KEY && 'N8N_FIX_API_KEY'].filter(Boolean).join(', '));
}

gate();

const manifest = parse(join(CANDIDATES, 'manifest.json'));
const declaredIds = manifest.workflows.map((row) => row.id).sort();
const targetIds = TARGETS.map((row) => row[0]).sort();
if (json(declaredIds) !== json(targetIds)) fail('candidate manifest does not match the declared cutover set');
pass('candidate manifest covers exactly eleven workflows');

const pre = new Map();
const candidates = new Map();
for (const [id] of TARGETS) {
  pre.set(id, parse(prePath(id)));
  candidates.set(id, parse(candidatePath(id)));
}

say('');
say('STEP 1 — fresh production drift check');
const fresh = new Map();
const drift = [];
for (const [id, label] of TARGETS) {
  const live = await getWorkflow(id);
  fresh.set(id, live);
  if (!sameCheckpoint(id, pre.get(id), live)) drift.push(label + ': workflow bytes');
  if (live.active !== pre.get(id).active) drift.push(label + ': active flag');
  if (!drift.some((item) => item.startsWith(label + ':'))) {
    pass(label + ': live == same-turn checkpoint, sha ' + sha(normaliseCheckpointRedactions(id, live)).slice(0, 16) + ', active ' + live.active);
  }
}
if (drift.length) fail('production drifted since the C1 checkpoint (' + drift.join('; ') + '); no workflow was written');

// Replace only the deliberately redacted, unchanged SYSTEM ALERT settings node with its fresh
// live value. The deployable object is never written to disk.
const deployable = new Map();
for (const [id] of TARGETS) deployable.set(id, hydrateRuntimeCandidate(id, candidates.get(id), fresh.get(id)));

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = join(ROOT, '.uat', 'c1-final-closure', DRY ? 'dry-run-' + stamp : 'deploy-' + stamp);
mkdirSync(artifactDir, { recursive: true });
for (const [id] of TARGETS) writeJson(join(artifactDir, id + '.fresh-pre.json'), redactedArtifact(id, fresh.get(id)));

const audit = {
  mode: DRY ? 'dry-run' : 'live',
  started_at: new Date().toISOString(),
  order: TARGETS.map(([id, label]) => ({ id, label })),
  workflows: TARGETS.map(([id, label]) => ({
    id,
    label,
    active: fresh.get(id).active,
    pre_sha256: sha(importable(fresh.get(id))),
    candidate_sha256: sha(normaliseCheckpointRedactions(id, deployable.get(id)))
  }))
};
writeJson(join(artifactDir, 'preflight.json'), audit);
pass('fresh rollback copies written to ' + artifactDir);

if (DRY) {
  say('');
  say('DRY RUN PASS — production is unchanged and all eleven candidates are safe to write.');
  process.exit(0);
}

say('');
say('STEP 2 — write and read back; public Concierge last');
const applied = [];
try {
  for (const [id, label] of TARGETS) {
    let putError = null;
    try { await putWorkflow(id, deployable.get(id)); } catch (error) { putError = error; }
    // A lost PUT acknowledgement is not retried blindly. The read-back is the authority.
    const after = await getWorkflow(id);
    const isCandidate = sameReadback(deployable.get(id), after);
    const isOriginal = sameReadback(fresh.get(id), after);
    if (!isOriginal || isCandidate) applied.push([id, label]);
    if (!isCandidate) {
      fail(label + ': candidate/read-back mismatch' + (putError ? ' after ' + putError.message : ''));
    }
    if (after.active !== fresh.get(id).active) fail(label + ': active flag changed');
    writeJson(join(artifactDir, id + '.post.json'), redactedArtifact(id, after));
    pass(label + ': deployed, read back, active ' + after.active + ', sha ' + sha(normaliseVolatile(after)).slice(0, 16));
  }
} catch (error) {
  say('');
  say('CUTOVER FAILED — ' + error.message);
  const restored = await rollback(applied, fresh, artifactDir);
  audit.completed_at = new Date().toISOString();
  audit.status = restored ? 'ROLLED_BACK' : 'ROLLBACK_INCOMPLETE';
  audit.error = error.message;
  writeJson(join(artifactDir, 'result.json'), audit);
  fail(restored ? 'all applied workflows were restored' : 'rollback incomplete; inspect ' + artifactDir);
}

say('');
say('STEP 3 — final all-target read-back');
for (const [id, label] of TARGETS) {
  const after = await getWorkflow(id);
  if (!sameReadback(deployable.get(id), after)) {
    const restored = await rollback(applied, fresh, artifactDir);
    fail(label + ': final read-back drift; rollback ' + (restored ? 'completed' : 'INCOMPLETE'));
  }
  if (after.active !== fresh.get(id).active) fail(label + ': final active flag drift');
  pass(label + ': final read-back verified');
}

audit.completed_at = new Date().toISOString();
audit.status = 'DEPLOYED';
writeJson(join(artifactDir, 'result.json'), audit);
say('');
say('C1 CUTOVER PASS — eleven workflows deployed and read back; no active flag changed.');
say('Artifacts: ' + artifactDir);
