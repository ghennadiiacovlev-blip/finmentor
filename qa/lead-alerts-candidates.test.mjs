#!/usr/bin/env node
// FINMENTOR — Lead Alerts presentation candidates, EXECUTED.
//
//   node qa/lead-alerts-candidates.test.mjs
//
// Offline. No tenant, no network, no credentials. It reads the live snapshots under n8n/history/
// and the candidates under n8n/candidate/, and it RUNS the rewritten Code nodes against synthetic
// input with `$` and `$input` stubbed the way n8n provides them.
//
// ── WHY EXECUTING THEM IS THE ONLY HONEST GATE ─────────────────────────────────────────────────
//
// A candidate that reads correctly and throws at runtime is worse than no candidate: it fails on
// the owner's first real alert, at 08:30, with the message lost. The presenter is inlined into
// these nodes as a text transform, the surviving prefix declares locals the new tail depends on,
// and nothing but running the result proves those two halves fit together. This gate has already
// earned itself once — see the `TZ` collision note in the builder.
//
// ── AND WHY «LOGIC CHANGED = NO» IS RE-DERIVED HERE ────────────────────────────────────────────
//
// The builder asserts it while making the change. That is the one place the assertion is worth
// least. This file recomputes it from the two artifacts afterwards: the preserved prefix of every
// rewritten node must be a byte-exact prefix of the live code, every other node must be identical,
// and the connection graph must not have moved an edge.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const P = require(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const load = (dir, f) => JSON.parse(readFileSync(join(ROOT, 'n8n', dir, f), 'utf8'));

const PAIRS = [
  ['Daily Lead Digest', 'imeJIDeNyaWDyXzh.pre-lead-alerts-presentation.json', 'lead-alerts-daily-digest-candidate.json',
    ['Build Daily Digest'], ['Telegram Daily Digest']],
  ['SLA Lead Watch', 'LZ2mvKXbBikmeVTn.pre-lead-alerts-presentation.json', 'lead-alerts-sla-watch-candidate.json',
    ['SLA Select'], ['Telegram SLA Alert']],
  ['Followup Sequence', 'zeLOCuf0K1bkaKl2.pre-lead-alerts-presentation.json', 'lead-alerts-followup-candidate.json',
    ['Build Followup Plan'], ['Telegram Followup Reminder']],
  ['Error Monitor', 'RBiFLhVjizMkAzrK.pre-lead-alerts-presentation.json', 'lead-alerts-error-monitor-candidate.json',
    ['Build Error Alert'], ['Telegram Error Alert']],
  ['Lead Intake', 'QmIyEW2ZEqKregmN.pre-lead-alerts-presentation.json', 'lead-alerts-lead-intake-candidate.json',
    ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert'],
    ['Telegram Lead Alert', 'Telegram Warm Alert', 'Telegram Incomplete Alert']]
];

const codeOf = (wf, name) => String((wf.nodes.find((n) => n.name === name) || { parameters: {} }).parameters.jsCode || '');

// ── the Code-node environment, as n8n provides it ──────────────────────────────────────────────
//
// `$('Node')` returns a handle with .first()/.all(); `$input` is the incoming items. Anything the
// node reaches for that the harness did not supply throws, which is exactly what we want to find.
function runNode(code, nodes, inputItems) {
  const handle = (items) => ({
    first: () => { if (!items.length) { throw new Error('first() on an empty node'); } return items[0]; },
    all: () => items,
    isExecuted: true
  });
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) { throw new Error("$('" + name + "') was not provided to the harness"); }
    return handle(nodes[name].map((j) => ({ json: j })));
  };
  const $input = handle((inputItems || []).map((j) => ({ json: j })));
  // eslint-disable-next-line no-new-func
  return new Function('$', '$input', 'require', code)($, $input, () => { throw new Error('require() in a Code node'); });
}

const SETTINGS = { settings: { owner_chat_id: '000', timezone: 'Europe/Chisinau', sla_hot_hours: 4, sla_warm_hours: 24, sla_repeat_hours: 6, followup_hot_hours: 24, followup_warm_hours: 72, follow_up_enabled: 'true' } };

const PIPE_ROW = {
  lead_id: 'FIN-20260830-0412', company: 'Alfa Grup', name: 'Ион Русу', role: 'Финансовый директор',
  priority: 'HOT', financial_zone: 'ORANGE', deal_stage: 'New', next_action: 'Назначить Discovery Call',
  main_pain: 'Не видно реальной прибыли по направлениям', business_model: 'Retail',
  industry_category: 'Продукты питания', created_at: '2026-08-20T06:00:00.000Z',
  next_follow_up_at: '2026-08-27T06:00:00.000Z', sla_status: '', email: 'ceo@alfa.md',
  phone: '+37369123456', telegram: '@alfaceo', utm_source: 'google', ai_plan_ready: 'N'
};

console.log('Lead Alerts — presentation candidates, executed');
console.log('');

// ── 1. the change is exactly what was declared ─────────────────────────────────────────────────

check('every candidate is +0 / -0 nodes, with an unmoved connection graph', () => {
  for (const [label, before, after] of PAIRS) {
    const a = load('history', before);
    const b = load('candidate', after);
    eq(b.nodes.length, a.nodes.length, label + ': node count');
    eq(b.name, a.name, label + ': workflow name');
    eq(JSON.stringify(b.connections), JSON.stringify(a.connections), label + ': connection graph');
    for (const n of a.nodes) { assert(b.nodes.find((x) => x.name === n.name), label + ': ' + n.name + ' was removed'); }
  }
});

check('only the declared builder and Telegram nodes differ — everything else is byte-identical', () => {
  for (const [label, before, after, builders, tgs] of PAIRS) {
    const a = load('history', before);
    const b = load('candidate', after);
    const allowed = builders.concat(tgs);
    for (const n of b.nodes) {
      const was = a.nodes.find((x) => x.name === n.name);
      const same = JSON.stringify(n) === JSON.stringify(was);
      if (allowed.indexOf(n.name) === -1) { assert(same, label + ': ' + n.name + ' changed but was not declared'); }
      else { assert(!same, label + ': ' + n.name + ' was declared as changed but is identical'); }
    }
  }
});

check('the surviving prefix of every rewritten node is a BYTE-EXACT prefix of the live code', () => {
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8');
  const body = src.slice(0, src.lastIndexOf('module.exports = '));
  for (const [label, before, after, builders] of PAIRS) {
    const a = load('history', before);
    const b = load('candidate', after);
    for (const name of builders) {
      const live = codeOf(a, name);
      const next = codeOf(b, name);
      // The candidate is <inlined tz> + <inlined presenter> + <live prefix> + <new tail>. Find the
      // presenter's own body, then the IIFE close that follows it — the presenter contains other
      // `})();` sequences of its own, so searching from the marker alone lands in the wrong place.
      const bodyAt = next.indexOf(body);
      assert(bodyAt !== -1, label + '/' + name + ': the inlined presenter block is missing');
      const end = next.indexOf('})();', bodyAt + body.length);
      assert(end !== -1, label + '/' + name + ': the inlined presenter IIFE is not closed');
      const afterInline = next.slice(end + '})();'.length).replace(/^\n+/, '');
      // Find how much of the live code survived, and require it to be a genuine prefix.
      let kept = 0;
      while (kept < live.length && afterInline[kept] === live[kept]) { kept++; }
      assert(kept > 200, label + '/' + name + ': only ' + kept + ' bytes of the live code survived — the selection logic was rewritten');
      eq(afterInline.slice(0, kept), live.slice(0, kept), label + '/' + name + ': the surviving prefix is not byte-exact');
      // And require that what was dropped is only the message construction, never a filter.
      const dropped = live.slice(kept);
      for (const word of ['filter(', 'STOP_STAGES', 'hoursSince', 'sla_repeat_hours', 'isClosed', 'isOverdue', 'classify(', 'scrubMessage']) {
        assert(dropped.indexOf(word) === -1, label + '/' + name + ': the dropped tail contains selection logic — ' + word);
      }
    }
  }
});

check('triggers, schedules, credentials and filters are untouched', () => {
  for (const [label, before, after] of PAIRS) {
    const a = load('history', before);
    const b = load('candidate', after);
    for (const n of a.nodes) {
      const isLogic = /scheduleTrigger|errorTrigger|webhook|executeWorkflowTrigger|googleSheets|dataTable|if$|switch$|postgres|openAi/i.test(n.type);
      if (!isLogic) { continue; }
      const m = b.nodes.find((x) => x.name === n.name);
      eq(JSON.stringify(m), JSON.stringify(n), label + ': ' + n.name + ' (' + n.type + ') changed');
    }
    eq(JSON.stringify(b.settings || {}), JSON.stringify(a.settings || {}), label + ': workflow settings changed');
  }
});

// ── 2. the inlined copy cannot drift from the tested module ────────────────────────────────────

check('the presenter inlined into every node is byte-identical to the module the gate drives', () => {
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8');
  const body = src.slice(0, src.lastIndexOf('module.exports = '));
  const tzSrc = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'tz.js'), 'utf8');
  const tzBody = tzSrc.slice(0, tzSrc.lastIndexOf('module.exports = '));
  let seen = 0;
  for (const [label, , after, builders] of PAIRS) {
    const b = load('candidate', after);
    for (const name of builders) {
      const code = codeOf(b, name);
      assert(code.indexOf(body) !== -1, label + '/' + name + ': the inlined presenter differs from the module');
      assert(code.indexOf(tzBody) !== -1, label + '/' + name + ': the inlined tz helper differs from the module');
      assert(code.indexOf('DO NOT EDIT HERE') !== -1, label + '/' + name + ': the inline warning was removed');
      seen++;
    }
  }
  eq(seen, 7, 'rewritten builder nodes');
});

// ── 3. THEY RUN ────────────────────────────────────────────────────────────────────────────────

check('Build Daily Digest runs, and renders a brief the validator accepts', () => {
  const wf = load('candidate', 'lead-alerts-daily-digest-candidate.json');
  const rows = [PIPE_ROW,
    Object.assign({}, PIPE_ROW, { lead_id: 'FIN-2', company: 'Nord Logistic', priority: 'WARM', next_action: '' }),
    Object.assign({}, PIPE_ROW, { lead_id: 'FIN-3', company: 'Closed Co', deal_stage: 'Won' })];
  const out = runNode(codeOf(wf, 'Build Daily Digest'),
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': rows, 'Get AI Plans': [] }, rows);
  eq(out.length, 1, 'items returned');
  const html = out[0].json.alert_html;
  assert(html, 'no alert_html was produced');
  const v = P.validate(html);
  assert(!v.length, 'the rendered brief is invalid -> ' + v.join('; '));
  assert(html.indexOf('OWNER DAILY BRIEF') !== -1, 'the header is missing');
  assert(html.indexOf('Alfa Grup') !== -1, 'the top lead is missing');
  assert(html.indexOf('Closed Co') === -1, 'a closed lead reached the brief — the filter was not preserved');
  assert(html.indexOf('Высокий приоритет') !== -1, 'the priority vocabulary is missing');
  assert(html.indexOf('без следующего шага') !== -1, 'the open-decision line is missing');
  // OWNER DECISION, 2026-08-30: no AI subsystem vocabulary in a business channel.
  ['AI-плана', 'AI ready', 'AI missing', 'AI plan', 'X-Ray', 'ai_plan_ready']
    .forEach((t) => assert(html.indexOf(t) === -1, 'the brief reports subsystem state — «' + t + '»'));
  // ...and the counter it came from is still computed, because the selection code is untouched.
  assert(codeOf(wf, 'Build Daily Digest').indexOf('const aiMissing') !== -1,
    'aiMissing was deleted from the selection code — that is a logic change, not a presentation one');
  assert(out[0].json.stats && typeof out[0].json.stats.active === 'number', '`stats` no longer feeds the activity log');
  // B14 / B11, measured on the real output.
  ['ceo@alfa.md', '+37369123456', '@alfaceo', 'utm', 'google', 'FIN-2026']
    .forEach((t) => assert(html.indexOf(t) === -1, 'the brief leaked «' + t + '»'));
});

check('Build Daily Digest on an empty pipeline produces a short, valid brief and no wall of zeroes', () => {
  const wf = load('candidate', 'lead-alerts-daily-digest-candidate.json');
  const out = runNode(codeOf(wf, 'Build Daily Digest'),
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [], 'Get AI Plans': [] }, []);
  const html = out[0].json.alert_html;
  assert(!P.validate(html).length, 'the empty brief is invalid -> ' + P.validate(html).join('; '));
  assert(html.indexOf('Критичных действий нет.') !== -1, 'a quiet day is not stated as a result');
  eq(html.split('\n').filter((l) => /:\s*0\s*$/.test(l)).length, 1, 'zero-valued lines');
});

check('SLA Select runs, selects exactly what it selected before, and renders a PRIORITY card', () => {
  const wf = load('candidate', 'lead-alerts-sla-watch-candidate.json');
  const rows = [
    PIPE_ROW,                                                            // HOT, follow-up overdue -> selected
    Object.assign({}, PIPE_ROW, { lead_id: 'C', priority: 'COLD' }),     // COLD -> skipped
    Object.assign({}, PIPE_ROW, { lead_id: 'W', deal_stage: 'Won' }),    // stop-stage -> skipped
    Object.assign({}, PIPE_ROW, { lead_id: 'D', sla_status: 'Done' }),   // done -> skipped
    Object.assign({}, PIPE_ROW, { lead_id: 'S', sla_status: 'snoozed', sla_snooze_until: '2099-01-01T00:00:00.000Z' })
  ];
  const out = runNode(codeOf(wf, 'SLA Select'), { 'Settings to Object': [SETTINGS] }, rows);
  eq(out.length, 1, 'the selection changed — only the HOT overdue lead may be emitted');
  const html = out[0].json.alert_html;
  assert(!P.validate(html).length, 'invalid -> ' + P.validate(html).join('; '));
  assert(html.indexOf('FINMENTOR · PRIORITY') !== -1, 'the header is wrong');
  assert(html.indexOf('Alfa Grup') !== -1, 'the company is missing');
  assert(html.indexOf('просрочено') !== -1, 'the deadline is not stated as a decision');
  assert(html.indexOf('Запланированный контакт просрочен.') !== -1, 'the reason is missing');
  eq(out[0].json.lead_id, 'FIN-20260830-0412', 'the callback lead_id is gone — the buttons would break');
  assert(out[0].json.sla_alert_at, 'sla_alert_at is gone — the anti-spam window would break');
  // The contact concatenation is still computed upstream but must not reach the owner.
  ['ceo@alfa.md', '+37369123456', '@alfaceo'].forEach((t) => assert(html.indexOf(t) === -1, 'leaked «' + t + '»'));
});

check('Build Followup Plan runs, still emits both item types, and renders a FOLLOW-UP card', () => {
  const wf = load('candidate', 'lead-alerts-followup-candidate.json');
  const fu = [{ followup_id: 'FU-1', lead_id: 'FIN-20260830-0412', status: 'Planned',
    due_at: '2026-08-20T06:00:00.000Z', type: 'HOT follow-up', priority: 'HOT' }];
  const out = runNode(codeOf(wf, 'Build Followup Plan'),
    { 'Settings to Object': [SETTINGS], 'Get Pipeline Rows': [PIPE_ROW], 'Get Followups': fu }, []);
  const due = out.filter((i) => i.json.item_type === 'due_alert');
  eq(due.length, 1, 'the due-alert selection changed');
  const html = due[0].json.alert_html;
  assert(!P.validate(html).length, 'invalid -> ' + P.validate(html).join('; '));
  assert(html.indexOf('FINMENTOR · FOLLOW-UP') !== -1, 'the header is wrong');
  assert(html.indexOf('Просрочено: <b>1</b>') !== -1, 'the overdue count is missing');
  eq(due[0].json.followup_id, 'FU-1', 'followup_id is gone — Mark Followups Sent would break');
  // Section A still writes the sheet template, untouched.
  const created = out.filter((i) => i.json.item_type === 'new_followup');
  created.forEach((i) => {
    assert(typeof i.json.message_template === 'string' && i.json.message_template.indexOf('Follow-up needed') === 0,
      'the stored message_template was rewritten — that is sheet DATA, not an owner message');
    assert(i.json.message_template.indexOf('<b>') === -1, 'HTML leaked into the stored template');
  });
});

check('Build Error Alert runs on the REAL failure payload and states only what it can prove', () => {
  const wf = load('candidate', 'lead-alerts-error-monitor-candidate.json');
  // Verbatim shape of execution 4240, which alerted on failure 4239.
  const trigger = { execution: { id: '4239', url: 'https://tenant/workflow/x/executions/4239',
    error: { name: 'ExpressionError', message: "Node 'Build Bot Response' hasn't been executed",
      stack: "ExpressionError: boom\n    at throwExecutionError (/usr/local/lib/node_modules/n8n/x.ts:11:9)" },
    lastNodeExecuted: 'Build Transport Request' },
    workflow: { id: 'mppzthlkSJFr6Kle', name: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED' } };
  const out = runNode(codeOf(wf, 'Build Error Alert'),
    { 'Error Monitor Trigger': [trigger], 'Settings to Object': [SETTINGS] }, [trigger]);
  const html = out[0].json.alert_html;
  assert(!P.validate(html).length, 'invalid -> ' + P.validate(html).join('; '));
  assert(html.indexOf('Ответ клиенту в Telegram не был отправлен.') !== -1, 'the business consequence is missing');
  assert(html.indexOf('Build Transport Request') !== -1, 'the failing node is missing');
  assert(html.indexOf('<code>4239</code>') !== -1, 'the execution id is missing');
  assert(html.indexOf('Требует проверки') !== -1, 'the status is missing');
  // The three sentences B8 asked for and the payload cannot support.
  ['Обращение не создано', 'Pipeline не изменён', 'Privacy-запись не создана']
    .forEach((f) => assert(html.indexOf(f) === -1, 'the alert claims «' + f + '» with no evidence'));
  assert(html.indexOf('автоматически не проверены') !== -1, 'the alert hides the gap instead of stating it');
  // The scrubber and the never-read stack, both preserved.
  assert(html.indexOf('node_modules') === -1 && html.indexOf('    at ') === -1, 'a stack trace reached the owner');
  assert(out[0].json.owner_chat_id === '000', 'the chat id is no longer emitted — the alert would not be routed');
  assert(out[0].json.correlation_id === '4239', 'correlation_id is gone');
});

check('the Error Monitor still scrubs contact data out of an error message', () => {
  const wf = load('candidate', 'lead-alerts-error-monitor-candidate.json');
  const trigger = { execution: { id: '9', error: { name: 'Error',
    message: 'failed for ceo@alfa.md at +373 69 123 456 see https://tenant/x' }, lastNodeExecuted: 'X' },
    workflow: { id: 'w', name: 'FINMENTOR Lead Intake PREMIUM FINAL' } };
  const out = runNode(codeOf(wf, 'Build Error Alert'),
    { 'Error Monitor Trigger': [trigger], 'Settings to Object': [SETTINGS] }, [trigger]);
  const html = out[0].json.alert_html;
  ['ceo@alfa.md', '+373 69 123 456', 'https://tenant/x']
    .forEach((t) => assert(html.indexOf(t) === -1, 'the scrubber stopped removing «' + t + '»'));
  assert(html.indexOf('Приём заявки прерван.') !== -1, 'the impact line is wrong for Lead Intake');
});

check('the three Lead Intake builders run and render their types', () => {
  const wf = load('candidate', 'lead-alerts-lead-intake-candidate.json');
  const item = Object.assign({}, PIPE_ROW, {
    lead_temperature: 'HOT', status: 'New', tool: 'xray_extended', page_url: 'https://finmentor.md/x',
    turnover_range: '5–10 млн EUR', employees_range: '50–100', diagnostic_score: 62, score_zone: 'ORANGE',
    raw_json: JSON.stringify({ client: { company: 'Alfa Grup', phone: '+37369123456', email: 'ceo@alfa.md',
      preferred_contact: 'Telegram' }, intake: {}, diagnostic: {} })
  });

  const brief = runNode(codeOf(wf, 'Build Premium Telegram Brief'), {}, [item])[0].json.alert_html;
  assert(!P.validate(brief).length, 'NEW LEAD invalid -> ' + P.validate(brief).join('; '));
  assert(brief.indexOf('FINMENTOR · NEW LEAD') !== -1, 'the NEW LEAD header is missing');
  assert(brief.indexOf('Alfa Grup') !== -1, 'the company is missing');
  assert(brief.indexOf('Высокий приоритет') !== -1, 'the priority label is missing');
  assert(brief.indexOf('Повышенный риск') !== -1, 'the financial zone is missing');
  assert(brief.length < 900, 'the NEW LEAD alert is ' + brief.length + ' characters — it is a dump again');
  // The source must survive the workflow's own sourceLabel() and the renderer's. The fixture
  // carries tool: 'xray_extended'; anything else means a translation ate the real source.
  assert(brief.indexOf('Источник: Финансовый рентген — расширенная анкета') !== -1,
    'the NEW LEAD source was lost to a double translation');
  // OWNER DECISION, 2026-08-30: ONE channel with its value. The fixture states Telegram as the
  // preferred contact, so the handle appears and the phone and email do not.
  assert(brief.indexOf('Связь') !== -1, 'the NEW LEAD alert carries no contact block');
  assert(brief.indexOf('<b>Telegram · @alfaceo</b>') !== -1, 'the preferred channel and its value are missing');
  ['ceo@alfa.md', '+37369123456', 'raw_json', 'https://finmentor.md/x', '🚨']
    .forEach((t) => assert(brief.indexOf(t) === -1, 'NEW LEAD leaked «' + t + '»'));

  // Preference honoured, not overridden by whatever else the row happens to hold.
  const byPhone = runNode(codeOf(wf, 'Build Premium Telegram Brief'), {}, [Object.assign({}, item, {
    raw_json: JSON.stringify({ client: { company: 'Alfa Grup', preferred_contact: 'phone' } })
  })])[0].json.alert_html;
  assert(byPhone.indexOf('<b>Телефон · +37369123456</b>') !== -1, 'a stated phone preference was not honoured');
  assert(byPhone.indexOf('ceo@alfa.md') === -1 && byPhone.indexOf('@alfaceo') === -1, 'the other channels leaked');

  // A preference with nothing behind it must not promise a route the record lacks.
  const noValue = runNode(codeOf(wf, 'Build Premium Telegram Brief'), {}, [Object.assign({}, item, {
    phone: '', telegram: '', email: '',
    raw_json: JSON.stringify({ client: { company: 'Alfa Grup', preferred_contact: 'phone' } })
  })])[0].json.alert_html;
  assert(noValue.indexOf('<b>Не указана</b>') !== -1, 'a preference with no value did not degrade');

  const warm = runNode(codeOf(wf, 'Build Warm Telegram Alert'), {},
    [Object.assign({}, item, { lead_temperature: 'WARM' })])[0].json.alert_html;
  assert(!P.validate(warm).length, 'WARM invalid -> ' + P.validate(warm).join('; '));
  assert(warm.indexOf('Требует внимания') !== -1, 'the WARM label is missing');
  assert(warm.indexOf('🟡') === -1, 'the emoji survived');
  assert(warm.indexOf('Связь') !== -1, 'the WARM alert carries no contact block');
  assert((warm.match(/@alfaceo|\+37369123456|ceo@alfa\.md/g) || []).length === 1,
    'the WARM alert shows more than one contact, or none at all');

  const inc = runNode(codeOf(wf, 'Build Incomplete Telegram Alert'), {},
    [{ lead_id: 'FIN-X', company: '', name: '', priority_reason: 'Форма без контакта.', tool: 'contact_form' }])[0].json.alert_html;
  assert(!P.validate(inc).length, 'INCOMPLETE invalid -> ' + P.validate(inc).join('; '));
  assert(inc.indexOf('FINMENTOR · LEAD INCOMPLETE') !== -1, 'the INCOMPLETE header is missing');
  assert(inc.indexOf('контакт для связи') !== -1, 'the missing contact is not named');
  assert(inc.indexOf('название компании') !== -1 && inc.indexOf('контактное лицо') !== -1, 'the missing fields are not named');
  assert(inc.indexOf('Недостаточно данных для полноценной обработки обращения.') !== -1, 'the pinned reason is missing');
  assert(inc.indexOf('⚠️') === -1, 'the emoji survived');
  assert(inc.indexOf('Связь') === -1, 'the incomplete alert emitted a contact block');
  // The raw reason stays in the item for the internal record, and out of the message.
  const incItem = runNode(codeOf(wf, 'Build Incomplete Telegram Alert'), {},
    [{ lead_id: 'FIN-X', priority_reason: 'Нет согласия на обработку', tool: 'contact_form' }])[0].json;
  eq(incItem.priority_reason, 'Нет согласия на обработку', 'the internal reason was dropped from the item');
  assert(incItem.alert_html.indexOf('согласи') === -1, 'a legal conclusion reached the owner message');
});

check('a hostile lead cannot break a candidate at runtime — the 400 that would lose the alert', () => {
  const wf = load('candidate', 'lead-alerts-lead-intake-candidate.json');
  const nasty = 'Alfa <Grup> & Co </b><script>x</script>';
  const item = Object.assign({}, PIPE_ROW, { company: nasty, main_pain: nasty, next_action: nasty,
    lead_temperature: 'HOT', raw_json: '{"client":{"company":"' + '\\u003cscript\\u003e' + '"}}' });
  for (const node of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert']) {
    const html = runNode(codeOf(wf, node), {}, [item])[0].json.alert_html;
    const v = P.validate(html);
    assert(!v.length, node + ' produced an unsendable message -> ' + v.join('; '));
    assert(html.indexOf('&lt;Grup&gt;') !== -1, node + ' did not escape the company name');
  }
  // And a completely empty row must not throw, or one bad sheet line silences the channel.
  for (const node of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert']) {
    const html = runNode(codeOf(wf, node), {}, [{}])[0].json.alert_html;
    assert(!P.validate(html).length, node + ' on an empty row -> ' + P.validate(html).join('; '));
  }
});

// ── 4. the Telegram nodes ──────────────────────────────────────────────────────────────────────

check('every rewritten Telegram node parses HTML and reads the new field', () => {
  for (const [label, , after, , tgs] of PAIRS) {
    const b = load('candidate', after);
    for (const name of tgs) {
      const n = b.nodes.find((x) => x.name === name);
      assert(n, label + ': ' + name + ' is missing');
      eq(n.parameters.additionalFields.parse_mode, 'HTML', label + '/' + name + ': parse mode');
      eq(n.parameters.additionalFields.appendAttribution, false, label + '/' + name + ': attribution');
      eq(n.parameters.text, '={{ $json.alert_html }}', label + '/' + name + ': text expression');
      // The old sanitiser stripped < and >, which would have destroyed every tag.
      assert(String(n.parameters.text).indexOf('replace(/[<>]/g') === -1,
        label + '/' + name + ': the plain-text sanitiser survived and would strip the HTML');
    }
  }
});

check('the callback buttons on the two actionable alerts are untouched', () => {
  for (const [label, before, after, , tgs] of PAIRS) {
    const a = load('history', before);
    const b = load('candidate', after);
    for (const name of tgs) {
      const was = a.nodes.find((x) => x.name === name);
      const now = b.nodes.find((x) => x.name === name);
      eq(JSON.stringify(now.parameters.inlineKeyboard || null), JSON.stringify(was.parameters.inlineKeyboard || null),
        label + '/' + name + ': the inline keyboard changed — the owner\'s Done/Snooze buttons are the workflow');
      eq(JSON.stringify(now.parameters.chatId), JSON.stringify(was.parameters.chatId), label + '/' + name + ': chatId changed');
      eq(JSON.stringify(now.credentials || null), JSON.stringify(was.credentials || null), label + '/' + name + ': credentials changed');
    }
  }
});

// ── 5. what was deliberately not touched ───────────────────────────────────────────────────────

check('Build Short AI Telegram is untouched — it is reported, not redesigned', () => {
  const a = load('history', 'QmIyEW2ZEqKregmN.pre-lead-alerts-presentation.json');
  const b = load('candidate', 'lead-alerts-lead-intake-candidate.json');
  const was = a.nodes.find((n) => n.name === 'Build Short AI Telegram');
  const now = b.nodes.find((n) => n.name === 'Build Short AI Telegram');
  eq(JSON.stringify(now), JSON.stringify(was), 'the AI work-plan builder was modified');
  const tgWas = a.nodes.find((n) => n.name === 'Telegram AI Work Plan');
  const tgNow = b.nodes.find((n) => n.name === 'Telegram AI Work Plan');
  eq(JSON.stringify(tgNow), JSON.stringify(tgWas), 'the AI work-plan Telegram node was modified');
});

check('no candidate INTRODUCES a secret, an owner id or a tenant URL', () => {
  // Relative to the snapshot, deliberately. The live Settings node already compiles the owner chat
  // id as a fallback default — that is pre-existing and out of scope for a presentation pass. What
  // must be impossible is this pass ADDING one.
  const patterns = [
    [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, 'a bot token'],
    [/\b\d{9,}\b/g, 'a bare numeric id'],
    [/https:\/\/[a-z0-9-]+\.app\.n8n\.cloud[^"'\s]*/g, 'a tenant URL'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'an email address']
  ];
  const found = (text, re) => new Set(text.match(re) || []);
  for (const [label, before, after] of PAIRS) {
    const was = readFileSync(join(ROOT, 'n8n', 'history', before), 'utf8');
    const now = readFileSync(join(ROOT, 'n8n', 'candidate', after), 'utf8');
    for (const [re, what] of patterns) {
      const older = found(was, re);
      for (const hit of found(now, re)) {
        assert(older.has(hit), label + ': the candidate introduces ' + what);
      }
    }
  }
});

check('every candidate the builder emits is covered by this gate', () => {
  const emitted = readdirSync(join(ROOT, 'n8n', 'candidate')).filter((f) => f.startsWith('lead-alerts-'));
  const covered = PAIRS.map(([, , after]) => after).sort();
  eq(emitted.sort().join(','), covered.join(','), 'an emitted candidate is not tested');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
