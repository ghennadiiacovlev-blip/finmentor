#!/usr/bin/env node
// FINMENTOR — B.2.1-C P7.2 gate: the Concierge ISSUER CANDIDATE.
//
//   node qa/concierge-issuer-candidate.test.mjs
//
// qa/concierge-issuer.test.mjs pins the MODULE and the UNMODIFIED PRODUCTION graph. This gate
// pins the CANDIDATE: the graph that n8n/candidate/concierge-issuer-candidate.json actually
// contains, and the Code bodies it actually carries, executed rather than read.
//
// THE RULE THIS FILE FOLLOWS. A check that reads a workflow file proves what someone wrote. A
// check that EXECUTES the deployed body proves what it does. Every behavioural claim below runs
// the byte-exact jsCode out of the candidate through a shim of the two or three things n8n
// hands a Code node, and several of them run the tracked MODULE over the same case table so the
// two cannot drift apart while both stay green.
//
// It does not verify the transform by re-running the transform. Section 1 diffs the candidate
// against production independently and requires the set of differing nodes and edges to equal
// the declared set EXACTLY — the discipline verifyImportSafe() established at P6.1 — so a bug
// in the generator cannot pass its own check. Section 9 then regenerates and requires zero
// diff, which is a different property: determinism, not correctness.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

const ISSUER = require(join(ROOT, 'n8n', 'src', 'concierge-issuer', 'mint-submission-key.js'));
const RECEIPT = require(join(ROOT, 'n8n', 'src', 'lead-intake', 'idempotency-receipt.js'));
const SUBMIT = require(join(ROOT, 'n8n', 'src', 'miniapp-submit', 'submit-contract.js'));

// The FROZEN pre-P7.5R export -- see n8n/history/README.md. The determinism check regenerates
// the candidate, so it must read the same source the generator does; the splice anchors only
// exist in the pre-cutover graph, because Model B is what replaced them.
const PROD_PATH = join(ROOT, 'n8n', 'history',
  'mppzthlkSJFr6Kle.pre-P7-5R-cutover.json');
const CAND_PATH = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const GENERATOR = join(ROOT, 'scripts', 'build-concierge-issuer-candidate.mjs');

const PROD = JSON.parse(readFileSync(PROD_PATH, 'utf8'));
const CAND = JSON.parse(readFileSync(CAND_PATH, 'utf8'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'mismatch') + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const prodNode = (n) => PROD.nodes.find((x) => x.name === n);
const candNode = (n) => {
  const x = CAND.nodes.find((y) => y.name === n);
  if (!x) throw new Error('candidate has no node ' + n);
  return x;
};
const src = (n) => candNode(n).parameters.jsCode;
const j = (v) => JSON.stringify(v);

// The declared surface of the splice. Section 1 requires the ACTUAL difference set to equal
// these exactly, so anything the generator touches without saying so is a failure.
const CHANGED_CODE_NODES = [
  'Get Bot Session', 'Find Session',
  'Build Session Row', 'Build Intake State Row', 'Build Confirmation State Row'
];
const NEW_NODES = [
  'Issuance Gate', 'IF Issuance Fault', 'IF Preallocation Required', 'Receipt Preallocate',
  'Receipt Readback', 'Issuance Verdict', 'IF Authority May Advance',
  'Build Issuance Failure Event', 'Authority Reread', 'Authority Verdict',
  'IF Authority Current', 'Build Stale Authority Event'
];
const REWIRED_EDGES = ['IF Message Delivered', 'IF Lead Ready'];

const CREDENTIAL_TYPES = [
  'n8n-nodes-base.googleSheets', 'n8n-nodes-base.telegram', 'n8n-nodes-base.telegramTrigger',
  'n8n-nodes-base.httpRequest', 'n8n-nodes-base.executeWorkflow', 'n8n-nodes-base.dataTable'
];

// The twelve columns every Bot_Events row has carried since long before B.2.1-C. Bot_Events is
// written with autoMapInputData over an EMPTY stored schema, so under F16 a thirteenth key does
// not get dropped — it permanently widens the live sheet.
const BOT_EVENT_KEYS = [
  'event_id', 'ts', 'chat_id', 'user_id', 'username', 'event_type', 'state_before',
  'state_after', 'message_text', 'callback_data', 'detail', 'raw_json'
];

const KEY_RE = /^sub_[0-9a-f]{32}$/;
const CHAT = '900000123';               // reserved synthetic range, never a real user
const K1 = 'sub_' + 'a'.repeat(32);
const K2 = 'sub_' + 'b'.repeat(32);

// ---------------------------------------------------------------- harnesses

// Run the BYTE-EXACT candidate cycle gate. `require` is a parameter rather than an ambient so
// the mint can be driven with a hostile primitive — which is the only way to prove the wrapper
// around it does what its comment claims.
function runGate(persistedRow, parsedUpdate, requireImpl) {
  const $ = (name) => {
    if (name === 'Parse Telegram Update') { return { first: () => ({ json: parsedUpdate }) }; }
    throw new Error('cycle gate referenced an unexpected node: ' + name);
  };
  const $input = { all: () => (persistedRow ? [{ json: persistedRow }] : []) };
  return new Function('$', '$input', 'require', src('Get Bot Session'))($, $input, requireImpl || require)[0].json;
}

function runNode(name, nodes, inputItems) {
  const $ = (n) => {
    if (!(n in nodes)) { throw new Error('no data for node ' + n); }
    return { first: () => ({ json: nodes[n] }) };
  };
  const items = inputItems || [{ json: {} }];
  const $input = { first: () => items[0], all: () => items };
  return new Function('$', '$input', src(name))($, $input);
}
const runOne = (name, nodes, inputItems) => runNode(name, nodes, inputItems)[0].json;

const baseRow = (over) => Object.assign({
  row_number: 7, chat_id: CHAT, session_id: 's-1', state: 'MENU', status: 'active',
  consent: '', lead_id: '', lead_sent_at: '', cycle_id: '', submission_key: ''
}, over || {});
const update = (over) => Object.assign({
  chat_id: CHAT, user_id: '42', username: 'u', message_text: '', callback_data: '', is_callback: false
}, over || {});

const START = update({ message_text: '/start' });
const PLAIN = update({ message_text: 'привет' });
const RESTART = update({ callback_data: 'm|diag', is_callback: true });

// A pristine READY receipt as buildPreallocation() actually produces one — taken FROM the module
// rather than hand-written, so a change to the record shape reaches this gate.
function pristineRow(key) {
  // The trusted-route flags are what the receipt module requires of any caller of the receipt
  // CONTROLS, and the issuer is one: preallocation happens inside the tenant, on the graph, not
  // from a public request. Passing them here mirrors (1.8) of the module gate.
  const built = RECEIPT.buildPreallocation({
    submissionKey: key, internalRouteProven: true, provenanceTrusted: true,
    nowIso: '2026-08-27T10:00:00.000Z'
  });
  if (!built.ok) { throw new Error('buildPreallocation refused a valid key: ' + built.reason); }
  return Object.assign({}, built.record);
}

// A Code body's PROSE is allowed to name the forms the code must never use — several of these
// nodes carry exactly that warning, and it is worth carrying. The scan is about executable text,
// so comments come out first. Stated limitation: a `//` inside a string literal would truncate
// that line, which can only ever make this stricter about what it sees, never laxer.
function strippedCode(js) {
  return String(js).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

// ================================================================ 1. fidelity

console.log('\nP7.2 CONCIERGE ISSUER CANDIDATE — fidelity of everything the splice did not touch\n');

check('(1.1) every production node survives the splice, by name and by type', () => {
  for (const p of PROD.nodes) {
    const c = CAND.nodes.find((x) => x.name === p.name);
    assert(c, 'production node vanished from the candidate: ' + p.name);
    eq(c.type, p.type, 'node type changed for ' + p.name);
  }
  eq(CAND.nodes.length, PROD.nodes.length + NEW_NODES.length,
    'candidate node count is not production plus the declared new nodes');
});

check('(1.2) exactly the five declared Code nodes differ; every other inherited node is byte-identical', () => {
  const differing = [];
  for (const p of PROD.nodes) {
    const c = CAND.nodes.find((x) => x.name === p.name);
    if (j(c.parameters) !== j(p.parameters)) { differing.push(p.name); }
  }
  eq(j(differing.slice().sort()), j(CHANGED_CODE_NODES.slice().sort()),
    'the set of modified inherited nodes is not the declared set');
});

// The distinction this check keeps is not a technicality. A splice that edits a node holding a
// credential is a splice that can change what that credential reaches.
check('(1.3) NO inherited credential-bearing node was modified', () => {
  for (const p of PROD.nodes.filter((n) => CREDENTIAL_TYPES.indexOf(n.type) !== -1)) {
    const c = CAND.nodes.find((x) => x.name === p.name);
    eq(j(c.parameters), j(p.parameters), p.name + ' (credential-bearing) was modified by the splice');
    eq(j(c.credentials || null), j(p.credentials || null), p.name + ' credential reference changed');
  }
});

// P7.1 measured both of these to be ALREADY CORRECT. They are pinned here for the reason P7.1
// gave: the safest change to a graph on the path of every Telegram update is the one not made.
check('(1.4) Save Bot Session is untouched — autoMapInputData, chat_id, the 40-entry schema', () => {
  const cols = candNode('Save Bot Session').parameters.columns;
  eq(cols.mappingMode, 'autoMapInputData', 'the candidate changed the mapping mode');
  eq(j(cols.matchingColumns), j(['chat_id']), 'the candidate changed the match column');
  eq(cols.schema.length, 40, 'the candidate changed the stored schema P7.1 proved the write against');
  assert(cols.schema.every((s) => s.id !== 'submission_key'),
    'the candidate added submission_key to the stored schema — F15 proved that is unnecessary');
});

check('(1.5) Read Bot Sessions still pins A:AV — F14 stays refuted and the range stays unwidened', () => {
  const loc = candNode('Read Bot Sessions').parameters.options.dataLocationOnSheet.values;
  eq(loc.range, 'A:AV', 'the candidate widened a range P7.1 proved did not need widening');
  eq(loc.rangeDefinition, 'specifyRange', 'the read is no longer an explicit range');
});

check('(1.6) Authority Reread is a VERBATIM copy of Read Bot Sessions, not a variant', () => {
  const a = candNode('Authority Reread');
  const r = candNode('Read Bot Sessions');
  eq(j(a.parameters), j(r.parameters), 'the reread reads the sheet differently from the primary read');
  eq(j(a.credentials), j(r.credentials), 'the reread uses a different credential');
  eq(a.type, r.type, 'the reread is not a Google Sheets node');
  assert(a.id !== r.id && a.name !== r.name, 'the reread is not a distinct node');
});

check('(1.7) the connection map differs from production on exactly the declared edges', () => {
  const changed = Object.keys(PROD.connections)
    .filter((k) => j(PROD.connections[k]) !== j(CAND.connections[k]));
  eq(j(changed.slice().sort()), j(REWIRED_EDGES.slice().sort()),
    'the splice rewired production edges it did not declare');
  const added = Object.keys(CAND.connections).filter((k) => !(k in PROD.connections));
  assert(added.every((k) => NEW_NODES.indexOf(k) !== -1),
    'connections were added for undeclared nodes: ' + added.filter((k) => NEW_NODES.indexOf(k) === -1).join(', '));
});

check('(1.8) both rewired IFs kept their FALSE branch exactly as production had it', () => {
  eq(j(CAND.connections['IF Message Delivered'].main[1]), j(PROD.connections['IF Message Delivered'].main[1]),
    'the delivery-failure branch was disturbed');
  eq(j(CAND.connections['IF Lead Ready'].main[1]), j(PROD.connections['IF Lead Ready'].main[1]),
    'the non-lead branch was disturbed');
});

check('(1.9) the PRODUCTION export is untouched — still zero submission_key references, still active', () => {
  const hits = PROD.nodes.filter((n) => j(n.parameters || {}).indexOf('submission_key') !== -1);
  eq(hits.length, 0, 'production now references submission_key: ' + hits.map((n) => n.name).join(', '));
  eq(PROD.active, true, 'the production Concierge is no longer active');
});

// ================================================================ 2. the issuance site

console.log('\nTHE ISSUANCE SITE — one place mints, three places persist\n');

check('(2.1) exactly ONE node in the candidate creates a cycle_id', () => {
  const minters = CAND.nodes.filter((n) => /cycleId = 'C-'|cycle_id = 'C-/.test(j(n.parameters || {})));
  eq(j(minters.map((n) => n.name)), j(['Get Bot Session']),
    'cycle issuance is no longer confined to the cycle gate: ' + minters.map((n) => n.name).join(', '));
});

check('(2.2) exactly THREE nodes write the Bot_Sessions authority row, and all three builders feed one', () => {
  const writers = CAND.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets' &&
    n.parameters.operation === 'appendOrUpdate' &&
    (n.parameters.sheetName || {}).cachedResultName === 'Bot_Sessions');
  eq(j(writers.map((n) => n.name).sort()),
    j(['Save Bot Session', 'Save Confirmation State', 'Save Intake State']),
    'the set of authority writers changed — every one of them needs the column');
  // Each writer's immediate upstream must be one of the three builders the splice extended.
  const upstreamOf = (name) => Object.keys(CAND.connections)
    .filter((k) => (CAND.connections[k].main || []).some((o) => o.some((e) => e.node === name)));
  eq(j(upstreamOf('Save Bot Session')), j(['Build Session Row']), 'Save Bot Session upstream changed');
  eq(j(upstreamOf('Save Intake State')), j(['Build Intake State Row']), 'Save Intake State upstream changed');
  eq(j(upstreamOf('Save Confirmation State')), j(['Build Confirmation State Row']), 'Save Confirmation State upstream changed');
});

check('(2.3) the mint is bound to the reset decision, in the same node, by the same variable', () => {
  const js = src('Get Bot Session');
  assert(/if \(reset !== ''\) \{[\s\S]{0,400}mintSubmissionKey\(\)/.test(js),
    'the mint is no longer gated on the reset that creates the cycle');
  ['start', 'restart', 'bootstrap'].forEach((r) => assert(js.indexOf("reset = '" + r + "'") !== -1,
    'the ' + r + ' trigger left the cycle gate'));
});

// (4.4) of the module gate scans production. The candidate is where the body actually lands, so
// it is scanned here too — the difference between `require('crypto')` and `crypto.` on this
// tenant is a working bot and a dead one, and it is one word wide.
check('(2.4) the candidate uses require(crypto).randomBytes and references NO crypto global', () => {
  const js = src('Get Bot Session');
  assert(js.indexOf(ISSUER.REQUIRED_ENTROPY_CALL) !== -1,
    'the candidate does not use ' + ISSUER.REQUIRED_ENTROPY_CALL);
  // Non-vacuity: the cycle gate's prose DOES name the forbidden forms, deliberately, so the
  // stripper must actually be removing something here or this scan is checking nothing.
  assert(/crypto\s*\.\s*getRandomValues/.test(js), 'the warning naming the forbidden form left the gate');
  assert(!/crypto\s*\.\s*getRandomValues/.test(strippedCode(js)), 'the comment stripper is not working');
  for (const n of CAND.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    const masked = strippedCode(n.parameters.jsCode).replace(/require\(\s*['"]crypto['"]\s*\)/g, '__REQ__');
    assert(!/\bcrypto\s*\./.test(masked), n.name + ' references the crypto GLOBAL, which is undefined on this tenant');
    ISSUER.FORBIDDEN_IN_CODE_NODE.forEach((f) => assert(masked.indexOf(f) === -1,
      n.name + ' contains ' + f + ', which throws in an n8n Code node'));
  }
});

// ================================================================ 3. the mint, executed

console.log('\nTHE MINT — the deployed body, executed\n');

check('(3.1) /start mints a well-formed key and requires a preallocation', () => {
  const s = runGate(baseRow({ cycle_id: 'C-' + CHAT + '-1', submission_key: K1 }), START);
  assert(KEY_RE.test(s.submission_key), 'the minted key is malformed: ' + s.submission_key);
  assert(s.submission_key !== K1, 'a new cycle REUSED the previous key');
  eq(s.__submission_key_action, 'MINT', 'action');
  eq(s.__submission_key_preallocate, true, 'a new cycle did not require a receipt');
  eq(s.__submission_key_reason, 'NEW_CYCLE_START', 'reason');
});

check('(3.2) a restart (m|diag on a finished cycle) mints, and a bootstrap does too', () => {
  const restart = runGate(baseRow({ cycle_id: 'C-' + CHAT + '-1', consent: 'yes', submission_key: K1 }), RESTART);
  eq(restart.__submission_key_action, 'MINT', 'restart did not mint');
  eq(restart.__submission_key_reason, 'NEW_CYCLE_RESTART', 'restart reason');
  const boot = runGate(baseRow({ cycle_id: '' }), PLAIN);
  eq(boot.__submission_key_action, 'MINT', 'a session with no cycle did not bootstrap a new one');
  eq(boot.__submission_key_reason, 'NEW_CYCLE_BOOTSTRAP', 'bootstrap reason');
});

check('(3.3) 2,000 live draws through the deployed body: 0 collisions, 0 malformed', () => {
  const seen = new Set();
  let malformed = 0;
  for (let i = 0; i < 2000; i++) {
    const k = runGate(baseRow(), START).submission_key;
    if (!KEY_RE.test(k)) { malformed++; }
    seen.add(k);
  }
  eq(malformed, 0, 'malformed draws');
  eq(seen.size, 2000, 'collisions occurred: ' + (2000 - seen.size));
});

// The row that earns its place. cycle_id is 'C-' + chat_id + '-' + Date.now(), so two issuances
// inside ONE millisecond produce the IDENTICAL cycle id — a collision by construction. The check
// is only worth anything if that case is MEASURED to occur rather than assumed, so the loop
// requires an identical-cycle pair before it asserts anything about the keys.
check('(3.4) two issuances inside ONE millisecond collide on cycle_id and NOT on the key', () => {
  let measured = false;
  let a = null;
  let b = null;
  for (let i = 0; i < 20000 && !measured; i++) {
    a = runGate(baseRow(), START);
    b = runGate(baseRow(), START);
    if (a.cycle_id === b.cycle_id) { measured = true; }
  }
  eq(measured, true, 'no same-millisecond pair was observed — the check would be vacuous');
  eq(a.cycle_id, b.cycle_id, 'the pair does not actually share a cycle id');
  assert(a.submission_key !== b.submission_key,
    'two issuances in one millisecond produced the SAME key — the key inherits cycle_id defect');
});

check('(3.5) an unchanged cycle CARRIES its key and preallocates nothing', () => {
  const s = runGate(baseRow({ cycle_id: 'C-' + CHAT + '-1', submission_key: K1 }), PLAIN);
  eq(s.submission_key, K1, 'the key was not carried unchanged');
  eq(s.__submission_key_action, 'CARRY', 'action');
  eq(s.__submission_key_preallocate, false, 'a carry asked for a receipt it does not need');
});

check('(3.6) a malformed key is carried UNCHANGED — never repaired, never blanked', () => {
  const s = runGate(baseRow({ cycle_id: 'C-' + CHAT + '-1', submission_key: 'sub_NOT_HEX' }), PLAIN);
  eq(s.submission_key, 'sub_NOT_HEX', 'a corrupt key was laundered — the only evidence of corruption is gone');
  eq(s.__submission_key_action, 'CARRY_MALFORMED', 'action');
  eq(s.__submission_key_preallocate, false, 'a malformed carry asked for a receipt');
});

check('(3.7) NEVER_BACKFILL — a legacy cycle with no key is not given one', () => {
  const s = runGate(baseRow({ cycle_id: 'C-' + CHAT + '-1', submission_key: '', consent: 'yes', consent_cycle_id: 'C-' + CHAT + '-1', lead_id: 'L-1', lead_cycle_id: 'C-' + CHAT + '-1' }), PLAIN);
  eq(s.submission_key, '', 'a legacy cycle was backfilled — a READY receipt would release a second attempt for an existing lead');
  eq(s.__submission_key_action, 'LEGACY_NO_KEY', 'action');
  eq(s.__submission_key_reason, 'LEGACY_CYCLE_NOT_BACKFILLED', 'reason');
  eq(s.__submission_key_preallocate, false, 'a legacy row asked for a receipt');
  eq(s.lead_id, 'L-1', 'the already-submitted lead was disturbed');
});

// Without this, "the legacy row got no key" is also what a function that does nothing at all
// would produce. A backfilling variant must be shown to behave DIFFERENTLY.
check('(3.8) MUTATION — the backfill refusal is not vacuous', () => {
  const row = baseRow({ cycle_id: 'C-' + CHAT + '-1', submission_key: '' });
  const real = runGate(row, PLAIN);
  const backfilling = src('Get Bot Session').replace(
    "  s.submission_key = '';\n  keyAction = 'LEGACY_NO_KEY';",
    "  s.submission_key = mintSubmissionKey();\n  keyAction = 'LEGACY_NO_KEY';");
  assert(backfilling !== src('Get Bot Session'), 'the mutation did not apply — the anchor moved');
  const $ = () => ({ first: () => ({ json: PLAIN }) });
  const mutated = new Function('$', '$input', 'require', backfilling)($, { all: () => [{ json: row }] }, require)[0].json;
  assert(KEY_RE.test(mutated.submission_key), 'the mutant did not actually backfill — the check proves nothing');
  assert(real.submission_key !== mutated.submission_key, 'the real gate is indistinguishable from a backfilling one');
});

check('(3.9) MUTATION — a short randomBytes is REFUSED and degrades to MINT_FAILED, never a throw', () => {
  const hostile = () => ({ randomBytes: () => Buffer.alloc(8) });
  const s = runGate(baseRow(), START, hostile);
  eq(s.__submission_key_action, 'MINT_FAILED', 'a short draw was accepted');
  eq(s.submission_key, '', 'a short draw produced a key');
  eq(s.__submission_key_fault, true, 'the fault flag was not set');
  eq(s.__submission_key_preallocate, false, 'a failed mint asked for a receipt');
  assert(s.cycle_id !== '', 'the turn lost its cycle — the reply would never be composed');
});

check('(3.10) MUTATION — a non-byte draw, and require(crypto) missing entirely, both fail soft', () => {
  const nonByte = () => ({ randomBytes: () => [1, 2, 999, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
  const a = runGate(baseRow(), START, nonByte);
  eq(a.__submission_key_action, 'MINT_FAILED', 'a non-byte draw was accepted');
  const absent = () => { throw new Error("Cannot find module 'crypto'"); };
  const b = runGate(baseRow(), START, absent);
  eq(b.__submission_key_action, 'MINT_FAILED', 'a missing primitive was not caught');
  assert(/MINT_THREW:/.test(b.__submission_key_reason), 'the reason does not carry the cause');
  // The whole point of the wrapper: this node runs BEFORE the reply is composed.
  assert(b.state !== undefined && b.chat_id === CHAT, 'the turn did not survive a dead primitive');
});

check('(3.11) the deployed body agrees with decideIssuance() across the whole case table', () => {
  const CASES = [
    { name: 'start', row: baseRow({ cycle_id: 'C-x-1', submission_key: K1 }), upd: START, reset: 'start', persisted: K1 },
    { name: 'restart', row: baseRow({ cycle_id: 'C-x-1', consent: 'yes', submission_key: K1 }), upd: RESTART, reset: 'restart', persisted: K1 },
    { name: 'bootstrap', row: baseRow({ cycle_id: '' }), upd: PLAIN, reset: 'bootstrap', persisted: '' },
    { name: 'carry', row: baseRow({ cycle_id: 'C-x-1', submission_key: K1 }), upd: PLAIN, reset: '', persisted: K1 },
    { name: 'carry-malformed', row: baseRow({ cycle_id: 'C-x-1', submission_key: 'sub_zz' }), upd: PLAIN, reset: '', persisted: 'sub_zz' },
    { name: 'legacy', row: baseRow({ cycle_id: 'C-x-1', submission_key: '' }), upd: PLAIN, reset: '', persisted: '' }
  ];
  for (const c of CASES) {
    const deployed = runGate(c.row, c.upd);
    const moduleSide = ISSUER.decideIssuance({
      reset: c.reset,
      persistedKey: c.persisted,
      persistedCycleId: String(c.row.cycle_id || ''),
      mint: () => ISSUER.mintSubmissionKey(randomBytes)
    });
    eq(deployed.__submission_key_action, moduleSide.action, c.name + ': action disagrees with the module');
    eq(deployed.__submission_key_preallocate, moduleSide.preallocate, c.name + ': preallocate disagrees');
    eq(deployed.__submission_key_reason, moduleSide.reason, c.name + ': reason disagrees');
    if (moduleSide.action !== 'MINT') {
      eq(deployed.submission_key, moduleSide.submission_key, c.name + ': carried key disagrees');
    }
  }
});

// ================================================================ 4. the row builders

console.log('\nTHE THREE ROW BUILDERS — they gain the column together or the key is blanked\n');

const colsOf = (name) => {
  const m = src(name).match(/const COLS = \[([\s\S]*?)\]/);
  assert(m, 'COLS not found in ' + name);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
};
const BUILDERS = ['Build Session Row', 'Build Intake State Row', 'Build Confirmation State Row'];

check('(4.1) all three builders declare 37 columns including submission_key', () => {
  BUILDERS.forEach((b) => {
    const cols = colsOf(b);
    eq(cols.length, 37, b + ' COLS is not 36 + submission_key');
    assert(cols.indexOf('submission_key') !== -1, b + ' does not persist submission_key');
    assert(cols.indexOf('cycle_id') !== -1, b + ' stopped persisting cycle_id');
  });
});

const gateOut = (over) => Object.assign({
  chat_id: CHAT, session_id: 's-1', cycle_id: 'C-' + CHAT + '-1', submission_key: K1,
  consent: '', consent_cycle_id: '', consent_at: '', lead_id: '', lead_cycle_id: '',
  lead_sent_at: '', lead_intake_ok: '', previous_lead_id: '', state: 'MENU', status: 'active',
  __submission_key_action: 'CARRY', __submission_key_reason: 'CYCLE_UNCHANGED',
  __submission_key_preallocate: false, __submission_key_fault: false
}, over || {});

// The two later builders do not receive the gate's session — they receive Parse Intake
// Response's `proposed`, which re-attaches the cycle fields from the gate and carries NO key.
// The fixture is built that way rather than handed the gate row, because a fixture that already
// contained the key would prove nothing about the re-attachment.
function buildAll(g) {
  const session = {
    chat_id: CHAT, session_id: 's-1', state: 'MENU', status: 'active', consent: '',
    cycle_id: String(g.cycle_id || ''), previous_lead_id: String(g.previous_lead_id || '')
  };
  assert(!('submission_key' in session), 'the fixture pre-loads the key the builders must re-attach');
  return {
    'Build Session Row': runOne('Build Session Row',
      { 'Build Bot Response': { session }, 'Get Bot Session': g }),
    'Build Intake State Row': runOne('Build Intake State Row',
      { 'Get Bot Session': g }, [{ json: { session } }]),
    'Build Confirmation State Row': runOne('Build Confirmation State Row',
      { 'Parse Telegram Update': PLAIN, 'Parse Intake Response': { session }, 'Get Bot Session': g },
      [{ json: { ok: true } }])
  };
}

check('(4.2) executed — all three builders write the key the cycle gate decided', () => {
  const rows = buildAll(gateOut());
  BUILDERS.forEach((b) => eq(rows[b].submission_key, K1, b + ' did not write the gate key'));
});

// Without this, (4.2) is also what three builders that all happened to inherit the key from
// upstream would produce. The failure being guarded against is a builder that omits the column
// and therefore writes '' over a key the previous save wrote.
check('(4.3) MUTATION — a builder without the column BLANKS the key', () => {
  const stripped = src('Build Intake State Row').replace(",'submission_key']", ']');
  assert(stripped !== src('Build Intake State Row'), 'the mutation did not apply');
  const $ = (n) => ({ first: () => ({ json: { 'Get Bot Session': gateOut() }[n] }) });
  const out = new Function('$', '$input', stripped)($, { first: () => ({ json: { session: { chat_id: CHAT } } }) })[0].json;
  eq(out.submission_key, undefined, 'the mutant still emitted the column — the check proves nothing');
  eq(buildAll(gateOut())['Build Intake State Row'].submission_key, K1, 'the real builder does not emit it either');
});

// F16 — a stray property does not vanish, it permanently widens Bot_Sessions.
check('(4.4) F16 — each builder emits EXACTLY its declared COLS, and no __ annotation leaks', () => {
  const rows = buildAll(gateOut());
  BUILDERS.forEach((b) => {
    eq(j(Object.keys(rows[b]).sort()), j(colsOf(b).slice().sort()), b + ' emits keys outside its COLS');
    assert(!Object.keys(rows[b]).some((k) => k.indexOf('__') === 0), b + ' leaked a decision annotation onto the sheet');
  });
});

check('(4.5) OLD-SESSION COMPATIBILITY — a legacy row round-trips with an empty key and nothing else moves', () => {
  const legacy = baseRow({ cycle_id: 'C-' + CHAT + '-1', submission_key: '', consent: 'yes', consent_cycle_id: 'C-' + CHAT + '-1', notes: 'n' });
  const g = runGate(legacy, PLAIN);
  eq(g.__submission_key_action, 'LEGACY_NO_KEY', 'a legacy row did not take the legacy path');
  const rows = buildAll(g);
  BUILDERS.forEach((b) => {
    eq(rows[b].submission_key, '', b + ' invented a key for a legacy row');
    eq(rows[b].cycle_id, 'C-' + CHAT + '-1', b + ' disturbed the legacy cycle');
  });
  // The canonical empty session a brand-new chat gets now names the column explicitly rather
  // than leaving it to be inferred from an absent property.
  assert(/submission_key: ''/.test(src('Find Session')),
    'the canonical empty session does not declare submission_key');
});

// F7 — the authority write consumes the VERIFIER's output, so "authority advanced without a
// confirmed receipt" is a data dependency rather than a rule about the wiring.
check('(4.6) F7 BINDING — Build Session Row writes the key the readback VERIFIED', () => {
  const withVerdict = runOne('Build Session Row', {
    'Build Bot Response': { session: { chat_id: CHAT } },
    'Get Bot Session': gateOut({ submission_key: K2 }),
    'Issuance Verdict': { __advance: true, __verified_submission_key: K1 }
  });
  eq(withVerdict.submission_key, K1, 'the authority write did not take the verified key');
  const noVerdict = runOne('Build Session Row', {
    'Build Bot Response': { session: { chat_id: CHAT } },
    'Get Bot Session': gateOut({ submission_key: K2 })
  });
  eq(noVerdict.submission_key, K2, 'a carry with no verdict lost its key');
});

// ================================================================ 5. receipt before authority

console.log('\nRECEIPT BEFORE AUTHORITY — proven by walking the graph, not by reading the picture\n');

const conn = CAND.connections;
function outEdges(node, output) {
  const c = conn[node];
  if (!c || !c.main) { return []; }
  const lists = output === undefined ? c.main : [c.main[output] || []];
  return lists.reduce((acc, l) => acc.concat(l.map((e) => e.node)), []);
}
function allPaths(seed, target) {
  const out = [];
  (function walk(node, path) {
    if (node === target) { out.push(path); return; }
    if (path.filter((n) => n === node).length > 1) { return; }
    outEdges(node).forEach((n) => walk(n, path.concat(n)));
  })(seed, [seed]);
  return out;
}
const orderedIn = (path, seq) => {
  let i = -1;
  return seq.every((n) => { const k = path.indexOf(n); if (k <= i) { return false; } i = k; return true; });
};

check('(5.1) the delivered branch enters the issuer, and the failure branch is untouched', () => {
  eq(j(outEdges('IF Message Delivered', 0)), j(['Issuance Gate']), 'the delivered branch does not enter the issuer');
  eq(j(outEdges('IF Message Delivered', 1)), j(['Build Delivery Failure Event']), 'the failure branch changed');
  eq(j(outEdges('Issuance Gate')), j(['IF Issuance Fault']), 'the gate does not fail-closed first');
});

check('(5.2) EXACTLY TWO paths reach Save Bot Session, and only one of them mints', () => {
  const paths = allPaths('Issuance Gate', 'Save Bot Session');
  eq(paths.length, 2, 'the number of ways to reach the authority write changed: ' + j(paths));
  const minting = paths.filter((p) => p.indexOf('Receipt Preallocate') !== -1);
  const carrying = paths.filter((p) => p.indexOf('Receipt Preallocate') === -1);
  eq(minting.length, 1, 'there is not exactly one minting path');
  eq(carrying.length, 1, 'there is not exactly one non-minting path');
  assert(orderedIn(minting[0], [
    'IF Issuance Fault', 'IF Preallocation Required', 'Receipt Preallocate', 'Receipt Readback',
    'Issuance Verdict', 'IF Authority May Advance', 'Build Session Row', 'Save Bot Session'
  ]), 'ISSUANCE_ORDER is not the order of the minting path: ' + j(minting[0]));
});

check('(5.3) the non-minting path is the branch where NO receipt was required', () => {
  eq(j(outEdges('IF Preallocation Required', 0)), j(['Receipt Preallocate']), 'the true branch does not preallocate');
  eq(j(outEdges('IF Preallocation Required', 1)), j(['Build Session Row']), 'the false branch does not rejoin the flow');
  eq(j(outEdges('IF Authority May Advance', 0)), j(['Build Session Row']), 'a confirmed issuance does not reach the authority write');
  eq(j(outEdges('IF Authority May Advance', 1)), j(['Build Issuance Failure Event']), 'an unconfirmed issuance is not diverted');
});

check('(5.4) FAIL-CLOSED — a faulted issuance has NO path to the authority write', () => {
  const faultSeed = outEdges('IF Issuance Fault', 0);
  eq(j(faultSeed), j(['Build Issuance Failure Event']), 'the fault branch changed');
  eq(allPaths(faultSeed[0], 'Save Bot Session').length, 0, 'a faulted issuance can still persist a cycle');
  eq(allPaths('Build Issuance Failure Event', 'Save Intake State').length, 0, 'a faulted issuance can still write a state row');
  eq(j(outEdges('Build Issuance Failure Event')), j(['Save Bot Event']), 'the fail-closed terminal moved');
});

check('(5.5) Build Session Row has exactly the two declared inbound edges', () => {
  const inbound = Object.keys(conn).filter((k) => outEdges(k).indexOf('Build Session Row') !== -1);
  eq(j(inbound.sort()), j(['IF Authority May Advance', 'IF Preallocation Required']),
    'something else can now reach the authority row builder');
});

check('(5.6) the preallocation record IS buildPreallocation()\'s record, field for field', () => {
  const v = candNode('Receipt Preallocate').parameters.columns.value;
  const expected = pristineRow(K1);
  eq(j(Object.keys(v).sort()), j(Object.keys(expected).sort()), 'the receipt field set drifted from the module');
  Object.keys(expected).forEach((f) => {
    if (f === 'submission_key' || f === 'created_at') { return; }   // the two expression fields
    eq(v[f], expected[f], 'preallocated ' + f + ' is not what buildPreallocation writes');
  });
  assert(/^=\{\{ \$\('Issuance Gate'\)/.test(v.submission_key), 'the key is not read from the issuance gate');
  eq(v.created_at, '={{ $now.toISO() }}', 'created_at is not stamped by the platform clock');
  eq(v.correlation_id, '', 'a correlation id was minted at preallocation — buildPreallocation refuses that outright');
  eq(candNode('Receipt Preallocate').parameters.operation, 'insert', 'the preallocation is not an insert');
});

check('(5.7) both Data Table nodes are fail-closed-capable and read the key BY NODE REFERENCE', () => {
  ['Receipt Preallocate', 'Receipt Readback'].forEach((n) => {
    const node = candNode(n);
    eq(node.alwaysOutputData, true, n + ' lost alwaysOutputData — the fail-closed branch could never run');
    eq(node.onError, 'continueRegularOutput', n + ' throws at the caller instead of failing closed');
    eq(node.parameters.dataTableId.value, 'Submission_Receipts', n + ' points at a different table');
  });
  const f = candNode('Receipt Readback').parameters.filters.conditions[0];
  eq(f.keyName, 'submission_key', 'the readback does not match on the key');
  eq(f.condition, 'eq', 'the readback is not an exact match');
  // The insert output is { id, createdAt, updatedAt } and carries no key at all, so $json here
  // would silently read undefined and the readback would match nothing.
  assert(f.keyValue.indexOf("$('Issuance Gate')") !== -1, 'the readback does not read the key from the gate');
  assert(f.keyValue.indexOf('$json') === -1, 'the readback reads the key from $json, which does not carry it');
  eq(candNode('Receipt Readback').parameters.returnAll, true, 'returnAll is off — a DUPLICATE would be truncated to one');
});

// ================================================================ 6. the readback verdict

console.log('\nTHE READBACK VERDICT — cardinality AND content, executed\n');

function verdict(rows, key, opts) {
  const o = opts || {};
  const items = rows.map((r) => ({ json: r }));
  const $ = (n) => {
    if (n === 'Issuance Gate') { return { first: () => ({ json: { __submission_key: key } }) }; }
    if (n === 'Receipt Preallocate') {
      if (o.insertAbsent) { throw new Error('no data'); }
      return { first: () => ({ json: o.insert || { id: 1 } }) };
    }
    throw new Error('verdict referenced an unexpected node: ' + n);
  };
  return new Function('$', '$input', src('Issuance Verdict'))($, { all: () => items })[0].json;
}
const EMPTY_ITEM = {};                                   // what alwaysOutputData emits on no match

function moduleVerdict(rows, key, storeError) {
  return RECEIPT.verifyPreallocationReadback({ submissionKey: key, rows: rows, storeError: storeError === true });
}

check('(6.1) a pristine single READY row advances and NAMES the key it verified', () => {
  const v = verdict([pristineRow(K1)], K1);
  eq(v.__advance, true, 'a confirmed preallocation did not advance');
  eq(v.__reason, 'PREALLOCATION_CONFIRMED', 'reason');
  eq(v.__verified_submission_key, K1, 'the verdict does not name the key it verified');
});

check('(6.2) ABSENT — the one empty item alwaysOutputData emits is not a row', () => {
  const v = verdict([EMPTY_ITEM], K1);
  eq(v.__advance, false, 'an absent receipt advanced authority');
  eq(v.__reason, 'READBACK_ABSENT', 'reason');
  eq(v.__rows_seen, 0, 'the empty item was counted as a row');
});

// The discriminator is by KEY COUNT. A truthiness test passes an empty object and a try/catch
// never fires, and both were live defects in this system before P4 named them.
check('(6.3) MUTATION — a truthiness discriminator would have passed the empty item', () => {
  assert(Boolean(EMPTY_ITEM) === true, 'the premise is wrong — an empty object is falsy here');
  eq(Object.keys(EMPTY_ITEM).length, 0, 'the empty item is not empty');
  eq(verdict([EMPTY_ITEM], K1).__reason, 'READBACK_ABSENT', 'the real verdict was fooled');
});

check('(6.4) DUPLICATE — two rows for one key refuse, because the store cannot prevent them', () => {
  const v = verdict([pristineRow(K1), pristineRow(K1)], K1);
  eq(v.__advance, false, 'a duplicated receipt advanced authority');
  eq(v.__reason, 'READBACK_DUPLICATE', 'reason');
});

check('(6.5) a WRONG key refuses, and a padded key is never trimmed into a match', () => {
  eq(verdict([pristineRow(K2)], K1).__reason, 'READBACK_WRONG_KEY', 'a foreign row was accepted');
  const padded = Object.assign(pristineRow(K1), { submission_key: K1 + ' ' });
  eq(verdict([padded], K1).__reason, 'READBACK_WRONG_KEY', 'a padded key was trimmed into a match');
  const typed = Object.assign(pristineRow(K1), { submission_key: 12345 });
  eq(verdict([typed], K1).__reason, 'READBACK_WRONG_KEY', 'a non-string key was coerced into a match');
});

check('(6.6) a row in any state but READY refuses', () => {
  ['IN_FLIGHT', 'COMMITTED', 'ABORTED', ''].forEach((st) => {
    const r = Object.assign(pristineRow(K1), { commit_state: st });
    eq(verdict([r], K1).__reason, 'READBACK_WRONG_STATE', 'state ' + j(st) + ' was accepted as pristine');
  });
});

check('(6.7) each of the seven pristine fields, ALONE, refuses the advance', () => {
  const FIELDS = RECEIPT.PREALLOCATION_READBACK_RULES.required_pristine_fields;
  eq(FIELDS.length, 7, 'the module no longer declares seven pristine fields');
  FIELDS.forEach((f) => {
    const r = Object.assign(pristineRow(K1), { [f]: 'x' });
    const v = verdict([r], K1);
    eq(v.__advance, false, 'residue in ' + f + ' advanced authority');
    eq(v.__reason, 'READBACK_NOT_PRISTINE', 'residue in ' + f + ' produced the wrong reason');
    assert(String(v.__dirty_fields).indexOf(f) !== -1, 'the verdict does not name ' + f + ' as dirty');
  });
});

check('(6.8) a row that already carries a correlation id has been claimed and refuses', () => {
  const r = Object.assign(pristineRow(K1), { correlation_id: 'req-1' });
  eq(verdict([r], K1).__reason, 'READBACK_ALREADY_CLAIMED', 'a claimed receipt was treated as a fresh preallocation');
});

check('(6.9) created_at must be PRESENT and parseable, and is never repaired', () => {
  eq(verdict([Object.assign(pristineRow(K1), { created_at: '' })], K1).__reason, 'READBACK_CREATED_AT_MISSING', 'missing');
  eq(verdict([Object.assign(pristineRow(K1), { created_at: 'yesterday' })], K1).__reason, 'READBACK_CREATED_AT_INVALID', 'invalid');
});

check('(6.10) a store error refuses, and a "successful" insert is NOT confirmation', () => {
  const v = verdict([{ error: 'ECONNRESET' }], K1);
  eq(v.__advance, false, '"we could not look" was read as "it is there"');
  eq(v.__reason, 'READBACK_STORE_ERROR', 'reason');
  // The insert reported success and returned a row id. The receipt is still absent.
  const w = verdict([EMPTY_ITEM], K1, { insert: { id: 991, createdAt: '2026-08-27T10:00:00Z' } });
  eq(w.__advance, false, 'an insert that returned an id was accepted as confirmation');
  eq(w.__reason, 'READBACK_ABSENT', 'reason');
  eq(verdict([pristineRow(K1)], 'sub_nothex').__reason, 'SUBMISSION_KEY_INVALID', 'a malformed key was verified');
});

check('(6.11) the deployed verdict agrees with verifyPreallocationReadback() on every case', () => {
  const CASES = [
    ['confirmed', [pristineRow(K1)], K1, false],
    ['absent', [], K1, false],
    ['duplicate', [pristineRow(K1), pristineRow(K1)], K1, false],
    ['wrong key', [pristineRow(K2)], K1, false],
    ['wrong state', [Object.assign(pristineRow(K1), { commit_state: 'IN_FLIGHT' })], K1, false],
    ['not pristine', [Object.assign(pristineRow(K1), { lead_priority: 'p1' })], K1, false],
    ['claimed', [Object.assign(pristineRow(K1), { correlation_id: 'r' })], K1, false],
    ['created_at missing', [Object.assign(pristineRow(K1), { created_at: '' })], K1, false],
    ['created_at invalid', [Object.assign(pristineRow(K1), { created_at: 'nope' })], K1, false],
    ['bad key', [pristineRow(K1)], 'sub_x', false]
  ];
  for (const [name, rows, key] of CASES) {
    // The graph delivers "no rows" as ONE EMPTY ITEM; the module is handed the empty array.
    const deployed = verdict(rows.length ? rows : [EMPTY_ITEM], key);
    const moduleSide = moduleVerdict(rows, key);
    eq(deployed.__advance, moduleSide.advance, name + ': advance disagrees with the module');
    eq(deployed.__reason, moduleSide.reason, name + ': reason disagrees with the module');
  }
  // storeError has no array form, so it is compared on its own.
  eq(verdict([{ error: 'x' }], K1).__reason, moduleVerdict([], K1, true).reason, 'store error disagrees');
});

// ================================================================ 7. post-authority reread

console.log('\nTHE POST-AUTHORITY REREAD — a turn that wrote the row is not thereby the winner\n');

function authority(rows, held) {
  const $ = (n) => {
    if (n === 'Parse Telegram Update') { return { first: () => ({ json: PLAIN }) }; }
    if (n === 'Get Bot Session') { return { first: () => ({ json: held }) }; }
    throw new Error('authority verdict referenced an unexpected node: ' + n);
  };
  return new Function('$', '$input', src('Authority Verdict'))($, { all: () => rows.map((r) => ({ json: r })) })[0].json;
}
// Realistic stamps. Date.now() has been 13 digits since 2001 and stays 13 until 2286, so the
// fixtures use 13-digit values rather than toy ones — a parser bug that only shows up at real
// widths is exactly the kind this section exists to catch.
const T0 = 1787000000000;
const CYC = (ms) => 'C-' + CHAT + '-' + ms;
const held = (cyc, key) => ({ chat_id: CHAT, cycle_id: cyc, submission_key: key });
const row = (cyc, key, chat) => ({ chat_id: chat === undefined ? CHAT : chat, cycle_id: cyc, submission_key: key });

check('(7.1) the row this turn wrote is still current — the handoff proceeds', () => {
  const v = authority([row(CYC(T0), K1)], held(CYC(T0), K1));
  eq(v.__current, true, 'a current authority row was refused');
  eq(v.__reason, 'AUTHORITY_CURRENT', 'reason');
});

check('(7.2) a NEWER cycle in the row is a concurrent winner — the handoff is refused', () => {
  const v = authority([row(CYC(T0 + 1000), K2)], held(CYC(T0), K1));
  eq(v.__current, false, 'a superseded turn was allowed to hand a lead to Intake');
  eq(v.__reason, 'AUTHORITY_CYCLE_SUPERSEDED', 'reason');
  eq(v.__held_cycle_id, CYC(T0), 'the verdict does not carry what this turn held');
  eq(v.__current_cycle_id, CYC(T0 + 1000), 'the verdict does not carry what the row now names');
});

// The same-millisecond case is the collision P3 flagged: identical cycle_id, different key. The
// timestamps cannot separate them; the key can.
check('(7.3) SAME cycle, different key — the same-millisecond loser is caught by the key', () => {
  const v = authority([row(CYC(T0), K2)], held(CYC(T0), K1));
  eq(v.__current, false, 'a same-millisecond loser was allowed to proceed');
  eq(v.__reason, 'AUTHORITY_KEY_SUPERSEDED', 'reason');
});

check('(7.4) an OLDER cycle is this turn\'s own write not yet visible — it proceeds, and SAYS so', () => {
  const v = authority([row(CYC(T0 - 1000), '')], held(CYC(T0), K1));
  eq(v.__current, true, 'a lagging read was mistaken for a loss and a real lead was dropped');
  eq(v.__reason, 'AUTHORITY_READ_LAGGED', 'a lagged read is indistinguishable from a clean one');
});

// Without this, (7.4) looks like leniency rather than a discrimination that had to be designed.
check('(7.5) MUTATION — a naive equality check would have refused the lagging read', () => {
  const naive = (cur, h) => cur.cycle_id === h.cycle_id && cur.submission_key === h.submission_key;
  eq(naive(row(CYC(T0 - 1000), ''), held(CYC(T0), K1)), false, 'the premise is wrong');
  eq(authority([row(CYC(T0 - 1000), '')], held(CYC(T0), K1)).__current, true, 'the real verdict is just as naive');
  // ...and it must still refuse the case the naive check would also refuse, or it is merely lax.
  eq(authority([row(CYC(T0 + 1000), K2)], held(CYC(T0), K1)).__current, false, 'the verdict refuses nothing');
});

// ---------------------------------------------------------------- the parser, and its default
//
// FOUND WHILE WRITING (7.2), AND IT WAS NOT A TEST BUG. The first form of the stamp parser took
// the trailing run of digits and required TEN OR MORE of them, and anything that failed to parse
// stamped as NaN — which fell through to AUTHORITY_READ_LAGGED, which PROCEEDS. That default is
// the wrong way round: it turns "I cannot compare these" into "carry on".
//
// The values that do not parse are not hypothetical, and two of them are written by this
// repository's own tooling. scripts/p71-sheet-probe.ps1 wrote cycle_id C-900000701-P71 into the
// REAL Bot_Sessions sheet during P7.1, and scripts/build-cas-gate-workflow.mjs writes C-900,
// which has no stamp segment at all. Either of those sitting in the authority row while this
// turn held a genuine minted cycle would have been read as a lagging read, and the losing turn
// would have handed its lead to Intake under a key Bot_Sessions no longer named.
//
// The fix is in the CANDIDATE, not here: parse the exact minted shape, and refuse when either
// side is uncomparable.
check('(7.6) PARSER — an UNCOMPARABLE cycle refuses; it is never mistaken for a lagging read', () => {
  const probe = 'C-900000701-P71';                 // the shape P7.1's probe actually wrote live
  const v = authority([row(probe, K2)], held(CYC(T0), K1));
  eq(v.__current, false, 'an unparseable authority cycle was treated as a lagging read and PROCEEDED');
  eq(v.__reason, 'AUTHORITY_CYCLE_UNCOMPARABLE', 'reason');
  // No stamp segment at all — the shape build-cas-gate-workflow.mjs writes.
  eq(authority([row('C-900', K2)], held(CYC(T0), K1)).__reason, 'AUTHORITY_CYCLE_UNCOMPARABLE', 'C-900');
  // ...and an unparseable value on the HELD side is refused for the same reason.
  eq(authority([row(CYC(T0), K2)], held('C-900', K1)).__reason, 'AUTHORITY_CYCLE_UNCOMPARABLE', 'held side');
});

check('(7.7) MUTATION — the ten-digit parser with a fall-through default WOULD have proceeded', () => {
  // The exact algorithm the candidate carried before the fix, modelled rather than re-extracted
  // so that it stays readable as the thing that was wrong.
  const failOpen = (cur, h) => {
    const st = (cid) => { const m = /-(\d{10,})$/.exec(String(cid)); return m ? Number(m[1]) : NaN; };
    if (cur.cycle_id === h.cycle_id) { return cur.submission_key === h.submission_key; }
    const a = st(h.cycle_id);
    const b = st(cur.cycle_id);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) { return false; }
    return true;                                    // <- the fall-through that proceeds
  };
  const probeRow = row('C-900000701-P71', K2);
  const heldNow = held(CYC(T0), K1);
  eq(failOpen(probeRow, heldNow), true, 'the premise is wrong — the old form would have refused too');
  eq(authority([probeRow], heldNow).__current, false, 'the candidate still fails open');
  // The threshold itself is gone, not merely lowered: a short-but-well-formed stamp compares.
  eq(authority([row('C-' + CHAT + '-3000', K2)], held('C-' + CHAT + '-2000', K1)).__reason,
    'AUTHORITY_CYCLE_SUPERSEDED', 'a short numeric stamp is no longer compared at all');
});

check('(7.8) an ABSENT authority row refuses — "we could not look" is not "we are current"', () => {
  eq(authority([], held(CYC(T0), K1)).__reason, 'AUTHORITY_ROW_ABSENT', 'an unreadable row was accepted');
  eq(authority([row(CYC(T0), K1, '900000999')], held(CYC(T0), K1)).__reason, 'AUTHORITY_ROW_ABSENT',
    'a row for a DIFFERENT chat was accepted as this chat\'s authority');
});

check('(7.9) a key APPEARING where this turn holds none is a concurrent mint, and refuses', () => {
  const v = authority([row(CYC(T0), K1)], held(CYC(T0), ''));
  eq(v.__current, false, 'a legacy turn proceeded after someone else minted for the same cycle');
  eq(v.__reason, 'AUTHORITY_KEY_SUPERSEDED', 'reason');
  // ...and a legacy turn where nobody minted is still allowed through, or legacy users are broken.
  eq(authority([row(CYC(T0), '')], held(CYC(T0), '')).__current, true, 'a legacy turn was refused for no reason');
});

check('(7.10) the lead handoff is reachable ONLY through IF Authority Current[true]', () => {
  eq(j(outEdges('IF Lead Ready', 0)), j(['Authority Reread']), 'the lead branch skips the reread');
  eq(j(outEdges('IF Lead Ready', 1)), j(['Build Bot Event']), 'the non-lead branch changed');
  eq(j(outEdges('IF Authority Current', 0)), j(['IF Lead Already Sent']), 'a current turn does not reach the handoff');
  eq(j(outEdges('IF Authority Current', 1)), j(['Build Stale Authority Event']), 'a stale turn is not diverted');
  allPaths('IF Lead Ready', 'Send Lead to Intake').forEach((p) => {
    assert(p.indexOf('IF Authority Current') !== -1, 'a lead can reach Intake without the reread: ' + j(p));
    assert(orderedIn(p, ['Authority Reread', 'Authority Verdict', 'IF Authority Current', 'Send Lead to Intake']),
      'the reread does not precede the handoff: ' + j(p));
  });
  eq(allPaths('Build Stale Authority Event', 'Send Lead to Intake').length, 0, 'a stale turn can still reach Intake');
  eq(allPaths('Build Stale Authority Event', 'Save Intake State').length, 0, 'a stale turn can still write a state row');
});

// ================================================================ 8. TB-1 and event hygiene

console.log('\nTB-1 AND EVENT HYGIENE — the key is a capability, not a log field\n');

check('(8.1) submission_key is not, and must never be, a CLIENT_RESPONSE_FIELD', () => {
  assert(SUBMIT.CLIENT_RESPONSE_FIELDS.indexOf('submission_key') === -1,
    'the key now crosses TB-1 to the browser');
});

check('(8.2) no client-facing Concierge node references submission_key', () => {
  const CLIENT_FACING = [
    'Build Bot Response', 'Build Transport Request', 'Build Intake Transport Request',
    'Build Recovery Request', 'Answer Callback Query', 'Send Client Message',
    'Send Intake Confirmation', 'Send Recovery Message', 'Send Lead to Intake'
  ];
  CLIENT_FACING.forEach((n) => assert(j(candNode(n).parameters).indexOf('submission_key') === -1,
    n + ' now carries submission_key across a trust boundary'));
});

check('(8.3) both new event builders emit EXACTLY the twelve Bot_Events keys', () => {
  const gate = { __submission_key: K1, __issuance_action: 'MINT', __issuance_reason: 'NEW_CYCLE_START', __fault_reason: '' };
  const a = runOne('Build Issuance Failure Event', {
    'Parse Telegram Update': PLAIN, 'Build Bot Response': { debug: { state_before: 'MENU', state_after: 'X' } },
    'Issuance Gate': gate, 'Issuance Verdict': { __reason: 'READBACK_ABSENT', __rows_seen: 0 }
  });
  const b = runOne('Build Stale Authority Event', {
    'Parse Telegram Update': PLAIN, 'Build Bot Response': { debug: { state_before: 'MENU', state_after: 'X' } },
    'Authority Verdict': { __reason: 'AUTHORITY_CYCLE_SUPERSEDED', __held_cycle_id: CYC(1), __current_cycle_id: CYC(2), __held_key_present: true }
  });
  [['Build Issuance Failure Event', a], ['Build Stale Authority Event', b]].forEach(([n, out]) => {
    eq(j(Object.keys(out).sort()), j(BOT_EVENT_KEYS.slice().sort()), n + ' emits keys outside the Bot_Events set');
  });
  assert(/issuance_unconfirmed: READBACK_ABSENT/.test(a.detail), 'the issuance failure does not name its reason');
  assert(/authority_stale: AUTHORITY_CYCLE_SUPERSEDED/.test(b.detail), 'the stale event does not name its reason');
});

// A submission_key is a capability: whoever holds it can claim the receipt. Bot_Events has wider
// read access than the Data Table.
check('(8.4) neither event builder ever writes the key VALUE, only whether one was present', () => {
  const gate = { __submission_key: K1, __issuance_action: 'MINT', __fault_reason: 'MINT_UNUSABLE' };
  const a = runOne('Build Issuance Failure Event', {
    'Parse Telegram Update': PLAIN, 'Build Bot Response': { debug: {} }, 'Issuance Gate': gate
  });
  assert(j(a).indexOf(K1) === -1, 'the issuance failure event leaked the key into Bot_Events');
  assert(/"submission_key_present":true/.test(a.raw_json), 'presence is not recorded at all');
  const b = runOne('Build Stale Authority Event', {
    'Parse Telegram Update': PLAIN, 'Build Bot Response': { debug: {} },
    'Authority Verdict': { __reason: 'AUTHORITY_KEY_SUPERSEDED', __held_cycle_id: CYC(1), __current_cycle_id: CYC(1), __held_key_present: true, __current_key_present: true }
  });
  assert(j(b).indexOf(K1) === -1, 'the stale authority event leaked the key into Bot_Events');
  assert(/"lead_handoff_suppressed":true/.test(b.raw_json), 'the event does not record that the handoff was suppressed');
});

// ================================================================ 9. the artifact

console.log('\nTHE ARTIFACT — what it is, and what it is not safe to do with\n');

check('(9.1) the candidate declares it is not deployed, and the import hazard it really carries', () => {
  eq(CAND.meta.finmentor_not_deployed, true, 'the candidate no longer declares itself undeployed');
  assert(/NOT IMPORT-SAFE/.test(CAND.meta.finmentor_import_hazard || ''), 'the import hazard is not declared');
  // The hazard statement has to be TRUE, or it is decoration. These are the three things that
  // make a hand-import an overwrite of the running bot.
  eq(CAND.id, 'mppzthlkSJFr6Kle', 'the candidate no longer carries the production id the hazard names');
  eq(CAND.active, true, 'the candidate no longer carries the lifecycle state the hazard names');
  assert(CAND.nodes.some((n) => n.type === 'n8n-nodes-base.telegramTrigger'),
    'the candidate no longer carries the live trigger the hazard names');
});

check('(9.2) the candidate contains exactly ONE graph — the shadow copy is stripped', () => {
  assert(!('activeVersion' in CAND), 'activeVersion survived: the file holds a second, UNSPLICED graph');
  assert('activeVersion' in PROD, 'the premise changed — production no longer carries a shadow copy');
  assert(/activeVersion/.test(CAND.meta.finmentor_active_version_stripped || ''), 'the removal is not declared');
});

check('(9.3) the generator is DETERMINISTIC — regenerating produces a byte-identical candidate', () => {
  const before = readFileSync(CAND_PATH, 'utf8');
  const r = spawnSync(process.execPath, [GENERATOR], { encoding: 'utf8' });
  eq(r.status, 0, 'the generator failed on a clean tree: ' + (r.stderr || '').slice(0, 300));
  const after = readFileSync(CAND_PATH, 'utf8');
  eq(after.length, before.length, 'regeneration changed the candidate length');
  assert(after === before, 'regeneration produced a DIFFERENT candidate — the splice is not deterministic');
});

// ---------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
