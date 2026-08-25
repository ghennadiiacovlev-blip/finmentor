#!/usr/bin/env node
// FINMENTOR — Command Center authorisation regression gate.
//
// Executes the REAL n8n Code-node sources from n8n/src/command-center/ against the
// negative matrix required by the P0 remediation. Assertion-based: any failure exits
// non-zero. Paths resolve from this file, never from cwd.
//
// A "denied" outcome means the node returned zero items. In n8n that halts the branch,
// so denial provably means zero Pipeline reads, zero CRM writes and zero Telegram output.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'n8n', 'src', 'command-center');

// Synthetic QA identities only. The allowlist is injected by each test and is never
// read from production Settings, so no real owner identifier appears in this repository.
const OWNER = '100000001';
const ATTACKER = '999000111';

function loadNode(file) {
  const code = readFileSync(join(SRC, file), 'utf8');
  return (ctx) => new Function('$input', '$', code)(ctx.$input, ctx.$);
}

const verifyIdentity = loadNode('verify-telegram-identity.js');
const parseCommand = loadNode('parse-lead-command.js');
const settingsToObject = loadNode('settings-to-object.js');

const inputOf = (json) => ({ first: () => ({ json }), all: () => [{ json }] });
const inputOfAll = (arr) => ({ first: () => ({ json: arr[0] }), all: () => arr.map((json) => ({ json })) });

// Full path: raw Telegram update -> identity gate -> Settings -> authorisation/parser.
function runPipeline(update, settingsRows = [{ key: 'allowed_chat_ids', value: OWNER }]) {
  const gate = verifyIdentity({ $input: inputOf(update), $: () => {} });
  if (gate.length === 0) return { denied: true, stage: 'identity-gate', items: [] };

  const cfg = settingsToObject({ $input: inputOfAll(settingsRows), $: () => {} })[0].json;

  const named = {
    'Verify Telegram Identity': { first: () => ({ json: gate[0].json }) },
    'Settings to Object': { first: () => ({ json: cfg }) }
  };
  const items = parseCommand({ $input: inputOf(gate[0].json), $: (n) => named[n] });
  if (items.length === 0) return { denied: true, stage: 'authorisation', items: [] };
  // The node emits bare objects, exactly as the original did; n8n wraps them into { json }.
  // Normalise both shapes so the assertions describe the contract, not the wrapper.
  return { denied: false, stage: 'accepted', items: items.map((i) => ({ json: i && i.json ? i.json : i })) };
}

const privateMsg = (id, text) => ({
  update_id: 1,
  message: { message_id: 1, text, from: { id, is_bot: false }, chat: { id, type: 'private' } }
});

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
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertDenied = (r, msg) => assert(r.denied === true, msg + ' (got stage=' + r.stage + ')');

console.log('\nFINMENTOR Command Center — authorisation gate\n');
console.log('NEGATIVE MATRIX (every case must perform zero CRM access)');

check('wrong sender (not in allowlist)', () => {
  assertDenied(runPipeline(privateMsg(Number(ATTACKER), '/pipeline')), 'attacker was allowed');
});

check('from/chat mismatch — the P0 confused-deputy split', () => {
  assertDenied(runPipeline({
    update_id: 2,
    message: {
      message_id: 1, text: '/lead FIN-1',
      from: { id: Number(OWNER), is_bot: false },      // authorised sender
      chat: { id: Number(ATTACKER), type: 'private' }  // attacker-controlled destination
    }
  }), 'from/chat split was allowed');
});

check('callback from/chat mismatch', () => {
  assertDenied(runPipeline({
    update_id: 3,
    callback_query: {
      id: 'cb1', data: 'won|FIN-1|5000',
      from: { id: Number(OWNER), is_bot: false },
      message: { message_id: 5, chat: { id: Number(ATTACKER), type: 'private' } }
    }
  }), 'callback split was allowed');
});

check('group chat with authorised sender', () => {
  assertDenied(runPipeline({
    update_id: 4,
    message: {
      message_id: 1, text: '/today',
      from: { id: Number(OWNER), is_bot: false },
      chat: { id: -100200300, type: 'supergroup' }
    }
  }), 'group chat was allowed');
});

check('missing sender', () => {
  assertDenied(runPipeline({ update_id: 5, message: { message_id: 1, text: '/today', chat: { id: Number(OWNER), type: 'private' } } }), 'missing from was allowed');
});

check('missing chat', () => {
  assertDenied(runPipeline({ update_id: 6, message: { message_id: 1, text: '/today', from: { id: Number(OWNER), is_bot: false } } }), 'missing chat was allowed');
});

check('malformed update (empty object)', () => {
  assertDenied(runPipeline({}), 'empty update was allowed');
});

check('malformed update (no message / no callback)', () => {
  assertDenied(runPipeline({ update_id: 7, edited_message: { text: '/today' } }), 'edited_message was allowed');
});

check('string ids are not accepted as numeric Telegram ids', () => {
  assertDenied(runPipeline({
    update_id: 8,
    message: { message_id: 1, text: '/today', from: { id: OWNER, is_bot: false }, chat: { id: OWNER, type: 'private' } }
  }), 'string ids were allowed');
});

check('bot sender', () => {
  assertDenied(runPipeline({
    update_id: 9,
    message: { message_id: 1, text: '/today', from: { id: Number(OWNER), is_bot: true }, chat: { id: Number(OWNER), type: 'private' } }
  }), 'bot sender was allowed');
});

check('empty text', () => {
  assertDenied(runPipeline(privateMsg(Number(OWNER), '   ')), 'empty text was allowed');
});

check('empty allowlist denies all (no hardcoded fallback)', () => {
  assertDenied(runPipeline(privateMsg(Number(OWNER), '/pipeline'), [{ key: 'allowed_chat_ids', value: '' }]), 'empty allowlist allowed access');
});

check('allowlist absent entirely denies all', () => {
  assertDenied(runPipeline(privateMsg(Number(OWNER), '/pipeline'), [{ key: 'timezone', value: 'Europe/Chisinau' }]), 'absent allowlist allowed access');
});

check('substring/prefix of an allowed id is rejected', () => {
  assertDenied(runPipeline(privateMsg(10000000, '/pipeline')), 'prefix id was allowed');
});

check('forged HTTP-body shape has no entry path', () => {
  // The old exploit POSTed this JSON to the public webhook. The gate only ever sees a
  // Telegram Trigger update, so a wrapped body is not a valid update and is dropped.
  assertDenied(runPipeline({
    body: { message: { text: '/lead FIN-1', from: { id: Number(OWNER) }, chat: { id: Number(ATTACKER), type: 'private' } } }
  }), 'forged body wrapper was allowed');
});

console.log('\nPOSITIVE MATRIX (authorised owner, private chat)');

check('unknown command reaches help only — no CRM read/write', () => {
  const r = runPipeline(privateMsg(Number(OWNER), '/frobnicate'));
  assert(!r.denied, 'authorised owner was denied');
  assert(r.items[0].json.mode === 'help', 'expected mode=help, got ' + r.items[0].json.mode);
});

for (const [cmd, qt] of [['/today', 'today'], ['/overdue', 'overdue'], ['/hot', 'hot'], ['/pipeline', 'pipeline']]) {
  check('read command ' + cmd + ' routes to query', () => {
    const r = runPipeline(privateMsg(Number(OWNER), cmd));
    assert(!r.denied, 'denied');
    assert(r.items[0].json.mode === 'query', 'mode=' + r.items[0].json.mode);
    assert(r.items[0].json.query_type === qt, 'query_type=' + r.items[0].json.query_type);
  });
}

check('read command /lead requires an id', () => {
  assert(runPipeline(privateMsg(Number(OWNER), '/lead')).items[0].json.mode === 'help', 'bare /lead did not fall back to help');
  const r = runPipeline(privateMsg(Number(OWNER), '/lead FIN-42'));
  assert(r.items[0].json.mode === 'query' && r.items[0].json.query_type === 'lead', 'lead query not routed');
  assert(r.items[0].json.lead_id === 'FIN-42', 'lead_id not parsed');
});

const mutations = ['done', 'snooze', 'stage', 'meeting', 'docs', 'proposal', 'nurture', 'won', 'lost', 'note'];
for (const cmd of mutations) {
  check('mutation ' + cmd + ' routes to update with bound identity', () => {
    const r = runPipeline(privateMsg(Number(OWNER), cmd + ' FIN-42 x'));
    assert(!r.denied, 'denied');
    const j = r.items[0].json;
    assert(j.mode === 'update', 'mode=' + j.mode);
    assert(j.command === cmd, 'command=' + j.command);
    assert(j.lead_id === 'FIN-42', 'lead_id=' + j.lead_id);
    assert(j.chat_id === OWNER && j.from_id === OWNER, 'reply identity not bound to authenticated sender');
  });
  check('mutation ' + cmd + ' without lead id degrades to help', () => {
    assert(runPipeline(privateMsg(Number(OWNER), cmd)).items[0].json.mode === 'help', 'missing id did not degrade to help');
  });
}

check('snooze parses hours, defaults to 24', () => {
  assert(runPipeline(privateMsg(Number(OWNER), 'snooze FIN-1 6')).items[0].json.snooze_hours === 6, 'hours not parsed');
  assert(runPipeline(privateMsg(Number(OWNER), 'snooze FIN-1 abc')).items[0].json.snooze_hours === 24, 'bad hours did not default');
});

check('authorised callback binds reply to the authenticated chat', () => {
  const r = runPipeline({
    update_id: 20,
    callback_query: {
      id: 'cb9', data: 'done|FIN-7',
      from: { id: Number(OWNER), is_bot: false },
      message: { message_id: 5, chat: { id: Number(OWNER), type: 'private' } }
    }
  });
  assert(!r.denied, 'authorised callback denied');
  const j = r.items[0].json;
  assert(j.is_callback === true && j.callback_query_id === 'cb9', 'callback metadata lost');
  assert(j.chat_id === OWNER, 'callback reply not bound to authenticated chat');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('\nCOMMAND CENTER AUTH GATE: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('COMMAND CENTER AUTH GATE: PASS');
