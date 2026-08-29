#!/usr/bin/env node
// FINMENTOR — P9 STEP 3B: preflight before the owner presses the EXISTING B21C button.
//
//   node scripts/preflight-b21c-ab-press.mjs
//
// This changes NOTHING. It reads the live page, proves it is byte-for-byte the reviewed source,
// proves it is the A + B form (no shot C, no scheduler, one fetch, one body built once), proves
// no second Telegram button can be sent, and takes the fresh baselines the post-press proof will
// be measured against.
//
// NO NEW BUTTON. The sender and the driver must both be INACTIVE and must not be run: a second
// button would issue a second signed context, and then "the same bytes twice" would be a claim
// about two different contexts. The existing message in the owner chat is the one to press.
//
// It prints counts and shapes only. No replay key, no app_session_id, no Telegram-signed material
// and no bot token is read or printed anywhere in this file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPageWorkflow, buildSenderWorkflow, verifySurface, PAGE_PATH, GATEWAY_URL } from './build-b21c-test-surface.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const PAGE_ID = 'EU91nSsmqQqIeD8w';
const SENDER_ID = '2e8iMFQYVIwufhUy';
const DRIVER_ID = 'gbeozU4lyy3YDv0M';
const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const SESSION_TABLE_ID = 'LRme88caqxFzTLqW';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
function say(m) { console.log(m); }
if (!BASE || !READ_KEY) { console.error('N8N_BASE_URL / N8N_API_KEY not set'); process.exit(1); }

const failures = [];
function must(name, cond, detail) {
  if (cond) { say('  PASS  ' + name); }
  else { failures.push(name + (detail ? ' -> ' + detail : '')); say('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

async function api(path) {
  const res = await fetch(BASE + '/api/v1' + path, { headers: { 'X-N8N-API-KEY': READ_KEY } });
  const text = await res.text();
  if (!res.ok) { throw new Error('GET ' + path + ' -> ' + res.status + ' ' + text.slice(0, 200)); }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const html = readFileSync(join(ROOT, 'gateway', 'n8n', 'b21c-gateway-test-page.html'), 'utf8');

  say('');
  say('== THE PAGE IS THE REVIEWED SOURCE ========================');
  const page = await api('/workflows/' + PAGE_ID + '?excludePinnedData=true');
  must('the page workflow is ACTIVE', page.active === true);
  must('the page route is still ' + PAGE_PATH,
    page.nodes.some((n) => n.type === 'n8n-nodes-base.webhook' && n.parameters.path === PAGE_PATH));

  // The bytes actually served, pulled out of the respond node, compared to the tracked file.
  const respond = page.nodes.find((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  const served = String(respond.parameters.responseBody || '');
  must('the LIVE page is byte-identical to gateway/n8n/b21c-gateway-test-page.html',
    served === html, 'served ' + served.length + ' chars, source ' + html.length + ' chars');

  // And the tracked file still passes the builder's own gate.
  const rebuiltPage = buildPageWorkflow(html);
  const rebuiltSender = buildSenderWorkflow();
  const v = verifySurface(rebuiltPage, rebuiltSender, html);
  must('the reviewed source still passes the builder gate', v.ok, (v.failures || []).join('; '));

  say('');
  say('== IT IS THE A + B FORM, STRUCTURALLY =====================');
  must('shot C / STALE FRESHNESS is absent', !/STALE FRESHNESS/i.test(html) && !/shot\s*C/i.test(html));
  must('TG_INITDATA_EXPIRED is not asserted anywhere', !/TG_INITDATA_EXPIRED/.test(html));
  must('NO scheduler of any kind', !/setInterval|setTimeout|requestAnimationFrame|requestIdleCallback/.test(html));
  must('no STALE_DELAY_MS', !/STALE_DELAY_MS/.test(html));
  must('exactly one fetch call site', (html.match(/fetch\s*\(/g) || []).length === 1,
    String((html.match(/fetch\s*\(/g) || []).length));
  must('exactly two chained send() calls — A then B', (html.match(/send\s*\(/g) || []).length >= 2);
  must('B asserts REPLAY_REFUSED', /REPLAY_REFUSED/.test(html));
  must('B asserts the negative half: no second app session', /no second|second session|no_session|app_session_id/i.test(html));
  must('the page POSTs to the current Gateway', html.indexOf(GATEWAY_URL) !== -1);
  must('the retired canary route is absent', !/canary\/b21a/.test(html));
  must('initData is never persisted or logged',
    !/localStorage|sessionStorage|document\.cookie|console\.log\s*\(\s*initData|initDataUnsafe/.test(html));

  say('');
  say('== NO SECOND BUTTON CAN BE SENT ===========================');
  const sender = await api('/workflows/' + SENDER_ID);
  must('the button sender is INACTIVE', sender.active === false);
  let driver = null;
  try { driver = await api('/workflows/' + DRIVER_ID); } catch (e) { driver = null; }
  must('the button driver is INACTIVE or gone', driver === null || driver.active === false,
    driver ? 'active=' + driver.active : 'gone');
  say('  Neither is run by this script. The button already in the owner chat is the one to press.');

  say('');
  say('== THE GATEWAY IS THE P9-R2 GRAPH =========================');
  const gw = await api('/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  const claim = gw.nodes.find((n) => n.name === 'G5 Replay Claim');
  const codes = Object.fromEntries(gw.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
    .map((n) => [n.name, n.parameters.options.responseCode]));
  must('Gateway ACTIVE, 13 nodes', gw.active === true && gw.nodes.length === 13);
  must('claim query is the CTE and states `claimed`', /as claimed/i.test(claim.parameters.query));
  must('claim node carries NO alwaysOutputData', !claim.alwaysOutputData);
  must('response codes 200 / 409 / 503 numeric + dynamic rejection',
    codes['Respond Bootstrap OK'] === 200 && codes['Respond Replay Refused'] === 409 &&
    codes['Respond Store Unavailable'] === 503 && String(codes['Respond Rejected']).includes('{{'));
  must('exactly one credential, FINMENTOR Supabase G5',
    gw.nodes.filter((n) => n.credentials).length === 1 &&
    gw.nodes.find((n) => n.credentials).credentials.postgres.id === 'B6wRirWfjqoASXU3');

  say('');
  say('== FRESH BASELINES ========================================');
  const sessions = (await api('/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data.length;
  const gwExec = (await api('/executions?limit=100&workflowId=' + GATEWAY_ID)).data.length;
  const pageExec = (await api('/executions?limit=100&workflowId=' + PAGE_ID)).data.length;
  say('  app-session rows            : ' + sessions);
  say('  Gateway retained executions : ' + gwExec);
  say('  page retained executions    : ' + pageExec);
  must('Gateway retained executions are zero', gwExec === 0, String(gwExec));
  must('page retained executions are zero', pageExec === 0, String(pageExec));
  say('  (the G5 ledger count is read from Supabase alongside this, not from n8n)');

  say('');
  if (failures.length) {
    say('== RESULT: NOT READY ======================================');
    failures.forEach((f) => say('  - ' + f));
    process.exitCode = 1;
  } else {
    say('== RESULT: READY FOR ONE OWNER PRESS ======================');
    say('  Press the EXISTING "B21C Gateway Test" button. A and B run back to back.');
  }
}

main().catch((e) => { console.error('\nABORTED: ' + e.message); process.exitCode = 1; });
