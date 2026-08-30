#!/usr/bin/env node
// FINMENTOR — freeze the evidence of the FIRST SUCCESSFUL owner submission.
//
//   node scripts/verify-first-successful-submit.mjs
//
// READ ONLY. It issues GETs and nothing else: no workflow is written, no row is inserted, no
// execution is started, and no submission is replayed. It cannot create a lead.
//
// It answers one question — did exactly one of everything happen? — from the stores themselves
// rather than from what the client was told.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const SESSION_TABLE_ID = 'LRme88caqxFzTLqW';
const SUBMIT_ID = 'ELiPdw4mdxQbBaan';
const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';

const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY || '';
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

async function api(path) {
  const r = await fetch(BASE + '/api/v1' + path, { headers: { 'X-N8N-API-KEY': KEY } });
  const t = await r.text();
  if (!r.ok) { return { __error: r.status, __body: t.slice(0, 300) }; }
  try { return JSON.parse(t); } catch (e) { return { __raw: t.slice(0, 300) }; }
}

const line = (s) => console.log(s);
const out = {};

line('');
line('==============================================================================');
line('FIRST SUCCESSFUL SUBMIT — SERVER-SIDE EVIDENCE (read only)');
line('==============================================================================');
line('');

// ── 1. the data tables ─────────────────────────────────────────────────────────────────────────
const tables = await api('/data-tables?limit=100');
const list = (tables && tables.data) || [];
line('DATA TABLES');
for (const t of list) { line('  ' + String(t.id).padEnd(20) + t.name); }
line('');

const byName = (n) => (list.find((t) => t.name === n) || {}).id;
const RECEIPT_TABLE_ID = byName('Submission_Receipts');
const sessionTableId = byName('MiniApp_App_Sessions') || SESSION_TABLE_ID;

// ── 2. app sessions ────────────────────────────────────────────────────────────────────────────
const sessions = ((await api('/data-tables/' + sessionTableId + '/rows?limit=200')) || {}).data || [];
line('MiniApp_App_Sessions — ' + sessions.length + ' row(s)');
for (const s of sessions) {
  line('  app_session_id ' + String(s.app_session_id).slice(0, 22) + '…');
  line('    state        ' + JSON.stringify(s.state));
  line('    lead_id      ' + JSON.stringify(s.lead_id));
  line('    cycle_id     ' + JSON.stringify(s.cycle_id));
  line('    tg user      ' + JSON.stringify(s.telegram_user_id));
  line('    created_at   ' + s.created_at + '   expires_at ' + s.expires_at);
  line('    updated_at   ' + s.updated_at);
  line('    draft bytes  ' + String(s.draft_json || '').length);
}
line('');
out.sessions = sessions;

// The submission key is DERIVED, so it can be recomputed here without being stored anywhere.
const crypto = await import('node:crypto');
const keyFor = (sid) => 'sub_' + crypto.createHash('sha256').update('miniapp:' + String(sid)).digest('hex').slice(0, 32);
line('DERIVED SUBMISSION KEYS');
for (const s of sessions) { line('  ' + keyFor(s.app_session_id) + '   <- ' + String(s.app_session_id).slice(0, 18) + '…'); }
line('');
out.derivedKeys = sessions.map((s) => ({ app_session_id: s.app_session_id, submission_key: keyFor(s.app_session_id) }));

// ── 3. receipts ────────────────────────────────────────────────────────────────────────────────
if (!RECEIPT_TABLE_ID) {
  line('Submission_Receipts — TABLE NOT FOUND BY NAME');
} else {
  const receipts = ((await api('/data-tables/' + RECEIPT_TABLE_ID + '/rows?limit=200')) || {}).data || [];
  line('Submission_Receipts — ' + receipts.length + ' row(s)');
  for (const r of receipts) {
    line('  submission_key   ' + r.submission_key);
    line('    commit_state     ' + JSON.stringify(r.commit_state));
    line('    canonical_lead_id ' + JSON.stringify(r.canonical_lead_id));
    line('    lead_mode        ' + JSON.stringify(r.lead_mode) + '   priority ' + JSON.stringify(r.lead_priority) +
      '   zone ' + JSON.stringify(r.financial_zone));
    line('    claimed_at       ' + JSON.stringify(r.claimed_at) + '   settled_at ' + JSON.stringify(r.settled_at));
    line('    abort_reason     ' + JSON.stringify(r.abort_reason) + '   correlation ' + JSON.stringify(r.correlation_id));
  }
  out.receipts = receipts;
}
line('');

// ── 4. executions ──────────────────────────────────────────────────────────────────────────────
for (const [label, id] of [['submit endpoint', SUBMIT_ID], ['Lead Intake', LEAD_INTAKE_ID]]) {
  const ex = await api('/executions?workflowId=' + id + '&limit=10');
  const rows = (ex && ex.data) || [];
  line('EXECUTIONS — ' + label + ' (' + rows.length + ' recent)');
  for (const e of rows) {
    line('  ' + String(e.id).padEnd(10) + String(e.status).padEnd(10) + (e.startedAt || '') + '  mode=' + e.mode);
  }
  if (!rows.length) { line('  (none — retention is off for this workflow by design)'); }
  out['executions_' + id] = rows.map((e) => ({ id: e.id, status: e.status, startedAt: e.startedAt }));
  line('');
}

mkdirSync(OUT_DIR, { recursive: true });
const f = join(OUT_DIR, 'first-successful-submit-evidence.json');
writeFileSync(f, JSON.stringify(out, null, 2), 'utf8');
line('evidence written to ' + f);
line('');
