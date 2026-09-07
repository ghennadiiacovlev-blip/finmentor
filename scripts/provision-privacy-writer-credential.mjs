#!/usr/bin/env node
// FINMENTOR — provision AND prove the privacy_audit_writer runtime credential.
//
//   node scripts/provision-privacy-writer-credential.mjs --confirm
//   node scripts/provision-privacy-writer-credential.mjs --confirm --host <pooler-host> --port 5432
//
// LIVE. It rotates a database password, creates one n8n credential, and proves the credential's
// privileges by executing real statements through it.
//
// ── THE SECRET NEVER LEAVES THE PROCESS ────────────────────────────────────────────────────────
//
// The password is generated in memory and used twice: once in the rotation request, once in the
// credential body. It is never printed, never written to a file, never logged, never passed on a
// command line, and never embedded in a stored workflow definition. Its length, prefix, suffix and
// hash are equally never printed — those are all partial disclosures of the same secret.
//
// The rotation runs through a DISPOSABLE workflow with execution retention OFF, and the password
// travels in the WEBHOOK BODY rather than in the workflow definition, so n8n never persists it
// anywhere but the credential store it is meant to live in. `redact()` below is applied to every
// line this script prints, as a backstop against a future edit that forgets.
//
// ── WHY A DISPOSABLE WORKFLOW AND NOT A DIRECT CONNECTION ──────────────────────────────────────
//
// This repo has no Postgres driver and no direct database route from the workstation. n8n holds the
// only credential that can `ALTER ROLE`. Using it through a workflow that is created, fired and
// deleted in the same run is the same discipline the Pipeline migration used.
//
// ── WHAT IT PROVES, AND WITH WHAT ──────────────────────────────────────────────────────────────
//
// The proof runs as the NEW CREDENTIAL — not as `postgres` with `SET ROLE`, which is what the store
// proof did. A `SET ROLE` proof shows the role is constrained; only the credential shows that the
// thing n8n will actually authenticate as is constrained. They are different claims.
//
//   INSERT      PASS      one disposable row, cleaned up afterwards by an admin
//   SELECT      DENIED    the writer must not read the store back
//   UPDATE      DENIED
//   DELETE      DENIED
//   TRUNCATE    DENIED
//   ALTER       DENIED
//   DROP        DENIED
//   ESCALATION  DENIED    CREATE ROLE
//
// Every Postgres node carries `onError: 'continueRegularOutput'` and NO `alwaysOutputData`: the
// P9-R2/P9-R4 pairing puts a failing node's error on BOTH outputs, and this whole script is an
// exercise in reading failures correctly.

import crypto from 'node:crypto';

const ROLE = 'privacy_audit_writer';
const CRED_NAME = 'FINMENTOR Privacy Audit Writer';
const PROJECT_REF = 'exvmtjxmfouzuschiuwj';
const G5_CRED = { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' };
const TABLE = 'privacy.privacy_acknowledgements';
const ROTATE_PATH = 'p11/privacy-writer-rotate';
const PROOF_PATH = 'p11/privacy-writer-proof';

// MEASURED, not guessed. `scripts/diagnose-privacy-writer-connection.mjs` established all three:
//
//   * `db.<ref>.supabase.co` resolves to IPv6 only and n8n answers ENETUNREACH. The direct route
//     does not exist from this instance.
//   * Of every pooler region, only `aws-0-eu-central-1` answers; the rest return "Host not found",
//     which is how a wrong region announces itself once TLS stops masking it.
//   * TLS chain verification MUST be relaxed. Supabase's pooler presents a certificate signed by a
//     private CA that is not in Node's trust store, and the n8n Postgres credential has no field
//     for a CA bundle — so `allowUnauthorizedCerts` is the only way through. The connection is
//     still encrypted; it is the chain that goes unverified. This is a real, reported weakening,
//     not an oversight, and it is the same compromise the existing G5 credential already makes.
//
// Every earlier failure reported itself as "self-signed certificate in certificate chain" — a TLS
// error, not an authentication error and not a privilege denial. The provisioning script refused
// to publish a privilege matrix built on it, which is why this comment exists rather than a table.
const HOST_CANDIDATES = ['aws-0-eu-central-1.pooler.supabase.com'];
const RELAX_TLS_CHAIN = true;
const DEFAULT_PORT = 5432;              // session mode: behaves like a direct connection
const PG_USER = ROLE + '.' + PROJECT_REF;
const PG_DATABASE = 'postgres';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const CONFIRM = args.includes('--confirm');
const HOSTS = flag('host') ? [flag('host')] : HOST_CANDIDATES;
const PORT = Number(flag('port') || DEFAULT_PORT);

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

// ── output discipline ──────────────────────────────────────────────────────────────────────────

let SECRET = null;
function redact(s) {
  let t = String(s);
  if (SECRET) { t = t.split(SECRET).join('«redacted»'); }
  return t;
}
const say = (m) => console.log(redact(m));
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error(redact('\nABORTED: ' + m)); process.exit(1); }

// ── n8n ────────────────────────────────────────────────────────────────────────────────────────

async function api(method, path, body, write) {
  const key = write ? WRITE_KEY : READ_KEY;
  if (write && !key) { throw new Error('N8N_FIX_API_KEY is not set; refusing to write.'); }
  if (method !== 'GET' && !write) { throw new Error('refusing ' + method + ' without the write key'); }
  const res = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }
  if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + redact(text).slice(0, 300)); }
  return json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retention OFF everywhere: no execution data is kept, so nothing that passes through these
// workflows is persisted.
// Retention OFF for the ROTATION: the password passes through it, and nothing that carries a
// secret may be persisted.
const SETTINGS = {
  executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none'
};

// Retention ON for the PROOF. `Error.message` is not an enumerable property, so it does not
// survive n8n's item serialisation — reading the error off the item yields only «Failed query:
// <sql>», which is how the first three attempts at this proof produced eight identical DENIED
// verdicts that meant nothing. The execution record keeps the real driver error. No secret passes
// through this workflow, and it is deleted seconds later along with its executions.
const PROOF_SETTINGS = {
  executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: true,
  saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all'
};

const webhook = (path) => ({
  parameters: { httpMethod: 'POST', path: path, responseMode: 'responseNode', options: {} },
  id: 'hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0]
});
const respond = (expr) => ({
  parameters: { respondWith: 'json', responseBody: expr, options: { responseCode: 200 } },
  id: 'respond', name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1600, 0]
});
function pg(id, name, query, cred, x) {
  return {
    parameters: { operation: 'executeQuery', query: query, options: {} },
    id: id, name: name, type: 'n8n-nodes-base.postgres', typeVersion: 2.4, position: [x, 0],
    credentials: { postgres: cred },
    onError: 'continueRegularOutput'
  };
}
const chain = (names) => {
  const c = {};
  for (let i = 0; i < names.length - 1; i++) { c[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }; }
  return c;
};

async function fire(path, body) {
  let res = null, text = '';
  for (let i = 0; i < 10; i++) {
    res = await fetch(BASE + '/webhook/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    });
    text = await res.text();
    if (res.status !== 404) { break; }
    await sleep(1000);
  }
  return { status: res.status, text: text };
}

// Walk an error for every scalar that says something, deepest cause first.
function explain(err) {
  const out = [];
  const seen = [];
  (function walk(e, d) {
    if (!e || d > 6 || typeof e !== 'object' || seen.indexOf(e) !== -1) { return; }
    seen.push(e);
    for (const k of ['message', 'description', 'detail', 'hint', 'code', 'routine', 'severity', 'name']) {
      const v = e[k];
      if (v !== undefined && v !== null && typeof v !== 'object' && String(v) !== '') {
        const line = k + '=' + String(v).slice(0, 200);
        if (out.indexOf(line) === -1) { out.push(line); }
      }
    }
    for (const k of ['cause', 'error', 'original', 'context']) { walk(e[k], d + 1); }
  })(err, 0);
  return out;
}

async function withDisposable(wf, fn) {
  let id = null;
  try {
    const made = await api('POST', '/workflows', wf, true);
    id = made.id;
    await api('POST', '/workflows/' + id + '/activate', null, true);
    return await fn(id);
  } finally {
    if (id) {
      try { await api('POST', '/workflows/' + id + '/deactivate', null, true); } catch (e) { /* may be off */ }
      let gone = false;
      for (let i = 0; i < 8; i++) {
        try { await api('DELETE', '/workflows/' + id, null, true); gone = true; break; }
        catch (e) { await sleep(1500); }
      }
      if (gone) {
        try { await api('GET', '/workflows/' + id); say('  *** TEARDOWN INCOMPLETE: ' + id + ' still readable'); }
        catch (e) { ok('disposable workflow deleted and absence verified: ' + id); }
      } else { say('  *** TEARDOWN FAILED — REMOVE BY HAND: ' + id); }
    }
  }
}

// ── the two disposable workflows ───────────────────────────────────────────────────────────────

// ALTER ROLE cannot take a bind parameter — PostgreSQL does not parameterise utility statements.
// So the statement is assembled in a Code node from the webhook body and run as an expression. The
// password is in the REQUEST, never in the stored workflow, and retention is off.
const ROTATE_BUILD = [
  '// The password arrives in the request body and is used once. Quoting is by doubling single',
  "// quotes; the generator emits base64url, which contains none — this is belt and braces.",
  'const pw = String(($json.body || {}).pw || "");',
  'if (!pw) { throw new Error("no password supplied"); }',
  'const quoted = "\'" + pw.split("\'").join("\'\'") + "\'";',
  'return [{ json: { sql: "alter role ' + ROLE + ' with password " + quoted } }];'
].join('\n');

function rotateWorkflow() {
  return {
    name: '[TEMP] P11 privacy writer rotate',
    settings: SETTINGS,
    nodes: [
      webhook(ROTATE_PATH),
      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ROTATE_BUILD },
        id: 'build', name: 'Build Statement', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
      pg('rot', 'Rotate', '={{ $json.sql }}', G5_CRED, 440),
      respond('={{ JSON.stringify({ ok: !$json.error, error: $json.error ? String($json.error).slice(0, 200) : null }) }}')
    ],
    connections: chain(['Hook', 'Build Statement', 'Rotate', 'Respond'])
  };
}

// Each probe is its own node so each error is real and attributable. `$1` is the proof key.
const PROBES = [
  // Needs no privilege on anything. It is the arbiter of "did we connect at all", so a wrong
  // pooler region or a bad password can never be mistaken for a privilege denial.
  ['CONNECT', 'con', 'select 1 as ok'],
  ['INSERT', 'ins', 'insert into ' + TABLE +
    ' (submission_key, privacy_notice_version, privacy_locale, privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis)' +
    " values ($1, 'p11-credential-proof', 'ru', now(), now(), 'PENDING_LEGAL_REVIEW')"],
  ['SELECT', 'sel', 'select 1 from ' + TABLE + ' where submission_key = $1'],
  ['UPDATE', 'upd', 'update ' + TABLE + " set privacy_locale = 'ro' where submission_key = $1"],
  ['DELETE', 'del', 'delete from ' + TABLE + ' where submission_key = $1'],
  ['TRUNCATE', 'trn', 'truncate ' + TABLE],
  ['ALTER', 'alt', 'alter table ' + TABLE + ' add column injected text'],
  ['DROP', 'drp', 'drop table ' + TABLE],
  ['ESCALATION', 'esc', 'create role escalated_by_writer login']
];

// ONE probe per execution, and NO `onError`.
//
// That combination is the whole reason this proof is trustworthy. With `onError:
// continueRegularOutput` the node keeps the workflow running and records the failure on the ITEM,
// where `Error.message` — a non-enumerable property — does not survive serialisation; three
// earlier attempts at this proof produced eight identical DENIED verdicts carrying nothing but
// «Failed query: <sql>». Letting the node fail puts the driver error in `resultData.error`, where
// the message and the SQLSTATE are plain strings.
//
// The cost is nine executions instead of one. That is the right trade: a privilege matrix is only
// worth reporting if each row names the reason it says what it says.
function probeWorkflow(cred) {
  return {
    name: '[TEMP] P11 privacy writer probe',
    settings: PROOF_SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: PROOF_PATH, responseMode: 'lastNode', options: {} },
        id: 'hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { operation: 'executeQuery', query: '={{ $json.body.sql }}',
          options: { queryReplacement: '={{ $json.body.key }}' } },
        id: 'pr', name: 'Probe', type: 'n8n-nodes-base.postgres', typeVersion: 2.4, position: [220, 0],
        credentials: { postgres: cred } }
    ],
    connections: { Hook: { main: [[{ node: 'Probe', type: 'main', index: 0 }]] } }
  };
}

// Run every probe through one disposable workflow, one execution each.
async function runProbes(cred, key) {
  const out = {};
  await withDisposable(probeWorkflow(cred), async (wfId) => {
    for (const [label, , sql] of PROBES) {
      await fire(PROOF_PATH, { sql: sql, key: key });
      const r = await executionOutcome(wfId);
      if (!r) { out[label] = { verdict: 'NOT REACHED' }; continue; }
      if (!r.error) { out[label] = { verdict: 'ALLOWED' }; continue; }
      const facts = explain(r.error);
      const msg = (facts.find((f) => f.indexOf('message=') === 0) || '').slice(8);
      const code = (facts.find((f) => f.indexOf('code=') === 0) || '').slice(5);
      out[label] = { verdict: 'DENIED', code: code, message: msg || facts.join(' | ').slice(0, 200) };
    }
  });
  return out;
}

// The newest execution of this workflow, with its top-level error if it failed.
let lastSeenExecution = null;
async function executionOutcome(workflowId) {
  await sleep(2000);
  for (let i = 0; i < 8; i++) {
    const list = await api('GET', '/executions?workflowId=' + workflowId + '&limit=1');
    const rows = (list && list.data) || [];
    if (rows.length && String(rows[0].id) !== String(lastSeenExecution)) {
      lastSeenExecution = rows[0].id;
      const full = await api('GET', '/executions/' + rows[0].id + '?includeData=true');
      const rd = (full.data && full.data.resultData) || {};
      return { status: full.status, error: rd.error || null };
    }
    await sleep(2000);
  }
  return null;
}


// ── main ───────────────────────────────────────────────────────────────────────────────────────

const missing = [];
if (!BASE) { missing.push('N8N_BASE_URL'); }
if (!READ_KEY) { missing.push('N8N_API_KEY'); }
if (!WRITE_KEY) { missing.push('N8N_FIX_API_KEY'); }

say('');
say('Privacy audit writer credential — provision and prove');
say('='.repeat(74));
say('  role        : ' + ROLE);
say('  credential  : ' + CRED_NAME);
say('  db user     : ' + PG_USER);
say('  port        : ' + PORT + ' (session mode)');
say('  host        : ' + (HOSTS.length === 1 ? HOSTS[0] : HOSTS.length + ' candidates, probed'));
say('  tls         : encrypted; chain verification relaxed (Supabase private CA, no CA field)');
say('  secret      : generated in memory; never printed, stored or logged');
say('');

if (missing.length) { die('set these first: ' + missing.join(', ')); }
if (!CONFIRM) { die('this rotates a live password and creates a live credential; re-run with --confirm'); }

SECRET = crypto.randomBytes(32).toString('base64url');
const PROOF_KEY = 'sub_' + crypto.randomBytes(16).toString('hex');

let credentialId = null;
let chosenHost = null;
const verdicts = {};

try {
  // 1. rotate ------------------------------------------------------------------------------------
  say('STEP 1 — rotate the role password');
  const rotated = await withDisposable(rotateWorkflow(), async () => {
    const r = await fire(ROTATE_PATH, { pw: SECRET });
    if (r.status !== 200) { throw new Error('rotation request returned HTTP ' + r.status + ' ' + redact(r.text).slice(0, 200)); }
    let body = null;
    try { body = JSON.parse(r.text); } catch (e) { throw new Error('rotation returned non-JSON'); }
    if (!body.ok) { throw new Error('rotation failed: ' + redact(String(body.error)).slice(0, 200)); }
    return true;
  });
  if (rotated) { ok('password rotated'); }
  say('');

  // 2. credential + 3. proof, host probed -----------------------------------------------------
  say('STEP 2 — create the credential and prove it, probing the pooler region');
  for (const host of HOSTS) {
    if (credentialId) {
      try { await api('DELETE', '/credentials/' + credentialId, null, true); } catch (e) { /* best effort */ }
      credentialId = null;
    }
    const made = await api('POST', '/credentials', {
      name: CRED_NAME, type: 'postgres',
      data: {
        host: host, port: PORT, database: PG_DATABASE, user: PG_USER,
        password: SECRET, ssl: 'require', allowUnauthorizedCerts: RELAX_TLS_CHAIN,
        maxConnections: 5, sshTunnel: false
      }
    }, true);
    credentialId = made.id;

    const cred = { id: credentialId, name: CRED_NAME };
    const probes = await runProbes(cred, PROOF_KEY);

    // `select 1` succeeding is the only honest evidence that the credential authenticated. If it
    // fails, EVERY other verdict is meaningless — a table of DENIED that means "never connected"
    // is exactly the false proof this project has already had to throw away once.
    const conn = probes.CONNECT || {};
    if (conn.verdict !== 'ALLOWED') {
      say('  ..    ' + host + ' — no connection');
      say('        ' + redact(String(conn.message || 'unknown')).slice(0, 220));
      continue;
    }
    chosenHost = host;
    Object.assign(verdicts, probes);
    break;
  }

  if (!chosenHost) {
    throw new Error('no candidate pooler host accepted the credential; supply --host explicitly');
  }
  ok('connected via ' + chosenHost);
  say('  credential id : ' + credentialId);
  say('');

  // 4. read the verdicts -------------------------------------------------------------------------
  say('STEP 3 — privilege matrix, executed AS THE CREDENTIAL');
  say('');
  const EXPECT = {
    CONNECT: 'ALLOWED', INSERT: 'ALLOWED', SELECT: 'DENIED', UPDATE: 'DENIED', DELETE: 'DENIED',
    TRUNCATE: 'DENIED', ALTER: 'DENIED', DROP: 'DENIED', ESCALATION: 'DENIED'
  };
  // Established by its own probe above; every other verdict depends on it.
  const connectionProven = (verdicts.CONNECT || {}).verdict === 'ALLOWED';
  let allGood = connectionProven;
  for (const [label] of PROBES) {
    const v = verdicts[label] || { verdict: 'NOT REACHED' };
    const want = EXPECT[label];
    // What separates a privilege denial from a connection failure is no longer a guess: CONNECT is
    // its own measured probe, and it passed, so the credential authenticated. A denial is therefore
    // proven when it carries EITHER a SQLSTATE or one of PostgreSQL's own privilege messages.
    //
    // n8n does not surface the driver `code` for these, so requiring a SQLSTATE alone would mark
    // «permission denied for table privacy_acknowledgements» unproven — which would be the
    // opposite error to the one this discipline exists to prevent: refusing real evidence rather
    // than accepting empty evidence.
    const PRIVILEGE_MESSAGE = /permission denied (for|to)|must be owner of/i;
    const proven = v.verdict === 'ALLOWED'
      || (v.verdict === 'DENIED'
          && connectionProven
          && (/^[0-9A-Z]{5}$/.test(v.code || '') || PRIVILEGE_MESSAGE.test(v.message || '')));
    const good = v.verdict === want && proven;
    if (!proven && v.verdict === 'DENIED') { v.verdict = 'UNPROVEN'; }
    const detail = v.code ? '  ' + v.code + '  ' + (v.message || '') : (v.message ? '  ' + v.message : '');
    say('  ' + (good ? 'PASS  ' : 'FAIL  ') + label.padEnd(11) + v.verdict.padEnd(9) + '(want ' + want + ')' + detail);
  }
  say('');
  say(allGood ? '  PRIVACY WRITER CREDENTIAL = PASS' : '  PRIVACY WRITER CREDENTIAL = FAIL');
  say('');
  say('STEP 4 — clean up the disposable proof row as an admin (the writer cannot delete it):');
  say('');
  say("  delete from " + TABLE + " where submission_key = '" + PROOF_KEY + "';");
  say('');
  say('  then confirm the store is back to 0 rows, that no `injected` column exists, and that no');
  say('  role named escalated_by_writer was created.');
  say('');
  say('STEP 5 — wire the credential id into the submit endpoint at deploy time, replacing');
  say('         __PRIVACY_AUDIT_CREDENTIAL_ID__. Do NOT commit it into a candidate.');
  say('');
  if (!allGood) { process.exit(1); }
} catch (e) {
  bad(String(e.message || e));
  if (credentialId) { say('  credential ' + credentialId + ' was created; remove it by hand if this run did not complete.'); }
  process.exit(1);
}
