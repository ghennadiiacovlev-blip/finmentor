# FINMENTOR Premium Mini App — IMPLEMENTATION HANDOFF

**DESIGN = FINAL APPROVED** (2026-08-29)

## Authority

| Item | Reference |
|---|---|
| Authoritative spec | `docs/PREMIUM_UX_FINAL_RU_SPEC.md` — wins over the canvas on any difference |
| Approved canvas (reference) | https://claude.ai/code/artifact/329af337-2f23-4230-bd83-019657eca301 · page 1: system sheet + branch matrix + Денежный поток reference flow · page 2: branch examples |
| Current-state discovery (old product, reference only) | `docs/PREMIUM_UX_CURRENT_STATE_RU_CONCIERGE.md` — its deployed copy is **retired** for the new product |
| Backend contracts to preserve | `docs/PHASE_B2_1_GATEWAY_CONTRACT.md`, `docs/P9_B21C_OWNER_TEST_SURFACE.md` (Gateway = FINAL GO), `docs/P9_R4_LEAD_INTAKE_DEDUP_REMEDIATION.md` (Lead Intake = GO) |

## Non-negotiables

- Implementation **MUST NOT** invent, consolidate, rename or remove copy, options or branches.
  Every string, option set and branch is in the spec; anything not there needs owner approval.
- Implementation **MUST** preserve the existing Gateway and Lead Intake contracts unchanged:
  bootstrap / replay claim on the Gateway, one lead per cycle, success only on canonical
  `ok === true`, idempotent retry, `NEVER_BACKFILL`, per-cycle consent, `Bot_Sessions` `A:AZ`.
- Sample content on the canvas (company names, quoted problems, file names, the bank-meeting
  note) is illustrative only and is **not** a product requirement.
- The visual system is approved and is not to be redesigned during implementation.

## Status

- Unresolved items for visual / content design: **NONE**.
- Production implementation has **NOT** started. No workflow, Gateway, Lead Intake, Supabase or
  Telegram production behaviour was modified by the design phase.
- The existing `app/` directory is the B.2.0 prototype shell (retired copy); it is a starting
  point for the visual tokens only.
