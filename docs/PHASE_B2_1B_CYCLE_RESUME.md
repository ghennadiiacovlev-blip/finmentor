# FINMENTOR Phase B.2.1-B — Authoritative Cycle Read / Resume

Status: **COMPONENT LOGIC PASS / PERFORMANCE BLOCKED / PAYLOAD-WEIGHT DIAGNOSTIC OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
Depends on: B.2.1-A real Telegram validation closure  

## Goal

After server-side Telegram Ed25519 validation, resolve the authoritative FINMENTOR bot session and return a safe Mini App resume payload without creating or mutating a lead.

## Non-negotiable source of truth

- `Bot_Sessions` remains authoritative for the current Telegram cycle/session state.
- Browser-supplied `cycle_id`, `lead_id`, consent, priority, financial zone, status and submit state are untrusted and must be ignored.
- Mini App may resume only from values read server-side after validated Telegram identity.
- Existing Client Concierge cycle semantics remain unchanged.

## Architectural correction discovered during component testing

The production B.1 `Get Bot Session` gateway is **not reusable verbatim** for Mini App resume because it has write-oriented bootstrap semantics: when `cycle_id` is blank it can mint a new cycle. That behavior is correct for the Concierge bootstrap path but would violate B.2.1-B read-only semantics on Mini App open and could fabricate a cycle for an unknown user.

B.2.1-B therefore uses a **read-only cycle evaluator** that preserves the proven validity rules but never mints, resets, archives or mutates state.

This divergence is intentional and approved for B.2.1-B:

- preserve consent/current-lead validity rules;
- preserve stale-cycle invalidation;
- preserve exact session matching;
- do **not** preserve the B.1 side effect of bootstrap cycle creation.

Mini App opening is not `/start` and is not `Начать заново`.

## Read path

Validated Telegram user id
→ read `Bot_Sessions`
→ match exactly one row by `chat_id`
→ pass matched row into the read-only cycle evaluator
→ return safe resume projection.

The session lookup must preserve the fan-out invariant conceptually:

`Read Bot Sessions → Find Session → Read-only Cycle Evaluator → Build Resume`

No node may be inserted between the exact-match stage and evaluator if it rewrites the selected `$json` unexpectedly.

## Existing cycle semantics to preserve

- `/start` and explicit `Начать заново` create/reset a cycle in the Concierge path only.
- `/menu` / `Главное меню` are navigation inside the same cycle.
- consent is valid only when `cycle_id` is non-empty, `consent === yes`, and `consent_cycle_id === cycle_id`.
- current lead is valid only when `cycle_id` is non-empty, `lead_id` is non-empty, and `lead_cycle_id === cycle_id`.
- a blank `cycle_id` must never make blank `consent_cycle_id === cycle_id` or blank `lead_cycle_id === cycle_id` count as current.
- existing canonical lead identity must not be replaced by provisional Mini App ids.

B.2.1-B itself is **read/resume only**. It must not create a new cycle merely because the Mini App opens.

## Component evidence received

Synthetic/read-only harness: `NlIHfmuBQ4mS70G6` (inactive; must never be published because it can inject identity without Telegram validation).

Observed component results:

- Bot_Sessions read returned 26 rows from gid `1584265787`.
- Owner exact match selected row 26 and preserved cycle `C-551662084-1787632478740` with current consent and current lead state.
- QA exact match selected row 27 / `C-QA-001`; hostile browser fields claiming the owner identity were ignored.
- Unknown synthetic identity returned `session_found=false`, no foreign row and no cycle creation.
- Fan-out was `26 → 1 → 1 → 1` for owner, QA and unknown tests.
- Cross-contamination tests passed.
- No production blank-cycle row currently exists, so legacy blank-cycle safety was verified against deterministic synthetic fixtures rather than a live row.
- Whitelisting in `Build Resume` is mandatory because Bot_Sessions contains legacy technical/raw payload columns such as `reply_markup`, `tg_body`, `result`, `lead_payload` and raw JSON-like fields; none may be exposed to Mini App.
- Zero writes / Lead Intake / CRM side effects were observed in the harness.

## Performance benchmark — FAIL on full-row scan

Dedicated benchmark `iZPvZ7Fc6O3kim5U` was run with the same workbook, sheet and explicit `A:AV` range.

Variant A — retry enabled (`3 × 2000 ms`), four measured samples:

- 1009 ms
- 1057 ms
- 1199 ms
- 1545 ms
- median ≈ 1128 ms

Variant B — retry disabled, four measured samples:

- 525 ms
- 1194 ms
- 1539 ms
- 1718 ms
- median ≈ 1367 ms

Combined eight measured samples:

- min: 525 ms
- median: ≈1197 ms
- p95: ≈1657 ms
- max: 1718 ms
- items per read: 26

Conclusion:

- retry is **not** the cause;
- the `<700 ms` B.2.1-B performance gate is not met by a full `A:AV` scan;
- no live resume canary should run until the read path is improved or the acceptance threshold is explicitly changed.

## Candidate 1 — exact `chat_id` lookup: correctness PASS / performance FAIL

Isolated benchmark `D8TnxS6mqqM1RO9v` tested a Google Sheets exact `chat_id` filter with `retryOnFail=false`.

Correctness:

- owner: exactly one row on every lookup, row 26, correct current cycle;
- QA: exactly one row, `C-QA-001`, owner row absent;
- unknown: zero rows, no first-row fallback and no cross-contamination;
- string/numeric chat id coercion was accepted by the node, but downstream identity comparisons must still use `String()` on both sides for deterministic behavior.

Measured owner samples:

- 1033 ms
- 1039 ms
- 1548 ms
- 1900 ms
- median ≈1293 ms
- p95 ≈1847 ms

Wall time for nine lookups was roughly 12.4 s for owner and 12.1 s for QA.

Conclusion:

- exact lookup correctness is strong;
- exact lookup does **not** reduce latency relative to the full scan;
- Candidate 1 is rejected for B.2.1-B performance;
- this result does not prove whether n8n filters server-side or fetches-and-filters internally, so row-count reduction is not established as a network optimization.

## Approved next diagnostic — payload-width isolation only

Do **not** move heavy columns, split the production sheet, create an index sheet, or change the production writer in B.2.1-B.

The next and final performance diagnostic before an architecture decision is a same-window width benchmark.

First read/map the Bot_Sessions headers exactly. Do not guess column letters.

Then benchmark three read shapes with the same credential, workbook and sheet:

1. **FULL** — current `A:AV` baseline.
2. **CORE** — the smallest contiguous canonical/core range that still contains `chat_id` and all fields genuinely required by exact matching, read-only cycle evaluation and `Build Resume`, excluding legacy heavy/raw payload columns wherever the existing physical layout allows it.
3. **CYCLE** — the contiguous cycle-field range only, for diagnostic isolation; this is not necessarily a usable final resume read because it may omit `chat_id` or diagnostic state.

For each shape:

- one warm-up;
- at least six measured reads;
- retry setting held constant;
- report exact range, column count, items, min / median / p95 / max;
- report estimated payload size if safely measurable without reproducing PII/raw payloads.

Also inventory heavy legacy/raw columns by header and column letter only, with safe approximate size characteristics. Do not copy the payload values into the report.

Interpretation:

- if CORE/CYCLE are materially faster, payload width is a meaningful contributor and a narrow final read strategy may be justified;
- if CORE/CYCLE remain around the same ~1.2 s band, Google Sheets round-trip/runtime overhead is the dominant floor and the original `<700 ms` acceptance target should be revisited rather than forcing unsafe schema changes;
- do not build the live owner resume canary until this ambiguity is resolved and a read strategy/threshold is explicitly accepted.

## Safe resume response

Allowed concepts:

- `ok`
- server-generated correlation id
- validated safe Telegram user fields
- `session_found`
- current authoritative `cycle_id`
- safe UI resume state
- safe diagnostic answers already associated with the current cycle
- consent state only as a UI fact for the current cycle
- canonical lead presence only as a boolean/state; expose `lead_id` only if the existing product contract explicitly requires it

Do not return:

- raw Telegram initData
- signature/hash
- full Sheets row
- row number
- internal notes
- credential ids
- legacy technical columns
- stale consent from another cycle
- stale lead from another cycle
- internal CRM-only fields not needed by the Mini App

## No-write boundary

B.2.1-B must keep:

- Lead Intake calls = 0
- Pipeline writes = 0
- consent writes = 0
- Bot_Sessions writes = 0
- Bot_Events writes = 0
- CRM writes = 0

A future draft-persistence/write phase requires a separate gate.

## Test matrix

1. **Existing owner current cycle**
   - validated identity finds exactly one row;
   - current cycle preserved;
   - current consent/current lead semantics preserved;
   - no reset.

2. **Existing QA row**
   - exact row selected;
   - no owner/session cross-contamination.

3. **Unknown Telegram user**
   - no foreign row selected;
   - safe `session_found=false` / bootstrap-needed response;
   - no Sheets write and no cycle creation in B.2.1-B.

4. **Legacy blank-cycle row**
   - test with deterministic synthetic fixture if no live blank-cycle row exists;
   - blank cycle must never validate blank cycle-bound consent/lead;
   - no cycle creation in B.2.1-B.

5. **Browser tamper attempts**
   - supplied `chat_id`, `telegram_user_id`, `cycle_id`, `lead_id`, `consent`, `priority` ignored;
   - validated Telegram identity remains authoritative.

6. **Fan-out**
   - read may return many rows, but Find Session must emit exactly one item;
   - downstream evaluator and resume builder must each receive exactly one item.

7. **Performance**
   - full baseline is blocked at ~1.2 s median;
   - exact lookup is blocked at ~1.3 s median despite correctness;
   - payload-width isolation is the next diagnostic;
   - report exact read / find / evaluator / build resume / total bootstrap timing once a final path is accepted.

8. **Privacy / retention**
   - do not reintroduce raw initData persistence;
   - retain the no-save policy for the isolated bootstrap while real initData is in scope.

## Live owner resume gate

Build the live owner resume endpoint only after an accepted read strategy or revised evidence-based performance threshold is approved.

Then execute one owner-only live canary and prove:

- real Telegram Ed25519 validation passes;
- correct authoritative owner row;
- current cycle unchanged;
- no cycle creation/reset;
- current consent preserved;
- current lead state preserved;
- raw/legacy payload fields absent from response;
- no execution retention of raw initData;
- zero writes / Lead Intake / CRM side effects.

Deactivate any temporary endpoint after the canary.

## Acceptance criteria

B.2.1-B closes only when:

- server-validated Telegram identity drives the session lookup;
- exact session matching is proven for owner, QA and unknown user;
- read-only evaluator is used instead of the mutating B.1 bootstrap gateway;
- current cycle is resumed without an unintended reset;
- stale cross-cycle consent/lead cannot leak into current resume state;
- fan-out protection is exactly one downstream item;
- the final accepted read strategy meets its evidence-based performance gate;
- one live owner resume canary passes;
- zero writes/Lead Intake/CRM side effects;
- Client Concierge, Transport, Lead Intake and BotFather remain unchanged.

## Stop condition

After the B.2.1-B report, stop before:

- draft/session writes;
- consent mutation;
- cycle creation/reset from Mini App;
- Lead Intake submit;
- canonical lead creation/merge;
- B.2.1-C.
