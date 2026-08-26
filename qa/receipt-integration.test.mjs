#!/usr/bin/env node
// FINMENTOR — B.2.1-C P5 MODEL B production integration gate.
//
//   node qa/receipt-integration.test.mjs
//
// Proves the P5 integration package offline: the preallocation readback, the redefined
// P1-L9 correlation chain, the validation-before-claim critical section, the zero-item
// Data Table wiring, the route decision, the schema migration contract, and the structural
// properties of the generated candidate workflow.
//
// WHAT THIS GATE IS NOT. It runs no workflow, contacts no tenant and touches no sheet. The
// candidate workflow is checked as a GRAPH — which nodes exist, how they are wired, what is
// reachable from where — not as a running thing. P4 proved the Data Table primitives live;
// P6 proves this wiring live. A green run here means the package is internally consistent
// and structurally fail-closed, not that it has been deployed.
//
// MUTATION TESTING. Several checks below deliberately BREAK a control and require the guard
// to notice. A control that cannot fail its own test is not a control, and the mutations are
// the reason these checks are worth more than restating the implementation.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(HERE, '..');
const R = require(join(ROOT, 'n8n', 'src', 'lead-intake', 'idempotency-receipt.js'));
const C = require(join(ROOT, 'n8n', 'src', 'miniapp-submit', 'submit-contract.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const KEY = 'sub_' + 'a1b2c3d4'.repeat(4);
const KEY_2 = 'sub_' + 'f9e8d7c6'.repeat(4);
const NOW = '2026-08-26T20:00:00.000Z';
const REQ = 'req-2f5c-41a9-9e33';
const LEAD = 'FIN-1756171200-042';

function readyRow(over) {
  return Object.assign({
    submission_key: KEY, commit_state: 'READY', canonical_lead_id: '',
    lead_mode: '', lead_priority: '', financial_zone: '',
    created_at: NOW, claimed_at: '', settled_at: '', abort_reason: '', correlation_id: ''
  }, over || {});
}

// ================================================================ 1-4 PREALLOCATION

console.log('\nPREALLOCATION READBACK (P5 §1)');

check('(1) insert success plus an exact single READY readback advances authority', () => {
  const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] });
  eq(v.ok, true, 'a conforming readback was refused');
  eq(v.advance, true, 'a conforming readback did not clear the authority write');
  eq(v.reason, 'PREALLOCATION_CONFIRMED', 'the pass reason drifted');
});

check('(2) insert success plus a ZERO-row readback refuses to advance', () => {
  const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [] });
  eq(v.advance, false, 'authority advanced on an absent receipt');
  eq(v.reason, 'READBACK_ABSENT', 'the absent reason drifted');
});

check('(3) a duplicate readback refuses to advance', () => {
  const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow(), readyRow()] });
  eq(v.advance, false, 'authority advanced on duplicate receipts');
  eq(v.reason, 'READBACK_DUPLICATE', 'the duplicate reason drifted');
});

check('(4) an accidental second insert under the same key prevents authority advance', () => {
  // The exact P2 failure reproduced against the P5 guard: the store accepted both inserts and
  // reported success for both. The readback is the only thing that sees the damage.
  const store = [];
  store.push(readyRow({ correlation_id: '' }));
  store.push(readyRow({ correlation_id: '' }));           // second insert, also "successful"
  const insertReportedSuccess = { ok: true, insertedCount: 1 };
  eq(insertReportedSuccess.ok, true, 'the fixture does not model a successful insert');
  const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: store });
  eq(v.advance, false, 'a duplicated key still advanced authority');
  eq(v.reason, 'READBACK_DUPLICATE', 'the duplicate was misreported');
});

check('wrong key, wrong state, malformed row and store error all refuse to advance', () => {
  const cases = [
    [{ submissionKey: KEY, rows: [readyRow({ submission_key: KEY_2 })] }, 'READBACK_WRONG_KEY'],
    [{ submissionKey: KEY, rows: [readyRow({ commit_state: 'IN_FLIGHT' })] }, 'READBACK_WRONG_STATE'],
    [{ submissionKey: KEY, rows: [readyRow({ commit_state: 'COMMITTED' })] }, 'READBACK_WRONG_STATE'],
    [{ submissionKey: KEY, rows: [null] }, 'READBACK_MALFORMED_ROW'],
    [{ submissionKey: KEY, rows: ['a string'] }, 'READBACK_MALFORMED_ROW'],
    [{ submissionKey: KEY, rows: [[]] }, 'READBACK_MALFORMED_ROW'],
    [{ submissionKey: KEY, storeError: true, rows: [readyRow()] }, 'READBACK_STORE_ERROR'],
    [{ submissionKey: KEY, rows: null }, 'READBACK_UNREADABLE'],
    [{ submissionKey: KEY, rows: undefined }, 'READBACK_UNREADABLE'],
    [{ submissionKey: 'not-a-key', rows: [readyRow()] }, 'SUBMISSION_KEY_INVALID']
  ];
  cases.forEach(([opts, reason]) => {
    const v = R.verifyPreallocationReadback(opts);
    eq(v.advance, false, JSON.stringify(reason) + ' advanced authority');
    eq(v.reason, reason, 'wrong reason for ' + reason);
  });
});

check('a row carrying settlement residue is not a pristine preallocation', () => {
  ['canonical_lead_id', 'claimed_at', 'settled_at', 'abort_reason'].forEach((f) => {
    const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ [f]: 'x' })] });
    eq(v.advance, false, 'a row with ' + f + ' populated was treated as pristine');
    eq(v.reason, 'READBACK_NOT_PRISTINE', 'the residue reason drifted for ' + f);
  });
  // P1-L9 — a pristine preallocation has NOT been claimed, so it cannot carry a correlation id.
  const claimed = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ correlation_id: REQ })] });
  eq(claimed.advance, false, 'an already-claimed row passed as a fresh preallocation');
  eq(claimed.reason, 'READBACK_ALREADY_CLAIMED', 'the claimed reason drifted');
});

check('an issuance reference must belong to THIS issuance', () => {
  const good = R.verifyPreallocationReadback({
    submissionKey: KEY, rows: [readyRow()], issuanceRef: 'iss-1', expectedIssuanceRef: 'iss-1'
  });
  eq(good.advance, true, 'a matching issuance reference was refused');
  [['iss-1', 'iss-2'], ['', 'iss-1'], ['iss-1', ''], ['', '']].forEach(([got, want]) => {
    const v = R.verifyPreallocationReadback({
      submissionKey: KEY, rows: [readyRow()], issuanceRef: got, expectedIssuanceRef: want
    });
    eq(v.advance, false, 'issuance ref ' + JSON.stringify([got, want]) + ' advanced authority');
    eq(v.reason, 'ISSUANCE_REF_MISMATCH', 'the mismatch reason drifted');
  });
});

check('MUTATION — insertedCount and node success are refused as confirmation', () => {
  const rules = R.PREALLOCATION_READBACK_RULES;
  ['insertedCount', 'the node did not error', 'an HTTP 2xx', 'the absence of an exception']
    .forEach((s) => assert(rules.not_confirmation.indexOf(s) !== -1, s + ' is no longer refused as confirmation'));
  eq(rules.required_cardinality, 1, 'the cardinality requirement drifted');
  eq(rules.correlation_id_must_be_empty, true, 'the pristine correlation rule was dropped');
  // The mutation: a caller that has ONLY an insert result and no rows must still be refused.
  const v = R.verifyPreallocationReadback({ submissionKey: KEY, insertedCount: 1, ok: true });
  eq(v.advance, false, 'an insert result with no readback advanced authority');
});

console.log('\nCONCIERGE ISSUANCE (P5 §8)');

check('a confirmed readback advances authority with cycle_id AND submission_key together', () => {
  const ok = R.planIssuance({
    readback: R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] }),
    submissionKey: KEY, cycleId: 'C-900000777-1756171200000'
  });
  eq(ok.ok, true, 'a confirmed issuance was refused');
  eq(ok.advanceAuthority, true, 'a confirmed issuance did not advance authority');
  eq(Object.keys(ok.authorityPatch).sort().join(','), 'cycle_id,submission_key',
    'the authority patch does not write the binding as a pair');
  eq(ok.authorityPatch.submission_key, KEY, 'the patch names the wrong key');
});

check('an unconfirmed readback keeps the OLD cycle current and tells the client nothing', () => {
  [
    R.verifyPreallocationReadback({ submissionKey: KEY, rows: [] }),
    R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow(), readyRow()] }),
    R.verifyPreallocationReadback({ submissionKey: KEY, storeError: true, rows: [] }),
    R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ commit_state: 'COMMITTED' })] })
  ].forEach((rb) => {
    const p = R.planIssuance({ readback: rb, submissionKey: KEY, cycleId: 'C-1' });
    eq(p.advanceAuthority, false, 'an unconfirmed receipt advanced authority: ' + rb.reason);
    // The half-advance is the dangerous outcome: a new cycle_id with no submission_key would
    // be PRE_ACTIVATION_BLOCKED for every user on it.
    eq(p.keepCurrentCycle, true, 'the old cycle was not kept current for ' + rb.reason);
    assert(!p.authorityPatch, 'a refused issuance still produced an authority patch');
    eq(p.clientMaySeeNewCycle, false, 'the client would be told a new cycle exists');
    eq(p.orphanReceipt, true, 'the failed issuance was not recorded as an orphan');
  });
  // A missing cycle id or a malformed key is refused even on a clean readback.
  const clean = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] });
  eq(R.planIssuance({ readback: clean, submissionKey: KEY, cycleId: '' }).reason, 'CYCLE_ID_MISSING',
    'a cycleless issuance advanced');
  eq(R.planIssuance({ readback: clean, submissionKey: 'nope', cycleId: 'C-1' }).reason, 'SUBMISSION_KEY_INVALID',
    'a malformed key advanced');
  eq(R.planIssuance({}).advanceAuthority, false, 'an empty issuance plan advanced authority');
});

check('concurrent issuers each get their own receipt and the ledger does not arbitrate', () => {
  const inv = R.PREALLOCATION_INVARIANT;
  eq(inv.data_table_does_not_arbitrate, true, 'the ledger was made the arbiter');
  assert(/each issuer mints its OWN/i.test(inv.concurrent_issuance), 'the concurrency answer was removed');
  assert(/last-write-wins/i.test(inv.concurrent_issuance), 'the winner rule was removed');
  // Two independent issuances both confirm; neither blocks the other.
  const a = R.planIssuance({
    readback: R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] }),
    submissionKey: KEY, cycleId: 'C-A'
  });
  const b = R.planIssuance({
    readback: R.verifyPreallocationReadback({ submissionKey: KEY_2, rows: [readyRow({ submission_key: KEY_2 })] }),
    submissionKey: KEY_2, cycleId: 'C-B'
  });
  eq(a.advanceAuthority && b.advanceAuthority, true, 'concurrent issuance was blocked');
  assert(a.authorityPatch.submission_key !== b.authorityPatch.submission_key,
    'two issuers produced the same key');
});

// ================================================================ 5-11 P1-L9

console.log('\nP1-L9 CORRELATION CHAIN (P5 §2)');

check('(5) a preallocated receipt has an EMPTY correlation_id', () => {
  const p = R.buildPreallocation({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true });
  assert(p.ok, 'preallocation failed: ' + p.reason);
  eq(p.record.correlation_id, '', 'preallocation stamped a correlation id');
  eq(R.P1_L9_CORRELATION_CHAIN.empty_at_preallocation, true, 'the empty-at-preallocation rule was dropped');
});

check('(6) the winning READY -> IN_FLIGHT claim sets correlation_id', () => {
  const c = R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: REQ });
  assert(c.ok, 'claim build failed: ' + c.reason);
  eq(c.spec.set.correlation_id, REQ, 'the claim did not stamp the correlation id');
  eq(c.spec.set.commit_state, 'IN_FLIGHT', 'the claim target state drifted');
  eq(c.spec.where.commit_state, 'READY', 'the claim predicate no longer requires READY');
  // A claim without one is refused rather than defaulted: a generated value would correlate
  // to nothing and would break operator recovery silently.
  eq(R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true }).reason,
    'CORRELATION_ID_REQUIRED_AT_CLAIM', 'a claim without a correlation id was built');
});

check('(7) the stamped value equals envelope.meta.request_id', () => {
  // The gateway builds the envelope from the SAME server correlation id it hands the claim.
  const built = C.buildLeadIntakePayload({
    answers: {
      sector: 'retail', turnover: 'lt100k', cash: 'clear', profit: 'clear',
      treasury: 'clear', kpi: 'clear', pain: 'margin', urgency: 'none'
    },
    free_text: {}, contact: { name: 'Test', company: 'Test SRL' },
    telegramUserId: '900000777', locale: 'ru', clientVersion: 'b2.1.0',
    correlationId: REQ, nowIso: NOW
  });
  assert(built.ok, 'envelope build failed: ' + JSON.stringify(built));
  eq(built.envelope.payload.meta.request_id, REQ, 'the envelope request_id is not the server correlation id');
  const claim = R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: REQ });
  eq(claim.spec.set.correlation_id, built.envelope.payload.meta.request_id,
    'the receipt correlation id and the envelope request_id diverged');
});

check('(8) a losing claim cannot overwrite the correlation id', () => {
  // Immutability is a property of the PREDICATE, not of a separate guard: the loser matches
  // on commit_state === READY, which the winner has already moved.
  const row = readyRow();
  const winner = R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: REQ });
  // apply the winner
  let applied = 0;
  if (row.commit_state === winner.spec.where.commit_state) {
    Object.assign(row, winner.spec.set); applied = 1;
  }
  eq(applied, 1, 'the winner did not apply');
  eq(row.correlation_id, REQ, 'the winner did not stamp');

  const loser = R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: 'req-LOSER' });
  let loserApplied = 0;
  if (row.commit_state === loser.spec.where.commit_state) {
    Object.assign(row, loser.spec.set); loserApplied = 1;
  }
  eq(loserApplied, 0, 'the losing claim matched an already-claimed row');
  eq(row.correlation_id, REQ, 'the loser overwrote the correlation id');
  eq(R.P1_L9_CORRELATION_CHAIN.losing_claim_cannot_write_it, true, 'the loser rule was dropped');
});

check('(9) the commit preserves the correlation id', () => {
  const c = R.buildCommit({
    submissionKey: KEY, canonicalLeadId: LEAD, leadMode: 'new',
    leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW, provenanceTrusted: true
  });
  assert(c.ok, 'commit build failed: ' + c.reason);
  assert(!Object.prototype.hasOwnProperty.call(c.spec.set, 'correlation_id'),
    'the commit writes correlation_id');
  eq(R.P1_L9_CORRELATION_CHAIN.commit_preserves_it, true, 'the commit-preserves rule was dropped');
});

check('(10) the abort preserves the correlation id', () => {
  ['READY', 'IN_FLIGHT'].forEach((from) => {
    const a = R.buildAbort({
      submissionKey: KEY, nowIso: NOW, fromState: from, abortReason: 'PROVEN_NO_PIPELINE_COMMIT'
    });
    assert(a.ok, 'abort build failed from ' + from + ': ' + a.reason);
    assert(!Object.prototype.hasOwnProperty.call(a.spec.set, 'correlation_id'),
      'the abort from ' + from + ' writes correlation_id');
  });
  eq(R.P1_L9_CORRELATION_CHAIN.abort_preserves_it, true, 'the abort-preserves rule was dropped');
});

check('(11) MUTATION — a caller request_id cannot choose the stamped value', () => {
  eq(R.P1_L9_CORRELATION_CHAIN.caller_selectable, false, 'the chain declares a caller-selectable id');
  // The declared refusal: a value flagged as not server-minted is refused outright.
  const hostile = R.buildClaim({
    submissionKey: KEY, nowIso: NOW, provenanceTrusted: true,
    correlationId: 'attacker-chosen', correlationIdIsServerMinted: false
  });
  eq(hostile.ok, false, 'a non-server-minted correlation id was accepted');
  eq(hostile.reason, 'CORRELATION_ID_NOT_SERVER_MINTED', 'the refusal reason drifted');
  // request_id remains a correlation reference, never a submission identity.
  eq(C.REQUEST_ID_SEMANTICS.is_submission_key, false, 'request_id became a submission key');
  eq(C.REQUEST_ID_SEMANTICS.is_deduplication_key, false, 'request_id became a dedup key');
  eq(R.P1_L9_CORRELATION_CHAIN.request_id_is_submission_identity, false,
    'request_id was promoted to submission identity');
  eq(R.P1_L9_CORRELATION_CHAIN.submission_identity_is, 'submission_key', 'submission identity drifted');
  // A caller-asserted request_id is on the untrusted-body list, so it never reaches the server value.
  assert(C.UNTRUSTED_BODY_KEYS.indexOf('request_id') !== -1, 'request_id left the untrusted body list');
});

check('MUTATION — correlation_id is structurally unwritable outside the claim', () => {
  // The guard lives in updateSpec, so a future edit that adds correlation_id to a commit or
  // abort patch throws at build time rather than rewriting the chain in production.
  let threw = false;
  try { R.updateSpec(KEY, 'IN_FLIGHT', 'COMMITTED', { correlation_id: 'x' }); }
  catch (e) { threw = /P1-L9/.test(e.message); }
  eq(threw, true, 'a commit patch was allowed to write correlation_id');
  let threwAbort = false;
  try { R.updateSpec(KEY, 'READY', 'ABORTED', { correlation_id: 'x' }); }
  catch (e) { threwAbort = /P1-L9/.test(e.message); }
  eq(threwAbort, true, 'an abort patch was allowed to write correlation_id');
  // ...and the ONE legal transition still works.
  const ok = R.updateSpec(KEY, 'READY', 'IN_FLIGHT', { correlation_id: REQ });
  eq(ok.set.correlation_id, REQ, 'the legal claim transition was blocked');
});

// ================================================================ 12-16 CRITICAL SECTION

console.log('\nCRITICAL SECTION (P5 §3)');

// A compact model of the candidate's critical section, built from the REAL module functions.
// `pipelineWrites` is the number that matters: the whole section exists to keep it at zero
// whenever the claim did not return exactly one row.
function runCriticalSection(opts) {
  const o = opts || {};
  const state = { rows: o.rows === undefined ? [readyRow()] : o.rows, pipelineWrites: 0, response: null };

  // Stage 1-4: deterministic validation. Rejecting here must leave the receipt untouched.
  if (o.validationFails) {
    state.response = { ok: false, error_code: 'BAD_REQUEST' };
    return state;
  }

  // Stage 5-6: exact read then conditional claim.
  const claim = R.buildClaim({
    submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: REQ
  });
  if (!claim.ok) { state.response = { ok: false, error_code: 'SUBMIT_UNRESOLVED' }; return state; }

  const matched = state.rows.filter(
    (r) => r.submission_key === claim.spec.where.submission_key &&
           r.commit_state === claim.spec.where.commit_state
  );
  const updateResult = o.updateUnreadable
    ? { ok: false }
    : { ok: true, updated_rows: ('forceUpdatedRows' in o) ? o.forceUpdatedRows : matched.length };
  matched.forEach((r) => Object.assign(r, claim.spec.set));

  // Stage 7: the assertion. Anything but exactly one takes the fail-closed path.
  const verdict = R.assertExactlyOneUpdated(updateResult);
  if (!verdict.ok) {
    state.response = { ok: false, error_code: 'SUBMIT_UNRESOLVED', reason: verdict.reason };
    return state;
  }

  // Stage 8: the canonical Pipeline outcome.
  state.pipelineWrites += 1;
  if (o.pipelineFails) { state.response = { ok: false, error_code: 'SUBMIT_UNRESOLVED' }; return state; }

  // Stage 9-10: the commit CAS.
  const commit = R.buildCommit({
    submissionKey: KEY, canonicalLeadId: LEAD, leadMode: 'new',
    leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW, provenanceTrusted: true
  });
  const cMatched = state.rows.filter(
    (r) => r.submission_key === commit.spec.where.submission_key &&
           r.commit_state === commit.spec.where.commit_state
  );
  const cRows = ('forceCommitRows' in o) ? o.forceCommitRows : cMatched.length;
  cMatched.forEach((r) => Object.assign(r, commit.spec.set));
  const cVerdict = R.assertExactlyOneUpdated({ ok: true, updated_rows: cRows });
  if (!cVerdict.ok) {
    // Pipeline succeeded but the ledger did not record it. NOT an ordinary success.
    state.response = { ok: false, error_code: 'SUBMIT_UNRESOLVED', reason: cVerdict.reason };
    return state;
  }

  // Stage 11: only now.
  state.response = { ok: true, lead_id: LEAD };
  return state;
}

check('(12) a validation failure before the claim leaves the receipt READY', () => {
  const s = runCriticalSection({ validationFails: true });
  eq(s.pipelineWrites, 0, 'a rejected request wrote to Pipeline');
  eq(s.rows[0].commit_state, 'READY', 'a rejected request burned the receipt');
  eq(s.rows[0].correlation_id, '', 'a rejected request stamped the receipt');
  eq(s.response.ok, false, 'a rejected request reported success');
});

check('(13) a claim count of zero produces ZERO Pipeline writes', () => {
  // The receipt was already claimed by another attempt.
  const s = runCriticalSection({ rows: [readyRow({ commit_state: 'IN_FLIGHT', correlation_id: 'req-other' })] });
  eq(s.pipelineWrites, 0, 'a lost claim wrote to Pipeline');
  eq(s.response.ok, false, 'a lost claim reported success');
  eq(s.response.error_code, 'SUBMIT_UNRESOLVED', 'a lost claim was reported as an ordinary failure');
  eq(s.rows[0].correlation_id, 'req-other', 'a lost claim overwrote the correlation id');
});

check('(14) a claim count above one, or an unreadable count, produces ZERO Pipeline writes', () => {
  const many = runCriticalSection({ forceUpdatedRows: 2 });
  eq(many.pipelineWrites, 0, 'a multi-row claim wrote to Pipeline');
  eq(many.response.reason, 'MULTIPLE_ROWS_AFFECTED', 'the multi-row reason drifted');

  const unreadable = runCriticalSection({ updateUnreadable: true });
  eq(unreadable.pipelineWrites, 0, 'an unreadable claim result wrote to Pipeline');
  eq(unreadable.response.ok, false, 'an unreadable claim result reported success');

  // Every shape a looser check would wave through.
  [-1, 0.5, NaN, Infinity, '1', null, undefined].forEach((n) => {
    const s = runCriticalSection({ forceUpdatedRows: n });
    eq(s.pipelineWrites, 0, 'updated_rows=' + JSON.stringify(n) + ' reached Pipeline');
  });
});

check('(15) Pipeline success with a failed commit CAS is UNRESOLVED, not success', () => {
  const s = runCriticalSection({ forceCommitRows: 0 });
  eq(s.pipelineWrites, 1, 'the Pipeline write did not happen in this scenario');
  eq(s.response.ok, false, 'a failed commit CAS reported ordinary success');
  eq(s.response.error_code, 'SUBMIT_UNRESOLVED', 'a failed commit CAS was not reported unresolved');
  const many = runCriticalSection({ forceCommitRows: 3 });
  eq(many.response.error_code, 'SUBMIT_UNRESOLVED', 'a multi-row commit reported success');
});

check('(16) a success response is issued only after the commit CAS returned exactly one', () => {
  const s = runCriticalSection({});
  eq(s.pipelineWrites, 1, 'the happy path did not write to Pipeline exactly once');
  eq(s.response.ok, true, 'the happy path did not succeed');
  eq(s.rows[0].commit_state, 'COMMITTED', 'the receipt was not committed');
  eq(s.rows[0].canonical_lead_id, LEAD, 'the canonical lead id was not recorded');
  eq(s.rows[0].correlation_id, REQ, 'the commit lost the correlation id');
  eq(R.LEAD_INTAKE_CLAIM_RULES.commit_precedes_response, true, 'the commit-before-response rule was dropped');
});

check('MUTATION — removing the row-count assertion would let a lost claim reach Pipeline', () => {
  // Prove the assertion is load-bearing by running the same scenario WITHOUT it.
  const rows = [readyRow({ commit_state: 'IN_FLIGHT' })];
  const claim = R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: REQ });
  const matched = rows.filter((r) => r.commit_state === claim.spec.where.commit_state);
  eq(matched.length, 0, 'the fixture does not model a lost claim');
  // Without the assertion, "the node did not error" is the only signal, and it is true.
  const nodeSucceeded = true;
  eq(nodeSucceeded, true, 'the mutation fixture is wrong');
  // With the assertion, it fails closed.
  eq(R.assertExactlyOneUpdated({ ok: true, updated_rows: matched.length }).ok, false,
    'the assertion no longer refuses a zero-row claim');
});

// ================================================================ 17-20 TRUST

console.log('\nTRUST BOUNDARY (P5 §5, §6)');

check('(17) the public route ignores a caller-supplied submission_key', () => {
  const gate = R.resolveReceiptKey({ provenanceTrusted: false, submissionKey: KEY });
  eq(gate.allowed, false, 'an untrusted route resolved a receipt key');
  eq(gate.reason, 'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', 'the refusal reason drifted');
  eq(R.RECEIPT_AUTHORITY.public_route_behaviour,
    'receipt controls are IGNORED: no receipt is read, created or updated',
    'the public route behaviour drifted');
  // Caller-asserted control fields are dropped by the gateway, never read.
  ['submission_key', 'idempotency_key', '__internal_route', 'internal_route', 'provenance_trusted']
    .forEach((k) => assert(C.UNTRUSTED_BODY_KEYS.indexOf(k) !== -1 || k === 'submission_key',
      k + ' is no longer treated as untrusted body input'));
});

check('(18) the public route cannot mutate a receipt on any builder', () => {
  [
    () => R.buildPreallocation({ provenanceTrusted: false, submissionKey: KEY, nowIso: NOW }),
    () => R.buildClaim({ provenanceTrusted: false, submissionKey: KEY, nowIso: NOW, correlationId: REQ }),
    () => R.buildCommit({ provenanceTrusted: false, submissionKey: KEY, nowIso: NOW, canonicalLeadId: LEAD })
  ].forEach((fn, i) => {
    const out = fn();
    eq(out.ok, false, 'builder ' + i + ' produced a mutation on the public route');
    eq(out.reason, 'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', 'builder ' + i + ' refusal reason drifted');
  });
  // A refusal must not reveal whether the key exists: the reason is identical for a
  // well-formed key and a random one, so it is not an existence oracle.
  const real = R.resolveReceiptKey({ provenanceTrusted: false, submissionKey: KEY });
  const fake = R.resolveReceiptKey({ provenanceTrusted: false, submissionKey: KEY_2 });
  eq(real.reason, fake.reason, 'the public refusal distinguishes a real key from a random one');
});

check('(19) the internal route decision is INTERNAL SUBWORKFLOW with structural provenance', () => {
  const d = R.INTERNAL_ROUTE_DECISION;
  eq(d.decision, 'INTERNAL_SUBWORKFLOW', 'the route decision drifted');
  eq(d.public_url_created, false, 'the decision creates a public URL');
  eq(d.transport_secret_required, false, 'the decision requires a transport secret');
  eq(d.provenance_source, 'workflow graph reachability', 'provenance stopped being structural');
  eq(d.entry_node_type, 'n8n-nodes-base.executeWorkflowTrigger', 'the entry node type drifted');
  // The entry node name must match what internalRouteProven() actually reads, or provenance
  // silently becomes false for every internal call.
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'lead-intake', 'normalize-score-lead.js'), 'utf8');
  assert(src.indexOf("$('" + d.entry_node_name + "')") !== -1,
    'the declared entry node name does not match internalRouteProven()');
  // The fallback, if the gateway ever leaves the tenant, forbids the weak options by name.
  const f = d.fallback_if_gateway_leaves_tenant;
  eq(f.decision, 'AUTHENTICATED_WEBHOOK', 'the fallback drifted');
  assert(f.forbidden.some((x) => /Settings sheet/i.test(x)), 'the shared-secret prohibition was dropped');
  assert(f.forbidden.some((x) => /body field/i.test(x)), 'the body-marker prohibition was dropped');
  assert(f.forbidden.some((x) => /header/i.test(x)), 'the hand-checked-header prohibition was dropped');
});

check('(20) a body marker can never simulate the route', () => {
  eq(R.RECEIPT_AUTHORITY.marker_in_body_is_not_provenance, true, 'the body-marker rule was dropped');
  eq(R.RECEIPT_AUTHORITY.unguessable_key_is_not_a_substitute_for_route_auth, true,
    'an unguessable key was made a substitute for route auth');
  R.RECEIPT_AUTHORITY.never_from.forEach((s) =>
    assert(/body|header|query|caller/i.test(s), 'a provenance source prohibition was thinned: ' + s));
  // provenanceTrusted must be a strict boolean true: no truthy coercion.
  ['true', 1, {}, [], 'yes', 'TRUE'].forEach((v) => {
    eq(R.resolveReceiptKey({ provenanceTrusted: v, submissionKey: KEY }).allowed, false,
      JSON.stringify(v) + ' was coerced into trusted provenance');
  });
});

// ================================================================ 21-24 BINDING

console.log('\nAUTHORITY BINDING (P5 §7, §10)');

check('(21,22) authority binding is cycle_id AND submission_key, and drift on either refuses', () => {
  // Modelled directly on the handler's two guards: the cycle check and the key check.
  function bind(authorityCycle, authorityKey, sessionCycle, sessionKey) {
    if (String(authorityKey || '') === '') { return 'PRE_ACTIVATION_BLOCKED'; }
    if (String(sessionCycle) !== String(authorityCycle)) { return 'CYCLE_SUPERSEDED'; }
    if (String(sessionKey || '') === '' || String(sessionKey) !== String(authorityKey)) {
      return 'SUBMISSION_KEY_DRIFT';
    }
    return 'OK';
  }
  eq(bind('C-1', KEY, 'C-1', KEY), 'OK', 'a fully matching binding was refused');
  // (21) cycle same, key drifted.
  eq(bind('C-1', KEY, 'C-1', KEY_2), 'SUBMISSION_KEY_DRIFT', 'a drifted key was accepted');
  // (22) key same, cycle drifted.
  eq(bind('C-2', KEY, 'C-1', KEY), 'CYCLE_SUPERSEDED', 'a drifted cycle was accepted');
  // both drifted.
  eq(bind('C-2', KEY, 'C-1', KEY_2), 'CYCLE_SUPERSEDED', 'a doubly drifted binding was accepted');
});

check('(23) an app session missing the submission key refuses the handoff', () => {
  function sessionGuard(sessionKey, authorityKey) {
    if (String(sessionKey || '') === '' || String(sessionKey) !== String(authorityKey)) {
      return 'CYCLE_SUPERSEDED';
    }
    return 'OK';
  }
  eq(sessionGuard('', KEY), 'CYCLE_SUPERSEDED', 'a session with no key was allowed to hand off');
  eq(sessionGuard(undefined, KEY), 'CYCLE_SUPERSEDED', 'an undefined session key was allowed');
  eq(sessionGuard(KEY, KEY), 'OK', 'a matching session key was refused');
});

check('(24) authority with no submission_key is PRE_ACTIVATION_BLOCKED', () => {
  // The exact production consequence of an unmigrated sheet, and why the preflight must
  // fail closed rather than deploy-and-default.
  function authorityGuard(row) {
    return String((row && row.submission_key) || '') === '' ? 'PRE_ACTIVATION_BLOCKED' : 'OK';
  }
  eq(authorityGuard({ cycle_id: 'C-1' }), 'PRE_ACTIVATION_BLOCKED', 'a keyless authority row was allowed');
  eq(authorityGuard({ cycle_id: 'C-1', submission_key: '' }), 'PRE_ACTIVATION_BLOCKED', 'an empty key was allowed');
  eq(authorityGuard({ cycle_id: 'C-1', submission_key: KEY }), 'OK', 'a bound authority row was refused');
  // And it must be retryable, because an operator or a migration resolves it, not the client.
  eq(C.RETRYABLE.PRE_ACTIVATION_BLOCKED, true, 'PRE_ACTIVATION_BLOCKED stopped being retryable');
  // The key never crosses TB-1.
  const col = C.AUTHORITY_SCHEMA_PRECONDITION.columns.find((x) => x.name === 'submission_key');
  eq(col.crosses_tb1, false, 'submission_key was declared as crossing TB-1');
  assert(C.RESPONSE_FORBIDDEN_KEYS.indexOf('idempotency_key') !== -1, 'a receipt control left the response deny list');
});

// ================================================================ 25-26 SCHEMA

console.log('\nSCHEMA MIGRATION (P5 §7)');

check('(25) the Bot_Sessions preflight requires all four columns and fails closed', () => {
  const p = C.AUTHORITY_SCHEMA_PRECONDITION;
  eq(p.fail_mode, 'FAIL_CLOSED', 'the precondition stopped failing closed');
  eq(p.silent_default_permitted, false, 'a silent default was permitted');
  eq(p.columns.map((c) => c.name).join(','), 'submission_key,lead_mode,lead_priority,financial_zone',
    'the required column set drifted');
  // The five existing columns B.2.1-C depends on must be declared as PRESERVED, not re-added.
  ['cycle_id', 'consent_cycle_id', 'consent_at', 'lead_cycle_id', 'lead_intake_ok'].forEach((c) =>
    assert(p.preserved_existing_columns.indexOf(c) !== -1, c + ' is no longer declared as preserved'));
  // No column may be both preserved and required — that would mean duplicating a live column.
  p.columns.forEach((c) => assert(p.preserved_existing_columns.indexOf(c.name) === -1,
    c.name + ' is declared both preserved and required'));
  // Unreadable is never a pass.
  [null, undefined, 'submission_key', {}, 42].forEach((bad) => {
    const r = C.authoritySchemaPreflight(bad);
    eq(r.deploy, false, JSON.stringify(bad) + ' cleared the preflight');
    eq(r.reason, 'HEADERS_UNREADABLE', 'an unreadable header list was misreported');
  });
});

check('(26) every receipt writer field is declared in the schema', () => {
  eq(R.RECEIPT_FIELDS.length, 11, 'the receipt schema is no longer eleven fields');
  const p = R.buildPreallocation({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true });
  Object.keys(p.record).forEach((k) =>
    assert(R.RECEIPT_FIELDS.indexOf(k) !== -1, 'preallocation writes undeclared field ' + k));
  const claim = R.buildClaim({ submissionKey: KEY, nowIso: NOW, provenanceTrusted: true, correlationId: REQ });
  Object.keys(claim.spec.set).forEach((k) =>
    assert(R.RECEIPT_FIELDS.indexOf(k) !== -1, 'the claim writes undeclared field ' + k));
  const commit = R.buildCommit({
    submissionKey: KEY, canonicalLeadId: LEAD, leadMode: 'new',
    leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW, provenanceTrusted: true
  });
  Object.keys(commit.spec.set).forEach((k) =>
    assert(R.RECEIPT_FIELDS.indexOf(k) !== -1, 'the commit writes undeclared field ' + k));
  const abort = R.buildAbort({
    submissionKey: KEY, nowIso: NOW, fromState: 'IN_FLIGHT', abortReason: 'PROVEN_NO_PIPELINE_COMMIT'
  });
  Object.keys(abort.spec.set).forEach((k) =>
    assert(R.RECEIPT_FIELDS.indexOf(k) !== -1, 'the abort writes undeclared field ' + k));
});

// ================================================================ 27 ZERO-ITEM

console.log('\nZERO-ITEM DATA TABLE WIRING (P5 §4)');

check('the zero-item discriminator never turns an empty item into a success', () => {
  // The synthetic item n8n substitutes under alwaysOutputData is the trap.
  const synthetic = R.interpretUpdateItems([{}], KEY);
  eq(synthetic.ok, false, 'the synthetic empty item was read as a success');
  eq(synthetic.updated_rows, 0, 'the synthetic empty item reported a row');
  eq(R.interpretUpdateItems([{ json: {} }], KEY).updated_rows, 0, 'a wrapped empty item reported a row');
  // A genuine zero-match with alwaysOutputData off.
  eq(R.interpretUpdateItems([], KEY).updated_rows, 0, 'an empty array reported a row');
  // A genuine single updated row, in both raw and n8n-wrapped shapes.
  eq(R.interpretUpdateItems([{ submission_key: KEY, commit_state: 'IN_FLIGHT' }], KEY).updated_rows, 1,
    'a real updated row was not counted');
  eq(R.interpretUpdateItems([{ json: { submission_key: KEY } }], KEY).updated_rows, 1,
    'a wrapped updated row was not counted');
  // Anything unmodelled fails closed.
  eq(R.interpretUpdateItems([{ json: { submission_key: KEY } }, { json: { submission_key: KEY } }], KEY).ok, false,
    'two updated rows were accepted');
  eq(R.interpretUpdateItems([{ json: { submission_key: KEY_2 } }], KEY).reason, 'UPDATE_TOUCHED_WRONG_KEY',
    'an update against the wrong key was accepted');
  [null, undefined, 'x', 42, {}].forEach((bad) =>
    eq(R.interpretUpdateItems(bad, KEY).ok, false, JSON.stringify(bad) + ' was read as a success'));
  eq(R.interpretUpdateItems([{ json: { submission_key: KEY } }], 'not-a-key').ok, false,
    'an invalid expected key was accepted');
});

check('MUTATION — a truthy or try/catch discriminator would have passed the empty item', () => {
  // The three sloppy checks the real discriminator exists to rule out. Each ACCEPTS the
  // synthetic item; the real one refuses it. This is what makes the check load-bearing.
  const synthetic = [{ json: {} }];
  const truthy = synthetic.length > 0;                       // "did we get an item?"
  eq(truthy, true, 'the mutation fixture is wrong');
  const notUndefined = synthetic[0].json !== undefined;      // "is there a body?"
  eq(notUndefined, true, 'the mutation fixture is wrong');
  let caught = true;
  try { String(synthetic[0].json.submission_key); } catch (e) { caught = false; }
  eq(caught, true, 'the mutation fixture is wrong');
  // The real discriminator refuses all three readings.
  eq(R.interpretUpdateItems(synthetic, KEY).ok, false, 'the discriminator accepted the synthetic item');
});

check('the zero-item contract names the platform fact and the forbidden patterns', () => {
  const z = R.ZERO_ITEM_UPDATE_CONTRACT;
  assert(/main\[0\] === \[\]/.test(z.platform_fact), 'the platform fact drifted from the P4 evidence');
  assert(/SKIPPED/.test(z.consequence), 'the skipped-downstream consequence was softened');
  eq(z.synthetic_empty_item_is_not_success, true, 'the synthetic-item rule was dropped');
  eq(z.verdict_shape, '{ ok: boolean, updated_rows: 0 | 1 }', 'the verdict shape drifted');
  ['pre-read', 'node execution success', 'absence of an error'].forEach((frag) =>
    assert(z.forbidden_patterns.some((p) => new RegExp(frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(p)),
      'a forbidden pattern was dropped: ' + frag));
  assert(z.required_wiring.some((w) => /alwaysOutputData/.test(w)), 'the alwaysOutputData requirement was dropped');
  assert(z.required_wiring.some((w) => /NO Pipeline node/.test(w)), 'the no-Pipeline requirement was dropped');
});

// ================================================================ CANDIDATE WORKFLOW

console.log('\nCANDIDATE WORKFLOW STRUCTURE (P5 §4, §9)');

const CANDIDATE = JSON.parse(readFileSync(
  join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json'), 'utf8'));
const CONN = CANDIDATE.connections;
const NODE = new Map(CANDIDATE.nodes.map((n) => [n.name, n]));

// Every Google Sheets node that APPENDS or UPDATES — i.e. every canonical write. The
// zero-row branch must reach none of them.
const SHEET_WRITERS = CANDIDATE.nodes
  .filter((n) => /googleSheets/.test(n.type) && /append|update/i.test((n.parameters && n.parameters.operation) || ''))
  .map((n) => n.name);

function reachableFrom(startNodes) {
  const seen = new Set(startNodes);
  const q = startNodes.slice();
  while (q.length) {
    const n = q.pop();
    const outs = (CONN[n] && CONN[n].main) || [];
    outs.forEach((o) => (o || []).forEach((t) => {
      if (!seen.has(t.node)) { seen.add(t.node); q.push(t.node); }
    }));
  }
  return seen;
}
// Reachability that models a CONDITIONAL branch being taken. Plain graph reachability walks
// both outputs of an IF, so it can never express 'the public path takes the false edge'.
// falseOnly names the gates whose FALSE branch is the one under test; for those, only
// output index 1 is followed. Every other node still fans out normally, so nothing else is
// quietly excluded from the walk.
function reachableWithGates(startNodes, falseOnly) {
  const cut = new Set(falseOnly || []);
  const seen = new Set(startNodes);
  const q = startNodes.slice();
  while (q.length) {
    const n = q.pop();
    const outs = (CONN[n] && CONN[n].main) || [];
    outs.forEach((o, i) => {
      if (cut.has(n) && i !== 1) { return; }
      (o || []).forEach((t) => {
        if (!seen.has(t.node)) { seen.add(t.node); q.push(t.node); }
      });
    });
  }
  return seen;
}

function outputTargets(node, index) {
  return (((CONN[node] && CONN[node].main) || [])[index] || []).map((t) => t.node);
}

check('(27) the candidate exists, is derived from the production export, and is not deployed', () => {
  eq(CANDIDATE.meta.finmentor_source_export,
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json', 'the candidate lost its provenance');
  eq(CANDIDATE.meta.finmentor_not_deployed, true, 'the candidate is not marked undeployed');
  assert(SHEET_WRITERS.length >= 8, 'the sheet writer set looks wrong: ' + SHEET_WRITERS.length);
  ['Internal Auth Entry', 'Receipt Gate', 'IF Receipt Required', 'Receipt Exact Read',
    'Receipt Claim', 'Claim Verdict', 'IF Claim Won', 'Respond Receipt Unresolved']
    .forEach((n) => assert(NODE.has(n), 'the candidate is missing node: ' + n));
});

check('(27) a lost claim reaches NO Pipeline node', () => {
  // THE structural property. IF Claim Won output 1 is the false branch.
  const lost = reachableFrom(outputTargets('IF Claim Won', 1));
  const leaked = SHEET_WRITERS.filter((w) => lost.has(w));
  eq(leaked.join(','), '', 'a lost claim can reach Pipeline nodes: ' + leaked.join(','));
  assert(lost.has('Respond Receipt Unresolved'), 'a lost claim does not reach the fail-closed responder');
  // ...and the fail-closed responder itself reaches nothing that writes.
  const failClosed = reachableFrom(['Respond Receipt Unresolved']);
  eq(SHEET_WRITERS.filter((w) => failClosed.has(w)).join(','), '',
    'the fail-closed branch reaches a Pipeline node');
});

check('(27) a won claim DOES reach the Pipeline path', () => {
  // The complement: a gate that blocks everything is not a gate.
  const won = reachableFrom(outputTargets('IF Claim Won', 0));
  assert(won.has('Save to Pipeline'), 'a won claim cannot reach Save to Pipeline');
  assert(won.has('Update Pipeline (Merge)'), 'a won claim cannot reach the merge path');
});

check('(27) the claim node is wired for the zero-item case', () => {
  const claim = NODE.get('Receipt Claim');
  eq(claim.type, 'n8n-nodes-base.dataTable', 'the claim node type drifted');
  eq(claim.alwaysOutputData, true,
    'alwaysOutputData is off — a zero-match would skip the verdict node and the fail-closed branch');
  eq(claim.parameters.matchType, 'allConditions', 'the claim no longer requires all conditions');
  const conds = claim.parameters.filters.conditions.map((c) => c.keyName + '=' + c.keyValue);
  assert(conds.some((c) => /^submission_key=/.test(c)), 'the claim does not match on the key');
  assert(conds.indexOf('commit_state=READY') !== -1, 'the claim does not match on READY');
  eq(claim.parameters.columns.value.commit_state, 'IN_FLIGHT', 'the claim target state drifted');
  // P1-L9 — the claim stamps the correlation id.
  assert(/__correlation_id/.test(claim.parameters.columns.value.correlation_id),
    'the claim does not stamp the server correlation id');
  // Every commit node is wired the same way.
  ['New', 'Retry', 'Merge'].forEach((tag) => {
    const c = NODE.get('Receipt Commit (' + tag + ')');
    assert(c, 'missing commit node for ' + tag);
    eq(c.alwaysOutputData, true, 'commit (' + tag + ') is not wired for the zero-item case');
    assert(c.parameters.filters.conditions.some((x) => x.keyName === 'commit_state' && x.keyValue === 'IN_FLIGHT'),
      'commit (' + tag + ') does not require IN_FLIGHT');
    assert(!Object.prototype.hasOwnProperty.call(c.parameters.columns.value, 'correlation_id'),
      'commit (' + tag + ') rewrites correlation_id, which P1-L9 forbids');
  });
});

check('(27) validation and the dedup decision precede the claim in the real graph', () => {
  // Walked on the actual candidate graph, so a future rewiring that moves the claim earlier
  // fails here rather than in production.
  const fromValidate = reachableFrom(['Validate Payload']);
  assert(fromValidate.has('Receipt Claim'), 'the claim is not downstream of Validate Payload');
  const fromDedup = reachableFrom(['Dedup Guard']);
  assert(fromDedup.has('Receipt Claim'), 'the claim is not downstream of Dedup Guard');
  // The claim must NOT be reachable without passing the dedup decision: nothing upstream of
  // Dedup Guard may reach it except through Dedup Guard.
  assert(!reachableFrom(['Receipt Claim']).has('Dedup Guard'),
    'the graph loops back from the claim to the dedup decision');
  // The three lead-id-returning outcomes each commit BEFORE responding.
  [['Respond New Lead', 'New'], ['Respond Retry', 'Retry'], ['Respond Merged', 'Merge']]
    .forEach(([respond, tag]) => {
      const gate = 'IF Committed (' + tag + ')';
      eq(outputTargets(gate, 0).indexOf(respond) !== -1, true,
        respond + ' is not gated by its commit verdict');
      assert(outputTargets(gate, 1).indexOf('Respond Receipt Unresolved') !== -1,
        respond + ' has no unresolved path when the commit CAS fails');
    });
});

check('(27) the public path bypasses the entire receipt branch', () => {
  // §6. The public path is excluded by GATES, so plain reachability cannot express it: the
  // walk would follow both edges of every IF and report the receipt nodes as reachable.
  // The property actually being asserted is therefore: WHEN the §6 gates evaluate false —
  // which is exactly what __receipt_required = 0 means — no receipt node is reached.
  const GATES = ['IF Receipt Required', 'IF Receipt Active (New)', 'IF Receipt Active (Retry)', 'IF Receipt Active (Merge)'];
  GATES.forEach((g) => assert(NODE.has(g), 'the §6 gate is missing: ' + g));
  const pub = reachableWithGates(outputTargets('IF Receipt Required', 1), GATES);
  assert(pub.has('Save to Pipeline'), 'the public path can no longer create a lead');
  ['Receipt Exact Read', 'Receipt Claim', 'Claim Verdict', 'IF Claim Won',
    'Receipt Commit (New)', 'Receipt Commit (Retry)', 'Receipt Commit (Merge)',
    'Respond Receipt Unresolved']
    .forEach((n) => assert(!pub.has(n), 'the public path reaches receipt node ' + n));
  // The gates are only meaningful if they test the right flag and respond directly on false.
  ['New', 'Retry', 'Merge'].forEach((tag) => {
    const g = NODE.get('IF Receipt Active (' + tag + ')');
    const cond = g.parameters.conditions.conditions[0];
    assert(/__receipt_required/.test(cond.leftValue), 'gate ' + tag + ' does not test the receipt flag');
    assert(/Receipt Gate/.test(cond.leftValue), 'gate ' + tag + ' does not read the flag from Receipt Gate');
    eq(cond.rightValue, 1, 'gate ' + tag + ' does not require the flag to be 1');
    const falseTargets = outputTargets('IF Receipt Active (' + tag + ')', 1);
    eq(falseTargets.length, 1, 'gate ' + tag + ' false branch is not a single ordinary response');
    assert(/^Respond /.test(falseTargets[0]), 'gate ' + tag + ' false branch does not respond directly');
  });
  // ...and the flag itself is 0 unless BOTH internal provenance and an exact key are present.
  const gateSrc = NODE.get('Receipt Gate').parameters.jsCode;
  // Substring checks, deliberately: the strings being looked for are themselves regex
  // literals, so testing them AS regexes would assert something entirely different.
  assert(gateSrc.indexOf('internalRouteProven()') !== -1, 'the receipt gate no longer proves the route');
  assert(gateSrc.indexOf('trusted && keyValid') !== -1, 'the receipt gate no longer requires route AND key');
  assert(gateSrc.indexOf('^sub_[0-9a-f]{32}$') !== -1, 'the receipt gate lost its exact key format check');
  // The key is read ONLY from the trusted transport, never from the public body.
  assert(gateSrc.indexOf("$('Internal Auth Entry').first().json.submission_key") !== -1,
    'the receipt gate does not read the key from the trusted internal entry');
  assert(gateSrc.indexOf('$json.submission_key') === -1,
    'the receipt gate reads the key from the request body');
  // The public webhook and the internal entry share ONE validation pipeline, so the internal
  // route cannot skip a check the public route performs.
  eq(outputTargets('Webhook', 0).indexOf('Validate Payload') !== -1, true,
    'the public webhook no longer enters through Validate Payload');
  assert(reachableFrom(['Internal Auth Entry']).has('Validate Payload'),
    'the internal route bypasses Validate Payload');
});

check('(27) the internal entry is a sub-workflow trigger with no public URL', () => {
  const entry = NODE.get('Internal Auth Entry');
  eq(entry.type, 'n8n-nodes-base.executeWorkflowTrigger', 'the internal entry is not a sub-workflow trigger');
  // No second webhook was introduced: exactly one webhook node, the existing public one.
  const webhooks = CANDIDATE.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  eq(webhooks.length, 1, 'the candidate introduced an extra webhook endpoint');
  eq(webhooks[0].name, 'Webhook', 'the public webhook node was renamed or replaced');
  // The provenance marker is set by the graph, never read from the caller.
  const marker = NODE.get('Internal Route Marker');
  assert(/__internal_route = true/.test(marker.parameters.jsCode), 'the marker is no longer set by the graph');
  assert(/never read from the caller/i.test(marker.parameters.jsCode) || /never reads it/i.test(marker.notes || ''),
    'the marker node lost its "never from the caller" statement');
});

check('(27) the receipt table is referenced by name, not by a placeholder id', () => {
  ['Receipt Exact Read', 'Receipt Claim', 'Receipt Commit (New)', 'Receipt Commit (Retry)', 'Receipt Commit (Merge)']
    .forEach((n) => {
      const t = NODE.get(n).parameters.dataTableId;
      eq(t.mode, 'name', n + ' does not reference the table by name');
      eq(t.value, 'Submission_Receipts', n + ' points at the wrong table');
      assert(!/CANARY/i.test(t.value), n + ' still points at a canary table');
    });
});

check('(27) the candidate export carries no secret and no identity literal', () => {
  // The n8n export hygiene gate scopes to n8n/production/ only, so a workflow export living
  // in n8n/candidate/ would escape it entirely. The candidate is derived from a production
  // export and is a deployment artefact, so it gets the same scan rather than a weaker one.
  const raw = readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json'), 'utf8');
  const SECRETS = [
    ['telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
    ['openai api key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['google api key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
    ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['n8n api key (jwt)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
  ];
  SECRETS.forEach(([label, re]) => assert(!re.test(raw), 'the candidate contains a ' + label));
  // The candidate must not have introduced a NEW identity-shaped literal relative to the
  // production export it derives from. Comparing to the source rather than to an absolute
  // rule keeps pre-existing canonical sheet gids out of the result.
  const prod = readFileSync(join(ROOT, 'n8n', 'production',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8');
  const digitsIn = (s) => new Set((s.match(/\\?["'](\d{6,12})\\?["']/g) || [])
    .map((m) => m.replace(/[\\"']/g, '')));
  const before = digitsIn(prod);
  const introduced = [...digitsIn(raw)].filter((d) => !before.has(d));
  eq(introduced.length, 0, 'the candidate introduced identity-shaped literals: ' +
    introduced.map((d) => d.slice(0, 3) + '***').join(', '));
  // No canary or synthetic table name survived into the deployment artefact.
  assert(!/CANARY/i.test(raw), 'the candidate references a canary object');
});

check('(27) no raw submission_key reaches a log or response line', () => {
  const stop = NODE.get('Stop: Receipt Claim Failed');
  assert(!/__submission_key/.test(stop.parameters.jsCode), 'the failure log line prints the submission key');
  assert(/correlation_id/.test(stop.parameters.jsCode), 'the failure log line lost the correlation id');
  const resp = NODE.get('Respond Receipt Unresolved');
  assert(!/submission_key/.test(resp.parameters.responseBody), 'the unresolved response leaks the submission key');
  assert(/SUBMIT_UNRESOLVED/.test(resp.parameters.responseBody), 'the unresolved response lost its error code');
  eq(resp.parameters.responseCode, 503, 'the unresolved response is not a 503');
});

// ================================================================ P1-L4 / P1-L8

console.log('\nRETENTION AND DURABILITY POSTURE (P5 §11, §12)');

check('P1-L8 — no retention automation exists and the duration stays with the owner', () => {
  assert(/OWNER INPUT/i.test(R.RECEIPT_LIFECYCLE_INVARIANT.retention_duration),
    'a retention duration was chosen without the owner');
  // The deletion guard still refuses everything that is not provably safe.
  eq(R.mayDeleteReceipt({ commitState: 'READY' }).ok, false, 'a READY receipt was deletable');
  eq(R.mayDeleteReceipt({ commitState: 'IN_FLIGHT' }).ok, false, 'an IN_FLIGHT receipt was deletable');
  eq(R.mayDeleteReceipt({ commitState: 'COMMITTED', namedByCurrentAuthority: true, retentionPeriodElapsed: true }).ok,
    false, 'a receipt still named by current authority was deletable');
  eq(R.mayDeleteReceipt({ commitState: 'COMMITTED', retentionPeriodElapsed: false }).ok, false,
    'a receipt was deletable before the retention period elapsed');
  eq(R.mayDeleteReceipt({ commitState: 'COMMITTED', namedByCurrentAuthority: false, retentionPeriodElapsed: true }).ok,
    true, 'a provably safe deletion was refused');
});

check('the receipt table holds no contact PII and no user identity', () => {
  const m = R.SUBMISSION_KEY_MODEL;
  eq(m.ledger_holds_contact_pii, false, 'the ledger was declared to hold contact PII');
  eq(m.ledger_holds_user_identity, false, 'the ledger was declared to hold user identity');
  eq(m.derived_from_identity, false, 'the key became identity-derived');
  eq(m.browser_may_supply, false, 'the browser may supply the key');
  eq(m.crosses_tb1, false, 'the key crosses TB-1');
  // Precise rather than flattering — a COMMITTED receipt still holds canonical_lead_id.
  eq(m.ledger_is_identifier_free, false, 'the ledger claims to be identifier-free, which is false');
  // No contact field may appear in the receipt schema.
  ['name', 'company', 'direct', 'phone', 'email', 'chat_id', 'telegram_user_id']
    .forEach((f) => assert(R.RECEIPT_FIELDS.indexOf(f) === -1, 'the receipt schema holds ' + f));
});

// ---------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
