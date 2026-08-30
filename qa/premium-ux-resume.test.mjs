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
const NOW = Date.now();
const iso = (msFromNow) => new Date(NOW + msFromNow).toISOString();
const HOUR = 3600000;

// The candidate the Gateway just minted for THIS open.
const candidate = (over) => Object.assign({
  app_session_id: 'AS-' + 'c'.repeat(64),
  telegram_user_id: OWNER, chat_id: OWNER, cycle_id: '', replay_key: 'rk-new',
  state: 'draft', created_at: iso(0), expires_at: iso(72 * HOUR), updated_at: iso(0), draft_json: ''
}, over || {});

const row = (id, over) => Object.assign({
  app_session_id: id, telegram_user_id: OWNER, chat_id: OWNER, cycle_id: '', replay_key: 'rk',
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
  eq(c['IF Claim Won'].main[0][0].node, 'Build App Session', 'the claim still gates everything');
  eq(c['Build App Session'].main[0][0].node, 'Read User Sessions', 'the read follows the mint');
  eq(c['Read User Sessions'].main[0][0].node, 'Resolve Session', 'the resolver follows the read');
  eq(c['IF Create Session'].main[0][0].node, 'Build Session Row', 'create branch');
  eq(c['IF Create Session'].main[1][0].node, 'Respond Bootstrap OK', 'resume branch answers directly');
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
  eq(resolve([Object.assign({}, other, { cycle_id: '' })]).create, 0, 'the same cycle was not resumed');
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

check('Finalise never answers empty, even if the read-back comes back with nothing', () => {
  const cand = candidate();
  const r = finalise([], cand);
  eq(r.app_session_id, cand.app_session_id, 'it lost the row it had just written');
  eq(r.__response.ok, true, 'ok');
  eq(r.__response.resumed, false, 'a fresh mint is not a resume');
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

check('CUSTOMER PRODUCTION IS BLOCKED while cycle_id is empty, and the owner gate is what holds it', () => {
  // See docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md.
  //
  // The resume key is written as (telegram_user_id, cycle_id) and behaves as such — but the Gateway
  // cannot resolve a cycle, so `cycle_id` is '' and the key is effectively (user, ''). That is
  // accepted for OWNER-ONLY UAT and is a blocker for customer activation, because an explicit
  // new-request rotation cannot be seen and an old draft could still be resumed.
  //
  // What makes it acceptable meanwhile is that only the owner can reach a session at all. This
  // check ties the two facts together: while the cycle is unresolved, the owner gate must still be
  // on both endpoints. Removing it for customer activation without first resolving the cycle turns
  // this red rather than shipping the limitation to customers.
  const build = String(WF.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode);
  const cycleUnresolved = /cycle_id:\s*''/.test(build);

  const doc = readFileSync(join(ROOT, 'docs', 'CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md'), 'utf8');
  assert(doc.indexOf('CUSTOMER PRODUCTION = BLOCKED ON AUTHORITATIVE CYCLE PROJECTION') !== -1,
    'the blocker record no longer states the agreed status wording');
  assert(doc.indexOf('RU OWNER UAT       = READY') !== -1 || doc.indexOf('RU OWNER UAT = READY') !== -1,
    'the blocker record no longer states the UAT status');

  if (!cycleUnresolved) {
    // The cycle became resolvable. That is the good outcome, and it means this check has done its
    // job — but the six-point activation gate still has to be worked through deliberately, so the
    // record must say so rather than being quietly stale.
    assert(doc.indexOf('customer-activation gate') !== -1,
      'cycle_id is now resolved: re-read the activation gate in the blocker record before removing the owner gate');
    return;
  }

  for (const [label, file] of [['session', 'premium-session-endpoint-candidate.json'],
    ['submit', 'premium-submit-endpoint-candidate.json']]) {
    const raw = readFileSync(join(ROOT, 'n8n', 'candidate', file), 'utf8');
    assert(raw.indexOf('NOT_AUTHORISED') !== -1,
      label + ' endpoint: the owner gate is GONE while cycle_id is still empty — that is customer ' +
      'activation with the cycle blocker unresolved. See docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md');
    assert(/s\.telegram_user_id/.test(raw),
      label + ' endpoint: the owner gate no longer reads the SERVER-stored identity');
    assert(raw.indexOf('__OWNER_TELEGRAM_ID__') !== -1,
      label + ' endpoint: the owner id is baked into the tracked candidate instead of a placeholder');
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
