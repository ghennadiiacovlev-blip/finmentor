# FINMENTOR — G1 P6 controlled live integration: **PARTIAL — BLOCKED AT DEPLOYMENT (P6-RESUME)**

> **This document has two parts.** §A is **P6-RESUME** (2026-08-26, 19:33Z–19:56Z), run after the
> owner applied the `Bot_Sessions` AW:AZ schema externally. §B below is the original P6 record,
> kept unedited because its preflight reasoning, its tooling findings and its topology analysis
> all still stand. **Read §A first — it supersedes §B's "STOPPED AT PREFLIGHT" status.**

---

# §A — P6-RESUME

**Headline: the preflights, the production table and every canary reachable without the full
candidate all PASS. Deployment of the 100-node audited candidate is BLOCKED by a tooling
limitation, so steps 6–13 were NOT RUN. G1 does not reach live functional proof.**

Production mutations, complete list: one Data Table **created** (`Submission_Receipts`, left
empty), two synthetic receipt rows written and deleted, two synthetic `Bot_Sessions` rows
written and deleted. **No production workflow was created, modified, activated or executed. No
header was added, renamed or moved. No Telegram message was sent. No customer row was touched.**

Synthetic data only: `.invalid` addresses, `900000xxx` chat ids that never reached a Telegram
node, `req-p6rs-*` correlation ids.

## A0. Schema applied externally — provenance stated honestly

The four B.2.1-C columns were **applied by the owner/reviewer outside this session**, before
P6-RESUME began. I did not write them and make no claim about how or exactly when they were
added. What I verified is the resulting live state (§A1).

| | |
|---|---|
| Grid before (P6R-1R) | **48** columns, A..AV |
| Grid now | **52** columns, A..AZ |
| Added | **AW** `submission_key`, **AX** `lead_mode`, **AY** `lead_priority`, **AZ** `financial_zone` |

## A1. Step 0 — schema preflight → **PASS**

Read with `rangeDefinition: 'specifyRange'`, `headerRow: 1`, `firstDataRow: 1`, i.e. **row 1
read as data**. This matters: the first attempt used the ordinary header read and reported all
four new columns *missing* — the known blind spot where a column that has a header but no data
anywhere is invisible to the Sheets node. That first reading was wrong and is discarded.

| Check | Result |
|---|---|
| Distinct header names | **51** |
| Physical columns | **52** — 51 distinct + the one proven `error` duplicate (P6R-1R §A1.2) |
| All ten required columns present | **YES** |
| …each exactly once | **YES** — no B.2.1-C column is shadowed by a duplicate |
| `AW:AZ` values on existing rows | **zero on every row** |
| Backfill introduced | **NONE** |

The six legacy columns (AQ..AV) are untouched and the AO/AP duplicate was not modified, as
instructed.

## A2. Step 1 — authority preflight → **PASS**

```
{"ok":true,"deploy":true,"reason":"SATISFIED","missing":[]}
```

`lead_mode` vocabulary `new|merged|retry` (the P5.2 `ALLOWED_MODES`), `crosses_tb1: false`.

## A3. Step 2 — production `Submission_Receipts` → **CREATED, EMPTY**

Verified non-existent first, then created.

| | |
|---|---|
| Table id | **`fV23lsh9uq8uFHox`** |
| Columns | **11**, all `string`, indices 0–10 |
| Names | `submission_key`(0), `commit_state`(1), `canonical_lead_id`(2), `lead_mode`(3), `lead_priority`(4), `financial_zone`(5), `created_at`(6), `claimed_at`(7), `settled_at`(8), `abort_reason`(9), `correlation_id`(10) |
| Rows at end of phase | **0** — verified, §A8 |

This is the approved inert prerequisite: the table exists and nothing reads or writes it in
production, because the workflow that would has not been deployed.

## A4. Step 3 — candidate deployment → **BLOCKED**

The generator is healthy: `scripts/build-lead-intake-receipt-candidate.mjs` regenerates
`n8n/candidate/lead-intake-internal-receipt-candidate.json` **byte-identical** (100 nodes = 57
inherited production + 43 receipt).

**It cannot be deployed through this MCP surface.** Every available path fails for a different
reason, and none of them is safe to force:

| Path | Why it fails |
|---|---|
| `create_workflow_from_code` | takes **SDK source, not raw workflow JSON**. Using it means hand-re-expressing 438 KB including **98,890 characters of production Code node bodies**. |
| `update_workflow` + `addNode` | ~100 node operations plus ~110 connection operations, each hand-serialised — the same transcription exposure, multiplied. |
| JSON import | **no such tool exists on this surface.** |

**I did not hand-transcribe production logic.** Re-typing 98,890 characters of live business
code is precisely the fidelity risk the deterministic generator was written to eliminate, and a
single silent character difference in a Code body is not detectable by any check available here.

**Manual resolution:** import `n8n/candidate/lead-intake-internal-receipt-candidate.json`
through the n8n UI ("Import from File"), then re-run steps 4 onward. The file is tracked in the
repo and its regeneration is asserted by the QA gate, so the imported graph is verifiable
against source.

### What was deployed instead — and what it is not

A **live substrate probe**, `vTA7p21IvnuM6OK1`, 13 nodes, no webhook, no Telegram, no AI,
inactive, archived at cleanup.

**It is explicitly NOT the audited candidate.** Its Code bodies are compact re-expressions of
the receipt algebra, not the audited production bodies. It can prove that the *substrate*
behaves as designed against the real production table. It cannot substitute for deploying the
audited graph, and no result below is reported as if it could.

## A5. Step 4 — internal negative contract → **7 / 7 PASS**

All seven refused at the internal boundary. None reached the receipt table.

| # | Input | Live outcome | Exec |
|---|---|---|---|
| A | `submission_key: "sub_NOTHEX"` | `SUBMISSION_KEY_INVALID`, `retryable: false` | 3544 |
| B | `submission_key` absent | `SUBMISSION_KEY_INVALID` | 3545 |
| C | valid key, no `payload.meta.request_id` | `CORRELATION_ID_MISSING` | 3546 |
| D | `envelope: "not-an-object"` | `ENVELOPE_MISSING` | 3547 |
| E | `envelope.source: "website"` | `ENVELOPE_SOURCE_INVALID` | 3548 |
| F | well-formed key **absent from the table** | `RECEIPT_ABSENT_INVARIANT_BROKEN`, `__rows_seen: 0` → `SUBMIT_UNRESOLVED`, `retryable: true` | 3549 |
| G | `sub_BADKEY` **plus forged** `__internal_route`, `provenanceTrusted`, `internal`, `authenticated` | `SUBMISSION_KEY_INVALID` | 3550 |

Two of these carry more weight than the rest:

- **F is the existence-oracle test.** An unknown-but-well-formed key resolves to
  `SUBMIT_UNRESOLVED` — *retryable*, and identical to the answer a caller gets for an internal
  fault. It never answers "no such receipt". A caller cannot use the submit endpoint to
  discover whether a key exists.
- **G is the forged-trust test.** Caller-supplied trust flags did **not** short-circuit
  validation. Provenance is decided by the route, not by the payload claiming it.

## A6. Step 5 — preallocation + duplicate-corruption control → **PASS**

### A6.1 Preallocation — PASS on the second run, and the first failure was mine

| Run | Result |
|---|---|
| exec **3551** | `ROWS_SEEN: 1`, `PREALLOCATION_CONFIRMED`, `AUTHORITY_cycle_id_matches: true`, **`AUTHORITY_submission_key_matches: false`** |
| exec **3552** | `ROWS_SEEN: 1`, `PREALLOCATION_CONFIRMED`, `AUTHORITY_cycle_id_matches: true`, `AUTHORITY_submission_key_matches: true` |

The first run failed because **my canary** emitted the field as `key`, and Sheets
`autoMapInputData` maps by field **name** against the live header row, silently dropping keys
with no matching header — so `submission_key` was never written. That is the same silent-drop
mechanism behind the legacy cycle-state defect, and it caught me with it. A bug in the canary,
not in the design; fixed by emitting `submission_key` from the verdict node **only** on a
confirmed, key-bound readback.

Recorded because it is a live demonstration that the drop is silent: the write reported success.

### A6.2 Duplicate-corruption control — PASS

Two rows deliberately carrying the same key:

```
ROWS_SEEN: 2   →   READBACK_DUPLICATE   →   AUTHORITY_NOT_ADVANCED
```

`Write Authority` **never ran** (exec 3553). This is the exact P2 failure mode — the Data Table
has no uniqueness constraint, so duplicates are possible and the readback must refuse rather
than pick one. It refuses, live, against the production table.

## A7. Steps 6–13 — **NOT RUN**

All blocked on §A4. Nothing below was attempted, and none of it may be assumed from the
substrate probe results.

| Step | Status |
|---|---|
| 6 — NEW canary (Pipeline write, P1-L9 live) | **NOT RUN** |
| 7 — MERGE canary | **NOT RUN** |
| 8 — RETRY canary | **NOT RUN** |
| 9 — downstream side-effect inventory | **NOT RUN** |
| 10 — public path poisoning regression | **NOT RUN** |
| 11 — Concierge issuance patch | **NOT APPLIED** |
| 12 — Concierge patch verification | **NOT RUN** |
| 13 — gateway recovery matrix | **NOT RUN** |

The Concierge (`mppzthlkSJFr6Kle`) is **unmodified**. The public Lead Intake
(`QmIyEW2ZEqKregmN`) is **unmodified** — so the public path is unchanged by construction, not
by test, and step 10 stays honestly NOT RUN.

## A8. Step 16 — cleanup → **COMPLETE**

| Object | Action | Verification |
|---|---|---|
| `Submission_Receipts` rows | 2 synthetic keys deleted | exec 3554 — `RECEIPT_ROWS_REMAINING: 0`, `TABLE_EMPTY: true` |
| `Bot_Sessions` synthetic rows | `900000456`, `900000789` deleted (guarded, one at a time, `row_number` re-read between deletes) | exec 3558 — `TOTAL_ROWS: 27`, `REAL_SESSION_ROWS: 3`, `SYNTHETIC_ROWS_REMAINING: 0`, `CLEAN: true` |
| `AW:AZ` population | none introduced | all four `POPULATED: 0` |
| `cycle_id` | untouched | 3 rows, unchanged from P6R-1R |

**The guard refused its first delete** — `REFUSING DELETE: chat_id is outside the reserved
synthetic range` — because my regex demanded a seven-digit prefix (`9000000`) while the
reserved range is the six-digit `900000`. The guard behaved correctly: presented with a target
it could not positively identify, it refused rather than deleting on a guess. The pattern was
corrected and every other refusal condition kept.

Six disposable workflows created, **all six archived**:

| ID | Name |
|---|---|
| `Z6zwVvEKSLjzAGyx` | `[TEMP] P6RS schema preflight` |
| `vTA7p21IvnuM6OK1` | `[P6RS] Internal Receipt Substrate Probe` |
| `5FbkkmmjoVNOGoHY` | `[TEMP] P6RS preallocation canary` |
| `886qEeDuC19G0Akn` | `[TEMP] P6RS cleanup` |
| `7VXafhEX2A4BrLvv` | `[TEMP] P6RS session cleanup` |
| `NriHJ7qHKQdzdIfy` | `[TEMP] P6RS census` |

Tenant after cleanup: **28 workflows**, the exact pre-phase set, **`availableInMCP: false` on
every one**. **No canary active.** The only surviving new object is the empty
`Submission_Receipts` table, which is the approved prerequisite.

## A9. P1-L checklist

| Item | Status | Basis |
|---|---|---|
| P1-L1 preallocation writes a receipt | **LIVE PASS** | exec 3552, production table |
| P1-L2′ conditional claim under concurrency | **PASS** | P4 — synthetic table |
| **P1-L2 (live store)** | **NOT RETESTED** | the substrate probe does not claim it |
| P1-L3 read-after-write exact-key visibility | **PASS** | P4 |
| P1-L4 durability | **PARTIAL** — execution PASS, redeploy PASS, **tenant restart NOT TESTED** | unchanged |
| P1-L5 / L6 / L7 | **NOT TESTED** | steps 6–8 blocked |
| P1-L8 retention duration | **DESIGN READY / OWNER DURATION OPEN** | no duration invented |
| P1-L9 correlation chain | offline PASS; **live NOT TESTED** | step 6 blocked |
| P1-L10 internal route | design PASS; **substrate PASS (§A5)**; audited candidate **NOT TESTED** | |
| **P1-L11 `Bot_Sessions.submission_key`** | **PASS — column live, and written/read end-to-end** | §A1, exec 3552 |
| F4 sub-workflow return contract | **LIVE PASS** | §B3, not re-run |
| Duplicate receipt refusal | **LIVE PASS** | exec 3553 |
| Existence-oracle resistance | **LIVE PASS** | exec 3549 |
| Forged-trust-flag resistance | **LIVE PASS** | exec 3550 |

**P1-L11 is the one item §B recorded as FAIL that is now cleared.**

## A10. Status

| Item | Status |
|---|---|
| Legacy cycle-state defect | **LIVE CLOSED** (P6R-1R) |
| `Bot_Sessions` B.2.1-C schema | **LIVE** — 52 columns |
| `Submission_Receipts` | **LIVE, EMPTY, UNUSED** |
| Audited candidate deployed | **YES — §C**, `o9ndONOCI0XPJMiS`, 15/15 fidelity |
| **G1** | **OPEN** — one item left: the F11 failure terminals have never fired live (§C1) |
| **G5** durable initData replay | **OPEN** |
| **B.2.1-C** | **NOT CLEARED** |
| **General Mini App activation** | **NOT CLEARED** |

## A11. Residual blockers, in the order they must be resolved

1. **Candidate deployment (§A4).** Needs a UI file import, or an MCP JSON-import capability.
   Everything from step 6 onward is behind it.
2. **P1-L4 tenant restart** remains untested and is not upgraded.
3. **P1-L8 retention duration** is an owner decision; no value was invented.
4. **AP (`error`) is unreachable for writes** — recorded in P6R-1R, still out of scope, still
   deserving its own cleanup decision.
5. **The live-definition read gate** (§B8 item 2) is unchanged: production graphs still cannot
   be read without enabling `availableInMCP`, which is forbidden.

## A12. Boundaries observed

No API key sought, read, printed or used. No credential in the repo. No `availableInMCP`
change. No Mini App activation. No GA4, DNS or Cloudflare change. No Telegram message sent — no
synthetic identity ever reached a Telegram node. No real customer PII read into this document;
every figure is an aggregate computed inside the tenant. No production workflow modified. No PR,
no merge, no push to `main`.

---

# §C — P6.3 supersede and live campaign (2026-08-27) — scoreboard delta

§A's table above is the P6 record and is retained. This section records what **P6.3** changed,
and is the current one. Full reasoning: `docs/P6_3_INTERNAL_ROUTE_DEFECTS.md`.

| Item | Was (§A) | Now | Basis |
|---|---|---|---|
| **Audited candidate deployed** | **NO — blocked** | **YES** — `o9ndONOCI0XPJMiS`, 15/15 live fidelity, 99,832 chars of Code byte-identical | §7.5 |
| **P1-L10** internal route | candidate **NOT TESTED** | **LIVE PASS** — accepts a real gateway lead end to end | exec 3618 |
| **P1-L6** intent write before `Save to Pipeline` | NOT TESTED | **LIVE PASS** — `Receipt Claim` (21) strictly before `Save to Pipeline` (26) | exec 3618 node order |
| **P1-L7** commit write before the respond node | NOT TESTED | **LIVE PASS** — `Receipt Commit (New)` (28) before `Internal Result (New)` (31) | exec 3618 node order |
| **P1-L9** correlation chain | offline PASS; live NOT TESTED | **LIVE PASS on the NEW path** — receipt `correlation_id` equals the row's `request_id`, `req-p63-SHAPE-LIVE-1`. **Merge path still untested** | exec 3618 + receipt row 3 |
| **F10** | fixed, closed live | unchanged — **CLOSED LIVE** | |
| **F11** | fixed, not deployed | **fixed, deployed, gated offline — NOT observed live** | §7.11 |
| **Production residue** | none | **none** — 3 CRM rows and 3 receipt rows written, then removed and verified; 9 customer rows proven byte-identical | §7.12 |

**Unchanged and still open:** P1-L2 (live store) NOT RETESTED, P1-L4 tenant restart NOT
TESTED, P1-L5 owner contract decision, P1-L8 retention duration owner decision, G5 durable
initData replay.

## C1. Why G1 is still OPEN — one item

Everything the internal route was blocked on is now proven live except **one**: the three
`Internal Result (*)` terminals that F11 restores have never fired on the platform, because no
node has ever failed during a live run. They are proven offline only. Fault injection is built,
deployed and waiting on an owner Execute (`rbo5Xjx6NHrpjzUt`), and `MergeFailed` is explicitly
out of scope because reaching it requires writing a customer-shaped row into the live CRM.

Until that run happens, G1 cannot be upgraded to **LIVE FUNCTIONAL PROOF PASS**: an internal
contract whose failure terminals have never been observed is a contract proven only on its
happy and validation paths.

## C2. Live tenant state after P6.3

| Workflow | id | State |
|---|---|---|
| Validated internal canary — **keep** | `o9ndONOCI0XPJMiS` | live, inactive, `availableInMCP: false` |
| Canary driver — **keep** | `Z8Ai31yxfkyTSRO8` | live, inactive, `availableInMCP: true` |
| Fault-injection copy — **pending owner run** | `Gv8lepxB2PF4H8VQ` | live, inactive, not MCP-exposed |
| Fault-injection driver — **pending owner run** | `rbo5Xjx6NHrpjzUt` | live, inactive, `availableInMCP: true` |
| CRM cleanup pair | `9wbe8nlZsKG7cPv1` / `ir69QPIBAXvlwMvA` | **archived** |
| Residue sweep pair | `6oJCIbLfnDzmQStG` / `AS0KUNV5GRrWHGJd` | **archived** |
| Superseded canaries | `S24se5SYf5CJ0FIQ`, `UBfNGfli8E0UfiNa` | **archived**, retained |

Nothing was activated. No older unrelated `[TEMP]` workflow was touched. Production Lead Intake
`QmIyEW2ZEqKregmN` was not modified and its active set is unchanged.

The two `availableInMCP: true` drivers are the only MCP exposure this phase added; both are
credential-free harnesses and both should be archived when P6 closes.

---

# §B — original P6 record (superseded status, retained for the reasoning)

# FINMENTOR — G1 P6 controlled live integration: **STOPPED AT PREFLIGHT**

Phase: **B.2.1-C live prerequisites, P6 — controlled live integration**
Date: **2026-08-26** (window 18:33Z – 18:39Z)
Branch: `feat/miniapp-b21c-live-prereqs`
Repo HEAD at P6 start: `7b9635b`

**Headline: P6 stopped at the P6-0 → P6-1 boundary on a live drift finding, exactly as the
preflight exists to do. No production object was modified.** The `Bot_Sessions` migration was
not performed, the production `Submission_Receipts` table was not created, no candidate was
deployed, and the Concierge was not patched.

Two things were nonetheless proven, both with disposable credential-free workflows that
touched no production object: the **F4 sub-workflow return contract (P6-3A) — PASS**, and its
negative control, which turned out to matter more than expected.

No credentials appear here. No customer data was read into this document — the header probe
emits column NAMES only, never a cell value.

---

## 1. Preflight — repo

| | |
|---|---|
| Branch | `feat/miniapp-b21c-live-prereqs` |
| Working tree | clean |
| HEAD | `7b9635b680d51d358ed994c5f9431e61682444c9` |
| `origin/main` | `d69e2e8` — unchanged |

---

## 2. P6-0 — live snapshot

### 2.1 Tenant state

| Item | Observed |
|---|---|
| Workflows | 28 |
| `availableInMCP` | **false on all 28** — Phase 10 hardening intact |
| Data tables | 1 — `FINMENTOR_B21B_SESSION_READMODEL_QA` (`dk2oK5tL1P2bKLhK`) |
| Production `Submission_Receipts` | **does not exist** (as expected) |
| Lead Intake `QmIyEW2ZEqKregmN` | active, `updatedAt 2026-08-25T20:02:09.490Z` |
| Concierge `mppzthlkSJFr6Kle` | active, `updatedAt 2026-08-25T17:39:02.486Z` |

### 2.2 Lead Intake graph drift — **NOT DIRECTLY VERIFIABLE**

The direct anchor comparison the brief requires **could not be performed**, and this is
recorded as a limitation rather than glossed:

`get_workflow_details` and `get_workflow_history` both refuse with *"Workflow is not available
in MCP"*. Reading a live production workflow definition therefore requires
`availableInMCP = true` on that production workflow, which this phase is explicitly forbidden
to enable. There is no other read path: no API key is present, and none was sought.

**Indirect evidence of zero drift, which is real but weaker than the requirement:** the live
`updatedAt` for both workflows is byte-identical to the value recorded in
`n8n/production/manifest.json` at export time (`08/25/2026 20:02:09` and `08/25/2026 17:39:02`).
n8n bumps `updatedAt` on every save, so no save has occurred since the tracked export.

This is stated as **INDIRECT — NOT PROVEN**. It is not a substitute for comparing the eleven
named anchors, and P6 did not splice onto the graph anyway.

### 2.3 Live `Bot_Sessions` header — **THE STOP CONDITION**

Read with a disposable read-only probe (`crCKmRggIVAxzP0a`, since archived), range `A1:BZ2`,
emitting **column names only**. Execution `3521`.

The live sheet has **40 columns**:

```
session_id, chat_id, user_id, username, first_name, last_name, language, state,
created_at, updated_at, last_message_at, entry_source, selected_service, business_model,
turnover_range, main_pain, urgency, has_cfo, documents_status, contact_phone,
contact_email, contact_name, company, free_text_request, consent, lead_id, lead_sent_at,
status, notes, raw_json, reply_text, reply_markup, tg_body, session, lead_ready,
lead_payload, event, ai_guarded, ok, result
```

**None of the B.2.1 cycle columns exist:**

| Column | In live header? | Written by Concierge Code nodes? |
|---|---|---|
| `cycle_id` | **NO** | yes |
| `consent_cycle_id` | **NO** | yes |
| `consent_at` | **NO** | yes |
| `lead_cycle_id` | **NO** | yes |
| `lead_intake_ok` | **NO** | yes |
| `previous_lead_id` | **NO** | yes |
| `submission_key` | **NO** | no (B.2.1-C, not yet deployed) |
| `lead_mode` | **NO** | no |
| `lead_priority` | **NO** | no |
| `financial_zone` | **NO** | no |

### 2.4 Corroboration

The finding was cross-checked against the tracked Concierge export before being acted on:

- `Save Bot Session`'s cached resourceMapper **schema has exactly those same 40 columns**, in
  the same order — it matches the live sheet exactly. The Sheets node's own column mapping
  agrees with the live header.
- The three Concierge Code nodes (`Build Session Row`, `Build Intake State Row`,
  `Build Confirmation State Row`) build a **36-key** row object that includes the six columns
  above.

So the writer emits six keys the sheet has no header for. **Google Sheets silently drops a
patch key with no matching header** — it does not error. That is the precise failure mode
`AUTHORITY_SCHEMA_PRECONDITION` was written to warn about, and it is already happening in
production.

### 2.5 What this means

**`cycle_id`, `consent_cycle_id`, `consent_at`, `lead_cycle_id`, `lead_intake_ok` and
`previous_lead_id` have never persisted to `Bot_Sessions`.** Every Concierge write of them has
been silently discarded.

This is a **pre-existing production defect**, discovered by P6-0 and **not caused by any
B.2.1-C work**. It is outside the scope P6 was authorised to change.

**Why this stops P6-1 rather than being worked around:**

1. **The instruction's premise is false.** P6-1 says "preserve all existing columns including
   `cycle_id`, `consent_cycle_id`, `consent_at`, `lead_cycle_id`, `lead_intake_ok`". They do
   not exist. There is nothing to preserve.
2. **Appending only the four B.2.1-C columns would produce a sheet that still cannot work.**
   `handleSubmit` reads `authorityRow.cycle_id` and refuses when it is absent;
   `persistCanonical` writes `lead_cycle_id` and `lead_intake_ok`. A four-column migration
   yields an authority row that can never satisfy the gateway — every submit would be
   `PRE_ACTIVATION_BLOCKED` or `CYCLE_SUPERSEDED`. That is worse than not migrating, because it
   looks migrated.
3. **The ten-column migration is a materially larger change than authorised, and it is not
   inert.** Adding `cycle_id` and friends would, from that moment, cause the *live Concierge*
   to begin persisting cycle and consent-cycle state for real users where it never has. That is
   a behavioural change to a live customer path, not an additive no-op, and it is an owner
   decision.

**Correct action: STOP.** Both candidate migrations are owner decisions, and the pre-existing
defect needs its own remediation decision.

---

## 3. P6-3A — sub-workflow return contract → **PASS**

Run **out of the brief's order**, deliberately and for a stated reason: it is credential-free,
uses only disposable workflows, touches no production object, and closes the one assumption
P5.1 left open (F4). Running it while the owner decides the `Bot_Sessions` question costs
nothing and de-risks the next attempt.

### 3.1 Positive — the contract holds

Child (`ay513cX8B8KBVn5p`): `executeWorkflowTrigger` → Code returning a sentinel.
Parent (`kaQ3JDu5L2RfJfwx`): `manualTrigger` → `executeWorkflow`, `waitForSubWorkflow: true`.

Execution `3522`, sub-execution `3523`. The parent's `Call Child` node output:

```json
{ "ok": true, "sentinel": "P6_3A_SENTINEL_7f3a91c4", "marker": 424242, "echo": "p6-3a-positive" }
```

`sentinel_present: true`, `marker_present: true`.

**The parent receives the child's LAST EXECUTED NODE output verbatim.** The assumption P5.1
declared and could not yet observe is now proven live in this tenant.

### 3.2 Negative control — and it matters more than expected

A `RespondToWebhook` node was inserted into the child ahead of the sentinel node. Execution
`3524`, sub-execution `3525`:

```
NodeOperationError: No Webhook node found in the workflow
  at RespondToWebhook.node.ts:392
description: "Insert a Webhook node to your workflow and set the Respond parameter
              to Using Respond to Webhook Node"
```

- child execution status: **error**
- parent `Call Child` node status: **error**
- parent execution status: **error**

**It does not no-op. It hard-fails the entire execution, parent included.**

This retrospectively vindicates F4 as a **necessity, not a precaution**. Had P5.1 left the
internal path terminating at the existing `RespondToWebhook` nodes — which was the natural
thing to do, since they were already there — **every internal Mini App call would have failed
outright**, and the failure would have surfaced only on the first live internal execution.

Recorded exactly as observed, per the brief's instruction not to reinterpret the result.

---

## 4. What was NOT done

| Step | Status |
|---|---|
| P6-1 Bot_Sessions migration | **NOT DONE** — stop condition, §2.5 |
| P6-2 production `Submission_Receipts` | **NOT CREATED** |
| P6-3B internal candidate deploy | **NOT DEPLOYED** |
| P6-4 node/expression validity | **NOT RUN** |
| P6-5 preallocation canary | **NOT RUN** |
| P6-6 NEW canary | **NOT RUN** |
| P6-7 MERGE canary | **NOT RUN** |
| P6-7A RETRY canary | **NOT RUN** |
| P6-7B downstream side-effect inventory | **NOT RUN** |
| P6-8 public poisoning regression | **NOT RUN** |
| P6-9 Concierge production patch | **NOT APPLIED** |
| P6-10 gateway adapter canary | **NOT RUN** |
| P6-11 topology decision | see §6 |

---

## 5. A tooling fact worth recording for the next attempt

The `test_workflow` tool description states that "nodes with credentials … are pinned (use
simulated data)". **Observed behaviour differs, and the difference is load-bearing for P6.**

In execution `3520` the Google Sheets node ran for **978 ms** with a real network round trip
and returned live data; `pinData` contained only the trigger node. In execution `3521` it
returned the live header set.

**Only nodes for which `pinData` is explicitly supplied are pinned.** A credential-bearing node
with no pin data executes for real.

This means the CRM-writing canaries (P6-5 through P6-8) **are achievable** through
`test_workflow` once the schema question is settled — which is the opposite of what the tool
description implies, and worth knowing before the next attempt is planned.

---

## 6. P6-11 topology recommendation — **B, and the reasoning changed during P6**

**Recommendation: keep a dedicated internal Lead Intake workflow with no active public
webhook** (option B), rather than integrating the receipt branch into `QmIyEW2ZEqKregmN`.

The deciding factor is §2.2: **a live production workflow definition cannot be read from this
session at all** without enabling `availableInMCP` on it, which is forbidden. Option A requires
splicing into a graph that cannot be verified before or after the change — the drift check that
would make it safe is exactly the thing that is unavailable. Option B changes nothing about the
public workflow, so its correctness does not depend on a read that cannot be performed.

Against option B: graph duplication drift is real, and the two copies will diverge unless the
generator remains the single source. That is a maintenance cost, mitigated by
`scripts/build-lead-intake-receipt-candidate.mjs` regenerating byte-identically and by the
gate asserting all 57 inherited nodes stay parameter-identical.

**This is a recommendation, not a decision taken.** The brief permits the final topology
mutation only when it is unambiguously specified in the canonical P5 plan *and* every canary is
green. Neither holds.

---

## 7. Cleanup

Three disposable workflows were created and **all three archived**:

| ID | Name | Purpose |
|---|---|---|
| `crCKmRggIVAxzP0a` | `[TEMP] P6-0 Bot_Sessions header probe` | read-only header capture |
| `ay513cX8B8KBVn5p` | `[TEMP] P6-3A child sentinel` | return-contract child |
| `kaQ3JDu5L2RfJfwx` | `[TEMP] P6-3A parent` | return-contract parent |

Post-cleanup verification: **28 workflows** (the exact pre-P6 set), every one
`availableInMCP: false`, every `updatedAt` unchanged at `2026-08-25` or earlier. **One** data
table, the pre-existing B21B QA table.

**Production residue: NONE.** No sheet cell was written, no data table created, no workflow
modified, no row added anywhere. The only live reads were the `Bot_Sessions` header (names
only) and workflow metadata.

> **Superseded for later windows.** True as written, for the P6 window this section records.
> It no longer describes the tenant: the P6.3 supersede (2026-08-27) ran the canary live and
> wrote **two rows into the production `Pipeline` sheet** plus two `Submission_Receipts` rows.
> The ledger is `docs/P6_3_INTERNAL_ROUTE_DEFECTS.md` §7.8, and the CRM rows are the one item
> this repository's tooling cannot undo.

---

## 8. Residual blockers, in the order they must be resolved

1. **OWNER DECISION — the `Bot_Sessions` schema gap.** Six columns the Concierge writes have
   never persisted. Decide whether to (a) add all ten columns, accepting that the live
   Concierge then begins persisting cycle/consent state for real users, or (b) add the four
   B.2.1-C columns *and* remediate the six separately, or (c) treat the six as intentionally
   dead and re-derive what B.2.1-C actually needs. **B.2.1-C cannot proceed under any option
   until this is settled**, because the gateway reads `cycle_id`.
2. **The live-definition read gate.** The drift check P6-0 mandates is impossible while
   `availableInMCP` is false on production and enabling it is forbidden. Either grant a
   read path for the preflight, or accept `updatedAt` matching as the drift check and say so
   explicitly in the next brief.
3. **The pre-existing Concierge defect** — silently dropped writes — needs a remediation
   decision of its own. It is not a B.2.1-C bug.

---

## 9. Status

| Item | Status |
|---|---|
| P1-L2′ conditional claim under concurrency | **PASS** (P4) |
| P1-L3 read-after-write exact-key visibility | **PASS** (P4) |
| P1-L4 durability | **PARTIAL** — execution PASS, redeploy PASS, tenant restart **NOT TESTED** |
| P1-L5 / L6 / L7 | **NOT TESTED** — required live canaries not reached |
| P1-L8 retention duration | **DESIGN READY / OWNER DURATION OPEN** |
| P1-L9 correlation chain | offline PASS; **live NOT TESTED** |
| P1-L10 internal route | design PASS; **live NOT TESTED** |
| P1-L11 `Bot_Sessions.submission_key` | **FAIL — the column does not exist live** |
| **F4 sub-workflow return contract** | **PASS — proven live (§3)** |
| **G1** | **OPEN** — not "live functional proof", which requires P6-5…P6-8 |
| G5 durable initData replay | **OPEN** |
| **General Mini App activation** | **NOT CLEARED** |
| Downstream/activity audit gap | **OPEN — pre-activation follow-up**, unchanged and untested |

**B.2.1-C is NOT cleared.**

---

## 10. Boundaries observed

No production workflow created, modified, archived, activated or executed. No `availableInMCP`
change anywhere. No Google Sheets cell written. No Data Table created or written. No production
webhook called. No Telegram message sent. No AI call. No GA4, DNS or Cloudflare change. No API
key sought, read or used. No customer PII read into this document — the header probe was
rewritten mid-phase to emit column names only, before any value could be surfaced.
