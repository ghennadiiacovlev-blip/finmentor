# TELEGRAM DURABLE NEW LEAD DELIVERY — phase plan

**Opened 2026-09-01.** The phase named as next by
[the production apply record](NEW_LEAD_ALERT_OUTBOX_PRODUCTION_APPLY.md). This document is a
**plan and a runbook. Nothing in it has been applied to production.** No role was created on
`finmentor-prod`, no credential was created, no workflow was deployed or edited, no message was
sent. `qa/run-all.mjs` is unchanged at **64/64, 2288 assertions**, re-run at the time of writing.

**Updated the same day.** GATE 1's migration is no longer a sketch: it is written, generated from
this document, and **proven on the disposable PostgreSQL 17.6 cluster — 14 gates, 121 assertions,
0 failures** (§2.8). Proving it found five things a review could not have, one of them a defect in
`0001`'s rollback. GATE 1 remains **owner-blocked**: the migration creates two logins that cannot
authenticate, and only the owner can arm them.

---

## 0. Where this phase starts — re-verified live, not quoted

Read-only against `finmentor-prod` before writing a line of this plan:

```
alerts schema                    = PRESENT
alerts_* roles                   = 6, all NOLOGIN, all NOINHERIT
membership rows into alerts_*    = 7, EVERY ONE inherit_option=false AND set_option=false
new_lead_outbox rows             = 0
new_lead_delivery rows           = 0
both audit tables                = 0 rows
retention_policy                 = 1 row  (payload 30d, delivery 180d, repair 7d,
                                           key horizon PENDING_LEGAL_PRIVACY_FINALISATION,
                                           DELIVERY_UNKNOWN horizon PENDING_OWNER)
n8n credentials of type postgres = 3, NONE of them an alerts credential
runtime LOGIN                    = NONE
```

**The foundation is dormant exactly as accepted.** One correction of emphasis to the record: the
seven membership rows are not a curiosity, they are the reason the obvious shortcut is safe.

### The shortcut fails closed — measured, not assumed

The cheapest wrong move available in this phase is "point the new node at the existing
`FINMENTOR Supabase G5` Postgres credential". Measured on production:

| function | `has_function_privilege('postgres', …, 'EXECUTE')` |
|---|---|
| `alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text)` | **false** |
| `alerts.claim_new_lead_delivery(text,integer)` | **false** |
| `alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval)` | **false** |
| `alerts.expire_stale_claims(interval)` | **false** |
| `alerts.new_lead_attention()` | **false** |

Reusing an existing credential does not half-work and does not quietly work. It raises `42501`
on the first call. The isolation is **enforced by the grant graph, not documented in a comment.**

---

## 1. Gate order — what blocks what

```
GATE 1  RUNTIME CREDENTIAL          OWNER-BLOCKED — needs a secret. Blocks everything below.
GATE 2  WRITER SPLICE               enqueue at settlement. Blocked by GATE 1.
GATE 3  TELEGRAM DISPATCHER         claim -> send -> finalise. Blocked by GATE 1 and GATE 2.
GATE 4  JANITOR + ATTENTION         stale claims, human-settled states. Blocked by GATE 3.
```

The order is not preference. GATE 2 cannot be proven without a credential that can call
`enqueue_new_lead_b64`, and GATE 3 cannot be proven without rows that only GATE 2 creates.

---

## 2. GATE 1 — the runtime credential  **(OWNER-BLOCKED)**

### 2.1 How many logins this phase needs — two, not five

The non-prod validation proved the role isolation with **one login per runtime role**, five of them.
This phase needs only the two that Telegram delivery actually calls:

| login | member of | calls |
|---|---|---|
| `alerts_writer_rt` | `alerts_writer` | `enqueue_new_lead_b64` |
| `alerts_dispatcher_rt` | `alerts_dispatcher` | `claim_new_lead_delivery`, `finalise_new_lead_delivery`, `expire_stale_claims`, `new_lead_attention` |

`alerts_reconciler`, `alerts_retention` and `alerts_audit` get **no login in this phase.** They are
needed by the reconciler and retention phases, and creating them early only widens the credential
surface for no proof.

**One login per role, not one shared login.** A shared login would make "the dispatcher cannot
enqueue" a convention again, and that property is the whole reason the groups exist.

### 2.2 The secret never enters this repository

The precondition in
[§8 of the apply record](NEW_LEAD_ALERT_OUTBOX_PRODUCTION_APPLY.md) says the timeouts must be
applied **by the operation that creates the login**, because a credential that exists for even one
call without them leaves the `auto_explain` window open. A tracked migration carrying a password
would satisfy that and violate something worse.

**Both hold at once, by splitting on the password rather than on the settings:**

```
MIGRATION (tracked, reviewable, no secret)   OWNER, ONCE, OUT OF BAND
  CREATE ROLE ... LOGIN PASSWORD NULL          ALTER ROLE alerts_writer_rt     PASSWORD '<generated>';
  ALTER ROLE ... SET statement_timeout = 8s    ALTER ROLE alerts_dispatcher_rt PASSWORD '<generated>';
  ALTER ROLE ... SET lock_timeout      = 5s
  GRANT <group> TO ... WITH INHERIT TRUE
  GRANT <group> TO ... WITH SET FALSE
```

A `LOGIN` role with **no password verifier cannot authenticate** under `scram-sha-256`. Both halves
of that sentence were measured on `finmentor-prod`, not assumed:
`current_setting('password_encryption') = scram-sha-256`, and `pg_authid` is readable by the
migrator — `alerts_writer` shows `rolpassword IS NULL`, `postgres` and `authenticator` do not. So
between
the migration and the owner's `ALTER ROLE ... PASSWORD`, the login exists and is unusable — and the
timeouts are already on it. **The precondition is satisfied by construction: there is no instant at
which a usable credential lacks its settings.** Postgres DDL is transactional, so within the
migration the roles do not exist to any other session until commit.

The generated passwords go **only** into the two new n8n credentials. They are not written to this
repository, not echoed into a document, and not passed through a tool that persists them.

### 2.3 The forward migration, exactly

`db/migrations/0002_alerts_runtime_logins.up.sql` is **generated verbatim from this fence** by
`db/validation/extract-migration.mjs`. The document is the source of truth; the file is a
materialisation, and `git diff` after re-running the extractor must be empty.

```sql
-- ============================================================================
-- FINMENTOR — ALERTS RUNTIME LOGINS            forward migration
-- PRECONDITION: 0001_new_lead_alert_outbox is applied, and §8 of
-- NEW_LEAD_ALERT_OUTBOX_PRODUCTION_APPLY.md holds. This file carries NO password:
-- the logins it creates exist and CANNOT AUTHENTICATE until the owner sets one.
-- ============================================================================
BEGIN;

-- Which logins THIS run created. "the password is still NULL" is a post-condition only for a
-- login the owner has not armed yet; asserting it unconditionally would make the migration
-- un-re-runnable the moment the credential goes live. ON COMMIT DROP: nothing survives.
CREATE TEMP TABLE alerts_rt_created (login name PRIMARY KEY) ON COMMIT DROP;

DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('alerts_writer_rt',     'alerts_writer'),
      ('alerts_dispatcher_rt', 'alerts_dispatcher')) AS v(login, grp)
  LOOP
    -- 0001 must already be applied. A login created for a group that does not exist would be a
    -- credential with no privileges and no explanation.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.grp) THEN
      RAISE EXCEPTION 'ALERTS_RT_GROUP_MISSING (%)', r.grp USING ERRCODE = '42704';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.login) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB '
                     'NOCREATEROLE NOREPLICATION PASSWORD NULL', r.login);
      INSERT INTO alerts_rt_created VALUES (r.login);
    END IF;

    -- BEFORE the role can ever authenticate. Not afterwards. PASSWORD NULL is written by the
    -- CREATE above and NOWHERE ELSE: a re-run must never wipe the password the owner has set.
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r.login, '8s');
    EXECUTE format('ALTER ROLE %I SET lock_timeout      = %L', r.login, '5s');
    EXECUTE format('ALTER ROLE %I SET search_path       = %L', r.login, 'pg_catalog');

    -- INHERIT TRUE is what makes EXECUTE usable without SET ROLE. SET FALSE stops the login
    -- assuming the group and acting outside its own audit identity.
    -- TWO STATEMENTS, ONE OPTION EACH -- see note 2 below. This is not a style choice.
    EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE', r.grp, r.login);
    EXECUTE format('GRANT %I TO %I WITH SET FALSE',    r.grp, r.login);

    -- A CREATEROLE migrator is auto-granted membership in every role it creates. Under the
    -- default `createrole_self_grant` that grant carries ADMIN only -- but the GUC exists, and
    -- where it is set the migrator would quietly keep the ability to BECOME the credential.
    -- Conditional, because REVOKE ... OPTION FOR on an absent membership only warns, and a
    -- migration that emits warnings on every clean run teaches everyone to ignore them.
    IF EXISTS (SELECT 1 FROM pg_auth_members m
                 JOIN pg_roles t ON t.oid = m.roleid
                 JOIN pg_roles g ON g.oid = m.member
                WHERE t.rolname = r.login AND g.rolname = current_user
                  AND (m.set_option OR m.inherit_option)) THEN
      EXECUTE format('REVOKE SET OPTION FOR %I FROM %I',     r.login, current_user);
      EXECUTE format('REVOKE INHERIT OPTION FOR %I FROM %I', r.login, current_user);
    END IF;
  END LOOP;
END $mig$;
```

Five things in that block are load-bearing and must not be "simplified":

1. **`NOINHERIT` on the role, `INHERIT TRUE` on the grant.** In PostgreSQL 16+ the *per-grant*
   `inherit_option` governs, and `rolinherit` is only the default for future grants. Writing
   `INHERIT` on the role instead would silently widen every grant the role is later given.
2. **One grant option per `GRANT` statement.** `GRANT ... TO ... WITH INHERIT TRUE, SET FALSE` is
   **not valid syntax** — the clause accepts a single
   `{ ADMIN | INHERIT | SET } { OPTION | TRUE | FALSE }`, not a list. `0001` already pays this
   cost twice, in both the up and the down migration, and the first draft of this plan got it
   wrong. Two statements.
3. **`SET FALSE` must be named explicitly, and naming it also makes the migration re-runnable.**
   A new grant defaults to `set_option = true`, so silence here would hand the login the ability
   to `SET ROLE` its own group. And per `0001`'s amendment 2.2-A, a *bare* `GRANT role TO member`
   does not update an existing membership — PostgreSQL answers `NOTICE "is already a member of
   role"` and changes nothing. Named options update an existing grant; unnamed ones make the
   second run a silent no-op.
4. **`PASSWORD NULL` is inside the `IF NOT EXISTS`, not beside the `ALTER`s.** The timeouts are
   re-asserted on every run because they must converge; the password must **not** be, because
   after GATE 1 the owner's secret lives there. A migration that re-runs and disarms the live
   credential is the same class of defect as one that never arms it.
5. **The generated password never enters this repository.** See §2.2.

### 2.4 Post-conditions the migration asserts before it commits

```
for each of the two logins:
  rolcanlogin = true, rolinherit = false, and no other role attribute set
  pg_authid.rolpassword IS NULL                      = true      (logins created by THIS run only)
  rolconfig contains statement_timeout=8s            = true
  rolconfig contains lock_timeout=5s                 = true
  membership into its OWN group:  inherit_option     = true
                                  set_option         = false
  memberships in total                               = exactly 1
  has_function_privilege(login, <its own fns>)       = true
  has_function_privilege(login, <the other's fns>)   = false
  has_function_privilege(login, <nobody's fns>)      = false
  has_table_privilege(login, alerts.*, S/I/U/D)      = false for all four verbs, all five relations
  has_schema_privilege(login, alerts, USAGE/CREATE)  = true / false
  G5 reachable from either login                     = false
  ANY role holding SET or INHERIT on either login    = 0 rows
```

The last four are the ones worth failing the migration over. A writer that can `SELECT` the outbox,
a dispatcher that can enqueue, or anything at all that can `SET ROLE` into a live credential is the
design being undone quietly.

**Every lookup below is by OID, and that is forced, not stylistic.** Measured on the disposable
cluster: `'alerts.new_lead_attention()'::regprocedure`, `has_function_privilege(…, 'alerts.f()')`
and `has_table_privilege(…, 'alerts.t')` all fail **`42501 permission denied for schema alerts`**
for this migrator. The name overloads resolve the schema through `LookupExplicitNamespace`, which
checks `USAGE` — and `0001` deliberately ends with the migrator holding **no** `USAGE` on the schema
it just created. Catalog reads through `pg_proc` and `pg_class` are not privilege-checked, so the
matrix is built from OIDs. A superuser run would never have found this: it would have passed by
name and the migration would have failed the first time it met the real `postgres` role.

```sql
DO $chk$
DECLARE
  r        record;
  v_bad    text := '';
  v_alerts oid  := (SELECT oid FROM pg_namespace WHERE nspname = 'alerts');
BEGIN
  IF v_alerts IS NULL THEN
    RAISE EXCEPTION 'ALERTS_RT_SCHEMA_MISSING' USING ERRCODE = '3F000';
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('alerts_writer_rt',     'alerts_writer'),
      ('alerts_dispatcher_rt', 'alerts_dispatcher')) AS v(login, grp)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles
                    WHERE rolname = r.login AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
                      AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
                      AND NOT rolreplication) THEN
      v_bad := v_bad || format(' %s:attributes', r.login);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.login
                     AND rolconfig @> ARRAY['statement_timeout=8s','lock_timeout=5s']) THEN
      v_bad := v_bad || format(' %s:rolconfig', r.login);
    END IF;

    -- Only for a login this run created (see the TEMP TABLE above). Where pg_authid is not
    -- readable the check is NOTICEd as skipped rather than silently counted as a pass.
    IF EXISTS (SELECT 1 FROM alerts_rt_created c WHERE c.login = r.login) THEN
      IF has_table_privilege(current_user, 'pg_authid', 'SELECT') THEN
        IF EXISTS (SELECT 1 FROM pg_authid WHERE rolname = r.login AND rolpassword IS NOT NULL) THEN
          v_bad := v_bad || format(' %s:password_not_null', r.login);
        END IF;
      ELSE
        RAISE NOTICE 'ALERTS_RT_PASSWORD_CHECK_SKIPPED (%): pg_authid is not readable by %',
                     r.login, current_user;
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_auth_members m
                     JOIN pg_roles t ON t.oid = m.roleid
                     JOIN pg_roles g ON g.oid = m.member
                    WHERE g.rolname = r.login AND t.rolname = r.grp
                      AND m.inherit_option AND NOT m.set_option) THEN
      v_bad := v_bad || format(' %s:own_membership', r.login);
    END IF;

    IF (SELECT count(*) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.member
         WHERE g.rolname = r.login) <> 1 THEN
      v_bad := v_bad || format(' %s:extra_membership', r.login);
    END IF;

    IF NOT has_schema_privilege(r.login, v_alerts, 'USAGE') THEN
      v_bad := v_bad || format(' %s:no_schema_usage', r.login);
    END IF;
    IF has_schema_privilege(r.login, v_alerts, 'CREATE') THEN
      v_bad := v_bad || format(' %s:schema_create', r.login);
    END IF;
  END LOOP;

  -- EXECUTE, both ways round: what each login must be able to call, and what it must not.
  -- `n` guards the assumption the name lookup rests on: if an overload is ever added, the
  -- matrix would quietly check only one of them, so it fails instead.
  FOR r IN
    SELECT l.login, v.proname, p.oid AS fnoid, (v.holder = l.login) AS expected,
           (SELECT count(*) FROM pg_proc x
             WHERE x.pronamespace = v_alerts AND x.proname = v.proname) AS n
      FROM (VALUES ('alerts_writer_rt'), ('alerts_dispatcher_rt')) AS l(login)
      CROSS JOIN (VALUES
        ('enqueue_new_lead',            'alerts_writer_rt'),
        ('enqueue_new_lead_b64',        'alerts_writer_rt'),
        ('claim_new_lead_delivery',     'alerts_dispatcher_rt'),
        ('finalise_new_lead_delivery',  'alerts_dispatcher_rt'),
        ('expire_stale_claims',         'alerts_dispatcher_rt'),
        ('new_lead_attention',          'alerts_dispatcher_rt'),
        ('request_fingerprint',         '-'),
        ('new_lead_events_present',     '-'),
        ('repair_new_lead_deliveries',  '-'),
        ('purge_new_lead_payloads',     '-'),
        ('purge_new_lead_deliveries',   '-'),
        ('purge_new_lead_keys',         '-')) AS v(proname, holder)
      LEFT JOIN pg_proc p ON p.pronamespace = v_alerts AND p.proname = v.proname
  LOOP
    IF r.n <> 1 THEN
      v_bad := v_bad || format(' alerts.%s:resolves_to_%s', r.proname, r.n);
    ELSIF has_function_privilege(r.login, r.fnoid, 'EXECUTE') <> r.expected THEN
      v_bad := v_bad || format(' %s:EXECUTE(%s)<>%s', r.login, r.proname, r.expected);
    END IF;
  END LOOP;

  -- No table privilege anywhere in the schema, on any relation, by any verb.
  FOR r IN
    SELECT l.login, t.relname, c.oid AS reloid, p.priv
      FROM (VALUES ('alerts_writer_rt'), ('alerts_dispatcher_rt')) AS l(login)
      CROSS JOIN (VALUES ('new_lead_outbox'), ('new_lead_delivery'), ('retention_policy'),
                         ('new_lead_outbox_audit'), ('new_lead_delivery_audit')) AS t(relname)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
      LEFT JOIN pg_class c ON c.relnamespace = v_alerts AND c.relname = t.relname
  LOOP
    IF r.reloid IS NULL THEN
      v_bad := v_bad || format(' alerts.%s:missing', r.relname);
    ELSIF has_table_privilege(r.login, r.reloid, r.priv) THEN
      v_bad := v_bad || format(' %s:%s_ON_%s', r.login, r.priv, r.relname);
    END IF;
  END LOOP;

  -- G5 is a different system. Neither login may reach its ledger, by any verb. The join is the
  -- guard: where G5 is absent there is nothing to prove and the loop simply does not run.
  FOR r IN
    SELECT l.login, p.priv, c.oid AS reloid
      FROM (VALUES ('alerts_writer_rt'), ('alerts_dispatcher_rt')) AS l(login)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
      JOIN pg_class c ON c.relname = 'telegram_initdata_replays'
      JOIN pg_namespace g5 ON g5.oid = c.relnamespace AND g5.nspname = 'public'
  LOOP
    IF has_table_privilege(r.login, r.reloid, r.priv) THEN
      v_bad := v_bad || format(' %s:G5_%s', r.login, r.priv);
    END IF;
  END LOOP;

  -- Nobody -- not the migrator, not a leftover grant -- may BECOME either login or inherit its
  -- privileges. A credential another role can assume is not a credential.
  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
              WHERE t.rolname IN ('alerts_writer_rt','alerts_dispatcher_rt')
                AND (m.set_option OR m.inherit_option)) THEN
    v_bad := v_bad || ' any_role:set_or_inherit_on_a_runtime_login';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'ALERTS_RT_POSTCONDITION_FAILED (%)', v_bad USING ERRCODE = '42501';
  END IF;
END $chk$;

COMMIT;
```

### 2.5 **MUST-VERIFY, and it is not verifiable from SQL** — the pooler

`ALTER ROLE ... SET` applies at connection start-up on the *server* connection. n8n reaches Supabase
through a connection path this repository has not measured for these roles, and a transaction-mode
pooler in front of Postgres can change which session settings a client actually observes.

**The timeouts must therefore be proven through the n8n Postgres node itself, not through the
Supabase MCP.** The first thing the new credential runs, before it is allowed to enqueue anything:

```sql
SELECT current_user, current_setting('statement_timeout') AS st,
                     current_setting('lock_timeout')      AS lt;
```

```
REQUIRED:  current_user = alerts_writer_rt      st = 8s      lt = 5s
```

If the pooler flattens those, the whole `auto_explain` argument in §8 of the apply record is void
and the phase stops there — the fix would be a connection-string-level `options=-c` setting, or the
direct (non-pooled) port, and that is a decision, not a workaround to apply silently.

**This is the single highest-value cheap measurement in the phase, and it cannot be taken until the
credential exists.**

**A correction of strength, measured in §2.8 gate E4.** `statement_timeout` is `USERSET`: the role
setting is a **default, not a cap**. From inside a session opened as `alerts_writer_rt`, a plain
`SET statement_timeout = '90s'` was accepted and took effect; `RESET` returned it to `8s`, the role
value, not the cluster value. So the mitigation the apply record proved against `auto_explain`
means *no statement runs long by accident* — never *no statement can run long*. Nothing in the
design depends on the stronger reading, and the weaker one is still exactly what the risk needed:
the exposure was a slow enqueue under lock contention, not a client choosing to wait. It matters
here only because the harness itself fell into it — the validation harness sets its own
`statement_timeout` on every connection it opens, and the first run of gate E4 dutifully reported
`90s`, the harness's value, as though it were the role's.

### 2.6 What the owner must decide or do

```
1. APPROVE creating two LOGIN roles on finmentor-prod       (this document is the review copy)
2. RUN two ALTER ROLE ... PASSWORD statements with generated secrets
3. CREATE two n8n Postgres credentials with those secrets
4. CONFIRM which connection path/port n8n should use        (feeds §2.5)
```

Steps 2 and 3 involve secret material and are **not** actions this session will take unilaterally.
Step 1 is the only thing gating the rest of the plan.

### 2.7 The rollback, exactly

`db/migrations/0002_alerts_runtime_logins.down.sql`, generated from this fence by the same
extractor. It removes the two logins and **nothing else**: the six group roles, the schema, every
object in it and G5 are 0001's business, not this migration's.

```sql
-- ============================================================================
-- FINMENTOR — ALERTS RUNTIME LOGINS            rollback
-- Removes ONLY the two runtime logins. The alerts_* GROUP roles, the alerts schema and
-- everything in it belong to 0001 and are left exactly as they were.
-- ORDERING: run this BEFORE 0001's rollback. See §2.8.
-- ============================================================================
BEGIN;

DO $rb$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['alerts_writer_rt','alerts_dispatcher_rt'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- These logins own nothing and hold no direct privilege -- but "nothing" is a claim, and
      -- DROP OWNED BY is the only statement that makes it true rather than asserted. It needs
      -- the PRIVILEGES of the role: 0001's amendment 2.1-D, where a CREATEROLE migrator's
      -- automatic membership carried neither SET nor INHERIT and every DROP OWNED BY failed
      -- 42501. The grant lives for the length of this transaction; DROP ROLE destroys it.
      EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE', r, current_user);
      EXECUTE format('DROP OWNED BY %I', r);
      EXECUTE format('DROP ROLE %I', r);
    END IF;
  END LOOP;
END $rb$;

-- POST-CONDITION, ASSERTED. Same reasoning as 0001's rollback: the temporary membership above
-- is destroyed only as a side effect of DROP ROLE, and "only as a side effect" is exactly what
-- stops being true after an edit. If either login survives, this rollback ABORTS -- and being
-- one transaction, that also undoes the grant it just made to itself.
DO $rb$
DECLARE v_left text;
BEGIN
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_left
    FROM pg_roles WHERE rolname IN ('alerts_writer_rt','alerts_dispatcher_rt');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'ALERTS_RT_ROLLBACK_RESIDUAL (%)', v_left USING ERRCODE = '42501';
  END IF;

  -- And it must not have taken 0001 with it.
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
       ('alerts_owner','alerts_writer','alerts_dispatcher',
        'alerts_reconciler','alerts_retention','alerts_audit')) <> 6 THEN
    RAISE EXCEPTION 'ALERTS_RT_ROLLBACK_DAMAGED_0001' USING ERRCODE = '42501';
  END IF;
END $rb$;

COMMIT;
```

### 2.8 The migration is PROVEN on real PostgreSQL — and the five things only the run could show

Executed 2026-09-01 on the same disposable **PostgreSQL 17.6** cluster the outbox DDL was proven
on: loopback only, synthetic data only, `finmentor-prod` never contacted. Migrator: the
`NOSUPERUSER CREATEROLE LOGIN` shape of Supabase's `postgres`, asserted before anything runs.

```
node db/validation/run-validation-0002.mjs

PASS  PRE   GATE 1 starts where GATE 0 finished: 0001 applied, and no runtime login anywhere
PASS  E1    CLEAN APPLY of 0002, as the non-superuser migrator
PASS  E2    the §2.4 post-conditions, measured from the catalog rather than trusted
PASS  E3    the migrator keeps ADMIN and nothing else -- it cannot BECOME a credential it made
PASS  E4    the credential is INERT until the owner arms it -- and the timeouts arrive with it
PASS  E5    each credential can do its own job and NOTHING ELSE -- measured per login
PASS  E6    DISARMING is a single statement, and it is complete
PASS  E7    IDEMPOTENT REAPPLY, and CONVERGENCE from a hand-altered state
PASS  E8    a grant the migration CANNOT repair -- a stranger's -- makes it REFUSE
PASS  E9    a re-run must NEVER disarm a credential the owner has armed
PASS  E10   ROLLBACK removes the two logins and NOTHING ELSE
PASS  E11   REAPPLY AFTER ROLLBACK
PASS  E12   ROLLBACK ORDERING is enforced, not documented (0001 amendment 2.3-A)
PASS  E13   0002 REFUSES to create a credential when 0001 is not applied

gates: 14   failed: 0   assertions: 121
```

`qa/run-all.mjs` after all of it: **64/64, 2288 assertions**. The 0001 suite, re-run because its
rollback changed: **53 gates, 644 assertions, 0 failures**. `0001`'s **forward** migration
regenerates byte-identical — what is deployed on production is untouched.

#### The control that had to be armed first

Every assertion of the form *"this credential cannot log in"* is worthless on a cluster where
nothing can fail to log in, and `initdb` writes **`trust`** for host connections by default. The
first run would have measured nothing. So `pg_hba.conf` is set to `scram-sha-256` and **gate E4
opens with a negative control**: a deliberately wrong password for a role that certainly has one
must be refused. On a `trust` cluster that control fails and takes the whole gate with it, instead
of reporting a green run from an experiment that never happened.

#### 1. The migrator cannot look anything up by name — and that is 0001 working correctly

The first draft of §2.4 asserted the privilege matrix through `'alerts.f()'::regprocedure` and
`has_table_privilege(login, 'alerts.new_lead_outbox', …)`. Every one of them failed:

```
42501  permission denied for schema alerts
```

The name-taking overloads resolve the schema through `LookupExplicitNamespace`, which checks
`USAGE` — and `0001` deliberately ends with the migrator holding **no** `USAGE` on the schema it
created. Catalog reads through `pg_proc` and `pg_class` are not privilege-checked, so the matrix
is built from OIDs instead. **A superuser run would have passed by name**, and the migration would
have met this for the first time on `finmentor-prod`.

#### 2. `pg_auth_members` is keyed on the GRANTOR — so convergence has a boundary

`GRANT alerts_writer TO alerts_writer_rt WITH SET TRUE` does two entirely different things
depending on who runs it:

| who plants it | what happens | what a re-run of 0002 does |
|---|---|---|
| the **migrator** | the existing membership row is **updated** | **repairs it** — `set_option` back to `false` (E7) |
| **anyone else** (a superuser, the dashboard) | a **second row** appears, same role, same member, different grantor | **cannot reach it. Refuses to commit** (E8) |

That boundary was not designed; it was found. It is also the right behaviour, and it is now
asserted in both directions: the migration converges over its own grants and **fails closed** over
anyone else's, rather than reporting success over a credential it does not govern. The operator
consequence is one line: *if 0002 aborts with `extra_membership`, someone granted a role by hand,
and only they — or a superuser — can take it back.*

#### 3. `0001`'s rollback orphaned the credentials, silently

Gate E12 ran `0001`'s rollback with the two logins present. It **succeeded**, dropped the six group
roles, and left `alerts_writer_rt` and `alerts_dispatcher_rt` behind: logins carrying whatever
password the owner had set, members of nothing, pointing at a schema that had just been dropped.
`DROP ROLE` removes memberships silently. Nothing failed and nothing said so.

Fixed as [amendment 2.3-A](NEW_LEAD_ALERT_OUTBOX_DDL_REVIEW.md) — `0001`'s rollback now refuses,
by name, before dropping anything:

```
2BP01  ALERTS_ROLLBACK_RUNTIME_LOGIN_PRESENT
       (alerts_dispatcher_rt, alerts_writer_rt) -- roll back 0002 first
```

The forward DDL did not change, so this costs production nothing. **The rollback order stopped
being a sentence in a runbook and became a statement in the migration**, proven both ways round.

#### 4. The timeout is a default, not a cap — and the harness proved it by accident

See §2.5. Gate E4's first run reported `statement_timeout = 90s` with `source = session`: the
validation harness sets its own timeouts on every connection it opens, so it measured **itself** and
labelled the result as the role's. The harness now opens runtime logins raw. What the measurement
left behind is worth more than the fix: a client can override the role setting at will, so the
`auto_explain` mitigation means *nothing runs long by accident*, not *nothing can run long*.

#### 5. `pg_authid` is closed here and open on production — so the skip is announced

The post-condition *"the login this run created still has no password verifier"* needs `pg_authid`.
On this cluster the migrator cannot read it; on `finmentor-prod` it can (§2.2, measured read-only).
The migration therefore takes a different branch in the two environments, and the branch it takes
is **announced**:

```
NOTICE  ALERTS_RT_PASSWORD_CHECK_SKIPPED (alerts_writer_rt): pg_authid is not readable by fm_migrator
```

The gate asserts the biconditional — the check is either taken or the notice is raised, never
silently passed — and the harness takes the measurement itself, as a superuser, either way.

#### What the run did *not* prove

Only the pooler question of §2.5, and it cannot be proven here: this cluster has no pooler, and
the measurement that matters is the one taken **through the n8n Postgres node** against
`finmentor-prod`. It stays GATE 1's first live step, after the owner arms the credential.

---

## 3. GATE 2 — the writer splice

### 3.1 Where, and why exactly there

The enqueue is **post-settlement**: it may only run after the Pipeline append has committed, on the
`IF Committed (New)` branch of `QmIyEW2ZEqKregmN FINMENTOR Lead Intake PREMIUM FINAL`. The
[post-settlement dispatch design](NEW_LEAD_ALERT_POST_SETTLEMENT_DISPATCH_DESIGN.md) already
established the branch and the node ordering; what changes is that the node now writes to a durable
store instead of firing a sub-workflow at Telegram.

### 3.2 The call

```sql
SELECT * FROM alerts.enqueue_new_lead_b64($1, $2, $3, $4, $5);
--  1 p_request_route  'public' | 'concierge' | 'miniapp'
--  2 p_request_id     RAW canonical identity — TRANSIENT, never stored, never echoed
--  3 p_lead_id
--  4 p_settled_at
--  5 p_payload_b64    base64 of the eleven-field payload_json
```

**The `_b64` wrapper is mandatory, not stylistic.** The deployed n8n Postgres node splits
`queryReplacement` on commas *before* resolving expressions, and a JSON payload is nothing but
commas. Base64 has none. Passing `enqueue_new_lead` directly with a `jsonb` argument will corrupt
the parameter list.

### 3.3 Failure containment

`onError: 'continueRegularOutput'` on the enqueue node. Not `continueErrorOutput`, and
`alwaysOutputData` stays off — with `continueErrorOutput` that combination fires **both** outputs on
failure, which is the class of defect already fixed twice in this system.

A store outage must not change the customer's response. The enqueue failing means the owner is not
told about a lead that *was* accepted — which is precisely a case for the deployed
`FINMENTOR SYSTEM ALERT` path, and is the one new alert condition this gate introduces.

### 3.4 Convergence is the database's job, not the graph's

`enqueue_new_lead` is convergent by contract: the same canonical request leaves exactly 1 event +
1 telegram row + 1 email row, and restores a *missing* delivery row within
`retention_policy.automatic_repair_days` (currently 7). The graph therefore does **not** need a
"have we already enqueued this" guard, and must not grow one — a guard would reintroduce the
read-then-write race the composite key exists to remove.

---

## 4. GATE 3 — the Telegram dispatcher

### 4.1 Shape

```
Schedule Trigger -> Claim -> (no row? stop) -> Render -> Telegram sendMessage -> Classify -> Finalise
```

```sql
-- claim
SELECT * FROM alerts.claim_new_lead_delivery('telegram', 8);
-- finalise
SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,$3,$4,$5,$6);
--   1 dispatch_key   2 claim_token   3 outcome
--   4 error_code (^[A-Z][A-Z0-9_]{2,39}$ or NULL)   5 provider_message_id   6 retry_after interval
```

`Render` consumes `out_payload_json` through the **existing, unchanged** `renderNewLead` presenter
in `n8n/src/lead-alerts/presenter.js`. The dispatcher writes no lead, no receipt and no Pipeline
row. It is a delivery machine and nothing else.

### 4.2 The outcome map — Telegram-specific, four ways

The deployed `CHECK` accepts exactly `SENT`, `RETRYABLE_FAILED`, `DELIVERY_UNKNOWN`,
`PERMANENT_FAILED`.

| observed | outcome | error_code | note |
|---|---|---|---|
| `200` with `ok:true` | `SENT` | — | `provider_message_id = result.message_id` |
| `400` bad request / chat not found | `PERMANENT_FAILED` | `TELEGRAM_BAD_REQUEST` | retrying cannot help |
| `403` bot blocked / kicked | `PERMANENT_FAILED` | `TELEGRAM_FORBIDDEN` | the destination refused the bot |
| `401` unauthorised (bad token) | `RETRYABLE_FAILED` | `TELEGRAM_UNAUTHORIZED` | **see below** |
| `429` | `RETRYABLE_FAILED` | `TELEGRAM_RATE_LIMITED` | `p_retry_after = parameters.retry_after` seconds |
| `5xx` | `RETRYABLE_FAILED` | `TELEGRAM_SERVER_ERROR` | |
| DNS / connection refused / TLS failure | `RETRYABLE_FAILED` | `TELEGRAM_UNREACHABLE` | provably never sent |
| request timeout, or connection dropped after send | `DELIVERY_UNKNOWN` | `TELEGRAM_TIMEOUT` | may have gone out |

**`401` is deliberately not permanent.** A revoked or mistyped bot token fails *every* pending row
identically; classing it terminal would burn the entire queue for an operator fault that is fixed by
replacing a credential. It is retryable **and** raises a SYSTEM ALERT, because retrying forever
without telling anyone is the other way to lose the leads.

**The timeout row is the one that cannot be softened.** An n8n HTTP timeout always occurs after the
request was written to the socket, so "provably not sent" is unavailable. `DELIVERY_UNKNOWN` is
terminal and human-settled by design; `expire_stale_claims` never reclaims it. Classifying a timeout
as retryable would double-notify the owner, and that is the failure this whole design was built to
avoid.

Classification lives in **one** shared module used by both the workflow and its tests. A verifier
that re-implements the mapping will drift from the graph, which this repository has already paid for
once.

### 4.3 Vocabulary correction

[The dual-channel design §10](NEW_LEAD_ALERT_DUAL_CHANNEL_DESIGN.md) names two states
`FAILED_TERMINAL` and `RETRYABLE`. **Those names were never deployed.** The applied DDL uses
`PERMANENT_FAILED` and `RETRYABLE_FAILED`, and a `finalise` call using the design document's
spelling raises `ALERTS_OUTCOME_INVALID` (`22023`). The deployed constraint is authoritative; the
design document predates it.

### 4.4 The gap between claim and finalise

`attempt_count` increments at **claim**, not at send. A dispatcher that dies mid-flight leaves the
row `CLAIMED`, and `expire_stale_claims` moves it to `DELIVERY_UNKNOWN` after 15 minutes — never
back to claimable. That is correct and must stay correct: the design would rather ask a human than
send the owner the same lead twice.

Consequence for the graph: **claim, send and finalise must complete inside one execution.** No
`wait` node, no split across workflows, no batching that could strand a claim.

---

## 5. GATE 4 — janitor and attention

```
expire_stale_claims('15 minutes')   scheduled, dispatcher credential
new_lead_attention()                scheduled, -> SYSTEM ALERT when it returns rows
```

`new_lead_attention()` returns exactly the states no machine may resolve: `DELIVERY_UNKNOWN`,
`PERMANENT_FAILED`, claims stuck past 15 minutes, and undelivered rows whose payload has been
purged. A non-empty result is a message to a human, not an input to a retry.

---

## 6. What must be proven before this phase is called done

Three of these are **already proven on real PostgreSQL** (§2.8). They are kept in the table
because a non-production proof is not a production proof: the same gates must be re-taken against
`finmentor-prod` once the owner arms the credential, and the only one that *cannot* be taken
anywhere else is B.

| | gate | proof | status |
|---|---|---|---|
| A | 1 | both logins exist, cannot authenticate until the owner sets a password, and carry 8s/5s | **PROVEN non-prod** (E2, E4) |
| B | 1 | **`SHOW statement_timeout` = 8s through the n8n node itself** (§2.5) | **OPEN — cannot be taken off production** |
| C | 1 | writer cannot claim; dispatcher cannot enqueue; neither can touch a table or G5 — measured per login, not by `SET ROLE` | **PROVEN non-prod** (E5) |
| C2 | 1 | rolling GATE 1 back removes both logins and nothing else, and cannot orphan one | **PROVEN non-prod** (E10, E12) |
| D | 2 | one public NEW lead -> exactly 1 event + 1 telegram + 1 email row | |
| E | 2 | exact replay of a committed submission -> **0** additional rows, response byte-identical | |
| F | 2 | enqueue forced to fail -> customer response unchanged and `ok:true`; 1 SYSTEM ALERT | |
| G | 3 | claim -> send -> finalise leaves `SENT` with `sent_at` and a `message_id`, `attempt_count = 1` | |
| H | 3 | two dispatchers racing one row: exactly one claims, the loser gets 0 rows, 1 message sent | |
| I | 3 | `finalise` with a stale token returns `NOT_OWNED` and writes nothing | |
| J | 3 | each of the eight rows of the §4.2 map, including a forced timeout -> `DELIVERY_UNKNOWN` | |
| K | 3 | a `DELIVERY_UNKNOWN` row is never re-claimed by any subsequent dispatcher run | |
| L | 4 | a killed dispatcher's claim becomes `DELIVERY_UNKNOWN` at 15 min and raises attention | |
| M | all | **email rows stay `PENDING` throughout.** Telegram delivery must not touch the email channel | |

M is the cheap check that the per-channel primary key is doing what it was designed to do.

---

## 7. What this pass did not do

**On `finmentor-prod`: nothing.** No role, no password, no grant, no migration applied, no n8n
credential, no workflow created or edited, no node deployed, no Telegram message sent, no email.
No change to `renderNewLead`, to `QmIyEW2ZEqKregmN`, to cycle projection, or to `qa/`. Production
was read **read-only**; `alerts.new_lead_outbox` and `alerts.new_lead_delivery` still hold 0 rows,
and the deployed `0001` forward DDL regenerates byte-identical.

What it *did* do, all of it off production: wrote §2.3, §2.4 and §2.7, generated
`db/migrations/0002_alerts_runtime_logins.{up,down}.sql` from them, added the second validation
suite (`db/validation/run-validation-0002.mjs`, `gates-e.mjs`), proved 14 gates / 121 assertions
on a disposable PostgreSQL 17.6 cluster, and amended `0001`'s **rollback** — never applied
anywhere — so that it can no longer orphan a runtime credential.

```
TELEGRAM DURABLE NEW LEAD DELIVERY = GATE 1 WRITTEN AND PROVEN NON-PROD / OWNER-BLOCKED
OUTBOX PRODUCTION FOUNDATION       = READY, unchanged, still dormant
CUSTOMER PRODUCTION                = BLOCKED
```

Unchanged and still open: `KEY RETENTION = PENDING LEGAL / PRIVACY`,
`DELIVERY_UNKNOWN RETENTION = PENDING OWNER`, `PIPELINE RAW REQUEST_ID RETENTION = OPEN`,
`AUTHORITATIVE CYCLE PROJECTION = OPEN`, `EMAIL DURABLE NEW LEAD DELIVERY = BLOCKED`.

---

# 8. The Cloud Run relay identity — migration 0003

**Opened 2026-09-02.** GATE 1B could not be completed through the n8n Postgres node: n8n Cloud's
Postgres credential has no field for a CA certificate (measured — its entire TLS surface is `ssl`
and `allowUnauthorizedCerts`), and Supavisor presents a certificate signed by Supabase's own CA.
Three alternatives were audited and rejected — `allowUnauthorizedCerts` (unverified TLS), PostgREST
RPC (needs project-wide JWT signing authority), and a Supabase Edge Function (the platform injects
`SUPABASE_DB_URL` and RLS-bypassing keys into every function and reserves the `SUPABASE_` prefix, so
they cannot be removed or even shadowed).

The accepted architecture is an **external least-privilege relay** on Google Cloud Run. Its TLS
model is proven: the published **Supabase Root 2021 CA** validates `CN=*.pooler.supabase.com`
through `Supabase Intermediate 2021 CA` with hostname verification — `Verify return code: 0 (ok)`.
Nothing is downgraded anywhere.

### 8.0 Two identities, one group — and why

| identity | runtime | credential lives in |
|---|---|---|
| `alerts_writer_rt` | the n8n Postgres path | n8n credential `FINMENTOR Alerts Writer` |
| `alerts_writer_relay_rt` | the Cloud Run relay | Google Secret Manager |

**The only authority they share is inherited membership in the NOLOGIN group `alerts_writer`.**
Their passwords are independent, rotate independently and revoke independently; neither is a member
of the other; compromise of one reveals nothing about the other. `0003` never names
`alerts_writer_rt` except to assert that no membership exists between them, and it never touches
its password.

**Geography, stated separately from network and billing claims.** The relay targets Cloud Run
`europe-west3` (Frankfurt) and the database is Supabase `eu-central-1` (Frankfurt): the same metro,
which is the sensible low-latency pairing. That is a statement about geography only. **The path
still crosses Google Cloud to Supabase/AWS infrastructure**, and neither live latency nor egress
cost has been measured. Both remain open until the hosted probe runs.

### 8.1 The forward migration, exactly

`db/migrations/0003_alerts_writer_relay_login.up.sql` is generated verbatim from this fence.
**`0002` is deliberately NOT a precondition:** the relay identity depends only on `0001`'s
`alerts_writer` group, so the two runtimes stay independent in both directions.

```sql
-- ============================================================================
-- FINMENTOR — ALERTS WRITER RELAY LOGIN         forward migration
-- PRECONDITION: 0001_new_lead_alert_outbox is applied. 0002 is NOT required.
-- This file carries NO password: the login it creates exists and CANNOT
-- AUTHENTICATE until the owner arms it out of band (§2.2 applies unchanged).
-- ============================================================================
BEGIN;

-- Which login THIS run created. "the password is still NULL" is a post-condition only for a
-- login the owner has not armed yet. ON COMMIT DROP: nothing survives.
CREATE TEMP TABLE alerts_relay_created (login name PRIMARY KEY) ON COMMIT DROP;

DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('alerts_writer_relay_rt', 'alerts_writer')) AS v(login, grp)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.grp) THEN
      RAISE EXCEPTION 'ALERTS_RELAY_GROUP_MISSING (%)', r.grp USING ERRCODE = '42704';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.login) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB '
                     'NOCREATEROLE NOREPLICATION PASSWORD NULL', r.login);
      INSERT INTO alerts_relay_created VALUES (r.login);
    END IF;

    -- BEFORE the role can ever authenticate. PASSWORD NULL is written by the CREATE above and
    -- NOWHERE ELSE: a re-run must never wipe the password the owner has set (0002 note 4).
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r.login, '8s');
    EXECUTE format('ALTER ROLE %I SET lock_timeout      = %L', r.login, '5s');
    EXECUTE format('ALTER ROLE %I SET search_path       = %L', r.login, 'pg_catalog');

    -- One option per statement; named options so a re-run CONVERGES rather than no-opping.
    EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE', r.grp, r.login);
    EXECUTE format('GRANT %I TO %I WITH SET FALSE',    r.grp, r.login);

    IF EXISTS (SELECT 1 FROM pg_auth_members m
                 JOIN pg_roles t ON t.oid = m.roleid
                 JOIN pg_roles g ON g.oid = m.member
                WHERE t.rolname = r.login AND g.rolname = current_user
                  AND (m.set_option OR m.inherit_option)) THEN
      EXECUTE format('REVOKE SET OPTION FOR %I FROM %I',     r.login, current_user);
      EXECUTE format('REVOKE INHERIT OPTION FOR %I FROM %I', r.login, current_user);
    END IF;
  END LOOP;
END $mig$;

DO $chk$
DECLARE
  r        record;
  v_bad    text := '';
  v_login  text := 'alerts_writer_relay_rt';
  v_alerts oid  := (SELECT oid FROM pg_namespace WHERE nspname = 'alerts');
BEGIN
  IF v_alerts IS NULL THEN
    RAISE EXCEPTION 'ALERTS_RELAY_SCHEMA_MISSING' USING ERRCODE = '3F000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles
                  WHERE rolname = v_login AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
                    AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
                    AND NOT rolreplication) THEN
    v_bad := v_bad || ' relay:attributes';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_login
                   AND rolconfig @> ARRAY['statement_timeout=8s','lock_timeout=5s',
                                          'search_path=pg_catalog']) THEN
    v_bad := v_bad || ' relay:rolconfig';
  END IF;

  IF EXISTS (SELECT 1 FROM alerts_relay_created c WHERE c.login = v_login) THEN
    IF has_table_privilege(current_user, 'pg_authid', 'SELECT') THEN
      IF EXISTS (SELECT 1 FROM pg_authid WHERE rolname = v_login AND rolpassword IS NOT NULL) THEN
        v_bad := v_bad || ' relay:password_not_null';
      END IF;
    ELSE
      RAISE NOTICE 'ALERTS_RELAY_PASSWORD_CHECK_SKIPPED (%): pg_authid is not readable by %',
                   v_login, current_user;
    END IF;
  END IF;

  -- Membership: alerts_writer ONLY, inherit yes, set no, admin no.
  IF NOT EXISTS (SELECT 1 FROM pg_auth_members m
                   JOIN pg_roles t ON t.oid = m.roleid
                   JOIN pg_roles g ON g.oid = m.member
                  WHERE g.rolname = v_login AND t.rolname = 'alerts_writer'
                    AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option) THEN
    v_bad := v_bad || ' relay:own_membership';
  END IF;

  IF (SELECT count(*) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.member
       WHERE g.rolname = v_login) <> 1 THEN
    v_bad := v_bad || ' relay:extra_membership';
  END IF;

  -- The two runtimes must be strangers: no membership between the LOGIN roles, either way.
  IF EXISTS (SELECT 1 FROM pg_auth_members m
               JOIN pg_roles t ON t.oid = m.roleid
               JOIN pg_roles g ON g.oid = m.member
              WHERE (t.rolname = v_login AND g.rolname IN ('alerts_writer_rt','alerts_dispatcher_rt'))
                 OR (g.rolname = v_login AND t.rolname IN ('alerts_writer_rt','alerts_dispatcher_rt'))) THEN
    v_bad := v_bad || ' relay:membership_with_an_n8n_login';
  END IF;

  IF NOT has_schema_privilege(v_login, v_alerts, 'USAGE')  THEN v_bad := v_bad || ' relay:no_schema_usage'; END IF;
  IF     has_schema_privilege(v_login, v_alerts, 'CREATE') THEN v_bad := v_bad || ' relay:schema_create';   END IF;
  IF     has_schema_privilege(v_login, 'public', 'CREATE') THEN v_bad := v_bad || ' relay:public_create';   END IF;

  -- EXECUTE, both ways round, by OID: 0001 leaves the migrator without USAGE on alerts, so
  -- every name-taking overload would raise 42501 here (0002 finding 1).
  FOR r IN
    SELECT v.proname, p.oid AS fnoid, v.expected,
           (SELECT count(*) FROM pg_proc x
             WHERE x.pronamespace = v_alerts AND x.proname = v.proname) AS n
      FROM (VALUES
        ('enqueue_new_lead',            true),
        ('enqueue_new_lead_b64',        true),
        ('claim_new_lead_delivery',     false),
        ('finalise_new_lead_delivery',  false),
        ('expire_stale_claims',         false),
        ('new_lead_attention',          false),
        ('request_fingerprint',         false),
        ('new_lead_events_present',     false),
        ('repair_new_lead_deliveries',  false),
        ('purge_new_lead_payloads',     false),
        ('purge_new_lead_deliveries',   false),
        ('purge_new_lead_keys',         false)) AS v(proname, expected)
      LEFT JOIN pg_proc p ON p.pronamespace = v_alerts AND p.proname = v.proname
  LOOP
    IF r.n <> 1 THEN
      v_bad := v_bad || format(' alerts.%s:resolves_to_%s', r.proname, r.n);
    ELSIF has_function_privilege(v_login, r.fnoid, 'EXECUTE') <> r.expected THEN
      v_bad := v_bad || format(' relay:EXECUTE(%s)<>%s', r.proname, r.expected);
    END IF;
  END LOOP;

  FOR r IN
    SELECT t.relname, c.oid AS reloid, p.priv
      FROM (VALUES ('new_lead_outbox'), ('new_lead_delivery'), ('retention_policy'),
                   ('new_lead_outbox_audit'), ('new_lead_delivery_audit')) AS t(relname)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
      LEFT JOIN pg_class c ON c.relnamespace = v_alerts AND c.relname = t.relname
  LOOP
    IF r.reloid IS NULL THEN
      v_bad := v_bad || format(' alerts.%s:missing', r.relname);
    ELSIF has_table_privilege(v_login, r.reloid, r.priv) THEN
      v_bad := v_bad || format(' relay:%s_ON_%s', r.priv, r.relname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.priv, c.oid AS reloid
      FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
      JOIN pg_class c ON c.relname = 'telegram_initdata_replays'
      JOIN pg_namespace g5 ON g5.oid = c.relnamespace AND g5.nspname = 'public'
  LOOP
    IF has_table_privilege(v_login, r.reloid, r.priv) THEN
      v_bad := v_bad || format(' relay:G5_%s', r.priv);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
              WHERE t.rolname = v_login AND (m.set_option OR m.inherit_option)) THEN
    v_bad := v_bad || ' any_role:set_or_inherit_on_the_relay_login';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'ALERTS_RELAY_POSTCONDITION_FAILED (%)', v_bad USING ERRCODE = '42501';
  END IF;
END $chk$;

COMMIT;
```

### 8.2 The rollback, exactly

Removes the relay login and **nothing else**. The `alerts_writer` group, the five `alerts_*`
siblings, both n8n runtime logins and G5 belong to `0001`/`0002` and are left exactly as they were.

```sql
-- ============================================================================
-- FINMENTOR — ALERTS WRITER RELAY LOGIN         rollback
-- Removes ONLY alerts_writer_relay_rt. 0001 and 0002 objects are untouched.
-- ORDERING: run this BEFORE 0001's rollback, which refuses while any
-- alerts_*_rt login exists (0001 amendment 2.3-A covers this name too).
-- ============================================================================
BEGIN;

-- The state this rollback promises not to disturb, captured BEFORE it acts. "we only dropped
-- the relay" is otherwise a claim; here it is compared.
CREATE TEMP TABLE alerts_relay_pre ON COMMIT DROP AS
  SELECT rolname FROM pg_roles
   WHERE rolname IN ('alerts_owner','alerts_writer','alerts_dispatcher','alerts_reconciler',
                     'alerts_retention','alerts_audit','alerts_writer_rt','alerts_dispatcher_rt');

DO $rb$
DECLARE r text := 'alerts_writer_relay_rt';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    -- DROP OWNED BY needs the PRIVILEGES of the role (0001 amendment 2.1-D). The grant lives
    -- for the length of this transaction; DROP ROLE destroys it.
    EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE', r, current_user);
    EXECUTE format('DROP OWNED BY %I', r);
    EXECUTE format('DROP ROLE %I', r);
  END IF;
END $rb$;

DO $rb$
DECLARE v_missing text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alerts_writer_relay_rt') THEN
    RAISE EXCEPTION 'ALERTS_RELAY_ROLLBACK_RESIDUAL' USING ERRCODE = '42501';
  END IF;

  -- Everything that existed before must still exist: the six group roles AND, if 0002 is
  -- applied, both n8n runtime logins. A rollback that quietly took a neighbour with it is
  -- the same class of defect as 0001 amendment 2.3-A.
  SELECT string_agg(p.rolname, ', ' ORDER BY p.rolname) INTO v_missing
    FROM alerts_relay_pre p
   WHERE NOT EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolname = p.rolname);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ALERTS_RELAY_ROLLBACK_DAMAGED_NEIGHBOURS (%)', v_missing USING ERRCODE = '42501';
  END IF;
END $rb$;

COMMIT;
```
