# V1 RU website X-Ray merge produced no owner alert

**Date:** 2026-09-18
**Production workflow:** FINMENTOR Lead Intake PREMIUM FINAL (`QmIyEW2ZEqKregmN`)
**Scope:** one Code node (`Build C3 Intelligence Request`), `parameters.jsCode` only. No website,
X-Ray, credential, schedule, webhook, Sheet schema or historical-row change.

## Proven request identity

Evidence was read from the production Sheet by one disposable read-only probe workflow
(`[TEMP] FINMENTOR RU XRAY FORENSIC 2026-09-18`, id `qqQfqEE1z2MHj7Fq`): four Google Sheets
`read` nodes, no execution data saved, deleted after capture (GET → 404). Sheet writes 0, leads
created 0, Telegram sends 0.

| Field | Value |
|---|---|
| Submission time | `2026-09-18T12:24:28.759Z` (15:24 Chisinau) |
| Source / tool / language | `website_questionnaire` / `xray_extended` / `ru` |
| Request ID | `fmr_30250d2a7f4d4f088634188971829d61` |
| Submission lead ID | `fm-mu6xhpg2-jceo0n` (Leads row 30) |
| Settlement | `merged` by email into `FIN-1789469658573-427`, HOT / GREEN, not escalated |
| Pipeline | row 23 merge update at `12:24:33.805Z` |
| Activities | row 190 `lead_merged` at `12:24:39.955Z` |
| XRay_Analysis | **no row** for the request (newest rows 20–21 are 2026-09-17 requests) |

## Root cause

Category **C — REQUEST_COMMITTED_BUT_OWNER_ROUTE_NOT_INVOKED**.

Every eligible lead's legacy Lead Intake Telegram alert (`Build Premium/Warm/Incomplete Telegram
…`) returns nothing by design: the single owner alert is the request-specific X-Ray alert.
`Build C3 Intelligence Request` dispatched that X-Ray call for public new leads and for
receipt-committed (Mini App) merges, but returned `[]` for a **public merge**:

```js
// Public merges retain their existing response/side-effect contract. …
if (merged) return [];
```

So a website submission that merged into an existing lead committed durably and reached the owner
through no route at all. X-Ray was never invoked, wrote no ledger row, and its scheduled pass
cannot recover the request because it only retries existing ledger rows.

No failure route fired: SYSTEM ALERT and the Error Monitor recorded nothing, which is consistent —
nothing failed; the dispatch was skipped.

## Bounded repair

A public merge now dispatches the same closed envelope as a Mini App merge, with commit authority
`PUBLIC_PIPELINE_MERGE`, proven by `Respond Merged` **and** `Update Pipeline (Merge)` having
executed. Graph facts proven on the live workflow before and after deployment:

- `Respond Merged` is reached only from `IF Internal (Merge)`'s public branch, which is reached only
  from a successful `Update Pipeline (Merge)`;
- a public retry settles through `Respond Retry` and cannot reach the dispatcher;
- the dispatcher feeds only `Run Owner Intelligence (C3)` → X-Ray `tNSMRoKlFB52vjge`;
- all three legacy intake alerts still suppress eligible leads, so X-Ray stays the single alert.

X-Ray already handles the envelope: `NEW_REQUEST_ANALYSIS` for the exact `request_id`, pairing the
website archive row by `Raw JSON.meta.request_id`, at most one analysis per `request_id`, and older
exhausted failures of the same lead do not suppress the new request.

Deploy: `node scripts/deploy-v1-public-merge-owner-alert.mjs --dry-run | --confirm | --verify`
(version-pinned pre-image, one-node delta, backup under `.uat/`, fresh read-back, runtime execution
of the deployed bytes against this incident, automatic verified rollback).

## Production

Deployed by the owner with `--confirm` at `2026-09-18T12:55Z` (backup
`.uat/v1-public-merge-owner-alert/deploy-2026-09-18T12-55-24-230Z/`). Lead Intake
`4707ff76-da4f-49e8-b80c-74c6ceeea93c` → `ac3cdedb-ee60-4fc7-809c-67f12b885888`; X-Ray unchanged at
`2b19ff83-82c6-474b-96c5-3d39a691e2ee`.

`--verify` passed on the live graph, and an independent read-back against the pre-deploy backup
proved: exactly one changed node, differing only in `parameters.jsCode`; node set, connections,
credentials, webhooks, schedules, Sheets, Telegram nodes and settings identical. The deployed
dispatcher and the live X-Ray `Validate C3 Lead Target` / `Select Pending Leads` code, executed
against this incident, hand the request off once, refuse a hand-off without the Pipeline merge,
select it exactly once as `NEW_REQUEST_ANALYSIS`, and select nothing for a repeated hand-off.

## Regression coverage

`qa/v1-public-merge-owner-alert.test.mjs` (12 assertions) executes the tracked dispatcher, X-Ray
target validator and pending selector against the incident identifiers; covers missing commit
proof, caller-shaped request id, INCOMPLETE eligibility, idempotency per `request_id`, unchanged
public-new and internal-merge authority, pre-image reconstruction, and six refused graph mutations.

## Not repaired

The 12:24 request itself is not replayed or retried (not authorised). The owner retest after
deployment is the proof.
