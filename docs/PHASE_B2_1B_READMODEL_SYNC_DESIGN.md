# FINMENTOR Phase B.2.1-B — Read-model synchronization / consistency design

Status: **QA PARTIAL PASS / COMMIT-ORDER CAS + FALLBACK MATRIX OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Current evidence

The n8n Data Table live proof passed decisively as a read-path technology, while the current production-webhook Google Sheets node is too slow for synchronous Mini App resume.

`Bot_Sessions` remains the sole authoritative source of truth. Data Table is a derived, non-authoritative read model only.

See also `docs/PHASE_B2_1B_CACHE_GENERATION_DESIGN.md` for the concurrency-safe commit-order token design.

## Production writer inventory

Production Client Concierge workflow `mppzthlkSJFr6Kle` contains exactly three `Bot_Sessions` writers, all `appendOrUpdate` by `chat_id`:

1. `Save Bot Session` — full session projection after confirmed Telegram delivery.
2. `Save Intake State` — lead/intake/cycle-related state.
3. `Save Confirmation State` — `updated_at` + `notes` only; currently `onError: continueRegularOutput`.

## Important scope correction

`Save Confirmation State` changes no field used by the Mini App read model. Therefore it does **not** need read-model invalidation or mirroring, and its current error behavior is not a blocker for read-model correctness.

Only `Save Bot Session` and `Save Intake State` mutate fields included in the derived resume projection.

Do not change `Save Confirmation State` merely to support the read model.

## Versioning decision

Do not use `cycle_id + updated_at` as the sole version guarantee. Under concurrent same-chat writes, pre-commit runtime timestamps do not reliably encode final commit order.

Use a deterministic `projection_version` (recommended SHA-256) over a canonical serialization of the exact safe mirrored projection read from the authoritative `Bot_Sessions` row after commit.

Keep `source_updated_at` only for observability.

## Commit-order cache generation

For `Save Bot Session` and `Save Intake State` only:

1. pre-write invalidate the derived row (`cache_valid=false`) with a high-entropy start token;
2. perform the authoritative `Bot_Sessions` write;
3. on authoritative failure, leave MISS/tombstone;
4. after authoritative success, issue a new high-entropy **commit token** and update the tombstone to that token;
5. sync helper re-reads the actual authoritative row and computes safe projection + `projection_version`;
6. publish by **conditional Data Table update where `chat_id` and `sync_token=commit_token` both match**;
7. if zero rows update, a later generation exists; abort without publishing;
8. if exactly one row updates, set `cache_valid=true` and verify token/version/current-cycle fields.

A read-token check followed by unconditional upsert is not sufficient; the token condition must be part of the publish operation to close the TOCTOU race.

This design orders cache generations by successful authoritative commit completion rather than mutation start time.

## Fast read path

validated Telegram identity
→ Data Table exact lookup by `chat_id`
→ fetch up to 2 rows
→ accept only exactly one row with `cache_valid=true`
→ read-only evaluator
→ strict safe resume projection.

Limit 2 is intentional: a limit-1 lookup can hide duplicate corruption.

Fallback to authoritative `Bot_Sessions` on:

- MISS;
- tombstone / `cache_valid=false`;
- duplicate rows;
- Data Table error;
- malformed required fields;
- failed verification state.

Never select an arbitrary first row.

## Mirror helper principles

The helper must:

- be reusable from both mirrored production writers;
- receive only routing metadata such as `chat_id` and `commit_token`;
- re-read the authoritative row after commit rather than trust the pre-write payload;
- compute a minimal safe projection;
- exclude raw Telegram and legacy payload fields;
- publish only through conditional token-matched update;
- verify exactly one row, token equality, projection-version equality and current-cycle fields;
- invalidate/delete on publish or verify failure where safely possible;
- alert on unrecoverable mirror inconsistency;
- never roll back an already successful authoritative Sheets write.

## Minimal derived schema

- chat_id
- session_id
- state
- status
- selected_service
- business_model
- main_pain
- urgency
- consent
- lead_id
- cycle_id
- consent_cycle_id
- consent_at
- lead_cycle_id
- lead_intake_ok
- cache_valid
- sync_token
- projection_version
- source_updated_at
- mirror_updated_at

Do not mirror raw/legacy payloads, `notes`, `previous_lead_id`, or n8n internal row metadata into the Mini App response.

## QA evidence received

QA mirror helper: `OwLC7SANtHo69SKo` (QA-only; never activate as a production endpoint).

Passed so far:

- normal projection upsert + read-after-write verification;
- identical replay remains one row / idempotent;
- cycle-change projection follows the authoritative test state;
- verification mismatch invalidates the derived row;
- missing-row / failed-publish end state converges to safe MISS;
- stale consent/lead cycle guards remain safe;
- unknown-user and hostile browser-field handling remain safe from earlier harness evidence.

Important limitation of the current failed-upsert test: the row was already absent before the simulated failure. This proves the safe MISS end state, but not yet the stronger case where an existing valid/stale row must be made unreadable when a new publish fails.

## QA still required before production changes

The remaining QA matrix must prove:

1. strong publish-failure invalidation starting from an existing `cache_valid=true` row;
2. Data Table conditional publish can atomically require both `chat_id` and current `sync_token`; if the node cannot do this, stop;
3. duplicate derived rows force authoritative fallback; never hide duplicates with limit 1;
4. Data Table outage/error forces authoritative fallback;
5. MISS selects authoritative fallback and safe repair path;
6. concurrency normal order and reversed authoritative commit completion order;
7. TOCTOU attempt where token changes between helper re-read and publish; older publish must update zero rows;
8. confirmation-only writer requires no mirror action;
9. one-time backfill design is idempotent, duplicate-safe and minimal-field only;
10. reconciliation design can rebuild/repair the derived table from authoritative `Bot_Sessions` without making the read model authoritative.

## Backfill / reconciliation principles

Backfill and reconciliation must read `Bot_Sessions` as authority and write only the derived Data Table. They must be idempotent, detect duplicate `chat_id` rows, compute `projection_version` from the authoritative projection, exclude raw/legacy fields, and verify the resulting derived row.

No continuous high-frequency polling is authorized. Event-driven authoritative-first invalidation/mirror is primary; reconciliation is defense-in-depth.

## Stop condition

Do not modify production writers, run production backfill, activate reconciliation, merge PR #10, or start B.2.1-C until the remaining QA matrix passes and a separate controlled production mirror gate is approved.
