// ============ FINMENTOR — WHICH KEYBOARD SLOTS MAY CARRY A LITERAL STYLE ============
//
// The owner-approved style matrix is per ACTION (`LAA.STYLE`: done -> success, discovery ->
// primary, everything else neutral). Two of the five live keyboards hold their buttons as
// literals, so the matrix applies to them directly. The other three fill fixed slots from
// `$json.kb[row][col]`, and an n8n Telegram node cannot make a parameter key conditionally
// ABSENT — an expression that resolves to nothing yields an empty string, and Bot API answers
// 400 to `style: ""`. That would lose an owner alert, which is worse than a neutral button.
//
// So a slotted button may only carry a style when the ACTION IN THAT SLOT IS THE SAME FOR EVERY
// LEAD STATE THAT CAN REACH IT. This module decides that mechanically instead of by inspection:
// it enumerates the reachable lead states, builds every keyboard the renderer can build, groups
// them the way the live Switch groups them (by shape), and reports, per slot, the set of actions
// that can land there.
//
//   * one possible style  -> the slot is DETERMINED; a literal is exactly correct, always.
//   * more than one       -> the slot is AMBIGUOUS; it stays neutral, and is reported as a gap.
//
// The ambiguity is real and not an artifact of this analysis. `chooseActions` hides `discovery`
// when the lead is already at Discovery Scheduled and hides `docs` at Documents Requested, so a
// four-button keyboard's second row starts with whichever of the two survived.
//
// This module is repo-only: it is read by the gate and by the deploy script so that both compute
// the plan from one source, and it never contacts n8n.

'use strict';

// ── the live renderers, read from production 2026-09-04 ────────────────────────────────────────
//
// Which alert kinds each Telegram node can actually be asked to render. SLA renders `priority`
// only and Follow-up renders `followup` only (each has a single `LAA.keyboard('...')` call). The
// Command Center re-renders whatever the tapped message was, and derives that from the message
// itself via `LAA.originKind(origin_had_done)`, so its edit nodes serve BOTH kinds — which is
// exactly why its four- and three-button shapes are ambiguous where the senders' are not.
const RENDERERS = [
  { workflowId: 'LZ2mvKXbBikmeVTn', workflow: 'SLA Lead Watch', node: 'Telegram SLA Alert', shape: 'KB221', kinds: ['priority'] },
  { workflowId: 'LZ2mvKXbBikmeVTn', workflow: 'SLA Lead Watch', node: 'Telegram SLA Alert (4)', shape: 'KB22', kinds: ['priority'] },
  { workflowId: 'zeLOCuf0K1bkaKl2', workflow: 'Followup Sequence', node: 'Telegram Followup Reminder', shape: 'KB221', kinds: ['followup'] },
  { workflowId: 'zeLOCuf0K1bkaKl2', workflow: 'Followup Sequence', node: 'Telegram Followup Reminder (4)', shape: 'KB22', kinds: ['followup'] },
  { workflowId: 'qF9tonlHHIxc8MDd', workflow: 'Lead Command Center', node: 'Edit Alert (5)', shape: 'KB221', kinds: ['priority', 'new_lead'] },
  { workflowId: 'qF9tonlHHIxc8MDd', workflow: 'Lead Command Center', node: 'Edit Alert (4)', shape: 'KB22', kinds: ['priority', 'new_lead'] },
  { workflowId: 'qF9tonlHHIxc8MDd', workflow: 'Lead Command Center', node: 'Edit Alert (3)', shape: 'KB21', kinds: ['priority', 'new_lead'] }
];

// ── the reachable lead states ──────────────────────────────────────────────────────────────────
//
// Every stored `deal_stage` the CRM compatibility table knows, plus the shapes a historical or
// owner-typed value can take, crossed with every `sla_status` the pipeline writes. The point is
// coverage of the two fields `chooseActions` and `isTerminal` actually read — enumerating more
// columns would not change a single keyboard.
const DEAL_STAGES = [
  '', 'New', 'Incomplete', 'Nurture', 'Contact', 'Contacted', 'Qualified',
  'Documents Requested', 'Documents Received', 'Analysis In Progress',
  'Discovery Scheduled', 'Discovery Done', 'Meeting', 'Proposal Sent', 'Proposal',
  'Negotiation', 'Won', 'Lost', 'Closed',
  // free text the owner can type through `stage <ID> <text>`, and casing/whitespace variants
  'discovery scheduled', '  Documents Requested  ', 'Встреча назначена', 'ceva necunoscut'
];
const SLA_STATUSES = ['', 'Active', 'Overdue', 'At Risk', 'Snoozed', 'Done', 'done', 'Nurture', 'nurture'];

function states() {
  const out = [];
  for (const deal_stage of DEAL_STAGES) {
    for (const sla_status of SLA_STATUSES) { out.push({ deal_stage: deal_stage, sla_status: sla_status }); }
  }
  return out;
}

// ── the analysis ───────────────────────────────────────────────────────────────────────────────

// Every keyboard `kinds` can produce, grouped by the shape the live Switch routes on.
function keyboardsByShape(LAA, kinds) {
  const byShape = {};
  for (const kind of kinds) {
    for (const st of states()) {
      const rows = LAA.keyboard(kind, st, 'FIN-STYLE-SLOT-PROBE');
      const shape = LAA.shape(rows);
      if (shape === 'NONE') { continue; }
      (byShape[shape] = byShape[shape] || []).push({ kind: kind, state: st, rows: rows });
    }
  }
  return byShape;
}

// For one renderer: what can land in each slot, and therefore what a literal may say.
// `slots` is [{ row, col, actions: [...], styles: [...], determined: bool, style: string|null }]
function analyseRenderer(LAA, renderer) {
  const all = keyboardsByShape(LAA, renderer.kinds)[renderer.shape] || [];
  const seen = {};
  for (const k of all) {
    k.rows.forEach(function (row, ri) {
      row.forEach(function (b, ci) {
        const key = ri + ',' + ci;
        const s = seen[key] = seen[key] || { row: ri, col: ci, actions: {}, styles: {} };
        s.actions[b.action] = true;
        // A neutral button has no style key at all; record that as the distinct outcome it is.
        s.styles[b.style || '(neutral)'] = true;
      });
    });
  }
  const slots = Object.keys(seen).map(function (key) {
    const s = seen[key];
    const styles = Object.keys(s.styles).sort();
    const determined = styles.length === 1;
    const only = determined && styles[0] !== '(neutral)' ? styles[0] : null;
    return {
      row: s.row, col: s.col,
      actions: Object.keys(s.actions).sort(),
      styles: styles,
      determined: determined,
      style: only
    };
  }).sort(function (a, b) { return a.row - b.row || a.col - b.col; });
  return { renderer: renderer, reachable: all.length, slots: slots };
}

// The literal style assignments that are provably correct for every reachable state, plus the
// slots that are not — reported rather than silently skipped, because an under-emphasised button
// is a deliberate gap the owner has to see, not an implementation detail.
function deployPlan(LAA) {
  return RENDERERS.map(function (r) {
    const a = analyseRenderer(LAA, r);
    return {
      workflowId: r.workflowId, workflow: r.workflow, node: r.node, shape: r.shape, kinds: r.kinds,
      reachable: a.reachable,
      assignments: a.slots.filter(function (s) { return s.determined && s.style; })
        .map(function (s) { return { row: s.row, col: s.col, style: s.style, action: s.actions[0] }; }),
      ambiguous: a.slots.filter(function (s) { return !s.determined; })
        .map(function (s) { return { row: s.row, col: s.col, actions: s.actions, styles: s.styles }; }),
      slots: a.slots
    };
  });
}

module.exports = {
  RENDERERS: RENDERERS,
  DEAL_STAGES: DEAL_STAGES,
  SLA_STATUSES: SLA_STATUSES,
  states: states,
  keyboardsByShape: keyboardsByShape,
  analyseRenderer: analyseRenderer,
  deployPlan: deployPlan
};
