# C3 final closure - production deployment record

**Date:** 2026-09-15

**Cutover:** 10:29:43Z-10:29:45Z

**Status:** **PASS - deployed**

## Outcome

C3 closes the remaining authenticated-new-lead owner-intelligence and Telegram callback-integrity
work without changing scoring, CRM schemas, privacy authority, customer notification, Mini App
source, webhook paths, credentials, or scheduled frequency.

An authenticated `NEW` lead now resumes the canonical post-intake path only after the existing
one-row commit verdict succeeds. After the existing Leads-source write, Lead Intake dispatches one
closed internal envelope to X-Ray and waits for the result. Public submissions, replays, refusals,
ambiguous commits, and already-analysed leads cannot enter or repeat this route.

X-Ray accepts that envelope only from the exact Lead Intake workflow and selects only the exact
eligible, previously unanalysed Lead ID. The ordinary scheduled sweep remains on its existing
path. The resulting single owner alert now carries Lead ID, qualification and financial zone,
priority reason, key problem, FINMENTOR interpretation, maturity, up to two risks, one verification
need, economic impact, at most three discovery questions, contact, and the immediate owner action.
Visible values are HTML-escaped and the alert excludes workflow states, review tokens, raw JSON,
and deferred intelligence sections.

For Telegram callbacks, Command Center now validates the basic private-human envelope and sends one
neutral `Принято` protocol acknowledgement before owner identity and Settings reads. The original
Telegram update is then restored byte-for-byte for the existing full authorisation and mutation
path. The acknowledgement makes no claim that a business action succeeded.

The authenticated path suppresses the three legacy short alerts and the old AI-plan alert, so one
new committed lead has one owner-intelligence notification authority. Public alert behaviour stays
unchanged. The public homepage also uses the approved visible label `Проблема:` in the six industry
cards while leaving internal field names, scoring attributes, callbacks, and routes unchanged.

## Production scope

Three active production authorities were fresh-read against accepted C2 commit `1078d96`. The
guarded deployer accepted only the declared C3 node and connection delta:

| Workflow | ID | Nodes | C3 result |
|---|---|---:|---|
| Owner Command Center | `qF9tonlHHIxc8MDd` | 33 -> 36 | early neutral callback ACK; deployed and read back |
| X-Ray owner intelligence | `tNSMRoKlFB52vjge` | 66 -> 68 | exact internal target path and richer owner alert; deployed and read back |
| Lead Intake | `QmIyEW2ZEqKregmN` | 109 -> 111 | authenticated post-commit dispatch and duplicate suppression; deployed and read back |

Every write was immediately read back, followed by a second fresh read of all three workflows.
All active flags remained true. Credential, webhook, schedule, and workflow-setting authority was
unchanged. Rollback was armed but not invoked.

No public trigger or schedule was added. The fixed Starter forecast remains **1,720 executions per
month**. C3 adds one internal X-Ray execution per authenticated newly committed lead, consuming the
existing **780-execution reserve** only in proportion to real new-lead volume.

## Controlled production UAT

Production X-Ray intentionally stores neither successful nor failed execution data. To preserve
that retention policy while obtaining node-level proof, the UAT:

1. fresh-read production X-Ray and verified its normalized SHA-256 as the exact deployed candidate;
2. created a live-derived clone with only the unrelated schedule and review-webhook triggers
   removed, and enabled execution retention on that temporary clone;
3. invoked its unchanged C3 target path with a random nonexistent synthetic Lead ID;
4. read the retained execution data; and
5. removed both the disposable caller and clone in `finally`.

Execution `8178` reached the internal trigger, exact source/identity validator, live Settings,
`XRay_Analysis`, Pipeline, and `Select Pending Leads`. The exact synthetic target selected zero
rows. `Build Analysis Input`, the AI analyst, the analysis ledger writer, the Pipeline writer, and
the Telegram owner transport did not execute. Caller execution `8177` succeeded.

Result: **30/30 checks passed, zero data writes, zero owner messages, zero client messages, and zero
temporary C3 workflows remaining.**

The ignored, non-sensitive evidence summary is:

`.uat/c3-final-closure/controlled-noop-verified-2026-09-15T10-41-52-883Z.json`

## Verification

- Focused C3 gate: **30/30 assertions**.
- Repository suite: **93/93 gates, 3,474 assertions**; assertion floors pass.
- C3 was added to the global runner and its per-gate assertion floor.
- Legacy X-Ray gate: **219/219 assertions**.
- Legacy Lead Intake alert-routing gate: **13/13 assertions**.
- C2 closure regression gate: **28/28 assertions**.
- A5 duplicate AI-brief suppression gate: **9/9 assertions**.
- Guarded read-only production dry run: **PASS**, exactly three eligible workflows and zero writes.
- Fresh post-cutover hash reconciliation: **PASS** for all three workflows; all active.
- Controlled targeted no-op UAT: **30/30 checks**, no business side effect.
- `git diff --check`: **PASS**.

## Evidence and rollback

The pure patchers are in `scripts/lib/c3-final-closure.mjs`; the guarded cutover is
`scripts/deploy-c3-final-closure.mjs`; the no-op UAT is `scripts/c3-controlled-uat.mjs`.

Redacted dry-run evidence is stored under:

`.uat/c3-final-closure/dry-run-2026-09-15T10-29-21-590Z`

Redacted pre-cutover, candidate, post-cutover, and result evidence is stored under:

`.uat/c3-final-closure/deploy-2026-09-15T10-29-43-535Z`

Fresh hash/active-state reconciliation is stored in:

`.uat/c3-final-closure/production-verified-2026-09-15T10-31-42-155Z.json`

Manual rollback uses the three `*.fresh-pre.json` files in the deployment directory, in reverse
write order: Lead Intake, X-Ray, then Command Center. Each restored workflow must be fresh-read and
its original active flag confirmed. The deployer performs that same reverse-order rollback
automatically if any write or read-back fails.

`FINMENTOR_GATE6_FINAL` remained outside the artifact allowlist and was not modified or staged.
