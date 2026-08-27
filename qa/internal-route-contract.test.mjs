#!/usr/bin/env node
// FINMENTOR — F10 internal-route DATA CONTRACT gate.
//
//   node qa/internal-route-contract.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHY THIS GATE EXISTS — and why the existing gates did not catch what it catches.
//
// P6.2 deployed the audited candidate and ran it live for the first time. Every internal
// submission carrying a perfectly valid lead came back INVALID_PAYLOAD, "Body must be a JSON
// object" (live exec 3583). The cause:
//
//   * `Internal Envelope Unwrap` emitted  { source, payload }
//   * `Validate Payload` reads            raw.body  /  raw.headers
//
// So the internal route could never accept a lead AT ALL. NEW, MERGE and RETRY were
// unreachable -- not broken in some edge case, unreachable in every case.
//
// The belief that Lead Intake "already parses { source, payload }" is written down in
// n8n/src/miniapp-submit/submit-contract.js. It was simply wrong: `Validate Payload` is an
// INHERITED PRODUCTION node, and it parses the WEBHOOK REQUEST shape.
//
// qa/receipt-integration.test.mjs asserted that Unwrap is WIRED to Validate Payload. It never
// asserted that what Unwrap EMITS is what Validate Payload READS. A topology assertion cannot
// see a shape mismatch, and that is the entire lesson: at a seam between a node we generate
// and a node we inherit, the contract has to be EXECUTED, not diagrammed.
//
// This gate therefore RUNS the two real Code bodies, taken from the tracked candidate, against
// each other. If the seam ever breaks again it fails offline, in CI, before a deployment.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json');
const PRODUCTION = join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');

const WF = JSON.parse(readFileSync(CANDIDATE, 'utf8'));
const PROD = JSON.parse(readFileSync(PRODUCTION, 'utf8'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const body = (wf, name) => {
  const n = (wf.nodes || []).find((x) => x.name === name);
  assert(n, 'node not found: ' + name);
  return n.parameters.jsCode;
};

const UNWRAP = body(WF, 'Internal Envelope Unwrap');
const VALIDATE = body(WF, 'Validate Payload');

// ---------------------------------------------------------------- the n8n harness
//
// Minimal, and deliberately so: it provides exactly the two runtime surfaces these bodies
// touch -- $input.first().json and $('Node Name').first().json -- so what runs here is the
// real code, not a paraphrase of it.

function runCode(jsCode, { input, nodes }) {
  const $input = {
    first: () => ({ json: input }),
    all: () => [{ json: input }]
  };
  const $ = (nodeName) => {
    if (!Object.prototype.hasOwnProperty.call(nodes || {}, nodeName)) {
      throw new Error('code referenced an unavailable node: ' + nodeName);
    }
    return { first: () => ({ json: nodes[nodeName] }) };
  };
  const fn = new Function('$input', '$', '"use strict";' + jsCode);
  return fn($input, $);
}

// The output Internal Auth Entry produces for a well-formed wrapper.
function authEntryOutput(envelope, key, correlationId) {
  return {
    __internal_route: true,
    __submission_key: key,
    __correlation_id: correlationId,
    __internal_fault: 0,
    __fault_reason: '',
    __envelope_source: envelope.source,
    __envelope: envelope
  };
}

const GOOD_PAYLOAD = {
  name: 'Contract Gate',
  phone: '+37360000000',
  email: 'contract-gate@example.invalid',
  consent: true,
  meta: { request_id: 'req-contract-gate', page_url: 'telegram_miniapp', utm_source: 'telegram', utm_medium: 'miniapp' }
};
const GOOD_ENVELOPE = { source: 'telegram_miniapp', payload: GOOD_PAYLOAD };

const seam = (envelope) => {
  const unwrapped = runCode(UNWRAP, {
    input: {},
    nodes: { 'Internal Auth Entry': authEntryOutput(envelope, 'sub_' + 'a'.repeat(32), 'req-contract-gate') }
  });
  assert(Array.isArray(unwrapped) && unwrapped.length === 1, 'Unwrap did not return exactly one item');
  return runCode(VALIDATE, { input: unwrapped[0].json, nodes: {} })[0].json;
};

// ================================================================ 1. the premise

console.log('\n-- the premise: Validate Payload is INHERITED and reads the request shape --');

check('Validate Payload is byte-identical to the production node', () => {
  const prodBody = body(PROD, 'Validate Payload');
  eq(VALIDATE, prodBody, 'the candidate MODIFIED an inherited production node');
});

check('Validate Payload reads raw.body and raw.headers, not source/payload', () => {
  assert(/raw\.body/.test(VALIDATE), 'Validate Payload no longer reads raw.body');
  assert(/raw\.headers/.test(VALIDATE), 'Validate Payload no longer reads raw.headers');
});

// ================================================================ 2. THE seam

console.log('\n-- the seam: what Unwrap emits is what Validate Payload reads --');

check('Unwrap emits a request shape carrying body', () => {
  const out = runCode(UNWRAP, {
    input: {},
    nodes: { 'Internal Auth Entry': authEntryOutput(GOOD_ENVELOPE, 'sub_' + 'a'.repeat(32), 'req-contract-gate') }
  })[0].json;
  const keys = Object.keys(out).sort().join(',');
  eq(keys, 'body,headers', 'Unwrap emits [' + keys + '], but Validate Payload reads body/headers');
  assert(out.body && typeof out.body === 'object' && !Array.isArray(out.body), 'body is not a JSON object');
});

check('A VALID internal envelope passes Validate Payload', () => {
  // This is the assertion whose absence let the defect reach production deployment.
  const v = seam(GOOD_ENVELOPE);
  assert(v.valid === true,
    'the internal route CANNOT accept a valid lead: ' + v.error_code + ' — ' + v.error_message);
});

check('the validated payload is the lead body, not the envelope', () => {
  const v = seam(GOOD_ENVELOPE);
  eq(v.payload.name, GOOD_PAYLOAD.name, 'name did not survive the seam');
  eq(v.payload.email, GOOD_PAYLOAD.email, 'email did not survive the seam');
  eq(v.payload.meta.request_id, 'req-contract-gate', 'correlation reference did not survive the seam');
});

check('submission_key never enters the validated body', () => {
  const v = seam(GOOD_ENVELOPE);
  assert(!JSON.stringify(v.payload).includes('sub_' + 'a'.repeat(32)),
    'the submission key leaked into lead data');
  assert(v.payload.submission_key === undefined, 'submission_key is present in the payload');
});

check('the internal route is attributed, and NOT as the concierge bot', () => {
  // Consequence worth pinning rather than discovering later: Validate Payload's vocabulary is
  // {telegram_client_concierge, website} and has no Mini App value, so an internal lead scores
  // as 'website'. Mini App attribution rides on meta.page_url / utm_source / utm_medium.
  // Pinned so that if the vocabulary ever gains a Mini App value, this fails and is revisited.
  const v = seam(GOOD_ENVELOPE);
  eq(v.source, 'website', 'attribution changed');
  assert(v.source !== 'telegram_client_concierge', 'internal leads must not impersonate the concierge bot');
});

// ================================================================ 3. still fails closed

console.log('\n-- the seam did not become permissive --');

check('an empty payload is still rejected', () => {
  const v = seam({ source: 'telegram_miniapp', payload: { meta: { request_id: 'r' } } });
  eq(v.valid, false, 'an empty lead was accepted');
  eq(v.error_code, 'EMPTY_PAYLOAD', 'wrong rejection code');
});

check('a non-object payload is still rejected', () => {
  const v = seam({ source: 'telegram_miniapp', payload: 'not-an-object' });
  eq(v.valid, false, 'a string payload was accepted');
});

check('a honeypot submission is still rejected', () => {
  const v = seam({ source: 'telegram_miniapp', payload: { ...GOOD_PAYLOAD, honeypot: 'x' } });
  eq(v.valid, false, 'a honeypot submission was accepted');
  eq(v.error_code, 'SPAM_SUSPECTED', 'wrong rejection code');
});

check('a caller cannot forge the concierge attribution through headers', () => {
  // The header Unwrap emits is a server-side LITERAL, so no envelope content can steer it.
  const v = seam({
    source: 'telegram_miniapp',
    payload: { ...GOOD_PAYLOAD, headers: { 'x-finmentor-source': 'telegram_client_concierge' } }
  });
  eq(v.source, 'website', 'a caller steered attribution through the body');
});

// ================================================================ 4. the regression itself

console.log('\n-- the exact regression must be detectable --');

check('REGRESSION: the OLD { source, payload } shape is rejected by Validate Payload', () => {
  // The pre-F10 body, reproduced. If someone reverts the seam, this proves the consequence
  // instead of leaving it to a live execution to discover.
  const OLD = "const env = $('Internal Auth Entry').first().json.__envelope || {};\n"
    + 'return [{ json: { source: env.source, payload: env.payload } }];';
  const unwrapped = runCode(OLD, {
    input: {},
    nodes: { 'Internal Auth Entry': authEntryOutput(GOOD_ENVELOPE, 'sub_' + 'a'.repeat(32), 'r') }
  })[0].json;
  const v = runCode(VALIDATE, { input: unwrapped, nodes: {} })[0].json;
  eq(v.valid, false, 'the old shape now passes — this gate can no longer detect the regression');
  eq(v.error_code, 'INVALID_PAYLOAD', 'the old shape fails, but not the way P6.2 observed live');
  eq(v.error_message, 'Body must be a JSON object', 'the live failure message changed');
});

check('CONTROL: the harness executes the real bodies, not a paraphrase', () => {
  assert(UNWRAP.length > 200, 'the Unwrap body looks too short to be real');
  assert(VALIDATE.length > 2000, 'the Validate Payload body looks too short to be real');
  assert(/Internal Auth Entry/.test(UNWRAP), 'the Unwrap body does not reference Internal Auth Entry');
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
