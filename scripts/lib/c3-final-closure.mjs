// FINMENTOR V1 C3 — pure, bounded workflow patchers.
//
// Each function accepts an accepted/live workflow and returns a clone. It refuses a graph that no
// longer has the exact anchors C3 was approved against. No API or filesystem mutation occurs here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDS = Object.freeze({
  intake: 'QmIyEW2ZEqKregmN', command: 'qF9tonlHHIxc8MDd', xray: 'tNSMRoKlFB52vjge'
});
export const C3_NODE_IDS = Object.freeze({
  intakeRequest: 'c3-intelligence-request', intakeExecute: 'c3-run-owner-intelligence',
  callbackValidate: 'c3-basic-callback', callbackIf: 'c3-if-basic-callback', callbackRestore: 'c3-restore-command-envelope',
  xrayTrigger: 'c3-xray-trigger', xrayValidate: 'c3-xray-validate-target'
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const edge = (name) => ({ node: name, type: 'main', index: 0 });
const fail = (message) => { throw new Error(message); };
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing C3 anchor ' + name);
  return found;
};
const codeNode = (name, id, jsCode, position) => ({
  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
  id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position
});
const assertAbsent = (workflow, names) => {
  for (const name of names) if (workflow.nodes.some((item) => item.name === name)) fail(workflow.name + ': already contains ' + name);
};
const targets = (workflow, name, output = 0) =>
  ((((workflow.connections[name] || {}).main || [])[output]) || []).map((item) => item.node);

export function readC3Sources(root) {
  const read = (relative) => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n');
  const moduleBody = (relative) => read(relative)
    .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n)*/m, '')
    .replace(/['"]use strict['"];?\s*/, '')
    .replace(/^const LI = require\([^\n]+\);\s*/m, '')
    .replace(/if \(typeof module[\s\S]*$/, '')
    .trim();
  const contract = `const LI = (function () {\n${moduleBody('n8n/src/lead-intelligence/contract.js')}\nreturn api;\n})();`;
  const alert = `const LI_ALERT = (function () {\n${moduleBody('n8n/src/lead-intelligence/alert.js')}\nreturn { renderLeadIntelligenceAlert, contactLines, esc, tidy };\n})();`;
  const labels = read('n8n/src/xray-analysis/labels.js').replace(/if \(typeof module[\s\S]*$/, '').trim();
  const cards = read('n8n/src/xray-analysis/owner-cards.js').replace(/if \(typeof module[\s\S]*$/, '').trim();
  return {
    intakeRequest: read('n8n/src/lead-intake/c3-intelligence-request.js'),
    callbackValidate: read('n8n/src/command-center/c3-basic-callback.js'),
    callbackRestore: read('n8n/src/command-center/c3-restore-envelope.js'),
    xrayTarget: read('n8n/src/xray-analysis/c3-target.js'),
    selectPending: read('n8n/src/xray-analysis/select-pending.js'),
    buildInput: read('n8n/src/xray-analysis/build-input.js')
      .replace('// __LEAD_INTELLIGENCE_CONTRACT__ (inlined by the builder)', contract),
    validateAnalysis: read('n8n/src/xray-analysis/validate-analysis.js')
      .replace('// __XRAY_LABELS__ (inlined by the builder)', labels)
      .replace('// __XRAY_OWNER_CARDS__ (inlined by the builder)', cards)
      .replace('// __LEAD_INTELLIGENCE_CONTRACT__ (inlined by the builder)', contract)
      .replace('// __LEAD_INTELLIGENCE_ALERT__ (inlined by the builder)', alert)
  };
}

const INTERNAL_GUARD = '// C3: authenticated committed NEW leads use the single X-Ray owner-intelligence alert.\n'
  + 'if ($input.first().json.provenance_trusted === true) return [];\n';

export function patchLeadIntake(workflow, sources) {
  const out = clone(workflow);
  assertAbsent(out, ['Build C3 Intelligence Request', 'Run Owner Intelligence (C3)']);
  if (!same(targets(out, 'IF Committed (New)', 0), ['Internal Result (New)'])) fail('Lead Intake: NEW committed true branch drift');
  if (!same(targets(out, 'IF Committed (New)', 1), ['Internal Result (Unresolved)'])) fail('Lead Intake: NEW unresolved branch drift');
  if (targets(out, 'Save Lead to CRM').length) fail('Lead Intake: Save Lead to CRM is no longer terminal');
  const restored = targets(out, 'Restore Lead Context');
  for (const required of ['Save Lead to CRM', 'Route by Lead Priority', 'AI Gate']) {
    if (!restored.includes(required)) fail('Lead Intake: post-intake fan-out lost ' + required);
  }

  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate']) {
    const target = node(out, name);
    const js = String(target.parameters.jsCode || '');
    if (js.includes(INTERNAL_GUARD.trim())) fail('Lead Intake: duplicate internal guard in ' + name);
    target.parameters.jsCode = INTERNAL_GUARD + js;
  }

  const save = node(out, 'Save Lead to CRM');
  const savePos = save.position || [0, 0];
  out.nodes.push(
    codeNode('Build C3 Intelligence Request', C3_NODE_IDS.intakeRequest, sources.intakeRequest, [savePos[0] + 240, savePos[1]]),
    {
      parameters: {
        workflowId: { __rl: true, value: IDS.xray, mode: 'list', cachedResultName: 'FINMENTOR X-Ray Analysis' },
        mode: 'each', options: { waitForSubWorkflow: true }
      },
      id: C3_NODE_IDS.intakeExecute, name: 'Run Owner Intelligence (C3)',
      type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2,
      position: [savePos[0] + 480, savePos[1]], alwaysOutputData: true
    }
  );
  out.connections['IF Committed (New)'].main[0] = [edge('Restore Lead Context')];
  out.connections['Save Lead to CRM'] = { main: [[edge('Build C3 Intelligence Request')]] };
  out.connections['Build C3 Intelligence Request'] = { main: [[edge('Run Owner Intelligence (C3)')]] };
  out.connections['Run Owner Intelligence (C3)'] = { main: [[edge('Internal Result (New)')]] };
  return out;
}

export function patchCommandCenter(workflow, sources) {
  const out = clone(workflow);
  assertAbsent(out, ['Validate Basic Callback Envelope', 'IF Basic Callback Envelope', 'Restore Command Envelope']);
  if (!same(targets(out, 'Telegram Command Trigger'), ['Verify Telegram Identity'])) fail('Command Center: trigger entry drift');
  if (!same(targets(out, 'Verify Telegram Identity'), ['Read Settings'])) fail('Command Center: Settings order drift');
  if (!targets(out, 'IF Has Callback').includes('Answer Callback Query')) fail('Command Center: existing callback ACK anchor drift');

  const trigger = node(out, 'Telegram Command Trigger');
  const triggerPos = trigger.position || [0, 0];
  out.nodes.push(
    codeNode('Validate Basic Callback Envelope', C3_NODE_IDS.callbackValidate, sources.callbackValidate, [triggerPos[0] + 220, triggerPos[1]]),
    {
      parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'c3-basic-callback-cond', leftValue: '={{ $json.c3_basic_callback_valid }}', rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
      id: C3_NODE_IDS.callbackIf, name: 'IF Basic Callback Envelope', type: 'n8n-nodes-base.if', typeVersion: 2.2,
      position: [triggerPos[0] + 440, triggerPos[1]]
    },
    codeNode('Restore Command Envelope', C3_NODE_IDS.callbackRestore, sources.callbackRestore, [triggerPos[0] + 880, triggerPos[1]])
  );

  const answer = node(out, 'Answer Callback Query');
  answer.parameters.queryId = '={{ $json.c3_callback_query_id }}';
  answer.parameters.additionalFields = Object.assign({}, answer.parameters.additionalFields || {}, { text: 'Принято' });
  out.connections['Telegram Command Trigger'] = { main: [[edge('Validate Basic Callback Envelope')]] };
  out.connections['Validate Basic Callback Envelope'] = { main: [[edge('IF Basic Callback Envelope')]] };
  out.connections['IF Basic Callback Envelope'] = { main: [[edge('Answer Callback Query')], [edge('Restore Command Envelope')]] };
  out.connections['Answer Callback Query'] = { main: [[edge('Restore Command Envelope')]] };
  out.connections['Restore Command Envelope'] = { main: [[edge('Verify Telegram Identity')]] };
  delete out.connections['IF Has Callback'];
  const parseTargets = targets(out, 'Parse Lead Command v2').filter((name) => name !== 'IF Has Callback');
  if (!parseTargets.includes('Route Command Mode')) fail('Command Center: command router drift');
  out.connections['Parse Lead Command v2'].main[0] = parseTargets.map(edge);
  return out;
}

export function patchXray(workflow, sources) {
  const out = clone(workflow);
  assertAbsent(out, ['C3 Lead Intelligence Trigger', 'Validate C3 Lead Target']);
  if (!same(targets(out, 'Every 10 Minutes'), ['Read Settings'])) fail('X-Ray: schedule entry drift');
  for (const [name, jsCode] of [
    ['Select Pending Leads', sources.selectPending],
    ['Build Analysis Input', sources.buildInput],
    ['Validate + Store Rows', sources.validateAnalysis]
  ]) node(out, name).parameters.jsCode = jsCode;

  const schedule = node(out, 'Every 10 Minutes');
  const schedulePos = schedule.position || [0, 0];
  out.nodes.push(
    {
      parameters: { inputSource: 'passthrough' }, id: C3_NODE_IDS.xrayTrigger,
      name: 'C3 Lead Intelligence Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.2,
      position: [schedulePos[0], schedulePos[1] + 260]
    },
    codeNode('Validate C3 Lead Target', C3_NODE_IDS.xrayValidate, sources.xrayTarget, [schedulePos[0] + 220, schedulePos[1] + 260])
  );
  out.connections['C3 Lead Intelligence Trigger'] = { main: [[edge('Validate C3 Lead Target')]] };
  out.connections['Validate C3 Lead Target'] = { main: [[edge('Read Settings')]] };
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function workflowShape(workflow) {
  return {
    credentials: workflow.nodes.filter((item) => item.credentials).map((item) => [item.name, item.credentials]),
    schedules: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => [item.name, item.parameters]),
    webhooks: workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.telegramTrigger'].includes(item.type))
      .map((item) => [item.name, item.parameters])
  };
}
