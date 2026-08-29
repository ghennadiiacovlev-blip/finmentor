#!/usr/bin/env node
// FINMENTOR — the Premium Telegram presentation contract.
//
//   node qa/premium-ux-tg-presentation.test.mjs
//
// Owner copy pass, made permanent. Every reachable client-facing Premium screen is driven through
// the BUILT node body — not read out of the copy module — because the copy module is what the
// previous gate checked, and that is exactly how an entire message got replaced while the suite
// stayed green. Here the authoritative RU text is pinned against what the node actually renders.
//
// The screens are reached by the same inputs a client sends. TG_INFRA_FAILURE is the one exception:
// it is raised by downstream recovery, not by `decide()`, so its copy is pinned at the source and
// its shape checked with the others.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');
const wf = JSON.parse(readFileSync(CANDIDATE, 'utf8'));
const body = wf.nodes.find((n) => n.name === 'Build Bot Response (Premium)').parameters.jsCode;
const runner = new Function('$input', body);
const run = (src) => runner({ first: () => ({ json: src }) })[0].json;

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ' — ' + e.message); console.log('  FAIL  ' + name + ' — ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + '\n        got  ' + JSON.stringify(a) + '\n        want ' + JSON.stringify(b)); } };

const CHAT = '777000';
const CYCLE = 'CY-2026-08-29-abcdef';
const LEAD = 'LEAD-000123';
const fresh = (e) => Object.assign({ chat_id: CHAT, cycle_id: CYCLE, state: 'TG_ENTRY' }, e || {});
const committed = (e) => Object.assign({ chat_id: CHAT, cycle_id: CYCLE, lead_id: LEAD, lead_cycle_id: CYCLE, state: 'TG_SUBMITTED' }, e || {});
const drafting = (e) => Object.assign({ chat_id: CHAT, cycle_id: CYCLE, lead_id: '', lead_cycle_id: '', draft_state: 'draft', draft_step: 'objective', state: 'TG_ENTRY' }, e || {});

const CTX = JSON.stringify({
  company_name: 'Demo Retail', role: 'Собственник', turnover_band: '€2–10 млн',
  objective: 'Денежный поток', problem_summary: 'Регулярные кассовые разрывы.'
});

console.log('Premium Telegram presentation contract');
console.log('');

// ---------------------------------------------------------------- reach every screen

const SCREENS = {
  TG_ENTRY: run({ session: fresh(), message_text: '/start' }),
  TG_FREEFORM_PROBLEM: run({ session: fresh(), callback_data: 'p|describe' }),
  TG_CONFIRM_CONTEXT: run({ session: fresh({ state: 'TG_FREEFORM_PROBLEM' }),
    message_text: 'Я собственник Demo Retail. Регулярно возникают кассовые разрывы и нет прогноза движения денежных средств.' }),
  TG_OPEN_BRIEF: run({ session: fresh({ state: 'TG_CONFIRM_CONTEXT', context_extracted_json: CTX }), callback_data: 'p|ctx_ok' }),
  TG_SUBMITTED: run({ session: committed(), message_text: '/start' }),
  TG_APPEND_MESSAGE: run({ session: committed(), callback_data: 'p|append' }),
  TG_APPEND_DONE: run({ session: committed({ state: 'TG_APPEND_MESSAGE' }), message_text: 'Ещё одна деталь для консультанта.' }),
  TG_NEW_REQUEST_CONFIRM: run({ session: committed(), callback_data: 'p|new' }),
  TG_RESUME_DRAFT: run({ session: drafting(), message_text: '/start' }),
  TG_RESUME_DISCARD_CONFIRM: run({ session: drafting(), callback_data: 'p|restart' })
};

check('every screen under test was actually reached', () => {
  const want = {
    TG_ENTRY: 'TG_ENTRY', TG_FREEFORM_PROBLEM: 'TG_FREEFORM_PROBLEM',
    TG_CONFIRM_CONTEXT: 'TG_CONFIRM_CONTEXT', TG_OPEN_BRIEF: 'TG_OPEN_BRIEF',
    TG_SUBMITTED: 'TG_SUBMITTED', TG_APPEND_MESSAGE: 'TG_APPEND_MESSAGE',
    TG_APPEND_DONE: 'TG_APPEND_MESSAGE', TG_NEW_REQUEST_CONFIRM: 'TG_NEW_REQUEST_CONFIRM',
    // The discard confirmation deliberately reuses the TG_NEW_REQUEST_CONFIRM state id while
    // rendering TG_RESUME_DISCARD_CONFIRM's copy — one "are you sure" state, two screens. Pinned
    // here so the reuse stays intentional rather than becoming a surprise later.
    TG_RESUME_DRAFT: 'TG_RESUME_DRAFT', TG_RESUME_DISCARD_CONFIRM: 'TG_NEW_REQUEST_CONFIRM'
  };
  for (const k of Object.keys(want)) {
    eq(SCREENS[k].debug.state_after, want[k], k + ' did not land on its own screen');
  }
});

// ---------------------------------------------------------------- authoritative RU copy

// The exact text the owner approved. A copy change that is not also made here fails the suite —
// which is the whole point: the previous gate compared decide()'s copy to the object it came from,
// so it agreed with any wording at all.
const COPY = {
  TG_ENTRY: [
    '<b>FINMENTOR</b>',
    '<i>Подготовка к первой встрече</i>',
    '',
    'Здравствуйте.',
    '',
    '<b>Консультант должен понимать ваш бизнес ещё до начала разговора.</b>',
    '',
    'FINMENTOR поможет заранее зафиксировать компанию, задачу и ожидаемый результат — чтобы первая встреча началась сразу по существу.',
    '',
    '<b>Выберите удобный формат:</b>',
    '',
    '<b>Описать задачу</b> — расскажите ситуацию своими словами.',
    '<b>Подготовить бриф</b> — структурируйте ключевой контекст за несколько минут.',
    '',
    '<i>Перед отправкой всё можно проверить и изменить.</i>'
  ].join('\n'),
  TG_FREEFORM_PROBLEM: [
    '<b>Расскажите о ситуации своими словами.</b>',
    '',
    'Представьте, что первый разговор с консультантом уже начался.',
    '',
    'Что происходит в бизнесе, какое решение вам нужно принять и что сейчас мешает сделать это уверенно?',
    '',
    '<i>Можно писать свободно — FINMENTOR сам выделит ключевой контекст.</i>'
  ].join('\n'),
  TG_OPEN_BRIEF: [
    '<b>Контекст сохранён.</b>',
    '',
    'Осталось уточнить несколько деталей, которые помогут консультанту подготовиться к первой встрече.',
    '',
    '<i>В брифе не придётся повторять подтверждённую информацию.</i>'
  ].join('\n'),
  TG_SUBMITTED: [
    '<b>Последнее обращение уже передано FINMENTOR.</b>',
    '',
    'Можно дополнить его новой информацией или начать отдельный вопрос.'
  ].join('\n'),
  TG_APPEND_MESSAGE: [
    '<b>Добавить к текущему обращению</b>',
    '',
    'Напишите то, что важно передать консультанту дополнительно.',
    '',
    'Это сообщение будет связано с уже существующим обращением и не создаст новое.'
  ].join('\n'),
  TG_APPEND_DONE: [
    '<b>Информация добавлена.</b>',
    '',
    'Консультант увидит её вместе с текущим обращением.',
    '',
    '<i>Новое обращение не создавалось.</i>'
  ].join('\n'),
  TG_NEW_REQUEST_CONFIRM: [
    '<b>Начать новый вопрос?</b>',
    '',
    'Текущее обращение останется без изменений.',
    '',
    'Для новой задачи будет создан отдельный бриф.'
  ].join('\n'),
  TG_RESUME_DRAFT: [
    '<b>У вас есть незавершённый бриф.</b>',
    '',
    'Можно продолжить с того места, где остановились — подтверждённые данные сохранены.'
  ].join('\n'),
  TG_RESUME_DISCARD_CONFIRM: [
    '<b>Начать новый бриф?</b>',
    '',
    'Текущий черновик будет заменён.',
    '',
    'Уже переданные обращения это не затронет.'
  ].join('\n')
};

for (const key of Object.keys(COPY)) {
  check(key + ' renders the approved RU copy, exactly', () => {
    eq(SCREENS[key].reply_text, COPY[key], key + ' copy drifted');
  });
}

check('TG_INFRA_FAILURE holds the approved RU copy', () => {
  eq((B.TG_COPY.TG_INFRA_FAILURE.text || []).join('\n\n'), [
    '<b>Не удалось продолжить.</b>',
    '',
    'Произошла техническая ошибка.',
    '',
    'Текущее действие не завершено, и новое обращение не создано.',
    '',
    '<i>Попробуйте ещё раз — новый вопрос создавать не нужно, сохранённые шаги повторять не потребуется.</i>'
  ].join('\n'), 'TG_INFRA_FAILURE copy drifted');
});

// ---------------------------------------------------------------- the confirmation screen

check('TG_CONFIRM_CONTEXT uses the two-line label/value form', () => {
  const t = SCREENS.TG_CONFIRM_CONTEXT.reply_text;
  assert(t.indexOf('<b>Проверьте, правильно ли FINMENTOR понял контекст.</b>') === 0, 'the header is not first');
  assert(t.indexOf('Ваша роль\n<b>Собственник</b>') !== -1, 'label and value are not on separate lines');
  assert(t.indexOf('Ваша роль: ') === -1, 'the retired inline "label: value" form is still in use');
  assert(t.indexOf('<i>Если всё верно, этот контекст перейдёт в бриф — повторно отвечать на эти вопросы не потребуется.</i>') !== -1,
    'the approved closing line is missing');
});

check('no empty labels: a label appears if and only if its field was extracted', () => {
  // Driven off what extraction ACTUALLY produced rather than a hand-written expectation, so the
  // check keeps meaning if the extractor's reach changes.
  const s = SCREENS.TG_CONFIRM_CONTEXT;
  const ctx = JSON.parse(s.session.context_extracted_json || '{}');
  const t = s.reply_text;
  const LABELS = B.TG_COPY.TG_CONFIRM_CONTEXT.labels;
  let rendered = 0;
  for (const key of Object.keys(LABELS)) {
    const present = String(ctx[key] || '').trim() !== '';
    const shown = t.indexOf('\n' + LABELS[key] + '\n<b>') !== -1;
    eq(shown, present, LABELS[key] + (present ? ' was extracted but not rendered' : ' was rendered for a field that was not extracted'));
    if (shown) { rendered++; }
  }
  assert(rendered > 0, 'the confirmation screen rendered no fields at all');
  assert(t.indexOf('<b></b>') === -1, 'an empty bold value was rendered');
  assert(!/\n(—|-|n\/a|null|undefined)\n/i.test(t), 'a placeholder was rendered for a missing value');
});

check('client text is HTML-escaped before it reaches an HTML screen', () => {
  // safeText does NOT strip < and > on an HTML screen — the authored copy needs its tags. So the
  // escaping of VALUES is the only thing between a client typing "<" and a broken or injected send.
  const r = run({ session: fresh({ state: 'TG_FREEFORM_PROBLEM' }),
    message_text: 'Я собственник. У нас <b>кассовые разрывы</b> & нет прогноза движения денежных средств.' });
  eq(r.debug.state_after, 'TG_CONFIRM_CONTEXT', 'the hostile text did not reach the confirmation screen');
  const t = r.reply_text;
  assert(t.indexOf('&lt;b&gt;') !== -1, 'a client-supplied tag was not escaped');
  assert(t.indexOf('&amp;') !== -1, 'a client-supplied ampersand was not escaped');
  // Every remaining raw tag must be one this gate authored.
  const raw = [...t.matchAll(/<\/?([a-z-]+)[^>]*>/g)].map((m) => m[1]);
  for (const tag of raw) { assert(['b', 'i'].indexOf(tag) !== -1, 'an unexpected raw tag survived: ' + tag); }
});

check('nothing is marked confirmed by rendering the confirmation screen', () => {
  eq(String(SCREENS.TG_CONFIRM_CONTEXT.session.context_confirmed || 'false'), 'false', 'something was confirmed too early');
});

// ---------------------------------------------------------------- HTML contract

const ALLOWED_TAGS = ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'tg-spoiler'];

check('every screen declares HTML and uses only supported, balanced tags', () => {
  for (const key of Object.keys(SCREENS)) {
    const s = SCREENS[key];
    eq(s.tg_body.parse_mode, 'HTML', key + ' does not send as HTML');
    const t = s.reply_text;
    for (const m of t.matchAll(/<\/?([a-z-]+)[^>]*>/g)) {
      assert(ALLOWED_TAGS.indexOf(m[1]) !== -1, key + ' uses a tag Telegram does not support: ' + m[1]);
    }
    for (const tag of ['b', 'i']) {
      const open = (t.match(new RegExp('<' + tag + '>', 'g')) || []).length;
      const close = (t.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      eq(open, close, key + ' has unbalanced <' + tag + '> tags');
    }
  }
});

check('no emoji and no Markdown anywhere', () => {
  for (const key of Object.keys(SCREENS)) {
    const t = SCREENS[key].reply_text;
    assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u.test(t), key + ' contains an emoji or symbol');
    assert(!/(\*\*|__|\[.+\]\(.+\))/.test(t), key + ' mixes Markdown into HTML');
  }
});

check('no first-person bot wording', () => {
  for (const key of Object.keys(SCREENS)) {
    const t = SCREENS[key].reply_text;
    assert(!/(^|[^а-яё])я\s+(перенесу|перенёс|добавил|добавила|сохранил|сохранила|понял|поняла|буду|спрошу)/i.test(t),
      key + ' speaks in the first person');
  }
});

check('a failure screen never reads as a success', () => {
  const t = (B.TG_COPY.TG_INFRA_FAILURE.text || []).join(' ');
  for (const w of ['Спасибо', 'получили', 'отправлено', 'успешно', 'принято', 'передано']) {
    assert(t.indexOf(w) === -1, 'TG_INFRA_FAILURE contains success wording: ' + w);
  }
  assert(t.indexOf('не создано') !== -1, 'TG_INFRA_FAILURE no longer states that nothing was created');
});

// ---------------------------------------------------------------- buttons and layouts

// A button label is the client's entire understanding of what happens next, and callback_data is
// what actually happens. Pinning both together is what stops a copy pass from silently rewiring.
const BUTTONS = {
  TG_ENTRY: [['Описать задачу', 'p|describe'], ['Подготовить бриф', 'p|brief']],
  TG_FREEFORM_PROBLEM: [],
  TG_CONFIRM_CONTEXT: [['Всё верно', 'p|ctx_ok'], ['Исправить', 'p|ctx_fix']],
  TG_OPEN_BRIEF: [['Открыть бриф', 'WEB_APP']],
  TG_SUBMITTED: [['Добавить к обращению', 'p|append'], ['Начать новый вопрос', 'p|new']],
  TG_APPEND_MESSAGE: [],
  TG_APPEND_DONE: [['Вернуться', 'p|back'], ['Начать новый вопрос', 'p|new']],
  // OPEN DEFECT, pre-existing and reported to the owner: this screen's primary button carries
  // `p|new`, the same action that opened it, so tapping it re-renders the screen. The confirming
  // action `p|new_y` is bound to the label «Да, начать новый вопрос», which no screen renders — so
  // from Telegram a client cannot actually start a new question. Pinned as-is because the fix is a
  // callback rewiring, which this copy pass is explicitly forbidden to make.
  TG_NEW_REQUEST_CONFIRM: [['Начать новый вопрос', 'p|new'], ['Вернуться', 'p|back']],
  TG_RESUME_DRAFT: [['Продолжить', 'p|resume'], ['Начать заново', 'p|restart']],
  TG_RESUME_DISCARD_CONFIRM: [['Начать новое', 'p|restart_y'], ['Вернуться', 'p|back']]
};

check('button labels and callback_data are exactly as approved', () => {
  for (const key of Object.keys(BUTTONS)) {
    const rows = SCREENS[key].reply_markup.inline_keyboard || [];
    eq(rows.length, BUTTONS[key].length, key + ' has the wrong number of buttons');
    rows.forEach((row, i) => {
      eq(row.length, 1, key + ' row ' + i + ' is not a single button');
      const btn = row[0];
      eq(btn.text, BUTTONS[key][i][0], key + ' button ' + i + ' label');
      if (BUTTONS[key][i][1] === 'WEB_APP') {
        assert(btn.web_app && btn.web_app.url, key + ' button ' + i + ' lost its web_app');
        assert(btn.callback_data === undefined, key + ' web_app button also carries callback_data');
      } else {
        eq(btn.callback_data, BUTTONS[key][i][1], key + ' button ' + i + ' callback_data');
        assert(!btn.web_app, key + ' button ' + i + ' unexpectedly became a web_app button');
        assert(!btn.url, key + ' button ' + i + ' unexpectedly became a URL button');
      }
    });
  }
});

check('«Открыть бриф» is the only web_app button, and it stays one', () => {
  let webApps = 0;
  for (const key of Object.keys(SCREENS)) {
    for (const row of SCREENS[key].reply_markup.inline_keyboard || []) {
      for (const btn of row) {
        if (!btn.web_app) { continue; }
        webApps++;
        eq(btn.text, 'Открыть бриф', 'an unexpected button became a web_app button');
        assert(typeof btn.web_app.url === 'string' && btn.web_app.url.length > 0, 'the web_app url is empty');
      }
    }
  }
  eq(webApps, 1, 'the number of web_app buttons changed');
});

// The transport picks a renderer from the keyboard's shape-and-type signature plus the parse mode.
// A screen whose combination has no registered layout fails closed at the transport — correctly,
// but silently from the client's side. So the authorised set is pinned here.
const AUTHORISED_LAYOUTS = ['L0_NONE_HTML', 'L1_W_HTML', 'L2_C_HTML'];

check('every screen maps to an authorised HTML layout', () => {
  for (const key of Object.keys(SCREENS)) {
    const rows = SCREENS[key].reply_markup.inline_keyboard || [];
    const sig = rows.map((r) => (r[0].web_app ? 'W' : (r[0].url ? 'U' : 'C'))).join('|');
    const layout = sig === '' ? 'L0_NONE_HTML' : (sig === 'W' ? 'L1_W_HTML' : (sig === 'C|C' ? 'L2_C_HTML' : 'UNKNOWN(' + sig + ')'));
    assert(AUTHORISED_LAYOUTS.indexOf(layout) !== -1, key + ' needs an unauthorised layout: ' + layout);
  }
});

// ---------------------------------------------------------------- the legacy path

check('the legacy response builder was not touched by the copy pass', () => {
  const legacy = wf.nodes.find((n) => n.name === 'Build Bot Response');
  assert(legacy, 'the legacy response builder is gone');
  const code = String(legacy.parameters.jsCode);
  for (const s of Object.values(COPY)) {
    const firstLine = s.split('\n')[0];
    assert(code.indexOf(firstLine) === -1, 'premium copy leaked into the legacy node: ' + firstLine);
  }
  assert(code.indexOf('parse_mode') === -1 || code.indexOf('HTML') === -1,
    'the legacy node picked up an HTML parse mode');
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
