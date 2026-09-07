#!/usr/bin/env node
// FINMENTOR — owner cards, golden renders.
//
//   node qa/owner-cards-golden.test.mjs
//
// Offline. Drives n8n/src/lead-alerts/presenter.js as a module and compares FULL messages against
// the exact strings the owner approved on 2026-09-04. Every other lead-alerts gate asserts
// properties (escaped, valid, bounded, no leak); this one asserts BYTES. A one-character drift in
// a label, an icon or a blank line is a change the owner did not approve, and it fails here before
// it reaches a builder.
//
// The fixtures are the eight shapes the decision named: a RU HOT lead, a RO WARM lead with the
// «Клиент: RO» marker, a COLD lead, a PRIORITY card three days overdue, a PRIORITY card due today,
// a company name long enough to truncate, a hostile company name, and a lead with every optional
// field missing. Then the cross-cutting rules: no <code>, no lead id, no raw enum, validate() clean,
// and under 1000 characters — measured on the same goldens.

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
const eq = (a, b, m) => {
  if (a !== b) {
    // Show the first differing line so a drift is located, not just detected.
    const al = String(a).split('\n'); const bl = String(b).split('\n');
    let i = 0;
    while (i < al.length && i < bl.length && al[i] === bl[i]) { i++; }
    throw new Error(m + ' — first difference at line ' + (i + 1) + ': got ' + JSON.stringify(al[i]) + ', want ' + JSON.stringify(bl[i]));
  }
};

// One fixed clock for every card. Chisinau, summer: UTC+3.
const NOW = '2026-09-04T06:00:00.000Z';
const OFF = 180;

// ── the models ─────────────────────────────────────────────────────────────────────────────────

const MODELS = {
  'new RU lead (HOT)': () => P.renderNewLead({
    company: 'Alfa Grup SRL', contactName: 'Ион Русу', role: 'Финансовый директор', language: 'ru',
    objective: 'Не видно реальной прибыли по направлениям',
    situation: 'Продукты питания · Retail · 5–10 млн EUR · 50–100',
    priority: 'HOT', zone: 'ORANGE', nextAction: 'Назначить Discovery Call', source: 'xray_extended',
    contactChannel: 'telegram', contactValue: '@alfaceo', leadId: 'FIN-20260904-0001'
  }),
  'new RO lead (WARM)': () => P.renderNewLead({
    company: 'Vinaria Bostavan', contactName: 'Ana Popescu', role: 'Administrator', language: 'ro',
    objective: 'Lipsă de control asupra fluxului de numerar',
    situation: 'Vinificație · Producție · 2–5 mln EUR · 20–50',
    priority: 'WARM', zone: 'YELLOW', nextAction: 'Propune Financial Health Check', source: 'telegram_miniapp',
    contactChannel: 'phone', contactValue: '+37369123456', leadId: 'FIN-20260904-0002'
  }),
  'COLD lead': () => P.renderNewLead({
    company: 'Nord Logistic', role: 'Собственник',
    objective: 'Хочу понять, нужен ли финансовый директор',
    situation: 'Логистика · Услуги · до 500 тыс. EUR',
    priority: 'COLD', zone: 'GREEN', nextAction: 'Отправить материалы, вернуться через месяц', source: 'contact_form',
    contactChannel: 'email', contactValue: 'office@nord.md', leadId: 'FIN-20260904-0003'
  }),
  'priority overdue (3 days)': () => P.renderPriority({
    company: 'Alfa Grup SRL', reason: 'Запланированный контакт просрочен.',
    nextAction: 'Позвонить и назначить встречу',
    dueAt: '2026-09-01T09:00:00.000Z', now: NOW, offsetMinutes: OFF, priority: 'HOT', leadId: 'FIN-20260904-0001'
  }),
  'priority due today': () => P.renderPriority({
    company: 'Vinaria Bostavan', reason: 'Нет ответа больше 24 часов.',
    nextAction: 'Связаться с лидом',
    dueAt: '2026-09-04T12:00:00.000Z', now: NOW, offsetMinutes: OFF, priority: 'WARM', leadId: 'FIN-20260904-0002'
  }),
  'long company name': () => P.renderNewLead({
    company: 'Международная торгово-производственная компания Северо-Восточной Молдовы и партнёры SRL',
    priority: 'HOT', contactChannel: 'telegram', contactValue: '@longco'
  }),
  'malicious HTML': () => P.renderNewLead({
    company: 'Alfa <Grup> & Co <b>x</b>', role: 'CFO <i>&</i>', objective: 'a < b & c > d',
    situation: '<script>alert(1)</script>', priority: 'HOT', zone: 'RED', nextAction: '</b><u>x</u>',
    source: 'xray_quick', contactChannel: 'telegram', contactValue: '@alfa<ceo>'
  }),
  'missing optional fields': () => P.renderNewLead({
    company: 'Nord', priority: 'HOT', objective: 'Навести порядок в деньгах', source: 'xray_extended'
  })
};

// ── the goldens ────────────────────────────────────────────────────────────────────────────────
//
// Written out in full, line by line, so a reviewer reads the message the owner will read.

const GOLDEN = {
  'new RU lead (HOT)': [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>Alfa Grup SRL</b>',
    'Финансовый директор · Источник: Финансовый рентген — расширенная анкета',
    '',
    '<b>Приоритет:</b> 🔥 Высокий приоритет',
    '<b>Финансовая зона:</b> 🟠 Существенные пробелы',
    '',
    '<b>Запрос</b>',
    'Не видно реальной прибыли по направлениям',
    '',
    '<b>Контекст</b>',
    'Продукты питания · Retail · 5–10 млн EUR · 50–100 сотрудников',
    'Связь: <b>Telegram · @alfaceo</b>',
    '',
    '<b>Следующий шаг</b>',
    'Назначить Discovery Call'
  ],
  // OWNER CORRECTION 2026-09-04: the Romanian free text (role, request, classified RO labels, next
  // step) is NOT rendered on the Russian console — the request becomes a neutral pointer, the rest
  // is omitted, the digits/units of the situation survive, and «Клиент: RO» is the only RO trace.
  'new RO lead (WARM)': [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>Vinaria Bostavan</b>',
    'Источник: Telegram Mini App · Клиент: RO',
    '',
    '<b>Приоритет:</b> 🕒 Требует внимания',
    '<b>Финансовая зона:</b> 🟡 Требует внимания',
    '',
    '<b>Запрос</b>',
    'Запрос клиента доступен в карточке лида CRM',
    '',
    '<b>Контекст</b>',
    '2–5 млн EUR · 20–50 сотрудников',
    'Связь: <b>Телефон · +37369123456</b>'
  ],
  'COLD lead': [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>Nord Logistic</b>',
    'Собственник · Источник: Контактная форма сайта',
    '',
    '<b>Приоритет:</b> ⚪ Низкий приоритет',
    '<b>Финансовая зона:</b> 🟢 Устойчивое управление',
    '',
    '<b>Запрос</b>',
    'Хочу понять, нужен ли финансовый директор',
    '',
    '<b>Контекст</b>',
    'Логистика · Услуги · до 500 тыс. EUR',
    'Связь: <b>Email · office@nord.md</b>',
    '',
    '<b>Следующий шаг</b>',
    'Отправить материалы, вернуться через месяц'
  ],
  'priority overdue (3 days)': [
    '⏳ <b>FINMENTOR · Требует внимания</b>',
    '',
    '<b>Alfa Grup SRL</b>',
    '',
    '<b>Просрочено:</b> 3 дня',
    '',
    '<b>Причина</b>',
    'Запланированный контакт просрочен.',
    '',
    '<b>Следующий шаг</b>',
    'Позвонить и назначить встречу',
    '',
    '<b>Приоритет:</b> 🔥 Высокий приоритет'
  ],
  'priority due today': [
    '⏳ <b>FINMENTOR · Требует внимания</b>',
    '',
    '<b>Vinaria Bostavan</b>',
    '',
    '<b>Срок:</b> сегодня',
    '',
    '<b>Причина</b>',
    'Нет ответа больше 24 часов.',
    '',
    '<b>Следующий шаг</b>',
    'Связаться с лидом',
    '',
    '<b>Приоритет:</b> 🕒 Требует внимания'
  ],
  'long company name': [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>Международная торгово-производственная компания Северо-Восточной Молдо…</b>',
    '',
    '<b>Приоритет:</b> 🔥 Высокий приоритет',
    '',
    '<b>Контекст</b>',
    'Связь: <b>Telegram · @longco</b>'
  ],
  'malicious HTML': [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>Alfa &lt;Grup&gt; &amp; Co &lt;b&gt;x&lt;/b&gt;</b>',
    'CFO &lt;i&gt;&amp;&lt;/i&gt; · Источник: Финансовый рентген — быстрый рентген',
    '',
    '<b>Приоритет:</b> 🔥 Высокий приоритет',
    '<b>Финансовая зона:</b> 🔴 Критическая зона',
    '',
    '<b>Запрос</b>',
    'a &lt; b &amp; c &gt; d',
    '',
    '<b>Контекст</b>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    'Связь: <b>Telegram · @alfa&lt;ceo&gt;</b>',
    '',
    '<b>Следующий шаг</b>',
    '&lt;/b&gt;&lt;u&gt;x&lt;/u&gt;'
  ],
  'missing optional fields': [
    '🔔 <b>FINMENTOR · Новый лид</b>',
    '',
    '<b>Nord</b>',
    'Источник: Финансовый рентген — расширенная анкета',
    '',
    '<b>Приоритет:</b> 🔥 Высокий приоритет',
    '',
    '<b>Запрос</b>',
    'Навести порядок в деньгах',
    '',
    '<b>Контекст</b>',
    'Связь: <b>Не указана</b>'
  ]
};

console.log('Owner cards — golden renders (owner decision 2026-09-04)');
console.log('');

// ── 1. byte-exact ──────────────────────────────────────────────────────────────────────────────

for (const name of Object.keys(GOLDEN)) {
  check('golden: ' + name, () => {
    assert(MODELS[name], 'no model for this golden');
    eq(MODELS[name](), GOLDEN[name].join('\n'), name);
  });
}

check('every model has a golden, and every golden a model', () => {
  eq(Object.keys(MODELS).sort().join('|'), Object.keys(GOLDEN).sort().join('|'), 'the two tables disagree');
  eq(Object.keys(GOLDEN).length, 8, 'the eight shapes the decision named');
});

// ── 2. the cross-cutting rules, on the same bytes ──────────────────────────────────────────────

const RENDERED = Object.keys(MODELS).map((k) => [k, MODELS[k]()]);

check('no <code> and no lead id in any body', () => {
  for (const [name, html] of RENDERED) {
    assert(html.indexOf('<code>') === -1, name + ' renders a <code> block');
    assert(html.indexOf('FIN-') === -1, name + ' renders the lead id value');
    assert(!/Lead ID|lead_id|leadId/i.test(html), name + ' names the lead id');
  }
});

check('no raw priority or zone token reaches the owner', () => {
  for (const [name, html] of RENDERED) {
    ['HOT', 'WARM', 'COLD', 'INCOMPLETE', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'UNKNOWN']
      .forEach((t) => assert(!new RegExp('(^|[^A-Za-z])' + t + '([^A-Za-z]|$)').test(html), name + ' shows the raw token ' + t));
  }
});

check('validate() returns [] for every golden', () => {
  for (const [name, html] of RENDERED) {
    const v = P.validate(html);
    eq(v.length, 0, name + ' -> ' + v.join('; '));
  }
});

check('every golden is under 1000 characters', () => {
  for (const [name, html] of RENDERED) {
    assert(html.length < 1000, name + ' is ' + html.length + ' characters');
  }
});

check('the header is the first line, with its icon, and every other line is emoji-free except the two icon lines', () => {
  const pict = /\p{Extended_Pictographic}/u;
  for (const [name, html] of RENDERED) {
    const lines = html.split('\n');
    assert(/^(🔔|⏳) <b>FINMENTOR · (Новый лид|Требует внимания)<\/b>$/u.test(lines[0]), name + ' header: ' + lines[0]);
    for (const l of lines.slice(1)) {
      const stripped = l.replace(/^<b>(Приоритет|Финансовая зона):<\/b> \p{Extended_Pictographic}️? /u, '');
      assert(!pict.test(stripped), name + ' carries an emoji outside the permitted positions: ' + l);
    }
  }
});

check('the RO marker appears on the RO lead and on no other', () => {
  for (const [name, html] of RENDERED) {
    const has = html.indexOf('Клиент: RO') !== -1;
    eq(has, name === 'new RO lead (WARM)', name + ': RO marker');
    assert(html.indexOf('Клиент: RU') === -1, name + ' states RU, which is the default and is never stated');
  }
});

// OWNER CORRECTION 2026-09-04 — no Romanian free text on the Russian console, ever.
const ROMANIAN = /[ăâîșțĂÂÎȘȚ]|\b(lips[aă]|control|asupra|fluxului|numerar|propune|administrator|proprietar|vinifica|produc[tț]ie|deficit|marja|managerial|pl[aă][tț]i)\b/i;
check('RO lead: no Romanian free text leaks into the visible Russian card (only «Клиент: RO»)', () => {
  const ro = P.renderNewLead({
    company: 'Vinaria Bostavan', role: 'Proprietar', language: 'ro',
    objective: 'Plăți haotice / deficit de numerar', situation: 'Comerț / Retail · Retail · 1–5M € · 50–100',
    priority: 'HOT', zone: 'ORANGE', nextAction: 'Propune Financial Health Check', source: 'xray_extended',
    contactChannel: 'telegram', contactValue: '@bostavan'
  });
  assert(!ROMANIAN.test(ro.replace(/Клиент: RO/g, '')), 'Romanian text leaked: ' + ro);
  assert(ro.indexOf('<b>Запрос</b>\nЗапрос клиента доступен в карточке лида CRM') !== -1, 'the request was not replaced by the neutral pointer');
  assert(ro.indexOf('Retail · 1–5 млн EUR · 50–100 сотрудников') !== -1 && ro.indexOf('Comerț') === -1 && ro.indexOf('M €') === -1, 'classified Latin/units did not survive in the owner format, or the RO label did');
  assert(ro.indexOf('См. карточку') === -1, 'the retired pointer wording survives');
  assert(ro.indexOf('Следующий шаг') === -1, 'a Romanian next step was rendered');
  assert(ro.indexOf('Proprietar') === -1, 'the Romanian role was rendered');
  eq(P.validate(ro).length, 0, 'validate: ' + P.validate(ro).join('; '));
  // A RO lead whose fields are ALREADY Russian (the RO questionnaire posts canonical Russian values)
  // renders them normally — the rule removes Romanian prose, not the RO lead's information.
  const roRu = P.renderNewLead({ company: 'UAT SRL', role: 'Собственник', language: 'ro', objective: 'Платежи хаотично / кассовые разрывы', situation: 'Retail · 1–5M €', priority: 'HOT', zone: 'ORANGE', nextAction: 'Назначить Discovery Call', source: 'xray_extended', contactChannel: 'telegram', contactValue: '@x' });
  assert(roRu.indexOf('Платежи хаотично / кассовые разрывы') !== -1 && roRu.indexOf('Собственник') !== -1 && roRu.indexOf('Назначить Discovery Call') !== -1 && roRu.indexOf('Клиент: RO') !== -1, 'Russian content of a RO lead was dropped');
});

check('every dynamic value in the hostile golden is escaped and nothing survived as markup', () => {
  const html = MODELS['malicious HTML']();
  ['<script', '<u>', '<i>', '<Grup>', '& Co', '@alfa<ceo>'].forEach((raw) => assert(html.indexOf(raw) === -1, 'raw «' + raw + '» survived'));
  const tags = (html.match(/<\/?[a-z]+>/g) || []);
  tags.forEach((t) => assert(t === '<b>' || t === '</b>', 'a tag other than <b> was emitted: ' + t));
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
}
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
