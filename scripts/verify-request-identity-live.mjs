#!/usr/bin/env node
// FINMENTOR — prove the GLOBAL NEW-EVENT IDENTITY contract on what is actually deployed.
//
//   node scripts/verify-request-identity-live.mjs
//
// READ ONLY. It issues GETs and nothing else. It creates no lead, replays no submission, starts no
// execution, writes no row and applies no DDL.
//
// It does two things a unit test cannot:
//
//   1. It takes the node code that is ON THE TENANT RIGHT NOW and EXECUTES it against the same
//      fixtures the offline matrix uses. Not "the deployed file contains a string that looks like
//      the fix" — the deployed logic, run.
//   2. It fetches the PUBLISHED client from www.finmentor.md and executes that, so the lifecycle
//      is proven on the bytes a visitor's browser receives rather than on the working tree.
//
// Everything it needs is readable. Nothing here requires a real lead to exist.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const SUBMIT_ID = 'ELiPdw4mdxQbBaan';
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const SITE = 'https://www.finmentor.md';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

let pass = 0;
const fail = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));
const eqw = (a, b, m) => want(a === b, m + (a === b ? '' : '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'));
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

const get = async (p) => {
  const r = await fetch(BASE + '/api/v1' + p, { headers: { 'X-N8N-API-KEY': KEY } });
  if (!r.ok) { console.error('STOPPED: GET ' + p + ' -> ' + r.status); process.exit(1); }
  return r.json();
};
const fetchText = async (u) => {
  const r = await fetch(u, { headers: { 'User-Agent': 'finmentor-identity-verify' }, cache: 'no-store' });
  if (!r.ok) { console.error('STOPPED: GET ' + u + ' -> ' + r.status); process.exit(1); }
  return r.text();
};

console.log('');
console.log('GLOBAL NEW-EVENT IDENTITY — deployed proof, read-only');
console.log('='.repeat(78));
console.log('');

// ── the deployed server ────────────────────────────────────────────────────────────────────────
const wf = await get('/workflows/' + LEAD_INTAKE_ID);
const node = (n) => wf.nodes.find((x) => x.name === n);
const js = (n) => String((node(n) || { parameters: {} }).parameters.jsCode || '');

console.log('THE DEPLOYED SERVER');
eqw(wf.nodes.length, 106, 'the workflow has 106 nodes');
eqw(wf.active, true, 'the workflow is active');
for (const n of ['Identity Conflict?', 'IF Internal (Conflict)', 'Internal Result (Conflict)', 'Respond Identity Conflict']) {
  want(!!node(n), 'node present: ' + n);
}
want(js('Validate Payload').includes('const RI = (function () {'), 'Validate Payload carries the identity module');
want(js('Validate Payload').includes('RI.canonicalise(__identityRaw'), 'Validate Payload canonicalises the identity');
want(js('Dedup Guard').includes('IDEMPOTENCY_CONFLICT'), 'Dedup Guard carries the conflict verdict');
want(js('Dedup Guard').includes("consider(corroborated, 'request_id+identity', 'strong')"),
  'Dedup Guard corroboration survives (INDP1-02 stays closed)');
want(!/upd\.request_id/.test(js('Build Merge Update')), 'Build Merge Update no longer writes request_id');
want(js('Normalize + Score Lead').includes('FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}'),
  'lead_id generation unchanged');
want(!js('Normalize + Score Lead').includes('incoming.request_id'), 'the second identity source is gone');
console.log('');

console.log('THE 409 RESPONDER, AND ITS WIRING');
{
  const r = node('Respond Identity Conflict');
  eqw((r.parameters.options || {}).responseCode, 409, 'the responder answers 409');
  const body = String(r.parameters.responseBody);
  want(body.includes('"error_code":"IDEMPOTENCY_CONFLICT"'), 'error_code is IDEMPOTENCY_CONFLICT');
  want(body.includes('"retryable":false'), 'retryable is false');
  const c = wf.connections;
  eqw(c['Dedup Guard'].main[0][0].node, 'Identity Conflict?', 'Dedup Guard output 0 -> Identity Conflict?');
  eqw(c['Identity Conflict?'].main[0][0].node, 'IF Internal (Conflict)', 'conflict -> internal split');
  eqw(c['Identity Conflict?'].main[1][0].node, 'Receipt Gate', 'no conflict -> Receipt Gate');
  eqw(c['IF Internal (Conflict)'].main[1][0].node, 'Respond Identity Conflict', 'public -> 409');
  eqw(c['IF Internal (Conflict)'].main[0][0].node, 'Internal Result (Conflict)', 'internal -> return contract');
  want(!c['Respond Identity Conflict'], 'the 409 responder is terminal');
  want(!c['Internal Result (Conflict)'], 'the internal conflict result is terminal');
  // Exactly one responder was added.
  eqw(wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').length, 8,
    'the workflow has eight responders (seven pre-existing plus the 409)');
}
console.log('');

console.log('THE MERGE WRITER CANNOT REACH THE COLUMN');
{
  const mw = node('Update Pipeline (Merge)');
  eqw(mw.parameters.columns.mappingMode, 'autoMapInputData', 'the merge writer auto-maps its input');
  const executable = js('Build Merge Update')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  want(!/request_id/.test(executable), 'its only feeder emits no request_id key, so the column is untouchable');
  const w = node('Save to Pipeline');
  eqw(w.parameters.operation, 'append', 'the only writer that maps the column is an append');
  eqw(w.parameters.columns.mappingMode, 'defineBelow', 'and it maps explicitly, not by discovery');
  eqw(Object.keys(w.parameters.columns.value).length, 62, 'no Pipeline column added or removed');
}
console.log('');

// ── EXECUTE the deployed bodies ────────────────────────────────────────────────────────────────
console.log('THE DEPLOYED LOGIC, EXECUTED (no lead is created: these run in this process)');

function refs(map) {
  return (name) => {
    if (!Object.prototype.hasOwnProperty.call(map, name)) { throw new Error("Referenced node is unexecuted: '" + name + "'"); }
    const json = map[name];
    return { first: () => ({ json }), all: () => [{ json }] };
  };
}
const items = (arr) => ({ first: () => ({ json: arr[0] }), all: () => arr.map((json) => ({ json })) });
const run = (name, $, $input) => new Function('$', '$input', js(name))($, $input);

const HEX = (s) => { let o = ''; for (let i = 0; i < 32; i++) { o += '0123456789abcdef'[(s * 7 + i * 13 + i * i) % 16]; } return o; };
const PUB = (s) => 'fmr_' + HEX(s);
const body = (over) => {
  const o = over || {};
  return {
    tool: 'contact',
    lead: { name: 'Иван Петров', contact: o.email || 'ivan@alfa.md', company: o.company || 'Alfa SRL', email: o.email || 'ivan@alfa.md', telegram: '' },
    answers: { business: o.company || 'Alfa SRL', message: 'Кассовые разрывы' },
    main_pain: { problem: 'Кассовые разрывы', urgency: 'срочно' },
    meta: Object.assign({ page_url: 'https://www.finmentor.md/', timestamp: new Date().toISOString(), consent: true, site_language: 'ru' },
      o.requestId === null ? {} : { request_id: o.requestId })
  };
};
const validate = (b, internal) => run('Validate Payload',
  refs(internal ? { 'Internal Auth Entry': { __internal_route: true, __correlation_id: internal } } : {}),
  items([{ headers: {}, body: b }]))[0].json;
const normalize = (v, internal) => run('Normalize + Score Lead',
  refs(Object.assign({ 'Validate Payload': v }, internal ? { 'Internal Auth Entry': { __internal_route: true, __correlation_id: internal } } : {})),
  items([{}]))[0].json;
const dedup = (rows, n) => run('Dedup Guard', refs({ 'Normalize + Score Lead': n }),
  items(rows.length ? rows : [{}]))[0].json;

{
  const good = PUB(1);
  const v = validate(body({ requestId: good }));
  eqw(v.valid, true, 'a canonical public identity is accepted');
  eqw(v.payload.meta.request_id, good, 'and is persisted in canonical form');

  const dashed = validate(body({ requestId: 'fmr_3f2504e0-4f89-41d3-9a0c-0305e82c3301' }));
  eqw(dashed.payload.meta.request_id, 'fmr_3f2504e04f8941d39a0c0305e82c3301',
    'the dashed UUID spelling folds to the canonical form');

  eqw(validate(body({ requestId: null })).error_code, 'IDENTITY_MISSING', 'a missing identity is refused');
  eqw(validate(body({ requestId: 'fmr_nothex' })).error_code, 'IDENTITY_MALFORMED', 'a malformed identity is refused');
  eqw(validate(body({ requestId: 'sub_' + HEX(9) })).error_code, 'IDENTITY_ROUTE_FORBIDDEN',
    'a public caller may not present a Mini App identity');
  eqw(validate(body({ requestId: 'C-88112233-1787678806037' })).error_code, 'IDENTITY_ROUTE_FORBIDDEN',
    'a public caller may not present a Concierge identity');

  const sub = 'sub_' + HEX(11);
  eqw(validate(body({ requestId: sub }), sub).valid, true, 'the internal route accepts a submission key');
  const cyc = 'C-88112233-1787678806037';
  eqw(validate(body({ requestId: cyc }), cyc).valid, true, 'the internal route accepts a cycle id');
  eqw(validate(body({ requestId: PUB(12) }), PUB(12)).error_code, 'IDENTITY_ROUTE_FORBIDDEN',
    'the internal route refuses a public identity');
}
console.log('');

console.log('THE CONFLICT VERDICT, EXECUTED AGAINST A SETTLED ROW');
{
  const id = PUB(21);
  const settled = {
    lead_id: 'FIN-1788000000000-101', request_id: id, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), name: 'Иван Петров', company: 'Alfa SRL',
    email: 'ivan@alfa.md', phone: '', telegram: '', deal_stage: 'New', priority: 'WARM',
    financial_zone: 'UNKNOWN', main_pain: 'Кассовые разрывы'
  };
  const same = dedup([settled], normalize(validate(body({ requestId: id }))));
  eqw(same.dedup_mode, 'duplicate', 'an identical retry resolves to the existing lead');
  eqw(same.dedup_is_retry, true, 'and is recognised as a retry');

  const changed = dedup([settled], normalize(validate(body({ requestId: id, company: 'Beta SRL' }))));
  eqw(changed.dedup_mode, 'conflict', 'a changed submission under one identity is a conflict');
  eqw(changed.error_code, 'IDEMPOTENCY_CONFLICT', 'with the terminal error code');
  eqw(changed.identity_conflict_fields, 'company', 'and the operator-side field list');
  want(!/company/i.test(String(changed.error_message)), 'the caller-facing message names no column');

  const other = dedup([settled], normalize(validate(body({ requestId: id, company: 'Beta SRL', email: 'x@beta.md' }))));
  eqw(other.dedup_mode, 'conflict', 'a reused identity with different contact data is also a conflict');

  const legacy = Object.assign({}, settled, { request_id: '' });
  const fresh = dedup([legacy], normalize(validate(body({ requestId: PUB(22) }))));
  want(fresh.dedup_mode !== 'conflict', 'a legacy blank row never produces a conflict');
}
console.log('');

console.log('THE INTERNAL ROUTES ARE UNCHANGED');
{
  const subHash = sha(String((await get('/workflows/' + SUBMIT_ID)).nodes.find((n) => n.name === 'Build Intake Payload').parameters.jsCode || ''));
  const con = await get('/workflows/' + CONCIERGE_ID);
  const handoff = String(con.nodes.find((n) => n.name === 'Build Internal Handoff').parameters.jsCode || '');
  want(handoff.includes('request_id: cycleId'), 'the Concierge still hands over its cycle id, unchanged');
  const submit = await get('/workflows/' + SUBMIT_ID);
  want(String(submit.nodes.find((n) => n.name === 'Build Intake Payload').parameters.jsCode || '')
    .includes('correlationId: String(v.submission_key || "")'),
  'the Mini App submit endpoint still correlates on the submission key, unchanged');
  eqw(sha(String(submit.nodes.find((n) => n.name === 'Build Intake Payload').parameters.jsCode || '')), subHash,
    'the submit endpoint node is stable across two reads');
  // The Correlation Guard is what would break first if canonicalisation had rewritten an internal
  // identity, so it is checked on the deployed body rather than assumed.
  want(js('Correlation Guard').includes("expected !== '' && expected === observed"),
    'Correlation Guard still requires byte equality with Internal Auth Entry');
  const cyc = 'C-88112233-1787678806037';
  eqw(normalize(validate(body({ requestId: cyc }), cyc), cyc).request_id, cyc,
    'Normalize derives exactly the cycle id the guard expects');
  const sub = 'sub_' + HEX(31);
  eqw(normalize(validate(body({ requestId: sub }), sub), sub).request_id, sub,
    'Normalize derives exactly the submission key the guard expects');
}
console.log('');

// ── the PUBLISHED client ───────────────────────────────────────────────────────────────────────
console.log('THE PUBLISHED CLIENT, FETCHED FROM ' + SITE + ' AND EXECUTED');
{
  const published = await fetchText(SITE + '/lead-transport.js');
  const local = readFileSync(join(ROOT, 'lead-transport.js'), 'utf8').replace(/\r\n/g, '\n');
  const norm = (s) => s.replace(/\r\n/g, '\n');
  eqw(sha(norm(published)), sha(local), 'the published transport is byte-identical to the repository');

  const store = new Map();
  const calls = [];
  let responder = () => ({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"lead_id":"FIN-1","mode":"new"}') });
  const win = {
    crypto: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) { b[i] = Math.floor(Math.random() * 256); } return b; } },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k)
    },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  const fetchImpl = (u, init) => {
    calls.push(JSON.parse(init.body));
    const r = responder(calls.length);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  new Function('window', 'fetch', 'document', norm(published))(win, fetchImpl, undefined);
  const T = win.FMLeadTransport;
  const U = 'https://example.invalid/hook';
  const idOf = (i) => calls[i].meta.request_id;
  const boom = () => { const e = new Error('x'); e.name = 'TypeError'; return e; };
  const swallow = (p) => p.then(() => null, (e) => e);

  // M / N — one identity per submission, reused across a failed attempt.
  responder = (n) => (n === 1 ? boom() : { ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"lead_id":"FIN-1","mode":"new"}') });
  await swallow(T.postLead(U, { tool: 'contact', meta: {} }, {}));
  const r1 = await T.postLead(U, { tool: 'contact', meta: {} }, {});
  eqw(idOf(1), idOf(0), 'M/N — the retry carries the identity the first attempt minted');
  want(/^fmr_[0-9a-f]{32}$/.test(idOf(0)), 'and it is canonical: fmr_<32 lc hex>');
  eqw(r1.leadId, 'FIN-1', 'the canonical lead id is surfaced to the caller');

  // P / Q — settlement retires it; the next genuine submission is a new request.
  responder = () => ({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"lead_id":"FIN-2","mode":"new"}') });
  await T.postLead(U, { tool: 'contact', meta: {} }, {});
  want(idOf(2) !== idOf(0), 'P/Q — a settled identity is never handed out again');

  // R — a 2xx that is not a settlement retains the identity.
  responder = () => ({ ok: true, status: 200, text: () => Promise.resolve('{"ok":false,"error_code":"CRM_UNAVAILABLE"}') });
  await swallow(T.postLead(U, { tool: 'mini_scan', meta: {} }, {}));
  eqw(T.slotState('mini_scan'), 'active', 'R — HTTP 200 with ok:false does not retire the identity');
  const held = idOf(3);
  responder = () => ({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true,"lead_id":"FIN-3","mode":"merged"}') });
  await T.postLead(U, { tool: 'mini_scan', meta: {} }, {});
  eqw(idOf(4), held, 'S — the retry after a non-settlement carries the same identity');
  eqw(T.slotState('mini_scan'), 'idle', 'and the authoritative success retires it');

  // T / U — the terminal conflict.
  responder = () => ({ ok: false, status: 409, text: () => Promise.resolve('{"ok":false,"error_code":"IDEMPOTENCY_CONFLICT","retryable":false}') });
  const conflictErr = await swallow(T.postLead(U, { tool: 'xray_extended', meta: {} }, {}));
  eqw(T.isIdentityConflict(conflictErr), true, 'T — a 409 IDEMPOTENCY_CONFLICT is recognised');
  eqw(T.slotState('xray_extended'), 'conflict', 'and the slot is sealed');
  const n0 = calls.length;
  const blocked = await swallow(T.postLead(U, { tool: 'xray_extended', meta: {} }, {}));
  eqw(blocked.fmCode, 'identity_conflict_pending', 'a further send is refused before the network');
  eqw(calls.length, n0, 'and no request was sent');
  T.beginNewSubmission('xray_extended');
  eqw(T.slotState('xray_extended'), 'idle', 'U — the explicit new-request action clears the conflict');
}
console.log('');

console.log('THE SIX PUBLISHED PAGES');
for (const p of ['index.html', 'questionnaire.html', 'ro/questionnaire.html',
  'working-capital-scan.html', 'ro/working-capital-scan.html']) {
  const html = await fetchText(SITE + '/' + p);
  want(html.includes('lead-transport.js'), p + ' loads the transport');
}
{
  const ro = await fetchText(SITE + '/ro/index.html');
  want(!ro.includes('lead-transport.js'),
    'ro/index.html still lacks the transport (KNOWN OPEN DEFECT, deliberately not fixed here)');
}
console.log('');

console.log('='.repeat(78));
console.log('  ' + pass + ' passed, ' + fail.length + ' failed');
if (fail.length) {
  console.log('');
  for (const f of fail) { console.log('  FAILED  ' + f); }
  process.exit(1);
}
console.log('');
console.log('  READ ONLY: no lead created, no row written, no execution started, no DDL applied.');
console.log('');
