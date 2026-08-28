# `n8n/history/` — frozen phase inputs

A tracked reference under `n8n/production/` has exactly one job: **describe what production is
now**. `n8n/src/deploy-guard/materializer.js` requires `R(L) == A`, so sealing a cutover
*advances* that file. It is a moving pointer by design.

Which means it cannot also be a phase fixture. A completed phase's input is a fact about the
past: the P7.5R candidate was spliced out of a 33-node export, and no later seal can make that
untrue. Reading the moving reference for it produced exactly the failure this directory
prevents — sealing P7.5R turned the tracked reference into the 45-node post-cutover graph, and
six gates went red claiming the P7.5R cutover math was wrong. The math was fine; the fixture had
moved out from under it.

So: **when a phase closes, its input export is frozen here, and that phase's generator and gates
read the frozen copy.** Only checks that are genuinely about *current* production keep reading
`n8n/production/`.

| File | Frozen at | versionId | Read by |
|---|---|---|---|
| `mppzthlkSJFr6Kle.pre-P7-5R-cutover.json` | pre-P7.5R Concierge, 33 nodes | `2b98eba9-8404-42a1-82cd-9ee0b0cae2f6` | `scripts/build-concierge-issuer-candidate.mjs`, `scripts/build-concierge-cutover.mjs`, `scripts/build-concierge-issuer-import-safe.mjs`, `scripts/materialize-concierge-cutover.mjs`, `qa/cutover.test.mjs`, `qa/materializer.test.mjs`, `qa/concierge-issuer-candidate.test.mjs` |
| `mppzthlkSJFr6Kle.pre-P8-3A-cutover.json` | pre-P8.3A Concierge, 45 nodes | `ff6c8103-6823-4666-86fd-c50d4ec89a01` | `qa/p83a-cutover-policy.test.mjs`, `qa/hot-path.test.mjs`, `qa/materializer.test.mjs` |
| `QmIyEW2ZEqKregmN.pre-write-a.json` | pre-Write-A Lead Intake, 57 nodes | `7108ec2d-410c-4b57-b546-2229dc21c2b8` | `qa/lead-intake-cutover-policy.test.mjs`, `qa/import-safe.test.mjs` |
| `QmIyEW2ZEqKregmN.pre-replay-fix.json` | pre-P8.4A-R Lead Intake, 100 nodes | `2c51b904-fbab-45b6-b60a-d34403777757` | `scripts/build-lead-intake-committed-replay.mjs`, `qa/lead-intake-committed-replay.test.mjs` |
| `mppzthlkSJFr6Kle.pre-write-b.json` | pre-Write-B Concierge, 50 nodes | `1a2e37df-5292-48c6-b7af-a6f63b6eb66d` | `scripts/build-concierge-internal-handoff.mjs`, `qa/concierge-internal-handoff.test.mjs`, `qa/hot-path.test.mjs` |

The `versionId` column is not decoration. `qa/materializer.test.mjs` requires the frozen export's
`versionId` to equal the `preVersionId` on the P7.5R record in `n8n/baseline-seal.json` — so a
frozen copy that is not the state that phase actually deployed from fails a gate rather than
quietly becoming the new history.

These files are classified by `scripts/build-artifact-classification.mjs` alongside
`n8n/production/` and `n8n/candidate/`, and the same rule applies to them:
**no tracked artifact is production-deployable.**

Sealing P8.3A did exactly what this file predicts. The tracked reference advanced from the
45-node pre-cutover graph to the 50-node deployed one, and four gates went red asserting the
P8.3A delta was wrong: the same failure, in the same place, for the same reason. The math was
fine; the fixture had moved again. `qa/materializer.test.mjs` now drives the anchor check from
a table keyed by phase, so a future seal that forgets to freeze its pre-state fails on the
missing entry rather than on arithmetic that merely looks broken.

Write A repeated the lesson a third time, and added one. Sealing it advanced the Lead Intake
reference from 57 nodes to 100, so `qa/lead-intake-cutover-policy.test.mjs` began asserting that a
delta which had just succeeded was wrong. The new one is subtler and worth naming:
`qa/import-safe.test.mjs` splits the candidate's Code nodes into INHERITED (must never drift --
the audit anchor) and GENERATED (changes when the receipt design changes) by asking whether
each node exists in the production reference. Once that reference contained the spliced-in
nodes, every generated node also answered "yes", the generated set collapsed to zero, and the
anchor quietly began covering the exact code it exists to hold apart. It did not go red for
the right reason; it went red on a count. A moving fixture does not only break arithmetic --
it can invert what a check MEANS while it still looks like it is checking something.

The P8.4A-R correction made the count four, and one of them was a GENERATOR rather than a
gate: `scripts/build-lead-intake-receipt-candidate.mjs` still read the moving reference, so after
the Write A seal it would have spliced its +43 nodes onto a graph that already contained
them. It is repointed too. The rule is therefore not "phase gates read frozen inputs" but
**anything that describes a completed delta reads a frozen input** -- the generator that
produces the artifact just as much as the gate that checks it.

Write B added the fifth entry and one refinement worth keeping. Three hot-path checks recorded
WHY the public handoff had to go — caller-asserted provenance, a retried submit with no
idempotency record, a key the Concierge minted but never sent. All three inspected the node
Write B deleted. Repointing them at the frozen copy preserves the argument, but on its own it
would leave three checks describing a world nobody lives in any more and passing forever. So
each one now also asserts FORWARD: the public node is gone, the internal call kept the retry
posture, and the minted key is the key actually sent. **A history check should assert the
history AND the thing history was replaced by** — otherwise it decays into trivia.
