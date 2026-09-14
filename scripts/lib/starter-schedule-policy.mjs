// FINMENTOR V1 Starter execution-budget policy.
//
// This module is intentionally limited to Schedule Trigger parameters and the workflow
// timezone that gives those parameters their meaning. It has no CRM, webhook, credential,
// data, visibility, or business-logic mutation surface.

const clone = (value) => JSON.parse(JSON.stringify(value));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const json = (value) => JSON.stringify(canonical(value));
const same = (a, b) => json(a) === json(b);
const cron = (expression) => ({ rule: { interval: [{ field: 'cronExpression', expression }] } });

export const STARTER_LIMIT = 2500;
export const INTERNAL_TARGET = 1800;
export const WARNING_LEVEL = 2000;
export const SCHEDULE_TIMEZONE = 'Europe/Chisinau';
export const BUSINESS_DAYS_PER_MONTH = 22;
export const AVERAGE_CALENDAR_DAYS_PER_MONTH = 365.25 / 12;

const everyTenMinutes = Math.round(AVERAGE_CALENDAR_DAYS_PER_MONTH * 24 * 6);
const hourly = Math.round(AVERAGE_CALENDAR_DAYS_PER_MONTH * 24);
const daily = Math.round(AVERAGE_CALENDAR_DAYS_PER_MONTH);

export const SCHEDULE_TARGETS = Object.freeze([
  {
    key: 'XRAY',
    id: 'tNSMRoKlFB52vjge',
    name: 'FINMENTOR X-Ray Analysis',
    nodeName: 'Every 10 Minutes', // Legacy node name is preserved to avoid graph/name drift.
    oldSchedule: 'Every 10 minutes, 24/7',
    oldMonthlyExecutions: everyTenMinutes,
    oldParameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } },
    newSchedule: 'Mon-Fri 08:00-19:30, every 30 minutes (08:00-20:00 half-open window)',
    newMonthlyExecutions: BUSINESS_DAYS_PER_MONTH * 24,
    newParameters: cron('0,30 8-19 * * 1-5')
  },
  {
    key: 'SLA',
    id: 'LZ2mvKXbBikmeVTn',
    name: 'FINMENTOR SLA Lead Watch PREMIUM FINAL',
    nodeName: 'Hourly SLA Check',
    oldSchedule: 'Every hour, 24/7',
    oldMonthlyExecutions: hourly,
    oldParameters: { rule: { interval: [{ field: 'hours' }] } },
    newSchedule: 'Mon-Fri 08:00-20:00, every 2 hours',
    newMonthlyExecutions: BUSINESS_DAYS_PER_MONTH * 7,
    newParameters: cron('0 8-20/2 * * 1-5')
  },
  {
    key: 'DIGEST',
    id: 'imeJIDeNyaWDyXzh',
    name: 'FINMENTOR Daily Lead Digest PREMIUM FINAL',
    nodeName: 'Daily Digest Schedule',
    oldSchedule: 'Daily at 08:30',
    oldMonthlyExecutions: daily,
    oldParameters: { rule: { interval: [{ triggerAtHour: 8, triggerAtMinute: 30 }] } },
    newSchedule: 'Mon-Fri at 08:30',
    newMonthlyExecutions: BUSINESS_DAYS_PER_MONTH,
    newParameters: cron('30 8 * * 1-5')
  },
  {
    key: 'FOLLOWUP',
    id: 'zeLOCuf0K1bkaKl2',
    name: 'FINMENTOR Followup Sequence PREMIUM v2',
    nodeName: 'Hourly Followup Check',
    oldSchedule: 'Every hour, 24/7',
    oldMonthlyExecutions: hourly,
    oldParameters: { rule: { interval: [{ field: 'hours' }] } },
    newSchedule: 'Mon-Fri at 10:00 and 16:00',
    newMonthlyExecutions: BUSINESS_DAYS_PER_MONTH * 2,
    newParameters: cron('0 10,16 * * 1-5')
  }
]);

export const ERROR_MONITOR = Object.freeze({
  key: 'ERROR_MONITOR',
  id: 'RBiFLhVjizMkAzrK',
  name: 'FINMENTOR Error Monitor PREMIUM',
  nodeName: 'Error Monitor Trigger',
  oldSchedule: 'Error Trigger (event-driven)',
  oldMonthlyExecutions: 0,
  newSchedule: 'Error Trigger (event-driven; no polling)',
  newMonthlyExecutions: 0
});

export const EVENT_DRIVEN_MONTHLY_ESTIMATE = Object.freeze([
  { category: 'Telegram', executions: 240 },
  { category: 'Mini App', executions: 90 },
  { category: 'Lead Intake', executions: 120 },
  { category: 'Gateway / Session / Submit', executions: 330 },
  { category: 'Manual owner operations', executions: 120 },
  { category: 'Errors / retries', executions: 50 }
]);

export const OLD_FIXED_SCHEDULED_MONTHLY = SCHEDULE_TARGETS.reduce((sum, item) => sum + item.oldMonthlyExecutions, 0);
export const NEW_FIXED_SCHEDULED_MONTHLY = SCHEDULE_TARGETS.reduce((sum, item) => sum + item.newMonthlyExecutions, 0);
export const ESTIMATED_EVENT_DRIVEN_MONTHLY = EVENT_DRIVEN_MONTHLY_ESTIMATE.reduce((sum, item) => sum + item.executions, 0);
export const ESTIMATED_TOTAL_MONTHLY = NEW_FIXED_SCHEDULED_MONTHLY + ESTIMATED_EVENT_DRIVEN_MONTHLY;
export const SAFETY_RESERVE = STARTER_LIMIT - ESTIMATED_TOTAL_MONTHLY;

function credentialsSignature(workflow) {
  return (workflow.nodes || [])
    .filter((node) => node.credentials)
    .map((node) => [node.name, node.credentials])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function webhookSignature(workflow) {
  return (workflow.nodes || [])
    .filter((node) => node.webhookId || /webhook/i.test(String(node.type || '')))
    .map((node) => [node.name, node])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function settingsWithoutTimezone(settings) {
  const result = clone(settings || {});
  delete result.timezone;
  return result;
}

function targetFor(workflow) {
  const target = SCHEDULE_TARGETS.find((item) => item.id === workflow?.id);
  if (!target) throw new Error('workflow is outside the Starter schedule policy: ' + String(workflow?.id || 'missing id'));
  return target;
}

export function assertScheduleOnlyDelta(before, candidate, target = targetFor(before)) {
  if (!before || !candidate || before.id !== target.id || candidate.id !== before.id) throw new Error(target.id + ': identity changed');
  if (before.name !== target.name || candidate.name !== before.name) throw new Error(target.id + ': workflow name changed');
  if (before.active !== candidate.active) throw new Error(target.id + ': active state changed');
  if (!same(before.connections || {}, candidate.connections || {})) throw new Error(target.id + ': connection graph changed');
  if (!same(before.staticData ?? null, candidate.staticData ?? null)) throw new Error(target.id + ': staticData changed');
  if (!same(settingsWithoutTimezone(before.settings), settingsWithoutTimezone(candidate.settings))) {
    throw new Error(target.id + ': a setting unrelated to schedule timezone changed');
  }
  if ((candidate.settings || {}).timezone !== SCHEDULE_TIMEZONE) throw new Error(target.id + ': timezone is not ' + SCHEDULE_TIMEZONE);
  if (!same(credentialsSignature(before), credentialsSignature(candidate))) throw new Error(target.id + ': credentials changed');
  if (!same(webhookSignature(before), webhookSignature(candidate))) throw new Error(target.id + ': webhooks changed');
  if (!Array.isArray(before.nodes) || before.nodes.length !== candidate.nodes?.length) throw new Error(target.id + ': node count changed');

  for (let index = 0; index < before.nodes.length; index++) {
    const oldNode = before.nodes[index];
    const newNode = candidate.nodes[index];
    if (!newNode || newNode.name !== oldNode.name) throw new Error(target.id + ': node order/name changed at index ' + index);
    if (oldNode.name !== target.nodeName) {
      if (!same(oldNode, newNode)) throw new Error(target.id + ': business-logic node changed: ' + oldNode.name);
      continue;
    }
    const oldStable = clone(oldNode);
    const newStable = clone(newNode);
    delete oldStable.parameters;
    delete newStable.parameters;
    if (!same(oldStable, newStable)) throw new Error(target.id + ': schedule node changed outside parameters');
    if (!same(newNode.parameters, target.newParameters)) throw new Error(target.id + ': schedule parameters do not match policy');
  }
  return true;
}

export function prepareScheduleCandidate(live) {
  const target = targetFor(live);
  if (live.name !== target.name) throw new Error(target.id + ': unexpected workflow name: ' + String(live.name));
  if (live.active !== true) throw new Error(target.id + ': workflow is not active/published before preparation');
  const scheduleNodes = (live.nodes || []).filter((node) => node.type === 'n8n-nodes-base.scheduleTrigger');
  if (scheduleNodes.length !== 1 || scheduleNodes[0].name !== target.nodeName) {
    throw new Error(target.id + ': expected exactly one schedule trigger named ' + target.nodeName);
  }
  if (!same(scheduleNodes[0].parameters, target.oldParameters) && !same(scheduleNodes[0].parameters, target.newParameters)) {
    throw new Error(target.id + ': live schedule is neither the approved old nor new contract');
  }
  const liveTimezone = (live.settings || {}).timezone ?? null;
  if (liveTimezone !== null && liveTimezone !== SCHEDULE_TIMEZONE) {
    throw new Error(target.id + ': refusing to replace unexpected timezone ' + liveTimezone);
  }

  const candidate = clone(live);
  candidate.nodes.find((node) => node.name === target.nodeName).parameters = clone(target.newParameters);
  candidate.settings = clone(live.settings || {});
  candidate.settings.timezone = SCHEDULE_TIMEZONE;
  assertScheduleOnlyDelta(live, candidate, target);
  return { target, candidate, changed: !same(live, candidate) };
}

export function assertScheduleReadback(before, candidate, after) {
  const target = targetFor(before);
  assertScheduleOnlyDelta(before, candidate, target);
  if (!after || after.id !== before.id || after.name !== before.name) throw new Error(target.id + ': readback identity changed');
  if (after.active !== before.active || (before.active && !after.activeVersionId)) {
    throw new Error(target.id + ': active/published state was not preserved');
  }
  for (const key of ['nodes', 'connections', 'settings']) {
    if (!same(after[key] || {}, candidate[key] || {})) throw new Error(target.id + ': readback differs at ' + key);
  }
  if (!same(after.staticData ?? null, before.staticData ?? null)) throw new Error(target.id + ': staticData changed after write');
  if (!same(credentialsSignature(after), credentialsSignature(before))) throw new Error(target.id + ': credentials changed after write');
  if (!same(webhookSignature(after), webhookSignature(before))) throw new Error(target.id + ': webhooks changed after write');
  return true;
}

export function assertErrorMonitorContract(workflow) {
  if (!workflow || workflow.id !== ERROR_MONITOR.id || workflow.name !== ERROR_MONITOR.name) {
    throw new Error('Error Monitor identity mismatch');
  }
  if (workflow.active !== true) throw new Error('Error Monitor is not active/published');
  const schedules = (workflow.nodes || []).filter((node) => node.type === 'n8n-nodes-base.scheduleTrigger');
  const errors = (workflow.nodes || []).filter((node) => node.type === 'n8n-nodes-base.errorTrigger');
  if (schedules.length) throw new Error('Error Monitor has a polling schedule');
  if (errors.length !== 1 || errors[0].name !== ERROR_MONITOR.nodeName || !same(errors[0].parameters || {}, {})) {
    throw new Error('Error Monitor Error Trigger contract changed');
  }
  return true;
}

export function importableWorkflow(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export const __test = Object.freeze({ clone, same, credentialsSignature, webhookSignature, settingsWithoutTimezone });
