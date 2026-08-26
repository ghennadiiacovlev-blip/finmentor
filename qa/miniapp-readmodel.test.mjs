#!/usr/bin/env node
// FINMENTOR — Mini App read-model consistency gate (B.2.1-B, Phase 10).
//
// Closes the executable-proof gap the independent review recorded against PR #10:
// INDP2-03 (zero-write resume), INDP2-09 (complete projection + stored-row equality),
// INDP2-10 (authority convergence and the failure/fallback matrix).
//
// The live QA runs on PR #10 already proved the Data Table CAS *primitive* under real
// execution overlap. What they got wrong was the verifier, and a verifier is pure logic —
// so it is provable here, deterministically, with no tenant, no credentials and no network.
// The Data Table and Bot_Sessions doubles implement the same conditional-update semantics
// the live runs observed, and the code under test is the code that deploys.
//
// Assertion-based, non-zero exit on failure, paths resolved from this file not from cwd.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = join(HERE, '..', 'n8n', 'src', 'miniapp-readmodel');
const P = require(join(SRC, 'projection.js'));
const M = require(join(SRC, 'mirror-helper.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// ---------------------------------------------------------------- test doubles

// Deterministic token source. Real helpers use crypto.randomUUID(); the gate needs
// reproducible generation labels so a failure names the generation that broke.
function makeTokens(prefix) {
  let n = 0;
  return { next() { n++; return prefix + '-' + n; } };
}

const CLOCK = { now: () => '2026-08-25T21:00:00.000Z' };

// n8n Data Table double. publish() is a single conditional update matching chat_id AND
// sync_token — the same all-conditions semantics the live CAS proof observed.
function makeDataTable() {
  const rows = [];
  const dt = {
    rows,
    stats: { reads: 0, writes: 0, tombstones: 0, publishes: 0, removes: 0 },
    failPublish: false,
    readError: null,
    // Restricts the next publish to a subset of fields, reproducing the incomplete
    // publish set that the reversed-order live run shipped.
    publishOnly: null,
    read(chatId, limit) {
      dt.stats.reads++;
      if (dt.readError) { return { rows: [], error: dt.readError }; }
      const found = rows.filter((r) => String(r.chat_id) === String(chatId));
      return { rows: found.slice(0, limit).map((r) => Object.assign({}, r)), error: null };
    },
    setTombstone(chatId, token) {
      dt.stats.writes++; dt.stats.tombstones++;
      const existing = rows.filter((r) => String(r.chat_id) === String(chatId));
      if (existing.length === 0) {
        rows.push({ chat_id: String(chatId), cache_valid: false, sync_token: token });
      } else {
        // Only the control columns move. Any stale mirrored field survives, which is
        // exactly how a stale session_id outlived its generation on the live run.
        existing.forEach((r) => { r.cache_valid = false; r.sync_token = token; });
      }
      return { ok: true };
    },
    publish(op) {
      dt.stats.writes++; dt.stats.publishes++;
      if (dt.failPublish) { return { ok: false, updated_rows: 0 }; }
      const match = rows.filter((r) => String(r.chat_id) === String(op.chatId) &&
        String(r.sync_token) === String(op.token));
      if (match.length === 0) { return { ok: true, updated_rows: 0 }; }
      const fields = dt.publishOnly
        ? Object.keys(op.row).filter((k) => dt.publishOnly.indexOf(k) !== -1)
        : Object.keys(op.row);
      match.forEach((r) => { fields.forEach((k) => { r[k] = op.row[k]; }); });
      return { ok: true, updated_rows: match.length };
    },
    remove(chatId) {
      dt.stats.writes++; dt.stats.removes++;
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i].chat_id) === String(chatId)) { rows.splice(i, 1); n++; }
      }
      return { ok: true, removed: n };
    }
  };
  return dt;
}

function makeAuthority(seed) {
  const store = {};
  Object.keys(seed || {}).forEach((k) => { store[k] = Object.assign({}, seed[k]); });
  return {
    store,
    stats: { reads: 0, writes: 0 },
    failWrite: false,
    write(chatId, patch) {
      this.stats.writes++;
      if (this.failWrite) { return { ok: false }; }
      store[chatId] = Object.assign({ chat_id: String(chatId) }, store[chatId] || {}, patch || {});
      return { ok: true };
    },
    read(chatId) {
      this.stats.reads++;
      const r = store[chatId];
      return r ? { ok: true, row: Object.assign({}, r) } : { ok: false, row: null };
    }
  };
}

// A realistic authoritative Bot_Sessions row, including the raw/legacy columns that must
// never reach the derived table. No real client data: synthetic ids only.
const AUTH_ROW = {
  chat_id: '900000001',
  session_id: 'S-BASE',
  state: 'diagnostic',
  status: 'in_progress',
  selected_service: 'working_capital',
  business_model: 'distribution',
  main_pain: 'cash_gap',
  urgency: 'none',
  consent: 'yes',
  lead_id: 'FIN-QA-0001',
  cycle_id: 'C-100',
  consent_cycle_id: 'C-100',
  consent_at: '2026-08-25T18:00:00.000Z',
  lead_cycle_id: 'C-100',
  lead_intake_ok: true,
  updated_at: '2026-08-25T18:00:05.000Z',
  notes: 'internal owner note',
  previous_lead_id: 'FIN-QA-0000',
  raw: '{"telegram":"payload"}'
};

// ---------------------------------------------------------- A. canonical projection

console.log('\nA. Canonical projection (INDP2-09 — complete field set)');

check('PROJECTION_FIELDS carries all 15 mirrored fields', () => {
  eq(P.PROJECTION_FIELDS.length, 15, 'field count');
});

check('the four fields the live publish omitted are canonical', () => {
  ['session_id', 'urgency', 'consent_at', 'lead_intake_ok'].forEach((f) => {
    assert(P.PROJECTION_FIELDS.indexOf(f) !== -1, f + ' missing from PROJECTION_FIELDS');
  });
});

check('projection and control field sets are disjoint', () => {
  P.CONTROL_FIELDS.forEach((f) => {
    assert(P.PROJECTION_FIELDS.indexOf(f) === -1, f + ' is both projection and control');
  });
});

check('buildSafeProjection drops raw, notes and previous_lead_id', () => {
  const proj = P.buildSafeProjection(AUTH_ROW);
  eq(Object.keys(proj).length, 15, 'projection width');
  ['notes', 'previous_lead_id', 'raw', 'updated_at'].forEach((f) => {
    assert(!Object.prototype.hasOwnProperty.call(proj, f), f + ' leaked into the projection');
  });
});

check('hash is stable against input key order', () => {
  const a = P.buildSafeProjection(AUTH_ROW);
  const reordered = {};
  Object.keys(a).reverse().forEach((k) => { reordered[k] = a[k]; });
  eq(P.projectionVersion(reordered), P.projectionVersion(a), 'key order changed the hash');
});

check('Sheets string and Data Table boolean hash identically', () => {
  const asString = P.buildSafeProjection(Object.assign({}, AUTH_ROW, { lead_intake_ok: 'true' }));
  const asBool = P.buildSafeProjection(Object.assign({}, AUTH_ROW, { lead_intake_ok: true }));
  eq(P.projectionVersion(asString), P.projectionVersion(asBool), 'type round-trip changed the hash');
});

check('a value cannot forge a field boundary', () => {
  const a = P.buildSafeProjection(Object.assign({}, AUTH_ROW, { state: 'x", "status":"y' }));
  const b = P.buildSafeProjection(Object.assign({}, AUTH_ROW, { state: 'x', status: 'y' }));
  assert(P.projectionVersion(a) !== P.projectionVersion(b), 'separator injection collided');
});

check('every single-field change moves the hash', () => {
  const base = P.buildSafeProjection(AUTH_ROW);
  const baseV = P.projectionVersion(base);
  P.PROJECTION_FIELDS.forEach((f) => {
    const mutated = Object.assign({}, base);
    mutated[f] = String(mutated[f]) + '-CHANGED';
    assert(P.projectionVersion(mutated) !== baseV, 'hash blind to ' + f);
  });
});

// ------------------------------------------------- B. stored-row equality (the defect)

console.log('\nB. Stored-row verification (INDP2-09 — hash the stored row, not the intent)');

// Reconstruct the exact reversed-order failure: the row already holds session_id S-CAS,
// the new generation intends S-GEN-A2, and the publish set omits session_id.
function incompletePublishScenario() {
  const expected = P.buildSafeProjection(Object.assign({}, AUTH_ROW, { session_id: 'S-GEN-A2' }));
  const storedRow = Object.assign({}, expected, {
    session_id: 'S-CAS',
    cache_valid: true,
    sync_token: 'T-COMMIT',
    projection_version: P.projectionVersion(expected),
    source_updated_at: AUTH_ROW.updated_at,
    mirror_updated_at: CLOCK.now()
  });
  return { expected, storedRow };
}

check('the old verifier would have passed this row (regression witness)', () => {
  const s = incompletePublishScenario();
  eq(P.projectionVersion(s.expected), s.storedRow.projection_version,
    'scenario is not the historical false pass');
});

check('the stored-row verifier rejects the omitted session_id', () => {
  const s = incompletePublishScenario();
  const v = P.verifyStoredRow({ rows: [s.storedRow], commitToken: 'T-COMMIT', expected: s.expected });
  eq(v.ok, false, 'incomplete publish accepted');
  eq(v.reason, 'FIELD_MISMATCH', 'wrong rejection reason');
  assert(v.fields.indexOf('session_id') !== -1, 'session_id not named in the diff');
});

check('a row missing mirrored keys entirely is MALFORMED', () => {
  const expected = P.buildSafeProjection(AUTH_ROW);
  const row = Object.assign({}, expected, {
    cache_valid: true, sync_token: 'T', projection_version: P.projectionVersion(expected)
  });
  delete row.urgency;
  delete row.consent_at;
  delete row.lead_intake_ok;
  const v = P.verifyStoredRow({ rows: [row], commitToken: 'T', expected });
  eq(v.ok, false, 'malformed row accepted');
  eq(v.reason, 'MALFORMED_ROW', 'wrong reason');
  eq(v.defects.length, 3, 'defect count');
});

check('a complete correct publish verifies', () => {
  const expected = P.buildSafeProjection(AUTH_ROW);
  const row = Object.assign({}, expected, {
    cache_valid: true, sync_token: 'T', projection_version: P.projectionVersion(expected)
  });
  const v = P.verifyStoredRow({ rows: [row], commitToken: 'T', expected });
  eq(v.ok, true, 'correct publish rejected: ' + v.reason);
});

check('verifier rejects stale token, tombstone, absence, duplicates and read errors', () => {
  const expected = P.buildSafeProjection(AUTH_ROW);
  const good = Object.assign({}, expected, {
    cache_valid: true, sync_token: 'T', projection_version: P.projectionVersion(expected)
  });
  eq(P.verifyStoredRow({ rows: [good], commitToken: 'OTHER', expected }).reason, 'TOKEN_MISMATCH', 'token');
  eq(P.verifyStoredRow({ rows: [Object.assign({}, good, { cache_valid: false })], commitToken: 'T', expected }).reason,
    'NOT_PUBLISHED', 'tombstone');
  eq(P.verifyStoredRow({ rows: [], commitToken: 'T', expected }).reason, 'MISSING_ROW', 'absent');
  eq(P.verifyStoredRow({ rows: [good, good], commitToken: 'T', expected }).reason, 'DUPLICATE_ROWS', 'duplicate');
  eq(P.verifyStoredRow({ rows: [], error: 'ETIMEDOUT', commitToken: 'T', expected }).reason,
    'DATA_TABLE_ERROR', 'read error');
});

check('a stored row whose hash column was tampered is rejected', () => {
  const expected = P.buildSafeProjection(AUTH_ROW);
  const row = Object.assign({}, expected, {
    cache_valid: true, sync_token: 'T', projection_version: 'deadbeef'
  });
  eq(P.verifyStoredRow({ rows: [row], commitToken: 'T', expected }).reason, 'VERSION_MISMATCH', 'hash column');
});

// ------------------------------------------------------- C. fast read fallback matrix

console.log('\nC. Fast read fallback matrix (INDP2-10)');

function validStoredRow(overrides) {
  const expected = P.buildSafeProjection(Object.assign({}, AUTH_ROW, overrides || {}));
  return Object.assign({}, expected, {
    cache_valid: true,
    sync_token: 'T',
    projection_version: P.projectionVersion(expected),
    source_updated_at: AUTH_ROW.updated_at,
    mirror_updated_at: CLOCK.now()
  });
}

check('exactly one valid row is a HIT', () => {
  eq(P.evaluateFastRead({ rows: [validStoredRow()] }).decision, 'HIT', 'valid row');
});

check('MISS falls back', () => {
  eq(P.evaluateFastRead({ rows: [] }).reason, 'MISS', 'zero rows');
});

check('tombstone falls back and is never read as state', () => {
  const r = P.evaluateFastRead({ rows: [Object.assign(validStoredRow(), { cache_valid: false })] });
  eq(r.decision, 'FALLBACK', 'tombstone read as HIT');
  eq(r.reason, 'TOMBSTONE', 'reason');
});

check('duplicate rows fall back and never pick an arbitrary first row', () => {
  const r = P.evaluateFastRead({ rows: [validStoredRow(), validStoredRow({ session_id: 'S-OTHER' })] });
  eq(r.decision, 'FALLBACK', 'duplicates accepted');
  eq(r.reason, 'DUPLICATE_ROWS', 'reason');
  assert(!r.projection, 'a projection was returned despite duplicates');
});

check('limit 2 is load-bearing: the same pair under limit 1 would have been a HIT', () => {
  const pair = [validStoredRow(), validStoredRow({ session_id: 'S-OTHER' })];
  eq(P.evaluateFastRead({ rows: pair.slice(0, 1) }).decision, 'HIT', 'limit-1 control');
  eq(P.evaluateFastRead({ rows: pair.slice(0, 2) }).decision, 'FALLBACK', 'limit-2 detection');
});

check('Data Table outage falls back', () => {
  eq(P.evaluateFastRead({ rows: [], error: 'ECONNRESET' }).reason, 'DATA_TABLE_ERROR', 'outage');
});

check('malformed and empty-key rows fall back', () => {
  const missing = validStoredRow();
  delete missing.consent_at;
  eq(P.evaluateFastRead({ rows: [missing] }).reason, 'MALFORMED_ROW', 'missing field');
  eq(P.evaluateFastRead({ rows: [Object.assign(validStoredRow(), { chat_id: '' })] }).reason,
    'MALFORMED_ROW', 'empty chat_id');
  eq(P.evaluateFastRead({ rows: [Object.assign(validStoredRow(), { notes: 'leaked' })] }).reason,
    'MALFORMED_ROW', 'forbidden mirrored field');
});

check('a silently mutated stored field falls back on the hash', () => {
  const r = P.evaluateFastRead({ rows: [Object.assign(validStoredRow(), { lead_id: 'FIN-TAMPERED' })] });
  eq(r.reason, 'VERSION_MISMATCH', 'tampered field served as a HIT');
});

// ------------------------------------------------------------ D. zero-write resume

console.log('\nD. Zero-write resume (INDP2-03)');

check('a cache HIT performs no write of any kind', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW });
  dt.rows.push(validStoredRow());
  const out = M.resolveResume({ chatId: '900000001', dt, authority: auth });
  eq(out.resume_source, 'read_model', 'source');
  eq(dt.stats.writes, 0, 'data table writes');
  eq(auth.stats.writes, 0, 'authority writes');
  eq(out.cycle_created, false, 'cycle_created');
  eq(out.cycle_reset, 'none', 'cycle_reset');
});

check('every fallback class resumes without writing', () => {
  const cases = [
    ['MISS', (dt) => { /* empty table */ }],
    ['TOMBSTONE', (dt) => { dt.rows.push(Object.assign(validStoredRow(), { cache_valid: false })); }],
    ['DUPLICATE_ROWS', (dt) => { dt.rows.push(validStoredRow(), validStoredRow({ session_id: 'S-X' })); }],
    ['MALFORMED_ROW', (dt) => { const r = validStoredRow(); delete r.urgency; dt.rows.push(r); }],
    ['DATA_TABLE_ERROR', (dt) => { dt.readError = 'ETIMEDOUT'; }]
  ];
  cases.forEach(([expectedReason, setup]) => {
    const dt = makeDataTable();
    const auth = makeAuthority({ '900000001': AUTH_ROW });
    setup(dt);
    const out = M.resolveResume({ chatId: '900000001', dt, authority: auth });
    eq(out.fallback_reason, expectedReason, 'fallback reason for ' + expectedReason);
    eq(out.resume_source, 'authoritative', 'source for ' + expectedReason);
    eq(dt.stats.writes, 0, 'data table writes during ' + expectedReason);
    eq(auth.stats.writes, 0, 'authority writes during ' + expectedReason);
  });
});

check('resume never returns identity or control metadata to the browser', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW });
  dt.rows.push(validStoredRow());
  const hit = M.resolveResume({ chatId: '900000001', dt, authority: auth });
  const fallback = M.resolveResume({ chatId: '900000002', dt, authority: makeAuthority({ '900000002': AUTH_ROW }) });
  eq(JSON.stringify(P.leakFields(hit)), '[]', 'leak on HIT: ' + P.leakFields(hit).join(','));
  eq(JSON.stringify(P.leakFields(fallback)), '[]', 'leak on fallback: ' + P.leakFields(fallback).join(','));
});

check('resume cannot be steered to another chat by browser fields', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW, '900000002': Object.assign({}, AUTH_ROW, { chat_id: '900000002', lead_id: 'FIN-QA-0002' }) });
  // resolveResume takes chatId only; any browser-supplied identity is structurally absent.
  const out = M.resolveResume({
    chatId: '900000001', dt, authority: auth,
    telegram_user_id: '900000002', cycle_id: 'C-FORGED', lead_id: 'FIN-QA-0002', consent: 'yes'
  });
  eq(out.ok, true, 'resume failed');
  eq(P.leakFields(out).length, 0, 'identity leaked');
  eq(auth.store['900000002'].lead_id, 'FIN-QA-0002', 'foreign row mutated');
});

// ------------------------------------------------------------- E. cycle evaluation

console.log('\nE. Read-only cycle evaluation');

check('blank cycle_id never validates a blank consent or lead binding', () => {
  const c = P.evaluateCycle({ cycle_id: '', consent: 'yes', consent_cycle_id: '', lead_id: 'FIN-1', lead_cycle_id: '' });
  eq(c.consent_current, false, 'blank cycle validated consent');
  eq(c.lead_current, false, 'blank cycle validated lead');
});

check('consent and lead from a previous cycle are not current', () => {
  const c = P.evaluateCycle({
    cycle_id: 'C-200', consent: 'yes', consent_cycle_id: 'C-100',
    lead_id: 'FIN-1', lead_cycle_id: 'C-100'
  });
  eq(c.consent_current, false, 'stale consent accepted');
  eq(c.lead_current, false, 'stale lead accepted');
});

check('current-cycle consent and lead validate', () => {
  const c = P.evaluateCycle(P.buildSafeProjection(AUTH_ROW));
  eq(c.consent_current, true, 'current consent rejected');
  eq(c.lead_current, true, 'current lead rejected');
});

// ------------------------------------------------------------- F. concurrency

console.log('\nF. Commit-order concurrency (INDP2-10)');

function freshWorld() {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW });
  return { dt, auth };
}

check('normal completion order: the later commit owns the cache', () => {
  const { dt, auth } = freshWorld();
  M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('A'), clock: CLOCK, patch: { session_id: 'S-A', state: 'a' } });
  const b = M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('B'), clock: CLOCK, patch: { session_id: 'S-B', state: 'b' } });
  eq(b.ok, true, 'B failed: ' + b.reason);
  eq(dt.rows.length, 1, 'row count');
  eq(dt.rows[0].session_id, 'S-B', 'final session_id');
});

check('TOCTOU: a helper paused before publish updates zero rows', () => {
  const { dt, auth } = freshWorld();
  let bResult = null;
  const a = M.runMirrorGeneration({
    chatId: '900000001', dt, authority: auth, tokens: makeTokens('A'), clock: CLOCK,
    patch: { session_id: 'S-A', state: 'a' },
    hooks: {
      beforePublish: () => {
        // GEN_B runs start-to-finish inside GEN_A's window between re-read and publish.
        bResult = M.runMirrorGeneration({
          chatId: '900000001', dt, authority: auth, tokens: makeTokens('B'), clock: CLOCK,
          patch: { session_id: 'S-B', state: 'b' }
        });
      }
    }
  });
  eq(bResult.ok, true, 'B failed: ' + (bResult && bResult.reason));
  eq(a.ok, false, 'stale generation published');
  eq(a.reason, 'ABORTED_CAS_MISMATCH', 'wrong abort reason');
  eq(dt.rows.length, 1, 'row count after race');
  eq(dt.rows[0].session_id, 'S-B', 'stale generation overwrote the newer one');
});

check('reversed completion order: the cache converges on the last authoritative commit', () => {
  const { dt, auth } = freshWorld();
  let bResult = null;
  // A starts first; B starts second and completes its commit and publish first; A commits
  // last. The final cache must follow A, not workflow start order.
  const a = M.runMirrorGeneration({
    chatId: '900000001', dt, authority: auth, tokens: makeTokens('A2'), clock: CLOCK,
    patch: { session_id: 'S-GEN-A2', state: 'a2' },
    hooks: {
      afterPreInvalidate: () => {
        bResult = M.runMirrorGeneration({
          chatId: '900000001', dt, authority: auth, tokens: makeTokens('B2'), clock: CLOCK,
          patch: { session_id: 'S-GEN-B2', state: 'b2' }
        });
      }
    }
  });
  eq(bResult.ok, true, 'B2 failed: ' + (bResult && bResult.reason));
  eq(a.ok, true, 'A2 failed: ' + a.reason + ' ' + JSON.stringify(a.fields || a.defects || ''));
  eq(dt.rows.length, 1, 'row count');
  // The equality claim the live run could not make: field-by-field, from the stored row.
  const stored = P.stripStoredRow(dt.rows[0]);
  const expected = P.buildSafeProjection(auth.read('900000001').row);
  eq(P.diffProjections(expected, stored).length, 0,
    'stored row differs from final authority: ' + P.diffProjections(expected, stored).join(','));
  eq(dt.rows[0].session_id, 'S-GEN-A2', 'session_id did not converge');
  eq(P.projectionVersion(stored), dt.rows[0].projection_version, 'stored hash mismatch');
});

check('an incomplete publish set is caught by the helper, not published as valid', () => {
  const { dt, auth } = freshWorld();
  // Seed a valid row carrying the old session_id, then publish a set that omits it.
  M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('S'), clock: CLOCK, patch: { session_id: 'S-CAS' } });
  eq(dt.rows[0].session_id, 'S-CAS', 'seed failed');
  dt.publishOnly = P.PROJECTION_FIELDS.filter((f) => f !== 'session_id').concat(P.CONTROL_FIELDS);
  const gen = M.runMirrorGeneration({
    chatId: '900000001', dt, authority: auth, tokens: makeTokens('A2'), clock: CLOCK,
    patch: { session_id: 'S-GEN-A2' }
  });
  eq(gen.ok, false, 'incomplete publish reported success');
  eq(gen.verify_reason, 'FIELD_MISMATCH', 'wrong verify reason');
  eq(dt.rows.length, 0, 'the unverifiable row was left readable');
});

check('post-race replay is idempotent and leaves exactly one row', () => {
  const { dt, auth } = freshWorld();
  const first = M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('R1'), clock: CLOCK, patch: { session_id: 'S-R' } });
  const second = M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('R2'), clock: CLOCK, patch: { session_id: 'S-R' } });
  eq(first.ok && second.ok, true, 'replay failed');
  eq(dt.rows.length, 1, 'row count after replay');
  eq(first.projection_version, second.projection_version, 'identical replay changed the version');
});

// --------------------------------------------------- G. failure invalidation

console.log('\nG. Failure invalidation from an existing valid row');

check('a failed publish cannot leave the old row readable as a HIT', () => {
  const { dt, auth } = freshWorld();
  M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('OLD'), clock: CLOCK, patch: { session_id: 'S-OLD' } });
  eq(P.evaluateFastRead({ rows: dt.read('900000001', 2).rows }).decision, 'HIT', 'precondition: old row valid');

  dt.failPublish = true;
  const gen = M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('NEW'), clock: CLOCK, patch: { session_id: 'S-NEW' } });
  eq(gen.ok, false, 'failed publish reported success');
  eq(gen.reason, 'PUBLISH_FAILED', 'reason');
  const after = P.evaluateFastRead({ rows: dt.read('900000001', 2).rows });
  eq(after.decision, 'FALLBACK', 'stale row survived a failed publish as a HIT');
});

check('a verification mismatch from an existing readable row invalidates it', () => {
  const { dt, auth } = freshWorld();
  M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('OLD'), clock: CLOCK, patch: { session_id: 'S-OLD' } });
  dt.publishOnly = P.PROJECTION_FIELDS.filter((f) => f !== 'lead_intake_ok').concat(P.CONTROL_FIELDS);
  const gen = M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('NEW'), clock: CLOCK, patch: { session_id: 'S-NEW', lead_intake_ok: false } });
  eq(gen.ok, false, 'mismatch accepted');
  eq(P.evaluateFastRead({ rows: dt.read('900000001', 2).rows }).decision, 'FALLBACK', 'row survived verification failure');
});

check('a failed authoritative write never publishes the attempted projection', () => {
  const { dt, auth } = freshWorld();
  M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('OLD'), clock: CLOCK, patch: { session_id: 'S-OLD' } });
  auth.failWrite = true;
  const gen = M.runMirrorGeneration({ chatId: '900000001', dt, authority: auth, tokens: makeTokens('BAD'), clock: CLOCK, patch: { session_id: 'S-NEVER' } });
  eq(gen.reason, 'AUTHORITATIVE_WRITE_FAILED', 'reason');
  eq(gen.published, false, 'published on authoritative failure');
  const rows = dt.read('900000001', 2).rows;
  assert(rows.length === 0 || P.normValue(rows[0].cache_valid) !== 'true', 'tombstone was not left');
  assert(!rows.length || rows[0].session_id !== 'S-NEVER', 'attempted projection was published');
  eq(auth.read('900000001').row.session_id, 'S-OLD', 'authority mutated on a failed write');
});

// ------------------------------------------------ H. backfill and reconciliation

console.log('\nH. Backfill and reconciliation');

check('backfill publishes a missing row without touching authority', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW });
  const r = M.runBackfill({ dt, authority: auth, chatIds: ['900000001'], tokens: makeTokens('BF'), clock: CLOCK });
  eq(r.published, 1, 'published count');
  eq(auth.stats.writes, 0, 'backfill wrote to authority');
  eq(dt.rows.length, 1, 'row count');
});

check('a second backfill run is a no-op', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW });
  M.runBackfill({ dt, authority: auth, chatIds: ['900000001'], tokens: makeTokens('BF1'), clock: CLOCK });
  const before = dt.stats.publishes;
  const second = M.runBackfill({ dt, authority: auth, chatIds: ['900000001'], tokens: makeTokens('BF2'), clock: CLOCK });
  eq(second.skipped, 1, 'second run did not skip');
  eq(second.published, 0, 'second run republished');
  eq(dt.stats.publishes, before, 'second run issued a publish');
  eq(dt.rows.length, 1, 'row count');
});

check('backfill repairs duplicate rows down to exactly one', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({ '900000001': AUTH_ROW });
  dt.rows.push(validStoredRow(), validStoredRow({ session_id: 'S-DUP' }));
  const r = M.runBackfill({ dt, authority: auth, chatIds: ['900000001'], tokens: makeTokens('BF'), clock: CLOCK });
  eq(r.duplicates, 1, 'duplicate not detected');
  eq(dt.rows.length, 1, 'row count after repair');
  eq(P.evaluateFastRead({ rows: dt.read('900000001', 2).rows }).decision, 'HIT', 'repaired row is not readable');
});

check('reconciliation planning classifies drift and writes nothing at all', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({
    '1': Object.assign({}, AUTH_ROW, { chat_id: '1' }),
    '2': Object.assign({}, AUTH_ROW, { chat_id: '2' }),
    '3': Object.assign({}, AUTH_ROW, { chat_id: '3' }),
    '4': Object.assign({}, AUTH_ROW, { chat_id: '4' })
  });
  dt.rows.push(validStoredRow({ chat_id: '1' }));
  dt.rows.push(Object.assign(validStoredRow({ chat_id: '2' }), { cache_valid: false }));
  dt.rows.push(validStoredRow({ chat_id: '3', session_id: 'S-STALE' }));
  const dtWritesBefore = dt.stats.writes;
  const r = M.planReconciliation({ dt, authority: auth, chatIds: ['1', '2', '3', '4'] });
  const byChat = {};
  r.findings.forEach((f) => { byChat[f.chat_id] = f.class; });
  eq(byChat['1'], 'CURRENT', 'current row misclassified');
  eq(byChat['2'], 'TOMBSTONE', 'tombstone misclassified');
  eq(byChat['3'], 'STALE', 'stale row misclassified');
  eq(byChat['4'], 'MISS', 'miss misclassified');
  eq(r.writes.authority_writes, 0, 'reconciliation wrote to authority');
  eq(auth.stats.writes, 0, 'authority mutated');
  // G4 -- the claim is that it writes NOTHING, so the Data Table is checked too. The old
  // assertion only covered authority, which is how a "repairs by republishing" comment
  // survived over a function that never republished anything.
  eq(r.writes.data_table_writes, 0, 'reconciliation reported a Data Table write');
  eq(dt.stats.writes - dtWritesBefore, 0, 'reconciliation mutated the Data Table');
  eq(r.repair_performed, false, 'reconciliation claimed to have repaired something');
});

check('reconciliation names the repair each class would need without performing it', () => {
  const dt = makeDataTable();
  const auth = makeAuthority({
    '1': Object.assign({}, AUTH_ROW, { chat_id: '1' }),
    '2': Object.assign({}, AUTH_ROW, { chat_id: '2' })
  });
  dt.rows.push(validStoredRow({ chat_id: '1' }));
  const r = M.planReconciliation({ dt, authority: auth, chatIds: ['1', '2'] });
  const byChat = {};
  r.findings.forEach((f) => { byChat[f.chat_id] = f; });
  eq(byChat['1'].repair_action, 'NONE', 'a current row was given work to do');
  eq(byChat['2'].repair_action, 'REPUBLISH', 'a missing row was not planned for republish');
  // Every finding must carry a named action, so a class can never be silently unhandled.
  r.findings.forEach((f) => {
    assert(typeof f.repair_action === 'string' && f.repair_action.length > 0,
      'finding ' + f.class + ' carries no repair_action');
    assert(!Object.prototype.hasOwnProperty.call(f, 'repaired'),
      'finding ' + f.class + ' still carries the misleading repaired flag');
  });
  eq(M.REPAIR_ACTIONS.DUPLICATE, 'REMOVE_THEN_REPUBLISH', 'duplicate repair action drifted');
});

// ---------------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
