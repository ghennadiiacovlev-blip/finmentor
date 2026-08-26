# FINMENTOR — G1 P3 preallocation decision

Phase: **B.2.1-C live prerequisites, P3 — design and offline proof only**
Date: 2026-08-26
Branch: `feat/miniapp-b21c-live-prereqs`

**Decision: MODEL B APPROVED.** Preallocate the receipt at cycle issuance under an opaque,
server-minted random `submission_key`. The submit path performs only conditional updates.

Nothing live was touched in P3: no n8n, no Sheets, no Data Table, no production workflow, no
webhook call, no Telegram, no GA4, no DNS.

---

## 1. Current cycle issuance — **NOT single-writer, and that is proven, not assumed**

P2 ended with a suggestion that cycle issuance is "a single-writer moment with no
concurrency". That was inspected against the actual Concierge export and it is **false**.

| Fact | Evidence |
|---|---|
| Cycle id is `C-<chat_id>-<Date.now()>` | `Get Bot Session` code node |
| Bot_Sessions writes are `appendOrUpdate` matched on `chat_id` | `Save Bot Session`, `Save Intake State`, `Save Confirmation State` — three separate nodes, all last-write-wins, **no CAS** |
| Entry is a `telegramTrigger` with **no concurrency limit** | workflow `settings` has no such setting; each Telegram update is its own execution |
| Issuance is read → Code → write across a Sheets round trip | Phase 10 measured Sheets reads at **6–7 seconds** — a very wide TOCTOU window |

### The race model, case by case

| # | Scenario | Outcome today |
|---|---|---|
| 1 | Two `/start` events arrive together | Two executions, both read the same prior row, both may mint, both write. Last write wins silently |
| 2 | `/start` + restart callback together | Same as 1 — nothing serialises the two |
| 3 | Duplicate Telegram update delivery | Same as 1; Telegram retries are not deduplicated by the workflow |
| 4 | Two executions read the same prior Bot_Sessions row | Guaranteed reachable given a 6–7 s read window |
| 5 | Two issuers minting in the same millisecond | **Identical `cycle_id`** — `Date.now()` has 1 ms resolution and the chat id is shared. This is not a tail risk; it is a collision by construction |
| 6 | `appendOrUpdate` last-write-wins | One issuer's cycle silently overwrites the other's. The loser has no way to learn it lost |
| 7 | Issuance fails after receipt creation | Orphan receipt, no authority pointing at it — harmless under the design below |
| 8 | Issuance fails before Bot_Sessions persistence | Old cycle stays current — safe, and required |

**Consequence for the design: preallocation must tolerate two issuers.** Any model whose
correctness depends on one writer is disqualified before it is compared.

---

## 2. Model comparison

| | **MODEL A** — `telegram_user_id + cycle_id`, strengthened generator | **MODEL B** — opaque random `submission_key` |
|---|---|---|
| Same-key collision | Only as good as the cycle generator. Today two issuers in one millisecond derive the **same** key | Independent of the cycle generator. 128-bit random, distinct by construction |
| Concurrency | Two issuers colliding need arbitration at the store — i.e. insert-if-absent, **which P2 proved absent** | Two issuers simply mint different keys. Nothing to arbitrate |
| Retry semantics | Same | Same |
| Authority binding | Implicit — key derivable from the cycle | Explicit — authority *names* the key. Clearer, and makes orphans obvious |
| Privacy | Embeds the Telegram id in the durable ledger. P1.3 §3.1 accepted this as a compromise | **No identifier at all** in the ledger. The compromise disappears |
| Guessability | Guessable by construction (numeric ids, date-shaped cycles) | Unguessable |
| Public-route poisoning | Targeted attack possible if a body field is ever trusted | Targeted attack impossible — an attacker cannot name a victim's key |
| Bot_Sessions change | None | **One new column** (§5) |
| Recovery | Same | Same |
| Operator debugging | Key readable, identity legible | Opaque; operator must go via Bot_Sessions. Slightly worse |
| Migration | Smaller | One column + issuance wiring |
| Gateway contract compatibility | Existing key shape retained | Gateway reads the key from authority instead of deriving it |

**MODEL B APPROVED.** The deciding argument is not the privacy win, welcome as it is. It is
that Model A's uniqueness is only ever as good as `Date.now()` at 1 ms resolution for a shared
chat id — and when it collides, Model A needs exactly the primitive P2 proved does not exist.
Model B moves uniqueness **out of the store and into the key generator**, which is the one
place this platform can actually provide it.

The single cost — worse operator legibility — is real and accepted: an operator now resolves a
receipt by reading `Bot_Sessions.submission_key` first, rather than deriving it.

---

## 3. Key format and collision model

| | |
|---|---|
| Format | `sub_<32 lowercase hex>` |
| Entropy | 128 bits, `crypto.randomBytes(16)` |
| Minted by | the cycle issuer (Concierge), server-side, at issuance |
| Browser | never supplies, selects or sees it |

**Stated honestly: this is probabilistic, not impossible.** At 128 bits the collision
probability across any number of cycles this business will ever issue is far below the
probability of the store losing a row — which is the correct comparison, because a lost row is
also fatal to recovery and nobody proposes defending against that with a different key format.
The gate mints 10,000 keys and asserts zero collisions; that is a smoke test of the generator,
not a proof of the bound, and the code says so.

---

## 4. Issuance ordering

```
1. mint submission_key                     (random, server-side)
2. create receipt in state READY
3. CONFIRM the create succeeded            (not "the node did not error")
4. write cycle + submission_key to Bot_Sessions   ← authority advances HERE
5. only now may a Mini App session bind to that cycle
```

**Invariant: a current authoritative cycle never exists without its preallocated receipt.**

| Failure | Result | Safe? |
|---|---|---|
| Receipt create fails | Authority does **not** advance; the old cycle stays current | ✅ |
| Authority write fails | Orphan receipt exists; no current cycle names it | ✅ harmless, cleaned up later |
| Two concurrent issuances | Each mints its own key and its own receipt. Bot_Sessions last-write-wins picks the authority winner; the gateway only ever uses the key the **current** authority row names. The loser is an orphan that can never satisfy the winner, because the winner reads a different key | ✅ |

**The Data Table never arbitrates which cycle wins.** That was the old design's mistake. The
authority store decides; the ledger only records.

---

## 5. Bot_Sessions contract — one new column

| | |
|---|---|
| Header | `submission_key` — exact lower_snake_case, appended after the existing headers |
| Chosen over | `receipt_key` (ties the authority field to a storage detail) and reusing `request_id` / `cycle_id` / `lead_id` / `session_id`, all of which already carry a distinct meaning that must not be overloaded |
| Writer | the cycle issuer (Concierge), at issuance, step 4 |
| Reader | the Mini App gateway (to look up the receipt) and operators |
| Reset behaviour | replaced on every new cycle, exactly like `cycle_id`. Never blanked while a cycle is current |
| Crosses TB-1 | **No.** The browser never sees it — it is not in `CLIENT_RESPONSE_FIELDS` and must never be added |
| Migration / preflight | same class as the P1.3 columns: a preflight must refuse to deploy while the header is absent |
| Fail-closed when missing | a current cycle with **no** `submission_key` is a broken invariant → the gateway must treat it as `CANNOT_ANSWER`, never as "no receipt, go ahead" |

---

## 6. Receipt state machine

| State | Meaning | Lookup answer |
|---|---|---|
| `READY` | preallocated; no handoff has been claimed | **`known: false`** — positive evidence, releases exactly one attempt |
| `IN_FLIGHT` | a handoff was claimed; outcome unknown | `CANNOT_ANSWER` |
| `COMMITTED` | Pipeline commit observed; canonical lead recorded | `known: true` + the lead |
| `ABORTED` | operator proved no commit; **key closed** | `CANNOT_ANSWER`, reason `ABORTED_REQUIRES_NEW_CYCLE` |
| *absent* | **broken preallocation invariant** | `CANNOT_ANSWER` — **never** `known: false` |

`PENDING` was renamed `IN_FLIGHT`. Under preallocation both `READY` and the old `PENDING`
would have been "a row exists and no lead is recorded" — two very different situations that
must never share a name.

Transitions: `READY → IN_FLIGHT`, `READY → ABORTED`, `IN_FLIGHT → COMMITTED`,
`IN_FLIGHT → ABORTED`. `COMMITTED` and `ABORTED` are terminal.

### The semantic change that matters

**Absence stops being an answer.** Under the old design "no row" meant "nothing was created,
go ahead" — an inference that could create a duplicate lead if the store was merely slow.
Under preallocation, a current cycle is *required* to have a receipt, so a missing one is a
broken invariant and the only safe response is silence.

**Consequence for P1-L3.** Read-after-write was a **safety** prerequisite because the absence
inference depended on it. It is now a **liveness** property: a stale read can only show `READY`
when the state has already moved, and the conditional claim then fails with `updated_rows = 0`
rather than handing out a second handoff. It affects whether recovery works *promptly*, not
whether it is *safe*.

---

## 7. Conditional update contract

Both state changes are conditional updates matching key **and** expected state:

```
claim:   WHERE submission_key = K AND commit_state = 'READY'      SET IN_FLIGHT
commit:  WHERE submission_key = K AND commit_state = 'IN_FLIGHT'  SET COMMITTED + lead
```

Each **must** affect exactly one row. `updated_rows` is checked explicitly:

| Result | Meaning | Action |
|---|---|---|
| `1` | this operation owns the transition | proceed |
| `0` | somebody else already moved the state | **fail closed** |
| `>1` | the key is not unique; nothing can be trusted | **fail closed** |
| unreadable / store error | unknown | **fail closed** |

**A node "succeeding" is not evidence that one row changed.** `ok: true, updated_rows: 0` is
exactly what a conditional update returns when another operation won the race, and treating it
as success is how a claim gets handed to two operations at once. The gate has a dedicated check
for that single trap.

---

## 8. Retry matrix

| Case | Receipt | Answer | Pipeline calls |
|---|---|---|---|
| A — died before the transition | `READY` | release the stale claim; one handoff allowed | 1 |
| B — died after the claim | `IN_FLIGHT` | `CANNOT_ANSWER` | 0 |
| C — committed, response lost | `COMMITTED` | replay the canonical lead | 0 |
| D — receipt missing for the current cycle | *absent* | `CANNOT_ANSWER` | 0 |
| E — old/superseded cycle | names a different key | refused by the authority/session guard first | 0 |
| F — aborted | `ABORTED` | `CANNOT_ANSWER`; new cycle required | 0 |

---

## 9. Trust boundary — unchanged

P1.3 remains binding and is **not** relaxed because the key became unguessable:

- the public Lead Intake route may not create, claim or commit a receipt;
- a body marker never establishes provenance — `provenanceTrusted` must be the literal boolean
  `true`, and `'true'`, `1`, `{}`, `{ __internal_route: true }` are all refused;
- receipt mutation happens only on the authenticated server route;
- the browser never supplies the key.

**P1-L10 (an authenticated `Internal Auth Entry` route) remains REQUIRED.** A random key
removes the *targeted* poisoning threat — an attacker cannot name a victim's key — but it does
not authenticate anything, and route authentication is a separate control that must not be
traded away for key entropy. The module declares this explicitly so the argument cannot be made
later by omission.

---

## 10. External store fallback — **NOT required**

Preallocation satisfies the invariants inside the existing stack, so no new infrastructure is
proposed and none was provisioned. Recorded for completeness: if the live canary shows the
conditional update does **not** report `updated_rows` faithfully, or is not atomic, then the
design has no remaining foothold on this platform and a transactional store with a real UNIQUE
constraint becomes necessary. That is a decision for that moment, not this one.

---

## 11. Prerequisite changes

| Prerequisite | Status after P3 |
|---|---|
| **P1-L2** atomic insert-if-absent | **RETIRED** — designed out. Replaced by **P1-L2′: conditional update is atomic and reports `updated_rows` faithfully under genuine concurrency** |
| **P1-L3** read-after-write | **DEMOTED** from safety prerequisite to liveness property |
| **P1-L11** *(new)* | `Bot_Sessions.submission_key` column exists, and issuance writes it in the ordering of §4 |
| P1-L1, L4, L5, L6, L7, L8, L9, L10 | unchanged |

---

## 12. Next live canary — designed, **NOT executed**

For MODEL B, against a `Submission_Receipts_CANARY` table and synthetic keys only:

| # | Canary | Pass criterion |
|---|---|---|
| **C1** | Conditional update reports `updated_rows` faithfully | update a `READY` row to `IN_FLIGHT` matching on state → exactly `1`; repeat → exactly `0` |
| **C2** | **Genuine concurrent claim** — two overlapping executions claim one `READY` receipt | exactly one reports `updated_rows = 1`; the other reports `0`. Not simulated sequentially |
| **C3** | Conditional update never matches the wrong state | claim a row already `IN_FLIGHT` → `0`, and the row is unchanged |
| **C4** | Exact-key read | reading a key returns only that row; wrong key returns zero |
| **C5** | Preallocation survives an execution boundary | create in one execution, read in a separate one |
| **C6** | Durability across a disposable-workflow redeploy | row still present and unchanged |
| **C7** | `updated_rows` is observable at all through the chosen wiring | if it is not, C1–C3 cannot be evaluated and the design is blocked |

**C7 is the gating one.** If the platform will not tell us how many rows an update affected,
the entire conditional-update contract is unverifiable and MODEL B fails the same way MODEL A
did — for a different missing primitive.

---

## 13. Status

**G1 remains OPEN.** P3 is design and offline proof; it executes nothing. The receipt logic,
the trust boundary, the retry matrix and the retention rule are proven offline and
mutation-tested. What is unproven is the live behaviour of the one primitive the whole design
now rests on, and that is C1–C3 above.

`docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md` is retained unchanged as the evidence that
closed the previous architecture.
