# NEW LEAD alert outbox — measured storage decision and proposed schema

**Date:** 2026-08-30
**Status:** **PROPOSAL. NO DDL APPLIED. Awaiting owner approval of the persistent schema.**
**Authority unchanged:** `docs/POST_E2E_PIPELINE_PROJECTION_AND_ALERT_AUTHORITY.md`,
`scripts/verify-new-lead-settlement-authority.mjs` (36 live checks, PASS).

> ### CORRECTED 2026-08-31 — the primary key changed. **DDL STILL NOT APPROVED, STILL NOT APPLIED**
> ### The identity precondition below is now MET in production. The DDL remains unapproved.
>
> **`dispatch_key = 'NEW_LEAD:' || canonical_lead_id` (§6 line 101, §7, §9) is superseded** by
> `NEW_LEAD_GLOBAL_IDENTITY_CONTRACT.md`. The key is derived from the persisted Pipeline
> `request_id` under the corrected identity contract; `canonical_lead_id` is stored plainly as a
> payload and reference field and is **not** a uniqueness authority.
>
> The identity columns become:
>
> ```sql
>   dispatch_key       text primary key,   -- 'NEW_LEAD:' || request_id   <- the ONLY dedup authority
>   request_id         text not null,      -- the event identity, stored plainly so the key is checkable
>   canonical_lead_id  text not null,      -- reference only: NOT a uniqueness authority
> ```
>
> §1's argument for a real database constraint, §2's precedent, §3–§5, §8 and §10 are unaffected.
>
> **The DDL is blocked on a precondition this document could not have known.** Under the deployed
> graph, two settled NEW Pipeline rows **can** share one `request_id` (a reused identity with
> different contact data — measured, `qa/lead-intake-request-identity.test.mjs` case E-2). A
> primary key over that column would silently swallow the second lead's alert. The identity
> candidate closes it and gate **OB-1** proves no two settled rows can share an identity under it,
> but the candidate is **not deployed**, so the precondition is **not yet met**.
>
> With this correction the document no longer contradicts the identity candidate. It remains a
> **proposal**: the schema is not approved, and the precondition above is not met until the
> candidate is deployed.

---

## 1. Why an n8n Data Table cannot be the final authority

Measured, not assumed:

| | |
|---|---|
| `Submission_Receipts` unique constraints | **none** — n8n Data Tables expose no unique index, which is why the Mini App resume design says so in writing and arbitrates by a total order instead |
| what it does provide | a real compare-and-set: `update WHERE key AND commit_state='READY'`, with the updated-row count read back. Proven in production by `Receipt Claim` / `Claim Verdict` |
| what that is enough for | claiming a row that already exists |
| what it is **not** enough for | *creating* the intent exactly once. Two reconcilers racing on a store with no unique index both see "absent" and both insert. The whole point of the ledger is that the intent is unique |

So a Data Table can arbitrate a claim but cannot be the uniqueness authority. **A real database
constraint is required.**

## 2. The precedent this follows exactly

The project already has a least-privilege append store in Supabase, and the new one mirrors it
rather than inventing a shape:

```
privacy.privacy_acknowledgements     RLS enabled
  privacy_ack_submission_key_uidx    UNIQUE (submission_key)     <- the constraint IS the idempotency
  owner   privacy_audit_owner        NOLOGIN
  runtime privacy_audit_writer       LOGIN, INSERT only
```

G5 is a different table with different owners and is **not touched**:

```
public.telegram_initdata_replays     RLS enabled
  pkey UNIQUE (replay_key)
  grants: postgres, service_role only
```

PostgreSQL **17.6**.

## 3. The payload, derived from the approved renderer — eleven fields, and no more

This is the measurement that decides the schema. The approved NEW LEAD presentation is
`renderNewLead(model)` in the gated `n8n/src/lead-alerts/presenter.js`, and its model is:

```js
{ company, role, objective, situation, priority, zone, nextAction,
  contactChannel, contactValue, source, leadId }
```

**Eleven fields reproduce the approved message byte for byte.** The 47 KB
`Build Premium Telegram Brief` node reads 29 item fields and parses `raw_json` only to *derive*
that model — the derivation is upstream of the presentation, and it does not need to be repeated
at delivery time if the model is what is stored.

So `payload_json` holds the model and nothing else:

- **no `raw_json`**, wholesale or minimised — the intake tree is never persisted here;
- no Telegram `initData`, no signature material, no `hash`, no `auth_date`;
- no Mini App draft fields;
- **no contact alternatives** — one channel and one value, which is the line the approved copy
  already prints and which the instruction permits;
- no scores, no zones beyond the one rendered label, no debugging payload.

`contactValue` is personal data. It is here because the alert cannot do its job without it, it is
the single already-approved line, and it is bounded by the retention rule in §7.

## 4. Proposed schema — every field justified, three of the suggested ones dropped

```sql
-- NOT APPLIED. Proposed for approval.
create schema if not exists alerts authorization alert_dispatch_owner;

create table alerts.new_lead_outbox (
  dispatch_key         text        primary key,
  status               text        not null default 'PENDING'
                                   check (status in ('PENDING','CLAIMED','RETRYABLE','SENT',
                                                     'DELIVERY_UNKNOWN','DEAD')),
  payload_json         jsonb       not null,
  attempt_count        integer     not null default 0,
  next_attempt_at      timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  claimed_at           timestamptz,
  sent_at              timestamptz,
  telegram_message_id  text,
  last_error_class     text
);

create index new_lead_outbox_due_idx
  on alerts.new_lead_outbox (next_attempt_at)
  where status in ('PENDING','RETRYABLE');
```

| field | why it is here |
|---|---|
| `dispatch_key` | PRIMARY KEY **is** the exactly-once intent. `NEW_LEAD:<canonical_lead_id>` |
| `status` | the six states §6 requires, constrained in the database rather than by convention |
| `payload_json` | the eleven-field model of §3 — the only thing that makes a later retry faithful |
| `attempt_count` | a retry that never ends is an outage that never gets noticed; bounds the move to `DEAD` |
| `next_attempt_at` | backoff, and the only thing the claim query needs to order by |
| `created_at` | reconciler eligibility, and the age of an unsent alert |
| `claimed_at` | distinguishes a worker still sending from one that died mid-send |
| `sent_at` | when the owner was actually told |
| `telegram_message_id` | proof of delivery, and the handle a human needs to check a `DELIVERY_UNKNOWN` |
| `last_error_class` | a CLASS, never a raw error body — enough to triage, nothing to leak |

**Dropped from the suggested list, deliberately:**

- `event_type` — the key prefix carries it. A second event type would be a deliberate schema change,
  not a column waiting to be used.
- `submission_key` — no operation reads it. The public route has none, so it cannot be the key
  either (see §5), and duplicating it here would be a second identity for the same row.
- `canonical_lead_id` — derivable from `dispatch_key`, and present in `payload_json.leadId`.

### The key, and why not `submission_key`

The instruction offered `NEW_LEAD:<submission_key>` "or another deterministic equivalent derived
from the canonical receipt identity". **`submission_key` exists only on the internal route** —
receipts are gated by `IF Receipt Required`, and a public-webhook lead has none. `canonical_lead_id`
is on the receipt (`Receipt Commit (New)` writes it), is the settled identity on every route, and a
committed replay resolves to the same one. So:

```
dispatch_key = 'NEW_LEAD:' || canonical_lead_id
```

deterministic, one per settlement, identical across all three entry routes.

## 5. Grants — least privilege, derived from the operations

```sql
create role alert_dispatch_owner  nologin;
create role alert_dispatch_writer login password '<generated, stored only in the n8n credential>';

grant usage on schema alerts to alert_dispatch_writer;
grant select, insert, update on alerts.new_lead_outbox to alert_dispatch_writer;

alter table alerts.new_lead_outbox enable row level security;
-- No policy is created: RLS with no policy denies everything to non-owner roles that are not
-- BYPASSRLS, and the writer reaches the table through its explicit grants as table owner's
-- delegate. Mirrors privacy.privacy_acknowledgements, which is RLS-enabled with the same intent.
```

`SELECT` is required and the privacy writer does not have it, so the difference is called out:
the claim is `UPDATE … RETURNING`, and `RETURNING` needs `SELECT` on the returned columns. The
reconciler also needs to ask whether a key exists. No `DELETE`, no `TRUNCATE`, no schema-wide
default privileges, nothing on any other schema. **No G5 privilege is widened, and no existing role
is altered.**

## 6. Delivery states, and the ambiguity rule

```
PENDING ──claim──► CLAIMED ──confirmed ok──────────► SENT   (+ telegram_message_id, never resent)
   ▲                  │
   │                  ├──confirmed pre-send/API error──► RETRYABLE ──► (backoff, claim again)
   │                  └──ambiguous transport failure───► DELIVERY_UNKNOWN   ■ no automatic resend
   └── RETRYABLE ─────┘
                     attempt_count exceeded ─────────► DEAD  ■ manual review
```

- **confirmed success** → `SENT`, `sent_at`, `telegram_message_id` if Telegram returned one. Never
  sent again: the claim predicate excludes it.
- **confirmed failure before the request reached Telegram** (rendering error, 4xx from the API,
  connection refused) → `RETRYABLE`, safe to retry automatically.
- **ambiguous** — a timeout or a dropped connection *after* the request was written, where the
  message may or may not have been delivered → `DELIVERY_UNKNOWN`, and **no automatic resend**.

**Documented limitation.** Telegram's `sendMessage` has no client-supplied idempotency key, so
there is no transport-level way to make delivery exactly-once. This design therefore separates
**exactly-once durable intent** — which the primary key does guarantee — from **at-most-once
automatic delivery**. In the ambiguous window the system deliberately prefers one alert that may
need a human to confirm over two alerts that both look legitimate. Resolving a
`DELIVERY_UNKNOWN` is an operator action, and `telegram_message_id` being null is the signal.

## 7. Retention

`payload_json` carries one contact value. A row is not needed after delivery, so:

```sql
-- proposed, run by the owner role, not by the writer
delete from alerts.new_lead_outbox
 where status = 'SENT' and sent_at < now() - interval '30 days';
```

Nothing here is a system of record: the lead lives in the Pipeline, the settlement in the receipt.
**This is an outbox, not a CRM.**

## 8. The atomic claim

```sql
update alerts.new_lead_outbox
   set status = 'CLAIMED',
       claimed_at = now(),
       attempt_count = attempt_count + 1
 where dispatch_key = $1
   and status in ('PENDING','RETRYABLE')
   and next_attempt_at <= now()
returning dispatch_key, payload_json, attempt_count;
```

One statement. Under `READ COMMITTED`, a second worker running the same statement blocks on the row
lock, then re-evaluates its `WHERE` against the committed row — which now says `CLAIMED` — and
returns **zero rows**. Zero rows returned is zero authority to send; the loser does nothing. There
is no `SELECT`-then-`UPDATE` anywhere in the design.

The enqueue is equally a single statement:

```sql
insert into alerts.new_lead_outbox (dispatch_key, payload_json)
values ($1, $2::jsonb)
on conflict (dispatch_key) do nothing;
```

Which makes concurrent reconcilers harmless by construction: the second insert affects zero rows.

*(Note for implementation: the n8n Postgres node splits `options.queryReplacement` on commas before
resolving, and hides SQLSTATE — a unique violation surfaces only on `json.message`. Both are already
recorded and gated from the privacy-store work.)*

## 9. The commit → enqueue crash window

The first-settlement path enqueues immediately. If the process dies after `COMMITTED` and before
the row exists, an independent reconciler closes it:

```
for each Submission_Receipts row with commit_state = COMMITTED and lead_mode = 'new'
    and settled_at older than 5 minutes:
        dispatch_key := 'NEW_LEAD:' || canonical_lead_id
        INSERT ... ON CONFLICT DO NOTHING          <- uniqueness makes racing reconcilers harmless
```

It creates intents and nothing else: **no lead, no receipt change, no Pipeline write, no Lead
Intake re-run, no client call, no settlement.** It reads the receipt table through the same n8n
Data Table node the workflow already uses, so **no closed surface is widened** and nothing new is
granted to reach it.

**One honest gap.** The reconciler has to build the model for a row the settlement path never got
to persist. Ten of the eleven fields come from the Pipeline row (`company`, `role`, `work_interest`,
`main_pain`, `priority`, `financial_zone`, `next_action`, `source_page`, `lead_id`) and the receipt.
The eleventh — `contactChannel` — is **not a Pipeline column**; the settlement path reads it from
the payload. A reconciled alert would therefore have to infer the channel (telegram, then email,
then phone, by presence) rather than honour a stated preference. That affects only alerts recovered
from the crash window, and it is a fallback, not the normal path. The alternative — adding a
`preferred_contact` column to the Pipeline — is a Pipeline schema change and is **not proposed**.

## 10. Rollback

```sql
drop table if exists alerts.new_lead_outbox;
drop schema if exists alerts;
revoke usage on schema alerts from alert_dispatch_writer;   -- if the schema survives
drop role if exists alert_dispatch_writer;
drop role if exists alert_dispatch_owner;
```

Nothing else references the table; dropping it cannot affect a lead, a receipt, the Pipeline, the
privacy store or G5. The credential is deleted from n8n separately.

## 11. What is NOT built, and why

The dispatch workflow, the reconciler and the Lead Intake rewiring are **not built**. They cannot be
proven against a table that does not exist, and the instruction is explicit: stop before applying
production DDL and report the exact table, indexes, grants and rollback for approval. That is this
document.

On approval the remaining work is: apply the DDL, create the least-privilege credential, build the
dispatch workflow (nine nodes moved plus `Read Settings` + `Settings to Object` copied, because all
three Telegram nodes resolve `owner_chat_id` through `$('Settings to Object')`), build the
reconciler, rewire three edges in Lead Intake with the dispatch call at depth 1 listed **before**
`Internal Result (New)`, and prove the A–N matrix offline before any deploy.
