#!/usr/bin/env node
// FINMENTOR — P6.1 safe manual-import artifact gate.
//
//   node qa/import-safe.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. The owner is going to hand-import a 425 KB workflow JSON into live
// n8n. The only thing standing between that click and a collision with the production Lead
// Intake workflow -- or with its public POST endpoint -- is that the file being imported is
// the WRAPPER and not the canonical audited candidate, and that the wrapper is genuinely
// neutered. This gate is what makes "genuinely" checkable instead of asserted.
//
// Three claims, in order of how much they matter:
//
//   1. The canonical candidate STILL CARRIES the hazards. If it ever stops carrying them the
//      wrapper's premise has changed, and that must fail loudly rather than pass vacuously.
//   2. The tracked IMPORT-SAFE file on disk is import-safe, and is not stale relative to the
//      generator.
//   3. The wrapper differs from the canonical ONLY by the approved transformation -- proven
//      by an exhaustive residual diff, not by re-running the transform.
//
// Then the mutation battery: sixteen deliberately corrupted wrappers, every one of which the
// verifier must reject. A verifier that cannot fail is not a verifier.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'import-safe', 'import-safe.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const CANON_PATH = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-candidate.json');
const SAFE_PATH = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-IMPORT-SAFE.json');

const canonRaw = readFileSync(CANON_PATH, 'utf8');
const safeRaw = readFileSync(SAFE_PATH, 'utf8');
const CANON = JSON.parse(canonRaw);
const SAFE = JSON.parse(safeRaw);

const clone = (v) => JSON.parse(JSON.stringify(v));
const hookIndex = () => S.webhookNodeIndexes(SAFE)[0];

// ================================================================ 1. the hazards are real

console.log('\n-- the canonical candidate is genuinely unsafe to hand-import --');

check('canonical carries the production workflow id', () => {
  eq(CANON.id, S.PRODUCTION_WORKFLOW_ID, 'canonical id is not the production id');
});

check('canonical carries active = true', () => {
  eq(CANON.active, true, 'canonical is no longer active:true');
});

check('canonical carries the live public webhook path', () => {
  const hooks = S.nodesOfType(CANON, S.WEBHOOK_TYPE);
  eq(hooks.length, 1, 'canonical does not have exactly one webhook node');
  eq(hooks[0].parameters.path, S.PRODUCTION_WEBHOOK_PATH, 'canonical webhook path changed');
  assert(hooks[0].disabled !== true, 'canonical webhook is already disabled');
});

check('canonical carries the shadow graph copy and the sharing record', () => {
  // The two identity carriers the brief did not name. If a future export drops them the
  // extended strip list should be revisited deliberately, so assert they are here.
  assert(CANON.activeVersion && CANON.activeVersion.workflowId === S.PRODUCTION_WORKFLOW_ID,
    'canonical activeVersion no longer carries the production workflowId');
  assert(Array.isArray(CANON.shared) && CANON.shared.length > 0,
    'canonical no longer carries a shared record');
  // The shadow copy really does contain a second, un-neutralised webhook.
  const shadow = JSON.stringify(CANON.activeVersion);
  assert(shadow.indexOf(S.PRODUCTION_WEBHOOK_PATH) !== -1,
    'canonical activeVersion no longer contains the production path');
});

// ================================================================ 2. the artifact on disk

console.log('\n-- the tracked IMPORT-SAFE artifact --');

check('the tracked artifact passes full import-safety verification', () => {
  const v = S.verifyImportSafe(CANON, SAFE);
  assert(v.ok, 'verification failed: ' + v.failures.join(' | '));
});

check('the tracked artifact is not stale relative to the generator', () => {
  // Regenerating from the canonical must reproduce the tracked bytes exactly. A stale
  // wrapper is the failure mode where the canonical moves and the file the owner imports
  // silently does not.
  const rebuilt = S.serializeImportSafe(S.buildImportSafe(CANON));
  eq(rebuilt, safeRaw.split('\r\n').join('\n'), 'the tracked IMPORT-SAFE file is not what the generator produces');
});

check('top-level production identity and lifecycle fields are absent', () => {
  S.STRIPPED_TOP_LEVEL.forEach((k) => {
    assert(!Object.prototype.hasOwnProperty.call(SAFE, k), k + ' is still present');
  });
});

check('the production workflow id appears nowhere in the artifact', () => {
  assert(safeRaw.indexOf(S.PRODUCTION_WORKFLOW_ID) === -1,
    'the production workflow id survives somewhere in the file');
});

check('name is the unique canary name, active and isArchived are false', () => {
  eq(SAFE.name, S.IMPORT_SAFE_NAME, 'wrong name');
  assert(/INTERNAL B21C RECEIPT CANARY/.test(SAFE.name), 'the name lacks the canary marker the owner is told to look for');
  assert(SAFE.name !== CANON.name, 'the wrapper shares the canonical name');
  eq(SAFE.active, false, 'active is not false');
  eq(SAFE.isArchived, false, 'isArchived is not false');
});

check('the public webhook is disabled, inert-pathed and deregistered', () => {
  const hooks = S.nodesOfType(SAFE, S.WEBHOOK_TYPE);
  eq(hooks.length, 1, 'webhook node count changed');
  const h = hooks[0];
  eq(h.disabled, true, 'webhook is not disabled');
  eq(h.parameters.path, S.INERT_WEBHOOK_PATH, 'webhook path is not the inert path');
  assert(h.parameters.path !== S.PRODUCTION_WEBHOOK_PATH, 'webhook still serves the production path');
  assert(!Object.prototype.hasOwnProperty.call(h, 'webhookId'), 'inherited webhookId survives');
  // The node KEEPS ITS NAME: connections and $('Webhook') expressions resolve by name.
  eq(h.name, S.nodesOfType(CANON, S.WEBHOOK_TYPE)[0].name, 'the webhook node was renamed, which breaks name references');
});

check('the production endpoint path is absent from the runtime graph', () => {
  const runtime = JSON.stringify({ nodes: SAFE.nodes, connections: SAFE.connections, settings: SAFE.settings });
  assert(runtime.indexOf(S.PRODUCTION_WEBHOOK_PATH) === -1, 'the production path survives in the runtime graph');
});

check('availableInMCP is false and settings are otherwise unchanged', () => {
  eq(SAFE.settings.availableInMCP, false, 'availableInMCP is not false');
  eq(JSON.stringify(SAFE.settings), JSON.stringify(CANON.settings), 'settings changed');
});

check('no new node, no new Telegram node, no new public endpoint', () => {
  eq(SAFE.nodes.length, CANON.nodes.length, 'node count changed');
  eq(SAFE.nodes.length, 100, 'the audited graph is no longer 100 nodes');
  eq(S.nodesOfType(SAFE, S.TELEGRAM_TYPE).length, S.nodesOfType(CANON, S.TELEGRAM_TYPE).length,
    'Telegram node count changed');
  eq(S.nodesOfType(SAFE, S.WEBHOOK_TYPE).filter((n) => n.disabled !== true).length, 0,
    'an enabled webhook node exists');
});

check('no credential secret material is introduced', () => {
  // Credential REFERENCES (id + name) are legitimate and must survive untouched. Anything
  // that looks like a secret value is not.
  CANON.nodes.forEach((cn) => {
    const sn = SAFE.nodes.find((n) => n.name === cn.name);
    assert(sn, 'node missing: ' + cn.name);
    eq(JSON.stringify(sn.credentials), JSON.stringify(cn.credentials), 'credentials changed on ' + cn.name);
  });
  const forbidden =/"(access_?token|refresh_?token|client_?secret|api_?key|password|bot_?token)"\s*:/i;
  assert(!forbidden.test(safeRaw), 'a credential-shaped key appears in the artifact');
});

// ================================================================ 3. fidelity

console.log('\n-- fidelity to the canonical candidate --');

check('every Code node body is byte-identical', () => {
  const codeNodes = S.nodesOfType(CANON, S.CODE_TYPE);
  assert(codeNodes.length > 0, 'no code nodes found');
  eq(codeNodes.length, 44, 'the code node count drifted');
  let bytes = 0;
  codeNodes.forEach((cn) => {
    const sn = SAFE.nodes.find((n) => n.name === cn.name);
    assert(sn, 'code node missing: ' + cn.name);
    eq(sn.parameters.jsCode, cn.parameters.jsCode, 'jsCode differs for ' + cn.name);
    bytes += String(cn.parameters.jsCode).length;
  });
  eq(bytes, 98890, 'the total Code body size drifted from the audited 98,890 characters');
});

check('connections are byte-identical', () => {
  eq(JSON.stringify(SAFE.connections), JSON.stringify(CANON.connections), 'connections differ');
});

check('every non-webhook node is byte-identical', () => {
  const hookNames = new Set(S.nodesOfType(CANON, S.WEBHOOK_TYPE).map((n) => n.name));
  CANON.nodes.forEach((cn) => {
    if (hookNames.has(cn.name)) { return; }
    const sn = SAFE.nodes.find((n) => n.name === cn.name);
    assert(sn, 'node missing: ' + cn.name);
    eq(JSON.stringify(sn), JSON.stringify(cn), 'node changed: ' + cn.name);
  });
});

check('the residual diff equals the approved transformation exactly', () => {
  // The closure check. Not "the properties I thought to test are fine" but "these are the
  // ONLY differences that exist anywhere in 425 KB".
  let approved = S.APPROVED_DIFF_PATHS.slice();
  S.webhookNodeIndexes(CANON).forEach((i) => { approved = approved.concat(S.webhookDiffPaths(i)); });
  const approvedSet = new Set(approved);
  const actual = S.diffPaths(CANON, SAFE);
  const unexpected = actual.filter((p) => !approvedSet.has(p));
  eq(unexpected.length, 0, 'unapproved differences: ' + unexpected.join(', '));
  // ...and the approved changes actually happened, so the list cannot pass by being unused.
  ['id', 'activeVersion', 'shared', 'name', 'active'].forEach((p) => {
    assert(actual.indexOf(p) !== -1, 'expected a difference at ' + p + ' and found none');
  });
});

// ================================================================ 4. the internal route

console.log('\n-- the internal route stands without the webhook --');

check('exactly one executeWorkflowTrigger, correctly named', () => {
  const t = SAFE.nodes.filter((n) => n.type === S.INTERNAL_TRIGGER_TYPE);
  eq(t.length, 1, 'wrong number of executeWorkflowTrigger nodes');
  eq(t[0].name, S.INTERNAL_TRIGGER_NAME, 'the internal trigger is misnamed');
  assert(t[0].disabled !== true, 'the internal trigger is disabled');
});

check('Internal Auth Entry is reachable with the webhook node removed entirely', () => {
  // Stronger than "disabled": excluded from the graph. If the internal route still stands,
  // it provably does not depend on the public entry point.
  const reach = S.reachableFromInternal(SAFE, { exclude: ['Webhook'] });
  assert(reach.has(S.INTERNAL_AUTH_ENTRY), 'Internal Auth Entry unreachable');
  assert(!reach.has('Webhook'), 'the webhook node is reachable from the internal trigger');
});

check('both internal success and internal failure terminals are reachable', () => {
  const reach = S.reachableFromInternal(SAFE, { exclude: ['Webhook'] });
  const results = SAFE.nodes.map((n) => n.name).filter((n) => /^Internal Result \(/.test(n));
  assert(results.length >= 10, 'expected the full set of Internal Result terminals, found ' + results.length);
  results.forEach((n) => assert(reach.has(n), 'unreachable internal terminal: ' + n));
  // Named explicitly so a rename cannot quietly drop one side of the contract.
  ['Internal Result (New)', 'Internal Result (Merge)', 'Internal Result (Retry)'].forEach((n) =>
    assert(reach.has(n), 'missing internal SUCCESS terminal: ' + n));
  ['Internal Result (Fault)', 'Internal Result (Invalid)', 'Internal Result (Infra)',
    'Internal Result (Unresolved)'].forEach((n) =>
    assert(reach.has(n), 'missing internal FAILURE terminal: ' + n));
});

check('no internal route terminates in a RespondToWebhook', () => {
  const reach = S.reachableFromInternal(SAFE, { exclude: ['Webhook'] });
  const reached = S.nodesOfType(SAFE, S.RESPOND_TYPE).map((n) => n.name).filter((n) => reach.has(n));
  eq(reached.length, 0, 'internal route reaches: ' + reached.join(', '));
});

check('every RespondToWebhook is fed ONLY from an IF Internal false branch', () => {
  // The structural form of the claim above. Reachability shows it for the current wiring;
  // this shows it holds by construction, which is what survives a future edit.
  const g = S.respondNodesAreGatedOff(SAFE);
  eq(g.badEdges.length, 0, 'ungated edges into a responder: ' + g.badEdges.join(' ; '));
  eq(g.unfed.length, 0, 'responder with no inbound edge: ' + g.unfed.join(', '));
  eq(S.nodesOfType(SAFE, S.RESPOND_TYPE).length, 7, 'the responder count drifted');
});

check('no Telegram and no AI node is reachable on the internal route', () => {
  // Worth pinning, because a naive BFS says the opposite. Following BOTH outputs of every
  // IF gate "reaches" all four Telegram nodes and the OpenAI node from the internal trigger.
  // The runtime does not: the internal route terminates at an Internal Result (*) node before
  // the alert/AI fan-out. This is the difference between a canary run that pages the owner
  // and one that does not, so it is asserted rather than assumed.
  const reach = S.reachableFromInternal(SAFE, { exclude: ['Webhook'] });
  const tg = S.nodesOfType(SAFE, S.TELEGRAM_TYPE).map((n) => n.name).filter((n) => reach.has(n));
  eq(tg.length, 0, 'internal route reaches Telegram node(s): ' + tg.join(', '));
  const ai = S.nodesOfType(SAFE, '@n8n/n8n-nodes-langchain.openAi').map((n) => n.name).filter((n) => reach.has(n));
  eq(ai.length, 0, 'internal route reaches AI node(s): ' + ai.join(', '));
  // The four Telegram nodes still EXIST -- they are inherited production nodes and removing
  // them would be a semantic change. Gated off, not deleted.
  eq(S.nodesOfType(SAFE, S.TELEGRAM_TYPE).length, 4, 'the inherited Telegram node count changed');
});

check('the internal route writes only where P6 expects it to', () => {
  // The downstream side-effect surface the owner is consenting to when they exercise this
  // canary: the Pipeline sheet and the receipt Data Table. Nothing else.
  const reach = S.reachableFromInternal(SAFE, { exclude: ['Webhook'] });
  const sheetWrites = S.nodesOfType(SAFE, 'n8n-nodes-base.googleSheets')
    .filter((n) => reach.has(n.name))
    .filter((n) => ['append', 'update', 'appendOrUpdate'].indexOf((n.parameters || {}).operation) !== -1)
    .map((n) => n.name).sort();
  eq(sheetWrites.join(' | '), 'Save to Pipeline | Update Pipeline (Merge)',
    'the internal route sheet-write surface changed');
  const dt = S.nodesOfType(SAFE, 'n8n-nodes-base.dataTable').filter((n) => reach.has(n.name));
  eq(dt.length, 5, 'the internal route Data Table surface changed');
});

check('the public route is unreachable from the internal trigger at its entry', () => {
  // Validate Payload is shared by both routes by design; the WEBHOOK itself is not, and that
  // is the boundary that matters.
  const reach = S.reachableFromInternal(SAFE, {});
  assert(!reach.has('Webhook'), 'the webhook is reachable from the internal trigger');
});

// ================================================================ 5. mutation battery

console.log('\n-- mutation battery: every corrupted wrapper must be rejected --');

function mustReject(label, mutate, expectSubstring) {
  check('MUTATION rejected: ' + label, () => {
    const m = clone(SAFE);
    mutate(m);
    const v = S.verifyImportSafe(CANON, m);
    assert(!v.ok, 'the verifier ACCEPTED a mutated artifact');
    if (expectSubstring) {
      assert(v.failures.some((f) => f.indexOf(expectSubstring) !== -1),
        'rejected, but not for the expected reason. failures: ' + v.failures.join(' | '));
    }
  });
}

// --- the six the brief requires ---
mustReject('production workflow id restored', (m) => { m.id = S.PRODUCTION_WORKFLOW_ID; }, 'id');
mustReject('active = true', (m) => { m.active = true; }, 'active');
mustReject('production webhook path restored', (m) => {
  m.nodes[hookIndex()].parameters.path = S.PRODUCTION_WEBHOOK_PATH;
}, 'production path');
mustReject('webhook re-enabled', (m) => { m.nodes[hookIndex()].disabled = false; }, 'not disabled');
mustReject('one byte of a Code body changed', (m) => {
  const n = m.nodes.find((x) => x.type === S.CODE_TYPE);
  n.parameters.jsCode = n.parameters.jsCode + ' ';
}, 'jsCode differs');
mustReject('one connection changed', (m) => {
  const key = Object.keys(m.connections)[0];
  m.connections[key].main[0].push({ node: 'Respond New Lead', type: 'main', index: 0 });
}, 'connections');

// --- the hazards the brief did not list ---
mustReject('shadow graph copy (activeVersion) restored', (m) => {
  m.activeVersion = clone(CANON.activeVersion);
}, 'activeVersion');
mustReject('sharing record (shared) restored', (m) => { m.shared = clone(CANON.shared); }, 'shared');
mustReject('production id smuggled into a different top-level field', (m) => {
  m.description = 'derived from ' + S.PRODUCTION_WORKFLOW_ID;
}, S.PRODUCTION_WORKFLOW_ID);
mustReject('inherited webhookId restored', (m) => {
  m.nodes[hookIndex()].webhookId = 'e0ce5df2-f4cd-4b72-b2ac-4f44686a6be4';
}, 'webhookId');

// --- further semantic drift ---
mustReject('availableInMCP enabled', (m) => { m.settings.availableInMCP = true; }, 'availableInMCP');
mustReject('a credential reference swapped', (m) => {
  const n = m.nodes.find((x) => x.credentials && x.credentials.googleSheetsOAuth2Api);
  n.credentials.googleSheetsOAuth2Api = { id: 'XXXXXXXXXXXXXXXX', name: 'Someone else' };
}, 'credential reference changed');
mustReject('a new Telegram node added', (m) => {
  m.nodes.push({ parameters: {}, name: 'Telegram Smuggled', type: S.TELEGRAM_TYPE, typeVersion: 1, position: [0, 0] });
}, 'Telegram node count changed');
mustReject('a node deleted', (m) => {
  const i = m.nodes.findIndex((x) => x.name === 'Internal Result (New)');
  m.nodes.splice(i, 1);
}, 'node count changed');
mustReject('a responder wired in from outside an IF Internal gate', (m) => {
  m.connections['Internal Auth Entry'].main[0].push({ node: 'Respond New Lead', type: 'main', index: 0 });
}, 'connections');
mustReject('the workflow renamed away from the canary name', (m) => { m.name = 'FINMENTOR Lead Intake'; }, 'name');

// --- and the control: the unmutated artifact is accepted, so the battery is not vacuous ---
check('CONTROL: the unmutated artifact is accepted', () => {
  const v = S.verifyImportSafe(CANON, clone(SAFE));
  assert(v.ok, 'the verifier rejects the real artifact: ' + v.failures.join(' | '));
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
