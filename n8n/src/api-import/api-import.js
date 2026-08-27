// FINMENTOR — P6.2 REST-API import projection for the B.2.1-C receipt candidate.
//
// WHY THIS EXISTS.
//
// P6 is blocked at candidate deployment. The MCP surface cannot deploy the audited 100-node
// graph: create_workflow_from_code takes SDK source rather than workflow JSON, and
// update_workflow has no bulk-JSON operation and caps at 100 operations per call against the
// ~210 this graph needs. Both remaining paths would require re-expressing 98,890 characters
// of production Code bodies by hand, which is the exact fidelity risk the deterministic
// generator exists to eliminate.
//
// The n8n public REST API has the capability the MCP surface lacks: POST /api/v1/workflows
// accepts a workflow JSON body. A file can be posted VERBATIM from disk, so the graph never
// passes through a transcription step at all.
//
// But that endpoint's schema is STRICTER than the UI importer's. The UI wrapper
// n8n/candidate/lead-intake-internal-receipt-IMPORT-SAFE.json carries eleven top-level
// fields; the endpoint accepts four and rejects the rest as additional properties. This
// module produces the four-field projection, and proves it is a faithful subset.
//
// THE INPUT IS THE WRAPPER, NOT THE CANONICAL CANDIDATE.
//
// This is the load-bearing design decision. The projection is built from the already-proven
// IMPORT-SAFE wrapper, so it INHERITS every safety property that artifact's 43-check gate
// established -- production id absent, webhook disabled and inert-pathed, activeVersion and
// shared stripped -- instead of re-deriving them from the dangerous canonical. What is left
// to prove here is narrow and therefore provable: that the projection drops only the seven
// declared fields, that each dropped field was INERT, and that the safety properties survived
// the projection.
//
// THE ONE FIELD WHOSE LOSS IS NOT INERT: `active`.
//
// The wrapper says `active: false` explicitly. The projection cannot: `active` is rejected by
// the endpoint. Inactivity therefore stops being a property of the artifact and becomes a
// property of the SERVER'S DEFAULT for newly created workflows -- something this repository
// cannot assert offline and must not assume.
//
// That is not hand-waved here. It is converted into POST_DEPLOY_ASSERTIONS below, which the
// deploy script MUST check by reading the workflow back after creation. An artifact that
// cannot carry its own guarantee has to have that guarantee enforced somewhere, and the
// honest place is the only place that can see the answer: after the write, against the live
// object.
//
// WHAT IS LOST, STATED PLAINLY: `meta`. The wrapper's provenance markers
// (finmentor_import_safe, finmentor_generated_by, the source-export filename) do not survive
// the projection, so the deployed workflow carries no in-band provenance. The operative
// identifier is the NAME, which does survive and is asserted both offline and post-deploy.
//
// WHAT THIS MODULE MUST NEVER DO: change graph semantics. `nodes`, `connections` and
// `settings` are passed through untouched and asserted byte-identical to the wrapper's.
// verifyApiImport() proves that by diffing the two documents and requiring the set of
// differing paths to equal the seven dropped fields EXACTLY -- it does not re-run the
// transform, so a bug in the transform cannot pass its own check.

'use strict';

const S = require('../import-safe/import-safe.js');

// ---------------------------------------------------------------- constants

// The complete set of top-level fields POST /api/v1/workflows accepts. Anything else is
// rejected by the endpoint as an additional property.
const API_ACCEPTED_FIELDS = ['name', 'nodes', 'connections', 'settings'];

// Fields dropped by the projection, each with the value it MUST have in the wrapper for the
// drop to be inert. The value is compared as its JSON text.
//
// The point of pinning values rather than merely listing names: dropping `tags: []` loses
// nothing, but dropping a NON-empty `tags` would silently lose real state. The projection is
// only safe while these hold, so they are asserted rather than assumed.
const DROPPED_INERT = {
  description: 'null',
  isArchived: 'false',
  nodeGroups: '[]',
  staticData: 'null',
  tags: '[]'
};

// Dropped, NOT inert, handled explicitly -- see the header.
//   active : must be false in the wrapper; enforced post-deploy against the server default.
//   meta   : provenance only; its loss is documented, and it is asserted to carry no
//            production identity so that dropping it cannot be hiding a leak.
const DROPPED_EXPLICIT = ['active', 'meta'];

const DROPPED_FIELDS = Object.keys(DROPPED_INERT).concat(DROPPED_EXPLICIT).sort();

const API_IMPORT_GENERATOR = 'scripts/build-lead-intake-receipt-api-import.mjs';

const EXPECTED_NODE_COUNT = 100;

// What the deploy script MUST verify by reading the created workflow back from the API.
// Offline artifacts cannot establish these; only the live object can.
const POST_DEPLOY_ASSERTIONS = [
  'active === false                          (the guarantee `active: false` could not carry)',
  'name === ' + S.IMPORT_SAFE_NAME,
  'nodes.length === ' + EXPECTED_NODE_COUNT,
  'the Webhook node is disabled === true',
  'the Webhook node path === ' + S.INERT_WEBHOOK_PATH,
  'the production path ' + S.PRODUCTION_WEBHOOK_PATH + ' is absent from the returned definition',
  'settings.availableInMCP === false'
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
  // Same convention as both upstream generators: 2-space JSON, trailing LF.
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
  // production id and the live webhook path straight into a create call. Checked first.
  if (has(safe, 'id')) {
    fail('input carries a top-level id — this is not the IMPORT-SAFE wrapper');
  }
  if (safe.name !== S.IMPORT_SAFE_NAME) {
    fail('input name is ' + JSON.stringify(safe.name) + ', expected the canary name');
  }
  if (!safe.meta || safe.meta.finmentor_import_safe !== true) {
    fail('input does not carry meta.finmentor_import_safe === true');
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
    if (!same(api[k], safe[k])) { fail(k + ' differs from the wrapper — the projection is not faithful'); }
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
    fail('wrapper active is ' + JSON.stringify(safe.active) + ' — refusing to drop a non-false active');
  }
  // Dropping meta must not be concealing a production-identity leak.
  if (safe.meta && JSON.stringify(safe.meta).includes(S.PRODUCTION_WORKFLOW_ID)) {
    fail('wrapper meta contains the production workflow id');
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

  // ---- 5. the inherited safety properties survived the projection
  const serialized = JSON.stringify(api);
  if (serialized.includes(S.PRODUCTION_WORKFLOW_ID)) {
    fail('the production workflow id appears in the projection');
  }
  if (serialized.includes(S.PRODUCTION_WEBHOOK_PATH)) {
    fail('the production webhook path appears in the projection');
  }
  if (api.name !== S.IMPORT_SAFE_NAME) {
    fail('projection name is ' + JSON.stringify(api.name));
  }
  if (!api.nodes || api.nodes.length !== EXPECTED_NODE_COUNT) {
    fail('projection has ' + ((api.nodes || []).length) + ' nodes, expected ' + EXPECTED_NODE_COUNT);
  }
  const hooks = S.nodesOfType(api, S.WEBHOOK_TYPE);
  if (hooks.length !== 1) {
    fail('projection has ' + hooks.length + ' webhook nodes, expected exactly 1');
  } else {
    const h = hooks[0];
    if (h.disabled !== true) { fail('the webhook node is not disabled'); }
    if ((h.parameters || {}).path !== S.INERT_WEBHOOK_PATH) {
      fail('the webhook path is ' + JSON.stringify((h.parameters || {}).path));
    }
    if (has(h, 'webhookId')) { fail('the webhook node still carries an inherited webhookId'); }
  }
  if (!api.settings || api.settings.availableInMCP !== false) {
    fail('settings.availableInMCP is not false');
  }
  if (S.nodesOfType(api, S.TELEGRAM_TYPE).length !== S.nodesOfType(safe, S.TELEGRAM_TYPE).length) {
    fail('the projection changed the number of Telegram nodes');
  }
  if (!S.nodesOfType(api, S.INTERNAL_TRIGGER_TYPE).length) {
    fail('the internal sub-workflow trigger is absent from the projection');
  }

  return { ok: failures.length === 0, failures };
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
