# FINMENTOR Phase B.2.1-B — Consistency QA / CAS gate

Status: **CAS PRIMITIVE PASS / FAILURE + CONCURRENCY MATRIX OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Accepted corrections

`Save Confirmation State` is not part of the read-model mirror contract because it mutates only `updated_at` and `notes`, neither of which is included in the Mini App resume projection. No mirror/invalidation action is required for that writer.

`source_updated_at` is observability only. The derived-state equality check is `projection_version`, computed as SHA-256 over canonical field-ordered serialization of the exact safe mirrored projection.

## CAS evidence

The Data Table conditional publish primitive has been proven behaviorally:

- stale `sync_token` -> zero rows updated;
- current `sync_token` -> exactly one row updated;
- publish operation uses one Data Table `update` with `matchType: allConditions` matching both `chat_id` and `sync_token`;
- no GET-then-unconditional-UPSERT publish path is allowed;
- successful publish set the expected projection version and `cache_valid=true`.

This closes the structural TOCTOU requirement for the publish primitive itself. It does not yet constitute a true-concurrency race proof.

## Duplicate-detection read rule

Fast reads and post-publish verification must fetch up to two rows. Exactly one valid row may be accepted. Zero rows, two rows, tombstones, malformed rows, or read errors must fall back to the authoritative `Bot_Sessions` path.

## QA still required

Before any production writer modification, the following must still be proven in QA:

1. strong publish-failure invalidation beginning from an existing `cache_valid=true` row;
2. verification mismatch invalidation beginning from an existing readable row;
3. duplicate derived rows force authoritative fallback;
4. Data Table MISS forces authoritative fallback and safe repair selection;
5. Data Table outage/error forces authoritative fallback;
6. normal concurrent writers converge to the final authoritative projection;
7. reversed authoritative commit-completion order converges to the final authoritative projection;
8. a deliberate TOCTOU race where the token changes between helper authoritative re-read and conditional publish causes the older publish to update zero rows;
9. final cache projection/version/cycle/consent/lead fields equal the final authoritative state after each race;
10. idempotent one-time backfill design;
11. idempotent reconciliation design.

## Safety boundary

No production mirror, production backfill, reconciliation schedule, Client Concierge writer change, PR merge, or B.2.1-C work is authorized yet.
