#!/usr/bin/env node
// FINMENTOR — cross-reload draft resume, executed against the Gateway candidate.
//
//   node qa/premium-ux-resume.test.mjs
//
// Offline. Extracts `Resolve Session` and `Finalise Session` from the built Gateway candidate and
// RUNS them, so what is asserted is the code that ships rather than a description of it.
//
// ── THE CONTRADICTION THIS CLOSES ──────────────────────────────────────────────────────────────
//
// The approved copy promises «У вас есть незавершённый бриф» and «Можно продолжить с того места,
// где остановились — подтверждённые данные сохранены», and the app session has a 72 h TTL. The
// Gateway minted a NEW session on every open, so closing the Mini App and reopening it silently
// lost the brief. A new signed Telegram context is not a new business request.
//
// ── WHAT IS NOT WEAKENED ───────────────────────────────────────────────────────────────────────
//
// Nothing before the claim moves. Signature verification, `auth_date` freshness and the G5 replay
// claim all run exactly as before, on every open, and each signed context is still consumed once.
// The change is entirely downstream of a claim that has already been won.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const WF = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));
const codeOf = (n) => String((WF.nodes.find((x) => x.name === n) || { parameters: {} }).parameters.jsCode || '');

const OWNER = '551662084';
// C3.1 — the authoritative cycle, projected by the Concierge and resolved by the Gateway. Every
// row and every candidate below carries it; '' is no longer a cycle anything can resume under.
const CYCLE = 'C-551662084-1756900000000';
const NOW = Date.now();
const iso = (msFromNow) => new Date(NOW + msFromNow).toISOString();
const HOUR = 3600000;

// The candidate the Gateway just minted for THIS open.
const candidate = (over) => Object.assign({
  app_session_id: 'AS-' + 'c'.repeat(64),
  telegram_user_id: OWNER, chat_id: OWNER, cycle_id: CYCLE, replay_key: 'rk-new',
  state: 'draft', created_at: iso(0), expires_at: iso(72 * HOUR), updated_at: iso(0), draft_json: ''
}, over || {});

const row = (id, over) => Object.assign({
  app_session_id: id, telegram_user_id: OWNER, chat_id: OWNER, cycle_id: CYCLE, replay_key: 'rk',
  state: 'draft', created_at: iso(-2 * HOUR), expires_at: iso(70 * HOUR), updated_at: iso(-2 * HOUR),
  draft_json: '', lead_id: ''
}, over || {});

const DRAFT = {
  v: 1, step: 'APP_SCALE', updated_at: iso(-HOUR),
  fields: {
    company_name: { value: 'Alfa Grup', source: 'user_explicit', confirmed: true, at: iso(-2 * HOUR) },
    role: { value: 'Собственник', source: 'user_confirmed', confirmed: true, at: iso(-2 * HOUR) },
    contact_name: { value: 'Ghennadi', source: 'telegram_carried', confirmed: true, at: iso(-2 * HOUR) },
    contact_channel: { value: 'telegram', source: 'user_explicit', confirmed: true, at: iso(-HOUR) },
    business_activity: { value: 'Сеть магазинов', source: 'ai_inferred', confirmed: true, at: iso(-HOUR) }
  }
};

// Run a Gateway code node with `$` and `$input` as n8n provides them.
function run(nodeName, rows, cand, locale) {
  const outputs = {
    'Claim Verdict': [{ telegram_user_id: OWNER, replay_key: 'rk-new', locale: locale || 'ru', claim_won: 1 }],
    'Build App Session': [cand || candidate()]
  };
  const handle = (items) => ({
    first: () => ({ json: items[0] }), all: () => items.map((j) => ({ json: j })), isExecuted: true
  });
  const $ = (n) => {
    if (!Object.prototype.hasOwnProperty.call(outputs, n)) { throw new Error("$('" + n + "') not provided"); }
    return handle(outputs[n]);
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$', '$input', 'require', codeOf(nodeName));
  return fn($, handle(rows || []), () => { throw new Error('require() in a Gateway code node'); })[0].json;
}

const resolve = (rows, cand, locale) => run('Resolve Session', rows, cand, locale);
const finalise = (rows, cand, locale) => run('Finalise Session', rows, cand, locale);

console.log('Premium UX — cross-reload draft resume');
console.log('');

// ── 1. the graph ───────────────────────────────────────────────────────────────────────────────

check('the resume path sits AFTER the claim and touches nothing before it', () => {
  const c = WF.connections;
  // C3.1 — the cycle projection read sits between the won claim and the mint; the mint is then
  // gated on a resolved cycle before the resume read runs.
  eq(c['IF Claim Won'].main[0][0].node, 'Read Cycle Projection', 'the claim still gates everything');
  eq(c['Read Cycle Projection'].main[0][0].node, 'Build App Session', 'the projection read feeds the mint');
  eq(c['Build App Session'].main[0][0].node, 'IF Cycle Store Readable', 'the cycle-store verdict follows the mint candidate');
  eq(c['IF Cycle Store Readable'].main[0][0].node, 'IF Cycle Resolved', 'a readable projection reaches the cycle gate');
  eq(c['IF Cycle Resolved'].main[0][0].node, 'Read User Sessions', 'the read follows the resolved cycle');
  eq(c['Read User Sessions'].main[0][0].node, 'Resolve Session', 'the resolver follows the read');
  eq(c['IF Create Session'].main[0][0].node, 'Build Session Row', 'create branch');
  eq(c['IF Create Session'].main[1][0].node, 'IF Session Committed', 'resume branch forks on the stored state (C3.4)');
  eq(c['Create App Session'].main[0][0].node, 'Read Back Sessions', 'the insert is followed by a re-read');
  eq(c['Read Back Sessions'].main[0][0].node, 'Finalise Session', 'and by the same rule again');
  // Nothing upstream of the claim was rewired.
  eq(c['Gateway Webhook'].main[0][0].node, 'Verify InitData', 'verification is still first');
  eq(c['Verify InitData'].main[0][0].node, 'IF Verified', 'unchanged');
  eq(c['Derive Replay Key'].main[0][0].node, 'G5 Replay Claim', 'unchanged');
  eq(c['G5 Replay Claim'].main[0][0].node, 'Claim Verdict', 'unchanged');
});

check('the reads return ALL rows and survive a user with none', () => {
  for (const n of ['Read User Sessions', 'Read Back Sessions']) {
    const node = WF.nodes.find((x) => x.name === n);
    eq(node.parameters.returnAll, true, n + ': returnAll — without it the rule orders a set of one');
    eq(node.parameters.operation, 'get', n + ': operation');
    eq(node.parameters.filters.conditions[0].keyName, 'telegram_user_id', n + ': filter key');
    eq(node.alwaysOutputData, true, n + ': a user with no rows must still produce an item');
    eq(node.onError, 'continueRegularOutput', n + ': one output, so the flag is not the P9-R2 pair');
    assert(!node.credentials, n + ' carries a credential');
  }
});

// ── 2. the cases the owner enumerated ──────────────────────────────────────────────────────────

check('CASE A — no live session for this user and cycle: mint', () => {
  eq(resolve([]).create, 1, 'an empty store');
  eq(resolve([{}]).create, 1, 'the empty item an alwaysOutputData read produces');
  eq(resolve([row('AS-' + 'e'.repeat(64), { telegram_user_id: '999' })]).create, 1, 'another user\'s session');
  eq(resolve([row('AS-' + 'e'.repeat(64), { cycle_id: 'C-2' })]).create, 1, 'another cycle');
});

check('CASE B — one live draft: resume it, do not mint', () => {
  const existing = row('AS-' + 'a'.repeat(64), { draft_json: JSON.stringify(DRAFT) });
  const r = resolve([existing]);
  eq(r.create, 0, 'it minted instead of resuming');
  eq(r.app_session_id, existing.app_session_id, 'the resumed session id');
  eq(r.__response.resumed, true, 'the answer is not marked as a resume');
  eq(r.__response.state, 'draft', 'state');
  eq(r.__response.draft.fields.company_name.value, 'Alfa Grup', 'the draft did not come back');
});

check('CASE C — a different cycle is never resumed', () => {
  const other = row('AS-' + 'a'.repeat(64), { cycle_id: 'C-OLD', draft_json: JSON.stringify(DRAFT) });
  eq(resolve([other]).create, 1, 'a session from another cycle was resumed');
  // ...and a session in the SAME cycle is.
  eq(resolve([Object.assign({}, other, { cycle_id: CYCLE })]).create, 0, 'the same cycle was not resumed');
  // C3.1 — '' is not a cycle. A legacy row stamped '' (pre-projection) can never be resumed, and a
  // candidate somehow carrying '' resumes nothing either: the key is the PAIR, and half a key is none.
  eq(resolve([Object.assign({}, other, { cycle_id: '' })]).create, 1, 'a legacy empty-cycle row was resumed');
  eq(resolve([Object.assign({}, other, { cycle_id: '' })], candidate({ cycle_id: '' })).create, 1, 'an empty candidate cycle resumed an empty row');
});

check('CASE C2 — an EXPLICIT ROTATION makes the old draft unreachable, with no cleanup needed', () => {
  // The Concierge rotates the cycle and projects the new one BEFORE persisting the rotation. The
  // Gateway then bootstraps under the new cycle: the old draft, however fresh, is simply not in
  // the key space any more. Nothing has to be deleted for this to hold.
  const oldDraft = row('AS-' + 'a'.repeat(64), { cycle_id: 'C-551662084-1', draft_json: JSON.stringify(DRAFT), created_at: iso(-60000) });
  const afterRotation = candidate({ cycle_id: 'C-551662084-2' });
  eq(resolve([oldDraft], afterRotation).create, 1, 'the old-cycle draft won after an explicit rotation');
  // and the committed request of the OLD cycle is not shown as the new cycle's terminal either
  const oldDone = Object.assign({}, oldDraft, { state: 'submitted', lead_id: 'FIN-OLD' });
  eq(resolve([oldDone], afterRotation).create, 1, 'the old cycle committed session leaked into the new cycle');
});

check('CASE D — an expired session is not revived', () => {
  const dead = row('AS-' + 'a'.repeat(64), {
    created_at: iso(-80 * HOUR), expires_at: iso(-8 * HOUR), draft_json: JSON.stringify(DRAFT)
  });
  eq(resolve([dead]).create, 1, 'an expired session was revived');
  // One second inside the TTL is still live; one second past it is not.
  eq(resolve([row('AS-' + 'a'.repeat(64), { expires_at: iso(1000) })]).create, 0, 'a session about to expire');
  eq(resolve([row('AS-' + 'a'.repeat(64), { expires_at: iso(-1000) })]).create, 1, 'a session just expired');
  eq(resolve([row('AS-' + 'a'.repeat(64), { expires_at: 'not-a-date' })]).create, 1, 'an unparseable expiry');
  eq(resolve([row('AS-' + 'a'.repeat(64), { expires_at: '' })]).create, 1, 'a missing expiry');
});

check('CASE E — a committed session resolves as COMMITTED, never as qualification', () => {
  const done = row('AS-' + 'a'.repeat(64), {
    state: 'submitted', lead_id: 'FIN-1', draft_json: JSON.stringify(DRAFT)
  });
  const r = resolve([done]);
  eq(r.create, 0, 'a committed session was replaced by a fresh empty one');
  eq(r.__response.state, 'submitted', 'the client must be told it is committed');
  eq(r.app_session_id, done.app_session_id, 'the committed session id');
});

check('CASE E2 — TERMINAL IS TERMINAL beyond the TTL: a committed session outlives expires_at', () => {
  // The customer's reviewed analysis arrives days later. A committed row that aged past the draft
  // TTL must still resolve as COMMITTED under its cycle — never as a fresh questionnaire.
  const aged = row('AS-' + 'a'.repeat(64), {
    state: 'submitted', lead_id: 'FIN-1', created_at: iso(-200 * HOUR), expires_at: iso(-128 * HOUR), draft_json: JSON.stringify(DRAFT)
  });
  const r = resolve([aged]);
  eq(r.create, 0, 'an aged committed session was replaced by a fresh one');
  eq(r.__response.state, 'submitted', 'not reported as committed');
  eq(r.lead_id, 'FIN-1', 'the committed lead is not carried server-side for the result lookup');
  assert(!('lead_id' in r.__response), 'lead_id leaked into the client response');
  // a DRAFT that aged the same way is still dead
  eq(resolve([Object.assign({}, aged, { state: 'draft', lead_id: '' })]).create, 1, 'an aged draft was revived');
});

check('EXECUTED: the customer result is attached ONLY from a CLIENT_READY row for the committed lead', () => {
  const done = row('AS-' + 'a'.repeat(64), { state: 'submitted', lead_id: 'FIN-1' });
  const resolved = resolve([done]);
  const attach = (rows) => {
    const outputs = { 'Resolve Session': [resolved] };
    const handle = (items) => ({ first: () => ({ json: items[0] }), all: () => items.map((j) => ({ json: j })), isExecuted: true });
    const fn = new Function('$', '$input', 'require', codeOf('Attach Client Result'));
    return fn((n) => handle(outputs[n]), handle(rows), () => { throw new Error('require()'); })[0].json;
  };
  const result = { score: 47, zone: 'ORANGE', key_risks: [{ title: 'x' }], plan_30_days: {} };
  const ready = { id: 1, lead_id: 'FIN-1', analysis_id: 'XA-1', locale: 'ru', review_status: 'CLIENT_READY', score: '47', zone: 'ORANGE', result_json: JSON.stringify(result), published_at: iso(-HOUR) };
  const a = attach([ready]);
  eq(JSON.stringify(a.__response.result), JSON.stringify(result), 'the CLIENT_READY result did not come back');
  eq(a.__response.result_state, 'CLIENT_READY', 'result_state');
  eq(a.__response.app_session_id, resolved.__response.app_session_id, 'the session answer was lost');
  eq(a.__response.state, 'submitted', 'state');
  // never anything that is not human-reviewed, never another lead's, never a broken row
  for (const bad of [[], [{}],
    [Object.assign({}, ready, { review_status: 'AI_DRAFT' })],
    [Object.assign({}, ready, { review_status: 'OWNER_REVIEW' })],
    [Object.assign({}, ready, { lead_id: 'FIN-2' })],
    [Object.assign({}, ready, { result_json: '{' })],
    [Object.assign({}, ready, { result_json: '[]' })]]) {
    const r = attach(bad);
    eq(r.__response.result, null, 'a result was attached from ' + JSON.stringify(bad).slice(0, 80));
    eq(r.__response.result_state, 'PENDING', 'result_state for ' + JSON.stringify(bad).slice(0, 80));
  }
  eq(attach([{ error: 'x' }]).result_store_error, 1, 'an unreadable result store did not fail closed');
  // several CLIENT_READY rows: the most recently published wins
  const older = Object.assign({}, ready, { id: 2, result_json: JSON.stringify({ v: 'old' }), published_at: iso(-3 * HOUR) });
  eq(attach([older, ready]).__response.result.score, 47, 'older, newer');
  eq(attach([ready, older]).__response.result.score, 47, 'newer, older');
});

check('the result lookup sits on the COMMITTED resume branch only, credential-free, and a draft answers as before', () => {
  const c = WF.connections;
  eq(c['IF Create Session'].main[1][0].node, 'IF Session Committed', 'the resume branch does not fork on state');
  eq(c['IF Session Committed'].main[0][0].node, 'Read Client Result', 'committed branch');
  eq(c['IF Session Committed'].main[1][0].node, 'Respond Bootstrap OK', 'a draft must answer directly');
  eq(c['Read Client Result'].main[0][0].node, 'Attach Client Result', 'the read feeds the attach');
  eq(c['Attach Client Result'].main[0][0].node, 'IF Result Store Readable', 'the attach feeds the store gate');
  eq(c['IF Result Store Readable'].main[0][0].node, 'Respond Bootstrap OK', 'readable result branch');
  eq(c['IF Result Store Readable'].main[1][0].node, 'Respond Application Store Unavailable', 'result-store outage branch');
  const node = WF.nodes.find((x) => x.name === 'Read Client Result');
  eq(node.parameters.operation, 'get', 'not a read');
  eq(node.parameters.filters.conditions[0].keyName, 'lead_id', 'not keyed by the committed lead');
  eq(node.alwaysOutputData, true, 'no result must still answer the bootstrap');
  eq(node.onError, 'continueRegularOutput', 'an unreadable result store must still answer the bootstrap');
  assert(!node.credentials, 'the result read carries a credential');
  const gate = WF.nodes.find((x) => x.name === 'IF Session Committed').parameters.conditions.conditions[0];
  eq(gate.leftValue, '={{ $json.state }}', 'the fork reads something other than the stored state');
  eq(gate.rightValue, 'submitted', 'the fork is not on submitted');
});

check('a superseded or unknown state is never authoritative', () => {
  for (const st of ['superseded', 'abandoned', '', 'DRAFT', 'Submitted']) {
    eq(resolve([row('AS-' + 'a'.repeat(64), { state: st })]).create, 1, 'state ' + JSON.stringify(st) + ' was resumed');
  }
});

// ── 3. one authoritative draft per user + cycle ────────────────────────────────────────────────

check('with several live rows, exactly ONE is authoritative and the rule is total', () => {
  const rows = [
    row('AS-' + 'a'.repeat(64), { created_at: iso(-5 * HOUR) }),
    row('AS-' + 'b'.repeat(64), { created_at: iso(-1 * HOUR) }),
    row('AS-' + 'd'.repeat(64), { created_at: iso(-3 * HOUR) })
  ];
  const want = 'AS-' + 'b'.repeat(64);
  // Every ordering of the same rows must produce the same winner: the rule is a total order over
  // the data, not an artefact of how the store happened to return it.
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    eq(resolve(p.map((i) => rows[i])).app_session_id, want, 'permutation ' + p.join(''));
  }
});

check('the tie-break is total, so identical timestamps still yield ONE winner', () => {
  const t = iso(-HOUR);
  const a = row('AS-' + 'a'.repeat(64), { created_at: t });
  const b = row('AS-' + 'b'.repeat(64), { created_at: t });
  eq(resolve([a, b]).app_session_id, b.app_session_id, 'a,b');
  eq(resolve([b, a]).app_session_id, b.app_session_id, 'b,a — the order of the read changed the winner');
});

// ── 4. the race ────────────────────────────────────────────────────────────────────────────────

check('RACE — two concurrent opens converge on ONE authoritative session', () => {
  // Both executions win their own G5 claim (different signed contexts), both read an empty store,
  // both mint, both insert, and both then re-read the SAME two rows.
  const candA = candidate({ app_session_id: 'AS-' + '1'.repeat(64), created_at: iso(0) });
  const candB = candidate({ app_session_id: 'AS-' + '2'.repeat(64), created_at: iso(1) });

  eq(resolve([], candA).create, 1, 'A found nothing, as expected');
  eq(resolve([], candB).create, 1, 'B found nothing, as expected');

  const afterBoth = [candA, candB];
  const a = finalise(afterBoth, candA);
  const b = finalise(afterBoth, candB);
  eq(a.app_session_id, b.app_session_id, 'THE TWO OPENS DISAGREED — there would be two authoritative drafts');
  eq(a.app_session_id, candB.app_session_id, 'the later mint wins');
  // The one that lost knows it resumed someone else's row; the winner knows it did not.
  eq(a.__response.resumed, true, 'the loser is not marked as a resume');
  eq(b.__response.resumed, false, 'the winner is marked as a resume');
  // And a THIRD open later resolves to the same row, so the loser never becomes authoritative.
  eq(resolve(afterBoth).app_session_id, candB.app_session_id, 'a later open picked the orphan');
  // C3 — the read order of the two rows changes nothing: the rule is a total order.
  eq(finalise(afterBoth.slice().reverse(), candA).app_session_id, candB.app_session_id, 'read order changed the winner');
});

check('RACE — the loser row is inert, not merely unlikely', () => {
  const candA = candidate({ app_session_id: 'AS-' + '1'.repeat(64), created_at: iso(0) });
  const candB = candidate({ app_session_id: 'AS-' + '2'.repeat(64), created_at: iso(1) });
  const rows = [candA, candB];
  // Ten later opens, in every order, always the same answer.
  for (let i = 0; i < 10; i++) {
    const shuffled = i % 2 ? rows.slice().reverse() : rows.slice();
    eq(resolve(shuffled).app_session_id, candB.app_session_id, 'open ' + i);
  }
  // ...and it stops being considered at all once it expires.
  const expiredLoser = Object.assign({}, candA, { expires_at: iso(-1000) });
  eq(resolve([expiredLoser, candB]).app_session_id, candB.app_session_id, 'after the loser expires');
});

check('Finalise fails closed unless the read-back PROVES the row it just wrote', () => {
  const cand = candidate();
  // empty read-back: the insert is unproven
  const r = finalise([], cand);
  eq(r.persistence_error, 1, 'an empty readback was reported as success');
  assert(!r.__response, 'an unproven insert produced a client success body');
  // unreadable read-back: an outage, never "no rows"
  eq(finalise([{ error: 'store down' }], cand).persistence_error, 1, 'an unreadable readback was reported as success');
  eq(finalise([{ errorMessage: 'timeout' }], cand).persistence_error, 1, 'an errorMessage readback was reported as success');
  // a read-back holding only SOMEONE ELSE'S row does not prove ours
  const other = candidate({ app_session_id: 'AS-' + 'e'.repeat(64) });
  eq(finalise([other], cand).persistence_error, 1, 'another row was accepted as proof of ours');
  // ...while a read-back that contains our row answers, and under a concurrent open answers the winner
  const proven = finalise([cand], cand);
  eq(proven.app_session_id, cand.app_session_id, 'a proven insert lost its row');
  eq(proven.__response.ok, true, 'ok');
  eq(proven.__response.resumed, false, 'a fresh mint is not a resume');
  // the unproven verdict has a 503 branch of its own, and the responder is typed
  const c = WF.connections;
  eq(c['Finalise Session'].main[0][0].node, 'IF Session Persistence Verified', 'Finalise does not go through the persistence gate');
  eq(c['IF Session Persistence Verified'].main[1][0].node, 'Respond Application Store Unavailable', 'the unproven branch');
  eq(WF.nodes.find((n) => n.name === 'Respond Application Store Unavailable').parameters.options.responseCode, 503, 'not the number 503');
});

// ── 5. provenance ──────────────────────────────────────────────────────────────────────────────

check('PROVENANCE survives the round trip, byte for byte', () => {
  const existing = row('AS-' + 'a'.repeat(64), { draft_json: JSON.stringify(DRAFT) });
  const back = resolve([existing]).__response.draft;
  eq(JSON.stringify(back), JSON.stringify(DRAFT), 'the draft came back changed');
  eq(back.fields.role.source, 'user_confirmed', 'user_confirmed stayed user_confirmed');
  eq(back.fields.contact_name.source, 'telegram_carried', 'telegram_carried');
  eq(back.fields.business_activity.source, 'ai_inferred', 'ai_inferred stayed ai_inferred');
  eq(back.fields.business_activity.confirmed, true, 'the stored confirmed flag');
  eq(back.fields.contact_channel.value, 'telegram', 'the contact channel');
  eq(back.fields.company_name.at, DRAFT.fields.company_name.at, 'the provenance timestamp');
  eq(back.step, 'APP_SCALE', 'the step the client had reached');
});

check('a corrupt or empty draft resumes the SESSION without inventing answers', () => {
  for (const bad of ['', 'null', '{', '{"v":1}', '[]', 'undefined']) {
    const r = resolve([row('AS-' + 'a'.repeat(64), { draft_json: bad })]);
    eq(r.create, 0, 'draft ' + JSON.stringify(bad) + ' should still resume the session');
    eq(r.__response.draft, null, 'draft ' + JSON.stringify(bad) + ' produced a draft object');
  }
});

// ── 6. no side effects, and no widening ────────────────────────────────────────────────────────

check('resume performs NO write — the only write node is on the create branch', () => {
  const writers = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable' && n.parameters.operation !== 'get');
  eq(writers.length, 1, 'data-table writers');
  eq(writers[0].name, 'Create App Session', 'the writer');
  // It is reachable ONLY through IF Create Session's TRUE branch.
  const reach = new Set();
  (function walk(n) {
    if (reach.has(n) || n === 'IF Create Session') { return; }
    reach.add(n);
    const c = WF.connections[n];
    if (!c) { return; }
    c.main.forEach((b) => (b || []).forEach((e) => walk(e.node)));
  })('Gateway Webhook');
  assert(!reach.has('Create App Session'), 'the insert is reachable without passing the create decision');
  // And the Gateway still writes nothing else anywhere.
  const j = JSON.stringify(WF);
  assert(j.indexOf('googleSheets') === -1, 'the Gateway reaches Google Sheets');
  assert(j.indexOf('executeWorkflow') === -1, 'the Gateway calls another workflow');
  assert(j.indexOf('privacy_acknowledgements') === -1, 'the Gateway touches the privacy store');
  assert(j.indexOf('Pipeline') === -1, 'the Gateway touches Pipeline');
});

check('G5 and the verification half are untouched by the resume change', () => {
  const claim = WF.nodes.find((n) => n.name === 'G5 Replay Claim');
  assert(/on conflict \(replay_key\) do nothing/i.test(String(claim.parameters.query)), 'the atomic claim');
  assert(/as claimed/i.test(String(claim.parameters.query)), 'the verdict column');
  eq(claim.onError, 'continueErrorOutput', 'the store-outage branch');
  assert(!claim.alwaysOutputData, 'the P9-R2 pair reappeared on the claim');
  const verify = String(WF.nodes.find((n) => n.name === 'Verify InitData').parameters.jsCode);
  assert(verify.indexOf('MAX_AUTH_AGE_SECONDS = 900') !== -1, 'Telegram freshness changed');
  assert(verify.indexOf('e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d') !== -1, 'the Telegram production key changed');
  const build = String(WF.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode);
  assert(build.indexOf('TTL_SECONDS = 259200') !== -1, 'the 72 h TTL changed');
  assert(build.indexOf('crypto.randomBytes(32)') !== -1, 'the session id stopped being high-entropy');
  // Exactly one credential, still on the claim.
  const cred = WF.nodes.filter((n) => n.credentials);
  eq(cred.length, 1, 'nodes carrying credentials');
  eq(cred[0].name, 'G5 Replay Claim', 'the credential moved');
  eq(WF.settings.saveDataSuccessExecution, 'none', 'retention is on; raw initData would persist');
  eq(WF.settings.saveDataErrorExecution, 'none', 'error retention is on');
});

check('the client is never asked for an identity, and never given one', () => {
  const j = JSON.stringify(WF);
  // The resume key comes from the SERVER-derived Claim Verdict, never from the request body.
  for (const n of ['Resolve Session', 'Finalise Session']) {
    const c = codeOf(n);
    assert(c.indexOf("$('Build App Session')") !== -1, n + ' does not read the server-derived identity');
    assert(c.indexOf('Gateway Webhook') === -1, n + ' reads the REQUEST BODY to decide what to resume');
    // A READ, not the word. The rule's own comment says "returns an empty body", and a gate that
    // cannot tell prose from a property access is a gate that gets weakened the first time it
    // false-positives.
    assert(!/\bbody\s*[.[]/.test(c), n + ' dereferences a request body');
    assert(c.indexOf('$json.body') === -1, n + ' reads $json.body');
  }
  // And the answer carries no identity back.
  const r = resolve([row('AS-' + 'a'.repeat(64))]).__response;
  eq(Object.keys(r).sort().join(','), 'app_session_id,draft,expires_at,locale,ok,resumed,state', 'the response shape widened');
  assert(JSON.stringify(r).indexOf(OWNER) === -1, 'the response carries the Telegram user id');
  assert(j.indexOf('init_data') === -1 || /body\.init_data/.test(j), 'sanity');
  for (const n of ['Resolve Session', 'Finalise Session', 'Build Session Row']) {
    assert(codeOf(n).indexOf('init_data') === -1, n + ' touches raw initData');
  }
});

check('the bootstrap answer is assembled in JavaScript, not in a template branch', () => {
  const ok = WF.nodes.find((n) => n.name === 'Respond Bootstrap OK');
  eq(ok.parameters.responseBody, '={{ JSON.stringify($json.__response) }}', 'the response body');
  eq(ok.parameters.options.responseCode, 200, 'a literal number, never an expression that yields a string');
  assert(String(ok.parameters.responseBody).indexOf('?') === -1, 'a branch crept into the template');
});

// ── 7. the recorded customer-production blocker ────────────────────────────────────────────────

check('C3.1 — the cycle is resolved server-side, and the customer release stays an explicit deployment choice', () => {
  const build = String(WF.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode);
  const executable = build.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // The minted session row must carry the RESOLVED cycle; the only '' allowed is the refusal item
  // that never reaches the store (it is gated out by IF Cycle Resolved).
  assert(/cycle_id:\s*cycleId,/.test(executable), 'the minted session no longer carries the resolved cycle');
  assert(/cycle_unresolved:\s*1/.test(executable), 'the refusal item is gone');
  assert(!/cycle_id:\s*'',\s*\n\s*replay_key/.test(executable), 'Build App Session stamps an empty cycle_id on the session row again — the blocker is back');
  assert(/MiniApp_Cycle_Projection/.test(JSON.stringify(WF)), 'the Gateway no longer reads the cycle projection');
  assert(WF.nodes.some((n) => n.name === 'Respond Cycle Unresolved'), 'the unresolved-cycle refusal is gone');
  // Tracked pre-production candidates remain owner-only. Customer release requires resolving
  // both placeholders in one explicit, reviewed build; source artifacts never activate it.
  for (const [label, file] of [['session', 'premium-session-endpoint-candidate.json'], ['submit', 'premium-submit-endpoint-candidate.json']]) {
    const raw = readFileSync(join(ROOT, 'n8n', 'candidate', file), 'utf8');
    assert(raw.indexOf('NOT_AUTHORISED') !== -1, label + ' endpoint lost the owner-only pre-production gate');
    assert(raw.indexOf('__OWNER_TELEGRAM_ID__') !== -1, label + ' endpoint baked in an identity');
    assert(raw.indexOf('__MINIAPP_RELEASE_MODE__') !== -1, label + ' endpoint lost the explicit release-mode placeholder');
  }
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
