#!/usr/bin/env node
// FINMENTOR — P7.3 step 2 §8: build the NON-ACTIVATABLE issuer test harness.
//
//   node scripts/build-concierge-issuer-harness.mjs
//
// REPO-ONLY. Reads the proven IMPORT-SAFE wrapper and writes a SEPARATE harness artifact
// beside it. It never contacts n8n, and it never mutates the candidate, the wrapper or the
// API-import projection.
//
// ================================================================================
// WHY A HARNESS EXISTS AT ALL
// ================================================================================
//
// P7.3 step 2 §2 asked whether the tenant test API can supply synthetic output to a DISABLED
// trigger, so the audited Concierge canary could be driven without ever enabling its Telegram
// trigger. Measured on disposable workflow DM4ZsMxiCqz65IIG, the answer is UNSUPPORTED, twice
// over -- see docs/P7_3_STEP2_DISABLED_TRIGGER_PROOF.md. The owner's §8 fallback therefore
// applies: a separate non-activatable harness that runs the EXACT issuer logic against a
// Telegram-shaped synthetic fixture, while the canary's trigger stays disabled and untouched.
//
// ================================================================================
// THE ONE NODE NAME THAT COULD NOT BE PREFIXED, AND WHY THAT IS THE WHOLE TRICK
// ================================================================================
//
// `Parse Telegram Update` opens with, verbatim and unmodifiable:
//
//     const u = $('Telegram Client Trigger').first().json;
//
// n8n resolves that by NODE NAME. A harness that renamed the entry would not be running the
// audited body -- it would be running a different program that happens to look like it. So the
// harness supplies a node genuinely named `Telegram Client Trigger`, and makes it a CODE node:
//
//   * it holds NO Telegram credential, so there is nothing for n8n to register with;
//   * it is not a trigger type, so it cannot be activated into a webhook;
//   * it emits the synthetic Telegram-shaped update at exactly the point the real trigger
//     would have, so every downstream body runs byte-identically and cannot tell the
//     difference.
//
// That substitution is the single most important thing in this file. It is declared here,
// listed in SUBSTITUTED_NODES, and asserted by qa/concierge-issuer-harness.test.mjs, which
// requires the harness to contain ZERO nodes of any Telegram type and ZERO Telegram
// credentials anywhere.
//
// ================================================================================
// WHAT IS COPIED, AND HOW "MECHANICALLY" IS MADE CHECKABLE
// ================================================================================
//
// Every inherited node is deep-cloned from the wrapper BY NAME and altered in no way at all --
// parameters, credentials, type, typeVersion, id, position, notes, onError, every key. Nothing
// is retyped, so no Code body can drift by a character. The gate proves it by diffing each
// inherited node against the wrapper's node of the same name and requiring byte equality; it
// does not re-run this generator, so a bug here cannot pass its own check.
//
// TWO SUBSTITUTIONS ONLY, both of which exist to keep Telegram out of the run:
//
//   `Telegram Client Trigger`   telegramTrigger -> Code. See above.
//   `HARNESS Delivery Stub`     stands in for `Send Client Message` + `IF Message Delivered`.
//                               Production reaches `Issuance Gate` only through that IF's TRUE
//                               branch, whose input is the transport response. The stub emits
//                               that shape without executing any Telegram node and without
//                               calling the live transport workflow, so no client message is
//                               ever sent. `correlation_id` is carried through from
//                               `Build Transport Request` verbatim because `Issuance Gate`
//                               reads it off $input.
//
// ================================================================================
// WHAT THE HARNESS DELIBERATELY STILL TOUCHES FOR REAL
// ================================================================================
//
// The live `Settings`, `Bot_Sessions` and `Submission_Receipts` stores, for RESERVED SYNTHETIC
// rows only (chat ids in the 900000xxx range). That is the point: a harness pointed at fixtures
// would prove nothing about production, and §4 authorises exactly this. §9 cleanup removes
// every row it writes.
//
// `settings.errorWorkflow` is deliberately NOT inherited. The harness is not production and
// must not page the owner. (Failure handling fires for production executions only in any case,
// and every harness run is manual -- so this is belt and braces, stated rather than assumed.)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json');
const OUT = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-HARNESS.json');
const OUT_DRIFT = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-HARNESS-DRIFT.json');

export const HARNESS_NAME = 'FINMENTOR P73S2 HARNESS Concierge issuer (NON-ACTIVATABLE)';
export const DRIFT_NAME = 'FINMENTOR P74 HARNESS authority drift injection (NON-ACTIVATABLE)';

// Inherited byte-for-byte from the wrapper, by name. Order here is the deploy order on canvas
// only; wiring is declared separately below.
export const INHERITED_VERBATIM = [
  'Read Settings',
  'Settings to Object',
  'Parse Telegram Update',
  'Read Bot Sessions',
  'Find Session',
  'Get Bot Session',
  'Build Bot Response',
  'Build Transport Request',
  'Issuance Gate',
  'IF Issuance Fault',
  'IF Preallocation Required',
  'Receipt Preallocate',
  'Receipt Readback',
  'Issuance Verdict',
  'IF Authority May Advance',
  'Build Issuance Failure Event',
  'Build Session Row',
  'Save Bot Session',
  'IF Lead Ready',
  'Authority Reread',
  'Authority Verdict',
  'IF Authority Current',
  'Build Stale Authority Event'
];

// Names that exist in the wrapper but are REPLACED in the harness, each with the reason.
export const SUBSTITUTED_NODES = {
  'Telegram Client Trigger':
    'telegramTrigger -> Code. Keeps the NAME that Parse Telegram Update resolves, drops the '
    + 'credential and the trigger type, so no webhook can ever be registered.'
};

// Names the harness adds that do not exist in the wrapper at all.
export const ADDED_NODES = ['HARNESS Entry', 'HARNESS Delivery Stub',
  'HARNESS Result (Authority Current)', 'HARNESS Result (Stale Authority)',
  'HARNESS Result (Issuance Fault)', 'HARNESS Result (Not Lead Ready)'];

// Production nodes deliberately EXCLUDED, each because running it would reach a client or a
// system this proof has no business touching.
export const EXCLUDED_NODES = {
  'Send Client Message': 'executeWorkflow -> live Telegram transport. Would send a real message.',
  'Send Intake Confirmation': 'same transport.',
  'Send Recovery Message': 'same transport.',
  'IF Message Delivered': 'replaced by HARNESS Delivery Stub, which emits its TRUE-branch shape.',
  'Answer Callback Query': 'telegram action node bound to the live client bot.',
  'Send Lead to Intake': 'httpRequest -> live Lead Intake endpoint. Would create a real CRM lead.',
  'Save Bot Event': 'live Bot_Events append; the harness observes outcomes in execution data instead.',
  'Save Intake State': 'live Bot_Sessions write on a path this proof does not exercise.',
  'Save Confirmation State': 'live Bot_Sessions write on a path this proof does not exercise.'
};

const HARNESS_CODE = {
  'Telegram Client Trigger': [
    '// HARNESS SUBSTITUTION -- generated by scripts/build-concierge-issuer-harness.mjs.',
    '//',
    "// This node carries the NAME of the production Telegram trigger because the audited body of",
    "// `Parse Telegram Update` opens with $('Telegram Client Trigger'), and n8n resolves that by",
    '// node name. Renaming it would mean running a different program.',
    '//',
    '// It is a CODE node. It holds no Telegram credential, it is not a trigger type, and it can',
    '// never register a webhook. It emits the synthetic Telegram-shaped update handed in by the',
    '// driver and nothing else.',
    'const inbound = $input.first().json || {};',
    'const update = inbound.update || inbound.body || inbound;',
    'return [{ json: update }];'
  ].join('\n'),

  'HARNESS Delivery Stub': [
    '// HARNESS SUBSTITUTION for `Send Client Message` + `IF Message Delivered`.',
    '//',
    '// Production reaches `Issuance Gate` only through IF Message Delivered\'s TRUE branch, whose',
    '// input is the transport response. This emits that shape WITHOUT executing any Telegram node',
    '// and WITHOUT calling the live transport workflow, so no client message is ever sent.',
    '//',
    '// correlation_id is carried through from `Build Transport Request` verbatim, because',
    '// `Issuance Gate` reads it off $input rather than off a named node.',
    'const t = $input.first().json || {};',
    'return [{ json: {',
    '  ok: true,',
    "  correlation_id: String(t.correlation_id || ''),",
    "  __harness_transport: 'STUBBED -- no Telegram node executed, no transport workflow called'",
    '} }];'
  ].join('\n')
};

// A result terminal snapshots everything an observer needs, reading named nodes defensively:
// on a turn where a branch did not run, $('That Node') throws, and a thrown terminal would
// destroy the evidence rather than record it.
function resultTerminal(outcome) {
  return [
    '// HARNESS TERMINAL -- records the observable outcome. Reads every named node defensively:',
    '// on a turn where a branch did not run, $(...) throws, and a terminal that throws would',
    '// destroy the evidence it exists to capture.',
    'const grab = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };',
    "const gate = grab(() => $('Issuance Gate').first().json, { __absent: true });",
    "const verdict = grab(() => $('Issuance Verdict').first().json, { __absent: true });",
    "const readback = grab(() => $('Receipt Readback').all().map(i => i.json), null);",
    "const authority = grab(() => $('Authority Verdict').first().json, { __absent: true });",
    "const sessionRow = grab(() => $('Build Session Row').first().json, { __absent: true });",
    "const parsed = grab(() => $('Parse Telegram Update').first().json, { __absent: true });",
    "const session = grab(() => $('Get Bot Session').first().json, { __absent: true });",
    'return [{ json: {',
    '  __harness_outcome: ' + JSON.stringify(outcome) + ',',
    '  chat_id: String(parsed.chat_id || ""),',
    '  minted_key: String(session.submission_key || ""),',
    '  mint_action: String(session.__submission_key_action || ""),',
    '  cycle_id: String(session.cycle_id || ""),',
    '  gate: gate,',
    '  verdict: verdict,',
    '  receipt_readback: readback,',
    '  authority: authority,',
    '  session_row: sessionRow,',
    '  terminal_input: $input.first().json || {}',
    '} }];'
  ].join('\n');
}

// name -> [source, sourceOutputIndex]
const WIRING = [
  ['HARNESS Entry', 0, 'Telegram Client Trigger'],
  ['Telegram Client Trigger', 0, 'Read Settings'],
  ['Read Settings', 0, 'Settings to Object'],
  ['Settings to Object', 0, 'Parse Telegram Update'],
  ['Parse Telegram Update', 0, 'Read Bot Sessions'],
  ['Read Bot Sessions', 0, 'Find Session'],
  ['Find Session', 0, 'Get Bot Session'],
  ['Get Bot Session', 0, 'Build Bot Response'],
  ['Build Bot Response', 0, 'Build Transport Request'],
  ['Build Transport Request', 0, 'HARNESS Delivery Stub'],
  ['HARNESS Delivery Stub', 0, 'Issuance Gate'],
  ['Issuance Gate', 0, 'IF Issuance Fault'],
  ['IF Issuance Fault', 0, 'Build Issuance Failure Event'],
  ['IF Issuance Fault', 1, 'IF Preallocation Required'],
  ['IF Preallocation Required', 0, 'Receipt Preallocate'],
  ['IF Preallocation Required', 1, 'Build Session Row'],
  ['Receipt Preallocate', 0, 'Receipt Readback'],
  ['Receipt Readback', 0, 'Issuance Verdict'],
  ['Issuance Verdict', 0, 'IF Authority May Advance'],
  ['IF Authority May Advance', 0, 'Build Session Row'],
  ['IF Authority May Advance', 1, 'Build Issuance Failure Event'],
  ['Build Issuance Failure Event', 0, 'HARNESS Result (Issuance Fault)'],
  ['Build Session Row', 0, 'Save Bot Session'],
  ['Save Bot Session', 0, 'IF Lead Ready'],
  ['IF Lead Ready', 0, 'Authority Reread'],
  ['IF Lead Ready', 1, 'HARNESS Result (Not Lead Ready)'],
  ['Authority Reread', 0, 'Authority Verdict'],
  ['Authority Verdict', 0, 'IF Authority Current'],
  ['IF Authority Current', 0, 'HARNESS Result (Authority Current)'],
  ['IF Authority Current', 1, 'Build Stale Authority Event'],
  ['Build Stale Authority Event', 0, 'HARNESS Result (Stale Authority)']
];

export function buildHarness(wrapper) {
  const byName = {};
  (wrapper.nodes || []).forEach((n) => { byName[n.name] = n; });

  const missing = INHERITED_VERBATIM.filter((n) => !byName[n]);
  if (missing.length) {
    throw new Error('the wrapper is missing inherited node(s): ' + missing.join(', '));
  }

  const nodes = [];

  // 1. Inherited, byte-for-byte. Deep clone only -- nothing is edited, not one key.
  INHERITED_VERBATIM.forEach((name) => {
    nodes.push(JSON.parse(JSON.stringify(byName[name])));
  });

  // 2. The entry. An executeWorkflowTrigger has no public surface: it is reachable only by an
  //    in-tenant Execute Workflow call, never by a URL and never by a bot.
  nodes.push({
    parameters: { inputSource: 'passthrough' },
    id: 'p73s2-harness-entry',
    name: 'HARNESS Entry',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.2,
    position: [-2100, 160],
    notes: 'Test-only entry. No public URL, no bot, no transport secret. Driven by the '
      + 'credential-free driver workflow, which is the thing actually tested.'
  });

  // 3. The two substitutions.
  nodes.push({
    parameters: { jsCode: HARNESS_CODE['Telegram Client Trigger'] },
    id: 'p73s2-harness-tgsub',
    name: 'Telegram Client Trigger',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-1900, 160],
    notes: 'HARNESS SUBSTITUTION. Keeps the production node NAME because Parse Telegram Update '
      + 'resolves it by name; is a Code node so it holds no credential and cannot register.'
  });
  nodes.push({
    parameters: { jsCode: HARNESS_CODE['HARNESS Delivery Stub'] },
    id: 'p73s2-harness-delivery',
    name: 'HARNESS Delivery Stub',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [200, 500],
    notes: 'HARNESS SUBSTITUTION for Send Client Message + IF Message Delivered. No Telegram '
      + 'node executes and the live transport workflow is never called.'
  });

  // 4. The terminals.
  const terminals = [
    ['HARNESS Result (Authority Current)', 'AUTHORITY_CURRENT', [2600, 900]],
    ['HARNESS Result (Stale Authority)', 'STALE_AUTHORITY', [2600, 1100]],
    ['HARNESS Result (Issuance Fault)', 'ISSUANCE_FAULT', [2600, 1300]],
    ['HARNESS Result (Not Lead Ready)', 'NOT_LEAD_READY', [2600, 1500]]
  ];
  terminals.forEach(([name, outcome, position], i) => {
    nodes.push({
      parameters: { jsCode: resultTerminal(outcome) },
      id: 'p73s2-harness-term-' + i,
      name: name,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: position
    });
  });

  // 5. Wiring.
  const connections = {};
  WIRING.forEach(([src, outIndex, target]) => {
    connections[src] = connections[src] || { main: [] };
    while (connections[src].main.length <= outIndex) { connections[src].main.push([]); }
    connections[src].main[outIndex].push({ node: target, type: 'main', index: 0 });
  });

  return {
    name: HARNESS_NAME,
    nodes: nodes,
    connections: connections,
    // errorWorkflow deliberately absent -- see the header.
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false }
  };
}

export function serializeHarness(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

// ---------------------------------------------------------------- the drift variant
//
// P7.4 §5 needs a turn that HOLDS C1/K1 while the authority row already says C2/K2. That state
// cannot be staged by seeding the row before the run: `Get Bot Session` derives what the turn
// holds FROM the row it reads, so seeding C2/K2 would make the turn hold C2/K2 and there would
// be no stale context to refuse. And `Save Bot Session` writes the held pair back, so by the
// time `Authority Reread` runs the row says C1/K1 again.
//
// The drift therefore has to land in exactly one place: BETWEEN the authority write and the
// reread. That is not a contrivance -- it is precisely where a real concurrent winner's write
// lands, and it is the only interval in which the reread can observe anything other than what
// this turn just wrote.
//
// So two HARNESS nodes are spliced onto that one edge. Every audited node stays byte-identical,
// including both endpoints; only the edge `Save Bot Session -> IF Lead Ready` is rerouted, and
// the gate asserts that it is the ONLY edge that differs from the base harness.
//
//   HARNESS Drift Compose   takes the row `Build Session Row` produced -- all of it -- and
//                           replaces cycle_id and submission_key with the C2/K2 handed in.
//                           Composing from that row rather than from a hand-built object means
//                           the competing write carries the same 40 columns the real one does,
//                           so it overwrites the authority pair without blanking the session.
//   HARNESS Drift Write     `Save Bot Session`'s parameters, VERBATIM. The competing winner
//                           writes through the same mapping the issuer writes through, because
//                           a drift staged by a different mapping would be staging a state
//                           production cannot reach.
//
// This is fault injection, the pattern P6.3 used to close F11 live. It is a SEPARATE artifact:
// the base harness is not modified, and neither is the deployable candidate.

const DRIFT_COMPOSE_CODE = [
  '// HARNESS DRIFT INJECTION -- see scripts/build-concierge-issuer-harness.mjs.',
  '//',
  '// Stands in for a concurrent winner writing the authority row after THIS turn saved it. It',
  '// runs on the one edge where that write would land: after Save Bot Session, before the',
  '// reread. The turn upstream of here still holds C1/K1; the row is about to say C2/K2.',
  '//',
  '// The competing pair is supplied by the driver, not invented here, so the test states its own',
  '// inputs. If it is absent this node REFUSES rather than silently passing the row through --',
  '// a drift harness that quietly failed to drift would report a clean AUTHORITY_CURRENT and be',
  '// read as a passing stale-context test.',
  "const inbound = $('Telegram Client Trigger').first().json || {};",
  'const drift = inbound.__drift || {};',
  "const c2 = String(drift.cycle_id == null ? '' : drift.cycle_id).trim();",
  "const k2 = String(drift.submission_key == null ? '' : drift.submission_key).trim();",
  "if (!/^C-\\d+-\\d+$/.test(c2)) { throw new Error('DRIFT REFUSED: __drift.cycle_id is not a minted cycle shape: ' + JSON.stringify(c2)); }",
  "if (!/^sub_[0-9a-f]{32}$/.test(k2)) { throw new Error('DRIFT REFUSED: __drift.submission_key is not a well-formed key'); }",
  '',
  "const row = Object.assign({}, $('Build Session Row').first().json || {});",
  "const held = String(row.cycle_id == null ? '' : row.cycle_id).trim();",
  "if (held === c2) { throw new Error('DRIFT REFUSED: the competing cycle equals the held cycle; nothing would drift'); }",
  '',
  'row.cycle_id = c2;',
  'row.submission_key = k2;',
  'return [{ json: row }];'
].join('\n');

export function buildDriftHarness(wrapper) {
  const wf = buildHarness(wrapper);
  wf.name = DRIFT_NAME;

  const save = (wrapper.nodes || []).find((n) => n.name === 'Save Bot Session');
  if (!save) { throw new Error('the wrapper has no Save Bot Session to copy the write mapping from'); }

  wf.nodes.push({
    parameters: { jsCode: DRIFT_COMPOSE_CODE },
    id: 'p74-drift-compose',
    name: 'HARNESS Drift Compose',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1500, 700],
    notes: 'HARNESS FAULT INJECTION. Composes the competing winner row from Build Session Row.'
  });
  wf.nodes.push({
    parameters: JSON.parse(JSON.stringify(save.parameters)),
    credentials: JSON.parse(JSON.stringify(save.credentials)),
    id: 'p74-drift-write',
    name: 'HARNESS Drift Write',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: save.typeVersion,
    position: [1700, 700],
    notes: 'HARNESS FAULT INJECTION. Save Bot Session parameters VERBATIM, so the competing '
      + 'write goes through the same mapping the issuer uses.'
  });

  // Reroute exactly one edge: Save Bot Session -> IF Lead Ready becomes
  // Save Bot Session -> Drift Compose -> Drift Write -> IF Lead Ready.
  wf.connections['Save Bot Session'] = { main: [[{ node: 'HARNESS Drift Compose', type: 'main', index: 0 }]] };
  wf.connections['HARNESS Drift Compose'] = { main: [[{ node: 'HARNESS Drift Write', type: 'main', index: 0 }]] };
  wf.connections['HARNESS Drift Write'] = { main: [[{ node: 'IF Lead Ready', type: 'main', index: 0 }]] };

  return wf;
}

// Proves the drift variant differs from the base harness ONLY by the declared splice.
export function verifyDriftHarness(base, drift) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const bByName = {}; (base.nodes || []).forEach((n) => { bByName[n.name] = n; });
  const dByName = {}; (drift.nodes || []).forEach((n) => { dByName[n.name] = n; });

  // Every base node survives byte-identically. The injection adds; it never edits.
  (base.nodes || []).forEach((n) => {
    const d = dByName[n.name];
    if (!d) { fail('base node missing from the drift harness: ' + n.name); return; }
    if (JSON.stringify(n) !== JSON.stringify(d)) { fail('base node was MODIFIED by the splice: ' + n.name); }
  });

  const added = (drift.nodes || []).filter((n) => !bByName[n.name]).map((n) => n.name).sort();
  if (JSON.stringify(added) !== JSON.stringify(['HARNESS Drift Compose', 'HARNESS Drift Write'])) {
    fail('the drift harness adds ' + JSON.stringify(added) + ', expected exactly the two injection nodes');
  }

  // Exactly one rerouted edge.
  const changed = Object.keys(Object.assign({}, base.connections, drift.connections))
    .filter((k) => JSON.stringify(base.connections[k]) !== JSON.stringify(drift.connections[k])).sort();
  const expected = ['HARNESS Drift Compose', 'HARNESS Drift Write', 'Save Bot Session'];
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    fail('connections differ at ' + JSON.stringify(changed) + ', expected exactly ' + JSON.stringify(expected));
  }

  // The injection must sit BETWEEN the write and the reread, which is the only interval where a
  // competing write can be observed by the reread.
  const afterSave = ((drift.connections['Save Bot Session'] || {}).main || [[]])[0] || [];
  if (afterSave.length !== 1 || afterSave[0].node !== 'HARNESS Drift Compose') {
    fail('Save Bot Session no longer feeds the drift injection first');
  }
  const afterWrite = ((drift.connections['HARNESS Drift Write'] || {}).main || [[]])[0] || [];
  if (afterWrite.length !== 1 || afterWrite[0].node !== 'IF Lead Ready') {
    fail('the drift write does not hand back to IF Lead Ready');
  }

  // The competing write must use the audited mapping, not a hand-rolled one.
  const save = dByName['Save Bot Session'];
  const dw = dByName['HARNESS Drift Write'];
  if (!dw || JSON.stringify(dw.parameters) !== JSON.stringify(save.parameters)) {
    fail('the drift write parameters are not byte-identical to Save Bot Session');
  }
  if (!dw || JSON.stringify(dw.credentials) !== JSON.stringify(save.credentials)) {
    fail('the drift write credentials are not byte-identical to Save Bot Session');
  }

  // And it must still be a containment-clean harness. The splice is removed from BOTH the node
  // list and the connections before re-running the base contract -- stripping only the nodes
  // would leave the rerouted edge pointing at names that no longer exist, and the base verifier
  // would report dangling references that are an artifact of this check rather than a defect.
  const stripped = Object.assign({}, drift, {
    nodes: (drift.nodes || []).filter((n) => !/^HARNESS Drift/.test(n.name)),
    connections: Object.assign({}, drift.connections, {
      'Save Bot Session': (base.connections || {})['Save Bot Session']
    })
  });
  delete stripped.connections['HARNESS Drift Compose'];
  delete stripped.connections['HARNESS Drift Write'];
  const inner = verifyHarness(base, stripped);
  if (!inner.ok) { inner.failures.forEach((f) => fail('base contract: ' + f)); }

  // Telegram containment is checked the way the base checks it -- by node TYPE and by credential
  // reference. A blunt search for the word would fire on the injection body's legitimate
  // $('Telegram Client Trigger') reference, which is the Code substitute, not a Telegram node.
  const tg = (drift.nodes || []).filter((n) => /telegram/i.test(String(n.type)));
  if (tg.length) { fail('the drift harness contains Telegram node(s): ' + tg.map((n) => n.name).join(', ')); }
  if (/telegramApi/.test(JSON.stringify(drift))) { fail('a telegramApi credential reference survives in the drift harness'); }
  if (drift.name === base.name) { fail('the drift harness is not distinguishable by name'); }

  return { ok: failures.length === 0, failures: failures };
}

// ---------------------------------------------------------------- verification

export function verifyHarness(wrapper, harness) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const wByName = {};
  (wrapper.nodes || []).forEach((n) => { wByName[n.name] = n; });
  const hByName = {};
  (harness.nodes || []).forEach((n) => { hByName[n.name] = n; });

  // --- fidelity: every inherited node byte-identical, matched by name --------------------
  INHERITED_VERBATIM.forEach((name) => {
    const w = wByName[name];
    const h = hByName[name];
    if (!h) { fail('inherited node missing from the harness: ' + name); return; }
    if (JSON.stringify(w) !== JSON.stringify(h)) {
      fail('inherited node is NOT byte-identical to the wrapper: ' + name);
    }
  });

  // --- no Telegram anywhere -------------------------------------------------------------
  const tgNodes = (harness.nodes || []).filter((n) => /telegram/i.test(String(n.type)));
  if (tgNodes.length) {
    fail('the harness contains Telegram node(s): '
      + tgNodes.map((n) => n.name + ' [' + n.type + ']').join(', '));
  }
  const blob = JSON.stringify(harness);
  if (/telegramApi/.test(blob)) { fail('a telegramApi credential reference survives in the harness'); }
  if (blob.includes('2JnVm0BIX0Z8tvBf')) { fail('the Concierge bot credential id appears in the harness'); }

  // --- the substitution is what it claims to be -----------------------------------------
  const sub = hByName['Telegram Client Trigger'];
  if (!sub) { fail('the harness has no Telegram Client Trigger substitute; Parse Telegram Update would throw'); }
  else {
    if (sub.type !== 'n8n-nodes-base.code') {
      fail('the Telegram Client Trigger substitute is not a Code node, it is ' + sub.type);
    }
    if (sub.credentials) { fail('the Telegram Client Trigger substitute carries credentials'); }
  }

  // --- non-activatable ------------------------------------------------------------------
  // Exactly one trigger, and it is an executeWorkflowTrigger: no URL, no bot, no schedule.
  const isTrigger = (t) => /trigger$/i.test(String(t)) || String(t) === 'n8n-nodes-base.webhook';
  const triggers = (harness.nodes || []).filter((n) => isTrigger(n.type));
  if (triggers.length !== 1) {
    fail('expected exactly one trigger node, found ' + triggers.length + ': '
      + triggers.map((n) => n.name + ' [' + n.type + ']').join(', '));
  } else if (triggers[0].type !== 'n8n-nodes-base.executeWorkflowTrigger') {
    fail('the only trigger is not an executeWorkflowTrigger, it is ' + triggers[0].type);
  }

  // --- excluded nodes really are excluded ------------------------------------------------
  Object.keys(EXCLUDED_NODES).forEach((name) => {
    if (hByName[name]) { fail('an EXCLUDED node is present in the harness: ' + name); }
  });
  if ((harness.nodes || []).some((n) => n.type === 'n8n-nodes-base.httpRequest')) {
    fail('the harness contains an httpRequest node; Send Lead to Intake must not be reachable');
  }
  if ((harness.nodes || []).some((n) => n.type === 'n8n-nodes-base.executeWorkflow')) {
    fail('the harness contains an executeWorkflow node; the live transport must not be callable');
  }

  // --- the issuer is actually present ----------------------------------------------------
  ['Get Bot Session', 'Issuance Gate', 'Receipt Preallocate', 'Receipt Readback',
    'Issuance Verdict', 'Save Bot Session', 'Authority Reread', 'Authority Verdict']
    .forEach((n) => { if (!hByName[n]) { fail('issuer node missing from the harness: ' + n); } });
  if ((harness.nodes || []).filter((n) => n.type === 'n8n-nodes-base.dataTable').length !== 2) {
    fail('the harness does not carry both Data Table nodes');
  }

  // --- every wired name exists -----------------------------------------------------------
  Object.keys(harness.connections || {}).forEach((src) => {
    if (!hByName[src]) { fail('connection source is not a node: ' + src); }
    (harness.connections[src].main || []).forEach((branch) => {
      (branch || []).forEach((l) => {
        if (!hByName[l.node]) { fail('connection target is not a node: ' + l.node); }
      });
    });
  });

  // --- shape ------------------------------------------------------------------------------
  if (JSON.stringify(Object.keys(harness).sort()) !== JSON.stringify(['connections', 'name', 'nodes', 'settings'])) {
    fail('the harness is not the four-field REST create shape: ' + Object.keys(harness).join(', '));
  }
  if (harness.settings.availableInMCP !== false) {
    fail('harness settings.availableInMCP must be false -- the DRIVER is what gets tested');
  }
  if (Object.prototype.hasOwnProperty.call(harness.settings, 'errorWorkflow')) {
    fail('the harness must not inherit the live error workflow binding');
  }

  return { ok: failures.length === 0, failures: failures };
}

// ---------------------------------------------------------------- main

const isMain = process.argv[1] && process.argv[1].endsWith('build-concierge-issuer-harness.mjs');
if (isMain) {
  const wrapperRaw = readFileSync(IN, 'utf8');
  const wrapper = JSON.parse(wrapperRaw);

  const harness = buildHarness(wrapper);
  const verdict = verifyHarness(wrapper, harness);
  if (!verdict.ok) {
    console.error('REFUSING TO WRITE: the generated harness failed verification.');
    verdict.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }

  const drift = buildDriftHarness(wrapper);
  const dv = verifyDriftHarness(harness, drift);
  if (!dv.ok) {
    console.error('REFUSING TO WRITE: the drift variant failed verification.');
    dv.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }

  writeFileSync(OUT, serializeHarness(harness), 'utf8');
  writeFileSync(OUT_DRIFT, serializeHarness(drift), 'utf8');

  if (readFileSync(IN, 'utf8') !== wrapperRaw) {
    console.error('FATAL: the IMPORT-SAFE wrapper changed on disk during this run.');
    process.exit(1);
  }

  console.log('harness written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
  console.log('  name:            ' + harness.name);
  console.log('  nodes:           ' + harness.nodes.length
    + '  (' + INHERITED_VERBATIM.length + ' inherited verbatim, '
    + (harness.nodes.length - INHERITED_VERBATIM.length) + ' harness)');
  console.log('  Telegram nodes:  ' + harness.nodes.filter((n) => /telegram/i.test(n.type)).length);
  console.log('  triggers:        ' + harness.nodes.filter((n) => /trigger$/i.test(n.type)).length
    + '  (executeWorkflowTrigger only -- no URL, no bot)');
  console.log('  data tables:     ' + harness.nodes.filter((n) => n.type === 'n8n-nodes-base.dataTable').length);
  console.log('  sheets:          ' + harness.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets').length);
  console.log('  availableInMCP:  ' + harness.settings.availableInMCP);
  console.log('  wrapper:         UNCHANGED');
  console.log('  verification:    PASS');
  console.log('drift variant:   n8n/candidate/concierge-issuer-HARNESS-DRIFT.json');
  console.log('  nodes:           ' + drift.nodes.length + '  (base + 2 injection nodes)');
  console.log('  rerouted edges:  1  (Save Bot Session -> IF Lead Ready)');
  console.log('  verification:    PASS');
}
