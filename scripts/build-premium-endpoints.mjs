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

import { writeFileSync, readFileSync } from 'node:fs';
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
// The SAME receipt store the Concierge preallocates into. Not a Mini App table: Lead Intake
// reads exactly one store, and a second one would be a second contract to drift.
const RECEIPT_TABLE = 'Submission_Receipts';
// The eleven columns, in the order the live Concierge Receipt Preallocate declares them.
const RECEIPT_COLUMNS = ['submission_key', 'commit_state', 'canonical_lead_id', 'lead_mode',
  'lead_priority', 'financial_zone', 'created_at', 'claimed_at', 'settled_at', 'abort_reason',
  'correlation_id'];

// OWNER-ONLY UAT GATE.
//
// The Mini App is reached from an inline button in the owner-gated Concierge branch, so in
// practice only the owner is handed the URL. That is not enough: 'do not rely only on hiding a
// URL' is the whole point, and a session id pasted into any browser would otherwise work.
//
// So both endpoints check the Telegram user the SERVER stored on the session row — never anything
// the client sends — against an id substituted at deploy time.
//
// IT FAILS CLOSED. While the placeholder is unsubstituted the comparison cannot match, so nobody
// passes, including the owner. That is the correct direction: a forgotten substitution locks the
// owner out of a test, whereas the opposite would open a customer surface.
//
// C3 — the tracked candidates carry BOTH placeholders and resolve to OWNER_ONLY by default. The
// CUSTOMER release is one explicit substitution (releaseMode: 'CUSTOMER') in one reviewed deployment,
// taken only after every live C3 gate has passed; the source never activates it on its own.
export const OWNER_TELEGRAM_PLACEHOLDER = '__OWNER_TELEGRAM_ID__';
export const RELEASE_MODE_PLACEHOLDER = '__MINIAPP_RELEASE_MODE__';

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
// ECHO THE VERDICT, DO NOT FLATTEN IT.
//
// The session and submit verdict nodes compute a specific outcome — NOT_AUTHORISED 403,
// SESSION_EXPIRED 401, SUBMIT_IN_PROGRESS 409 — and the IF that follows has only two outputs, so
// every one of them arrived at a single responder that answered SESSION_INVALID 401 regardless.
//
// That was measured, not theorised: a traced execution showed Session Verdict emitting
// {ok:0, error_code:"NOT_AUTHORISED", status:403} while the caller received
// {ok:false, error_code:"SESSION_INVALID"} with 401. The owner gate was working and the response
// said otherwise — which is the same class of defect as the Gateway answering 409 to an outage.
//
// The client maps error codes to behaviour (retryable, terminal, refused), so a wrong code is not
// cosmetic: it makes the app retry something it must not, or give up on something it should retry.
const echoBody =
  '={{ JSON.stringify({ ok: false, error_code: String($json.error_code || "UNSPECIFIED"), retryable: $json.retryable === true }) }}';

// D7, AND WHY IT IS A SEPARATE BODY FROM `echoBody`.
//
// `Submit State` answers a submit against an already-`submitted` session with already:1 and the
// canonical lead id. The old responder flattened that to { ok:false, error_code:"ALREADY_SUBMITTED" }
// with HTTP 200, and the client — which did not know that code — downgraded it to BAD_RESPONSE and
// rendered «Заявка пока не отправлена» over a brief the server had accepted. The mirror image of
// showing «Обращение передано» over a failed write, and just as wrong. The truthful answer is
// ok:true with the lead.
//
// It is NOT folded into echoBody because echoBody is shared with the DRAFT endpoint, which has no
// business mentioning a lead id — and the session gate caught exactly that the moment it was.
// THE TERMINAL RESPONSE IS BUILT IN JAVASCRIPT AND MERELY SERIALISED HERE.
//
// It began as a ternary inside the template. The LIVE probe found it answering HTTP 200 with an
// EMPTY BODY: an n8n expression that fails does not fail loudly, it produces nothing — and a 200
// carrying nothing is exactly the shape `verdict()` refuses and the owner sees as an unexplained
// error. Found by probing the deployed endpoint, not by reading it.
//
// So the branch lives where branches belong. Every node that can reach this responder emits
// `__status` and `__response`, and the responder does the one thing it cannot get wrong.
const terminalBody = '={{ JSON.stringify($json.__response) }}';
const terminalCode = '={{ Number($json.__status || 400) }}';
const echoCode = '={{ Number($json.status || 400) }}';

function respondEcho(name, fallbackCode) {
  y += 1;
  return {
    parameters: { respondWith: 'json', responseBody: echoBody, options: { responseCode: echoCode } },
    id: 'pux-r-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [y * 220, 0]
  };
}

// Submit only. See terminalBody.
function respondTerminal(name) {
  y += 1;
  return {
    parameters: { respondWith: 'json', responseBody: terminalBody, options: { responseCode: terminalCode } },
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
  'const req = $("Session Webhook").first().json || {};',
  'const body = req.body || {};',
  'if (req.query && req.query.app_session_id) { return [{ json: { verdict: 0, error_code: "BAD_REQUEST", status: 400 } }]; }',
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
  'const allRows = $input.all().map(i => i.json);',
  'if (allRows.some(r => r && (r.error || r.errorMessage))) { return [{ json: { ok: 0, error_code: "SESSION_STORE_UNAVAILABLE", retryable: true, status: 503 } }]; }',
  'const rows = allRows.filter(r => r && String(r.app_session_id || "").trim() !== "");',
  'if (rows.length !== 1) { return [{ json: { ok: 0, error_code: "SESSION_INVALID", status: 401 } }]; }',
  'const s = rows[0];',
  '',
  '// C3 — RELEASE GATE. The session id is a server-minted 32-byte bearer bound to the Telegram user',
  '// whose signed initData the Gateway verified; identity is never read from the caller. The tracked',
  '// candidate resolves to OWNER_ONLY; the CUSTOMER release is one explicit, reviewed deployment',
  '// (scripts/deploy-c3-customer-activation.mjs) taken only after every C3 gate has passed live.',
  'if (String(s.telegram_user_id || "").trim() === "") {',
  '  return [{ json: { ok: 0, error_code: "SESSION_INVALID", status: 401 } }];',
  '}',
  'const RELEASE_MODE = "' + RELEASE_MODE_PLACEHOLDER + '";',
  'const OWNER_ID = "' + OWNER_TELEGRAM_PLACEHOLDER + '";',
  'if (RELEASE_MODE !== "CUSTOMER" && (!/^\\d+$/.test(OWNER_ID) || String(s.telegram_user_id) !== OWNER_ID)) {',
  '  return [{ json: { ok: 0, error_code: "NOT_AUTHORISED", status: 403 } }];',
  '}',
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

const VERIFY_DRAFT_PERSISTENCE = [
  'const expected = $("Validate Draft").first().json;',
  'const rows = $input.all().map(i => i.json);',
  'if (rows.some(r => r && (r.error || r.errorMessage))) return [{ json: { ok: 0, error_code: "DRAFT_STORE_UNAVAILABLE", retryable: true, status: 503 } }];',
  'const row = rows.find(r => r && String(r.app_session_id || "") === String(expected.app_session_id));',
  'if (!row || String(row.state || "") !== "draft" || String(row.draft_json || "") !== String(expected.draft_json || "")) return [{ json: { ok: 0, error_code: "DRAFT_PERSISTENCE_UNCONFIRMED", retryable: true, status: 503 } }];',
  'return [{ json: { ok: 1 } }];'
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
      // Same hole as the submit read: a no-match must still produce an item, or Session Verdict
      // never runs and an unknown or expired session answers HTTP 200 with an empty body.
      alwaysOutputData: true,
      onError: 'continueRegularOutput' },
    code('Session Verdict', SESSION_VERDICT),
    ifNode('IF Session Valid', '={{ $json.ok }}', 1),
    code('Validate Draft', SESSION_VALIDATE),
    ifNode('IF Draft Valid', '={{ $json.ok }}', 1),
    { parameters: { operation: 'update', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.app_session_id }}' }] },
      columns: { mappingMode: 'defineBelow', value: { draft_json: '={{ $json.draft_json }}', updated_at: '={{ new Date().toISOString() }}' }, schema: [] } },
      id: 'pux-write-draft', name: 'Save Draft', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [1540, 0],
      onError: 'continueErrorOutput' },
    { parameters: { operation: 'get', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $(\'Validate Draft\').first().json.app_session_id }}' }] } },
      id: 'pux-readback-draft', name: 'Read Back Draft', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [1660, 0],
      alwaysOutputData: true, onError: 'continueRegularOutput' },
    code('Verify Draft Persistence', VERIFY_DRAFT_PERSISTENCE),
    ifNode('IF Draft Persisted', '={{ $json.ok }}', 1),
    respond('Respond Draft OK', 200, '={{ JSON.stringify({ ok: true }) }}'),
    respond('Respond Draft Rejected', 400, errBody('BAD_REQUEST', false)),
    respondEcho('Respond Session Invalid', 401),
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
    'Save Draft': { main: [[{ node: 'Read Back Draft', type: 'main', index: 0 }], [{ node: 'Respond Draft Unavailable', type: 'main', index: 0 }]] },
    'Read Back Draft': { main: [[{ node: 'Verify Draft Persistence', type: 'main', index: 0 }]] },
    'Verify Draft Persistence': { main: [[{ node: 'IF Draft Persisted', type: 'main', index: 0 }]] },
    'IF Draft Persisted': { main: [[{ node: 'Respond Draft OK', type: 'main', index: 0 }], [{ node: 'Respond Draft Unavailable', type: 'main', index: 0 }]] }
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
  'const req = $("Submit Webhook").first().json || {};',
  'const body = req.body || {};',
  'if (req.query && req.query.app_session_id) { return [{ json: { ok: 0, __status: 400, __response: { ok: false, error_code: "BAD_REQUEST", retryable: false } } }]; }',
  'const id = String(body.app_session_id || "").trim();',
  'const ack = body.privacy_ack || {};',
  'const iso = v => typeof v === "string" && /^\\d{4}-\\d{2}-\\d{2}T/.test(v);',
  '// EVERY REFUSAL CARRIES ITS OWN RESPONSE. The shape branch used to end at a responder that',
  '// answered a hard-coded BAD_REQUEST 400 to everything, so a client that had not acknowledged',
  '// the privacy notice was told its REQUEST was malformed. The live probe confirmed it.',
  'if (!/^AS-[0-9a-f]{64}$/.test(id)) {',
  '  return [{ json: { ok: 0, __status: 400, __response: { ok: false, error_code: "BAD_REQUEST", retryable: false } } }];',
  '}',
  'if (!String(ack.notice_version || "").trim() || !iso(ack.shown_at) || !iso(ack.acknowledged_at)) {',
  '  return [{ json: { ok: 0, __status: 409, __response: { ok: false, error_code: "CONSENT_REQUIRED", retryable: false } } }];',
  '}',
  'return [{ json: { ok: 1, app_session_id: id, privacy_ack: { notice_version: String(ack.notice_version), locale: String(ack.locale || "ru"), shown_at: ack.shown_at, acknowledged_at: ack.acknowledged_at } } }];'
].join('\n');

// ── THE SUBMISSION IDENTITY, AND WHY IT IS ONE MECHANISM RATHER THAN FIVE PATCHES ─────────────
//
// D3-D7 were reported as five defects. They are one: NOTHING DERIVED A SUBMISSION IDENTITY.
//
//   D4  submission_key was READ from this node and never emitted, so every submission of every
//       session shared the empty string against a UNIQUE index.
//   D5  the privacy insert had no way to recognise its own prior row, and its failure was
//       swallowed, letting a lead be created with no acknowledgement behind it.
//   D3  the Lead Intake payload was a literal placeholder, so the call had no key to dedupe on.
//   D6  the session row had nowhere to record which lead a committed submission produced.
//   D7  a replay of a committed submission was reported to the client as a failure.
//
// One derivation closes all five. The key is a pure function of the app session:
//
//     sub_ + sha256('miniapp:' + app_session_id) truncated to 32 hex characters
//
// STABLE across retries, because the session does not change when the client presses Retry.
// DISTINCT across sessions, because the session id is 32 random bytes from the Gateway.
// DERIVED, never minted and never stored: there is no row to lose, no counter to race, and a
// retry cannot invent a second identity because there is nothing to invent from. It matches the
// shape Lead Intake's own receipt machine already enforces, so the EXISTING idempotency receipt
// does the exactly-once work rather than a second mechanism being built beside it.
const SUBMIT_STATE = [
  '// Idempotency, resolved from server state BEFORE the irreversible call.',
  '//',
  '// A retry after an ambiguous outcome must return the PRIOR canonical success rather than',
  '// submitting again. `submitted` is terminal and nothing here moves it back to `draft`.',
  'const crypto = require("crypto");',
  'const allRows = $input.all().map(i => i.json);',
  'const R = (status, code, retryable) => [{ json: { ok: 0, __status: status,',
  '  __response: { ok: false, error_code: code, retryable: retryable === true } } }];',
  'if (allRows.some(r => r && (r.error || r.errorMessage))) { return R(503, "SESSION_STORE_UNAVAILABLE", true); }',
  'const rows = allRows.filter(r => r && String(r.app_session_id || "").trim() !== "");',
  'if (rows.length !== 1) { return R(401, "SESSION_INVALID"); }',
  'const s = rows[0];',
  '',
  '// C3 — RELEASE GATE. A row with no server-bound identity is not a session; and until the explicit',
  '// CUSTOMER release the endpoint answers only the owner (see the Session endpoint).',
  'if (String(s.telegram_user_id || "").trim() === "") { return R(401, "SESSION_INVALID"); }',
  'const RELEASE_MODE = "' + RELEASE_MODE_PLACEHOLDER + '";',
  'const OWNER_ID = "' + OWNER_TELEGRAM_PLACEHOLDER + '";',
  'if (RELEASE_MODE !== "CUSTOMER" && (!/^\\d+$/.test(OWNER_ID) || String(s.telegram_user_id) !== OWNER_ID)) { return R(403, "NOT_AUTHORISED"); }',
  '',
  '// THE SUBMISSION IDENTITY. Derived, not minted and not stored.',
  'const submission_key = "sub_" + crypto.createHash("sha256")',
  '  .update("miniapp:" + String(s.app_session_id)).digest("hex").slice(0, 32);',
  '',
  '// COMMITTED IS CHECKED FIRST, BEFORE EXPIRY. A session that was submitted and has since aged',
  '// past its TTL is still a committed submission, and the truthful answer is the lead it',
  '// produced rather than "expired". This branch answers ok:TRUE — see Respond Submit Terminal.',
  'if (String(s.state) === "submitted") {',
  '  return [{ json: { ok: 0, already: 1, submission_key: submission_key,',
  '    __status: 200,',
  '    __response: { ok: true, already: true, lead_id: String(s.lead_id || ""), submit_state: "submitted" } } }];',
  '}',
  'if (new Date(String(s.expires_at)).getTime() <= Date.now()) { return R(401, "SESSION_EXPIRED"); }',
  'let draft = null;',
  'try { draft = JSON.parse(String(s.draft_json || "null")); } catch (e) { draft = null; }',
  '// An empty draft is its own refusal. Calling it BAD_REQUEST told the client its request was',
  '// malformed when what actually happened is that no answers ever reached the server.',
  'if (!draft || !draft.fields || !Object.keys(draft.fields).length) { return R(409, "DRAFT_EMPTY"); }',
  'return [{ json: { ok: 1, app_session_id: s.app_session_id, telegram_user_id: s.telegram_user_id,',
  '  chat_id: String(s.chat_id || s.telegram_user_id || ""), cycle_id: String(s.cycle_id || ""),',
  '  contact_name: String(s.contact_name || ""), submission_key: submission_key, draft: draft } }];'
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

// ── THE PRIVACY VERDICT, AND WHY THE UNIQUE INDEX IS THE READ ─────────────────────────────────
//
// `privacy_audit_writer` holds INSERT and nothing else. Measured, not assumed:
// information_schema.role_table_grants lists exactly one privilege for it. So this endpoint
// CANNOT read the privacy store to find out whether a row already exists, and it cannot use
// ON CONFLICT DO UPDATE either, which would need SELECT on the referenced columns.
//
// What it can do is insert and read the outcome. The unique index on submission_key turns that
// into a complete answer:
//
//   insert succeeded   -> this attempt created the one row
//   23505              -> a previous attempt already created it
//   anything else      -> UNKNOWN, and the flow stops
//
// Both of the first two mean EXACTLY ONE ROW EXISTS, which is the invariant. The index is the
// read, performed by the database under a role that cannot read — which is a better place for it
// than any query this workflow could run.
//
// AND IT STOPS. The old graph had onError: continueRegularOutput on the insert and nothing
// downstream that looked at the outcome, so a failed acknowledgement flowed straight on into the
// irreversible Lead Intake call. A lead could be created with no consent row behind it — the one
// thing a separate privacy store exists to make impossible.
const SUBMIT_PRIVACY_VERDICT = [
  'const v = $("Submit State").first().json;',
  'const items = $input.all();',
  'let created = 0; let already = 0; let fault = "";',
  'for (const it of items) {',
  '  const j = (it && it.json) || {};',
  '  const raw = j.error !== undefined ? j.error : (it && it.error !== undefined ? it.error : null);',
  '  if (raw === null || raw === undefined) { created = 1; continue; }',
  '  // The unique-index refusal arrives on json.message; json.error carries no code and no',
  '  // message of its own, so classifying json.error alone never sees the duplicate.',
  '  const parts = [];',
  '  if (j.message !== undefined && j.message !== null) { parts.push(typeof j.message === "string" ? j.message : JSON.stringify(j.message)); }',
  '  parts.push(typeof raw === "string" ? raw : JSON.stringify(raw));',
  '  const txt = parts.join(" | ");',
  '  if (/23505|duplicate key|privacy_ack_submission_key_uidx/i.test(txt)) { already = 1; continue; }',
  '  fault = txt.slice(0, 200);',
  '}',
  '// FAIL CLOSED. No items at all, or an error that is not the unique-index refusal, means the',
  '// acknowledgement is UNPROVEN and the irreversible call must not happen. It is retryable: the',
  '// same derived key makes the next attempt land on the same row or the same refusal.',
  'if (!created && !already) {',
  '  return [{ json: { ok: 0, error_code: "PRIVACY_UNRESOLVED", status: 503, retryable: true, detail: fault } }];',
  '}',
  'return [{ json: Object.assign({}, v, { ok: 1, privacy_state: already ? "already_recorded" : "recorded" }) }];'
].join('\n');

const SUBMIT_RECEIPT_PROBE = [
  '// Does a receipt already exist for this submission key?',
  'const v = $("Submit State").first().json;',
  'const raw = $input.all().map(function (i) { return i.json; })',
  '  .filter(function (r) { return r && typeof r === "object" && !Array.isArray(r); });',
  'const storeError = raw.some(function (r) { return r.error || r.errorMessage; });',
  '// A zero-match arrives as ONE EMPTY ITEM because the read carries alwaysOutputData, and an',
  '// empty item is not a row. Discriminate by KEY COUNT — never by truthiness, which an empty',
  '// object passes.',
  'const rows = raw.filter(function (r) {',
  '  return Object.keys(r).length > 0 && !r.error && !r.errorMessage;',
  '});',
  '// PREALLOCATE ONLY ON A CLEAN READ OF ZERO ROWS. A store we could not read is NOT a store',
  '// with no row in it, and inserting on that reading is exactly how a second receipt appears',
  '// for a key that already had one. Anything else passes through untouched and is judged by',
  '// the readback, which fails closed.',
  'const needed = (!storeError && rows.length === 0) ? 1 : 0;',
  'return [{ json: Object.assign({}, v, { __receipt_needed: needed,',
  '  __probe_rows: rows.length, __probe_store_error: storeError ? 1 : 0 }) }];'
].join('\n');

// THE EXISTENCE VERDICT, and what it deliberately does NOT copy from the Concierge.
//
// The Concierge mints a key that has never existed, so its Issuance Verdict additionally demands
// a PRISTINE row: empty canonical_lead_id, claimed_at, settled_at, lead_mode, lead_priority,
// financial_zone and correlation_id. That check is right there and wrong here. The Mini App key is
// STABLE across retries, so on the second attempt the row may legitimately be IN_FLIGHT or
// COMMITTED with a canonical lead on it. Demanding pristine would refuse precisely the replay the
// receipt exists to make safe.
//
// So this proves PRESENCE and IDENTITY — exactly one row, exact raw key, a non-empty state, a
// parseable created_at — and leaves the interpretation of commit_state to Lead Intake, which is
// the authority on it and already classifies READY, IN_FLIGHT and COMMITTED. One decision site.
const SUBMIT_RECEIPT_VERDICT = [
  'const v = $("Submit State").first().json;',
  'const key = String(v.submission_key || "");',
  'const raw = $input.all().map(function (i) { return i.json; })',
  '  .filter(function (r) { return r && typeof r === "object" && !Array.isArray(r); });',
  'const storeError = raw.some(function (r) { return r.error || r.errorMessage; });',
  'const rows = raw.filter(function (r) {',
  '  return Object.keys(r).length > 0 && !r.error && !r.errorMessage;',
  '});',
  'function refuse(reason) {',
  '  return [{ json: { ok: 0, error_code: "SUBMIT_UNRESOLVED", status: 503, retryable: true,',
  '    receipt_reason: reason } }];',
  '}',
  'if (!/^sub_[0-9a-f]{32}$/.test(key)) { return refuse("SUBMISSION_KEY_INVALID"); }',
  '// "We could not look" and "it is there" must never collapse into one outcome.',
  'if (storeError) { return refuse("READBACK_STORE_ERROR"); }',
  '// RAW equality, deliberately not a trim. A trim is a REPAIR, and a stored key that is not',
  '// byte-identical is evidence the store is holding something the deriver never produced.',
  'for (var i = 0; i < rows.length; i++) {',
  '  if (typeof rows[i].submission_key !== "string" || rows[i].submission_key !== key) {',
  '    return refuse("READBACK_WRONG_KEY");',
  '  }',
  '}',
  'if (rows.length === 0) { return refuse("READBACK_ABSENT"); }',
  'if (rows.length > 1) { return refuse("DUPLICATE_RECEIPTS"); }',
  'const state = String(rows[0].commit_state || "").trim();',
  'if (state === "") { return refuse("RECEIPT_STATE_EMPTY"); }',
  'const created = rows[0].created_at;',
  'if (typeof created !== "string" || created.trim() === "" ||',
  '    !Number.isFinite(Date.parse(created))) { return refuse("READBACK_CREATED_AT_INVALID"); }',
  'return [{ json: Object.assign({}, v, { ok: 1, receipt_state: state }) }];'
].join('\n');

// The preallocation row, field for field and value for value as the live Concierge writes it.
// Only the source of submission_key differs: the Concierge reads its minted key off the issuance
// gate, the Mini App derives its own from app_session_id. Same store, same columns, same initial
// state, same emptiness.
function receiptInsert(name) {
  y += 1;
  const value = {
    submission_key: '={{ $(\'Submit State\').first().json.submission_key }}',
    commit_state: 'READY',
    canonical_lead_id: '', lead_mode: '', lead_priority: '', financial_zone: '',
    created_at: '={{ $now.toISO() }}',
    claimed_at: '', settled_at: '', abort_reason: '', correlation_id: ''
  };
  const schema = RECEIPT_COLUMNS.map((c) => ({ id: c, displayName: c, required: false,
    defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));
  return { parameters: { resource: 'row', operation: 'insert',
    dataTableId: { __rl: true, mode: 'name', value: RECEIPT_TABLE },
    columns: { mappingMode: 'defineBelow', matchingColumns: [], value: value, schema: schema } },
    id: 'pux-receipt-insert', name: name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [y * 220, 0], alwaysOutputData: true, onError: 'continueRegularOutput' };
}

// An exact-key read of the receipt store. alwaysOutputData is LOAD-BEARING: a zero match returns
// main[0] === [] and skips every downstream node, so without it the fail-closed branch could
// never run. The cost — 'no match' arriving as one empty item — is handled by key count above.
function receiptRead(name, id) {
  y += 1;
  return { parameters: { resource: 'row', operation: 'get',
    dataTableId: { __rl: true, mode: 'name', value: RECEIPT_TABLE },
    matchType: 'allConditions',
    filters: { conditions: [{ keyName: 'submission_key', condition: 'eq',
      keyValue: '={{ $(\'Submit State\').first().json.submission_key }}' }] },
    returnAll: true },
    id: id, name: name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: [y * 220, 0], alwaysOutputData: true, onError: 'continueRegularOutput' };
}

// ── D3. THE REAL PROJECTION ────────────────────────────────────────────────────────────────────
//
// The deployed node returned a literal placeholder object, so Lead Intake was called with
// { placeholder: "built from ..." } and could not have produced a lead from it.
//
// n8n/src/premium-ux/submit-projection.js is the gated statement of this projection and
// qa/premium-ux-submit.test.mjs drives it. A Code node cannot require a repo file, so the module
// and its two dependencies are INLINED verbatim at deploy time by resolveEndpoint() and the gate
// requires a byte match — the same generate-rather-than-retype discipline the Mini App content
// bundle already uses. The marker below is replaced with the three modules and never ships as
// itself: verifyEndpoint refuses a candidate that still carries it unresolved... in the DEPLOYED
// artifact, while the tracked candidate keeps it, exactly like the owner id and the credential.
const PROJECTION_PLACEHOLDER = '__PREMIUM_SUBMIT_PROJECTION__';

const SUBMIT_PAYLOAD = [
  PROJECTION_PLACEHOLDER,
  '',
  '// The answers come from the STORED draft. Nothing in the request body is read: the browser',
  '// posts a session id and an acknowledgement, and neither can steer this.',
  'const v = $("Submit State").first().json;',
  '',
  '// The draft must be COMPLETE before an irreversible call. `assertSubmittable` re-runs the same',
  '// required-field and provenance rules the client mirrors, on the server, where they are rules',
  '// rather than a convenience.',
  'const ready = SP.assertSubmittable(v.draft);',
  'if (!ready.ok) {',
  '  return [{ json: { __build_ok: 0, __status: 409, detail: String(ready.detail || ""),',
  '    __response: { ok: false, error_code: "DRAFT_EMPTY", retryable: false } } }];',
  '}',
  '',
  '// THE CORRELATION IS THE SUBMISSION KEY. A retry correlates to the submission it replays,',
  '// which is the whole point of deriving the key from the session rather than minting one.',
  'const built = SP.buildLeadIntakePayload({',
  '  draft: v.draft,',
  '  telegramUserId: String(v.telegram_user_id || ""),',
  '  // contact_name is a DRAFT field, not a session column: Telegram supplies the first name and',
  '  // the client carries it into the draft with telegram_carried provenance.',
  '  contactName: (v.draft && v.draft.fields && v.draft.fields.contact_name && v.draft.fields.contact_name.value) || "",',
  '  nowIso: new Date().toISOString(),',
  '  correlationId: String(v.submission_key || ""),',
  '  clientVersion: SP.ALLOWED_CLIENT_VERSIONS[0]',
  '});',
  'if (!built || built.ok === false) {',
  '  return [{ json: { __build_ok: 0, __status: 409,',
  '    __response: { ok: false, error_code: String((built && built.error_code) || "BAD_REQUEST"), retryable: false } } }];',
  '}',
  '',
  '// The INTERNAL envelope Lead Intake authenticates. buildLeadIntakePayload already assembles',
  '// it — source marker and all — so this wraps rather than rebuilds: a second construction here',
  '// would be a second contract, and the one that is gated would stop being the one that ships.',
  '// `submission_key` is what Lead Intake\'s idempotency receipt claims on.',
  'return [{ json: {',
  '  submission_key: String(v.submission_key || ""),',
  '  envelope: built.envelope',
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

const VERIFY_SUBMITTED_PERSISTENCE = [
  'const expected = $("Parse Intake Result").first().json;',
  'const sid = String($("Submit State").first().json.app_session_id || "");',
  'const rows = $input.all().map(i => i.json);',
  'const fail = code => [{ json: { ok: 0, __status: 503, __response: { ok: false, error_code: code, retryable: true } } }];',
  'if (rows.some(r => r && (r.error || r.errorMessage))) return fail("SUBMIT_STORE_UNAVAILABLE");',
  'const row = rows.find(r => r && String(r.app_session_id || "") === sid);',
  'if (!row || String(row.state || "") !== "submitted" || String(row.lead_id || "") !== String(expected.lead_id || "")) return fail("SUBMIT_PERSISTENCE_UNCONFIRMED");',
  'return [{ json: { ok: 1 } }];'
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
      // See the note above: no match must still produce an item, or the verdict never runs and
      // the caller gets an empty 200. Safe here because onError is continueRegularOutput, not
      // continueErrorOutput — the flag is not the P9-R2 hazard, the pair is.
      alwaysOutputData: true,
      onError: 'continueRegularOutput' },
    code('Submit State', SUBMIT_STATE),
    ifNode('IF Submit Allowed', '={{ $json.ok }}', 1),
    code('Build Privacy Record', SUBMIT_PRIVACY),
    { parameters: { operation: 'executeQuery',
      // PLAIN insert. Idempotency is the unique index on submission_key plus 23505 handling in
      // Parse Privacy Result — NOT `on conflict do nothing`, which needs a SELECT the writer is
      // deliberately not granted. Measured against the real role; see the privacy store proof.
      query: 'insert into privacy.privacy_acknowledgements\n  (submission_key, cycle_id, privacy_notice_version, privacy_locale,\n   privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis)\nvalues ($1, nullif($2, \'\'), $3, $4, $5::timestamptz, $6::timestamptz, $7)',
      // The seven values Build Privacy Record emits, bound positionally. n8n splits this
      // field on commas BEFORE resolving each segment, which is why every segment carries
      // its own leading '=' and why a comma inside a resolved VALUE cannot shift the
      // binding. Proved on a disposable table with the same node type and typeVersion.
      options: { queryReplacement: '={{ $json.submission_key }},={{ $json.cycle_id }},={{ $json.privacy_notice_version }},={{ $json.privacy_locale }},={{ $json.privacy_notice_shown_at }},={{ $json.privacy_notice_acknowledged_at }},={{ $json.privacy_legal_basis }}' } },
      id: 'pux-privacy-write', name: 'Write Privacy Acknowledgement', type: 'n8n-nodes-base.postgres', typeVersion: 2.4, position: [1320, 0],
      credentials: { postgres: { id: PRIVACY_CRED_PLACEHOLDER, name: 'FINMENTOR Privacy Audit Writer' } },
      onError: 'continueRegularOutput' },
    code('Privacy Verdict', SUBMIT_PRIVACY_VERDICT),
    ifNode('IF Privacy Recorded', '={{ $json.ok }}', 1),
    // THE CALLER-SIDE RECEIPT CONTRACT. Lead Intake has no insert: every one of its receipt
    // writes is an UPDATE filtered on submission_key plus a commit_state, and it treats a
    // missing row as RECEIPT_ABSENT_INVARIANT_BROKEN. The Concierge satisfies that contract
    // with Receipt Preallocate; the Mini App never did, which is why the second live submit
    // reached the receipt gate and was refused. Read, insert only on a clean absence, then
    // prove presence before the irreversible call.
    receiptRead('Receipt Probe', 'pux-receipt-probe'),
    code('Receipt Probe Verdict', SUBMIT_RECEIPT_PROBE),
    ifNode('IF Receipt Needed', '={{ $json.__receipt_needed }}', 1),
    receiptInsert('Preallocate Receipt'),
    receiptRead('Receipt Readback', 'pux-receipt-readback'),
    code('Receipt Verdict', SUBMIT_RECEIPT_VERDICT),
    ifNode('IF Receipt Present', '={{ $json.ok }}', 1),
    code('Build Intake Payload', SUBMIT_PAYLOAD),
    ifNode('IF Payload Built', '={{ $json.__build_ok === undefined ? 1 : $json.__build_ok }}', 1),
    { parameters: { workflowId: { __rl: true, mode: 'id', value: LEAD_INTAKE_PLACEHOLDER }, options: { waitForSubWorkflow: true } },
      id: 'pux-intake', name: 'Call Lead Intake', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [1760, 0],
      onError: 'continueRegularOutput' },
    code('Parse Intake Result', SUBMIT_RESULT),
    ifNode('IF Intake OK', '={{ $json.ok }}', 1),
    { parameters: { operation: 'update', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $(\'Submit State\').first().json.app_session_id }}' }] },
      // D6. The session row is where a REPLAY finds the canonical lead id, so a committed
      // submission that is submitted again can be answered with the lead it produced instead of
      // an empty string. Without this column the terminal branch had nothing truthful to say.
      columns: { mappingMode: 'defineBelow', value: { state: 'submitted',
        lead_id: '={{ $(\'Parse Intake Result\').first().json.lead_id }}',
        updated_at: '={{ new Date().toISOString() }}' }, schema: [] } },
      id: 'pux-mark-submitted', name: 'Mark Submitted', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [2200, 0],
      onError: 'continueErrorOutput' },
    { parameters: { operation: 'get', dataTableId: { __rl: true, mode: 'name', value: SESSION_TABLE },
      filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $(\'Submit State\').first().json.app_session_id }}' }] } },
      id: 'pux-readback-submitted', name: 'Read Back Submitted', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: [2310, 0],
      alwaysOutputData: true, onError: 'continueRegularOutput' },
    code('Verify Submitted Persistence', VERIFY_SUBMITTED_PERSISTENCE),
    ifNode('IF Submitted Persisted', '={{ $json.ok }}', 1),
    respond('Respond Submit OK', 200, '={{ JSON.stringify({ ok: true, lead_id: $(\'Parse Intake Result\').first().json.lead_id, priority: $(\'Parse Intake Result\').first().json.priority, financial_zone: $(\'Parse Intake Result\').first().json.financial_zone, submit_state: \'submitted\' }) }}'),
    // NO separate 'Rejected' responder. It answered a hard-coded BAD_REQUEST 400 to everything on
    // the shape branch, which is the exact flattening this file warns about above respondEcho —
    // in the one place the warning had not been applied.
    respondTerminal('Respond Submit Terminal'),
    respond('Respond Submit Unresolved', 503, errBody('SUBMIT_UNRESOLVED', true)),
    respond('Respond Submit Persistence Failure', 503, errBody('SUBMIT_PERSISTENCE_UNCONFIRMED', true))
  ];
  const connections = {
    'Submit Webhook': { main: [[{ node: 'Submit Guard', type: 'main', index: 0 }]] },
    'Submit Guard': { main: [[{ node: 'IF Submit Shape', type: 'main', index: 0 }]] },
    'IF Submit Shape': { main: [[{ node: 'Read Submit Session', type: 'main', index: 0 }], [{ node: 'Respond Submit Terminal', type: 'main', index: 0 }]] },
    'Read Submit Session': { main: [[{ node: 'Submit State', type: 'main', index: 0 }]] },
    'Submit State': { main: [[{ node: 'IF Submit Allowed', type: 'main', index: 0 }]] },
    'IF Submit Allowed': { main: [[{ node: 'Build Privacy Record', type: 'main', index: 0 }], [{ node: 'Respond Submit Terminal', type: 'main', index: 0 }]] },
    'Build Privacy Record': { main: [[{ node: 'Write Privacy Acknowledgement', type: 'main', index: 0 }]] },
    'Write Privacy Acknowledgement': { main: [[{ node: 'Privacy Verdict', type: 'main', index: 0 }]] },
    'Privacy Verdict': { main: [[{ node: 'IF Privacy Recorded', type: 'main', index: 0 }]] },
    'IF Privacy Recorded': { main: [[{ node: 'Receipt Probe', type: 'main', index: 0 }], [{ node: 'Respond Submit Unresolved', type: 'main', index: 0 }]] },
    'Receipt Probe': { main: [[{ node: 'Receipt Probe Verdict', type: 'main', index: 0 }]] },
    'Receipt Probe Verdict': { main: [[{ node: 'IF Receipt Needed', type: 'main', index: 0 }]] },
    // Both branches converge on the readback: whether we inserted or found one already, the
    // only thing allowed to authorise the Lead Intake call is a fresh read of the STATE.
    'IF Receipt Needed': { main: [[{ node: 'Preallocate Receipt', type: 'main', index: 0 }], [{ node: 'Receipt Readback', type: 'main', index: 0 }]] },
    'Preallocate Receipt': { main: [[{ node: 'Receipt Readback', type: 'main', index: 0 }]] },
    'Receipt Readback': { main: [[{ node: 'Receipt Verdict', type: 'main', index: 0 }]] },
    'Receipt Verdict': { main: [[{ node: 'IF Receipt Present', type: 'main', index: 0 }]] },
    'IF Receipt Present': { main: [[{ node: 'Build Intake Payload', type: 'main', index: 0 }], [{ node: 'Respond Submit Unresolved', type: 'main', index: 0 }]] },
    'Build Intake Payload': { main: [[{ node: 'IF Payload Built', type: 'main', index: 0 }]] },
    'IF Payload Built': { main: [[{ node: 'Call Lead Intake', type: 'main', index: 0 }], [{ node: 'Respond Submit Terminal', type: 'main', index: 0 }]] },
    'Call Lead Intake': { main: [[{ node: 'Parse Intake Result', type: 'main', index: 0 }]] },
    'Parse Intake Result': { main: [[{ node: 'IF Intake OK', type: 'main', index: 0 }]] },
    'IF Intake OK': { main: [[{ node: 'Mark Submitted', type: 'main', index: 0 }], [{ node: 'Respond Submit Unresolved', type: 'main', index: 0 }]] },
    'Mark Submitted': { main: [[{ node: 'Read Back Submitted', type: 'main', index: 0 }], [{ node: 'Respond Submit Persistence Failure', type: 'main', index: 0 }]] },
    'Read Back Submitted': { main: [[{ node: 'Verify Submitted Persistence', type: 'main', index: 0 }]] },
    'Verify Submitted Persistence': { main: [[{ node: 'IF Submitted Persisted', type: 'main', index: 0 }]] },
    // An unproven or unreadable read-back answers the SAME typed 503 as a failed Mark Submitted:
    // one responder for the whole "the store did not prove the commit" class, so the live
    // SYSTEM ALERT caller can be attached to it once (see scripts/deploy-c3-endpoints.mjs).
    'IF Submitted Persisted': { main: [[{ node: 'Respond Submit OK', type: 'main', index: 0 }], [{ node: 'Respond Submit Persistence Failure', type: 'main', index: 0 }]] }
  };
  return { name: SUBMIT_NAME, nodes: nodes, connections: connections, settings: JSON.parse(JSON.stringify(SETTINGS)) };
}

// ---------------------------------------------------------------- gate

// ── RESOLUTION ────────────────────────────────────────────────────────────────────────────────
//
// The tracked candidate carries placeholders and nothing else — no owner id, no workflow id, no
// credential id, and no projection source. Resolution happens once, HERE, so the gate and the
// deploy script cannot disagree about what actually ships: the gate executes exactly the code the
// deploy script writes.

// n8n/src/premium-ux/submit-projection.js and its two dependencies, as one IIFE bound to `SP`.
//
// A Code node cannot require a repo file. Rather than retype 1 100 lines of gated projection into
// a workflow parameter — a second copy that nothing watches, which is precisely how a client ends
// up seeing a label nobody approved — the modules are inlined verbatim and the gate requires a
// byte match against them.
export function projectionSource() {
  const read = (f) => readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', f), 'utf8');
  const strip = (src, name) => {
    const i = src.lastIndexOf('module.exports = ');
    if (i === -1) { throw new Error(name + ': no module.exports'); }
    const body = src.slice(0, i).replace(/^\s*const [A-Z] = require\([^)]*\);\s*$/gm, '');
    const exported = src.slice(i + 'module.exports = '.length).replace(/;\s*$/, '');
    return { body, exported };
  };
  const parts = [
    '// ─── INLINED, VERBATIM, FROM n8n/src/premium-ux/. DO NOT EDIT HERE. ─────────────────────────',
    '// scripts/build-premium-endpoints.mjs regenerates this block at deploy time. An edit made in',
    '// the n8n editor is lost on the next deploy and is invisible to qa/premium-ux-submit.test.mjs.'
  ];
  for (const [name, file] of [['B', 'branches.js'], ['D', 'draft-contract.js'], ['SP', 'submit-projection.js']]) {
    const { body, exported } = strip(read(file), file);
    parts.push('const ' + name + ' = (function () {', body, 'return ' + exported + ';', '})();');
  }
  return parts.join('\n');
}

export const PROJECTION_MARKER = '__PREMIUM_SUBMIT_PROJECTION__';

// Substitutes every placeholder and returns a workflow ready to PUT. Refuses on any survivor: a
// placeholder that reaches the tenant is either an owner gate that cannot match (locking the
// owner out) or a credential that is not attached (a write that cannot happen).
export function resolveEndpoint(wf, opts) {
  const o = opts || {};
  let text = JSON.stringify(wf);
  text = text.split(RELEASE_MODE_PLACEHOLDER).join(o.releaseMode === 'CUSTOMER' ? 'CUSTOMER' : 'OWNER_ONLY');
  if (o.ownerId) { text = text.split(OWNER_TELEGRAM_PLACEHOLDER).join(String(o.ownerId)); }
  if (o.leadIntakeId) { text = text.split(LEAD_INTAKE_PLACEHOLDER).join(String(o.leadIntakeId)); }
  if (o.privacyCredId) { text = text.split(PRIVACY_CRED_PLACEHOLDER).join(String(o.privacyCredId)); }
  const resolved = JSON.parse(text);
  // The projection is substituted on the PARSED workflow, not on the JSON string: the module
  // source contains quotes, backslashes and newlines that a string splice would have to escape,
  // and getting that wrong silently produces a Code node that does not parse.
  const src = projectionSource();
  for (const n of resolved.nodes) {
    const js = (n.parameters && n.parameters.jsCode) || '';
    if (js.indexOf(PROJECTION_MARKER) !== -1) {
      n.parameters.jsCode = js.split(PROJECTION_MARKER).join(src);
    }
  }
  const leftovers = JSON.stringify(resolved).match(/__[A-Z_]{4,}__/g);
  if (leftovers) { throw new Error('unresolved placeholders: ' + [...new Set(leftovers)].join(', ')); }
  return resolved;
}

export function verifyEndpoint(wf, kind) {
  const f = [];
  const json = JSON.stringify(wf);

  // The defect class that cost this project two live gates.
  for (const n of wf.nodes) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') {
      f.push('P9-R2 FLAG PAIR on ' + n.name + ' — a failure would fire the success branch too');
    }
    // NOT a blanket ban. P9-R2's hazard is the PAIR above — alwaysOutputData with an ERROR output
    // fires both branches on a failure. With continueRegularOutput there is one output, and the
    // flag is the only way to make a no-match read produce an item at all. Banning the flag
    // outright is what left an unknown session answering HTTP 200 with an empty body.
    if (n.alwaysOutputData === true && n.onError !== 'continueRegularOutput') {
      f.push('alwaysOutputData on ' + n.name + ' without continueRegularOutput');
    }
  }
  // Bootstrap must not be touched or duplicated.
  for (const forbidden of ['Verify InitData', 'G5 Replay Claim', 'Derive Replay Key', 'Build App Session', 'telegram_initdata_replays']) {
    if (json.indexOf(forbidden) !== -1) { f.push('candidate touches closed bootstrap/G5 surface: ' + forbidden); }
  }
  // A READ or a SEND, never a mention. The inlined projection lists 'init_data' among the body
  // keys it REFUSES; a blanket match would reject the code that exists to reject it.
  if (/body\.init_data|\binit_data\s*:/.test(json)) { f.push('candidate reads or sends init_data after bootstrap'); }
  if (json.indexOf('finmentor-miniapp-gateway') !== -1) { f.push('candidate would seize the bootstrap route'); }

  const paths = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.parameters.path);
  if (paths.length !== 1) { f.push('expected exactly one webhook'); }
  if (kind === 'session' && paths[0] !== SESSION_PATH) { f.push('wrong session path'); }
  if (kind === 'submit' && paths[0] !== SUBMIT_PATH) { f.push('wrong submit path'); }

  if (wf.settings.saveDataSuccessExecution !== 'none' || wf.settings.saveDataErrorExecution !== 'none') { f.push('candidate retains execution data'); }
  if (wf.settings.availableInMCP !== false) { f.push('candidate is exposed to MCP'); }
  if (wf.name.indexOf('[CANDIDATE]') !== 0) { f.push('candidate is not named as a candidate'); }
  if (Object.prototype.hasOwnProperty.call(wf, 'active')) { f.push('candidate ships an active flag'); }
  if (json.indexOf(RELEASE_MODE_PLACEHOLDER) === -1) { f.push('tracked candidate lost the release-mode placeholder'); }
  if (json.indexOf(OWNER_TELEGRAM_PLACEHOLDER) === -1) { f.push('tracked candidate lost the owner id placeholder'); }
  if (json.indexOf('NOT_AUTHORISED') === -1) { f.push('tracked candidate lost the owner-only release gate'); }

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
    // Idempotency is the unique index plus 23505 handling, NOT ON CONFLICT: measured against the
    // real writer role, ON CONFLICT needs SELECT and the writer is granted INSERT only.
    if (/on conflict/i.test(json)) { f.push('the privacy insert uses ON CONFLICT, which needs a SELECT the writer must not have'); }
    // Identity and release mode are both server-side. Tracked source remains OWNER_ONLY.
    if (!/s\.telegram_user_id/.test(json)) { f.push('the endpoint does not read the server-stored telegram_user_id'); }
    if (/\"\\d{6,}\"/.test(json)) { f.push('a literal Telegram id is baked into the candidate'); }
    if (json.indexOf('privacy.privacy_acknowledgements') === -1) { f.push('the privacy insert does not target the privacy schema'); }
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
