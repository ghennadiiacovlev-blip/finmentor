# V1 Lead Intake false-retry repair

**Date:** 2026-09-17

**Production workflow:** FINMENTOR Lead Intake PREMIUM FINAL (`QmIyEW2ZEqKregmN`)

**Scope:** retry classification only; no schema, credential, webhook, schedule, connection,
contact, billing, historical-row, or X-Ray workflow change.

## Acceptance-run finding

The repaired 08:32 Romanian request completed successfully after the X-Ray correction:

- ledger row 18 is `AI_DRAFT`;
- request ID is the exact 08:32 submission ID;
- company is `FINMENTOR UAT RO FINAL`;
- locale is `ro`;
- the owner brief contains three diagnoses, satisfying the `2..4` contract.

A later real Mini App request exposed a separate Lead Intake defect. The session reached
`submitted`, its receipt committed to the existing canonical lead, and the acknowledgement was
sent, but Lead Intake returned mode `retry`. The new request had a new request ID and materially
different facts (investment/new project, a distrusted financial model, a professional financial
model as the desired outcome, and a one-week decision horizon). No Leads archive row and no new
X-Ray ledger row were created for it.

## Root cause

At 11:30:37 local time, X-Ray publication updated the canonical Pipeline row. The new Mini App
request reached Lead Intake 57 seconds later. `Dedup Guard` classified any identity match whose
Pipeline `updated_at` was less than two minutes old as a retry, even when the incoming request ID
was different.

`Pipeline.updated_at` is shared mutable operational state. X-Ray publication, SLA maintenance, or
other background work may change it and therefore cannot prove submission identity. The heuristic
silently discarded a genuine new request.

## Repair

Retry authority is now limited to the existing strong proof:

1. the incoming `request_id` equals the stored request ID; and
2. a server-derived contact identity selects the same Pipeline row.

A same-contact request with a different request ID still merges into the canonical lead, but it is
a genuine request: the merge path archives its request facts and invokes request-scoped X-Ray.

Production version: `4707ff76-da4f-49e8-b80c-74c6ceeea93c`.

Fresh API read-back after deployment reported:

- pending delta `0`;
- schema drift `0`;
- credential drift `0`;
- webhook drift `0`;
- schedule drift `0`;
- connection drift `0`.

## Regression evidence

The exact defect is covered by a regression in `qa/lead-intake-trust.test.mjs`: a distinct request
arriving 30 seconds after an unrelated Pipeline update must merge by contact identity and must not
be classified as a retry. Corroborated same-request retries remain retries.

Full offline suite before deployment: **99/99 gates, 3,585 assertions, assertion floors PASS**.

## Residual live proof

The discarded 11:31 request is already durably committed as `retry`; changing code cannot replay
that settled receipt into missing CRM rows. Do not mutate or delete the historical receipt. Final
end-to-end confirmation requires one fresh Mini App new-request submission after this deployment,
followed by read-only verification of its Leads archive row, merged receipt, request-scoped X-Ray
row, Romanian locale, and owner alert.
