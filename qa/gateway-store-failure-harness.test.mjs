#!/usr/bin/env node
// FINMENTOR — P9-R2: the isolated store-failure harness, pre-deploy validation.
//
//   node qa/gateway-store-failure-harness.test.mjs
//
// Offline. No tenant, no network, no Supabase, no credentials.
//
// WHAT THIS GATE IS FOR. The harness exists to put a real HTTP 503 on the wire without breaking
// production Supabase. That is only worth anything if the harness is provably the DEPLOYED graph
// with a short, declared list of differences — otherwise a green 503 from the harness says
// nothing about the Gateway. So this gate asserts two things:
//
//   1. FIDELITY. Every node outside the declared allowlist is byte-identical to the Gateway
//      candidate, the connection map is identical, and all four respond nodes — the actual
//      subject of the proof — are copied verbatim with TYPED codes.
//   2. ISOLATION. Neither harness can reach the production G5 credential, the production
//      app-session table, the production route, or any side-effecting node type.
//
// And then it MUTATES each of those properties and requires the builder to refuse. P9-R1 is the
// reason: the previous Gateway gate asserted /503/.test(JSON.stringify(parameters)), which
// passed for both the broken '=503' and the fixed 503. A gate that cannot reject the bad form
// is decoration.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildHarness, verifyHarness, ALLOWED_DIVERGENCE, CLAIM_NODE, SESSION_NODE, VERIFY_NODE,
  WEBHOOK_NODE, H1_PATH, H2_PATH, GATEWAY_PATH, PUBKEY_PLACEHOLDER, CREDENTIAL_PLACEHOLDER,
  PRODUCTION_G5_CREDENTIAL_ID, PRODUCTION_SESSION_TABLE
} from '../scripts/build-gateway-store-failure-harness.mjs';

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

const GW = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const nodeOf = (wf, n) => wf.nodes.find((x) => x.name === n);

const H1 = buildHarness(GW, 'h1');
const H2 = buildHarness(GW, 'h2');

// ---------------------------------------------------------------- 1. both harnesses are valid

check('H1 passes its own gate', () => {
  const v = verifyHarness(GW, H1, 'h1');
  assert(v.ok, 'H1 rejected: ' + v.failures.join('; '));
});
check('H2 passes its own gate', () => {
  const v = verifyHarness(GW, H2, 'h2');
  assert(v.ok, 'H2 rejected: ' + v.failures.join('; '));
});

// ---------------------------------------------------------------- 2. fidelity to the Gateway

for (const [label, H] of [['H1', H1], ['H2', H2]]) {
  check(label + ' has the Gateway node count', () => eq(H.nodes.length, GW.nodes.length, 'node count'));
  check(label + ' has the Gateway connection map', () =>
    eq(JSON.stringify(H.connections), JSON.stringify(GW.connections), 'connections'));
  check(label + ' diverges only inside the declared allowlist', () => {
    for (const g of GW.nodes) {
      if (ALLOWED_DIVERGENCE.indexOf(g.name) !== -1) { continue; }
      const h = nodeOf(H, g.name);
      assert(h, 'missing node ' + g.name);
      eq(JSON.stringify(h.parameters), JSON.stringify(g.parameters), 'parameters of ' + g.name);
      eq(h.type, g.type, 'type of ' + g.name);
    }
  });
  check(label + ' copies all four respond nodes verbatim', () => {
    const respond = GW.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
    eq(respond.length, 4, 'Gateway respond node count');
    for (const g of respond) {
      eq(JSON.stringify(nodeOf(H, g.name).parameters), JSON.stringify(g.parameters), 'respond ' + g.name);
    }
  });
  // The typed codes, by value and by type. This is the P9-R1 assertion.
  check(label + ' carries the four TYPED response codes', () => {
    const codes = {};
    for (const n of H.nodes.filter((x) => x.type === 'n8n-nodes-base.respondToWebhook')) {
      codes[n.name] = n.parameters.options.responseCode;
    }
    eq(codes['Respond Bootstrap OK'], 200, 'accept code');
    eq(typeof codes['Respond Bootstrap OK'], 'number', 'accept code type');
    eq(codes['Respond Replay Refused'], 409, 'replay code');
    eq(typeof codes['Respond Replay Refused'], 'number', 'replay code type');
    eq(codes['Respond Store Unavailable'], 503, 'store code');
    eq(typeof codes['Respond Store Unavailable'], 'number', 'store code type');
    assert(/\{\{[\s\S]*\}\}/.test(codes['Respond Rejected']), 'rejected code is not a live expression');
  });
  check(label + ' preserves the fail-closed claim wiring', () => {
    const c = H.connections[CLAIM_NODE].main;
    eq(c.length, 2, 'claim output count');
    eq(c[0][0].node, 'Claim Verdict', 'claim success target');
    eq(c[1][0].node, 'Respond Store Unavailable', 'claim error target');
    eq(nodeOf(H, CLAIM_NODE).onError, 'continueErrorOutput', 'claim onError');
    eq(nodeOf(H, CLAIM_NODE).alwaysOutputData, true, 'claim alwaysOutputData');
  });
  check(label + ' keeps the store-failure branch clear of session minting', () => {
    // Nothing on the error branch may reach the session path. Structural, not conventional.
    const errTarget = H.connections[CLAIM_NODE].main[1][0].node;
    assert(!H.connections[errTarget], 'the error branch continues past the respond node');
  });
}

// ---------------------------------------------------------------- 3. isolation from production

for (const [label, H, path] of [['H1', H1, H1_PATH], ['H2', H2, H2_PATH]]) {
  const json = JSON.stringify(H);
  check(label + ' cannot reach the production G5 credential', () =>
    assert(json.indexOf(PRODUCTION_G5_CREDENTIAL_ID) === -1, 'production credential id present'));
  check(label + ' cannot reach the production app-session table', () =>
    assert(json.indexOf(PRODUCTION_SESSION_TABLE) === -1, 'production table name present'));
  check(label + ' has no dataTable node at all', () =>
    assert(!H.nodes.some((n) => n.type === 'n8n-nodes-base.dataTable'), 'dataTable node present'));
  check(label + ' has no side-effecting node type', () => {
    for (const t of ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.httpRequest',
                     'n8n-nodes-base.executeWorkflow', 'n8n-nodes-base.telegram']) {
      assert(!H.nodes.some((n) => n.type === t), t + ' present');
    }
  });
  check(label + ' is bound to a disposable route, not the Gateway route', () => {
    eq(nodeOf(H, WEBHOOK_NODE).parameters.path, path, 'webhook path');
    assert(path !== GATEWAY_PATH, 'harness path equals the Gateway path');
  });
  check(label + ' bakes in no Telegram trust anchor', () => {
    assert(!/const TG_PROD_PUBKEY_HEX = '[0-9a-f]{64}'/.test(json), 'a real anchor is baked in');
    assert(nodeOf(H, VERIFY_NODE).parameters.jsCode.indexOf(PUBKEY_PLACEHOLDER) !== -1, 'no placeholder');
  });
  check(label + ' carries no bot-token shape', () =>
    assert(!/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/.test(json), 'token shape present'));
  check(label + ' retains no execution data and is hidden from MCP', () => {
    eq(H.settings.saveDataSuccessExecution, 'none', 'success retention');
    eq(H.settings.saveDataErrorExecution, 'none', 'error retention');
    eq(H.settings.availableInMCP, false, 'MCP exposure');
  });
  check(label + ' ships no active flag and is named disposable', () => {
    assert(!Object.prototype.hasOwnProperty.call(H, 'active'), 'active flag present');
    assert(H.name.indexOf('[TEMP]') === 0, 'not named as disposable');
  });
  check(label + ' replaces the session write with a non-writing stand-in', () =>
    eq(nodeOf(H, SESSION_NODE).type, 'n8n-nodes-base.code', 'session node type'));
}

check('H1 is credential-free', () =>
  eq(H1.nodes.filter((n) => n.credentials).length, 0, 'credential-bearing nodes in H1'));
check('H1 claim stand-in is a code node that can throw', () => {
  const c = nodeOf(H1, CLAIM_NODE);
  eq(c.type, 'n8n-nodes-base.code', 'claim type');
  assert(/harness_store/.test(c.parameters.jsCode), 'no mode switch');
  assert(/throw new Error/.test(c.parameters.jsCode), 'cannot simulate an outage');
  assert(/down/.test(c.parameters.jsCode) && /won/.test(c.parameters.jsCode) && /lost/.test(c.parameters.jsCode),
    'the three store modes are not all present');
});
check('H2 keeps the REAL postgres claim node and query', () => {
  const h = nodeOf(H2, CLAIM_NODE);
  const g = nodeOf(GW, CLAIM_NODE);
  eq(h.type, 'n8n-nodes-base.postgres', 'claim type');
  eq(JSON.stringify(h.parameters), JSON.stringify(g.parameters), 'claim parameters');
});
check('H2 carries exactly one credential, and it is the placeholder', () => {
  const creds = H2.nodes.filter((n) => n.credentials);
  eq(creds.length, 1, 'credential count');
  eq(creds[0].name, CLAIM_NODE, 'credential host node');
  eq(creds[0].credentials.postgres.id, CREDENTIAL_PLACEHOLDER, 'credential id');
});
check('the verifier differs from production by its trust anchor and nothing else', () => {
  const zero = '0'.repeat(64);
  const rebuilt = nodeOf(H1, VERIFY_NODE).parameters.jsCode.split(PUBKEY_PLACEHOLDER).join(zero);
  const original = nodeOf(GW, VERIFY_NODE).parameters.jsCode
    .replace(/const TG_PROD_PUBKEY_HEX = '[0-9a-f]{64}'/, "const TG_PROD_PUBKEY_HEX = '" + zero + "'");
  eq(rebuilt, original, 'verifier body');
});

// ---------------------------------------------------------------- 4. the gate must REJECT

const MUTATIONS = [
  ['seize the production Gateway route', 'h1', (h) => { nodeOf(h, WEBHOOK_NODE).parameters.path = GATEWAY_PATH; }],
  ['restore the production G5 credential', 'h2', (h) => { nodeOf(h, CLAIM_NODE).credentials.postgres.id = PRODUCTION_G5_CREDENTIAL_ID; }],
  ['give the credential-free harness a credential', 'h1', (h) => { nodeOf(h, CLAIM_NODE).credentials = { postgres: { id: 'x', name: 'y' } }; }],
  ['restore the production app-session write', 'h1', (h) => {
    const n = nodeOf(h, SESSION_NODE);
    n.type = 'n8n-nodes-base.dataTable';
    n.parameters = { operation: 'insert', dataTableId: { __rl: true, mode: 'name', value: PRODUCTION_SESSION_TABLE } };
  }],
  ['break the 503 back into the string form', 'h1', (h) => { nodeOf(h, 'Respond Store Unavailable').parameters.options.responseCode = '=503'; }],
  ['break the 200 back into the string form', 'h1', (h) => { nodeOf(h, 'Respond Bootstrap OK').parameters.options.responseCode = '=200'; }],
  ['break the 409 back into the string form', 'h2', (h) => { nodeOf(h, 'Respond Replay Refused').parameters.options.responseCode = '=409'; }],
  ['rewire the claim error output away from the 503', 'h1', (h) => { h.connections[CLAIM_NODE].main[1] = [{ node: 'Claim Verdict', type: 'main', index: 0 }]; }],
  ['let a store failure fall through to the accept path', 'h1', (h) => { h.connections[CLAIM_NODE].main[1] = [{ node: 'Build App Session', type: 'main', index: 0 }]; }],
  ['drop the claim error routing', 'h1', (h) => { delete nodeOf(h, CLAIM_NODE).onError; }],
  ['drop alwaysOutputData from the claim', 'h1', (h) => { delete nodeOf(h, CLAIM_NODE).alwaysOutputData; }],
  ['bake a real trust anchor into the artifact', 'h1', (h) => {
    const v = nodeOf(h, VERIFY_NODE);
    v.parameters.jsCode = v.parameters.jsCode.split(PUBKEY_PLACEHOLDER).join('a'.repeat(64));
  }],
  ['widen the freshness window in the harness verifier', 'h1', (h) => {
    const v = nodeOf(h, VERIFY_NODE);
    v.parameters.jsCode = v.parameters.jsCode.replace('MAX_AUTH_AGE_SECONDS = 900', 'MAX_AUTH_AGE_SECONDS = 99999');
  }],
  ['tamper with a node outside the allowlist', 'h1', (h) => { nodeOf(h, 'Claim Verdict').parameters.jsCode = 'return [{json:{claim_won:1}}];'; }],
  ['add a side-effecting node type', 'h1', (h) => { h.nodes.push({ name: 'Leak', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, parameters: {}, position: [0, 0], id: 'leak' }); }],
  ['start retaining execution data', 'h1', (h) => { h.settings.saveDataSuccessExecution = 'all'; }],
  ['expose the harness to MCP', 'h1', (h) => { h.settings.availableInMCP = true; }],
  ['ship an active flag', 'h1', (h) => { h.active = true; }],
  ['drop the disposable naming', 'h1', (h) => { h.name = 'FINMENTOR Mini App Gateway'; }],
  ['change the connection map', 'h1', (h) => { delete h.connections['Claim Verdict']; }]
];

for (const [label, variant, mutate] of MUTATIONS) {
  check('REFUSES: ' + label, () => {
    const base = variant === 'h1' ? H1 : H2;
    const m = clone(base);
    mutate(m);
    assert(JSON.stringify(m) !== JSON.stringify(base), 'the mutation did not apply; this check is vacuous');
    const v = verifyHarness(GW, m, variant);
    assert(!v.ok, 'the gate ACCEPTED a harness that ' + label);
  });
}

// ---------------------------------------------------------------- report

console.log('');
if (failures.length) {
  console.log('FAIL  ' + failures.length + ' failed, ' + pass + ' passed');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('PASS  ' + pass + ' checks passed, 0 failed');
