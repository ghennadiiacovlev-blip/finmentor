# FINMENTOR Phase B.2.1-B — Read-model synchronization / consistency design

Status: **DESIGN ACTIVE / QA PROOF REQUIRED**  
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

## Required QA before production changes

QA-only proof must cover:

- normal invalidate → authoritative commit simulation → mirror publish → verify;
- idempotent replay;
- authoritative failure leaves MISS/tombstone;
- mirror-upsert failure leaves/returns to MISS;
- verify mismatch invalidates;
- duplicate safety;
- Data Table outage fallback;
- stale consent and lead safety;
- unknown user / browser tamper;
- concurrency with two same-chat mutations and reversed helper completion order;
- confirmation-only writer requiring no mirror action;
- idempotent reconciliation/backfill design.

## Stop condition

Do not modify production writers, run production backfill, activate reconciliation, merge PR #10, or start B.2.1-C until the QA consistency matrix passes and a separate controlled production mirror gate is approved.
