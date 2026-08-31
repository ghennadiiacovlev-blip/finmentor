# FINDING — a no-op keyboard refresh is reported to the owner as a failure

**Found:** 2026-08-31, by the Stage 2 confirming tap
**Execution:** `5062` — `FINMENTOR Lead Command Center SECURE CANDIDATE` (`qF9tonlHHIxc8MDd`), status `success`
**Severity:** presentation only. The write is correct, the acknowledgement is correct, and the
keyboard the owner is looking at is correct. What is wrong is that the owner is told it is not.
**Status:** CLOSED. Fixed, deployed 2026-08-31T15:55:38Z, and **proven live by execution `5068`**
(2026-08-31T16:09:32Z) — 55/55 assertions. See [Resolution](#resolution) and
[the confirming tap](#closed--the-confirming-tap-execution-5068).

---

## What the owner saw

He tapped **⏰ На 24 часа** on the fresh PRIORITY alert (message `147`). The lead was snoozed
correctly. He then received a confirmation that ended:

> **Не удалось обновить кнопки в сообщении.**

The keyboard on message `147` was never wrong. It is exactly the keyboard the post-write state
allows. Nothing failed that the owner needs to act on.

## What actually happened

`Edit Alert (4)` called `editMessageText` and Telegram answered:

```
Bad Request: message is not modified: specified new message content and reply markup
are exactly the same as a current content and reply markup of the message
```

That is Telegram's documented response to an edit that changes nothing. It is not an error in any
sense the owner cares about — it is Telegram saying "there was nothing to do".

## Why the edit was a no-op

Both halves of the edit were unchanged, for reasons that are each correct on their own:

* **the body.** The alert body is the PRIORITY render — company, why it needs attention, next step,
  deadline, lead id. Snooze changes none of those, and the body is not re-rendered from the new
  state.
* **the keyboard.** For `kind = priority` against the post-write row, `chooseActions()` returns
  `[done, snooze, discovery, nurture]` — the same four. `snooze` is deliberately **not**
  idempotent-by-state (`alreadyApplied()` returns `false` for it, because «отложить ещё на 24 часа»
  is a real instruction), so it is not hidden after being used; and `deal_stage` did not move, so
  `docs` stays hidden and nothing else changes.

So a snooze on an alert whose keyboard does not otherwise change **always** produces a no-op edit.
This is not specific to this lead.

Execution `5055` did not hit it because the `docs` action removed 📄 Документы from the keyboard,
which made the edit a real change.

## What this finding is NOT

It is not the acknowledgement defect. That one is closed, and this execution is what closed it —
on the harder of the two branches:

| | |
|---|---|
| `Telegram Update Reply` | ran, no error, **143 characters** delivered as message `148` |
| the discriminator | `$json.error` was TRUE, so the expression took the `reply_text_presentation_failed` path |
| the old expression | replayed against this execution's own data renders **empty** — branch 1 of the Switch was empty, exactly as branch 2 was in `5055` |

The pre-fix expression would have sent nothing here either. The corrected one sent the right copy
for the outcome that actually occurred. That is a stronger proof than a happy-path tap: it
exercised the failure branch of the very expression that was fixed.

## The write was correct

| column | pre-image | post-image |
|---|---|---|
| `sla_snooze_until` | *(empty)* | `2026-09-01T15:37:37.002Z` |
| `next_follow_up_at` | `2026-09-02T14:19:14.875Z` | `2026-09-01T15:37:37.002Z` |
| `deal_stage` | `Documents Requested` | `Documents Requested` |
| `sla_status` | `Active` | `Active` |
| `last_contacted_at` | *(empty)* | *(empty)* |

Tap time + 24 h exactly, recomputed independently from `buildUpdate()`. 68 unrelated columns
byte-identical. `Verify Mutation` `_verified=true`, `_mismatched=[]`.

`Save Status_Log` did not run, and correctly so: `Build Status Log` returned zero items because
Status_Log records stage transitions and snooze does not change `deal_stage`. `Save Activity` ran.

## The fix

`message is not modified` is a benign 400 and is now classified as a successful presentation
no-op. See [Resolution](#resolution).

## Reproduce

```
node scripts/verify-lead-alert-ack-tap-live.mjs --execution 5062
```

Read-only. 49 assertions pass; 1 fails, naming this defect.

---

<a id="resolution"></a>

## Resolution

**Deployed** 2026-08-31T15:55:38Z to `qF9tonlHHIxc8MDd` by
`scripts/deploy-lead-alert-edit-noop.mjs --confirm`.

### Three outcomes, and only two of them speak success

`LAA.classifyEdit()` in `n8n/src/lead-alerts/actions.js` returns exactly one of:

| outcome | when | acknowledgement |
|---|---|---|
| `EDIT_UPDATED` | no error on the item | the confirmation, unchanged |
| `EDIT_NOOP` | the message starts with `Bad Request: message is not modified` | the confirmation **plus** «Кнопки уже актуальны — обновление не потребовалось.» |
| `EDIT_FAILED` | **everything else, without exception** | the existing failure copy, unchanged |

The `EDIT_NOOP` copy begins with the proven business confirmation and adds one quiet line. It does
not claim Telegram changed the message, and it does not alarm. The authority for the action remains
the write, the read-back and `Verify Mutation` — never the edit.

### The exception is exact, and it fails closed

Matched with `indexOf(...) === 0`, never a substring search, so an error that merely *mentions* the
phrase is still a failure. There is no blanket 400 rule. Still `EDIT_FAILED`: «message to edit not
found», «can't parse entities», «chat not found», «Unauthorized», «Forbidden: bot was blocked by the
user», any other 400, and an error object the extractor cannot read.

n8n surfaces a failed node's error as a **string** on some versions and as an **object** on others —
execution `5062` carried a string, the offline fixtures carried `{message}`. Both classify
identically, through one extraction chain that the acknowledgement expression implements exactly.

Not required, and deliberately not added: re-deriving that the keyboards matched. Telegram returns
this error *only* when the new content and reply markup are identical to what is displayed — that
answer is the proof, from the side that holds the truth. `sameKeyboard()` would re-derive it from
data the callback does not carry, and stays unused.

### The production diff

Two parameters, one workflow, no graph change:

* `Find & Build Update.parameters.jsCode` — rebuilt from the module, emitting a third copy
* `Telegram Update Reply.parameters.text` — a three-way selection implementing `classifyEdit()`

33 nodes before and after; connections byte-identical; all 7 Google Sheets nodes byte-identical;
18 credential-bearing nodes, none rebound; all 31 unrelated nodes byte-identical; name and active
state unchanged. Verified by fresh GET after the PUT, not from the deploy's own report.

`Verify Mutation` was deliberately **not** rebuilt: it inlines the same module, uses none of the new
functions, and already carries the third copy through its `Object.assign`.

### The gate, and that it fails on the graph that broke

`qa/lead-alerts-edit-noop.test.mjs` — 17 assertions. Every scenario is run through **both** halves
that must agree: the pure `classifyEdit()` and the candidate's **actual** parameter expression.
Testing only the function would prove nothing about the graph — the blind spot execution `5055`
cost a live tap to find.

A `EDIT_NOOP` (5062's exact string) · A2 (the same error as an object) · A3 (short form) ·
B `EDIT_UPDATED` · C message-not-found · D malformed markup · E arbitrary 400 · F1 401 · F2 403 ·
W1 an error that merely mentions the phrase · W2 an unreadable error object — the last eight all
`EDIT_FAILED`. Plus G: an unverified write cannot reach the acknowledgement, asserted structurally
(`IF Verified` routes it to `Telegram Write Failed Reply`) and behaviourally (a lost write is never
verified). Plus the ordering, and a graph-wide re-scan for bare accessors.

And it **fails on the pre-fix candidate** — the graph `5062` actually ran, kept as a fixture.

63/63 gates, 2245 assertions.

## CLOSED — the confirming tap, execution `5068`

The one thing the fix's own gate could not reach was whether **n8n executes** the new
classification. Bytes and evaluation, not execution — the same limit that let `5055` and `5062`
through. The owner tapped **⏰ На 24 часа** on alert `149` at **2026-08-31T16:09:32Z**, and that
tap reproduced the no-op exactly as intended: snooze changes no button, `deal_stage` did not move,
so `editMessageText` sent content and markup identical to what was displayed.

`node scripts/verify-lead-alert-ack-tap-live.mjs` — **55 passed, 0 failed**, read-only:

* the execution ran the **three-way** expression, read out of the execution's own snapshot
* it landed on **branch 1 (KB22)** — a branch the defect broke, not the branch that always worked
* Telegram answered `Bad Request: message is not modified: …`, and `classifyEdit()` returned
  `EDIT_NOOP` **by prefix** (`indexOf === 0`), not by substring
* the acknowledgement Telegram delivered — message `150`, 155 characters — is
  `reply_text_presentation_noop`, entity for entity: «Кнопки уже актуальны — обновление не
  потребовалось.» The owner was **not** told of a failure
* the write is intact and proven: `sla_snooze_until` and `next_follow_up_at` both
  `2026-09-01T16:09:36.436Z`, 68 unrelated columns byte-identical, `Verify Mutation` agreeing with
  a recomputation, and the confirmation ordered strictly after all of it
* the **old** expression, replayed against this tap's own live data, renders **empty** — this tap
  would have sent a 400 before the fix

### What the no-op path proves about the keyboard

Telegram returns this error *only* when the content and markup sent are identical to what is
displayed, so there is no returned `Message` to read — the six assertions that read one cannot
run. They are replaced by a two-link chain that needs no data the graph does not hold:

1. the keyboard the node **attempted** (the branch item's `kb`) is exactly what the post-write
   state allows, recomputed from the module — `✅ Обработано | ⏰ На 24 часа` / `📞 Discovery | 🗂 В Nurture`
2. Telegram says what is displayed is identical to what was attempted

Therefore what is displayed is exactly what the post-write state allows. The attempted HTML also
came back byte-identical to the origin message round-tripped through its own entities — so
`htmlFromTelegram()` agrees with Telegram's own verdict, judged by Telegram.

### The verifier was updated, and it still fails on the graph that broke

`scripts/verify-lead-alert-ack-tap-live.mjs` was written for the **ack** fix and carried its
two-way rule: any edit error meant the presentation-failure copy. Against `5068` it therefore
reported four failures for a graph behaving **correctly**. It now classifies through
`A.classifyEdit()` / `A.editCopyKey()` — the same module the graph's expression implements — so it
cannot be satisfied by a graph that classifies differently, and `EDIT_FAILED` remains a failure
without exception.

Its baseline was also pinned to execution `5055`, which reported `5062`'s own legitimate writes as
unexplained drift; it now chains to the newest prior record for the same lead (`5062`).

The negative control: run against **`5062`**, the pre-fix execution, the same verifier reports
**53 passed, 2 failed** and withholds the closure — the graph that ran carries no
`reply_text_presentation_noop` and cannot speak this outcome.

Record: `.uat/lead-alert-ack-tap-5068.json`.

Rollback: `PUT /api/v1/workflows/qF9tonlHHIxc8MDd` with `.uat/qF9tonlHHIxc8MDd.pre-edit-noop.json`.
