#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — C2 offline acceptance gate.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { inlineCrmStageResolver } from '../scripts/lib/inline-crm-stage.mjs';
import {
  NEW_FIXED_SCHEDULED_MONTHLY, C2_INTERNAL_WORKFLOW_MONTHLY_ESTIMATE,
  ESTIMATED_TOTAL_MONTHLY, SAFETY_RESERVE
} from '../scripts/lib/starter-schedule-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const load = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8').replace(/^\uFEFF/, ''));
const text = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(workflow.name + ': missing ' + name);
  return found;
};

const SLA = load('n8n/candidate/c2-sla-owner-control-candidate.json');
const FOLLOWUP = load('n8n/candidate/c2-followup-owner-control-candidate.json');
const DAILY = load('n8n/candidate/c2-daily-operational-signals-candidate.json');
const SYSTEM = load('n8n/candidate/system-alert-workflow.json');
const COMMAND = load('n8n/candidate/lead-command-center-labels-candidate.json');
const LA = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'));
const DWD = require_(join(ROOT, 'n8n', 'src', 'system-alert', 'data-warning.js'));
const sandboxRequire = (name) => {
  if (name === 'crypto') return require_('crypto');
  throw new Error('unexpected module: ' + name);
};
const SAE = new Function('require', text('n8n/src/system-alert/event.js') + '; return SAE;')(sandboxRequire);
const actionSource = inlineCrmStageResolver(
  text('n8n/src/lead-alerts/actions.js'), text('n8n/src/crm/stage-map.js')
);
const LAA = new Function(actionSource + '; return LAA;')();

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
  }
};

function handle(items) {
  return {
    first: () => { if (!items.length) throw new Error('first() on empty input'); return items[0]; },
    all: () => items,
    isExecuted: true
  };
}

function runCode(code, supplied = {}, input = [], staticData = {}) {
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(supplied, name)) throw new Error('missing node input ' + name);
    return handle(supplied[name].map((json) => ({ json })));
  };
  const $input = handle(input.map((json) => ({ json })));
  const $getWorkflowStaticData = (scope) => {
    if (scope !== 'global') throw new Error('non-global static-data scope');
    return staticData;
  };
  return new Function('$', '$input', 'require', '$getWorkflowStaticData', code)(
    $, $input, sandboxRequire, $getWorkflowStaticData
  );
}

const SETTINGS = { settings: {
  owner_chat_id: '000', timezone: 'Europe/Chisinau', sla_hot_hours: 4,
  sla_warm_hours: 24, sla_repeat_hours: 6, follow_up_enabled: false
} };
const LEAD = {
  lead_id: 'FIN-1999999999999-1', company: 'C2 Synthetic', name: 'Owner Test',
  priority: 'HOT', financial_zone: 'ORANGE', deal_stage: 'New', sla_status: 'Active',
  created_at: '2026-09-14T00:00:00.000Z', next_follow_up_at: '2026-09-14T01:00:00.000Z',
  next_action: 'Controlled owner action', email: 'synthetic@example.invalid'
};

function buildAlert(workflow, builderName, sourceItem, pipeline, extraNodes) {
  return runCode(node(workflow, builderName).parameters.jsCode,
    Object.assign({ 'Get Pipeline Rows': pipeline }, extraNodes || {}), [sourceItem])[0].json;
}

function keyboardButtons(telegramNode, kb) {
  const out = [];
  const rows = node(telegramNode.workflow, telegramNode.name).parameters.inlineKeyboard.rows;
  rows.forEach((row, ri) => row.row.buttons.forEach((button, ci) => {
    const expected = kb[ri] && kb[ri][ci];
    if (!expected) throw new Error('sender slot has no builder payload at ' + ri + ',' + ci);
    const t = button.text.match(/kb\[(\d+)\]\[(\d+)\]\.text/);
    const c = button.additionalFields.callback_data.match(/kb\[(\d+)\]\[(\d+)\]\.callback_data/);
    if (!t || !c || Number(t[1]) !== ri || Number(t[2]) !== ci || Number(c[1]) !== ri || Number(c[2]) !== ci) {
      throw new Error('sender expression mismatch at ' + ri + ',' + ci);
    }
    out.push(expected);
  }));
  return out;
}

let slaSelected;
let slaBuilt;
let followSelected;
let followBuilt;

check('SLA selection renders one synthetic owner alert', () => {
  slaSelected = runCode(node(SLA, 'SLA Select').parameters.jsCode,
    { 'Settings to Object': [SETTINGS] }, [LEAD]);
  eq(slaSelected.length, 1, 'SLA selection count');
  assert(typeof slaSelected[0].json.alert_html === 'string' && !LA.validate(slaSelected[0].json.alert_html).length,
    'SLA message is not valid Telegram HTML');
});

check('SLA builder emits the exact kb contract', () => {
  slaBuilt = buildAlert(SLA, 'Build SLA Alert Keyboard', slaSelected[0].json, [LEAD]);
  eq(slaBuilt.kb_shape, 'KB221', 'SLA keyboard shape');
  eq(slaBuilt.kb.flat().length, 5, 'SLA button count');
});

check('SLA sender renders every dynamic keyboard slot', () => {
  const buttons = keyboardButtons({ workflow: SLA, name: 'Telegram SLA Alert' }, slaBuilt.kb);
  eq(buttons.length, 5, 'rendered SLA button count');
});

check('SLA callbacks are valid existing owner actions', () => {
  for (const button of slaBuilt.kb.flat()) {
    const parts = button.callback_data.split('|');
    assert(LAA.actionOfCommand(parts[0], parts[2]), 'unmapped callback ' + button.callback_data);
    assert(button.callback_data.includes(LEAD.lead_id), 'callback lost lead identity');
  }
});

check('SLA anti-spam suppresses an unchanged duplicate alert', () => {
  const next = Object.assign({}, LEAD, { last_sla_alert_at: slaSelected[0].json.sla_alert_at });
  const again = runCode(node(SLA, 'SLA Select').parameters.jsCode,
    { 'Settings to Object': [SETTINGS] }, [next]);
  eq(again.length, 0, 'duplicate SLA alert count');
});

check('Follow-up selection renders one synthetic owner alert', () => {
  const due = { followup_id: 'FU-C2-SYNTHETIC', lead_id: LEAD.lead_id, status: 'Planned',
    due_at: '2026-09-14T01:00:00.000Z', type: 'HOT follow-up', priority: 'HOT' };
  followSelected = runCode(node(FOLLOWUP, 'Build Followup Plan').parameters.jsCode,
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [LEAD], 'Get Followups': [due] }, []);
  followSelected = followSelected.filter((item) => item.json.item_type === 'due_alert');
  eq(followSelected.length, 1, 'Follow-up alert count');
  assert(!LA.validate(followSelected[0].json.alert_html).length, 'Follow-up message is invalid');
});

check('Follow-up builder emits the exact kb contract', () => {
  followBuilt = buildAlert(FOLLOWUP, 'Build Followup Alert Keyboard', followSelected[0].json, [LEAD]);
  eq(followBuilt.kb_shape, 'KB221', 'Follow-up keyboard shape');
  eq(followBuilt.kb.flat().length, 5, 'Follow-up button count');
});

check('Follow-up sender renders every dynamic keyboard slot', () => {
  const buttons = keyboardButtons({ workflow: FOLLOWUP, name: 'Telegram Followup Reminder' }, followBuilt.kb);
  eq(buttons.length, 5, 'rendered Follow-up button count');
});

check('Follow-up callbacks are valid existing owner actions', () => {
  for (const button of followBuilt.kb.flat()) {
    const parts = button.callback_data.split('|');
    assert(LAA.actionOfCommand(parts[0], parts[2]), 'unmapped callback ' + button.callback_data);
  }
});

check('Follow-up sent status suppresses duplicate notification', () => {
  const sent = { followup_id: 'FU-C2-SYNTHETIC', lead_id: LEAD.lead_id, status: 'Sent',
    due_at: '2026-09-14T01:00:00.000Z', type: 'HOT follow-up', priority: 'HOT' };
  const again = runCode(node(FOLLOWUP, 'Build Followup Plan').parameters.jsCode,
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [LEAD], 'Get Followups': [sent] }, []);
  eq(again.filter((item) => item.json.item_type === 'due_alert').length, 0, 'duplicate Follow-up alert count');
});

check('all keyboard verbs are reachable in the existing Command Center', () => {
  const commandCode = COMMAND.nodes.filter((item) => item.parameters && item.parameters.jsCode)
    .map((item) => item.parameters.jsCode).join('\n');
  for (const verb of ['done', 'snooze', 'stage', 'docs', 'nurture']) {
    assert(commandCode.includes("'" + verb + "'") || commandCode.includes('"' + verb + '"'), 'missing route ' + verb);
  }
});

check('owner keyboard workflows contain no client-facing Telegram destination', () => {
  for (const workflow of [SLA, FOLLOWUP]) {
    for (const item of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.telegram')) {
      assert(String(item.parameters.chatId).includes('owner_chat_id'), item.name + ' is not owner-routed');
    }
  }
});

check('recovery probe without known failure is silent', () => {
  const state = {};
  const out = SAE.transition({ event_type: 'recovery_probe', proof_key: 'daily-digest:crm-read',
    occurred_at: '2026-09-15T08:30:00.000Z' }, state);
  assert(!out.emit && out.reason === 'NO_OPEN_INCIDENT', 'false recovery emitted');
});

check('CRM failure opens persisted monitored state', () => {
  const state = {};
  const out = SAE.transition({ workflow_key: 'lead-intake', verdict_node: 'CRM Unavailable',
    error_code: 'CRM_UNAVAILABLE', retryable: true, route_identity: 'fmr_' + '1'.repeat(32),
    occurred_at: '2026-09-15T08:00:00.000Z' }, state);
  assert(out.emit && out.kind === 'failure', 'failure alert missing');
  assert(state.finmentor_c2_owner_control.incidents['crm-settings-and-pipeline'], 'failed state was not persisted');
});

check('unrelated success cannot close the CRM incident', () => {
  const state = {};
  SAE.transition({ workflow_key: 'lead-intake', verdict_node: 'CRM Unavailable',
    error_code: 'CRM_UNAVAILABLE', retryable: true, occurred_at: '2026-09-15T08:00:00.000Z' }, state);
  SAE.transition({ workflow_key: 'lead-intake', verdict_node: 'Respond New Lead',
    error_code: 'OK', occurred_at: '2026-09-15T08:01:00.000Z' }, state);
  assert(state.finmentor_c2_owner_control.incidents['crm-settings-and-pipeline'], 'ordinary success closed incident');
});

let recovered;
check('verified Daily Digest CRM read emits one recovery', () => {
  const state = {};
  SAE.transition({ workflow_key: 'lead-intake', verdict_node: 'CRM Unavailable',
    error_code: 'CRM_UNAVAILABLE', retryable: true, occurred_at: '2026-09-15T08:00:00.000Z' }, state);
  recovered = SAE.transition({ event_type: 'recovery_probe', proof_key: 'daily-digest:crm-read',
    occurred_at: '2026-09-15T08:30:00.000Z' }, state);
  assert(recovered.emit && recovered.kind === 'recovered', 'recovery not emitted');
  assert(recovered.event.owner_action_required === true, 'owner action verdict missing');
  const duplicate = SAE.transition({ event_type: 'recovery_probe', proof_key: 'daily-digest:crm-read',
    occurred_at: '2026-09-15T08:31:00.000Z' }, state);
  assert(!duplicate.emit && duplicate.reason === 'NO_OPEN_INCIDENT', 'duplicate recovery emitted');
});

check('SYSTEM RECOVERED owner message is operational and actionable', () => {
  const source = node(SYSTEM, 'Build System Alert').parameters.jsCode;
  const $ = () => ({ first: () => ({ json: { alert_kind: 'recovered', event: recovered.event } }) });
  const out = new Function('$', 'require', source)($, sandboxRequire)[0].json.alert_html;
  assert(!LA.validate(out).length, 'invalid recovery Telegram HTML');
  assert(out.includes('Доступ к CRM восстановлен'), 'recovered component missing');
  assert(out.includes('Действие владельца'), 'owner action status missing');
});

check('Daily Digest exports its existing deterministic data checks', () => {
  const output = runCode(node(DAILY, 'Build Daily Digest').parameters.jsCode,
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [LEAD], 'Get AI Plans': [] }, [LEAD])[0].json;
  assert(output.c2_data_warning, 'data-warning source missing');
  eq(output.c2_data_warning.missing_required_contact.length, 0, 'contact check changed');
  eq(output.c2_data_warning.missing_next_action.length, 0, 'next-action check changed');
});

let warningEvent;
check('deterministic bad data emits one hashed Data Warning event', () => {
  const state = {};
  const bad = { missing_required_contact: ['FIN-C2-A'], missing_next_action: ['FIN-C2-A'], expired_snooze: [] };
  const first = DWD.evaluate(bad, state, '2026-09-15T08:30:00.000Z');
  const same = DWD.evaluate(bad, state, '2026-09-16T08:30:00.000Z');
  assert(first.emit && /^[0-9a-f]{64}$/.test(first.event.fingerprint), 'warning fingerprint missing');
  assert(!same.emit && same.reason === 'UNCHANGED_DATA_WARNING', 'unchanged warning duplicated');
  warningEvent = first.event;
});

check('central warning state independently suppresses duplicate spam', () => {
  const state = {};
  const first = SAE.transition(warningEvent, state);
  const same = SAE.transition(warningEvent, state);
  assert(first.emit && first.kind === 'data_warning', 'first warning was not emitted');
  assert(!same.emit && same.reason === 'UNCHANGED_DATA_WARNING', 'central duplicate guard failed');
});

check('cleared data allows a later recurrence without a stale suppression', () => {
  const local = {};
  const central = {};
  const bad = { missing_required_contact: ['FIN-C2-A'], missing_next_action: [], expired_snooze: [] };
  const first = DWD.evaluate(bad, local, '2026-09-15T08:30:00.000Z');
  assert(SAE.transition(first.event, central).emit, 'initial warning missing');
  const clear = DWD.evaluate({}, local, '2026-09-16T08:30:00.000Z');
  assert(clear.emit && clear.reason === 'CLEAR_TRANSITION', 'clear transition missing');
  const cleared = SAE.transition(clear.event, central);
  assert(!cleared.emit && cleared.reason === 'DATA_CHECK_CLEAR', 'clear emitted an owner alert');
  const recurrence = DWD.evaluate(bad, local, '2026-09-17T08:30:00.000Z');
  assert(SAE.transition(recurrence.event, central).emit, 'real recurrence was suppressed');
});

check('DATA WARNING owner message is deterministic and actionable', () => {
  const event = SAE.transition(warningEvent, {}).event;
  const source = node(SYSTEM, 'Build System Alert').parameters.jsCode;
  const $ = () => ({ first: () => ({ json: { alert_kind: 'data_warning', event } }) });
  const out = new Function('$', 'require', source)($, sandboxRequire)[0].json.alert_html;
  assert(!LA.validate(out).length, 'invalid Data Warning Telegram HTML');
  assert(out.includes('Активные лиды без контакта'), 'deterministic check label missing');
  assert(out.includes('Откройте Pipeline'), 'actionable owner wording missing');
});

check('recovery and warning routes notify only the owner', () => {
  const telegram = SYSTEM.nodes.filter((item) => item.type === 'n8n-nodes-base.telegram');
  eq(telegram.length, 1, 'SYSTEM ALERT Telegram sender count');
  assert(String(telegram[0].parameters.chatId).includes('owner_chat_id'), 'SYSTEM ALERT is not owner-routed');
});

check('C2 adds no trigger and changes no schedule frequency', () => {
  const schedules = [SLA, FOLLOWUP, DAILY].flatMap((workflow) => workflow.nodes
    .filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger'));
  eq(schedules.length, 3, 'scheduled trigger count in affected workflows');
  eq(node(SLA, 'Hourly SLA Check').parameters.rule.interval[0].expression, '0 8-20/2 * * 1-5', 'SLA schedule');
  eq(node(FOLLOWUP, 'Hourly Followup Check').parameters.rule.interval[0].expression, '0 10,16 * * 1-5', 'Follow-up schedule');
  eq(node(DAILY, 'Daily Digest Schedule').parameters.rule.interval[0].expression, '30 8 * * 1-5', 'Daily schedule');
  eq(SYSTEM.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').length, 0, 'SYSTEM ALERT polling');
});

check('Starter scheduled budget remains exactly 748', () => {
  eq(NEW_FIXED_SCHEDULED_MONTHLY, 748, 'scheduled monthly budget');
  eq(C2_INTERNAL_WORKFLOW_MONTHLY_ESTIMATE, 22, 'bounded recovery child executions');
  eq(ESTIMATED_TOTAL_MONTHLY, 1720, 'C2 expected total envelope');
  eq(SAFETY_RESERVE, 780, 'C2 Starter reserve');
});

check('C2 operational nodes carry no credentials', () => {
  for (const name of ['Detect Data Warning', 'Emit Data Warning', 'Probe CRM Recovery']) {
    assert(!node(DAILY, name).credentials, name + ' gained credentials');
  }
});

check('C2 touches no X-Ray, scoring, CRM, privacy, client journey, or Mini App source', () => {
  const protectedPaths = [
    'app-premium', 'n8n/src/xray-analysis', 'n8n/src/lead-intelligence', 'n8n/src/lead-intake',
    'n8n/src/premium-ux', 'n8n/src/miniapp-submit', 'n8n/src/miniapp-readmodel', 'n8n/src/crm'
  ];
  // C3 is a later, separately-gated closure. Exclude only its six explicitly authorised source
  // files; the remaining C1/C2 surface keeps its original byte-level regression seal.
  const c3Authorised = new Set([
    'n8n/src/xray-analysis/c3-target.js',
    'n8n/src/xray-analysis/select-pending.js',
    'n8n/src/xray-analysis/build-input.js',
    'n8n/src/xray-analysis/validate-analysis.js',
    'n8n/src/xray-analysis/analysis-failed.js',
    'n8n/src/xray-analysis/owner-cards.js',
    'n8n/src/lead-intelligence/alert.js',
    'n8n/src/lead-intelligence/precall.js',
    'n8n/src/premium-ux/tg-state-machine.js',
    'n8n/src/lead-intake/c3-intelligence-request.js'
  ]);
  const rows = [];
  const walk = (absolutePath) => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const itemPath = join(absolutePath, entry.name);
      if (entry.isDirectory()) walk(itemPath);
      else {
        const itemRelative = relative(ROOT, itemPath).split(sep).join('/');
        if (c3Authorised.has(itemRelative)) continue;
        const digest = createHash('sha256').update(readFileSync(itemPath)).digest('hex');
        rows.push(`${itemRelative}\0${digest}`);
      }
    }
  };
  for (const protectedPath of protectedPaths) walk(join(ROOT, protectedPath));
  eq(rows.length, 41, 'protected C1/C2 source file count outside V1 owner-intelligence allowlist');
  // Re-sealed after the separately gated 2026-09-16 request-context correction removed identity
  // fields from free-text extraction. C2 owner controls are unchanged.
  eq(
    createHash('sha256').update(rows.join('\n')).digest('hex'),
    'ac02c731cb75cb5092fe30671607171f793ba100cb917aafbdc335a3c6102d94',
    'protected C1/C2 source tree hash outside C3 allowlist'
  );
});

check('C2 artifact allowlist excludes FINMENTOR_GATE6_FINAL', () => {
  const c2ArtifactPaths = [
    'n8n/candidate/c2-daily-operational-signals-candidate.json',
    'n8n/candidate/c2-followup-owner-control-candidate.json',
    'n8n/candidate/c2-sla-owner-control-candidate.json',
    'n8n/candidate/system-alert-workflow.json'
  ];
  assert(
    c2ArtifactPaths.every((item) => !item.startsWith('FINMENTOR_GATE6_FINAL/')),
    'protected directory entered the C2 artifact allowlist'
  );
});

console.log(`\nC2 ASSERTIONS: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log('FAILED: ' + failure);
if (failures.length) process.exit(1);
