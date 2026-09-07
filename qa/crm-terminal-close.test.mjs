#!/usr/bin/env node
// FINMENTOR — the owner can CLOSE a lead: Won and Lost, proven offline.
//
//   node qa/crm-terminal-close.test.mjs
//
// Offline. No tenant, no Telegram, no Sheets, no production writes.
//
// WHY THIS GATE EXISTS. Gate 2 found the lifecycle defending its terminal states perfectly and
// unable to enter them. No button emits a close — correct, by owner decision D1, because closing a
// deal is not a one-tap action from an alert — but no typed command executed one either: the live
// parser accepted `won` and `lost` and routed them to update mode, and then `actionOfCommand`
// mapped them to nothing, so the handler refused UNKNOWN_ACTION and wrote zero columns. No lead
// could ever be closed; every lead stayed in the active pipeline for ever, kept qualifying for SLA
// and follow-up chasing, and the funnel could never show a conversion or a loss.
//
// The correction is the smallest one the existing contract allows: two command mappings, two
// column-ownership entries, one build branch. No new stage, no new button, no new column, no new
// terminal marker — `Won` and `Lost` already existed in the CRM resolver, and `close_reason` is
// already a Pipeline column while `deal_value` is not (verified against the live sheet, which is
// why one is written when given and the other is never invented).
//
// This gate holds both halves: that a close now WORKS, and that every protection which made the
// terminal states safe still refuses everything it refused before.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require_ = createRequire(import.meta.url);
const lf = (s) => s.replace(/\r\n/g, '\n');

const { inlineCrmStageResolver } = await import('file://' + join(ROOT, 'scripts', 'lib', 'inline-crm-stage.mjs').replace(/\\/g, '/'));
const CRM = require_(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'));
const SRC = inlineCrmStageResolver(
  lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')),
  lf(readFileSync(join(ROOT, 'n8n', 'src', 'crm', 'stage-map.js'), 'utf8'))
);
const A = new Function(SRC + '\n; return LAA;')();
// The same module WITHOUT the resolver, as the offline harnesses load it.
const A_BARE = new Function(lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')).replace('// __CRM_STAGE_RESOLVER__', '') + '\n; return LAA;')();

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const LEAD = 'FIN-1788432350648-72';
const NOW = '2026-09-04T13:00:00.000Z';
const ACTIVE = { deal_stage: 'Qualified', sla_status: 'Active' };
const NEW_ROW = { deal_stage: 'New', sla_status: 'Active' };

// ── the close is reachable ─────────────────────────────────────────────────────────────────────

check('NEW/ACTIVE -> WON is accepted for the owner', () => {
  eq(A.actionOfCommand('won', ''), 'won', 'won does not map to an action');
  for (const row of [NEW_ROW, ACTIVE]) {
    eq(A.refuseReason('won', row, 'priority'), '', 'a close was refused from ' + row.deal_stage);
    eq(A.refuseReason('won', row, 'new_lead'), '', 'a close was refused from a NEW-LEAD origin');
  }
});

check('NEW/ACTIVE -> LOST is accepted for the owner', () => {
  eq(A.actionOfCommand('lost', ''), 'lost', 'lost does not map to an action');
  for (const row of [NEW_ROW, ACTIVE]) {
    eq(A.refuseReason('lost', row, 'priority'), '', 'a close was refused from ' + row.deal_stage);
    eq(A.refuseReason('lost', row, 'new_lead'), '', 'a close was refused from a NEW-LEAD origin');
  }
});

check('the close writes the stored stage the CRM resolver itself defines', () => {
  eq(A.buildUpdate('won', LEAD, NOW).deal_stage, CRM.STAGE_TO_STORED.WON, 'won stage');
  eq(A.buildUpdate('lost', LEAD, NOW).deal_stage, CRM.STAGE_TO_STORED.LOST, 'lost stage');
});

check('the literal fallback agrees with the resolver, so the two tables cannot drift', () => {
  eq(A_BARE.TERMINAL_STORED.won, CRM.STAGE_TO_STORED.WON, 'won fallback');
  eq(A_BARE.TERMINAL_STORED.lost, CRM.STAGE_TO_STORED.LOST, 'lost fallback');
  eq(A_BARE.buildUpdate('won', LEAD, NOW).deal_stage, A.buildUpdate('won', LEAD, NOW).deal_stage, 'won with and without the resolver');
  eq(A_BARE.buildUpdate('lost', LEAD, NOW).deal_stage, A.buildUpdate('lost', LEAD, NOW).deal_stage, 'lost with and without the resolver');
});

check('the written stage normalises back to the terminal business stage', () => {
  eq(CRM.toBusinessStage(A.buildUpdate('won', LEAD, NOW).deal_stage), 'WON', 'won round-trip');
  eq(CRM.toBusinessStage(A.buildUpdate('lost', LEAD, NOW).deal_stage), 'LOST', 'lost round-trip');
  assert(CRM.isTerminalStage(A.buildUpdate('won', LEAD, NOW).deal_stage), 'won is not terminal after the write');
  assert(CRM.isTerminalStage(A.buildUpdate('lost', LEAD, NOW).deal_stage), 'lost is not terminal after the write');
});

// ── the close leaves the active queues ─────────────────────────────────────────────────────────

// SLA Select (live) skips a row whose sla_status is `done` or `nurture`, AND whose deal_stage
// contains won/lost/closed/nurture/incomplete. The close satisfies both, using the existing
// sla_status value «Done» that the «Обработано» action already writes. No new marker.
const STOP_STAGES = ['won', 'lost', 'closed', 'nurture', 'incomplete', 'закрыт'];
const leavesQueue = (upd) => {
  const stage = String(upd.deal_stage || '').toLowerCase();
  const sla = String(upd.sla_status || '').toLowerCase();
  return STOP_STAGES.some((x) => stage.indexOf(x) !== -1) && (sla === 'done' || sla === 'nurture');
};

check('Won leaves the SLA and follow-up queue, by stage and by sla_status', () => {
  const upd = A.buildUpdate('won', LEAD, NOW);
  eq(upd.sla_status, 'Done', 'won does not close SLA handling');
  assert(leavesQueue(upd), 'a won lead would still be selected for chasing');
});

check('Lost leaves the SLA and follow-up queue, by stage and by sla_status', () => {
  const upd = A.buildUpdate('lost', LEAD, NOW);
  eq(upd.sla_status, 'Done', 'lost does not close SLA handling');
  assert(leavesQueue(upd), 'a lost lead would still be selected for chasing');
});

check('the close introduces no new terminal marker — it reuses the existing sla_status vocabulary', () => {
  const done = A.buildUpdate('done', LEAD, NOW);
  eq(A.buildUpdate('won', LEAD, NOW).sla_status, done.sla_status, 'won invented a new sla_status value');
  eq(A.buildUpdate('lost', LEAD, NOW).sla_status, done.sla_status, 'lost invented a new sla_status value');
});

// ── columns: nothing invented ──────────────────────────────────────────────────────────────────

check('deal_value is never written — there is no such Pipeline column', () => {
  for (const a of ['won', 'lost']) {
    const upd = A.buildUpdate(a, LEAD, NOW, { closeReason: 'x', dealValue: '1000' });
    assert(!Object.prototype.hasOwnProperty.call(upd, 'deal_value'), a + ' invented deal_value');
    assert((A.OWNED[a] || []).indexOf('deal_value') === -1, a + ' claims a deal_value column');
  }
});

check('close_reason is written only when the owner actually supplied one, and is never required', () => {
  eq(A.buildUpdate('lost', LEAD, NOW).close_reason, undefined, 'a reason was fabricated');
  eq(A.buildUpdate('lost', LEAD, NOW, {}).close_reason, undefined, 'a reason was fabricated from an empty opts');
  eq(A.buildUpdate('lost', LEAD, NOW, { closeReason: '   ' }).close_reason, undefined, 'whitespace became a reason');
  eq(A.buildUpdate('lost', LEAD, NOW, { closeReason: ' uat ' }).close_reason, 'uat', 'a supplied reason was not preserved');
  eq(A.refuseReason('lost', ACTIVE, 'priority'), '', 'a close without a reason was refused');
});

check('Won never writes close_reason — it is the Lost column', () => {
  eq(A.buildUpdate('won', LEAD, NOW, { closeReason: 'nope' }).close_reason, undefined, 'won wrote close_reason');
});

check('each close writes ONLY the columns it owns', () => {
  for (const a of ['won', 'lost']) {
    const upd = A.buildUpdate(a, LEAD, NOW, { closeReason: 'uat' });
    const owned = (A.OWNED[a] || []).concat(['lead_id']);
    for (const k of Object.keys(upd)) { assert(owned.indexOf(k) !== -1, a + ' wrote an unowned column: ' + k); }
  }
});

// ── every protection still refuses ─────────────────────────────────────────────────────────────

check('WON -> automated active state is refused', () => {
  for (const to of ['New', 'Qualified', 'Discovery Scheduled', 'Negotiation', 'Proposal Sent']) {
    assert(!CRM.canAutomatedTransition('Won', to), 'an automated transition reopened a won lead to ' + to);
  }
});

check('LOST -> automated active state is refused', () => {
  for (const to of ['New', 'Qualified', 'Discovery Scheduled', 'Negotiation', 'Proposal Sent']) {
    assert(!CRM.canAutomatedTransition('Lost', to), 'an automated transition reopened a lost lead to ' + to);
  }
});

check('WON -> stale rewrite is refused: no owner action survives the close', () => {
  const closed = Object.assign({}, ACTIVE, A.buildUpdate('won', LEAD, NOW));
  for (const a of ['done', 'snooze', 'discovery', 'docs', 'nurture', 'won', 'lost']) {
    eq(A.refuseReason(a, closed, 'priority'), 'TERMINAL', 'a stale ' + a + ' was allowed onto a won lead');
  }
});

check('LOST -> stale rewrite is refused: no owner action survives the close', () => {
  const closed = Object.assign({}, ACTIVE, A.buildUpdate('lost', LEAD, NOW));
  for (const a of ['done', 'snooze', 'discovery', 'docs', 'nurture', 'won', 'lost']) {
    eq(A.refuseReason(a, closed, 'priority'), 'TERMINAL', 'a stale ' + a + ' was allowed onto a lost lead');
  }
});

check('a duplicate WON command is idempotent and safe — refused, zero second write', () => {
  const closed = Object.assign({}, ACTIVE, A.buildUpdate('won', LEAD, NOW));
  eq(A.refuseReason('won', closed, 'priority'), 'TERMINAL', 'a second won was not refused');
  assert(A.alreadyApplied('won', closed), 'a second won is not recognised as already applied');
});

check('a duplicate LOST command is idempotent and safe — refused, zero second write', () => {
  const closed = Object.assign({}, ACTIVE, A.buildUpdate('lost', LEAD, NOW));
  eq(A.refuseReason('lost', closed, 'priority'), 'TERMINAL', 'a second lost was not refused');
  assert(A.alreadyApplied('lost', closed), 'a second lost is not recognised as already applied');
});

check('a closed lead is offered no keyboard at all, in every alert kind', () => {
  for (const a of ['won', 'lost']) {
    const closed = Object.assign({}, ACTIVE, A.buildUpdate(a, LEAD, NOW));
    for (const kind of ['new_lead', 'priority', 'followup']) {
      eq(A.keyboard(kind, closed, LEAD), [], kind + ' offered actions on a ' + a + ' lead');
      eq(A.shape(A.keyboard(kind, closed, LEAD)), 'NONE', kind + ' shape on a ' + a + ' lead');
    }
  }
});

check('legacy Closed still normalises to LOST and keeps every protection', () => {
  eq(CRM.toBusinessStage('Closed'), 'LOST', 'legacy Closed mapping changed');
  assert(CRM.isTerminalStage('Closed'), 'legacy Closed is no longer terminal');
  assert(!CRM.canAutomatedTransition('Closed', 'Qualified'), 'legacy Closed can be reopened');
  eq(A.refuseReason('won', { deal_stage: 'Closed', sla_status: 'Active' }, 'priority'), 'TERMINAL', 'a Closed lead accepted a close');
  assert(A.alreadyApplied('lost', { deal_stage: 'Closed' }), 'Closed is not recognised as already lost');
});

check('the post-write read-back still catches a close that did not land', () => {
  const upd = A.buildUpdate('won', LEAD, NOW);
  assert(A.verifyMutation(upd, { deal_stage: 'Won', sla_status: 'Done' }).ok, 'a landed close reported as failed');
  const bad = A.verifyMutation(upd, { deal_stage: 'Qualified', sla_status: 'Active' });
  assert(!bad.ok && bad.mismatched.indexOf('deal_stage') !== -1, 'a close that did not land reported as success');
});

// ── nothing else moved ─────────────────────────────────────────────────────────────────────────

check('NEW, DISCOVERY, NURTURE, DONE and SNOOZE behaviour is unchanged', () => {
  eq(A.buildUpdate('discovery', LEAD, NOW), { lead_id: LEAD, deal_stage: 'Discovery Scheduled' }, 'discovery changed');
  eq(A.buildUpdate('done', LEAD, NOW), { lead_id: LEAD, sla_status: 'Done', last_contacted_at: NOW }, 'done changed');
  eq(A.buildUpdate('nurture', LEAD, NOW), { lead_id: LEAD, deal_stage: 'Nurture', sla_status: 'Nurture' }, 'nurture changed');
  eq(A.keyboard('new_lead', NEW_ROW, LEAD).flat().map((b) => b.action), ['discovery', 'docs', 'snooze', 'nurture'], 'NEW LEAD action set changed');
  eq(A.keyboard('priority', ACTIVE, LEAD).flat().map((b) => b.action), ['done', 'snooze', 'discovery', 'docs', 'nurture'], 'PRIORITY action set changed');
});

check('the callback contract is untouched — no close is ever emitted as a callback', () => {
  eq(A.callbackData('won', LEAD), '', 'a won callback was invented');
  eq(A.callbackData('lost', LEAD), '', 'a lost callback was invented');
  eq(A.callbackData('done', LEAD), 'done|' + LEAD, 'done callback changed');
  eq(A.callbackData('snooze', LEAD), 'snooze|' + LEAD + '|24', 'snooze callback changed');
  eq(A.callbackData('discovery', LEAD), 'stage|' + LEAD + '|Discovery Scheduled', 'discovery callback changed');
  eq(A.callbackData('docs', LEAD), 'docs|' + LEAD, 'docs callback changed');
  eq(A.callbackData('nurture', LEAD), 'nurture|' + LEAD, 'nurture callback changed');
});

check('UNKNOWN is still fail-safe, and an unknown verb still produces nothing', () => {
  assert(!CRM.canAutomatedTransition('ceva necunoscut', 'Qualified'), 'unknown source transitioned');
  assert(!CRM.canAutomatedTransition('Qualified', 'ceva necunoscut'), 'unknown target accepted');
  for (const bad of ['', 'bogus', 'meeting', 'proposal', 'note', 'delete', 'WON!']) {
    eq(A.actionOfCommand(bad, ''), '', 'an unknown verb produced an action: ' + bad);
    eq(A.buildUpdate(bad, LEAD, NOW), null, 'an unknown verb produced an update: ' + bad);
  }
});

check('a close on an UNKNOWN-stage lead is allowed for the owner and still writes a known stage', () => {
  // An unreadable historical value is exactly the row a human should be able to close.
  const unknown = { deal_stage: 'ceva necunoscut', sla_status: 'Active' };
  eq(A.refuseReason('lost', unknown, 'priority'), '', 'the owner could not close an unknown-stage lead');
  eq(CRM.toBusinessStage(A.buildUpdate('lost', LEAD, NOW).deal_stage), 'LOST', 'the close did not land on a known stage');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
