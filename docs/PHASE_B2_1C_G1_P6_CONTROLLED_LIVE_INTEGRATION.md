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
