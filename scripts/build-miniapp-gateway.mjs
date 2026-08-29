#!/usr/bin/env node
// FINMENTOR — P9: the Mini App Gateway (identity, replay claim, app session).
//
//   node scripts/build-miniapp-gateway.mjs
//
// REPO-ONLY. Emits n8n/candidate/miniapp-gateway-candidate.json. Never contacts n8n.
//
// ================================ WHAT THIS DEPLOYS ================================
//
//   Gateway Webhook
//     -> Verify InitData        signature (Ed25519) THEN freshness   <- embedded, not retyped
//     -> IF Verified
//          false -> Respond Rejected            (401/400/403, fail closed)
//          true  -> Derive Replay Key
//                -> G5 Replay Claim             THE ONLY Supabase node
//                -> Claim Verdict
//                -> IF Claim Won
//                     false -> Respond Replay Refused   (409)
//                     true  -> Build App Session
//                           -> Create App Session        (n8n Data Table)
//                           -> Respond Bootstrap OK      (200)
//
// The order is the owner's required order, and it is STRUCTURAL: `Derive Replay Key` is
// downstream of `IF Verified`, so a forged or stale initData has no path to the claim node. A
// rejected payload cannot consume a replay key because it never reaches the INSERT.
//
// ================================ THE VERIFIER IS EMBEDDED ================================
//
// `Verify InitData` is gateway/n8n/bootstrap-canary.js, read from disk at build time with ONE
// substitution: the BOT_ID sentinel. It is not re-implemented here. That file is already tested
// (gateway/n8n/bootstrap-canary.test.js) and already proven against the n8n Cloud sandbox's
// constraints -- no URLSearchParams, manual percent-decoding exactly once, deterministic
// code-unit key ordering, require('crypto') for Ed25519. Retyping it into a template literal
// would have been a second implementation of a security boundary, which is how the F10 seam
// defect happened: two things that were supposed to agree, and nothing proving they did.
//
// BOT_ID is NON-SECRET configuration (Telegram's own third-party validation takes it in the
// clear). Until it is set the canary fails closed with BOT_ID_NOT_CONFIGURED, so a Gateway
// deployed before the value is known refuses every request rather than accepting any.
//
// ================================ WHAT IS NOT HERE ================================
//
// The SUBMIT path. Its request shape follows the conversation/state-machine specification the
// owner and ChatGPT are defining (execution order steps 7-9), and building it now would mean
// inventing that contract. This deploys the identity half: verify, claim, bind. Submit is added
// once the conversation spec is approved.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CANARY = join(ROOT, 'gateway', 'n8n', 'bootstrap-canary.js');
const OUT = join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json');

export const BOT_ID_SENTINEL = 'SET_BOT_ID_BEFORE_CANARY';

// The FINMENTOR client bot numeric id. NON-SECRET: Telegram's own third-party validation takes
// it in the clear, and it is not the token. It is the builder default so the artifact is
// reproducible -- a generator that needed an env var to reproduce its own output would fail the
// byte-exact binding this repo checks everywhere else. The sentinel guard stays in the canary,
// so a body built WITHOUT a configured id still fails closed.
export const CONFIGURED_BOT_ID = '8917808598';
export const G5_TABLE = 'telegram_initdata_replays';
export const APP_SESSION_TABLE = 'MiniApp_App_Sessions';
export const SUPABASE_CREDENTIAL = { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' };
export const NEON_CREDENTIAL_ID = 'LWefMXHbpCWhvobq';
export const WEBHOOK_PATH = 'finmentor-miniapp-gateway';
export const APP_SESSION_TTL_SECONDS = 1800;

export const NODES = [
  'Gateway Webhook', 'Verify InitData', 'IF Verified', 'Respond Rejected',
  'Derive Replay Key', 'G5 Replay Claim', 'Claim Verdict', 'IF Claim Won',
  'Respond Replay Refused', 'Respond Store Unavailable', 'Build App Session',
  'Create App Session', 'Respond Bootstrap OK'
];

// The ONE node permitted to hold the Supabase credential.
export const G5_CLAIM_NODE = 'G5 Replay Claim';

// ---------------------------------------------------------------- node bodies

// Derivation must equal gateway/g5-replay-claim.mjs deriveReplayKey(). The gate executes both
// over the same vectors and requires identical digests, because "these two agree" is a claim
// about behaviour, not about the text looking similar.
const DERIVE_CODE = [
  "// P9 — derive the G5 replay key from AUTHENTICATED canonical material.",
  "//",
  "// Reached ONLY from the verified branch: signature and freshness have already passed. The",
  "// digest covers the exact bytes Telegram signed plus the signature, domain-separated so the",
  "// key space can be rotated. Identical to gateway/g5-replay-claim.mjs; the gate proves it by",
  "// executing both, not by comparing source.",
  "const crypto = require('crypto');",
  "const LF = String.fromCharCode(10);",
  "const DOMAIN = 'finmentor:g5:v1';",
  "",
  "const wh = $('Gateway Webhook').first().json;",
  "const initData = String((wh.body || {}).init_data || '');",
  "",
  "function decodeOnce(s) { return decodeURIComponent(s); }",
  "const pairs = [];",
  "const seen = {};",
  "const chunks = initData.split('&');",
  "for (let i = 0; i < chunks.length; i++) {",
  "  const c = chunks[i];",
  "  if (c === '') { throw new Error('G5_PARSE'); }",
  "  const eq = c.indexOf('=');",
  "  if (eq === -1) { throw new Error('G5_PARSE'); }",
  "  const k = decodeOnce(c.substring(0, eq));",
  "  const v = decodeOnce(c.substring(eq + 1));",
  "  if (k === '') { throw new Error('G5_PARSE'); }",
  "  if (Object.prototype.hasOwnProperty.call(seen, k)) { throw new Error('G5_PARSE'); }",
  "  seen[k] = true;",
  "  pairs.push([k, v]);",
  "}",
  "const hash = String(seen.hash ? (pairs.filter(function (p) { return p[0] === 'hash'; })[0] || ['', ''])[1] : '');",
  "if (!/^[a-fA-F0-9]{64}$/.test(hash)) { throw new Error('G5_HASH_MISSING'); }",
  "",
  "// buildBotDataCheckString: every field except `hash`, sorted by code unit, k=v joined by LF.",
  "const canonical = pairs",
  "  .filter(function (p) { return p[0] !== 'hash'; })",
  "  .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; })",
  "  .map(function (p) { return p[0] + '=' + p[1]; })",
  "  .join(LF);",
  "",
  "const replayKey = crypto.createHash('sha256')",
  "  .update(DOMAIN + LF + canonical + LF + hash.toLowerCase(), 'utf8')",
  "  .digest('hex');",
  "",
  "const v = $('Verify InitData').first().json;",
  "const authDate = Number(v.response.auth_date);",
  "const expiresAt = new Date((authDate + 900) * 1000).toISOString();",
  "",
  "// The raw initData stops here. Nothing downstream carries it, and nothing writes it.",
  "return [{ json: {",
  "  replay_key: replayKey,",
  "  expires_at: expiresAt,",
  "  correlation_id: String(v.log.correlation_id || '').slice(0, 80),",
  "  telegram_user_id: String(v.response.safe_user.telegram_user_id),",
  "  auth_date: authDate,",
  "  locale: String(v.response.locale || '')",
  "} }];"
].join('\n');

// ON CONFLICT DO NOTHING ... RETURNING is the whole arbitration: one row back means this
// execution won the key, zero rows means somebody already holds it. Postgres decides.
const CLAIM_QUERY = [
  'insert into public.' + G5_TABLE + ' (replay_key, expires_at, correlation_id)',
  "values ($1, $2::timestamptz, nullif($3, ''))",
  'on conflict (replay_key) do nothing',
  'returning replay_key'
].join('\n');

const CLAIM_VERDICT_CODE = [
  "// P9 — read Postgres' verdict. This node does NOT arbitrate and must never learn to:",
  "// no SELECT, no count of existing rows, no 'not found so proceed'. One row returned by the",
  "// INSERT means this execution won the key; zero means the key was already held.",
  "const claimed = $input.all().filter(function (i) {",
  "  return i.json && String(i.json.replay_key || '') !== '';",
  "});",
  "const d = $('Derive Replay Key').first().json;",
  "return [{ json: {",
  "  claim_won: claimed.length === 1 ? 1 : 0,",
  "  replay_key: d.replay_key,",
  "  telegram_user_id: d.telegram_user_id,",
  "  correlation_id: d.correlation_id,",
  "  locale: d.locale",
  "} }];"
].join('\n');

const BUILD_SESSION_CODE = [
  "// P9 — mint the app session AFTER the replay claim was won, never before.",
  "//",
  "// app_session_id is 32 random bytes from crypto.randomBytes, hex-encoded. It is NOT the",
  "// storage row id and is not derived from the Telegram user: exposing a row id would leak",
  "// ordering and let a caller guess neighbours.",
  "//",
  "// The session is a BINDING with a TTL. It is not proof of consent, it is not an identity",
  "// claim on its own, and it never becomes a second CRM: one Telegram user, one authoritative",
  "// cycle, a state, and a bounded draft.",
  "const crypto = require('crypto');",
  "const c = $('Claim Verdict').first().json;",
  "const now = new Date();",
  "const TTL_SECONDS = " + APP_SESSION_TTL_SECONDS + ";",
  "return [{ json: {",
  "  app_session_id: 'AS-' + crypto.randomBytes(32).toString('hex'),",
  "  telegram_user_id: String(c.telegram_user_id),",
  "  chat_id: String(c.telegram_user_id),",
  "  // Bound at bootstrap; the authoritative cycle is resolved server-side at submit and the",
  "  // session is invalidated if it has moved on. Empty here means 'not yet bound to a cycle'.",
  "  cycle_id: '',",
  "  replay_key: String(c.replay_key),",
  "  state: 'draft',",
  "  created_at: now.toISOString(),",
  "  expires_at: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),",
  "  updated_at: now.toISOString(),",
  "  draft_json: ''",
  "} }];"
].join('\n');

// P9-R1. `responseCode` MUST be a number, or an n8n expression that EVALUATES to one.
//
// The string '=200' is neither. The leading '=' marks the value as an expression, but the
// body '200' contains no {{ }}, so n8n evaluates it to the STRING '200' and hands that to
// the HTTP layer -- which throws while writing the response, AFTER the graph has already
// finished. The execution is recorded as a SUCCESS and the caller receives a bare 500.
//
// That is exactly how A and B failed live on 2026-08-29 while C succeeded: C is the only
// respond node whose code was a real {{ }} expression. Proven in isolation on a
// credential-free probe: '=409' -> 500, '={{ 409 }}' -> 409, 409 -> 409.
//
// Fixed codes are emitted as plain numbers, which is what the n8n editor itself stores and
// needs no expression evaluation at all. A dynamic code must use {{ }}.
const respond = (name, id, x, y, codeExpr, bodyExpr) => {
  const literalExpressionCode = typeof codeExpr === 'string' && /^=(?!.*{{)/.test(codeExpr);
  if (literalExpressionCode) {
    throw new Error(
      'respond(' + name + '): responseCode ' + JSON.stringify(codeExpr) +
      ' is an expression with no {{ }} and evaluates to a string, which returns HTTP 500. ' +
      'Use a plain number, or a {{ }} expression.'
    );
  }
  return {
  parameters: {
    respondWith: 'json',
    responseBody: bodyExpr,
    options: { responseCode: codeExpr }
  },
  id: id, name: name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
  position: [x, y]
  };
};

export function buildGateway(options) {
  const botId = (options && options.botId) || CONFIGURED_BOT_ID;
  const canarySrc = readFileSync(CANARY, 'utf8');
  if (canarySrc.indexOf("const BOT_ID = '" + BOT_ID_SENTINEL + "';") === -1) {
    throw new Error('the tracked canary no longer carries the BOT_ID sentinel');
  }
  const verifyCode = canarySrc.replace(
    "const BOT_ID = '" + BOT_ID_SENTINEL + "';",
    "const BOT_ID = '" + botId + "';"
  );

  const wf = {
    name: 'FINMENTOR Mini App Gateway',
    nodes: [
      { parameters: {
          httpMethod: 'POST', path: WEBHOOK_PATH, responseMode: 'responseNode',
          options: { rawBody: false }
        },
        id: 'gw-01-webhook', name: 'Gateway Webhook', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: [-620, 0], webhookId: 'e2f1c0d4-9a7b-4c11-8f3e-6b2a5d9c7e10' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: verifyCode },
        id: 'gw-02-verify', name: 'Verify InitData', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [-400, 0] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-verified', leftValue: '={{ $json.statusCode }}', rightValue: 200,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-03-ifverified', name: 'IF Verified', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [-180, 0] },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: DERIVE_CODE },
        id: 'gw-04-derive', name: 'Derive Replay Key', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [40, -120] },

      { parameters: { operation: 'executeQuery', query: CLAIM_QUERY,
          options: { queryReplacement: '={{ $json.replay_key }},={{ $json.expires_at }},={{ $json.correlation_id }}' } },
        id: 'gw-05-claim', name: G5_CLAIM_NODE, type: 'n8n-nodes-base.postgres',
        typeVersion: 2.6, position: [260, -120],
        credentials: { postgres: SUPABASE_CREDENTIAL },
        // FAIL CLOSED. An unreachable ledger routes to a 503; it must never fall through to the
        // session branch, because "cannot know whether this was replayed" is not "proceed".
        onError: 'continueErrorOutput', alwaysOutputData: true },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: CLAIM_VERDICT_CODE },
        id: 'gw-06-verdict', name: 'Claim Verdict', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [480, -220] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-claimwon', leftValue: '={{ $json.claim_won }}', rightValue: 1,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-07-ifclaim', name: 'IF Claim Won', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [700, -220] },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: BUILD_SESSION_CODE },
        id: 'gw-08-buildsession', name: 'Build App Session', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [920, -320] },

      { parameters: { operation: 'insert',
          dataTableId: { __rl: true, mode: 'name', value: APP_SESSION_TABLE },
          columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [], value: {} },
          options: {} },
        id: 'gw-09-createsession', name: 'Create App Session', type: 'n8n-nodes-base.dataTable',
        typeVersion: 1, position: [1140, -320] },

      respond('Respond Bootstrap OK', 'gw-10-ok', 1360, -320, 200,
        '={{ JSON.stringify({ ok: true, app_session_id: $(\'Build App Session\').first().json.app_session_id, expires_at: $(\'Build App Session\').first().json.expires_at, locale: $(\'Claim Verdict\').first().json.locale }) }}'),

      respond('Respond Rejected', 'gw-11-rejected', 40, 140,
        '={{ $json.statusCode }}',
        '={{ JSON.stringify({ ok: false, error_code: $json.response.error_code, retryable: $json.response.retryable === true }) }}'),

      respond('Respond Replay Refused', 'gw-12-replay', 920, -100, 409,
        '={{ JSON.stringify({ ok: false, error_code: \'REPLAY_REFUSED\', retryable: false }) }}'),

      respond('Respond Store Unavailable', 'gw-13-store', 480, 40, 503,
        '={{ JSON.stringify({ ok: false, error_code: \'REPLAY_STORE_UNAVAILABLE\', retryable: true }) }}')
    ],
    connections: {
      'Gateway Webhook': { main: [[{ node: 'Verify InitData', type: 'main', index: 0 }]] },
      'Verify InitData': { main: [[{ node: 'IF Verified', type: 'main', index: 0 }]] },
      'IF Verified': { main: [
        [{ node: 'Derive Replay Key', type: 'main', index: 0 }],
        [{ node: 'Respond Rejected', type: 'main', index: 0 }]
      ] },
      'Derive Replay Key': { main: [[{ node: G5_CLAIM_NODE, type: 'main', index: 0 }]] },
      // output 0 = query result, output 1 = error (fail closed)
      [G5_CLAIM_NODE]: { main: [
        [{ node: 'Claim Verdict', type: 'main', index: 0 }],
        [{ node: 'Respond Store Unavailable', type: 'main', index: 0 }]
      ] },
      'Claim Verdict': { main: [[{ node: 'IF Claim Won', type: 'main', index: 0 }]] },
      'IF Claim Won': { main: [
        [{ node: 'Build App Session', type: 'main', index: 0 }],
        [{ node: 'Respond Replay Refused', type: 'main', index: 0 }]
      ] },
      'Build App Session': { main: [[{ node: 'Create App Session', type: 'main', index: 0 }]] },
      'Create App Session': { main: [[{ node: 'Respond Bootstrap OK', type: 'main', index: 0 }]] }
    },
    settings: {
      executionOrder: 'v1',
      availableInMCP: false,
      // NO EXECUTION DATA IS RETAINED. The webhook item carries raw initData in memory, and n8n
      // would otherwise persist it in execution history -- which is exactly the "no raw initData
      // persistence" rule, lost to a default. Proof therefore comes from HTTP responses and the
      // ledger's own state, which is better evidence anyway: it is what a caller actually sees.
      saveDataSuccessExecution: 'none',
      saveDataErrorExecution: 'none',
      saveManualExecutions: false,
      saveExecutionProgress: false
    }
  };
  return wf;
}

export const serialize = (wf) => JSON.stringify(wf, null, 2) + '\n';

export function verifyGateway(wf) {
  const failures = [];
  const byName = (n) => wf.nodes.find((x) => x.name === n);
  NODES.forEach((n) => { if (!byName(n)) { failures.push('missing node: ' + n); } });
  if (wf.nodes.length !== NODES.length) { failures.push('node count is ' + wf.nodes.length + ', expected ' + NODES.length); }

  // exactly one node may hold a credential, and it must be the Supabase one
  const credNodes = wf.nodes.filter((n) => n.credentials);
  if (credNodes.length !== 1) { failures.push(credNodes.length + ' nodes carry credentials, expected 1'); }
  if (credNodes.length === 1) {
    if (credNodes[0].name !== G5_CLAIM_NODE) { failures.push('the credential is on ' + credNodes[0].name); }
    if ((credNodes[0].credentials.postgres || {}).id !== SUPABASE_CREDENTIAL.id) {
      failures.push('the claim node does not use the Supabase credential');
    }
  }
  // the Neon credential must appear nowhere
  if (JSON.stringify(wf).indexOf(NEON_CREDENTIAL_ID) !== -1) { failures.push('the Neon credential is referenced'); }
  // no raw initData retention
  if (wf.settings.saveDataSuccessExecution !== 'none' || wf.settings.saveDataErrorExecution !== 'none') {
    failures.push('execution data retention is on; raw initData would be persisted');
  }
  if (wf.settings.availableInMCP !== false) { failures.push('availableInMCP is not false'); }
  // P9-R1. Every response code must reach the HTTP layer as a NUMBER. An '=' value with no
  // {{ }} evaluates to a string, and the caller gets 500 after the graph has already run.
  wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').forEach((n) => {
    const c = (n.parameters.options || {}).responseCode;
    if (typeof c === 'number') { return; }
    if (typeof c === 'string' && c.indexOf('{{') !== -1) { return; }
    failures.push(n.name + ' responseCode ' + JSON.stringify(c) + ' does not evaluate to a number; it returns 500');
  });
  return { ok: failures.length === 0, failures };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-miniapp-gateway.mjs');
if (isMain) {
  const botId = process.env.FINMENTOR_BOT_ID || CONFIGURED_BOT_ID;
  const wf = buildGateway({ botId });
  const v = verifyGateway(wf);
  if (!v.ok) {
    console.error('REFUSING TO WRITE: the Gateway candidate failed verification.');
    v.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  writeFileSync(OUT, serialize(wf), 'utf8');
  console.log('Mini App Gateway candidate: n8n/candidate/miniapp-gateway-candidate.json');
  console.log('  nodes          : ' + wf.nodes.length);
  console.log('  credential     : ' + SUPABASE_CREDENTIAL.name + ' on ' + G5_CLAIM_NODE + ' ONLY');
  console.log('  BOT_ID         : ' + (botId === BOT_ID_SENTINEL ? 'SENTINEL (fails closed)' : 'configured'));
  console.log('  exec retention : none (no raw initData persisted)');
  console.log('  verification   : PASS');
}
