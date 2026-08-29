#!/usr/bin/env node
// FINMENTOR — P9: the Mini App Gateway, pre-deploy validation.
//
//   node qa/miniapp-gateway.test.mjs
//
// Offline. No tenant, no network, no Supabase.
//
// WHAT THIS GATE IS FOR. The Gateway is the first PUBLIC surface this project has added, and it
// holds the only credential that can write the G5 ledger. Three things must be true structurally
// rather than by intention:
//
//   1. A REJECTED initData CANNOT CONSUME A KEY. Not "does not" -- cannot. The claim node must be
//      unreachable from the failure branch, so the guarantee survives someone rewiring later.
//   2. EXACTLY ONE NODE HOLDS THE CREDENTIAL, and it is the claim. A second credential-bearing
//      node is a second way to reach the database.
//   3. THE INLINED DERIVATION AGREES WITH THE MODULE. Two implementations of one digest is the
//      F10 seam again; this gate EXECUTES both and compares outputs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

// n8n Code nodes get a CommonJS require; the bodies use require('crypto') deliberately, because
// that is the path proven against the n8n Cloud sandbox. The harness must supply the same thing.
const nodeRequire = createRequire(import.meta.url);
import { buildBotDataCheckString } from '../gateway/telegram-initdata.mjs';
import { deriveReplayKey } from '../gateway/g5-replay-claim.mjs';
import {
  buildGateway, verifyGateway, NODES, G5_CLAIM_NODE, SUPABASE_CREDENTIAL,
  NEON_CREDENTIAL_ID, BOT_ID_SENTINEL, CONFIGURED_BOT_ID, APP_SESSION_TABLE, APP_SESSION_TTL_SECONDS
} from '../scripts/build-miniapp-gateway.mjs';

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

const WF = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json'), 'utf8'));
const byName = (n) => WF.nodes.find((x) => x.name === n);
const outs = (s) => ((((WF.connections || {})[s] || {}).main) || []).map((br) => (br || []).map((l) => l.node));

// Reachability along a chosen set of branches.
function reaches(from, target, branchPicker) {
  const seen = new Set([from]); const q = [from];
  while (q.length) {
    const cur = q.shift();
    const m = outs(cur);
    const idxs = branchPicker ? branchPicker(cur, m) : m.map((_, i) => i);
    idxs.forEach((i) => (m[i] || []).forEach((n) => {
      if (n === target) { seen.add(n); }
      if (!seen.has(n)) { seen.add(n); q.push(n); }
    }));
  }
  return seen.has(target);
}

console.log('\nFINMENTOR Mini App Gateway — pre-deploy validation\n');
console.log('-- shape --');

check('the workflow is exactly the declared node set', () => {
  eq(WF.nodes.length, NODES.length, 'node count');
  NODES.forEach((n) => assert(byName(n), 'missing node ' + n));
  const extra = WF.nodes.map((n) => n.name).filter((n) => NODES.indexOf(n) === -1);
  eq(extra.length, 0, 'undeclared nodes: ' + extra.join(', '));
  assert(verifyGateway(WF).ok, verifyGateway(WF).failures.join(' | '));
});

check('exactly ONE public entry point, and it is the Gateway webhook', () => {
  const hooks = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook');
  eq(hooks.length, 1, 'webhook count');
  eq(hooks[0].name, 'Gateway Webhook', 'the webhook is not the declared one');
  eq(hooks[0].parameters.httpMethod, 'POST', 'the gateway accepts a method other than POST');
  eq(hooks[0].parameters.responseMode, 'responseNode', 'responses are not controlled by respond nodes');
  const trig = WF.nodes.filter((n) => /trigger$/i.test(n.type) || n.type === 'n8n-nodes-base.webhook');
  eq(trig.length, 1, 'more than one entry point');
});

console.log('\n-- the credential boundary --');

check('EXACTLY ONE node carries a credential, and it is the G5 claim', () => {
  const credNodes = WF.nodes.filter((n) => n.credentials);
  eq(credNodes.length, 1, 'credential-bearing nodes: ' + credNodes.map((n) => n.name).join(', '));
  eq(credNodes[0].name, G5_CLAIM_NODE, 'the credential is on the wrong node');
  eq(credNodes[0].credentials.postgres.id, SUPABASE_CREDENTIAL.id, 'not the Supabase credential');
  eq(credNodes[0].credentials.postgres.name, SUPABASE_CREDENTIAL.name, 'credential name drifted');
});

check('the Neon credential appears NOWHERE in the Gateway', () => {
  assert(JSON.stringify(WF).indexOf(NEON_CREDENTIAL_ID) === -1,
    'the Neon credential id is referenced by the Gateway');
  // and no second postgres node exists to attach one to
  const pg = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.postgres');
  eq(pg.length, 1, 'more than one Postgres node: ' + pg.map((n) => n.name).join(', '));
});

console.log('\n-- a rejected initData CANNOT reach the ledger --');

check('the claim node is UNREACHABLE from the rejected branch', () => {
  // IF Verified output 1 is the failure branch. Follow it everywhere and require the claim
  // node never appears. This is the guarantee that a forged or stale payload cannot burn a key.
  const failureOnly = (cur, m) => (cur === 'IF Verified' ? [1] : m.map((_, i) => i));
  assert(!reaches('IF Verified', G5_CLAIM_NODE, failureOnly),
    'a REJECTED initData can reach the replay claim — it could burn a real user\'s key');
  eq(JSON.stringify(outs('IF Verified')[1]), JSON.stringify(['Respond Rejected']),
    'the failure branch does not go straight to the rejection responder');
});

check('the ONLY path to the claim is verified -> derive -> claim', () => {
  eq(JSON.stringify(outs('IF Verified')[0]), JSON.stringify(['Derive Replay Key']), 'verified branch');
  eq(JSON.stringify(outs('Derive Replay Key')), JSON.stringify([[G5_CLAIM_NODE]]), 'derive feeds the claim alone');
  const feeders = [];
  Object.keys(WF.connections).forEach((s) => (WF.connections[s].main || [])
    .forEach((br) => (br || []).forEach((l) => { if (l.node === G5_CLAIM_NODE) { feeders.push(s); } })));
  eq(JSON.stringify(feeders), JSON.stringify(['Derive Replay Key']), 'the claim has other feeders: ' + feeders.join(', '));
});

check('an unreachable ledger FAILS CLOSED to 503, never onward', () => {
  const claim = byName(G5_CLAIM_NODE);
  eq(claim.onError, 'continueErrorOutput', 'the claim node does not route its error separately');
  eq(JSON.stringify(outs(G5_CLAIM_NODE)[1]), JSON.stringify(['Respond Store Unavailable']),
    'the claim error branch does not fail closed');
  const resp = byName('Respond Store Unavailable');
  assert(/503/.test(JSON.stringify(resp.parameters)), 'the outage response is not 503');
  // the error branch must not reach the session
  const errOnly = (cur, m) => (cur === G5_CLAIM_NODE ? [1] : m.map((_, i) => i));
  assert(!reaches(G5_CLAIM_NODE, 'Create App Session', errOnly),
    'a store outage can still create an app session');
});

check('every response code reaches the HTTP layer as a NUMBER', () => {
  // P9-R1, the defect that made A and B return 500 live on 2026-08-29 while C passed.
  //
  // In n8n a value starting with '=' is an EXPRESSION. '=200' contains no {{ }}, so it
  // evaluates to the STRING '200', and the HTTP layer throws while writing the response --
  // after the graph has already finished. n8n records the execution as a SUCCESS and the
  // caller gets a bare 500. C was the only respond node whose code was a real {{ }}
  // expression, which is precisely why C was the only one that answered correctly.
  //
  // Proven in isolation on a credential-free probe: '=409' -> 500, '={{ 409 }}' -> 409,
  // 409 -> 409. Note a substring test like /503/.test(...) passes for BOTH the broken and
  // the fixed form, which is why the 503 assertion above never caught this.
  const responders = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  eq(responders.length, 4, 'expected four respond nodes');
  responders.forEach((n) => {
    const c = (n.parameters.options || {}).responseCode;
    const isNumber = typeof c === 'number';
    const isRealExpression = typeof c === 'string' && c.indexOf('{{') !== -1;
    assert(isNumber || isRealExpression,
      n.name + ': responseCode ' + JSON.stringify(c) +
      ' is an expression with no {{ }}; it evaluates to a string and returns 500');
  });
  eq(byName('Respond Bootstrap OK').parameters.options.responseCode, 200, 'bootstrap success is not 200');
  eq(byName('Respond Replay Refused').parameters.options.responseCode, 409, 'replay refusal is not 409');
  eq(byName('Respond Store Unavailable').parameters.options.responseCode, 503, 'store outage is not 503');
  // the rejection code stays dynamic, because the validator chooses it
  assert(/\{\{/.test(byName('Respond Rejected').parameters.options.responseCode),
    'the rejection code is no longer derived from the validator');
});

check('the builder REFUSES to emit a string-valued response code', () => {
  // A mutation gate: the fix must be structural, not a value someone can retype. Mutate the
  // built graph back to the broken form and require the verifier to reject it.
  const broken = buildGateway({ botId: CONFIGURED_BOT_ID });
  broken.nodes.find((n) => n.name === 'Respond Replay Refused').parameters.options.responseCode = '=409';
  const v = verifyGateway(broken);
  assert(!v.ok, 'verifyGateway accepted a string-valued response code');
  assert(v.failures.some((f) => /returns 500/.test(f)), 'the failure does not name the 500');
});

console.log('\n-- the claim is arbitrated by Postgres, not by us --');

check('the claim is one atomic INSERT ... ON CONFLICT DO NOTHING, wrapped so it always answers', () => {
  const q = byName(G5_CLAIM_NODE).parameters.query;
  assert(/insert into public\.telegram_initdata_replays/i.test(q), 'not an insert into the ledger');
  assert(/on conflict \(replay_key\) do nothing/i.test(q), 'no on-conflict clause: replays would throw, not refuse');
  assert(/returning replay_key/i.test(q), 'the insert returns nothing, so it cannot count what it won');
  assert(!/delete|update|drop|alter/i.test(q), 'the claim query mutates beyond the insert');

  // The INSERT must still be the FIRST thing the statement does. A SELECT ahead of it is the
  // check-then-act race G5 exists to prevent, and no CTE wrapper may smuggle one in.
  const insertAt = q.search(/insert\s+into/i);
  assert(insertAt !== -1, 'the claim query does not insert');
  assert(!/\bselect\b/i.test(q.slice(0, insertAt)), 'the claim SELECTs before inserting — that is the race');

  // P9-R2. The statement must ALWAYS return exactly one row carrying its own verdict. While a
  // won claim was one row and a lost claim was zero, an outage — which also yielded zero rows on
  // the success output — was indistinguishable from a conflict and answered 409 instead of 503.
  assert(/with\s+ins\s+as\s*\(/i.test(q), 'the insert is not wrapped in a CTE, so a conflict returns no row at all');
  assert(/\bas\s+claimed\b/i.test(q), 'no `claimed` verdict column: the verdict would be inferred from a row count again');
  assert(/count\(\*\)\s*from\s+ins/i.test(q), 'the verdict is not counted from the insert CTE');
});

check('EXECUTED: the verdict reads the STATED value, and never infers it from a row count', () => {
  const body = byName('Claim Verdict').parameters.jsCode;
  const run = (rows) => {
    const $ = (n) => ({ first: () => ({ json: n === 'Derive Replay Key'
      ? { replay_key: 'k', telegram_user_id: '551662084', correlation_id: 'C', locale: 'ru' } : {} }) });
    const $input = { all: () => rows.map((r) => ({ json: r })) };
    return new Function('$', '$input', body)($, $input)[0].json;
  };
  eq(run([{ claimed: 1 }]).claim_won, 1, 'claimed = 1 was not read as a win');
  eq(run([{ claimed: 0 }]).claim_won, 0, 'claimed = 0 was not read as a refusal');
  // node-postgres can hand an ::int back as a string depending on the driver's type parsing
  eq(run([{ claimed: '1' }]).claim_won, 1, 'a string-typed claimed = 1 was not read as a win');

  // Everything ambiguous refuses. Refusing is the safe direction here: a 409 mints no session.
  eq(run([]).claim_won, 0, 'no row at all was not read as a refusal');
  eq(run([{}]).claim_won, 0, 'a row with no verdict column was counted as a win');
  eq(run([{ claimed: 1 }, { claimed: 1 }]).claim_won, 0, 'two rows were counted as a win');
  eq(run([{ claimed: null }]).claim_won, 0, 'a null verdict was counted as a win');

  // The P9-R2 regression assertion. This is the shape the OLD verdict read as a win: one row
  // carrying a replay_key and no verdict column. It must not win now, or the fix is cosmetic.
  eq(run([{ replay_key: 'k' }]).claim_won, 0, 'the verdict still infers a win from a returned replay_key');

  const code = body.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert(!/\bselect\b/i.test(code), 'the verdict SELECTs');
});

check('the claim node does NOT carry alwaysOutputData, and the builder refuses to re-add it', () => {
  // P9-R2, the other half of the same mechanism. With alwaysOutputData, onError:
  // continueErrorOutput fires BOTH outputs on failure: the error item on output 1 AND an empty
  // item on output 0. The empty item reached Claim Verdict and committed a 409 before
  // Respond Store Unavailable could answer, and n8n recorded the outage as a success.
  const claim = byName(G5_CLAIM_NODE);
  assert(!claim.alwaysOutputData, 'the claim node carries alwaysOutputData; an outage would answer 409, not 503');
  eq(claim.onError, 'continueErrorOutput', 'the claim node does not route its error output to the 503');

  const withFlag = buildGateway({ botId: CONFIGURED_BOT_ID });
  withFlag.nodes.find((n) => n.name === G5_CLAIM_NODE).alwaysOutputData = true;
  const v1 = verifyGateway(withFlag);
  assert(!v1.ok, 'verifyGateway accepted a claim node carrying alwaysOutputData');
  assert(v1.failures.some((f) => /alwaysOutputData/.test(f)), 'the failure does not name alwaysOutputData');

  // The query is the other half, and the two must not be able to drift apart: reverting the CTE
  // alone leaves a conflict returning zero rows, which is the ambiguity all over again.
  const oldQuery = buildGateway({ botId: CONFIGURED_BOT_ID });
  oldQuery.nodes.find((n) => n.name === G5_CLAIM_NODE).parameters.query = [
    'insert into public.telegram_initdata_replays (replay_key, expires_at, correlation_id)',
    "values ($1, $2::timestamptz, nullif($3, ''))",
    'on conflict (replay_key) do nothing',
    'returning replay_key'
  ].join('\n');
  const v2 = verifyGateway(oldQuery);
  assert(!v2.ok, 'verifyGateway accepted the pre-P9-R2 claim query');
  assert(v2.failures.some((f) => /claimed/.test(f)), 'the failure does not name the missing verdict column');

  // And a verdict that goes back to counting rows must be rejected even with the CTE in place.
  const counting = buildGateway({ botId: CONFIGURED_BOT_ID });
  counting.nodes.find((n) => n.name === 'Claim Verdict').parameters.jsCode =
    "const rows = $input.all();\nreturn [{ json: { claim_won: rows.length === 1 ? 1 : 0 } }];";
  const v3 = verifyGateway(counting);
  assert(!v3.ok, 'verifyGateway accepted a verdict that counts rows instead of reading the column');

  // A SELECT ahead of the INSERT stays refused; the CTE must not become a way to reintroduce it.
  const racy = buildGateway({ botId: CONFIGURED_BOT_ID });
  racy.nodes.find((n) => n.name === G5_CLAIM_NODE).parameters.query =
    'select 1 from public.telegram_initdata_replays where replay_key = $1;\n' +
    'insert into public.telegram_initdata_replays (replay_key, expires_at, correlation_id)\n' +
    "values ($1, $2::timestamptz, nullif($3, '')) on conflict (replay_key) do nothing\n" +
    'returning 1 as claimed';
  const v4 = verifyGateway(racy);
  assert(!v4.ok, 'verifyGateway accepted a SELECT before the INSERT');
  assert(v4.failures.some((f) => /race/.test(f)), 'the failure does not name the race');

  // The unmutated graph is still accepted — a gate that rejects everything proves nothing.
  assert(verifyGateway(buildGateway({ botId: CONFIGURED_BOT_ID })).ok, 'the unmutated Gateway was rejected');
});

console.log('\n-- the inlined derivation AGREES with the tracked module --');

const NOW = 1_800_000_000;
const BOT_TOKEN = '123456789:TEST_ONLY_TOKEN_NOT_A_REAL_SECRET';
function makeInitData(over = {}) {
  const params = new Map(Object.entries({
    auth_date: String(NOW - 10),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    signature: 'Zm9vYmFyX3NpZ25hdHVyZV9wbGFjZWhvbGRlcg',
    user: JSON.stringify({ id: 551662084, first_name: 'QA', username: 'qa_user', language_code: 'ru' }),
    ...over
  }));
  const dcs = buildBotDataCheckString(params);
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN, 'utf8').digest();
  params.set('hash', createHmac('sha256', secret).update(dcs, 'utf8').digest('hex'));
  return [...params.entries()].map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

check('EXECUTED: the node digest equals gateway/g5-replay-claim.mjs, vector for vector', () => {
  const body = byName('Derive Replay Key').parameters.jsCode;
  const runNode = (initData) => {
    const $ = (n) => ({ first: () => ({ json:
      n === 'Gateway Webhook' ? { body: { init_data: initData } }
        : { response: { auth_date: NOW - 10, safe_user: { telegram_user_id: '551662084' }, locale: 'ru' },
            log: { correlation_id: 'C-1' } } }) });
    return new Function('$', 'require', body)($, nodeRequire)[0].json;
  };
  [makeInitData(), makeInitData({ query_id: 'OTHER' }), makeInitData({ auth_date: String(NOW - 11) })]
    .forEach((initData, i) => {
      eq(runNode(initData).replay_key, deriveReplayKey(initData),
        'vector ' + i + ': the deployed digest differs from the module');
    });
});

check('EXECUTED: the derive node passes NO raw initData downstream', () => {
  const body = byName('Derive Replay Key').parameters.jsCode;
  const initData = makeInitData();
  const $ = (n) => ({ first: () => ({ json:
    n === 'Gateway Webhook' ? { body: { init_data: initData } }
      : { response: { auth_date: NOW - 10, safe_user: { telegram_user_id: '551662084' }, locale: 'ru' },
          log: { correlation_id: 'C-1' } } }) });
  const out = new Function('$', 'require', body)($, nodeRequire)[0].json;
  const blob = JSON.stringify(out);
  assert(blob.indexOf(initData) === -1, 'the raw initData is carried downstream');
  assert(blob.indexOf('auth_date=') === -1, 'raw initData fragments are carried downstream');
  assert(!/user"|first_name|username/.test(blob), 'Telegram profile fields are carried downstream');
  eq(JSON.stringify(Object.keys(out).sort()),
    JSON.stringify(['auth_date', 'correlation_id', 'expires_at', 'locale', 'replay_key', 'telegram_user_id']),
    'the derive node emits fields beyond the approved set');
});

console.log('\n-- the verifier is the TRACKED file, not a retype --');

check('Verify InitData is bootstrap-canary.js with ONLY the BOT_ID line substituted', () => {
  const tracked = readFileSync(join(ROOT, 'gateway', 'n8n', 'bootstrap-canary.js'), 'utf8');
  const deployed = byName('Verify InitData').parameters.jsCode;
  const sentinelLine = "const BOT_ID = '" + BOT_ID_SENTINEL + "';";
  assert(tracked.indexOf(sentinelLine) !== -1, 'the tracked canary lost its BOT_ID sentinel');
  // rebuild the deployed body from the tracked source by substituting the same one line
  const botLine = (deployed.match(/const BOT_ID = '[^']*';/) || [])[0];
  assert(botLine, 'the deployed body has no BOT_ID line');
  eq(tracked.replace(sentinelLine, botLine), deployed,
    'the deployed verifier differs from the tracked canary by more than BOT_ID');
});

check('the deployed BOT_ID is the confirmed one, and not the rejected id', () => {
  const deployed = byName('Verify InitData').parameters.jsCode;
  const m = deployed.match(/const BOT_ID = '([^']*)';/);
  assert(m, 'no BOT_ID line');
  eq(m[1], CONFIGURED_BOT_ID, 'the deployed bot id is not the confirmed one');
  eq(m[1], '8917808598', 'the confirmed bot id drifted');
  // 8267398121 was explicitly rejected by the owner; it must appear nowhere.
  assert(JSON.stringify(WF).indexOf('8267398121') === -1, 'the REJECTED bot id appears in the Gateway');
});

check('an unconfigured BOT_ID fails CLOSED', () => {
  const deployed = byName('Verify InitData').parameters.jsCode;
  assert(/BOT_ID_NOT_CONFIGURED/.test(deployed), 'the config guard is gone');
  assert(/TEMPORARY_BACKEND_ERROR/.test(deployed), 'an unconfigured bot id does not fail closed');
});

console.log('\n-- the app session: a binding with a TTL, not a CRM --');

check('EXECUTED: the session id is high-entropy and is NOT a storage row id', () => {
  const body = byName('Build App Session').parameters.jsCode;
  const run = () => {
    const $ = () => ({ first: () => ({ json: { telegram_user_id: '551662084', replay_key: 'k'.repeat(64), correlation_id: 'C', locale: 'ru' } }) });
    return new Function('$', 'require', body)($, nodeRequire)[0].json;
  };
  const a = run(); const b = run();
  assert(/^AS-[0-9a-f]{64}$/.test(a.app_session_id), 'the session id is not 32 random bytes hex: ' + a.app_session_id);
  assert(a.app_session_id !== b.app_session_id, 'two sessions minted the same id');
  assert(!/row|index|id=/.test(a.app_session_id.slice(3)), 'the id looks derived from storage');
  assert(a.app_session_id.indexOf('551662084') === -1, 'the id embeds the Telegram user');
});

check('EXECUTED: TTL, binding and terminal state are as specified', () => {
  const body = byName('Build App Session').parameters.jsCode;
  const $ = () => ({ first: () => ({ json: { telegram_user_id: '551662084', replay_key: 'k'.repeat(64), correlation_id: 'C', locale: 'ru' } }) });
  const s = new Function('$', 'require', body)($, nodeRequire)[0].json;
  const ttl = (Date.parse(s.expires_at) - Date.parse(s.created_at)) / 1000;
  eq(ttl, APP_SESSION_TTL_SECONDS, 'the server-side TTL is not the declared one');
  eq(s.state, 'draft', 'a new session does not start as draft');
  eq(s.telegram_user_id, '551662084', 'the session is not bound to the Telegram user');
  eq(s.draft_json, '', 'a new session carries draft data');
  // one user, one binding; consent is NOT recorded here
  const keys = Object.keys(s).sort();
  eq(JSON.stringify(keys), JSON.stringify(['app_session_id', 'chat_id', 'created_at', 'cycle_id',
    'draft_json', 'expires_at', 'replay_key', 'state', 'telegram_user_id', 'updated_at']),
  'the session row carries fields beyond the approved set: ' + keys.join(', '));
  assert(!('consent' in s) && !('consent_at' in s), 'the app session records consent — it must never be consent proof');
});

check('the app session store is the Data Table, and holds no lead content', () => {
  const node = byName('Create App Session');
  eq(node.type, 'n8n-nodes-base.dataTable', 'the app session is not stored in a Data Table');
  eq(node.parameters.dataTableId.value, APP_SESSION_TABLE, 'wrong table');
  eq(node.parameters.operation, 'insert', 'the bootstrap does something other than insert');
  const blob = JSON.stringify(WF);
  ['contact_phone', 'contact_email', 'lead_payload', 'answers'].forEach((k) => {
    assert(blob.indexOf(k) === -1, 'the Gateway references lead content: ' + k);
  });
});

console.log('\n-- retention and exposure --');

check('NO execution data is retained, so raw initData is never persisted', () => {
  eq(WF.settings.saveDataSuccessExecution, 'none', 'successful executions are stored');
  eq(WF.settings.saveDataErrorExecution, 'none', 'failed executions are stored');
  eq(WF.settings.saveManualExecutions, false, 'manual executions are stored');
});

check('availableInMCP is false and no response leaks internals', () => {
  eq(WF.settings.availableInMCP, false, 'the Gateway is MCP-exposed');
  const responders = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook');
  eq(responders.length, 4, 'unexpected responder count');
  responders.forEach((r) => {
    const b = JSON.stringify(r.parameters);
    ['replay_key', 'submission_key', 'init_data', 'telegram_user_id'].forEach((k) => {
      assert(b.indexOf(k) === -1, r.name + ' leaks ' + k + ' to the client');
    });
  });
});

check('the Gateway performs NO Pipeline write and calls no other workflow', () => {
  assert(!WF.nodes.some((n) => n.type === 'n8n-nodes-base.googleSheets'), 'the Gateway writes to Sheets');
  assert(!WF.nodes.some((n) => n.type === 'n8n-nodes-base.executeWorkflow'), 'the Gateway calls another workflow');
  assert(!WF.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest'), 'the Gateway makes an HTTP call');
});

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
