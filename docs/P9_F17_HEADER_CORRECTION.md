# P9 — F17: the corrected Bot_Sessions tail, and why my probe was wrong

**2026-08-29. Supersedes the `AZ:BH` instruction and my own reading of the header.**

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

**F17 residue is `BA:BI` — nine columns. `AZ` is live and must not be touched.** The earlier
`AZ:BH` framing is retired: it was off by one column in both directions, and acting on it would
have deleted `financial_zone`, a column the receipt contract writes.

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

## Standing instruction

- Deletion of `BA:BI` is a **manual owner action** in the Sheets UI. Never programmatic.
- Before deletion: fresh-verify the fourteen names above.
- After deletion: fresh-read and require the physical schema to end at `AZ = financial_zone`.
- `A:AZ` is not to be touched, including any duplicate-looking historical fields inside it.
