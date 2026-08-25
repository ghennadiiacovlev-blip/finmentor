# FINMENTOR Phase B.2.1-B — Consistency QA / CAS gate

Status: **REVERSED COMMIT ORDER PASS / STORED-ROW EQUALITY DEFECT OPEN**  
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

A genuine overlapping race has been proven using two separate QA executions for the same `chat_id`.

Observed sequence:

- GEN_A started first and paused for ~20 seconds inside the deliberate TOCTOU window after its authoritative re-read and before conditional publish;
- while GEN_A was still live, GEN_B executed start-to-finish and superseded the row token / published the newer generation;
- GEN_A later resumed and attempted its stale conditional publish;
- GEN_A updated **zero rows** and returned `ABORTED_CAS_MISMATCH`;
- the final derived row remained the GEN_B projection for the fields actually written by the race runner;
- final derived row count was exactly one using a limit-2 verification read.

This proves that a helper paused between re-read and publish cannot overwrite a later generation once the token has changed.

## Reversed authoritative completion order

A second genuine overlap reversed authoritative completion order:

- GEN_A2 started first but was delayed before its authoritative commit;
- GEN_B2 started second and completed its authoritative commit + publish first;
- GEN_A2 committed last and then published;
- final derived race-runner state followed GEN_A2, proving ordering follows authoritative commit completion rather than workflow start order.

This concurrency-ordering result is **PASS**.

## Stored-row equality defect discovered

The reversed-order test surfaced an important verifier defect:

- the race-runner publish set omitted `session_id`;
- the final derived row therefore retained stale `session_id = S-CAS` instead of the intended `S-GEN-A2`;
- `projection_version` still matched because the verifier recomputed the hash from the intended authoritative/publish payload, not from the row actually read back from Data Table.

Therefore the prior statement “final cache matches final authority” is **not yet proven field-by-field**. What is proven is concurrency ordering for the fields actually conditionally published.

Mandatory fix before any further equality claim:

1. include **all mirrored projection fields**, including `session_id`, in the conditional publish set;
2. after publish, read back the Data Table row (limit 2);
3. strip Data Table internals and control metadata;
4. canonicalize the **stored row projection**;
5. compute `projection_version` from the stored row projection or compare stored fields directly to the authoritative expected projection;
6. require exact field-by-field equality for the complete minimal mirrored projection before `cache_valid=true` is trusted.

The verification hash must never be recomputed solely from the helper's intended payload.

## Current race proof status

Passed:

- CAS primitive semantics;
- true parallel overlap;
- explicit token-change TOCTOU race;
- stale helper `updated_rows = 0`;
- normal authoritative completion order;
- reversed authoritative completion order;
- final derived row count = 1;
- stale consent/lead cycle guards evaluated safely against the final generation.

Not yet proven / still required:

1. corrected complete publish set including `session_id`;
2. read-back verification from the **stored row** and exact stored-row vs authority equality;
3. re-run one race after the verifier fix to prove complete final-row equality;
4. strong publish-failure invalidation beginning from an existing `cache_valid=true` row;
5. verification mismatch invalidation beginning from an existing readable row;
6. duplicate derived rows force authoritative fallback;
7. Data Table MISS forces authoritative fallback and safe repair selection;
8. Data Table outage/error forces authoritative fallback;
9. post-race idempotent replay leaves exactly one semantically identical row;
10. idempotent one-time backfill design;
11. idempotent reconciliation design.

## Duplicate-detection read rule

Fast reads and post-publish verification must fetch up to two rows. Exactly one valid row may be accepted. Zero rows, two rows, tombstones, malformed rows, or read errors must fall back to the authoritative `Bot_Sessions` path.

## Response/privacy rule

The Data Table may contain internal control metadata such as `sync_token`, `cache_valid`, `projection_version`, `source_updated_at`, `mirror_updated_at`, and n8n's own `id`, `createdAt`, `updatedAt`. None of these may be projected to the Mini App client. The client response remains strict-whitelist only.

## Safety boundary

No production mirror, production backfill, reconciliation schedule, Client Concierge writer change, PR merge, or B.2.1-C work is authorized yet.
