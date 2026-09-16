#!/usr/bin/env node
// FINMENTOR V1 — guarded RO UAT P0/P1 correction deployment.
//
//   node scripts/deploy-v1-ro-uat-correction.mjs --dry-run
//   node scripts/deploy-v1-ro-uat-correction.mjs --confirm

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHost } from './deploy-c3-miniapp-host.mjs';
import {
  IDS, importable, patchCommand, patchIntake, patchXray, protectedShape, readCorrectionSources
} from './lib/v1-ro-uat-correction.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const BASELINE = 'a2a3260c8dfd03c58c01b0bfb0f9aad98b1e2c04';
const PRE = join(ROOT, '.uat', 'v1-ro-uat-p0p1', 'pre');

const json = (value) => JSON.stringify(value);
const clone = (value) => JSON.parse(json(value));
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const load = (file) => JSON.parse(readFileSync(file, 'utf8'));

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
function latestHostPre() {
  const prefix = IDS.host + '.pre-c3-host.live-';
  const files = readdirSync(join(ROOT, '.uat')).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort();
  if (!files.length) fail('fresh Mini App host pre-snapshot missing');
  return join(ROOT, '.uat', files[files.length - 1]);
}
function normalise(workflow) { return importable(workflow); }
function same(a, b) { return json(a) === json(b); }
function byName(workflow) { return new Map(workflow.nodes.map((item) => [item.name, item])); }
function changedNodes(before, after) {
  const a = byName(before); const b = byName(after);
  return {
    added: [...b.keys()].filter((name) => !a.has(name)).sort(),
    removed: [...a.keys()].filter((name) => !b.has(name)).sort(),
    changed: [...a.keys()].filter((name) => b.has(name) && json(a.get(name)) !== json(b.get(name))).sort()
  };
}
function changedConnections(before, after) {
  const names = new Set([...Object.keys(before.connections || {}), ...Object.keys(after.connections || {})]);
  return [...names].filter((name) => json((before.connections || {})[name]) !== json((after.connections || {})[name])).sort();
}
function assertExactSet(actual, expected, label) {
  const a = [...actual].sort(); const e = [...expected].sort();
  if (!same(a, e)) fail(label + ': got [' + a.join(', ') + '], expected [' + e.join(', ') + ']');
}
function assertProtected(label, before, after) {
  if (!same(protectedShape(before), protectedShape(after))) fail(label + ': credential/schedule/webhook authority drift');
  if (!same(before.settings || {}, after.settings || {})) fail(label + ': workflow settings drift');
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

async function rollback(applied, fresh, artifactDir) {
  let clean = true;
  for (const target of [...applied].reverse()) {
    try {
      await api('PUT', '/workflows/' + target.id, normalise(fresh.get(target.id)), WRITE_KEY, 1);
      const restored = await api('GET', '/workflows/' + target.id);
      if (!same(normalise(restored), normalise(fresh.get(target.id))) || restored.active !== fresh.get(target.id).active)
        fail(target.label + ': rollback read-back mismatch');
      writeFileSync(join(artifactDir, target.id + '.rollback.json'), JSON.stringify(restored, null, 2) + '\n', 'utf8');
      pass(target.label + ': rollback verified');
    } catch (error) {
      clean = false;
      console.error('  ROLLBACK FAIL  ' + target.label + ': ' + error.message);
    }
  }
  return clean;
}

async function main() {
  if (DRY === CONFIRM) fail('choose exactly one of --dry-run or --confirm');
  if (!BASE || !READ_KEY || (CONFIRM && !WRITE_KEY)) fail('missing n8n API environment');
  if (gitHead() !== BASELINE || gitRef('refs/remotes/origin/main') !== BASELINE)
    fail('accepted main baseline drift');
  pass('HEAD and origin/main are exact baseline ' + BASELINE.slice(0, 7));

  const targets = [
    { id: IDS.xray, key: 'xray', label: 'X-Ray / Owner Intelligence' },
    { id: IDS.command, key: 'command', label: 'Owner Command Center' },
    { id: IDS.intake, key: 'intake', label: 'Lead Intake' },
    { id: IDS.host, key: 'host', label: 'Premium Mini App host' }
  ];
  const accepted = new Map([
    [IDS.xray, load(join(PRE, IDS.xray + '.json'))],
    [IDS.command, load(join(PRE, IDS.command + '.json'))],
    [IDS.intake, load(join(PRE, IDS.intake + '.json'))],
    [IDS.host, load(latestHostPre())]
  ]);
  const fresh = new Map();
  console.log('\nFINMENTOR V1 RO UAT CORRECTION — ' + (DRY ? 'DRY RUN' : 'CONTROLLED CUTOVER'));
  for (const target of targets) {
    const live = await api('GET', '/workflows/' + target.id);
    if (!live.active) fail(target.label + ': workflow inactive');
    if (!same(normalise(live), normalise(accepted.get(target.id)))) fail(target.label + ': production drift after accepted read-only trace');
    fresh.set(target.id, live);
    pass(target.label + ': accepted production baseline re-read');
  }

  const sources = readCorrectionSources(ROOT);
  const hostTemplate = load(join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json'));
  const preparedHost = prepareHost(fresh.get(IDS.host), hostTemplate);
  if (preparedHost.failures.length) fail('Mini App host: ' + preparedHost.failures.join(' | '));
  const candidates = new Map([
    [IDS.xray, patchXray(fresh.get(IDS.xray), sources)],
    [IDS.command, patchCommand(fresh.get(IDS.command), sources)],
    [IDS.intake, patchIntake(fresh.get(IDS.intake), sources)],
    [IDS.host, preparedHost.out]
  ]);

  const hostPage = String(candidates.get(IDS.host).nodes.find((item) => item.name === 'Serve Page').parameters.responseBody || '');
  for (const needle of [
    "visibleAttr(inp, 'placeholder', placeholder)", "visibleAttr(ta, 'placeholder', placeholder)",
    'De exemplu: afacerea crește', 'De exemplu: peste o lună aveți o întâlnire cu banca', 'Opțional.',
    "visibleAttr(backBtn, 'aria-label', 'Назад')", "visibleAttr(stagesEl, 'aria-label', 'Этапы')"
  ]) if (!hostPage.includes(needle)) fail('Mini App candidate missing localized surface: ' + needle);

  assertExactSet(changedNodes(fresh.get(IDS.intake), candidates.get(IDS.intake)).added, ['Route C3 Result Mode'], 'Lead Intake added nodes');
  assertExactSet(changedNodes(fresh.get(IDS.intake), candidates.get(IDS.intake)).removed, [], 'Lead Intake removed nodes');
  assertExactSet(changedNodes(fresh.get(IDS.intake), candidates.get(IDS.intake)).changed, ['Build C3 Intelligence Request'], 'Lead Intake changed nodes');
  assertExactSet(changedConnections(fresh.get(IDS.intake), candidates.get(IDS.intake)), ['IF Committed (Merge)', 'Route C3 Result Mode', 'Run Owner Intelligence (C3)'], 'Lead Intake connections');
  assertExactSet(changedNodes(fresh.get(IDS.xray), candidates.get(IDS.xray)).changed,
    ['Analysis Failed Row', 'Build Analysis Input', 'Select Pending Leads', 'Telegram Owner Alert', 'Validate + Store Rows', 'Validate C3 Lead Target'], 'X-Ray changed nodes');
  assertExactSet(changedNodes(fresh.get(IDS.command), candidates.get(IDS.command)).changed, ['Render Pre-Call Brief'], 'Command changed nodes');
  assertExactSet(changedNodes(fresh.get(IDS.host), candidates.get(IDS.host)).changed, ['Serve Page'], 'Host changed nodes');
  assertExactSet(changedConnections(fresh.get(IDS.xray), candidates.get(IDS.xray)), [], 'X-Ray connections');
  assertExactSet(changedConnections(fresh.get(IDS.command), candidates.get(IDS.command)), [], 'Command connections');
  assertExactSet(changedConnections(fresh.get(IDS.host), candidates.get(IDS.host)), [], 'Host connections');
  for (const target of targets) {
    assertProtected(target.label, fresh.get(target.id), candidates.get(target.id));
    pass(target.label + ': bounded delta and protected authority verified');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'v1-ro-uat-p0p1', (DRY ? 'dry-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  for (const target of targets) {
    writeFileSync(join(artifactDir, target.id + '.pre.json'), JSON.stringify(fresh.get(target.id), null, 2) + '\n', 'utf8');
    writeFileSync(join(artifactDir, target.id + '.candidate.json'), JSON.stringify(candidates.get(target.id), null, 2) + '\n', 'utf8');
  }
  pass('fresh rollback and candidate artifacts saved under ' + artifactDir);
  if (DRY) {
    console.log('\nRO UAT CORRECTION DRY RUN PASS — zero production writes.');
    return;
  }

  const applied = [];
  try {
    for (const target of targets) {
      await api('PUT', '/workflows/' + target.id, normalise(candidates.get(target.id)), WRITE_KEY, 1);
      applied.push(target);
      const after = await api('GET', '/workflows/' + target.id);
      if (!same(normalise(after), normalise(candidates.get(target.id)))) fail(target.label + ': immediate read-back mismatch');
      if (after.active !== fresh.get(target.id).active) fail(target.label + ': active state changed');
      assertProtected(target.label, candidates.get(target.id), after);
      writeFileSync(join(artifactDir, target.id + '.post.json'), JSON.stringify(after, null, 2) + '\n', 'utf8');
      pass(target.label + ': deployed and read back');
    }
  } catch (error) {
    console.error('\nCUTOVER FAILED — ' + error.message);
    const restored = await rollback(applied, fresh, artifactDir);
    fail(restored ? 'all writes rolled back' : 'rollback incomplete; inspect ' + artifactDir);
  }

  console.log('\nRO UAT CORRECTION CUTOVER PASS — four bounded writes, zero authority drift.');
  console.log('Artifacts: ' + artifactDir);
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
