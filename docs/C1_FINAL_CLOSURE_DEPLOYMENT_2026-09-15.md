# C1 final closure — production deployment record

**Date:** 2026-09-15
**Cutover:** 05:35:21Z–05:35:28Z
**Status:** **PASS — deployed**

## Outcome

The final C1 customer and owner presentation contract is live across the existing FINMENTOR
Telegram, Premium Mini App, Lead Intake, X-Ray, Command Center, scheduled-alert, and system-alert
workflows.

The Telegram entry now presents the four approved actions, in order:

1. `Описать задачу`
2. `Финансовая диагностика`
3. `Подготовить бриф`
4. `Запросить встречу`

Diagnosis and brief use the existing Premium Mini App. Free text asks one management question,
keeps the client's narrative verbatim, and separates inferred facts from explicit or confirmed
facts. Company name and business activity are separate Mini App screens. A meeting request requires
explicit contact/privacy confirmation, enters the existing Lead Intake route, and claims neither a
calendar booking nor a confirmed slot. The client receives an accepted acknowledgement only after
Intake succeeds, with the approved one-business-day response window.

Visible customer and owner terminology now uses `Финансовая диагностика`, `Ключевая проблема`,
and `Проблема`; retired Financial X-Ray and “pain” presentation labels are absent from the active
surfaces. No separate non-AI baseline concept exists, so no baseline label was introduced.

## Production scope

Eleven existing active workflows were updated. No workflow, node, connection, credential, trigger,
schedule, CRM writer, schema, scoring rule, Starter budget control, or Niagara record was added,
removed, or rewired outside the declared node bodies.

| Workflow | ID | Post-cutover state |
|---|---|---|
| Mini App Gateway | `nTZHLbv2KFggdhh5` | active, read-back verified |
| Premium Mini App host | `KBD7Q94QQnlzgYKJ` | active, read-back verified |
| Lead Intake | `QmIyEW2ZEqKregmN` | active, read-back verified |
| X-Ray Analysis | `tNSMRoKlFB52vjge` | active, read-back verified |
| Lead Command Center | `qF9tonlHHIxc8MDd` | active, read-back verified |
| Daily Lead Digest | `imeJIDeNyaWDyXzh` | active, read-back verified |
| SLA Lead Watch | `LZ2mvKXbBikmeVTn` | active, read-back verified |
| Followup Sequence | `zeLOCuf0K1bkaKl2` | active, read-back verified |
| SYSTEM ALERT | `ID700kTo6EXffwry` | active, read-back verified |
| Error Monitor | `RBiFLhVjizMkAzrK` | active, read-back verified |
| Telegram Client Concierge | `mppzthlkSJFr6Kle` | active, read-back verified |

The deployer wrote downstream surfaces first and the public Concierge last. Every PUT was followed
by an authoritative API read-back, then all eleven workflows were read a second time after the
cutover. No active flag changed and rollback was not invoked.

The SYSTEM ALERT checkpoint intentionally redacted its fallback owner chat ID. The deployer
verified that this was the only checkpoint/live difference, hydrated the untouched live settings
node in memory, and kept all persisted evidence redacted. The real fallback destination therefore
remained live without entering repository or UAT artifacts.

## Verification

- Repository suite: **91/91 gates, 3,415 assertions**.
- C1 live-derived candidate gate: **35/35 assertions**.
- Public production smoke: **13/13 checks**.
- Mini App host: HTTP 200; separate company/activity screens present; production gateway/session/
  submit endpoints present; no unresolved URL placeholder; no retired Financial X-Ray term.
- Gateway, session, and submit: unsigned empty requests rejected with no success, session, or lead
  claim.
- Execution-status scan after cutover: **0 failed executions** across the eleven workflows.

The smoke deliberately did not create a synthetic customer lead or send a customer/owner Telegram
message. The state machine, meeting payload, Intake acknowledgement, and all three owner-alert
routes were executed offline against the exact live-derived candidates; production proof was kept
non-mutating beyond the workflow cutover itself.

## Evidence and rollback

The guarded deployer is `scripts/deploy-c1-final-closure.mjs`. It performs a fresh-live drift check
before the first write and restores all already-written workflows in reverse order if a PUT or
read-back fails.

Redacted preflight, pre-cutover, post-cutover, and result artifacts are stored in:

`.uat/c1-final-closure/deploy-2026-09-15T05-35-21-647Z`

The result manifest records `status: DEPLOYED` and the complete pre/candidate SHA-256 values for all
eleven workflows.
