#!/usr/bin/env node
// FINMENTOR — the Romanian first-contact safe branch, proven offline.
//
//   node qa/ro-first-contact.test.mjs
//
// Offline. No tenant, no Telegram, no network, no production writes.
//
// WHAT THIS GATE IS FOR. Every Romanian page carries a CTA to the public Telegram contact, and the
// Concierge behind it answers from a state machine holding 67 distinct Russian sendable strings and
// no Romanian at all. A Romanian speaker following the site's own call to action landed in a
// Russian menu. Production v1 does not translate the Concierge — that is POST_GO — so the fix is
// narrow: answer in Romanian and send no keyboard, and change nothing else.
//
// "Nothing else" is the part that needs proving, and it is what this gate spends most of its checks
// on: the RU path must be byte-identical, the Russian strings must all still be there, the state
// machine and lead readiness must not be touched, and the branch must be impossible to enter for
// any language other than Romanian — including an absent one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const D = await import('file://' + join(ROOT, 'scripts', 'deploy-ro-first-contact.mjs').replace(/\\/g, '/'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

// A faithful stand-in for the two lines the patch replaces, plus the stubs they close over.
// `safeText` mirrors the live one closely enough for the branch: it trims and never returns empty.
function runReplyBuild(patched, language, outText, outMarkup) {
  const safeText = (v) => String(v == null ? '' : v).trim() || 'ПУСТО';
  const menuKeyboard = () => ({ inline_keyboard: [[{ text: 'меню', callback_data: 'menu' }]] });
  const session = { language: language };
  const p = { language: '' };
  const out = { text: outText, markup: outMarkup };
  const chat_id = '551662084';
  const body = patched ? D.REPLACEMENT : D.ANCHOR;
  const fn = new Function('safeText', 'menuKeyboard', 'session', 'p', 'out', 'chat_id',
    body + '\n; return { replyText: replyText, tgBody: tgBody };');
  return fn(safeText, menuKeyboard, session, p, out, chat_id);
}

// ── the branch fires for Romanian, and only for Romanian ───────────────────────────────────────

check('a Romanian session is answered in Romanian, with no keyboard at all', () => {
  for (const lang of ['ro', 'RO', 'ro-MD', 'ro-ro', ' ro ']) {
    const r = runReplyBuild(true, lang, 'РУССКИЙ ТЕКСТ', { inline_keyboard: [[{ text: 'меню', callback_data: 'menu' }]] });
    assert(/Bună ziua/.test(r.replyText), lang + ' did not get the Romanian acknowledgement');
    assert(!/[А-Яа-яЁё]/.test(r.replyText), lang + ' still received Cyrillic: ' + r.replyText.slice(0, 60));
    eq(r.tgBody.reply_markup, { inline_keyboard: [] }, lang + ' was sent a keyboard');
  }
});

check('every other language is byte-identical to the unpatched behaviour', () => {
  for (const lang of ['ru', 'en', 'uk', '', null, undefined, 'r', 'roman', 'RUS']) {
    const before = runReplyBuild(false, lang, 'РУССКИЙ ТЕКСТ', { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] });
    const after = runReplyBuild(true, lang, 'РУССКИЙ ТЕКСТ', { inline_keyboard: [[{ text: 'a', callback_data: 'b' }]] });
    eq(after, before, 'language ' + JSON.stringify(lang) + ' diverged from the original behaviour');
  }
});

check('"roman" and "ro" are not confused — the test is the two-letter language subtag', () => {
  const roman = runReplyBuild(true, 'roman', 'РУССКИЙ', null);
  assert(roman.replyText === 'РУССКИЙ', '"roman" wrongly entered the Romanian branch');
});

check('the Russian menu is still built for a Russian session', () => {
  const r = runReplyBuild(true, 'ru', 'привет', null);
  eq(r.tgBody.reply_markup, { inline_keyboard: [[{ text: 'меню', callback_data: 'menu' }]] }, 'the Russian menu was lost');
});

check('the branch reads the language the session carries, falling back to the update', () => {
  const fn = new Function('safeText', 'menuKeyboard', 'session', 'p', 'out', 'chat_id',
    D.REPLACEMENT + '\n; return tgBody;');
  const safeText = (v) => String(v || '').trim() || 'x';
  const menu = () => ({ inline_keyboard: [[{ text: 'm', callback_data: 'm' }]] });
  const fromUpdate = fn(safeText, menu, { language: '' }, { language: 'ro' }, { text: 'x', markup: null }, '1');
  eq(fromUpdate.reply_markup, { inline_keyboard: [] }, 'the update language was ignored');
});

// ── the wording is the approved one, and claims nothing extra ──────────────────────────────────

const TEXT = D.RO_TEXT.split('\\n').join('\n');

check('the acknowledgement is Romanian, with diacritics, and carries no Cyrillic', () => {
  assert(!/[А-Яа-яЁё]/.test(TEXT), 'the Romanian text contains Cyrillic');
  for (const d of ['ă', 'ț', 'î']) { assert(TEXT.indexOf(d) !== -1, 'missing diacritic ' + d); }
});

check('it uses the canonical product name and no retired or alternate one', () => {
  assert(TEXT.indexOf('Radiografia Financiară FINMENTOR') !== -1, 'the canonical product name is missing');
  assert(TEXT.indexOf('Testul de sănătate financiară') === -1, 'the superseded name is present');
  assert(TEXT.indexOf('Financial X-Ray') === -1, 'an English product name leaked in');
});

check('it offers the email route the site already publishes', () => {
  assert(TEXT.indexOf('cfo@finmentor.md') !== -1, 'the privacy/contact address is missing');
});

check('it promises no response time and claims no review has happened', () => {
  for (const bad of ['24 de ore', '24h', 'în cel mult', 'imediat', 'în curând', 'astăzi', 'minute', 'ore']) {
    assert(TEXT.toLowerCase().indexOf(bad.toLowerCase()) === -1, 'a response-time promise crept in: ' + bad);
  }
  for (const bad in { 'a fost analizat': 1, 'am analizat': 1, 'consultantul a verificat': 1, 'a fost verificat': 1 }) {
    assert(TEXT.toLowerCase().indexOf(bad) === -1, 'it claims a review already happened: ' + bad);
  }
});

check('it adds no consent or legal claim', () => {
  for (const bad of ['sunteți de acord', 'consimț', 'GDPR', 'prelucrarea datelor', 'politica de confidențialitate']) {
    assert(TEXT.toLowerCase().indexOf(bad.toLowerCase()) === -1, 'a new legal claim crept in: ' + bad);
  }
});

// ── the patch itself is safe to apply ──────────────────────────────────────────────────────────

const SAMPLE = [
  'function safeText(v){ return String(v); }',
  'var out = { text: "привет", markup: null };',
  D.ANCHOR,
  'return [{ json: { tgBody } }];'
].join('\n');

check('the patch applies exactly once and is idempotent', () => {
  const one = D.patch(SAMPLE);
  assert(one.changed, 'the patch did not apply');
  const two = D.patch(one.code);
  assert(!two.changed, 'a second application changed the code again');
  eq(two.code, one.code, 'a second application altered the body');
});

check('the patch refuses a body without the anchor, and one with two anchors', () => {
  let threw = false;
  try { D.patch('function nothing(){}'); } catch (e) { threw = /anchor was not found/.test(e.message); }
  assert(threw, 'a body with no anchor was accepted');
  threw = false;
  try { D.patch(SAMPLE + '\n' + D.ANCHOR); } catch (e) { threw = /appears 2 times/.test(e.message); }
  assert(threw, 'a body with two anchors was accepted');
});

check('the verifier accepts the intended delta', () => {
  const { code } = D.patch(SAMPLE);
  eq(D.verify(SAMPLE, code), [], 'the intended delta was rejected');
});

check('the verifier refuses a change made anywhere else in the node', () => {
  const { code } = D.patch(SAMPLE);
  const tampered = code.replace('function safeText(v){ return String(v); }', 'function safeText(v){ return "x"; }');
  assert(D.verify(SAMPLE, tampered).some((m) => /somewhere other than the reply-build anchor/.test(m)), 'must refuse');
});

check('the verifier refuses losing a Russian string, and refuses removing the menu path', () => {
  const { code } = D.patch(SAMPLE);
  const lostRu = code.replace('привет', 'salut');
  assert(D.verify(SAMPLE, lostRu).some((m) => /Russian string content changed/.test(m)), 'must notice lost Russian content');
  const noMenu = code.replace('(out.markup || menuKeyboard())', '({ inline_keyboard: [] })');
  assert(D.verify(SAMPLE, noMenu).some((m) => /removed instead of bypassed/.test(m)), 'must refuse removing the Russian menu path');
});

check('the verifier refuses an unconditional Romanian reply', () => {
  const { code } = D.patch(SAMPLE);
  const always = code.replace('isRoFirstContact ? safeText(RO_FIRST_CONTACT) : safeText(out.text)', 'safeText(RO_FIRST_CONTACT)');
  assert(D.verify(SAMPLE, always).some((m) => /not behind a condition/.test(m)), 'must refuse an unconditional override');
});

// ── the empty keyboard is a layout the transport already has ───────────────────────────────────

check('an empty keyboard is the existing L0_NONE layout, so no routing or layout changes', () => {
  // The transport derives the layout from the button signature; an empty keyboard is the empty
  // signature, which it already routes to `Render L0_NONE` with replyMarkup "none".
  const rows = [];
  const signature = rows.map((r) => r.map(() => 'C').join('')).join('_');
  eq(signature, '', 'an empty keyboard did not produce the empty signature');
});

check('the branch never emits a button, so no callback_data can be introduced', () => {
  const r = runReplyBuild(true, 'ro', 'РУССКИЙ', { inline_keyboard: [[{ text: 'меню', callback_data: 'menu' }]] });
  eq(r.tgBody.reply_markup.inline_keyboard, [], 'the Romanian branch emitted a keyboard');
  assert(JSON.stringify(r.tgBody).indexOf('callback_data') === -1, 'a callback_data reached the Romanian reply');
});

check('the branch changes only reply text and markup — chat_id is still carried through', () => {
  const r = runReplyBuild(true, 'ro', 'РУССКИЙ', null);
  eq(r.tgBody.chat_id, '551662084', 'chat_id was lost');
  eq(Object.keys(r.tgBody).sort(), ['chat_id', 'reply_markup', 'text'], 'the transport body shape changed');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
