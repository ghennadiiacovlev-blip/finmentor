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

## C3 SESSION + SUBMIT LIVE PROOF = PASS (2026-09-03 19:05–19:07 UTC, owner UAT, fresh-read 19:07–19:12 UTC)

Owner sequence: new cycle from the bot (Concierge 5357–5363, 19:05:41–19:05:54, all `success`; `MiniApp_Cycle_Projection` row 3 `C-551662084-1788462349727`, `cycle_sequence 1788462349727`, created 19:05:50.130) → host page loads 5365 (19:05:54), 5368 (19:06:02 reload), 5383 (19:06:47 reopen after submit) → Lead Intake 5382 (19:06:40–43, `success`, integrated).

| # | fact | evidence |
|---|---|---|
| 1 | draft persistence survived reload | `MiniApp_App_Sessions` row 4 `AS-db13cac1…`, cycle `…1788462349727`, minted 19:05:55.161 by the Gateway; after the 19:06:02 host reload the SAME row was resumed (still 4 rows, no fifth mint; the Gateway re-carried `contact_name` into the draft at 19:06:05.733, after creation); `draft_json` holds the owner's answers at 19:06:16–19:06:35 (`company_name … contact_channel`, all `user_explicit`), written only through Save Draft; the owner saw the answer restored | PASS |
| 2 | Save Draft succeeds only after verified persistence | live Session `Hxje3Kel6nLLod5B` (17 nodes, versionId `fe51db1a…`): `Save Draft → Read Back Draft → Verify Draft Persistence → IF Draft Persisted`; `Respond Draft OK` has exactly ONE inbound edge, `IF Draft Persisted[true]` (`$json.ok == 1`); the verifier compares `app_session_id`, `state = draft` and byte-equal `draft_json` against `Validate Draft`; `Save Draft[error]` and `IF[false]` both land on `Respond Draft Unavailable` (503, retryable) | PASS |
| 3 | Submit marks submitted only after verified persistence | live Submit `ELiPdw4mdxQbBaan` (32 nodes, versionId `7fbf0695…`): `Mark Submitted → Read Back Submitted → Verify Submitted Persistence → IF Submitted Persisted`; `Respond Submit OK` has exactly ONE inbound edge, `IF Submitted Persisted[true]`; `Mark Submitted[error]` and `IF[false]` → `Respond Submit Persistence Failure` (503). Row 4: `state submitted`, `updated_at 19:06:43.860`, `lead_id FIN-1788113619104-582`, `expires_at` unchanged | PASS |
| 4 | reopening returned the same committed session | host load 5383 at 19:06:47 (after the submit); `MiniApp_App_Sessions` still 4 rows, row 4 untouched since 19:06:43.877 (no re-mint, no state change); projection row 3 untouched since 19:05:52.934 (no rotation); the owner saw the committed screen again | PASS |
| 5 | no duplicate canonical lead | `Submission_Receipts` id 15 `sub_440ad988…` `COMMITTED`, `canonical_lead_id FIN-1788113619104-582`, `lead_mode merged`, claimed 19:06:42.767, settled 19:06:43.706 — the ONLY new COMMITTED receipt (id 14 `READY` is the cycle's pre-allocation at 19:05:50); Lead Intake ran ONCE (5382); row 4 `lead_id` = the same canonical lead as rows 1–3 | PASS |
| 6 | non-owner access remains blocked | live `Session Verdict` and `Submit State`: `RELEASE_MODE = "OWNER_ONLY"`, `telegram_user_id !== OWNER_ID → 403 NOT_AUTHORISED`; no `"CUSTOMER"` literal anywhere in either workflow; non-owner probes (19:03) `PUT …-session` / `POST …-submit` → `400 BAD_REQUEST`, no store touched | PASS |
| 7 | no Error Monitor / SYSTEM ALERT regression | Error Monitor `RBiFLhVjizMkAzrK` last execution 5056 (08-31 14:19); SYSTEM ALERT `ID700kTo6EXffwry` last 5076 (08-31 17:52); tenant-wide search for `error/crashed/canceled/unknown` since 18:50 UTC → 0; the 25 most recent executions (5328–5383) all `success`; Session/Submit `settings` byte-equal to the pre-deploy rollback | PASS |

Session and Submit retain no executions by design (`saveDataSuccessExecution none`, unchanged); the rows and the graph are the evidence.

## Step 4 deploy record — X-Ray Analysis v2 is LIVE (2026-09-04 04:08–04:11 UTC, owner `--dry-run` + `--confirm`, fresh-read)

**C3 X-RAY DRY RUN = PASS** (04:08:46Z) and the `--confirm` (04:09:41Z) passed every gate: `X-Ray updated`, `fresh read: every candidate node present (37 nodes)`, `active`, `live validator is xray-v2`. But the deploy was a **convergence rewrite, not the first v2 deploy** — read this before trusting the printed rollback line.

| time (UTC) | evidence |
|---|---|
| 09-03 19:13:10.711 | n8n version history of `tNSMRoKlFB52vjge`: versionId `0c9cade1-f317-4985-a3bd-d8e6bedaf068`, author "Ghennadi Iacovlev" (API key, not MCP), one minute after the 19:12 step 3 fresh-read. **This is the 29 → 37 v2 deploy.** It was run from the other environment and is recorded nowhere in git (the last commit before this record, `2b4c3fc`, still says step 4 is next). No version exists between it and 04:09:41Z. |
| 09-04 04:01:20 (07:01 local) | this machine pulled `feat/miniapp-b21c-live-prereqs` (`4232076 → 2b4c3fc`, fast-forward); `.uat/` is untracked, so no `pre-c3-xray.json` existed here |
| 04:08:46 | `--dry-run`: `keepRollback` found NO `.uat/tNSMRoKlFB52vjge.pre-c3-xray.json` and wrote one from live — i.e. from the **37-node v2** workflow. `nodes 37 -> 37; added/removed: none; rewritten: —; 37 live nodes byte-for-byte`. |
| 04:09:41.033 | `--confirm`: PUT → versionId `93f953be-44f8-45b2-8ab9-f560a9d28ed2`, 37 nodes, active. Diff of `.uat/…deployed-c3-xray.json` against the 04:08 capture: 12 lines — ONLY the `webhookId` of three Telegram sender nodes (`telegramApi` credential `Mj41qrGHfrthCtAw`, lines 406/626/654), a field n8n ignores on non-trigger nodes. Node parameters, types, credentials, connections and `settings` (`errorWorkflow RBiFLhVjizMkAzrK`, `timezone Europe/Chisinau`, `availableInMCP true`) are byte-equal. |
| 04:10:53 | first sweep after the confirm, execution 5459, `success` (`Every 10 Minutes → Read Settings → Settings to Object → Read Pipeline → Read XRay_Analysis → Select Pending Leads`, nothing pending). 60 X-Ray sweep executions since 09-03 18:40Z, all `success`; 74 tenant-wide executions since 19:12Z, 0 non-success. |

Live v2 graph facts, fresh-read from the deployed capture:

| # | fact | evidence |
|---|---|---|
| 1 | one review path, GET/POST pair | `Review GET Webhook` `GET /finmentor-xray-review` (webhookId `768a174b…`, carried from C1 `Review Webhook`), `Review POST Webhook` `POST /finmentor-xray-review` (`9702a446…`); `Review Webhook` / `Read Analysis For Review` / `Review Verdict` gone | PASS |
| 2 | GET is read-only | GET chain `Read Analysis For Review GET → Render Review Surface → Respond Review Surface`; no Data Table node and no Sheets writer reachable from GET | PASS |
| 3 | POST publishes the curated result | POST chain reaches `Publish Curated Client Result` (`n8n-nodes-base.dataTable`, `upsert`); `IF Analysis Valid` present; 0 Postgres nodes | PASS |

**ROLLBACK POINTER CORRECTION.** The script prints `rollback: PUT … with .uat/tNSMRoKlFB52vjge.pre-c3-xray.json`, but on this machine that file is the **v2 workflow itself** (37 nodes, captured 04:08:46Z) — restoring it changes nothing. The pre-C3 X-Ray is:

- n8n version `7e2be0f4-74d8-4d02-bbf5-d4ca3161bb0a` (09-03 10:51:57Z, "Validate: KPI targets exempt…", 29 nodes, `Review Webhook` present, validator not v2) — restorable from the workflow's version history; or
- the local capture `.uat/tNSMRoKlFB52vjge.pre-c3-2026-09-03.json` (29 nodes, taken 09-03 11:17Z; no version was saved between 10:51:57Z and 19:13:10Z, so it equals `7e2be0f4`).

To make the printed rollback line true again (owner decision; the session that recorded this was not permitted to move files):

```
mv .uat/tNSMRoKlFB52vjge.pre-c3-xray.json .uat/tNSMRoKlFB52vjge.pre-c3-xray.live-2026-09-04T04-08-46Z.json
cp .uat/tNSMRoKlFB52vjge.pre-c3-2026-09-03.json .uat/tNSMRoKlFB52vjge.pre-c3-xray.json
```

Still owner-only (needs the owner's Telegram identity): open the review link from an existing owner alert → read-only draft page with «Подтвердить и открыть клиенту»; confirm → `XRay_Client_Results` gains one row for the lead; reopen the Mini App → result screen. Record those three observations here as `C3 X-RAY LIVE PROOF = PASS`, then step 5 (`deploy-c3-miniapp-host`). Step 5 NOT deployed. `RELEASE_MODE` still `OWNER_ONLY`; CUSTOMER NOT released.

## Step 4 live proof — protocol (prepared 2026-09-04 04:10–04:25 UTC, fresh-read)

**There is no v2 analysis to review yet.** Fresh-read of `XRay_Analysis` through sweeps 5459 (04:10:53Z) and 5460 (04:20:53Z): three rows — `XA-SEED`; `XA-FIN-1788432350648-72-MTLEGRPK` (RU synthetic UAT lead, `xray-v1`, `CLIENT_READY` since 09-03 10:47); `XA-FIN-1788432493303-321-MTLEK48C` (RO synthetic UAT lead «UAT SRL Sintetic Retail», `xray-v1`, `AI_DRAFT`, never reviewed). Both carry 32-hex C1 tokens and the sheet has no `review_token_expires_at` column yet (autoMap appends it with the first v2 row). The v2 surface refuses both by design. `Select Pending Leads` has been empty on every sweep since v2 went live, `XRay_Client_Results` (`MmYtlv9Q66xC3WIE`) holds 0 rows, and the owner's own lead `FIN-1788113619104-582` (08-30) is outside `xray_analysis_since = 2026-09-03`. So the ONE safe subject is the RO synthetic lead, re-analysed under v2 — exactly the §4 rule "delete their `XRay_Analysis` row to re-analyse under v2". No real customer analysis exists in the sheet.

Prerequisite (owner command; the session that prepared this was not permitted to run the confirm). Guards: the row is matched on `analysis_id` + `lead_id` + `request_id`, must be `xray-v1` / `AI_DRAFT` / unreviewed, the sheet must hold exactly SEED + RU + RO, SEED and RU must be value-identical after the delete; pre- and post-images land in `.uat/`. `--dry-run` PASSED at 04:24Z (target = sheet row 4). The Pipeline row is not touched — the sweep overwrites `xray_analysis_id`/`xray_analysis_status` when it re-analyses.

```
! node scripts/reset-c3-xray-uat-row.mjs --dry-run
! node scripts/reset-c3-xray-uat-row.mjs --confirm
```

Within 10 minutes the sweep (`Every 10 Minutes`, at :00:53 / :10:53 / …) analyses `FIN-1788432493303-321` under `xray-v2` and the FINMENTOR Leads Bot sends the owner (chat `owner_chat_id`) the alert **«ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ» … «Компания: UAT SRL Sintetic Retail» … «Lead ID: FIN-1788432493303-321»** with two buttons: **«✅ Проверить и открыть клиенту»** (the review GET link `…/webhook/finmentor-xray-review?a=XA-FIN-1788432493303-321-<new>&t=<64 hex>`) and «📊 Открыть CRM». Use ONLY this new alert — the 09-03 alerts carry pre-v2 tokens and answer «Доступ отклонён».

**The owner action:** tap «✅ Проверить и открыть клиенту» on that alert, read the page, then press **«Подтвердить и открыть клиенту»** at the bottom. Nothing else.

| # | fact to establish | evidence to fresh-read after the action |
|---|---|---|
| 1 | opening the GET link does NOT promote | the GET execution of `tNSMRoKlFB52vjge` runs only `Review GET Webhook → Read Analysis For Review GET → Render Review Surface → Respond Review Surface` (no Sheets update, no Data Table node); the POST execution's `Read Analysis For Review POST` still reads `review_status = AI_DRAFT`, `reviewed_at = ''`; `XRay_Client_Results` gains nothing at GET time |
| 2 | the page shows the draft and an explicit action | `Render Review Surface` output `http_status 200`, html titled «FINMENTOR · Проверка анализа» with the summary, risks, 30-day plan and a `<form method="post">` whose only button is «Подтвердить и открыть клиенту»; the owner saw it |
| 3 | only the explicit POST flips AI_DRAFT → CLIENT_READY | POST execution: `Review POST Verdict` = `PROMOTE`, then `Promote Analysis` (update matched on `analysis_id`) and `Update Pipeline Review Status`; sheet row now `CLIENT_READY`, `reviewed_at` = the POST time; Pipeline `xray_analysis_status = CLIENT_READY` |
| 4 | exactly one curated result row | `XRay_Client_Results`: 1 row, `lead_id FIN-1788432493303-321`, `analysis_id` = the new v2 id, `review_status CLIENT_READY`, `locale ro`, `score`/`zone` = the sheet's |
| 5 | nothing internal is published | `result_json` keys ⊆ {locale, labels, score, zone, zone_label, maturity, summary, key_risks, management_priorities, plan_30_days, tomorrow_actions, recommended_next_step}; no `review_token`, `request_id`, `analysis_json`, `confidence`, `fabrication_flags`, `validation_errors`, prompt or model name anywhere in the row |
| 6 | repeated confirmation is idempotent | a second `POST /webhook/finmentor-xray-review` with the same `a`,`t` → `ALREADY_READY` (200, «Уже готово»), `reviewed_at` unchanged, still exactly 1 `XRay_Client_Results` row (upsert on `lead_id`); re-opening the button → GET «Уже готово», no form |
| 7 | no Error Monitor / SYSTEM ALERT regression | Error Monitor `RBiFLhVjizMkAzrK` last execution still 5056 (08-31 14:19); SYSTEM ALERT `ID700kTo6EXffwry` still 5076 (08-31 17:52) — baseline fresh-read 04:19Z; tenant-wide non-success executions since the reset → 0 |

Record the seven facts here as `C3 X-RAY LIVE PROOF = PASS`, then step 5.

## C3 X-RAY LIVE PROOF = PASS (2026-09-04 04:27–04:34 UTC, owner UAT on the synthetic RO lead, fresh-read 04:33–04:35 UTC)

Sequence: `reset-c3-xray-uat-row.mjs --confirm` (owner, ~04:27Z: row 4 deleted, SEED + RU value-identical, pre/post-images in `.uat/`) → sweep 5466 (04:30:53–04:31:14Z, `success`) selected `FIN-1788432493303-321`, ran the model, `Validate + Store Rows` → `is_valid true`, new row `XA-FIN-1788432493303-321-0BDD7AC8C4E6` (`xray-v2`, `AI_DRAFT`, 64-hex token, `review_token_expires_at 2026-10-04T04:31:12Z`, score 47 ORANGE ro, confidence LOW, flag `12mil`), `Save XRay_Analysis` + `Update Pipeline X-Ray` `success`, `Telegram Owner Alert` message 178 to chat `owner_chat_id` at 04:31:14Z with «✅ Проверить и открыть клиенту» → owner GET 5467 (04:31:56Z) → owner POST 5468 (04:32:37Z) → session replay POST 5469 (04:34:25Z) and GET 5470 (04:34:32Z).

| # | fact | evidence | |
|---|---|---|---|
| 1 | opening the GET link did NOT promote | 5467 ran only `Review GET Webhook → Read Analysis For Review GET → Render Review Surface → Respond Review Surface` (no Sheets update, no Data Table node); its pre-read: `AI_DRAFT`, `reviewed_at ''`. The POST 5468 pre-read (`Read Analysis For Review POST`, 41 s later) STILL `AI_DRAFT`, `reviewed_at ''`. `XRay_Client_Results` was 0 rows at 04:33Z before the POST landed | PASS |
| 2 | the page showed the draft and an explicit action | `Render Review Surface` → `http_status 200`, title «FINMENTOR · Проверка анализа», `<form method="post">` present with the single button «Подтвердить и открыть клиенту»; the owner saw it and confirmed the page alone published nothing | PASS |
| 3 | only the explicit POST flipped AI_DRAFT → CLIENT_READY | 5468: `Review POST Verdict = PROMOTE` (200), `Promote Analysis` + `Update Pipeline Review Status` `success`, `reviewed_at 2026-09-04T04:32:40.430Z`. Fresh sheet read-back by 5469 at 04:34:25Z: the row is `CLIENT_READY` with that same `reviewed_at` | PASS |
| 4 | exactly one curated result row | `XRay_Client_Results` (`MmYtlv9Q66xC3WIE`): 1 row, id 1, `lead_id FIN-1788432493303-321`, `analysis_id …0BDD7AC8C4E6`, `review_status CLIENT_READY`, `locale ro`, `score 47`, `zone ORANGE`, `published_at 04:32:42.032Z` | PASS |
| 5 | nothing internal published | row columns are exactly `lead_id, analysis_id, locale, review_status, score, zone, result_json, published_at`; `result_json` keys are exactly `locale, labels, score, zone, zone_label, maturity, summary, key_risks, management_priorities, plan_30_days, tomorrow_actions, recommended_next_step` — no `review_token`, `request_id`, `analysis_json`, `confidence`, `fabrication_flags`, `validation_errors`, model name or prompt | PASS |
| 6 | repeated confirmation is idempotent | replay POST 5469 with the same `a`,`t` → 200 «FINMENTOR · Уже готово», `verdict ALREADY_READY`, `reviewed_at` unchanged (`04:32:40.430Z`); `Publish Curated Client Result` upserted the SAME row id 1 (still 1 row, `published_at` re-stamped 04:34:31.838Z, no second row). GET re-open 5470 → 200 «Уже готово», no form | PASS |
| 7 | no Error Monitor / SYSTEM ALERT regression | Error Monitor `RBiFLhVjizMkAzrK` last execution still 5056 (08-31 14:19); SYSTEM ALERT `ID700kTo6EXffwry` still 5076 (08-31 17:52); tenant-wide executions since 04:24Z = 5466–5470, all `success`, 0 non-success | PASS |

Note (content, not contract): the model's summary states «cifră de afaceri estimată la 1,2 milioane EUR» and the guard flagged `12mil` as unconfirmed by the input; v2 lowered confidence to LOW and showed «⚠️ проверить цифры» on the owner page, and the owner chose to publish. Confidence and the flag stay internal, as designed.

Step 5 (`deploy-c3-miniapp-host`) NOT deployed. `RELEASE_MODE` still `OWNER_ONLY`; CUSTOMER NOT released.

## Step 5 deploy record — Mini App host is LIVE (2026-09-04 04:38–04:40 UTC, owner `--dry-run` + `--confirm`, fresh-read)

Pre-deploy fresh-read (04:38:47Z): Git clean at `589d3dd`; host `KBD7Q94QQnlzgYKJ` 2 nodes, active, unchanged since 08-30 18:43:25Z (versionId `7e617760…`, page sha `1789e00e080d837b`); Gateway 32 / Session 17 / Submit 32 / X-Ray 37 / Concierge 60 nodes, all active and unchanged since their recorded deploys; `XRay_Client_Results` = 1 row (`FIN-1788432493303-321`, `CLIENT_READY`); 0 non-success executions since the X-Ray proof.

**C3 MINI APP HOST DRY RUN = PASS** (04:38Z): rollback artifact written fresh from live on this machine — and because live was still the 08-30 page, it IS the pre-C3 host (2 nodes, Serve Page sha `1789e00e080d837b`); three endpoint URLs read back from the live page; `1789e00e080d837b -> 6d3afe66e911a89e`.

| time (UTC) | evidence |
|---|---|
| 04:39:55.196 | `--confirm` (owner): PUT → versionId `1bf230cb-ca48-467c-885d-418ae59714b8`, `host updated`, `fresh read: the live page is the candidate page`, `active` |
| 04:40:18 | fresh read: 2 nodes, active; `Serve Page.responseBody` 122 620 bytes, sha `6d3afe66e911a89e`; `Open Mini App` parameters, `Serve Page` non-body parameters, connections and settings byte-equal to the rollback artifact — ONE field changed, as designed |
| 04:40:18.918 | `GET /webhook/finmentor-premium-miniapp` → 200 `text/html`, 122 620 bytes, sha `6d3afe66e911a89e` (= the stored body); the page names all three endpoints (`…-gateway`, `…-session`, `…-submit`) and carries the result-screen code; host execution 5471 `success` |

The tracked candidate's own page sha is `9e18466083d00f14`; it differs from the live sha only by the three endpoint URLs the deploy substitutes from live (never typed, never in the repo).

Rollback: `PUT /api/v1/workflows/KBD7Q94QQnlzgYKJ` with `.uat/KBD7Q94QQnlzgYKJ.pre-c3-host.json` (verified pre-C3).

Sheet read-back (sweep 5472, 04:40:53Z): `XRay_Analysis` = SEED + RU (`xray-v1`, `CLIENT_READY`, 32-hex, no expiry) + RO `…0BDD7AC8C4E6` (`xray-v2`, `CLIENT_READY`, 64-hex, `review_token_expires_at 2026-10-04T04:31:12Z`); the header now carries `review_token_expires_at`; nothing pending.

**DEFECT FOUND AT FRESH-READ (host ↔ Gateway result contract), not yet fixed.** The new host page's `RESULT_KEYS` are `locale, labels, score, zone, zone_label, maturity, summary, key_risks, management_priorities, plan_30_days, tomorrow_actions, recommended_next_step`, and the result screen renders `r.zone_label` (condition line) and `r.summary` (headline text). The live Gateway `nTZHLbv2KFggdhh5` node `Attach Client Result` filters the published `result_json` through `allowed = ['locale','labels','score','zone','maturity','key_risks','management_priorities','plan_30_days','tomorrow_actions','recommended_next_step']` — it DROPS `zone_label` and `summary`. Effect: a customer's result screen would show no zone wording and no summary (the page renders both conditionally, so nothing breaks; the screen is incomplete). Fix belongs in the Gateway's `Attach Client Result` allow-list (add the two keys) — source `scripts/build-miniapp-gateway.mjs:390`, tracked candidate `n8n/candidate/miniapp-gateway-candidate.json` — deployed with a rollback artefact; then the result-screen proof. Do not release CUSTOMER before this is fixed and proven.

### Step 5 fix — the client result contract (prepared 2026-09-04 04:45–04:53 UTC, fresh-read; NOT yet deployed)

The mismatch, proven from the three holders:

| holder | keys | source |
|---|---|---|
| Mini App `RESULT_KEYS` | locale, labels, score, zone, **zone_label**, maturity, **summary**, key_risks, management_priorities, plan_30_days, tomorrow_actions, recommended_next_step (12) | `app-premium/net.js:243`; the host page renders `r.zone_label` (condition line) and `r.summary` (headline) |
| X-Ray publisher `result_json` | the same 12 | `n8n/src/xray-analysis/build-client-result.js`, executed in `qa/client-result-contract.test.mjs`; the live row for `FIN-1788432493303-321` carries both |
| Gateway `Attach Client Result` allow-list | 10 — no `zone_label`, no `summary` | live `nTZHLbv2KFggdhh5` (32 nodes, unchanged since 09-03 17:24:47Z, versionId `d0d093a1…`), jsCode sha `a5fd13ce09aec319`, byte-identical to `scripts/build-miniapp-gateway.mjs` |

The fix (repo): `scripts/build-miniapp-gateway.mjs` now exports `CLIENT_RESULT_KEYS` (the 12 keys, in the Mini App's order) and compiles the allow-list from it; the tracked candidate `n8n/candidate/miniapp-gateway-candidate.json` was rebuilt and differs from the previous commit by ONE line (the allow-list). Nothing else in the Gateway moves: not the CLIENT_READY-only filter, not the lead match, not the PENDING fall-through, not the store-error path.

QA: new gate `qa/client-result-contract.test.mjs` (61 checks, in `run-all` and the floor baseline): Mini App RESULT_KEYS ⊆ Gateway allow-list (per key), Gateway allow-list ⊆ Mini App RESULT_KEYS (per key — the inverse safety condition), builder constant = compiled candidate (not stale), publisher result_json keys = allow-list, 26 forbidden internal keys absent from all three holders, and EXECUTED: the candidate's `Attach Client Result` handed a CLIENT_READY row with the full result plus injected `review_token`/`analysis_json`/`request_id`/`confidence`/`fabrication_flags`/`prompt`/`model`/… returns exactly the 12 keys, `zone_label` and `summary` by value; non-CLIENT_READY rows still yield `null`/`PENDING`. `node qa/run-all.mjs` → **70/70 gates, 2569 assertions, floors PASS**.

Two tooling facts fixed on the way (this checkout is `core.autocrlf=true`): the builder now normalises the embedded verifier to LF (otherwise the rebuilt candidate flipped `Verify InitData` to CRLF on every line), and the gates that compare disk sources byte-for-byte (`miniapp-gateway`, `lead-alerts-candidates`) read them as LF; `deploy-c3-gateway-cycle.mjs` no longer calls `process.exit(0)` in dry-run (Node 24 on Windows aborted at teardown with a libuv assertion AFTER printing the verdict) and prints the rollback path that is actually the pre-deploy state.

**C3 CLIENT RESULT CONTRACT DRY RUN = PASS** (04:52:03Z): live 32 nodes, active; candidate built and verified (30 nodes); `nodes rewritten: Attach Client Result` only; merged graph 32 nodes, alert callers preserved; exit 0. Byte-level `git diff --no-index` of the fresh live capture against the merged candidate: **1 line** — the allow-list. 31 other nodes, all connections and settings byte-identical.

Rollback for THIS deploy: `.uat/nTZHLbv2KFggdhh5.pre-c3-cycle.live-2026-09-04T04-52-03-098Z.json` (= live at 04:52Z, 32 nodes). NOT `.uat/nTZHLbv2KFggdhh5.pre-c3-cycle.json` on this machine — that file (23 nodes, 09-03 11:25Z) is the pre-C3.1 Gateway and was rightly KEPT.

```
! node scripts/deploy-c3-gateway-cycle.mjs --dry-run
! node scripts/deploy-c3-gateway-cycle.mjs --confirm
```

After confirm, fresh-read and record: Gateway active; live `Attach Client Result` allow-list = the 12 keys (zone_label, summary pass through); forbidden keys absent; CLIENT_READY-only semantics unchanged; `Build App Session` / cycle resolution byte-identical to the 04:52Z capture; Error Monitor / SYSTEM ALERT unchanged.

**C3 CLIENT RESULT CONTRACT = LIVE (2026-09-04 04:55:34 UTC, owner `--confirm` from commit `5725d60`, fresh-read 04:56:06 UTC)**

| # | fact | evidence |
|---|---|---|
| 1 | Gateway active | `nTZHLbv2KFggdhh5` 32 nodes, active, versionId `a7158b5b-80dd-473e-9d00-1d5f571ba191`, updatedAt 04:55:34.211Z, name unchanged | PASS |
| 2 | `zone_label` passes through | live `Attach Client Result` allow-list = 12 keys `locale, labels, score, zone, zone_label, maturity, summary, key_risks, management_priorities, plan_30_days, tomorrow_actions, recommended_next_step`; the LIVE node code executed against the LIVE `XRay_Client_Results` row for `FIN-1788432493303-321` returns `zone_label "Zonă portocalie"` | PASS |
| 3 | `summary` passes through | same execution: `summary` = the published Romanian summary («Afacerea operează în sectorul retail cu o rețea de 6 magazine…»), 12 keys in the response result | PASS |
| 4 | forbidden/internal fields absent | none of `review_token, review_token_expires_at, analysis_json, plan_30d_json, request_id, confidence, fabrication_flags, validation_errors, prompt, model, reviewed_at, review_status, executive_summary, analysis_id, lead_id, limitations, data_gaps, documents_required, …` in the allow-list or in the attached result; `lead_id` not in the client response | PASS |
| 5 | CLIENT_READY semantics unchanged | live code: `AI_DRAFT` row → `result null`, `PENDING`; another lead's row → `PENDING`; no row → `PENDING`; store error → `result_store_error 1`; the jsCode differs from the 04:55Z capture ONLY on the allow-list line | PASS |
| 6 | cycle/session authority unchanged | node-by-node against `.uat/nTZHLbv2KFggdhh5.pre-c3-cycle.live-2026-09-04T04-55-33-953Z.json`: the ONLY differing node is `Attach Client Result`; no node missing; connections and settings byte-equal; `Build App Session` and `Resolve Session` jsCode byte-equal; the one credential is still `G5 Replay Claim` → `FINMENTOR Supabase G5` | PASS |
| 7 | no Error Monitor / SYSTEM ALERT regression | Error Monitor last 5056 (08-31 14:19), SYSTEM ALERT last 5076 (08-31 17:52); tenant executions since 04:40Z: 3, all `success` (the Gateway retains none by design) | PASS |

Rollback (if ever needed): `PUT /api/v1/workflows/nTZHLbv2KFggdhh5` with `.uat/nTZHLbv2KFggdhh5.pre-c3-cycle.live-2026-09-04T04-55-33-953Z.json`. `RELEASE_MODE` still `OWNER_ONLY`; CUSTOMER NOT released.

### Step 5 end-to-end result-screen proof — the owner action (prepared 04:56–05:00 UTC, fresh-read)

Why an extra step is needed: the result screen is attached by the viewer's committed session's `lead_id`. The only `CLIENT_READY` result belongs to the synthetic RO lead, which has no Telegram identity. The owner's own lead `FIN-1788113619104-582` («Mega Parc SRL», HOT/Qualified, created 08-30 18:13Z) has no analysis because `Settings.xray_analysis_since = 2026-09-03T00:00:00.000Z` excludes it. Fresh-read of every Pipeline row (sweep 5473): with `xray_analysis_since = 2026-08-30T00:00:00.000Z` the sweep's pending set becomes EXACTLY ONE lead — the owner's — because the only other row in that window (`FIN-1787944699020-596`, 08-28) is `INCOMPLETE` and the two 09-03 leads are already analysed; every older row is 08-25 or earlier. The owner's committed Mini App session (row 4 `AS-db13cac1…`, `submitted`, cycle `C-551662084-1788462349727`) is the CURRENT projection, so reopening the Mini App WITHOUT `/start` resumes it and the Gateway attaches the result by lead.

The sequence (five owner steps, one Settings cell edited and restored):

1. CRM → tab `Settings` → key `xray_analysis_since`: change `2026-09-03T00:00:00.000Z` to `2026-08-30T00:00:00.000Z`. (Touches nothing else; the sweep reads Settings on every run.)
2. Wait for the next sweep (:00:53 / :10:53 / …). Expected: alert «ФИНАНСОВЫЙ РЕНТГЕН · НОВЫЙ АНАЛИЗ … Компания: Mega Parc SRL … Lead ID: FIN-1788113619104-582» with «✅ Проверить и открыть клиенту».
3. Tap «✅ Проверить и открыть клиенту», read the page, press «Подтвердить и открыть клиенту».
4. Open the Mini App from the existing bot message (the «Открыть Mini App» button of the current cycle). Do NOT send `/start` and do NOT press «Начать заново» — either rotates the cycle and the new cycle has no committed session. Expected: the RESULT screen (product title, score «… из 100» + zone wording on one line, «Финансовое состояние: …», the summary paragraph, maturity, risks, priorities, 30-day plan, next action, recommendation, one closing button) — not the committed/pending screen.
5. CRM → `Settings` → `xray_analysis_since` back to `2026-09-03T00:00:00.000Z`.

Record here: the sweep execution id and the new `XA-FIN-1788113619104-582-…` row (`xray-v2`), the GET/POST executions, the second `XRay_Client_Results` row (`lead_id FIN-1788113619104-582`), the host load, and the owner's observation of the result screen → `C3 STEP 5 RESULT SCREEN LIVE PROOF = PASS`.

Correction to the plan above, found at fresh-read before the owner edited anything: the `Settings` tab (gid 1871239368, columns key/value/note, 27 key rows 2–28) held NO `xray_*` row at all; every X-Ray setting came from the code defaults in `Settings to Object`. The owner therefore ADDED a temporary row 29 `xray_analysis_since = 2026-08-30T00:00:00.000Z` and deleted it afterwards.

## C3 STEP 5 RESULT SCREEN LIVE PROOF = PASS (2026-09-04 05:10–05:14 UTC, owner UAT on the owner's own lead, fresh-read 05:17 and 05:21 UTC)

Sequence: sweep 5477 (05:10:53Z, `Read Settings` 28 rows incl. the temporary row, effective `since 2026-08-30`) → `Select Pending Leads` = exactly `FIN-1788113619104-582` → new row `XA-FIN-1788113619104-582-B8599E8ADDF9` (`xray-v2`, `AI_DRAFT`, 64-hex token, expires 2026-10-04T05:11:08Z, `score ''`, `zone UNKNOWN`, locale ru, confidence LOW) → `Telegram Owner Alert` message 181 → owner GET 5478 (05:11:35Z) → owner POST 5479 (05:12:00Z) → host load 5480 (05:13:25Z) → owner deleted row 29 → sweep 5482 (05:20:53Z).

| # | fact | evidence | |
|---|---|---|---|
| 1 | the result belongs to the correct committed owner session | `MiniApp_App_Sessions` still 4 rows (no new mint; newest `updated_at` 09-03 19:06:43); row 4 `AS-db13cac1…`, tg `551662084`, cycle `C-551662084-1788462349727`, `submitted`, `lead_id FIN-1788113619104-582`; `MiniApp_Cycle_Projection` still 3 rows, newest = that cycle (no rotation); the published row 2 carries `lead_id FIN-1788113619104-582`, the same lead; the LIVE `Attach Client Result` code executed with that session against the LIVE table attaches exactly this row (`equals owner row: true`) | PASS |
| 2 | `zone_label` and `summary` pass through the live Gateway | live `nTZHLbv2KFggdhh5` (32 nodes, active, versionId `a7158b5b…`, unchanged since 04:55:34Z), allow-list 12 keys; execution of the live node: `result_state CLIENT_READY`, 12 keys, `zone_label "Без оценки"`, `summary` «В бизнесе розничной торговли выявлена ключевая проблема — отсутствие с…» | PASS |
| 3 | the result screen consumed the curated CLIENT_READY result | GET 5478 ran only the read/render chain (`Проверка анализа`, form present, pre-read `AI_DRAFT`, `reviewed_at ''`); POST 5479: pre-read still `AI_DRAFT` → `PROMOTE` 200, `reviewed_at 05:12:02.542Z`, `Publish Curated Client Result` → row id 2; host load 5480 at 05:13:25Z after the promotion; the Gateway's 12 keys = the host's `RESULT_KEYS`; the owner saw the result screen (state, summary, maturity, key risks, priorities, 30-day plan, next step). Score is `null` and zone `UNKNOWN` → «Без оценки» because this lead has no questionnaire score — by contract, not a defect | PASS |
| 4 | no forbidden/internal field exposed | row 2 columns `analysis_id, lead_id, locale, published_at, result_json, review_status, score, zone` (+ table ids); `result_json` keys exactly the 12; text contains none of `review_token, request_id, analysis_json, confidence, fabrication_flags, validation_errors, limitations, data_gaps, prompt, model, reviewed_at, AI_DRAFT, ANALYSIS_FAILED, gpt-4.1, fmr_`; the attached result carries none and `lead_id` is not in the client response | PASS |
| 5 | Settings no longer carries the override | sweep 5482 (05:20:53Z): `Read Settings` 27 rows (2–28, last `client_ai_temperature`), `xray_*` rows: none, effective `xray_analysis_since 2026-09-03T00:00:00.000Z` (code default), `Select Pending Leads` empty | PASS |
| 6 | no duplicate client result | `XRay_Client_Results` = 2 rows, one per lead: id 1 `FIN-1788432493303-321` (04:34Z), id 2 `FIN-1788113619104-582` (`published_at 05:12:04.134Z`); Lead Intake not involved; `Promote Analysis` matched on `analysis_id` | PASS |
| 7 | no Gateway / Error Monitor / SYSTEM ALERT regression | Gateway `updatedAt` still 04:55:34.211Z; Error Monitor last 5056 (08-31 14:19); SYSTEM ALERT last 5076 (08-31 17:52); tenant executions since 04:56Z: 7 (5476–5482), all `success` | PASS |

Step 5 is closed. `RELEASE_MODE` still `OWNER_ONLY`; CUSTOMER NOT released; routing untouched.

Live proof (owner-only) still to record: reopen the Mini App on the submitted brief → committed screen with «Результат анализа появится здесь после проверки консультантом FINMENTOR.». NOTE: the result screen is keyed by the viewer's lead; the only `CLIENT_READY` result belongs to the synthetic RO lead, and the owner's own lead `FIN-1788113619104-582` (created 08-30) is outside `xray_analysis_since` and has no analysis — so the owner's reopen can prove the committed-screen copy, not the result screen, until an analysis exists for the owner's lead. `RELEASE_MODE` still `OWNER_ONLY`; CUSTOMER NOT released.
