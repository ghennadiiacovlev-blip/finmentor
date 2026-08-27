# FINMENTOR — the assertion floor: policy, and why the CI copy was deleted

**Scope:** the mechanism that stops a gate being emptied without the build going red.
**Status:** **FIXED.** One number, one file, one enforcement path, with a mutation test that
proves a coverage drop actually fails the build.

This document is deliberately separate from the runtime logic it describes. Raising a floor is a
routine, frequent edit; changing how floors are *enforced* is not, and the two should not be
read from the same file.

---

## 1. What was wrong

Two places recorded the same number.

| Where | What it said | Enforced by |
|---|---|---|
| `qa/assertion-baseline.json` | per-gate floors **and** a total | `qa/run-all.mjs` |
| `.github/workflows/finmentor-quality-gates.yml` | `ASSERTION_BASELINE: '544'` | a bash step |

By the time P7.3 step 2 measured it, the suite stood at **956** and the workflow's copy still
said **544** — stale across many phases, leaving **412 assertions** of slack. That is more than
the four largest gates combined: an entire gate could have been emptied, and the CI step that
existed to notice would have printed `PASS`.

The number was not wrong because someone chose badly. It was wrong because it was a
**duplicate**, and duplicates drift. Replacing `544` with `956` would have fixed the symptom and
kept the mechanism that produced it.

There was a second, quieter problem: the floor logic lived inline in `qa/run-all.mjs`,
interleaved with process spawning and console output, and **had no test of its own**. The one
thing standing between silent coverage deletion and a green build was the only thing in the repo
nobody checked.

---

## 2. What changed

**The duplicate is gone.** `ASSERTION_BASELINE` has been deleted from the workflow. The CI step
now reads `qa/assertion-baseline.json` — the same file `qa/run-all.mjs` reads — so there is
nothing left to drift *from*.

**The decision procedure was extracted** to `qa/assertion-floor.js` as two pure functions:

| | |
|---|---|
| `evaluateFloors(results, baseline)` | the verdict: per-gate drops, missing floors, removed gates, unreadable tallies, total drop |
| `baselineIsSelfConsistent(baseline)` | `baseline.total` must equal the sum of the per-gate floors, so the two halves cannot disagree |

`qa/run-all.mjs` is now only a caller. Behaviour is unchanged; what changed is that the
behaviour is now reachable by a test.

**The mechanism has a gate:** `qa/assertion-floor.test.mjs`, 20 checks.

---

## 3. The rules

1. **Per-gate floors are the point.** A total-only floor cannot see one gate losing ten checks
   while another gains ten — which is exactly how coverage moves out of the place that needed
   it. The mutation battery pins that case by name.
2. **One-directional.** A fall fails the run. Growth only prints what to raise.
3. **Never lower a floor to turn a red run green.** This cannot be prevented in code, and no
   automation here will do it for you. What *is* enforced: a lowered floor does not mask a
   second gate's loss — there is a mutation for that.
4. **A new gate must be added to `qa/assertion-baseline.json` in the same change** that adds it
   to the runner. A gate with no floor is a gate nobody is watching, and it fails the run.
5. **Removing a gate is as loud as emptying one.** A per-gate floor cannot catch a deleted gate,
   because its row is simply absent from the results — so the recorded gate list is checked too.
6. **`baseline.total` must equal the sum of the per-gate floors.** Both `run-all` and CI refuse
   an incoherent baseline, because a disagreement always resolves in favour of the weaker half.

### Raising the floor

Run `node qa/run-all.mjs`. It prints exactly what to change:

```
NOTE: assertions grew; raise qa/assertion-baseline.json
  - concierge-import-safe.test.mjs: 65 -> 87
  - total: 956 -> 978
```

Edit both the gate's floor and `total`. The self-consistency check will reject you if you
update one and forget the other.

---

## 4. The mutation test, and the seam it needed

§10 asked for proof that a substantial assertion loss fails CI. Unit-testing `evaluateFloors()`
proves the *decision*; it does not prove *the build goes red*. So the gate also spawns
`qa/run-all.mjs` for real against a baseline whose every floor is raised by one — arithmetically
identical to every gate having lost an assertion — and requires a **non-zero exit**.

That needs a way to point the runner at a different baseline, which is
`FINMENTOR_ASSERTION_BASELINE`. It is a **test seam, not a configuration knob**: CI never sets
it, and setting it in CI to dodge a red build would be the single edit this whole mechanism
exists to prevent.

**The recursion, found the honest way.** The gate spawns `run-all`, and `run-all` runs the gate.
The first version of this never terminated. The base case is `FINMENTOR_FLOOR_NESTED=1`: the
nested invocation reports its recorded floor and exits. The outer claim survives intact — the
spawned runner still executes every *other* gate for real, still totals them, and still has to
fail — and only this one gate is short-circuited, to the value that keeps the outer arithmetic
honest rather than to something flattering.

### What the battery covers

| Mutation | Must fail with |
|---|---|
| one gate loses a single assertion | per-gate floor breached |
| the largest gate emptied to zero | per-gate floor breached |
| every gate emptied | total assertions fell |
| **the trade** — one gate −10, another +10 | per-gate floor breached |
| a gate deleted from the runner | gate removed from the runner |
| a gate runs with no recorded floor | no assertion floor recorded |
| a tally that could not be read | unreadable assertion tally |
| a baseline whose total contradicts its gates | not self-consistent |
| a lowered floor masking a second gate's loss | the surviving loss is still reported |
| **end to end**: raised baseline → `run-all` | exit ≠ 0, `assertion floor breached` |
| **end to end**: incoherent baseline → `run-all` | exit ≠ 0, `not self-consistent` |

Plus two controls — a run exactly at the floors, and a run above them — so the battery cannot
pass vacuously.

---

## 5. Current state

| | |
|---|---|
| Gates | **19** |
| Total assertions | **1014** |
| Recorded floor | `qa/assertion-baseline.json`, `total: 1014`, coherent with its 19 per-gate floors |
| Second copy anywhere | **none** — asserted by a check that greps the workflow for a literal `ASSERTION_BASELINE` |
