#!/usr/bin/env node
// FINMENTOR — the success screen: terminal, honest about materials, and able to leave.
//
//   node qa/premium-ux-success-screen.test.mjs
//
// Offline. Drives the REAL app-premium/app.js, net.js and content.js through a genuine submit and
// asserts on the screen the client actually renders.
//
// ── WHY THIS GATE EXISTS ───────────────────────────────────────────────────────────────────────
//
// The owner reached this screen for the first time on 2026-08-30, on the first end-to-end
// submission, and it said two things that were not true:
//
//   1. «…вашу задачу и приложенные материалы…» — nothing was attached. v1 records document
//      AVAILABILITY and has no upload control anywhere (OWNER DECISION A). The client had ticked
//      «Cash Flow» to say a cash-flow report EXISTS; the server recorded exactly that, as
//      «Указаны доступные материалы (файлы не приложены)». Only the last screen the client sees
//      claimed a file had crossed.
//   2. «FINMENTOR изучит brief.» — the Latin word, in an otherwise Russian premium register.
//
// And «Вернуться в Telegram» did nothing on the owner's device. The handler was already correct
// and already deployed, so the gate below cannot prove the Telegram client acts on a close — no
// offline harness can. What it CAN hold is everything on this side of that call: exactly one
// close per tap, through one integration point, with no request and no state change behind it.
//
// The materials assertions are a property over the draft, not a string comparison: whether the
// sentence may mention materials at all is decided by what the client declared.

import { boot, byClass, text, OK_BOOTSTRAP } from './lib/miniapp-harness.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

let pass = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const SUBMIT = 'finmentor-miniapp-submit';
const SESSION = 'finmentor-miniapp-session';
const GATEWAY = 'finmentor-miniapp-gateway';
const OK_SUBMIT = { ok: true, lead_id: 'FIN-1788113619104-582', submit_state: 'submitted' };

// Drive the real client to APP_SUCCESS the way a client reaches it: by submitting.
async function succeed(opts) {
  const o = opts || {};
  const h = boot({
    telegram: o.telegram,
    responder: ({ url }) => {
      if (url.indexOf(GATEWAY) !== -1) { return { status: 200, body: OK_BOOTSTRAP }; }
      if (url.indexOf(SUBMIT) !== -1) { return { status: 200, body: OK_SUBMIT }; }
      return { status: 200, body: { ok: true } };
    }
  });
  await h.settle();
  if (o.documents !== undefined) { h.api.set('documents', o.documents, 'user_explicit', true); }
  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'the client did not reach the success screen');
  return h;
}

const screenText = (h) => text(h.main);
const buttons = (h) => byClass(h.main, 'btn');

console.log('\nFINMENTOR — success screen: terminal, honest, and able to leave\n');

// ── SUCCESS_TERMINAL ──────────────────────────────────────────────────────────────────────────

await check('SUCCESS_TERMINAL — the screen offers exactly one action, and it is leaving', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  eq(buttons(h).length, 1, 'buttons on the success screen');
  eq(buttons(h)[0].textContent, B.SUCCESS.primary, 'the one button is not the leave CTA');
  // No questionnaire is offered here, in any wording.
  const t = screenText(h);
  for (const w of ['Начать', 'Изменить', 'Новая заявка', 'Начать заново', 'Повторить']) {
    assert(t.indexOf(w) === -1, 'the terminal screen offers a way back into qualification: ' + w);
  }
});

await check('SUCCESS_TERMINAL — pressing the CTA causes no qualification transition', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  buttons(h)[0].fire('click');
  await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'the state left the terminal screen');
});

await check('SUCCESS_TERMINAL — the back control is hidden, so there is no route back either', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  eq(h.back.hidden, true, 'the back control is offered on a terminal screen');
});

// ── SUCCESS_RETURN_TELEGRAM ───────────────────────────────────────────────────────────────────

await check('SUCCESS_RETURN_TELEGRAM — one tap closes the Mini App exactly once', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  eq(h.closed.count, 0, 'something closed the app before the tap');
  buttons(h)[0].fire('click');
  eq(h.closed.count, 1, 'closes after one tap');
});

await check('SUCCESS_RETURN_TELEGRAM — the tap sends NO request of any kind', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  const before = h.sent.length;
  buttons(h)[0].fire('click');
  await h.settle();
  await h.settle();
  eq(h.sent.length, before, 'the leave CTA sent a request');
  eq(h.to(SUBMIT).length, 1, 'the leave CTA resubmitted');
  eq(h.to(SESSION).filter((s) => s.method === 'PUT').length,
    h.sent.filter((s) => s.url.indexOf(SESSION) !== -1 && s.method === 'PUT').length, 'session writes moved');
});

await check('SUCCESS_RETURN_TELEGRAM — the tap mutates no draft and no session', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  const before = JSON.stringify(h.api.draft);
  const sessionWritesBefore = h.to(SESSION).length;
  buttons(h)[0].fire('click');
  await h.settle();
  eq(JSON.stringify(h.api.draft), before, 'the draft changed when the client left');
  eq(h.to(SESSION).length, sessionWritesBefore, 'a session write happened when the client left');
});

await check('SUCCESS_RETURN_TELEGRAM — repeated taps close again and still send nothing', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  const before = h.sent.length;
  buttons(h)[0].fire('click');
  buttons(h)[0].fire('click');
  buttons(h)[0].fire('click');
  await h.settle();
  eq(h.closed.count, 3, 'closes after three taps');
  eq(h.sent.length, before, 'a repeated tap sent a request');
});

// A Telegram build with no `close` on the WebApp object is the closest offline stand-in for the
// reported defect: the app is a real Mini App, the CTA is pressed, and nothing leaves.
await check('SUCCESS_RETURN_TELEGRAM — a Telegram API without close fails safely, no crash', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  delete h.win.Telegram.WebApp.close;
  buttons(h)[0].fire('click');
  await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'the screen broke when close was unavailable');
  eq(h.closed.count, 0, 'something closed without a close method');
});

await check('SUCCESS_RETURN_TELEGRAM — a close that does not happen says how to leave', async () => {
  const h = await succeed({ documents: ['Cash Flow'] });
  delete h.win.Telegram.WebApp.close;
  assert(screenText(h).indexOf(B.CLOSE_HINT) === -1, 'the hint is part of the screen as first rendered');
  buttons(h)[0].fire('click');
  assert(screenText(h).indexOf(B.CLOSE_HINT) === -1, 'the hint appeared before the close could have failed');
  await new Promise((r) => setTimeout(r, 1100));
  assert(screenText(h).indexOf(B.CLOSE_HINT) !== -1, 'a dead CTA left the client with no way out and nothing said');
  // It is a hint, not a second exit: it must not be a control.
  eq(buttons(h).length, 1, 'the hint added a second action');
});

// Outside Telegram entirely the client never reaches success — bootstrap has no signed context.
// The screen it DOES reach carries the same CTA, through the same one integration point.
await check('outside Telegram the boot-failure CTA is safe too, and closes nothing', async () => {
  const h = boot({ telegram: false });
  await h.settle();
  eq(h.state(), 'APP_BOOT_FAILURE', 'the client outside Telegram');
  const b = byClass(h.main, 'btn');
  eq(b.length, 1, 'buttons on the boot-failure screen');
  b[0].fire('click');
  await h.settle();
  eq(h.state(), 'APP_BOOT_FAILURE', 'the screen broke with no Telegram API at all');
  eq(h.closed.count, 0, 'something closed with no Telegram API at all');
});

await check('there is exactly ONE Telegram close in the client, and every exit routes through it', async () => {
  const src = require('node:fs').readFileSync(join(ROOT, 'app-premium', 'app.js'), 'utf8');
  const calls = (src.match(/tg\.close\(\)/g) || []).length;
  eq(calls, 1, 'the client grew a second Telegram close integration');
  const routed = (src.match(/closeApp\(/g) || []).length;
  assert(routed >= 4, 'not every terminal screen routes through closeApp (declaration + 3 screens)');
});

// ── SUCCESS_MATERIALS_COPY ────────────────────────────────────────────────────────────────────

await check('SUCCESS_MATERIALS_COPY — declared materials: the screen says what is AVAILABLE', async () => {
  const h = await succeed({ documents: ['Cash Flow', 'Бюджет'] });
  const t = screenText(h);
  assert(t.indexOf(B.SUCCESS.materials.declared) !== -1, 'the declared-materials sentence is missing');
  assert(t.indexOf(B.SUCCESS.materials.none) === -1, 'both materials sentences rendered');
});

await check('SUCCESS_MATERIALS_COPY — no materials: the sentence is REPLACED, never emptied', async () => {
  const h = await succeed({ documents: [] });
  const t = screenText(h);
  assert(t.indexOf(B.SUCCESS.materials.none) !== -1, 'the no-materials sentence is missing');
  assert(t.indexOf(B.SUCCESS.materials.declared) === -1, 'the materials sentence survived an empty declaration');
  assert(!/материал/i.test(t), 'an empty materials concept is still rendered: ' + t);
});

await check('SUCCESS_MATERIALS_COPY — a null documents field reads as no materials, not as a crash', async () => {
  const h = await succeed({});
  assert(screenText(h).indexOf(B.SUCCESS.materials.none) !== -1, 'an untouched documents field did not fall back');
});

await check('SUCCESS_MATERIALS_COPY — the screen NEVER claims an attachment, in either variant', async () => {
  for (const docs of [['Cash Flow'], []]) {
    const h = await succeed({ documents: docs });
    const t = screenText(h);
    assert(!/прилож/i.test(t), 'the success screen claims an attachment: ' + t);
    assert(!/загруж/i.test(t), 'the success screen claims an upload: ' + t);
  }
});

// The ban is on the CONTRACT, not on one screen: a phrase reintroduced anywhere in the
// customer-facing bundle fails here, whichever screen it lands on.
await check('no customer-facing Premium RU screen claims a file was attached or uploaded', () => {
  const FORBIDDEN = ['приложенные материалы', 'приложенные файлы', 'файлы приложены',
    'документы загружены', 'файлы загружены', 'прикреплённые материалы'];
  const bundle = require('node:fs').readFileSync(join(ROOT, 'app-premium', 'content.js'), 'utf8').toLowerCase();
  for (const phrase of FORBIDDEN) {
    assert(bundle.indexOf(phrase) === -1, 'a false attachment claim is back in the bundle: ' + phrase);
  }
  // The two screens that talk about materials as a RESULT must not use the verb at all.
  assert(!/прилож/i.test(JSON.stringify(B.SUCCESS)), 'the success copy claims an attachment');
  assert(!/прилож/i.test(JSON.stringify(B.REVIEW.materialsStatus)), 'the readiness block claims an attachment');
});

await check('the declared materials still reach the brief, unchanged and un-reinterpreted', async () => {
  const h = await succeed({ documents: ['Бюджет'] });
  // The field survives the terminal screen: the consultant brief is built from the draft, and
  // «Бюджет» must still mean «Бюджет», not «Бюджет.xlsx».
  eq(JSON.stringify(h.api.get('documents')), JSON.stringify(['Бюджет']), 'the declared list changed');
  eq(B.REVIEW.materialsStatus.present, 'Материалы — указаны', 'the readiness wording drifted');
  eq(B.EDIT.rows.filter((r) => r.field === 'documents').length, 1, 'documents left the edit selector');
});

// ── the small language correction ─────────────────────────────────────────────────────────────

await check('«brief» is written in Russian on every customer-facing screen', () => {
  eq(B.SUCCESS.next[0], 'FINMENTOR изучит бриф.', 'the next-steps wording');
  eq(JSON.stringify(B.SUCCESS.next), JSON.stringify([
    'FINMENTOR изучит бриф.', 'При необходимости уточним детали.', 'Согласуем следующий контакт.'
  ]), 'the three next steps');
  assert(!/\bbrief\b/i.test(JSON.stringify(B.SUCCESS)), 'the Latin word is back on the success screen');
  assert(!/\bbrief\b/i.test(JSON.stringify(B.REVIEW)), 'the Latin word reached the review screen');
  // NOT bundle-wide, and deliberately so. PRIVACY.lines still reads «Передавая brief, вы
  // подтверждаете…» — the same Latin word on a customer-facing screen, in consent copy this pass
  // was told not to touch. It is recorded here rather than silently widened into a legal string.
  assert(/\bbrief\b/.test(JSON.stringify(B.PRIVACY)),
    'the privacy consent line was changed — if that was deliberate, retire this assertion and the note above');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('ASSERTIONS: ' + pass + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
process.exit(failures.length ? 1 : 0);
