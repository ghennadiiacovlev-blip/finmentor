# FINMENTOR Phase B.2.1-B — Consistency QA / CAS gate

Status: **TRUE-CONCURRENCY TOCTOU PASS / FAILURE + REVERSED-ORDER MATRIX OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Accepted corrections

`Save Confirmation State` is not part of the read-model mirror contract because it mutates only `updated_at` and `notes`, neither of which is included in the Mini App resume projection. No mirror/invalidation action is required for that writer.

`source_updated_at` is observability only. The derived-state equality check is `projection_version`, computed as SHA-256 over canonical field-ordered serialization of the exact safe mirrored projection.

## CAS primitive evidence

The Data Table conditional publish primitive has been proven behaviorally:

- stale `sync_token` -> zero rows updated;
- current `sync_token` -> exactly one row updated;
- publish operation uses one Data Table `update` with `matchType: allConditions` matching both `chat_id` and `sync_token`;
- no GET-then-unconditional-UPSERT publish path is allowed;
- successful publish sets the expected projection version and `cache_valid=true`.

## True-concurrency / TOCTOU evidence

A genuine overlapping race has now been proven using two separate QA executions for the same `chat_id`.

Observed sequence:

- GEN_A started first and paused for ~20 seconds inside the deliberate TOCTOU window after its authoritative re-read and before conditional publish;
- while GEN_A was still live, GEN_B executed start-to-finish and superseded the row token / published the newer generation;
- GEN_A later resumed and attempted its stale conditional publish;
- GEN_A updated **zero rows** and returned `ABORTED_CAS_MISMATCH`;
- the final derived row remained the GEN_B projection;
- final derived row count was exactly one using a limit-2 verification read;
- no foreign-row selection occurred.

This is real overlapping wall-clock execution, not sequential simulation. It proves that a helper paused between re-read and publish cannot overwrite a later generation once the token has changed.

## Current race proof status

Passed:

- CAS primitive semantics;
- true parallel overlap;
- explicit token-change TOCTOU race;
- stale helper `updated_rows = 0`;
- normal commit order tested in the observed race: GEN_B authoritative commit completed last and final derived state converged to GEN_B;
- final cache matched the final authoritative projection for the tested race;
- final derived row count = 1;
- stale lead-cycle guard evaluated against the final generation and remained safe.

Still required:

1. **reversed authoritative completion order** — A starts first, B commits first, A commits last; final derived state must converge to A. This is the highest-priority remaining race test because it distinguishes final-authority convergence from simple helper-finish ordering;
2. strong publish-failure invalidation beginning from an existing `cache_valid=true` row;
3. verification mismatch invalidation beginning from an existing readable row;
4. duplicate derived rows force authoritative fallback;
5. Data Table MISS forces authoritative fallback and safe repair selection;
6. Data Table outage/error forces authoritative fallback;
7. post-race idempotent replay leaves exactly one semantically identical row;
8. idempotent one-time backfill design;
9. idempotent reconciliation design.

## Duplicate-detection read rule

Fast reads and post-publish verification must fetch up to two rows. Exactly one valid row may be accepted. Zero rows, two rows, tombstones, malformed rows, or read errors must fall back to the authoritative `Bot_Sessions` path.

## Safety boundary

No production mirror, production backfill, reconciliation schedule, Client Concierge writer change, PR merge, or B.2.1-C work is authorized yet.
