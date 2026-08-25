# FINMENTOR Phase B.2.1-B — Read-model synchronization / consistency design

Status: **QA PARTIAL PASS / CONCURRENCY + FALLBACK MATRIX OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Current evidence

The n8n Data Table live proof passed decisively as a read-path technology, while the current production-webhook Google Sheets node is too slow for synchronous Mini App resume.

`Bot_Sessions` remains the sole authoritative source of truth. Data Table is a derived, non-authoritative read model only.

See also `docs/PHASE_B2_1B_CACHE_GENERATION_DESIGN.md` for the concurrency-safe generation-token design.

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

## Concurrency-safe cache generation

Use a per-mutation high-entropy `sync_token` tombstone for the derived cache:

- before an authoritative write that changes mirrored fields, invalidate the Data Table row for that `chat_id` with `cache_valid=false` and a new `sync_token`;
- perform the existing authoritative `Bot_Sessions` write;
- on authoritative failure, leave the tombstone so Mini App receives MISS/fallback rather than stale state;
- after authoritative success, a reusable sync helper re-reads the actual authoritative row from `Bot_Sessions`;
- helper computes the safe projection + `projection_version`;
- before publishing, helper re-checks that the current Data Table `sync_token` still matches its token;
- if token changed, a newer mutation exists and the older helper must abort without publishing;
- if token still matches, publish `cache_valid=true` and verify the written projection.

The pre-write Data Table operation is invalidation only; it never asserts new authoritative state.

## Fast read path

validated Telegram identity
→ Data Table exact lookup by `chat_id`
→ accept only exactly one row with `cache_valid=true`
→ read-only evaluator
→ strict safe resume projection.

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
- receive only routing metadata such as `chat_id` and `sync_token`;
- re-read the authoritative row after commit rather than trust the pre-write payload;
- compute a minimal safe projection;
- exclude raw Telegram and legacy payload fields;
- upsert idempotently by `chat_id`;
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

Important limitation of the current failed-upsert test: the row was already absent before the simulated failure. This proves the safe MISS end state, but not yet the stronger case where an existing healthy/stale row must be invalidated when publish fails.

## QA still required before production changes

The remaining QA matrix must prove:

1. **strong publish-failure invalidation** — start with an existing `cache_valid=true` row, force mirror publish/upsert failure, and prove the row becomes tombstone/MISS rather than remaining a stale HIT;
2. duplicate derived rows force authoritative fallback; never select the first row;
3. Data Table outage/error forces authoritative fallback;
4. MISS selects authoritative fallback and safe repair path;
5. concurrency A/B — newer mutation changes `sync_token`; older helper later attempts to publish and must abort;
6. concurrency B/A completion reversal — final cache must correspond to the authoritative row and newest valid token, not helper completion order;
7. confirmation-only writer requires no mirror action and does not invalidate the read model;
8. one-time backfill design is idempotent, duplicate-safe and minimal-field only;
9. reconciliation design can rebuild/repair the derived table from authoritative `Bot_Sessions` without making the read model authoritative.

## Backfill / reconciliation principles

Backfill and reconciliation must read `Bot_Sessions` as authority and write only the derived Data Table. They must be idempotent, detect duplicate `chat_id` rows, compute `projection_version` from the authoritative projection, exclude raw/legacy fields, and verify the resulting derived row.

No continuous high-frequency polling is authorized. Event-driven authoritative-first invalidation/mirror is primary; reconciliation is defense-in-depth.

## Stop condition

Do not modify production writers, run production backfill, activate reconciliation, merge PR #10, or start B.2.1-C until the remaining QA matrix passes and a separate controlled production mirror gate is approved.
