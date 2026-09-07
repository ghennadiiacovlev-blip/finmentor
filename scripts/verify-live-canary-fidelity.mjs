#!/usr/bin/env node
// FINMENTOR — P6.2 live fidelity proof for the deployed B21C receipt canary.
//
//   node scripts/verify-live-canary-fidelity.mjs <live-definition.json>
//
// Takes a definition FETCHED from live n8n and proves the deployed graph is the artifact.
// Offline itself: it reads two files and compares them, so it holds no credential and makes
// no network call. The fetch is the caller's job.
//
// WHY A SEPARATE, DEEPER CHECK. The deploy script verifies seven surface properties against
// the live object -- active, name, node count, the webhook, the production path,
// availableInMCP. Those establish that the workflow is INERT. They do not establish that the
// 98,890 characters of production Code bodies arrived unaltered, and that is the whole reason
// the REST route was chosen over hand transcription. This is where that claim is settled.
//
// The comparison is deliberately one-directional about server-added fields: n8n assigns an
// id, timestamps, a versionId and per-node webhookIds on create, and those are EXPECTED to
// appear. What must not differ is anything the artifact actually specified.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ARTIFACT = join(ROOT, 'n8n', 'candidate', 'lead-intake-internal-receipt-API-IMPORT.json');

const livePath = process.argv[2];
if (!livePath) {
  console.error('usage: node scripts/verify-live-canary-fidelity.mjs <live-definition.json>');
  process.exit(2);
}

const A = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
const L = JSON.parse(readFileSync(livePath, 'utf8'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (live=' + JSON.stringify(a) + ' artifact=' + JSON.stringify(b) + ')'); };

console.log('\n-- identity and lifecycle --');

check('the live workflow is INACTIVE', () => eq(L.active, false, 'active'));
check('the name is the canary name', () => eq(L.name, A.name, 'name'));
check('it is not the production workflow', () => {
  assert(L.id !== 'QmIyEW2ZEqKregmN', 'THIS IS THE PRODUCTION WORKFLOW ID');
  assert(L.name !== 'FINMENTOR Lead Intake PREMIUM FINAL', 'name collides with production');
});

console.log('\n-- graph fidelity --');

check('node count matches the artifact exactly', () => eq(L.nodes.length, A.nodes.length, 'node count'));

check('the node NAME SET matches exactly', () => {
  const a = A.nodes.map((n) => n.name).sort();
  const l = L.nodes.map((n) => n.name).sort();
  const missing = a.filter((n) => !l.includes(n));
  const extra = l.filter((n) => !a.includes(n));
  assert(!missing.length, 'nodes missing from live: ' + missing.join(', '));
  assert(!extra.length, 'unexpected nodes in live: ' + extra.join(', '));
});

check('every node TYPE and typeVersion matches', () => {
  const byName = (wf) => Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const a = byName(A), l = byName(L);
  for (const name of Object.keys(a)) {
    eq(l[name].type, a[name].type, 'type of ' + name);
    eq(l[name].typeVersion, a[name].typeVersion, 'typeVersion of ' + name);
  }
});

check('all Code bodies are BYTE-IDENTICAL, and non-trivial', () => {
  const code = (wf) => wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
  const a = code(A), l = code(L);
  eq(l.length, a.length, 'Code node count');
  const lByName = Object.fromEntries(l.map((n) => [n.name, n]));
  let chars = 0;
  for (const n of a) {
    const live = lByName[n.name];
    assert(live, 'Code node absent from live: ' + n.name);
    const x = n.parameters.jsCode, y = live.parameters.jsCode;
    assert(typeof y === 'string', 'live jsCode is not a string for ' + n.name);
    if (x !== y) {
      // Locate the first divergence — a silent single-character drift is exactly the failure
      // mode this whole route exists to rule out, so report where it is.
      let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
      throw new Error('jsCode DIFFERS in "' + n.name + '" at offset ' + i
        + ' (artifact ' + x.length + ' chars, live ' + y.length + ')');
    }
    chars += x.length;
  }
  assert(chars > 90000, 'Code bodies total only ' + chars + ' chars — suspiciously small');
  console.log('        (' + a.length + ' Code nodes, ' + chars + ' characters, all identical)');
});

check('every non-webhook node PARAMETER BLOCK is byte-identical', () => {
  const byName = (wf) => Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const a = byName(A), l = byName(L);
  const diffs = [];
  for (const name of Object.keys(a)) {
    if (a[name].type === 'n8n-nodes-base.webhook') continue;
    if (JSON.stringify(a[name].parameters) !== JSON.stringify(l[name].parameters)) diffs.push(name);
  }
  assert(!diffs.length, 'parameters differ in: ' + diffs.join(', '));
});

check('connections are byte-identical', () => {
  eq(JSON.stringify(L.connections), JSON.stringify(A.connections), 'connections');
});

check('every credential reference is unchanged', () => {
  const byName = (wf) => Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const a = byName(A), l = byName(L);
  const diffs = [];
  for (const name of Object.keys(a)) {
    const x = JSON.stringify(a[name].credentials || null);
    const y = JSON.stringify(l[name].credentials || null);
    if (x !== y) diffs.push(name + ' (artifact ' + x + ' live ' + y + ')');
  }
  assert(!diffs.length, 'credential references differ: ' + diffs.join('; '));
});

console.log('\n-- the safety properties, on the LIVE object --');

check('the production webhook path is absent from the whole definition', () => {
  assert(!JSON.stringify(L).includes('finmentor-lead-intake'), 'production path present');
});

check('exactly one webhook node, and it is disabled', () => {
  const hooks = L.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  eq(hooks.length, 1, 'webhook count');
  eq(hooks[0].disabled, true, 'webhook disabled');
  eq(hooks[0].parameters.path, '__disabled_b21c_internal_candidate', 'webhook path');
});

check('the internal sub-workflow trigger is present', () => {
  const t = L.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  assert(t.length >= 1, 'internal trigger absent');
});

check('settings.availableInMCP is false on the live object', () => {
  eq(L.settings.availableInMCP, false, 'availableInMCP');
});

check('no node was silently enabled that the artifact had disabled', () => {
  const byName = (wf) => Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const a = byName(A), l = byName(L);
  const bad = [];
  for (const name of Object.keys(a)) {
    if (a[name].disabled === true && l[name].disabled !== true) bad.push(name);
  }
  assert(!bad.length, 'nodes disabled in the artifact but ENABLED live: ' + bad.join(', '));
});

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
