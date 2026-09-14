#!/usr/bin/env node
// FINMENTOR V1 Starter schedule-only deployment.
//
//   node scripts/deploy-starter-schedules.mjs --dry-run   # read and verify; no write
//   node scripts/deploy-starter-schedules.mjs --confirm   # future approved cutover only
//
// The current authorization explicitly stops before merge/deploy. The --confirm path is prepared
// for a later cutover, but must not be run as part of this PR/report pass.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  ERROR_MONITOR, SCHEDULE_TARGETS, SCHEDULE_TIMEZONE,
  OLD_FIXED_SCHEDULED_MONTHLY, NEW_FIXED_SCHEDULED_MONTHLY,
  ESTIMATED_EVENT_DRIVEN_MONTHLY, ESTIMATED_TOTAL_MONTHLY, SAFETY_RESERVE,
  STARTER_LIMIT, INTERNAL_TARGET, WARNING_LEVEL,
  prepareScheduleCandidate, assertScheduleReadback, assertErrorMonitorContract, importableWorkflow,
  __test
} from './lib/starter-schedule-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_ROOT = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirm = args.includes('--confirm');
const base = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const readKey = process.env.N8N_API_KEY;
const writeKey = process.env.N8N_FIX_API_KEY;
const encode = encodeURIComponent;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pass = (message) => console.log('  PASS  ' + message);
const fail = (message) => { throw new Error(message); };

async function api(method, path, body, tries = 4) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? readKey : writeKey }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await response.text();
      if (!response.ok) throw new Error(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
      return text ? JSON.parse(text) : null;
    } catch (error) {
      last = error;
      if (attempt + 1 < tries) await sleep(1200);
    }
  }
  throw last;
}

async function listWorkflowSummaries() {
  const result = [];
  let cursor = '';
  do {
    const page = await api('GET', '/workflows?limit=250' + (cursor ? '&cursor=' + encode(cursor) : ''));
    result.push(...(page.data || []));
    cursor = page.nextCursor || '';
  } while (cursor);
  return result;
}

async function reconcileActivity(before, current) {
  if (current.active === before.active) return current;
  const action = before.active ? 'activate' : 'deactivate';
  await api('POST', '/workflows/' + before.id + '/' + action, {});
  const reconciled = await api('GET', '/workflows/' + before.id);
  if (reconciled.active !== before.active) fail(before.id + ': failed to restore active state after PUT');
  return reconciled;
}

async function restore(before) {
  await api('PUT', '/workflows/' + before.id, importableWorkflow(before));
  const restored = await reconcileActivity(before, await api('GET', '/workflows/' + before.id));
  for (const key of ['name', 'nodes', 'connections', 'settings']) {
    if (!__test.same(restored[key] || {}, before[key] || {})) fail(before.id + ': rollback differs at ' + key);
  }
  if (restored.active !== before.active) fail(before.id + ': rollback active state differs');
}

async function main() {
  if (dryRun === confirm) fail('choose exactly one mode: --dry-run or --confirm');
  if (!base || !readKey) fail('N8N_BASE_URL and N8N_API_KEY are required');
  if (confirm && !writeKey) fail('N8N_FIX_API_KEY is required for --confirm');

  console.log('\nFINMENTOR V1 STARTER SCHEDULES - ' + (dryRun ? 'READ-ONLY DRY RUN' : 'CONTROLLED CUTOVER'));
  console.log('='.repeat(78));

  const summaries = await listWorkflowSummaries();
  const active = summaries.filter((workflow) => workflow.active === true);
  const liveActive = await Promise.all(active.map((workflow) => api('GET', '/workflows/' + workflow.id)));
  const activeScheduled = liveActive.filter((workflow) => workflow.nodes.some((node) => node.type === 'n8n-nodes-base.scheduleTrigger'));
  const expectedIds = SCHEDULE_TARGETS.map((target) => target.id).sort();
  const actualIds = activeScheduled.map((workflow) => workflow.id).sort();
  if (!__test.same(actualIds, expectedIds)) fail('active scheduled workflow inventory differs: ' + actualIds.join(', '));
  pass('tenant inventory complete: ' + summaries.length + ' workflows, ' + active.length + ' active, exactly 4 active scheduled');

  const liveById = new Map(liveActive.map((workflow) => [workflow.id, workflow]));
  const plan = SCHEDULE_TARGETS.map((target) => prepareScheduleCandidate(liveById.get(target.id)));
  assertErrorMonitorContract(liveById.get(ERROR_MONITOR.id));
  pass('Error Monitor remains one Error Trigger with zero polling schedules');

  for (const step of plan) {
    pass(step.target.key + ': ' + step.target.newSchedule + '; timezone=' + SCHEDULE_TIMEZONE + '; changed=' + step.changed);
  }
  pass('fixed schedules: ' + OLD_FIXED_SCHEDULED_MONTHLY + ' -> ' + NEW_FIXED_SCHEDULED_MONTHLY + ' executions/month');
  pass('normal event-driven envelope: ' + ESTIMATED_EVENT_DRIVEN_MONTHLY + '/month');
  pass('projected total ' + ESTIMATED_TOTAL_MONTHLY + ' <= internal target ' + INTERNAL_TARGET);
  pass('Starter reserve ' + SAFETY_RESERVE + '; warning level ' + WARNING_LEVEL + '; quota ' + STARTER_LIMIT);

  if (dryRun) {
    console.log('\nDRY RUN COMPLETE - no PUT, activation, merge, deployment, backfill, or customer action.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(OUT_ROOT, 'starter-schedule-backups', stamp);
  mkdirSync(backupDir, { recursive: true });
  for (const step of plan) {
    writeFileSync(join(backupDir, step.target.id + '.full.json'), JSON.stringify(liveById.get(step.target.id), null, 2) + '\n', 'utf8');
  }
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({
    captured_at: new Date().toISOString(),
    timezone: SCHEDULE_TIMEZONE,
    workflows: plan.map((step) => ({
      id: step.target.id,
      name: step.target.name,
      active: liveById.get(step.target.id).active,
      versionId: liveById.get(step.target.id).versionId,
      importable_sha256: sha(importableWorkflow(liveById.get(step.target.id)))
    }))
  }, null, 2) + '\n', 'utf8');
  pass('four full backups written before first PUT: ' + backupDir.replace(ROOT, '.'));

  const attempted = [];
  try {
    for (const step of plan) {
      const before = liveById.get(step.target.id);
      attempted.push(before);
      await api('PUT', '/workflows/' + before.id, importableWorkflow(step.candidate));
      const after = await reconcileActivity(before, await api('GET', '/workflows/' + before.id));
      assertScheduleReadback(before, step.candidate, after);
      pass(step.target.key + ': written, read back, graph/settings/credentials/webhooks/activity verified');
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const before of attempted.reverse()) {
      try { await restore(before); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    if (rollbackErrors.length) fail(error.message + ' | ROLLBACK FAILED: ' + rollbackErrors.join(' | '));
    fail(error.message + ' | all attempted workflows rolled back');
  }

  console.log('\nSTARTER SCHEDULE CUTOVER = PASS');
  console.log('BACKUP_DIR=' + backupDir);
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exitCode = 1;
});
