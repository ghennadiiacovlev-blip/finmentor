# P9 — Mini App Gateway: negative live proofs

**2026-08-29. Gateway `nTZHLbv2KFggdhh5` active for the live-proof phase. 14 live requests, all
refused, zero replay keys consumed.**

## 1. The endpoint is registered and reachable

`POST https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-gateway` — before activation it
answered `404 … the workflow must be active`. It now answers from the Gateway itself.

## 2/3. Forged and stale are refused

| case | HTTP | error_code |
|---|---|---|
| forged signature, fresh `auth_date` | 401 | `TG_INITDATA_INVALID` |
| forged signature, **stale** `auth_date` (2h) | 401 | `TG_INITDATA_INVALID` |
| forged signature, **future** `auth_date` | 401 | `TG_INITDATA_INVALID` |
| `signature` field absent | 401 | `TG_INITDATA_INVALID` |
| malformed initData (empty pair) | 401 | `TG_INITDATA_INVALID` |
| malformed percent-encoding | 401 | `TG_INITDATA_INVALID` |
| duplicate key | 401 | `TG_INITDATA_INVALID` |
| `init_data` absent | 400 | `TG_INITDATA_MISSING` |
| unsupported `client_version` | 400 | `CLIENT_VERSION_UNSUPPORTED` |
| unsupported `locale` | 400 | `BAD_REQUEST` |
| non-JSON content-type | 400 | `BAD_REQUEST` |

**Zero requests accepted. No response contained `replay_key`, `app_session_id`, `init_data`,
`telegram_user_id` or `submission_key`.**

### What the stale case does and does not prove

It proves the request is refused. It does **not** demonstrate the freshness gate firing, and the
distinction matters: the Gateway verifies the Ed25519 signature *before* freshness, so a payload
carrying a stale `auth_date` and a signature I constructed fails at `ED25519_VERIFY` and never
reaches the `auth_date` comparison. `TG_INITDATA_EXPIRED` was **not** observed live and is not
claimed here.

Isolating that gate live needs a genuinely Telegram-signed payload that is also older than the
window — obtainable only by holding a real `initData` for 15 minutes before replaying it. The
freshness logic itself is proven offline in `qa/g5-replay-claim.test.mjs` (expired and
future-dated both throw, and the store is never reached) and in the canary's own tests.

## 4 + 7. Zero replay keys consumed

    rows before the battery : 0
    rows after the battery  : 0

Which is the expected result and not a weak one: the claim node is reachable only through
`IF Verified`'s true branch, so a refused request has no path to the `INSERT` at all. The
pre-deploy gate proves that by branch-aware traversal; this measurement confirms it against the
real ledger.

## 5. Replay behaviour, at the level it can be proven

Gateway-level replay refusal cannot be exercised without a Telegram-valid payload, and nothing
here fabricates one. What was re-proven is the ledger behaviour the Gateway's claim node depends
on, against the real table and the real index, using the **exact statement shape** the node
issues:

    exact_replay_refused_23505
    gateway_shape_8_concurrent_rows = 1     (8 identical ON CONFLICT DO NOTHING inserts)
    final_rows = 0                          (probe key removed)

## 6. Store failure fails closed — proven, but NOT live

Stated precisely because it would be easy to overclaim: this was **not** demonstrated against a
broken Supabase, because doing so would mean deliberately breaking production connectivity.

What is proven:

- **structurally**, on the deployed graph — `G5 Replay Claim` carries `onError:
  continueErrorOutput`, its error output goes to `Respond Store Unavailable` (503), and
  branch-aware traversal from that error output shows `Create App Session` is unreachable. An
  outage cannot mint a session.
- **offline**, in `qa/g5-replay-claim.test.mjs` — a throwing store and a store that returns no
  verdict both yield `REPLAY_STORE_UNAVAILABLE`, never `CLAIMED`.

## 8. Standing invariants, re-verified live after the battery

| | |
|---|---|
| Only Postgres credential used by the Gateway | `FINMENTOR Supabase G5`, on `G5 Replay Claim`, and it is the **only** credential-bearing node |
| Neon | id referenced nowhere; exactly one Postgres node exists to attach one to |
| Pipeline write possible | **No** — no Google Sheets node |
| Lead Intake call possible | **No** — no `executeWorkflow` node |
| Outbound HTTP possible | **No** — no `httpRequest` node |
| Submit | absent — no submit node of any kind |
| Raw initData / PII persisted | none — and **0 executions retained** after 14 live requests |
| Execution-data retention | off for success, error and manual |
| Gateway `availableInMCP` | false |
| Concierge | `5fe6142d`, `R(L)` == sealed baseline, `availableInMCP` false |
| Lead Intake | `93139028`, `R(L)` == sealed baseline, one public webhook, `availableInMCP` false |
| F17 | untouched |

The zero-retained-executions figure is worth keeping: it is the only direct evidence that the
retention setting actually holds under real traffic rather than in configuration.

## What remains

The positive case. The Gateway validates Ed25519 signatures produced by **Telegram's** private
key, so a valid payload cannot be synthesised — by design, and it is not attempted. One genuine
Mini App open is required.
