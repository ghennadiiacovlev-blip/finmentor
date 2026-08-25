# FINMENTOR Phase B.2.1-B — Performance Decision

Status: **RAW SHEETS <700 ms GATE RETIRED / LIVE UX GATE APPROVED**  
Branch: `feat/phase-b2.1b-cycle-resume`  
PR: #10

## Decision

The original `<700 ms` raw Google Sheets read target is no longer a valid B.2.1-B acceptance gate.

It is retired for this phase because repeated isolated evidence shows that the current n8n Google Sheets node/runtime has a broad ~1.0–1.7 s round-trip band that is not materially improved by:

- retry enabled vs disabled;
- full 26-row scan vs exact `chat_id` filter;
- `specifyRange` column narrowing, because the tested node configuration ignores the nested range option and returns the same 40 columns / same payload even for hardcoded `A:C`.

Do not change production schema, split `Bot_Sessions`, create an index/helper sheet, or redesign the writer merely to satisfy the retired node-level target.

## Evidence snapshot

### Full scan

Observed combined samples:

- min ~525 ms
- median ~1197 ms
- p95 ~1657 ms
- max ~1718 ms

### Exact `chat_id` lookup

Correctness: PASS for owner / QA / unknown.

Observed owner samples:

- 1033 ms
- 1039 ms
- 1548 ms
- 1900 ms
- median ~1293 ms

The exact lookup therefore does not provide a performance advantage.

### Payload-width diagnostic

Empirical header map establishes 47 real Bot_Sessions columns A:AU. The Google Sheets read returned only 40 fields through `result` / AN in the tested configuration.

Physical blocks:

- canonical: A:AC
- legacy technical/raw: AD:AO
- cycle: AP:AU

The heavy legacy block accounts for about 40% of the observed serialized payload in the diagnostic sample, but width impact could not be isolated because the node ignored all tested range values (`A:AC`, `AP:AU`, even `A:C`) and returned the same field set / byte count.

Therefore the payload hypothesis remains **INCONCLUSIVE**, not confirmed.

## B.1 interpretation correction

Historical B.1 evidence should be read as follows:

- removing `filtersUI` eliminated the ~5.3 s false-retry/slow path;
- the configured explicit range should not be credited for the speedup unless a future node/runtime proves the range is actually honored.

This does not invalidate the B.1 production improvement; it corrects the causal attribution.

## Approved final read architecture for B.2.1-B

Use the simplest already-proven read-only path:

validated Telegram identity
→ Google Sheets Bot_Sessions read
→ exact in-memory `String(chat_id)` match
→ read-only cycle evaluator
→ strict safe resume projection

Do not use the exact Google Sheets filter as a performance optimization because it is not faster.

Do not redesign storage in this phase.

## Revised performance gate

B.2.1-B is now accepted on end-to-end user-visible resume latency, not on one Google Sheets node duration.

### Live owner canary gate

Run one owner-only real Telegram Mini App canary with no-retention enabled.

The canary page may keep the genuine `initData` only in page memory and may issue one warm-up plus 10 immediate measured bootstrap requests using the same still-fresh payload. It must not persist or display the raw payload.

Measure in the browser from POST start until the safe resume JSON is received and render-ready.

Acceptance:

- first real owner resume response: **< 3.0 s**;
- measured warm P50 end-to-end resume: **< 2.0 s**;
- measured warm P95 end-to-end resume: **< 3.0 s**;
- no individual measured request should exceed **4.0 s** without being reported as a performance exception;
- Google Sheets node duration must still be reported transparently, but it has no independent `<700 ms` pass/fail threshold.

If these UX thresholds fail, B.2.1-B remains blocked and a different session-store/read-model architecture may be considered in a later explicit decision.

## Functional/security gates remain unchanged

The performance-gate revision does not weaken correctness or security requirements.

B.2.1-B still requires:

- real Telegram Ed25519 validation;
- validated Telegram identity as the only lookup identity;
- exact owner session match;
- no cycle creation/reset on Mini App open;
- current-cycle consent/lead safety;
- blank-cycle stale consent/lead suppression;
- no cross-contamination;
- strict response whitelist / no raw legacy payload fields;
- no execution retention of raw `initData`;
- Lead Intake calls = 0;
- Pipeline writes = 0;
- consent writes = 0;
- Bot_Sessions writes = 0;
- Bot_Events writes = 0;
- CRM writes = 0;
- Client Concierge / Transport / Lead Intake / BotFather unchanged.

## Next action

Build the isolated Live Resume Canary and run the revised end-to-end UX gate. Do not begin B.2.1-C until B.2.1-B closes.
