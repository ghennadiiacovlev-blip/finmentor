#!/usr/bin/env node
// FINMENTOR — Lead Intake CANONICAL REQUEST IDENTITY candidate.
//
//   node scripts/build-lead-intake-request-identity.mjs [--live <live-export.json>]
//
// REPO-ONLY. Emits n8n/candidate/lead-intake-request-identity-candidate.json and never contacts
// n8n. It is a CANDIDATE, not a deployment. Nothing here applies DDL, touches lead_id, changes
// the Pipeline schema or backfills a row.
//
// WHAT IT CHANGES — four node bodies and one connection:
//
//   Validate Payload        + the canonical identity module, + a shape gate that REFUSES a
//                             missing, malformed or route-crossing identity through the refusal
//                             path that already exists (IF Valid -> IF Internal (Invalid) ->
//                             Respond Invalid / Internal Result (Invalid)). A malformed identity
//                             IS a malformed request, so 400 is the right code and no new
//                             responder is needed for it.
//   Normalize + Score Lead    the request_id read loses its second source. `Validate Payload`
//                             has already canonicalised `payload.meta.request_id`, and a second
//                             accepted location is a second identity.
//   Dedup Guard             + the IDEMPOTENCY_CONFLICT rule. Corroboration is UNTOUCHED: an
//                             identity still cannot select a row on its own.
//   Build Merge Update      - `upd.request_id = advance(...)`. A merge advances the lead, never
//                             the identity of the request that created it.
//
// AND FOUR NEW NODES, the dedicated terminal conflict response (owner decision):
//
//   Identity Conflict?          IF on dedup_mode === 'conflict', between Dedup Guard and the
//                               receipt critical section
//   IF Internal (Conflict)      the same internal/public split every other terminal state uses
//   Internal Result (Conflict)  the F4 internal return contract, failure form
//   Respond Identity Conflict   HTTP 409, error_code IDEMPOTENCY_CONFLICT, retryable false
//
// WHY 409 AND NOT THE EXISTING 400. A conflict is not a malformed request: the caller's identity
// and payload are both well formed, and the refusal is about STATE — this identity is already
// settled against different content. Routing it through `Respond Invalid` would have cost zero
// new nodes and would have been wrong in the one place it matters: a client cannot distinguish
// "your request was malformed, fix and resend" from "this identity is spent, start a new
// submission" by reading a 400, and those two demand opposite client behaviour.
//
// WHY IT PATCHES A LIVE EXPORT RATHER THAN GENERATING A WORKFLOW. `FINMENTOR Lead Intake PREMIUM
// FINAL` has 102 nodes and is CLOSED at GO. Regenerating it from a builder would put every one of
// those nodes at risk for the sake of four bodies. So this reads the export, applies a narrow
// delta, and asserts — on the OUTPUT, not on intent — that nothing else moved.
//
// EVERY REPLACE USES A REPLACER FUNCTION. `String.prototype.replace` performs `$`-substitution on
// a string replacement, and a `$&` inside spliced node source once spliced a file into itself in
// this repository. A function replacement disables that substitution entirely.
//
// SOURCES ARE READ CRLF-NORMALISED. `core.autocrlf` is true on the owner's machine, so a
// checkout rewrites every tracked source to CRLF. A byte-exact splice that did not normalise
// would produce a different candidate after a stash round-trip and fail its own gate as a stale
// builder.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'n8n', 'src', 'lead-intake', 'identity-candidate');
const OUT = join(ROOT, 'n8n', 'candidate', 'lead-intake-request-identity-candidate.json');
const DEFAULT_LIVE = join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');

export const VALIDATE_NODE = 'Validate Payload';
export const NORMALIZE_NODE = 'Normalize + Score Lead';
export const DEDUP_NODE = 'Dedup Guard';
export const MERGE_NODE = 'Build Merge Update';
export const CONFLICT_NODE = 'Identity Conflict?';
export const CONFLICT_SPLIT_NODE = 'IF Internal (Conflict)';
export const CONFLICT_INTERNAL_NODE = 'Internal Result (Conflict)';
export const CONFLICT_RESPONDER_NODE = 'Respond Identity Conflict';
export const RECEIPT_NODE = 'Receipt Gate';
export const INTERNAL_FLAG_NODE = 'Internal Flag';
export const TOUCHED_NODES = [VALIDATE_NODE, NORMALIZE_NODE, DEDUP_NODE, MERGE_NODE];
export const ADDED_NODES = [CONFLICT_NODE, CONFLICT_SPLIT_NODE, CONFLICT_INTERNAL_NODE, CONFLICT_RESPONDER_NODE];

// The terminal conflict body, written once and used by both the public responder and the internal
// return contract so the two cannot drift.
export const CONFLICT_BODY = { ok: false, error_code: 'IDEMPOTENCY_CONFLICT', retryable: false };

export const readSource = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const IDENTITY_MODULE = readSource(join(SRC, 'request-identity.js')).replace(/\n+$/, '\n');

// ---------------------------------------------------------------- the four transforms

// Every anchor must match EXACTLY ONCE. A silent zero-match splice is how a "deployed" fix turns
// out never to have been applied; a double match is how one gets applied twice.
function spliceOnce(source, anchor, build, label) {
  const parts = source.split(anchor);
  if (parts.length !== 2) {
    throw new Error(label + ': anchor matched ' + (parts.length - 1) + ' times, expected exactly 1');
  }
  return build(parts[0], parts[1]);
}

export function transformValidate(source) {
  // 1. the module, immediately before the first statement of the node
  const withModule = spliceOnce(source, '\nconst raw = $input.first().json || {};',
    (head, tail) => head + '\n' + IDENTITY_MODULE + '\nconst raw = $input.first().json || {};' + tail,
    VALIDATE_NODE + '/module');

  // 2. the gate, immediately before the success return
  const GATE = [
    '',
    '// ---- CANONICAL REQUEST IDENTITY GATE (candidate) ----',
    '//',
    '// The NEW-event identity is proven HERE, in the node that already owns structural refusal,',
    '// so a refusal reuses the path that exists: IF Valid -> IF Internal (Invalid) -> Respond',
    '// Invalid (400, error_code in the body) or Internal Result (Invalid). No new responder, no',
    '// second refusal contract, no race between two respondToWebhook nodes.',
    '//',
    '// This is the same shape of check the node already performs on `lead_id` two lines above:',
    '// validate, canonicalise, write back. The difference is that a bad identity is REFUSED',
    '// rather than blanked, because a blank identity is what made the column meaningless.',
    '//',
    '// Provenance comes from the GRAPH, never from the body. `Internal Auth Entry` is reachable',
    '// only from the internal sub-workflow trigger, so on the public path `$()` throws and the',
    '// request is canonicalised as public. A caller cannot assert the internal route in order to',
    '// present an internal identity.',
    'function __internalRouteProven() {',
    "  try { return $('Internal Auth Entry').first().json.__internal_route === true; }",
    '  catch (e) { return false; }',
    '}',
    'const __identityRaw = (payload.meta && typeof payload.meta === \'object\') ? payload.meta.request_id : undefined;',
    'const __identity = RI.canonicalise(__identityRaw, { internal: __internalRouteProven() });',
    'if (!__identity.ok) {',
    '  return fail(__identity.code, \'A canonical request identity is required on every submission\');',
    '}',
    '// From here the canonical spelling is the ONLY one in the payload. Everything downstream —',
    '// Normalize, Dedup Guard, the Pipeline row, Correlation Guard — reads this one value.',
    'if (!payload.meta || typeof payload.meta !== \'object\') { payload.meta = {}; }',
    'payload.meta.request_id = __identity.id;',
    'delete payload.request_id;',
    ''
  ].join('\n');

  return spliceOnce(withModule, '\nreturn [{ json: { valid: true,',
    (head, tail) => head + '\n' + GATE + '\nreturn [{ json: { valid: true,' + tail,
    VALIDATE_NODE + '/gate');
}

export function transformNormalize(source) {
  const OLD = "const requestId = String(meta.request_id ?? incoming.request_id ?? '').trim().slice(0, 80);";
  const NEW = [
    '// CANDIDATE — one canonical location, already proven.',
    '//',
    '// `Validate Payload` canonicalises `payload.meta.request_id` and REFUSES the request when it',
    '// cannot, so by the time this node runs the value is non-empty and in canonical form. The',
    '// `incoming.request_id` fallback is gone: no producer has ever used the top-level spelling,',
    '// and a second accepted location is a second identity. The 80-character clamp is gone too —',
    '// it is enforced by the canonicaliser, and clamping here could only ever corrupt a value the',
    '// gate had already accepted.',
    "const requestId = String(meta.request_id ?? '').trim();"
  ].join('\n');
  return spliceOnce(source, OLD, (head, tail) => head + NEW + tail, NORMALIZE_NODE + '/requestId');
}

export function transformDedup(source) {
  const withModule = spliceOnce(source, "\nconst lead = $('Normalize + Score Lead').first().json;",
    (head, tail) => head + '\n' + IDENTITY_MODULE + "\nconst lead = $('Normalize + Score Lead').first().json;" + tail,
    DEDUP_NODE + '/module');

  const RULE = [
    '',
    '// ---- IDEMPOTENCY CONFLICT: one identity may not cover two submissions (candidate) ----',
    '//',
    '// Evaluated BEFORE tiering, and it is the only rule in this node that can refuse.',
    '//',
    '// The corroboration rule below is UNTOUCHED. A matching request_id is still honoured only',
    '// when a server-derived contact identity reaches the same row, which is what stops an',
    '// identity being a row-selection capability (INDP1-02). But corroboration also means a',
    '// request that reuses somebody else\'s identity with DIFFERENT contact data simply falls',
    '// through to contact matching and lands as a SECOND Pipeline row carrying the SAME',
    '// request_id. Measured, not assumed: qa/lead-intake-request-identity.test.mjs case E-2 runs',
    '// the deployed node and produces exactly that. It is the one state a',
    '// `dispatch_key = \'NEW_LEAD:\' || request_id` outbox cannot survive — two settled NEW leads,',
    '// one key, the second alert silently swallowed by ON CONFLICT DO NOTHING.',
    '//',
    '// So every existing row carrying this identity is compared on CONTENT, and a material',
    '// difference fails closed. It does not create a second lead, it does not overwrite the first,',
    '// and it does not accept the second request as the first.',
    '//',
    '// The response message is deliberately generic. Naming the differing columns to a caller who',
    '// had to present a valid identity to get here would be a small oracle, and the field list is',
    '// carried on the item for the operator instead.',
    'const __identityRows = rows.filter(r => String(r.request_id || \'\').trim() !== \'\'',
    '  && String(r.request_id || \'\').trim() === String(lead.request_id || \'\').trim());',
    'let __conflictFields = [];',
    'if (String(lead.request_id || \'\').trim() !== \'\' && __identityRows.length) {',
    '  for (const r of __identityRows) {',
    '    const diff = RI.conflictFields(r, lead);',
    '    if (diff.length) { __conflictFields = diff; break; }',
    '  }',
    '}',
    'if (__conflictFields.length) {',
    '  return [{ json: {',
    '    ...lead,',
    '    valid: false,',
    '    dedup_mode: \'conflict\',',
    '    error_code: \'IDEMPOTENCY_CONFLICT\',',
    '    error_message: \'this request identity is already settled with different submission content\',',
    '    identity_conflict_fields: __conflictFields.join(\', \'),',
    '    identity_conflict_lead_id: String((__identityRows[0] || {}).lead_id || \'\'),',
    '    existing_lead_id: \'\',',
    '    merge_lead_id: \'\',',
    '    existing_row: {}',
    '  } }];',
    '}',
    ''
  ].join('\n');

  return spliceOnce(withModule, '\n// Idempotency tier — CORROBORATED, never standalone.',
    (head, tail) => head + '\n' + RULE + '\n// Idempotency tier — CORROBORATED, never standalone.' + tail,
    DEDUP_NODE + '/conflict');
}

export function transformMerge(source) {
  const OLD = 'upd.request_id = advance(ex.request_id, item.request_id);';
  const NEW = [
    '// request_id is NOT written here, and its absence is the point.',
    '//',
    '// `Update Pipeline (Merge)` maps with autoMapInputData, so a key that is not on this object',
    '// is a column the update does not touch. That is strict immutability by omission: no merge',
    '// can replace, clear, advance or overwrite the identity of the request that created the lead.',
    '//',
    '// `advance()` used to run here, and it did all four. A genuine later submission on the same',
    '// contact carries its own new identity, and advancing rotated the row onto it — which would',
    '// have handed a NEW_LEAD reconciler an identity the original alert was never keyed on, and',
    '// so a duplicate alert for a lead already announced.',
    '//',
    '// `keepFirst()` was the tempting alternative — fill a blank, never overwrite. It is rejected',
    '// deliberately: the five legacy rows with no identity would acquire one from an unrelated',
    '// later merge, and a reconciler would then mint a NEW_LEAD intent for a lead settled days',
    '// earlier. A blank legacy row must stay blank and report LEGACY_IDENTITY_MISSING.',
    '//',
    '// The incoming request carries its own correlation identity. It belongs to the request, and',
    '// the merge note below already records that the request happened.'
  ].join('\n');
  return spliceOnce(source, OLD, (head, tail) => head + NEW + tail, MERGE_NODE + '/immutability');
}

// ---------------------------------------------------------------- the graph delta

// A resource locator in a live export carries `cachedResultUrl` — the production spreadsheet URL —
// and `cachedResultName`. They are display caches n8n rebuilds on open; `value` is the reference.
// A tracked artifact must not carry them.
export function sanitize(value) {
  if (!value || typeof value !== 'object') { return value; }
  if (Array.isArray(value)) { return value.map(sanitize); }
  const out = {};
  for (const k of Object.keys(value)) {
    if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; }
    out[k] = sanitize(value[k]);
  }
  return out;
}

// The four new nodes. Shapes are copied from the terminal states that already exist —
// `IF Internal (Infra)` for the split, `Internal Result (Infra)` for the internal return and
// `Respond Infra Failed` for the responder — so the conflict path is the same machine as every
// other terminal state rather than a new one that merely resembles it.
//
// Positioned below Dedup Guard rather than on top of it. Cosmetic, but a candidate a human cannot
// read on the canvas is a candidate a human will not check.
export function conflictNodes(dedupNode) {
  const p = (dedupNode && Array.isArray(dedupNode.position)) ? dedupNode.position : [0, 0];
  const body = JSON.stringify(CONFLICT_BODY);

  return [
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'identity-conflict-cond',
            leftValue: '={{ String($json.dedup_mode) }}',
            rightValue: 'conflict',
            operator: { type: 'string', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      },
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [p[0] + 120, p[1] + 240],
      id: 'identity-conflict-if-0001',
      name: CONFLICT_NODE
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'identity-conflict-internal-cond',
            leftValue: "={{ $('" + INTERNAL_FLAG_NODE + "').first().json.__internal }}",
            rightValue: 1,
            operator: { type: 'number', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      },
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [p[0] + 340, p[1] + 240],
      id: 'identity-conflict-split-0001',
      name: CONFLICT_SPLIT_NODE
    },
    {
      parameters: {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: [
          '// F4 internal return contract, failure form. No stage, no detail, no submission_key.',
          '//',
          '// TERMINAL. `retryable: false` is the load-bearing field: the caller must not re-attempt',
          '// this submission under this identity, because the identity is already settled against',
          '// different content. A retry would loop against the same refusal forever.',
          'return [{ json: ' + body + ' }];'
        ].join('\n')
      },
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [p[0] + 560, p[1] + 320],
      id: 'identity-conflict-internal-0001',
      name: CONFLICT_INTERNAL_NODE
    },
    {
      parameters: {
        options: { responseCode: 409 },
        respondWith: 'json',
        // 409 CONFLICT, not 400. The request is well formed; the STATE refuses it. A client
        // cannot tell "fix and resend" from "this identity is spent" by reading a 400, and those
        // two demand opposite behaviour.
        //
        // The body names no column. Telling a caller which field differs is an oracle for someone
        // who had to present a valid identity to reach this response; the field list stays on the
        // item for the operator.
        responseBody: '={{ JSON.stringify(' + body + ') }}'
      },
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.5,
      position: [p[0] + 560, p[1] + 160],
      id: 'identity-conflict-respond-0001',
      name: CONFLICT_RESPONDER_NODE
    }
  ];
}

// `preserveCaches` is for the DEPLOY path only. A tracked artifact must never carry
// `cachedResultUrl` — it is the production spreadsheet URL — but the body PUT to the tenant must,
// because stripping the editor's display caches from a 102-node workflow is a change nobody asked
// for. So the candidate on disk is sanitised and the body sent to n8n is not.
export function build(live, opts) {
  const preserve = !!(opts && opts.preserveCaches);
  const cloned = JSON.parse(JSON.stringify(live.nodes));
  const nodes = preserve ? cloned : sanitize(cloned);
  const connections = JSON.parse(JSON.stringify(live.connections));

  const byName = (n) => nodes.find((x) => x.name === n);
  const apply = (name, fn) => {
    const node = byName(name);
    if (!node) { throw new Error('node absent from the live export: ' + name); }
    const before = String(node.parameters.jsCode || '').replace(/\r\n/g, '\n');
    const after = fn(before);
    if (after === before) { throw new Error(name + ': transform produced no change'); }
    node.parameters = { ...node.parameters, jsCode: after };
  };

  apply(VALIDATE_NODE, transformValidate);
  apply(NORMALIZE_NODE, transformNormalize);
  apply(DEDUP_NODE, transformDedup);
  apply(MERGE_NODE, transformMerge);

  // The one graph change. Dedup Guard's REGULAR output no longer goes straight into the receipt
  // critical section; it goes through the conflict split first.
  const dedupOut = connections[DEDUP_NODE];
  if (!dedupOut || !dedupOut.main || dedupOut.main.length !== 2) {
    throw new Error(DEDUP_NODE + ': expected exactly two outputs on the live export');
  }
  const regular = dedupOut.main[0] || [];
  if (regular.length !== 1 || regular[0].node !== RECEIPT_NODE) {
    throw new Error(DEDUP_NODE + ': output 0 is not the single ' + RECEIPT_NODE + ' connection');
  }
  for (const n of conflictNodes(byName(DEDUP_NODE))) { nodes.push(n); }
  connections[DEDUP_NODE].main[0] = [{ node: CONFLICT_NODE, type: 'main', index: 0 }];
  connections[CONFLICT_NODE] = {
    main: [
      // true  -> the terminal conflict, split by route like every other terminal state
      [{ node: CONFLICT_SPLIT_NODE, type: 'main', index: 0 }],
      // false -> everything else, unchanged
      [{ node: RECEIPT_NODE, type: 'main', index: 0 }]
    ]
  };
  connections[CONFLICT_SPLIT_NODE] = {
    main: [
      [{ node: CONFLICT_INTERNAL_NODE, type: 'main', index: 0 }],
      [{ node: CONFLICT_RESPONDER_NODE, type: 'main', index: 0 }]
    ]
  };

  // Only the four keys n8n needs to import a workflow. A live export also carries `id`, `active`
  // and an `activeVersion` blob; a tracked artifact carrying them is a hand-import that overwrites
  // production.
  return {
    name: '[CANDIDATE] ' + String(live.name || 'FINMENTOR Lead Intake') + ' — request identity',
    nodes,
    connections,
    settings: live.settings || {}
  };
}

// ---------------------------------------------------------------- invariants

// Asserted on the OUTPUT, not on intent. Every one of these failing means the delta is wrong and
// the file is not written.
export function verify(live, candidate) {
  const problems = [];
  const want = (cond, msg) => { if (!cond) { problems.push(msg); } };

  const liveNodes = sanitize(JSON.parse(JSON.stringify(live.nodes)));
  const liveBy = (n) => liveNodes.find((x) => x.name === n);
  const candBy = (n) => candidate.nodes.find((x) => x.name === n);

  want(candidate.nodes.length === liveNodes.length + ADDED_NODES.length,
    'node count moved by ' + (candidate.nodes.length - liveNodes.length)
      + ', expected +' + ADDED_NODES.length);
  for (const n of ADDED_NODES) { want(!!candBy(n), n + ' is absent from the candidate'); }

  // Every untouched node byte-identical.
  for (const n of liveNodes) {
    if (TOUCHED_NODES.includes(n.name)) { continue; }
    const c = candBy(n.name);
    want(!!c, 'node vanished from the candidate: ' + n.name);
    if (c) {
      want(JSON.stringify(c) === JSON.stringify(n), 'node changed but should not have: ' + n.name);
    }
  }

  // Every touched node changed in exactly one field: jsCode.
  for (const name of TOUCHED_NODES) {
    const a = liveBy(name);
    const b = candBy(name);
    want(!!a && !!b, 'touched node missing: ' + name);
    if (!a || !b) { continue; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (k === 'parameters') { continue; }
      want(JSON.stringify(a[k]) === JSON.stringify(b[k]), name + ': top-level key changed: ' + k);
    }
    const pk = new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)]);
    for (const k of pk) {
      if (k === 'jsCode') { continue; }
      want(JSON.stringify(a.parameters[k]) === JSON.stringify(b.parameters[k]),
        name + ': parameter changed besides jsCode: ' + k);
    }
    want(String(b.parameters.jsCode) !== String(a.parameters.jsCode), name + ': jsCode did not change');
  }

  // The identity module is present, once, in exactly the two nodes that need it.
  const marker = 'const RI = (function () {';
  for (const name of [VALIDATE_NODE, DEDUP_NODE]) {
    const js = String(candBy(name).parameters.jsCode);
    want(js.split(marker).length === 2, name + ': identity module is not present exactly once');
  }
  for (const name of [NORMALIZE_NODE, MERGE_NODE]) {
    want(!String(candBy(name).parameters.jsCode).includes(marker),
      name + ': identity module spliced into a node that does not need it');
  }

  // The two properties the whole change exists for.
  want(!String(candBy(MERGE_NODE).parameters.jsCode).includes('upd.request_id'),
    MERGE_NODE + ' still writes request_id');
  want(String(candBy(DEDUP_NODE).parameters.jsCode).includes('IDEMPOTENCY_CONFLICT'),
    DEDUP_NODE + ' has no conflict verdict');

  // Corroboration must survive intact. Loosening it would trade an idempotency defect for the
  // row-selection capability INDP1-02 removed.
  for (const probe of [
    "consider(corroborated, 'request_id+identity', 'strong')",
    'if (lead.provenance_trusted && lead.lead_id) consider('
  ]) {
    want(String(candBy(DEDUP_NODE).parameters.jsCode).includes(probe),
      DEDUP_NODE + ': corroboration rule was altered (' + probe.slice(0, 40) + ')');
  }

  // No node may gain `alwaysOutputData` beside `continueErrorOutput`. That pair is what made
  // Lead Intake reach a write on an outage (P9-R2 / P9-R4).
  for (const n of candidate.nodes) {
    want(!(n.alwaysOutputData === true && n.onError === 'continueErrorOutput'),
      n.name + ': alwaysOutputData beside continueErrorOutput');
  }

  // The terminal conflict response, exactly as the owner specified it.
  const responder = candBy(CONFLICT_RESPONDER_NODE);
  want(responder.type === 'n8n-nodes-base.respondToWebhook', CONFLICT_RESPONDER_NODE + ' is not a responder');
  want((responder.parameters.options || {}).responseCode === 409,
    CONFLICT_RESPONDER_NODE + ' does not answer 409');
  for (const probe of ['"ok":false', '"error_code":"IDEMPOTENCY_CONFLICT"', '"retryable":false']) {
    want(String(responder.parameters.responseBody).includes(probe),
      CONFLICT_RESPONDER_NODE + ' body is missing ' + probe);
  }
  // The body names no column, on either route: a field name is an oracle for a caller who had to
  // present a valid identity to reach this response.
  for (const node of [responder, candBy(CONFLICT_INTERNAL_NODE)]) {
    const text = JSON.stringify(node.parameters);
    want(!/conflict_fields|company|main_pain/.test(text), node.name + ' leaks a column name to the caller');
  }
  want(String(candBy(CONFLICT_INTERNAL_NODE).parameters.jsCode).includes('"retryable":false')
    || String(candBy(CONFLICT_INTERNAL_NODE).parameters.jsCode).includes('retryable": false'),
    CONFLICT_INTERNAL_NODE + ' does not return retryable:false');
  // Exactly one responder was added, and every pre-existing one is untouched.
  const respondersBefore = liveNodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').length;
  const respondersAfter = candidate.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').length;
  want(respondersAfter === respondersBefore + 1,
    'responder count moved by ' + (respondersAfter - respondersBefore) + ', expected +1');

  // The wiring.
  const cc = candidate.connections;
  want(cc[DEDUP_NODE].main[0].length === 1 && cc[DEDUP_NODE].main[0][0].node === CONFLICT_NODE,
    DEDUP_NODE + ' output 0 does not go to ' + CONFLICT_NODE);
  want(JSON.stringify(cc[DEDUP_NODE].main[1]) === JSON.stringify(live.connections[DEDUP_NODE].main[1]),
    DEDUP_NODE + ' error output moved');
  want(cc[CONFLICT_NODE].main[0][0].node === CONFLICT_SPLIT_NODE,
    CONFLICT_NODE + ' true branch does not reach ' + CONFLICT_SPLIT_NODE);
  want(cc[CONFLICT_NODE].main[1][0].node === RECEIPT_NODE,
    CONFLICT_NODE + ' false branch does not reach ' + RECEIPT_NODE);
  want(cc[CONFLICT_SPLIT_NODE].main[0][0].node === CONFLICT_INTERNAL_NODE,
    CONFLICT_SPLIT_NODE + ' internal branch is wrong');
  want(cc[CONFLICT_SPLIT_NODE].main[1][0].node === CONFLICT_RESPONDER_NODE,
    CONFLICT_SPLIT_NODE + ' public branch is wrong');
  // Terminal means terminal: neither conflict endpoint may lead anywhere.
  for (const n of [CONFLICT_INTERNAL_NODE, CONFLICT_RESPONDER_NODE]) {
    want(!cc[n], n + ' is not terminal — it has an outgoing connection');
  }

  // Every other connection identical.
  for (const k of Object.keys(live.connections)) {
    if (k === DEDUP_NODE) { continue; }
    want(JSON.stringify(cc[k]) === JSON.stringify(live.connections[k]), 'connection changed: ' + k);
  }

  // No production identity may leak into a tracked artifact.
  const blob = JSON.stringify(candidate);
  want(!blob.includes('cachedResultUrl'), 'candidate carries cachedResultUrl');
  want(!blob.includes('"id":"QmIyEW2ZEqKregmN"'), 'candidate carries the production workflow id');
  want(candidate.active === undefined, 'candidate carries an active flag');

  return problems;
}

// ---------------------------------------------------------------- cli

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--live');
  const livePath = (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : DEFAULT_LIVE;
  const live = JSON.parse(readFileSync(livePath, 'utf8'));

  const candidate = build(live);
  const problems = verify(live, candidate);

  console.log('');
  console.log('Lead Intake — canonical request identity candidate');
  console.log('  base            ' + livePath);
  console.log('  base nodes      ' + live.nodes.length);
  console.log('  candidate nodes ' + candidate.nodes.length);
  console.log('  touched         ' + TOUCHED_NODES.join(', '));
  console.log('  added           ' + ADDED_NODES.join(', '));
  console.log('');
  if (problems.length) {
    console.log('REFUSED TO WRITE — ' + problems.length + ' invariant(s) failed:');
    for (const p of problems) { console.log('  FAIL  ' + p); }
    process.exit(1);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  console.log('  all invariants hold');
  console.log('  wrote ' + OUT);
  console.log('');
  console.log('  CANDIDATE ONLY. Not deployed, not imported, not published.');
  console.log('');
}
