// FINMENTOR — Mini App read-model mirror helper (B.2.1-B, Phase 10).
//
// The commit-order generation sequence, written once and shared by every caller so the
// offline gate and any live QA run exercise the identical code path. The Data Table and
// Bot_Sessions are injected, never imported: offline the gate passes deterministic fakes,
// live the n8n nodes pass real clients.
//
// Why two token phases (this is the part a start-order token gets wrong):
//   Mutation A starts before B but its authoritative commit lands after B's. A start-order
//   token would treat B as the newer generation even though A is the final authority. The
//   publish token is therefore issued only AFTER a successful authoritative commit, so the
//   last successful commit owns the newest cache generation.
//
// Publish is a single conditional update matching chat_id AND sync_token. A read-then-
// upsert is not equivalent: another generation can invalidate between the two operations.
//
// Injected contracts:
//   dt.read(chatId, limit)            -> { rows, error }
//   dt.setTombstone(chatId, token)    -> { ok }                 cache_valid=false + token
//   dt.publish({chatId, token, row})  -> { ok, updated_rows }   conditional CAS
//   dt.remove(chatId)                 -> { ok, removed }
//   authority.write(chatId, patch)    -> { ok }
//   authority.read(chatId)            -> { ok, row }

const P = require('./projection.js');

const READ_LIMIT = 2;

function nowIso(clock) {
  return clock && typeof clock.now === 'function' ? clock.now() : new Date().toISOString();
}

// Run one mirrored-write generation. hooks.beforePublish lets a concurrency test interleave
// a competing generation inside the real TOCTOU window; production passes no hooks.
function runMirrorGeneration(opts) {
  const o = opts || {};
  const chatId = String(o.chatId);
  const dt = o.dt;
  const authority = o.authority;
  const tokens = o.tokens;
  const hooks = o.hooks || {};
  const steps = [];

  // 1 — pre-write invalidation. Any concurrent reader now falls back to authority.
  const startToken = tokens.next();
  dt.setTombstone(chatId, startToken);
  steps.push('PRE_INVALIDATED');
  // Concurrency hook: lets a test land a competing generation's whole lifecycle before this
  // one reaches its authoritative commit, which is how reversed commit order is modelled.
  if (typeof hooks.afterPreInvalidate === 'function') { hooks.afterPreInvalidate(); }

  // 2 — the authoritative write. This is the only place state actually commits.
  // Backfill and reconciliation set skipAuthoritativeWrite: they mirror a commit that has
  // already happened and must never write to Bot_Sessions themselves.
  if (o.skipAuthoritativeWrite) {
    steps.push('AUTHORITATIVE_UNCHANGED');
  } else {
    const written = authority.write(chatId, o.patch || {});
    if (!written || !written.ok) {
      // Never publish an attempted projection. The tombstone stays; readers use authority.
      steps.push('AUTHORITATIVE_FAILED');
      return { ok: false, reason: 'AUTHORITATIVE_WRITE_FAILED', steps: steps, published: false };
    }
    steps.push('AUTHORITATIVE_COMMITTED');
  }

  // 3 — the generation token, issued after the commit, not before it.
  const commitToken = tokens.next();
  dt.setTombstone(chatId, commitToken);
  steps.push('COMMIT_TOKEN_ISSUED');

  // 4 — re-read the row that is actually there. The pre-write payload is not evidence.
  const auth = authority.read(chatId);
  if (!auth || !auth.ok || !auth.row) {
    dt.remove(chatId);
    steps.push('AUTHORITATIVE_REREAD_FAILED');
    return { ok: false, reason: 'AUTHORITATIVE_REREAD_FAILED', steps: steps, published: false };
  }
  const expected = P.buildSafeProjection(auth.row);
  const version = P.projectionVersion(expected);

  if (typeof hooks.beforePublish === 'function') { hooks.beforePublish(); }

  // 5 — conditional publish of the COMPLETE projection. Every mirrored field is written,
  // which is the fix for the omitted session_id / urgency / consent_at / lead_intake_ok.
  const row = {};
  for (let i = 0; i < P.PROJECTION_FIELDS.length; i++) {
    const f = P.PROJECTION_FIELDS[i];
    row[f] = expected[f];
  }
  row.cache_valid = true;
  row.sync_token = commitToken;
  row.projection_version = version;
  row.source_updated_at = P.normValue(auth.row.updated_at);
  row.mirror_updated_at = nowIso(o.clock);

  const pub = dt.publish({ chatId: chatId, token: commitToken, row: row });
  if (!pub || !pub.ok) {
    // A failed publish must not leave an older cache_valid row readable as a HIT.
    dt.remove(chatId);
    steps.push('PUBLISH_ERROR_INVALIDATED');
    return { ok: false, reason: 'PUBLISH_FAILED', steps: steps, published: false, commitToken: commitToken };
  }
  if (pub.updated_rows === 0) {
    // A later generation owns the row. Abort without publishing and without deleting:
    // the newer generation's row is the correct state.
    steps.push('ABORTED_CAS_MISMATCH');
    return { ok: false, reason: 'ABORTED_CAS_MISMATCH', steps: steps, published: false, commitToken: commitToken };
  }
  steps.push('PUBLISHED');

  // 6 — read-back verification from the stored row, limit 2 so duplicates are visible.
  const back = dt.read(chatId, READ_LIMIT);
  const verdict = P.verifyStoredRow({
    rows: back.rows,
    error: back.error,
    commitToken: commitToken,
    expected: expected
  });
  if (!verdict.ok) {
    dt.remove(chatId);
    steps.push('VERIFY_FAILED_INVALIDATED');
    return {
      ok: false,
      reason: 'VERIFY_FAILED',
      verify_reason: verdict.reason,
      fields: verdict.fields,
      defects: verdict.defects,
      steps: steps,
      published: false,
      commitToken: commitToken
    };
  }
  steps.push('VERIFIED');
  return {
    ok: true,
    reason: 'MIRRORED',
    steps: steps,
    published: true,
    commitToken: commitToken,
    projection_version: verdict.projection_version,
    projection: verdict.projection
  };
}

// Mini App resume. Fast path first, authoritative fallback on anything that is not exactly
// one verified row. Performs zero writes on every branch, including repair-worthy states:
// repair is the mirror helper's job, not the read path's.
function resolveResume(opts) {
  const o = opts || {};
  const chatId = String(o.chatId);
  const dt = o.dt;
  const authority = o.authority;

  const fast = dt.read(chatId, READ_LIMIT);
  const decision = P.evaluateFastRead({ rows: fast.rows, error: fast.error });

  if (decision.decision === 'HIT') {
    const out = P.buildClientResume(decision.projection, 'read_model');
    out.fallback_reason = null;
    return out;
  }

  const auth = authority.read(chatId);
  if (!auth || !auth.ok || !auth.row) {
    return {
      ok: false,
      error_code: 'TEMPORARY_BACKEND_ERROR',
      retryable: true,
      resume_source: 'authoritative',
      fallback_reason: decision.reason,
      writes: { sheets_writes: 0, data_table_writes: 0, lead_intake_calls: 0, consent_writes: 0 }
    };
  }
  const out = P.buildClientResume(P.buildSafeProjection(auth.row), 'authoritative');
  out.fallback_reason = decision.reason;
  return out;
}

// One-time backfill. Idempotent, duplicate-safe, authority-first. A chat whose derived row
// already verifies against authority is skipped rather than rewritten, so a second run
// changes nothing.
function runBackfill(opts) {
  const o = opts || {};
  const dt = o.dt;
  const authority = o.authority;
  const chatIds = o.chatIds || [];
  const result = { scanned: 0, skipped: 0, repaired: 0, published: 0, duplicates: 0, failed: 0, details: [] };

  for (let i = 0; i < chatIds.length; i++) {
    const chatId = String(chatIds[i]);
    result.scanned++;
    const auth = authority.read(chatId);
    if (!auth || !auth.ok || !auth.row) {
      result.failed++;
      result.details.push({ chat_id: chatId, action: 'SKIPPED_NO_AUTHORITY' });
      continue;
    }
    const expected = P.buildSafeProjection(auth.row);
    const current = dt.read(chatId, READ_LIMIT);

    if (!current.error && current.rows.length === 1) {
      const row = current.rows[0];
      const stored = P.stripStoredRow(row);
      const clean = P.storedRowDefects(row).length === 0;
      const same = clean && P.diffProjections(expected, stored).length === 0;
      const hashOk = clean && P.projectionVersion(stored) === P.normValue(row.projection_version);
      if (same && hashOk && P.normValue(row.cache_valid) === 'true') {
        result.skipped++;
        result.details.push({ chat_id: chatId, action: 'ALREADY_CURRENT' });
        continue;
      }
    }
    if (!current.error && current.rows.length > 1) {
      // Duplicate corruption: remove every row, then republish exactly one.
      result.duplicates++;
      dt.remove(chatId);
    }

    const gen = runMirrorGeneration({
      chatId: chatId,
      dt: dt,
      authority: authority,
      tokens: o.tokens,
      clock: o.clock,
      skipAuthoritativeWrite: true
    });
    if (gen.ok) {
      result.published++;
      result.details.push({ chat_id: chatId, action: 'PUBLISHED' });
    } else {
      result.failed++;
      result.details.push({ chat_id: chatId, action: 'FAILED', reason: gen.reason });
    }
  }
  return result;
}

// Reconciliation PLANNING. This function classifies drift between authority and the read
// model and returns a plan. It performs no writes of any kind -- not to Bot_Sessions, not
// to the Data Table -- and it never promotes the read model to authority.
//
// It was previously named `reconcile` and its comment claimed it "repairs by republishing".
// It never did: every branch returned `repaired: false` and no write client was ever called.
// The name and the prose were corrected rather than the behaviour, because classification
// is the behaviour that is actually wanted here -- an unattended repairer that writes to the
// derived table on a schedule is precisely what Phase 10's stop conditions prohibit, and it
// would re-open the reconciliation/submit race (threat T37).
//
// Each finding carries `repair_action`: the operation a human or an explicitly-approved
// repair pass WOULD perform. Naming the action without performing it is the point.
//
// The only repair path that exists in this module is `runBackfill`, which is deliberate,
// manual and authority-first.
// The repair each drift class WOULD require. Named here, executed nowhere.
const REPAIR_ACTIONS = {
  NO_AUTHORITY: 'NONE_INVESTIGATE',   // no authoritative row: a data question, not a cache one
  READ_ERROR: 'NONE_RETRY_LATER',     // transient; classifying again later is the whole fix
  MISS: 'REPUBLISH',                  // runBackfill would publish the absent row
  DUPLICATE: 'REMOVE_THEN_REPUBLISH', // runBackfill removes every row, then publishes one
  TOMBSTONE: 'REPUBLISH',             // an invalidated row awaiting its next generation
  MALFORMED: 'REMOVE_THEN_REPUBLISH',
  VERSION_MISMATCH: 'REMOVE_THEN_REPUBLISH',
  STALE: 'REPUBLISH',
  CURRENT: 'NONE'                     // nothing to do, and saying so is a finding
};

function finding(chatId, cls, fields) {
  const out = { chat_id: chatId, class: cls, repair_action: REPAIR_ACTIONS[cls] || 'NONE' };
  if (fields && fields.length) { out.fields = fields; }
  return out;
}

function planReconciliation(opts) {
  const o = opts || {};
  const dt = o.dt;
  const authority = o.authority;
  const chatIds = o.chatIds || [];
  const findings = [];

  for (let i = 0; i < chatIds.length; i++) {
    const chatId = String(chatIds[i]);
    const auth = authority.read(chatId);
    const current = dt.read(chatId, READ_LIMIT);
    if (!auth || !auth.ok || !auth.row) {
      findings.push(finding(chatId, 'NO_AUTHORITY'));
      continue;
    }
    const expected = P.buildSafeProjection(auth.row);

    if (current.error) { findings.push(finding(chatId, 'READ_ERROR')); continue; }
    if (current.rows.length === 0) { findings.push(finding(chatId, 'MISS')); continue; }
    if (current.rows.length > 1) { findings.push(finding(chatId, 'DUPLICATE')); continue; }

    const row = current.rows[0];
    if (P.normValue(row.cache_valid) !== 'true') {
      findings.push(finding(chatId, 'TOMBSTONE'));
      continue;
    }
    const defects = P.storedRowDefects(row);
    if (defects.length) { findings.push(finding(chatId, 'MALFORMED')); continue; }

    const stored = P.stripStoredRow(row);
    if (P.projectionVersion(stored) !== P.normValue(row.projection_version)) {
      findings.push(finding(chatId, 'VERSION_MISMATCH'));
      continue;
    }
    const diff = P.diffProjections(expected, stored);
    if (diff.length) { findings.push(finding(chatId, 'STALE', diff)); continue; }
    findings.push(finding(chatId, 'CURRENT'));
  }
  // Stated in the return value rather than left to be inferred from an absence of calls.
  return {
    findings: findings,
    repair_performed: false,
    writes: { authority_writes: 0, data_table_writes: 0 }
  };
}

module.exports = {
  READ_LIMIT,
  runMirrorGeneration,
  resolveResume,
  runBackfill,
  REPAIR_ACTIONS,
  planReconciliation
};
