// FINMENTOR — the assertion-floor mechanism, extracted so it can be tested rather than trusted.
//
// WHY THIS FILE EXISTS.
//
// The floor logic lived inside qa/run-all.mjs, interleaved with process spawning and console
// output, which meant the one thing standing between "coverage was silently deleted" and a
// green build had no test of its own. P7.3 step 2 §10 asked for a mutation test proving that a
// substantial assertion loss fails CI. A mutation test needs something to mutate, so the
// decision procedure moved here as a pure function over (results, baseline) and run-all.mjs
// became its caller.
//
// THE SECOND SOURCE OF TRUTH THAT DRIFTED, AND WHY IT IS GONE.
//
// .github/workflows/finmentor-quality-gates.yml carried its own `ASSERTION_BASELINE: '544'`,
// a hand-maintained copy of a number that already lived in qa/assertion-baseline.json. By the
// time P7.3 measured it the suite was at 956 and CI's copy had been stale for many phases —
// 412 assertions of slack, enough for an entire gate to be emptied without CI noticing. The
// number was not wrong because someone chose badly; it was wrong because it was a duplicate,
// and duplicates drift. It has been deleted rather than corrected, and the CI step now reads
// this file's canonical baseline. There is one number, in one place, and raising it is a
// tracked repo change.
//
// ONE-DIRECTIONAL, deliberately. A fall fails the run. Growth only prints what to raise.
// Lowering a floor to turn a red run green is the single edit that defeats the whole file, and
// no automation here will do it for you.

'use strict';

// Evaluates a completed run against the recorded floors.
//
//   results  [{ file, assertions }]   assertions may be null when a tally could not be read
//   baseline { total, gates: { <file>: <floor> } }
//
// Returns { ok, failures[], notes[] }. Never throws on shape: a malformed baseline is a
// FAILURE, not an exception, because an unreadable floor must not be able to pass a build.
function evaluateFloors(results, baseline) {
  const failures = [];
  const notes = [];

  if (!baseline || typeof baseline !== 'object' || !baseline.gates || typeof baseline.gates !== 'object') {
    return { ok: false, failures: ['the assertion baseline is missing or has no `gates` map'], notes: notes };
  }

  const list = Array.isArray(results) ? results : [];

  // A gate whose tally could not be read must not pass. A silently empty run would otherwise
  // look identical to a clean one.
  list.forEach((r) => {
    if (r.assertions === null || r.assertions === undefined) {
      failures.push('unreadable assertion tally: ' + r.file);
    }
  });

  // Every gate that ran needs a recorded floor. A new gate with no floor is a gate nobody is
  // watching.
  list.forEach((r) => {
    if (!Object.prototype.hasOwnProperty.call(baseline.gates, r.file)) {
      failures.push('no assertion floor recorded for ' + r.file + ' — add one to qa/assertion-baseline.json');
    }
  });

  // A gate deleted from the runner cannot be caught by a per-gate floor, because its row is
  // simply absent from the results. Removing a gate must be as loud as emptying one.
  Object.keys(baseline.gates).forEach((file) => {
    if (!list.some((r) => r.file === file)) {
      failures.push('gate removed from the runner: ' + file);
    }
  });

  // The per-gate floors are the point. A total-only floor cannot see one gate losing ten
  // checks while another gains ten, which is exactly how coverage moves out of the place that
  // needed it.
  list.forEach((r) => {
    const floor = baseline.gates[r.file];
    if (floor === undefined || r.assertions === null || r.assertions === undefined) { return; }
    if (r.assertions < floor) {
      failures.push('per-gate floor breached: ' + r.file + ': ' + r.assertions + ' < ' + floor);
    } else if (r.assertions > floor) {
      notes.push(r.file + ': ' + floor + ' -> ' + r.assertions);
    }
  });

  const total = list.reduce((n, r) => n + (r.assertions || 0), 0);
  const floorTotal = typeof baseline.total === 'number' ? baseline.total : 0;
  if (total < floorTotal) {
    failures.push('total assertions fell from ' + floorTotal + ' to ' + total);
  } else if (total > floorTotal) {
    notes.push('total: ' + floorTotal + ' -> ' + total);
  }

  return { ok: failures.length === 0, failures: failures, notes: notes, total: total };
}

// The recorded total must equal the sum of the recorded per-gate floors. Without this the two
// halves of the baseline can disagree, and a disagreement always resolves in favour of the
// weaker one.
function baselineIsSelfConsistent(baseline) {
  if (!baseline || !baseline.gates) { return { ok: false, reason: 'no gates map' }; }
  const sum = Object.keys(baseline.gates).reduce((n, k) => n + baseline.gates[k], 0);
  if (baseline.total !== sum) {
    return { ok: false, reason: 'baseline.total is ' + baseline.total + ' but the per-gate floors sum to ' + sum };
  }
  return { ok: true };
}

module.exports = { evaluateFloors, baselineIsSelfConsistent };
