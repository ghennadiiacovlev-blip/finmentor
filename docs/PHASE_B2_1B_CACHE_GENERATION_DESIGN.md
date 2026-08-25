# FINMENTOR Phase B.2.1-B — Read-model generation / concurrency design

Status: **DESIGN DECISION / QA PROOF REQUIRED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Problem clarified by production write inventory

The production Client Concierge writes `Bot_Sessions` through exactly three nodes:

1. `Save Bot Session` — full session projection after Telegram delivery succeeds.
2. `Save Intake State` — lead/intake/cycle-related authoritative mutation.
3. `Save Confirmation State` — `updated_at` + `notes` only; current node uses `onError: continueRegularOutput`.

`Bot_Sessions` remains the sole authoritative source of truth. The n8n Data Table remains a derived read model only.

## Decision 1 — do not mirror confirmation-only writes

`Save Confirmation State` changes only `updated_at` and `notes`, neither of which is part of the Mini App resume projection.

Therefore **no read-model mirror action is required for this writer**. Its current `continueRegularOutput` behavior is not a blocker for read-model correctness, because the derived state does not depend on either field.

Do not change this production error behavior merely to support the read model.

## Decision 2 — version the mirrored projection, not the raw row timestamp

`cycle_id + updated_at` is not strong enough under concurrent same-chat writes because runtime timestamps are generated before commit and do not prove final commit order.

Use a deterministic `projection_version` computed from the exact safe mirrored projection read from the authoritative row. Recommended form: SHA-256 over a canonical serialization of the ordered fields below:

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

`source_updated_at` may still be copied for observability, but must not be used as the sole concurrency/version guarantee.

## Decision 3 — use cache-generation tombstones for concurrency safety

A pure post-write async mirror can temporarily re-introduce stale state when two same-chat writes race. To prevent an older mirror helper from overwriting a newer mutation, use a **cache generation token**.

For writers that mutate mirrored fields (`Save Bot Session`, `Save Intake State`):

1. Generate a high-entropy `sync_token` for this mutation.
2. Before the authoritative Sheets write, invalidate the derived row by setting a tombstone for the same `chat_id`:
   - `cache_valid=false`
   - `sync_token=<new token>`
   - no new authoritative state is asserted.
3. Perform the existing authoritative `Bot_Sessions` write.
4. If the authoritative write fails, leave the tombstone / MISS state; never publish the attempted new projection.
5. After authoritative commit succeeds, the sync helper re-reads the authoritative `Bot_Sessions` row by `chat_id`.
6. Compute the safe projection and `projection_version` from that authoritative row.
7. Before publishing the derived row, re-read the Data Table tombstone and require `sync_token` to still equal the helper token.
8. If the token differs, a newer mutation has started; abort the older helper without publishing.
9. If the token still matches, upsert the safe projection with `cache_valid=true`, the same `sync_token`, `projection_version`, `source_updated_at`, and `mirror_updated_at`.
10. Read-after-write verify exact one-row match, token equality, projection version equality, and current-cycle fields.

This pre-write Data Table operation is **invalidation only**, not an authoritative state write. Authoritative state still commits only in `Bot_Sessions`.

## Decision 4 — fail safe to MISS

Normal Mini App read path:

validated Telegram identity
→ Data Table lookup by `chat_id`
→ accept only exactly one row with `cache_valid=true`
→ read-only evaluator
→ safe resume

Fallback conditions:

- zero rows;
- `cache_valid=false` tombstone;
- more than one row;
- Data Table error;
- malformed required fields;
- failed projection verification evidence.

All such cases must become authoritative `Bot_Sessions` fallback. Never choose an arbitrary first row and never treat a tombstone as state.

## Decision 5 — mirror helper must re-read authority

The helper must not trust the original pre-write payload as proof of final authoritative state. It must re-read `Bot_Sessions` after the commit and mirror the row actually present there.

This is intentionally allowed to be slow because it is outside the normal Mini App read critical path.

## Data Table schema additions

Safe resume fields plus consistency metadata:

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

Do not mirror raw Telegram payloads, notes, `previous_lead_id`, or n8n internal row metadata into the Mini App response.

## QA matrix required before production writer changes

Use QA infrastructure only and prove:

1. normal mutation: invalidate → authoritative commit simulation → authoritative re-read → publish → verify;
2. repeated same mutation is idempotent and remains one row;
3. authoritative write failure leaves MISS/tombstone, never attempted new state;
4. mirror upsert failure leaves/returns to MISS;
5. verification mismatch invalidates derived row;
6. duplicate derived rows force fallback;
7. Data Table outage forces fallback;
8. stale consent and stale lead cycle bindings remain false;
9. unknown user never receives another row;
10. hostile browser identity/state is ignored;
11. **concurrency A/B:** newer mutation changes `sync_token`; older helper attempts to publish and must abort;
12. **concurrency B/A completion reversal:** final published projection must correspond to the authoritative row and newest valid token, not helper completion order;
13. confirmation-only writer requires no mirror and does not invalidate the read model;
14. reconciliation can rebuild derived rows idempotently from authoritative `Bot_Sessions`.

## Production boundary

Do not yet modify production writers, backfill a production Data Table, activate reconciliation, merge PR #10, or begin B.2.1-C.

Only after the QA matrix passes should a controlled production mirror gate be designed.
