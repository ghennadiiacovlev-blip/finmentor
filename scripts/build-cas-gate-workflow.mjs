// FINMENTOR — builds the corrected B.2.1-B CAS + stored-row equality gate (Phase 10).
//
// Emits the workflow JSON for QA-only workflow 03DcHoJ5XxJYUZQ4 on stdout:
//
//   node scripts/build-cas-gate-workflow.mjs > cas-gate.json
//   # then PUT /workflows/03DcHoJ5XxJYUZQ4 with -Write (see scripts/n8n-lib.ps1)
//
// The gate this replaces was the one the independent review faulted: its limit-2 read only
// checked the static marker string "PV_WRITTEN_BY_CORRECT_HELPER", and its hash exercise ran
// entirely in memory over objects that never touched the Data Table. It therefore could not
// have detected the incomplete publish set that shipped on the reversed-order run.
//
// This version proves, in the real n8n Code sandbox against the real QA Data Table:
//
//   1. a superseded sync_token updates zero rows, the current one updates exactly one;
//   2. the historical defect reproduced live — a publish set omitting session_id while
//      projection_version is written from the INTENDED projection — is accepted by the old
//      verifier and rejected by the corrected one (the negative control);
//   3. the corrected complete publish is verified from the STORED row: limit-2 read, no
//      missing fields, field-by-field equality, and SHA-256 recomputed from what was found.
//
// Identity is the synthetic QA chat id 990000001. The previous gate seeded the owner's real
// Telegram id; that row is left untouched. Bot_Sessions is never read or written — the
// authoritative side is a fixture, because this gate tests the derived-row contract, not the
// authority. No production workflow is involved.
//
// Run it from the n8n UI: open the workflow and press Execute. Expect Final Verdict to
// report GATE: PASS with NEGATIVE_CONTROL: PASS.

const DT = 'dk2oK5tL1P2bKLhK';
const CHAT = '990000001';

const FIELDS = ['chat_id', 'session_id', 'state', 'status', 'selected_service', 'business_model',
  'main_pain', 'urgency', 'consent', 'lead_id', 'cycle_id', 'consent_cycle_id', 'consent_at',
  'lead_cycle_id', 'lead_intake_ok'];

// Shared prelude. String.fromCharCode(10) avoids newline-escaping hazards in workflow JSON.
const PRELUDE = `const crypto = require('crypto');
const LF = String.fromCharCode(10);
const FIELDS = ${JSON.stringify(FIELDS)};
function norm(v) {
  if (v === null || v === undefined) { return ''; }
  if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
  if (typeof v === 'number') { return String(v); }
  return String(v).trim();
}
function canon(p) {
  const a = [];
  for (let i = 0; i < FIELDS.length; i++) { a.push(JSON.stringify(FIELDS[i]) + ':' + JSON.stringify(norm(p[FIELDS[i]]))); }
  return a.join(LF);
}
function pv(p) { return crypto.createHash('sha256').update(canon(p), 'utf8').digest('hex'); }
function strip(row) {
  const out = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const f = FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(row || {}, f)) { out[f] = norm(row[f]); }
  }
  return out;
}
function rowsFor(nodeName, chatId) {
  let rows = [];
  try {
    rows = $(nodeName).all().map(function (x) { return x.json; })
      .filter(function (r) { return r && norm(r.chat_id) === chatId; });
  } catch (e) { rows = []; }
  return rows;
}
`;

const buildCase = `${PRELUDE}
const CHAT = ${JSON.stringify(CHAT)};
const oldProjection = {
  chat_id: CHAT, session_id: 'S-OLD', state: 'MENU', status: 'active',
  selected_service: 'working_capital', business_model: 'distribution', main_pain: 'cash_gap',
  urgency: 'none', consent: 'yes', lead_id: 'FIN-QA-9001', cycle_id: 'C-900',
  consent_cycle_id: 'C-900', consent_at: '2026-08-25T18:00:00.000Z', lead_cycle_id: 'C-900',
  lead_intake_ok: true
};
// The generation the corrected helper intends to publish.
const newProjection = Object.assign({}, oldProjection, { session_id: 'S-NEW', state: 'DIAGNOSTIC' });
return [{ json: {
  chat_id: CHAT,
  token_seed: 'TOK-SEED', token_commit: 'TOK-COMMIT', token_stale: 'TOK-STALE',
  old_projection: oldProjection, new_projection: newProjection,
  old_version: pv(oldProjection), new_version: pv(newProjection),
  stamp: '2026-08-25T21:40:00.000Z'
} }];`;

const countStale = `${PRELUDE}
let n = 0;
try {
  n = $('Stale Publish Attempt').all().filter(function (x) { return x.json && x.json.chat_id !== undefined; }).length;
} catch (e) { n = 0; }
return [{ json: { stale_updated_rows: n } }];`;

// The negative control. The publish set omitted session_id, exactly as the reversed-order
// live run did, while projection_version was written from the INTENDED projection.
const verdictA = `${PRELUDE}
const b = $('Build Case').first().json;
const rows = rowsFor('Read Back A', b.chat_id);
const r = rows.length === 1 ? rows[0] : null;
const stored = r ? strip(r) : {};
const diff = FIELDS.filter(function (f) { return norm(b.new_projection[f]) !== norm((r || {})[f]); });
const storedVersion = r ? pv(stored) : null;

// What the historical verifier did: hash the payload it meant to write.
const oldVerifierAccepts = !!(r && pv(b.new_projection) === norm(r.projection_version));
// What the corrected verifier does: field-by-field, then hash the row it actually found.
const newVerifierAccepts = !!(r && diff.length === 0 && storedVersion === norm(r.projection_version));

return [{ json: {
  STEP: 'INCOMPLETE_PUBLISH_NEGATIVE_CONTROL',
  rows_found_limit2: rows.length,
  intended_session_id: b.new_projection.session_id,
  stored_session_id: r ? norm(r.session_id) : null,
  diff_fields: diff,
  OLD_VERIFIER_ACCEPTS: oldVerifierAccepts,
  NEW_VERIFIER_ACCEPTS: newVerifierAccepts,
  NEGATIVE_CONTROL: (oldVerifierAccepts && !newVerifierAccepts) ? 'PASS' : 'FAIL'
} }];`;

const finalVerdict = `${PRELUDE}
const b = $('Build Case').first().json;
const a = $('Verdict A').first().json;
const stale = $('Count Stale').first().json.stale_updated_rows;

let validN = 0;
try {
  validN = $('Complete Publish').all().filter(function (x) { return x.json && x.json.chat_id !== undefined; }).length;
} catch (e) { validN = 0; }

const rows = rowsFor('Read Back B', b.chat_id);
const r = rows.length === 1 ? rows[0] : null;
const stored = r ? strip(r) : {};
const missing = FIELDS.filter(function (f) { return !Object.prototype.hasOwnProperty.call(r || {}, f); });
const diff = FIELDS.filter(function (f) { return norm(b.new_projection[f]) !== norm((r || {})[f]); });
const storedVersion = r ? pv(stored) : null;

const casStale = stale === 0;
const casValid = validN === 1;
const oneRow = rows.length === 1;
const complete = missing.length === 0;
const equal = diff.length === 0;
const hashFromStored = !!(r && storedVersion === norm(r.projection_version));
const hashMatchesAuthority = !!(r && storedVersion === pv(b.new_projection));
const published = !!(r && norm(r.cache_valid) === 'true');

const allPass = casStale && casValid && oneRow && complete && equal && hashFromStored &&
  hashMatchesAuthority && published && a.NEGATIVE_CONTROL === 'PASS';

return [{ json: {
  GATE: allPass ? 'PASS' : 'FAIL',
  stale_token_updated_rows: stale,
  CAS_STALE_ZERO_ROWS: casStale ? 'PASS' : 'FAIL',
  complete_publish_updated_rows: validN,
  CAS_VALID_ONE_ROW: casValid ? 'PASS' : 'FAIL',
  rows_found_limit2: rows.length,
  DUPLICATE_FREE: oneRow ? 'PASS' : 'FAIL',
  missing_fields: missing,
  COMPLETE_PUBLISH_SET: complete ? 'PASS' : 'FAIL',
  diff_fields: diff,
  STORED_ROW_EQUALITY: equal ? 'PASS' : 'FAIL',
  HASH_FROM_STORED_ROW: hashFromStored ? 'PASS' : 'FAIL',
  HASH_MATCHES_AUTHORITY: hashMatchesAuthority ? 'PASS' : 'FAIL',
  CACHE_VALID_TRUE: published ? 'PASS' : 'FAIL',
  NEGATIVE_CONTROL: a.NEGATIVE_CONTROL,
  negative_control_detail: {
    old_verifier_accepted_incomplete_row: a.OLD_VERIFIER_ACCEPTS,
    new_verifier_accepted_incomplete_row: a.NEW_VERIFIER_ACCEPTS,
    stored_session_id_after_incomplete_publish: a.stored_session_id,
    intended_session_id: a.intended_session_id
  },
  stored_session_id_final: r ? norm(r.session_id) : null,
  stored_projection_version: r ? norm(r.projection_version).slice(0, 16) : null,
  recomputed_from_stored_row: storedVersion ? storedVersion.slice(0, 16) : null,
  chat_id: b.chat_id,
  note: 'Synthetic QA identity. No production workflow, Bot_Sessions row or real lead involved.'
} }];`;

const B = (path) => `={{ $('Build Case').first().json.${path} }}`;

function projectionValues(source, omit) {
  const v = {};
  FIELDS.forEach((f) => {
    if (omit && omit.indexOf(f) !== -1) { return; }
    v[f] = B(`${source}.${f}`);
  });
  return v;
}

function dtNode(name, position, operation, extra) {
  return Object.assign({
    parameters: Object.assign({
      resource: 'row',
      operation,
      dataTableId: { __rl: true, mode: 'id', value: DT }
    }, extra),
    id: undefined,
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position,
    alwaysOutputData: true,
    onError: 'continueRegularOutput'
  });
}

function codeNode(name, position, jsCode) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position
  };
}

const chatFilter = { conditions: [{ keyName: 'chat_id', condition: 'eq', keyValue: CHAT }] };
const tokenFilter = (tokenPath) => ({
  conditions: [
    { keyName: 'chat_id', condition: 'eq', keyValue: CHAT },
    { keyName: 'sync_token', condition: 'eq', keyValue: B(tokenPath) }
  ]
});

const nodes = [
  { parameters: {}, name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-460, 0] },

  codeNode('Build Case', [-260, 0], buildCase),

  // Seed a COMPLETE, valid, readable row — the strong precondition the audit required.
  dtNode('Seed Row', [-60, 0], 'upsert', {
    matchType: 'allConditions',
    filters: chatFilter,
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: ['chat_id'],
      schema: [],
      value: Object.assign(projectionValues('old_projection'), {
        cache_valid: true,
        sync_token: B('token_seed'),
        projection_version: B('old_version'),
        source_updated_at: B('stamp'),
        mirror_updated_at: B('stamp')
      })
    },
    options: {}
  }),

  // Post-commit generation token. Tombstones the row; mirrored fields deliberately survive,
  // which is how a stale session_id outlives its generation.
  dtNode('Install Commit Token', [140, 0], 'update', {
    matchType: 'allConditions',
    filters: tokenFilter('token_seed'),
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: [],
      schema: [],
      value: { cache_valid: false, sync_token: B('token_commit') }
    },
    options: {}
  }),

  // A superseded helper must update zero rows.
  dtNode('Stale Publish Attempt', [340, 0], 'update', {
    matchType: 'allConditions',
    filters: tokenFilter('token_stale'),
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: [],
      schema: [],
      value: { cache_valid: true, projection_version: 'WRITTEN_BY_STALE_HELPER' }
    },
    options: {}
  }),

  codeNode('Count Stale', [540, 0], countStale),

  // The historical defect, reproduced against the real table: session_id omitted from the
  // publish set while projection_version is written from the intended projection.
  dtNode('Incomplete Publish', [740, 0], 'update', {
    matchType: 'allConditions',
    filters: tokenFilter('token_commit'),
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: [],
      schema: [],
      value: Object.assign(projectionValues('new_projection', ['session_id']), {
        cache_valid: true,
        projection_version: B('new_version'),
        mirror_updated_at: B('stamp')
      })
    },
    options: {}
  }),

  dtNode('Read Back A', [940, 0], 'get', {
    matchType: 'allConditions', filters: chatFilter, returnAll: false, limit: 2
  }),

  codeNode('Verdict A', [1140, 0], verdictA),

  // The corrected publish: the complete projection.
  dtNode('Complete Publish', [1340, 0], 'update', {
    matchType: 'allConditions',
    filters: tokenFilter('token_commit'),
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: [],
      schema: [],
      value: Object.assign(projectionValues('new_projection'), {
        cache_valid: true,
        projection_version: B('new_version'),
        mirror_updated_at: B('stamp')
      })
    },
    options: {}
  }),

  dtNode('Read Back B', [1540, 0], 'get', {
    matchType: 'allConditions', filters: chatFilter, returnAll: false, limit: 2
  }),

  codeNode('Final Verdict', [1740, 0], finalVerdict)
];

const order = ['Start', 'Build Case', 'Seed Row', 'Install Commit Token', 'Stale Publish Attempt',
  'Count Stale', 'Incomplete Publish', 'Read Back A', 'Verdict A', 'Complete Publish',
  'Read Back B', 'Final Verdict'];

const connections = {};
for (let i = 0; i < order.length - 1; i++) {
  connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };
}

process.stdout.write(JSON.stringify({
  name: 'FINMENTOR B.2.1-B CAS Gate',
  nodes: nodes.map((n) => { delete n.id; return n; }),
  connections,
  settings: { executionOrder: 'v1', availableInMCP: false }
}, null, 2));
