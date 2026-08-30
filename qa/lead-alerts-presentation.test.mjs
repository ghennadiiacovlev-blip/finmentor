#!/usr/bin/env node
// FINMENTOR — Lead Alerts presentation contract.
//
//   node qa/lead-alerts-presentation.test.mjs
//
// Offline. No tenant, no network, no credentials. Drives n8n/src/lead-alerts/presenter.js, which
// is the single source of every owner-facing alert string and is inlined verbatim into the Code
// nodes by scripts/build-lead-alerts-presentation.mjs.
//
// ── WHAT THIS GATE IS FOR ──────────────────────────────────────────────────────────────────────
//
// The alerts were rewritten to read like an executive channel rather than monitoring output. The
// risk in that rewrite is not ugliness, it is three specific failures:
//
//   1. A MESSAGE THAT DOES NOT ARRIVE. Telegram's HTML mode rejects an unescaped `<`, a stray `&`
//      or an unclosed tag with a 400, and the alert is simply lost. A company legitimately called
//      "Alfa <Grup> & Co" must not be able to silence the channel.
//   2. A MESSAGE THAT SAYS SOMETHING IT CANNOT KNOW. The system alert is the dangerous one: the
//      n8n error payload carries no execution data, so «Pipeline не изменён» would be a guess the
//      owner would act on. Asserted here as forbidden strings, not as a convention.
//   3. A MESSAGE THAT LEAKS. An owner-only channel is still a channel. Tokens, initData, stack
//      traces and client contact details must not travel in it.
//
// Every renderer is also fuzzed with hostile values, because the inputs come from a Google Sheet
// a human edits and from error text produced by whatever threw.

import { readFileSync } from 'node:fs';
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
const clean = (html, m) => {
  const v = P.validate(html);
  if (v.length) { throw new Error(m + ' -> ' + v.join('; ')); }
};

const OFF = 180;
const NOW = '2026-08-30T05:30:00.000Z';

const LEAD = {
  company: 'Alfa Grup', descriptor: 'Финансовый директор', role: 'Финансовый директор',
  priority: 'HOT', zone: 'ORANGE',
  objective: 'Навести порядок в деньгах', situation: 'Розничная сеть, оборот 5–10 млн EUR.',
  nextAction: 'Назначить Discovery Call', dueAt: '2026-08-30T09:00:00.000Z',
  source: 'Финансовый рентген', contactChannel: 'Telegram', leadId: 'FIN-20260830-0412'
};

const FULL_BRIEF = {
  now: NOW, offsetMinutes: OFF,
  counts: { active: 12, newToday: 3, needAttention: 5, overdue: 2 },
  leads: [LEAD, Object.assign({}, LEAD, { company: 'Nord Logistic', leadId: 'FIN-2', priority: 'WARM' })],
  moreLeads: 4, decisions: ['2 лида без следующего шага']
};

const ALERT = {
  workflowName: 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED',
  nodeName: 'Build Transport Request', errorClass: 'EXPRESSIONERROR',
  message: "Node 'Build Bot Response' hasn't been executed", executionId: '4239'
};

// Every renderer, with a representative model, so the sweeps below can iterate rather than repeat.
const RENDERS = () => [
  ['OWNER DAILY BRIEF', P.renderDailyBrief(FULL_BRIEF)],
  ['OWNER DAILY BRIEF (quiet)', P.renderDailyBrief({ now: NOW, offsetMinutes: OFF, counts: { active: 7 }, leads: [], decisions: [] })],
  ['NEW LEAD', P.renderNewLead(LEAD)],
  ['PRIORITY', P.renderPriority(Object.assign({ reason: 'Нет ответа больше 4 часов.', now: NOW, offsetMinutes: OFF }, LEAD))],
  ['FOLLOW-UP', P.renderFollowUp({ now: NOW, offsetMinutes: OFF, items: [{ company: 'Nord', action: 'Позвонить', dueAt: NOW, leadId: 'FIN-3' }] })],
  ['LEAD INCOMPLETE', P.renderIncomplete({ company: 'Nord', missing: ['контакт'], reason: 'Нет телефона.', source: 'Сайт', leadId: 'FIN-4' })],
  ['SYSTEM ALERT', P.renderSystemAlert(ALERT)],
  ['SYSTEM RECOVERED', P.renderSystemRecovered({ problem: 'Сбой отправки.', evidence: 'Три обращения обработаны.' })],
  ['DATA / INTEGRITY', P.renderDataIntegrity({ checkedAt: NOW, offsetMinutes: OFF, items: [{ label: 'Без контакта', count: 2 }] })]
];

console.log('Lead Alerts — owner presentation contract');
console.log('');

// ── 1. Telegram HTML, and the values that would break it ───────────────────────────────────────

check('every renderer produces a message the validator accepts', () => {
  for (const [name, html] of RENDERS()) { clean(html, name); }
});

check('hostile values are escaped, not passed through — the 400 that silences the channel', () => {
  // No Markdown in this string on purpose. Markdown characters in DATA are inert under HTML parse
  // mode; validate() flags them because a developer writing the next template in Markdown is the
  // real risk, and that check is exercised separately below.
  const nasty = 'Alfa <Grup> & Co </b><script>alert(1)</script> <img src=x onerror=y>';
  const models = [
    () => P.renderNewLead(Object.assign({}, LEAD, { company: nasty, objective: nasty, situation: nasty, nextAction: nasty, source: nasty })),
    () => P.renderPriority({ company: nasty, reason: nasty, nextAction: nasty, dueAt: NOW, now: NOW, offsetMinutes: OFF, leadId: nasty }),
    () => P.renderFollowUp({ now: NOW, offsetMinutes: OFF, items: [{ company: nasty, action: nasty, dueAt: NOW, leadId: nasty }] }),
    () => P.renderIncomplete({ company: nasty, missing: [nasty], reason: nasty, source: nasty, leadId: nasty }),
    () => P.renderSystemAlert(Object.assign({}, ALERT, { nodeName: nasty, message: nasty })),
    () => P.renderDailyBrief(Object.assign({}, FULL_BRIEF, { leads: [Object.assign({}, LEAD, { company: nasty, objective: nasty })] }))
  ];
  models.forEach((f, i) => {
    const html = f();
    clean(html, 'hostile model ' + i);
    assert(html.indexOf('<script') === -1, 'model ' + i + ' emitted a script tag');
    assert(html.indexOf('&lt;') !== -1, 'model ' + i + ' did not escape anything at all');
  });
});

check('the tag set is exactly what Telegram parses, and nothing wider', () => {
  const allowed = P.ALLOWED_TAGS;
  ['div', 'span', 'p', 'br', 'h1', 'script', 'img', 'strong', 'em'].forEach((t) => {
    assert(allowed.indexOf(t) === -1, '<' + t + '> is allowed but Telegram does not parse it');
  });
  for (const [name, html] of RENDERS()) {
    for (const t of (html.match(/<\/?([a-zA-Z-]+)[^>]*>/g) || [])) {
      const n = /<\/?([a-zA-Z-]+)/.exec(t)[1].toLowerCase();
      assert(allowed.indexOf(n) !== -1, name + ' emitted <' + n + '>');
    }
  }
});

check('the validator itself rejects the four shapes it exists to catch', () => {
  assert(P.validate('<b>Статус</b>').length, 'an unclosed... a lone heading passed');
  assert(P.validate('<b>oops').length, 'an unclosed tag passed');
  assert(P.validate('a < b').length, 'an unescaped < passed');
  assert(P.validate('<div>x</div>').length, 'a non-Telegram tag passed');
  assert(P.validate('**bold**').length, 'Markdown mixed into HTML passed');
  assert(P.validate('A: 0\nB: 0\nC: 0').length, 'three zero counters passed');
  assert(P.validate('Компания: —').length, 'a placeholder value passed');
  assert(P.validate('Компания:').length, 'a label with no value passed');
  assert(P.validate('').length, 'an empty message passed');
  eq(P.validate('<b>Всё хорошо.</b>').length, 0, 'a valid one-line message was rejected');
});

// ── 2. no empty sections, no zero noise ────────────────────────────────────────────────────────

check('an absent value removes its line, and an absent section removes its heading', () => {
  const bare = P.renderNewLead({ company: 'Nord', leadId: 'FIN-9' });
  clean(bare, 'bare NEW LEAD');
  ['Задача', 'Ситуация', 'Следующий шаг', 'Источник', 'Финансовая зона', 'Приоритет']
    .forEach((h) => assert(bare.indexOf(h) === -1, 'the bare model still rendered «' + h + '»'));
  // «Связь» is the ONE section that survives an empty model, by owner decision: a lead nobody
  // can reach is a fact the owner must be told, not a line to omit.
  assert(bare.indexOf('Связь') !== -1, 'a lead with no contact at all said nothing about it');
  assert(bare.indexOf('<b>Не указана</b>') !== -1, 'the absent contact is not stated');
  assert(bare.indexOf('—') === -1, 'the bare model rendered a dash placeholder');
  assert(bare.indexOf('undefined') === -1 && bare.indexOf('null') === -1, 'a raw JS value reached the message');
});

check('a quiet day is five lines, not a wall of zeroes — the B11 defect, measured', () => {
  const html = P.renderDailyBrief({
    now: NOW, offsetMinutes: OFF,
    counts: { active: 0, newToday: 0, needAttention: 0, overdue: 0 },
    leads: [], moreLeads: 0, decisions: []
  });
  clean(html, 'quiet brief');
  const zeros = html.split('\n').filter((l) => /:\s*0\s*$/.test(l));
  eq(zeros.length, 1, 'zero-valued lines in a quiet brief (only the anchor may remain)');
  assert(html.indexOf('Критичных действий нет.') !== -1, 'the quiet day is not stated as a result');
  assert(html.split('\n').filter((l) => l.trim()).length <= 6, 'a quiet brief is longer than six lines');
  // The deployed digest prints all five of these at zero. None may survive.
  ['Overdue follow-ups', 'No next action', 'No contact', 'AI plan not ready', 'Snoozed expired',
    'AI ready', 'AI missing', 'Source / UTM', 'Timezone']
    .forEach((s) => assert(html.indexOf(s) === -1, 'the raw digest line «' + s + '» survived'));
});

check('the priority roster is bounded, and the remainder is counted rather than listed', () => {
  const many = [];
  for (let i = 0; i < 30; i++) { many.push(Object.assign({}, LEAD, { company: 'Co ' + i, leadId: 'FIN-' + i })); }
  const html = P.renderDailyBrief(Object.assign({}, FULL_BRIEF, { leads: many, moreLeads: 25 }));
  clean(html, 'long brief');
  eq((html.match(/^\d+\. <b>/gm) || []).length, 5, 'leads listed');
  assert(html.indexOf('И ещё 25 в работе.') !== -1, 'the remainder is not stated');
  assert(html.length < 2000, 'the brief is ' + html.length + ' characters');
});

// ── 3. no duplicated lead ──────────────────────────────────────────────────────────────────────

check('the same lead cannot appear twice in one message', () => {
  const dup = [LEAD, LEAD, Object.assign({}, LEAD, { leadId: 'FIN-OTHER', company: 'Nord' })];
  const brief = P.renderDailyBrief(Object.assign({}, FULL_BRIEF, { leads: dup }));
  eq((brief.match(/Alfa Grup/g) || []).length, 1, 'Alfa Grup appears more than once in the brief');

  const fu = P.renderFollowUp({ now: NOW, offsetMinutes: OFF, items: [
    { company: 'Nord', action: 'a', dueAt: NOW, leadId: 'FIN-3' },
    { company: 'Nord', action: 'a', dueAt: NOW, leadId: 'FIN-3' }
  ] });
  eq((fu.match(/Nord/g) || []).length, 1, 'the same follow-up is listed twice');
  assert(fu.indexOf('Просрочено: <b>1</b>') !== -1, 'the count was not deduplicated with the list');

  // Two genuinely different leads at the same company must BOTH survive: deduping by name alone
  // would hide a second request from an existing client.
  const two = P.renderDailyBrief(Object.assign({}, FULL_BRIEF, { leads: [
    Object.assign({}, LEAD, { leadId: 'FIN-A' }), Object.assign({}, LEAD, { leadId: 'FIN-B' })
  ] }));
  eq((two.match(/Alfa Grup/g) || []).length, 2, 'two distinct leads at one company were collapsed');
});

// ── 4. B10 vocabulary ──────────────────────────────────────────────────────────────────────────

check('the priority vocabulary is exactly the approved four, and nothing is invented', () => {
  eq(P.priorityLabel('HOT'), 'Высокий приоритет', 'HOT');
  eq(P.priorityLabel('WARM'), 'Требует внимания', 'WARM');
  eq(P.priorityLabel('COLD'), 'Низкий приоритет', 'COLD');
  eq(P.priorityLabel('INCOMPLETE'), 'Нужны данные', 'INCOMPLETE');
  eq(P.priorityLabel('hot'), 'Высокий приоритет', 'case is normalised');
  eq(Object.keys(P.PRIORITY_LABEL).length, 4, 'the priority vocabulary grew');
  // An unknown value must NOT be mapped to a plausible-looking label.
  ['UNKNOWN', '', 'RED', 'ORANGE', 'urgent', null, undefined].forEach((v) => {
    eq(P.priorityLabel(v), '', 'priority ' + JSON.stringify(v) + ' was given a label');
  });
});

check('financial zone is a SEPARATE dimension and is never merged into priority', () => {
  eq(P.zoneLabel('RED'), 'Критическая зона', 'RED');
  eq(P.zoneLabel('ORANGE'), 'Повышенный риск', 'ORANGE');
  eq(P.zoneLabel('YELLOW'), 'Есть зоны риска', 'YELLOW');
  eq(P.zoneLabel('GREEN'), 'Устойчиво', 'GREEN');
  eq(Object.keys(P.ZONE_LABEL).length, 4, 'the zone vocabulary grew');
  ['HOT', 'WARM', 'COLD', 'INCOMPLETE', 'UNKNOWN', ''].forEach((v) => {
    eq(P.zoneLabel(v), '', 'zone ' + JSON.stringify(v) + ' was given a label');
  });
  // The two vocabularies must not share a single word, or the owner cannot tell them apart.
  const a = Object.values(P.PRIORITY_LABEL);
  const b = Object.values(P.ZONE_LABEL);
  a.forEach((x) => assert(b.indexOf(x) === -1, 'the label «' + x + '» is used for both dimensions'));

  // A COLD/RED lead must render both facts, not one.
  const html = P.renderNewLead(Object.assign({}, LEAD, { priority: 'COLD', zone: 'RED' }));
  assert(html.indexOf('Низкий приоритет') !== -1, 'the priority is missing');
  assert(html.indexOf('Критическая зона') !== -1, 'the risk zone is missing');
});

check('no raw status token reaches the owner', () => {
  for (const [name, html] of RENDERS()) {
    // The first line is the alert TYPE — «FINMENTOR · LEAD INCOMPLETE» names a message class, not
    // a lead's status value, and it is the one place those letters legitimately appear.
    const body = html.split('\n').slice(1).join('\n');
    ['HOT', 'WARM', 'COLD', 'INCOMPLETE', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'UNKNOWN']
      .forEach((t) => assert(!new RegExp('(^|[^A-Z])' + t + '([^A-Z]|$)').test(body),
        name + ' shows the raw token ' + t));
  }
});

check('Markdown written into a template is caught, and Markdown in data is rendered inert', () => {
  // The dangerous case: a future template author reaches for Markdown out of habit.
  assert(P.validate('<b>x</b>\n**bold**').length, 'Markdown in a template passed');
  assert(P.validate('<b>x</b>\n[label](http://example.md)').length, 'a Markdown link in a template passed');
  // The harmless case: a client's own text contains asterisks. It must still be escaped and safe.
  const html = P.renderNewLead(Object.assign({}, LEAD, { company: 'Alfa **Grup** <b>x</b>' }));
  assert(html.indexOf('Alfa **Grup**') !== -1, 'the literal asterisks were mangled');
  assert(html.indexOf('&lt;b&gt;x&lt;/b&gt;') !== -1, 'the angle brackets in the client value were not escaped');
});

check('the lead source is a label, never the internal slug', () => {
  eq(P.sourceLabel('xray_extended'), 'Финансовый рентген — расширенная анкета', 'extended xray');
  eq(P.sourceLabel('xray_quick'), 'Финансовый рентген — быстрый рентген', 'quick xray');
  eq(P.sourceLabel('mini_scan'), 'Мини-скан оборотного капитала', 'mini scan');
  eq(P.sourceLabel('contact_form'), 'Контактная форма сайта', 'contact form');
  eq(P.sourceLabel('telegram_miniapp'), 'Telegram Mini App', 'mini app');
  // An unknown slug degrades to a true generic statement rather than being printed raw.
  eq(P.sourceLabel('something_new_2027'), 'Сайт FINMENTOR', 'unknown slug');
  eq(P.sourceLabel(''), '', 'no source at all removes the line');
  // IDEMPOTENT. A caller that has already translated must not be punished with the fallback.
  for (const slug of ['xray_extended', 'xray_quick', 'mini_scan', 'contact_form', 'telegram_miniapp', 'whatever']) {
    const once = P.sourceLabel(slug);
    eq(P.sourceLabel(once), once, 'sourceLabel is not idempotent for ' + slug);
  }
  for (const [name, html] of RENDERS()) {
    ['xray_extended', 'mini_scan', 'contact_form', 'telegram_miniapp', 'xray_quick']
      .forEach((slug) => assert(html.indexOf(slug) === -1, name + ' printed the raw slug ' + slug));
  }
});

// ── 5. B13 separation ──────────────────────────────────────────────────────────────────────────

check('a business alert carries no system vocabulary', () => {
  const business = ['OWNER DAILY BRIEF', 'OWNER DAILY BRIEF (quiet)', 'NEW LEAD', 'PRIORITY',
    'FOLLOW-UP', 'LEAD INCOMPLETE'];
  for (const [name, html] of RENDERS()) {
    if (business.indexOf(name) === -1) { continue; }
    ['Workflow', 'workflow', 'Node:', 'Execution', 'execution', 'Технические данные', 'EXPRESSIONERROR', 'n8n']
      .forEach((t) => assert(html.indexOf(t) === -1, name + ' leaked the system term «' + t + '»'));
  }
});

check('a system alert carries no lead', () => {
  const html = P.renderSystemAlert(ALERT);
  ['Компания', 'Приоритет', 'Задача', 'Alfa', 'FIN-', 'Высокий приоритет', 'Следующий шаг']
    .forEach((t) => assert(html.indexOf(t) === -1, 'the system alert leaked the business term «' + t + '»'));
});

// ── 6. B8 — the system alert may not claim what it cannot know ─────────────────────────────────

check('the system alert never claims an unproven absence of side effects', () => {
  const forbidden = [
    'Обращение не создано', 'Pipeline не изменён', 'Privacy-запись не создана',
    'Данные не затронуты', 'Без последствий', 'Ничего не записано', 'Лид не создан'
  ];
  for (const wf of ['FINMENTOR Lead Intake PREMIUM FINAL', 'FINMENTOR Mini App Gateway',
    'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED', 'Something Unmapped']) {
    const html = P.renderSystemAlert(Object.assign({}, ALERT, { workflowName: wf }));
    clean(html, 'system alert for ' + wf);
    forbidden.forEach((f) => assert(html.indexOf(f) === -1,
      'the alert for «' + wf + '» claims «' + f + '», which the error payload cannot support'));
  }
  // And it must say so out loud rather than staying silent about the gap.
  const html = P.renderSystemAlert(ALERT);
  assert(/автоматически не проверены/.test(html), 'the alert does not admit the check was not made');
  assert(html.indexOf('Требует проверки') !== -1, 'the alert has no status');
});

check('the impact line is derived from the workflow name, and every live workflow name maps', () => {
  const cases = [
    ['FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED', 'Ответ клиенту в Telegram не был отправлен.'],
    ['FINMENTOR Telegram Client Transport', 'Ответ клиенту в Telegram не был отправлен.'],
    ['FINMENTOR Lead Intake PREMIUM FINAL', 'Приём заявки прерван.'],
    ['FINMENTOR Daily Lead Digest PREMIUM FINAL', 'Ежедневный дайджест не сформирован.'],
    ['FINMENTOR SLA Lead Watch PREMIUM FINAL', 'Проверка SLA не выполнена.'],
    ['FINMENTOR Followup Sequence PREMIUM v2', 'Напоминания не разосланы.'],
    ['FINMENTOR Lead Command Center SECURE CANDIDATE', 'Команда владельца не выполнена.'],
    ['[CANDIDATE] FINMENTOR Mini App Submit', 'Заявка из Mini App не была принята.'],
    ['[CANDIDATE] FINMENTOR Mini App Session (draft)', 'Заявка из Mini App не была принята.'],
    ['[UAT] FINMENTOR Premium Mini App host (owner-only)', 'Заявка из Mini App не была принята.'],
    ['FINMENTOR Mini App Gateway', 'Заявка из Mini App не была принята.']
  ];
  cases.forEach(([wf, want]) => eq(P.impactOf(wf), want, 'impact for ' + wf));
  // An unrecognised workflow degrades to a true statement rather than a wrong one.
  eq(P.impactOf('Totally New Workflow'), 'Выполнение остановлено.', 'the fallback');
  eq(P.impactOf(''), 'Выполнение остановлено.', 'the empty fallback');
});

check('the technical block is quiet, last, and drops a class that says nothing', () => {
  const html = P.renderSystemAlert(ALERT);
  const i = html.indexOf('<i>Технические данные</i>');
  assert(i > html.indexOf('Требует проверки'), 'the technical block is not last');
  assert(html.indexOf('Класс') === -1, 'EXPRESSIONERROR was rendered as a class, and it tells the owner nothing');
  eq(P.shortWorkflow('FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED'), 'Telegram Client Concierge', 'short name');
  eq(P.shortWorkflow('[CANDIDATE] FINMENTOR Mini App Submit'), 'Mini App Submit', 'short name, bracketed');

  const withClass = P.renderSystemAlert(Object.assign({}, ALERT, { errorClass: 'RATE_LIMIT' }));
  assert(withClass.indexOf('Класс: RATE_LIMIT') !== -1, 'a useful class was dropped');
  assert(withClass.indexOf('Превышен лимит') !== -1, 'a useful class carries no human sentence');
});

// ── 7. B14 privacy, and B16 secrets ────────────────────────────────────────────────────────────

check('ONE preferred channel, with its value, and only in NEW LEAD — the owner policy, exhausted', () => {
  // OWNER DECISION, 2026-08-30. Every row of the decision table, rendered and checked.
  const base = Object.assign({}, LEAD);
  const cases = [
    ['telegram', '@alfaceo',        '<b>Telegram · @alfaceo</b>'],
    ['telegram', '',                '<b>Telegram</b>'],
    ['telegram', null,              '<b>Telegram</b>'],
    ['phone',    '+37369123456',    '<b>Телефон · +37369123456</b>'],
    ['email',    'ceo@alfa.md',     '<b>Email · ceo@alfa.md</b>'],
    ['phone',    '',                '<b>Не указана</b>'],
    ['email',    '',                '<b>Не указана</b>'],
    ['',         '+37369123456',    '<b>Не указана</b>'],
    [null,       null,              '<b>Не указана</b>'],
    ['Телефон',  '+373 60 000 000', '<b>Телефон · +373 60 000 000</b>'],
    ['Email',    'ceo@alfa.md',     '<b>Email · ceo@alfa.md</b>']
  ];
  for (const [ch, val, want] of cases) {
    const html = P.renderNewLead(Object.assign({}, base, { contactChannel: ch, contactValue: val }));
    clean(html, 'NEW LEAD ' + ch + '/' + val);
    const arr = html.split('\n');
    const i = arr.findIndex((l) => l.trim() === 'Связь');
    assert(i !== -1, 'no «Связь» block for ' + JSON.stringify([ch, val]));
    eq(arr[i + 1], want, 'contact line for ' + JSON.stringify([ch, val]));
    eq(arr.filter((l) => l.trim() === 'Связь').length, 1, 'more than one «Связь» block');
  }

  // Phone and email NEVER together, whatever the model holds.
  const both = P.renderNewLead(Object.assign({}, base, {
    contactChannel: 'phone', contactValue: '+37369123456',
    phone: '+37369123456', email: 'ceo@alfa.md', telegram: '@alfaceo'
  }));
  assert(both.indexOf('+37369123456') !== -1, 'the chosen channel value is missing');
  assert(both.indexOf('ceo@alfa.md') === -1, 'the email appeared beside the phone');
  assert(both.indexOf('@alfaceo') === -1, 'the Telegram handle appeared beside the phone');
});

check('no contact value reaches any message except NEW LEAD', () => {
  // Every renderer gets a model stuffed with contact data it has no business printing. Only the
  // NEW LEAD «Связь» block may show one, and only the channel the client chose.
  const leaky = Object.assign({}, LEAD, {
    phone: '+37369123456', email: 'ceo@alfa.md', telegram: '@alfaceo',
    contactChannel: '', contactValue: '',
    raw_json: '{"client":{"phone":"+37369123456"}}',
    main_pain_free_text: 'Свяжитесь со мной по +373 69 123 456 или ceo@alfa.md'
  });
  const elsewhere = [
    ['PRIORITY', P.renderPriority(Object.assign({ reason: 'x', now: NOW, offsetMinutes: OFF }, leaky))],
    ['BRIEF', P.renderDailyBrief(Object.assign({}, FULL_BRIEF, { leads: [leaky] }))],
    ['FOLLOW-UP', P.renderFollowUp({ now: NOW, offsetMinutes: OFF, items: [leaky] })],
    ['LEAD INCOMPLETE', P.renderIncomplete(Object.assign({ missing: ['контакт для связи'] }, leaky))],
    ['SYSTEM ALERT', P.renderSystemAlert(Object.assign({}, ALERT, { message: 'failed for ceo@alfa.md at +37369123456' }))],
    // DATA / INTEGRITY takes {label, count} pairs where the label is a fixed category written by
    // the builder, never a client value. It is fed the contact-bearing model here to prove the
    // renderer reads none of those keys — scrubbing a "label" instead would hide the design error
    // of ever passing one, rather than surfacing it.
    ['DATA / INTEGRITY', P.renderDataIntegrity(Object.assign({ checkedAt: NOW, offsetMinutes: OFF,
      items: [{ label: 'Лиды без контакта', count: 1 }] }, leaky))]
  ];
  for (const [name, html] of elsewhere) {
    assert(html.indexOf('Связь') === -1, name + ' emitted a «Связь» block — only NEW LEAD may');
    ['+37369123456', 'ceo@alfa.md', '@alfaceo', 'raw_json', '69 123 456']
      .forEach((t) => assert(html.indexOf(t) === -1, name + ' leaked «' + t + '»'));
  }
  // And the leaky NEW LEAD, with no channel stated, still refuses to guess one.
  const nl = P.renderNewLead(leaky);
  clean(nl, 'NEW LEAD with a leaky model');
  assert(nl.indexOf('<b>Не указана</b>') !== -1, 'NEW LEAD invented a channel from stray model keys');
  ['+37369123456', 'ceo@alfa.md', '@alfaceo', 'raw_json']
    .forEach((t) => assert(nl.indexOf(t) === -1, 'NEW LEAD leaked «' + t + '» with no channel stated'));
});

check('validate() refuses a message carrying two contacts', () => {
  const twoContacts = '<b>FINMENTOR · NEW LEAD</b>\n\nСвязь\n<b>Телефон · +37369123456</b>\n\nСвязь\n<b>Email · ceo@alfa.md</b>';
  assert(P.validate(twoContacts).length, 'two «Связь» blocks passed');
  // And a contact OUTSIDE the exempted line is still caught.
  assert(P.validate('<b>x</b>\nПишите на ceo@alfa.md').length, 'a stray email passed');
  assert(P.validate('<b>x</b>\nЗвоните +37369123456').length, 'a stray phone passed');
});

check('secrets, initData and stack traces cannot survive into a message', () => {
  const poison = [
    '7123456789:AAH1a2b3c4d5e6f7g8h9i0jKLMNOPQRSTUV',
    'query_id=AAH&user=%7B%22id%22%3A1%7D&auth_date=1788000000&hash=abc',
    'password=hunter2 api_key=sk-live-abcdef',
    "ExpressionError: boom\n    at throwExecutionError (/usr/local/lib/node_modules/n8n/x.ts:11:9)"
  ];
  poison.forEach((p2, i) => {
    // The validator must SEE the problem when it is handed one directly...
    assert(P.validate(P.esc(p2)).length, 'the validator missed poison ' + i);
  });
  // ...and the scrubbing the Error Monitor already applies keeps it out of the real path. The
  // renderer bounds the message; the workflow scrubs it. Both, not either.
  const html = P.renderSystemAlert(Object.assign({}, ALERT, { message: 'x'.repeat(500) }));
  clean(html, 'over-long error message');
  assert(html.length < 900, 'an unbounded error message reached the owner');
});

check('no message can exceed what Telegram will send', () => {
  const huge = 'Ж'.repeat(5000);
  const messages = [
    P.renderNewLead(Object.assign({}, LEAD, { company: huge, objective: huge, situation: huge, nextAction: huge, source: huge })),
    P.renderPriority({ company: huge, reason: huge, nextAction: huge, dueAt: NOW, now: NOW, offsetMinutes: OFF, leadId: huge }),
    P.renderSystemAlert(Object.assign({}, ALERT, { workflowName: huge, nodeName: huge, message: huge })),
    P.renderDailyBrief(Object.assign({}, FULL_BRIEF, {
      leads: Array.from({ length: 40 }, (_, i) => Object.assign({}, LEAD, { company: huge, leadId: 'F' + i })),
      decisions: Array.from({ length: 40 }, () => huge)
    })),
    P.renderFollowUp({ now: NOW, offsetMinutes: OFF, items: Array.from({ length: 40 }, (_, i) => ({ company: huge, action: huge, dueAt: NOW, leadId: 'F' + i })) })
  ];
  messages.forEach((h, i) => {
    assert(h.length <= 4000, 'message ' + i + ' is ' + h.length + ' characters');
    clean(h, 'oversized model ' + i);
  });
});

// ── 8. determinism ─────────────────────────────────────────────────────────────────────────────

check('the same model renders the same bytes, every time', () => {
  for (const [name] of RENDERS()) { void name; }
  const first = RENDERS().map(([, h]) => h);
  for (let i = 0; i < 25; i++) {
    const again = RENDERS().map(([, h]) => h);
    again.forEach((h, j) => eq(h, first[j], 'render ' + j + ' drifted on pass ' + i));
  }
});

check('the module reads no clock and no locale of its own', () => {
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ['Date.now(', 'toLocaleDateString', 'toLocaleString', 'Intl.', 'Math.random', 'process.env']
    .forEach((f) => assert(src.indexOf(f) === -1, 'the renderer uses ' + f + ', so its output is not reproducible'));
  // `new Date(x)` is fine — it parses what the caller supplied. `new Date()` is not.
  assert(!/new Date\(\s*\)/.test(src), 'the renderer reads the current time itself');
});

check('the Russian month table is complete and in genitive, which is what a date needs', () => {
  eq(P.MONTHS_GEN.length, 12, 'months');
  eq(P.MONTHS_GEN[7], 'августа', 'August in genitive');
  eq(P.MONTHS_GEN[2], 'марта', 'March in genitive');
  eq(P.longDate('2026-01-01T22:00:00.000Z', 180), '2 января', 'the offset is applied before the date is read');
  eq(P.dateTime('2026-08-30T05:30:00.000Z', 180), '30 августа · 08:30', 'date and time');
  eq(P.longDate('not-a-date', 180), '', 'an unparseable date renders as nothing, not as Invalid Date');
});

check('deadlines are stated as decisions, not as timestamps', () => {
  const d = (due) => P.deadline(due, NOW, OFF);
  eq(d('2026-08-30T09:00:00.000Z'), 'сегодня', 'today');
  eq(d('2026-08-31T09:00:00.000Z'), 'завтра', 'tomorrow');
  eq(d('2026-08-29T09:00:00.000Z'), 'просрочено на 1 день', 'one day over');
  eq(d('2026-08-27T09:00:00.000Z'), 'просрочено на 3 дня', 'three days over');
  eq(d('2026-08-25T09:00:00.000Z'), 'просрочено на 5 дней', 'five days over');
  eq(d('2026-08-19T09:00:00.000Z'), 'просрочено на 11 дней', 'eleven days over');
  eq(d('2026-09-04T09:00:00.000Z'), '4 сентября', 'a future date');
  eq(d('nonsense'), '', 'an unparseable due date');
  eq(P.plural(1, 'день', 'дня', 'дней'), 'день', 'plural 1');
  eq(P.plural(2, 'день', 'дня', 'дней'), 'дня', 'plural 2');
  eq(P.plural(5, 'день', 'дня', 'дней'), 'дней', 'plural 5');
  eq(P.plural(11, 'день', 'дня', 'дней'), 'дней', 'plural 11');
  eq(P.plural(21, 'день', 'дня', 'дней'), 'день', 'plural 21');
});

// ── 9. the two unwired types ───────────────────────────────────────────────────────────────────

check('SYSTEM RECOVERED and DATA / INTEGRITY render, and are documented as unwired', () => {
  clean(P.renderSystemRecovered({ problem: 'x', evidence: 'y' }), 'SYSTEM RECOVERED');
  clean(P.renderDataIntegrity({ checkedAt: NOW, offsetMinutes: OFF, items: [{ label: 'a', count: 1 }] }), 'DATA / INTEGRITY');
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'), 'utf8');
  assert(/THE TRIGGER DOES NOT/.test(src), 'the recovery renderer no longer says it is unwired');
  assert(/Also unwired/.test(src), 'the data-integrity renderer no longer says it is unwired');
});

check('data quality is the ONE message where a zero is information', () => {
  const clean0 = P.renderDataIntegrity({ checkedAt: NOW, offsetMinutes: OFF, items: [{ label: 'Без контакта', count: 0 }] });
  assert(clean0.indexOf('Данные в порядке.') !== -1, 'a clean data report does not say so');
  assert(clean0.indexOf('Без контакта') === -1, 'a clean data report still lists its zeroes');
  const dirty = P.renderDataIntegrity({ checkedAt: NOW, offsetMinutes: OFF, items: [{ label: 'Без контакта', count: 2 }, { label: 'Без плана', count: 0 }] });
  assert(dirty.indexOf('Без контакта') !== -1, 'a non-zero item was dropped');
  assert(dirty.indexOf('Без плана') === -1, 'a zero item was listed beside a real one');
});

check('LEAD INCOMPLETE describes the operational gap and states no legal conclusion', () => {
  const html = P.renderIncomplete({ company: '', missing: ['контакт для связи', 'название компании'],
    reason: 'Нет согласия на обработку персональных данных', source: 'contact_form', leadId: 'FIN-X' });
  clean(html, 'LEAD INCOMPLETE');
  // The reason is PINNED. A builder cannot inject one, and the old wording cannot come back.
  assert(html.indexOf('Недостаточно данных для полноценной обработки обращения.') !== -1, 'the pinned reason is missing');
  assert(html.indexOf('Проверить данные обращения вручную.') !== -1, 'the pinned next step is missing');
  ['согласи', 'consent', 'без согласия', 'Форма отправлена', 'legal', 'GDPR']
    .forEach((t) => assert(html.toLowerCase().indexOf(t.toLowerCase()) === -1,
      'the alert states a legal conclusion — «' + t + '»'));
  // A model-supplied reason must be ignored entirely, not merely deprioritised.
  assert(html.indexOf('Нет согласия') === -1, 'the model overrode the pinned reason');
});

// ── 10. the header, which is the whole brand promise in two lines ──────────────────────────────

check('every message opens with the FINMENTOR chrome and its type, and nothing else', () => {
  const types = ['OWNER DAILY BRIEF', 'NEW LEAD', 'PRIORITY', 'FOLLOW-UP', 'LEAD INCOMPLETE',
    'SYSTEM ALERT', 'SYSTEM RECOVERED', 'DATA / INTEGRITY WARNING'];
  for (const [, html] of RENDERS()) {
    const first = html.split('\n')[0];
    const m = /^<b>FINMENTOR · (.+)<\/b>$/.exec(first);
    assert(m, 'a message opens with «' + first + '»');
    assert(types.indexOf(m[1]) !== -1, 'unknown alert type «' + m[1] + '» — report it before inventing a ninth');
  }
});

check('there is no emoji anywhere — the deployed alerts open with 🚨 and ⚠️', () => {
  const emoji = /[←-⇿⌀-⏿☀-➿️\u{1F000}-\u{1FAFF}]/u;
  for (const [name, html] of RENDERS()) {
    assert(!emoji.test(html), name + ' contains an emoji');
  }
  // The typographic middot in the header is deliberate and is not an emoji.
  assert(P.header('NEW LEAD').indexOf('·') !== -1, 'the header separator is gone');
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
