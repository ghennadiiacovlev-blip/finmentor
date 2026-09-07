#!/usr/bin/env node
// FINMENTOR — P8.4A-R: COMMITTED replay must be idempotently SUCCESSFUL.
//
//   node qa/lead-intake-committed-replay.test.mjs
//
// Offline. No tenant, no credential, no network.
//
// WHAT THIS GATE IS FOR. Live execution 3791 replayed a submission whose receipt was already
// COMMITTED and got back { ok:false, error_code:'SUBMIT_UNRESOLVED', retryable:true }. Safe --
// no second write, no corruption -- but not idempotent, and `retryable:true` on a permanently
// settled submission is a customer-response failure waiting for the Concierge migration: the
// lead IS captured, the caller retries forever, the customer is never confirmed.
//
// THE DECISION LOGIC IS EXECUTED HERE, NOT PATTERN-MATCHED. Every case below runs the real
// deployed `Receipt Read Verdict` body and the real replay terminal body out of the tracked
// candidate. A gate that greps for a branch cannot tell whether the branch DECIDES correctly,
// which is the entire lesson of the F10 seam.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// FROZEN pre-correction export -- see n8n/history/README.md. Sealing the correction advanced
// the tracked reference to 102 nodes; this gate is about the 100 -> 102 delta, whose input is a
// fact about the past.
const BASE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history',
  'QmIyEW2ZEqKregmN.pre-replay-fix.json'), 'utf8'));
const CAND = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate',
  'lead-intake-committed-replay-candidate.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };
const clone = (v) => JSON.parse(JSON.stringify(v));

const byName = (wf, n) => (wf.nodes || []).find((x) => x.name === n);
const outs = (wf, s) => ((((wf.connections || {})[s] || {}).main) || []).map((br) => (br || []).map((l) => l.node));

const KEY = 'sub_' + '0'.repeat(30) + 'a1';

// Run the real Receipt Read Verdict body against a receipt row set.
function verdict(wf, rows, key) {
  const gate = { __submission_key: key === undefined ? KEY : key, __receipt_required: 1 };
  const $ = (n) => ({ first: () => ({ json: n === 'Receipt Gate' ? gate : {} }), all: () => [] });
  const $input = { all: () => rows.map((r) => ({ json: r })), first: () => ({ json: rows[0] || {} }) };
  return new Function('$', '$input', byName(wf, 'Receipt Read Verdict').parameters.jsCode)($, $input)[0].json;
}
// Run the real replay terminal against a verdict output.
function replayResult(wf, v) {
  const $ = (n) => ({ first: () => ({ json: n === 'Receipt Read Verdict' ? v : {} }) });
  return new Function('$', byName(wf, 'Internal Result (Committed Replay)').parameters.jsCode)($)[0].json;
}
const committedRow = (over) => Object.assign({
  submission_key: KEY, commit_state: 'COMMITTED', canonical_lead_id: 'FIN-1787944699020-596',
  lead_mode: 'new', lead_priority: 'INCOMPLETE', financial_zone: 'UNKNOWN',
  correlation_id: 'P8A-PROOF-NEW-a1'
}, over || {});

console.log('\nFINMENTOR Lead Intake COMMITTED replay\n');
console.log('-- the shape of the correction --');

check('the delta is exactly +2 nodes, one modified body, one rewire', () => {
  eq(BASE.nodes.length, 100, 'the base is not the 100-node post-Write-A graph');
  eq(CAND.nodes.length, 102, 'the candidate is not 102 nodes');
  ['IF Receipt Settled', 'Internal Result (Committed Replay)'].forEach((n) => {
    assert(byName(CAND, n), 'missing added node ' + n);
    assert(!byName(BASE, n), 'node already existed in base: ' + n);
    assert(!byName(CAND, n).credentials, n + ' carries a credential');
  });
  const EXEC = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled', 'onError',
    'retryOnFail', 'maxTries', 'waitBetweenTries'];
  const drifted = BASE.nodes.filter((b) => {
    const c = byName(CAND, b.name);
    return c && EXEC.some((k) => JSON.stringify(b[k]) !== JSON.stringify(c[k]));
  }).map((n) => n.name);
  eq(JSON.stringify(drifted), JSON.stringify(['Receipt Read Verdict']),
    'nodes changed beyond the declared one: ' + drifted.join(', '));
});

console.log('\n-- (1)(3) COMMITTED + canonical_lead_id resolves FROM THE RECEIPT --');

check('(1) COMMITTED with a lead id classifies as SETTLED, and is NOT claimable', () => {
  const v = verdict(CAND, [committedRow()]);
  eq(v.__receipt_settled, 1, 'a settled receipt was not classified settled');
  eq(v.__receipt_read_ok, 0, 'a settled receipt was marked CLAIMABLE — claiming writes');
  eq(v.__receipt_reason, 'COMMITTED_SETTLED', 'wrong reason');
  eq(v.__settled_lead_id, 'FIN-1787944699020-596', 'the settled lead id was not carried');
});

check('(1) the replay terminal returns ok:true with the ORIGINAL canonical lead id', () => {
  const r = replayResult(CAND, verdict(CAND, [committedRow()]));
  eq(r.ok, true, 'the replay did not succeed');
  eq(r.lead_id, 'FIN-1787944699020-596', 'the replay returned a different lead id');
  eq(r.mode, 'new', 'mode lost');
  eq(r.priority, 'INCOMPLETE', 'priority lost');
  eq(r.financial_zone, 'UNKNOWN', 'financial zone lost');
  eq(r.replay, true, 'the response does not declare itself a replay');
  assert(r.retryable === undefined, 'the replay response still carries retryable');
  assert(r.error_code === undefined, 'the replay response still carries an error_code');
});

check('(3) the lead id is the receipts, never invented — a different receipt yields a different id', () => {
  const r = replayResult(CAND, verdict(CAND, [committedRow({ canonical_lead_id: 'FIN-OTHER-1' })]));
  eq(r.lead_id, 'FIN-OTHER-1', 'the terminal does not read the receipt');
});

console.log('\n-- (2)(4) the replay path WRITES NOTHING --');

const WRITE_TYPES = ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.dataTable',
  'n8n-nodes-base.httpRequest', 'n8n-nodes-base.telegram'];

check('(2)(4) nothing reachable from the SETTLED branch can write', () => {
  // Branch-aware: from IF Receipt Settled output 0, follow every edge. If a Sheets, Data Table,
  // HTTP or Telegram node is reachable, the replay can write -- to the Pipeline, or to the
  // receipt itself, which would move it off COMMITTED.
  const seen = new Set(); const q = [...outs(CAND, 'IF Receipt Settled')[0]];
  q.forEach((n) => seen.add(n));
  while (q.length) {
    const cur = q.shift();
    outs(CAND, cur).flat().forEach((n) => { if (!seen.has(n)) { seen.add(n); q.push(n); } });
  }
  const writers = [...seen].filter((n) => {
    const nd = byName(CAND, n);
    return nd && WRITE_TYPES.indexOf(nd.type) !== -1;
  });
  eq(writers.length, 0, 'the replay branch can reach writers: ' + writers.join(', '));
  eq(JSON.stringify([...seen]), JSON.stringify(['Internal Result (Committed Replay)']),
    'the settled branch reaches more than its own terminal: ' + [...seen].join(', '));
});

check('(4) the replay terminal body performs no write and mints no new identity', () => {
  const src = byName(CAND, 'Internal Result (Committed Replay)').parameters.jsCode;
  assert(!/submission_key\s*:/.test(src), 'the replay response emits a submission_key');
  assert(!/correlation_id\s*:/.test(src), 'the replay response mints or echoes a correlation id');
  assert(!/Date\.now|new Date|Math\.random/.test(src), 'the replay terminal mints a new value');
  // It may read exactly one node: the verdict.
  const refs = [...new Set([...src.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
  eq(JSON.stringify(refs), JSON.stringify(['Receipt Read Verdict']),
    'the replay terminal reads something other than the verdict: ' + refs.join(', '));
});

console.log('\n-- (5) COMMITTED without a lead id FAILS CLOSED --');

check('(5) COMMITTED with an empty canonical_lead_id is NOT settled and NOT claimable', () => {
  ['', '   '].forEach((v) => {
    const out = verdict(CAND, [committedRow({ canonical_lead_id: v })]);
    eq(out.__receipt_settled, 0, 'a receipt with no lead id was treated as settled');
    eq(out.__receipt_read_ok, 0, 'it was marked claimable');
    eq(out.__receipt_reason, 'RECEIPT_COMMITTED_WITHOUT_LEAD_ID', 'wrong fail-closed reason');
  });
});

check('(5) identity is never inferred from contact details or a Pipeline lookup', () => {
  // Comments stripped first, for the same reason the hot-path `source` scanner strips them: this
  // node's OWN documentation says a settled receipt must not put "a Pipeline write on the replay
  // path", and a comment-blind scan reported the sentence as the violation it warns against.
  const strip = (s) => s.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const src = strip(byName(CAND, 'Receipt Read Verdict').parameters.jsCode);
  assert(!/email|phone|telegram|Pipeline/i.test(src),
    'the verdict consults contact details or the Pipeline to recover identity');
  // The control: stripping must not blind the check to a real lookup.
  assert(/email|phone|telegram|Pipeline/i.test(strip('// harmless\nconst x = row.email;')),
    'the comment-stripping scanner no longer detects a real identity lookup');
});

console.log('\n-- (6)(7) the untouched semantics --');

check('(6) IN_FLIGHT is still unresolved, still not settled, still not claimable', () => {
  const v = verdict(CAND, [committedRow({ commit_state: 'IN_FLIGHT', canonical_lead_id: '' })]);
  eq(v.__receipt_read_ok, 0, 'IN_FLIGHT became claimable');
  eq(v.__receipt_settled, 0, 'IN_FLIGHT was treated as settled');
  eq(v.__receipt_reason, 'RECEIPT_NOT_READY_IN_FLIGHT', 'the IN_FLIGHT reason changed');
});

check('(7) READY is unchanged: claimable, not settled', () => {
  const v = verdict(CAND, [committedRow({ commit_state: 'READY', canonical_lead_id: '' })]);
  eq(v.__receipt_read_ok, 1, 'READY is no longer claimable');
  eq(v.__receipt_settled, 0, 'READY was treated as settled');
  eq(v.__receipt_reason, 'READY', 'the READY reason changed');
});

check('the missing-receipt invariant is unchanged', () => {
  eq(verdict(CAND, []).__receipt_reason, 'RECEIPT_ABSENT_INVARIANT_BROKEN', 'absence stopped being an invariant break');
  eq(verdict(CAND, []).__receipt_settled, 0, 'absence was treated as settled');
  eq(verdict(CAND, [committedRow(), committedRow()]).__receipt_reason, 'DUPLICATE_RECEIPTS', 'duplicates stopped being caught');
  const wrongKey = verdict(CAND, [committedRow({ submission_key: 'sub_' + '0'.repeat(30) + 'zz' })]);
  eq(wrongKey.__receipt_reason, 'LOOKUP_CONTRACT_VIOLATION', 'a mismatched key stopped being caught');
  eq(wrongKey.__receipt_settled, 0, 'a mismatched key was treated as settled');
});

check('(8) the public webhook path is untouched', () => {
  const a = byName(BASE, 'Webhook'); const b = byName(CAND, 'Webhook');
  eq(JSON.stringify(a), JSON.stringify(b), 'the public webhook node changed');
  eq(JSON.stringify(outs(BASE, 'Webhook')), JSON.stringify(outs(CAND, 'Webhook')), 'the public webhook wiring changed');
  eq(CAND.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').length, 1, 'a second webhook appeared');
  const isTrig = (t) => /trigger$/i.test(String(t)) || String(t) === 'n8n-nodes-base.webhook';
  eq(CAND.nodes.filter((n) => isTrig(n.type)).length, 2, 'the entry-point count changed');
});

check('the correlation guard and the claim path are untouched', () => {
  ['Correlation Guard', 'Receipt Claim', 'Receipt Commit (New)', 'Receipt Commit (Merge)',
    'Receipt Exact Read', 'Internal Result (Unresolved)'].forEach((n) => {
    eq(JSON.stringify(byName(BASE, n)), JSON.stringify(byName(CAND, n)), n + ' changed');
  });
  eq(JSON.stringify(outs(CAND, 'IF Receipt Claimable')[0]), JSON.stringify(['IF Receipt Is Retry']),
    'the CLAIMABLE branch was rewired — READY semantics must not move');
});

console.log('\n-- the mandatory mutation battery --');

function mustRegress(label, mutate, expectation) {
  check('REGRESSES: ' + label, () => {
    const m = mutate(clone(CAND));
    let outcome;
    try { outcome = expectation(m); }
    catch (e) { outcome = 'THREW: ' + e.message; }
    assert(outcome !== true, 'the mutation did NOT regress — the gate would not catch it');
  });
}

// M1: the verdict body reverted to the pre-fix logic.
mustRegress('(M1) Receipt Read Verdict reverted to the pre-fix body', (m) => {
  byName(m, 'Receipt Read Verdict').parameters.jsCode =
    byName(BASE, 'Receipt Read Verdict').parameters.jsCode;
  return m;
}, (m) => {
  const v = verdict(m, [committedRow()]);
  return v.__receipt_settled === 1;
});

// M2: the settled branch removed, not-claimable goes straight back to Unresolved.
mustRegress('(M2) the SETTLED branch removed from IF Receipt Claimable', (m) => {
  m.connections['IF Receipt Claimable'] = {
    main: [
      [{ node: 'IF Receipt Is Retry', type: 'main', index: 0 }],
      [{ node: 'Internal Result (Unresolved)', type: 'main', index: 0 }]
    ]
  };
  return m;
}, (m) => outs(m, 'IF Receipt Claimable')[1][0] === 'IF Receipt Settled');

// M3: the settled branch re-pointed at Unresolved, so a settled receipt gives up anyway.
mustRegress('(M3) IF Receipt Settled true-branch re-pointed at Unresolved', (m) => {
  m.connections['IF Receipt Settled'] = {
    main: [
      [{ node: 'Internal Result (Unresolved)', type: 'main', index: 0 }],
      [{ node: 'Internal Result (Unresolved)', type: 'main', index: 0 }]
    ]
  };
  return m;
}, (m) => outs(m, 'IF Receipt Settled')[0][0] === 'Internal Result (Committed Replay)');

// M4: the fail-closed half removed — a COMMITTED receipt with no lead id resolves anyway.
mustRegress('(M4) COMMITTED without a lead id treated as settled', (m) => {
  byName(m, 'Receipt Read Verdict').parameters.jsCode =
    byName(m, 'Receipt Read Verdict').parameters.jsCode
      .split("if (leadId !== '') {").join('if (true) {');
  return m;
}, (m) => verdict(m, [committedRow({ canonical_lead_id: '' })]).__receipt_settled === 0);

// M5: the replay branch given a writer — the defect this fix must not introduce.
mustRegress('(M5) the settled branch gains an edge to a Pipeline write', (m) => {
  m.connections['Internal Result (Committed Replay)'] = {
    main: [[{ node: 'Save to Pipeline', type: 'main', index: 0 }]]
  };
  return m;
}, (m) => {
  const seen = new Set(); const q = [...outs(m, 'IF Receipt Settled')[0]];
  q.forEach((n) => seen.add(n));
  while (q.length) {
    const cur = q.shift();
    outs(m, cur).flat().forEach((n) => { if (!seen.has(n)) { seen.add(n); q.push(n); } });
  }
  return [...seen].every((n) => {
    const nd = byName(m, n);
    return !nd || WRITE_TYPES.indexOf(nd.type) === -1;
  });
});

// M6: settled conflated with claimable, which would put a WRITE on the replay path.
mustRegress('(M6) settled marked claimable, sending a replay into the claim/write path', (m) => {
  byName(m, 'Receipt Read Verdict').parameters.jsCode =
    byName(m, 'Receipt Read Verdict').parameters.jsCode
      .split('settled = 1;').join('settled = 1; ok = 1;');
  return m;
}, (m) => verdict(m, [committedRow()]).__receipt_read_ok === 0);

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
