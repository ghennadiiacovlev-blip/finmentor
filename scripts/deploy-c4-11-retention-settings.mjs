#!/usr/bin/env node
// FINMENTOR C4.11 — deterministic settings-only retention candidate/deployment helper.
//
// Default invocation is OFFLINE and writes only the reviewed plan artifact:
//   node scripts/deploy-c4-11-retention-settings.mjs
//
// A future production change requires separate owner authorisation and an explicit `--deploy`
// plus the dedicated read/write API keys. C4.11 must not invoke that mode.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const PLAN_PATH = join(ROOT, 'n8n', 'candidate', 'c4-11-execution-retention-plan.json');
export const BASE_SHA = 'a1e6667a8245d25b349b0f35571655916d449aaa';

export const RETENTION_SETTINGS = Object.freeze({
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  saveExecutionProgress: false
});

export const TARGET_WORKFLOWS = Object.freeze([
  { id: 'QmIyEW2ZEqKregmN', name: 'FINMENTOR Lead Intake PREMIUM FINAL' },
  { id: 'mppzthlkSJFr6Kle', name: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED' },
  { id: 'ShcmmJeLSE8LYVBk', name: 'FINMENTOR Telegram Client Transport' },
  { id: 'LZ2mvKXbBikmeVTn', name: 'FINMENTOR SLA Lead Watch PREMIUM FINAL' },
  { id: 'imeJIDeNyaWDyXzh', name: 'FINMENTOR Daily Lead Digest PREMIUM FINAL' },
  { id: 'zeLOCuf0K1bkaKl2', name: 'FINMENTOR Followup Sequence PREMIUM v2' },
  { id: 'qF9tonlHHIxc8MDd', name: 'FINMENTOR Lead Command Center SECURE CANDIDATE' },
  { id: 'tNSMRoKlFB52vjge', name: 'FINMENTOR X-Ray Analysis' }
]);

const clone = (value) => JSON.parse(JSON.stringify(value));

export function applyRetentionSettings(workflow, target) {
  const source = workflow || {};
  const expected = target || TARGET_WORKFLOWS.find((item) => item.id === source.id);
  if (!expected) throw new Error('workflow is not in the approved C4.11 target set');
  if (String(source.id || '') !== expected.id) throw new Error('workflow id mismatch for ' + expected.name);
  if (String(source.name || '') !== expected.name) throw new Error('workflow name mismatch for ' + expected.id);

  const out = clone(source);
  out.settings = Object.assign({}, out.settings || {}, RETENTION_SETTINGS);
  assertSettingsOnly(source, out);
  return out;
}

export function assertSettingsOnly(before, after) {
  for (const key of ['id', 'name', 'active', 'nodes', 'connections', 'staticData']) {
    if (JSON.stringify(before && before[key]) !== JSON.stringify(after && after[key])) {
      throw new Error('settings-only candidate changed ' + key);
    }
  }
  const beforeSettings = (before && before.settings) || {};
  const afterSettings = (after && after.settings) || {};
  const all = new Set([...Object.keys(beforeSettings), ...Object.keys(afterSettings)]);
  for (const key of all) {
    const changed = JSON.stringify(beforeSettings[key]) !== JSON.stringify(afterSettings[key]);
    if (changed && !Object.prototype.hasOwnProperty.call(RETENTION_SETTINGS, key)) {
      throw new Error('settings-only candidate changed unrelated setting ' + key);
    }
  }
  for (const [key, value] of Object.entries(RETENTION_SETTINGS)) {
    if (afterSettings[key] !== value) throw new Error('retention setting did not land: ' + key);
  }
  return true;
}

export function buildPlan() {
  return {
    control: 'FINMENTOR_C4_11_EXECUTION_RETENTION',
    base_sha: BASE_SHA,
    generated_from: 'scripts/deploy-c4-11-retention-settings.mjs',
    deployment_authorised: false,
    mutation_scope: 'workflow.settings only',
    retention_settings: RETENTION_SETTINGS,
    targets: TARGET_WORKFLOWS,
    invariants: [
      'workflow id and name match the approved target',
      'active state is preserved',
      'nodes and connections are byte-equivalent JSON',
      'credentials remain inside unchanged nodes',
      'unrelated settings and staticData are preserved',
      'post-write readback must match all four retention settings'
    ]
  };
}

async function api(base, key, method, path, body) {
  const response = await fetch(base + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (error) { /* surfaced below */ }
  if (!response.ok) throw new Error(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
  return parsed;
}

async function deploy() {
  const base = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const readKey = process.env.N8N_API_KEY;
  const writeKey = process.env.N8N_FIX_API_KEY;
  if (!base || !readKey || !writeKey) throw new Error('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY are required');
  if (process.env.C4_11_RETENTION_CONFIRM !== 'SETTINGS_ONLY') throw new Error('C4_11_RETENTION_CONFIRM=SETTINGS_ONLY is required');

  for (const target of TARGET_WORKFLOWS) {
    const before = await api(base, readKey, 'GET', '/workflows/' + target.id + '?excludePinnedData=true');
    const candidate = applyRetentionSettings(before, target);
    await api(base, writeKey, 'PUT', '/workflows/' + target.id, {
      name: candidate.name,
      nodes: candidate.nodes,
      connections: candidate.connections,
      settings: candidate.settings
    });
    const after = await api(base, readKey, 'GET', '/workflows/' + target.id + '?excludePinnedData=true');
    assertSettingsOnly(before, after);
    console.log('  READBACK PASS  ' + target.name + ' (' + target.id + ')');
  }
}

async function auditLive() {
  const base = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const readKey = process.env.N8N_API_KEY;
  if (!base || !readKey) throw new Error('N8N_BASE_URL and N8N_API_KEY are required');

  for (const target of TARGET_WORKFLOWS) {
    const live = await api(base, readKey, 'GET', '/workflows/' + target.id + '?excludePinnedData=true');
    if (String(live && live.id || '') !== target.id) throw new Error('workflow id mismatch for ' + target.name);
    if (String(live && live.name || '') !== target.name) {
      throw new Error('workflow name mismatch for ' + target.id + ': ' + String(live && live.name || ''));
    }
    const settings = (live && live.settings) || {};
    const state = Object.fromEntries(Object.keys(RETENTION_SETTINGS).map((key) => [key, settings[key]]));
    console.log('  LIVE AUDIT  ' + target.name + ' (' + target.id + ') ' + JSON.stringify(state));
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c4-11-retention-settings.mjs');
if (isMain) {
  if (process.argv.includes('--deploy')) {
    deploy().catch((error) => { console.error('ABORTED: ' + error.message); process.exit(1); });
  } else if (process.argv.includes('--audit-live')) {
    auditLive().catch((error) => { console.error('ABORTED: ' + error.message); process.exit(1); });
  } else {
    writeFileSync(PLAN_PATH, JSON.stringify(buildPlan(), null, 2) + '\n', 'utf8');
    console.log('C4.11 execution-retention plan written: ' + PLAN_PATH);
    console.log('  targets: ' + TARGET_WORKFLOWS.length);
    console.log('  production mutation: NO');
  }
}
