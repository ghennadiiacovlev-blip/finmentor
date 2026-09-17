# V1 RO 08:32 merged-request intelligence incident

**Date:** 2026-09-17
**Production workflow:** Financial X-Ray Analysis (`tNSMRoKlFB52vjge`)
**Scope:** request-specific owner intelligence for a valid merge; no client submission, historical-row reset, credential change, billing change, schedule change, or Submit Return Contract change.

## Proven request identity

| Field | Value |
|---|---|
| Telegram user/chat | `551662084` |
| App session | `AS-7651154a4349bb7798aac015d07d4aa652aebaeb9e953b0e599546c7ebeda3b9` |
| Cycle | `C-551662084-1789623087464` |
| Submission ID | `sub_ff414c543ea2c9b9856279367fe958d2` |
| Request ID | `sub_ff414c543ea2c9b9856279367fe958d2` |
| Receipt row | `34` |
| Receipt state | `COMMITTED` |
| Settlement | `merged` |
| Canonical lead | `FIN-1789469658573-427` |
| Archived submission lead | `FIN-1789623146883-643` |

The receipt was created at `2026-09-17 08:32:26.147 +03:00`, claimed at
`08:32:27.920 +03:00`, and settled at `08:32:28.746 +03:00`. The same
Telegram/contact identity matched the existing canonical lead, so the merge is valid. The archived
Leads row independently preserves the new request, including company `FINMENTOR UAT RO FINAL`, role,
RO locale, stated problem, questionnaire facts, and request ID.

## Execution trace

The committed Lead Intake path invoked C3 with the new request ID. Targeted X-Ray selected the
canonical lead in `NEW_REQUEST_ANALYSIS` mode and created ledger row 18:

- analysis ID `XA-FIN-1789469658573-427-E413605CA330-F`
- request ID `sub_ff414c543ea2c9b9856279367fe958d2`
- source `telegram_premium`
- locale `ro`
- model `gpt-4.1`
- created at `2026-09-17T05:33:03.609Z`

The model was called. The provider returned output, but local contract validation rejected it because
`owner_brief.diagnoses` contained one item while the validator requires two through four. The first
failed attempt was persisted with a bounded retry marker. The 09:00 local scheduled retry used the
same analysis and request identities and failed for the same cardinality reason at attempt two.

## Failure-card authority

The owner card at 08:32 was not a replay of the 2026-09-16 15:26 alert. It was rendered from the new
request's failed ledger row. Its `IMC GROUP SRL` presentation was stale because Build Analysis Input
paired the correct archived request by `request_id`, then gave canonical Pipeline fields precedence
over the exact request archive for company and request facts.

Classification: **new request created a new failure row, but the renderer used stale lead/request
presentation context**.

## Root causes

1. `NEW_REQUEST_ANALYSIS` and its retry path did not treat the exact Leads archive row as authority
   for mutable request facts after a valid canonical-lead merge.
2. The prompt showed a one-diagnosis example and did not state the validator's required cardinality,
   while validation required `owner_brief.diagnoses` to contain two through four items.

OpenAI billing or capacity was not the cause of this incident. Production reached `gpt-4.1` and
received model output on both observed attempts.

## Bounded repair

Only the `Build Analysis Input` code in Financial X-Ray Analysis changed:

- request-scoped analysis now prefers the exact archived row for company, role, main pain, goals,
  documents, scale, priority, contact projection, and other mutable request facts;
- legacy/new-lead analysis keeps canonical Pipeline precedence;
- RO and RU prompts now explicitly require two through four evidence-backed diagnoses;
- Pipeline publication, deduplication, CRM schema, scoring, privacy, locale, credentials, webhooks,
  schedules, retries, and historical rows remain unchanged.

Production versions:

- request-authority correction: `f218bf76-7a63-4ee1-85a2-f92faa216117`
- prompt-contract correction: `3038cab5-df8f-4be0-8020-9394f77107a9`

Fresh API readback after the final deployment reported:

- pending delta `0`
- schema drift `0`
- credential drift `0`
- webhook drift `0`
- schedule drift `0`

## Regression coverage

The regression gates prove that the same contact may merge without a duplicate canonical lead; the
new request ID remains independent; older exhausted requests cannot become authority; targeted and
retry analysis use the exact new request archive; the old failure card is not replayed; success emits
one request-specific rich owner alert; the brief resolves the newest request; and RO locale is
preserved.

Full suite before final deployment: **99/99 gates, 3,580 assertions, assertion floors PASS**.

## Production observation

The existing bounded retry is observed without manually invoking X-Ray and without creating a new
submission. Its final ledger result is recorded separately after the scheduled sweep.
