#!/usr/bin/env node
// FINMENTOR — where a NEW LEAD notification may legitimately be requested from.
//
//   node scripts/verify-new-lead-settlement-authority.mjs
//
// READ ONLY. GETs only. No lead, no execution, no write.
//
// The authority for telling the owner about a new lead must be:
//
//     the FIRST successful transition of the canonical Submission_Receipt to COMMITTED,
//     with mode = new
//
// and NOT "which responder ran" and NOT "the source was the Mini App". This script proves, on the
// live graph, that exactly one point in the workflow has that meaning, that it is reached by every
// route that settles a new lead, and that none of the four non-events can reach it.

const LEAD_INTAKE_ID = 'QmIyEW2ZEqKregmN';
const RECEIPT_TABLE = 'Submission_Receipts';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.N8N_API_KEY;
if (!BASE || !KEY) { console.error('STOPPED: set N8N_BASE_URL and N8N_API_KEY'); process.exit(1); }

let pass = 0;
const fail = [];
const ok = (m) => { pass++; console.log('  PASS  ' + m); };
const bad = (m) => { fail.push(m); console.log('  FAIL  ' + m); };
const want = (c, m) => (c ? ok(m) : bad(m));

const wf = await (await fetch(BASE + '/api/v1/workflows/' + LEAD_INTAKE_ID, { headers: { 'X-N8N-API-KEY': KEY } })).json();
const node = (n) => wf.nodes.find((x) => x.name === n);
const code = (n) => String((node(n) || { parameters: {} }).parameters.jsCode || '');
const targets = (n) => ((wf.connections[n] || {}).main || []).map((br) => (br || []).map((e) => e.node));
function reach(start) {
  const seen = new Set();
  (function walk(n) { if (seen.has(n)) { return; } seen.add(n); targets(n).forEach((br) => br.forEach(walk)); })(start);
  seen.delete(start);
  return seen;
}
const TELEGRAM = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.telegram').map((n) => n.name);

console.log('');
console.log('NEW LEAD SETTLEMENT AUTHORITY — live graph');
console.log('='.repeat(78));
console.log('');

// ── 1. the authority exists, and it is a compare-and-set ──────────────────────────────────────
console.log('THE AUTHORITY');
{
  const claim = node('Receipt Claim');
  const commit = node('Receipt Commit (New)');
  const conds = (n) => ((n.parameters.filters || {}).conditions || []).map((c) => c.keyName + ' ' + c.condition + ' ' + c.keyValue);

  want(claim.parameters.dataTableId.value === RECEIPT_TABLE && commit.parameters.dataTableId.value === RECEIPT_TABLE,
    'the receipt machine is the ' + RECEIPT_TABLE + ' table');
  want(JSON.stringify(conds(claim)).indexOf('commit_state eq READY') !== -1,
    'Receipt Claim is a COMPARE-AND-SET: it updates only a row still in READY');
  want(JSON.stringify(conds(commit)).indexOf('commit_state eq IN_FLIGHT') !== -1,
    'Receipt Commit (New) is a COMPARE-AND-SET: it settles only a row this execution claimed');
  want(String(commit.parameters.columns.value.commit_state) === 'COMMITTED', 'and it settles to COMMITTED');
  want(String(commit.parameters.columns.value.lead_mode) === 'new', 'with lead_mode = new — so the event carries its own mode');
  want(/__commit_updated_rows|updated/i.test(code('Commit Verdict (New)')),
    'Commit Verdict (New) reads the UPDATED ROW COUNT — that is what makes it a first-settlement event');
  want(code('Receipt Gate').indexOf('^sub_[0-9a-f]{32}$') !== -1,
    'the receipt key namespace is pinned to ^sub_[0-9a-f]{32}$');
}
console.log('');

// ── 2. exactly one point in the graph means "first canonical NEW settlement" ───────────────────
console.log('EXACTLY ONE POINT MEANS IT');
{
  const t = targets('IF Committed (New)');
  want(JSON.stringify(t) === JSON.stringify([['Internal Result (New)'], ['Internal Result (Unresolved)']]),
    'IF Committed (New) is the branch: TRUE = settled, FALSE = unresolved');
  want(reach('Receipt Commit (New)').has('IF Committed (New)'), 'and it sits directly downstream of the commit');
  // Not the responder, and not the source.
  const blob = JSON.stringify(wf.nodes.map((n) => n.parameters));
  want(!/source\s*===?\s*['"]telegram_miniapp/.test(code('IF Committed (New)') + code('Commit Verdict (New)')),
    'the settlement event does not test the SOURCE');
  want(node('IF Committed (New)').type === 'n8n-nodes-base.if', 'and it is not a responder node');
}
console.log('');

// ── 3. the four non-events cannot reach it ────────────────────────────────────────────────────
console.log('THE FOUR NON-EVENTS');
{
  // A committed replay is diverted upstream, before the claim.
  const settled = targets('IF Receipt Settled');
  want(JSON.stringify(settled).indexOf('Internal Result (Committed Replay)') !== -1,
    'a COMMITTED receipt is diverted to Internal Result (Committed Replay)');
  want(!reach('Internal Result (Committed Replay)').has('Receipt Commit (New)'),
    'and a committed replay can NEVER reach Receipt Commit (New) — so no second settlement event');
  want(!reach('Internal Result (Retry)').has('Receipt Commit (New)'),
    'nor can a retry settlement');

  // A merge settles on its own path and never touches the NEW commit.
  want(!reach('Receipt Commit (Merge)').has('Receipt Commit (New)'), 'a MERGE settles on its own receipt commit');
  want(!reach('IF Internal (Merge)').has('IF Committed (New)'), 'and a merge never reaches the NEW settlement event');
  want(String(node('Receipt Commit (Merge)').parameters.columns.value.lead_mode) !== 'new',
    'the merge commit does not claim mode = new');

  // Refusals terminate.
  for (const n of ['Internal Result (Unresolved)', 'Internal Result (Invalid)', 'Internal Result (Fault)',
    'Internal Result (Correlation)', 'Internal Result (Infra)']) {
    want(!reach(n).has('IF Committed (New)'), n + ' cannot reach the settlement event');
  }

  // A Pipeline write failure happens BEFORE the commit, and stops.
  want(!reach('Stop: Pipeline Write Failed').has('Receipt Commit (New)'),
    'a Pipeline write failure cannot reach Receipt Commit (New) — no false NEW LEAD is possible');
  want(!reach('Internal Result (PipelineFailed)').has('IF Committed (New)'),
    'and its internal result terminates');
  // Order: the Pipeline write is upstream of the commit, so a lead is in the sheet before it settles.
  want(reach('Save to Pipeline').has('Receipt Commit (New)'),
    'the Pipeline write precedes the settlement, so a settled lead is always a written lead');
}
console.log('');

// ── 4. today, that point notifies nobody ──────────────────────────────────────────────────────
console.log('AND TODAY IT NOTIFIES NOBODY');
{
  const downstream = reach('IF Committed (New)');
  for (const t of TELEGRAM) { want(!downstream.has(t), 'the settlement event does not reach ' + t); }
  want(JSON.stringify(targets('Internal Result (New)')) === JSON.stringify([]), 'Internal Result (New) is terminal');
  // Whereas the public responder does.
  want(reach('Respond New Lead').has('Telegram Lead Alert'),
    'while the PUBLIC RESPONDER does reach Telegram Lead Alert — the authority is the responder, which is the defect');
}
console.log('');

// ── 5. what a dispatch would have to carry ────────────────────────────────────────────────────
console.log('WHAT A RETRY WOULD NEED, AND WHERE IT IS NOT');
{
  const renderer = code('Build Premium Telegram Brief');
  const needs = [...new Set((renderer.match(/item\.[a-z_]{3,}/g) || []).map((s) => s.slice(5)))].sort();
  const pipe = Object.keys(node('Save to Pipeline').parameters.columns.value);
  const missing = needs.filter((f) => pipe.indexOf(f) === -1);
  console.log('        renderer reads ' + needs.length + ' fields; the Pipeline row carries ' + pipe.length + ' columns');
  console.log('        missing from the row: ' + missing.join(', '));
  want(missing.length > 0,
    'the approved renderer CANNOT be faithfully re-fed from the Pipeline row — ' + missing.length + ' fields are absent');
  const crm = Object.keys(node('Save Lead to CRM').parameters.columns.value);
  want(crm.indexOf('raw_json') === -1 || !reach('Receipt Commit (New)').has('Save Lead to CRM'),
    'and the internal route never writes Save Lead to CRM, so no payload copy exists for Mini App or Concierge leads');
  for (const t of ['Telegram Lead Alert', 'Telegram Warm Alert', 'Telegram Incomplete Alert']) {
    want(JSON.stringify(node(t).parameters).indexOf("$('Settings to Object')") !== -1,
      t + ' resolves owner_chat_id through $(\'Settings to Object\') — a hard reference any new host must satisfy');
  }
}

console.log('');
console.log('='.repeat(78));
if (fail.length) {
  console.log('FAILURES (' + fail.length + '):');
  fail.forEach((f) => console.log('  - ' + f));
}
console.log('CHECKS: ' + pass + ' passed' + (fail.length ? ', ' + fail.length + ' FAILED' : '') + '. Nothing was written.');
console.log('');
// exitCode rather than process.exit(): an immediate exit here raced libuv's handle teardown on
// Windows and reported 9 after a clean run, which would make this useless as a gate.
process.exitCode = fail.length ? 1 : 0;
