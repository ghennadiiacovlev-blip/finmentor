# FINMENTOR — G1 durable idempotency / recovery architecture

Phase: **B.2.1-C live prerequisites, P1**
Date: 2026-08-26
Branch: `feat/miniapp-b21c-live-prereqs`
Base: `main` @ `d69e2e8e9c7156861e94738e3aedd5cf1ae7257e`

> **STATUS SUPERSEDED, 2026-08-27 (P6.4).** G1 is now **LIVE FUNCTIONAL PROOF PASS**. This
> document is the P1 architecture and its status verdicts are historical — including the P2
> substrate finding below, which stands as evidence but no longer as a blocker: **P1-L2 is
> RETIRED**, replaced by **P1-L2′** at Model B P3 and proven live at P4. The current register is
> `docs/PHASE_B2_1C_G1_P6_CONTROLLED_LIVE_INTEGRATION.md` §D.

**G1 remains OPEN.** *(as of P1, 2026-08-26 — see the banner above.)* This document and the code
beside it make G1 *buildable* and *deployment-ready*. They do not close it.

> ## ⚠ SUBSTRATE ASSUMPTION FAILED LIVE — P2, 2026-08-26
>
> **P1-L2 FAILED.** The n8n Data Table **cannot enforce one-receipt-per-key**. There is no
> atomic insert-if-absent primitive on the `dataTable` node, and a duplicate for one key was
> created live in two ordinary API calls. Evidence:
> `docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md`.
>
> The **decision logic** in this document is unaffected and still holds — including the
> defence in depth that makes duplicates fail closed. What does not hold is §2.3's choice of
> **substrate**. Everything below that names the n8n Data Table as the store should be read as
> *the design as proposed in P1*, pending the owner's substrate decision.
>
> The leading candidate that P2 did **not** rule out: pre-create the receipt row at cycle
> issuance (single-writer, no concurrency), so the submit path only ever does a **conditional
> UPDATE** — a primitive Phase 10 *did* prove live. That is P3 work, not a change made here.

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
that Phase 10 did NOT prove**, so it was made a named live prerequisite (P1-L2) and the code
fails closed without it rather than assuming it.

> **P2 outcome, 2026-08-26: that prerequisite FAILED.** The `dataTable` node's row operations are
> `deleteRows` · `get` · `rowExists` · `rowNotExists` · `insert` · `update` · `upsert` —
> none of them an atomic insert-if-absent. `insert` is unconditional, `upsert` is
> match-then-write, and `rowExists`/`rowNotExists` + `insert` is the "broad lookup + create"
> this design forbids. Confirmed empirically: two inserts of the same key both returned
> `insertedCount: 1`. **Making the prerequisite explicit is what caught this** — an
> assumed capability would have shipped. The substrate choice now returns to the owner.

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
| `canonical_lead_id` | empty while `PENDING`; written exactly once at `COMMITTED` |
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

**Uniqueness:** never more than one receipt row per key, enforced by atomic insert-if-absent.
Where a store cannot enforce it, duplicates are **detected and fail closed** — never resolved
to a winner.

> **P2: the n8n Data Table is such a store.** It does not enforce uniqueness, so on that
> substrate the fail-closed path is not a fallback but the *normal* outcome under concurrency —
> and a ledger that routinely answers `CANNOT_ANSWER` stops recovering exactly when recovery is
> needed. Failing safe is not the same as working. See the P2 canary document.

**Lifecycle (P1.3).** "For all time" was withdrawn: it contradicted P1-L8, which requires a
retention policy precisely because the key contains a personal identifier (§3.1). Leaving both
in place would have let whoever implements retention pick either reading. The precise invariant:

| Rule | |
|---|---|
| **Must exist while** | the key can still be presented — i.e. its cycle can still pass the authority and session guards |
| **Never expires while** | the cycle is current or still recoverable |
| **May be deleted only when** | the receipt is terminal (`COMMITTED` / `ABORTED`) **and** the cycle is irreversibly superseded **and** the approved retention period has elapsed — all three |
| **Never** | a deletion that turns a still-acceptable key into an ABSENCE; a deletion used to reopen a key; a deletion of a `PENDING` receipt to make a lookup answer |

**Why retention and recovery do not actually conflict.** A submit arriving on a superseded
cycle is refused at §9.2 with `CYCLE_SUPERSEDED` **before the ledger is consulted at all**. So
an old key becomes structurally unreachable the moment its cycle is superseded, and a receipt
that can never be looked up again is safe to delete. Deleting one whose cycle can still be
presented is not: the lookup would find nothing, read the absence as `NOT_COMMITTED`, release
the claim and authorise a fresh submit for a key that may already have a lead. **The ordering
is the invariant; the duration is an owner input.**

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
- **no raw key in any log line, and nothing derived from it either** — see §3.2;
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
| between ② and respond | `COMMITTED` | row exists | `COMMITTED` → replays the lead | ✅ **G1 target case** |
| after respond | `COMMITTED` | row exists | `COMMITTED` | ✅ |

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
| receipt `ABORTED` | `{ ok: false }` | key is closed; server log names `ABORTED_REQUIRES_NEW_CYCLE` (F5) |

### 3.2 The key digest is removed, and its claim withdrawn (F6)

P1.1 logged a truncated SHA-256 of the stable key and described it as *"not reversible into an
identity"*. That could not stand beside §3.1, which rejects plain SHA-256 as meaningful
pseudonymisation **for exactly the same reason**: the input space is enumerable — Telegram ids
are numeric, cycle ids are date-shaped — so the whole space is brute-forced in seconds. One
document cannot call the same construction worthless in one section and anonymising in another.

A deterministic, unsalted digest of an identifier is a **pseudonymous identifier**, not
anonymised data. It carries the same obligations as the identifier it is derived from, and
calling it otherwise is the kind of overclaim that gets quoted back in a privacy review.

**So the digest was removed, not re-worded** — and nothing replaced it, because nothing needed
to. `correlation_id` is already server-minted (`crypto.randomUUID`), already on the receipt,
and contains no Telegram identifier at all. It correlates log lines about one submission
perfectly well, which was the digest's only job. **No new field, no new secret, no HMAC
introduced for logging.**

The log view is now exactly: `commit_state`, `has_lead_id`, `verdict`, `reason`,
`correlation_id`. A gate check asserts that shape, that no field name matches
digest/hash/fingerprint/pseudonym, and that no log branch — success, absence, pending, store
error — emits the key.

One consequence found while proving it: **`correlation_id` must not be derived from the key**.
A fixture built it as `CID-<key>` and put the identifier straight back into the logs the
digest had just been removed from. `buildIntent` now refuses a correlation id containing the
key (`CORRELATION_ID_DERIVED_FROM_KEY`), so the trap is closed at source rather than in a
fixture.

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

### 5.1.1 ABORTED closes the key — it does not license a retry (F5)

P1.1 had `ABORTED` answer `{ ok: true, known: false }`, which the submit handler reads as
"release the claim and make one fresh Lead Intake call". That was **internally
contradictory**, and the contradiction is worth stating precisely because it is not obvious:

The stable key is derived from `(telegram_user_id, cycle_id)`. A "fresh" attempt after an
abort is still the same user on the same cycle, so it carries **the same key**. But the ledger
holds at most one receipt per key and `ABORTED` is terminal — so the new intent
could not satisfy insert-if-absent. Every escape route was already forbidden: deleting the
row, overwriting `ABORTED`, weakening uniqueness, or writing a second receipt for one key.

**Resolution: `ABORTED` is a property of the KEY, not of one attempt.**

> *this submission was proven not to have committed, **and this key is now closed**.*

So the adapter returns `{ ok: false }` for an aborted key and the server log names
`ABORTED_REQUIRES_NEW_CYCLE`. **No fourth client-visible outcome was invented** — the
three-state adapter contract is unchanged, and the browser still sees only the existing
`SUBMIT_UNRESOLVED`.

**Same-cycle retry after an abort: REFUSED. A new cycle is REQUIRED.**

Recovery is therefore the mechanism the Concierge already provides and B.2.1 already proves:

```
operator proves no commit  →  receipt ABORTED (terminal, immutable)
Concierge issues a NEW authoritative cycle
      →  app session re-binds to it
      →  a NEW stable key is minted
      →  normal submit, normal intent, normal receipt
```

An aborted cycle is simply a superseded one, and **the old cycle cannot be reused by
accident**: a submit arriving on the stale binding is refused with `CYCLE_SUPERSEDED` at §9.2,
before the ledger is consulted at all. Two independent controls, tested separately.

**What `ABORTED` still earns**, now that it no longer authorises retry: an immutable record
that an operator investigated and proved no commit — which a deletion would destroy; an
explicit terminal state, so a closed key stops looking like a `PENDING` row somebody will
eventually be tempted to delete; and a defined end for the runbook that is not "remove the
evidence".

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

**Status: operator recovery is PARTIAL, and stays PARTIAL.** It is not upgraded to PROVEN and
must not be described as such. Stated as rules rather than caveats, because each one is a way
somebody could get this wrong:

- **`idempotency_key` does NOT locate a Pipeline row.** Pipeline does not store it and never
  has. Only the `correlation_id` → `meta.request_id` → AZ chain correlates, and only under
  the two conditions above. A gate check asserts the key never even reaches the envelope.
- **Correlation recovery is best-effort and TIME-SENSITIVE, not immutable.** AZ is overwritten
  by the next merge onto that lead.
- **A `PENDING` receipt that can be proven neither committed nor non-committed stays
  `CANNOT_ANSWER`.** Indefinitely, if that is the truth. An ambiguous receipt is a correct
  outcome, not a task to be closed.
- **Never mark `ABORTED` because a correlation lookup failed.** Absence of a matching
  Pipeline `request_id` is **not** proof of non-commit once overwrite is possible — the row
  may exist with a newer `request_id`. `buildAbort` accepts exactly one reason,
  `PROVEN_NO_PIPELINE_COMMIT`, and refuses `CORRELATION_LOOKUP_FAILED` and
  `NOT_FOUND_IN_PIPELINE`, so this shortcut is refused in code and not only in prose.

The alternative remains, unchanged and unaffected: writing the canonical binding to
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
   `ABORTED`, never by deleting it. **Aborting closes the key; it does not free the user.**
   Per §5.1.1 the same cycle can never submit again, so an abort must be followed by the
   Concierge issuing a **new authoritative cycle**, which mints a new key. An abort without
   that follow-up leaves the user unable to submit until the cycle changes anyway.
4. **If it remains ambiguous, leave it ambiguous.** `CANNOT_ANSWER` is a correct, safe
   outcome. A user on a stuck cycle is freed by a Concierge cycle change, which mints a new
   key and touches nothing.

### 6.3 The `ABORTED` terminal state — REQUIRED, and why

Assessed rather than assumed. **It is required**, because without it step 3 above has no safe
implementation: the only way to clear a proven non-commit would be deleting the row so that
absence answers for it — precisely the gesture the runbook forbids. Adding a positive terminal
state makes the forbidden gesture unnecessary.

Its meaning was corrected in P1.2 (§5.1.1): it closes the KEY, and does **not** authorise a
same-key retry. Its semantics are provable offline, which is the condition for adding it:

| Transition | Legal | Why |
|---|---|---|
| `PENDING → ABORTED` | ✅ | the only entry; an operator proved no commit exists |
| `COMMITTED → ABORTED` | ❌ | would discard the evidence that resolves an ambiguity |
| `ABORTED → COMMITTED` | ❌ | if an abort was wrong, the repair is a new cycle, not rewriting history |
| `ABORTED → PENDING` | ❌ | terminal |

**Canonical resolution (P1.2, §5.1.1):** an `ABORTED` receipt resolves to **`CANNOT_ANSWER`**
for that key, with the server-log reason `ABORTED_REQUIRES_NEW_CYCLE`. Same-cycle retry is
**REFUSED**; a new authoritative cycle is **REQUIRED**. An earlier draft of this section said it
resolved to `NOT_COMMITTED` as positive evidence — that was the P1.1 reading and it is
withdrawn, because it authorised a resubmit under a key whose terminal receipt already exists.

`abort_reason` is a constrained vocabulary (`PROVEN_NO_PIPELINE_COMMIT`) rather than free
text, because an operator note is exactly where a customer name or a phone number ends up.

---

## 7. Live prerequisites — why G1 is still OPEN

> **SUPERSEDED AS STATUS — retained as the original P1 definitions.** This table is the
> Model A / early Model B framing and its verdicts are historical. G1 reached **LIVE FUNCTIONAL
> PROOF PASS** at P6.4. In particular **P1-L2 is RETIRED** (replaced by L2′ at P3) and **P1-L5
> is SUPERSEDED** — under Model B the stable key must NOT travel in the payload, which is the
> opposite of what P1-L5 asks for. The current register is
> `docs/PHASE_B2_1C_G1_P6_CONTROLLED_LIVE_INTEGRATION.md` §D, and the reasoning is
> `docs/P6_4_POST_CLAIM_AMBIGUITY_CLOSURE.md`.

Nothing below can be established offline. Each is a canary.

| # | Prerequisite | Why it cannot be proven here |
|---|---|---|
| **P1-L1** | ~~The `Submission_Receipts` table exists with the **eleven** fields of §3~~ **PASS (P2)** — created and schema verified as `Submission_Receipts_CANARY` | proven live |
| **P1-L2** | **Atomic insert-if-absent** under genuine concurrency | **FAIL (P2)** — the primitive does not exist on the `dataTable` node, and duplicates for one key were created live. **Blocks the substrate choice, not merely the proof** |
| **P1-L3** | **Read-after-write** for a key just written | **NOT TESTED (P2)** — the MCP surface has no row-read tool at all, and testing was stopped once P1-L2 failed. Still gates whether absence may ever mean `NOT_COMMITTED` |
| **P1-L4** | Durability across workflow redeploy and n8n restart | **NOT TESTED (P2)** — no boundary was crossed. The in-memory double proves nothing about this |
| **P1-L5** | The stable key **reaches Lead Intake** as `payload.meta.idempotency_key` | today the outbound envelope carries no key — **contract change, owner approval (OD-1)** |
| **P1-L10** | An authenticated `Internal Auth Entry` route exists on Lead Intake, so `internalRouteProven()` can ever be true | the node does not exist today; without it receipts are never written and the public route can never write them either (§7.1) |
| **P1-L6** | Intent write ordered strictly before `Save to Pipeline` | workflow wiring, observable only live |
| **P1-L7** | Commit write ordered before the respond node | ditto |
| **P1-L8** | Retention **and access control** for receipts across many cycles — the ledger holds a personal identifier (§3.1), so this is not merely a housekeeping question | live data-retention and access decision |
| **P1-L9** | Lead Intake seeds `receipt.correlation_id` from the same `meta.request_id` it writes to Pipeline AZ | wiring, observable only live — and see §6.1: the correlation is overwritten by a later merge regardless |

**P1-L5 is an owner decision.** The stable key must travel into the Lead Intake payload so
Lead Intake can write it, and gateway contract §2 freezes the Lead Intake contract. The
gateway side of that (`meta.idempotency_key`, or a dedicated envelope field) is **not**
implemented here, because implementing it would be changing a frozen contract without approval.

### 7.1 P1-L5 trust boundary — the stable key must not become caller-authoritative

Inspected against the actual export, not assumed.

**A. Entry routes that exist today.** Exactly one: a single **unauthenticated public** webhook,
`POST /finmentor-lead-intake`, with **no credentials attached** and no authentication option
set. There is no second entry node of any kind. The string `Internal Auth Entry` does appear in
the export — but only as embedded Code-node source inside `internalRouteProven()`, **not as a
node**. Zero nodes are named `Internal Auth*`.

**B. Can the Mini App gateway use an authenticated internal path today? NO.** The mechanism is
designed and coded, and it is the right one — `internalRouteProven()` reads
`$('Internal Auth Entry').first().json.__internal_route === true`, which is safe *by
construction* rather than by checking: on the public path that node never ran, `$()` throws,
and provenance is false. It is never read from a body or a header, so no caller can assert it.
But **the node it depends on does not exist**, which is why the audit report records
`provenance_trusted` as having always been false and the branch as dead code.

**C. If `payload.meta.idempotency_key` were added, could a direct caller submit it? YES** —
the public webhook accepts any JSON. That is the whole problem, and the attack is cheap:

> The stable key is **guessable by construction**. Telegram ids are numeric and cycle ids are
> date-shaped, so an attacker can POST the public webhook with
> `miniapp:<victim id>:<cycle id>` and plant a **`PENDING`** receipt. The victim's real Mini
> App submission then finds a foreign `PENDING` row, answers `CANNOT_ANSWER` for ever, and can
> never submit — with no session, no credential and no contact with the Mini App at all. A
> denial of service against a specific person, mounted from a browser.

**The structural answer: receipt authority is a property of the ROUTE.** Encoded as
`RECEIPT_AUTHORITY` and enforced by `resolveReceiptKey`, which both ledger writers
(`buildIntent`, `buildCommit`) call before they will construct anything. `provenanceTrusted`
must be the literal boolean `true`; `'true'`, `1`, `{}`, `{ __internal_route: true }` and every
other body-producible shape are refused. **It is not possible to build an intent record without
a trusted route**, so a public-path execution cannot construct one even by mistake — the check
cannot be forgotten by a caller because there is no path that skips it.

**Status: SAFE DESIGN READY, P1-L5 BLOCKED.** The decision layer is proven offline: a
public-path execution creates nothing, and no body marker simulates the route. The end-to-end
guarantee additionally needs the authenticated route to **exist**, which is a live change and
is recorded as **P1-L10**. Public-route poisoning is therefore *proven impossible at the
decision layer* and **not yet proven end-to-end** — and this document does not claim otherwise.

**Recommended transport**, smallest change that is safe:

| | |
|---|---|
| Field | `payload.meta.idempotency_key` |
| Who derives it | the **gateway**, from the server-resolved `telegram_user_id` and the authoritative `cycle_id`. The browser never supplies it and cannot influence it — the validator already drops a caller `idempotency_key`, `request_id`, `cycle_id` and `lead_id` |
| Trusted route | a dedicated authenticated **`Internal Auth Entry`** node on Lead Intake, credential enforced by n8n itself, reusing the mechanism commit `a224aa2` established for lead identity |
| Who may consume it | Lead Intake, **only** when `internalRouteProven()` is true |
| Public route | the field is **ignored entirely**: no receipt read, no receipt created, no receipt updated. Not rejected with an error that would confirm a guess — simply not acted upon |
| Rollback | remove the `Internal Auth Entry` node. Provenance returns to false everywhere, receipts stop being written, and the gateway returns to `PRE_ACTIVATION_BLOCKED` — its current safe state |

**Can an existing authenticated route be reused? No — there is none.** The smallest dedicated
addition is the `Internal Auth Entry` node the code already expects, which is why no new
mechanism is proposed here.

### Rollback

The ledger is additive. Rollback is: stop writing receipts, remove the adapter from the
gateway wiring, and the gateway returns to `PRE_ACTIVATION_BLOCKED` — its current, safe,
pre-P1 state. No lead, Pipeline row or `Bot_Sessions` row is affected, because the ledger
never writes to any of them.

---

## 8. What was implemented in the repository

| Path | Role |
|---|---|
| `n8n/src/lead-intake/idempotency-receipt.js` | Lead Intake side: route-provenance gate, key validation, intent/commit/abort record building, transitions, conflict detection, row classification, retention rule, and a log view carrying only `commit_state` / `has_lead_id` / `verdict` / `reason` / `correlation_id` |
| `n8n/src/miniapp-submit/recovery-adapter.js` | Gateway side: `lookup(key)` implementing the declared `RECOVERY_ADAPTER_CONTRACT` over an injected store; capability gating; fail-closed everywhere |
| `qa/idempotency-receipt.test.mjs` | **66 checks**, gate 9 |

Both modules are pure and perform **no I/O**. The gate's in-memory store is a **double** and is
labelled as one in the file header: it models the contract so the decision logic can be proven
with no tenant, and it proves nothing about durability, atomicity or read-after-write.

Mutation testing has run in every phase, and each mutation fails exactly the checks that exist
to catch it: **P1** ten (absence without read-after-write, duplicate receipts resolved to a
winner, `PENDING` read as negative, conflicting lead id, exact match weakened to a prefix,
key-shape validation removed, scan-only store accepted, raw key in the log,
`COMMITTED`-without-lead, store error read as absence); **P1.1** ten more (stored-key trim,
wrong-key row as absence, each of the three capabilities ignored, probe exposing `lookup`,
`ABORTED` promotable, `COMMITTED` abortable, free-text abort reason, missing receipt key);
**P1.2** eight (the `ABORTED` release control itself, plus digest return, key-derived
correlation id, lookup-failure as abort reason, and document corruption); **P1.3** the
route-provenance controls in §7.1.

Coverage gaps found by those harnesses were closed rather than explained away — the store
double's own correct filtering masking the ledger's independent key re-check, a store reporting
failure while returning an empty array, and a fixture that derived `correlation_id` from the
key and put the identifier back into the logs.

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

## 10. OWNER DECISIONS FOR LIVE P1

Four decisions. Each states the recommendation, not merely the options.

### OD-1 — P1-L5 transport → **APPROVE WITH CONDITIONS**

Carry the stable key to Lead Intake as `payload.meta.idempotency_key`, **on an authenticated
route only**.

| | |
|---|---|
| **Exact field** | `payload.meta.idempotency_key` |
| **Exact trusted route** | a dedicated authenticated `Internal Auth Entry` node on Lead Intake (P1-L10) |
| **Who derives the key** | the gateway, from server-resolved `telegram_user_id` + authoritative `cycle_id`. Never the browser |
| **Who may consume it** | Lead Intake, only when `internalRouteProven()` is true |
| **Public-route behaviour** | ignored entirely — no receipt read, created or updated; no error that would confirm a guessed key |
| **Rollback** | remove the `Internal Auth Entry` node; provenance falls to false, receipts stop, gateway returns to `PRE_ACTIVATION_BLOCKED` |

**The conditions are not optional.** Approving the field without P1-L10 would open the denial
of service in §7.1: a guessable key plus a public writer is a way to lock a named person out
of submitting. The field and the authenticated route must ship together, or neither ships.

### OD-2 — P1-L8 access → **LEAST PRIVILEGE, as listed**

The ledger holds a personal identifier (§3.1), so access is enumerated rather than assumed.

| Access | Who / what |
|---|---|
| **May read/write** | Lead Intake (write, trusted route only) · the gateway recovery adapter (read only) · named operators performing G1 recovery |
| **Must NEVER reach** | the browser · public webhook responses · the Mini App read model / mirror · analytics or GA4 · Telegram messages · any log line as a raw key or as anything derived from one |

No raw key in logs is already enforced in code, not policy: the log view is exactly
`commit_state`, `has_lead_id`, `verdict`, `reason`, `correlation_id`, asserted per branch.

### OD-3 — Retention → **INVARIANT RECOMMENDED, ONE INPUT OUTSTANDING**

The ordering invariant is in §3 and needs no owner input: terminal **and** irreversibly
superseded **and** retention elapsed, all three, and never a deletion that manufactures an
absence.

**No canonical FINMENTOR retention policy defines a duration**, and none is invented here. The
single outstanding owner input is: *how long after a cycle is irreversibly superseded may a
terminal receipt be kept before deletion.* Until that is set, receipts are simply retained —
which is the safe default, because over-retention costs storage while under-retention costs
recovery.

### OD-4 — Abort operational coupling → **CONFIRM**

**`ABORTED` closes the key; it does not restore the ability to submit.** Per §5.1.1 the same
cycle can never submit again, so an abort must be followed by the Concierge issuing a **new
authoritative cycle**. An abort on its own leaves the user unable to submit until the cycle
changes anyway — so the two actions are one operational step, and the runbook (§6.2) states it.

---

## 10.1 Status

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

P1.2 closed four more: the `ABORTED` retry contradiction, which was real — an abort licensed a
same-key resubmit that the ledger's own uniqueness rule could never have accepted (F5); the
key-digest privacy overclaim, removed rather than softened (F6); three Markdown corruptions
this document acquired in P1.1, now repaired and guarded by a table-integrity check (F7); and
the operator-recovery wording, held at PARTIAL with its failure modes stated as rules (F8).

P1.3 made this document consistent with the code, replaced the contradictory "for all time"
uniqueness claim with a precise lifecycle invariant, and — the substantial part — inspected the
real Lead Intake entry surface and found **one unauthenticated public webhook and no
authenticated route at all**. Adding the stable key to the payload without an authenticated
route would have opened a cheap, targeted denial of service (§7.1), so receipt authority is now
a property of the route, enforced in code by `resolveReceiptKey` at both ledger writers.

**P2 (2026-08-26) took the substrate to the tenant and it failed.** P1-L1 passes: the eleven-field
table exists and works. P1-L2 fails on two independent grounds — the primitive is absent from the
node, and duplicates for one key were created live in two calls. P1-L3 and P1-L4 were not tested,
because there is no row-read path on the available surface and because proving secondary
properties of a store that has already failed its primary one would have spent live mutation to
no purpose. The full record, including exactly what remains live and needs deleting by hand, is
in `docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md`.

The **decision logic** this document specifies is unaffected: it was built to fail closed on
duplicates, and it does. What P2 removes is the assumption that the chosen store would make
duplicates rare. On this substrate they are not rare — they are unenforced.

Until P1-L1 … P1-L10 are executed and recorded — and P1-L2 now needs an **architecture
decision**, not merely a live proof — **B.2.1-C is NOT CLEARED**, G1 remains the activation
blocker, and the fifteen B.2.1-C canaries remain unexecuted.
