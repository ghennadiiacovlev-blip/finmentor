# Premium Conversation UX — CURRENT STATE of the RU Telegram Concierge

**Discovery only. Nothing was implemented, modified, translated or proposed.**

Source of truth: the deployed `FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED`
(`mppzthlkSJFr6Kle`, 51 nodes), tracked export verified structurally identical to live. The entire
conversation lives in one node, `Build Bot Response` (996 lines); the post-submission copy lives in
`Build Intake Transport Request` and `Build Recovery Request`.

---

## A. Current RU conversation tree

### A.1 Entry

`/start` (or `/menu`, or any greeting text, or an unrecognised empty update) → **`MENU`**.

`/start` additionally **resets the application cycle** (see §F).

Buttons on the entry screen:

    🚀 Короткая диагностика          m|diag           → question ladder, step 1
    📅 Запросить встречу             m|meeting_contact → jumps straight to contact capture
    ✍️ Описать запрос своими словами  m|free_text      → free-text capture
    💼 Услуги FINMENTOR              m|services       → services screen
    🌐 Открыть сайт (url)  |  ❌ Завершить  n|end      → ENDED

### A.2 The branch tree

```
/start ─→ MENU
   │
   ├─ m|diag ──→ SERVICE_SELECTED        «Что сейчас важнее всего…»   7 options
   │      └─ s|* ─→ BUSINESS_MODEL_SELECTED  «Какой тип бизнеса…»      7 options
   │          └─ b|* ─→ TURNOVER_SELECTED    «Ориентировочный оборот…» 6 options (incl. «Не хочу указывать»)
   │              └─ t|* ─→ MAIN_PAIN_SELECTED «…самое заметное финансовое напряжение?» 6 options
   │                  └─ p|* ─→ URGENCY_SELECTED «Насколько срочно…»   4 options + ➡️ Перейти к контакту
   │                      └─ u|* ─→ HAS_CFO_SELECTED «Есть ли … финансовый директор…» 4 options + ➡️ Перейти к контакту
   │                          └─ c|* ─→ DOCUMENTS_SELECTED «Какие данные уже есть…» 6 options
   │                              └─ d|* ─→ CONTACT_NAME_REQUESTED
   │
   ├─ m|meeting_contact ─→ nextContactStep()  ─┐  skips any step already filled
   ├─ m|to_contact      ─→ nextContactStep()  ─┤
   ├─ /contact          ─→ nextContactStep()  ─┘
   │
   ├─ m|free_text ─→ SERVICE_SELECTED (awaiting free text)
   │      └─ free text ─→ CONTACT_NAME_REQUESTED   ⚠ always re-asks the name (see E-1)
   │
   ├─ m|services ─→ MENU (services screen)
   └─ n|end      ─→ ENDED

CONTACT_NAME_REQUESTED  (free text only)          ─→ COMPANY_REQUESTED
COMPANY_REQUESTED       (free text | «Продолжить без компании») ─→ CONTACT_REQUESTED
CONTACT_REQUESTED       (free text | «Ответить здесь в Telegram» | «Пока без контакта»)
        ├─ contact parsed / telegram used ─→ CONSENT_REQUESTED
        ├─ unparseable                    ─→ CONTACT_REQUESTED  (retry, loops)
        └─ «Пока без контакта»            ─→ CONTACT_REQUESTED  (terminal-ish, status=no_contact)
CONSENT_REQUESTED
        ├─ consent|yes + minimum data ─→ LEAD_SENT  → Lead Intake
        ├─ consent|yes − minimum data ─→ missingMinimumScreen()  ⚠ loop (see E-1)
        ├─ consent|no                 ─→ CONSENT_DECLINED
        └─ other text                 ─→ CONSENT_REQUESTED (re-ask)
```

**Free-text intent classifier** (any unrecognised message) routes to: menu (greeting), price screen,
services screen, skip-questionnaire screen, meeting → contact, "no contact" screen, or a generic
"понял запрос" screen. Two screens — **price** and **skip-questionnaire** — are reachable **only by
typing**, never by any button.

### A.3 Loops and re-entry

| Situation | Behaviour |
|---|---|
| Contact unparseable | Re-asks `CONTACT_REQUESTED` with a hint. **Unbounded loop.** |
| Consent answered with free text | Re-asks `CONSENT_REQUESTED`. **Unbounded loop.** |
| `consent|yes` without minimum data | `missingMinimumScreen()` → re-asks name/contact/free-text. **Loop, and it re-asks answered questions.** |
| `🏠 Главное меню` | Available on nearly every screen; returns to `MENU` **without** resetting the cycle. Any partially-answered ladder is abandoned but its data is kept. |
| `m|diag` on an *unfinished* cycle | Means "continue" — no reset. |
| `m|diag` on a *finished* cycle (consent decided, or lead sent, or ended) | Means "Начать заново" — **new cycle**, qualification wiped. |
| `/start` after a completed lead | **New cycle.** `lead_id` archived to `previous_lead_id`; consent and all qualification answers cleared; state → `MENU`. **Identity and contact fields are deliberately kept**, so the next run skips name/company/contact and goes straight to consent. |
| Repeat `consent|yes` in the **same** cycle with a lead already sent | `IF Lead Already Sent` → re-sends the **confirmation message only**. **No second Lead Intake call, no second lead.** |

---

## B. Current user-visible copy (exact RU, as deployed)

**MENU**
> Здравствуйте. Я FINMENTOR Concierge.
>
> Помогу собственнику или руководителю спокойно выбрать первый шаг по финансам — без лишних вопросов и давления.
>
> Можно пройти короткую диагностику, запросить встречу или описать задачу своими словами. Как удобнее вам?

**Question ladder** (each shown with its own inline keyboard)

| State | Exact RU question |
|---|---|
| `SERVICE_SELECTED` | Что сейчас важнее всего для вашего бизнеса? |
| `BUSINESS_MODEL_SELECTED` | Какой тип бизнеса ближе всего? |
| `TURNOVER_SELECTED` | Ориентировочный оборот компании? Можно не указывать, если сейчас не хотите раскрывать. |
| `MAIN_PAIN_SELECTED` | Что сейчас создаёт самое заметное финансовое напряжение? |
| `URGENCY_SELECTED` | Насколько срочно нужно разобраться? |
| `HAS_CFO_SELECTED` | Есть ли в компании финансовый директор или сильный финансовый блок? |
| `DOCUMENTS_SELECTED` | Какие данные уже есть для первичного разбора? |

**CONTACT_NAME_REQUESTED**
> Чтобы эксперт FINMENTOR понимал контекст запроса, представьтесь, пожалуйста.
>
> Напишите имя и вашу роль в компании.
>
> Например:
> Геннадий, собственник
> или
> Анна, финансовый директор

**COMPANY_REQUESTED**
> Спасибо. Укажите, пожалуйста, компанию или кратко опишите сферу бизнеса.
>
> Например: торговая компания, производство, HoReCa, строительство, услуги, e-commerce.

*(button: «Продолжить без компании» → stores `Не указано / confidential`)*

**CONTACT_REQUESTED**
> Куда удобнее вернуться с первым предложением по вашему запросу?
>
> Можно написать телефон, email или @username.
> Если удобнее, мы можем ответить прямо здесь, в Telegram.

*(buttons: «Ответить здесь в Telegram» · «Пока без контакта»)*

**CONSENT_REQUESTED**
> Перед тем как передать запрос эксперту FINMENTOR, подтвердите, пожалуйста, что мы можем
> использовать переданные данные, чтобы связаться с вами и подготовить предварительную
> рекомендацию.

*(buttons: «✅ Да, передать эксперту» · «❌ Пока не передавать»)*

**Interstitial before submit** — `LEAD_SENT`, no keyboard:
> Готовлю запрос для эксперта FINMENTOR.

**After a SUCCESSFUL submission** (`ok === true` from Lead Intake)
> Спасибо. Я передал ваш запрос эксперту FINMENTOR.
>
> Мы посмотрим контекст и вернёмся с подходящим первым шагом: Financial X-Ray, встреча или список данных для первичного анализа.
>
> Ничего дополнительно делать сейчас не нужно.

*(buttons: 📊 Что подготовить к разбору · 💼 Услуги FINMENTOR · 🌐 Открыть сайт · 🏠 Главное меню)*

**After an INFRASTRUCTURE FAILURE** (`ok !== true`) — user is **not** told anything failed:
> Спасибо. Я зафиксировал ваш запрос.
>
> Мы проверим детали и вернёмся к вам в этом чате или по указанному контакту.

*(buttons: 🏠 Главное меню · 🌐 Открыть сайт)*

**Render failure (unmapped keyboard layout)**
> Не удалось корректно отобразить этот шаг. Вернитесь в главное меню и попробуйте ещё раз.

**Other terminal screens**

| Screen | Copy (opening line) |
|---|---|
| `CONSENT_DECLINED` | Понимаю. Мы не будем передавать запрос эксперту без вашего согласия. |
| contact skipped | Хорошо, без контакта. Я не буду передавать запрос эксперту без понятного канала связи. |
| `ENDED` | Спасибо за интерес к FINMENTOR. |
| bot disabled | Сейчас Telegram Concierge временно недоступен. |

---

## C. Current data collected

| Question | Session field | Mandatory? | Free text accepted? |
|---|---|---|---|
| service | `selected_service` | no — skippable via meeting/free-text entry | no (buttons only) |
| business model | `business_model` | no | no |
| turnover | `turnover_range` | **no** — explicit «Не хочу указывать» | yes (negation detected) |
| main pain | `main_pain` | no | no |
| urgency | `urgency` | no | no |
| has CFO | `has_cfo` | no | no |
| documents | `documents_status` | no | no |
| name + role | `contact_name` | **effectively yes** | **yes only** |
| company | `company` | no — skip button | yes |
| contact | `contact_phone` / `contact_email` | **yes to submit** | yes + buttons |
| consent | `consent` | **yes to submit** | yes + buttons |
| free-form request | `free_text_request` | no | yes |

**Minimum to submit** (`hasMinimumLeadData()`): a name, *some* contact, *some* need
(`selected_service` OR `free_text_request` OR `main_pain`), and `consent === 'yes'`.
**Nothing in the diagnostic ladder is individually required.**

**Outbound payload to Lead Intake:** `lead_id`, `tool: telegram_client_concierge`, `created_at`,
`client{name, company, email, phone_or_messenger, telegram, language}`,
`answers{selected_service, main_pain, revenue_range, business_model, has_cfo, documents_status}`,
`diagnostic{score:"", traffic_light:"", urgency, main_pain, business_model}`,
`meta{consent:true, page_url, utm_*, ai_guarded}`, `intake{commercial_intent, business_pain, documents_available}`.
Note `diagnostic.score` and `diagnostic.traffic_light` are always **empty** — the bot computes no score.

Persisted to `Bot_Sessions` `A:AZ` (52 columns, verified in F17).

---

## D. Current branch lengths (user interactions = taps + messages)

| Branch | Min | Typical | Max |
|---|---|---|---|
| Full diagnostic → submitted | 13 | 13 | unbounded (contact/consent retry loops) |
| Diagnostic + «➡️ Перейти к контакту» shortcut (from urgency) | 11 | 11 | unbounded |
| «📅 Запросить встречу» → submitted | 6 | 6–7 | unbounded |
| Free-text entry → submitted | 7 | 8–10 | unbounded |
| Person-intro first message (no `/start`) → submitted | **4** | 9–10 ⚠ | unbounded |
| Repeat cycle after `/start` (contact fields retained) | **2** (`/start`, consent) | 3–4 | — |

The absolute minimum is **4** (type "Геннадий, собственник" → «Продолжить без компании» →
«Ответить здесь в Telegram» → «✅ Да, передать эксперту») **but only if a need is already known**.
In practice this path hits the missing-need loop and costs 9–10 — see E-1.

Full diagnostic breakdown: `/start` → diag → 7 ladder taps → name → company → contact → consent = **13**.

---

## E. Current UX problems — observation only

**E-1 · The minimum-data recovery re-asks answered questions.**
`nextContactStep()` correctly skips filled steps. `missingMinimumScreen()` does not: after the
free-text capture it calls `askStep("contact_name")` **unconditionally**, so a user who has already
given name, company and contact is asked for all three again. This is the single most damaging
defect found — it converts a 4-step path into a 9–10-step path with three literal repetitions.

**E-2 · Seven-question ladder with no visible progress.** No step counter, no "3 из 7", no way to
see how much is left. The only escape hatches appear at questions 5 and 6 («➡️ Перейти к контакту»),
not earlier, where abandonment is most likely.

**E-3 · Low-value / CRM-shaped questions.** `has_cfo` and `documents_status` are qualification
fields for the CRM, not for the client's benefit, and are phrased that way («Какие данные уже есть
для первичного разбора?»). `turnover` asks for revenue before any value has been demonstrated, and
already carries an apology in its own copy («Можно не указывать…»).

**E-4 · Dead options in the maps.** Defined but never offered as buttons: `SERVICE.inventory`
(«Запасы / оборотный капитал»), `PAIN.margin` («Непонятна маржинальность»), `PAIN.automation`.
`main_pain` therefore offers 6 of 8 defined pains, and the service list silently merged "inventory"
into the receivables label.

**E-5 · Two screens are unreachable by button.** The price screen and the skip-questionnaire screen
exist and are only reachable by *typing* something the classifier maps to `ask_price` /
`skip_questionnaire`. `m|price`, `m|skip_questionnaire` and the `m|meeting` alias have handlers that
no keyboard ever triggers. Price is a top client question with no button anywhere.

**E-6 · The failure message is indistinguishable from success.** On Lead Intake failure the user
sees «Спасибо. Я зафиксировал ваш запрос… вернёмся к вам» — reassuring, and materially untrue: the
lead was not committed and `status` stays `lead_pending` with `intake_failed_review_needed`. There
is no retry affordance.

**E-7 · Weak completion.** The success message promises a follow-up with no timeframe and no named
next step, then offers four buttons that all lead back into browsing. There is no confirmation of
what was actually sent, and no reference number shown to the user.

**E-8 · Contact and consent are two separate turns.** Consent is asked as a standalone screen after
contact, phrased in data-processing language («подтвердите… что мы можем использовать переданные
данные»), which reads as a legal checkbox rather than a natural close.

**E-9 · Unbounded retry loops.** Unparseable contact and non-yes/no consent both re-ask forever with
no alternative offered after N attempts.

**E-10 · No review step.** See §"Review" below — the user never sees what is about to be sent.

**E-11 · `«Пока без контакта»` is a soft dead end.** It sets `status=no_contact` and offers only
services / menu / end. The qualification data already given is retained but nothing is done with it.

**E-12 · Free-text entry loses the ladder.** Choosing «Описать запрос своими словами» skips all
seven questions entirely, so those leads arrive with `business_model`, `turnover`, `urgency`,
`has_cfo` and `documents_status` all empty — and `diagnostic.score` is empty for every lead anyway.

---

## Review / consent / submit — exactly as it is today

| Question | Answer |
|---|---|
| Is there a review step? | **No.** Nothing summarises the collected answers before submission. |
| What does the user see before submitting? | Only the consent question, then «Готовлю запрос для эксперта FINMENTOR.» |
| How does consent work? | Explicit, per-cycle. Buttons `consent|yes` / `consent|no`, or free text matched by `isConsentYes` / `isConsentNo`. Anything else re-asks. |
| What triggers Lead Intake? | `consent === 'yes'` **and** `hasMinimumLeadData()` → `lead_ready = true` → authority checks → `Build Internal Handoff` → `Send Lead to Intake (Internal)`. |
| Success | Success copy above; `status = lead_sent`, `lead_intake_ok = true`, `lead_id` stamped with the current `cycle_id`. |
| Failure | Fail copy above; `status = lead_pending`, note `intake_failed_review_needed`, no `lead_id` persisted. |

---

## F. Technical invariants the redesign cannot break

Extracted from the deployed graph and the phase records. These are **already established** and are
not up for redesign.

1. **Success is `ok === true` only.** HTTP 2xx, a parseable body, or the absence of an exception are
   explicitly *not* success (`Parse Intake Response`).
2. **A provisional `lead_id` is never persisted unless Intake confirmed it.**
3. **One lead per cycle.** `IF Lead Already Sent` — if the cycle already carries a `lead_id`, a
   repeat consent re-sends the confirmation and **must not** call Lead Intake again.
4. **No requalification after a successful submission without an explicit new request.** A new cycle
   is created *only* on `/start`, or `m|diag` pressed on a finished cycle, or when no cycle exists.
   Plain navigation (`/menu`, `🏠 Главное меню`) never resets it.
5. **Consent is per-cycle and never inherited.** A consent whose `consent_cycle_id` ≠ current
   `cycle_id` is invalidated before the state machine sees it. Same for `lead_id`.
6. **Lead archival, not deletion.** On reset the old `lead_id` moves to `previous_lead_id`.
7. **Consent is mandatory and explicit.** `meta.consent: true` is only ever sent when
   `session.consent === 'yes'`; there is a second `leadReady` re-check after routing that revokes
   submission if consent or minimum data is missing.
8. **`NEVER_BACKFILL`** — a cycle that exists without a submission key is never given one
   retroactively; the cost of refusing is one restart, the cost of backfilling is a duplicate lead.
9. **Row builders emit their declared columns only** (F16): a stray property on a session row
   permanently widens `Bot_Sessions`. Decision metadata is `__`-prefixed precisely so it can never be
   mistaken for a column.
10. **`Bot_Sessions` schema is `A:AZ`, 52 columns, ending at `AZ = financial_zone`** (F17 CLOSED).
    Column emptiness is never a deletion criterion.
11. **`Read Bot Sessions` stays pinned to `A:AV`** — proven sufficient in P7.1; widening it is
    unnecessary work on a live node.
12. **Delivery is verified.** `IF Message Delivered` and `IF Layout Mapped` gate the reply; an
    unrenderable screen falls back to a known-good static menu and **does not advance the session**.
13. **Every keyboard must map to a known layout id** (`L1_C`, `L2_CU`, `L4_CCUC`, …) or it is not
    sent.

---

## Scope

Discovery only. No workflow, message, state, question, translation, merge or activation was touched.
No replacement wording and no new flow is proposed here — that is the next step, and it needs its
own owner approval.
