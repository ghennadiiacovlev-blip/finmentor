# FINMENTOR — G1 P2 live store capability canary

Phase: **B.2.1-C live prerequisites, P2 — substrate proof only**
Date: **2026-08-26**
Branch: `feat/miniapp-b21c-live-prereqs`
Repo HEAD at canary time: `658383b`

**Headline: P1-L2 FAILS. The n8n Data Table cannot enforce one-receipt-per-key.** The
architecture assumption behind the receipt ledger is wrong on this substrate, and this
document records the evidence rather than bending to the design.

No credentials appear here. No customer data was used. No production workflow, Pipeline row,
`Bot_Sessions` row, Telegram message, GA4 event or DNS record was touched.

---

## 1. Access

Live access was available through the **session's n8n MCP connection** — an
interactively-authenticated path, not a repository API key.

The environment was checked first for presence only, never values: `N8N_API_KEY`,
`N8N_FIX_API_KEY`, `N8N_BASE_URL`, `N8N_CANARY_API_KEY`, `N8N_TEMP_API_KEY` were **all unset**.
The two keys scheduled for revocation (audit report, OWNER ACTIONS item 6) were therefore
neither present nor reused, which is the required outcome either way.

---

## 2. Isolated canary table — P1-L1

| | |
|---|---|
| Name | `Submission_Receipts_CANARY` (**not** the production `Submission_Receipts`) |
| Data table id | `VS00eFWlVtom90ZY` |
| Project | `i98tNjxq2CUeunA3` (personal) |
| Created | `2026-08-26T09:46:53.427Z` |

Schema read back after creation — **eleven columns, all `string`, indices 0–10 in the declared
order**:

| # | Column | Type |
|---|---|---|
| 0 | `idempotency_key` | string |
| 1 | `commit_state` | string |
| 2 | `canonical_lead_id` | string |
| 3 | `lead_mode` | string |
| 4 | `lead_priority` | string |
| 5 | `financial_zone` | string |
| 6 | `created_at` | string |
| 7 | `committed_at` | string |
| 8 | `aborted_at` | string |
| 9 | `abort_reason` | string |
| 10 | `correlation_id` | string |

`string` rather than `date` for the three timestamp fields, deliberately: the repository module
normalises every field through `normValue` → `String`, so a `date` column would diverge from
the contract the code actually writes.

**P1-L1 — PASS.** The table and the exact eleven-field schema can exist and are usable.

### Synthetic identity

Identity `900000777`, cycle `C-CANARY-P2-01`, key `miniapp:900000777:C-CANARY-P2-01`.

In the `9000000xx` synthetic range the threat model's canary matrix already reserves, and it
satisfies the repository key grammar `^miniapp:[0-9]{1,20}:[A-Za-z0-9._-]{1,64}$`. No real
Telegram user id, no customer PII, no real lead id. The canary table is wired to **nothing** —
no workflow reads or writes it — so no Telegram or production identity path exists for it to
reach.

---

## 3. P1-L2 — atomic insert-if-absent → **FAIL**

Failed on two independent grounds. Either alone is sufficient.

### 3.1 The primitive does not exist

`n8n-nodes-base.dataTable` v1.1, `row` resource, complete operation list:

`deleteRows` · `get` · `rowExists` · `rowNotExists` · `insert` · `update` · `upsert`

**None of these is an atomic insert-if-absent.**

| Operation | Why it does not satisfy P1-L2 |
|---|---|
| `insert` | unconditional. No predicate, no uniqueness check |
| `upsert` | "Update row(s), or insert if there is no match" — match-then-write. Two concurrent upserts that both find no match both insert; on the update path it is last-write-wins. This is a *convenience composition*, not an atomic primitive |
| `rowExists` / `rowNotExists` | read filters that match input items against the table. Using either before `insert` is exactly the **"broad lookup + create"** the brief forbids, with a race window between the two calls |
| `update` | conditional **UPDATE** — the primitive Phase 10 proved live for the read-model CAS. Conditional update is not conditional insert |

Phase 10 proved conditional *update*; P1 explicitly recorded insert-if-absent as a **distinct,
unproven** capability. The platform surface now shows it is not merely unproven — it is absent.

### 3.2 Duplicates were created live, through the intended primitive

Two inserts of the **same** `idempotency_key` into the canary table:

| Attempt | `correlation_id` | `created_at` | API result |
|---|---|---|---|
| A | `fmr_canary_a1` | `2026-08-26T09:47:00.000Z` | `{"success": true, "insertedCount": 1}` |
| B | `fmr_canary_b2` | `2026-08-26T09:47:10.000Z` | `{"success": true, "insertedCount": 1}` |

The second insert of an identical key **succeeded**. There is no uniqueness constraint on the
column and no error is raised. Two receipt rows now exist for one key — the exact state the
ledger's uniqueness rule forbids, produced in two ordinary API calls.

**No race was needed to demonstrate this**, which is itself the finding: uniqueness is not
merely unreliable under concurrency, it is not enforced at all.

**P1-L2 — FAIL.**

---

## 4. P1-L3 read-after-write and P1-L4 durability → **NOT TESTED**

Not "partial" — **not tested**, and the reason is worth stating precisely.

**There is no row-read path available.** The MCP Data Table surface is:

`create_data_table` · `rename_data_table` · `add_data_table_column` ·
`delete_data_table_column` · `rename_data_table_column` · `add_data_table_rows` ·
`search_data_tables`

`search_data_tables` returns **table and column metadata only, never row data**. There is no
row read, no row update, no row delete and no table delete. **Rows are write-only through this
path** — I could not read back even the two rows I had just written.

Reading rows would require building a workflow around the `dataTable` node's `get` operation
and executing it. That was not done, for two reasons:

1. **P1-L2 had already failed.** Proving read-after-write on a substrate that cannot hold the
   uniqueness the design depends on would spend further live mutation on a secondary property
   of a store that has already failed its primary one. The substrate decision returns to the
   owner first.
2. **Execution would have risked undoing a security control.** `execute_workflow` requires
   `availableInMCP`, and Phase 10 deliberately hardened the tenant to **0 of 35** workflows
   exposed to MCP. Re-enabling that for a canary is not a trade worth making, and this canary
   did not need it.

**P1-L3 — NOT TESTED. P1-L4 — NOT TESTED.** No durability boundary was crossed: no separate
execution, no redeploy, no restart. Neither is reported as PASS or PARTIAL, because neither was
attempted.

---

## 5. What this means for the architecture

The receipt ledger's uniqueness rule — *never more than one receipt row per key, enforced by
atomic insert-if-absent* — **cannot be met by an n8n Data Table.**

The repository's defence in depth still holds and is worth noting: duplicates are **detected
and fail closed** (`DUPLICATE_RECEIPTS` → `CANNOT_ANSWER`), so a duplicate never produces a
wrong answer. But a ledger that routinely accumulates duplicates under concurrency is a ledger
that routinely answers `CANNOT_ANSWER` — which means recovery stops working **exactly when it
is needed**, on concurrent submits. Failing safe is not the same as working.

### The one option this canary did not rule out

Worth recording because it uses a primitive that **is** proven live, and it is the leading
candidate for P3 rather than a decision taken here:

> The submit path never needs to *create* a receipt if the row already exists. If the receipt
> row is **pre-created at cycle issuance** — a single-writer moment, by the Concierge, with no
> concurrency — then the submit path only ever performs a **conditional UPDATE**, which is
> atomic, and which Phase 10 already proved live in this tenant.

That sidesteps insert-if-absent entirely. It also changes who writes the ledger and when, so it
is an architecture change requiring owner input, not a patch. **Not designed here.**

Other directions the owner may prefer: a different substrate with a real uniqueness constraint
(Google Sheets has no conditional append either, so it is not a candidate), or accepting
duplicates with a deterministic resolution rule — which would need its own proof that the
resolution can never pick a wrong lead.

---

## 6. Cleanup — what remains live

**The MCP surface has no tool to delete rows or delete a data table.** Cleanup therefore could
not be completed from this session, and the exact residue is stated rather than glossed:

| Item | State | Action needed |
|---|---|---|
| `Submission_Receipts_CANARY` (`VS00eFWlVtom90ZY`) | **STILL EXISTS** in the personal project | delete in the n8n UI when the evidence above is accepted |
| 2 synthetic rows, key `miniapp:900000777:C-CANARY-P2-01` | **STILL PRESENT** in that table | removed with the table |
| Disposable canary workflow | **never created** | none |
| Production `Submission_Receipts` | **never created** | none — and it must not be, until the substrate question is settled |

The residue is synthetic-only, wired to nothing, and named unmistakably. Deleting the column
set to purge the rows was rejected: destroying schema to delete data would have left a
misleading half-table and lost the P1-L1 evidence.

Per **OD-3**, no retention deletion automation was created or implemented.

---

## 7. Verdicts

| Prerequisite | Verdict |
|---|---|
| **P1-L1** table / schema exists and is usable | **PASS** |
| **P1-L2** atomic insert-if-absent under concurrency | **FAIL** — primitive absent; duplicates created live |
| **P1-L3** read-after-write exact-key visibility | **NOT TESTED** — no row-read path; stopped after L2 |
| **P1-L4** durability across a redeploy/restart boundary | **NOT TESTED** — no boundary crossed |

**G1 remains OPEN**, and P2 does not change that. P1-L5, L6, L7, L8, L9 and L10 are untouched
and remain separate. P1-L2 now joins them as a failed prerequisite requiring an architecture
decision, not merely a live proof.

---

## 8. Boundaries observed

No production Lead Intake workflow modified. No Mini App gateway change. No `idempotency_key`
added to any production payload. No `Internal Auth Entry` created. No `Bot_Sessions` or
Pipeline access. No customer-facing webhook called. No Mini App activation. No Telegram, GA4,
DNS or Cloudflare change. No workflow created or executed. No credential printed, stored or
logged.
