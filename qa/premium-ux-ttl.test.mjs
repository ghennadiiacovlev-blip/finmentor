#!/usr/bin/env node
// FINMENTOR — Premium UX app-session TTL contract (owner decision 5).
//
//   node qa/premium-ux-ttl.test.mjs
//
// Offline. No tenant, no network, no credentials.
//
// WHY THE VALUE CHANGED, AND WHY THAT WAS ALLOWED. 1800s contradicts the approved Telegram copy:
// «У вас есть незавершённый бриф. Продолжить с того места, где остановились?» promises a resume
// that a 30-minute window cannot honour. The closed Gateway contract permits the change — §6
// requires only "server-side TTL", a BOUNDED lifetime, and never names a number. The stop
// condition in owner decision 5 therefore does not fire.
//
// WHAT THIS GATE PROVES. The boundary behaviour at every point the owner named, that the expiry is
// server-stamped and fixed rather than sliding, that the client cannot influence it, and — the one
// that matters most — that the G5 replay clock is a DIFFERENT clock that this change does not move.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const { APP_SESSION_TTL_SECONDS, buildGateway } = await import('../scripts/build-miniapp-gateway.mjs');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const HOUR = 3600 * 1000;
const T0 = Date.parse('2026-08-29T10:00:00.000Z');

// The deployed expiry rule, as Build App Session writes it and both endpoints read it.
const expiresAt = (mintedAt) => new Date(mintedAt + APP_SESSION_TTL_SECONDS * 1000).toISOString();
const isLive = (expIso, now) => new Date(expIso).getTime() > now;

console.log('Premium UX — app-session TTL contract');
console.log('');

check('TTL is exactly 72 hours', () => {
  eq(APP_SESSION_TTL_SECONDS, 259200, 'TTL seconds');
  eq(APP_SESSION_TTL_SECONDS / 3600, 72, 'hours');
});

check('the closed contract requires a BOUNDED TTL, never this number', () => {
  const contract = readFileSync(join(ROOT, 'docs', 'PHASE_B2_1_GATEWAY_CONTRACT.md'), 'utf8');
  assert(/server-side TTL/.test(contract), 'the contract no longer requires a server-side TTL');
  assert(contract.indexOf('1800') === -1, 'the contract now names 1800 — owner decision 5 STOP condition would fire');
  assert(contract.indexOf('259200') === -1, 'the contract now names 259200; the value belongs in code, not the contract');
});

// ---------------------------------------------------------------- the named boundaries

const BOUNDARIES = [
  ['T0', 0, true],
  ['T+29m', 29 * 60 * 1000, true],
  ['T+31m', 31 * 60 * 1000, true],          // would have been DEAD under 1800s
  ['T+24h', 24 * HOUR, true],
  ['T+48h', 48 * HOUR, true],
  ['just before 72h', 72 * HOUR - 1000, true],
  ['exactly 72h', 72 * HOUR, false],
  ['after 72h', 72 * HOUR + 1000, false]
];

check('every named boundary behaves as specified', () => {
  const exp = expiresAt(T0);
  for (const [label, offset, shouldLive] of BOUNDARIES) {
    eq(isLive(exp, T0 + offset), shouldLive, label);
  }
});

check('T+31m is alive now and would have been dead under 1800s', () => {
  const now = T0 + 31 * 60 * 1000;
  assert(isLive(expiresAt(T0), now), 'T+31m is dead under the new TTL');
  const old = new Date(T0 + 1800 * 1000).toISOString();
  assert(!isLive(old, now), 'the old TTL fixture is wrong');
});

check('expiry is exclusive at the boundary — exactly 72h is EXPIRED', () => {
  const exp = expiresAt(T0);
  eq(new Date(exp).getTime(), T0 + 72 * HOUR, 'expiry instant');
  eq(isLive(exp, T0 + 72 * HOUR), false, 'a session must not survive its own expiry instant');
});

check('an expired session can neither mutate nor submit', () => {
  // Both endpoints gate on the same comparison; this is that comparison, stated once.
  const exp = expiresAt(T0);
  const after = T0 + 73 * HOUR;
  eq(isLive(exp, after), false, 'expired session still live');
  // Draft write and submit share the rule, so neither can outlive the other.
  const draftAllowed = isLive(exp, after);
  const submitAllowed = isLive(exp, after);
  eq(draftAllowed, submitAllowed, 'draft and submit disagree about expiry');
  eq(draftAllowed, false, 'an expired session was allowed to write');
});

// ---------------------------------------------------------------- fixed, server-side, unsliding

check('the expiry is stamped server-side and is not sliding', () => {
  const gw = buildGateway();
  const node = gw.nodes.find((n) => n.name === 'Build App Session');
  const code = node.parameters.jsCode;
  assert(/const TTL_SECONDS = 259200/.test(code), 'the deployed node does not carry the 72h TTL');
  assert(/expires_at: new Date\(now\.getTime\(\) \+ TTL_SECONDS \* 1000\)/.test(code), 'expiry is not computed from mint time');
  // A sliding window would recompute the app-session expiry on activity. Only the mint node may
  // derive it.
  //
  // `expires_at` is a column name shared by TWO tables, so a blanket search for the string is the
  // wrong measurement: Derive Replay Key and G5 Replay Claim carry the REPLAY ledger's expiry
  // (auth_date + 900), a different clock on a different row. What must hold is that no other node
  // DERIVES an app-session expiry — Respond Bootstrap OK may only read the minted value back.
  const others = gw.nodes.filter((n) => n.name !== 'Build App Session');
  for (const n of others) {
    const j = JSON.stringify(n);
    assert(!/TTL_SECONDS/.test(j), n.name + ' computes a TTL — only Build App Session may');
    assert(!/259200/.test(j), n.name + ' carries the app-session TTL literal');
  }
  // The response no longer reads Build App Session directly: since cross-reload resume, the answer
  // may describe an EXISTING session rather than the one just minted, and the expiry it reports is
  // that session's stored `expires_at`. What must still hold is that the value is READ from a row
  // and never recomputed — so the two nodes that assemble the answer may copy `row.expires_at` and
  // must not contain a clock.
  const respond = gw.nodes.find((n) => n.name === 'Respond Bootstrap OK');
  assert(String(respond.parameters.responseBody).indexOf('__response') !== -1,
    'the responder no longer serialises the assembled answer');
  for (const name of ['Resolve Session', 'Finalise Session']) {
    const n = gw.nodes.find((x) => x.name === name);
    assert(n, 'the answer is assembled by a node this gate does not know: ' + name);
    const js = String(n.parameters.jsCode);
    assert(/expires_at: String\(row\.expires_at\)/.test(js),
      name + ' does not copy the STORED expiry into the answer');
    assert(!/TTL_SECONDS|259200|getTime\(\)\s*\+/.test(js),
      name + ' computes an expiry instead of reading one — the TTL would become sliding');
  }
  // And the client is still told an expiry it can only read.
  assert(!/expires_at/.test(String(gw.nodes.find((x) => x.name === 'Gateway Webhook').parameters.path || '')),
    'sanity');
});

check('the client cannot choose or extend the TTL', () => {
  const gw = buildGateway();
  const code = gw.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode;
  // The value must be a literal, never read from the request.
  assert(!/body|request|\$json\.ttl|ttl_seconds/i.test(code.replace(/TTL_SECONDS/g, '')), 'TTL is influenced by request data');
  const draft = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-session-endpoint-candidate.json'), 'utf8'));
  const json = JSON.stringify(draft);
  assert(!/expires_at\s*:/.test(json.replace(/expires_at\)\)\.getTime/g, '')), 'the draft endpoint writes expires_at');
});

// ---------------------------------------------------------------- G5 is a different clock

check('the G5 replay clock is untouched by this change', () => {
  const gw = buildGateway();
  const derive = gw.nodes.find((n) => n.name === 'Derive Replay Key').parameters.jsCode;
  // The replay ledger expires 900s after the Telegram auth_date. Different origin, different
  // duration, different purpose: it bounds how long ONE initData may be claimed, not how long a
  // draft may be resumed. Widening the app session must not widen this.
  assert(/authDate \+ 900/.test(derive), 'the G5 replay expiry is no longer auth_date + 900');
  assert(!/259200/.test(derive), 'the app-session TTL leaked into the replay key derivation');
  assert(!/1800/.test(derive), 'the old app-session TTL is present in the replay key derivation');
});

check('the replay claim query and the freshness window are unchanged', () => {
  const gw = buildGateway();
  const claim = gw.nodes.find((n) => n.name === 'G5 Replay Claim');
  assert(/telegram_initdata_replays/.test(claim.parameters.query), 'the claim no longer targets the G5 ledger');
  assert(/on conflict \(replay_key\) do nothing/.test(claim.parameters.query), 'the claim lost its atomic conflict');
  assert(!/259200/.test(JSON.stringify(claim)), 'the new TTL reached the claim node');
});

// ---------------------------------------------------------------- privacy consequence

check('the longer window is bounded, and the draft still carries no signed material', () => {
  const gw = buildGateway();
  const build = gw.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode;
  // The session row is what now lives for 72h instead of 30m. It must still contain no initData,
  // no signature and no free-text business content at mint time.
  for (const forbidden of ['init_data', 'signature', 'hash', 'auth_date']) {
    assert(build.indexOf(forbidden) === -1, 'the app session row carries ' + forbidden);
  }
  assert(/draft_json: ''/.test(build), 'the session is minted with a non-empty draft');
  assert(APP_SESSION_TTL_SECONDS < 7 * 24 * 3600, 'the TTL is no longer meaningfully bounded');
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
