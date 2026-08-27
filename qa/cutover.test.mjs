#!/usr/bin/env node
// FINMENTOR — P7.5: the production cutover artifact, and the Bot_Sessions write guard.
//
//   node qa/cutover.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// TWO THINGS ARE DEFENDED HERE.
//
//   §2/§3  The artifact that gets PUT to the LIVE production workflow. It is not the canary
//          wrapper and must never become it: it keeps the production identity, the production
//          name, and a Telegram trigger byte-identical to the live one, ENABLED. Every
//          difference from production is classified, and UNEXPECTED is fatal.
//
//   §10    The Bot_Sessions write-key guard. `autoMapInputData` APPENDS A NEW COLUMN for an
//          unrecognised key (F16), and this project has now tripped that twice: six columns
//          from earlier canaries, and three more (`__do_write`, `__mode`, `__before`) added by
//          P7.4's own state tool. The defence used to be a naming convention. This makes it a
//          check.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const M = await import('file://' + join(ROOT, 'scripts', 'build-concierge-cutover.mjs').replace(/\\/g, '/'));
const S = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'bot-sessions-schema.js'));
const F = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'schema-footprint.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const deepEq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m); } };

const PROD = JSON.parse(readFileSync(join(ROOT, 'n8n', 'production',
  'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));
const CAND = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json'), 'utf8'));
// The cutover artifact is NO LONGER WRITTEN TO DISK. The generator refuses, because every
// artifact derived from the tracked (redacted) production export carries <REDACTED_CHAT_ID>
// and is not deployable. It is built in memory here so the classifier can still be tested.
const CUT_RAW = M.buildCutover(PROD, CAND);

// A marker-free variant, used ONLY to exercise the classifier rules that are not about
// redaction. Restoring the real expression is what the next cutover must do for real, from an
// unredacted live export -- doing it here in a test is not a fix, it is a fixture.
const CUT = JSON.parse(JSON.stringify(CUT_RAW).split('<REDACTED_CHAT_ID>').join('={{ $json.chat_id }}'));
// The SAME desanitisation applied to production, so the non-redaction rules are exercised
// against a consistent pair. Desanitising only one side would make every transport node look
// modified -- which is true, but it is the redaction finding, not the rule under test.
const PROD_SAN = JSON.parse(JSON.stringify(PROD).split('<REDACTED_CHAT_ID>').join('={{ $json.chat_id }}'));
const WRAPPER = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-issuer-IMPORT-SAFE.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);

// ================================================================ 1. the cutover artifact

console.log('\n-- the production cutover artifact --');

check('P7.5R: the redactor fix landed — transport expressions survive redaction', () => {
  // The three nodes P7.5 destroyed. The corrected redactor preserves n8n expressions, so the
  // tracked reference and everything derived from it now carry the real expression.
  ['Send Client Message', 'Send Intake Confirmation', 'Send Recovery Message'].forEach((n) => {
    const node = byName(PROD, n);
    assert(node, 'production node missing: ' + n);
    eq(node.parameters.workflowInputs.value.chat_id, '={{ $json.chat_id }}',
      'the tracked reference no longer carries the real transport expression for ' + n);
    eq(byName(CUT_RAW, n).parameters.workflowInputs.value.chat_id, '={{ $json.chat_id }}',
      'the derived artifact lost the transport expression for ' + n);
  });
});

check('AND IT IS STILL REFUSED: a disk-built artifact remains non-deployable', () => {
  // The fix removed the transport defect. It did NOT make the artifact deployable, and that
  // distinction is the whole of P7.5R. `Settings to Object` carries a hardcoded Telegram id in
  // its Code body — a CONCRETE identity, correctly still redacted — so an artifact assembled
  // offline still carries a marker.
  //
  // More importantly the ban does not depend on that: no tracked artifact is production
  // deployable, whether or not it happens to be clean. Narrowing the rule to "the ones we know
  // are bad" is what let P7.5 through.
  const v = M.classifyCutover(PROD, CUT_RAW);
  assert(!v.ok, 'the classifier ACCEPTED a disk-built artifact');
  const m = M.findRedactionMarkers(CUT_RAW);
  assert(m.length > 0, 'no marker left; the refusal must then rest on the classification policy alone');
  assert(M.redactedNodes(CUT_RAW).indexOf('Settings to Object') !== -1,
    'expected the hardcoded id in Settings to Object to remain redacted');
});

check('no deployable artifact is left on disk carrying a redaction marker', () => {
  // The generator refuses to write one. This proves an older one was not left behind.
  let present = true;
  try { readFileSync(join(ROOT, 'n8n', 'candidate', 'concierge-cutover-PRODUCTION.json')); }
  catch (e) { present = false; }
  assert(!present, 'a cutover artifact is on disk; the generator refuses to write one, so it is stale and unsafe');
});

check('classification is clean: zero UNEXPECTED', () => {
  const v = M.classifyCutover(PROD_SAN, CUT);
  assert(v.ok, 'UNEXPECTED findings: ' + v.findings.filter((f) => f.kind === 'UNEXPECTED').map((f) => f.what).join('; '));
  eq(v.counts.UNEXPECTED, 0, 'unexpected count');
  assert(v.counts.MODEL_B_REQUIRED >= 30, 'the Model-B change set shrank to ' + v.counts.MODEL_B_REQUIRED);
});

check('IT IS NOT THE CANARY WRAPPER', () => {
  // The single most dangerous confusion available in this phase. The wrapper is built to be
  // inert; PUTting it over production would disable the live bot's trigger.
  assert(CUT.name !== WRAPPER.name, 'the cutover artifact carries the canary name');
  eq(CUT.name, PROD.name, 'the cutover artifact does not carry the production name');
  const t = byName(CUT, M.TRIGGER_NODE_NAME);
  assert(t.disabled !== true, 'the cutover artifact would DISABLE the production trigger');
  const wt = byName(WRAPPER, M.TRIGGER_NODE_NAME);
  eq(wt.disabled, true, 'the wrapper is no longer the disabled artifact; the contrast is gone');
});

check('the Telegram trigger is byte-identical to production', () => {
  deepEq(byName(CUT, M.TRIGGER_NODE_NAME), byName(PROD, M.TRIGGER_NODE_NAME), 'the trigger changed');
});

check('exactly one trigger, carrying the production webhookId and credential', () => {
  const trig = CUT.nodes.filter((n) => /trigger$/i.test(String(n.type)) || n.type === 'n8n-nodes-base.webhook');
  eq(trig.length, 1, 'trigger count');
  eq(trig[0].webhookId, M.TRIGGER_WEBHOOK_ID, 'webhookId');
  eq(trig[0].credentials.telegramApi.id, M.BOT_CREDENTIAL_ID, 'credential');
});

check('the artifact carries ONLY the four fields the update schema accepts', () => {
  deepEq(Object.keys(CUT).sort(), ['connections', 'name', 'nodes', 'settings'], 'wrong field set');
  assert(!Object.prototype.hasOwnProperty.call(CUT, 'id'), 'an id would be ignored, but must not be present');
  assert(!Object.prototype.hasOwnProperty.call(CUT, 'active'),
    'active must be absent -- the live lifecycle is preserved by construction, not by care');
});

check('settings are identical to production, MCP exposure still off', () => {
  deepEq(CUT.settings, PROD.settings, 'settings drifted');
  eq(CUT.settings.availableInMCP, false, 'availableInMCP');
  eq(CUT.settings.errorWorkflow, 'RBiFLhVjizMkAzrK', 'error workflow binding');
});

check('every production node survives; none is removed', () => {
  PROD.nodes.forEach((n) => assert(byName(CUT, n.name), 'production node lost: ' + n.name));
  eq(CUT.nodes.length, PROD.nodes.length + M.MODEL_B_ADDED.length, 'node count is not production + the declared additions');
});

check('only the five declared inherited nodes changed', () => {
  const EXEC = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled', 'onError'];
  const declared = Object.keys(M.MODEL_B_MODIFIED);
  const drifted = PROD_SAN.nodes.filter((p) => {
    const c = byName(CUT, p.name);
    return c && EXEC.some((k) => JSON.stringify(p[k]) !== JSON.stringify(c[k]));
  }).map((n) => n.name).sort();
  deepEq(drifted, declared.slice().sort(), 'the changed set is not the declared five: ' + drifted.join(', '));
});

check('the executable fingerprint is stable and excludes cosmetic fields', () => {
  const a = M.executableFingerprint(CUT);
  const moved = clone(CUT);
  moved.nodes[0].position = [12345, 6789];
  moved.nodes[0].notes = 'cosmetic';
  eq(M.executableFingerprint(moved), a, 'position/notes changed the executable fingerprint');
  const changed = clone(CUT);
  byName(changed, 'Issuance Gate').parameters.jsCode += ' ';
  assert(M.executableFingerprint(changed) !== a, 'a Code body change did NOT change the fingerprint');
});

console.log('\n-- the classifier rejects every dangerous cutover --');

function mustReject(label, mutate, expectWhat) {
  check('REJECTS: ' + label, () => {
    const m = clone(CUT);
    mutate(m);
    const v = M.classifyCutover(PROD_SAN, m);
    assert(!v.ok, 'the classifier ACCEPTED: ' + label);
    if (expectWhat) {
      assert(v.findings.some((f) => f.kind === 'UNEXPECTED' && f.what.includes(expectWhat)),
        'rejected, but not for the expected reason (' + expectWhat + '): '
        + v.findings.filter((f) => f.kind === 'UNEXPECTED').map((f) => f.what).join('; '));
    }
  });
}

mustReject('the Telegram trigger disabled', (m) => { byName(m, M.TRIGGER_NODE_NAME).disabled = true; },
  'not byte-identical to production');
mustReject('the trigger webhookId changed', (m) => { byName(m, M.TRIGGER_NODE_NAME).webhookId = 'deadbeef'; },
  'trigger webhookId changed');
mustReject('the bot credential swapped', (m) => {
  byName(m, M.TRIGGER_NODE_NAME).credentials.telegramApi.id = 'SOMETHINGELSE';
}, 'trigger credential changed');
mustReject('a second trigger added', (m) => {
  m.nodes.push({ name: 'Extra', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3, position: [0, 0], parameters: {} });
}, 'triggers, production has 1');
mustReject('the workflow renamed', (m) => { m.name = 'Something Else'; }, 'workflow name changed');
mustReject('a production node removed', (m) => {
  m.nodes = m.nodes.filter((n) => n.name !== 'Answer Callback Query');
}, 'node REMOVED');
mustReject('an undeclared production node modified', (m) => {
  byName(m, 'Build Bot Response').parameters.jsCode += ' ';
}, 'node modified: Build Bot Response');
mustReject('a declared node given a different credential', (m) => {
  byName(m, 'Build Session Row').credentials = { googleSheetsOAuth2Api: { id: 'X', name: 'Y' } };
}, 'non-parameter executable field');
mustReject('an undeclared node added', (m) => {
  m.nodes.push({ name: 'Smuggled', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: '' } });
}, 'node added: Smuggled');
mustReject('an undeclared edge rewired', (m) => {
  m.connections['Parse Telegram Update'] = { main: [[{ node: 'Save Bot Event', type: 'main', index: 0 }]] };
}, 'edges from: Parse Telegram Update');
mustReject('settings changed', (m) => { m.settings.availableInMCP = true; }, 'settings changed');
mustReject('the error workflow binding dropped', (m) => { delete m.settings.errorWorkflow; }, 'settings changed');
mustReject('an `active` field smuggled into the body', (m) => { m.active = false; }, 'fields the update schema rejects');

check('CONTROL: the unmutated artifact classifies clean', () => {
  const v = M.classifyCutover(PROD_SAN, clone(CUT));
  assert(v.ok, 'the classifier rejects the real artifact');
});

// ================================================================ 2. §10 the write-key guard

console.log('\n-- §10 Bot_Sessions write keys: autoMapInputData cannot be trusted --');

check('the cutover artifact passes the write guard', () => {
  const v = S.evaluateBotSessionsWrites(CUT, { label: 'cutover' });
  assert(v.ok, v.failures.join(' | '));
  assert(v.writerCount >= 3, 'expected at least three Bot_Sessions writers, found ' + v.writerCount);
});

check('the production export passes the write guard', () => {
  const v = S.evaluateBotSessionsWrites(PROD, { label: 'production' });
  assert(v.ok, v.failures.join(' | '));
});

check('all three declared row builders carry a clean COLS whitelist', () => {
  S.DECLARED_ROW_BUILDERS.forEach((n) => {
    const node = byName(CUT, n);
    assert(node, 'missing row builder ' + n);
    const cols = S.declaredCols(node);
    assert(cols && cols.length > 30, 'no usable COLS on ' + n);
    assert(!cols.some((c) => c.indexOf('__') === 0), n + ' lists a __ key in COLS');
    assert(cols.indexOf('submission_key') !== -1, n + ' no longer writes submission_key');
  });
});

check('the known dead trailing columns are recorded, all NINE of them', () => {
  // Six from P7.1b, three this project added at P7.4. Recorded so the count cannot grow again
  // without someone editing the list on purpose.
  eq(S.KNOWN_DEAD_TRAILING.length, 9, 'the dead-column record changed size');
  ['__do_write', '__mode', '__before'].forEach((c) => {
    assert(S.KNOWN_DEAD_TRAILING.indexOf(c) !== -1, 'the P7.4-caused column ' + c + ' is not recorded');
  });
  deepEq(S.INTENDED_TAIL, ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'], 'intended tail changed');
});

check('THE P7.4 DEFECT: an undeclared feeder into a Bot_Sessions writer is REJECTED', () => {
  // Reconstructed in the shape the P7.4 state tool actually had: a Code node that is not a
  // declared row builder feeding a node with Save Bot Session's autoMapInputData parameters.
  const save = byName(CUT, 'Save Bot Session');
  const wf = {
    nodes: [
      { name: 'Tool Plan', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return [{ json: { __do_write: true } }];' } },
      { name: 'Tool Write Row', type: S.SHEETS_TYPE, typeVersion: 4.7, parameters: clone(save.parameters), credentials: clone(save.credentials) }
    ],
    connections: { 'Tool Plan': { main: [[{ node: 'Tool Write Row', type: 'main', index: 0 }]] } }
  };
  const v = S.evaluateBotSessionsWrites(wf, { label: 'p74-state-tool' });
  assert(!v.ok, 'the guard ACCEPTED the exact shape that widened the live sheet');
  assert(v.failures.some((f) => /not a declared row builder/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('a Bot_Sessions writer with NO feeder is rejected', () => {
  const save = byName(CUT, 'Save Bot Session');
  const wf = {
    nodes: [{ name: 'Orphan Write', type: S.SHEETS_TYPE, typeVersion: 4.7, parameters: clone(save.parameters) }],
    connections: {}
  };
  const v = S.evaluateBotSessionsWrites(wf, { label: 'orphan' });
  assert(!v.ok, 'a writer whose input cannot be reviewed was accepted');
});

check('a row builder that lists a __ key in COLS is rejected', () => {
  const m = clone(CUT);
  const n = byName(m, 'Build Session Row');
  n.parameters.jsCode = n.parameters.jsCode.replace(/COLS\s*=\s*\[/, "COLS = ['__do_write',");
  const v = S.evaluateBotSessionsWrites(m, { label: 'mutated' });
  assert(!v.ok, 'a __ key inside COLS was accepted');
  assert(v.failures.some((f) => /__-prefixed key/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('a row builder that lost its COLS whitelist is rejected', () => {
  const m = clone(CUT);
  const n = byName(m, 'Build Intake State Row');
  n.parameters.jsCode = 'return [{ json: $input.first().json }];';
  const v = S.evaluateBotSessionsWrites(m, { label: 'mutated' });
  assert(!v.ok, 'a builder with no whitelist was accepted');
  assert(v.failures.some((f) => /no COLS whitelist/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('§10 RUNTIME: an injected __debug key cannot reach the writer', () => {
  // Static scanning is not enough, and §10 says so. This EXECUTES the deployed Build Session Row
  // body with `__debug` planted on the session object and requires the emitted row to be a
  // projection over the declared columns — not the session with extra keys along for the ride.
  //
  // The body already works this way (`for (const c of COLS) row[c] = ...`), which is why the
  // production writers have never widened the sheet. What widened it was P7.4's state tool,
  // whose feeder had no COLS at all — the case the structural guard above rejects.
  const node = byName(CUT, 'Build Session Row');
  const session = {
    session_id: 'S-1', chat_id: '900000999', consent: 'yes', state: 'MENU', status: 'active',
    __debug: 'SHOULD-NOT-REACH-THE-SHEET', __do_write: true, key: 'stray', p71_absent_column: 'x'
  };
  const named = {
    'Build Bot Response': { session: session, lead_ready: false },
    'Get Bot Session': { cycle_id: 'C-900000999-1', submission_key: 'sub_' + 'a'.repeat(32), consent: 'yes', consent_cycle_id: 'C-900000999-1' },
    'Issuance Verdict': { __advance: true, __verified_submission_key: 'sub_' + 'a'.repeat(32) }
  };
  const $ = (n) => ({ first: () => ({ json: named[n] || {} }), all: () => [{ json: named[n] || {} }] });
  const fn = new Function('$', '$input', '$now', node.parameters.jsCode);
  const out = fn($, { first: () => ({ json: {} }), all: () => [] }, new Date());
  const row = out[0].json;

  const stray = Object.keys(row).filter((k) => k.indexOf('__') === 0
    || ['key', 'p71_absent_column'].indexOf(k) !== -1);
  eq(stray.length, 0, 'stray key(s) reached the writer input: ' + stray.join(', '));
  assert(JSON.stringify(row).indexOf('SHOULD-NOT-REACH-THE-SHEET') === -1, 'the injected value reached the row');

  const cols = S.declaredCols(node);
  deepEq(Object.keys(row).sort(), cols.slice().sort(),
    'the emitted row is not exactly the declared column set');
});

check('a row builder that would write a known-dead column is rejected', () => {
  const m = clone(CUT);
  const n = byName(m, 'Build Confirmation State Row');
  n.parameters.jsCode = n.parameters.jsCode.replace(/COLS\s*=\s*\[/, "COLS = ['p71_absent_column',");
  const v = S.evaluateBotSessionsWrites(m, { label: 'mutated' });
  assert(!v.ok, 'a known-dead column write was accepted');
});

// ================================================================ 3. §9 schema footprint

console.log('\n-- §9 schema footprint: an empty column is residue --');

// The nine dead columns as measured live on 2026-08-27, in physical order.
const LIVE_TAIL = ['submission_key','lead_mode','lead_priority','financial_zone','key','__rows_seen','__advance','__reason','__verified_submission_key','p71_absent_column','__do_write','__mode','__before'];
const HEAD = ['session_id','chat_id','state'];
const echo = (cols) => { const o = {}; cols.forEach((c) => { o[c] = c; }); o.row_number = 1; return o; };

check('a footprint is built from the header row AS DATA', () => {
  const fp = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  eq(fp.count, HEAD.length + LIVE_TAIL.length, 'wrong column count');
  assert(fp.headers.indexOf('row_number') === -1, 'row_number is a sheet coordinate, not a column');
  assert(/^[0-9a-f]{64}$/.test(fp.sha256), 'no fingerprint');
});

check('inferring a schema from ROW OBJECTS is refused outright', () => {
  // The shortcut that made P7.5 report six present columns as absent.
  let threw = false;
  try { F.footprintFromRows([{ chat_id: 1 }]); } catch (e) { threw = /invisible/.test(e.message); }
  assert(threw, 'row-object inference was allowed');
});

check('CONTROL: an unchanged footprint passes', () => {
  const a = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  const b = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  assert(F.compareFootprint(a, b).ok, 'an identical footprint was rejected');
});

check('THE P7.4 CASE: instrumentation appending an EMPTY __debug column FAILS cleanup', () => {
  // Every customer row is blank in that column, which is exactly why a row-based check misses
  // it and exactly why this one does not.
  const before = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  const after = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL).concat(['__debug'])));
  const v = F.compareFootprint(before, after);
  assert(!v.ok, 'an appended empty column passed cleanup');
  eq(v.added.join(','), '__debug', 'wrong added set');
  assert(v.failures.some((f) => /SCHEMA RESIDUE/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('the three columns P7.4 actually left behind would have failed this guard', () => {
  const before = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL.slice(0, 10))));
  const after = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  const v = F.compareFootprint(before, after);
  assert(!v.ok, 'the real P7.4 residue passed');
  deepEq(v.added.sort(), ['__before','__do_write','__mode'], 'wrong added set: ' + v.added.join(','));
});

check('a column DISAPPEARING is also a failure unless authorised', () => {
  const before = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  const after = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL.slice(0, 4))));
  const v = F.compareFootprint(before, after);
  assert(!v.ok, 'nine columns vanished silently');
  assert(v.failures.some((f) => /SCHEMA LOSS/.test(f)), 'wrong reason');
});

check('an AUTHORISED schema mutation passes -- which is how F17 will close', () => {
  // The F17 sweep will remove AZ:BH deliberately. Authorised removals are permitted, so the
  // guard does not become a reason never to clean the sheet.
  const before = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL)));
  const after = F.footprintFromHeaderEcho(echo(HEAD.concat(LIVE_TAIL.slice(0, 4))));
  const v = F.compareFootprint(before, after, { authorisedRemovals: LIVE_TAIL.slice(4) });
  assert(v.ok, 'an authorised removal was rejected: ' + v.failures.join(' | '));
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
