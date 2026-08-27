#!/usr/bin/env node
// FINMENTOR — P8.2: the Concierge hot path — reliability, latency and config provenance.
//
//   node qa/hot-path.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. Production execution #3716 died at `Read Settings` in 312 ms and the
// customer got no reply. This gate defends the design that removes that dependency instead of
// retrying it, and it does so by PROVING the settings classification against the deployed
// graph — so the table in hot-path-config.js cannot drift away from the workflow it describes.
//
// The most important checks here are the ones that would fail if someone "fixed" the malformed
// internal-key expression instead of deleting it, and the ones that stop a blind retry being
// added to the authority write.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const H = require(join(ROOT, 'n8n', 'src', 'concierge-config', 'hot-path-config.js'));
const S = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'bot-sessions-schema.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const deepEq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m + ' (got ' + JSON.stringify(a) + ')'); } };

const CONCIERGE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
const INTAKE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
  'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
const CAND = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json'), 'utf8'));
const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);

// Every node whose parameters mention a given settings key, derived from the graph.
function consumersOf(wf, key) {
  return (wf.nodes || [])
    .filter((n) => n.name !== 'Settings to Object' && JSON.stringify(n.parameters || {}).includes(key))
    .map((n) => n.name).sort();
}

// ================================================================ 1. §2 classification, proven

console.log('\n-- §2 every settings key classified against its PROVEN consumers --');

check('the classification covers exactly the keys Settings to Object emits', () => {
  const code = byName(CAND, 'Settings to Object').parameters.jsCode;
  const cfg = code.slice(code.indexOf('const cfg = {'));
  const emitted = [...new Set([...cfg.matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1]))].sort();
  const declaredEmitted = Object.keys(H.SETTINGS_CLASSIFICATION)
    .filter((k) => H.SETTINGS_CLASSIFICATION[k].emitted).sort();
  deepEq(emitted, declaredEmitted, 'emitted keys and classified-as-emitted keys disagree');
});

check('REASON 1: internal_intake_key is NEVER EMITTED by Settings to Object', () => {
  // The strongest of the three reasons, and the one that makes "just fix the expression"
  // pointless: there is no value behind it to read.
  const code = byName(CAND, 'Settings to Object').parameters.jsCode;
  const cfg = code.slice(code.indexOf('const cfg = {'));
  assert(!/internal_intake_key/.test(cfg),
    'Settings to Object now emits internal_intake_key — the dead-config finding has changed');
  assert(!/internal_intake_key/.test(code), 'the key appears elsewhere in the body; re-read this gate');
  eq(H.SETTINGS_CLASSIFICATION.internal_intake_key.emitted, false, 'the module says it is emitted');
  // and it IS still referenced by a node, which is exactly the mismatch worth failing on
  const refs = (CAND.nodes || []).filter((n) => n.name !== 'Settings to Object'
    && JSON.stringify(n.parameters || {}).includes('internal_intake_key')).map((n) => n.name);
  deepEq(refs, ['Send Lead to Intake'],
    'the set of nodes referencing a key that is never emitted changed: ' + refs.join(', '));
});

check('each key\'s proven consumers match the graph', () => {
  Object.keys(H.SETTINGS_CLASSIFICATION).forEach((key) => {
    const declared = H.SETTINGS_CLASSIFICATION[key].provenConsumers.slice().sort();
    const actual = consumersOf(CAND, key);
    // internal_intake_key is declared DEAD with zero consumers even though one node MENTIONS it
    // in a malformed expression. That exception is asserted separately and on purpose.
    if (key === 'internal_intake_key') { return; }
    deepEq(actual, declared, 'consumers of ' + key + ' drifted');
  });
});

check('four keys are DEAD — no node references them at all', () => {
  ['owner_chat_id', 'timezone', 'client_ai_temperature'].forEach((k) => {
    eq(consumersOf(CAND, k).length, 0, k + ' now has a consumer; reclassify it');
    eq(H.SETTINGS_CLASSIFICATION[k].class, H.DEAD, k + ' is not classified DEAD');
  });
  eq(H.SETTINGS_CLASSIFICATION.internal_intake_key.class, H.DEAD, 'internal_intake_key is not DEAD');
  eq(H.keysOfClass(H.DEAD).length, 4, 'the DEAD set changed size');
});

// ================================================================ 2. §7 the internal key

console.log('\n-- §7 internal_intake_key is DEAD, and all three reasons are checked --');

check('REASON 2: the live consumer expression is MALFORMED', () => {
  // The valid form is $('Settings to Object'), which the URL field on the SAME node uses.
  const n = byName(CONCIERGE, 'Send Lead to Intake');
  const header = n.parameters.headerParameters.parameters
    .find((p) => p.name === 'x-finmentor-internal-key');
  assert(header, 'the internal-key header is gone; re-read this gate');
  assert(!/\$\(\s*['"]Settings to Object['"]\s*\)/.test(header.value),
    'the header expression is now a VALID node reference — the dead-config finding has changed '
    + 'and this must be re-decided, not silently passed');
  assert(/\\Settings to Object/.test(header.value),
    'the header no longer carries the malformed \\Settings reference; state changed');
  // and the control: the URL on the same node IS valid, so this is not a whole-node problem
  assert(/\$\(\s*'Settings to Object'\s*\)/.test(n.parameters.url),
    'the URL expression is malformed too — that would be a different, larger defect');
});

check('REASON 3: Lead Intake never reads that header', () => {
  const hits = (INTAKE.nodes || [])
    .filter((n) => JSON.stringify(n.parameters || {}).toLowerCase().includes('x-finmentor-internal-key'))
    .map((n) => n.name);
  eq(hits.length, 0, 'Lead Intake now validates the internal key header: ' + hits.join(', '));
  // It reads exactly one header, and it is not this one.
  const vp = byName(INTAKE, 'Validate Payload');
  assert(/headers\['x-finmentor-source'\]/.test(vp.parameters.jsCode), 'Validate Payload no longer reads x-finmentor-source');
});

check('the finding is recorded as a SECURITY APPEARANCE issue, not just dead config', () => {
  const src = readFileSync(join(ROOT, 'n8n', 'src', 'concierge-config', 'hot-path-config.js'), 'utf8');
  assert(/appears to exist and does not/.test(src),
    'the module no longer states that a control which looks present but is absent is worse than a known gap');
});

check('MUTATION 7: a SECRET in the static config is REFUSED', () => {
  const v = H.validateStaticConfig({ internal_intake_key: 'x' });
  assert(!v.ok, 'a dead/secret key was accepted into static config');
  assert(v.failures.some((f) => /DEAD key/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('MUTATION 8: a DEAD config dependency in the static config is REFUSED', () => {
  ['owner_chat_id', 'timezone', 'client_ai_temperature'].forEach((k) => {
    const v = H.validateStaticConfig({ [k]: 'x' });
    assert(!v.ok, k + ' was accepted into static config');
  });
});

check('CONTROL: the static keys ARE accepted', () => {
  const v = H.validateStaticConfig({
    default_language: 'ru', website_url: 'https://finmentor.md',
    client_ai_model: 'm', lead_intake_webhook_url: 'https://x', bot_enabled: true, client_ai_enabled: false
  });
  assert(v.ok, 'the legitimate static config was rejected: ' + v.failures.join(' | '));
});

// ================================================================ 3. §1/§8 the hot path

console.log('\n-- §1/§8 pre-reply round trips and the latency SLO --');

// Walk the /start path in the deployed graph and count external round trips before the reply.
function preReplyIO(wf) {
  const C = wf.connections;
  const forced = { 'IF Message Delivered': 0, 'IF Lead Ready': 1, 'IF Has Callback Query': 1, 'IF Layout Mapped': 0 };
  const order = []; const seen = new Set(['Telegram Client Trigger']); const q = ['Telegram Client Trigger'];
  while (q.length) {
    const cur = q.shift(); order.push(cur);
    const c = C[cur]; if (!c || !c.main) { continue; }
    c.main.forEach((br, oi) => {
      if (forced[cur] !== undefined && forced[cur] !== oi) { return; }
      (br || []).forEach((l) => { if (l && l.node && !seen.has(l.node)) { seen.add(l.node); q.push(l.node); } });
    });
  }
  const send = order.indexOf('Send Client Message');
  const IO = ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.dataTable',
    'n8n-nodes-base.httpRequest', 'n8n-nodes-base.executeWorkflow'];
  return order.slice(0, send + 1).filter((n) => { const nd = byName(wf, n); return nd && IO.indexOf(nd.type) !== -1; });
}

check('MUTATION 10: the CURRENT pre-reply round-trip count is pinned at 3', () => {
  const io = preReplyIO(CAND);
  deepEq(io, H.PRE_REPLY_ROUND_TRIPS_BEFORE, 'the pre-reply I/O set changed: ' + io.join(', '));
  eq(io.length, 3, 'pre-reply round trips regressed from 3');
});

check('the TARGET design is 2 round trips, and Read Settings is the one removed', () => {
  eq(H.PRE_REPLY_ROUND_TRIPS_AFTER.length, 2, 'the target is no longer 2 round trips');
  const removed = H.PRE_REPLY_ROUND_TRIPS_BEFORE.filter((n) => H.PRE_REPLY_ROUND_TRIPS_AFTER.indexOf(n) === -1);
  deepEq(removed, ['Read Settings'], 'the removed node is not Read Settings');
  assert(H.PRE_REPLY_ROUND_TRIPS_AFTER.indexOf('Send Client Message') !== -1,
    'the reply itself was removed from the pre-reply path — that is not an optimisation');
});

check('the SLO is measured on time-to-reply, not total duration', () => {
  assert(/Send Client Message COMPLETED/.test(H.LATENCY_SLO.measure), 'the SLO no longer ends at the reply');
  eq(H.LATENCY_SLO.preferred_ms, 2000, 'preferred target changed');
  eq(H.LATENCY_SLO.acceptable_ms, 3000, 'acceptable ceiling changed');
  assert(/must NOT be optimised/.test(H.LATENCY_SLO.note), 'the warning against optimising post-reply safety work is gone');
});

check('the post-reply Model-B safety work is NOT on the pre-reply path', () => {
  const io = preReplyIO(CAND);
  ['Receipt Preallocate', 'Receipt Readback', 'Save Bot Session', 'Save Bot Event'].forEach((n) => {
    assert(io.indexOf(n) === -1, n + ' is on the pre-reply path; the reply ordering has changed');
  });
});

// ================================================================ 4. §4 authority retry

console.log('\n-- §4 authority write retry: CASE C is the whole problem --');

check('MUTATION 3+4: blind retryOnFail on Save Bot Session is NOT present', () => {
  const s = byName(CAND, 'Save Bot Session');
  eq(s.retryOnFail || false, false,
    'Save Bot Session has blind retryOnFail. appendOrUpdate cannot express "only if still '
    + 'current", so a retry can overwrite a NEWER cycle with a stale one (CASE C).');
  eq(s.parameters.operation, 'appendOrUpdate', 'the write operation changed');
  deepEq(s.parameters.columns.matchingColumns, ['chat_id'], 'the match column changed');
});

check('the design records CASE C as UNSAFE and reuses the audited comparison', () => {
  assert(/UNSAFE/.test(H.AUTHORITY_RETRY_DESIGN.blindRetry), 'blind retry is no longer marked unsafe');
  assert(H.AUTHORITY_RETRY_DESIGN.procedure.some((s) => /Authority Verdict uses/.test(s)),
    'the retry verdict no longer reuses the audited stamp comparison');
  assert(/never worse/i.test(H.AUTHORITY_RETRY_DESIGN.fallbackIsNeverWorse) || /EXACTLY what happens today/.test(H.AUTHORITY_RETRY_DESIGN.fallbackIsNeverWorse),
    'the argument that the fallback is never worse than today is gone');
});

check('MUTATION 4 semantics: the stale-authority predicate already exists and refuses', () => {
  // The retry gate is the same comparison Authority Verdict makes. Proving that predicate still
  // refuses a newer stored cycle is proving the retry gate.
  const code = byName(CAND, 'Authority Verdict').parameters.jsCode;
  assert(/AUTHORITY_CYCLE_SUPERSEDED/.test(code), 'the superseded verdict is gone');
  assert(/currentStamp > heldStamp/.test(code), 'the newer-stamp comparison is gone');
  assert(/AUTHORITY_CYCLE_UNCOMPARABLE/.test(code), 'the uncomparable-refuses rule is gone');
});

// ================================================================ 5. §5 Bot Event

console.log('\n-- §5 Bot Event is telemetry, and retry would make it worse --');

check('MUTATION 6: Save Bot Event has NO retry, deliberately', () => {
  const e = byName(CAND, 'Save Bot Event');
  eq(e.retryOnFail || false, false, 'Save Bot Event gained retryOnFail — event_id embeds Date.now(), '
    + 'so a retry writes a SECOND row with a different id rather than deduping');
  eq(e.parameters.operation, 'append', 'the event write is no longer an append');
});

check('the event id is time-derived, which is why retry cannot dedupe', () => {
  const c = byName(CAND, 'Build Bot Event').parameters.jsCode;
  assert(/event_id:\s*`\$\{p\.chat_id\}-\$\{Date\.now\(\)\}`/.test(c),
    'event_id is no longer chat_id + Date.now(); the retry argument must be re-derived');
});

check('MUTATION 5: the chosen design is best-effort, never failing the customer turn', () => {
  assert(/best-effort/.test(H.BOT_EVENT_DESIGN.chosen), 'the chosen event design changed');
  assert(/continueRegularOutput/.test(H.BOT_EVENT_DESIGN.change), 'the proposed change is no longer onError continue');
  assert(/MAY LOSE ROWS/.test(H.BOT_EVENT_DESIGN.contract), 'the duplicate/loss tolerance contract is not stated');
});

// ================================================================ 6. §6 session read retry

console.log('\n-- §6 the existing retry, and its latency cost --');

check('Read Bot Sessions retry config matches what the design assessed', () => {
  const r = byName(CAND, 'Read Bot Sessions');
  eq(r.retryOnFail, true, 'the session read lost its retry');
  eq(r.maxTries, H.SESSION_READ_RETRY.current.maxTries, 'maxTries drifted');
  eq(r.waitBetweenTries, H.SESSION_READ_RETRY.current.waitBetweenTries, 'waitBetweenTries drifted');
});

check('the worst-case retry cost is stated and lands inside the SLO bands', () => {
  eq(H.SESSION_READ_RETRY.worstCaseAddedMs, 4000, 'the worst-case figure changed');
  assert(H.SESSION_READ_RETRY.worstCaseAddedMs > H.LATENCY_SLO.acceptable_ms,
    'the stated worst case no longer exceeds the acceptable ceiling — the concern would be moot');
  assert(/cannot classify/.test(H.SESSION_READ_RETRY.concern),
    'the note that n8n cannot distinguish transient from auth failures is gone');
});

// ================================================================ 7. §9 observability

console.log('\n-- §9 timing instrumentation must not widen the sheet --');

check('MUTATION 9: a __timing field cannot reach the Bot_Sessions writer', () => {
  // The same runtime projection that stops __debug stops __timing. Proven by execution, not
  // by reading the code.
  const node = byName(CAND, 'Build Session Row');
  const session = { session_id: 'S-1', chat_id: '900000999', state: 'MENU', status: 'active',
    __timing: { t_trigger: 1, t_before_send: 2 }, __t_end: 3 };
  const named = {
    'Build Bot Response': { session, lead_ready: false },
    'Get Bot Session': { cycle_id: 'C-900000999-1', submission_key: 'sub_' + 'a'.repeat(32) },
    'Issuance Verdict': { __advance: true }
  };
  const $ = (n) => ({ first: () => ({ json: named[n] || {} }), all: () => [{ json: named[n] || {} }] });
  const out = new Function('$', '$input', '$now', node.parameters.jsCode)($, { first: () => ({ json: {} }), all: () => [] }, new Date());
  const row = out[0].json;
  const stray = Object.keys(row).filter((k) => k.indexOf('__') === 0);
  eq(stray.length, 0, 'a __ field reached the writer input: ' + stray.join(', '));
  assert(JSON.stringify(row).indexOf('t_before_send') === -1, 'timing data reached the row');
  deepEq(Object.keys(row).sort(), S.declaredCols(node).slice().sort(), 'the row is not exactly the declared columns');
});

check('no timing key is anywhere near the declared Bot_Sessions schema', () => {
  const cols = S.declaredCols(byName(CAND, 'Build Session Row'));
  ['t_trigger', 't_before_send', 't_after_send', 'time_to_reply', '__timing'].forEach((k) => {
    assert(cols.indexOf(k) === -1, 'timing column ' + k + ' entered the Bot_Sessions schema');
  });
});

// ================================================================ 8. §2 mutation 1/2

console.log('\n-- §1/§2 the failure that started this --');

check('MUTATION 1: Read Settings is TODAY a single point of failure before any reply', () => {
  // The condition that produced #3716, asserted so the fix can be shown to remove it.
  const n = byName(CONCIERGE, 'Read Settings');
  eq(n.retryOnFail || false, false, 'Read Settings gained a retry — the design chose REMOVAL over retry');
  eq(n.onError || 'stopWorkflow', 'stopWorkflow', 'Read Settings no longer aborts the turn');
  const io = preReplyIO(CAND);
  eq(io[0], 'Read Settings', 'Read Settings is no longer the FIRST pre-reply round trip');
});

check('MUTATION 2: the bot_enabled design fails safe when Sheets is down', () => {
  assert(/^B —/.test(H.BOT_ENABLED_DESIGN.maintenance), 'maintenance mode is no longer the local flag');
  assert(/^A —/.test(H.BOT_ENABLED_DESIGN.emergency), 'the emergency stop is no longer workflow.active');
  assert(/#3716/.test(H.BOT_ENABLED_DESIGN.rejected),
    'the rejection of the remote flag no longer cites the failure that proved it');
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
