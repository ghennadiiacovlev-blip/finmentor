#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — guarded, bounded C2 production cutover.
//
//   node scripts/deploy-c2-final-closure.mjs --dry-run
//   node scripts/deploy-c2-final-closure.mjs --confirm
//
// Five owner-control/release surfaces are fresh-read and compared with the accepted C1
// checkpoint. SLA, Follow-up and Mini App host must be no-ops. Only SYSTEM ALERT and Daily
// Digest are written, read back, and eligible for automatic rollback.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRE = join(ROOT, '.uat', 'c2-final-closure', 'pre');
const CANDIDATES = join(ROOT, '.uat', 'c2-final-closure', 'candidates');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

const TARGETS = [
  ['LZ2mvKXbBikmeVTn', 'SLA Lead Watch', false],
  ['zeLOCuf0K1bkaKl2', 'Followup Sequence', false],
  ['KBD7Q94QQnlzgYKJ', 'Premium Mini App host', false],
  ['ID700kTo6EXffwry', 'SYSTEM ALERT', true],
  ['imeJIDeNyaWDyXzh', 'Daily Lead Digest', true]
];
const SYSTEM_ID = 'ID700kTo6EXffwry';
const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (value) => JSON.stringify(value);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const parse = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const say = (message) => console.log(message);
const pass = (message) => say('  PASS  ' + message);
const fail = (message) => { throw new Error(message); };
const importable = (workflow) => ({
  name: workflow.name, nodes: workflow.nodes, connections: workflow.connections,
  settings: workflow.settings || {}
});
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing node ' + name);
  return found;
};

function normaliseVolatile(workflow) {
  const out = clone(importable(workflow));
  for (const item of out.nodes) {
    if (item.type === 'n8n-nodes-base.telegram') delete item.webhookId;
  }
  return out;
}

function normaliseCheckpoint(id, workflow) {
  const out = normaliseVolatile(workflow);
  if (id !== SYSTEM_ID) return out;
  const settingsNode = node(out, 'Settings to Object');
  settingsNode.parameters.jsCode = String(settingsNode.parameters.jsCode).replace(
    /String\(settings\.owner_chat_id \|\| "(?:[0-9]+|<REDACTED_CHAT_ID>)"\)/g,
    'String(settings.owner_chat_id || "<REDACTED_CHAT_ID>")'
  );
  const count = (settingsNode.parameters.jsCode.match(/<REDACTED_CHAT_ID>/g) || []).length;
  if (count !== 1) fail('SYSTEM ALERT owner fallback redaction is not singular');
  return out;
}

function sameCheckpoint(id, left, right) {
  return json(normaliseCheckpoint(id, left)) === json(normaliseCheckpoint(id, right));
}

function sameReadback(left, right) {
  return json(normaliseVolatile(left)) === json(normaliseVolatile(right));
}

function hydrate(id, candidate, live) {
  const out = clone(candidate);
  if (id !== SYSTEM_ID) return out;
  const at = out.nodes.findIndex((item) => item.name === 'Settings to Object');
  const liveNode = node(live, 'Settings to Object');
  if (at < 0) fail('SYSTEM ALERT settings node cannot be hydrated');
  out.nodes[at] = clone(liveNode);
  return out;
}

function redactArtifact(id, workflow) {
  const out = clone(workflow);
  if (id !== SYSTEM_ID) return out;
  const visit = (value) => {
    if (typeof value === 'string') return value.replace(
      /String\(settings\.owner_chat_id \|\| "[0-9]+"\)/g,
      'String(settings.owner_chat_id || "<REDACTED_CHAT_ID>")'
    );
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) value[key] = visit(value[key]);
    }
    return value;
  };
  return visit(out);
}

function shape(workflow) {
  const credentials = workflow.nodes.filter((item) => item.credentials)
    .map((item) => [item.name, item.credentials]);
  const schedules = workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger')
    .map((item) => [item.name, item.parameters]);
  const webhooks = workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.telegramTrigger'].includes(item.type))
    .map((item) => [item.name, item.parameters]);
  return { credentials, schedules, webhooks };
}

function assertIntegrity(label, before, after) {
  const left = shape(before); const right = shape(after);
  if (json(left.credentials) !== json(right.credentials)) fail(label + ': credential drift');
  if (json(left.schedules) !== json(right.schedules)) fail(label + ': schedule drift');
  if (json(left.webhooks) !== json(right.webhooks)) fail(label + ': webhook drift');
}

function validatePlannedDiff(id, label, before, candidate, mutation) {
  assertIntegrity(label, before, candidate);
  if (!mutation) {
    if (!sameReadback(before, candidate)) fail(label + ': declared no-op differs from accepted C1');
    return;
  }
  const beforeNames = new Set(before.nodes.map((item) => item.name));
  const afterNames = new Set(candidate.nodes.map((item) => item.name));
  if (id === SYSTEM_ID) {
    if (before.nodes.length !== candidate.nodes.length || json(before.connections) !== json(candidate.connections)) {
      fail('SYSTEM ALERT: graph changed');
    }
    const allowed = new Set(['Normalise Alert Event', 'Build System Alert']);
    for (const oldNode of before.nodes) {
      const current = node(candidate, oldNode.name);
      const left = clone(oldNode); const right = clone(current);
      if (allowed.has(oldNode.name)) {
        left.parameters.jsCode = ''; right.parameters.jsCode = '';
      }
      if (json(left) !== json(right)) fail('SYSTEM ALERT: unexpected node delta ' + oldNode.name);
    }
    return;
  }
  const added = ['Detect Data Warning', 'Emit Data Warning', 'Probe CRM Recovery'];
  if (candidate.nodes.length !== before.nodes.length + added.length) fail('Daily Digest: node delta is not +3');
  for (const name of added) if (!afterNames.has(name) || beforeNames.has(name)) fail('Daily Digest: bad added node ' + name);
  for (const oldNode of before.nodes) {
    const current = node(candidate, oldNode.name);
    if (oldNode.name === 'Build Daily Digest') {
      const left = clone(oldNode); const right = clone(current);
      left.parameters.jsCode = ''; right.parameters.jsCode = '';
      if (json(left) !== json(right)) fail('Daily Digest: builder metadata changed');
    } else if (json(oldNode) !== json(current)) fail('Daily Digest: unexpected node delta ' + oldNode.name);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(method, path, body, key, tries = 4) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? json(body) : undefined,
        signal: AbortSignal.timeout(30000)
      });
      const text = await response.text();
      if (!response.ok) fail(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 300));
      return text ? JSON.parse(text) : null;
    } catch (error) {
      last = error;
      if (attempt < tries) await wait(900 * attempt);
    }
  }
  throw last;
}
const getWorkflow = (id) => request('GET', '/workflows/' + id, null, READ_KEY);
const putWorkflow = (id, workflow) => request('PUT', '/workflows/' + id, importable(workflow), WRITE_KEY, 1);
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');

async function rollback(applied, fresh, artifactDir) {
  let clean = true;
  for (const [id, label] of [...applied].reverse()) {
    try {
      await putWorkflow(id, fresh.get(id));
      const restored = await getWorkflow(id);
      if (!sameReadback(fresh.get(id), restored) || restored.active !== fresh.get(id).active) {
        fail(label + ': rollback read-back mismatch');
      }
      writeJson(join(artifactDir, id + '.rollback.json'), redactArtifact(id, restored));
      say('  ROLLBACK PASS  ' + label);
    } catch (error) {
      clean = false;
      say('  ROLLBACK FAIL  ' + label + ': ' + error.message);
    }
  }
  return clean;
}

async function main() {
  if (!DRY && !CONFIRM) fail('use --dry-run or explicitly pass --confirm');
  if (!BASE || !READ_KEY || (!DRY && !WRITE_KEY)) {
    fail('missing ' + [!BASE && 'N8N_BASE_URL', !READ_KEY && 'N8N_API_KEY', !DRY && !WRITE_KEY && 'N8N_FIX_API_KEY'].filter(Boolean).join(', '));
  }
  say('FINMENTOR C2 — guarded final-closure cutover');
  say(DRY ? 'MODE: DRY RUN (read-only)' : 'MODE: LIVE');

  const checkpoint = new Map(); const candidates = new Map();
  for (const [id] of TARGETS) {
    checkpoint.set(id, parse(join(PRE, id + '.json')));
    candidates.set(id, parse(join(CANDIDATES, id + '.candidate.json')));
  }
  for (const [id, label, mutation] of TARGETS) {
    validatePlannedDiff(id, label, checkpoint.get(id), candidates.get(id), mutation);
    pass(label + ': planned diff is ' + (mutation ? 'C2-bounded' : 'NO-OP'));
  }

  say('\nSTEP 1 — fresh production drift check');
  const fresh = new Map();
  for (const [id, label] of TARGETS) {
    const live = await getWorkflow(id); fresh.set(id, live);
    if (!sameCheckpoint(id, checkpoint.get(id), live) || live.active !== checkpoint.get(id).active) {
      fail(label + ': unexpected production drift from accepted C1; no workflow written');
    }
    pass(label + ': live == accepted C1, active ' + live.active + ', sha ' + sha(normaliseCheckpoint(id, live)).slice(0, 16));
  }

  const deployable = new Map();
  for (const [id, label, mutation] of TARGETS) {
    const value = hydrate(id, candidates.get(id), fresh.get(id));
    validatePlannedDiff(id, label, fresh.get(id), value, mutation);
    deployable.set(id, value);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'c2-final-closure', (DRY ? 'dry-run-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  for (const [id] of TARGETS) writeJson(join(artifactDir, id + '.fresh-pre.json'), redactArtifact(id, importable(fresh.get(id))));
  writeJson(join(artifactDir, 'preflight.json'), {
    mode: DRY ? 'dry-run' : 'live', started_at: new Date().toISOString(),
    workflows: TARGETS.map(([id, label, mutation]) => ({
      id, label, mutation, active: fresh.get(id).active,
      pre_sha256: sha(normaliseCheckpoint(id, fresh.get(id))),
      candidate_sha256: sha(normaliseCheckpoint(id, deployable.get(id)))
    }))
  });
  pass('fresh redacted rollback copies saved under ' + artifactDir);
  if (DRY) {
    say('\nC2 DRY RUN PASS — zero writes; exactly two workflows are eligible for deployment.');
    return;
  }

  say('\nSTEP 2 — deploy SYSTEM ALERT, then Daily Digest');
  const applied = [];
  const writes = TARGETS.filter((row) => row[2]);
  try {
    for (const [id, label] of writes) {
      let putError;
      try { await putWorkflow(id, deployable.get(id)); } catch (error) { putError = error; }
      const after = await getWorkflow(id);
      const changed = !sameReadback(fresh.get(id), after);
      if (changed) applied.push([id, label]);
      if (!sameReadback(deployable.get(id), after)) {
        fail(label + ': candidate/read-back mismatch' + (putError ? ' after ' + putError.message : ''));
      }
      if (after.active !== fresh.get(id).active) fail(label + ': active state changed');
      assertIntegrity(label, fresh.get(id), after);
      writeJson(join(artifactDir, id + '.post.json'), redactArtifact(id, after));
      pass(label + ': deployed/read back, active ' + after.active + ', sha ' + sha(normaliseVolatile(after)).slice(0, 16));
    }
  } catch (error) {
    say('\nC2 CUTOVER FAILED — ' + error.message);
    const restored = await rollback(applied, fresh, artifactDir);
    fail(restored ? 'all applied workflows were restored' : 'rollback incomplete; inspect ' + artifactDir);
  }

  say('\nSTEP 3 — all five surfaces final read-back');
  for (const [id, label, mutation] of TARGETS) {
    const after = await getWorkflow(id);
    const expected = mutation ? deployable.get(id) : fresh.get(id);
    if (!sameReadback(expected, after)) {
      const restored = await rollback(applied, fresh, artifactDir);
      fail(label + ': final read-back drift; rollback ' + (restored ? 'completed' : 'INCOMPLETE'));
    }
    if (after.active !== fresh.get(id).active) fail(label + ': final active state drift');
    assertIntegrity(label, fresh.get(id), after);
    pass(label + ': final read-back verified');
  }
  writeJson(join(artifactDir, 'result.json'), {
    status: 'DEPLOYED', completed_at: new Date().toISOString(), writes: writes.map(([id, label]) => ({ id, label }))
  });
  say('\nC2 CUTOVER PASS — 2 workflows deployed; 3 authority surfaces proven no-op.');
  say('Artifacts: ' + artifactDir);
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
