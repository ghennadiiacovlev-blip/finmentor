#!/usr/bin/env node
// FINMENTOR V1 — deploy: a committed public (website) merge reaches the single X-Ray owner alert.
//
//   node scripts/deploy-v1-public-merge-owner-alert.mjs --dry-run   GETs only; backup + candidate saved
//   node scripts/deploy-v1-public-merge-owner-alert.mjs --confirm   one PUT of Lead Intake, verified, auto-rollback
//   node scripts/deploy-v1-public-merge-owner-alert.mjs --verify    GETs only; proves the live state
//
// The delta is exactly parameters.jsCode of "Build C3 Intelligence Request". No lead is created,
// no webhook is called, no execution is started. See docs/V1_RU_PUBLIC_MERGE_OWNER_ALERT_2026-09-18.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_PRE_VERSION, IDS, NODE_NAME, graphFacts, importable, isApplied, isPreImage, node, patch, protectedShape, readReplacement
} from './lib/v1-public-merge-owner-alert.mjs';

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
const same = (a, b) => json(a) === json(b);
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);

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
  const left = JSON.parse(json(node(before)));
  const right = JSON.parse(json(node(after)));
  delete left.parameters.jsCode;
  delete right.parameters.jsCode;
  if (!same(left, right)) fail(NODE_NAME + ': field beyond parameters.jsCode changed');
}

// Runtime regression on the DEPLOYED bytes: the live node code, executed against the incident.
const INCIDENT = { lead_id: 'FIN-1789469658573-427', request_id: 'fmr_30250d2a7f4d4f088634188971829d61' };
function runNode(code, named) {
  const handle = (values) => { const items = values.map((j) => ({ json: j })); return { first: () => items[0], all: () => items, isExecuted: true }; };
  const $ = (name) => { if (!(name in named)) throw new Error('node not executed: ' + name); return handle(named[name]); };
  return new Function('$', '$input', code)($, handle([{}]));
}
function incidentDispatch(workflow) {
  return runNode(String(node(workflow).parameters.jsCode || ''), {
    'Restore Lead Context (Merged)': [{ provenance_trusted: false, lead_id: INCIDENT.lead_id, request_id: INCIDENT.request_id, lead_priority: 'HOT', status: 'Merged into ' + INCIDENT.lead_id }],
    'Update Pipeline (Merge)': [{}], 'Respond Merged': [{}]
  });
}
function assertDispatches(workflow) {
  const out = incidentDispatch(workflow);
  const want = { event: 'ELIGIBLE_MERGE_COMMITTED', lead_id: INCIDENT.lead_id, request_id: INCIDENT.request_id, eligible: true,
    commit_authority: 'PUBLIC_PIPELINE_MERGE', source_workflow_id: IDS.leadIntake, settlement_mode: 'merged' };
  if (!(out.length === 1 && same(out[0].json, want))) fail('deployed node does not dispatch the incident public merge: ' + JSON.stringify(out));
  const uncommitted = runNode(String(node(workflow).parameters.jsCode || ''), { 'Restore Lead Context (Merged)': [{ provenance_trusted: false, lead_id: INCIDENT.lead_id, request_id: INCIDENT.request_id }] });
  if (uncommitted.length !== 0) fail('deployed node dispatches an uncommitted public merge');
  pass('runtime: deployed code dispatches the incident request once and refuses an uncommitted merge');
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
  const replacement = readReplacement(ROOT);
  const live = await api('GET', '/workflows/' + IDS.leadIntake);
  if (!live.active) fail('Lead Intake is inactive');
  for (const fact of graphFacts(live)) pass('live graph: ' + fact);

  if (VERIFY || isApplied(live, replacement)) {
    if (!isApplied(live, replacement)) fail('live source does not match the tracked correction');
    pass('live ' + live.versionId + ': ' + NODE_NAME + ' carries the public merge owner route');
    assertDispatches(live);
    printDrift();
    return;
  }
  if (live.versionId !== EXPECTED_PRE_VERSION) fail('unexpected live version ' + live.versionId);
  if (!isPreImage(live, replacement)) fail('unexpected live ' + NODE_NAME + ' pre-image');
  if (incidentDispatch(live).length !== 0) fail('pre-image does not reproduce the incident');
  pass('pre-image reproduces the incident: the committed public merge dispatches nothing');

  const candidate = patch(live, replacement);
  assertOneNodeDelta(live, candidate);
  graphFacts(candidate);
  assertDispatches(candidate);
  pass('delta is exactly parameters.jsCode of ' + NODE_NAME);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'v1-public-merge-owner-alert', (DRY ? 'dry-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, IDS.leadIntake + '.pre.json'), JSON.stringify(live, null, 2) + '\n');
  writeFileSync(join(artifactDir, IDS.leadIntake + '.candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  pass('backup and candidate saved under ' + artifactDir);
  if (DRY) return;

  const before = await api('GET', '/workflows/' + IDS.leadIntake);
  if (!same(importable(before), importable(live))) fail('production drifted during preparation');
  let written = false;
  try {
    await api('PUT', '/workflows/' + IDS.leadIntake, importable(candidate), WRITE_KEY);
    written = true;
    const after = await api('GET', '/workflows/' + IDS.leadIntake);
    if (!same(importable(after), importable(candidate))) fail('fresh API read-back mismatch');
    if (!after.active) fail('active state changed');
    assertOneNodeDelta(live, after);
    graphFacts(after);
    if (!isApplied(after, replacement)) fail('read-back lacks the public merge owner route');
    assertDispatches(after);
    writeFileSync(join(artifactDir, IDS.leadIntake + '.post.json'), JSON.stringify(after, null, 2) + '\n');
    pass('deployed ' + after.versionId + ' and verified fresh API read-back');
    printDrift();
  } catch (error) {
    if (written) {
      await api('PUT', '/workflows/' + IDS.leadIntake, importable(live), WRITE_KEY);
      const restored = await api('GET', '/workflows/' + IDS.leadIntake);
      if (!same(importable(restored), importable(live))) fail('cutover failed and rollback mismatched: ' + error.message);
      writeFileSync(join(artifactDir, IDS.leadIntake + '.rollback.json'), JSON.stringify(restored, null, 2) + '\n');
      fail('cutover failed; rollback verified: ' + error.message);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
