# P9 — G5: durable Telegram `initData` replay protection

**Built and proven 2026-08-28. Offline 16/16, live against Postgres. G5 = PASS.**

G5 was the one item the pre-activation review **stopped** rather than shipped. This closes it.

## Why it was stopped, and what changed

`P8_PRE_ACTIVATION_GO_NO_GO.md` §3.2 was blunt: *no existing primitive can implement G5 safely.*
The n8n Data Table has no atomic create-if-absent; Google Sheets' `appendOrUpdate` is
last-write-wins. The receipt path escaped that constraint by having two issuers mint **different**
random keys, so there was nothing to arbitrate — replay protection cannot use that trick, because
the whole point is that the second arrival must *find the first one already there*. Emulating it
read-then-write is the exact race the review forbade, and it fails in the only case that matters:
two tabs replaying one `initData` simultaneously.

Nothing about that analysis was wrong. What changed is the store: Supabase Postgres gives a real
`PRIMARY KEY`, so an `INSERT` either wins or raises `23505` with no window in between.

## The table

`finmentor-prod` (`exvmtjxmfouzuschiuwj`), migration `20260828202102_g5_telegram_initdata_replays`.

| column | |
|---|---|
| `replay_key text primary key` | SHA-256 hex, `CHECK (replay_key ~ '^[0-9a-f]{64}$')` |
| `first_seen_at timestamptz not null default now()` | |
| `expires_at timestamptz not null` | `CHECK (expires_at > first_seen_at)` |
| `correlation_id text` | `CHECK (null or length <= 80)` |

**The `replay_key` CHECK is a privacy control, not formatting.** A column that accepts only 64 hex
characters *cannot* hold raw `initData`, a Telegram user id, a name, a phone or an email. "No PII
is stored here" becomes something the database enforces rather than something the application
promises. Both were tested live: raw `initData` and a name+phone string are rejected by the
constraint, not by convention.

**Server-only.** RLS enabled with **zero policies**, and `REVOKE ALL ... FROM anon, authenticated`.
No policy means PostgREST denies every role outright; the explicit revoke means that adding a
policy later still would not silently open a path, because the grants are gone too. The service
role bypasses RLS and is the only intended writer.

The Supabase security advisor reports exactly one lint, `rls_enabled_no_policy` at **INFO**. That
is the intended state for a server-only table and is recorded here so it is not "fixed" later by
adding a policy that would weaken it.

## The order, and why it is structural

    1. verify the Telegram signature      throws
    2. verify freshness                   throws (inside the validator, after the signature)
    3. derive replay_key from AUTHENTICATED canonical material
    4. one atomic INSERT
    5. 23505 -> REPLAY_REFUSED
    6. only then may a session be created or continued

Steps 1–2 throw before step 4 is reachable, so a forged or stale `initData` **cannot** consume a
key. That is not a promise about call order — there is no path from a failed validation to the
store. The gate proves it with a store that throws if it is touched at all.

This matters more than it looks: if a rejected payload could burn a key, an attacker would deny
service to the real user simply by replaying garbage first.

`replay_key = SHA-256("finmentor:g5:v1\n" + dataCheckString + "\n" + hash)` — domain-separated so
the key space can be rotated, over the exact bytes Telegram signed plus the signature itself. Alter
any signed field and both the key and the signature change; there is no way to collide one without
breaking the other.

**The module never arbitrates.** No SELECT, no count, no "not found so proceed" — asserted
structurally, and the only store method it may call is `insertClaim`. Expiry is retention, never
authorisation: a claim is authoritative because the INSERT won, never because a timestamp is in
the future. Asserted too.

## Proof

Offline (`qa/g5-replay-claim.test.mjs`, 16 checks) against a fake store that models one thing — a
primary key. If the logic is right, a fake key and a real one are indistinguishable to this
module, because it never arbitrates.

Live, against the real table and index:

    A first_use_rows=1
    B replay_refused_23505    rows_after=1
    C concurrent_rows=1       (8 identical inserts, one statement)
    D raw_initdata_rejected
    D2 pii_rejected
    E backwards_expiry_rejected
    CLEANUP rows_remaining=0

| Requirement | Result |
|---|---|
| VALID FIRST USE | PASS |
| IDENTICAL REPLAY | REFUSED |
| CONCURRENT same key | exactly one succeeds |
| FAILED SIGNATURE | no row consumed — store never reached |
| EXPIRED / FUTURE `initData` | no row consumed — store never reached |
| STORE OUTAGE | fail closed (`REPLAY_STORE_UNAVAILABLE`) |
| Mute/ambiguous adapter | fail closed |
| RAW `initData` persisted | 0 — and structurally impossible |
| Customer PII persisted | 0 — and structurally impossible |

## What G5 does not do

It does not create sessions, and it is not wired to anything yet. The Gateway that would call it
is not deployed. G5 is a component with a proven contract, not a live control on the customer
path — and it should not be described as one until the Gateway ships.
