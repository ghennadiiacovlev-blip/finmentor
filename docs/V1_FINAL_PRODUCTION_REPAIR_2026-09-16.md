# V1 — FINAL PRODUCTION REPAIR RECORD (2026-09-16)

Closure of the 15:26 false-failure incident (forensic: `docs/V1_SUBMIT_RETURN_CONTRACT_INCIDENT_2026-09-16.md`)
plus the two corrections it exposed, deployed to production the same day under owner authorisation.
Repair agent: Claude (sole authority for the pass, continuing the accepted forensic result).

## 1. What changed in production

| workflow | version before → after | delta | proof |
|---|---|---|---|
| Lead Intake `QmIyEW2ZEqKregmN` | `82f2e933` (re-stamped `33817470` by the rolled-back first attempt) → **`108640f1-654e-4258-8e47-678398a12f77`** at 16:16 local | 4 nodes: `Save Lead to CRM`, `Build C3 Intelligence Request`, `Run Owner Intelligence (C3)`, `Route C3 Result Mode` moved from y 688 to y 1424 (below the bottom-most sibling y 1248); `Run Owner Intelligence (C3)` `waitForSubWorkflow:false`, `onError:continueRegularOutput`. **0 connection changes**, credentials/webhooks/settings unchanged. | `scripts/deploy-v1-submit-return-contract.mjs --verify` PASS; post-deploy `--dry-run` → PENDING DELTA = 0; artifacts `.uat/v1-submit-return-contract/deploy-2026-09-16T13-16-40-466Z/` |
| X-Ray Analysis `tNSMRoKlFB52vjge` | `8d1bdc66` → **`bd40bf86-cc0d-4efc-b0a3-b48c6c0e2f58`** at 16:31 local | `parameters.jsCode` of `Select Pending Leads`, `Analysis Failed Row`, `Validate + Store Rows` replaced from tracked sources. Graph, credentials, schedule (`0,30 8-19 * * 1-5`), OpenAI node (model expression, `maxTries 2`, `waitBetweenTries 3000`), Sheets nodes unchanged. | `scripts/deploy-v1-xray-retry-contract.mjs --verify` PASS; post-deploy `--dry-run` → PENDING DELTA = 0; artifacts `.uat/v1-xray-retry-contract/deploy-2026-09-16T13-31-13-656Z/` |
| X-Ray Analysis `tNSMRoKlFB52vjge` (second pass) | `bd40bf86` → **`33358ab5-aa92-4112-a8b5-ac157c035562`** at 17:13 local | `parameters.jsCode` of `Analysis Failed Row`, `Validate + Store Rows`, `Build Analysis Input` (see §3a: output↔input pairing and legacy-retry pairing). Everything else identical to the accepted baseline. | `--verify` PASS; post-deploy `--dry-run` → PENDING DELTA = 0; artifacts `.uat/v1-xray-retry-contract/deploy-2026-09-16T14-13-36-784Z/` |
| Concierge `mppzthlkSJFr6Kle` | `5cfe9515` (14:12 local, earlier Codex pass) | free text → `company_name` P0 correction; unchanged in this pass | live == `.uat/p0-new-request-context/deploy-…/…post.json`; now reconciled into the repository |

Note on the first Lead Intake attempt (16:13 local): the PUT succeeded, but the byte-exact read-back
check failed because n8n now returns node objects with a different key order (identical length,
canonically identical, 91/112 nodes byte-different). The script rolled production back to the
content-identical pre shape before any second write; all comparisons were then made canonical
(recursively sorted keys). No partial state existed at any point.

## 2. X-Ray rate limit — exact evidence

| item | value |
|---|---|
| persisted message | `The service is receiving too many requests from you` — n8n's canonical text for **HTTP 429** from the provider (NodeApiError status-code map). Only `error.message` reaches a Code node from the OpenAI node's error output, so the provider's `error.type` (`insufficient_quota` vs `rate_limit_exceeded`) and `Retry-After` are **not persisted** anywhere; the three affected workflows keep no execution payloads. |
| model | `gpt-4.1` (X-Ray, `xray_ai_model`), `gpt-4.1-mini` (Lead Intake AI Work Plan) |
| attempt pattern | X-Ray: `maxTries 2 / 3000 ms` per node run; ledger retries bounded at 3 (5 min, then 30 min). Lead Intake AI Work Plan: one run per lead. |
| last successful model call | 2026-09-09 17:51Z (`XA-FIN-1788975761278-284`, CLIENT_READY) |
| failures since | 2026-09-13 09:51Z, 09-14 04:31Z (X-Ray) and 04:31Z (Lead Intake, different workflow, different model), 09-14 04:41Z, 09-15 11:00Z / 13:54 local (Lead Intake `ai_failed` 10:54:45Z + X-Ray 11:00:11Z), 09-16 05:00Z, 09-16 06:00Z (attempt 2), 09:00Z (attempt 3, exhausted), 12:26Z (incident) — **every** model call for 3.5 days, single isolated requests, hours apart, two workflows, two models, including at 05:00Z with no other load. |
| burst-correlated | **NO** — no two model calls within the same minute anywhere in the evidence window; the sweep runs at most 3 leads per tick at :00/:30 on weekdays; concurrency is 1 (each request is one node run). |
| classification | **A — account/project capacity or billing (provider `insufficient_quota`, HTTP 429)**. B/C/D/E are excluded by the isolated cadence and the two-workflow/two-model spread; F is excluded because both models fail identically; the same request shapes succeeded on 09-09. |
| resolved | **NO — OWNER ACTION REQUIRED**. Nothing workflow-side is causing it and the model/provider/credential must not be changed automatically. |

**Exact owner action:** open the OpenAI platform for the project whose API key is stored in the n8n
OpenAI credential used by `AI X-Ray Analysis` / `AI Client Work Plan` → *Settings → Billing / Usage*
and restore capacity (add credit / raise the monthly budget limit / re-enable auto-recharge, or the
per-project usage limit if one is set). Then run one sweep tick or one fresh request; the ledger row
for the 15:26 request (`XA-FIN-1789469658573-427-MU42RKBD-F`, ATTEMPT=1) is now selectable by the
corrected sweep and will retry on the next weekday tick at :00/:30 (08–19 local), bounded at three
attempts.

## 3. X-Ray retry contract — what was wrong and what is live now

Retry authority before: `Select Pending Leads` retried a failed row only when the canonical lead
had exactly ONE ledger row. Any lead with history (a published website analysis, an exhausted
failure) never had its newest failed request retried, while `Analysis Failed Row` told the owner
«Анализ не завершён и будет безопасно повторён». The 15:26 lead has two rows.

Retry authority now (`n8n/src/xray-analysis/select-pending.js`):
- the lead's **newest ledger row** (by `created_at`) is the current request; it is retried when it is a
  due, bounded (`ATTEMPT < 3`, `NEXT` reached) `ANALYSIS_FAILED` row and **no successful row exists
  for the same `request_id`**;
- the retry carries the failed row's own `request_id`, so `Build Analysis Input` pairs the exact
  archived Raw JSON of that submission (never the canonical lead's older answers);
- older rows — earlier requests, published successes, exhausted failures — never block and are never
  reprocessed; two rows sharing the newest `created_at` fail closed; one retry per lead per tick;
  retries update the same `analysis_id` in place (`appendOrUpdate` on `analysis_id`), never a second
  success row; retries never re-alert the owner (`notify_owner:false`); exhaustion emits the
  `XRAY_RETRY_EXHAUSTED` System Alert (class C) as before.
- Owner copy derives from the truth the ledger writer computes (`retry_possible = !retry_exhausted`,
  `analysis-failed.js`, `validate-analysis.js`, `owner-cards.js renderFailed`): a retry is promised only
  while one is possible; otherwise the approved wording «Безопасные повторы завершены. Команда
  получила техническое уведомление.» is used. The technical cause stays in the ledger and the
  System Alert.

Historical evidence is untouched: no receipt, Leads, Pipeline, XRay_Analysis, Activities row or
System Alert was edited or deleted.

### 3a. Second defect, surfaced by the first corrected sweep (17:00 local) and fixed the same hour

The 17:00 sweep selected two retries: the legacy concierge lead `TG-1636472252-1789130138995`
(newest failed row `…-MU3MTQ8J-F`) and the 15:26 request. The legacy retry became an audit
finding (`REQUEST_ID_NOT_FOUND`: its `C-…` cycle id is not archived as a request), so only the
15:26 request reached the model, which returned 429. Both ledger writers paired model outputs with
`Build Analysis Input` items **by raw index across all items**, including the audit finding that
never reached the model — so the 15:26 request's failure was written under the legacy lead as a
fresh row `XA-TG-…-MU46477P-F` (model, company, source empty, ATTEMPT=1), and the 15:26 row stayed
at ATTEMPT=1. The same misattribution had already happened once under the old code at 08:00 local
(`…-MU3MTQ8J-F` carried FIN-1789469658573-427's 429). Left alone, every 30-minute tick would have
repeated it: a duplicate failed row on the wrong lead and a request that never advances.

Correction (X-Ray version `33358ab5`, three Code bodies, no graph change):
- `Analysis Failed Row` and `Validate + Store Rows` resolve each model output to its producer through
  n8n `pairedItem` into the model node's own input list (audit findings excluded); raw index is only
  the fallback when `pairedItem` is absent (offline harnesses). A batch split between success and
  error branches is therefore attributed correctly too.
- `Build Analysis Input`: a retry keeps request-scoped pairing when the request is a Mini App
  submission (`sub_…`, fail-closed if its archived row is missing) or when its `request_id`
  resolves; a legacy failed row (concierge `C-…`, pre-archiving website) pairs by `lead_id` as it
  always did, so it is analysed (and bounded at three attempts) instead of producing an owner audit
  message on every sweep for ever.

Gate: `qa/v1-xray-retry-contract.test.mjs` now 19 checks (misattribution reproduced and refused,
pairedItem honoured on split batches, legacy vs submission retry pairing). The misattributed rows
`XA-TG-…-MU3MTQ8J-F` / `-MU46477P-F` are left in place as evidence; they are ANALYSIS_FAILED rows of
a lead whose newest row will be retried and bounded like any other.

## 4. QA

| gate | checks |
|---|---|
| `qa/v1-submit-return-contract.test.mjs` (new) | 22 — v1 rule; defect reproduced on the accepted shape (Save Activity last); corrected shape terminal-last in merged/escalated/new; four-node bounded delta; detached, tolerant, single X-Ray dispatch; NEW and MERGED terminal items parse to submit success through the real `Parse Intake Result`; a Save Activity sheet row parses to INTAKE_NOT_OK and is never last; routing independent of the model result; committed replay reaches no write (no duplicate lead); canvas-move regression detector |
| `qa/v1-xray-retry-contract.test.mjs` (new) | 19 — legacy rule reproduced; output↔input pairing (§3a) reproduced and refused; legacy vs submission retry pairing; multi-row lead retries the exact newest failed request with its own `request_id`; exhausted/published rows never selected; same-request success ends retries; newest success wins; bounded at attempt 3; NEXT respected; ambiguity fails closed; unrelated historic request never selected; single-row behaviour unchanged; retry does not re-alert; copy ↔ `retry_possible`/`retry_exhausted` truth; validation path carries the same truth; patcher exact and idempotent |
| existing | Concierge free-text→company gates (Codex pass) green; RO/RU presentation, X-Ray engine (219), owner cards golden (27), launch-blocker (19), RO UAT (11), System Alert (44) unchanged and green |

Full suite: **98/98 gates, 3,565 assertions, floors PASS** (baseline raised 3524 → 3565).
Generated artifacts rebuilt and reproduced byte-for-byte: `n8n/candidate/xray-analysis-workflow.sdk.js`,
`n8n/candidate/premium-concierge-candidate.json`. `git diff --check` PASS; secret scan of changed and
untracked files PASS.

## 5. Repository reconciliation

One commit carries: (A) the already-live Concierge free-text→company correction (Codex, 14:12
local) with its deploy script; (B) the Lead Intake return-contract correction (lib, deploy script,
gate); (C) the X-Ray retry-contract correction (sources, rebuilt candidate, lib, deploy script,
gate); (D) `qa/run-all.mjs` + baseline; (E) this record and the incident report.
`FINMENTOR_GATE6_FINAL/` (unrelated nested clone) is neither tracked nor modified.
Handoff snapshot of the pre-repair working tree: `.uat/fable-handoff-before-repair/` (untracked).

## 6. What remains

1. **OpenAI capacity** — owner action above. Until restored every X-Ray and AI Work Plan call fails
   with HTTP 429; the submit path is now independent of it (client success, receipt, alerts), and
   failed requests are retried automatically and boundedly once capacity returns.
2. **Owner signed UAT** — no authenticated Telegram session is available to this agent. One fresh
   Romanian request: RO Telegram → RO Mini App → «Trimite consultantului» → immediate success →
   client acknowledgement → one rich owner alert → successful X-Ray → «📋 Бриф к встрече».
   Expected timing: submit answer in a few seconds (no model call in the response path).
3. **The 15:26 client** — same Mini App session, tap «Trimite consultantului» once more → committed
   replay → acknowledgement; no new lead, no new alert.
