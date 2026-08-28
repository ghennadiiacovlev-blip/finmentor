#!/usr/bin/env node
// FINMENTOR — P8.4A-R: make a COMMITTED replay idempotently SUCCESSFUL.
//
//   node scripts/build-lead-intake-committed-replay.mjs
//
// REPO-ONLY. Reads the tracked production export (the 100-node post-Write-A graph) and writes a
// candidate under n8n/candidate/. Never contacts n8n.
//
// ================================ THE DEFECT ================================
//
// Proven live on 2026-08-28, execution 3791. Replaying a submission whose receipt is already
// COMMITTED returned:
//
//     { ok: false, error_code: 'SUBMIT_UNRESOLVED', retryable: true }
//
// `Receipt Read Verdict` treated ONLY `READY` as claimable; every other state fell through to
// `RECEIPT_NOT_READY_<state>` and routed to `Internal Result (Unresolved)`. That is safe — zero
// Pipeline writes, zero receipt writes, receipt untouched — but it is not idempotent replay, and
// `retryable: true` on a permanently settled submission is actively wrong: a caller that honours
// it retries forever and can never succeed. After the Concierge migration that means the
// customer's lead IS captured while the bot never confirms.
//
// ================================ THE FIX ================================
//
// A COMMITTED receipt carrying a canonical_lead_id is a TERMINAL SUCCESSFUL submission, so the
// replay resolves FROM THE RECEIPT. Settled is kept as a SEPARATE flag from claimable, because
// claiming WRITES and resolving does not — conflating them would put a write on the replay path,
// which is the one thing this fix must not do.
//
//   [Receipt Read Verdict]* -> [IF Receipt Claimable]
//        true  -> [IF Receipt Is Retry]                      (UNCHANGED)
//        false -> <IF Receipt Settled>                       (NEW)
//                   true  -> <Internal Result (Committed Replay)>   (NEW)
//                   false -> [Internal Result (Unresolved)]  (UNCHANGED terminal)
//
// COMMITTED **without** a canonical_lead_id FAILS CLOSED as
// `RECEIPT_COMMITTED_WITHOUT_LEAD_ID`. Identity is never inferred from email, phone or a
// Pipeline search — a receipt that cannot say what it settled has not proven anything.
//
// UNCHANGED, deliberately: READY claim/commit, IN_FLIGHT -> SUBMIT_UNRESOLVED, the missing
// receipt invariant, the correlation guard, the public webhook path, every terminal that
// already existed. The receipt's own correlation_id is NEVER rewritten and Pipeline.request_id
// is never mutated: the original commit correlation stays immutable evidence of the canonical
// write, and a replay attempt does not get to overwrite it.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// FROZEN pre-correction export. The seal advanced the tracked reference to 102 nodes, so
// reading the moving pointer here would splice the fix onto a graph that already has it.
const SOURCE = join(ROOT, 'n8n/history/QmIyEW2ZEqKregmN.pre-replay-fix.json');
const OUT = join(ROOT, 'n8n/candidate/lead-intake-committed-replay-candidate.json');

export const ADDED_NODES = ['IF Receipt Settled', 'Internal Result (Committed Replay)'];
export const ADDED_NODE_IDS = {
  'IF Receipt Settled': 'p84r-01-if-settled',
  'Internal Result (Committed Replay)': 'p84r-02-result-replay'
};
export const MODIFIED_NODES = { 'Receipt Read Verdict': { field: 'parameters.jsCode' } };
export const REWIRED_SOURCES = ['IF Receipt Claimable'];

const VERDICT_CODE = [
  '// ABSENCE IS NEVER AN ANSWER: a current cycle is required to have a preallocated receipt,',
  '// so a missing row is a broken invariant, not permission to proceed.',
  '//',
  '// P8.4A-R: a COMMITTED receipt carrying a canonical_lead_id is a TERMINAL SUCCESSFUL',
  '// submission. It is classified as SETTLED, which is deliberately a SEPARATE flag from',
  '// claimable: claiming WRITES (READY -> IN_FLIGHT) and resolving does not. Conflating them',
  '// would put a Pipeline write on the replay path, which is the defect this fixes, inverted.',
  "const gate = $('Receipt Gate').first().json;",
  "const key = String(gate.__submission_key || '');",
  'const rows = $input.all()',
  '  .map((i) => i.json)',
  "  .filter((r) => r && typeof r === 'object' && String(r.submission_key || '') !== '');",
  '',
  'let ok = 0;',
  "let reason = 'RECEIPT_ABSENT_INVARIANT_BROKEN';",
  'let settled = 0;',
  "let leadId = '';",
  "let mode = '';",
  "let priority = '';",
  "let zone = '';",
  '',
  'if (rows.length === 1 && String(rows[0].submission_key) === key) {',
  "  const state = String(rows[0].commit_state || '').trim();",
  "  if (state === 'READY') { ok = 1; reason = 'READY'; }",
  "  else if (state === 'COMMITTED') {",
  "    leadId = String(rows[0].canonical_lead_id || '').trim();",
  "    if (leadId !== '') {",
  '      settled = 1;',
  "      reason = 'COMMITTED_SETTLED';",
  "      mode = String(rows[0].lead_mode || '');",
  "      priority = String(rows[0].lead_priority || '');",
  "      zone = String(rows[0].financial_zone || '');",
  '    } else {',
  '      // FAIL CLOSED. A receipt that cannot say what it settled has proven nothing, and',
  '      // identity is never inferred from email, phone or a Pipeline search.',
  "      reason = 'RECEIPT_COMMITTED_WITHOUT_LEAD_ID';",
  '    }',
  '  }',
  "  else { ok = 0; reason = 'RECEIPT_NOT_READY_' + (state || 'EMPTY'); }",
  "} else if (rows.length > 1) {",
  "  reason = 'DUPLICATE_RECEIPTS';",
  '} else if (rows.length === 1) {',
  "  reason = 'LOOKUP_CONTRACT_VIOLATION';",
  '}',
  '',
  'return [{ json: Object.assign({}, gate, {',
  '  __receipt_read_ok: ok,',
  '  __receipt_reason: reason,',
  '  __receipt_settled: settled,',
  '  __settled_lead_id: leadId,',
  '  __settled_mode: mode,',
  '  __settled_priority: priority,',
  '  __settled_zone: zone',
  '}) }];'
].join('\n');

const REPLAY_RESULT_CODE = [
  '// P8.4A-R — idempotent replay of a TERMINAL SUCCESSFUL submission.',
  '//',
  '// Reads the receipt and NOTHING else. No Pipeline write, no claim, no state change, no new',
  '// correlation and no new submission_key. The receipt is the authority for what was settled,',
  '// and its correlation_id stays immutable evidence of the original canonical write -- a replay',
  '// attempt does not get to overwrite it or masquerade as it.',
  '//',
  '// Same narrow return contract as the other internal terminals: no stage, no detail, no key.',
  "const v = $('Receipt Read Verdict').first().json;",
  'return [{ json: {',
  '  ok: true,',
  "  lead_id: String(v.__settled_lead_id || ''),",
  "  mode: String(v.__settled_mode || ''),",
  "  priority: String(v.__settled_priority || ''),",
  "  financial_zone: String(v.__settled_zone || ''),",
  '  replay: true',
  '} }];'
].join('\n');

export function buildReplayFix(base) {
  const wf = JSON.parse(JSON.stringify(base));
  const byName = (n) => wf.nodes.find((x) => x.name === n);

  if (wf.nodes.length !== 100) { throw new Error('base is not the 100-node post-Write-A graph: ' + wf.nodes.length); }
  ADDED_NODES.forEach((n) => { if (byName(n)) { throw new Error('node already present: ' + n); } });
  const verdict = byName('Receipt Read Verdict');
  if (!verdict) { throw new Error('anchor node missing: Receipt Read Verdict'); }
  const claimable = byName('IF Receipt Claimable');
  if (!claimable) { throw new Error('anchor node missing: IF Receipt Claimable'); }

  verdict.parameters = Object.assign({}, verdict.parameters, { jsCode: VERDICT_CODE });

  const anchor = claimable.position || [0, 0];
  wf.nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'p84r-settled-cond',
          leftValue: '={{ $json.__receipt_settled }}',
          rightValue: 1,
          operator: { type: 'number', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: ADDED_NODE_IDS['IF Receipt Settled'],
    name: 'IF Receipt Settled',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position: [anchor[0] + 200, anchor[1] + 320]
  });
  wf.nodes.push({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: REPLAY_RESULT_CODE },
    id: ADDED_NODE_IDS['Internal Result (Committed Replay)'],
    name: 'Internal Result (Committed Replay)',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [anchor[0] + 420, anchor[1] + 260]
  });

  // The ONLY rewire: the not-claimable branch now asks "is it settled?" before giving up.
  wf.connections['IF Receipt Claimable'] = {
    main: [
      [{ node: 'IF Receipt Is Retry', type: 'main', index: 0 }],
      [{ node: 'IF Receipt Settled', type: 'main', index: 0 }]
    ]
  };
  wf.connections['IF Receipt Settled'] = {
    main: [
      [{ node: 'Internal Result (Committed Replay)', type: 'main', index: 0 }],
      [{ node: 'Internal Result (Unresolved)', type: 'main', index: 0 }]
    ]
  };

  wf.name = 'FINMENTOR Lead Intake COMMITTED REPLAY FIX CANDIDATE';
  return wf;
}

export const serialize = (wf) => JSON.stringify(wf, null, 2) + '\n';

export function verifyReplayFix(base, cand) {
  const failures = [];
  const bn = (w, n) => w.nodes.find((x) => x.name === n);
  if (cand.nodes.length !== base.nodes.length + 2) { failures.push('node count is not base + 2'); }
  ADDED_NODES.forEach((n) => {
    const node = bn(cand, n);
    if (!node) { failures.push('missing added node ' + n); return; }
    if (node.id !== ADDED_NODE_IDS[n]) { failures.push('added node id drifted: ' + n); }
    if (node.credentials) { failures.push('added node carries a credential: ' + n); }
  });
  // Nothing else may change.
  const EXEC = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled', 'onError',
    'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData', 'continueOnFail'];
  base.nodes.forEach((b) => {
    const c = bn(cand, b.name);
    if (!c) { failures.push('base node vanished: ' + b.name); return; }
    EXEC.forEach((k) => {
      if (JSON.stringify(b[k]) === JSON.stringify(c[k])) { return; }
      if (MODIFIED_NODES[b.name] && k === 'parameters') { return; }
      failures.push('undeclared change on ' + b.name + '.' + k);
    });
  });
  // Trigger surface frozen.
  const isTrig = (t) => /trigger$/i.test(String(t)) || String(t) === 'n8n-nodes-base.webhook';
  if (base.nodes.filter((n) => isTrig(n.type)).length !== cand.nodes.filter((n) => isTrig(n.type)).length) {
    failures.push('trigger count changed');
  }
  return { ok: failures.length === 0, failures };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-lead-intake-committed-replay.mjs');
if (isMain) {
  const base = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const cand = buildReplayFix(base);
  const v = verifyReplayFix(base, cand);
  if (!v.ok) {
    console.error('REFUSING TO WRITE: the replay-fix candidate failed verification.');
    v.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  writeFileSync(OUT, serialize(cand), 'utf8');
  console.log('replay-fix candidate: n8n/candidate/lead-intake-committed-replay-candidate.json');
  console.log('  nodes        : ' + cand.nodes.length + '  (base ' + base.nodes.length + ' + 2)');
  console.log('  added        : ' + ADDED_NODES.join(', '));
  console.log('  modified     : Receipt Read Verdict.parameters.jsCode');
  console.log('  rewired      : IF Receipt Claimable (false branch)');
  console.log('  verification : PASS');
}
