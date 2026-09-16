#!/usr/bin/env node
// FINMENTOR V1 — guarded X-Ray retry-contract correction (one workflow, three Code nodes).
//
//   node scripts/deploy-v1-xray-retry-contract.mjs --dry-run    # zero writes; artifacts + delta proof
//   node scripts/deploy-v1-xray-retry-contract.mjs --confirm    # controlled cutover + read-back
//   node scripts/deploy-v1-xray-retry-contract.mjs --verify     # read-only: live nodes == tracked sources
//
// Contract and defect: scripts/lib/v1-xray-retry-contract.mjs, docs/V1_FINAL_PRODUCTION_REPAIR_2026-09-16.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDS, PATCHED_NODES, importable, isApplied, patchXrayRetryContract, protectedShape, readRetrySources
} from './lib/v1-xray-retry-contract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const VERIFY = process.argv.includes('--verify');
// Accepted production shape: read-back of the 2026-09-16 10:22Z RO UAT correction cutover.
const ACCEPTED_PRE = join(ROOT, '.uat', 'v1-ro-uat-p0p1', 'deploy-2026-09-16T10-22-11-716Z', IDS.xray + '.post.json');
const ACCEPTED_VERSION = '8d1bdc66-60e1-48ac-a2fc-636a564cd0eb';

// Canonical (key-order-insensitive) JSON — n8n re-orders node keys after a PUT.
const json = (value) => JSON.stringify(value, (key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((acc, name) => { acc[name] = item[name]; return acc; }, {})
    : item);
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => json(a) === json(b);
const byName = (workflow) => new Map(workflow.nodes.map((item) => [item.name, item]));

function assertBoundedDelta(before, after) {
  const a = byName(before); const b = byName(after);
  const added = [...b.keys()].filter((name) => !a.has(name));
  const removed = [...a.keys()].filter((name) => !b.has(name));
  const changed = [...a.keys()].filter((name) => b.has(name) && json(a.get(name)) !== json(b.get(name))).sort();
  if (added.length || removed.length) fail('node set changed: +' + added.join(',') + ' -' + removed.join(','));
  if (!same(changed, PATCHED_NODES.slice().sort())) fail('changed nodes: [' + changed.join(', ') + '], expected [' + PATCHED_NODES.join(', ') + ']');
  if (!same(before.connections, after.connections)) fail('connections changed');
  if (!same(protectedShape(before), protectedShape(after))) fail('credential/schedule/trigger/model/sheets/settings authority drift');
  for (const name of PATCHED_NODES) {
    const x = JSON.parse(json(a.get(name))); const y = JSON.parse(json(b.get(name)));
    delete x.parameters.jsCode; delete y.parameters.jsCode;
    if (!same(x, y)) fail(name + ': a field beyond parameters.jsCode changed');
  }
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
      if (!response.ok) fail(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
      return text ? JSON.parse(text) : null;
    } catch (error) {
      last = error;
      if (attempt < tries) await sleep(attempt * 900);
    }
  }
  throw last;
}

async function main() {
  if ([DRY, CONFIRM, VERIFY].filter(Boolean).length !== 1) fail('choose exactly one of --dry-run, --confirm, --verify');
  if (!BASE || !READ_KEY || (CONFIRM && !WRITE_KEY)) fail('missing n8n API environment');
  console.log('\nFINMENTOR V1 X-RAY RETRY CONTRACT — ' + (DRY ? 'DRY RUN' : CONFIRM ? 'CONTROLLED CUTOVER' : 'LIVE VERIFY'));

  const sources = readRetrySources(ROOT);
  const live = await api('GET', '/workflows/' + IDS.xray);
  if (!live.active) fail('X-Ray is inactive');

  if (VERIFY) {
    if (!isApplied(live, sources)) fail('live X-Ray nodes do not match the tracked corrected sources');
    pass('live ' + live.versionId + ': ' + PATCHED_NODES.join(', ') + ' == tracked sources');
    console.log('\nLIVE VERIFY PASS — X-Ray retry contract is live.');
    return;
  }

  if (isApplied(live, sources)) {
    pass('live ' + live.versionId + ' already carries the tracked corrected sources');
    if (CONFIRM) fail('the correction is already live; nothing to deploy');
    console.log('\nPOST-DEPLOY PENDING DELTA = 0 — zero production writes.');
    return;
  }

  if (!existsSync(ACCEPTED_PRE)) fail('accepted production snapshot missing: ' + ACCEPTED_PRE);
  const accepted = JSON.parse(readFileSync(ACCEPTED_PRE, 'utf8'));
  if (accepted.versionId !== ACCEPTED_VERSION) fail('accepted snapshot is not version ' + ACCEPTED_VERSION);
  if (!same(importable(live), importable(accepted)))
    fail('production drift after the accepted forensic read (live ' + live.versionId + ')');
  pass('X-Ray live ' + live.versionId.slice(0, 8) + ' is content-identical to accepted baseline ' + ACCEPTED_VERSION.slice(0, 8));

  const candidate = patchXrayRetryContract(live, sources);
  assertBoundedDelta(live, candidate);
  pass('delta is exactly parameters.jsCode of ' + PATCHED_NODES.join(', ') + '; graph, credentials, schedule, model and sheets unchanged');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'v1-xray-retry-contract', (DRY ? 'dry-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, IDS.xray + '.pre.json'), JSON.stringify(live, null, 2) + '\n', 'utf8');
  writeFileSync(join(artifactDir, IDS.xray + '.candidate.json'), JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  pass('rollback and candidate artifacts saved under ' + artifactDir);
  if (DRY) {
    console.log('\nX-RAY RETRY CONTRACT DRY RUN PASS — zero production writes.');
    return;
  }

  const before = await api('GET', '/workflows/' + IDS.xray);
  if (!same(importable(before), importable(live))) fail('production drifted during candidate preparation');
  let written = false;
  try {
    await api('PUT', '/workflows/' + IDS.xray, importable(candidate), WRITE_KEY, 1);
    written = true;
    const after = await api('GET', '/workflows/' + IDS.xray);
    if (!same(importable(after), importable(candidate))) fail('immediate read-back mismatch');
    if (after.active !== live.active) fail('active state changed');
    assertBoundedDelta(live, after);
    if (!isApplied(after, sources)) fail('read-back does not carry the tracked sources');
    writeFileSync(join(artifactDir, IDS.xray + '.post.json'), JSON.stringify(after, null, 2) + '\n', 'utf8');
    pass('deployed ' + after.versionId + ' and read back canonically equal to the candidate');
  } catch (error) {
    if (written) {
      await api('PUT', '/workflows/' + IDS.xray, importable(live), WRITE_KEY, 1);
      const restored = await api('GET', '/workflows/' + IDS.xray);
      if (!same(importable(restored), importable(live))) fail('cutover failed AND rollback read-back mismatched: ' + error.message);
      writeFileSync(join(artifactDir, IDS.xray + '.rollback.json'), JSON.stringify(restored, null, 2) + '\n', 'utf8');
      fail('cutover failed; rollback verified: ' + error.message);
    }
    fail('cutover failed before any write: ' + error.message);
  }
  console.log('\nX-RAY RETRY CONTRACT CUTOVER PASS — one bounded write.');
  console.log('Artifacts: ' + artifactDir);
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
