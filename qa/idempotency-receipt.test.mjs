#!/usr/bin/env node
// FINMENTOR — G1 preallocated submission receipt gate (P3 architecture).
//
//   node qa/idempotency-receipt.test.mjs
//
// Proves the DECISION LOGIC of the preallocated receipt and the recovery adapter with no
// tenant, no credential and no network.
//
// WHAT THE IN-MEMORY STORE BELOW IS, AND IS NOT.
//
// `makeReceiptStore()` is a DOUBLE. It models the injected store contract — including a
// conditional update that reports `updated_rows` — so the logic above it can be exercised
// deterministically. It proves NOTHING about the live n8n Data Table: not durability, and
// crucially not the real semantics of conditional update under genuine concurrency. That is
// the P3 canary, and it is the reason G1 stays open. A green run here means the logic is
// right, not that the capability exists.
//
// P2 context, kept because it is why this file was rewritten: the platform has NO atomic
// insert-if-absent, so submit-time receipt creation is dead. See
// docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = require(join(HERE, '..', 'n8n', 'src', 'lead-intake', 'idempotency-receipt.js'));
const A = require(join(HERE, '..', 'n8n', 'src', 'miniapp-submit', 'recovery-adapter.js'));
const C = require(join(HERE, '..', 'n8n', 'src', 'miniapp-submit', 'submit-contract.js'));
const H = require(join(HERE, '..', 'n8n', 'src', 'miniapp-submit', 'submit-handler.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// ---------------------------------------------------------------- doubles

const NOW = '2026-08-26T02:00:00.000Z';
const LEAD_A = 'FIN-1756171200-042';
const CHAT = '900000777';

function makeReceiptStore(opts) {
  const o = opts || {};
  return {
    rows: [],
    unavailable: o.unavailable === true,
    failEmpty: o.failEmpty === true,
    sloppy: o.sloppy === true,
    caps: {
      exact_key_lookup: o.exact_key_lookup !== false,
      conditional_update: o.conditional_update !== false,
      read_after_write: o.read_after_write !== false
    },
    capabilities() { return this.caps; },
    readByKey(key) {
      if (this.failEmpty) { return { ok: false, rows: [] }; }
      if (this.unavailable) { return { ok: false, rows: null }; }
      if (this.sloppy) { return { ok: true, rows: this.rows.slice() }; }
      return { ok: true, rows: this.rows.filter((r) => r.submission_key === key) };
    },
    // Unconditional insert — all the platform offers, and safe here only because the key is
    // random and minted once. Preallocation, not submit-time creation.
    preallocate(record) {
      if (this.unavailable) { return { ok: false }; }
      this.rows.push(Object.assign({}, record));
      return { ok: true };
    },
    // The load-bearing primitive: match on key AND expected state, report updated_rows.
    conditionalUpdate(spec) {
      if (this.unavailable) { return { ok: false }; }
      const hit = this.rows.filter((r) =>
        r.submission_key === spec.where.submission_key &&
        r.commit_state === spec.where.commit_state);
      hit.forEach((r) => Object.assign(r, spec.set));
      return { ok: true, updated_rows: hit.length };
    }
  };
}

function lookupVia(store) {
  const built = A.createRecoveryAdapter(store);
  assert(built.ok, 'adapter refused to build: ' + built.reason);
  return built.adapter.lookup;
}

function preallocate(store, key, correlationId) {
  const p = R.buildPreallocation({
    submissionKey: key, nowIso: NOW, correlationId: correlationId || 'fmr_' + key.slice(4, 10),
    provenanceTrusted: true
  });
  assert(p.ok, 'preallocation failed: ' + p.reason);
  store.preallocate(p.record);
  return p.record;
}

function applyClaim(store, key) {
  const c = R.buildClaim({ submissionKey: key, nowIso: NOW, provenanceTrusted: true });
  assert(c.ok, 'claim build failed: ' + c.reason);
  return R.assertExactlyOneUpdated(store.conditionalUpdate(c.spec));
}

function applyCommit(store, key, leadId, mode) {
  const c = R.buildCommit({
    submissionKey: key, canonicalLeadId: leadId, leadMode: mode || 'new',
    leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW, provenanceTrusted: true
  });
  assert(c.ok, 'commit build failed: ' + c.reason);
  return R.assertExactlyOneUpdated(store.conditionalUpdate(c.spec));
}

const KEY_1 = R.mintSubmissionKey();
const KEY_2 = R.mintSubmissionKey();

// ---------------------------------------------------------------- key model

console.log('\nSUBMISSION KEY — MODEL B, OPAQUE AND IDENTITY-FREE');

check('the key is opaque, random, and carries no Telegram identity', () => {
  assert(R.isValidSubmissionKey(KEY_1), 'a minted key failed its own validator');
  assert(/^sub_[0-9a-f]{32}$/.test(KEY_1), 'the key shape drifted');
  eq(R.SUBMISSION_KEY_MODEL.derived_from_identity, false, 'the key is declared identity-derived');
  eq(R.SUBMISSION_KEY_MODEL.entropy_bits, 128, 'the entropy declaration drifted');
  assert(KEY_1.indexOf(CHAT) === -1, 'the key embeds the telegram id');
  ['telegram_user_id', 'chat_id', 'cycle_id', 'idempotency_key', 'request_id', 'init_data']
    .forEach((f) => eq(R.RECEIPT_FIELDS.indexOf(f), -1, 'the schema carries ' + f));
});

check('(7) 10,000 minted keys collide zero times, and the model is stated honestly', () => {
  const seen = new Set();
  for (let i = 0; i < 10000; i++) {
    const k = R.mintSubmissionKey();
    assert(R.isValidSubmissionKey(k), 'a minted key was malformed at i=' + i);
    assert(!seen.has(k), 'collision at i=' + i);
    seen.add(k);
  }
  eq(seen.size, 10000, 'the generator produced duplicates');
  assert(/probabilistic/i.test(R.SUBMISSION_KEY_MODEL.collision_model),
    'the collision model claims a mathematical guarantee');
});

check('(7,14,15) the caller can neither select nor supply the key', () => {
  ['fmr_abc123', LEAD_A, 'C-' + CHAT + '-1756171200000', 'miniapp:' + CHAT + ':C-1',
    'sub_' + 'g'.repeat(32), 'SUB_' + '0'.repeat(32), KEY_1 + ' ', ' ' + KEY_1, KEY_1.toUpperCase()
  ].forEach((bad) => eq(R.isValidSubmissionKey(bad), false, 'accepted ' + JSON.stringify(bad)));
  ['idempotency_key', 'request_id', 'cycle_id', 'lead_id', 'telegram_user_id']
    .forEach((k) => assert(C.UNTRUSTED_BODY_KEYS.indexOf(k) !== -1, k + ' is no longer untrusted'));
  eq(C.REQUEST_ID_SEMANTICS.is_deduplication_key, false, 'request_id was declared a dedup key');
});

// ---------------------------------------------------------------- issuance ordering

console.log('\nPREALLOCATION ORDERING');

function issueCycle(store, authority, opts) {
  const o = opts || {};
  const key = R.mintSubmissionKey();
  const p = R.buildPreallocation({ submissionKey: key, nowIso: NOW, provenanceTrusted: true });
  if (!p.ok) { return { ok: false, reason: p.reason, key: key, authorityAdvanced: false }; }
  const created = o.receiptCreateFails ? { ok: false } : store.preallocate(p.record);
  if (!created || created.ok !== true) {
    return { ok: false, reason: 'RECEIPT_CREATE_FAILED', key: key, authorityAdvanced: false };
  }
  if (o.authorityWriteFails) {
    return { ok: false, reason: 'AUTHORITY_WRITE_FAILED', key: key, authorityAdvanced: false };
  }
  authority.submission_key = key;
  authority.cycle_id = o.cycleId || ('C-' + CHAT + '-' + (o.stamp || 1756171200000));
  return { ok: true, key: key, authorityAdvanced: true };
}

check('(1) the receipt exists before the cycle becomes authoritative', () => {
  const store = makeReceiptStore();
  const authority = {};
  const out = issueCycle(store, authority);
  assert(out.ok, 'issuance failed');
  eq(store.rows.length, 1, 'no receipt was preallocated');
  eq(store.rows[0].submission_key, authority.submission_key, 'authority names a different key');
  eq(store.rows[0].commit_state, 'READY', 'the receipt was not preallocated READY');
  assert(/mint/i.test(R.ISSUANCE_ORDER[0]), 'issuance order step 1 drifted');
  assert(/READY/.test(R.ISSUANCE_ORDER[1]), 'issuance order step 2 drifted');
  assert(/CONFIRM/i.test(R.ISSUANCE_ORDER[2]), 'the confirm step was removed');
  assert(/authority|Bot_Sessions/i.test(R.ISSUANCE_ORDER[3]), 'issuance order step 4 drifted');
});

check('(2) a receipt-create failure prevents the cycle from advancing', () => {
  const store = makeReceiptStore();
  const authority = { submission_key: 'sub_' + 'a'.repeat(32), cycle_id: 'C-OLD' };
  const before = JSON.stringify(authority);
  const out = issueCycle(store, authority, { receiptCreateFails: true });
  eq(out.ok, false, 'issuance succeeded without a receipt');
  eq(out.authorityAdvanced, false, 'authority advanced without a receipt');
  eq(JSON.stringify(authority), before, 'the authority row was mutated');
  eq(store.rows.length, 0, 'a receipt was created despite the failure');
  assert(R.PREALLOCATION_INVARIANT.if_receipt_create_fails.indexOf('MUST NOT advance') !== -1,
    'the invariant no longer forbids advancing');
});

check('(3) an authority-write failure leaves only a harmless orphan', () => {
  const store = makeReceiptStore();
  const authority = { submission_key: 'sub_' + 'a'.repeat(32), cycle_id: 'C-OLD' };
  const out = issueCycle(store, authority, { authorityWriteFails: true });
  eq(out.ok, false, 'issuance reported success');
  eq(store.rows.length, 1, 'the orphan receipt is missing');
  eq(store.rows[0].commit_state, 'READY', 'the orphan is not READY');
  assert(authority.submission_key !== out.key, 'the orphan became authoritative');
});

check('(19) an orphan receipt cannot make itself authoritative', () => {
  const store = makeReceiptStore();
  const authority = { submission_key: KEY_1, cycle_id: 'C-CURRENT' };
  preallocate(store, KEY_1);
  preallocate(store, KEY_2);
  eq(lookupVia(store)(authority.submission_key).known, false, 'the current receipt was not READY');
  assert(R.PREALLOCATION_INVARIANT.orphan_receipt_is_never_authority.indexOf('Bot_Sessions') !== -1,
    'the invariant stopped naming Bot_Sessions as the decider');
  eq(R.PREALLOCATION_INVARIANT.data_table_does_not_arbitrate, true,
    'the Data Table was made the arbiter of the winning cycle');
});

// ---------------------------------------------------------------- concurrent issuance

console.log('\nCONCURRENT ISSUANCE — SINGLE WRITER IS NOT ASSUMED');

check('(4) two concurrent issuers receive different submission keys', () => {
  const store = makeReceiptStore();
  const a = {}; const b = {};
  const outA = issueCycle(store, a, { stamp: 1756171200000 });
  const outB = issueCycle(store, b, { stamp: 1756171200000 });
  assert(outA.ok && outB.ok, 'an issuance failed');
  eq(a.cycle_id, b.cycle_id, 'the fixture no longer models a same-millisecond collision');
  assert(outA.key !== outB.key, 'two issuers in one millisecond shared a submission key');
  eq(store.rows.length, 2, 'the two issuers did not each get a receipt');
});

check('(5,13) the authority winner accepts only its own receipt', () => {
  const store = makeReceiptStore();
  const a = {}; const b = {};
  const outA = issueCycle(store, a, { stamp: 1756171200000 });
  const outB = issueCycle(store, b, { stamp: 1756171200000 });
  const authority = { submission_key: outB.key, cycle_id: b.cycle_id };
  const lookup = lookupVia(store);
  eq(lookup(authority.submission_key).known, false, 'the winner could not use its own receipt');
  assert(outA.key !== authority.submission_key, 'the loser key equals the winner key');
  eq(applyClaim(store, outA.key).ok, true, 'the orphan could not be claimed in isolation');
  eq(lookup(authority.submission_key).known, false, 'claiming the orphan moved the winner receipt');
});

// ---------------------------------------------------------------- conditional update

console.log('\nCONDITIONAL UPDATE IS THE LOAD-BEARING PRIMITIVE');

check('(6) READY permits exactly one handoff claim', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  const first = applyClaim(store, KEY_1);
  eq(first.ok, true, 'the first claim failed');
  eq(first.reason, 'EXACTLY_ONE_ROW', 'the first claim reason drifted');
  eq(store.rows[0].commit_state, 'IN_FLIGHT', 'the state did not move');
  eq(store.rows[0].claimed_at, NOW, 'the claim was not stamped');
});

check('(7) two attempts to claim READY — only one gets updated_rows = 1', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  const a = applyClaim(store, KEY_1);
  const b = applyClaim(store, KEY_1);
  eq(a.ok, true, 'the winner did not win');
  eq(b.ok, false, 'BOTH attempts claimed the handoff');
  eq(b.reason, 'STATE_ALREADY_MOVED', 'the loser reason drifted');
  eq(store.rows.length, 1, 'a second row appeared');
});

check('(8) IN_FLIGHT never authorises a second handoff', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  applyClaim(store, KEY_1);
  eq(lookupVia(store)(KEY_1).ok, false, 'IN_FLIGHT produced a definite answer');
  eq(R.classifyRows(store.rows, KEY_1).reason, 'IN_FLIGHT_UNRESOLVED', 'the reason drifted');
  eq(applyClaim(store, KEY_1).ok, false, 'IN_FLIGHT was claimable again');
});

check('(20) every update outcome except exactly-one fails closed', () => {
  eq(R.assertExactlyOneUpdated({ ok: true, updated_rows: 1 }).ok, true, 'one row was rejected');
  [[{ ok: true, updated_rows: 0 }, 'STATE_ALREADY_MOVED'],
    [{ ok: true, updated_rows: 2 }, 'MULTIPLE_ROWS_AFFECTED'],
    [{ ok: false, updated_rows: 1 }, 'UPDATE_FAILED'],
    [{ ok: true }, 'UPDATED_ROWS_UNREADABLE'],
    [{ ok: true, updated_rows: '1' }, 'UPDATED_ROWS_UNREADABLE'],
    [null, 'UPDATE_RESULT_UNREADABLE'],
    ['ok', 'UPDATE_RESULT_UNREADABLE']
  ].forEach(([result, reason]) => {
    const v = R.assertExactlyOneUpdated(result);
    eq(v.ok, false, JSON.stringify(result) + ' was accepted');
    eq(v.reason, reason, 'wrong reason for ' + JSON.stringify(result));
  });
});

check('(20) a node "succeeding" is not evidence that one row changed', () => {
  const v = R.assertExactlyOneUpdated({ ok: true, updated_rows: 0 });
  eq(v.ok, false, 'ok:true with zero rows was treated as success');
});

check('every state change is a conditional spec, never an unconditional write', () => {
  const claim = R.buildClaim({ submissionKey: KEY_1, nowIso: NOW, provenanceTrusted: true });
  eq(claim.spec.where.commit_state, 'READY', 'the claim does not match on the expected state');
  eq(claim.spec.expect_updated_rows, 1, 'the claim does not require exactly one row');
  const commit = R.buildCommit({ submissionKey: KEY_1, canonicalLeadId: LEAD_A, nowIso: NOW, provenanceTrusted: true });
  eq(commit.spec.where.commit_state, 'IN_FLIGHT', 'the commit does not match on IN_FLIGHT');
  eq(commit.spec.where.submission_key, KEY_1, 'the commit does not match on the key');
  eq(commit.spec.expect_updated_rows, 1, 'the commit does not require exactly one row');
});

// ---------------------------------------------------------------- retry matrix

console.log('\nRETRY MATRIX');

check('(A) died before the receipt transition — READY permits one handoff', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, true, 'READY could not answer');
  eq(out.known, false, 'READY did not release the stale claim');
});

check('(B) died after IN_FLIGHT — CANNOT_ANSWER, zero new Pipeline calls', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  applyClaim(store, KEY_1);
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'an in-flight handoff produced a definite answer');
  assert(out.known !== false, 'an in-flight handoff released the claim');
});

check('(C,9) committed then response lost — canonical lead replayed', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  applyClaim(store, KEY_1);
  eq(applyCommit(store, KEY_1, LEAD_A, 'merged').ok, true, 'the commit failed');
  const out = lookupVia(store)(KEY_1);
  eq(out.known, true, 'the committed lead was not recovered');
  eq(out.body.lead_id, LEAD_A, 'the wrong lead was recovered');
  eq(out.body.mode, 'merged', 'the classification was lost');
  eq(store.rows[0].settled_at, NOW, 'the settlement was not stamped');
});

check('(D,10,11,18) an ABSENT receipt is CANNOT_ANSWER — never known:false', () => {
  // THE central semantic change. Under the old design this was "nothing was created, go
  // ahead". It is now a broken preallocation invariant, and the only safe answer is silence.
  const store = makeReceiptStore();
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'absence produced a definite answer');
  eq(out.known, undefined, 'absence carried a known flag');
  assert(out.known !== false, 'ABSENCE MAPPED TO known:false — the duplicate-lead path is back');
  eq(R.classifyRows([], KEY_1).reason, R.REASONS.ABSENT, 'absence is not reported as a broken invariant');
  assert(/INVARIANT/i.test(R.REASONS.ABSENT), 'the absent reason no longer names the invariant');
  eq(R.VERDICT.ABSENT, undefined, 'an ABSENT verdict is back in the vocabulary');
});

check('(E) a superseded cycle names a different key and cannot reach the winner receipt', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  applyClaim(store, KEY_1);
  applyCommit(store, KEY_1, LEAD_A);
  const supersededKey = R.mintSubmissionKey();
  assert(supersededKey !== KEY_1, 'the fixture reused the key');
  eq(lookupVia(store)(supersededKey).ok, false, 'a superseded key resolved against the winner receipt');
});

check('(F,12) ABORTED closes the key and requires a new cycle', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  const ab = R.buildAbort({ submissionKey: KEY_1, fromState: 'READY', nowIso: NOW, abortReason: 'PROVEN_NO_PIPELINE_COMMIT' });
  assert(ab.ok, 'the abort spec failed: ' + ab.reason);
  eq(R.assertExactlyOneUpdated(store.conditionalUpdate(ab.spec)).ok, true, 'the abort did not apply');
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'an aborted key produced a definite answer');
  assert(out.known !== false, 'an aborted key released the claim');
  eq(R.classifyRows(store.rows, KEY_1).reason, R.REASONS.ABORTED, 'the abort reason drifted');
  eq(R.REASONS.ABORTED, 'ABORTED_REQUIRES_NEW_CYCLE', 'the named operator action drifted');
  assert(!R.canTransition('ABORTED', 'IN_FLIGHT'), 'an aborted receipt can be reclaimed');
  assert(!R.canTransition('ABORTED', 'COMMITTED'), 'an aborted receipt can be promoted');
  assert(!R.canTransition('COMMITTED', 'ABORTED'), 'a committed receipt can be aborted');
});

check('an abort refuses a bogus reason and a bogus source state', () => {
  ['', 'looked stuck', 'CORRELATION_LOOKUP_FAILED', 'NOT_FOUND_IN_PIPELINE'].forEach((bad) => {
    eq(R.buildAbort({ submissionKey: KEY_1, fromState: 'READY', nowIso: NOW, abortReason: bad }).ok,
      false, 'accepted abort reason ' + JSON.stringify(bad));
  });
  eq(R.buildAbort({ submissionKey: KEY_1, fromState: 'COMMITTED', nowIso: NOW, abortReason: 'PROVEN_NO_PIPELINE_COMMIT' }).reason,
    'ABORT_REQUIRES_READY_OR_IN_FLIGHT', 'a committed receipt was abortable');
});

// ---------------------------------------------------------------- trust boundary

console.log('\nTRUST BOUNDARY — UNCHANGED BY AN OPAQUE KEY');

check('(16,17) the public route cannot create, claim or commit a receipt', () => {
  const out = R.buildPreallocation({ submissionKey: KEY_1, nowIso: NOW });
  eq(out.ok, false, 'a public-path execution preallocated a receipt');
  eq(out.reason, 'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', 'the refusal reason drifted');
  ['true', 1, {}, [], { __internal_route: true }, 'yes'].forEach((v) => {
    eq(R.buildPreallocation({ submissionKey: KEY_1, nowIso: NOW, provenanceTrusted: v }).ok, false,
      'a body-shaped provenance value was accepted: ' + JSON.stringify(v));
    eq(R.buildClaim({ submissionKey: KEY_1, nowIso: NOW, provenanceTrusted: v }).ok, false,
      'a body-shaped provenance value claimed a handoff: ' + JSON.stringify(v));
    eq(R.buildCommit({ submissionKey: KEY_1, canonicalLeadId: LEAD_A, nowIso: NOW, provenanceTrusted: v }).ok,
      false, 'a body-shaped provenance value committed a lead: ' + JSON.stringify(v));
  });
  eq(R.RECEIPT_AUTHORITY.marker_in_body_is_not_provenance, true, 'the body-marker rule was removed');
  eq(R.RECEIPT_AUTHORITY.unguessable_key_is_not_a_substitute_for_route_auth, true,
    'route auth was weakened because the key became random');
});

check('a request_id can never become a receipt key', () => {
  ['fmr_abc123', C.newCorrelationId()].forEach((rid) => {
    eq(R.isValidSubmissionKey(rid), false, 'a correlation/request id passed as a submission key: ' + rid);
    eq(lookupVia(makeReceiptStore())(rid).ok, false, 'a request id was looked up');
  });
});

// ---------------------------------------------------------------- store fitness

console.log('\nSTORE FITNESS AND CAPABILITIES');

check('activation requires exact-key lookup AND conditional update', () => {
  eq(A.REQUIRED_CAPABILITIES.join(','), 'exact_key_lookup,conditional_update',
    'the required capability set drifted');
  eq(A.REQUIRED_CAPABILITIES.indexOf('atomic_insert_if_absent'), -1,
    'a capability P2 proved absent is required again');
  [['exact_key_lookup', 'NO_EXACT_KEY_LOOKUP'], ['conditional_update', 'NO_CONDITIONAL_UPDATE']]
    .forEach(([cap, reason]) => {
      const opts = {}; opts[cap] = false;
      const built = A.createRecoveryAdapter(makeReceiptStore(opts));
      eq(built.ok, false, 'an adapter was built without ' + cap);
      eq(built.reason, reason, 'the refusal reason drifted for ' + cap);
      eq(built.adapter, null, 'a refused adapter still exposed an object');
      const wired = { submit: () => ({}), lookup: built.adapter && built.adapter.lookup };
      eq(C.recoveryAdapterStatus(wired).available, false, 'the gateway was unblocked without ' + cap);
    });
});

check('read-after-write is demoted to liveness, and says so', () => {
  const store = makeReceiptStore({ read_after_write: false });
  const built = A.createRecoveryAdapter(store);
  eq(built.ok, true, 'read-after-write is still gating activation');
  eq(built.read_after_write_liveness, false, 'the liveness signal was lost');
  assert(/LIVENESS ONLY/.test(A.CAPABILITY_NOTES.read_after_write),
    'read-after-write is not documented as liveness-only');
  assert(/NOT REQUIRED/.test(A.CAPABILITY_NOTES.atomic_insert_if_absent),
    'insert-if-absent is not documented as designed out');
  eq(built.adapter.lookup(KEY_1).ok, false, 'absence answered on a stale-read store');
});

check('the diagnostic probe still cannot unblock the gateway', () => {
  const probe = A.createDiagnosticProbe(makeReceiptStore({ conditional_update: false }));
  assert(probe.ok, 'the probe refused a store it should tolerate');
  eq(probe.activation_capable, false, 'a store without conditional update was called activation capable');
  eq(probe.lookup, undefined, 'the probe exposes a lookup');
  eq(typeof probe.probe, 'function', 'the probe exposes no probe method');
  eq(C.recoveryAdapterStatus(probe).available, false, 'a diagnostic probe unblocked the gateway');
  eq(C.recoveryAdapterStatus(Object.assign({ submit: () => ({}) }, probe)).available, false,
    'a probe spread into a leadIntake object unblocked the gateway');
});

check('a broken exact-key contract, an empty-with-error read and a throw all fail closed', () => {
  const wrong = makeReceiptStore();
  wrong.readByKey = () => ({ ok: true, rows: [{ submission_key: KEY_2, commit_state: 'READY' }] });
  eq(lookupVia(wrong)(KEY_1).ok, false, 'a wrong-key row was filtered into an answer');
  eq(R.classifyRows([{ submission_key: KEY_2, commit_state: 'READY' }], KEY_1).reason,
    'LOOKUP_CONTRACT_VIOLATION', 'the violation was not named');
  const sloppy = makeReceiptStore({ sloppy: true });
  preallocate(sloppy, KEY_1); preallocate(sloppy, KEY_2);
  eq(lookupVia(sloppy)(KEY_1).ok, false, 'an over-returning store produced an answer');
  eq(lookupVia(makeReceiptStore({ failEmpty: true }))(KEY_1).ok, false,
    'a failed read with empty rows was treated as an answer');
  const boom = makeReceiptStore();
  boom.readByKey = () => { throw new Error('data table reset for ' + CHAT); };
  const out = lookupVia(boom)(KEY_1);
  eq(out.ok, false, 'a throwing store produced an answer');
  assert(JSON.stringify(out).indexOf(CHAT) === -1, 'the thrown message leaked');
  const dup = makeReceiptStore();
  preallocate(dup, KEY_1); dup.rows.push(Object.assign({}, dup.rows[0]));
  eq(R.classifyRows(dup.rows, KEY_1).reason, 'DUPLICATE_RECEIPTS', 'duplicates were resolved to a winner');
});

// ---------------------------------------------------------------- privacy and retention

console.log('\nPRIVACY AND RETENTION');

check('no key, identity or lead id reaches a log line, on any branch', () => {
  const branches = [];
  const probe = (st) => { const seen = []; const b = A.createRecoveryAdapter(st, { onLog: (v) => seen.push(v) }); b.adapter.lookup(KEY_1); return seen; };
  const committed = makeReceiptStore();
  preallocate(committed, KEY_1); applyClaim(committed, KEY_1); applyCommit(committed, KEY_1, LEAD_A);
  branches.push(probe(committed));
  const ready = makeReceiptStore(); preallocate(ready, KEY_1); branches.push(probe(ready));
  branches.push(probe(makeReceiptStore()));
  branches.push(probe(makeReceiptStore({ unavailable: true })));
  branches.forEach((b) => {
    const t = JSON.stringify(b);
    assert(t.indexOf(KEY_1) === -1, 'a log branch leaked the submission key: ' + t);
    assert(t.indexOf(LEAD_A) === -1, 'a log branch leaked the lead id: ' + t);
    assert(t.indexOf(CHAT) === -1, 'a log branch leaked an identity: ' + t);
    assert(!/digest|hash/i.test(t), 'a log branch carries a derived key field');
  });
  eq(Object.keys(R.receiptLogView({ commitState: 'READY' })).join(','),
    'commit_state,has_lead_id,verdict,reason,correlation_id', 'the log view shape drifted');
});

check('retention cannot delete a receipt a current authority still names', () => {
  eq(R.mayDeleteReceipt({ commitState: 'COMMITTED', namedByCurrentAuthority: true, retentionPeriodElapsed: true }).reason,
    'STILL_NAMED_BY_CURRENT_AUTHORITY', 'a live receipt was deletable');
  eq(R.mayDeleteReceipt({ commitState: 'READY', namedByCurrentAuthority: false, retentionPeriodElapsed: true }).reason,
    'RECEIPT_NOT_TERMINAL_AND_NOT_ORPHAN', 'a READY receipt was deletable without orphan proof');
  eq(R.mayDeleteReceipt({ commitState: 'READY', provenOrphan: true, namedByCurrentAuthority: false, retentionPeriodElapsed: true }).ok,
    true, 'a proven orphan could not be cleaned up');
  eq(R.mayDeleteReceipt({ commitState: 'COMMITTED', namedByCurrentAuthority: false, retentionPeriodElapsed: false }).reason,
    'RETENTION_PERIOD_NOT_ELAPSED', 'the retention period was ignored');
  assert(/OWNER INPUT/.test(R.RECEIPT_LIFECYCLE_INVARIANT.retention_duration), 'a duration was invented');
  eq(R.RECEIPT_LIFECYCLE_INVARIANT.deletion_cannot_authorise_a_submit, true,
    'deletion can authorise a submit again');
});

// ---------------------------------------------------------------- documents

console.log('\nDOCUMENT INTEGRITY');

function tableScan(rel) {
  const doc = readFileSync(join(HERE, '..', rel), 'utf8').split('\r\n').join('\n').split('\n');
  const cells = (line) => {
    const out = []; let cur = '';
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && line[i + 1] === '|') { cur += '|'; i++; continue; }
      if (line[i] === '|') { out.push(cur); cur = ''; continue; }
      cur += line[i];
    }
    out.push(cur); return out;
  };
  let tables = 0; const bad = []; let fenced = false;
  for (let i = 0; i < doc.length; i++) {
    if (/^```/.test(doc[i])) { fenced = !fenced; continue; }
    if (fenced) { continue; }
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(doc[i])) { continue; }
    tables++;
    const width = cells(doc[i]).length;
    for (let j = i - 1; j < doc.length; j++) {
      if (j < 0) { continue; }
      if (!/^\s*\|/.test(doc[j])) { if (j > i) { break; } continue; }
      if (cells(doc[j]).length !== width) { bad.push(rel + ' line ' + (j + 1) + ': ' + cells(doc[j]).length + ' cells, expected ' + width); }
    }
  }
  return { tables, bad };
}

check('the G1 plan and both canary documents have well-formed tables', () => {
  ['docs/PHASE_B2_1C_G1_DURABLE_RECOVERY_PLAN.md',
    'docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md',
    'docs/PHASE_B2_1C_G1_P3_PREALLOCATION_DECISION.md'
  ].forEach((rel) => {
    const r = tableScan(rel);
    assert(r.tables >= 2, rel + ' lost its tables: only ' + r.tables + ' found');
    eq(r.bad.length, 0, 'malformed table rows: ' + r.bad.join('; '));
  });
});

console.log('\nRECORD AND TRANSITION DETAIL');

check('a preallocated record has exactly the declared shape', () => {
  const rec = R.buildPreallocation({ submissionKey: KEY_1, nowIso: NOW, correlationId: 'fmr_x', provenanceTrusted: true }).record;
  eq(Object.keys(rec).sort().join(','), R.RECEIPT_FIELDS.slice().sort().join(','), 'the record shape drifted from the schema');
  eq(rec.commit_state, 'READY', 'a preallocation did not start READY');
  eq(rec.canonical_lead_id, '', 'a preallocation claimed a lead');
  eq(rec.claimed_at, '', 'a preallocation was pre-claimed');
  eq(rec.settled_at, '', 'a preallocation was pre-settled');
  eq(rec.created_at, NOW, 'the creation time was not stamped');
});

check('a correlation id derived from the key is refused at source', () => {
  const bad = R.buildPreallocation({ submissionKey: KEY_1, nowIso: NOW, correlationId: 'CID-' + KEY_1, provenanceTrusted: true });
  eq(bad.ok, false, 'a correlation id containing the key was accepted');
  eq(bad.reason, 'CORRELATION_ID_DERIVED_FROM_KEY', 'the refusal reason drifted');
  eq(R.buildPreallocation({ submissionKey: KEY_1, nowIso: '', provenanceTrusted: true }).reason, 'CLOCK_MISSING', 'a clockless preallocation was built');
});

check('a commit requires a prior claim — IN_FLIGHT is the only source state', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  // Commit without claiming first: the conditional update matches nothing.
  const out = applyCommit(store, KEY_1, LEAD_A);
  eq(out.ok, false, 'a READY receipt was committed without being claimed');
  eq(out.reason, 'STATE_ALREADY_MOVED', 'the refusal reason drifted');
  eq(store.rows[0].commit_state, 'READY', 'the state moved anyway');
  eq(store.rows[0].canonical_lead_id, '', 'a lead was bound without a claim');
});

check('a commit with no canonical lead id is refused', () => {
  eq(R.buildCommit({ submissionKey: KEY_1, canonicalLeadId: '', nowIso: NOW, provenanceTrusted: true }).reason,
    'LEAD_ID_MISSING', 'a commit without a lead id was built');
  eq(R.buildCommit({ submissionKey: KEY_1, canonicalLeadId: LEAD_A, nowIso: '', provenanceTrusted: true }).reason,
    'CLOCK_MISSING', 'a clockless commit was built');
});

check('an IN_FLIGHT receipt can be aborted by an operator', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  applyClaim(store, KEY_1);
  const ab = R.buildAbort({ submissionKey: KEY_1, fromState: 'IN_FLIGHT', nowIso: NOW, abortReason: 'PROVEN_NO_PIPELINE_COMMIT' });
  assert(ab.ok, 'an in-flight abort spec failed');
  eq(R.assertExactlyOneUpdated(store.conditionalUpdate(ab.spec)).ok, true, 'the in-flight abort did not apply');
  eq(store.rows[0].commit_state, 'ABORTED', 'the state did not move to ABORTED');
});

check('the state vocabulary and transition map are complete and closed', () => {
  eq(R.RECEIPT_STATES.join(','), 'READY,IN_FLIGHT,COMMITTED,ABORTED', 'the state vocabulary drifted');
  eq(R.TRANSITIONS.READY.join(','), 'IN_FLIGHT,ABORTED', 'READY transitions drifted');
  eq(R.TRANSITIONS.IN_FLIGHT.join(','), 'COMMITTED,ABORTED', 'IN_FLIGHT transitions drifted');
  eq(R.TRANSITIONS.COMMITTED.length, 0, 'COMMITTED is no longer terminal');
  eq(R.TRANSITIONS.ABORTED.length, 0, 'ABORTED is no longer terminal');
  ['PENDING', 'DRAFT', 'SUBMITTED', ''].forEach((bogus) => {
    eq(R.canTransition('READY', bogus), false, 'READY can transition to ' + JSON.stringify(bogus));
    eq(R.canTransition(bogus, 'COMMITTED'), false, JSON.stringify(bogus) + ' can transition to COMMITTED');
  });
});

check('the key generator uses a CSPRNG, not a predictable source', () => {
  // Two mints must differ, and the alphabet must be full hex rather than a narrow range.
  const keys = []; for (let i = 0; i < 64; i++) { keys.push(R.mintSubmissionKey()); }
  eq(new Set(keys).size, 64, 'the generator repeats');
  const chars = new Set(keys.join('').replace(/sub_/g, '').split(''));
  assert(chars.size >= 14, 'the key alphabet is suspiciously narrow: ' + chars.size + ' distinct hex chars');
  eq(R.SUBMISSION_KEY_BYTES, 16, 'the key length changed without review');
});

console.log('\nEXACT-KEY CONTRACT — EACH VIOLATION SEPARATELY');

const VIOLATIONS = [
  ['padded stored key', [{ submission_key: KEY_1 + ' ', commit_state: 'READY' }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['leading-space stored key', [{ submission_key: ' ' + KEY_1, commit_state: 'READY' }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['a different key entirely', [{ submission_key: KEY_2, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['mixed correct and wrong key', [{ submission_key: KEY_1, commit_state: 'READY' }, { submission_key: KEY_2, commit_state: 'READY' }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['row missing the key', [{ commit_state: 'READY' }], 'RECEIPT_KEY_MISSING'],
  ['row with an empty key', [{ submission_key: '', commit_state: 'READY' }], 'RECEIPT_KEY_MISSING'],
  ['row with a non-string key', [{ submission_key: 12345, commit_state: 'READY' }], 'RECEIPT_KEY_MISSING'],
  ['a null row', [null], 'LOOKUP_CONTRACT_VIOLATION'],
  ['an array masquerading as a row', [[KEY_1]], 'LOOKUP_CONTRACT_VIOLATION']
];

VIOLATIONS.forEach(([label, rows, reason]) => {
  check('contract violation fails closed: ' + label, () => {
    const v = R.classifyRows(rows, KEY_1);
    eq(v.verdict, R.VERDICT.CANNOT_ANSWER, label + ' did not fail closed');
    eq(v.reason, reason, label + ' reported the wrong reason');
    // And through the adapter, it must never release a claim.
    const store = makeReceiptStore();
    store.readByKey = () => ({ ok: true, rows: rows });
    const out = lookupVia(store)(KEY_1);
    eq(out.ok, false, label + ' produced a definite answer');
    assert(out.known !== false, label + ' released the claim');
  });
});

check('a COMMITTED receipt with no lead id is not a success', () => {
  const v = R.classifyRows([{ submission_key: KEY_1, commit_state: 'COMMITTED', canonical_lead_id: '' }], KEY_1);
  eq(v.verdict, R.VERDICT.CANNOT_ANSWER, 'committed-without-lead was treated as a success');
  eq(v.reason, 'COMMITTED_WITHOUT_LEAD', 'the reason drifted');
});

check('an unknown state is not silently treated as one of the known ones', () => {
  ['WEIRD', 'pending', 'ready', ''].forEach((st) => {
    const v = R.classifyRows([{ submission_key: KEY_1, commit_state: st, canonical_lead_id: LEAD_A }], KEY_1);
    eq(v.verdict, R.VERDICT.CANNOT_ANSWER, 'state ' + JSON.stringify(st) + ' produced an answer');
  });
  eq(R.classifyRows('rows', KEY_1).reason, 'ROWS_UNREADABLE', 'a string of rows was not fail-closed');
  eq(R.classifyRows(null, KEY_1).reason, 'ROWS_UNREADABLE', 'null rows were not fail-closed');
});

console.log('\nEND TO END THROUGH THE REAL SUBMIT HANDLER');

const SESSION_ID = 'AS-0123456789abcdef0123';
const CYCLE = 'C-' + CHAT + '-1756171200000';

function makeSessions(initial) {
  const row = Object.assign({
    app_session_id: SESSION_ID, telegram_user_id: CHAT, chat_id: CHAT, cycle_id: CYCLE,
    submit_state: 'draft', lead_id: '', expires_at: '2026-08-26T03:00:00.000Z'
  }, initial || {});
  return {
    row,
    read(id) { return id === row.app_session_id ? { ok: true, session: Object.assign({}, row) } : { ok: false, session: null }; },
    claim(id, spec) {
      if (row.submit_state !== spec.from) { return { ok: true, updated_rows: 0 }; }
      row.submit_state = spec.to; Object.assign(row, spec.patch || {});
      return { ok: true, updated_rows: 1 };
    },
    update(id, patch) { Object.assign(row, patch); return { ok: true }; }
  };
}

function makeAuthority(submissionKey) {
  const row = {
    chat_id: CHAT, cycle_id: CYCLE, consent: '', consent_cycle_id: '', consent_at: '',
    lead_id: '', lead_cycle_id: '',
    submission_key: submissionKey === undefined ? KEY_1 : submissionKey
  };
  return { row, read() { return { ok: true, row: Object.assign({}, row) }; },
    write(c, patch) { Object.assign(row, patch); return { ok: true }; } };
}

const GOOD_ANSWERS = {
  sector: 'retail', turnover: 'lt100k', cash: 'unclear', profit: 'partial',
  treasury: 'unclear', kpi: 'partial', pain: 'reporting', urgency: 'none'
};

function submitWith(leadIntake, sessions, authority) {
  return H.handleSubmit({
    headers: { 'content-type': 'application/json' },
    body: {
      app_session_id: SESSION_ID, client_version: 'b2.1.0', consent: 'yes',
      answers: Object.assign({}, GOOD_ANSWERS),
      contact: { name: 'Ion', company: 'ACME SRL', direct: '+37360123456' }
    },
    sessions, authority, leadIntake, clock: { now: () => NOW }, locale: 'ru'
  });
}

check('the adapter satisfies RECOVERY_ADAPTER_CONTRACT and unblocks the gateway', () => {
  const built = A.createRecoveryAdapter(makeReceiptStore());
  const leadIntake = { submit: () => ({ ok: false, ambiguous: true }), lookup: built.adapter.lookup };
  eq(C.recoveryAdapterStatus(leadIntake).available, true, 'a real adapter did not unblock the gateway');
});

check('E2E — READY permits exactly one Lead Intake call, keyed from authority', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  const built = A.createRecoveryAdapter(store);
  const sessions = makeSessions({ submit_state: 'submitting' });
  let calls = 0; const asked = [];
  const intake = {
    submit: () => { calls++; return { ok: true, body: { ok: true, lead_id: LEAD_A, mode: 'new', priority: 'WARM', financial_zone: 'YELLOW' } }; },
    lookup: (k) => { asked.push(k); return built.adapter.lookup(k); }
  };
  const out = submitWith(intake, sessions, makeAuthority(KEY_1));
  eq(out.ok, true, 'a READY receipt did not permit the submit');
  eq(calls, 1, 'expected exactly one Intake call, got ' + calls);
  eq(asked[0], KEY_1, 'the lookup did not use the authoritative submission key');
});

check('E2E — IN_FLIGHT makes zero Lead Intake calls and keeps the claim', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1); applyClaim(store, KEY_1);
  const built = A.createRecoveryAdapter(store);
  const sessions = makeSessions({ submit_state: 'submitting' });
  let calls = 0;
  const out = submitWith({ submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
    sessions, makeAuthority(KEY_1));
  eq(calls, 0, 'an in-flight handoff produced a SECOND Lead Intake call');
  eq(out.response.error_code, 'SUBMIT_UNRESOLVED', 'in-flight was not reported as unresolved');
  eq(sessions.row.submit_state, 'submitting', 'the claim was released while in flight');
});

check('E2E — COMMITTED replays the canonical lead with zero Intake calls', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1); applyClaim(store, KEY_1); applyCommit(store, KEY_1, LEAD_A, 'merged');
  const built = A.createRecoveryAdapter(store);
  const sessions = makeSessions({ submit_state: 'submitting' });
  let calls = 0;
  const out = submitWith({ submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
    sessions, makeAuthority(KEY_1));
  eq(calls, 0, 'a committed receipt produced another Intake call');
  eq(out.ok, true, 'the committed lead was not replayed');
  eq(out.response.lead_id, LEAD_A, 'the wrong lead was replayed');
  eq(out.log.resolved_from, 'lookup', 'the replay did not resolve via the ledger');
});

check('E2E — a missing receipt for a current cycle makes zero Intake calls', () => {
  const store = makeReceiptStore();       // preallocation invariant broken
  const built = A.createRecoveryAdapter(store);
  const sessions = makeSessions({ submit_state: 'submitting' });
  let calls = 0;
  const out = submitWith({ submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
    sessions, makeAuthority(KEY_1));
  eq(calls, 0, 'a broken preallocation invariant reached Lead Intake');
  eq(out.ok, false, 'a broken invariant produced a success');
  eq(sessions.row.submit_state, 'submitting', 'the claim was released on a broken invariant');
});

check('E2E — a current cycle with no submission_key at all fails closed', () => {
  const built = A.createRecoveryAdapter(makeReceiptStore());
  const sessions = makeSessions({ submit_state: 'submitting' });
  let calls = 0;
  const out = submitWith({ submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
    sessions, makeAuthority(''));
  eq(calls, 0, 'a cycle with no submission key reached Lead Intake');
  eq(out.response.error_code, 'PRE_ACTIVATION_BLOCKED', 'the missing key was not reported as blocked');
  eq(out.log.stage, 'SUBMISSION_KEY_MISSING_ON_AUTHORITY', 'the stage was not named');
});

console.log('\nDECLARED CONTRACTS AND REMAINING EDGES');

check('the submission key model is declared with its trust properties', () => {
  const m = R.SUBMISSION_KEY_MODEL;
  eq(m.browser_may_supply, false, 'the browser was declared able to supply the key');
  eq(m.crosses_tb1, false, 'the key was declared as crossing TB-1');
  eq(m.guessable, false, 'the key was declared guessable');
  eq(m.format, 'sub_<32 lowercase hex>', 'the declared format drifted');
  assert(/Concierge|issuer/i.test(m.minted_by), 'the minter is no longer named');
  assert(/Bot_Sessions/.test(m.persisted_in), 'the key is no longer declared as living on authority');
});

check('the issuance order and preallocation invariant are declared in full', () => {
  eq(R.ISSUANCE_ORDER.length, 5, 'an issuance step was dropped');
  const inv = R.PREALLOCATION_INVARIANT;
  assert(/never exists without/i.test(inv.rule), 'the invariant rule was softened');
  assert(inv.if_authority_write_fails.length > 20, 'the authority-failure case was thinned');
  assert(/each issuer mints its OWN/i.test(inv.concurrent_issuance), 'the concurrency answer was removed');
  assert(/last-write-wins/i.test(inv.concurrent_issuance), 'the invariant no longer names how the winner is picked');
});

check('a conditional update spec always matches on key AND state', () => {
  const spec = R.updateSpec(KEY_1, 'READY', 'IN_FLIGHT', { claimed_at: NOW });
  eq(spec.where.submission_key, KEY_1, 'the spec does not match on the key');
  eq(spec.where.commit_state, 'READY', 'the spec does not match on the expected state');
  eq(spec.set.commit_state, 'IN_FLIGHT', 'the spec does not set the target state');
  eq(spec.set.claimed_at, NOW, 'the spec dropped its patch');
  eq(spec.expect_updated_rows, 1, 'the spec does not require exactly one row');
});

check('a trusted route is still refused a malformed key', () => {
  // Provenance is not a licence for any string.
  ['fmr_abc', LEAD_A, KEY_1 + ' ', '', 'sub_short', 'miniapp:1:C'].forEach((bad) => {
    eq(R.resolveReceiptKey({ submissionKey: bad, provenanceTrusted: true }).allowed, false,
      'a trusted route selected a malformed key: ' + JSON.stringify(bad));
    eq(R.resolveReceiptKey({ submissionKey: bad, provenanceTrusted: true }).reason,
      'SUBMISSION_KEY_INVALID', 'the refusal reason drifted');
  });
  eq(R.resolveReceiptKey({ submissionKey: KEY_1, provenanceTrusted: true }).key, KEY_1,
    'a valid key was altered in transit');
});

check('a store that is missing, unreadable or throws its capabilities is refused', () => {
  [null, undefined, {}, { readByKey: 'nope' }].forEach((bad) => {
    const built = A.createRecoveryAdapter(bad);
    eq(built.ok, false, 'an adapter was built on ' + JSON.stringify(bad));
    eq(built.adapter, null, 'a refused adapter still exposed an object');
  });
  eq(A.createRecoveryAdapter({ readByKey: () => ({}), capabilities: () => null }).reason,
    'CAPABILITIES_UNREADABLE', 'null capabilities were accepted');
  eq(A.createRecoveryAdapter({ readByKey: () => ({}), capabilities: () => { throw new Error('x'); } }).reason,
    'CAPABILITIES_UNREADABLE', 'throwing capabilities were accepted');
  eq(A.createRecoveryAdapter({ readByKey: () => ({}) }).reason,
    'CAPABILITIES_UNREADABLE', 'a store with no capabilities() was not refused');
});

check('a throwing logger can never change a verdict', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1); applyClaim(store, KEY_1); applyCommit(store, KEY_1, LEAD_A);
  const built = A.createRecoveryAdapter(store, { onLog: () => { throw new Error('log sink down'); } });
  eq(built.adapter.lookup(KEY_1).body.lead_id, LEAD_A, 'a broken log sink changed the answer');
});

check('the capability caveat still refuses to claim durability', () => {
  assert(/durab/i.test(A.CAPABILITY_CAVEAT), 'the durability caveat was removed');
  assert(/live canaries/i.test(A.CAPABILITY_CAVEAT), 'the caveat no longer points at the live canaries');
  assert(/conditional update/i.test(A.CAPABILITY_CAVEAT), 'the caveat no longer flags the new primitive');
});

check('mayDeleteReceipt refuses an unknown state outright', () => {
  ['', 'WEIRD', 'PENDING'].forEach((st) => {
    eq(R.mayDeleteReceipt({ commitState: st, namedByCurrentAuthority: false, retentionPeriodElapsed: true }).ok,
      false, 'state ' + JSON.stringify(st) + ' was deletable');
  });
});

check('E2E — consent NO never touches the ledger or Lead Intake', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  const built = A.createRecoveryAdapter(store);
  const sessions = makeSessions();
  let calls = 0;
  const out = H.handleSubmit({
    headers: { 'content-type': 'application/json' },
    body: {
      app_session_id: SESSION_ID, client_version: 'b2.1.0', consent: 'no',
      answers: Object.assign({}, GOOD_ANSWERS),
      contact: { name: 'Ion', company: 'ACME SRL', direct: '+37360123456' }
    },
    sessions, authority: makeAuthority(KEY_1),
    leadIntake: { submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
    clock: { now: () => NOW }, locale: 'ru'
  });
  eq(out.ok, true, 'consent NO was treated as an error');
  eq(calls, 0, 'consent NO called Lead Intake');
  eq(store.rows[0].commit_state, 'READY', 'consent NO moved the receipt state');
});

check('E2E — an orphan receipt in the store does not satisfy the current cycle', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_2);              // an orphan from a losing issuance
  const built = A.createRecoveryAdapter(store);
  const sessions = makeSessions({ submit_state: 'submitting' });
  let calls = 0;
  const out = submitWith({ submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
    sessions, makeAuthority(KEY_1));     // authority names KEY_1, which has no receipt
  eq(calls, 0, 'an orphan receipt authorised a submit for a different key');
  eq(out.ok, false, 'a broken invariant produced a success');
});

check('E2E — a claimed receipt cannot be claimed twice through the handler path', () => {
  const store = makeReceiptStore();
  preallocate(store, KEY_1);
  eq(applyClaim(store, KEY_1).ok, true, 'the first claim failed');
  const built = A.createRecoveryAdapter(store);
  let calls = 0;
  // Two separate retries both see IN_FLIGHT; neither may hand off.
  [1, 2].forEach(() => {
    const out = submitWith({ submit: () => { calls++; return { ok: true, body: {} }; }, lookup: built.adapter.lookup },
      makeSessions({ submit_state: 'submitting' }), makeAuthority(KEY_1));
    eq(out.response.error_code, 'SUBMIT_UNRESOLVED', 'an in-flight retry was not unresolved');
  });
  eq(calls, 0, 'an in-flight receipt permitted ' + calls + ' Lead Intake call(s)');
});

check('the P2 evidence document is retained and still records the failure', () => {
  // P3 replaced the architecture; it must not quietly delete the evidence that forced it.
  const doc = readFileSync(join(HERE, '..', 'docs', 'PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md'), 'utf8');
  assert(/P1-L2/.test(doc), 'the P2 document no longer names P1-L2');
  assert(/FAIL/.test(doc), 'the P2 document no longer records a failure');
  assert(/insert-if-absent/i.test(doc), 'the P2 document no longer names the missing primitive');
});

// ---------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
