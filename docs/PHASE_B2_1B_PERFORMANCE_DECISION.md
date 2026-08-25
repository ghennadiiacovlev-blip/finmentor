# FINMENTOR Phase B.2.1-B — Performance Decision

Status: **GOOGLE SHEETS SYNCHRONOUS READ REJECTED FOR LIVE RESUME / READ-MODEL PROOF REQUIRED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Decision history

The original `<700 ms` raw Google Sheets node target was retired after repeated isolated benchmarks showed a broad ~1.0–1.7 s band that was not materially improved by retry changes, exact `chat_id` filtering, or the tested `specifyRange` option.

A revised end-to-end UX gate was then tested with real Telegram owner traffic. That gate failed materially.

A subsequent low-rate stage-timing diagnostic now resolves the bottleneck decisively.

## Decisive low-rate evidence

Five genuine owner Mini App resume requests were run 15 seconds apart with no burst and no parallelism.

| Request | Browser total | Server total | Pre-Sheets | Ed25519 | Sheets | Post-Sheets |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9146 ms | 7213 ms | 12 ms | 0 ms | 7190 ms | 11 ms |
| 2 | 8320 ms | 6686 ms | 14 ms | 0 ms | 6659 ms | 13 ms |
| 3 | 7848 ms | 6103 ms | 12 ms | 1 ms | 6079 ms | 12 ms |
| 4 | 8148 ms | 6413 ms | 12 ms | 0 ms | 6390 ms | 11 ms |
| 5 | 8896 ms | 7126 ms | 12 ms | 0 ms | 7101 ms | 13 ms |

Medians:

- browser total: **8320 ms**;
- server total: **6686 ms**;
- pre-Sheets: **12 ms**;
- Sheets: **6659 ms**;
- post-Sheets: **12 ms**.

The Google Sheets read accounts for effectively all server-side latency. Validator, matching, read-only cycle evaluation and safe response construction are negligible.

## Interpretation

The earlier rapid sequential canary did create queue/backoff escalation, but burst pressure is not the root cause of normal owner resume latency. Low-rate requests still spend roughly 6.1–7.2 seconds in the Google Sheets read.

The isolated/manual benchmarks around 1.0–1.7 seconds therefore understate the production webhook critical-path cost on this n8n Cloud instance.

## Final B.2.1-B performance decision

Do **not** relax the UX threshold again.

Do **not** merge PR #10 yet.

Do **not** begin B.2.1-C.

The synchronous Google Sheets read is not acceptable for the real Mini App resume path.

The next architecture gate must prove a faster **derived read model** while keeping `Bot_Sessions` authoritative.

## Preferred first candidate

Use an isolated n8n Data Table proof because n8n supports internal structured data tables and conditional row retrieval across workflows.

The proof must occur before production writers are changed.

The Data Table candidate must be:

- derived / non-authoritative;
- keyed by `chat_id`;
- minimal: only safe fields required by read-only resume;
- free of raw Telegram payloads / legacy technical blobs;
- equipped with an authoritative source timestamp/version marker;
- exact for owner, QA and unknown lookup;
- benchmarked in both manual and production-webhook paths.

Only if the isolated candidate is materially faster should a second gate design synchronization, staleness and fallback semantics.

## Functional/security gates remain unchanged

B.2.1-B correctness is already PASS for:

- real Telegram Ed25519 validation;
- validated identity as the lookup source;
- exact owner/QA/unknown behavior;
- no cycle mint/reset on Mini App open;
- current-cycle consent/lead safety;
- blank-cycle stale-state suppression;
- strict response whitelist;
- no raw `initData` retention;
- zero canary-induced CRM/Sheets writes.

These guarantees must carry into any future read-model proof.
