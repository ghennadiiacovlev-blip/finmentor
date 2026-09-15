#!/usr/bin/env node
// FINMENTOR V1 C3 - controlled, no-op production UAT.
//
//   node scripts/c3-controlled-uat.mjs --dry-run
//   node scripts/c3-controlled-uat.mjs --confirm
//
// Confirm creates a fresh-live-derived X-Ray clone with success retention enabled plus
// one short-lived webhook caller. Production X-Ray intentionally retains no execution data, so the
// clone is the only way to prove node-level execution without mutating that live policy. Only the
// unrelated schedule/review webhook triggers are removed so the temporary clone can be published
// without registering production entry points. It receives a cryptographically unique, nonexistent
// synthetic Lead ID, reads live sources, and must stop before AI, data writes, or Telegram. Both
// temporary workflows are deleted in finally.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const XRAY_ID = 'tNSMRoKlFB52vjge';
const INTAKE_ID = 'QmIyEW2ZEqKregmN';
const TEMP_PREFIX = '[TEMP] C3 Targeted No-op UAT ';
const EXPECTED_XRAY_SHA = '75f4d64117955b35291a7979b9f6d14797e7a6dc207d3da27494690c6b4fb2a3';
const REQUIRED_LIVE_NODES = [
  'C3 Lead Intelligence Trigger', 'Validate C3 Lead Target', 'Read Settings', 'Settings to Object',
  'Read XRay_Analysis', 'Read Pipeline', 'Select Pending Leads'
];
const FORBIDDEN_EXECUTED_NODES = [
  'Build Analysis Input', 'AI Financial Analyst', 'Save XRay_Analysis', 'Update Pipeline X-Ray',
  'Telegram Owner Alert'
];
const created = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => { throw new Error(message); };
let checks = 0;
function check(condition, message) {
  if (!condition) fail(message);
  checks++;
  console.log('  PASS  ' + message);
}

async function api(method, path, body, key = method === 'GET' ? READ_KEY : WRITE_KEY) {
  const response = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) fail(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 250));
  return text ? JSON.parse(text) : null;
}

function node(workflow, name) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing ' + name);
  return found;
}

function edge(name) { return { node: name, type: 'main', index: 0 }; }

function copy(value) { return JSON.parse(JSON.stringify(value)); }

function normalise(workflow) {
  const out = {
    name: workflow.name, nodes: copy(workflow.nodes), connections: workflow.connections,
    settings: workflow.settings || {}
  };
  for (const item of out.nodes) if (item.type === 'n8n-nodes-base.telegram') delete item.webhookId;
  return out;
}

function sha(workflow) {
  return createHash('sha256').update(JSON.stringify(normalise(workflow))).digest('hex');
}

function retainedXrayClone(live, token) {
  const removed = new Set(live.nodes
    .filter((item) => ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.webhook'].includes(item.type))
    .map((item) => item.name));
  const connections = copy(live.connections);
  for (const name of removed) delete connections[name];
  return {
    name: TEMP_PREFIX + 'X-Ray clone ' + token.slice(0, 10),
    nodes: copy(live.nodes).filter((item) => !removed.has(item.name)),
    connections,
    settings: Object.assign({}, copy(live.settings || {}), {
      saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all'
    })
  };
}

function harness(path, token, leadId, requestId, targetWorkflowId) {
  const nodes = [
    {
      parameters: { httpMethod: 'POST', path, responseMode: 'onReceived', options: {} },
      id: 'c3-uat-webhook', name: 'C3 Controlled Input', type: 'n8n-nodes-base.webhook',
      typeVersion: 2, position: [0, 0]
    },
    {
      parameters: {
        mode: 'runOnceForAllItems', language: 'javaScript',
        jsCode: [
          '// Fixed no-op target. This ID is random and is asserted absent by the live selector.',
          'return [{ json: {',
          '  event: "AUTHENTICATED_NEW_COMMITTED",',
          '  lead_id: ' + JSON.stringify(leadId) + ',',
          '  request_id: ' + JSON.stringify(requestId) + ',',
          '  source_workflow_id: ' + JSON.stringify(INTAKE_ID) + ',',
          '  c3_uat_token: ' + JSON.stringify(token),
          '} }];'
        ].join('\n')
      },
      id: 'c3-uat-envelope', name: 'Build Fixed C3 Envelope', type: 'n8n-nodes-base.code',
      typeVersion: 2, position: [240, 0]
    },
    {
      parameters: {
        workflowId: { __rl: true, value: targetWorkflowId, mode: 'list', cachedResultName: 'C3 retained X-Ray clone' },
        mode: 'once', options: { waitForSubWorkflow: true }
      },
      id: 'c3-uat-execute', name: 'Execute Live C3 X-Ray', type: 'n8n-nodes-base.executeWorkflow',
      typeVersion: 1.2, position: [480, 0], alwaysOutputData: true
    }
  ];
  return {
    name: TEMP_PREFIX + token.slice(0, 10),
    nodes,
    connections: {
      'C3 Controlled Input': { main: [[edge('Build Fixed C3 Envelope')]] },
      'Build Fixed C3 Envelope': { main: [[edge('Execute Live C3 X-Ray')]] }
    },
    settings: {
      executionOrder: 'v1', saveExecutionProgress: false, saveManualExecutions: false,
      saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all'
    }
  };
}

function runData(execution) {
  return execution.data?.resultData?.runData || {};
}

function output(run, name) {
  return run[name]?.[0]?.data?.main?.[0] || [];
}

async function call(path) {
  const response = await fetch(BASE + '/webhook/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) fail('controlled webhook -> ' + response.status + ' ' + (await response.text()).slice(0, 250));
}

async function findExecution(workflowId, startedAt, predicate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await api('GET', '/executions?workflowId=' + workflowId + '&limit=30');
    for (const row of rows.data.filter((item) => Date.parse(item.startedAt) >= startedAt)) {
      const full = await api('GET', '/executions/' + row.id + '?includeData=true');
      if (predicate(runData(full))) return full;
    }
    await sleep(1500);
  }
  fail('controlled execution evidence not found for ' + workflowId);
}

async function cleanup() {
  let clean = true;
  for (const id of created.splice(0).reverse()) {
    await api('POST', '/workflows/' + id + '/deactivate').catch(() => {});
    let deleted = false;
    for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
      deleted = await api('DELETE', '/workflows/' + id).then(() => true).catch(() => false);
      if (!deleted) await sleep(1200);
    }
    if (!deleted) { clean = false; console.error('  FAIL  temporary workflow not deleted: ' + id); }
  }
  return clean;
}

async function main() {
  if (!DRY && !CONFIRM) fail('use --dry-run or explicitly pass --confirm');
  if (!BASE || !READ_KEY || (!DRY && !WRITE_KEY)) fail('missing n8n API environment');
  console.log('FINMENTOR C3 - CONTROLLED TARGETED NO-OP UAT');
  console.log(DRY ? 'MODE: DRY RUN (read-only)' : 'MODE: LIVE (two disposable workflows, zero messages)');

  const live = await api('GET', '/workflows/' + XRAY_ID);
  check(live.active === true, 'live X-Ray is active');
  check(sha(live) === EXPECTED_XRAY_SHA, 'live X-Ray is the exact deployed C3 candidate');
  for (const name of REQUIRED_LIVE_NODES) check(Boolean(node(live, name)), 'live X-Ray contains ' + name);
  check(node(live, 'Telegram Owner Alert').parameters.chatId.includes('owner_chat_id'), 'live X-Ray Telegram transport is owner-only');
  if (DRY) {
    console.log('\nC3 CONTROLLED UAT DRY RUN PASS - zero workflow writes and zero messages.');
    return;
  }

  const token = randomUUID().replace(/-/g, '');
  const leadId = 'FIN-C3-UAT-NONEXISTENT-' + token;
  const requestId = 'C3-UAT-' + token;
  const path = 'c3-uat-target-' + token;
  const startedAt = Date.now() - 1000;
  let clean = false;
  let evidence;
  try {
    const cloned = await api('POST', '/workflows', retainedXrayClone(live, token));
    created.push(cloned.id);
    check(cloned.active !== true, 'retained X-Ray clone is inactive');
    await api('POST', '/workflows/' + cloned.id + '/activate');
    check(true, 'trigger-safe retained X-Ray clone is published');
    const made = await api('POST', '/workflows', harness(path, token, leadId, requestId, cloned.id));
    created.push(made.id);
    await api('POST', '/workflows/' + made.id + '/activate');
    await sleep(2400);
    await call(path);

    const child = await findExecution(cloned.id, startedAt, (run) =>
      output(run, 'Validate C3 Lead Target').some((item) => item.json?.c3_request_id === requestId));
    const childRun = runData(child);
    check(child.status === 'success', 'live-derived targeted X-Ray execution succeeded');
    for (const name of REQUIRED_LIVE_NODES) check(Boolean(childRun[name]?.length), 'live-derived execution reached ' + name);
    check(output(childRun, 'Validate C3 Lead Target')[0]?.json?.c3_target_lead_id === leadId,
      'live-derived validator retained the exact synthetic Lead ID');
    check(output(childRun, 'Select Pending Leads').length === 0,
      'nonexistent exact target selected zero Pipeline rows');
    for (const name of FORBIDDEN_EXECUTED_NODES) check(!childRun[name]?.length, 'live no-op did not execute ' + name);

    const parent = await findExecution(made.id, startedAt, (run) =>
      output(run, 'Build Fixed C3 Envelope').some((item) => item.json?.request_id === requestId));
    check(parent.status === 'success', 'disposable caller execution succeeded');
    evidence = {
      verified_at: new Date().toISOString(), child_execution_id: String(child.id),
      caller_execution_id: String(parent.id), synthetic_lead_id: leadId,
      live_xray_sha256: EXPECTED_XRAY_SHA, executed_live_derived_clone: true,
      selected_rows: 0, forbidden_nodes_executed: [], owner_messages: 0, client_messages: 0
    };
  } finally {
    clean = await cleanup();
  }

  check(clean, 'temporary C3 caller workflow was removed');
  const inventory = await api('GET', '/workflows?limit=250');
  const remaining = inventory.data.filter((item) => String(item.name || '').startsWith(TEMP_PREFIX));
  check(remaining.length === 0, 'tenant contains zero temporary C3 UAT workflows');
  evidence.temporary_workflows_remaining = remaining.length;
  evidence.checks = checks;
  mkdirSync(join(ROOT, '.uat', 'c3-final-closure'), { recursive: true });
  const artifact = join(ROOT, '.uat', 'c3-final-closure',
    'controlled-noop-verified-' + evidence.verified_at.replace(/[:.]/g, '-') + '.json');
  writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log('\nC3 CONTROLLED TARGETED NO-OP UAT PASS - ' + checks + ' checks, 0 failures.');
  console.log('OWNER MESSAGES = 0; CLIENT MESSAGES = 0; DATA WRITES = 0');
  console.log('Evidence: ' + artifact);
}

main().catch(async (error) => {
  if (created.length) await cleanup().catch(() => {});
  console.error('\nC3 CONTROLLED TARGETED NO-OP UAT FAIL - ' + error.message);
  process.exit(1);
});
