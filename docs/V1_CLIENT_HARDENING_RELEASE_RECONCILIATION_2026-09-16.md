# FINMENTOR V1 client-hardening release reconciliation — 2026-09-16

## Outcome

The already-live client-hardening cutover was reconciled to the repository on 2026-09-16 at
05:58 UTC. This closure step performed read-only production verification and did not redeploy any
workflow. All five active production workflows matched their post-build deployment candidates
exactly at the importable-workflow boundary (`name`, `nodes`, `connections`, `settings`).

This record closes repository/production reconciliation only. The V1 freeze remains conditional
on the two separately recorded signed owner UAT journeys (RO and RU).

## Production/repository chain of custody

The tracked candidates were regenerated from the repository immediately before reconciliation.
All five outputs were byte-identical to the files already present in `n8n/candidate/`.

| Tracked build output | SHA-256 |
|---|---|
| `miniapp-gateway-candidate.json` | `d07a1d2f249e289c6bd5d14f1433246cc9f9f08bf91a14699491c53dcc11d307` |
| `premium-concierge-candidate.json` | `1655551263b061863ee3c192167fa65891b131123cb6c7dce9a57e64099eed9a` |
| `premium-miniapp-host-candidate.json` | `6a5270812e603751cf146ba70f0a8d53ae0314e68efd2ee2549e58dbcd3fb0e5` |
| `premium-session-endpoint-candidate.json` | `96b5ae7f959018d807331d6eadaf677fe5b5bc30dfb2235573ac8c90d0ba37e2` |
| `premium-submit-endpoint-candidate.json` | `9cd95f548e905ca6a59851332543f39f21912661bdee403d2879e8175bd95585` |

Deployment projection is deliberately a merge boundary: live-only system-alert callers, webhook
identity, credentials, endpoint URLs, workflow names, and settings are preserved by the bounded
deploy tools. A fresh API read was hashed against the corresponding generated deployment
projection after those resolutions. Every pair matched exactly and every workflow was active.

| Production workflow | ID | Fresh live SHA-256 | Deployment candidate SHA-256 | Result |
|---|---|---|---|---|
| Client Concierge | `mppzthlkSJFr6Kle` | `f4263568c00764202e86863dd60355d539c3829fc3422041b6c86bc3c5d1d5c0` | `f4263568c00764202e86863dd60355d539c3829fc3422041b6c86bc3c5d1d5c0` | MATCH, active |
| Mini App Gateway | `nTZHLbv2KFggdhh5` | `5437d06a3ec40ec1099076fe6d32f79bd3bc9877809140306ac4db57d5d2ec0d` | `5437d06a3ec40ec1099076fe6d32f79bd3bc9877809140306ac4db57d5d2ec0d` | MATCH, active |
| Mini App Session | `Hxje3Kel6nLLod5B` | `1adca053e7bc6539c1062328d0b476548b0f5db6190edeeae03153a9c389af1c` | `1adca053e7bc6539c1062328d0b476548b0f5db6190edeeae03153a9c389af1c` | MATCH, active |
| Mini App Submit | `ELiPdw4mdxQbBaan` | `b2403f7929b6e75c3c2aaf178420953e2c5142c25e5d6499719889bb13704b05` | `b2403f7929b6e75c3c2aaf178420953e2c5142c25e5d6499719889bb13704b05` | MATCH, active |
| Mini App Host | `KBD7Q94QQnlzgYKJ` | `162bd14b1de566e59420af034a1a82763a28e1f0ec05d5b45fd5a0579b491ee3` | `162bd14b1de566e59420af034a1a82763a28e1f0ec05d5b45fd5a0579b491ee3` | MATCH, active |

The final post-deploy dry-runs independently reported:

- Concierge: `changed: (already current)` and identical before/after SHA-256.
- Gateway: no added or rewritten nodes.
- Session endpoint: no added, removed, or rewritten nodes.
- Submit endpoint: no added, removed, or rewritten nodes.
- Mini App host: identical live/candidate page SHA-256.

No production write was issued during release reconciliation.

## Scope committed by the release

- Mini App render-boundary localisation, server-locale authority after hydration, and viewport
  continuity between question transitions.
- Explicit first-contact RO/RU choice, persisted only after a customer selection, on both live
  Concierge branches.
- Locale projection from Concierge to the Gateway and client-safe mapping of internal committed
  acknowledgement states.
- Durable customer acknowledgement claim/send/finalise handling after the lead commit, including
  ambiguity-safe replay without duplicate Telegram sends or duplicate Lead Intake calls.
- Generated workflow candidates, bounded deploy tooling, live verification updates, and executed
  regression coverage for the above behavior.

No new feature, UX surface, workflow architecture, credential, webhook route, schedule, or data
schema is part of this release-closure commit.

## Verification

- Full offline QA: `95/95` gates, `3,504` assertions, assertion floors PASS.
- Dedicated client-hardening cutover gate: `7/7` assertions.
- Live refused-path and deployed-topology verification: `167/167` PASS; the script wrote nothing.
- Candidate regeneration: five of five outputs byte-identical.
- Fresh live/importable-candidate hashes: five of five MATCH; five of five active.
- `git diff --check`: PASS.
- `FINMENTOR_GATE6_FINAL/`: preserved, untracked, and untouched.

## Rollback evidence

Pre-write and post-write reconciliation artifacts remain under `.uat/` and are intentionally not
committed. The bounded deploy scripts print the exact rollback path and API target for each
workflow. No rollback was required.

## Repository identity

The release repository SHA is the commit containing this record. Its immutable SHA is reported by
the release-closure report after the push and GitHub checks complete.
