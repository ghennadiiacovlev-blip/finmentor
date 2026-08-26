# FINMENTOR — G1 P4 live conditional-update canary (MODEL B substrate proof)

Phase: **B.2.1-C live prerequisites, P4 — MODEL B live substrate proof only**
Date: **2026-08-26** (canary window 14:19Z – 16:46Z)
Branch: `feat/miniapp-b21c-live-prereqs`
Repo HEAD at canary time: `1df5b23`

**Headline: every gating canary passed. C7, C1, C2, C3, C4, C5 and C6 are PASS, and the
claim→commit round trip is PASS.** The n8n Data Table conditional update is a real
compare-and-set with an observable affected-row count, and it holds under genuine concurrency.
This reverses, for MODEL B specifically, the substrate doubt P2 left open — but it does **not**
reverse P2's finding, which was about a different primitive (see §11).

No credentials appear here. No customer data was used. No production workflow, Data Table,
Pipeline row, `Bot_Sessions` row, Telegram message, GA4 event or DNS record was touched.

---

## 1. Access and precheck

| | |
|---|---|
| Branch | `feat/miniapp-b21c-live-prereqs` |
| Working tree at start | clean |
| HEAD | `1df5b23663faac45825b62fb47da446001d176a4` |
| Live access | session n8n MCP connection (interactively authenticated) |
| `N8N_API_KEY`, `N8N_FIX_API_KEY`, `N8N_BASE_URL`, `N8N_CANARY_API_KEY`, `N8N_TEMP_API_KEY` | **all unset** (presence-checked only, never read) |

The two keys scheduled for revocation were neither present nor used.

### P2 table cleanup status

The P2 canary table `Submission_Receipts_CANARY` (`VS00eFWlVtom90ZY`) and its two synthetic
rows **no longer exist**. A full data-table enumeration at the start of P4 returned exactly one
table, the pre-existing `FINMENTOR_B21B_SESSION_READMODEL_QA` (`dk2oK5tL1P2bKLhK`). The P2
residue was therefore cleared before P4 began. It was **not** mutated or reused.

---

## 2. Execution method — and a corrected prior assumption

P2 recorded that rows could be written but never read, because the MCP Data Table surface has
no row read, and because executing a workflow was believed to require `availableInMCP=true`.
That second half is **wrong and is corrected here**.

`test_workflow` does **not** require `availableInMCP`. It pins trigger, credential and HTTP
nodes but executes Code and other nodes normally — and the `dataTable` node needs no
credentials, so it executes for real. Full per-node output, including exact item arrays, is
then readable via `get_workflow_execution` with `includeData: true`.

This was verified before any table was created, using a two-node throwaway workflow
(`luJmzA2dRmqimNIx`, one Code node returning a constant), so that a refusal would have left
zero residue. It succeeded (execution `3455`).

**`availableInMCP` was never enabled on anything.** It was not needed. All 28 pre-existing
workflows remained `availableInMCP: false` throughout, and Phase 10's MCP exposure hardening was
never weakened. `execute_workflow` was never called.

### Disposable workflows created (all archived, §12)

| ID | Name | Role |
|---|---|---|
| `luJmzA2dRmqimNIx` | `[TEMP] B21C P4 Execution Capability Probe` | execution-path probe, no table access |
| `A6iZ1dZbptTUrLpY` | `MODEL_B_RECEIPT_CANARY` | C7 gating probe |
| `yL6ggvwbhmJXbM3V` | `MODEL_B_RECEIPT_SEEDER` | parameterised row seeding |
| `7ETcVvGSJwxrX11U` | `MODEL_B_RECEIPT_CLAIM` | parameterised conditional claim |
| `z4f76Q6GwTrsIMEn` | `MODEL_B_RECEIPT_READER` | parameterised exact-key read |
| `ZYC9E58cRvcrfh7H` | `MODEL_B_RECEIPT_ARM` | race arm (sub-workflow) |
| `zWvCMujatyov44CU` | `MODEL_B_RECEIPT_RACE` | race runner (fires two arms concurrently) |
| `VeJN7GS3RZ7g3nVs` | `MODEL_B_RECEIPT_COMMIT` | conditional commit with canonical values |
| `3ArnrZlaV2mWN5ng` | `MODEL_B_RECEIPT_CLEANUP` | canary table drop |

None contained a credential, Telegram node, Sheets node, OpenAI node, Pipeline reference,
Lead Intake reference, production webhook URL or production Data Table reference.

---

## 3. Canary table — isolated, synthetic

| | |
|---|---|
| Name | `Submission_Receipts_CANARY_B` |
| Data table id | `kyu9qcBB7wWmINTm` |
| Project | `i98tNjxq2CUeunA3` (personal) |
| Lifetime | created 2026-08-26 ~14:29Z, **deleted 16:46:54Z** |

Exactly eleven columns, all `string`, in the declared order: `submission_key`, `commit_state`,
`canonical_lead_id`, `lead_mode`, `lead_priority`, `financial_zone`, `created_at`, `claimed_at`,
`settled_at`, `abort_reason`, `correlation_id`.

Note the platform adds its own `id`, `createdAt` and `updatedAt` to every row on top of the
declared schema. The auto-generated `id` is **not** part of the eleven-field contract and was
never used as the claim predicate — every conditional update in this canary matched on
`submission_key` plus `commit_state` only.

### Synthetic keys

All keys are `sub_` + 32 random lowercase hex, generated from `crypto.randomBytes(16)`, with no
derivation from Telegram or user identity. 29 rows total were created: one C7 key, an 18-row
seed batch, and a 10-row race batch. No customer PII, no real Telegram id, no real lead id. The
table was wired to nothing — no workflow outside this canary referenced it.

---

## 4. C7 — updated-row count observable → **PASS** (gating)

Run first, as required. One READY row preallocated, then a matching conditional update followed
by an identical update that could no longer match.

**Accepted evidence shape B: the node emits one output item per updated row.** It also returns
the full post-update row, which is stronger than a bare count.

Execution `3456`, raw `runData` shapes (identifiers synthetic, nothing redacted):

`Claim A MATCH` — predicate `submission_key = K7 AND commit_state = 'READY'`, set `IN_FLIGHT`:

```
"data": { "main": [ [ { "json": {
    "submission_key": "sub_a1c1…f0e7", "commit_state": "IN_FLIGHT",
    "canonical_lead_id": null, ...,
    "id": 1,
    "createdAt": "2026-08-26T14:21:53.752Z",
    "updatedAt": "2026-08-26T14:21:53.810Z"
} } ] ] }
```

→ **exactly 1 item**, `executionStatus: "success"`, `updatedAt` advanced past `createdAt`.

`Claim B NOMATCH` — byte-identical predicate, now unsatisfiable:

```
"data": { "main": [ [] ] },  "executionStatus": "success"
```

→ **exactly 0 items**, success, no exception.

Zero rows and one row are therefore deterministically distinguishable by item count. The node's
published contract agrees: `DataTableV11RowUpdateOutput` is typed `Items<{id, createdAt,
updatedAt}>`, and the operation exposes a `dryRun` option documented as returning "affected rows
in their before and after states".

**Consequence for MODEL B's design, worth stating:** the losing branch emits **zero items**, so
every node downstream of a lost claim is skipped for that execution. The loser path must be an
explicit branch (or the node must be marked `alwaysOutputData`), not an implicit fall-through.

---

## 5. C1 — conditional update count fidelity → **PASS**

Receipt K1 = `sub_a106…8944`, created READY.

| Step | Predicate | Execution | Items returned |
|---|---|---|---|
| First claim | `K1 AND READY` → `IN_FLIGHT` | `3458` | **1** |
| Repeat claim | `K1 AND READY` → `IN_FLIGHT` | `3459` | **0** |
| Wrong-state claim | `K1 AND COMMITTED` → `ABORTED` | `3460` | **0** |
| Exact read | `K1` | `3461` | **1**, `commit_state = IN_FLIGHT` |

The third step deliberately targeted `ABORTED` so that an incorrect match would have been
unmistakable in the row. It did not occur.

The read is the sharpest part: after two zero-match updates, the row still carried
`correlation_id: "fmr_c1_first"` and `updatedAt: 2026-08-26T14:31:50.686Z` — **identical to the
value written by the first claim**. The failed updates did not merely change nothing visible;
they performed no write at all.

---

## 6. C2 — genuine concurrent claim → **PASS, 10/10**

### 6.1 A rejected first attempt, recorded rather than hidden

The first approach issued two `test_workflow` calls in one batch. They did **not** overlap: arm
A ran 16:36:51.877 → 16:37:00.072 and arm B did not start until 16:37:02.376, 2.3s after A had
finished. The MCP tool calls were executed sequentially by the calling harness.

Under the brief's own rule this is "concurrency simulated sequentially" and **cannot** be
reported as C2 evidence. It is recorded here as a sequential control only (round `R01`, one
winner, one loser) and is excluded from the C2 result.

### 6.2 The harness that produced real overlap

Concurrency was moved inside n8n. A parent workflow (`MODEL_B_RECEIPT_RACE`) computes **one
shared absolute release instant** and fires two independent sub-executions of
`MODEL_B_RECEIPT_ARM` with `options.waitForSubWorkflow: false`, so it does not block between
them. Each arm sleeps until that shared instant, then issues its conditional claim.

An earlier busy-wait barrier was replaced after it proved counterproductive: spinning on
`Date.now()` monopolised the single Node thread and starved the second arm, pushing the two
claims 28ms apart. A non-blocking `await setTimeout` barrier lets both arms yield and wake
together, which tightened every subsequent round to **1–2ms**.

### 6.3 Results — 10 rounds, each on its own fresh READY key

Winner = the arm whose `Conditional Claim` returned 1 item; loser returned `[]`.

| Round | Arm A exec | Arm B exec | A items | B items | Winner | Claim Δ |
|---|---|---|---|---|---|---|
| RA01 | 3474 | 3475 | 1 | 0 | A | 2ms |
| RA02 | 3477 | 3478 | 1 | 0 | A | 2ms |
| RA03 | 3480 | 3481 | 0 | 1 | B | 2ms |
| RA04 | 3483 | 3484 | 0 | 1 | B | 2ms |
| RA05 | 3486 | 3487 | 1 | 0 | A | 2ms (B started first) |
| RA06 | 3489 | 3490 | 1 | 0 | A | 1ms (B started first) |
| RA07 | 3492 | 3493 | 0 | 1 | B | 1ms |
| RA08 | 3495 | 3496 | 0 | 1 | B | 2ms |
| RA09 | 3498 | 3499 | 1 | 0 | A | 1ms |
| RA10 | 3501 | 3502 | 1 | 0 | A | 2ms (B started first) |

**10/10 rounds produced exactly one winner.** Never two winners, never two losers.

Evidence of genuine overlap, not sequence:

- Every pair's execution lifetimes overlap almost entirely. RA01: A `16:40:48.515 → 16:40:57.625`,
  B `16:40:48.578 → 16:40:57.648`. Mid-run, `search_workflow_executions` showed both arms
  simultaneously `status: "running"`.
- Both arms of a round carry the **same** `barrier_ms`, and their claim `startTime` values differ
  by 1–2ms.
- The winner is **not deterministic**: A won 6 rounds, B won 4.
- In RA05, RA06 and RA10 the arm that issued its claim **first** still **lost**. Arrival order at
  the node does not decide the outcome; the storage layer serialises the two updates and only the
  first to reach the row observes `READY`. That is compare-and-set behaviour, not last-write-wins.

### 6.4 Final state across all ten race keys

One read (execution `3503`) over all ten keys returned **exactly ten rows** — one per key, ids
20–29, every one `IN_FLIGHT`, and every `correlation_id` matching precisely the arm that had
reported the winning item. No duplicate rows, no ambiguous final state.

---

## 7. C3 — expected-state matching → **PASS**

Receipt K3 = `sub_2439…e9ae`, moved to `IN_FLIGHT` first (execution `3504`).

| Attempt | Predicate | Execution | Items |
|---|---|---|---|
| Re-claim as if READY | `K3 AND READY` → `IN_FLIGHT` | `3506` | **0** |
| Roll back as if COMMITTED | `K3 AND COMMITTED` → `READY` | `3507` | **0** |

Exact read (`3509`): row unchanged — `IN_FLIGHT`, `correlation_id: "fmr_c3_setup"`,
`updatedAt: 16:43:24.688`, which is the setup claim's timestamp and predates both probes
(16:43:56 and 16:43:59). Neither probe wrote.

---

## 8. C4 — exact key read → **PASS**

Three neighbouring keys were seeded so that over-return would be visible rather than assumed:

- `KB` = `sub_35b1527095140c0045eb377f6aeca700` (id 17)
- `KB + "0"` (id 18) — KB is a strict **prefix** of this key
- `"0" + KB` (id 19) — KB is a strict **suffix** of this key

All eight probes ran through the **same node with identical configuration**, varying only the
key value, in one execution (`3508`). Results attributed by `pairedItem.item`:

| # | Probe | Key | Rows |
|---|---|---|---|
| 0 | exact | `KB` | **1** — id 17 only |
| 1 | wrong key | unrelated `sub_2e1d…f00e` | **0** |
| 2 | prefix | `KB` minus last char | **0** |
| 3 | suffix | `KB` minus first char | **0** |
| 4 | padded | `KB` + trailing space | **0** |
| 5 | uppercase | `KB.toUpperCase()` | **0** |
| 6 | neighbour | `KB + "0"` | **1** — id 18 only |
| 7 | neighbour | `"0" + KB` | **1** — id 19 only |

The exact probe returned id 17 alone while ids 18 and 19 sat in the same table. Matching is
exact, case-sensitive and whitespace-sensitive, with no prefix, suffix or substring leakage, and
each neighbour remains individually addressable. No scan masqueraded as an exact lookup.

A ninth data point came free: a conditional update against a key with no row at all also
returned `[]` (execution `3466`).

---

## 9. C5 / C6 — durability boundaries → **PASS / PASS**, restart NOT TESTED

Reported per boundary. These are **not** aggregated into a blanket durability PASS.

**C5, execution boundary — PASS.** K5 = `sub_8dd0…ac70` was created by seeder execution `3457`
at `14:31:35.653Z`. That execution ended completely. A separate reader execution (`3505`) at
`16:43:27Z` — 2h12m later, no shared in-memory state — returned the row unchanged, `READY`,
`correlation_id: "fmr_p4_seed_K5"`, with `updatedAt === createdAt`, i.e. never modified.

**C6, workflow redeploy boundary — PASS.** K6 = `sub_75d5…9d51` was written at `14:31:35.655Z`.
`MODEL_B_RECEIPT_READER` was then redeployed (new version: node settings and canvas position
changed), so that the very workflow performing the read was a **new version created after the row
was written**. Execution `3510` returned the row unchanged, `READY`, `updatedAt === createdAt`.

**Tenant restart — NOT TESTED.** It cannot be performed with zero production impact on this
shared cloud tenant, so it was not attempted. It is not claimed, and no inference about it is
drawn from C5 or C6.

---

## 10. Claim → commit round trip → **PASS**

Receipt KRT = `sub_61b7…b4b1`. Synthetic receipt only — **this is not a real Pipeline write.**

| Step | Predicate → set | Execution | Items |
|---|---|---|---|
| Claim | `KRT AND READY` → `IN_FLIGHT` | `3511` | **1** |
| Commit | `KRT AND IN_FLIGHT` → `COMMITTED` + 4 canonical values | `3512` | **1** |
| Repeat commit | same predicate, **different** canonical values | `3513` | **0** |
| Exact read | `KRT` | `3514` | **1** |

After commit, the read returned exactly: `commit_state: "COMMITTED"`,
`canonical_lead_id: "CANARY-LEAD-001"`, `lead_mode: "new"`, `lead_priority: "WARM"`,
`financial_zone: "YELLOW"` — all four exact.

The repeat commit deliberately carried **poisoned** values (`CANARY-LEAD-DUPLICATE`, `existing`,
`COLD`, `RED`). It returned 0 items and **none of those values reached the row**; `updatedAt`
remained `16:45:46.120Z` from the first commit. A replayed commit cannot corrupt an
already-committed receipt.

---

## 11. What this does and does not change

**What P4 proves.** The conditional UPDATE is a genuine compare-and-set on this substrate: the
affected-row count is observable and trustworthy, 0 and 1 are distinguishable, the predicate is
honoured including the expected-state term, exact-key lookup does not over-return, and under ten
genuinely overlapping races exactly one claimant won every time. MODEL B's live substrate
requirement is met.

**What P4 does not change.** P2's finding stands untouched: there is still **no atomic
insert-if-absent**, and two inserts of the same key still both succeed. P4 did not retest that
and does not contradict it. MODEL B is viable precisely because it never inserts on the submit
path — the receipt row is preallocated at cycle issuance by a single writer, and the concurrent
path only ever performs the conditional update proven here. The P2 evidence remains the reason
MODEL B has the shape it has.

**Still open.** P1-L5 through P1-L11 are untouched by this canary. G1 remains OPEN. Preallocation
itself — that a receipt row always exists before any submit can reference it, and what happens
when it does not — is a MODEL B integration concern, not something this substrate canary tested.

---

## 12. Cleanup

Evidence was captured first, then everything was removed.

| Item | State |
|---|---|
| `Submission_Receipts_CANARY_B` (`kyu9qcBB7wWmINTm`) | **DELETED** — node returned `{"success": true, "deletedTableId": "kyu9qcBB7wWmINTm"}` (execution `3515`) |
| All 29 synthetic rows | **DELETED** with the table |
| 9 disposable workflows | **ALL ARCHIVED** |
| `availableInMCP` | **never enabled on anything**; nothing to reset |

Post-cleanup verification: a full data-table enumeration returns exactly one table, the
pre-existing `FINMENTOR_B21B_SESSION_READMODEL_QA`. A full workflow enumeration returns exactly
the 28 pre-existing workflows, every one `availableInMCP: false`, none with a modified timestamp.

Unlike P2, this phase leaves **no residue** — the `dataTable` node exposes `resource: table`
with `clear` and `delete` operations, which the MCP tool surface does not, so the canary was able
to drop its own table.

Per **OD-3**, no retention deletion automation was created or implemented.

---

## 13. Limitations

- **Tenant restart is untested** and deliberately so. Durability is claimed only across an
  execution boundary and a workflow redeploy.
- **Two arms per race, not N.** Ten rounds of 2-way contention were run. Higher fan-out
  contention was not tested.
- **Race window is 1–2ms, not zero.** The arms wake from a shared barrier but are not
  instruction-synchronised. The result is consistent across 10/10 rounds and the winner varies,
  including cases where the first arm to issue its claim lost — but a sub-millisecond window was
  not achievable from this harness.
- **Single tenant, single region, one substrate version.** Results describe this n8n cloud
  tenant as configured on 2026-08-26 with `n8n-nodes-base.dataTable` v1.1.
- **No production integration was exercised.** Nothing here proves the Concierge preallocates
  correctly or that Lead Intake consumes a committed receipt correctly.

---

## 14. Verdicts

| Canary | Verdict |
|---|---|
| **C7** updated-row count observable | **PASS** — one item per updated row; `[]` on zero |
| **C1** conditional update count fidelity | **PASS** — 1 then 0 then 0 |
| **C2** genuine concurrent claim | **PASS** — 10/10 rounds, exactly one winner |
| **C3** expected-state matching | **PASS** — both wrong-state predicates wrote nothing |
| **C4** exact key read | **PASS** — no prefix/suffix/case/padding leakage |
| **C5** execution-boundary durability | **PASS** |
| **C6** workflow-redeploy durability | **PASS** |
| tenant restart durability | **NOT TESTED** |
| claim → commit round trip | **PASS** |

| Prerequisite | Verdict |
|---|---|
| **P1-L2′** conditional claim under concurrency (MODEL B's replacement for L2) | **PASS** |
| **P1-L3** read-after-write exact-key visibility | **PASS** |
| **P1-L4** durability across a boundary | **PARTIAL** — execution and redeploy PASS, restart NOT TESTED |

**MODEL B: live substrate PROVEN. G1 remains OPEN.**

---

## 15. Boundaries observed

No production workflow created, modified, archived or executed. No production Data Table read or
written. No `availableInMCP` change anywhere. No workflow activated or published. No production
`Submission_Receipts` table created. No Concierge or Lead Intake integration. No Mini App
gateway change. No `idempotency_key` added to any production payload. No `Bot_Sessions` or
Pipeline access. No customer-facing webhook called. No Telegram, GA4, DNS or Cloudflare change.
No credential printed, stored or logged. **No customer data of any kind was used.**
