// FINMENTOR V1 — X-Ray retry contract, pure patcher.
//
// DEFECT 1 (2026-09-16). `Select Pending Leads` retried a failed analysis only when the lead had
// exactly ONE ledger row. A lead with history (a published website analysis, or an exhausted
// failure) therefore never had its newest failed REQUEST retried, while `Analysis Failed Row`
// told the owner «Анализ не завершён и будет безопасно повторён». Lead FIN-1789469658573-427
// (15:26 incident) is the live case: two ledger rows, ATTEMPT=1, never selected.
//
// DEFECT 2 (surfaced by the first corrected sweep, 2026-09-16 14:00Z). Both ledger writers paired
// the model node's outputs with `Build Analysis Input` items by raw index. The model node only
// receives items that passed `IF Source Pair Safe`; an audit finding never reaches it. So when a
// legacy lead's retry became an audit finding, the NEXT lead's 429 was written under the legacy
// lead as a fresh row (XA-TG-…-MU3MTQ8J-F at 05:00Z, -MU46477P-F at 14:00Z carried
// FIN-1789469658573-427's failure) and the real row never advanced its attempt.
//
// CORRECTION (four Code nodes, sources under n8n/src/xray-analysis/):
//   Select Pending Leads  — retry authority is the lead's NEWEST ledger row; it is retried when it
//                            is a due, bounded ANALYSIS_FAILED row and no successful row exists for
//                            the same request_id; the retry carries the failed row's request_id;
//                            older rows never block and are never reprocessed; ties fail closed.
//   Build Analysis Input  — a retry pairs by request_id when the request is a Mini App submission
//                            (sub_…) or resolvable; a legacy failed row pairs by lead_id as before,
//                            instead of becoming an audit finding on every sweep.
//   Analysis Failed Row   — resolves each error item to the model node's OWN input through
//                            pairedItem (audit findings excluded); emits `retry_possible`
//                            (= !retry_exhausted) and renders the owner copy from that truth.
//   Validate + Store Rows — same pairing and the same `retry_possible` truth.
//
// No graph, credential, schedule, webhook, model or prompt change. Nothing here calls n8n.

import { readFixSources } from './v1-launch-blocker-fix.mjs';

export const IDS = Object.freeze({ xray: 'tNSMRoKlFB52vjge' });
export const PATCHED_NODES = Object.freeze(['Analysis Failed Row', 'Build Analysis Input', 'Select Pending Leads', 'Validate + Store Rows']);

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
    buildInput: sources.buildInput,
    analysisFailed: sources.analysisFailed,
    validateAnalysis: sources.validateAnalysis
  };
}

export const NODE_SOURCE = Object.freeze({
  'Select Pending Leads': 'selectPending',
  'Build Analysis Input': 'buildInput',
  'Analysis Failed Row': 'analysisFailed',
  'Validate + Store Rows': 'validateAnalysis'
});

// The exact strings the correction introduces; their presence proves the applied state.
export const MARKERS = Object.freeze({
  selectPending: ['RETRY AUTHORITY (V1 correction 2026-09-16)'],
  buildInput: ['const retryByRequest = '],
  analysisFailed: ['retry_possible: !exhausted', 'function pairedIndex('],
  validateAnalysis: ['retry_possible: !exhausted', 'function pairedIndex(']
});

export function isApplied(workflow, sources) {
  return PATCHED_NODES.every((name) => String(node(workflow, name).parameters.jsCode || '') === sources[NODE_SOURCE[name]]);
}

// Nodes whose live code differs from the tracked corrected source.
export function pendingNodes(workflow, sources) {
  return PATCHED_NODES.filter((name) => String(node(workflow, name).parameters.jsCode || '') !== sources[NODE_SOURCE[name]]);
}

export function patchXrayRetryContract(workflow, sources) {
  const out = clone(workflow);
  for (const name of PATCHED_NODES) {
    const target = node(out, name);
    if (target.type !== 'n8n-nodes-base.code') fail(name + ': not a Code node');
    for (const marker of MARKERS[NODE_SOURCE[name]]) {
      if (!sources[NODE_SOURCE[name]].includes(marker)) fail(name + ': tracked source lacks the correction marker ' + marker);
    }
  }
  const pending = pendingNodes(out, sources);
  if (!pending.length) fail('correction already applied: every patched node equals its tracked source');
  for (const name of pending) node(out, name).parameters.jsCode = sources[NODE_SOURCE[name]];
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

// Everything that is NOT a patched Code body must be identical between two shapes.
export function untouchedShape(workflow) {
  return {
    connections: workflow.connections,
    settings: workflow.settings || {},
    nodes: workflow.nodes.map((item) => {
      const copy = JSON.parse(JSON.stringify(item));
      if (PATCHED_NODES.includes(item.name)) delete copy.parameters.jsCode;
      return copy;
    })
  };
}
