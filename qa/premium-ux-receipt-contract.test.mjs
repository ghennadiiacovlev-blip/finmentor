#!/usr/bin/env node
// FINMENTOR — the caller-side receipt preallocation contract, EXECUTED.
//
//   node qa/premium-ux-receipt-contract.test.mjs
//
// Offline. Walks the resolved submit graph node by node against a world whose Submission_Receipts
// behaves like the real one: an n8n Data Table with NO unique constraint and no conditional insert,
// where two inserts of one key both succeed and neither errors.
//
// ── WHY THIS GATE EXISTS ───────────────────────────────────────────────────────────────────────
//
// Lead Intake contains no INSERT into Submission_Receipts. Every one of its receipt writes —
// Receipt Claim, Receipt Commit (New), Receipt Commit (Merge), Receipt Retry Settlement — is an
// UPDATE filtered on submission_key plus a commit_state, and Receipt Read Verdict treats a missing
// row as RECEIPT_ABSENT_INVARIANT_BROKEN: "a missing row is a broken invariant, not permission to
// proceed."
//
// The Telegram Concierge satisfies that contract with Receipt Preallocate. The Mini App did not,
// which is why the second real submit reached the receipt gate and was correctly refused. Lead
// Intake is right and stays fail-closed; the caller is what changed.
//
// ── THE INVARIANT ──────────────────────────────────────────────────────────────────────────────
//
//     ONE submission_key
//       = at most ONE receipt row
//       = at most ONE committed lead
//       = at most ONE Pipeline row
//
// asserted as a property over retries and interruption points, never as a single happy path.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadResolvedSubmit, makeWorld, runSubmit } from './lib/submit-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const M = await import('../scripts/build-premium-endpoints.mjs');

let pass = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const WF = loadResolvedSubmit(M, {});
const SID = 'AS-' + 'a'.repeat(64);
const OWNER = '551662084';
const ACK = {
  notice_version: 'pn-2026-08', locale: 'ru',
  shown_at: '2026-08-30T10:00:00.000Z', acknowledged_at: '2026-08-30T10:00:01.000Z'
};
const bodyFor = (id) => ({ app_session_id: id, privacy_ack: ACK });

function completeDraft() {
  const o = B.OBJECTIVES[0];
  const f = (v, source) => ({ value: v, source: source || 'user_explicit', confirmed: true, at: '2026-08-30T09:00:00.000Z' });
  const fields = {
    company_name: f('Alfa Grup'), business_activity: f('Розничная сеть'), role: f('Собственник'),
    turnover_band: f(B.SCALE_OPTIONS[2]), objective: f(o.label),
    desired_outcome: f(B.OUTCOMES[o.id].options[0][0]),
    current_setup: f([B.CURRENT_SETUP.options[0]]),
    decision_horizon: f(B.DECISION_HORIZON.options[0][0]),
    contact_channel: f('telegram', 'telegram_carried'),
    locale: f('ru', 'telegram_carried'), contact_name: f('Ghennadi', 'telegram_carried')
  };
  if (B.isFreeTextProblem(o.id)) { fields.problem_free_text = f('Не вижу прибыли по направлениям.'); }
  else { fields.problem = f(B.PROBLEMS[o.id].options[0][0]); }
  return { v: 1, step: 'APP_REVIEW', updated_at: '2026-08-30T09:00:00.000Z', fields: fields };
}
const sessionRow = (id, over) => Object.assign({
  app_session_id: id, telegram_user_id: OWNER, chat_id: OWNER, cycle_id: '',
  replay_key: 'rk', state: 'draft', created_at: '2026-08-30T09:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z', updated_at: '2026-08-30T09:00:00.000Z',
  draft_json: JSON.stringify(completeDraft()), lead_id: ''
}, over || {});

const world = (over) => makeWorld(Object.assign({ sessions: [sessionRow(SID)] }, over || {}));
const run = (w, faults) => runSubmit(WF, w, bodyFor(SID), faults);
const keyOf = (r) => r.outputs['Submit State'][0].submission_key;

// Every scenario ends here. The invariant is a property of the WORLD, not of one response.
function exactlyOnce(w, label) {
  assert(w.privacy.length <= 1, label + ': privacy rows = ' + w.privacy.length);
  assert(w.receipts.length <= 1, label + ': receipt rows = ' + w.receipts.length);
  assert(w.pipeline.length <= 1, label + ': Pipeline rows = ' + w.pipeline.length);
  const leads = new Set(w.pipeline.map((p) => p.lead_id));
  assert(leads.size <= 1, label + ': distinct lead ids = ' + leads.size);
}

console.log('\nPremium UX — receipt preallocation contract, executed\n');

// ── the contract, read off the graph ──────────────────────────────────────────────────────────

check('the preallocated row is the Concierge row: same store, same eleven columns, same values', () => {
  const n = WF.nodes.find((x) => x.name === 'Preallocate Receipt');
  assert(n, 'Preallocate Receipt is missing');
  eq(n.parameters.operation, 'insert', 'operation');
  eq(n.parameters.dataTableId.value, 'Submission_Receipts', 'store');
  const v = n.parameters.columns.value;
  eq(Object.keys(v).length, 11, 'column count');
  eq(v.commit_state, 'READY', 'initial state');
  ['canonical_lead_id', 'lead_mode', 'lead_priority', 'financial_zone',
    'claimed_at', 'settled_at', 'abort_reason', 'correlation_id'].forEach((f) => {
    eq(v[f], '', f + ' must start empty');
  });
  assert(/Submit State.*submission_key/.test(v.submission_key), 'the key must come from Submit State');
  assert(/\$now\.toISO\(\)/.test(v.created_at), 'created_at must be stamped');
});

check('no Lead Intake call is reachable except through a proven receipt', () => {
  const into = [];
  for (const [src, c] of Object.entries(WF.connections)) {
    (c.main || []).forEach((br) => (br || []).forEach((t) => {
      if (t.node === 'Build Intake Payload') { into.push(src); }
    }));
  }
  eq(into.length, 1, 'nodes feeding Build Intake Payload');
  eq(into[0], 'IF Receipt Present', 'the only way in is the receipt verdict');
});

check('the ordering is privacy -> receipt -> intake, not any other permutation', () => {
  const w = world();
  const r = run(w);
  const order = Object.keys(r.outputs);
  const at = (n) => order.indexOf(n);
  assert(at('Write Privacy Acknowledgement') < at('Preallocate Receipt'), 'privacy must precede the receipt');
  assert(at('Preallocate Receipt') < at('Call Lead Intake'), 'the receipt must precede Lead Intake');
  assert(at('Receipt Verdict') < at('Call Lead Intake'), 'the verdict must precede Lead Intake');
});

// ── A ─────────────────────────────────────────────────────────────────────────────────────────

check('A — no receipt exists: preallocate exactly once, then Lead Intake proceeds', () => {
  const w = world();
  const r = run(w);
  eq(w.receipts.length, 1, 'receipt rows');
  eq(w.calls.receiptInsert, 1, 'insert calls');
  eq(w.receipts[0].submission_key, keyOf(r), 'the receipt carries the derived key');
  eq(r.response.status, 200, 'status');
  eq(r.response.body.ok, true, 'ok');
  eq(w.pipeline.length, 1, 'Pipeline rows');
  eq(w.receipts[0].commit_state, 'COMMITTED', 'the receipt settled');
  exactlyOnce(w, 'A');
});

// ── B ─────────────────────────────────────────────────────────────────────────────────────────

check('B — a READY receipt already exists: reuse it, insert nothing', () => {
  const w = world();
  const probe = runSubmit(WF, world(), bodyFor(SID));
  const key = keyOf(probe);
  w.receipts.push({
    submission_key: key, commit_state: 'READY', canonical_lead_id: '', lead_mode: '',
    lead_priority: '', financial_zone: '', created_at: '2026-08-30T10:00:00.000Z',
    claimed_at: '', settled_at: '', abort_reason: '', correlation_id: ''
  });
  const r = run(w);
  eq(w.calls.receiptInsert, 0, 'NO second receipt may be inserted');
  eq(w.receipts.length, 1, 'receipt rows');
  eq(r.response.body.ok, true, 'ok');
  exactlyOnce(w, 'B');
});

check('B2 — two submissions in a row insert exactly one receipt between them', () => {
  const w = world();
  run(w);
  run(w);
  eq(w.calls.receiptInsert, 1, 'inserts across two submissions');
  exactlyOnce(w, 'B2');
});

// ── C ─────────────────────────────────────────────────────────────────────────────────────────

check('C — receipt COMMITTED: resolve the canonical lead, commit nothing again', () => {
  const w = world();
  const probe = runSubmit(WF, world(), bodyFor(SID));
  const key = keyOf(probe);
  w.receipts.push({
    submission_key: key, commit_state: 'COMMITTED', canonical_lead_id: 'FIN-EXISTING',
    lead_mode: 'new', lead_priority: 'HOT', financial_zone: 'ORANGE',
    created_at: '2026-08-30T10:00:00.000Z', claimed_at: '2026-08-30T10:00:01.000Z',
    settled_at: '2026-08-30T10:00:02.000Z', abort_reason: '', correlation_id: key
  });
  const r = run(w);
  eq(r.response.body.ok, true, 'ok');
  eq(r.response.body.lead_id, 'FIN-EXISTING', 'the canonical lead was not resolved');
  eq(w.pipeline.length, 0, 'A SECOND PIPELINE ROW WAS WRITTEN');
  eq(w.calls.receiptInsert, 0, 'a second receipt was inserted');
  exactlyOnce(w, 'C');
});

// ── D ─────────────────────────────────────────────────────────────────────────────────────────

check('D — the answer is lost after the Pipeline write: the retry returns the SAME lead', () => {
  const w = world();
  run(w, { node: 'Mark Submitted', mode: 'throw', times: 1 });
  const first = w.pipeline[0].lead_id;
  const r = run(w);
  eq(w.pipeline.length, 1, 'A SECOND PIPELINE ROW WAS WRITTEN');
  eq(r.response.body.lead_id, first, 'the retry minted a different lead');
  eq(w.receipts.length, 1, 'receipt rows');
  exactlyOnce(w, 'D');
});

// ── E ─────────────────────────────────────────────────────────────────────────────────────────

check('E — privacy already recorded: already_recorded, and the receipt still preallocates', () => {
  const w = world();
  run(w, { node: 'Call Lead Intake', mode: 'throw', times: 1 });
  const privacyAfterFirst = w.privacy.length;
  eq(privacyAfterFirst, 1, 'privacy rows after the first attempt');
  const r = run(w);
  eq(w.privacy.length, 1, 'A SECOND PRIVACY ROW WAS WRITTEN');
  eq(r.outputs['Privacy Verdict'][0].privacy_state, 'already_recorded', 'the replay must be already_recorded');
  eq(w.receipts.length, 1, 'receipt rows');
  eq(r.response.body.ok, true, 'the retry did not succeed');
  exactlyOnce(w, 'E');
});

check('E2 — this is the CURRENT live state: privacy 1, receipt 0, Pipeline 0, session draft', () => {
  const w = world();
  const probe = runSubmit(WF, world(), bodyFor(SID));
  const key = keyOf(probe);
  // Exactly what the tenant holds right now, modelled.
  w.privacy.push({ submission_key: key, cycle_id: '', privacy_notice_version: 'pn-2026-08',
    privacy_locale: 'ru', privacy_notice_shown_at: ACK.shown_at,
    privacy_notice_acknowledged_at: ACK.acknowledged_at, privacy_legal_basis: 'PENDING_LEGAL_REVIEW' });
  eq(w.receipts.length, 0, 'receipts before');
  eq(w.pipeline.length, 0, 'Pipeline before');

  const r = run(w);
  eq(w.privacy.length, 1, 'privacy 1 -> 1');
  eq(w.receipts.length, 1, 'receipt 0 -> 1');
  eq(w.pipeline.length, 1, 'Pipeline 0 -> 1');
  eq(r.response.status, 200, 'status');
  eq(r.response.body.ok, true, 'ok');
  assert(String(r.response.body.lead_id || '') !== '', 'a canonical lead id must come back');
  eq(w.sessions[0].state, 'submitted', 'session draft -> submitted');
  assert(String(w.sessions[0].lead_id || '') !== '', 'the session must carry the lead id');
  eq(w.receipts[0].submission_key, key, 'the SAME submission key was reused');
  exactlyOnce(w, 'E2');
});

// ── F ─────────────────────────────────────────────────────────────────────────────────────────

check('F — the receipt store is unreadable: fail closed BEFORE Lead Intake', () => {
  const w = world();
  const r = run(w, { node: 'Receipt Readback', mode: 'throw' });
  eq(r.response.status, 503, 'status');
  eq(r.response.body.error_code, 'SUBMIT_UNRESOLVED', 'error code');
  eq(r.response.body.retryable, true, 'retryable');
  assert(!r.outputs['Call Lead Intake'], 'LEAD INTAKE WAS CALLED WITHOUT A PROVEN RECEIPT');
  eq(w.calls.intake, 0, 'intake calls');
  eq(w.pipeline.length, 0, 'Pipeline rows');
  exactlyOnce(w, 'F');
});

check('F2 — the PROBE is unreadable: nothing is inserted on a reading we could not take', () => {
  const w = world();
  const r = run(w, { node: 'Receipt Probe', mode: 'throw' });
  eq(w.calls.receiptInsert, 0, 'a receipt was inserted on an unreadable probe');
  eq(r.response.status, 503, 'status');
  eq(w.calls.intake, 0, 'intake calls');
  exactlyOnce(w, 'F2');
});

check('F3 — the receipt INSERT itself fails: fail closed, do not call Lead Intake', () => {
  const w = world();
  const r = run(w, { node: 'Preallocate Receipt', mode: 'throw' });
  eq(r.response.status, 503, 'status');
  eq(r.response.body.error_code, 'SUBMIT_UNRESOLVED', 'error code');
  eq(w.calls.intake, 0, 'LEAD INTAKE WAS CALLED WITH NO RECEIPT');
  eq(w.pipeline.length, 0, 'Pipeline rows');
});

// ── G ─────────────────────────────────────────────────────────────────────────────────────────

check('G — duplicate receipts for one key: fail closed, never pick one', () => {
  const w = world();
  const probe = runSubmit(WF, world(), bodyFor(SID));
  const key = keyOf(probe);
  const row = (over) => Object.assign({
    submission_key: key, commit_state: 'READY', canonical_lead_id: '', lead_mode: '',
    lead_priority: '', financial_zone: '', created_at: '2026-08-30T10:00:00.000Z',
    claimed_at: '', settled_at: '', abort_reason: '', correlation_id: ''
  }, over || {});
  w.receipts.push(row(), row());
  const r = run(w);
  eq(r.response.status, 503, 'status');
  eq(r.outputs['Receipt Verdict'][0].receipt_reason, 'DUPLICATE_RECEIPTS', 'reason');
  eq(w.calls.intake, 0, 'LEAD INTAKE WAS CALLED ON AN AMBIGUOUS RECEIPT');
  eq(w.calls.receiptInsert, 0, 'a THIRD receipt was inserted');
  eq(w.pipeline.length, 0, 'Pipeline rows');
});

check('G2 — a receipt whose key is not byte-identical is refused, never repaired', () => {
  const w = world();
  const probe = runSubmit(WF, world(), bodyFor(SID));
  const key = keyOf(probe);
  w.receipts.push({
    submission_key: key + ' ', commit_state: 'READY', canonical_lead_id: '', lead_mode: '',
    lead_priority: '', financial_zone: '', created_at: '2026-08-30T10:00:00.000Z',
    claimed_at: '', settled_at: '', abort_reason: '', correlation_id: ''
  });
  const r = run(w);
  // The probe reads by exact key, so a near-miss row is simply not found and one is preallocated.
  // What must never happen is a near-miss being TRIMMED into a match.
  eq(w.receipts.filter((x) => x.submission_key === key).length, 1, 'exactly one exact-key receipt');
  assert(r.response.status === 200 || r.response.status === 503, 'status');
  if (r.response.status === 200) { eq(w.pipeline.length, 1, 'Pipeline rows'); }
});

check('G3 — an IN_FLIGHT receipt is left to Lead Intake, which refuses it', () => {
  const w = world();
  const probe = runSubmit(WF, world(), bodyFor(SID));
  const key = keyOf(probe);
  w.receipts.push({
    submission_key: key, commit_state: 'IN_FLIGHT', canonical_lead_id: '', lead_mode: '',
    lead_priority: '', financial_zone: '', created_at: '2026-08-30T10:00:00.000Z',
    claimed_at: '2026-08-30T10:00:01.000Z', settled_at: '', abort_reason: '', correlation_id: key
  });
  const r = run(w);
  eq(w.calls.receiptInsert, 0, 'a second receipt was inserted over an IN_FLIGHT one');
  eq(r.response.status, 503, 'status');
  eq(r.response.body.retryable, true, 'retryable');
  eq(w.pipeline.length, 0, 'Pipeline rows');
  exactlyOnce(w, 'G3');
});

// ── the property, over many attempts ──────────────────────────────────────────────────────────

check('THE INVARIANT — six attempts with a fault at every stage still settle to one of each', () => {
  const w = world();
  const stages = ['Write Privacy Acknowledgement', 'Receipt Probe', 'Preallocate Receipt',
    'Receipt Readback', 'Call Lead Intake', 'Mark Submitted'];
  stages.forEach((n) => run(w, { node: n, mode: 'throw', times: 1 }));
  const r = run(w);
  eq(w.privacy.length, 1, 'privacy rows');
  eq(w.receipts.length, 1, 'receipt rows');
  eq(w.pipeline.length, 1, 'Pipeline rows');
  eq(r.response.body.ok, true, 'the final attempt did not settle');
  eq(w.sessions[0].state, 'submitted', 'session state');
  exactlyOnce(w, 'INVARIANT');
});

check('the submission key is never re-minted across any of it', () => {
  const w = world();
  const keys = new Set();
  for (let i = 0; i < 4; i++) { keys.add(keyOf(run(w, { node: 'Call Lead Intake', mode: 'throw', times: i === 0 ? 1 : 0 }))); }
  eq(keys.size, 1, 'the key changed between attempts');
  assert(/^sub_[0-9a-f]{32}$/.test([...keys][0]), 'the key does not match Lead Intake\'s shape');
});

console.log('\nASSERTIONS: ' + pass + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
if (failures.length) { console.log(''); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
