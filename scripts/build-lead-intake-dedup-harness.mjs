#!/usr/bin/env node
// FINMENTOR — P9-R3 isolated dedup-read-outage harness for Lead Intake PREMIUM FINAL.
//
//   node scripts/build-lead-intake-dedup-harness.mjs
//
// REPO-ONLY. Emits two disposable harness candidates and never contacts n8n:
//
//   n8n/candidate/li-dedup-outage-h1-candidate.json   credential-free stand-in read
//   n8n/candidate/li-dedup-outage-h2-candidate.json   the REAL Sheets node on a dead credential
//
// ============================== WHAT IS BEING PROVEN ==============================
//
// docs/FINDING_LEAD_INTAKE_DEDUP_STORE_OUTAGE.md records, as a READING OF THE GRAPH and
// explicitly not as a live finding, that `Read Pipeline (Dedup)` carries the P9-R2 flag pair:
//
//     alwaysOutputData: true   AND   onError: 'continueErrorOutput'
//
// In n8n that pair makes a failing node emit on BOTH outputs — the error item on output 1, and
// a synthetic empty item on output 0 from `alwaysOutputData`. `Dedup Guard` then opens with
//
//     const rows = $input.all().map(i => i.json)
//       .filter(r => r && String(r.lead_id || '').trim() !== '');
//
// which discards the synthetic item, leaving `rows = []` — indistinguishable from a genuine
// "no existing lead matched". The hypothesis is that a Sheets READ outage therefore travels the
// success branch as `dedup_mode: 'new'` and arrives at `Save to Pipeline`, A WRITE, while the
// error branch separately answers CRM unavailable.
//
// That direction is worse than the Gateway's was. The Gateway failed closed on side effects and
// only its RESPONSE was wrong; here a read outage could create the duplicate lead the read
// exists to prevent.
//
// The finding is falsifiable and has not been falsified. This harness drives one real failure
// through a retention-enabled copy and reads `runData` per node, which is the only thing that
// settles it — P9 §2/§3 recorded the Gateway's 503 as merely *unproven* for weeks before a
// harness showed it was unreachable, and P9-R1 showed that reading configuration is exactly the
// method that misses this class of defect.
//
// ============================== THE FOUR MODES ==============================
//
// The stand-in read is driven by `harness_dedup` in the request body, and an unrecognised or
// absent value THROWS rather than defaulting, because a harness that quietly picks a happy path
// proves nothing.
//
//   down  throw, exactly as an unreachable Sheets API does      <- the hypothesis
//   none  return ZERO rows: the read SUCCEEDED and matched      <- the legitimate empty case
//         nothing. `alwaysOutputData` then synthesises the
//         same empty item, which is the whole difficulty.
//   dup   return one row matching the submitted contact         <- control: must MERGE
//   new   return one NON-matching row                           <- control: must WRITE
//
// `down` versus `none` is the heart of it. If `Dedup Guard` emits the same verdict for both,
// the ambiguity is not an inference about n8n's engine — it is on the record, per node.
//
// `dup` and `new` are the controls the finding asks for: "a genuine duplicate must still merge,
// and a genuine new lead must still write. Without them a harness that fails everything looks
// like a pass."
//
// ============================== WHY PRODUCTION IS NEVER TOUCHED ==============================
//
// Deliberately breaking the production Sheets API is refused, and so is running the real graph
// with real credentials. The harness is a COPY of the deployed graph under a rule rather than a
// hand-written list of exceptions:
//
//   EVERY node that can touch the outside world or persistent state is replaced by a
//   credential-free stand-in. EVERY node that computes or routes is byte-identical.
//
// The allowlist is COMPUTED from node type (see SIDE_EFFECTING_TYPES), never typed out, so a
// side-effecting node added to production later cannot silently escape the rule. That covers all
// 12 Google Sheets nodes, all 4 Telegram nodes, all 5 Submission_Receipts data-table nodes and
// the OpenAI node — 22 in total — plus the webhook, whose path must not seize the production
// route. The other 79 nodes and the ENTIRE connection map are byte-identical, and the gate below
// refuses to emit otherwise.
//
// So `Dedup Guard`, `Receipt Gate`, `IF Receipt Required`, `IF Is New`, `Build Pipeline Row`,
// `IF Internal (Infra)`, `Respond Infra Failed` and `Stop: CRM Unavailable` — every node whose
// behaviour is in question — are production's own, unmodified.
//
// TWO DIVERGENCES BEYOND THE NODES, both deliberate and both gated:
//
//   1. RETENTION IS ON. Production and the P9-R2 harness both retain nothing; this harness must
//      retain everything, because the question is which nodes RAN, and that lives only in
//      `runData`. The retained data is a synthetic lead at example.invalid and nothing else.
//   2. `settings.errorWorkflow` IS REMOVED. Production routes failures to the live Error Monitor
//      (RBiFLhVjizMkAzrK). This harness FAILS ON PURPOSE, repeatedly, so leaving that in place
//      would page production with manufactured alerts.
//
// No secret is written to an artifact. The dead credential id is a PLACEHOLDER here and is
// injected at deploy time.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');
const OUT_H1 = join(ROOT, 'n8n', 'candidate', 'li-dedup-outage-h1-candidate.json');
const OUT_H2 = join(ROOT, 'n8n', 'candidate', 'li-dedup-outage-h2-candidate.json');

// ---------------------------------------------------------------- configuration (non-secret)

export const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
export const PRODUCTION_PATH = 'finmentor-lead-intake';
export const H1_PATH = 'p9r3/dedup-outage-h1';
export const H2_PATH = 'p9r3/dedup-outage-h2';
export const H1_NAME = '[TEMP] P9-R3 Lead Intake dedup-outage H1 (credential-free)';
export const H2_NAME = '[TEMP] P9-R3 Lead Intake dedup-outage H2 (dead sheets credential)';

export const CREDENTIAL_PLACEHOLDER = '__HARNESS_DEAD_SHEETS_CREDENTIAL_ID__';
export const DOCUMENT_PLACEHOLDER = '__HARNESS_DEAD_SHEETS_DOCUMENT_ID__';

// Production-owned identifiers that must appear in NEITHER harness.
export const PRODUCTION_SPREADSHEET_ID = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A';
export const PRODUCTION_RECEIPT_TABLE = 'Submission_Receipts';
export const PRODUCTION_ERROR_WORKFLOW = 'RBiFLhVjizMkAzrK';

export const WEBHOOK_NODE = 'Webhook';
export const DEDUP_NODE = 'Read Pipeline (Dedup)';
export const SETTINGS_NODE = 'Read Settings';
export const WRITE_NODE = 'Save to Pipeline';
export const GUARD_NODE = 'Dedup Guard';
export const BUILD_ROW_NODE = 'Build Pipeline Row';

// Any node of these types can reach outside the execution or mutate durable state. Every one is
// replaced. Deriving the allowlist from this list rather than from names is deliberate: a Sheets
// or Telegram node added to production later is neutralised automatically instead of slipping
// through a stale hand-written list.
export const SIDE_EFFECTING_TYPES = [
  'n8n-nodes-base.googleSheets',
  'n8n-nodes-base.telegram',
  'n8n-nodes-base.dataTable',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.executeWorkflow',
  '@n8n/n8n-nodes-langchain.openAi'
];

// Retention ON, error workflow OFF. See the header.
const SETTINGS = {
  executionOrder: 'v1',
  binaryMode: 'separate',
  availableInMCP: false,
  saveExecutionProgress: true,
  saveManualExecutions: true,
  saveDataErrorExecution: 'all',
  saveDataSuccessExecution: 'all'
};

// ---------------------------------------------------------------- the stand-ins

// The node under test. Same name, same position, and — critically — the SAME FLAG PAIR, copied
// from production rather than asserted, so whatever `down` does here is what the flags do there.
const H1_DEDUP_CODE = [
  '// HARNESS ONLY - stands in for the Pipeline dedup READ so the outage can be driven without',
  '// touching Google. It holds no credential, reads nothing and writes nothing.',
  '//',
  '//   down -> throw, exactly as an unreachable Sheets API does; n8n routes to the ERROR output',
  '//   none -> ZERO rows: the read SUCCEEDED and matched nothing. This is the case',
  '//           alwaysOutputData exists for, and the case an outage is claimed to impersonate.',
  '//   dup  -> one row matching the submitted contact, so Dedup Guard must MERGE',
  '//   new  -> one NON-matching row, so Dedup Guard must treat this as a new lead and WRITE',
  '//',
  '// An unrecognised or absent mode THROWS rather than defaulting to anything, because a',
  '// harness that quietly picks a happy path proves nothing.',
  '// Contact fields live under `client`: Normalize + Score Lead reads pick(client.email,',
  '// lead.email) and never a top-level `email`, so the dup row must echo the same place the',
  '// lead was read from or it can never match.',
  'const src = $("Webhook").first().json.body || {};',
  'const client = src.client || {};',
  'const mode = String(src.harness_dedup || "");',
  'const now = new Date().toISOString();',
  'if (mode === "down") { throw new Error("HARNESS: simulated Pipeline dedup-read outage"); }',
  'if (mode === "none") { return []; }',
  'if (mode === "dup") {',
  '  return [{ json: {',
  '    lead_id: "LEAD-P9R3-EXISTING", name: "P9R3 Harness", company: "P9R3 Harness Co",',
  '    email: String(client.email || ""), phone: "", telegram: "",',
  '    deal_stage: "new", priority: "COLD", financial_zone: "GREEN",',
  '    created_at: now, updated_at: now, request_id: ""',
  '  } }];',
  '}',
  'if (mode === "new") {',
  '  return [{ json: {',
  '    lead_id: "LEAD-P9R3-UNRELATED", name: "Someone Else", company: "Unrelated Co",',
  '    email: "unrelated@example.invalid", phone: "", telegram: "",',
  '    deal_stage: "new", priority: "COLD", financial_zone: "GREEN",',
  '    created_at: now, updated_at: now, request_id: ""',
  '  } }];',
  '}',
  'throw new Error("HARNESS: harness_dedup must be one of down|none|dup|new");'
].join('\n');

// The write we must never perform, and the thing we are trying to observe. It records that it
// was REACHED and passes its input through, so everything downstream still runs exactly as in
// production. It is structurally incapable of writing: there is no Sheets node in this workflow.
const WRITE_STANDIN_CODE = [
  '// HARNESS ONLY - stands in for the Pipeline WRITE. It writes nothing. Reaching this node at',
  '// all is the finding: on a dedup-read outage the success branch must not get here.',
  'const out = [];',
  'for (const i of $input.all()) {',
  '  const j = Object.assign({}, i.json);',
  '  j.__harness_write_reached = 1;',
  '  out.push({ json: j });',
  '}',
  'return out;'
].join('\n');

// Settings are read from a real sheet in production. The harness supplies a synthetic key/value
// set in the shape `Settings to Object` parses. It carries NO chat ids — production's live ones
// must not be baked into a tracked artifact — and it disables the AI branch so the run stays
// deterministic. Neither choice touches the dedup path.
const SETTINGS_STANDIN_CODE = [
  '// HARNESS ONLY - stands in for the Settings sheet read. Synthetic, credential-free, and',
  '// deliberately carrying no chat ids. AI and auto-reply are off so the run is deterministic.',
  'return [',
  '  { json: { key: "sla_hot_hours", value: "4" } },',
  '  { json: { key: "sla_warm_hours", value: "24" } },',
  '  { json: { key: "ai_enabled_for_hot", value: "false" } },',
  '  { json: { key: "ai_enabled_for_warm", value: "false" } },',
  '  { json: { key: "ai_enabled_for_cold", value: "false" } },',
  '  { json: { key: "auto_reply_enabled", value: "false" } },',
  '  { json: { key: "follow_up_enabled", value: "false" } },',
  '  { json: { key: "timezone", value: "Europe/Chisinau" } },',
  '  { json: { key: "currency", value: "EUR" } }',
  '];'
].join('\n');

// Everything else that could reach outside: pass the items through untouched so the graph keeps
// its exact shape and every downstream router sees what it would have seen.
const PASSTHROUGH_CODE = [
  '// HARNESS ONLY - stands in for a side-effecting node. It passes its input through untouched',
  '// and is structurally incapable of writing, sending or calling anything.',
  'return $input.all();'
].join('\n');

// ---------------------------------------------------------------- builder

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// Replace a node with a Code node of the same name and position, MIRRORING its error flags in
// whichever state production holds them. An absent flag stays absent rather than becoming an
// explicit `undefined` that a later reader could mistake for "not considered".
function codeNode(src, jsCode) {
  const out = {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: src.id,
    name: src.name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: src.position
  };
  if (src.onError !== undefined) { out.onError = src.onError; }
  if (src.alwaysOutputData !== undefined) { out.alwaysOutputData = src.alwaysOutputData; }
  if (src.disabled !== undefined) { out.disabled = src.disabled; }
  return out;
}

export function isSideEffecting(node) { return SIDE_EFFECTING_TYPES.indexOf(node.type) !== -1; }

// The declared allowlist, COMPUTED from the source graph.
export function divergenceAllowlist(src) {
  return src.nodes.filter((n) => isSideEffecting(n) || n.name === WEBHOOK_NODE).map((n) => n.name);
}

// Only the four fields the n8n update schema accepts, matching DEPLOYABLE_FIELDS in
// n8n/src/deploy-guard/materializer.js. This is an ALLOWLIST rather than a set of deletes for a
// reason found by the gate below: a live export also carries `activeVersion`, an entire SECOND
// copy of the production graph. Deleting known-bad keys would have shipped the production
// spreadsheet id inside that blob; naming the four keys that may exist cannot.
export function buildHarness(src, variant) {
  const wf = {
    name: variant === 'h1' ? H1_NAME : H2_NAME,
    nodes: null,
    connections: clone(src.connections),
    settings: clone(SETTINGS)
  };

  wf.nodes = src.nodes.map((n) => {
    if (n.name === WEBHOOK_NODE) {
      const w = clone(n);
      w.parameters = clone(n.parameters);
      w.parameters.path = variant === 'h1' ? H1_PATH : H2_PATH;
      delete w.webhookId;
      return w;
    }

    if (n.name === DEDUP_NODE) {
      if (variant === 'h1') { return codeNode(n, H1_DEDUP_CODE); }
      // H2 keeps the REAL Google Sheets node and the REAL read shape. Only the credential and
      // the document move, to disposable ones that cannot authenticate — so the throw comes from
      // the real node type rather than from a Code node standing in for it. Both are placeholders
      // here and are injected at deploy time; the production document id must never ship in a
      // tracked artifact.
      const s = clone(n);
      s.credentials = { googleSheetsOAuth2Api: { id: CREDENTIAL_PLACEHOLDER, name: 'P9-R3 dead sheets (disposable)' } };
      s.parameters = clone(n.parameters);
      s.parameters.documentId = { __rl: true, value: DOCUMENT_PLACEHOLDER, mode: 'id' };
      // The tab is canonical configuration and survives, but its `cachedResultUrl` embeds the
      // production spreadsheet id — the same leak the `activeVersion` blob carried, in a field
      // that looks like a display label.
      s.parameters.sheetName = { __rl: true, value: n.parameters.sheetName.value, mode: 'id' };
      return s;
    }

    if (n.name === SETTINGS_NODE) { return codeNode(n, SETTINGS_STANDIN_CODE); }
    if (n.name === WRITE_NODE) { return codeNode(n, WRITE_STANDIN_CODE); }
    if (isSideEffecting(n)) { return codeNode(n, PASSTHROUGH_CODE); }
    return clone(n);
  });

  return wf;
}

// ---------------------------------------------------------------- gate

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function verifyHarness(src, wf, variant) {
  const f = [];
  const path = variant === 'h1' ? H1_PATH : H2_PATH;
  const json = JSON.stringify(wf);
  const byName = (w, n) => w.nodes.find((x) => x.name === n);
  const allow = divergenceAllowlist(src);

  // --- the graph is the Lead Intake graph, except where declared -----------
  if (wf.nodes.length !== src.nodes.length) { f.push('node count differs from Lead Intake'); }
  if (!deepEqual(wf.connections, src.connections)) { f.push('the connection map differs from Lead Intake'); }
  for (const g of src.nodes) {
    const h = byName(wf, g.name);
    if (!h) { f.push('the harness is missing a Lead Intake node: ' + g.name); continue; }
    // Flags are mirrored for EVERY node, allowlisted or not. The flag pair is the defect under
    // test, so a stand-in that dropped or added one would be testing a different graph.
    if (!deepEqual(h.onError || null, g.onError || null)) { f.push('onError not mirrored: ' + g.name); }
    if (!deepEqual(h.alwaysOutputData || false, g.alwaysOutputData || false)) { f.push('alwaysOutputData not mirrored: ' + g.name); }
    if (!deepEqual(h.disabled || false, g.disabled || false)) { f.push('disabled not mirrored: ' + g.name); }
    if (allow.indexOf(g.name) !== -1) { continue; }
    if (!deepEqual(h.parameters, g.parameters)) { f.push('undeclared divergence in node parameters: ' + g.name); }
    if (h.type !== g.type || h.typeVersion !== g.typeVersion) { f.push('undeclared divergence in node type: ' + g.name); }
  }

  // --- the nodes whose behaviour is in question are production's own -------
  for (const name of [GUARD_NODE, 'Receipt Gate', 'IF Receipt Fault', 'IF Receipt Required',
    'IF Is New', BUILD_ROW_NODE, 'IF Internal (Infra)', 'Respond Infra Failed',
    'Stop: CRM Unavailable', 'Normalize + Score Lead', 'Correlation Guard']) {
    const g = byName(src, name); const h = byName(wf, name);
    if (!g) { f.push('expected Lead Intake node is absent from the source: ' + name); continue; }
    if (!h || !deepEqual(h.parameters, g.parameters) || h.type !== g.type) {
      f.push('a node under test was modified: ' + name);
    }
  }

  // --- the defect under test is preserved exactly --------------------------
  const gd = byName(src, DEDUP_NODE);
  const hd = byName(wf, DEDUP_NODE);
  if (!gd) { f.push('the dedup read is absent from the source graph'); }
  if (gd && gd.alwaysOutputData !== true) { f.push('production dedup read no longer carries alwaysOutputData; this harness targets a defect that is gone'); }
  if (gd && gd.onError !== 'continueErrorOutput') { f.push('production dedup read no longer routes its error output; this harness targets a defect that is gone'); }
  if (hd && hd.alwaysOutputData !== true) { f.push('the harness dedup read does not carry alwaysOutputData'); }
  if (hd && hd.onError !== 'continueErrorOutput') { f.push('the harness dedup read does not route its error output'); }

  // --- the wiring that carries the hypothesis ------------------------------
  const dOut = wf.connections[DEDUP_NODE];
  if (!dOut || !dOut.main || dOut.main.length !== 2) {
    f.push('the dedup read does not have both a success and an error output');
  } else {
    if ((dOut.main[0][0] || {}).node !== GUARD_NODE) { f.push('the dedup success output is not wired to ' + GUARD_NODE); }
    if ((dOut.main[1][0] || {}).node !== 'IF Internal (Infra)') { f.push('the dedup ERROR output is not wired to IF Internal (Infra)'); }
  }
  const newOut = wf.connections['IF Is New'];
  if (!newOut || (newOut.main[0][0] || {}).node !== BUILD_ROW_NODE) { f.push('IF Is New true-branch is not wired to ' + BUILD_ROW_NODE); }
  const rowOut = wf.connections[BUILD_ROW_NODE];
  if (!rowOut || (rowOut.main[0][0] || {}).node !== WRITE_NODE) { f.push(BUILD_ROW_NODE + ' is not wired to ' + WRITE_NODE); }

  // --- the H1 stand-in must be able to state all four modes ----------------
  if (variant === 'h1') {
    const c = ((byName(wf, DEDUP_NODE).parameters) || {}).jsCode || '';
    for (const mode of ['down', 'none', 'dup', 'new']) {
      if (c.indexOf('"' + mode + '"') === -1) { f.push('the H1 stand-in cannot express mode: ' + mode); }
    }
    if (c.indexOf('throw new Error("HARNESS: simulated') === -1) { f.push('the H1 stand-in cannot fail'); }
    if (c.indexOf('if (mode === "none") { return []; }') === -1) { f.push('the H1 stand-in does not return ZERO rows for a legitimately empty read'); }
  }

  // --- nothing production-owned may be reachable ---------------------------
  if (json.indexOf(PRODUCTION_SPREADSHEET_ID) !== -1) { f.push('the harness references the PRODUCTION spreadsheet'); }
  if (json.indexOf(PRODUCTION_RECEIPT_TABLE) !== -1) { f.push('the harness references the PRODUCTION receipt table'); }
  if (json.indexOf(PRODUCTION_ERROR_WORKFLOW) !== -1) { f.push('the harness would page the PRODUCTION Error Monitor'); }
  for (const t of SIDE_EFFECTING_TYPES) {
    if (variant === 'h2' && t === 'n8n-nodes-base.googleSheets') { continue; }
    if (wf.nodes.some((n) => n.type === t)) { f.push('the harness carries a side-effecting node type: ' + t); }
  }
  if (variant === 'h2') {
    const sheets = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets');
    if (sheets.length !== 1) { f.push('H2 must carry exactly ONE Sheets node, found ' + sheets.length); }
    if (sheets.length === 1 && sheets[0].name !== DEDUP_NODE) { f.push('H2 Sheets node is not the dedup read'); }
  }
  if (/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/.test(json)) { f.push('a bot token shape appears in the artifact'); }

  const wh = byName(wf, WEBHOOK_NODE);
  if (!wh || wh.parameters.path !== path) { f.push('the harness webhook path is not the disposable path'); }
  if (wh && wh.parameters.path === PRODUCTION_PATH) { f.push('the harness would seize the PRODUCTION Lead Intake route'); }

  // --- credentials ---------------------------------------------------------
  const credNodes = wf.nodes.filter((n) => n.credentials);
  if (variant === 'h1') {
    if (credNodes.length !== 0) { f.push('H1 must be credential-free, found ' + credNodes.length + ' credential-bearing node(s)'); }
  } else {
    if (credNodes.length !== 1) { f.push('H2 must carry exactly one credential, found ' + credNodes.length); }
    if (credNodes.length === 1 && credNodes[0].name !== DEDUP_NODE) { f.push('H2 credential is not on the dedup read'); }
    if (credNodes.length === 1 && credNodes[0].credentials.googleSheetsOAuth2Api.id !== CREDENTIAL_PLACEHOLDER) { f.push('H2 credential is not the placeholder'); }
    if (hd && hd.type !== 'n8n-nodes-base.googleSheets') { f.push('H2 dedup node is not the real Google Sheets node'); }
    if (hd && hd.parameters.documentId.value !== DOCUMENT_PLACEHOLDER) { f.push('H2 document id is not the placeholder'); }
  }

  // --- disposability, retention and the error workflow ---------------------
  if (wf.settings.saveDataSuccessExecution !== 'all' || wf.settings.saveDataErrorExecution !== 'all') {
    f.push('the harness does not retain execution data, so runData cannot be read');
  }
  if (wf.settings.availableInMCP !== false) { f.push('the harness is exposed to MCP'); }
  if (wf.settings.errorWorkflow) { f.push('the harness still routes failures to an error workflow'); }
  if (wf.name.indexOf('[TEMP]') !== 0) { f.push('the harness is not named as disposable'); }

  // Only the four deployable fields may exist. A live export also carries `activeVersion`, a
  // full second copy of the production graph; that is how the production spreadsheet id first
  // reached this artifact, and an exact key set is the only check that catches the next one.
  const keys = Object.keys(wf).sort().join(',');
  if (keys !== 'connections,name,nodes,settings') { f.push('the harness carries top-level fields beyond name/nodes/connections/settings: ' + keys); }

  return { ok: f.length === 0, failures: f };
}

function serialize(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

const isMain = process.argv[1] && process.argv[1].endsWith('build-lead-intake-dedup-harness.mjs');
if (isMain) {
  const src = JSON.parse(readFileSync(SRC, 'utf8'));
  const allow = divergenceAllowlist(src);
  for (const [variant, out] of [['h1', OUT_H1], ['h2', OUT_H2]]) {
    const wf = buildHarness(src, variant);
    const v = verifyHarness(src, wf, variant);
    if (!v.ok) {
      console.error('REFUSING TO WRITE: ' + variant.toUpperCase() + ' failed verification.');
      v.failures.forEach((x) => console.error('  - ' + x));
      process.exit(1);
    }
    writeFileSync(out, serialize(wf), 'utf8');
  }
  console.log('P9-R3 isolated Lead Intake dedup-outage harness');
  console.log('  H1 (credential-free) : n8n/candidate/li-dedup-outage-h1-candidate.json  /webhook/' + H1_PATH);
  console.log('  H2 (dead credential) : n8n/candidate/li-dedup-outage-h2-candidate.json  /webhook/' + H2_PATH);
  console.log('  source nodes         : ' + src.nodes.length);
  console.log('  divergence allowlist : ' + allow.length + ' computed from node type + the webhook');
  console.log('  byte-identical nodes : ' + (src.nodes.length - allow.length));
  console.log('  defect under test    : ' + DEDUP_NODE + ' alwaysOutputData + continueErrorOutput, mirrored');
  console.log('  retention            : ON (runData is the evidence)');
  console.log('  error workflow       : removed (the harness fails on purpose)');
  console.log('  production creds     : absent');
  console.log('  verification         : PASS');
}
