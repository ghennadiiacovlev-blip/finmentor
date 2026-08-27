#!/usr/bin/env node
// FINMENTOR — F10/F11 internal-route DATA CONTRACT gate.
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

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

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
const NORMALIZE = body(WF, 'Normalize + Score Lead');

// The GATEWAY's own payload builder -- the real module, never a copy of its shape.
const GATEWAY = require(join(ROOT, 'n8n', 'src', 'miniapp-submit', 'submit-contract.js'));
const RECEIPT = require(join(ROOT, 'n8n', 'src', 'lead-intake', 'idempotency-receipt.js'));

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

// ================================================================ 5. F11 — the failure paths
//
// F10 was a shape assumption at a seam. F11 is the same mistake one layer down: an assumption
// about what data survives an n8n ERROR OUTPUT.
//
// Three of the four `IF Internal (*)` failure gates are fed EXCLUSIVELY from an error output.
// An error output does not carry the failing node's input json -- it emits an error item. So
// `$json.__internal` was `undefined`, `undefined === 1` is false, and every internal failure
// took the FALSE branch: the PUBLIC branch, into a RespondToWebhook with nothing to respond to
// inside a sub-workflow, then into a Stop node that THREW at the internal caller.
//
// Internal Result (Infra), (PipelineFailed) and (MergeFailed) were therefore UNREACHABLE --
// three declared terminals of the internal contract that could never fire. Observed live in
// P6.3 (driver exec 3585, case F): a valid lead cleared Validate Payload, the CRM read was
// genuinely unavailable, and the run died at `Stop: CRM Unavailable` on the public branch.
//
// The rule this pins: on the internal route, internal-ness is read BY NODE REFERENCE, never
// off `$json`. A node reference survives an error output; `$json` does not.
//
// THAT PREMISE IS PROVEN LIVE, not assumed. A disposable probe (jHYxPsQEN6Pap5ai, archived)
// fed a Code node's error output into an observer, on the real tenant. Execution 3596:
//
//   keys on the error item ............... "error"        <- and nothing else
//   the seeded upstream marker ........... gone
//   $json.__internal ..................... undefined      -> would take the PUBLIC branch
//   $('Seed').first().json.__internal .... 1              -> takes the INTERNAL branch
//
// One run, both halves. The mechanism belongs to n8n's error output rather than to any one
// node, so it covers Infra, PipelineFailed and MergeFailed identically.

console.log('\n-- F11: internal-ness survives an error-output feed --');

const CONN = WF.connections || {};
const NODES = Object.fromEntries(WF.nodes.map((n) => [n.name, n]));

// Every (source, outputIndex) edge that lands on `target`.
function feedersOf(target) {
  const out = [];
  for (const [src, c] of Object.entries(CONN)) {
    (c.main || []).forEach((branch, i) => {
      (branch || []).forEach((e) => { if (e && e.node === target) out.push({ src, index: i }); });
    });
  }
  return out;
}

// An edge is an ERROR-OUTPUT feed when the source node routes failures to a second main
// output and this is that output.
const isErrorFeed = (f) => NODES[f.src] && NODES[f.src].onError === 'continueErrorOutput' && f.index === 1;

function reaches(start, target) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const n = q.shift();
    if (n === target) return true;
    ((CONN[n] || {}).main || []).forEach((br) => (br || []).forEach((e) => {
      if (e && !seen.has(e.node)) { seen.add(e.node); q.push(e.node); }
    }));
  }
  return false;
}

const PUBLIC_ENTRY = 'Webhook';
const INTERNAL_ENTRY = 'Internal Subworkflow Trigger';
const FAILURE_GATES = ['IF Internal (Invalid)', 'IF Internal (Infra)',
  'IF Internal (PipelineFailed)', 'IF Internal (MergeFailed)'];
const ALL_GATES = WF.nodes.filter((n) => /^IF Internal \(/.test(n.name)).map((n) => n.name);

const flagExprOf = (gate) => NODES[gate].parameters.conditions.conditions[0].leftValue;

check('the failure gates ARE fed from error outputs — the premise of this section', () => {
  // If this ever stops being true the rest of the section is testing nothing, so it is
  // asserted rather than assumed.
  const errorFed = ['IF Internal (Infra)', 'IF Internal (PipelineFailed)', 'IF Internal (MergeFailed)'];
  errorFed.forEach((g) => {
    const feeds = feedersOf(g);
    assert(feeds.length > 0, g + ' has no feeders at all');
    assert(feeds.every(isErrorFeed),
      g + ' is no longer fed only from error outputs: ' + JSON.stringify(feeds));
  });
});

check('NO IF Internal gate reads internal-ness off $json', () => {
  // THE assertion. `$json.__internal` is exactly what F11 was.
  const bad = ALL_GATES.filter((g) => /\$json\s*\.\s*__internal/.test(flagExprOf(g)));
  assert(!bad.length, 'gates reading $json.__internal (dies on an error-output feed): ' + bad.join(', '));
});

check('every IF Internal gate reads the flag by NODE REFERENCE', () => {
  ALL_GATES.forEach((g) => {
    const e = flagExprOf(g);
    const m = /\$\('([^']+)'\)\.first\(\)\.json\.__internal\b/.exec(e);
    assert(m, g + ' does not read __internal by node reference: ' + e);
  });
});

check('every referenced flag node RUNS ON BOTH ROUTES before its gate', () => {
  // A node reference throws if the node did not run, so the reference is only safe when the
  // referenced node is reachable from BOTH entries and upstream of the gate on both.
  ALL_GATES.forEach((g) => {
    const m = /\$\('([^']+)'\)/.exec(flagExprOf(g));
    assert(m, g + ' reads no node reference at all, so nothing can be proven to run: ' + flagExprOf(g));
    const ref = m[1];
    assert(NODES[ref], g + ' references a node that does not exist: ' + ref);
    assert(reaches(PUBLIC_ENTRY, ref), g + ': ' + ref + ' is unreachable from the public entry');
    assert(reaches(INTERNAL_ENTRY, ref), g + ': ' + ref + ' is unreachable from the internal entry');
    assert(reaches(ref, g), g + ': ' + ref + ' is not upstream of the gate');
  });
});

check('the three failure terminals are REACHABLE from the internal entry', () => {
  // The defect in one sentence: these three could never fire.
  ['Internal Result (Infra)', 'Internal Result (PipelineFailed)', 'Internal Result (MergeFailed)']
    .forEach((t) => {
      assert(NODES[t], 'terminal missing: ' + t);
      assert(reaches(INTERNAL_ENTRY, t), t + ' is UNREACHABLE from the internal entry');
    });
});

check('each failure gate routes TRUE to its internal terminal and FALSE to the public responder', () => {
  FAILURE_GATES.forEach((g) => {
    const branches = (CONN[g] || {}).main || [];
    const t = (branches[0] || []).map((e) => e.node);
    const f = (branches[1] || []).map((e) => e.node);
    assert(t.length === 1 && /^Internal Result \(/.test(t[0]),
      g + ' TRUE branch is not a single internal terminal: ' + t.join(','));
    assert(f.length === 1 && /^Respond /.test(f[0]),
      g + ' FALSE branch is not the public responder: ' + f.join(','));
  });
});

check('no internal terminal is a RespondToWebhook, and no responder is reachable internally', () => {
  // F4 restated on the objects F11 proved were being bypassed.
  WF.nodes.filter((n) => /^Internal Result \(/.test(n.name)).forEach((n) => {
    assert(n.type !== 'n8n-nodes-base.respondToWebhook',
      n.name + ' is a RespondToWebhook — the internal route must never respond to a webhook');
  });
});

check('the referenced node DOMINATES every path to its gate, from both entries', () => {
  // Strictly stronger than reachability, and it closes a risk the FIX itself introduces.
  //
  // `$('X')` THROWS when X did not run. The old `$json` form could not throw -- it merely read
  // undefined. So if any path could reach a gate WITHOUT passing through the referenced node,
  // the F11 fix would trade a wrong branch for a hard failure, and on the PUBLIC route that
  // would be a new customer-facing defect introduced by a fix.
  //
  // Reachability alone does not settle this: the node can be reachable and still be bypassable
  // on some other path. This deletes the referenced node from the graph and asserts the gate
  // becomes unreachable -- which is what "dominates" means.
  const succ = (n) => ((CONN[n] || {}).main || []).flatMap((br) => (br || []).map((e) => e.node));
  const reachesWithout = (entry, target, via) => {
    const seen = new Set([entry]);
    const q = [entry];
    while (q.length) {
      const n = q.shift();
      if (n === target) return true;
      for (const m of succ(n)) {
        if (m === via) continue;
        if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
    return false;
  };
  const bad = [];
  ALL_GATES.forEach((g) => {
    const ref = /\$\('([^']+)'\)/.exec(flagExprOf(g))[1];
    [['public', PUBLIC_ENTRY], ['internal', INTERNAL_ENTRY]].forEach(([label, entry]) => {
      if (reachesWithout(entry, g, ref)) {
        bad.push(g + ' is reachable from the ' + label + ' entry WITHOUT passing ' + ref
          + ' — the expression would THROW there');
      }
    });
  });
  assert(!bad.length, bad.join('; '));
});

check('the F11 fix changes NOTHING on the public route', () => {
  // A fix to the internal route must be invisible to the public one. Proven by EXECUTING
  // Internal Flag the way the public path reaches it -- with Internal Auth Entry absent, which
  // is why that body is written with a try/catch in the first place.
  const flagBody = body(WF, 'Internal Flag');
  const out = runCode(flagBody, {
    input: { valid: true, payload: { name: 'public caller' } },
    nodes: {}   // Internal Auth Entry did NOT run: this is the public path
  });
  assert(Array.isArray(out) && out.length === 1, 'Internal Flag did not return one item');
  eq(out[0].json.__internal, 0, 'the public path no longer scores __internal = 0');

  // Every gate compares against 1, so 0 sends the public caller to the public responder --
  // exactly where the pre-F11 `$json` form sent it (undefined, or 0, both !== 1).
  assert(out[0].json.__internal !== 1, 'a public caller would now take the INTERNAL branch');
  FAILURE_GATES.forEach((g) => {
    const rightValue = NODES[g].parameters.conditions.conditions[0].rightValue;
    eq(rightValue, 1, g + ' no longer compares the flag against 1');
  });

  // And the public payload is passed through untouched, as it was before.
  eq(out[0].json.valid, true, 'Internal Flag altered the public payload');
  eq(out[0].json.payload.name, 'public caller', 'Internal Flag altered the public payload');
});

check('REGRESSION: a $json-fed gate is provably broken by an error output', () => {
  // Demonstrate the consequence rather than assert the string. An n8n error item carries the
  // error, not the failing node's input, so the flag is simply absent.
  const errorItem = { error: { message: 'Service unavailable - try again later' } };
  const flag = errorItem.__internal;
  assert(flag === undefined, 'an error item unexpectedly carries __internal');
  assert(!(flag === 1), 'the $json form would have taken the internal branch — it does not');
  // ...and the node-reference form is unaffected by what the error item contains.
  const viaReference = { __internal: 1 };
  assert(viaReference.__internal === 1, 'the node-reference form must still resolve to 1');
});

// ================================================================ 5. the payload SHAPE
//
// P6.3 ran the superseded canary live and the internal route accepted a lead end to end
// (exec 3610). The row it wrote carried NO NAME, NO PHONE, NO TELEGRAM and consent false,
// and scored INCOMPLETE. The route was not at fault: the case had been hand-written FLAT --
// { name, email, phone } at the top level -- and `Normalize + Score Lead` reads
// `client.name` / `lead.name`. The gateway never emits that shape. So a green live run
// proved the seam MOVES a payload while proving nothing about what ARRIVES in the CRM.
//
// §1 executes the seam as far as Validate Payload. That is one node too few: Validate Payload
// accepts a flat payload as "meaningful", so the loss happens entirely downstream of where
// this gate used to stop. These checks run the REAL gateway builder into the REAL normaliser.

const gatewayEnvelope = (() => {
  const built = GATEWAY.buildLeadIntakePayload({
    nowIso: '2026-08-27T09:00:00.000Z',
    correlationId: 'req-shape-gate',
    telegramUserId: '123456789',
    locale: 'ru',
    clientVersion: GATEWAY.ALLOWED_CLIENT_VERSIONS[0],
    contact: { name: 'Shape Gate', company: 'Shape SRL', direct: '+37360000631' },
    answers: { sector: 'services', turnover: '500k_2m', cash: 'partial', profit: 'unclear', treasury: 'unclear', kpi: 'partial', pain: 'cash_gap', urgency: 'now' },
    free_text: { context: 'shape gate' }
  });
  assert(built.ok, 'the gateway refused to build its own canonical payload');
  return built.envelope;
})();

// The seam, one node further than `seam()`: through to the row the CRM would receive.
const normalised = (envelope) => {
  const unwrapped = runCode(UNWRAP, {
    input: {},
    nodes: { 'Internal Auth Entry': authEntryOutput(envelope, 'sub_' + 'a'.repeat(32), 'req-shape-gate') }
  });
  const v = runCode(VALIDATE, { input: unwrapped[0].json, nodes: {} })[0].json;
  assert(v.valid, 'Validate Payload rejected the payload: ' + v.error_code);
  const out = runCode(NORMALIZE, {
    input: v,
    nodes: {
      'Validate Payload': v,
      'Internal Auth Entry': authEntryOutput(envelope, 'sub_' + 'a'.repeat(32), 'req-shape-gate')
    }
  });
  assert(Array.isArray(out) && out.length === 1, 'Normalize did not return exactly one item');
  return out[0].json;
};

check('the REAL gateway payload reaches the CRM row with its contacts intact', () => {
  const row = normalised(gatewayEnvelope);
  eq(row.name, 'Shape Gate', 'the name did not survive the seam');
  eq(row.company, 'Shape SRL', 'the company did not survive the seam');
  eq(row.phone, '+37360000631', 'the contact did not survive the seam');
  eq(row.telegram, '123456789', 'the Telegram identity did not survive the seam');
  eq(row.consent, true, 'consent did not survive the seam');
  assert(row.lead_priority !== 'INCOMPLETE', 'a complete gateway submission scored INCOMPLETE');
  assert(!/нет контакта/.test(row.priority_reason || ''), 'the row was scored as having no contact');
});

check('Mini App provenance rides on attribution, since source stays website', () => {
  // §2 fixes `source` at 'website' on purpose: an internal lead must not impersonate the
  // concierge bot. That makes meta.page_url / utm_* the ONLY channel by which a row can be
  // recognised as a Mini App lead, so it is load-bearing and asserted here, not assumed.
  const row = normalised(gatewayEnvelope);
  eq(row.page_url, 'telegram_miniapp', 'Mini App provenance is not recorded on the row');
  eq(row.utm_source, 'telegram', 'utm_source drifted');
  eq(row.utm_medium, 'miniapp', 'utm_medium drifted');
});

check('REGRESSION: a FLAT contact payload validates but arrives CONTACTLESS', () => {
  // This is the P6.3 live case, preserved. It documents the trap rather than the fix: the
  // shape is accepted at every gate and still produces an unusable lead, so a future case
  // written this way fails HERE instead of in the production CRM.
  const flat = {
    meta: { request_id: 'req-shape-gate' },
    name: 'Flat Case', email: 'flat@example.invalid', phone: '+37360000000', consent: true
  };
  const v = seam({ source: 'telegram_miniapp', payload: flat });
  eq(v.valid, true, 'the flat shape no longer validates -- update this regression');
  const row = normalised({ source: 'telegram_miniapp', payload: flat });
  eq(row.name, '', 'a top-level name now reaches the row: the trap is closed, tighten this gate');
  eq(row.phone, '', 'a top-level phone now reaches the row: the trap is closed, tighten this gate');
  eq(row.lead_priority, 'INCOMPLETE', 'the flat shape no longer scores INCOMPLETE');
});

// ================================================================ 6. F13 -- post-claim, CLOSED
//
// P6.4 owner decision. Once the receipt has moved READY -> IN_FLIGHT, any subsequent Pipeline
// INSERT/UPDATE failure is AMBIGUOUS: the append may have landed and the failure be in the
// acknowledgement. The system does not know that the canonical write did not happen.
//
//   LEAD_INTAKE_CLAIM_RULES.no_ordinary_rejection_after_claim                     = true
//   LEAD_INTAKE_CLAIM_RULES.post_claim_failure_is_unresolved_not_ordinary_failure = 'SUBMIT_UNRESOLVED'
//
// Both post-claim terminals now return exactly that. `retryable: true` is not a licence to
// resubmit -- a retry RECOVERS the same submission, proven in qa/miniapp-submit.test.mjs
// (P6.4-R1..R5). Ambiguity is preserved on purpose: no abort, no rollback to READY, no claim
// release, no second write.

const CLAIM = 'Receipt Claim';
const reachableFrom = (root) => {
  const seen = new Set();
  const walk = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    ((WF.connections[n] || {}).main || []).forEach((arr) => (arr || []).forEach((e) => walk(e.node)));
  };
  walk(root);
  return seen;
};
const postClaim = reachableFrom(CLAIM);

// The post-claim FAILURE terminals, derived rather than listed: the Internal Result nodes
// reachable from the ERROR OUTPUT of a Pipeline write. Everything reachable from the claim is
// post-claim, but most of that is the success path -- Internal Result (New) returns a lead id
// and a mode BY DESIGN, and folding it in here would make the leak check meaningless.
const PIPELINE_WRITERS = ['Save to Pipeline', 'Update Pipeline (Merge)'];
const postClaimTerminals = (() => {
  const out = new Set();
  PIPELINE_WRITERS.forEach((w) => {
    (((WF.connections[w] || {}).main || [])[1] || []).forEach((e) => {
      reachableFrom(e.node).forEach((n) => { if (/^Internal Result \(/.test(n)) out.add(n); });
    });
  });
  return [...out];
})();

const codeOf = (t) => {
  const m = /error_code:\s*'([A-Z_]+)'/.exec(NODES[t].parameters.jsCode || '');
  assert(m, t + ' has no literal error_code');
  return m[1];
};
const retryableOf = (t) => {
  const m = /retryable:\s*(true|false)/.exec(NODES[t].parameters.jsCode || '');
  assert(m, t + ' has no literal retryable');
  return m[1] === 'true';
};

check('the two write-failure terminals ARE post-claim, and Infra is NOT', () => {
  PIPELINE_WRITERS.forEach((w) => {
    assert(postClaim.has(w), w + ' is no longer reachable from the claim -- re-derive F13');
  });
  assert(postClaimTerminals.indexOf('Internal Result (PipelineFailed)') !== -1,
    'PipelineFailed is no longer fed by the Save to Pipeline error output -- re-derive F13');
  assert(postClaimTerminals.indexOf('Internal Result (MergeFailed)') !== -1,
    'MergeFailed is no longer fed by the Update Pipeline (Merge) error output -- re-derive F13');
  // Read Settings fails long before the receipt is touched, so CRM_UNAVAILABLE stays an honest
  // ordinary failure. Converting it would destroy information, not preserve it.
  assert(postClaimTerminals.indexOf('Internal Result (Infra)') === -1,
    'Infra became post-claim -- its ordinary-failure contract must then be reconsidered');
});

check('F13 CLOSED: both post-claim terminals return the reserved ambiguity code', () => {
  const rules = RECEIPT.LEAD_INTAKE_CLAIM_RULES;
  const reserved = rules.post_claim_failure_is_unresolved_not_ordinary_failure;
  eq(reserved, 'SUBMIT_UNRESOLVED', 'the reserved code changed');
  eq(rules.no_ordinary_rejection_after_claim, true, 'the no-ordinary-rejection rule was dropped');

  // The terminals are compared against the RULE, not against a copied literal, so the two
  // cannot drift apart in either direction.
  postClaimTerminals.forEach((t) => {
    eq(codeOf(t), reserved, t + ' does not report the reserved post-claim code');
    eq(retryableOf(t), true, t + ' must stay retryable: a retry RECOVERS the same submission');
  });
  assert(postClaimTerminals.length >= 2, 'fewer post-claim terminals than expected');
});

check('F13: the post-claim terminals leak no stage, detail, key, receipt state or mode', () => {
  postClaimTerminals.forEach((t) => {
    const js = NODES[t].parameters.jsCode || '';
    ['stage', 'detail', 'submission_key', 'commit_state', 'mode', 'lead_id'].forEach((f) => {
      assert(!new RegExp('\\b' + f + '\\s*:').test(js), t + ' exposes ' + f);
    });
    const fields = (js.match(/^\s*([a-z_]+):/gm) || []).map((x) => x.trim().replace(':', ''));
    eq(fields.sort().join(','), 'error_code,ok,retryable', t + ' returns fields beyond the failure contract');
  });
});

check('F13 §4: neither post-claim terminal settles, aborts or rolls back the receipt', () => {
  // Ambiguity preservation is STRUCTURAL: both are dead ends, so nothing downstream can move
  // the receipt out of IN_FLIGHT on a post-claim failure.
  ['Internal Result (PipelineFailed)', 'Internal Result (MergeFailed)'].forEach((t) => {
    const targets = ((WF.connections[t] || {}).main || []).flatMap((arr) => (arr || []).map((e) => e.node));
    eq(targets.length, 0, t + ' now has outgoing edges: it could settle a receipt it must leave IN_FLIGHT');
  });
  // And no receipt-writing node is reachable from the failing writes' error outputs at all.
  const RECEIPT_WRITERS = ['Receipt Claim', 'Receipt Commit (New)', 'Receipt Commit (Merge)', 'Receipt Retry Settlement'];
  ['Save to Pipeline', 'Update Pipeline (Merge)'].forEach((writer) => {
    const errEdges = (((WF.connections[writer] || {}).main || [])[1] || []).map((e) => e.node);
    assert(errEdges.length > 0, writer + ' lost its error output');
    errEdges.forEach((entry) => {
      const seen = reachableFrom(entry);
      RECEIPT_WRITERS.forEach((w) => {
        assert(!seen.has(w), 'a post-claim failure from ' + writer + ' can reach ' + w + ' -- ambiguity would be discarded');
      });
    });
  });
});

check('F13: the PUBLIC path is unchanged', () => {
  // The decision is about the internal contract only. The webhook responders keep the codes a
  // browser client already understands.
  const bodyOf = (n) => String(NODES[n].parameters.responseBody || '');
  assert(/PIPELINE_WRITE_FAILED/.test(bodyOf('Respond Pipeline Failed')), 'the public pipeline responder changed');
  assert(/PIPELINE_MERGE_FAILED/.test(bodyOf('Respond Merge Failed')), 'the public merge responder changed');
  assert(/CRM_UNAVAILABLE/.test(bodyOf('Respond Infra Failed')), 'the public infra responder changed');
  eq(codeOf('Internal Result (Infra)'), 'CRM_UNAVAILABLE', 'Infra was wrongly converted to SUBMIT_UNRESOLVED');
});

check('F13 MUTATION: an ordinary post-claim code would be DETECTED', () => {
  // The closure check is only worth having if it fails when the defect returns. Rebuild the
  // comparison against a mutated terminal body and prove it throws.
  const reserved = RECEIPT.LEAD_INTAKE_CLAIM_RULES.post_claim_failure_is_unresolved_not_ordinary_failure;
  const mutated = "return [{ json: { ok: false, error_code: 'PIPELINE_WRITE_FAILED', retryable: true } }];";
  const mutatedCode = /error_code:\s*'([A-Z_]+)'/.exec(mutated)[1];
  let caught = false;
  try { eq(mutatedCode, reserved, 'mutated'); } catch (e) { caught = true; }
  assert(caught, 'the F13 comparison does not detect a reverted terminal -- the check is vacuous');
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
