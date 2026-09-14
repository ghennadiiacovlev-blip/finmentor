// FINMENTOR V1 Starter schedule policy: exact cadence, complete budget, and schedule-only drift guards.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../scripts/lib/compile-workflow-sdk.mjs';
import {
  SCHEDULE_TARGETS, ERROR_MONITOR, EVENT_DRIVEN_MONTHLY_ESTIMATE,
  STARTER_LIMIT, INTERNAL_TARGET, WARNING_LEVEL, SCHEDULE_TIMEZONE,
  OLD_FIXED_SCHEDULED_MONTHLY, NEW_FIXED_SCHEDULED_MONTHLY,
  ESTIMATED_EVENT_DRIVEN_MONTHLY, ESTIMATED_TOTAL_MONTHLY, SAFETY_RESERVE,
  prepareScheduleCandidate, assertScheduleOnlyDelta, assertScheduleReadback,
  assertErrorMonitorContract, importableWorkflow, __test
} from '../scripts/lib/starter-schedule-policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const clone = __test.clone;
const productionFiles = {
  SLA: 'LZ2mvKXbBikmeVTn.finmentor-sla-lead-watch-premium-final.json',
  DIGEST: 'imeJIDeNyaWDyXzh.finmentor-daily-lead-digest-premium-final.json',
  FOLLOWUP: 'zeLOCuf0K1bkaKl2.finmentor-followup-sequence-premium-v2.json'
};

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' - ' + detail : '')); }
}
function rejects(name, fn, fragment) {
  try { fn(); check(name, false, 'accepted unsafe mutation'); }
  catch (error) { check(name, !fragment || error.message.includes(fragment), error.message); }
}

const targets = Object.fromEntries(SCHEDULE_TARGETS.map((target) => [target.key, target]));
const live = {};
for (const key of Object.keys(productionFiles)) {
  live[key] = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'production', productionFiles[key]), 'utf8'));
}
const xrayCompiled = compileFile(path.join(ROOT, 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js'), {
  settings: { executionOrder: 'v1', timezone: SCHEDULE_TIMEZONE }
});
live.XRAY = Object.assign(xrayCompiled, {
  id: targets.XRAY.id,
  name: targets.XRAY.name,
  active: true,
  activeVersionId: 'test-active-version',
  staticData: null
});
live.XRAY.nodes.find((node) => node.name === targets.XRAY.nodeName).parameters = clone(targets.XRAY.oldParameters);

check('policy covers exactly the four active scheduled workflow ids',
  __test.same(SCHEDULE_TARGETS.map((target) => target.id).sort(), [
    'LZ2mvKXbBikmeVTn', 'imeJIDeNyaWDyXzh', 'tNSMRoKlFB52vjge', 'zeLOCuf0K1bkaKl2'
  ].sort()));
check('approved timezone is Europe/Chisinau', SCHEDULE_TIMEZONE === 'Europe/Chisinau');
check('X-Ray cron is weekdays 08:00 through 19:30 at :00/:30',
  targets.XRAY.newParameters.rule.interval[0].expression === '0,30 8-19 * * 1-5');
check('SLA cron is weekdays 08:00 through 20:00 every two hours',
  targets.SLA.newParameters.rule.interval[0].expression === '0 8-20/2 * * 1-5');
check('Digest cron is weekdays at 08:30',
  targets.DIGEST.newParameters.rule.interval[0].expression === '30 8 * * 1-5');
check('Followup cron is weekdays at 10:00 and 16:00',
  targets.FOLLOWUP.newParameters.rule.interval[0].expression === '0 10,16 * * 1-5');
check('X-Ray monthly fixed count is 528', targets.XRAY.newMonthlyExecutions === 528);
check('SLA monthly fixed count is 154', targets.SLA.newMonthlyExecutions === 154);
check('Digest monthly fixed count is 22', targets.DIGEST.newMonthlyExecutions === 22);
check('Followup monthly fixed count is 44', targets.FOLLOWUP.newMonthlyExecutions === 44);
check('old fixed scheduled total is 5,875', OLD_FIXED_SCHEDULED_MONTHLY === 5875);
check('new fixed scheduled total is 748 and below 900', NEW_FIXED_SCHEDULED_MONTHLY === 748 && NEW_FIXED_SCHEDULED_MONTHLY <= 900);
check('event-driven planning envelope is 950', ESTIMATED_EVENT_DRIVEN_MONTHLY === 950);
check('event-driven category estimate sums exactly',
  EVENT_DRIVEN_MONTHLY_ESTIMATE.reduce((sum, item) => sum + item.executions, 0) === ESTIMATED_EVENT_DRIVEN_MONTHLY);
check('projected normal total is 1,698 and within internal target',
  ESTIMATED_TOTAL_MONTHLY === 1698 && ESTIMATED_TOTAL_MONTHLY <= INTERNAL_TARGET);
check('Starter safety reserve is 802 and at least 700', SAFETY_RESERVE === 802 && SAFETY_RESERVE >= 700);
check('warning threshold is exactly 80% of Starter quota', WARNING_LEVEL === STARTER_LIMIT * 0.8 && WARNING_LEVEL === 2000);

for (const target of SCHEDULE_TARGETS) {
  const prepared = prepareScheduleCandidate(live[target.key]);
  check(target.key + ': candidate applies exact schedule and timezone',
    prepared.candidate.settings.timezone === SCHEDULE_TIMEZONE &&
    __test.same(prepared.candidate.nodes.find((node) => node.name === target.nodeName).parameters, target.newParameters));
  check(target.key + ': schedule-only delta guard passes', assertScheduleOnlyDelta(live[target.key], prepared.candidate));
  check(target.key + ': active state and connection graph are preserved',
    prepared.candidate.active === live[target.key].active && __test.same(prepared.candidate.connections, live[target.key].connections));
  check(target.key + ': import body excludes active state and keeps only supported workflow fields',
    __test.same(Object.keys(importableWorkflow(prepared.candidate)).sort(), ['connections', 'name', 'nodes', 'settings']));

  const readback = clone(prepared.candidate);
  readback.activeVersionId = 'new-active-version';
  check(target.key + ': exact readback passes published-state verification',
    assertScheduleReadback(live[target.key], prepared.candidate, readback));
}

const errorMonitor = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n', 'production', 'RBiFLhVjizMkAzrK.finmentor-error-monitor-premium.json'), 'utf8'));
check('Error Monitor identity is the approved workflow', errorMonitor.id === ERROR_MONITOR.id && errorMonitor.name === ERROR_MONITOR.name);
check('Error Monitor remains event/error-driven with no polling', assertErrorMonitorContract(errorMonitor));

{
  const prepared = prepareScheduleCandidate(live.SLA);
  const graphDrift = clone(prepared.candidate);
  graphDrift.connections = {};
  rejects('guard rejects graph drift', () => assertScheduleOnlyDelta(live.SLA, graphDrift), 'connection graph changed');

  const logicDrift = clone(prepared.candidate);
  logicDrift.nodes.find((node) => node.name !== targets.SLA.nodeName).parameters = { changed: true };
  rejects('guard rejects non-trigger business-logic drift', () => assertScheduleOnlyDelta(live.SLA, logicDrift), 'business-logic node changed');

  const credentialNode = prepared.candidate.nodes.find((node) => node.credentials);
  const credentialDrift = clone(prepared.candidate);
  credentialDrift.nodes.find((node) => node.name === credentialNode.name).credentials = { changed: { id: 'x', name: 'x' } };
  rejects('guard rejects credential drift', () => assertScheduleOnlyDelta(live.SLA, credentialDrift), 'credentials changed');

  const settingDrift = clone(prepared.candidate);
  settingDrift.settings.executionOrder = 'changed';
  rejects('guard rejects unrelated settings drift', () => assertScheduleOnlyDelta(live.SLA, settingDrift), 'setting unrelated');

  const activeDrift = clone(prepared.candidate);
  activeDrift.active = false;
  rejects('guard rejects active-state drift', () => assertScheduleOnlyDelta(live.SLA, activeDrift), 'active state changed');

  const nodeMetadataDrift = clone(prepared.candidate);
  nodeMetadataDrift.nodes.find((node) => node.name === targets.SLA.nodeName).typeVersion = 999;
  rejects('guard rejects schedule-node drift outside parameters',
    () => assertScheduleOnlyDelta(live.SLA, nodeMetadataDrift), 'schedule node changed outside parameters');

  const readbackDrift = clone(prepared.candidate);
  readbackDrift.activeVersionId = 'new-active-version';
  readbackDrift.nodes.find((node) => node.name === targets.SLA.nodeName).parameters = clone(targets.SLA.oldParameters);
  rejects('readback guard rejects a schedule that did not persist',
    () => assertScheduleReadback(live.SLA, prepared.candidate, readbackDrift), 'readback differs at nodes');
}

{
  const prepared = prepareScheduleCandidate(live.XRAY);
  const webhookDrift = clone(prepared.candidate);
  const webhook = webhookDrift.nodes.find((node) => /webhook/i.test(node.type));
  webhook.parameters.path = 'forbidden-path-change';
  rejects('guard rejects webhook drift', () => assertScheduleOnlyDelta(live.XRAY, webhookDrift), 'webhooks changed');
}

{
  const unexpected = clone(live.FOLLOWUP);
  unexpected.nodes.find((node) => node.name === targets.FOLLOWUP.nodeName).parameters = { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } };
  rejects('preparation rejects an unknown live schedule', () => prepareScheduleCandidate(unexpected), 'neither the approved old nor new contract');

  const wrongTimezone = clone(live.DIGEST);
  wrongTimezone.settings = Object.assign({}, wrongTimezone.settings, { timezone: 'UTC' });
  rejects('preparation rejects an unexpected live timezone', () => prepareScheduleCandidate(wrongTimezone), 'unexpected timezone');

  const inactive = clone(live.XRAY);
  inactive.active = false;
  rejects('preparation rejects loss of active/published state', () => prepareScheduleCandidate(inactive), 'not active/published');

  const polledErrorMonitor = clone(errorMonitor);
  polledErrorMonitor.nodes.push({ name: 'Forbidden Poll', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} });
  rejects('Error Monitor contract rejects polling', () => assertErrorMonitorContract(polledErrorMonitor), 'polling schedule');
}

console.log(`\nASSERTIONS: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
