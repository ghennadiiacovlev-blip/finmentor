#!/usr/bin/env node
// FINMENTOR V1 — guarded Lead Intake return-contract correction (one workflow, four nodes).
//
//   node scripts/deploy-v1-submit-return-contract.mjs --dry-run    # zero writes; artifacts + proof
//   node scripts/deploy-v1-submit-return-contract.mjs --confirm    # controlled cutover + read-back
//   node scripts/deploy-v1-submit-return-contract.mjs --verify     # read-only: live shape satisfies the contract
//
// Root cause, invariant and proof: scripts/lib/v1-submit-return-contract.mjs and
// docs/V1_SUBMIT_RETURN_CONTRACT_INCIDENT_2026-09-16.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDS, assertReturnContract, importable, internalScenarios, lastExecuted, patchIntakeReturnContract, protectedShape
} from './lib/v1-submit-return-contract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const VERIFY = process.argv.includes('--verify');
// The accepted production shape this correction was proven against: the read-back of the
// 2026-09-16 10:22Z RO UAT correction cutover (versionId 82f2e933-…). Untracked (.uat/) by policy.
const ACCEPTED_PRE = join(ROOT, '.uat', 'v1-ro-uat-p0p1', 'deploy-2026-09-16T10-22-11-716Z', IDS.intake + '.post.json');
const ACCEPTED_VERSION = '82f2e933-ce30-4d20-82ba-ab9a6c232a88';
const CHANGED_NODES = ['Build C3 Intelligence Request', 'Route C3 Result Mode', 'Run Owner Intelligence (C3)', 'Save Lead to CRM'];

// n8n re-serialises node objects with a different KEY ORDER after a PUT (observed 2026-09-16
// 13:13Z: identical length, canonically identical, 91/112 nodes byte-different). Every comparison
// here is therefore canonical — recursively sorted keys — never byte-exact.
const json = (value) => JSON.stringify(value, (key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((acc, name) => { acc[name] = item[name]; return acc; }, {})
    : item);
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => json(a) === json(b);
const byName = (workflow) => new Map(workflow.nodes.map((item) => [item.name, item]));

function changedNodes(before, after) {
  const a = byName(before); const b = byName(after);
  return {
    added: [...b.keys()].filter((name) => !a.has(name)).sort(),
    removed: [...a.keys()].filter((name) => !b.has(name)).sort(),
    changed: [...a.keys()].filter((name) => b.has(name) && json(a.get(name)) !== json(b.get(name))).sort()
  };
}
function assertExactSet(actual, expected, label) {
  const a = [...actual].sort(); const e = [...expected].sort();
  if (!same(a, e)) fail(label + ': got [' + a.join(', ') + '], expected [' + e.join(', ') + ']');
}
function assertBoundedDelta(before, after) {
  const delta = changedNodes(before, after);
  assertExactSet(delta.added, [], 'added nodes');
  assertExactSet(delta.removed, [], 'removed nodes');
  assertExactSet(delta.changed, CHANGED_NODES, 'changed nodes');
  if (!same(before.connections, after.connections)) fail('connections changed');
  if (!same(protectedShape(before), protectedShape(after))) fail('credential/schedule/trigger/settings authority drift');
  const a = byName(before); const b = byName(after);
  for (const name of CHANGED_NODES) {
    const x = JSON.parse(json(a.get(name))); const y = JSON.parse(json(b.get(name)));
    delete x.position; delete y.position;
    if (name === 'Run Owner Intelligence (C3)') {
      delete x.onError; delete y.onError;
      delete x.parameters.options.waitForSubWorkflow; delete y.parameters.options.waitForSubWorkflow;
    }
    if (!same(x, y)) fail(name + ': a field beyond position/onError/waitForSubWorkflow changed');
    if (name !== 'Run Owner Intelligence (C3)' && json(a.get(name).parameters) !== json(b.get(name).parameters)) fail(name + ': parameters changed');
  }
}
function printProof(workflow, label) {
  const report = assertReturnContract(workflow);
  pass(label + ': terminal chain at y ' + report.chainY + ', bottom-most sibling at y ' + report.maxSiblingY);
  for (const row of report.orders) pass(label + ': v1 order "' + row.label + '" -> ' + row.last + ' (' + row.executed + ' nodes)');
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
  console.log('\nFINMENTOR V1 SUBMIT RETURN CONTRACT — ' + (DRY ? 'DRY RUN' : CONFIRM ? 'CONTROLLED CUTOVER' : 'LIVE VERIFY'));

  const live = await api('GET', '/workflows/' + IDS.intake);
  if (!live.active) fail('Lead Intake is inactive');
  if (VERIFY) {
    printProof(live, 'live ' + live.versionId);
    for (const scenario of internalScenarios()) {
      const { order } = lastExecuted(live, scenario);
      console.log('        ' + scenario.label + ': … ' + order.slice(-4).join(' > '));
    }
    console.log('\nLIVE VERIFY PASS — the committed answer is the last node in every internal scenario.');
    return;
  }

  if (!existsSync(ACCEPTED_PRE)) fail('accepted production snapshot missing: ' + ACCEPTED_PRE);
  const accepted = JSON.parse(readFileSync(ACCEPTED_PRE, 'utf8'));
  if (accepted.versionId !== ACCEPTED_VERSION) fail('accepted snapshot is not version ' + ACCEPTED_VERSION);

  // Already corrected? Then the only honest dry-run answer is "pending delta = 0".
  let alreadyCorrected = false;
  try { assertReturnContract(live); alreadyCorrected = true; } catch (error) { alreadyCorrected = false; }
  if (alreadyCorrected) {
    printProof(live, 'live ' + live.versionId);
    if (CONFIRM) fail('the correction is already live; nothing to deploy');
    console.log('\nPOST-DEPLOY PENDING DELTA = 0 — live already satisfies the return contract; zero production writes.');
    return;
  }

  // Content-identical to the accepted forensic baseline (the versionId may differ: a rolled-back
  // write re-stamps the version without changing content).
  if (!same(importable(live), importable(accepted)))
    fail('production drift after the accepted forensic read (live ' + live.versionId + ')');
  pass('Lead Intake live ' + live.versionId.slice(0, 8) + ' is content-identical to accepted forensic baseline ' + ACCEPTED_VERSION.slice(0, 8));

  // The incident, reproduced on the exact live shape before anything is changed.
  for (const scenario of internalScenarios()) {
    const { last } = lastExecuted(live, scenario);
    if (last === scenario.terminal) fail('live shape already returns ' + scenario.terminal + ' for "' + scenario.label + '"; re-read before deploying');
    pass('defect reproduced on live shape: "' + scenario.label + '" returns ' + last + ' instead of ' + scenario.terminal);
  }

  const candidate = patchIntakeReturnContract(live);
  assertBoundedDelta(live, candidate);
  pass('delta is exactly ' + CHANGED_NODES.join(', ') + ' (positions; C3 call detached + tolerant); zero connection changes');
  printProof(candidate, 'candidate');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'v1-submit-return-contract', (DRY ? 'dry-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, IDS.intake + '.pre.json'), JSON.stringify(live, null, 2) + '\n', 'utf8');
  writeFileSync(join(artifactDir, IDS.intake + '.candidate.json'), JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  pass('rollback and candidate artifacts saved under ' + artifactDir);
  if (DRY) {
    console.log('\nSUBMIT RETURN CONTRACT DRY RUN PASS — zero production writes.');
    return;
  }

  const before = await api('GET', '/workflows/' + IDS.intake);
  if (!same(importable(before), importable(live))) fail('production drifted during candidate preparation');
  let written = false;
  try {
    await api('PUT', '/workflows/' + IDS.intake, importable(candidate), WRITE_KEY, 1);
    written = true;
    const after = await api('GET', '/workflows/' + IDS.intake);
    if (!same(importable(after), importable(candidate))) fail('immediate read-back mismatch');
    if (after.active !== live.active) fail('active state changed');
    assertBoundedDelta(live, after);
    printProof(after, 'deployed ' + after.versionId);
    writeFileSync(join(artifactDir, IDS.intake + '.post.json'), JSON.stringify(after, null, 2) + '\n', 'utf8');
  } catch (error) {
    if (written) {
      await api('PUT', '/workflows/' + IDS.intake, importable(live), WRITE_KEY, 1);
      const restored = await api('GET', '/workflows/' + IDS.intake);
      if (!same(importable(restored), importable(live))) fail('cutover failed AND rollback read-back mismatched: ' + error.message);
      writeFileSync(join(artifactDir, IDS.intake + '.rollback.json'), JSON.stringify(restored, null, 2) + '\n', 'utf8');
      fail('cutover failed; rollback verified: ' + error.message);
    }
    fail('cutover failed before any write: ' + error.message);
  }
  console.log('\nSUBMIT RETURN CONTRACT CUTOVER PASS — one bounded write, read back byte-exactly.');
  console.log('Artifacts: ' + artifactDir);
  console.log('Next: node scripts/deploy-v1-submit-return-contract.mjs --verify, then ONE fresh signed RO Mini App submission.');
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
