# FINDING — the action confirmation is empty for three of the four keyboard shapes

**Found:** 2026-08-31, by the first real tap of the Stage 2 action lifecycle
**Execution:** `5055` — `FINMENTOR Lead Command Center SECURE CANDIDATE` (`qF9tonlHHIxc8MDd`), status `error`
**Severity:** presentation only. No CRM data is wrong, and no write is lost.
**Status:** FIXED and deployed 2026-08-31T14:51:08Z — but **OPEN** until a confirming tap proves
n8n executes it. See [Resolution](#resolution) and [How this gets closed](#closing).
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

Only a **new** tap closes it, and **as of 2026-08-31T15:30Z no tap has arrived** — `5055` is still
the most recent Command Center execution on the tenant. The finding therefore stays OPEN, and
everything below is the apparatus that closes it the moment one lands.

---

<a id="closing"></a>

## How this gets closed

### The tap: ⏰ На 24 часа, on the alert already in the owner's Telegram

Open the NEW LEAD alert for **Mega Parc SRL** (message `145`) and tap **⏰ На 24 часа**. That alert
now carries exactly three buttons, which is what the `5055` edit left behind:

```
📞 Discovery   |   ⏰ На 24 часа
🗂 В Nurture
```

Snooze rather than anything else, for three reasons, each of which is a property of the code and
not a preference:

* **it is repeatable.** `alreadyApplied()` returns `false` for snooze by design — «отложить ещё на
  24 часа» is a real instruction — so the tap is not refused, and it can be repeated if anything
  needs re-running. Every other remaining action would move the lead somewhere it cannot be
  cheaply moved back from.
* **it changes nothing that matters.** Snooze owns `sla_snooze_until` and `next_follow_up_at` and
  nothing else. `deal_stage` does not move again, so proving the fix does not cost another step of
  this lead's real pipeline position.
* **it lands where the defect lived.** The lead is `Documents Requested`, so the refreshed keyboard
  is `KB21` — **branch 2**, not branch 0. Branch 0 (`KB221`) worked before the fix and works after
  it; a confirmation observed there would prove nothing.

Rollback, should it ever be wanted, is two values: `sla_snooze_until` back to empty and
`next_follow_up_at` back to `2026-09-02T14:19:14.875Z`.

### The verifier: `scripts/verify-lead-alert-ack-tap-live.mjs`

```
node scripts/verify-lead-alert-ack-tap-live.mjs
```

Read-only, no arguments. It finds whichever Command Center execution arrived after the ack fix,
derives the action and the lead **from the execution** rather than from a constant, and asks the
four questions this finding leaves open:

| | asserted from |
|---|---|
| did it run the **fixed** graph? | the expression on the execution's own `workflowData` snapshot, plus a graph-wide re-scan for bare accessors |
| did it land on a branch the defect **broke**? | `Route Edit Shape`'s per-branch item counts; **branch 0 fails the run** |
| would it have **failed before**? | the pre-fix expression, replayed through `qa/n8n-expression.js` against this execution's own data |
| was the acknowledgement **sent, non-empty, and right**? | Telegram's returned `Message`, round-tripped back to HTML through its entities and compared to the `reply_text` the decision produced |

With no tap yet on the tenant it exits `2` and prints the tap instructions above rather than
reporting a pass on nothing. It refuses `--execution 5055` — a pre-fix execution cannot confirm a
fix — and it refuses to read a real execution payload as a rehearsal.

### It was rehearsed, both ways, before the tap was spent

The confirming tap costs the owner a real action on a real lead, and the verifier gets one chance
to be right when it lands. A verifier that has never executed its own assertions is not worth that.
`scripts/build-ack-tap-rehearsal.mjs` builds a synthetic execution from `5055` and the verifier runs
against it:

* **positive** — `5055` with the deployed expression and the Message it would then have returned:
  **56 assertions reachable, 0 failed.**
* **negative** — `5055` with *only* its timestamp moved, so the pre-fix expression and the real
  empty-text failure are kept verbatim: **7 failed**, and they are the seven that name this defect
  — the expression still addressing the Switch, the graph-wide scan finding it, the live expression
  rendering 0 characters, and `Bad Request: message text is empty`.

A rehearsal is never evidence and cannot become any: the file is stamped `_rehearsal: true` and
refused without it, the run writes no `.uat` record, and it always exits non-zero. The one piece
that is fabricated — the Message Telegram never sent — is fabricated as narrowly as possible, from
`5055`'s own `reply_text` through the same emulator the offline gate uses.

62/62 gates, 2228 assertions, unchanged by any of this.
