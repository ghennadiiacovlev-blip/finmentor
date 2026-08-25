# FINMENTOR — Full System Audit Task

Branch: `audit/finmentor-full-system`

## Operating rule

This is **AUDIT FIRST**. Do not modify `main`, production n8n workflows, BotFather, credentials, CRM data, production Sheets, or open PR #10. Do not merge PRs. Do not fix findings during the audit unless explicitly asked after review.

## Current production facts to preserve

- Repository: `ghennadiiacovlev-blip/finmentor`
- Current production GA4 Measurement ID: `G-94L9B8WZ12`
- Known obsolete/wrong GA4 ID: `G-94L98WZ12`
- `Bot_Sessions` is the authoritative Telegram client-session source.
- n8n Data Table is only a derived read-model candidate, never the source of truth.
- Open Draft PR #10 (`feat/phase-b2.1b-cycle-resume`) must remain unmerged during this audit.
- Known PR #10 defect: the QA race publisher omitted `session_id`, and one verifier path compared the intended payload rather than the actual Data Table row read back. Concurrency ordering is proven, but full stored-row equality is not yet proven.

## Relevant merged PR history

Review at minimum: #1, #2, #3, #5, #6, #7, #8, #9, #11, #12, #13, #14, #15.

Important history:
- PR #13 reintroduced the wrong GA4 Measurement ID from an older RELEASE assumption.
- PR #15 corrected production back to `G-94L9B8WZ12`.
- Do not resurrect the old ID from historical docs/tests.

## Audit scope

Audit the complete system as one chain:

`Website RU/RO → consent → GA4 → forms/X-Ray → n8n Lead Intake → CRM/Pipeline → lifecycle attribution`

and:

`Telegram Client → Mini App → validated initData → authoritative session → Bot_Sessions → derived Data Table resume path`

## Required checks

### 1. Repository / website
- RU root and physical `/ro/` parity.
- `/app/` Mini App intact.
- navigation, CTA, forms, financial-xray, thank-you, downloads, contact links, privacy/cookie consent, canonical/hreflang, 404s, console/network errors.
- mobile 390/430-class and desktop.
- RO portrait regression remains fixed.

### 2. GA4
- production runtime uses only `G-94L9B8WZ12`.
- old `G-94L98WZ12` is absent from production runtime code; historical docs/tests may contain it but must be classified.
- consent denied: no Google script loads and no analytics events.
- consent accepted: expected GA4 behavior.
- business events: `generate_lead`, `lead_form_start`, `contact_click`, `resource_download`.
- direct thank-you visits must not emit `generate_lead`.
- lead conversion dedup must hold.
- no PII in GA4 parameters.

### 3. GA attribution → n8n
Verify current website lead payload handling for:
- `ga_client_id`
- `ga_session_id`
- `analytics_consent`

Check consultation form, RU financial-xray, RO financial-xray.
Determine whether production Lead Intake accepts, preserves, stores, merges, or drops these fields; identify where attribution lives after intake and whether dedup/merge can lose it.

### 4. Backend GA4 lifecycle gap
Do not assume server-side lifecycle events exist. Verify whether production n8n has any Measurement Protocol / GA4 backend mapping for CRM transitions such as:
- `Qualified → qualify_lead`
- `Won → close_convert_lead`

If absent, record as a gap. Do not implement in this audit.

### 5. n8n inventory
Classify workflows into:
- ACTIVE PRODUCTION
- ACTIVE SCHEDULED
- INACTIVE EVIDENCE
- INACTIVE QA
- TEMPORARY / DELETABLE
- LEGACY

Pay special attention to Lead Intake, Client Concierge, Transport, SLA, Followup, Digest, error monitoring, Mini App/Gateway, B.2.1 probes/benchmarks/harnesses.

### 6. Canonical data boundaries
Verify these boundaries are not violated:
- `Pipeline` = canonical current lead state
- `Leads` = stable intake archive
- `Activities` = event/action journal
- `Bot_Sessions` = authoritative Telegram session state
- Data Table = derived read-model only

Find any accidental second source of truth.

### 7. Lead Intake
Audit validation, consent, dedup, retry/idempotency, Pipeline hard checkpoint, Leads/Lead_Answers/Activities writes, Telegram alerting, AI isolation, error contract, and compatibility with website and future Mini App payloads.

### 8. Telegram / Mini App / PR #10
Review open PR #10 independently. Focus on:
- server-validated Telegram identity only
- no `initDataUnsafe` authority
- read-only resume semantics
- no unintended cycle creation/reset on Mini App open
- CAS publish behavior
- duplicate/miss/error fallback
- Data Table internals never exposed
- strict safe response whitelist
- stored-row read-back verification must compare the actual stored row field-by-field and hash the stored projection
- `session_id` must be included in the full publish projection
- any cache uncertainty must become MISS → authoritative fallback, never stale HIT

### 9. Cross-system field matrix
Create a table with columns:
`FIELD | WEBSITE | LEAD INTAKE | PIPELINE | LEADS | BOT_SESSION | DATA_TABLE | GA4 | TELEGRAM | NOTES`

At minimum include:
- lead_id
- chat_id
- telegram_user_id
- cycle_id
- consent
- consent_cycle_id
- lead_cycle_id
- priority
- financial_zone
- source
- utm_source
- utm_medium
- utm_campaign
- ga_client_id
- ga_session_id
- analytics_consent
- status
- created_at
- updated_at

Classify each as AUTHORITATIVE / DERIVED / OPTIONAL / FORBIDDEN / MISSING / STALE RISK.

### 10. Privacy / secrets
Search for:
- PII in GA4
- bot tokens or secrets in repo/workflow JSON/docs
- raw Telegram initData persistence
- raw initData in execution history/pin data/browser storage/URLs
- unnecessary GA identifiers in Telegram/logs
- phone/email/name/company/free text leaking to analytics

### 11. Duplicate business logic
Find duplicate or conflicting implementations of:
- consent
- priority
- financial_zone
- dedup
- cycle reset
- lead state
- GA conversion
- thank-you confirmation
- resume state
- attribution

For each identify canonical implementation, duplicates, and risk.

## Output

Create:

`docs/FINMENTOR_SYSTEM_AUDIT_2026-08-25.md`

with sections:

1. Executive Summary
2. Current Architecture
3. Production Inventory
4. Website QA
5. GA4 QA
6. Website → n8n Contract
7. CRM Contract
8. Telegram / Mini App Contract
9. Cross-System Field Matrix
10. Privacy / Security
11. Performance
12. PR #10 Status
13. Duplicate Logic / Drift
14. P0 / P1 / P2 / P3 Findings
15. Dead / Legacy Cleanup Candidates
16. Proposed Execution Order
17. GO / NO-GO

Severity:
- P0 = security, identity, data corruption
- P1 = lead loss, duplicate lead, wrong CRM state, materially wrong conversion
- P2 = performance, stale cache, analytics gaps
- P3 = cleanup/docs/dead code

Final summary must include:

- `MAIN SHA`
- `GA4 STREAM`
- `PUBLIC SITE: PASS / ISSUES`
- `GA4: PASS / ISSUES`
- `WEBSITE→N8N: PASS / ISSUES`
- `LEAD INTAKE: PASS / ISSUES`
- `CRM: PASS / ISSUES`
- `TELEGRAM: PASS / ISSUES`
- `MINI APP: PASS / BLOCKED`
- `PR #10: BLOCKED / READY`
- `DATA TABLE: DERIVED ONLY`
- `PRIVACY: PASS / ISSUES`
- P0/P1/P2/P3 lists
- `PRODUCTION CHANGES MADE: NONE`
- recommended integration plan
- `SAFE TO START FIX PHASE: YES / NO`

Stop after producing the audit. Do not implement fixes.