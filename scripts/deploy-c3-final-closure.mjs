#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — guarded, bounded C3 production cutover.
//
//   node scripts/deploy-c3-final-closure.mjs --dry-run
//   node scripts/deploy-c3-final-closure.mjs --confirm

// Dry-run performs fresh GETs, accepted-baseline drift checks, exact C3 patch validation, and
// saves redacted rollback evidence. Confirm writes Command Center, X-Ray, then Lead Intake last;
// every PUT is immediately read back and all applied writes are rolled back on any mismatch.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDS, importable, patchCommandCenter, patchLeadIntake, patchXray, readC3Sources, workflowShape
} from './lib/c3-final-closure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const ACCEPTED = '1078d96c8941ca9edb51706f00d45eaaf13c9d7b';
const TARGETS = [
  { id: IDS.command, label: 'Owner Command Center', hash: '085b2348dd22a8dbcbd2111929b059ab829bb545fd9a8bb06e3a33109b102171', patch: patchCommandCenter },
  { id: IDS.xray, label: 'X-Ray owner intelligence', hash: '799acad0a454dd8104ee8df02920a92f2eb6aa4a414670d96a41386ce99c535f', patch: patchXray },
  { id: IDS.intake, label: 'Lead Intake', hash: '2cfc5c09e8e9e8d63557fdc6e42ec73cfed1270b158bf3451ec41eb69141e970', patch: patchLeadIntake }
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (value) => JSON.stringify(value);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const pass = (message) => console.log('  PASS  ' + message);
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing ' + name);
  return found;
};

function gitRef(name) {
  const git = join(ROOT, '.git');
  const direct = join(git, ...name.split('/'));
  if (existsSync(direct)) return readFileSync(direct, 'utf8').trim();
  const packed = existsSync(join(git, 'packed-refs')) ? readFileSync(join(git, 'packed-refs'), 'utf8') : '';
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

function redact(workflow) {
  const visit = (value) => {
    if (typeof value === 'string') return value
      .replace(/(owner_chat_id\s*\|\|\s*["'])\d+(["'])/g, '$1<REDACTED_CHAT_ID>$2')
      .replace(/(allowed_chat_ids\s*\|\|\s*["'])\d+(["'])/g, '$1<REDACTED_CHAT_ID>$2');
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = visit(item);
      return out;
    }
    return value;
  };
  return visit(importable(workflow));
}

function changedNodes(before, after) {
  const old = new Map(before.nodes.map((item) => [item.name, item]));
  const added = after.nodes.filter((item) => !old.has(item.name)).map((item) => item.name);
  const changed = after.nodes.filter((item) => old.has(item.name) && json(item) !== json(old.get(item.name))).map((item) => item.name);
  const removed = before.nodes.filter((item) => !after.nodes.some((next) => next.name === item.name)).map((item) => item.name);
  return { added, changed, removed };
}

function assertC3Diff(target, before, after) {
  if (json(workflowShape(before)) !== json(workflowShape(after))) fail(target.label + ': credential/schedule/webhook drift');
  if (json(before.settings || {}) !== json(after.settings || {})) fail(target.label + ': workflow settings drift');
  const delta = changedNodes(before, after);
  if (delta.removed.length) fail(target.label + ': nodes removed: ' + delta.removed.join(', '));
  const expected = target.id === IDS.intake ? {
    added: ['Build C3 Intelligence Request', 'Run Owner Intelligence (C3)'],
    changed: ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate']
  } : target.id === IDS.command ? {
    added: ['Validate Basic Callback Envelope', 'IF Basic Callback Envelope', 'Restore Command Envelope'],
    changed: ['Answer Callback Query']
  } : {
    added: ['C3 Lead Intelligence Trigger', 'Validate C3 Lead Target'],
    changed: ['Select Pending Leads', 'Build Analysis Input', 'Validate + Store Rows']
  };
  for (const key of ['added', 'changed']) {
    if (json([...delta[key]].sort()) !== json([...expected[key]].sort())) {
      fail(target.label + ': unexpected ' + key + ' node delta: ' + delta[key].join(', '));
    }
  }
  if (target.id === IDS.intake) {
    const caller = node(after, 'Run Owner Intelligence (C3)');
    if (caller.parameters.workflowId.value !== IDS.xray || caller.parameters.options.waitForSubWorkflow !== true) fail('Lead Intake: C3 caller contract drift');
  }
  if (target.id === IDS.command) {
    if (node(after, 'Answer Callback Query').parameters.additionalFields.text !== 'Принято') fail('Command Center: callback ACK is not neutral');
  }
  if (target.id === IDS.xray) {
    if (node(after, 'Every 10 Minutes').parameters.rule.interval[0].expression !== '0,30 8-19 * * 1-5') fail('X-Ray: schedule drift');
  }
  return delta;
}

async function api(method, path, body, key = method === 'GET' ? READ_KEY : WRITE_KEY, tries = 4) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(BASE + '/api/v1' + path, {
        method, headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? json(body) : undefined, signal: AbortSignal.timeout(30000)
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
  if (!BASE || !READ_KEY || (!DRY && !WRITE_KEY)) fail('missing n8n API environment');
  const head = gitHead();
  const origin = gitRef('refs/remotes/origin/main');
  if (head !== ACCEPTED || origin !== ACCEPTED) fail('accepted baseline drift: HEAD=' + head + ', origin/main=' + origin);
  pass('HEAD and origin/main are accepted C2 ' + ACCEPTED.slice(0, 7));

  console.log('\nFINMENTOR C3 — ' + (DRY ? 'DRY RUN' : 'CONTROLLED LIVE CUTOVER'));
  const sources = readC3Sources(ROOT);
  const fresh = new Map(); const candidates = new Map();
  for (const target of TARGETS) {
    const live = await api('GET', '/workflows/' + target.id);
    if (!live.active) fail(target.label + ': workflow is inactive');
    const digest = sha(normalise(live));
    if (digest !== target.hash) fail(target.label + ': unrelated production drift ' + digest + ' != ' + target.hash);
    fresh.set(target.id, live);
    const candidate = target.patch(live, sources);
    const delta = assertC3Diff(target, live, candidate);
    candidates.set(target.id, candidate);
    pass(target.label + ': live accepted; C3-only delta added=' + delta.added.length + ', changed=' + delta.changed.length);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'c3-final-closure', (DRY ? 'dry-run-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  for (const target of TARGETS) {
    writeFileSync(join(artifactDir, target.id + '.fresh-pre.json'), JSON.stringify(redact(fresh.get(target.id)), null, 2) + '\n', 'utf8');
    writeFileSync(join(artifactDir, target.id + '.candidate.json'), JSON.stringify(redact(candidates.get(target.id)), null, 2) + '\n', 'utf8');
  }
  writeFileSync(join(artifactDir, 'preflight.json'), JSON.stringify({
    mode: DRY ? 'dry-run' : 'live', accepted_commit: ACCEPTED, started_at: new Date().toISOString(),
    workflows: TARGETS.map((target) => ({ id: target.id, label: target.label, active: fresh.get(target.id).active,
      pre_sha256: sha(normalise(fresh.get(target.id))), candidate_sha256: sha(normalise(candidates.get(target.id))) }))
  }, null, 2) + '\n', 'utf8');
  pass('fresh pre-write backups and candidates saved under ' + artifactDir);
  if (DRY) {
    console.log('\nC3 DRY RUN PASS — zero production writes; exactly three workflows eligible.');
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
      if (json(workflowShape(after)) !== json(workflowShape(fresh.get(target.id)))) fail(target.label + ': authority shape drift after PUT');
      writeFileSync(join(artifactDir, target.id + '.post.json'), JSON.stringify(redact(after), null, 2) + '\n', 'utf8');
      pass(target.label + ': deployed and read back');
    }
  } catch (error) {
    console.error('\nC3 CUTOVER FAILED — ' + error.message);
    const restored = await rollback(applied, fresh, artifactDir);
    fail(restored ? 'all C3 writes were rolled back' : 'rollback incomplete; inspect ' + artifactDir);
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
  console.log('\nC3 CUTOVER PASS — 3 bounded workflow writes, 0 unrelated authority changes.');
  console.log('Artifacts: ' + artifactDir);
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
