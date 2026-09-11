#!/usr/bin/env node
// FINMENTOR C4.11 — deterministic settings-only retention candidate/deployment helper.
//
// Default invocation is OFFLINE and writes only the reviewed plan artifact:
//   node scripts/deploy-c4-11-retention-settings.mjs
//
// A future production change requires separate owner authorisation and an explicit `--deploy`
// plus the dedicated read/write API keys. C4.11 must not invoke that mode.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const PLAN_PATH = join(ROOT, 'n8n', 'candidate', 'c4-11-execution-retention-plan.json');
export const BACKUP_ROOT = join(ROOT, '.uat', 'c4-11-retention-backups');
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
const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function canonical(value) {
  if (value === undefined) return { __finmentor_type: 'undefined' };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

const serialise = (value) => JSON.stringify(canonical(value));
export const fingerprint = (value) => createHash('sha256').update(serialise(value)).digest('hex');

export function credentialsProjection(workflow) {
  return Array.isArray(workflow && workflow.nodes) ? workflow.nodes.map((node) => ({
    id: has(node, 'id') ? node.id : null,
    name: has(node, 'name') ? node.name : null,
    credentials: has(node, 'credentials') ? node.credentials : null
  })) : [];
}

export function unrelatedSettings(workflow) {
  const settings = (workflow && workflow.settings) || {};
  return Object.fromEntries(Object.entries(settings)
    .filter(([key]) => !has(RETENTION_SETTINGS, key)));
}

export function workflowFingerprints(workflow) {
  return {
    nodes: fingerprint(workflow && workflow.nodes),
    connections: fingerprint(workflow && workflow.connections),
    active: fingerprint(workflow && workflow.active),
    staticData: fingerprint(workflow && workflow.staticData),
    credentials: fingerprint(credentialsProjection(workflow)),
    unrelatedSettings: fingerprint(unrelatedSettings(workflow))
  };
}

function assertSnapshotShape(workflow, target) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('workflow snapshot is not an object');
  if (String(workflow.id || '') !== target.id) throw new Error('workflow id mismatch for ' + target.name);
  if (String(workflow.name || '') !== target.name) throw new Error('workflow name mismatch for ' + target.id);
  if (!Array.isArray(workflow.nodes)) throw new Error('workflow nodes are unreadable for ' + target.id);
  if (!workflow.connections || typeof workflow.connections !== 'object' || Array.isArray(workflow.connections)) {
    throw new Error('workflow connections are unreadable for ' + target.id);
  }
  if (!workflow.settings || typeof workflow.settings !== 'object' || Array.isArray(workflow.settings)) {
    throw new Error('workflow settings are unreadable for ' + target.id);
  }
  if (typeof workflow.active !== 'boolean') throw new Error('workflow active state is unreadable for ' + target.id);
  if (!has(workflow, 'staticData')) throw new Error('workflow staticData is absent for ' + target.id);
}

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

export function precheckRetentionWorkflow(workflow, target) {
  assertSnapshotShape(workflow, target);
  const before = clone(workflow);
  const candidate = applyRetentionSettings(before, target);
  return { target: clone(target), before, candidate, fingerprints: workflowFingerprints(before) };
}

export function workflowUpdatePayload(workflow) {
  return clone({
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings || {}
  });
}

export function assertDeploymentReadback(before, after, target) {
  assertSnapshotShape(after, target);
  assertSettingsOnly(before, after);
  const expected = workflowFingerprints(before);
  const actual = workflowFingerprints(after);
  for (const key of Object.keys(expected)) {
    if (actual[key] !== expected[key]) throw new Error('post-write readback changed ' + key + ' for ' + target.id);
  }
  return true;
}

export function assertExactRestoration(before, after, target) {
  assertSnapshotShape(after, target);
  for (const key of ['id', 'name', 'active', 'nodes', 'connections', 'staticData', 'settings']) {
    if (serialise(before && before[key]) !== serialise(after && after[key])) {
      throw new Error('rollback did not restore ' + key + ' for ' + target.id);
    }
  }
  if (fingerprint(credentialsProjection(before)) !== fingerprint(credentialsProjection(after))) {
    throw new Error('rollback did not restore credentials for ' + target.id);
  }
  return true;
}

export function writeBackupArtifacts(prechecks, options = {}) {
  if (!Array.isArray(prechecks) || prechecks.length !== TARGET_WORKFLOWS.length) {
    throw new Error('all eight prechecks are required before backups');
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new Error('backup timestamp is invalid');
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const root = options.backupRoot || BACKUP_ROOT;
  const directory = join(root, stamp);
  mkdirSync(root, { recursive: true });
  mkdirSync(directory);

  const files = [];
  const manifestTargets = [];
  for (let index = 0; index < prechecks.length; index++) {
    const entry = prechecks[index];
    const filename = String(index + 1).padStart(2, '0') + '-' + entry.target.id + '.json';
    const record = {
      control: 'FINMENTOR_C4_11_EXECUTION_RETENTION_BACKUP',
      captured_at: now.toISOString(),
      target: entry.target,
      before_fingerprints: entry.fingerprints,
      before: entry.before,
      restore: {
        workflow_update_payload: workflowUpdatePayload(entry.before),
        active: entry.before.active
      }
    };
    writeFileSync(join(directory, filename), JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    files.push(filename);
    manifestTargets.push({ id: entry.target.id, name: entry.target.name, file: filename, before_fingerprints: entry.fingerprints });
  }
  const manifest = {
    control: 'FINMENTOR_C4_11_EXECUTION_RETENTION_BACKUP_SET',
    captured_at: now.toISOString(),
    target_count: prechecks.length,
    created_before_first_write: true,
    targets: manifestTargets
  };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return { directory, files: [...files, 'manifest.json'], capturedAt: now.toISOString() };
}

export class RetentionDeploymentError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'RetentionDeploymentError';
    this.report = report;
  }
}

async function rollbackAttempted(attempted, request, report, log) {
  const failures = [];
  for (const entry of [...attempted].reverse()) {
    let putError = null;
    try {
      await request({
        phase: 'rollback-write', credential: 'write', method: 'PUT', target: entry.target,
        path: '/workflows/' + entry.target.id, body: workflowUpdatePayload(entry.before)
      });
    } catch (error) {
      putError = error;
    }

    try {
      let restored = await request({
        phase: 'rollback-readback', credential: 'read', method: 'GET', target: entry.target,
        path: '/workflows/' + entry.target.id + '?excludePinnedData=true'
      });
      if (restored && restored.active !== entry.before.active) {
        await request({
          phase: 'rollback-active', credential: 'write', method: 'POST', target: entry.target,
          path: '/workflows/' + entry.target.id + (entry.before.active ? '/activate' : '/deactivate')
        });
        restored = await request({
          phase: 'rollback-readback', credential: 'read', method: 'GET', target: entry.target,
          path: '/workflows/' + entry.target.id + '?excludePinnedData=true'
        });
      }
      assertExactRestoration(entry.before, restored, entry.target);
      report.rolledBack.push(entry.target.id);
      log('  ROLLBACK READBACK PASS  ' + entry.target.name + ' (' + entry.target.id + ')');
    } catch (error) {
      failures.push({ id: entry.target.id, error: error.message, put_error: putError && putError.message });
    }
  }
  report.rollbackFailures = failures;
  report.rollbackStatus = failures.length ? 'FAILED' : 'PASS';
  report.manualInterventionRequired = failures.length > 0;
}

export async function runRetentionDeployment(options = {}) {
  const request = options.request;
  const backupWriter = options.backupWriter || ((prechecks) => writeBackupArtifacts(prechecks));
  const log = options.log || (() => {});
  if (typeof request !== 'function') throw new Error('request adapter is required');
  if (typeof backupWriter !== 'function') throw new Error('backup writer is required');

  const report = {
    deploymentStatus: 'BLOCKED', targetCount: TARGET_WORKFLOWS.length,
    prechecked: [], forwardAttempted: [], forwardCompleted: [], rolledBack: [],
    backup: null, rollbackStatus: 'NOT_REQUIRED', rollbackFailures: [],
    manualInterventionRequired: false
  };
  const prepared = [];

  try {
    for (const target of TARGET_WORKFLOWS) {
      const live = await request({
        phase: 'precheck', credential: 'read', method: 'GET', target,
        path: '/workflows/' + target.id + '?excludePinnedData=true'
      });
      const entry = precheckRetentionWorkflow(live, target);
      prepared.push(entry);
      report.prechecked.push(target.id);
    }
  } catch (error) {
    throw new RetentionDeploymentError('DEPLOYMENT STATUS = BLOCKED; PRECHECK FAILED; ZERO WRITES: ' + error.message, report);
  }

  try {
    report.backup = await backupWriter(prepared);
  } catch (error) {
    throw new RetentionDeploymentError('DEPLOYMENT STATUS = BLOCKED; BACKUP FAILED; ZERO WRITES: ' + error.message, report);
  }

  const attempted = [];
  try {
    for (const entry of prepared) {
      const current = await request({
        phase: 'forward-guard', credential: 'read', method: 'GET', target: entry.target,
        path: '/workflows/' + entry.target.id + '?excludePinnedData=true'
      });
      assertExactRestoration(entry.before, current, entry.target);
      attempted.push(entry);
      report.forwardAttempted.push(entry.target.id);
      await request({
        phase: 'forward-write', credential: 'write', method: 'PUT', target: entry.target,
        path: '/workflows/' + entry.target.id, body: workflowUpdatePayload(entry.candidate)
      });
      const after = await request({
        phase: 'forward-readback', credential: 'read', method: 'GET', target: entry.target,
        path: '/workflows/' + entry.target.id + '?excludePinnedData=true'
      });
      assertDeploymentReadback(entry.before, after, entry.target);
      report.forwardCompleted.push(entry.target.id);
      log('  READBACK PASS  ' + entry.target.name + ' (' + entry.target.id + ')');
    }
  } catch (error) {
    report.forwardError = error.message;
    await rollbackAttempted(attempted, request, report, log);
    const suffix = report.rollbackStatus === 'PASS'
      ? 'ROLLBACK = PASS'
      : 'ROLLBACK = FAILED; BLOCKED / MANUAL INTERVENTION REQUIRED';
    throw new RetentionDeploymentError('DEPLOYMENT STATUS = BLOCKED; ' + suffix + '; ' + error.message, report);
  }

  report.deploymentStatus = 'PASS';
  return report;
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
    deployment_protocol: {
      all_target_precheck_before_write: true,
      timestamped_backups_before_write: '.uat/c4-11-retention-backups/<UTC timestamp>/',
      readback_after_each_write: true,
      automatic_rollback: true,
      rollback_order: 'reverse',
      rollback_readback_required: true,
      partial_success_allowed: false
    },
    invariants: [
      'workflow id and name match the approved target',
      'active state is preserved',
      'nodes and connections are byte-equivalent JSON',
      'credentials remain inside unchanged nodes',
      'unrelated settings and staticData are preserved',
      'post-write readback must match all four retention settings',
      'all eight workflows pass precheck and local backup before the first PUT',
      'each workflow still matches its precheck snapshot immediately before its PUT',
      'a failed write or readback rolls back every attempted workflow and exits non-zero'
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

  const request = ({ credential, method, path, body }) =>
    api(base, credential === 'write' ? writeKey : readKey, method, path, body);
  const report = await runRetentionDeployment({ request, log: console.log });
  console.log('DEPLOYMENT STATUS = ' + report.deploymentStatus);
  console.log('  backup: ' + report.backup.directory);
  console.log('  readbacks: ' + report.forwardCompleted.length + '/' + report.targetCount);
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
    deploy().catch((error) => {
      console.error(error.message);
      if (error.report) {
        console.error('  ROLLBACK = ' + error.report.rollbackStatus);
        if (error.report.manualInterventionRequired) console.error('  BLOCKED / MANUAL INTERVENTION REQUIRED');
      }
      process.exit(1);
    });
  } else if (process.argv.includes('--audit-live')) {
    auditLive().catch((error) => { console.error('ABORTED: ' + error.message); process.exit(1); });
  } else {
    writeFileSync(PLAN_PATH, JSON.stringify(buildPlan(), null, 2) + '\n', 'utf8');
    console.log('C4.11 execution-retention plan written: ' + PLAN_PATH);
    console.log('  targets: ' + TARGET_WORKFLOWS.length);
    console.log('  production mutation: NO');
  }
}
