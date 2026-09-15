#!/usr/bin/env node
// FINMENTOR V1 C2 — controlled, non-customer production UAT.
//
//   node scripts/c2-controlled-uat.mjs --dry-run
//   node scripts/c2-controlled-uat.mjs --confirm
//
// The confirm run creates short-lived webhook harnesses, sends only synthetic owner alerts,
// exercises SYSTEM ALERT persisted transitions, and deletes every harness in a finally block.
// It does not read or write Pipeline rows and contains no client Telegram destination.

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
const VERIFY_AT = process.argv.indexOf('--verify-executions');
const VERIFY_IDS = VERIFY_AT >= 0 ? String(process.argv[VERIFY_AT + 1] || '').split(',').filter(Boolean) : [];
const IDS = {
  sla: 'LZ2mvKXbBikmeVTn', followup: 'zeLOCuf0K1bkaKl2',
  system: 'ID700kTo6EXffwry', command: 'qF9tonlHHIxc8MDd'
};
const SETTINGS = {
  executionOrder: 'v1', saveExecutionProgress: false, saveManualExecutions: false,
  saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all'
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const created = [];
let checks = 0;
const check = (condition, message) => {
  if (!condition) fail(message);
  checks++;
  pass(message);
};

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

const sourceNode = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing live node ' + name);
  return clone(found);
};

function webhookNode(path) {
  return {
    parameters: { httpMethod: 'POST', path, responseMode: 'responseNode', options: {} },
    id: 'c2-webhook', name: 'C2 Controlled Input', type: 'n8n-nodes-base.webhook',
    typeVersion: 2, position: [0, 0]
  };
}

function codeNode(name, id, code, x) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: code },
    id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, 0]
  };
}

function respondNode(x) {
  return {
    parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: { responseCode: 200 } },
    id: 'c2-respond', name: 'Return Safe Evidence', type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.4, position: [x, 0]
  };
}

function line(from, to) {
  return { [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } };
}

function keyboardHarness(kind, workflow, path) {
  const isSla = kind === 'sla';
  const builderName = isSla ? 'Build SLA Alert Keyboard' : 'Build Followup Alert Keyboard';
  const senderName = isSla ? 'Telegram SLA Alert' : 'Telegram Followup Reminder';
  const leadId = 'FIN-C2-UAT-' + (isSla ? 'SLA' : 'FOLLOWUP');
  const nodes = [
    webhookNode(path),
    Object.assign(sourceNode(workflow, 'Read Settings'), { position: [220, 0] }),
    Object.assign(sourceNode(workflow, 'Settings to Object'), { position: [440, 0] }),
    codeNode('Build Synthetic Owner Alert', 'c2-synthetic-alert', [
      '// Fixed non-customer evidence. No Pipeline node exists in this disposable workflow.',
      'return [{ json: {',
      '  lead_id: ' + JSON.stringify(leadId) + ',',
      '  deal_stage: "New", sla_status: "Open",',
      '  alert_html: "<b>C2 CONTROLLED ' + (isSla ? 'SLA' : 'FOLLOW-UP') + ' TEST</b>\\nSynthetic owner-only alert. No customer data."',
      '} }];'
    ].join('\n'), 660),
    Object.assign(sourceNode(workflow, builderName), { position: [880, 0] }),
    Object.assign(sourceNode(workflow, senderName), { position: [1100, 0] }),
    codeNode('Inspect Telegram Result', 'c2-inspect-telegram', [
      'const before = $(' + JSON.stringify(builderName) + ').first().json || {};',
      'const raw = $input.first().json || {};',
      'const msg = raw.result && typeof raw.result === "object" ? raw.result : raw;',
      'const requested = Array.isArray(before.kb) ? before.kb.flat() : [];',
      'const rendered = msg.reply_markup && Array.isArray(msg.reply_markup.inline_keyboard) ? msg.reply_markup.inline_keyboard.flat() : [];',
      'return [{ json: {',
      '  delivered: Boolean(msg.message_id),',
      '  text_rendered: String(msg.text || "").includes("C2 CONTROLLED"),',
      '  kb_shape: String(before.kb_shape || ""),',
      '  requested_callbacks: requested.map(b => String(b.callback_data || "")),',
      '  rendered_callbacks: rendered.map(b => String(b.callback_data || ""))',
      '} }];'
    ].join('\n'), 1320),
    respondNode(1540)
  ];
  delete nodes[5].webhookId;
  const order = ['C2 Controlled Input', 'Read Settings', 'Settings to Object', 'Build Synthetic Owner Alert',
    builderName, senderName, 'Inspect Telegram Result', 'Return Safe Evidence'];
  const connections = {};
  for (let i = 0; i < order.length - 1; i++) Object.assign(connections, line(order[i], order[i + 1]));
  return { name: '[TEMP] C2 ' + (isSla ? 'SLA' : 'Follow-up') + ' keyboard UAT', nodes, connections, settings: SETTINGS };
}

function systemHarness(path, routeIdentity, warningFingerprint) {
  const buildCode = [
    'const body = ($input.first().json || {}).body || {};',
    'const phase = String(body.phase || "");',
    'const at = new Date().toISOString();',
    'const failure = { event_type: "failure", workflow_key: "lead-intake", verdict_node: "CRM Unavailable",',
    '  error_code: "C2_CONTROLLED_FAILURE", retryable: true, route_identity: ' + JSON.stringify(routeIdentity) + ', occurred_at: at };',
    'const recovery = { event_type: "recovery_probe", proof_key: "daily-digest:crm-read", occurred_at: at };',
    'const wrong = { event_type: "recovery_probe", proof_key: "c2:not-authoritative", occurred_at: at };',
    'const warning = { event_type: "data_warning", check_key: "daily-digest:required-lead-data",',
    '  fingerprint: ' + JSON.stringify(warningFingerprint) + ', occurred_at: at,',
    '  missing_required_contact_count: 1, missing_next_action_count: 2, expired_snooze_count: 0 };',
    'const clear = { event_type: "data_warning", check_key: "daily-digest:required-lead-data",',
    '  fingerprint: "", occurred_at: at, missing_required_contact_count: 0, missing_next_action_count: 0, expired_snooze_count: 0 };',
    'const event = ({ pre_recovery: recovery, failure, wrong_recovery: wrong, recovery, recovery_repeat: recovery,',
    '  warning, warning_repeat: warning, warning_clear: clear })[phase];',
    'if (!event) throw new Error("unknown controlled phase");',
    'return [{ json: event }];'
  ].join('\n');
  const inspectCode = [
    'const raw = $input.first().json || {};',
    'const msg = raw.result && typeof raw.result === "object" ? raw.result : raw;',
    'const text = String(msg.text || "");',
    'return [{ json: {',
    '  delivered: Boolean(msg.message_id), alerted: Number(raw.alerted || 0),',
    '  silent_reason: String(raw.silent_reason || ""),',
    '  is_system_failure: text.includes("C2_CONTROLLED_FAILURE"),',
    '  is_recovered: text.includes("Система восстановлена"),',
    '  is_data_warning: text.includes("Целостность данных")',
    '} }];'
  ].join('\n');
  const execute = {
    parameters: {
      workflowId: { __rl: true, value: IDS.system, mode: 'list', cachedResultName: 'FINMENTOR SYSTEM ALERT' },
      mode: 'once', options: { waitForSubWorkflow: true }
    },
    id: 'c2-execute-system', name: 'Execute SYSTEM ALERT', type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2, position: [440, 0]
  };
  const nodes = [webhookNode(path), codeNode('Build Controlled Event', 'c2-build-event', buildCode, 220),
    execute, codeNode('Inspect SYSTEM ALERT Result', 'c2-inspect-system', inspectCode, 660), respondNode(880)];
  const order = ['C2 Controlled Input', 'Build Controlled Event', 'Execute SYSTEM ALERT',
    'Inspect SYSTEM ALERT Result', 'Return Safe Evidence'];
  const connections = {};
  for (let i = 0; i < order.length - 1; i++) Object.assign(connections, line(order[i], order[i + 1]));
  return { name: '[TEMP] C2 SYSTEM ALERT state UAT', nodes, connections, settings: SETTINGS };
}

async function createAndActivate(workflow) {
  const made = await api('POST', '/workflows', workflow);
  created.push(made.id);
  await api('POST', '/workflows/' + made.id + '/activate');
  await sleep(2400);
  return made.id;
}

async function callOnce(path, body) {
  const response = await fetch(BASE + '/webhook/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(60000)
  });
  const text = await response.text();
  if (!response.ok) fail('controlled webhook ' + path + ' -> ' + response.status + ' ' + text.slice(0, 250));
  return JSON.parse(text);
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

function assertKeyboard(kind, result, commandCode) {
  check(result.delivered === true, kind + ' Telegram message rendered');
  check(result.text_rendered === true, kind + ' synthetic owner copy rendered');
  check(result.kb_shape === 'KB221', kind + ' keyboard contract rendered');
  check(result.requested_callbacks.length === 5, kind + ' keyboard contains five live action buttons');
  check(JSON.stringify(result.rendered_callbacks) === JSON.stringify(result.requested_callbacks), kind + ' Telegram read-back contains the requested keyboard');
  for (const callback of result.rendered_callbacks) {
    const verb = String(callback).split('|')[0];
    check(['done', 'snooze', 'stage', 'docs', 'nurture'].includes(verb), kind + ' callback payload is valid: ' + verb);
    check(commandCode.includes("'" + verb + "'") || commandCode.includes('"' + verb + '"'), kind + ' action is reachable: ' + verb);
  }
}

async function verifyCompletedSystemSequence(ids) {
  if (ids.length !== 8) fail('--verify-executions requires eight comma-separated SYSTEM ALERT execution ids');
  const results = [];
  for (const id of ids) {
    const execution = await api('GET', '/executions/' + id + '?includeData=true');
    const runData = execution.data?.resultData?.runData || {};
    const output = (name) => runData[name]?.[0]?.data?.main?.[0]?.[0]?.json || {};
    const normalised = output('Normalise Alert Event');
    const silent = output('Silent');
    const telegramRaw = output('Telegram System Alert');
    const telegram = telegramRaw.result && typeof telegramRaw.result === 'object' ? telegramRaw.result : telegramRaw;
    const messageText = String(telegram.text || '');
    results.push({
      id: String(id), status: execution.status, emit: Number(normalised.emit || 0),
      kind: String(normalised.alert_kind || ''),
      reason: String(normalised.silent_reason || silent.silent_reason || ''),
      error_code: String(normalised.event?.error_code || ''),
      delivered: Boolean(telegram.message_id),
      recovered_heading: messageText.includes('Система восстановлена'),
      warning_heading: messageText.includes('Целостность данных'),
      actionable: messageText.includes('Действие владельца')
    });
  }
  const expected = [
    ['recovered', 'NO_OPEN_INCIDENT', false],
    ['failure', '', true],
    ['recovered', 'UNKNOWN_RECOVERY_PROOF', false],
    ['recovered', '', true],
    ['recovered', 'NO_OPEN_INCIDENT', false],
    ['data_warning', '', true],
    ['data_warning', 'UNCHANGED_DATA_WARNING', false],
    ['data_warning', 'DATA_CHECK_CLEAR', false]
  ];
  results.forEach((row, index) => {
    check(row.status === 'success', 'SYSTEM ALERT execution ' + row.id + ' succeeded');
    check(row.kind === expected[index][0] && row.reason === expected[index][1] && row.delivered === expected[index][2],
      'SYSTEM ALERT execution ' + row.id + ' matches controlled phase ' + (index + 1));
  });
  check(results[1].error_code === 'C2_CONTROLLED_FAILURE', 'controlled failure used the synthetic error code');
  check(results[3].recovered_heading && results[3].actionable, 'SYSTEM RECOVERED message is rendered and actionable');
  check(results[5].warning_heading && results[5].actionable, 'DATA WARNING message is rendered and actionable');
  check(results.filter((row) => row.delivered).length === 3, 'eight phases generated exactly three owner messages');
  mkdirSync(join(ROOT, '.uat', 'c2-final-closure'), { recursive: true });
  const completedAt = new Date().toISOString();
  const artifact = join(ROOT, '.uat', 'c2-final-closure', 'controlled-system-verified-' + completedAt.replace(/[:.]/g, '-') + '.json');
  writeFileSync(artifact, JSON.stringify({ verified_at: completedAt, executions: results }, null, 2) + '\n', 'utf8');
  console.log('\nC2 SYSTEM CONTROLLED UAT VERIFICATION PASS — ' + checks + ' checks, 0 failures.');
  console.log('NEW OWNER MESSAGES = 0 (read-only verification of completed UAT)');
  console.log('Evidence: ' + artifact);
}

async function main() {
  if (!DRY && !CONFIRM && !VERIFY_IDS.length) fail('use --dry-run, --verify-executions, or explicitly pass --confirm');
  if (!BASE || !READ_KEY || (!DRY && !VERIFY_IDS.length && !WRITE_KEY)) fail('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY are required');
  console.log('FINMENTOR C2 — CONTROLLED OWNER UAT');
  console.log(VERIFY_IDS.length ? 'MODE: READ-ONLY COMPLETED-EXECUTION VERIFICATION'
    : (DRY ? 'MODE: DRY RUN (no workflow/message writes)' : 'MODE: LIVE (synthetic owner alerts only)'));

  if (VERIFY_IDS.length) {
    await verifyCompletedSystemSequence(VERIFY_IDS);
    return;
  }

  const [sla, followup, system, command] = await Promise.all([
    api('GET', '/workflows/' + IDS.sla), api('GET', '/workflows/' + IDS.followup),
    api('GET', '/workflows/' + IDS.system), api('GET', '/workflows/' + IDS.command)
  ]);
  check(sla.active && followup.active && system.active && command.active, 'all four production authorities are active');
  for (const [label, workflow, builder, sender] of [
    ['SLA', sla, 'Build SLA Alert Keyboard', 'Telegram SLA Alert'],
    ['Follow-up', followup, 'Build Followup Alert Keyboard', 'Telegram Followup Reminder']
  ]) {
    check(Boolean(sourceNode(workflow, builder).parameters.jsCode.includes('kb_shape')), label + ' live builder emits kb_shape');
    const transport = sourceNode(workflow, sender);
    check(String(transport.parameters.chatId).includes('owner_chat_id'), label + ' live transport is owner-only');
    check(JSON.stringify(transport.parameters.inlineKeyboard).includes('$json.kb'), label + ' live transport consumes $json.kb');
  }
  const commandCode = command.nodes.filter((item) => item.parameters?.jsCode).map((item) => item.parameters.jsCode).join('\n');
  if (DRY) {
    console.log('\nC2 CONTROLLED UAT DRY RUN PASS — zero messages and zero temporary workflows.');
    return;
  }

  const token = randomUUID().replace(/-/g, '');
  const paths = {
    sla: 'c2-uat-sla-' + token, followup: 'c2-uat-followup-' + token,
    system: 'c2-uat-system-' + token
  };
  const routeIdentity = 'fmr_' + createHash('sha256').update('c2-route-' + token).digest('hex').slice(0, 32);
  const warningFingerprint = createHash('sha256').update('c2-warning-' + token).digest('hex');
  const evidence = { started_at: new Date().toISOString(), results: {} };
  let clean = false;
  try {
    await createAndActivate(keyboardHarness('sla', sla, paths.sla));
    const slaResult = await callOnce(paths.sla, {});
    evidence.results.sla = slaResult;
    assertKeyboard('SLA', slaResult, commandCode);

    await createAndActivate(keyboardHarness('followup', followup, paths.followup));
    const followResult = await callOnce(paths.followup, {});
    evidence.results.followup = followResult;
    assertKeyboard('Follow-up', followResult, commandCode);

    await createAndActivate(systemHarness(paths.system, routeIdentity, warningFingerprint));
    const phases = {};
    for (const phase of ['pre_recovery', 'failure', 'wrong_recovery', 'recovery', 'recovery_repeat',
      'warning', 'warning_repeat', 'warning_clear']) {
      phases[phase] = await callOnce(paths.system, { phase });
    }
    evidence.results.system = phases;
    check(phases.pre_recovery.delivered === false && phases.pre_recovery.silent_reason === 'NO_OPEN_INCIDENT', 'healthy probe without known failure is silent');
    check(phases.failure.delivered === true && phases.failure.is_system_failure === true, 'controlled known failure opens state and sends one owner alert');
    check(phases.wrong_recovery.delivered === false && phases.wrong_recovery.silent_reason === 'UNKNOWN_RECOVERY_PROOF', 'unverified recovery proof is silent');
    check(phases.recovery.delivered === true && phases.recovery.is_recovered === true, 'verified recovery sends one SYSTEM RECOVERED owner alert');
    check(phases.recovery_repeat.delivered === false && phases.recovery_repeat.silent_reason === 'NO_OPEN_INCIDENT', 'duplicate recovery is suppressed');
    check(phases.warning.delivered === true && phases.warning.is_data_warning === true, 'deterministic bad data sends one DATA WARNING owner alert');
    check(phases.warning_repeat.delivered === false && phases.warning_repeat.silent_reason === 'UNCHANGED_DATA_WARNING', 'unchanged DATA WARNING duplicate is suppressed');
    check(phases.warning_clear.delivered === false && phases.warning_clear.silent_reason === 'DATA_CHECK_CLEAR', 'synthetic warning state is cleared without an alert');
  } finally {
    clean = await cleanup();
  }
  check(clean, 'all temporary UAT workflows were removed');
  evidence.completed_at = new Date().toISOString();
  evidence.temp_workflows_removed = clean;
  mkdirSync(join(ROOT, '.uat', 'c2-final-closure'), { recursive: true });
  const artifact = join(ROOT, '.uat', 'c2-final-closure', 'controlled-uat-' + evidence.completed_at.replace(/[:.]/g, '-') + '.json');
  writeFileSync(artifact, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log('\nC2 CONTROLLED UAT PASS — ' + checks + ' checks, 0 failures.');
  console.log('OWNER MESSAGES = 5 (SLA, Follow-up, failure, recovered, data warning)');
  console.log('CLIENT MESSAGES = 0');
  console.log('TEMPORARY WORKFLOWS REMAINING = 0');
  console.log('Evidence: ' + artifact);
}

main().catch(async (error) => {
  if (created.length) await cleanup().catch(() => {});
  console.error('\nC2 CONTROLLED UAT FAIL — ' + error.message);
  process.exit(1);
});
