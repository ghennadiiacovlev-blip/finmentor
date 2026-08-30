#!/usr/bin/env node
// FINMENTOR — prove the Lead Alerts presentation on the TENANT.
//
//   node scripts/verify-lead-alerts-live.mjs
//   node scripts/verify-lead-alerts-live.mjs --print     (also print every rendered message)
//
// READ-ONLY. Five GETs, no writes, no Telegram send.
//
// ── WHY THIS IS NOT THE SAME AS THE CANDIDATE GATE ─────────────────────────────────────────────
//
// qa/lead-alerts-candidates.test.mjs executes the candidates on disk. This pulls the Code node
// source back OUT of the five live workflows and executes THAT, so the messages below are produced
// by the bytes the tenant will actually run at 08:30. It also re-checks the owner's three
// corrections directly against the live output rather than trusting that the candidate that was
// gated is the candidate that landed.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const P = require(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'));

const PRINT = process.argv.includes('--print');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

let pass = 0;
const fail = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));

async function get(id) {
  const r = await fetch(BASE + '/api/v1/workflows/' + id, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { console.error('STOPPED: GET ' + id + ' -> ' + r.status); process.exit(1); }
  return r.json();
}
const codeOf = (wf, name) => String((wf.nodes.find((n) => n.name === name) || { parameters: {} }).parameters.jsCode || '');

// The Code-node environment, as n8n provides it.
function runNode(code, nodes, inputItems) {
  const handle = (items) => ({
    first: () => { if (!items.length) { throw new Error('first() on an empty node'); } return items[0]; },
    all: () => items, isExecuted: true
  });
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) { throw new Error("$('" + name + "') not provided"); }
    return handle(nodes[name].map((j) => ({ json: j })));
  };
  return new Function('$', '$input', code)($, handle((inputItems || []).map((j) => ({ json: j }))));
}

const SETTINGS = { settings: { owner_chat_id: '000', timezone: 'Europe/Chisinau', sla_hot_hours: 4,
  sla_warm_hours: 24, sla_repeat_hours: 6, followup_hot_hours: 24, followup_warm_hours: 72, follow_up_enabled: 'true' } };

const A = { lead_id: 'FIN-20260830-0412', company: 'Alfa Grup', name: 'Ион Русу', role: 'Финансовый директор',
  priority: 'HOT', lead_temperature: 'HOT', financial_zone: 'ORANGE', score_zone: 'ORANGE',
  deal_stage: 'Discovery Scheduled', next_action: 'Назначить Discovery Call',
  main_pain: 'Не видно реальной прибыли по направлениям', business_model: 'Retail',
  industry_category: 'Продукты питания', turnover_range: '5–10 млн EUR', employees_range: '50–100',
  created_at: '2026-08-29T06:00:00.000Z', next_follow_up_at: '2026-08-30T07:00:00.000Z', sla_status: '',
  email: 'ceo@alfa.md', phone: '+37369123456', telegram: '@alfaceo', utm_source: 'google',
  ai_plan_ready: 'N', tool: 'xray_extended', status: 'New', diagnostic_score: 62,
  page_url: 'https://finmentor.md/x',
  raw_json: JSON.stringify({ client: { company: 'Alfa Grup', preferred_contact: 'Telegram' } }) };
const B = Object.assign({}, A, { lead_id: 'FIN-20260826-0388', company: 'Vinaria Bostavan',
  name: 'Мария Чебан', role: 'Собственник', priority: 'WARM', lead_temperature: 'WARM',
  financial_zone: 'YELLOW', main_pain: 'Непонятно, где теряется маржа',
  next_action: 'Запросить управленческий P&L', next_follow_up_at: '2026-08-27T07:00:00.000Z',
  created_at: '2026-08-24T06:00:00.000Z', telegram: '', phone: '', email: 'maria@bostavan.md',
  raw_json: JSON.stringify({ client: { company: 'Vinaria Bostavan', preferred_contact: 'email' } }) });
const C = Object.assign({}, A, { lead_id: 'FIN-3', company: 'Nord Logistic', priority: 'WARM',
  lead_temperature: 'WARM', next_action: '', main_pain: 'Кассовые разрывы в конце месяца',
  next_follow_up_at: '', email: '', phone: '', telegram: '' });

const rendered = {};
const show = (t, h) => { rendered[t] = h; if (PRINT) { console.log('\n--- ' + t + ' ---\n' + h + '\n'); } };

console.log('');
console.log('Lead Alerts — LIVE verification (code pulled back from the tenant)');
console.log('='.repeat(78));

// ── render everything from the LIVE code ───────────────────────────────────────────────────────
const digest = await get('imeJIDeNyaWDyXzh');
const sla = await get('LZ2mvKXbBikmeVTn');
const followup = await get('zeLOCuf0K1bkaKl2');
const monitor = await get('RBiFLhVjizMkAzrK');
const intake = await get('QmIyEW2ZEqKregmN');
console.log('  five workflows read; all active: ' +
  [digest, sla, followup, monitor, intake].every((w) => w.active));
console.log('');

console.log('THE LIVE CODE RUNS');
try {
  const rows = [A, B, C, Object.assign({}, A, { lead_id: 'FIN-9', company: 'Closed Co', deal_stage: 'Won' })];
  show('OWNER DAILY BRIEF', runNode(codeOf(digest, 'Build Daily Digest'),
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': rows, 'Get AI Plans': [] }, rows)[0].json.alert_html);
  show('OWNER DAILY BRIEF (quiet)', runNode(codeOf(digest, 'Build Daily Digest'),
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [], 'Get AI Plans': [] }, [])[0].json.alert_html);
  ok('Build Daily Digest');

  show('PRIORITY', runNode(codeOf(sla, 'SLA Select'), { 'Settings to Object': [SETTINGS] }, [A])[0].json.alert_html);
  ok('SLA Select');

  const fu = [{ followup_id: 'FU-1', lead_id: 'FIN-20260826-0388', status: 'Planned',
    due_at: '2026-08-28T07:00:00.000Z', type: 'Proposal follow-up', priority: 'WARM' }];
  const fuOut = runNode(codeOf(followup, 'Build Followup Plan'),
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [B], 'Get Followups': fu }, []);
  show('FOLLOW-UP', fuOut.filter((i) => i.json.item_type === 'due_alert')[0].json.alert_html);
  ok('Build Followup Plan');

  const t = { execution: { id: '4239', error: { name: 'ExpressionError',
    message: "Node 'Build Bot Response' hasn't been executed" }, lastNodeExecuted: 'Build Transport Request' },
    workflow: { id: 'mppzthlkSJFr6Kle', name: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED' } };
  show('SYSTEM ALERT', runNode(codeOf(monitor, 'Build Error Alert'),
    { 'Error Monitor Trigger': [t], 'Settings to Object': [SETTINGS] }, [t])[0].json.alert_html);
  ok('Build Error Alert');

  show('NEW LEAD', runNode(codeOf(intake, 'Build Premium Telegram Brief'), {}, [A])[0].json.alert_html);
  show('NEW LEAD (WARM)', runNode(codeOf(intake, 'Build Warm Telegram Alert'), {}, [B])[0].json.alert_html);
  show('LEAD INCOMPLETE', runNode(codeOf(intake, 'Build Incomplete Telegram Alert'), {},
    [{ lead_id: 'FIN-20260830-0414', company: '', name: '', priority_reason: 'Нет согласия на обработку',
      tool: 'contact_form' }])[0].json.alert_html);
  ok('the three Lead Intake builders');
} catch (e) {
  bad('a LIVE builder threw: ' + e.message);
}
console.log('');

// ── every message is sendable ──────────────────────────────────────────────────────────────────
console.log('EVERY MESSAGE IS VALID TELEGRAM HTML');
for (const [name, html] of Object.entries(rendered)) {
  const v = P.validate(html);
  want(!v.length, name + ' (' + html.length + ' chars)' + (v.length ? ' -> ' + v.join('; ') : ''));
}
console.log('');

// ── owner correction 1 ─────────────────────────────────────────────────────────────────────────
console.log('OWNER CORRECTION 1 — one preferred contact channel, NEW LEAD only');
want(rendered['NEW LEAD'].indexOf('<b>Telegram · @alfaceo</b>') !== -1,
  'NEW LEAD shows the stated preferred channel and its value');
want(rendered['NEW LEAD'].indexOf('+37369123456') === -1 && rendered['NEW LEAD'].indexOf('ceo@alfa.md') === -1,
  'NEW LEAD shows no second contact');
want(rendered['NEW LEAD (WARM)'].indexOf('<b>Email · maria@bostavan.md</b>') !== -1,
  'the WARM alert honours a stated email preference');
for (const n of ['OWNER DAILY BRIEF', 'OWNER DAILY BRIEF (quiet)', 'PRIORITY', 'FOLLOW-UP', 'SYSTEM ALERT', 'LEAD INCOMPLETE']) {
  want(rendered[n].indexOf('Связь') === -1 &&
       !/@alfaceo|\+37369123456|ceo@alfa\.md|maria@bostavan\.md/.test(rendered[n]),
    n + ' carries no contact');
}
console.log('');

// ── owner correction 2 ─────────────────────────────────────────────────────────────────────────
console.log('OWNER CORRECTION 2 — no AI implementation vocabulary');
for (const n of ['OWNER DAILY BRIEF', 'OWNER DAILY BRIEF (quiet)']) {
  want(!/AI[- ]?плана|AI ready|AI missing|AI plan|X-Ray|ai_plan_ready|Рентген-план/i.test(rendered[n]),
    n + ' reports business state, not subsystem state');
}
want(codeOf(digest, 'Build Daily Digest').indexOf('const aiMissing') !== -1,
  'the aiMissing counter is still COMPUTED — the selection code was not touched');
want(rendered['OWNER DAILY BRIEF'].split('\n').filter((l) => /без следующего шага/.test(l)).length <= 1,
  'the open-decision line is not duplicated by an equivalent metric');
console.log('');

// ── owner correction 3 ─────────────────────────────────────────────────────────────────────────
console.log('OWNER CORRECTION 3 — LEAD INCOMPLETE states no legal conclusion');
const inc = rendered['LEAD INCOMPLETE'];
want(inc.indexOf('Недостаточно данных для полноценной обработки обращения.') !== -1, 'the pinned operational reason');
want(inc.indexOf('Проверить данные обращения вручную.') !== -1, 'the pinned next step');
want(inc.indexOf('контакт для связи') !== -1, 'the missing contact is one item, not three');
want(!/согласи|consent|Форма отправлена/i.test(inc), 'no consent or legal wording reaches the owner');
console.log('');

// ── the invariants that must have survived ─────────────────────────────────────────────────────
console.log('LOGIC UNCHANGED');
const slaOut = runNode(codeOf(sla, 'SLA Select'), { 'Settings to Object': [SETTINGS] }, [
  A,
  Object.assign({}, A, { lead_id: 'X1', priority: 'COLD' }),
  Object.assign({}, A, { lead_id: 'X2', deal_stage: 'Won' }),
  Object.assign({}, A, { lead_id: 'X3', sla_status: 'Done' }),
  Object.assign({}, A, { lead_id: 'X4', sla_status: 'snoozed', sla_snooze_until: '2099-01-01T00:00:00.000Z' })
]);
want(slaOut.length === 1 && slaOut[0].json.lead_id === A.lead_id,
  'the SLA selection still emits exactly the one HOT overdue lead out of five');
want(!!slaOut[0].json.sla_alert_at, 'sla_alert_at survives — the anti-spam window still works');
for (const [wf, node, label] of [[sla, 'Telegram SLA Alert', 'SLA'], [followup, 'Telegram Followup Reminder', 'follow-up']]) {
  const kb = JSON.stringify((wf.nodes.find((n) => n.name === node) || {}).parameters.inlineKeyboard || {});
  want(/done\|/.test(kb) && /snooze\|/.test(kb) && /nurture\|/.test(kb),
    'the ' + label + ' buttons still carry their callback_data');
}
const fuAll = runNode(codeOf(followup, 'Build Followup Plan'),
  { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [B], 'Get Followups': [] }, []);
const created = fuAll.filter((i) => i.json.item_type === 'new_followup');
want(created.every((i) => String(i.json.message_template || '').indexOf('Follow-up needed') === 0),
  'the Followups SHEET template is still written as plain text, unchanged');
for (const [wf, label, nodes] of [[digest, 'Daily Digest', ['Telegram Daily Digest']],
  [sla, 'SLA', ['Telegram SLA Alert']], [followup, 'Followup', ['Telegram Followup Reminder']],
  [monitor, 'Error Monitor', ['Telegram Error Alert']],
  [intake, 'Lead Intake', ['Telegram Lead Alert', 'Telegram Warm Alert', 'Telegram Incomplete Alert']]]) {
  for (const n of nodes) {
    const t = wf.nodes.find((x) => x.name === n);
    want((t.parameters.additionalFields || {}).parse_mode === 'HTML' &&
         t.parameters.text === '={{ $json.alert_html }}', label + '/' + n + ' sends HTML from alert_html');
  }
}
want(codeOf(intake, 'Build Short AI Telegram').indexOf('FINMENTOR AI BRIEF') !== -1,
  'the AI work-plan builder is untouched — reported, not redesigned');
console.log('');

console.log('='.repeat(78));
if (fail.length) {
  console.log('FAILURES (' + fail.length + '):');
  fail.forEach((f) => console.log('  - ' + f));
  console.log('CHECKS: ' + pass + ' passed, ' + fail.length + ' failed');
  process.exitCode = 1;
} else {
  console.log('CHECKS: ' + pass + ' passed. The tenant renders the approved owner copy.');
}
console.log('');
