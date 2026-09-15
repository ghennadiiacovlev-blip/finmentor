#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — C2 bounded candidate builder.
//
// Reads fresh, redacted production backups captured after the accepted C1 drift check. It never
// contacts n8n. SLA and Follow-up are copied as no-op repository authority because production
// already carries the correct dynamic keyboard contract; only Daily Digest and SYSTEM ALERT gain
// runtime changes.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAlertWorkflow } from './build-system-alert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const PRE = resolve(ROOT, arg('--pre', '.uat/c2-final-closure/pre'));
const OUT = resolve(ROOT, arg('--out', '.uat/c2-final-closure/candidates'));
const REPO_CANDIDATE = join(ROOT, 'n8n', 'candidate');

const IDS = {
  sla: 'LZ2mvKXbBikmeVTn',
  followup: 'zeLOCuf0K1bkaKl2',
  daily: 'imeJIDeNyaWDyXzh',
  systemAlert: 'ID700kTo6EXffwry',
  host: 'KBD7Q94QQnlzgYKJ'
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const stable = (value) => JSON.stringify(value);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const loadPre = (id) => read(join(PRE, id + '.json'));
const importable = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings || {}
});
const node = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(workflow.name + ': missing node ' + name);
  return found;
};
const replaceOnce = (text, before, after, label) => {
  const count = String(text).split(before).length - 1;
  if (count !== 1) throw new Error(label + ': expected one anchor, found ' + count);
  return String(text).replace(before, after);
};
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');

function inlineCommonJs(name, source) {
  const marker = 'module.exports = ';
  const at = source.lastIndexOf(marker);
  if (at < 0) throw new Error(name + ': module export marker missing');
  return 'const ' + name + ' = (function () {\n' + source.slice(0, at) + '\nreturn '
    + source.slice(at + marker.length).replace(/;\s*$/, '') + ';\n})();';
}

const warningSource = readFileSync(join(ROOT, 'n8n', 'src', 'system-alert', 'data-warning.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const WARNING_INLINE = inlineCommonJs('DWD', warningSource);

const DETECT_WARNING = [
  '// INLINED FROM n8n/src/system-alert/data-warning.js — DO NOT EDIT HERE.',
  WARNING_INLINE,
  '',
  '// The required-data sets are calculated by Build Daily Digest using its existing C1 checks.',
  'const source = $input.first().json || {};',
  'const state = $getWorkflowStaticData("global");',
  'const verdict = DWD.evaluate(source.c2_data_warning || {}, state, source.c2_checked_at);',
  'return verdict.emit && verdict.event ? [{ json: verdict.event }] : [];'
].join('\n');

function executeSystemAlert(name, id, values, x, y) {
  return {
    parameters: {
      workflowId: { __rl: true, value: IDS.systemAlert, mode: 'list', cachedResultName: 'FINMENTOR SYSTEM ALERT' },
      workflowInputs: {
        mappingMode: 'defineBelow', value: values, matchingColumns: [], schema: [],
        attemptToConvertTypes: false, convertFieldsToString: true
      },
      mode: 'once', options: { waitForSubWorkflow: false }
    },
    id, name, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2,
    position: [x, y], onError: 'continueRegularOutput'
  };
}

function codeNode(name, id, jsCode, x, y) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
    id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y]
  };
}

function buildDaily(pre) {
  const next = clone(importable(pre));
  const build = node(next, 'Build Daily Digest');
  const before = 'return [{ json: { alert_html: alert_html, stats: stats } }];';
  const after = [
    '// C2 release integrity: expose the SAME three deterministic sets already used above.',
    '// Only lead ids enter this internal object; the downstream detector emits counts + a hash.',
    'const c2Ids = rows => rows.map((r, i) => val(r, "lead_id") || ("missing-lead-id-" + i)).sort();',
    'const c2_data_warning = {',
    '  missing_required_contact: c2Ids(noContact),',
    '  missing_next_action: c2Ids(noNextAction),',
    '  expired_snooze: c2Ids(snoozedExpired)',
    '};',
    'return [{ json: { alert_html: alert_html, stats: stats,',
    '  c2_data_warning: c2_data_warning, c2_checked_at: now.toISOString() } }];'
  ].join('\n');
  build.parameters.jsCode = replaceOnce(build.parameters.jsCode, before, after, 'Daily Digest data-warning export');

  const pos = build.position || [0, 0];
  const detect = codeNode('Detect Data Warning', 'c2-detect-data-warning', DETECT_WARNING, pos[0] + 220, pos[1] + 220);
  const emitWarning = executeSystemAlert('Emit Data Warning', 'c2-emit-data-warning', {
    event_type: 'data_warning',
    check_key: '={{ String($json.check_key || "") }}',
    fingerprint: '={{ String($json.fingerprint || "") }}',
    occurred_at: '={{ String($json.occurred_at || "") }}',
    missing_required_contact_count: '={{ Number($json.missing_required_contact_count || 0) }}',
    missing_next_action_count: '={{ Number($json.missing_next_action_count || 0) }}',
    expired_snooze_count: '={{ Number($json.expired_snooze_count || 0) }}'
  }, pos[0] + 440, pos[1] + 220);
  const emitRecovery = executeSystemAlert('Probe CRM Recovery', 'c2-probe-crm-recovery', {
    event_type: 'recovery_probe',
    proof_key: 'daily-digest:crm-read',
    occurred_at: '={{ String($json.c2_checked_at || $now.toISO()) }}'
  }, pos[0] + 220, pos[1] + 360);
  next.nodes.push(detect, emitWarning, emitRecovery);
  const main = next.connections['Build Daily Digest'].main[0];
  main.push(
    { node: 'Detect Data Warning', type: 'main', index: 0 },
    { node: 'Probe CRM Recovery', type: 'main', index: 0 }
  );
  next.connections['Detect Data Warning'] = { main: [[{ node: 'Emit Data Warning', type: 'main', index: 0 }]] };
  return next;
}

function buildSystemAlert(pre) {
  const next = clone(importable(pre));
  const generated = buildAlertWorkflow();
  for (const name of ['Normalise Alert Event', 'Build System Alert']) {
    node(next, name).parameters.jsCode = node(generated, name).parameters.jsCode;
  }
  return next;
}

function withoutVolatile(workflow) {
  const out = clone(importable(workflow));
  for (const item of out.nodes) {
    if (item.type === 'n8n-nodes-base.telegram' && (item.parameters || {}).operation === 'sendMessage') delete item.webhookId;
  }
  return out;
}

function verifyNoop(label, before, after) {
  if (stable(withoutVolatile(before)) !== stable(withoutVolatile(after))) {
    throw new Error(label + ': expected a no-op authority candidate');
  }
}

function verifyDaily(before, after) {
  const oldTrigger = node(before, 'Daily Digest Schedule');
  const newTrigger = node(after, 'Daily Digest Schedule');
  if (stable(oldTrigger) !== stable(newTrigger)) throw new Error('Daily Digest: schedule changed');
  if (stable(before.settings || {}) !== stable(after.settings || {})) throw new Error('Daily Digest: settings changed');
  if (after.nodes.length !== before.nodes.length + 3) throw new Error('Daily Digest: node delta is not +3');
  const allowed = new Set(['Build Daily Digest', 'Detect Data Warning', 'Emit Data Warning', 'Probe CRM Recovery']);
  for (const oldNode of before.nodes) {
    if (allowed.has(oldNode.name)) continue;
    if (stable(oldNode) !== stable(node(after, oldNode.name))) throw new Error('Daily Digest: unrelated node changed: ' + oldNode.name);
  }
  for (const added of ['Detect Data Warning', 'Emit Data Warning', 'Probe CRM Recovery']) {
    const item = node(after, added);
    if (item.credentials) throw new Error('Daily Digest: C2 node gained credentials: ' + added);
  }
  if (!node(after, 'Build Daily Digest').parameters.jsCode.includes('c2_data_warning')) {
    throw new Error('Daily Digest: existing checks are not exported');
  }
}

function verifySystem(before, after) {
  if (before.nodes.length !== after.nodes.length) throw new Error('SYSTEM ALERT: node count changed');
  if (stable(before.connections) !== stable(after.connections)) throw new Error('SYSTEM ALERT: connections changed');
  if (stable(before.settings || {}) !== stable(after.settings || {})) throw new Error('SYSTEM ALERT: settings changed');
  for (const oldNode of before.nodes) {
    const current = node(after, oldNode.name);
    if (['Normalise Alert Event', 'Build System Alert'].includes(oldNode.name)) {
      const a = clone(oldNode); const b = clone(current);
      a.parameters.jsCode = ''; b.parameters.jsCode = '';
      if (stable(a) !== stable(b)) throw new Error('SYSTEM ALERT: metadata changed: ' + oldNode.name);
    } else if (stable(oldNode) !== stable(current)) {
      throw new Error('SYSTEM ALERT: unrelated node changed: ' + oldNode.name);
    }
  }
}

mkdirSync(OUT, { recursive: true });

const pre = Object.fromEntries(Object.entries(IDS).map(([key, id]) => [key, loadPre(id)]));
const candidates = {
  sla: clone(importable(pre.sla)),
  followup: clone(importable(pre.followup)),
  daily: buildDaily(pre.daily),
  systemAlert: buildSystemAlert(pre.systemAlert),
  host: clone(importable(pre.host))
};

verifyNoop('SLA', pre.sla, candidates.sla);
verifyNoop('Follow-up', pre.followup, candidates.followup);
verifyDaily(pre.daily, candidates.daily);
verifySystem(pre.systemAlert, candidates.systemAlert);
verifyNoop('Mini App host', pre.host, candidates.host);

const repoNames = {
  sla: 'c2-sla-owner-control-candidate.json',
  followup: 'c2-followup-owner-control-candidate.json',
  daily: 'c2-daily-operational-signals-candidate.json',
  systemAlert: 'system-alert-workflow.json'
};
const report = [];
for (const [key, id] of Object.entries(IDS)) {
  const value = candidates[key];
  write(join(OUT, id + '.candidate.json'), value);
  if (repoNames[key]) write(join(REPO_CANDIDATE, repoNames[key]), value);
  report.push({
    key, id, active_before: pre[key].active === true,
    before_sha256: sha(withoutVolatile(pre[key])), candidate_sha256: sha(withoutVolatile(value)),
    mutation: key === 'daily' || key === 'systemAlert'
  });
}
write(join(OUT, 'manifest.json'), { generated_at: new Date().toISOString(), workflows: report });

console.log('C2 bounded candidates: PASS');
for (const row of report) {
  console.log('  ' + row.id + ' ' + row.key.padEnd(12) + (row.mutation ? 'MUTATION' : 'NO-OP')
    + ' before=' + row.before_sha256.slice(0, 16) + ' candidate=' + row.candidate_sha256.slice(0, 16));
}
console.log('  schedule / credentials / webhooks / CRM schema: unchanged');
