// Shared harness for the NEW LEAD ALERT OUTBOX non-production DDL validation.
// NON-PRODUCTION ONLY. It creates and drops databases, roles and synthetic rows.
// It refuses to run against anything that looks like a managed/production endpoint.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UP_SQL = path.join(ROOT, 'db', 'migrations', '0001_new_lead_alert_outbox.up.sql');
export const DOWN_SQL = path.join(ROOT, 'db', 'migrations', '0001_new_lead_alert_outbox.down.sql');
export const UP2_SQL = path.join(ROOT, 'db', 'migrations', '0002_alerts_runtime_logins.up.sql');
export const DOWN2_SQL = path.join(ROOT, 'db', 'migrations', '0002_alerts_runtime_logins.down.sql');
export const UP3_SQL = path.join(ROOT, 'db', 'migrations', '0003_alerts_writer_relay_login.up.sql');
export const DOWN3_SQL = path.join(ROOT, 'db', 'migrations', '0003_alerts_writer_relay_login.down.sql');

export const HOST = process.env.FM_PGHOST || '127.0.0.1';
export const PORT = Number(process.env.FM_PGPORT || 55432);
export const SUPER = process.env.FM_PGSUPER || 'postgres';
export const SUPERPW = process.env.FM_PGPASSWORD || 'fmtest_local_only';

// ---------------------------------------------------------------- safety rail
// A production endpoint must never be reachable from this harness, whatever is in the env.
export function assertNonProduction() {
  const h = String(HOST).toLowerCase();
  const banned = ['supabase.co', 'supabase.com', 'pooler.supabase', 'finmentor.md',
                  'rds.amazonaws', 'azure.com', 'neon.tech', 'render.com'];
  if (banned.some((b) => h.includes(b)) || !(h === '127.0.0.1' || h === 'localhost' || h === '::1')) {
    throw new Error(`REFUSING TO RUN: host ${HOST} is not a local disposable cluster`);
  }
}

export function connect(database, user = SUPER, password = SUPERPW) {
  return new pg.Client({ host: HOST, port: PORT, user, password, database });
}
const OPEN_CLIENTS = new Set();
export async function closeAll() {
  for (const c of [...OPEN_CLIENTS]) { try { await c.end(); } catch {} }
  OPEN_CLIENTS.clear();
}
export async function open(database, user, password) {
  const c = connect(database, user, password);
  await c.connect();
  OPEN_CLIENTS.add(c);
  const origEnd = c.end.bind(c);
  c.end = async () => { OPEN_CLIENTS.delete(c); return origEnd(); };
  // Nothing in this harness may hang: a gate that deadlocks must FAIL, not stall the run.
  await c.query("SET lock_timeout = '20s'");
  await c.query("SET statement_timeout = '90s'");
  await c.query("SET idle_in_transaction_session_timeout = '120s'");
  return c;
}

// A connection with NOTHING set on it. `open` above issues its own lock_timeout and
// statement_timeout so that a deadlocked gate fails instead of hanging -- which is right for
// every gate EXCEPT the ones measuring what a role's own `ALTER ROLE ... SET` delivers to a
// session. Those SETs are `source = session` and they win over `source = user`, so opening a
// runtime login through `open` measures the harness and reports it as the migration. Measured:
// it returned 90s/20s, the harness's own values, and the gate failed for the right reason.
export async function openRaw(database, user, password) {
  const c = connect(database, user, password);
  await c.connect();
  OPEN_CLIENTS.add(c);
  const origEnd = c.end.bind(c);
  c.end = async () => { OPEN_CLIENTS.delete(c); return origEnd(); };
  return c;
}

// Applies a whole migration file as one batch, exactly as an operator would. On failure the
// aborted transaction is ALWAYS closed -- an open aborted transaction holds ACCESS EXCLUSIVE
// locks and turns the next assertion into a hang instead of a failure.
export async function applyBatch(client, sql) {
  try { await client.query(sql); return null; }
  catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return { code: e.code, message: e.message, detail: e.detail };
  }
}

// ------------------------------------------------------------------- results
export class Report {
  constructor() { this.gates = new Map(); this.assertions = 0; this.notes = []; }
  gate(id, title) {
    if (!this.gates.has(id)) this.gates.set(id, { id, title, ok: true, checks: [] });
    const g = this.gates.get(id);
    g.title = title || g.title;
    return {
      ok: (name, cond, detail) => {
        this.assertions++;
        const pass = !!cond;
        if (!pass) g.ok = false;
        g.checks.push({ name, pass, detail: detail === undefined ? null : String(detail) });
        return pass;
      },
      eq: (name, actual, expected) => {
        this.assertions++;
        const pass = JSON.stringify(actual) === JSON.stringify(expected);
        if (!pass) g.ok = false;
        g.checks.push({ name, pass, detail: pass ? null : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}` });
        return pass;
      },
    };
  }
  note(text) { this.notes.push(text); }
  get failed() { return [...this.gates.values()].filter((g) => !g.ok); }
  render() {
    const out = [];
    for (const g of [...this.gates.values()].sort(cmpGate)) {
      out.push(`${g.ok ? 'PASS' : 'FAIL'}  ${String(g.id).padEnd(10)} ${g.title}`);
      for (const c of g.checks) if (!c.pass) out.push(`        x ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
    }
    out.push('');
    out.push(`gates: ${this.gates.size}   failed: ${this.failed.length}   assertions: ${this.assertions}`);
    for (const n of this.notes) out.push(`NOTE  ${n}`);
    return out.join('\n');
  }
}
function cmpGate(a, b) {
  const na = Number(String(a.id).replace(/\D/g, '')) || 0;
  const nb = Number(String(b.id).replace(/\D/g, '')) || 0;
  if (na !== nb) return na - nb;
  return String(a.id).localeCompare(String(b.id));
}

// -------------------------------------------------------------------- helpers
export const readUp = () => fs.readFileSync(process.env.FM_UP_FILE || UP_SQL, 'utf8');
export const readDown = () => fs.readFileSync(process.env.FM_DOWN_FILE || DOWN_SQL, 'utf8');
export const readUp2 = () => fs.readFileSync(process.env.FM_UP2_FILE || UP2_SQL, 'utf8');
export const readDown2 = () => fs.readFileSync(process.env.FM_DOWN2_FILE || DOWN2_SQL, 'utf8');
export const readUp3 = () => fs.readFileSync(process.env.FM_UP3_FILE || UP3_SQL, 'utf8');
export const readDown3 = () => fs.readFileSync(process.env.FM_DOWN3_FILE || DOWN3_SQL, 'utf8');

// Attempts a REAL connection and returns the error instead of throwing. "a PASSWORD NULL role
// cannot authenticate" is not a catalog fact; it is only true if the server refuses the login,
// so the only honest way to assert it is to try. The connection is closed either way.
export async function attemptConnect(database, user, password) {
  const c = connect(database, user, password);
  try { await c.connect(); } catch (e) { return { code: e.code, message: e.message }; }
  try { await c.end(); } catch {}
  return null;
}

export async function expectFail(fn) {
  try { await fn(); return null; }
  catch (e) { return { message: e.message, code: e.code, detail: e.detail }; }
}
export async function rows(c, sql, params) {
  const r = params ? await c.query(sql, params) : await c.query(sql);
  return Array.isArray(r) ? r[r.length - 1].rows : r.rows;
}
export async function one(c, sql, params) { return (await rows(c, sql, params))[0]; }
export async function val(c, sql, params) {
  const r = await one(c, sql, params);
  return r ? r[Object.keys(r)[0]] : undefined;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createFreshDatabase(name) {
  const admin = await open('postgres');
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
  await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
  await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  await admin.end();
}

// Roles are CLUSTER-wide, not per-database: a leftover alerts_* role from an earlier run makes
// the section 8 precondition false and makes DROP OWNED BY report objects in another database.
// The run therefore starts from a genuinely empty slate.
export async function cleanSlate(keepDatabases = []) {
  const admin = await open('postgres');
  const dbs = (await rows(admin, `SELECT datname FROM pg_database
     WHERE datname LIKE 'fm\\_outbox\\_%' AND NOT datistemplate`)).map((r) => r.datname);
  for (const d of dbs) {
    if (keepDatabases.includes(d)) continue;
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [d]);
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(d)}`);
  }
  const leftovers = (await rows(admin, `SELECT rolname FROM pg_roles WHERE rolname LIKE 'alerts\\_%'`)).map((r) => r.rolname);
  for (const r of leftovers) {
    try { await admin.query(`DROP OWNED BY ${quoteIdent(r)} CASCADE`); } catch {}
    try { await admin.query(`DROP ROLE ${quoteIdent(r)}`); } catch {}
  }
  await admin.end();
  return { droppedDatabases: dbs.filter((d) => !keepDatabases.includes(d)), droppedRoles: leftovers };
}
export function quoteIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
