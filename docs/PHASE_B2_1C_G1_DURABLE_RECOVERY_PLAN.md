# FINMENTOR — G1 durable idempotency / recovery architecture

Phase: **B.2.1-C live prerequisites, P1**
Date: 2026-08-26
Branch: `feat/miniapp-b21c-live-prereqs`
Base: `main` @ `d69e2e8e9c7156861e94738e3aedd5cf1ae7257e`

**G1 remains OPEN.** This document and the code beside it make G1 *buildable* and
*deployment-ready*. They do not close it. Nothing live was touched: no n8n, no Sheets, no
production webhook, no Telegram, no GA4, no DNS or Cloudflare.

---

## 1. The defect, restated from the actual graph

Read from `n8n/production/QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json`, not
from memory. The canonical path is:

```
Webhook → Validate Payload → IF Valid → Read Settings → Settings to Object
  → Normalize + Score Lead → Read Pipeline (Dedup) → Dedup Guard → IF Is New
       ├── TRUE  → Build Pipeline Row → Save to Pipeline ──► Respond New Lead → (side effects)
       └── FALSE → IF Is Retry ─ FALSE → Build Merge Update → Update Pipeline (Merge) ──► Respond Merged
```

**The canonical commit is `Save to Pipeline` / `Update Pipeline (Merge)`.** The respond node
fires *immediately* after it — before the CRM sheet, Telegram, the AI plan and the dashboard.
So the window is narrow, but it is real and it is unrecoverable: the Pipeline row exists and
the caller may never learn its `lead_id`.

Nothing in the tenant is indexed by the gateway's stable key
`miniapp:<telegram_user_id>:<cycle_id>`, so a retry cannot ask *"did my submission commit?"*.
It can only submit again and hope. That is G1.

---

## 2. Architecture decision

### 2.1 Candidates assessed

| | **A. Pipeline field** | **B. Bot_Sessions** | **C. read-model Data Table** | **D. dedicated receipt ledger** |
|---|---|---|---|---|
| Durability | Google-backed, high | Google-backed, high | derived cache, tombstoned | Google or Data Table, TBD live |
| Exact-key lookup | column exists (AZ) but semantics wrong | keyed by `chat_id`, not by submission | keyed by `chat_id` | **keyed by the stable key** |
| Atomicity / CAS | **none** — Sheets has no conditional append | none | CAS proven live (Phase 10) | **CAS required, and declared** |
| Ambiguity coverage | cannot represent "attempted" | binding written only *after* Intake returns | n/a | **PENDING vs COMMITTED** |
| Merged-lead behaviour | **merge overwrites `request_id`** | n/a | n/a | **one receipt per submission** |
| Multi-cycle retention | one row per lead → later cycle overwrites | one row per user → overwrites | one row per user | **one row per cycle** |
| Overwrite risk | **high — destroys older evidence** | **high** | rows are removed on failure | **none; COMMITTED is terminal** |
| Authority semantics | Pipeline becomes recovery authority | circular: gateway proving a downstream fact from its own record | **turns a deliberately derived store into an authority** | **narrow: one question only** |
| Operational simplicity | none needed | none needed | none needed | one new table |
| Data minimisation | lead row already holds PII | already holds PII | already holds PII | 11 fields; **contains an identifier** — see §3.1 |

### 2.2 Why each rejection

**A — Pipeline field. REJECTED.** Column **AZ is `request_id`**, and the attribution schema's
own merge rule is *"take the new value when non-empty"*. A later cycle's merge therefore
**overwrites** it. That is precisely the failure the brief names: a mutable field on a lead
row whose future cycles destroy the evidence needed to resolve an older ambiguous submission.
`request_id` is also client-minted and explicitly **not** a dedup identity (`REQUEST_ID_SEMANTICS`,
gap G7). Adding a *second* Pipeline column would inherit the same overwrite-on-merge problem
and would still have no conditional append to enforce uniqueness. A broad Pipeline scan is
excluded by RECOVERY_ADAPTER_CONTRACT and is not proposed.

**B — Bot_Sessions. REJECTED,** for the reason the brief states: the canonical lead binding is
written only *after* Lead Intake returns, so a death between commit and return leaves
Bot_Sessions holding nothing. It is also one row per `chat_id`, so cycle 2 overwrites cycle 1.
And it is circular — the gateway would be proving a downstream commit from its own record.

**C — read-model Data Table. REJECTED.** Phase 10 established it as derived and
non-authoritative, invalidate-on-doubt, removed on failure paths. Making it answer "did a lead
commit" converts a deliberately derived cache into an authority, which is exactly the failure
mode requirement 7 forbids.

**E — an existing canonical store. NONE FITS.** Stated plainly rather than inferred: the
repository documents Google Sheets tabs (`Pipeline`, `Lead_Answers`, `Settings`, `Activity`,
`Dashboard_Feed`, `Bot_Sessions`) and one n8n Data Table (the read-model mirror). **No existing
store is keyed by a submission**, and **Google Sheets has no conditional append** — the
remediation report's own residual risk, and the reason two simultaneous first-time submissions
can still create two rows. No existing store can enforce one-receipt-per-key.

### 2.3 Chosen — **D, the smallest dedicated durable receipt ledger**

`Submission_Receipts`: one record per stable key, written by **Lead Intake**, read by the
gateway's recovery adapter, and by nothing else.

**Written by Lead Intake, not by the gateway.** Only the workflow that performs the Pipeline
write can observe its outcome. A gateway-side receipt could never say more than "I tried".

**Substrate: an n8n Data Table**, separate from the read-model mirror. Chosen because Phase 10
already proved the conditional-update (CAS) primitive live in this tenant, and Sheets provably
cannot enforce uniqueness. **The atomic insert-if-absent primitive is a distinct capability
that Phase 10 did NOT prove**, so it is a named live prerequisite (§7) and the code fails
closed without it rather than assuming it.

**Why this is not a second authority.** The ledger answers exactly one question — *did the
submission for this key reach a canonical Pipeline commit, and which lead did it produce* — and
is never consulted for lead state, never written by the gateway, never read by the Mini App and
never mirrored. `Pipeline` stays canonical for lead state; `Bot_Sessions` stays authority for
cycle, consent and the canonical lead binding.

---

## 3. Receipt schema

Eleven fields. Each justified; the notable ones are those deliberately **absent**.

| Field | Why |
|---|---|
| `idempotency_key` | unique. The only lookup key. Exact match, never prefix or scan |
| `commit_state` | `PENDING` \| `COMMITTED` \| `ABORTED` |
| `canonical_lead_id` | empty while `PENDING`; written exactly once at| `commit_state` | `PENDING` | `COMMITTED` | `ABORTED` |
| `lead_mode` | needed to replay the canonical success verbatim |
| `lead_priority` | ditto |
| `financial_zone` | ditto |
| `created_at` | when intent was written |
| `committed_at` | when the Pipeline commit was observed |
| `aborted_at` | when an operator **proved** no commit happened (P1.1, §6.2) |
| `abort_reason` | constrained vocabulary, never free text |
| `correlation_id` | server-minted; traces one attempt through the logs |

**Absent on purpose:** `telegram_user_id` and `cycle_id` — both are *derivable from the key*,
so the identity is stored once rather than twice. Contact details, answers and free text — the
ledger resolves an outcome, it does not describe a lead. `init_data`, hashes, signatures,
tokens — never. `request_id` — storing it here would invite exactly the confusion G7 records.

**Uniqueness:** exactly one receipt per key, for all time, enforced by atomic
insert-if-absent. Where a store cannot enforce it, duplicates are **detected and fail closed** —
never resolved to a winner.

**Transitions:** `PENDING → COMMITTED` or `PENDING → ABORTED`. Both end states are terminal:
no path back, no path to a second `lead_id`, and no promotion of an `ABORTED` receipt.

### 3.1 Privacy — correcting an overclaim (F3)

P1 said the ledger adds "no new PII". **That was too strong and is withdrawn.** Not
duplicating `telegram_user_id` into its own column is a genuine minimisation, but the
identifier is still **physically stored inside `idempotency_key`**, which is
`miniapp:<telegram_user_id>:<cycle_id>`. A store containing that string contains a Telegram
user identifier, whatever the column is called.

**Decision: RAW KEY ACCEPTABLE.** Reasoning, including why the stronger option was rejected:

| Option | Assessment |
|---|---|
| **A. raw stable key** | exact deterministic lookup, no secret, no lifecycle. Stores an identifier. **CHOSEN** |
| **B1. SHA-256 digest** | The input space is **enumerable**: Telegram ids are numeric and cycle ids are date-shaped (C-2026-08-26-01). Anyone holding the ledger can brute-force the whole space in seconds. It provides the *appearance* of protection and essentially none of the substance — which is worse than storing the identifier openly, because it invites the reader to believe the problem is solved |
| **B2. HMAC-SHA-256 with a server secret** | Genuinely resistant. But the secret becomes a **single point of permanent recovery failure**: lose or rotate it and every existing receipt becomes unfindable, because re-deriving requires the raw keys the design deliberately no longer holds. Rotation is impossible without keeping a raw-key mapping, which defeats the purpose. For a store whose *entire reason to exist* is making recovery possible, that trades a real availability risk against a modest confidentiality gain |

The identifier is already stored in `Bot_Sessions` and in the Pipeline `telegram` column. The
ledger adds a **third location**, not a new category of data. Introducing a secret to move
one identifier from three places to two-and-a-digest is not a proportionate trade — and the
brief is explicit that a secret must not be introduced casually.

**Consequences of choosing the raw key, and these are binding:**

- the ledger is classified as **containing a personal identifier**, not as identifier-free;
- it enters the retention and access-control scope of **P1-L8**, which is upgraded from a
  retention question to a retention **and access-control** requirement;
- **no raw key in any log line** — already enforced: `receiptLogView` emits a truncated
  SHA-256 digest of the key and never the key, the identity or the lead id;
- if the owner later prefers B2, the change is contained — one derivation function at the
  write and read boundary — but the secret lifecycle must be designed first, not after.

---

## 4. Commit-point analysis — the heart of it

### 4.1 Why one phase cannot work

A receipt written only *after* the Pipeline commit leaves absence ambiguous forever: no row
could mean "never submitted" **or** "committed, then died before the receipt". A one-phase
receipt can therefore only ever prove `COMMITTED` — and the other half is G1's whole
difficulty.

### 4.2 The ordering

```
Dedup Guard decides new-vs-merge
      │
      ▼
① INTENT  — insert-if-absent { key, PENDING }        ◄── BEFORE the Pipeline write
      │
      ▼
   Save to Pipeline  /  Update Pipeline (Merge)       ◄── THE CANONICAL COMMIT
      │
      ▼
② COMMIT  — update { COMMITTED, canonical_lead_id }  ◄── AFTER commit, BEFORE respond
      │
      ▼
   Respond New Lead / Respond Merged
      │
      ▼
   gateway → Bot_Sessions canonical binding (authority-first, unchanged)
```

Write ② **before** the respond node, not after. If it were after, a death on the response leg
would leave a committed lead with a `PENDING` receipt — recoverable only by an operator, which
is exactly the state we are trying to eliminate.

### 4.3 Compensation model

There is **no distributed transaction** across a Data Table and Google Sheets, and this
document does not pretend otherwise. What the two-phase ordering buys is that **every residual
window is a safe one**:

| Dies at | Ledger | Pipeline | Retry sees | Safe? |
|---|---|---|---|---|
| before ① | no row | no row | `NOT_COMMITTED` → one fresh attempt | ✅ |
| between ① and the Pipeline write | `PENDING` | no row | `CANNOT_ANSWER` | ⚠️ safe, operator-resolved |
| between the Pipeline write and ② | `PENDING` | **row exists** | `CANNOT_ANSWER` | ⚠️ safe, operator-resolved |
| between ② and respond || `commit_state` | `PENDING` | `COMMITTED` | `ABORTED` | row exists | `COMMITTED` → replays the lead | ✅ **G1's target case** |
| after respond || `commit_state` | `PENDING` | `COMMITTED` | `ABORTED` | row exists | `COMMITTED` | ✅ |

The two `PENDING` rows are the irreducible residual. Both are **fail-safe**: they never permit
a fresh submit and never invent a lead. Neither is silently stranded — the operator resolution
is named in §6.

---

## 5. Lookup semantics

| Ledger state | Answer | Gateway effect |
|---|---|---|
| exactly one row, `COMMITTED`, non-empty lead id | `{ ok: true, known: true, body }` | replays the canonical success; zero Intake calls |
| no row **and** preconditions hold | `{ ok: true, known: false }` | releases the claim; exactly one fresh attempt |
| no row, preconditions **not** proven | `{ ok: false }` | ambiguity preserved |
| row `PENDING` | `{ ok: false }` | ambiguity preserved |
| >1 row for the key | `{ ok: false }` | ambiguity preserved |
| `COMMITTED` with empty lead id | `{ ok: false }` | ambiguity preserved |
| unknown state / unreadable rows | `{ ok: false }` | ambiguity preserved |
| store error, **including `ok:false` with `rows: []`** | `{ ok: false }` | ambiguity preserved |
| key not the exact server shape | `{ ok: false }` | ambiguity preserved |
| **any returned row whose stored key is not exactly the queried key** | `{ ok: false }` | ambiguity preserved (F1) |
| **any returned row with a missing / non-string / empty key** | `{ ok: false }` | ambiguity preserved (F1) |
| receipt `ABORTED` | `{ ok: true, known: false }` | **proven** not-committed; one fresh attempt |

### 5.0 A broken exact-key contract proves nothing (F1)

The first implementation **filtered** foreign rows away and judged what remained. That is
unsafe in a specific and severe way: a store answering `readByKey(K)` with a row for some
other key would filter down to zero rows, classify as `ABSENT`, and — with read-after-write
affirmed — become `NOT_COMMITTED`. The gateway would then release the claim and submit again,
**on the word of a store that had just demonstrated it cannot answer by key at all**.

So there is no filtering. **Every** returned row must be exactly the queried key, compared as
a **raw string with no trimming** — the query key and both writers are exact-form already, so
a padded stored key is a corrupted record, not a match to be repaired. Any deviation discards
the whole response as `LOOKUP_CONTRACT_VIOLATION`, and a row with a missing, empty or
non-string key as `RECEIPT_KEY_MISSING`. Only a clean, genuinely empty exact-key result may
become an absence.

### 5.1 Can `NOT_COMMITTED` ever be proven from absence?

**Yes — but only under stated preconditions, and the code refuses to assert it otherwise.**
This is the single inference that can create a duplicate lead if it is wrong.

1. **intent-before-commit** — the `PENDING` row is written before the Pipeline write, always.
2. **no pre-ledger submissions** — the gateway already refuses to submit at all without a
   recovery adapter (`PRE_ACTIVATION_BLOCKED`), so no key can predate the ledger. This
   interlock is what makes absence meaningful rather than merely old.
3. **read-after-write** — a committed intent row is visible to the very next read of that key.
4. **exact-key lookup** — selection by key equality, never scan or prefix.

(3) is a **live property of the store that this repository cannot prove offline**. So
`createRecoveryAdapter` reads it from `store.capabilities()` and, when it is not affirmed,
**downgrades absence to `CANNOT_ANSWER`**. An adapter that guesses here is worse than no
adapter, because the existing structural blocker at least fails safe.

### 5.2 Activation requires all three capabilities (F2)

`recoveryAdapterStatus` unblocks the gateway by finding a **callable `lookup`** — nothing
more. So an adapter built over a store that had proven only exact-key lookup would remove
`PRE_ACTIVATION_BLOCKED` while two of the three properties the recovery depends on were still
unproven. The blocker would come off early, and it is the blocker that currently guarantees no
unrecoverable submission is ever started.

`createRecoveryAdapter` therefore requires **all three**, each with its own reason:

| Capability | Missing → | Why it gates activation |
|---|---|---|
| `exact_key_lookup` | `NO_EXACT_KEY_LOOKUP` | without it the store must scan, which is not a lookup |
| `atomic_insert_if_absent` | `NO_ATOMIC_INSERT_IF_ABSENT` | without it two receipts can exist for one key and the ledger cannot hold its own uniqueness rule |
| `read_after_write` | `NO_READ_AFTER_WRITE` | without it absence can never mean `NOT_COMMITTED`, so the adapter can never release a claim and is not a recovery at all |

A refusal returns **no `adapter` object at all**, so the gateway stays structurally blocked
rather than acquiring a lookup that fails later.

**Diagnostic tooling is a separate constructor.** `createDiagnosticProbe` exists for operator
inspection during a canary, tolerates the two unproven capabilities, and exposes its method as
**`probe`, never `lookup`**. That naming is the safety property: an object with no `lookup`
cannot satisfy `recoveryAdapterStatus` however it is wired. It still refuses a scan-only
store, because a probe that scanned would be lying about what it inspected.

**A capability flag is an assertion, not a measurement.** Affirming all three does not make a
store durable across a redeploy or restart. Durability stays **P1-L4**, a live canary, and
nothing in the code claims otherwise.

---

## 6. Failure matrix and operator resolution

| Failure | Detected as | Resolution |
|---|---|---|
| store unreachable | `CANNOT_ANSWER` | retry later; claim preserved |
| store reports failure but returns `[]` | `CANNOT_ANSWER` | verdict is judged before rows |
| duplicate receipts | `DUPLICATE_RECEIPTS` → `CANNOT_ANSWER` | operator removes the spurious row |
| `PENDING` beyond a threshold | `PENDING_UNRESOLVED` → `CANNOT_ANSWER` | **operator resolution**, §6.1 |
| commit onto a different lead | `planCommit` → `CONFLICTING_LEAD_ID`, refuses | investigate; never overwrite |
| malformed receipt | `CANNOT_ANSWER` | operator repairs or removes |
| caller-supplied key | refused by shape check | none needed |

### 6.1 Resolving a stuck `PENDING` — corrected (F4)

**P1 was wrong here and the claim is withdrawn.** It said "the receipt carries the key; the
Pipeline row for that submission can be found by an operator performing a targeted lookup".
**Pipeline does not store the idempotency key.** It never has. The stable key can therefore
never find a Pipeline row, and no amount of operator diligence changes that.

**The chain that does exist**, verified against the actual modules rather than assumed:

```
gateway correlationId
  → envelope.payload.meta.request_id      (submit-contract.js, buildLeadIntakePayload)
  → requestId                             (normalize-score-lead.js, trimmed to 80 chars)
  → Pipeline column AZ request_id       (build-pipeline-row.js)
```

So an operator **can** correlate a receipt to a Pipeline row — **provided the receipt's
`correlation_id` was seeded from the same `meta.request_id`**, which is a wiring requirement
on the Lead Intake side (**P1-L9**, new), not something the current export does.

**And the correlation is not durable.** `build-merge-update.js` sets
`upd.request_id = advance(ex.request_id, item.request_id)` — the attribution schema's rule is
*"take the new value when non-empty"*. **A later merge onto that lead overwrites AZ**, and the
older receipt's `correlation_id` stops matching. The correlation therefore holds only until
the first subsequent merge.

**Status: operator recovery is PARTIAL.** It works for a recently-created lead that has not
yet been merged onto, it requires P1-L9 wiring, and it degrades silently over time. Nothing in
this design should be read as promising a durable operator path from a receipt to a Pipeline
row. The alternative remains, unchanged and unaffected: writing the canonical binding to
`Bot_Sessions`, which the authority branch resolves with no adapter involved.

### 6.2 Operator runbook — what may and may not be done

**Never delete a `PENDING` or duplicate receipt to make a lookup return an absence.** The same
gesture applied to a receipt that *did* commit manufactures a duplicate lead, and at the moment
the operator is looking at it they cannot tell the two cases apart — that is why it is stuck.

The order is fixed:

1. **Establish whether a canonical Pipeline commit exists** for this submission — via the
   `correlation_id` → `request_id` → AZ chain above, with its stated limits, or by any other
   evidence. Do not proceed on a hunch.
2. **If a canonical lead exists** → converge the receipt to `COMMITTED` with that
   `canonical_lead_id`. `planCommit` refuses a second, different lead id, so a mistake here
   fails closed rather than overwriting evidence.
3. **Only a PROVEN non-commit** may be cleared — and it is cleared by moving the receipt to
   `ABORTED`, never by deleting it.
4. **If it remains ambiguous, leave it ambiguous.** `CANNOT_ANSWER` is a correct, safe
   outcome. A user on a stuck cycle is freed by a Concierge cycle change, which mints a new
   key and touches nothing.

### 6.3 The `ABORTED` terminal state — REQUIRED, and why

Assessed rather than assumed. **It is required**, because without it step 3 above has no safe
implementation: the only way to clear a proven non-commit would be deleting the row so that
absence answers for it — precisely the gesture the runbook forbids. Adding a positive terminal
state makes the forbidden gesture unnecessary.

Its semantics are provable offline, which is the condition for adding it:

| Transition | Legal | Why |
|---|---|---|
| `PENDING → ABORTED` | ✅ | the only entry; an operator proved no commit exists |
| `COMMITTED → ABORTED` | ❌ | would discard the evidence that resolves an ambiguity |
| `ABORTED → COMMITTED` | ❌ | if an abort was wrong, the repair is a new cycle, not rewriting history |
| `ABORTED → PENDING` | ❌ | terminal |

`ABORTED` resolves to `NOT_COMMITTED` as **positive evidence**, so — unlike an absence — it
does **not** depend on the store's read-after-write behaviour. `abort_reason` is a constrained
vocabulary (`PROVEN_NO_PIPELINE_COMMIT`) rather than free text, because an operator note is
exactly where a customer name or a phone number ends up.

---

## 7. Live prerequisites — why G1 is still OPEN

Nothing below can be established offline. Each is a canary.

| # | Prerequisite | Why it cannot be proven here |
|---|---|---|
| **P1-L1** | The `Submission_Receipts` table exists with the nine fields | schema creation is a live change |
| **P1-L2** | **Atomic insert-if-absent** under genuine concurrency | Phase 10 proved conditional *update*, not insert-if-absent |
| **P1-L3** | **Read-after-write** for a key just written | gates whether absence may ever mean `NOT_COMMITTED` |
| **P1-L4** | Durability across workflow redeploy and n8n restart | the in-memory double proves nothing about this |
| **P1-L5** | The stable key **reaches Lead Intake** in the payload | today the outbound envelope carries no key — **contract change, owner approval** |
| **P1-L6** | Intent write ordered strictly before `Save to Pipeline` | workflow wiring, observable only live |
| **P1-L7** | Commit write ordered before the respond node | ditto |
| **P1-L8** | Retention **and access control** for receipts across many cycles — the ledger holds a personal identifier (§3.1), so this is not merely a housekeeping question | live data-retention and access decision |
| **P1-L9** | Lead Intake seeds `receipt.correlation_id` from the same `meta.request_id` it writes to Pipeline AZ | wiring, observable only live — and see §6.1: the correlation is overwritten by a later merge regardless |

**P1-L5 is an owner decision.** The stable key must travel into the Lead Intake payload so
Lead Intake can write it, and gateway contract §2 freezes the Lead Intake contract. The
gateway side of that (`meta.idempotency_key`, or a dedicated envelope field) is **not**
implemented here, because implementing it would be changing a frozen contract without approval.

### Rollback

The ledger is additive. Rollback is: stop writing receipts, remove the adapter from the
gateway wiring, and the gateway returns to `PRE_ACTIVATION_BLOCKED` — its current, safe,
pre-P1 state. No lead, Pipeline row or `Bot_Sessions` row is affected, because the ledger
never writes to any of them.

---

## 8. What was implemented in the repository

| Path | Role |
|---|---|
| `n8n/src/lead-intake/idempotency-receipt.js` | Lead Intake side: key validation, intent/commit record building, transitions, conflict detection, row classification, PII-free log view |
| `n8n/src/miniapp-submit/recovery-adapter.js` | Gateway side: `lookup(key)` implementing the declared `RECOVERY_ADAPTER_CONTRACT` over an injected store; capability gating; fail-closed everywhere |
| `qa/idempotency-receipt.test.mjs` | 35 checks, gate 9 |

Both modules are pure and perform **no I/O**. The gate's in-memory store is a **double** and is
labelled as one in the file header: it models the contract so the decision logic can be proven
with no tenant, and it proves nothing about durability, atomicity or read-after-write.

Ten mutations were run against the load-bearing controls; each failed exactly the checks that
exist to catch it: absence answered without read-after-write, duplicate receipts resolved to a
winner, `PENDING` read as negative, conflicting lead id accepted, exact match weakened to a
prefix, key-shape validation removed, a scan-only store accepted, the raw key leaked into the
log, `COMMITTED`-without-lead accepted, and a store error read as absence.

Two coverage gaps were found by that harness and closed rather than explained away: the store
double's own correct filtering was masking the ledger's independent key re-check, and a store
reporting failure while returning an empty array was not covered.

---

## 9. G5 relationship

**G5 SAME STORE: CONDITIONAL — and not now.**

The mechanism generalises: a one-time `initData` ledger is the same shape — a durable record
keyed by a server-derived value, created atomically, where "already present" is the answer.
P1-L2 and P1-L3 are exactly the capabilities it needs, so proving them for G1 proves the
substrate for G5.

But the **semantics must not be mixed**, and the table must not be shared:

- different keys — a `query_id`/nonce is not a submission key, and one namespace inviting a
  collision between them is a defect waiting to happen;
- **opposite meanings of presence** — for G1, a receipt means "this succeeded, replay it"; for
  G5, presence means "this was already used, **refuse** it". One table where presence means
  two opposite things is an outage in waiting;
- different retention — receipts persist per cycle for recovery; nonces expire with the
  freshness window;
- different blast radius — a corrupt receipt strands one submission; a corrupt nonce ledger
  can lock every user out of bootstrapping.

**Ruling:** G5 may reuse the same *substrate and primitives* once P1-L2 and P1-L3 are proven
live, in a **separate table with its own schema**. It must not reuse this table.
**G5 is NOT closed and is not implemented here.**

---

## 10. Status

**G1: DESIGN-READY, STILL BLOCKED FOR ACTIVATION.**

The architecture is decided, the decision logic is implemented and mutation-proven offline,
and the adapter satisfies the contract the gateway has required since N6.1. What does not
exist is the durable store itself, the capability proof for insert-if-absent and
read-after-write, and the payload change that carries the stable key into Lead Intake — the
last of which is an owner decision against a frozen contract.

P1.1 closed four pre-live review findings: exact-key lookup now fails closed on any contract
violation (F1); activation requires all three capabilities, with diagnostic tooling moved to a
constructor that structurally cannot unblock the gateway (F2); the "no new PII" claim is
withdrawn and the raw-key decision is made explicitly, with the ledger classified as holding an
identifier (F3); and the operator-recovery claim is corrected — Pipeline does not store the
key, the real correlation chain is documented with its merge-overwrite limit, and a provable
`ABORTED` terminal state replaces the forbidden delete-to-clear gesture (F4).

Until P1-L1 … P1-L9 are executed and recorded, **B.2.1-C is NOT CLEARED**, G1 remains the
activation blocker, and the fifteen B.2.1-C canaries remain unexecuted.
