# V1 — REAL 15:26 SUBMISSION FORENSIC AND RETURN-CONTRACT CORRECTION (2026-09-16)

Repair agent: Claude (sole authority for this pass, taking over from a Codex session that stopped
at its usage limit after establishing the committed receipt). Read-only forensic first; one bounded
Lead Intake correction prepared, dry-run against production, **not yet deployed** — the owner runs
`--confirm` and the mandatory fresh RO retest.

Evidence bundle (untracked, sanitised): `.uat/v1-submit-return-contract/forensics/`. Handoff
snapshot of the working tree before this pass: `.uat/fable-handoff-before-repair/`.

---

## 1. 15:26 SUBMISSION STATE

| item | value |
|---|---|
| 15:26 SUBMISSION STATE | **C — DURABLY COMMITTED (merge) BUT RESPONSE CONTRACT FAILED** |
| SUBMISSION ID | `sub_6b35…` (Submission_Receipts row id 31, correlation_id = same key) |
| app_session | `AS-5b8f…`, state `draft`, `draft.step` APP_REVIEW, locale `ro`; never advanced to `submitted`, no client-ack claim |
| receipt | READY 15:26:09.728 → IN_FLIGHT 15:26:12.430 → **COMMITTED 15:26:13.878** (local), `abort_reason` empty |
| LEAD ID | **FIN-1789469658573-427** (Pipeline row created 2026-09-15 13:54 local from the website X-Ray, owner's own IMC GROUP SRL test lead; merge matched by e-mail) |
| LEAD BELONGS TO THIS SUBMISSION | **YES** — `canonical_lead_id` on the receipt for exactly this `submission_key`; Activities row `lead_merged … submission=FIN-…` at 15:26:35.864 |
| DURABLE COMMIT | **YES** |
| MERGE | **YES** (`lead_mode = merged`, priority HOT, zone GREEN) |
| PARTIAL WRITE | **NO** — receipt committed, Pipeline merge update applied, Leads archive row appended, Lead_Answers/Activities rows written, X-Ray ledger row written |
| FALSE CLIENT FAILURE | **YES** |
| DOWNSTREAM BEFORE COMMIT | **NO** — X-Ray ran after `Receipt Commit (Merge)` and after `Save Lead to CRM` |

Lead Intake, Mini App Submit and X-Ray keep no execution payloads (`saveDataSuccessExecution:
none`, `saveDataErrorExecution: none`), so node-level I/O of the three transient executions is not
recoverable. The durable rows, the retained System Alert execution 8383 and the workflow graphs are
sufficient; the error-monitor workflow (`RBiFLhVjizMkAzrK`) has not fired since 2026-09-13 09:41Z,
which proves neither Lead Intake nor X-Ray threw.

### Mini App Submit node trace (from graph + durable rows)

| node | executed | contract | side effect |
|---|---|---|---|
| Submit Guard → Submit State | YES | valid (`draft`, ok:1) | none |
| Write Privacy Acknowledgement → Privacy Verdict | YES | valid | privacy row |
| Receipt Probe / Preallocate / Readback / Receipt Verdict | YES | valid (READY row created 15:26:09.728) | receipt row |
| Build Intake Payload → Call Lead Intake | YES | **output invalid**: the sub-workflow returned a Google Sheets row (`Save Activity`), not `{ok, lead_id, mode, …}` | Lead Intake ran fully and committed |
| Parse Intake Result | YES | `ok` absent → `{ok:0, error_code:"INTAKE_NOT_OK", retryable:false}` | — |
| IF Intake OK → Respond Submit Unresolved | YES | 503 to client → «Solicitarea nu a fost încă trimisă» | — |
| Alert Route (Submit) → Emit System Alert | YES | `verdict_node: Parse Intake Result`, INTAKE_NOT_OK, `occurred_at 15:26:37.471` (execution 8383) | owner alert |
| Mark Submitted / Client Ack | **NO** | — | session stayed `draft` |

## 2. INTAKE_NOT_OK ROOT CAUSE

**Exact cause: the internal Lead Intake sub-workflow returned the output of `Save Activity`
(a Google Sheets append) instead of `Internal Result (Merge)`.**

1. Execute Workflow returns the output of the **last node executed** in the child
   (`packages/core … workflow-execute.ts`, `lastNodeExecuted`).
2. Lead Intake runs with `executionOrder: 'v1'`. In v1 the children of a fan-out are executed
   **depth-first, ordered by canvas position — smallest y first, then smallest x**
   (`nodesToAdd.sort(...)` followed by `nodeExecutionStack.unshift`). Connection order is irrelevant.
3. The 2026-09-16 10:22Z RO UAT correction (`deploy-v1-ro-uat-correction.mjs`, intake version
   `82f2e933`) rewired `IF Committed (Merge)` → `Restore Lead Context (Merged)`, whose fan-out is
   `Explode Answers (y 16)`, `Save Lead to CRM (y 688)`, `IF Escalated (y 1100)`,
   `Build Intake Activity (y 1248)`. The terminal chain
   `Save Lead to CRM → Build C3 Intelligence Request → Run Owner Intelligence (C3) → Route C3 Result Mode → Internal Result (Merge)`
   therefore ran **second**; `Build Intake Activity → Save Activity` ran **last**.
4. Durable timestamps agree: receipt settled 15:26:13.878 → X-Ray failure ledger row 15:26:30.169
   (inside the synchronous C3 call) → Activities `lead_merged` row **15:26:35.864** (`Save Activity`)
   → INTAKE_NOT_OK alert 15:26:37.471.
5. `Parse Intake Result` treats anything without `ok === true` as INTAKE_NOT_OK and
   `retryable === true` as the only retryable form — hence «Retry: невозможен».

The repository's earlier rule "depth beats connection order" (docs/NEW_LEAD_ALERT_POST_SETTLEMENT_
DISPATCH_DESIGN.md, qa/lead-intake-new-lead-alert-routing.test.mjs header) was measured on probe
workflows created without `executionOrder: 'v1'`; legacy v0 is breadth-first, where the deepest node
does finish last. Production Lead Intake is v1. The simulator in
`scripts/lib/v1-submit-return-contract.mjs` encodes the v1 rule and reproduces the incident on the
exact live shape (`qa/v1-submit-return-contract.test.mjs`, DEFECT checks).

**Latent P0 on the NEW path.** The committed NEW internal path has had the identical shape since the
C3 closure cutover (2026-09-15 10:29Z): `Restore Lead Context` fans out to six consumers and
`Build Intake Activity` (y 1248) is again bottom-most. No Mini App NEW-lead submission has been
committed since (all four post-09-15 commits are merges; the C3 closure was verified with a
synthetic no-op only), so it has not fired yet — but every first-time Mini App client would have hit
the same false failure.

**Second, independent false-failure vector.** `Run Owner Intelligence (C3)` waits for X-Ray
(`waitForSubWorkflow: true`, a model call) inside the submit response, and the Mini App client
aborts requests at 20 s (`app-premium/net.js` `TIMEOUT_MS`). The incident response took 23.6 s
with a *failed* model call; a successful analysis is longer. The node also carried no `onError`, so
an X-Ray that could not be started would have failed the already-committed intake.

## 3. XRAY SECONDARY FAILURE

| item | value |
|---|---|
| XRAY SAME SUBMISSION | **YES** — ledger row `XA-FIN-1789469658573-427-MU42RKBD-F`, `request_id = sub_6b35…`, source `telegram_premium`, mode NEW_REQUEST_ANALYSIS |
| input complete | yes (GREEN zone carried; Leads archive row present, paired by request_id) |
| ran before commit | NO |
| XRAY FAILURE ROOT CAUSE | **UPSTREAM_RATE_LIMIT** — OpenAI: «The service is receiving too many requests from you». The same lead's website analysis (`…-MU2K8PXP-F`) exhausted 3 attempts on the same error between 2026-09-15 13:54 and 2026-09-16 09:00 local. This is an account/quota condition, not an input defect. |
| owner copy | «Анализ временно не сформирован … Лид сохранён. Анализ не завершён и будет безопасно повторён.» — emitted by `Analysis Failed Row` / `Telegram Failure Notice` |
| XRAY RETRY ACTUALLY POSSIBLE | **NO (by schedule)** — `Select Pending Leads` retries a failed row only when the lead has **exactly one** ledger row; this lead has two, so the 10-minute sweep never selects it (`ATTEMPT=1 NEXT=15:31:30` is still unchanged). The copy over-promises for multi-row leads. Not changed in this pass (X-Ray methodology is out of scope); recorded as a follow-up. |

## 4. RETRY SAFETY

**MANUAL RETRY SAFE = YES**, from the same Mini App session only. A second «Trimite consultantului»
derives the same `submission_key`; Lead Intake reads the COMMITTED receipt and returns
`Internal Result (Committed Replay)` (a leaf: no Pipeline write, no claim, no C3, no alert), Submit
then marks the session `submitted` and sends the single client acknowledgement.
Expected counts: duplicate lead 0, duplicate submission 0, duplicate owner alert 0, duplicate analysis 0.
Until the correction below is live, a **fresh** session (new cycle) would commit a second merge and
fail the same way — so do not ask the client to start over.

## 5. FIX (prepared, dry-run PASS, NOT deployed)

Smallest bounded change, Lead Intake `QmIyEW2ZEqKregmN` only, **four nodes, zero connection
changes**, no CRM/scoring/X-Ray/locale/website/schedule/credential/webhook/privacy change:

| node | change | why |
|---|---|---|
| `Save Lead to CRM`, `Build C3 Intelligence Request`, `Run Owner Intelligence (C3)`, `Route C3 Result Mode` | moved down one row: y 688 → **1424** (bottom-most sibling is at 1248) | under the v1 rule the terminal chain is now the **last** branch on both restorers, so `Internal Result (Merge/New)` is the last node executed |
| `Run Owner Intelligence (C3)` | `waitForSubWorkflow: false` | the committed answer no longer waits for a model call (client aborts at 20 s); X-Ray still starts after commit and after the Leads archive write |
| `Run Owner Intelligence (C3)` | `onError: continueRegularOutput` | an X-Ray that cannot be started is an item, never a failed committed intake |

Files:
- `scripts/lib/v1-submit-return-contract.mjs` — pure patcher, structural contract, v1 order simulator
- `scripts/deploy-v1-submit-return-contract.mjs` — `--dry-run` / `--confirm` / `--verify`, pinned to live version `82f2e933`, exact-delta and protected-authority assertions, rollback on read-back mismatch
- `qa/v1-submit-return-contract.test.mjs` — 15 checks (rule, defect reproduction, correction, drift refusals); wired into `qa/run-all.mjs`, baseline raised 3524 → 3539
- dry-run artifacts: `.uat/v1-submit-return-contract/dry-2026-09-16T13-07-35-440Z/` (pre + candidate)

Dry-run against production (2026-09-16 16:07 local): live == accepted `82f2e933`; defect reproduced
on the live shape for all three internal scenarios; candidate delta exactly the four nodes; v1 order
ends at `Internal Result (Merge)` / `Internal Result (New)`; zero writes.

QA = 97/97 gates, 3,539 assertions, floors PASS (Codex's uncommitted P0 new-request-context work
included; see §7).

### 5.1 Deployment record (added after owner authorisation, same day)

- 16:13 local — first `--confirm`: PUT accepted, but the byte-exact read-back comparison failed
  because n8n now re-serialises node objects with a different key order (identical length,
  canonically identical, 91/112 nodes byte-different). The script rolled production back to the
  pre shape (content-identical; versionId re-stamped `33817470`). Comparisons were made canonical.
- 16:16 local — second `--confirm`: **deployed as version `108640f1-654e-4258-8e47-678398a12f77`**,
  read back canonically equal to the candidate; `--verify` PASS; post-deploy `--dry-run` reports
  `POST-DEPLOY PENDING DELTA = 0`. Artifacts: `.uat/v1-submit-return-contract/deploy-2026-09-16T13-16-40-466Z/`.
- Follow-up closure record: `docs/V1_FINAL_PRODUCTION_REPAIR_2026-09-16.md`.

## 6. WHAT THE OWNER RUNS

```
node scripts/deploy-v1-submit-return-contract.mjs --dry-run
node scripts/deploy-v1-submit-return-contract.mjs --confirm
node scripts/deploy-v1-submit-return-contract.mjs --verify
```

Then ONE fresh signed RO Mini App submission (phone): Deschideți o solicitare nouă → Descrieți
solicitarea → Deschideți sinteza → complete → Trimite consultantului. Expected:
submit PASS within a few seconds; Submission_Receipts +1 COMMITTED (merged, same Telegram user);
client acknowledgement exactly 1; owner rich alert exactly 1 only if X-Ray succeeds;
X-Ray: **may still fail with UPSTREAM_RATE_LIMIT** — that is the OpenAI quota condition above and
is independent of the submit contract. Read-only trace: `TRACE_START/TRACE_END/TRACE_LABEL` with
`node .uat/v1-miniapp-e2e/read-real-0743-trace.mjs`.

For the 15:26 client: same session, tap «Trimite consultantului» once more after the cutover →
Committed Replay → acknowledgement. No new lead, no new alert.

## 7. HANDOFF STATE OF THE WORKING TREE (Codex → Claude)

Uncommitted at takeover (snapshot: `.uat/fable-handoff-before-repair/tracked-changes.patch`,
sha256 `23ca9290…`):

| change | classification |
|---|---|
| `n8n/src/premium-ux/context-extraction.js`, `scripts/build-premium-concierge.mjs`, `n8n/candidate/premium-concierge-candidate.json`, 7 `qa/*` files, `qa/assertion-baseline.json` (3521 → 3524) | **relevant to the earlier P0 (free text → company_name), correct, complete**: Codex reported 96/96 gates and deployed it to Concierge `mppzthlkSJFr6Kle` at 14:12 local (`.uat/p0-new-request-context/deploy-…/…post.json`; live version `5cfe9515` matches). Re-run here: green. Unrelated to the 15:26 incident. Left uncommitted for the owner's commit. |
| `scripts/deploy-p0-new-request-context.mjs` (untracked) | the guarded one-node deploy script for the above; keep |
| `FINMENTOR_GATE6_FINAL/` (untracked, 372 MB nested git clone at `e805e67`) | **unrelated** website snapshot; not copied, listed in the snapshot; leave for the owner to decide |

Nothing was reset, stashed, discarded or committed.

## 8. FINAL

```
15:26 SUBMISSION STATE = C — DURABLY COMMITTED (merged) BUT RESPONSE CONTRACT FAILED
SUBMISSION ID = sub_6b35…  (receipt id 31)
LEAD ID = FIN-1789469658573-427
LEAD BELONGS TO THIS SUBMISSION = YES
DURABLE COMMIT = YES
MERGE = YES
PARTIAL WRITE = NO
INTAKE_NOT_OK ROOT CAUSE = Execute Workflow returned the LAST node executed; under executionOrder v1 (depth-first by canvas y) the 10:22Z Merge rewire made Save Activity (Google Sheets row) the last node, not Internal Result (Merge)
FALSE CLIENT FAILURE = YES
DOWNSTREAM BEFORE COMMIT = NO
XRAY SAME SUBMISSION = YES
XRAY FAILURE ROOT CAUSE = OpenAI UPSTREAM_RATE_LIMIT ("too many requests from you"), recurring since 2026-09-15
XRAY RETRY ACTUALLY POSSIBLE = NO by schedule (lead has two ledger rows; sweep retries single-row leads only)
MANUAL RETRY SAFE = YES (same Mini App session → Committed Replay; 0 duplicates)
FIX APPLIED = PREPARED, dry-run PASS, awaiting owner --confirm (4 Lead Intake nodes, 0 connections)
QA = 97/97 gates, 3,539 assertions, floors PASS
FRESH RO SIGNED UAT: not run (requires the owner's Telegram session after --confirm)
FINAL = BLOCKED — (1) owner --confirm + fresh RO submission pending; (2) X-Ray OpenAI rate limit unresolved, and multi-row leads are never retried by the sweep
```
