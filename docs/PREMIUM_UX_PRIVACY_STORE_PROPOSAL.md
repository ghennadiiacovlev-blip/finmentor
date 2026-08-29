# Premium UX — privacy audit store: proposal and privilege proof

**DESIGN ONLY. No table was created, no role was created, no grant was issued, no data was written.**

Owner decision B accepted the dedicated append-only store in principle and blocked production
creation pending two proofs. This document supplies both, and **corrects a claim I made in Phase 2
that turns out to be false.**

---

## 1. The correction

`PREMIUM_UX_PHASE2_IMPLEMENTATION_CONTRACT.md` §3 said:

> Append-only is enforced, not intended: grant `INSERT, SELECT` only to the n8n role; no `UPDATE`,
> no `DELETE`.

**That is not true for the credential the Gateway uses today.** Owner decision B was right to
refuse the assertion and ask for the role model. Here it is, read from the live database.

---

## 2. Privilege proof — measured, not asserted

Read-only queries against the FINMENTOR Supabase project (the same project that carries the G5
ledger; `public.telegram_initdata_replays`, 4 rows, confirming identity).

**Table ownership**

    table_name                   table_owner   rls_enabled   rls_forced
    telegram_initdata_replays    postgres      true          false

**Grants on that table**

    grantee        privileges
    postgres       DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
    service_role   DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

**Role attributes**

    rolname          login   bypassrls   superuser   createrole
    postgres         yes     YES         no          YES
    service_role     no      YES         no          no
    authenticator    yes     no          no          no
    pgbouncer        yes     no          no          no
    supabase_admin   yes     yes         YES         yes

**There are no custom application roles.** The only login-capable non-system roles are
`postgres`, `authenticator` and `pgbouncer`. An n8n Postgres node using a Supabase connection
string authenticates as **`postgres`**.

### What that means

| Property | `postgres` (today's runtime role) | Required |
|---|---|---|
| runtime DB role | `postgres` | a dedicated writer |
| owns the table | **YES** | **no** |
| INSERT | yes | yes |
| SELECT | yes | only if operationally necessary |
| UPDATE | **YES** | **no** |
| DELETE | **YES** | **no** |
| TRUNCATE | **YES** | **no** |
| can bypass RLS | **YES** (`rolbypassrls`) | no |
| can re-grant to itself | **YES** (owner + `rolcreaterole`) | no |

So revoking `UPDATE` from `postgres` would achieve nothing: an owner may re-grant to itself, and
`rolbypassrls` ignores row-level security unless the table is `FORCE ROW LEVEL SECURITY` — which
the G5 table is not (`rls_forced = false`).

**Conclusion: the existing G5 credential cannot provide genuine least privilege.** Owner decision B
anticipated exactly this and asked for a dedicated role. That is what §3 proposes.

---

## 3. Proposed implementation — DDL for review, not for execution

Three roles instead of one, because the separation is the enforcement.

```sql
-- 1. An owner that is NOT the writer. Cannot log in; exists only to hold the table.
create role finmentor_privacy_owner nologin;

-- 2. The runtime writer. Logs in, owns nothing, cannot create roles, cannot bypass RLS.
create role finmentor_privacy_writer login password :'writer_password'
  nosuperuser nocreatedb nocreaterole noinherit nobypassrls;

-- 3. The table, owned by the owner role.
set role finmentor_privacy_owner;

create table public.privacy_acknowledgements (
  id                              bigint generated always as identity primary key,
  submission_key                  text        not null,
  cycle_id                        text,
  privacy_notice_version          text        not null,
  privacy_locale                  text        not null check (privacy_locale in ('ru','ro')),
  privacy_notice_shown_at         timestamptz not null,
  privacy_notice_acknowledged_at  timestamptz not null,
  privacy_legal_basis             text        not null,
  marketing_consent               boolean,                 -- null = never asked
  marketing_consent_at            timestamptz,
  recorded_at                     timestamptz not null default now(),

  -- An acknowledgement cannot precede the notice it acknowledges.
  constraint ack_after_shown check (privacy_notice_acknowledged_at >= privacy_notice_shown_at),
  -- A consent timestamp only exists when consent was actually given.
  constraint marketing_at_iff_true check (
    (marketing_consent is true  and marketing_consent_at is not null) or
    (marketing_consent is not true and marketing_consent_at is null))
);

-- One row per submission. This is what makes the retry idempotent.
create unique index privacy_ack_submission_key_uidx
  on public.privacy_acknowledgements (submission_key);

reset role;

-- 4. Least privilege. INSERT only; no SELECT until an operational need is named.
revoke all on public.privacy_acknowledgements from public;
revoke all on public.privacy_acknowledgements from authenticated, anon;
grant insert on public.privacy_acknowledgements to finmentor_privacy_writer;
grant usage on schema public to finmentor_privacy_writer;

-- 5. Defence in depth. The writer cannot bypass RLS, and the policy admits inserts only.
alter table public.privacy_acknowledgements enable row level security;
alter table public.privacy_acknowledgements force row level security;
create policy privacy_ack_insert_only on public.privacy_acknowledgements
  for insert to finmentor_privacy_writer with check (true);
```

Resulting posture:

| Property | `finmentor_privacy_writer` |
|---|---|
| owns the table | **no** — `finmentor_privacy_owner` does |
| INSERT | yes |
| SELECT | **no** (grant later only if an operational need is named) |
| UPDATE / DELETE / TRUNCATE | **no** — never granted |
| bypass RLS | **no** — `nobypassrls`, and the table is `FORCE`d |
| can re-grant to itself | **no** — `nocreaterole`, not the owner |

A dedicated n8n credential, **`FINMENTOR Privacy Audit (writer)`**, carries this role and is used by
nothing else. The G5 credential is not reused, is not modified, and keeps its own scope.

**Honest limit:** `postgres` and `supabase_admin` remain superuser-adjacent and can do anything,
including dropping the table. That is true of every object in any Postgres and is not something a
grant can fix. What the design buys is that **the runtime path cannot mutate the record** — the
credential the endpoint holds can only ever add rows.

---

## 4. Write semantics — one immutable record

Owner decision B asked for the smaller defensible model. **One row per acknowledgement**, written
at acknowledgement time, carrying both timestamps.

- `shown_at` is captured client-side and travels **with** the acknowledgement action. No server
  write happens when the notice is rendered, so nothing later needs an `UPDATE` to become
  "acknowledged" — which is precisely what would have made the append-only claim dishonest.
- A "shown but never acknowledged" row has no evidentiary value. The obligation is to prove what was
  **acknowledged**, not what was rendered; a row per impression is a second analytics dataset with
  none of the benefit and all of the retention burden.
- The insert is `on conflict (submission_key) do nothing` — the same CTE-shaped idempotency G5 has
  already proven in production. A retry after an ambiguous outcome writes no second row and raises
  no error, so retry cannot produce conflicting acknowledgement rows.
- An event model would double the rows and require a join to answer the only question ever asked:
  *which notice did this person acknowledge, and when?*

**Correction, not update.** Because no `UPDATE` exists, a correction is a new row under a new
`submission_key`, and the original stands. That is the property that makes the store worth having.

### Ordering

The acknowledgement is written **before** the irreversible Lead Intake call
(`scripts/build-premium-endpoints.mjs` enforces this, and the candidate refuses to build if the
nodes are ordered the other way). This is reason 2 from Phase 2 §3 made operational: the notice was
shown and acknowledged whether or not the submission then succeeds.

---

## 5. What the record may never contain

Refused rather than stripped, by `n8n/src/premium-ux/privacy-record.js`, at any nesting depth:
raw `initData`, any Telegram signature or hash, `telegram_user_id`, `chat_id`, username, name,
company, email, phone, the client's free-text problem, important context, desired outcome, current
setup, documents, `raw_json`, `lead_id`, or any copy of the CRM payload.

The only linkage is the opaque `submission_key` the cycle issuer already mints — the same identity
`Submission_Receipts` uses. `qa/premium-ux-brief.test.mjs` proves every forbidden key is detected
top-level and nested, and that the real record leaks none of them.

Marketing consent is separate, optional, and **never required to submit**. `null` means never asked
and is structurally distinct from `false`, which means asked and declined.

---

## 6. Legal basis

`privacy_legal_basis` is **server-controlled** and is `PENDING_LEGAL_REVIEW` everywhere in the
repository — the constant, the record builder default, the endpoint candidate and the fixtures. No
Moldovan legal-basis value is hard-coded anywhere.

`privacy_notice_version` and both link URLs come from the **Settings** sheet (`key`/`value`/`note`),
so a notice revision is a configuration change rather than a deploy.

---

## 7. Blocking items

1. **Legal sign-off** on the final `privacy_legal_basis` value and the notice wording.
2. **Owner approval** to create three roles, one table and one n8n credential.
3. A decision on whether the writer needs `SELECT` at all. The proposal says no; if an operational
   read is required, grant it explicitly and record why.
