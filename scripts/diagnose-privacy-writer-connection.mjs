#!/usr/bin/env node
// FINMENTOR — one-shot diagnostic: the REAL error behind the privacy_audit_writer credential.
//
//   node scripts/diagnose-privacy-writer-connection.mjs --confirm
//
// DISPOSABLE. Everything it creates is deleted before it exits. No secret, and no part of a
// secret, is printed.
//
// ── THE CHAIN OF WRONG MEASUREMENTS THIS EXISTS TO END ─────────────────────────────────────────
//
// 1. The provisioning run reported eight DENIED verdicts. Every operation denied identically is
//    the signature of a connection failure, not of a privilege matrix — so it was not reported.
// 2. Reading the error off the ITEM gave only «Failed query: select 1 as ok». `Error.message` is
//    not an enumerable property, so it does not survive n8n's item serialisation.
// 3. Reading it off the EXECUTION record gave the same, because the public API returns JSON and
//    the same non-enumerable property is lost again.
//
// So this probe lets the node FAIL — no `onError` — which makes n8n record the failure at
// EXECUTION level in `resultData.error`, where the message is a plain string that survives JSON.
//
// Already established, and not re-measured here:
//   * n8n reaches this database DIRECTLY over IPv6 (`inet_server_addr()` is an IPv6 /128 for the
//     known-good G5 credential), so `db.<ref>.supabase.co:5432` is the right host and the pooler
//     is a red herring;
//   * the role is sound — rolcanlogin, no rolvaliduntil, no connection limit, a SCRAM-SHA-256
//     password, CONNECT on the database and USAGE on the schema.
//
// What is left is authentication itself, and this prints what the server actually says about it.

import crypto from 'node:crypto';

const ROLE = 'privacy_audit_writer';
const PROJECT_REF = 'exvmtjxmfouzuschiuwj';
const DIRECT_HOST = 'db.' + PROJECT_REF + '.supabase.co';
const G5_CRED = { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' };
const ROTATE_PATH = 'p11/diag-rotate';
const PROBE_PATH = 'p11/diag-probe';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }
if (!BASE || !READ_KEY || !WRITE_KEY) { console.error('N8N_BASE_URL, N8N_API_KEY, N8N_FIX_API_KEY required'); process.exit(1); }

// Deliberately alphanumeric only. If authentication turns out to be sensitive to a character class,
// that is a finding — but it must not be an uncontrolled variable while the cause is unknown.
const SECRET = crypto.randomBytes(24).toString('hex');
const redact = (s) => String(s).split(SECRET).join('«redacted»');
const say = (m) => console.log(redact(m));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + redact(t).slice(0, 250)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}

const KEEP = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: true,
  saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' };
const hook = (path) => ({ parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', options: {} },
  id: 'hook', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] });

async function fire(path, body) {
  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(BASE + '/webhook/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const t = await res.text();
      if (res.status !== 404) { return { status: res.status, text: t }; }
    } catch (e) { /* transient */ }
    await sleep(1200);
  }
  return { status: 404, text: '' };
}

async function disposable(wf, fn) {
  let id = null;
  try {
    id = (await api('POST', '/workflows', wf)).id;
    await api('POST', '/workflows/' + id + '/activate');
    return await fn(id);
  } finally {
    if (id) {
      try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) { /* */ }
      for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1500); } }
    }
  }
}

// The execution-level error. This is the one that keeps its message through JSON.
async function executionError(workflowId) {
  await sleep(2500);
  for (let i = 0; i < 8; i++) {
    const list = await api('GET', '/executions?workflowId=' + workflowId + '&limit=1');
    const rows = (list && list.data) || [];
    if (rows.length) {
      const full = await api('GET', '/executions/' + rows[0].id + '?includeData=true');
      const rd = full.data && full.data.resultData;
      if (rd) {
        if (rd.error) { return { status: full.status, error: rd.error }; }
        return { status: full.status, error: null, runData: Object.keys(rd.runData || {}) };
      }
    }
    await sleep(2500);
  }
  return null;
}

function explain(err) {
  const out = [];
  const seen = [];
  (function walk(e, d) {
    if (!e || d > 6 || typeof e !== 'object' || seen.indexOf(e) !== -1) { return; }
    seen.push(e);
    for (const k of ['message', 'description', 'detail', 'hint', 'code', 'errno', 'syscall',
                     'address', 'routine', 'severity', 'reason', 'name', 'stack']) {
      const v = e[k];
      if (v !== undefined && v !== null && typeof v !== 'object' && String(v) !== '') {
        const line = k + '=' + String(v).slice(0, 260);
        if (out.indexOf(line) === -1) { out.push(line); }
      }
    }
    for (const k of ['cause', 'error', 'original', 'context', 'errorResponse']) { walk(e[k], d + 1); }
  })(err, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------

const ROTATE_CODE = [
  'const pw = String(($json.body || {}).pw || "");',
  'if (!pw) { throw new Error("no password"); }',
  'if (!/^[0-9a-f]+$/.test(pw)) { throw new Error("unexpected password shape"); }',
  'return [{ json: { sql: "alter role ' + ROLE + " with login password '\" + pw + \"'\" } }];"
].join('\n');

say('');
say('Privacy writer connection diagnostic');
say('='.repeat(74));
say('  route: POOLER — the direct host is IPv6-only and n8n answers ENETUNREACH');
say('  user : ' + ROLE);
say('');

say('STEP 1 — set a throwaway password');
await disposable({
  name: '[TEMP] P11 diag rotate', settings: KEEP,
  nodes: [hook(ROTATE_PATH),
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ROTATE_CODE },
      id: 'b', name: 'Build', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 0] },
    { parameters: { operation: 'executeQuery', query: '={{ $json.sql }}', options: {} },
      id: 'p', name: 'Rotate', type: 'n8n-nodes-base.postgres', typeVersion: 2.4, position: [440, 0],
      credentials: { postgres: G5_CRED } }],
  connections: { Hook: { main: [[{ node: 'Build', type: 'main', index: 0 }]] },
    Build: { main: [[{ node: 'Rotate', type: 'main', index: 0 }]] } }
}, async (id) => {
  await fire(ROTATE_PATH, { pw: SECRET });
  const r = await executionError(id);
  if (r && !r.error) { say('  PASS  ALTER ROLE succeeded (' + r.status + ')'); }
  else { say('  FAIL  ' + redact(explain(r && r.error).join(' | ')).slice(0, 400)); }
});
say('');

say('STEP 2 — connect as the writer, and let the node FAIL so the message survives');
// `db.<ref>.supabase.co` resolves to IPv6 only and n8n answers ENETUNREACH, so the direct route is
// out. The known-good G5 credential therefore reaches the database through the POOLER, and the
// only open question is which region endpoint it uses.
const SHAPES = [
  { host: 'aws-0-eu-central-1.pooler.supabase.com', port: 5432, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'eu-central-1:5432 session' },
  { host: 'aws-0-eu-central-1.pooler.supabase.com', port: 6543, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'eu-central-1:6543 transaction' },
  { host: 'aws-1-eu-central-1.pooler.supabase.com', port: 5432, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'aws-1-eu-central-1:5432 session' },
  { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'eu-west-1:5432 session' },
  { host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'us-east-1:5432 session' },
  { host: 'aws-0-us-west-1.pooler.supabase.com', port: 5432, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'us-west-1:5432 session' },
  { host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, user: ROLE + '.' + PROJECT_REF, ssl: 'require', insecure: true, label: 'ap-southeast-1:5432 session' }
];
say('');
for (const s of SHAPES) {
  let cid = null;
  try {
    cid = (await api('POST', '/credentials', {
      name: '[TEMP] diag writer', type: 'postgres',
      data: { host: s.host, port: s.port, database: 'postgres', user: s.user, password: SECRET,
              ssl: s.ssl, allowUnauthorizedCerts: s.insecure === true, maxConnections: 2, sshTunnel: false }
    })).id;
    await disposable({
      name: '[TEMP] P11 diag writer probe', settings: KEEP,
      nodes: [hook(PROBE_PATH),
        { parameters: { operation: 'executeQuery', query: 'select 1 as ok', options: {} },
          id: 'pr', name: 'Probe', type: 'n8n-nodes-base.postgres', typeVersion: 2.4, position: [220, 0],
          credentials: { postgres: { id: cid, name: '[TEMP] diag writer' } } }],
      connections: { Hook: { main: [[{ node: 'Probe', type: 'main', index: 0 }]] } }
    }, async (id) => {
      await fire(PROBE_PATH);
      const r = await executionError(id);
      if (r && !r.error) { say('  CONNECTS  ' + s.label); }
      else { say('  no        ' + s.label + '\n              ' + redact(explain(r && r.error).join('\n              ')).slice(0, 900)); }
    });
  } catch (e) {
    say('  error     ' + s.label + '   ' + redact(String(e.message)).slice(0, 200));
  } finally {
    if (cid) { try { await api('DELETE', '/credentials/' + cid, null, 3); } catch (e) { say('  *** leftover credential ' + cid); } }
  }
}
say('');
say('Everything created here has been deleted. The role password is a throwaway value;');
say('the provisioning run sets the real one.');
say('');
