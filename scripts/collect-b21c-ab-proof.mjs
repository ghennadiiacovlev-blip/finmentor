#!/usr/bin/env node
// FINMENTOR — P9 STEP 3B: collect the server-side proofs after the owner's A+B press.
//
//   node scripts/collect-b21c-ab-proof.mjs --ledger-before=3 --ledger-after=4 \
//        --ledger-fingerprint=<md5 of the newest ledger replay_key>
//
// Read-only. It writes nothing anywhere and activates nothing.
//
// WHAT IT REFUSES TO PRINT. The replay key and the app_session_id are never printed. The key is
// compared to the ledger's by MD5 FINGERPRINT, so "these two rows are the same request" can be
// established without either digest appearing anywhere. The session id is reported by shape and
// length only. No Telegram-signed material exists in this process at all.

import crypto from 'node:crypto';

const GATEWAY_ID = 'nTZHLbv2KFggdhh5';
const PAGE_ID = 'EU91nSsmqQqIeD8w';
const SESSION_TABLE_ID = 'LRme88caqxFzTLqW';
const SUPABASE_CREDENTIAL_ID = 'B6wRirWfjqoASXU3';

const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith('--' + n + '=')); return m ? m.split('=').slice(1).join('=') : d; };
const LEDGER_BEFORE = Number(arg('ledger-before', 'NaN'));
const LEDGER_AFTER = Number(arg('ledger-after', 'NaN'));
const LEDGER_FP = String(arg('ledger-fingerprint', ''));
const SESSIONS_BEFORE = Number(arg('sessions-before', '3'));

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
function say(m) { console.log(m); }
if (!BASE || !READ_KEY) { console.error('N8N_BASE_URL / N8N_API_KEY not set'); process.exit(1); }

const failures = [];
function must(n, cond, detail) {
  if (cond) { say('  PASS  ' + n); }
  else { failures.push(n + (detail ? ' -> ' + detail : '')); say('  FAIL  ' + n + (detail ? ' -> ' + detail : '')); }
}

async function api(path) {
  const res = await fetch(BASE + '/api/v1' + path, { headers: { 'X-N8N-API-KEY': READ_KEY } });
  const text = await res.text();
  if (!res.ok) { throw new Error('GET ' + path + ' -> ' + res.status + ' ' + text.slice(0, 200)); }
  return text ? JSON.parse(text) : null;
}

// SIGNED MATERIAL. Scanned across the whole row: none of these may appear anywhere, ever.
const SIGNED_NEEDLES = [
  ['query_id=', /query_id=/], ['auth_date=', /auth_date=/], ['user=', /(^|[^a-z_])user=/],
  ['hash=', /hash=/], ['signature=', /signature=/],
  ['bot-token shape', /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/]
];

// CONTACT PII. Scanned only over the fields that can carry free text.
//
// A blanket phone/email regex over the whole row is worse than useless here: `telegram_user_id`
// is nine digits and every ISO timestamp is digits and separators, so a loose pattern reports a
// "phone" on a row that is behaving exactly as specified. That is a scan that cannot fail
// meaningfully and therefore cannot pass meaningfully either.
//
// `telegram_user_id` / `chat_id` are NOT a leak: they are the session binding the contract
// requires (§6, "bound to exactly one Telegram user"). Their shape is asserted separately.
const FREE_TEXT_FIELDS = ['cycle_id', 'state', 'draft_json'];
const PII_NEEDLES = [
  ['email', /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ['phone', /\+?\d[\d ()\-.]{7,}\d/]
];
const EXPECTED_COLUMNS = ['app_session_id', 'chat_id', 'createdAt', 'created_at', 'cycle_id',
  'draft_json', 'expires_at', 'id', 'replay_key', 'state', 'telegram_user_id', 'updatedAt', 'updated_at'];

async function main() {
  say('');
  say('== 2 + 3. THE TWO WRITES A IS THE ONLY PATH TO ============');
  say('  G5 ledger rows              : ' + LEDGER_BEFORE + ' -> ' + LEDGER_AFTER);
  must('exactly ONE new G5 row on the pair', LEDGER_AFTER - LEDGER_BEFORE === 1,
    'delta ' + (LEDGER_AFTER - LEDGER_BEFORE));

  const rows = (await api('/data-tables/' + SESSION_TABLE_ID + '/rows?limit=200')).data;
  say('  app-session rows            : ' + SESSIONS_BEFORE + ' -> ' + rows.length);
  must('exactly ONE new app session on the pair', rows.length - SESSIONS_BEFORE === 1,
    'delta ' + (rows.length - SESSIONS_BEFORE));

  const newest = rows.slice().sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')))[0];

  say('');
  say('== 7. A AND B WERE ONE REQUEST ============================');
  const sessionFp = crypto.createHash('md5').update(String(newest.replay_key), 'utf8').digest('hex');
  say('  ledger  replay_key fingerprint : ' + LEDGER_FP);
  say('  session replay_key fingerprint : ' + sessionFp);
  must('the new ledger row and the new session carry the SAME replay_key', sessionFp === LEDGER_FP,
    'fingerprints differ');
  must('the session replay_key is 64 lowercase hex', /^[0-9a-f]{64}$/.test(String(newest.replay_key)));
  say('  The +1/+1 delta is what shows B claimed nothing: one key, one session, two shots.');
  say('  A and B ran back to back in one browser run, so the ledger could not be sampled');
  say('  BETWEEN them. The delta being +1 and not +2 is the evidence, not a third read.');

  say('');
  say('== 1 + 4. THE SESSION A MINTED ============================');
  const sid = String(newest.app_session_id || '');
  must('app_session_id is AS- + 64 lowercase hex', /^AS-[0-9a-f]{64}$/.test(sid),
    'len ' + sid.length);
  must('app_session_id length is 67', sid.length === 67, String(sid.length));
  must('all 16 hex digits are present (high entropy, not a counter)',
    new Set(sid.slice(3).split('')).size === 16, String(new Set(sid.slice(3).split('')).size) + ' distinct');
  must('the session is bound to exactly one Telegram user',
    String(newest.telegram_user_id || '').length > 0 && newest.telegram_user_id === newest.chat_id);
  must('cycle_id is empty — bootstrap minted no cycle', String(newest.cycle_id || '') === '');
  must('state is draft', String(newest.state) === 'draft');
  must('draft_json is empty', String(newest.draft_json || '') === '');
  const ttl = (new Date(newest.expires_at) - new Date(newest.created_at)) / 1000;
  must('TTL is 72h', Math.abs(ttl - 259200) < 2, String(ttl)); // owner decision 5; was 1800s

  say('');
  say('== 8 + 11. NO PII, NO SIGNED MATERIAL PERSISTED ===========');
  const blob = JSON.stringify(newest);
  say('  session columns: ' + Object.keys(newest).sort().join(', '));
  must('the session row has EXACTLY the expected columns — nothing was added',
    JSON.stringify(Object.keys(newest).sort()) === JSON.stringify([...EXPECTED_COLUMNS].sort()),
    Object.keys(newest).sort().join(','));
  must('the session holds no raw initData, signature or hash COLUMN',
    !Object.keys(newest).some((k) => /init_?data|signature|hash|query_id|auth_date/i.test(k)));

  const signedLeaks = SIGNED_NEEDLES.filter(([, re]) => re.test(blob)).map(([n]) => n);
  must('no signed Telegram material anywhere in the row', signedLeaks.length === 0,
    'found: ' + signedLeaks.join(','));

  const freeText = FREE_TEXT_FIELDS.map((f) => String(newest[f] ?? '')).join(' ').trim();
  say('  free-text fields (cycle_id, state, draft_json): ' + (freeText === 'draft' ? '"draft" only' : JSON.stringify(freeText)));
  const piiLeaks = PII_NEEDLES.filter(([, re]) => re.test(freeText)).map(([n]) => n);
  must('leak_fields [] — no contact PII in any free-text field', piiLeaks.length === 0,
    'found: ' + piiLeaks.join(','));

  // The binding is required by the contract, so it is asserted for SHAPE rather than absence.
  must('telegram_user_id / chat_id are a bare numeric Telegram id and nothing more',
    /^\d{5,20}$/.test(String(newest.telegram_user_id)) && newest.chat_id === newest.telegram_user_id,
    String(newest.telegram_user_id).length + ' chars');
  must('no name, username, email, phone or free text accompanies the binding',
    !Object.keys(newest).some((k) => /name|username|email|phone|contact|lead|message|text/i.test(k)));

  say('');
  say('== 9 + 10. RETENTION =====================================');
  const gwExec = (await api('/executions?limit=100&workflowId=' + GATEWAY_ID)).data.length;
  const pageExec = (await api('/executions?limit=100&workflowId=' + PAGE_ID)).data.length;
  must('Gateway retained executions = 0 after a real ACCEPTED request', gwExec === 0, String(gwExec));
  must('page retained executions = 0', pageExec === 0, String(pageExec));
  const gw = await api('/workflows/' + GATEWAY_ID + '?excludePinnedData=true');
  must('Gateway retention settings still none/none/false/false',
    gw.settings.saveDataSuccessExecution === 'none' && gw.settings.saveDataErrorExecution === 'none' &&
    gw.settings.saveManualExecutions === false && gw.settings.saveExecutionProgress === false);

  say('');
  say('== 13. THE GATEWAY CREDENTIAL ============================');
  const credNodes = gw.nodes.filter((n) => n.credentials);
  must('exactly one credential-bearing node in the Gateway', credNodes.length === 1, String(credNodes.length));
  must('it is G5 Replay Claim, holding FINMENTOR Supabase G5',
    credNodes[0].name === 'G5 Replay Claim' && credNodes[0].credentials.postgres.id === SUPABASE_CREDENTIAL_ID);
  must('the Gateway is still the P9-R2 graph: CTE claim, no alwaysOutputData',
    /as claimed/i.test(gw.nodes.find((n) => n.name === 'G5 Replay Claim').parameters.query) &&
    !gw.nodes.find((n) => n.name === 'G5 Replay Claim').alwaysOutputData);
  must('Gateway still ACTIVE with 13 nodes', gw.active === true && gw.nodes.length === 13);

  say('');
  say('== 14 + 16 + 17. NEON, PIPELINE, F17 ======================');
  const gwBlob = JSON.stringify(gw);
  must('no Neon credential referenced by the Gateway', gwBlob.indexOf('Neon') === -1);
  const types = new Set(gw.nodes.map((n) => n.type));
  must('a Pipeline write is structurally impossible from the Gateway',
    !types.has('n8n-nodes-base.googleSheets') && !types.has('n8n-nodes-base.httpRequest') &&
    !types.has('n8n-nodes-base.executeWorkflow'), [...types].join(', '));
  must('the Gateway calls no other workflow', !types.has('n8n-nodes-base.executeWorkflow'));

  say('');
  say('  NOTE: proof 15 (Concierge and Lead Intake unchanged) is measured separately against');
  say('        n8n/production/manifest.json, using Get-WorkflowStructuralHash from n8n-lib.ps1 —');
  say('        the SAME function that produced the tracked hashes. Recomputing it in Node would');
  say('        be a different serialisation and could only ever prove itself.');

  say('');
  if (failures.length) {
    say('== RESULT: A+B SERVER-SIDE = FAIL =========================');
    failures.forEach((f) => say('  - ' + f));
    process.exitCode = 1;
  } else {
    say('== RESULT: A+B SERVER-SIDE = PASS =========================');
  }
}

main().catch((e) => { console.error('\nABORTED: ' + e.message); process.exitCode = 1; });
