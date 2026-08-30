// FINMENTOR — Lead Alerts, the owner-facing presentation layer.
//
// ONE SOURCE OF TRUTH FOR EVERY OWNER-FACING ALERT STRING.
//
// This module renders. It does not decide. Nothing here reads the Pipeline, chooses which leads
// are overdue, or fires anything: every render function takes an already-decided model and returns
// Telegram HTML. That separation is the whole point of the pass — the alerts read like developer
// logs today, and the fix for that is presentation, so the selection logic in each workflow stays
// byte-for-byte what it is and only the last step changes.
//
// ── WHY IT LIVES IN THE REPO AND IS INLINED INTO THE CODE NODES ────────────────────────────────
//
// An n8n Code node cannot `require` a repo file, so scripts/build-lead-alerts-presentation.mjs
// inlines this source into each builder node — the same generate-rather-than-retype pattern
// app-premium/content.js already uses. qa/lead-alerts-presentation.test.mjs drives THIS file, and
// the builder refuses to emit a candidate whose inlined copy differs from it, so the gate is
// always watching the strings that actually ship.
//
// ── THE FIVE RULES ─────────────────────────────────────────────────────────────────────────────
//
//   1. An empty section is OMITTED, never rendered with a dash. A section header with nothing
//      under it is noise that costs the owner a line of reading and returns nothing.
//   2. A zero counter is OMITTED unless the message is specifically about data quality. Five lines
//      of "Overdue: 0 / No next action: 0 / No contact: 0" is the exact texture this pass exists
//      to remove.
//   3. Business and system NEVER mix. A lead digest carries no workflow names; a system alert
//      carries no lead.
//   4. Data minimisation applies even on an owner-only channel. Phone, email and free text do not
//      belong in a routine alert. The lead id is enough to open the row.
//   5. Nothing is stated as proven unless the model proves it. In particular the system alert must
//      not claim "no side effects": the n8n error payload carries no execution data at all, so
//      that sentence would be invention. See IMPACT below.

'use strict';

// ── Telegram HTML ──────────────────────────────────────────────────────────────────────────────
//
// Telegram's HTML parse mode accepts a small tag set and requires &, < and > escaped everywhere
// else. Every value that reaches a message goes through esc(); the tags are written by this file
// and never come from data. That ordering is what stops a company called "Alfa <Grup> & Co" from
// producing a 400 "can't parse entities" and silently losing the alert.
const ALLOWED_TAGS = ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler'];

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Collapse whitespace and bound the length. Owner alerts are read on a phone; a 600-character
// "main pain" paste is not a summary, it is the raw field with a label on it.
function tidy(v, max) {
  const s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!max || s.length <= max) { return s; }
  return s.slice(0, max).replace(/[\s,.;:—-]+$/, '') + '…';
}

const present = (v) => String(v === undefined || v === null ? '' : v).trim() !== '';

// One lead, one entry. A roster that lists the same company twice reads as a rendering fault
// whatever produced it, and the owner counts it twice. Identity is the lead id where there is
// one and the company name where there is not; `leadId` on a brief entry exists ONLY for this —
// it is never rendered, because B11 keeps internal ids out of the digest body.
function dedupe(items) {
  const seen = {};
  const out = [];
  for (const it of (items || [])) {
    if (!it) { continue; }
    const key = present(it.leadId) ? 'id:' + String(it.leadId).trim().toLowerCase()
      : 'co:' + String(it.company || '').trim().toLowerCase();
    if (key === 'co:') { out.push(it); continue; }   // nothing to key on; keep it rather than drop it
    if (seen[key]) { continue; }
    seen[key] = 1;
    out.push(it);
  }
  return out;
}

// ── B10. Presentation vocabulary ───────────────────────────────────────────────────────────────
//
// TWO DIMENSIONS, AND THEY ARE NOT THE SAME DIMENSION.
//
//   priority        HOT / WARM / COLD / INCOMPLETE
//                   How the OWNER should queue this lead. Derived at intake from intent,
//                   completeness and commercial signal. It is about the owner's calendar.
//
//   financial_zone  GREEN / YELLOW / ORANGE / RED
//                   What the DIAGNOSTIC said about the client's finances, from the 0–100
//                   diagnostic score. It is about the client's business.
//
// A COLD lead can be RED (a struggling company that is not ready to buy) and a HOT lead can be
// GREEN (a healthy company that wants to start on Monday). Merging them into one "status" would
// destroy information the owner uses to decide what to say in the first call, so they render as
// two separate, differently-labelled lines and never as one badge.
//
// The Russian wordings below are not new semantics. zoneLabel() in the deployed Lead Intake brief
// already says exactly these things in a longer form; this shortens them and stops there.
const PRIORITY_LABEL = {
  HOT: 'Высокий приоритет',
  WARM: 'Требует внимания',
  COLD: 'Низкий приоритет',
  INCOMPLETE: 'Нужны данные'
};

const ZONE_LABEL = {
  RED: 'Критическая зона',
  ORANGE: 'Повышенный риск',
  YELLOW: 'Есть зоны риска',
  GREEN: 'Устойчиво'
};

// An unrecognised value is NOT silently mapped to something plausible. It returns '' and the line
// is omitted, because inventing "Низкий приоритет" for a value nobody recognises is worse than
// saying nothing: the owner would act on a label the data never carried.
const SOURCE_LABEL = [
  [/xrayextended/, 'Финансовый рентген — расширенная анкета'],
  [/xrayquick/, 'Финансовый рентген — быстрый рентген'],
  [/miniscan/, 'Мини-скан оборотного капитала'],
  [/miniapp|telegram/, 'Telegram Mini App'],
  [/contact/, 'Контактная форма сайта']
];

// An unrecognised slug is NOT printed raw — «xray_extended» tells the owner nothing a label
// would not. It degrades to the one true generic statement instead.
//
// IDEMPOTENT, and that is load-bearing. The deployed Lead Intake brief has a sourceLabel of its
// own that runs BEFORE this one, so `source` can arrive already translated. Passing a Russian
// label through a slug matcher used to fall through to «Сайт FINMENTOR» and quietly destroy the
// real source — which is exactly what the live verification caught. Recognising this function's
// own output closes the class rather than the instance: every caller is now safe, including the
// ones nobody has written yet.
function sourceLabel(tool) {
  const raw = String(tool === undefined || tool === null ? '' : tool).trim();
  if (!raw) { return ''; }
  for (const [, label] of SOURCE_LABEL) { if (raw === label) { return label; } }
  const t = raw.toLowerCase().replace(/[_\s-]/g, '');
  for (const [re, label] of SOURCE_LABEL) { if (re.test(t)) { return label; } }
  return 'Сайт FINMENTOR';
}

// ── the preferred contact channel, and its value ───────────────────────────────────────────────
//
// OWNER DECISION, 2026-08-30. Not the old "print every contact we hold", and not the previous
// pass's "print no contact at all" either. ONE channel — the one the client chose — with its
// value, so the owner can act without opening the CRM, and nothing else.
//
// Phone and email are NEVER rendered together. If a future decision changes that, it changes
// here, once.
//
// Telegram is the exception that proves the rule: the bot can reach the client through the chat
// whether or not a @handle exists, so Telegram with no handle is still a usable channel and
// renders bare. A handle is never invented. Phone or email with no value is NOT reachable, so it
// renders «Не указана» rather than a label that promises a contact route the record does not have.
const CONTACT_CHANNELS = {
  telegram: 'Telegram',
  phone: 'Телефон',
  email: 'Email'
};

// Accepts the id the Mini App stores and the label the legacy intake carries, so one function
// serves both paths without either of them normalising first.
function contactChannelKey(v) {
  const t = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  if (!t) { return ''; }
  if (t.indexOf('telegram') !== -1) { return 'telegram'; }
  if (t.indexOf('email') !== -1 || t.indexOf('mail') !== -1) { return 'email'; }
  if (t.indexOf('phone') !== -1 || t.indexOf('телефон') !== -1 || t.indexOf('тел') === 0) { return 'phone'; }
  return '';
}

// Returns the rendered value for the «Связь» block. Already escaped — it is the one line in the
// system that may legitimately carry a client contact, and validate() exempts exactly this line
// and no other.
function contactLine(channel, value) {
  const key = contactChannelKey(channel);
  const v = tidy(value, 60);
  if (key === 'telegram') { return v ? 'Telegram · ' + esc(v) : 'Telegram'; }
  if (key === 'phone' && v) { return 'Телефон · ' + esc(v); }
  if (key === 'email' && v) { return 'Email · ' + esc(v); }
  // No channel, or a channel with no reachable value.
  return 'Не указана';
}

function priorityLabel(v) { return PRIORITY_LABEL[String(v || '').trim().toUpperCase()] || ''; }
function zoneLabel(v) { return ZONE_LABEL[String(v || '').trim().toUpperCase()] || ''; }

// ── dates ──────────────────────────────────────────────────────────────────────────────────────
//
// Written out rather than taken from Intl. A Code node's ICU data is not something this repo
// controls, and a digest whose date silently renders as "August 30" on one runtime and
// "30 августа" on another is not deterministic. qa asserts the table.
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Parses to Y/M/D/H/M in a fixed offset. Chisinau is UTC+3 in summer and UTC+2 in winter; the
// caller passes the offset it already computed, because the workflows already hold a timezone
// setting and this file must not become a second, disagreeing clock.
function parts(iso, offsetMinutes) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return null; }
  const t = new Date(d.getTime() + (Number(offsetMinutes) || 0) * 60000);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
    hh: String(t.getUTCHours()).padStart(2, '0'), mm: String(t.getUTCMinutes()).padStart(2, '0')
  };
}

function longDate(iso, offsetMinutes) {
  const p = parts(iso, offsetMinutes);
  return p ? p.d + ' ' + MONTHS_GEN[p.m] : '';
}

function dateTime(iso, offsetMinutes) {
  const p = parts(iso, offsetMinutes);
  return p ? p.d + ' ' + MONTHS_GEN[p.m] + ' · ' + p.hh + ':' + p.mm : '';
}

// A deadline the owner can act on without arithmetic. «просрочено на 3 дн.» is a decision;
// «Due: 2026-08-27T09:00:00.000Z» is homework.
function deadline(dueIso, nowIso, offsetMinutes) {
  const due = new Date(dueIso);
  const now = new Date(nowIso);
  if (Number.isNaN(due.getTime()) || Number.isNaN(now.getTime())) { return ''; }
  const dayOf = (d) => {
    const t = new Date(d.getTime() + (Number(offsetMinutes) || 0) * 60000);
    return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  };
  const days = Math.round((dayOf(due) - dayOf(now)) / 86400000);
  if (days === 0) { return 'сегодня'; }
  if (days === 1) { return 'завтра'; }
  if (days === -1) { return 'просрочено на 1 день'; }
  if (days < -1) { return 'просрочено на ' + (-days) + ' ' + plural(-days, 'день', 'дня', 'дней'); }
  return longDate(dueIso, offsetMinutes);
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) { return many; }
  if (b > 1 && b < 5) { return few; }
  if (b === 1) { return one; }
  return many;
}

// ── block assembly ─────────────────────────────────────────────────────────────────────────────
//
// `block` is the rule "an empty section is omitted" made structural rather than remembered. A
// caller cannot render a header with nothing under it, because a header with no surviving lines
// returns null and null is dropped.
// THE DAILY BRIEF IS A DOCUMENT; EVERY OTHER MESSAGE IS A CARD.
//
// A document has bold section headings the eye can jump between, because the owner scans it for
// the section they want. A card is read top to bottom in five seconds, and bolding both the label
// and the value there leaves nothing quiet enough to make the value stand out. So `block` bolds
// its heading and `card` does not, and the value each one wraps in <b> is the answer, not the
// question.
function assemble(heading, lines, bold) {
  const kept = (Array.isArray(lines) ? lines : [lines]).filter(present);
  if (!kept.length) { return null; }
  const h = heading ? (bold ? '<b>' + esc(heading) + '</b>' : esc(heading)) + '\n' : '';
  return h + kept.join('\n');
}
function block(heading, lines) { return assemble(heading, lines, true); }
function card(heading, lines) { return assemble(heading, lines, false); }

function join(blocks) {
  return blocks.filter((b) => present(b)).join('\n\n');
}

// «Метка: значение», dropped entirely when the value is missing.
function line(label, value) {
  return present(value) ? esc(label) + ': ' + esc(value) : '';
}

// A counter that renders only when it is worth a line. This is B11 in one function: a run of
// zeroes is not information, it is furniture. `always` is for the one anchor number a section
// would be meaningless without.
function counter(label, n, always) {
  const v = Number(n) || 0;
  if (!v && !always) { return ''; }
  return esc(label) + ': ' + v;
}

const header = (kind, sub) =>
  '<b>FINMENTOR · ' + esc(kind) + '</b>' + (present(sub) ? '\n<i>' + esc(sub) + '</i>' : '');

// ── B3. OWNER DAILY BRIEF ──────────────────────────────────────────────────────────────────────
//
// model = {
//   now, offsetMinutes,
//   counts: { active, newToday, needAttention, overdue },
//   leads:  [{ company, descriptor, priority, objective, nextAction, dueAt }],
//   moreLeads: n,
//   decisions: [ '…', '…' ]
// }
function renderDailyBrief(model) {
  const m = model || {};
  const c = m.counts || {};
  const off = m.offsetMinutes;

  const today = block('Сегодня', [
    counter('Активных лидов', c.active, true),
    counter('Новых', c.newToday),
    counter('Требуют внимания', c.needAttention),
    counter('Просрочено', c.overdue)
  ]);

  // Five, not ten. A brief the owner scrolls is a report, and a report gets read later.
  const leads = dedupe(m.leads).slice(0, 5).map((l, i) => {
    const head = (i + 1) + '. <b>' + esc(tidy(l.company, 60) || '—') + '</b>'
      + (present(l.descriptor) ? '\n' + esc(tidy(l.descriptor, 60)) : '');
    const body = [
      line('Статус', priorityLabel(l.priority)),
      line('Задача', tidy(l.objective, 90)),
      line('Следующее действие', tidy(l.nextAction, 90)),
      line('Срок', l.dueAt ? deadline(l.dueAt, m.now, off) : '')
    ].filter(present);
    return body.length ? head + '\n\n' + body.join('\n') : head;
  });
  if (leads.length && Number(m.moreLeads) > 0) {
    leads.push('<i>И ещё ' + Number(m.moreLeads) + ' в работе.</i>');
  }
  const priority = leads.length ? '<b>Приоритет</b>\n\n' + leads.join('\n\n') : null;

  // Five, like the roster. A brief that lists thirty decisions has made none of them, and forty
  // of them cleared the 4096-character limit outright — the message would not have been sent.
  const open = (m.decisions || []).filter(present);
  const decisions = block('Что требует решения',
    open.slice(0, 5).map((d) => '• ' + esc(tidy(d, 110)))
      .concat(open.length > 5 ? ['<i>И ещё ' + (open.length - 5) + '.</i>'] : []));

  const body = join([today, priority, decisions]);
  // Nothing urgent is a RESULT, and saying so plainly is worth more than a page of zeroes.
  const tail = (priority || decisions) ? '' : '<b>Критичных действий нет.</b>';
  return join([header('OWNER DAILY BRIEF', dateTime(m.now, off)), body, tail]);
}

// ── B4. NEW LEAD ───────────────────────────────────────────────────────────────────────────────
//
// model = { company, role, objective, situation, priority, zone, nextAction, source,
//           contactChannel, leadId }
//
// NO PHONE, NO EMAIL, NO FREE-TEXT PASTE. The owner opens the row to call; the alert exists to
// say whether the row is worth opening now. The contact CHANNEL is carried because it changes how
// the owner plans the callback, and the channel is not personal data.
function renderNewLead(model) {
  const m = model || {};
  const ident = '<b>' + esc(tidy(m.company, 70) || '—') + '</b>'
    + (present(m.role) ? '\n' + esc(tidy(m.role, 60)) : '');

  return join([
    header('NEW LEAD'),
    ident,
    card('Задача', present(m.objective) ? '<b>' + esc(tidy(m.objective, 120)) + '</b>' : ''),
    card('Ситуация', esc(tidy(m.situation, 220))),
    card('Приоритет', [
      present(priorityLabel(m.priority)) ? '<b>' + esc(priorityLabel(m.priority)) + '</b>' : '',
      // The second dimension, labelled so it can never be read as the first.
      line('Финансовая зона', zoneLabel(m.zone))
    ]),
    card('Следующий шаг', present(m.nextAction) ? '<b>' + esc(tidy(m.nextAction, 120)) + '</b>' : ''),
    card('Связь', '<b>' + contactLine(m.contactChannel, m.contactValue) + '</b>'),
    card(null, line('Источник', sourceLabel(m.source))),
    present(m.leadId) ? '<code>' + esc(tidy(m.leadId, 40)) + '</code>' : ''
  ]);
}

// ── B5. PRIORITY ───────────────────────────────────────────────────────────────────────────────
//
// model = { company, reason, nextAction, dueAt, now, offsetMinutes, leadId }
//
// Deliberately NOT the lead card again. The owner already received the card when the lead landed;
// repeating it here would mean re-reading everything to find the one new fact, which is why the
// deployed SLA reminder gets skimmed.
function renderPriority(model) {
  const m = model || {};
  return join([
    header('PRIORITY'),
    '<b>' + esc(tidy(m.company, 70) || '—') + '</b>',
    card('Почему требует внимания', esc(tidy(m.reason, 140))),
    card('Следующий шаг', present(m.nextAction) ? '<b>' + esc(tidy(m.nextAction, 120)) + '</b>' : ''),
    card('Срок', present(m.dueAt) ? '<b>' + esc(deadline(m.dueAt, m.now, m.offsetMinutes)) + '</b>' : ''),
    present(m.leadId) ? '<code>' + esc(tidy(m.leadId, 40)) + '</code>' : ''
  ]);
}

// ── B6. FOLLOW-UP DUE ──────────────────────────────────────────────────────────────────────────
//
// model = { now, offsetMinutes, items: [{ company, action, dueAt, leadId }] }
//
// Takes a LIST. The deployed workflow emits one message per due follow-up, so it passes one item
// and the message reads correctly for one. The day an aggregation step is approved, the same
// renderer produces the numbered list without a second template existing.
function renderFollowUp(model) {
  const m = model || {};
  const items = dedupe((m.items || []).filter((x) => x && present(x.company)));
  if (!items.length) { return ''; }   // never send an empty operational message

  const rows = items.slice(0, 10).map((it, i) => [
    (i + 1) + '. <b>' + esc(tidy(it.company, 60)) + '</b>',
    present(it.action) ? esc(tidy(it.action, 100)) : '',
    present(it.dueAt) ? 'Срок: ' + esc(deadline(it.dueAt, m.now, m.offsetMinutes)) : '',
    present(it.leadId) ? '<code>' + esc(tidy(it.leadId, 40)) + '</code>' : ''
  ].filter(present).join('\n'));

  return join([
    header('FOLLOW-UP'),
    'Просрочено: <b>' + items.length + '</b>',
    rows.join('\n\n'),
    items.length > 10 ? '<i>И ещё ' + (items.length - 10) + '.</i>' : ''
  ]);
}

// ── B1 type 5. LEAD INCOMPLETE ─────────────────────────────────────────────────────────────────
//
// model = { company, missing: ['контакт', 'согласие'], reason, source, leadId }
//
// Its own type because the owner action is different in kind: nothing here can be sold until the
// record is repaired, so it must not sit in the same queue as a lead that can be called.
// OWNER DECISION, 2026-08-30. The reason and the next step are PINNED HERE and are not taken
// from the model.
//
// The previous copy said «Форма отправлена без контакта и без согласия.» — which reads as a
// legal conclusion about consent while the Moldovan legal basis is still
// PENDING_LEGAL_REVIEW. An owner message is not the place to settle that, and a sentence the
// builder could vary is a sentence that could drift into settling it. So the message describes
// the OPERATIONAL problem only.
//
// The underlying rule is untouched: whatever blocked this lead — missing contact, missing
// consent — still blocks it, and `priority_reason` still travels in the item for the internal
// record. It simply is not restated to the owner as a finding.
function renderIncomplete(model) {
  const m = model || {};
  return join([
    header('LEAD INCOMPLETE'),
    '<b>' + esc(tidy(m.company, 70) || 'Компания не указана') + '</b>',
    card('Чего не хватает', (m.missing || []).filter(present).map((x) => '• ' + esc(tidy(x, 60)))),
    card('Причина', 'Недостаточно данных для полноценной обработки обращения.'),
    card('Следующий шаг', '<b>Проверить данные обращения вручную.</b>'),
    block(null, line('Источник', sourceLabel(m.source))),
    present(m.leadId) ? '<code>' + esc(tidy(m.leadId, 40)) + '</code>' : ''
  ]);
}

// ── B7/B8. SYSTEM ALERT ────────────────────────────────────────────────────────────────────────
//
// model = { workflowName, nodeName, errorClass, message, executionId }
//
// ── WHAT THIS MESSAGE MAY AND MAY NOT CLAIM ────────────────────────────────────────────────────
//
// n8n's error trigger delivers `{ execution: { id, url, error }, workflow: { id, name } }` and
// NOTHING ELSE — verified against execution 4240, which alerted on failure 4239. There is no
// runData, no node output, no record of which writes had already committed.
//
// So this message CANNOT say «Обращение не создано. Pipeline не изменён. Privacy-запись не
// создана.» Those three sentences would be invention dressed as a finding, and an owner who
// trusted them once would trust them the time they were wrong. What it says instead is what is
// true: the run stopped, here is where, and the consequences for stored data have not been
// checked. Making the stronger statement requires reading the failed execution back through the
// n8n API — a new capability, not a new sentence.
//
// IMPACT is derived from the workflow NAME, which the payload does carry. Each entry states what
// stopped, never what was written.
const IMPACT = [
  [/mini app|miniapp|gateway|submit|session/i, 'Заявка из Mini App не была принята.'],
  [/concierge|transport/i, 'Ответ клиенту в Telegram не был отправлен.'],
  [/lead intake/i, 'Приём заявки прерван.'],
  [/digest/i, 'Ежедневный дайджест не сформирован.'],
  [/sla/i, 'Проверка SLA не выполнена.'],
  [/followup|follow-up/i, 'Напоминания не разосланы.'],
  [/command center/i, 'Команда владельца не выполнена.']
];

function impactOf(workflowName) {
  const n = String(workflowName || '');
  for (const [re, text] of IMPACT) { if (re.test(n)) { return text; } }
  return 'Выполнение остановлено.';
}

// The tenant's naming convention is loud on purpose; the owner does not need it shouted back.
// Order matters: the bracketed tag comes off FIRST, or a name like "[CANDIDATE] FINMENTOR Mini
// App Submit" keeps its prefix because the prefix was never at the start.
function shortWorkflow(name) {
  return tidy(String(name || '')
    .replace(/\s*\[(UAT|CANDIDATE|TEMP|TEST)\]\s*/gi, ' ')
    .replace(/^\s*FINMENTOR\s+/i, '')
    .replace(/\s+(PREMIUM|FINAL|SECURE|CANDIDATE|GUARDED|AI GUARDED|v\d+)\b/gi, ''), 60);
}

// A class is worth a line only when it says more than the message already does. ERROR and a
// bare exception name say nothing an owner can act on.
const USEFUL_CLASSES = ['SHEET_LOCATOR', 'RATE_LIMIT', 'UPSTREAM_TRANSIENT', 'AUTH', 'DATA_SHAPE'];

// One human sentence for the classes that have one. This is the difference between an owner who
// knows to wait and an owner who opens n8n at midnight.
const CLASS_HINT = {
  RATE_LIMIT: 'Превышен лимит запросов к внешнему сервису.',
  UPSTREAM_TRANSIENT: 'Внешний сервис временно недоступен.',
  AUTH: 'Проблема с доступом к внешнему сервису.',
  SHEET_LOCATOR: 'Таблица или диапазон не найдены.',
  DATA_SHAPE: 'Данные пришли не в том формате.'
};

// DEFENCE IN DEPTH ON THE ONE FREE-TEXT FIELD.
//
// The Error Monitor already scrubs URLs, emails and phone numbers out of the error text before
// it reaches here, and that scrubber is untouched and asserted. This scrubs again anyway.
//
// The reason is that the workflow's scrubber protects the path it is on, and this renderer is
// reachable from anywhere a future alert path is added. An error message is the ONE field in the
// whole system produced by arbitrary code at the moment of failure, and the moment of failure is
// exactly when a payload holding a client's phone number is in scope. Scrubbing twice costs one
// pass over 200 characters; scrubbing once costs a leak the first time someone adds a second
// caller. The owner asked for no contact information in technical diagnostics, and "the other
// half already handles it" is not how that gets guaranteed.
const SCRUB_URL = /(?:[a-z][a-z0-9+.-]*:)?\/\/\S+|\bwww\.\S+/gi;
const SCRUB_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SCRUB_PHONE = /(?<![\w-])\+?\d[\d\s().-]{5,13}\d(?![\w-])/g;

function scrubContact(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(SCRUB_URL, '[ссылка удалена]')
    .replace(SCRUB_EMAIL, '[контакт удалён]')
    .replace(SCRUB_PHONE, '[контакт удалён]');
}

function renderSystemAlert(model) {
  const m = model || {};
  const cls = String(m.errorClass || '').toUpperCase();
  const useful = USEFUL_CLASSES.indexOf(cls) !== -1;
  const node = tidy(m.nodeName, 60);

  return join([
    header('SYSTEM ALERT'),

    // The headline is the business consequence, not the exception. It is derived from the
    // workflow name, which the payload carries, and it states only that the work did not finish.
    '<b>' + esc(impactOf(m.workflowName)) + '</b>',

    card('Влияние', [
      'Операция не завершена.',
      present(node) ? 'Сбой на этапе «' + esc(node) + '».' : '',
      useful && CLASS_HINT[cls] ? esc(CLASS_HINT[cls]) : ''
    ]),

    // The one place this message could lie, and does not. See the note above IMPACT.
    card('Данные', [
      'Последствия для записей автоматически не проверены.',
      'Лид, Pipeline и privacy-запись нужно проверить вручную.'
    ]),

    card('Статус', '<b>Требует проверки</b>'),

    // Quiet, last, and small. Everything an engineer needs to open the execution; nothing an
    // owner has to read to decide whether to care.
    block(null, [
      '<i>Технические данные</i>',
      line('Workflow', shortWorkflow(m.workflowName)),
      line('Node', node),
      useful ? line('Класс', cls) : '',
      present(m.executionId) ? 'Execution: <code>' + esc(tidy(m.executionId, 20)) + '</code>' : '',
      line('Сообщение', tidy(scrubContact(m.message), 200))
    ])
  ]);
}

// ── B9. SYSTEM RECOVERED ───────────────────────────────────────────────────────────────────────
//
// The copy exists. THE TRIGGER DOES NOT, AND IS NOT CREATED BY THIS PASS.
//
// n8n's error trigger fires on failure and has no counterpart that fires when a workflow starts
// succeeding again. Closing an alert would need an open-incident store plus a scheduled poller
// that reads /executions for the workflows currently marked open — new state and a new trigger,
// which is a business-rule change this pass is explicitly not making. Rendered here so the copy is
// reviewed with the rest, and left unwired so nothing can send it on a signal that does not exist.
//
// model = { problem, evidence }
function renderSystemRecovered(model) {
  const m = model || {};
  return join([
    header('SYSTEM RECOVERED'),
    '<b>' + esc(tidy(m.problem, 120) || 'Сбой устранён.') + '</b>',
    'Работа восстановлена.',
    card('Проверено', esc(tidy(m.evidence, 200))),
    '<i>Действий не требуется.</i>'
  ]);
}

// ── B1 type 8. DATA / INTEGRITY WARNING ────────────────────────────────────────────────────────
//
// Also unwired. Nothing in the tenant fires on data quality today: the counters exist only as five
// lines buried in the daily digest, which is precisely the noise B11 asks to remove. Giving them
// their own message needs a trigger, and a trigger is a rule change.
//
// This is the ONE message where a zero may be rendered — a data-quality report that hides its
// zeroes cannot tell the owner the data is clean.
//
// model = { items: [{ label, count }], checkedAt, offsetMinutes }
function renderDataIntegrity(model) {
  const m = model || {};
  const items = (m.items || []).filter((x) => x && present(x.label));
  const nonZero = items.filter((x) => Number(x.count) > 0);
  return join([
    header('DATA / INTEGRITY WARNING', dateTime(m.checkedAt, m.offsetMinutes)),
    nonZero.length
      ? card('Требует исправления', nonZero.map((x) => '• ' + esc(x.label) + ': <b>' + Number(x.count) + '</b>'))
      : '<b>Данные в порядке.</b>',
    nonZero.length ? card('Статус', '<b>Требует проверки</b>') : ''
  ]);
}

// ── the gate's own helper ──────────────────────────────────────────────────────────────────────
//
// Structural validation of a rendered message, used by qa/lead-alerts-presentation.test.mjs. It is
// exported rather than duplicated in the test so the definition of "valid" has one home.
//
// Returns [] for a clean message, or a list of problems.
// The section headings this module can emit. validate() checks emptiness against THIS list rather
// than guessing from shape: «<b>Статус</b>» is a heading and «<b>Требует проверки</b>» is the value
// under it, and no amount of pattern-matching on bold text can tell those apart.
const HEADINGS = ['Сегодня', 'Приоритет', 'Что требует решения', 'Задача', 'Ситуация',
  'Следующий шаг', 'Следующее действие', 'Почему требует внимания', 'Срок', 'Чего не хватает',
  'Причина', 'Влияние', 'Данные', 'Статус', 'Проверено', 'Требует исправления', 'Связь'];

const SECRET_PATTERNS = [
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/, 'a Telegram bot token'],
  [/init[_ ]?data|query_id=|auth_date=/i, 'initData'],
  [/\bpassword\b|\bpasswd\b|\bsecret\b|\bapi[_ ]?key\b|\bbearer\b/i, 'a credential word'],
  [/\bat [A-Za-z]+ \(|\n\s+at .+:\d+:\d+|node_modules/i, 'a stack trace'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'an email address'],
  [/(?<![\w-])\+?\d[\d\s().-]{8,13}\d(?![\w-])/, 'a phone-shaped number']
];

function validate(html) {
  const problems = [];
  const s = String(html === undefined || html === null ? '' : html);
  if (!s.trim()) { return ['the message is empty']; }

  // 1. Telegram HTML: known tags only, each one closed, and no stray angle brackets.
  const tags = s.match(/<\/?[^>]*>/g) || [];
  const stack = [];
  for (const t of tags) {
    const m = /^<(\/?)([a-zA-Z-]+)[^>]*>$/.exec(t);
    if (!m) { problems.push('malformed tag ' + t); continue; }
    const name = m[2].toLowerCase();
    if (ALLOWED_TAGS.indexOf(name) === -1) { problems.push('tag <' + name + '> is not valid Telegram HTML'); continue; }
    if (m[1]) {
      if (stack.pop() !== name) { problems.push('</' + name + '> does not close the open tag'); }
    } else { stack.push(name); }
  }
  if (stack.length) { problems.push('unclosed tag <' + stack[stack.length - 1] + '>'); }
  // Anything angle-bracketed that is not a tag must have been escaped.
  const withoutTags = s.replace(/<\/?[^>]*>/g, '');
  if (/[<>]/.test(withoutTags)) { problems.push('an unescaped < or > survived into the text'); }

  // 2. No Markdown mixed into HTML. Telegram parses one or the other, never both.
  if (/\*\*|__|\[[^\]]+\]\([^)]+\)/.test(withoutTags)) { problems.push('Markdown syntax is mixed into HTML'); }

  // 3. No empty section: a bold heading with nothing under it, or a label with no value.
  const lines = s.split('\n');
  const headingOf = (l) => {
    const t = String(l).trim();
    const m2 = /^<b>([^<]+)<\/b>$/.exec(t);
    const name = m2 ? m2[1] : t;
    return HEADINGS.indexOf(name) !== -1 ? name : null;
  };
  for (let i = 0; i < lines.length; i++) {
    const h = headingOf(lines[i]);
    if (h) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) { j++; }
      const next = (lines[j] || '').trim();
      if (!next || headingOf(next)) { problems.push('empty section: ' + h); }
    }
    if (/^[^:<]+:\s*$/.test(lines[i])) { problems.push('label with no value: ' + lines[i].trim()); }
    if (/:\s*(—|-|n\/a|null|undefined)\s*$/i.test(lines[i])) { problems.push('placeholder value: ' + lines[i].trim()); }
  }

  // 4. No zero-only noise. One zero is a fact; three in a row is furniture.
  const zeros = lines.filter((l) => /^[^:]+:\s*0\s*$/.test(l.trim()));
  if (zeros.length > 1) { problems.push(zeros.length + ' zero-valued counter lines'); }

  // 5. Nothing that must never leave the tenant.
  //
  // ONE EXEMPTION, AND IT IS NARROW. The «Связь» value in a NEW LEAD alert is the single place a
  // client contact may appear, by owner decision. It is exempted from the contact patterns — and
  // only from those two — and only one such line may exist. Everything else in the message,
  // including the technical block of a system alert, is scanned as before.
  const contactValues = lines.filter((l, i) => headingOf(lines[i - 1]) === 'Связь').map((l) => l.trim());
  if (contactValues.length > 1) { problems.push(contactValues.length + ' «Связь» lines — a message may carry at most one contact'); }
  let scanned = withoutTags;
  for (const cv of contactValues) {
    scanned = scanned.split(cv.replace(/<\/?[^>]*>/g, '')).join(' ');
  }
  for (const [re, what] of SECRET_PATTERNS) {
    const contactPattern = /email address|phone-shaped/.test(what);
    if (re.test(contactPattern ? scanned : withoutTags)) { problems.push('the message contains ' + what); }
  }

  // 6. Telegram's own limit, with room for the caption Telegram adds on some paths.
  if (s.length > 4000) { problems.push('the message is ' + s.length + ' characters, over the 4096 limit'); }

  return problems;
}

module.exports = {
  ALLOWED_TAGS, PRIORITY_LABEL, ZONE_LABEL, MONTHS_GEN, IMPACT, USEFUL_CLASSES, CLASS_HINT,
  esc, tidy, present, plural, priorityLabel, zoneLabel,
  parts, longDate, dateTime, deadline, block, card, join, line, counter, header, HEADINGS,
  impactOf, shortWorkflow, sourceLabel, SOURCE_LABEL, validate, dedupe, scrubContact,
  CONTACT_CHANNELS, contactChannelKey, contactLine,
  renderDailyBrief, renderNewLead, renderPriority, renderFollowUp, renderIncomplete,
  renderSystemAlert, renderSystemRecovered, renderDataIntegrity
};
