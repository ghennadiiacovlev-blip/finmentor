#!/usr/bin/env node
// FINMENTOR — deploy the success-screen correction. ONE WORKFLOW, ONE FIELD.
//
//   node scripts/deploy-success-screen-fix.mjs --dry-run
//   node scripts/deploy-success-screen-fix.mjs --confirm
//
//   KBD7Q94QQnlzgYKJ  the Mini App host, `Serve Page`.responseBody, and nothing else
//
// ── WHAT IS BEING FIXED ────────────────────────────────────────────────────────────────────────
//
// The owner reached the real success screen for the first time on 2026-08-30 and it said two
// things that were not true, plus one thing in the wrong language:
//
//   1. «…вашу задачу и приложенные материалы…» — nothing was attached. v1 records document
//      AVAILABILITY and has no upload control anywhere. The sentence is now chosen by the draft:
//      «какие материалы доступны» when the client declared some, and the materials clause is
//      dropped entirely when they did not. The readiness line and the consultant brief move with
//      it: «Материалы — указаны», never «приложены».
//   2. «Вернуться в Telegram» did nothing on the owner's device. The handler was already correct
//      and already live — every terminal screen now routes through ONE closeApp(), and a close
//      the Telegram client ignores says how to leave instead of looking dead.
//   3. «FINMENTOR изучит brief.» → «FINMENTOR изучит бриф.»
//
// PRESENTATION ONLY. No endpoint, no contract, no projection and no server semantics move.
//
// ── WHAT THIS SCRIPT REFUSES TO DO ─────────────────────────────────────────────────────────────
//
//   1. The offline suite must pass first, in full.
//   2. It touches the host and nothing else: not the Gateway, the session or submit endpoints,
//      Lead Intake, the Pipeline, the Concierge, or any alerting workflow.
//   3. It does not activate or deactivate anything.
//   4. The page body is the ONLY field permitted to differ; a live edit anywhere else stops it,
//      because pushing this candidate would silently revert that edit.
//   5. It re-uses the endpoint URLs read back OUT of the live page, so a redeploy cannot point the
//      app somewhere new, and it never writes a resolved URL into a tracked file.
//   6. It refuses a stale candidate: every marker of this fix must be in the bytes it is about to
//      send, and the two false claims must be absent.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const HOST_ID = 'KBD7Q94QQnlzgYKJ';
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY },
                               body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 300)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const importable = (wf) => ({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} });

say('');
say('SUCCESS SCREEN CORRECTION — Mini App host redeploy');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm (or --dry-run first)'); }

// ── 0. the suite, in full, before anything is read or written ──────────────────────────────────
say('STEP 0 — the offline suite');
{
  const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'run-all.mjs')], { encoding: 'utf8' });
  const tail = String(r.stdout || '').trim().split('\n').slice(-4).join('\n');
  if (r.status !== 0) { say(tail); die('the offline suite is not green; nothing is deployed from a red tree'); }
  ok('suite green');
  say(tail.split('\n').map((l) => '        ' + l).join('\n'));
}
say('');

mkdirSync(OUT_DIR, { recursive: true });

// ── 1. the live host, and the rollback captured BEFORE anything else ───────────────────────────
say('STEP 1 — live host, and the rollback artifact');
const live = await api('GET', '/workflows/' + HOST_ID);
if (live.nodes.length !== 2) { die('the live host is not the 2-node page server this script knows'); }
const liveServe = live.nodes.find((n) => n.name === 'Serve Page');
if (!liveServe) { die('the live host has no Serve Page node'); }
const livePage = String(liveServe.parameters.responseBody || '');

const rollbackPath = join(OUT_DIR, HOST_ID + '.pre-success-screen.json');
const liveBody = JSON.stringify(importable(live), null, 2) + '\n';
ok('live page read: ' + livePage.length + ' bytes, sha256 ' + sha(livePage).slice(0, 16));

if (existsSync(rollbackPath) && !args.includes('--refresh-rollback')) {
  const prior = readFileSync(rollbackPath, 'utf8');
  if (sha(prior) !== sha(liveBody)) {
    say('  expected pre-hash : ' + sha(prior).slice(0, 32) + '   (from ' + rollbackPath + ')');
    say('  actual   pre-hash : ' + sha(liveBody).slice(0, 32));
    die('the live host has CHANGED since the rollback was captured. Re-run the dry run, confirm the ' +
        'change was expected, then pass --refresh-rollback.');
  }
  ok('expected pre-hash matches: ' + sha(liveBody).slice(0, 32));
} else {
  say('  no prior rollback to compare against; capturing the pre-state now');
}
writeFileSync(rollbackPath, liveBody, 'utf8');
ok('rollback written: ' + rollbackPath);

// The two false claims must be in the page being REPLACED. If they are not, this is not the build
// the owner saw, and the operator should find out why before writing over it.
if (livePage.indexOf('приложенные материалы') === -1) {
  die('the live page does not carry the false attachment claim — this is not the build under correction');
}
ok('the live page is the one the owner saw: it still claims «приложенные материалы»');
say('');

// ── 2. endpoints, read back from the page that is live ─────────────────────────────────────────
say('STEP 2 — endpoints, read back from the live page');
const urls = {};
for (const key of ['gateway', 'session', 'submit']) {
  const m = new RegExp(key + ':\\s*\'([^\']+)\'').exec(livePage);
  if (!m) { die('could not read the ' + key + ' endpoint out of the live page'); }
  urls[key] = m[1];
  if (/__[A-Z_]+__/.test(urls[key])) { die('the live page still holds a placeholder for ' + key); }
  const path = urls[key].replace(BASE, '');
  ok(key.padEnd(8) + ': ' + (urls[key].startsWith(BASE) ? '<tenant>' + path : urls[key]));
}
say('');

// ── 3. the candidate ───────────────────────────────────────────────────────────────────────────
say('STEP 3 — candidate');
const candidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json'), 'utf8'));
const serve = candidate.nodes.find((n) => n.name === 'Serve Page');
if (!serve) { die('the candidate has no Serve Page node'); }
let page = String(serve.parameters.responseBody || '')
  .split('__PREMIUM_GATEWAY_URL__').join(urls.gateway)
  .split('__PREMIUM_SESSION_URL__').join(urls.session)
  .split('__PREMIUM_SUBMIT_URL__').join(urls.submit);
if (/__PREMIUM_[A-Z_]+__/.test(page)) { die('an endpoint placeholder survived substitution'); }
serve.parameters.responseBody = page;
ok('candidate page: ' + page.length + ' bytes, sha256 ' + sha(page).slice(0, 16));

const must = [
  ['function closeApp(hintHost)', 'the single Telegram close integration point'],
  ['какие материалы доступны', 'the declared-materials sentence'],
  ['Консультант увидит информацию о компании и вашу задачу до первого разговора.', 'the no-materials sentence'],
  ['FINMENTOR изучит бриф.', 'the Russian «бриф»'],
  ['Материалы — указаны', 'the readiness wording that claims no attachment'],
  ['"CLOSE_HINT"', 'the close hint copy']
];
for (const [needle, what] of must) {
  if (page.indexOf(needle) === -1) { die('the candidate is stale: ' + what + ' is missing — re-run scripts/build-premium-app-content.mjs and scripts/build-miniapp-host.mjs'); }
}
ok('all six markers present in the candidate');

const banned = [
  ['приложенные материалы', 'the false attachment claim'],
  ['Материалы — приложены', 'the readiness line that claimed an attachment'],
  ['FINMENTOR изучит brief.', 'the Latin «brief»']
];
for (const [needle, what] of banned) {
  if (page.indexOf(needle) !== -1) { die('the candidate still carries ' + what); }
}
// One close call, one integration point. Three screens routed through it, plus the declaration.
if ((page.match(/tg\.close\(\)/g) || []).length !== 1) { die('the candidate has more than one Telegram close'); }
if ((page.match(/closeApp\(/g) || []).length < 4) { die('a terminal screen does not route through closeApp'); }
ok('the three false claims are gone, and there is exactly one Telegram close');
say('');

// ── 4. nothing but the page may differ ─────────────────────────────────────────────────────────
say('STEP 4 — drift: the page body is the only permitted difference');
const strip = (wf) => JSON.stringify(wf.nodes.map((n) => {
  const p = JSON.parse(JSON.stringify(n.parameters || {}));
  if (n.name === 'Serve Page') { delete p.responseBody; }
  return [n.name, n.type, n.typeVersion, p, n.onError || null];
}));
if (strip(live) !== strip(candidate)) { die('the live host differs from the candidate outside the page body — re-export and rebuild'); }
if (JSON.stringify(live.connections) !== JSON.stringify(candidate.connections)) { die('the connection graph differs'); }
ok('route, response headers and graph are identical; only the page body changes');
say('');

// ── 5. write ───────────────────────────────────────────────────────────────────────────────────
say('STEP 5 — ' + (DRY ? 'write (SKIPPED: dry run)' : 'write'));
if (!DRY) {
  await api('PUT', '/workflows/' + HOST_ID, importable(candidate));
  ok('PUT /workflows/' + HOST_ID);
} else {
  ok('dry run complete — re-run with --confirm to deploy');
}

// ── 6. read back from the tenant, not from this process ────────────────────────────────────────
say('');
say('STEP 6 — ' + (DRY ? 'read-back verification (SKIPPED: dry run)' : 'read-back verification'));
const after = DRY ? null : await api('GET', '/workflows/' + HOST_ID);
if (!after) {
  say('');
  say('Nothing was written. Re-run with --confirm to deploy.');
  say('');
} else {
  const afterPage = String(after.nodes.find((n) => n.name === 'Serve Page').parameters.responseBody || '');
  if (sha(afterPage) !== sha(page)) { die('the deployed page does not match what was sent — ROLLBACK with ' + rollbackPath); }
  ok('deployed page sha256 matches the candidate exactly');
  if (after.active !== live.active) { die('the active flag changed — it must not have'); }
  ok('active flag unchanged: ' + after.active);
  for (const [needle, what] of must) {
    if (afterPage.indexOf(needle) === -1) { die('the tenant is missing ' + what + ' — ROLLBACK'); }
  }
  ok('all six markers verified in the deployed page');
  for (const [needle, what] of banned) {
    if (afterPage.indexOf(needle) !== -1) { die('the tenant still carries ' + what + ' — ROLLBACK'); }
  }
  ok('the tenant makes none of the three false claims');
  // The endpoints must be the ones that were live before this write, byte for byte.
  for (const key of ['gateway', 'session', 'submit']) {
    const m = new RegExp(key + ':\\s*\'([^\']+)\'').exec(afterPage);
    if (!m || m[1] !== urls[key]) { die('the ' + key + ' endpoint moved — ROLLBACK'); }
  }
  ok('all three endpoints are unchanged');

  say('');
  say('DONE. Rollback: PUT the contents of ' + rollbackPath + ' back to /workflows/' + HOST_ID + '.');
  say('');
}
