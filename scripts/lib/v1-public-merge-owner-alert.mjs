// FINMENTOR V1 — public (website) merge reaches the single X-Ray owner alert.
//
// 2026-09-18 RU incident: a website Financial X-Ray that merged into an existing lead committed
// (Leads archive, Pipeline merge, lead_merged activity) but produced no owner alert. Every eligible
// lead's legacy intake alert is suppressed in favour of the X-Ray owner alert, and Build C3
// Intelligence Request returned nothing for a public merge, so the owner route was never invoked.
//
// The correction is exactly parameters.jsCode of one Code node. Everything else is proven
// unchanged, and the graph facts the correction relies on are proven on the live workflow.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const IDS = Object.freeze({ leadIntake: 'QmIyEW2ZEqKregmN', xray: 'tNSMRoKlFB52vjge' });
export const NODE_NAME = 'Build C3 Intelligence Request';
export const EXPECTED_PRE_VERSION = '4707ff76-da4f-49e8-b80c-74c6ceeea93c';

// The public branch as deployed before this correction. The live node must contain it exactly
// once and must otherwise equal the tracked source, so the pre-image is pinned without a hash.
export const OLD_PUBLIC_BRANCH = [
  '  // Public merges retain their existing response/side-effect contract. This correction is bounded',
  '  // to the authenticated Mini App path whose durable receipt provides the commit authority.',
  '  if (merged) return [];',
  '  let publicNew = false;',
  "  try { publicNew = $('Respond New Lead').isExecuted === true && $('Save to Pipeline').isExecuted === true; } catch (e) {}",
  '  if (!publicNew) return [];',
  "  commitAuthority = 'PUBLIC_PIPELINE_COMMIT';"
].join('\n');
export const OLD_HEADER = '//   public   — the successful Pipeline append reached Respond New Lead.';

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };
const lf = (text) => String(text || '').replace(/\r\n/g, '\n');

export function node(workflow, name = NODE_NAME) {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing ' + name);
  return found;
}

export function readReplacement(root) {
  const source = lf(readFileSync(join(root, 'n8n', 'src', 'lead-intake', 'c3-intelligence-request.js'), 'utf8'));
  if (source.includes('if (merged) return [];')) fail('tracked source still refuses public merges');
  if (!source.includes("commitAuthority = merged ? 'PUBLIC_PIPELINE_MERGE' : 'PUBLIC_PIPELINE_COMMIT';")) fail('tracked source lacks the public merge authority');
  if (!/\$\('Respond Merged'\)\.isExecuted === true && \$\('Update Pipeline \(Merge\)'\)\.isExecuted === true/.test(source)) fail('tracked source lacks the Pipeline merge commit proof');
  return source;
}

// The exact pre-image this correction replaces, reconstructed from the tracked source.
export function preImage(replacement) {
  const start = replacement.indexOf('  // A committed public merge is a new request');
  const end = replacement.indexOf("commitAuthority = merged ? 'PUBLIC_PIPELINE_MERGE' : 'PUBLIC_PIPELINE_COMMIT';");
  if (start < 0 || end < 0) fail('tracked source public branch not found');
  const endLine = end + "commitAuthority = merged ? 'PUBLIC_PIPELINE_MERGE' : 'PUBLIC_PIPELINE_COMMIT';".length;
  const header = replacement.split('\n').filter((line) => line.startsWith('//   public   —') || line.startsWith('//              Pipeline merge'));
  if (header.length !== 2) fail('tracked source header not found');
  return (replacement.slice(0, start) + OLD_PUBLIC_BRANCH + replacement.slice(endLine))
    .replace(header.join('\n'), OLD_HEADER);
}

export function isApplied(workflow, replacement) {
  return lf(node(workflow).parameters.jsCode) === replacement;
}

export function isPreImage(workflow, replacement) {
  const code = lf(node(workflow).parameters.jsCode);
  return code.split(OLD_PUBLIC_BRANCH).length === 2 && code === preImage(replacement);
}

export function patch(workflow, replacement) {
  if (isApplied(workflow, replacement)) fail('correction already applied');
  if (!isPreImage(workflow, replacement)) fail('live ' + NODE_NAME + ' is not the expected pre-image');
  const out = clone(workflow);
  node(out).parameters.jsCode = replacement;
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function protectedShape(workflow) {
  return {
    nodeSet: workflow.nodes.map((item) => [item.name, item.type, item.typeVersion, !!item.disabled]),
    connections: workflow.connections,
    credentials: workflow.nodes.filter((item) => item.credentials).map((item) => [item.name, item.credentials]),
    schedules: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => [item.name, item.parameters]),
    webhooks: workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.respondToWebhook'].includes(item.type))
      .map((item) => [item.name, item.parameters]),
    sheets: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.googleSheets').map((item) => [item.name, item.parameters, item.credentials]),
    telegram: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.telegram').map((item) => [item.name, item.parameters, item.credentials, !!item.disabled]),
    settings: workflow.settings || {}
  };
}

// ── the graph facts the correction relies on, proven on whatever workflow is passed in ────────
const edges = (workflow, name) => ((workflow.connections[name] || {}).main || [])
  .map((branch, output) => (branch || []).map((edge) => ({ to: edge.node, output }))).flat();
function reach(workflow, start) {
  const seen = new Set();
  (function walk(name) { for (const e of edges(workflow, name)) { if (!seen.has(e.to)) { seen.add(e.to); walk(e.to); } } })(start);
  return seen;
}
function predecessors(workflow, target) {
  const out = [];
  for (const [from, conn] of Object.entries(workflow.connections)) {
    ((conn || {}).main || []).forEach((branch, output) => (branch || []).forEach((edge) => { if (edge.node === target) out.push(from + '#' + output); }));
  }
  return out.sort();
}

export function graphFacts(workflow) {
  const facts = [];
  const want = (condition, message) => { if (!condition) fail('graph: ' + message); facts.push(message); };
  want(!reach(workflow, 'Respond Retry').has(NODE_NAME), 'a public retry (Respond Retry) cannot reach ' + NODE_NAME);
  want(JSON.stringify(predecessors(workflow, 'Respond Merged')) === JSON.stringify(['IF Internal (Merge)#1']), 'Respond Merged is reached only from IF Internal (Merge) public branch');
  want(JSON.stringify(predecessors(workflow, 'IF Internal (Merge)')) === JSON.stringify(['Update Pipeline (Merge)#0']), 'IF Internal (Merge) is reached only from a successful Update Pipeline (Merge)');
  want(edges(workflow, 'Restore Lead Context (Merged)').some((e) => e.to === 'Save Lead to CRM'), 'the merged request is archived by Save Lead to CRM');
  want(JSON.stringify(edges(workflow, 'Save Lead to CRM').map((e) => e.to)) === JSON.stringify([NODE_NAME]), 'Save Lead to CRM feeds only ' + NODE_NAME);
  want(JSON.stringify(edges(workflow, NODE_NAME).map((e) => e.to)) === JSON.stringify(['Run Owner Intelligence (C3)']), NODE_NAME + ' feeds only Run Owner Intelligence (C3)');
  const c3 = node(workflow, 'Run Owner Intelligence (C3)');
  want(c3.parameters.workflowId && c3.parameters.workflowId.value === IDS.xray, 'Run Owner Intelligence (C3) targets X-Ray ' + IDS.xray);
  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert']) {
    const code = lf(node(workflow, name).parameters.jsCode);
    want(code.includes('if (__v1Lead.provenance_trusted === true || __v1Eligible) return [];'), name + ' suppresses eligible leads (X-Ray is the single owner alert)');
  }
  return facts;
}
