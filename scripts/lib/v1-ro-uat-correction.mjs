// FINMENTOR V1 — pure RO UAT P0/P1 correction patchers.
//
// These functions accept the exact post-launch-blocker production shapes and return clones. They
// never call n8n and refuse drift at every branch that this correction changes.

import { readFixSources } from './v1-launch-blocker-fix.mjs';

export const IDS = Object.freeze({
  host: 'KBD7Q94QQnlzgYKJ',
  intake: 'QmIyEW2ZEqKregmN',
  xray: 'tNSMRoKlFB52vjge',
  command: 'qF9tonlHHIxc8MDd'
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const edge = (name) => ({ node: name, type: 'main', index: 0 });
const fail = (message) => { throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing correction anchor ' + name);
  return found;
};
const targets = (workflow, name, output = 0) =>
  ((((workflow.connections[name] || {}).main || [])[output]) || []).map((item) => item.node);

export function readCorrectionSources(root) { return readFixSources(root); }

function modeRouter(position) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'v1-ro-c3-merge-result-condition',
          leftValue: "={{ $('Build C3 Intelligence Request').first().json.event === 'ELIGIBLE_MERGE_COMMITTED' }}",
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: 'v1-ro-route-c3-result-mode',
    name: 'Route C3 Result Mode',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position
  };
}

export function patchIntake(workflow, sources) {
  const out = clone(workflow);
  if (!same(targets(out, 'IF Committed (Merge)', 0), ['Internal Result (Merge)']))
    fail('Lead Intake: committed Merge true branch drift');
  if (!same(targets(out, 'IF Committed (Merge)', 1), ['Internal Result (Unresolved)']))
    fail('Lead Intake: committed Merge false branch drift');
  if (!same(targets(out, 'Run Owner Intelligence (C3)'), ['Internal Result (New)']))
    fail('Lead Intake: C3 return branch drift');
  if (!targets(out, 'Restore Lead Context (Merged)').includes('Save Lead to CRM'))
    fail('Lead Intake: merged Leads archive edge missing');
  if (!same(targets(out, 'Save Lead to CRM'), ['Build C3 Intelligence Request']))
    fail('Lead Intake: post-archive C3 edge drift');
  if (out.nodes.some((item) => item.name === 'Route C3 Result Mode'))
    fail('Lead Intake: correction router already exists');

  node(out, 'Build C3 Intelligence Request').parameters.jsCode = sources.intakeRequest;
  const run = node(out, 'Run Owner Intelligence (C3)');
  const pos = run.position || [0, 0];
  out.nodes.push(modeRouter([pos[0] + 240, pos[1]]));
  out.connections['IF Committed (Merge)'].main[0] = [edge('Restore Lead Context (Merged)')];
  out.connections['Run Owner Intelligence (C3)'] = { main: [[edge('Route C3 Result Mode')]] };
  out.connections['Route C3 Result Mode'] = {
    main: [[edge('Internal Result (Merge)')], [edge('Internal Result (New)')]]
  };
  return out;
}

export function patchXray(workflow, sources) {
  const out = clone(workflow);
  for (const [name, code] of [
    ['Validate C3 Lead Target', sources.xrayTarget],
    ['Select Pending Leads', sources.selectPending],
    ['Build Analysis Input', sources.buildInput],
    ['Validate + Store Rows', sources.validateAnalysis],
    ['Analysis Failed Row', sources.analysisFailed]
  ]) node(out, name).parameters.jsCode = code;

  const alert = node(out, 'Telegram Owner Alert');
  alert.parameters.inlineKeyboard = { rows: [
    { row: { buttons: [{ text: 'Бриф к встрече', additionalFields: { callback_data: "={{ 'brief|' + $('Validate + Store Rows').item.json.lead_id }}", style: 'primary' } }] } },
    { row: { buttons: [{ text: 'Связаться', additionalFields: { url: "={{ $('Validate + Store Rows').item.json.owner_alert.contact_url }}" } }] } },
    { row: { buttons: [{ text: 'Discovery', additionalFields: { callback_data: "={{ 'stage|' + $('Validate + Store Rows').item.json.lead_id + '|Discovery Scheduled' }}", style: 'success' } }] } },
    { row: { buttons: [{ text: '⋯ Управление лидом', additionalFields: { url: "={{ $('Validate + Store Rows').item.json.owner_alert.review_url }}" } }] } }
  ] };
  return out;
}

export function patchCommand(workflow, sources) {
  const out = clone(workflow);
  node(out, 'Render Pre-Call Brief').parameters.jsCode = sources.precallCode;
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function protectedShape(workflow) {
  return {
    credentials: workflow.nodes.filter((item) => item.credentials).map((item) => [item.name, item.credentials]),
    schedules: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => [item.name, item.parameters]),
    webhooks: workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.telegramTrigger'].includes(item.type))
      .map((item) => [item.name, item.parameters])
  };
}
