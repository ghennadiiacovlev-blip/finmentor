#!/usr/bin/env node
// FINMENTOR — ONE TAP = ONE POST.
//
//   node qa/premium-ux-submit-lock.test.mjs
//
// Offline. Drives the REAL app-premium/app.js and app-premium/net.js against the harness stub and
// counts what actually left the client.
//
// ── WHY THIS GATE EXISTS ───────────────────────────────────────────────────────────────────────
//
// The first live submit produced TWO privacy statements 4.4 s apart. Reproduced on a disposable
// probe with the same node type and typeVersion, ONE POST produces exactly ONE node run and ONE
// statement, so the second statement was a second POST — not a server-side double-fire.
//
// The client could not have made it: net.js has no retry, and submit() replaces the screen with
// scrSubmitting, which carries no button. But that lock was INCIDENTAL — a property of the current
// rendering rather than a guarantee — and the thing a duplicate tap buys is a second irreversible
// privacy write against the same derived key. Backend idempotency is not an answer to a client
// that asks twice. This gate holds the explicit lock in place.
//
// It also pins the retry contract: a retry must reuse the acknowledgement UNCHANGED. Re-stamping
// acknowledged_at would record a second, contradictory moment of consent.

import { boot, OK_BOOTSTRAP, SESSION_ID } from './lib/miniapp-harness.mjs';

let pass = 0;
const failures = [];
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const SUBMIT = 'finmentor-miniapp-submit';
const GATEWAY = 'finmentor-miniapp-gateway';

// A responder whose submit answer is programmable per test, and which never resolves the submit
// call until the test lets it — that gap IS the in-flight window.
function rig(submitAnswer) {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const h = boot({
    responder: ({ url }) => {
      if (url.indexOf(GATEWAY) !== -1) { return { status: 200, body: OK_BOOTSTRAP }; }
      if (url.indexOf(SUBMIT) !== -1) { return submitAnswer(); }
      return { status: 200, body: { ok: true } };
    }
  });
  return { h, gate, release };
}

const OK = () => ({ status: 200, body: { ok: true, lead_id: 'FM-2026-0001', submit_state: 'submitted' } });
const FAIL503 = () => ({ status: 503, body: { ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true } });

console.log('\nFINMENTOR — submit in-flight lock\n');

// ── 1. the baseline the whole retry plan rests on ─────────────────────────────────────────────

await check('one submit() call sends exactly ONE POST to the submit endpoint', async () => {
  const { h } = rig(OK);
  await h.settle();
  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.to(SUBMIT).length, 1, 'POSTs to submit');
});

await check('a second tap DURING the in-flight window sends no second POST', async () => {
  const { h } = rig(OK);
  await h.settle();
  h.api.submit();
  h.api.submit();
  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.to(SUBMIT).length, 1, 'POSTs to submit after three rapid taps');
});

await check('submitting() is true while in flight and false once the answer is in', async () => {
  const { h } = rig(OK);
  await h.settle();
  h.api.submit();
  eq(h.api.submitting(), true, 'locked immediately on tap');
  await h.settle();
  await h.settle();
  eq(h.api.submitting(), false, 'released once settled');
});

// ── 2. the lock must not become a trap ────────────────────────────────────────────────────────

await check('a failed submission RELEASES the lock, so retry is reachable', async () => {
  const { h } = rig(FAIL503);
  await h.settle();
  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.state(), 'APP_FAILURE', 'failure screen');
  eq(h.api.submitting(), false, 'lock released on failure');
});

await check('one retry tap after a failure sends exactly ONE more POST', async () => {
  let answers = 0;
  const { h } = rig(() => { answers++; return answers === 1 ? FAIL503() : OK(); });
  await h.settle();
  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.to(SUBMIT).length, 1, 'POSTs after the first tap');

  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.to(SUBMIT).length, 2, 'POSTs after one retry tap');
  eq(h.state(), 'APP_SUCCESS', 'retry succeeded');
});

await check('a rapid double retry tap still sends only ONE POST', async () => {
  const { h } = rig(FAIL503);
  await h.settle();
  h.api.submit();
  await h.settle();
  await h.settle();
  const first = h.to(SUBMIT).length;

  h.api.submit();
  h.api.submit();
  await h.settle();
  await h.settle();
  eq(h.to(SUBMIT).length - first, 1, 'POSTs added by a double retry tap');
});

// ── 3. the retry must not mint a new identity ─────────────────────────────────────────────────

await check('a retry reuses the SAME session id — the server derives the key from it', async () => {
  const { h } = rig(FAIL503);
  await h.settle();
  h.api.submit();
  await h.settle(); await h.settle();
  h.api.submit();
  await h.settle(); await h.settle();
  const posts = h.to(SUBMIT);
  assert(posts.length === 2, 'two posts, got ' + posts.length);
  eq(posts[0].body.app_session_id, posts[1].body.app_session_id, 'app_session_id across retry');
  eq(posts[0].body.app_session_id, SESSION_ID, 'the session the server issued');
});

await check('a retry reuses the acknowledgement UNCHANGED — no re-stamped consent', async () => {
  const { h } = rig(FAIL503);
  await h.settle();
  h.api.submit();
  await h.settle(); await h.settle();
  h.api.submit();
  await h.settle(); await h.settle();
  const posts = h.to(SUBMIT);
  assert(posts.length === 2, 'two posts, got ' + posts.length);
  const a = posts[0].body.privacy_ack, b = posts[1].body.privacy_ack;
  eq(JSON.stringify(a), JSON.stringify(b), 'privacy_ack across retry');
  eq(a.acknowledged_at, b.acknowledged_at, 'acknowledged_at across retry');
  eq(a.notice_version, b.notice_version, 'notice_version across retry');
});

// ── 4. a committed submission stays terminal on the client ────────────────────────────────────

await check('after success, a further tap sends nothing at all', async () => {
  const { h } = rig(OK);
  await h.settle();
  h.api.submit();
  await h.settle(); await h.settle();
  eq(h.state(), 'APP_SUCCESS', 'success screen');
  const after = h.to(SUBMIT).length;
  h.api.submit();
  await h.settle(); await h.settle();
  eq(h.to(SUBMIT).length, after, 'POSTs added after a committed submission');
});

// ── 5. the source itself, so the guarantee cannot be quietly rendered away ────────────────────

await check('submit() opens with the in-flight guard, before any side effect', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app-premium/app.js', import.meta.url), 'utf8');
  const at = src.indexOf('function submit() {');
  assert(at !== -1, 'submit() found');
  const head = src.slice(at, at + 400);
  assert(/if \(submitting\) \{ return; \}/.test(head), 'guard is the first statement of submit()');
  assert(head.indexOf('if (submitting)') < head.indexOf("go('APP_SUBMITTING')") || head.indexOf("go('APP_SUBMITTING')") === -1,
    'guard precedes the transition');
});

await check('every exit from submit() releases the lock', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app-premium/app.js', import.meta.url), 'utf8');
  const acquires = (src.match(/submitting = true;/g) || []).length;
  const releases = (src.match(/submitting = false;/g) || []).length;
  eq(acquires, 1, 'places that acquire the lock');
  assert(releases >= 3, 'places that release it (got ' + releases + ', want at least 3)');
  assert(/\['catch'\]\(function \(\) \{/.test(src), 'a catch backstop exists so a throw cannot strand the lock');
});

console.log('\n  ' + pass + ' passed, ' + failures.length + ' failed\n');
if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
