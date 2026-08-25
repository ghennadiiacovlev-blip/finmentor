# FINMENTOR Phase B.2.1-B — Read-model Sync / Consistency Gate

Status: **DESIGN GATE OPEN / PRODUCTION SYNC NOT IMPLEMENTED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Why this gate exists

The isolated n8n Data Table read-model proved that the production-webhook latency problem is not inherent to the B.2.1-B resume logic.

Live owner proof (five real Telegram requests, spaced 15 seconds):

- Data Table: 21 / 16 / 15 / 15 / 16 ms
- Data Table P50: 16 ms
- Data Table P95: 21 ms
- server total P50: 38 ms
- browser totals: 1971 / 1894 / 1789 / 1588 / 1893 ms
- browser P50: 1893 ms
- browser P95: 1971 ms
- requests >4000 ms: 0
- consistency: PASS
- forbidden leak fields: none

This meets the approved live UX gate and proves Data Table is a viable **read-path technology**.

However, the QA table was manually seeded and is already a stale copy by design. It is not authoritative and must not be promoted to production without an explicit consistency contract.

`Bot_Sessions` remains the sole authoritative source of truth.

## Non-negotiable architecture

Data Table may be used only as a derived read model/cache for Mini App resume.

It must never become an independent writable source of truth for cycle, consent, or lead state.

Authoritative mutations continue to occur through the existing Concierge/session logic and authoritative `Bot_Sessions` persistence path.

## Required consistency contract before production

The next implementation gate must explicitly define and prove all of the following.

### 1. Update ordering

For every authoritative session mutation:

1. authoritative state is committed first;
2. derived Data Table row is refreshed only after authoritative commit succeeds;
3. if the mirror refresh fails, authoritative state remains valid and the failure is observable/recoverable;
4. Mini App must never treat a failed mirror write as an authoritative success.

Do not reverse this ordering.

### 2. Freshness marker

Each read-model row must include a deterministic freshness/version marker derived from authoritative state, not from browser time.

Preferred candidates:

- authoritative `updated_at` / source update timestamp;
- cycle id plus authoritative mutation timestamp/version;
- another monotonic server-side version if one already exists.

The exact marker must be chosen and documented before implementation.

### 3. Staleness bound

Define a maximum acceptable read-model age for Mini App resume.

A stale row must not silently return as current merely because a `chat_id` match exists.

The implementation must be able to classify at least:

- HIT_FRESH
- HIT_STALE
- MISS
- MIRROR_ERROR / UNAVAILABLE

### 4. Miss / stale fallback

A miss or stale read-model row must fail safely.

Potential acceptable fallback patterns include:

- synchronous authoritative Sheets read only on MISS/STALE;
- safe `resume_deferred` response plus asynchronous refresh;
- another explicitly approved authoritative fallback.

The fallback must not create/reset a cycle merely because the Mini App opened.

### 5. Recovery / reconciliation

There must be a deterministic way to rebuild or repair the derived table from `Bot_Sessions`.

A transient mirror failure must not require manual reconstruction of every row.

The reconciliation path must be idempotent and must not mutate the authoritative source.

### 6. Duplicate / row-key safety

The derived table must enforce one logical row per `chat_id`.

No ambiguous duplicate rows may be accepted as a successful resume hit.

If duplicates are detected, fail closed or choose an explicitly versioned deterministic winner only if that policy is formally approved.

### 7. Privacy / minimization

Only the minimum fields required by Mini App resume may be mirrored.

Never mirror legacy/raw payload fields such as:

- raw_json
- reply_text
- reply_markup
- tg_body
- session
- lead_payload
- event
- result
- error
- notes

n8n Data Table internal fields (`id`, `createdAt`, `updatedAt`) must not escape the strict response whitelist.

### 8. Security / identity

Read-model lookup key remains server-validated Telegram identity only.

Browser supplied `chat_id`, `telegram_user_id`, `cycle_id`, `lead_id`, consent, status, priority, and financial-zone values remain untrusted.

### 9. Availability / rollback

Data Table outage must not corrupt authoritative state.

Rollback must be possible by disabling the read-model path and falling back to the proven authoritative read path, accepting the slower UX temporarily.

No data migration rollback should be required because Data Table is derived and disposable.

## Required test matrix

Before B.2.1-B may close, prove at least:

1. fresh owner hit returns exact current authoritative cycle;
2. fresh QA hit returns QA only;
3. unknown user returns safe miss/no foreign row;
4. authoritative mutation followed by successful mirror refresh returns new state;
5. mirror refresh failure leaves authoritative state correct and marks/handles stale read model safely;
6. stale row cannot resurrect previous-cycle consent or lead;
7. cache miss fallback does not create/reset a cycle;
8. duplicate derived rows fail safely;
9. read-model rebuild/reconciliation is idempotent;
10. response whitelist blocks Data Table internal fields and all legacy/raw fields;
11. real Telegram live resume after synchronization still meets the approved UX gate;
12. zero Lead Intake/Pipeline/consent side effects during read-only resume.

## Performance gate retained

Do not weaken the already-approved UX thresholds:

- browser P50 < 2.0 s
- browser P95 < 3.0 s
- no unreported request > 4.0 s

The live Data Table proof already demonstrated that these thresholds are realistic when the slow Google Sheets read is removed from the critical path.

## Stop condition

This document authorizes architecture design and isolated consistency tests only.

Do not begin B.2.1-C until B.2.1-B has a proven production-safe synchronization/fallback contract and final live owner resume pass.
