#!/usr/bin/env node
// FINMENTOR V1 launch-blocker fix — guarded six-workflow cutover.
//
//   node scripts/deploy-v1-launch-blocker-fix.mjs --dry-run
//   node scripts/deploy-v1-launch-blocker-fix.mjs --confirm
//
// Dry-run performs fresh API reads, exact production-baseline checks and bounded-delta checks.
// Confirm writes dependency-first, verifies every read-back, and rolls back every applied write
// if any workflow differs from its approved candidate.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE, IDS, authorityViolations, changedNodes, importable, patchCommand, patchConcierge, patchIntake,
  patchSystem, patchTransport, patchXray, protectedShape, readFixSources
} from './lib/v1-launch-blocker-fix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

// Fresh, redacted production snapshot captured before any launch-blocker edit (2026-09-15).
const TARGETS = [
  { key: 'system', id: IDS.system, label: 'System Alert', hash: 'c1901d7dd0923445e1c958911425d9e87653991bf28ac647f14835f9e9f7222f',
    delta: { added: [], changed: ['Normalise Alert Event'] } },
  { key: 'transport', id: IDS.transport, label: 'Telegram Transport', hash: '23ca28e6db14e0c891f6b9b3e6feac3f357eacede4434ca077dac02514e878ae',
    delta: { added: ['Render L4_C_HTML'], changed: ['Validate Transport Payload', 'Route Keyboard Layout'] } },
  { key: 'command', id: IDS.command, label: 'Owner Command Center', hash: '82f070e49fbc4572e6333a716e0b0336e804e4810887bc78e9d986386b6ed266',
    delta: { added: ['Read Pre-Call Analysis', 'Render Pre-Call Brief', 'Telegram Pre-Call Brief'], changed: ['Parse Lead Command v2', 'Route Command Mode'] } },
  { key: 'xray', id: IDS.xray, label: 'X-Ray / Owner Intelligence', hash: '75f4d64117955b35291a7979b9f6d14797e7a6dc207d3da27494690c6b4fb2a3',
    delta: { added: ['Failed Pipeline Row', 'Update Pipeline X-Ray Failure', 'IF Upstream Failure Owner Notice', 'IF Upstream Retry Exhausted',
      'IF Validation Failure Owner Notice', 'IF Validation Retry Exhausted', 'Emit System Alert (X-Ray Retry Exhausted)'],
      changed: ['Select Pending Leads', 'Analysis Failed Row', 'Validate + Store Rows', 'Telegram Owner Alert', 'Validate C3 Lead Target'] } },
  { key: 'intake', id: IDS.intake, label: 'Lead Intake', hash: '0e4f9bd84781f4b8101d30e72df1b8748116ea6d04002f836c232dc631ba2bf2',
    delta: { added: [], changed: ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate', 'Build C3 Intelligence Request'] } },
  { key: 'concierge', id: IDS.concierge, label: 'Client Concierge', hash: '27cbc0e91758de86a9fe25665dade78e48e1e3197f9c3c6fe04439b898e41aa7',
    delta: { added: [], changed: ['Build Transport Request', 'Get Bot Session'] } }
];

const json = (value) => JSON.stringify(value);
const clone = (value) => JSON.parse(json(value));
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gitRef(name) {
  const direct = join(ROOT, '.git', ...name.split('/'));
  if (existsSync(direct)) return readFileSync(direct, 'utf8').trim();
  const packedPath = join(ROOT, '.git', 'packed-refs');
  const packed = existsSync(packedPath) ? readFileSync(packedPath, 'utf8') : '';
  const row = packed.split(/\r?\n/).find((line) => line.endsWith(' ' + name));
  if (!row) fail('git ref unavailable: ' + name);
  return row.split(' ')[0];
}

function gitHead() {
  const value = readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8').trim();
  return value.startsWith('ref: ') ? gitRef(value.slice(5)) : value;
}

function normalise(workflow) {
  const out = clone(importable(workflow));
  for (const item of out.nodes) if (item.type === 'n8n-nodes-base.telegram') delete item.webhookId;
  return out;
}

function redact(value) {
  if (typeof value === 'string') return value
    .replace(/(owner_chat_id\s*\|\|\s*["'])\d+(["'])/g, '$1<REDACTED_CHAT_ID>$2')
    .replace(/(allowed_chat_ids\s*\|\|\s*["'])\d+(["'])/g, '$1<REDACTED_CHAT_ID>$2');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redact(item);
    return out;
  }
  return value;
}

function sameSorted(actual, expected) {
  return json([...actual].sort()) === json([...expected].sort());
}

function assertBoundedDelta(target, before, after) {
  const authority = authorityViolations(before, after);
  if (authority.length) fail(target.label + ': authority drift: ' + authority.join('; '));
  if (json(before.settings || {}) !== json(after.settings || {})) fail(target.label + ': workflow settings drift');
  const delta = changedNodes(before, after);
  if (delta.removed.length) fail(target.label + ': nodes removed: ' + delta.removed.join(', '));
  if (!sameSorted(delta.added, target.delta.added)) fail(target.label + ': unexpected added nodes: ' + delta.added.join(', '));
  if (!sameSorted(delta.changed, target.delta.changed)) fail(target.label + ': unexpected changed nodes: ' + delta.changed.join(', '));
  return delta;
}

function buildCandidates(fresh, sources) {
  return new Map([
    [IDS.system, patchSystem(fresh.get(IDS.system), sources)],
    [IDS.transport, patchTransport(fresh.get(IDS.transport))],
    [IDS.command, patchCommand(fresh.get(IDS.command), fresh.get(IDS.xray), sources)],
    [IDS.xray, patchXray(fresh.get(IDS.xray), fresh.get(IDS.intake), sources)],
    [IDS.intake, patchIntake(fresh.get(IDS.intake), sources)],
    [IDS.concierge, patchConcierge(fresh.get(IDS.concierge))]
  ]);
}

async function api(method, path, body, key = method === 'GET' ? READ_KEY : WRITE_KEY, tries = 4) {
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
      if (attempt < tries) await sleep(attempt * 900);
    }
  }
  throw last;
}

async function rollback(applied, fresh, artifactDir) {
  let clean = true;
  for (const target of [...applied].reverse()) {
    try {
      await api('PUT', '/workflows/' + target.id, importable(fresh.get(target.id)), WRITE_KEY, 1);
      const restored = await api('GET', '/workflows/' + target.id);
      if (json(normalise(restored)) !== json(normalise(fresh.get(target.id))) || restored.active !== fresh.get(target.id).active) {
        fail(target.label + ': rollback read-back mismatch');
      }
      writeFileSync(join(artifactDir, target.id + '.rollback.json'), JSON.stringify(redact(restored), null, 2) + '\n', 'utf8');
      pass(target.label + ': rollback verified');
    } catch (error) {
      clean = false;
      console.error('  ROLLBACK FAIL  ' + target.label + ': ' + error.message);
    }
  }
  return clean;
}

async function main() {
  if (!DRY && !CONFIRM) fail('use --dry-run or explicitly pass --confirm');
  if (DRY === CONFIRM) fail('choose exactly one of --dry-run or --confirm');
  if (!BASE || !READ_KEY || (!DRY && !WRITE_KEY)) fail('missing n8n API environment');
  const head = gitHead(); const origin = gitRef('refs/remotes/origin/main');
  if (head !== BASELINE || origin !== BASELINE) fail('accepted baseline drift: HEAD=' + head + ', origin/main=' + origin);
  pass('HEAD and origin/main are accepted V1 baseline ' + BASELINE.slice(0, 7));

  console.log('\nFINMENTOR V1 LAUNCH BLOCKERS — ' + (DRY ? 'DRY RUN' : 'CONTROLLED LIVE CUTOVER'));
  const sources = readFixSources(ROOT);
  const fresh = new Map();
  for (const target of TARGETS) {
    const live = await api('GET', '/workflows/' + target.id);
    if (!live.active) fail(target.label + ': workflow is inactive');
    const digest = sha(normalise(live));
    if (digest !== target.hash) fail(target.label + ': unrelated production drift ' + digest + ' != ' + target.hash);
    fresh.set(target.id, live);
    pass(target.label + ': fresh live baseline accepted');
  }
  const candidates = buildCandidates(fresh, sources);
  for (const target of TARGETS) {
    const delta = assertBoundedDelta(target, fresh.get(target.id), candidates.get(target.id));
    pass(target.label + ': bounded delta added=' + delta.added.length + ', changed=' + delta.changed.length);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'v1-launch-blocker', (DRY ? 'dry-run-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  for (const target of TARGETS) {
    writeFileSync(join(artifactDir, target.id + '.fresh-pre.json'), JSON.stringify(redact(fresh.get(target.id)), null, 2) + '\n', 'utf8');
    writeFileSync(join(artifactDir, target.id + '.candidate.json'), JSON.stringify(redact(candidates.get(target.id)), null, 2) + '\n', 'utf8');
  }
  writeFileSync(join(artifactDir, 'preflight.json'), JSON.stringify({
    mode: DRY ? 'dry-run' : 'live', accepted_commit: BASELINE, started_at: new Date().toISOString(),
    workflows: TARGETS.map((target) => ({ id: target.id, label: target.label, active: fresh.get(target.id).active,
      pre_sha256: sha(normalise(fresh.get(target.id))), candidate_sha256: sha(normalise(candidates.get(target.id))) }))
  }, null, 2) + '\n', 'utf8');
  pass('fresh backups and candidates saved under ' + artifactDir);
  if (DRY) {
    console.log('\nV1 LAUNCH-BLOCKER DRY RUN PASS — zero production writes; six workflows eligible.');
    return;
  }

  const applied = [];
  try {
    for (const target of TARGETS) {
      await api('PUT', '/workflows/' + target.id, importable(candidates.get(target.id)), WRITE_KEY, 1);
      applied.push(target);
      const after = await api('GET', '/workflows/' + target.id);
      if (json(normalise(after)) !== json(normalise(candidates.get(target.id)))) fail(target.label + ': immediate read-back mismatch');
      if (after.active !== fresh.get(target.id).active) fail(target.label + ': active state changed');
      if (json(protectedShape(after)) !== json(protectedShape(candidates.get(target.id)))) fail(target.label + ': authority shape drift after PUT');
      writeFileSync(join(artifactDir, target.id + '.post.json'), JSON.stringify(redact(after), null, 2) + '\n', 'utf8');
      pass(target.label + ': deployed and read back');
    }
  } catch (error) {
    console.error('\nV1 CUTOVER FAILED — ' + error.message);
    const restored = await rollback(applied, fresh, artifactDir);
    fail(restored ? 'all V1 writes were rolled back' : 'rollback incomplete; inspect ' + artifactDir);
  }

  for (const target of TARGETS) {
    const after = await api('GET', '/workflows/' + target.id);
    if (json(normalise(after)) !== json(normalise(candidates.get(target.id)))) {
      const restored = await rollback(applied, fresh, artifactDir);
      fail(target.label + ': final read-back drift; rollback ' + (restored ? 'complete' : 'INCOMPLETE'));
    }
    pass(target.label + ': final fresh API read-back verified');
  }
  writeFileSync(join(artifactDir, 'result.json'), JSON.stringify({ status: 'DEPLOYED', completed_at: new Date().toISOString(),
    workflows: TARGETS.map(({ id, label }) => ({ id, label })) }, null, 2) + '\n', 'utf8');
  console.log('\nV1 LAUNCH-BLOCKER CUTOVER PASS — six bounded writes, zero unrelated authority changes.');
  console.log('Artifacts: ' + artifactDir);
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
