# NEW LEAD ALERT OUTBOX — DDL review, **REVISION 2.2**

**Status:** **VALIDATED ON A DISPOSABLE NON-PRODUCTION PostgreSQL 17.6 CLUSTER, PLUS A READ-ONLY
PREFLIGHT AGAINST finmentor-prod. NOT APPLIED TO finmentor-prod.** No production schema created,
no production role created, no production grant issued, no production setting changed, no workflow
deployed, no n8n credential created, no Microsoft Graph credential created, no Telegram or Email
message sent. `public.telegram_initdata_replays` / G5 untouched in production — the validation used
a synthetic copy of its *shape* in an isolated cluster, and the preflight read only `pg_settings`,
`pg_db_role_setting` and catalog counts. SYSTEM ALERT and cycle projection untouched. Customer
production not activated. **Production DDL still requires separate owner approval.**

Revision 2 answers the owner review of 2026-08-31. Revision 1 is superseded in full and survives
only in git (`git show 6330809:docs/NEW_LEAD_ALERT_OUTBOX_DDL_REVIEW.md`); it is superseded rather
than kept alongside, because two DDL documents that disagree is the exact failure this schema is
being built to avoid.

**Revision 2.1** is revision 2 plus exactly four amendments, each forced by a *failing* proof on
real PostgreSQL and each recorded inline at the point it changes. Nothing else in the design moved.

| # | amendment | what revision 2 did | why it could not stand | §16 gate |
|---|---|---|---|---|
| **2.1-A** | `GRANT alerts_owner TO current_user` is unconditional (§4.1) | guarded on `pg_has_role(..., 'MEMBER')` | PG16+ auto-grants a CREATEROLE migrator a membership with `set_option = false`; the guard saw it, skipped the real grant, and the very next statement failed `42501 must be able to SET ROLE "alerts_owner"`. **The migration could not be applied at all by a non-superuser migrator — the Supabase `postgres` shape** | CLEAN APPLY |
| **2.1-B** | the payload allowlist CHECK uses `jsonb - text[]` (§4.3) | `NOT EXISTS (SELECT …)` | `0A000 cannot use subquery in check constraint`. The table could not be created, and the "allowlist enforced twice" claim was unbuilt | 34 |
| **2.1-C** | `ON CONFLICT DO NOTHING` with no arbiter (§4.4) | `ON CONFLICT (request_fingerprint) DO NOTHING` | `dispatch_key` has its own unique index (the PK). A 6-way concurrent burst on one identity produced three bare `23505` errors instead of `ALREADY_PRESENT` — unclassifiable by a dispatcher that can only read `ALERTS_*` prefixes (§8) | 20 |
| **2.1-D** | the rollback GRANTs before `DROP OWNED BY` (§5) | `REVOKE` then `DROP OWNED BY` | `DROP OWNED BY` needs the role's privileges. **The rollback could not be run at all by a non-superuser migrator** | ROLLBACK |

**The revision-2.1 failure record above is preserved deliberately and is not rewritten.** Four
defects were found, three of which made the migration or its rollback impossible to run at all.
Deleting that record would make this document a worse guide to the next migration than the one it
replaced.

**Revision 2.2** is the owner's final pre-production hardening pass. It is revision 2.1 plus five
further amendments — three of them forced by owner decisions, two by a defect this pass found.

| # | amendment | what revision 2.1 did | why it could not stand | gate |
|---|---|---|---|---|
| **2.2-A** | the migration **revokes the migrator's working membership in `alerts_owner`** before `COMMIT`, keeping only the `ADMIN OPTION` PostgreSQL requires to administer the role again (§4.7) | left the migrator holding a full membership — `SET`, `INHERIT` and `ADMIN` — indefinitely | **owner decision:** a migrator that keeps the ability to `SET ROLE alerts_owner` after the migration ends is a standing privilege nobody asked for. It must exist for the migration interval and no longer | 49–52 |
| **2.2-B** | the automatic repair window is **policy data**, `alerts.retention_policy.automatic_repair_days` (§4.3, §4.4) | `c_repair_window CONSTANT interval := interval '7 days'` inside `alerts.enqueue_new_lead` | **owner decision:** 7 days is approved, but changing an approved *business* policy must not require a function migration. A business rule compiled into a `CREATE FUNCTION` body is a business rule only a deploy can change | 53–57 |
| **2.2-C** | the `DELIVERY_UNKNOWN` deletion horizon is **explicit pending policy data**, and `purge_new_lead_deliveries()` **refuses to run** once that status changes without the code being written (§4.3, §4.5) | `DELIVERY_UNKNOWN` was merely absent from the purge's `WHERE` | **owner decision:** a pending horizon must not become "forever" by implementation accident — and it must not become "swept" by accident either, the moment somebody records a decision the purge does not implement | 58 |
| **2.2-D** | `ALERTS_PAYLOAD_KEY_FORBIDDEN` reports **only a count**, never the key names (§4.4) | `RAISE EXCEPTION 'ALERTS_PAYLOAD_KEY_FORBIDDEN (%)', v_bad` — the offending **key names**, echoed | **defect found in this pass.** Key names are caller-controlled strings. `{"C-123456789-1788000000000": 1}` would have put a raw Concierge identity into the error message, and `log_min_error_statement = error` on finmentor-prod logs the failing statement. The rule "no caller value in an error" has no safe exception for key names | 59–61 |
| **2.2-E** | the rollback **asserts** that no `alerts_*` role survives it (§5) | dropped the roles, and said so in a comment | a comment is not a post-condition. If a `DROP ROLE` were ever made conditional, the temporary membership the rollback must grant would silently outlive the rollback | 51 |

Full evidence, both validation runs, the production read-only logging preflight, and everything
that is still open:
[`docs/NEW_LEAD_ALERT_OUTBOX_NONPROD_VALIDATION.md`](NEW_LEAD_ALERT_OUTBOX_NONPROD_VALIDATION.md).

**What changed, and why each change was required:**

| # | owner finding | revision 2 |
|---|---|---|
| 1 | `dispatch_key` embedded a raw Concierge `C-<chat_id>-<epoch_ms>` and was to be kept forever | **raw `request_id` is no longer stored anywhere in `alerts.*`.** The database computes a SHA-256 `request_fingerprint`; the key carries the fingerprint (§2, §4) |
| 2 | event + two delivery rows were three separate n8n-arbitrated writes | **one `SECURITY DEFINER` function, one transaction, convergent**, with a self-check that aborts rather than commit a partial state (§4.4) |
| 3 | runtime roles held direct table DML | **no runtime role holds any table privilege.** `EXECUTE` on named functions only; the RLS execution model is proven, not assumed (§4.6, §4.7) |
| 4 | retention said "key retained forever" | payload **30 d**, delivery metadata **180 d**, key retention **PENDING LEGAL / PRIVACY FINALISATION** — held in a policy row the cleanup code reads, so no "forever" is baked in (§4.3, §12) |
| 5 | "exactly one PII field" was misleading | corrected: `contact_value` **is** the phone / email / Telegram handle, depending on `contact_channel` (§6) |
| 6 | email provider unknown | **SELECTED = Microsoft 365 / Graph; CREDENTIAL = PENDING OWNER SETUP** (§14) |
| 7 | Graph-specific resend semantics were drifting toward a decision | not finalised. Generic rule stands: `DELIVERY_UNKNOWN` is **not automatically reclaimable** (§7, §14.3) |
| 8 | QA stopped at 18 gates | gates **19–32** added, each with the exact proof method (§13) |

---

## 1. The authoritative NEW LEAD event — **unchanged**

Traced in the deployed `FINMENTOR Lead Intake PREMIUM FINAL` (`QmIyEW2ZEqKregmN`, 109 nodes):

```
Claim Verdict → IF Claim Won → IF Receipt Required → IF Is New → Build Pipeline Row
   → Save to Pipeline ──[0] success──→ IF Internal (New) → Respond New Lead / Internal Result (New)
                     └──[1] error────→ IF Internal (PipelineFailed) → Respond Pipeline Failed
```

`Save to Pipeline`, success output `[0]`, is where a NEW LEAD becomes authoritative. It carries
`onError: continueErrorOutput`, so `[0]` is reached **only** when the Google Sheets append itself
succeeded. Rejected as authority, each already disproven in this system: webhook arrival; HTTP 200
alone; the client success screen; a Telegram callback; alert rendering; email send success.

The emit point is `IF Internal (New)`, the first node downstream of settlement.

## 2. Request identity — raw identifier in, fingerprint stored

### 2.1 The three deployed shapes

The `CANONICAL REQUEST IDENTITY` (`RI`) module is **deployed** and inlined in both `Validate
Payload` and `Dedup Guard`, with `IDENTITY_ROUTE_FORBIDDEN` live in each. *(Its file header still
reads "CANDIDATE. NOT DEPLOYED." — stale, recorded in revision 1, still not corrected: this pass is
documentation-only by instruction.)*

| route | shape | minted | one per |
|---|---|---|---|
| public web (RU + RO) | `fmr_<32 lower hex>` | browser, once per logical submission, reused on retry | submission |
| Concierge | `C-<chat_id>-<epoch ms>` | `Get Bot Session` | application cycle |
| Mini App | `sub_<32 lower hex>` | `sha256("miniapp:" + app_session_id)` | app session |

One event per route identity is still proven for the hard case: `IF Lead Already Sent` refuses the
handoff once the session's `lead_id` is non-empty, and `Parse Intake Response` sets `lead_id` only
on `intake_ok`, so a failed attempt keeps the cycle open and a retry reuses the **same** identity —
one event, retried. Route crossing is refused by the deployed `canonicalise()`.

**The authoritative Pipeline `request_id` contract is not redesigned by this document.** No public,
Mini App or Concierge identity contract changes. `lead_id` is still not a uniqueness authority;
`LEAD_ID UNIQUE AUTHORITY` remains POST-GO HARDENING (owner decision, 2026-08-31).

### 2.2 The owner finding, restated precisely

`C-<telegram_chat_id>-<epoch_ms>` **contains a Telegram chat id**. A chat id identifies a natural
person to anyone holding the bot, so the raw `request_id` is identifying/pseudonymous data — not an
opaque token. Revision 1 put that value inside the primary key and then declared the key non-PII and
retained forever. That was wrong, and it is withdrawn.

### 2.3 The durable representation

```
canonical_request_id  ──(supplied by the runtime, TRANSIENT — an argument, never a column)
        │
        ├─ validated against the route shape INSIDE the database function
        │
        └─ request_fingerprint = encode(sha256(convert_to(
                                   'finmentor:new_lead:v1:' || canonical_request_id, 'UTF8')), 'hex')
                │
                └─ dispatch_key = 'NEW_LEAD:' || request_fingerprint      (GENERATED ALWAYS)
```

* **Computed by the database, not by n8n.** `alerts.request_fingerprint(text)` is an `IMMUTABLE`
  function inside the approved migration. No caller supplies a fingerprint, and there is no
  parameter through which one could be supplied — the enqueue function takes the *raw* identifier
  and hashes it itself (gate 23).
* **The caller cannot choose the key.** `dispatch_key` is `GENERATED ALWAYS AS (...) STORED` from
  `request_fingerprint`; writing to it is a hard error, and `request_fingerprint` is only ever
  written by the function, which derives it (gate 24).
* **Domain-separated.** The `finmentor:new_lead:v1:` prefix means this fingerprint cannot be
  confused with, or replayed into, any other hash in the system (the Mini App's own
  `sha256("miniapp:" + app_session_id)`, or SYSTEM ALERT's `sa_<sha256(route+verdict+identity)>`).
* **Versioned.** `fingerprint_version smallint NOT NULL DEFAULT 1` exists so the derivation can be
  changed later without guessing which rows used which rule.
* **Raw `request_id` is not stored.** No column holds it, so no retention window applies to it, and
  no purge job has to remember it. It exists only in the memory of one function call.

### 2.4 What SHA-256 does and does not achieve — stated correctly

**This is data minimisation and pseudonymisation. It is not anonymisation, and it is not claimed to
be.** The fingerprint is derived by a public, unkeyed function, so anyone holding a candidate
identifier can confirm it by hashing it.

The residual, sized honestly rather than waved at: for Concierge, an attacker who has read the
outbox **and** already knows a target chat id can confirm whether that person submitted, and
approximately when, by hashing candidate `epoch_ms` values. A one-year window is ~3.15 × 10¹⁰
candidates — hours on commodity hardware. What the fingerprint *does* buy is real and is what the
owner asked for: the durable row no longer **discloses** a chat id to whoever reads it, and
enumeration without a target guess is not possible.

**Upgrade path, recorded not adopted:** `fingerprint_version = 2` would be
`HMAC-SHA256(pepper, canonical_request_id)` with the pepper held outside the table (Supabase Vault
or a server-side parameter), which defeats the confirmation attack. It is **not** proposed here
because it makes idempotency depend on key custody — losing the pepper destroys the ability to
recognise a replay, permanently — and that is an owner decision, not a schema detail. **OPEN,
tracked, not blocking.**

### 2.5 One thing this does not fix, stated plainly

Removing the raw identifier from Postgres does not remove it from the **Pipeline sheet**, where
`Build Pipeline Row` writes `request_id` durably and where §9 reconciliation reads it from. The
Concierge chat-id-derived identifier therefore still exists at rest in Google Sheets under whatever
retention that system has. That is outside this DDL and is not changed by it — recorded so the
report does not overclaim. **OPEN: Pipeline `request_id` retention is a separate owner decision.**

## 3. Schema and tables

Dedicated schema **`alerts`**. `public` holds exactly one table — `public.telegram_initdata_replays`,
the G5 replay ledger — and mixing a notification outbox into the schema that carries the
replay-defence authority is precisely the coupling to avoid.

| object | purpose |
|---|---|
| `alerts.new_lead_outbox` | the durable INTENT. One row per authoritative NEW LEAD. Written once; the only later write is the payload purge |
| `alerts.new_lead_delivery` | one row per (event, channel). High-churn: claims, attempts, failures |
| `alerts.retention_policy` | one row. The windows the cleanup functions read, including the **undecided** key horizon |

Two delivery rows rather than two columns, because that makes "an Email retry must never resend
Telegram" a **constraint** — the claim's `WHERE` matches one row and that row is one channel —
rather than a convention an `UPDATE` has to remember.

## 4. FORWARD DDL — revision 2

> **NOT APPLIED TO PRODUCTION.** Applied, reapplied and rolled back on a disposable
> non-production PostgreSQL 17.6 cluster only (§16). Idempotent throughout — proven, over a
> populated schema. Run the §8 precondition first.
> Requires PostgreSQL 13+ (`sha256()` is 11+, `gen_random_uuid()` in `pg_catalog` is 13+).
> Creates **no LOGIN role, no password, and no n8n credential.**

### 4.1 Ownership, roles, and the one privilege the migrator needs

```sql
-- ============================================================================
-- FINMENTOR — NEW LEAD ALERT OUTBOX          forward migration, v2
-- PRECONDITION: see §8. Do not run without owner approval.
-- ============================================================================
BEGIN;

-- ------------------------------------------------------------------- roles
-- All NOLOGIN. Group roles only: a later, dedicated DB login may be GRANTed one of
-- these. It must NOT be, and is not here, any G5 role or credential.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['alerts_owner','alerts_writer','alerts_dispatcher',
                           'alerts_reconciler','alerts_retention','alerts_audit'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOBYPASSRLS NOINHERIT', r);
    END IF;
  END LOOP;
END $$;

-- alerts_owner OWNS every object below. It is deliberately NOBYPASSRLS: the RLS exemption
-- in §4.7 comes from OWNERSHIP, not from a bypass attribute, so revoking ownership revokes
-- the exemption with it.
COMMENT ON ROLE alerts_owner IS
  'NOLOGIN. Owns the alerts schema, its tables, views and SECURITY DEFINER functions. '
  'Never granted to a runtime role. Never granted to, and never a member of, any G5 role.';

-- The migrator must be a member of alerts_owner to hand ownership over. This membership is
-- what future migrations will also need; it is granted explicitly rather than acquired by
-- accident, and it is listed in §11 so it is visible in every audit.
--
-- AMENDMENT 2.1-A (real-Postgres proof, §16). The grant is UNCONDITIONAL and deliberately so.
-- PostgreSQL 16+ automatically records a membership when a CREATEROLE migrator creates a role,
-- and that automatic grant carries admin_option = true but inherit_option = false and
-- set_option = false. pg_has_role(..., 'MEMBER') is TRUE for it, so a guard on 'MEMBER' skipped
-- the real grant -- and assigning ownership needs SET, which the automatic grant does not give.
-- The next statement then failed with 42501 "must be able to SET ROLE alerts_owner" for every
-- non-superuser migrator, which is exactly the Supabase `postgres` shape.
--
-- AMENDMENT 2.2-A (real-Postgres proof). The OPTIONS ARE NOW NAMED, and that is not decoration.
-- §4.7 hands the working membership back before COMMIT, so on every run after the first the
-- membership row already exists with set_option = false. A bare `GRANT role TO member` does NOT
-- update an existing membership -- PostgreSQL answers NOTICE "is already a member of role" and
-- changes nothing -- so the reapply, the rollback and the reapply-after-rollback ALL failed with
-- 42501 again until the options were spelled out. Named options update an existing grant.
-- INHERIT is needed for the privileges (DROP OWNED BY, and the schema drops in §5); SET is needed
-- to assign ownership. Both are revoked again in §4.7.
DO $$ BEGIN
  EXECUTE format('GRANT alerts_owner TO %I WITH INHERIT TRUE', current_user);
  EXECUTE format('GRANT alerts_owner TO %I WITH SET TRUE',     current_user);
END $$;

CREATE SCHEMA IF NOT EXISTS alerts AUTHORIZATION alerts_owner;
ALTER SCHEMA alerts OWNER TO alerts_owner;
COMMENT ON SCHEMA alerts IS
  'FINMENTOR notification outbox. Independent of public.telegram_initdata_replays (G5): no role '
  'granted here may read or write the G5 replay ledger, and no G5 role is granted anything here. '
  'No runtime role holds a table privilege in this schema — access is by EXECUTE only.';
```

### 4.2 The fingerprint function — the single point of derivation

```sql
-- The ONLY place a request fingerprint is computed. IMMUTABLE and STRICT so it is a pure
-- function of its input; PARALLEL SAFE because it touches nothing. Deliberately NOT granted
-- to any runtime role: the functions that need it are SECURITY DEFINER and run as the owner,
-- so exposing it would only create a hashing oracle with no operational purpose.
CREATE OR REPLACE FUNCTION alerts.request_fingerprint(p_request_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT encode(
           sha256(convert_to('finmentor:new_lead:v1:' || p_request_id, 'UTF8')),
           'hex')
$fn$;
ALTER FUNCTION alerts.request_fingerprint(text) OWNER TO alerts_owner;
COMMENT ON FUNCTION alerts.request_fingerprint(text) IS
  'SHA-256 over a domain-separated canonical request id. PSEUDONYMISATION / DATA MINIMISATION, '
  'NOT anonymisation: the derivation is public and unkeyed, so a party already holding a '
  'candidate identifier can confirm it. See docs 2.4. v2 (HMAC with an out-of-table pepper) '
  'is the recorded upgrade path and is NOT implemented.';
```

### 4.3 Tables

```sql
-- ---------------------------------------------------------------- the event
CREATE TABLE IF NOT EXISTS alerts.new_lead_outbox (
  -- The durable identity. THE RAW request_id IS NOT STORED — not here, not anywhere in alerts.*.
  request_fingerprint text     NOT NULL,
  fingerprint_version smallint NOT NULL DEFAULT 1,
  -- Derived, never supplied: the caller cannot choose the key, and the key cannot disagree
  -- with the fingerprint.
  dispatch_key    text GENERATED ALWAYS AS ('NEW_LEAD:' || request_fingerprint) STORED,

  event_type      text        NOT NULL DEFAULT 'NEW_LEAD',
  request_route   text        NOT NULL,
  lead_id         text        NOT NULL,
  schema_version  smallint    NOT NULL DEFAULT 1,
  settled_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  payload_json    jsonb       NOT NULL,
  payload_purged_at timestamptz,

  CONSTRAINT new_lead_outbox_pk PRIMARY KEY (dispatch_key),
  CONSTRAINT new_lead_outbox_fingerprint_uk UNIQUE (request_fingerprint),

  CONSTRAINT new_lead_outbox_fingerprint_ck CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT new_lead_outbox_fpver_ck       CHECK (fingerprint_version = 1),
  CONSTRAINT new_lead_outbox_event_type_ck  CHECK (event_type = 'NEW_LEAD'),
  CONSTRAINT new_lead_outbox_route_ck       CHECK (request_route IN ('public','concierge','miniapp')),
  CONSTRAINT new_lead_outbox_lead_id_ck     CHECK (lead_id <> '' AND length(lead_id) <= 64),

  -- ALLOWLIST, enforced in the database as well as in the function. An unknown key fails the
  -- insert rather than being stored and forgotten.
  --
  -- AMENDMENT 2.1-B (real-Postgres proof, §16). The revision-2 form used
  -- `NOT EXISTS (SELECT 1 FROM jsonb_object_keys(...))`. PostgreSQL rejects that outright:
  -- 0A000 "cannot use subquery in check constraint". The table could not be created at all,
  -- so the "enforced twice" claim was unbuilt. `jsonb - text[]` deletes the allowed keys and is
  -- an IMMUTABLE operator with no subquery: if anything is left over, a key was not on the list.
  CONSTRAINT new_lead_outbox_payload_allowlist_ck CHECK (
    jsonb_typeof(payload_json) = 'object'
    AND (payload_json - ARRAY['company','role','objective','situation','priority','zone',
                              'next_action','source','contact_channel','contact_value','lead_id'])
        = '{}'::jsonb
  ),
  CONSTRAINT new_lead_outbox_contact_channel_ck CHECK (
    payload_json->>'contact_channel' IS NULL
    OR payload_json->>'contact_channel' IN ('telegram','phone','email','none')
  ),
  -- A purged row carries NOTHING, not merely "no contact_value". The 30-day window covers the
  -- whole presentation payload, so the post-purge shape is a single, checkable value.
  CONSTRAINT new_lead_outbox_purge_ck CHECK (
    payload_purged_at IS NULL OR payload_json = '{}'::jsonb
  )
);
ALTER TABLE alerts.new_lead_outbox OWNER TO alerts_owner;

COMMENT ON TABLE alerts.new_lead_outbox IS
  'One row per AUTHORITATIVE NEW LEAD, written after Lead Intake''s Save to Pipeline succeeds. '
  'The row is the durable INTENT to notify; it is not a delivery record and never a lead record. '
  'It stores a SHA-256 fingerprint of the canonical request id, never the id itself.';
COMMENT ON COLUMN alerts.new_lead_outbox.request_fingerprint IS
  'sha256(''finmentor:new_lead:v1:'' || canonical_request_id), lower hex. Computed by '
  'alerts.request_fingerprint inside alerts.enqueue_new_lead. NEVER accepted from a caller. '
  'Pseudonymous, NOT anonymous — see docs 2.4.';
COMMENT ON COLUMN alerts.new_lead_outbox.dispatch_key IS
  'NEW_LEAD:<request_fingerprint>. GENERATED ALWAYS, so no writer can choose it.';
COMMENT ON COLUMN alerts.new_lead_outbox.payload_json IS
  'The approved NEW LEAD presentation snapshot, allowlisted by constraint. Contains ONE contact '
  'value, which may itself be a phone number, an email address or a Telegram handle depending on '
  'contact_channel. Purged to ''{}'' at the payload retention horizon. Never a raw webhook body, '
  'raw_json, draft envelope, initData, signature material or execution payload.';
COMMENT ON COLUMN alerts.new_lead_outbox.settled_at IS
  'When Lead Intake settled the lead (Save to Pipeline success), not when this row was written.';

CREATE INDEX IF NOT EXISTS new_lead_outbox_created_idx  ON alerts.new_lead_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS new_lead_outbox_lead_idx     ON alerts.new_lead_outbox (lead_id);
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

  CONSTRAINT new_lead_delivery_pk PRIMARY KEY (dispatch_key, channel),
  CONSTRAINT new_lead_delivery_fk FOREIGN KEY (dispatch_key)
    REFERENCES alerts.new_lead_outbox (dispatch_key) ON DELETE RESTRICT,

  CONSTRAINT new_lead_delivery_channel_ck CHECK (channel IN ('telegram','email')),
  CONSTRAINT new_lead_delivery_status_ck  CHECK (status IN
    ('PENDING','CLAIMED','SENT','RETRYABLE_FAILED','DELIVERY_UNKNOWN','PERMANENT_FAILED')),
  CONSTRAINT new_lead_delivery_attempts_ck CHECK (attempt_count >= 0 AND attempt_count <= 1000),
  CONSTRAINT new_lead_delivery_error_ck    CHECK (last_error_code IS NULL
                                                  OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,39}$'),
  CONSTRAINT new_lead_delivery_provider_len_ck CHECK (
    provider_message_id IS NULL OR length(provider_message_id) <= 512),

  -- STATE INVARIANTS, so an impossible row cannot be written by any worker.
  CONSTRAINT new_lead_delivery_sent_ck CHECK (
    status <> 'SENT' OR (sent_at IS NOT NULL AND claim_token IS NULL)),
  CONSTRAINT new_lead_delivery_claim_ck CHECK (
    (status = 'CLAIMED' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    OR (status <> 'CLAIMED' AND claim_token IS NULL)),
  CONSTRAINT new_lead_delivery_unknown_ck CHECK (
    status <> 'DELIVERY_UNKNOWN' OR attempt_count > 0),
  CONSTRAINT new_lead_delivery_provider_ck CHECK (
    provider_message_id IS NULL OR status IN ('SENT','DELIVERY_UNKNOWN'))
);
ALTER TABLE alerts.new_lead_delivery OWNER TO alerts_owner;

COMMENT ON TABLE alerts.new_lead_delivery IS
  'One row per (event, channel). Telegram and Email are SEPARATE ROWS, not columns: "a retry of '
  'Email must never resend Telegram" is then a constraint — the claim WHERE matches one row and '
  'that row is one channel — rather than a convention an UPDATE has to remember.';
COMMENT ON COLUMN alerts.new_lead_delivery.provider_message_id IS
  'PROVIDER-NEUTRAL and OPTIONAL. Recorded only if the provider returns one. Microsoft Graph '
  'sendMail answers 202 Accepted with no body and no id, so it will usually be NULL; no id is '
  'ever invented. Never a credential, never a URL, never a tenant or mailbox identifier.';

CREATE INDEX IF NOT EXISTS new_lead_delivery_claimable_idx
  ON alerts.new_lead_delivery (channel, next_attempt_at)
  WHERE status IN ('PENDING','RETRYABLE_FAILED');
CREATE INDEX IF NOT EXISTS new_lead_delivery_attention_idx
  ON alerts.new_lead_delivery (status, updated_at)
  WHERE status IN ('DELIVERY_UNKNOWN','PERMANENT_FAILED');
CREATE INDEX IF NOT EXISTS new_lead_delivery_claimed_idx
  ON alerts.new_lead_delivery (claimed_at) WHERE status = 'CLAIMED';

CREATE OR REPLACE FUNCTION alerts.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;
ALTER FUNCTION alerts.touch_updated_at() OWNER TO alerts_owner;

DROP TRIGGER IF EXISTS new_lead_delivery_touch ON alerts.new_lead_delivery;
CREATE TRIGGER new_lead_delivery_touch BEFORE UPDATE ON alerts.new_lead_delivery
  FOR EACH ROW EXECUTE FUNCTION alerts.touch_updated_at();

-- --------------------------------------------- the retention AND repair policy
-- One row. It exists so that every operational horizon in this schema is DATA the code reads,
-- not a constant compiled into it. Two of them are OWNER-APPROVED (payload 30 d, delivery
-- 180 d), one is an OWNER-APPROVED BUSINESS RULE (automatic repair 7 d), and two are
-- deliberately UNDECIDED (the key horizon, the DELIVERY_UNKNOWN horizon) — held as NULL with an
-- explicit status, so neither can quietly become "forever" and neither can quietly start
-- deleting.
--
-- AMENDMENT 2.2-B (owner decision). automatic_repair_days was `interval '7 days'` written into
-- the body of alerts.enqueue_new_lead. 7 days is approved, but a business policy inside a
-- CREATE FUNCTION body can only be changed by a migration -- so it moved here.
-- AMENDMENT 2.2-C (owner decision). The DELIVERY_UNKNOWN horizon is now recorded as pending
-- rather than merely absent from a WHERE clause.
CREATE TABLE IF NOT EXISTS alerts.retention_policy (
  singleton               boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  payload_retention_days  integer NOT NULL DEFAULT 30
                            CHECK (payload_retention_days BETWEEN 1 AND 3650),
  delivery_retention_days integer NOT NULL DEFAULT 180
                            CHECK (delivery_retention_days BETWEEN 1 AND 3650),
  -- OWNER-APPROVED BUSINESS RULE, 2026-09-01. Beyond this age an ordinary enqueue will NOT
  -- restore a missing delivery row: a NEW LEAD alert older than the window must not be
  -- resurrected and sent as if it were fresh. Only alerts.repair_new_lead_deliveries() -- the
  -- explicit reconciler authority -- may do so afterwards.
  automatic_repair_days   integer NOT NULL DEFAULT 7
                            CHECK (automatic_repair_days BETWEEN 1 AND 365),
  key_retention_days      integer CHECK (key_retention_days IS NULL OR key_retention_days >= 30),
  key_retention_status    text NOT NULL DEFAULT 'PENDING_LEGAL_PRIVACY_FINALISATION'
                            CHECK (key_retention_status IN ('PENDING_LEGAL_PRIVACY_FINALISATION',
                                                            'DECIDED_BOUNDED','DECIDED_INDEFINITE')),
  -- UNDECIDED, and deliberately so. A DELIVERY_UNKNOWN row is an unresolved question about
  -- whether the owner was notified; deleting it destroys the question rather than answering it.
  delivery_unknown_retention_days   integer
                            CHECK (delivery_unknown_retention_days IS NULL
                                   OR delivery_unknown_retention_days BETWEEN 1 AND 3650),
  delivery_unknown_retention_status text NOT NULL DEFAULT 'PENDING_OWNER'
                            CHECK (delivery_unknown_retention_status IN
                                   ('PENDING_OWNER','DECIDED_BOUNDED')),
  decided_at              timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_key_decision_ck CHECK (
       (key_retention_status = 'DECIDED_BOUNDED'    AND key_retention_days IS NOT NULL)
    OR (key_retention_status <> 'DECIDED_BOUNDED'   AND key_retention_days IS NULL)),
  CONSTRAINT retention_delivery_unknown_decision_ck CHECK (
       (delivery_unknown_retention_status = 'DECIDED_BOUNDED'
          AND delivery_unknown_retention_days IS NOT NULL)
    OR (delivery_unknown_retention_status = 'PENDING_OWNER'
          AND delivery_unknown_retention_days IS NULL))
);
ALTER TABLE alerts.retention_policy OWNER TO alerts_owner;
INSERT INTO alerts.retention_policy (singleton) VALUES (true) ON CONFLICT DO NOTHING;

COMMENT ON TABLE alerts.retention_policy IS
  'Single-row retention AND repair configuration. payload 30 d, delivery 180 d and automatic '
  'repair 7 d are OWNER-APPROVED and are DATA: changing any of them is an UPDATE, never a '
  'migration. key_retention_status starts at PENDING_LEGAL_PRIVACY_FINALISATION and '
  'key_retention_days is NULL: alerts.purge_new_lead_keys() refuses to run in that state. '
  'delivery_unknown_retention_status starts at PENDING_OWNER and '
  'alerts.purge_new_lead_deliveries() refuses to run if it ever changes without the deletion '
  'code being written. Nothing in this schema assumes "retain forever" — the two open horizons '
  'are undecided, and the code says so in both directions.';
COMMENT ON COLUMN alerts.retention_policy.automatic_repair_days IS
  'OWNER-APPROVED BUSINESS RULE (7). The age beyond which alerts.enqueue_new_lead will not '
  'recreate a missing delivery row. Read on every call; changing it changes behaviour with no '
  'schema or function migration. Beyond it, repair is alerts.repair_new_lead_deliveries() only.';
```

### 4.4 `alerts.enqueue_new_lead` — the transaction boundary

**This function is the entire write path.** The runtime calls it as **one statement**, so the
event and both delivery rows commit together or not at all. There is no `SELECT` → decide →
`INSERT` arbitration anywhere in n8n.

```sql
CREATE OR REPLACE FUNCTION alerts.enqueue_new_lead(
  p_request_route text,
  p_request_id    text,          -- RAW canonical identity. TRANSIENT. Never stored.
  p_lead_id       text,
  p_settled_at    timestamptz,
  p_payload       jsonb
) RETURNS TABLE (
  out_dispatch_key        text,
  out_request_fingerprint text,
  out_outcome             text,
  out_telegram_created    boolean,
  out_email_created       boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_fp text; v_key text; v_n integer;
  v_created boolean := false; v_tg boolean := false; v_mail boolean := false;
  v_settled timestamptz; v_nbad integer; v_outcome text;
  v_ev integer; v_tgn integer; v_mailn integer;
  -- Repair horizon. Beyond this a MISSING delivery row is not recreated automatically: a NEW
  -- LEAD alert older than the window must not be resurrected and sent as if it were fresh, and
  -- delivery rows are purged at 180 days (§12), so a blind repair would resend a year-old alert.
  -- Beyond-horizon repair is the reconciler's explicit function, not a side effect of enqueue.
  --
  -- AMENDMENT 2.2-B (owner decision). This was a CONSTANT interval of seven days, written into
  -- the function body. The WINDOW IS APPROVED; compiling it in was not. It is now read from
  -- alerts.retention_policy on every call, so changing an approved business policy is an UPDATE
  -- of one integer, not a function migration. The read is inside the same transaction as the
  -- write it governs, so a concurrent policy change cannot half-apply.
  v_repair_days integer;
BEGIN
  ---------------------------------------------------------------- 1. route
  IF p_request_route IS NULL OR p_request_route NOT IN ('public','concierge','miniapp') THEN
    RAISE EXCEPTION 'ALERTS_ROUTE_INVALID' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------- 2. canonical identity shape
  -- Validated HERE because the raw value is never stored and can therefore never be checked
  -- by a table constraint afterwards. The message NEVER echoes p_request_id: it is the very
  -- identifier this design exists to keep out of durable stores, and Postgres logs are durable.
  IF p_request_id IS NULL
     OR NOT (
          (p_request_route = 'public'    AND p_request_id ~ '^fmr_[0-9a-f]{32}$')
       OR (p_request_route = 'miniapp'   AND p_request_id ~ '^sub_[0-9a-f]{32}$')
       OR (p_request_route = 'concierge' AND p_request_id ~ '^C--?[0-9]{1,20}-[0-9]{10,16}$')
     ) THEN
    RAISE EXCEPTION 'ALERTS_REQUEST_ID_SHAPE_INVALID (route=%)', p_request_route
      USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------- 3. lead + time
  IF p_lead_id IS NULL OR p_lead_id = '' OR length(p_lead_id) > 64 THEN
    RAISE EXCEPTION 'ALERTS_LEAD_ID_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_settled_at IS NULL
     OR p_settled_at > now() + interval '5 minutes'
     OR p_settled_at < timestamptz '2025-01-01' THEN
    RAISE EXCEPTION 'ALERTS_SETTLED_AT_INVALID' USING ERRCODE = '22023';
  END IF;

  --------------------------------------------------- 4. allowlisted payload
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'ALERTS_PAYLOAD_NOT_OBJECT' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_nbad
    FROM jsonb_object_keys(p_payload) AS t(k)
   WHERE k NOT IN ('company','role','objective','situation','priority','zone',
                   'next_action','source','contact_channel','contact_value','lead_id');
  IF v_nbad > 0 THEN
    -- AMENDMENT 2.2-D (defect found in the revision-2.2 pass). Revision 2.1 echoed the offending
    -- KEY NAMES here, on the reasoning that "key names are safe to echo; values are not".
    -- They are not safe: a JSON key is a caller-controlled string, so {"C-123456789-1788000000000": 1}
    -- put a raw Concierge identity — the exact value this whole design exists to keep out of
    -- durable stores — into an error message. finmentor-prod runs log_min_error_statement = error,
    -- so that message and its statement reach a durable server log. Only the COUNT is reported
    -- now. The caller knows what it sent; the log does not need to.
    RAISE EXCEPTION 'ALERTS_PAYLOAD_KEY_FORBIDDEN (n=%)', v_nbad USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'contact_channel'
     AND p_payload->>'contact_channel' NOT IN ('telegram','phone','email','none') THEN
    RAISE EXCEPTION 'ALERTS_CONTACT_CHANNEL_INVALID' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------- 5. fingerprint and the key
  v_fp  := alerts.request_fingerprint(p_request_id);
  v_key := 'NEW_LEAD:' || v_fp;

  ------------------------------------------------ 5b. the repair policy, as data
  -- AMENDMENT 2.2-B. Read, never compiled in. If the policy row is missing the function REFUSES
  -- rather than falling back to a hard-coded default: a silent default is exactly how a business
  -- rule gets buried in SQL again.
  SELECT automatic_repair_days INTO v_repair_days
    FROM alerts.retention_policy WHERE singleton;
  IF v_repair_days IS NULL THEN
    RAISE EXCEPTION 'ALERTS_REPAIR_POLICY_MISSING' USING ERRCODE = 'P0002';
  END IF;

  ------------------------------------------------------- 6. the event, safely
  INSERT INTO alerts.new_lead_outbox
    (request_fingerprint, fingerprint_version, event_type, request_route,
     lead_id, schema_version, settled_at, payload_json)
  VALUES (v_fp, 1, 'NEW_LEAD', p_request_route,
          p_lead_id, 1, p_settled_at, p_payload)
  -- AMENDMENT 2.1-C (real-Postgres proof, §16). NO arbiter index is named. dispatch_key carries
  -- its own unique index — the PRIMARY KEY — perfectly correlated with request_fingerprint.
  -- Naming only the fingerprint made the speculative insert arbitrate on one index while the
  -- other still raised: a 6-way concurrent burst on one identity produced three bare
  -- 23505 "duplicate key value violates unique constraint new_lead_outbox_pk" errors instead of
  -- ALREADY_PRESENT. The final state was still 1 + 1 + 1, but the caller received an
  -- unclassified error — and §8 says the dispatcher can only classify on ALERTS_* prefixes,
  -- because the n8n Postgres node hides SQLSTATE. Unqualified ON CONFLICT DO NOTHING arbitrates
  -- on EVERY unique index. Never DO UPDATE: an event is not editable.
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_created := (v_n = 1);

  SELECT o.settled_at INTO v_settled
    FROM alerts.new_lead_outbox o WHERE o.request_fingerprint = v_fp;
  IF v_settled IS NULL THEN
    -- ON CONFLICT DO NOTHING lost a race with a transaction that then aborted. Ask the caller
    -- to retry rather than silently return "already present" for a row that does not exist.
    RAISE EXCEPTION 'ALERTS_ENQUEUE_RACE_RETRY' USING ERRCODE = '40001';
  END IF;

  --------------------------------------- 7 + 8. both delivery rows, same tx
  IF v_created OR v_settled >= now() - make_interval(days => v_repair_days) THEN
    INSERT INTO alerts.new_lead_delivery (dispatch_key, channel) VALUES (v_key, 'telegram')
      ON CONFLICT (dispatch_key, channel) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_tg := (v_n = 1);

    INSERT INTO alerts.new_lead_delivery (dispatch_key, channel) VALUES (v_key, 'email')
      ON CONFLICT (dispatch_key, channel) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_mail := (v_n = 1);

    -- CONVERGENCE, ASSERTED. If this transaction would commit anything other than exactly
    -- 1 event + 1 telegram + 1 email, it commits NOTHING. The crash window the owner named
    -- cannot exist as a committed state.
    SELECT count(*) INTO v_ev
      FROM alerts.new_lead_outbox WHERE request_fingerprint = v_fp;
    SELECT count(*) FILTER (WHERE channel = 'telegram'),
           count(*) FILTER (WHERE channel = 'email')
      INTO v_tgn, v_mailn
      FROM alerts.new_lead_delivery WHERE dispatch_key = v_key;
    IF v_ev <> 1 OR v_tgn <> 1 OR v_mailn <> 1 THEN
      RAISE EXCEPTION 'ALERTS_ENQUEUE_NOT_CONVERGENT (event=% telegram=% email=%)',
        v_ev, v_tgn, v_mailn USING ERRCODE = '25000';
    END IF;

    v_outcome := CASE WHEN v_created        THEN 'CREATED'
                      WHEN v_tg OR v_mail   THEN 'REPAIRED'
                      ELSE                       'ALREADY_PRESENT' END;
  ELSE
    v_outcome := 'EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW';
  END IF;

  RETURN QUERY SELECT v_key, v_fp, v_outcome, v_tg, v_mail;
END;
$fn$;
ALTER FUNCTION alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb) OWNER TO alerts_owner;

COMMENT ON FUNCTION alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb) IS
  'THE ENQUEUE TRANSACTION BOUNDARY. Validates the route identity, computes the fingerprint, '
  'derives the key, validates the allowlisted payload, and creates the event plus BOTH channel '
  'rows in ONE transaction. Convergent: calling it again for the same canonical request leaves '
  'exactly 1 event + 1 telegram + 1 email, and restores a missing delivery row without '
  'duplicating anything, within alerts.retention_policy.automatic_repair_days. Never updates an '
  'existing event. p_request_id is TRANSIENT: RAW REQUEST_ID PERSISTED IN ALERTS = NO — no '
  'column holds it and no error message echoes it. It DOES reach the server as a function '
  'argument, so it is subject to whatever the cluster''s statement and parameter logging is set '
  'to; see docs 2.6. This function cannot and does not claim otherwise.';

-- Comma-safe wrapper. The deployed n8n Postgres node splits queryReplacement on COMMAS BEFORE
-- resolving expressions, so a JSON payload — which is nothing but commas — cannot be passed as
-- a bound parameter. Base64 has no commas. This is the call the runtime uses.
CREATE OR REPLACE FUNCTION alerts.enqueue_new_lead_b64(
  p_request_route text, p_request_id text, p_lead_id text,
  p_settled_at timestamptz, p_payload_b64 text
) RETURNS TABLE (
  out_dispatch_key text, out_request_fingerprint text, out_outcome text,
  out_telegram_created boolean, out_email_created boolean
)
LANGUAGE sql VOLATILE
SET search_path = pg_catalog
AS $fn$
  SELECT * FROM alerts.enqueue_new_lead(
    p_request_route, p_request_id, p_lead_id, p_settled_at,
    convert_from(decode(p_payload_b64, 'base64'), 'UTF8')::jsonb);
$fn$;
ALTER FUNCTION alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text) OWNER TO alerts_owner;
```

**Atomicity, stated as a requirement on the caller as well as the function.** The body runs inside
the caller's transaction; invoked as a single `SELECT`, that is one implicit transaction and every
`RAISE` above rolls the whole thing back. The runtime must therefore call it as **one statement**
and must not wrap it in a multi-statement batch that could partially commit. Isolation level:
`READ COMMITTED` (the n8n default) is correct and is what the concurrency gate exercises — under
`REPEATABLE READ` or `SERIALIZABLE`, `ON CONFLICT DO NOTHING` can raise `40001` and the caller must
retry.

### 4.5 Dispatcher, reconciler and retention functions

```sql
-- ---------------------------------------------------------- claim (dispatcher)
CREATE OR REPLACE FUNCTION alerts.claim_new_lead_delivery(
  p_channel text, p_max_attempts integer DEFAULT 8
) RETURNS TABLE (
  out_dispatch_key text, out_channel text, out_claim_token uuid, out_attempt_count integer,
  out_lead_id text, out_request_route text, out_settled_at timestamptz, out_payload_json jsonb
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('telegram','email') THEN
    RAISE EXCEPTION 'ALERTS_CHANNEL_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT d.dispatch_key, d.channel
      FROM alerts.new_lead_delivery d
      JOIN alerts.new_lead_outbox   o ON o.dispatch_key = d.dispatch_key
     WHERE d.channel = p_channel
       AND d.status IN ('PENDING','RETRYABLE_FAILED')
       AND d.next_attempt_at <= now()
       AND d.attempt_count < p_max_attempts
       AND o.payload_purged_at IS NULL        -- a purged event cannot be rendered; §12, gate 31
     ORDER BY d.next_attempt_at
     FOR UPDATE OF d SKIP LOCKED
     LIMIT 1
  ), claimed AS (
    UPDATE alerts.new_lead_delivery d
       SET status = 'CLAIMED', claim_token = gen_random_uuid(), claimed_at = now(),
           attempt_count = d.attempt_count + 1
      FROM candidate c
     WHERE d.dispatch_key = c.dispatch_key AND d.channel = c.channel
       AND d.status IN ('PENDING','RETRYABLE_FAILED')
    RETURNING d.dispatch_key, d.channel, d.claim_token, d.attempt_count
  )
  SELECT c.dispatch_key, c.channel, c.claim_token, c.attempt_count,
         o.lead_id, o.request_route, o.settled_at, o.payload_json
    FROM claimed c JOIN alerts.new_lead_outbox o ON o.dispatch_key = c.dispatch_key;
END;
$fn$;
ALTER FUNCTION alerts.claim_new_lead_delivery(text,integer) OWNER TO alerts_owner;

-- ------------------------------------------------------- finalise (dispatcher)
CREATE OR REPLACE FUNCTION alerts.finalise_new_lead_delivery(
  p_dispatch_key text, p_channel text, p_claim_token uuid, p_outcome text,
  p_error_code text DEFAULT NULL, p_provider_message_id text DEFAULT NULL,
  p_retry_after interval DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_att integer; v_next timestamptz; v_n integer;
BEGIN
  IF p_outcome NOT IN ('SENT','RETRYABLE_FAILED','DELIVERY_UNKNOWN','PERMANENT_FAILED') THEN
    RAISE EXCEPTION 'ALERTS_OUTCOME_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL AND p_error_code !~ '^[A-Z][A-Z0-9_]{2,39}$' THEN
    RAISE EXCEPTION 'ALERTS_ERROR_CODE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_provider_message_id IS NOT NULL
     AND (length(p_provider_message_id) > 512 OR p_outcome NOT IN ('SENT','DELIVERY_UNKNOWN')) THEN
    RAISE EXCEPTION 'ALERTS_PROVIDER_ID_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT d.attempt_count INTO v_att FROM alerts.new_lead_delivery d
   WHERE d.dispatch_key = p_dispatch_key AND d.channel = p_channel
     AND d.claim_token = p_claim_token AND d.status = 'CLAIMED';
  IF v_att IS NULL THEN RETURN 'NOT_OWNED'; END IF;   -- no token, no write. Never "assume ours".

  v_next := now() + LEAST(
              GREATEST(COALESCE(p_retry_after,
                                make_interval(mins => (2 ^ LEAST(v_att, 6))::integer)),
                       interval '30 seconds'),
              interval '6 hours');

  UPDATE alerts.new_lead_delivery d
     SET status              = p_outcome,
         claim_token         = NULL,
         sent_at             = CASE WHEN p_outcome = 'SENT' THEN now() ELSE d.sent_at END,
         next_attempt_at     = CASE WHEN p_outcome = 'RETRYABLE_FAILED'
                                    THEN v_next ELSE d.next_attempt_at END,
         last_error_code     = CASE WHEN p_outcome = 'SENT' THEN NULL ELSE p_error_code END,
         provider_message_id = COALESCE(p_provider_message_id, d.provider_message_id)
   WHERE d.dispatch_key = p_dispatch_key AND d.channel = p_channel
     AND d.claim_token = p_claim_token AND d.status = 'CLAIMED';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 1 THEN 'OK' ELSE 'NOT_OWNED' END;
END;
$fn$;
ALTER FUNCTION alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval)
  OWNER TO alerts_owner;

-- A worker that died holding a claim may already have sent. The row therefore becomes
-- DELIVERY_UNKNOWN — NOT RETRYABLE_FAILED — and is never reclaimed automatically.
CREATE OR REPLACE FUNCTION alerts.expire_stale_claims(p_older_than interval DEFAULT interval '15 minutes')
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_older_than < interval '1 minute' THEN
    RAISE EXCEPTION 'ALERTS_EXPIRY_TOO_SHORT' USING ERRCODE = '22023';
  END IF;
  UPDATE alerts.new_lead_delivery
     SET status = 'DELIVERY_UNKNOWN', claim_token = NULL, last_error_code = 'CLAIM_EXPIRED'
   WHERE status = 'CLAIMED' AND claimed_at < now() - p_older_than;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
ALTER FUNCTION alerts.expire_stale_claims(interval) OWNER TO alerts_owner;

-- ---------------------------------------------------- attention (dispatcher/audit)
-- No payload. This is the SYSTEM ALERT feed, and it carries no PII.
CREATE OR REPLACE FUNCTION alerts.new_lead_attention()
RETURNS TABLE (out_dispatch_key text, out_channel text, out_status text, out_reason text,
               out_attempt_count integer, out_last_error_code text,
               out_request_route text, out_settled_at timestamptz, out_updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT d.dispatch_key, d.channel, d.status,
         CASE WHEN d.status = 'DELIVERY_UNKNOWN'                      THEN 'DELIVERY_UNKNOWN'
              WHEN d.status = 'PERMANENT_FAILED'                      THEN 'PERMANENT_FAILED'
              WHEN d.status = 'CLAIMED'                               THEN 'CLAIM_STUCK'
              ELSE 'UNDELIVERED_PAYLOAD_PURGED' END,
         d.attempt_count, d.last_error_code, o.request_route, o.settled_at, d.updated_at
    FROM alerts.new_lead_delivery d
    JOIN alerts.new_lead_outbox   o ON o.dispatch_key = d.dispatch_key
   WHERE d.status IN ('DELIVERY_UNKNOWN','PERMANENT_FAILED')
      OR (d.status = 'CLAIMED' AND d.claimed_at < now() - interval '15 minutes')
      OR (d.status IN ('PENDING','RETRYABLE_FAILED') AND o.payload_purged_at IS NOT NULL)
   ORDER BY d.updated_at;
$fn$;
ALTER FUNCTION alerts.new_lead_attention() OWNER TO alerts_owner;

-- ------------------------------------------------------------- reconciler
-- Deterministic presence check. Takes RAW Pipeline request ids transiently, hashes them by the
-- same contract, returns which are missing. Stores nothing. NO FUZZY MATCHING anywhere.
CREATE OR REPLACE FUNCTION alerts.new_lead_events_present(p_request_ids text[])
RETURNS TABLE (out_request_id text, out_request_fingerprint text, out_present boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT r.rid,
         alerts.request_fingerprint(r.rid),
         EXISTS (SELECT 1 FROM alerts.new_lead_outbox o
                  WHERE o.request_fingerprint = alerts.request_fingerprint(r.rid))
    FROM unnest(p_request_ids) AS r(rid)
   WHERE r.rid IS NOT NULL AND r.rid <> '';
$fn$;
ALTER FUNCTION alerts.new_lead_events_present(text[]) OWNER TO alerts_owner;

-- Beyond-horizon delivery repair. EXPLICIT, reconciler only — enqueue deliberately will not do
-- this by itself, because a delivery row missing because it was PURGED at 180 days must not be
-- silently recreated and resent.
CREATE OR REPLACE FUNCTION alerts.repair_new_lead_deliveries(p_dispatch_key text)
RETURNS TABLE (out_telegram_created boolean, out_email_created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_n integer; v_tg boolean := false; v_mail boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM alerts.new_lead_outbox WHERE dispatch_key = p_dispatch_key) THEN
    RAISE EXCEPTION 'ALERTS_EVENT_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  INSERT INTO alerts.new_lead_delivery (dispatch_key, channel) VALUES (p_dispatch_key, 'telegram')
    ON CONFLICT (dispatch_key, channel) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_tg := (v_n = 1);
  INSERT INTO alerts.new_lead_delivery (dispatch_key, channel) VALUES (p_dispatch_key, 'email')
    ON CONFLICT (dispatch_key, channel) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mail := (v_n = 1);
  RETURN QUERY SELECT v_tg, v_mail;
END;
$fn$;
ALTER FUNCTION alerts.repair_new_lead_deliveries(text) OWNER TO alerts_owner;

-- ------------------------------------------------------------- retention
CREATE OR REPLACE FUNCTION alerts.purge_new_lead_payloads()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_days integer; v_n integer;
BEGIN
  SELECT payload_retention_days INTO v_days FROM alerts.retention_policy WHERE singleton;
  UPDATE alerts.new_lead_outbox
     SET payload_json = '{}'::jsonb, payload_purged_at = now()
   WHERE payload_purged_at IS NULL
     AND settled_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
ALTER FUNCTION alerts.purge_new_lead_payloads() OWNER TO alerts_owner;

CREATE OR REPLACE FUNCTION alerts.purge_new_lead_deliveries()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_days integer; v_n integer; v_du_status text;
BEGIN
  SELECT delivery_retention_days, delivery_unknown_retention_status
    INTO v_days, v_du_status
    FROM alerts.retention_policy WHERE singleton;
  -- AMENDMENT 2.2-C (owner decision). The DELIVERY_UNKNOWN horizon is UNDECIDED, and this
  -- function refuses to run if that ever stops being true, because the deletion code for it does
  -- NOT exist. Without this, recording a decision would silently do nothing -- the pending
  -- horizon would become unbounded by implementation accident, which is exactly what the owner
  -- ruled out. The guard fails loudly instead, and whoever records the decision is told the
  -- sweep has not been written yet.
  IF v_du_status <> 'PENDING_OWNER' THEN
    RAISE EXCEPTION 'ALERTS_DELIVERY_UNKNOWN_HORIZON_NOT_IMPLEMENTED (status=%)', v_du_status
      USING ERRCODE = '0A000';
  END IF;
  -- TERMINAL rows only. A DELIVERY_UNKNOWN still awaiting an owner decision is never swept, and
  -- neither is a CLAIMED, PENDING or RETRYABLE_FAILED row: this deletes settled history, not
  -- outstanding work. The payload behind an unresolved DELIVERY_UNKNOWN is still purged at 30
  -- days by alerts.purge_new_lead_payloads(), so an unresolved delivery does NOT keep
  -- contact_value alive indefinitely (gate 58).
  DELETE FROM alerts.new_lead_delivery
   WHERE status IN ('SENT','PERMANENT_FAILED')
     AND updated_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
ALTER FUNCTION alerts.purge_new_lead_deliveries() OWNER TO alerts_owner;
COMMENT ON FUNCTION alerts.purge_new_lead_deliveries() IS
  'Deletes TERMINAL delivery rows (SENT, PERMANENT_FAILED) older than '
  'alerts.retention_policy.delivery_retention_days. DELIVERY_UNKNOWN RETENTION = PENDING OWNER: '
  'those rows are never automatically reclaimed, never automatically resent and never silently '
  'deleted while unresolved. If delivery_unknown_retention_status ever leaves PENDING_OWNER this '
  'function RAISES, because the sweep it would imply has not been written.';

-- The key horizon is a LEGAL/PRIVACY decision that has not been taken. This function exists so
-- the code path is designed and reviewable, and it REFUSES to run until the decision is recorded.
CREATE OR REPLACE FUNCTION alerts.purge_new_lead_keys()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE v_status text; v_days integer; v_n integer;
BEGIN
  SELECT key_retention_status, key_retention_days INTO v_status, v_days
    FROM alerts.retention_policy WHERE singleton;
  IF v_status <> 'DECIDED_BOUNDED' OR v_days IS NULL THEN
    RAISE EXCEPTION 'ALERTS_KEY_RETENTION_PENDING_LEGAL_PRIVACY_FINALISATION (status=%)', v_status
      USING ERRCODE = '0A000';
  END IF;
  DELETE FROM alerts.new_lead_outbox o
   WHERE o.settled_at < now() - make_interval(days => v_days)
     AND NOT EXISTS (SELECT 1 FROM alerts.new_lead_delivery d
                      WHERE d.dispatch_key = o.dispatch_key);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
ALTER FUNCTION alerts.purge_new_lead_keys() OWNER TO alerts_owner;
COMMENT ON FUNCTION alerts.purge_new_lead_keys() IS
  'KEY RETENTION = PENDING LEGAL / PRIVACY FINALISATION. Refuses to delete anything until '
  'alerts.retention_policy records DECIDED_BOUNDED with an explicit horizon. Deleting a key '
  'lets a replayed request mint a second business event — that is the trade-off the decision '
  'has to weigh, and this schema does not pre-empt it in either direction.';
```

### 4.6 Views for audit, and the grants

```sql
-- Audit reads through owner-owned views, so it needs no table privilege and no RLS policy,
-- and the outbox view does not expose the payload at all.
CREATE OR REPLACE VIEW alerts.new_lead_outbox_audit
  WITH (security_invoker = false) AS
  SELECT dispatch_key, request_fingerprint, fingerprint_version, event_type, request_route,
         lead_id, schema_version, settled_at, created_at, payload_purged_at,
         (payload_json ? 'contact_value')   AS has_contact_value,
         (payload_json <> '{}'::jsonb)      AS payload_present
    FROM alerts.new_lead_outbox;

CREATE OR REPLACE VIEW alerts.new_lead_delivery_audit
  WITH (security_invoker = false) AS
  SELECT * FROM alerts.new_lead_delivery;    -- carries no PII by construction

ALTER VIEW alerts.new_lead_outbox_audit   OWNER TO alerts_owner;
ALTER VIEW alerts.new_lead_delivery_audit OWNER TO alerts_owner;

-- ------------------------------------------------------------------ grants
REVOKE ALL ON SCHEMA alerts FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA alerts FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA alerts FROM PUBLIC;   -- functions grant EXECUTE to
                                                            -- PUBLIC at creation. This is the
                                                            -- statement that takes it back.
ALTER DEFAULT PRIVILEGES FOR ROLE alerts_owner IN SCHEMA alerts
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Supabase's built-in client roles, explicitly, if present. They are granted nothing.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA alerts FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alerts FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA alerts FROM %I', r);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA alerts
  TO alerts_writer, alerts_dispatcher, alerts_reconciler, alerts_retention, alerts_audit;

-- NO runtime role receives INSERT, UPDATE, DELETE or SELECT on any table. Not one.
GRANT EXECUTE ON FUNCTION alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb)
  TO alerts_writer, alerts_reconciler;
GRANT EXECUTE ON FUNCTION alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text)
  TO alerts_writer, alerts_reconciler;

GRANT EXECUTE ON FUNCTION alerts.claim_new_lead_delivery(text,integer)      TO alerts_dispatcher;
GRANT EXECUTE ON FUNCTION alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval)
                                                                            TO alerts_dispatcher;
GRANT EXECUTE ON FUNCTION alerts.expire_stale_claims(interval)              TO alerts_dispatcher;
GRANT EXECUTE ON FUNCTION alerts.new_lead_attention()  TO alerts_dispatcher, alerts_audit;

GRANT EXECUTE ON FUNCTION alerts.new_lead_events_present(text[])      TO alerts_reconciler;
GRANT EXECUTE ON FUNCTION alerts.repair_new_lead_deliveries(text)     TO alerts_reconciler;

GRANT EXECUTE ON FUNCTION alerts.purge_new_lead_payloads()   TO alerts_retention;
GRANT EXECUTE ON FUNCTION alerts.purge_new_lead_deliveries() TO alerts_retention;
GRANT EXECUTE ON FUNCTION alerts.purge_new_lead_keys()       TO alerts_retention;

GRANT SELECT ON alerts.new_lead_outbox_audit, alerts.new_lead_delivery_audit TO alerts_audit;

-- alerts.request_fingerprint is granted to NOBODY. The SECURITY DEFINER functions that need it
-- run as its owner. A runtime EXECUTE would only create a hashing oracle.
```

### 4.7 RLS — and the proof that the runtime still works

```sql
ALTER TABLE alerts.new_lead_outbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.new_lead_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts.retention_policy  ENABLE ROW LEVEL SECURITY;
-- ZERO policies, deliberately. And FORCE ROW LEVEL SECURITY is deliberately NOT set:
-- see the proof below. If anyone ever sets it, they must add policies in the same migration
-- or every function in this schema stops returning rows.

-- ------------------------------------ hand the migrator's working membership back
-- AMENDMENT 2.2-A (owner decision). Everything above needed the migrator to be able to SET ROLE
-- alerts_owner: CREATE SCHEMA ... AUTHORIZATION, every ALTER ... OWNER TO, and ALTER DEFAULT
-- PRIVILEGES FOR ROLE. Nothing below does. The membership existed for the migration interval and
-- ends with it, here, before COMMIT -- so a successful migration leaves NO standing ability to
-- act as the owner of this schema.
--
-- WHAT IS DELIBERATELY KEPT, AND WHY: the ADMIN OPTION only. On PostgreSQL 16+ a NOSUPERUSER
-- CREATEROLE migrator -- the finmentor-prod `postgres` shape, confirmed by read-only preflight --
-- can administer a role ONLY through a membership carrying admin_option. Revoking that too would
-- make this migration impossible to re-run and impossible to ROLL BACK without a superuser, and
-- finmentor-prod has no superuser available to us. ADMIN OPTION alone confers neither SET ROLE
-- nor inherited privileges: after this block the migrator CANNOT act as alerts_owner (gate 49).
-- It can grant itself the membership again -- but so can any CREATEROLE role, for any
-- non-superuser role, at any time. That is a property of CREATEROLE, not a hole in this schema,
-- and pretending otherwise would be the kind of claim this document exists to avoid.
DO $$
DECLARE v_me text := current_user;
BEGIN
  EXECUTE format('REVOKE SET OPTION FOR alerts_owner FROM %I', v_me);
  EXECUTE format('REVOKE INHERIT OPTION FOR alerts_owner FROM %I', v_me);
END $$;

-- POST-CONDITION, ASSERTED. A comment is not a proof: if the REVOKE above ever fails to bite --
-- a second membership row with a different grantor, a future PostgreSQL changing the rules --
-- this migration ABORTS rather than committing a standing privilege nobody approved. Checked for
-- every role the migration creates, not just alerts_owner.
DO $$
DECLARE v_me text := current_user; v_bad text;
BEGIN
  SELECT string_agg(r.rolname || '(set=' || m.set_option || ',inherit=' || m.inherit_option || ')',
                    ', ' ORDER BY r.rolname)
    INTO v_bad
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles g ON g.oid = m.member
   WHERE g.rolname = v_me
     AND r.rolname IN ('alerts_owner','alerts_writer','alerts_dispatcher',
                       'alerts_reconciler','alerts_retention','alerts_audit')
     AND (m.set_option OR m.inherit_option);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ALERTS_MIGRATOR_MEMBERSHIP_RESIDUAL (%)', v_bad USING ERRCODE = '42501';
  END IF;
END $$;

COMMIT;
```

**Why "RLS on, zero policies" does not make the runtime unusable — the mechanism, not a hope:**

| actor | how it reaches a row | RLS effect |
|---|---|---|
| `alerts_writer` / `dispatcher` / `reconciler` / `retention` | never touches a table. Calls a `SECURITY DEFINER` function, whose body executes **as `alerts_owner`** | `alerts_owner` **owns** the tables, and a table owner is exempt from RLS unless `FORCE ROW LEVEL SECURITY` is set. It is not set. Rows are returned |
| `alerts_audit` | `SELECT` on a view owned by `alerts_owner` with `security_invoker = false` | the view executes with the **view owner's** rights, i.e. the table owner's. Rows are returned |
| `anon`, `authenticated`, PostgREST, any future accidental `GRANT` | direct table access | **privileges revoked AND zero permissive policies.** Two independent locks, either of which alone is sufficient |

The exemption comes from **ownership**, which is why `alerts_owner` is created `NOBYPASSRLS`: no
role in this design holds a bypass attribute, and dropping ownership drops the exemption with it.

**Honest limits of this model, so nobody is surprised later:**
* Supabase's `service_role` carries `BYPASSRLS`, but **bypassing RLS is not a privilege** — with
  every `GRANT` revoked it still reaches nothing here. Gate 28 asserts this rather than assuming it.
* `postgres` / `supabase_admin` are superuser-adjacent in a Supabase project and can read anything.
  That is a property of the platform, not of this schema, and it is stated rather than hidden.

### 4.8 `SECURITY DEFINER` controls — every one of them, in one place

| control | how |
|---|---|
| owned by a dedicated non-login owner | `alerts_owner` — `NOLOGIN NOBYPASSRLS NOINHERIT`, never granted to a runtime role |
| fixed safe `search_path` | every function carries `SET search_path = pg_catalog`; every object reference is schema-qualified (`alerts.…`) |
| `EXECUTE` revoked from `PUBLIC` | `REVOKE ALL ON ALL FUNCTIONS … FROM PUBLIC` plus `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC` for anything added later |
| only the explicit runtime role gets `EXECUTE` | one `GRANT` per function per role, §4.6. `request_fingerprint` gets none |
| inputs validated inside the function | route, identity shape, `lead_id`, `settled_at`, payload type, payload key allowlist, `contact_channel`, outcome, error-code shape, provider-id length and legality, channel, expiry floor |
| no arbitrary dynamic SQL | there is no `EXECUTE` of a constructed statement in any runtime function. The only `format()`/`EXECUTE` uses are in the migration's `DO` blocks, over a **literal `ARRAY[...]` of role names**, quoted with `%I` |
| no PII in messages or logs | `p_request_id` is never echoed. Payload **key names** may appear in an error; payload **values** never do |

## 5. ROLLBACK DDL — revision 2

```sql
-- NOT APPLIED TO PRODUCTION. Proven on a disposable non-production cluster (§16): drops only
-- what the forward migration created, and it never touches public.*.
BEGIN;

-- AMENDMENT 2.2-A. The forward migration ends by handing the migrator's working membership back
-- (§4.7), so at this point the migrator holds ADMIN OPTION on alerts_owner and nothing else: no
-- SET, no INHERIT, and therefore not even USAGE on the alerts schema. Every DROP below needs
-- them. The membership is taken back for the length of this rollback and destroyed with the role
-- at the end -- and because the whole rollback is ONE transaction, a failure anywhere undoes this
-- grant too. Named options, for the reason given in §4.1: a bare GRANT would not update the
-- existing membership row and every DROP would fail 42501.
DO $$ BEGIN
  EXECUTE format('GRANT alerts_owner TO %I WITH INHERIT TRUE', current_user);
  EXECUTE format('GRANT alerts_owner TO %I WITH SET TRUE',     current_user);
END $$;

DROP VIEW IF EXISTS alerts.new_lead_delivery_audit;
DROP VIEW IF EXISTS alerts.new_lead_outbox_audit;

DROP FUNCTION IF EXISTS alerts.purge_new_lead_keys();
DROP FUNCTION IF EXISTS alerts.purge_new_lead_deliveries();
DROP FUNCTION IF EXISTS alerts.purge_new_lead_payloads();
DROP FUNCTION IF EXISTS alerts.repair_new_lead_deliveries(text);
DROP FUNCTION IF EXISTS alerts.new_lead_events_present(text[]);
DROP FUNCTION IF EXISTS alerts.new_lead_attention();
DROP FUNCTION IF EXISTS alerts.expire_stale_claims(interval);
DROP FUNCTION IF EXISTS alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval);
DROP FUNCTION IF EXISTS alerts.claim_new_lead_delivery(text,integer);
DROP FUNCTION IF EXISTS alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text);
DROP FUNCTION IF EXISTS alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb);

DROP TRIGGER IF EXISTS new_lead_delivery_touch ON alerts.new_lead_delivery;
DROP TABLE   IF EXISTS alerts.new_lead_delivery;
DROP TABLE   IF EXISTS alerts.new_lead_outbox;
DROP TABLE   IF EXISTS alerts.retention_policy;
DROP FUNCTION IF EXISTS alerts.request_fingerprint(text);
DROP FUNCTION IF EXISTS alerts.touch_updated_at();

DROP SCHEMA IF EXISTS alerts;          -- deliberately NOT CASCADE: refuses if anything survives

-- Roles last. DROP OWNED clears the privileges they were granted; they own nothing, because
-- everything was owned by alerts_owner and has just been dropped.
--
-- AMENDMENT 2.1-D (real-Postgres proof, §16). DROP OWNED BY requires the PRIVILEGES of the role,
-- and the membership PostgreSQL hands a CREATEROLE migrator automatically carries neither SET
-- nor INHERIT (see 2.1-A). Revision 2 also REVOKED alerts_owner from the migrator immediately
-- BEFORE calling DROP OWNED BY on it. Both failed with 42501 "permission denied to drop
-- objects" for any non-superuser migrator. GRANT first; DROP ROLE removes the membership by
-- itself, so the REVOKE was never needed.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['alerts_writer','alerts_dispatcher','alerts_reconciler',
                           'alerts_retention','alerts_audit'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE', r, current_user);
      EXECUTE format('DROP OWNED BY %I', r);
      EXECUTE format('DROP ROLE %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_owner') THEN
    EXECUTE format('GRANT alerts_owner TO %I WITH INHERIT TRUE', current_user);
    EXECUTE 'DROP OWNED BY alerts_owner';
    EXECUTE 'DROP ROLE alerts_owner';
  END IF;
END $$;

-- POST-CONDITION, ASSERTED (AMENDMENT 2.2-E, owner decision). The block above GRANTs itself the
-- membership PostgreSQL requires for DROP OWNED BY, and DROP ROLE then destroys the membership
-- along with the role. That is the ONLY reason the temporary grant does not outlive the rollback,
-- and "the only reason" is exactly the kind of thing that stops being true after an edit. So it
-- is checked, not narrated: if any alerts_* role survives, the migrator may still be holding a
-- membership in it, and this rollback ABORTS -- which, being one transaction, also undoes the
-- temporary GRANT it made. Rollback either completes with no role and no membership, or changes
-- nothing at all.
DO $$
DECLARE v_left text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_left
    FROM pg_roles
   WHERE rolname IN ('alerts_owner','alerts_writer','alerts_dispatcher',
                     'alerts_reconciler','alerts_retention','alerts_audit');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ALERTS_ROLLBACK_ROLE_RESIDUAL (%)', v_left USING ERRCODE = '42501';
  END IF;
END $$;

COMMIT;
```

**Rollback destroys delivery history and the idempotency keys.** After the dispatcher is live, a
rollback means a replayed request can mint a second business event. Roll back only before the
dispatcher exists, or export both tables first. Proven, not assumed: after the rollback the outbox
comes back empty (§16, gate REAPPLY AFTER ROLLBACK).

**`DROP OWNED BY` is per-database.** It clears the role's privileges in the *current* database
only. If an `alerts_*` role were ever granted something in a second database, `DROP ROLE` would
fail with `2BP01 … some objects depend on it`, and the whole rollback would abort — safely, but it
would abort. Observed during validation, when a role left over from an earlier test database still
held grants there. A Supabase project has one application database, so this is a caveat to know
rather than a defect to fix.

## 6. The payload allowlist, and the PII actually stored — **corrected**

The approved NEW LEAD model, from the deployed presenter (`renderNewLead`,
`n8n/src/lead-alerts/presenter.js`):

```
company · role · objective · situation · priority · zone · next_action · source
contact_channel · contact_value · lead_id
```

Eleven keys, enforced twice: by `new_lead_outbox_payload_allowlist_ck` and by the enqueue
function's own key check, so an unknown key fails before it reaches storage.

### 6.1 The wording correction the owner required

Revision 1 said "exactly one PII field = `contact_value`" and, separately, "`name`, `email` and
`phone` are absent". Read together those two sentences imply the stored contact is not an email
address or a phone number. **It can be exactly that.** The deployed `contactLine()` renders:

| `contact_channel` | what `contact_value` actually holds |
|---|---|
| `phone` | the client's **telephone number** |
| `email` | the client's **email address** |
| `telegram` | the client's **Telegram handle** (and the channel is usable even when the handle is absent) |
| `none` | nothing reachable — the alert renders «Не указана» |

**The correct statement, which replaces both sentences:**

> **Only one presentation contact value is stored.** It may itself be a phone number, an email
> address or a Telegram identifier, depending on `contact_channel`. **No additional contact field,
> no separate name field and no source-envelope field is stored.** It is subject to the 30-day
> purge.

"No source-envelope field" is precise here: `source` is a **form/tool slug** (`xray_extended`,
`miniscan`, `miniapp`, `contact`) that the presenter maps to a Russian label. It is not a referrer,
not a UTM set, not an IP address, not a user agent, and none of those are stored.

`contact_channel` remains a label (`telegram|phone|email|none`) and is not personal data on its own.

### 6.2 A stale comment found while checking this

The deployed presenter's own header above `renderNewLead` reads *"NO PHONE, NO EMAIL, NO FREE-TEXT
PASTE … The contact CHANNEL is carried because it changes how the owner plans the callback, and the
channel is not personal data"*, and its `model =` list omits `contactValue` — while the very next
lines call `contactLine(m.contactChannel, m.contactValue)`, which prints the number or the address.
The **code** is correct and matches the owner decision of 2026-08-30 ("ONE channel — the one the
client chose — with its value"); the **comment** predates that decision and now contradicts it.

Recorded, not corrected: this pass is documentation-only by instruction. It belongs with the `RI`
module's stale "CANDIDATE. NOT DEPLOYED." header as a comment-accuracy defect to be swept together.

### 6.3 Never stored — and an unknown key fails the CHECK, not merely a policy

Raw initData; Telegram signature / hash / auth_date; raw webhook body; `raw_json`; draft envelope;
internal execution payload; credentials; connection details; stack traces; **and, new in revision 2,
the raw canonical `request_id` itself.**

## 7. Delivery states, the atomic claim, and DELIVERY_UNKNOWN

| state | meaning | may be claimed? |
|---|---|---|
| `PENDING` | intent recorded, never attempted | yes, when `next_attempt_at <= now()` |
| `CLAIMED` | a worker owns it; token + `claimed_at` set | no |
| `SENT` | provider accepted; `sent_at` set, token cleared | **never** |
| `RETRYABLE_FAILED` | transient failure; `next_attempt_at` in the future | yes, after `next_attempt_at` |
| `DELIVERY_UNKNOWN` | the call may have succeeded and the acknowledgement was lost | **never, automatically** |
| `PERMANENT_FAILED` | the provider refused in a way retrying cannot fix | no |

The claim is `alerts.claim_new_lead_delivery` (§4.5): one statement, `FOR UPDATE SKIP LOCKED`,
with the status predicate repeated in the `UPDATE` so the window is closed. Zero rows means no work
— never "assume it is ours". `SENT` is unclaimable twice over: absent from the claim predicate, and
`new_lead_delivery_sent_ck` forbids a token on a `SENT` row. Finalising requires the claim token
**and** `status = 'CLAIMED'`, and returns `NOT_OWNED` rather than writing.

### 7.1 `DELIVERY_UNKNOWN` — the generic rule, unchanged and NOT provider-specific

**`DELIVERY_UNKNOWN` IS NOT AUTOMATICALLY RECLAIMABLE, on either channel.** It is set when the
provider call was issued and the outcome is unknown — a timeout, a dropped connection, or a worker
that died holding a claim (`alerts.expire_stale_claims`, which moves such a row to
`DELIVERY_UNKNOWN` and **not** to `RETRYABLE_FAILED`, precisely because the send may already have
happened).

* **Telegram — never auto-resend.** `sendMessage` is not idempotent and Telegram exposes no lookup
  by our key. Automatic recovery would be a coin flip between a silent miss and a duplicate owner
  alert. The row stays `DELIVERY_UNKNOWN` and surfaces through **SYSTEM ALERT** with its
  `dispatch_key`. The owner decides.
* **Email — identical today.** Microsoft 365 / Graph is *selected* (§14) but the provider-side
  correlation mechanism is **not determined**, and this document does not determine it. Nothing in
  the database grants a licence to promote `DELIVERY_UNKNOWN` automatically for email.

`alerts.new_lead_attention()` and `new_lead_delivery_attention_idx` make the set needing human
attention a cheap query rather than a scan.

## 8. Failure isolation — the lead stays successful

The enqueue call happens **after** `Save to Pipeline` succeeds, on a branch hanging off the settled
outcome, `waitForSubWorkflow: false` and `onError: continueRegularOutput` — the topology proven in
production by the SYSTEM ALERT deployment, and the shape that the `alwaysOutputData` class of
defects taught this system to use.

**If the lead commits and the enqueue fails: the lead remains successful.** The client still
receives `ok:true` with the canonical `lead_id`; the alert branch cannot reach the response, which
`Respond New Lead` has already sent. A successful lead is never converted into a customer-visible
failure because notification infrastructure is unavailable.

The missing intent is recovered twice over: an operational **SYSTEM ALERT** fires on the failed
call, and the §9 reconciler finds it deterministically. There is no distributed transaction between
Google Sheets and Postgres, and inventing one would make the lead depend on the alert.

**Two runtime hazards this system has already paid for, recorded so the dispatcher does not repay
them:**

1. The n8n Postgres node splits `queryReplacement` on **commas before resolving expressions**. A
   JSON payload is nothing but commas, so it cannot be passed as a bound parameter — hence
   `alerts.enqueue_new_lead_b64`, which takes base64 (no commas). The other four arguments are
   comma-free by construction (route enum, identity shapes, `lead_id` shape, ISO timestamp).
2. The node hides `SQLSTATE`; a database error arrives only as text on `json.message`. The
   dispatcher must therefore classify on the **stable `ALERTS_*` prefixes** raised above, not on a
   SQLSTATE it will never see. That is why every `RAISE` in §4 uses a fixed, greppable token.

**Precondition to run the forward DDL** (the safety check, not a claim):

```sql
SELECT
  (SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'alerts')            AS alerts_schema_exists,
  (SELECT count(*) FROM information_schema.tables   WHERE table_schema = 'public')           AS public_tables,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'telegram_initdata_replays')             AS g5_present,
  (SELECT count(*) FROM pg_roles WHERE rolname LIKE 'alerts\_%')                             AS alerts_roles,
  current_setting('server_version_num')::int >= 130000                                       AS pg13_or_later;
-- expected before migration: 0, 1, 1, 0, true
```

## 9. Reconciliation contract — deterministic, through the same hashing

Pipeline still stores the raw `request_id` (§2.5). The reconciler reads it there and passes it
**transiently** through the same database contract; nothing raw is written to `alerts.*`:

```
Pipeline request_id  →  alerts.new_lead_events_present(ARRAY[...])
                          → request_fingerprint = sha256('finmentor:new_lead:v1:' || request_id)
                          → compare against alerts.new_lead_outbox.request_fingerprint
                          → for each missing one: alerts.enqueue_new_lead(route, request_id, …)
```

**No fuzzy matching.** Rows with an empty `request_id` — legacy Pipeline rows predating the identity
contract — are **excluded and reported**, never matched by company or timestamp. Guessing which lead
an alert belongs to is how a notification reaches the wrong record.

Re-enqueue is the same convergent function the live path uses, so a reconciler racing the live path
creates no duplicate and needs no `ON CONFLICT` arbitration of its own. **Not built in this phase.**

## 10. Interaction with SYSTEM ALERT

Separate business authorities, deliberately. SYSTEM ALERT means *"an operation failed and needs
owner attention"*, keyed `sa_<sha256(route+verdict+identity)>`; NEW LEAD means *"a lead was
settled"*, keyed `NEW_LEAD:<request_fingerprint>`. They may later share delivery infrastructure;
they may never share an identity contract or a table. **The deployed SYSTEM ALERT workflow is not
modified by this phase, and this pass did not touch it.**

## 11. Validation queries — post-apply, when approved

**NOT EXECUTED AGAINST PRODUCTION.** Every one of these was executed against the non-production
cluster as part of the §16 run, and each answered as expected. Each is written so a wrong answer is
obvious rather than requiring interpretation.

```sql
-- 1. schema, tables and G5 untouched
SELECT table_name FROM information_schema.tables WHERE table_schema='alerts' ORDER BY 1;
SELECT count(*) AS g5_rows FROM public.telegram_initdata_replays;   -- unchanged by the migration

-- 2. THE RAW IDENTIFIER IS NOT STORED ANYWHERE.            expected: 0
SELECT count(*) AS raw_identity_columns
  FROM information_schema.columns
 WHERE table_schema='alerts'
   AND column_name IN ('request_id','chat_id','telegram_chat_id','canonical_request_id');

-- 3. the fingerprint and the key really are derived, not supplied
SELECT column_name, is_generated, generation_expression
  FROM information_schema.columns
 WHERE table_schema='alerts' AND table_name='new_lead_outbox'
   AND column_name IN ('dispatch_key','request_fingerprint');
-- expected: dispatch_key ALWAYS 'NEW_LEAD:'||request_fingerprint ; request_fingerprint NEVER
SELECT alerts.request_fingerprint('C-123456789-1788000000000')
     = encode(sha256(convert_to('finmentor:new_lead:v1:C-123456789-1788000000000','UTF8')),'hex')
  AS fingerprint_contract_holds;                            -- expected: true

-- 4. NO runtime role holds any table privilege.            expected: zero rows
SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema='alerts' AND grantee LIKE 'alerts\_%' AND grantee <> 'alerts_owner'
   AND table_name NOT IN ('new_lead_outbox_audit','new_lead_delivery_audit');

-- 5. every function is SECURITY DEFINER, owner-owned, with a pinned search_path
SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig
  FROM pg_proc p WHERE p.pronamespace='alerts'::regnamespace ORDER BY 1;
-- expected: owner=alerts_owner for all; prosecdef=true for every runtime function;
--           proconfig contains search_path=pg_catalog for all

-- 6. PUBLIC holds no EXECUTE anywhere in the schema.        expected: zero rows
SELECT p.proname
  FROM pg_proc p
 WHERE p.pronamespace='alerts'::regnamespace
   AND has_function_privilege('public', p.oid, 'EXECUTE');

-- 7. RLS is on, FORCE is off, and there are no policies
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relnamespace='alerts'::regnamespace AND relkind='r';   -- expected: t / f for each
SELECT count(*) AS policies FROM pg_policies WHERE schemaname='alerts';  -- expected: 0

-- 8. G5 isolation, both directions
SELECT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='telegram_initdata_replays'
   AND grantee LIKE 'alerts\_%';                              -- expected: zero rows
SELECT r.rolname AS member, g.rolname AS granted_role
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid=m.member JOIN pg_roles g ON g.oid=m.roleid
 WHERE r.rolname LIKE 'alerts\_%' OR g.rolname LIKE 'alerts\_%';
-- expected: ONLY the migrator's membership in alerts_owner (§4.1). Nothing else, in either column.

-- 9. no LOGIN role and no password were created here.       expected: zero rows
SELECT rolname FROM pg_roles WHERE rolname LIKE 'alerts\_%' AND (rolcanlogin OR rolbypassrls);

-- 10. retention policy is present and the key horizon is UNDECIDED
SELECT payload_retention_days, delivery_retention_days, key_retention_days, key_retention_status
  FROM alerts.retention_policy;      -- expected: 30, 180, NULL, PENDING_LEGAL_PRIVACY_FINALISATION

-- 11. ZERO provider-specific columns
SELECT column_name FROM information_schema.columns
 WHERE table_schema='alerts' AND table_name='new_lead_delivery' ORDER BY 1;
-- expected to contain provider_message_id and NOTHING named tenant/mailbox/graph/internet_message
```

## 12. Retention — owner decision recorded, key horizon deliberately open

| what | window | status | why |
|---|---|---|---|
| `payload_json` in full, including `contact_value` | **30 days** from `settled_at`, then set to `'{}'` and `payload_purged_at` stamped | **APPROVED FOR DESIGN** | the only PII stored; the alert is delivered and acted on long before |
| `alerts.new_lead_delivery` operational metadata | **180 days**, terminal rows only (`SENT`, `PERMANENT_FAILED`) | **APPROVED FOR DESIGN** | operational forensics; carries no PII. A `DELIVERY_UNKNOWN` awaiting an owner decision is never swept |
| the durable identity row — `request_fingerprint`, key, route, `lead_id`, timestamps | **UNDECIDED** | **KEY RETENTION = PENDING LEGAL / PRIVACY FINALISATION** | deleting it lets a replayed request mint a second business event; keeping it forever is not approved. The decision is a legal/privacy one, before customer activation |

**How the schema keeps that decision open rather than pre-empting it:**

* the horizon lives in `alerts.retention_policy`, as **data the cleanup code reads**, not as a
  constant compiled into a job;
* `key_retention_days` is `NULL` and `key_retention_status` is
  `PENDING_LEGAL_PRIVACY_FINALISATION`, and `alerts.purge_new_lead_keys()` **raises** in that state
  rather than deleting or silently doing nothing — an operator who runs it gets told why;
* the identity row is separable from the payload: purging the payload at 30 days does not touch the
  key, and a later bounded key horizon does not touch the payload rule. Either decision can change
  without a migration;
* nothing anywhere in this DDL says "retain forever". The word does not appear in a constraint, a
  default, a comment or a job.

**What the schema is after a purge (gate 31).** `payload_json = '{}'`, `payload_purged_at` set, the
`new_lead_outbox_purge_ck` constraint satisfied, the key and fingerprint intact, and every delivery
row's foreign key still valid. An undelivered row whose event has been purged is **excluded from the
claim** (it cannot be rendered) and appears in `alerts.new_lead_attention()` as
`UNDELIVERED_PAYLOAD_PURGED`, so it becomes an owner-visible item rather than a silent gap.

Retention jobs are **not scheduled** in this phase. The functions exist so the policy is reviewable;
nothing runs them.

## 13. QA plan — permanent gates

Gates 1–18 stand from revision 1. Gates 19–32 are added by the owner review. **None has been
executed: gates against real Postgres require the migration to be applied, which is exactly what has
not been approved yet.**

| # | gate | proof method |
|---|---|---|
| 1 | duplicate request → one event | real PG |
| 2 | same request via two route components → one outbox event | real PG |
| 3 | Telegram + Email → two independent delivery rows | real PG |
| 4 | a `SENT` Telegram row can never be reclaimed | **real PG** |
| 5 | a `SENT` Email row can never be reclaimed | **real PG** |
| 6 | `RETRYABLE_FAILED` is claimable only after `next_attempt_at` | real PG |
| 7 | concurrent claims → exactly one winner, the loser gets zero rows | **real PG, two sessions** |
| 8 | `DELIVERY_UNKNOWN` is never returned by the claim | **real PG** |
| 9 | an invalid channel is rejected by constraint | real PG |
| 10 | an invalid `event_type` is rejected by constraint | real PG |
| 11 | a malformed identity is rejected per route shape | real PG (now in the function, §4.4 step 2) |
| 12 | a forbidden payload key is rejected | real PG (constraint **and** function) |
| 13 | no client/anon/authenticated role can write either table | real PG |
| 14 | no `alerts_*` role can reach `public.telegram_initdata_replays` | real PG |
| 15 | no G5 role can reach `alerts.*` | real PG |
| 16 | the reconciler finds a missing event deterministically | real PG |
| 17 | the reconciler creates no duplicate | real PG |
| 18 | a failed enqueue leaves the lead successful and the response unchanged | offline harness, existing pattern |
| **19** | **`enqueue_new_lead` atomically creates event + BOTH channel rows** | real PG: call once → assert 1/1/1. Then inject a failure after the event insert (a temporary constraint-violating trigger on `new_lead_delivery`) → assert the transaction aborted and **zero** rows of any kind survive |
| **20** | **concurrent enqueue for the same request → exactly 1 + 1 + 1** | **real PG, two sessions**: both call `enqueue_new_lead` with the same identity, released together; assert exactly one `CREATED` and one `ALREADY_PRESENT`, and 1 event / 1 telegram / 1 email |
| **21** | **a missing historical delivery row is convergently repaired** | real PG: `DELETE` the email row, re-call `enqueue_new_lead` → `outcome='REPAIRED'`, `email_created=true`, still 1/1/1, and the telegram row is **untouched** (same `created_at`, same `attempt_count`, same `status`) |
| **22** | **a raw Concierge chat-id-derived identifier is not persisted** | (a) real PG: enqueue `C-123456789-…`, then assert no column in any `alerts` table, and no value in any text/jsonb column, contains `123456789`; (b) structural: validation query 11.2 returns 0; (c) `pg_stat_statements` / log inspection shows no `RAISE` echoing the identifier |
| **23** | **the fingerprint is computed server-side, never trusted from the caller** | structural: `enqueue_new_lead` has **no fingerprint parameter** — assert its `pg_get_function_arguments` exactly matches the five declared inputs; plus validation query 11.3, which recomputes the hash independently |
| **24** | **the caller cannot choose `dispatch_key`** | real PG: `INSERT INTO alerts.new_lead_outbox (dispatch_key, …)` as the owner → error `428C9` (cannot insert into generated column); and `alerts_writer` has no INSERT at all (gate 25) |
| **25** | **the runtime writer cannot directly mutate an existing event** | real PG as `alerts_writer`: `INSERT`, `UPDATE`, `DELETE`, `SELECT` on `alerts.new_lead_outbox` → **permission denied** on all four. Plus: `enqueue_new_lead` uses `ON CONFLICT DO NOTHING`, never `DO UPDATE` — assert by re-calling with a **different payload** and confirming the stored payload is unchanged |
| **26** | **the dispatcher cannot mutate the Outbox event** | real PG as `alerts_dispatcher`: `INSERT`/`UPDATE`/`DELETE` on `alerts.new_lead_outbox` → permission denied; and it holds `EXECUTE` on no function that writes the outbox |
| **27** | **the RLS / function / grant combination actually works** | **real PG, the gate that catches the silent-unusable trap**: as each of `alerts_writer`, `alerts_dispatcher`, `alerts_reconciler`, `alerts_retention`, `alerts_audit`, run that role's full happy path end to end and assert it returns **rows, not zero rows**. Plus validation query 11.7: RLS on, FORCE off, zero policies |
| **28** | **`PUBLIC` / `anon` / `authenticated` cannot execute the privileged functions** | real PG: `SET ROLE anon` (and `authenticated`, and a fresh unprivileged role) → every function in `alerts` → permission denied; validation query 11.6 returns zero rows. `service_role` included, to prove `BYPASSRLS` is not a privilege |
| **29** | **no G5 role can execute `alerts` functions** | real PG: `SET ROLE` to each role holding privileges on `public.telegram_initdata_replays` → every `alerts` function → permission denied |
| **30** | **no `alerts` role can access G5** | real PG: `SET ROLE` to each `alerts_*` role → `SELECT`/`INSERT` on `public.telegram_initdata_replays` → permission denied; validation query 11.8 returns zero rows both ways |
| **31** | **the 30-day payload purge leaves the durable identity internally consistent** | real PG: enqueue, backdate `settled_at`, run `purge_new_lead_payloads()` → assert `payload_json='{}'`, `payload_purged_at` set, constraint satisfied, fingerprint and key unchanged, delivery FKs valid, the row **not** claimable, and it surfaces as `UNDELIVERED_PAYLOAD_PURGED` in `new_lead_attention()` |
| **32** | **the Microsoft choice introduces ZERO Microsoft-specific columns** | structural, offline-capable: the column list of both tables is asserted against a frozen expected set; the only provider-shaped column is `provider_message_id`, and it is `NULL`-able. No `tenant`, `mailbox`, `graph`, `internet_message_id`, `client_id` or `oauth` column exists |

Gates 4, 5, 7, 8, 19, 20, 21, 27 and the role-boundary gates 25, 26, 28, 29, 30 **must** run against
real Postgres: `SKIP LOCKED`, partial-index semantics, `ON CONFLICT` under concurrency, RLS
ownership exemption and `GRANT` denial cannot be proven by a fixture.

Gates 23 and 32 are **structural and offline-capable** — they read the applied schema's catalog (or,
before apply, the DDL text) and need no data.

**Gates 19–32 are no longer specified-but-unwritten: they are implemented and PASSING against real
PostgreSQL**, together with 33–48, the §7 repair window and the retention rules — 39 gates, 442
assertions, 0 failures (`db/validation/`, §16). Gates 4, 5, 7, 8, 19, 20, 21, 25, 26, 27, 28, 29
and 30 ran on real Postgres with genuinely concurrent sessions and one login per runtime role,
because that is the only way they can be proven.

**Canonical repository QA state, unchanged by this pass: 64/64 gates, 2288 assertions, PASS.** No
n8n artifact and no `qa/` test was touched.

---

# 14. EMAIL PROVIDER — status corrected

```
EMAIL PROVIDER    = SELECTED
                    Microsoft 365 / Exchange Online
TRANSPORT TARGET  = Microsoft Graph / OAuth
RECIPIENT         = cfo@finmentor.md
PREFERRED SENDER  = alerts@finmentor.md
EMAIL CREDENTIAL  = PENDING OWNER SETUP
FORBIDDEN         = Basic Auth SMTP; a mailbox password stored in n8n
THIS PASS         = created no Microsoft credential, no app registration, no mailbox,
                    no permission grant, and sent no message
```

**Still pending, all of it owner/admin work:** the `alerts@finmentor.md` mailbox or shared mailbox;
the Microsoft Graph app / OAuth credential; a least-privilege send permission; domain and mailbox
verification (SPF, DKIM, DMARC under Exchange Online are *ordinarily* satisfied by the tenant's own
records — "ordinarily" is not "verified", so it stays a prerequisite, not an assumption).

## 14.1 The database does not change — and revision 2 kept it that way

**No DDL change follows from the provider decision. Not one column, constraint, index or grant.**
That was the point of designing it provider-neutral before the provider was known, and the decision
is the test of it. The only provider-shaped field is `provider_message_id text NULL`, opaque: no
tenant id, no mailbox id, no Graph request id, no `internetMessageId` column of its own. A future
move off Microsoft 365 changes the dispatcher and touches no table. **Gate 32 asserts this rather
than trusting it.**

`provider_message_id` **must stay nullable, and must stay optional.** Graph's
`POST /users/{id}/sendMail` answers **202 Accepted with no body and no message id**. A dispatcher
that expected an id from every provider would have been wrong on the very provider chosen — and
**no id is ever to be invented** when the provider does not return one. `NULL` is the correct and
expected value.

## 14.2 Least-privilege Graph permission — the shape, not the setup

Application permissions, client-credentials flow, **certificate preferred over a client secret**:

| permission | why | scope |
|---|---|---|
| `Mail.Send` | send as `alerts@finmentor.md` | **must** be constrained by an Application Access Policy to that one mailbox |

**The Application Access Policy is not optional.** `Mail.Send` as an *application* permission grants
send-as **any** mailbox in the tenant by default. Without `New-ApplicationAccessPolicy` restricting
the registration to `alerts@finmentor.md`, a lead-notification dispatcher would hold tenant-wide
send rights — a far larger grant than "notify the owner about a lead".

Delegated permissions are wrong here — there is no signed-in user — and any flow requiring a stored
mailbox password is excluded by owner decision.

*No read permission is requested here.* Revision 1 proposed one to support a recovery mechanism;
§14.3 defers that mechanism, so the permission that would serve it is not requested either. Asking
for a mailbox read scope before the mechanism that needs it is decided would be the wrong order.

## 14.3 Microsoft-specific `DELIVERY_UNKNOWN` — **NOT FINALISED, by instruction**

**The generic database rule stands and is the only rule in force:**

> `DELIVERY_UNKNOWN` = **NOT AUTOMATICALLY RECLAIMABLE**, on Telegram and on email alike.

Revision 1 sketched a draft-with-deterministic-`internetMessageId` flow and a Sent Items lookup.
**That is withdrawn as a design.** It is recorded here as a *candidate to investigate later*, with
its two unverified premises named — whether `internetMessageId` is writable on draft creation, and
whether Sent Items is filterable on it, neither of which this pass had a credential to test — and
nothing more. The reliable provider-side correlation/reconciliation mechanism for Microsoft Graph
**will be determined separately**, when there is a tenant to determine it against.

Until then: an email in doubt stays `DELIVERY_UNKNOWN` and reaches the owner through SYSTEM ALERT,
exactly as Telegram does. **Nothing about the database changes either way** — this is dispatcher
behaviour, and the deterministic `dispatch_key` that would make such a scheme possible exists for
idempotency reasons regardless.

## 14.4 Graph failure classification — proposed for the dispatcher phase

Not part of this DDL; recorded so the dispatcher has no room to invent a state. Every outcome maps
onto the six generic states and introduces no seventh.

| Graph outcome | state | note |
|---|---|---|
| `202 Accepted` | `SENT` | `sent_at` stamped; `provider_message_id` stays `NULL` — sendMail returns none |
| `429 Too Many Requests` | `RETRYABLE_FAILED` | `next_attempt_at` from `Retry-After`, passed as `p_retry_after`, never a guessed backoff |
| `503` / `504` / transport timeout | `RETRYABLE_FAILED` | the function's own capped backoff |
| network drop after the request was issued | `DELIVERY_UNKNOWN` | not auto-resent; SYSTEM ALERT |
| `401` / `403` — token or policy | `PERMANENT_FAILED` | a credential or Application Access Policy problem; retrying cannot fix it, and it must reach the owner |
| `400` — malformed message | `PERMANENT_FAILED` | a defect in our own rendering |
| mailbox not found / disabled | `PERMANENT_FAILED` | configuration |

`last_error_code` stores a **classified code** (`GRAPH_THROTTLED`, `GRAPH_AUTH_DENIED`,
`GRAPH_MAILBOX_INVALID`, …), never a raw provider error object, never a token, never a URL —
matching the `^[A-Z][A-Z0-9_]{2,39}$` constraint the finalise function enforces before writing.

## 14.5 Sender and deliverability

`alerts@finmentor.md` as sender with `Reply-To: cfo@finmentor.md` keeps a failed alert out of the
mailbox the owner reads and keeps replies where they belong. The premium HTML + plain-text NEW LEAD
email — inline styles, no remote fonts, no JavaScript, no tracking pixel — is designed, **not
implemented**.

---

# 15. FINAL REVISED REPORT

```
AUTHORITATIVE EVENT =
    Lead Intake "Save to Pipeline", SUCCESS OUTPUT [0], in the deployed
    FINMENTOR Lead Intake PREMIUM FINAL (QmIyEW2ZEqKregmN). Emit point: IF Internal (New).
    Unchanged from revision 1.

ENQUEUE TRANSACTION BOUNDARY =
    alerts.enqueue_new_lead(route, request_id, lead_id, settled_at, payload)
    — ONE SECURITY DEFINER function, called as ONE statement, therefore ONE transaction.
    Event + Telegram row + Email row commit together or not at all. No SELECT-decide-INSERT
    arbitration in n8n. Caller isolation level: READ COMMITTED.

RAW REQUEST_ID STORED = NO
    No column in alerts.* holds it. It is a function ARGUMENT, transient, never persisted,
    never logged, never echoed in an error message. Validation query 11.2 and gate 22 assert it.
    (It does still live in the Pipeline sheet — see below.)

REQUEST FINGERPRINT =
    encode(sha256(convert_to('finmentor:new_lead:v1:' || canonical_request_id,'UTF8')),'hex')
    Computed ONLY by alerts.request_fingerprint(), inside the database, inside the approved
    function. Never supplied by, and not suppliable by, any caller. fingerprint_version = 1.
    PSEUDONYMISATION / DATA MINIMISATION — NOT anonymisation, and not claimed to be.

DISPATCH KEY =
    'NEW_LEAD:' || request_fingerprint, GENERATED ALWAYS ... STORED.
    Contains the fingerprint, NOT the raw request_id. The caller cannot choose it.

CONCIERGE PII ISSUE = RESOLVED
    The blocking defect — a raw chat-id-derived identifier inside a permanently retained key —
    is gone: the identifier is not stored at all, and the key that is stored discloses no chat id.
    TWO RESIDUALS RECORDED, NEITHER BLOCKING, BOTH OPEN:
      (a) an unkeyed hash of a low-entropy identifier is CONFIRMABLE by someone who already holds
          a candidate chat id (docs 2.4). Upgrade path = HMAC with an out-of-table pepper,
          fingerprint_version 2. NOT adopted: it makes idempotency depend on key custody.
      (b) the raw request_id still exists at rest in the PIPELINE SHEET, which this DDL does not
          govern (docs 2.5). Pipeline retention is a separate owner decision.

EVENT + TELEGRAM + EMAIL ATOMICITY = ENFORCED, AND SELF-ASSERTED
    All three inserts are inside one function body. Before returning, the function COUNTS what it
    is about to commit and RAISES unless it is exactly 1 event + 1 telegram + 1 email — so the
    crash window "event exists, one delivery missing" cannot exist as a COMMITTED state.
    QA gates 19 and 20.

CONVERGENT ENQUEUE = YES
    Same canonical request, called again  → exactly 1 event, 1 telegram, 1 email.
    Event present, a delivery row missing → the missing row is restored, the surviving row is
      NOT touched (outcome REPAIRED). Gate 21.
    Never DO UPDATE: an existing event is never mutated, whatever payload is passed. Gate 25.
    Outcomes: CREATED | ALREADY_PRESENT | REPAIRED | EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW.
    The 7-day repair window exists so that a delivery row absent because it was PURGED at 180 days
    is not silently recreated and resent; beyond it, repair is the reconciler's explicit function.

RUNTIME ROLE MODEL =
    alerts_owner      NOLOGIN NOBYPASSRLS — owns schema, tables, views, functions. Not a runtime
                      role. Never granted to one.
    alerts_writer     EXECUTE enqueue_new_lead / enqueue_new_lead_b64. Nothing else.
    alerts_dispatcher EXECUTE claim / finalise / expire_stale_claims / new_lead_attention.
    alerts_reconciler EXECUTE enqueue_new_lead, new_lead_events_present,
                      repair_new_lead_deliveries.
    alerts_retention  EXECUTE the three purge functions. (Added beyond the four the owner listed:
                      without it, the payload purge would need an arbitrary UPDATE by some other
                      role, which is exactly what least privilege forbids.)
    alerts_audit      SELECT on two owner-owned views only — the outbox view exposes NO payload.
    All NOLOGIN group roles. NO password, NO LOGIN role, NO n8n credential created in this DDL.
    A later dedicated DB login may be GRANTed one of these. It must NOT reuse or inherit G5
    role/credential authority, and nothing here connects the two.

DIRECT TABLE DML BY WRITER = NONE
    No INSERT, UPDATE, DELETE — and no SELECT. EXECUTE on two functions, that is all.

DIRECT TABLE DML BY DISPATCHER = NONE
    No UPDATE anywhere, arbitrary or otherwise; no SELECT on either table. Delivery state changes
    only through claim/finalise, which require the claim token AND status='CLAIMED' and return
    NOT_OWNED rather than writing. It cannot touch the Outbox at all. Gate 26.

RLS EXECUTION MODEL =
    RLS ENABLED on all three tables. ZERO permissive policies. FORCE ROW LEVEL SECURITY
    DELIBERATELY NOT SET.
    Runtime roles never touch a table, so RLS never applies to them: they call SECURITY DEFINER
    functions whose bodies execute AS alerts_owner, and a TABLE OWNER IS EXEMPT FROM RLS unless
    FORCE is set. Audit reads owner-owned views with security_invoker = false, which execute with
    the view owner's rights — the same exemption.
    The exemption comes from OWNERSHIP, not from a bypass attribute: alerts_owner is NOBYPASSRLS.
    For anon / authenticated / PostgREST / any future accidental GRANT there are TWO independent
    locks: no privilege, and no policy. Gate 27 proves each role's happy path returns ROWS, so a
    "GRANT exists but RLS silently makes it unusable" design cannot ship undetected.
    Stated, not hidden: Supabase service_role has BYPASSRLS, but bypassing RLS is not a privilege
    and it is granted none; postgres/supabase_admin remain platform-level readers.

SECURITY DEFINER CONTROLS =
    owner            = alerts_owner, dedicated, NOLOGIN, never a runtime role
    search_path      = pg_catalog, pinned via SET on every function; all references schema-qualified
    PUBLIC           = EXECUTE revoked on all functions, plus ALTER DEFAULT PRIVILEGES for future ones
    grants           = one explicit GRANT per function per role; request_fingerprint granted to NOBODY
    input validation = inside the function: route, per-route identity shape, lead_id, settled_at
                       bounds, payload type, payload key allowlist, contact_channel, outcome,
                       error-code shape, provider-id length and legality, channel, expiry floor
    dynamic SQL      = none in any runtime function. The migration's only EXECUTE/format() runs over
                       a literal ARRAY of role names, quoted with %I
    logging          = the raw identifier is never echoed; payload KEY NAMES may appear in an error,
                       payload VALUES never do

PAYLOAD PII =
    ONE presentation contact value — payload_json->>'contact_value'. It MAY ITSELF BE a phone
    number, an email address or a Telegram identifier, depending on contact_channel
    (telegram|phone|email|none). NO additional contact field, NO separate name field, NO
    source-envelope field (no referrer, UTM, IP or user agent) is stored. `source` is a form/tool
    slug. Eleven allowlisted keys, enforced by CHECK and by the function; an unknown key fails the
    insert. Revision 1's "name, email and phone are absent" wording is WITHDRAWN as misleading.

PAYLOAD RETENTION = 30 DAYS from settled_at, then payload_json = '{}' and payload_purged_at stamped.
    APPROVED FOR DESIGN. Constraint-checked; gate 31 proves the durable structure stays consistent.

DELIVERY METADATA RETENTION = 180 DAYS, terminal rows only (SENT, PERMANENT_FAILED).
    APPROVED FOR DESIGN. A DELIVERY_UNKNOWN awaiting an owner decision is never swept.

KEY RETENTION = PENDING LEGAL / PRIVACY FINALISATION
    key_retention_days IS NULL; key_retention_status = 'PENDING_LEGAL_PRIVACY_FINALISATION'.
    alerts.purge_new_lead_keys() RAISES in that state rather than deleting or silently no-op-ing.
    The horizon is DATA in alerts.retention_policy, not a constant in a job, so the decision can be
    taken later without a migration and in either direction. No "retain forever" assumption is baked
    into any constraint, default, comment or cleanup path.

EMAIL PROVIDER   = SELECTED — Microsoft 365 / Exchange Online, transport target Microsoft Graph /
                   OAuth, recipient cfo@finmentor.md, preferred sender alerts@finmentor.md.
EMAIL CREDENTIAL = PENDING OWNER SETUP — mailbox, app registration, least-privilege send permission
                   with a mandatory Application Access Policy, and domain/mailbox verification are
                   all outstanding. NO Microsoft credential was created by this pass.
                   Microsoft-specific DELIVERY_UNKNOWN semantics: NOT FINALISED, by instruction.
                   provider_message_id stays optional and NULL-able; no Graph id is ever invented.

FORWARD DDL CHANGES =
    + alerts_owner and alerts_retention roles; all six roles NOLOGIN, NOBYPASSRLS
    + explicit ownership of schema, tables, views and functions by alerts_owner
    + alerts.request_fingerprint(text) — IMMUTABLE, domain-separated SHA-256, granted to nobody
    ~ new_lead_outbox: request_id column REMOVED; request_fingerprint + fingerprint_version added;
      dispatch_key now generated from the fingerprint; per-route shape CHECK moved into the
      function (the raw value is no longer there to check); purge CHECK tightened to payload = '{}'
    + alerts.retention_policy — the single-row, undecided-key-horizon policy
    + alerts.enqueue_new_lead(...) — THE transaction boundary, convergent, self-asserting
    + alerts.enqueue_new_lead_b64(...) — comma-safe entry point for the n8n Postgres node
    + alerts.claim_new_lead_delivery / finalise_new_lead_delivery / expire_stale_claims
    + alerts.new_lead_attention / new_lead_events_present / repair_new_lead_deliveries
    + alerts.purge_new_lead_payloads / purge_new_lead_deliveries / purge_new_lead_keys
    + alerts.new_lead_outbox_audit and new_lead_delivery_audit views (security_invoker = false)
    + new_lead_delivery_claimed_idx, provider-id length CHECK
    − ALL table-level GRANTs to runtime roles (INSERT/SELECT/UPDATE) — removed entirely
    ~ RLS: unchanged in being enabled with zero policies, now with FORCE explicitly NOT set and the
      execution model proven rather than asserted
    + explicit REVOKE from PUBLIC and from anon / authenticated / service_role

ROLLBACK DDL CHANGES =
    Extended to drop every function by signature, both views, the retention_policy table and both
    new roles, with DROP OWNED before each DROP ROLE and the migrator's alerts_owner membership
    revoked. DROP SCHEMA remains non-CASCADE so it refuses if anything survives. It never touches
    public.*.

VALIDATION CHANGES =
    11 queries, up from 6. New: raw-identifier-absent (expected 0); fingerprint contract recomputed
    independently; NO table privilege for any runtime role; every function SECURITY DEFINER,
    owner-owned, search_path pinned; PUBLIC holds no EXECUTE; RLS on / FORCE off / zero policies;
    G5 isolation in BOTH directions including pg_auth_members; no LOGIN and no BYPASSRLS role
    created; retention policy present with the key horizon UNDECIDED; zero provider-specific
    columns.

QA =
    Gates 1-18 retained. Gates 19-32 ADDED, each with its proof method (§13).
    NONE OF 19-32 HAS BEEN EXECUTED — they require the migration to be applied, which is what has
    not been approved. Gates 4,5,7,8,19,20,21,25,26,27,28,29,30 must run on REAL POSTGRES,
    20 and 7 with two concurrent sessions; 23 and 32 are structural and offline-capable.
    Repository QA unchanged by this pass: 64/64 gates, 2288 assertions, PASS.

DDL REVIEW = PASS
    All four blocking corrections are addressed in the DDL itself, not in prose: raw identifier
    removed from storage, atomicity made a single database transaction with a self-assertion,
    direct table DML removed from every runtime role with the RLS execution model proven, and the
    key-retention horizon left undecided in data. Both status corrections applied.

NON-PRODUCTION VALIDATION = PASS  (revision 2.1, see §16)
    Real PostgreSQL 17.6, non-superuser migrator, one login per runtime role, genuinely concurrent
    sessions. 39 gates, 442 assertions, 0 failures. FOUR real DDL defects were found by running it;
    three of them made the migration or its rollback impossible to run at all. All four amended and
    re-proven from a clean database.

READY FOR OWNER DDL APPROVAL = YES, FOR THE PRODUCTION DDL DECISION — NOT AS THE DECISION
    YES — revision 2.1 is ready to be PUT to the owner for production approval. Gates 19-48 pass
         on real Postgres; apply, idempotent reapply, rollback and reapply-after-rollback all pass.
    NO  — nothing is applied to finmentor-prod on the strength of that. Still owed, and inputs to
         the separate production decision:
             (a) the REQUIRES NON-PROD SUPABASE list (§16.1) — PostgREST exposure, the real
                 anon/authenticated default-privilege baseline, pooler SET ROLE, pg_stat_statements;
             (b) log_statement / log_min_duration_statement on the project: the raw identifier DOES
                 reach the server log under statement logging (§16.6). Not a schema defect, but a
                 durable store, and an operational precondition;
             (c) REPAIR WINDOW = PENDING OWNER — 7 days is a literal in SQL, not policy data;
             (d) DELIVERY_UNKNOWN maximum retention = PENDING OWNER — nothing sweeps those rows;
             (e) fingerprint_version 2 (HMAC + pepper) — accept the residual, or take the key-custody
                 trade-off;
             (f) Pipeline sheet raw request_id retention — governed elsewhere, unchanged by this DDL.
         KEY RETENTION remains PENDING LEGAL / PRIVACY FINALISATION either way; it does not block
         applying the schema, because the schema does not assume an answer.

NOT DONE, BY INSTRUCTION  (as of the review; superseded on the first line only — see below):
    nothing applied to finmentor-prod · no production schema or role created · no workflow deployed
    · no n8n credential created · no Microsoft Graph credential created · no Telegram or Email sent
    · G5 untouched · SYSTEM ALERT untouched · cycle projection untouched · customer production not
    activated.

PRODUCTION DDL APPLIED = 2026-09-01, revision 2.2, ACCEPTED PASS
    Owner approval was given separately and revision 2.2 was applied to finmentor-prod.
        COMMIT           3182ff98e71098d7af977589cf271ee9fd4e52f2
        SHA256           b7e35dcbebe96e82d011ad88563a405cc7be1d462fcf4bcc8a40969a36af39cb
        LEDGER           20260901171454_new_lead_alert_outbox
        RESULT           OUTBOX PRODUCTION DDL = PASS
                         OUTBOX DATABASE FOUNDATION = READY
    Every other line of NOT DONE still holds: no runtime login, no n8n credential, no Microsoft
    Graph credential, no workflow, no schedule, no Telegram or Email sent, G5 byte-identical before
    and after, cycle projection untouched, customer production NOT activated. The database is
    dormant: the schema exists and nothing can call it.

    Three production-only findings, and one runtime precondition that is NOT satisfied, are
    recorded in docs/NEW_LEAD_ALERT_OUTBOX_PRODUCTION_APPLY.md. The first finding CORRECTS a claim
    in the non-production record: on finmentor-prod the migrator CAN read alerts data, because
    postgres inherits pg_read_all_data from the Supabase platform. It still cannot SET ROLE
    alerts_owner, cannot EXECUTE any alerts function, and cannot write.
```

---

# 16. NON-PRODUCTION VALIDATION RECORD

Executed 2026-08-31 under the owner authorisation *OUTBOX REVISION 2 NON-PRODUCTION VALIDATION*.

**The full record — environment, the four defects with their exact errors, every gate, the
REQUIRES NON-PROD SUPABASE list, the log-exposure finding and everything still PENDING OWNER —
is [`docs/NEW_LEAD_ALERT_OUTBOX_NONPROD_VALIDATION.md`](NEW_LEAD_ALERT_OUTBOX_NONPROD_VALIDATION.md).**
The section numbers referenced from the amendments above (§16.1, §16.6 …) are that document's.

```
NON-PROD DATABASE = fm_outbox_nonprod, disposable local cluster, loopback only, synthetic data only
POSTGRES VERSION  = 17.6  (exact major.minor match with finmentor-prod)
MIGRATOR          = NOSUPERUSER CREATEROLE LOGIN — the Supabase "postgres" shape, asserted
GATES             = 39 gates, 442 assertions, 0 failures
DEFECTS FOUND     = 4  (2.1-A, 2.1-B, 2.1-C, 2.1-D — see the table at the top of this document)
PRODUCTION        = NOT APPLIED
```

Reproduce it: `db/validation/README.md`. The migration files are generated from this document —
`node db/validation/extract-migration.mjs` and `git diff` must be empty.
