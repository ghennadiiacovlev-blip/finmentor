#!/usr/bin/env node
// FINMENTOR — the owner-only Mini App host, as a single n8n workflow.
//
//   node scripts/build-miniapp-host.mjs
//
// REPO-ONLY. Emits n8n/candidate/premium-miniapp-host-candidate.json and never contacts n8n.
//
// ── WHY THE MINI APP IS SERVED FROM n8n AND NOT FROM THE SITE ──────────────────────────────────
//
// www.finmentor.md is GitHub Pages served from `main`. `app/` — the deployed B.2.0 prototype — is
// on `main`; `app-premium/` is not. Publishing the Premium Mini App to the site therefore means
// pushing to `main`, which is the one thing the owner said not to do.
//
// A Telegram Mini App only needs an HTTPS URL, and an n8n webhook is an HTTPS URL. So this wraps
// the whole app — HTML, CSS, and all three scripts — into ONE self-contained page served by one
// disposable workflow. Delete the workflow and the app is gone; nothing on the site moves, and
// `main` is untouched.
//
// ── WHAT MAKES THIS OWNER-ONLY ─────────────────────────────────────────────────────────────────
//
// Not the URL. An unlisted URL is not a control, and the owner said so explicitly.
//
// The page is a shell. Every piece of data it can reach is behind a SERVER-SIDE check:
//
//   · outside Telegram there is no initData, so `bootstrap()` returns NO_TELEGRAM and no session
//     is ever minted;
//   · inside Telegram, the Gateway mints a session bound to the caller's real Telegram user;
//   · both endpoints then compare the SERVER-STORED `telegram_user_id` against the owner id and
//     answer 403 NOT_AUTHORISED to anyone else.
//
// So a stranger who finds this URL sees an empty form that cannot read or write anything.
//
// ── NO EXTERNAL FETCHES BEYOND THE ONES THE APP ALREADY MADE ───────────────────────────────────
//
// The Telegram WebApp SDK stays a remote script — it must, it is Telegram's — and the Google Fonts
// link stays as the app already had it. Everything of ours is inlined, so there is no second
// request to a host that does not exist.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP = join(ROOT, 'app-premium');
const OUT = join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json');

export const HOST_PATH = 'finmentor-premium-miniapp';
export const HOST_NAME = '[UAT] FINMENTOR Premium Mini App host (owner-only)';

const read = (f) => readFileSync(join(APP, f), 'utf8');

const html = read('index.html');
const css = read('app.css');
const content = read('content.js');
const net = read('net.js');
const app = read('app.js');

const fail = [];

// Inline our own assets; leave Telegram's SDK and the font stylesheet as they are.
let page = html
  .replace('<link rel="stylesheet" href="app.css" />', '<style>\n' + css + '\n</style>')
  .replace('<script src="content.js"></script>', '<script>\n' + content + '\n</script>')
  .replace('<script src="net.js"></script>', '<script>\n' + net + '\n</script>')
  .replace('<script src="app.js"></script>', '<script>\n' + app + '\n</script>')
  // The favicon is a relative path to the site root, which does not exist here.
  .replace('<link rel="icon" href="../favicon.svg" type="image/svg+xml" />', '');

for (const [what, marker] of [['stylesheet', 'href="app.css"'], ['content.js', 'src="content.js"'],
                              ['net.js', 'src="net.js"'], ['app.js', 'src="app.js"']]) {
  if (page.indexOf(marker) !== -1) { fail.push('failed to inline ' + what); }
}
if (page.indexOf('telegram-web-app.js') === -1) { fail.push('the Telegram SDK was removed'); }
if (page.indexOf('window.FM_ENDPOINTS') === -1) { fail.push('the endpoint block is missing'); }

// A `</script>` inside inlined JavaScript would close the tag early and corrupt the page. None of
// our sources contains one today; this refuses to emit if that ever changes.
for (const [name, src] of [['content.js', content], ['net.js', net], ['app.js', app]]) {
  if (/<\/script/i.test(src)) { fail.push(name + ' contains a </script> sequence and cannot be inlined verbatim'); }
}

// Nothing resolved at deploy time may be committed.
for (const ph of ['__PREMIUM_GATEWAY_URL__', '__PREMIUM_SESSION_URL__', '__PREMIUM_SUBMIT_URL__']) {
  if (page.indexOf(ph) === -1) { fail.push('placeholder missing from the hosted page: ' + ph); }
}

const SETTINGS = {
  executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none'
};

const workflow = {
  name: HOST_NAME,
  nodes: [
    { parameters: { httpMethod: 'GET', path: HOST_PATH, responseMode: 'responseNode', options: {} },
      id: 'host-hook', name: 'Open Mini App', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    { parameters: {
        respondWith: 'text',
        responseBody: page,
        options: {
          responseCode: 200,
          responseHeaders: { entries: [
            { name: 'Content-Type', value: 'text/html; charset=utf-8' },
            // The page must not be cached by an intermediary: a UAT build changes often, and a
            // stale shell talking to a redeployed endpoint is a debugging trap.
            { name: 'Cache-Control', value: 'no-store, max-age=0' },
            { name: 'X-Robots-Tag', value: 'noindex, nofollow' },
            { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { name: 'X-Content-Type-Options', value: 'nosniff' }
          ] }
        }
      },
      id: 'host-respond', name: 'Serve Page', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [240, 0] }
  ],
  connections: { 'Open Mini App': { main: [[{ node: 'Serve Page', type: 'main', index: 0 }]] } }
};

for (const n of workflow.nodes) {
  if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { fail.push('P9-R2 FLAG PAIR on ' + n.name); }
}

if (fail.length) {
  console.error('');
  console.error('REFUSING TO WRITE the Mini App host candidate:');
  for (const f of fail) { console.error('  - ' + f); }
  console.error('');
  process.exit(1);
}

const json = JSON.stringify(workflow, null, 2) + '\n';
writeFileSync(OUT, json, 'utf8');

console.log('');
console.log('Premium Mini App host candidate (owner-only)');
console.log('  out            : n8n/candidate/premium-miniapp-host-candidate.json');
console.log('  route          : GET /webhook/' + HOST_PATH);
console.log('  page size      : ' + (Buffer.byteLength(page, 'utf8') / 1024).toFixed(1) + ' KB, fully self-contained');
console.log('  inlined        : app.css, content.js, net.js, app.js');
console.log('  still remote   : Telegram WebApp SDK, Google Fonts stylesheet');
console.log('  endpoints      : placeholders, substituted at deploy');
console.log('  retention      : off');
console.log('  headers        : no-store, noindex, nosniff');
console.log('  owner-only by  : server-side checks on every endpoint, NOT by the URL');
console.log('  candidate sha  : ' + crypto.createHash('sha256').update(json).digest('hex'));
console.log('');
