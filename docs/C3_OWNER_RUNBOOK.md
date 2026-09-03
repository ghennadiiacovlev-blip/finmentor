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

## 1b. Concierge — adopt the Mini App commit (C3.2) — DEPLOY BEFORE ANYTHING ELSE

**Why (live defect, 2026-09-03 evening, see `docs/C3_LIVE_DEFECT_CYCLE_COMMIT_ADOPTION.md`):** a brief
submitted through the Mini App commits the cycle in `MiniApp_App_Sessions` only; Bot_Sessions never
learns it, so the bot never renders `TG_SUBMITTED`, «Начать новый вопрос» never appears, and the only
rotation (`p|new_y`) is unreachable. «Открыть бриф» then (correctly) reopens the submitted cycle.

```
! node scripts/deploy-c3-concierge-commit.mjs --dry-run
! node scripts/deploy-c3-concierge-commit.mjs --confirm
```

Expected: `58 -> 60 nodes`, `Premium Owner Gate -> Read Cycle Commit -> Adopt Cycle Commit -> Get Bot
Session (Premium)`, legacy branch unchanged, credentials unchanged, `Adopt Cycle Commit byte-identical
to source`, `Concierge active`.

Live proof (owner, ONE sequence in the client bot): send `/start` → the bot answers «Последнее обращение
уже передано FINMENTOR.» with «Добавить к обращению» | «Начать новый вопрос». Tap «Начать новый вопрос»,
then on «Начать новый вопрос?» tap «Начать новый вопрос» again → «FINMENTOR / Подготовка к первой
встрече». Tap «Подготовить бриф» → «Открыть бриф». The session then fresh-reads the seven rotation facts.

Rollback: `PUT /api/v1/workflows/mppzthlkSJFr6Kle` with `.uat/mppzthlkSJFr6Kle.pre-c3-commit.json`.

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

## Live proof record — step 1b, C3.2 Concierge commit adoption (2026-09-03, fresh-read)

| time (UTC) | evidence |
|---|---|
| 18:42:37 | `deploy-c3-concierge-commit.mjs --confirm` (owner): Concierge `mppzthlkSJFr6Kle` 58 -> 60 nodes, active, versionId `3fc2c42a-74ff-4ad3-935b-864ec82ec9b1` |
| 18:42:37 | fresh-read by a separate process: `Premium Owner Gate -> Read Cycle Commit -> Adopt Cycle Commit -> Get Bot Session (Premium)`; legacy branch still `Get Bot Session`; `Read Cycle Commit` = dataTable 1.1 on `MiniApp_App_Sessions`, alwaysOutputData + continueRegularOutput, no credential; `Adopt Cycle Commit` byte-identical to source; credentials and error-monitor binding unchanged |
| before | rollback `.uat/mppzthlkSJFr6Kle.pre-c3-commit.json` == `.uat/mppzthlkSJFr6Kle.post-c3-cycle.json` (byte-equal): live was exactly the C3.1 result, nothing drifted; post-deploy snapshot `.uat/mppzthlkSJFr6Kle.post-c3-commit.json` |
| — | Gateway `nTZHLbv2KFggdhh5` untouched: 32 nodes, active, versionId `d0d093a1…`, updatedAt 17:24:47 |

~~Not yet exercised live: the seven-point explicit rotation proof (step 1b sequence, `docs/C3_LIVE_DEFECT_CYCLE_COMMIT_ADOPTION.md`). Steps 3–6 remain ON HOLD until `C3 EXPLICIT CYCLE ROTATION LIVE PROOF = PASS` is recorded here.~~ Superseded by the proof below.

## C3 EXPLICIT CYCLE ROTATION LIVE PROOF = PASS (2026-09-03 18:45–18:47 UTC, owner sequence, fresh-read)

Owner turns in the client bot, all Concierge executions `success`, adoption chain ran on every turn:

| exec | time (UTC) | turn | Adopt Cycle Commit | Get Bot Session (Premium) | screen rendered |
|---|---|---|---|---|---|
| 5326 | 18:45:32 | `/start` | `ADOPTED` — lead `FIN-1788113619104-582` from `AS-09f4c25b…` (cycle `…1787947744615`), `lead_sent_at 17:40:14` | cycle unchanged, `cycle_reset ''` | «Последнее обращение уже передано FINMENTOR.» — «Добавить к обращению» | «Начать новый вопрос» (the C3.2 defect is closed: `TG_SUBMITTED` renders) |
| 5328 | 18:45:47 | «Начать новый вопрос» | `ALREADY_COMMITTED` (Bot_Sessions now carries the lead) | `TG_SUBMITTED`, no rotation | «Начать новый вопрос? Текущее обращение останется без изменений.» — «Начать новый вопрос» | «Вернуться» |
| 5330 | 18:45:55 | confirm «Начать новый вопрос» (`p|new_y`) | `ALREADY_COMMITTED` | **ROTATED**: `cycle_id C-551662084-1788461156146`, `lead_id ''`, `previous_lead_id 'TG-…; FIN-1788113619104-582'`, `cycle_reset restart`, state `MENU` | «FINMENTOR / Подготовка к первой встрече» — «Описать задачу» | «Подготовить бриф» |
| 5332 | 18:46:01 | «Подготовить бриф» | `NOT_SUBMITTED` (no submitted session for the NEW cycle — nothing re-adopted) | new cycle, `cycle_reset ''`, state `TG_ENTRY` | «Контекст сохранён…» — «Открыть бриф» |

The seven facts:

| # | fact | evidence |
|---|---|---|
| 1 | second projection row | `MiniApp_Cycle_Projection` id 2, `authority_key 551662084|C-551662084-1788461156146`, created 18:45:56.585 by 5330 with `cycle_reset restart` (Project Cycle output); 5332 re-projected it in place (same id, `cycle_reset ''`, updatedAt 18:46:03) — the P0 guard contract | PASS |
| 2 | new sequence > previous | `1788461156146 > 1787947744615` | PASS |
| 3 | row 1 unchanged | id 1: `cycle_id C-551662084-1787947744615`, `cycle_sequence 1787947744615`, `authority_key` as before; only `projected_at` touched by the pre-rotation turns 5326/5328 (in-place upsert of the same key) | PASS |
| 4 | new draft session on the new cycle | `MiniApp_App_Sessions` id 3, `AS-c7fabe28…`, `cycle_id C-551662084-1788461156146`, `state draft`, `lead_id null`, created 18:46:07.199 (Gateway mint, 6 s after «Открыть бриф») | PASS |
| 5 | blank questionnaire | row 3 is a freshly minted session id (not a resume); at creation only `locale` / `contact_name` were `telegram_carried`; the first `user_explicit` field lands at 18:46:53, step then advanced to `APP_CURRENT_SETUP` by 18:47:02 | PASS |
| 6 | old submitted session not resumed | id 2 `AS-09f4c25b…` keeps `cycle_id C-551662084-1787947744615`, `state submitted`, `updatedAt 17:40:14.413` — untouched; the Gateway minted a new session instead of returning it | PASS |
| 7 | no error executions | Gateway: zero executions, zero errors (retains none by design); Error Monitor: last execution 08-31 14:19; SYSTEM ALERT: last 08-31 17:52; Concierge 5326–5332 all `success`; legacy `AS-6703ea8d…` (`cycle_id ''`) was read but correctly ignored by the adoption on every turn | PASS |

Steps 3–6 may now proceed in order, each after its own dry-run. Session + Submit (step 3) NOT yet deployed at the time of this record.



**2026-09-03 late — LIVE DEFECT, steps 3–6 ON HOLD.** The owner's customer-flow test showed the rotation is unreachable (no `TG_SUBMITTED` screen after a Mini App submit). Root cause and the C3.2 correction: `docs/C3_LIVE_DEFECT_CYCLE_COMMIT_ADOPTION.md`, step 1b above. Do not deploy step 3 or release CUSTOMER until `C3 EXPLICIT CYCLE ROTATION LIVE PROOF = PASS` is recorded here.

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

**(SUPERSEDED by the live defect recorded above — `/start` cannot rotate either; see step 1b.)** **How to exercise the rotation on the CURRENT bot session.** The Concierge rotates a cycle only on
`/start`, or on «Начать заново» (`m|diag`) when the session already carries a consent decision, a
lead, or an ended status. The owner's live bot session right now has `consent ''`, `lead_id ''`,
`status active` (state `TG_CONFIRM_CONTEXT`), so pressing «Начать заново» would be read as
"continue", not "restart". To produce the second projection row, send `/start` to the client bot.
Expected: `MiniApp_Cycle_Projection` gains row 2 with `cycle_reset 'start'`, a NEW
`authority_key = 551662084|C-551662084-<new ms>` and `cycle_sequence` > `1787947744615`; row 1 is
untouched. Then open the Mini App from the bot: the Gateway must mint a session whose `cycle_id` is
the NEW cycle, and the submitted draft of `AS-09f4c25b…` (old cycle) must not be offered.

## Fresh-read 2026-09-03 18:52–18:54 UTC — step 3 ready, nothing drifted since the rotation proof

| check | result |
|---|---|
| Concierge `mppzthlkSJFr6Kle` | 60 nodes, active, unchanged since the 18:42:37 C3.2 deploy |
| Gateway `nTZHLbv2KFggdhh5` | 32 nodes, active, unchanged since 17:24:47 |
| Session `Hxje3Kel6nLLod5B` / Submit `ELiPdw4mdxQbBaan` | 14 / 28 nodes, active, unchanged since 08-31 17:46 (pre-C3) |
| X-Ray `tNSMRoKlFB52vjge` / host `KBD7Q94QQnlzgYKJ` | 29 / 2 nodes, active, unchanged (09-03 10:51 / 08-30 18:43) |
| `deploy-c3-endpoints --dry-run` | PASS: session 14 -> 17, submit 28 -> 32, `RELEASE: OWNER_ONLY`, both rollback artefacts unchanged (sha `10a96453c270`, `40a60e78512c`) |
| `deploy-c3-xray --dry-run` | PASS: 29 -> 37, 19 live nodes byte-identical to the offline compiler, rollback unchanged |
| `deploy-c3-miniapp-host --dry-run` | PASS: three endpoint URLs read back from the live page, `1789e00e080d837b -> 6d3afe66e911a89e`, rollback unchanged |
| `node qa/run-all.mjs` | 69/69, 2508 assertions, floors PASS |

Next owner command (step 3): `! node scripts/deploy-c3-endpoints.mjs --confirm` — then the step 3
live proof (Save Draft read-back, Submit → «Принято», reopen → committed screen, 403 for non-owners).

## Live proof record — step 3, Session + Submit endpoints (2026-09-03 18:57 UTC, owner `--confirm`, fresh-read)

| time (UTC) | evidence |
|---|---|
| 18:57:08 | `deploy-c3-endpoints.mjs --confirm` (owner): Session `Hxje3Kel6nLLod5B` 14 -> 17 nodes, active, versionId `fe51db1a-5098-4891-bebb-f809706d5981` — `written and read back` |
| 18:57:08 | Submit `ELiPdw4mdxQbBaan` 28 -> 32 nodes, active, versionId `7fbf0695-c194-4313-877e-7227b234ad50`. The script printed `FAIL … does not match what was sent`. Node-by-node diff of `.uat/ELiPdw4mdxQbBaan.deployed-c3-endpoints.json` against the sent candidate: ONE field differs — `Write Privacy Acknowledgement.credentials.postgres.name` (`FINMENTOR Privacy Audit (writer)` sent, `FINMENTOR Privacy Audit Writer` stored; same id `Jsfozg8CsclIdCRo`; the pre-deploy live row already carried the stored name). n8n rewrites the display name on save; the binding landed. **False negative of the verifier, NOT a failed deploy. No rollback performed.** |
| fix | `build-premium-endpoints.mjs` now emits the provisioned credential name; the candidate was regenerated (one-line change); `deploy-c3-endpoints.mjs` compares credentials by id. `node qa/run-all.mjs` 69/69, 2508 assertions |
| 19:02:00 | convergence `--dry-run`: session `17 -> 17; rewritten: —`, submit `32 -> 32; rewritten: —` — live IS the corrected candidate on both. Rollback artefacts `pre-c3-endpoints.json` KEPT unchanged (fresh reads saved alongside) |
| 19:03 | gate liveness, non-owner probes: `PUT /webhook/finmentor-miniapp-session` and `POST /webhook/finmentor-miniapp-submit` with unverifiable initData both answer `400 {"ok":false,"error_code":"BAD_REQUEST","retryable":false}` — refused before any store is touched, no 5xx |

Still owner-only (needs the owner's Telegram identity): fill one screen in the Mini App and reload → the answer is back (Save Draft read-back); Submit → «Принято»; reopen → committed screen with the pending note. Record those three observations here, then step 4.
