# FINMENTOR Phase B.2.1-B — Authoritative Cycle Read / Resume

Status: **IMPLEMENTATION GATE OPEN**  
Branch: `feat/phase-b2.1b-cycle-resume`  
Depends on: B.2.1-A real Telegram validation closure  

## Goal

After server-side Telegram Ed25519 validation, resolve the authoritative FINMENTOR bot session and return a safe Mini App resume payload without creating or mutating a lead.

## Non-negotiable source of truth

- `Bot_Sessions` remains authoritative for the current Telegram cycle/session state.
- Browser-supplied `cycle_id`, `lead_id`, consent, priority, financial zone, status and submit state are untrusted and must be ignored.
- Mini App may resume only from values read server-side after validated Telegram identity.
- Existing Client Concierge cycle semantics remain unchanged.

## Read path

Validated Telegram user id
→ read `Bot_Sessions` using the already-proven fast explicit-range pattern
→ match exactly one row by `chat_id`
→ pass matched row directly into the existing cycle gateway semantics
→ return safe resume projection.

The session lookup must preserve the B.1 invariant:

`Read Bot Sessions → Find Session → Get Bot Session`

No node may be inserted between `Find Session` and `Get Bot Session` if it rewrites `$json`.

For the Google Sheets read use the proven fast form:

- sheet: `Bot_Sessions`
- explicit range: `A:AV`
- no `filtersUI`
- retry policy may remain enabled
- target chat id comes from validated Telegram identity, not from browser fields

## Existing cycle semantics to preserve

- `/start` and explicit `Начать заново` create/reset a cycle.
- `/menu` / `Главное меню` are navigation inside the same cycle.
- consent is valid only when `consent === yes` and `consent_cycle_id === cycle_id`.
- current lead is valid only when `lead_id` is non-empty and `lead_cycle_id === cycle_id`.
- legacy rows with blank cycle bootstrap safely and invalidate stale consent/current lead.
- existing canonical lead identity must not be replaced by provisional Mini App ids.

B.2.1-B itself is **read/resume only**. It must not create a new cycle merely because the Mini App opens.

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
   - existing gateway semantics applied safely;
   - stale consent/current lead not treated as current.

5. **Browser tamper attempts**
   - supplied `chat_id`, `telegram_user_id`, `cycle_id`, `lead_id`, `consent`, `priority` ignored;
   - validated Telegram identity remains authoritative.

6. **Fan-out**
   - read may return many rows, but Find Session must emit exactly one item;
   - downstream gateway must receive exactly one item.

7. **Performance**
   - session read target < 700 ms live;
   - report read / find / gateway / total bootstrap latency separately.

8. **Privacy / retention**
   - do not reintroduce raw initData persistence;
   - retain the no-save policy for the isolated bootstrap while real initData is in scope.

## Acceptance criteria

B.2.1-B closes only when:

- server-validated Telegram identity drives the session lookup;
- exact session matching is proven for owner, QA and unknown user;
- current cycle is resumed without an unintended reset;
- stale cross-cycle consent/lead cannot leak into current resume state;
- fan-out protection is exactly one downstream item;
- session read live latency is acceptable;
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
