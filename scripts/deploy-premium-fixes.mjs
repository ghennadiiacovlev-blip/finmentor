#!/usr/bin/env node
// FINMENTOR — the two remaining product defects, onto the live response node.
//
//   node scripts/deploy-premium-fixes.mjs --dry-run
//   node scripts/deploy-premium-fixes.mjs --confirm
//
//   1. EXTRACTION found two of six explicitly stated facts. Company, scale and activity now come
//      from explicit constructions and closed vocabularies; the objective vocabulary learned the
//      words the client actually used.
//   2. «Начать новый вопрос» on TG_NEW_REQUEST_CONFIRM carried the action that OPENED the screen,
//      so the button re-rendered its own screen and no client could start a new question.
//
// deploy-premium-copy.mjs REFUSES this change, correctly: its guard requires every changed line to
// be copy or rendering, and this is logic. So the guard here is different in kind — it renders all
// ten screens through the OLD body and the NEW one and requires the client-visible text to be
// byte-identical, which is what "premium copy unchanged" actually means.

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

const UAT = 'Я собственник Demo Retail. У нас сеть из 6 магазинов в Молдове, ' +
  'годовой оборот около 5 млн евро. Компания прибыльная, но последние месяцы регулярно ' +
  'возникают кассовые разрывы и не хватает понимания, что будет с деньгами через 2–3 месяца. ' +
  'Используем 1C и бухгалтерский учёт, отдельного CFO нет. Хочу понять причины проблемы и ' +
  'настроить прогноз движения денежных средств. Решение нужно в течение ближайшего месяца.';

// Every reachable client-facing screen, reached the way a client reaches it.
const S = (e) => Object.assign({ chat_id: '551000000', cycle_id: 'C-T', lead_id: '', lead_cycle_id: '',
  draft_state: '', draft_step: '', context_extracted_json: '', state: 'TG_ENTRY' }, e || {});
const C = (e) => S(Object.assign({ lead_id: 'L1', lead_cycle_id: 'C-T', state: 'TG_SUBMITTED' }, e || {}));
const D = (e) => S(Object.assign({ draft_state: 'draft', draft_step: 'objective' }, e || {}));
const SCREENS = [
  ['TG_ENTRY', S({ state: 'BUSINESS_MODEL_SELECTED' }), { text: '/start' }],
  ['TG_FREEFORM_PROBLEM', S(), { cb: 'p|describe' }],
  ['TG_CONFIRM_CONTEXT', S({ state: 'TG_FREEFORM_PROBLEM' }), { text: UAT }],
  ['TG_OPEN_BRIEF', S({ state: 'TG_CONFIRM_CONTEXT', context_extracted_json: JSON.stringify({ role: 'Собственник' }) }), { cb: 'p|ctx_ok' }],
  ['TG_SUBMITTED', C(), { text: '/start' }],
  ['TG_APPEND_MESSAGE', C(), { cb: 'p|append' }],
  ['TG_APPEND_DONE', C({ state: 'TG_APPEND_MESSAGE' }), { text: 'Ещё деталь.' }],
  ['TG_NEW_REQUEST_CONFIRM', C(), { cb: 'p|new' }],
  ['TG_RESUME_DRAFT', D(), { text: '/start' }],
  ['TG_RESUME_DISCARD', D(), { cb: 'p|restart' }]
];
function driver(body) {
  const runner = new Function('$input', '$', body);
  return (session, o) => {
    const parse = { chat_id: '551000000', message_text: (o || {}).text || '', callback_data: (o || {}).cb || '' };
    return runner({ first: () => ({ json: session }) },
      (n) => { if (n === 'Parse Telegram Update') { return { first: () => ({ json: parse }) }; } throw new Error('unexpected ' + n); })[0].json;
  };
}
const labelsOf = (r) => (r.reply_markup.inline_keyboard || []).map((row) => row[0].text);
const callbacksOf = (r) => (r.reply_markup.inline_keyboard || []).map((row) => row[0].callback_data || (row[0].web_app ? 'WEB_APP' : ''));

say('');
say('Two product defects: extraction quality, and the new-request confirmation');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

say('STEP 1 — fresh read');
const live = await api('GET', '/workflows/' + CONCIERGE_ID);
const beforeStruct = structural(live.nodes, live.connections);
say('  name       : ' + live.name);
say('  nodes      : ' + live.nodes.length + '   active: ' + live.active);
say('  structural : ' + beforeStruct);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-premium-fixes.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-premium-fixes.json');
say('');

say('STEP 2 — the new body, keeping what the live body earned');
const cand = JSON.parse(readFileSync(CANDIDATE, 'utf8'));
const patched = JSON.parse(JSON.stringify(live));
const node = patched.nodes.find((n) => n.name === NODE);
if (!node) { die('the premium response builder is not on the live workflow'); }
const liveBody = String(node.parameters.jsCode);
let newBody = String(cand.nodes.find((n) => n.name === NODE).parameters.jsCode);
{
  const m = liveBody.match(/const MINIAPP_URL = "([^"]+)";/);
  if (!m) { die('the live body does not declare a Mini App URL in the expected form'); }
  if (m[1] === PLACEHOLDER) { die('the live body still holds the placeholder'); }
  if (!/^https:\/\//.test(m[1])) { die('the live Mini App URL is not HTTPS'); }
  if (newBody.indexOf(PLACEHOLDER) === -1) { die('the candidate body has no placeholder to substitute'); }
  newBody = newBody.split(PLACEHOLDER).join(m[1]);
  ok('the live Mini App URL is carried over (value withheld)');
}
say('');

say('STEP 3 — the client-visible copy must be byte-identical');
const before = driver(liveBody);
const after = driver(newBody);
{
  let same = true;
  for (const [name, sess, inp] of SCREENS) {
    const a = before(JSON.parse(JSON.stringify(sess)), inp);
    const b = after(JSON.parse(JSON.stringify(sess)), inp);
    // TG_CONFIRM_CONTEXT is the one screen whose TEXT is data — the whole point of fix 1 is that it
    // now carries more of it. Its header, closing and labels are compared instead of the body.
    if (name === 'TG_CONFIRM_CONTEXT') {
      const head = (t) => String(t).split('\n')[0];
      const tail = (t) => String(t).split('\n').filter(Boolean).pop();
      if (head(a.reply_text) !== head(b.reply_text)) { bad(name + ': the header changed'); same = false; }
      if (tail(a.reply_text) !== tail(b.reply_text)) { bad(name + ': the closing line changed'); same = false; }
    } else if (a.reply_text !== b.reply_text) {
      bad(name + ': the copy changed');
      say('        was : ' + JSON.stringify(String(a.reply_text).slice(0, 90)));
      say('        now : ' + JSON.stringify(String(b.reply_text).slice(0, 90)));
      same = false;
    }
    if (a.tg_body.parse_mode !== b.tg_body.parse_mode) { bad(name + ': the parse mode changed'); same = false; }
    if (JSON.stringify(labelsOf(a)) !== JSON.stringify(labelsOf(b))) {
      bad(name + ': the button LABELS changed ' + JSON.stringify(labelsOf(a)) + ' -> ' + JSON.stringify(labelsOf(b)));
      same = false;
    }
  }
  if (same) { ok('all ten screens: copy, parse mode and button labels byte-identical'); }
  else { die('the copy pass would be disturbed — nothing was written'); }
}

say('');
say('STEP 4 — exactly one callback binding changes, and it is the defective one');
{
  const changes = [];
  for (const [name, sess, inp] of SCREENS) {
    const a = callbacksOf(before(JSON.parse(JSON.stringify(sess)), inp));
    const b = callbacksOf(after(JSON.parse(JSON.stringify(sess)), inp));
    if (JSON.stringify(a) !== JSON.stringify(b)) { changes.push([name, a, b]); }
  }
  for (const [name, a, b] of changes) { say('  ' + name + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b)); }
  if (changes.length !== 1 || changes[0][0] !== 'TG_NEW_REQUEST_CONFIRM') {
    die('callback bindings changed on ' + (changes.length ? changes.map((c) => c[0]).join(', ') : 'nothing') + ' — expected only TG_NEW_REQUEST_CONFIRM');
  }
  if (JSON.stringify(changes[0][2]) !== JSON.stringify(['p|new_y', 'p|back'])) {
    die('the confirmation screen did not land on the confirm action: ' + JSON.stringify(changes[0][2]));
  }
  ok('only TG_NEW_REQUEST_CONFIRM rebinds: p|new -> p|new_y, cancel unchanged');
}

say('');
say('STEP 5 — behaviour');
{
  let good = true;
  const g = (c, m) => { if (c) { ok(m); } else { bad(m); good = false; } };

  const r = after(S({ state: 'TG_FREEFORM_PROBLEM' }), { text: UAT });
  g(r.debug.state_after === 'TG_CONFIRM_CONTEXT', 'the Demo Retail text reaches the confirmation screen');
  const ctx = JSON.parse(r.session.context_extracted_json || '{}');
  for (const [k, want] of [['company_name', 'Demo Retail'], ['role', 'Собственник'],
    ['turnover_band', '€2–10 млн'], ['objective', 'Денежный поток']]) {
    g(ctx[k] === want, '  ' + k + ' = ' + JSON.stringify(ctx[k]));
  }
  g(String(ctx.problem_summary || '').indexOf('кассовые разрывы') !== -1, '  problem_summary names the stated problem');
  g(String(r.session.context_confirmed) === 'false', 'nothing is confirmed by extraction');

  // Rotation, on the deployed body.
  const conf = after(C({ state: 'TG_NEW_REQUEST_CONFIRM' }), { cb: 'p|new_y' });
  g(conf.debug.rotate === true && conf.session.archived_lead_id === 'L1', 'the confirmed action rotates exactly once and archives the lead');
  const dup = after(Object.assign({}, conf.session, { state: conf.debug.state_after }), { cb: 'p|new_y' });
  g(dup.debug.rotate === false && String(dup.debug.writes || '') === '', 'a duplicate tap does not rotate again');
  const back = after(C({ state: 'TG_NEW_REQUEST_CONFIRM' }), { cb: 'p|back' });
  g(back.debug.rotate === false && back.session.lead_id === 'L1', 'Вернуться does not rotate and leaves the committed lead');
  const open = after(C(), { cb: 'p|new' });
  g(open.debug.rotate === false, 'opening the confirmation does not rotate');
  const start = after(C(), { text: '/start' });
  g(start.debug.rotate === false && start.session.lead_id === 'L1', '/start on a committed cycle does not rotate');
  g(conf.lead_ready !== true, 'rotation does not set lead_ready — Lead Intake is not called');

  // Escaping survived.
  const hostile = after(S({ state: 'TG_FREEFORM_PROBLEM' }), { text: 'Я собственник ООО «Ромашка». <b>Кассовые разрывы</b> & нет прогноза движения денежных средств.' });
  g(hostile.reply_text.indexOf('&lt;b&gt;') !== -1 && hostile.reply_text.indexOf('&amp;') !== -1, 'client markup is still escaped');

  if (!good) { die('the new body misbehaves — nothing was written'); }
}
node.parameters.jsCode = newBody;

say('');
say('STEP 6 — prove nothing else on the workflow moved');
{
  if (patched.nodes.length !== live.nodes.length) { die('node count changed'); }
  if (JSON.stringify(patched.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
  if (JSON.stringify(patched.settings) !== JSON.stringify(live.settings)) { die('settings changed'); }
  ok('node count, connections and settings unchanged');
  const changed = patched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(live.nodes.find((x) => x.name === n.name))).map((n) => n.name);
  if (changed.join('|') !== NODE) { die('nodes changed beyond the one: ' + changed.join(', ')); }
  ok('exactly one node differs: ' + NODE);
  for (const [name, needle, what] of [
    ['Build Transport Request', "$('Build Bot Response (Premium)').isExecuted", 'the response resolver'],
    ['Issuance Gate', "$('Get Bot Session (Premium)').isExecuted", 'the session resolver'],
    ['Build Transport Request', "'#HTML'", 'the L0_NONE_HTML mapping'],
    ['Build Transport Request', "'W#HTML'", 'the L1_W_HTML mapping']
  ]) {
    if (String(patched.nodes.find((n) => n.name === name).parameters.jsCode).indexOf(needle) === -1) { die(what + ' is missing from ' + name); }
  }
  ok('both resolvers and both HTML layout mappings still in place');
  for (const name of ['Build Bot Response', 'Premium Owner Gate']) {
    if (JSON.stringify(patched.nodes.find((n) => n.name === name)) !== JSON.stringify(live.nodes.find((n) => n.name === name))) { die(name + ' changed'); }
  }
  ok('the legacy response builder and the owner gate are untouched');
  if (node.alwaysOutputData === true && node.onError === 'continueErrorOutput') { die('P9-R2 flag pair'); }
  ok('P9-R2 flag pair absent');
}
say('');

if (DRY) {
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.premium-fixes-candidate.json'), JSON.stringify(importable(patched), null, 2) + '\n', 'utf8');
  say('DRY RUN — nothing written. Candidate saved to .uat/.');
  say('');
} else {
  say('STEP 7 — writing');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(patched), 3);
  ok('written');
  say('');
  say('STEP 8 — fresh read and verify');
  const back = await api('GET', '/workflows/' + CONCIERGE_ID);
  let good = true;
  if (structural(back.nodes, back.connections) !== beforeStruct) { bad('structural hash moved'); good = false; } else { ok('structural hash identical'); }
  if (back.name !== live.name) { bad('renamed'); good = false; } else { ok('name unchanged'); }
  if (!back.active) { bad('NOT active'); good = false; } else { ok('active'); }
  const deployed = String(back.nodes.find((n) => n.name === NODE).parameters.jsCode);
  if (deployed !== newBody) { bad('the readback body does not match what was sent'); good = false; } else { ok('the readback body matches byte-for-byte'); }
  if (deployed.indexOf(PLACEHOLDER) !== -1) { bad('the deployed body still holds the URL placeholder'); good = false; }
  else { ok('the Mini App URL is real, not a placeholder'); }
  if (!(back.settings || {}).errorWorkflow) { bad('errorWorkflow binding lost'); good = false; } else { ok('error monitor binding intact'); }
  // The deployed body, driven once more from the readback.
  const live2 = driver(deployed);
  const r = live2(S({ state: 'TG_FREEFORM_PROBLEM' }), { text: UAT });
  const ctx = JSON.parse(r.session.context_extracted_json || '{}');
  if (ctx.company_name === 'Demo Retail' && ctx.turnover_band === '€2–10 млн' && ctx.objective === 'Денежный поток') { ok('the DEPLOYED body extracts the Demo Retail facts'); }
  else { bad('the deployed body does not extract: ' + JSON.stringify(ctx)); good = false; }
  const conf = live2(C(), { cb: 'p|new' });
  if (JSON.stringify(callbacksOf(conf)) === JSON.stringify(['p|new_y', 'p|back'])) { ok('the DEPLOYED confirmation button invokes the confirm action'); }
  else { bad('the deployed confirmation button is still miswired'); good = false; }
  say('');
  say(good ? '  PREMIUM FIXES = PASS' : '  PREMIUM FIXES = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-premium-fixes.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
