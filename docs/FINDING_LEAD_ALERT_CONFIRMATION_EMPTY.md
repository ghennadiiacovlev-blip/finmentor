# FINDING — the action confirmation is empty for three of the four keyboard shapes

**Found:** 2026-08-31, by the first real tap of the Stage 2 action lifecycle
**Execution:** `5055` — `FINMENTOR Lead Command Center SECURE CANDIDATE` (`qF9tonlHHIxc8MDd`), status `error`
**Severity:** presentation only. No CRM data is wrong, and no write is lost.
**Status:** FIXED and deployed 2026-08-31T14:51:08Z. See [Resolution](#resolution).
**Fixed by:** `scripts/deploy-lead-alert-ack-fix.mjs` — one expression, one node.
**Gated by:** `qa/lead-alerts-ack-expression.test.mjs`, which fails on the pre-fix graph.

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

## The fix

`Find & Build Update` is on **both** paths into `Route Edit Shape` — the refusal path
(`IF Action Allowed` false) and the verified path (`IF Verified` true) — and carries both
`reply_text` and `reply_text_presentation_failed` unchanged through `Verify Mutation`. It is a
single-output Code node, so `.first()` is unambiguous there:

```
={{ $json.error ? $('Find & Build Update').first().json.reply_text_presentation_failed
                : $('Find & Build Update').first().json.reply_text }}
```

One expression on one node. No graph change, no new node, no schema change.

This was confirmed by tracing rather than asserted: the only two feeders of `Route Edit Shape` are
`IF Action Allowed` (output 1, refusal) and `IF Verified` (output 0, success), and every path from
`Find & Build Update` reaches the router through one of them. `Verify Mutation` would have been
**wrong** — it is not on the refusal path, so the reference would name a node that never executed
for a refused tap.

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

---

<a id="resolution"></a>

## Resolution

**Deployed** 2026-08-31T14:51:08Z to `qF9tonlHHIxc8MDd`. The delta was exactly one parameter on
one node: 33 nodes before and after, connections byte-identical, Google Sheets nodes untouched,
credentials untouched, and all 32 unrelated nodes byte-identical to the frozen pre-image. The live
graph was then pulled back and compared to the gated candidate — every node matches.

Rollback: `PUT /api/v1/workflows/qF9tonlHHIxc8MDd` with `.uat/qF9tonlHHIxc8MDd.pre-ack-fix.json`.

### The blind spot mattered more than the defect

Every offline gate passed on the broken graph, because every offline gate either executes Code
nodes or reads graph wiring — and a Telegram node's `text` expression is neither. `qa/n8n-expression.js`
closes that class by evaluating n8n parameter expressions the way n8n evaluates them, and it is
faithful on the single rule that mattered:

> `$('Node').first(branchIndex = 0)` reads the node's **first output branch**.

Modelling `.first()` as "the item, wherever it went" would have produced a green run for a graph
that fails in production — the one way that file could have been worse than useless.

`qa/lead-alerts-ack-expression.test.mjs` (23 assertions) drives the candidate's own Code nodes for
five keyboard shapes chosen to land on **all four** switch branches, routes each through the Switch
the way n8n routes it, and asserts the acknowledgement is non-empty and is the copy the decision
produced — plus the four refusals, the unverified write, and every button label and `callback_data`
on each edit node.

### It pins the defect by failing on it

The pre-fix candidate is kept as a fixture and re-run every time the suite runs. The gate requires
that the static scan flag `Telegram Update Reply -> Route Edit Shape`; that driving it off branch 0
reproduces an **empty** acknowledgement while `reply_text` is demonstrably present; and that branch
0 still works — which is precisely why the defect survived review. A gate that cannot fail on the
graph that actually broke is not evidence.

The scan also runs graph-wide, so no future parameter can address any multi-output node with a bare
accessor. Re-scanned against the live tenant after the deploy: six multi-output nodes
(`Route Command Mode`, `IF Row Found`, `IF Has Callback`, `IF Action Allowed`, `IF Verified`,
`Route Edit Shape`), **zero** bare accessors.

### What is still not proven

That n8n *executes* the corrected expression. This gate is bytes and evaluation, not execution —
the same limit that let `5055` through in the first place. Re-running the tap verifier against
execution `5055` will still report its 2 failures: that execution is immutable evidence of the
defect, not a check of the fix.

Only a **new** tap closes it. Note the previous tap already advanced this lead
(`Qualified` -> `Documents Requested`), so a confirming tap should use a different lead, or a
repeatable action such as snooze — which also has the advantage of landing on a non-zero branch,
where the defect actually lived.
