# Premium UX — Pipeline migration: proposal only

**DESIGN ONLY. The live sheet was not touched. No column was added. No writer node was changed.**

Owner decision A accepted `BP current_setup`, `BQ decision_horizon`, `BR important_context` **in
principle** and required the checklist below before any live migration. This document supplies
every item that can be supplied offline and names the two that need a fresh live read at migration
time.

Until F1 runs, all three values travel to Lead Intake and are captured in `raw_json`, so nothing is
lost in the meantime — they are simply not queryable.

---

## 1. Fresh workbook snapshot — **required at migration time**

Not yet taken; a snapshot from today would be stale by then. At migration:

1. Google Sheets → *File → Make a copy* of `FINMENTOR_LEADS_CRM_PREMIUM_FINAL`. This is the rollback.
2. Re-read the physical header through an authoritative export (the F17 method: Drive → XLSX →
   parse by explicit cell reference), **not** an n8n Sheets range probe.
3. Confirm the last physical column is still `BO` before appending.

## 2. Exact physical last column — verified, must be re-verified

Read authoritatively during Phase 1 (XLSX export, parsed by cell reference):

    Pipeline: 67 physical columns, A … BO
    BO = reply_text

`Save to Pipeline` writes **59** of the 67 with `mappingMode: defineBelow`. The other eight
(`BH _found`, `BI from_stage`, `BJ to_stage`, `BK stage_changed`, `BL command`, `BM chat_id`,
`BN callback_query_id`, `BO reply_text`) belong to the Command Center and other workflows.

**If the re-read at migration time does not show `BO` as the last column, STOP** — something else
added a column since, and the insertion positions below are wrong.

## 3. Exact insertion plan

**Append after `BO`. Never insert between existing columns** — `Save to Pipeline` is `defineBelow`
and maps by header NAME, but the Command Center and other readers are not all name-based, and an
insertion shifts every letter to its right.

    BP   current_setup
    BQ   decision_horizon
    BR   important_context

Header text is the column name exactly as written above: lowercase, underscore-separated, matching
the key `Build Pipeline Row` will emit.

## 4. `Build Pipeline Row` stays `defineBelow`

`Save to Pipeline` is already `mappingMode: defineBelow` with a 59-entry `columns.value` and a
matching `columns.schema`. The migration adds three entries to **both**:

    current_setup:     pick(item.premium_current_setup)
    decision_horizon:  pick(item.premium_decision_horizon)
    important_context: pick(item.premium_important_context)

**`defineBelow` is what makes this safe in one direction and dangerous in the other:** an emitted key
with no mapping is silently dropped, and a mapped key with no column is silently dropped too. That
is why the header must exist **before** the writer changes (§8), and why a post-migration read-back
of one real row is mandatory rather than optional.

## 5. Proof the new keys cannot reach `Update Pipeline (Merge)`

`Update Pipeline (Merge)` uses `mappingMode: autoMapInputData` with an **empty** stored schema, so
any unrecognised key that reaches it appends a column permanently. This is the F16 mechanism that
has already widened a FinMentor sheet twice by accident.

**Containment: the three keys are never emitted onto that path.** `Build Merge Update` is the only
node feeding `Update Pipeline (Merge)`, and it is **not** changed by this migration. A key that is
never built cannot be auto-mapped.

Required regression assertion, to be added with the migration:

    Build Merge Update emits none of: current_setup, decision_horizon, important_context

Rejected alternative: promoting `Update Pipeline (Merge)` to `defineBelow`. It would let a merge
refresh the three values, but it edits a closed write path for no v1 benefit. **Consequence,
accepted and stated:** on a dedup merge the three columns keep their original values. Under the
terminal rule a Mini App submission cannot requalify into a merge without an explicit new request,
which mints a new cycle, so this is rare by construction.

## 6. Historical-row compatibility

Historical rows keep the three columns **empty**, and empty means *not collected* — never
*nothing available*, and never *no urgency*. Consumers must treat blank as unknown:

- the meeting brief already omits a section whose value is empty (`meeting-brief.js`), so an old
  lead renders a shorter brief rather than a brief full of dashes;
- any filter on `decision_horizon` must treat blank as "no answer", not as a horizon;
- no backfill is proposed. The values were never collected for those rows and inventing them would
  be worse than their absence.

## 7. Rollback

| Step | Rollback |
|---|---|
| Header added (F1) | Delete columns BP:BR by hand. **Irreversible for any data already written**; the workbook snapshot from §1 is the real rollback. |
| `Build Pipeline Row` + `Save to Pipeline` (E1, E2) | `n8n/history/QmIyEW2ZEqKregmN.pre-premium-columns.json` snapshot, restored by PUT — the P9-R4 pattern |

Order matters for rollback too: revert the writer **first**, then the header. A writer emitting keys
whose columns were just deleted silently drops them, which looks like success.

## 8. Deployment order — must not invert

    1. workbook snapshot                          (§1)
    2. authoritative re-read; confirm BO is last  (§2)
    3. add BP, BQ, BR headers by hand             (§3)   ← IRREVERSIBLE
    4. re-read; confirm BP/BQ/BR at those exact positions
    5. deploy Build Pipeline Row + Save to Pipeline (E1, E2) with the P9-R4 delta discipline:
         L == A on every executable field, C_live = apply(delta, L),
         diff == exactly the declared change, readback == C_live
    6. drive ONE real submission through an isolated harness; read the row back and confirm all
       three columns landed in BP/BQ/BR and nothing else moved
    7. refresh the tracked export and the manifest structural hash

**Never step 5 before step 3.** Under `defineBelow` a key with no column is dropped without error.

## 9. F16 regression gate

To be added with the migration:

1. `Build Merge Update` emits none of the three keys (§5).
2. `Save to Pipeline` remains `defineBelow`; a mutation to `autoMapInputData` fails the gate.
3. `columns.value` and `columns.schema` agree — no mapped key without a schema entry and vice versa.
4. The physical header read back from an authoritative export has `current_setup` at `BP`,
   `decision_horizon` at `BQ`, `important_context` at `BR`.
5. No node anywhere in Lead Intake carries `alwaysOutputData: true` **and**
   `onError: 'continueErrorOutput'` (the existing P9-R4 assertion, re-run).

## 10. What is NOT proposed

- No new column for `desired_outcome` — it goes to the existing, previously unused `selected_goals`.
- No column for the free-text outcome — appended into `selected_goals` by `submit-projection.js`.
- No column for `contact_channel` — derived from which of email/phone/telegram is populated.
- No `documents_refs` column — owner decision A defers binary upload; v1 uses the existing
  `documents_status` and `selected_documents` for availability categories.
- No change to `Bot_Sessions`. F17 stands: the schema ends at `AZ = financial_zone`.

## 11. Blocking items

1. **Owner approval** for the three columns and for the irreversible header edit.
2. A **fresh workbook snapshot** immediately before step 3.
3. A **fresh authoritative header read** confirming `BO` is still the last column.
