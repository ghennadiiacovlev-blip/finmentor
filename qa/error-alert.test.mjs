#!/usr/bin/env node
// FINMENTOR — Error Monitor alert regression gate (INDP2-04).
//
// Runs the real Code-node source deployed in the Error Monitor against realistically-shaped
// n8n Error Trigger payloads. Assertion-based, non-zero exit, paths resolved from this file.
//
// The alert is a notification channel, not a data export. The failing item's payload must
// never appear in it, while the operational identifiers needed to act on the failure must.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'n8n', 'src', 'error-monitor', 'build-error-alert.js');
const code = readFileSync(SRC, 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

function build(trigger, settings = { owner_chat_id: '100000001' }) {
  const named = {
    'Error Monitor Trigger': { first: () => ({ json: trigger }) },
    'Settings to Object': { first: () => ({ json: { settings } }) }
  };
  const out = new Function('$', code)((n) => named[n]);
  return out[0].json ? out[0].json : out[0];
}

// Shaped exactly as observed live: n8n splits a thrown message at the first ": ", putting
// the head in error.description and the tail in error.message.
const SPLIT_ERROR = {
  workflow: { id: 'WF123', name: 'FINMENTOR Lead Intake PREMIUM FINAL' },
  execution: {
    id: '3394',
    lastNodeExecuted: 'Save to Pipeline',
    error: {
      name: '',
      lineNumber: 3,
      description: 'Lead FIN-1 failed. Contact ion.popescu@example.com or +373 60 123 456. Sheet https',
      message: '//docs.google.com/spreadsheets/d/ABC123/edit [line 3]',
      stack: 'Error: secret stack with ion.popescu@example.com'
    }
  }
};

console.log('\nFINMENTOR error alert\n');
console.log('NO PAYLOAD OR CONTACT DATA IN THE ALERT');

const split = build(SPLIT_ERROR);

check('email from error.description is scrubbed', () => {
  assert(!split.alert_text.includes('ion.popescu@example.com'), 'email present: ' + split.alert_text);
});
check('phone from error.description is scrubbed', () => {
  assert(!split.alert_text.includes('373 60 123 456'), 'phone present');
});
check('a decapitated scheme-less url is scrubbed', () => {
  assert(!split.alert_text.includes('docs.google.com'), 'url present: ' + split.alert_text);
});
check('the stack trace is never included', () => {
  assert(!split.alert_text.includes('secret stack'), 'stack leaked into the alert');
});
check('scrub markers are present', () => {
  assert(/\[contact removed\]/.test(split.alert_text), 'no contact marker');
  assert(/\[link removed\]/.test(split.alert_text), 'no link marker');
});
check('the alert states that payload is excluded', () => {
  assert(split.alert_text.includes('Payload'), 'no payload disclaimer');
});

console.log('\nOPERATIONAL IDENTIFIERS SURVIVE');

check('description and message are recombined, not truncated to one half', () => {
  // Reading only error.message would produce a meaningless url fragment.
  assert(/Lead FIN-1 failed/.test(split.error_message), 'description half lost: ' + split.error_message);
});
check('workflow id and name are reported', () => {
  assert(split.workflow_id === 'WF123', 'workflow id lost');
  assert(split.workflow_name === 'FINMENTOR Lead Intake PREMIUM FINAL', 'workflow name lost or scrubbed');
});
check('failing node is reported', () => {
  assert(split.node_name === 'Save to Pipeline', 'node name lost: ' + split.node_name);
});
check('correlation id and timestamp are present', () => {
  assert(split.correlation_id === '3394', 'correlation id lost');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(split.ts), 'timestamp missing');
});
check('owner chat id is taken from Settings', () => {
  assert(split.owner_chat_id === '100000001', 'owner chat id not sourced from Settings');
});
check('an internal identifier in the workflow name is NOT scrubbed', () => {
  // Build stamps and ids are configuration, not personal data. Removing them made alerts
  // impossible to act on.
  const r = build({
    workflow: { id: 'W1', name: 'ZZ QA Digest proof 20260825-204224' },
    execution: { id: '1', lastNodeExecuted: 'X', error: { message: 'boom' } }
  });
  assert(r.workflow_name.includes('20260825-204224'), 'internal stamp was scrubbed: ' + r.workflow_name);
});

console.log('\nERROR CLASSIFICATION');

const cases = [
  ['SHEET_LOCATOR', 'Sheet with ID Activities not found'],
  ['RATE_LIMIT', 'Quota exceeded, rate limit 429'],
  ['UPSTREAM_TRANSIENT', 'Service unavailable - try again later'],
  ['AUTH', 'Request failed with 401 unauthorized'],
  ['DATA_SHAPE', 'Unexpected token < in JSON at position 0']
];
for (const [expected, message] of cases) {
  check(`classifies "${message.slice(0, 34)}..." as ${expected}`, () => {
    const r = build({ workflow: { id: 'W', name: 'W' }, execution: { id: '1', lastNodeExecuted: 'N', error: { message } } });
    assert(r.error_class === expected, 'got ' + r.error_class);
  });
}

check('the real Digest failure classifies as SHEET_LOCATOR', () => {
  const r = build({
    workflow: { id: 'imeJIDeNyaWDyXzh', name: 'FINMENTOR Daily Lead Digest PREMIUM FINAL' },
    execution: { id: '3264', lastNodeExecuted: 'Save Activity', error: { name: 'NodeOperationError', message: 'Sheet with ID Activities not found' } }
  });
  assert(r.error_class === 'SHEET_LOCATOR', 'got ' + r.error_class);
  assert(r.node_name === 'Save Activity', 'node lost');
});

console.log('\nROBUSTNESS');

check('a payload with no error object does not throw', () => {
  const r = build({ workflow: { id: 'W', name: 'N' }, execution: { id: '9' } });
  assert(r.alert_text.includes('no message'), 'missing fallback text');
});
check('an entirely empty trigger payload does not throw', () => {
  const r = build({});
  assert(typeof r.alert_text === 'string' && r.alert_text.length > 0, 'no alert text produced');
});
check('missing Settings does not throw and yields an empty chat id', () => {
  const named = { 'Error Monitor Trigger': { first: () => ({ json: {} }) } };
  const out = new Function('$', code)((n) => named[n] || { first: () => { throw new Error('absent'); } });
  const r = out[0].json ? out[0].json : out[0];
  assert(r.owner_chat_id === '', 'expected empty owner chat id');
});
check('scrubbing is not stateful across repeated calls', () => {
  for (let i = 0; i < 5; i++) {
    const r = build(SPLIT_ERROR);
    assert(!r.alert_text.includes('ion.popescu@example.com'), 'email leaked on call ' + i);
    assert(!r.alert_text.includes('docs.google.com'), 'url leaked on call ' + i);
  }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('\nERROR ALERT GATE: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('ERROR ALERT GATE: PASS');
