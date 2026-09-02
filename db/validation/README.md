# NEW LEAD ALERT OUTBOX — non-production DDL validation harness

**NON-PRODUCTION ONLY.** This harness creates and drops databases, roles and synthetic rows. It
refuses to connect to anything that is not loopback (`db/validation/lib.mjs`,
`assertNonProduction`), so it cannot be pointed at `finmentor-prod` by editing an environment
variable. It never reads production data and never writes to a managed endpoint.

It lives in its own npm package on purpose: `qa/` — the canonical quality gate — stays
dependency-free, and nothing here is ever shipped, deployed or run in CI.

## What it proves

`db/migrations/0001_new_lead_alert_outbox.{up,down}.sql` against **real** PostgreSQL: clean apply,
idempotent reapply, rollback, reapply after rollback, and gates 19–48 of
`docs/NEW_LEAD_ALERT_OUTBOX_DDL_REVIEW.md` — including the ones no fixture can prove
(`SKIP LOCKED`, `ON CONFLICT` under concurrency, RLS ownership exemption, `GRANT` denial per
runtime role). Results: `docs/NEW_LEAD_ALERT_OUTBOX_NONPROD_VALIDATION.md`.

`db/migrations/0002_alerts_runtime_logins.{up,down}.sql` — the two runtime LOGIN roles — against
the same cluster: gates E1–E13 of
`docs/TELEGRAM_DURABLE_NEW_LEAD_DELIVERY_PLAN.md` §2.8. Those gates cover what no catalog query
can settle: that a `PASSWORD NULL` login is **refused** by the server, that the role's
`statement_timeout` actually reaches a session and actually fires, that the writer cannot claim and
the dispatcher cannot enqueue *through their own credentials*, that a re-run repairs its own drift
but refuses a stranger's grant, and that a re-run never disarms a password the owner has set.

`db/migrations/0003_alerts_writer_relay_login.{up,down}.sql` — the **Cloud Run relay** identity
`alerts_writer_relay_rt` — against the same cluster: gates R1–R30 of
`docs/TELEGRAM_DURABLE_NEW_LEAD_DELIVERY_PLAN.md` §8. The relay is a deliberately SEPARATE login
from the n8n identity `alerts_writer_rt`; the two share only inherited membership in the NOLOGIN
group `alerts_writer`. The gates prove they are strangers in both directions, that `0002`'s
rollback leaves the relay standing and `0003`'s leaves both n8n logins standing, and that `0001`'s
2.3-A guard refuses while the relay exists — the guard matches on `alerts\_%\_rt`, so it covered
the new name without amendment.

All three migrations are **generated** from their design documents, never hand-written:

```
node db/validation/extract-migration.mjs   # then `git diff` must be empty
```

## Bringing up a disposable cluster

The cluster must match the production major.minor version (currently **17.6**). The dev
dependency `embedded-postgres@17.6.0-beta.15` ships that exact build; no Docker, no installed
PostgreSQL and no network service is required.

```bash
npm install --prefix db/validation

BIN=db/validation/node_modules/@embedded-postgres/windows-x64/native/bin   # or linux-x64/darwin-*
echo fmtest_local_only > /tmp/pw
"$BIN/initdb"   -D /tmp/fmpg -U postgres --pwfile=/tmp/pw -E UTF8 --locale=C
"$BIN/postgres" -D /tmp/fmpg -p 55432 -c listen_addresses=127.0.0.1 -c max_connections=60 \
  -c log_statement=all -c log_min_duration_statement=0 -c log_parameter_max_length=-1 \
  -c log_parameter_max_length_on_error=-1 -c log_error_verbosity=verbose \
  > /tmp/fmpg.log 2>&1 &

export FM_PGLOG=/tmp/fmpg.log     # gates 59-62 scan this file
```

**The five `log_*` flags and `FM_PGLOG` are not optional.** Gates 59–62 assert that the raw
identifier reaches no log line the *schema itself* writes. Those assertions all have the form "no
line of kind X carries the secret", so on a quiet cluster they are **vacuously true** — the suite
would report the strongest possible result from an experiment that never ran. The flags provoke the
worst case on purpose; gate 59 now reads the settings back and asserts the control is armed, and
that the scan really does find the identifier somewhere, so a misconfigured cluster **fails** the
gate instead of passing it. The per-role settings gates 59–62 apply on top (prod's own values,
auto_explain) override these, which is exactly what makes the comparison meaningful.

The number of identifier-bearing lines under maximal logging is **run-dependent** (it tracks how
many statements the suite happens to execute) — it is a control that must be non-zero, not a
figure to regress against.

**`initdb` writes `trust` for host connections, and the 0002 suite cannot run on that.** Half of
gate E4 is of the form "this credential is refused", which is unmeasurable on a cluster that
refuses nothing. Before running it:

```bash
sed -i -E 's/^(host .*[0-9])[[:space:]]+trust$/\1  scram-sha-256/' /tmp/fmpg/pg_hba.conf
"$BIN/pg_ctl" -D /tmp/fmpg reload
```

E4 opens with a negative control — a deliberately wrong password for a role that certainly has one
must be refused — so a `trust` cluster **fails** the gate instead of passing it vacuously.

## Running

```bash
node db/validation/run-validation.mjs          # 0001; writes db/validation/results/last-run.*
node db/validation/run-validation-0002.mjs     # 0002; writes results/last-run-0002.*
node db/validation/run-validation-0003.mjs     # 0003; writes results/last-run-0003.*
node db/validation/bisect-apply.mjs up --fresh --twice   # names the exact failing statement
```

The three suites share one cluster and all start from `cleanSlate`, so they must not run
concurrently. Run 0001 last if you want its `results/` to be the one on disk.

| variable | default | meaning |
|---|---|---|
| `FM_PGHOST` / `FM_PGPORT` | `127.0.0.1` / `55432` | the disposable cluster |
| `FM_PGSUPER` / `FM_PGPASSWORD` | `postgres` / `fmtest_local_only` | its bootstrap superuser. **A throwaway credential for a loopback-only cluster that holds no real data** |
| `FM_TESTDB` | `fm_outbox_nonprod` | the database the run creates and drops |
| `FM_UP_FILE` / `FM_DOWN_FILE` | the repo migration | point at a candidate while iterating on a fix |

## Files

| file | role |
|---|---|
| `extract-migration.mjs` | regenerates the migration from the design document's SQL fences, located by heading |
| `lib.mjs` | connections (with lock/statement timeouts so a deadlocked gate FAILS instead of hanging), the report, `cleanSlate` |
| `fixture.mjs` | the synthetic non-production world: a shape-copy of the G5 ledger with **zero** production rows, the Supabase client roles, a non-superuser `CREATEROLE` migrator, and unrelated objects the rollback must leave alone |
| `data.mjs` | synthetic identities and payloads. Nothing here is derived from real customer data |
| `gates-a.mjs` / `gates-b.mjs` / `gates-c.mjs` | gates 19–26 / 27–32 / 33–48 plus the repair window and retention |
| `gates-d.mjs` | the revision-2.2 gates 49–62: migrator standing privilege at all four lifecycle points, the repair window as policy data, `DELIVERY_UNKNOWN` fail-safe, and the server-log measurements |
| `run-validation.mjs` | phases: precondition, clean apply, hash/extension dependency, idempotent reapply, the gate set, rollback refusal, rollback, reapply |
| `run-validation-0002.mjs` | the runtime-login suite: gates PRE, E1–E3 and E7–E13 — apply, the post-conditions re-measured from the catalog, convergence, refusal, rollback and rollback ORDER |
| `run-validation-0003.mjs` | the relay-identity suite: gates R1-R30 - the alerts_writer_relay_rt contract, its isolation from both n8n logins, convergence, a stranger grant refused, and three-way rollback independence |
| `gates-e.mjs` | gates E4–E6, the ones that need a live session: the authentication control, the timeouts as the role delivers them, each credential exercised end to end, and disarming |
| `bisect-apply.mjs` + `split-sql.mjs` | statement-by-statement apply, honouring dollar quoting |

## The one thing to know before trusting a green run

Run as a **non-superuser** migrator. Three of the four defects this harness found were invisible
to a superuser and appear only for the `NOSUPERUSER CREATEROLE` role that Supabase's `postgres`
actually is. Both runners assert that in the `PRE` gate before anything else. The 0002 suite added
a fourth of the same kind: `'alerts.f()'::regprocedure` and every `has_*_privilege` overload that
takes a **qualified name** raise `42501 permission denied for schema alerts` for this migrator,
because `0001` deliberately leaves it without `USAGE`. OID lookups through `pg_proc`/`pg_class` are
not privilege-checked; the migration uses those. A superuser run would have passed by name.

## And the one thing to know before trusting a measurement

`open()` sets its own `lock_timeout` and `statement_timeout` on every connection, so a gate that
deadlocks fails instead of hanging. Those are `source = session` and they **win** over a role's
`ALTER ROLE ... SET`. Gate E4's first run therefore reported the harness's own `90s` as though it
were the role's `8s`. Anything measuring what a role delivers to a session must use `openRaw()`.
