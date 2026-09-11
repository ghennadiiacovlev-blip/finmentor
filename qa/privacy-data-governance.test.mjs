#!/usr/bin/env node
// FINMENTOR C4.11 — offline Privacy & Data Governance v1 contract.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BASE_SHA, PLAN_PATH, RETENTION_SETTINGS, TARGET_WORKFLOWS,
  RetentionDeploymentError, applyRetentionSettings, assertDeploymentReadback,
  assertSettingsOnly, buildPlan, precheckRetentionWorkflow,
  runRetentionDeployment, workflowFingerprints, workflowUpdatePayload, writeBackupArtifacts
} from '../scripts/deploy-c4-11-retention-settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const privacyRecord = require('../n8n/src/premium-ux/privacy-record.js');
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const helperSource = read('scripts/deploy-c4-11-retention-settings.mjs');
const governance = read('docs/PRIVACY_DATA_GOVERNANCE_V1.md');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('  FAIL  ' + name + ' -> ' + error.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('  FAIL  ' + name + ' -> ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (actual !== expected) throw new Error(message + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
};

console.log('C4.11 — Privacy & Data Governance v1');
console.log('');

check('retention plan has the canonical control id', () => eq(plan.control, 'FINMENTOR_C4_11_EXECUTION_RETENTION', 'control'));
check('retention plan is pinned to the C4.11 base SHA', () => eq(BASE_SHA, 'a1e6667a8245d25b349b0f35571655916d449aaa', 'base SHA'));
check('retention plan records that deployment is not authorised', () => eq(plan.deployment_authorised, false, 'authorisation'));
check('retention mutation scope is workflow.settings only', () => eq(plan.mutation_scope, 'workflow.settings only', 'scope'));
check('the approved target set contains exactly eight workflows', () => eq(TARGET_WORKFLOWS.length, 8, 'target count'));
check('every target workflow id is unique', () => eq(new Set(TARGET_WORKFLOWS.map((x) => x.id)).size, 8, 'unique ids'));
check('the target ids equal the approved production set', () => {
  eq(TARGET_WORKFLOWS.map((x) => x.id).join(','), [
    'QmIyEW2ZEqKregmN', 'mppzthlkSJFr6Kle', 'ShcmmJeLSE8LYVBk', 'LZ2mvKXbBikmeVTn',
    'imeJIDeNyaWDyXzh', 'zeLOCuf0K1bkaKl2', 'qF9tonlHHIxc8MDd', 'tNSMRoKlFB52vjge'
  ].join(','), 'target ids');
});
check('the four execution-payload settings are fail-closed', () => {
  eq(JSON.stringify(RETENTION_SETTINGS), JSON.stringify({
    saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none',
    saveManualExecutions: false, saveExecutionProgress: false
  }), 'settings');
});
check('the generated plan requires atomic precheck backup readback and rollback', () => {
  const protocol = plan.deployment_protocol || {};
  eq(protocol.all_target_precheck_before_write, true, 'all-target precheck');
  eq(protocol.readback_after_each_write, true, 'readback');
  eq(protocol.automatic_rollback, true, 'rollback');
  eq(protocol.rollback_order, 'reverse', 'rollback order');
  eq(protocol.rollback_readback_required, true, 'rollback readback');
  eq(protocol.partial_success_allowed, false, 'partial success');
  assert(/\.uat\/c4-11-retention-backups/.test(protocol.timestamped_backups_before_write || ''), 'backup location missing');
});
check('known production snapshots match the guarded exact target names', () => {
  const files = readdirSync(join(ROOT, 'n8n', 'production'));
  for (const target of TARGET_WORKFLOWS.filter((x) => x.id !== 'tNSMRoKlFB52vjge')) {
    const filename = files.find((name) => name.startsWith(target.id + '.'));
    assert(filename, 'snapshot missing for ' + target.id);
    const snapshot = JSON.parse(read('n8n/production/' + filename));
    eq(snapshot.name, target.name, target.id + ' exact name');
  }
});
check('the X-Ray exact target name matches its deployment record', () => {
  eq(TARGET_WORKFLOWS.find((x) => x.id === 'tNSMRoKlFB52vjge').name, 'FINMENTOR X-Ray Analysis', 'X-Ray name');
  assert(/FINMENTOR X-Ray Analysis/.test(read('docs/C1_XRAY_ANALYSIS_DEPLOYMENT.md')), 'deployment record drift');
});
check('checked-in retention plan is generated and not stale', () => eq(JSON.stringify(plan), JSON.stringify(buildPlan()), 'plan drift'));
check('default helper mode writes only the offline plan', () => {
  assert(/if \(process\.argv\.includes\('--deploy'\)\)[\s\S]*else if \(process\.argv\.includes\('--audit-live'\)\)[\s\S]*writeFileSync\(PLAN_PATH/.test(helperSource), 'main-mode guard drift');
});
check('live audit mode is read-only', () => {
  const block = /async function auditLive\(\) \{([\s\S]*?)\n\}/.exec(helperSource);
  assert(block && /'GET'/.test(block[1]), 'audit GET missing');
  assert(!/'PUT'|'POST'|'DELETE'/.test(block[1]), 'audit contains a write method');
});
check('deployment requires an explicit settings-only confirmation', () => assert(/C4_11_RETENTION_CONFIRM[^\n]+SETTINGS_ONLY/.test(helperSource), 'confirmation guard missing'));
check('deployment separates read and write API keys', () => assert(/const readKey = process\.env\.N8N_API_KEY;[\s\S]*const writeKey = process\.env\.N8N_FIX_API_KEY;/.test(helperSource), 'key separation missing'));

const fixture = {
  id: TARGET_WORKFLOWS[0].id, name: TARGET_WORKFLOWS[0].name, active: true,
  nodes: [{ id: 'n1', credentials: { headerAuth: { id: 'cred-1' } } }],
  connections: { n1: { main: [[]] } }, staticData: { lastId: 7 },
  settings: { executionOrder: 'v1', saveDataSuccessExecution: 'all' }
};
const applied = applyRetentionSettings(fixture, TARGET_WORKFLOWS[0]);
check('unknown workflows are rejected', () => {
  let threw = false; try { applyRetentionSettings({ id: 'unknown', name: 'unknown' }); } catch { threw = true; }
  assert(threw, 'unknown workflow accepted');
});
check('workflow id mismatch is rejected', () => {
  let threw = false; try { applyRetentionSettings({ ...fixture, id: 'wrong' }, TARGET_WORKFLOWS[0]); } catch { threw = true; }
  assert(threw, 'id mismatch accepted');
});
check('workflow name mismatch is rejected', () => {
  let threw = false; try { applyRetentionSettings({ ...fixture, name: 'friendly label' }, TARGET_WORKFLOWS[0]); } catch { threw = true; }
  assert(threw, 'name mismatch accepted');
});
check('settings application deep-clones the workflow', () => assert(applied !== fixture && applied.nodes !== fixture.nodes, 'input object reused'));
check('settings application preserves id name and active state', () => {
  for (const key of ['id', 'name', 'active']) eq(applied[key], fixture[key], key);
});
check('settings application preserves nodes and connections byte-for-byte', () => {
  eq(JSON.stringify(applied.nodes), JSON.stringify(fixture.nodes), 'nodes');
  eq(JSON.stringify(applied.connections), JSON.stringify(fixture.connections), 'connections');
});
check('settings application preserves staticData', () => eq(JSON.stringify(applied.staticData), JSON.stringify(fixture.staticData), 'staticData'));
check('settings application preserves unrelated settings', () => eq(applied.settings.executionOrder, 'v1', 'executionOrder'));
check('settings application lands all four retention values', () => {
  for (const [key, value] of Object.entries(RETENTION_SETTINGS)) eq(applied.settings[key], value, key);
});
check('graph mutation is detected by the invariant checker', () => {
  let threw = false; try { assertSettingsOnly(fixture, { ...applied, nodes: [] }); } catch { threw = true; }
  assert(threw, 'graph mutation accepted');
});
check('unrelated setting mutation is detected by the invariant checker', () => {
  let threw = false; try { assertSettingsOnly(fixture, { ...applied, settings: { ...applied.settings, timezone: 'UTC' } }); } catch { threw = true; }
  assert(threw, 'unrelated setting accepted');
});

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const liveSnapshot = (target, index) => ({
  id: target.id,
  name: target.name,
  active: index % 2 === 0,
  nodes: [{
    id: 'node-' + index,
    name: 'Node ' + index,
    type: 'n8n-nodes-base.noOp',
    credentials: { headerAuth: { id: 'credential-' + index, name: 'Credential ' + index } }
  }],
  connections: { ['Node ' + index]: { main: [[]] } },
  staticData: { lastExecution: index },
  settings: {
    executionOrder: 'v1', timezone: 'Europe/Chisinau', callerPolicy: 'workflowsFromSameOwner',
    saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all',
    saveManualExecutions: true, saveExecutionProgress: true
  },
  versionId: 'version-' + index
});

function deploymentSimulation(options = {}) {
  const originals = new Map(TARGET_WORKFLOWS.map((target, index) => [target.id, liveSnapshot(target, index)]));
  const state = new Map([...originals].map(([id, workflow]) => [id, deepClone(workflow)]));
  const operations = [];
  let backups = null;

  const applyPayload = (target, body) => {
    const current = state.get(target.id);
    state.set(target.id, Object.assign({}, current, {
      name: body.name,
      nodes: deepClone(body.nodes),
      connections: deepClone(body.connections),
      settings: deepClone(body.settings)
    }));
  };

  const request = async (operation) => {
    const targetIndex = TARGET_WORKFLOWS.findIndex((target) => target.id === operation.target.id);
    operations.push({
      phase: operation.phase, method: operation.method, id: operation.target.id,
      body: operation.body ? deepClone(operation.body) : null
    });

    if (operation.phase === 'precheck') {
      if (options.precheckFailureAt === targetIndex) throw new Error('simulated precheck failure ' + targetIndex);
      return deepClone(state.get(operation.target.id));
    }
    if (operation.phase === 'forward-write') {
      applyPayload(operation.target, operation.body);
      if (options.putFailureAt === targetIndex) throw new Error('simulated uncertain PUT failure ' + targetIndex);
      return { ok: true };
    }
    if (operation.phase === 'forward-readback') {
      if (options.readbackFailureAt === targetIndex) throw new Error('simulated readback failure ' + targetIndex);
      return deepClone(state.get(operation.target.id));
    }
    if (operation.phase === 'forward-guard') return deepClone(state.get(operation.target.id));
    if (operation.phase === 'rollback-write') {
      if (options.rollbackFailureAt === targetIndex) throw new Error('simulated rollback write failure ' + targetIndex);
      applyPayload(operation.target, operation.body);
      return { ok: true };
    }
    if (operation.phase === 'rollback-active') {
      const current = state.get(operation.target.id);
      current.active = /\/activate$/.test(operation.path);
      return { ok: true };
    }
    if (operation.phase === 'rollback-readback') return deepClone(state.get(operation.target.id));
    throw new Error('unexpected simulated operation ' + operation.phase);
  };

  const backupWriter = async (prechecks) => {
    backups = deepClone(prechecks);
    operations.push({ phase: 'backup', method: 'LOCAL_BACKUP', ids: prechecks.map((entry) => entry.target.id) });
    return { directory: 'memory://c4-11-backup', files: prechecks.map((entry) => entry.target.id + '.json') };
  };
  return { originals, state, operations, request, backupWriter, getBackups: () => backups };
}

async function failedDeployment(simulation) {
  try {
    await runRetentionDeployment({ request: simulation.request, backupWriter: simulation.backupWriter });
    throw new Error('deployment unexpectedly succeeded');
  } catch (error) {
    if (!(error instanceof RetentionDeploymentError)) throw error;
    return error;
  }
}

check('before fingerprints cover graph active staticData credentials and unrelated settings', () => {
  const fingerprints = workflowFingerprints(liveSnapshot(TARGET_WORKFLOWS[0], 0));
  eq(Object.keys(fingerprints).sort().join(','),
    ['active', 'connections', 'credentials', 'nodes', 'staticData', 'unrelatedSettings'].sort().join(','),
    'fingerprint fields');
  for (const [key, value] of Object.entries(fingerprints)) assert(/^[0-9a-f]{64}$/.test(value), key + ' fingerprint missing');
});

check('post-write readback rejects drift in every protected workflow facet', () => {
  const target = TARGET_WORKFLOWS[0];
  const before = liveSnapshot(target, 0);
  const clean = applyRetentionSettings(before, target);
  const mutations = [
    ['active', { ...clean, active: !clean.active }],
    ['nodes', { ...clean, nodes: [] }],
    ['connections', { ...clean, connections: { drift: true } }],
    ['staticData', { ...clean, staticData: { drift: true } }],
    ['credentials', { ...clean, nodes: [{ ...clean.nodes[0], credentials: { changed: { id: 'other' } } }] }],
    ['unrelated settings', { ...clean, settings: { ...clean.settings, timezone: 'UTC' } }]
  ];
  for (const [label, changed] of mutations) {
    let threw = false; try { assertDeploymentReadback(before, changed, target); } catch { threw = true; }
    assert(threw, label + ' drift passed readback');
  }
});

await checkAsync('timestamped backups contain all eight exact snapshots and never overwrite', async () => {
  const prepared = TARGET_WORKFLOWS.map((target, index) => precheckRetentionWorkflow(liveSnapshot(target, index), target));
  const temporary = mkdtempSync(join(tmpdir(), 'finmentor-c4-11-backup-'));
  const backupRoot = join(temporary, 'backups');
  const now = new Date('2026-09-11T12:34:56.789Z');
  try {
    const written = writeBackupArtifacts(prepared, { backupRoot, now });
    assert(/2026-09-11T12-34-56-789Z$/.test(written.directory), 'timestamped directory missing');
    eq(written.files.length, 9, 'eight backups plus manifest');
    const names = readdirSync(written.directory);
    eq(names.length, 9, 'backup file count');
    for (let index = 0; index < TARGET_WORKFLOWS.length; index++) {
      const file = names.find((name) => name.endsWith(TARGET_WORKFLOWS[index].id + '.json'));
      assert(file, 'target backup missing: ' + TARGET_WORKFLOWS[index].id);
      const record = JSON.parse(readFileSync(join(written.directory, file), 'utf8'));
      eq(JSON.stringify(record.before), JSON.stringify(prepared[index].before), 'exact before snapshot');
      eq(JSON.stringify(record.before_fingerprints), JSON.stringify(prepared[index].fingerprints), 'fingerprints');
      eq(JSON.stringify(record.restore.workflow_update_payload), JSON.stringify(workflowUpdatePayload(prepared[index].before)), 'restore payload');
      eq(record.restore.active, prepared[index].before.active, 'restore active state');
    }
    let overwriteRefused = false;
    try { writeBackupArtifacts(prepared, { backupRoot, now }); } catch { overwriteRefused = true; }
    assert(overwriteRefused, 'an existing timestamped backup was overwritten');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

for (let failureIndex = 0; failureIndex < TARGET_WORKFLOWS.length; failureIndex++) {
  await checkAsync('preflight failure on target #' + (failureIndex + 1) + ' causes zero PUT operations', async () => {
    const simulation = deploymentSimulation({ precheckFailureAt: failureIndex });
    const error = await failedDeployment(simulation);
    eq(simulation.operations.filter((operation) => operation.method === 'PUT').length, 0, 'PUT count');
    eq(error.report.forwardAttempted.length, 0, 'forward attempts');
    eq(error.report.deploymentStatus, 'BLOCKED', 'status');
  });
}

await checkAsync('all eight GET prechecks and all backups complete before the first PUT', async () => {
  const simulation = deploymentSimulation();
  await runRetentionDeployment({ request: simulation.request, backupWriter: simulation.backupWriter });
  const firstPut = simulation.operations.findIndex((operation) => operation.method === 'PUT');
  assert(firstPut > 0, 'no forward PUT observed');
  eq(simulation.operations.slice(0, firstPut).filter((operation) => operation.phase === 'precheck').length, 8, 'prechecks before PUT');
  const backupIndex = simulation.operations.findIndex((operation) => operation.phase === 'backup');
  assert(backupIndex > 7 && backupIndex < firstPut, 'backup did not complete between precheck and PUT');
  eq(simulation.getBackups().length, 8, 'backed-up targets');
});

await checkAsync('successful simulation writes four settings to all eight with immediate readback', async () => {
  const simulation = deploymentSimulation();
  const report = await runRetentionDeployment({ request: simulation.request, backupWriter: simulation.backupWriter });
  eq(report.deploymentStatus, 'PASS', 'deployment status');
  eq(report.forwardCompleted.length, 8, 'completed targets');
  eq(simulation.operations.filter((operation) => operation.phase === 'forward-guard').length, 8, 'fresh guards');
  const forward = simulation.operations.filter((operation) => /^(forward-write|forward-readback)$/.test(operation.phase));
  for (let index = 0; index < TARGET_WORKFLOWS.length; index++) {
    eq(forward[index * 2].phase, 'forward-write', 'write order ' + index);
    eq(forward[index * 2 + 1].phase, 'forward-readback', 'readback order ' + index);
    const target = TARGET_WORKFLOWS[index];
    const before = simulation.originals.get(target.id);
    const after = simulation.state.get(target.id);
    const changed = Object.keys(after.settings).filter((key) => JSON.stringify(after.settings[key]) !== JSON.stringify(before.settings[key])).sort();
    eq(changed.join(','), Object.keys(RETENTION_SETTINGS).sort().join(','), 'changed settings ' + target.id);
    assertDeploymentReadback(before, after, target);
  }
});

await checkAsync('an uncertain PUT failure rolls back every attempted target in reverse order', async () => {
  const simulation = deploymentSimulation({ putFailureAt: 3 });
  const error = await failedDeployment(simulation);
  eq(error.report.rollbackStatus, 'PASS', 'rollback status');
  eq(error.report.deploymentStatus, 'BLOCKED', 'deployment status');
  const rollbackOrder = simulation.operations.filter((operation) => operation.phase === 'rollback-write').map((operation) => operation.id);
  eq(rollbackOrder.join(','), TARGET_WORKFLOWS.slice(0, 4).reverse().map((target) => target.id).join(','), 'rollback order');
  eq(simulation.operations.filter((operation) => operation.phase === 'rollback-readback').length, 4, 'rollback readbacks');
  for (const target of TARGET_WORKFLOWS) {
    eq(JSON.stringify(simulation.state.get(target.id)), JSON.stringify(simulation.originals.get(target.id)), 'exact restore ' + target.id);
  }
});

await checkAsync('a readback failure rolls back the failed target and every prior target exactly', async () => {
  const simulation = deploymentSimulation({ readbackFailureAt: 4 });
  const error = await failedDeployment(simulation);
  eq(error.report.rollbackStatus, 'PASS', 'rollback status');
  eq(error.report.rolledBack.length, 5, 'rolled-back count');
  assert(/DEPLOYMENT STATUS = BLOCKED/.test(error.message), 'partial deployment was reported as pass');
  for (const target of TARGET_WORKFLOWS) {
    eq(JSON.stringify(simulation.state.get(target.id)), JSON.stringify(simulation.originals.get(target.id)), 'exact restore ' + target.id);
  }
});

await checkAsync('rollback failure is BLOCKED and requires manual intervention', async () => {
  const simulation = deploymentSimulation({ readbackFailureAt: 2, rollbackFailureAt: 1 });
  const error = await failedDeployment(simulation);
  eq(error.report.deploymentStatus, 'BLOCKED', 'deployment status');
  eq(error.report.rollbackStatus, 'FAILED', 'rollback status');
  eq(error.report.manualInterventionRequired, true, 'manual intervention flag');
  assert(error.report.rollbackFailures.some((failure) => failure.id === TARGET_WORKFLOWS[1].id), 'failed target is not surfaced');
  assert(/BLOCKED \/ MANUAL INTERVENTION REQUIRED/.test(error.message), 'manual intervention status missing');
});

check('governance artifact records the exact privacy owner and contact', () => assert(/Iacovlev Ghennadi[\s\S]*cfo@finmentor\.md/.test(governance), 'owner/contact missing'));
check('governance artifact carries the canonical notice version', () => assert(/pn-2026-09-11\.v1/.test(governance), 'version missing'));
check('ROPA matrix covers purposes stores recipients retention basis deletion and risk', () => {
  for (const token of ['PURPOSE', 'STORE', 'PROCESSOR / RECIPIENT', 'RETENTION', 'LEGAL BASIS', 'DELETE METHOD', 'RISK']) assert(governance.includes(token), token + ' column missing');
});
check('retention schedule distinguishes 72 hours 12 months and three years', () => {
  assert(/72 hours/.test(governance) && /12 months/.test(governance) && /3 years/.test(governance), 'retention layers missing');
});
check('processor register covers every current provider category', () => {
  for (const provider of ['GitHub / GitHub Pages', 'n8n Cloud', 'Google (Sheets, Analytics, Fonts)', 'Supabase', 'Telegram', 'OpenAI API', 'Email service provider']) assert(governance.includes('| ' + provider + ' |'), provider + ' missing');
});
check('transfer register separates verified facts from evidence gaps', () => assert(/VERIFIED location \/ TO VERIFY contract evidence/.test(governance) && /No SCC\/adequacy claim recorded/.test(governance), 'transfer evidence status missing'));
check('DSAR procedure states proportionate identity verification and the one-month deadline', () => assert(/one-month deadline/.test(governance) && /Verify identity proportionately/.test(governance) && /minimum verified identifiers/.test(governance), 'DSAR control missing'));
check('deletion procedure includes inventory exceptions processors and independent verification', () => {
  for (const token of ['deletion inventory', 'mandatory exception', 'processor-side deletion', 'Independently verify absence']) assert(governance.includes(token), token + ' missing');
});
check('incident procedure starts at awareness and carries the 72-hour clock', () => assert(/T\+0 awareness/.test(governance) && /By 72 hours from awareness/.test(governance), 'incident clock missing'));
check('DPIA verdict is scoped and has mandatory reassessment triggers', () => assert(/FORMAL MANDATORY DPIA TRIGGER = NOT ESTABLISHED AT CURRENT SCALE/.test(governance) && /reassessment triggers/.test(governance), 'DPIA scope missing'));
check('DPO conclusion is limited to current scale', () => assert(/Formal DPO[\s\S]*Not required for current FINMENTOR v1 scale/.test(governance), 'DPO scope missing'));
check('access review covers least privilege MFA credentials and RLS', () => {
  for (const token of ['least privilege', 'MFA', 'credential', 'RLS']) assert(governance.includes(token), token + ' missing');
});
check('C4.11 explicitly authorises no production deployment cleanup schema change or backfill', () => assert(/does not authorise production deletion, schema mutation, backfill or deployment/.test(governance), 'scope boundary missing'));
check('historical acknowledgements are preserved without rewrite or backfill', () => assert(/Historical acknowledgements[\s\S]*No C4\.11 update\/backfill/.test(governance), 'historical boundary missing'));
check('both public policies expose the same canonical immutable version', () => {
  for (const file of ['privacy.html', 'ro/privacy.html']) {
    const html = read(file); assert(/data-privacy-notice-version="pn-2026-09-11\.v1"/.test(html), file + ' version missing');
  }
});
check('public RU policy exposes no internal legal-basis enum', () => {
  assert(!/pre_contractual_request|legitimate_interest_security/.test(read('privacy.html')), 'RU machine enum exposed');
});
check('public RO policy exposes no internal legal-basis enum', () => {
  assert(!/pre_contractual_request|legitimate_interest_security/.test(read('ro/privacy.html')), 'RO machine enum exposed');
});
check('server-side privacy record still stores pre_contractual_request', () => {
  const result = privacyRecord.buildPrivacyRecord({
    submissionKey: 'sub_' + 'a'.repeat(32),
    ack: {
      notice_version: 'pn-2026-09-11.v1', locale: 'ru',
      shown_at: '2026-09-11T10:00:00.000Z', acknowledged_at: '2026-09-11T10:00:01.000Z'
    }
  });
  eq(result.ok, true, 'record validity');
  eq(result.record.privacy_legal_basis, 'pre_contractual_request', 'stored basis');
});
check('both public policies cover AI human review rights retention transfers and complaint', () => {
  for (const file of ['privacy.html', 'ro/privacy.html']) {
    const html = read(file);
    for (const token of ['Financial X-Ray', '72', '12', 'CNPDCP', 'cfo@finmentor.md']) assert(html.includes(token), file + ' missing ' + token);
  }
});
check('generated Mini App bundle carries the canonical notice version', () => assert(/window\.FM_NOTICE_VERSION = "pn-2026-09-11\.v1"/.test(read('app-premium/content.js')), 'bundle version drift'));
check('submit candidate uses the new version and purpose-specific basis only', () => {
  const source = read('n8n/candidate/premium-submit-endpoint-candidate.json');
  assert(source.includes('pn-2026-09-11.v1') && source.includes('pre_contractual_request'), 'new acknowledgement contract missing');
  assert(!source.includes('PENDING_LEGAL_REVIEW'), 'pending sentinel survives');
});
check('analytics persists attribution only after consent and clears it on denial', () => {
  const source = read('analytics.js');
  assert(/function captureAttribution\(\) \{\n    if \(getChoice\(\) !== 'accept'\) return false;/.test(source), 'pre-consent guard missing');
  assert(/else \{[\s\S]*clearAttribution\(\);/.test(source), 'denial cleanup missing');
});
check('owner intelligence alerts select at most one reachable contact', () => {
  const source = read('n8n/src/lead-intelligence/alert.js');
  assert(/const selected = reachable\.find/.test(source), 'single-contact selector missing');
  assert(!/reachable\.slice\(0, 3\)/.test(source), 'contact directory rendering survives');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((failure) => console.log('  - ' + failure));
  console.log('ASSERTIONS: ' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + passed + ' passed');
