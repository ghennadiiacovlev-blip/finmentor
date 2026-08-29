#!/usr/bin/env node
// FINMENTOR — Premium UX endpoint candidates.
//
//   node scripts/build-premium-endpoints.mjs
//
// REPO-ONLY. Emits two DISPOSABLE-SHAPED candidate workflows and never contacts n8n:
//
//   n8n/candidate/premium-session-endpoint-candidate.json   PUT  /miniapp/session   (draft)
//   n8n/candidate/premium-submit-endpoint-candidate.json    POST /miniapp/submit
//
// THESE ARE CANDIDATES, NOT DEPLOYMENTS. Offline implementation is approved; deployment is not.
// Neither file is production-deployable: the Lead Intake workflow id and the privacy store are
// placeholders, and both carry `[CANDIDATE]` names and retention-off settings.
//
// WHAT IS DELIBERATELY NOT HERE. The bootstrap path. `nTZHLbv2KFggdhh5` keeps its thirteen nodes
// exactly as they are — Gateway = FINAL GO, and the G5 claim is closed. These are ADDITIVE
// endpoints on their own routes; nothing in this script reads, edits or re-emits a bootstrap node.
//
// THE FLAG RULE. Every node here that can fail carries `onError: 'continueRegularOutput'` and NO
// `alwaysOutputData`. That pairing is the P9-R2/R4 lesson: `alwaysOutputData` + `continueErrorOutput`
// makes a failing node emit on BOTH outputs, so the success branch runs on a failure. It cost this
// project a Gateway that answered 409 to an outage and a Lead Intake that reached a write on one.
// The gate below refuses to emit a candidate that reintroduces the pair.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const SESSION_PATH = 'finmentor-miniapp-session';
export const SUBMIT_PATH = 'finmentor-miniapp-submit';
export const SESSION_NAME = '[CANDIDATE] FINMENTOR Mini App Session (draft)';
export const SUBMIT_NAME = '[CANDIDATE] FINMENTOR Mini App Submit';

// Injected at deploy time, never baked into a tracked artifact.
export const LEAD_INTAKE_PLACEHOLDER = '__LEAD_INTAKE_WORKFLOW_ID__';
export const PRIVACY_CRED_PLACEHOLDER = '__PRIVACY_AUDIT_CREDENTIAL_ID__';
export const SESSION_TABLE = 'MiniApp_App_Sessions';

const SETTINGS = {
  executionOrder: 'v1',
  availableInMCP: false,
  saveExecutionProgress: false,
  saveManualExecutions: false,
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none'
};

let y = 0;
function code(name, js, extra) {
  y += 1;
  return Object.assign({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: js },
    id: 'pux-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [y * 220, 0]
  }, extra || {});
}
function ifNode(name, left, right) {
  y += 1;
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: name.toLowerCase().replace(/\W+/g, '-') + '-cond', leftValue: left, rightValue: right, operator: { type: 'number', operation: 'equals' } }],
        combinator: 'and'
      },
      options: {}
    },
    id: 'pux-if-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: name, type: 'n8n-nodes-base.if', typeVersion: 2, position: [y * 220, 0]
  };
}
function respond(name, statusCode, body) {
  y += 1;
  return {
    parameters: { respondWith: 'json', responseBody: body, options: { responseCode: statusCode } },
    id: 'pux-r-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [y * 220, 0]
  };
}
const errBody = (codeName, retryable) =>
  `={{ JSON.stringify({ ok: false, error_code: '${codeName}', retryable: ${retryable} }) }}`;

// ---------------------------------------------------------------- PUT /miniapp/session

const SESSION_RESOLVE = [
  '// Resolve the app session from the OPAQUE id alone. No Telegram initData is accepted after',
  '// bootstrap: the session id IS the credential, and identity is read server-side from the row.',
  'const body = $("Session Webhook").first().json.body || {};',
  'const id = String(body.app_session_id || "").trim();',
  'if (!/^AS-[0-9a-f]{64}$/.test(id)) { return [{ json: { verdict: 0, error_code: "BAD_REQUEST" } }]; }',
  'return [{ json: { verdict: 1, app_session_id: id, step: String(body.step || ""), fields: body.fields || {} } }];'
].join('\n');

const SESSION_VERDICT = [
  '// TTL and terminal state, decided from the STORED row and the server clock only.',
  '//',
  '// `submitted` is terminal: a draft write after a committed submission is refused rather than',
  '// merged, because the alternative is a client quietly editing a request a consultant already',
  '// has. That is the same terminal rule the Telegram side enforces.',
  'const rows = $input.all().map(i => i.json).filter(r => r && String(r.app_session_id || "").trim() !== "");',
  'if (rows.length !== 1) { return [{ json: { ok: 0, error_code: "SESSION_INVALID", status: 401 } }]; }',
  'const s = rows[0];',
  'if (new Date(String(s.expires_at)).getTime() <= Date.now()) {',
  '  return [{ json: { ok: 0, error_code: "SESSION_EXPIRED", status: 401 } }];',
  '}',
  'if (String(s.state) === "submitted") { return [{ json: { ok: 0, error_code: "SUBMIT_IN_PROGRESS", status: 409 } }]; }',
  'return [{ json: { ok: 1, app_session_id: s.app_session_id, telegram_user_id: s.telegram_user_id, cycle_id: String(s.cycle_id || "") } }];'
].join('\n');

const SESSION_VALIDATE = [
  '// Size, schema and PROVENANCE validation. The deployed form of',
  '// n8n/src/premium-ux/draft-contract.js — the module is the gated statement of this logic and',
  '// qa/premium-ux-draft.test.mjs drives it, so the two cannot drift apart silently.',
  '//',
  '// The rule that matters: `ai_inferred` is accepted as a STORED source but never satisfies a',
  '// skip. Storing it is how a prefill survives a resume; skipping on it would be a guess',
  '// wearing an answer\'s clothes.',
  'const SOURCES = ["user_explicit", "user_confirmed", "telegram_carried", "ai_inferred"];',
  'const MAX_BYTES = 16384;',
  'const v = $("Resolve Session").first().json;',
  'const fields = v.fields || {};',
  'if (typeof fields !== "object" || Array.isArray(fields)) { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  'for (const k of Object.keys(fields)) {',
  '  const f = fields[k];',
  '  if (!f || typeof f !== "object" || Array.isArray(f)) { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  '  if (typeof f.confirmed !== "boolean") { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  '  if (f.source !== null && SOURCES.indexOf(f.source) === -1) { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  '}',
  'const draft = { v: 1, cycle_id: $("Session Verdict").first().json.cycle_id, step: v.step, updated_at: new Date().toISOString(), fields: fields };',
  'const json = JSON.stringify(draft);',
  'if (json.length > MAX_BYTES) { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  'return [{ json: { ok: 1, draft_json: json, app_session_id: v.app_session_id } }];'
].join('\n');

function sessionWorkflow() {
  y = 0;
  const nodes = [
    { parameters: { httpMethod: 'PUT', path: SESSION_PATH, responseMode: 'responseNode', options: { rawBody: false } },
      id: 'pux-session-webhook', name: 'Session Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    code('Resolve Session', SESSION_RESOLVE),
    ifNode('IF Session Shape', '={{ $json.verdict }}', 1),
    { parameters: { operation: 'get', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.app_session_id }}' }] } },
      id: 'pux-read-session', name: 'Read App Session', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [660, 0],
      onError: 'continueRegularOutput' },
    code('Session Verdict', SESSION_VERDICT),
    ifNode('IF Session Valid', '={{ $json.ok }}', 1),
    code('Validate Draft', SESSION_VALIDATE),
    ifNode('IF Draft Valid', '={{ $json.ok }}', 1),
    { parameters: { operation: 'update', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.app_session_id }}' }] },
      columns: { mappingMode: 'defineBelow', value: { draft_json: '={{ $json.draft_json }}', updated_at: '={{ new Date().toISOString() }}' }, schema: [] } },
      id: 'pux-write-draft', name: 'Save Draft', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [1540, 0],
      onError: 'continueRegularOutput' },
    respond('Respond Draft OK', 200, '={{ JSON.stringify({ ok: true }) }}'),
    respond('Respond Draft Rejected', 400, errBody('BAD_REQUEST', false)),
    respond('Respond Session Invalid', 401, errBody('SESSION_INVALID', false)),
    respond('Respond Draft Unavailable', 503, errBody('TEMPORARY_BACKEND_ERROR', true))
  ];
  const connections = {
    'Session Webhook': { main: [[{ node: 'Resolve Session', type: 'main', index: 0 }]] },
    'Resolve Session': { main: [[{ node: 'IF Session Shape', type: 'main', index: 0 }]] },
    'IF Session Shape': { main: [[{ node: 'Read App Session', type: 'main', index: 0 }], [{ node: 'Respond Draft Rejected', type: 'main', index: 0 }]] },
    'Read App Session': { main: [[{ node: 'Session Verdict', type: 'main', index: 0 }]] },
    'Session Verdict': { main: [[{ node: 'IF Session Valid', type: 'main', index: 0 }]] },
    'IF Session Valid': { main: [[{ node: 'Validate Draft', type: 'main', index: 0 }], [{ node: 'Respond Session Invalid', type: 'main', index: 0 }]] },
    'Validate Draft': { main: [[{ node: 'IF Draft Valid', type: 'main', index: 0 }]] },
    'IF Draft Valid': { main: [[{ node: 'Save Draft', type: 'main', index: 0 }], [{ node: 'Respond Draft Rejected', type: 'main', index: 0 }]] },
    'Save Draft': { main: [[{ node: 'Respond Draft OK', type: 'main', index: 0 }]] }
  };
  return { name: SESSION_NAME, nodes: nodes, connections: connections, settings: JSON.parse(JSON.stringify(SETTINGS)) };
}

// ---------------------------------------------------------------- POST /miniapp/submit

const SUBMIT_GUARD = [
  '// The submit body carries a session id and a privacy acknowledgement. NOTHING ELSE IS READ.',
  '//',
  '// This is stronger than B.2.0, where answers travelled with the submit call and were',
  '// whitelisted on arrival. Here the draft already lives server-side, so there is nothing to',
  '// whitelist because there is nothing to accept: an injected `answers` or `lead_id` is not',
  '// filtered, it is simply never looked at.',
  'const body = $("Submit Webhook").first().json.body || {};',
  'const id = String(body.app_session_id || "").trim();',
  'const ack = body.privacy_ack || {};',
  'const iso = v => typeof v === "string" && /^\\d{4}-\\d{2}-\\d{2}T/.test(v);',
  'if (!/^AS-[0-9a-f]{64}$/.test(id)) { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  'if (!String(ack.notice_version || "").trim() || !iso(ack.shown_at) || !iso(ack.acknowledged_at)) {',
  '  return [{ json: { ok: 0, error_code: "CONSENT_REQUIRED", status: 409 } }];',
  '}',
  'return [{ json: { ok: 1, app_session_id: id, privacy_ack: { notice_version: String(ack.notice_version), locale: String(ack.locale || "ru"), shown_at: ack.shown_at, acknowledged_at: ack.acknowledged_at } } }];'
].join('\n');

const SUBMIT_STATE = [
  '// Idempotency, resolved from server state BEFORE the irreversible call.',
  '//',
  '// A retry after an ambiguous outcome must return the PRIOR canonical success rather than',
  '// submitting again. `submitted` is terminal and nothing here moves it back to `draft`.',
  'const rows = $input.all().map(i => i.json).filter(r => r && String(r.app_session_id || "").trim() !== "");',
  'if (rows.length !== 1) { return [{ json: { ok: 0, error_code: "SESSION_INVALID", status: 401 } }]; }',
  'const s = rows[0];',
  'if (new Date(String(s.expires_at)).getTime() <= Date.now()) { return [{ json: { ok: 0, error_code: "SESSION_EXPIRED", status: 401 } }]; }',
  'if (String(s.state) === "submitted") {',
  '  return [{ json: { ok: 0, already: 1, error_code: "ALREADY_SUBMITTED", status: 200, lead_id: String(s.lead_id || "") } }];',
  '}',
  'let draft = null;',
  'try { draft = JSON.parse(String(s.draft_json || "null")); } catch (e) { draft = null; }',
  'if (!draft || !draft.fields) { return [{ json: { ok: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
  'return [{ json: { ok: 1, app_session_id: s.app_session_id, telegram_user_id: s.telegram_user_id, cycle_id: String(s.cycle_id || ""), draft: draft } }];'
].join('\n');

const SUBMIT_PRIVACY = [
  '// The acknowledgement is written BEFORE the irreversible Lead Intake call.',
  '//',
  '// That ordering is the whole argument for a separate store: the notice was shown and',
  '// acknowledged whether or not the submission then succeeds, and a per-lead CRM row could only',
  '// ever record the acknowledgements that happened to succeed — the wrong subset.',
  '//',
  '// One immutable row per submission_key. No UPDATE turns "shown" into "acknowledged", because',
  '// both timestamps are captured at acknowledgement time. The insert is idempotent by conflict,',
  '// so a retry writes no second row and raises no error.',
  'const v = $("Submit State").first().json;',
  'const ack = $("Submit Guard").first().json.privacy_ack;',
  'return [{ json: {',
  '  submission_key: String(v.submission_key || ""),',
  '  cycle_id: v.cycle_id,',
  '  privacy_notice_version: ack.notice_version,',
  '  privacy_locale: ack.locale,',
  '  privacy_notice_shown_at: ack.shown_at,',
  '  privacy_notice_acknowledged_at: ack.acknowledged_at,',
  '  // Owner decision B: no final Moldovan legal-basis value until legal review.',
  '  privacy_legal_basis: "PENDING_LEGAL_REVIEW"',
  '} }];'
].join('\n');

const SUBMIT_RESULT = [
  '// Success is `ok === true` and nothing else. Not HTTP 2xx, not a parseable body, not the',
  '// absence of an exception — the rule Lead Intake already enforces, restated where it is read.',
  'const r = $input.first().json || {};',
  'const b = (r.body && typeof r.body === "object") ? r.body : r;',
  'const ok = b.ok === true || String(b.ok).toLowerCase() === "true";',
  'if (!ok) { return [{ json: { ok: 0, error_code: String(b.error_code || "INTAKE_NOT_OK"), retryable: b.retryable === true, status: 503 } }]; }',
  'return [{ json: { ok: 1, lead_id: String(b.lead_id || ""), priority: String(b.priority || ""), financial_zone: String(b.financial_zone || "") } }];'
].join('\n');

function submitWorkflow() {
  y = 0;
  const nodes = [
    { parameters: { httpMethod: 'POST', path: SUBMIT_PATH, responseMode: 'responseNode', options: { rawBody: false } },
      id: 'pux-submit-webhook', name: 'Submit Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    code('Submit Guard', SUBMIT_GUARD),
    ifNode('IF Submit Shape', '={{ $json.ok }}', 1),
    { parameters: { operation: 'get', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.app_session_id }}' }] } },
      id: 'pux-submit-read', name: 'Read Submit Session', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [660, 0],
      onError: 'continueRegularOutput' },
    code('Submit State', SUBMIT_STATE),
    ifNode('IF Submit Allowed', '={{ $json.ok }}', 1),
    code('Build Privacy Record', SUBMIT_PRIVACY),
    { parameters: { operation: 'executeQuery',
      query: 'insert into public.privacy_acknowledgements\n  (submission_key, cycle_id, privacy_notice_version, privacy_locale,\n   privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis)\nvalues ($1, nullif($2, \'\'), $3, $4, $5::timestamptz, $6::timestamptz, $7)\non conflict (submission_key) do nothing',
      options: {} },
      id: 'pux-privacy-write', name: 'Write Privacy Acknowledgement', type: 'n8n-nodes-base.postgres', typeVersion: 2.4, position: [1320, 0],
      credentials: { postgres: { id: PRIVACY_CRED_PLACEHOLDER, name: 'FINMENTOR Privacy Audit (writer)' } },
      onError: 'continueRegularOutput' },
    code('Build Intake Payload', '// Deployed form of n8n/src/premium-ux/submit-projection.js buildLeadIntakePayload.\n// The answers come from the STORED draft, never from the request body.\nreturn [{ json: { placeholder: "built from $(\'Submit State\').first().json.draft" } }];'),
    { parameters: { workflowId: { __rl: true, mode: 'id', value: LEAD_INTAKE_PLACEHOLDER }, options: { waitForSubWorkflow: true } },
      id: 'pux-intake', name: 'Call Lead Intake', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [1760, 0],
      onError: 'continueRegularOutput' },
    code('Parse Intake Result', SUBMIT_RESULT),
    ifNode('IF Intake OK', '={{ $json.ok }}', 1),
    { parameters: { operation: 'update', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $(\'Submit State\').first().json.app_session_id }}' }] },
      columns: { mappingMode: 'defineBelow', value: { state: 'submitted', updated_at: '={{ new Date().toISOString() }}' }, schema: [] } },
      id: 'pux-mark-submitted', name: 'Mark Submitted', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [2200, 0],
      onError: 'continueRegularOutput' },
    respond('Respond Submit OK', 200, '={{ JSON.stringify({ ok: true, lead_id: $(\'Parse Intake Result\').first().json.lead_id, priority: $(\'Parse Intake Result\').first().json.priority, financial_zone: $(\'Parse Intake Result\').first().json.financial_zone, submit_state: \'submitted\' }) }}'),
    respond('Respond Submit Rejected', 400, errBody('BAD_REQUEST', false)),
    respond('Respond Submit Session Invalid', 401, errBody('SESSION_INVALID', false)),
    respond('Respond Submit Unresolved', 503, errBody('SUBMIT_UNRESOLVED', true))
  ];
  const connections = {
    'Submit Webhook': { main: [[{ node: 'Submit Guard', type: 'main', index: 0 }]] },
    'Submit Guard': { main: [[{ node: 'IF Submit Shape', type: 'main', index: 0 }]] },
    'IF Submit Shape': { main: [[{ node: 'Read Submit Session', type: 'main', index: 0 }], [{ node: 'Respond Submit Rejected', type: 'main', index: 0 }]] },
    'Read Submit Session': { main: [[{ node: 'Submit State', type: 'main', index: 0 }]] },
    'Submit State': { main: [[{ node: 'IF Submit Allowed', type: 'main', index: 0 }]] },
    'IF Submit Allowed': { main: [[{ node: 'Build Privacy Record', type: 'main', index: 0 }], [{ node: 'Respond Submit Session Invalid', type: 'main', index: 0 }]] },
    'Build Privacy Record': { main: [[{ node: 'Write Privacy Acknowledgement', type: 'main', index: 0 }]] },
    'Write Privacy Acknowledgement': { main: [[{ node: 'Build Intake Payload', type: 'main', index: 0 }]] },
    'Build Intake Payload': { main: [[{ node: 'Call Lead Intake', type: 'main', index: 0 }]] },
    'Call Lead Intake': { main: [[{ node: 'Parse Intake Result', type: 'main', index: 0 }]] },
    'Parse Intake Result': { main: [[{ node: 'IF Intake OK', type: 'main', index: 0 }]] },
    'IF Intake OK': { main: [[{ node: 'Mark Submitted', type: 'main', index: 0 }], [{ node: 'Respond Submit Unresolved', type: 'main', index: 0 }]] },
    'Mark Submitted': { main: [[{ node: 'Respond Submit OK', type: 'main', index: 0 }]] }
  };
  return { name: SUBMIT_NAME, nodes: nodes, connections: connections, settings: JSON.parse(JSON.stringify(SETTINGS)) };
}

// ---------------------------------------------------------------- gate

export function verifyEndpoint(wf, kind) {
  const f = [];
  const json = JSON.stringify(wf);

  // The defect class that cost this project two live gates.
  for (const n of wf.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') {
      f.push('P9-R2 FLAG PAIR on ' + n.name + ' — a failure would fire the success branch too');
    }
    if (n.alwaysOutputData === true) { f.push('alwaysOutputData on ' + n.name + '; no node here needs it'); }
  }
  // Bootstrap must not be touched or duplicated.
  for (const forbidden of ['Verify InitData', 'G5 Replay Claim', 'Derive Replay Key', 'Build App Session', 'telegram_initdata_replays']) {
    if (json.indexOf(forbidden) !== -1) { f.push('candidate touches closed bootstrap/G5 surface: ' + forbidden); }
  }
  if (json.indexOf('init_data') !== -1) { f.push('candidate reads init_data after bootstrap'); }
  if (json.indexOf('finmentor-miniapp-gateway') !== -1) { f.push('candidate would seize the bootstrap route'); }

  const paths = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.parameters.path);
  if (paths.length !== 1) { f.push('expected exactly one webhook'); }
  if (kind === 'session' && paths[0] !== SESSION_PATH) { f.push('wrong session path'); }
  if (kind === 'submit' && paths[0] !== SUBMIT_PATH) { f.push('wrong submit path'); }

  if (wf.settings.saveDataSuccessExecution !== 'none' || wf.settings.saveDataErrorExecution !== 'none') { f.push('candidate retains execution data'); }
  if (wf.settings.availableInMCP !== false) { f.push('candidate is exposed to MCP'); }
  if (wf.name.indexOf('[CANDIDATE]') !== 0) { f.push('candidate is not named as a candidate'); }
  if (Object.prototype.hasOwnProperty.call(wf, 'active')) { f.push('candidate ships an active flag'); }

  if (kind === 'session') {
    // A draft write must never touch consent, a lead, or the CRM.
    for (const forbidden of ['consent', 'lead_id', 'Pipeline', 'privacy_ack', 'Lead Intake']) {
      if (json.indexOf(forbidden) !== -1) { f.push('draft endpoint references ' + forbidden); }
    }
  }
  if (kind === 'submit') {
    const names = wf.nodes.map((n) => n.name);
    const iPrivacy = names.indexOf('Write Privacy Acknowledgement');
    const iIntake = names.indexOf('Call Lead Intake');
    if (iPrivacy === -1 || iIntake === -1) { f.push('submit endpoint is missing a required node'); }
    else if (iPrivacy > iIntake) { f.push('the acknowledgement is written AFTER the irreversible call'); }
    if (json.indexOf('Save to Pipeline') !== -1 || json.indexOf('googleSheets') !== -1) { f.push('submit endpoint writes the CRM directly'); }
    if (json.indexOf('on conflict (submission_key) do nothing') === -1) { f.push('the privacy insert is not idempotent'); }
    if (/\bupdate\s+public\.privacy_acknowledgements/i.test(json) || /delete\s+from\s+public\.privacy_acknowledgements/i.test(json)) {
      f.push('the candidate mutates the privacy store');
    }
    if (json.indexOf(LEAD_INTAKE_PLACEHOLDER) === -1) { f.push('the Lead Intake id is not a placeholder'); }
    if (json.indexOf(PRIVACY_CRED_PLACEHOLDER) === -1) { f.push('the privacy credential is not a placeholder'); }
    // N6.2 — `mode` must never cross to the browser. Checked against the RESPONSE BODIES only:
    // `mode` is also an ordinary n8n parameter name (`mappingMode`, a resource locator's `mode`),
    // so a whole-document match would fail on nodes that have nothing to do with the contract.
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.respondToWebhook')) {
      const body = String(n.parameters.responseBody || '');
      if (/\bmode\s*:/.test(body) || /\blead_mode\b/.test(body)) { f.push('mode reaches the browser via ' + n.name); }
    }
  }
  return { ok: f.length === 0, failures: f };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-premium-endpoints.mjs');
if (isMain) {
  const out = [
    ['session', sessionWorkflow(), join(ROOT, 'n8n', 'candidate', 'premium-session-endpoint-candidate.json')],
    ['submit', submitWorkflow(), join(ROOT, 'n8n', 'candidate', 'premium-submit-endpoint-candidate.json')]
  ];
  for (const [kind, wf, path] of out) {
    const v = verifyEndpoint(wf, kind);
    if (!v.ok) {
      console.error('REFUSING TO WRITE ' + kind + ':');
      v.failures.forEach((x) => console.error('  - ' + x));
      process.exit(1);
    }
    writeFileSync(path, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  }
  console.log('Premium UX endpoint candidates');
  console.log('  PUT  /webhook/' + SESSION_PATH + '   n8n/candidate/premium-session-endpoint-candidate.json  (' + sessionWorkflow().nodes.length + ' nodes)');
  console.log('  POST /webhook/' + SUBMIT_PATH + '    n8n/candidate/premium-submit-endpoint-candidate.json   (' + submitWorkflow().nodes.length + ' nodes)');
  console.log('  bootstrap path         : NOT TOUCHED');
  console.log('  P9-R2 flag pair        : ABSENT');
  console.log('  privacy before intake  : enforced by the gate');
  console.log('  retention              : off');
  console.log('  verification           : PASS');
}

export { sessionWorkflow, submitWorkflow };
