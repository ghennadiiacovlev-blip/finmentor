#!/usr/bin/env node
// FINMENTOR — an empty message must not skip the question the screen is asking.
//
//   node scripts/deploy-empty-guard.mjs --dry-run
//   node scripts/deploy-empty-guard.mjs --confirm
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────────
//
// On TG_FREEFORM_PROBLEM a message of "" is still a text input, so `decide()` returns
// TG_CONFIRM_CONTEXT with an empty `free_text`. Extraction then finds nothing — correctly, there is
// nothing there — and the "a confirmation screen with nothing on it is worse than no screen" rule
// forwards to TG_OPEN_BRIEF. Net effect: a stray empty message walks the client PAST the only
// question that screen exists to ask, and stores an empty summary on the way.
//
// The owner's test F asks for a controlled retry. This is it: stay on the screen, write nothing.
//
// ── THE PATCH ──────────────────────────────────────────────────────────────────────────────────
//
// A pure INSERTION into `Build Bot Response (Premium)`, ahead of the session writes so no empty
// value is ever stored. The deploy proves it by deleting the inserted block again and requiring the
// node back byte-for-byte. Nothing else in the workflow is touched.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const NODE = 'Build Bot Response (Premium)';
const ANCHOR = '// ---------------------------------------------------------------- session writes';

const BLOCK = [
  '// An empty or whitespace-only message is not an answer to "describe your situation". Carrying it',
  '// forward would store an empty summary AND — since nothing structured can be found in nothing —',
  '// let the "no structure, skip ahead" rule below march past the one question this screen exists',
  '// to ask. Stay on the screen instead, and write nothing.',
  'if (outcome.state === "TG_CONFIRM_CONTEXT" && (outcome.writes || []).indexOf("free_text") !== -1',
  '    && String(outcome.free_text || "").trim() === "") {',
  '  outcome.state = "TG_FREEFORM_PROBLEM";',
  '  outcome.copy = B.TG_COPY.TG_FREEFORM_PROBLEM;',
  '  outcome.writes = [];',
  '  outcome.free_text = "";',
  '}',
  ''
].join('\n');

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
say('Empty free-text message: stay on the screen instead of skipping ahead');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

say('STEP 1 — fresh read');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('  name       : ' + live.name);
say('  nodes      : ' + live.nodes.length + '   active: ' + live.active);
say('  structural : ' + beforeStruct);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-empty-guard.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-empty-guard.json');
say('');

say('STEP 2 — insert the guard, and nothing else');
const patched = JSON.parse(JSON.stringify(live));
const node = patched.nodes.find((n) => n.name === NODE);
if (!node) { die('the premium response builder is not on the live workflow'); }
const was = String(node.parameters.jsCode);
if (was.indexOf('An empty or whitespace-only message') !== -1) { die('the guard is already deployed — nothing to do'); }
if (was.split(ANCHOR).length !== 2) { die('the session-writes anchor is missing or ambiguous'); }
node.parameters.jsCode = was.split(ANCHOR).join(BLOCK + '\n' + ANCHOR);
ok('guard inserted ahead of the session writes (' + BLOCK.split('\n').length + ' lines)');
say('');

say('STEP 3 — prove nothing else moved');
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('settings changed'); }
  if (patched.name !== live.name) { die('name changed'); }
  ok('node count, connections, settings and name unchanged');

  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name);
  if (changed.join('|') !== NODE) { die('nodes changed beyond the one: ' + changed.join(', ')); }
  ok('exactly one node differs: ' + NODE);

  const undone = String(node.parameters.jsCode).split(BLOCK + '\n' + ANCHOR).join(ANCHOR);
  if (undone !== was) { die('the change is not a pure insertion'); }
  ok('a PURE insertion — deleting the block restores the node byte-for-byte');

  try { new Function(String(node.parameters.jsCode).replace(/\$\(/g, '__ref(').replace(/\$input/g, '__input').replace(/\$json/g, '__json')); }
  catch (e) { die('the patched body does not parse: ' + e.message); }
  ok('the patched body parses');

  if (node.alwaysOutputData === true && node.onError === 'continueErrorOutput') { die('P9-R2 flag pair'); }
  ok('P9-R2 flag pair absent');

  // The two resolvers already deployed must survive this.
  const bt = patched.nodes.find((n) => n.name === 'Build Transport Request');
  const ig = patched.nodes.find((n) => n.name === 'Issuance Gate');
  if (String(bt.parameters.jsCode).indexOf("$('Build Bot Response (Premium)').isExecuted") === -1) { die('the response resolver is gone'); }
  if (String(ig.parameters.jsCode).indexOf("$('Get Bot Session (Premium)').isExecuted") === -1) { die('the session resolver is gone'); }
  ok('both earlier resolvers still in place');
}
say('');

// Behavioural proof, on the patched body, before it is written anywhere.
say('STEP 4 — behaviour, on the patched body');
{
  const runner = new Function('$input', '$', node.parameters.jsCode);
  const run = (state, o) => {
    const parse = { chat_id: '551000000', message_text: (o || {}).text || '', callback_data: (o || {}).cb || '' };
    return runner({ first: () => ({ json: { chat_id: '551000000', cycle_id: 'C-T', lead_id: '', lead_cycle_id: '',
      draft_state: '', draft_step: '', context_extracted_json: '', state: state } }) },
    (n) => { if (n === 'Parse Telegram Update') { return { first: () => ({ json: parse }) }; } throw new Error('unexpected ' + n); })[0].json;
  };
  let good = true;
  for (const t of ['', '   ', '\n\n']) {
    const r = run('TG_FREEFORM_PROBLEM', { text: t });
    if (r.debug.state_after !== 'TG_FREEFORM_PROBLEM') { bad('an empty message went to ' + r.debug.state_after); good = false; }
    if (String(r.session.free_text_request || '') !== '') { bad('an empty summary was stored'); good = false; }
  }
  if (good) { ok('empty / whitespace-only messages stay on TG_FREEFORM_PROBLEM and store nothing'); }

  const real = run('TG_FREEFORM_PROBLEM', { text: 'Я собственник Demo Retail, кассовые разрывы, нужен прогноз движения денежных средств.' });
  if (real.debug.state_after === 'TG_CONFIRM_CONTEXT') { ok('real text is unaffected — still reaches TG_CONFIRM_CONTEXT'); }
  else { bad('real text now goes to ' + real.debug.state_after); good = false; }

  const entry = run('BUSINESS_MODEL_SELECTED', { text: '/start' });
  if (entry.debug.state_after === 'TG_ENTRY') { ok('/start unaffected'); } else { bad('/start -> ' + entry.debug.state_after); good = false; }
  if (!good) { die('the patched body misbehaves — nothing was written'); }
}
say('');

if (DRY) {
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.empty-guard-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
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
  const back = after.nodes.find((n) => n.name === NODE);
  if (String(back.parameters.jsCode) !== String(node.parameters.jsCode)) { bad('the readback body does not match what was sent'); good = false; }
  else { ok('the readback body matches byte-for-byte'); }
  if (!(after.settings || {}).errorWorkflow) { bad('errorWorkflow binding lost'); good = false; } else { ok('error monitor binding intact'); }
  say('');
  say(good ? '  EMPTY-MESSAGE GUARD = PASS' : '  EMPTY-MESSAGE GUARD = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-empty-guard.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
