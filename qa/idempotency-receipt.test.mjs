#!/usr/bin/env node
// FINMENTOR — G1 durable submission receipt + recovery adapter gate.
//
//   node qa/idempotency-receipt.test.mjs
//
// Proves the DECISION LOGIC of the receipt ledger and the recovery adapter with no tenant,
// no credential and no network.
//
// WHAT THE IN-MEMORY STORE BELOW IS, AND IS NOT.
//
// `makeReceiptStore()` is a DOUBLE. It models the injected store contract so the logic above
// it can be exercised deterministically. It proves nothing whatsoever about the live n8n
// Data Table: not durability across a redeploy, not atomic insert-if-absent under genuine
// concurrency, and not read-after-write. Those are live properties, they are the reason G1
// remains OPEN, and they are canary items in
// docs/PHASE_B2_1C_G1_DURABLE_RECOVERY_PLAN.md. A green run here means the logic is right,
// not that the capability exists.

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

const CHAT = '551662084';
const CYCLE_1 = 'C-2026-08-26-01';
const CYCLE_2 = 'C-2026-08-26-02';
const KEY_1 = 'miniapp:' + CHAT + ':' + CYCLE_1;
const KEY_2 = 'miniapp:' + CHAT + ':' + CYCLE_2;
const NOW = '2026-08-26T02:00:00.000Z';
const LEAD_A = 'FIN-1756171200-042';
const LEAD_B = 'FIN-1756171200-999';

// The store DOUBLE. See the header: this is not the live store.
function makeReceiptStore(opts) {
  const o = opts || {};
  return {
    rows: [],
    unavailable: o.unavailable === true,
    sloppy: o.sloppy === true,
    failEmpty: o.failEmpty === true,
    caps: {
      exact_key_lookup: o.exact_key_lookup !== false,
      atomic_insert_if_absent: o.atomic_insert_if_absent !== false,
      read_after_write: o.read_after_write !== false
    },
    capabilities() { return this.caps; },
    readByKey(key) {
      // A store that reports failure but still hands back an EMPTY array. The dangerous
      // shape: an adapter that only inspected rows would read it as 'nothing was created'.
      if (this.failEmpty) { return { ok: false, rows: [] }; }
      if (this.unavailable) { return { ok: false, rows: null }; }
      // A mis-filtered client that over-returns. The ledger must not rely on the store's
      // filter being correct — it re-checks key equality itself.
      if (this.sloppy) { return { ok: true, rows: this.rows.slice() }; }
      // Exact equality, modelling a keyed lookup rather than a scan.
      return { ok: true, rows: this.rows.filter((r) => r.idempotency_key === key) };
    },
    // Models atomic insert-if-absent. `atomic_insert_if_absent: false` models a store that
    // cannot enforce it, so a race really does leave two rows behind.
    insertIfAbsent(record) {
      if (this.unavailable) { return { ok: false }; }
      const existing = this.rows.filter((r) => r.idempotency_key === record.idempotency_key);
      if (existing.length && this.caps.atomic_insert_if_absent) {
        return { ok: true, inserted: false };
      }
      this.rows.push(Object.assign({}, record));
      return { ok: true, inserted: true };
    },
    applyCommit(key, patch) {
      const row = this.rows.find((r) => r.idempotency_key === key);
      if (!row) { return { ok: false }; }
      Object.assign(row, patch);
      return { ok: true };
    }
  };
}

function lookupVia(store) {
  const built = A.createRecoveryAdapter(store);
  assert(built.ok, 'adapter refused to build: ' + built.reason);
  return built.adapter.lookup;
}

// Write intent then commit, the way Lead Intake must.
function seedCommitted(store, key, leadId, mode) {
  const intent = R.buildIntent({ idempotencyKey: key, nowIso: NOW, correlationId: 'CID-' + key });
  assert(intent.ok, 'intent build failed: ' + intent.reason);
  store.insertIfAbsent(intent.record);
  const commit = R.buildCommit({
    idempotencyKey: key, canonicalLeadId: leadId, leadMode: mode || 'new',
    leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW
  });
  assert(commit.ok, 'commit build failed: ' + commit.reason);
  store.applyCommit(key, commit.patch);
}

function seedPending(store, key) {
  const intent = R.buildIntent({ idempotencyKey: key, nowIso: NOW, correlationId: 'CID-P' });
  store.insertIfAbsent(intent.record);
}

// ---------------------------------------------------------------- key and schema

console.log('\nSTABLE KEY AND SCHEMA');

check('(12) each cycle mints a distinct key, and the key is what the handler mints', () => {
  eq(C.idempotencyKey(CHAT, CYCLE_1), KEY_1, 'gateway key shape drifted from the ledger key shape');
  eq(C.idempotencyKey(CHAT, CYCLE_2), KEY_2, 'second cycle key shape drifted');
  assert(KEY_1 !== KEY_2, 'two cycles produced the same key');
  assert(R.isValidKey(KEY_1) && R.isValidKey(KEY_2), 'the handler mints a key the ledger rejects');
});

check('the ledger refuses any key that is not the exact server shape', () => {
  ['', 'miniapp:', 'miniapp::' + CYCLE_1, 'miniapp:abc:' + CYCLE_1, CHAT + ':' + CYCLE_1,
    'MINIAPP:' + CHAT + ':' + CYCLE_1, 'miniapp:' + CHAT + ':' + CYCLE_1 + ' ',
    'xminiapp:' + CHAT + ':' + CYCLE_1, 'miniapp:' + CHAT + ':' + 'x'.repeat(65)
  ].forEach((bad) => {
    assert(!R.isValidKey(bad), 'accepted a malformed key: ' + JSON.stringify(bad));
  });
  // A trailing-space variant must not be silently trimmed into validity by the adapter.
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  eq(lookupVia(store)(KEY_1 + ' ').ok, false, 'a padded key was normalised into a hit');
});

check('writer and reader agree on what a key IS — neither repairs a padded one', () => {
  // If a writer trimmed and the reader did not, a receipt would exist under a key the
  // reader never looks up in that form. Both must refuse identically.
  const padded = KEY_1 + ' ';
  eq(R.isValidKey(padded), false, 'the reader accepted a padded key');
  eq(R.buildIntent({ idempotencyKey: padded, nowIso: NOW }).ok, false, 'the intent writer repaired a padded key');
  eq(R.buildCommit({ idempotencyKey: padded, canonicalLeadId: LEAD_A, nowIso: NOW }).ok, false,
    'the commit writer repaired a padded key');
  eq(R.parseKey(padded).ok, false, 'the parser accepted a padded key');
});

check('the schema is minimal and carries no PII beyond the key, and no secret material', () => {
  eq(R.RECEIPT_FIELDS.length, 11, 'the receipt schema changed size');
  ['telegram_user_id', 'chat_id', 'cycle_id', 'request_id', 'init_data', 'hash', 'signature',
    'contact', 'name', 'company', 'direct', 'email', 'phone', 'free_text', 'answers'
  ].forEach((f) => {
    eq(R.RECEIPT_FIELDS.indexOf(f), -1, 'the receipt schema carries ' + f);
  });
  // The identity is derivable from the key, which is why it is not stored twice.
  const parts = R.parseKey(KEY_1);
  eq(parts.telegram_user_id, CHAT, 'identity not derivable from the key');
  eq(parts.cycle_id, CYCLE_1, 'cycle not derivable from the key');
});

check('COMMITTED is terminal and PENDING is the only way in', () => {
  assert(R.canTransition('PENDING', 'COMMITTED'), 'the only legal transition is refused');
  assert(!R.canTransition('COMMITTED', 'PENDING'), 'a committed receipt can be reopened');
  assert(!R.canTransition('COMMITTED', 'COMMITTED'), 'committed re-entry is a transition');
  assert(!R.canTransition('PENDING', 'PENDING'), 'pending re-entry is a transition');
  eq(R.UNIQUENESS_RULE.unique_on, 'idempotency_key', 'the uniqueness rule drifted');
  assert(R.ABSENCE_PROOF_PRECONDITIONS.length >= 4, 'the absence preconditions were thinned');
});

// ---------------------------------------------------------------- recovery answers

console.log('\nRECOVERY ANSWERS');

check('(1,2,5) a committed receipt recovers the canonical lead across a retry', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A, 'new');
  const lookup = lookupVia(store);
  const first = lookup(KEY_1);
  eq(first.ok, true, 'lookup could not answer');
  eq(first.known, true, 'a committed lead was reported as absent');
  eq(first.body.lead_id, LEAD_A, 'the wrong lead was recovered');
  // (1) the same stable key answers identically on every later attempt.
  const second = lookup(KEY_1);
  eq(second.body.lead_id, LEAD_A, 'the key stopped resolving on a second retry');
  eq(JSON.stringify(first), JSON.stringify(second), 'two retries got different answers');
});

check('(6) a receipt still PENDING is ambiguous, never a negative answer', () => {
  // The Pipeline write may or may not have landed. This is the residual window, and the
  // only safe answer is "I cannot tell you".
  const store = makeReceiptStore();
  seedPending(store, KEY_1);
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'a PENDING receipt produced a definite answer');
  assert(out.known === undefined, 'a cannot-answer carried a known flag');
});

check('(6) absence is a provable negative ONLY under the stated preconditions', () => {
  const store = makeReceiptStore();
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, true, 'a provable absence could not answer');
  eq(out.known, false, 'absence was not reported as not-committed');
});

check('(7) a store that cannot answer yields CANNOT_ANSWER, never a fresh submit', () => {
  const store = makeReceiptStore({ unavailable: true });
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'an unavailable store produced a definite answer');
  assert(out.known !== false, 'an unavailable store was read as proof nothing was created');
});

check('without read-after-write, absence degrades to CANNOT_ANSWER', () => {
  // Since F2, a store missing read-after-write cannot back an ACTIVATION adapter at all, so
  // the inference itself is exercised through the diagnostic probe — same resolver, and the
  // conservative answer must survive there too.
  const store = makeReceiptStore({ read_after_write: false });
  eq(A.createRecoveryAdapter(store).ok, false, 'an activation adapter was built without read-after-write');
  const probe = A.createDiagnosticProbe(store);
  assert(probe.ok, 'the diagnostic probe refused a store it should tolerate');
  eq(probe.activation_capable, false, 'a partial store was called activation capable');
  eq(probe.probe(KEY_1).ok, false, 'absence was treated as proof without read-after-write');
});

check('(8) every malformed receipt shape fails closed', () => {
  const shapes = [
    ['committed with no lead id', { idempotency_key: KEY_1, commit_state: 'COMMITTED', canonical_lead_id: '' }],
    ['unknown state', { idempotency_key: KEY_1, commit_state: 'WEIRD', canonical_lead_id: LEAD_A }],
    ['empty state', { idempotency_key: KEY_1, commit_state: '', canonical_lead_id: LEAD_A }],
    ['no state field at all', { idempotency_key: KEY_1, canonical_lead_id: LEAD_A }]
  ];
  shapes.forEach(([label, row]) => {
    const store = makeReceiptStore();
    store.rows.push(row);
    const out = lookupVia(store)(KEY_1);
    eq(out.ok, false, label + ' produced a definite answer');
  });
  // Unreadable rows are not an absence either.
  eq(R.classifyRows(null, KEY_1).verdict, R.VERDICT.CANNOT_ANSWER, 'null rows were not fail-closed');
  eq(R.classifyRows('rows', KEY_1).verdict, R.VERDICT.CANNOT_ANSWER, 'a string of rows was not fail-closed');
});

// ---------------------------------------------------------------- uniqueness and conflict

console.log('\nUNIQUENESS, CONCURRENCY AND CONFLICT');

check('(4) two concurrent creates for one key leave exactly one receipt', () => {
  const store = makeReceiptStore();
  const a = R.buildIntent({ idempotencyKey: KEY_1, nowIso: NOW, correlationId: 'CID-A' });
  const b = R.buildIntent({ idempotencyKey: KEY_1, nowIso: NOW, correlationId: 'CID-B' });
  const first = store.insertIfAbsent(a.record);
  const second = store.insertIfAbsent(b.record);
  eq(first.inserted, true, 'the first create did not win');
  eq(second.inserted, false, 'the second create also inserted — uniqueness not enforced');
  eq(store.rows.length, 1, 'two receipts exist for one key');
  eq(store.rows[0].correlation_id, 'CID-A', 'the loser overwrote the winner');
});

check('(4) where the store cannot enforce uniqueness, duplicates fail closed', () => {
  // Defence in depth: the adapter must not pick a winner when the store let two rows exist.
  const store = makeReceiptStore({ atomic_insert_if_absent: false });
  seedCommitted(store, KEY_1, LEAD_A);
  store.rows.push({ idempotency_key: KEY_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A });
  eq(store.rows.length, 2, 'the fixture no longer produces duplicates');
  // Such a store can no longer back an activation adapter (F2); the probe exercises the
  // duplicate handling itself.
  eq(A.createRecoveryAdapter(store).reason, 'NO_ATOMIC_INSERT_IF_ABSENT',
    'a store that cannot enforce uniqueness still built an activation adapter');
  const out = A.createDiagnosticProbe(store).probe(KEY_1);
  eq(out.ok, false, 'duplicate receipts resolved to a winner instead of failing closed');
  eq(R.classifyRows(store.rows, KEY_1).reason, 'DUPLICATE_RECEIPTS', 'duplicates were not named');
});

check('(3) one receipt can never point at two lead ids', () => {
  const committed = { idempotency_key: KEY_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A };
  const conflict = R.planCommit(committed, LEAD_B);
  eq(conflict.ok, false, 'a second lead id was allowed onto a committed receipt');
  eq(conflict.reason, 'CONFLICTING_LEAD_ID', 'the conflict was not named');
  // A repeat of the SAME commit is a safe idempotent retry of phase two, not a conflict.
  const repeat = R.planCommit(committed, LEAD_A);
  eq(repeat.ok, true, 'an identical repeat commit was refused');
  eq(repeat.action, 'ALREADY_COMMITTED_SAME', 'an identical repeat was not recognised');
});

check('(3) a commit with no lead id, or onto no intent row, is refused', () => {
  eq(R.buildCommit({ idempotencyKey: KEY_1, canonicalLeadId: '', nowIso: NOW }).ok, false,
    'a commit without a lead id was built');
  eq(R.planCommit(null, LEAD_A).reason, 'NO_INTENT_ROW', 'a commit onto nothing was allowed');
  eq(R.planCommit({ commit_state: 'PENDING', canonical_lead_id: LEAD_B }, LEAD_A).ok, false,
    'a pending row already naming another lead accepted a different one');
  eq(R.buildIntent({ idempotencyKey: 'not-a-key', nowIso: NOW }).ok, false, 'intent built on a bad key');
  eq(R.buildIntent({ idempotencyKey: KEY_1, nowIso: '' }).ok, false, 'intent built with no clock');
});

// ---------------------------------------------------------------- caller cannot steer

console.log('\nTHE CALLER CANNOT STEER A RECOVERY');

check('(9) a caller request_id cannot select a receipt', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  const lookup = lookupVia(store);
  ['fmr_abc123', 'CID-' + KEY_1, '00000000-0000-4000-8000-000000000000'].forEach((rid) => {
    eq(lookup(rid).ok, false, 'a request_id selected a receipt: ' + rid);
  });
  // And the declared semantics still say it must never be one.
  eq(C.REQUEST_ID_SEMANTICS.is_deduplication_key, false, 'request_id was declared a dedup key');
});

check('(10) a caller lead_id cannot satisfy a receipt', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  const lookup = lookupVia(store);
  [LEAD_A, LEAD_B, 'miniapp:' + LEAD_A].forEach((v) => {
    eq(lookup(v).ok, false, 'a lead id was accepted as a lookup key: ' + v);
  });
  // The body validator drops a caller lead_id before any of this is reached.
  assert(C.UNTRUSTED_BODY_KEYS.indexOf('lead_id') !== -1, 'lead_id is no longer untrusted');
  assert(C.UNTRUSTED_BODY_KEYS.indexOf('idempotency_key') !== -1, 'idempotency_key is no longer untrusted');
});

check('a foreign identity cannot reach another user receipt', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  const other = 'miniapp:' + '900000001' + ':' + CYCLE_1;
  eq(lookupVia(store)(other).ok, true, 'a foreign key could not be answered at all');
  eq(lookupVia(store)(other).known, false, 'a foreign key resolved to somebody else lead');
});

// ---------------------------------------------------------------- cycles and merges

console.log('\nCYCLES AND MERGED LEADS');

check('(11) an old-cycle receipt cannot satisfy a new cycle', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  const out = lookupVia(store)(KEY_2);
  assert(!(out.ok === true && out.known === true), 'cycle 1 receipt answered for cycle 2');
});

check('(14) a later cycle does not overwrite the earlier receipt', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A, 'new');
  seedCommitted(store, KEY_2, LEAD_B, 'new');
  eq(store.rows.length, 2, 'the second cycle replaced the first receipt');
  const lookup = lookupVia(store);
  eq(lookup(KEY_1).body.lead_id, LEAD_A, 'the earlier cycle evidence was destroyed');
  eq(lookup(KEY_2).body.lead_id, LEAD_B, 'the later cycle resolved wrongly');
});

check('(13) a merged lead keeps its own receipt evidence', () => {
  // Two cycles that merge into ONE canonical lead. Both receipts survive and both resolve;
  // the ledger is keyed by submission, not by lead, which is what makes this safe.
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A, 'new');
  seedCommitted(store, KEY_2, LEAD_A, 'merged');
  const lookup = lookupVia(store);
  eq(lookup(KEY_1).body.lead_id, LEAD_A, 'the first submission lost its receipt');
  eq(lookup(KEY_2).body.lead_id, LEAD_A, 'the merged submission lost its receipt');
  eq(lookup(KEY_1).body.mode, 'new', 'the first submission mode was rewritten by the merge');
  eq(lookup(KEY_2).body.mode, 'merged', 'the merge was not recorded as merged');
  eq(store.rows.length, 2, 'a merge collapsed two receipts into one');
});

// ---------------------------------------------------------------- logging

console.log('\nLOGGING');

check('(15) the receipt log view exposes no identity and no raw key', () => {
  const view = R.receiptLogView({
    idempotencyKey: KEY_1, commitState: 'COMMITTED', canonicalLeadId: LEAD_A,
    verdict: 'COMMITTED', reason: 'RECEIPT_COMMITTED', correlationId: 'CID-1'
  });
  const s = JSON.stringify(view);
  assert(s.indexOf(CHAT) === -1, 'the telegram id reached the log');
  assert(s.indexOf(KEY_1) === -1, 'the raw key reached the log');
  assert(s.indexOf(CYCLE_1) === -1, 'the cycle id reached the log');
  assert(s.indexOf(LEAD_A) === -1, 'the canonical lead id reached the log');
  eq(view.has_lead_id, true, 'the log lost the fact that a lead exists');
  eq(view.key_digest.length, 16, 'the key digest shape drifted');
  // The digest must still correlate two entries about the same submission.
  eq(R.keyDigest(KEY_1), view.key_digest, 'the digest is not stable');
  assert(R.keyDigest(KEY_1) !== R.keyDigest(KEY_2), 'two keys share a digest');
});

check('(15) an adapter log line carries no identity either', () => {
  const seen = [];
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  const built = A.createRecoveryAdapter(store, { onLog: (v) => seen.push(v) });
  built.adapter.lookup(KEY_1);
  assert(seen.length > 0, 'the adapter logged nothing at all');
  const s = JSON.stringify(seen);
  assert(s.indexOf(CHAT) === -1, 'the adapter log leaked the telegram id');
  assert(s.indexOf(KEY_1) === -1, 'the adapter log leaked the raw key');
  assert(s.indexOf(LEAD_A) === -1, 'the adapter log leaked the canonical lead id');
});

check('a throwing logger can never change a verdict', () => {
  const store = makeReceiptStore();
  seedCommitted(store, KEY_1, LEAD_A);
  const built = A.createRecoveryAdapter(store, { onLog: () => { throw new Error('log sink down'); } });
  eq(built.adapter.lookup(KEY_1).body.lead_id, LEAD_A, 'a broken log sink changed the answer');
});

// ---------------------------------------------------------------- store fitness

console.log('\nSTORE FITNESS AND THE ACTIVATION BLOCKER');

check('(16) no store means no adapter, and the gateway stays PRE_ACTIVATION_BLOCKED', () => {
  [null, undefined, {}, { readByKey: 'nope' }].forEach((bad) => {
    const built = A.createRecoveryAdapter(bad);
    eq(built.ok, false, 'an adapter was built on ' + JSON.stringify(bad));
    eq(built.adapter, null, 'a refused adapter still exposed an object');
  });
  // And the gateway's own blocker still reads that as blocked.
  const status = C.recoveryAdapterStatus({ submit: () => ({}) });
  eq(status.available, false, 'the gateway stopped treating a missing adapter as blocking');
});

check('a store without exact-key lookup is refused outright', () => {
  const built = A.createRecoveryAdapter(makeReceiptStore({ exact_key_lookup: false }));
  eq(built.ok, false, 'a scan-only store was accepted');
  eq(built.reason, 'NO_EXACT_KEY_LOOKUP', 'the refusal reason drifted');
  eq(built.adapter, null, 'a scan-only store produced a usable adapter');
});

check('unreadable or throwing capabilities are refused, not assumed', () => {
  eq(A.createRecoveryAdapter({ readByKey: () => ({}), capabilities: () => null }).ok, false,
    'null capabilities were accepted');
  eq(A.createRecoveryAdapter({ readByKey: () => ({}), capabilities: () => { throw new Error('x'); } }).ok, false,
    'throwing capabilities were accepted');
  eq(A.createRecoveryAdapter({ readByKey: () => ({}) }).reason, 'CAPABILITIES_UNREADABLE',
    'a store with no capabilities() was not refused');
});

check('a store whose read throws is CANNOT_ANSWER, not a crash', () => {
  const store = makeReceiptStore();
  store.readByKey = () => { throw new Error('data table connection reset for ' + CHAT); };
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'a throwing store produced a definite answer');
  assert(JSON.stringify(out).indexOf(CHAT) === -1, 'the thrown message leaked into the answer');
});

// ---------------------------------------------------------------- end to end

console.log('\nEND TO END THROUGH THE REAL SUBMIT HANDLER');

const SESSION_ID = 'AS-0123456789abcdef0123';

function makeSessions(initial) {
  const row = Object.assign({
    app_session_id: SESSION_ID, telegram_user_id: CHAT, chat_id: CHAT, cycle_id: CYCLE_1,
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

function makeAuthority(initial) {
  const row = Object.assign({
    chat_id: CHAT, cycle_id: CYCLE_1, consent: '', consent_cycle_id: '', consent_at: '',
    lead_id: '', lead_cycle_id: ''
  }, initial || {});
  return {
    row,
    read() { return { ok: true, row: Object.assign({}, row) }; },
    write(chatId, patch) { Object.assign(row, patch); return { ok: true }; }
  };
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
    sessions, authority, leadIntake,
    clock: { now: () => NOW }, locale: 'ru'
  });
}

check('the adapter satisfies the declared RECOVERY_ADAPTER_CONTRACT and unblocks the gateway', () => {
  const store = makeReceiptStore();
  const built = A.createRecoveryAdapter(store);
  const leadIntake = { submit: () => ({ ok: false, ambiguous: true }), lookup: built.adapter.lookup };
  eq(C.recoveryAdapterStatus(leadIntake).available, true, 'a real adapter did not unblock the gateway');
  eq(C.RECOVERY_ADAPTER_CONTRACT.key_shape, 'miniapp:<telegram_user_id>:<cycle_id>',
    'the declared key shape drifted from the ledger');
});

check('(5) an ambiguous timeout after the canonical commit recovers the lead on retry', () => {
  const store = makeReceiptStore();
  const sessions = makeSessions();
  const authority = makeAuthority();
  const built = A.createRecoveryAdapter(store);

  // Attempt 1: Lead Intake commits canonically and writes the receipt, then the connection
  // dies before the response is delivered. The gateway sees only an ambiguous outcome.
  const intake1 = {
    submit: () => { seedCommitted(store, KEY_1, LEAD_A, 'new'); return { ok: false, ambiguous: true }; },
    lookup: built.adapter.lookup
  };
  const first = submitWith(intake1, sessions, authority);
  eq(first.response.error_code, 'SUBMIT_UNRESOLVED', 'the ambiguous outcome was not preserved');
  eq(sessions.row.submit_state, 'submitting', 'the claim was released on an ambiguous outcome');

  // Attempt 2: the retry resolves through the ledger. Exactly one Intake call, ever.
  let calls = 0;
  const intake2 = { submit: () => { calls++; return { ok: false, ambiguous: true }; }, lookup: built.adapter.lookup };
  const second = submitWith(intake2, sessions, authority);
  eq(second.ok, true, 'the retry did not resolve');
  eq(second.response.lead_id, LEAD_A, 'the retry did not recover the canonical lead');
  eq(calls, 0, 'the retry made a SECOND Lead Intake call — this is the duplicate G1 exists to prevent');
  eq(second.log.resolved_from, 'lookup', 'the retry did not resolve via the ledger');
  eq(store.rows.length, 1, 'the retry created a second receipt');
});

check('(6) a timeout BEFORE the canonical commit is safe and permits exactly one fresh attempt', () => {
  const store = makeReceiptStore();
  const sessions = makeSessions({ submit_state: 'submitting' });
  const authority = makeAuthority();
  const built = A.createRecoveryAdapter(store);
  // Nothing was written: no receipt, so absence is provable and a fresh attempt is legal.
  let calls = 0;
  const intake = {
    submit: () => { calls++; return { ok: true, body: { ok: true, lead_id: LEAD_B, mode: 'new', priority: 'WARM', financial_zone: 'YELLOW' } }; },
    lookup: built.adapter.lookup
  };
  const out = submitWith(intake, sessions, authority);
  eq(out.ok, true, 'a provably uncommitted attempt was not allowed to retry');
  eq(calls, 1, 'exactly one fresh Intake call was expected, got ' + calls);
  eq(out.response.lead_id, LEAD_B, 'the fresh attempt did not return its lead');
});

check('(7) an unavailable ledger never converts ambiguity into a fresh submit', () => {
  const store = makeReceiptStore({ unavailable: true });
  const sessions = makeSessions({ submit_state: 'submitting' });
  const authority = makeAuthority();
  const built = A.createRecoveryAdapter(store);
  let calls = 0;
  const intake = { submit: () => { calls++; return { ok: true, body: { ok: true, lead_id: LEAD_B } }; }, lookup: built.adapter.lookup };
  const out = submitWith(intake, sessions, authority);
  eq(out.ok, false, 'an unreadable ledger produced a success');
  eq(out.response.error_code, 'SUBMIT_UNRESOLVED', 'an unreadable ledger was not reported as unresolved');
  eq(calls, 0, 'an unreadable ledger permitted a fresh Lead Intake call');
  eq(sessions.row.submit_state, 'submitting', 'the claim was released while the outcome was unknown');
});

check('the ledger re-checks key equality itself and does not trust the store filter', () => {
  // Defence in depth. If the store client over-returns — a mis-filtered query, a shared
  // read, a future client bug — a prefix or substring match here would let one cycle's
  // receipt answer for another. classifyRows is given foreign rows DIRECTLY so its own
  // exact-match logic is exercised rather than masked by a correct store filter.
  const rows = [
    { idempotency_key: KEY_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A },
    { idempotency_key: 'miniapp:900000001:' + CYCLE_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_B }
  ];
  // F1: a foreign row is a CONTRACT VIOLATION, not an absence. The old behaviour filtered
  // it away and answered ABSENT, which with read-after-write became NOT_COMMITTED — the
  // gateway would release the claim on the word of a store that had just proved it cannot
  // answer by key.
  eq(R.classifyRows(rows, KEY_2).verdict, R.VERDICT.CANNOT_ANSWER, 'a foreign row was filtered into an absence');
  eq(R.classifyRows(rows, KEY_2).reason, 'LOOKUP_CONTRACT_VIOLATION', 'the violation was not named');
  eq(R.classifyRows([rows[0]], KEY_1).lead_id, LEAD_A, 'the matching row was not selected');
  const sloppy = makeReceiptStore({ sloppy: true });
  seedCommitted(sloppy, KEY_1, LEAD_A);
  const out = lookupVia(sloppy)(KEY_2);
  eq(out.ok, false, 'an over-returning store produced a definite answer for cycle 2');
});

check('classifyRows refuses an invalid key on its own, not only via the adapter', () => {
  // The adapter validates the key too. Both layers are asserted separately so removing
  // either one is visible, rather than each hiding the other's absence.
  ['fmr_abc123', LEAD_A, '', 'miniapp:' + CHAT + ':' + CYCLE_1 + ' '].forEach((bad) => {
    eq(R.classifyRows([], bad).verdict, R.VERDICT.CANNOT_ANSWER, 'classifyRows accepted key ' + JSON.stringify(bad));
    eq(R.classifyRows([], bad).reason, 'KEY_INVALID', 'the refusal reason drifted for ' + JSON.stringify(bad));
  });
});

check('(7) a store that FAILS but returns an empty array is not read as an absence', () => {
  // The shape that would silently defeat recovery: ok:false with rows:[]. An adapter that
  // only looked at rows would see 'no receipt' and permit a fresh submit into a lead that
  // may already exist. The adapter must judge the store's verdict before its rows.
  const store = makeReceiptStore({ failEmpty: true });
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'a failed read with empty rows was treated as a provable absence');
  assert(out.known !== false, 'a failed read was read as proof nothing was created');
});

console.log('\nF1  EXACT-KEY LOOKUP FAILS CLOSED');

// Every one of these must be CANNOT_ANSWER and must NEVER be NOT_COMMITTED. A store that
// breaks its own exact-key contract has told us nothing — including nothing about absence.
const F1_CASES = [
  ['padded stored key', [{ idempotency_key: KEY_1 + ' ', commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['leading-space stored key', [{ idempotency_key: ' ' + KEY_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['wrong-cycle key', [{ idempotency_key: KEY_2, commit_state: 'COMMITTED', canonical_lead_id: LEAD_B }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['wrong-user key', [{ idempotency_key: 'miniapp:900000001:' + CYCLE_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_B }], 'LOOKUP_CONTRACT_VIOLATION'],
  ['mixed correct + wrong key', [
    { idempotency_key: KEY_1, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A },
    { idempotency_key: KEY_2, commit_state: 'COMMITTED', canonical_lead_id: LEAD_B }
  ], 'LOOKUP_CONTRACT_VIOLATION'],
  ['row missing the key entirely', [{ commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }], 'RECEIPT_KEY_MISSING'],
  ['row with an empty key', [{ idempotency_key: '', commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }], 'RECEIPT_KEY_MISSING'],
  ['row with a non-string key', [{ idempotency_key: 12345, commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }], 'RECEIPT_KEY_MISSING'],
  ['a null row in the set', [null], 'LOOKUP_CONTRACT_VIOLATION'],
  ['an array masquerading as a row', [[KEY_1]], 'LOOKUP_CONTRACT_VIOLATION']
];

check('(F1) every contract-violating row set is CANNOT_ANSWER, never an absence', () => {
  F1_CASES.forEach(([label, rows, reason]) => {
    const v = R.classifyRows(rows, KEY_1);
    eq(v.verdict, R.VERDICT.CANNOT_ANSWER, label + ' did not fail closed');
    eq(v.reason, reason, label + ' reported the wrong reason');
    assert(v.verdict !== R.VERDICT.ABSENT && v.verdict !== R.VERDICT.NOT_COMMITTED_PROVEN,
      label + ' was treated as proof nothing was created');
  });
});

check('(F1) a violating store never yields NOT_COMMITTED through the adapter', () => {
  F1_CASES.forEach(([label, rows]) => {
    const store = makeReceiptStore();
    store.readByKey = () => ({ ok: true, rows: rows });
    const out = lookupVia(store)(KEY_1);
    eq(out.ok, false, label + ' produced a definite answer through the adapter');
    assert(out.known !== false, label + ' released the claim');
  });
});

check('(F1) over-returning with NO correct row still fails closed', () => {
  // The exact shape the review named: readByKey(K) answers with a row for some other key.
  // Filtering it away would leave zero rows and manufacture an absence.
  const store = makeReceiptStore();
  store.readByKey = () => ({ ok: true, rows: [{ idempotency_key: KEY_2, commit_state: 'PENDING', canonical_lead_id: '' }] });
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, false, 'a wrong-key row was filtered into an absence');
});

check('(F1) a clean empty exact-key result is still a usable absence', () => {
  // The fix must not make every absence unusable — only the ones that were never proven.
  const store = makeReceiptStore();
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, true, 'a clean empty result stopped being answerable');
  eq(out.known, false, 'a clean empty result stopped meaning not-committed');
});

console.log('\nF2  ACTIVATION CAPABILITY GATE');

check('(F2) all three capabilities are required to build an activation adapter', () => {
  eq(A.REQUIRED_CAPABILITIES.join(','), 'exact_key_lookup,atomic_insert_if_absent,read_after_write',
    'the required capability set drifted');
  eq(A.createRecoveryAdapter(makeReceiptStore()).reason, 'READY', 'a fully capable store was refused');
});

check('(F2) each missing capability keeps the gateway PRE_ACTIVATION_BLOCKED', () => {
  [['exact_key_lookup', 'NO_EXACT_KEY_LOOKUP'],
    ['atomic_insert_if_absent', 'NO_ATOMIC_INSERT_IF_ABSENT'],
    ['read_after_write', 'NO_READ_AFTER_WRITE']
  ].forEach(([cap, reason]) => {
    const opts = {}; opts[cap] = false;
    const built = A.createRecoveryAdapter(makeReceiptStore(opts));
    eq(built.ok, false, 'an adapter was built without ' + cap);
    eq(built.reason, reason, 'the refusal reason drifted for ' + cap);
    eq(built.adapter, null, 'a refused adapter still exposed an object');
    // The structural blocker: the gateway must see no callable lookup.
    const wired = { submit: () => ({}), lookup: built.adapter && built.adapter.lookup };
    eq(C.recoveryAdapterStatus(wired).available, false, 'the gateway was unblocked without ' + cap);
    eq(C.recoveryAdapterStatus(wired).reason, 'RECOVERY_ADAPTER_MISSING', 'the blocker reason drifted');
  });
});

check('(F2) the diagnostic probe can never unblock the gateway', () => {
  // The safety property is the NAME. recoveryAdapterStatus unblocks on a callable 'lookup',
  // so a tool that exposes only 'probe' cannot remove the blocker however it is wired.
  const probe = A.createDiagnosticProbe(makeReceiptStore({ read_after_write: false, atomic_insert_if_absent: false }));
  assert(probe.ok, 'the probe refused a store it should tolerate');
  eq(typeof probe.probe, 'function', 'the probe exposes no probe method');
  eq(probe.lookup, undefined, 'the probe exposes a lookup and can unblock the gateway');
  eq(C.recoveryAdapterStatus(probe).available, false, 'a diagnostic probe unblocked the gateway');
  eq(C.recoveryAdapterStatus(Object.assign({ submit: () => ({}) }, probe)).available, false,
    'a probe spread into a leadIntake object unblocked the gateway');
  // A probe still refuses a scan-only store: it must not lie about what it inspected.
  eq(A.createDiagnosticProbe(makeReceiptStore({ exact_key_lookup: false })).ok, false,
    'the probe accepted a scan-only store');
});

check('(F2) a capability flag is never claimed as durability', () => {
  assert(/durab/i.test(A.CAPABILITY_CAVEAT), 'the durability caveat was removed');
  assert(/live/i.test(A.CAPABILITY_CAVEAT), 'the caveat no longer points at the live canaries');
});

console.log('\nF4  OPERATOR RESOLUTION AND THE ABORTED STATE');

check('(F4) only a PENDING receipt may be aborted, and ABORTED is terminal', () => {
  assert(R.canTransition('PENDING', 'ABORTED'), 'a pending receipt cannot be aborted');
  assert(!R.canTransition('COMMITTED', 'ABORTED'), 'a committed receipt can be aborted');
  assert(!R.canTransition('ABORTED', 'COMMITTED'), 'an aborted receipt can be promoted');
  assert(!R.canTransition('ABORTED', 'PENDING'), 'an aborted receipt can be reopened');
  eq(R.planAbort({ commit_state: 'COMMITTED', canonical_lead_id: LEAD_A }).reason,
    'CANNOT_ABORT_A_COMMITTED_RECEIPT', 'aborting a committed receipt was allowed');
  eq(R.planAbort({ commit_state: 'PENDING' }).action, 'ABORT', 'a pending receipt refused an abort');
  eq(R.planAbort({ commit_state: 'ABORTED' }).action, 'ALREADY_ABORTED', 'a repeat abort was not idempotent');
  eq(R.planAbort(null).reason, 'NO_RECEIPT_ROW', 'an abort onto nothing was allowed');
});

check('(F4) an abort carries a constrained reason, never free text', () => {
  eq(R.buildAbort({ idempotencyKey: KEY_1, nowIso: NOW, abortReason: 'PROVEN_NO_PIPELINE_COMMIT' }).ok, true,
    'the only legal abort reason was refused');
  ['', 'looked stuck', 'customer Ion asked', 'PROVEN', 'proven_no_pipeline_commit'].forEach((bad) => {
    eq(R.buildAbort({ idempotencyKey: KEY_1, nowIso: NOW, abortReason: bad }).ok, false,
      'an abort accepted the reason ' + JSON.stringify(bad));
  });
  eq(R.ABORT_REASONS.length, 1, 'the abort vocabulary grew without review');
});

check('(F4) an ABORTED receipt is a POSITIVE not-committed, independent of read-after-write', () => {
  const store = makeReceiptStore();
  seedPending(store, KEY_1);
  const abort = R.buildAbort({ idempotencyKey: KEY_1, nowIso: NOW, abortReason: 'PROVEN_NO_PIPELINE_COMMIT' });
  store.applyCommit(KEY_1, abort.patch);
  eq(R.classifyRows(store.rows, KEY_1).verdict, R.VERDICT.NOT_COMMITTED_PROVEN, 'an abort was not a proven negative');
  const out = lookupVia(store)(KEY_1);
  eq(out.ok, true, 'an aborted receipt could not answer');
  eq(out.known, false, 'an aborted receipt was not reported as not-committed');
  // Positive evidence, so it holds even where an ABSENCE would not.
  const weak = makeReceiptStore({ read_after_write: false });
  weak.rows = store.rows.slice();
  eq(A.createDiagnosticProbe(weak).probe(KEY_1).known, false,
    'a proven abort was downgraded because absence is unprovable here');
});

check('(F4) aborting does not delete the receipt, and the evidence survives', () => {
  const store = makeReceiptStore();
  seedPending(store, KEY_1);
  const abort = R.buildAbort({ idempotencyKey: KEY_1, nowIso: NOW, abortReason: 'PROVEN_NO_PIPELINE_COMMIT' });
  store.applyCommit(KEY_1, abort.patch);
  eq(store.rows.length, 1, 'the abort removed the receipt');
  eq(store.rows[0].commit_state, 'ABORTED', 'the state was not recorded');
  eq(store.rows[0].aborted_at, NOW, 'the abort time was not recorded');
  eq(store.rows[0].abort_reason, 'PROVEN_NO_PIPELINE_COMMIT', 'the abort reason was not recorded');
  eq(store.rows[0].canonical_lead_id, '', 'an aborted receipt claims a lead');
});

check('(F4) the operator correlation chain is exactly correlation_id -> meta.request_id', () => {
  // Verified against the real modules, not assumed. The gateway sets meta.request_id from
  // its server correlation id; Lead Intake reads meta.request_id; build-pipeline-row writes
  // it to Pipeline AZ. So a receipt seeded with the SAME value is findable — while AZ holds.
  const built = C.buildLeadIntakePayload({
    answers: GOOD_ANSWERS, free_text: '', contact: { name: 'Ion', company: 'ACME', direct: '+37360123456' },
    telegramUserId: CHAT, locale: 'ru', clientVersion: 'b2.1.0', correlationId: 'CID-CHAIN-1', nowIso: NOW
  });
  assert(built.ok, 'the envelope did not build');
  eq(built.envelope.payload.meta.request_id, 'CID-CHAIN-1', 'the correlation id no longer reaches meta.request_id');
  // A receipt seeded from the same value correlates to the Pipeline row.
  const intent = R.buildIntent({ idempotencyKey: KEY_1, nowIso: NOW, correlationId: 'CID-CHAIN-1' });
  eq(intent.record.correlation_id, built.envelope.payload.meta.request_id,
    'the receipt correlation id and the Pipeline request_id have diverged');
  // And the ledger key itself is NOT in the envelope, which is why Pipeline cannot be found
  // by the stable key — the P1-L5 gap, asserted rather than described.
  const flat = JSON.stringify(built.envelope);
  assert(flat.indexOf(KEY_1) === -1, 'the stable key now reaches the envelope; P1-L5 must be revisited');
});

// ---------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
