#!/usr/bin/env node
// FINMENTOR V1 — Lead Intake internal return contract gate.
//
//   node qa/v1-submit-return-contract.test.mjs
//
// Offline. Rebuilds the accepted Lead Intake shape from the tracked candidate through the tracked
// patch chain (C3 closure → RO UAT correction → this correction) and proves, under n8n's
// `executionOrder: 'v1'` rule, that the node whose output the Mini App submit endpoint receives is
// `Internal Result (Merge)` / `Internal Result (New)` in every internal settlement scenario.
//
// It also keeps the 2026-09-16 15:26 defect reproducible: on the shape BEFORE this correction the
// same rule ends every internal scenario at `Save Activity` — the Google Sheets row the client was
// judged by. See scripts/lib/v1-submit-return-contract.mjs for the rule and the incident.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchLeadIntake, readC3Sources } from '../scripts/lib/c3-final-closure.mjs';
import { patchIntake, readCorrectionSources } from '../scripts/lib/v1-ro-uat-correction.mjs';
import {
  CHAIN, IDS, RESTORERS, TERMINALS, assertReturnContract, feeders, internalScenarios, lastExecuted,
  patchIntakeReturnContract, protectedShape, targets, v1ExecutionOrder
} from '../scripts/lib/v1-submit-return-contract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-source-candidate.json'), 'utf8'));
const accepted = patchIntake(patchLeadIntake(BASE, readC3Sources(ROOT)), readCorrectionSources(ROOT));
const corrected = patchIntakeReturnContract(accepted);

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};
const byName = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(workflow.name + ': missing ' + name);
  return found;
};
const link = (name) => ({ node: name, type: 'main', index: 0 });

// ── the v1 rule itself, on a tiny graph ────────────────────────────────────────────────────────

const probe = (positions, connections) => ({
  name: 'probe', connections,
  nodes: Object.entries(positions).map(([name, position]) => ({ name, type: 'n8n-nodes-base.code', position, parameters: {} }))
});

check('v1 rule — siblings run top-to-bottom, then left-to-right, each subtree before the next sibling', () => {
  const g = probe(
    { Start: [0, 0], Top: [0, 100], TopChild: [200, 100], Mid: [0, 200], LeftLow: [0, 300], RightLow: [100, 300] },
    { Start: { main: [[link('RightLow'), link('LeftLow'), link('Mid'), link('Top')]] }, Top: { main: [[link('TopChild')]] } }
  );
  eq(v1ExecutionOrder(g, 'Start'), ['Start', 'Top', 'TopChild', 'Mid', 'LeftLow', 'RightLow'], 'listed order must not matter');
});

check('v1 rule — an output without items adds no children', () => {
  const g = probe({ Start: [0, 0], A: [0, 100], B: [0, 200] }, { Start: { main: [[link('A')], [link('B')]] } });
  eq(v1ExecutionOrder(g, 'Start', (name, output) => output === 0), ['Start', 'A'], 'false output ran');
});

// ── the defect, reproduced on the accepted shape ──────────────────────────────────────────────

check('DEFECT — on the accepted 10:22Z shape every internal scenario returns Save Activity to the submit endpoint', () => {
  for (const scenario of internalScenarios()) {
    const { last } = lastExecuted(accepted, scenario);
    eq(last, 'Save Activity', scenario.label);
  }
  assert(byName(accepted, 'Build Intake Activity').position[1] > byName(accepted, 'Save Lead to CRM').position[1],
    'the activity branch is no longer below the terminal chain; re-read the incident before editing');
});

check('DEFECT — the accepted shape fails the structural contract on the bottom-most sibling', () => {
  let message = '';
  try { assertReturnContract(accepted); } catch (error) { message = error.message; }
  assert(message.includes('is not above Save Lead to CRM'), 'wrong or missing violation: ' + message);
});

// ── the correction ────────────────────────────────────────────────────────────────────────────

check('corrected shape satisfies the full return contract', () => {
  const report = assertReturnContract(corrected);
  assert(report.chainY > report.maxSiblingY, 'terminal chain is not below every sibling');
  eq(report.orders.map((row) => row.last), ['Internal Result (Merge)', 'Internal Result (Merge)', 'Internal Result (New)'], 'last node per scenario');
});

check('the committed answer is the LAST node executed in every internal scenario', () => {
  for (const scenario of internalScenarios()) {
    const { last, order } = lastExecuted(corrected, scenario);
    eq(last, scenario.terminal, scenario.label);
    assert(order.includes('Save Activity'), scenario.label + ': side effects were lost, not reordered');
    assert(order.includes('Save Lead to CRM'), scenario.label + ': Leads archive write lost');
  }
});

check('the chain moved as one row and nothing else moved', () => {
  const before = new Map(accepted.nodes.map((item) => [item.name, JSON.stringify(item.position)]));
  const dy = byName(corrected, 'Save Lead to CRM').position[1] - byName(accepted, 'Save Lead to CRM').position[1];
  assert(dy > 0, 'chain did not move down');
  for (const item of corrected.nodes) {
    if (CHAIN.includes(item.name)) {
      const prev = JSON.parse(before.get(item.name));
      eq(item.position, [prev[0], prev[1] + dy], item.name + ' offset');
    } else {
      eq(JSON.stringify(item.position), before.get(item.name), item.name + ' must not move');
    }
  }
});

check('X-Ray leaves the submit response: detached, tolerant, still one call to the accepted workflow', () => {
  const calls = corrected.nodes.filter((item) => item.name === 'Run Owner Intelligence (C3)');
  eq(calls.length, 1, 'C3 call count');
  eq(calls[0].parameters.workflowId.value, IDS.xray, 'X-Ray workflow id');
  eq(calls[0].parameters.options.waitForSubWorkflow, false, 'the submit answer must not wait for a model call');
  eq(calls[0].onError, 'continueRegularOutput', 'an unstartable X-Ray must not fail a committed intake');
  eq(calls[0].alwaysOutputData, true, 'router must always receive an item');
  eq(calls[0].parameters.mode, byName(accepted, 'Run Owner Intelligence (C3)').parameters.mode, 'call mode unchanged');
});

check('graph, side effects and commit authority are untouched: zero connection changes', () => {
  eq(corrected.connections, accepted.connections, 'connections');
  eq(corrected.nodes.length, accepted.nodes.length, 'node count');
  eq(targets(corrected, 'IF Committed (Merge)', 0), ['Restore Lead Context (Merged)'], 'Merge true branch');
  eq(targets(corrected, 'IF Committed (New)', 0), ['Restore Lead Context'], 'New true branch');
  eq(targets(corrected, 'Save Lead to CRM'), ['Build C3 Intelligence Request'], 'C3 still after the Leads archive write');
  for (const name of TERMINALS) eq(targets(corrected, name), [], name + ' is a leaf');
  for (const restorer of RESTORERS) {
    eq(targets(corrected, restorer).sort(), targets(accepted, restorer).sort(), restorer + ' fan-out');
  }
});

check('only the four chain nodes differ, and only in position / detach / tolerance', () => {
  const before = new Map(accepted.nodes.map((item) => [item.name, item]));
  const changed = corrected.nodes.filter((item) => JSON.stringify(item) !== JSON.stringify(before.get(item.name))).map((item) => item.name).sort();
  eq(changed, CHAIN.slice().sort(), 'changed nodes');
  for (const name of CHAIN) {
    const a = JSON.parse(JSON.stringify(before.get(name))); const b = JSON.parse(JSON.stringify(byName(corrected, name)));
    delete a.position; delete b.position;
    if (name === 'Run Owner Intelligence (C3)') {
      delete a.onError; delete b.onError;
      delete a.parameters.options.waitForSubWorkflow; delete b.parameters.options.waitForSubWorkflow;
    }
    eq(b, a, name + ' changed beyond the bounded fields');
  }
});

check('credentials, triggers, schedules and settings are byte-identical', () => {
  eq(protectedShape(corrected), protectedShape(accepted), 'protected shape');
});

check('nothing outside the chain can feed the terminal chain', () => {
  eq(feeders(corrected, 'Save Lead to CRM').map((f) => f.source).sort(), RESTORERS.slice().sort(), 'chain entry feeders');
  eq(feeders(corrected, 'Internal Result (Merge)').map((f) => f.source), ['Route C3 Result Mode'], 'Merge terminal feeders');
  eq(feeders(corrected, 'Internal Result (New)').map((f) => f.source), ['Route C3 Result Mode'], 'New terminal feeders');
});

check('the patch refuses a shape it has already corrected, and a shape whose C3 call drifted', () => {
  let twice = '';
  try { patchIntakeReturnContract(corrected); } catch (error) { twice = error.message; }
  assert(twice.includes('already'), 'second application was accepted: ' + twice);
  const drifted = JSON.parse(JSON.stringify(accepted));
  drifted.nodes.find((item) => item.name === 'Run Owner Intelligence (C3)').parameters.workflowId.value = 'other';
  let drift = '';
  try { patchIntakeReturnContract(drifted); } catch (error) { drift = error.message; }
  assert(drift.includes('target drift'), 'drifted call target was accepted: ' + drift);
});

check('the contract detects a future canvas move that would re-open the incident', () => {
  const moved = JSON.parse(JSON.stringify(corrected));
  moved.nodes.find((item) => item.name === 'Build Intake Activity').position[1] = byName(corrected, 'Save Lead to CRM').position[1] + 1;
  let message = '';
  try { assertReturnContract(moved); } catch (error) { message = error.message; }
  assert(message.includes('Build Intake Activity'), 'canvas move not detected: ' + message);
  const { last } = lastExecuted(moved, internalScenarios()[0]);
  eq(last, 'Save Activity', 'the simulator must agree with the structural rule');
});

check('replay and refusal terminals stay leaves — a replayed submission returns its receipt, not a side effect', () => {
  for (const name of ['Internal Result (Committed Replay)', 'Internal Result (Retry)', 'Internal Result (Unresolved)']) {
    eq(targets(corrected, name), [], name);
  }
});

// ── end to end: what Mini App Submit actually parses ──────────────────────────────────────────
//
// `Parse Intake Result` lives in Mini App Submit (scripts/build-premium-endpoints.mjs, inlined at
// deploy). It is extracted here verbatim so the gate proves the whole contract: the node the
// child returns last → the item the parent parses → ok:1 or INTAKE_NOT_OK.

const builder = readFileSync(join(ROOT, 'scripts', 'build-premium-endpoints.mjs'), 'utf8').split('\n');
const parserStart = builder.findIndex((line) => line.includes("'const r = $input.first().json || {};'"));
const parserEnd = builder.findIndex((line, index) => index >= parserStart && line.includes("'return [{ json: { ok: 1, lead_id"));
const PARSER = builder.slice(parserStart, parserEnd + 1).map((line) => line.trim().replace(/^'/, '').replace(/',?$/, '')).join('\n');
const codeOf = (name) => String(byName(corrected, name).parameters.jsCode || '');
function runNode(body, named = {}, input = []) {
  const handle = (values) => { const items = values.map((json) => ({ json })); return { first: () => items[0], all: () => items, item: items[0], isExecuted: items.length > 0 }; };
  const $ = (name) => { if (!Object.prototype.hasOwnProperty.call(named, name)) throw new Error('node not executed: ' + name); return handle(named[name]); };
  return new Function('$', '$input', body)($, handle(input));
}
const parse = (item) => runNode(PARSER, {}, [item])[0].json;

check('parser extracted intact from the Submit builder', () => {
  assert(parserStart > 0 && parserEnd > parserStart, 'parser lines not found');
  assert(PARSER.includes('INTAKE_NOT_OK') && PARSER.includes('b.ok === true'), 'parser body incomplete');
});

check('MERGED durable acceptance: the terminal item parses as submit success', () => {
  const items = runNode(codeOf('Internal Result (Merge)'), { 'Build Merge Update': [{ lead_id: 'FIN-CANON', priority: 'HOT', financial_zone: 'GREEN' }] });
  eq(items.length, 1, 'terminal emits one item');
  const r = parse(items[0].json);
  eq(r, { ok: 1, lead_id: 'FIN-CANON', priority: 'HOT', financial_zone: 'GREEN' }, 'parsed merge acceptance');
});

check('NEW durable acceptance: the terminal item parses as submit success', () => {
  const items = runNode(codeOf('Internal Result (New)'), { 'Dedup Guard': [{ lead_id: 'FIN-NEW', lead_priority: 'WARM', financial_zone: 'UNKNOWN' }] });
  eq(items.length, 1, 'terminal emits one item');
  eq(parse(items[0].json), { ok: 1, lead_id: 'FIN-NEW', priority: 'WARM', financial_zone: 'UNKNOWN' }, 'parsed new acceptance');
});

check('a Save Activity sheet row can never be accepted as the intake verdict', () => {
  const sheetRow = { row_number: 512, activity_id: 'FIN-CANON', created_at: '2026-09-16T12:26:35.864Z', lead_id: 'FIN-CANON', actor: 'system:intake', channel: 'automation', type: 'lead_merged' };
  eq(parse(sheetRow), { ok: 0, error_code: 'INTAKE_NOT_OK', retryable: false, status: 503 }, 'the incident verdict');
  // and in the corrected graph that row is never what the child returns
  for (const scenario of internalScenarios()) {
    const { order } = lastExecuted(corrected, scenario);
    assert(order.indexOf('Save Activity') < order.length - 1, scenario.label + ': Save Activity is still last');
  }
});

check('X-Ray cannot block or alter the submit answer: detached call, routing reads the request, not the model', () => {
  const run = byName(corrected, 'Run Owner Intelligence (C3)');
  eq(run.parameters.options.waitForSubWorkflow, false, 'submit answer waits for X-Ray');
  eq(run.onError, 'continueRegularOutput', 'X-Ray start failure would fail the intake');
  const route = byName(corrected, 'Route C3 Result Mode');
  const left = String(route.parameters.conditions.conditions[0].leftValue);
  assert(left.includes("$('Build C3 Intelligence Request')") && !left.includes('$json'), 'router depends on the X-Ray output item');
  for (const name of TERMINALS) assert(!codeOf(name).includes('$input') && !codeOf(name).includes("$('Run Owner Intelligence (C3)')"), name + ' reads the X-Ray result');
});

check('X-Ray fire-and-forget dispatch occurs exactly once per committed submission', () => {
  const calls = corrected.nodes.filter((item) => item.type === 'n8n-nodes-base.executeWorkflow' && String((item.parameters.workflowId || {}).value) === IDS.xray);
  eq(calls.map((item) => item.name), ['Run Owner Intelligence (C3)'], 'X-Ray callers');
  eq(feeders(corrected, 'Run Owner Intelligence (C3)').length, 1, 'call feeders');
  eq(calls[0].parameters.mode, 'each', 'one call per request item');
  const merged = runNode(codeOf('Build C3 Intelligence Request'), {
    'Restore Lead Context (Merged)': [{ provenance_trusted: true, lead_id: 'FIN-CANON', request_id: 'sub_' + 'b'.repeat(32), lead_priority: 'HOT', status: 'Merged into FIN-CANON' }],
    'Commit Verdict (Merge)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  }, [{}]);
  eq(merged.length, 1, 'merged dispatch items');
  const fresh = runNode(codeOf('Build C3 Intelligence Request'), {
    'Restore Lead Context (Merged)': [],
    'Restore Lead Context': [{ provenance_trusted: true, lead_id: 'FIN-NEW', request_id: 'sub_' + 'c'.repeat(32), lead_priority: 'WARM' }],
    'Commit Verdict (New)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  }, [{}]);
  eq(fresh.length, 1, 'new dispatch items');
});

check('no duplicate lead on a replayed submission: the committed replay terminal reaches no write', () => {
  eq(targets(corrected, 'IF Receipt Settled', 0), ['Internal Result (Committed Replay)'], 'settled replay route');
  eq(targets(corrected, 'Internal Result (Committed Replay)'), [], 'replay terminal fans out');
  const reach = new Set(); const walk = (n) => { for (const branch of (corrected.connections[n] || {}).main || []) for (const e of branch || []) { if (!reach.has(e.node)) { reach.add(e.node); walk(e.node); } } };
  walk('Internal Result (Committed Replay)');
  eq([...reach], [], 'replay reaches side effects');
});

console.log('\nV1 submit return contract: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const failure of failures) console.log('  ' + failure);
  process.exit(1);
}
