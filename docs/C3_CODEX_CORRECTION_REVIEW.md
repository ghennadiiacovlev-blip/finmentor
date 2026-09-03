# C3 — Codex correction branch: independent review and integration record

**Date:** 2026-09-03 · **Program:** Production Completion v1 · **Checkpoint:** C3 (resumed)

| item | value |
|---|---|
| pre-correction feature HEAD | `4232076` (`feat/miniapp-b21c-live-prereqs`, WIP checkpoint) |
| Codex correction HEAD | `7f77753` (`fix/codex-production-correction`, two commits on top of `4232076`) |
| merge base | `4232076` — the correction is a pure patch on the WIP checkpoint |
| Codex touched | 47 files, +3615 / −820; no documentation, no live mutation |
| review evidence | STATIC (read), SIMULATED (executed offline in the QA sandbox), LIVE (fresh-read from the tenant) as labelled |

Nothing from the Codex branch was merged as-is. Every material correction was classified and the
accepted parts were re-implemented on the feature branch with the rejected parts removed; the
Codex branch itself stays unmerged and undeployed.

## 1. Reproduction of the reported QA — DRIFT FOUND

Codex reported **67/67 gates, 2363 assertions, floors PASS, deterministic regeneration PASS**.
Reproduced on this machine (Windows, `core.autocrlf=true` by default), LIVE evidence:

| tree | as checked out (CRLF) | after LF normalisation | what failed |
|---|---|---|---|
| feature `4232076` | 55/64 | 61/64 | `miniapp-gateway` (1), `gateway-store-failure-harness` (4), floor (2) |
| Codex `7f77753` | 61/67 | **64/67** | `miniapp-gateway` (1), `lead-alerts-candidates` (2), floor (2) |

Root causes, all verified:

1. **CRLF inside committed generated artefacts.** Both sessions committed candidates that were
   generated on a CRLF checkout, so the jsCode strings inside the JSON carry `\r\n`. The
   feature WIP `miniapp-gateway-candidate.json` fails "Verify InitData is bootstrap-canary.js
   with ONLY the BOT_ID line substituted" (261 of 262 lines differ by `\r`). Codex's
   `lead-alerts-*-candidate.json` edits are **nothing but** `\n → \r\n` inside the inlined tz.js
   block (word-diff), which breaks the byte-exact live-prefix gate. Regenerating the lead-alert
   candidates on an LF tree reproduces the feature HEAD byte for byte.
2. **A real WIP gap in the feature checkpoint**: the harness builder still expected four respond
   nodes while the Gateway had five. Codex fixed this (accepted).
3. The floor failures are derivative (run-all exits non-zero for the reasons above).

So the "67/67" claim does not reproduce: the Codex tree is 64/67 on a clean LF checkout. The
drift is explained and contained; it did not hide a safety defect, and no production mutation
was made on the strength of the claim. Every gate below was re-run on the integrated tree.

Housekeeping fixed on this machine: `core.autocrlf=false` for the repository; every generated
candidate in this checkpoint is regenerated from its builder on an LF tree.

## 2. Verdicts

### C1 — X-Ray analysis

| correction | verdict | why |
|---|---|---|
| strict fail-closed model output validation | **ACCEPT WITH ADJUSTMENT** | Accepted: unparseable JSON, a non-object, a missing required section, an empty plan week or no usable risk is `ANALYSIS_FAILED`, never a draft; failed rows carry `validation_errors`, an `ANALYSIS_FAILED` Pipeline projection and an owner notice. Rejected: Codex's `exactKeys` schema (any extra key or a lower-case priority fails the whole analysis) and turning the fabrication guard into a hard failure — the live RO acceptance run (C1) already showed the guard flagging a KPI target; Codex re-included exactly those fields. Within a valid contract the output is normalised (caps, defaults, `DISCOVERY_CALL` fallback) and figures are flagged with confidence LOW, and the owner decides. |
| explicit PII allowlist (closed enum codes only) | **REJECT** | It removes every questionnaire answer and free-text signal from the model input; the analysis would be produced from six codes. C1 was proven live on both locales with the section-allowlist + key-denylist + value-scrub + leak-recheck projection and no PII in the prompt (gate + live prompt inspection). Accepted from the proposal: the zone is bounded to the five-value vocabulary and the completion percentage to 0..100 before either reaches the prompt. |
| atomic X-Ray idempotency via a Supabase claim table (migration 0004, `finmentor_xray_analysis_claims`) | **REJECT** | New infrastructure; puts the Supabase credential on the X-Ray workflow (three more credential-bearing nodes); and it removes the only retry path (deleting the sheet row no longer re-analyses because the claim persists). The race it addresses is an overlapping 10-minute sweep, bounded by the cadence and `xray_max_per_run`, and a duplicate draft is caught at review. Recorded as a known bounded risk, not silently accepted. |
| review promotion semantics: read-only GET, POST promotes | **ACCEPT WITH ADJUSTMENT** | The C1 one-tap GET was a state-changing GET (a preview fetch or a proxy could promote). Accepted: GET renders the draft and a confirmation form and mutates nothing; POST promotes. Review tokens are now 32 random bytes and bounded (30 days; Codex's 7 days is too short for a consultant's review cadence); a row without an expiry (pre-v2) is refused. Rejected: the PostgreSQL compare-and-set — the Sheets update matched on `analysis_id` is idempotent as it was, and a second confirmation answers `ALREADY_READY` and re-runs the customer publication as a repair. |
| CLIENT_READY customer result publisher | **ACCEPT WITH ADJUSTMENT** | Codex's row shape did not match the live Data Table `XRay_Client_Results` (LIVE: `analysis_id, lead_id, locale, published_at, result_json, review_status, score, zone`, created 2026-09-03 11:17Z). Re-implemented against those columns, upserted by `lead_id`; `result_json` carries only the curated fields (condition/score, risk zone, maturity, key risks, priorities, 30-day plan, next action, FINMENTOR recommendation) under the RU name «Финансовый рентген бизнеса» and the RO name «Test de sănătate financiară FINMENTOR»; the gate asserts none of token, raw response, prompt, request id, confidence internals, `AI_DRAFT` or `ANALYSIS_FAILED` can appear. |

### C2 — CRM workflow

| correction | verdict | why |
|---|---|---|
| runtime stage resolver inlined into the alert action builders (`scripts/lib/inline-crm-stage.mjs`) | **ACCEPT** | One resolver for the deployed Code nodes and the gate; the gate executes the inlined form. |
| `UNKNOWN` business stage for empty or unrecognised stored values | **ACCEPT** | An unknown historical value is observable instead of silently `NEW`; automated transitions refuse to guess (`canAutomatedTransition`). RU/RO labels added. |
| Nurture → NEW compatibility, Closed → LOST terminal | **ACCEPT** | Explicit compatibility mapping, not a stored rewrite; `Closed` is terminal. |
| Won / Lost terminal: no keyboard, no reopening by automation | **ACCEPT** | `TERMINAL_STAGE` now includes `lost` and `closed`, and the resolver's `isTerminalStage` is consulted. |
| lead-alert candidate JSON edits | **REJECT** | Pure CRLF pollution (see §1); the candidates regenerate identical to the feature HEAD. |
| `lead-alerts-actions` test against the tracked 52-column schema instead of a `.uat` pre-image | **ACCEPT** | Same proof, no dependence on a UAT artefact. |

### C3 — Premium FINMENTOR Bot + Mini App

| correction | verdict | why |
|---|---|---|
| owner/customer release gate stays closed in tracked candidates (`__MINIAPP_RELEASE_MODE__`, `OWNER_ONLY` default, `CUSTOMER` only by explicit substitution) | **ACCEPT** | Exactly the required posture: the source never activates customers; the release is one reviewed substitution. The WIP checkpoint had removed the gate prematurely. |
| monotonic cycle authority: one immutable projection row per (user, cycle) — `authority_key`, `cycle_sequence`; the Gateway resolves the highest sequence | **ACCEPT WITH ADJUSTMENT** | This is the correct answer to "a stale turn cannot overwrite a newer authoritative cycle": with one row per user, a delayed Concierge execution could upsert the old cycle over the new one. The cycle id is `C-<chat_id>-<Date.now()>` (LIVE, issuer code), so the sequence is numeric and monotonic. Adjusted: an unparseable (legacy) cycle no longer throws on an ordinary turn — it is written under a `LEGACY` key the Gateway ignores, and only a ROTATION to an unprojectable cycle aborts. The live Concierge already runs the first-generation pair, so an in-place **upgrade** path was added and gated (`upgradeConcierge`). |
| Cycle Projection Guard aborts EVERY turn on a projection-store error | **REJECT** | With per-cycle rows a non-rotation turn cannot move the cycle and its row already exists; aborting the customer's chat turn buys nothing. Rotation-turn abort (the invariant) is kept and gated. |
| stale-cycle race handling in the Gateway (filter on `authority_key` and `cycle_sequence`, BigInt ordering) | **ACCEPT** | |
| Data Table fail-closed: an unreadable cycle/session/result store is a 503 outage, never "no rows" | **ACCEPT** | `IF Cycle Store Readable`, `IF Session Store Readable`, `IF Result Store Readable`, one typed `Respond Application Store Unavailable` (503, retryable). |
| proven persistence on bootstrap (`Finalise Session` must read back the row it wrote) | **ACCEPT WITH ADJUSTMENT** | Accepted: an empty or unreadable read-back, or one without our row, is 503 `persistence_error`. Adjusted: the deterministic arbitration stays, so under a concurrent open the read-back may return the OTHER candidate and both executions answer the same winner (`resumed: true` for the loser) — the recorded, proven behaviour. |
| PostgreSQL first-open session authority (`Claim Session Authority`, `finmentor_app_session_authority`, second credential node, Data Table upsert by session id) | **REJECT** | New infrastructure; puts a Telegram identity into Supabase (the G5 ledger deliberately never holds one); adds a second credential-bearing node to the most security-critical surface, so the "exactly one credential, on the claim" invariant would have to be weakened in three gates; and it re-opens item 5 of the activation gate, which is recorded as DECIDED (bounded orphan-row design). The harness, the Gateway gate and the resume gate keep the one-credential rule. |
| Save Draft verified persistence (`Read Back Draft` → `Verify Draft Persistence`, 503 `DRAFT_PERSISTENCE_UNCONFIRMED`, error output → 503) | **ACCEPT** | Required invariant. |
| Mark Submitted verified persistence (`Read Back Submitted` → `Verify Submitted Persistence`, 503 `SUBMIT_PERSISTENCE_UNCONFIRMED`) | **ACCEPT** | Required invariant; the retry resolves to the canonical result through the receipt (gated: a Mark Submitted throw and a read-back outage both return 503 and the retry answers `ok:true` without a second Lead Intake call). |
| session security: `SESSION_STORE_UNAVAILABLE` 503 on an unreadable session read; a session id in the query string is `BAD_REQUEST` | **ACCEPT** | |
| Origin allowlist (`finmentor.md` only → `ORIGIN_REFUSED`) | **REJECT** | The Mini App is served by the n8n host workflow at `https://ghennadi.app.n8n.cloud/webhook/finmentor-premium-miniapp` (LIVE, the Concierge's `web_app` URL), so every production request would have been refused. The bearer is the server-minted 32-byte session id; it is never exposed cross-origin. |
| Gateway deploy: retire the two P9-R2 live-only nodes superseded by the candidate's own responder | **ACCEPT WITH ADJUSTMENT** | Codex left `Session Store Verdict` and `Respond Session Unavailable` orphaned; the deploy now removes them and re-attaches `Emit System Alert (Session Store)` to the new responder. |
| DB migration `0004_preproduction_authority` (up/down) | **NOT INTEGRATED** | Both tables were rejected above; there is nothing to apply. Neither migration file is carried on the feature branch. |
| GA4 | — | No GA4 change in the Codex patch. C4 is unchanged. |

### QA

| correction | verdict | why |
|---|---|---|
| `g5-replay-claim` CR normalisation before comment stripping | **ACCEPT** | Real CRLF bug in the gate. |
| `gateway-store-failure-harness`: six respond nodes, session stand-ins | **ACCEPT** (minus the authority node) | |
| `xray-analysis.test.mjs` replaced by a 10-check file | **REJECT** | Coverage regression (the C1 gate had 69 checks). The C1 gate was extended instead: 138 checks, including every fail-closed case, the GET/POST split, token expiry, the publisher's exposure allowlist, and STATIC checks on the built workflow. |
| new gates in `run-all` (`c3-cycle-projection`, `crm-stage-map`, `xray-analysis`) | **ACCEPT** | |
| honest evidence labels | **ACCEPT** in principle | Codex added no documentation at all. This record and the gate headers carry STATIC / SIMULATED / LIVE labels. |

## 3. What the integrated checkpoint contains (all regenerated on an LF tree)

- `n8n/src/xray-analysis/*` — validator (fail-closed contract, flagged figures), failure row, read-only review surface, POST verdict, curated publisher; `scripts/build-xray-analysis-workflow.mjs` and the SDK candidate.
- `n8n/src/crm/stage-map.js`, `n8n/src/lead-alerts/actions.js`, `scripts/lib/inline-crm-stage.mjs`, the four alert deploy scripts.
- `scripts/build-miniapp-gateway.mjs` (30 nodes, one credential, three store gates, persistence gate, one 503 responder), `scripts/build-gateway-store-failure-harness.mjs`, `scripts/deploy-c3-gateway-cycle.mjs` (retires the two superseded nodes).
- `scripts/build-premium-endpoints.mjs` (release-mode placeholder, store outages, draft and submit persistence proofs).
- `scripts/deploy-c3-concierge-cycle.mjs` (per-cycle authority row, rotation-only abort, legacy-soft, `upgradeConcierge`).
- gates: `c3-cycle-projection` 17, `miniapp-gateway` 30, `premium-ux-resume` 24, `gateway-store-failure-harness` 63, `premium-ux-submit-idempotency` 28, `crm-stage-map` 29, `lead-alerts-actions` 56, `g5-replay-claim` 16, `xray-analysis` 138.

## 4. Live state at review time (fresh-read 2026-09-03, not recalled)

| workflow | updated | state |
|---|---|---|
| Concierge `mppzthlkSJFr6Kle` | 11:33Z | carries `Project Cycle` + `Cycle Projection Guard` (first generation, one row per user) — deployed by the previous session |
| Gateway `nTZHLbv2KFggdhh5` | 08-31 | 23 nodes, **no** cycle projection read — the reader was NOT deployed |
| Session `Hxje3Kel6nLLod5B`, Submit `ELiPdw4mdxQbBaan` | 08-31 | owner-only gate live; no persistence proof |
| X-Ray `tNSMRoKlFB52vjge` | 10:51Z | C1 shape (GET promotion, no publisher) |
| Data Tables | 11:17Z | `MiniApp_Cycle_Projection` (4 columns, needs `authority_key` + `cycle_sequence`), `XRay_Client_Results` (8 columns, no writer live) |

The §7 "Resolution" appended to `docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md` in the WIP
checkpoint described the Gateway reader, a completion record and an activation script as done;
none of the three existed live or in the tree. That section is corrected in this checkpoint.

## 5. Where this stops, and why

Every C3 deploy (Concierge upgrade, Gateway, Session + Submit, X-Ray v2, Mini App host) is built,
gated and **dry-run clean against the live tenant** with rollback artefacts. None was written:
in this session the permission classifier refuses the `--confirm` invocations, and the n8n MCP
connector cannot see the production workflows (only the two Data Table columns could be added
through it). The exact commands, expected output, live proofs and rollbacks are in
`docs/C3_OWNER_RUNBOOK.md`. The customer release stays one explicit substitution
(`--release=CUSTOMER`) behind the privacy approval and the C2 owner acceptance.

Product surface added in this checkpoint on the Mini App (`app-premium/`): the CLIENT_READY
result screen (curated fields only, server labels, RU/RO shell strings), the pending note on the
committed screen, and honest copy for `CYCLE_UNRESOLVED` and retryable store outages — executed
through the real client by `qa/premium-ux-result-screen.test.mjs`. The RO questionnaire copy
(branches.js) and the RO Concierge copy are NOT translated here: the content gate binds every
client-visible string to an owner-approved spec, and RO copy needs the same approval first.
