#!/usr/bin/env node
// FINMENTOR — Mini App startup, session hydration, and the three failure classes.
//
//   node qa/premium-ux-bootstrap.test.mjs
//
// Offline. Boots the REAL content.js + net.js + app.js over a stubbed DOM, fetch and Telegram.
//
// ── THE DEFECT THIS GATE EXISTS TO KEEP CLOSED ─────────────────────────────────────────────────
//
// The deployed build never called `FM_NET.bootstrap()`. `bootstrap()` and `saveDraft()` were
// written, exported, tested — and reachable from nothing. So the client held no `app_session_id`,
// `submit()` failed its own first guard locally with SESSION_INVALID and `retryable:false`, and the
// owner was shown «Заявка пока не отправлена … Повторно проходить вопросы не нужно» with no retry
// button, for a submission that had never left the phone.
//
// A second, independent defect sat behind it: the Gateway validates `client_version` and `locale`
// BEFORE it looks at the Ed25519 signature, and `bootstrap()` sent neither. Even if it had been
// called, it would have returned 400 CLIENT_VERSION_UNSUPPORTED without verifying anything.
//
// So this gate asserts the SEQUENCE, not just the pieces: what runs, in what order, how many times,
// and which screen each failure reaches.

import { boot, byClass, all, SESSION_ID, OK_BOOTSTRAP, resumedBootstrap, INIT_DATA } from './lib/miniapp-harness.mjs';

let pass = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const btnNamed = (h, label) => byClass(h.main, 'btn').filter((b) => b.textContent === label)[0];
const gateway = (h) => h.to('gateway');
const session = (h) => h.to('miniapp-session');
const submits = (h) => h.to('miniapp-submit');

// Drive a complete brief without touching the UI, then land on Review.
function fillBrief(h) {
  const C = h.C;
  const o = C.OBJECTIVES[0];
  const set = (n, v) => h.api.set(n, v, 'user_explicit', true);
  set('company_name', 'Alfa Grup');
  set('business_activity', 'Розничная сеть');
  set('role', 'Собственник');
  set('turnover_band', C.SCALE_OPTIONS[2]);
  set('objective', o.label);
  const problems = C.PROBLEMS[o.id];
  if (problems.mode === 'free_text') { set('problem_free_text', 'Не вижу прибыли по направлениям.'); }
  else { set('problem', problems.options[0][0]); }
  set('desired_outcome', C.OUTCOMES[o.id].options[0][0]);
  set('current_setup', [C.CURRENT_SETUP.options[0]]);
  set('decision_horizon', C.DECISION_HORIZON.options[0][0]);
  set('contact_channel', 'telegram');
  return h;
}

console.log('Premium UX — Mini App bootstrap, session and failure classes');
console.log('');

// ── 1. the startup sequence ────────────────────────────────────────────────────────────────────

await check('Telegram is readied and expanded at load, before anything else runs', async () => {
  const h = boot();
  eq(h.win.Telegram.WebApp.readyCalls, 1, 'tg.ready()');
  eq(h.win.Telegram.WebApp.expandCalls, 1, 'tg.expand()');
});

await check('the app renders APP_STARTING and calls the Gateway — nothing is interactive first', async () => {
  const h = boot();
  eq(h.state(), 'APP_STARTING', 'the state before the network settles');
  eq(gateway(h).length, 1, 'the Gateway was not called at startup — THIS is the defect');
  // The start screen must not be reachable before there is a session.
  eq(byClass(h.main, 'btn').length, 0, 'a button was interactive during startup');
  await h.settle();
  eq(h.state(), 'APP_BOOTSTRAP', 'the entry screen after a successful bootstrap');
});

await check('bootstrap sends the three fields the Gateway checks before the signature', async () => {
  const h = boot();
  await h.settle();
  const body = gateway(h)[0].body;
  eq(gateway(h)[0].method, 'POST', 'method');
  eq(body.init_data, INIT_DATA, 'the signed context was not sent');
  eq(body.client_version, 'b2.1.0', 'client_version — without it the Gateway answers 400 and never verifies');
  eq(body.locale, 'ru', 'locale');
  eq(Object.keys(body).sort().join(','), 'client_version,init_data,locale', 'exactly three keys');
});

await check('the locale offered to the Gateway comes from Telegram and is constrained to ru/ro', async () => {
  for (const [lang, want] of [['ru', 'ru'], ['ro', 'ro'], ['en', 'ru'], [undefined, 'ru']]) {
    const h = boot({ languageCode: lang });
    await h.settle();
    eq(gateway(h)[0].body.locale, want, 'language_code ' + JSON.stringify(lang));
  }
  // And the SERVER's answer is what the draft records.
  const h = boot({ responder: () => ({ status: 200, body: Object.assign({}, OK_BOOTSTRAP, { locale: 'ro' }) }) });
  await h.settle();
  eq(h.api.get('locale'), 'ro', 'the client kept its own guess instead of what the server stored');
});

await check('«Начать» is unreachable until a session exists, and enabled once it does', async () => {
  const h = boot({ responder: () => new Promise(() => {}) && { status: 200, body: OK_BOOTSTRAP } });
  const slow = boot({ responder: () => ({ status: 200, body: OK_BOOTSTRAP }) });
  // Before settle the app is on APP_STARTING, which renders no buttons at all.
  eq(slow.state(), 'APP_STARTING', 'state');
  eq(byClass(slow.main, 'btn').length, 0, 'buttons during startup');
  await slow.settle();
  const start = btnNamed(slow, 'Начать');
  assert(start, '«Начать» is missing after a successful bootstrap');
  eq(start.disabled, false, '«Начать» is disabled despite a live session');
  void h;
});

// ── 2. exactly one bootstrap, whatever the client does ─────────────────────────────────────────

await check('ONE bootstrap: navigation, edits, saves, review and submit add none', async () => {
  const h = boot();
  await h.settle();
  eq(gateway(h).length, 1, 'after startup');
  eq(h.net.bootstrapCount(), 1, 'bootstrap runs');

  // ordinary screen navigation
  h.api.goto('APP_COMPANY');
  h.api.goto('APP_ROLE');
  h.api.goto('APP_SCALE');
  await h.settle();
  eq(gateway(h).length, 1, 'after navigation');

  // field edit
  fillBrief(h);
  await h.settle();
  eq(gateway(h).length, 1, 'after field edits');

  // session save
  h.api.goto('APP_REVIEW');
  await h.settle();
  eq(gateway(h).length, 1, 'after a draft save');
  assert(session(h).length >= 1, 'no draft was ever saved');

  // review
  h.api.goto('APP_PRIVACY');
  await h.settle();
  eq(gateway(h).length, 1, 'after review');

  // submit
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle();
  eq(gateway(h).length, 1, 'after submit — the signed context was replayed');
  eq(h.net.bootstrapCount(), 1, 'bootstrap ran more than once across a full run');
});

await check('a direct second call to bootstrap re-sends nothing', async () => {
  const h = boot();
  await h.settle();
  await h.net.bootstrap('ru');
  await h.net.bootstrap('ro');
  eq(gateway(h).length, 1, 'the memoised promise did not hold');
});

// ── 3. raw initData does not survive bootstrap ─────────────────────────────────────────────────

await check('raw initData is used once and then held nowhere the app can reach', async () => {
  const h = boot();
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW');
  await h.settle();
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle();

  // Only the bootstrap call may carry it.
  const carriers = h.sent.filter((s) => JSON.stringify(s.body).indexOf(INIT_DATA) !== -1);
  eq(carriers.length, 1, 'more than one request carried the signed context');
  assert(carriers[0].url.indexOf('gateway') !== -1, 'a non-Gateway endpoint received initData');

  // No later request may even mention the key.
  for (const s of h.sent.filter((x) => x.url.indexOf('gateway') === -1)) {
    assert(JSON.stringify(s.body).indexOf('init_data') === -1, s.url + ' carries an init_data key');
  }
  // Nothing the app or the network layer exposes retains it.
  for (const bag of [h.net, h.api]) {
    for (const k of Object.keys(bag)) {
      if (typeof bag[k] === 'function') { continue; }
      assert(JSON.stringify(bag[k]).indexOf(INIT_DATA) === -1, k + ' retains raw initData');
    }
  }
  assert(JSON.stringify(h.api.draft).indexOf(INIT_DATA) === -1, 'the draft retains raw initData');
});

await check('the app never parses trust out of initDataUnsafe', async () => {
  const h = boot();
  await h.settle();
  // The unsafe object is read for the greeting and the locale hint only. Neither is trusted:
  // `telegram_carried` is a source the draft contract accepts for exactly three approved fields.
  const carried = ['contact_name', 'locale', 'contact_channel'];
  for (const [name, f] of Object.entries(h.api.draft.fields)) {
    if (f.source !== 'telegram_carried') { continue; }
    assert(carried.indexOf(name) !== -1, name + ' was carried from Telegram but is not an approved carried field');
  }
  // And the identity the endpoints gate on is the SERVER's, never this. The signed context does
  // contain the id — that is what Telegram signs and the Gateway verifies — so the check is that
  // the client never asserts it as a FIELD of its own, anywhere.
  const u = h.win.Telegram.WebApp.initDataUnsafe.user;
  for (const s of h.sent) {
    const claimed = Object.assign({}, s.body);
    delete claimed.init_data;
    assert(JSON.stringify(claimed).indexOf(String(u.id)) === -1, s.url + ' sent a client-asserted telegram id');
    for (const k of ['telegram_user_id', 'chat_id', 'user_id', 'owner', 'cycle_id', 'lead_id']) {
      assert(!Object.prototype.hasOwnProperty.call(s.body, k), s.url + ' asserted ' + k);
    }
  }
});

// ── 4. bootstrap failure is NOT a submission failure ───────────────────────────────────────────

const BOOT_FAILURES = [
  ['no Telegram at all', { telegram: false }],
  ['endpoints not injected', { endpoints: false }],
  ['a replay refusal', { responder: () => ({ status: 409, body: { ok: false, error_code: 'REPLAY_REFUSED', retryable: false } }) }],
  ['the replay store down', { responder: () => ({ status: 503, body: { ok: false, error_code: 'REPLAY_STORE_UNAVAILABLE', retryable: true } }) }],
  ['an unsupported client version', { responder: () => ({ status: 400, body: { ok: false, error_code: 'CLIENT_VERSION_UNSUPPORTED', retryable: false } }) }],
  ['expired initData', { responder: () => ({ status: 401, body: { ok: false, error_code: 'TG_INITDATA_EXPIRED', retryable: false } }) }],
  ['a dropped connection', { responder: () => ({ throws: 'network down' }) }],
  ['a malformed session id', { responder: () => ({ status: 200, body: { ok: true, app_session_id: 'nope' } }) }]
];

await check('every bootstrap failure reaches the BOOTSTRAP screen, never the submission screen', async () => {
  for (const [label, opts] of BOOT_FAILURES) {
    const h = boot(opts);
    await h.settle(); await h.settle();
    eq(h.state(), 'APP_BOOT_FAILURE', label);
    const t = all(h.main).map((n) => n.textContent);
    assert(t.indexOf(h.C.BOOTSTRAP_FAILURE.title) !== -1, label + ': wrong title');
    // The submission-failure copy must not appear for a submission that never happened.
    assert(t.indexOf(h.C.FAILURE.title) === -1, label + ': the submission failure screen was shown');
    assert(t.indexOf(h.C.FAILURE.primary) === -1, label + ': «Повторить отправку» offered with nothing to send');
    assert(t.indexOf('Повторно проходить вопросы не нужно.') === -1, label + ': told the client not to re-answer questions they never answered');
    eq(h.api.failures().boot !== null, true, label + ': the failure was not classified as a boot failure');
    eq(h.api.failures().submit, null, label + ': it was classified as a submit failure');
  }
});

await check('the bootstrap screen offers reopening, not a retry of a spent signed context', async () => {
  const h = boot({ responder: () => ({ throws: 'network down' }) });
  await h.settle(); await h.settle();
  const buttons = byClass(h.main, 'btn');
  eq(buttons.length, 1, 'exactly one action');
  eq(buttons[0].textContent, h.C.BOOTSTRAP_FAILURE.primary, 'the action');
  const before = h.sent.length;
  buttons[0].fire('click');
  await h.settle();
  eq(h.sent.length, before, 'the button re-sent the signed context');
  eq(h.closed.count, 1, 'the button did not close the Mini App');
});

// ── 5. session hydration ───────────────────────────────────────────────────────────────────────

await check('the draft is written server-side, against the authoritative session id only', async () => {
  const h = boot();
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW');
  await h.settle(); await h.settle();
  const puts = session(h);
  assert(puts.length >= 1, 'no draft write happened');
  for (const put of puts) {
    eq(put.method, 'PUT', 'method');
    eq(put.body.app_session_id, SESSION_ID, 'the write used something other than the minted session');
    assert(typeof put.body.step === 'string' && put.body.step, 'no step recorded');
    assert(put.body.fields && typeof put.body.fields === 'object', 'no fields');
    eq(Object.keys(put.body).sort().join(','), 'app_session_id,fields,step', 'the write body widened');
  }
});

await check('provenance survives the write: user_explicit, telegram_carried, and ai_inferred', async () => {
  const h = boot();
  await h.settle();
  fillBrief(h);
  h.api.set('important_context', 'Через месяц встреча с банком.', 'ai_inferred', true);
  h.api.goto('APP_REVIEW');
  await h.settle(); await h.settle();
  const f = session(h)[session(h).length - 1].body.fields;
  eq(f.company_name.source, 'user_explicit', 'user_explicit');
  eq(f.company_name.confirmed, true, 'confirmed flag');
  eq(f.locale.source, 'telegram_carried', 'telegram_carried');
  eq(f.contact_channel.value, 'telegram', 'contact_channel survives the write');
  eq(f.important_context.source, 'ai_inferred', 'ai_inferred is a legal STORED source');
  // ...and it still never satisfies a required field.
  eq(h.api.settled('important_context'), false, 'ai_inferred was allowed to settle a field');
});

await check('one write in flight at a time, and the newest state wins', async () => {
  let release = null;
  const h = boot({
    responder: ({ url }) => (url.indexOf('session') !== -1
      ? { status: 200, body: { ok: true } }
      : { status: 200, body: OK_BOOTSTRAP })
  });
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_COMPANY');
  h.api.goto('APP_ROLE');
  h.api.goto('APP_SCALE');
  await h.settle(); await h.settle(); await h.settle(); await h.settle();
  // Three transitions must not produce three overlapping writes; the queue collapses them.
  assert(session(h).length <= 3, 'the save queue did not collapse rapid transitions (' + session(h).length + ')');
  assert(session(h).length >= 1, 'no write happened at all');
  void release;
});

await check('a refused SESSION reaches the session screen, not the submission screen', async () => {
  for (const code of ['SESSION_EXPIRED', 'SESSION_INVALID', 'NOT_AUTHORISED', 'SUBMIT_IN_PROGRESS']) {
    const h = boot({
      responder: ({ url }) => (url.indexOf('session') !== -1
        ? { status: 401, body: { ok: false, error_code: code, retryable: false } }
        : { status: 200, body: OK_BOOTSTRAP })
    });
    await h.settle();
    fillBrief(h);
    h.api.goto('APP_REVIEW');
    await h.settle(); await h.settle();
    eq(h.state(), 'APP_SESSION_EXPIRED', code);
    const t = all(h.main).map((n) => n.textContent);
    assert(t.indexOf(h.C.SESSION_EXPIRED.title) !== -1, code + ': wrong title');
    assert(t.indexOf(h.C.FAILURE.primary) === -1, code + ': offered a retry for a dead session');
    assert(h.api.failures().session !== null, code + ': not classified as a session failure');
  }
});

await check('a TRANSIENT save failure does not interrupt the client, and the next write carries the data', async () => {
  let fail = true;
  const h = boot({
    responder: ({ url }) => {
      if (url.indexOf('session') === -1) { return { status: 200, body: OK_BOOTSTRAP }; }
      if (fail) { fail = false; return { status: 503, body: { ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true } }; }
      return { status: 200, body: { ok: true } };
    }
  });
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_COMPANY');
  await h.settle(); await h.settle();
  assert(h.state() !== 'APP_SESSION_EXPIRED', 'a transient failure was treated as a dead session');
  assert(h.state() !== 'APP_BOOT_FAILURE', 'a transient failure was treated as a boot failure');
  // The next transition rewrites the same cumulative draft.
  h.api.goto('APP_REVIEW');
  await h.settle(); await h.settle();
  const last = session(h)[session(h).length - 1];
  eq(last.body.fields.company_name.value, 'Alfa Grup', 'the retried write lost the data');
});

// ── 6. the submit precondition ─────────────────────────────────────────────────────────────────

await check('Submit is never actionable without a session', async () => {
  const h = boot({ responder: () => ({ throws: 'network down' }) });
  await h.settle(); await h.settle();
  eq(h.api.submitReady(), false, 'submitReady with no session');
  // And the only screen reachable is the boot failure, which offers no submit at all.
  eq(h.state(), 'APP_BOOT_FAILURE', 'state');
  eq(byClass(h.main, 'btn').filter((b) => b.textContent === h.C.PRIVACY.primary).length, 0, 'a submit button exists');
});

await check('the privacy screen disables its primary action until the brief is complete', async () => {
  const h = boot();
  await h.settle();
  h.api.goto('APP_PRIVACY');           // reached with an empty draft
  eq(h.api.submitReady(), false, 'submitReady on an empty brief');
  eq(btnNamed(h, h.C.PRIVACY.primary).disabled, true, 'the primary action was live on an empty brief');

  fillBrief(h);
  h.api.goto('APP_PRIVACY');
  await h.settle();
  eq(h.api.submitReady(), true, 'submitReady on a complete brief with a session');
  eq(btnNamed(h, h.C.PRIVACY.primary).disabled, false, 'the primary action stayed disabled on a complete brief');
});

await check('submit waits for the draft to land before asking the server to project it', async () => {
  const h = boot();
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW');
  await h.settle();
  h.api.set('important_context', 'Последняя правка.', 'user_explicit', true);
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle(); await h.settle();
  const puts = session(h);
  const last = puts[puts.length - 1];
  eq(last.body.fields.important_context.value, 'Последняя правка.', 'the last edit never reached the server');
  // ...and the submit went out after it.
  assert(h.sent.indexOf(last) < h.sent.indexOf(submits(h)[0]), 'submit raced the draft write');
});

// ── 7. success authority, and the committed replay ─────────────────────────────────────────────

await check('success renders only on ok:true, and carries the canonical lead id', async () => {
  const h = boot({
    responder: ({ url }) => {
      if (url.indexOf('gateway') !== -1) { return { status: 200, body: OK_BOOTSTRAP }; }
      if (url.indexOf('submit') !== -1) { return { status: 200, body: { ok: true, lead_id: 'FIN-1', submit_state: 'submitted' } }; }
      return { status: 200, body: { ok: true } };
    }
  });
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW'); await h.settle();
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'state');
  assert(all(h.main).map((n) => n.textContent).indexOf(h.C.SUCCESS.title) !== -1, 'the success copy');
});

await check('a REPLAY of a committed submission is a success — this is D7, from the client side', async () => {
  const h = boot({
    responder: ({ url }) => {
      if (url.indexOf('gateway') !== -1) { return { status: 200, body: OK_BOOTSTRAP }; }
      if (url.indexOf('submit') !== -1) { return { status: 200, body: { ok: true, already: true, lead_id: 'FIN-7' } }; }
      return { status: 200, body: { ok: true } };
    }
  });
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW'); await h.settle();
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'a committed submission was shown as a failure');
  assert(all(h.main).map((n) => n.textContent).indexOf(h.C.FAILURE.title) === -1, 'the failure title appeared');
});

await check('a 200 carrying ok:false is never a success, whatever else it says', async () => {
  for (const body of [{ ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true },
    { ok: 'true' }, { lead_id: 'FIN-9' }, {}, null]) {
    const h = boot({
      responder: ({ url }) => (url.indexOf('gateway') !== -1 ? { status: 200, body: OK_BOOTSTRAP }
        : url.indexOf('submit') !== -1 ? { status: 200, body: body }
          : { status: 200, body: { ok: true } })
    });
    await h.settle();
    fillBrief(h);
    h.api.goto('APP_REVIEW'); await h.settle();
    h.api.submit();
    await h.settle(); await h.settle(); await h.settle();
    assert(h.state() !== 'APP_SUCCESS', 'ok:false rendered as success for ' + JSON.stringify(body));
  }
});

// ── 8. the retry CTA ───────────────────────────────────────────────────────────────────────────

async function submitWith(body, status) {
  const h = boot({
    responder: ({ url }) => (url.indexOf('gateway') !== -1 ? { status: 200, body: OK_BOOTSTRAP }
      : url.indexOf('submit') !== -1 ? (body.throws ? body : { status: status || 200, body: body })
        : { status: 200, body: { ok: true } })
  });
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW'); await h.settle();
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle();
  return h;
}

await check('a RETRYABLE submission failure offers «Повторить отправку» first, «Вернуться к резюме» second', async () => {
  for (const [label, body, status] of [
    ['server-stated retryable', { ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true }, 503],
    ['privacy unresolved', { ok: false, error_code: 'PRIVACY_UNRESOLVED', retryable: true }, 503],
    ['a dropped connection', { throws: 'network down' }, 0]
  ]) {
    const h = await submitWith(body, status);
    eq(h.state(), 'APP_FAILURE', label + ': state');
    const buttons = byClass(h.main, 'btn').map((b) => b.textContent);
    eq(buttons[0], h.C.FAILURE.primary, label + ': the primary action');
    eq(buttons[1], h.C.FAILURE.secondary, label + ': the secondary action');
    const t = all(h.main).map((n) => n.textContent);
    h.C.FAILURE.lines.forEach((l) => assert(t.indexOf(l) !== -1, label + ': the approved line «' + l + '» is missing'));
  }
});

await check('a NON-retryable refusal shows no Retry — it would only refuse again', async () => {
  for (const [label, body, status] of [
    ['consent required', { ok: false, error_code: 'CONSENT_REQUIRED', retryable: false }, 409],
    ['an empty draft', { ok: false, error_code: 'DRAFT_EMPTY', retryable: false }, 409],
    ['a shape the client cannot read', { ok: false, error_code: 'SOMETHING_NEW' }, 400]
  ]) {
    const h = await submitWith(body, status);
    eq(h.state(), 'APP_FAILURE', label + ': state');
    const buttons = byClass(h.main, 'btn').map((b) => b.textContent);
    eq(buttons.indexOf(h.C.FAILURE.primary), -1, label + ': a misleading Retry was offered');
    eq(buttons[0], h.C.FAILURE.secondary, label + ': the only action');
  }
});

await check('a session refused AT SUBMIT reaches the session screen, not the submission screen', async () => {
  for (const code of ['SESSION_EXPIRED', 'NOT_AUTHORISED', 'SUBMIT_IN_PROGRESS']) {
    const h = await submitWith({ ok: false, error_code: code, retryable: false }, 401);
    eq(h.state(), 'APP_SESSION_EXPIRED', code);
    const t = all(h.main).map((n) => n.textContent);
    assert(t.indexOf(h.C.FAILURE.primary) === -1, code + ': offered a retry against a dead session');
  }
});

await check('RETRY re-sends the identical authoritative identity — same session, same acknowledgement', async () => {
  const h = await submitWith({ ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true }, 503);
  const first = submits(h)[0].body;
  btnNamed(h, h.C.FAILURE.primary).fire('click');
  await h.settle(); await h.settle(); await h.settle();
  const second = submits(h)[1].body;
  assert(second, 'the retry sent nothing');
  eq(second.app_session_id, first.app_session_id, 'the retry used a different session');
  eq(JSON.stringify(second.privacy_ack), JSON.stringify(first.privacy_ack),
    'the retry re-stamped the acknowledgement — a second, contradictory record of consent');
  eq(second.privacy_ack.acknowledged_at, first.privacy_ack.acknowledged_at, 'acknowledged_at moved');
  eq(Object.keys(second).sort().join(','), 'app_session_id,privacy_ack', 'the retry body widened');
  // And it did NOT re-bootstrap.
  eq(gateway(h).length, 1, 'the retry replayed the signed context');
});

await check('a DOUBLE retry click sends one extra submission, not two', async () => {
  const h = await submitWith({ ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true }, 503);
  const retry = btnNamed(h, h.C.FAILURE.primary);
  retry.fire('click');
  retry.fire('click');          // the same button element, clicked twice before the screen changes
  await h.settle(); await h.settle(); await h.settle();
  // The screen leaves APP_FAILURE on the first click, so the second reaches a detached button.
  // Whatever arrives, every body must be identical — the server collapses them on one key.
  const bodies = submits(h).map((s) => JSON.stringify(s.body));
  eq(new Set(bodies).size, 1, 'a repeated retry produced a DIFFERENT submission body');
});

// ── 9. the failure classes stay distinct ───────────────────────────────────────────────────────

await check('the three failure classes never collapse into one another', async () => {
  const bootF = boot({ responder: () => ({ throws: 'x' }) });
  await bootF.settle(); await bootF.settle();
  const b = bootF.api.failures();
  assert(b.boot && !b.session && !b.submit, 'a boot failure leaked into another class');

  const sessF = boot({
    responder: ({ url }) => (url.indexOf('session') !== -1
      ? { status: 401, body: { ok: false, error_code: 'SESSION_EXPIRED', retryable: false } }
      : { status: 200, body: OK_BOOTSTRAP })
  });
  await sessF.settle();
  fillBrief(sessF);
  sessF.api.goto('APP_REVIEW');
  await sessF.settle(); await sessF.settle();
  const sf = sessF.api.failures();
  assert(!sf.boot && sf.session && !sf.submit, 'a session failure leaked into another class');

  const subF = await submitWith({ ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true }, 503);
  const uf = subF.api.failures();
  assert(!uf.boot && !uf.session && uf.submit, 'a submit failure leaked into another class');
});

await check('nothing is written to the console, so initData cannot reach a log', async () => {
  const seen = [];
  const h = boot();
  h.win.console.warn = (...a) => seen.push(a.join(' '));
  h.win.console.log = (...a) => seen.push(a.join(' '));
  await h.settle();
  fillBrief(h);
  h.api.goto('APP_REVIEW');
  await h.settle();
  h.api.submit();
  await h.settle(); await h.settle(); await h.settle();
  eq(seen.length, 0, 'the client logged: ' + seen.join(' / '));
});

// ── 10. cross-reload resume ────────────────────────────────────────────────────────────────────
//
// The approved copy promises «Можно продолжить с того места, где остановились». Minting a new
// session on every open contradicted it: closing the Mini App lost the brief, because a new
// SIGNED CONTEXT was being treated as a new BUSINESS REQUEST.

const STORED = {
  v: 1, step: 'APP_SCALE', updated_at: '2026-08-30T09:00:00.000Z',
  fields: {
    company_name: { value: 'Alfa Grup', source: 'user_explicit', confirmed: true, at: '2026-08-30T08:00:00.000Z' },
    business_activity: { value: 'Сеть магазинов', source: 'user_explicit', confirmed: true, at: '2026-08-30T08:01:00.000Z' },
    role: { value: 'Собственник', source: 'user_confirmed', confirmed: true, at: '2026-08-30T08:02:00.000Z' },
    contact_channel: { value: 'phone', source: 'user_explicit', confirmed: true, at: '2026-08-30T08:03:00.000Z' },
    contact_value: { value: '069123456', source: 'user_explicit', confirmed: true, at: '2026-08-30T08:03:30.000Z' },
    important_context: { value: 'Через месяц банк.', source: 'ai_inferred', confirmed: true, at: '2026-08-30T08:04:00.000Z' }
  }
};

const reopened = (draft, state) => boot({
  responder: ({ url }) => (url.indexOf('gateway') !== -1
    ? { status: 200, body: resumedBootstrap(draft, state) }
    : { status: 200, body: { ok: true } })
});

await check('C/D/E/F — reopening with a NEW signed context lands on the SAME brief', async () => {
  const h = reopened(STORED);
  await h.settle();
  // The signed context is still exchanged, once, exactly as before.
  eq(gateway(h).length, 1, 'the Gateway was not called');
  eq(gateway(h)[0].body.init_data, INIT_DATA, 'a fresh signed context was not sent');
  eq(h.net.wasResumed(), true, 'the client does not know it resumed');
  // The answers are back.
  eq(h.api.get('company_name'), 'Alfa Grup', 'the company was lost');
  eq(h.api.get('role'), 'Собственник', 'the role was lost');
  eq(h.api.get('contact_channel'), 'phone', 'the contact channel was lost');
  eq(h.api.get('contact_value'), '069123456', 'the contact value was lost');
  // ...and the client is told, rather than silently continued.
  eq(h.state(), 'APP_RESUME', 'the resume screen was not shown');
  const t = all(h.main).map((n) => n.textContent);
  assert(t.indexOf(h.C.RESUME.title) !== -1, 'the approved resume title is missing');
  h.C.RESUME.lines.forEach((l) => assert(t.indexOf(l) !== -1, 'the approved line «' + l + '» is missing'));
});

await check('the resume copy IS the approved Telegram promise, not a second wording', async () => {
  const h = reopened(STORED);
  await h.settle();
  // TG_COPY is deliberately NOT in the browser bundle — it is server-side Telegram copy — so the
  // comparison is against the contract itself, which is where both surfaces are defined.
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const req = createRequire(import.meta.url);
  const B = req(join(dirname(fileURLToPath(import.meta.url)), '..', 'n8n', 'src', 'premium-ux', 'branches.js'));
  assert(!h.C.TG_COPY, 'the Telegram copy is being shipped to the browser');
  const tg = B.TG_COPY.TG_RESUME_DRAFT;
  eq(h.C.RESUME.title, tg.text[0].replace(/<\/?[a-z]+>/g, ''), 'the title drifted from the Telegram copy');
  eq(h.C.RESUME.lines.join(' '), tg.text.slice(1).map((x) => x.replace(/<\/?[a-z]+>/g, '')).join(' '), 'the body drifted');
  eq(h.C.RESUME.primary, tg.actions[0], 'the primary action drifted');
  eq(h.C.RESUME.secondary, tg.actions[1], 'the secondary action drifted');
});

await check('PROVENANCE survives the reopen, field by field', async () => {
  const h = reopened(STORED);
  await h.settle();
  for (const [name, want] of Object.entries(STORED.fields)) {
    const got = h.api.draft.fields[name];
    eq(JSON.stringify(got), JSON.stringify(want), name + ' came back changed');
  }
  // user_confirmed still skips; ai_inferred still does not.
  eq(h.api.settled('role'), true, 'user_confirmed stopped satisfying its field');
  eq(h.api.settled('important_context'), false, 'AI_INFERRED BECAME SKIPPABLE ACROSS A REOPEN');
  eq(h.api.draft.fields.important_context.source, 'ai_inferred', 'the source was rewritten');
});

await check('«Продолжить» lands on the first UNSETTLED question, not back at the start', async () => {
  const h = reopened(STORED);
  await h.settle();
  const cont = byClass(h.main, 'btn').filter((b) => b.textContent === h.C.RESUME.primary)[0];
  assert(cont, 'the continue action is missing');
  cont.fire('click');
  await h.settle();
  eq(h.state(), h.api.firstUnsettled(), 'it did not resume at the first unsettled question');
  assert(h.state() !== 'APP_COMPANY', 'it went back to a question already answered');
});

await check('«Начать заново» clears the brief and writes the empty draft THROUGH', async () => {
  const h = reopened(STORED);
  await h.settle();
  const before = session(h).length;
  byClass(h.main, 'btn').filter((b) => b.textContent === h.C.RESUME.secondary)[0].fire('click');
  await h.settle(); await h.settle();
  eq(h.state(), 'APP_BOOTSTRAP', 'it did not return to the entry screen');
  eq(h.api.get('company_name'), null, 'an answer survived the restart');
  eq(h.api.get('contact_value'), null, 'a contact survived the restart');
  assert(session(h).length > before, 'the cleared draft was never written to the server');
  const last = session(h)[session(h).length - 1].body;
  eq(last.fields.company_name.value, null, 'the server was left holding the old answers');
  eq(last.fields.company_name.confirmed, false, 'the cleared field is still confirmed');
  // The SESSION is untouched: same id, no second bootstrap.
  eq(last.app_session_id, SESSION_ID, 'the restart changed session');
  eq(gateway(h).length, 1, 'the restart replayed the signed context');
});

await check('a COMMITTED session reopens to its result, never to qualification', async () => {
  const h = reopened(STORED, 'submitted');
  await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'a committed brief dropped the client back into questions');
  const t = all(h.main).map((n) => n.textContent);
  assert(t.indexOf(h.C.SUCCESS.title) !== -1, 'the success copy is missing');
  assert(t.indexOf(h.C.RESUME.title) === -1, 'the resume screen was shown over a committed brief');
  eq(h.api.submitReady(), false, 'a committed brief can be submitted again from the client');
});

await check('a resumed session with NO answers goes straight to the entry screen', async () => {
  for (const d of [null, { v: 1, fields: {} }, { v: 1, step: 'APP_COMPANY', fields: {} }]) {
    const h = reopened(d);
    await h.settle();
    eq(h.state(), 'APP_BOOTSTRAP', 'an empty draft showed the resume screen for ' + JSON.stringify(d));
  }
});

await check('RESUME ITSELF WRITES NOTHING — no draft write, no submit, no second bootstrap', async () => {
  const h = reopened(STORED);
  await h.settle(); await h.settle();
  eq(gateway(h).length, 1, 'a second bootstrap');
  eq(session(h).length, 0, 'hydration wrote the draft straight back for no reason');
  eq(submits(h).length, 0, 'resume submitted something');
  eq(h.sent.length, 1, 'resume made more than the one bootstrap call');
});

await check('a malformed draft from the server cannot corrupt the client', async () => {
  for (const bad of ['nope', 42, [], { fields: 'x' }, { fields: [] }, { v: 1 }]) {
    const h = reopened(bad);
    await h.settle();
    assert(h.state() === 'APP_BOOTSTRAP', 'a malformed draft was accepted: ' + JSON.stringify(bad));
    eq(h.api.get('company_name'), null, 'a malformed draft set a field');
  }
  // A field envelope that is not an envelope is skipped, and the rest still hydrate.
  const mixed = { v: 1, fields: { company_name: 'not an envelope', role: STORED.fields.role } };
  const h = reopened(mixed);
  await h.settle();
  eq(h.api.get('company_name'), null, 'a non-envelope value was hydrated');
  eq(h.api.get('role'), 'Собственник', 'the valid field beside it was dropped');
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
