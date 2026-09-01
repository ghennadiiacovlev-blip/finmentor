# NEW LEAD ALERT OUTBOX — NON-PRODUCTION DDL VALIDATION

**Status: OUTBOX DDL NON-PROD VALIDATION = PASS. READY FOR PRODUCTION DDL APPROVAL = YES.
PRODUCTION DDL NOT APPLIED, and it will not be without separate owner approval.**

Executed 2026-08-31 under the owner authorisation *OUTBOX REVISION 2 NON-PRODUCTION VALIDATION*,
and extended 2026-09-01 by the owner's pre-production hardening pass (**revision 2.2**).
Nothing was applied to `finmentor-prod`, `public.telegram_initdata_replays` / G5 was not touched,
no workflow was deployed, no n8n credential and no Microsoft Graph credential was created, and no
Telegram or Email message was sent.

**Five real DDL defects were found. Three of them made the migration or its rollback impossible to
run at all, and the fifth would have written a raw Concierge identity into an error message.** All
five are amended — four in revision 2.1, one in revision 2.2 — and re-proven from a clean database.

**This record describes revision 2.2**, whose final run is 53 gates / 644 assertions / 0 failures.
Two things the 2.1 record left open are now closed in the schema: the migrator keeps no usable
membership in `alerts_owner` after the migration (§7), and the repair window is owner-approved
policy data rather than a literal (§7). One new finding is *not* closed by DDL and is a runtime
precondition for production — see §6, `auto_explain`.

---

## 1. Environment — and why it is not Supabase

**`finmentor-prod` is the only Supabase project this session can reach.** Its MCP connection was
probed read-only and answers `PostgreSQL 17.6`, project `exvmtjxmfouzuschiuwj`, and it contains
`public.telegram_initdata_replays` with 8 rows — it *is* production. There is no approved
non-production Supabase environment available here, and the authorisation is explicit that the
absence of a staging database is not a reason to use production. **Option A was therefore refused
and option B used.**

| | |
|---|---|
| **NON-PROD DATABASE** | `fm_outbox_nonprod`, on a **disposable local PostgreSQL cluster**, loopback only (`127.0.0.1:55432`), created for this run and dropped between runs. Zero production data: the G5 table is a shape-copy of the deployed catalog definition filled with 8 rows of `sha256('synthetic-g5-' || n)` |
| **POSTGRES VERSION** | **17.6** — the exact major.minor of `finmentor-prod` (17.6). Binaries: `embedded-postgres@17.6.0-beta.15`; no Docker, no installed PostgreSQL, no managed service |
| **migrator identity** | `fm_migrator`: **`NOSUPERUSER CREATEROLE CREATEDB LOGIN`** — the Supabase `postgres` shape. Asserted before the migration runs |
| **runtime identities** | six separate **login** roles, one per group role, each connecting on its own session. No gate is proven by `SET ROLE` from a superuser |
| **client identities** | `anon`, `authenticated`, `service_role` (`BYPASSRLS`, as Supabase has it) reached by `SET ROLE` from an authenticator login, plus `g5_authority` and an unprivileged login |
| harness | `db/validation/` — refuses any non-loopback host by construction |

### REQUIRES NON-PROD SUPABASE

These cannot be faithfully proven on a disposable cluster and must be re-run once an approved
non-production Supabase project exists. **None of them is a reason to withhold DDL approval; each
is a re-confirmation on the real platform.**

1. Supabase's own `ALTER DEFAULT PRIVILEGES` baseline for `anon` / `authenticated` (it applies to
   `public`, not to `alerts` — but the assertion should be made against the real baseline, not a
   fixture's).
2. PostgREST exposure: that `alerts` is not in the exposed-schema list, so no function here is
   reachable over the REST/RPC surface.
3. `supabase_admin` / `postgres` superuser-adjacency — stated in §4.7 of the design as a platform
   property, not asserted here.
4. Supavisor/PgBouncer behaviour for a pooled session that uses `SET ROLE`.
5. `pg_stat_statements` (installed in production, absent here) — that the raw identifier is
   normalised out of the statement text.
6. The project's actual `log_statement` / `log_min_duration_statement` values — see §6.

---

## 2. Migration artifact

| | |
|---|---|
| forward | `db/migrations/0001_new_lead_alert_outbox.up.sql` |
| rollback | `db/migrations/0001_new_lead_alert_outbox.down.sql` |

Both are **generated**, never hand-written: `node db/validation/extract-migration.mjs` lifts the
SQL fences of `docs/NEW_LEAD_ALERT_OUTBOX_DDL_REVIEW.md` verbatim, locating them by section
heading. Re-run it and `git diff` must be empty. The design document stays the single source of
truth, so a fix cannot land in the file without landing in the design.

### HASH DEPENDENCY

| | |
|---|---|
| **HASH DEPENDENCY** | `sha256(bytea)` — a **pg_catalog built-in since PostgreSQL 11**. `gen_random_uuid()` — pg_catalog since 13 |
| **EXTENSION REQUIRED** | **NONE** |
| **EXTENSION ALREADY AVAILABLE** | not applicable. Proven on a cluster whose only extension is `plpgsql`: `digest()` — the pgcrypto entry point — **does not exist there at all**, and `alerts.request_fingerprint` still returns the correct hash |
| **MIGRATION MUTATES EXTENSIONS** | **NO.** `pg_extension` is byte-identical before and after; neither file contains the string `CREATE EXTENSION` |

Production has `pgcrypto` installed in schema `extensions`. The migration does not use it, does not
need it, and does not reference it — so a future `extensions` schema change cannot break the
fingerprint.

---

## 3. DDL defects found during the real Postgres test

All five were found by **running** the DDL, not by reading it. Three were invisible to a superuser
and appear only for the `NOSUPERUSER CREATEROLE` migrator that Supabase's `postgres` actually is.
Defects 1–4 were found in the revision-2.1 pass; defect 5 in the revision-2.2 hardening pass.

### Defect 1 — the migration could not be applied at all — `§4.1` — **BLOCKING**

```
42501  must be able to SET ROLE "alerts_owner"
       at:  CREATE SCHEMA IF NOT EXISTS alerts AUTHORIZATION alerts_owner;
```

PostgreSQL 16+ records a membership automatically when a `CREATEROLE` role creates a role. Proven
directly:

| | admin_option | inherit_option | set_option |
|---|---|---|---|
| the automatic grant | `true` | **`false`** | **`false`** |
| an explicit `GRANT` | `false` | `true` | `true` |

`pg_has_role(current_user, 'alerts_owner', 'MEMBER')` is **`true`** for the automatic grant, so
revision 2's guard concluded the migrator was already a member and skipped the real `GRANT`.
Assigning ownership requires `SET`, which the automatic grant does not carry. Every non-superuser
migrator hit this at statement 5 of 85.

**Amendment 2.1-A:** grant unconditionally. `GRANT` is idempotent, and it is what actually adds the
`SET` option.

### Defect 2 — the payload allowlist constraint could not be created — `§4.3` — **BLOCKING**

```
0A000  cannot use subquery in check constraint
```

`CHECK (… NOT EXISTS (SELECT 1 FROM jsonb_object_keys(payload_json) …))` is not legal PostgreSQL.
The table could not be created, so the revision-2 claim that the allowlist is *"enforced twice —
by `new_lead_outbox_payload_allowlist_ck` and by the enqueue function"* described a constraint that
had never existed. Only the function-level check was real.

**Amendment 2.1-B:** `(payload_json - ARRAY[…allowed…]) = '{}'::jsonb` — the same rule, as an
`IMMUTABLE` operator with no subquery. Now proven to reject a forbidden key **even from the table
owner** (gate 34), which is exactly the second, independent lock the design asked for.

### Defect 3 — concurrent enqueue raised an unclassifiable error — `§4.4` — **CORRECTNESS**

A six-way simultaneous burst on one canonical identity:

```
CREATED, ALREADY_PRESENT, ALREADY_PRESENT
duplicate key value violates unique constraint "new_lead_outbox_pk"   x3
```

`dispatch_key` is `GENERATED ALWAYS … STORED` and carries its own unique index — the primary key —
perfectly correlated with `request_fingerprint`. `ON CONFLICT (request_fingerprint) DO NOTHING`
arbitrates on one index only; a concurrent insert can still collide on the other and raise a bare
`23505`.

The committed state was still exactly 1 + 1 + 1, so **nothing was ever duplicated**. What broke is
the caller contract: §8 records that the n8n Postgres node *hides SQLSTATE*, so the dispatcher must
classify on the fixed `ALERTS_*` prefixes. `duplicate key value violates unique constraint` carries
no prefix, is not `ALERTS_ENQUEUE_RACE_RETRY`, and would have reached the runtime as an
unrecognised failure on a lead that had in fact been enqueued correctly.

**Amendment 2.1-C:** unqualified `ON CONFLICT DO NOTHING` arbitrates on every unique index. The
same burst now returns one `CREATED` and five `ALREADY_PRESENT`, with zero errors.

### Defect 4 — the rollback could not be run at all — `§5` — **BLOCKING**

```
42501  permission denied to drop objects
       Only roles with privileges of role "alerts_writer" may drop objects owned by it.
```

`DROP OWNED BY` requires the role's *privileges*, which the automatic grant of defect 1 does not
give. Worse, for `alerts_owner` revision 2 executed `REVOKE alerts_owner FROM current_user`
**immediately before** `DROP OWNED BY alerts_owner`, removing the only membership that could have
carried them.

**Amendment 2.1-D:** `GRANT` before `DROP OWNED BY`; `DROP ROLE` removes the membership by itself,
so the `REVOKE` was never needed.

### Defect 5 — a forbidden payload **key name** was echoed into the error — `§4.4` — **PRIVACY**

Revision 2.1 raised `ALERTS_PAYLOAD_KEY_FORBIDDEN (%)` with the offending key names interpolated.
Key names are caller-controlled strings, so a payload of

```json
{"C-123456789-1788000000000": 1}
```

puts a raw Concierge identity into the exception text — and `finmentor-prod` runs
`log_min_error_statement = error`, which logs the failing statement. Gate 34 had asserted the keys
were named "in order", i.e. the leak was a *tested-for feature* of revision 2.1.

**Amendment 2.2-D:** report a count only — `ALERTS_PAYLOAD_KEY_FORBIDDEN (n=1)`. Proven by gates
59–61: with the identity used **as the key**, no exception on any path carries the raw request id,
the chat id fragment, the contact value, or a `Failing row contains` dump.

### The revision-2.2 hardening amendments

Owner-directed, on top of the four defect fixes. Each is proven by named gates.

| | change | what it replaced | gates |
|---|---|---|---|
| **2.2-A** | the migration **revokes the migrator's working membership in `alerts_owner`** before `COMMIT`, keeping only the `ADMIN OPTION` needed to administer the role again | a full membership — `SET`, `INHERIT`, `ADMIN` — held indefinitely | 49–52 |
| **2.2-B** | the automatic repair window is **policy data**, `alerts.retention_policy.automatic_repair_days` | `c_repair_window CONSTANT interval := interval '7 days'` inside the function body | 53–57 |
| **2.2-C** | the `DELIVERY_UNKNOWN` deletion horizon is **explicit pending policy data**, and the purge **refuses to run** if that status changes without the deletion code being written | `DELIVERY_UNKNOWN` merely absent from the purge's `WHERE` | 58 |
| **2.2-D** | `ALERTS_PAYLOAD_KEY_FORBIDDEN` reports **only a count** | the offending key names, echoed | 59–61 |
| **2.2-E** | the rollback **asserts** that no `alerts_*` role survives it | a comment saying it dropped them | 51 |

### DDL CHANGES REQUIRED

**Nine: four in revision 2.1, five in revision 2.2 — all applied and all re-proven from a clean
database.** Nothing else in the design moved: no table semantic, function signature, grant, role or
RLS decision changed beyond what those nine describe. The full amended shape is asserted
byte-for-byte identical between the first apply and the apply after rollback (gate C3, 12
projections).

---

## 4. Apply / reapply / rollback

| | result | proof |
|---|---|---|
| **CLEAN APPLY** | **PASS** | empty target, as `fm_migrator` (**non-superuser**). Schema, 3 tables, 2 views, 6 group roles created; G5 byte-identical before and after |
| **IDEMPOTENT REAPPLY** | **PASS** | the same file applied a second time **over a populated schema**. 17 catalog projections compared — relations, functions with signatures/`prosecdef`/owner/`proconfig`, constraint definitions, triggers, policies, table ACLs, function ACLs, schema ACL, default ACLs, RLS flags, roles — **all identical**. No duplicate role. Seeded outbox rows, delivery rows and the retention policy row unchanged |
| **ROLLBACK** | **PASS** | `alerts` gone, all six `alerts_*` roles gone, no default ACL left. Survivors verified: G5 with all 8 rows, `unrelated.keep_me`, `public.unrelated_public_table`, and **every** non-`alerts` role |
| **ROLLBACK REFUSES UNSAFE CASCADE** | **PASS** | with a stray table planted in `alerts` that the migration does not own, the rollback **fails and rolls itself back** rather than cascading. The schema, the stray object and every role survive intact. `DROP SCHEMA` is deliberately not `CASCADE`, and that is what saves it |
| **REAPPLY AFTER ROLLBACK** | **PASS** | clean rebuild; catalog shape identical to the first apply across all 11 compared projections; retention policy back at 30 / 180 / NULL / `PENDING_LEGAL_PRIVACY_FINALISATION`; the outbox empty — the rollback really does destroy the keys |

**Caveat recorded, not a defect:** `DROP OWNED BY` acts on the *current database only*. During the
run a role left over from an earlier test database still held grants there, and the rollback aborted
with `2BP01 … 3 objects in database fm_outbox_bisect` — safely, but it aborted. A Supabase project
has one application database, so this is a thing to know rather than a thing to fix.

---

## 5. Gates

**GATES 19–32 = PASS. ADDITIONAL GATES 33–48 = PASS. REVISION-2.2 GATES 49–62 = PASS.**
**53 gates, 644 assertions, 0 failures**, from a clean database against the repository migration
files. Machine-readable transcript: `db/validation/results/last-run.json`.

**Reproduced from cold.** The figures above are not the accumulated state of the session that found
the defects: the cluster was destroyed and a new one `initdb`'d, the migration was regenerated from
the design document (`extract-migration.mjs`; both files byte-identical, SHA-256 unchanged), and the
suite re-run end to end — the same 53 / 644 / 0, and the same 140 / 0 / 124 / 16 server-log figures.

| # | gate | outcome |
|---|---|---|
| 19 | enqueue atomically creates 1 event + 1 telegram + 1 email | **PASS** — and with a failure injected *after* the event insert, **zero rows of any kind** survive |
| 20 | concurrent enqueue for the same canonical request → exactly 1+1+1 | **PASS** — two genuinely interleaved sessions (the second **verified blocked** until the first commits) → one `CREATED`, one `ALREADY_PRESENT`. Plus a 6-way released burst → one `CREATED`, five `ALREADY_PRESENT`, **zero errors**. *This gate found defect 3* |
| 21 | abnormal historical state convergently repaired | **PASS** — one row missing → only that row recreated, the survivor byte-identical (`created_at`, `attempt_count`, `status`). Both missing → exactly two restored. **An existing `SENT` row is never reset**, `sent_at` and `provider_message_id` intact |
| 22 | raw Concierge `request_id` not persisted | **PASS** — enqueued `C-987654321987-1788000000000`; every `text`/`varchar`/`jsonb` column of **every table and view** in `alerts` scanned for the identifier, the chat id and the epoch → **zero hits**. Function output carries the fingerprint only. Error text carries neither: an invalid `lead_id` returns `ALERTS_LEAD_ID_INVALID`, a bad shape returns `ALERTS_REQUEST_ID_SHAPE_INVALID (route=concierge)` — the route name and nothing else |
| 23 | fingerprint database-computed, caller cannot spoof it | **PASS** — `pg_get_function_arguments` is exactly the five declared inputs; there is no parameter to supply one through. `dispatch_key` is `GENERATED ALWAYS`; `request_fingerprint` is `NEVER` generated. The stored hash equals an independently computed SHA-256. **No runtime role can execute `request_fingerprint`** — no hashing oracle |
| 24 | caller cannot choose `dispatch_key` | **PASS** — `428C9` on insert *and* on update, even as superuser |
| 25 | writer cannot directly SELECT/INSERT/UPDATE/DELETE the event tables | **PASS** — `42501` on all four verbs across all three tables (12 denials). Re-enqueue with a **different payload and a different `lead_id`** leaves both unchanged; no function uses `DO UPDATE` |
| 26 | dispatcher cannot mutate the Outbox event | **PASS** — `42501` on all four verbs, and it holds `EXECUTE` on none of the six functions that can write the outbox |
| 27 | the real role + RLS + `SECURITY DEFINER` combination works | **PASS** — the silent-unusable trap. Each of the five runtime roles ran its full happy path **on its own login** and got **rows, not zero rows**: writer enqueues (and the b64 wrapper yields the same key); dispatcher claims a row **carrying its payload**, finalises `OK`, and a dead claim becomes `DELIVERY_UNKNOWN`; reconciler resolves present/absent correctly and repairs; retention purges, and `purge_new_lead_keys()` **refuses** with `0A000 ALERTS_KEY_RETENTION_PENDING_LEGAL_PRIVACY_FINALISATION`; audit reads both views but is still denied the base tables. RLS on, `FORCE` off, zero policies, `alerts_owner` **without** `BYPASSRLS` |
| 28 | PUBLIC / anon / authenticated / service_role cannot execute | **PASS** — 62 assertions. Every one of the 13 functions and all 5 relations denied `42501` to each of `anon`, `authenticated`, `service_role` and a fresh unprivileged login. `service_role` really does carry `BYPASSRLS` — and reaches nothing, because bypassing RLS is not a privilege |
| 29 | G5 authority cannot execute alerts functions | **PASS** — the role is first shown to genuinely read its own ledger, then denied on all 13 functions and all 5 relations |
| 30 | alerts roles cannot access G5 | **PASS** — all four verbs denied for each of the five runtime logins (20 denials). No `alerts_*` grantee on the G5 table; no membership edge in either direction; G5 still holds its 8 rows |
| 31 | 30-day payload purge | **PASS** — `payload_json = '{}'`, `payload_purged_at` stamped, fingerprint/key/route/`lead_id`/timestamps unchanged, the `^[0-9a-f]{64}$` CHECK still satisfied, both delivery rows alive with valid foreign keys and zero orphans anywhere. The purged event is **not claimable on either channel** and surfaces as `UNDELIVERED_PAYLOAD_PURGED`. **No delivery is re-created**: re-enqueue returns `EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW`, and a deleted delivery row stays deleted |
| 32 | zero Microsoft-specific schema coupling | **PASS** — all three column lists asserted against a frozen set. No column, constraint, relation, function or type name matches `tenant\|mailbox\|graph\|internet_message\|client_id\|oauth\|azure\|microsoft\|smtp\|exchange\|o365\|m365`; no CHECK definition and no function body does either. `provider_message_id` is nullable `text`; the channel CHECK names only `telegram` and `email` |
| 33 | malformed route identity rejected before insert | **PASS** — 9 malformed identities including **all three cross-route substitutions**, plus 5 invalid routes, each rejected with `22023` and the correct `ALERTS_*` token, leaving nothing behind |
| 34 | malformed/forbidden payload rolls the transaction back | **PASS** — event=0, telegram=0, email=0 for a forbidden key, two forbidden keys (**named in order**, values never echoed), an invalid `contact_channel`, and a JSON array / string / null. The amended CHECK independently refuses a forbidden key **from the owner** with `23514` |
| 35 | a failure creating ONE delivery row rolls everything back | **PASS** — a trigger failing only on the *email* insert leaves **event=0, telegram=0, email=0**: the already-successful telegram insert goes too. A retry then produces the complete set |
| 36 | finalise requires the correct claim token | **PASS** — the correct token succeeds; the row becomes `SENT` with `sent_at` set and the token cleared; **replaying the same token afterwards is refused** |
| 37 | wrong claim token changes zero rows | **PASS** — random token, `NULL` token, right token on the wrong channel, right token on the wrong key → all `NOT_OWNED`, and the row is **byte-for-byte unchanged** after all four |
| 38 | two dispatchers racing → exactly one winner | **PASS** — deterministic: winner gets the row, loser gets **zero rows** (not an error, not a duplicate) while it is locked, and zero rows again after the commit. Burst of five: exactly one winner, nobody errored, `attempt_count` advanced **once**, exactly one distinct claim token |
| 39 | `SENT` cannot be reclaimed | **PASS** — on both channels: never returned by the claim, `attempt_count` frozen at 1, a stale token cannot force it back to `RETRYABLE_FAILED`. A `SENT` row without `sent_at` is refused by CHECK |
| 40 | `DELIVERY_UNKNOWN` cannot be automatically reclaimed | **PASS** — not claimable, **not even with `next_attempt_at` a year in the past**. An expired claim becomes `DELIVERY_UNKNOWN` with `CLAIM_EXPIRED` (never `RETRYABLE_FAILED`) and surfaces in the attention feed. `expire_stale_claims` refuses a sub-minute window |
| 41 | `RETRYABLE_FAILED` not claimable before `next_attempt_at` | **PASS** — token cleared, `next_attempt_at` pushed forward, the 30-second backoff floor applied, not claimable |
| 42 | `RETRYABLE_FAILED` claimable after `next_attempt_at` | **PASS** — same row returns, `attempt_count` = 2. A row at the attempt ceiling is not claimed; a caller may raise the ceiling explicitly |
| 43 | channel isolation | **PASS** — the telegram claim *and* the telegram finalise leave the email row byte-identical, and the reverse. An invalid channel is refused by the function (`22023`) and by CHECK (`23514`) |
| 44 | no `contact_value` after purge | **PASS** — payload is exactly `{}` with zero keys; no purged row anywhere retains `contact_value` or any other key; the purge CHECK **refuses to put a payload back**; the audit view reports `has_contact_value = false` |
| 45 | audit views expose no raw request_id | **PASS** — the outbox audit view's column set is frozen and payload-free (booleans only). Read as `alerts_audit`, neither view's full contents contain the identifier, the chat id, the epoch or the contact value |
| 46 | SECURITY DEFINER controls | **PASS** — exactly 13 functions; **every one** owned by `alerts_owner` with `search_path=pg_catalog` pinned; PUBLIC holds `EXECUTE` on none; **no body contains dynamic SQL**. The 10 runtime-facing functions are `SECURITY DEFINER`; the three that are not are the b64 wrapper, the hash and the trigger — by design. Schema and every relation owned by `alerts_owner`; PUBLIC has nothing on the schema |
| 47 | no runtime login inherits `alerts_owner` | **PASS** — and the revision-2.1 residual is now **CLOSED** by amendment 2.2-A; see gates 49–52 and §7 |
| 48 | no LOGIN credential, no stored secret | **PASS** — exactly the six group roles; none can log in, none holds a password, none is superuser or `BYPASSRLS`, none can create roles. The migration added no role beyond those six, no function body contains a secret-shaped literal, and the schema declares no foreign server or user mapping |
| 49–52 | the migrator holds no usable membership in `alerts_owner` — after clean apply, after idempotent reapply, after rollback, after reapply-after-rollback | **PASS** — at all four lifecycle points: no `alerts_*` membership carries `SET` or `INHERIT`, `pg_has_role(…,'USAGE')` is false, `SET ROLE alerts_owner` is refused `42501`, and the migrator **cannot even reach the schema it just created** (`42501 permission denied for schema alerts`). What it keeps is `ADMIN OPTION`, which confers neither — and is what makes the migration re-runnable and rollback-able without a superuser |
| 53 | the repair window is policy DATA, not a literal | **PASS** — `automatic_repair_days` is in `alerts.retention_policy` at the approved **7**; no interval literal for it survives in `enqueue_new_lead`; the column is bounded 1–365 so a typo cannot make it a century, and cannot be zero. With the policy row missing the enqueue **refuses** (`ALERTS_REPAIR_POLICY_MISSING`) rather than assuming a default, and writes nothing |
| 54 | changing the policy 7 → 5 changes behaviour with **no function migration** | **PASS** — one integer `UPDATE`: day 6 repaired at 7 and refuses at 5, day 4 still repairs. The function was not migrated — same oid, byte-identical body, and **the catalog row was not even rewritten (same `xmin`)**. Restored to the approved 7 |
| 55 | inside the window an ordinary enqueue repairs a missing delivery | **PASS** — day 0, 3 and 6.9 each repaired back to exactly 1 + 1 + 1 |
| 56 | outside the window an ordinary enqueue refuses resurrection | **PASS** — day 7.1, 10 and 45: no resurrection, the email row stays absent |
| 57 | outside the window only the reconciler authority repairs | **PASS** — the reconciler restores 1 + 1 + 1 beyond the automatic window at all three ages, **cannot conjure an event that never existed** (`ALERTS_EVENT_NOT_FOUND`), and the writer holds no `EXECUTE` on it |
| 58 | the payload still purges while a `DELIVERY_UNKNOWN` stays unresolved | **PASS** — the 30-day purge empties the payload and stamps `payload_purged_at` even though the delivery is unresolved; `contact_value` is gone. The unresolved row survives **400 days**. Recording a horizon makes the sweep **refuse** — `0A000 ALERTS_DELIVERY_UNKNOWN_HORIZON_NOT_IMPLEMENTED (status=DECIDED_BOUNDED)` — rather than silently doing nothing, and a bounded decision cannot be recorded without a horizon |
| 59 | no alerts exception carries the raw request id | **PASS** — 80 assertions over 13 error paths, each **verified to actually raise**. Two of the 80 are the experiment's own controls, added after the first 2.2 run: the gate reads the five `log_*` settings back and asserts the maximal-logging control is **armed**, and asserts the scan **does** find the identifier somewhere in the log — so a quiet or unread log **fails** the gate instead of passing every "no line carries it" assertion vacuously. Every one returns a stable `ALERTS_*` code carrying neither the identifier nor the chat id fragment — including the two paths where the raw identity is the **payload key** |
| 60 | no alerts exception carries `contact_value` or any payload value | **PASS** — no error text carries the contact value, and none carries a PostgreSQL `Failing row contains` dump |
| 61 | after every failure path, no alerts table or view holds the raw request id | **PASS** — all 23 text/jsonb columns of every `alerts` table and view scanned: no raw id, no chat id fragment, no contact value. No outbox row was created by any failure path, and **not even the fingerprint** of the secret identity is present |
| 62 | `auto_explain`: a slow but **successful** enqueue, and the mitigation | **PASS — and it confirms a real leak path.** See §6: under production's own `auto_explain` settings a *successful* enqueue crossing 10 s writes the raw identifier to the server log as "Query Parameters". The mitigation is proven in the same run |
| C1 | the rollback refuses to cascade through an object it does not own | **PASS** — `2BP01`, on the schema drop, not a silent cascade; the whole rollback transaction rolls back and the stray object survives |
| C2 | rollback removes only migration-owned objects | **PASS** — schema and all six roles gone, no default ACL left; G5 with all 8 rows, the unrelated schema, the unrelated public table and every non-`alerts` role survive, and no extra role is left behind |
| C3 | reapply after rollback | **PASS** — 12 catalog projections identical to the first apply; the retention policy back at its approved values and undecided horizons; the outbox empty |

Consolidated answers:

| | |
|---|---|
| **CONCURRENT ENQUEUE** | **PASS** — interleaved and burst, after amendment 2.1-C |
| **ATOMIC 1+1+1** | **PASS** — including "commits nothing" under two different injected failures |
| **CONVERGENT REPAIR** | **PASS** — one missing, both missing, and a `SENT` row never reset |
| **CHANNEL ISOLATION** | **PASS** |
| **CLAIM TOKEN ENFORCEMENT** | **PASS** — wrong token changes zero rows; a used token cannot be replayed |
| **DELIVERY_UNKNOWN SAFETY** | **PASS** — never auto-reclaimed under any `next_attempt_at`; never swept by retention |
| **RLS** | **PASS** — enabled on all three tables, `FORCE` off, zero policies, exemption by ownership only |
| **SECURITY DEFINER** | **PASS** |
| **ROLE ISOLATION** | **PASS** — proven per login role, not by `SET ROLE` from a superuser |
| **G5 ISOLATION** | **PASS** — both directions, privileges and memberships |

---

## 6. Identity, fingerprint and the raw request_id

| | |
|---|---|
| **RAW REQUEST_ID IN OUTBOX** | **NOT PRESENT.** Proven by exhaustive value scan of every text-ish column of every table and view in `alerts`, plus the function output and the error text |
| **RAW REQUEST_ID IN PIPELINE** | **STILL PRESENT — OPEN.** `Build Pipeline Row` writes it durably to Google Sheets. Outside this migration; unchanged by it |
| **FINGERPRINT MODEL** | SHA-256 over `'finmentor:new_lead:v1:' || canonical_request_id`, computed by the database, domain-separated, versioned. Verified equal to an independently computed hash. **PSEUDONYMOUS, NOT ANONYMOUS** |

**The fingerprint is confirmable, and that is accepted for this test cycle only.** The derivation is
public and unkeyed: anyone who already holds a candidate identifier can hash it and check. For
Concierge that means a party who has read the outbox *and* already knows a target chat id can
confirm whether that person submitted, and roughly when, by hashing candidate `epoch_ms` values —
a one-year window is ~3.15 × 10¹⁰ candidates, hours on commodity hardware. **HMAC was deliberately
not introduced during this cycle, as instructed.** The production decision on long-term fingerprint
retention, a possible HMAC v2, and raw Pipeline `request_id` retention remains a later
privacy/security decision. **The issue is not closed globally.**

### The raw identifier reaches the PostgreSQL server log — measured three ways

Not a DDL defect, and not something the DDL can fix — but the server log is a durable store, so it
is measured rather than left to be discovered later. The design's claim that the identifier is
"never logged" is true of **every `RAISE` in the schema** — re-verified in gates 59–61 — but the
*statement text and its bound parameters* are logged by PostgreSQL itself, above the function.

**1 — worst case, provoked on purpose.** Under deliberately maximal logging
(`log_statement=all`, `log_min_duration_statement=0`, `log_parameter_max_length=-1`,
`log_parameter_max_length_on_error=-1`, `log_error_verbosity=verbose`) **140** log lines carry the
raw identifier or the contact value: 0 statement lines, 124 bind-parameter `DETAIL` lines, and 16
on-error parameter dumps. **None is authored by an alerts `RAISE`.**

That total is **run-dependent** — it tracks how many statements the suite happens to execute, and it
moved when gate 59's error-path coverage grew. It is a control that must be **non-zero**, not a
figure to regress against; gate 59 asserts exactly that, and that the five flags are armed.

**2 — replayed with `finmentor-prod`'s effective settings** (`log_statement=ddl`,
`log_min_duration_statement=-1`, `log_duration=off`, `log_parameter_max_length_on_error=0`): the
raw canonical request id appears in the server log **zero times**, on the successful path and on
both failure paths.

**3 — `auto_explain`, and this one is reachable — CONFIRMED, NOT INFERRED (gate 62).** With
production's exact settings (`auto_explain` preloaded, `log_min_duration` 10 000 ms,
`log_parameter_max_length` -1, `log_nested_statements` off) a **SUCCESSFUL** enqueue that crosses
10 s writes the raw canonical request id *and* `contact_value` to the server log as auto_explain
"Query Parameters":

```
LOG:  duration: 11017.246 ms  plan:
      Query Parameters: $2 = 'C-…-…', …
```

This is not an error path and not normal operation — an enqueue is sub-millisecond — but it is
reachable **under lock contention**, and prod has `lock_timeout = 0` with `statement_timeout = 120 s`,
so the 10–120 s window is open.

> **MITIGATION, PROVEN IN THE SAME RUN — a runtime credential precondition, not a DDL change.**
> `ALTER ROLE <runtime login> SET statement_timeout = '8s', lock_timeout = '5s'` — the same values
> Supabase already sets for its own `authenticator` role — caps every statement below the 10 s
> threshold. The contended enqueue is then **aborted rather than logged**
> (`55P03 canceling statement due to lock timeout`), it **commits nothing**, auto_explain never
> fires, and the identifier reaches the log **zero times**. It changes no database logging setting
> and no DDL.

**Operational preconditions for production**, therefore: keep `log_statement` at `none`/`ddl` and
`log_min_duration_statement` at `-1`; re-check both whenever slow-query logging is switched on for
debugging; and set the two timeouts above on the alerts runtime logins when they are created.
Confirming the project's live values is a **REQUIRES NON-PROD SUPABASE** item, together with
whether `pg_stat_statements` normalises the literal out.

---

## 7. Retention, repair window, and what is still open

| | |
|---|---|
| **PAYLOAD PURGE** | **PASS — 30 days, APPROVED.** Purges to `{}`, stamps `payload_purged_at`, leaves the identity and the delivery foreign keys internally valid, makes the row unclaimable and owner-visible, and re-creates nothing |
| **DELIVERY RETENTION** | **PASS — 180 days, APPROVED.** Terminal rows only. A `SENT` row past the horizon is swept; a `DELIVERY_UNKNOWN` awaiting an owner decision is **never** swept; the key row survives the sweep. Note: `updated_at` is maintained by the `new_lead_delivery_touch` trigger and could only be backdated for the test with that trigger disabled — which is precisely what makes the horizon meaningful |
| **KEY RETENTION** | **PENDING LEGAL / PRIVACY.** `key_retention_days` is `NULL`, status `PENDING_LEGAL_PRIVACY_FINALISATION`, and `purge_new_lead_keys()` **raises `0A000` rather than deleting or silently doing nothing** — proven. A `DECIDED_BOUNDED` status cannot be recorded without a horizon (CHECK). The word "forever" appears nowhere in the schema |
| **REPAIR WINDOW** | **PASS — 7 days, OWNER-APPROVED 2026-09-01, and now POLICY DATA.** Day 0, 3 and 6.99: a missing delivery is repaired. Day 7.01, 10 and 45: ordinary enqueue returns `EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW`, creates nothing, and **only** `alerts.repair_new_lead_deliveries` — the reconciler authority — restores it. The reconciler cannot repair an event that does not exist. **What changed since revision 2.1:** the window is no longer an `interval '7 days'` literal in the function body. Amendment 2.2-B moved it to `alerts.retention_policy.automatic_repair_days`, so changing an approved business policy is an `UPDATE` of one integer — proven to change behaviour with the function's oid, body and even its catalog `xmin` unchanged (gate 54). The rationale is recorded in the design: a NEW LEAD alert older than seven days must not be resurrected and sent as if it were fresh |
| **DELIVERY_UNKNOWN MAXIMUM RETENTION** | **STILL PENDING OWNER — but now a RECORDED pending decision, not an omission.** `purge_new_lead_deliveries()` sweeps only `SENT` and `PERMANENT_FAILED`, so an unresolved row is never removed — correct and intended, but unbounded. Amendment 2.2-C makes that explicit: the horizon is a `NULL` column with status `PENDING_OWNER`, a bounded decision cannot be recorded without a horizon (CHECK), and if the status ever changes to `DECIDED_BOUNDED` **the sweep raises `0A000 ALERTS_DELIVERY_UNKNOWN_HORIZON_NOT_IMPLEMENTED` rather than silently not deleting** (gate 58). The payload behind such a row is still purged at 30 days, so an unresolved delivery never preserves `contact_value` |
| **RAW PIPELINE REQUEST_ID RETENTION** | **OPEN.** Outside this migration |

### The gate 47 residual — CLOSED in revision 2.2

Revision 2.1 executed `GRANT alerts_owner TO current_user` and never revoked it, leaving the
Supabase `postgres` **login** inheriting full ownership of everything in `alerts` indefinitely. It
was recorded as a known residual rather than silently passed, because amendments 2.1-A and 2.1-D
make the migration and the rollback *depend* on that membership.

**Amendment 2.2-A closes it.** The forward migration now hands the working membership back before
`COMMIT`: it revokes `SET` and `INHERIT` and keeps only `ADMIN OPTION`, which confers neither
privilege but is what lets the migration be re-run and rolled back without a superuser. Proven at
all four lifecycle points (gates 49–52) — after clean apply, idempotent reapply, rollback, and
reapply after rollback — the migrator cannot `SET ROLE alerts_owner` (`42501`) and **cannot even
reach the schema it just created**. Amendment 2.2-E adds the matching post-condition on the
rollback: it *asserts* that no `alerts_*` role survives, rather than commenting that it dropped them.

The distinction that makes this work is the one defect 1 turned on, read the other way:
`ADMIN OPTION` without `SET`/`INHERIT` is administrative capability without standing privilege.

---

## 8. Status corrections carried forward

Exactly as the authorisation requires — **not** as a system-wide "resolved":

```
OUTBOX RAW REQUEST_ID STORAGE      = RESOLVED
OUTBOX RAW REQUEST_ID IN SERVER LOG = OPEN / CLOSED BY A RUNTIME PRECONDITION, NOT BY DDL  (§6)
PIPELINE RAW REQUEST_ID RETENTION  = OPEN
REQUEST FINGERPRINT CONFIRMABILITY = OPEN / ACCEPTED FOR CURRENT TEST
KEY RETENTION                      = PENDING LEGAL / PRIVACY
DELIVERY_UNKNOWN RETENTION         = PENDING OWNER / RECORDED AND FAIL-SAFE  (2.2-C)
AUTOMATIC REPAIR WINDOW            = APPROVED 7 DAYS, HELD AS POLICY DATA    (2.2-B)
MIGRATOR STANDING PRIVILEGE        = RESOLVED                                (2.2-A)
```

---

## 9. QA

| | |
|---|---|
| existing canonical suite | **64/64 gates, 2288 assertions, PASS** — unchanged. This work touched no n8n artifact and no `qa/` test |
| new non-production DDL suite | **53 gates, 644 assertions, 0 failures** (`db/validation/`) — re-run from a freshly `initdb`'d cluster against the regenerated migration, same result |
| syntax | every new `.mjs` passes `node --check` |
| **not** wired into CI | deliberately. It needs a live PostgreSQL cluster; `qa/` stays dependency-free and offline |
| pre-existing, unrelated | `node scripts/secret-scan.mjs` reports 1 candidate at `qa/lead-alerts-presentation.test.mjs:437` — a deliberate synthetic poison fixture. **It fails identically at HEAD**, before any change in this work |

---

## 10. Verdict

```
OUTBOX DDL NON-PROD VALIDATION   = PASS
READY FOR PRODUCTION DDL APPROVAL = YES
```

**STOP. Production DDL is NOT applied and will not be applied on the strength of this run.**
Every gate passing is a statement about **revision 2.2** on a disposable PostgreSQL 17.6 cluster. It
is not owner approval to touch `finmentor-prod`, and the `REQUIRES NON-PROD SUPABASE` list in §1
and the `PENDING OWNER` items in §7 are inputs to that separate decision.

Carried into that decision, explicitly:

* **One runtime precondition that is not DDL** — `statement_timeout = '8s'`, `lock_timeout = '5s'`
  on the alerts runtime logins, without which the `auto_explain` path in §6 is open. It cannot be
  satisfied by applying the migration; it is satisfied when the credentials are created.
* **`DELIVERY_UNKNOWN` retention is still undecided** — recorded and fail-safe (2.2-C), not closed.
* **Key retention is still `PENDING LEGAL / PRIVACY`**, and fingerprint confirmability is still
  accepted-for-this-cycle only, not resolved.
