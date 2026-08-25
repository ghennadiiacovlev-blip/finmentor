# FINMENTOR — Controlled Fix P0: Lead Command Center Authentication

Date: 2026-08-25
Branch: `fix/p0-command-center-auth`
Base production main: `6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010`
Scope: **P0 containment and repair only**

## 1. Confirmed problem

Active n8n workflow `Ukn1cprWiXzBHojl` — `FINMENTOR Lead Command Center PREMIUM FINAL` exposes POST `finmentor-lead-command-center` through a generic Webhook without proven cryptographic Telegram authentication. The workflow trusts Telegram-shaped `message` / `callback_query` `from.id` or `chat.id` supplied in the HTTP body. Authorization succeeds when either identifier matches the allowlist, while reply destination can come from a different caller-controlled chat id.

The independent audit confirmed a P0 read/exfiltration path against canonical Pipeline reads. The configured mutation graph is also reachable, although actual canonical mutation through the current write GID is not proven because the Command Center update locator uses unresolved GID `1997367085` while canonical Pipeline reads/writers use `1883973304`.

## 2. Non-goals

Do not touch during this fix:

- Lead Intake trust-boundary P1;
- GA4/privacy P1;
- Daily Digest P2;
- Mini App / Data Table / PR #10;
- Client Concierge or Transport behavior except if strictly required to establish authenticated Command Center transport;
- website `main` content;
- Google Sheet data except isolated test evidence explicitly approved by owner.

## 3. Immediate containment policy

Before any mutation testing, the unsafe public Command Center path must no longer be callable without a verified Telegram-origin trust boundary.

Preferred zero-trust design:

1. Replace the generic public Telegram-shaped body trust with an authenticated boundary.
2. Prefer a real Telegram Trigger using the existing internal Leads Bot credential, or another server-verifiable Telegram origin path.
3. If a generic Webhook must remain, require a strong server-held secret/header that Telegram/n8n infrastructure can actually validate before any parsing, read or write. A caller-supplied Telegram ID is never authentication.
4. Bind authenticated sender identity and reply destination to the same verified Telegram update. Never authorize on `from.id` while replying to an unrelated caller-controlled `chat.id`.
5. Authorization must fail closed before any Pipeline read, Sheets read, write, or Telegram reply containing CRM data.

## 4. Safe execution sequence

### Gate A — snapshot

Read-only capture before changes:

- workflow id/name/active/version/updatedAt;
- trigger type/path;
- nodes/connections/settings;
- credential reference names/ids only, no secrets;
- exact current authorization parser and allowlist source;
- all Pipeline read/write GIDs;
- retained execution metadata only as needed for rollback evidence.

Create a redacted workflow export or canonical structural manifest in this branch. Do not commit credential values or production payloads.

### Gate B — contain

If the workflow cannot be patched atomically with a proven authenticated entry path, deactivate only `Ukn1cprWiXzBHojl` until the secured replacement is ready.

Do not deactivate Lead Intake, Concierge, Transport, SLA, Followup or Digest as part of this P0 scope.

### Gate C — secured candidate

Build a separate inactive candidate/clone first where possible.

Required controls:

- authenticated Telegram-origin boundary before CRM access;
- sender identity derived only from authenticated server-side source;
- reply chat derived from the same validated Telegram update;
- exact owner/manager allowlist check after authentication;
- no fallback hardcoded ID that bypasses Settings policy;
- unauthorized path returns no CRM data and performs zero CRM writes;
- malformed/unknown commands perform zero CRM writes;
- no raw update/PII retention beyond existing approved policy;
- rate/error controls appropriate to the chosen entry path;
- no second active Telegram Trigger on the same bot token during cutover.

### Gate D — resolve Pipeline write locator

Before enabling mutations, resolve Command Center `Update Pipeline Row` GID `1997367085` against the actual spreadsheet metadata.

Canonical expected Pipeline GID: `1883973304`.

Do not assume the alternate GID is valid or corrupt. Obtain read-only Google Sheet metadata or isolated evidence. If confirmed stale/wrong, point the candidate to canonical `1883973304` and document the evidence.

### Gate E — negative tests first

Use isolated/synthetic QA identities only. Do not use production lead rows for destructive testing.

Mandatory negative cases:

- no authentication proof -> denied before CRM read;
- forged allowed `from.id` in body -> denied;
- forged allowed `chat.id` in body -> denied;
- allowed `from.id` + attacker-controlled other chat -> denied/no exfiltration;
- malformed callback/message -> denied/no read/write;
- unknown command -> no write;
- unauthorized sender -> no CRM data in Telegram response;
- direct HTTP call to old generic path -> disabled/denied.

### Gate F — positive read-only canary

With a genuinely authenticated owner update:

- `/pipeline` or equivalent aggregate read succeeds;
- response returns only to authenticated owner chat;
- no mutation occurs;
- no duplicate Telegram trigger/token collision;
- no unexpected Sheets write.

### Gate G — isolated mutation canary

Only after GID resolution and negative/read-only PASS:

- use a dedicated QA/test lead row, never a live customer row;
- perform one reversible non-destructive mutation;
- verify exact canonical target row and expected Status_Log/Activities behavior;
- read back and restore/clean test data if cleanup is part of the approved QA design;
- capture evidence without PII.

### Gate H — cutover

- ensure old unsafe public path is inactive/disabled;
- activate only the secured Command Center implementation;
- ensure exactly one intended management entry path is active;
- verify normal production workflows remain unchanged;
- record workflow id/version/updatedAt and structural hash/export in this branch.

## 5. Acceptance criteria

P0 can be closed only if all are true:

- no caller-controlled Telegram-shaped body can authorize Command Center access;
- authenticated sender and reply destination are cryptographically/server-verified and bound together;
- unauthorized requests cannot read Pipeline or receive PII;
- unauthorized requests cannot mutate CRM;
- old public spoofable route is inactive or strongly authenticated before parsing;
- Pipeline update target is resolved and canonical;
- negative matrix PASS;
- authenticated read-only canary PASS;
- isolated mutation canary PASS;
- no second active Telegram Trigger/token collision;
- no credential secret is stored in GitHub;
- production change log and rollback point captured;
- independent post-fix verification confirms P0 CLOSED.

## 6. Rollback

Maintain the pre-change workflow/version snapshot. If any authentication, Telegram delivery, GID, or read/write verification fails:

- stop the candidate;
- keep the unsafe public Command Center disabled rather than reverting to unauthenticated exposure;
- restore only a previously safe authenticated version if one is proven;
- leave all unrelated production workflows untouched.

## 7. Required final report

Return:

- PRE-CHANGE WORKFLOW ID / VERSION / ACTIVE;
- CONTAINMENT ACTION;
- AUTHENTICATION DESIGN;
- PIPELINE READ GID;
- PIPELINE WRITE GID BEFORE / AFTER;
- NEGATIVE TESTS;
- AUTHENTICATED READ CANARY;
- ISOLATED MUTATION CANARY;
- OLD PUBLIC PATH STATUS;
- ACTIVE TELEGRAM TRIGGERS FOR INTERNAL BOT;
- PRODUCTION WORKFLOWS CHANGED;
- ROLLBACK POINT;
- P0 STATUS: CLOSED / BLOCKED;
- REMAINING RISKS.

Do not start P1/P2 work until P0 is independently closed.