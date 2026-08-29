#!/usr/bin/env node
// FINMENTOR — B.2.1-C owner-only Gateway test surface.
//
//   node scripts/build-b21c-test-surface.mjs
//
// REPO-ONLY. Emits two candidates and never contacts n8n:
//
//   n8n/candidate/b21c-test-page-candidate.json     GET  -> serves the bootstrap page
//   n8n/candidate/b21c-test-button-sender-candidate.json  sends ONE owner-only button
//
// ============================== WHY A PAGE ON n8n AND NOT ON finmentor.md ==============================
//
// The Gateway sets no CORS headers, by design and by the owner's instruction not to modify it.
// A page served from https://www.finmentor.md POSTing to https://ghennadi.app.n8n.cloud would
// be a cross-origin request with `Content-Type: application/json`, which forces an OPTIONS
// preflight the Gateway cannot answer — the browser would refuse before the Gateway ever saw
// the request. Serving the page from the SAME n8n origin makes the POST same-origin: no
// preflight, no CORS, no Gateway change. This is also exactly what B.2.1-A and B.2.1-B did.
//
// ============================== WHY A NEW PATH ==============================
//
// The retired canary answered GET /canary/b21a and is not to be reactivated. This is a new
// route on a new workflow; the old page workflow (hGQAfPWBK75xeWco) is left inactive and
// untouched. The builder REFUSES to emit a page bound to the retired path.
//
// ============================== WHAT THIS SURFACE CANNOT DO ==============================
//
// Bootstrap only. No submit node, no Lead Intake call, no Google Sheets node, no HTTP Request
// node, no Pipeline write, no consent write. The page renders no raw initData and the page
// workflow never receives any — it answers a GET with static bytes.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PAGE_SRC = join(ROOT, 'gateway', 'n8n', 'b21c-gateway-test-page.html');
const OUT_PAGE = join(ROOT, 'n8n', 'candidate', 'b21c-test-page-candidate.json');
const OUT_SENDER = join(ROOT, 'n8n', 'candidate', 'b21c-test-button-sender-candidate.json');

// ---------------------------------------------------------------- configuration (non-secret)

export const N8N_ORIGIN = 'https://ghennadi.app.n8n.cloud';
export const PAGE_PATH = 'b21c/gateway-test';
export const PAGE_URL = N8N_ORIGIN + '/webhook/' + PAGE_PATH;
export const GATEWAY_URL = N8N_ORIGIN + '/webhook/finmentor-miniapp-gateway';
export const RETIRED_CANARY_PATH = 'canary/b21a';

// The owner's own Telegram chat. Already the configured owner/test chat for every prior canary.
export const OWNER_CHAT_ID = '551662084';

// The bot that owns the Mini App. The TOKEN is never read, copied or logged — only the
// credential reference, which is what n8n resolves at run time.
export const BOT_CREDENTIAL = { id: '2JnVm0BIX0Z8tvBf', name: 'FINMENTOR Client Concierge Bot' };

// Requirement 10: unmistakable, and impossible to confuse with the retired canary button.
export const BUTTON_LABEL = 'B21C Gateway Test';

const MESSAGE_TEXT = [
  'FINMENTOR — B21C Gateway Test (owner only).',
  '',
  'Это НОВАЯ кнопка. Старая Canary-кнопка выведена из строя и больше не используется.',
  '',
  'Нажмите кнопку ниже ОДИН раз. Страница отправит подписанный Telegram-контекст в текущий Gateway и покажет результат.',
  'Лид не создаётся, эксперту ничего не передаётся, анкета не открывается.'
].join('\n');

// Retention off everywhere: nothing in this surface may accumulate execution records.
const SETTINGS = {
  executionOrder: 'v1',
  availableInMCP: false,
  saveExecutionProgress: false,
  saveManualExecutions: false,
  saveDataErrorExecution: 'none',
  saveDataSuccessExecution: 'none'
};

// ---------------------------------------------------------------- builders

export function buildPageWorkflow(html) {
  return {
    name: 'FINMENTOR B.2.1-C Gateway Test Page',
    nodes: [
      {
        parameters: {
          httpMethod: 'GET',
          path: PAGE_PATH,
          authentication: 'none',
          responseMode: 'responseNode',
          options: { ignoreBots: true }
        },
        id: 'b21c-page-endpoint',
        name: 'B21C Test Page Endpoint',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2.1,
        position: [0, 0],
        webhookId: 'b21c9f04-6d3a-4f57-9a1e-2c8be0d51f37'
      },
      {
        parameters: {
          respondWith: 'text',
          responseBody: html,
          options: {
            responseHeaders: {
              entries: [
                { name: 'content-type', value: 'text/html; charset=utf-8' },
                { name: 'cache-control', value: 'no-store' },
                { name: 'referrer-policy', value: 'no-referrer' }
              ]
            }
          }
        },
        id: 'b21c-page-serve',
        name: 'Serve B21C Test Page',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.5,
        position: [240, 0]
      }
    ],
    connections: {
      'B21C Test Page Endpoint': { main: [[{ node: 'Serve B21C Test Page', type: 'main', index: 0 }]] }
    },
    settings: SETTINGS
  };
}

export function buildSenderWorkflow() {
  return {
    name: 'FINMENTOR B.2.1-C Test Button Sender',
    nodes: [
      {
        parameters: { inputSource: 'passthrough' },
        id: 'b21c-sender-trigger',
        name: 'When Executed by Another Workflow',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position: [0, 0]
      },
      {
        parameters: {
          resource: 'message',
          operation: 'sendMessage',
          chatId: OWNER_CHAT_ID,
          text: MESSAGE_TEXT,
          replyMarkup: 'inlineKeyboard',
          inlineKeyboard: {
            rows: [
              { row: { buttons: [{ text: BUTTON_LABEL, additionalFields: { web_app: { url: PAGE_URL } } }] } }
            ]
          },
          additionalFields: { appendAttribution: false }
        },
        id: 'b21c-sender-send',
        name: 'Send B21C Test Button',
        type: 'n8n-nodes-base.telegram',
        typeVersion: 1.2,
        position: [240, 0],
        credentials: { telegramApi: BOT_CREDENTIAL }
      },
      {
        parameters: {
          mode: 'runOnceForAllItems',
          language: 'javaScript',
          // Delivery receipt only. Reads the PUBLIC fields of Telegram's sendMessage result:
          // the token is never read, and the message body is not echoed back.
          jsCode: [
            "const item = $input.first().json || {};",
            "const result = item.result || item;",
            "const chat = result.chat || {};",
            "const from = result.from || {};",
            "return [{ json: {",
            "  delivered: result.message_id !== undefined && result.message_id !== null,",
            "  message_id: result.message_id === undefined ? null : result.message_id,",
            "  chat_type: chat.type === undefined ? null : String(chat.type),",
            "  bot_id: from.id === undefined ? null : String(from.id),",
            "  button_label: " + JSON.stringify(BUTTON_LABEL) + ",",
            "  target_url: " + JSON.stringify(PAGE_URL) + ",",
            "  bot_token_exposure: 'NONE'",
            "} }];"
          ].join('\n')
        },
        id: 'b21c-sender-receipt',
        name: 'Delivery Receipt',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [480, 0]
      }
    ],
    connections: {
      'When Executed by Another Workflow': { main: [[{ node: 'Send B21C Test Button', type: 'main', index: 0 }]] },
      'Send B21C Test Button': { main: [[{ node: 'Delivery Receipt', type: 'main', index: 0 }]] }
    },
    settings: SETTINGS
  };
}

// ---------------------------------------------------------------- gate

// Node types that would turn a bootstrap proof surface into something with side effects.
const FORBIDDEN_NODE_TYPES = [
  'n8n-nodes-base.googleSheets',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.postgres',
  'n8n-nodes-base.dataTable'
];

export function verifySurface(page, sender, html) {
  const f = [];
  const pageJson = JSON.stringify(page);
  const senderJson = JSON.stringify(sender);

  // --- the page ------------------------------------------------------------
  if (page.nodes.length !== 2) { f.push('page workflow is not exactly the two-node webhook/respond pair'); }
  const ep = page.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  if (!ep || ep.parameters.httpMethod !== 'GET') { f.push('page endpoint is not a GET webhook'); }
  if (!ep || ep.parameters.responseMode !== 'responseNode') { f.push('page endpoint does not respond from a response node'); }
  if (ep && ep.parameters.path === RETIRED_CANARY_PATH) { f.push('page is bound to the RETIRED canary path'); }
  if (ep && ep.parameters.path !== PAGE_PATH) { f.push('page path is not the B21C path'); }
  if (pageJson.indexOf(RETIRED_CANARY_PATH) !== -1) { f.push('the retired canary path appears in the page workflow'); }
  const served = page.nodes.find((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  if (!served || served.parameters.responseBody !== html) { f.push('the served body is not the reviewed page byte-for-byte'); }

  // --- the page's own contract ---------------------------------------------
  if (html.indexOf(GATEWAY_URL) === -1) { f.push('the page does not POST to the CURRENT Gateway'); }
  if (html.indexOf('/miniapp/bootstrap') !== -1) { f.push('the page still targets the retired bootstrap route'); }
  if (html.indexOf(RETIRED_CANARY_PATH) !== -1) { f.push('the page references the retired canary path'); }
  if (html.indexOf('Telegram.WebApp') === -1 && html.indexOf('window.Telegram') === -1) {
    f.push('the page does not read Telegram.WebApp');
  }
  if (html.indexOf('initDataUnsafe') !== -1) { f.push('the page touches initDataUnsafe'); }
  // Raw initData may be READ into a local and put in the request body, and nowhere else.
  ['localStorage', 'sessionStorage', 'document.cookie', 'console.log', 'location.hash', 'location.search']
    .forEach((sink) => { if (html.indexOf(sink) !== -1) { f.push('the page uses a persistence/logging sink: ' + sink); } });
  if (/textContent\s*=\s*[^;]*\binitData\b/.test(html)) { f.push('the page renders raw initData into the DOM'); }
  // Exactly one outbound request per open, and no retry loop.
  if ((html.match(/fetch\(/g) || []).length !== 1) { f.push('the page does not issue exactly one fetch'); }
  if (html.indexOf('setInterval') !== -1) { f.push('the page has a repeating timer'); }
  // The submit surface must be absent. Route names, not English words: the page's own leak
  // detector legitimately names fields like `consent` and `lead_id` in order to refuse them.
  ['miniapp/submit', 'miniapp/session', 'finmentor-lead-intake'].forEach((s) => {
    if (html.indexOf(s) !== -1) { f.push('the page references a write-side route: ' + s); }
  });

  // --- the sender ----------------------------------------------------------
  if (sender.nodes.length !== 3) { f.push('sender workflow is not the three-node trigger/send/receipt chain'); }
  const tg = sender.nodes.find((n) => n.type === 'n8n-nodes-base.telegram');
  if (!tg) { f.push('sender has no Telegram node'); }
  if (tg && tg.parameters.chatId !== OWNER_CHAT_ID) { f.push('sender does not target the owner chat'); }
  if (tg && tg.credentials.telegramApi.id !== BOT_CREDENTIAL.id) { f.push('sender uses an unexpected bot credential'); }
  const btn = tg && tg.parameters.inlineKeyboard.rows[0].row.buttons[0];
  if (!btn || btn.text !== BUTTON_LABEL) { f.push('the button label is not the agreed B21C label'); }
  if (!btn || btn.additionalFields.web_app.url !== PAGE_URL) { f.push('the button does not point at the B21C page'); }
  if (!btn || btn.additionalFields.web_app.url.indexOf('https://') !== 0) { f.push('the button URL is not HTTPS'); }
  if (senderJson.indexOf(RETIRED_CANARY_PATH) !== -1) { f.push('the sender still points at the retired canary route'); }
  if (sender.nodes.filter((n) => n.credentials).length !== 1) { f.push('more than one node in the sender carries a credential'); }
  // Exactly one message. A trigger that could fire repeatedly is not a one-off launcher.
  if (sender.nodes[0].type !== 'n8n-nodes-base.executeWorkflowTrigger') { f.push('sender is not sub-workflow-triggered'); }
  if (sender.nodes.some((n) => /trigger/i.test(n.type) && n.type !== 'n8n-nodes-base.executeWorkflowTrigger')) {
    f.push('sender carries a second trigger');
  }

  // --- both ----------------------------------------------------------------
  [['page', page], ['sender', sender]].forEach(([label, wf]) => {
    FORBIDDEN_NODE_TYPES.forEach((t) => {
      if (wf.nodes.some((n) => n.type === t)) { f.push(label + ' contains a forbidden node type: ' + t); }
    });
    if (wf.nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflow')) {
      f.push(label + ' can call another workflow');
    }
    if (wf.settings.saveDataSuccessExecution !== 'none' || wf.settings.saveDataErrorExecution !== 'none') {
      f.push(label + ' retains execution data');
    }
    if (wf.settings.availableInMCP !== false) { f.push(label + ' is exposed to MCP'); }
    if (Object.prototype.hasOwnProperty.call(wf, 'active')) { f.push(label + ' ships an active flag'); }
  });

  // No secret may ever be in an artifact that reaches git.
  const both = pageJson + senderJson;
  if (/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/.test(both)) { f.push('a bot token shape appears in an artifact'); }

  return { ok: f.length === 0, failures: f };
}

function serialize(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

const isMain = process.argv[1] && process.argv[1].endsWith('build-b21c-test-surface.mjs');
if (isMain) {
  const html = readFileSync(PAGE_SRC, 'utf8');
  const page = buildPageWorkflow(html);
  const sender = buildSenderWorkflow();
  const v = verifySurface(page, sender, html);
  if (!v.ok) {
    console.error('REFUSING TO WRITE: the B21C test surface failed verification.');
    v.failures.forEach((x) => console.error('  - ' + x));
    process.exit(1);
  }
  writeFileSync(OUT_PAGE, serialize(page), 'utf8');
  writeFileSync(OUT_SENDER, serialize(sender), 'utf8');
  console.log('B21C owner-only Gateway test surface');
  console.log('  page candidate   : n8n/candidate/b21c-test-page-candidate.json');
  console.log('  sender candidate : n8n/candidate/b21c-test-button-sender-candidate.json');
  console.log('  page URL         : ' + PAGE_URL);
  console.log('  page POSTs to    : ' + GATEWAY_URL);
  console.log('  button label     : ' + BUTTON_LABEL);
  console.log('  owner chat       : configured');
  console.log('  retired route    : absent from both artifacts');
  console.log('  exec retention   : none on both');
  console.log('  verification     : PASS');
}
