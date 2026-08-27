#!/usr/bin/env node
// FINMENTOR — P7.4 §8 + §9: the deployment guards' own gate.
//
//   node qa/deploy-guard.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. Two hazards were found by running things, written down in prose, and
// carried in session memory. Prose does not fail a build and memory does not survive a
// contributor. This gate is both of them expressed as checks.
//
//   §8  The creation surface auto-assigned a LIVE Telegram bot credential to a node that never
//       asked for one (P7.3, `create_workflow_from_code` -> "FINMENTOR Leads Bot FINAL"). Every
//       safety property proven about a FILE is a property of the file; this one was added
//       afterwards, by the thing that created the workflow.
//
//   §9  A Concierge canary's telegramTrigger carries the production bot credential. Telegram
//       allows one webhook per bot token and a second registration silently replaces the first.
//
// Both guards default to REFUSAL, and both are checked here against the real tracked artifacts
// as well as against synthetic mutations -- so they cannot pass by being unreachable.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const G = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'auto-credential-guard.js'));
const T = require(join(ROOT, 'n8n', 'src', 'deploy-guard', 'trigger-safety.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const load = (p) => JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', p), 'utf8'));
const WRAPPER = load('concierge-issuer-IMPORT-SAFE.json');
const API_IMPORT = load('concierge-issuer-API-IMPORT.json');
const HARNESS = load('concierge-issuer-HARNESS.json');
const DRIFT = load('concierge-issuer-HARNESS-DRIFT.json');
const clone = (v) => JSON.parse(JSON.stringify(v));

// ================================================================ 1. §8 the auto-credential guard

console.log('\n-- §8 auto-assigned credentials: default is refusal --');

check('an empty autoAssignedCredentials array PASSES', () => {
  const v = G.evaluateCreateResponse({ workflowId: 'x', autoAssignedCredentials: [] }, G.HARNESS_ALLOWLIST);
  assert(v.ok, 'a clean create was refused: ' + v.message);
  eq(v.verdict, G.VERDICT_OK, 'wrong verdict');
});

check('a response with no autoAssignedCredentials field at all PASSES', () => {
  // Surfaces that do not auto-assign simply omit the key. Treating that as a refusal would make
  // the guard unusable on the REST path, which is where most of this project deploys.
  const v = G.evaluateCreateResponse({ workflowId: 'x' }, G.HARNESS_ALLOWLIST);
  assert(v.ok, 'a response without the field was refused');
  eq(v.verdict, G.VERDICT_OK, 'wrong verdict');
});

check('THE OBSERVED CASE: an unexpected telegramApi assignment FAILS', () => {
  // Verbatim shape of what P7.3 actually received.
  const v = G.evaluateCreateResponse({
    workflowId: 'DM4ZsMxiCqz65IIG',
    autoAssignedCredentials: [{
      nodeName: 'TG Entry', credentialName: 'FINMENTOR Leads Bot FINAL',
      credentialType: 'telegramApi', source: 'user'
    }]
  }, G.HARNESS_ALLOWLIST);
  assert(!v.ok, 'the guard ACCEPTED an auto-assigned live Telegram bot credential');
  eq(v.verdict, G.VERDICT_REFUSED, 'wrong verdict');
  eq(v.refused.length, 1, 'wrong refused count');
  assert(/DO NOT ACTIVATE/.test(v.message), 'the message does not tell the operator what to do');
  assert(/telegramApi/.test(v.message), 'the message does not name the credential type');
});

check('an unexpected Google Sheets assignment FAILS', () => {
  const v = G.evaluateCreateResponse({
    autoAssignedCredentials: [{
      nodeName: 'Read Settings', credentialName: 'Google Sheets OAuth2 API',
      credentialType: 'googleSheetsOAuth2Api'
    }]
  }, G.HARNESS_ALLOWLIST);
  assert(!v.ok, 'the guard ACCEPTED an auto-assigned Sheets credential');
  eq(v.verdict, G.VERDICT_REFUSED, 'wrong verdict');
});

check('an ARBITRARY UNKNOWN credential type FAILS', () => {
  // The policy is ANY credential, not a Telegram blocklist. A guard that only knew about the
  // hazard it was born from would have to be extended by whoever got surprised next.
  const v = G.evaluateCreateResponse({
    autoAssignedCredentials: [{ nodeName: 'X', credentialName: 'Something', credentialType: 'someFutureApi' }]
  }, G.HARNESS_ALLOWLIST);
  assert(!v.ok, 'the guard ACCEPTED an unknown credential type');
});

check('the harness allowlist is EMPTY, and that is the point', () => {
  eq(G.HARNESS_ALLOWLIST.length, 0, 'the canary/harness allowlist is no longer empty');
});

check('an EXACT allowlist entry permits exactly that assignment and nothing else', () => {
  const rule = [{ credentialType: 'googleSheetsOAuth2Api', nodeName: 'Read Settings' }];
  const ok = G.evaluateCreateResponse({
    autoAssignedCredentials: [{ nodeName: 'Read Settings', credentialType: 'googleSheetsOAuth2Api', credentialName: 'n' }]
  }, rule);
  assert(ok.ok, 'an allowlisted assignment was refused');
  eq(ok.verdict, G.VERDICT_ALLOWED, 'wrong verdict');

  const wrongNode = G.evaluateCreateResponse({
    autoAssignedCredentials: [{ nodeName: 'Save Bot Session', credentialType: 'googleSheetsOAuth2Api', credentialName: 'n' }]
  }, rule);
  assert(!wrongNode.ok, 'the allowlist matched a DIFFERENT node');
});

check('an EMPTY allowlist rule {} cannot be used to permit everything', () => {
  const v = G.evaluateCreateResponse({
    autoAssignedCredentials: [{ nodeName: 'X', credentialType: 'telegramApi', credentialName: 'bot' }]
  }, [{}]);
  assert(!v.ok, 'a {} rule matched everything -- that is a wildcard by accident');
});

check('a MALFORMED autoAssignedCredentials field FAILS rather than being read as empty', () => {
  // "We could not look" and "nothing was assigned" must never collapse into one outcome.
  ['not-an-array', 42, { a: 1 }].forEach((bad) => {
    const v = G.evaluateCreateResponse({ autoAssignedCredentials: bad }, G.HARNESS_ALLOWLIST);
    assert(!v.ok, 'a malformed field of type ' + typeof bad + ' was read as safe');
  });
});

check('a malformed ENTRY inside the array is refused, not skipped', () => {
  const v = G.evaluateCreateResponse({ autoAssignedCredentials: [null, 'x'] }, G.HARNESS_ALLOWLIST);
  assert(!v.ok, 'malformed entries were skipped');
  eq(v.refused.length, 2, 'both malformed entries should be refused');
});

check('the guard never returns credential contents', () => {
  const v = G.evaluateCreateResponse({
    autoAssignedCredentials: [{
      nodeName: 'X', credentialType: 'telegramApi', credentialName: 'bot',
      credentialId: 'abc', token: 'SECRET-SHOULD-NOT-APPEAR', data: { apiKey: 'ALSO-SECRET' }
    }]
  }, G.HARNESS_ALLOWLIST);
  const blob = JSON.stringify(v);
  assert(!/SECRET-SHOULD-NOT-APPEAR/.test(blob), 'a token leaked into the verdict');
  assert(!/ALSO-SECRET/.test(blob), 'credential data leaked into the verdict');
  assert(/abc/.test(blob), 'the credential id should be kept -- it is an identifier, not a secret');
});

// ================================================================ 2. §9 the trigger safety contract

console.log('\n-- §9 the Telegram trigger contract, against the real artifacts --');

check('the tracked IMPORT-SAFE wrapper satisfies the canary contract', () => {
  const v = T.evaluateTriggerSafety(WRAPPER, { role: T.ROLE_CANARY });
  assert(v.ok, 'the wrapper fails its own contract: ' + v.failures.join(' | '));
});

check('the tracked API-IMPORT projection satisfies the canary contract', () => {
  // The projection has no `active` field at all -- the endpoint rejects it -- so the contract
  // is evaluated with active supplied explicitly, exactly as the post-deploy readback must.
  const v = T.evaluateTriggerSafety(API_IMPORT, { role: T.ROLE_CANARY, active: false });
  assert(v.ok, 'the projection fails the contract: ' + v.failures.join(' | '));
});

check('the API-IMPORT projection FAILS the contract if the server made it active', () => {
  // This is POST_DEPLOY_ASSERTIONS expressed as the contract: the projection cannot carry
  // `active: false`, so an unexpectedly-active create must be caught by reading it back.
  const v = T.evaluateTriggerSafety(API_IMPORT, { role: T.ROLE_CANARY, active: true });
  assert(!v.ok, 'an ACTIVE canary carrying the production bot credential was accepted');
  assert(v.failures.some((f) => /active=true/.test(f)), 'wrong reason: ' + v.failures.join(' | '));
});

check('both tracked harnesses satisfy the harness contract', () => {
  [['base', HARNESS], ['drift', DRIFT]].forEach(([label, wf]) => {
    const v = T.evaluateTriggerSafety(wf, { role: T.ROLE_HARNESS });
    assert(v.ok, 'the ' + label + ' harness fails the contract: ' + v.failures.join(' | '));
  });
});

check('the harness substitute is present and is the permitted shape', () => {
  const sub = HARNESS.nodes.find((n) => n.name === T.SUBSTITUTE_NODE_NAME);
  assert(sub, 'the substitute is absent');
  eq(sub.type, T.CODE_TYPE, 'the substitute is not a Code node');
  assert(!sub.credentials, 'the substitute carries credentials');
});

console.log('\n-- §9 mutations: the contract rejects every unsafe shape --');

function mustReject(label, wf, opts, expectSubstring) {
  check('REJECTS: ' + label, () => {
    const v = T.evaluateTriggerSafety(wf, opts);
    assert(!v.ok, 'the contract ACCEPTED: ' + label);
    if (expectSubstring) {
      assert(v.failures.some((f) => f.includes(expectSubstring)),
        'rejected, but not for the expected reason (' + expectSubstring + '): ' + v.failures.join(' | '));
    }
  });
}

mustReject('CANARY: the production-credentialed trigger is ENABLED', (() => {
  const m = clone(WRAPPER);
  delete m.nodes.find((n) => n.type === T.TELEGRAM_TRIGGER_TYPE).disabled;
  return m;
})(), { role: T.ROLE_CANARY }, 'is NOT disabled -- deployment refused');

mustReject('CANARY: disabled trigger but the workflow is active', (() => {
  const m = clone(WRAPPER);
  m.active = true;
  return m;
})(), { role: T.ROLE_CANARY }, 'must be exactly false');

mustReject('CANARY: the inherited webhookId restored on the trigger', (() => {
  const m = clone(WRAPPER);
  m.nodes.find((n) => n.type === T.TELEGRAM_TRIGGER_TYPE).webhookId = 'fa4cd08a-6959-4db5-890d-03755a0aa42d';
  return m;
})(), { role: T.ROLE_CANARY }, 'inherited webhookId');

mustReject('CANARY: a second, enabled entry point added alongside the disabled trigger', (() => {
  const m = clone(WRAPPER);
  m.nodes.push({ name: 'Back Door', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.3, position: [0, 0], parameters: {} });
  return m;
})(), { role: T.ROLE_CANARY }, 'ENABLED trigger node');

mustReject('HARNESS: the entry type changed from Code to telegramTrigger', (() => {
  // The mutation §9 names explicitly.
  const m = clone(HARNESS);
  m.nodes.find((n) => n.name === T.SUBSTITUTE_NODE_NAME).type = T.TELEGRAM_TRIGGER_TYPE;
  return m;
})(), { role: T.ROLE_HARNESS }, 'ZERO telegramTrigger nodes');

mustReject('HARNESS: the substitute given a Telegram credential while staying a Code node', (() => {
  const m = clone(HARNESS);
  m.nodes.find((n) => n.name === T.SUBSTITUTE_NODE_NAME).credentials = { telegramApi: { id: T.PRODUCTION_BOT_CREDENTIAL_ID, name: 'bot' } };
  return m;
})(), { role: T.ROLE_HARNESS }, 'carries a Telegram credential');

mustReject('HARNESS: any other node given a Telegram credential', (() => {
  const m = clone(HARNESS);
  m.nodes.find((n) => n.name === 'Read Settings').credentials.telegramApi = { id: 'X', name: 'Y' };
  return m;
})(), { role: T.ROLE_HARNESS }, 'carries a Telegram credential');

mustReject('HARNESS: a telegramTrigger added under some other name', (() => {
  const m = clone(HARNESS);
  m.nodes.push({ name: 'Innocuous', type: T.TELEGRAM_TRIGGER_TYPE, typeVersion: 1.2, position: [0, 0], parameters: {}, disabled: true });
  return m;
})(), { role: T.ROLE_HARNESS }, 'ZERO telegramTrigger nodes');

mustReject('an unknown role is refused rather than defaulting to something permissive', HARNESS, { role: 'whatever' }, 'unknown role');

check('CONTROL: a canary whose trigger carries a DIFFERENT credential is not force-failed', () => {
  // The contract is about the production bot. A trigger bound to something else is noted, not
  // refused -- otherwise the check would be a blanket ban dressed up as a hazard analysis.
  const m = clone(WRAPPER);
  m.nodes.find((n) => n.type === T.TELEGRAM_TRIGGER_TYPE).credentials.telegramApi.id = 'SOMEOTHERCRED';
  const v = T.evaluateTriggerSafety(m, { role: T.ROLE_CANARY });
  assert(v.ok, 'a non-production credential was refused: ' + v.failures.join(' | '));
  assert(v.notes.some((n) => /does not carry the production bot credential/.test(n)), 'no note recorded');
});

// ================================================================ 3. the guards are wired in

console.log('\n-- the guards are reachable, not ornamental --');

check('the auto-credential CLI exists and refuses by default', () => {
  const cli = readFileSync(join(ROOT, 'scripts', 'check-auto-credentials.mjs'), 'utf8');
  assert(/HARNESS_ALLOWLIST/.test(cli), 'the CLI does not use the empty harness allowlist');
  assert(/process\.exit\(v\.ok \? 0 : 1\)/.test(cli), 'the CLI exit code is not the verdict');
  // Comments are stripped first. The CLI's header explains WHY there is no --allow flag, and a
  // naive search would fire on the explanation -- which is the check misreading documentation
  // as the thing it documents.
  const code = cli.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert(!/--allow/.test(code), 'the CLI grew a flag for permitting assignments from the command line');
  assert(!/argv\[3\]/.test(code), 'the CLI takes a second argument; the allowlist must not be caller-supplied');
});

check('the CLI refuses an unparseable response rather than skipping it', () => {
  const cli = readFileSync(join(ROOT, 'scripts', 'check-auto-credentials.mjs'), 'utf8');
  assert(/not parseable JSON/.test(cli), 'unparseable input is not explicitly refused');
});

// ================================================================ summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
