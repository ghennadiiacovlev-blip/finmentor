# C3.2 — live defect: the bot cannot see that the Mini App submitted the cycle, so the rotation is unreachable

**Date:** 2026-09-03 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Found by:** owner, in the real client bot
**Status:** root cause proven from the live graph and executions; correction built, gated (15/15 executed), dry-run
clean against live; **NOT deployed** — awaiting the owner's `--confirm`.

## What the owner saw

1. New conversation → «Расскажите о ситуации своими словами.»
2. Sent a new problem → «Контекст сохранён» + «Открыть бриф».
3. Tapped «Открыть бриф» → the Mini App reopened the OLD submitted session: «Принято», «Передано консультанту».

No second `MiniApp_Cycle_Projection` row, no higher `cycle_sequence`, no new app session.

## Root cause (fresh-read of the live Concierge `mppzthlkSJFr6Kle`, 58 nodes, 17:38:03 UTC)

The seven questions, answered from the live code and executions 5313 / 5315:

| # | question | live answer |
|---|---|---|
| 1 | which customer action invokes the explicit rotation | `p\|new_y` — «Начать новый вопрос» pressed **on the confirmation screen** `TG_NEW_REQUEST_CONFIRM`. It is the ONLY rotate in `decide()` and the only premium rotate the cycle gate (`isPremiumRotate`) honours. Reached from `TG_SUBMITTED` → «Начать новый вопрос» (`p\|new`) → confirmation → «Начать новый вопрос» (`p\|new_y`, mapped per-state). |
| 2 | does «Начать новый вопрос» exist in the live UI | the copy and the callback wiring exist (`TG_SUBMITTED`, `TG_APPEND_MESSAGE.done`, `TG_NEW_REQUEST_CONFIRM`), but the screen that carries it is rendered **only when `isCommitted(auth)`** — `lead_id !== '' && lead_cycle_id === cycle_id` on the **Bot_Sessions** row. |
| 3 | is the button only on an old message | no button was ever rendered: the owner's bot session has never been on `TG_SUBMITTED`. Bot_Sessions for the owner (as emitted by `Cycle Projection Guard` in 5315): `lead_id ''`, `lead_cycle_id ''`, `state TG_CONFIRM_CONTEXT`, `cycle_id C-551662084-1787947744615`. |
| 4 | does the free-text path update context inside the SAME cycle | yes, by design. `decide()` on an uncommitted cycle: text on `TG_FREEFORM_PROBLEM` → `TG_CONFIRM_CONTEXT` (or `TG_OPEN_BRIEF` when no structure) — `writes: ['free_text']`, never a rotation. `Prepare Cycle Projection` re-projected the same `authority_key` in place (`cycle_reset ''`). Correct: a message must not rotate. |
| 5 | is «Открыть бриф» resolving the authoritative cycle | yes, and correctly. The Gateway's `Build App Session` picks the highest `cycle_sequence` (only row: 1787947744615); `Resolve Session` finds the `submitted` app session `AS-09f4c25b…` for that cycle and returns it. The **Gateway is right**; the authority is still the old submitted cycle because nothing rotated it. |
| 6 | callback routing for the reset | `p\|new` → confirmation, `p\|new_y` → rotate, both inside `if (committed)`. On an uncommitted snapshot `p\|new_y` falls through to `TG_ENTRY` without rotating, and the cycle gate's `isPremiumRotate` also requires `premiumCommitted`. Routing is intact; the **precondition is never true**. |
| 7 | do callback data and routing still match after C3.1 | yes. 5313 (`p\|describe`) and 5315 (text) ran `Prepare Cycle Projection → Project Cycle → Cycle Projection Guard → Save Bot Session`, `projection_invalid 0`, no error executions. |

**The gap.** The Mini App submit commits the cycle in `MiniApp_App_Sessions` (row 2: `state submitted`,
`lead_id FIN-1788113619104-582`, `cycle_id C-551662084-1787947744615`). Nothing writes that commit back
to Bot_Sessions:

- the Submit endpoint owns no Sheets authority (by design, `docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md`);
- Lead Intake writes Pipeline / CRM / Answers / Activities / Dashboard, never Bot_Sessions;
- the Phase 2 contract row `APP_SUBMITTING` says «consent stamp → BS; … `lead_id` → BS» — it was never implemented.

So the Concierge's authority snapshot says "not committed" for a cycle the Gateway (correctly) treats as
committed. The bot keeps offering qualification for a cycle that can no longer accept a brief; the only
exit — the explicit new-request action — is on a screen that never renders.

## The correction (C3.2): the Concierge adopts the commit from the read model it already writes

`scripts/deploy-c3-concierge-commit.mjs` adds TWO nodes on the premium branch only:

```
Premium Owner Gate → Read Cycle Commit → Adopt Cycle Commit → Get Bot Session (Premium)
```

- **Read Cycle Commit** — Data Table `get` of `MiniApp_App_Sessions` by the session row's Telegram user
  (no credential; `alwaysOutputData` + `continueRegularOutput`, the Gateway's own posture).
- **Adopt Cycle Commit** — re-emits the Bot_Sessions row; ONLY if a `submitted` app session with a
  `lead_id` exists for this user AND the row's CURRENT `cycle_id`, sets `lead_id`, `lead_cycle_id`
  (and `lead_sent_at` when empty). Outage, absent row, draft, other cycle, a row already carrying a
  lead for this cycle: the row passes through unchanged.

Everything downstream is the already-proven C3.1 machinery: the cycle gate sees `premiumCommitted`
and rotates on `p|new_y` (new cycle, new `submission_key` preallocated and read back, old lead archived
to `previous_lead_id`); `decide()` sees `isCommitted` and renders `TG_SUBMITTED` — the terminal rule
now actually holds for a submitted brief; `Build Session Row` persists the adopted lead into
Bot_Sessions, which is the contract's «`lead_id` → BS» done lazily by the one workflow that owns the sheet.

Kept: owner-only release gate (endpoints untouched), G5, server-side cycle authority (the Gateway is
not changed and still resolves the highest sequence), no new Sheets authority (Sheets node count is
asserted unchanged), the submitted app session is never written, CUSTOMER stays blocked.

Not a silent rotation: a new free text on a submitted cycle now lands on `TG_SUBMITTED` («Добавить к
обращению» | «Начать новый вопрос»), never on qualification, and only the confirmed action rotates.

## Proof so far (offline)

`qa/c3-cycle-commit-adoption.test.mjs` — 15/15, executed against the tracked live gate fixture + the
C3.1 splice and the state-machine module: the live defect row is adopted; nothing is adopted from
another user / cycle / a draft / a lead-less row / the legacy row / an outage; `p|new_y` on the adopted
row ROTATES with a higher sequence and the un-adopted control does NOT (the defect, reproduced); a
free text on the adopted row lands on `TG_SUBMITTED`; after the rotation the next turn adopts nothing
and a duplicate tap cannot rotate again; the splice touches exactly two nodes and one edge.

Dry-run against live: rollback `.uat/mppzthlkSJFr6Kle.pre-c3-commit.json` (58 nodes), candidate
`.uat/mppzthlkSJFr6Kle.c3-commit-candidate.json` (60 nodes).

## Live proof procedure (after `--confirm`)

Owner action — ONE sequence in the client bot: send `/start`; the bot must answer «Последнее обращение
уже передано FINMENTOR.» with «Добавить к обращению» | «Начать новый вопрос». Tap «Начать новый вопрос»,
then on «Начать новый вопрос?» tap «Начать новый вопрос» again. Then tap «Открыть бриф» after «Подготовить бриф».

Then fresh-read, all seven must PASS:

1. `MiniApp_Cycle_Projection` has a second row, `authority_key = 551662084|C-551662084-<new ms>`, `cycle_reset restart`
2. `cycle_sequence` of row 2 > `1787947744615`
3. row 1 unchanged (`cycle_id`, `cycle_sequence`, `authority_key` as before)
4. `MiniApp_App_Sessions` gains a row with `cycle_id` = the new cycle, `state draft`
5. the Mini App shows the blank questionnaire (session `resumed false`, `draft null`)
6. the old submitted session `AS-09f4c25b…` keeps `cycle_id C-551662084-1787947744615` and is not returned
7. no Gateway / Error Monitor / SYSTEM ALERT executions with errors in the window

Rollback: `PUT /api/v1/workflows/mppzthlkSJFr6Kle` with `.uat/mppzthlkSJFr6Kle.pre-c3-commit.json`.
