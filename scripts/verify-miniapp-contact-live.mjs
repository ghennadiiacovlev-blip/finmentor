#!/usr/bin/env node
// FINMENTOR — prove the contact-screen fix on the TENANT, not in the repo.
//
//   node scripts/verify-miniapp-contact-live.mjs
//
// READ-ONLY. One GET.
//
// ── WHY THIS EXISTS SEPARATELY FROM THE DEPLOY SCRIPT ──────────────────────────────────────────
//
// The deploy script verifies that the bytes it sent are the bytes that landed. That proves the
// transport, not the behaviour. This extracts `app.js` and `app.css` back OUT of the served page
// and requires them to be byte-identical to the repo files — which is what makes
// qa/premium-ux-contact-channel.test.mjs, all 17 assertions of it, a statement about the tenant
// rather than about the working tree.
//
// It then re-checks the owner's acceptance list directly against the deployed source, so the claim
// does not rest on the equality alone.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HOST_ID = 'KBD7Q94QQnlzgYKJ';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
let pass = 0;
const fail = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));

console.log('');
console.log('Mini App contact screen — LIVE verification');
console.log('='.repeat(78));

const res = await fetch(BASE + '/api/v1/workflows/' + HOST_ID, { headers: { 'X-N8N-API-KEY': KEY } });
if (!res.ok) { console.error('STOPPED: GET workflow -> ' + res.status); process.exit(1); }
const wf = await res.json();
const page = String(wf.nodes.find((n) => n.name === 'Serve Page').parameters.responseBody || '');
console.log('  served page: ' + page.length + ' bytes, sha256 ' + sha(page).slice(0, 16));
console.log('  active     : ' + wf.active);
console.log('');

// ── 1. the deployed sources ARE the gated sources ──────────────────────────────────────────────
console.log('THE DEPLOYED SOURCES');
const appJs = readFileSync(join(ROOT, 'app-premium', 'app.js'), 'utf8');
const appCss = readFileSync(join(ROOT, 'app-premium', 'app.css'), 'utf8');
want(page.indexOf(appJs) !== -1, 'the served page contains app.js byte-for-byte');
want(page.indexOf(appCss) !== -1, 'the served page contains app.css byte-for-byte');
console.log('');

// ── 2. the owner's acceptance list, checked against the served bytes ───────────────────────────
console.log('CONTACT CHANNEL = SINGLE SELECT');
want(/set\('contact_channel', o\.id, 'user_explicit', true\)/.test(page),
  'the channel is assigned by replacement, never pushed to a list');
want(page.indexOf("if (state === 'APP_CONTACT') { return ['contact_channel']; }") !== -1,
  'the screen requires exactly one field');
want(!/contact_channel[^\n]*\.push\(/.test(page), 'nothing appends to the channel');
console.log('');

console.log('SELECTED ROW — selected surface/border, exactly one check');
want(/\.row\.is-selected \{[^}]*border-color: var\(--line-selected\)/.test(page), 'selected border');
want(/\.row\.is-selected \{[^}]*box-shadow: inset 0 0 0 1px var\(--line-selected\)/.test(page), 'reinforced border weight');
want(/\.row\.is-selected \{[^}]*background: var\(--surface-2\)/.test(page), 'selected surface');
want(/\.row\.is-selected \.tick \{ display: flex; \}/.test(page), 'the selected row shows its check');
console.log('');

console.log('UNSELECTED ROWS — no check');
want(/\.row \.tick \{ display: none;/.test(page), 'unselected rows hide the check');
want(/\.card \.tick \{ display: none;/.test(page), 'unselected cards hide the check');
want(/\.ic \{ display: flex; \}/.test(page), 'display is a class rule, which the row rules outrank');
want(!/s\.style\.display = 'flex'/.test(page), 'NO inline display — the defect that put a check on every row');
want(page.indexOf(".className = 'tick'") === -1, 'no call site overwrites the class and drops .ic');
console.log('');

console.log('CONDITIONAL FIELDS');
want(/if \(ch === 'telegram'\) \{ s\.appendChild\(quiet\(C\.CONTACT\.telegramNote\)\); \}/.test(page),
  'Telegram renders a note and no field');
want(/if \(ch === 'phone' \|\| ch === 'email'\) \{/.test(page), 'phone and email each render one field');
want(/ch === 'phone' \? 'Телефон' : 'Email'/.test(page), 'the field is labelled for the chosen channel');
want(page.indexOf("inp.type = kind === 'phone' ? 'tel' : (kind === 'email' ? 'email' : 'text')") !== -1,
  'the input type follows the channel');
console.log('');

console.log('SWITCHING — no stale contact survives as the preferred one');
want(page.indexOf("if (get('contact_channel') !== o.id) { clearContactValue(); }") !== -1,
  'ANY change of channel discards the previous value');
want(page.indexOf("if (o.id === 'telegram') { draft.fields.contact_value") === -1,
  'the old telegram-only reset is gone');
want(page.indexOf('function contactValid') !== -1, 'the typed contact is validated');
want(page.indexOf('function contactReady') !== -1, 'Continue is gated on channel AND validity');
want(page.indexOf("field.addEventListener('input', function () { next.disabled = !contactReady(); });") !== -1,
  'Continue re-evaluates as the client types — without this both branches are dead ends');
console.log('');

// ── 3. the offline gate, which now speaks about the tenant ─────────────────────────────────────
console.log('THE GATE, RE-RUN AGAINST THE SOURCES JUST PROVEN DEPLOYED');
const r = spawnSync(process.execPath, [join(ROOT, 'qa', 'premium-ux-contact-channel.test.mjs')], { encoding: 'utf8' });
const tally = /ASSERTIONS: (\d+) passed(?:, (\d+) failed)?/.exec(r.stdout || '');
if (r.status === 0 && tally && !tally[2]) { ok('qa/premium-ux-contact-channel.test.mjs — ' + tally[1] + ' assertions'); }
else { bad('the contact-channel gate did not pass: ' + String(r.stdout || r.stderr).slice(-400)); }

console.log('');
console.log('='.repeat(78));
if (fail.length) {
  console.log('FAILURES (' + fail.length + '):');
  fail.forEach((f) => console.log('  - ' + f));
  console.log('CHECKS: ' + pass + ' passed, ' + fail.length + ' failed');
  process.exitCode = 1;
} else {
  console.log('CHECKS: ' + pass + ' passed. The tenant serves the fixed contact screen.');
}
console.log('');
