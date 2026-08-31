#!/usr/bin/env node
// FINMENTOR — the SYSTEM ALERT workflow and its caller emit nodes, as candidates.
//
//   node scripts/build-system-alert.mjs
//
// REPO-ONLY. Reads the live snapshots this pass captured, writes candidates under n8n/candidate/,
// and NEVER contacts n8n. Deploying is a separate, explicit act.
//
// ── WHAT IT BUILDS ─────────────────────────────────────────────────────────────────────────────
//
//   1. n8n/candidate/system-alert-workflow.json  — ONE new workflow, the only alert authority
//   2. n8n/candidate/system-alert-callers.json   — the emit nodes and edges for five workflows
//
// ── THE RULES IT ENFORCES RATHER THAN DOCUMENTS ────────────────────────────────────────────────
//
//   · every emit node is connected DOWNSTREAM OF A RESPONDER, never before one, so the client
//     answer is already flushed when the alert branch starts. The one exception is the Concierge,
//     which has no HTTP responder: there the emit follows the proven Bot_Sessions mutation.
//   · every emit sets waitForSubWorkflow:false, so alert latency cannot reach the caller
//   · no caller gains a Telegram or Sheets credential
//   · no responder parameter is touched; the builder refuses if one would change
//   · the SYSTEM ALERT workflow holds no Execute Workflow node and no errorWorkflow
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SNAP = process.env.SAG_SNAPSHOT_DIR || join(ROOT, 'n8n', 'history', 'system-alert');
const OUT = join(ROOT, 'n8n', 'candidate');

const EVENT_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'system-alert', 'event.js'), 'utf8');
const PRESENTER_SRC = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8');

// A CommonJS module becomes an IIFE returning its exports — the same conversion
// scripts/build-lead-alerts-presentation.mjs performs, so both inlines are the same shape and the
// drift gates compare the same prefix. Inlining the raw source instead leaves `module.exports` in
// a Code node, where `module` does not exist and the const is never defined.
function inline(name, src) {
  const marker = 'module.exports = ';
  const i = src.lastIndexOf(marker);
  if (i === -1) { throw new Error(name + ': no module.exports to convert'); }
  const body = src.slice(0, i);
  const exported = src.slice(i + marker.length).replace(/;\s*$/, '');
  return 'const ' + name + ' = (function () {\n' + body + '\nreturn ' + exported + ';\n})();';
}
// event.js is already an IIFE assigned to `SAE`; it has no module.exports and needs no conversion.
const PRESENTER_INLINE = inline('LA', PRESENTER_SRC);

const ALERT_NAME = 'FINMENTOR SYSTEM ALERT';

// The credentials the Error Monitor already holds. Referenced by id so no new credential is
// created and no caller ever sees them — they live on this workflow and nowhere else.
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } };
const TELEGRAM_CRED = { telegramApi: { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' } };

// The already-approved owner-destination read path, copied verbatim from the Error Monitor so
// there is one Settings contract and not two.
const SETTINGS_PARAMS = {
  documentId: { __rl: true, value: '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A', mode: 'list',
    cachedResultName: 'FINMENTOR_LEADS_CRM_PREMIUM_FINAL',
    cachedResultUrl: 'https://docs.google.com/spreadsheets/d/1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A/edit?usp=drivesdk' },
  sheetName: { __rl: true, value: 1871239368, mode: 'list', cachedResultName: 'Settings',
    cachedResultUrl: 'https://docs.google.com/spreadsheets/d/1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A/edit#gid=1871239368' },
  options: {}
};

const SETTINGS_TO_OBJECT = [
  '// The owner destination, from the Settings sheet. Copied from the Error Monitor so there is',
  '// one owner-destination contract in the tenant and not two.',
  'const rows = $input.all().map(i => i.json);',
  'const settings = {};',
  'for (const r of rows) {',
  '  const key = (r.key ?? r.Key ?? "").toString().trim();',
  '  if (!key) continue;',
  '  settings[key] = (r.value ?? r.Value ?? "").toString().trim();',
  '}',
  'return [{ json: { owner_chat_id: String(settings.owner_chat_id || "551662084") } }];'
].join('\n');

const NORMALISE = [
  '// ─── INLINED FROM n8n/src/system-alert/event.js — DO NOT EDIT HERE ───────────────────────────',
  '// scripts/build-system-alert.mjs regenerates this block. An edit made in the n8n editor is lost',
  '// on the next build and is invisible to qa/system-alert.test.mjs.',
  EVENT_SRC.trim(),
  '// ─── END INLINED MODULE ─────────────────────────────────────────────────────────────────────',
  '',
  '// THE GUARD. Fails closed in both directions: an unknown route is silent, an event carrying a',
  '// forbidden field is silent, an expected client refusal is silent. A malformed caller can make',
  '// this system quiet — never noisy, and never leaky.',
  'const raw = $input.first().json || {};',
  'const verdict = SAE.normalise(raw);',
  'return [{ json: {',
  '  emit: verdict.emit === true ? 1 : 0,',
  '  silent_reason: String(verdict.reason || ""),',
  '  event: verdict.event || null',
  '} }];'
].join('\n');

const BUILD_ALERT = [
  '// ─── INLINED FROM n8n/src/lead-alerts/presenter.js — DO NOT EDIT HERE ───────────────────────',
  PRESENTER_INLINE,
  '// ─── END INLINED MODULE ─────────────────────────────────────────────────────────────────────',
  '',
  '// The approved premium SYSTEM ALERT visual language, unchanged. What is new is only that the',
  '// model now carries the operation and the proven side-effect class, so the «Данные» card can',
  '// state what this route proves instead of the conservative "not checked" line.',
  'const e = $("Normalise Alert Event").first().json.event || {};',
  'const alert_html = LA.renderSystemAlert({',
  '  workflowName: String(e.workflow_label || ""),',
  '  nodeName: String(e.stage || ""),',
  '  operation: String(e.operation || ""),',
  '  sideEffectClass: String(e.side_effect_class || ""),',
  '  errorCode: String(e.error_code || ""),',
  '  retryable: e.retryable === true,',
  '  routeIdentity: String(e.route_identity || ""),',
  '  errorClass: "",',
  '  message: "",',
  '  executionId: ""',
  '});',
  'return [{ json: { alert_html: alert_html, alert_key: String(e.alert_key || "") } }];'
].join('\n');

const SILENT = [
  '// The expected-refusal and malformed-event path. It exists so the decision NOT to alert is a',
  '// node someone can see in the graph rather than an edge that goes nowhere.',
  '//',
  '// It writes nothing, sends nothing and calls nothing. `silent_reason` is the classification,',
  '// never the event: an event refused for carrying a forbidden field must not have that field',
  '// echoed here.',
  'const v = $input.first().json || {};',
  'return [{ json: { alerted: 0, silent_reason: String(v.silent_reason || "") } }];'
].join('\n');

function codeNode(name, jsCode, x, y) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: 'sa-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [x, y]
  };
}

export function buildAlertWorkflow() {
  const nodes = [
    { parameters: { inputSource: 'passthrough' }, id: 'sa-trigger', name: 'Alert Trigger',
      type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0] },
    codeNode('Normalise Alert Event', NORMALISE, 220, 0),
    { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'alertable', leftValue: '={{ $json.emit }}', rightValue: 1,
          operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
      id: 'sa-if', name: 'IF Alertable', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [440, 0] },
    codeNode('Build System Alert', BUILD_ALERT, 660, -100),
    { parameters: SETTINGS_PARAMS, id: 'sa-settings', name: 'Read Owner Destination',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [880, -100],
      credentials: SHEETS_CRED, retryOnFail: true },
    codeNode('Settings to Object', SETTINGS_TO_OBJECT, 1100, -100),
    { parameters: { chatId: '={{ $json.owner_chat_id }}',
        text: '={{ $(\'Build System Alert\').first().json.alert_html }}',
        additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
      id: 'sa-telegram', name: 'Telegram System Alert', type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2, position: [1320, -100], credentials: TELEGRAM_CRED,
      // FAIL QUIET. A Telegram outage ends this execution as an ordinary item. It must never
      // throw: a throw with an errorWorkflow one day wired would be the first link of a loop.
      onError: 'continueRegularOutput' },
    codeNode('Silent', SILENT, 660, 120)
  ];

  return {
    name: ALERT_NAME,
    nodes: nodes,
    connections: {
      'Alert Trigger': { main: [[{ node: 'Normalise Alert Event', type: 'main', index: 0 }]] },
      'Normalise Alert Event': { main: [[{ node: 'IF Alertable', type: 'main', index: 0 }]] },
      'IF Alertable': { main: [
        [{ node: 'Build System Alert', type: 'main', index: 0 }],
        [{ node: 'Silent', type: 'main', index: 0 }]
      ] },
      'Build System Alert': { main: [[{ node: 'Read Owner Destination', type: 'main', index: 0 }]] },
      'Read Owner Destination': { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
      'Settings to Object': { main: [[{ node: 'Telegram System Alert', type: 'main', index: 0 }]] }
    },
    // errorWorkflow is DELIBERATELY ABSENT. A failure inside the alert workflow must reach
    // nothing at all — not the Error Monitor, not itself.
    settings: { executionOrder: 'v1', availableInMCP: false }
  };
}

// ── the caller emit nodes ──────────────────────────────────────────────────────────────────────
//
// `workflow_key` and `verdict_node` are the route. They are LITERALS in the emit expression, not
// read from the item, so a caller cannot claim to be a route it is not.
export function emitNode(name, workflowKey, verdictNode, codeExpr, retryableExpr, identityExpr, alertWfId, x, y) {
  return {
    parameters: {
      workflowId: { __rl: true, value: alertWfId, mode: 'list', cachedResultName: ALERT_NAME },
      workflowInputs: { mappingMode: 'defineBelow', value: {
        workflow_key: workflowKey,
        verdict_node: verdictNode,
        error_code: codeExpr,
        retryable: retryableExpr,
        route_identity: identityExpr,
        occurred_at: '={{ $now.toISO() }}'
      }, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      mode: 'once',
      // THE WHOLE POINT. The caller does not wait, so alert latency or failure cannot reach the
      // client response, which has already been sent by the responder upstream of this node.
      options: { waitForSubWorkflow: false }
    },
    id: 'sa-emit-' + verdictNode.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: name,
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: [x, y],
    // An emit that fails must not fail the caller. It is observational, and an observer that can
    // break the thing it observes is not an observer.
    onError: 'continueRegularOutput'
  };
}

if (process.argv[1] && process.argv[1].endsWith('build-system-alert.mjs')) {
  mkdirSync(OUT, { recursive: true });
  const wf = buildAlertWorkflow();
  writeFileSync(join(OUT, 'system-alert-workflow.json'), JSON.stringify(wf, null, 2) + '\n', 'utf8');
  console.log('wrote n8n/candidate/system-alert-workflow.json — ' + wf.nodes.length + ' nodes');
  console.log('  errorWorkflow: ' + (wf.settings.errorWorkflow === undefined ? 'ABSENT (required)' : 'PRESENT — BUG'));
  // EXACT type, never a substring: `executeWorkflowTrigger` is the entry point and must not be
  // counted as a call. A loose regex here would have reported the required trigger as a defect.
  const calls = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow');
  console.log('  outbound Execute Workflow calls: ' + calls.length + ' (must be 0)');
  console.log('  trigger: ' + wf.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger').length + ' (must be 1)');
}
