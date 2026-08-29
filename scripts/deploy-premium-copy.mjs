#!/usr/bin/env node
// FINMENTOR — the owner-approved Premium copy pass onto the live response node.
//
//   node scripts/deploy-premium-copy.mjs --dry-run
//   node scripts/deploy-premium-copy.mjs --confirm
//
// Replaces ONLY `Build Bot Response (Premium)`'s body with the freshly built candidate body, and
// only after proving that the difference between live and candidate is copy and rendering — not
// logic. Everything else on the workflow, the legacy node included, is untouched.
//
// ── WHY THE BODY IS TAKEN WHOLE, AND WHAT GUARDS THAT ──────────────────────────────────────────
//
// The copy lives in ten places inside the generated body, so a surgical string-swap would be ten
// chances to get one wrong. Instead the whole body comes from the builder — and the deploy proves
// the swap is safe by DIFFING the two bodies line by line and requiring every changed line to be
// copy, the render helper, or the escape helper. A changed line anywhere else stops the deploy.
//
// The live body also carries two things the builder's does not: the real Mini App URL (substituted
// at deploy time) and the node-reference resolvers. Both are re-applied from the LIVE body, and
// asserted present afterwards, so this cannot silently undo the earlier fixes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const NODE = 'Build Bot Response (Premium)';
const PLACEHOLDER = '__PREMIUM_MINIAPP_URL__';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(m, p, b, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + p, { method: m,
        headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
        body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const structural = (nodes, connections) => sha({
  n: nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null, n.alwaysOutputData || null]), c: connections });
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

if (!BASE || !READ_KEY || !WRITE_KEY) { die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('this modifies the live Concierge; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

say('');
say('Premium copy pass -> the live response node');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

say('STEP 1 — fresh read');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('  name       : ' + live.name);
say('  nodes      : ' + live.nodes.length + '   active: ' + live.active);
say('  structural : ' + beforeStruct);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-premium-copy.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-premium-copy.json');
say('');

say('STEP 2 — build the new body from the candidate, keeping what the live body earned');
const cand = JSON.parse(readFileSync(CANDIDATE, 'utf8'));
const candBody = String(cand.nodes.find((n) => n.name === NODE).parameters.jsCode);
const patched = JSON.parse(JSON.stringify(live));
const node = patched.nodes.find((n) => n.name === NODE);
if (!node) { die('the premium response builder is not on the live workflow'); }
const liveBody = String(node.parameters.jsCode);

// -- the Mini App URL: taken from the LIVE body, never from anywhere else.
let newBody = candBody;
{
  const m = liveBody.match(/const MINIAPP_URL = "([^"]+)";/);
  if (!m) { die('the live body does not declare a Mini App URL in the expected form'); }
  if (m[1] === PLACEHOLDER) { die('the live body still holds the placeholder — refusing to redeploy it'); }
  if (!/^https:\/\//.test(m[1])) { die('the live Mini App URL is not HTTPS'); }
  if (newBody.indexOf(PLACEHOLDER) === -1) { die('the candidate body has no placeholder to substitute'); }
  newBody = newBody.split(PLACEHOLDER).join(m[1]);
  ok('the live Mini App URL is carried over (value withheld)');
}
// -- the node-reference resolvers, which the builder does not emit.
{
  const resolverPairs = [
    ["$('Parse Telegram Update')", 'the parse-update reference'],
    ["$input.first().json", 'the session read']
  ];
  // The builder emits `$input.first().json` for the session; the deployed node reads the same way,
  // so nothing to re-apply — but if that ever changes, this must fail rather than quietly diverge.
  for (const [needle, what] of resolverPairs) {
    if (liveBody.indexOf(needle) !== -1 && newBody.indexOf(needle) === -1) {
      die('the new body loses ' + what + ' that the live body has');
    }
  }
  ok('every node reference the live body uses survives into the new body');
}
say('');

say('STEP 3 — prove the diff is copy and rendering, not logic');
{
  const a = liveBody.split('\n');
  const b = newBody.split('\n');
  // Longest-common-subsequence diff is overkill here; what matters is the SET of lines that are in
  // one and not the other. A logic change shows up as a line that is neither copy nor a helper.
  const setA = new Map(); const setB = new Map();
  for (const l of a) { setA.set(l, (setA.get(l) || 0) + 1); }
  for (const l of b) { setB.set(l, (setB.get(l) || 0) + 1); }
  const only = (x, y) => [...x.keys()].filter((k) => (y.get(k) || 0) < x.get(k));
  const removed = only(setA, setB);
  const added = only(setB, setA);
  say('  lines removed : ' + removed.length);
  say('  lines added   : ' + added.length);

  // A changed line is ALLOWED if it is copy (contains Cyrillic or a tag), or belongs to the two
  // helpers this pass introduces, or is a comment. Anything else is logic and stops the deploy.
  const ALLOWED = (l) => {
    const t = l.trim();
    if (t === '' || t.indexOf('//') === 0) { return true; }
    if (/[А-Яа-яЁё]/.test(t)) { return true; }                      // Russian copy
    if (/<\/?[bi]>/.test(t)) { return true; }                       // markup
    if (/parse_mode/.test(t)) { return true; }                      // the mode declaration
    if (/escapeHtml|amp;|&lt;|&gt;/.test(t)) { return true; }       // the escape helper
    if (/lines\.push|lines\.join|const lines = /.test(t)) { return true; } // the render helper
    if (/^function escapeHtml|^}$|^\s*\.split\(/.test(t)) { return true; }
    // escapeHtml opens with the same null-guard prelude as safeText. It is one more copy of a line
    // that already exists, which is why the counts differ by one — not a new behaviour.
    if (t === 'return String(value === null || value === undefined ? "" : value)') { return true; }
    return false;
  };
  const suspicious = removed.concat(added).filter((l) => !ALLOWED(l));
  if (suspicious.length) {
    say('');
    say('  lines that are neither copy nor rendering:');
    for (const l of suspicious.slice(0, 25)) { say('    ' + l.trim().slice(0, 110)); }
    die(suspicious.length + ' changed line(s) look like logic — refusing to deploy a copy pass that changes behaviour');
  }
  ok('every changed line is copy, markup, a comment, or one of the two render/escape helpers');
}

// Behaviour, asserted directly rather than inferred from the diff.
{
  const runner = new Function('$input', '$', newBody);
  const run = (session, o) => {
    const parse = { chat_id: '551000000', message_text: (o || {}).text || '', callback_data: (o || {}).cb || '' };
    return runner({ first: () => ({ json: session }) },
      (n) => { if (n === 'Parse Telegram Update') { return { first: () => ({ json: parse }) }; } throw new Error('unexpected ' + n); })[0].json;
  };
  const S = (e) => Object.assign({ chat_id: '551000000', cycle_id: 'C-T', lead_id: '', lead_cycle_id: '',
    draft_state: '', draft_step: '', context_extracted_json: '', state: 'TG_ENTRY' }, e || {});
  const cases = [
    ['/start -> TG_ENTRY', run(S({ state: 'BUSINESS_MODEL_SELECTED' }), { text: '/start' }), 'TG_ENTRY'],
    ['describe -> TG_FREEFORM_PROBLEM', run(S(), { cb: 'p|describe' }), 'TG_FREEFORM_PROBLEM'],
    ['free text -> TG_CONFIRM_CONTEXT', run(S({ state: 'TG_FREEFORM_PROBLEM' }),
      { text: 'Я собственник Demo Retail, кассовые разрывы, нужен прогноз движения денежных средств.' }), 'TG_CONFIRM_CONTEXT'],
    ['empty text stays put', run(S({ state: 'TG_FREEFORM_PROBLEM' }), { text: '   ' }), 'TG_FREEFORM_PROBLEM']
  ];
  let good = true;
  for (const [name, r, want] of cases) {
    if (r.debug.state_after !== want) { bad(name + ' -> ' + r.debug.state_after); good = false; }
  }
  if (good) { ok('the four load-bearing transitions are unchanged'); }
  else { die('the new body changes behaviour — nothing was written'); }

  // Every screen must now declare HTML, and client text must be escaped.
  const hostile = run(S({ state: 'TG_FREEFORM_PROBLEM' }),
    { text: 'Я собственник ООО «Ромашка». <b>Кассовые разрывы</b> & нет прогноза.' });
  if (hostile.tg_body.parse_mode !== 'HTML') { die('the confirmation screen does not send as HTML'); }
  if (hostile.reply_text.indexOf('&lt;b&gt;') === -1) { die('client markup was not escaped'); }
  if (hostile.reply_text.indexOf('&amp;') === -1) { die('a client ampersand was not escaped'); }
  ok('the confirmation screen sends HTML and escapes the client\'s own markup');

  const entry = run(S({ state: 'BUSINESS_MODEL_SELECTED' }), { text: '/start' });
  if (entry.reply_text.indexOf('<b>FINMENTOR</b>') !== 0) { die('TG_ENTRY copy changed — it must not'); }
  ok('TG_ENTRY is untouched, as required');
}
node.parameters.jsCode = newBody;
say('');

say('STEP 4 — prove nothing else on the workflow moved');
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('settings changed'); }
  if (patched.name !== live.name) { die('name changed'); }
  ok('node count, connections, settings and name unchanged');

  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name);
  if (changed.join('|') !== NODE) { die('nodes changed beyond the one: ' + changed.join(', ')); }
  ok('exactly one node differs: ' + NODE);

  for (const [name, needle, what] of [
    ['Build Transport Request', "$('Build Bot Response (Premium)').isExecuted", 'the response resolver'],
    ['Issuance Gate', "$('Get Bot Session (Premium)').isExecuted", 'the session resolver'],
    ['Build Transport Request', "'#HTML'", 'the L0_NONE_HTML mapping'],
    ['Build Transport Request', "'W#HTML'", 'the L1_W_HTML mapping']
  ]) {
    if (String(patched.nodes.find((n) => n.name === name).parameters.jsCode).indexOf(needle) === -1) {
      die(what + ' is missing from ' + name);
    }
  }
  ok('both resolvers and both new layout mappings are still in place');

  const legacy = patched.nodes.find((n) => n.name === 'Build Bot Response');
  if (JSON.stringify(legacy) !== JSON.stringify(live.nodes.find((n) => n.name === 'Build Bot Response'))) { die('the legacy response builder changed'); }
  const gateNode = patched.nodes.find((n) => n.name === 'Premium Owner Gate');
  if (JSON.stringify(gateNode) !== JSON.stringify(live.nodes.find((n) => n.name === 'Premium Owner Gate'))) { die('the owner gate changed'); }
  ok('the legacy response builder and the owner gate are untouched');

  if (node.alwaysOutputData === true && node.onError === 'continueErrorOutput') { die('P9-R2 flag pair'); }
  ok('P9-R2 flag pair absent');
}
say('');

if (DRY) {
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.premium-copy-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
  say('DRY RUN — nothing written. Candidate saved to .uat/.');
  say('');
} else {
  say('STEP 5 — writing');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(patched), 3);
  ok('written');
  say('');
  say('STEP 6 — fresh read and verify');
  const after = await api('GET', '/workflows/' + CONCIERGE_ID);
  let good = true;
  if (structural(after.nodes, after.connections) !== beforeStruct) { bad('structural hash moved'); good = false; } else { ok('structural hash identical'); }
  if (after.name !== live.name) { bad('renamed'); good = false; } else { ok('name unchanged'); }
  if (!after.active) { bad('NOT active'); good = false; } else { ok('active'); }
  const back = String(after.nodes.find((n) => n.name === NODE).parameters.jsCode);
  if (back !== newBody) { bad('the readback body does not match what was sent'); good = false; } else { ok('the readback body matches byte-for-byte'); }
  if (back.indexOf(PLACEHOLDER) !== -1) { bad('the deployed body still holds the URL placeholder'); good = false; }
  else { ok('the Mini App URL is real, not a placeholder'); }
  if (!(after.settings || {}).errorWorkflow) { bad('errorWorkflow binding lost'); good = false; } else { ok('error monitor binding intact'); }
  say('');
  say(good ? '  PREMIUM COPY = PASS' : '  PREMIUM COPY = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-premium-copy.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
