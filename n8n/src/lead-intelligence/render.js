// FINMENTOR Lead Intelligence v1 — premium owner memo and exact client preview renderer.
'use strict';

const LI = require('./contract.js');

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function present(v) { return String(v === undefined || v === null ? '' : v).trim() !== ''; }
function arr(v) { return Array.isArray(v) ? v : []; }
function p(v, cls) { return present(v) ? '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</p>' : ''; }
function list(v, fn, cls) { const x = arr(v); return x.length ? '<div class="' + (cls || 'list') + '">' + x.map(fn).join('') + '</div>' : '<p class="empty">Не указано</p>'; }
function statusLabel(value) {
  const labels = {
    AI_DRAFT: 'Черновик FINMENTOR', OWNER_REVIEW: 'Проверка владельцем', OWNER_EDITED: 'Отредактировано',
    CLIENT_READY: 'Доступно клиенту', CLIENT_NOTIFIED: 'Клиент уведомлён', CLIENT_VIEWED: 'Клиент открыл',
    ANALYSIS_FAILED: 'Не сформировано'
  };
  return labels[String(value || '')] || 'В работе';
}
function sourceLabel(value) {
  const s = String(value || '');
  if (/website_xray|xray/i.test(s)) return 'Financial X-Ray';
  if (/telegram_premium|miniapp/i.test(s)) return 'Mini App';
  if (/both/i.test(s)) return 'Financial X-Ray + Mini App';
  return s || 'Источник не определён';
}
function zoneLabel(value) {
  return ({ GREEN: 'Устойчивая зона', YELLOW: 'Требует внимания', ORANGE: 'Существенные пробелы', RED: 'Критическая зона', UNKNOWN: 'Без оценки' })[String(value || '').toUpperCase()] || 'Без оценки';
}
function provenanceLabel(kind) {
  return ({
    CLIENT_FACT: 'КЛИЕНТ ГОВОРИТ', FINMENTOR_INTERPRETATION: 'FINMENTOR ВИДИТ',
    NEEDS_VERIFICATION: 'НУЖНО ПРОВЕРИТЬ', OWNER_CONFIRMED_FACT: 'ПОДТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ',
    OWNER_NOTE: 'ЗАМЕТКА ВЛАДЕЛЬЦА'
  })[kind] || '';
}
function field(name, value, label, opts) {
  const o = opts || {}; const tag = o.multiline === false ? 'input' : 'textarea';
  const control = tag === 'textarea'
    ? '<textarea name="' + esc(name) + '" rows="' + (o.rows || 4) + '" maxlength="' + (o.max || 4000) + '">' + esc(value) + '</textarea>'
    : '<input name="' + esc(name) + '" value="' + esc(value) + '" maxlength="' + (o.max || 300) + '">';
  return '<label class="edit-field"><span>' + esc(label) + '</span>' + control + (o.hint ? '<small>' + esc(o.hint) + '</small>' : '') + '</label>';
}
function authInputs(auth, action) {
  const a = auth || {};
  return '<input type="hidden" name="a" value="' + esc(a.analysis_id) + '">'
    + '<input type="hidden" name="t" value="' + esc(a.token) + '">'
    + '<input type="hidden" name="action" value="' + esc(action) + '">';
}
function asText(items, fn) { return arr(items).map(fn || ((x) => x)).filter(present).join('\n'); }

const SHELL_CSS = `
:root{--navy:#091626;--navy2:#10233a;--ink:#142233;--muted:#66717e;--paper:#f7f3eb;--white:#fffdf8;--gold:#ae8a47;--gold2:#d6c49c;--line:#dcd5c7;--fact:#315d70;--verify:#8f5c27;--ok:#325e4d;--danger:#86443f;--shadow:0 24px 70px rgba(8,20,36,.14)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#e8e5df;color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.58}button,input,textarea,select{font:inherit}a{color:inherit}.topbar{height:54px;background:var(--navy);color:#f5efe1;display:flex;align-items:center;justify-content:space-between;padding:0 30px;letter-spacing:.04em}.brand{font-family:Georgia,serif;font-weight:700;letter-spacing:.14em}.topstate{font-size:12px;color:#d6c49c;text-transform:uppercase}.paper{max-width:1100px;margin:26px auto 70px;background:var(--paper);box-shadow:var(--shadow);min-height:900px}.hero{background:var(--navy);color:#fff;padding:46px 58px 38px;border-top:3px solid var(--gold)}.eyebrow,.section-no,.kind,.micro,.edit-field>span{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.eyebrow{color:var(--gold2)}h1{font-family:Georgia,"Times New Roman",serif;font-size:42px;line-height:1.06;margin:13px 0 9px;font-weight:600}.identity{font-size:17px;color:#e1ded6;margin:0 0 28px}.hero-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px;border-top:1px solid rgba(214,196,156,.34);padding-top:22px}.hero-cell .micro{color:#aeb7c2}.hero-cell strong{display:block;font-size:14px;margin-top:5px;font-weight:600}.hero-contact{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:26px;padding-top:22px;border-top:1px solid rgba(214,196,156,.2)}.hero-contact p{margin:3px 0;color:#e8e2d5;font-size:14px}.warn{color:#e0b87a!important}.memo{max-width:820px;margin:0 auto;padding:52px 54px 70px}.section{display:grid;grid-template-columns:74px 1fr;gap:18px;padding:37px 0;border-top:1px solid var(--line)}.section:first-child{border-top:0;padding-top:4px}.section-no{color:var(--gold);padding-top:8px}.section h2{font-family:Georgia,serif;font-size:26px;line-height:1.2;margin:0 0 21px;font-weight:600}.kind{display:inline-block;margin-bottom:8px}.kind.fact{color:var(--fact)}.kind.interpretation{color:var(--gold)}.kind.verify{color:var(--verify)}.fact-row{padding:0 0 18px;margin:0 0 18px;border-bottom:1px solid #e5ded2}.fact-row:last-child{border:0;margin-bottom:0}.fact-row h3,.diagnosis h3,.pain h3{font-size:13px;margin:0 0 6px;color:#53606e}.fact-row p,.diagnosis p,.pain p{margin:0;font-size:16px}.diagnosis{padding:0 0 23px;margin:0 0 23px;border-bottom:1px solid #e5ded2}.diagnosis:last-child{border:0}.evidence{margin-top:9px!important;font-size:12px!important;color:var(--muted)}.hypothesis{margin-top:9px!important;color:#39495c}.pain-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pain{background:var(--white);padding:22px;border-left:2px solid var(--gold)}.pain .attention{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--verify);margin-bottom:11px}.why{color:var(--muted);font-size:14px!important;margin-top:9px!important}.unknown{display:grid;grid-template-columns:24px 1fr;gap:12px;margin:0 0 18px}.unknown .mark{font-family:Georgia,serif;color:var(--verify);font-size:20px}.unknown strong{display:block;font-size:15px}.unknown p{margin:3px 0 0;color:var(--muted);font-size:14px}.statement{font-family:Georgia,serif;font-size:23px;line-height:1.45;border-left:3px solid var(--gold);padding:6px 0 6px 22px;margin:0}.opening{background:var(--navy2);color:#fbf7ed;padding:28px 30px;font-family:Georgia,serif;font-size:21px;line-height:1.5}.question{display:grid;grid-template-columns:33px 1fr;gap:14px;padding:0 0 21px;margin-bottom:21px;border-bottom:1px solid var(--line)}.question:last-child{border:0}.qno{font-family:Georgia,serif;color:var(--gold);font-size:19px}.question strong{display:block;font-size:16px}.question p{margin:7px 0 0;color:var(--muted);font-size:13px}.solution{background:#eee8dc;padding:27px 29px}.solution-row{margin:0 0 19px}.solution-row:last-child{margin:0}.solution-row .micro{color:#7c6a48}.solution-row p{margin:5px 0 0}.conditions{margin:6px 0 0;padding-left:19px}.decision{display:grid;grid-template-columns:1fr 1fr;gap:23px}.decision>div{padding-top:14px;border-top:2px solid var(--gold)}.decision strong{font-size:15px}.decision p{margin:5px 0;color:var(--muted)}.owner-note{background:#e9ede8;border-left:3px solid var(--ok);padding:17px 20px;margin-bottom:12px}.owner-note p{margin:4px 0}.details{border-top:1px solid var(--line);padding:18px 0}.details summary{cursor:pointer;font-weight:700;list-style:none;display:flex;justify-content:space-between}.details summary:after{content:"+";color:var(--gold);font-size:20px}.details[open] summary:after{content:"−"}.details-body{padding:17px 0;color:var(--muted)}.actionsbar{position:sticky;bottom:0;background:rgba(247,243,235,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;padding:14px 26px;z-index:4}.btn{border:1px solid var(--navy);background:transparent;color:var(--navy);padding:10px 17px;text-decoration:none;font-weight:700;cursor:pointer}.btn.primary{background:var(--navy);color:#fff}.btn.gold{background:var(--gold);border-color:var(--gold);color:#fff}.btn.ghost{border-color:transparent}.capture,.editor,.preview{background:var(--white);padding:32px;margin:20px 0}.capture h2,.editor h2,.preview h2{font-family:Georgia,serif;font-size:26px;margin-top:0}.choice-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:24px}.choice{display:flex;gap:9px;align-items:flex-start;border:1px solid var(--line);padding:12px;background:#fff}.choice input{margin-top:5px}.edit-field{display:block;margin:0 0 18px}.edit-field>span{display:block;color:#5b6672;margin-bottom:7px}.edit-field textarea,.edit-field input,.edit-field select,select{width:100%;border:1px solid #cfc6b7;background:#fffdf8;padding:11px 12px;color:var(--ink)}.edit-field small{display:block;color:var(--muted);margin-top:4px}.form-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.client-sheet{background:white;max-width:690px;margin:0 auto;padding:44px;box-shadow:0 12px 35px rgba(10,20,30,.09)}.client-sheet .client-brand{color:var(--gold);letter-spacing:.15em;font-size:12px;font-weight:800}.client-sheet h2{font-family:Georgia,serif;font-size:32px;margin:8px 0}.client-score{font-size:13px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:20px}.client-sheet h3{font-family:Georgia,serif;margin:27px 0 10px}.client-sheet p,.client-sheet li{font-size:15px}.client-risk{padding:15px 0;border-bottom:1px solid #eee}.contact-panel{background:var(--white);padding:30px}.contact-route{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.contact-route span{color:var(--muted)}.empty{color:var(--muted);font-style:italic}.screen-note{text-align:center;color:var(--muted);padding:50px}.toast{max-width:720px;margin:40px auto;background:var(--white);padding:30px;border-top:3px solid var(--gold)}
@media(max-width:760px){.topbar{padding:0 16px}.paper{margin:0;box-shadow:none}.hero{padding:32px 22px 28px}.hero h1{font-size:34px}.hero-grid{grid-template-columns:1fr 1fr;gap:16px}.hero-contact{grid-template-columns:1fr;gap:14px}.memo{padding:34px 20px 90px}.section{display:block;padding:31px 0}.section-no{margin-bottom:8px}.section h2{font-size:24px}.pain-grid,.decision,.choice-grid{grid-template-columns:1fr}.opening{padding:23px 21px;font-size:19px}.statement{font-size:21px}.actionsbar{position:fixed;left:0;right:0;padding:10px 12px;justify-content:stretch}.actionsbar .btn{flex:1;text-align:center;padding:11px 7px;font-size:13px}.capture,.editor,.preview,.contact-panel{padding:22px;margin-left:-2px;margin-right:-2px}.client-sheet{padding:26px 20px}.contact-route{grid-template-columns:1fr;gap:1px}h1{font-size:34px}}
@media print{body{background:#fff}.topbar,.actionsbar,.capture{display:none}.paper{margin:0;box-shadow:none}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}.memo{padding-bottom:0}}
`;

function shell(title, state, body, actions, lang) {
  return '<!doctype html><html lang="' + (lang === 'ro' ? 'ro' : 'ru') + '"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + '<title>' + esc(title) + '</title><style>' + SHELL_CSS + '</style></head><body>'
    + '<header class="topbar"><div class="brand">FINMENTOR</div><div class="topstate">' + esc(state) + '</div></header>'
    + body + (actions || '') + '</body></html>';
}

function renderContact(contact, auth, company, state) {
  const c = contact || {}; const routes = arr(c.reachable_channels);
  const phone = routes.find((x) => (x.channel || x.key) === 'phone');
  const email = routes.find((x) => (x.channel || x.key) === 'email');
  const telegramReady = !!(c.telegram && c.telegram.reachable && c.telegram.verified && c.telegram.route);
  const direct = '<div class="form-actions">'
    + (phone ? '<a class="btn" href="tel:' + esc(String(phone.value).replace(/[^+\d]/g, '')) + '">Позвонить</a>' : '')
    + (email ? '<a class="btn" href="mailto:' + esc(email.value) + '">Написать email</a>' : '') + '</div>';
  const telegram = telegramReady && auth
    ? '<div class="capture"><div class="kind interpretation">ПОДТВЕРЖДЁННЫЙ TELEGRAM</div><h2>Сообщение клиенту</h2><p>Сначала откроется предпросмотр. Отправка потребует отдельного подтверждения.</p><form method="post">' + authInputs(auth, 'preview_outbound') + field('outbound_message', 'Здравствуйте! Это FINMENTOR. Предлагаю согласовать следующий шаг по вашему финансовому разбору.', 'Текст сообщения', { rows: 4, max: 1200 }) + '<button class="btn primary" type="submit">Предпросмотр сообщения</button></form></div>'
    : '';
  const manual = state === 'CLIENT_READY' && auth && !telegramReady
    ? '<div class="capture"><div class="kind fact">РУЧНОЕ УВЕДОМЛЕНИЕ</div><h2>Клиент уведомлён вручную</h2><form method="post">' + authInputs(auth, 'manual_notify') + '<label class="edit-field"><span>Канал</span><select name="notification_channel" required><option value="">Выберите</option><option value="phone">Телефон</option><option value="email">Email</option><option value="telegram">Telegram</option></select></label><button class="btn primary" type="submit">Зафиксировать</button></form></div>'
    : '';
  return '<div class="contact-panel"><div class="kind fact">КЛИЕНТ ГОВОРИТ</div><h2>Предпочтительно: ' + esc(c.preferred_label || 'Не указано') + '</h2>'
    + (c.preferred_contact_channel === 'telegram' && !(c.telegram && c.telegram.reachable) ? '<p class="warn">⚠️ Telegram-контакт не подключён</p>' : '')
    + '<div class="kind fact">ДОСТУПНО</div>'
    + (routes.length ? routes.map((x) => '<div class="contact-route"><span>' + esc(x.label) + '</span><strong>' + esc(x.value) + '</strong></div>').join('') : '<p class="empty">Нет подтверждённого канала связи.</p>')
    + direct + telegram + manual + '</div>';
}

function renderClientPreview(client, row) {
  const c = client || {}; const fm = c.financial_maturity || {};
  return '<div class="client-sheet"><div class="client-brand">FINMENTOR</div><h2>Финансовый разбор</h2>'
    + '<div class="client-score">' + (row.score === '' || row.score == null ? 'Без оценки' : esc(row.score) + ' / 100') + ' · ' + esc(zoneLabel(row.zone)) + '</div>'
    + '<h3>Краткий вывод</h3>' + p(c.executive_summary)
    + '<h3>Зрелость финансового управления</h3>' + p(fm.rationale)
    + '<h3>Ключевые риски</h3>' + list(c.key_risks, (r) => '<div class="client-risk"><strong>' + esc(r.title) + '</strong>' + p(r.potential_impact) + '</div>')
    + '<h3>Приоритеты управления</h3><ol>' + arr(c.management_priorities).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol>'
    + '<h3>План на 30 дней</h3>' + ['days_1_7','days_8_14','days_15_21','days_22_30'].map((w) => '<div class="client-risk"><strong>' + esc(({days_1_7:'Дни 1–7',days_8_14:'Дни 8–14',days_15_21:'Дни 15–21',days_22_30:'Дни 22–30'})[w]) + '</strong><ul>' + arr((c.plan_30_days || {})[w]).map((x) => '<li>' + esc(x.action || x) + '</li>').join('') + '</ul></div>').join('')
    + '<h3>Что сделать сейчас</h3><ul>' + arr(c.tomorrow_actions).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
    + '<h3>Рекомендация FINMENTOR</h3>' + p((c.recommended_next_step || {}).label, 'recommend') + p((c.recommended_next_step || {}).rationale)
    + '</div>';
}

function renderEditor(client, auth) {
  const c = client || {}; const fm = c.financial_maturity || {}; const plan = c.plan_30_days || {};
  return '<div class="editor"><div class="kind interpretation">КЛИЕНТСКАЯ ВЕРСИЯ</div><h2>Редактирование результата</h2><p>Изменяются только клиентские формулировки. Оценка, зона и исходные ответы заблокированы.</p>'
    + '<form method="post">' + authInputs(auth, 'save_client_draft')
    + field('executive_summary', c.executive_summary, 'Краткий вывод', { rows: 6 })
    + field('maturity_rationale', fm.rationale, 'Объяснение зрелости', { rows: 4 })
    + field('key_risks', asText(c.key_risks, (x) => [x.title, x.evidence, x.potential_impact].filter(present).join(' | ')), 'Ключевые риски', { rows: 7, hint: 'Один риск на строку: название | основание | последствие' })
    + field('management_priorities', asText(c.management_priorities), 'Приоритеты управления', { rows: 4, hint: 'Один приоритет на строку' })
    + field('plan_days_1_7', asText(plan.days_1_7, (x) => x.action || x), 'План · дни 1–7', { rows: 4 })
    + field('plan_days_8_14', asText(plan.days_8_14, (x) => x.action || x), 'План · дни 8–14', { rows: 4 })
    + field('plan_days_15_21', asText(plan.days_15_21, (x) => x.action || x), 'План · дни 15–21', { rows: 4 })
    + field('plan_days_22_30', asText(plan.days_22_30, (x) => x.action || x), 'План · дни 22–30', { rows: 4 })
    + field('tomorrow_actions', asText(c.tomorrow_actions), 'Действия сейчас', { rows: 4 })
    + field('recommendation_label', (c.recommended_next_step || {}).label, 'Название рекомендации', { rows: 2 })
    + field('recommendation_rationale', (c.recommended_next_step || {}).rationale, 'Обоснование рекомендации', { rows: 4 })
    + '<div class="form-actions"><button class="btn primary" type="submit">Сохранить</button><a class="btn" href="?a=' + esc(auth.analysis_id) + '&amp;t=' + esc(auth.token) + '&amp;view=preview">Предпросмотр клиента</a></div></form></div>';
}

function renderCapture(auth) {
  const outcomes = [
    ['PROBLEM_CONFIRMED','Проблема подтверждена'],['HYPOTHESIS_CHANGED','Гипотеза изменилась'],
    ['MORE_DATA_NEEDED','Нужно больше данных'],['NO_TASK_NOW','Нет задачи сейчас'],['READY_TO_DISCUSS','Готов обсуждать работу']
  ];
  return '<div class="capture" id="after-call"><div class="kind interpretation">ПОСЛЕ ЗВОНКА · ДО 60 СЕКУНД</div><h2>Зафиксировать разговор</h2><form method="post">' + authInputs(auth, 'after_call')
    + '<div class="choice-grid">' + outcomes.map(([v,l]) => '<label class="choice"><input type="radio" name="conversation_outcome" value="' + v + '" required><span>' + esc(l) + '</span></label>').join('') + '</div>'
    + field('confirmed', '', 'Что подтвердилось?', { rows: 3, max: 1200 })
    + field('changed', '', 'Что оказалось иначе?', { rows: 3, max: 1200 })
    + field('next_step_and_date', '', 'Следующий шаг + дата', { rows: 2, max: 800, hint: 'Например: получить ageing дебиторки — 15.09.2026' })
    + '<button class="btn primary" type="submit">Сохранить разговор</button></form></div>';
}

function renderOutboundConfirm(preview, auth) {
  const p0 = preview || {};
  return '<article class="paper"><main class="memo"><div class="preview"><div class="kind verify">ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ</div><h2>Отправить ' + esc(p0.recipient || 'клиенту') + '?</h2><div class="opening">' + esc(p0.message) + '</div><form method="post">' + authInputs(auth, 'send_outbound') + '<textarea name="outbound_message" hidden>' + esc(p0.message) + '</textarea><div class="form-actions"><button class="btn gold" type="submit">Подтвердить</button><a class="btn" href="?a=' + encodeURIComponent((auth || {}).analysis_id || '') + '&amp;t=' + encodeURIComponent((auth || {}).token || '') + '&amp;view=contact">Отмена</a></div></form></div></main></article>';
}

function renderBriefBody(brief, row, auth) {
  const b = brief || {}; const h = b.header || {}; const c = b.contact || {};
  const factNames = Object.fromEntries(arr(b.client_facts).map((f) => [f.id, f.label]));
  const evidence = (ids) => arr(ids).map((id) => factNames[id]).filter(Boolean).join(' · ');
  const reachableSummary = arr(c.reachable_channels).map((x) => x.label).join(', ') || 'Нет подтверждённых каналов';
  const hero = '<article class="paper"><header class="hero"><div class="eyebrow">Lead Intelligence · конфиденциально</div><h1>' + esc(h.company || 'Компания не указана') + '</h1>'
    + '<p class="identity">' + esc([h.contact_name, h.role].filter(present).join(' · ') || 'Контакт не указан') + '</p>'
    + '<div class="hero-grid">'
    + '<div class="hero-cell"><span class="micro">Бизнес</span><strong>' + esc([h.business,h.scale].filter(present).join(' · ') || 'Не указано') + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Источник</span><strong>' + esc(sourceLabel(h.source)) + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Статус</span><strong>' + esc(h.lead_status || statusLabel(row.review_status)) + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Качество данных</span><strong>' + esc(h.data_quality || 'Требует проверки') + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Коммерческий интерес</span><strong>' + esc(h.commercial_intent || 'Не подтверждён') + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Финансовая оценка</span><strong>' + (h.diagnostic_score == null ? 'Без оценки' : esc(h.diagnostic_score) + ' / 100') + ' · ' + esc(zoneLabel(h.financial_zone)) + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Следующее действие</span><strong>' + esc(h.next_action || 'Нужно определить') + '</strong></div>'
    + '<div class="hero-cell"><span class="micro">Срок</span><strong>' + esc(h.next_action_date || 'Не назначен') + '</strong></div></div>'
    + '<div class="hero-contact"><div><span class="micro">Предпочтительно</span><p>' + esc(c.preferred_label || 'Не указано') + '</p>' + (c.preferred_contact_channel === 'telegram' && !(c.telegram && c.telegram.reachable) ? '<p class="warn">⚠️ Telegram-контакт не подключён</p>' : '') + '</div><div><span class="micro">Фактически доступно</span><p>' + esc(reachableSummary) + '</p></div></div></header>';

  const notes = arr(b.owner_confirmed_facts).map((x) => '<div class="owner-note"><div class="kind">' + provenanceLabel('OWNER_CONFIRMED_FACT') + '</div>' + p(x.text || x.value) + '</div>').join('')
    + arr(b.owner_notes).map((x) => '<div class="owner-note"><div class="kind">' + provenanceLabel('OWNER_NOTE') + '</div>' + p(x.text || x.value) + '</div>').join('');

  const body = '<main class="memo">' + (notes ? '<section>' + notes + '</section>' : '')
    + '<section class="section"><div class="section-no">01</div><div><div class="kind fact">КЛИЕНТ ГОВОРИТ</div><h2>Что говорит клиент</h2>'
    + list(b.client_facts, (f) => '<div class="fact-row" data-kind="CLIENT_FACT"><h3>' + esc(f.label) + '</h3>' + p(f.value) + '</div>') + '</div></section>'
    + '<section class="section"><div class="section-no">02</div><div><div class="kind interpretation">FINMENTOR ВИДИТ</div><h2>Диагноз FINMENTOR</h2>'
    + list(b.diagnoses, (d) => '<div class="diagnosis" data-kind="FINMENTOR_INTERPRETATION"><h3>Профессиональный вывод</h3>' + p(d.conclusion) + (d.hypothesis ? p('Гипотеза: ' + d.hypothesis, 'hypothesis') : '') + (d.economic_implication ? p(d.economic_implication, 'why') : '') + (evidence(d.evidence_fact_ids) ? p('Основание: ' + evidence(d.evidence_fact_ids), 'evidence') : '') + '</div>') + '</div></section>'
    + '<section class="section"><div class="section-no">03</div><div><div class="kind interpretation">FINMENTOR ВИДИТ</div><h2>Карта боли</h2><div class="pain-grid">'
    + arr(b.pain_map).map((x) => '<article class="pain"><div class="attention">' + esc(x.attention) + '</div><h3>' + esc(x.area) + '</h3>' + p(x.observation) + p('Почему важно: ' + x.consequence, 'why') + '</article>').join('') + '</div></div></section>'
    + '<section class="section"><div class="section-no">04</div><div><div class="kind verify">НУЖНО ПРОВЕРИТЬ</div><h2>Что нужно проверить</h2>'
    + list(b.unknowns, (u, i) => '<div class="unknown" data-kind="NEEDS_VERIFICATION"><div class="mark">?</div><div><strong>' + esc(u.item) + '</strong>' + p(u.why) + '</div></div>') + '</div></section>'
    + '<section class="section"><div class="section-no">05</div><div><div class="kind interpretation">РЕШЕНИЕ ДЛЯ ВСТРЕЧИ</div><h2>Цель первой встречи</h2><p class="statement">' + esc(b.first_meeting_objective) + '</p></div></section>'
    + '<section class="section"><div class="section-no">06</div><div><div class="kind interpretation">ПЕРВЫЕ 30 СЕКУНД</div><h2>Как начать разговор</h2><div class="opening">“' + esc(b.conversation_opening) + '”</div></div></section>'
    + '<section class="section"><div class="section-no">07</div><div><div class="kind interpretation">ЛОГИКА ДИАГНОСТИКИ</div><h2>Вопросы первой встречи</h2>'
    + arr(b.discovery_questions).map((q, i) => '<div class="question"><div class="qno">' + String(i + 1).padStart(2, '0') + '</div><div><strong>' + esc(q.question) + '</strong><p><b>Зачем:</b> ' + esc(q.why) + '</p></div></div>').join('') + '</div></section>'
    + '<section class="section"><div class="section-no">08</div><div><div class="kind interpretation">РАБОЧАЯ ГИПОТЕЗА</div><h2>Рабочая гипотеза решения</h2><div class="solution">'
    + '<div class="solution-row"><div class="micro">Вероятный формат</div>' + p(b.solution_hypothesis && b.solution_hypothesis.format) + '</div>'
    + '<div class="solution-row"><div class="micro">Почему</div>' + p(b.solution_hypothesis && b.solution_hypothesis.rationale) + '</div>'
    + '<div class="solution-row"><div class="micro">Что должно подтвердиться</div><ul class="conditions">' + arr(b.solution_hypothesis && b.solution_hypothesis.confirmation_conditions).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>'
    + ((b.solution_hypothesis || {}).if_confirmed ? '<div class="solution-row"><div class="micro">Если подтвердится</div>' + p(b.solution_hypothesis.if_confirmed) + '</div>' : '')
    + ((b.solution_hypothesis || {}).do_not_offer_yet ? '<div class="solution-row"><div class="micro">Пока не предлагать</div>' + p(b.solution_hypothesis.do_not_offer_yet) + '</div>' : '') + '</div></div></section>'
    + '<section class="section"><div class="section-no">09</div><div><div class="kind interpretation">РЕШЕНИЕ ВЛАДЕЛЬЦА</div><h2>Следующее действие</h2><div class="decision">'
    + '<div><span class="micro">Действие</span>' + p((b.next_action || {}).action) + '<span class="micro">Цель</span>' + p((b.next_action || {}).purpose) + '</div>'
    + '<div><span class="micro">Успешный результат</span>' + p((b.next_action || {}).success_condition) + ((b.next_action || {}).due_date ? '<span class="micro">Срок</span>' + p(b.next_action.due_date) : '') + '</div></div></div></section>'
    + '<details class="details"><summary>Исходные ответы</summary><div class="details-body">' + arr(b.client_facts).map((f) => '<p><strong>' + esc(f.label) + ':</strong> ' + esc(f.value) + '</p>').join('') + '</div></details>'
    + '<details class="details"><summary>История</summary><div class="details-body">' + (arr(b.history).length ? arr(b.history).map((x) => '<p>' + esc([x.at,x.label].filter(present).join(' — ')) + '</p>').join('') : '<p>История действий пока пуста.</p>') + '</div></details>'
    + '<details class="details"><summary>Контакты</summary><div class="details-body">' + renderContact(c, auth, h.company, row.review_status) + '</div></details>'
    + renderCapture(auth) + '</main></article>';
  return hero + body;
}

function renderOwnerBriefPage(opts) {
  const o = opts || {}; const brief = o.brief || {}; const row = o.row || {}; const auth = o.auth || {};
  const state = statusLabel(row.review_status); const mode = o.mode || 'brief';
  let content;
  if (mode === 'edit') content = '<article class="paper"><main class="memo">' + renderEditor(o.client_draft, auth) + '</main></article>';
  else if (mode === 'preview') content = '<article class="paper"><main class="memo"><div class="preview"><div class="kind fact">ТОЧНО ТАК УВИДИТ КЛИЕНТ</div><h2>Предпросмотр клиента</h2>' + renderClientPreview(o.client_draft, row) + (brief.client_result_eligible && !['CLIENT_READY','CLIENT_NOTIFIED','CLIENT_VIEWED'].includes(String(row.review_status || '')) ? '<form method="post">' + authInputs(auth, 'approve') + '<div class="form-actions"><button class="btn gold" type="submit">Утвердить и сделать доступным</button></div></form>' : '') + '</div></main></article>';
  else if (mode === 'contact') content = '<article class="paper"><main class="memo">' + renderContact(brief.contact, auth, (brief.header || {}).company, row.review_status) + '</main></article>';
  else content = renderBriefBody(brief, row, auth);
  const qs = '?a=' + encodeURIComponent(auth.analysis_id || '') + '&amp;t=' + encodeURIComponent(auth.token || '');
  const actions = '<nav class="actionsbar"><a class="btn ghost" href="' + qs + '">Разбор</a><a class="btn" href="' + qs + '&amp;view=contact">Связаться</a>'
    + (brief.client_result_eligible ? '<a class="btn" href="' + qs + '&amp;view=edit">Редактировать результат</a><a class="btn gold" href="' + qs + '&amp;view=preview">Предпросмотр</a>' : '') + '</nav>';
  return shell('FINMENTOR · ' + ((brief.header || {}).company || 'Разбор клиента'), state, content, actions, row.locale);
}

function renderMessagePage(title, message, state) {
  return shell('FINMENTOR · ' + title, state || '', '<div class="toast"><h1>' + esc(title) + '</h1>' + p(message) + '</div>', '', 'ru');
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  SHELL_CSS, esc, statusLabel, sourceLabel, zoneLabel, provenanceLabel,
  renderContact, renderClientPreview, renderEditor, renderCapture, renderOutboundConfirm, renderBriefBody,
  renderOwnerBriefPage, renderMessagePage
};
