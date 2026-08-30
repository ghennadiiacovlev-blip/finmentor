#!/usr/bin/env node
// FINMENTOR — prove the bootstrap wiring and the submit mechanism on the TENANT.
//
//   node scripts/verify-miniapp-bootstrap-live.mjs
//
// ── WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
//
// It reads the three deployed workflows and it probes them along REFUSED paths only: a malformed
// bootstrap body, an unknown session, a missing acknowledgement. Every one of those is answered
// before any write, so this script cannot create a session, an acknowledgement, a lead or a
// Pipeline row, and it cannot induce an outage in anything.
//
// It does NOT drive a successful submission. That needs genuine Telegram-signed initData, which
// only the owner opening the Mini App can produce — and it would put a real lead in the production
// Pipeline. The exactly-once behaviour behind it is proven instead by
// qa/premium-ux-submit-idempotency.test.mjs, which EXECUTES this same graph, node by node, against
// a store model whose facts were measured here: the unique index exists, the writer role holds
// INSERT and not SELECT, and Lead Intake's receipt machine is separately gated and already proven
// live by P9-R4.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const HOST_ID = 'KBD7Q94QQnlzgYKJ';
const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const SESSION_ID_WF = 'Hxje3Kel6nLLod5B';
const SUBMIT_ID = 'ELiPdw4mdxQbBaan';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

let pass = 0;
const fail = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));

const get = async (id) => {
  const r = await fetch(BASE + '/api/v1/workflows/' + id, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { console.error('STOPPED: GET ' + id + ' -> ' + r.status); process.exit(1); }
  return r.json();
};
async function post(path, payload, method) {
  const r = await fetch(BASE + '/webhook/' + path, {
    method: method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const t = await r.text();
  let body = null;
  try { body = t ? JSON.parse(t) : null; } catch (e) { body = { __raw: t.slice(0, 200) }; }
  return { status: r.status, body };
}

console.log('');
console.log('Mini App bootstrap + submit — LIVE verification');
console.log('='.repeat(78));

const host = await get(HOST_ID);
const gw = await get(GATEWAY_ID);
const sess = await get(SESSION_ID_WF);
const sub = await get(SUBMIT_ID);
const page = String(host.nodes.find((n) => n.name === 'Serve Page').parameters.responseBody || '');
console.log('  host ' + page.length + ' bytes | gateway ' + gw.nodes.length + ' nodes | session ' +
  sess.nodes.length + ' | submit ' + sub.nodes.length + ' | all active: ' +
  [host, gw, sess, sub].every((w) => w.active));
console.log('');

// ── 1. the served page IS the gated source ─────────────────────────────────────────────────────
console.log('THE DEPLOYED CLIENT');
for (const f of ['app.js', 'net.js', 'content.js', 'app.css']) {
  want(page.indexOf(readFileSync(join(ROOT, 'app-premium', f), 'utf8')) !== -1,
    'the served page contains ' + f + ' byte-for-byte');
}
console.log('');

console.log('THE STARTUP SEQUENCE, IN THE SERVED BYTES');
const seq = [
  ['tg.ready(); tg.expand();', 'Telegram is readied and expanded at load'],
  ['function startup()', 'a startup sequence exists at all'],
  ["state = 'APP_STARTING'", 'the app starts in APP_STARTING, not on an interactive screen'],
  ['window.FM_NET.bootstrap(locale)', 'bootstrap() is CALLED — the defect this closes'],
  ['startup();', 'startup runs at load'],
  ['if (bootstrapPromise) { return bootstrapPromise; }', 'ONE bootstrap per page lifecycle, memoised'],
  ['client_version: GATEWAY_CLIENT_VERSION', 'the client_version the Gateway validates first'],
  ["locale: locale === 'ro' ? 'ro' : 'ru'", 'the locale the Gateway validates second'],
  ["initData = '';", 'the raw initData reference is dropped after use'],
  ["body.init_data = '';", 'and so is the copy in the request body'],
  ['function flushDraft()', 'the draft is written server-side'],
  ['window.FM_NET.saveDraft(step, draft.fields)', 'saveDraft() is CALLED'],
  ['function draftSettled()', 'submit waits for the draft to land'],
  ['function submitReady()', 'the submit precondition'],
  ['APP_BOOT_FAILURE', 'the bootstrap failure screen'],
  ['APP_SESSION_EXPIRED', 'the session failure screen'],
  ['window.FM_NET.isCommitted(r)', 'a committed replay renders as success'],
  ['window.FM_NET.resumedDraft()', 'the client hydrates from the resumed draft'],
  ['function scrResume()', 'the resume screen exists'],
  ['function restartBrief()', 'and «Начать заново» clears the brief in place'],
  ["state = restored > 0 ? 'APP_RESUME' : 'APP_BOOTSTRAP'", 'a resumed brief is announced, not silently continued'],
  ["if (window.FM_NET.sessionState() === 'submitted')", 'a committed session reopens to its result']
];
for (const [needle, what] of seq) { want(page.indexOf(needle) !== -1, what); }
want(page.indexOf('window.FM_NET.submit(submitAck)') !== -1, 'submit still sends the session id and the acknowledgement');
console.log('');

// ── 2. the Gateway body contract, live ─────────────────────────────────────────────────────────
//
// Every probe below is refused BEFORE the replay claim, so no session is minted and the G5 ledger
// is not touched. Verified structurally: Verify InitData -> IF Verified -> Respond Rejected, and
// the claim sits on the TRUE branch only.
console.log('THE GATEWAY BODY CONTRACT (refused paths only — no session is minted)');
const GW = 'finmentor-miniapp-gateway';
{
  const noVersion = await post(GW, { init_data: 'user=%7B%22id%22%3A1%7D&auth_date=1&signature=x&hash=y' });
  want(noVersion.body && noVersion.body.error_code === 'CLIENT_VERSION_UNSUPPORTED',
    'a body carrying ONLY init_data is refused CLIENT_VERSION_UNSUPPORTED — the second defect, live: '
    + JSON.stringify(noVersion.body));

  const badLocale = await post(GW, { init_data: 'x', client_version: 'b2.1.0', locale: 'en' });
  want(badLocale.body && badLocale.body.error_code === 'BAD_REQUEST', 'an unsupported locale is refused');

  const badVersion = await post(GW, { init_data: 'x', client_version: 'b3.0.0', locale: 'ru' });
  want(badVersion.body && badVersion.body.error_code === 'CLIENT_VERSION_UNSUPPORTED',
    'a WRONG client_version is refused — b2.1.0 is the only accepted value');

  // The exact body the deployed client now sends, with an unsigned context. It must get PAST the
  // body checks and fail on the signature, which is the proof the client's shape is right.
  const wellFormed = await post(GW, {
    init_data: 'auth_date=1788000000&signature=AAAA&user=%7B%22id%22%3A1%7D&hash=deadbeef',
    client_version: 'b2.1.0', locale: 'ru'
  });
  const code = wellFormed.body && wellFormed.body.error_code;
  want(String(code).startsWith('TG_'),
    "the client's body reaches Ed25519 verification and fails there, not on shape: " + code);
  want(code !== 'CLIENT_VERSION_UNSUPPORTED' && code !== 'BAD_REQUEST', 'no body-shape refusal remains');
}
console.log('');

// ── 3. the submit endpoint, live, along refused paths ──────────────────────────────────────────
console.log('THE SUBMIT ENDPOINT (refused paths only — nothing is written)');
const SUB = 'finmentor-miniapp-submit';
const ACK = { notice_version: 'pn-2026-08', locale: 'ru', shown_at: '2026-08-30T10:00:00.000Z', acknowledged_at: '2026-08-30T10:00:01.000Z' };
{
  const noId = await post(SUB, { privacy_ack: ACK });
  want(noId.status === 400 && noId.body.error_code === 'BAD_REQUEST', 'a missing session id is refused 400');

  const noAck = await post(SUB, { app_session_id: 'AS-' + 'a'.repeat(64) });
  want(noAck.status === 409 && noAck.body && noAck.body.error_code === 'CONSENT_REQUIRED',
    'a missing acknowledgement is refused 409 CONSENT_REQUIRED, not flattened to BAD_REQUEST: ' + JSON.stringify(noAck));

  const unknown = await post(SUB, { app_session_id: 'AS-' + 'f'.repeat(64), privacy_ack: ACK });
  want(unknown.status === 401 && unknown.body && unknown.body.error_code === 'SESSION_INVALID',
    'an unknown session is refused 401 SESSION_INVALID with a BODY: ' + JSON.stringify(unknown));
  want(unknown.body && unknown.body.retryable === false, 'and it is stated NON-retryable, so the client shows no Retry');

  const badAck = await post(SUB, { app_session_id: 'AS-' + 'a'.repeat(64), privacy_ack: { notice_version: 'x' } });
  want(badAck.body && badAck.body.error_code === 'CONSENT_REQUIRED', 'a malformed acknowledgement is refused');
}
console.log('');

console.log('THE SESSION ENDPOINT (refused paths only)');
{
  const bad1 = await post('finmentor-miniapp-session', { app_session_id: 'nope', step: 'APP_COMPANY', fields: {} }, 'PUT');
  want(bad1.body && bad1.body.error_code === 'BAD_REQUEST', 'a malformed session id is refused');
  const bad2 = await post('finmentor-miniapp-session', { app_session_id: 'AS-' + 'f'.repeat(64), step: 'APP_COMPANY', fields: {} }, 'PUT');
  want(bad2.body && bad2.body.ok !== true, 'an unknown session cannot write a draft');
}
console.log('');

// ── 4. the deployed submit graph ───────────────────────────────────────────────────────────────
console.log('THE DEPLOYED SUBMIT MECHANISM');
const codeOf = (w, n) => String((w.nodes.find((x) => x.name === n) || { parameters: {} }).parameters.jsCode || '');
{
  want(sub.nodes.length === 26, 'the endpoint has 26 nodes (+7 for the caller-side receipt contract)');
  for (const n of ['Privacy Verdict', 'IF Privacy Recorded', 'IF Payload Built', 'Respond Submit Terminal']) {
    want(!!sub.nodes.find((x) => x.name === n), 'node present: ' + n);
  }
  const st = codeOf(sub, 'Submit State');
  want(/const submission_key = "sub_" \+ crypto/.test(st), 'D4 — the submission key is DERIVED in Submit State');
  want(st.indexOf('"miniapp:" + String(s.app_session_id)') !== -1, 'and it is derived from the session, nothing else');
  want(st.indexOf('already: 1') !== -1 && st.indexOf('__response: { ok: true, already: true') !== -1,
    'D7 — a committed session is answered ok:TRUE with its lead, in Submit State');
  want(st.indexOf('DRAFT_EMPTY') !== -1, 'an empty draft has its own refusal');

  const pv = codeOf(sub, 'Privacy Verdict');
  want(/23505|duplicate key/.test(pv), 'D5 — the duplicate-key refusal is read as ALREADY RECORDED');
  want(pv.indexOf('PRIVACY_UNRESOLVED') !== -1, 'and an unproven acknowledgement stops the flow');

  // The 14:42 defect, on the tenant. The statement declares $1..$7; if options carries nothing,
  // Postgres refuses it with 42P02 before the transaction begins and every submission dies at the
  // privacy write. n8n splits this field on commas BEFORE resolving, so each segment carries its
  // own leading '='. Offline this is gated against the candidate; here it is read off the tenant,
  // where a hand-edit in the UI is the way it would come back.
  const pwNode = sub.nodes.find((n) => n.name === 'Write Privacy Acknowledgement');
  const bindSql = String(pwNode.parameters.query || '');
  const bindSegs = String((pwNode.parameters.options || {}).queryReplacement || '').split(',').filter(Boolean);
  const bindDeclared = new Set((bindSql.match(/\$\d+/g) || []).map((p) => Number(p.slice(1))));
  want(bindSegs.length === bindDeclared.size && bindSegs.length === 7,
    'the privacy insert binds all seven declared parameters — options:{} is 42P02 and a dead submit');
  want(bindSegs.every((s) => /^=\{\{ \$json\.[a-z_]+ \}\}$/.test(s)),
    'every binding segment carries its own leading = , because n8n splits before it resolves');
  want(bindSql.slice(bindSql.indexOf('(') + 1, bindSql.indexOf(')')).split(',').map((c) => c.trim())
    .every((col, i) => bindSegs[i] === '={{ $json.' + col + ' }}'),
    'and $n binds the column the INSERT names in position n — a transposition would never fail');

  const bp = codeOf(sub, 'Build Intake Payload');
  // The word appears inside the inlined modules (a placeholder attribute on a screen), so the
  // claim is about the RETURN, not about the file.
  want(bp.indexOf('{ placeholder:') === -1 && bp.indexOf('built from') === -1,
    'D3 — the placeholder payload object is gone');
  want(bp.indexOf('SP.buildLeadIntakePayload') !== -1, 'and the real projection is called');
  want(bp.indexOf('DO NOT EDIT HERE') !== -1, 'the inlined modules carry their warning');
  for (const f of ['branches.js', 'draft-contract.js', 'submit-projection.js']) {
    const src = readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', f), 'utf8');
    const body2 = src.slice(0, src.lastIndexOf('module.exports = ')).replace(/^\s*const [A-Z] = require\([^)]*\);\s*$/gm, '');
    want(bp.indexOf(body2) !== -1, f + ' is inlined byte-for-byte, not retyped');
  }

  const mark = JSON.stringify(sub.nodes.find((n) => n.name === 'Mark Submitted').parameters);
  want(mark.indexOf('lead_id') !== -1, 'D6 — Mark Submitted records the canonical lead id');
  const termNode = sub.nodes.find((n) => n.name === 'Respond Submit Terminal');
  want(String(termNode.parameters.responseBody) === '={{ JSON.stringify($json.__response) }}',
    'the terminal responder serialises a prebuilt object — a ternary in the template returned an empty 200');
  want(String(termNode.parameters.options.responseCode) === '={{ Number($json.__status || 400) }}',
    'and it takes its status from the same object');
  want(sub.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').length === 3,
    'three responders: OK, Terminal, Unresolved — the flattening one is gone');

  // What must NOT have moved.
  const json = JSON.stringify(sub);
  want(json.indexOf('NOT_AUTHORISED') !== -1, 'the owner-only gate is still there');
  want(/on conflict/i.test(json) === false, 'the privacy insert still avoids ON CONFLICT');
  want(json.indexOf('privacy.privacy_acknowledgements') !== -1, 'it still targets the privacy schema');
  want(json.indexOf('googleSheets') === -1, 'the endpoint still writes no CRM directly');
  want(!/body\.init_data|\binit_data\s*:/.test(json), 'no init_data is read or sent after bootstrap');
  const names = sub.nodes.map((n) => n.name);
  want(names.indexOf('Write Privacy Acknowledgement') < names.indexOf('Call Lead Intake'),
    'the acknowledgement is still written before the irreversible call');
  const readsOf = (table) => sub.nodes.concat(sess.nodes).filter((n) =>
    n.type === 'n8n-nodes-base.dataTable' && n.parameters.operation === 'get' &&
    n.parameters.dataTableId.value === table);
  want(readsOf('MiniApp_App_Sessions').length === 2, 'both endpoints still read the SESSION table exactly once each');
  // Every read, whichever table: the flag rules below apply to all of them.
  const reads = sub.nodes.concat(sess.nodes).filter((n) => n.type === 'n8n-nodes-base.dataTable' && n.parameters.operation === 'get');

  // ── the caller-side receipt contract ──────────────────────────────────────────────────
  // Lead Intake has no INSERT into Submission_Receipts: all four of its receipt writes are
  // UPDATEs and it refuses a missing row with RECEIPT_ABSENT_INVARIANT_BROKEN. The caller must
  // preallocate, and must prove presence before the irreversible call.
  want(readsOf('Submission_Receipts').length === 2, 'the submit endpoint probes and reads back the receipt');
  const inserts = sub.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable' && n.parameters.operation === 'insert');
  want(inserts.length === 1, 'exactly one receipt preallocation node');
  want(inserts[0].parameters.dataTableId.value === 'Submission_Receipts',
    'preallocation targets the SAME store the Concierge uses, not a second one');
  const rv = inserts[0].parameters.columns.value;
  want(Object.keys(rv).length === 11, 'the preallocated row carries the Concierge eleven columns');
  want(rv.commit_state === 'READY', 'the preallocated row starts READY');
  want(['canonical_lead_id','lead_mode','lead_priority','financial_zone','claimed_at','settled_at','abort_reason','correlation_id']
    .every((f) => rv[f] === ''), 'the preallocated row carries no settlement or classification residue');
  const intoIntake = [];
  for (const [src, c] of Object.entries(sub.connections)) {
    (c.main || []).forEach((br) => (br || []).forEach((x) => { if (x.node === 'Build Intake Payload') { intoIntake.push(src); } }));
  }
  want(intoIntake.length === 1 && intoIntake[0] === 'IF Receipt Present',
    'Lead Intake is reachable ONLY through a proven receipt');
  want(names.indexOf('Preallocate Receipt') < names.indexOf('Call Lead Intake'),
    'the receipt is preallocated before the irreversible call');
  want(names.indexOf('Write Privacy Acknowledgement') < names.indexOf('Preallocate Receipt'),
    'privacy is still written before the receipt');
  want(String(sub.nodes.find((n) => n.name === 'Receipt Verdict').parameters.jsCode).indexOf('DUPLICATE_RECEIPTS') !== -1,
    'the receipt verdict still fails closed on duplicates');
  for (const r of reads) {
    want(r.alwaysOutputData === true,
      r.name + ' emits an item even on a no-match — without it an unknown session answers an empty 200');
    want(r.onError === 'continueRegularOutput',
      r.name + ' has one output, so the flag is not the P9-R2 pair');
  }
  want(sub.settings.saveDataSuccessExecution === 'none' && sub.settings.saveDataErrorExecution === 'none',
    'retention is still off, so no draft or acknowledgement is retained in an execution');
}
console.log('');

// ── 4b. cross-reload resume, on the deployed Gateway ───────────────────────────────────────────
console.log('THE DEPLOYED RESUME MECHANISM');
{
  const gwCode = (n) => String((gw.nodes.find((x) => x.name === n) || { parameters: {} }).parameters.jsCode || '');
  want(gw.nodes.length === 19, 'the Gateway has 19 nodes (was 13: +6 for resume)');
  for (const n of ['Read User Sessions', 'Resolve Session', 'IF Create Session',
    'Build Session Row', 'Read Back Sessions', 'Finalise Session']) {
    want(!!gw.nodes.find((x) => x.name === n), 'node present: ' + n);
  }
  // The resume path is downstream of the claim, and the insert is downstream of the decision.
  want(gw.connections['IF Claim Won'].main[0][0].node === 'Build App Session', 'the claim still gates everything');
  want(gw.connections['Build App Session'].main[0][0].node === 'Read User Sessions', 'the read follows the mint');
  want(gw.connections['IF Create Session'].main[0][0].node === 'Build Session Row', 'the create branch');
  want(gw.connections['IF Create Session'].main[1][0].node === 'Respond Bootstrap OK', 'the resume branch answers directly');

  const resolve = gwCode('Resolve Session');
  want(/telegram_user_id/.test(resolve) && /cycle_id/.test(resolve),
    'the resume key is telegram_user_id AND cycle_id');
  want(/created_at/.test(resolve) && /app_session_id\) < String/.test(resolve),
    'the winner is chosen by a TOTAL order, so two concurrent opens cannot disagree');
  want(!/\$json\.body|body\s*\./.test(resolve), 'the resolver reads no request body');
  want(gwCode('Finalise Session').indexOf('authoritative(') !== -1,
    'the read-back applies the SAME rule, not a second one');

  for (const n of ['Read User Sessions', 'Read Back Sessions']) {
    const node = gw.nodes.find((x) => x.name === n);
    want(node.parameters.returnAll === true, n + ' returns ALL rows');
    want(node.alwaysOutputData === true, n + ' produces an item for a user with no rows');
    want(node.onError === 'continueRegularOutput', n + ' has one output');
    want(!node.credentials, n + ' carries no credential');
  }
  const writers = gw.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable' && n.parameters.operation !== 'get');
  want(writers.length === 1 && writers[0].name === 'Create App Session',
    'resume writes nothing: the only Data Table writer is the insert on the create branch');
  const okNode = gw.nodes.find((n) => n.name === 'Respond Bootstrap OK');
  want(String(okNode.parameters.responseBody) === '={{ JSON.stringify($json.__response) }}',
    'the bootstrap answer is assembled in JavaScript, not in a template branch');
  want(okNode.parameters.options.responseCode === 200, 'and its code is a literal number');
}
console.log('');

// ── 4c. the forged / malformed / stale battery, live ───────────────────────────────────────────
//
// Every one of these is refused BEFORE Derive Replay Key, so none consumes a G5 key and none
// creates a session. That ordering is structural — the claim sits on IF Verified's TRUE branch —
// and it is re-proven here against the deployed workflow rather than assumed.
console.log('THE FORGED / MALFORMED BATTERY (all refused before the claim)');
{
  const V = 'b2.1.0';
  const good = 'auth_date=1788000000&signature=AAAA&user=%7B%22id%22%3A1%7D&hash=' + 'd'.repeat(64);
  const battery = [
    ['an empty body', {}, ['CLIENT_VERSION_UNSUPPORTED']],
    ['no client_version', { init_data: good, locale: 'ru' }, ['CLIENT_VERSION_UNSUPPORTED']],
    ['a wrong client_version', { init_data: good, client_version: 'b9.9.9', locale: 'ru' }, ['CLIENT_VERSION_UNSUPPORTED']],
    ['an unsupported locale', { init_data: good, client_version: V, locale: 'de' }, ['BAD_REQUEST']],
    ['no init_data', { client_version: V, locale: 'ru' }, ['TG_INITDATA_MISSING']],
    ['an empty init_data', { init_data: '', client_version: V, locale: 'ru' }, ['TG_INITDATA_MISSING']],
    ['init_data that is not a string', { init_data: { a: 1 }, client_version: V, locale: 'ru' }, ['TG_INITDATA_MISSING']],
    ['a malformed pair', { init_data: 'auth_date', client_version: V, locale: 'ru' }, ['TG_INITDATA_INVALID']],
    ['a duplicated key', { init_data: 'a=1&a=2&hash=' + 'd'.repeat(64), client_version: V, locale: 'ru' }, ['TG_INITDATA_INVALID']],
    ['no signature field', { init_data: 'auth_date=1788000000&hash=' + 'd'.repeat(64), client_version: V, locale: 'ru' }, ['TG_INITDATA_INVALID']],
    ['a FORGED signature', { init_data: good, client_version: V, locale: 'ru' }, ['TG_INITDATA_INVALID']],
    ['an oversized init_data', { init_data: 'a=' + 'x'.repeat(5000) + '&hash=' + 'd'.repeat(64), client_version: V, locale: 'ru' }, ['BAD_REQUEST']],
    ['an oversized body', { init_data: good, client_version: V, locale: 'ru', pad: 'x'.repeat(9000) }, ['BAD_REQUEST']],
    ['an injected identity', { init_data: good, client_version: V, locale: 'ru', telegram_user_id: '551662084', app_session_id: 'AS-' + 'a'.repeat(64) }, ['TG_INITDATA_INVALID']]
  ];
  for (const [label, payload, allowed] of battery) {
    const r = await post(GW, payload);
    const code = r.body && r.body.error_code;
    want(r.body && r.body.ok === false && allowed.indexOf(code) !== -1,
      label + ' -> ' + r.status + ' ' + code);
    want(!r.body || !r.body.app_session_id, label + ': no session was minted');
  }
}
console.log('');

// ── 5. the closed surfaces ─────────────────────────────────────────────────────────────────────
console.log('WHAT WAS NOT TOUCHED');
{
  const g = JSON.stringify(gw);
  want(g.indexOf('TG_PROD_PUBKEY_HEX') !== -1, 'G5: the Gateway still verifies against the Telegram production key');
  want(g.indexOf('telegram_initdata_replays') !== -1, 'G5: the replay ledger is still claimed');
  want(g.indexOf('TTL_SECONDS = 259200') !== -1, 'the 72 h app-session TTL is unchanged');
  want(g.indexOf('MAX_AUTH_AGE_SECONDS = 900') !== -1, 'Telegram freshness is unchanged');
  // The twelve nodes the deploy froze, restated against what the tenant now serves.
  const claim = gw.nodes.find((n) => n.name === 'G5 Replay Claim');
  want(/on conflict \(replay_key\) do nothing/i.test(String(claim.parameters.query)), 'G5: the atomic claim is unchanged');
  want(/as claimed/i.test(String(claim.parameters.query)), 'G5: the verdict column is unchanged');
  want(claim.onError === 'continueErrorOutput', 'G5: the store-outage branch is unchanged');
  want(!claim.alwaysOutputData, 'G5: the P9-R2 pair has not reappeared');
  want(gw.nodes.filter((n) => n.credentials).length === 1, 'exactly one Gateway node holds a credential');
  want(String(gw.nodes.find((n) => n.name === 'Build App Session').parameters.jsCode).indexOf('crypto.randomBytes(32)') !== -1,
    'the session id is still 32 random bytes, not derived from the user');
  want(gw.settings.saveDataSuccessExecution === 'none' && gw.settings.saveDataErrorExecution === 'none',
    'Gateway retention is still zero, so raw initData is never persisted');
  const s2 = JSON.stringify(sess);
  want(s2.indexOf('NOT_AUTHORISED') !== -1, 'the session endpoint keeps its owner gate');
  want(s2.indexOf('lead_id') === -1, 'the draft endpoint still mentions no lead');
}
console.log('');

console.log('='.repeat(78));
if (fail.length) {
  console.log('FAILURES (' + fail.length + '):');
  fail.forEach((f) => console.log('  - ' + f));
  console.log('CHECKS: ' + pass + ' passed, ' + fail.length + ' failed');
  process.exitCode = 1;
} else {
  console.log('CHECKS: ' + pass + ' passed. Nothing was written by this script.');
}
console.log('');
