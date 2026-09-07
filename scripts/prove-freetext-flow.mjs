#!/usr/bin/env node
// FINMENTOR — the free-text step, end to end, against the DEPLOYED premium nodes.
//
//   node scripts/prove-freetext-flow.mjs --confirm
//
// LIVE but ISOLATED. Sends nothing to Telegram, writes to no store.
//
// It runs the deployed `Build Bot Response (Premium)` body directly, and separately checks that
// `Issuance Gate` — the node that actually failed at 23:01 — can now resolve the session.
//
// The session row is PINNED rather than read, because the whole point of the defect was that the
// row never advanced. Pinning `state` is how each transition is tested independently of whether the
// previous one persisted.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(HERE, '..');
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }
if (!BASE || !READ_KEY) { console.error('N8N_BASE_URL and N8N_API_KEY required'); process.exit(1); }

const failures = [];
const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => { say('  FAIL  ' + m); failures.push(m); };
const eq = (a, b, m) => { if (a !== b) { bad(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); return false; } return true; };

const res = await fetch(BASE + '/api/v1/workflows/' + CONCIERGE_ID, { headers: { 'X-N8N-API-KEY': READ_KEY } });
const live = await res.json();
const respNode = live.nodes.find((n) => n.name === 'Build Bot Response (Premium)');
const issuance = live.nodes.find((n) => n.name === 'Issuance Gate');
if (!respNode || !issuance) { bad('the live workflow is missing a node under test'); process.exit(1); }

say('');
say('FREE-TEXT FLOW — the deployed premium response node');
say('='.repeat(78));
say('');

// Run the deployed body with a stubbed `$` and `$input`.
const runner = new Function('$input', '$', respNode.parameters.jsCode);
function run(session, opts) {
  const o = opts || {};
  const parse = { chat_id: '551000000', message_text: o.text || '', callback_data: o.cb || '' };
  const $ = (name) => {
    if (name === 'Parse Telegram Update') { return { first: () => ({ json: parse }) }; }
    throw new Error('unexpected node reference: ' + name);
  };
  return runner({ first: () => ({ json: session }) }, $)[0].json;
}

const CYCLE = 'C-TEST-1';
const sess = (extra) => Object.assign({
  chat_id: '551000000', cycle_id: CYCLE, lead_id: '', lead_cycle_id: '',
  draft_state: '', draft_step: '', context_extracted_json: '', state: ''
}, extra || {});

const UAT_TEXT = 'Я собственник Demo Retail. У нас сеть из 6 магазинов в Молдове, годовой оборот около 5 млн евро. ' +
  'Компания прибыльная, но последние месяцы регулярно возникают кассовые разрывы и не хватает понимания, ' +
  'что будет с деньгами через 2–3 месяца. Используем 1C и бухгалтерский учёт, отдельного CFO нет. ' +
  'Хочу понять причины проблемы и настроить прогноз движения денежных средств. Решение нужно в течение ближайшего месяца.';

const labels = (r) => (r.reply_markup.inline_keyboard || []).map((row) => row[0].text);

// A
{
  const r = run(sess({ state: 'BUSINESS_MODEL_SELECTED' }), { text: '/start' });
  if (eq(r.debug.state_after, 'TG_ENTRY', 'A. /start -> TG_ENTRY')) { ok('A. /start -> TG_ENTRY'); }
}
// B
{
  const r = run(sess({ state: 'TG_ENTRY' }), { cb: 'p|describe' });
  if (eq(r.debug.state_after, 'TG_FREEFORM_PROBLEM', 'B. «Описать задачу» -> TG_FREEFORM_PROBLEM')) {
    ok('B. «Описать задачу» -> TG_FREEFORM_PROBLEM');
  }
  eq(r.session.state, 'TG_FREEFORM_PROBLEM', 'B. the session the node hands on carries the new state');
}
// C — THE STEP THAT FAILED AT 23:01
{
  const r = run(sess({ state: 'TG_FREEFORM_PROBLEM' }), { text: UAT_TEXT });
  const okState = eq(r.debug.state_after, 'TG_CONFIRM_CONTEXT', 'C. the real UAT text -> TG_CONFIRM_CONTEXT');
  if (okState) { ok('C. the real 23:01 UAT text now reaches TG_CONFIRM_CONTEXT'); }
  if (!/Demo Retail/.test(String(r.session.free_text_request || ''))) {
    bad('C. the free text was not captured verbatim');
  } else { ok('C. the free text is captured verbatim into the session'); }
  eq(labels(r).join(' | '), 'Всё верно | Исправить', 'C. confirmation buttons');
  const ctx = JSON.parse(r.session.context_extracted_json || '{}');
  say('        rendered fields: ' + Object.keys(ctx).filter((k) => String(ctx[k] || '').trim() !== '').join(', '));
  say('        screen text    : ' + JSON.stringify(String(r.reply_text).slice(0, 120)));
  eq(r.session.context_confirmed, 'false', 'C. nothing is marked confirmed yet');
}
// D — partial text
{
  const r = run(sess({ state: 'TG_FREEFORM_PROBLEM' }), { text: 'Я собственник. Нужно навести порядок в управленческой отчётности и бюджетировании.' });
  if (r.debug.state_after === 'TG_CONFIRM_CONTEXT') {
    ok('D. partial text -> TG_CONFIRM_CONTEXT with only what was found');
    const ctx = JSON.parse(r.session.context_extracted_json || '{}');
    if (String(ctx.company_name || '') === '') { ok('D. no company was invented'); }
    else { bad('D. a company was invented: ' + ctx.company_name); }
  } else { bad('D. partial text went to ' + r.debug.state_after); }
}
// E — unstructured
{
  const r = run(sess({ state: 'TG_FREEFORM_PROBLEM' }), { text: 'Здравствуйте, хочу поговорить.' });
  const ctx = JSON.parse(r.session.context_extracted_json || '{}');
  const invented = ['company_name', 'role', 'objective', 'turnover_band'].filter((k) => String(ctx[k] || '').trim() !== '');
  if (!invented.length) { ok('E. unstructured text invented no facts (landed on ' + r.debug.state_after + ')'); }
  else { bad('E. invented: ' + invented.join(', ')); }
}
// F — empty message must NOT bounce to entry
{
  const r = run(sess({ state: 'TG_FREEFORM_PROBLEM' }), { text: '' });
  if (r.debug.state_after === 'TG_FREEFORM_PROBLEM') { ok('F. an empty message stays on the free-text screen'); }
  else if (r.debug.state_after === 'TG_ENTRY') { bad('F. an empty message bounced to TG_ENTRY — the defect pattern'); }
  else { bad('F. an empty message went to ' + r.debug.state_after); }
}
// H — user_confirmed only after «Всё верно»
{
  const seeded = sess({ state: 'TG_CONFIRM_CONTEXT', context_extracted_json: JSON.stringify({ company_name: 'Demo Retail', role: 'Собственник' }) });
  const before = run(seeded, { cb: 'p|noop' });
  eq(String(before.session.context_confirmed || 'false'), 'false', 'H. nothing confirmed before the tap');
  const after = run(seeded, { cb: 'p|ctx_ok' });
  if (eq(after.session.context_confirmed, 'true', 'H. confirmed after «Всё верно»')) {
    ok('H. context becomes user_confirmed ONLY after «Всё верно»');
  }
  eq(after.debug.state_after, 'TG_OPEN_BRIEF', 'H. «Всё верно» opens the brief');
}
// I — ai_inferred never smart-skips
{
  const D = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'draft-contract.js'));
  const f = { value: 'Demo Retail', source: 'ai_inferred', confirmed: false };
  if (D.canSkip(f, 'company_name') === false && D.canSkip(Object.assign({}, f, { confirmed: true }), 'company_name') === false) {
    ok('I. ai_inferred never smart-skips, even with a forged confirmed flag');
  } else { bad('I. an ai_inferred value would smart-skip'); }
}
say('');

// The node that actually failed: can it resolve the session now?
say('ISSUANCE GATE — the node that failed at 23:01');
{
  const code = issuance.parameters.jsCode;
  if (code.indexOf("$('Get Bot Session (Premium)').isExecuted") !== -1) {
    ok('Issuance Gate resolves the session from whichever node ran');
  } else { bad('Issuance Gate still hard-references the legacy session node'); }
  const others = live.nodes.filter((n) => ['Get Bot Session', 'Get Bot Session (Premium)'].indexOf(n.name) === -1 &&
    JSON.stringify(n.parameters).indexOf("$('Get Bot Session')") !== -1 &&
    JSON.stringify(n.parameters).indexOf('isExecuted') === -1);
  if (!others.length) { ok('no node hard-references the legacy session node any more'); }
  else { bad('still hard-referencing: ' + others.map((n) => n.name).join(', ')); }
  const save = live.nodes.find((n) => n.name === 'Build Session Row');
  if (JSON.stringify(save.parameters).indexOf('isExecuted') !== -1) {
    ok('Build Session Row resolves too — the premium state can now be persisted');
  } else { bad('Build Session Row still hard-references the legacy session node'); }
}

say('');
say(failures.length ? '  FREE-TEXT FLOW = FAIL' : '  FREE-TEXT FLOW = PASS');
if (failures.length) { say(''); for (const f of failures) { say('    - ' + f); } process.exitCode = 1; }
say('');
