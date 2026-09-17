import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDS = Object.freeze({ xray: 'tNSMRoKlFB52vjge' });
export const NODE_NAME = 'Build Analysis Input';
export const EXPECTED_PRE_VERSION = 'f218bf76-7a63-4ee1-85a2-f92faa216117';
export const EXPECTED_PRE_NODE_SHA256 = '04296c993c1bc586c478044c258ccdd9671b4ec76ee2a107aeccb911378a733e';

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const node = (workflow) => {
  const found = workflow.nodes.find((item) => item.name === NODE_NAME);
  if (!found) fail(workflow.name + ': missing ' + NODE_NAME);
  if (found.type !== 'n8n-nodes-base.code') fail(NODE_NAME + ': not a Code node');
  return found;
};

export function readSource(root) {
  const source = readFileSync(join(root, 'n8n', 'src', 'xray-analysis', 'build-input.js'), 'utf8');
  if (!source.includes('const requestScopedPick = ')) fail('tracked source lacks request-scoped authority marker');
  return source;
}

export function isApplied(workflow, source) {
  return String(node(workflow).parameters.jsCode || '') === source;
}

export function patchRequestContext(workflow, source) {
  if (isApplied(workflow, source)) fail('correction already applied');
  const out = clone(workflow);
  node(out).parameters.jsCode = source;
  if (!isApplied(out, source)) fail('candidate does not carry the tracked source');
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function protectedShape(workflow) {
  return {
    nodeSet: workflow.nodes.map((item) => [item.name, item.type, item.typeVersion]),
    connections: workflow.connections,
    credentials: workflow.nodes.filter((item) => item.credentials).map((item) => [item.name, item.credentials]),
    schedules: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => [item.name, item.parameters]),
    webhooks: workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.executeWorkflowTrigger'].includes(item.type))
      .map((item) => [item.name, item.parameters]),
    model: workflow.nodes.filter((item) => item.type === '@n8n/n8n-nodes-langchain.openAi')
      .map((item) => [item.name, item.parameters, item.credentials, item.retryOnFail, item.maxTries, item.waitBetweenTries]),
    sheets: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.googleSheets').map((item) => [item.name, item.parameters, item.credentials]),
    settings: workflow.settings || {}
  };
}
