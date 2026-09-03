# C3 — owner runbook: the five live deploys, in order, and what proves each one

**Date:** 2026-09-03 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Program:** Production Completion v1

Every artefact below is built, gated (68/68 offline gates) and **dry-run against the live tenant**
with the rollback artefact written. Nothing below has been written to production: in the Claude
Code session the permission classifier refuses the `--confirm` invocations, and the n8n MCP
connector cannot see the production workflows. Each command is one line the owner types in the
session prompt (the `!` prefix runs it locally, with the session's `N8N_*` environment).

## 0. Preconditions (already true, verified live 2026-09-03)

- `MiniApp_Cycle_Projection` carries `authority_key` and `cycle_sequence` (added 2026-09-03 via the connector).
- `XRay_Client_Results` exists with `analysis_id, lead_id, locale, published_at, result_json, review_status, score, zone`.
- The branch is pushed; `git status` is clean; `node qa/run-all.mjs` is green.

## 1. Concierge — per-cycle projection authority (upgrade in place)

```
! node scripts/deploy-c3-concierge-cycle.mjs --dry-run
! node scripts/deploy-c3-concierge-cycle.mjs --confirm
```

Expected: `UPGRADE: Project Cycle re-keyed by authority_key, Cycle Projection Guard rewritten,
Prepare Cycle Projection inserted, nothing else`, then `Build Session Row -> Prepare Cycle Projection
-> Project Cycle -> Cycle Projection Guard -> Save Bot Session`, `Concierge active`.

Live proof (owner, 1 minute): send any message to the client bot, then check the Data Table
`MiniApp_Cycle_Projection`: one row with `authority_key = <your id>|C-<your id>-<ms>` and
`cycle_sequence = <ms>`. Then confirm «Начать заново» → a SECOND row for the new cycle; the old
row is untouched.

Rollback: `PUT /api/v1/workflows/mppzthlkSJFr6Kle` with `.uat/mppzthlkSJFr6Kle.pre-c3-cycle.json`.

## 2. Gateway — server-side cycle, fail-closed stores, proven persistence, customer result read

```
! node scripts/deploy-c3-gateway-cycle.mjs --dry-run
! node scripts/deploy-c3-gateway-cycle.mjs --confirm
```

Expected: 11 nodes added, `Build App Session, Resolve Session, Finalise Session` rewritten,
`Session Store Verdict + Respond Session Unavailable` retired, 32 nodes, one credential (G5).

Live proof: open the Mini App from the bot AFTER step 1 wrote a projection → the form opens
(200). Open it BEFORE any bot turn from a fresh Telegram account → `409 CYCLE_UNRESOLVED` and the
Mini App says «Откройте форму из чата». Sessions minted before this deploy carry `cycle_id ''`
and are unreachable; they were owner-only and expire with their TTL.

Rollback: `.uat/nTZHLbv2KFggdhh5.pre-c3-cycle.json`.

## 3. Session + Submit endpoints — outages, proven Save Draft / Mark Submitted, release gate

```
! node scripts/deploy-c3-endpoints.mjs --dry-run
! node scripts/deploy-c3-endpoints.mjs --confirm
```

Expected: session 14 → 17 nodes, submit 28 → 32 nodes, `RELEASE: OWNER_ONLY`, the SYSTEM ALERT
callers preserved (submit's `Alert Route (Submit)` learns the two persistence verdicts).

Live proof: fill one screen in the Mini App and reload → the answer is back (Save Draft was
proven by its read-back). Submit → «Принято»; reopen → the committed screen with the pending
note. The endpoints still answer `403 NOT_AUTHORISED` to anyone but the owner.

Rollback: `.uat/Hxje3Kel6nLLod5B.pre-c3-endpoints.json`, `.uat/ELiPdw4mdxQbBaan.pre-c3-endpoints.json`.

## 4. X-Ray Analysis v2 — fail-closed validation, read-only GET + POST review, customer result publisher

```
! node scripts/deploy-c3-xray.mjs --dry-run
! node scripts/deploy-c3-xray.mjs --confirm
```

Expected: 29 → 37 nodes; `Review Webhook, Read Analysis For Review, Review Verdict` replaced by the
GET/POST pair; `19 live nodes are reproduced byte-for-byte by the offline compiler`.

Live proof: open the review link from any existing owner alert → the page now shows the draft and
a «Подтвердить и открыть клиенту» button (nothing is promoted by opening it). Rows analysed before
v2 carry 32-hex tokens with no expiry and are refused; delete their `XRay_Analysis` row to
re-analyse under v2. After a confirmation: `XRay_Client_Results` gains one row for the lead, and
the customer's Mini App (reopened after submission) shows the result screen.

Rollback: `.uat/tNSMRoKlFB52vjge.pre-c3-xray.json`.

## 5. Mini App host — result screen, cycle/outage copy

The host page is the tracked candidate `n8n/candidate/premium-miniapp-host-candidate.json`. The
deploy replaces `Serve Page.responseBody` and nothing else, with the three endpoint URLs read back
from the page that is live (never typed, never written into the repo):

```
! node scripts/deploy-c3-miniapp-host.mjs --dry-run
! node scripts/deploy-c3-miniapp-host.mjs --confirm
```

Expected: `live page sha … -> candidate page sha …`, `fresh read: the live page is the candidate page`.

Live proof: reopen the Mini App on a submitted brief → the committed screen now carries
«Результат анализа появится здесь после проверки консультантом FINMENTOR.»; after step 4's
confirmation on that lead, the same reopen shows the result screen.

## 6. Customer release — ONE explicit substitution, only after 1–5 are proven

```
! node scripts/deploy-c3-endpoints.mjs --confirm --release=CUSTOMER
```

This is the only command that opens the Session and Submit endpoints to non-owners. Do not run it
before the privacy wording is approved (see `docs/C4_PRIVACY_RELEASE_GATE.md`) and the C2 owner
acceptance sequence has been performed.

## What stays owner-only after the five deploys

| item | why it is not automatable from the session |
|---|---|
| C2 acceptance: `meeting`, `proposal`, `stage … Negotiation`, `won … 0` on `FIN-1788432350648-72`, and `lost FIN-1788432493303-321 uat` | Telegram messages from the owner's chat to the Leads bot |
| privacy wording approval (RU + RO) | owner decision |
| RO questionnaire copy for the Mini App and the Concierge | the content gate binds every client-visible string to an approved spec; RO copy needs the same approval before it can be gated |
| GA4 C4 UAT | needs the public site and the owner's browser |

## Live proof record — steps 1 and 2 (2026-09-03, fresh-read)

| time (UTC) | evidence |
|---|---|
| 17:24:47 | Gateway deployed: 32 nodes, active, one credential, retired nodes absent |
| 17:38:03 | Concierge upgraded: 58 nodes, `verifyUpgraded(rollback, live)` clean, Prepare/Guard byte-identical to source |
| 17:39:09, 17:39:19 | Concierge executions 5279, 5281 (owner bot turn) → `MiniApp_Cycle_Projection` row 1: `authority_key = <owner>|C-<owner>-1787947744615`, `cycle_sequence = 1787947744615` |
| 17:39:25 | Gateway minted `MiniApp_App_Sessions` row 2 with `cycle_id = C-<owner>-1787947744615` — the resolved cycle, never `''`. (The Gateway retains no executions by design; the row is the evidence; zero error executions.) |
| 17:40:11–14 | Lead Intake 5296 success; session row 2 → `submitted`, `lead_id` = the canonical lead of that cycle (committed replay, same submission key) |
| 17:45:15, 17:45:32 | Concierge executions 5298, 5300 (confirmation turn) → the projection row was upserted in place (same id, `cycle_reset ''`, no rotation) |
| — | Error Monitor and SYSTEM ALERT: no execution since 08-31. Legacy session row 1 (`cycle_id ''`, expired 09-02) is unreachable. |

Not yet exercised live: an explicit ROTATION («Начать новый вопрос» → a second projection row with a higher sequence → the Mini App resolves the new cycle and the old draft cannot win). Step 3 (endpoints) not deployed at the owner's request.

## Fresh-read 2026-09-03 ~18:05 UTC — nothing moved, rotation still owner-only

| check | result |
|---|---|
| Concierge `mppzthlkSJFr6Kle` | 58 nodes, active, unchanged since 17:38:03 |
| Gateway `nTZHLbv2KFggdhh5` | 32 nodes, active, unchanged since 17:24:47; still no executions (by design) |
| Session / Submit / X-Ray / host | 14 / 28 / 29 / 2 nodes — pre-C3, untouched (steps 3–5 not run) |
| `deploy-c3-endpoints`, `deploy-c3-xray`, `deploy-c3-miniapp-host` `--dry-run` | all PASS against live, same node deltas as recorded above, rollback artefacts intact |
| `node qa/run-all.mjs` | 68/68, 2493 assertions, floors PASS |
| Concierge 5313 (17:56:04, callback `p\|describe`) and 5315 (17:56:26, free text) | both ran `Prepare Cycle Projection -> Project Cycle -> Cycle Projection Guard`, `projection_invalid 0`; `MiniApp_Cycle_Projection` still ONE row (id 1), upserted in place, `cycle_sequence 1787947744615` |
| `MiniApp_App_Sessions` | 2 rows, unchanged since 17:40:14 |

Neither 17:56 turn was a reset, so no rotation was expected and none happened — the same
authority_key was re-projected in place, which is exactly the P0 guard's contract.

**How to exercise the rotation on the CURRENT bot session.** The Concierge rotates a cycle only on
`/start`, or on «Начать заново» (`m|diag`) when the session already carries a consent decision, a
lead, or an ended status. The owner's live bot session right now has `consent ''`, `lead_id ''`,
`status active` (state `TG_CONFIRM_CONTEXT`), so pressing «Начать заново» would be read as
"continue", not "restart". To produce the second projection row, send `/start` to the client bot.
Expected: `MiniApp_Cycle_Projection` gains row 2 with `cycle_reset 'start'`, a NEW
`authority_key = 551662084|C-551662084-<new ms>` and `cycle_sequence` > `1787947744615`; row 1 is
untouched. Then open the Mini App from the bot: the Gateway must mint a session whose `cycle_id` is
the NEW cycle, and the submitted draft of `AS-09f4c25b…` (old cycle) must not be offered.
