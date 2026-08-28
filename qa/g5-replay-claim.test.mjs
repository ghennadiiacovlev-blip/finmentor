#!/usr/bin/env node
// FINMENTOR — G5: the durable initData replay claim.
//
//   node qa/g5-replay-claim.test.mjs
//
// Offline. No tenant, no network, no Supabase. The store is a fake that models EXACTLY one
// thing: a PRIMARY KEY. That is the whole point of the design -- if the logic is right, a fake
// primary key and a real one are indistinguishable to this module, because the module never
// arbitrates. The live half is proven separately against Postgres itself.
//
// WHAT THIS GATE IS FOR. G5 was STOPPED before, not skipped, because emulating atomic
// create-if-absent in application code is the race it is meant to prevent. So the two failures
// worth guarding are:
//
//   1. THE MODULE STARTS ARBITRATING. A read-before-write, a count, a "not found so proceed" --
//      each looks harmless and each reintroduces the window. Asserted structurally AND by a
//      store that refuses to answer a read.
//   2. A REJECTED initData CONSUMES A KEY. If a forged or stale payload can burn the key, an
//      attacker denies service to the real user by replaying garbage. Proven by a store that
//      THROWS if it is touched at all.

import { createHmac, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  buildBotDataCheckString, parseInitData, TelegramInitDataError
} from '../gateway/telegram-initdata.mjs';
import { claimInitData, deriveReplayKey, G5_OUTCOME, G5_KEY_DOMAIN } from '../gateway/g5-replay-claim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
async function acheck(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const NOW = 1_800_000_000;
const BOT_TOKEN = '123456789:TEST_ONLY_TOKEN_NOT_A_REAL_SECRET';

function makeInitData(over = {}, sign = true) {
  const params = new Map(Object.entries({
    auth_date: String(NOW - 10),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: 551662084, first_name: 'QA', username: 'qa_user', language_code: 'ru' }),
    ...over
  }));
  if (sign) {
    const dcs = buildBotDataCheckString(params);
    const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN, 'utf8').digest();
    params.set('hash', createHmac('sha256', secret).update(dcs, 'utf8').digest('hex'));
  } else {
    params.set('hash', 'f'.repeat(64));
  }
  return [...params.entries()].map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

// A store that models a PRIMARY KEY and nothing else.
function makeStore() {
  const rows = new Map();
  return {
    rows,
    calls: [],
    async insertClaim(row) {
      this.calls.push(row);
      if (rows.has(row.replay_key)) { return { conflict: true }; }
      rows.set(row.replay_key, row);
      return { inserted: true };
    }
  };
}
// A store that must never be reached.
const forbiddenStore = {
  touched: false,
  async insertClaim() { this.touched = true; throw new Error('THE STORE WAS TOUCHED'); }
};
// A store that is down.
const brokenStore = { async insertClaim() { throw new Error('ECONNREFUSED'); } };

console.log('\nFINMENTOR G5 — durable initData replay claim\n');
console.log('-- the key --');

check('the replay key is a SHA-256 hex digest, domain-separated', () => {
  const k = deriveReplayKey(makeInitData());
  assert(/^[0-9a-f]{64}$/.test(k), 'the key is not 64 lowercase hex chars: ' + k);
  // domain separation is real: the same canonical material under a different domain differs
  const params = parseInitData(makeInitData());
  const bare = createHash('sha256').update(buildBotDataCheckString(params), 'utf8').digest('hex');
  assert(k !== bare, 'the key is a bare digest of the canonical string — no domain separation');
  assert(G5_KEY_DOMAIN.includes('v1'), 'the domain carries no version to rotate on');
});

check('the same initData always yields the same key; a different one never does', () => {
  const a = makeInitData();
  eq(deriveReplayKey(a), deriveReplayKey(a), 'the key is not stable for one payload');
  const b = makeInitData({ query_id: 'DIFFERENT_QUERY_ID' });
  assert(deriveReplayKey(a) !== deriveReplayKey(b), 'two different signed payloads share a key');
  // and a payload differing ONLY in auth_date is a different claim
  const c = makeInitData({ auth_date: String(NOW - 11) });
  assert(deriveReplayKey(a) !== deriveReplayKey(c), 'auth_date does not affect the key');
});

check('the key is derived from AUTHENTICATED material, not from anything unsigned', () => {
  // `hash` and `signature` are excluded from the data-check-string by Telegram's own rule, and
  // the key folds `hash` back in explicitly. So an attacker who alters any signed field changes
  // the key AND invalidates the signature -- there is no way to collide one without the other.
  const src = readFileSync(join(ROOT, 'gateway', 'g5-replay-claim.mjs'), 'utf8');
  assert(/buildBotDataCheckString/.test(src), 'the key no longer uses the canonical signed material');
});

console.log('\n-- VALID FIRST USE, then IDENTICAL REPLAY --');

await acheck('VALID FIRST USE -> CLAIMED, exactly one row', async () => {
  const store = makeStore();
  const r = await claimInitData({ initData: makeInitData(), botToken: BOT_TOKEN, store, nowSeconds: NOW });
  eq(r.ok, true, 'a valid first use was refused');
  eq(r.outcome, G5_OUTCOME.CLAIMED, 'wrong outcome');
  eq(store.rows.size, 1, 'the ledger does not hold exactly one row');
  eq(store.calls.length, 1, 'the store was called more than once');
  assert(r.user && r.user.telegram_user_id === '551662084', 'the validated user was not returned to the caller');
});

await acheck('IDENTICAL REPLAY -> REPLAY_REFUSED, and NO second row', async () => {
  const store = makeStore();
  const initData = makeInitData();
  const first = await claimInitData({ initData, botToken: BOT_TOKEN, store, nowSeconds: NOW });
  const second = await claimInitData({ initData, botToken: BOT_TOKEN, store, nowSeconds: NOW });
  eq(first.outcome, G5_OUTCOME.CLAIMED, 'the first use was not claimed');
  eq(second.ok, false, 'the replay succeeded');
  eq(second.outcome, G5_OUTCOME.REPLAY_REFUSED, 'the replay was not refused');
  eq(second.replay_key, first.replay_key, 'the replay derived a different key');
  eq(store.rows.size, 1, 'the replay added a row');
});

await acheck('CONCURRENT same key -> exactly ONE succeeds', async () => {
  // Fired together, resolved by the key alone. The module does not arbitrate, so this is the
  // store's verdict and nothing else -- which is exactly what Postgres will do live.
  const store = makeStore();
  const initData = makeInitData();
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    claimInitData({ initData, botToken: BOT_TOKEN, store, nowSeconds: NOW })));
  const claimed = results.filter((r) => r.outcome === G5_OUTCOME.CLAIMED);
  const refused = results.filter((r) => r.outcome === G5_OUTCOME.REPLAY_REFUSED);
  eq(claimed.length, 1, 'concurrent claims: ' + claimed.length + ' succeeded, expected exactly 1');
  eq(refused.length, 7, 'the other seven were not refused');
  eq(store.rows.size, 1, 'more than one row exists');
});

console.log('\n-- a REJECTED initData must not consume a key --');

await acheck('FAILED SIGNATURE -> throws, store NEVER touched', async () => {
  forbiddenStore.touched = false;
  let threw = null;
  try {
    await claimInitData({ initData: makeInitData({}, false), botToken: BOT_TOKEN, store: forbiddenStore, nowSeconds: NOW });
  } catch (e) { threw = e; }
  assert(threw instanceof TelegramInitDataError, 'a forged signature did not raise a validator error');
  eq(threw.code, 'TG_INITDATA_INVALID', 'wrong error code');
  eq(forbiddenStore.touched, false, 'A FORGED initData REACHED THE STORE — it can burn a real key');
});

await acheck('EXPIRED initData -> throws, store NEVER touched', async () => {
  forbiddenStore.touched = false;
  let threw = null;
  try {
    await claimInitData({
      initData: makeInitData({ auth_date: String(NOW - 100000) }),
      botToken: BOT_TOKEN, store: forbiddenStore, nowSeconds: NOW
    });
  } catch (e) { threw = e; }
  assert(threw instanceof TelegramInitDataError, 'a stale initData did not raise');
  eq(threw.code, 'TG_INITDATA_EXPIRED', 'wrong error code');
  eq(forbiddenStore.touched, false, 'A STALE initData REACHED THE STORE');
});

await acheck('FUTURE-DATED initData -> throws, store NEVER touched', async () => {
  forbiddenStore.touched = false;
  let threw = null;
  try {
    await claimInitData({
      initData: makeInitData({ auth_date: String(NOW + 100000) }),
      botToken: BOT_TOKEN, store: forbiddenStore, nowSeconds: NOW
    });
  } catch (e) { threw = e; }
  eq(threw && threw.code, 'TG_INITDATA_FUTURE', 'a future-dated initData was accepted');
  eq(forbiddenStore.touched, false, 'a future-dated initData REACHED THE STORE');
});

console.log('\n-- the store is the authority, and an absent store fails CLOSED --');

await acheck('STORE OUTAGE -> fail closed, never CLAIMED', async () => {
  const r = await claimInitData({ initData: makeInitData(), botToken: BOT_TOKEN, store: brokenStore, nowSeconds: NOW });
  eq(r.ok, false, 'an unreachable ledger produced a successful claim');
  eq(r.outcome, G5_OUTCOME.STORE_UNAVAILABLE, 'wrong outcome for an outage');
});

await acheck('a store that returns NO VERDICT fails closed too', async () => {
  const mute = { async insertClaim() { return {}; } };
  const r = await claimInitData({ initData: makeInitData(), botToken: BOT_TOKEN, store: mute, nowSeconds: NOW });
  eq(r.ok, false, 'a mute adapter produced a successful claim');
  eq(r.outcome, G5_OUTCOME.STORE_UNAVAILABLE, 'a mute adapter was not treated as an outage');
});

check('the module NEVER arbitrates: no read-before-write anywhere in it', () => {
  const src = readFileSync(join(ROOT, 'gateway', 'g5-replay-claim.mjs'), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/\bselect\b/i.test(code), 'the module performs a SELECT — that is the race, rewritten');
  assert(!/\.has\(|\.get\(|findOne|exists|count/i.test(code.replace(/params\.get\([^)]*\)/g, '')),
    'the module reads the ledger before writing');
  // exactly one store method is ever called
  const calls = [...new Set([...code.matchAll(/store\.(\w+)/g)].map((m) => m[1]))];
  eq(JSON.stringify(calls), JSON.stringify(['insertClaim']), 'the module calls store methods beyond insertClaim: ' + calls.join(', '));
});

console.log('\n-- what reaches the ledger: a digest and two timestamps --');

await acheck('RAW initData is never written', async () => {
  const store = makeStore();
  const initData = makeInitData();
  await claimInitData({ initData, botToken: BOT_TOKEN, store, nowSeconds: NOW, correlationId: 'C-1' });
  const row = store.calls[0];
  const blob = JSON.stringify(row);
  assert(blob.indexOf('query_id') === -1, 'query_id reached the ledger');
  assert(blob.indexOf('auth_date=') === -1, 'raw initData reached the ledger');
  assert(!blob.includes(initData), 'the initData string itself reached the ledger');
  assert(!blob.includes(parseInitData(initData).get('hash')), 'the Telegram signature reached the ledger');
});

await acheck('NO customer PII is written', async () => {
  const store = makeStore();
  await claimInitData({
    initData: makeInitData({ user: JSON.stringify({ id: 551662084, first_name: 'Ivan', last_name: 'Petrov', username: 'ivanp' }) }),
    botToken: BOT_TOKEN, store, nowSeconds: NOW
  });
  const blob = JSON.stringify(store.calls[0]);
  ['Ivan', 'Petrov', 'ivanp', '551662084'].forEach((v) => {
    assert(blob.indexOf(v) === -1, 'PII reached the ledger: ' + v);
  });
});

await acheck('the row is EXACTLY the three approved columns', async () => {
  const store = makeStore();
  await claimInitData({ initData: makeInitData(), botToken: BOT_TOKEN, store, nowSeconds: NOW, correlationId: 'C-1' });
  const keys = Object.keys(store.calls[0]).sort();
  eq(JSON.stringify(keys), JSON.stringify(['correlation_id', 'expires_at', 'replay_key']),
    'the ledger row carries fields beyond the approved set: ' + keys.join(', '));
});

check('expiry is RETENTION, never authorisation', () => {
  const src = readFileSync(join(ROOT, 'gateway', 'g5-replay-claim.mjs'), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  // expires_at is computed and passed; it is never compared to decide an outcome
  assert(!/expires?At\s*[<>]|expires_at\s*[<>]/.test(code),
    'the module compares expires_at to decide something — expiry must not authorise a replay');
});

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
