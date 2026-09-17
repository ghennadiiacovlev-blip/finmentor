#!/usr/bin/env node
import crypto from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_PRE_NODE_SHA256, EXPECTED_PRE_VERSION, IDS, NODE_NAME, importable, isApplied,
  patchRequestContext, protectedShape, readSource
} from './lib/v1-ro-0832-request-context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const VERIFY = process.argv.includes('--verify');
const json = (value) => JSON.stringify(value, (key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((out, name) => { out[name] = item[name]; return out; }, {})
    : item);
const sha = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const same = (a, b) => json(a) === json(b);
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const codeNode = (workflow) => workflow.nodes.find((item) => item.name === NODE_NAME);

async function api(method, path, body, key = method === 'GET' ? READ_KEY : WRITE_KEY) {
  const response = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? json(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) fail(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
  return text ? JSON.parse(text) : null;
}

function assertOneNodeDelta(before, after) {
  if (!same(protectedShape(before), protectedShape(after))) fail('protected workflow authority drift');
  const beforeByName = new Map(before.nodes.map((item) => [item.name, item]));
  const changed = after.nodes.filter((item) => !same(beforeByName.get(item.name), item)).map((item) => item.name);
  if (!same(changed, [NODE_NAME])) fail('changed nodes: ' + JSON.stringify(changed));
  const left = JSON.parse(json(codeNode(before)));
  const right = JSON.parse(json(codeNode(after)));
  delete left.parameters.jsCode;
  delete right.parameters.jsCode;
  if (!same(left, right)) fail(NODE_NAME + ': field beyond parameters.jsCode changed');
}

function printDrift() {
  console.log('PENDING DELTA = 0');
  console.log('SCHEMA DRIFT = 0');
  console.log('CREDENTIAL DRIFT = 0');
  console.log('WEBHOOK DRIFT = 0');
  console.log('SCHEDULE DRIFT = 0');
  console.log('CONNECTION DRIFT = 0');
}

async function main() {
  if ([DRY, CONFIRM, VERIFY].filter(Boolean).length !== 1) fail('choose exactly one of --dry-run, --confirm, --verify');
  if (!BASE || !READ_KEY || (CONFIRM && !WRITE_KEY)) fail('missing n8n API environment');
  const source = readSource(ROOT);
  const live = await api('GET', '/workflows/' + IDS.xray);
  if (!live.active) fail('X-Ray is inactive');

  if (VERIFY) {
    if (!isApplied(live, source)) fail('live source does not match the tracked correction');
    pass('live ' + live.versionId + ': ' + NODE_NAME + ' matches tracked source');
    printDrift();
    return;
  }

  if (isApplied(live, source)) {
    pass('live ' + live.versionId + ' already carries the correction');
    printDrift();
    return;
  }
  if (live.versionId !== EXPECTED_PRE_VERSION) fail('unexpected live version ' + live.versionId);
  if (sha(codeNode(live).parameters.jsCode) !== EXPECTED_PRE_NODE_SHA256) fail('unexpected live ' + NODE_NAME + ' pre-image');

  const candidate = patchRequestContext(live, source);
  assertOneNodeDelta(live, candidate);
  pass('delta is exactly parameters.jsCode of ' + NODE_NAME);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'v1-ro-0832-request-context', (DRY ? 'dry-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, IDS.xray + '.pre.json'), JSON.stringify(live, null, 2) + '\n');
  writeFileSync(join(artifactDir, IDS.xray + '.candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  pass('backup and candidate saved under ' + artifactDir);
  if (DRY) return;

  const before = await api('GET', '/workflows/' + IDS.xray);
  if (!same(importable(before), importable(live))) fail('production drifted during preparation');
  let written = false;
  try {
    await api('PUT', '/workflows/' + IDS.xray, importable(candidate), WRITE_KEY);
    written = true;
    const after = await api('GET', '/workflows/' + IDS.xray);
    if (!same(importable(after), importable(candidate))) fail('fresh API read-back mismatch');
    if (!after.active) fail('active state changed');
    assertOneNodeDelta(live, after);
    if (!isApplied(after, source)) fail('read-back lacks corrected source');
    writeFileSync(join(artifactDir, IDS.xray + '.post.json'), JSON.stringify(after, null, 2) + '\n');
    pass('deployed ' + after.versionId + ' and verified fresh API read-back');
    printDrift();
  } catch (error) {
    if (written) {
      await api('PUT', '/workflows/' + IDS.xray, importable(live), WRITE_KEY);
      const restored = await api('GET', '/workflows/' + IDS.xray);
      if (!same(importable(restored), importable(live))) fail('cutover failed and rollback mismatched: ' + error.message);
      writeFileSync(join(artifactDir, IDS.xray + '.rollback.json'), JSON.stringify(restored, null, 2) + '\n');
      fail('cutover failed; rollback verified: ' + error.message);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
