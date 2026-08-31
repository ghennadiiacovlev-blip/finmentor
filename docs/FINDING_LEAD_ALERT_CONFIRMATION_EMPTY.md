# FINDING — the action confirmation is empty for three of the four keyboard shapes

**Found:** 2026-08-31, by the first real tap of the Stage 2 action lifecycle
**Execution:** `5055` — `FINMENTOR Lead Command Center SECURE CANDIDATE` (`qF9tonlHHIxc8MDd`), status `error`
**Severity:** presentation only. No CRM data is wrong, and no write is lost.
**Status:** OPEN. Not fixed, on the owner's instruction to stop after reporting.

---

## What the owner saw

He tapped **📄 Документы** on a NEW LEAD alert (message `145`). The alert refreshed correctly —
same text, same formatting, 📄 Документы gone, the remaining buttons two per row. He received **no
confirmation message**, and then received a **SYSTEM ALERT** from the Error Monitor
(execution `5056`) about the failed node.

## What actually happened

Everything that decides a business outcome succeeded, in the designed order:

| node | result |
|---|---|
| `Verify Telegram Identity` | authenticated; `origin_had_done=false` → NEW LEAD set |
| `Get Pipeline (Update)` | fresh read, pre-image identical to the frozen pre-tap row |
| `Find & Build Update` | `_allowed=true`, action `docs` |
| `Build Sparse Update` | `{lead_id, deal_stage, documents_requested_at, next_follow_up_at}` — nothing else |
| `Update Pipeline Row` | written |
| `Get Pipeline (Verify)` | fresh read-back |
| `Verify Mutation` | `_verified=true`, `_mismatched=[]`, `kb_shape=KB21` |
| `Edit Alert (3)` | Telegram `ok:true`, `edit_date` stamped, text and all 7 entities byte-identical |
| `Telegram Update Reply` | **400 — `Bad Request: message text is empty`** |

## Root cause

`Telegram Update Reply` sources its text from the **Switch** node:

```
={{ $json.error ? $('Route Edit Shape').first().json.reply_text_presentation_failed
                : $('Route Edit Shape').first().json.reply_text }}
```

`$('Route Edit Shape').first()` resolves against the switch's **first output branch**. A switch
routes each item down exactly one branch, so only one of the four is ever populated. In execution
`5055` the branch item counts were:

```
[0] KB221  0 items
[1] KB22   0 items
[2] KB21   1 item     <- the item went here
[3] NONE   0 items
```

Branch 0 was empty, the expression resolved to nothing, and Telegram rejects an empty `text`.

**This fails for three of the four shapes.** Only `KB221` — the 2+2+1 PRIORITY keyboard, which
lands on branch 0 — would have produced a confirmation. Every NEW LEAD tap (`KB22`/`KB21`) and
every terminal action (`NONE`, i.e. `done` and `nurture`) hits it. The offline gate could not see
this: it proves the *copy* is correct, and the copy **was** correct — `Verify Mutation` carried the
right `reply_text` (135 characters) the whole way. Only the expression that fetches it is wrong.

## Why the pre-tap verification missed it

`scripts/verify-lead-alert-actions-live.mjs` executes the deployed Code nodes and asserts the
graph's wiring. It does not evaluate n8n **expressions** on Telegram nodes, and expression
semantics — specifically what `.first()` means on a multi-output node — are exactly what no offline
harness models. This is the class of defect a live tap exists to find.

## The fix, not applied

`Find & Build Update` is on **both** paths into `Route Edit Shape` — the refusal path
(`IF Action Allowed` false) and the verified path (`IF Verified` true) — and carries both
`reply_text` and `reply_text_presentation_failed` unchanged through `Verify Mutation`. It is a
single-output Code node, so `.first()` is unambiguous there:

```
={{ $json.error ? $('Find & Build Update').first().json.reply_text_presentation_failed
                : $('Find & Build Update').first().json.reply_text }}
```

One expression on one node. No graph change, no new node, no schema change.

Checked and **not** part of this finding: the `$json.error` discriminator is correct. The
`Edit Alert (*)` nodes carry `onError: continueRegularOutput`, so a failed edit reaches
`Telegram Update Reply` with n8n's error object on the item, while a successful edit yields the
Telegram envelope `{ok:true, result:{…}}` with no `error` key.

## State left behind

Nothing was restored. The row stands as the tap left it:

| column | frozen pre-tap | now |
|---|---|---|
| `deal_stage` | `Qualified` | `Documents Requested` |
| `documents_requested_at` | *(empty)* | `2026-08-31T14:19:14.875Z` |
| `next_follow_up_at` | `2026-08-30T22:13:38.231Z` | `2026-09-02T14:19:14.875Z` |

`sla_status` stayed `Active`, `last_contacted_at` stayed empty, and 67 unrelated columns are
byte-identical across the write. Rollback readiness is the three values above and the freeze at
`.uat/pipeline-row-FIN-1788113619104-582.pre-tap.json`.

## Reproduce

```
node scripts/verify-lead-alert-tap-live.mjs --execution 5055
```

Read-only. 70 assertions pass; 2 fail, both naming this defect.
