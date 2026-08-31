#!/usr/bin/env node
// FINMENTOR — GLOBAL NEW-EVENT IDENTITY: the negative matrix.
//
//   node qa/lead-intake-request-identity.test.mjs
//
// Offline. No tenant, no network, no Google, no credentials, NO PRODUCTION WRITES. Nothing here
// deploys, imports, applies DDL, touches lead_id or writes a row.
//
// WHAT THIS GATE IS FOR, in the order the failures actually happen:
//
//   1. IT PROVES THE DEFECTS FIRST. Every remediation case runs against the DEPLOYED node bodies
//      before it runs against the candidate. A gate that only shows the fix passing cannot tell
//      you six months from now whether the fix is still load-bearing or whether the hazard went
//      away on its own. Cases E-2, J-1, H-0, I-2 and the transport's B-0 are red on purpose.
//   2. IT EXECUTES THE REAL BODIES. The node code is read out of the candidate workflow the
//      generator emits and out of the export it was built from — not from a paraphrase, and not
//      from a fixture shaped the way the test would like the system to behave.
//   3. IT MODELS THE WRITERS THE WAY N8N CONFIGURES THEM. `Save to Pipeline` is an APPEND with
//      defineBelow; `Update Pipeline (Merge)` is an UPDATE with autoMapInputData matched on
//      lead_id. The second is why merge immutability can be achieved by OMISSION, and a harness
//      that modelled the update as a full row rewrite would score that fix as broken.
//   4. IT PINS THE EQUIVALENCE PREDICATE so it cannot drift (section EQ).
//
// The letters are the owner's matrices: A–L from the first review, M–X from the second.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build, verify, sanitize, TOUCHED_NODES, ADDED_NODES } from '../scripts/build-lead-intake-request-identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const CANDIDATE = JSON.parse(read(join(ROOT, 'n8n', 'candidate', 'lead-intake-request-identity-candidate.json')));
const DEPLOYED = JSON.parse(read(join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json')));
// The DEPLOYED transport. There is no separate candidate copy: the approved lifecycle IS this
// file, and a second copy would drift from the one the site actually serves.
const TRANSPORT = read(join(ROOT, 'lead-transport.js'));
const IDENTITY_MODULE = read(join(ROOT, 'n8n', 'src', 'lead-intake', 'identity-candidate', 'request-identity.js'));
const RI = new Function(IDENTITY_MODULE + '; return RI;')();

// The pre-identity transport, frozen so the defect proof survives the deploy that fixes it.
// Without this the B-0 case would go green for the wrong reason the moment lead-transport.js is
// replaced, and the record of WHY the lifecycle exists would be gone.
const TRANSPORT_PRE = read(join(ROOT, 'qa', 'fixtures', 'lead-transport.pre-identity.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
// A value here can be a whole n8n node parameter blob. A failure message that dumps two of them
// verbatim buries the one line that says what broke, so they are clipped.
const clip = (v) => { const s = JSON.stringify(v); return s === undefined ? String(v) : (s.length > 180 ? s.slice(0, 180) + '…' : s); };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + clip(a) + ', want ' + clip(b) + ')'); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

// ══════════════════════════════════════════════════════════ the n8n node harness

const src = (wf, name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) { throw new Error('node absent: ' + name); }
  return String(n.parameters.jsCode || '').replace(/\r\n/g, '\n');
};

// `$('Some Node')` THROWS when the node did not run in this execution. That is not an
// approximation — it is the mechanism `internalRouteProven()` and `Receipt Gate` are built on, and
// a harness that returned undefined instead would score the public path as internal.
function refs(map) {
  return (name) => {
    if (!Object.prototype.hasOwnProperty.call(map, name)) {
      throw new Error("Referenced node is unexecuted: '" + name + "'");
    }
    const json = map[name];
    return { first: () => ({ json }), all: () => [{ json }] };
  };
}
const items = (arr) => ({
  first: () => ({ json: arr[0] }),
  all: () => arr.map((json) => ({ json }))
});

const SETTINGS = { settings: { sla_hot_hours: 4, sla_warm_hours: 24, default_responsible: 'Геннадий' } };

function runNode(wf, name, $, $input) {
  return new Function('$', '$input', src(wf, name))($, $input);
}

// One submission, end to end, against an in-memory Pipeline.
//
// The Pipeline is a plain array of row objects because that is what `Read Pipeline (Dedup)`
// produces: a full-sheet read with no column projection.
function submit(wf, pipeline, body, opts) {
  const o = opts || {};
  const internalRef = o.internal
    ? { 'Internal Auth Entry': { __internal_route: true, __correlation_id: o.correlationId || '' } }
    : {};

  // ---- Validate Payload
  const v = runNode(wf, 'Validate Payload',
    refs(internalRef), items([{ headers: o.headers || {}, body: clone(body) }]))[0].json;
  if (v.valid !== true) {
    return { outcome: 'refused', http: 400, error_code: v.error_code, error_message: v.error_message };
  }

  // ---- Normalize + Score Lead
  const n = runNode(wf, 'Normalize + Score Lead',
    refs({ ...internalRef, 'Validate Payload': v }), items([{}]))[0].json;

  // ---- Correlation Guard, on the internal route only (it is a no-op on public traffic)
  if (o.internal) {
    const cg = runNode(wf, 'Correlation Guard',
      refs({ ...internalRef, 'Normalize + Score Lead': n }), items([{}]))[0].json;
    if (cg.__correlation_ok !== 1) { return { outcome: 'correlation_refused', normalized: n }; }
  }

  // ---- Dedup Guard, fed the sheet read
  const readItems = pipeline.rows.length ? clone(pipeline.rows) : [{}];
  const d = runNode(wf, 'Dedup Guard',
    refs({ ...internalRef, 'Normalize + Score Lead': n }), items(readItems))[0].json;

  if (d.dedup_mode === 'conflict') {
    // The graph routes this to `Identity Conflict?` -> `IF Internal (Conflict)` -> the 409
    // responder or the internal return contract. Both bodies are asserted structurally in section
    // C-409; the status is read from the responder itself rather than hard-coded here.
    const responder = wf.nodes.find((x) => x.name === 'Respond Identity Conflict');
    return {
      outcome: 'conflict',
      http: responder ? (responder.parameters.options || {}).responseCode : null,
      error_code: d.error_code,
      error_message: d.error_message,
      fields: d.identity_conflict_fields,
      normalized: n,
      dedup: d
    };
  }

  if (d.dedup_mode === 'duplicate') {
    const upd = runNode(wf, 'Build Merge Update',
      refs({ 'Settings to Object': SETTINGS }), items([d]))[0].json;
    // `Update Pipeline (Merge)`: operation=update, mappingMode=autoMapInputData,
    // matchingColumns=["lead_id"]. autoMap writes the keys that are PRESENT and leaves every
    // other column alone. Omission is therefore a real immutability primitive here.
    const row = pipeline.rows.find((r) => String(r.lead_id) === String(upd.lead_id));
    if (!row) { throw new Error('merge targeted a lead_id that is not in the Pipeline: ' + upd.lead_id); }
    for (const k of Object.keys(upd)) { row[k] = upd[k]; }
    return { outcome: 'merged', http: 200, lead_id: upd.lead_id, update: upd, normalized: n, dedup: d };
  }

  const row = runNode(wf, 'Build Pipeline Row',
    refs({ 'Settings to Object': SETTINGS }), items([d]))[0].json;
  // `Save to Pipeline`: operation=append. A new lead is a NEW ROW, always.
  pipeline.rows.push(clone(row));
  return { outcome: 'new', http: 200, lead_id: row.lead_id, row, normalized: n, dedup: d };
}

const newPipeline = () => ({ rows: [] });

// A genuine LATER submission is not a retry, and the difference decides which merge rules fire.
// Dedup Guard scores any match inside two minutes as a retry, so a fixture that submits twice in
// one tick exercises REPLAY semantics and never reaches the attribution/idempotency block at the
// bottom of Build Merge Update — where `advance()` lives. Ageing the row is what makes the second
// submission genuine, and therefore what makes the immutability cases test what they claim to.
const age = (pipeline, minutes) => {
  const t = new Date(Date.now() - minutes * 60000).toISOString();
  for (const r of pipeline.rows) { r.created_at = t; r.updated_at = t; }
};

// ══════════════════════════════════════════════════════════ payload fixtures

const HEX = (seed) => {
  let s = '';
  for (let i = 0; i < 32; i++) { s += '0123456789abcdef'[(seed * 7 + i * 13 + (i * i)) % 16]; }
  return s;
};
const PUB = (seed) => 'fmr_' + HEX(seed);

// The shape main.js's consultation form actually posts.
function publicBody(over) {
  const o = over || {};
  return {
    tool: 'contact',
    lead: {
      name: o.name === undefined ? 'Иван Петров' : o.name,
      contact: o.email === undefined ? 'ivan@alfa.md' : o.email,
      company: o.company === undefined ? 'Alfa SRL' : o.company,
      email: o.email === undefined ? 'ivan@alfa.md' : o.email,
      telegram: ''
    },
    answers: {
      business: o.company === undefined ? 'Alfa SRL' : o.company,
      message: o.message === undefined ? 'Кассовые разрывы каждый месяц' : o.message
    },
    main_pain: { problem: o.pain === undefined ? 'Кассовые разрывы' : o.pain, urgency: 'срочно' },
    signals: { model: '', urgency: 'срочно', score_zone: '', first_step: 'contact' },
    meta: Object.assign({
      page_url: o.pageUrl === undefined ? 'https://www.finmentor.md/' : o.pageUrl,
      referrer: '',
      timestamp: new Date().toISOString(),
      consent: true,
      site_language: 'ru',
      analytics_consent: false,
      utm_source: o.utmSource === undefined ? '' : o.utmSource,
      utm_medium: o.utmMedium === undefined ? '' : o.utmMedium,
      utm_campaign: o.utmCampaign === undefined ? '' : o.utmCampaign
    }, 'requestId' in o ? (o.requestId === null ? {} : { request_id: o.requestId }) : { request_id: PUB(1) })
  };
}

// The envelope the Mini App submit endpoint and the Concierge hand to the internal trigger,
// already unwrapped by `Internal Envelope Unwrap` into the webhook shape Validate Payload reads.
function internalBody(correlationId, over) {
  const o = over || {};
  return {
    tool: o.tool || 'miniapp_diagnostic',
    client: {
      name: 'Мария', company: o.company || 'Beta SRL',
      phone_or_messenger: '', telegram: '88112233', language: 'ru'
    },
    answers: { business_model: 'Розница', revenue_range: 'до 5 млн', main_pain: 'Нет P&L' },
    main_pain: { problem: o.pain || 'Нет P&L', urgency: 'в течение месяца' },
    business_profile: { industry_category: 'Розница', turnover_range: 'до 5 млн' },
    intake: { consent: { privacy_accepted: true } },
    meta: { consent: true, request_id: correlationId, page_url: 'telegram_miniapp',
      utm_source: 'telegram', utm_medium: 'miniapp' }
  };
}

console.log('');
console.log('GLOBAL NEW-EVENT IDENTITY — negative matrix');
console.log('candidate: n8n/candidate/lead-intake-request-identity-candidate.json');
console.log('');

// ══════════════════════════════════════════════ 0 — the candidate is the delta it claims

console.log('0 — the candidate is a narrow delta of the deployed graph');

check('0-1 candidate adds exactly the four conflict nodes and nothing else', () => {
  eq(DEPLOYED.nodes.length, 102, 'deployed node count');
  eq(CANDIDATE.nodes.length, 106, 'candidate node count');
  for (const n of ADDED_NODES) {
    assert(CANDIDATE.nodes.some((x) => x.name === n), n + ' is absent');
    assert(!DEPLOYED.nodes.some((x) => x.name === n), n + ' already existed');
  }
});

check('0-2 the candidate carries no production identity', () => {
  const blob = JSON.stringify(CANDIDATE);
  assert(!blob.includes('cachedResultUrl'), 'cachedResultUrl leaked into a tracked artifact');
  assert(CANDIDATE.active === undefined, 'candidate carries an active flag');
  assert(CANDIDATE.id === undefined, 'candidate carries a workflow id');
});

check('0-4 lead_id generation is byte-identical to the deployed one', () => {
  const probe = 'FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}';
  assert(src(DEPLOYED, 'Normalize + Score Lead').includes(probe), 'probe missing from deployed');
  assert(src(CANDIDATE, 'Normalize + Score Lead').includes(probe), 'lead_id generation changed');
});

// The SHIPPED candidate is a delta of the LIVE export, and the tracked pointer under
// n8n/production/ can be a deploy behind it. So the "nothing else moved" invariant cannot be
// asserted by diffing the shipped candidate against the tracked pointer — it would report an
// unrelated deploy as this change's collateral. It is asserted the only way that is
// base-independent: by re-running the generator against the tracked pointer here.
check('0-5 the generator holds every invariant against the tracked production export', () => {
  // The tracked pointer under n8n/production/ is the PRE-identity graph and must stay so for this
  // gate to have a base to transform. It is NOT advanced by the identity deploy, deliberately:
  // seven gates read it, and n8n/history/README.md records what happens when a moving reference is
  // also used as a phase fixture. If a later seal advances it, this assertion fails with an
  // instruction rather than the arithmetic failing somewhere less legible.
  const merge = src(DEPLOYED, 'Build Merge Update');
  assert(merge.includes('upd.request_id = advance('),
    'the tracked production export has been advanced past the identity deploy — freeze the '
    + 'pre-identity graph into n8n/history/ and point build()/verify() at the frozen copy');
  eq(DEPLOYED.nodes.length, 102, 'the tracked pointer is no longer the 102-node pre-identity graph');
  const problems = verify(DEPLOYED, build(DEPLOYED));
  eq(problems.length, 0, 'invariants failed: ' + problems.join(' | '));
});

check('0-6 the Pipeline writers are untouched: no column added, removed or remapped', () => {
  const rebuilt = build(DEPLOYED);
  // `build()` strips the resource-locator display caches, so the comparison is against the
  // SANITISED base — otherwise a stripped `cachedResultUrl` reads as a remapped column.
  const base = sanitize(JSON.parse(JSON.stringify(DEPLOYED.nodes)));
  for (const writer of ['Save to Pipeline', 'Update Pipeline (Merge)']) {
    const a = base.find((n) => n.name === writer);
    const b = rebuilt.nodes.find((n) => n.name === writer);
    eq(JSON.stringify(b.parameters), JSON.stringify(a.parameters), writer + ' changed');
  }
  const save = CANDIDATE.nodes.find((n) => n.name === 'Save to Pipeline').parameters.columns;
  eq(save.mappingMode, 'defineBelow', 'the append writer would discover columns');
  assert(Object.prototype.hasOwnProperty.call(save.value, 'request_id'), 'request_id is not mapped on append');
  const merge = CANDIDATE.nodes.find((n) => n.name === 'Update Pipeline (Merge)').parameters.columns;
  eq(merge.mappingMode, 'autoMapInputData', 'the update writer no longer auto-maps');
  eq(JSON.stringify(merge.matchingColumns), '["lead_id"]', 'the update match key changed');
});

check('0-7 the four touched nodes are the only ones the generator rewrites', () => {
  const rebuilt = build(DEPLOYED);
  const moved = DEPLOYED.nodes
    .filter((a) => {
      const b = rebuilt.nodes.find((x) => x.name === a.name);
      return b && String(b.parameters.jsCode || '') !== String(a.parameters.jsCode || '');
    })
    .map((n) => n.name).sort();
  eq(JSON.stringify(moved), JSON.stringify([...TOUCHED_NODES].sort()), 'unexpected node bodies changed');
});

// ══════════════════════════════════════════════ the terminal 409

console.log('');
console.log('C-409 — IDEMPOTENCY_CONFLICT is a dedicated terminal response');

check('C-409-1 the responder answers 409, not 400, and is not the generic refusal', () => {
  const r = CANDIDATE.nodes.find((n) => n.name === 'Respond Identity Conflict');
  eq(r.type, 'n8n-nodes-base.respondToWebhook', 'not a responder');
  eq((r.parameters.options || {}).responseCode, 409, 'wrong status');
  const body = String(r.parameters.responseBody);
  assert(body.includes('"error_code":"IDEMPOTENCY_CONFLICT"'), 'wrong error_code');
  assert(body.includes('"retryable":false'), 'not marked non-retryable');
  assert(body.includes('"ok":false'), 'ok is not false');
  // It must not be reachable from the generic invalid path, and the generic path must not have
  // been repurposed.
  const invalid = CANDIDATE.nodes.find((n) => n.name === 'Respond Invalid');
  eq((invalid.parameters.options || {}).responseCode, 400, 'Respond Invalid changed status');
  assert(!String(invalid.parameters.responseBody).includes('IDEMPOTENCY_CONFLICT'),
    'the conflict leaks into the generic 400');
});

check('C-409-2 both routes get the same terminal contract, and neither leads anywhere', () => {
  const internal = CANDIDATE.nodes.find((n) => n.name === 'Internal Result (Conflict)');
  const js = String(internal.parameters.jsCode);
  assert(/IDEMPOTENCY_CONFLICT/.test(js), 'internal contract has the wrong code');
  assert(/"retryable":false|retryable":\s*false/.test(js), 'internal contract is retryable');
  const cc = CANDIDATE.connections;
  eq(cc['Identity Conflict?'].main[0][0].node, 'IF Internal (Conflict)', 'conflict branch');
  eq(cc['Identity Conflict?'].main[1][0].node, 'Receipt Gate', 'normal branch');
  eq(cc['IF Internal (Conflict)'].main[0][0].node, 'Internal Result (Conflict)', 'internal branch');
  eq(cc['IF Internal (Conflict)'].main[1][0].node, 'Respond Identity Conflict', 'public branch');
  assert(!cc['Respond Identity Conflict'], 'the responder is not terminal');
  assert(!cc['Internal Result (Conflict)'], 'the internal result is not terminal');
});

check('C-409-3 a conflict never reaches the receipt critical section or a write', () => {
  // Structural: the only way out of `Identity Conflict?` output 0 is the two terminal endpoints.
  const cc = CANDIDATE.connections;
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const branch of ((cc[name] || {}).main || [])) {
      for (const t of (branch || [])) { walk(t.node); }
    }
  };
  walk('IF Internal (Conflict)');
  eq([...seen].sort().join(' | '),
    'IF Internal (Conflict) | Internal Result (Conflict) | Respond Identity Conflict',
    'the conflict path reaches something else');
  for (const n of seen) {
    const node = CANDIDATE.nodes.find((x) => x.name === n);
    assert(node.type !== 'n8n-nodes-base.googleSheets', n + ' is a Sheets node on the conflict path');
  }
});

// ══════════════════════════════════════════════ EQ — the frozen equivalence predicate

console.log('');
console.log('EQ — the canonical equivalence predicate, pinned');

check('EQ-1 the field set is exactly these sixteen, in this order', () => {
  eq(RI.EQUIVALENCE_FIELDS.join(','),
    'name,company,email,phone,telegram,'
    + 'business_model,industry_category,turnover_range,employees_range,'
    + 'main_pain,selected_problems,selected_goals,work_interest,'
    + 'documents_status,selected_documents,preferred_meeting_format',
    'the equivalence field set drifted');
  eq(RI.EQUIVALENCE_FIELDS.length, 16, 'field count');
  eq(RI.LIST_FIELDS.join(','), 'selected_problems,selected_goals,work_interest,selected_documents',
    'the set-compared field list drifted');
});

check('EQ-2 every equivalence field is a real Pipeline column', () => {
  // The whole reason this set was chosen: the comparison must be recomputable from a Pipeline row
  // alone, with no schema change and no execution history.
  const mapped = Object.keys(
    CANDIDATE.nodes.find((n) => n.name === 'Save to Pipeline').parameters.columns.value);
  for (const f of RI.EQUIVALENCE_FIELDS) {
    assert(mapped.includes(f), f + ' is not a Pipeline column, so a reconciler could not recompute it');
  }
});

check('EQ-3 the predicate is subsumption: both sides non-empty AND different', () => {
  const c = (a, b) => RI.conflictFields(a, b).join(',');
  eq(c({ company: 'Alfa' }, { company: 'Beta' }), 'company', 'a real difference is not flagged');
  eq(c({ company: 'Alfa' }, { company: '' }), '', 'a blank incoming value was scored as a conflict');
  eq(c({ company: '' }, { company: 'Beta' }), '', 'a blank stored value was scored as a conflict');
  eq(c({ company: 'Alfa SRL' }, { company: '  alfa   srl ' }), '', 'normalisation failed');
  eq(c({ name: 'Пётр' }, { name: 'петр' }), '', 'ё-folding failed');
  eq(c({ selected_goals: 'b, a' }, { selected_goals: 'a,b' }), '', 'list re-ordering was scored as a conflict');
  eq(c({ selected_goals: 'a,b' }, { selected_goals: 'a,c' }), 'selected_goals', 'a list change is not flagged');
});

check('EQ-4 no excluded field can produce a conflict', () => {
  // raw_json is forbidden by instruction; the rest would make a retry, a later clock or a tuned
  // scorer into a business conflict.
  const forbidden = ['raw_json', 'created_at', 'updated_at', 'request_id', 'lead_id',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_source_first', 'first_touch_at',
    'ga_client_id', 'ga_session_id', 'analytics_consent', 'source_page',
    'priority', 'financial_zone', 'priority_reason', 'diagnostic_score', 'completion_score'];
  for (const f of forbidden) {
    assert(!RI.EQUIVALENCE_FIELDS.includes(f), f + ' is in the equivalence set and must not be');
    const a = {}; const b = {};
    a[f] = 'one'; b[f] = 'two';
    eq(RI.conflictFields(a, b).length, 0, f + ' produced a conflict');
  }
  assert(!/raw_json/.test(IDENTITY_MODULE.replace(/\/\/[^\n]*/g, '')),
    'the predicate references raw_json outside a comment');
});

// ══════════════════════════════════════════════ M–Q, T, U — the public token lifecycle

console.log('');
console.log('M–U — the public token lifecycle: one logical submission, one identity');

// A browser shim small enough to be obviously correct. sessionStorage is a real Map so a reload,
// and a bfcache restore, can be modelled by rebuilding `window` around the SAME store.
function browser(store, opts) {
  const o = opts || {};
  const timers = new Map();
  let next = 1;
  return {
    crypto: o.noCrypto ? undefined : {
      getRandomValues: (buf) => { for (let i = 0; i < buf.length; i++) { buf[i] = Math.floor(Math.random() * 256); } return buf; }
    },
    sessionStorage: o.noStorage
      ? { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } }
      : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    AbortController: class { constructor() { this.signal = {}; } abort() { this.aborted = true; } },
    setTimeout: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
}

// The three business responses, written once so no case can invent a shape the server never sends.
const SETTLED = (leadId, mode) => ({
  ok: true, status: 200,
  text: () => Promise.resolve(JSON.stringify({ ok: true, lead_id: leadId || 'FIN-1788000000000-101', mode: mode || 'new', priority: 'WARM', financial_zone: 'UNKNOWN' }))
});
const BUSINESS_FAIL = (code) => ({
  ok: true, status: 200,
  text: () => Promise.resolve(JSON.stringify({ ok: false, error_code: code || 'CRM_UNAVAILABLE', retryable: true }))
});
const CONFLICT_409 = () => ({
  ok: false, status: 409,
  text: () => Promise.resolve(JSON.stringify({ ok: false, error_code: 'IDEMPOTENCY_CONFLICT', retryable: false }))
});
const BAD_400 = () => ({
  ok: false, status: 400,
  text: () => Promise.resolve(JSON.stringify({ ok: false, error_code: 'INVALID_PAYLOAD', retryable: false, message: '' }))
});
const NETWORK_FAIL = () => { const e = new Error('boom'); e.name = 'TypeError'; return e; };

function loadTransport(source, store, opts) {
  const win = browser(store, opts);
  const calls = [];
  const responder = { next: () => SETTLED() };
  const fetchImpl = (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body), headers: init.headers });
    const r = responder.next(calls.length);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  new Function('window', 'fetch', 'document', source)(win, fetchImpl, undefined);
  return { T: win.FMLeadTransport, calls, responder, win };
}

const URL_OK = 'https://example.invalid/webhook/lead';
const fails = (p) => p.then(() => { throw new Error('expected a rejection'); }, (e) => e);
const idOf = (calls, i) => calls[i].body.meta.request_id;

check('B-0 the PRE-IDENTITY transport minted a new identity per attempt (the defect, frozen)', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT_PRE, store);
  responder.next = (n) => (n === 1 ? NETWORK_FAIL() : SETTLED());
  // Every one of the four submitters rebuilds its payload inside the submit handler.
  await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(calls.length, 2, 'two attempts');
  assert(idOf(calls, 0) !== idOf(calls, 1),
    'the frozen pre-identity fixture no longer shows the defect it exists to record');
});

check('M   first logical submission mints exactly one canonical identity', async () => {
  const store = new Map();
  const { T, calls } = loadTransport(TRANSPORT, store);
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(calls.length, 1, 'one POST');
  const id = idOf(calls, 0);
  const c = RI.canonicalise(id, { internal: false });
  assert(c.ok, 'identity is not canonical: ' + JSON.stringify(c));
  eq(c.route, 'public', 'route');
  eq(c.id, id, 'the client does not already emit the canonical spelling');
  eq(calls[0].headers['X-FINMENTOR-Request-Id'], id, 'header and body disagree');
});

check('N   network retry reuses EXACTLY the same identity', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = (n) => (n <= 2 ? NETWORK_FAIL() : SETTLED());
  for (let i = 0; i < 3; i++) { await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {})).catch(() => {}); }
  eq(calls.length, 3, 'three attempts');
  eq(idOf(calls, 1), idOf(calls, 0), 'attempt 2 minted a new identity');
  eq(idOf(calls, 2), idOf(calls, 0), 'attempt 3 minted a new identity');
});

check('N-1 a TIMEOUT retry reuses the same identity', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = (n) => (n === 1 ? Object.assign(new Error('abort'), { name: 'AbortError' }) : SETTLED());
  const e = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(e.fmCode, 'timeout', 'not reported as a timeout');
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the timeout rotated the identity');
});

check('O   a page reload before terminal success reuses the same identity', async () => {
  const store = new Map();
  const first = loadTransport(TRANSPORT, store);
  first.responder.next = () => NETWORK_FAIL();
  await fails(first.T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  // A reload: a brand-new window around the same session store.
  const second = loadTransport(TRANSPORT, store);
  await second.T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(second.calls, 0), idOf(first.calls, 0), 'the reload minted a new identity');
});

check('D   a validation refusal before settlement keeps the same identity', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = (n) => (n === 1 ? BAD_400() : SETTLED());
  const e = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(e.fmStatus, 400, 'not surfaced as a 400');
  eq(e.fmErrorCode, 'INVALID_PAYLOAD', 'the error code was not read from the body');
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'a rejected payload rotated the identity');
});

check('P   an authoritative settlement retires the identity', async () => {
  const store = new Map();
  const { T, calls } = loadTransport(TRANSPORT, store);
  const r = await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(r.ok, true, 'not resolved as success');
  eq(r.leadId, 'FIN-1788000000000-101', 'the canonical lead id was not returned');
  eq(T.slotState('contact'), 'idle', 'the slot is still active after settlement');
  assert(T.submissionToken('contact') !== idOf(calls, 0), 'the retired identity was handed out again');
});

check('Q   a second genuine submission gets a DIFFERENT identity', async () => {
  const store = new Map();
  const { T, calls } = loadTransport(TRANSPORT, store);
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  await T.postLead(URL_OK, publicBody({ requestId: null, company: 'Gamma SRL' }), {});
  assert(idOf(calls, 0) !== idOf(calls, 1), 'the second genuine submission replayed the first identity');
  const a = RI.canonicalise(idOf(calls, 0), {});
  const b = RI.canonicalise(idOf(calls, 1), {});
  assert(a.ok && b.ok, 'one of the two identities is not canonical');
});

check('Q-1 an unchanged second submission after settlement also gets a NEW identity', async () => {
  // The lifecycle is bound to the submission, not to the content: two identical genuine
  // submissions are two logical submissions and must not share an identity.
  const store = new Map();
  const { T, calls } = loadTransport(TRANSPORT, store);
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  assert(idOf(calls, 0) !== idOf(calls, 1), 'identical content replayed the retired identity');
});

check('H   a retired identity can never be re-offered, even from a restored closure', async () => {
  const store = new Map();
  const first = loadTransport(TRANSPORT, store);
  const r = await first.T.postLead(URL_OK, publicBody({ requestId: null }), {});
  const settled = r.requestId;
  // Back/forward: the page is restored. Model both restore shapes — a fresh parse of the script
  // (a normal navigation) and the same closure surviving (bfcache).
  const restored = loadTransport(TRANSPORT, store);
  assert(restored.T.submissionToken('contact') !== settled, 'a fresh load re-offered a settled identity');
  assert(first.T.submissionToken('contact') !== settled, 'the surviving closure re-offered a settled identity');
  // And the tombstone is what makes that structural rather than lucky.
  const rec = JSON.parse(store.get('fm_sub_contact'));
  eq(rec.d, settled, 'the settled identity was not tombstoned');
});

check('R   HTTP 200 with a business failure RETAINS the identity', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = (n) => (n === 1 ? BUSINESS_FAIL('CRM_UNAVAILABLE') : SETTLED());
  const e = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(e.fmCode, 'rejected', 'a business failure was not reported as a rejection');
  eq(T.slotState('contact'), 'active', 'the slot was retired by a non-settlement 2xx');
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'a business failure rotated the identity');
});

check('R-1 HTTP 200 + ok:true but NO canonical lead_id also retains the identity', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = (n) => (n === 1
    ? { ok: true, status: 200, text: () => Promise.resolve('{"ok":true}') }
    : SETTLED());
  const e = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(e.fmCode, 'rejected', 'an ok:true without a lead id was treated as settlement');
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the identity was rotated without an authoritative settlement');
});

check('S   server settled, response lost: the retry carries X, resolves the same lead, then clears X', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  // Attempt 1 commits on the server; the response never arrives.
  responder.next = (n) => (n === 1 ? NETWORK_FAIL() : SETTLED('FIN-1788000000000-777', 'merged'));
  await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(T.slotState('contact'), 'active', 'the lost response retired the identity');
  const r = await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the retry did not carry the original identity');
  eq(r.leadId, 'FIN-1788000000000-777', 'the canonical lead was not returned');
  eq(r.mode, 'merged', 'the mode was not surfaced');
  eq(T.slotState('contact'), 'idle', 'the authoritative success did not retire the identity');
  assert(T.submissionToken('contact') !== r.requestId, 'the identity survived its settlement');
});

check('T   a 409 conflict retains the identity, and blocks any further send on that slot', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = () => CONFLICT_409();
  const e = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(e.fmStatus, 409, 'not surfaced as 409');
  eq(e.fmErrorCode, 'IDEMPOTENCY_CONFLICT', 'error code not read from the body');
  eq(T.isIdentityConflict(e), true, 'the helper does not recognise the conflict');
  eq(T.slotState('contact'), 'conflict', 'the slot was not sealed');
  const held = idOf(calls, 0);
  // No automatic retry, no automatic rotation: a further postLead is refused BEFORE the network.
  const again = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(again.fmCode, 'identity_conflict_pending', 'the sealed slot sent a request anyway');
  eq(calls.length, 1, 'a second request was sent after the conflict');
  eq(JSON.parse(store.get('fm_sub_contact')).t, held, 'the identity was rotated by the conflict');
});

check('U   an explicit new-request action is the only exit, and it mints a fresh identity', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = (n) => (n === 1 ? CONFLICT_409() : SETTLED());
  await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  const conflicted = idOf(calls, 0);
  T.beginNewSubmission('contact');
  eq(T.slotState('contact'), 'idle', 'the explicit reset did not clear the conflict');
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(calls.length, 2, 'the reset did not re-enable sending');
  assert(idOf(calls, 1) !== conflicted, 'the new submission reused the conflicted identity');
  assert(RI.canonicalise(idOf(calls, 1), {}).ok, 'the new identity is not canonical');
});

check('U-1 nothing but beginNewSubmission can rotate a conflicted identity', async () => {
  const store = new Map();
  const { T, responder } = loadTransport(TRANSPORT, store);
  responder.next = () => CONFLICT_409();
  await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  const held = JSON.parse(store.get('fm_sub_contact')).t;
  // A reload does not clear it, and neither does changing the payload.
  const reloaded = loadTransport(TRANSPORT, store);
  const e = await fails(reloaded.T.postLead(URL_OK, publicBody({ requestId: null, company: 'Delta SRL' }), {}));
  eq(e.fmCode, 'identity_conflict_pending', 'a reload plus an edit escaped the conflict');
  eq(reloaded.calls.length, 0, 'a request was sent from a conflicted slot');
  eq(JSON.parse(store.get('fm_sub_contact')).t, held, 'the identity changed without an explicit reset');
});

check('B-5 two tools in one tab are two logical submissions', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store);
  responder.next = () => NETWORK_FAIL();
  const p1 = publicBody({ requestId: null });
  const p2 = publicBody({ requestId: null }); p2.tool = 'mini_scan';
  await fails(T.postLead(URL_OK, p1, {}));
  await fails(T.postLead(URL_OK, p2, {}));
  assert(idOf(calls, 0) !== idOf(calls, 1), 'two tools shared one identity');
});

check('B-6 blocked sessionStorage still holds the identity for in-page retries', async () => {
  const store = new Map();
  const { T, calls, responder } = loadTransport(TRANSPORT, store, { noStorage: true });
  responder.next = (n) => (n === 1 ? NETWORK_FAIL() : SETTLED());
  await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  await T.postLead(URL_OK, publicBody({ requestId: null }), {});
  eq(idOf(calls, 1), idOf(calls, 0), 'the in-memory fallback did not hold');
});

check('B-7 no CSPRNG: the transport refuses rather than minting a low-entropy identity', async () => {
  const store = new Map();
  const { T, calls } = loadTransport(TRANSPORT, store, { noCrypto: true });
  const e = await fails(T.postLead(URL_OK, publicBody({ requestId: null }), {}));
  eq(e.fmCode, 'identity_unavailable', 'wrong refusal code');
  eq(calls.length, 0, 'a request was sent without a usable identity');
});

check('G   two identities minted in the same millisecond are different', () => {
  const store = new Map();
  const { T } = loadTransport(TRANSPORT, store);
  const seen = new Set();
  const t0 = Date.now();
  for (let i = 0; i < 500; i++) { seen.add(T.newRequestId()); }
  assert(Date.now() - t0 < 1000, 'the loop was not fast enough to be a same-millisecond test');
  eq(seen.size, 500, 'the minter collided');
  for (const id of seen) { assert(RI.canonicalise(id, {}).ok, 'a minted id is not canonical: ' + id); }
  assert(!T.newRequestId().includes(String(Date.now()).slice(0, 6)), 'the identity carries a clock component');
});

// ══════════════════════════════════════════════ the deployed call graph

console.log('');
console.log('CG — every public lead goes through this transport, and every submitter can end');

const PAGES = ['index.html', 'questionnaire.html', 'ro/questionnaire.html',
  'working-capital-scan.html', 'ro/working-capital-scan.html'];
const SUBMITTERS = ['main.js', 'questionnaire.html', 'ro/questionnaire.html',
  'working-capital-scan.html', 'ro/working-capital-scan.html'];

check('CG-1 exactly these five pages load the transport', () => {
  for (const p of PAGES) {
    assert(read(join(ROOT, p)).includes('lead-transport.js'), p + ' does not load the transport');
  }
});

// KNOWN OPEN DEFECT, found by this gate and deliberately NOT fixed in the identity pass.
//
// `ro/index.html` carries `#consultForm` and loads `../main.js`, so `initForm()` binds to it —
// but it does NOT load `../lead-transport.js`. `postLeadPayload()` therefore rejects with
// `transport_unavailable` on every submit, and the Romanian home page has never delivered a lead
// to the CRM. The visitor sees the Telegram/email fallback copy, so it fails visibly and closed.
//
// It is one `<script src>` away from working, and that one line would turn a page which has never
// produced leads into one that does — a customer-facing behaviour change, which is not what an
// identity deploy is for. It is pinned here so it cannot be forgotten AND so that fixing it turns
// this gate red, forcing the fix to be a deliberate, documented act rather than a drive-by.
check('CG-1b ro/index.html still cannot submit: transport absent (KNOWN OPEN DEFECT)', () => {
  const ro = read(join(ROOT, 'ro', 'index.html'));
  assert(ro.includes('id="consultForm"'), 'ro/index.html no longer has the consultation form');
  assert(ro.includes('main.js'), 'ro/index.html no longer loads main.js');
  assert(!ro.includes('lead-transport.js'),
    'ro/index.html now loads the transport — the known defect was fixed; update the report and '
    + 'move this page into PAGES');
});

check('CG-2 no submitter reaches the lead webhook except through postLead', () => {
  for (const f of SUBMITTERS) {
    const text = read(join(ROOT, f));
    // Every fetch/XHR/beacon in a submitter must be something other than a lead POST. The only
    // lead path is FMLeadTransport.postLead, and a second one would be a second identity policy.
    const calls = text.match(/\b(fetch|XMLHttpRequest|sendBeacon)\s*\(/g) || [];
    eq(calls.length, 0, f + ' makes its own network call: ' + calls.join(','));
    assert(/FMLeadTransport\.postLead\(/.test(text), f + ' does not submit through the transport');
  }
});

check('CG-3 every submitter handles the terminal conflict and offers a new request', () => {
  for (const f of SUBMITTERS) {
    const text = read(join(ROOT, f));
    assert(/isIdentityConflict\(/.test(text), f + ' does not detect IDEMPOTENCY_CONFLICT');
    assert(/newRequestControl\(/.test(text), f + ' offers no explicit new-request action');
    // The catch must actually receive the error, or the branch above is unreachable.
    assert(/\.catch\(function \(err\)/.test(text), f + ' discards the rejection it needs to classify');
  }
});

check('CG-4 the frozen pre-identity fixture is not served to anyone', () => {
  for (const p of PAGES) {
    assert(!read(join(ROOT, p)).includes('pre-identity'), p + ' references the frozen fixture');
  }
  assert(TRANSPORT !== TRANSPORT_PRE, 'the deployed transport is still the pre-identity one');
  assert(/submissionToken/.test(TRANSPORT), 'the deployed transport has no submission slot');
  // Comments are stripped: the header explains WHY the low-entropy fallback was removed, and a
  // naive grep reads that explanation as the thing it documents.
  const executable = TRANSPORT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  assert(!/Math\.random/.test(executable), 'the deployed transport still has a low-entropy fallback');
  assert(!/Date\.now\(\)/.test(executable), 'the deployed transport still derives identity from a clock');
});

// ══════════════════════════════════════════════ C/D — the lost response, server side

console.log('');
console.log('C/D — a lost response, on both sides of the Pipeline append');

check('C   response lost AFTER the append: the retry resolves to the same lead, not a second one', () => {
  const p = newPipeline();
  const id = PUB(11);
  const first = submit(CANDIDATE, p, publicBody({ requestId: id }));
  eq(first.outcome, 'new', 'first submit');
  eq(p.rows.length, 1, 'one row after the first submit');
  const retry = submit(CANDIDATE, p, publicBody({ requestId: id }));
  eq(retry.outcome, 'merged', 'the retry did not resolve to the existing lead');
  eq(retry.lead_id, first.lead_id, 'the retry resolved to a different lead');
  eq(p.rows.length, 1, 'the retry appended a second row');
  eq(retry.dedup.dedup_is_retry, true, 'the retry was not recognised as one');
  eq(retry.dedup.dedup_match_by, 'request_id+identity', 'matched by something other than the identity');
});

check('D-s response lost BEFORE the append: the retry settles exactly once', () => {
  const p = newPipeline();
  const id = PUB(12);
  const retry = submit(CANDIDATE, p, publicBody({ requestId: id }));
  eq(retry.outcome, 'new', 'the retry could not settle');
  eq(p.rows.length, 1, 'exactly one row');
  eq(p.rows[0].request_id, id, 'the row does not carry the canonical identity');
  const third = submit(CANDIDATE, p, publicBody({ requestId: id }));
  eq(third.outcome, 'merged', 'a further retry created a second lead');
  eq(p.rows.length, 1, 'exactly one row after three attempts');
});

check('C-1 the identity is durable on the appended row', () => {
  const p = newPipeline();
  const id = PUB(13);
  submit(CANDIDATE, p, publicBody({ requestId: id }));
  eq(p.rows[0].request_id, id, 'Pipeline AZ did not receive the canonical identity');
  assert(String(p.rows[0].lead_id).startsWith('FIN-'), 'lead_id shape changed');
});

// ══════════════════════════════════════════════ E/F — one identity, two submissions

console.log('');
console.log('E/F — one identity may not cover two submissions');

check('E-2 DEPLOYED: one identity + different contact = TWO settled leads sharing it (the defect)', () => {
  const p = newPipeline();
  const id = PUB(21);
  const a = submit(DEPLOYED, p, publicBody({ requestId: id }));
  const b = submit(DEPLOYED, p, publicBody({ requestId: id, company: 'Beta SRL', email: 'attacker@beta.md' }));
  eq(a.outcome, 'new', 'first');
  eq(b.outcome, 'new', 'second');
  eq(p.rows.length, 2, 'expected two rows');
  eq(p.rows[0].request_id, p.rows[1].request_id, 'the two rows do not share the identity');
  assert(p.rows[0].lead_id !== p.rows[1].lead_id, 'the two rows share a lead_id');
});

check('E-1 DEPLOYED: one identity + same contact, changed company = SILENTLY absorbed (the defect)', () => {
  const p = newPipeline();
  const id = PUB(22);
  submit(DEPLOYED, p, publicBody({ requestId: id }));
  const b = submit(DEPLOYED, p, publicBody({ requestId: id, company: 'Beta SRL' }));
  eq(b.outcome, 'merged', 'expected a silent merge');
  eq(p.rows.length, 1, 'expected one row');
  eq(p.rows[0].company, 'Alfa SRL', 'the stored company changed');
});

check('E   CANDIDATE: same identity + changed company = 409 IDEMPOTENCY_CONFLICT', () => {
  const p = newPipeline();
  const id = PUB(23);
  eq(submit(CANDIDATE, p, publicBody({ requestId: id })).outcome, 'new', 'first submit');
  const b = submit(CANDIDATE, p, publicBody({ requestId: id, company: 'Beta SRL' }));
  eq(b.outcome, 'conflict', 'expected a conflict');
  eq(b.http, 409, 'wrong status');
  eq(b.error_code, 'IDEMPOTENCY_CONFLICT', 'wrong error code');
  eq(b.fields, 'company', 'wrong conflict field');
  eq(p.rows.length, 1, 'a second lead was created');
  eq(p.rows[0].company, 'Alfa SRL', 'the first lead was overwritten');
});

check('E-3 CANDIDATE: same identity + changed CONTACT identity = 409', () => {
  // Contact fields are inside the canonical submission identity, by choice: a different person is
  // not a retry of the same submission, whatever the token says.
  // A fresh Pipeline per sub-case. Sharing one would let the second case's FIRST submission merge
  // onto the first case's row on contact identity, so the row carrying that request_id would never
  // exist and the case would prove nothing.
  for (const [seed, over] of [[24, { email: 'someone@else.md' }], [25, { name: 'Другой Человек' }]]) {
    const p = newPipeline();
    const id = PUB(seed);
    eq(submit(CANDIDATE, p, publicBody({ requestId: id })).outcome, 'new', 'precondition for ' + JSON.stringify(over));
    const b = submit(CANDIDATE, p, publicBody(Object.assign({ requestId: id }, over)));
    eq(b.outcome, 'conflict', 'expected a conflict for ' + JSON.stringify(over));
    eq(b.http, 409, 'wrong status');
    eq(p.rows.length, 1, 'a second lead was created for ' + JSON.stringify(over));
  }
});

check('F   CANDIDATE: same identity + changed task/problem = 409 on main_pain', () => {
  const p = newPipeline();
  const id = PUB(26);
  submit(CANDIDATE, p, publicBody({ requestId: id }));
  const b = submit(CANDIDATE, p, publicBody({ requestId: id, pain: 'Нет управленческой отчётности' }));
  eq(b.outcome, 'conflict', 'expected a conflict');
  eq(b.fields, 'main_pain', 'wrong conflict field');
  eq(p.rows.length, 1, 'a second lead was created');
});

check('F-1 the conflict message names no column to the caller', () => {
  const p = newPipeline();
  const id = PUB(27);
  submit(CANDIDATE, p, publicBody({ requestId: id }));
  const b = submit(CANDIDATE, p, publicBody({ requestId: id, company: 'Beta SRL' }));
  assert(!/company/i.test(String(b.error_message)), 'the response names the differing column');
  eq(b.fields, 'company', 'the operator-side field list is missing');
});

check('EQ-5 same identity + identical canonical content = retry, however many times', () => {
  const p = newPipeline();
  const id = PUB(28);
  submit(CANDIDATE, p, publicBody({ requestId: id }));
  for (let i = 0; i < 4; i++) {
    eq(submit(CANDIDATE, p, publicBody({ requestId: id })).outcome, 'merged',
      'retry ' + (i + 1) + ' was not treated as a retry');
  }
  eq(p.rows.length, 1, 'retries created rows');
});

check('EQ-6 same identity + an OMITTED field on the retry = retry, not a conflict', () => {
  // Rationale, and it is the whole reason the rule is subsumption rather than equality: a blank
  // incoming value is a FILL, which is exactly what Build Merge Update's fill() already performs.
  // Under an equality rule a partial retry — a form that lost a field to a restore, or a client
  // that trims empties — would be indistinguishable from a different submission.
  const p = newPipeline();
  const id = PUB(29);
  submit(CANDIDATE, p, publicBody({ requestId: id }));
  const b = submit(CANDIDATE, p, publicBody({ requestId: id, company: '', pain: '' }));
  eq(b.outcome, 'merged', 'an omitted field was scored as a conflict');
  eq(p.rows.length, 1, 'a row was created');
  eq(p.rows[0].company, 'Alfa SRL', 'the omission erased a stored value');
});

check('EQ-7 same identity + changed SOURCE/UTM metadata only = NO conflict', () => {
  const p = newPipeline();
  const id = PUB(30);
  submit(CANDIDATE, p, publicBody({ requestId: id }));
  const b = submit(CANDIDATE, p, publicBody({
    requestId: id,
    pageUrl: 'https://www.finmentor.md/cash-flow.html?utm_source=newsletter',
    utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'august'
  }));
  eq(b.outcome, 'merged', 'attribution-only metadata produced a false business conflict');
  eq(p.rows.length, 1, 'a second lead was created');
});

check('EQ-8 two DIFFERENT identities never conflict, even with identical content', () => {
  const p = newPipeline();
  submit(CANDIDATE, p, publicBody({ requestId: PUB(31) }));
  const b = submit(CANDIDATE, p, publicBody({ requestId: PUB(32) }));
  eq(b.outcome, 'merged', 'the same person submitting twice should merge on contact identity');
});

// ══════════════════════════════════════════════ H/I — missing and malformed

console.log('');
console.log('H/I — missing, malformed and route-crossing identities');

check('H-0 DEPLOYED: a missing identity is accepted and persisted blank (the defect)', () => {
  const p = newPipeline();
  const r = submit(DEPLOYED, p, publicBody({ requestId: null }));
  eq(r.outcome, 'new', 'deployed refused a blank identity');
  eq(p.rows[0].request_id, '', 'deployed did not persist a blank');
});

check('H-c CANDIDATE: a missing identity is refused, and nothing is written', () => {
  const p = newPipeline();
  const r = submit(CANDIDATE, p, publicBody({ requestId: null }));
  eq(r.outcome, 'refused', 'expected a refusal');
  eq(r.error_code, 'IDENTITY_MISSING', 'wrong code');
  eq(p.rows.length, 0, 'a row was written for a request with no identity');
});

check('H-1 an empty-string identity is refused as missing, not accepted as a value', () => {
  const p = newPipeline();
  eq(submit(CANDIDATE, p, publicBody({ requestId: '' })).error_code, 'IDENTITY_MISSING', 'empty string');
  eq(submit(CANDIDATE, p, publicBody({ requestId: '   ' })).error_code, 'IDENTITY_MISSING', 'whitespace');
  eq(p.rows.length, 0, 'a row was written');
});

check('I   CANDIDATE: malformed identities are refused with 400, not 409', () => {
  const p = newPipeline();
  for (const bad of ['fmr_nothex', 'fmr_', 'fmr_1799abc_9f3e2d11', 'FIN-1787647511532-911',
    'x'.repeat(90), 'fmr_' + '0'.repeat(31), 'fmr_' + '0'.repeat(33), '<script>alert(1)</script>']) {
    const r = submit(CANDIDATE, p, publicBody({ requestId: bad }));
    eq(r.outcome, 'refused', 'accepted a malformed identity: ' + bad);
    eq(r.error_code, 'IDENTITY_MALFORMED', 'wrong code for: ' + bad);
    eq(r.http, 400, 'a malformed request is not a conflict: ' + bad);
  }
  eq(p.rows.length, 0, 'a row was written for a malformed identity');
});

check('I-1 a public caller may not present an INTERNAL identity', () => {
  const p = newPipeline();
  for (const foreign of ['sub_' + HEX(41), 'C-88112233-1787678806037']) {
    const r = submit(CANDIDATE, p, publicBody({ requestId: foreign }));
    eq(r.outcome, 'refused', 'accepted a foreign-route identity: ' + foreign);
    eq(r.error_code, 'IDENTITY_ROUTE_FORBIDDEN', 'wrong code for: ' + foreign);
  }
  eq(p.rows.length, 0, 'a row was written');
});

check('I-2 DEPLOYED: a public caller CAN plant an internal identity in Pipeline AZ (the defect)', () => {
  const p = newPipeline();
  const foreign = 'sub_' + HEX(42);
  const r = submit(DEPLOYED, p, publicBody({ requestId: foreign }));
  eq(r.outcome, 'new', 'deployed refused it');
  eq(p.rows[0].request_id, foreign, 'deployed did not persist the foreign identity');
});

check('I-3 the identity is read from ONE location: meta.request_id', () => {
  const p = newPipeline();
  const body = publicBody({ requestId: null });
  body.request_id = PUB(43);
  const r = submit(CANDIDATE, p, body);
  eq(r.outcome, 'refused', 'a top-level request_id was accepted as identity');
  eq(r.error_code, 'IDENTITY_MISSING', 'wrong code');
});

check('I-4 a refusal never persists a settled identity', () => {
  const p = newPipeline();
  for (const bad of [null, '', 'fmr_nothex', 'sub_' + HEX(44)]) {
    submit(CANDIDATE, p, publicBody({ requestId: bad }));
  }
  eq(p.rows.length, 0, 'a refused request reached the Pipeline');
});

// ══════════════════════════════════════════════ V — merge immutability

console.log('');
console.log('V — the identity is immutable after NEW settlement');

check('V-0 DEPLOYED: a genuine later merge ADVANCES the identity off the original request (the defect)', () => {
  const p = newPipeline();
  const first = PUB(51);
  submit(DEPLOYED, p, publicBody({ requestId: first }));
  eq(p.rows[0].request_id, first, 'precondition');
  age(p, 45 * 24 * 60);
  const second = PUB(52);
  submit(DEPLOYED, p, publicBody({ requestId: second, message: 'Второе обращение через месяц' }));
  eq(p.rows.length, 1, 'expected a merge');
  eq(p.rows[0].request_id, second, 'deployed did not advance the identity');
});

check('V   CANDIDATE: a merge with a new incoming identity leaves the original unchanged', () => {
  const p = newPipeline();
  const first = PUB(53);
  submit(CANDIDATE, p, publicBody({ requestId: first }));
  age(p, 45 * 24 * 60);
  const r = submit(CANDIDATE, p, publicBody({ requestId: PUB(54), message: 'Второе обращение через месяц' }));
  eq(r.outcome, 'merged', 'expected a merge');
  eq(r.dedup.dedup_is_retry, false, 'the fixture is a retry, so it never reaches the advance path');
  eq(p.rows.length, 1, 'a second row appeared');
  eq(p.rows[0].request_id, first, 'the NEW-event identity was replaced');
  assert(!Object.prototype.hasOwnProperty.call(r.update, 'request_id'),
    'the merge object carries request_id, so autoMap would write it');
});

check('V-2 the complete census of writers that can touch Pipeline request_id', () => {
  const js = src(CANDIDATE, 'Build Merge Update');
  assert(!/upd\.request_id/.test(js), 'Build Merge Update assigns request_id');

  const PIPELINE_GID = 1883973304;
  const into = {};
  for (const [from, o] of Object.entries(CANDIDATE.connections)) {
    for (const branch of (o.main || [])) {
      for (const t of (branch || [])) { (into[t.node] = into[t.node] || []).push(from); }
    }
  }
  const writers = CANDIDATE.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets'
    && ['append', 'update', 'appendOrUpdate'].includes(n.parameters.operation)
    && ((n.parameters.sheetName || {}).value === PIPELINE_GID));
  eq(writers.map((n) => n.name).sort().join(' | '),
    'Save to Pipeline | Update Pipeline (Merge) | Update Pipeline AI Ready',
    'the set of Pipeline writers changed');

  for (const w of writers) {
    const cols = w.parameters.columns || {};
    if (cols.mappingMode === 'defineBelow') {
      eq(Object.prototype.hasOwnProperty.call(cols.value || {}, 'request_id'),
        w.name === 'Save to Pipeline', w.name + ': wrong request_id mapping');
      eq(w.parameters.operation, 'append', w.name + ': maps request_id on a non-append');
      continue;
    }
    eq(cols.mappingMode, 'autoMapInputData', w.name + ': unexpected mapping mode');
    const feeders = into[w.name] || [];
    eq(feeders.length, 1, w.name + ': expected exactly one feeder, got ' + feeders.join(','));
    const feeder = CANDIDATE.nodes.find((n) => n.name === feeders[0]);
    const code = String((feeder.parameters || {}).jsCode || '');
    assert(code !== '', w.name + ': feeder ' + feeder.name + ' is not a code node');
    // Comments are stripped before the scan. `Build Merge Update` carries a long comment
    // explaining WHY the identity is omitted, and a naive grep would read that explanation as the
    // defect it documents.
    const executable = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    assert(!/request_id/.test(executable),
      w.name + ': its feeder ' + feeder.name + ' can emit request_id into an auto-mapped update');
  }
});

check('V-3 a merge cannot clear the identity either', () => {
  const p = newPipeline();
  const first = PUB(55);
  submit(CANDIDATE, p, publicBody({ requestId: first }));
  age(p, 45 * 24 * 60);
  submit(CANDIDATE, p, publicBody({ requestId: PUB(56), company: '' }));
  eq(p.rows[0].request_id, first, 'the identity was cleared by a merge');
});

check('V-4 a LEGACY blank row is not given an identity by a later merge', () => {
  const p = newPipeline();
  p.rows.push({
    lead_id: 'FIN-1787647511532-911', created_at: '2026-08-25T08:45:11.532Z',
    updated_at: '2026-08-25T08:45:11.532Z', name: 'Иван Петров', company: 'Alfa SRL',
    email: 'ivan@alfa.md', phone: '', telegram: '', deal_stage: 'New', priority: 'WARM',
    financial_zone: 'UNKNOWN', request_id: ''
  });
  const r = submit(CANDIDATE, p, publicBody({ requestId: PUB(57) }));
  eq(r.outcome, 'merged', 'expected a merge onto the legacy row');
  eq(p.rows.length, 1, 'a second row appeared');
  eq(p.rows[0].request_id, '', 'the legacy row acquired an identity it never had');
});

// ══════════════════════════════════════════════ W/X — the internal routes

console.log('');
console.log('W/X — the internal routes are regression-equivalent');

check('W   CONCIERGE: the cycle identity settles, canonically and unchanged', () => {
  const p = newPipeline();
  const cycle = 'C-88112233-1787678806037';
  const r = submit(CANDIDATE, p, internalBody(cycle, { tool: 'telegram_client_concierge' }),
    { internal: true, correlationId: cycle });
  eq(r.outcome, 'new', 'the Concierge route was refused: ' + JSON.stringify(r));
  eq(p.rows[0].request_id, cycle, 'the cycle identity was rewritten');
  eq(r.normalized.provenance_trusted, true, 'provenance was lost');
});

check('W-1 a NEGATIVE (group) chat id still produces a valid cycle identity', () => {
  const p = newPipeline();
  const cycle = 'C--1001234567890-1787678806037';
  const r = submit(CANDIDATE, p, internalBody(cycle), { internal: true, correlationId: cycle });
  eq(r.outcome, 'new', 'a group cycle was refused: ' + JSON.stringify(r));
  eq(p.rows[0].request_id, cycle, 'the group cycle identity was rewritten');
});

check('W-2 Concierge retry inside one cycle resolves to the same lead', () => {
  const p = newPipeline();
  const cycle = 'C-88112233-1787678806037';
  const a = submit(CANDIDATE, p, internalBody(cycle), { internal: true, correlationId: cycle });
  const b = submit(CANDIDATE, p, internalBody(cycle), { internal: true, correlationId: cycle });
  eq(b.outcome, 'merged', 'a replay inside the cycle created a second lead');
  eq(b.lead_id, a.lead_id, 'the replay resolved elsewhere');
  eq(p.rows.length, 1, 'two rows');
});

check('X   MINI APP: the submission key settles, canonically and unchanged', () => {
  const p = newPipeline();
  const key = 'sub_' + HEX(61);
  const r = submit(CANDIDATE, p, internalBody(key), { internal: true, correlationId: key });
  eq(r.outcome, 'new', 'the Mini App route was refused: ' + JSON.stringify(r));
  eq(p.rows[0].request_id, key, 'the submission key was rewritten');
});

check('X-1 Correlation Guard still agrees on both internal routes', () => {
  for (const id of ['sub_' + HEX(62), 'C-88112233-1787678806037']) {
    const p = newPipeline();
    const r = submit(CANDIDATE, p, internalBody(id), { internal: true, correlationId: id });
    assert(r.outcome !== 'correlation_refused', 'Correlation Guard now disagrees for ' + id);
    eq(r.normalized.request_id, id, 'Normalize derived a different value than the guard expects');
  }
});

check('X-2 an internal caller may not present a PUBLIC identity', () => {
  const p = newPipeline();
  const r = submit(CANDIDATE, p, internalBody(PUB(63)), { internal: true, correlationId: PUB(63) });
  eq(r.outcome, 'refused', 'an fmr_ identity was accepted on the internal route');
  eq(r.error_code, 'IDENTITY_ROUTE_FORBIDDEN', 'wrong code');
});

check('W-3/X-3 both internal routes behave identically under the deployed and candidate graphs', () => {
  for (const id of ['sub_' + HEX(64), 'C-88112233-1787678806037']) {
    const a = newPipeline(); const b = newPipeline();
    const ra = submit(DEPLOYED, a, internalBody(id), { internal: true, correlationId: id });
    const rb = submit(CANDIDATE, b, internalBody(id), { internal: true, correlationId: id });
    eq(rb.outcome, ra.outcome, 'outcome changed for ' + id);
    eq(b.rows[0].request_id, a.rows[0].request_id, 'persisted identity changed for ' + id);
    eq(b.rows[0].priority, a.rows[0].priority, 'scoring changed for ' + id);
    eq(b.rows[0].financial_zone, a.rows[0].financial_zone, 'zone changed for ' + id);
    eq(b.rows[0].lead_id.slice(0, 4), 'FIN-', 'lead_id shape changed for ' + id);
  }
});

// ══════════════════════════════════════════════ the outbox precondition

console.log('');
console.log('the precondition the Alert Outbox is blocked on (outbox NOT built in this pass)');

check('OB-1 under the candidate, no two settled NEW rows can share an identity', () => {
  const p = newPipeline();
  const shared = PUB(71);
  submit(CANDIDATE, p, publicBody({ requestId: shared }));
  submit(CANDIDATE, p, publicBody({ requestId: shared, company: 'Beta SRL', email: 'b@beta.md' }));
  submit(CANDIDATE, p, publicBody({ requestId: shared, company: 'Gamma SRL', email: 'g@gamma.md', name: 'Другой' }));
  submit(CANDIDATE, p, publicBody({ requestId: PUB(72), email: 'c@ceta.md', company: 'Ceta SRL', name: 'Третий' }));
  const ids = p.rows.map((r) => String(r.request_id));
  eq(new Set(ids).size, ids.length, 'two settled rows share an identity: ' + JSON.stringify(ids));
  assert(ids.every((x) => x !== ''), 'a settled row has no identity');
});

check('OB-2 every settled row yields a dispatch key, and a legacy row yields none', () => {
  const p = newPipeline();
  p.rows.push({ lead_id: 'FIN-1787647511532-911', request_id: '', created_at: '2026-08-25T08:45:11.532Z',
    name: 'Иван Петров', company: 'Alfa SRL', email: 'ivan@alfa.md', deal_stage: 'New' });
  submit(CANDIDATE, p, publicBody({ requestId: PUB(73), email: 'new@delta.md', company: 'Delta SRL', name: 'Новый' }));
  const keyed = p.rows.filter((r) => String(r.request_id || '').trim() !== '');
  const legacy = p.rows.filter((r) => String(r.request_id || '').trim() === '');
  eq(keyed.length, 1, 'expected one dispatchable row');
  eq(legacy.length, 1, 'expected one LEGACY_IDENTITY_MISSING row');
  eq('NEW_LEAD:' + keyed[0].request_id, 'NEW_LEAD:' + PUB(73), 'the dispatch key is not derivable');
});

// ══════════════════════════════════════════════════════════════════════════════

console.log('');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('');
  for (const f of failures) { console.log('  FAILED  ' + f); }
  process.exit(1);
}
console.log('');
console.log('  Nothing above deployed, imported, applied DDL or wrote a row.');
console.log('');
