# FINMENTOR Phase B.2.1-B — Authoritative Cycle Read / Resume

Status: **COMPONENT LOGIC PASS / PERFORMANCE + LIVE RESUME PENDING**  
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
→ read `Bot_Sessions` using the already-proven fast explicit-range pattern
→ match exactly one row by `chat_id`
→ pass matched row into the read-only cycle evaluator
→ return safe resume projection.

The session lookup must preserve the B.1 fan-out invariant conceptually:

`Read Bot Sessions → Find Session → Read-only Cycle Evaluator → Build Resume`

No node may be inserted between the exact-match stage and evaluator if it rewrites the selected `$json` unexpectedly.

For the Google Sheets read use the proven fast form:

- sheet: `Bot_Sessions`
- explicit range: `A:AV`
- no `filtersUI`
- retry policy may remain enabled
- target chat id comes from validated Telegram identity, not from browser fields

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

- Bot_Sessions read returned 26 rows from gid `1584265787` using explicit `A:AV` and no `filtersUI`.
- Owner exact match selected row 26 and preserved cycle `C-551662084-1787632478740` with current consent and current lead state.
- QA exact match selected row 27 / `C-QA-001`; hostile browser fields claiming the owner identity were ignored.
- Unknown synthetic identity returned `session_found=false`, no foreign row and no cycle creation.
- Fan-out was `26 → 1 → 1 → 1` for owner, QA and unknown tests.
- Cross-contamination tests passed.
- No production blank-cycle row currently exists, so legacy blank-cycle safety was verified against deterministic synthetic fixtures rather than a live row.
- Whitelisting in `Build Resume` is mandatory because Bot_Sessions contains legacy technical/raw payload columns such as `reply_markup`, `tg_body`, `result` and `lead_payload`; none may be exposed to Mini App.
- Zero writes / Lead Intake / CRM side effects were observed in the harness.

### Current blocker: Sheets latency

Two observed `Read Bot Sessions` durations were approximately 1084 ms and 1587 ms, above the B.1 target. This is not enough evidence to conclude a permanent regression because the prior B.1 isolated/live evidence demonstrated the same explicit-range pattern around the 0.4–0.6 s band.

Do **not** weaken the architecture or reintroduce `filtersUI` to chase latency.

Before B.2.1-B is closed, run a focused latency gate:

1. use the same Google Sheets credential, same workbook, same Bot_Sessions sheet and same explicit `A:AV` range;
2. no validator, no Webhook and no unrelated Code-node work in the measured section;
3. warm-up once;
4. collect at least 8 measured reads;
5. report min / median / p95 / max and item count;
6. compare retry enabled vs retry disabled only in isolated test workflows if necessary;
7. preserve no `filtersUI` and explicit range in every accepted candidate;
8. if median remains >700 ms, investigate node configuration/runtime variance before building the live resume endpoint.

Performance acceptance for B.2.1-B:

- measured warm median session read: **<700 ms**;
- a single live owner read may vary above median, but should normally remain **<1000 ms**;
- if owner live read is >1000 ms, report it and do not hide it inside total bootstrap timing.

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
   - focused warm benchmark as defined above;
   - report read / find / evaluator / build resume / total bootstrap latency separately.

8. **Privacy / retention**
   - do not reintroduce raw initData persistence;
   - retain the no-save policy for the isolated bootstrap while real initData is in scope.

## Live owner resume gate

After performance passes, build an isolated real resume endpoint:

real Telegram initData
→ existing proven Ed25519 validator
→ validated identity only
→ Bot_Sessions read `A:AV`
→ exact Find Session
→ read-only cycle evaluator
→ safe Build Resume
→ response

Then execute one owner-only live canary and prove:

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
- performance gate passes;
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
