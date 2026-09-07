#!/usr/bin/env node
// FINMENTOR — P8.3: build the hardening candidate for the production Concierge.
//
//   node scripts/build-concierge-p83-candidate.mjs
//
// REPO-ONLY. Reads the current deployed-equivalent candidate and writes a NEW desired candidate
// beside it. It never contacts n8n and never mutates its input.
//
// ================================================================================
// WHAT THIS DOES NOT CONTAIN, AND WHY
// ================================================================================
//
// P8.3 §3 asks for the Concierge lead handoff to move from the public Lead Intake webhook to the
// structurally trusted INTERNAL entry. That cannot be built, because the internal entry is not
// deployed:
//
//     live Lead Intake QmIyEW2ZEqKregmN : 57 nodes, ONE public webhook trigger,
//                                          0 submission_key references, 0 Data Table nodes
//     the internal-route candidate      : 100 nodes, adds executeWorkflowTrigger,
//                                          41 submission_key references, 5 Data Table nodes
//     gap                               : 43 nodes to add to the revenue-path workflow
//
// §16 is explicit — "if Lead Intake itself requires a change: STOP and report the exact mismatch
// before touching it" — so INTERNAL_HANDOFF is reported, not built. Deploying the P6.1 Lead
// Intake internal-receipt candidate is its own cutover and its own phase.
//
// The four remaining approved classes ARE built here, because one of them is fixing live
// customer harm: execution #3716 lost a real /start to a transient Google Sheets failure.
//
// ================================================================================
// THE FOUR CLASSES
// ================================================================================
//
// HOT_PATH_CONFIG              Read Settings leaves the hot path.
// AUTHORITY_FAILURE_CLASSIFICATION  an ambiguous authority write is classified, never retried.
// BOT_EVENT_RESILIENCE         telemetry can no longer fail a completed customer turn.
// SESSION_READ_LATENCY         retry backoff 2000 -> 750 ms.
//
// HOW HOT_PATH_CONFIG AVOIDS TOUCHING ANYTHING AUDITED. `Settings to Object` consumes rows of
// `{key, value}` from its input and every downstream consumer reads `$('Settings to Object')`.
// So the cheapest correct change is not to edit any of them: it is to feed `Settings to Object`
// from a LOCAL Code node instead of from Google Sheets. Its body is untouched, every
// `$('Settings to Object')` reference keeps resolving, and the Sheets round trip disappears.
// `Read Settings` is then PHYSICALLY REMOVED. P8.3 had to leave it unreachable because the
// materializer refused every removal; P8.3A upgraded it to accept an exactly specified,
// explicitly allowlisted one, so the dead node goes instead of becoming permanent cleanup debt.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const H = require(join(ROOT, 'n8n', 'src', 'concierge-config', 'hot-path-config.js'));

const IN = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const OUT = join(ROOT, 'n8n', 'candidate', 'concierge-p83-candidate.json');

export const ADDED_NODES = [
  'Hot Path Config',
  'IF Authority Write OK',
  'Authority Outcome Reread',
  'Authority Outcome Verdict',
  'IF Authority Committed',
  'Build Authority Unresolved Event'
];

// Inherited nodes whose fields change, with the class each change belongs to.
export const MODIFIED_NODES = {
  'Read Bot Sessions': { field: 'waitBetweenTries', klass: 'SESSION_READ_LATENCY' },
  'Save Bot Session': { field: 'onError', klass: 'AUTHORITY_FAILURE_CLASSIFICATION' },
  'Save Bot Event': { field: 'onError', klass: 'BOT_EVENT_RESILIENCE' },
  'Send Lead to Intake': { field: 'parameters', klass: 'HYGIENE_FAKE_AUTH_REMOVAL' }
};

export const REWIRED_SOURCES = ['Telegram Client Trigger', 'Save Bot Session'];

// The one approved removal, specified exactly as the upgraded materializer demands.
export const READ_SETTINGS = {
  name: 'Read Settings',
  id: '9b55cfcc-b422-4147-a79f-04bd42386f4c',
  klass: 'HOT_PATH_CONFIG',
  inbound: ['Telegram Client Trigger'],
  outbound: ['Settings to Object'],
  // It carries the Google Sheets credential, so removal needs explicit separate
  // authorisation -- given by P8.3A §2/§3. The CREDENTIAL is untouched; three other Sheets
  // nodes still use it.
  allowCredentialBearing: true,
  allowTrigger: false
};

// The live, non-dead settings. DEAD keys are simply not emitted — that is the removal.
const LIVE_KEYS = Object.keys(H.SETTINGS_CLASSIFICATION)
  .filter((k) => H.SETTINGS_CLASSIFICATION[k].class !== H.DEAD);

const HOT_PATH_CONFIG_CODE = [
  '// P8.3 HOT_PATH_CONFIG — local settings, zero I/O.',
  '//',
  '// Replaces the `Read Settings` Google Sheets round trip that aborted production execution',
  '// #3716 in 312 ms and cost a customer their /start reply. It emits the SAME { key, value }',
  '// row shape `Settings to Object` already consumes, so that node and every downstream',
  '// $(\'Settings to Object\') reference are untouched.',
  '//',
  '// The four DEAD keys are not emitted at all: internal_intake_key (never produced, malformed',
  '// consumer, never validated by Lead Intake), owner_chat_id, timezone and',
  '// client_ai_temperature (referenced by no node). Removing them IS the fix; there is nothing',
  '// to migrate.',
  '//',
  '// bot_enabled lives here rather than in Sheets deliberately. Under the old design, Google',
  '// Sheets being unavailable meant the bot could not answer AT ALL -- the maintenance switch\'s',
  '// own dependency took the bot down. Here maintenance mode still works when Sheets is down,',
  '// which is exactly when it is wanted. The EMERGENCY stop remains workflow.active.',
  'const CONFIG = {',
  "  bot_enabled: 'true',",
  "  client_ai_enabled: 'false',",
  "  default_language: 'ru',",
  "  website_url: 'https://finmentor.md',",
  "  client_ai_model: 'PASTE_AI_MODEL_PLACEHOLDER_HERE',",
  "  lead_intake_webhook_url: 'https://ghennadi.app.n8n.cloud/webhook/finmentor-lead-intake'",
  '};',
  '',
  'return Object.keys(CONFIG).map((key) => ({ json: { key: key, value: CONFIG[key] } }));'
].join('\n');

// The deployed form of classifyAuthorityWriteOutcome() in
// n8n/src/concierge-config/hot-path-config.js. The gate drives both against one table of cases,
// so they cannot drift apart silently -- the same discipline P7.2 used for the mint.
const AUTHORITY_VERDICT_CODE = [
  '// P8.3 AUTHORITY_FAILURE_CLASSIFICATION — classify an ambiguous authority write.',
  '//',
  '// THIS NODE NEVER AUTHORISES A WRITE. Not on any branch. P8.2R withdrew verify-then-retry',
  '// because a reread followed by an unconditional write has a TOCTOU window: the reread can see',
  '// C1/K1, a concurrent turn can land C2/K2, and the retry then overwrites it. A pre-write check',
  '// does not make a later write conditional; it only makes it feel conditional.',
  '//',
  '// It also deliberately does NOT rank cycles. Observed either equals intended or it does not.',
  '// Refusing to decide which is "newer" is what keeps a stale classification harmless -- an',
  '// ordering result would invite some future edit to treat it as permission.',
  "const intended = $('Build Session Row').first().json || {};",
  'const rows = $input.all().map(i => i.json);',
  "const str = v => String(v == null ? '' : v).trim();",
  'const chat = str(intended.chat_id);',
  '',
  'let observed = null;',
  'for (const r of rows) { if (r && str(r.chat_id) === chat) { observed = r; break; } }',
  '',
  'const iC = str(intended.cycle_id);',
  'const iK = str(intended.submission_key);',
  '',
  'let outcome, reason;',
  'if (!observed) {',
  "  outcome = 'AUTHORITY_WRITE_UNRESOLVED'; reason = 'ROW_ABSENT_OR_UNREADABLE';",
  '} else {',
  '  const oC = str(observed.cycle_id);',
  '  const oK = str(observed.submission_key);',
  '  if (oC === iC && oK === iK) {',
  "    outcome = 'ACK_LOST_BUT_COMMITTED'; reason = 'ROW_MATCHES_INTENT';",
  '  } else if (/^C-\\d+-\\d+$/.test(oC) && /^sub_[0-9a-f]{32}$/.test(oK)) {',
  "    outcome = 'SUPERSEDED'; reason = 'ROW_HOLDS_A_DIFFERENT_VALID_PAIR';",
  '  } else {',
  "    outcome = 'AUTHORITY_WRITE_UNRESOLVED'; reason = 'ROW_NOT_INTERPRETABLE_AS_CURRENT';",
  '  }',
  '}',
  '',
  'return [{ json: {',
  '  __authority_outcome: outcome,',
  '  __authority_reason: reason,',
  '  __authority_committed: outcome === \'ACK_LOST_BUT_COMMITTED\',',
  '  __write_allowed: false,',
  '  __chat_id: chat',
  '} }];'
].join('\n');

const UNRESOLVED_EVENT_CODE = [
  '// P8.3 — the operational signal for an authority write that did not land.',
  '//',
  '// It writes NOTHING to the authority row. The READY receipt minted earlier this turn is',
  '// deliberately PRESERVED as recoverable orphan evidence: it is the only record that a cycle',
  '// was issued whose authority never persisted, and destroying it would destroy the ability to',
  '// reconcile. Same reasoning that keeps IN_FLIGHT receipts undeletable in the retention policy.',
  '//',
  '// The KEY IS NEVER LOGGED -- it is a capability, and Bot_Events is a spreadsheet with wider',
  '// read access than the Data Table. Only whether one was held.',
  '//',
  '// F16: exactly the twelve keys every other Bot_Events writer emits. Bot_Events is',
  '// autoMapInputData over an EMPTY stored schema, so a stray property is not dropped -- it',
  '// PERMANENTLY WIDENS the live sheet. This node emitted seven keys of its own until P8.3A-1,',
  '// six of them foreign, and was saved from writing them only by being disconnected.',
  "const p = $('Parse Telegram Update').first().json;",
  "const b = $('Build Bot Response').first().json;",
  'const d = b.debug || {};',
  "const v = $('Authority Outcome Verdict').first().json || {};",
  "const g = $('Get Bot Session').first().json || {};",
  'return [{ json: {',
  '  event_id: `${p.chat_id}-${Date.now()}`,',
  '  ts: new Date().toISOString(),',
  "  chat_id: String(p.chat_id || ''),",
  "  user_id: String(p.user_id || ''),",
  "  username: String(p.username || ''),",
  "  event_type: p.is_callback ? 'callback_received' : 'message_received',",
  "  state_before: String(d.state_before || ''),",
  "  state_after: String(d.state_after || ''),",
  "  message_text: String(p.message_text || '').slice(0, 500),",
  "  callback_data: String(p.callback_data || ''),",
  "  detail: 'authority_unresolved: ' + String(v.__authority_reason || 'UNKNOWN'),",
  '  raw_json: JSON.stringify({',
  "    signal: 'AUTHORITY_WRITE_NOT_PERSISTED',",
  "    outcome: String(v.__authority_outcome || ''),",
  "    reason: String(v.__authority_reason || ''),",
  "    held_key_present: String(g.submission_key || '') !== '',",
  '    receipt_preserved: true,',
  '    second_write_attempted: false,',
  '    lead_handoff_suppressed: true',
  '  }).slice(0, 4000)',
  '} }];'
].join('\n');

function ifCondition(id, left, right) {
  return {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
    conditions: [{
      id: id,
      leftValue: left,
      operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
      rightValue: right
    }],
    combinator: 'and'
  };
}

export function buildP83(base) {
  const wf = JSON.parse(JSON.stringify(base));
  const byName = {};
  wf.nodes.forEach((n) => { byName[n.name] = n; });

  // ---- SESSION_READ_LATENCY -------------------------------------------------------------
  byName['Read Bot Sessions'].waitBetweenTries = 750;

  // ---- BOT_EVENT_RESILIENCE -------------------------------------------------------------
  // Telemetry must never fail a turn whose reply, receipt and authority are already correct.
  byName['Save Bot Event'].onError = 'continueRegularOutput';

  // ---- AUTHORITY_FAILURE_CLASSIFICATION --------------------------------------------------
  byName['Save Bot Session'].onError = 'continueRegularOutput';

  wf.nodes.push({
    parameters: { jsCode: HOT_PATH_CONFIG_CODE },
    id: 'p83-hotpath-config', name: 'Hot Path Config',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1480, 320],
    notes: 'P8.3 HOT_PATH_CONFIG. Local settings, zero I/O. Replaces the Read Settings round trip '
      + 'that aborted production execution #3716.'
  });

  wf.nodes.push({
    parameters: {
      conditions: ifCondition('p83-write-ok', '={{ String($json.error === undefined && $json.errorMessage === undefined) }}', 'true'),
      options: {}
    },
    id: 'p83-if-write-ok', name: 'IF Authority Write OK',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1500, 220],
    notes: 'Save Bot Session now continues on error, so this is where an ambiguous write is caught.'
  });

  const read = byName['Read Bot Sessions'];
  wf.nodes.push({
    parameters: JSON.parse(JSON.stringify(read.parameters)),
    credentials: JSON.parse(JSON.stringify(read.credentials)),
    id: 'p83-authority-reread', name: 'Authority Outcome Reread',
    type: 'n8n-nodes-base.googleSheets', typeVersion: read.typeVersion,
    position: [1700, 420], alwaysOutputData: true, onError: 'continueRegularOutput',
    notes: 'CLASSIFY ONLY. Read Bot Sessions parameters VERBATIM. Its result can never authorise '
      + 'a write; an unreadable result classifies as UNRESOLVED, which also does not write.'
  });

  wf.nodes.push({
    parameters: { jsCode: AUTHORITY_VERDICT_CODE },
    id: 'p83-authority-verdict', name: 'Authority Outcome Verdict',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [1900, 420],
    notes: 'Deployed form of classifyAuthorityWriteOutcome(). __write_allowed is false on every '
      + 'branch, and the node never ranks cycles.'
  });

  wf.nodes.push({
    parameters: {
      conditions: ifCondition('p83-committed', '={{ String($json.__authority_committed) }}', 'true'),
      options: {}
    },
    id: 'p83-if-committed', name: 'IF Authority Committed',
    type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [2100, 420]
  });

  wf.nodes.push({
    parameters: { jsCode: UNRESOLVED_EVENT_CODE },
    id: 'p83-unresolved-event', name: 'Build Authority Unresolved Event',
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [2300, 560],
    notes: 'Terminal. Emits an operational signal and writes nothing.'
  });

  // ---- wiring ---------------------------------------------------------------------------
  // Hot path: the trigger now feeds the local config instead of the Sheets read. Read Settings
  // keeps its own outgoing edge and simply becomes unreachable.
  const trig = wf.connections['Telegram Client Trigger'].main;
  wf.connections['Telegram Client Trigger'] = {
    main: trig.map((branch) => (branch || []).map((l) => (
      l.node === 'Read Settings' ? { node: 'Hot Path Config', type: 'main', index: 0 } : l
    )))
  };
  wf.connections['Hot Path Config'] = { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] };

  // Authority: Save Bot Session no longer goes straight to IF Lead Ready.
  wf.connections['Save Bot Session'] = { main: [[{ node: 'IF Authority Write OK', type: 'main', index: 0 }]] };
  wf.connections['IF Authority Write OK'] = {
    main: [
      [{ node: 'IF Lead Ready', type: 'main', index: 0 }],
      [{ node: 'Authority Outcome Reread', type: 'main', index: 0 }]
    ]
  };
  wf.connections['Authority Outcome Reread'] = { main: [[{ node: 'Authority Outcome Verdict', type: 'main', index: 0 }]] };
  wf.connections['Authority Outcome Verdict'] = { main: [[{ node: 'IF Authority Committed', type: 'main', index: 0 }]] };
  wf.connections['IF Authority Committed'] = {
    main: [
      [{ node: 'IF Lead Ready', type: 'main', index: 0 }],
      [{ node: 'Build Authority Unresolved Event', type: 'main', index: 0 }]
    ]
  };

  // P8.3A-1: the unresolved terminal REPORTS. It was built and discarded -- the only
  // Build *Event node in the graph with no edge to Save Bot Event, so the
  // AUTHORITY_WRITE_NOT_PERSISTED signal was constructed once per genuine failure and thrown
  // away. Wiring alone would have been the wrong fix: the node emitted seven keys of its own,
  // six of them outside the twelve-key Bot_Events set, and Save Bot Event is autoMapInputData
  // over an EMPTY stored schema -- so the obvious one-line repair would have permanently
  // widened the live sheet by six columns, exactly the F16 hazard F17 is still cleaning up.
  // The builder was brought onto the contract FIRST; this edge is safe only because of that.
  wf.connections['Build Authority Unresolved Event'] = {
    main: [[{ node: 'Save Bot Event', type: 'main', index: 0 }]]
  };

  // ---- P8.3A: physically remove Read Settings ------------------------------------------
  // P8.3 left it unreachable because the materializer refused every removal. P8.3A upgraded
  // the materializer to accept an EXACTLY specified, explicitly allowlisted removal, so the
  // dead node goes rather than lingering as permanent cleanup debt.
  wf.nodes = wf.nodes.filter((n) => n.name !== READ_SETTINGS.name);
  delete wf.connections[READ_SETTINGS.name];

  // ---- P8.3A HYGIENE_FAKE_AUTH_REMOVAL -------------------------------------------------
  // x-finmentor-internal-key is inert three ways: the value is never emitted, the consumer
  // expression is malformed, and Lead Intake never reads the header. Removing it has ZERO
  // runtime effect and removes a control that LOOKS like authentication and is not. It is not
  // replaced by another shared secret: on a public endpoint that is not authentication.
  const intake = wf.nodes.find((n) => n.name === 'Send Lead to Intake');
  intake.parameters = JSON.parse(JSON.stringify(intake.parameters));
  intake.parameters.headerParameters = { parameters: [] };
  intake.parameters.sendHeaders = false;

  wf.name = 'FINMENTOR Telegram Client Concierge B21C P83 HARDENING CANDIDATE';
  return wf;
}

export function serializeP83(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

// ---------------------------------------------------------------- verification

export function verifyP83(base, cand) {
  const failures = [];
  const fail = (m) => failures.push(m);
  const bn = {}; base.nodes.forEach((n) => { bn[n.name] = n; });
  const cn = {}; cand.nodes.forEach((n) => { cn[n.name] = n; });

  // --- exactly the declared additions ----------------------------------------------------
  const added = Object.keys(cn).filter((n) => !bn[n]).sort();
  if (JSON.stringify(added) !== JSON.stringify(ADDED_NODES.slice().sort())) {
    fail('added nodes are ' + JSON.stringify(added) + ', expected ' + JSON.stringify(ADDED_NODES.slice().sort()));
  }
  const removed = Object.keys(bn).filter((n) => !cn[n]).sort();
  if (JSON.stringify(removed) !== JSON.stringify([READ_SETTINGS.name])) {
    fail('removed nodes are ' + JSON.stringify(removed) + ', expected exactly ' + JSON.stringify([READ_SETTINGS.name]));
  }

  // --- exactly the declared field changes -------------------------------------------------
  const EXEC = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled', 'onError',
    'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData', 'continueOnFail'];
  Object.keys(bn).forEach((name) => {
    const b = bn[name]; const c = cn[name];
    if (!c) { return; }
    const diff = EXEC.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(c[k]));
    if (!diff.length) { return; }
    const declared = MODIFIED_NODES[name];
    if (!declared) { fail('UNDECLARED change to ' + name + ': ' + diff.join(',')); return; }
    if (diff.length !== 1 || diff[0] !== declared.field) {
      fail('node ' + name + ' changed ' + diff.join(',') + ', policy allows only ' + declared.field);
    }
  });

  // --- the four classes landed -------------------------------------------------------------
  if (cn['Read Bot Sessions'].waitBetweenTries !== 750) { fail('session read backoff is not 750 ms'); }
  if (cn['Save Bot Event'].onError !== 'continueRegularOutput') { fail('Save Bot Event is not best-effort'); }
  if (cn['Save Bot Session'].onError !== 'continueRegularOutput') { fail('Save Bot Session still aborts on failure'); }

  // --- HOT PATH: Read Settings unreachable, and no Sheets read before the reply -------------
  const reach = (start, forced) => {
    const seen = new Set([start]); const q = [start]; const order = [];
    while (q.length) {
      const cur = q.shift(); order.push(cur);
      const c = cand.connections[cur]; if (!c || !c.main) { continue; }
      c.main.forEach((br, oi) => {
        if (forced[cur] !== undefined && forced[cur] !== oi) { return; }
        (br || []).forEach((l) => { if (l && l.node && !seen.has(l.node)) { seen.add(l.node); q.push(l.node); } });
      });
    }
    return order;
  };
  const all = reach('Telegram Client Trigger', {});
  if (cn[READ_SETTINGS.name]) { fail('Read Settings is still present; P8.3A removes it physically'); }
  if (all.indexOf('Hot Path Config') === -1) { fail('Hot Path Config is not reachable'); }
  if (all.indexOf('Settings to Object') === -1) { fail('Settings to Object became unreachable'); }

  const startPath = reach('Telegram Client Trigger',
    { 'IF Message Delivered': 0, 'IF Lead Ready': 1, 'IF Has Callback Query': 1, 'IF Layout Mapped': 0, 'IF Authority Write OK': 0 });
  const send = startPath.indexOf('Send Client Message');
  const IO = ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.dataTable',
    'n8n-nodes-base.httpRequest', 'n8n-nodes-base.executeWorkflow'];
  const preReply = startPath.slice(0, send + 1).filter((n) => cn[n] && IO.indexOf(cn[n].type) !== -1);
  if (preReply.length !== 2) {
    fail('pre-reply round trips are ' + preReply.length + ' (' + preReply.join(', ') + '), target is 2');
  }

  // --- THE INVARIANT: no edge back to Save Bot Session -------------------------------------
  Object.keys(cand.connections).forEach((src) => {
    (cand.connections[src].main || []).forEach((br) => (br || []).forEach((l) => {
      if (l && l.node === 'Save Bot Session' && src !== 'Build Session Row') {
        fail('EDGE INTO Save Bot Session from ' + src + ' — a second authority write path exists');
      }
    }));
  });
  ['Authority Outcome Verdict', 'IF Authority Committed', 'Authority Outcome Reread',
    'Build Authority Unresolved Event'].forEach((n) => {
    const outs = ((cand.connections[n] || {}).main || []).flat().map((l) => l.node);
    if (outs.indexOf('Save Bot Session') !== -1) { fail(n + ' has an edge back to Save Bot Session'); }
  });

  // --- the verdict never authorises a write, and never ranks ---------------------------------
  const vcode = cn['Authority Outcome Verdict'].parameters.jsCode;
  if (!/__write_allowed:\s*false/.test(vcode)) { fail('the verdict does not hard-code __write_allowed false'); }
  if (/>\s*\w*[Ss]tamp|Number\(m\[1\]\)|currentStamp/.test(vcode)) { fail('the verdict ranks cycles'); }

  // --- dead keys are gone from the hot-path config ------------------------------------------
  const hcode = cn['Hot Path Config'].parameters.jsCode;
  H.keysOfClass(H.DEAD).forEach((k) => {
    if (new RegExp('^\\s*' + k + ':', 'm').test(hcode)) { fail('DEAD key emitted by Hot Path Config: ' + k); }
  });
  LIVE_KEYS.forEach((k) => {
    if (!new RegExp('^\\s*' + k + ':', 'm').test(hcode)) { fail('live key missing from Hot Path Config: ' + k); }
  });

  // HYGIENE_FAKE_AUTH_REMOVAL: the inert header is gone and nothing replaced it.
  const intake = cn['Send Lead to Intake'];
  const hdrs = ((intake.parameters || {}).headerParameters || {}).parameters || [];
  if (hdrs.length !== 0) { fail('Send Lead to Intake still sends header(s): ' + hdrs.map((h) => h.name).join(', ')); }
  if (/internal_intake_key|x-finmentor-internal-key/.test(JSON.stringify(intake))) { fail('the fake auth reference survives'); }
  if (intake.parameters.url !== bn['Send Lead to Intake'].parameters.url) { fail('the intake URL changed; the route is not in scope for P8.3A'); }
  if (intake.parameters.jsonBody !== bn['Send Lead to Intake'].parameters.jsonBody) { fail('the intake body changed'); }

  return { ok: failures.length === 0, failures: failures };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-concierge-p83-candidate.mjs');
if (isMain) {
  const baseRaw = readFileSync(IN, 'utf8');
  const base = JSON.parse(baseRaw);
  const cand = buildP83(base);
  const v = verifyP83(base, cand);
  if (!v.ok) {
    console.error('REFUSING TO WRITE: the P8.3 candidate failed verification.');
    v.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  writeFileSync(OUT, serializeP83(cand), 'utf8');
  if (readFileSync(IN, 'utf8') !== baseRaw) { console.error('FATAL: the base candidate changed on disk.'); process.exit(1); }

  console.log('P8.3 candidate: n8n/candidate/concierge-p83-candidate.json');
  console.log('  nodes         : ' + cand.nodes.length + '  (base ' + base.nodes.length + ' + ' + ADDED_NODES.length + ' - 1 removed)');
  console.log('  added         : ' + ADDED_NODES.join(', '));
  console.log('  field changes : ' + Object.keys(MODIFIED_NODES).map((n) => n + '.' + MODIFIED_NODES[n].field).join(', '));
  console.log('  Read Settings : PHYSICALLY REMOVED (allowlisted removal, id-and-edge exact)');
  console.log('  pre-reply I/O : 2  (was 3)');
  console.log('  INTERNAL_HANDOFF: NOT BUILT — the internal Lead Intake entry is not deployed');
  console.log('  verification  : PASS');
}
