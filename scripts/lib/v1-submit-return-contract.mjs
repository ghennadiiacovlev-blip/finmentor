// FINMENTOR V1 — Lead Intake internal return contract, pure patcher and proof.
//
// INCIDENT 2026-09-16 15:26 (Europe/Chisinau). A real RO Mini App submission was durably
// COMMITTED (receipt sub_6b35…, lead FIN-1789469658573-427, mode merged) and the client was told
// «Solicitarea nu a fost încă trimisă». Mini App Submit received INTAKE_NOT_OK / retryable=false
// from `Call Lead Intake` 23.6 s after the receipt settled.
//
// ROOT CAUSE. A sub-workflow called through Execute Workflow returns the output of the LAST NODE
// EXECUTED. With `executionOrder: 'v1'` n8n runs the children of a fan-out DEPTH-FIRST, ordered by
// canvas position — smallest y first, then smallest x (packages/core WorkflowExecute:
// `nodesToAdd.sort(...)` + `nodeExecutionStack.unshift`). The 2026-09-16 10:22Z RO UAT correction
// rewired the committed Merge path through `Restore Lead Context (Merged)`, whose fan-out is
//
//     Explode Answers (y 16) · Save Lead to CRM (y 688) · IF Escalated (y 1100) · Build Intake Activity (y 1248)
//
// so the terminal chain `Save Lead to CRM → Build C3 … → Internal Result (Merge)` ran SECOND and
// `Build Intake Activity → Save Activity` ran LAST. The caller received a Google Sheets row (no
// `ok`), and `Parse Intake Result` mapped that to INTAKE_NOT_OK. The Activities sheet shows the
// `lead_merged` row written at 12:26:35.864Z, after the X-Ray failure ledger write at 12:26:30.169Z.
// The committed NEW path has carried the identical latent shape since the 2026-09-15 C3 closure
// (`Restore Lead Context` fans out to six consumers; `Build Intake Activity` is the bottom-most).
//
// The earlier repository belief that "depth beats connection order" was measured on probe
// workflows created without `executionOrder: 'v1'` (legacy v0 is breadth-first). Production Lead
// Intake IS v1. This module encodes the v1 rule and proves the terminal is last under it.
//
// THE CORRECTION (Lead Intake only, four nodes, zero connection changes):
//   1. the terminal chain entry `Save Lead to CRM` (with its linear tail) is moved BELOW every other
//      sibling of BOTH restorers, so under the v1 rule it is the last branch to start and its leaf
//      `Internal Result (…)` is the last node executed;
//   2. `Run Owner Intelligence (C3)` no longer waits for X-Ray (`waitForSubWorkflow: false`) — the
//      Mini App client aborts at 20 s (app-premium/net.js TIMEOUT_MS) and a synchronous model call
//      inside the submit response is a second, independent false-failure vector;
//   3. `Run Owner Intelligence (C3)` gets `onError: continueRegularOutput`, so an X-Ray that cannot
//      even be started becomes an ordinary item and never fails an already-committed intake.
//
// Nothing here calls n8n or touches the filesystem.

export const IDS = Object.freeze({ intake: 'QmIyEW2ZEqKregmN', xray: 'tNSMRoKlFB52vjge' });
export const RESTORERS = Object.freeze(['Restore Lead Context', 'Restore Lead Context (Merged)']);
export const CHAIN = Object.freeze(['Save Lead to CRM', 'Build C3 Intelligence Request', 'Run Owner Intelligence (C3)', 'Route C3 Result Mode']);
export const TERMINALS = Object.freeze(['Internal Result (Merge)', 'Internal Result (New)']);
export const ROW_GAP = 176;

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (message) => { throw new Error(message); };
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) fail(workflow.name + ': missing return-contract anchor ' + name);
  return found;
};
const pos = (workflow, name) => node(workflow, name).position || [0, 0];
export const targets = (workflow, name, output = 0) =>
  ((((workflow.connections[name] || {}).main || [])[output]) || []).map((item) => item.node);
export function feeders(workflow, name) {
  const out = [];
  for (const [source, conn] of Object.entries(workflow.connections || {})) {
    (conn.main || []).forEach((branch, output) => (branch || []).forEach((edge) => {
      if (edge.node === name) out.push({ source, output, index: edge.index || 0 });
    }));
  }
  return out;
}

// n8n `executionOrder: 'v1'` — the exact order nodes execute from `start`, given which outputs
// carry items. `decide(nodeName, outputIndex)` returns true when that output has data (default:
// every output). Children of one node are collected across its outputs, sorted with n8n's own
// comparator (larger y first, then larger x), and unshifted onto a LIFO stack — so the smallest
// (y, x) child runs first and each child's subtree completes before the next sibling starts.
export function v1ExecutionOrder(workflow, start, decide = () => true) {
  const byName = new Map(workflow.nodes.map((item) => [item.name, item]));
  const order = [];
  const visit = (name) => {
    order.push(name);
    const nodesToAdd = [];
    ((workflow.connections[name] || {}).main || []).forEach((branch, output) => {
      if (!decide(name, output)) return;
      for (const edge of branch || []) {
        const target = byName.get(edge.node);
        if (!target) fail('destination node not found: ' + edge.node);
        nodesToAdd.push({ name: edge.node, position: target.position || [0, 0] });
      }
    });
    nodesToAdd.sort((a, b) => {
      if (a.position[1] < b.position[1]) return 1;
      if (a.position[1] > b.position[1]) return -1;
      if (a.position[0] > b.position[0]) return -1;
      return 0;
    });
    // unshift in array order == execute in reverse array order
    for (const child of nodesToAdd.slice().reverse()) visit(child.name);
  };
  visit(start);
  return order;
}

// The two internal settlement scenarios the submit endpoint depends on. Every other output is
// assumed to carry items (a superset execution), which only makes the proof stricter.
export function internalScenarios() {
  const only = (choices) => (name, output) => Object.prototype.hasOwnProperty.call(choices, name) ? choices[name] === output : true;
  return [
    { label: 'merged, not escalated', start: 'IF Committed (Merge)', terminal: 'Internal Result (Merge)',
      decide: only({ 'IF Committed (Merge)': 0, 'IF Escalated': 1, 'Route C3 Result Mode': 0 }) },
    { label: 'merged, escalated', start: 'IF Committed (Merge)', terminal: 'Internal Result (Merge)',
      decide: only({ 'IF Committed (Merge)': 0, 'IF Escalated': 0, 'Route C3 Result Mode': 0 }) },
    { label: 'new', start: 'IF Committed (New)', terminal: 'Internal Result (New)',
      decide: only({ 'IF Committed (New)': 0, 'Route C3 Result Mode': 1 }) }
  ];
}

export function lastExecuted(workflow, scenario) {
  const order = v1ExecutionOrder(workflow, scenario.start, scenario.decide);
  return { last: order[order.length - 1], order };
}

// The structural proof. Throws on the first violated invariant; returns a small report otherwise.
export function assertReturnContract(workflow) {
  // 1. the terminal chain is linear and ends in leaves
  if (!same(targets(workflow, 'IF Committed (Merge)', 0), ['Restore Lead Context (Merged)'])) fail('committed Merge true branch drift');
  if (!same(targets(workflow, 'IF Committed (New)', 0), ['Restore Lead Context'])) fail('committed New true branch drift');
  if (!same(targets(workflow, 'Save Lead to CRM'), ['Build C3 Intelligence Request'])) fail('post-archive dispatch drift');
  if (!same(targets(workflow, 'Build C3 Intelligence Request'), ['Run Owner Intelligence (C3)'])) fail('dispatch call drift');
  if (!same(targets(workflow, 'Run Owner Intelligence (C3)'), ['Route C3 Result Mode'])) fail('C3 result router drift');
  if (!same(targets(workflow, 'Route C3 Result Mode', 0), ['Internal Result (Merge)'])) fail('Merge return drift');
  if (!same(targets(workflow, 'Route C3 Result Mode', 1), ['Internal Result (New)'])) fail('New return drift');
  for (const name of CHAIN) {
    const outs = (workflow.connections[name] || {}).main || [];
    outs.forEach((branch, output) => { if ((branch || []).length > 1) fail(name + ' output ' + output + ' fans out'); });
  }
  for (const name of TERMINALS) {
    if (((workflow.connections[name] || {}).main || []).some((branch) => (branch || []).length)) fail(name + ' is not a leaf');
  }

  // 2. nothing outside the chain feeds into it
  const only = (name, expected) => {
    const got = feeders(workflow, name).map((f) => f.source).sort();
    if (!same(got, expected.slice().sort())) fail(name + ' feeders drift: ' + got.join(', '));
  };
  only('Save Lead to CRM', RESTORERS.slice());
  only('Build C3 Intelligence Request', ['Save Lead to CRM']);
  only('Run Owner Intelligence (C3)', ['Build C3 Intelligence Request']);
  only('Route C3 Result Mode', ['Run Owner Intelligence (C3)']);
  only('Internal Result (Merge)', ['Route C3 Result Mode']);
  only('Internal Result (New)', ['Route C3 Result Mode']);

  // 3. no node waits on a second input anywhere — a waiting node is executed only when the stack
  //    is empty, i.e. AFTER the terminal
  for (const [source, conn] of Object.entries(workflow.connections || {})) {
    for (const branch of conn.main || []) for (const edge of branch || []) {
      if ((edge.index || 0) > 0) fail('multi-input edge ' + source + ' -> ' + edge.node + '#' + edge.index);
    }
  }

  // 4. the chain entry is strictly the bottom-most sibling on BOTH restorers
  const save = pos(workflow, 'Save Lead to CRM');
  const siblings = [];
  for (const restorer of RESTORERS) {
    const children = targets(workflow, restorer);
    if (!children.includes('Save Lead to CRM')) fail(restorer + ' no longer feeds Save Lead to CRM');
    for (const child of children) {
      if (child === 'Save Lead to CRM') continue;
      const p = pos(workflow, child);
      siblings.push({ restorer, child, y: p[1], x: p[0] });
      if (!(p[1] < save[1])) fail(restorer + ' sibling ' + child + ' (y ' + p[1] + ') is not above Save Lead to CRM (y ' + save[1] + ')');
    }
  }

  // 5. the X-Ray call cannot delay or fail the committed answer
  const run = node(workflow, 'Run Owner Intelligence (C3)');
  if (run.type !== 'n8n-nodes-base.executeWorkflow') fail('C3 call node type drift');
  if (String((run.parameters.workflowId || {}).value || '') !== IDS.xray) fail('C3 call targets ' + JSON.stringify(run.parameters.workflowId));
  if ((run.parameters.options || {}).waitForSubWorkflow !== false) fail('C3 call still waits for X-Ray inside the submit response');
  if (run.onError !== 'continueRegularOutput') fail('C3 call failure would fail a committed intake');
  if (run.alwaysOutputData !== true) fail('C3 call must always emit an item so the router runs');

  // 6. executable proof under the v1 rule
  const orders = internalScenarios().map((scenario) => {
    const { last, order } = lastExecuted(workflow, scenario);
    if (last !== scenario.terminal) fail('v1 order for "' + scenario.label + '" ends at ' + last + ', not ' + scenario.terminal);
    return { label: scenario.label, last, executed: order.length };
  });

  return { chainY: save[1], maxSiblingY: Math.max(...siblings.map((s) => s.y)), siblings, orders };
}

export function patchIntakeReturnContract(workflow) {
  const out = clone(workflow);
  const run = node(out, 'Run Owner Intelligence (C3)');
  if (run.type !== 'n8n-nodes-base.executeWorkflow') fail('Lead Intake: C3 call node type drift');
  if (String((run.parameters.workflowId || {}).value || '') !== IDS.xray) fail('Lead Intake: C3 call target drift');
  if ((run.parameters.options || {}).waitForSubWorkflow !== true) fail('Lead Intake: C3 call already detached — correction already applied?');
  if (run.onError) fail('Lead Intake: C3 call already carries onError=' + run.onError);
  if (run.alwaysOutputData !== true) fail('Lead Intake: C3 call alwaysOutputData drift');
  if (!same(targets(out, 'Run Owner Intelligence (C3)'), ['Route C3 Result Mode'])) fail('Lead Intake: C3 result router drift');

  const save = pos(out, 'Save Lead to CRM');
  let maxSiblingY = -Infinity;
  for (const restorer of RESTORERS) {
    for (const child of targets(out, restorer)) {
      if (child !== 'Save Lead to CRM') maxSiblingY = Math.max(maxSiblingY, pos(out, child)[1]);
    }
  }
  if (!Number.isFinite(maxSiblingY)) fail('Lead Intake: restorer fan-out not found');
  if (save[1] > maxSiblingY) fail('Lead Intake: terminal chain already bottom-most — correction already applied?');

  const dy = (maxSiblingY + ROW_GAP) - save[1];
  for (const name of CHAIN) {
    const target = node(out, name);
    const p = target.position || [0, 0];
    target.position = [p[0], p[1] + dy];
  }
  run.parameters.options = Object.assign({}, run.parameters.options, { waitForSubWorkflow: false });
  run.onError = 'continueRegularOutput';

  assertReturnContract(out);
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function protectedShape(workflow) {
  return {
    credentials: workflow.nodes.filter((item) => item.credentials).map((item) => [item.name, item.credentials]),
    schedules: workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => [item.name, item.parameters]),
    webhooks: workflow.nodes.filter((item) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.telegramTrigger', 'n8n-nodes-base.executeWorkflowTrigger'].includes(item.type))
      .map((item) => [item.name, item.parameters]),
    settings: workflow.settings || {}
  };
}
