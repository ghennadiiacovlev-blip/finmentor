# FINMENTOR Phase B.2.1-B — Performance Decision

Status: **GOOGLE SHEETS NODE SYNCHRONOUS READ REJECTED FOR LIVE RESUME / ALTERNATE READ PATH PROOF REQUIRED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Decision history

The original `<700 ms` raw Google Sheets node target was retired after repeated isolated benchmarks showed a broad ~1.0–1.7 s band that was not materially improved by retry changes, exact `chat_id` filtering, or the tested `specifyRange` option.

A revised end-to-end UX gate was then tested with real Telegram owner traffic. That gate failed materially.

A subsequent low-rate stage-timing diagnostic now resolves the bottleneck decisively.

## Decisive low-rate evidence

Five genuine owner Mini App resume requests were run 15 seconds apart with no burst and no parallelism.

| Request | Browser total | Server total | Pre-Sheets | Ed25519 | Sheets node | Post-Sheets |
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
- Google Sheets node: **6659 ms**;
- post-Sheets: **12 ms**.

The Google Sheets node read accounts for effectively all server-side latency. Validator, matching, read-only cycle evaluation and safe response construction are negligible.

## Interpretation

The earlier rapid sequential canary did create queue/backoff escalation, but burst pressure is not the root cause of normal owner resume latency. Low-rate requests still spend roughly 6.1–7.2 seconds in the Google Sheets node.

The isolated/manual benchmarks around 1.0–1.7 seconds therefore understate the production webhook critical-path cost on this n8n Cloud instance.

This proves the current **n8n Google Sheets node path** is unacceptable in the synchronous owner-resume path. It does not yet prove the underlying Google Sheets API itself requires 6–7 seconds.

## Final B.2.1-B performance decision

Do **not** relax the UX threshold again.

Do **not** merge PR #10 yet.

Do **not** begin B.2.1-C.

The next architecture gate must remove the current Google Sheets node from the synchronous critical path.

## Candidate 0 — direct Google Sheets REST read (preferred first)

Before introducing a second read model, test whether the existing Google OAuth credential can safely authenticate a generic HTTP Request to the official Google Sheets API.

Use read-only `spreadsheets.values.get` or `spreadsheets.values.batchGet` against the same spreadsheet with an explicit A1 range. The official API supports exact ranges directly.

This candidate is preferred first because it preserves `Bot_Sessions` as the only stored source of truth and avoids synchronization/staleness complexity.

The proof must:

- use the existing Google OAuth credential without exposing tokens;
- be isolated/read-only;
- retrieve only the fields/ranges needed for resume;
- benchmark manual and production-webhook paths;
- preserve exact owner / QA / unknown semantics;
- keep zero writes and no raw Telegram payload retention.

If the existing credential cannot be used safely for a generic HTTP Request, stop this candidate rather than extracting secrets.

## Candidate 1 — n8n Data Table derived read model

Only if direct Sheets REST is unavailable or still too slow, benchmark n8n Data Table exact-row retrieval on the actual Cloud instance.

The Data Table candidate must be:

- derived / non-authoritative;
- keyed by `chat_id`;
- minimal: only safe fields required by read-only resume;
- free of raw Telegram payloads / legacy technical blobs;
- equipped with an authoritative source timestamp/version marker;
- exact for owner, QA and unknown lookup;
- benchmarked in both manual and production-webhook paths.

Only if this isolated proof is materially faster should a separate gate design production synchronization, miss/stale fallback and consistency semantics.

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

These guarantees must carry into any future alternate read-path proof.
