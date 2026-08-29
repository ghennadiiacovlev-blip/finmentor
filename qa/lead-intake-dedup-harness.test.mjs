#!/usr/bin/env node
// FINMENTOR — P9-R3: the isolated Lead Intake dedup-outage harness, pre-deploy validation.
//
//   node qa/lead-intake-dedup-harness.test.mjs
//
// Offline. No tenant, no network, no Google, no credentials.
//
// WHAT THIS GATE IS FOR. The harness exists to answer one question — on a Pipeline dedup READ
// failure, does the success branch reach `Save to Pipeline`, a write? — without touching
// production. That answer is only worth anything if the harness is provably the DEPLOYED graph
// with a short, declared list of differences. Otherwise a confirmed finding from the harness
// says nothing about Lead Intake. So this gate asserts:
//
//   1. FIDELITY. Every node outside the computed allowlist is byte-identical to the tracked
//      Lead Intake export, the connection map is identical, and the flag pair under test is
//      mirrored exactly rather than asserted.
//   2. ISOLATION. Neither harness can reach the production spreadsheet, the production receipt
//      data table, the production Lead Intake route, the production Error Monitor, or any
//      side-effecting node type.
//   3. THE CONTROLS EXIST. The stand-in can express all four modes, including a legitimately
//      EMPTY read — without which the outage cannot be shown to be indistinguishable from it.
//
// And then it MUTATES each of those properties and requires the builder to REFUSE. P9-R1 is the
// reason: a gate that cannot reject the bad form is decoration.
//
// TWO THINGS THIS GATE ENFORCES BECAUSE THEY WERE FOUND THE HARD WAY, not by review:
//
//   - The tracked export carries an `activeVersion` blob — an entire SECOND copy of the
//     production graph. Building by deleting known-bad top-level keys shipped the production
//     spreadsheet id inside it. The builder now emits ONLY name/nodes/connections/settings, and
//     the exact key set is asserted here.
//   - `sheetName.cachedResultUrl` embeds the spreadsheet id in a field that looks like a display
//     label. H2 must not carry it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildHarness, verifyHarness, divergenceAllowlist, isSideEffecting, SIDE_EFFECTING_TYPES,
  DEDUP_NODE, GUARD_NODE, WRITE_NODE, BUILD_ROW_NODE, SETTINGS_NODE, WEBHOOK_NODE,
  H1_PATH, H2_PATH, PRODUCTION_PATH, CREDENTIAL_PLACEHOLDER, DOCUMENT_PLACEHOLDER,
  PRODUCTION_SPREADSHEET_ID, PRODUCTION_RECEIPT_TABLE, PRODUCTION_ERROR_WORKFLOW
} from '../scripts/build-lead-intake-dedup-harness.mjs';

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

const SRC = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production', 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const nodeOf = (wf, n) => wf.nodes.find((x) => x.name === n);

const H1 = buildHarness(SRC, 'h1');
const H2 = buildHarness(SRC, 'h2');
const ALLOW = divergenceAllowlist(SRC);

console.log('P9-R3 Lead Intake dedup-outage harness — pre-deploy validation');
console.log('');

// ---------------------------------------------------------------- the defect under test

// P9-R4. The base is now the REMEDIATED graph. These checks flipped from "the defect is present
// so the harness has something to find" to "the defect is gone and cannot come back" — the
// harness itself is unchanged and still mirrors whatever base it is handed, which is what lets
// the same rig prove the fix that found the fault.
check('production no longer carries the flag pair (P9-R4 remediated)', () => {
  const d = nodeOf(SRC, DEDUP_NODE);
  assert(d, DEDUP_NODE + ' is absent from the tracked export');
  eq(d.alwaysOutputData, true, 'the dedup read lost alwaysOutputData; an empty Pipeline sheet would stall');
  eq(d.onError, 'continueRegularOutput', 'the dedup read is not routing its failure to the regular output');
});

check('NO node anywhere in Lead Intake carries the fail-open pair', () => {
  const both = SRC.nodes.filter((n) => n.alwaysOutputData === true && n.onError === 'continueErrorOutput');
  eq(both.length, 0, 'the P9-R2 flag pair is present on: ' + both.map((n) => n.name).join(', '));
});

check('both harnesses mirror the base state rather than asserting one', () => {
  const base = nodeOf(SRC, DEDUP_NODE);
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    const d = nodeOf(wf, DEDUP_NODE);
    eq(d.alwaysOutputData, base.alwaysOutputData, v + ' dedup read does not mirror alwaysOutputData');
    eq(d.onError, base.onError, v + ' dedup read does not mirror onError');
  }
});

check('Dedup Guard fails closed and routes its error output', () => {
  const g = nodeOf(SRC, GUARD_NODE);
  eq(g.onError, 'continueErrorOutput', GUARD_NODE + ' does not route its error output');
  assert(g.alwaysOutputData !== true, GUARD_NODE + ' carries alwaysOutputData; a throw would still emit a success item');
  assert(g.parameters.jsCode.indexOf('DEDUP_READ_FAULT') !== -1, GUARD_NODE + ' does not fail closed on a faulted read');
  assert(g.parameters.jsCode.indexOf('PIPELINE_FIELDS') !== -1, GUARD_NODE + ' has no positive row classification');
});

// ---------------------------------------------------------------- fidelity

check('node count and connection map are identical to Lead Intake', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    eq(wf.nodes.length, SRC.nodes.length, v + ' node count differs');
    eq(JSON.stringify(wf.connections), JSON.stringify(SRC.connections), v + ' connection map differs');
  }
});

check('every node outside the allowlist is byte-identical', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    for (const g of SRC.nodes) {
      if (ALLOW.indexOf(g.name) !== -1) { continue; }
      const h = nodeOf(wf, g.name);
      assert(h, v + ' is missing node ' + g.name);
      eq(JSON.stringify(h.parameters), JSON.stringify(g.parameters), v + ' parameters differ on ' + g.name);
      eq(h.type, g.type, v + ' type differs on ' + g.name);
      eq(h.typeVersion, g.typeVersion, v + ' typeVersion differs on ' + g.name);
    }
  }
});

check('the allowlist is COMPUTED from node type, not hand-written', () => {
  const expected = SRC.nodes.filter((n) => isSideEffecting(n) || n.name === WEBHOOK_NODE).map((n) => n.name);
  eq(JSON.stringify(ALLOW.slice().sort()), JSON.stringify(expected.slice().sort()), 'allowlist is not the computed set');
  assert(ALLOW.length >= 20, 'the allowlist is implausibly small: ' + ALLOW.length);
  assert(SRC.nodes.length - ALLOW.length >= 75, 'too few nodes are byte-identical to be a faithful copy');
});

check('the nodes whose behaviour is in question are production\'s own', () => {
  const under = [GUARD_NODE, 'Receipt Gate', 'IF Receipt Fault', 'IF Receipt Required', 'IF Is New',
    BUILD_ROW_NODE, 'IF Internal (Infra)', 'Respond Infra Failed', 'Stop: CRM Unavailable',
    'Normalize + Score Lead', 'Correlation Guard'];
  for (const name of under) {
    assert(ALLOW.indexOf(name) === -1, name + ' is in the divergence allowlist; it must not be');
    for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
      eq(JSON.stringify(nodeOf(wf, name).parameters), JSON.stringify(nodeOf(SRC, name).parameters), v + ' modified ' + name);
    }
  }
});

check('the remediated wiring is intact: one read output, the fault contract on the guard', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    const d = wf.connections[DEDUP_NODE];
    eq(d.main.length, 1, v + ' the dedup read still has a second output; the race is back');
    eq(d.main[0][0].node, GUARD_NODE, v + ' dedup output is not wired to ' + GUARD_NODE);
    const g = wf.connections[GUARD_NODE];
    eq(g.main.length, 2, v + ' ' + GUARD_NODE + ' does not have both outputs wired');
    eq(g.main[0][0].node, 'Receipt Gate', v + ' ' + GUARD_NODE + ' success output moved');
    eq(g.main[1][0].node, 'IF Internal (Infra)', v + ' ' + GUARD_NODE + ' error output is not wired to IF Internal (Infra)');
    eq(wf.connections['IF Is New'].main[0][0].node, BUILD_ROW_NODE, v + ' IF Is New true branch moved');
    eq(wf.connections[BUILD_ROW_NODE].main[0][0].node, WRITE_NODE, v + ' ' + BUILD_ROW_NODE + ' no longer feeds ' + WRITE_NODE);
  }
});

check('the 503 CRM_UNAVAILABLE contract the fault routes to is untouched', () => {
  const r = nodeOf(SRC, 'Respond Infra Failed');
  eq(r.parameters.options.responseCode, 503, 'Respond Infra Failed is not a numeric 503');
  assert(String(r.parameters.responseBody).indexOf('CRM_UNAVAILABLE') !== -1, 'lost error_code CRM_UNAVAILABLE');
  assert(String(r.parameters.responseBody).indexOf('retryable: true') !== -1, 'lost retryable: true');
});

// ---------------------------------------------------------------- isolation

check('no production spreadsheet, receipt table or error workflow anywhere', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    const j = JSON.stringify(wf);
    assert(j.indexOf(PRODUCTION_SPREADSHEET_ID) === -1, v + ' references the production spreadsheet');
    assert(j.indexOf(PRODUCTION_RECEIPT_TABLE) === -1, v + ' references the production receipt table');
    assert(j.indexOf(PRODUCTION_ERROR_WORKFLOW) === -1, v + ' would page the production Error Monitor');
  }
});

check('only name/nodes/connections/settings survive the build', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    eq(Object.keys(wf).sort().join(','), 'connections,name,nodes,settings', v + ' carries extra top-level fields');
  }
});

check('the activeVersion blob in the tracked export really does carry the spreadsheet id', () => {
  // Proves the previous check is load-bearing rather than defensive decoration.
  assert(SRC.activeVersion, 'the tracked export no longer has an activeVersion blob; revisit this gate');
  assert(JSON.stringify(SRC.activeVersion).indexOf(PRODUCTION_SPREADSHEET_ID) !== -1,
    'activeVersion no longer carries the spreadsheet id; revisit this gate');
});

check('H1 is completely credential-free and side-effect-free', () => {
  eq(H1.nodes.filter((n) => n.credentials).length, 0, 'H1 carries a credential');
  for (const t of SIDE_EFFECTING_TYPES) {
    eq(H1.nodes.filter((n) => n.type === t).length, 0, 'H1 carries a ' + t + ' node');
  }
});

check('H2 carries exactly one Sheets node, one credential, and no cached production URL', () => {
  const sheets = H2.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets');
  eq(sheets.length, 1, 'H2 does not have exactly one Sheets node');
  eq(sheets[0].name, DEDUP_NODE, 'H2 Sheets node is not the dedup read');
  const creds = H2.nodes.filter((n) => n.credentials);
  eq(creds.length, 1, 'H2 does not carry exactly one credential');
  eq(creds[0].name, DEDUP_NODE, 'H2 credential is not on the dedup read');
  eq(creds[0].credentials.googleSheetsOAuth2Api.id, CREDENTIAL_PLACEHOLDER, 'H2 credential is not the placeholder');
  eq(sheets[0].parameters.documentId.value, DOCUMENT_PLACEHOLDER, 'H2 document id is not the placeholder');
  assert(!sheets[0].parameters.sheetName.cachedResultUrl, 'H2 sheetName still carries a cachedResultUrl');
  for (const t of SIDE_EFFECTING_TYPES) {
    if (t === 'n8n-nodes-base.googleSheets') { continue; }
    eq(H2.nodes.filter((n) => n.type === t).length, 0, 'H2 carries a ' + t + ' node');
  }
});

check('neither harness can seize the production Lead Intake route', () => {
  eq(nodeOf(H1, WEBHOOK_NODE).parameters.path, H1_PATH, 'H1 path is wrong');
  eq(nodeOf(H2, WEBHOOK_NODE).parameters.path, H2_PATH, 'H2 path is wrong');
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    assert(nodeOf(wf, WEBHOOK_NODE).parameters.path !== PRODUCTION_PATH, v + ' would seize the production route');
    assert(!nodeOf(wf, WEBHOOK_NODE).webhookId, v + ' kept the production webhookId');
  }
});

check('retention is ON and the error workflow is OFF', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    eq(wf.settings.saveDataSuccessExecution, 'all', v + ' does not retain success data');
    eq(wf.settings.saveDataErrorExecution, 'all', v + ' does not retain error data');
    eq(wf.settings.availableInMCP, false, v + ' is exposed to MCP');
    assert(!wf.settings.errorWorkflow, v + ' still routes failures to an error workflow');
    assert(wf.name.indexOf('[TEMP]') === 0, v + ' is not named as disposable');
  }
});

// ---------------------------------------------------------------- the controls

check('the H1 stand-in can express all four modes and refuses to default', () => {
  const c = nodeOf(H1, DEDUP_NODE).parameters.jsCode;
  for (const m of ['down', 'none', 'dup', 'new']) {
    assert(c.indexOf('"' + m + '"') !== -1, 'the stand-in cannot express mode ' + m);
  }
  assert(c.indexOf('if (mode === "none") { return []; }') !== -1, 'the stand-in cannot return a legitimately EMPTY read');
  assert(/throw new Error\("HARNESS: harness_dedup must be one of/.test(c), 'the stand-in defaults instead of throwing on an unknown mode');
  assert(/throw new Error\("HARNESS: simulated/.test(c), 'the stand-in cannot fail');
});

check('the dup row echoes client.email, the only place Normalize reads it from', () => {
  // Found by a control failing on the first live run: a top-level `email` is never read, so a
  // dup row built from one can never match and the control silently cannot pass.
  const c = nodeOf(H1, DEDUP_NODE).parameters.jsCode;
  assert(c.indexOf('src.client || {}') !== -1, 'the stand-in does not read the client object');
  assert(c.indexOf('String(client.email') !== -1, 'the dup row does not echo client.email');
  const norm = nodeOf(SRC, 'Normalize + Score Lead').parameters.jsCode;
  assert(/pick\(client\.email, lead\.email\)/.test(norm),
    'Normalize no longer reads pick(client.email, lead.email); the harness payload shape must be revisited');
});

check('the write stand-in records that it was reached and writes nothing', () => {
  const c = nodeOf(H1, WRITE_NODE).parameters.jsCode;
  assert(c.indexOf('__harness_write_reached') !== -1, 'the write stand-in does not record being reached');
  eq(nodeOf(H1, WRITE_NODE).type, 'n8n-nodes-base.code', 'the write stand-in is not a code node');
  eq(nodeOf(H2, WRITE_NODE).type, 'n8n-nodes-base.code', 'the H2 write stand-in is not a code node');
});

check('the settings stand-in bakes in no chat ids', () => {
  const c = nodeOf(H1, SETTINGS_NODE).parameters.jsCode;
  assert(c.indexOf('owner_chat_id') === -1, 'the settings stand-in names owner_chat_id');
  assert(c.indexOf('manager_chat_id') === -1, 'the settings stand-in names manager_chat_id');
  assert(!/\b\d{8,12}\b/.test(c), 'the settings stand-in carries a chat-id-shaped number');
});

// ---------------------------------------------------------------- the gate must REFUSE

// A gate that cannot reject the bad form is decoration. Each mutation below is a defect the
// builder's own verification must catch.
function mustRefuse(name, variant, mutate) {
  check('REFUSES: ' + name, () => {
    const wf = clone(variant === 'h1' ? H1 : H2);
    mutate(wf);
    const r = verifyHarness(SRC, wf, variant);
    assert(!r.ok, 'verification PASSED a mutated harness');
  });
}

mustRefuse('a node outside the allowlist is modified', 'h1', (wf) => {
  nodeOf(wf, GUARD_NODE).parameters.jsCode = '// tampered\nreturn $input.all();';
});
mustRefuse('the connection map is changed', 'h1', (wf) => {
  wf.connections[DEDUP_NODE].main[1] = [];
});
mustRefuse('the dedup error output is rewired away from the infra branch', 'h1', (wf) => {
  wf.connections[DEDUP_NODE].main[1] = [{ node: GUARD_NODE, type: 'main', index: 0 }];
});
mustRefuse('alwaysOutputData is dropped from the node under test', 'h1', (wf) => {
  delete nodeOf(wf, DEDUP_NODE).alwaysOutputData;
});
mustRefuse('the error routing is dropped from the node under test', 'h1', (wf) => {
  delete nodeOf(wf, DEDUP_NODE).onError;
});
mustRefuse('the stand-in loses its ability to return an empty read', 'h1', (wf) => {
  const d = nodeOf(wf, DEDUP_NODE);
  d.parameters.jsCode = d.parameters.jsCode.replace('if (mode === "none") { return []; }', '');
});
mustRefuse('the harness would seize the production route', 'h1', (wf) => {
  nodeOf(wf, WEBHOOK_NODE).parameters.path = PRODUCTION_PATH;
});
mustRefuse('a Sheets node is reintroduced into H1', 'h1', (wf) => {
  nodeOf(wf, WRITE_NODE).type = 'n8n-nodes-base.googleSheets';
});
mustRefuse('a data-table node is reintroduced', 'h1', (wf) => {
  nodeOf(wf, 'Receipt Claim').type = 'n8n-nodes-base.dataTable';
});
mustRefuse('the production spreadsheet id reappears', 'h1', (wf) => {
  nodeOf(wf, SETTINGS_NODE).parameters.jsCode += '\n// ' + PRODUCTION_SPREADSHEET_ID;
});
mustRefuse('the production receipt table reappears', 'h1', (wf) => {
  nodeOf(wf, SETTINGS_NODE).parameters.jsCode += '\n// ' + PRODUCTION_RECEIPT_TABLE;
});
mustRefuse('the error workflow is restored', 'h1', (wf) => {
  wf.settings.errorWorkflow = PRODUCTION_ERROR_WORKFLOW;
});
mustRefuse('retention is turned off, so runData could not be read', 'h1', (wf) => {
  wf.settings.saveDataSuccessExecution = 'none';
});
mustRefuse('the harness is exposed to MCP', 'h1', (wf) => {
  wf.settings.availableInMCP = true;
});
mustRefuse('the harness stops being named as disposable', 'h1', (wf) => {
  wf.name = 'FINMENTOR Lead Intake PREMIUM FINAL';
});
mustRefuse('an activeVersion blob is reattached', 'h1', (wf) => {
  wf.activeVersion = { nodes: [] };
});
mustRefuse('H1 gains a credential', 'h1', (wf) => {
  nodeOf(wf, WRITE_NODE).credentials = { googleSheetsOAuth2Api: { id: 'x', name: 'y' } };
});
mustRefuse('H2 points at the real production document', 'h2', (wf) => {
  nodeOf(wf, DEDUP_NODE).parameters.documentId.value = PRODUCTION_SPREADSHEET_ID;
});
mustRefuse('H2 moves its credential off the node under test', 'h2', (wf) => {
  const d = nodeOf(wf, DEDUP_NODE);
  const c = d.credentials; delete d.credentials;
  nodeOf(wf, WRITE_NODE).credentials = c;
});

// ---------------------------------------------------------------- the real builds must pass

check('the shipped H1 and H2 both pass their own verification', () => {
  for (const [v, wf] of [['h1', H1], ['h2', H2]]) {
    const r = verifyHarness(SRC, wf, v);
    assert(r.ok, v + ' failed: ' + r.failures.join('; '));
  }
});

check('the emitted candidates on disk match a fresh build', () => {
  // Compared with line endings NORMALISED, deliberately. core.autocrlf is true here and there is
  // no .gitattributes, so a checkout rewrites these LF artifacts to CRLF and a byte-exact compare
  // would then report a stale builder for a file that is character-for-character correct — a
  // known false failure in this repo. Content is the thing being gated; the newline convention
  // the working copy happens to hold is not.
  const lf = (s) => s.replace(/\r\n/g, '\n');
  for (const [v, wf, file] of [
    ['h1', H1, 'li-dedup-outage-h1-candidate.json'],
    ['h2', H2, 'li-dedup-outage-h2-candidate.json']
  ]) {
    const onDisk = readFileSync(join(ROOT, 'n8n', 'candidate', file), 'utf8');
    eq(lf(onDisk), lf(JSON.stringify(wf, null, 2) + '\n'), v + ' on disk is stale; re-run the builder');
  }
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
