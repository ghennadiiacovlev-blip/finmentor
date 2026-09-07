#!/usr/bin/env node
// FINMENTOR — P7.3 step 2 §8 harness fidelity gate.
//
//   node qa/concierge-issuer-harness.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. The §8 harness is the thing that actually ran the issuer against the
// live stores. Everything the live run proved is only worth what this file is worth, because
// the live run proves things about the code the harness CONTAINED. Two claims therefore have
// to hold, and neither may be taken on trust:
//
//   1. FIDELITY. Every inherited node is byte-identical to the audited wrapper. If one Code
//      body drifted by a character, the live proof is a proof about a different program.
//   2. CONTAINMENT. The harness cannot touch Telegram, cannot reach the live intake endpoint,
//      cannot call the live transport, and cannot be activated. The whole reason a harness was
//      built instead of enabling the canary's trigger was to keep the bot out of it.
//
// Then the mutation battery: every way a future edit could quietly turn the harness into
// something that either proves less than it claims or reaches further than it should.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const M = await import('file://' + join(ROOT, 'scripts', 'build-concierge-issuer-harness.mjs').replace(/\\/g, '/'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const deepEq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m); } };

const WRAPPER = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json'), 'utf8'));
const harnessRaw = readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-HARNESS.json'), 'utf8');
const HARNESS = JSON.parse(harnessRaw);
const clone = (v) => JSON.parse(JSON.stringify(v));
const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);

// ================================================================ 1. freshness

console.log('\n-- the tracked harness artifact --');

check('the harness is not stale: regeneration is byte-identical', () => {
  eq(M.serializeHarness(M.buildHarness(WRAPPER)), harnessRaw,
    'the tracked harness differs from a fresh build -- re-run the generator');
});

check('the on-disk harness verifies', () => {
  const v = M.verifyHarness(WRAPPER, HARNESS);
  assert(v.ok, 'verification failed: ' + v.failures.join(' | '));
});

check('building the harness does not mutate the wrapper', () => {
  const before = JSON.stringify(WRAPPER);
  M.buildHarness(WRAPPER);
  eq(JSON.stringify(WRAPPER), before, 'buildHarness mutated its input');
});

// ================================================================ 2. fidelity

console.log('\n-- every inherited node is byte-identical to the audited wrapper --');

check('all 23 inherited nodes are present and byte-identical', () => {
  eq(M.INHERITED_VERBATIM.length, 23, 'the inherited list changed size');
  M.INHERITED_VERBATIM.forEach((name) => {
    const w = byName(WRAPPER, name);
    const h = byName(HARNESS, name);
    assert(w, 'the wrapper has no node named ' + name);
    assert(h, 'the harness has no node named ' + name);
    deepEq(h, w, 'inherited node drifted: ' + name);
  });
});

check('the issuer Code bodies are the audited ones, character for character', () => {
  ['Get Bot Session', 'Issuance Gate', 'Issuance Verdict', 'Authority Verdict',
    'Build Session Row', 'Find Session', 'Parse Telegram Update'].forEach((n) => {
    eq(byName(HARNESS, n).parameters.jsCode, byName(WRAPPER, n).parameters.jsCode,
      'jsCode drifted on ' + n);
  });
});

check('the mint primitive survived into the harness', () => {
  const code = byName(HARNESS, 'Get Bot Session').parameters.jsCode;
  assert(code.includes("require('crypto').randomBytes(16)"),
    'the audited entropy source is not in the harness body');
  assert(code.includes('sub_[0-9a-f]{32}'), 'the key format rule is not in the harness body');
});

check('both Data Table nodes are inherited and still bound to Submission_Receipts', () => {
  const dts = (HARNESS.nodes || []).filter((n) => n.type === 'n8n-nodes-base.dataTable');
  eq(dts.length, 2, 'not exactly two Data Table nodes');
  dts.forEach((n) => eq(n.parameters.dataTableId.value, 'Submission_Receipts', 'wrong table on ' + n.name));
});

check('the four Sheets nodes are inherited, and the three writers that would widen state are not', () => {
  const sheets = (HARNESS.nodes || []).filter((n) => n.type === 'n8n-nodes-base.googleSheets').map((n) => n.name).sort();
  deepEq(sheets, ['Authority Reread', 'Read Bot Sessions', 'Read Settings', 'Save Bot Session'],
    'the Sheets node set is not the expected four: ' + sheets.join(', '));
});

// ================================================================ 3. containment

console.log('\n-- the harness cannot reach Telegram, intake, or activation --');

check('ZERO Telegram nodes of any type', () => {
  const tg = (HARNESS.nodes || []).filter((n) => /telegram/i.test(String(n.type)));
  eq(tg.length, 0, 'Telegram nodes present: ' + tg.map((n) => n.name + ' [' + n.type + ']').join(', '));
});

check('no Telegram credential reference anywhere in the document', () => {
  const blob = JSON.stringify(HARNESS);
  assert(!/telegramApi/.test(blob), 'a telegramApi reference survives');
  assert(!blob.includes('2JnVm0BIX0Z8tvBf'), 'the Concierge bot credential id appears');
});

check('THE SUBSTITUTION: Telegram Client Trigger keeps its NAME and loses everything else', () => {
  // The name is not cosmetic. Parse Telegram Update resolves it, so renaming it would mean the
  // live run exercised a different program than the audited one.
  const w = byName(WRAPPER, 'Telegram Client Trigger');
  const h = byName(HARNESS, 'Telegram Client Trigger');
  eq(w.type, 'n8n-nodes-base.telegramTrigger', 'the wrapper node is no longer a telegramTrigger');
  eq(h.type, 'n8n-nodes-base.code', 'the harness substitute is not a Code node');
  assert(!h.credentials, 'the substitute carries credentials');
  assert(byName(HARNESS, 'Parse Telegram Update').parameters.jsCode.includes("$('Telegram Client Trigger')"),
    'Parse Telegram Update no longer resolves that name -- the substitution has lost its purpose');
});

check('no httpRequest node: the live intake endpoint is unreachable', () => {
  eq((HARNESS.nodes || []).filter((n) => n.type === 'n8n-nodes-base.httpRequest').length, 0,
    'an httpRequest node is present');
});

check('no executeWorkflow node: the live transport cannot be called', () => {
  eq((HARNESS.nodes || []).filter((n) => n.type === 'n8n-nodes-base.executeWorkflow').length, 0,
    'an executeWorkflow node is present');
  assert(!JSON.stringify(HARNESS).includes('ShcmmJeLSE8LYVBk'), 'the transport workflow id appears');
});

check('every excluded production node really is excluded', () => {
  Object.keys(M.EXCLUDED_NODES).forEach((n) => {
    assert(!byName(HARNESS, n), 'an EXCLUDED node is present: ' + n);
  });
  assert(Object.keys(M.EXCLUDED_NODES).length >= 9, 'the exclusion list was trimmed');
});

check('NON-ACTIVATABLE: exactly one trigger, and it has no public surface', () => {
  const trig = (HARNESS.nodes || []).filter((n) => /trigger$/i.test(String(n.type)));
  eq(trig.length, 1, 'not exactly one trigger: ' + trig.map((n) => n.name).join(', '));
  eq(trig[0].type, 'n8n-nodes-base.executeWorkflowTrigger', 'the trigger is not an executeWorkflowTrigger');
  eq((HARNESS.nodes || []).filter((n) => n.type === 'n8n-nodes-base.webhook').length, 0, 'a webhook node is present');
});

check('the harness does not inherit the live error workflow binding', () => {
  assert(!Object.prototype.hasOwnProperty.call(HARNESS.settings, 'errorWorkflow'),
    'the harness would page the owner on a test fault');
  eq(HARNESS.settings.availableInMCP, false, 'availableInMCP must be false; the DRIVER is what gets tested');
});

check('the harness is the four-field REST create shape', () => {
  deepEq(Object.keys(HARNESS).sort(), ['connections', 'name', 'nodes', 'settings'], 'wrong field set');
  assert(/NON-ACTIVATABLE/.test(HARNESS.name), 'the name does not say what the artifact is');
});

// ================================================================ 4. the graph is complete

console.log('\n-- the wiring reaches the issuer and terminates observably --');

check('every connection endpoint is a real node', () => {
  Object.keys(HARNESS.connections).forEach((src) => {
    assert(byName(HARNESS, src), 'connection source is not a node: ' + src);
    (HARNESS.connections[src].main || []).forEach((br) => (br || []).forEach((l) => {
      assert(byName(HARNESS, l.node), 'connection target is not a node: ' + l.node);
    }));
  });
});

check('the mint lies on a path from the entry to the authority write', () => {
  const seen = new Set(['HARNESS Entry']);
  const q = ['HARNESS Entry'];
  while (q.length) {
    const c = HARNESS.connections[q.shift()];
    if (!c) { continue; }
    (c.main || []).forEach((br) => (br || []).forEach((l) => {
      if (!seen.has(l.node)) { seen.add(l.node); q.push(l.node); }
    }));
  }
  ['Get Bot Session', 'Issuance Gate', 'Receipt Preallocate', 'Receipt Readback',
    'Issuance Verdict', 'Build Session Row', 'Save Bot Session', 'Authority Reread',
    'Authority Verdict'].forEach((n) => assert(seen.has(n), n + ' is unreachable from HARNESS Entry'));
});

check('all four outcome terminals exist and are reachable', () => {
  M.ADDED_NODES.filter((n) => n.startsWith('HARNESS Result')).forEach((n) => {
    assert(byName(HARNESS, n), 'terminal missing: ' + n);
  });
  const targets = new Set();
  Object.keys(HARNESS.connections).forEach((s) =>
    (HARNESS.connections[s].main || []).forEach((br) => (br || []).forEach((l) => targets.add(l.node))));
  M.ADDED_NODES.filter((n) => n.startsWith('HARNESS Result')).forEach((n) => {
    assert(targets.has(n), 'terminal is wired to nothing: ' + n);
  });
});

// ================================================================ 5. mutation battery

console.log('\n-- the verifier rejects every corrupted harness --');

function mustReject(label, mutate, expectSubstring) {
  check('REJECTS: ' + label, () => {
    const m = clone(HARNESS);
    mutate(m);
    const v = M.verifyHarness(WRAPPER, m);
    assert(!v.ok, 'the verifier ACCEPTED a harness with: ' + label);
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'rejected, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

mustReject('one byte changed in an inherited Code body', (m) => {
  byName(m, 'Issuance Gate').parameters.jsCode += ' ';
}, 'NOT byte-identical');
mustReject('the mint body swapped for a stub', (m) => {
  byName(m, 'Get Bot Session').parameters.jsCode = 'return [{ json: { submission_key: "sub_" + "0".repeat(32) } }];';
}, 'NOT byte-identical');
mustReject('an inherited node dropped', (m) => {
  m.nodes = m.nodes.filter((n) => n.name !== 'Receipt Readback');
}, 'inherited node missing');
mustReject('a Telegram trigger reintroduced', (m) => {
  m.nodes.push({ parameters: {}, id: 'x', name: 'Real TG', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.2, position: [0, 0] });
}, 'contains Telegram node');
mustReject('a Telegram action node reintroduced', (m) => {
  m.nodes.push({ parameters: {}, id: 'x', name: 'Answer', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [0, 0] });
}, 'contains Telegram node');
mustReject('the bot credential smuggled onto any node', (m) => {
  byName(m, 'Read Settings').credentials.telegramApi = { id: '2JnVm0BIX0Z8tvBf', name: 'FINMENTOR Client Concierge Bot' };
}, 'telegramApi credential reference survives');
mustReject('the substitution turned back into a real trigger', (m) => {
  byName(m, 'Telegram Client Trigger').type = 'n8n-nodes-base.telegramTrigger';
}, 'contains Telegram node');
mustReject('the substitution given a credential', (m) => {
  byName(m, 'Telegram Client Trigger').credentials = { telegramApi: { id: 'X', name: 'Y' } };
}, 'telegramApi credential reference survives');
mustReject('the substitution deleted, so Parse Telegram Update would throw', (m) => {
  m.nodes = m.nodes.filter((n) => n.name !== 'Telegram Client Trigger');
}, 'no Telegram Client Trigger substitute');
mustReject('a webhook added as a second entry', (m) => {
  m.nodes.push({ parameters: { path: 'x' }, id: 'x', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] });
}, 'expected exactly one trigger');
mustReject('an httpRequest node added: the live intake becomes reachable', (m) => {
  m.nodes.push({ parameters: { url: 'https://example.invalid' }, id: 'x', name: 'Call', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0] });
}, 'contains an httpRequest node');
mustReject('an executeWorkflow node added: the live transport becomes callable', (m) => {
  m.nodes.push({ parameters: {}, id: 'x', name: 'Send', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [0, 0] });
}, 'contains an executeWorkflow node');
mustReject('an excluded production node reinstated', (m) => {
  m.nodes.push({ parameters: {}, id: 'x', name: 'Save Bot Event', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] });
}, 'an EXCLUDED node is present');
mustReject('a Data Table node dropped: the run would prove nothing about the receipt', (m) => {
  m.nodes = m.nodes.filter((n) => n.name !== 'Receipt Preallocate');
}, 'issuer node missing');
mustReject('the live error workflow binding inherited', (m) => {
  m.settings.errorWorkflow = 'RBiFLhVjizMkAzrK';
}, 'must not inherit the live error workflow');
mustReject('availableInMCP flipped on', (m) => { m.settings.availableInMCP = true; }, 'availableInMCP must be false');
mustReject('a connection pointing at a node that does not exist', (m) => {
  m.connections['Issuance Gate'].main[0].push({ node: 'Ghost', type: 'main', index: 0 });
}, 'connection target is not a node');

check('CONTROL: the unmutated harness is accepted', () => {
  const v = M.verifyHarness(WRAPPER, clone(HARNESS));
  assert(v.ok, 'the verifier rejects the real harness: ' + v.failures.join(' | '));
});

// ================================================================ 6. the drift variant

console.log('\n-- the P7.4 drift variant: one edge, two nodes, nothing else --');

const driftRaw = readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-HARNESS-DRIFT.json'), 'utf8');
const DRIFT = JSON.parse(driftRaw);

check('the drift variant is not stale: regeneration is byte-identical', () => {
  eq(M.serializeHarness(M.buildDriftHarness(WRAPPER)), driftRaw,
    'the tracked drift harness differs from a fresh build -- re-run the generator');
});

check('the on-disk drift variant verifies against the base harness', () => {
  const v = M.verifyDriftHarness(HARNESS, DRIFT);
  assert(v.ok, 'verification failed: ' + v.failures.join(' | '));
});

check('every base node survives the splice byte-identically', () => {
  HARNESS.nodes.forEach((n) => {
    const d = byName(DRIFT, n.name);
    assert(d, 'base node missing from the drift variant: ' + n.name);
    deepEq(d, n, 'the splice MODIFIED a base node: ' + n.name);
  });
  eq(DRIFT.nodes.length, HARNESS.nodes.length + 2, 'the drift variant is not base + exactly two nodes');
});

check('the injection sits between the authority write and the reread', () => {
  // That interval is the ONLY one in which the reread can observe anything other than what this
  // turn just wrote, which is why a real concurrent winner's write lands exactly there.
  const after = DRIFT.connections['Save Bot Session'].main[0];
  eq(after.length, 1, 'Save Bot Session fans out');
  eq(after[0].node, 'HARNESS Drift Compose', 'Save Bot Session does not feed the injection');
  eq(DRIFT.connections['HARNESS Drift Write'].main[0][0].node, 'IF Lead Ready',
    'the injection does not hand back to IF Lead Ready');
  eq(HARNESS.connections['Save Bot Session'].main[0][0].node, 'IF Lead Ready',
    'the BASE harness no longer goes straight to IF Lead Ready; the comparison is meaningless');
});

check('the competing write uses the audited mapping, not a hand-rolled one', () => {
  const save = byName(DRIFT, 'Save Bot Session');
  const dw = byName(DRIFT, 'HARNESS Drift Write');
  deepEq(dw.parameters, save.parameters, 'the drift write parameters diverge from Save Bot Session');
  deepEq(dw.credentials, save.credentials, 'the drift write credentials diverge from Save Bot Session');
});

check('the drift variant refuses to run without a competing pair', () => {
  // A drift harness that quietly failed to drift would report a clean AUTHORITY_CURRENT and be
  // read as a PASSING stale-context test. That is the worst failure available to this artifact,
  // so the body throws rather than passing the row through.
  const code = byName(DRIFT, 'HARNESS Drift Compose').parameters.jsCode;
  assert(/DRIFT REFUSED/.test(code), 'the compose body has no refusal path');
  assert(/\^C-\\d\+-\\d\+\$/.test(code), 'the competing cycle shape is not validated');
  assert(/\^sub_\[0-9a-f\]\{32\}\$/.test(code), 'the competing key shape is not validated');
  assert(/nothing would drift/.test(code), 'a no-op drift is not refused');
});

check('the drift variant is still a containment-clean harness', () => {
  eq(DRIFT.nodes.filter((n) => /telegram/i.test(String(n.type))).length, 0, 'Telegram node present');
  assert(!/telegramApi/.test(JSON.stringify(DRIFT)), 'a telegramApi reference survives');
  eq(DRIFT.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').length, 0, 'httpRequest present');
  eq(DRIFT.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow').length, 0, 'executeWorkflow present');
  eq(DRIFT.nodes.filter((n) => /trigger$/i.test(String(n.type))).length, 1, 'not exactly one trigger');
  assert(DRIFT.name !== HARNESS.name, 'the drift variant is indistinguishable by name');
  assert(/NON-ACTIVATABLE/.test(DRIFT.name), 'the name does not say what it is');
});

function mustRejectDrift(label, mutate, expectSubstring) {
  check('REJECTS: ' + label, () => {
    const m = clone(DRIFT);
    mutate(m);
    const v = M.verifyDriftHarness(HARNESS, m);
    assert(!v.ok, 'the verifier ACCEPTED a drift harness with: ' + label);
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'rejected, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

mustRejectDrift('the splice bypassed, so nothing ever drifts', (m) => {
  m.connections['Save Bot Session'] = { main: [[{ node: 'IF Lead Ready', type: 'main', index: 0 }]] };
}, 'connections differ at');
mustRejectDrift('the injection moved AFTER the reread, where it cannot be observed', (m) => {
  m.connections['HARNESS Drift Write'] = { main: [[{ node: 'Authority Verdict', type: 'main', index: 0 }]] };
}, 'does not hand back to IF Lead Ready');
mustRejectDrift('a base node edited by the splice', (m) => {
  byName(m, 'Authority Verdict').parameters.jsCode += ' ';
}, 'was MODIFIED by the splice');
mustRejectDrift('the drift write given a different mapping', (m) => {
  byName(m, 'HARNESS Drift Write').parameters.columns = { mappingMode: 'defineBelow', value: {} };
}, 'not byte-identical to Save Bot Session');
mustRejectDrift('a third injection node smuggled in', (m) => {
  m.nodes.push({ parameters: {}, id: 'x', name: 'HARNESS Drift Extra', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] });
}, 'expected exactly the two injection nodes');
mustRejectDrift('the drift variant renamed to look like the base harness', (m) => {
  m.name = HARNESS.name;
}, 'not distinguishable by name');

check('CONTROL: the unmutated drift variant is accepted', () => {
  const v = M.verifyDriftHarness(HARNESS, clone(DRIFT));
  assert(v.ok, 'the verifier rejects the real drift harness: ' + v.failures.join(' | '));
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
