import { code as generatedXrayCode } from '../build-xray-analysis-workflow.mjs';

export const IDS = Object.freeze({ xray: 'tNSMRoKlFB52vjge' });
export const NODE_NAME = 'Build Analysis Input';
export const EXPECTED_PRE_VERSION = '3038cab5-df8f-4be0-8020-9394f77107a9';
export const EXPECTED_PRE_NODE_SHA256 = 'd30ad9f4d9692a2161580b3e47d1e02eba973205a6d9021ce8176356c1b929f3';

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const node = (workflow) => {
  const found = workflow.nodes.find((item) => item.name === NODE_NAME);
  if (!found) fail(workflow.name + ': missing ' + NODE_NAME);
  if (found.type !== 'n8n-nodes-base.code') fail(NODE_NAME + ': not a Code node');
  return found;
};

export function readSource(root) {
  // Build Analysis Input depends on the Lead Intelligence contract injected by the canonical
  // X-Ray workflow builder. Returning the raw source here drops that binding and creates a node
  // that compiles but fails at its first LI call in production.
  const source = generatedXrayCode.buildInput;
  if (!source.includes('const requestScopedPick = ')) fail('tracked source lacks request-scoped authority marker');
  if (!source.includes('const LI = (function () {')) fail('generated source lacks LI runtime binding');
  if (source.includes('__LEAD_INTELLIGENCE_CONTRACT__')) fail('generated source retains LI inline marker');
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
