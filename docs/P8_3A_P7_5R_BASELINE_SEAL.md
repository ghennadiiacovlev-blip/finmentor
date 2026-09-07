# FINMENTOR — P8.3A §8: sealing the P7.5R baseline

**Audience:** whoever runs the next Concierge deployment.
**Scope:** repository only. No production write, no API key read, no `fetch()` in the sealing path.

---

## VERDICT

**The P7.5R baseline is SEALED, and the seal is a proof rather than a rubber stamp.** The next
deployment of `mppzthlkSJFr6Kle` is no longer refused on baseline grounds.

Two things were found on the way there, and both mattered more than the seal itself:

1. **The fail-closed rule had no caller.** §8 shipped `preflightSealCheck` as a library function
   with a unit test. No deploy path invoked it. What was actually blocking the P8.3A cutover was
   a *test asserting the record was unsealed* — not a gate. It is now a stage inside
   `materializeDeployment`, fail-closed on absence, so every driver inherits it.
2. **Six gates went red for succeeding.** Sealing advanced the tracked reference from 33 nodes to
   45, and the gates that verify the P7.5R cutover arithmetic read that reference as their
   fixture. They were not wrong; their fixture moved. Frozen inputs now live in `n8n/history/`.

---

## WHAT WAS PROVED BEFORE ANYTHING WAS WRITTEN

`A_next = R(L_post)` is accepted for one reason only: `L_post` is the target that was approved.
Never because it is live, never because it is newer. The acceptance test is offline-computable,
which is what makes it a proof:

At P7.5R time `R(L_pre) == A` held. The materializer takes values from `B` only on the paths the
delta names and everything else from its base document, so redacting the approved target gives
the same result whether it was applied to `L_pre` or to `A`:

```
R(C_approved) == R(applyDelta(delta(A,B), L_pre)) == applyDelta(delta(A,B), A)
```

So the approved target was rebuilt from tracked inputs alone and the fresh live read was required
to match it. `scripts/seal-p75r-baseline.mjs` refuses on any of:

| Guard | Outcome |
|---|---|
| live `versionId` ≠ recorded `postVersionId` | REFUSE — production changed outside this tooling |
| the A→B delta is not the approved P7.5R delta | REFUSE |
| `R(L_current)` ≠ `R(C_approved)` on the safety surface | REFUSE — live is something nobody sanctioned |
| `A_next` carries no redaction markers | REFUSE — the P7.5 defect in reverse |

All four passed. Recorded in `n8n/baseline-seal.json`:

| | |
|---|---|
| status | `SEALED`, `2026-08-27T21:18:45Z` |
| version chain | `2b98eba9…` → `ff6c8103…`, verified intact |
| `R(C_approved)` = rebuilt target | `8bba38d9…` |
| `R(L_current)` = new tracked reference | `1e566077…` |
| node count | 45 |

The two redacted hashes differ because they hash whole documents; the acceptance test compares
the *safety-relevant surface* (`baselineEquivalence`), which is what `matches` records.

---

## THE FAIL-CLOSED RULE NOW HAS A CALLER

`materializeDeployment` gained a `SEAL_PREFLIGHT` stage that runs **before** the input check.

Ordering is load-bearing. An unsealed prior cutover reaching the baseline comparison would be
diagnosed as `BASELINE_DRIFT`, and the obvious repair at that moment is to rebaseline from live
until the check goes quiet — the exact silent rebaseline the model exists to prevent. It is
tested by handing the materializer an input that is *also* invalid on other grounds and requiring
the seal to be the reported reason.

`sealFile` is a **required input**. A caller that supplies none is refused rather than defaulted
to "allowed", which is what makes every driver inherit the gate instead of remembering to ask.

---

## FROZEN PHASE INPUTS — `n8n/history/`

A tracked reference under `n8n/production/` has one job: describe what production is *now*.
`R(L) == A` is what makes it a moving pointer. It therefore cannot also be a phase fixture — a
completed phase's input is a fact about the past, and no later seal can make it untrue.

`n8n/history/mppzthlkSJFr6Kle.pre-P7-5R-cutover.json` is the 33-node pre-cutover export, frozen.
Repointed at it: the P7.5R candidate generator, the P7.5 cutover builder, the P7.3 import-safe
wrapper builder, the P7.5R materialize driver, and the three gates that verify that cutover's
arithmetic. Checks that are genuinely about *current* production still read `n8n/production/`.

The copy is not taken on trust: `qa/materializer.test.mjs` requires its `versionId` to equal the
`preVersionId` on the sealed record, and the tracked reference's `versionId` to equal the
`postVersionId`. A frozen file that is not the state the phase deployed from fails a gate rather
than quietly becoming the new history.

`scripts/build-artifact-classification.mjs` scans the directory on the same terms as the other
two — **no tracked artifact is production-deployable** has to mean every tracked artifact.

---

## GATES THAT CHANGED, AND WHY THAT IS NOT WEAKENING

| Gate | Was | Now |
|---|---|---|
| `materializer` §8 | asserted the repository's own P7.5R record was `BASELINE_UNSEALED` | mechanism tested on a synthetic record; the repository's real state asserted separately, including both ends of the version chain |
| `concierge-issuer` (5.3) | "production contains ZERO `submission_key` references" | production may reference it **only while a SEALED record says a cutover put it there**, and that record's `nodeCount`/`postVersionId` must match the reference |
| `concierge-issuer` (5.4) | `Build Session Row` COLS == 36 | base 36 + the one approved column, and **all three** row builders carry it or none do |
| `bot-sessions-legacy-cycle` (step 12) | no row builder writes any B.2.1-C column | P6R-1 still may not *claim* any of the four; the three that have not shipped still may not be *written* |
| `concierge-issuer` (4.4) | scanned raw `jsCode` for `crypto.` | scans executable lines only |

(5.3)'s own comment had named the condition for changing it: *"the day this fails, production has
been modified and that must be a deliberate, recorded act."* P7.5R is that act, and it is
recorded rather than remembered. Deleting the check would have left the repository unable to tell
a deployed issuer from an undeployed one, so the containment moved instead of disappearing.

(5.4) is stated as `36 + 1` rather than as `37` so a second column arriving later cannot hide
inside a bumped literal. The three builders persist the **same sheet row**, so a column carried by
two of them is not partly shipped — it is blanked by whichever runs last.

### The `crypto` scan was a false positive

The Model-B `Get Bot Session` that P7.5R put into production carries a comment block naming
`crypto.getRandomValues` precisely to record why it must not be used. The executed line is
`require('crypto').randomBytes(16)`. The gate was reading prose, and the cheapest way to make it
green would have been to delete the warning — a gate that punishes documenting its own hazard.

It now strips **whole-line comments only**: stripping from the first `//` on any line would also
cut a real usage sitting after a URL inside a string literal, which is the one thing the check
must never miss. The narrowing is covered by a planted-call mutation (4.4b), so a scan that went
blind would fail rather than pass quietly.

---

## A SECOND DRIFT, FOUND BY THE SEAL

`n8n/production/manifest.json` said the Concierge had 33 nodes, beside a 45-node export, and
nothing noticed. Every check in the drift gate was about the manifest’s *internal* consistency;
none compared it to the files it describes. `nodeCount` and `nodeTypes` are now checked against
each export, and both new checks are mutation-proven rather than asserted.

**`structuralHash` cannot be one of them, and that is a finding rather than a gap.** It
fingerprints the LIVE workflow as the exporter read it from the API; the file written beside it is
then REDACTED. Recomputing it from the tracked artifact differs for **all nine** entries, not only
the changed one — so it is a live-drift fingerprint, refreshable only by
`scripts/export-n8n-production.ps1` against the tenant. **No value was fabricated for it.** What is
checkable offline is that an entry updated *after* the manifest run declares the staleness rather
than presenting a pre-update fingerprint as current, and the Concierge entry now does.

---

## STATE

| | |
|---|---|
| Gates | **25/25**, 1243 assertions (was 1229) |
| Production | **unchanged by this phase.** Nothing was deployed, nothing was written to the tenant |
| P7.5R | **SEALED** |
| P8.3A cutover | no longer blocked on the baseline. Still needs a fresh short-lived n8n key pair |

### Not done here

* `manifest.structuralHash` for `mppzthlkSJFr6Kle` is stale, and is now declared stale rather than
  guessed at. It needs a live export to refresh, which needs an API key.
* The P8.3A cutover itself, and its policy — `CONCIERGE_CUTOVER_POLICY` still describes the
  P7.5R delta. P8.3A adds six nodes and removes one; that policy does not exist yet.
* Everything in `docs/P8_3_CONCIERGE_HARDENING_INTERNAL_HANDOFF.md` §OWNER ACTIONS is unchanged.
