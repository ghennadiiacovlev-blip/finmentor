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
const H = require(join(ROOT, 'n8n', 'src', 'miniapp-submit', 'submit-handler.js'));

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

console.log('\nF6 RETRY SETTLEMENT (pure logic)');

check('(F6) buildRetrySettlement is READY -> COMMITTED with the canonical values', () => {
  const s = R.buildRetrySettlement({
    provenanceTrusted: true, submissionKey: KEY, canonicalLeadId: 'FIN-EXISTING-7',
    leadMode: 'retry', leadPriority: 'WARM', financialZone: 'YELLOW',
    nowIso: NOW, correlationId: REQ
  });
  assert(s.ok, 'retry settlement build failed: ' + s.reason);
  eq(s.spec.where.commit_state, 'READY', 'the settlement does not match READY');
  eq(s.spec.where.submission_key, KEY, 'the settlement does not match the key');
  eq(s.spec.set.commit_state, 'COMMITTED', 'the settlement target state drifted');
  eq(s.spec.set.canonical_lead_id, 'FIN-EXISTING-7', 'the settlement lost the canonical lead');
  eq(s.spec.set.correlation_id, REQ, 'the settlement did not record which attempt settled it');
  eq(s.spec.expect_updated_rows, 1, 'the settlement does not require exactly one row');
  // Same refusals as the claim.
  ['LEAD_ID_MISSING', 'CLOCK_MISSING', 'CORRELATION_ID_REQUIRED_AT_SETTLEMENT'].forEach((r) => assert(r, r));
  eq(R.buildRetrySettlement({ provenanceTrusted: true, submissionKey: KEY, nowIso: NOW, correlationId: REQ }).reason,
    'LEAD_ID_MISSING', 'a settlement without a canonical lead was built');
  eq(R.buildRetrySettlement({ provenanceTrusted: true, submissionKey: KEY, canonicalLeadId: 'L', nowIso: NOW }).reason,
    'CORRELATION_ID_REQUIRED_AT_SETTLEMENT', 'a settlement without a correlation id was built');
  eq(R.buildRetrySettlement({ provenanceTrusted: false, submissionKey: KEY, canonicalLeadId: 'L', nowIso: NOW, correlationId: REQ }).reason,
    'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', 'the public route built a settlement');
});

check('(F6) the retry settlement is crash-safe in both directions', () => {
  // The claim exists to mark "an irreversible write MAY have happened". On the retry branch
  // nothing is written, so there is no such uncertainty and no IN_FLIGHT state is created.
  // Both crash windows resolve safely, which is what makes the direct settlement correct
  // rather than merely shorter.
  const settle = R.buildRetrySettlement({
    provenanceTrusted: true, submissionKey: KEY, canonicalLeadId: 'FIN-EXISTING-7',
    leadMode: 'retry', leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW, correlationId: REQ
  });

  // CRASH BEFORE the CAS: the receipt is untouched, so a later attempt re-resolves dedup and
  // settles again. Nothing was written, so nothing can be duplicated.
  const beforeCrash = readyRow();
  eq(beforeCrash.commit_state, 'READY', 'the fixture is wrong');
  const replay = R.classifyRows([beforeCrash], KEY);
  eq(replay.verdict, 'READY', 'a pre-crash retry receipt is not replayable as READY');
  eq(replay.reason, 'NO_HANDOFF_BEGAN', 'a pre-crash retry receipt does not read as no-handoff');

  // CRASH AFTER the CAS: the receipt is COMMITTED with the canonical lead, so a later attempt
  // replays that success verbatim instead of re-submitting.
  const afterCrash = Object.assign(readyRow(), settle.spec.set);
  const settled = R.classifyRows([afterCrash], KEY);
  eq(settled.verdict, 'COMMITTED', 'a settled retry receipt does not replay as COMMITTED');
  eq(settled.lead_id, 'FIN-EXISTING-7', 'the replay lost the canonical lead');
  eq(settled.lead_mode, 'retry', 'the replay lost the retry mode');

  // There is no third state: the settlement never produces IN_FLIGHT, which is the state that
  // means CANNOT_ANSWER.
  assert(settle.spec.set.commit_state !== 'IN_FLIGHT', 'the retry settlement created an ambiguous state');

  // A second settlement attempt matches nothing, because the row has left READY.
  const second = afterCrash.commit_state === settle.spec.where.commit_state ? 1 : 0;
  eq(second, 0, 'a settled retry receipt could be settled twice');
});

check('(F6) buildCommit still requires IN_FLIGHT — new and merge cannot skip the claim', () => {
  const c = R.buildCommit({
    submissionKey: KEY, canonicalLeadId: LEAD, leadMode: 'new',
    leadPriority: 'WARM', financialZone: 'YELLOW', nowIso: NOW, provenanceTrusted: true
  });
  eq(c.spec.where.commit_state, 'IN_FLIGHT', 'the commit stopped requiring IN_FLIGHT');
  // ...and correlation_id remains unwritable there.
  let threw = false;
  try { R.updateSpec(KEY, 'IN_FLIGHT', 'COMMITTED', { correlation_id: 'x' }); }
  catch (e) { threw = /P1-L9/.test(e.message); }
  eq(threw, true, 'the commit was allowed to rewrite correlation_id');
  // An abort may leave READY but must NOT stamp a correlation id: it closes a receipt that
  // never corresponded to a submission, and a value there is noise an operator must rule out.
  let abortThrew = false;
  try { R.updateSpec(KEY, 'READY', 'ABORTED', { correlation_id: 'x' }); }
  catch (e) { abortThrew = /P1-L9/.test(e.message); }
  eq(abortThrew, true, 'an abort was allowed to stamp a correlation id');
  // The two legal transitions still work.
  eq(R.updateSpec(KEY, 'READY', 'IN_FLIGHT', { correlation_id: REQ }).set.correlation_id, REQ,
    'the claim transition was blocked');
  eq(R.updateSpec(KEY, 'READY', 'COMMITTED', { correlation_id: REQ }).set.correlation_id, REQ,
    'the retry settlement transition was blocked');
});

console.log('\nF7 READBACK KEY BINDING');

check('(F7) a verdict earned for key A cannot advance authority for key B', () => {
  const vA = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] });
  eq(vA.verified_submission_key, KEY, 'the verdict does not name the key it verified');
  const wrong = R.planIssuance({ readback: vA, submissionKey: KEY_2, cycleId: 'C-1' });
  eq(wrong.advanceAuthority, false, 'a verdict for key A advanced authority for key B');
  eq(wrong.reason, 'READBACK_KEY_BINDING_MISMATCH', 'the binding refusal reason drifted');
  eq(wrong.keepCurrentCycle, true, 'a binding mismatch did not keep the old cycle current');
  // A verdict with the field stripped is refused too — the binding cannot be opted out of.
  const stripped = Object.assign({}, vA); delete stripped.verified_submission_key;
  eq(R.planIssuance({ readback: stripped, submissionKey: KEY, cycleId: 'C-1' }).reason,
    'READBACK_KEY_BINDING_MISMATCH', 'a verdict with no bound key still advanced');
  [null, 42, {}, ''].forEach((bad) => {
    const v = R.planIssuance({ readback: Object.assign({}, vA, { verified_submission_key: bad }), submissionKey: KEY, cycleId: 'C-1' });
    eq(v.advanceAuthority, false, JSON.stringify(bad) + ' passed as a bound key');
  });
});

check('(F7) two concurrent issuance verdicts, swapped, are both refused', () => {
  // Concurrent issuance is ALLOWED, so two verdicts and two keys genuinely are in flight at
  // once — which is exactly why the binding has to be structural rather than by convention.
  const vA = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] });
  const vB = R.verifyPreallocationReadback({ submissionKey: KEY_2, rows: [readyRow({ submission_key: KEY_2 })] });
  eq(vA.advance && vB.advance, true, 'the concurrent fixture is wrong');
  eq(R.planIssuance({ readback: vA, submissionKey: KEY_2, cycleId: 'C-A' }).advanceAuthority, false,
    'swapped verdict A -> key B advanced');
  eq(R.planIssuance({ readback: vB, submissionKey: KEY, cycleId: 'C-B' }).advanceAuthority, false,
    'swapped verdict B -> key A advanced');
  // Correctly paired, both still advance.
  eq(R.planIssuance({ readback: vA, submissionKey: KEY, cycleId: 'C-A' }).advanceAuthority, true,
    'correctly paired verdict A was refused');
  eq(R.planIssuance({ readback: vB, submissionKey: KEY_2, cycleId: 'C-B' }).advanceAuthority, true,
    'correctly paired verdict B was refused');
});

check('(F7) a padded or mistyped stored key is refused, never trimmed into a match', () => {
  // normValue would TRIM, and trimming is a repair. A MODEL B key is opaque and server-minted,
  // so a stored value that is not byte-identical did not come from the minter.
  [KEY + ' ', ' ' + KEY, KEY + '\t', KEY.toUpperCase(), KEY.slice(0, -1), KEY + '0']
    .forEach((bad) => {
      const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ submission_key: bad })] });
      eq(v.advance, false, JSON.stringify(bad) + ' was accepted as the stored key');
      eq(v.reason, 'READBACK_WRONG_KEY', 'the wrong-key reason drifted for ' + JSON.stringify(bad));
    });
  // A non-string stored key is refused rather than coerced.
  [null, undefined, 42, {}].forEach((bad) => {
    const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ submission_key: bad })] });
    eq(v.advance, false, JSON.stringify(bad) + ' was coerced into a key match');
  });
});

console.log('\nF8 PRISTINE READBACK');

check('(F8) stale classification on a READY row is not pristine', () => {
  // classifyRows replays lead_mode / lead_priority / financial_zone on a COMMITTED read, so a
  // READY row already carrying them would arm a replay with a previous submission's values.
  ['lead_mode', 'lead_priority', 'financial_zone'].forEach((f) => {
    const v = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ [f]: 'HOT' })] });
    eq(v.advance, false, 'a READY row carrying ' + f + ' was treated as pristine');
    eq(v.reason, 'READBACK_NOT_PRISTINE', 'the residue reason drifted for ' + f);
    assert(v.fields.indexOf(f) !== -1, 'the refusal does not name the dirty field ' + f);
  });
  // The declared rule lists all seven fields.
  const req = R.PREALLOCATION_READBACK_RULES.required_pristine_fields;
  ['canonical_lead_id', 'claimed_at', 'settled_at', 'abort_reason',
    'lead_mode', 'lead_priority', 'financial_zone']
    .forEach((f) => assert(req.indexOf(f) !== -1, f + ' left the pristine set'));
});

check('(F8) created_at must be present and parseable, and is never repaired', () => {
  const missing = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ created_at: '' })] });
  eq(missing.reason, 'READBACK_CREATED_AT_MISSING', 'an empty created_at was accepted');
  [undefined, null, 42, {}].forEach((bad) =>
    eq(R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ created_at: bad })] }).reason,
      'READBACK_CREATED_AT_MISSING', JSON.stringify(bad) + ' passed as created_at'));
  ['not-a-date', 'yesterday', '2026-13-45T99:99:99Z'].forEach((bad) =>
    eq(R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow({ created_at: bad })] }).reason,
      'READBACK_CREATED_AT_INVALID', JSON.stringify(bad) + ' passed as a timestamp'));
  eq(R.PREALLOCATION_READBACK_RULES.created_at_must_be_present_and_parseable, true,
    'the created_at requirement was dropped');
  // A valid one still passes, and nothing was substituted.
  const ok = R.verifyPreallocationReadback({ submissionKey: KEY, rows: [readyRow()] });
  eq(ok.advance, true, 'a valid created_at was refused');
});


console.log('\nCANDIDATE WORKFLOW STRUCTURE (P5.1 F1-F6)');

const CANDIDATE = JSON.parse(readFileSync(
  join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json'), 'utf8'));
const CONN = CANDIDATE.connections;
const NODE = new Map(CANDIDATE.nodes.map((n) => [n.name, n]));

// Every Google Sheets node that APPENDS or UPDATES — i.e. every canonical write.
const SHEET_WRITERS = CANDIDATE.nodes
  .filter((n) => /googleSheets/.test(n.type) && /append|update/i.test((n.parameters && n.parameters.operation) || ''))
  .map((n) => n.name);
const RESPOND_NODES = CANDIDATE.nodes
  .filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')
  .map((n) => n.name);

// Assertions about what a Code node DOES must read its executable body, not the comments
// explaining it. Without this, a comment saying 'submission_key is deliberately NOT injected'
// fails a check looking for injected submission_key — the prose would have to be deleted to
// make the test pass, which is exactly backwards.
function codeBody(js) {
  return String(js || '').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
}

function outputTargets(node, index) {
  return (((CONN[node] && CONN[node].main) || [])[index] || []).map((t) => t.node);
}
function reachableFrom(startNodes) {
  const seen = new Set(startNodes);
  const q = startNodes.slice();
  while (q.length) {
    const n = q.pop();
    ((CONN[n] && CONN[n].main) || []).forEach((o) => (o || []).forEach((t) => {
      if (!seen.has(t.node)) { seen.add(t.node); q.push(t.node); }
    }));
  }
  return seen;
}
// Reachability that models a CONDITIONAL branch being taken. Plain graph reachability walks
// both outputs of an IF, so it can never express "the internal path takes the true edge" or
// "the public path takes the false edge". forcedIndex maps a gate name to the ONE output
// index to follow; every other node still fans out normally.
function reachableWithGates(startNodes, forcedIndex) {
  const seen = new Set(startNodes);
  const q = startNodes.slice();
  while (q.length) {
    const n = q.pop();
    ((CONN[n] && CONN[n].main) || []).forEach((o, i) => {
      const forced = forcedIndex[n];
      if (forced !== undefined && i !== forced) { return; }
      (o || []).forEach((t) => { if (!seen.has(t.node)) { seen.add(t.node); q.push(t.node); } });
    });
  }
  return seen;
}
// Every "is this internal?" gate takes its TRUE edge when we simulate the internal path.
const INTERNAL_GATES = CANDIDATE.nodes
  .filter((n) => /^IF Internal \(/.test(n.name)).map((n) => n.name);
const internalForced = {};
INTERNAL_GATES.forEach((g) => { internalForced[g] = 0; });
const INTERNAL_REACH = reachableWithGates(['Internal Subworkflow Trigger'], internalForced);

check('(F1) the provenance marker is written by the node internalRouteProven() reads', () => {
  // P5 wrote the marker in the node AFTER Internal Auth Entry while the proof read Internal
  // Auth Entry's own output, so provenance was false for every internal call unless the
  // CALLER supplied it — which the design forbids. The marker and the proof must be one node.
  const entry = NODE.get('Internal Auth Entry');
  assert(entry, 'Internal Auth Entry is missing');
  eq(entry.type, 'n8n-nodes-base.code', 'Internal Auth Entry is not the marker-writing Code node');
  assert(entry.parameters.jsCode.indexOf('__internal_route: true') !== -1,
    'Internal Auth Entry does not write the marker itself');
  // The declared proof expression must name this exact node.
  assert(R.RECEIPT_AUTHORITY.proven_by.indexOf("$('Internal Auth Entry')") !== -1,
    'the declared proof no longer names Internal Auth Entry');
  const helper = readFileSync(join(ROOT, 'n8n', 'src', 'lead-intake', 'normalize-score-lead.js'), 'utf8');
  assert(helper.indexOf("$('Internal Auth Entry').first().json.__internal_route === true") !== -1,
    'internalRouteProven() no longer reads the marker node');
  // The trigger is a separate node and does NOT carry the marker.
  const trig = NODE.get('Internal Subworkflow Trigger');
  eq(trig.type, 'n8n-nodes-base.executeWorkflowTrigger', 'the internal trigger type drifted');
  eq(outputTargets('Internal Subworkflow Trigger', 0).join(','), 'Internal Auth Entry',
    'the trigger does not feed the marker node');
});

check('(F1) the public webhook has NO graph path to the marker node', () => {
  const pub = reachableFrom(['Webhook']);
  assert(!pub.has('Internal Auth Entry'), 'the public webhook can reach Internal Auth Entry');
  assert(!pub.has('Internal Subworkflow Trigger'), 'the public webhook can reach the internal trigger');
  // Exactly one webhook endpoint, the pre-existing public one.
  const webhooks = CANDIDATE.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  eq(webhooks.length, 1, 'the candidate introduced an extra webhook endpoint');
  eq(webhooks[0].name, 'Webhook', 'the public webhook node was renamed or replaced');
});

check('(F1) a caller-supplied marker cannot establish provenance', () => {
  // The entry node reads the wrapper for submission_key and envelope ONLY. None of the
  // fields a caller might use to assert provenance is consulted anywhere in it.
  const js = NODE.get('Internal Auth Entry').parameters.jsCode;
  ['raw.__internal_route', 'raw.provenanceTrusted', 'raw.provenance_trusted',
    'raw.internal', 'raw.authenticated'].forEach((f) =>
    assert(js.indexOf(f) === -1, 'Internal Auth Entry reads caller field ' + f));
  // And the pure-logic layer refuses a truthy-but-not-true provenance value.
  ['true', 1, {}, [], 'yes', 'TRUE'].forEach((v) =>
    eq(R.resolveReceiptKey({ provenanceTrusted: v, submissionKey: KEY }).allowed, false,
      JSON.stringify(v) + ' was coerced into trusted provenance'));
  // Public-body control fields stay on the untrusted list.
  ['__internal_route', 'internal_route', 'provenance_trusted', 'request_id']
    .forEach((k) => assert(C.UNTRUSTED_BODY_KEYS.indexOf(k) !== -1, k + ' left the untrusted body list'));
});

check('(F2/F10) the wrapper is proven and unwrapped to the request shape', () => {
  const js = NODE.get('Internal Auth Entry').parameters.jsCode;
  assert(js.indexOf('^sub_[0-9a-f]{32}$') !== -1, 'the entry lost its exact key check');
  assert(js.indexOf("raw.submission_key") !== -1, 'the entry does not read submission_key from the wrapper');
  assert(js.indexOf("'telegram_miniapp'") !== -1, 'the entry does not check envelope.source');
  assert(js.indexOf('ENVELOPE_PAYLOAD_MISSING') !== -1, 'the entry does not check envelope.payload');
  // F10 — the unwrap emits the WEBHOOK REQUEST shape { headers, body }, because that is what
  // the inherited Validate Payload node actually reads.
  //
  // This assertion previously required `{ source, payload }` and therefore ENCODED THE
  // DEFECT: it kept passing while the internal route could not accept a single lead. The
  // shape contract is now proven by EXECUTION in qa/internal-route-contract.test.mjs; what is
  // checked here is only that this node still carries the structural properties this gate
  // owns. A string check cannot establish a data contract -- that was the whole lesson.
  const un = NODE.get('Internal Envelope Unwrap');
  assert(un, 'Internal Envelope Unwrap is missing');
  assert(un.parameters.jsCode.indexOf('body: env.payload') !== -1,
    'the unwrap does not put the envelope payload in the request body');
  assert(un.parameters.jsCode.indexOf('source: env.source, payload: env.payload') === -1,
    'the unwrap reverted to the { source, payload } shape Validate Payload cannot read');
  assert(codeBody(un.parameters.jsCode).indexOf('submission_key') === -1,
    'the unwrap injects submission_key into the payload');
  eq(outputTargets('Internal Envelope Unwrap', 0).join(','), 'Validate Payload',
    'the unwrap does not feed the shared validation path');
  // The unwrap must be the ONLY internal way into the shared pipeline. Asserting that it
  // feeds Validate Payload says nothing about a second edge that bypasses it — which is
  // exactly the mutation that survived the first sweep.
  const intoValidate = CANDIDATE.nodes
    .filter((n) => (outputTargets(n.name, 0).concat(outputTargets(n.name, 1))).indexOf('Validate Payload') !== -1)
    .map((n) => n.name).sort();
  eq(intoValidate.join(','), 'Internal Envelope Unwrap,Webhook',
    'something other than the public webhook and the unwrap feeds Validate Payload');
  // Both entries converge on ONE validation pipeline.
  eq(outputTargets('Webhook', 0).join(','), 'Validate Payload',
    'the public webhook no longer enters through Validate Payload');
});

check('(F2) the correlation id is read from envelope.payload.meta.request_id', () => {
  const js = NODE.get('Internal Auth Entry').parameters.jsCode;
  // P5 read e.meta.request_id || e.request_id — neither exists on the wrapper, so it always
  // resolved empty. The canonical location is payload.meta.request_id.
  const body = codeBody(js);
  assert(body.indexOf('payload.meta') !== -1, 'the entry does not read payload.meta');
  // The ASSIGNMENT must come from meta.request_id. Checking that the string appears somewhere
  // in the node is not enough: a mutation that reads raw.request_id instead still leaves the
  // word present in the surrounding code, and that mutation survived the first sweep.
  const assign = body.split(/\r?\n/).find((l) => /const\s+correlationId\s*=/.test(l)) || '';
  assert(/meta\.request_id/.test(assign),
    'the correlation id is not assigned from meta.request_id: ' + assign.trim());
  assert(!/raw\./.test(assign),
    'the correlation id is read off the raw wrapper rather than the envelope: ' + assign.trim());
  assert(js.indexOf('CORRELATION_ID_MISSING') !== -1, 'a missing correlation id is not a fault');
  // And the declared chain names the same location.
  assert(/payload\.meta\.request_id/.test(R.P1_L9_CORRELATION_CHAIN.value_source),
    'the declared value source does not name payload.meta.request_id');
});

check('(F2) a correlation mismatch fails closed BEFORE the claim', () => {
  const guard = NODE.get('Correlation Guard');
  assert(guard, 'Correlation Guard is missing');
  const js = guard.parameters.jsCode;
  assert(js.indexOf("$('Normalize + Score Lead').first().json.request_id") !== -1,
    'the guard does not compare against the normalized request_id');
  assert(js.indexOf('__correlation_id') !== -1, 'the guard does not read the internal correlation id');
  // Public traffic has nothing to compare and must pass.
  assert(js.indexOf('!isInternal ||') !== -1, 'the guard does not exempt public traffic');
  // The mismatch edge reaches an internal failure and NEVER the claim or a Pipeline node.
  const bad = reachableFrom(outputTargets('IF Correlation OK', 1));
  assert(!bad.has('Receipt Claim'), 'a correlation mismatch can still reach the claim');
  assert(!bad.has('Receipt Retry Settlement'), 'a correlation mismatch can still settle a receipt');
  eq(SHEET_WRITERS.filter((x) => bad.has(x)).join(','), '', 'a correlation mismatch reaches Pipeline');
  // ...and the good edge continues to the dedup read.
  assert(outputTargets('IF Correlation OK', 0).indexOf('Read Pipeline (Dedup)') !== -1,
    'the guard does not continue to the dedup read');
});

check('(F3) a trusted call with malformed controls cannot fall through to the public flow', () => {
  const gate = NODE.get('IF Internal Fault');
  assert(gate, 'IF Internal Fault is missing');
  // The fault gate sits BEFORE the shared pipeline, so a bad internal call never reaches it.
  const faulted = reachableFrom(outputTargets('IF Internal Fault', 0));
  assert(!faulted.has('Validate Payload'), 'a faulted internal call reaches the shared validation path');
  assert(!faulted.has('IF Is New'), 'a faulted internal call reaches the ordinary flow');
  assert(!faulted.has('Receipt Claim'), 'a faulted internal call reaches the claim');
  assert(!faulted.has('Receipt Retry Settlement'), 'a faulted internal call reaches a settlement');
  eq(SHEET_WRITERS.filter((x) => faulted.has(x)).join(','), '', 'a faulted internal call reaches Pipeline');
  eq(RESPOND_NODES.filter((x) => faulted.has(x)).join(','), '', 'a faulted internal call reaches a webhook responder');
  assert(faulted.has('Internal Result (Fault)'), 'a faulted internal call has no explicit failure terminal');
  // All four fault classes are detected.
  const js = NODE.get('Internal Auth Entry').parameters.jsCode;
  ['SUBMISSION_KEY_INVALID', 'ENVELOPE_MISSING', 'ENVELOPE_SOURCE_INVALID',
    'ENVELOPE_PAYLOAD_MISSING', 'CORRELATION_ID_MISSING']
    .forEach((r) => assert(js.indexOf(r) !== -1, 'fault class not detected: ' + r));
  // Second gate, defence in depth, and it also fails closed rather than going public.
  const second = reachableFrom(outputTargets('IF Receipt Fault', 0));
  assert(!second.has('IF Is New'), 'the second fault gate falls through to the ordinary flow');
  eq(SHEET_WRITERS.filter((x) => second.has(x)).join(','), '', 'the second fault gate reaches Pipeline');
});

check('(F4) the internal path never reaches a RespondToWebhook', () => {
  // THE F4 invariant. RespondToWebhook is documented only as "Returns data for Webhook";
  // nothing establishes it works inside an executeWorkflowTrigger execution, so the internal
  // path must not depend on one.
  assert(RESPOND_NODES.length >= 6, 'the responder set looks wrong: ' + RESPOND_NODES.length);
  const leaked = RESPOND_NODES.filter((r) => INTERNAL_REACH.has(r));
  eq(leaked.join(','), '', 'the internal path reaches webhook responders: ' + leaked.join(','));
  // Every internal terminal is a Code node whose output is the sub-workflow return value.
  const results = CANDIDATE.nodes.filter((n) => /^Internal Result \(/.test(n.name));
  assert(results.length >= 8, 'too few internal result terminals: ' + results.length);
  results.forEach((n) => {
    eq(n.type, 'n8n-nodes-base.code', n.name + ' is not a Code terminal');
    // A terminal must not fan out, or it would stop being the last executed node.
    eq(((CONN[n.name] && CONN[n.name].main) || []).length, 0, n.name + ' is not terminal');
  });
});

check('(F4) the internal return contract is exact and leaks nothing', () => {
  const results = CANDIDATE.nodes.filter((n) => /^Internal Result \(/.test(n.name));
  let okShapes = 0;
  let failShapes = 0;
  results.forEach((n) => {
    const js = codeBody(n.parameters.jsCode);
    // No stage, no detail, no submission_key in anything returned to the parent.
    ['stage', 'detail', 'submission_key', '__submission_key'].forEach((bad) =>
      assert(js.indexOf(bad) === -1, n.name + ' returns forbidden field ' + bad));
    if (js.indexOf('ok: true') !== -1) {
      okShapes++;
      ['lead_id', 'mode', 'priority', 'financial_zone'].forEach((f) =>
        assert(js.indexOf(f + ':') !== -1, n.name + ' success is missing ' + f));
    }
    if (js.indexOf('ok: false') !== -1) {
      failShapes++;
      ['error_code', 'retryable'].forEach((f) =>
        assert(js.indexOf(f + ':') !== -1, n.name + ' failure is missing ' + f));
    }
  });
  assert(okShapes >= 3, 'too few internal success terminals: ' + okShapes);
  assert(failShapes >= 5, 'too few internal failure terminals: ' + failShapes);
});

check('(F4) the public path still uses the existing webhook responders unchanged', () => {
  const publicForced = {};
  INTERNAL_GATES.forEach((g) => { publicForced[g] = 1; });
  publicForced['IF Receipt Required'] = 1;
  publicForced['IF Receipt Fault'] = 1;
  const pub = reachableWithGates(['Webhook'], publicForced);
  ['Respond New Lead', 'Respond Retry', 'Respond Merged', 'Respond Invalid']
    .forEach((r) => assert(pub.has(r), 'the public path can no longer reach ' + r));
  // ...and touches no receipt node.
  ['Receipt Exact Read', 'Receipt Claim', 'Claim Verdict', 'Receipt Retry Settlement',
    'Receipt Commit (New)', 'Receipt Commit (Merge)']
    .forEach((n) => assert(!pub.has(n), 'the public path reaches receipt node ' + n));
  // The pre-existing responder bodies are untouched by the splice.
  const prod = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
  const prodNode = new Map(prod.nodes.map((n) => [n.name, n]));
  RESPOND_NODES.forEach((r) => {
    const before = prodNode.get(r);
    assert(before, 'candidate invented a responder: ' + r);
    eq(JSON.stringify(NODE.get(r).parameters), JSON.stringify(before.parameters),
      'the splice modified the public responder ' + r);
  });
});

check('(F5) the retry receipt stores the SAME canonical lead id the public retry returns', () => {
  // Read off the live responder rather than assumed. Respond Retry returns
  //   $json.merge_lead_id || $json.lead_id   with $json being the Dedup Guard output.
  // Normalize + Score Lead.lead_id is the NEW submission's provisional server-minted id and
  // would name a Pipeline row that exists nowhere.
  const prod = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
  const respondRetry = prod.nodes.find((n) => n.name === 'Respond Retry').parameters.responseBody;
  assert(/merge_lead_id/.test(respondRetry), 'the public retry response no longer uses merge_lead_id');

  const settle = NODE.get('Receipt Retry Settlement');
  assert(settle, 'Receipt Retry Settlement is missing');
  const stored = settle.parameters.columns.value.canonical_lead_id;
  assert(/merge_lead_id/.test(stored), 'the retry settlement does not store the dedup-selected lead');
  assert(!/Normalize \+ Score Lead/.test(stored),
    'the retry settlement stores the provisional Normalize id, which names no Pipeline row');
  // The internal retry terminal returns the same value.
  const term = NODE.get('Internal Result (Retry)').parameters.jsCode;
  assert(/merge_lead_id/.test(term), 'the internal retry result does not return the dedup-selected lead');
  eq(settle.parameters.columns.value.lead_mode, 'retry', 'the retry receipt mode drifted');
});

check('(F5) new and merge store the canonical id their own public responders return', () => {
  const prod = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
  const prodNode = new Map(prod.nodes.map((n) => [n.name, n]));
  // NEW: Respond New Lead uses $('Dedup Guard').lead_id
  assert(/Dedup Guard'\)\.first\(\)\.json\.lead_id/.test(prodNode.get('Respond New Lead').parameters.responseBody),
    'the public new-lead response source drifted');
  assert(/Dedup Guard'\)\.first\(\)\.json\.lead_id/.test(NODE.get('Receipt Commit (New)').parameters.columns.value.canonical_lead_id),
    'the new commit does not store the same id the public response returns');
  // MERGE: Respond Merged uses $('Build Merge Update').lead_id
  assert(/Build Merge Update'\)\.first\(\)\.json\.lead_id/.test(prodNode.get('Respond Merged').parameters.responseBody),
    'the public merged response source drifted');
  assert(/Build Merge Update'\)\.first\(\)\.json\.lead_id/.test(NODE.get('Receipt Commit (Merge)').parameters.columns.value.canonical_lead_id),
    'the merge commit does not store the same id the public response returns');
  eq(NODE.get('Receipt Commit (New)').parameters.columns.value.lead_mode, 'new', 'new mode drifted');
  eq(NODE.get('Receipt Commit (Merge)').parameters.columns.value.lead_mode, 'merged', 'merged mode drifted');
});

check('(F6) retry settles READY -> COMMITTED directly and is reachable only from the retry branch', () => {
  const settle = NODE.get('Receipt Retry Settlement');
  const conds = settle.parameters.filters.conditions.map((c) => c.keyName + '=' + c.keyValue);
  assert(conds.indexOf('commit_state=READY') !== -1, 'the retry settlement does not match READY');
  eq(settle.parameters.columns.value.commit_state, 'COMMITTED', 'the retry settlement target state drifted');
  eq(settle.alwaysOutputData, true, 'the retry settlement is not wired for the zero-item case');
  // Reachable ONLY from the retry edge: the non-retry edge must never reach it.
  const notRetry = reachableFrom(outputTargets('IF Receipt Is Retry', 1));
  assert(!notRetry.has('Receipt Retry Settlement'),
    'the non-retry branch can reach the retry settlement');
  assert(notRetry.has('Receipt Claim'), 'the non-retry branch does not reach the claim');
  // ...and the retry edge never claims.
  const retryEdge = reachableFrom(outputTargets('IF Receipt Is Retry', 0));
  assert(!retryEdge.has('Receipt Claim'), 'the retry branch can still claim');
  eq(SHEET_WRITERS.filter((x) => retryEdge.has(x)).join(','), '',
    'the retry branch reaches a Pipeline write, which it must not');
  // A lost settlement CAS fails closed.
  const lost = reachableFrom(outputTargets('IF Retry Settled', 1));
  assert(lost.has('Internal Result (Unresolved)'), 'a lost retry settlement does not fail closed');
  eq(SHEET_WRITERS.filter((x) => lost.has(x)).join(','), '', 'a lost retry settlement reaches Pipeline');
});

check('(F6) the retry branch does not pretend a Pipeline write happened', () => {
  const retry = R.P1_L9_CORRELATION_CHAIN.retry;
  eq(retry.pipeline_write_occurs, false, 'the retry branch claims a Pipeline write');
  eq(retry.correlation_id_is_in_pipeline, false, 'the retry branch claims its correlation id is in Pipeline');
  eq(retry.cosmetic_pipeline_write_added_to_satisfy_the_equation, false,
    'a cosmetic Pipeline write was added to satisfy the correlation equation');
  assert(/canonical_lead_id/.test(retry.operator_recovers_by),
    'the retry branch does not say how an operator actually recovers');
  // The universal wording is gone: the chain is declared per branch.
  eq(R.P1_L9_CORRELATION_CHAIN.branch_aware, true, 'the chain stopped being branch-aware');
  assert(R.P1_L9_CORRELATION_CHAIN.rule === undefined,
    'the universal P1-L9 rule was restored and would be false on the retry branch');
  // The write-bearing branches still assert the full equation.
  assert(/Pipeline\.request_id/.test(R.P1_L9_CORRELATION_CHAIN.new_and_merge.rule),
    'the new/merge branch no longer asserts the Pipeline equality');
  eq(R.P1_L9_CORRELATION_CHAIN.new_and_merge.pipeline_write_occurs, true,
    'the new/merge branch stopped claiming a Pipeline write');
});

check('the claim node is wired for the zero-item case', () => {
  const claim = NODE.get('Receipt Claim');
  eq(claim.type, 'n8n-nodes-base.dataTable', 'the claim node type drifted');
  eq(claim.alwaysOutputData, true,
    'alwaysOutputData is off — a zero-match would skip the verdict node and the fail-closed branch');
  eq(claim.parameters.matchType, 'allConditions', 'the claim no longer requires all conditions');
  const conds = claim.parameters.filters.conditions.map((c) => c.keyName + '=' + c.keyValue);
  assert(conds.some((c) => /^submission_key=/.test(c)), 'the claim does not match on the key');
  assert(conds.indexOf('commit_state=READY') !== -1, 'the claim does not match on READY');
  eq(claim.parameters.columns.value.commit_state, 'IN_FLIGHT', 'the claim target state drifted');
  assert(/__correlation_id/.test(claim.parameters.columns.value.correlation_id),
    'the claim does not stamp the server correlation id');
  ['New', 'Merge'].forEach((tag) => {
    const c = NODE.get('Receipt Commit (' + tag + ')');
    assert(c, 'missing commit node for ' + tag);
    eq(c.alwaysOutputData, true, 'commit (' + tag + ') is not wired for the zero-item case');
    assert(c.parameters.filters.conditions.some((x) => x.keyName === 'commit_state' && x.keyValue === 'IN_FLIGHT'),
      'commit (' + tag + ') does not require IN_FLIGHT');
    assert(!Object.prototype.hasOwnProperty.call(c.parameters.columns.value, 'correlation_id'),
      'commit (' + tag + ') rewrites correlation_id, which P1-L9 forbids');
  });
});

check('a lost claim reaches NO Pipeline node and no webhook responder', () => {
  const lost = reachableFrom(outputTargets('IF Claim Won', 1));
  eq(SHEET_WRITERS.filter((w) => lost.has(w)).join(','), '',
    'a lost claim can reach Pipeline nodes');
  eq(RESPOND_NODES.filter((r) => lost.has(r)).join(','), '',
    'a lost claim reaches a webhook responder');
  assert(lost.has('Internal Result (Unresolved)'), 'a lost claim does not reach the fail-closed terminal');
  // A won claim DOES reach Pipeline — a gate that blocks everything is not a gate.
  const won = reachableFrom(outputTargets('IF Claim Won', 0));
  assert(won.has('Save to Pipeline'), 'a won claim cannot reach Save to Pipeline');
  assert(won.has('Update Pipeline (Merge)'), 'a won claim cannot reach the merge path');
});

check('validation and the dedup decision precede the claim in the real graph', () => {
  const fromValidate = reachableFrom(['Validate Payload']);
  assert(fromValidate.has('Receipt Claim'), 'the claim is not downstream of Validate Payload');
  const fromDedup = reachableFrom(['Dedup Guard']);
  assert(fromDedup.has('Receipt Claim'), 'the claim is not downstream of Dedup Guard');
  assert(!reachableFrom(['Receipt Claim']).has('Dedup Guard'),
    'the graph loops back from the claim to the dedup decision');
  // Each write-bearing outcome commits before returning.
  ['New', 'Merge'].forEach((tag) => {
    const gate = 'IF Committed (' + tag + ')';
    assert(outputTargets(gate, 0).indexOf('Internal Result (' + tag + ')') !== -1,
      tag + ' success is not gated by its commit verdict');
    assert(outputTargets(gate, 1).indexOf('Internal Result (Unresolved)') !== -1,
      tag + ' has no unresolved path when the commit CAS fails');
  });
});

check('the receipt table is referenced by name, not by a placeholder id', () => {
  ['Receipt Exact Read', 'Receipt Claim', 'Receipt Retry Settlement',
    'Receipt Commit (New)', 'Receipt Commit (Merge)']
    .forEach((n) => {
      const t = NODE.get(n).parameters.dataTableId;
      eq(t.mode, 'name', n + ' does not reference the table by name');
      eq(t.value, 'Submission_Receipts', n + ' points at the wrong table');
    });
});

check('no raw submission_key reaches a log, a response or the parent', () => {
  CANDIDATE.nodes.filter((n) => /^Internal Result \(/.test(n.name)).forEach((n) => {
    assert(codeBody(n.parameters.jsCode).indexOf('submission_key') === -1,
      n.name + ' leaks the submission key to the parent');
  });
  // The public responder bodies never mention it either.
  RESPOND_NODES.forEach((r) => {
    const body = String(NODE.get(r).parameters.responseBody || '');
    assert(body.indexOf('submission_key') === -1, r + ' leaks the submission key');
  });
});

check('the candidate export carries no secret and no identity literal', () => {
  // The n8n export hygiene gate scopes to n8n/production/ only, so a workflow export in
  // n8n/candidate/ would escape it. It gets the same scan rather than a weaker one.
  const raw = readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json'), 'utf8');
  [
    ['telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
    ['openai api key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['google api key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
    ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['n8n api key (jwt)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
  ].forEach(([label, re]) => assert(!re.test(raw), 'the candidate contains a ' + label));
  const prod = readFileSync(join(ROOT, 'n8n', 'production',
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8');
  const digitsIn = (s) => new Set((s.match(/\\?["'](\d{6,12})\\?["']/g) || [])
    .map((m) => m.replace(/[\\"']/g, '')));
  const before = digitsIn(prod);
  const introduced = [...digitsIn(raw)].filter((d) => !before.has(d));
  eq(introduced.length, 0, 'the candidate introduced identity-shaped literals: ' +
    introduced.map((d) => d.slice(0, 3) + '***').join(', '));
  assert(!/CANARY/i.test(raw), 'the candidate references a canary object');
  eq(CANDIDATE.meta.finmentor_not_deployed, true, 'the candidate is not marked undeployed');
  eq(CANDIDATE.meta.finmentor_source_export,
    'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json', 'the candidate lost its provenance');
});


console.log('\nF9 RETRY OUTCOME RECOVERY (P5.2)');

check('(3) a COMMITTED retry receipt recovers with mode=retry intact', () => {
  // The full chain the operator recovery path actually walks: a settled retry receipt ->
  // classifyRows -> the recovery adapter body -> canonicalResult -> internalMode.
  const settled = R.buildRetrySettlement({
    provenanceTrusted: true, submissionKey: KEY, canonicalLeadId: 'FIN-EXISTING-441',
    leadMode: 'retry', leadPriority: 'WARM', financialZone: 'YELLOW',
    nowIso: NOW, correlationId: REQ
  });
  assert(settled.ok, 'retry settlement build failed: ' + settled.reason);
  const row = Object.assign(readyRow(), settled.spec.set);

  const verdict = R.classifyRows([row], KEY);
  eq(verdict.verdict, 'COMMITTED', 'a settled retry receipt does not classify as COMMITTED');
  eq(verdict.lead_mode, 'retry', 'classifyRows lost the retry mode');
  eq(verdict.lead_id, 'FIN-EXISTING-441', 'classifyRows lost the canonical lead');

  // The adapter hands the gateway exactly what classifyRows found.
  const body = {
    ok: true, lead_id: verdict.lead_id, mode: verdict.lead_mode,
    priority: verdict.lead_priority, financial_zone: verdict.financial_zone
  };
  const canonical = H.canonicalResult(body);
  assert(canonical, 'canonicalResult rejected a recovered retry outcome');
  eq(canonical.mode, 'retry', 'canonicalResult dropped the retry mode');
  eq(canonical.lead_id, 'FIN-EXISTING-441', 'canonicalResult lost the canonical lead');

  // ...and the gateway logs it as a KNOWN mode rather than as vocabulary drift.
  const observed = C.internalMode(canonical.mode);
  eq(observed.observed, 'retry', 'the observed mode drifted');
  eq(observed.known, true, 'a recovered retry was reported as an unknown mode');
});

check('(9,12) the PUBLIC retry path is untouched by P5.2', () => {
  // The whole point of admitting retry to the vocabulary is that the live behaviour was
  // already correct. Nothing about the public graph may have moved.
  //
  // FROZEN pre-Write-A export -- see n8n/history/README.md. The comparison below asks whether
  // the Write A candidate altered any node it INHERITED, so the other side has to be the graph
  // that candidate was spliced from. The tracked reference has since advanced twice (Write A to
  // 100 nodes, then the P8.4A-R replay correction to 102), and against that this check counted
  // the correction's own two new nodes plus its one edited body as "the candidate altered
  // production" -- an accusation about a candidate that predates all three.
  const prod = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history',
    'QmIyEW2ZEqKregmN.pre-write-a.json'), 'utf8'));
  const respondRetry = prod.nodes.find((n) => n.name === 'Respond Retry');
  assert(/mode: 'retry'/.test(respondRetry.parameters.responseBody),
    'the public retry response no longer returns mode retry');
  assert(/merge_lead_id/.test(respondRetry.parameters.responseBody),
    'the public retry response no longer returns the dedup-selected lead');

  // Every pre-existing node is still parameter-identical in the candidate — P5.2 changed
  // repository contracts, not the workflow.
  const cand = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate',
    'lead-intake-internal-receipt-candidate.json'), 'utf8'));
  const C2 = new Map(cand.nodes.map((n) => [n.name, n]));
  let altered = 0;
  prod.nodes.forEach((n) => {
    const c = C2.get(n.name);
    if (!c) { altered++; return; }
    if (JSON.stringify(n.parameters) !== JSON.stringify(c.parameters)) { altered++; }
  });
  eq(altered, 0, altered + ' production node(s) were altered in the candidate');
});

check('(10) the internal retry terminal still matches the public retry outcome', () => {
  const cand = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate',
    'lead-intake-internal-receipt-candidate.json'), 'utf8'));
  const N2 = new Map(cand.nodes.map((n) => [n.name, n]));
  const term = N2.get('Internal Result (Retry)');
  assert(term, 'Internal Result (Retry) is missing');
  const js = term.parameters.jsCode;
  assert(/mode: 'retry'/.test(js), 'the internal retry result no longer returns mode retry');
  assert(/merge_lead_id/.test(js), 'the internal retry result no longer returns the dedup-selected lead');
  // The receipt stores the same mode the terminal returns, so a replay is verbatim.
  const settle = N2.get('Receipt Retry Settlement');
  eq(settle.parameters.columns.value.lead_mode, 'retry', 'the settled receipt mode drifted');
  // And that mode is inside the declared vocabulary, which is the defect P5.2 closed.
  assert(C.ALLOWED_MODES.indexOf(settle.parameters.columns.value.lead_mode) !== -1,
    'the receipt stores a mode the gateway contract still calls invalid');
});

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
