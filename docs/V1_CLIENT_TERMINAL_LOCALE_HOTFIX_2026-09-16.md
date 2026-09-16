# FINMENTOR V1 client terminal-locale hotfix — 2026-09-16

## Outcome

The Client Concierge terminal-locale hotfix was deployed on 2026-09-16 at 06:59 UTC. Romanian
customers now remain on Romanian presentation after a successful or failed Intake handoff and on
the controlled recovery screen. Russian presentation and the existing transport, persistence,
callback, webhook, credential, and workflow-topology contracts are unchanged.

## Bounded production delta

Only the `parameters.jsCode` bodies of these two existing nodes were added to the already-approved
five-node client-hardening allowlist:

- `Build Intake Transport Request`
- `Build Recovery Request`

The renderers take locale from the current-cycle response/session authority. They deliberately do
not re-detect locale from Telegram metadata. The terminal copy covers meeting and generic Intake
success, explicit Intake failure, and controlled recovery in both RO and RU.

No node was added, removed, renamed, retyped, or rewired. Workflow settings, credentials, webhook
identity, activation, business decisions, Intake acceptance, session writes, and callback data are
preserved.

## Production verification

- Workflow: Client Concierge (`mppzthlkSJFr6Kle`).
- Final importable-workflow SHA-256: `c659bfd492780850fb98591128451d25654484ce265d344cc71fd1c30d1bd4a2`.
- A fresh read-only deployment preflight at 09:43 UTC reported `changed: (already current)` and an
  identical before/after SHA-256.
- Fresh rollback and candidate artifacts remain under `.uat/v1-client-hardening/` and are
  intentionally not committed.
- No rollback was required.

## Verification

- Full repository QA: `95/95` gates, `3,507` assertions, assertion floors PASS.
- Dedicated client-hardening gate: `10/10` assertions.
- Generated Premium Concierge candidate: `43/43` assertions.
- C1 live-derived closure gate: `35/35` assertions.
- `git diff --check`: PASS.
- `FINMENTOR_GATE6_FINAL/`: preserved, untracked, and untouched.
