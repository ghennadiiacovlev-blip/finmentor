import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDS = Object.freeze({ leadIntake: 'QmIyEW2ZEqKregmN' });
export const NODE_NAME = 'Dedup Guard';
export const EXPECTED_PRE_VERSION = '108640f1-654e-4258-8e47-678398a12f77';
export const EXPECTED_PRE_NODE_SHA256 = '6889cb9682338118bcaf36c1a28a223dc887ba0f06486249acd02b186e487b89';

const OLD_BLOCK = [
  '// A corroborated request_id IS the same submission, whatever the clock says, so it is a',
  '// retry regardless of the two-minute window. That in turn suppresses escalation below and',
  '// tells Build Merge Update to leave attribution alone.',
  'const isRetry = requestIdCorroborated || (!!match && (now - ts(match.updated_at || match.created_at)) < 2 * 60 * 1000);'
].join('\n');

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const node = (workflow) => {
  const found = workflow.nodes.find((item) => item.name === NODE_NAME);
  if (!found) fail(workflow.name + ': missing ' + NODE_NAME);
  if (found.type !== 'n8n-nodes-base.code') fail(NODE_NAME + ': not a Code node');
  return found;
};

export const sha = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

export function readReplacement(root) {
  const source = readFileSync(join(root, 'n8n', 'src', 'lead-intake', 'dedup-guard.js'), 'utf8').replace(/\r\n/g, '\n');
  const match = source.match(/\/\/ Retry is an identity verdict[\s\S]*?const isRetry = requestIdCorroborated;/);
  if (!match) fail('tracked source lacks the identity-only retry block');
  if (source.includes('const isRetry = requestIdCorroborated ||')) fail('tracked source retains the clock heuristic');
  return match[0];
}

export function isApplied(workflow, replacement) {
  const code = String(node(workflow).parameters.jsCode || '').replace(/\r\n/g, '\n');
  return code.includes(replacement) && !code.includes(OLD_BLOCK);
}

export function patchFalseRetry(workflow, replacement) {
  if (isApplied(workflow, replacement)) fail('correction already applied');
  const out = clone(workflow);
  const target = node(out);
  const code = String(target.parameters.jsCode || '').replace(/\r\n/g, '\n');
  const parts = code.split(OLD_BLOCK);
  if (parts.length !== 2) fail('clock-heuristic block matched ' + (parts.length - 1) + ' times, expected exactly 1');
  target.parameters.jsCode = parts[0] + replacement + parts[1];
  if (!isApplied(out, replacement)) fail('candidate does not carry the identity-only retry rule');
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
    sheets: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.googleSheets').map((item) => [item.name, item.parameters, item.credentials]),
    settings: workflow.settings || {}
  };
}
