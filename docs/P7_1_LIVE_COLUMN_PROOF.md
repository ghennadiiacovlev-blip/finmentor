# FINMENTOR — P7.1: the two blockers, measured against the real sheet

**Phase:** B.2.1-C P7 — the issuer half.
**Status:** **BOTH P7.0 BLOCKERS RESOLVED LIVE. F14 IS REFUTED, F15 IS CLOSED.** Two new
findings were made on the way: **F16**, which corrects a safety assumption this project has
carried since P6-RESUME, and **F17**, which blocks a hygiene sweep and nothing else.
**Production mutations: none.** One synthetic row was written and deleted. One residue column
was created and remains.

---

## 0. Why this phase existed

P7.0 §4 recorded two structural blockers and refused to argue either of them away offline:

> **F14** — `Read Bot Sessions` is pinned to `A:AV` (columns 1–48) and `submission_key` is
> `AW` (49). The Concierge structurally **cannot read** the key.
>
> **F15** — `Save Bot Session` uses `autoMapInputData`, which P6R-1 proved silently **drops** a
> key with no matching header. Whether the write lands is a **live** question.

P7.0 was right to refuse. Both statements turned out to be wrong, and in opposite directions.

---

## 1. The instrument

`scripts/p71-sheet-probe.ps1` — a disposable parent/child pair against the **real**
`Bot_Sessions` sheet (`gid 1584265787`).

Three properties make its answers admissible:

1. **The node parameters are lifted verbatim from the tracked production export.** Both `A:AV`
   read nodes and the write node carry `parameters` copied byte-for-byte out of
   `n8n/production/mppzthlkSJFr6Kle.*.json`, including the 40-entry stored `schema` on
   `Save Bot Session`. `-Create` hashes the **live** objects after the API returns them and
   refuses if any drifts from the production hash. A probe that re-expresses the production
   configuration proves something about the re-expression; this one does not re-express it.
2. **The widened read differs from production in exactly one field** — `range: A:AZ` instead of
   `A:AV`. Everything else is identical, so the two reads are a controlled pair.
3. **Parent and child.** `test_workflow` pins every credential-bearing node in the workflow it
   runs, so a single workflow would report a confident success while touching nothing. The
   child holds the credential and is invoked as a sub-workflow, where it executes for real.

Mode lives in a **node** in the parent graph, not in pin data — the public API silently declines
to store `pinData`, and a mode hidden in a pin is invisible to whoever opens the workflow before
pressing Execute.

| Mode | Execution | Child | What it did |
|---|---|---|---|
| `PREFLIGHT` | `3657` | `3658` | read-only baseline |
| `WRITE` | `3659` | `3660` | appended **one** synthetic row |
| `CLEANUP` | `3661` | `3662` | deleted that one row |

---

## 2. F14 — **REFUTED.** The Concierge can read `submission_key` today

The `WRITE` run read the **same row** at the **same moment** through two nodes differing in one
field. Both returned it:

| | `A:AV` (production, verbatim) | `A:AZ` (widened) |
|---|---|---|
| probe row found | yes | yes |
| `cycle_id` (column 43) visible | yes | — |
| `submission_key` present | **yes** | yes |
| fields returned | **58** | **58** |

Two independent reasons F14 does not exist:

**The column arithmetic was off by one.** The live header tail, measured from a full-width row,
is `AV 48 submission_key`, `AW 49 lead_mode`, `AX 50 lead_priority`, `AY 51 financial_zone` —
not `AW..AZ / 49..52`. `submission_key` is the **last column inside** `A:AV`, not the first
outside it.

**The range does not truncate anyway.** If `A:AV` bounded the read at 48 columns, that read
would return 49 fields (48 + `row_number`). It returned **58** — the full 57-column row plus
`row_number`, the identical count the `A:AZ` read returned. The `range` under
`dataLocationOnSheet` did not limit the returned columns at all. This is stated as measured, not
explained: the *why* is a node-internals question the probe did not ask and does not need.

**Consequence for the roadmap.** P7.0 §5 step 1 — *"widen `Read Bot Sessions` to `A:AZ` in a
candidate"* — is **unnecessary work on a production node that is already correct.** The safest
change to a live graph on the path of every Telegram update is the one you do not make. The
range stays `A:AV` and the gate keeps pinning it, now for the opposite reason: so that a future
edit is a deliberate act rather than a fix for a defect that was never there.

---

## 3. F15 — **CLOSED LIVE.** The write lands, all four columns

The synthetic row was minted with `require('crypto').randomBytes(16)` — the only form P7.0's
exec `3651` found to answer on this tenant — inside a real Code node, and read back:

| Column | Written | Read back |
|---|---|---|
| `submission_key` | `sub_356446df03447c0aa25eeb5e4725e661` | **identical** |
| `lead_mode` | `new` | `new` |
| `lead_priority` | `p71` | `p71` |
| `financial_zone` | `p71` | `p71` |
| `cycle_id` | `C-900000701-P71` | identical |

`autoMapInputData`, carrying the production 40-entry schema, persisted **all four** B.2.1-C
columns into headers that had **zero data on every row** — the exact condition P7.0 flagged as
the hazard. Before: `submission_key=0 lead_mode=0 lead_priority=0 financial_zone=0`. After:
all `=1`. `OTHER_ROWS_WITH_B21C: 0` — no row outside the probe gained a value, so the
no-backfill guarantee is **measured**, not asserted.

**P7.0 §5 step 2 is done.** No explicit column mapping is needed.

---

## 4. F16 — **NEW.** `autoMapInputData` does not drop an unknown key. It **creates a column**

The probe row carried one deliberate control:

```js
// THE CONTROL. There is no such column. If this survives the round trip the probe is
// measuring something other than header matching, and every other result here is suspect.
p71_absent_column: 'MUST_BE_DROPPED'
```

It survived. `CONTROL_UNKNOWN_KEY_DROPPED: false` — the read-back row **has** the property,
because the write **appended a new column** `p71_absent_column` at `BE` (57).

This is the finding that matters most, and it is worth being precise about what it overturns.
P6R-1 recorded (`BOT_SESSIONS_LEGACY_CYCLE_STATE_REMEDIATION_LIVE.md` §B): *"a key with no
matching header is silently dropped."* Against this sheet, with the production node
configuration, that is **false**. The key is not dropped and it is not an error — the sheet's
schema silently **grows**.

**Why it matters more than the probe it came from.** `Save Bot Session` sits on the write path
of every session turn. A stray property on a row object does not vanish; it permanently widens
`Bot_Sessions`. That is a much stronger reason to keep row builders exact than "the value will
be lost", because losing a value is recoverable and mutating a shared schema on a live sheet
is not.

**It also explains the residue.** The six dead trailing columns `AZ:BE` were never designed by
anyone. Each was created, one at a time, by exactly this mechanism:

| Col | Name | Created by |
|---|---|---|
| `AZ` 52 | `key` | P2/P4 canary |
| `BA` 53 | `__rows_seen` | P6-RESUME canary |
| `BB` 54 | `__advance` | P6-RESUME canary |
| `BC` 55 | `__reason` | P6-RESUME canary |
| `BD` 56 | `__verified_submission_key` | P4 canary |
| `BE` 57 | `p71_absent_column` | **P7.1, this probe** |

The control column is residue P7.1 created and did **not** clean up. It is recorded here rather
than quietly left, and §6 is what happened when the sweep was attempted.

---

## 5. Cleanup — the row is gone, verified by the same nodes that measured it

| | |
|---|---|
| deleted row | `29` |
| rows before / after | 28 → **27** (the pre-`WRITE` baseline) |
| probe rows remaining | **0** |
| B.2.1-C cells remaining anywhere | **0** |
| `CLEANUP_CLEAN` | **true** |

The delete required a positive match on **five** independent fields (`chat_id`, `session_id`,
`status`, `cycle_id`, and an empty `lead_id`) plus a `row_number > 1`. A `chat_id` match alone
is not enough to authorise an irreversible delete, and a row carrying a `lead_id` has reached
the CRM and is not disposable whatever else it says.

---

## 6. F17 — **NEW, and it blocks the hygiene sweep only**

`scripts/p71b-column-sweep.ps1` was written to remove the six dead `AZ:BE` columns. It
deliberately used the raw Sheets v4 API rather than the Sheets node, for two good reasons: the
node's column-delete takes a `startIndex` whose base is a UI detail, whereas `deleteDimension`
takes an explicit 0-based half-open range that **cannot be off by one silently**; and the raw
`values` grid gives **physical column positions**, which the node's header-keyed object output
structurally cannot.

Execution `3663` — first node, before anything was touched:

```
NodeOperationError: This credential is configured to prevent use within an HTTP Request
or GraphQL node
    at getCredentialAllowedDomains (n8n-workflow/src/credential-domain-restrictions.ts:157)
```

The Google Sheets credential `PzVCuEPa9YF3YSaD` carries a domain restriction that forbids its
use in **any** HTTP Request node. This is a sound control and it fired exactly as designed —
it is recorded as a blocker, not as a complaint.

**Blast radius: the sweep, and nothing else.** `sheets.googleapis.com` appears in the tracked
tree in **one file** — `p71b-column-sweep.ps1` itself. No production workflow, no gate, no plan
step and no other canary depends on raw Sheets API access. The P4 conditional-update canary and
every other live instrument use the Sheets node and are unaffected.

**Not worked around.** Swapping the transport to the Sheets node is not a transport swap: it
would delete the proofs the design exists for. `P1` (the six *are* the physical trailing
columns, in that order), `P3` (every cell in `AZ:BE` is empty), `P4` (no row extends past `BE`)
and `P8` (`A:AY` identical cell-for-cell after the delete) all require positional grid data the
node does not return. A weaker proof driving an **irreversible** six-column delete on a live
customer sheet is a worse trade than leaving six empty columns in place.

**Left for the owner to decide** — see §8.

---

## 7. What P7.1 does NOT claim

| | |
|---|---|
| Issuer deployed | **NO.** No candidate graph exists yet |
| Production Concierge modified | **NO** — gate (5.3) still asserts zero `submission_key` references and `active: true` |
| `submission_key` **written** live | **YES** — F15 closed, on a synthetic row, since deleted |
| `submission_key` **read** live | **YES** — F14 refuted, through the unmodified production read node |
| Mint spliced into `Get Bot Session` | **NO** — P7.2 |
| Row builders extended | **NO** — all three, together, in P7.2 |
| Dead `AZ:BE` columns removed | **NO** — blocked by F17 |
| Mini App submit gateway deployed | **NO** — unchanged, still absent |
| General Mini App activation | **NOT CLEARED** — unchanged |

---

## 8. P7.2, in order

The P7.0 §5 list is now two steps shorter. What remains:

1. **Splice the mint into `Get Bot Session`** via a deterministic generator — never by
   hand-editing a live graph. `require('crypto').randomBytes`, never the `crypto` global; gate
   (4.4) already scans every tracked Code body for the global form.
2. **Add `submission_key` to all three row builders together.** `Build Intake State Row` and
   `Build Confirmation State Row` also persist a session row, so a column added to only one of
   them is blanked by whichever runs last. Gate (5.4) pins all three.
3. **Fail-closed wiring:** when the readback is unconfirmed, `Save Bot Session` must not run.
   The graph already tolerates a turn that persists nothing — the delivery-failure branch does
   exactly that today — so this adds no new class of harm.
4. **Row-builder exactness is now a schema-integrity rule, not a hygiene preference** (F16). Any
   stray property on a row object widens `Bot_Sessions` permanently.

**Open for the owner (F17):** the sweep of `AZ:BE` needs one of —

- **(a)** allow `PzVCuEPa9YF3YSaD` in HTTP Request nodes, run `p71b` exactly as written, restore
  the restriction. The script is complete and its nine proofs are unmodified.
- **(b)** create a second, sweep-only Sheets credential without the restriction.
- **(c)** delete the six columns by hand in the Sheets UI, where a human sees what is selected
  and `Ctrl+Z` exists.
- **(d)** do nothing. Six empty trailing columns cost nothing but the confusion of the next
  person to open the sheet.

`p71b` is **not** blocking P7.2 under any of these.

---

## 9. Live tenant state after P7.1

| Workflow | id | State |
|---|---|---|
| `[TEMP] P71 sheet probe driver` | `ZV9l4u3CCVrKxbep` | live, disarmed to `PREFLIGHT` — tear down or reuse |
| `[TEMP] P71 Bot_Sessions AW column probe` | `YXkiiwCoq0hUrM8l` | live, MCP-invisible, inactive |
| `[TEMP] P71b column sweep driver` | `c4OyUDcItEto1Kb8` | live, blocked by F17 |
| `[TEMP] P71b Bot_Sessions trailing column sweep` | `DtrlDGUC9FLptEdr` | live, MCP-invisible, never executed a mutation |

No production workflow was created, modified, activated or executed. No Telegram message was
sent. No Data Table was touched. `Bot_Sessions` gained one column (`p71_absent_column`, `BE`)
and is otherwise byte-identical to its pre-P7.1 state: 27 data rows, no synthetic row, no
B.2.1-C cell populated anywhere.
