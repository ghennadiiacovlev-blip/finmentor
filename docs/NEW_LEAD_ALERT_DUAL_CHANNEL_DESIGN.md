# NEW LEAD — one event, two channels: Telegram and Email

**Date:** 2026-08-31
**Status:** **DESIGN ONLY. No DDL. Nothing deployed. No credential created. No test email sent.
No workflow touched. The RO transport release (PR #19) is not modified by this pass.**

Extends `NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md` and `NEW_LEAD_ALERT_ROUTE_AUTHORITY_MATRIX.md`.
Depends on `NEW_LEAD_GLOBAL_IDENTITY_CONTRACT.md`, which is **DEPLOYED PASS** — that is what makes
`dispatch_key` derivable at all.

---

## 1. The rule, and the one thing it forbids

```
ONE AUTHORITATIVE NEW LEAD
   → ONE durable dispatch INTENT          (the business event, exactly once)
        → Telegram DELIVERY               independent state
        → Email    DELIVERY               independent state
```

**Email is not a second settlement mechanism.** It observes the same authoritative NEW-lead event
Telegram observes; it does not decide that a lead exists, and no NEW-lead business logic is
duplicated inside a mail workflow. A lead is settled by the Pipeline append — that is unchanged and
not in scope here.

The failure this shape exists to prevent: a second notification path that re-derives "is this a new
lead?" from the CRM. Two derivations means two answers, and the second one eventually creates a
lead, a receipt or a row. Nothing in this design reads the Pipeline to decide *whether* to notify.

## 2. Why the delivery state is a SECOND table, not two more columns

The tempting shape is one outbox row with `telegram_status` and `email_status` columns. It is
rejected, for four measurable reasons:

| | one row, two status columns | intent row + one delivery row per channel |
|---|---|---|
| **claim contention** | both workers `UPDATE` the same row; one blocks the other under `READ COMMITTED` | different rows, no contention |
| **"Telegram retry must not resend Email"** | a code convention — the update touches one column and *must remember* not to touch the other | a **constraint**: the claim's `WHERE` matches one row, and that row is one channel |
| **`DELIVERY_UNKNOWN` is channel-specific** | needs a second column per channel, and every query must remember which pair it means | it is a row status, like every other |
| **a third channel later** | schema migration | one more row |

So: the intent carries the **business event**, and delivery rows carry **transport state**. The
distinction is the whole design — the event happened once, and it can be *announced* many times
without happening again.

## 3. Proposed schema — **NOT APPLIED**

```sql
-- THE INTENT: the business event, exactly once. Unchanged from the earlier proposal except that
-- it no longer carries any delivery state at all.
create table alerts.new_lead_outbox (
  dispatch_key       text primary key,        -- 'NEW_LEAD:' || request_id  <- the ONLY dedup authority
  request_id         text not null,           -- the event identity, stored plainly so the key is checkable
  canonical_lead_id  text not null,           -- reference only: NOT a uniqueness authority
  payload_json       jsonb not null,          -- the shared presentation model (§5)
  created_at         timestamptz not null default now()
);

-- THE DELIVERIES: one row per channel per intent. The composite primary key is what makes a
-- business-event replay unable to create a second pair of notifications.
create table alerts.new_lead_delivery (
  dispatch_key        text not null references alerts.new_lead_outbox(dispatch_key) on delete cascade,
  channel             text not null check (channel in ('telegram','email')),
  status              text not null default 'PENDING'
                        check (status in ('PENDING','CLAIMED','SENT','RETRYABLE',
                                          'DELIVERY_UNKNOWN','FAILED_TERMINAL')),
  attempt_count       int  not null default 0,
  next_attempt_at     timestamptz not null default now(),
  claimed_at          timestamptz,
  sent_at             timestamptz,
  provider_message_id text,                   -- Telegram message_id / the provider's mail id
  last_error          text,                   -- operator-facing, truncated, never a stack trace
  primary key (dispatch_key, channel)
);

create index on alerts.new_lead_delivery (status, next_attempt_at)
  where status in ('PENDING','RETRYABLE');
```

**Enqueue is one transaction, and it is idempotent twice over:**

```sql
insert into alerts.new_lead_outbox (dispatch_key, request_id, canonical_lead_id, payload_json)
values ($1, $2, $3, $4)
on conflict (dispatch_key) do nothing;

insert into alerts.new_lead_delivery (dispatch_key, channel)
values ($1, 'telegram'), ($1, 'email')
on conflict (dispatch_key, channel) do nothing;
```

## 4. The claim — per channel, one statement, no `SELECT`-then-`UPDATE`

```sql
update alerts.new_lead_delivery
   set status = 'CLAIMED', claimed_at = now(), attempt_count = attempt_count + 1
 where dispatch_key = $1
   and channel      = $2
   and status in ('PENDING','RETRYABLE')
   and next_attempt_at <= now()
returning dispatch_key, channel, attempt_count;
```

**Winner:** one row, and that row *is* the authority to send on that channel. **Loser:** zero rows,
which is zero authority — it does nothing and does not retry. `SENT`, `DELIVERY_UNKNOWN` and
`FAILED_TERMINAL` are unclaimable, so a sent notification can never be sent again and an ambiguous
one is never blindly resent; both leave the machine only by a human decision.

### The required behaviours, each mapped to its mechanism

| requirement | mechanism |
|---|---|
| Telegram failure must NOT block Email | separate rows; the email claim's `WHERE` never mentions Telegram |
| Email failure must NOT block Telegram | same, symmetrically |
| Telegram retry must NOT resend a delivered Email | the retry claims `(key,'telegram')`; the email row is `SENT` and unclaimable |
| Email retry must NOT resend a delivered Telegram alert | same, symmetrically |
| a business-event replay must NOT create a second pair | `dispatch_key` PK + `(dispatch_key, channel)` PK, both `on conflict do nothing` |
| `DELIVERY_UNKNOWN` stays channel-specific | it is a row status, and rows are per channel |
| no second lead / receipt / Pipeline row from a notification retry | the dispatcher **only** reads the outbox and writes delivery state. It never calls Lead Intake, never writes Sheets, never touches a receipt |

## 5. The shared presentation model — one model, two renderers

`payload_json` is **already specified** and already approved: the eleven fields in
`NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md` §6, which are exactly the arguments of
`renderNewLead(model)` in the gated `n8n/src/lead-alerts/presenter.js`:

```
company · role · objective · situation · priority · zone · nextAction
contactChannel · contactValue · source · leadId
```

**Nothing is added to the model for email.** Both renderers consume the same object:

```
payload_json ─┬─► renderNewLead(model)        → Telegram HTML   (deployed, gated, unchanged)
              └─► renderNewLeadEmail(model)   → { subject, html, text }   (new, this design)
```

The label vocabularies are shared, not re-invented — `priorityLabel`, `zoneLabel`, `sourceLabel`
and `contactLine` already exist in `presenter.js` and the email renderer imports them. Two
vocabularies would eventually disagree, and the owner would be told "Высокий приоритет" in Telegram
and something else by email about the same lead.

An unrecognised value still returns `''` and the block is **omitted** rather than guessed. That rule
is inherited deliberately: inventing a plausible label is worse than silence, because the owner acts
on it.

## 6. Data minimisation — the email carries strictly what Telegram carries

**Allowed:** the eleven model fields, and the single preferred contact destination.

**Forbidden, and each already excluded from the model by construction:** `raw_json` in any form,
Telegram `initData`, `hash`/`auth_date`/any signed material, the Mini App draft envelope, alternate
contacts (one channel, one value, maximum), privacy-acknowledgement internals, workflow ids,
node names, execution ids, stack traces, and internal scoring diagnostics not approved for
presentation.

`last_error` lives on the delivery row for the operator and is **never rendered into a NEW LEAD
email**. An email is a business notification, not a debug channel.

## 7. Subject contract

```
FINMENTOR · Новый лид · {company} · {priorityLabel}
```

| case | subject |
|---|---|
| company + HOT | `FINMENTOR · Новый лид · Alfa Grup · Высокий приоритет` |
| company + WARM | `FINMENTOR · Новый лид · Vinaria Bostavan · Требует внимания` |
| **no company** | `FINMENTOR · Новый лид · Компания не указана · Требует проверки` |

Reading the owner's third example precisely: the **company** segment falls back to
`Компания не указана`, and the **priority** segment falls back to `Требует проверки` when the
priority is absent or unrecognised. That reuses the existing `PRIORITY_LABEL` vocabulary
(`Высокий приоритет`, `Требует внимания`, `Низкий приоритет`, `Нужны данные`) and adds exactly one
new string for the unknown case. **If the intent was instead that a missing company alone forces
`Требует проверки` regardless of a known priority, say so — it is a one-line change.**

Company is truncated to 70 characters, matching the Telegram card, so the subject cannot be used to
smuggle a long string into a mail client's preview.

## 8. The premium HTML email

Executive briefing, not a CRM dump. Email-safe by construction: **tables only**, no flexbox, no
grid, no `<style>` dependency for layout, inline CSS on every element that matters, **no
JavaScript**, no remote fonts required to stay readable, and a solid `bgcolor` on every coloured
cell so Outlook renders it without VML.

Identity: FINMENTOR navy (`#08111F` / `#0D1B2E`) with a restrained gold rule (`#C9A227`), on a light
content card. No emoji. No banner image. No logo image — the wordmark is set in type, so the email
is readable with images disabled, which is the default in several corporate clients.

```html
<!-- FINMENTOR — NEW LEAD. 600px, table-based, inline CSS, no JS, no remote assets. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:0;padding:0;background-color:#EEF1F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;border-collapse:collapse;">

        <!-- masthead -->
        <tr>
          <td bgcolor="#08111F" style="background-color:#08111F;padding:28px 32px 24px 32px;
              font-family:Georgia,'Times New Roman',serif;">
            <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;
                        color:#C9A227;font-weight:700;">FINMENTOR</div>
            <div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>
            <div style="font-size:22px;letter-spacing:1px;color:#FFFFFF;font-weight:400;">
              Новый лид</div>
          </td>
        </tr>
        <tr>
          <td bgcolor="#C9A227" style="background-color:#C9A227;height:3px;line-height:3px;
              font-size:0;">&nbsp;</td>
        </tr>

        <!-- identity -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:32px 32px 8px 32px;
              font-family:Georgia,'Times New Roman',serif;">
            <div style="font-size:24px;line-height:32px;color:#0D1B2E;font-weight:700;">
              {{company}}</div>
            <!-- role: omitted entirely when absent -->
            <div style="font-size:15px;line-height:22px;color:#5A6675;padding-top:4px;">
              {{role}}</div>
          </td>
        </tr>

        <!-- one block per section; a block with no value is omitted, never rendered empty -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:20px 32px 0 32px;
              font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;
                        color:#8C97A5;font-weight:700;padding-bottom:6px;">Задача</div>
            <div style="font-size:16px;line-height:24px;color:#12233A;font-weight:700;">
              {{objective}}</div>
          </td>
        </tr>

        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:20px 32px 0 32px;
              font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;
                        color:#8C97A5;font-weight:700;padding-bottom:6px;">Ситуация</div>
            <div style="font-size:15px;line-height:24px;color:#3B4757;">{{situation}}</div>
          </td>
        </tr>

        <!-- priority: the one accent block. zone is a SECOND dimension and is labelled, so it can
             never be misread as the first -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:24px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#F7F4EA" style="background-color:#F7F4EA;
                    border-left:3px solid #C9A227;padding:16px 18px;
                    font-family:Arial,Helvetica,sans-serif;">
                  <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;
                              color:#8C7A2E;font-weight:700;padding-bottom:6px;">Приоритет</div>
                  <div style="font-size:17px;line-height:24px;color:#0D1B2E;font-weight:700;">
                    {{priorityLabel}}</div>
                  <div style="font-size:14px;line-height:22px;color:#5A6675;padding-top:6px;">
                    Финансовая зона · {{zoneLabel}}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:20px 32px 0 32px;
              font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;
                        color:#8C97A5;font-weight:700;padding-bottom:6px;">Следующий шаг</div>
            <div style="font-size:16px;line-height:24px;color:#12233A;font-weight:700;">
              {{nextAction}}</div>
          </td>
        </tr>

        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:20px 32px 0 32px;
              font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;
                        color:#8C97A5;font-weight:700;padding-bottom:6px;">Связь</div>
            <div style="font-size:17px;line-height:26px;color:#0D1B2E;font-weight:700;">
              {{contactLine}}</div>
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:28px 32px 32px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid #E2E7ED;height:1px;line-height:1px;
                             font-size:0;">&nbsp;</td></tr>
            </table>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;
                        color:#8C97A5;padding-top:16px;">
              Источник · {{sourceLabel}}</div>
            <div style="font-family:'Courier New',Courier,monospace;font-size:13px;
                        line-height:20px;color:#5A6675;padding-top:4px;">{{leadId}}</div>
          </td>
        </tr>

        <tr>
          <td bgcolor="#0D1B2E" style="background-color:#0D1B2E;padding:16px 32px;
              font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;
              color:#7C8899;">
            FINMENTOR · внутреннее уведомление
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
```

**Mobile:** a single 600px column with `max-width:100%` and no side-by-side cells, so it reflows
without a media query. Every font size is ≥ 13px.

**Omission rule, inherited from the Telegram card:** a block whose value is empty is **not
rendered** — no empty heading, no `—` placeholder, except `company`, which falls back to `—` because
the identity line must exist. `Финансовая зона` is dropped when `zone` is absent, and the whole
`Следующий шаг` block is dropped when `nextAction` is absent.

**Escaping:** every interpolated value is HTML-escaped with the presenter's existing `esc()`. The
model is business text the client typed, so it is untrusted for markup purposes even though it is
approved for presentation.

## 9. Plain-text fallback

Sent as the `text/plain` alternative in the same message — not a separate email.

```
FINMENTOR · НОВЫЙ ЛИД

Alfa Grup
Финансовый директор

ЗАДАЧА
Построить управленческую отчётность и платёжный календарь

СИТУАЦИЯ
Оптовая торговля · Дистрибуция · 30–60 млн MDL · 50–100 человек

ПРИОРИТЕТ
Высокий приоритет
Финансовая зона · Повышенный риск

СЛЕДУЮЩИЙ ШАГ
Ответить сегодня / предложить Discovery Call

СВЯЗЬ
Telegram · @ion_popescu

Источник · Сайт FINMENTOR
FIN-1788000000000-909
```

Same model, same omission rule, no HTML. A client that refuses HTML still gets an actionable
briefing rather than a stripped tag soup.

## 10. Delivery authority — a 2xx from the mail provider is not a business event

The email may originate **only** from a claimed `alerts.new_lead_delivery` row whose intent already
exists — that is, from the same durable post-settlement authority Telegram uses. It never originates
from an intake response, a webhook, or a Sheets read.

And in the other direction: **a provider 2xx means the message was accepted for delivery, nothing
more.** It sets `status='SENT'` on that one row and records `provider_message_id`. It does not
confirm receipt, it does not confirm the lead, and it changes nothing outside the delivery table.

| provider outcome | delivery status | why |
|---|---|---|
| 2xx with a message id | `SENT` | accepted; terminal for this channel |
| 4xx that is a permanent refusal (bad recipient, rejected content) | `FAILED_TERMINAL` | retrying cannot help |
| 429 / 5xx / connection refused **before** the request was accepted | `RETRYABLE` + backoff | provably not sent |
| timeout, or a dropped connection **after** the request was sent | `DELIVERY_UNKNOWN` | it may have gone out; resending could double-notify, and only a human can settle it |

The `RETRYABLE` / `DELIVERY_UNKNOWN` split is the same distinction the Gateway already makes between
a failure before and after the point of no return. Getting it wrong in the lenient direction sends
the owner two identical briefings; getting it wrong in the strict direction loses one. Neither is
acceptable by default, which is why `DELIVERY_UNKNOWN` is a terminal, human-resolved state rather
than a retry.

## 11. Sending from `cfo@finmentor.md` — recommendation, provider not assumed

`cfo@finmentor.md` is a **fixed owner destination**. It is a server-side constant in the dispatcher;
it is never read from a payload, a client field or any public input, so no caller can redirect a
NEW LEAD notification.

**Recommended route, in order:**

1. **A transactional email API over SMTP** (Resend, Postmark, SendGrid, Amazon SES — all equivalent
   for this purpose). Reasons that matter here: an HTTP call has a determinate status code, which is
   what §10's four-way split needs; SMTP conversations fail in ways that are much harder to classify
   as sent-or-not. The API also returns a `message_id` for `provider_message_id`.
2. **The sender should be a FINMENTOR domain address on an authenticated domain** — e.g.
   `alerts@finmentor.md` — with `cfo@finmentor.md` as the recipient, and `Reply-To: cfo@finmentor.md`.
   Sending *from* the same mailbox that receives is possible but makes threading and filtering
   worse, and self-addressed mail is treated more suspiciously by some filters.
3. **SPF, DKIM and DMARC on `finmentor.md` are a prerequisite, not an optimisation.** Without DKIM
   this mail lands in spam often enough that the owner will stop trusting the channel, which
   silently defeats the entire dual-channel design.
4. **If `finmentor.md` mail is already hosted** (Google Workspace / Microsoft 365), the cheapest
   correct route is that provider's transactional relay with an app credential — no new vendor, and
   the domain is already authenticated. **Which provider hosts `finmentor.md` mail is not something
   this pass measured, and it should be checked before choosing.**

**No credential was created, no provider account was touched, and no test message was sent.**

## 12. Report

| | |
|---|---|
| **NEW LEAD BUSINESS AUTHORITY** | unchanged — the Pipeline append, keyed by the now-deployed canonical `request_id`. Email observes it; it never re-derives it |
| **TELEGRAM DELIVERY DESIGN** | one `alerts.new_lead_delivery` row, `channel='telegram'`, claimed by the statement in §4. The deployed `renderNewLead` presenter is unchanged |
| **EMAIL DELIVERY DESIGN** | one row, `channel='email'`, same claim, its own status/attempts/backoff, its own `DELIVERY_UNKNOWN` |
| **SHARED PRESENTATION MODEL** | the same eleven-field `payload_json`; two renderers; shared label vocabularies from `presenter.js` |
| **CHANNEL-INDEPENDENT RETRY** | guaranteed by the composite primary key, not by convention — a claim's `WHERE` names one channel and can match one row |
| **DUPLICATE PROTECTION** | `dispatch_key` PK for the event; `(dispatch_key, channel)` PK for the pair; `SENT` unclaimable; the dispatcher writes no lead, receipt or Pipeline row |
| **EMAIL DATA MINIMISATION** | strictly the eleven approved fields plus one contact destination; every forbidden item is excluded by construction, not by filtering |
| **PREMIUM HTML TEMPLATE** | §8 — 600px table layout, inline CSS, navy + restrained gold, no emoji, no banner, no images, no JS, no remote fonts, Gmail/Apple Mail/Outlook safe |
| **PLAIN-TEXT FALLBACK** | §9 — same model, same omission rule, sent as the `text/plain` alternative |
| **CREDENTIAL / PROVIDER REQUIRED** | **YES** — a transactional mail provider and a domain-authenticated sender. Not chosen, not created, not configured |
| **DDL CHANGE REQUIRED** | **YES** — §3: `new_lead_outbox` loses its delivery columns, and `new_lead_delivery` is new. **NOT APPLIED, and still not approved** |

## 13. What this pass did not do

No table, no migration, no role, no grant. No dispatcher, no reconciler. No credential, no provider
account, no test email. No workflow deployed or edited. No change to `renderNewLead`. No change to
the RO transport release. No backfill. `lead_id` untouched.

**Open, and unchanged by this pass:** `ALERT OUTBOX DDL APPROVAL = PENDING`,
`SYSTEM ALERT COVERAGE GAP = OPEN`, `AUTHORITATIVE CYCLE PROJECTION = OPEN`,
`LEAD_ID UNIQUE AUTHORITY = OPEN`, `CUSTOMER PRODUCTION = BLOCKED`.

**Updated 2026-09-01.** `ALERT OUTBOX DDL APPROVAL` is no longer pending: revision 2.2 was approved
and applied to `finmentor-prod`, and accepted —
`OUTBOX PRODUCTION DATABASE FOUNDATION = CLOSED / READY`
([record](NEW_LEAD_ALERT_OUTBOX_PRODUCTION_APPLY.md)). The database is **dormant**: no runtime
login, no n8n credential, no writer, no dispatcher, no reconciler schedule, no Microsoft Graph
credential, and nothing sent on either channel. `TELEGRAM DURABLE NEW LEAD DELIVERY` is the next
engineering phase; `EMAIL DURABLE NEW LEAD DELIVERY` stays blocked on that runtime proof plus Graph
setup. Every other status on this line is unchanged, `CUSTOMER PRODUCTION = BLOCKED` included.
