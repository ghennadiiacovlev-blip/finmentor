#!/usr/bin/env node
// FINMENTOR — build the B.2.1-C Lead Intake candidate with the MODEL B receipt critical
// section spliced in. P5.1 revision.
//
//   node scripts/build-lead-intake-receipt-candidate.mjs
//
// REPO-ONLY. Reads the tracked production export and WRITES A NEW FILE under n8n/candidate/.
// It never contacts n8n, never mutates the production export, never touches a live workflow.
//
// Why a generator rather than a hand-edited JSON: the splice is a small, stateable
// transformation of a large file. As code it is reviewable, regenerable and diffable. Hand
// editing would make the interesting part — where the claim goes, what the zero-row branch
// reaches, which terminals the internal path may touch — the hardest thing to see.
//
// ================================ THE P5.1 SHAPE ================================
//
// Existing nodes in [], new nodes in <>.
//
// ENTRY. The public webhook and the internal sub-workflow share ONE validation pipeline, so
// the internal route cannot skip a check the public route performs. F1: the provenance marker
// is written BY <Internal Auth Entry> ITSELF, which is reachable only from the internal
// trigger — not by the node after it, which is what P5 got wrong and which made
// internalRouteProven() permanently false.
//
//   <Internal Subworkflow Trigger> -> <Internal Auth Entry> -> <IF Internal Fault>
//                                           |                       true -> <Internal Result (Fault)>
//                                           |                       false -> <Internal Envelope Unwrap>
//   [Webhook] -----------------------------------------------------------------> [Validate Payload]
//   <Internal Envelope Unwrap> ------------------------------------------------> [Validate Payload]
//
// F2: the gateway sends the WRAPPER { submission_key, envelope }. Validate Payload expects the
// ENVELOPE { source, payload }. <Internal Auth Entry> proves the wrapper and <Internal Envelope
// Unwrap> emits the envelope shape ALONE. submission_key is never injected into the payload;
// the receipt nodes read it from <Internal Auth Entry> by node reference.
//
// F3: a TRUSTED call whose controls are malformed must never degrade into ordinary public
// processing. <IF Internal Fault> sits before the shared pipeline, so a bad internal call
// never reaches Validate Payload at all.
//
//   [Validate Payload] -> <Internal Flag> -> [IF Valid]
//   [Normalize + Score Lead] -> <Correlation Guard> -> <IF Correlation OK>
//                                                        false -> <Internal Result (Correlation)>
//                                                        true  -> [Read Pipeline (Dedup)]
//
// RECEIPT. F6: retry is settled DIRECTLY, READY -> COMMITTED, because that branch has no
// Pipeline write to protect. new/merge still go through IN_FLIGHT.
//
//   [Dedup Guard] -> <Receipt Gate> -> <IF Receipt Required>
//        false -> [IF Is New]                                   (public / ordinary)
//        true  -> <Receipt Exact Read> -> <Receipt Read Verdict> -> <IF Receipt Claimable>
//                    false -> <Internal Result (Unresolved)>
//                    true  -> <IF Receipt Is Retry>
//                               true  -> <Receipt Retry Settlement> -> <Retry Settlement Verdict>
//                                          -> <IF Retry Settled> true -> <Internal Result (Retry)>
//                                                                false -> <Internal Result (Unresolved)>
//                               false -> <Receipt Claim> -> <Claim Verdict> -> <IF Claim Won>
//                                          true  -> [IF Is New]
//                                          false -> <Internal Result (Unresolved)>
//
// TERMINALS. F4: RespondToWebhook is NOT assumed to work inside an executeWorkflowTrigger
// execution, so the internal path never reaches one. Every terminal the internal path can
// reach is gated, and the internal side ends at a Code node whose output is the sub-workflow
// return value.
//
//   [Save to Pipeline] 0 -> <IF Internal (New)>  true -> <Receipt Commit (New)> -> ... -> <Internal Result (New)>
//                                                false -> [Respond New Lead]
//                      1 -> <IF Internal (PipelineFailed)> true -> <Internal Result (PipelineFailed)>
//                                                          false -> [Respond Pipeline Failed]
//   ...and the same shape for Merge, Invalid and Infra.
//
// [Respond Retry] is NOT gated, deliberately: internal retries are diverted at
// <IF Receipt Is Retry>, so the internal path cannot reach it. The graph test asserts that
// rather than a dead gate pretending otherwise.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SOURCE = join(ROOT, 'n8n/production/QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');
const OUT_DIR = join(ROOT, 'n8n/candidate');
const OUT = join(OUT_DIR, 'lead-intake-internal-receipt-candidate.json');

// Referenced BY NAME. The production table does not exist yet — P6 creates it — and baking a
// placeholder id would produce a candidate that looks deployable while pointing at nothing.
const TABLE = { __rl: true, mode: 'name', value: 'Submission_Receipts' };

const wf = JSON.parse(readFileSync(SOURCE, 'utf8'));

function nodeByName(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) { throw new Error('anchor node missing from production export: ' + name); }
  return n;
}

// Fail loudly if the production graph is not the shape this splice assumes. A silent splice
// onto a drifted graph is how a claim ends up on the wrong side of a Pipeline write.
[
  'Webhook', 'Validate Payload', 'IF Valid', 'Normalize + Score Lead', 'Read Pipeline (Dedup)',
  'Dedup Guard', 'IF Is New', 'IF Is Retry', 'Save to Pipeline', 'Update Pipeline (Merge)',
  'Respond New Lead', 'Respond Retry', 'Respond Merged', 'Respond Invalid',
  'Respond Pipeline Failed', 'Respond Merge Failed', 'Respond Infra Failed', 'Read Settings'
].forEach(nodeByName);

const at = (name, dx, dy) => {
  const p = nodeByName(name).position;
  return [p[0] + dx, p[1] + dy];
};

let idSeq = 0;
const nid = (slug) => 'p51-' + String(++idSeq).padStart(2, '0') + '-' + slug;

const NEW_NODES = [];
const add = (n) => { NEW_NODES.push(n); return n; };

function code(name, position, jsCode, notes) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: nid('code'), name: name, type: 'n8n-nodes-base.code', typeVersion: 2,
    position: position, notes: notes
  };
}

function ifNum(name, position, leftExpr, rightValue, notes) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: nid('cond'), leftValue: leftExpr, rightValue: rightValue,
          operator: { type: 'number', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: nid('if'), name: name, type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: position, notes: notes
  };
}

// F4 — the internal return contract. This node's output IS what the parent Execute Sub-workflow
// node receives, because a sub-workflow returns the data of its LAST EXECUTED NODE. Nothing
// here is a RespondToWebhook.
//
// Shape is fixed and narrow: no stage, no detail, no submission_key. `fields` is a literal
// object expression built by the caller.
function internalResult(name, position, bodyJs, notes) {
  return code(name, position, bodyJs, notes);
}

const RESULT_OK = (leadIdExpr, modeLiteral, priorityExpr, zoneExpr) => [
  '// F4 internal return contract. The parent gateway receives THIS node output.',
  '// Deliberately narrow: no stage, no detail, no submission_key.',
  'return [{ json: {',
  '  ok: true,',
  '  lead_id: ' + leadIdExpr + ',',
  "  mode: '" + modeLiteral + "',",
  '  priority: ' + priorityExpr + ',',
  '  financial_zone: ' + zoneExpr,
  '} }];'
].join('\n');

const RESULT_FAIL = (codeExpr, retryable) => [
  '// F4 internal return contract, failure form. No stage, no detail, no submission_key.',
  'return [{ json: {',
  '  ok: false,',
  '  error_code: ' + codeExpr + ',',
  '  retryable: ' + (retryable ? 'true' : 'false'),
  '} }];'
].join('\n');

// ---------------------------------------------------------------- F1/F2 entry

add({
  parameters: { inputSource: 'passthrough' },
  id: nid('trigger'),
  name: 'Internal Subworkflow Trigger',
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  typeVersion: 1.2,
  position: at('Webhook', -220, -260),
  notes: 'P1-L10 internal entry. Invoked in-tenant by the Mini App gateway. No public URL, ' +
    'no transport secret. Receives the wrapper { submission_key, envelope }.'
});

// F1 — THE PROVENANCE MARKER IS WRITTEN HERE, BY THIS NODE.
//
// P5 wrote it in the node AFTER Internal Auth Entry while internalRouteProven() read
// Internal Auth Entry's own output, so provenance was false for every internal call unless
// the CALLER supplied __internal_route — which is exactly what the design forbids. The marker
// and the node that internalRouteProven() names must be the same node.
add(code('Internal Auth Entry', at('Webhook', 0, -260),
  [
    '// F1 — provenance marker, written by the GRAPH, on THIS node, which is reachable only',
    '// from the internal sub-workflow trigger. internalRouteProven() reads exactly this node,',
    '// so the marker and the proof are the same output. The caller cannot supply it: the',
    '// wrapper is read for submission_key and envelope only, and any __internal_route,',
    '// provenanceTrusted, internal or authenticated field the caller sends is never consulted.',
    '//',
    '// F2 — prove the WRAPPER before anything downstream sees it.',
    "const KEY_RE = /^sub_[0-9a-f]{32}$/;",
    'const raw = $input.first().json || {};',
    '',
    "let fault = 0;",
    "let faultReason = '';",
    '',
    "const key = typeof raw.submission_key === 'string' ? raw.submission_key : '';",
    'if (!KEY_RE.test(key)) { fault = 1; faultReason = faultReason || \'SUBMISSION_KEY_INVALID\'; }',
    '',
    'const env = raw.envelope;',
    "const envOk = !!env && typeof env === 'object' && !Array.isArray(env);",
    "if (!envOk) { fault = 1; faultReason = faultReason || 'ENVELOPE_MISSING'; }",
    "const src = envOk ? String(env.source || '') : '';",
    "if (envOk && src !== 'telegram_miniapp') { fault = 1; faultReason = faultReason || 'ENVELOPE_SOURCE_INVALID'; }",
    'const payload = envOk ? env.payload : undefined;',
    "const payloadOk = !!payload && typeof payload === 'object' && !Array.isArray(payload);",
    "if (envOk && !payloadOk) { fault = 1; faultReason = faultReason || 'ENVELOPE_PAYLOAD_MISSING'; }",
    '',
    '// F2 — the correlation id is read from the CANONICAL location and nowhere else:',
    '// envelope.payload.meta.request_id. P5 read e.meta.request_id || e.request_id, neither of',
    '// which exists on this wrapper, so it resolved empty every time.',
    "const meta = payloadOk && payload.meta && typeof payload.meta === 'object' ? payload.meta : {};",
    "const correlationId = String(meta.request_id || '').trim().slice(0, 80);",
    "if (correlationId === '') { fault = 1; faultReason = faultReason || 'CORRELATION_ID_MISSING'; }",
    '',
    'return [{ json: {',
    '  __internal_route: true,',
    '  __submission_key: fault ? \'\' : key,',
    '  __correlation_id: fault ? \'\' : correlationId,',
    '  __internal_fault: fault,',
    '  __fault_reason: faultReason,',
    '  __envelope_source: src,',
    '  __envelope: envOk ? env : null',
    '} }];'
  ].join('\n'),
  'F1 marker + F2 wrapper proof. The marker is on THIS node because internalRouteProven() ' +
  'reads THIS node. Never reads provenance from the caller.'));

// F3 — a trusted call with malformed controls stops HERE. It never reaches the shared
// validation pipeline, so it can never degrade into ordinary public processing.
add(ifNum('IF Internal Fault', at('Webhook', 220, -260),
  '={{ $json.__internal_fault }}', 1,
  'F3. TRUE = trusted internal call with unusable controls -> fail closed, zero Pipeline, ' +
  'zero receipt writes, never the public flow.'));

add(internalResult('Internal Result (Fault)', at('Webhook', 440, -360),
  RESULT_FAIL("String($json.__fault_reason || 'INTERNAL_REQUEST_INVALID')", false),
  'F3/F4 terminal. Reachable only from the internal fault gate.'));

// F2 — hand the shared pipeline the REQUEST SHAPE Validate Payload actually reads.
add(code('Internal Envelope Unwrap', at('Webhook', 440, -260),
  [
    '// F10 — emit the shape Validate Payload READS, which is the WEBHOOK request shape',
    "// { headers, body } -- NOT { source, payload }.",
    '//',
    '// This node previously emitted { source, payload }, on the documented but WRONG belief',
    '// that Lead Intake parses the envelope shape. Validate Payload is an INHERITED',
    '// PRODUCTION node and it reads raw.body / raw.headers. The consequence was total: every',
    '// internal submission resolved to INVALID_PAYLOAD ("Body must be a JSON object") and the',
    '// internal route could never accept a lead at all. Found live in P6.2 (exec 3583), not',
    '// offline -- the old gate asserted the WIRING across this seam but never the SHAPE.',
    '//',
    '// The header is a SERVER-SIDE LITERAL, not env.source. Internal Auth Entry has already',
    '// hard-required env.source === telegram_miniapp, so the literal is exactly as truthful',
    '// and cannot be steered by a caller -- provenance is established by the route, never by',
    '// a field in a body. Validate Payload is the only node in the graph that reads headers,',
    "// and only headers['x-finmentor-source'].",
    '//',
    '// submission_key is deliberately NOT injected into the body. It is a receipt control,',
    '// not lead data, and putting it in the body would make it indistinguishable from a',
    '// caller-supplied field one node later. The receipt nodes read it from',
    "// $('Internal Auth Entry') by node reference instead.",
    "const env = $('Internal Auth Entry').first().json.__envelope || {};",
    'return [{ json: {',
    "  headers: { 'x-finmentor-source': 'telegram_miniapp' },",
    '  body: env.payload',
    '} }];'
  ].join('\n'),
  'F10. Emits the webhook request shape { headers, body }. submission_key never enters the body.'));

// A safe internal-ness flag every downstream gate can read. Needed because the terminals
// before Receipt Gate cannot reference Internal Auth Entry directly: on the public path that
// node never ran, and an expression that touches it would throw rather than answer false.
add(code('Internal Flag', at('Validate Payload', 0, 220),
  [
    '// One safe answer to "is this the internal route?", computed with try/catch because',
    "// $('Internal Auth Entry') THROWS on the public path, where that node never ran.",
    'function internalRouteProven() {',
    "  try { return $('Internal Auth Entry').first().json.__internal_route === true; }",
    '  catch (e) { return false; }',
    '}',
    'const isInternal = internalRouteProven() ? 1 : 0;',
    'const out = [];',
    'for (const i of $input.all()) {',
    '  const j = Object.assign({}, i.json);',
    '  j.__internal = isInternal;',
    '  out.push({ json: j });',
    '}',
    'return out;'
  ].join('\n'),
  'Passes Validate Payload output through untouched and adds __internal for the terminal gates.'));

// ---------------------------------------------------------------- F2 correlation equality

add(code('Correlation Guard', at('Normalize + Score Lead', 0, 240),
  [
    '// F2 — prove the correlation id the receipt will stamp is the SAME value the rest of the',
    '// pipeline uses. Normalize + Score Lead derives request_id from payload.meta.request_id,',
    '// and that value is what reaches Pipeline column AZ on a write-bearing branch. If the two',
    '// ever differ, one of them is wrong and there is no safe way to pick — so this fails',
    '// closed BEFORE the receipt leaves READY rather than silently choosing a winner.',
    'function internalRouteProven() {',
    "  try { return $('Internal Auth Entry').first().json.__internal_route === true; }",
    '  catch (e) { return false; }',
    '}',
    'const isInternal = internalRouteProven();',
    "let expected = '';",
    'if (isInternal) {',
    "  try { expected = String($('Internal Auth Entry').first().json.__correlation_id || ''); }",
    "  catch (e) { expected = ''; }",
    '}',
    "const observed = String($('Normalize + Score Lead').first().json.request_id || '');",
    '// Public traffic has nothing to compare, so it always passes.',
    "const okFlag = (!isInternal || (expected !== '' && expected === observed)) ? 1 : 0;",
    'const out = [];',
    'for (const i of $input.all()) {',
    '  const j = Object.assign({}, i.json);',
    '  j.__correlation_ok = okFlag;',
    '  j.__internal = isInternal ? 1 : 0;',
    '  out.push({ json: j });',
    '}',
    'return out;'
  ].join('\n'),
  'F2. Internal correlation id must equal Normalize request_id, or fail closed before the claim.'));

add(ifNum('IF Correlation OK', at('Normalize + Score Lead', 220, 240),
  '={{ $json.__correlation_ok }}', 1,
  'FALSE = the receipt correlation and the pipeline request_id disagree. Never silently pick one.'));

add(internalResult('Internal Result (Correlation)', at('Normalize + Score Lead', 440, 340),
  RESULT_FAIL("'SUBMIT_UNRESOLVED'", true),
  'F2 terminal. Correlation mismatch, fail closed before READY -> IN_FLIGHT.'));

// ---------------------------------------------------------------- receipt branch

add(code('Receipt Gate', at('Dedup Guard', 0, 260),
  [
    '// Decide whether this execution is inside the receipt critical section.',
    '//',
    '// TWO conditions, both server-side and both re-derived here rather than trusted from',
    '// upstream: internal provenance proven by the GRAPH, and an exact submission key that',
    '// arrived over that trusted transport.',
    '//',
    '// The public path fails the first and therefore never reads, creates, claims or commits a',
    '// receipt, and never reveals whether any key exists. A public caller that sends a',
    '// submission_key gets ordinary public behaviour with the field ignored — not an error,',
    '// because an error that fires only for real keys is an existence oracle.',
    'function internalRouteProven() {',
    "  try { return $('Internal Auth Entry').first().json.__internal_route === true; }",
    '  catch (e) { return false; }',
    '}',
    'const trusted = internalRouteProven();',
    '',
    "const KEY_RE = /^sub_[0-9a-f]{32}$/;",
    '// Read the key ONLY from the trusted internal entry, never from the request body.',
    "let key = '';",
    "let correlationId = '';",
    'if (trusted) {',
    '  try {',
    "    const e = $('Internal Auth Entry').first().json;",
    "    key = String(e.__submission_key || '').trim();",
    "    correlationId = String(e.__correlation_id || '').trim();",
    "  } catch (e) { key = ''; correlationId = ''; }",
    '}',
    'const keyValid = KEY_RE.test(key);',
    "const receiptRequired = trusted && keyValid && correlationId !== '';",
    '',
    '// F3 defence in depth. Internal Auth Entry already fails closed on malformed controls, so',
    '// this should be unreachable — but if a trusted call ever arrives here without usable',
    '// controls it must NOT quietly become a public request.',
    'const fault = (trusted && !receiptRequired) ? 1 : 0;',
    '',
    'const out = [];',
    'for (const i of $input.all()) {',
    '  const j = Object.assign({}, i.json);',
    '  j.__internal = trusted ? 1 : 0;',
    '  j.__receipt_required = receiptRequired ? 1 : 0;',
    '  j.__receipt_fault = fault;',
    '  j.__submission_key = receiptRequired ? key : \'\';',
    '  j.__correlation_id = receiptRequired ? correlationId : \'\';',
    '  out.push({ json: j });',
    '}',
    'return out;'
  ].join('\n'),
  'Receipt branch requires INTERNAL provenance + exact key + server correlation id. Public ' +
  'path bypasses the whole branch and reveals nothing about key existence.'));

add(ifNum('IF Receipt Fault', at('Dedup Guard', 220, 380),
  '={{ $json.__receipt_fault }}', 1,
  'F3 second gate. TRUE = trusted but receipt controls unusable -> fail closed, never public.'));

add(ifNum('IF Receipt Required', at('Dedup Guard', 440, 260),
  '={{ $json.__receipt_required }}', 1,
  'TRUE -> receipt critical section. FALSE -> public/ordinary path, receipt untouched.'));

add({
  parameters: {
    resource: 'row', operation: 'get', dataTableId: TABLE,
    matchType: 'allConditions',
    filters: { conditions: [{ keyName: 'submission_key', condition: 'eq', keyValue: '={{ $json.__submission_key }}' }] },
    returnAll: true
  },
  id: nid('read'), name: 'Receipt Exact Read', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
  position: at('Dedup Guard', 660, 180),
  alwaysOutputData: true,
  notes: 'Exact-key read. alwaysOutputData so an ABSENT receipt still reaches the verdict node ' +
    'instead of silently skipping the rest of the branch (P4 zero-item semantics).'
});

add(code('Receipt Read Verdict', at('Dedup Guard', 880, 180),
  [
    '// ABSENCE IS NEVER AN ANSWER: a current cycle is required to have a preallocated receipt,',
    '// so a missing row is a broken invariant, not permission to proceed.',
    "const gate = $('Receipt Gate').first().json;",
    "const key = String(gate.__submission_key || '');",
    'const rows = $input.all()',
    '  .map((i) => i.json)',
    "  .filter((r) => r && typeof r === 'object' && String(r.submission_key || '') !== '');",
    '',
    'let ok = 0;',
    "let reason = 'RECEIPT_ABSENT_INVARIANT_BROKEN';",
    'if (rows.length === 1 && String(rows[0].submission_key) === key) {',
    "  const state = String(rows[0].commit_state || '').trim();",
    "  if (state === 'READY') { ok = 1; reason = 'READY'; }",
    "  else { ok = 0; reason = 'RECEIPT_NOT_READY_' + (state || 'EMPTY'); }",
    '} else if (rows.length > 1) {',
    "  reason = 'DUPLICATE_RECEIPTS';",
    '} else if (rows.length === 1) {',
    "  reason = 'LOOKUP_CONTRACT_VIOLATION';",
    '}',
    '',
    'return [{ json: Object.assign({}, gate, { __receipt_read_ok: ok, __receipt_reason: reason }) }];'
  ].join('\n'),
  'Absence resolves to a broken invariant, never to "safe to proceed".'));

add(ifNum('IF Receipt Claimable', at('Dedup Guard', 1100, 180),
  '={{ $json.__receipt_read_ok }}', 1,
  'Only a single READY row for the exact key may proceed.'));

// F6 — retry is settled directly and never claimed.
add(ifNum('IF Receipt Is Retry', at('Dedup Guard', 1320, 180),
  "={{ $('Dedup Guard').first().json.dedup_is_retry ? 1 : 0 }}", 1,
  'F6. TRUE = dedup already resolved this to an existing Pipeline row and NO write will ' +
  'occur, so the receipt is settled READY -> COMMITTED directly. No IN_FLIGHT window is ' +
  'created for a submission that provably writes nothing.'));

// F5 — the canonical lead id for the retry branch is the DEDUP-SELECTED existing lead, which
// is exactly what Respond Retry returns. Normalize + Score Lead.lead_id is the NEW
// submission's provisional server-minted id and would name a row that exists nowhere.
const RETRY_LEAD = "$('Dedup Guard').first().json.merge_lead_id || $('Dedup Guard').first().json.lead_id";
const RETRY_PRIORITY = "$('Dedup Guard').first().json.lead_priority";
const RETRY_ZONE = "$('Dedup Guard').first().json.financial_zone";

add({
  parameters: {
    resource: 'row', operation: 'update', dataTableId: TABLE,
    matchType: 'allConditions',
    filters: {
      conditions: [
        { keyName: 'submission_key', condition: 'eq', keyValue: "={{ $('Receipt Gate').first().json.__submission_key }}" },
        { keyName: 'commit_state', condition: 'eq', keyValue: 'READY' }
      ]
    },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        commit_state: 'COMMITTED',
        canonical_lead_id: '={{ ' + RETRY_LEAD + ' }}',
        lead_mode: 'retry',
        lead_priority: '={{ ' + RETRY_PRIORITY + ' }}',
        financial_zone: '={{ ' + RETRY_ZONE + ' }}',
        settled_at: '={{ $now.toISO() }}',
        correlation_id: "={{ $('Receipt Gate').first().json.__correlation_id }}"
      },
      schema: ['commit_state', 'canonical_lead_id', 'lead_mode', 'lead_priority', 'financial_zone', 'settled_at', 'correlation_id']
        .map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }))
    }
  },
  id: nid('retry-settle'), name: 'Receipt Retry Settlement',
  type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
  position: at('Dedup Guard', 1540, 60),
  alwaysOutputData: true,
  notes: 'F6 READY -> COMMITTED in one CAS. No Pipeline write occurs on this branch, so there ' +
    'is no ambiguous window to protect and no IN_FLIGHT state is created. canonical_lead_id ' +
    'is the DEDUP-SELECTED existing lead, matching Respond Retry exactly.'
});

add(code('Retry Settlement Verdict', at('Dedup Guard', 1760, 60),
  [
    '// Same zero-item discriminator as the claim. alwaysOutputData means a zero-match arrives',
    '// as a synthetic EMPTY item, which must read as ZERO rows and never as success.',
    "const gate = $('Receipt Gate').first().json;",
    "const key = String(gate.__submission_key || '');",
    'const items = $input.all();',
    'let updated = 0;',
    'if (items.length === 1) {',
    '  const row = (items[0] && items[0].json) || {};',
    "  const stored = String(row.submission_key || '').trim();",
    "  updated = (stored !== '' && stored === key) ? 1 : 0;",
    '} else if (items.length > 1) {',
    '  updated = items.length;',
    '}',
    'return [{ json: Object.assign({}, gate, {',
    '  __retry_updated_rows: updated,',
    '  __retry_settled: updated === 1 ? 1 : 0',
    '}) }];'
  ].join('\n'),
  'F6. A lost settlement CAS fails closed; it never reports ordinary success.'));

add(ifNum('IF Retry Settled', at('Dedup Guard', 1980, 60),
  '={{ $json.__retry_updated_rows }}', 1,
  'Only exactly one settled row permits the retry success return.'));

add(internalResult('Internal Result (Retry)', at('Dedup Guard', 2200, 60),
  RESULT_OK('String(' + RETRY_LEAD + ")", 'retry', 'String(' + RETRY_PRIORITY + ')', 'String(' + RETRY_ZONE + ')'),
  'F4/F5 terminal. Returns the SAME canonical lead id that the public Respond Retry returns.'));

// The claim, for the new and merge branches only.
add({
  parameters: {
    resource: 'row', operation: 'update', dataTableId: TABLE,
    matchType: 'allConditions',
    filters: {
      conditions: [
        { keyName: 'submission_key', condition: 'eq', keyValue: "={{ $('Receipt Gate').first().json.__submission_key }}" },
        { keyName: 'commit_state', condition: 'eq', keyValue: 'READY' }
      ]
    },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        commit_state: 'IN_FLIGHT',
        claimed_at: '={{ $now.toISO() }}',
        correlation_id: "={{ $('Receipt Gate').first().json.__correlation_id }}"
      },
      schema: ['commit_state', 'claimed_at', 'correlation_id'].map((c) => ({
        id: c, displayName: c, required: false, defaultMatch: false, display: true,
        type: 'string', canBeUsedToMatch: true
      }))
    }
  },
  id: nid('claim'), name: 'Receipt Claim', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
  position: at('Dedup Guard', 1540, 300),
  alwaysOutputData: true,
  notes: 'READY -> IN_FLIGHT CAS for the write-bearing branches. alwaysOutputData:true is ' +
    'LOAD-BEARING: P4 proved a zero-match returns main[0]===[] and skips every downstream ' +
    'node, so without it the fail-closed branch could never run. Sets correlation_id (P1-L9).'
});

add(code('Claim Verdict', at('Dedup Guard', 1760, 300),
  [
    '// The zero-item discriminator. Returns { updated_rows } and NEVER throws.',
    '//',
    '// Under alwaysOutputData:true n8n substitutes a single EMPTY item {} when the update',
    '// matched nothing. That synthetic item is the trap: a truthy test or a field read in a',
    '// try/catch would turn it into a fake success. So the discriminator keys on a field a',
    '// genuinely updated row ALWAYS carries — the node returns the full post-update row — and',
    '// an empty item NEVER does.',
    "const gate = $('Receipt Gate').first().json;",
    "const key = String(gate.__submission_key || '');",
    'const items = $input.all();',
    '',
    'let updated = 0;',
    "let reason = 'STATE_ALREADY_MOVED';",
    'if (items.length > 1) {',
    '  updated = items.length;',
    "  reason = 'MULTIPLE_ROWS_AFFECTED';",
    '} else if (items.length === 1) {',
    '  const row = (items[0] && items[0].json) || {};',
    "  const stored = String(row.submission_key || '').trim();",
    "  if (stored === '') { updated = 0; reason = 'STATE_ALREADY_MOVED'; }",
    "  else if (stored !== key) { updated = 0; reason = 'UPDATE_TOUCHED_WRONG_KEY'; }",
    "  else { updated = 1; reason = 'EXACTLY_ONE_ROW'; }",
    '}',
    '',
    '// updated_rows === 1 is the ONLY value that permits the Pipeline path.',
    'return [{ json: Object.assign({}, gate, {',
    '  __updated_rows: updated,',
    '  __claim_ok: updated === 1 ? 1 : 0,',
    '  __claim_reason: reason',
    '}) }];'
  ].join('\n'),
  'Converts item presence into an explicit count. The synthetic empty item is ZERO, never success.'));

add(ifNum('IF Claim Won', at('Dedup Guard', 1980, 300),
  '={{ $json.__updated_rows }}', 1,
  'THE gate. Only updated_rows === 1 reaches Pipeline. 0, >1 and unreadable all fail closed.'));

add(internalResult('Internal Result (Unresolved)', at('Dedup Guard', 2200, 460),
  RESULT_FAIL("'SUBMIT_UNRESOLVED'", true),
  'F4 terminal. Reached when a receipt read, claim, settlement or commit CAS did not return ' +
  'exactly one row. NO Pipeline node is reachable from here. Not a RespondToWebhook: the ' +
  'internal path must never depend on one.'));

// ---------------------------------------------------------------- commit chains

function commitChain(tag, leadExpr, modeLiteral, priorityExpr, zoneExpr, anchor, dx, dy) {
  const gate = ifNum('IF Internal (' + tag + ')', at(anchor, dx, dy),
    "={{ $('Receipt Gate').first().json.__internal }}", 1,
    'F4/§6. TRUE = internal: settle the receipt and return the internal contract. FALSE = ' +
    'public: respond through the existing webhook node, receipt table untouched.');

  const commit = {
    parameters: {
      resource: 'row', operation: 'update', dataTableId: TABLE,
      matchType: 'allConditions',
      filters: {
        conditions: [
          { keyName: 'submission_key', condition: 'eq', keyValue: "={{ $('Receipt Gate').first().json.__submission_key }}" },
          { keyName: 'commit_state', condition: 'eq', keyValue: 'IN_FLIGHT' }
        ]
      },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          commit_state: 'COMMITTED',
          canonical_lead_id: '={{ ' + leadExpr + ' }}',
          lead_mode: modeLiteral,
          lead_priority: '={{ ' + priorityExpr + ' }}',
          financial_zone: '={{ ' + zoneExpr + ' }}',
          settled_at: '={{ $now.toISO() }}'
        },
        schema: ['commit_state', 'canonical_lead_id', 'lead_mode', 'lead_priority', 'financial_zone', 'settled_at']
          .map((c) => ({ id: c, displayName: c, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }))
      }
    },
    id: nid('commit'), name: 'Receipt Commit (' + tag + ')',
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: at(anchor, dx + 220, dy),
    alwaysOutputData: true,
    notes: 'IN_FLIGHT -> COMMITTED CAS. correlation_id is NOT in the set: it was written by ' +
      'the winning claim and is immutable (P1-L9). canonical_lead_id matches the public ' +
      'response for this branch exactly.'
  };

  const verdict = code('Commit Verdict (' + tag + ')', at(anchor, dx + 440, dy),
    [
      '// Same zero-item discriminator as the claim. A commit that affected zero rows means the',
      '// receipt is no longer IN_FLIGHT — so the Pipeline write happened but the ledger did not',
      '// record it. That is UNRESOLVED, never an ordinary success.',
      "const gate = $('Receipt Gate').first().json;",
      "const key = String(gate.__submission_key || '');",
      'const items = $input.all();',
      'let updated = 0;',
      'if (items.length === 1) {',
      '  const row = (items[0] && items[0].json) || {};',
      "  const stored = String(row.submission_key || '').trim();",
      "  updated = (stored !== '' && stored === key) ? 1 : 0;",
      '} else if (items.length > 1) {',
      '  updated = items.length;',
      '}',
      'return [{ json: Object.assign({}, gate, {',
      '  __commit_updated_rows: updated,',
      '  __commit_ok: updated === 1 ? 1 : 0',
      '}) }];'
    ].join('\n'),
    'Pipeline succeeded but commit CAS !== 1 must NOT report ordinary success.');

  const committed = ifNum('IF Committed (' + tag + ')', at(anchor, dx + 660, dy),
    '={{ $json.__commit_updated_rows }}', 1,
    'Only exactly one committed row permits the success return.');

  const result = internalResult('Internal Result (' + tag + ')', at(anchor, dx + 880, dy),
    RESULT_OK('String(' + leadExpr + ')', modeLiteral, 'String(' + priorityExpr + ')', 'String(' + zoneExpr + ')'),
    'F4/F5 terminal. Returns the SAME canonical values the public response for this branch returns.');

  [gate, commit, verdict, committed, result].forEach(add);
  return { gate, commit, verdict, committed, result };
}

// F5 — sources read off the LIVE responder expressions, not guessed:
//   Respond New Lead : $('Dedup Guard').lead_id                  mode 'new'
//   Respond Merged   : $('Build Merge Update').lead_id           mode 'merged'
commitChain('New', "$('Dedup Guard').first().json.lead_id", 'new',
  "$('Dedup Guard').first().json.lead_priority", "$('Dedup Guard').first().json.financial_zone",
  'Save to Pipeline', 0, 320);

commitChain('Merge', "$('Build Merge Update').first().json.lead_id", 'merged',
  "$('Build Merge Update').first().json.priority", "$('Build Merge Update').first().json.financial_zone",
  'Update Pipeline (Merge)', 0, 320);

// ---------------------------------------------------------------- simple terminal gates

// F11 — the internal-ness flag is read BY NODE REFERENCE, never off $json.
//
// Three of these four gates are fed EXCLUSIVELY from an n8n ERROR OUTPUT (Read Settings,
// Read Pipeline (Dedup), Save to Pipeline, Update Pipeline (Merge)). An error output does not
// carry the failing node's INPUT json -- it emits an error item. So `$json.__internal` was
// `undefined`, `undefined === 1` is false, and every internal failure took the FALSE branch:
// the PUBLIC branch, into a RespondToWebhook that has nothing to respond to inside a
// sub-workflow, and then into a Stop node that THROWS at the internal caller.
//
// The consequence was that Internal Result (Infra), (PipelineFailed) and (MergeFailed) were
// UNREACHABLE -- three declared terminals of the internal contract that could never fire --
// and the internal caller received a raw thrown error instead of the structured
// { ok: false, error_code, retryable } this route promises. Observed live in P6.3 (driver
// exec 3585, case F): a valid lead cleared Validate Payload, the CRM read was genuinely
// unavailable, and the run terminated at Stop: CRM Unavailable on the public branch.
//
// `Internal Flag` is the single authority on internal-ness -- that is what it exists for --
// and it runs on BOTH routes before all four of these gates:
//
//   public  : Webhook -> Validate Payload -> Internal Flag -> IF Valid -> ...
//   internal: Internal Subworkflow Trigger -> Internal Auth Entry -> ... -> Internal Flag -> ...
//
// so the reference can never throw. The success-path gates already read their flag by node
// reference (`$('Receipt Gate')`); this makes the failure paths hold to the same rule, which
// is the rule that survives an error output.
const INTERNAL_FLAG_EXPR = "={{ $('Internal Flag').first().json.__internal }}";

function terminalGate(tag, anchor, dx, dy, errorCodeExpr, retryable) {
  const gate = ifNum('IF Internal (' + tag + ')', at(anchor, dx, dy),
    INTERNAL_FLAG_EXPR, 1,
    'F4/F11. TRUE = internal: return the internal contract. FALSE = public: existing webhook ' +
    'response. The flag is read by node reference so it survives an error-output feed.');
  const result = internalResult('Internal Result (' + tag + ')', at(anchor, dx + 220, dy),
    RESULT_FAIL(errorCodeExpr, retryable),
    'F4 terminal for the internal path. Never a RespondToWebhook.');
  [gate, result].forEach(add);
  return { gate, result };
}

// Respond Retry needs a gate too, and it is NOT dead code.
//
// At runtime an internal non-retry cannot reach it: IF Receipt Is Retry and IF Is Retry read
// the SAME $('Dedup Guard').dedup_is_retry, so if the first said "not a retry" the second says
// the same. But that is a runtime argument resting on two nodes agreeing, and the F4 invariant
// — the internal path never reaches a RespondToWebhook — should hold STRUCTURALLY, not because
// two conditions happen to match. If they ever diverge, this gate is what stops an internal
// call from terminating at a webhook responder that may do nothing inside a sub-workflow.
add(ifNum('IF Internal (Retry)', at('Respond Retry', -220, 200),
  "={{ $('Receipt Gate').first().json.__internal }}", 1,
  'F4 structural guarantee. Internal retries are normally diverted at IF Receipt Is Retry; ' +
  'this catches any internal call that still reaches the ordinary retry edge.'));

terminalGate('Invalid', 'Respond Invalid', -220, 200, "String($json.error_code || 'INVALID_PAYLOAD')", false);
terminalGate('Infra', 'Respond Infra Failed', -220, 200, "'CRM_UNAVAILABLE'", true);
terminalGate('PipelineFailed', 'Respond Pipeline Failed', -220, 200, "'PIPELINE_WRITE_FAILED'", true);
terminalGate('MergeFailed', 'Respond Merge Failed', -220, 200, "'PIPELINE_MERGE_FAILED'", true);

// ---------------------------------------------------------------- rewire

const c = wf.connections;
const main = (targets) => ({
  main: targets.map((t) => (Array.isArray(t) ? t : [t]).map((n) => ({ node: n, type: 'main', index: 0 })))
});

// Entry.
c['Internal Subworkflow Trigger'] = main([['Internal Auth Entry']]);
c['Internal Auth Entry'] = main([['IF Internal Fault']]);
c['IF Internal Fault'] = main([['Internal Result (Fault)'], ['Internal Envelope Unwrap']]);
c['Internal Envelope Unwrap'] = main([['Validate Payload']]);

// Shared validation. Internal Flag sits between Validate Payload and IF Valid so every
// terminal downstream can answer "internal?" without touching a node that may not have run.
c['Validate Payload'] = main([['Internal Flag']]);
c['Internal Flag'] = main([['IF Valid']]);
c['IF Valid'] = main([['Read Settings'], ['IF Internal (Invalid)']]);
c['IF Internal (Invalid)'] = main([['Internal Result (Invalid)'], ['Respond Invalid']]);

// Infra failures from both readers converge on one gate.
c['Read Settings'] = { main: [
  [{ node: 'Settings to Object', type: 'main', index: 0 }],
  [{ node: 'IF Internal (Infra)', type: 'main', index: 0 }]
] };
c['IF Internal (Infra)'] = main([['Internal Result (Infra)'], ['Respond Infra Failed']]);

// Correlation equality, between normalisation and the dedup read.
c['Normalize + Score Lead'] = main([['Correlation Guard']]);
c['Correlation Guard'] = main([['IF Correlation OK']]);
c['IF Correlation OK'] = main([['Read Pipeline (Dedup)'], ['Internal Result (Correlation)']]);
c['Read Pipeline (Dedup)'] = { main: [
  [{ node: 'Dedup Guard', type: 'main', index: 0 }],
  [{ node: 'IF Internal (Infra)', type: 'main', index: 0 }]
] };

// Receipt branch.
c['Dedup Guard'] = main([['Receipt Gate']]);
c['Receipt Gate'] = main([['IF Receipt Fault']]);
c['IF Receipt Fault'] = main([['Internal Result (Unresolved)'], ['IF Receipt Required']]);
c['IF Receipt Required'] = main([['Receipt Exact Read'], ['IF Is New']]);
c['Receipt Exact Read'] = main([['Receipt Read Verdict']]);
c['Receipt Read Verdict'] = main([['IF Receipt Claimable']]);
c['IF Receipt Claimable'] = main([['IF Receipt Is Retry'], ['Internal Result (Unresolved)']]);

// F6 retry: settle directly, never claim.
c['IF Receipt Is Retry'] = main([['Receipt Retry Settlement'], ['Receipt Claim']]);
c['Receipt Retry Settlement'] = main([['Retry Settlement Verdict']]);
c['Retry Settlement Verdict'] = main([['IF Retry Settled']]);
c['IF Retry Settled'] = main([['Internal Result (Retry)'], ['Internal Result (Unresolved)']]);

// Write-bearing branches: claim, then rejoin the ordinary flow.
c['Receipt Claim'] = main([['Claim Verdict']]);
c['Claim Verdict'] = main([['IF Claim Won']]);
c['IF Claim Won'] = main([['IF Is New'], ['Internal Result (Unresolved)']]);

// New.
c['Save to Pipeline'] = { main: [
  [{ node: 'IF Internal (New)', type: 'main', index: 0 }],
  [{ node: 'IF Internal (PipelineFailed)', type: 'main', index: 0 }]
] };
c['IF Internal (New)'] = main([['Receipt Commit (New)'], ['Respond New Lead']]);
c['Receipt Commit (New)'] = main([['Commit Verdict (New)']]);
c['Commit Verdict (New)'] = main([['IF Committed (New)']]);
c['IF Committed (New)'] = main([['Internal Result (New)'], ['Internal Result (Unresolved)']]);
c['IF Internal (PipelineFailed)'] = main([['Internal Result (PipelineFailed)'], ['Respond Pipeline Failed']]);

// Merge.
c['Update Pipeline (Merge)'] = { main: [
  [{ node: 'IF Internal (Merge)', type: 'main', index: 0 }],
  [{ node: 'IF Internal (MergeFailed)', type: 'main', index: 0 }]
] };
c['IF Internal (Merge)'] = main([['Receipt Commit (Merge)'], ['Respond Merged']]);
c['Receipt Commit (Merge)'] = main([['Commit Verdict (Merge)']]);
c['Commit Verdict (Merge)'] = main([['IF Committed (Merge)']]);
c['IF Committed (Merge)'] = main([['Internal Result (Merge)'], ['Internal Result (Unresolved)']]);
c['IF Internal (MergeFailed)'] = main([['Internal Result (MergeFailed)'], ['Respond Merge Failed']]);

// The ordinary retry edge is gated so the F4 invariant holds structurally rather than by two
// conditions agreeing. An internal call that somehow reaches here lands on the internal retry
// result, which returns the SAME canonical lead id Respond Retry would have returned.
c['IF Is Retry'] = main([['IF Internal (Retry)'], ['Build Merge Update']]);
c['IF Internal (Retry)'] = main([['Internal Result (Retry)'], ['Respond Retry']]);

wf.nodes.push(...NEW_NODES);

wf.name = 'FINMENTOR Lead Intake B21C RECEIPT CANDIDATE';
wf.meta = Object.assign({}, wf.meta, {
  finmentor_candidate: 'B.2.1-C P5.1 MODEL B receipt critical section',
  finmentor_source_export: 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json',
  finmentor_generated_by: 'scripts/build-lead-intake-receipt-candidate.mjs',
  finmentor_not_deployed: true
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n', 'utf8');

console.log('candidate written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  nodes: ' + wf.nodes.length + ' (was ' + (wf.nodes.length - NEW_NODES.length) + ', +' + NEW_NODES.length + ')');
