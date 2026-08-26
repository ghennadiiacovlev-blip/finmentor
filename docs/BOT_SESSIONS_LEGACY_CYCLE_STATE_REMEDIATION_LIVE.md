# FINMENTOR — Bot_Sessions legacy cycle-state remediation: **LIVE CLOSED (P6R-1R)**

> **This document has two parts.** §A is P6R-1R (2026-08-26 19:19Z–19:29Z), which found the
> live sheet already migrated, validated it, and closed the defect live. §B below is the
> original P6R-1 record, kept unedited because it explains why the phase stopped and what was
> proven offline. **Read §A first — it supersedes §B's "BLOCKED" status.**

---

# §A — P6R-1R: resume from changed live state

**Production mutations: ONE reserved synthetic row, written and deleted.** No header was
added, renamed, reordered or overwritten. No workflow was modified. No Telegram was sent. The
sheet is back to exactly 27 rows / 3 real sessions.

No PII. All figures are aggregates computed inside the tenant.

## A1. The live sheet had already been migrated — and my earlier readings were wrong

The six legacy columns **already exist**. More importantly, **two of my own earlier findings
were produced by a flawed method and are corrected here.**

### A1.1 Flaw 1 — deriving headers from the first row

P6R-0 and P6R-1 both derived the header set from `Object.keys(firstRow)`. **n8n omits a key
when a row's trailing cells are empty**, so a first row blank in the later columns hides them
entirely. That method under-reports.

It contradicted itself in this phase's first run: it reported all six legacy fields **ABSENT**
while simultaneously reporting **non-zero population** for them. A field cannot be both.

**Consequence: the P6R-0 and P6R-1 statements that the six columns were absent are not
reliable.** They may have been present and missed. Corrected method: union of keys across all
rows.

### A1.2 Flaw 2 — duplicate header names collapse and shift positions

The union method then reported 47 keys with `error` at AO and `cycle_id` at AP — one column
left of the state reported to me. That was also wrong.

**n8n collapses duplicate header names into a single object key**, so every position after a
duplicate shifts left. Two independent facts settled it:

- the Sheets API refused range `AW1:AW40` with **`Max columns: 48`** — the grid is exactly
  48 columns, A..AV;
- reading the 8-column tail `AO1:AV40` returned **7 distinct keys**, i.e.
  `DUPLICATE_COLLAPSE_DETECTED: true`, `COLLAPSED_COUNT: 1`.

47 observed keys + 1 collapsed = 48. **The reported layout is correct and mine was distorted.**

### A1.3 The true live schema

| Range | Contents |
|---|---|
| A..AN | the original 40 headers, unchanged |
| **AO** | `error` |
| **AP** | `error` — duplicate |
| **AQ** | `cycle_id` |
| **AR** | `consent_cycle_id` |
| **AS** | `consent_at` |
| **AT** | `lead_cycle_id` |
| **AU** | `lead_intake_ok` |
| **AV** | `previous_lead_id` |

Grid width **48**. No B.2.1-C column present (`submission_key`, `lead_mode`,
`lead_priority`, `financial_zone` all absent) — correct, they are out of scope.

## A2. Header change provenance — **PARTIAL**

I can prove the columns exist now. I **cannot** prove when they appeared, and I will not assert
it.

The obvious evidence — my own P6R-0/P6R-1 "absent" readings — is **inadmissible**, because
§A1.1 shows that method could not have seen the columns even if they were there. Having
discovered that my instrument was faulty, I cannot then use its earlier output as proof of
absence.

What is established: no probe in any phase performed a header write (all were read-only, and
P6R-1's single write attempt was refused by the credential control before reaching the sheet).
So **nothing I ran created them.** Beyond that, "added manually after P6R-1" and "present all
along and missed" are not distinguishable from available evidence.

Per the brief, provenance is not required to continue when the current state validates safely.
It does.

## A3. The duplicate `error` columns — **QA-RESIDUE, does NOT block**

| Metric | Value |
|---|---|
| rows with a non-empty `error` value | **2** |
| of those, on real sessions (non-empty `chat_id`) | **0** |
| production workflows referencing `error` as a Bot_Sessions column | **0** |

Same class as `ok` / `result` at AM/AN — n8n node-output residue on the 22 non-session rows.
No business or customer state depends on them.

**Do they interfere with the six?** `autoMapInputData` resolves a field by its **first** index
in the header row, so a duplicate shadows only itself: the second `error` (AP) is unreachable,
while each of the six has a unique name and a unique index. That reasoning is now **confirmed
empirically** by the mapping canary in A5.

    ERROR COLUMNS:            QA-RESIDUE
    BLOCK LEGACY REMEDIATION: NO

Recorded, not fixed: **AP is unreachable for writes**. Out of scope here, and the brief
forbids touching it. It deserves its own cleanup decision.

## A4. Fresh safety census — Option A premise still VALID

| Metric | Value |
|---|---|
| Raw rows | 27 |
| Real session rows | **3** |
| `consent` non-empty | 1 |
| `lead_id` non-empty | 1 |
| `status = ended` | 0 |
| Pipeline rows | 9 |
| Genuine (non-QA) leads matching Pipeline | **0** |
| Materially affected — total | **1** |
| …QA artifact | **1** |
| …**CUSTOMER** | **0** |

### Legacy field population, and whose rows carry it

| Field | rows with value | QA | **CUSTOMER** |
|---|---|---|---|
| `cycle_id` | 3 | 1 | **2** |
| `consent_cycle_id` | 1 | 1 | 0 |
| `consent_at` | 1 | 1 | **0** |
| `lead_cycle_id` | 1 | 1 | 0 |
| `lead_intake_ok` | 1 | 1 | **0** |
| `previous_lead_id` | 2 | 1 | 1 |

**The two genuine sessions now carry a `cycle_id`.** The remediation is already working in
production: the Concierge is persisting cycles.

## A5. No untruthful historical backfill — **PASS**

The rule is no longer "these must be empty" — that moment passed. The rule is **nothing
untruthful may have been invented.**

| Question | Answer | Evidence |
|---|---|---|
| Were historical `consent_at` values invented? | **NO** | non-empty on 1 row, and that row is the QA artifact. **Zero customer rows.** |
| Was `lead_intake_ok` backfilled without proof? | **NO** | same — 1 row, QA only, **zero customer rows** |
| Were `previous_lead_id` values invented? | **NO** | 1 customer row has one, and that row has **no current `lead_id`** — exactly the signature of `archiveLead()` running naturally on a live event, not a backfill |
| Did values arise naturally after the headers existed? | **YES** | `cycle_id` on 2 customer rows is the bootstrap path working; the fields that *cannot* be truthfully derived are populated on **zero** customer rows |

The two fields P6R-0 said must never be invented — `consent_at` and `lead_intake_ok` — are
populated on **no customer row at all**. That is the strongest available evidence that no
dishonest backfill occurred.

## A6. Live mapping canary — **PASS**

One reserved synthetic row (`chat_id 900000123`), written through the **same**
`appendOrUpdate` + `autoMapInputData` + `matchingColumns: ["chat_id"]` semantics the
Concierge uses.

| Run | What | Result |
|---|---|---|
| exec 3538 | append with all six set | **all six persisted byte-exactly** (lengths match), row 29 |
| exec 3539 | **update** the same row, state changed | `MATCHED_ROWS: 1` — updated not appended; **all six survived** |
| exec 3540 | write all six **blank** | **all six cleared to empty** |

Both directions matter: the gate must be able to *set* a cycle and to *clear* stale consent or
a stale lead. Both round-trip live.

**This closes the gap P6R-1 could not prove, and it does so with the duplicate `error`
headers present** — so the duplicate demonstrably does not interfere.

## A7. Two-event persistence — **PASS**

- **EVENT 1** — `cycle_id` written and read back identical (exec 3538). It persists.
- **EVENT 2** — the same row updated; `cycle_id` unchanged, `MATCHED_ROWS: 1` (exec 3539).

The gate's event-2 behaviour turns on exactly one predicate:
`hasNoCycle = str(s.cycle_id) === ''`. A `cycle_id` that round-trips non-empty makes that
false, so `reset === ''` and no second cycle is minted. The live fact this depends on is now
proven.

**Honest scope:** the guard *decisions* (same-cycle consent survives, stale clears, lead
archived, `previous_lead_id` rescued, `/start` and restart) are proven **offline against the
byte-exact deployed gate source** in `qa/bot-sessions-legacy-cycle.test.mjs`. Their
*persistence* is proven live by A6. I did not re-run each guard through a live Telegram-shaped
event, and I am not claiming to have.

## A8. Cleanup

The synthetic row was removed by a **guarded** delete that re-read the row and refused unless
exactly one row matched, its `chat_id` was the reserved synthetic id, and its `status` was
QA-marked. Verified afterwards: `SYNTHETIC_ROWS_REMAINING: 0`, 27 rows, 3 real sessions —
identical to the pre-canary state.

Four disposable workflows created, **all archived**: `Ytww3VgwRPtguhYR`,
`rmxZhDb4nzTqC8Ex`, `tFs6eI0UgCYrjTXO`, `qGMmVNAMUVtVKbzV`.

Tenant: **28 workflows**, all `availableInMCP: false`, no timestamps moved. Concierge
**not modified**.

## A9. Status

| Item | Status |
|---|---|
| Six legacy headers present, each unique | **YES** (AQ..AV) |
| Duplicate `error` interferes | **NO** — proven by canary |
| Mapping canary | **PASS** |
| Two-event persistence | **PASS** |
| Consent / lead guards | **PASS** (decisions offline byte-exact, persistence live) |
| Untruthful backfill | **NONE** |
| **LEGACY CYCLE DEFECT** | **LIVE CLOSED** |
| **P6 RESUME** | **YES** |
| B.2.1-C columns | **NOT ADDED** — out of scope |
| G1 | **OPEN** |

## A10. Limitations

- **Provenance of the header change is unproven** (§A2), by my own instrument's fault.
- **A column whose data cells are all empty is invisible** to the Sheets node. Every column
  reported here has at least one value, and the 48-column grid limit bounds the total — but a
  fully-empty 48th column could not have been distinguished by reading alone.
- **The guard decisions were not re-run live**, only their persistence (§A7).
- **AP (`error`) is unreachable for writes** and was deliberately left alone.

---

# §B — original P6R-1 record (superseded status, retained for the reasoning)

# FINMENTOR — P6R-1 Bot_Sessions legacy cycle-state live fix: **BLOCKED AT STEP 3**

Phase: **P6R-1 — owner-approved Option A hard reset**
Date: **2026-08-26** (window 19:03Z – 19:12Z)
Branch: `feat/miniapp-b21c-live-prereqs`
Repo HEAD at start: `387d704`

**Production mutations: NONE.** The fresh safety gate PASSED and Option A remained authorised,
but the header append could not be performed: **no available tool can write a Google Sheets
header cell.** The one API path is deliberately blocked by a credential-level security control,
and I did not attempt to work around it.

Everything that did not depend on the header write was completed: the remediation is **proven
correct offline against the byte-exact production cycle-gate source**, and a permanent
regression gate is now in the repository. What remains is a single manual owner action of a few
seconds.

No PII appears here. All live figures are aggregates computed inside the tenant.

---

## 1. Precheck — PASS

| | |
|---|---|
| Branch / tree / HEAD | `feat/miniapp-b21c-live-prereqs`, clean, `387d704` |
| `origin/main` | `d69e2e8` — unchanged |
| Concierge `mppzthlkSJFr6Kle` | **active**, `updatedAt 2026-08-25T17:39:02.486Z` (unchanged), `availableInMCP: false` |
| Tenant `availableInMCP` | **false on all 28 workflows** |

Live `Bot_Sessions` header re-read: **40 columns, no duplicates**, and all six legacy columns
still absent — the exact P6R-0 pre-migration condition.

```
session_id, chat_id, user_id, username, first_name, last_name, language, state, created_at,
updated_at, last_message_at, entry_source, selected_service, business_model, turnover_range,
main_pain, urgency, has_cfo, documents_status, contact_phone, contact_email, contact_name,
company, free_text_request, consent, lead_id, lead_sent_at, status, notes, raw_json,
reply_text, reply_markup, tg_body, session, lead_ready, lead_payload, event, ai_guarded,
ok, result
```

No B.2.1-C column present, as required.

---

## 2. Fresh safety census — **PASS, Option A premise VALID**

Execution `3531`. Classification is deliberately conservative: a materially affected row counts
as **CUSTOMER** unless it carries an explicit QA signal (`status` matching `^qa`, or a `QA-`
lead id). That biases toward stopping.

| Metric | Value |
|---|---|
| Raw rows | 27 |
| Real session rows (with `chat_id`) | **3** |
| `consent` non-empty | 1 |
| `lead_id` non-empty | 1 |
| `status = ended` | 0 |
| Pipeline rows | 9 |
| **Genuine (non-QA) leads matching Pipeline** | **0** |
| Materially affected — total | **1** |
| …QA artifact | **1** |
| …**CUSTOMER** | **0** |
| **`OPTION_A_SAFETY_PREMISE`** | **VALID** |

The gate authorising the mutation is this fresh reading, not the historical P6R-0 one.

---

## 3. Rollback evidence captured

- exact 40-header sequence, in order (§1) — this is the fingerprint
- header count 40, **zero duplicate names**
- 27 raw rows / 3 real sessions
- Concierge active state and `updatedAt`
- full aggregate census (§2)

---

## 4. Step 3 — header append: **BLOCKED**

### 4.1 What was attempted

The Google Sheets **node** cannot write a header cell — that is not one of its operations. The
correct path is the Sheets `values.update` API against range `Bot_Sessions!AO1:AT1` (columns
41–46), via an HTTP Request node authenticated with the existing
`googleSheetsOAuth2Api` credential as a predefined credential type — a pattern already used
elsewhere in this project.

Execution `3532` failed immediately:

```
This credential is configured to prevent use within an HTTP Request or GraphQL node
```

This is a deliberate n8n credential-level control ("allow use in HTTP Request node" is off).
**It is a security control, so it was not worked around, and no alternative credential was
sought or created.**

### 4.2 Every other path, assessed and rejected

| Path | Verdict |
|---|---|
| Sheets node `append` | appends a **data row**; `autoMapInputData` drops keys with no header. Cannot create a column. |
| Sheets node `appendOrUpdate` | same mapping behaviour — this is the very node that drops the six today |
| Sheets node `update` | updates rows matched by a column; its mapper is bound to existing headers |
| Sheets node `clear` / `remove` | destructive, and creates no columns |
| Sheets node `create` | creates a **new sheet/tab**, changing the live locator. Rejected outright |
| Sheets `values.update` over HTTP | **blocked by the credential control above** |
| Google Drive MCP `update_file` | whole-file replacement of a live spreadsheet. Rejected outright |

**Conclusion: there is no available programmatic path.** This is a capability stop, not a
safety stop — and unlike P6's, it has a trivially safe manual resolution.

### 4.3 The required owner action

In the Google Sheets UI, on the `Bot_Sessions` tab, in **row 1 only**, cells **AO1 → AT1**
(immediately after `result` in AN1), enter exactly:

```
AO1  cycle_id
AP1  consent_cycle_id
AQ1  consent_at
AR1  lead_cycle_id
AS1  lead_intake_ok
AT1  previous_lead_id
```

Do not reorder, rename or delete any existing header. Do not fill any data cell. Then P6R-1
resumes at step 4 (no-backfill proof) and step 5 (mapping canary), both of which are ready.

---

## 5. Steps 4–5 — NOT RUN

Both depend on the headers existing.

- **Step 4 (no-backfill proof):** ready. Re-runs the census and asserts all six new columns are
  empty on every pre-existing row, including the QA artifact.
- **Step 5 (live mapping canary):** ready, and it is the **authority** for step 11. It writes a
  synthetic row for a reserved `chat_id` through `appendOrUpdate` and reads back all six values.

A strong prediction for step 5, from the live node configuration: all three Concierge writers
use **`mappingMode: autoMapInputData`** with `matchingColumns: ["chat_id"]`, and two of them
(`Save Intake State`, `Save Confirmation State`) carry **no cached schema at all** (`schema
len: 0`). The drop is therefore live behaviour against the header row, **not** a stale cached
schema — so once the headers exist the six become writable with **no workflow change**. That is
exactly what step 11 predicted, and step 5 must still prove it rather than assume it.

---

## 6. Steps 6–9 — proven OFFLINE against the byte-exact production source

New gate: `qa/bot-sessions-legacy-cycle.test.mjs`, **18 checks**, wired into `qa/run-all.mjs`.

It does **not** retype the cycle gate. It **extracts `Get Bot Session`'s `jsCode` from the
tracked export and executes it**, because a hand-copy would only prove that my transcription
behaves correctly, which is not the claim. Persistence is modelled with the single rule that
*is* the defect: a key with no matching header is silently dropped.

### 6.1 The defect, reproduced

| Check | Result |
|---|---|
| `cycle_id` never persists → every event mints a new cycle | **reproduced** |
| a consent decision is destroyed on the next ordinary event | **reproduced** |
| a lead binding is destroyed **and** the `previous_lead_id` rescue is dropped | **reproduced** |

### 6.2 The remediation, proven

| Step | Check | Result |
|---|---|---|
| 6 | EVENT 1 bootstraps a cycle and it **persists** | **PASS** |
| 6 | EVENT 2 finds it, `reset === ''`, **no second cycle**; event 3 stable too (a fixed point) | **PASS** |
| 7 | same-cycle consent **survives** with `consent_at` unaltered | **PASS** |
| 7 | stale cross-cycle consent still **rejected** | **PASS** |
| 8 | same-cycle lead binding **retained** | **PASS** |
| 8 | stale-cycle lead archived **and `previous_lead_id` now persists** | **PASS** |
| 9 | `/start`: new cycle, consent cleared, lead archived, archive persists, status/state reset | **PASS** |
| 9 | `m|diag` restart on a finished cycle behaves the same; an **unfinished** cycle is not reset | **PASS** |
| — | a `bootstrap` does **not** clear funnel progress | **PASS** |

That last one matters for §7: `bootstrap` is not `start`/`restart`, so no user is sent back to
the beginning.

### 6.3 A residual found while writing the gate

`/start` and restart mint `'C-' + chat_id + '-' + Date.now()`. Two resets for one chat **inside
the same millisecond produce the identical cycle id** — this surfaced naturally when two
back-to-back fixtures collided and failed an equality assertion.

It is **pre-existing**, is **not made worse** by adding the six columns, and is precisely the
collision P3 cited when rejecting a derived submission key in favour of MODEL B's 128-bit
random key — so B.2.1-C already routes around it. It is recorded as a permanent check rather
than silently absorbed, and the affected assertions now test the reset **decision** instead of
comparing wall-clock-derived ids.

---

## 7. Step 12 — repo regression guard

The same gate pins the contract:

- every field the guards depend on is in the legacy required set, checked **against the gate
  source** rather than a remembered list;
- all three row builders carry the same required set, and are asserted **identical to one
  another** so one cannot drift alone;
- **mutation:** dropping any one of the six breaks the contract — each of the six is removed in
  turn and the failure is required;
- **no B.2.1-C column is falsely marked live**: `submission_key`, `lead_mode`, `lead_priority`
  and `financial_zone` are absent from the required set, from the migrated header set, and
  from every row builder.

No runtime state-machine behaviour was changed.

---

## 8. Step 10 — real customer effect (unchanged, since nothing was migrated)

The two genuine early-funnel sessions are **structurally untouched** in all 40 original fields.
Once the headers exist, on their next ordinary event: one bootstrap cycle is minted and
persists, their funnel fields survive (§6.2), they are not sent to `/start`, and no historical
consent is invented. **No message was sent to any user.**

---

## 9. Step 11 — Concierge workflow: **NOT MODIFIED**

As instructed, the Concierge was not touched to refresh cached mapper metadata. §5 explains why
that should prove unnecessary, and step 5's canary — not this reasoning — is the authority. If
step 5 shows any field still dropped, the correct outcome is to STOP and report
**WORKFLOW MAPPER REFRESH REQUIRED**, not to patch it inside P6R-1.

---

## 10. Cleanup

Three disposable workflows created, **all archived**:

| ID | Name |
|---|---|
| `YrrPMwtJkjpoR3pB` | `[TEMP] P6R-1 preflight census` |
| `xCoGWQsWMHzizES8` | `[TEMP] P6R-1 header migration` (failed at the credential control) |
| `srf3OYf6P4oeiwhX` | `[TEMP] P6R-0 read-only census` (archived in the previous phase) |

Post-cleanup: **28 workflows** — the exact pre-phase set — all `availableInMCP: false`, all
`updatedAt` unchanged at `2026-08-25` or earlier.

**No synthetic Bot_Sessions row was created**, because step 5 never ran. Nothing to delete.

**Production residue: NONE.** Not even the six columns.

---

## 11. Status

| Item | Status |
|---|---|
| Fresh census / Option A premise | **PASS / VALID** |
| Bot_Sessions header migration | **NOT APPLIED — blocked, owner action required (§4.3)** |
| Legacy cycle defect | **OPEN** — proven closable, not yet closed live |
| Remediation logic | **PROVEN OFFLINE** against byte-exact production source |
| Regression guard | **IN REPO** — 18 checks, mutation-tested |
| Concierge workflow | **NOT MODIFIED** |
| P1-L11 | **FAIL** — unchanged |
| P6 | **STOPPED** — unchanged |
| P4, P6-3A/F4, P1-L2′, P1-L3 | **valid, untouched** |
| P1-L4 | **PARTIAL** |
| G1 | **OPEN** — explicitly not closed by P6R-1 |

---

## 12. Limitations

- **The remediation is proven in a model, not live.** §6 executes the real gate source but
  models Sheets persistence. Step 5 is what turns that into a live proof, and it has not run.
- **The consent-wipe remains reproduced offline only.** No real Telegram event was manufactured.
- **The 22 `ok`/`result` residue rows** were classified from column population, not traced to
  their origin.
- **The step-5 prediction in §5 is a prediction.** The `autoMapInputData` reasoning is strong
  and is backed by two writers having no cached schema at all, but it is not evidence.
