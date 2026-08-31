#!/usr/bin/env node
// FINMENTOR — the PUBLIC lead identity lifecycle.
//
//   node qa/public-identity-lifecycle.test.mjs
//
// Offline. No tenant, no network, no credentials, no browser, no production writes.
//
// THE CONTRACT THIS GATE GUARDS:
//
//   ONE LOGICAL SUBMISSION = ONE request_id
//   TWO SUCCESSIVE GENUINE SUBMISSIONS = TWO DISTINCT request_id VALUES
//
// The previous transport minted one id PER ATTEMPT. It reused an id already on the payload — but
// all four submitters build their payload INSIDE the submit handler, so a visitor who pressed send
// again after a timeout arrived with a fresh object and got a fresh id. An id minted per attempt is
// a correlation reference; it is not an idempotency key, and calling it one does not make it
// survive the retry it exists for. If the first request COMMITTED and its response was lost, the
// retry was a different request as far as the server could tell.
//
// Case B-0 executes the PRE-IDENTITY file, frozen at qa/fixtures/lead-transport.pre-identity.js,
// and requires it to still show that defect. Read against the live lead-transport.js instead, that
// case would have turned green the moment the fix shipped, taking the record of why the lifecycle
// exists with it.
//
// The server half of this contract — canonicalisation, route scoping, the 409 IDEMPOTENCY_CONFLICT
// verdict and merge immutability — lives in the n8n Lead Intake workflow and is gated separately,
// outside this repository's public-website surface.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const TRANSPORT = read('lead-transport.js');
const TRANSPORT_PRE = read('qa/fixtures/lead-transport.pre-identity.js');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const CANONICAL = /^fmr_[0-9a-f]{32}$/;

// ── a browser shim small enough to be obviously correct ────────────────────────────────────────
// sessionStorage is a real Map, so a reload — and a bfcache restore — is modelled by rebuilding
// `window` around the SAME store.
function browser(store, opts) {
  const o = opts || {};
  return {
    crypto: o.noCrypto ? undefined : {
      getRandomValues: (b) => { for (let i = 0; i < b.length; i++) { b[i] = Math.floor(Math.random() * 256); } return b; }
    },
    sessionStorage: o.noStorage
      ? { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } }
      : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
}

// The business responses, written once so no case can invent a shape the server never sends.
// Lead Intake answers a settled submission from exactly three responders — new, retry and merged —
// and all three carry ok:true AND a non-empty canonical lead_id.
const SETTLED = (leadId, mode) => ({
  ok: true, status: 200,
  text: () => Promise.resolve(JSON.stringify({
    ok: true, lead_id: leadId || 'FIN-1788000000000-101', mode: mode || 'new',
    priority: 'WARM', financial_zone: 'UNKNOWN'
  }))
});
const BUSINESS_FAIL = () => ({
  ok: true, status: 200,
  text: () => Promise.resolve('{"ok":false,"error_code":"CRM_UNAVAILABLE","retryable":true}')
});
const CONFLICT_409 = () => ({
  ok: false, status: 409,
  text: () => Promise.resolve('{"ok":false,"error_code":"IDEMPOTENCY_CONFLICT","retryable":false}')
});
const BAD_400 = () => ({
  ok: false, status: 400,
  text: () => Promise.resolve('{"ok":false,"error_code":"INVALID_PAYLOAD","retryable":false,"message":""}')
});
const NETWORK_FAIL = () => { const e = new Error('boom'); e.name = 'TypeError'; return e; };
const TIMEOUT = () => Object.assign(new Error('abort'), { name: 'AbortError' });

function loadTransport(source, store, opts) {
  const win = browser(store, opts);
  const calls = [];
  const responder = { next: () => SETTLED() };
  const fetchImpl = (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = responder.next(calls.length);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  new Function('window', 'fetch', 'document', source)(win, fetchImpl, undefined);
  return { T: win.FMLeadTransport, calls, responder };
}

const URL_OK = 'https://example.invalid/webhook/lead';
const fails = (p) => p.then(() => { throw new Error('expected a rejection'); }, (e) => e);
const idOf = (calls, i) => calls[i].body.meta.request_id;
const payload = (over) => Object.assign({ tool: 'contact', lead: { name: 'Иван', email: 'i@alfa.md' }, meta: {} }, over || {});

console.log('');
console.log('FINMENTOR public lead identity lifecycle');
console.log('');

// ── the defect this lifecycle exists for ───────────────────────────────────────────────────────
console.log('THE DEFECT, FROZEN');

check('B-0 the pre-identity transport minted a new identity per ATTEMPT', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT_PRE, new Map());
  responder.next = (n) => (n === 1 ? NETWORK_FAIL() : SETTLED());
  // Every submitter rebuilds its payload inside the submit handler; none reuses the object.
  await fails(T.postLead(URL_OK, payload(), {}));
  await T.postLead(URL_OK, payload(), {});
  eq(calls.length, 2, 'two attempts');
  assert(idOf(calls, 0) !== idOf(calls, 1),
    'the frozen fixture no longer shows the defect it exists to record — do not "fix" it');
});

// ── the lifecycle ──────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('THE LIFECYCLE: A–H');

check('A/M first logical submission mints exactly one canonical identity', async () => {
  const { T, calls } = loadTransport(TRANSPORT, new Map());
  await T.postLead(URL_OK, payload(), {});
  eq(calls.length, 1, 'one POST');
  const id = idOf(calls, 0);
  assert(CANONICAL.test(id), 'not canonical fmr_<32 lc hex>: ' + id);
  eq(calls[0].headers['X-FINMENTOR-Request-Id'], id, 'header and body disagree');
});

check('B/N a network retry reuses EXACTLY the same identity', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n <= 2 ? NETWORK_FAIL() : SETTLED());
  await fails(T.postLead(URL_OK, payload(), {}));
  await fails(T.postLead(URL_OK, payload(), {}));
  await T.postLead(URL_OK, payload(), {});
  eq(calls.length, 3, 'three attempts');
  eq(idOf(calls, 1), idOf(calls, 0), 'attempt 2 minted a new identity');
  eq(idOf(calls, 2), idOf(calls, 0), 'attempt 3 minted a new identity');
});

check('B/N-1 a TIMEOUT retry reuses the same identity', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n === 1 ? TIMEOUT() : SETTLED());
  const e = await fails(T.postLead(URL_OK, payload(), {}));
  eq(e.fmCode, 'timeout', 'not reported as a timeout');
  await T.postLead(URL_OK, payload(), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the timeout rotated the identity');
});

check('C/O a reload before terminal success reuses the same identity', async () => {
  const store = new Map();
  const first = loadTransport(TRANSPORT, store);
  first.responder.next = () => NETWORK_FAIL();
  await fails(first.T.postLead(URL_OK, payload(), {}));
  const second = loadTransport(TRANSPORT, store);   // a reload: new window, same session store
  await second.T.postLead(URL_OK, payload(), {});
  eq(idOf(second.calls, 0), idOf(first.calls, 0), 'the reload minted a new identity');
});

check('D a validation refusal before settlement keeps the same identity', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n === 1 ? BAD_400() : SETTLED());
  const e = await fails(T.postLead(URL_OK, payload(), {}));
  eq(e.fmStatus, 400, 'not surfaced as a 400');
  eq(e.fmErrorCode, 'INVALID_PAYLOAD', 'the error code was not read from the body');
  await T.postLead(URL_OK, payload(), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'a rejected payload rotated the identity');
});

check('F/P an authoritative settlement retires the identity', async () => {
  const { T, calls } = loadTransport(TRANSPORT, new Map());
  const r = await T.postLead(URL_OK, payload(), {});
  eq(r.ok, true, 'not resolved as success');
  eq(r.leadId, 'FIN-1788000000000-101', 'the canonical lead id was not returned');
  eq(T.slotState('contact'), 'idle', 'the slot is still active after settlement');
  assert(T.submissionToken('contact') !== idOf(calls, 0), 'the retired identity was handed out again');
});

check('Q a second genuine submission gets a DIFFERENT identity', async () => {
  const { T, calls } = loadTransport(TRANSPORT, new Map());
  await T.postLead(URL_OK, payload(), {});
  await T.postLead(URL_OK, payload({ lead: { name: 'Пётр', email: 'p@beta.md' } }), {});
  assert(idOf(calls, 0) !== idOf(calls, 1), 'the second genuine submission replayed the first identity');
});

check('Q-1 an UNCHANGED second submission also gets a new identity', async () => {
  // The lifecycle is bound to the submission, not to the content: two identical genuine
  // submissions are two logical submissions and must not share an identity.
  const { T, calls } = loadTransport(TRANSPORT, new Map());
  await T.postLead(URL_OK, payload(), {});
  await T.postLead(URL_OK, payload(), {});
  assert(idOf(calls, 0) !== idOf(calls, 1), 'identical content replayed the retired identity');
});

check('H a retired identity can never be re-offered, even from a restored closure', async () => {
  const store = new Map();
  const first = loadTransport(TRANSPORT, store);
  const settled = (await first.T.postLead(URL_OK, payload(), {})).requestId;
  // Back/forward: model both restore shapes — a fresh parse (normal navigation) and the same
  // closure surviving (bfcache).
  const restored = loadTransport(TRANSPORT, store);
  assert(restored.T.submissionToken('contact') !== settled, 'a fresh load re-offered a settled identity');
  assert(first.T.submissionToken('contact') !== settled, 'the surviving closure re-offered a settled identity');
  eq(JSON.parse(store.get('fm_sub_contact')).d, settled, 'the settled identity was not tombstoned');
});

// ── success is server-authoritative ────────────────────────────────────────────────────────────
console.log('');
console.log('SUCCESS IS SERVER-AUTHORITATIVE, NOT HTTP 2xx');

check('R HTTP 200 with a business failure RETAINS the identity', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n === 1 ? BUSINESS_FAIL() : SETTLED());
  const e = await fails(T.postLead(URL_OK, payload(), {}));
  eq(e.fmCode, 'rejected', 'a business failure was not reported as a rejection');
  eq(T.slotState('contact'), 'active', 'the slot was retired by a non-settlement 2xx');
  await T.postLead(URL_OK, payload(), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'a business failure rotated the identity');
});

check('R-1 HTTP 200 + ok:true but NO canonical lead_id also retains it', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n === 1
    ? { ok: true, status: 200, text: () => Promise.resolve('{"ok":true}') }
    : SETTLED());
  const e = await fails(T.postLead(URL_OK, payload(), {}));
  eq(e.fmCode, 'rejected', 'an ok:true without a lead id was treated as settlement');
  await T.postLead(URL_OK, payload(), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the identity rotated without an authoritative settlement');
});

check('S server settled, response lost: the retry carries X, resolves the lead, then clears X', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n === 1 ? NETWORK_FAIL() : SETTLED('FIN-1788000000000-777', 'merged'));
  await fails(T.postLead(URL_OK, payload(), {}));
  eq(T.slotState('contact'), 'active', 'the lost response retired the identity');
  const r = await T.postLead(URL_OK, payload(), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the retry did not carry the original identity');
  eq(r.leadId, 'FIN-1788000000000-777', 'the canonical lead was not returned');
  eq(r.mode, 'merged', 'the mode was not surfaced');
  eq(T.slotState('contact'), 'idle', 'the authoritative success did not retire the identity');
});

// ── the terminal conflict ──────────────────────────────────────────────────────────────────────
console.log('');
console.log('IDEMPOTENCY_CONFLICT IS TERMINAL ON THE CLIENT TOO');

check('T a 409 retains the identity and blocks any further send on that slot', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = () => CONFLICT_409();
  const e = await fails(T.postLead(URL_OK, payload(), {}));
  eq(e.fmStatus, 409, 'not surfaced as 409');
  eq(e.fmErrorCode, 'IDEMPOTENCY_CONFLICT', 'error code not read from the body');
  eq(T.isIdentityConflict(e), true, 'the helper does not recognise the conflict');
  eq(T.slotState('contact'), 'conflict', 'the slot was not sealed');
  const held = idOf(calls, 0);
  // No automatic retry, no automatic rotation: refused BEFORE the network call, so a caller that
  // re-arms its submit button cannot turn a conflict into a retry loop.
  const again = await fails(T.postLead(URL_OK, payload(), {}));
  eq(again.fmCode, 'identity_conflict_pending', 'the sealed slot sent a request anyway');
  eq(calls.length, 1, 'a second request was sent after the conflict');
  eq(JSON.parse(store.get('fm_sub_contact')).t, held, 'the identity was rotated by the conflict');
});

check('U an explicit new-request action is the only exit, and it mints a fresh identity', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = (n) => (n === 1 ? CONFLICT_409() : SETTLED());
  await fails(T.postLead(URL_OK, payload(), {}));
  const conflicted = idOf(calls, 0);
  T.beginNewSubmission('contact');
  eq(T.slotState('contact'), 'idle', 'the explicit reset did not clear the conflict');
  await T.postLead(URL_OK, payload(), {});
  eq(calls.length, 2, 'the reset did not re-enable sending');
  assert(idOf(calls, 1) !== conflicted, 'the new submission reused the conflicted identity');
  assert(CANONICAL.test(idOf(calls, 1)), 'the new identity is not canonical');
});

check('U-1 nothing but beginNewSubmission can rotate a conflicted identity', async () => {
  const store = new Map();
  const { T, responder } = loadTransport(TRANSPORT, store);
  responder.next = () => CONFLICT_409();
  await fails(T.postLead(URL_OK, payload(), {}));
  const held = JSON.parse(store.get('fm_sub_contact')).t;
  // A reload does not clear it, and neither does changing the payload.
  const reloaded = loadTransport(TRANSPORT, store);
  const e = await fails(reloaded.T.postLead(URL_OK, payload({ lead: { name: 'X', email: 'x@x.md' } }), {}));
  eq(e.fmCode, 'identity_conflict_pending', 'a reload plus an edit escaped the conflict');
  eq(reloaded.calls.length, 0, 'a request was sent from a conflicted slot');
  eq(JSON.parse(store.get('fm_sub_contact')).t, held, 'the identity changed without an explicit reset');
});

// ── minting ────────────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('MINTING');

check('two identities minted in the same millisecond are different', () => {
  const { T } = loadTransport(TRANSPORT, new Map());
  const seen = new Set();
  const t0 = Date.now();
  for (let i = 0; i < 500; i++) { seen.add(T.newRequestId()); }
  assert(Date.now() - t0 < 1000, 'the loop was not fast enough to be a same-millisecond test');
  eq(seen.size, 500, 'the minter collided');
  for (const id of seen) { assert(CANONICAL.test(id), 'a minted id is not canonical: ' + id); }
  assert(!T.newRequestId().includes(String(Date.now()).slice(0, 6)), 'the identity carries a clock component');
});

check('no CSPRNG: the transport refuses rather than minting a low-entropy identity', async () => {
  const { T, calls } = loadTransport(TRANSPORT, new Map(), { noCrypto: true });
  const e = await fails(T.postLead(URL_OK, payload(), {}));
  eq(e.fmCode, 'identity_unavailable', 'wrong refusal code');
  eq(calls.length, 0, 'a request was sent without a usable identity');
});

check('blocked sessionStorage still holds the identity for in-page retries', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map(), { noStorage: true });
  responder.next = (n) => (n === 1 ? NETWORK_FAIL() : SETTLED());
  await fails(T.postLead(URL_OK, payload(), {}));
  await T.postLead(URL_OK, payload(), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the in-memory fallback did not hold');
});

check('two tools in one tab are two logical submissions', async () => {
  const { T, calls, responder } = loadTransport(TRANSPORT, new Map());
  responder.next = () => NETWORK_FAIL();
  await fails(T.postLead(URL_OK, payload({ tool: 'contact' }), {}));
  await fails(T.postLead(URL_OK, payload({ tool: 'mini_scan' }), {}));
  assert(idOf(calls, 0) !== idOf(calls, 1), 'two tools shared one identity');
});

// ── the call graph ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('THE CALL GRAPH: every public lead goes through this transport');

const PAGES = ['index.html', 'questionnaire.html', 'ro/questionnaire.html',
  'working-capital-scan.html', 'ro/working-capital-scan.html'];
const SUBMITTERS = ['main.js', 'questionnaire.html', 'ro/questionnaire.html',
  'working-capital-scan.html', 'ro/working-capital-scan.html'];

check('CG-1 exactly these five pages load the transport', () => {
  for (const p of PAGES) { assert(read(p).includes('lead-transport.js'), p + ' does not load the transport'); }
});

// KNOWN OPEN DEFECT, recorded rather than fixed.
//
// `ro/index.html` carries `#consultForm` and loads `../main.js`, so `initForm()` binds to it — but
// it does NOT load `../lead-transport.js`. `postLeadPayload()` therefore rejects with
// `transport_unavailable` on every submit, and the Romanian home page has never delivered a lead to
// the CRM. It fails visibly and closed: the visitor gets the Telegram/email fallback copy.
//
// It is one `<script src>` away from working, and that line would turn a page which has never
// produced leads into one that does. Pinned here so it cannot be forgotten AND so that fixing it
// turns this gate red, forcing the fix to be a deliberate, documented act.
check('CG-1b ro/index.html still cannot submit: transport absent (KNOWN OPEN DEFECT)', () => {
  const ro = read('ro/index.html');
  assert(ro.includes('id="consultForm"'), 'ro/index.html no longer has the consultation form');
  assert(ro.includes('main.js'), 'ro/index.html no longer loads main.js');
  assert(!ro.includes('lead-transport.js'),
    'ro/index.html now loads the transport — the known defect was fixed; update the record and '
    + 'move this page into PAGES');
});

check('CG-2 no submitter reaches the lead webhook except through postLead', () => {
  for (const f of SUBMITTERS) {
    const text = read(f);
    const calls = text.match(/\b(fetch|XMLHttpRequest|sendBeacon)\s*\(/g) || [];
    eq(calls.length, 0, f + ' makes its own network call: ' + calls.join(','));
    assert(/FMLeadTransport\.postLead\(/.test(text), f + ' does not submit through the transport');
  }
});

check('CG-3 every submitter handles the terminal conflict and offers a new request', () => {
  for (const f of SUBMITTERS) {
    const text = read(f);
    assert(/isIdentityConflict\(/.test(text), f + ' does not detect IDEMPOTENCY_CONFLICT');
    assert(/newRequestControl\(/.test(text), f + ' offers no explicit new-request action');
    assert(/\.catch\(function \(err\)/.test(text), f + ' discards the rejection it needs to classify');
  }
});

check('CG-4 the frozen fixture is not served, and the low-entropy fallback is gone', () => {
  for (const p of PAGES.concat(['ro/index.html'])) {
    assert(!read(p).includes('pre-identity'), p + ' references the frozen fixture');
  }
  assert(TRANSPORT !== TRANSPORT_PRE, 'the deployed transport is still the pre-identity one');
  assert(/submissionToken/.test(TRANSPORT), 'the deployed transport has no submission slot');
  // Comments stripped: the header explains WHY the fallback was removed, and a naive grep reads
  // that explanation as the thing it documents.
  const executable = TRANSPORT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  assert(!/Math\.random/.test(executable), 'the transport still has a low-entropy fallback');
  assert(!/Date\.now\(\)/.test(executable), 'the transport still derives identity from a clock');
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('');
  for (const f of failures) { console.log('  FAILED  ' + f); }
  process.exit(1);
}
console.log('');
