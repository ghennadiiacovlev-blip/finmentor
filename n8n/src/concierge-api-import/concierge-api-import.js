// FINMENTOR — P7.3 REST-API import projection for the B.2.1-C Concierge issuer.
//
// WHY THIS EXISTS.
//
// P6.2 established, for Lead Intake, that the MCP surface cannot deploy an audited graph of
// this size: create_workflow_from_code takes SDK source rather than workflow JSON, and
// update_workflow caps at 100 operations per call. The n8n public REST API can:
// POST /api/v1/workflows accepts a workflow JSON body, so a file can be posted VERBATIM from
// disk and the graph never passes through a transcription step. The same is true here, and
// the Concierge is 45 nodes of which 21 are Code -- exactly the fidelity risk the
// deterministic generator exists to eliminate.
//
// But that endpoint's schema is STRICTER than the UI importer's. The UI wrapper
// n8n/candidate/concierge-issuer-IMPORT-SAFE.json carries eleven top-level fields; the
// endpoint accepts four and rejects the rest as additional properties. This module produces
// the four-field projection, and proves it is a faithful subset.
//
// THE INPUT IS THE WRAPPER, NOT THE CANONICAL CANDIDATE. Same load-bearing decision as P6.2:
// the projection is built from the already-proven IMPORT-SAFE artifact, so it INHERITS every
// safety property that artifact's gate established, instead of re-deriving them from the
// dangerous canonical.
//
// ================================================================================
// WHAT P7.3 ADDS TO THE P6.2 STORY, AND WHY IT MATTERS MORE HERE.
// ================================================================================
//
// P6.2 recorded that `active` cannot be carried by the endpoint, so inactivity stops being a
// property of the artifact and becomes a property of the server's default. For Lead Intake the
// cost of getting that wrong was bounded: an unexpectedly-active copy would try to claim a
// webhook path the live workflow already holds, and n8n's own uniqueness constraint answers.
//
// For the Concierge it is not bounded. An unexpectedly-active copy would register its Telegram
// trigger against the SAME bot token as production, Telegram would silently replace the live
// registration, and every client message would divert to the copy with no error raised
// anywhere. See the header of n8n/src/concierge-import-safe/concierge-import-safe.js.
//
// And the projection drops MORE than `active`. It also drops `meta` -- which is where the
// wrapper's DO-NOT-ACTIVATE warning lives. So of the three things the wrapper does to make the
// artifact safe, the projection carries exactly one:
//
//   active: false                     -> DROPPED. Becomes a server default this repo cannot see.
//   meta.finmentor_activation_hazard  -> DROPPED. The deployed object carries no warning at all.
//   nodes[0].disabled === true        -> CARRIED, inside `nodes`. THE ONLY SURVIVING GUARD.
//
// That is the whole safety story after projection, and it rests on an assumption this repo
// CANNOT verify offline: that POST /api/v1/workflows preserves a node's `disabled` flag rather
// than normalising it away. If it does not, the interlock evaporates at the moment of deploy
// and the first thing the copy does is take the bot.
//
// So it is not assumed. It is the first and non-negotiable entry in POST_DEPLOY_ASSERTIONS
// below, which the deploy step MUST check by reading the created workflow back BEFORE anything
// else happens to it. An artifact that cannot carry its own guarantee has to have that
// guarantee enforced somewhere, and the honest place is the only place that can see the
// answer: after the write, against the live object.
//
// WHAT THIS MODULE MUST NEVER DO: change graph semantics. `nodes`, `connections` and
// `settings` are passed through untouched and asserted byte-identical to the wrapper's.
// verifyApiImport() proves that by diffing the two documents and requiring the set of
// differing paths to equal the seven dropped fields EXACTLY -- it does not re-run the
// transform, so a bug in the transform cannot pass its own check.

'use strict';

const S = require('../concierge-import-safe/concierge-import-safe.js');

// ---------------------------------------------------------------- constants

// The complete set of top-level fields POST /api/v1/workflows accepts. Anything else is
// rejected by the endpoint as an additional property. Measured for P6.2 against this tenant.
const API_ACCEPTED_FIELDS = ['name', 'nodes', 'connections', 'settings'];

// Fields dropped by the projection, each with the value it MUST have in the wrapper for the
// drop to be inert. The value is compared as its JSON text.
//
// The point of pinning values rather than merely listing names: dropping `tags: []` loses
// nothing, but dropping a NON-empty `tags` would silently lose real state.
const DROPPED_INERT = {
  description: 'null',
  isArchived: 'false',
  nodeGroups: '[]',
  staticData: 'null',
  tags: '[]'
};

// Dropped, NOT inert, handled explicitly -- see the header.
//   active : must be false in the wrapper; enforced post-deploy against the server default.
//   meta   : carries the DO-NOT-ACTIVATE warning and the provenance markers. Its loss is
//            documented rather than shrugged at, and it is asserted to carry no production
//            identity so that dropping it cannot be hiding a leak.
const DROPPED_EXPLICIT = ['active', 'meta'];

const DROPPED_FIELDS = Object.keys(DROPPED_INERT).concat(DROPPED_EXPLICIT).sort();

const API_IMPORT_GENERATOR = 'scripts/build-concierge-issuer-api-import.mjs';

const EXPECTED_NODE_COUNT = 45;

// What the deploy step MUST verify by reading the created workflow back from the API. Offline
// artifacts cannot establish these; only the live object can. The first one is the interlock
// and is ordered first on purpose: if it does not hold, nothing else about this deployment is
// safe and the workflow must be deleted before anything touches it.
const POST_DEPLOY_ASSERTIONS = [
  'the returned definition has ZERO enabled trigger nodes  <- THE INTERLOCK. Check this FIRST.',
  '  in particular: the ' + S.TRIGGER_NODE_NAME + ' node came back with disabled === true',
  '  if it did not, DELETE the created workflow immediately: it is one activation away from',
  '  taking every client message from the production bot, silently.',
  'active === false                          (the guarantee `active: false` could not carry)',
  'name === ' + S.IMPORT_SAFE_NAME,
  'nodes.length === ' + EXPECTED_NODE_COUNT,
  'the ' + S.TRIGGER_NODE_NAME + ' node carries NO webhookId',
  'the production id ' + S.PRODUCTION_WORKFLOW_ID + ' is absent from the returned definition',
  'the production registration id ' + S.PRODUCTION_TRIGGER_WEBHOOK_ID + ' is absent',
  'settings.availableInMCP === false',
  'both Data Table nodes survived the create (typeVersion 1.1 is newer than most of this graph)',
  'the live Concierge ' + S.PRODUCTION_WORKFLOW_ID + ' is still active === true and untouched'
];

// ---------------------------------------------------------------- the transform

function buildApiImport(safe) {
  const out = {};
  // Built by explicit whitelist, not by deleting from a copy. A whitelist cannot leak a field
  // that appears upstream later; a blacklist silently would.
  API_ACCEPTED_FIELDS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(safe, k)) {
      out[k] = JSON.parse(JSON.stringify(safe[k]));
    }
  });
  return out;
}

function serializeApiImport(wf) {
  // Same convention as every upstream generator: 2-space JSON, trailing LF.
  return JSON.stringify(wf, null, 2) + '\n';
}

// ---------------------------------------------------------------- verification

function verifyApiImport(safe, api) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- 0. the INPUT is the proven wrapper, not something else
  // If this projection were ever fed the canonical candidate by mistake it would carry the
  // production id and an ENABLED Telegram trigger straight into a create call. Checked first.
  if (has(safe, 'id')) {
    fail('input carries a top-level id -- this is not the IMPORT-SAFE wrapper');
  }
  if (safe.name !== S.IMPORT_SAFE_NAME) {
    fail('input name is ' + JSON.stringify(safe.name) + ', expected the canary name');
  }
  if (!safe.meta || safe.meta.finmentor_import_safe !== true) {
    fail('input does not carry meta.finmentor_import_safe === true');
  }
  if (S.enabledTriggerNodes(safe).length !== 0) {
    fail('input has enabled trigger node(s) -- this is not the neutralised wrapper');
  }

  // ---- 1. exactly the four accepted fields, no more and no fewer
  const keys = Object.keys(api).sort();
  const expected = API_ACCEPTED_FIELDS.slice().sort();
  if (!same(keys, expected)) {
    fail('projection fields are [' + keys.join(', ') + '], expected exactly [' + expected.join(', ') + ']');
  }
  DROPPED_FIELDS.forEach((k) => {
    if (has(api, k)) { fail('projection still carries the dropped field ' + k); }
  });

  // ---- 2. the four carried fields are byte-identical to the wrapper's
  API_ACCEPTED_FIELDS.forEach((k) => {
    if (!same(api[k], safe[k])) { fail(k + ' differs from the wrapper -- the projection is not faithful'); }
  });

  // ---- 3. every dropped field was inert
  Object.keys(DROPPED_INERT).forEach((k) => {
    if (!has(safe, k)) { return; } // absent upstream: nothing was lost
    const actual = JSON.stringify(safe[k]);
    if (actual !== DROPPED_INERT[k]) {
      fail('dropping ' + k + ' is NOT inert: wrapper has ' + actual + ', expected ' + DROPPED_INERT[k]);
    }
  });
  if (safe.active !== false) {
    fail('wrapper active is ' + JSON.stringify(safe.active) + ' -- refusing to drop a non-false active');
  }
  // Dropping meta must not be concealing a production-identity leak.
  if (safe.meta && JSON.stringify(safe.meta).includes(S.PRODUCTION_WORKFLOW_ID)) {
    fail('wrapper meta contains the production workflow id');
  }
  // Dropping meta DOES lose the DO-NOT-ACTIVATE warning. That is not a failure -- the endpoint
  // gives no choice -- but the wrapper must have carried it, so the loss is a known loss and
  // not a wrapper that never had one.
  if (!safe.meta || safe.meta.finmentor_activation_hazard !== S.ACTIVATION_HAZARD) {
    fail('the wrapper carries no activation hazard note; the projection would be dropping nothing '
      + 'and the deployed object would be unwarned by accident rather than by constraint');
  }

  // ---- 4. the closure check: NOTHING else differs
  // The complete set of differing paths across the two documents must equal the seven dropped
  // top-level fields exactly. One altered byte anywhere in the graph shows up here.
  const diff = S.diffPaths(safe, api, '', []).sort();
  if (!same(diff, DROPPED_FIELDS)) {
    const unexpected = diff.filter((p) => DROPPED_FIELDS.indexOf(p) === -1);
    const missing = DROPPED_FIELDS.filter((p) => diff.indexOf(p) === -1);
    if (unexpected.length) { fail('UNAPPROVED differences: ' + unexpected.join(', ')); }
    if (missing.length) { fail('expected differences absent: ' + missing.join(', ')); }
  }

  // ---- 5. THE INTERLOCK survived the projection
  // This is the only one of the wrapper's three guards that `nodes` can carry, so it is
  // checked hardest and checked here rather than left to the diff.
  const apiEnabled = S.enabledTriggerNodes(api);
  if (apiEnabled.length !== 0) {
    fail('the projection has ' + apiEnabled.length + ' ENABLED trigger node(s): '
      + apiEnabled.map((n) => n.name).join(', ') + ' -- the only surviving guard is gone');
  }
  const tgTriggers = S.nodesOfType(api, S.TELEGRAM_TRIGGER_TYPE);
  if (tgTriggers.length !== 1) {
    fail('projection has ' + tgTriggers.length + ' telegramTrigger nodes, expected exactly 1');
  } else {
    if (tgTriggers[0].disabled !== true) { fail('the Telegram trigger is not disabled in the projection'); }
    if (has(tgTriggers[0], 'webhookId')) {
      fail('the Telegram trigger still carries an inherited webhookId in the projection');
    }
  }

  // ---- 6. the other inherited safety properties survived
  const serialized = JSON.stringify(api);
  if (serialized.includes(S.PRODUCTION_WORKFLOW_ID)) {
    fail('the production workflow id appears in the projection');
  }
  if (serialized.includes(S.PRODUCTION_TRIGGER_WEBHOOK_ID)) {
    fail('the production trigger registration id appears in the projection');
  }
  if (api.name !== S.IMPORT_SAFE_NAME) {
    fail('projection name is ' + JSON.stringify(api.name));
  }
  if (!api.nodes || api.nodes.length !== EXPECTED_NODE_COUNT) {
    fail('projection has ' + ((api.nodes || []).length) + ' nodes, expected ' + EXPECTED_NODE_COUNT);
  }
  if (!api.settings || api.settings.availableInMCP !== false) {
    fail('settings.availableInMCP is not false');
  }
  if (S.nodesOfType(api, S.TELEGRAM_TYPE).length !== S.nodesOfType(safe, S.TELEGRAM_TYPE).length) {
    fail('the projection changed the number of Telegram nodes');
  }

  // ---- 7. the issuer survived
  // The reason to deploy this at all is the mint. A projection that carried a neutered graph
  // would deploy a canary that proves nothing.
  S.ISSUER_NODES.forEach((name) => {
    if (!S.nodeByName(api, name)) { fail('issuer node missing from the projection: ' + name); }
  });
  if (S.nodesOfType(api, S.DATA_TABLE_TYPE).length !== 2) {
    fail('the projection does not carry both Data Table nodes');
  }
  if (JSON.stringify(api.nodes).indexOf('submission_key') === -1) {
    fail('the projection carries no submission_key reference at all');
  }

  return { ok: failures.length === 0, failures: failures };
}

module.exports = {
  API_ACCEPTED_FIELDS,
  DROPPED_INERT,
  DROPPED_EXPLICIT,
  DROPPED_FIELDS,
  API_IMPORT_GENERATOR,
  EXPECTED_NODE_COUNT,
  POST_DEPLOY_ASSERTIONS,
  buildApiImport,
  serializeApiImport,
  verifyApiImport
};
