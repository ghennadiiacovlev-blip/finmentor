# Telegram premium button colours — presentation-only checkpoint (2026-09-04)

**Status:** PREPARED, NOT DEPLOYED. Awaiting owner approval. CUSTOMER remains OWNER_ONLY.

## 1. Transport finding (fresh-read, not assumed)

| question | answer | evidence |
|---|---|---|
| Does the Bot API have `InlineKeyboardButton.style`? | **Yes.** «Optional. Style of the button. Must be one of "danger" (red), "success" (green) or "primary" (blue). If omitted, then an app-specific style is used.» | Bot API type reference |
| Does the n8n Telegram node expose it in its UI? | **No** — open community feature request; people fall back to raw `reply_markup` via HTTP Request nodes | n8n community thread |
| Does the node *strip* the field? | **No.** It builds each button as `{ text }` and then `Object.assign(sendButtonData, button.additionalFields)` — arbitrary keys are copied verbatim | `packages/nodes-base/nodes/Telegram/GenericFunctions.ts`, `addReplyMarkup` |

So the field reaches Telegram through the **existing** node by putting `style` in a button's
`additionalFields`. No HTTP Request migration, no credential change, no new node type.

**The trap this creates.** An empty `style` is not a valid value; Telegram answers 400 and the
alert is lost. "Default" must therefore be the *absence* of the key, never `""`. Every emitter here
omits the key for neutral buttons, and the gate proves it.

## 2. Policy (owner decision)

| action | label | style | why |
|---|---|---|---|
| done | ✅ Обработано | **success** | the affirmative close — SLA handling is finished |
| discovery | 📞 Discovery | **primary** | the principal forward move the alert exists to prompt |
| snooze | ⏰ На 24 часа | default | postponing is not an achievement |
| docs | 📄 Документы | default | a request for material |
| nurture | 🗂 В наблюдение | default | parking the lead |
| X-Ray review | ✅ Проверить анализ | **success** | the affirmative review action (URL button) |
| X-Ray CRM | 📊 Карточка лида | **primary** | the forward navigation (URL button) |

No `danger` anywhere: no owner-alert action deletes anything or is irreversible. Colour never
encodes HOT/WARM/COLD or the financial zone — those stay words in the message body. At most two
emphasised buttons per keyboard, one per purpose.

## 3. What changed

| file | change |
|---|---|
| `n8n/src/lead-alerts/actions.js` | `STYLE` policy map + `STYLE_VALUES`; `keyboard()` attaches `style` **only** when the policy sets one; both exported |
| `scripts/build-xray-analysis-workflow.mjs` | `style: 'success'` / `'primary'` on the two owner-alert URL buttons |
| `scripts/deploy-lead-alert-keyboards.mjs` | `btn()` carries an optional style; the literal NEW LEAD keyboard passes the module's style through |
| `scripts/apply-lead-alert-button-styles.mjs` (new) | applies the policy to the tracked NEW LEAD keyboard candidate and verifies the delta is styles only |
| `qa/telegram-button-styles.test.mjs` (new, 16 checks) | the whole contract (below) |
| candidates | `xray-analysis-workflow.sdk.js`, `QmIyEW2ZEqKregmN.alert-keyboards-candidate.json` |

Unchanged: callback_data, labels, order, rows, routing, triggers, CRM writes, scoring, lifecycle,
CLIENT_READY, credentials, chat routing, message copy.

## 4. Deferred, deliberately: the slotted SLA / Follow-up keyboards

SLA and Follow-up do not hold literal buttons — each slot is an expression
(`={{ $json.kb[0][0].text }}`). Adding `style: '={{ $json.kb[0][0].style }}'` would resolve to an
**empty string** for every neutral button unless n8n drops undefined parameters, and an empty style
is a 400 that would lose the alert. That behaviour cannot be established without sending a real
message, so those two keyboards are **not** styled in this checkpoint. PRIORITY and FOLLOW-UP
therefore keep today's neutral buttons in production until a live smoke test settles it.

## 5. Finding: `deploy-lead-alert-keyboards.mjs` is no longer safe to re-run

Verified 2026-09-04 by running its `--dry-run`: the script ADDS the Stage-1 keyboard nodes, which
are already live, so it emitted candidates carrying three duplicated nodes (SLA 13 → 16,
Follow-up 18 → 21). Nothing was deployed and the two candidate files were restored. The literal
NEW LEAD styles are applied instead by `scripts/apply-lead-alert-button-styles.mjs`, which touches
only `style` keys on one node. Do not re-run the keyboards deploy script against the current live
state without first making it idempotent.

## 6. QA

`qa/telegram-button-styles.test.mjs` — 16 checks: only `primary`/`success`/`danger` are ever
emitted and never an empty one; callback_data byte-identical for all five verbs and in every
keyboard position; row count, row composition and shape unchanged; button order unchanged;
labels unchanged; neutral buttons carry no `style` key; no `danger` exists; one emphasis per
purpose and at most two per keyboard; styling does not vary with priority or zone; no custom
colours; the edit-message comparison (`sameKeyboard`) and the no-op classification still behave;
the owner keyboard never varies with client locale; the X-Ray URL buttons carry the right styles
and the approved notice still has no keyboard; the NEW LEAD candidate carries the styles with no
duplicated nodes; the touched gates' floors were not lowered.

Existing gates re-run green: lead-alerts-actions 57, edit-noop 17, candidates 18, ack-expression 23,
presentation 36, labels-refresh 10, xray-analysis 143.

**Canonical: 78/78 gates, 2705 assertions, floors PASS.**

## 7. Live smoke test and owner visual verdict (2026-09-04T11:25Z)

Sent by `scripts/smoke-telegram-button-styles.mjs --confirm`: a disposable workflow built one
message from the style matrix the production module exports, sent it to the owner chat read from
the Settings sheet, and deleted itself. The instance returned to 111 workflows with no leftovers.
Every button was a URL button — no `callback_data` anywhere — so a tap could only open
finmentor.md and could never reach the Command Center or mutate a lead. No production workflow was
touched: all five stayed active with unchanged node counts, every live button style still omitted,
and last-modified stamps predating the test.

The keyboard Telegram accepted:

| button | style sent |
| --- | --- |
| ✅ Обработано | `success` |
| ⏰ На 24 часа | omitted |
| 📞 Discovery | `primary` |
| 📄 Документы | omitted |
| 🗂 В наблюдение | omitted |

**Owner verdict, viewed in the current desktop Telegram client:**

    TELEGRAM STYLE TRANSPORT     = PASS
    CURRENT CLIENT VISUAL STYLE  = FAIL / NOT DISTINCT
    FULL STYLE DEPLOY            = HOLD
    CUSTOMER RELEASE             = NOT AUTHORIZED

Observed: the `success` button was visible; the `primary` Discovery button was **not** visually
blue or distinct; the omitted-style buttons looked too similar to the styled ones.

### What this does and does not establish

It establishes the transport half only. Bot API accepted `style` on an inline button, n8n's
Telegram node passed the key through `additionalFields` untouched, and the send returned no 400 —
so the field is wire-legal and the approved matrix emits it correctly.

It does **not** establish the presentation half. Inline-button `style` is rendered client-side, so
whether an emphasis is visible at all depends on the reader's Telegram client and version, not on
anything this repo controls. One client showing no differentiation is enough to hold the deploy:
an owner console whose emphasis silently disappears on the device the owner actually uses is worse
than today's uniform buttons, because the operator would be trained to look for a cue that is not
reliably there.

### Hold

The full style refresh is **not** deployed and the approved matrix is **unchanged** — the failure is
in client rendering, not in the policy, so changing the matrix would be fixing the wrong thing.
Production keeps today's neutral buttons. The slotted SLA and Follow-up keyboards stay deferred for
the separate reason in §4, which this test did not address.

### Next proof required

The same already-sent message, opened in the current iPhone Telegram client. No new message is
needed — the smoke message is still in the owner chat and its buttons remain inert. If iPhone
renders `primary` and `success` distinctly, the question becomes which clients the owner console
must look correct on; if it does not, the emphasis should be carried by something client-independent
(label text or an emoji marker) rather than by `style`.

## 8. Owner approval on iPhone, and the controlled production rollout (2026-09-04T11:46Z)

The same smoke message opened in the current **iPhone** Telegram client rendered the hierarchy the
policy intends: «✅ Обработано» emphasised as the success action, «📞 Discovery» emphasised as the
primary action, and the other three neutral. Exact hues are the client's and the theme's; the goal
was semantic hierarchy, and that is what was approved. **TELEGRAM PREMIUM BUTTON COLORS = OWNER
APPROVED.** The desktop client's failure to differentiate (§7) stands as a recorded client-side
limitation, not a defect in the matrix.

### 8.1 The slot problem, decided by enumeration rather than by inspection

Two live keyboards hold literal buttons; three fill fixed slots from `$json.kb[row][col]`. A slot
can only carry a literal style if the ACTION that lands in it is the same for every reachable lead
state — `chooseActions` hides Discovery at Discovery Scheduled and Документы at Documents
Requested, so a four-button keyboard's second row starts with whichever survived. Guessing there
would emphasise the wrong verb; using `style: ""` to dodge the guess is a 400 that would lose the
alert outright.

`n8n/src/lead-alerts/style-slots.js` decides it mechanically: it enumerates 207 reachable states,
builds every keyboard each renderer can produce, groups them the way the live Switch does (by
shape), and reports the action set per slot. `qa/telegram-button-style-slots.test.mjs` (33 checks)
freezes that verdict, so a future edit that widens an action set or adds a kind to a renderer fails
offline instead of on a live keyboard.

| node | shape | serves | styled | left neutral |
| --- | --- | --- | --- | --- |
| Telegram Lead Alert | literal | NEW LEAD | Discovery = primary | — |
| Telegram Owner Alert | literal | X-RAY REVIEW | Проверить = success, Карточка = primary | — |
| Telegram SLA Alert | KB221 | priority | [0][0] success, [1][0] primary | — |
| Telegram SLA Alert (4) | KB22 | priority | [0][0] success | [1][0] = discovery **or** docs |
| Telegram Followup Reminder | KB221 | followup | [0][0] success, [1][0] primary | — |
| Telegram Followup Reminder (4) | KB22 | followup | [0][0] success | [1][0] = discovery **or** docs |
| Edit Alert (5) | KB221 | priority + new_lead | [0][0] success, [1][0] primary | — |
| Edit Alert (4) | KB22 | priority + new_lead | none | [0][0] = discovery **or** done |
| Edit Alert (3) | KB21 | priority + new_lead | none | [0][0] = discovery **or** docs |

The Command Center's shorter edit shapes are ambiguous because it re-renders whatever the tapped
message was and derives the kind from the message itself (`LAA.originKind`), so one slot can hold
either the primary or the success verb. Those stay neutral. The practical effect is that emphasis
is present on the alert the owner acts FROM, and may be absent on the re-rendered alert AFTER the
action — a visible, safe shortfall rather than a wrong cue. No-op detection is unaffected:
`sameKeyboard` compares text and callback_data only, and is in any case unused, because the
classifier reads Telegram's own "message is not modified" answer.

### 8.2 Deployed

`scripts/deploy-telegram-button-styles.mjs --confirm`, one PUT per workflow in a fixed order with
every node a workflow owns in the same write, so no later write can overwrite an earlier style.
Eleven `style` keys across five workflows. Each was fresh-read back and re-verified.

Proven live afterwards by an independent read against the pre-deploy captures: everything except
`style` keys is **byte-identical**, every label, callback_data, url, row and position unchanged,
all five workflows still active, and triggers, credentials, chat routing, every Code node and every
Sheets operation untouched. `X-RAY APPROVED` still carries no keyboard. Rollback captures in
`.uat/<id>.pre-button-styles.json` hold zero style keys, confirming they are genuine pre-deploy
state, and were preserved rather than overwritten on the confirm run.

    TELEGRAM PREMIUM BUTTON COLORS LIVE = PASS
    NEW LEAD          = PASS      PRIORITY        = PASS
    SLA / FOLLOW-UP   = PASS      X-RAY REVIEW    = PASS
    CALLBACK_DATA / ORDER / ROUTING / TRIGGERS / CRM WRITES / SCORING / CLIENT_READY = UNCHANGED
    TARGETED QA 435   CANONICAL 79/79, 2738, floors PASS   ROLLBACKS PRESERVED
    CUSTOMER RELEASE  = NOT AUTHORIZED
