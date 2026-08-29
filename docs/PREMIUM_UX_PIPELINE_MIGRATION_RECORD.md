# Premium UX — Pipeline migration: DONE

**Status: COMPLETE. Executed 2026-08-29 under owner decision 1.**
**Result: PIPELINE MIGRATION = PASS.**

Three header columns were added to the `Pipeline` tab of `FINMENTOR_LEADS_CRM_PREMIUM_FINAL`:

| Column | Header |
|--------|--------|
| BP | `current_setup` |
| BQ | `decision_horizon` |
| BR | `important_context` |

No row was written. No existing column moved. No writer node was changed in the same action.

This file was a proposal until the migration ran; it is now the record of what was done and what
was measured afterwards. The proposal's checklist is preserved below as the *preconditions* section
so the sequence that was actually followed stays legible.

---

## 1. What the migration mechanism was, and why

The production Google Sheets credential is domain-restricted. F17 proved it blocks raw
`sheets.googleapis.com` calls from an HTTP Request node — a sound control that must not be weakened
for a schema change. The Google Sheets **node** is the only path that credential admits.

So the migration used the F16 mechanism deliberately: a Sheets node in `autoMapInputData` mode,
handed keys the header does not contain, **appends those columns**. F16 is the defect that widened
this workbook twice by accident. Using it on purpose is only defensible if it is proven first on a
disposable copy — which is the P9-R2/R4 method, and which is what happened.

The update matched on `lead_id` against a marker value that cannot exist
(`__SCHEMA_MIGRATION_NO_MATCH__<epoch>`), so the node reconciled the header, appended three
columns, and then matched no row. **That is why no data was written.**

Script: `scripts/migrate-pipeline-premium-columns.mjs`. It deploys a disposable webhook workflow,
fires it once, reads the execution back, and tears the workflow down in a `finally` block with
absence verified by re-reading the id. The script deliberately **does not verify its own work** —
verification came from a fresh authoritative export.

## 2. Preconditions, and how each was met

| # | Precondition | How it was satisfied |
|---|--------------|----------------------|
| 1 | Fresh workbook snapshot as rollback | Copy taken immediately before: `1B1ZTvpVyx-de6ck8wfw7asv8Jur9eGheJJEpx__eyNQ` |
| 2 | Authoritative physical header re-read | Drive → XLSX export, not an n8n range probe (F17 rule) |
| 3 | Last column confirmed `BO` before the change | Verified: 67 columns |
| 4 | Mechanism proven on the snapshot first | `--target snapshot` run; snapshot header reconciled cleanly, no row written |
| 5 | No writer node changed in the same action | Lead Intake untouched during the migration |
| 6 | Disposable workflow, torn down | Deployed, fired, deleted; absence verified by re-read |
| 7 | Production run gated behind `--confirm` | `--target production --confirm` |
| 8 | Fresh authoritative re-read afterwards | Second XLSX export, §3 below |
| 9 | Blast-radius check across the workbook | All 16 tabs compared, §3 below |

## 3. What was measured after the migration

Fresh authoritative export, not a re-read of anything the migration produced:

| Check | Result |
|-------|--------|
| Pipeline column count | 67 → **70** |
| `BP` header | `current_setup` |
| `BQ` header | `decision_horizon` |
| `BR` header | `important_context` |
| `BS` | **absent** — exactly three columns appended, no fourth |
| Data cells in `BP:BR` | **0** |
| Junk / marker rows | **0** — no `__SCHEMA_MIGRATION_NO_MATCH__` row anywhere |
| Pipeline data rows | **1010**, unchanged |
| Headers `A`–`BO` | byte-identical to the pre-migration export |
| Tabs in the workbook | **16**, all unchanged |
| `Bot_Sessions` columns | **52**, unchanged (F17 residue untouched) |

The marker-row check matters more than it looks: the whole safety of the mechanism rests on the
match failing. Zero junk rows is the evidence that it did.

## 4. Rollback

The snapshot `1B1ZTvpVyx-de6ck8wfw7asv8Jur9eGheJJEpx__eyNQ` is the pre-migration workbook in full.
Rolling back a header-only, data-free append is also possible in place by clearing `BP1:BR1` — but
**do not delete the columns**: F17 established that column emptiness is never the deletion criterion
in this workbook, and that rule applies here too.

## 5. What is NOT done

Nothing writes to `BP`, `BQ` or `BR` yet. The Lead Intake projection that populates them is a
prepared candidate, not a deployment — see `PREMIUM_UX_PRODUCTION_PREREQUISITES.md`. Until it is
deployed, all three values continue to travel to Lead Intake and land in `raw_json`, exactly as
before: nothing is lost, the values are simply not queryable as columns.

The Sheets writer node remains in `defineBelow` mapping mode. It must stay there. `autoMapInputData`
is the F16 defect; it was used once, deliberately, by a disposable workflow that no longer exists,
and it must not be introduced into a production writer to populate these columns.
