#!/usr/bin/env node
// FINMENTOR — the contact-channel screen: one preferred channel, and a check that means something.
//
//   node qa/premium-ux-contact-channel.test.mjs
//
// Offline. A minimal DOM shim renders the real app-premium/app.js; nothing here touches a browser,
// a tenant or the network.
//
// ── THE FOUR DEFECTS THIS GATE EXISTS TO KEEP CLOSED ────────────────────────────────────────────
//
//  1. EVERY ROW SHOWED A CHECK. `icon()` set an INLINE `display:flex` on the tick span. An inline
//     style outranks every selector, so `.row .tick { display: none }` never applied and all three
//     contact options rendered a check mark. The selection state was, correctly, unreadable — the
//     check had become a row decoration. The fix is a `.ic` class, which the row rules outrank.
//
//  2. A SWITCHED CHANNEL KEPT THE OLD CONTACT. Only `telegram` cleared `contact_value`. Typing a
//     phone number and then switching to «По email» left the number in place, settled and
//     confirmed, and it would have travelled to the consultant as the preferred EMAIL.
//
//  3. NOTHING WAS VALIDATED. `settled()` asks whether a value is non-empty and user-supplied. It
//     does not ask whether "abc" is an email. Continue enabled on any keystroke.
//
//  4. ON PHONE AND EMAIL, CONTINUE COULD NEVER ENABLE AT ALL. The button's disabled state was
//     computed once during render, and typing into a field does not re-render — so the two
//     branches that require typing were dead ends. This is the defect that would have stopped the
//     UAT run outright, and no amount of visual polish would have surfaced it.
//
// Single-select is asserted as a PROPERTY, not assumed: after any sequence of taps, at most one
// row may be selected and `contact_channel` must hold exactly one of the three approved ids.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { boot as bootApp, byClass, all, hasClass } from './lib/miniapp-harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// The shared harness boots content.js + net.js + app.js over a stubbed DOM, fetch and Telegram.
// `endpoints: false` keeps it offline: this gate is about one screen, not about the network, and
// an offline app reaches APP_BOOT_FAILURE at startup — from which `goto` still drives any screen.
function boot() {
  const h = bootApp({ endpoints: false });
  return { win: h.win, main: h.main, api: h.api, C: h.C };
}

// Drive the real screen: go to APP_CONTACT and return its rendered rows.
function contactScreen(ctx) {
  ctx.api.goto('APP_CONTACT');
  return byClass(ctx.main, 'row');
}
const tap = (row) => row.fire('click');
function type(ctx, text) {
  const field = byClass(ctx.main, 'field')[0];
  assert(field, 'no input field is rendered');
  const input = field.children.filter((c) => c.tagName === 'INPUT')[0];
  assert(input, 'the field has no input');
  input.value = text;
  input.fire('input');
  field.fire('input');            // the wrapper listener, as a real event would reach it
  return input;
}
const continueBtn = (ctx) => byClass(ctx.main, 'btn').filter((b) => b.textContent === 'Продолжить')[0];

console.log('Premium UX — contact channel (single-select, selection state, validation)');
console.log('');

// ---------------------------------------------------------------- 1. the check mark

check('icon() emits no inline display — the defect that put a check on every row', () => {
  const src = readFileSync(join(ROOT, 'app-premium', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('function icon('), src.indexOf('function icon(') + 200);
  assert(fn.indexOf('style.display') === -1, 'icon() still writes an inline display');
  assert(/function icon\(name, cls\)/.test(fn), 'icon() no longer takes the class argument');
  // A later edit that reintroduces the class-wipe would silently restore the defect.
  assert(src.indexOf(".className = 'tick'") === -1, 'a call site still overwrites className, dropping .ic');
});

check('the stylesheet hides the check on unselected rows and cards, and .ic cannot outrank it', () => {
  const css = readFileSync(join(ROOT, 'app-premium', 'app.css'), 'utf8');
  const rule = (sel) => new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css);
  assert(rule('.ic'), '.ic has no rule at all, so every icon is display:inline');
  eq(/display:\s*flex/.test(rule('.ic')[1]), true, '.ic does not set display:flex');
  for (const sel of ['.row .tick', '.card .tick']) {
    const r = rule(sel);
    assert(r, sel + ' has no rule, so unselected options show a check');
    assert(/display:\s*none/.test(r[1]), sel + ' does not hide the check');
  }
  for (const sel of ['.row.is-selected .tick', '.card.is-selected .tick']) {
    const r = rule(sel);
    assert(r && /display:\s*flex/.test(r[1]), sel + ' does not show the check on the selected option');
  }
  // `.ic` is one class; `.row .tick` is two. Two wins. If anyone ever promotes `.ic` to an id or
  // adds !important, the check comes back on every row and this catches it.
  assert(!/\.ic\s*\{[^}]*!important/.test(css), '.ic uses !important and would outrank the row rules again');
});

check('every option row carries a tick element — the selected one is the only one CSS reveals', () => {
  const ctx = boot();
  const rows = contactScreen(ctx);
  eq(rows.length, 3, 'contact rows rendered');
  rows.forEach((r, i) => {
    const ticks = byClass(r, 'tick');
    eq(ticks.length, 1, 'row ' + i + ' tick count');
    assert(hasClass(ticks[0], 'ic'), 'row ' + i + ' tick lost the .ic class');
    assert(!ticks[0].style.display, 'row ' + i + ' tick carries an inline display again');
  });
});

// ---------------------------------------------------------------- 2. single-select, as a property

check('the contract is single-select: one id, and never two selected rows', () => {
  const ctx = boot();
  const ids = ctx.C.CONTACT.options.map((o) => o.id);
  eq(JSON.stringify(ids), JSON.stringify(['telegram', 'phone', 'email']), 'approved channel ids');

  // Exhaust every sequence of up to three taps. At most one row selected, always.
  const seqs = [];
  for (const a of [0, 1, 2]) {
    seqs.push([a]);
    for (const b of [0, 1, 2]) {
      seqs.push([a, b]);
      for (const c of [0, 1, 2]) { seqs.push([a, b, c]); }
    }
  }
  for (const seq of seqs) {
    const c2 = boot();
    let rows = contactScreen(c2);
    for (const i of seq) { tap(rows[i]); rows = byClass(c2.main, 'row'); }
    const selected = rows.filter((r) => hasClass(r, 'is-selected'));
    eq(selected.length, 1, 'taps ' + seq.join('>') + ' selected ' + selected.length + ' rows');
    eq(selected.map((r) => r.getAttribute('aria-pressed')).join(''), 'true', 'aria-pressed on the selected row');
    const v = c2.api.get('contact_channel');
    assert(ids.indexOf(v) !== -1, 'taps ' + seq.join('>') + ' stored ' + JSON.stringify(v));
    eq(v, ids[seq[seq.length - 1]], 'the stored channel is the last one tapped');
    eq(rows.filter((r) => r.getAttribute('aria-pressed') === 'true').length, 1, 'exactly one row reports pressed');
  }
});

// ---------------------------------------------------------------- 3. conditional fields

check('Telegram asks for no contact field; phone and email each ask for exactly one', () => {
  const ctx = boot();
  let rows = contactScreen(ctx);

  tap(rows[0]);                                  // telegram
  eq(byClass(ctx.main, 'field').length, 0, 'telegram rendered a contact field');
  assert(byClass(ctx.main, 'quiet').length >= 1, 'the Telegram note is missing');
  assert(!continueBtn(ctx).disabled, 'Telegram selection did not enable Continue');

  rows = byClass(ctx.main, 'row');
  tap(rows[1]);                                  // phone
  eq(byClass(ctx.main, 'field').length, 1, 'phone field count');
  let input = byClass(ctx.main, 'field')[0].children.filter((c) => c.tagName === 'INPUT')[0];
  eq(input.type, 'tel', 'phone input type');
  eq(input.getAttribute('inputmode'), 'tel', 'phone inputmode');

  rows = byClass(ctx.main, 'row');
  tap(rows[2]);                                  // email
  eq(byClass(ctx.main, 'field').length, 1, 'email field count');
  input = byClass(ctx.main, 'field')[0].children.filter((c) => c.tagName === 'INPUT')[0];
  eq(input.type, 'email', 'email input type');
  eq(input.getAttribute('inputmode'), 'email', 'email inputmode');
});

check('there is no hidden or browser-controlled contact mode anywhere on the screen', () => {
  const ctx = boot();
  contactScreen(ctx);
  const nodes = all(ctx.main);
  eq(nodes.filter((n) => n.tagName === 'SELECT').length, 0, 'a <select> is present');
  eq(nodes.filter((n) => n.type === 'hidden').length, 0, 'a hidden input is present');
  eq(nodes.filter((n) => n.type === 'radio' || n.type === 'checkbox').length, 0, 'a native radio/checkbox is present');
  // The channel lives in the draft, not in the DOM, so no browser autofill can move it.
  eq(nodes.filter((n) => n.tagName === 'INPUT' && n.attrs.name).length, 0, 'an input carries a form name');
});

// ---------------------------------------------------------------- 4. switching must not carry over

check('switching channel discards the previous contact — phone → email cannot inherit a number', () => {
  const ctx = boot();
  let rows = contactScreen(ctx);
  tap(rows[1]);
  type(ctx, '+37360000000');
  eq(ctx.api.get('contact_value'), '+37360000000', 'the phone was stored');
  assert(!continueBtn(ctx).disabled, 'a valid phone did not enable Continue');

  rows = byClass(ctx.main, 'row');
  tap(rows[2]);                                  // → email
  eq(ctx.api.get('contact_value'), null, 'the phone number survived the switch to email');
  eq(ctx.api.settled('contact_value'), false, 'the carried value is still settled');
  assert(continueBtn(ctx).disabled, 'Continue is enabled on email with no email entered');
  const input = byClass(ctx.main, 'field')[0].children.filter((c) => c.tagName === 'INPUT')[0];
  eq(input.value, '', 'the email field is prefilled with the old phone number');
});

check('every one of the six transitions clears the value it should not carry', () => {
  const ids = ['telegram', 'phone', 'email'];
  const seed = { telegram: '', phone: '+37360000000', email: 'a@b.md' };
  for (let from = 0; from < 3; from++) {
    for (let to = 0; to < 3; to++) {
      if (from === to) { continue; }
      const ctx = boot();
      let rows = contactScreen(ctx);
      tap(rows[from]);
      if (seed[ids[from]]) { type(ctx, seed[ids[from]]); }
      rows = byClass(ctx.main, 'row');
      tap(rows[to]);
      eq(ctx.api.get('contact_channel'), ids[to], ids[from] + '→' + ids[to] + ' channel');
      eq(ctx.api.get('contact_value'), null, ids[from] + '→' + ids[to] + ' carried a stale contact');
    }
  }
});

check('re-tapping the already selected channel keeps what was typed', () => {
  const ctx = boot();
  let rows = contactScreen(ctx);
  tap(rows[1]);
  type(ctx, '069123456');
  rows = byClass(ctx.main, 'row');
  tap(rows[1]);                                  // same row again
  eq(ctx.api.get('contact_value'), '069123456', 'a no-op tap wiped the value');
});

// ---------------------------------------------------------------- 5. validation

check('phone validation accepts Moldovan national and E.164, and refuses the rest', () => {
  const ctx = boot();
  const v = ctx.api.contactValid;
  const good = ['069123456', '060000000', '022123456', '+37369123456', '+373 69 123 456',
    '+373-69-123-456', '+373 (69) 123.456', '+442071838750', '+12025550123'];
  const bad = ['', '   ', '69123456', '06912345', '0691234567', '+373', '+3736', 'abc',
    '069-12-34-5a', '+37369123456789012', '00373 69123456', 'tel:+37369123456'];
  good.forEach((x) => eq(v('phone', x), true, 'rejected a valid phone ' + JSON.stringify(x)));
  bad.forEach((x) => eq(v('phone', x), false, 'accepted an invalid phone ' + JSON.stringify(x)));
});

check('email validation is basic and honest — shape only, and it refuses obvious nonsense', () => {
  const ctx = boot();
  const v = ctx.api.contactValid;
  const good = ['cfo@finmentor.md', 'a.b+c@sub.example.co.uk', 'x@y.io'];
  const bad = ['', 'abc', 'a@b', 'a@b.', '@b.md', 'a b@c.md', 'a@b .md', 'a@@b.md',
    '069123456', 'a@b.m', 'a'.repeat(250) + '@b.md'];
  good.forEach((x) => eq(v('email', x), true, 'rejected a valid email ' + JSON.stringify(x)));
  bad.forEach((x) => eq(v('email', x), false, 'accepted an invalid email ' + JSON.stringify(x)));
});

check('Telegram needs no typed contact, and an unknown channel is never valid', () => {
  const ctx = boot();
  eq(ctx.api.contactValid('telegram', ''), true, 'Telegram demanded a contact');
  eq(ctx.api.contactValid('telegram', null), true, 'Telegram demanded a contact');
  ['', 'sms', 'whatsapp', 'TELEGRAM', 'phone ', null, undefined].forEach((ch) => {
    eq(ctx.api.contactValid(ch, 'anything'), false, 'unknown channel ' + JSON.stringify(ch) + ' passed');
  });
});

// ---------------------------------------------------------------- 6. the Continue gate, live

check('Continue enables only when the SELECTED method is valid, and updates as the client types', () => {
  const ctx = boot();
  let rows = contactScreen(ctx);
  assert(continueBtn(ctx).disabled, 'Continue starts enabled with nothing chosen');

  tap(rows[1]);                                  // phone
  let btn = continueBtn(ctx);
  assert(btn.disabled, 'Continue is enabled with an empty phone');

  type(ctx, '06');
  assert(btn.disabled, 'Continue enabled on a partial phone');
  type(ctx, '069123');
  assert(btn.disabled, 'Continue enabled on a short phone');
  type(ctx, '069123456');
  assert(!btn.disabled, 'Continue never enabled for a valid phone — the branch is a dead end');
  type(ctx, '069123456x');
  assert(btn.disabled, 'Continue stayed enabled after the phone became invalid again');

  rows = byClass(ctx.main, 'row');
  tap(rows[2]);                                  // email
  btn = continueBtn(ctx);
  assert(btn.disabled, 'Continue is enabled with an empty email');
  type(ctx, 'abc');
  assert(btn.disabled, 'Continue enabled on "abc" as an email');
  type(ctx, 'cfo@finmentor.md');
  assert(!btn.disabled, 'Continue never enabled for a valid email — the branch is a dead end');
});

check('a valid contact is required before the flow will leave APP_CONTACT', () => {
  const ctx = boot();
  const rows = contactScreen(ctx);
  tap(rows[1]);
  type(ctx, 'abc');
  // firstUnsettled models the server's own view of what is still missing.
  eq(ctx.api.contactReady(), false, 'contactReady accepted "abc" as a phone');
  eq(ctx.api.settled('contact_channel'), true, 'the channel itself is settled');
});

check('Telegram alone satisfies the screen — no phone, no email is ever demanded', () => {
  const ctx = boot();
  const rows = contactScreen(ctx);
  tap(rows[0]);
  eq(ctx.api.contactReady(), true, 'Telegram did not satisfy the screen');
  eq(ctx.api.get('contact_value'), null, 'Telegram stored a contact value');
  eq(ctx.api.firstUnsettled() === 'APP_CONTACT', false, 'the flow is still stuck on the contact screen');
});

// ---------------------------------------------------------------- 7. what must NOT have changed

check('the approved contact copy is untouched', () => {
  const ctx = boot();
  eq(ctx.C.CONTACT.title, 'Как удобнее продолжить?', 'title');
  eq(JSON.stringify(ctx.C.CONTACT.options.map((o) => o.label)),
    JSON.stringify(['Здесь, в Telegram', 'По телефону', 'По email']), 'option labels');
  eq(ctx.C.CONTACT.telegramNote, 'В Telegram номер телефона не нужен.', 'telegram note');
});

check('the approved visual system is untouched — no gold on selection, no new colour', () => {
  const css = readFileSync(join(ROOT, 'app-premium', 'app.css'), 'utf8');
  const sel = /\.row\.is-selected\s*\{([^}]*)\}/.exec(css)[1];
  assert(sel.indexOf('--gold') === -1, 'selection now uses gold');
  assert(sel.indexOf('--line-selected') !== -1, 'selection no longer uses the approved ivory token');
  assert(/box-shadow:\s*inset[^;]*--line-selected/.test(sel), 'the selected row lost its heavier border');
  // The emphasis must come from the existing token, not a value typed in by hand.
  assert(!/#[0-9a-fA-F]{3,8}/.test(sel), 'a raw colour was introduced into the selected row');
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
