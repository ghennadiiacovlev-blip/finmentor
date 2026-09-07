#!/usr/bin/env node
// FINMENTOR — B.2.1-C P7.0: the Concierge issuer half, offline gate.
//
//   node qa/concierge-issuer.test.mjs
//
// Offline: no tenant, no credential, no network. What is LIVE-derived here are two execution
// results recorded as constants (3651, 3652) and asserted against the module's own declared
// evidence, so a future edit cannot quietly restate what the probes found.
//
// Four jobs:
//
//   1. THE MINT. Format, byte handling, and — the part that matters — that every guard
//      actually fires. A mint that validates nothing looks identical to one that validates
//      everything, until the day the platform hands it four bytes.
//
//   2. THE ISSUANCE DECISION, whose one safety rule is NEVER_BACKFILL. A legacy cycle must not
//      receive a key retroactively, because a fresh READY receipt is positive evidence that no
//      handoff began — and for a cycle that has already submitted, that evidence is false and
//      releases a duplicate.
//
//   3. THE SANDBOX PRIMITIVE. `crypto` is undefined in an n8n Code node on this tenant
//      (exec 3651). No tracked workflow artifact may reference the global, because the failure
//      is a ReferenceError on the /start path — a bot that stops answering, not a failed write.
//
//   4. THE TWO STRUCTURAL BLOCKERS found while tracing the live Concierge (F14, F15). Both are
//      pinned in their CURRENT, known-bad state against the production export, so that fixing
//      either one is a deliberate act that must come here and say so.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const throws = (fn, m) => {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) { throw new Error(m); }
};

const ISSUER = require(join(ROOT, 'n8n', 'src', 'concierge-issuer', 'mint-submission-key.js'));
const RECEIPT = require(join(ROOT, 'n8n', 'src', 'lead-intake', 'idempotency-receipt.js'));

const CONCIERGE = JSON.parse(readFileSync(
  join(ROOT, 'n8n', 'production', 'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
const nodeByName = (n) => {
  const found = CONCIERGE.nodes.find((x) => x.name === n);
  if (!found) { throw new Error('node not found in the tracked Concierge export: ' + n); }
  return found;
};

// ---------------------------------------------------------------- live probe results
//
// Recorded from the two P7.0 preflight executions. Archived workflows hBzJMVsCCu2xrccG and
// JRprsVgF1elD03Xz; credential-free, no I/O, no production node touched.

const PROBE_3651 = {
  typeof_crypto: 'undefined',
  crypto_randomUUID: 'ERR: crypto is not defined',
  crypto_getRandomValues_hex32: 'ERR: crypto is not defined',
  crypto_randomBytes_hex32: 'ERR: crypto is not defined',
  require_crypto_randomBytes: 'e0156e8ea8c81ca8f39b002155c76550',
  typeof_Buffer: 'function',
  typeof_require: 'function',
  node_version: 'ERR: process is not defined'
};

const PROBE_3652 = {
  draws: 10000,
  distinct: 10000,
  collisions: 0,
  bad_format: 0,
  distinct_byte_values: 256,
  same_ms_pair_measured: true,
  same_ms_pair_distinct: true,
  common_prefix_hex_chars: 0
};

// ================================================================ 1. the mint

check('(1.1) the mint produces the P3 format against the real primitive', () => {
  for (let i = 0; i < 200; i++) {
    const k = ISSUER.mintSubmissionKey(randomBytes);
    assert(ISSUER.SUBMISSION_KEY_RE.test(k), 'malformed key: ' + k);
    eq(k.length, 36, 'key length is not 4 + 32');
  }
});

check('(1.2) 5,000 offline draws collide zero times', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) { seen.add(ISSUER.mintSubmissionKey(randomBytes)); }
  eq(seen.size, 5000, 'the offline mint collided');
});

check('(1.3) low bytes are zero-padded, so the key is never short', () => {
  const k = ISSUER.mintSubmissionKey(() => new Uint8Array(16));
  eq(k, 'sub_' + '00'.repeat(16), 'a sixteen-zero-byte draw did not render as 32 hex chars');
  const k2 = ISSUER.mintSubmissionKey(() => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 255]));
  eq(k2, 'sub_0102030405060708090a0b0c0d0e0fff', 'byte rendering drifted');
});

// MUTATION. Each guard is shown to FAIL on the input it exists for. A validation that has
// never been observed rejecting anything is a comment, not a check.
check('(1.4) MUTATION — a short draw is refused', () => {
  throws(() => ISSUER.mintSubmissionKey(() => new Uint8Array(8)), 'an 8-byte draw was accepted');
  throws(() => ISSUER.mintSubmissionKey(() => new Uint8Array(32)), 'a 32-byte draw was accepted');
  throws(() => ISSUER.mintSubmissionKey(() => null), 'a null draw was accepted');
});

check('(1.5) MUTATION — a non-byte draw is refused', () => {
  throws(() => ISSUER.mintSubmissionKey(() => Object.assign(new Array(16).fill(0), { 3: 256 })), 'a 256 byte was accepted');
  throws(() => ISSUER.mintSubmissionKey(() => Object.assign(new Array(16).fill(0), { 0: -1 })), 'a negative byte was accepted');
  throws(() => ISSUER.mintSubmissionKey(() => Object.assign(new Array(16).fill(0), { 7: 1.5 })), 'a fractional byte was accepted');
  throws(() => ISSUER.mintSubmissionKey(() => Object.assign(new Array(16).fill(0), { 2: 'ff' })), 'a string byte was accepted');
});

check('(1.6) MUTATION — no randomBytes at all is refused, not silently substituted', () => {
  throws(() => ISSUER.mintSubmissionKey(undefined), 'a missing primitive was accepted');
  throws(() => ISSUER.mintSubmissionKey({}), 'a non-function primitive was accepted');
});

check('(1.7) the mint agrees with the receipt module that already consumes the key', () => {
  // Not a soft comparison: the receipt module exports its regex, so the two are compared
  // directly. If it ever stops exporting one, this fails rather than passing vacuously.
  assert(RECEIPT.SUBMISSION_KEY_RE instanceof RegExp, 'the receipt module no longer exports SUBMISSION_KEY_RE');
  eq(String(ISSUER.SUBMISSION_KEY_RE), String(RECEIPT.SUBMISSION_KEY_RE),
    'the issuer and the receipt module disagree on the key format');
  for (let i = 0; i < 50; i++) {
    assert(RECEIPT.SUBMISSION_KEY_RE.test(ISSUER.mintSubmissionKey(randomBytes)),
      'the receipt module rejects a freshly minted key');
  }
});

check('(1.8) a minted key is accepted by buildPreallocation and yields a pristine READY row', () => {
  const key = ISSUER.mintSubmissionKey(randomBytes);
  const pre = RECEIPT.buildPreallocation({
    submissionKey: key, internalRouteProven: true, provenanceTrusted: true,
    nowIso: '2026-08-27T12:00:00.000Z'
  });
  assert(pre.ok, 'buildPreallocation refused a minted key: ' + pre.reason);
  eq(pre.record.submission_key, key, 'the preallocation carries a different key');
  eq(pre.record.commit_state, 'READY', 'the preallocation is not READY');
  eq(pre.record.correlation_id, '', 'a preallocated receipt carries a correlation id');
  ['canonical_lead_id', 'claimed_at', 'settled_at', 'abort_reason', 'lead_mode', 'lead_priority', 'financial_zone']
    .forEach((f) => eq(pre.record[f], '', 'the preallocation is not pristine at ' + f));
});

// ================================================================ 2. the issuance decision

const mint = () => ISSUER.mintSubmissionKey(randomBytes);

check('(2.1) every reset trigger mints a NEW key and requires preallocation', () => {
  ['start', 'restart', 'bootstrap'].forEach((reset) => {
    const d = ISSUER.decideIssuance({ reset, persistedKey: 'sub_' + 'a'.repeat(32), persistedCycleId: 'C-1-1', mint });
    eq(d.action, 'MINT', reset + ' did not mint');
    eq(d.preallocate, true, reset + ' did not require a preallocation');
    assert(ISSUER.isSubmissionKey(d.submission_key), reset + ' minted a malformed key');
    assert(d.submission_key !== 'sub_' + 'a'.repeat(32), reset + ' reused the old key');
  });
});

check('(2.2) an unchanged cycle CARRIES its key and preallocates nothing', () => {
  const key = mint();
  const d = ISSUER.decideIssuance({ reset: '', persistedKey: key, persistedCycleId: 'C-1-1' });
  eq(d.action, 'CARRY', 'an unchanged cycle did not carry');
  eq(d.submission_key, key, 'the carried key changed');
  eq(d.preallocate, false, 'an unchanged cycle asked for a second receipt');
});

check('(2.3) NEVER_BACKFILL — a legacy cycle with no key is NOT given one', () => {
  const d = ISSUER.decideIssuance({ reset: '', persistedKey: '', persistedCycleId: 'C-900001-1756000000000' });
  eq(d.action, 'LEGACY_NO_KEY', 'a legacy cycle was not classified as such');
  eq(d.submission_key, '', 'a legacy cycle was backfilled with a key');
  eq(d.preallocate, false, 'a legacy cycle triggered a preallocation');
  eq(d.reason, 'LEGACY_CYCLE_NOT_BACKFILLED', 'the refusal reason drifted');
});

check('(2.4) NEVER_BACKFILL holds for a legacy cycle that has ALREADY submitted', () => {
  // The exact row shape the rule exists for: a real lead_id, a real cycle, no key. Minting
  // here would preallocate READY, and READY is read as "no handoff began".
  const d = ISSUER.decideIssuance({
    reset: '', persistedKey: '', persistedCycleId: 'C-900001-1756000000000',
    persistedLeadId: 'LEAD-2026-0001'
  });
  eq(d.action, 'LEGACY_NO_KEY', 'a submitted legacy cycle was not refused');
  eq(d.submission_key, '', 'a submitted legacy cycle was backfilled — this releases a duplicate lead');
});

check('(2.5) MUTATION — the backfill refusal is not vacuous', () => {
  // Prove the assertion in 2.3 can fail: a decision function that DID backfill would be
  // caught. Modelled rather than asserted about, so the test's own logic is exercised.
  const backfilling = (o) => (o.reset === '' && o.persistedKey === '' && o.persistedCycleId !== ''
    ? { action: 'MINT', submission_key: mint(), preallocate: true }
    : ISSUER.decideIssuance(o));
  const bad = backfilling({ reset: '', persistedKey: '', persistedCycleId: 'C-1-1' });
  eq(bad.action, 'MINT', 'the mutant did not backfill, so 2.3 proves nothing');
  const good = ISSUER.decideIssuance({ reset: '', persistedKey: '', persistedCycleId: 'C-1-1' });
  assert(good.action !== bad.action, 'the real decision behaves like the backfilling mutant');
});

check('(2.6) a malformed key is carried UNCHANGED, never repaired and never blanked', () => {
  ['sub_NOTHEX', 'sub_', 'SUB_' + 'a'.repeat(32), 'sub_' + 'a'.repeat(31), 'sub_' + 'A'.repeat(32)]
    .forEach((bad) => {
      const d = ISSUER.decideIssuance({ reset: '', persistedKey: bad, persistedCycleId: 'C-1-1' });
      eq(d.action, 'CARRY_MALFORMED', 'a malformed key was not classified: ' + bad);
      eq(d.submission_key, bad, 'a malformed key was altered: ' + bad);
      eq(d.preallocate, false, 'a malformed key triggered a preallocation: ' + bad);
    });
});

check('(2.7) a session with neither cycle nor key is distinguished from a legacy one', () => {
  const d = ISSUER.decideIssuance({ reset: '', persistedKey: '', persistedCycleId: '' });
  eq(d.action, 'LEGACY_NO_KEY', 'the no-cycle case changed action');
  eq(d.reason, 'NO_CYCLE_NO_KEY', 'the no-cycle case is not distinguished from a legacy cycle');
});

check('(2.8) a reset without a mint function is refused rather than issuing a keyless cycle', () => {
  throws(() => ISSUER.decideIssuance({ reset: 'start', persistedKey: '', persistedCycleId: '' }),
    'a new cycle was issued with no mint available');
});

check('(2.9) a mint that returns a malformed key is refused at the decision boundary too', () => {
  throws(() => ISSUER.decideIssuance({ reset: 'start', mint: () => 'sub_NOTHEX' }), 'a malformed mint was accepted');
  throws(() => ISSUER.decideIssuance({ reset: 'start', mint: () => '' }), 'an empty mint was accepted');
});

check('(2.10) every returned action is a declared one', () => {
  const cases = [
    { reset: 'start', mint }, { reset: '', persistedKey: mint() },
    { reset: '', persistedKey: '', persistedCycleId: 'C-1-1' }, { reset: '', persistedKey: 'sub_bad' }
  ];
  cases.forEach((c) => {
    const d = ISSUER.decideIssuance(c);
    assert(ISSUER.ISSUANCE_ACTIONS.indexOf(d.action) !== -1, 'undeclared action: ' + d.action);
  });
});

// ---------------------------------------------------------------- authority advance

// The verdicts below are produced by the REAL verifier the deployed graph will call, not by
// hand-written objects. A hand-written {ok:true} proves only that the caller can be fooled.
const readyRow = (key, over) => Object.assign({
  submission_key: key, commit_state: 'READY', canonical_lead_id: '', lead_mode: '',
  lead_priority: '', financial_zone: '', created_at: '2026-08-27T12:00:00.000Z',
  claimed_at: '', settled_at: '', abort_reason: '', correlation_id: ''
}, over || {});
const verdictFor = (key, rows, extra) =>
  RECEIPT.verifyPreallocationReadback(Object.assign({ submissionKey: key, rows }, extra || {}));

check('(3.1) authority may NOT advance on any readback the real verifier refuses', () => {
  const d = ISSUER.decideIssuance({ reset: 'start', mint });
  const k = d.submission_key;
  const cases = [
    ['absent', verdictFor(k, [])],
    ['duplicate', verdictFor(k, [readyRow(k), readyRow(k)])],
    ['wrong key', verdictFor(k, [readyRow(mint())])],
    ['already claimed', verdictFor(k, [readyRow(k, { correlation_id: 'req-x' })])],
    ['wrong state', verdictFor(k, [readyRow(k, { commit_state: 'IN_FLIGHT' })])],
    ['not pristine', verdictFor(k, [readyRow(k, { lead_priority: 'high' })])],
    ['created_at missing', verdictFor(k, [readyRow(k, { created_at: '' })])],
    ['store error', verdictFor(k, null, { storeError: true })],
    ['unreadable', verdictFor(k, null)],
    ['no verdict at all', undefined]
  ];
  cases.forEach(([label, v]) => {
    if (label !== 'no verdict at all') {
      eq(v.advance, false, 'the verifier itself accepted a bad readback: ' + label);
    }
    eq(ISSUER.authorityAdvanceAllowed(d, v).advance, false, 'authority advanced on: ' + label);
  });
});

check('(3.2) authority advances on a genuinely confirmed readback, and only then', () => {
  const d = ISSUER.decideIssuance({ reset: 'start', mint });
  const good = verdictFor(d.submission_key, [readyRow(d.submission_key)]);
  eq(good.ok, true, 'the verifier refused a pristine READY row: ' + good.reason);
  eq(ISSUER.authorityAdvanceAllowed(d, good).advance, true, 'a confirmed readback did not allow the advance');
  // MUTATION — the positive case is reachable, so 3.1 is proving refusal rather than
  // reporting that nothing ever advances.
  eq(ISSUER.authorityAdvanceAllowed(d, verdictFor(d.submission_key, [])).advance, false,
    'the same decision advanced with no receipt at all');
});

check('(3.2b) a verdict about a DIFFERENT key cannot be handed in for this decision', () => {
  const d = ISSUER.decideIssuance({ reset: 'start', mint });
  const other = mint();
  // The verifier is key-scoped, so a genuine verdict for another key still carries ok:true.
  // The advance guard refuses it anyway: confirming SOME receipt is not confirming THIS one.
  const foreign = verdictFor(other, [readyRow(other)]);
  eq(foreign.ok, true, 'the foreign verdict was not itself a pass — the check would be vacuous');
  eq(ISSUER.authorityAdvanceAllowed(d, Object.assign({ key: other }, foreign)).advance, false,
    'authority advanced on a readback for a DIFFERENT key');
});

check('(3.3) a carry needs no new receipt, and says so rather than inventing a verdict', () => {
  const d = ISSUER.decideIssuance({ reset: '', persistedKey: mint() });
  const r = ISSUER.authorityAdvanceAllowed(d, undefined);
  eq(r.advance, true, 'an unchanged cycle was blocked from persisting its session');
  eq(r.reason, 'NO_NEW_RECEIPT_REQUIRED', 'the carry reason drifted');
});

check('(3.4) the module ordering matches the receipt module ISSUANCE_ORDER it implements step 1 of', () => {
  const order = RECEIPT.ISSUANCE_ORDER || [];
  assert(order.length >= 6, 'ISSUANCE_ORDER is not readable from the receipt module');
  assert(/mint/i.test(order[0]), 'step 1 is no longer the mint: ' + order[0]);
  assert(/authority|Bot_Sessions/i.test(order.join(' ')), 'the authority write left ISSUANCE_ORDER');
  // The invariant this whole module serves.
  assert(RECEIPT.PREALLOCATION_INVARIANT && /never exists without/.test(RECEIPT.PREALLOCATION_INVARIANT.rule),
    'the preallocation invariant changed wording; the issuer was written against it');
});

// ================================================================ 4. the sandbox primitive

check('(4.1) the module declares what the live probe actually found', () => {
  eq(ISSUER.ENTROPY_EVIDENCE.tenant_has_global_crypto, false, 'the module claims a global crypto exists');
  eq(PROBE_3651.typeof_crypto, 'undefined', 'the recorded probe result was edited');
  assert(/^ERR:/.test(PROBE_3651.crypto_getRandomValues_hex32), 'getRandomValues is recorded as working');
  assert(/^[0-9a-f]{32}$/.test(PROBE_3651.require_crypto_randomBytes), 'the working primitive is not recorded');
  eq(ISSUER.ENTROPY_EVIDENCE.proven_by_execution, '3651', 'the evidence pointer drifted');
});

check('(4.2) the recorded quality run is not vacuous — the same-millisecond pair really happened', () => {
  eq(PROBE_3652.same_ms_pair_measured, true, 'the same-millisecond pair was never actually measured');
  eq(PROBE_3652.same_ms_pair_distinct, true, 'two keys minted in one millisecond collided');
  eq(PROBE_3652.collisions, 0, 'the live mint collided');
  eq(PROBE_3652.distinct, PROBE_3652.draws, 'distinct draws do not equal the draw count');
  eq(PROBE_3652.distinct_byte_values, 256, 'the live mint did not cover the byte range');
  eq(PROBE_3652.common_prefix_hex_chars, 0, 'two live draws shared a prefix — a time-derived generator would');
});

check('(4.3) cycle_id is time-derived and would collide where the key does not', () => {
  const gate = nodeByName('Get Bot Session').parameters.jsCode;
  assert(/Date\.now\(\)/.test(gate), 'cycle_id is no longer time-derived; this comparison is stale');
  assert(/'C-' \+ str\(p\.chat_id\) \+ '-' \+ Date\.now\(\)/.test(gate),
    'the cycle_id expression changed; re-derive the collision claim before trusting it');
});

check('(4.4) NO tracked workflow Code body references the crypto GLOBAL', () => {
  // A ReferenceError inside Get Bot Session is not a failed submission — it is a bot that
  // stops answering /start. This is the cheapest possible guard against the most expensive
  // available mistake, and it covers every tracked artifact, not just the ones P7 touches.
  const files = [
    ['n8n/production/mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'],
    ['n8n/production/QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'],
    ['n8n/candidate/lead-intake-internal-receipt-candidate.json']
  ];
  files.forEach(([rel]) => {
    const wf = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
    wf.nodes.forEach((n) => {
      const js = (n.parameters && (n.parameters.jsCode || n.parameters.code)) || '';
      if (!js) { return; }
      // WHOLE-LINE COMMENTS ARE STRIPPED BEFORE ANY OF THIS. A ReferenceError comes from
      // executed code, never from prose -- and the Model-B `Get Bot Session` that P7.5R put
      // into production carries a comment block naming the forbidden forms precisely to record
      // why they must not be used. Flagging that is not strictness, it is a gate that punishes
      // documenting its own hazard, and the cheapest way to make it green would have been to
      // delete the warning.
      //
      // Only WHOLE-LINE comments go. Stripping from the first `//` on any line would also cut
      // a real usage sitting after a URL in a string literal, which is the one thing this check
      // must never miss.
      const code = js.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
      ISSUER.FORBIDDEN_IN_CODE_NODE.forEach((bad) => {
        assert(code.indexOf(bad) === -1, rel + ' node "' + n.name + '" uses ' + bad + ', which is undefined in the n8n Code sandbox (exec 3651)');
      });
      // The bare global, in any use. `require('crypto')` is the allowed form and is excluded
      // by requiring the reference to NOT be preceded by require('...').
      const bareGlobal = code.replace(/require\(\s*['"]crypto['"]\s*\)/g, 'REQUIRED_CRYPTO');
      assert(!/(^|[^A-Za-z0-9_$.])crypto\s*\./.test(bareGlobal),
        rel + ' node "' + n.name + '" references the crypto global');
    });
  });
});

check('(4.4b) MUTATION: stripping comments does not stop (4.4) seeing a real call', () => {
  // (4.4) was narrowed to executable lines. That narrowing is only safe if the narrowed scan
  // still fires -- so plant the forbidden call on a CODE line inside the very node whose
  // comment block motivated the change, and require both halves of the check to catch it.
  const wf = JSON.parse(readFileSync(join(ROOT,
    'n8n/production/mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
  const victim = wf.nodes.find((n) => n.name === 'Get Bot Session');
  assert(victim, 'Get Bot Session is gone; re-derive this mutation');
  const strip = (s) => s.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

  // The node as it really is: clean once the prose is removed.
  const clean = strip(victim.parameters.jsCode);
  assert(clean.indexOf('crypto.getRandomValues') === -1, 'the real body has a live getRandomValues call');
  assert(!/(^|[^A-Za-z0-9_$.])crypto\s*\./.test(
    clean.replace(/require\(\s*['"]crypto['"]\s*\)/g, 'REQUIRED_CRYPTO')), 'the real body uses the crypto global');

  // The same node with one executable line added.
  const planted = strip(victim.parameters.jsCode + '\nconst r = crypto.getRandomValues(new Uint8Array(16));');
  assert(planted.indexOf('crypto.getRandomValues') !== -1, 'the literal scan went blind after stripping');
  assert(/(^|[^A-Za-z0-9_$.])crypto\s*\./.test(
    planted.replace(/require\(\s*['"]crypto['"]\s*\)/g, 'REQUIRED_CRYPTO')), 'the global scan went blind after stripping');
});

check('(4.5) the issuer names require(crypto) as the primitive the deployed body must use', () => {
  eq(ISSUER.REQUIRED_ENTROPY_CALL, "require('crypto').randomBytes", 'the required primitive drifted');
  assert(ISSUER.FORBIDDEN_IN_CODE_NODE.indexOf('crypto.randomUUID') !== -1, 'randomUUID is no longer forbidden');
  assert(ISSUER.FORBIDDEN_IN_CODE_NODE.indexOf('crypto.getRandomValues') !== -1, 'getRandomValues is no longer forbidden');
});

check('(4.6) the SOURCE module still carries a crypto-global call that must never be spliced as-is', () => {
  // Honest, not alarmist: n8n/src/lead-intake/idempotency-receipt.js calls crypto.randomUUID()
  // in newCorrelationId(). That is FINE in Node — every offline gate runs it — and fatal in a
  // Code node. It is not deployed today (4.4 proves that), and this check records WHY the two
  // facts coexist so that a future splice of that helper is a decision rather than an accident.
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'lead-intake', 'idempotency-receipt.js'), 'utf8');
  const usesGlobal = /crypto\.randomUUID\(\)/.test(src);
  assert(usesGlobal, 'newCorrelationId no longer uses the crypto global — remove this check and the warning it carries');
  assert(/function newCorrelationId/.test(src), 'the helper was renamed; re-derive the splice hazard');
});

// ================================================================ 5. the structural blockers

// F14 — REFUTED BY P7.1, execution 3660. Read the correction before touching this node.
//
// P7.0 asserted that `Read Bot Sessions`, pinned to A:AV, is truncated before submission_key
// and so structurally cannot read it. That was wrong twice over, and both errors were found by
// measuring rather than by re-reading the export:
//
//   1. THE ARITHMETIC WAS OFF BY ONE. The live header tail is AV 48 submission_key,
//      AW 49 lead_mode, AX 50 lead_priority, AY 51 financial_zone — not AW..AZ / 49..52.
//      submission_key is the LAST column INSIDE A:AV, not the first outside it.
//   2. THE RANGE DOES NOT TRUNCATE ANYWAY. If A:AV bounded the read at 48 columns it would
//      return 49 fields (48 + row_number). It returned 58 — the full 57-column row plus
//      row_number — the identical count the widened A:AZ read returned, on the SAME row at the
//      SAME moment through nodes differing in exactly one field.
//
// So the range is pinned here for the OPPOSITE reason it used to be: production is already
// correct, and P7.0 §5 step 1 (widen it in a candidate) is unnecessary work on a node that sits
// on the path of every Telegram update. The safest change to that graph is the one not made.
// If this check ever fails, someone widened a range that never needed widening.
check('(5.1) F14 refuted — Read Bot Sessions still pins A:AV, which already covers submission_key', () => {
  const opts = nodeByName('Read Bot Sessions').parameters.options || {};
  const loc = (opts.dataLocationOnSheet || {}).values || {};
  eq(loc.rangeDefinition, 'specifyRange', 'the read is no longer an explicit range — re-derive F14');
  eq(loc.range, 'A:AV', 'the Concierge read range changed — P7.1 proved it did not need to. Re-read P7_1 §2');
  // The corrected arithmetic, stated so nobody re-derives the off-by-one: A=1 .. AV=48.
  const colIndex = (name) => name.split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
  eq(colIndex('AV'), 48, 'column arithmetic is wrong');
  eq(colIndex('AY'), 51, 'column arithmetic is wrong');
  // submission_key is at AV — inside the range — and the three B.2.1-C columns that follow it
  // are AW..AY. This is the live layout measured at exec 3660, not the P7.0 derivation. The
  // range's own end is parsed rather than assumed, so the containment is derived from the
  // pinned value above and cannot drift away from it.
  const rangeEnd = String(loc.range).split(':')[1];
  assert(colIndex('AV') <= colIndex(rangeEnd),
    'submission_key (AV, 48) is no longer inside the read range ' + loc.range);
  eq(colIndex('AY') - colIndex('AV'), 3, 'the B.2.1-C tail is four columns AV..AY');
});

// F15 — CLOSED LIVE BY P7.1, execution 3660. autoMapInputData, carrying this exact 40-entry
// schema, persisted ALL FOUR B.2.1-C columns into headers that had zero data on every row —
// the precise condition P7.0 flagged as the hazard. Read back byte-identical, with
// OTHER_ROWS_WITH_B21C = 0. No explicit column mapping is needed.
//
// The mapping mode is still pinned, but for a NEW reason — see (5.5), F16.
check('(5.2) F15 closed — Save Bot Session auto-maps, and P7.1 proved the write lands', () => {
  const cols = nodeByName('Save Bot Session').parameters.columns || {};
  eq(cols.mappingMode, 'autoMapInputData', 'the mapping mode changed; re-derive F15 and F16 together');
  eq(JSON.stringify(cols.matchingColumns), JSON.stringify(['chat_id']), 'the match column changed');
  const schemaIds = (cols.schema || []).map((s) => s.id);
  eq(schemaIds.length, 40, 'the stored schema is no longer the 40 entries P7.1 proved the write against');
  assert(schemaIds.indexOf('submission_key') === -1,
    'the production Save Bot Session schema now lists submission_key — production was modified; that must be deliberate');
});

// (5.3) USED TO READ "the production Concierge still contains ZERO submission_key references",
// and its own comment named the condition for changing it: "the day this fails, production has
// been modified and that must be a deliberate, recorded act." P7.5R is that act. It is not
// remembered, it is recorded — n8n/baseline-seal.json carries the version chain, the approved
// target hash and the proof that live matched it.
//
// So the containment does not disappear, it MOVES: production may reference submission_key only
// while a sealed record says a cutover put it there. Deleting the check instead would have left
// the repository unable to tell a deployed issuer from an undeployed one.
check('(5.3) production references submission_key, and a SEALED record says why', () => {
  const SEALM = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'baseline-seal.js'));
  const sealFile = JSON.parse(readFileSync(join(ROOT, 'n8n', 'baseline-seal.json'), 'utf8'));
  const rec = (sealFile.records || []).filter((r) => r.workflowId === 'mppzthlkSJFr6Kle').pop();

  const hits = CONCIERGE.nodes.filter((n) => JSON.stringify(n.parameters || {}).indexOf('submission_key') !== -1);
  if (hits.length === 0) {
    // The pre-cutover state is still a legitimate state for this gate to see.
    assert(!rec || rec.status !== SEALM.SEALED,
      'a sealed cutover is recorded but production carries no submission_key reference at all');
  } else {
    assert(rec, 'production references submission_key with NO cutover recorded for this workflow');
    eq(rec.status, SEALM.SEALED,
      'production carries the issuer but its cutover is ' + rec.status + '; the reference describes neither state');
    eq(rec.nodeCount, CONCIERGE.nodes.length, 'the sealed record and the tracked reference disagree on node count');
    eq(rec.postVersionId, CONCIERGE.versionId, 'the tracked reference is not the version the record sealed');
  }
  eq(CONCIERGE.active, true, 'the production Concierge is no longer active; re-read the deployment risk');
});

check('(5.4) the row builders the issuer must extend are the ones the legacy gate pins', () => {
  const colsOf = (nodeName) => {
    const js = nodeByName(nodeName).parameters.jsCode;
    const m = js.match(/const COLS = \[([\s\S]*?)\]/);
    assert(m, 'COLS not found in ' + nodeName);
    return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  };
  const BUILDERS = ['Build Session Row', 'Build Intake State Row', 'Build Confirmation State Row'];
  // 36 before P7.5R, 37 after: the issuer adds exactly submission_key and nothing else. The
  // number is stated as base + the one approved column rather than as 37, so a second column
  // arriving later cannot hide inside a bumped literal.
  const BASE_COLS = 36;
  const carriers = BUILDERS.filter((b) => colsOf(b).indexOf('submission_key') !== -1);

  // THE HAZARD, and the reason this check is worth more than the count. All three builders
  // persist the SAME sheet row, so a column carried by some of them is not partly shipped — it
  // is blanked by whichever one runs last. All three, or none.
  assert(carriers.length === 0 || carriers.length === BUILDERS.length,
    'submission_key is written by ' + carriers.join(', ') + ' but not the others; they will blank it');

  BUILDERS.forEach((b) => {
    const c = colsOf(b);
    eq(c.length, BASE_COLS + (carriers.length ? 1 : 0), b + ' COLS drifted from the pinned set');
    assert(c.indexOf('cycle_id') !== -1, b + ' no longer persists cycle_id');
  });
});

check('(5.5) the mint site is the cycle gate, and it is still a single well-known node', () => {
  const gate = nodeByName('Get Bot Session');
  eq(gate.type, 'n8n-nodes-base.code', 'the cycle gate is no longer a Code node');
  const js = gate.parameters.jsCode;
  assert(/let cycleId = str\(s\.cycle_id\)/.test(js), 'the cycle gate no longer holds the cycle in one place');
  assert(/s\.cycle_reset = reset/.test(js), 'cycle_reset is gone — the issuer decision reads it');
  // Exactly three reset triggers, matching decideIssuance.
  ['start', 'restart', 'bootstrap'].forEach((r) => assert(js.indexOf("reset = '" + r + "'") !== -1,
    'the ' + r + ' trigger left the cycle gate'));
});

// F16 — NEW, P7.1. autoMapInputData does NOT drop an unrecognised key. It APPENDS A COLUMN.
//
// P6R-1 recorded that a key with no matching header is "silently dropped". Against this sheet,
// with this node configuration, that is false: P7.1 carried a deliberate control property
// (p71_absent_column) through the write and read it back — the sheet had grown a new column BE.
// That is also where the six dead AZ:BE columns came from: each was created, one at a time, by
// a canary putting one stray property on a row object.
//
// The consequence is a SAFETY rule, not a hygiene preference. Save Bot Session is on the write
// path of every session turn. A stray property does not vanish — it permanently widens a live
// customer sheet. Losing a value is recoverable; mutating a shared schema is not. So the three
// row builders must emit EXACTLY their declared COLS, and (5.4) pins which three they are.
check('(5.6) F16 — the row builders emit exactly their declared COLS and nothing else', () => {
  const BUILDERS = ['Build Session Row', 'Build Intake State Row', 'Build Confirmation State Row'];
  for (const name of BUILDERS) {
    const js = nodeByName(name).parameters.jsCode;
    const m = js.match(/const COLS = \[([\s\S]*?)\]/);
    assert(m, 'COLS not found in ' + name + ' — F16 cannot be enforced on a builder with no declared column list');
    // The builder must construct its row FROM the declared list, not by spreading an upstream
    // object. A spread is the exact shape that carried p71_absent_column onto the sheet.
    assert(!/\.\.\.\s*\$?(json|input|item)/.test(js),
      name + ' spreads an upstream object into the row — under F16 that appends columns to Bot_Sessions');
  }
});

// ---------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
