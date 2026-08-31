# NEW LEAD ALERT OUTBOX — final DDL review

**Status:** **DDL REVIEW ONLY. NO DDL APPLIED. No schema created, no role created, no grant issued,
no workflow deployed, no credential created, no message sent.** Every statement below is a
proposal awaiting owner approval.

Supersedes the schema sketch in `NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md` and pins the open
questions in `NEW_LEAD_ALERT_DUAL_CHANNEL_DESIGN.md` against the **currently deployed** graphs,
fresh-read 2026-08-31.

---

## 1. The authoritative NEW LEAD event

Traced in the deployed `FINMENTOR Lead Intake PREMIUM FINAL` (`QmIyEW2ZEqKregmN`, 109 nodes):

```
Claim Verdict → IF Claim Won → IF Receipt Required → IF Is New → Build Pipeline Row
   → Save to Pipeline ──[0] success──→ IF Internal (New) → Respond New Lead / Internal Result (New)
                     └──[1] error────→ IF Internal (PipelineFailed) → Respond Pipeline Failed
```

**`Save to Pipeline`, success output `[0]`, is where a NEW LEAD becomes authoritative.** It is the
Google Sheets append to the Pipeline, and it carries `onError: continueErrorOutput`, so output `[0]`
is reached **only** when the append itself succeeded — a failure goes down `[1]` and answers
`PIPELINE_WRITE_FAILED`. Nothing earlier qualifies: the webhook, the dedup read, the receipt claim
and the HTTP status are all upstream of the row existing.

**Explicitly rejected as authority**, each already disproven in this system: webhook arrival; HTTP
200 alone (`Parse Intake Result` exists precisely because 2xx is not success); the client success
screen; a Telegram callback; Lead Alerts rendering; email send success.

The emit point is therefore **`IF Internal (New)`**, the first node downstream of settlement — the
same shape as the SYSTEM ALERT emits deployed and proven this week.

## 2. Request identity, and whether one dispatch key covers every route

`n8n/src/system-alert`-style canonicalisation already exists for leads and **is deployed**: the
`CANONICAL REQUEST IDENTITY` module (`RI`) is inlined and used in both `Validate Payload` and
`Dedup Guard`, with `IDENTITY_ROUTE_FORBIDDEN` live in each. *(Its file header still reads
"CANDIDATE. NOT DEPLOYED." — that comment is stale and should be corrected; the tenant runs it.)*

| route | shape | minted | one per |
|---|---|---|---|
| public web (RU + RO) | `fmr_<32 lower hex>` | browser, once per logical submission, reused on every retry | submission |
| Concierge | `C-<chat_id>-<epoch ms>` | `Get Bot Session` | application cycle |
| Mini App | `sub_<32 lower hex>` | derived `sha256("miniapp:" + app_session_id)` | app session |

**`NEW_LEAD:<canonical_request_id>` is valid on all three routes, and here is the proof for the one
that is not obvious.** The Concierge identity is a *cycle*, not a submission — so the key is only
sound if a cycle can settle at most one NEW lead. It can: `IF Lead Already Sent` refuses the
handoff when the session's `lead_id` is non-empty, and `Parse Intake Response` sets `lead_id` only
on `intake_ok`. A failed attempt leaves `lead_id` empty and `status = lead_pending`, so a retry
inside the same cycle is permitted and carries the **same** identity — which is exactly the
behaviour the outbox wants: one event, retried.

**Route crossing cannot collapse the namespaces.** `canonicalise()` refuses a `sub_`/`C-` identity
from a public caller and an `fmr_` identity from an internal one. The module's own header names
this as the reason: without it a public request could put a foreign `sub_` value in Pipeline's
identity column, *"where a future `dispatch_key = 'NEW_LEAD:' || request_id` would collide with a
real Mini App submission."* That refusal is deployed, so the outbox inherits a clean namespace.

`request_id` is durably persisted on the Pipeline row (`Build Pipeline Row` writes the
`request_id` column), which is what makes §9 reconciliation deterministic months later.

**`lead_id` is not the uniqueness authority** anywhere below. It is stored as a reference and as
part of the alert snapshot only. `LEAD_ID UNIQUE AUTHORITY` remains POST-GO HARDENING.

## 3. Schema, tables and the split

Dedicated schema **`alerts`**. No existing schema is a better home: `public` holds exactly one
table — `public.telegram_initdata_replays`, the G5 ledger — and mixing a notification outbox into
the schema that carries the replay-defence authority is precisely the coupling to avoid.

Two tables, because event authority and delivery attempts have different lifetimes, different
writers and different retention:

* **`alerts.new_lead_outbox`** — the durable INTENT. One row per authoritative NEW LEAD. Written
  once, never updated except to purge PII.
* **`alerts.new_lead_delivery`** — one row per (event, channel). High-churn: claims, attempts,
  failures, retries.

Mixing them would put `telegram_status` and `email_status` on one row, which makes "a retry of
Email must never resend Telegram" a *convention* the update statement has to remember. As separate
rows it is a **constraint**: the claim's `WHERE` matches one row, and that row is one channel.

## 4. FORWARD DDL

> **NOT APPLIED.** Idempotent throughout (`IF NOT EXISTS` / `DO $$` guards). Run the §8 precondition
> first.

```sql
-- ============================================================================
-- FINMENTOR — NEW LEAD ALERT OUTBOX               forward migration, v1
-- PRECONDITION: see docs §8. Do not run without owner approval.
-- ============================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS alerts;
COMMENT ON SCHEMA alerts IS
  'FINMENTOR notification outbox. Independent of public.telegram_initdata_replays (G5): no role '
  'granted here may read or write the G5 replay ledger, and no G5 role is granted anything here.';

-- ---------------------------------------------------------------- the event
CREATE TABLE IF NOT EXISTS alerts.new_lead_outbox (
  -- Derived, never supplied: the key and the identity cannot disagree.
  dispatch_key    text GENERATED ALWAYS AS ('NEW_LEAD:' || request_id) STORED,
  event_type      text        NOT NULL DEFAULT 'NEW_LEAD',
  request_id      text        NOT NULL,
  request_route   text        NOT NULL,
  lead_id         text        NOT NULL,
  schema_version  smallint    NOT NULL DEFAULT 1,
  settled_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  payload_json    jsonb       NOT NULL,
  payload_purged_at timestamptz,

  CONSTRAINT new_lead_outbox_pk PRIMARY KEY (dispatch_key),
  -- request_id is the logical identity; the generated key makes this redundant by construction,
  -- and it is declared anyway so the intent survives a future edit to the key expression.
  CONSTRAINT new_lead_outbox_request_uk UNIQUE (request_id),

  CONSTRAINT new_lead_outbox_event_type_ck CHECK (event_type = 'NEW_LEAD'),
  CONSTRAINT new_lead_outbox_route_ck      CHECK (request_route IN ('public','concierge','miniapp')),

  -- The three deployed shapes, and nothing else. A malformed identity is refused by the database,
  -- not only by the graph that inserts it.
  CONSTRAINT new_lead_outbox_request_shape_ck CHECK (
        (request_route = 'public'    AND request_id ~ '^fmr_[0-9a-f]{32}$')
     OR (request_route = 'miniapp'   AND request_id ~ '^sub_[0-9a-f]{32}$')
     OR (request_route = 'concierge' AND request_id ~ '^C--?[0-9]{1,20}-[0-9]{10,16}$')
  ),
  CONSTRAINT new_lead_outbox_lead_id_ck CHECK (lead_id <> '' AND length(lead_id) <= 64),

  -- ALLOWLIST, enforced in the database. The payload is the approved NEW LEAD presentation model
  -- and nothing else; an unknown key fails the insert rather than being stored and forgotten.
  CONSTRAINT new_lead_outbox_payload_allowlist_ck CHECK (
    jsonb_typeof(payload_json) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(payload_json) AS k(key)
      WHERE k.key NOT IN ('company','role','objective','situation','priority','zone',
                          'next_action','source','contact_channel','contact_value','lead_id')
    )
  ),
  CONSTRAINT new_lead_outbox_contact_channel_ck CHECK (
    payload_json->>'contact_channel' IS NULL
    OR payload_json->>'contact_channel' IN ('telegram','phone','email','none')
  ),
  CONSTRAINT new_lead_outbox_purge_ck CHECK (
    payload_purged_at IS NULL OR NOT (payload_json ? 'contact_value')
  )
);

COMMENT ON TABLE alerts.new_lead_outbox IS
  'One row per AUTHORITATIVE NEW LEAD, written after Lead Intake''s Save to Pipeline succeeds. '
  'The row is the durable INTENT to notify; it is not a delivery record and never a lead record. '
  'The row outlives its payload: PII is purged on schedule but the key must survive forever, or a '
  'later replay of the same request would mint a second business event.';
COMMENT ON COLUMN alerts.new_lead_outbox.dispatch_key IS
  'NEW_LEAD:<canonical request_id>. Generated, so it can never disagree with request_id.';
COMMENT ON COLUMN alerts.new_lead_outbox.request_id IS
  'Canonical identity from the deployed RI module. fmr_ public, sub_ Mini App, C- Concierge cycle. '
  'NOT lead_id: lead_id uniqueness is POST-GO HARDENING and is deliberately not an authority here.';
COMMENT ON COLUMN alerts.new_lead_outbox.payload_json IS
  'The approved NEW LEAD presentation snapshot, allowlisted by constraint. Never a raw webhook '
  'body, raw_json, draft envelope, initData, signature material or execution payload.';
COMMENT ON COLUMN alerts.new_lead_outbox.settled_at IS
  'When Lead Intake settled the lead (Save to Pipeline success), not when this row was written.';

CREATE INDEX IF NOT EXISTS new_lead_outbox_created_idx  ON alerts.new_lead_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS new_lead_outbox_lead_idx     ON alerts.new_lead_outbox (lead_id);
-- Drives the retention sweep without scanning purged rows.
CREATE INDEX IF NOT EXISTS new_lead_outbox_unpurged_idx ON alerts.new_lead_outbox (settled_at)
  WHERE payload_purged_at IS NULL;

-- ------------------------------------------------------------- the delivery
CREATE TABLE IF NOT EXISTS alerts.new_lead_delivery (
  dispatch_key        text        NOT NULL,
  channel             text        NOT NULL,
  status              text        NOT NULL DEFAULT 'PENDING',
  claim_token         uuid,
  claimed_at          timestamptz,
  attempt_count       integer     NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  last_error_code     text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- (dispatch_key, channel) IS the uniqueness the owner asked for, as the primary key.
  CONSTRAINT new_lead_delivery_pk PRIMARY KEY (dispatch_key, channel),
  CONSTRAINT new_lead_delivery_fk FOREIGN KEY (dispatch_key)
    REFERENCES alerts.new_lead_outbox (dispatch_key) ON DELETE RESTRICT,

  CONSTRAINT new_lead_delivery_channel_ck CHECK (channel IN ('telegram','email')),
  CONSTRAINT new_lead_delivery_status_ck  CHECK (status IN
    ('PENDING','CLAIMED','SENT','RETRYABLE_FAILED','DELIVERY_UNKNOWN','PERMANENT_FAILED')),
  CONSTRAINT new_lead_delivery_attempts_ck CHECK (attempt_count >= 0 AND attempt_count <= 1000),
  CONSTRAINT new_lead_delivery_error_ck    CHECK (last_error_code IS NULL
                                                  OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,39}$'),

  -- STATE INVARIANTS, so an impossible row cannot be written by any worker.
  -- SENT is terminal and PERMANENTLY UNCLAIMABLE: no token, and a timestamp that proves it.
  CONSTRAINT new_lead_delivery_sent_ck CHECK (
    status <> 'SENT' OR (sent_at IS NOT NULL AND claim_token IS NULL)),
  -- Only a CLAIMED row may hold a token, and it must hold both halves.
  CONSTRAINT new_lead_delivery_claim_ck CHECK (
    (status = 'CLAIMED' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    OR (status <> 'CLAIMED' AND claim_token IS NULL)),
  -- DELIVERY_UNKNOWN records that an attempt was made; it must never look like a fresh row.
  CONSTRAINT new_lead_delivery_unknown_ck CHECK (
    status <> 'DELIVERY_UNKNOWN' OR attempt_count > 0),
  -- Only SENT may carry a provider id.
  CONSTRAINT new_lead_delivery_provider_ck CHECK (
    provider_message_id IS NULL OR status IN ('SENT','DELIVERY_UNKNOWN'))
);

COMMENT ON TABLE alerts.new_lead_delivery IS
  'One row per (event, channel). Telegram and Email are SEPARATE ROWS, not columns: "a retry of '
  'Email must never resend Telegram" is then a constraint — the claim WHERE matches one row and '
  'that row is one channel — rather than a convention an UPDATE has to remember.';
COMMENT ON COLUMN alerts.new_lead_delivery.status IS
  'PENDING → CLAIMED → SENT | RETRYABLE_FAILED | DELIVERY_UNKNOWN | PERMANENT_FAILED. '
  'SENT is terminal and unclaimable. DELIVERY_UNKNOWN is NEVER auto-retried: see docs §7.';
COMMENT ON COLUMN alerts.new_lead_delivery.claim_token IS
  'Proof of ownership issued by the atomic claim. Present only while CLAIMED.';
COMMENT ON COLUMN alerts.new_lead_delivery.provider_message_id IS
  'Provider-neutral. Recorded when the provider returns one. Never a credential, never a URL.';

CREATE INDEX IF NOT EXISTS new_lead_delivery_claimable_idx
  ON alerts.new_lead_delivery (channel, next_attempt_at)
  WHERE status IN ('PENDING','RETRYABLE_FAILED');
CREATE INDEX IF NOT EXISTS new_lead_delivery_attention_idx
  ON alerts.new_lead_delivery (status, updated_at)
  WHERE status IN ('DELIVERY_UNKNOWN','PERMANENT_FAILED');

CREATE OR REPLACE FUNCTION alerts.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;

DROP TRIGGER IF EXISTS new_lead_delivery_touch ON alerts.new_lead_delivery;
CREATE TRIGGER new_lead_delivery_touch BEFORE UPDATE ON alerts.new_lead_delivery
  FOR EACH ROW EXECUTE FUNCTION alerts.touch_updated_at();

-- ------------------------------------------------------------------- roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_writer')     THEN CREATE ROLE alerts_writer     NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_dispatcher') THEN CREATE ROLE alerts_dispatcher NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_reconciler') THEN CREATE ROLE alerts_reconciler NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_audit')      THEN CREATE ROLE alerts_audit      NOLOGIN; END IF;
END $$;

-- Nothing is public, and no client role is mentioned anywhere in this migration.
REVOKE ALL ON SCHEMA alerts FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA alerts FROM PUBLIC;

GRANT USAGE ON SCHEMA alerts TO alerts_writer, alerts_dispatcher, alerts_reconciler, alerts_audit;

-- The writer may record an intent and nothing else. No UPDATE, no DELETE: an event, once
-- authoritative, is not editable by the thing that observed it.
GRANT INSERT, SELECT ON alerts.new_lead_outbox TO alerts_writer;
GRANT INSERT, SELECT ON alerts.new_lead_delivery TO alerts_writer;

-- The dispatcher reads the intent and owns delivery state. It may NOT write the outbox.
GRANT SELECT ON alerts.new_lead_outbox TO alerts_dispatcher;
GRANT SELECT, INSERT, UPDATE ON alerts.new_lead_delivery TO alerts_dispatcher;

-- The reconciler may create a MISSING intent and nothing else.
GRANT SELECT, INSERT ON alerts.new_lead_outbox TO alerts_reconciler;
GRANT SELECT ON alerts.new_lead_delivery TO alerts_reconciler;

GRANT SELECT ON alerts.new_lead_outbox, alerts.new_lead_delivery TO alerts_audit;

ALTER TABLE alerts.new_lead_outbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.new_lead_delivery ENABLE ROW LEVEL SECURITY;
-- RLS with NO permissive policy: PostgREST/anon/authenticated reach nothing even if a future
-- grant is made by accident. The service roles above bypass RLS only if they are owners or
-- BYPASSRLS; they are not, so policies are added deliberately when the dispatcher is built.

COMMIT;
```

## 5. ROLLBACK DDL

```sql
-- NOT APPLIED. Drops only what the forward migration created. It never touches public.*.
BEGIN;
DROP TRIGGER IF EXISTS new_lead_delivery_touch ON alerts.new_lead_delivery;
DROP TABLE IF EXISTS alerts.new_lead_delivery;
DROP TABLE IF EXISTS alerts.new_lead_outbox;
DROP FUNCTION IF EXISTS alerts.touch_updated_at();
DROP SCHEMA IF EXISTS alerts;          -- deliberately NOT CASCADE: refuses if anything survives
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_writer')     THEN DROP ROLE alerts_writer;     END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_dispatcher') THEN DROP ROLE alerts_dispatcher; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_reconciler') THEN DROP ROLE alerts_reconciler; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_audit')      THEN DROP ROLE alerts_audit;      END IF;
END $$;
COMMIT;
```

**Rollback destroys delivery history and the idempotency keys.** After the dispatcher is live, a
rollback means a replayed request can mint a second business event. Roll back only before the
dispatcher exists, or export both tables first.

## 6. The payload allowlist, and the PII actually stored

The approved NEW LEAD model, taken from the deployed presenter
(`renderNewLead`, `n8n/src/lead-alerts/presenter.js`):

```
company · role · objective · situation · priority · zone · next_action · source
contact_channel · contact_value · lead_id
```

Eleven keys, enforced by `new_lead_outbox_payload_allowlist_ck`.

**PII stored: exactly one field — `contact_value`**, and only because the approved alert renders
one «Связь» line. The presenter's own validator permits at most one such line and exempts nothing
else; every other field is a business descriptor. `contact_channel` is a label
(`telegram|phone|email|none`) and is not personal data.

**Never stored, and not merely by policy — an unknown key fails the CHECK:** raw initData,
Telegram signature/hash/auth_date, raw webhook body, `raw_json`, draft envelope, internal execution
payload, credentials, connection details, stack traces. `name`, `email` and `phone` are absent from
the allowlist: the owner opens the CRM row to call, and the alert exists to say whether the row is
worth opening now.

## 7. Delivery states, the atomic claim, and DELIVERY_UNKNOWN

| state | meaning | may be claimed? |
|---|---|---|
| `PENDING` | intent recorded, never attempted | yes, when `next_attempt_at <= now()` |
| `CLAIMED` | a worker owns it; token + `claimed_at` set | no |
| `SENT` | provider accepted; `sent_at` set, token cleared | **never** |
| `RETRYABLE_FAILED` | transient failure; `next_attempt_at` in the future | yes, after `next_attempt_at` |
| `DELIVERY_UNKNOWN` | the call may have succeeded and the acknowledgement was lost | **never, automatically** |
| `PERMANENT_FAILED` | the provider refused in a way retrying cannot fix | no |

**Atomic claim — one statement, no `SELECT` → decide → `UPDATE`:**

```sql
WITH candidate AS (
  SELECT dispatch_key, channel
    FROM alerts.new_lead_delivery
   WHERE channel = $1
     AND status IN ('PENDING','RETRYABLE_FAILED')
     AND next_attempt_at <= now()
   ORDER BY next_attempt_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1
)
UPDATE alerts.new_lead_delivery d
   SET status        = 'CLAIMED',
       claim_token   = gen_random_uuid(),
       claimed_at    = now(),
       attempt_count = d.attempt_count + 1
  FROM candidate c
 WHERE d.dispatch_key = c.dispatch_key
   AND d.channel      = c.channel
   AND d.status IN ('PENDING','RETRYABLE_FAILED')
RETURNING d.dispatch_key, d.channel, d.claim_token, d.attempt_count;
```

Zero rows returned means no work — never "assume it is ours". `FOR UPDATE SKIP LOCKED` gives
exactly one winner under concurrency; the repeated `status IN (...)` in the outer `WHERE` closes
the window. **`SENT` is unclaimable twice over**: it is absent from the claim predicate, and
`new_lead_delivery_sent_ck` forbids a token on a `SENT` row.

Every finalising write must also prove ownership:

```sql
UPDATE alerts.new_lead_delivery
   SET status = 'SENT', sent_at = now(), claim_token = NULL, provider_message_id = $4
 WHERE dispatch_key = $1 AND channel = $2 AND claim_token = $3 AND status = 'CLAIMED';
```

### DELIVERY_UNKNOWN — the recovery policy, per channel

Set when the provider call was issued and the outcome is not known: a timeout, a dropped
connection, or a worker crash after the send and before the database write.

* **Telegram — never auto-resend.** `sendMessage` is not idempotent and Telegram exposes no
  lookup by our key, so there is no way to ask whether message N exists. Automatic recovery would
  be a coin flip between a silent miss and a duplicate owner alert. Policy: the row stays
  `DELIVERY_UNKNOWN`, and a **SYSTEM ALERT** (the mechanism deployed this week) tells the owner
  that one NEW LEAD notification is in doubt, carrying the `dispatch_key`. The owner decides.
* **Email — never auto-resend under a provider-neutral design.** Some providers accept an
  idempotency key and expose message lookup; none is selected, so no such capability may be
  assumed. Policy is identical to Telegram today. **When a provider is chosen**, if it offers a
  durable idempotency key *and* lookup, a reconciler may promote `DELIVERY_UNKNOWN` to `SENT` or
  re-issue under the same key — that is a separate approval, not a licence granted here.

`DELIVERY_UNKNOWN` appears in the `new_lead_delivery_attention_idx` partial index, so the set
needing human attention is a cheap query rather than a scan.

## 8. Failure isolation — the lead stays successful

The insert happens **after** `Save to Pipeline` succeeds, on a branch hanging off the settled
outcome, `waitForSubWorkflow: false` and `onError: continueRegularOutput` — the topology proven in
production by the SYSTEM ALERT deployment.

**If the lead commits and the outbox insert fails: the lead remains successful.** The client still
receives `ok:true` with the canonical `lead_id`; the alert branch cannot reach the response, which
has already been sent by `Respond New Lead` upstream. A successful lead is never converted into a
customer-visible failure because notification infrastructure is unavailable.

The missing intent is recovered twice over: an operational **SYSTEM ALERT** fires on the failed
insert, and the §9 reconciler finds it deterministically. There is no distributed transaction
between Google Sheets and Postgres, and inventing one would make the lead depend on the alert.

**Precondition to run the forward DDL** (the safety check, not a claim):

```sql
SELECT
  (SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'alerts')            AS alerts_schema_exists,
  (SELECT count(*) FROM information_schema.tables   WHERE table_schema = 'public')           AS public_tables,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'telegram_initdata_replays')             AS g5_present;
-- expected before migration: 0, 1, 1
```

## 9. Reconciliation contract

Deterministic, on `request_id`, never fuzzy:

```sql
-- Pipeline NEW LEADs (mirrored or read) that have no outbox event.
SELECT p.request_id, p.lead_id, p.created_at
  FROM staging.pipeline_new_leads p            -- the authoritative Pipeline projection
 WHERE p.request_id <> ''
   AND p.created_at >= now() - interval '7 days'
   AND NOT EXISTS (SELECT 1 FROM alerts.new_lead_outbox o WHERE o.request_id = p.request_id)
 ORDER BY p.created_at;
```

Rows with an empty `request_id` — legacy Pipeline rows predating the identity contract — are
**excluded and reported**, never matched by company or timestamp. Guessing which lead an alert
belongs to is how a notification reaches the wrong record.

Insertion is `ON CONFLICT (request_id) DO NOTHING`, so a reconciler racing the live path creates no
duplicate. **Not built in this phase.**

## 10. Interaction with SYSTEM ALERT

Separate business authorities, deliberately. SYSTEM ALERT means *"an operation failed and needs
owner attention"*, keyed `sa_<sha256(route+verdict+identity)>`; NEW LEAD means *"a lead was
settled"*, keyed `NEW_LEAD:<request_id>`. They may later share delivery infrastructure; they may
never share an identity contract or a table. **The deployed SYSTEM ALERT workflow is not modified
by this phase.**

## 11. Validation queries (post-apply, when approved)

```sql
-- 1. schema, tables, and G5 untouched
SELECT table_name FROM information_schema.tables WHERE table_schema = 'alerts' ORDER BY 1;
SELECT count(*) AS g5_rows FROM public.telegram_initdata_replays;   -- unchanged by the migration

-- 2. every constraint present
SELECT conname, contype FROM pg_constraint
 WHERE connamespace = 'alerts'::regnamespace ORDER BY conrelid::regclass::text, conname;

-- 3. the generated key really is generated
SELECT column_name, is_generated, generation_expression
  FROM information_schema.columns
 WHERE table_schema='alerts' AND table_name='new_lead_outbox' AND column_name='dispatch_key';

-- 4. grants are exactly what was intended, and PUBLIC has nothing
SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
  FROM information_schema.role_table_grants
 WHERE table_schema = 'alerts' GROUP BY 1,2 ORDER BY 1,2;

-- 5. G5 isolation, both directions
SELECT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='telegram_initdata_replays'
   AND grantee LIKE 'alerts\_%';                                   -- expected: zero rows

-- 6. RLS on
SELECT relname, relrowsecurity FROM pg_class
 WHERE relnamespace = 'alerts'::regnamespace AND relkind='r';
```

## 12. Retention

| what | window | why |
|---|---|---|
| `payload_json → contact_value` | **30 days** from `settled_at`, then removed and `payload_purged_at` stamped | the only PII stored; the alert has been delivered and acted on long before |
| the rest of `payload_json` | 30 days, purged with it | business descriptors have no value once the CRM row is authoritative |
| the outbox ROW — key, identity, `lead_id`, timestamps | **retained indefinitely** | **deleting it would let a replayed request mint a second business event.** The uniqueness authority must outlive the PII |
| `new_lead_delivery` | **180 days** | operational forensics; carries no PII |

The 30-day assumption from `NEW_LEAD_ALERT_DUAL_CHANNEL_DESIGN.md` is still consistent and is
carried forward. **Flagged for explicit owner approval** because it is now a *data-protection*
commitment rather than a design note, and because the "key row survives forever" rule is new and
deserves a conscious yes. Retention jobs are **not implemented** in this phase.

## 13. QA plan — permanent gates

Offline against a schema fixture, plus SQL-level tests when the migration is approved:

| # | gate |
|---|---|
| 1 | duplicate `request_id` insert → conflict, one row |
| 2 | same request via two route components → one outbox event |
| 3 | Telegram + Email → two independent delivery rows |
| 4 | a `SENT` Telegram row can never be reclaimed |
| 5 | a `SENT` Email row can never be reclaimed |
| 6 | `RETRYABLE_FAILED` is claimable only after `next_attempt_at` |
| 7 | concurrent claims → exactly one winner, the loser gets zero rows |
| 8 | `DELIVERY_UNKNOWN` is never returned by the claim query |
| 9 | an invalid channel is rejected by constraint |
| 10 | an invalid `event_type` is rejected by constraint |
| 11 | a malformed `request_id` is rejected per route shape |
| 12 | a forbidden payload key is rejected by the allowlist CHECK |
| 13 | no client/anon/authenticated role can write either table |
| 14 | no `alerts_*` role can reach `public.telegram_initdata_replays` |
| 15 | no G5 role can reach `alerts.*` |
| 16 | the reconciler finds a missing event deterministically by `request_id` |
| 17 | the reconciler creates no duplicate (`ON CONFLICT DO NOTHING`) |
| 18 | a failed outbox insert leaves the lead successful and the response unchanged |

Gates 4, 5, 7 and 8 are the ones that must run against **real Postgres** — `SKIP LOCKED` and
partial-index semantics cannot be proven by a fixture.
