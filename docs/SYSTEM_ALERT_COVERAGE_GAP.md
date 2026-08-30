# SYSTEM ALERT COVERAGE GAP

**Recorded 2026-08-30. Not fixed in this pass, by instruction — the binding fix does not wire
`errorWorkflow`.**

```
SYSTEM ALERT COVERAGE GAP: business-terminal 5xx / SUBMIT_UNRESOLVED
can be invisible to n8n errorTrigger.
```

## What happened

The owner's first real submit failed at 14:42 on 2026-08-30 and stayed failed. **No SYSTEM ALERT
was sent, and no n8n execution record existed.** The failure was recovered four hours later only
because Supabase keeps its own Postgres logs, which still held the two `there is no parameter $1`
lines. Had the database not logged it, the failure would have been unattributable.

## Why the alert did not fire

Three independent properties combine, and each one alone is defensible:

**1. The endpoints swallow node failures on purpose.** Every side-effecting node in the submit
graph carries `onError: 'continueRegularOutput'` — four of them today. That is deliberate and it is
the fix for the P9-R2 hazard: `alwaysOutputData: true` paired with `continueErrorOutput` fires BOTH
outputs on failure, which once let a workflow reach a write on an outage. `continueRegularOutput`
converts a node failure into an ordinary item so the graph can classify it and answer honestly.

The cost is that **nothing throws**. From n8n's point of view the execution succeeded.

**2. A business-terminal 5xx is a normal path, not an error path.** `Respond Submit Unresolved`
answers `503 SUBMIT_UNRESOLVED retryable:true` from the false branch of `IF Privacy Recorded`. It is
a `respondToWebhook` node on a healthy edge of the graph. There is no failed node anywhere.

**3. `errorTrigger` only fires on a failed execution.** No throw, no failed execution, no trigger.

Measured on the live tenant:

| workflow         | `errorWorkflow` | `saveDataErrorExecution` | `saveDataSuccessExecution` | nodes that swallow failure |
|------------------|-----------------|--------------------------|----------------------------|----------------------------|
| submit endpoint  | `null`          | `none`                   | `none`                     | 4                          |
| Gateway          | `null`          | `null` → `none`          | `none`                     | 2                          |
| session endpoint | `null`          | `none`                   | `none`                     | 2                          |

Retention is off by design — the Gateway must never persist raw `initData`, and the submit endpoint
must never persist a brief. That is correct and must not be reversed. But it means the **only**
surviving evidence of a terminal failure is whatever the downstream system happened to log.

## What this is not

This is not the two-layer alerting design being broken. `SYSTEM ALERT` and `SYSTEM RECOVERED`
work for the workflows that actually throw. The gap is specific: **a fail-closed business refusal
that the graph handles correctly is, by construction, indistinguishable from success to n8n.**

## What would close it

Not proposed for implementation here — recorded so the decision is made deliberately.

1. **Emit the alert from the graph, not from the trigger.** The terminal 5xx responders are the
   only places that know a submission died. A fire-and-forget call to the alert workflow on those
   edges would report the truth without relying on n8n's error machinery. It must not block the
   response and must not carry client data — the error code, the workflow, and a submission-key
   prefix are enough.
2. **Wire `errorWorkflow`** on all three endpoints anyway, to catch the failures that DO throw
   (credential expiry, a malformed graph after a bad deploy). It is necessary but not sufficient:
   it would not have caught this one.
3. **Do not turn retention on** to solve this. It would put raw `initData` and full briefs into the
   execution store, which is the thing the retention setting exists to prevent.

Option 1 is the one that would have alerted on 2026-08-30. Options 1 and 2 are complementary, not
alternatives.

## Related

- `docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md` — the other open customer-production item.
- `docs/RU_UAT_MINIAPP_BOOTSTRAP_AND_IDEMPOTENCY.md` — where the P9-R2 reasoning is recorded.
