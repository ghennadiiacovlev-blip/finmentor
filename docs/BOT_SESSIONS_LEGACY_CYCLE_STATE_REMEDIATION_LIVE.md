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
