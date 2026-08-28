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
