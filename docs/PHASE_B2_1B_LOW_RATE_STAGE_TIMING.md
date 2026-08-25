# FINMENTOR Phase B.2.1-B — Low-rate Stage Timing Diagnostic

Status: **GOOGLE SHEETS CRITICAL PATH CONFIRMED / B.2.1-B BLOCKED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Purpose

Decompose the previously observed 8–10+ second real owner Mini App resume latency into validator, pre-Sheets, Google Sheets, and post-Sheets stages without retaining raw Telegram `initData`.

The low-rate test used five genuine owner requests spaced 15 seconds apart. There was no burst and no parallelism.

## Results

| Request | Browser total ms | Server total ms | Pre-Sheets ms | Ed25519 verify ms | Sheets ms | Find ms | Evaluator ms | Build resume ms | Post-Sheets ms |
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
- Google Sheets: **6659 ms**;
- post-Sheets: **12 ms**.

Google Sheets consumed effectively the entire server-side critical path on every low-rate request. Validator, exact matching, read-only cycle evaluation and response construction were negligible by comparison.

## Functional/security result

All five requests returned HTTP 200 and preserved the same authoritative owner cycle.

Observed on every request:

- `session_found = true`;
- same authoritative `cycle_id`;
- `resume_state = lead_submitted`;
- `consent_current = true`;
- `lead_current = true`;
- `cycle_created = false`;
- `cycle_reset = none`;
- recursive `leak_fields = []`.

The prior canary closure already established no-retention and zero canary-induced CRM/Sheets writes. Timing instrumentation did not change behavior or add persistence.

## Bottleneck decision

**PRIMARY BOTTLENECK: GOOGLE_SHEETS_CRITICAL_PATH.**

The earlier rapid sequential benchmark did exhibit queue/backoff escalation, but the low-rate test proves that burst pressure is not the root cause of normal owner resume latency. Even requests spaced 15 seconds apart spend roughly 6.1–7.2 seconds inside the Google Sheets read.

This also resolves the prior production-vs-manual uncertainty: the isolated/manual benchmark showed roughly 1.0–1.7 second Sheets reads, while the real webhook production path shows roughly 6–7 seconds. The performance problem is therefore specifically material in the production webhook critical path.

## Architecture consequence

Do not relax the UX gate again and do not begin B.2.1-C.

The next step is a **read-model architecture gate** that removes Google Sheets from the synchronous Mini App resume path while keeping `Bot_Sessions` authoritative.

Preferred first candidate for an isolated proof is n8n Data Table because n8n supports internal structured tables and exact conditional row retrieval across workflows. This must be benchmarked on the actual Cloud instance before any production writer is changed.

The read model must be derived, minimal and non-authoritative. It must not contain raw Telegram payload columns. A production synchronization strategy, staleness rule and fallback policy require a separate gated design after the isolated latency proof.

## Stop condition

PR #10 remains draft and blocked. Do not merge. Do not start B.2.1-C. Do not modify production Client Concierge / Transport / Lead Intake / Pipeline / BotFather as part of this diagnostic.
