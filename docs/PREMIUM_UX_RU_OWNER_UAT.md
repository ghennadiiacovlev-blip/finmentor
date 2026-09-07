# Premium UX — RU integrated UAT, OWNER ONLY

**Owner-only. Not a customer surface. Do not share the Mini App URL or the bot entry outside the
owner's own Telegram account while this UAT runs.**

Legal activation stays blocked (see `PREMIUM_UX_LEGAL_NOTICE_DIFF.md`). `privacy_legal_basis` is
`PENDING_LEGAL_REVIEW` for the whole of this UAT, and the Mini App shows the DRAFT notice.

---

## 0. Before you start

Deploy the six prepared artifacts to owner-only surfaces and fill the placeholders. Each is
reversible and each has a rollback named in `PREMIUM_UX_PRODUCTION_PREREQUISITES.md` §7.

| # | Artifact | Placeholder to fill |
|---|----------|--------------------|
| 1 | Gateway (TTL 72 h) | — |
| 2 | PUT `/miniapp/session` | — |
| 3 | POST `/miniapp/submit` | `__LEAD_INTAKE_WORKFLOW_ID__`, `__PRIVACY_AUDIT_CREDENTIAL_ID__` |
| 4 | Premium RU Concierge | `__PREMIUM_MINIAPP_URL__` |
| 5 | Lead Intake projection | — |
| 6 | Premium Mini App | `__PREMIUM_GATEWAY_URL__`, `__PREMIUM_SESSION_URL__`, `__PREMIUM_SUBMIT_URL__` in `index.html` |

The privacy credential id is the one printed by
`scripts/provision-privacy-writer-credential.mjs`. **Do not commit any filled value.**

**A UAT run writes real rows.** It creates a real lead in the Pipeline, a real
`Bot_Sessions` cycle, and a real immutable privacy record that **cannot be deleted by the runtime**
— only by an administrator acting as `privacy_audit_owner`. Note the `lead_id` and
`submission_key` of every run so they can be cleaned up afterwards.

### Baseline to record first

```sql
select count(*) from privacy.privacy_acknowledgements;   -- expect 0
```

Pipeline row count, and `Bot_Sessions` row count for your own Telegram id.

---

## 1. The script

Run in order. Each step names what to observe, not just what to tap.

### A. `/start` on a fresh cycle

Send `/start`. **Expect** the entry screen: «Здравствуйте.» and exactly two buttons —
«Описать задачу», «Подготовить бриф».
**Fail if** any qualification question is asked in Telegram, or a third button appears.

### B. Free-text problem

Tap «Описать задачу», then send a message that contains a company in quotes, a first-person role and
one clear objective, e.g.:

> Я собственник, у нас ООО «Ромашка», мы занимаемся оптовой торговлей. Постоянно возникают кассовые
> разрывы, платёжный календарь никто не ведёт.

**Expect** the confirmation screen.
**Fail if** the bot asks a structured question instead, or answers with free-form advice.

### C. `TG_CONFIRM_CONTEXT`

**Expect** «Проверьте, правильно ли FINMENTOR понял ваш контекст.» followed by only the lines it
actually established — «Компания: Ромашка», «Ваша роль: Собственник», «Задача: Денежный поток» —
and two buttons: «Всё верно», «Исправить».

**Fail if:**
- any line shows a dash, an em dash or an empty value;
- «Масштаб» appears (scale is never inferred);
- an objective appears that is not one of the eight approved labels;
- «Нужен независимый взгляд» or «Другая задача» appears (neither is inferable).

**Also test the correction path once.** Tap «Исправить». **Expect** the free-text screen again, and
on re-entry the previous guess must NOT be pre-filled anywhere later.

### D. Confirmed smart-skip

Tap «Всё верно», then «Открыть бриф».

**Expect** the Mini App to open and to **not ask** for company, role or objective — those were
confirmed.
**Fail if** it asks for any of them again, or if it skips a question you never confirmed.

**The negative case matters more.** Run B–D once with a message that establishes nothing
(«Хочу обсудить найм персонала.»). **Expect** no confirmation screen at all — straight to
«Откройте бриф» — and the Mini App **asks every question**, because an AI guess never skips.

### E. Mini App bootstrap

**Expect** the app to open and reach its first question.
**Fail if** it shows a network error, or if it opens but every later write fails — that means the
Gateway issued no session.

### F–G. Company / Role / Scale, and the flow mechanics

Answer what it asks. **Expect** the stage strip to advance, the back button to work, and an answer
you change to stay changed.
**Fail if** a question you already answered is asked twice, or the back button loses an answer.

### H. Objective
Only the eight approved objectives, «CFO-сопровождение» **not** among them as a top-level choice.

### I. Problem — J. Desired Outcome
Branch options must match the objective chosen. **Fail if** a problem from another branch appears.

### K. Current Setup
Multi-select. **Fail if** it behaves as single-select.

### L. Decision Horizon — M. Documents
Documents record **availability only**. **Fail if** any attach control appears or any wording
implies a file was sent.

### N. Contact — O. Important Context
Free text, bounded.

### P. Review — the executive brief

**Expect** ЗАДАЧА to show the exact objective label you selected, and every state to be factual.
**Fail if** any line reads as a judgement («частично», «недостаточно») rather than a fact.

### Q. Edit one field → straight back to Review

Edit exactly one field. **Expect** to land back on Review immediately — not re-walked through the
flow.
**Fail if** you are returned to any intermediate question.

### R. Privacy acknowledgement

**Expect** the concise notice at first collection and the acknowledgement at Submit, both in RU,
carrying the **DRAFT** notice version.
**Fail if** any placeholder (`OWNER_INPUT_REQUIRED`, `{{...}}`) is visible, or if the words
«pre_contractual_request» appear anywhere on screen.

### S. Submit

**Expect** «Обращение передано» ONLY on a real committed submission.

### T. Privacy immutable evidence

```sql
select submission_key, privacy_notice_version, privacy_locale,
       privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis
from privacy.privacy_acknowledgements order by created_at desc limit 5;
```

**Expect** exactly ONE new row; both timestamps present; `acknowledged_at >= shown_at`;
`privacy_legal_basis = 'PENDING_LEGAL_REVIEW'`; `submission_key` matching `^sub_[0-9a-f]{32}$`.
**Fail if** the row carries a name, company, email, telegram id or any answer text.

### U. Lead Intake exactly once

**Expect** exactly one new Pipeline row for this submission.
**Fail if** two rows appear.

### V. Pipeline projection

**Expect** `BP current_setup`, `BQ decision_horizon`, `BR important_context` populated with what you
entered.
**Fail if** any cell reads the literal text `undefined`, or if a **fourth** column appeared — that
would mean the writer reverted to `autoMapInputData` (F16).

### W. Committed success

**Expect** the success screen with the company and objective you gave.

### X. `/start` after a committed submission — **the defect this release fixes**

Send `/start` in Telegram.

**Expect** «Последнее обращение уже передано FINMENTOR. Что хотите сделать?» with «Добавить к
обращению» and «Начать новый вопрос».

**Fail — and stop the UAT — if** the bot returns to qualification, or if `Bot_Sessions` shows
`lead_id` cleared or consent wiped. That is the old behaviour and it must be gone.

Then check in `Bot_Sessions`: `lead_id` unchanged, cycle unchanged.

### Y. Append to the existing request

Tap «Добавить к обращению» and send a sentence.

**Expect** confirmation that it was added to the current request and that **no new request was
created**.
**Fail if** a second Pipeline row appears, or the cycle rotates.

### Z. Explicit new request only

Tap «Начать новый вопрос». **Expect** a confirmation screen first — nothing rotates yet. Check
`Bot_Sessions`: `lead_id` still present.

Then confirm. **Expect** a new cycle, the previous lead **archived** (not lost), and the entry
screen.
**Fail if** the confirmation screen is skipped, or the previous `lead_id` disappears without being
archived.

---

## 2. The controlled failure path

Run this **last**, on a fresh cycle, after completing A–Z once.

**How to induce it:** deactivate the Lead Intake workflow (or point
`__LEAD_INTAKE_WORKFLOW_ID__` at a non-existent id) so the submit call cannot reach it. This makes
the failure a *real* one rather than simulated.

1. Complete the brief and tap Submit.
2. **Expect the failure screen.** **Fail immediately if any success wording appears** — «передано»,
   «принято», a lead id, or the success orb. That is the defect this whole release is built around.
3. Check the store: `select count(*) from privacy.privacy_acknowledgements;`
   The privacy record IS written before intake, so a row may exist. Note its `submission_key`.
4. **Tap retry**, still failing. Expect the failure screen again.
5. Re-activate Lead Intake. **Tap retry once more.** Expect success.
6. **Verify no duplicates:**

```sql
select submission_key, count(*) from privacy.privacy_acknowledgements
group by submission_key having count(*) > 1;      -- expect ZERO rows
```

and in the Pipeline, exactly **one** row for this submission.

**Fail if** two privacy rows share a submission key, or two Pipeline rows exist for one submission.

---

## 3. What a PASS means, and what it does not

A pass means the flow, the projection, the terminal rule and the failure path behave as specified
on an owner-only surface.

It does **not** mean the product may be activated for customers. That still requires: the legal
basis resolved (§4 of the diff), context extraction disclosed in the notice (§11), the controller
identity confirmed, and the postal-address question answered.

---

## 4. Cleanup after the UAT

```sql
-- Privacy rows: only an ADMIN can do this. The runtime cannot, by design.
delete from privacy.privacy_acknowledgements where submission_key in ( ...the keys you noted... );
select count(*) from privacy.privacy_acknowledgements;   -- back to the baseline
```

Pipeline rows and `Bot_Sessions` cycles from the UAT should be removed by hand.
**Do not delete columns** from either sheet — F17's rule holds: emptiness is never the deletion
criterion in this workbook.
