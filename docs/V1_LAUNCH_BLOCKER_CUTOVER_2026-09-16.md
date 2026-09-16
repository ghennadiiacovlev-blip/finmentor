# FINMENTOR V1 launch-blocker cutover — 2026-09-16

## Outcome

The six-workflow production cutover completed successfully on 2026-09-16 at 04:36 UTC. Every workflow was active before the change, matched its accepted fresh-live SHA-256 baseline, accepted only its bounded node delta, and passed immediate plus final API read-back verification. No rollback was required.

## Closed blockers

- Telegram `/start`, including deep-link forms such as `/start ro`, now establishes a clean current cycle while preserving the historical lead reference and durable client facts.
- Public and internal committed leads use the single X-Ray owner-intelligence path; legacy duplicate alerts remain suppressed.
- The owner X-Ray alert exposes the approved brief, Discovery, review, and contact actions with the four-row HTML transport layout.
- `/brief` and its callback render the compact pre-call brief through the owner Command Center.
- X-Ray failures project to Pipeline, retry in place with bounded attempts, redact secret-like values, and emit one terminal system alert after exhaustion.
- An ineligible targeted X-Ray request cannot consume unrelated scheduled backlog.

## Production workflows

| Workflow | ID | Pre-deploy SHA-256 | Candidate SHA-256 |
|---|---|---|---|
| System Alert | `ID700kTo6EXffwry` | `c1901d7dd0923445e1c958911425d9e87653991bf28ac647f14835f9e9f7222f` | `387c65c74cd47742fb6f3ad24fce7e408d31f1012abab48cb92e66026cc30004` |
| Telegram Transport | `ShcmmJeLSE8LYVBk` | `23ca28e6db14e0c891f6b9b3e6feac3f357eacede4434ca077dac02514e878ae` | `2870e9365821c2a36af313a99314e8e0c424595074d00823df4c8fb0385daa28` |
| Owner Command Center | `qF9tonlHHIxc8MDd` | `82f070e49fbc4572e6333a716e0b0336e804e4810887bc78e9d986386b6ed266` | `0d18ee7148ebd3eac0af643a425ceda1140f60c65788df7d71c81ec247abf168` |
| X-Ray / Owner Intelligence | `tNSMRoKlFB52vjge` | `75f4d64117955b35291a7979b9f6d14797e7a6dc207d3da27494690c6b4fb2a3` | `91e661f80bc8e08687755af77aa2231aee2dd0f68ec9f7e27b15f81827058302` |
| Lead Intake | `QmIyEW2ZEqKregmN` | `0e4f9bd84781f4b8101d30e72df1b8748116ea6d04002f836c232dc631ba2bf2` | `a20b2ee36d2fb0f873432d805e1f25517e1f021c36d9a61c04d2758c9d7572d0` |
| Client Concierge | `mppzthlkSJFr6Kle` | `27cbc0e91758de86a9fe25665dade78e48e1e3197f9c3c6fe04439b898e41aa7` | `93a0df6a554a4dfb7ae3b7ad180fc25e572c4847a6b329c6f4ffd83966334a14` |

## Verification

- Full repository QA: `94/94` gates, `3494` assertions, assertion floors PASS.
- Dedicated launch-blocker gate: `19/19` assertions.
- `git diff --check`: PASS.
- Deployment mode: dependency-first, fresh backups, exact baseline guard, protected authority checks, immediate read-back, final fresh read-back, automatic rollback on mismatch.
- Result: `DEPLOYED`; six bounded writes; zero unrelated credential, schedule, webhook, settings, or static-data changes.

Redacted local evidence is stored in `.uat/v1-launch-blocker/deploy-2026-09-16T04-36-34-158Z/` and is intentionally not committed.
