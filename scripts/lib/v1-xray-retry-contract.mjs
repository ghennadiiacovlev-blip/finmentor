// FINMENTOR V1 — X-Ray retry contract, pure patcher.
//
// DEFECT (2026-09-16). `Select Pending Leads` retried a failed analysis only when the lead had
// exactly ONE ledger row. A lead with history (a published website analysis, or an exhausted
// failure) therefore never had its newest failed REQUEST retried, while `Analysis Failed Row`
// told the owner «Анализ не завершён и будет безопасно повторён». Lead FIN-1789469658573-427
// (15:26 incident) is the live case: two ledger rows, ATTEMPT=1, never selected.
//
// CORRECTION (three Code nodes, sources under n8n/src/xray-analysis/):
//   Select Pending Leads  — retry authority is the lead's NEWEST ledger row; it is retried when it
//                            is a due, bounded ANALYSIS_FAILED row and no successful row exists for
//                            the same request_id; the retry carries the failed row's request_id;
//                            older rows never block and are never reprocessed; ties fail closed.
//   Analysis Failed Row   — emits `retry_possible` (= !retry_exhausted) and renders the owner copy
//                            from that truth (owner-cards.js `renderFailed`).
//   Validate + Store Rows — same `retry_possible` truth on the validation-failure path.
//
// No graph, credential, schedule, webhook, model or prompt change. Nothing here calls n8n.

import { readFixSources } from './v1-launch-blocker-fix.mjs';

export const IDS = Object.freeze({ xray: 'tNSMRoKlFB52vjge' });
export const PATCHED_NODES = Object.freeze(['Analysis Failed Row', 'Select Pending Leads', 'Validate + Store Rows']);

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing retry-contract anchor ' + name);
  return found;
};

export function readRetrySources(root) {
  const sources = readFixSources(root);
  return {
    selectPending: sources.selectPending,
    analysisFailed: sources.analysisFailed,
    validateAnalysis: sources.validateAnalysis
  };
}

export const NODE_SOURCE = Object.freeze({
  'Select Pending Leads': 'selectPending',
  'Analysis Failed Row': 'analysisFailed',
  'Validate + Store Rows': 'validateAnalysis'
});

// The exact strings the correction introduces; their presence proves the applied state.
export const MARKERS = Object.freeze({
  selectPending: 'RETRY AUTHORITY (V1 correction 2026-09-16)',
  analysisFailed: 'retry_possible: !exhausted',
  validateAnalysis: 'retry_possible: !exhausted'
});

export function isApplied(workflow, sources) {
  return PATCHED_NODES.every((name) => String(node(workflow, name).parameters.jsCode || '') === sources[NODE_SOURCE[name]]);
}

export function patchXrayRetryContract(workflow, sources) {
  const out = clone(workflow);
  for (const name of PATCHED_NODES) {
    const target = node(out, name);
    if (target.type !== 'n8n-nodes-base.code') fail(name + ': not a Code node');
    const current = String(target.parameters.jsCode || '');
    const marker = MARKERS[NODE_SOURCE[name]];
    if (current.includes(marker)) fail(name + ': correction already applied');
    if (!sources[NODE_SOURCE[name]].includes(marker)) fail(name + ': tracked source lacks the correction marker');
    target.parameters.jsCode = sources[NODE_SOURCE[name]];
  }
  if (!isApplied(out, sources)) fail('patched X-Ray does not match tracked sources');
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function protectedShape(workflow) {
  return {
    credentials: workflow.nodes.filter((item) => item.credentials).map((item) => [item.name, item.credentials]),
    schedules: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => [item.name, item.parameters]),
    triggers: workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.telegramTrigger', 'n8n-nodes-base.executeWorkflowTrigger'].includes(item.type))
      .map((item) => [item.name, item.parameters]),
    model: workflow.nodes.filter((item) => item.type === '@n8n/n8n-nodes-langchain.openAi').map((item) => [item.name, item.parameters, item.retryOnFail, item.maxTries, item.waitBetweenTries]),
    sheets: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.googleSheets').map((item) => [item.name, item.parameters]),
    settings: workflow.settings || {}
  };
}
