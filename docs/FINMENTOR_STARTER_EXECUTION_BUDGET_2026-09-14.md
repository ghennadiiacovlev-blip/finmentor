# FINMENTOR V1 — Starter execution-budget optimization

Status: **PRE-DEPLOY REPORT — PASS. NOT MERGED. NOT DEPLOYED.**

This change is limited to the four active Schedule Trigger parameters and the explicit workflow
timezone required to interpret them. The Error Monitor remains event-driven. No monitoring
workflow, backfill, business-logic, X-Ray methodology, CRM, Telegram UX, Mini App, privacy,
Client Visibility, credential, webhook, data/schema, or Niagara change is included.

## Complete active-schedule inventory

Read-only n8n API inventory captured 2026-09-14: **112 workflows**, **15 active workflows**, and
exactly **4 active workflows containing a Schedule Trigger**. Those four are the four rows below.
The active Error Monitor has one Error Trigger and no Schedule Trigger.

Monthly planning uses 22 business days. Old 24/7 schedules use a 365.25/12-day average month and
are rounded per workflow. The approved X-Ray maximum of 528 defines its 08:00–20:00 window as
half-open: 08:00 through 19:30, 24 runs/business day. SLA includes its 20:00 run, 7/business day.

| Workflow | Old schedule | Old monthly executions | New schedule (Europe/Chisinau) | New monthly executions |
|---|---:|---:|---:|---:|
| FINMENTOR X-Ray Analysis | Every 10 minutes, 24/7 | 4,383 | Mon–Fri, 08:00–19:30, every 30 minutes | 528 |
| FINMENTOR SLA Lead Watch PREMIUM FINAL | Every hour, 24/7 | 731 | Mon–Fri, 08:00–20:00, every 2 hours | 154 |
| FINMENTOR Daily Lead Digest PREMIUM FINAL | Daily at 08:30 | 30 | Mon–Fri at 08:30 | 22 |
| FINMENTOR Followup Sequence PREMIUM v2 | Every hour, 24/7 | 731 | Mon–Fri at 10:00 and 16:00 | 44 |
| FINMENTOR Error Monitor PREMIUM | Error Trigger; no polling | 0 | Error Trigger; no polling | 0 |
| **Total fixed scheduled** |  | **5,875** |  | **748** |

Fixed scheduled usage is **748/month**, passing the required ceiling of 900 by 152 executions.

## Normal v1 event-driven planning envelope

This is an operating estimate/capacity envelope, not a new monitoring system and not a promise of
demand. Actual n8n execution use remains traffic-dependent.

| Event-driven category | Monthly allowance |
|---|---:|
| Telegram | 240 |
| Mini App | 90 |
| Lead Intake | 120 |
| Gateway / Session / Submit | 330 |
| Manual owner operations | 120 |
| Errors / retries | 50 |
| **Estimated event-driven total** | **950** |

Projected normal total: **748 + 950 = 1,698 executions/month**. This is 102 below the internal
target, 302 below the 2,000 operational warning level, and leaves **802 executions** of Starter
quota reserve. If the 950 event-driven envelope is exceeded, the internal target is crossed at
1,052 event-driven executions; this is an operational review point only.

## Deployment contract prepared by this PR

- Exact cron rules: X-Ray `0,30 8-19 * * 1-5`; SLA `0 8-20/2 * * 1-5`; Digest
  `30 8 * * 1-5`; Followup `0 10,16 * * 1-5`.
- Explicit timezone: `Europe/Chisinau` on all four scheduled workflows.
- The X-Ray trigger keeps its legacy node name to prevent graph/name drift.
- Before any future write, the guarded deployer inventories every active workflow and refuses to
  continue unless the active scheduled set is exactly these four workflows.
- Candidate guards allow only the named trigger's `parameters` and `settings.timezone` to change.
  Connections, every other node, trigger metadata, credentials, webhooks, static data, unrelated
  settings, and active state must remain identical.
- A future confirmed cutover writes full backups before its first PUT, reads back every workflow,
  restores active/published state if n8n changes it, and transactionally rolls back every attempted
  workflow if any readback fails.
- Error Monitor is verified but never included in the write plan.

n8n's Schedule Trigger follows the workflow timezone when configured and requires the workflow to
be published; those are therefore explicit pre/post conditions here. References:
[Schedule Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger),
[workflow timezone settings](https://docs.n8n.io/build/manage-workflows/configure-workflow-settings).

## Budget decision

| Control | Result |
|---|---:|
| Starter limit | 2,500 |
| Internal target | 1,800 |
| Operational warning level (80%) | 2,000 |
| Old fixed scheduled | 5,875 |
| New fixed scheduled | 748 |
| Estimated event-driven | 950 |
| Estimated normal total | 1,698 |
| Starter safety reserve | 802 |

**FINMENTOR STARTER BUDGET = PASS (pre-deploy).**

Merge and deployment remain explicitly blocked pending review of this report and the PR.
