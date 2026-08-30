#!/usr/bin/env node
// FINMENTOR — D3-D7, proven by EXECUTING the submit endpoint against a world that remembers.
//
//   node qa/premium-ux-submit-idempotency.test.mjs
//
// Offline. No tenant, no network, no credentials. qa/lib/submit-runner.mjs walks the RESOLVED
// candidate graph node by node, runs every Code node as written, evaluates every n8n expression as
// written, and executes the three side-effecting node types against an in-memory world whose
// privacy table has a UNIQUE INDEX and whose role holds INSERT and not SELECT — exactly as measured
// on the live database.
//
// ── THE INVARIANT ──────────────────────────────────────────────────────────────────────────────
//
//     ONE logical submission
//       = ONE submission identity
//       = at most ONE privacy acknowledgement
//       = at most ONE Lead Intake committed result
//       = at most ONE Pipeline lead
//
// It is asserted as a PROPERTY over interruption points, not as five separate unit tests: the
// submission is driven to completion, then driven again after a failure injected at each stage in
// turn, and after every one of them the world must still hold exactly one of each.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadResolvedSubmit, makeWorld, runSubmit } from './lib/submit-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const PR = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-record.js'));
const M = await import('../scripts/build-premium-endpoints.mjs');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const WF = loadResolvedSubmit(M, {});
const SID = 'AS-' + 'a'.repeat(64);
const SID2 = 'AS-' + 'b'.repeat(64);
const OWNER = '551662084';

const ACK = {
  notice_version: 'pn-2026-08', locale: 'ru',
  shown_at: '2026-08-30T10:00:00.000Z', acknowledged_at: '2026-08-30T10:00:01.000Z'
};
// A missing acknowledgement must reach the endpoint AS missing. Defaulting it inside the helper
// would have tested the fixture instead of the guard, so the sentinel is explicit.
const NO_ACK = Symbol('absent');
const bodyFor = (id, ack) => ({ app_session_id: id, privacy_ack: ack === NO_ACK ? undefined : (ack || ACK) });

// A draft that passes the server's own assertSubmittable.
function completeDraft() {
  const o = B.OBJECTIVES[0];
  const f = (v, source) => ({ value: v, source: source || 'user_explicit', confirmed: true, at: '2026-08-30T09:00:00.000Z' });
  const fields = {
    company_name: f('Alfa Grup'),
    business_activity: f('Розничная сеть'),
    role: f('Собственник'),
    turnover_band: f(B.SCALE_OPTIONS[2]),
    objective: f(o.label),
    desired_outcome: f(B.OUTCOMES[o.id].options[0][0]),
    current_setup: f([B.CURRENT_SETUP.options[0]]),
    decision_horizon: f(B.DECISION_HORIZON.options[0][0]),
    contact_channel: f('telegram', 'telegram_carried'),
    locale: f('ru', 'telegram_carried'),
    contact_name: f('Ghennadi', 'telegram_carried')
  };
  if (B.isFreeTextProblem(o.id)) { fields.problem_free_text = f('Не вижу прибыли по направлениям.'); }
  else { fields.problem = f(B.PROBLEMS[o.id].options[0][0]); }
  return { v: 1, step: 'APP_REVIEW', updated_at: '2026-08-30T09:00:00.000Z', fields: fields };
}

const sessionRow = (id, over) => Object.assign({
  app_session_id: id, telegram_user_id: OWNER, chat_id: OWNER, cycle_id: '',
  replay_key: 'rk', state: 'draft',
  created_at: '2026-08-30T09:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
  updated_at: '2026-08-30T09:00:00.000Z', draft_json: JSON.stringify(completeDraft()), lead_id: ''
}, over || {});

const world = (rows) => makeWorld({ sessions: rows || [sessionRow(SID)] });
const run = (w, body, faults) => runSubmit(WF, w, body || bodyFor(SID), faults);

console.log('Premium UX — submit idempotency (D3-D7), executed');
console.log('');

// ── D3. the payload is real ────────────────────────────────────────────────────────────────────

check('D3 — Lead Intake receives the real projection, built from the STORED draft', () => {
  const w = world();
  const r = run(w);
  eq(r.response.status, 200, 'status');
  eq(r.response.body.ok, true, 'ok');
  const env = r.outputs['Build Intake Payload'][0];
  assert(!env.placeholder, 'the placeholder object is still being sent');
  eq(env.envelope.source, 'telegram_miniapp', 'the internal envelope marker');
  assert(/^sub_[0-9a-f]{32}$/.test(env.submission_key), 'the key does not match Lead Intake\'s shape');
  const pl = env.envelope.payload;
  eq(pl.tool, 'miniapp_premium_brief', 'tool');
  eq(pl.client.company, 'Alfa Grup', 'the company came from the stored draft');
  eq(pl.intake.commercial_intent.work_interest[0], B.OBJECTIVES[0].label, 'ЗАДАЧА is the objective LABEL');
  eq(pl.meta.request_id, env.submission_key, 'the correlation is not the submission key');
  assert(pl.meta.consent === true, 'consent is not asserted on the payload');
});

check('D3 — an incomplete draft never reaches the IRREVERSIBLE call', () => {
  // The acknowledgement IS written first, and that is correct rather than a leak. The client saw
  // the notice and accepted it; that happened, whether or not the submission then succeeds, and
  // recording only the acknowledgements that happen to succeed is the wrong subset — which is the
  // whole argument for a separate append-only store. What must not happen is the irreversible part.
  const partial = completeDraft();
  delete partial.fields.objective;
  const w = world([sessionRow(SID, { draft_json: JSON.stringify(partial) })]);
  const r = run(w);
  eq(r.response.body.ok, false, 'an incomplete brief was accepted');
  eq(r.response.body.error_code, 'DRAFT_EMPTY', 'error code');
  eq(w.calls.intake, 0, 'LEAD INTAKE WAS CALLED WITH AN INCOMPLETE BRIEF');
  eq(w.leadSeq, 0, 'a lead was created from an incomplete brief');
  eq(w.sessions[0].state, 'draft', 'the session was marked submitted');
  // And the acknowledgement that was recorded is still exactly one, on the derived key.
  eq(w.privacy.length, 1, 'privacy rows');
  run(w, bodyFor(SID));
  eq(w.privacy.length, 1, 'a second attempt duplicated the acknowledgement');
});

check('the envelope marker is the one Lead Intake authenticates, exactly', () => {
  const w = world();
  const r = run(w);
  const env = r.outputs['Build Intake Payload'][0].envelope;
  // Internal Auth Entry compares with ===. `telegram_miniapp_premium`, which this module used to
  // emit, is refused as ENVELOPE_SOURCE_INVALID before the payload is read.
  eq(env.source, 'telegram_miniapp', 'the internal envelope marker');
  assert(env.payload && env.payload.meta && env.payload.meta.request_id, 'no correlation id — Internal Auth Entry faults on CORRELATION_ID_MISSING');
});

// ── D4. one derived identity ───────────────────────────────────────────────────────────────────

check('D4 — the submission key is derived, stable across retries, and distinct across sessions', () => {
  const w = world([sessionRow(SID), sessionRow(SID2)]);
  const a1 = run(w, bodyFor(SID)).outputs['Submit State'][0].submission_key;
  const a2 = runSubmit(WF, world([sessionRow(SID)]), bodyFor(SID)).outputs['Submit State'][0].submission_key;
  const b1 = runSubmit(WF, world([sessionRow(SID2)]), bodyFor(SID2)).outputs['Submit State'][0].submission_key;
  eq(a1, a2, 'the same session produced two different keys — a retry would duplicate everything');
  assert(a1 !== b1, 'two different sessions produced the SAME key — they would collide');
  assert(/^sub_[0-9a-f]{32}$/.test(a1), 'the key shape Lead Intake enforces');
  assert(a1.indexOf(SID) === -1, 'the session id is recoverable from the key');
  // And it is never the empty string, which is what the deployed build wrote.
  assert(a1 !== 'sub_' && a1.length === 36, 'malformed key');
});

check('D4 — the privacy row carries the derived key, not an empty string', () => {
  const w = world();
  run(w);
  eq(w.privacy.length, 1, 'privacy rows');
  assert(/^sub_[0-9a-f]{32}$/.test(w.privacy[0].submission_key), 'the privacy row key is ' + JSON.stringify(w.privacy[0].submission_key));
  eq(w.privacy[0].privacy_legal_basis, 'PENDING_LEGAL_REVIEW', 'the legal basis moved');
  eq(w.privacy[0].privacy_notice_acknowledged_at, ACK.acknowledged_at, 'the acknowledgement instant');
});

// ── D5. the acknowledgement is proven before the irreversible call ─────────────────────────────

check('D5 — a privacy write that does NOT land stops the flow; Lead Intake is never reached', () => {
  const w = world();
  const r = run(w, bodyFor(SID), { node: 'Write Privacy Acknowledgement', mode: 'throw' });
  eq(r.response.body.ok, false, 'a lead was created without a proven acknowledgement');
  eq(r.response.body.error_code, 'SUBMIT_UNRESOLVED', 'error code');
  eq(r.response.body.retryable, true, 'a transient privacy failure must be retryable');
  eq(w.calls.intake, 0, 'LEAD INTAKE WAS CALLED WITH NO CONSENT ROW — the defect D5 named');
  eq(w.privacy.length, 0, 'a privacy row exists');
  eq(w.sessions[0].state, 'draft', 'the session was marked submitted');
});

check('D5 — a duplicate-key refusal is treated as ALREADY RECORDED, not as a failure', () => {
  const w = world();
  run(w);                                   // first submission writes the row
  eq(w.privacy.length, 1, 'after the first submission');
  const r = run(w, bodyFor(SID));           // the session is now `submitted`, so this replays
  eq(r.response.body.ok, true, 'the replay was reported as a failure');
  eq(w.privacy.length, 1, 'the replay wrote a second privacy row');
});

check('D5 — the unique index IS the read, under a role that cannot SELECT', () => {
  // Two different sessions must not be able to share a row, and the same session must not be able
  // to create two. Driven through the privacy node directly by replaying an unsubmitted session.
  const w = world();
  run(w, bodyFor(SID), { node: 'Call Lead Intake', mode: 'throw', times: 99 });
  eq(w.privacy.length, 1, 'first attempt');
  run(w, bodyFor(SID), { node: 'Call Lead Intake', mode: 'throw', times: 99 });
  eq(w.privacy.length, 1, 'a second attempt on the same session wrote a second row');
  eq(w.calls.privacyInsert, 2, 'the insert was not attempted twice');
  assert(w.log.filter((l) => l.indexOf('23505') !== -1).length === 1, 'the duplicate was not refused by the index');
  // A DIFFERENT session gets its own row — the key must not collide.
  const w2 = makeWorld({ sessions: [sessionRow(SID), sessionRow(SID2)] });
  run(w2, bodyFor(SID));
  run(w2, bodyFor(SID2));
  eq(w2.privacy.length, 2, 'two distinct submissions shared one acknowledgement');
});

check('D5 — the seven values the record emits are actually BOUND, in the order the SQL declares', () => {
  // THE 14:42 DEFECT, GATED. The statement declared $1..$7 and options carried {}, so Postgres
  // refused it with 42P02 'there is no parameter $1' before the transaction began — and every
  // submission died at the privacy write. Nothing in this suite would have noticed: the runner
  // models the store, not the node's parameter resolution. So assert the binding as a property of
  // the built node itself.
  const pw = WF.nodes.find((n) => n.name === 'Write Privacy Acknowledgement');
  const sql = String(pw.parameters.query);
  const binding = String(((pw.parameters.options || {}).queryReplacement) || '');
  assert(binding !== '', 'options.queryReplacement is empty — the statement cannot resolve $1');

  // n8n splits this field on commas BEFORE resolving each segment, which is why every segment
  // carries its own leading '=' and why a comma inside a resolved VALUE cannot shift the binding.
  const segments = binding.split(',');
  const declared = new Set((sql.match(/\$\d+/g) || []).map((p) => Number(p.slice(1))));
  eq(segments.length, declared.size, 'the statement declares a different number of parameters than the binding supplies');
  eq(Math.max.apply(null, Array.from(declared)), segments.length, 'the highest $n is beyond the end of the binding');
  segments.forEach((seg, i) => {
    assert(seg.indexOf('=') === 0, 'segment ' + (i + 1) + ' does not carry its own leading = , so n8n stores it as a literal');
    assert(/^=\{\{ \$json\.[a-z_]+ \}\}$/.test(seg), 'segment ' + (i + 1) + ' is not a single field reference: ' + seg);
  });

  // And the ORDER: $n must bind the column the INSERT names in position n. A silent transposition
  // would put the acknowledged_at timestamp in the shown_at column and never fail.
  const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((c) => c.trim());
  eq(columns.length, segments.length, 'the column list and the binding are different lengths');
  const bound = segments.map((seg) => seg.replace(/^=\{\{ \$json\./, '').replace(/ \}\}$/, ''));
  columns.forEach((col, i) => {
    eq(bound[i], col, 'position ' + (i + 1) + ' binds the wrong field');
  });

  // And against the record module's OWN positional contract, so the two cannot drift apart:
  // insertParams() is what the endpoint's SQL was written to consume, and a probe record whose
  // every value is its own key name reads the order back out of it.
  const probe = {};
  PR.RECORD_KEYS.forEach((k) => { probe[k] = k; });
  const positional = PR.insertParams(probe);
  eq(bound.join(','), positional.join(','), 'the node binds a different order than privacy-record.insertParams supplies');
});

// ── D6 + D7. a committed submission, replayed ──────────────────────────────────────────────────

check('D6 — the canonical lead id is recorded on the session row', () => {
  const w = world();
  const r = run(w);
  eq(r.response.body.lead_id, 'FIN-1', 'the response lead id');
  eq(w.sessions[0].state, 'submitted', 'the session state');
  eq(w.sessions[0].lead_id, 'FIN-1', 'THE LEAD ID WAS NOT STORED — a replay would answer with an empty string');
});

check('D7 — a replay of a committed submission answers ok:TRUE with the canonical lead', () => {
  const w = world();
  run(w);
  const r = run(w, bodyFor(SID));
  eq(r.response.status, 200, 'status');
  eq(r.response.body.ok, true, 'a committed submission was reported as a failure — this is D7');
  eq(r.response.body.already, true, 'the replay is not marked as such');
  eq(r.response.body.lead_id, 'FIN-1', 'the canonical lead did not come back');
  eq(r.response.body.error_code, undefined, 'a success carries an error code');
  eq(w.calls.intake, 1, 'the replay called Lead Intake again');
  eq(w.privacy.length, 1, 'the replay wrote a second acknowledgement');
});

check('D7 — a committed session that has since EXPIRED still answers with its lead', () => {
  const w = world();
  run(w);
  w.sessions[0].expires_at = '2020-01-01T00:00:00.000Z';
  const r = run(w, bodyFor(SID));
  eq(r.response.body.ok, true, 'an expired but COMMITTED submission was reported as expired');
  eq(r.response.body.lead_id, 'FIN-1', 'the lead id');
});

// ── the invariant, over every interruption point ───────────────────────────────────────────────

const STAGES = [
  ['privacy write', 'Write Privacy Acknowledgement'],
  ['Lead Intake', 'Call Lead Intake'],
  ['the session mark', 'Mark Submitted']
];

check('THE INVARIANT — one submission survives a failure at every stage, retried to completion', () => {
  for (const [label, node] of STAGES) {
    const w = world();
    // Attempt 1: fails at this stage.
    const first = run(w, bodyFor(SID), { node: node, mode: 'throw', times: 1 });
    // Attempt 2 and 3: clean.
    run(w, bodyFor(SID));
    const last = run(w, bodyFor(SID));

    eq(w.privacy.length, 1, label + ': privacy rows');
    eq(w.receipts.length, 1, label + ': Lead Intake commits');
    eq(w.leadSeq, 1, label + ': Pipeline leads');
    eq(w.sessions[0].state, 'submitted', label + ': final session state');
    eq(w.sessions[0].lead_id, 'FIN-1', label + ': the canonical lead on the session');
    eq(last.response.body.ok, true, label + ': the final answer');
    eq(last.response.body.lead_id, 'FIN-1', label + ': the final lead id');
    void first;
  }
});

check('A — a failure BEFORE the privacy write leaves nothing, and the retry writes exactly one row', () => {
  const w = world();
  const r = run(w, bodyFor(SID), { node: 'Write Privacy Acknowledgement', mode: 'throw', times: 1 });
  eq(r.response.body.retryable, true, 'not retryable');
  eq(w.privacy.length, 0, 'a row was written by the failing attempt');
  run(w, bodyFor(SID));
  eq(w.privacy.length, 1, 'the retry did not write exactly one row');
  eq(w.leadSeq, 1, 'leads');
});

check('B — privacy written, downstream fails: the retry writes NO second acknowledgement', () => {
  const w = world();
  run(w, bodyFor(SID), { node: 'Call Lead Intake', mode: 'throw', times: 1 });
  eq(w.privacy.length, 1, 'the first attempt wrote its row');
  eq(w.leadSeq, 0, 'a lead was created despite the failure');
  run(w, bodyFor(SID));
  eq(w.privacy.length, 1, 'THE RETRY WROTE A SECOND ACKNOWLEDGEMENT');
  eq(w.leadSeq, 1, 'leads after the retry');
});

check('C — Lead Intake commits but the answer is lost: the retry creates NO second lead', () => {
  const w = world();
  // The commit lands in Lead Intake's receipt, then the delivery of its answer fails.
  const wf = WF;
  const faults = { node: 'Call Lead Intake', mode: 'throw', times: 1 };
  // Seed the receipt as though the first call had committed before the answer was lost.
  const keyRun = runSubmit(wf, world(), bodyFor(SID));
  const key = keyRun.outputs['Submit State'][0].submission_key;
  // A real COMMITTED receipt row, as the store actually holds it — the settled lead lives on
  // canonical_lead_id, which is the only thing a replay is allowed to resolve from.
  w.receipts.push({ submission_key: key, commit_state: 'COMMITTED',
    canonical_lead_id: 'FIN-COMMITTED', lead_mode: 'new', lead_priority: 'HOT',
    financial_zone: 'ORANGE', created_at: '2026-08-30T10:00:00.000Z',
    claimed_at: '2026-08-30T10:00:01.000Z', settled_at: '2026-08-30T10:00:02.000Z',
    abort_reason: '', correlation_id: key });
  w.leadSeq = 1;
  run(w, bodyFor(SID), faults);             // the lost answer
  const r = run(w, bodyFor(SID));           // the retry
  eq(r.response.body.lead_id, 'FIN-COMMITTED', 'the retry did not resolve the committed result');
  eq(w.leadSeq, 1, 'A SECOND LEAD WAS CREATED');
  eq(w.receipts.length, 1, 'a second receipt was claimed');
});

check('D — the Pipeline lead exists but the client never saw it: the retry resolves it', () => {
  const w = world();
  run(w, bodyFor(SID), { node: 'Mark Submitted', mode: 'throw', times: 1 });
  // The lead IS committed; only the local bookkeeping failed.
  eq(w.leadSeq, 1, 'the lead did not commit');
  const r = run(w, bodyFor(SID));
  eq(r.response.body.ok, true, 'the retry did not succeed');
  eq(r.response.body.lead_id, 'FIN-1', 'the retry produced a different lead');
  eq(w.leadSeq, 1, 'the retry created a second lead');
  eq(w.privacy.length, 1, 'the retry created a second acknowledgement');
  eq(w.sessions[0].state, 'submitted', 'the session was never marked');
});

check('E — a duplicate Retry click has no duplicate side effect, however many times', () => {
  const w = world();
  const answers = [];
  for (let i = 0; i < 6; i++) { answers.push(run(w, bodyFor(SID)).response.body); }
  eq(w.privacy.length, 1, 'privacy rows after six submissions');
  eq(w.leadSeq, 1, 'leads after six submissions');
  eq(w.receipts.length, 1, 'receipts after six submissions');
  answers.forEach((a, i) => {
    eq(a.ok, true, 'answer ' + i + ' was not a success');
    eq(a.lead_id, 'FIN-1', 'answer ' + i + ' carried a different lead');
  });
  eq(w.calls.intake, 1, 'Lead Intake was invoked ' + w.calls.intake + ' times for one submission');
});

// ── what must NOT have changed ─────────────────────────────────────────────────────────────────

check('the owner gate still fails closed, and reads the SERVER-stored identity', () => {
  const w = world([sessionRow(SID, { telegram_user_id: '999999' })]);
  const r = run(w);
  eq(r.response.body.error_code, 'NOT_AUTHORISED', 'a non-owner passed the gate');
  eq(r.response.status, 403, 'status');
  eq(w.calls.privacyInsert, 0, 'a non-owner reached the privacy write');
  eq(w.calls.intake, 0, 'a non-owner reached Lead Intake');
  // And nothing the CALLER sends can move it.
  const w2 = world([sessionRow(SID, { telegram_user_id: '999999' })]);
  const r2 = runSubmit(WF, w2, Object.assign(bodyFor(SID), { telegram_user_id: OWNER, owner: true }));
  eq(r2.response.body.error_code, 'NOT_AUTHORISED', 'a caller-supplied identity was believed');
});

check('an expired, uncommitted session is refused before any side effect', () => {
  const w = world([sessionRow(SID, { expires_at: '2020-01-01T00:00:00.000Z' })]);
  const r = run(w);
  eq(r.response.body.error_code, 'SESSION_EXPIRED', 'error code');
  eq(w.calls.privacyInsert, 0, 'privacy write');
  eq(w.calls.intake, 0, 'intake call');
});

check('a missing or malformed acknowledgement never reaches the privacy store', () => {
  for (const ack of [NO_ACK, {}, { notice_version: 'pn-2026-08' },
    { notice_version: 'pn-2026-08', shown_at: 'nope', acknowledged_at: 'nope' }]) {
    const w = world();
    const r = run(w, bodyFor(SID, ack));
    eq(r.response.body.ok, false, 'accepted ' + JSON.stringify(ack));
    eq(w.calls.privacyInsert, 0, 'wrote a row for ' + JSON.stringify(ack));
  }
});

check('the acknowledgement is written BEFORE the irreversible call, always', () => {
  const names = WF.nodes.map((n) => n.name);
  assert(names.indexOf('Write Privacy Acknowledgement') < names.indexOf('Call Lead Intake'), 'node order');
  // And structurally: there is no path from IF Submit Allowed to Call Lead Intake that skips it.
  const seen = new Set();
  (function walk(n) {
    if (seen.has(n)) { return; }
    seen.add(n);
    const c = WF.connections[n];
    if (!c) { return; }
    c.main.forEach((b) => (b || []).forEach((e) => walk(e.node)));
  })('Build Privacy Record');
  assert(seen.has('Call Lead Intake'), 'the graph no longer reaches Lead Intake');
  const skip = new Set();
  (function walk2(n) {
    if (skip.has(n) || n === 'Write Privacy Acknowledgement') { return; }
    skip.add(n);
    const c = WF.connections[n];
    if (!c) { return; }
    c.main.forEach((b) => (b || []).forEach((e) => walk2(e.node)));
  })('Submit Webhook');
  assert(!skip.has('Call Lead Intake'), 'there is a path to Lead Intake that bypasses the acknowledgement');
});

check('the endpoint never reads the request body for anything but the id and the acknowledgement', () => {
  const w = world();
  const r = runSubmit(WF, w, Object.assign(bodyFor(SID), {
    answers: { company_name: 'INJECTED' }, lead_id: 'FIN-EVIL', priority: 'HOT',
    fields: { company_name: { value: 'INJECTED' } }, cycle_id: 'C-EVIL', init_data: 'x'
  }));
  eq(r.response.body.ok, true, 'the submission failed');
  const pl = r.outputs['Build Intake Payload'][0].envelope.payload;
  eq(pl.client.company, 'Alfa Grup', 'an injected answer reached the payload');
  assert(JSON.stringify(pl).indexOf('INJECTED') === -1, 'injected content reached Lead Intake');
  assert(JSON.stringify(pl).indexOf('FIN-EVIL') === -1, 'an injected lead id reached Lead Intake');
  eq(w.sessions[0].lead_id, 'FIN-1', 'an injected lead id reached the session row');
});

check('every refusal answers with ITS OWN code and status, never a flattened one', () => {
  // Found live: the shape branch ended at a responder that answered a hard-coded BAD_REQUEST 400,
  // so a client that had not acknowledged the privacy notice was told its REQUEST was malformed.
  // The client maps codes to behaviour, so a wrong code is not cosmetic.
  const cases = [
    ['a malformed session id', { app_session_id: 'nope', privacy_ack: ACK }, 400, 'BAD_REQUEST'],
    ['a missing acknowledgement', { app_session_id: SID }, 409, 'CONSENT_REQUIRED'],
    ['an acknowledgement with no timestamps', { app_session_id: SID, privacy_ack: { notice_version: 'x' } }, 409, 'CONSENT_REQUIRED'],
    ['an unknown session', { app_session_id: SID2, privacy_ack: ACK }, 401, 'SESSION_INVALID'],
    ['an expired session', null, 401, 'SESSION_EXPIRED'],
    ['a non-owner', null, 403, 'NOT_AUTHORISED'],
    ['an empty draft', null, 409, 'DRAFT_EMPTY']
  ];
  for (const [label, b, status, code] of cases) {
    let w = world();
    if (label === 'an expired session') { w = world([sessionRow(SID, { expires_at: '2020-01-01T00:00:00.000Z' })]); }
    if (label === 'a non-owner') { w = world([sessionRow(SID, { telegram_user_id: '999' })]); }
    if (label === 'an empty draft') { w = world([sessionRow(SID, { draft_json: '{"v":1,"fields":{}}' })]); }
    const r = runSubmit(WF, w, b || bodyFor(SID));
    eq(r.response.status, status, label + ': status');
    eq(r.response.body.error_code, code, label + ': error code');
    eq(r.response.body.ok, false, label + ': ok');
    eq(r.response.body.retryable, false, label + ': retryable');
  }
});

check('the terminal responder serialises a prebuilt object — no branch lives in a template', () => {
  const term = WF.nodes.find((n) => n.name === 'Respond Submit Terminal');
  eq(term.parameters.responseBody, '={{ JSON.stringify($json.__response) }}', 'the response body expression');
  eq(term.parameters.options.responseCode, '={{ Number($json.__status || 400) }}', 'the status expression');
  // A ternary in the template produced HTTP 200 with an empty body on the tenant.
  assert(String(term.parameters.responseBody).indexOf('?') === -1, 'a branch crept back into the template');
  // And it is the ONLY responder for refusals: nothing can flatten a verdict any more.
  const responders = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').map((n) => n.name);
  eq(responders.sort().join(','), 'Respond Submit OK,Respond Submit Terminal,Respond Submit Unresolved',
    'the responder set changed');
});

check('the resolved candidate carries no placeholder and no literal identity', () => {
  const json = JSON.stringify(WF);
  assert(!/__[A-Z_]{4,}__/.test(json), 'an unresolved placeholder survived');
  const raw = readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-submit-endpoint-candidate.json'), 'utf8');
  // ...while the TRACKED candidate keeps every one of them.
  for (const ph of ['__OWNER_TELEGRAM_ID__', '__LEAD_INTAKE_WORKFLOW_ID__', '__PRIVACY_AUDIT_CREDENTIAL_ID__', '__PREMIUM_SUBMIT_PROJECTION__']) {
    assert(raw.indexOf(ph) !== -1, 'the tracked candidate has baked in ' + ph);
  }
  assert(!/\b\d{9,}\b/.test(raw), 'a literal numeric identity is in the tracked candidate');
});

check('the inlined projection is byte-identical to the gated module', () => {
  const node = WF.nodes.find((n) => n.name === 'Build Intake Payload');
  const js = node.parameters.jsCode;
  for (const file of ['branches.js', 'draft-contract.js', 'submit-projection.js']) {
    const src = readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', file), 'utf8');
    const body = src.slice(0, src.lastIndexOf('module.exports = '))
      .replace(/^\s*const [A-Z] = require\([^)]*\);\s*$/gm, '');
    assert(js.indexOf(body) !== -1, file + ' was retyped rather than inlined');
  }
  assert(js.indexOf('DO NOT EDIT HERE') !== -1, 'the inline warning was removed');
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
