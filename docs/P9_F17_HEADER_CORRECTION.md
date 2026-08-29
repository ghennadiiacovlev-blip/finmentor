# P9 — F17: the corrected Bot_Sessions tail, and why my probe was wrong

# F17 = CLOSED / VERIFIED — REQUIRED DELETION = NONE

**2026-08-29. Supersedes the `AZ:BH` instruction and my own reading of the header.**

> ## CLOSURE — verified against the live sheet, 2026-08-29
>
> A fresh authoritative read of the live spreadsheet establishes that **the intended physical
> schema already ends at `AZ = financial_zone`**, and that **the `BA:BI` residue is already
> absent**. There is nothing to delete.
>
>     Bot_Sessions header  : 52 contiguous cells, A:AZ, no gaps
>     final column         : AZ = financial_zone
>     BA:BI                : NO CELL — no header, no data
>     data at/beyond BA    : zero, across 192 data rows
>
> **No owner deletion action is required.** The post-delete criterion in the standing instruction
> below — *"fresh-read and require the physical schema to end at `AZ = financial_zone`"* — is
> **already satisfied**. See §"Verified live state" at the foot of this document for the method
> and the full evidence.
>
> **Do not run any column deletion against `Bot_Sessions`,** and in particular do not act on the
> retired `AZ:BH` runbook still printed in `P8_PRE_ACTIVATION_GO_NO_GO.md` §6, which would delete
> `financial_zone`.

## The authoritative header

Established by a direct Google Sheets read (owner), not by an n8n node:

| col | name | |
|---|---|---|
| AV | `previous_lead_id` | intended |
| AW | `submission_key` | intended |
| AX | `lead_mode` | intended |
| AY | `lead_priority` | intended |
| **AZ** | **`financial_zone`** | **intended — the schema ENDS here** |
| BA | `key` | dead |
| BB | `__rows_seen` | dead |
| BC | `__advance` | dead |
| BD | `__reason` | dead |
| BE | `__verified_submission_key` | dead |
| BF | `p71_absent_column` | dead |
| BG | `__do_write` | dead |
| BH | `__mode` | dead |
| BI | `__before` | dead |

**F17 residue was `BA:BI` — nine columns. `AZ` is live and must not be touched.** The earlier
`AZ:BH` framing is retired: it was off by one column in both directions, and acting on it would
have deleted `financial_zone`, a column the receipt contract writes.

> **As verified 2026-08-29, the nine `BA:BI` columns are NO LONGER PRESENT.** The table above is
> retained as the record of what the residue *was* and of the corrected mapping that prevented a
> destructive deletion. Rows `AV:AZ` remain live and exact; rows `BA:BI` are **absent**.

## Why the n8n Sheets node must not be the authority here

The owner's ruling — *do not use the n8n Sheets node range probe as authority for physical column
position* — is correct, and the probe failed in a second, worse way that is worth recording so the
instrument is not reached for again.

**1. It ignores the range.** `options.dataLocationOnSheet.values.range` was set to `AY:BJ` and
returned 41 keys. Narrowed to `A:E` as a control, it returned the **identical** 41 keys. The range
parameter had no effect at all, so no column letter can be inferred from key position.

**2. It did not return the live header set.** The probe reported 40 names ending
`… ai_guarded, ok, result`, containing **no** `previous_lead_id`, `submission_key`, `lead_mode`,
`lead_priority` or `financial_zone` — none of `AV:AZ` above, and none of the nine `BA:BI` residue
names either. The direct read shows all fourteen. The node's header-keyed output is therefore not
merely useless for *position*; on this sheet it did not describe the current *column set*.

The most likely cause is the node's cached schema for the document, which is a reasonable thing
for a node to keep and a disastrous thing to audit a header with.

**The finding that matters:** an instrument that answers confidently and identically to two
different questions is not returning an answer. The `A:E` control is what exposed it, and it cost
one extra run. Without it the wrong mapping would have been reported as fact — and the deletion it
implied would have taken `financial_zone`.

F17 itself — the Sheets credential's domain restriction blocking raw `sheets.googleapis.com` — is
what makes this awkward, and it remains a **sound control that fired as designed**. The correct
response is a direct read outside n8n, which is what the owner did, not a workaround inside it.

## Standing instruction — SATISFIED, retained as the rule for `Bot_Sessions`

The first three lines are **discharged**: the verification below found nothing to delete, so no
manual action was taken and none is required. The last line stands permanently, and one more has
been added that this verification made necessary.

- ~~Deletion of `BA:BI` is a **manual owner action** in the Sheets UI. Never programmatic.~~
  **Moot — `BA:BI` do not exist. Required deletion = NONE.**
- ~~Before deletion: fresh-verify the fourteen names above.~~ **Done 2026-08-29; see below.**
- ~~After deletion: fresh-read and require the physical schema to end at `AZ = financial_zone`.~~
  **Already true.**
- `A:AZ` is not to be touched, including any duplicate-looking historical fields inside it
  (`AO error` / `AP error 2` are inside `A:AZ` and are therefore protected).
- **Column emptiness is NEVER the deletion criterion on `Bot_Sessions`.** `AZ financial_zone`
  holds zero data across all 192 rows, and so do fourteen other legitimate columns — `Y consent`,
  `AE reply_text`, `AF reply_markup`, `AG tg_body`, `AH session`, `AI lead_ready`,
  `AJ lead_payload`, `AK event`, `AL ai_guarded`, `AM ok`, `AO error`, `AQ cycle_id`,
  `AX lead_mode`, `AY lead_priority`. Any "sweep the empty trailing columns" heuristic would take
  `financial_zone` with it. Deletion must be driven by an explicit, named residue list, never by
  occupancy.

## Verified live state — 2026-08-29

**Method.** A fresh authoritative export of the live spreadsheet through Google Drive as **XLSX**,
parsed by **explicit physical cell references** (`r="AZ1"`). The n8n Sheets node was not used at
any point, per the owner's standing ruling and for the two independent reasons recorded above.
XLSX is the right instrument because every cell carries its own column reference, so an absent
column is unambiguous rather than inferred from key order.

    spreadsheet   FINMENTOR_LEADS_CRM_PREMIUM_FINAL
                  1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A
    tab           Bot_Sessions — exactly one tab of that name, so name resolution is unambiguous
                  (n8n references it as gid 1584265787; XLSX carries no gid)

**Result — the physical sequence `AV:BI`:**

    AV  previous_lead_id     present, exact      AZ  financial_zone   present, exact — schema ENDS
    AW  submission_key       present, exact      BA .. BI            NO CELL — no header, no data
    AX  lead_mode            present, exact
    AY  lead_priority        present, exact

52 contiguous header cells, `A` through `AZ`, **no gaps**. Zero data cells at or beyond `BA`
across 192 data rows.

**That the absence is real and not an export artifact** — four independent signals:

1. **Positive control.** In the *same export*, `Pipeline` carries headers through `BO`, including
   `BA analytics_consent` … `BH _found`, `BI from_stage`. The export demonstrably preserves
   columns across exactly the `BA:BI` range. (Pipeline is out of F17 scope and was not touched.)
2. The sheet's own structured table is `Table_1 ref="A1:AZ193"`, **52 columns** — bounded at `AZ`.
3. Column-format entries stop at `max=52`, which is `AZ`.
4. The widest cell reference anywhere in the sheet is `AZ`.

**Stated limitation.** XLSX represents cells, not the Google grid. This proves no header and no
data exist at or beyond `BA`. It does not prove the grid contains zero columns past `AZ` — a
wholly empty grid column would be invisible either way, and is not F17 residue.

**Most probable explanation** for the difference from the 2026-08-29 05:30Z record above: the
deletion was already performed manually by the owner, which is exactly the route the standing
instruction prescribed. That cannot be proven from the sheet alone, so it is recorded as the
likely cause rather than as fact. The end state is what F17 required either way.

## Verdict

    F17                = CLOSED / VERIFIED
    Required deletion  = NONE
    Final legit column = AZ = financial_zone
    BA:BI              = absent
    Blocking data      = none
