# FINMENTOR Lead Alerts — the owner information system

**Date:** 2026-08-30
**Scope:** presentation only. No trigger, filter, schedule, threshold or business rule was changed.
**Status:** DEPLOYED 2026-08-30 on owner authorisation, after three owner corrections.

---

## B15. Audit first — every reachable owner-facing template

Read from the live tenant, not from the repo exports. Five workflows push to the owner; one more
replies to commands he types.

### Push alerts — 8 builders, 9 message bodies

| # | type (B1) | workflow / node | trigger | current copy | current data fields | fields removed from the main view | fields kept in technical detail | logic changed |
|---|---|---|---|---|---|---|---|---|
| 1 | **OWNER DAILY BRIEF** | Daily Lead Digest / `Build Daily Digest` → `Telegram Daily Digest` | schedule, daily 08:30 Chisinau | 7 numbered sections, ~40 lines, English headings, always prints 5 zero counters | active/new/HOT/WARM/COLD/INCOMPLETE/RED-ORANGE counts, overdue, no-next-action, no-contact, AI-not-ready, snoozed-expired, 10 lead lines with raw ids, 10 overdue lines, AI ready/missing/plans-today, UTM source table, 4 static recommendations | UTM table, AI ready/missing counts, the four static recommendations, the second overdue list, raw lead ids, timezone line, every zero counter | none — the digest carries no technical detail | **NO** |
| 1b | ↳ empty-pipeline variant | same node, `if (active.length === 0)` branch | same | `"No new or active lead issues today. Pipeline is clean."` | date only | — | — | **NO** |
| 2 | **NEW LEAD** | Lead Intake / `Build Premium Telegram Brief` → `Telegram Lead Alert` | new HOT/premium lead | 🚨 + 7 sections of `━━━` rules, ~3 000 chars | company, name, role, city, country, **email, phone, telegram**, preferred contact, priority, status, next action, zone, score, source, **page URL**, model, industry, turnover, employees, group, branches, urgency, warnings, main pain, selected problems, goals, expected outcomes, weak controls, risk flags, docs status, docs to request, work interest, meeting format, work format, remote readiness, remote doubts, first step, internal comment, lead id | **email, phone, telegram**, page URL, city/country, score, status, the 12 detail lists, the internal comment, the `━━━` rules, the emoji | none — the lead id moves to a `<code>` footer | **NO** |
| 3 | **NEW LEAD** (WARM) | Lead Intake / `Build Warm Telegram Alert` → `Telegram Warm Alert` | new WARM lead | 🟡 + 8 labelled lines | company, name, role, model, zone, score, main pain, next action, priority reason, lead id | score, priority reason, raw `tool` slug | lead id in `<code>` | **NO** |
| 4 | **LEAD INCOMPLETE** | Lead Intake / `Build Incomplete Telegram Alert` → `Telegram Incomplete Alert` | lead with no usable contact/consent | ⚠️ + 6 labelled lines | company, name, **the one contact that did arrive**, priority reason, source, page URL, lead id | **the contact value** (it printed a phone number to say the phone number was missing), page URL | lead id in `<code>` | **NO** |
| 5 | *(does not fit — see B1 report below)* | Lead Intake / `Build Short AI Telegram` → `Telegram AI Work Plan` | after the AI plan is generated | `FINMENTOR AI BRIEF`, 8 sections, ≤3 500 chars | company, contact, priority, zone, risk level, maturity, AI confidence, executive summary, main pain, weak zones, quick wins, first step, documents, lead id | **UNTOUCHED** | **UNTOUCHED** | **NO** |
| 6 | **PRIORITY** | SLA Lead Watch / `SLA Select` → `Telegram SLA Alert` | hourly; HOT/WARM past SLA, anti-spam window | `SLA НАПОМИНАНИЕ — HOT/ORANGE` + 6 lines | priority, zone, company, name, **phone · telegram · email**, stage, overdue reason, next action, lead id | **all three contact values**, name, stage, the raw `HOT/ORANGE` pair | lead id in `<code>` | **NO** |
| 7 | **FOLLOW-UP** | Followup Sequence / `Build Followup Plan` (due_alert) → `Telegram Followup Reminder` | hourly; a planned follow-up came due | `FINMENTOR Follow-up Reminder` + 7 lines | company, name, lead id, priority/zone, type, due (raw timestamp), stage, next action | name, priority/zone pair, type, stage; the due timestamp becomes a phrase | lead id in `<code>` | **NO** |
| 8 | **SYSTEM ALERT** | Error Monitor / `Build Error Alert` → `Telegram Error Alert` | `errorTrigger`, every production workflow | ⚠️ + Workflow / ID / Узел / Класс / Время / Execution / Сообщение | workflow name + id, node, error class, ISO timestamp, execution id, scrubbed message | workflow **id**, ISO timestamp, and the raw class when it says nothing (`EXPRESSIONERROR`) | workflow short name, node, class **when useful**, execution id, scrubbed message | **NO** |

### Owner command replies — 4 templates, out of scope

`Lead Command Center SECURE CANDIDATE` (`qF9tonlHHIxc8MDd`): `Telegram Command Reply` (`/help`),
`Telegram Query Reply` (`/today /overdue /hot /pipeline /lead`), `Telegram Update Reply`,
`Telegram Not Found Reply`.

These answer a command the owner typed. They are conversation, not notification: the owner is
already looking at the screen and already knows what he asked. Redesigning them is a separate,
smaller job and is **not** part of this pass.

**Templates found: 9 push alert bodies from 8 builders, plus 4 command replies = 13.**

---

## B1. Classification, and the one that does not fit

| type | source today |
|---|---|
| 1. OWNER DAILY BRIEF | Daily Lead Digest |
| 2. NEW LEAD | Lead Intake — premium brief, and the WARM alert |
| 3. PRIORITY / HOT LEAD | SLA Lead Watch |
| 4. FOLLOW-UP DUE | Followup Sequence due_alert |
| 5. LEAD INCOMPLETE | Lead Intake incomplete alert |
| 6. SYSTEM ALERT | Error Monitor |
| 7. SYSTEM RECOVERED | **nothing** — see B9 |
| 8. DATA / INTEGRITY WARNING | **nothing** — see below |

### The message that fits none of the eight — reported, not redesigned

`Build Short AI Telegram` → `Telegram AI Work Plan`. It is not an alert about a lead's state; it is
the **delivery of a generated work plan** — executive summary, weak zones, quick wins, documents to
request. Its natural home is a ninth type (`AI WORK PLAN`), and B1 says to report before inventing
one. **Left byte-for-byte untouched**, and asserted untouched by the gate.

### DATA / INTEGRITY WARNING has no trigger

The data-quality signals exist — no-next-action, no-contact, snoozed-expired, AI-plan-missing — but
only as five lines buried inside the daily digest, printed at zero, which is exactly the noise B11
asks to remove. Giving them their own message needs a new schedule and a new selection rule. That
is a business-rule change, so this pass does not make it.

**What this pass does instead:** the four counters move into the brief's «Что требует решения»
block, where each renders **only when non-zero**. The renderer for a standalone
DATA / INTEGRITY WARNING is written and gated, and is unwired.

---

## B9. SYSTEM RECOVERED — does the architecture support it?

**NO.**

n8n's `errorTrigger` fires on failure and has no counterpart that fires when a workflow starts
succeeding again. A recovery signal would need:

1. an open-incident store keyed by workflow + node, written when an alert is sent;
2. a scheduled poller reading `/executions` for those workflows and closing an incident on a
   subsequent success;
3. a de-duplication rule so a flapping workflow does not alternate alert and recovery hourly.

That is new state, a new trigger and a new rule — all three outside a presentation pass. The copy is
written and gated so it is reviewed with the rest; **no trigger was created**, and the renderer is
not reachable from any workflow.

---

## B10. Status vocabulary — two dimensions, and they are not the same dimension

The audit's finding, stated plainly: **`priority` and `financial_zone` are orthogonal and must not
be merged.**

| field | values | what it means | whose business |
|---|---|---|---|
| `priority` (`lead_temperature`) | HOT / WARM / COLD / INCOMPLETE | how the owner should **queue** the lead — derived at intake from intent, completeness and commercial signal | the owner's calendar |
| `financial_zone` (`score_zone`, `risk_zone`) | GREEN / YELLOW / ORANGE / RED | what the **diagnostic** said about the client's finances, from the 0–100 score | the client's business |

A COLD lead can be RED — a struggling company that is not ready to buy. A HOT lead can be GREEN — a
healthy company that wants to start on Monday. Rendering them as one badge would destroy the
information the owner uses to decide what to say in the first call. They render as two separate,
differently-labelled lines, and the deployed `HOT/ORANGE` slash-pair is gone.

**Presentation vocabulary** (semantics unchanged; the Russian below already exists in the deployed
`zoneLabel()` in longer form — this shortens it and stops there):

| raw | owner-facing |
|---|---|
| HOT | Высокий приоритет |
| WARM | Требует внимания |
| COLD | Низкий приоритет |
| INCOMPLETE | Нужны данные |
| RED | Критическая зона |
| ORANGE | Повышенный риск |
| YELLOW | Есть зоны риска |
| GREEN | Устойчиво |
| UNKNOWN / empty / anything else | **the line is omitted** |

An unrecognised value is never mapped to a plausible-looking label. Inventing «Низкий приоритет»
for a value nobody recognises is worse than saying nothing, because the owner would act on a label
the data never carried.

---

## What changed, and what provably did not

`n8n/src/lead-alerts/presenter.js` is the single source of every owner-facing alert string.
`n8n/src/lead-alerts/tz.js` resolves the Chisinau offset (UTC+3 in summer, UTC+2 in winter) so the
renderer itself can stay clock-free and reproducible.

`scripts/build-lead-alerts-presentation.mjs` inlines both into each builder node and replaces
**only the message-construction tail**. For every node it holds the exact prefix of live code that
must survive and refuses to emit if the live code no longer starts with it.

| workflow | nodes | changed |
|---|---|---|
| Daily Lead Digest | 9 | `Build Daily Digest`, `Telegram Daily Digest` |
| SLA Lead Watch | 10 | `SLA Select`, `Telegram SLA Alert` |
| Followup Sequence | 15 | `Build Followup Plan`, `Telegram Followup Reminder` |
| Error Monitor | 5 | `Build Error Alert`, `Telegram Error Alert` |
| Lead Intake | 102 | 3 builders + their 3 Telegram nodes |

Every other node in all five workflows is **byte-identical**. No connection moved. No workflow
setting changed. The inline keyboards on the SLA and follow-up alerts — the owner's
Done / Snooze / Discovery / Docs / Nurture buttons — are byte-identical, so `callback_data` still
matches what the Command Center parses.

Deliberately untouched, and asserted so:

- `Build Short AI Telegram` and `Telegram AI Work Plan` (see B1);
- `message_template` in the Followup builder — that string is **written into the Followups sheet**.
  It is stored data, not an owner message, and rewriting it would rewrite records;
- every Command Center reply node.

### The Telegram nodes

`parse_mode` becomes `HTML` and the text expression becomes `={{ $json.alert_html }}`. The old
expression was:

```
={{ String($json.telegram_message || '').replace(/[_*\[\]()`]/g, ' ').replace(/[<>]/g, '')… }}
```

That `[<>]` strip was correct for plain text and would delete every tag under HTML. Escaping now
happens at the source, in the renderer, where the value and its context are both known.

---

## B16. QA

Two new gates, both offline, both registered in `qa/run-all.mjs` with floors in
`qa/assertion-baseline.json`.

### `qa/lead-alerts-presentation.test.mjs` — 29 assertions

Valid Telegram HTML (tag set, balance, escaping) · hostile-value fuzzing across every renderer · no
empty sections · no zero-only noise (a quiet brief is measured at exactly one zero line) · no
secrets, no initData, no stack traces · no client phone/email/handle even when the model carries
them · no duplicated lead, with two distinct leads at one company both surviving · priority
vocabulary exact and closed · zone vocabulary separate, no shared word · no raw status token
reaches the owner · business and system vocabularies mutually exclusive · the system alert's
forbidden claims · the impact map covers every live workflow name · determinism over 25 passes ·
no clock, locale, `Intl` or `Math.random` in the renderer · Russian month table and plural forms ·
the 4096-character limit under 5 000-character inputs · no emoji anywhere.

### `qa/lead-alerts-candidates.test.mjs` — 18 assertions

This one **executes** the rewritten Code nodes with `$` and `$input` stubbed as n8n provides them.
A candidate that reads correctly and throws at runtime fails on the owner's first real alert with
the message lost, and only running it proves the inlined presenter and the surviving prefix fit
together. It has already earned itself once: it caught a `TZ` identifier collision between the
inlined timezone module and the digest's own `TZ` local.

+0/−0 nodes and an unmoved graph · only the declared nodes differ · **the surviving prefix is a
byte-exact prefix of the live code, and what was dropped contains no `filter(`, `STOP_STAGES`,
`hoursSince`, `isClosed`, `isOverdue`, `classify(` or `scrubMessage`** · triggers, schedules,
credentials and Sheets/Postgres/If/Switch nodes untouched · the inlined presenter is byte-identical
to the module the other gate drives · each builder runs and renders a valid message · the SLA
selection still emits exactly the one HOT overdue lead out of five candidate rows · the Followup
builder still emits both item types and still writes the sheet template as plain text · the Error
Monitor runs on the **verbatim payload of execution 4240** and still scrubs email, phone and URL ·
a hostile lead and a completely empty row both render valid messages · `parse_mode: HTML` and the
new field on every rewritten Telegram node · the inline keyboards and `chatId` unchanged · no
candidate introduces a secret, id or tenant URL relative to its snapshot.

Suite after the change: **51/51 gates, 1903 assertions, floors PASS.**

---

## Rollback

`node scripts/snapshot-lead-alerts.mjs` wrote
`n8n/history/<id>.pre-lead-alerts-presentation.json` for all five workflows. Those files are
simultaneously the rollback artifacts and the base the candidates were built from — deliberately
the same file, because a candidate built from anything other than the exact bytes it will replace
is a candidate that reverts whatever it did not know about.

---

## Owner corrections, 2026-08-30

Three changes were made to the candidates before deployment.

### 1. ONE preferred contact channel, WITH its value, in NEW LEAD only

The first pass carried no contact value anywhere. That was the strictest reading of B14 and it
was too strict: the owner has to act on a NEW LEAD, and making him open the CRM to find the
number is a worse trade than the minimisation buys.

The rule now, decided and pinned in `contactLine()`:

| channel | value present | rendered |
|---|---|---|
| telegram | `@handle` | `Связь` / **Telegram · @handle** |
| telegram | none | `Связь` / **Telegram** — the bot reaches the chat regardless; a handle is never invented |
| phone | number | `Связь` / **Телефон · {phone}** |
| email | address | `Связь` / **Email · {email}** |
| phone or email | none | `Связь` / **Не указана** — a label with no route behind it would be a promise the record cannot keep |
| none stated | anything | `Связь` / **Не указана** |

Phone and email are never rendered together. The channel the CLIENT stated wins; only when the
record states no preference does it fall back to whichever contact arrived.

`Связь` is also the ONE section that survives an empty model. A lead nobody can reach is a fact
the owner must be told, not a line to omit.

The contact appears in NEW LEAD and nowhere else. `validate()` exempts exactly one `Связь` value
line from its contact patterns, refuses a message carrying two, and scans everything else —
including a system alert's technical block — as before. The gate feeds a contact-bearing model
to every other renderer and requires none of it to surface.

### 2. No AI subsystem vocabulary in the daily brief

«3 лида без AI-плана» is gone. The owner channel reports business state; whether a plan has been
generated is the state of a subsystem, and there is no owner action behind it that «без
следующего шага» does not already cover — two lines for one decision is worse than none.

The `aiMissing` counter is **still computed** in the selection code, untouched, and the gate
asserts it is: deleting it would be a logic change, and this pass does not make those.

### 3. LEAD INCOMPLETE states the operational gap, not a legal conclusion

Was: «Форма отправлена без контакта и без согласия.» That reads as a finding about consent while
the Moldovan legal basis is still `PENDING_LEGAL_REVIEW`, and an owner alert is not where that
gets settled.

Now, and **pinned in the renderer** rather than taken from the model, so no builder can vary it:

- **Причина** — «Недостаточно данных для полноценной обработки обращения.»
- **Следующий шаг** — «Проверить данные обращения вручную.»
- **Чего не хватает** — «контакт для связи» as ONE item, not three. The owner does not need to
  know which of phone, Telegram or email is absent to decide to open the record.

The underlying rule is untouched — whatever blocked this lead still blocks it — and
`priority_reason` still travels in the item for the internal record. It is simply not restated
to the owner as a legal finding. The gate asserts a model-supplied reason is ignored entirely.

---

## What the live verification caught

After the first deployment, `scripts/verify-lead-alerts-live.mjs` pulled the Code node source
back out of the five live workflows, executed it, and found a real defect the offline gates had
not been asked about:

> `Источник: Сайт FINMENTOR` on a lead that came from the extended X-Ray.

The deployed premium brief has a `sourceLabel()` of its own that runs first, so `source` reached
the renderer already translated — and a Russian label run through a slug matcher fell through to
the generic fallback, destroying the real source.

Fixed twice over: the builder now passes the RAW `tool` slug, and `sourceLabel()` was made
idempotent so it recognises its own output. The second fix closes the class rather than the
instance — every future caller is safe, including the ones nobody has written yet. Both are
gated, and the workflows were redeployed.

That is the argument for executing the live code rather than trusting the deployment receipt.

---

## Deployment

`scripts/deploy-lead-alerts-presentation.mjs --confirm`. It runs both offline gates first and
refuses to write anything if either is red; preflights **all five** workflows before touching
one, so a failure on the third cannot leave the run half applied; and writes each workflow and
reads it back before starting the next.

Per workflow it proves: the live bytes are in a state this script created (the pre-deploy
snapshot, or the record of its own last write); +0/−0 nodes; the graph and settings unmoved;
nothing outside the declared node set differs from LIVE; every declared node does differ from
the SNAPSHOT; every trigger, schedule, Sheets read, Data Table, If, Switch, Postgres and
credential byte-identical; `callback_data`, `chatId` and credentials unchanged on every Telegram
node; and `active` unchanged.

```
Daily Lead Digest   written and read back, sha 2a257b3e9f4765cb, active true
SLA Lead Watch      written and read back, sha 9eb6ee412ef1e9e6, active true
Followup Sequence   written and read back, sha 8edfe12d5c81c925, active true
Error Monitor       written and read back, sha 89a7f0a30fe0a2c1, active true
Lead Intake         written and read back, sha 74a145c8800843da, active true
```

### Live verification — 43 checks

`scripts/verify-lead-alerts-live.mjs` executes the live builders and checks the rendered output:
every message is valid Telegram HTML; the contact policy holds in all three directions; no AI
vocabulary in the brief while `aiMissing` is still computed; the incomplete alert carries the
pinned copy and no consent wording; the SLA selection still emits exactly one lead out of five
candidate rows; `sla_alert_at` survives so the anti-spam window still works; the Done/Snooze/
Nurture `callback_data` is intact on both actionable alerts; the Followups sheet template is
still written as plain text; every Telegram node sends HTML from `alert_html`; and the AI
work-plan builder is untouched.

---

## Rollback

READY. `n8n/history/<id>.pre-lead-alerts-presentation.json` holds each workflow exactly as it
was before this pass. Those five files were **not** overwritten by either deployment —
`n8n/history/<id>.deployed-lead-alerts.json` records the deployed state separately, so the
rollback still points at the pre-pass state however many times the copy is corrected.

To revert: PUT the `.pre-lead-alerts-presentation.json` body back to `/workflows/<id>`.
