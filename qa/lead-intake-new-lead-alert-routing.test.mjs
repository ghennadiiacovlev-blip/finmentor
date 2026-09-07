#!/usr/bin/env node
// FINMENTOR — who gets told about a new lead, and why the internal routes are silent.
//
//   node qa/lead-intake-new-lead-alert-routing.test.mjs
//
// Offline. Reads the tracked candidate export of Lead Intake and asserts the routing as it IS,
// alongside the constraints any fix has to satisfy. No tenant, no network, no lead.
//
// ── WHAT THIS GATE IS ──────────────────────────────────────────────────────────────────────────
//
// Defect 2 is not a missing connection. It is a missing AUTHORITY: the alert hangs off the public
// HTTP responder rather than off canonical settlement, so which route a lead arrived by decides
// whether the owner hears about it. This gate pins that shape so it cannot drift further, and pins
// the four facts any remediation must respect. Three of its assertions describe the OPEN defect and
// are expected to be inverted by the pass that fixes it — deliberately, so the fix has to come here
// and say so rather than quietly changing behaviour.
//
// ── THE MEASURED HAZARD BEHIND IT ──────────────────────────────────────────────────────────────
//
// Measured on the live tenant, 2026-08-30, with disposable probe workflows (created, run, deleted):
// a sub-workflow called with waitForSubWorkflow:true returns the output of the LAST node to finish,
// and depth beats connection order.
//
//     Result listed first, 4-deep side branch second  -> caller received SIDE4-deepest
//     4-deep side branch first, Result listed second  -> caller received SIDE4-deepest
//     both branches depth 1                           -> caller received the LAST-LISTED branch
//
// So hanging the four-node alert chain (Restore -> Route -> Build -> Telegram) beside
// `Internal Result (New)` would hand the submit endpoint the Telegram node's output instead of
// {ok, lead_id, mode, priority, financial_zone}. A committed lead would be reported to the client
// as an unresolved submission. That is why "just connect the Telegram node to the other branch" is
// not available, and it is the reason this gate exists rather than a one-edge patch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WF = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'lead-intake-premium-source-candidate.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const node = (n) => WF.nodes.find((x) => x.name === n);
const code = (n) => String((node(n) || { parameters: {} }).parameters.jsCode || '');
const feedersOf = (t) => {
  const out = [];
  for (const [src, c] of Object.entries(WF.connections)) {
    (c.main || []).forEach((br) => (br || []).forEach((e) => { if (e.node === t) { out.push(src); } }));
  }
  return out;
};
const targetsOf = (n) => ((WF.connections[n] || {}).main || []).map((br) => (br || []).map((e) => e.node));
// Everything reachable downstream of a node, following every output.
function reach(start) {
  const seen = new Set();
  (function walk(n) {
    if (seen.has(n)) { return; }
    seen.add(n);
    targetsOf(n).forEach((br) => br.forEach(walk));
  })(start);
  seen.delete(start);
  return seen;
}
const TELEGRAM = WF.nodes.filter((n) => n.type === 'n8n-nodes-base.telegram').map((n) => n.name);

console.log('Lead Intake — NEW LEAD alert routing');
console.log('');

// ── the alert chain, as it is ─────────────────────────────────────────────────────────────────

check('every owner alert hangs off ONE switch, fed from ONE context restorer', () => {
  eq(JSON.stringify(feedersOf('Telegram Lead Alert')), JSON.stringify(['Build Premium Telegram Brief']), 'premium alert feeder');
  eq(JSON.stringify(feedersOf('Build Premium Telegram Brief')), JSON.stringify(['Route by Lead Priority']), 'premium builder feeder');
  eq(JSON.stringify(feedersOf('Route by Lead Priority').sort()), JSON.stringify(['IF Escalated', 'Restore Lead Context']), 'switch feeders');
  eq(JSON.stringify(feedersOf('Restore Lead Context')), JSON.stringify(['Respond New Lead']), 'restorer feeder');
});

check('OPEN DEFECT — alert authority is the HTTP responder, not canonical settlement', () => {
  // `Respond New Lead` is on the FALSE branch of IF Internal (New): the public webhook path.
  // So "did the owner hear about this lead" is decided by which responder ran.
  eq(JSON.stringify(targetsOf('IF Internal (New)')),
    JSON.stringify([['Receipt Commit (New)'], ['Respond New Lead']]),
    'the internal/public split');
  assert(reach('Respond New Lead').has('Telegram Lead Alert'), 'the public path no longer alerts');
});

check('OPEN DEFECT — the internal committed path reaches no alert at all', () => {
  // Mini App and Concierge both arrive here. When this is fixed, this assertion inverts.
  const downstream = reach('Receipt Commit (New)');
  for (const t of TELEGRAM) {
    assert(!downstream.has(t), 'the internal path now reaches ' + t + ' — if that is the fix, invert this assertion');
  }
  eq(JSON.stringify(targetsOf('Internal Result (New)')), JSON.stringify([]), 'Internal Result (New) is terminal');
});

check('OPEN DEFECT — and it reaches none of the other five post-response side effects', () => {
  // The alert is the reported defect, but it is not alone: the internal route skips the whole
  // post-response fan-out. Recorded so a fix that restores only the alert is a deliberate choice.
  const downstream = reach('Receipt Commit (New)');
  for (const n of ['Save Lead to CRM', 'Explode Answers', 'Build Intake Activity', 'Build Dashboard Row', 'AI Gate']) {
    assert(!downstream.has(n), 'the internal path now reaches ' + n + ' — update this gate deliberately');
  }
});

// ── the constraints any fix must satisfy ──────────────────────────────────────────────────────

check('CONSTRAINT — the alert builders read $json only, so any feeder can drive them', () => {
  for (const n of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert']) {
    const refs = code(n).match(/\$\('[^']+'\)/g) || [];
    eq(refs.length, 0, n + ' grew a hard node reference: ' + refs.join(', '));
  }
});

check('CONSTRAINT — the restorer is pure context, and reads a node BOTH routes execute', () => {
  const js = code('Restore Lead Context');
  const refs = [...new Set(js.match(/\$\('[^']+'\)/g) || [])];
  eq(JSON.stringify(refs), JSON.stringify(["$('Dedup Guard')"]), 'restorer references');
  // Dedup Guard runs before the internal/public split, so an identical restorer works internally.
  assert(reach('Dedup Guard').has('IF Internal (New)'), 'Dedup Guard no longer precedes the split');
});

check('CONSTRAINT — reusing Restore Lead Context would restore FIVE other side effects too', () => {
  // It fans out to six consumers. A fix that feeds the internal route into it does not add an
  // alert; it adds a CRM write, a Lead_Answers explode, an activity row, a dashboard row and an
  // AI plan. That may be desirable, but it is not "the minimum routing change".
  const t = targetsOf('Restore Lead Context')[0] || [];
  eq(t.length, 6, 'the restorer fan-out changed; re-read before reusing it');
  assert(t.indexOf('Route by Lead Priority') !== -1, 'the alert route left the fan-out');
});

check('CONSTRAINT — Internal Result (New) ignores its input, so it is safe to converge into', () => {
  const js = code('Internal Result (New)');
  assert(js.indexOf('$input') === -1, 'the result node now depends on its input item');
  assert(js.indexOf("$('Dedup Guard')") !== -1, 'the result node no longer reads Dedup Guard');
  for (const k of ['ok', 'lead_id', 'mode', 'priority', 'financial_zone']) {
    assert(js.indexOf(k) !== -1, 'the internal return contract lost ' + k);
  }
});

check('CONSTRAINT — the COLD output of the alert switch goes nowhere', () => {
  // Any convergence design has to answer for it: a COLD lead routed through the switch would
  // never reach a convergence point, and the caller would get nothing back.
  const outs = targetsOf('Route by Lead Priority');
  eq(outs.length, 4, 'the switch output count changed');
  eq(JSON.stringify(outs[2]), JSON.stringify([]), 'the COLD output is no longer empty');
});

// ── what must stay true whatever the fix is ───────────────────────────────────────────────────

check('a committed REPLAY reaches no alert and no side effect', () => {
  for (const n of ['Internal Result (Committed Replay)', 'Internal Result (Retry)']) {
    eq(JSON.stringify(targetsOf(n)), JSON.stringify([]), n + ' is no longer terminal');
  }
});

check('a refusal reaches no alert', () => {
  for (const n of ['Internal Result (Unresolved)', 'Internal Result (Invalid)', 'Internal Result (Fault)',
    'Internal Result (Correlation)', 'Internal Result (Infra)', 'Internal Result (PipelineFailed)']) {
    const d = reach(n);
    for (const t of TELEGRAM) { assert(!d.has(t), n + ' now reaches ' + t); }
  }
});

check('a MERGE reaches no NEW LEAD alert except through the escalation gate', () => {
  // Merges are not new leads. The one path that does alert is IF Escalated, which is a deliberate
  // existing behaviour and not a NEW LEAD claim.
  const merged = targetsOf('Restore Lead Context (Merged)')[0] || [];
  assert(merged.indexOf('Route by Lead Priority') === -1, 'the merge path now alerts directly');
  assert(merged.indexOf('IF Escalated') !== -1, 'the escalation gate left the merge path');
});

check('a Pipeline write failure cannot reach a NEW LEAD alert', () => {
  const d = reach('Stop: Pipeline Write Failed');
  for (const t of TELEGRAM) { assert(!d.has(t), 'a failed Pipeline write now reaches ' + t); }
  // And the responder for it is its own, not the new-lead one.
  assert(feedersOf('Respond Pipeline Failed').length > 0, 'the failure responder lost its feeder');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
}
console.log('ASSERTIONS: ' + pass + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
process.exit(failures.length ? 1 : 0);
