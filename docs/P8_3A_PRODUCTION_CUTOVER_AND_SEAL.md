# P8.3A — Concierge production cutover and baseline seal

**Deployed 2026-08-28. Workflow `mppzthlkSJFr6Kle`, 45 → 50 nodes. Sealed.**

This is the evidence record for the cutover itself. The *design* is in
`P8_3_CONCIERGE_HARDENING_INTERNAL_HANDOFF.md`; the seal that made it deployable is in
`P8_3A_P7_5R_BASELINE_SEAL.md`. This file records what was sent, what came back, and what was
checked on either side.

## What shipped

| | |
|---|---|
| Workflow | `mppzthlkSJFr6Kle` — FINMENTOR Telegram Client Concierge |
| Nodes | 45 → 50 (+6 added, −1 removed) |
| Delta | 6 addNode, 1 removeNode, 4 setNodeField, 9 setConnections, 0 setTopLevel |
| pre versionId | `ff6c8103-6823-4666-86fd-c50d4ec89a01` |
| post versionId | `1a2e37df-5292-48c6-b7af-a6f63b6eb66d` |
| deployedTargetSha | `2d285ed76487ca99e14e08f2b0fbf9f850cd9ff78195d03effd29060022617d2` |
| postLiveRedactedSha | `fc8c8248fb3077c26483698ec946c9f0ff808c4299351af833df7f98be84224b` |
| structuralHash (live) | `16482c31b66dac7b23865624ac90804b0ed8f31e50165c02817dd28dfdc490d3` |

Approved change classes, and nothing else: `HOT_PATH_CONFIG`,
`AUTHORITY_FAILURE_CLASSIFICATION`, `BOT_EVENT_RESILIENCE`, `SESSION_READ_LATENCY`.

Explicitly **not** in this cutover, and verified absent: the Lead Intake internal-route
migration (INTERNAL_HANDOFF), G5, any Supabase mutation, any Mini App activation. `Send Lead to
Intake` is still `httpRequest` on the public route, with URL and body pinned to live rather than
merely unchanged in the candidate.

## The defect this phase closed, twice

`Build Authority Unresolved Event` was the only `Build *Event` node in the graph with **no
outgoing edge**. `AUTHORITY_WRITE_NOT_PERSISTED` — the single operational record of a cycle
issued whose authority never persisted — was therefore constructed once per genuine failure and
discarded. Nothing errored. It was silent.

Wiring it would have been the wrong fix on its own. `Save Bot Event` appends with
`autoMapInputData` over an **empty stored schema**, so under F16 a stray key is not dropped, it
permanently widens the live sheet. The node emitted seven keys of its own, six outside the
twelve-key Bot_Events set, and was saved from writing them only by being disconnected. The
builder was brought onto the contract first; the edge is safe only because of that.

The deploy-time half was the same gap from the other side. P8.3A declared `APPROVED_EDGES` as
"the exact post-cutover edge set" and handed it to a QA assertion only — nothing passed it to the
materializer, so at deploy time it constrained nothing. An added node that grew its *first*
outgoing edge was in neither the fan-in set nor the rewire set and materialized cleanly. Both
halves are now enforced: `pinnedOutEdges` (closed by default — an added or rewired node with
edges and no pin entry is refused) and `protectedFanIn` on `Save Bot Event` (exactly seven named
builders). See commit `dfb7513` and `qa/p83a-cutover-policy.test.mjs` mutations 4c–4f, of which
4e re-opens the coverage hole deliberately.

## Preflight, on fresh live

`R(L) == A` held with **zero executable drift** against the sealed P7.5R baseline. Workflow id,
`active`, trigger count, all nine credential bindings, `webhookId` and `availableInMCP` were
unchanged, and the live `versionId` still equalled the P7.5R `postVersionId` — production had not
moved since the seal.

One recorded discrepancy, benign and worth writing down so it is not re-investigated: a fresh
`sha(R(L))` does **not** equal the seal's `postLiveRedactedSha`. That field is `sha(A)` — the
hash of the tracked reference as written to disk — and `MZ.sha` is a raw `JSON.stringify` of the
whole document. A live read fetched with `excludePinnedData=true` omits `pinData` (present as
`{}` in A) and returns top-level keys in a different order. The only differing top-level key was
`pinData`, which is in `IGNORED_TOP_LEVEL`. **The re-checkable control is
`baselineEquivalence(R(L), A)`, not that hash.**

## Readback, immediately after the PUT

All nineteen checks passed on the in-memory target and again on the readback from production:

Read Settings ABSENT · Hot Path Config PRESENT · pre-reply external round trips **2**
(`Read Bot Sessions → Send Client Message`) · `Save Bot Session` incoming authority-write edges
**1** (`Build Session Row`) · second authority-write path **0** · `Build Authority Unresolved
Event` persists to `Save Bot Event` · `Save Bot Event` best-effort
(`onError=continueRegularOutput`, no retry — `event_id` embeds `Date.now()`, so a retry would
double-write) · `Save Bot Event` fan-in exactly the 7 approved builders · `Read Bot Sessions`
`waitBetweenTries=750` · public Lead Intake handoff unchanged · `x-finmentor-internal-key`
removed · Telegram trigger, credential and `webhookId` unchanged · customer-facing text and
keyboards unchanged · redaction markers 0 · `availableInMCP` false · ambiguous authority
classifier agrees with the module across four cases and authorises no write.

`live executable === approved C_live`: **identical**.

## Seal

`sealBaseline()` re-read production fresh, redacted both sides, and required
`baselineEquivalence(R(C_live), R(L_post))` before returning `A_next`. It would have refused
otherwise — a refused seal being the louder signal, because it means production is something
nobody sanctioned. `matches: true`.

`A_next = R(L_post)` is now the tracked reference. The version chain is intact:
P7.5R `postVersionId` == P8.3A `preVersionId`.

The 45-node pre-P8.3A state is frozen at `n8n/history/mppzthlkSJFr6Kle.pre-P8-3A-cutover.json`.
Sealing advanced the tracked reference, which is exactly what `n8n/history/README.md` predicts,
and four gates went red asserting the P8.3A delta was wrong. The math was fine; the fixture had
moved. `qa/materializer.test.mjs` now drives its anchor check from a phase-keyed table, so a
future seal that forgets to freeze its pre-state fails on the missing entry rather than on
arithmetic that merely looks broken. It also now asserts the chain itself, and that no record is
left `BASELINE_UNSEALED`.

## Rollback

Not needed. The rollback source — the fresh pre-cutover live export — was captured before the
PUT and held outside the repository for the duration. Nothing was written to the tenant except
the single `PUT /workflows/mppzthlkSJFr6Kle`. No create, no activate/deactivate, no `setWebhook`,
no credential change.

## Gates

26/26, 1283 assertions, floors PASS.

## Open items

- **Owner:** revoke the two n8n API keys used for this cutover. They were present in the Windows
  User scope for the session and are not needed again.
- **Owner:** send `/start` to the Concierge bot so wall-clock send → visible reply can be
  classified (<2.0s PREMIUM, 2.0–3.0s ACCEPTABLE, 3–5s DEGRADED, >5s FAIL). No lead submission
  yet.
- **Backlog, not now:** `core.autocrlf=true` with no `.gitattributes` means a `git stash` or
  `git checkout` round-trip of a generated `n8n/candidate/*.json` rewrites it CRLF and fails the
  byte-exact generator↔artifact binding as a misleading "candidate is not stale". Recovery is to
  re-run the generator, never to hand-fix. It bit twice during this phase.
