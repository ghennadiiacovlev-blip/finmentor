# FINDING — a no-op keyboard refresh is reported to the owner as a failure

**Found:** 2026-08-31, by the Stage 2 confirming tap
**Execution:** `5062` — `FINMENTOR Lead Command Center SECURE CANDIDATE` (`qF9tonlHHIxc8MDd`), status `success`
**Severity:** presentation only. The write is correct, the acknowledgement is correct, and the
keyboard the owner is looking at is correct. What is wrong is that the owner is told it is not.
**Status:** OPEN. Not fixed, not deployed. Nothing was changed in response to it.

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

## The shape of a fix — NOT APPLIED

`message is not modified` is a benign 400 and should be treated as success, not as a presentation
failure. The narrow change is in the discriminator, not in the graph: the acknowledgement should
choose `reply_text_presentation_failed` only for edits that genuinely failed, and treat a no-op as
a success.

That is a change to a deployed Code node's decision, so it needs its own candidate, its own gate
that fails on the current graph, and its own controlled deploy. **None of that has been done.**

## Reproduce

```
node scripts/verify-lead-alert-ack-tap-live.mjs --execution 5062
```

Read-only. 49 assertions pass; 1 fails, naming this defect.
