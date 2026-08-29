#!/usr/bin/env node
// FINMENTOR — Premium UX content contract.
//
//   node qa/premium-ux-content.test.mjs
//
// Offline. No tenant, no network, no credentials.
//
// WHAT THIS GATE IS FOR. The handoff forbids implementation from inventing, consolidating,
// renaming or removing copy, options or branches. That is only enforceable if a machine checks it,
// so this gate reads docs/PREMIUM_UX_FINAL_RU_SPEC.md and requires EVERY client-visible string in
// branches.js to appear in the spec verbatim. A drifted label fails the build instead of reaching
// a client — and a label deleted from the spec fails too, because the counts are asserted.
//
// It also holds the shape rules that no amount of correct copy can substitute for: eight
// objectives, free-text branches carrying no diagnostic cards, the focus map frozen at exactly
// eight keys of exactly three lines.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const { buildContent } = await import('../scripts/build-premium-app-content.mjs');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// The spec, normalised for comparison. Two transforms, both about the DOCUMENT rather than the
// content: the markdown escape is undone so `P&L` matches `P&amp;L`, and runs of whitespace
// collapse to one space so a sentence the spec soft-wraps across two lines still matches the
// single-line string the client actually renders. Without the second, every wrapped string in the
// spec would fail this gate for a reason that has nothing to do with the copy being right.
const norm = (s) => String(s).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SPEC = norm(readFileSync(join(ROOT, 'docs', 'PREMIUM_UX_FINAL_RU_SPEC.md'), 'utf8'));
const inSpec = (s) => SPEC.indexOf(norm(s)) !== -1;

console.log('Premium UX — content contract');
console.log('');

// ---------------------------------------------------------------- taxonomy

check('exactly eight objectives, in spec order, no consolidation', () => {
  eq(B.OBJECTIVES.length, 8, 'objective count');
  const want = ['Финансовое управление', 'Прибыль и эффективность', 'Денежный поток',
    'Инвестиция / новый проект', 'Недвижимость / сделка', 'Финансирование',
    'Нужен независимый взгляд', 'Другая задача'];
  eq(JSON.stringify(B.OBJECTIVE_LABELS), JSON.stringify(want), 'objective labels/order');
  eq(new Set(B.OBJECTIVE_IDS).size, 8, 'objective ids are unique');
});

check('every objective label and explanatory line is in the spec verbatim', () => {
  for (const o of B.OBJECTIVES) {
    assert(inSpec(o.label), 'label not in spec: ' + o.label);
    assert(inSpec(o.line), 'line not in spec: ' + o.line);
  }
});

check('CFO-сопровождение is not a top-level objective', () => {
  assert(B.OBJECTIVE_LABELS.indexOf('CFO-сопровождение') === -1, 'CFO-сопровождение reappeared as an objective');
});

// ---------------------------------------------------------------- problems

check('every objective has a problem set; free-text branches carry no cards', () => {
  for (const id of B.OBJECTIVE_IDS) {
    const p = B.PROBLEMS[id];
    assert(p, 'missing problem set: ' + id);
    assert(inSpec(p.title), 'problem title not in spec: ' + p.title);
    if (id === 'independent_view' || id === 'other') {
      eq(p.mode, 'free_text', id + ' must be free text');
      assert(!p.options, id + ' must carry NO diagnostic cards');
      for (const c of p.copy) { assert(inSpec(c), 'free-text copy not in spec: ' + c); }
      assert(inSpec(p.placeholder), 'placeholder not in spec: ' + p.placeholder);
    } else {
      eq(p.mode, 'cards', id + ' must be cards');
      assert(p.options.length >= 5, id + ' has too few problem cards');
    }
  }
});

check('every problem card title and line is in the spec verbatim', () => {
  for (const id of B.OBJECTIVE_IDS) {
    const p = B.PROBLEMS[id];
    if (p.mode !== 'cards') { continue; }
    for (const [t, l] of p.options) {
      assert(inSpec(t), 'problem title not in spec: ' + t);
      if (l) { assert(inSpec(l), 'problem line not in spec: ' + l); }
    }
  }
});

check('the free-text problem option is the spec wording and is offered on every card branch', () => {
  eq(B.PROBLEM_FREE_TEXT_OPTION, 'Опишу ситуацию своими словами', 'free-text option wording');
  assert(inSpec(B.PROBLEM_FREE_TEXT_OPTION), 'not in spec');
  for (const id of B.OBJECTIVE_IDS) {
    if (B.PROBLEMS[id].mode !== 'cards') { continue; }
    const labels = B.problemLabels(id);
    eq(labels[labels.length - 1], B.PROBLEM_FREE_TEXT_OPTION, id + ' does not end with the free-text option');
  }
});

// ---------------------------------------------------------------- outcomes

check('every objective has an outcome set, all strings in the spec', () => {
  for (const id of B.OBJECTIVE_IDS) {
    const o = B.OUTCOMES[id];
    assert(o, 'missing outcome set: ' + id);
    assert(inSpec(o.title), 'outcome title not in spec: ' + o.title);
    assert(o.options.length >= 6, id + ' has too few outcome cards');
    for (const [t, l] of o.options) {
      assert(inSpec(t), 'outcome title not in spec: ' + t);
      if (l) { assert(inSpec(l), 'outcome line not in spec: ' + l); }
    }
  }
});

check('only Другая задача offers a free-text outcome', () => {
  eq(B.OUTCOME_FREE_TEXT_OPTION, 'Опишу ожидаемый результат сам', 'wording');
  for (const id of B.OBJECTIVE_IDS) {
    const has = B.outcomeLabels(id).indexOf(B.OUTCOME_FREE_TEXT_OPTION) !== -1;
    eq(has, id === 'other', id + ' free-text outcome presence');
  }
});

// ---------------------------------------------------------------- shared sets

check('scale: exactly six bands, nothing above €10 млн collapsed', () => {
  eq(B.SCALE_OPTIONS.length, 6, 'band count');
  const want = ['до €500 тыс.', '€500 тыс. – €2 млн', '€2–10 млн', '€10–50 млн', '€50 млн+', 'Предпочитаю не указывать'];
  eq(JSON.stringify(B.SCALE_OPTIONS), JSON.stringify(want), 'bands');
  for (const s of B.SCALE_OPTIONS) { assert(inSpec(s), 'band not in spec: ' + s); }
});

check('current setup: eleven multi-select options, all in the spec', () => {
  eq(B.CURRENT_SETUP.options.length, 11, 'option count');
  assert(inSpec(B.CURRENT_SETUP.title), 'title not in spec');
  assert(inSpec(B.CURRENT_SETUP.copy), 'copy not in spec');
  for (const o of B.CURRENT_SETUP.options) { assert(inSpec(o), 'setup option not in spec: ' + o); }
});

check('decision horizon: exactly the five locked options', () => {
  eq(B.DECISION_HORIZON.options.length, 5, 'count');
  const want = ['В течение недели', '2–4 недели', '1–3 месяца', 'Сначала хочу обсудить подход', 'Жёсткого срока нет'];
  eq(JSON.stringify(B.DECISION_HORIZON.options.map((o) => o[0])), JSON.stringify(want), 'options');
  for (const [t, l] of B.DECISION_HORIZON.options) {
    assert(inSpec(t), 'horizon not in spec: ' + t);
    if (l) { assert(inSpec(l), 'horizon line not in spec: ' + l); }
  }
});

check('documents: availability only, no upload affordance anywhere (owner decision A)', () => {
  const json = JSON.stringify(B.DOCUMENTS);
  assert(!/Добавить материалы|Прикрепить|upload|файл\b/i.test(json), 'documents still offers an upload affordance');
  assert(B.DOCUMENTS.options.length >= 6, 'too few availability categories');
  assert(inSpec(B.DOCUMENTS.continueWithout), 'continue-without not in spec');
  for (const m of B.DOCUMENTS.minimisation) { assert(inSpec(m), 'minimisation copy not in spec: ' + m); }
});

check('contact: three channels, Telegram needs no phone', () => {
  eq(B.CONTACT.options.length, 3, 'channel count');
  eq(JSON.stringify(B.CONTACT.options.map((o) => o.label)), JSON.stringify(['Здесь, в Telegram', 'По телефону', 'По email']), 'channels');
  for (const o of B.CONTACT.options) { assert(inSpec(o.label), 'channel not in spec: ' + o.label); }
});

check('important context label and placeholder are the spec wording', () => {
  assert(inSpec(B.IMPORTANT_CONTEXT.label), 'label not in spec');
  assert(inSpec(B.IMPORTANT_CONTEXT.placeholder), 'placeholder not in spec');
});

// ---------------------------------------------------------------- focus map

check('focus map: frozen, exactly eight keys, exactly three lines each, all in the spec', () => {
  assert(Object.isFrozen(B.FOCUS_MAP), 'FOCUS_MAP is not frozen');
  const keys = Object.keys(B.FOCUS_MAP);
  eq(keys.length, 8, 'focus key count');
  eq(JSON.stringify(keys.slice().sort()), JSON.stringify(B.OBJECTIVE_IDS.slice().sort()), 'focus keys != objective ids');
  for (const k of keys) {
    eq(B.FOCUS_MAP[k].length, 3, 'focus lines for ' + k);
    for (const line of B.FOCUS_MAP[k]) { assert(inSpec(line), 'focus line not in spec: ' + line); }
  }
  assert(inSpec(B.FOCUS_DISCLAIMER), 'focus disclaimer not in spec');
});

// ---------------------------------------------------------------- terminal + privacy copy

check('success, failure, review and privacy copy are the spec wording', () => {
  for (const s of B.SUCCESS.lines.concat([B.SUCCESS.title, B.SUCCESS.status, B.SUCCESS.primary, B.SUCCESS.nextTitle]).concat(B.SUCCESS.next)) {
    assert(inSpec(s), 'success copy not in spec: ' + s);
  }
  for (const s of B.FAILURE.lines.concat([B.FAILURE.title, B.FAILURE.primary, B.FAILURE.secondary])) {
    assert(inSpec(s), 'failure copy not in spec: ' + s);
  }
  for (const s of [B.REVIEW.title, B.REVIEW.lead, B.REVIEW.enough, B.REVIEW.primary, B.REVIEW.secondary, B.REVIEW.tertiary]) {
    assert(inSpec(s), 'review copy not in spec: ' + s);
  }
  for (const s of B.PRIVACY.lines.concat(B.PRIVACY.links).concat([B.PRIVACY.entryLink, B.PRIVACY.primary])) {
    assert(inSpec(s), 'privacy copy not in spec: ' + s);
  }
});

check('failure copy can never read as success', () => {
  const joined = B.FAILURE.lines.join(' ') + ' ' + B.FAILURE.title;
  assert(/не считается принятым/.test(joined), 'failure does not state the request was NOT accepted');
  assert(!/(Спасибо|принят|передал|получили)/i.test(B.FAILURE.title), 'failure title reads like success');
  assert(B.FAILURE.title !== B.SUCCESS.title, 'failure and success share a title');
});

check('materials status is factual only (spec §27)', () => {
  eq(B.REVIEW.materialsStatus.present, 'Материалы — приложены', 'present wording');
  eq(B.REVIEW.materialsStatus.absent, 'Материалы — не приложены', 'absent wording');
  const j = JSON.stringify(B.REVIEW.materialsStatus);
  assert(!/частично|готовы/.test(j), 'subjective materials state reappeared');
});

check('four stages, no numbers', () => {
  eq(JSON.stringify(B.STAGES), JSON.stringify(['Контекст', 'Задача', 'Подготовка', 'Проверка']), 'stages');
  for (const s of B.STAGES) { assert(inSpec(s), 'stage not in spec: ' + s); }
});

check('edit selector covers every editable field and returns to review', () => {
  assert(B.EDIT.rows.length >= 10, 'too few edit rows');
  assert(inSpec(B.EDIT.title), 'edit title not in spec');
  assert(inSpec(B.EDIT.lead), 'edit lead not in spec');
  eq(new Set(B.EDIT.rows.map((r) => r.field)).size, B.EDIT.rows.length, 'duplicate edit field');
});

// ---------------------------------------------------------------- Telegram copy (owner decision C)

// THE ENTRY SCREEN IS PINNED, WORD FOR WORD.
//
// Until this existed, no gate asserted what TG_ENTRY actually SAYS. The state gate compares
// `decide()`'s copy to `B.TG_COPY.TG_ENTRY` — the same object it came from — so it passes whatever
// branches.js happens to contain. The whole entry message was replaced and the suite stayed green.
//
// So the approved text lives here too, as an independent second copy. Changing the product copy now
// requires changing it in both places deliberately, which is the point: this is owner-approved
// customer-facing wording, not an implementation detail.
const TG_ENTRY_APPROVED = [
  '<b>FINMENTOR</b>\n<i>Подготовка к первой встрече</i>',
  'Здравствуйте.',
  '<b>Консультант должен понимать ваш бизнес ещё до начала разговора.</b>',
  'FINMENTOR поможет заранее зафиксировать компанию, задачу и ожидаемый результат — чтобы первая встреча началась сразу по существу.',
  '<b>Выберите удобный формат:</b>',
  '<b>Описать задачу</b> — расскажите ситуацию своими словами.\n<b>Подготовить бриф</b> — структурируйте ключевой контекст за несколько минут.',
  '<i>Перед отправкой всё можно проверить и изменить.</i>'
].join('\n\n');

check('TG_ENTRY is the approved copy, byte for byte', () => {
  eq(B.TG_COPY.TG_ENTRY.text.join('\n\n'), TG_ENTRY_APPROVED, 'TG_ENTRY text');
  eq(JSON.stringify(B.TG_COPY.TG_ENTRY.actions), JSON.stringify(['Описать задачу', 'Подготовить бриф']), 'TG_ENTRY actions');
});

check('TG_ENTRY is the ONLY screen rendered as HTML', () => {
  // HTML is safe on this screen because it interpolates nothing. A screen that renders client text
  // — TG_CONFIRM_CONTEXT shows a company name and the client's own words — would need escaping
  // first, so a second screen must not pick up a parse mode unnoticed.
  eq(B.TG_COPY.TG_ENTRY.parse_mode, 'HTML', 'TG_ENTRY parse_mode');
  const withMode = Object.keys(B.TG_COPY).filter((k) => B.TG_COPY[k] && B.TG_COPY[k].parse_mode);
  eq(withMode.join(','), 'TG_ENTRY', 'screens declaring a parse mode');
});

check('the entry HTML is valid for Telegram, and is not Markdown', () => {
  const s = TG_ENTRY_APPROVED;
  const ALLOWED = ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'tg-spoiler'];
  const tags = [...s.matchAll(/<\/?([a-z-]+)[^>]*>/g)].map((m) => m[1]);
  for (const t of tags) { assert(ALLOWED.indexOf(t) !== -1, 'Telegram does not support the tag: ' + t); }
  eq((s.match(/<(b|i)>/g) || []).length, (s.match(/<\/(b|i)>/g) || []).length, 'balanced b/i tags');
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s), 'the entry copy contains an emoji');
  assert(!/(\*\*|__|\[[^\]]+\]\([^)]+\))/.test(s), 'the entry copy contains Markdown');
  assert(s.length <= 4096, 'the entry message exceeds the Telegram 4096-character cap');
});

check('every OTHER Telegram screen stays plain text with no markup', () => {
  // A stray tag on a plain-text screen would be shown to the client literally.
  for (const k of Object.keys(B.TG_COPY)) {
    if (k === 'TG_ENTRY') { continue; }
    const c = B.TG_COPY[k];
    const parts = [].concat(c.text || [], c.header || [], c.closing || [], (c.done && c.done.text) || []);
    for (const line of parts) {
      assert(!/<\/?[a-z-]+>/i.test(String(line)), k + ' contains markup but is not an HTML screen: ' + String(line).slice(0, 60));
    }
  }
});

check('all nine Telegram states carry copy, none empty', () => {
  const need = ['TG_ENTRY', 'TG_FREEFORM_PROBLEM', 'TG_CONFIRM_CONTEXT', 'TG_OPEN_BRIEF',
    'TG_SUBMITTED', 'TG_APPEND_MESSAGE', 'TG_NEW_REQUEST_CONFIRM', 'TG_INFRA_FAILURE',
    'TG_RESUME_DRAFT', 'TG_RESUME_DISCARD_CONFIRM'];
  for (const k of need) {
    const c = B.TG_COPY[k];
    assert(c, 'missing TG copy: ' + k);
    const lines = c.text || [c.header];
    assert(lines && lines.length && lines.every((l) => String(l).trim()), 'empty copy: ' + k);
  }
});

check('the terminal Telegram screen offers exactly append and new request', () => {
  eq(JSON.stringify(B.TG_COPY.TG_SUBMITTED.actions), JSON.stringify(['Добавить к обращению', 'Начать новый вопрос']), 'actions');
  assert(/уже передано FINMENTOR/.test(B.TG_COPY.TG_SUBMITTED.text.join(' ')), 'terminal copy changed');
});

check('append confirmation states that no new request was created', () => {
  const done = B.TG_COPY.TG_APPEND_MESSAGE.done.text.join(' ');
  assert(/не создавалось/.test(done), 'append confirmation does not deny creating a new request');
  assert(/не создаст новое обращение/.test(B.TG_COPY.TG_APPEND_MESSAGE.text.join(' ')), 'append entry copy changed');
});

check('infra failure never implies the request was received', () => {
  const t = B.TG_COPY.TG_INFRA_FAILURE.text.join(' ');
  assert(/не считается отправленным/.test(t), 'does not state the request was not sent');
  assert(!/(получено|принято|передано FINMENTOR)/.test(t), 'implies success');
});

// ---------------------------------------------------------------- the browser bundle

check('the Mini App content bundle matches a fresh build', () => {
  // app-premium/content.js is GENERATED from branches.js. If it were hand-maintained it would be
  // a second copy of the approved copy that this gate is not watching — which is exactly how a
  // client ends up seeing a label nobody signed off.
  const onDisk = readFileSync(join(ROOT, 'app-premium', 'content.js'), 'utf8');
  const fresh = buildContent();
  // Line endings normalised: core.autocrlf is true here, so a checkout rewrites the generated
  // file to CRLF and a byte-exact compare would report a stale bundle for a file that is
  // character-for-character correct — the known false failure in this repo.
  const lf = (s) => s.replace(/\r\n/g, '\n');
  eq(lf(onDisk), lf(fresh),
    'app-premium/content.js is stale — re-run node scripts/build-premium-app-content.mjs');
});

check('the browser bundle carries no server-side decision logic', () => {
  const bundle = readFileSync(join(ROOT, 'app-premium', 'content.js'), 'utf8');
  for (const forbidden of ['APPROVED_CARRIED', 'canSkip', 'validateDraft', 'submission_key', 'TG_COPY']) {
    assert(bundle.indexOf(forbidden) === -1, 'server-side logic leaked into the browser bundle: ' + forbidden);
  }
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
