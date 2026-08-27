#!/usr/bin/env node
// FINMENTOR — P7.3 safe manual-import artifact gate for the Concierge issuer.
//
//   node qa/concierge-import-safe.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. The owner is going to hand-import a Concierge workflow JSON into live
// n8n. The Concierge is on the path of every Telegram update, and its trigger is bound to the
// SAME bot credential as the running production bot. Telegram allows one webhook per bot
// token, and a second registration silently replaces the first -- so an imported copy that
// could be activated is not a collision that fails loudly, it is a takeover of every client
// message that fails silently. The only thing standing between that and the owner's click is
// that the file being imported is the WRAPPER, not the canonical audited candidate, and that
// the wrapper genuinely cannot start.
//
// Five claims, in order of how much they matter:
//
//   1. The canonical candidate STILL CARRIES the hazards, and the takeover premise is real --
//      proven against the PRODUCTION export, not asserted. If it ever stops being true the
//      wrapper's reasoning has changed, and that must fail loudly rather than pass vacuously.
//   2. The tracked IMPORT-SAFE file on disk is import-safe, and is not stale relative to the
//      generator.
//   3. The wrapper differs from the canonical ONLY by the approved transformation -- proven by
//      an exhaustive residual diff pinned to an exact 19-path list, not by re-running the
//      transform.
//   4. The ISSUER SURVIVED the wrapper. A canary that lost the mint on the way through would
//      run green and prove nothing about P7.2.
//   5. The REST-API projection is a faithful four-field subset of the wrapper -- and the two
//      guards the endpoint's schema TAKES AWAY (`active: false` and the `meta` warning) are
//      named in the gate output rather than lost quietly, leaving the disabled trigger inside
//      `nodes` as the only guard that reaches the server.
//
// Then two mutation batteries: 28 deliberately corrupted wrappers and 7 corrupted projections,
// every one of which the matching verifier must reject, plus the worst input of all -- the
// canonical candidate fed to the projection as if it were the wrapper. A verifier that cannot
// fail is not a verifier.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const S = require(join(ROOT, 'n8n', 'src', 'concierge-import-safe', 'concierge-import-safe.js'));
const A = require(join(ROOT, 'n8n', 'src', 'concierge-api-import', 'concierge-api-import.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const deepEq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(m + ' (got ' + JSON.stringify(a).slice(0, 200) + ')');
  }
};

const CANON_PATH = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const SAFE_PATH = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json');
const PROD_PATH = join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json');

const canonRaw = readFileSync(CANON_PATH, 'utf8');
const safeRaw = readFileSync(SAFE_PATH, 'utf8');
const CANON = JSON.parse(canonRaw);
const SAFE = JSON.parse(safeRaw);
const PROD = JSON.parse(readFileSync(PROD_PATH, 'utf8'));

const clone = (v) => JSON.parse(JSON.stringify(v));
const trigIndex = () => S.triggerNodeIndexes(SAFE)[0];

// The EXACT residual diff. Written out rather than derived, so that adding a path to
// APPROVED_DIFF_PATHS cannot silently widen what this gate accepts -- a new approved path has
// to be added HERE too, by hand, which is the moment a reader gets to object.
const EXPECTED_DIFF = [
  'active',
  'activeVersionId',
  'createdAt',
  'id',
  'meta.finmentor_activation_hazard',
  'meta.finmentor_import_hazard',
  'meta.finmentor_import_safe',
  'meta.finmentor_import_safe_generated_by',
  'meta.finmentor_not_deployed',
  'meta.finmentor_source_export',
  'name',
  'nodes[0].disabled',
  'nodes[0].webhookId',
  'shared',
  'sourceWorkflowId',
  'triggerCount',
  'updatedAt',
  'versionCounter',
  'versionId'
];

// ================================================================ 1. the hazards are real

console.log('\n-- the canonical candidate is genuinely unsafe to hand-import --');

check('canonical carries the production workflow id', () => {
  eq(CANON.id, S.PRODUCTION_WORKFLOW_ID, 'canonical id is not the production id');
});

check('canonical carries active = true', () => {
  eq(CANON.active, true, 'canonical is no longer active:true');
});

check('canonical carries exactly one trigger, and it is the live Telegram trigger', () => {
  const trigs = S.triggerNodes(CANON);
  eq(trigs.length, 1, 'canonical does not have exactly one trigger node');
  eq(trigs[0].type, S.TELEGRAM_TRIGGER_TYPE, 'the sole trigger is not a telegramTrigger');
  eq(trigs[0].name, S.TRIGGER_NODE_NAME, 'the sole trigger is not the expected node');
  assert(trigs[0].disabled !== true, 'canonical trigger is already disabled');
});

check('canonical trigger carries the PRODUCTION registration id', () => {
  const t = S.nodeByName(CANON, S.TRIGGER_NODE_NAME);
  eq(t.webhookId, S.PRODUCTION_TRIGGER_WEBHOOK_ID, 'canonical trigger webhookId is not production\'s');
  const p = S.nodeByName(PROD, S.TRIGGER_NODE_NAME);
  eq(p.webhookId, S.PRODUCTION_TRIGGER_WEBHOOK_ID, 'the LIVE trigger webhookId changed');
});

check('THE TAKEOVER PREMISE: the candidate trigger shares the LIVE bot credential', () => {
  // This is the fact the whole wrapper is built around, and it is checked against the
  // production export rather than asserted in prose. Same credential id => same bot token =>
  // activating a copy re-points the bot at the copy, silently.
  const c = S.nodeByName(CANON, S.TRIGGER_NODE_NAME);
  const p = S.nodeByName(PROD, S.TRIGGER_NODE_NAME);
  deepEq(c.credentials, p.credentials, 'candidate and live trigger credentials diverged');
  eq(c.credentials.telegramApi.id, S.BOT_CREDENTIAL_ID, 'the bot credential id changed');
});

check('canonical carries the sharing record, with owner identity in it', () => {
  assert(Array.isArray(CANON.shared) && CANON.shared.length === 1, 'canonical has no shared record');
  eq(CANON.shared[0].workflowId, S.PRODUCTION_WORKFLOW_ID, 'shared does not carry the production id');
  const blob = JSON.stringify(CANON.shared);
  assert(/creatorId/.test(blob), 'shared no longer carries a creatorId');
  assert(/@finmentor\.md/.test(blob), 'shared no longer carries the owner email');
});

check('canonical already has NO activeVersion, but production does', () => {
  // The candidate generator strips the shadow graph copy, so this module inherits nothing to
  // do there. The strip list keeps `activeVersion` anyway; this check is what would notice a
  // re-export putting it back.
  assert(!Object.prototype.hasOwnProperty.call(CANON, 'activeVersion'),
    'the candidate reintroduced activeVersion -- the wrapper must be re-read');
  assert(Object.prototype.hasOwnProperty.call(PROD, 'activeVersion'),
    'the production export no longer carries activeVersion; the stripping rationale changed');
});

check('canonical declares itself NOT import-safe', () => {
  eq(CANON.meta.finmentor_not_deployed, true, 'candidate no longer says not-deployed');
  assert(/NOT IMPORT-SAFE/.test(String(CANON.meta.finmentor_import_hazard)),
    'candidate no longer carries the import hazard warning');
  assert(String(CANON.meta.finmentor_import_hazard).includes(S.PRODUCTION_WORKFLOW_ID),
    'the hazard string no longer names the production id -- it is a diff path for that reason');
});

// ================================================================ 2. the artifact on disk

console.log('\n-- the tracked IMPORT-SAFE artifact --');

check('IMPORT-SAFE is not stale: regeneration is byte-identical', () => {
  const regenerated = S.serializeImportSafe(S.buildImportSafe(CANON));
  eq(regenerated, safeRaw, 'the tracked file differs from a fresh build -- re-run the generator');
});

check('IMPORT-SAFE keeps the repo serialisation convention', () => {
  assert(safeRaw.endsWith('}\n'), 'no trailing newline');
  assert(/\n {2}"name":/.test(safeRaw), 'not 2-space indented');
});

check('the on-disk pair verifies', () => {
  const v = S.verifyImportSafe(CANON, SAFE);
  assert(v.ok, 'verification failed: ' + v.failures.join(' | '));
});

check('building IMPORT-SAFE does not mutate the canonical in memory', () => {
  const before = JSON.stringify(CANON);
  S.buildImportSafe(CANON);
  eq(JSON.stringify(CANON), before, 'buildImportSafe mutated its input');
});

// ================================================================ 3. identity is gone

console.log('\n-- production identity does not survive the wrapper --');

check('every stripped top-level field is absent', () => {
  S.STRIPPED_TOP_LEVEL.forEach((k) => {
    assert(!Object.prototype.hasOwnProperty.call(SAFE, k), 'still present: ' + k);
  });
});

check('the production workflow id appears nowhere in the document', () => {
  eq(JSON.stringify(SAFE).indexOf(S.PRODUCTION_WORKFLOW_ID), -1, 'production id survives');
});

check('the production trigger registration id appears nowhere in the document', () => {
  eq(JSON.stringify(SAFE).indexOf(S.PRODUCTION_TRIGGER_WEBHOOK_ID), -1, 'production webhookId survives');
});

check('no creatorId and no owner email address survive', () => {
  const blob = JSON.stringify(SAFE);
  assert(!/creatorId/.test(blob), 'a creatorId survives');
  assert(!/@finmentor\.md/.test(blob), 'an owner email survives');
});

check('the wrapper carries a distinct name and an inert lifecycle', () => {
  eq(SAFE.name, S.IMPORT_SAFE_NAME, 'not the canary name');
  assert(SAFE.name !== CANON.name, 'the wrapper is indistinguishable from the candidate by name');
  eq(SAFE.active, false, 'active is not exactly false');
  eq(SAFE.isArchived, false, 'isArchived is not exactly false');
});

// ================================================================ 4. THE INTERLOCK

console.log('\n-- the interlock: this file cannot start --');

check('the Telegram trigger is disabled', () => {
  const t = S.nodeByName(SAFE, S.TRIGGER_NODE_NAME);
  eq(t.disabled, true, 'the trigger is not disabled');
});

check('the trigger no longer carries an inherited webhookId', () => {
  const t = S.nodeByName(SAFE, S.TRIGGER_NODE_NAME);
  assert(!Object.prototype.hasOwnProperty.call(t, 'webhookId'), 'the trigger kept a webhookId');
});

check('ZERO enabled trigger nodes -- the artifact is not activatable', () => {
  // The property that matters. Not "the telegram trigger is off" but "nothing in this file
  // can begin an execution", which is what makes the bot binding unreachable by activation.
  eq(S.enabledTriggerNodes(SAFE).length, 0,
    'enabled triggers: ' + S.enabledTriggerNodes(SAFE).map((n) => n.name).join(', '));
  eq(S.triggerNodes(SAFE).length, 1, 'the trigger node itself was removed rather than disabled');
});

check('the trigger KEEPS its parameters and its bot credential, by design', () => {
  const c = S.nodeByName(CANON, S.TRIGGER_NODE_NAME);
  const t = S.nodeByName(SAFE, S.TRIGGER_NODE_NAME);
  deepEq(t.parameters, c.parameters, 'trigger parameters were modified');
  deepEq(t.credentials, c.credentials, 'trigger credential was modified');
  eq(t.credentials.telegramApi.id, S.BOT_CREDENTIAL_ID, 'the bot credential is not the expected one');
});

check('exactly one node still carries a webhookId, and it is the ACTION node', () => {
  const bearers = SAFE.nodes
    .filter((n) => Object.prototype.hasOwnProperty.call(n, 'webhookId')).map((n) => n.name).sort();
  deepEq(bearers, S.WEBHOOK_ID_BEARING_NODES.slice().sort(), 'unexpected webhookId bearers');
  eq(S.nodeByName(SAFE, bearers[0]).type, S.TELEGRAM_TYPE, 'the bearer is not a telegram action node');
  assert(!S.isTriggerType(S.nodeByName(SAFE, bearers[0]).type), 'the bearer is a trigger type');
});

check('the activation hazard travels with the file', () => {
  eq(SAFE.meta.finmentor_import_safe, true, 'meta.finmentor_import_safe is not true');
  eq(SAFE.meta.finmentor_not_deployed, false, 'meta.finmentor_not_deployed is not false');
  eq(SAFE.meta.finmentor_import_safe_generated_by, S.IMPORT_SAFE_GENERATOR, 'generator not named');
  assert(!Object.prototype.hasOwnProperty.call(SAFE.meta, 'finmentor_import_hazard'),
    'the NOT-IMPORT-SAFE warning is still on the import-safe file');
  const h = String(SAFE.meta.finmentor_activation_hazard);
  assert(/DO NOT ACTIVATE/.test(h), 'the hazard note does not say DO NOT ACTIVATE');
  assert(/DO NOT ENABLE/.test(h), 'the hazard note does not warn against re-enabling the trigger');
  assert(/one webhook per bot token/.test(h), 'the hazard note does not state the mechanism');
});

check('the source-export provenance no longer smuggles the production id', () => {
  const v = String(SAFE.meta.finmentor_source_export);
  assert(v.length > 0, 'provenance was deleted rather than rewritten');
  assert(!v.includes(S.PRODUCTION_WORKFLOW_ID), 'provenance still names the production id');
  assert(v.startsWith('finmentor-telegram-client-concierge'), 'provenance no longer names the export');
});

// ================================================================ 5. graph fidelity

console.log('\n-- the graph is byte-faithful to the audited candidate --');

check('node count and per-type census are unchanged', () => {
  eq(SAFE.nodes.length, CANON.nodes.length, 'node count changed');
  eq(SAFE.nodes.length, 45, 'the candidate is no longer 45 nodes');
  deepEq(S.typeCensus(SAFE), S.typeCensus(CANON), 'the type census changed');
});

check('connections are byte-identical', () => {
  deepEq(SAFE.connections, CANON.connections, 'connections changed');
});

check('every Code body is byte-identical', () => {
  const codes = S.nodesOfType(CANON, S.CODE_TYPE);
  eq(codes.length, 21, 'the candidate no longer has 21 Code nodes');
  codes.forEach((cn) => {
    const sn = S.nodeByName(SAFE, cn.name);
    assert(sn, 'missing code node ' + cn.name);
    eq(sn.parameters.jsCode, cn.parameters.jsCode, 'jsCode differs on ' + cn.name);
  });
});

check('every credential reference is byte-identical, node for node', () => {
  CANON.nodes.forEach((cn) => {
    const sn = S.nodeByName(SAFE, cn.name);
    assert(sn, 'missing node ' + cn.name);
    deepEq(sn.credentials, cn.credentials, 'credentials changed on ' + cn.name);
  });
});

check('every node PARAMETER is byte-identical -- the wrapper rewrites none', () => {
  // Stronger than P6.1, which had to rewrite the webhook path. Asserted so the stronger
  // guarantee is visible rather than buried in the residual diff.
  CANON.nodes.forEach((cn) => {
    const sn = S.nodeByName(SAFE, cn.name);
    deepEq(sn.parameters, cn.parameters, 'parameters changed on ' + cn.name);
  });
});

check('settings are byte-identical, MCP exposure still off', () => {
  deepEq(SAFE.settings, CANON.settings, 'settings changed');
  eq(SAFE.settings.availableInMCP, false, 'availableInMCP is not false');
  eq(SAFE.settings.errorWorkflow, 'RBiFLhVjizMkAzrK', 'the error workflow binding changed');
});

// ================================================================ 6. the issuer survived

console.log('\n-- P7.2 survived the wrapper --');

check('all thirteen issuer nodes are present', () => {
  eq(S.ISSUER_NODES.length, 13, 'the issuer node list changed size');
  S.ISSUER_NODES.forEach((n) => { assert(S.nodeByName(SAFE, n), 'missing issuer node ' + n); });
});

check('both Data Table nodes survive, still bound to Submission_Receipts', () => {
  const dts = S.nodesOfType(SAFE, S.DATA_TABLE_TYPE);
  eq(dts.length, 2, 'not exactly two Data Table nodes');
  dts.forEach((n) => {
    eq(n.parameters.dataTableId.value, 'Submission_Receipts', 'wrong data table on ' + n.name);
  });
});

check('the submission_key reference count is preserved and non-zero', () => {
  const c = JSON.stringify(CANON.nodes).split('submission_key').length - 1;
  const s = JSON.stringify(SAFE.nodes).split('submission_key').length - 1;
  assert(s > 0, 'the wrapper has no submission_key references at all');
  eq(s, c, 'submission_key reference count changed');
});

check('the mint still lies on a path from the gate to the authority write', () => {
  const r = S.reachableFrom(SAFE, 'Issuance Gate');
  ['Receipt Preallocate', 'Receipt Readback', 'Issuance Verdict', S.AUTHORITY_NODE].forEach((n) => {
    assert(r.has(n), n + ' unreachable from Issuance Gate');
  });
});

check('the live-effect surfaces are deliberately NOT neutralised', () => {
  // Declared, not incidental. A wrapper that pointed these at fixtures would make the P7.3
  // canary prove nothing about production, so their survival is a requirement, not an
  // oversight -- and it is what docs/P7_3_IMPORT_SAFE_WRAPPER.md warns the owner about.
  eq(S.nodesOfType(SAFE, S.SHEETS_TYPE).length, 7, 'the Google Sheets nodes changed in number');
  S.nodesOfType(SAFE, S.SHEETS_TYPE).forEach((n) => {
    eq(n.parameters.documentId.value, '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A',
      'sheet target changed on ' + n.name);
  });
  eq(S.nodesOfType(SAFE, S.EXECUTE_WORKFLOW_TYPE).length, 3, 'the transport callers changed in number');
  S.nodesOfType(SAFE, S.EXECUTE_WORKFLOW_TYPE).forEach((n) => {
    eq(n.parameters.workflowId.value, 'ShcmmJeLSE8LYVBk', 'transport target changed on ' + n.name);
  });
  eq(S.nodesOfType(SAFE, S.HTTP_TYPE).length, 1, 'the intake caller changed in number');
});

// ================================================================ 7. the residual diff

console.log('\n-- the exhaustive residual diff --');

check('the wrapper differs from the candidate at EXACTLY nineteen paths', () => {
  const actual = S.diffPaths(CANON, SAFE).sort();
  deepEq(actual, EXPECTED_DIFF, 'the residual diff is not the pinned set: ' + actual.join(', '));
});

check('every actual difference is in the approved set', () => {
  let approved = S.APPROVED_DIFF_PATHS.slice();
  S.triggerNodeIndexes(CANON).forEach((i) => { approved = approved.concat(S.triggerDiffPaths(i)); });
  const set = new Set(approved);
  const bad = S.diffPaths(CANON, SAFE).filter((p) => !set.has(p));
  eq(bad.length, 0, 'unapproved differences: ' + bad.join(', '));
});

check('the trigger is the only node touched at all', () => {
  const nodePaths = S.diffPaths(CANON, SAFE).filter((p) => p.startsWith('nodes['));
  deepEq(nodePaths.sort(), S.triggerDiffPaths(trigIndex()).sort(), 'a node other than the trigger changed');
  eq(trigIndex(), 0, 'the trigger is no longer node 0');
});

// ================================================================ 8. mutation battery

console.log('\n-- the verifier rejects every corrupted wrapper --');

function mustReject(label, mutate, expectSubstring) {
  check('REJECTS: ' + label, () => {
    const m = clone(SAFE);
    mutate(m);
    const v = S.verifyImportSafe(CANON, m);
    assert(!v.ok, 'the verifier ACCEPTED a wrapper with: ' + label);
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'rejected, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

// --- the interlock ---
mustReject('the trigger re-enabled by deleting `disabled`', (m) => {
  delete m.nodes[0].disabled;
}, 'ENABLED trigger node');
mustReject('the trigger re-enabled by setting disabled=false', (m) => {
  m.nodes[0].disabled = false;
}, 'ENABLED trigger node');
mustReject('a SECOND, enabled trigger smuggled in', (m) => {
  m.nodes.push({
    parameters: {}, id: 'x', name: 'Schedule Smuggled',
    type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0]
  });
}, 'ENABLED trigger node');
mustReject('an enabled webhook node added as an alternate entry', (m) => {
  m.nodes.push({
    parameters: { path: 'back-door' }, id: 'y', name: 'Back Door',
    type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0]
  });
}, 'ENABLED trigger node');
mustReject('a LEGACY trigger type that does not end in "Trigger"', (m) => {
  // n8n-nodes-base.cron is a trigger whose type name the suffix rule alone would miss. It is
  // in NON_SUFFIXED_TRIGGER_TYPES for that reason, and this is what proves the list is wired
  // in rather than decorative.
  m.nodes.push({
    parameters: {}, id: 'z', name: 'Cron Smuggled',
    type: 'n8n-nodes-base.cron', typeVersion: 1, position: [0, 0]
  });
}, 'ENABLED trigger node');
mustReject('THE CENSUS BACKSTOP: a node of a type isTriggerType cannot recognise', (m) => {
  // The honest limit of the heuristic, and the check that closes it. An unrecognised type is
  // not caught by the interlock -- it is caught because the wrapper's per-type node census
  // must equal the candidate's exactly, so no node of any type can be added at all.
  const t = 'n8n-nodes-base.someFutureEntryPointNamedNothingLikeOne';
  assert(!S.isTriggerType(t), 'this mutation is vacuous: the heuristic already recognises the type');
  m.nodes.push({ parameters: {}, id: 'w', name: 'Unknown Entry', type: t, typeVersion: 1, position: [0, 0] });
}, 'type census changed');
mustReject('the production registration id restored on the trigger', (m) => {
  m.nodes[0].webhookId = S.PRODUCTION_TRIGGER_WEBHOOK_ID;
}, 'still carries an inherited webhookId');
mustReject('the trigger node deleted rather than disabled', (m) => {
  m.nodes.splice(0, 1);
}, 'trigger node count changed');

// --- identity ---
mustReject('the production workflow id restored at top level', (m) => {
  m.id = S.PRODUCTION_WORKFLOW_ID;
}, 'must be absent from IMPORT-SAFE: id');
mustReject('the production id hidden in a meta string', (m) => {
  m.meta.finmentor_source_export = S.PRODUCTION_WORKFLOW_ID + '.export.json';
}, 'still appears in IMPORT-SAFE');
mustReject('the sharing record restored', (m) => {
  m.shared = clone(CANON.shared);
}, 'must be absent from IMPORT-SAFE: shared');
mustReject('active flipped back to true', (m) => { m.active = true; }, 'active must be exactly false');
mustReject('isArchived flipped to true', (m) => { m.isArchived = true; }, 'isArchived must be exactly false');
mustReject('the candidate name kept, so the import is indistinguishable', (m) => {
  m.name = CANON.name;
}, 'did not change name');

// --- the warning ---
mustReject('the NOT-IMPORT-SAFE warning left on the file', (m) => {
  m.meta.finmentor_import_hazard = 'NOT IMPORT-SAFE';
}, 'must be removed');
mustReject('the activation hazard note deleted', (m) => {
  delete m.meta.finmentor_activation_hazard;
}, 'finmentor_activation_hazard is missing');
mustReject('the activation hazard note softened', (m) => {
  m.meta.finmentor_activation_hazard = 'be careful';
}, 'finmentor_activation_hazard is missing or altered');
mustReject('meta.finmentor_import_safe claimed while not deployed-safe', (m) => {
  m.meta.finmentor_import_safe = 'yes';
}, 'must be exactly true');

// --- fidelity ---
mustReject('one byte changed in a Code body', (m) => {
  const n = m.nodes.find((x) => x.name === 'Issuance Gate');
  n.parameters.jsCode = n.parameters.jsCode + ' ';
}, 'jsCode differs');
mustReject('a connection rewired', (m) => {
  m.connections['IF Lead Ready'].main[0].push({ node: 'Save Bot Event', type: 'main', index: 0 });
}, 'connections are not byte-identical');
mustReject('a credential reference swapped', (m) => {
  const n = m.nodes.find((x) => x.credentials && x.credentials.googleSheetsOAuth2Api);
  n.credentials.googleSheetsOAuth2Api = { id: 'XXXXXXXXXXXXXXXX', name: 'Someone else' };
}, 'credential reference changed');
mustReject('the trigger credential STRIPPED -- the guard is `disabled`, not absence', (m) => {
  delete m.nodes[0].credentials;
}, 'credential reference was modified');
mustReject('a node parameter rewritten', (m) => {
  m.nodes.find((x) => x.name === 'Read Bot Sessions').parameters.options = { rangeDefinition: 'x' };
}, 'parameters changed on node');
mustReject('MCP exposure enabled', (m) => { m.settings.availableInMCP = true; }, 'settings changed');
mustReject('the error workflow binding removed', (m) => {
  delete m.settings.errorWorkflow;
}, 'settings changed');

// --- the issuer ---
mustReject('a Data Table node dropped -- the canary would prove nothing', (m) => {
  const i = m.nodes.findIndex((x) => x.name === 'Receipt Preallocate');
  m.nodes.splice(i, 1);
}, 'issuer node missing from IMPORT-SAFE: Receipt Preallocate');
mustReject('submission_key scrubbed from the preallocation', (m) => {
  const n = m.nodes.find((x) => x.name === 'Receipt Preallocate');
  delete n.parameters.columns.value.submission_key;
}, 'submission_key reference count changed');

// --- the null transform ---
mustReject('the null transform: an unmodified copy of the candidate', (m) => {
  Object.keys(m).forEach((k) => { delete m[k]; });
  Object.assign(m, clone(CANON));
}, 'must be absent from IMPORT-SAFE: id');

// --- and the control: the unmutated artifact is accepted, so the battery is not vacuous ---
check('CONTROL: the unmutated artifact is accepted', () => {
  const v = S.verifyImportSafe(CANON, clone(SAFE));
  assert(v.ok, 'the verifier rejects the real artifact: ' + v.failures.join(' | '));
});

// ================================================================ 9. the API projection

console.log('\n-- the REST-API projection, and what the endpoint takes away --');

const API_PATH = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-API-IMPORT.json');
const apiRaw = readFileSync(API_PATH, 'utf8');
const API = JSON.parse(apiRaw);

check('the projection is not stale: regeneration is byte-identical', () => {
  eq(A.serializeApiImport(A.buildApiImport(SAFE)), apiRaw,
    'the tracked projection differs from a fresh build -- re-run the generator');
});

check('the on-disk pair verifies', () => {
  const v = A.verifyApiImport(SAFE, API);
  assert(v.ok, 'verification failed: ' + v.failures.join(' | '));
});

check('exactly the four accepted top-level fields', () => {
  deepEq(Object.keys(API).sort(), A.API_ACCEPTED_FIELDS.slice().sort(), 'wrong field set');
});

check('the four carried fields are byte-identical to the wrapper', () => {
  A.API_ACCEPTED_FIELDS.forEach((k) => { deepEq(API[k], SAFE[k], k + ' diverged from the wrapper'); });
});

check('the residual diff is EXACTLY the seven dropped fields', () => {
  deepEq(S.diffPaths(SAFE, API).sort(), A.DROPPED_FIELDS.slice().sort(),
    'the projection differs somewhere other than the dropped fields');
});

check('every silently-dropped field was inert in the wrapper', () => {
  Object.keys(A.DROPPED_INERT).forEach((k) => {
    eq(JSON.stringify(SAFE[k]), A.DROPPED_INERT[k], 'dropping ' + k + ' is not inert');
  });
});

check('BOTH out-of-graph guards are lost, and it is stated rather than hidden', () => {
  // The point of this check is to make the loss visible in the gate output, not to celebrate
  // it. `active: false` and the DO-NOT-ACTIVATE warning both live outside `nodes`, and the
  // endpoint accepts neither.
  assert(A.DROPPED_EXPLICIT.includes('active'), 'active is no longer a declared explicit drop');
  assert(A.DROPPED_EXPLICIT.includes('meta'), 'meta is no longer a declared explicit drop');
  assert(!Object.prototype.hasOwnProperty.call(API, 'active'), 'active survived; re-read the module');
  assert(!Object.prototype.hasOwnProperty.call(API, 'meta'), 'meta survived; re-read the module');
  eq(SAFE.meta.finmentor_activation_hazard, S.ACTIVATION_HAZARD,
    'the wrapper has no warning to lose -- the projection would be unwarned by accident');
});

check('THE ONLY SURVIVING GUARD: zero enabled triggers inside `nodes`', () => {
  eq(S.enabledTriggerNodes(API).length, 0,
    'enabled triggers in the projection: ' + S.enabledTriggerNodes(API).map((n) => n.name).join(', '));
  const t = S.nodeByName(API, S.TRIGGER_NODE_NAME);
  eq(t.disabled, true, 'the Telegram trigger is not disabled in the projection');
  assert(!Object.prototype.hasOwnProperty.call(t, 'webhookId'), 'the trigger kept a webhookId');
});

check('the projection carries no production identity', () => {
  const blob = JSON.stringify(API);
  eq(blob.indexOf(S.PRODUCTION_WORKFLOW_ID), -1, 'the production id survives the projection');
  eq(blob.indexOf(S.PRODUCTION_TRIGGER_WEBHOOK_ID), -1, 'the production webhookId survives');
});

check('the issuer survives the projection', () => {
  eq(API.nodes.length, A.EXPECTED_NODE_COUNT, 'node count changed');
  S.ISSUER_NODES.forEach((n) => { assert(S.nodeByName(API, n), 'missing issuer node ' + n); });
  eq(S.nodesOfType(API, S.DATA_TABLE_TYPE).length, 2, 'a Data Table node was lost');
  assert(JSON.stringify(API.nodes).includes('submission_key'), 'no submission_key references');
});

check('the post-deploy assertions lead with the interlock', () => {
  // Ordering is load-bearing: it is the one that must be read back before anything else
  // happens to the created workflow.
  assert(A.POST_DEPLOY_ASSERTIONS.length >= 8, 'the post-deploy list was trimmed');
  assert(/ZERO enabled trigger nodes/.test(A.POST_DEPLOY_ASSERTIONS[0]),
    'the first post-deploy assertion is not the interlock: ' + A.POST_DEPLOY_ASSERTIONS[0]);
  const all = A.POST_DEPLOY_ASSERTIONS.join(' | ');
  assert(/active === false/.test(all), 'nothing re-checks the dropped `active`');
  assert(/still active === true and untouched/.test(all), 'nothing checks production survived');
});

console.log('\n-- the projection verifier rejects corrupted projections --');

function mustRejectApi(label, mutate, expectSubstring) {
  check('REJECTS: ' + label, () => {
    const m = clone(API);
    mutate(m);
    const v = A.verifyApiImport(SAFE, m);
    assert(!v.ok, 'the verifier ACCEPTED a projection with: ' + label);
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'rejected, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

mustRejectApi('the trigger re-enabled in the projection', (m) => {
  S.nodeByName(m, S.TRIGGER_NODE_NAME).disabled = false;
}, 'the only surviving guard is gone');
mustRejectApi('the production registration id restored', (m) => {
  S.nodeByName(m, S.TRIGGER_NODE_NAME).webhookId = S.PRODUCTION_TRIGGER_WEBHOOK_ID;
}, 'still carries an inherited webhookId');
mustRejectApi('a fifth top-level field smuggled through', (m) => { m.active = false; }, 'projection fields are');
mustRejectApi('a Code body altered after projection', (m) => {
  S.nodeByName(m, 'Issuance Gate').parameters.jsCode += ' ';
}, 'nodes differs from the wrapper');
mustRejectApi('the name changed after projection', (m) => { m.name = 'something else'; }, 'name differs from the wrapper');
mustRejectApi('MCP exposure enabled after projection', (m) => {
  m.settings.availableInMCP = true;
}, 'settings differs from the wrapper');
mustRejectApi('an issuer node dropped', (m) => {
  const i = m.nodes.findIndex((x) => x.name === 'Receipt Readback');
  m.nodes.splice(i, 1);
}, 'issuer node missing from the projection: Receipt Readback');

check('REJECTS: the CANONICAL candidate fed in as if it were the wrapper', () => {
  // The projection's worst possible input. It would produce a four-field document carrying an
  // ENABLED Telegram trigger bound to the live bot.
  const v = A.verifyApiImport(CANON, A.buildApiImport(CANON));
  assert(!v.ok, 'the verifier ACCEPTED a projection built from the canonical candidate');
  assert(v.failures.some((f) => f.includes('this is not the IMPORT-SAFE wrapper')),
    'rejected, but not for carrying a top-level id: ' + v.failures.join(' | '));
  assert(v.failures.some((f) => f.includes('enabled trigger node')),
    'rejected, but nothing flagged the ENABLED trigger: ' + v.failures.join(' | '));
});

check('CONTROL: the unmutated projection is accepted', () => {
  const v = A.verifyApiImport(SAFE, clone(API));
  assert(v.ok, 'the verifier rejects the real projection: ' + v.failures.join(' | '));
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
