#!/usr/bin/env node
// FINMENTOR — RU UAT defect A1: redeploy the owner-only Mini App host, and NOTHING else.
//
//   node scripts/deploy-miniapp-contact-fix.mjs --dry-run
//   node scripts/deploy-miniapp-contact-fix.mjs --confirm
//
// ── WHY A SEPARATE SCRIPT ──────────────────────────────────────────────────────────────────────
//
// scripts/deploy-premium-uat.mjs --endpoints-only would work, but it also re-PUTs the session and
// submit endpoint workflows. The A1 fix is entirely inside the served page: four client-side
// defects on one screen, no server contract touched. Re-writing two live endpoint workflows to
// ship a CSS class is blast radius nobody asked for, so this touches exactly one workflow.
//
// ── WHAT IS BEING FIXED, AND WHY THE PAGE IS THE WHOLE FIX ─────────────────────────────────────
//
//   1. `icon()` wrote an INLINE `display:flex` on every tick span. An inline style outranks every
//      selector, so `.row .tick { display: none }` never applied and all three contact options
//      rendered a check mark — the selection state the owner reported as ambiguous.
//   2. Switching channel kept the previous `contact_value`, so a phone number typed under
//      «По телефону» survived a switch to «По email» and stood as the authoritative email.
//   3. Nothing validated the typed contact at all.
//   4. On the phone and email branches «Продолжить» was evaluated once at render and never again,
//      and typing does not re-render — so those two branches could never be completed.
//
// qa/premium-ux-contact-channel.test.mjs proves all four closed, and proves it fails on the build
// that is live right now.
//
// ── WHAT THIS SCRIPT REFUSES TO DO ─────────────────────────────────────────────────────────────
//
//   · it does not touch the Gateway, the session endpoint, the submit endpoint, Lead Intake, the
//     Concierge, the Transport workflow, or any alerting workflow;
//   · it does not activate or deactivate anything;
//   · it does not proceed if the live page differs from the page the candidate was built against
//     in any way other than the fix itself — an unrelated live edit means someone else changed
//     something and this candidate would silently revert it;
//   · it does not write a resolved endpoint URL into any tracked file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
say('RU UAT A1 — Mini App host redeploy (contact-channel defects)');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN — nothing will be written' : '  MODE: LIVE');
say('');

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!DRY && !WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }
if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm (or --dry-run first)'); }

mkdirSync(OUT_DIR, { recursive: true });

// ── 1. read the live host, and capture the rollback BEFORE anything else ───────────────────────
say('STEP 1 — live host, and the rollback artifact');
const live = await api('GET', '/workflows/' + HOST_ID);
if (live.nodes.length !== 2) { die('the live host is not the 2-node page server this script knows'); }
const liveServe = live.nodes.find((n) => n.name === 'Serve Page');
if (!liveServe) { die('the live host has no Serve Page node'); }
const livePage = String(liveServe.parameters.responseBody || '');

const rollbackPath = join(OUT_DIR, HOST_ID + '.pre-contact-fix.json');
const liveBody = JSON.stringify(importable(live), null, 2) + '\n';
ok('live page read: ' + livePage.length + ' bytes, sha256 ' + sha(livePage).slice(0, 16));

// EXPECTED PRE-HASH. If a rollback from an earlier run of this script exists, the live workflow
// must still be byte-identical to it. Anything else means the host changed between the dry run and
// the write — someone else's edit, which this candidate would silently revert. Refusing is the
// only safe answer; `--refresh-rollback` is the deliberate way to say "yes, re-baseline".
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
say('');

// ── 2. resolve the endpoints from the page that is live, not from a constant ───────────────────
//
// The three URLs were injected at the original deploy. Reading them back out means the redeploy
// cannot point the app somewhere new by accident — whatever the app talks to today, it talks to
// after this too.
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

// ── 3. the candidate, with the same endpoints substituted in ───────────────────────────────────
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

// The fix must actually be in there. A stale candidate is the failure mode this catches.
const must = [
  ["function icon(name, cls)", 'the icon() signature fix'],
  ['.ic { display: flex; }', 'the .ic display rule'],
  ['function contactValid', 'contact validation'],
  ['function clearContactValue', 'the channel-switch reset'],
  ['next.disabled = !contactReady();', 'the live Continue gate']
];
for (const [needle, what] of must) {
  if (page.indexOf(needle) === -1) { die('the candidate is stale: ' + what + ' is missing — re-run scripts/build-miniapp-host.mjs'); }
}
if (/s\.style\.display = 'flex'/.test(page)) { die('the candidate still writes an inline display in icon()'); }
ok('all five fix markers present, and the inline display is gone');
say('');

// ── 4. nothing but the page may differ ─────────────────────────────────────────────────────────
//
// If the live host has been edited since the candidate was built — a changed route, a changed
// header, a third node — pushing this candidate would silently revert that edit. The page body is
// the ONE thing allowed to differ.
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

// ── 6. read back, and verify from the tenant rather than from this process ─────────────────────
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
  ok('all five fix markers verified in the deployed page');
  if (/s\.style\.display = 'flex'/.test(afterPage)) { die('the deployed page still writes an inline display — ROLLBACK'); }
  ok('the inline display that put a check on every row is gone from the tenant');

  say('');
  say('DONE. Rollback: PUT the contents of ' + rollbackPath + ' back to /workflows/' + HOST_ID + '.');
  say('');
}
