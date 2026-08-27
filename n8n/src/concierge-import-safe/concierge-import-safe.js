// FINMENTOR — P7.3 safe manual-import transformation for the B.2.1-C Concierge issuer.
//
// WHY THIS EXISTS, AND WHY IT IS NOT THE P6.1 MODULE.
//
// n8n/candidate/concierge-issuer-candidate.json is a FAITHFUL derivative of the live
// Concierge export. That faithfulness is what makes its 33 inherited nodes auditable against
// production, and it is also what makes the file dangerous to hand-import. P7.2 §9 said so in
// the artifact itself:
//
//     "it still carries production id mppzthlkSJFr6Kle, active:true and the live Telegram
//      trigger. Hand-importing it OVERWRITES THE RUNNING BOT."
//
// P6.1 built the same kind of wrapper for Lead Intake. This is a SEPARATE module, not a
// parameterisation of that one, because the neutralisation target is different in kind and
// the internal-route reachability proofs in n8n/src/import-safe/import-safe.js are about a
// graph this workflow does not have.
//
// THE HAZARD THE CONCIERGE ADDS, AND WHY IT IS WORSE THAN LEAD INTAKE'S.
//
// Lead Intake's public surface is a Webhook node on a PATH. Two workflows cannot hold the same
// path: n8n's own uniqueness constraint is a backstop, and the failure mode of getting it
// wrong is a refused activation.
//
// The Concierge's public surface is a telegramTrigger bound to credential 2JnVm0BIX0Z8tvBf,
// "FINMENTOR Client Concierge Bot" -- BYTE-IDENTICAL to the credential on the live production
// trigger, verified against n8n/production/mppzthlkSJFr6Kle.*.json. Telegram permits exactly
// ONE registered webhook per bot token, and registering a second SILENTLY REPLACES the first.
// So activating an imported copy would not collide and fail. It would call setWebhook, take
// ownership of every client message, and leave the production Concierge running, healthy, and
// receiving nothing. No error is raised anywhere in n8n, and the error monitor cannot see an
// absence of updates. That is a silent, total takeover of the client bot, one click deep.
//
// The same is true of "Test workflow" on an enabled telegramTrigger: n8n registers a temporary
// listener against the same bot token to catch the test event.
//
// THE INTERLOCK. The trigger is DISABLED in the wrapper. That is not decoration:
//
//   * "Telegram Client Trigger" is the workflow's ONLY trigger node. With it disabled the
//     artifact contains ZERO enabled triggers, which is the property verifyImportSafe()
//     proves -- and a workflow with no enabled trigger is not an activatable workflow.
//   * The inherited webhookId fa4cd08a-6959-4db5-890d-03755a0aa42d -- the production
//     registration identity, shared with the live trigger -- is removed, so the wrapper cannot
//     inherit or shadow the live registration even if it were somehow enabled.
//
// WHAT IS DELIBERATELY NOT DONE, AND WHY IT IS STATED RATHER THAN QUIETLY OMITTED.
//
//   1. The trigger's CREDENTIAL IS KEPT. Stripping it would add a second interlock, and it
//      would also break the property that makes this wrapper auditable at all: credentials
//      byte-identical, node for node, so the reader can diff the wrapper against the audited
//      candidate and find nothing but the neutralisation. It buys little in exchange -- the
//      only route to activation runs through a deliberate re-enable of the trigger, and
//      anyone doing that would re-attach a credential too. The guard is `disabled`, and it is
//      proven; it is not the credential's absence.
//
//   2. NO LIVE-EFFECT SURFACE IS NEUTRALISED. The Google Sheets nodes still write the live
//      Bot_Sessions and Bot_Events, the Data Table nodes still write the live
//      Submission_Receipts, "Send Lead to Intake" still POSTs the live intake endpoint, the
//      three executeWorkflow nodes still call the live transport, and settings.errorWorkflow
//      still points at the live error monitor. Every one of those is load-bearing for the
//      P7.3 canary: a wrapper that pointed them at fixtures would prove nothing about
//      production. They are listed in docs/P7_3_IMPORT_SAFE_WRAPPER.md so importing is an
//      informed act rather than a blind one.
//
//   3. "Answer Callback Query" KEEPS its inherited webhookId. It is a telegram ACTION node,
//      not a trigger; n8n never binds a webhook for it. Stripping vestigial fields from nodes
//      that cannot register is churn dressed as safety. P6.1 made the same call for the four
//      Telegram alert nodes in Lead Intake. WEBHOOK_ID_BEARING_NODES pins the expected set so
//      the exception is asserted, not assumed.
//
// WHAT THIS MODULE MUST NEVER DO: change graph semantics. No Code body, no connection, no
// credential reference, no node parameter is touched -- not even the trigger's own parameters.
// verifyImportSafe() proves that independently by diffing the two documents and requiring the
// set of differing paths to equal the approved set EXACTLY. It does not re-run the transform,
// so a bug in the transform cannot pass its own check.

'use strict';

// ---------------------------------------------------------------- constants

const PRODUCTION_WORKFLOW_ID = 'mppzthlkSJFr6Kle';
const PRODUCTION_TRIGGER_WEBHOOK_ID = 'fa4cd08a-6959-4db5-890d-03755a0aa42d';
const BOT_CREDENTIAL_ID = '2JnVm0BIX0Z8tvBf';

const CANDIDATE_NAME = 'FINMENTOR Telegram Client Concierge B21C ISSUER CANDIDATE';
const IMPORT_SAFE_NAME = 'FINMENTOR Telegram Client Concierge B21C ISSUER CANARY';

const TRIGGER_NODE_NAME = 'Telegram Client Trigger';

const TELEGRAM_TRIGGER_TYPE = 'n8n-nodes-base.telegramTrigger';
const TELEGRAM_TYPE = 'n8n-nodes-base.telegram';
const CODE_TYPE = 'n8n-nodes-base.code';
const DATA_TABLE_TYPE = 'n8n-nodes-base.dataTable';
const SHEETS_TYPE = 'n8n-nodes-base.googleSheets';
const EXECUTE_WORKFLOW_TYPE = 'n8n-nodes-base.executeWorkflow';
const HTTP_TYPE = 'n8n-nodes-base.httpRequest';

// The nodes that legitimately still carry an inherited webhookId AFTER the transform. The
// trigger is not in this set: its own is stripped. See header note 3.
const WEBHOOK_ID_BEARING_NODES = ['Answer Callback Query'];

// The issuer nodes P7.2 added. The wrapper must carry all of them: a "canary" that lost the
// mint on the way through the wrapper would run green and prove nothing.
const ISSUER_NODES = [
  'Get Bot Session', 'Issuance Gate', 'IF Issuance Fault', 'IF Preallocation Required',
  'Receipt Preallocate', 'Receipt Readback', 'Issuance Verdict', 'IF Authority May Advance',
  'Build Issuance Failure Event', 'Authority Reread', 'Authority Verdict',
  'IF Authority Current', 'Build Stale Authority Event'
];

const AUTHORITY_NODE = 'Save Bot Session';

// Lifecycle / identity fields, the P6.1 list unchanged -- the tenant emits the same shape for
// every workflow, so the list that was right for Lead Intake is right here.
const STRIPPED_BRIEF = [
  'id', 'activeVersionId', 'versionId', 'versionCounter',
  'createdAt', 'updatedAt', 'sourceWorkflowId', 'triggerCount'
];

// `shared` carries workflowId, projectId, a creatorId UUID and the owner's name and email.
// `activeVersion` is a second full copy of the graph carrying workflowId; the CANDIDATE
// generator already strips it (meta.finmentor_active_version_stripped records that), so
// deleting it here is a no-op today. It stays in the list because a future re-export that
// reintroduced it must not become a hazard through this module's silence.
const STRIPPED_DISCOVERED = ['shared', 'activeVersion'];

const STRIPPED_TOP_LEVEL = STRIPPED_BRIEF.concat(STRIPPED_DISCOVERED);

const IMPORT_SAFE_GENERATOR = 'scripts/build-concierge-issuer-import-safe.mjs';

const ACTIVATION_HAZARD =
  'DO NOT ACTIVATE and DO NOT ENABLE the Telegram Client Trigger. It is bound to the SAME bot '
  + 'credential as the live Concierge. Telegram allows one webhook per bot token and a second '
  + 'registration silently replaces the first, so activating this copy -- or running "Test '
  + 'workflow" with the trigger enabled -- would take every client message away from '
  + 'production with no error raised anywhere. The trigger is disabled for that reason.';

// The exact, complete set of paths on which IMPORT-SAFE may differ from the canonical
// candidate. Anything else is a semantic change and fails verification.
const APPROVED_DIFF_PATHS = STRIPPED_TOP_LEVEL
  .concat([
    'name',
    'active',
    'isArchived',
    'meta.finmentor_source_export',
    'meta.finmentor_not_deployed',
    'meta.finmentor_import_hazard',
    'meta.finmentor_import_safe',
    'meta.finmentor_import_safe_generated_by',
    'meta.finmentor_activation_hazard'
  ]);

// Per-trigger-node paths, appended once the trigger node's index is known.
function triggerDiffPaths(index) {
  return ['nodes[' + index + '].disabled', 'nodes[' + index + '].webhookId'];
}

// ---------------------------------------------------------------- helpers

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function nodesOfType(wf, type) { return (wf.nodes || []).filter((n) => n && n.type === type); }

function nodeByName(wf, name) { return (wf.nodes || []).find((n) => n && n.name === name); }

// Trigger types whose name does NOT end in "Trigger". Enumerated because the suffix test
// below would silently miss every one of them, and a missed trigger is a missed interlock.
const NON_SUFFIXED_TRIGGER_TYPES = [
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.cron',            // legacy schedule
  'n8n-nodes-base.interval',        // legacy schedule
  'n8n-nodes-base.start',           // legacy manual entry
  'n8n-nodes-base.emailReadImap',   // polls a mailbox
  '@n8n/n8n-nodes-langchain.chatTrigger'
];

// n8n treats a node as a trigger by its type. Matching on the type STRING rather than on a
// closed allow-list means a trigger type this repo has never seen -- a form trigger, a
// schedule, a chat trigger smuggled in by a bad merge -- is still counted, and still has to be
// disabled.
//
// HONEST LIMIT: no offline heuristic can enumerate every trigger node type n8n ships or will
// ship, and the two rules here would miss a future one that neither ends in "Trigger" nor
// appears in the list above. That gap is CLOSED FOR THIS ARTIFACT by a different check --
// verifyImportSafe() requires the per-type node census to be byte-identical to the candidate's,
// so a node of ANY unrecognised type cannot be added to the wrapper at all. The heuristic
// guards the shape; the census guards the contents.
function isTriggerType(type) {
  const t = String(type || '');
  return /trigger$/i.test(t) || NON_SUFFIXED_TRIGGER_TYPES.indexOf(t) !== -1;
}

function triggerNodes(wf) { return (wf.nodes || []).filter((n) => n && isTriggerType(n.type)); }

function enabledTriggerNodes(wf) { return triggerNodes(wf).filter((n) => n.disabled !== true); }

function triggerNodeIndexes(wf) {
  const out = [];
  (wf.nodes || []).forEach((n, i) => { if (n && isTriggerType(n.type)) { out.push(i); } });
  return out;
}

function typeCensus(wf) {
  const out = {};
  (wf.nodes || []).forEach((n) => { if (n) { out[n.type] = (out[n.type] || 0) + 1; } });
  return out;
}

function countOccurrences(haystack, needle) {
  return String(haystack).split(needle).length - 1;
}

// ---------------------------------------------------------------- the transform

function buildImportSafe(canonical) {
  const wf = clone(canonical);

  // 1. Strip every carrier of production identity and lifecycle state.
  STRIPPED_TOP_LEVEL.forEach((k) => { delete wf[k]; });

  // 2. A distinct name, inert lifecycle. isArchived is set explicitly even though the
  //    canonical already reads false, because "explicitly false" and "happens to be false"
  //    are different guarantees and only one of them survives an upstream re-export.
  wf.name = IMPORT_SAFE_NAME;
  wf.active = false;
  wf.isArchived = false;

  // 3. Provenance that does not smuggle the production id back in, does not keep asserting
  //    "not deployed" about a file built expressly to be imported, and does not keep the
  //    candidate's "NOT IMPORT-SAFE" warning on the artifact that IS import-safe. The hazard
  //    that survives the wrapper is a different one, and it is stated in its place.
  if (wf.meta && typeof wf.meta === 'object') {
    if (typeof wf.meta.finmentor_source_export === 'string') {
      wf.meta.finmentor_source_export =
        wf.meta.finmentor_source_export.split(PRODUCTION_WORKFLOW_ID + '.').join('');
    }
    delete wf.meta.finmentor_import_hazard;
    wf.meta.finmentor_not_deployed = false;
    wf.meta.finmentor_import_safe = true;
    wf.meta.finmentor_import_safe_generated_by = IMPORT_SAFE_GENERATOR;
    wf.meta.finmentor_activation_hazard = ACTIVATION_HAZARD;
  }

  // 4. Neutralise every trigger. The NODE IS KEPT and KEPT UNDER ITS OWN NAME -- n8n resolves
  //    connections and node-reference expressions by node name, so renaming or deleting it
  //    would be a semantic change to a graph that is supposed to stay byte-faithful. Its
  //    PARAMETERS and CREDENTIAL are untouched. Disabled, with no inherited registration id,
  //    is what makes it incapable of binding the live bot while leaving every reference to it
  //    intact.
  triggerNodeIndexes(wf).forEach((i) => {
    const n = wf.nodes[i];
    n.disabled = true;
    delete n.webhookId;
  });

  return wf;
}

function serializeImportSafe(wf) {
  // Byte-for-byte the same convention as the candidate generator: 2-space JSON, trailing LF.
  return JSON.stringify(wf, null, 2) + '\n';
}

// ---------------------------------------------------------------- diffing

// Every path at which two documents differ, including keys present in one and absent in the
// other. Order-insensitive for object keys; index-sensitive for arrays.
function diffPaths(a, b, prefix, acc) {
  acc = acc || [];
  prefix = prefix || '';

  const aIsObj = a !== null && typeof a === 'object';
  const bIsObj = b !== null && typeof b === 'object';

  if (!aIsObj || !bIsObj) {
    if (JSON.stringify(a) !== JSON.stringify(b)) { acc.push(prefix); }
    return acc;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { acc.push(prefix); return acc; }

  if (Array.isArray(a)) {
    if (a.length !== b.length) { acc.push(prefix + '.length'); }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) { diffPaths(a[i], b[i], prefix + '[' + i + ']', acc); }
    return acc;
  }

  const keys = {};
  Object.keys(a).forEach((k) => { keys[k] = true; });
  Object.keys(b).forEach((k) => { keys[k] = true; });
  Object.keys(keys).sort().forEach((k) => {
    const p = prefix ? prefix + '.' + k : k;
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    if (!inA || !inB) { acc.push(p); return; }
    diffPaths(a[k], b[k], p, acc);
  });
  return acc;
}

// ---------------------------------------------------------------- route analysis

// Plain forward reachability over main connections. Unlike the P6.1 module this walker does
// NOT need to model branch discrimination: it is used to restate that the mint still lies on
// a path to the authority write, not to prove a route is unreachable. Following both outputs
// of an IF can only make that claim weaker, never falsely stronger.
function reachableFrom(wf, startName) {
  const conns = wf.connections || {};
  const seen = new Set([startName]);
  const queue = [startName];
  while (queue.length) {
    const cur = queue.shift();
    const c = conns[cur];
    if (!c || !c.main) { continue; }
    c.main.forEach((branch) => {
      (branch || []).forEach((link) => {
        if (!link || !link.node) { return; }
        if (!seen.has(link.node)) { seen.add(link.node); queue.push(link.node); }
      });
    });
  }
  return seen;
}

// ---------------------------------------------------------------- verification

// Proves IMPORT-SAFE differs from canonical ONLY by the approved transformation, and that it
// satisfies every import-safety property.
//
// Deliberately does NOT call buildImportSafe(). Re-running the transform and comparing would
// only prove the transform is deterministic; a wrong transform would pass. Every assertion
// below reads the two documents directly.
function verifyImportSafe(canonical, safe) {
  const failures = [];
  const fail = (m) => { failures.push(m); };

  // --- top-level identity and lifecycle -------------------------------------------------
  STRIPPED_TOP_LEVEL.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(safe, k)) {
      fail('top-level field must be absent from IMPORT-SAFE: ' + k);
    }
  });

  if (safe.name !== IMPORT_SAFE_NAME) { fail('name is not the canary name: ' + JSON.stringify(safe.name)); }
  if (safe.name === canonical.name) {
    fail('IMPORT-SAFE kept the candidate name; an import would be indistinguishable');
  }
  if (safe.active !== false) { fail('active must be exactly false, got ' + JSON.stringify(safe.active)); }
  if (safe.isArchived !== false) { fail('isArchived must be exactly false, got ' + JSON.stringify(safe.isArchived)); }

  // The production id must not survive ANYWHERE in the document, under any key. This is the
  // check that catches shared[].workflowId and meta.finmentor_import_hazard, both of which
  // carry it in the canonical.
  const serialized = JSON.stringify(safe);
  if (serialized.indexOf(PRODUCTION_WORKFLOW_ID) !== -1) {
    fail('the production workflow id ' + PRODUCTION_WORKFLOW_ID + ' still appears in IMPORT-SAFE');
  }
  // Nor the production trigger's registration identity, which the candidate inherits verbatim
  // from the live trigger.
  if (serialized.indexOf(PRODUCTION_TRIGGER_WEBHOOK_ID) !== -1) {
    fail('the production trigger webhookId ' + PRODUCTION_TRIGGER_WEBHOOK_ID
      + ' still appears in IMPORT-SAFE');
  }
  // The owner's personal data rides in `shared`. Absence of the key is asserted above; absence
  // of the data is asserted here, because a future export could carry it elsewhere.
  if (/creatorId/.test(serialized) || /@finmentor\.md/.test(serialized)) {
    fail('IMPORT-SAFE still carries a creatorId or an owner email address');
  }

  // --- the trigger, and the interlock ---------------------------------------------------
  const safeTriggers = triggerNodes(safe);
  const canonTriggers = triggerNodes(canonical);
  if (safeTriggers.length !== canonTriggers.length) {
    fail('trigger node count changed: ' + canonTriggers.length + ' -> ' + safeTriggers.length);
  }

  const tgTriggers = nodesOfType(safe, TELEGRAM_TRIGGER_TYPE);
  if (tgTriggers.length !== 1) {
    fail('expected exactly one telegramTrigger, found ' + tgTriggers.length);
  } else if (tgTriggers[0].name !== TRIGGER_NODE_NAME) {
    fail('the telegramTrigger is not named ' + TRIGGER_NODE_NAME
      + ', got ' + JSON.stringify(tgTriggers[0].name));
  }

  safeTriggers.forEach((n) => {
    if (n.disabled !== true) { fail('trigger node ' + JSON.stringify(n.name) + ' is not disabled'); }
    if (Object.prototype.hasOwnProperty.call(n, 'webhookId')) {
      fail('trigger node ' + JSON.stringify(n.name) + ' still carries an inherited webhookId');
    }
  });

  // THE interlock, stated as a property of the artifact rather than of any one node: nothing
  // in this file can start an execution. A workflow with no enabled trigger is not an
  // activatable workflow, so the Telegram bot binding cannot be reached by activating it.
  const enabled = enabledTriggerNodes(safe);
  if (enabled.length !== 0) {
    fail('IMPORT-SAFE contains ' + enabled.length + ' ENABLED trigger node(s): '
      + enabled.map((n) => n.name + ' [' + n.type + ']').join(', '));
  }

  // The trigger's own parameters and credential are untouched. Asserted rather than assumed,
  // because "we only disabled it" is exactly the claim a reader needs checked.
  const cTrigger = nodeByName(canonical, TRIGGER_NODE_NAME);
  const sTrigger = nodeByName(safe, TRIGGER_NODE_NAME);
  if (!cTrigger || !sTrigger) {
    fail('the trigger node ' + TRIGGER_NODE_NAME + ' is missing from one of the documents');
  } else {
    if (JSON.stringify(cTrigger.parameters) !== JSON.stringify(sTrigger.parameters)) {
      fail('the trigger node parameters were modified');
    }
    if (JSON.stringify(cTrigger.credentials) !== JSON.stringify(sTrigger.credentials)) {
      fail('the trigger node credential reference was modified');
    }
    if (!sTrigger.credentials || !sTrigger.credentials.telegramApi
        || sTrigger.credentials.telegramApi.id !== BOT_CREDENTIAL_ID) {
      // Not a hazard -- a statement that the hazard is still the one this wrapper was built
      // for. If the credential ever changes, the interlock's reasoning must be re-read.
      fail('the trigger no longer carries bot credential ' + BOT_CREDENTIAL_ID
        + '; re-read the activation hazard before trusting this wrapper');
    }
  }

  // The exact set of nodes still carrying an inherited webhookId. Declared, so the exception
  // for the telegram ACTION node is auditable and cannot silently grow.
  const bearers = (safe.nodes || [])
    .filter((n) => Object.prototype.hasOwnProperty.call(n, 'webhookId'))
    .map((n) => n.name).sort();
  const expectedBearers = WEBHOOK_ID_BEARING_NODES.slice().sort();
  if (JSON.stringify(bearers) !== JSON.stringify(expectedBearers)) {
    fail('nodes carrying webhookId are ' + JSON.stringify(bearers)
      + ', expected exactly ' + JSON.stringify(expectedBearers));
  }

  // --- the activation warning travels with the file -------------------------------------
  if (!safe.meta || safe.meta.finmentor_import_safe !== true) {
    fail('meta.finmentor_import_safe must be exactly true');
  }
  if (!safe.meta || safe.meta.finmentor_not_deployed !== false) {
    fail('meta.finmentor_not_deployed must be exactly false');
  }
  if (!safe.meta || safe.meta.finmentor_import_safe_generated_by !== IMPORT_SAFE_GENERATOR) {
    fail('meta.finmentor_import_safe_generated_by must name the generator');
  }
  if (!safe.meta || safe.meta.finmentor_activation_hazard !== ACTIVATION_HAZARD) {
    fail('meta.finmentor_activation_hazard is missing or altered');
  }
  if (safe.meta && Object.prototype.hasOwnProperty.call(safe.meta, 'finmentor_import_hazard')) {
    fail('meta.finmentor_import_hazard must be removed: it asserts the file is NOT import-safe');
  }

  // --- graph fidelity -------------------------------------------------------------------
  const cNodes = canonical.nodes || [];
  const sNodes = safe.nodes || [];
  if (cNodes.length !== sNodes.length) {
    fail('node count changed: ' + cNodes.length + ' -> ' + sNodes.length);
  }

  if (JSON.stringify(canonical.connections) !== JSON.stringify(safe.connections)) {
    fail('connections are not byte-identical to the canonical candidate');
  }

  // A per-type census, not just a total. It catches a swap that keeps the count -- a Code node
  // deleted and a Telegram node added would pass a length check and fail this one.
  if (JSON.stringify(typeCensus(canonical)) !== JSON.stringify(typeCensus(safe))) {
    fail('the node type census changed: ' + JSON.stringify(typeCensus(canonical))
      + ' -> ' + JSON.stringify(typeCensus(safe)));
  }

  const sByName = {};
  sNodes.forEach((n) => { sByName[n.name] = n; });

  // Code bodies, byte for byte, matched by node name so a reordering cannot hide a swap.
  nodesOfType(canonical, CODE_TYPE).forEach((cn) => {
    const sn = sByName[cn.name];
    if (!sn) { fail('code node missing from IMPORT-SAFE: ' + cn.name); return; }
    if ((cn.parameters || {}).jsCode !== (sn.parameters || {}).jsCode) {
      fail('jsCode differs for code node ' + JSON.stringify(cn.name));
    }
  });

  // Credential references unchanged, node for node.
  cNodes.forEach((cn) => {
    const sn = sByName[cn.name];
    if (!sn) { fail('node missing from IMPORT-SAFE: ' + cn.name); return; }
    if (JSON.stringify(cn.credentials) !== JSON.stringify(sn.credentials)) {
      fail('credential reference changed on node ' + JSON.stringify(cn.name));
    }
  });

  // Parameters unchanged on EVERY node, with no exception. P6.1 could not make this claim --
  // it had to rewrite the webhook's path -- and it is a strictly stronger guarantee, so it is
  // asserted in its own right rather than left implicit in the residual diff.
  cNodes.forEach((cn) => {
    const sn = sByName[cn.name];
    if (!sn) { return; }
    if (JSON.stringify(cn.parameters) !== JSON.stringify(sn.parameters)) {
      fail('parameters changed on node ' + JSON.stringify(cn.name) + ' -- this wrapper changes none');
    }
  });

  // Settings, including the MCP exposure flag and the error workflow binding.
  if (JSON.stringify(canonical.settings) !== JSON.stringify(safe.settings)) {
    fail('settings changed');
  }
  if (!safe.settings || safe.settings.availableInMCP !== false) {
    fail('settings.availableInMCP must be exactly false');
  }

  // --- the issuer survives the wrapper --------------------------------------------------
  // A canary that lost the mint would run green and prove nothing. These restate P7.2's
  // structure at the wrapper boundary rather than trusting that "connections are identical"
  // will be read as covering it.
  ISSUER_NODES.forEach((name) => {
    if (!sByName[name]) { fail('issuer node missing from IMPORT-SAFE: ' + name); }
  });
  const safeDataTables = nodesOfType(safe, DATA_TABLE_TYPE).length;
  if (safeDataTables !== 2) {
    fail('expected exactly two Data Table nodes in IMPORT-SAFE, found ' + safeDataTables);
  }
  const cKeyRefs = countOccurrences(JSON.stringify(canonical.nodes), 'submission_key');
  const sKeyRefs = countOccurrences(JSON.stringify(safe.nodes), 'submission_key');
  if (cKeyRefs !== sKeyRefs || sKeyRefs === 0) {
    fail('submission_key reference count changed or is zero: ' + cKeyRefs + ' -> ' + sKeyRefs);
  }
  const fromGate = reachableFrom(safe, 'Issuance Gate');
  ['Receipt Preallocate', 'Receipt Readback', 'Issuance Verdict', AUTHORITY_NODE].forEach((n) => {
    if (!fromGate.has(n)) { fail(n + ' is not reachable from Issuance Gate in IMPORT-SAFE'); }
  });

  // --- the exhaustive residual diff -----------------------------------------------------
  // Everything above is a property check. This is the closure: the COMPLETE set of paths at
  // which the two documents differ must equal the approved set exactly. A change anywhere
  // else -- one byte of a Code body, one connection, one parameter -- shows up here.
  let approved = APPROVED_DIFF_PATHS.slice();
  triggerNodeIndexes(canonical).forEach((i) => { approved = approved.concat(triggerDiffPaths(i)); });

  const actual = diffPaths(canonical, safe);
  const approvedSet = new Set(approved);
  const unexpected = actual.filter((p) => !approvedSet.has(p));
  if (unexpected.length) {
    fail('unapproved difference(s) from the canonical candidate: ' + unexpected.slice(0, 12).join(', ')
      + (unexpected.length > 12 ? ' (+' + (unexpected.length - 12) + ' more)' : ''));
  }

  // The subset check alone would accept a wrapper that changed NOTHING. Require the paths that
  // carry the neutralisation to actually be among the differences.
  const actualSet = new Set(actual);
  const tIndexes = triggerNodeIndexes(canonical);
  const mustDiffer = ['id', 'active', 'name', 'shared', 'meta.finmentor_import_hazard']
    .concat(tIndexes.length ? triggerDiffPaths(tIndexes[0]) : ['<no trigger node found>']);
  mustDiffer.forEach((p) => {
    if (!actualSet.has(p)) {
      fail('the wrapper did not change ' + p + ' -- the neutralisation did not happen');
    }
  });

  return { ok: failures.length === 0, failures: failures };
}

module.exports = {
  PRODUCTION_WORKFLOW_ID,
  PRODUCTION_TRIGGER_WEBHOOK_ID,
  BOT_CREDENTIAL_ID,
  CANDIDATE_NAME,
  IMPORT_SAFE_NAME,
  TRIGGER_NODE_NAME,
  TELEGRAM_TRIGGER_TYPE,
  TELEGRAM_TYPE,
  CODE_TYPE,
  DATA_TABLE_TYPE,
  SHEETS_TYPE,
  EXECUTE_WORKFLOW_TYPE,
  HTTP_TYPE,
  WEBHOOK_ID_BEARING_NODES,
  NON_SUFFIXED_TRIGGER_TYPES,
  ISSUER_NODES,
  AUTHORITY_NODE,
  STRIPPED_BRIEF,
  STRIPPED_DISCOVERED,
  STRIPPED_TOP_LEVEL,
  APPROVED_DIFF_PATHS,
  IMPORT_SAFE_GENERATOR,
  ACTIVATION_HAZARD,
  triggerDiffPaths,
  triggerNodeIndexes,
  isTriggerType,
  triggerNodes,
  enabledTriggerNodes,
  typeCensus,
  nodesOfType,
  nodeByName,
  buildImportSafe,
  serializeImportSafe,
  diffPaths,
  reachableFrom,
  verifyImportSafe
};
