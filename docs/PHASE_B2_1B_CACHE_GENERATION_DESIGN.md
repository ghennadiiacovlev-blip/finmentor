# FINMENTOR Phase B.2.1-B — Read-model generation / concurrency design

Status: **DESIGN DECISION / QA PARTIAL PASS / COMMIT-ORDER CAS REQUIRED**  
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

## Decision 3 — cache invalidation + commit-order token

A pure post-write async mirror can temporarily re-introduce stale state when two same-chat writes race. A token created only at mutation start is also insufficient: an older mutation may finish its authoritative commit after a newer mutation and therefore become the actual last committed state.

The derived cache must track **authoritative commit completion order**, not mutation-start order.

For writers that mutate mirrored fields (`Save Bot Session`, `Save Intake State`):

1. Generate a high-entropy `start_token`.
2. **Before** the authoritative Sheets write, invalidate the derived row for that `chat_id`:
   - `cache_valid=false`
   - `sync_token=start_token`
   - no new authoritative state is asserted.
3. Perform the existing authoritative `Bot_Sessions` write.
4. If the authoritative write fails, leave the tombstone / MISS state; never publish the attempted new projection.
5. After the authoritative write succeeds, generate a new high-entropy **`commit_token`**.
6. Set the derived row back to a tombstone using `cache_valid=false`, `sync_token=commit_token`. This post-commit token establishes cache-generation order by successful authoritative commit completion.
7. The sync helper re-reads the actual authoritative `Bot_Sessions` row by `chat_id` and computes the safe projection + `projection_version`.
8. Publish must be a **conditional compare-and-set**, not an unconditional upsert: update only the derived row where both `chat_id` and `sync_token=commit_token` still match.
9. If the conditional publish updates zero rows, a later mutation/commit changed the generation; abort without publishing.
10. If exactly one row is updated, set `cache_valid=true`, keep the same `commit_token`, and write the safe projection + `projection_version`, `source_updated_at`, `mirror_updated_at`.
11. Read-after-write verify exactly one row, token equality, projection-version equality and current-cycle fields.

The pre-write and post-commit Data Table operations are invalidation/generation control only. Authoritative state still commits only in `Bot_Sessions`.

### Why two token phases are required

Consider mutation A starting before mutation B, but A's authoritative write finishing after B. A start-order token would incorrectly treat B as newer even though A is the final authoritative commit. Issuing the publish generation token **after successful authoritative commit** makes the last successful commit own the newest cache generation.

### No TOCTOU publish

A separate read-token check followed by an unconditional upsert is not sufficient because another mutation can invalidate between those two operations. The publish itself must carry the `sync_token=commit_token` condition in the same Data Table update operation. If the current Data Table node cannot perform this conditional update safely, the consistency gate remains blocked.

## Decision 4 — fail safe to MISS

Normal Mini App read path:

validated Telegram identity
→ Data Table lookup by `chat_id`
→ fetch up to **2 rows**, not limit 1
→ accept only exactly one row with `cache_valid=true`
→ read-only evaluator
→ safe resume

Fetch up to 2 rows so duplicate corruption is observable. A limit-1 lookup can hide duplicates and is not production-safe.

Fallback conditions:

- zero rows;
- `cache_valid=false` tombstone;
- two or more rows;
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

## QA evidence already passed

QA mirror helper `OwLC7SANtHo69SKo` has proven:

- normal projection upsert + read-after-write verify;
- identical replay is idempotent and remains one row;
- cycle changes propagate in the derived projection;
- forced `projection_version` mismatch invalidates/deletes the derived row;
- a missing row after skipped/failed publish produces safe MISS;
- stale consent/lead guards remain false when cycle binding is not current;
- unknown-user and hostile-browser identity/state handling remain safe from the earlier harness.

The existing publish-failure test is not yet the strongest failure test because the row was already absent before the simulated upsert failure. The production gate requires proof that a previously valid derived row cannot survive a failed new publish as a stale HIT.

## QA matrix still required before production writer changes

Use QA infrastructure only and prove:

1. **strong publish-failure invalidation:** begin with `cache_valid=true` old row, pre-invalidate, simulate authoritative success, issue a commit token, force conditional publish failure, and prove the old state remains unreadable as HIT;
2. duplicate derived rows force fallback; test with read limit 2;
3. Data Table outage forces fallback;
4. MISS forces authoritative fallback and safe repair selection;
5. concurrency A/B with normal completion order;
6. concurrency reversal: A starts, B starts, B commits, A commits later; the final cache must follow the actual final authoritative commit A, not start order;
7. TOCTOU guard: a newer commit token appears between helper re-read and older helper publish; the older conditional publish must update zero rows;
8. confirmation-only writer requires no mirror and does not invalidate the read model;
9. reconciliation/backfill rebuilds rows idempotently from authoritative `Bot_Sessions`.

## Production boundary

Do not yet modify production writers, backfill a production Data Table, activate reconciliation, merge PR #10, or begin B.2.1-C.

Only after the remaining QA matrix passes should a controlled production mirror gate be designed.
