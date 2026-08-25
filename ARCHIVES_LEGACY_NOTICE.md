# Legacy archives and historical reports — NOT production

Date: 2026-08-25
Finding: INDP3-02

## Obsolete GA4 measurement ID

`G-94L98WZ12` is **obsolete and must never be reintroduced**. The production
measurement ID is **`G-94L9B8WZ12`** (note the `B`).

The obsolete ID does not appear anywhere in runtime code. It survives only in
historical material, which is deliberately left unedited — rewriting past reports to
match present reality would destroy the audit trail that explains why the correction
was needed.

| Location | Occurrences | Status |
|---|---|---|
| `CHANGELOG_FINANCIAL_RENTGEN_MOBILE_MENU.md` | historical | LEGACY — do not edit |
| `FINMENTOR_CAMPAIGN_READY_REPORT.md` | historical | LEGACY — do not edit |
| `FINMENTOR_UPDATE_REPORT.md` | historical | LEGACY — do not edit |
| `QUESTIONNAIRE_WEBHOOK_READY_REPORT.md` | historical | LEGACY — do not edit |
| `finmentor_premium_final_candidate_APPROVED.zip` | 85 | LEGACY ARCHIVE — never deploy |
| `finmentor_premium_restored_owner_review.zip` | 85 | LEGACY ARCHIVE — never deploy |
| `finmentor_production_v1.zip` | 0 | clean of the obsolete ID |
| `qa/website-contract.test.mjs` | 1 | INTENTIONAL — asserts the obsolete ID is absent from runtime |

## The ZIP archives are not deployable

`finmentor_premium_final_candidate_APPROVED.zip` and
`finmentor_premium_restored_owner_review.zip` are point-in-time snapshots kept for
provenance. Deploying either would reintroduce, at minimum:

- the obsolete GA4 measurement ID (85 occurrences each)
- submitters that treat any HTTP 2xx as success
- `page_view` forwarding the full URL query to GA4
- the pre-remediation Command Center and Lead Intake trust boundaries

Anything that ships must come from the current tree, never from these archives.

## Guard

`qa/website-contract.test.mjs` asserts the obsolete ID is absent from `analytics.js`,
`main.js` and `lead-transport.js`, so a regression is caught by the gate rather than in
production.
