# FINMENTOR — Independent Verification Task

Branch: `audit/finmentor-independent-review`
Base evidence commit: `b4f01fc266777f1f5127d86f15259c5da4203889`
First audit report: `docs/FINMENTOR_SYSTEM_AUDIT_2026-08-25.md`

## Role

You are the **second independent reviewer**. Do not repeat or endorse the first audit by default. Reproduce evidence where possible, challenge severity, reject false positives, and identify missed issues.

This is **READ-ONLY / AUDIT ONLY**.

Do not modify `main`, production n8n workflows, credentials, Google Sheets, CRM data, BotFather, or PR #10. Do not activate/deactivate/delete workflows. Do not send production POST/exploit requests. Do not merge PRs. Do not fix findings during this review.

Use the existing environment variables `N8N_BASE_URL` and `N8N_API_KEY` if present. Never print or persist the API key or credential secret values.

## Current immutable production facts to preserve

- Repository: `ghennadiiacovlev-blip/finmentor`
- Production GA4 Measurement ID: `G-94L9B8WZ12`
- Wrong/obsolete GA4 ID: `G-94L98WZ12`
- `Pipeline` is intended canonical current lead state.
- `Leads` is intake/archive history.
- `Activities` is event journal.
- `Bot_Sessions` is authoritative Telegram client session state.
- n8n Data Table may only be derived read-model/cache.
- Open Draft PR #10 must remain unmerged during this review.

## First audit findings to challenge, not assume

First audit reported:

- 33 n8n workflows total, 7 active, 26 inactive, 7 archived.
- Active event workflows: Lead Intake, Client Concierge, Transport, Lead Command Center.
- Active scheduled: SLA Lead Watch, Followup Sequence, Daily Lead Digest.
- No duplicate active webhook path and only one active Telegram Trigger.
- All 33 `pinData` empty.
- No active Data Table production path.
- Server-side GA4 lifecycle sender absent.
- GA attribution fields are not structured through Lead Intake.
- PR #10 remains blocked.

It classified three P0 findings:

1. GA4 explicit `page_view` sends `location.href` and `location.pathname + location.search`, creating a potential query-string PII path.
2. Active Lead Command Center generic webhook may trust spoofable Telegram-shaped IDs and mutate CRM without strong authentication.
3. Active Lead Intake may accept client-controlled `lead_id` / risk-state signals that can select/merge/escalate canonical Pipeline state.

Do not accept these P0 labels automatically. Verify both the factual mechanism and the severity.

## Priority verification

### A. P0-01 GA4 query exposure

Verify from current `main`:

- exact `analytics.js` page_view payload;
- whether `page_location` or `page_path` includes query;
- whether any current site flows intentionally place email, phone, name, company, free text, lead_id, Telegram identity, or other sensitive fields in query strings;
- whether thank-you/tool/debug query parameters are the only normal query usage;
- whether arbitrary external query values could still be forwarded to GA4 after consent.

Return two separate conclusions:

- `MECHANISM EXISTS: YES/NO`
- `CURRENT FIRST-PARTY PII URL FLOW EXISTS: YES/NO/NOT PROVEN`

Then independently set severity P0/P1/P2/NOT-A-FINDING.

### B. P0-02 Lead Command Center authentication

Using read-only n8n API, inspect workflow `Ukn1cprWiXzBHojl` in full.

Verify:

- exact trigger type/path/authentication settings;
- all identity parsing code;
- whether body `message.chat.id`, `callback_query.message.chat.id`, `from.id`, headers, query or another field can establish owner/manager identity;
- whether any Telegram secret token/header/signature exists before mutations;
- whether webhook is actually reachable while workflow active;
- exact mutation actions reachable after authorization logic;
- Pipeline read GID and Pipeline update GID;
- whether any upstream infrastructure not visible in workflow could provide authentication (do not assume either way).

Do not send a forged POST. Static/live graph evidence only.

Return:

- `UNAUTHENTICATED SPOOF PATH: CONFIRMED / NOT CONFIRMED / INCONCLUSIVE`
- `CANONICAL CRM MUTATION REACHABLE: YES/NO`
- independent severity.

### C. P0-03 Lead Intake client-controlled merge/state

Inspect active Lead Intake `QmIyEW2ZEqKregmN` end-to-end.

Verify:

- accepted inbound schema for `lead_id`;
- validation/normalization of `lead_id`;
- exact dedup precedence;
- whether browser/public callers can supply `lead_id` directly;
- whether selected existing Pipeline row can be modified on duplicate/merge;
- which fields can change: priority, financial_zone, status, next_action, SLA, contact fields, source, consent, etc.;
- whether server recomputes risk/priority independently or trusts client-supplied values/diagnostics;
- whether source/channel restrictions exist;
- whether Won/Lost are protected from absorption;
- whether authorization is expected by product design for public lead intake.

Do not send exploit POSTs.

Return:

- `CLIENT-CONTROLLED EXISTING-ROW SELECTION: YES/NO`
- `CANONICAL STATE MUTATION AFTER SELECTION: YES/NO`
- `AUTHORIZATION BOUNDARY MISSING: YES/NO/NOT APPLICABLE`
- independent severity.

### D. Pipeline GID split

Verify whether Command Center reads GID `1883973304` but writes GID `1997367085`.

Determine whether `1997367085` is:

- another valid current Pipeline sheet/table,
- stale/old sheet,
- accidental GID,
- or impossible to resolve from read-only evidence.

Do not call it data corruption without proving target semantics.

### E. Website success contract

Verify all consultation/X-Ray/mini-scan client submitters.

Determine whether they treat any HTTP 2xx as success or parse `{ok:true}`.

Then inspect Lead Intake response placement relative to secondary writes.

Distinguish:

- canonical Pipeline commit success;
- archive/answers/activity/alert/AI completion;
- user-visible success;
- GA conversion trigger.

Set independent severity.

### F. Idempotency

Verify dedup and retry logic, but distinguish:

- business deduplication;
- transport retry handling;
- true atomic idempotency under concurrent requests.

Do not claim real duplicate production incidents unless evidence exists.

### G. Privacy/OpenAI

Inspect active Lead Intake OpenAI branch.

Determine exactly which fields are sent and under which guard.

Distinguish:

- contact PII;
- raw payload;
- analytics IDs;
- consent fields;
- whether client AI is enabled/disabled;
- whether OpenAI is a processor already disclosed anywhere on current RU/RO privacy pages.

Do not make legal conclusions beyond the text/evidence; classify as technical/data-minimization/disclosure risk.

### H. GA attribution lifecycle

Verify current website producers and n8n receiver:

- `analytics_consent`
- `ga_client_id`
- `ga_session_id`
- `utm_source`
- `utm_medium`
- `utm_campaign`

Trace new lead, duplicate/merge and retry paths.

Confirm whether structured storage exists or fields survive only in raw JSON.

Verify absence/presence of server-side GA4 Measurement Protocol lifecycle workflow.

### I. Error monitoring

Verify first audit claim that there are zero Error Trigger / `errorWorkflow` configurations across all live workflows.

Distinguish global monitoring from node-level retry/onError behavior.

### J. PR #10

Review PR #10 independently.

Do not rely only on the first audit. Confirm:

- docs-only status;
- known `session_id` publish-set defect;
- intended-payload vs actual stored-row hash verification defect;
- concurrency evidence in docs;
- failure/fallback gaps;
- whether any live QA workflows provide stronger evidence than the PR diff itself.

PR #10 remains unmerged.

## Full-system checks

Also independently verify:

- exact active n8n inventory and pagination;
- active/inactive/archived state;
- active test/canary exposure;
- duplicate webhook paths;
- multiple active Telegram Trigger collisions;
- pinData presence/absence;
- current GA4 Measurement ID in runtime code;
- old ID only in historical artifacts;
- RU/RO parity issues;
- security response headers;
- x-default drift;
- tracked secrets/token scan;
- live browser/DebugView limitations if browser tooling is unavailable.

## Severity discipline

Use:

- P0 = immediately exploitable security/trust-boundary failure, confirmed data corruption/wrong identity, or deterministic sensitive-data disclosure with material impact.
- P1 = material lead loss/state integrity/privacy/compliance/conversion correctness issue requiring prompt fix.
- P2 = performance, observability, attribution, incomplete safeguards, non-critical analytics/UX/release assurance gaps.
- P3 = cleanup/docs/debt.

Do not inflate severity merely because a mechanism is theoretically possible. State prerequisites and evidence.

## Output

Create exactly one new file:

`docs/FINMENTOR_INDEPENDENT_REVIEW_2026-08-25.md`

Do not edit the first audit report.

Required structure:

1. Executive verdict
2. Evidence reproduced
3. Findings from first audit CONFIRMED
4. Findings DOWNGRADED
5. Findings REJECTED / FALSE POSITIVES
6. New findings missed by first audit
7. P0 deep verification
8. n8n topology reconciliation
9. GA4/privacy reconciliation
10. Website→Lead Intake contract
11. PR #10 independent verdict
12. Final severity table
13. Release GO/NO-GO
14. Minimal ordered fix plan
15. Items still requiring owner/browser/external-system evidence

End exactly with:

```
FINMENTOR INDEPENDENT REVIEW — FINAL

FIRST AUDIT OVERALL QUALITY:
STRONG / MIXED / WEAK

P0 CONFIRMED:
...

P0 DOWNGRADED:
...

P0 REJECTED:
...

FINAL P0 COUNT:
...

FINAL P1 COUNT:
...

FINAL P2 COUNT:
...

FINAL P3 COUNT:
...

LIVE N8N INVENTORY:
PASS / FAIL

GITHUB ↔ N8N DRIFT:
PASS / ISSUES

PR #10:
BLOCKED / READY

CURRENT PRODUCTION SITE:
KEEP RUNNING / ROLLBACK REQUIRED

NEW INTEGRATION RELEASE:
GO / NO-GO

SAFE TO START CONTROLLED FIX PHASE:
YES / NO

PRODUCTION CHANGES MADE:
NONE

STOP.
```

Do not fix anything. Do not create a PR. Commit/push the independent report only after the user explicitly asks.