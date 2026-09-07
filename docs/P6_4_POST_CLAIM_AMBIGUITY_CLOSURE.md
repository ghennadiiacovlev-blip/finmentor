# FINMENTOR — P6.4: F13 post-claim ambiguity, CLOSED LIVE

**Phase:** B.2.1-C live prerequisites, P6.4
**Owner decision:** APPROVED — a post-claim Pipeline failure is `SUBMIT_UNRESOLVED`, the receipt
stays `IN_FLIGHT`, and a retry RECOVERS the same submission rather than creating a new one.
**Status:** **F13 LIVE CLOSED.** Canary `QaxZhxsiaSoOI5bu`, fidelity 15/15, post-claim injection
exec `3640`, same-key retry exec `3642`. Production residue: none.

---

## 1. §2 first — does any ordinary retry mint a fresh key?

**No.** This was traced before a line of F13 code was changed, because if it minted one, the
error code would be the least of the problems: a retry carrying a fresh key bypasses the receipt
entirely and can duplicate a lead that already exists.

Three independent halves, each checked against the artefact that actually runs:

**The gateway never mints and never rotates.** `submit-handler.js` *reads* the key from
authority (`authorityRow.submission_key`) and refuses the submit unless the session carries the
identical one (`SUBMISSION_KEY_DRIFT`). Every `authority.write` in the handler was enumerated:
they carry `lead_*`, `consent_*` and `updated_at`. **None carries `cycle_id` or
`submission_key`.** Pinned by `(P6.4-R2)`, which wraps the injected authority and inspects every
patch offered — so a write silently dropped by a missing column still fails the check.

**The live Concierge mints a cycle only on an explicit new one.** `Get Bot Session` sets a new
`cycle_id` when and only when `reset` is one of:

| trigger | condition |
|---|---|
| `start` | the user sent `/start` |
| `restart` | callback `m|diag` **and** the session carries a finished cycle |
| `bootstrap` | the session has no cycle at all |

No error, retry or unresolved branch reaches any of them. That matches the decision exactly:
a fresh key only for an explicit NEW authoritative cycle.

**And `idempotencyKey()` is retired** — it throws by design (`use the authoritative
submission_key`), so no code path can derive a second key for one submission.

Proven by execution, not by reading, in `qa/miniapp-submit.test.mjs`:

| Check | What it does |
|---|---|
| `P6.4-R1` | an ambiguous submit leaves `cycle_id` and `submission_key` untouched on authority |
| `P6.4-R2` | **no** authority write on any path carries either field |
| `P6.4-R3` | a second attempt on the same session hands Lead Intake the **same** key |
| `P6.4-R4` | **MUTATION** — rotating the key makes `R3` fail, so `R3` is not vacuous |
| `P6.4-R5` | one attempt makes exactly one Lead Intake call; unresolved maps to 503 |

`R4` is the one that matters. An equality assertion that has never been shown to fail is a
decoration, not a test.

**One honest caveat.** After a post-claim failure the session *does* satisfy
`carriesFinishedCycle` (consent is stamped before handoff), so a user who presses `m|diag`
afterwards gets a genuinely new cycle and a new key. That is **explicit restart semantics**,
which the decision permits — it is a user asking for a new submission, not an automatic retry
inventing one.

## 2. §3–§4 — the terminals, and the receipt they must not touch

Changed in the deterministic generator, never in a live graph:

```js
terminalGate('PipelineFailed', 'Respond Pipeline Failed', -220, 200, "'SUBMIT_UNRESOLVED'", true);
terminalGate('MergeFailed',    'Respond Merge Failed',    -220, 200, "'SUBMIT_UNRESOLVED'", true);
```

`retryable: true` is retained and is **not** a licence to resubmit: it tells the caller the
submission is recoverable, and recovery means the same key resolving server state.

`Internal Result (Infra)` was **not** converted. `Read Settings` fails long before the receipt
is touched, so `CRM_UNAVAILABLE` is an honest ordinary failure; converting it would destroy
information rather than preserve it. The gate derives that distinction from the graph — the
post-claim terminals are computed as *the Internal Result nodes reachable from the error output
of a Pipeline write*, not from a hand-written list.

Six checks in `qa/internal-route-contract.test.mjs` §6:

- the two write-failure terminals are post-claim and `Infra` is not — **derived by traversal**
- both return the reserved code, compared **against the rule object**, so the two cannot drift
- neither leaks `stage`, `detail`, `submission_key`, `commit_state`, `mode` or `lead_id`; the
  returned field set is exactly `{ok, error_code, retryable}`
- **§4 structurally:** both terminals are dead ends, and no receipt-writing node
  (`Receipt Claim`, `Receipt Commit (New)`, `Receipt Commit (Merge)`,
  `Receipt Retry Settlement`) is reachable from either Pipeline writer's error output — so
  nothing can move the receipt out of `IN_FLIGHT` on a post-claim failure
- the **public** responders still return `PIPELINE_WRITE_FAILED` / `PIPELINE_MERGE_FAILED`
- **MUTATION** — a reverted terminal is detected

## 3. §9 — the live proof

Superseding canary `QaxZhxsiaSoOI5bu` deployed from the regenerated artifact: 8/8 post-deploy
assertions, **15/15 fidelity** (44 Code nodes, 99,824 characters byte-identical), driver
repointed. `Save to Pipeline` was then pointed at a document id that does not exist — a target
that **cannot write customer data** — and the route run with a real gateway payload against a
receipt preallocated `READY`.

Exec `3640`, the full path:

```
… Receipt Exact Read -> Receipt Read Verdict -> IF Receipt Claimable -> IF Receipt Is Retry
   -> Receipt Claim -> Claim Verdict -> IF Claim Won -> IF Is New -> Build Pipeline Row
   -> Save to Pipeline -> IF Internal (PipelineFailed) -> Internal Result (PipelineFailed)
```

| Requirement | Observed |
|---|---|
| receipt `READY → IN_FLIGHT` | **yes** — `Receipt Claim` ran, state read back `IN_FLIGHT` |
| no trusted Pipeline success | **yes** — `out[0]: 0 items`, `out[1]: 1 item`, `{"error":"The resource you are requesting could not be found"}` |
| terminal | **`Internal Result (PipelineFailed)`** |
| caller result | **`{ok:false, error_code:"SUBMIT_UNRESOLVED", retryable:true}`** |
| receipt final state | **`IN_FLIGHT`**, `correlation_id: req-p64-POSTCLAIM-1`, no lead |
| no raw throw | execution `success`, no top-level error |
| no ordinary code | `Respond Pipeline Failed` **never executed** |
| no settlement | `Receipt Commit (New)`, `Receipt Retry Settlement` **never executed** |
| Pipeline rows written | **zero** |

This is also the **second** live observation of the F11 fix, on a *different* error-output gate
than P6.3's — `IF Internal (PipelineFailed)` received an error item with `__internal`
`undefined` and routed internally anyway. Two of the three terminals are now observed live.

**`MergeFailed` was not injected**, per the instruction not to write a customer-shaped row
merely for coverage: reaching the merge path requires an existing Pipeline row to merge into.
It is covered structurally — same gate expression, same dead-end terminal, both asserted — and
the limitation is stated rather than hidden.

## 4. §10 — the same-key retry

The same logical submission, same `submission_key`, same correlation, replayed through the
healthy canary. Exec `3642`:

```
… Receipt Exact Read -> Receipt Read Verdict -> IF Receipt Claimable -> Internal Result (Unresolved)
```

| Requirement | Observed |
|---|---|
| same cycle / same key | **yes** — byte-identical case, `Receipt Exact Read` saw `commit_state: IN_FLIGHT` |
| zero new Pipeline write | **yes** — `Save to Pipeline` and `Update Pipeline (Merge)` never executed |
| no second claim | **yes** — `Receipt Claim` never executed |
| result | **`SUBMIT_UNRESOLVED`, retryable** |
| receipt after | still `IN_FLIGHT`, unchanged |

The receipt refused the second claim because it was no longer `READY`. That is the mechanism
doing exactly what it exists for: **the ambiguity survived the retry instead of being resolved
by guessing.**

## 5. §5–§7 — automatic `IN_FLIGHT` reconciliation: **DESIGN ONLY, NOT SAFE**

Investigated as instructed, and the answer is not to build it. Three findings, any one of which
is disqualifying on its own.

**(a) `request_id` is overwritten by a later genuine merge.** `build-merge-update.js`:

```js
upd.request_id = advance(ex.request_id, item.request_id);
// advance = (old, new) => (genuine && new !== '') ? new : old
```

So a Pipeline row's `request_id` is **not stable**. A later, unrelated submission that merges
onto the same lead replaces it. Therefore a `receipt.correlation_id → Pipeline.request_id`
lookup returning **0 rows has two indistinguishable causes**: the write never landed, or it
landed and a later merge overwrote the correlation. Zero rows is **not** evidence of absence.
`docs/PHASE_B2_1C_G1_DURABLE_RECOVERY_PLAN.md` §6.1 already flagged this; it is now the
decisive fact.

**(b) the Pipeline row cannot settle the receipt.** The 59 columns carry `lead_id`,
`request_id`, `priority` and `financial_zone` — but **no `mode` column and no
`submission_key`**. A receipt commit needs `lead_mode`. It cannot be read, and per the decision
it must not be invented.

**(c) a Pipeline scan is not a lookup.** `RECOVERY_ADAPTER_CONTRACT.requirements` says it in as
many words: *"indexed by the submission key: a scan over Pipeline rows is not a lookup and is
not acceptable"*. Reading the sheet and filtering by `request_id` is exactly that scan.

The asymmetry is worth stating precisely, because it is the useful part: **one row IS positive
evidence** the write landed (a later merge can only replace our id with a different one, never
fabricate ours), while **zero rows is no evidence at all**. Recovery is therefore sound in the
direction that confirms, and unsound in the direction that would release a claim — which is the
only direction that could cause a duplicate.

Answers to the three cases as asked:

| State | Verdict |
|---|---|
| `IN_FLIGHT` + **0** Pipeline rows | **CANNOT_ANSWER / `SUBMIT_UNRESOLVED`.** No evidence the write did not commit. Never `READY`, never resubmit. |
| `IN_FLIGHT` + **1** Pipeline row | canonical write exists — but `lead_mode` is unreadable, so it cannot settle to `COMMITTED` automatically. **Explicit operator recovery only.** |
| `IN_FLIGHT` + **>1** Pipeline rows | corruption. **Fail closed**, no write, operator. |

Two things would have to change before automatic reconciliation could be reconsidered, and both
are schema decisions rather than code: `request_id` made **write-once** on the Pipeline row
(`keepFirst` rather than `advance`), and `mode` persisted on the row. Neither is taken here.

The recovery adapter's existing classification of `IN_FLIGHT` as `CANNOT_ANSWER` is therefore
**correct as it stands** and is left alone. Safety beats liveness.

## 6. §8 — P1-L5 reassessed: **SUPERSEDED**

The canonical wording is Model A's: *"the stable key reaches Lead Intake as
`payload.meta.idempotency_key`"*, blocked because *"today the outbound envelope carries no
key — contract change, owner approval"*.

Under Model B that requirement is not merely met elsewhere, it is **inverted**. The key must
**not** travel in the payload. `Internal Envelope Unwrap` says why:

> `submission_key` is deliberately NOT injected into the body. It is a receipt control, not lead
> data, and putting it in the body would make it indistinguishable from a caller-supplied field
> one node later.

That is the §7.1 trust boundary: the public webhook accepts any JSON, so a body-borne key would
be caller-authoritative. Model B carries it **out of band** as a top-level field of the
authenticated internal call — `leadIntake.submit({ submission_key, envelope })` — reaching
`Internal Auth Entry` as `__submission_key` and selecting the receipt at `Receipt Exact Read`.

**Current meaning:** *the stable submission identity must reach Lead Intake over the
authenticated internal route as an out-of-band control that selects the receipt, and must never
appear in the payload.* That is proven live — execs 3610, 3612, 3618, 3640, 3642 — and pinned
offline. Marking it `PASS` under the old wording would be wrong, because the old wording asks
for something Model B forbids. It is **SUPERSEDED**, not passed.

**A separate deployment gap, recorded so it is not lost.** The live Concierge contains **zero**
nodes referencing `submission_key`: it does not yet mint or persist one at cycle issuance, and
no Mini App submit gateway is deployed. `P1-L11` is `PASS` on the substrate (the column exists
and was written and read end-to-end by canary exec 3552), but the **issuer half is not built**.
That is Mini App activation work, not a G1 receipt-substrate question — and General Mini App
Activation remains NOT CLEARED regardless.

## 7. Status register correction (§1, §11)

`P1-L2` was retired by Model B P3 and replaced by `P1-L2′`. Carrying it as an open blocker was
stale, and it is corrected in the current registers. Historical P1/P2 evidence is untouched.

| | Status |
|---|---|
| **P1-L2** atomic insert-if-absent | **RETIRED** — Model A requirement, replaced by L2′ at P3 |
| **P1-L2′** conditional update atomic, `updated_rows` faithful under concurrency | **PASS** (P4) |
| **P1-L3** read-after-write exact-key visibility | **PASS** (P4) |
| **P1-L4** durability | **PARTIAL** — execution and redeploy PASS, **tenant restart NOT TESTED** |
