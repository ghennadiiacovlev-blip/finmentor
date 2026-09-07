#!/usr/bin/env node
// FINMENTOR — P6.2 REST-API import projection gate.
//
//   node qa/api-import.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. Unlike the P6.1 wrapper, which a human imports through the UI after
// five eyeball checks, this artifact is posted to live n8n BY A SCRIPT. There is no human in
// the loop at the moment of the write, so every property the eyeball checks would have caught
// has to be established here instead -- or, where it provably cannot be established offline,
// handed to the deploy script as an explicit post-deploy obligation.
//
// Four claims, in order of how much they matter:
//
//   1. The projection is a FAITHFUL SUBSET of the proven wrapper: the four carried fields are
//      byte-identical, and the complete residual diff equals the seven dropped fields exactly.
//   2. Every dropped field was INERT. Dropping `tags: []` costs nothing; dropping a populated
//      `tags` would silently lose state. The values are pinned, not just the names.
//   3. `active` is the one drop that is NOT inert, because inactivity stops being a property
//      of the file and becomes a property of the server default. This gate does not pretend
//      otherwise -- it asserts the obligation is declared and that the deploy script checks it.
//   4. The safety properties inherited from the wrapper survived the projection.
//
// Then the mutation battery: fourteen deliberately corrupted projections, every one of which
// the verifier must reject. A verifier that cannot fail is not a verifier.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'import-safe', 'import-safe.js'));
const A = require(join(ROOT, 'n8n', 'src', 'api-import', 'api-import.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const SAFE_PATH = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-IMPORT-SAFE.json');
const API_PATH = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-API-IMPORT.json');
const DEPLOY_PATH = join(ROOT, 'scripts', 'deploy-b21c-canary.ps1');

const safeRaw = readFileSync(SAFE_PATH, 'utf8');
const apiRaw = readFileSync(API_PATH, 'utf8');
const SAFE = JSON.parse(safeRaw);
const API = JSON.parse(apiRaw);

const clone = (v) => JSON.parse(JSON.stringify(v));
const hookIndex = () => S.webhookNodeIndexes(API)[0];

// ================================================================ 1. the tracked artifact

console.log('\n-- the tracked API-IMPORT artifact --');

check('the tracked file is exactly what the generator produces', () => {
  const rebuilt = A.serializeApiImport(A.buildApiImport(SAFE));
  eq(apiRaw, rebuilt, 'the tracked artifact is stale relative to the generator');
});

check('it verifies against the wrapper', () => {
  const v = A.verifyApiImport(SAFE, API);
  assert(v.ok, 'verification failed: ' + v.failures.join(' | '));
});

check('it carries exactly the four API-accepted fields', () => {
  const keys = Object.keys(API).sort();
  eq(keys.join(','), A.API_ACCEPTED_FIELDS.slice().sort().join(','), 'top-level fields');
});

check('every field the endpoint rejects is absent', () => {
  A.DROPPED_FIELDS.forEach((k) => {
    assert(!Object.prototype.hasOwnProperty.call(API, k), k + ' is still present');
  });
});

check('the wrapper really does carry all seven dropped fields', () => {
  // Guards against a vacuous pass: if upstream stopped emitting these, "absent from the
  // projection" would be true for the wrong reason and prove nothing.
  A.DROPPED_FIELDS.forEach((k) => {
    assert(Object.prototype.hasOwnProperty.call(SAFE, k), 'wrapper no longer carries ' + k);
  });
});

// ================================================================ 2. faithful subset

console.log('\n-- fidelity to the wrapper --');

check('nodes are byte-identical to the wrapper', () => {
  eq(JSON.stringify(API.nodes), JSON.stringify(SAFE.nodes), 'nodes differ');
});

check('connections are byte-identical to the wrapper', () => {
  eq(JSON.stringify(API.connections), JSON.stringify(SAFE.connections), 'connections differ');
});

check('settings are byte-identical to the wrapper', () => {
  eq(JSON.stringify(API.settings), JSON.stringify(SAFE.settings), 'settings differ');
});

check('all 44 Code bodies are byte-identical and non-trivial', () => {
  const a = S.nodesOfType(API, S.CODE_TYPE);
  const b = S.nodesOfType(SAFE, S.CODE_TYPE);
  eq(a.length, b.length, 'Code node count');
  let chars = 0;
  a.forEach((n, i) => {
    const x = n.parameters.jsCode, y = b[i].parameters.jsCode;
    eq(x, y, 'Code body ' + n.name + ' differs');
    chars += String(x).length;
  });
  assert(chars > 90000, 'Code bodies total only ' + chars + ' chars — suspiciously small');
});

check('every credential reference is unchanged', () => {
  const cred = (wf) => wf.nodes.map((n) => JSON.stringify(n.credentials || null)).join('|');
  eq(cred(API), cred(SAFE), 'a credential reference changed');
});

check('the residual diff equals the seven dropped fields EXACTLY', () => {
  const diff = S.diffPaths(SAFE, API, '', []).sort();
  eq(diff.join(','), A.DROPPED_FIELDS.join(','), 'unapproved differences exist');
});

// ================================================================ 3. the drops were inert

console.log('\n-- every dropped field was inert --');

Object.keys(A.DROPPED_INERT).forEach((k) => {
  check('dropping ' + k + ' loses nothing (' + A.DROPPED_INERT[k] + ')', () => {
    eq(JSON.stringify(SAFE[k]), A.DROPPED_INERT[k], k + ' is not the inert value');
  });
});

check('the wrapper active is false, so dropping it does not drop a TRUE', () => {
  eq(SAFE.active, false, 'wrapper active');
});

check('dropping meta is not concealing a production-identity leak', () => {
  assert(!JSON.stringify(SAFE.meta).includes(S.PRODUCTION_WORKFLOW_ID),
    'wrapper meta contains the production workflow id');
});

// ================================================================ 4. the `active` obligation

console.log('\n-- the one guarantee the artifact cannot carry --');

check('the post-deploy obligation is declared, and names active first', () => {
  assert(A.POST_DEPLOY_ASSERTIONS.length >= 7, 'too few post-deploy assertions');
  assert(/active === false/.test(A.POST_DEPLOY_ASSERTIONS[0]),
    'the active check is not the first post-deploy obligation');
});

check('the deploy script exists and reads the workflow back after creating it', () => {
  const ps = readFileSync(DEPLOY_PATH, 'utf8');
  assert(/Get-N8nWorkflow|\/workflows\//.test(ps), 'the deploy script never reads the workflow back');
  assert(/\$created\.active|\.active/.test(ps), 'the deploy script never inspects active');
});

check('the deploy script refuses to leave an ACTIVE workflow behind', () => {
  const ps = readFileSync(DEPLOY_PATH, 'utf8');
  // The dangerous outcome is not "the check failed" but "the check failed and the workflow
  // stayed active anyway". The script must deactivate, not merely report.
  assert(/deactivate/i.test(ps), 'the deploy script has no deactivation path');
});

check('the deploy script never posts the canonical candidate', () => {
  const ps = readFileSync(DEPLOY_PATH, 'utf8');
  assert(!/lead-intake-internal-receipt-candidate\.json/.test(ps),
    'the deploy script references the DANGEROUS canonical candidate');
  assert(/lead-intake-internal-receipt-API-IMPORT\.json/.test(ps),
    'the deploy script does not reference the API-IMPORT artifact');
});

check('the deploy script never activates and never enables MCP exposure', () => {
  const ps = readFileSync(DEPLOY_PATH, 'utf8');
  assert(!/\/activate/.test(ps), 'the deploy script contains an activate call');
  assert(!/availableInMCP\s*=\s*\$?true/i.test(ps), 'the deploy script enables availableInMCP');
});

// ================================================================ 5. inherited safety

console.log('\n-- the inherited safety properties survived --');

check('the production workflow id appears nowhere in the projection', () => {
  assert(!apiRaw.includes(S.PRODUCTION_WORKFLOW_ID), 'production id present');
});

check('the production webhook path appears nowhere in the projection', () => {
  assert(!apiRaw.includes(S.PRODUCTION_WEBHOOK_PATH), 'production path present');
});

check('the name is the distinct canary name', () => {
  eq(API.name, S.IMPORT_SAFE_NAME, 'name');
  assert(API.name !== 'FINMENTOR Lead Intake PREMIUM FINAL', 'name collides with production');
});

check('exactly 100 nodes, matching the audited candidate', () => {
  eq(API.nodes.length, A.EXPECTED_NODE_COUNT, 'node count');
});

check('the single webhook is disabled, inert-pathed and unregistered', () => {
  const hooks = S.nodesOfType(API, S.WEBHOOK_TYPE);
  eq(hooks.length, 1, 'webhook node count');
  eq(hooks[0].disabled, true, 'webhook disabled');
  eq(hooks[0].parameters.path, S.INERT_WEBHOOK_PATH, 'webhook path');
  assert(!Object.prototype.hasOwnProperty.call(hooks[0], 'webhookId'), 'webhookId still present');
});

check('settings.availableInMCP is false', () => {
  eq(API.settings.availableInMCP, false, 'availableInMCP');
});

check('the internal sub-workflow trigger is present', () => {
  assert(S.nodesOfType(API, S.INTERNAL_TRIGGER_TYPE).length >= 1, 'internal trigger absent');
});

check('the internal route reaches its terminals but no responder', () => {
  // Re-proven on the projection rather than inherited by assumption: this is the artifact
  // that actually gets deployed.
  const reach = S.reachableFromInternal(API, {});
  assert(reach.has(S.INTERNAL_AUTH_ENTRY), 'Internal Auth Entry unreachable');
  const responders = S.nodesOfType(API, S.RESPOND_TYPE).map((n) => n.name);
  responders.forEach((r) => assert(!reach.has(r), 'responder reachable on the internal route: ' + r));
  const telegram = S.nodesOfType(API, S.TELEGRAM_TYPE).map((n) => n.name);
  telegram.forEach((t) => assert(!reach.has(t), 'Telegram node reachable on the internal route: ' + t));
});

check('the errorWorkflow pointer is preserved verbatim, not silently cleared', () => {
  // Deliberate: changing a setting would be a semantic change. The consequence -- a failing
  // canary fires the live Error Monitor -- is documented for the owner instead.
  eq(API.settings.errorWorkflow, SAFE.settings.errorWorkflow, 'errorWorkflow changed');
});

// ================================================================ 6. mutation battery

console.log('\n-- mutation battery: every corrupted projection must be rejected --');

function mustReject(label, mutate, expectSubstring) {
  check('MUTATION rejected: ' + label, () => {
    const m = clone(API);
    mutate(m);
    const v = A.verifyApiImport(SAFE, m);
    assert(!v.ok, 'the verifier ACCEPTED a mutated artifact');
    if (expectSubstring) {
      assert(v.failures.some((f) => f.indexOf(expectSubstring) !== -1),
        'rejected, but not for the expected reason. failures: ' + v.failures.join(' | '));
    }
  });
}

// --- fields that must not come back ---
mustReject('production workflow id restored', (m) => { m.name = S.PRODUCTION_WORKFLOW_ID; }, 'production workflow id');
mustReject('active smuggled back in as true', (m) => { m.active = true; }, 'active');
mustReject('a rejected field left in place (tags)', (m) => { m.tags = []; }, 'tags');
mustReject('an unknown extra top-level field', (m) => { m.pinData = {}; }, 'pinData');

// --- graph drift ---
mustReject('production webhook path restored', (m) => {
  m.nodes[hookIndex()].parameters.path = S.PRODUCTION_WEBHOOK_PATH;
}, 'production webhook path');
mustReject('webhook re-enabled', (m) => { m.nodes[hookIndex()].disabled = false; }, 'not disabled');
mustReject('inherited webhookId restored', (m) => {
  m.nodes[hookIndex()].webhookId = 'e0ce5df2-f4cd-4b72-b2ac-4f44686a6be4';
}, 'webhookId');
mustReject('one byte of a Code body changed', (m) => {
  const n = m.nodes.find((x) => x.type === S.CODE_TYPE);
  n.parameters.jsCode = n.parameters.jsCode + ' ';
}, 'nodes differs');
mustReject('one connection changed', (m) => {
  const key = Object.keys(m.connections)[0];
  m.connections[key].main[0].push({ node: 'Respond New Lead', type: 'main', index: 0 });
}, 'connections differs');
mustReject('a node deleted', (m) => {
  const i = m.nodes.findIndex((x) => x.name === 'Internal Result (New)');
  m.nodes.splice(i, 1);
}, 'nodes');
mustReject('a new Telegram node added', (m) => {
  m.nodes.push({ parameters: {}, name: 'Telegram Smuggled', type: S.TELEGRAM_TYPE, typeVersion: 1, position: [0, 0] });
}, 'Telegram');
mustReject('availableInMCP enabled', (m) => { m.settings.availableInMCP = true; }, 'availableInMCP');
mustReject('the workflow renamed away from the canary name', (m) => { m.name = 'FINMENTOR Lead Intake'; }, 'name');
mustReject('the internal trigger removed', (m) => {
  const i = m.nodes.findIndex((x) => x.type === S.INTERNAL_TRIGGER_TYPE);
  m.nodes.splice(i, 1);
}, 'trigger');

// --- and the one that matters most: the WRONG INPUT ---
// Feeding the canonical candidate to this projection is the single mistake that would put the
// production identity and the live endpoint into a create call. The verifier must catch it
// from the input side, not merely from the output side.
check('MUTATION rejected: the canonical candidate offered as the input wrapper', () => {
  const canon = JSON.parse(readFileSync(
    join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json'), 'utf8'));
  const v = A.verifyApiImport(canon, A.buildApiImport(canon));
  assert(!v.ok, 'the verifier ACCEPTED a projection built from the canonical candidate');
  assert(v.failures.some((f) => /not the IMPORT-SAFE wrapper|canary name/.test(f)),
    'rejected, but not for being the wrong input. failures: ' + v.failures.join(' | '));
});

// --- and the control: the unmutated artifact is accepted, so the battery is not vacuous ---
check('CONTROL: the unmutated projection is accepted', () => {
  const v = A.verifyApiImport(SAFE, clone(API));
  assert(v.ok, 'the verifier rejects the real artifact: ' + v.failures.join(' | '));
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
