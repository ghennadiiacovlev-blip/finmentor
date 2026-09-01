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

The migration is **generated** from the design document, never hand-written:

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

## Running

```bash
node db/validation/run-validation.mjs          # the full suite; writes db/validation/results/
node db/validation/bisect-apply.mjs up --fresh --twice   # names the exact failing statement
```

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
| `bisect-apply.mjs` + `split-sql.mjs` | statement-by-statement apply, honouring dollar quoting |

## The one thing to know before trusting a green run

Run as a **non-superuser** migrator. Three of the four defects this harness found were invisible
to a superuser and appear only for the `NOSUPERUSER CREATEROLE` role that Supabase's `postgres`
actually is. `run-validation.mjs` asserts that in the `PRE` gate before anything else.
