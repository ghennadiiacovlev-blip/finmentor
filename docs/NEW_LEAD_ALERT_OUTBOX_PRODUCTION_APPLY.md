# NEW LEAD ALERT OUTBOX — PRODUCTION DDL APPLY RECORD

**Status: `OUTBOX PRODUCTION DDL = PASS`. `OUTBOX DATABASE FOUNDATION = READY`.**

Executed 2026-09-01 on `finmentor-prod` under the owner authorisation
*OWNER CONFIRMATION — EXECUTE THE ALREADY APPROVED PRODUCTION DDL APPLY*, and accepted by the owner
the same day as `PRODUCTION OUTBOX DDL APPLY = ACCEPTED PASS`.

This is the record of the **one** production migration call that was made. It is also the record of
three things that only production could show, one of which **corrects a claim made in the
non-production validation document**.

The database is **dormant**. The schema exists; nothing can call it. There is no login, no
credential, no workflow, no schedule, and no message has been sent on any channel.

---

## 1. The exact production migration

```
REVISION                  = 2.2
COMMIT                    = 3182ff98e71098d7af977589cf271ee9fd4e52f2
MIGRATION FILE            = db/migrations/0001_new_lead_alert_outbox.up.sql
MIGRATION SHA256          = b7e35dcbebe96e82d011ad88563a405cc7be1d462fcf4bcc8a40969a36af39cb
ROLLBACK FILE SHA256      = 92c386a20bdf2c35cd966d7dd7d6f9b8f732543ece3c7ffeebee2767e6b8680d
SUPABASE MIGRATION LEDGER = 20260901171454_new_lead_alert_outbox
RESULT                    = PASS
```

**One call, one tool: `apply_migration`.** The migration was not split, not modified, not
regenerated into a different artifact, and `execute_sql` was not used to apply any part of it.

### Preconditions, verified before the call

| gate | result |
|---|---|
| local HEAD = remote HEAD | `3182ff98…4e52f2` = `origin/feat/miniapp-b21c-live-prereqs` |
| working tree clean | clean, before and after regeneration |
| migration regenerated from the design document | `node db/validation/extract-migration.mjs` → `git diff` **empty** |
| SHA256 recorded | as above; 48 481 bytes, LF-only |
| fresh read of `finmentor-prod` | `postgres`, **NOSUPERUSER**, CREATEROLE, BYPASSRLS, PostgreSQL **17.6** — the exact role and version shape the harness proved against |
| `alerts` schema absent | 0 |
| all `alerts_*` roles absent | none |
| G5 pre-state frozen | 8 rows, 4 columns, sole `public` base table; catalog md5 `950cc69b1b480fdef6c4174aafc0721f` over 19 facts |

### Atomicity

The migration is a single `BEGIN … COMMIT`. There was no error, and therefore **no partial apply
surface**: had any statement failed, the transaction would have committed nothing.

```
APPLY         = SUCCESS
PARTIAL APPLY = NONE
```

### What landed is the pinned artifact, proven — not asserted

The apply necessarily passed the SQL through a tool call rather than piping the file directly, so
fidelity was **proven after the fact rather than assumed**:

* all **13** function bodies in `pg_proc.prosrc` md5-match the bodies extracted from
  `0001_new_lead_alert_outbox.up.sql`, **byte for byte**;
* all **23** explicitly named constraints are present in production under their exact names
  (the 9 further constraints on `alerts.retention_policy` are PostgreSQL's auto-generated names for
  that table's inline column `CHECK`s and its primary key).

Production holds the pinned artifact, not an equivalent of it.

---

## 2. Post-apply structural validation

Every line below is a fresh read of `finmentor-prod` after `COMMIT`.

```
ALERTS SCHEMA  = PRESENT, owned by alerts_owner
ALERTS ROLES   = 6 — alerts_owner, alerts_writer, alerts_dispatcher, alerts_reconciler,
                 alerts_retention, alerts_audit
                 ALL: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT
TABLES         = 3 tables + 2 views + 10 indexes + 1 trigger, all owned by alerts_owner
FUNCTIONS      = 13, all owned by alerts_owner, all SET search_path = pg_catalog
                 10 SECURITY DEFINER; 3 SECURITY INVOKER by design
                 (request_fingerprint, enqueue_new_lead_b64, touch_updated_at)
RLS            = ENABLED on all 3 tables, FORCE off, ZERO policies — exactly as designed
PUBLIC EXECUTE = NONE — no PUBLIC entry survives in any function ACL
                 alerts.request_fingerprint is granted to NOBODY but its owner
```

### Runtime privilege shape

**No runtime role holds a single table privilege.** The table ACLs name only `alerts_owner`. The
five runtime roles hold `USAGE` on the schema and `EXECUTE` on their own functions, nothing else;
`alerts_audit` additionally holds `SELECT` on the two owner-owned audit views, which is how audit
reads without a table grant and without an RLS policy.

### `anon` / `authenticated` / `service_role`

```
ANON / AUTHENTICATED ACCESS = NONE
```

All three are **false** on schema `USAGE`, on every table, on both views and on every function.
`service_role` carries `BYPASSRLS` and still reaches nothing — which is the point: **BYPASSRLS is
not a privilege.** Without `USAGE` on the schema there is nothing to bypass.

### PostgREST

```
POSTGREST EXPOSURE = NOT EXPOSED
```

`alerts` sits with `pgbouncer`, `privacy`, `vault` and `supabase_migrations` as a schema on which
`anon` and `authenticated` hold no `USAGE`. This is established **by privilege, not by
configuration**: even if `alerts` were added to PostgREST's exposed-schema list, the roles
PostgREST switches into hold nothing in it.

### G5

```
G5 BEFORE / AFTER = 8 rows / 8 rows
G5 CATALOG MD5    = 950cc69b1b480fdef6c4174aafc0721f  BEFORE
                  = 950cc69b1b480fdef6c4174aafc0721f  AFTER   — IDENTICAL
G5 ISOLATION      = PASS, BOTH DIRECTIONS
```

No `alerts_*` role can `SELECT` or write `public.telegram_initdata_replays`. No G5 grantee
(`postgres`, `service_role`) is a member of any `alerts_*` role, and no `anon` / `authenticated` /
`service_role` membership exists in any `alerts_*` role.

### Supabase advisors

Three `INFO`-level `rls_enabled_no_policy` notices on the three `alerts` tables. That is the
**deliberate design** — RLS on, zero policies, access solely through owner-owned `SECURITY DEFINER`
functions. G5 already carried the identical notice before this apply. No `WARN`, no `ERROR`.

---

## 3. FINDING A — SUPABASE PLATFORM READ AUTHORITY

**This corrects the non-production validation record.**

`docs/NEW_LEAD_ALERT_OUTBOX_NONPROD_VALIDATION.md` states, in its gate 49–52 row, that the migrator
**"cannot even reach the schema it just created"**. That was true of the disposable cluster. It is
**FALSE on `finmentor-prod`**, and the reason has nothing to do with this migration.

On `finmentor-prod`, `postgres` holds membership in the PostgreSQL predefined role
**`pg_read_all_data`**, granted by `supabase_admin`, with `inherit_option = true` and
`set_option = true`. That role confers `SELECT` on every table and `USAGE` on every schema in the
cluster. Therefore:

> **`postgres` inherits `pg_read_all_data` from the Supabase platform, and therefore the `postgres`
> administrative credential CAN `SELECT` `alerts` data — including `payload_json`, and therefore
> `contact_value`.**

Recorded explicitly:

* **this privilege predates the Outbox migration** — it is a platform grant from `supabase_admin`,
  present before `alerts` existed, and it was not created, requested or widened by this apply;
* **it is read-only for this context** — `pg_read_all_data` confers no `INSERT`, `UPDATE`, `DELETE`
  or `TRUNCATE`;
* **it does NOT grant `alerts` function `EXECUTE`** — verified: `has_function_privilege('postgres', …)`
  is **false** for `enqueue_new_lead`, `enqueue_new_lead_b64`, `claim_new_lead_delivery` and
  `new_lead_attention`. The migrator cannot enqueue, claim, finalise or purge anything;
* **it does NOT grant `alerts` table writes**;
* **`postgres` still cannot `SET ROLE alerts_owner`** — proven live: `42501 permission denied to set
  role "alerts_owner"`;
* **this is platform administrative authority, not an Outbox runtime privilege.**

**Supabase platform roles are not to be revoked.** No attempt was made and none should be: revoking
a platform-managed grant on `postgres` would break the project's own administration.

### The security statement, in the two parts it actually has

```
APPLICATION / RUNTIME ISOLATION        = PASS
    No runtime role holds a table privilege. No anon/authenticated/service_role access.
    No PUBLIC EXECUTE. Access is by EXECUTE on owner-owned SECURITY DEFINER functions only.

SUPABASE ADMINISTRATIVE READ ISOLATION = NOT APPLICABLE / PLATFORM ADMIN ACCESS EXISTS
    The holder of the postgres credential can read alerts data via pg_read_all_data.
    This is a property of the Supabase platform, not of this schema, and no DDL change
    would remove it.
```

Anyone reading only the first line would be misled. Both lines are the finding.

---

## 4. FINDING B — DUPLICATE MEMBERSHIP ROWS

`alerts_owner → postgres` exists as **two membership rows with different grantors**, not one:

| granted role | member | grantor | admin_option | inherit_option | set_option |
|---|---|---|---|---|---|
| `alerts_owner` | `postgres` | `postgres` | false | **false** | **false** |
| `alerts_owner` | `postgres` | `supabase_admin` | true | **false** | **false** |

The first is the migration's own grant, with its options stripped by §4.7 before `COMMIT`. The
second is the PostgreSQL 16+ automatic grant recorded when a `CREATEROLE` role creates a role —
here attributed to `supabase_admin`. The other five `alerts_*` roles each carry one such automatic
row, all `admin_option = true, inherit_option = false, set_option = false`.

**Both rows are `set_option = false` and `inherit_option = false`, therefore there is no usable
standing owner authority.** `SET ROLE alerts_owner` is refused `42501`.

The migration's invariant is therefore stated as it actually is:

> **EVERY membership row must deny `SET` and `INHERIT`.**

**Do not simplify this to "one membership row".** The post-condition block in §4.7 of the migration
aggregates across *all* rows matching the migrator, which is why it committed rather than aborting.
Had it been written to check a single row — or the migration's own grant only — it would have
passed here by luck rather than by construction, and a future platform change adding a third row
would slip past it.

---

## 5. FINDING C — CONCIERGE-SHAPED LITERAL IN `pg_stat_statements`

`pg_stat_statements` is installed on `finmentor-prod` (`track = top`, `track_utility = on`).
Exactly **one** entry matches any Concierge-shaped or synthetic identity string. It is the
migration's own `CREATE OR REPLACE FUNCTION alerts.enqueue_new_lead` DDL statement, whose
amendment 2.2-D comment contains the illustrative literal:

```
{"C-123456789-1788000000000": 1}
```

It is **NOT**:

* a real Telegram chat id
* a real request
* an executed enqueue parameter
* production customer data

It is a **synthetic example embedded in source documentation**, present to explain why a JSON *key*
is caller-controlled and must never be echoed. The same string is equally present in
`pg_proc.prosrc`, because it is part of the function's source text.

Verified alongside it: **no executed enqueue call and no synthetic QA identity is recorded in
`pg_stat_statements`.** The three other entries mentioning `enqueue_new_lead_b64` are the
migration's own `GRANT`, `ALTER FUNCTION` and `CREATE FUNCTION` statements, and none carries a raw
value.

**The live function is NOT altered in this step to remove the comment.** Editing a deployed
`SECURITY DEFINER` function to change a comment would mean a production migration for a cosmetic
reason, which is a worse trade than leaving an illustrative string in a statistics view.

### POST-GO CLEANUP ITEM (no production migration now)

```
POST-GO COSMETIC CLEANUP = OPEN
```

Replace realistic-shaped identity examples in SQL comments and tests with obviously synthetic
tokens — e.g. `C-SYNTHETIC-TEST-IDENTITY` in place of `C-123456789-1788000000000`. This applies to
the design document's SQL fences, since the migration is generated from them, and it must be
batched with the next substantive migration. **No production migration is to be made for this
alone.**

---

## 6. Production synthetic QA

```
PRODUCTION SYNTHETIC QA = PASS
```

**Method, stated plainly.** The design deliberately gives the migrator **no `EXECUTE`** on any
`alerts` function — verified, `can_enqueue = false` — so the functions could not be exercised as
`postgres`, and creating a runtime login was forbidden. Each QA block therefore granted itself the
transient **NOLOGIN group membership** it needed, exercised the functions, and ended with a
deliberate `RAISE EXCEPTION`, **aborting the transaction** so that the grants and every synthetic
row rolled back with it. Role grants are transactional in PostgreSQL. After each block this was
verified by fresh read: **0 rows, 0 standing memberships**.

No login, no password and no credential was created at any point. Every identity used was
unmistakably synthetic (`fmr_deadbeef…`, `sub_deadbeef…`, `C-999999999-1900000000000`,
`QA-SYNTHETIC-DO-NOT-USE-…`, `SYNTHETIC-NOT-A-REAL-CONTACT`). No real lead, no real contact value,
no Telegram, no Email.

| result | evidence |
|---|---|
| `ATOMIC 1+1+1` | **PASS** — `CREATED` yields exactly 1 event + 1 telegram + 1 email |
| `CONVERGENT ENQUEUE` | **PASS** — the second identical call returns `ALREADY_PRESENT`, `tg=false`, `mail=false`, counts unchanged; the returned fingerprint equals an independently computed SHA-256 of the domain-separated id |
| `RAW REQUEST_ID PERSISTED` | **NO** — 0 hits across every column of `alerts.new_lead_outbox`; 0 occurrences in any of 8 error messages |
| amendment 2.2-D, live | a raw Concierge identity supplied as a JSON **key** produced `ALERTS_PAYLOAD_KEY_FORBIDDEN (n=1)` — the count, never the key |
| `CHANNEL ISOLATION` | **PASS** — telegram claimed and finalised `SENT` while email stayed `PENDING` / `attempt=0` / `claim_token NULL`. A wrong claim token returns `NOT_OWNED` and writes nothing |
| `DELIVERY_UNKNOWN` | **PASS** — an expired claim became `DELIVERY_UNKNOWN`, never `RETRYABLE_FAILED`, never auto-reclaimed; surfaced by `new_lead_attention()` carrying no payload |
| `PAYLOAD RETENTION` | **30 d, ACTIVE** — purge left `payload_json = '{}'`, `payload_purged_at` set, `contact_value` gone |
| `DELIVERY RETENTION` | **180 d, ACTIVE** — `purge_new_lead_deliveries()` ran, deleted 0 (nothing terminal aged) |
| `AUTOMATIC REPAIR` | **7 d, POLICY DATA** — in-window re-enqueue = `REPAIRED` and the row was restored; a 40-day event returned `EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW` and the row was **not** recreated |
| `KEY RETENTION` guard | **PASS** — `purge_new_lead_keys()` raised `0A000` and deleted nothing |
| `DELIVERY_UNKNOWN RETENTION` guard | **PASS, both ways** — the sweep runs while `PENDING_OWNER`; after recording `DECIDED_BOUNDED` it raised `0A000` rather than silently not sweeping |
| `POOLER / SET ROLE` | **SAFE** — proven that an `INHERIT`-only membership (`set_option = false`) suffices to call the functions with **no `SET ROLE`**, so a transaction-mode pooler cannot break the runtime path |
| 8 negative paths | all raise the correct `ALERTS_*` code under SQLSTATE `22023`; `RAW_ID_IN_MESSAGES = 0`, `CONTACT_VALUE_IN_MESSAGES = 0` |

```
SYNTHETIC TEST RECORDS REMAINING = NONE
    alerts.new_lead_outbox   = 0 rows
    alerts.new_lead_delivery = 0 rows
    alerts.retention_policy  = 1 row (the singleton, as the migration inserts it)
```

---

## 7. Dormant state, as accepted

```
alerts schema              = PRESENT
runtime LOGIN              = NONE
n8n alerts credential      = NONE
writer workflow            = NONE
Telegram dispatcher        = NONE
Email dispatcher           = NONE
reconciler schedule        = NONE
Microsoft Graph credential = NONE
```

Zero `alerts_*` roles can log in. Zero standing migrator memberships carry `SET` or `INHERIT`.
Nothing in the running system references this schema. **The foundation exists and cannot be
called.**

---

## 8. MANDATORY future runtime credential precondition

**This is not satisfied, and it cannot be satisfied yet — because there is no runtime login to
apply it to.** It is recorded here because it must be applied *by the operation that creates that
login*, not afterwards.

```
BEFORE FIRST FUNCTION CALL, on the alerts runtime LOGIN:

    statement_timeout = 8s
    lock_timeout      = 5s
```

### Why

`finmentor-prod`'s effective settings, re-read at apply time and matching the owner's independent
preflight exactly:

```
log_statement                         = ddl
log_min_duration_statement            = -1
log_duration                          = off
log_parameter_max_length_on_error     = 0
pgaudit.log                           = none
auto_explain.log_min_duration         = 10s
auto_explain.log_parameter_max_length = -1
statement_timeout                     = 120s   (2min)
lock_timeout                          = 0
```

Under these settings a **slow but SUCCESSFUL** enqueue that crosses 10 s writes the raw canonical
request id and `contact_value` to the durable server log as `auto_explain` "Query Parameters". An
enqueue is sub-millisecond in normal operation, but with `lock_timeout = 0` and
`statement_timeout = 120s` the 10–120 s window is reachable under lock contention. Capping the
runtime login's statements below the 10 s threshold means `auto_explain` never fires.

**The credential creation operation must atomically ensure these role settings BEFORE any workflow
can use the credential.** A credential that exists for even one call without them has the window
open. The values are consistent with the platform's own practice: Supabase already sets
`statement_timeout = 8s, lock_timeout = 8s` on its own `authenticator` role.

This is a **runtime credential precondition, not a DDL change**, and it alters no database-wide
logging setting.

---

## 9. Still open — no answers invented

```
KEY RETENTION                      = PENDING LEGAL / PRIVACY
DELIVERY_UNKNOWN RETENTION         = PENDING OWNER
PIPELINE RAW REQUEST_ID RETENTION  = OPEN
REQUEST FINGERPRINT CONFIRMABILITY = OPEN / SHA-256 v1 accepted for current cycle
```

Unchanged by this apply. The first two are enforced by refusal in the database rather than by
comment — both proven live in §6. The fingerprint is **pseudonymous, not anonymous**: the derivation
is public and unkeyed, so a party already holding a candidate identifier can confirm it. HMAC with
an out-of-table pepper remains the recorded upgrade path and is deliberately not implemented.

---

## 10. Remaining-work inventory

```
OUTBOX DDL DESIGN                     = CLOSED
OUTBOX NON-PROD VALIDATION            = CLOSED
OUTBOX PRODUCTION DATABASE FOUNDATION = CLOSED / READY

TELEGRAM DURABLE NEW LEAD DELIVERY    = NEXT ENGINEERING PHASE
EMAIL PROVIDER                        = SELECTED — Microsoft 365 / Exchange Online
EMAIL CREDENTIAL                      = PENDING
EMAIL DURABLE NEW LEAD DELIVERY       = BLOCKED ON TELEGRAM/OUTBOX runtime proof + Graph setup

AUTHORITATIVE CYCLE PROJECTION        = OPEN
LEGAL / PRIVACY                       = PENDING OWNER
RO PREMIUM UX / MINI APP              = OPEN
FINAL CODEX AUDIT                     = OPEN
FINAL E2E UAT                         = OPEN
CUSTOMER PRODUCTION                   = BLOCKED

POST-GO COSMETIC CLEANUP              = OPEN  (§5 — synthetic identity tokens in SQL comments)
```

---

## 11. What this step did not do

Nothing beyond the single `apply_migration` call and read-only verification. No runtime login
created. No n8n credential created. No writer deployed, no dispatcher deployed. No Telegram sent,
no Email sent. No Microsoft Graph configuration. No change to cycle projection. Customer production
not activated. G5 untouched, byte-identical before and after. `qa/` untouched.

```
OUTBOX PRODUCTION DDL      = PASS
OUTBOX DATABASE FOUNDATION = READY
```
