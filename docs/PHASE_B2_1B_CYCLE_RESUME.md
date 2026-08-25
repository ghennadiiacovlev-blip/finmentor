# FINMENTOR Phase B.2.1-B — Authoritative Cycle Read / Resume

Status: **COMPONENT CORRECTNESS PASS / LOW-RATE STAGE TIMING CONFIRMS GOOGLE SHEETS CRITICAL PATH / BLOCKED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
Depends on: B.2.1-A real Telegram validation closure  

## Goal

After server-side Telegram Ed25519 validation, resolve the authoritative FINMENTOR bot session and return a safe Mini App resume payload without creating or mutating a lead.

## Non-negotiable source of truth

- `Bot_Sessions` remains authoritative for the current Telegram cycle/session state.
- Browser-supplied `cycle_id`, `lead_id`, consent, priority, financial zone, status and submit state are untrusted and must be ignored.
- Mini App may resume only from values read server-side after validated Telegram identity.
- Existing Client Concierge cycle semantics remain unchanged.

## Approved read-only evaluator

The production B.1 `Get Bot Session` gateway is not reusable verbatim for Mini App resume because it can mint a cycle when `cycle_id` is blank. That behavior is valid for Concierge bootstrap but not for Mini App open/resume.

B.2.1-B therefore uses a read-only cycle evaluator that preserves consent/current-lead validity rules while never creating, resetting, archiving or mutating state.

Current consent is valid only when `cycle_id` is non-empty, `consent === yes`, and `consent_cycle_id === cycle_id`.

Current lead is valid only when `cycle_id` is non-empty, `lead_id` is non-empty, and `lead_cycle_id === cycle_id`.

Blank `cycle_id` never validates blank consent/lead cycle ids.

## Component correctness evidence

Synthetic/read-only harness: `NlIHfmuBQ4mS70G6` (inactive; must never be published because it can inject identity without Telegram validation).

Observed:

- owner exact match correct;
- QA exact match correct;
- unknown user returns no foreign row;
- browser tamper fields ignored;
- fan-out `26 → 1 → 1 → 1`;
- current owner cycle/consent/lead preserved;
- no unintended cycle creation/reset;
- legacy blank-cycle safety verified with deterministic synthetic fixtures because no live blank-cycle rows exist;
- strict safe response projection prevents raw/legacy payload leakage;
- zero writes / Lead Intake / CRM side effects.

## Performance investigations

### Full read

Dedicated benchmark `iZPvZ7Fc6O3kim5U`:

- min ~525 ms;
- median ~1197 ms;
- p95 ~1657 ms;
- max ~1718 ms.

Retry enabled vs disabled did not explain latency.

### Exact `chat_id` lookup

Benchmark `D8TnxS6mqqM1RO9v`:

- correctness PASS for owner / QA / unknown;
- median ~1293 ms;
- p95 ~1847 ms;
- no performance gain over full read.

### Payload-width diagnostic

Benchmark `AYa6BeKRlgaDQa7d` established:

- 47 real headers A:AU;
- canonical A:AC;
- legacy technical/raw AD:AO;
- cycle AP:AU;
- heavy legacy payload contributed ~40% of observed serialized bytes.

However, the Google Sheets node's tested `specifyRange` option did not narrow returned columns even for hardcoded `A:C`, so payload-width impact could not be isolated through that node configuration.

The historical B.1 speedup should therefore be attributed to removing `filtersUI`, not to the decorative explicit range setting.

## Revised UX gate and live canary

The raw `<700 ms` Sheets-node gate was retired after isolated evidence showed it was not achievable with available read shapes.

A real owner Telegram WebView canary was run with the revised UX gate.

Functional correctness remained PASS, but performance failed materially:

- first real resume ~10.262 s;
- server total ~8.360 s;
- warm min ~7.002 s;
- warm P50 ~7.854 s;
- warm P95/max ~37.563 s;
- all 10 measured warm requests >4 s.

The rapid burst sequence showed queue/backoff escalation, so a low-rate diagnostic was required before any architecture decision.

## Low-rate stage timing — decisive evidence

Five genuine owner requests were run 15 seconds apart with timing-only instrumentation and no retention.

| Request | Browser total ms | Server total ms | Pre-Sheets ms | Ed25519 ms | Sheets ms | Find ms | Evaluator ms | Build ms | Post-Sheets ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9146 | 7213 | 12 | 0 | 7190 | 0 | 0 | 0 | 11 |
| 2 | 8320 | 6686 | 14 | 0 | 6659 | 0 | 0 | 0 | 13 |
| 3 | 7848 | 6103 | 12 | 1 | 6079 | 0 | 0 | 1 | 12 |
| 4 | 8148 | 6413 | 12 | 0 | 6390 | 1 | 1 | 0 | 11 |
| 5 | 8896 | 7126 | 12 | 0 | 7101 | 0 | 0 | 0 | 13 |

Medians:

- browser total: **8320 ms**;
- server total: **6686 ms**;
- pre-Sheets: **12 ms**;
- Sheets: **6659 ms**;
- post-Sheets: **12 ms**.

The synchronous Google Sheets read consumes effectively the entire server-side critical path in the real production-webhook path. Validator, exact matching, evaluator and response construction are negligible.

All five requests preserved the same authoritative cycle and returned `leak_fields=[]`.

See `docs/PHASE_B2_1B_LOW_RATE_STAGE_TIMING.md` for the full diagnostic record.

## Architecture decision gate

B.2.1-B is now blocked on the synchronous session-read architecture, not on correctness.

Do not relax the UX gate again. Do not merge PR #10. Do not begin B.2.1-C.

The next phase inside B.2.1-B is an isolated read-model proof that removes Google Sheets from the owner-resume critical path while keeping `Bot_Sessions` authoritative.

Preferred first candidate: n8n Data Table as a minimal derived read model keyed by `chat_id`. Benchmark exact row retrieval on the actual Cloud instance before changing any production writer.

The candidate read model must:

- be non-authoritative and derived from `Bot_Sessions`;
- contain only fields required for read-only resume;
- contain no raw Telegram payloads, notes or legacy technical blobs;
- support exact deterministic owner / QA / unknown lookup;
- have an explicit freshness/staleness marker;
- have a defined miss/stale policy;
- not be introduced into production until isolated latency and consistency tests pass.

A production synchronization strategy requires a separate explicit gate after the isolated proof.

## No-write boundary

Until a separate architecture gate is approved:

- Lead Intake calls = 0;
- Pipeline writes = 0;
- consent writes = 0;
- Bot_Sessions writes = 0;
- Bot_Events writes = 0;
- CRM writes = 0;
- production Client Concierge / Transport / Lead Intake / BotFather unchanged.

## Stop condition

Do not proceed to B.2.1-C, draft persistence, consent mutation, cycle creation/reset, Lead Intake submit, or canonical lead creation/merge while B.2.1-B remains blocked.
