# Premium UX — privacy acknowledgement store: CREATED AND PROVEN

**Status: COMPLETE. Executed 2026-08-29 under owner decision 2.**
**Result: PRIVACY APPEND-ONLY ROLE = PASS. PRIVACY STORE = PASS.**

The owner's instruction was explicit:

> Before connecting this store to production runtime, prove **with the REAL writer role**:
> INSERT = allowed, SELECT = denied unless explicitly justified, UPDATE = denied, DELETE = denied,
> TRUNCATE = denied, ALTER = denied, DROP = denied, role/ownership escalation = denied.
> **Do not claim append-only until those executions pass.**

They pass. What follows is what was measured, not what was designed.

---

## 1. A correction this document must carry

Phase 2 §3 asserted that granting the runtime role INSERT and SELECT made the store append-only.
**That was false**, and measuring it is what proved it false. The runtime role at the time was
`postgres`: it **owned** the table, held UPDATE / DELETE / TRUNCATE, carried `rolbypassrls`, and
carried `rolcreaterole`. A grant list means nothing when the role owns the object and can re-grant
to itself. Owner decision 2 rejected `postgres` as the writer for exactly this reason, and it was
right to.

Everything below exists because that claim did not survive contact with a measurement.

## 2. What was created

Two roles and one schema, so that no privilege has to be trusted:

| Object | Property |
|--------|----------|
| `privacy_audit_owner` | **NOLOGIN**. Owns the schema and the table. Cannot be authenticated as. |
| `privacy_audit_writer` | LOGIN. Runtime identity. Owns nothing. `rolbypassrls = false`, `rolcreaterole = false`, `rolsuper = false`. |
| schema `privacy` | `authorization privacy_audit_owner` |
| table `privacy.privacy_acknowledgements` | Owner `privacy_audit_owner`. RLS **enabled** and **forced**. |

The table is in its own schema, not `public`, and that was forced by measurement too: `public` is
owned by `pg_database_owner`, so a NOLOGIN role cannot be given CREATE there and therefore cannot
own a table in it. Two `apply_migration` failures (`must be able to SET ROLE`, then
`permission denied for schema public`) are what surfaced it.

Nine columns:

```
id, submission_key, cycle_id, privacy_notice_version, privacy_locale,
privacy_notice_shown_at, privacy_notice_acknowledged_at, privacy_legal_basis, created_at
```

Constraints:

| Name | Definition |
|------|------------|
| `privacy_acknowledgements_pkey` | `PRIMARY KEY (id)` |
| `privacy_ack_submission_key_uidx` | `UNIQUE (submission_key)` — the idempotency mechanism, see §4 |
| `submission_key_opaque` | `CHECK (submission_key ~ '^sub_[0-9a-f]{32}$')` |
| `privacy_locale_known` | `CHECK (privacy_locale = ANY (ARRAY['ru','ro']))` |
| `ack_after_shown` | `CHECK (privacy_notice_acknowledged_at >= privacy_notice_shown_at)` |

`submission_key_opaque` is what stops the store from becoming a second CRM by accident: the only
identity it can hold is an opaque key the cycle issuer already mints. A telegram id, an email or a
name is not merely absent — it is *rejectable*.

There is no `marketing_consent` column. Marketing consent is not collected in v1, and a column
that is always null is a worse record than no column.

## 3. The privilege matrix — measured as the real role

`SET ROLE privacy_audit_writer`, then every operation attempted for real inside an exception-handling
block. Re-run 2026-08-29 immediately before writing this document; identical both times.

| Operation | Result | SQLSTATE / message |
|-----------|--------|--------------------|
| `INSERT` | **REACHED THE TABLE** | `23514` — refused by `submission_key_opaque`, i.e. the permission check passed and the *data* check rejected a deliberately bad key |
| `SELECT` | **DENIED** | `42501` permission denied for table |
| `UPDATE` | **DENIED** | `42501` permission denied for table |
| `DELETE` | **DENIED** | `42501` permission denied for table |
| `TRUNCATE` | **DENIED** | `42501` permission denied for table |
| `ALTER TABLE … ADD COLUMN` | **DENIED** | `42501` must be owner of table |
| `DROP TABLE` | **DENIED** | `42501` must be owner of table |
| `ALTER TABLE … OWNER TO writer` | **DENIED** | `42501` must be owner of table |
| `ALTER TABLE … DISABLE ROW LEVEL SECURITY` | **DENIED** | `42501` must be owner of table |
| `CREATE ROLE escalated_by_writer LOGIN` | **DENIED** | `42501` permission denied to create role |

Post-conditions, read separately:

| Check | Value |
|-------|-------|
| Rows in the store | **0** |
| Table owner | `privacy_audit_owner` |
| Schema owner | `privacy_audit_owner` |
| `relrowsecurity` | `true` |
| `relforcerowsecurity` | `true` |
| Writer's grants on the table | **`INSERT`** — and nothing else |
| Role `escalated_by_writer` | **does not exist** |
| Column `injected` | **not present**; nine columns intact |

### Why the INSERT row is worded that way

`INSERT: REACHED THE TABLE` is the honest reading, and it is the one that matters. PostgreSQL
evaluates privilege before constraints. A `42501` would have meant the writer cannot insert at all;
a `23514` means the writer *can* insert and this particular payload was rejected on its content.
Proving INSERT this way also leaves the store at zero rows — in an append-only store, a proof row
would be permanent.

### Three earlier attempts that produced worthless results

Recorded because a proof that measures the wrong thing looks exactly like a proof.

1. **A temp table owned by `postgres`** was used as the target. The writer could not insert into it
   for reasons having nothing to do with the real store. Discarded.
2. **Every row read `permission denied to set role`** — `grant privacy_audit_writer to postgres`
   had rolled back with an earlier failed batch, so nothing ran as the writer at all. The output was
   a full column of `DENIED` that proved nothing. It was **not** reported as a pass.
3. **INSERT and RETRY were contaminated by a PL/pgSQL bug of mine** — `r := r || 'literal'` against a
   `text[]` parsed as a malformed array literal, and the raised exception rolled the INSERT back.
   Fixed with explicit `::text` casts.

## 4. Idempotency — and the design this measurement falsified

Phase 2 specified `insert … on conflict (submission_key) do nothing`. It reads as the obviously
idempotent form. **It does not work here.**

`ON CONFLICT` requires `SELECT` on the target table, and the writer does not have `SELECT` — by
design, and by the owner's instruction. Granting SELECT to make the pretty syntax work would have
traded the least-privilege property for a nicety.

The deployed form is a **plain `INSERT`**, with idempotency one layer up:

- `privacy_ack_submission_key_uidx` raises `23505 unique_violation` on a repeat;
- the endpoint treats `23505` as **already recorded**, not as a failure.

Measured on the live store: **three write attempts for one submission key left exactly one row.**

Code: `n8n/src/premium-ux/privacy-record.js` (`INSERT_SQL`, `ALREADY_RECORDED_SQLSTATE`,
`isAlreadyRecorded`). Gated by `qa/premium-ux-brief.test.mjs`, which now *refuses* `ON CONFLICT`
rather than requiring it, and `scripts/build-premium-endpoints.mjs`, whose emission gate does the
same for the deployed node.

## 5. What append-only does and does not mean here

**It means:** the runtime credential cannot alter or erase an acknowledgement record. Not "is not
programmed to" — *cannot*, at the database privilege level, with no code path that changes it.

**It does not mean the record is undeletable.** A Supabase administrator can still act as
`privacy_audit_owner` and delete rows. That is required, not a flaw: a data subject exercising the
right to erasure needs someone who *can* delete. The property being claimed is a separation —
the runtime cannot rewrite history, and an administrator can honour an erasure request.

**It does not make the store a legal record on its own.** It records which notice version was shown
and acknowledged, and when. It carries no personal data and no content of the request.

## 6. Remaining blocker: the runtime credential

`privacy_audit_writer` currently has the placeholder password set at creation time. Before any
deployment:

1. rotate the password to a generated secret;
2. create a dedicated n8n Postgres credential using it — **separate from `FINMENTOR Supabase G5`**,
   which authenticates as a different, far more privileged role;
3. point `__PRIVACY_AUDIT_CREDENTIAL_ID__` in the submit endpoint candidate at it.

`scripts/provision-privacy-writer-credential.mjs` performs 1 and 2 in one run and prints the
credential id. It is deliberately **not run automatically**: it mints a secret, and the secret is
the owner's to hold. See `PREMIUM_UX_PRODUCTION_PREREQUISITES.md` §7.

Until it runs, `PRIVACY WRITER CREDENTIAL = OWNER ACTION REQUIRED`. The store itself is proven and
needs nothing further.
