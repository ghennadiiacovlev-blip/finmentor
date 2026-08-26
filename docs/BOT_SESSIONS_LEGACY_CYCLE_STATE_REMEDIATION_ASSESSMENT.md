# FINMENTOR — Bot_Sessions legacy cycle-state defect: impact assessment and owner decision pack

Phase: **P6R-0 — READ-ONLY assessment**
Date: **2026-08-26** (window 18:47Z – 18:52Z)
Branch: `feat/miniapp-b21c-live-prereqs`
Repo HEAD: `9d57a2a`

**Production mutations: NONE.** No sheet cell written, no header changed, no workflow modified,
no Data Table created, no webhook called, no Telegram sent, no `availableInMCP` change.

**No PII appears in this document.** Every live figure below is an aggregate computed inside
the tenant; the probe emitted counts only. No `chat_id`, `user_id`, username, name, contact
field, message text, `raw_json` or individual lead id ever left n8n. Lead ids appear only as
prefix tallies.

**Headline: the defect is real and destructive, but the population it can damage is
essentially empty — 3 sessions, of which the single one carrying any state is a QA artifact.**
That fact, not the defect's severity, is what determines the right migration policy.

---

## 1. Live census — aggregates only

Read via a disposable read-only probe (`srf3OYf6P4oeiwhX`, archived), execution `3528`.

### 1.1 Bot_Sessions shape

| Metric | Value |
|---|---|
| Raw rows returned | **27** |
| Rows with a `chat_id` (real sessions) | **3** |
| Rows without a `chat_id` | 24 — of which **2 fully empty**, **22 partially populated** |
| Distinct chats | **3** |
| Duplicate-chat rows | **0** |

The 22 "partially populated" rows are populated in **exactly two columns**, `ok` and `result`,
and in nothing else. Those are transport/QA artifact columns, not sessions. They are not user
state and no migration needs to consider them.

**Column population across all 27 rows** (non-empty counts):

```
ok 22 · result 22 · session_id 3 · chat_id 3 · user_id 3 · username 3 · language 3
state 3 · created_at 3 · updated_at 3 · last_message_at 3 · entry_source 3
selected_service 3 · status 3 · first_name 2 · last_name 2 · contact_name 2
company 2 · notes 2 · contact_phone 1 · contact_email 1 · turnover_range 1
main_pain 1 · consent 1 · lead_id 1 · lead_sent_at 1
```

Every other column is empty in every row.

### 1.2 State, consent, lead

| Metric | Value |
|---|---|
| `state` | `SERVICE_SELECTED` 1 · `BUSINESS_MODEL_SELECTED` 1 · `LEAD_SENT` 1 |
| `status` | `active` 2 · `qa_updated` 1 |
| `consent` | `yes` **1** · empty 2 · `no` 0 · other/invalid **0** |
| `lead_id` non-empty | **1** — prefix tally: `QA-*` **1** |
| `lead_sent_at` non-empty | 1 |
| `lead_ready` non-empty | 0 |
| consent AND lead | **1** |
| consent, no lead | 0 |
| lead, no consent | 0 |

### 1.3 Rows materially affected

**`ROWS_MATERIALLY_AFFECTED: 1`** — rows carrying a consent decision, a lead binding, or
`status = ended`.

**That single row is a QA artifact, not a customer.** Three independent signals agree:
`status = qa_updated`, `lead_id` prefix `QA-*`, and (§3) it matches no Pipeline row. The two
genuine sessions are early-funnel (`SERVICE_SELECTED`, `BUSINESS_MODEL_SELECTED`), have no
consent and no lead.

---

## 2. What the defect actually does today — proven from the tracked source

The gate is `Get Bot Session` in the live Concierge. The mechanism:

```js
const hasNoCycle = str(s.cycle_id) === '';        // ALWAYS TRUE — cycle_id never persists
if (isStart) reset = 'start';
else if (isRestart) reset = 'restart';
else if (hasNoCycle) reset = 'bootstrap';          // therefore EVERY event resets
if (reset) cycleId = 'C-' + str(p.chat_id) + '-' + Date.now();   // a NEW cycle every message
...
if (str(s.consent) !== '' && str(s.consent_cycle_id) !== cycleId) { s.consent = ''; ... }
if (str(s.lead_id)  !== '' && str(s.lead_cycle_id)  !== cycleId) { archiveLead(); }
```

`consent_cycle_id` and `lead_cycle_id` are always `''` (never persisted) and `cycleId` is always
freshly minted, so **both invalidation conditions are true on every event for any row that
carries consent or a lead**.

The asymmetry is what makes it destructive: the *guard* fields (`cycle_id`,
`consent_cycle_id`, `lead_cycle_id`, `lead_intake_ok`, `previous_lead_id`, `consent_at`) are
dropped by Sheets, but the *guarded* fields (`consent`, `lead_id`, `lead_sent_at`) are real
columns and the cleared values **are** written back.

### 2.1 Deterministic fixtures

Every case assumes an ordinary message (not `/start`, not `m|diag`) and the true persisted
state `cycle_id = consent_cycle_id = lead_cycle_id = ''`.

| # | Incoming persisted state | reset | New cycle? | consent | lead | previous_lead_id | Net effect on the SHEET |
|---|---|---|---|---|---|---|---|
| **A** | active, no consent, no lead | `bootstrap` | yes | untouched (empty) | untouched (empty) | — | **none** — nothing to invalidate |
| **B** | consent `yes`, no lead | `bootstrap` | yes | **WIPED to ''** | — | — | **consent destroyed** |
| **C** | consent `no` | `bootstrap` | yes | **WIPED to ''** | — | — | decision destroyed; user re-asked |
| **D** | lead + consent `yes` | `bootstrap` | yes | **WIPED** | `archiveLead()` → `lead_id`, `lead_sent_at` **WIPED** | computed then **dropped** | **consent AND lead binding destroyed; the lead id is not even archived** |
| **E** | lead, no consent | `bootstrap` | yes | — | `archiveLead()` → **WIPED** | computed then **dropped** | lead binding destroyed, archive lost |
| **F** | `ended` + prior lead, user presses `m|diag` | `restart` | yes | cleared (correct) | archived + cleared | computed then **dropped** | restart behaves correctly, but the `previous_lead_id` audit trail is lost |

### 2.2 Why it repeats forever

The six outgoing keys are dropped again on every save, so `cycle_id` is `''` again on the next
event, `hasNoCycle` is true again, a new cycle is minted again, and the invalidations run
again. **The cycle never stabilises.** There is no state in which the guard fields become
useful, because the mechanism that would write them is the same one being discarded.

### 2.3 Live corroboration — supporting, not conclusive

`Bot_Events` (42 rows) contains **3 consent callbacks** — 2 × `consent|yes`, 1 × `consent|no`
— from **1 distinct chat**. That chat's `Bot_Sessions` row currently shows **empty** consent.

Only two code paths write `consent = ''`: the cycle-gate invalidation above, or an explicit
`/start` / `m|diag` reset. So this is **consistent with** case B/C having already occurred in
production, but it is not isolated from the reset explanation, and I did not extract per-row
data to disambiguate. Recorded as supporting evidence, not proof.

The two genuine sessions are pre-consent, so the defect has had almost nothing to destroy.
**That is luck, not safety.**

---

## 3. Pipeline reconciliation — READ-ONLY, counts only

| Metric | Value |
|---|---|
| Pipeline rows read | **9** |
| Pipeline lead id prefixes | `FIN-*` **8** · `TG-*` **1** |
| Bot_Sessions `lead_id` values found **exactly once** in Pipeline | **0** |
| …**not found** | **1** |
| …duplicate/ambiguous | **0** |

The single `Bot_Sessions` lead id (`QA-*`) matches **no** Pipeline row — consistent with it
being a QA artifact.

### 3.1 Can `lead_intake_ok` be derived?

**NO — and the question is currently moot.**

- There is **no row** for which a truthful derivation is possible: the only candidate matches
  nothing in Pipeline.
- The available evidence fields are weak in principle anyway. `lead_sent_at` records that the
  Concierge *attempted* a handoff, not that Lead Intake *succeeded*; `status`/`notes` are
  narrative; Pipeline existence alone cannot be attributed to a specific session without a
  join key, and the only join key (`lead_id`) is exactly what the defect wipes.

**Rule: do not populate `lead_intake_ok` for any legacy row. Leave it blank.** A blank
`lead_intake_ok` is read as "not proven", which is the truthful reading. Inventing `'true'`
would assert a Lead Intake success that no evidence supports.

If a future migration must derive it, the **only** admissible rule would be:

> `lead_intake_ok = 'true'` **only if** the row's `lead_id` is non-empty **and** appears
> **exactly once** in Pipeline **and** that Pipeline row's identity fields corroborate the
> session. On today's data that rule selects **zero** rows.

---

## 4. Consent timestamp recoverability

**A semantically exact source exists, but it covers none of the rows that need it.**

`Bot_Events` retains `ts` alongside `callback_data`, and a consent decision arrives as the
callback `consent|yes` / `consent|no`. The `ts` on that row is **the moment the user pressed
the consent button** — a genuine consent decision time, not a proxy.

| Metric | Value |
|---|---|
| `Bot_Events` rows | 42 |
| consent callbacks | **3** (2 yes, 1 no) |
| …with a non-empty `ts` | **3** |
| distinct chats among them | **1** |
| Bot_Sessions rows needing `consent_at` | **1** |
| …**recoverable** from Bot_Events | **0** |

The one row needing a `consent_at` (the QA row) has no consent event; the one chat that has
consent events no longer carries consent in `Bot_Sessions`.

Other candidates were checked and are empty or unusable: `raw_json` is **non-empty in 0 rows**;
`notes` is non-empty in 2 rows and mentions consent in **0**; `Bot_Sessions` has no consent
timestamp column at all. `created_at`, `updated_at`, `last_message_at` and `lead_sent_at` are
row/message/submission times and are **not** consent decision times — they must never be
substituted.

```
CONSENT_AT RECOVERABLE:  PARTIAL — the SOURCE exists and is exact, but it covers 0 of the
                         1 row that needs it
SOURCE:                  Bot_Events.ts on a callback_data of consent|yes or consent|no
SEMANTIC QUALITY:        EXACT CONSENT TIME (for rows it covers). All other candidates are
                         NOT VALID — they are row, message or submission times.
```

**Do not backfill `consent_at` from any other field.** No approximation is acceptable for a
consent timestamp.

---

## 5. Migration options

### OPTION A — HARD RESET → **RECOMMEND (conditionally)**

Append the six legacy columns; existing sessions receive a bootstrap cycle on their next
interaction; nothing is backfilled.

- **Correctness:** truthful by construction — nothing is asserted that is not proven.
- **UX impact on today's data: effectively zero.** A `bootstrap` reset is *not* a `start` /
  `restart`: it mints a cycle id and nothing else. The block that clears
  `selected_service`, `business_model`, `state`, `notes` runs only for `start`/`restart`. The
  two genuine sessions keep their funnel position and see no new question.
- **CRM impact:** none. No Pipeline row is touched, and the only session lead id is a QA
  artifact that matches nothing.
- **Risk:** the QA row's `consent = yes` and `QA-*` lead are invalidated on its next event —
  which is correct, since neither can be bound to a proven cycle.

### OPTION B — PRESERVE EVERYTHING → **REJECT**

Would require inventing what cannot be derived:

- `consent_at` — recoverable for **0** of the rows that need it (§4);
- `lead_intake_ok` — derivable for **0** rows (§3.1);
- `lead_cycle_id` binding an existing lead to a migration cycle — the only candidate lead
  matches no Pipeline row, so the binding would assert a relationship that does not exist.

Preserving "everything" here means fabricating three historical facts. **Rejected on the
brief's own condition.**

### OPTION C — HYBRID → **REJECT AS UNNECESSARY TODAY, but it is the right design later**

The hybrid is implementable and its logic is sound:

- mint a migration `cycle_id` for every current row;
- bind `lead_cycle_id` **only** where reconciliation proves the lead exactly once in Pipeline;
- leave `previous_lead_id` blank without actual historical evidence;
- set `lead_intake_ok` only from the proven-success rule in §3.1;
- set `consent_cycle_id` only where preserving the decision is semantically justified;
- **never** invent `consent_at`;
- require explicit re-consent where consent time is unknown;
- bootstrap-only cycle for rows with no lead and no consent.

**On today's data every preservation branch selects zero rows**, so the hybrid reduces exactly
to Option A while adding a backfill mechanism that would touch live customer rows for no
benefit. More machinery operating on production data, identical outcome — the wrong trade.

**This judgement is data-dependent and will expire.** If real users accumulate consent
decisions or Pipeline-matched leads before remediation happens, C becomes the correct answer
and A becomes destructive. See the gate in §6 step 0.

### Recommended policy: **A**, gated on re-verifying the census immediately before migrating.

---

## 6. P6R-1 deployment design — **DESIGNED, NOT EXECUTED**

Scope: **the six legacy columns only.** `submission_key`, `lead_mode`, `lead_priority` and
`financial_zone` are **not** part of P6R-1 and remain P6.

### On the "danger window" the brief anticipates

The brief asks whether a compatibility guard is needed to prevent a window where the headers
exist and the live Concierge immediately starts persisting unintended state before a backfill
is ready. Traced against the actual gate, **that window is not harmful here, and adding the
columns is itself the fix**:

- **Event 1 after migration:** `cycle_id` cell is blank → `hasNoCycle` → `bootstrap` → a cycle
  id is minted **and now persists**. Invalidations run once, as case A/B/D above — for the two
  genuine rows that is a no-op.
- **Event 2:** `cycle_id` now persists and matches → **no new cycle** → consent and lead are
  retained within the cycle. The mechanism finally works as designed.

So no compatibility guard is required **on this data**, and no backfill is required because
there is nothing truthful to backfill. The safety comes from step 0, not from extra machinery.

### Steps

**Step 0 — re-run the census (READ-ONLY). THE GATE.**
- *Precondition:* none.
- *Mutation:* none.
- *Proof:* `ROWS_MATERIALLY_AFFECTED ≤ 1` **and** that row is QA-identified
  (`status = qa_updated`, `lead_id` prefix `QA-*`, absent from Pipeline).
- *Rollback:* n/a.
- *Stop if:* the count has grown, or any affected row is **not** a QA artifact. Then Option A
  is no longer safe — switch to Option C and reassess. **This gate is the whole safety
  argument; it must be re-run, not assumed from this document.**

**Step 1 — snapshot.**
- *Precondition:* step 0 green.
- *Mutation:* duplicate the `Bot_Sessions` tab as a dated backup copy; record the exact 40
  header strings in order.
- *Proof:* backup tab exists with an identical row count and identical header row.
- *Rollback:* delete the backup copy.
- *Stop if:* the backup row count differs from the live count.

**Step 2 — append the six headers.**
- *Precondition:* step 1 green.
- *Mutation:* append `cycle_id`, `consent_cycle_id`, `consent_at`, `lead_cycle_id`,
  `lead_intake_ok`, `previous_lead_id` **after** the existing 40, in row 1 only. **No existing
  header renamed, reordered or removed. No data cell written.**
- *Proof:* re-read row 1; assert the first 40 are byte-identical **and in the same order**, the
  six appear exactly once each, and total columns = 46.
- *Rollback:* clear the six header cells (returns to the current defective-but-known state).
- *Stop if:* any existing header moved or changed, or a duplicate header appears.

**Step 3 — observation, no mutation.**
- *Precondition:* step 2 green.
- *Mutation:* none. Wait for ordinary traffic.
- *Proof:* after one real event, `cycle_id` is non-empty for that chat. After a **second**
  event, `cycle_id` is **unchanged** — proving the cycle now stabilises instead of churning.
- *Rollback:* clear the six headers.
- *Stop if:* `cycle_id` changes on every event (the defect persists), or any unexpected column
  begins receiving data.

**Step 4 — STOP.** B.2.1-C's four columns are a separate, later decision.

**Rollback invariant:** the six columns are additive and the Concierge already writes them, so
leaving them in place *is* the repaired state. Never delete a populated column without the
step-1 snapshot.

---

## 7. Existing-user semantics on the first next message

| Question | Answer |
|---|---|
| Should current consent remain valid? | **No.** It cannot be bound to a proven cycle, and its decision time is unrecoverable. On today's data this affects only the QA row, so no real user is re-asked. |
| Should the current lead remain bound? | **No.** The only candidate matches no Pipeline row. It is archived, not honoured. |
| Forced into a new cycle? | **Yes — once.** A `bootstrap` cycle, then it stabilises. |
| Will they see a new question? | **No.** `bootstrap` does not clear funnel state; only `start`/`restart` do. The two genuine sessions keep their position. |
| Can an old completed lead accidentally resubmit? | **No.** `archiveLead()` clears `lead_id`, and `lead_ready` requires a **current-cycle** consent, which a bootstrap cycle does not have. |
| Can consent from an unknown historical moment count as current-cycle consent? | **No — and this must never be permitted.** It is exactly what `consent_cycle_id` exists to prevent. A consent whose decision time is unknown is re-requested, not assumed. |

Truthful state is preserved over UX convenience throughout. The reason that costs nothing here
is the census, not a design compromise.

---

## 8. Impact on B.2.1-C

| Item | Status |
|---|---|
| **P1-L11** `Bot_Sessions.submission_key` | **FAIL** — unchanged, and now blocked behind the legacy remediation |
| **P6** | **STOPPED** — unchanged |
| **P4** MODEL B storage proof | **VALID** — untouched |
| **P6-3A** F4 sub-workflow return contract | **LIVE CLOSED** — untouched |
| **P1-L2′**, **P1-L3** | **PASS** — untouched |
| **P1-L4** | **PARTIAL** — untouched (restart NOT TESTED) |
| **G1** | **OPEN** |

Nothing proven in P4 or P6-3A is reopened. The B.2.1-C columns must not be added until the
legacy six are fixed, because adding them first would layer a new mechanism on a substrate
whose existing mechanism silently does not work.

---

## 9. Cleanup

One disposable read-only probe was created and **archived**: `srf3OYf6P4oeiwhX`
(`[TEMP] P6R-0 read-only census`).

Post-cleanup verification: **28 workflows** — the exact pre-phase set — every one
`availableInMCP: false`, every `updatedAt` unchanged at `2026-08-25` or earlier.

**Production mutations: NONE.** The only live operations were three Google Sheets **reads**
(`Bot_Sessions`, `Pipeline` columns A:C, `Bot_Events`), all aggregated to counts inside the
tenant.

---

## 10. Limitations

- **The consent-wipe is proven from source, not observed end-to-end in production.** §2.3 is
  corroboration, not a controlled reproduction. Reproducing it would require a real Telegram
  event, which this read-only phase forbids.
- **The census is a point-in-time reading.** Its conclusions expire; §6 step 0 exists because
  of that.
- **Bot_Events was read in full but only aggregated.** A per-chat correlation between consent
  events and current session state would sharpen §2.3, and was deliberately not extracted.
- **`Pipeline` was read as columns A:C only** (`lead_id`, `created_at`, `updated_at`) —
  sufficient for reconciliation by id, insufficient to corroborate identity fields, which is
  why the §3.1 rule requires corroboration it cannot currently perform.
- **The 22 `ok`/`result` residue rows were classified from their column population**, not from
  their content. They are not user state under any reading, but their origin was not traced.
