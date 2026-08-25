# FINMENTOR Phase B.2.1-B — Performance Decision

Status: **DATA TABLE LIVE PERFORMANCE PASS / CONSISTENCY GATE OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Decision

The original `<700 ms` raw Google Sheets read target is no longer a valid B.2.1-B acceptance gate.

Repeated isolated and real-webhook evidence shows the current n8n Google Sheets node/runtime is too slow for synchronous Mini App resume. Direct Google Sheets REST was not available because the existing OAuth credential deliberately blocks generic HTTP Request / GraphQL use; that security restriction was preserved.

A minimal QA-only n8n Data Table read model passed both manual and real production-webhook performance tests by a wide margin.

## Evidence snapshot

### Current n8n Google Sheets path

Low-rate real Telegram stage timing, 5 owner requests spaced 15 seconds apart:

- Sheets: 7190 / 6659 / 6079 / 6390 / 7101 ms
- Sheets median: ~6659 ms
- server median: ~6686 ms
- browser median: ~8320 ms

The current Google Sheets node is therefore the synchronous critical-path bottleneck.

### Data Table live proof

Five genuine owner requests spaced 15 seconds apart:

- Data Table: 21 / 16 / 15 / 15 / 16 ms
- Data Table P50: 16 ms
- Data Table P95: 21 ms
- server P50: 38 ms
- browser totals: 1971 / 1894 / 1789 / 1588 / 1893 ms
- browser P50: 1893 ms
- browser P95: 1971 ms
- requests >4000 ms: 0
- consistency: PASS
- forbidden leak fields: none

Therefore Data Table is accepted as the **read-path technology candidate**.

## Important limitation

The QA Data Table was manually seeded. It is not authoritative and can become stale. Performance proof alone does not authorize production use.

`Bot_Sessions` remains the sole source of truth.

## Current gate

B.2.1-B remains blocked until read-model consistency is proven. The consistency design must cover:

- commit-order-safe invalidation/mirroring;
- projection versioning;
- atomic token-matched conditional publish;
- duplicate detection;
- MISS / outage / stale fallback;
- strong mirror-failure invalidation;
- same-chat concurrency including reversed authoritative commit completion order;
- idempotent backfill/reconciliation;
- privacy-minimal derived schema.

See:

- `docs/PHASE_B2_1B_READMODEL_SYNC_DESIGN.md`
- `docs/PHASE_B2_1B_CACHE_GENERATION_DESIGN.md`

## B.1 interpretation correction

Historical B.1 evidence should be read as follows:

- removing `filtersUI` eliminated the ~5.3 s false-retry/slow path;
- the configured explicit range should not be credited for the speedup unless a future node/runtime proves the range is actually honored.

This does not invalidate the B.1 production improvement; it corrects the causal attribution.

## Production boundary

Do not modify production writers, backfill a production Data Table, activate reconciliation, merge PR #10, or begin B.2.1-C until the consistency QA matrix passes and a separate controlled production mirror gate is approved.
