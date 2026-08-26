# FINMENTOR — Night Shift Final Regression (N8)

Verification only. **No code or documentation was modified in N8** beyond adding this record.
No regression was found, so nothing was fixed.

| | |
|---|---|
| Date | 2026-08-26 |
| Branch | `hardening/post-remediation-night-2026-08-25` |
| **Verified at HEAD** | **`7ad8ba8`** (N7 — post-remediation hygiene review) |
| Ahead of `main` | 9 commits, 24 files, +6004 / −35 |
| Result | **PASS** |

---

## 1. Gates

`node qa/run-all.mjs` → **8/8 PASS**, exit 0.

| # | Gate | Floor | Actual |
|---|---|---|---|
| 1 | Command Center authorisation | 43 | 43 |
| 2 | Lead Intake trust boundary | 43 | 43 |
| 3 | AI safe projection | 52 | 52 |
| 4 | Error Monitor alert | 22 | 22 |
| 5 | Website contract | 75 | 75 |
| 6 | n8n export hygiene | 70 | 70 |
| 7 | Mini App read-model consistency | 42 | 42 |
| 8 | Mini App consent and submit | 113 | 113 |
| | **Total** | **460** | **460** |

Per-gate floors (`qa/assertion-baseline.json`) **PASS**. No gate count fell; no floor fell.

Run directly: `qa/miniapp-submit.test.mjs` **113/113**, `qa/miniapp-readmodel.test.mjs`
**42/42**, both exit 0.

**cwd-independence** — suite run from `/` by absolute path (the CI method): 8/8, 460, floors
PASS, exit 0.

---

## 2. Syntax, parse, secrets

| Check | Result |
|---|---|
| `node --check` over `qa/`, `scripts/`, `gateway/`, `n8n/src/`, root JS | **42 files, zero errors** |
| PowerShell `Parser::ParseFile` over `scripts/*.ps1` | **14 files, zero errors** |
| `node scripts/secret-scan.mjs` | **PASS** — 206 tracked text files, 5 patterns |

Secret-scan patterns: Telegram bot token, OpenAI key, Google API key, PRIVATE KEY block, n8n
JWT. One allowlisted literal — `TEST_ONLY_TOKEN_NOT_A_REAL_SECRET`, the HMAC test vector,
matched as a whole-line substring so it cannot widen into a general exemption.

Supplementary targeted sweep (paths and types only; no values printed, none found):
GA4 `api_secret` assignments **0**; generic long secret-shaped assignments **0**;
AWS / Slack / GitHub token shapes **0**.

---

## 3. Security mutation checks

Each control was deliberately broken, the gate re-run, and the file restored. Every mutation
was caught, and the suite returned to 8/8 / 460 afterwards.

| # | Control | Mutation | Gate result |
|---|---|---|---|
| X1 | request_id **corroboration** | match on bare `request_id` without identity corroboration | 3 checks fail |
| X2 | caller `lead_id` trust | `provenanceTrusted` forced `true` | 7 checks fail |
| X3 | `mode` off TB-1 | `mode` restored to `CLIENT_RESPONSE_FIELDS` | 3 checks fail |
| X4 | Bot_Sessions schema precondition | preflight stops failing closed on absent columns | 3 checks fail |
| X5 | stale cycle handoff (G2) | pre-handoff cycle re-check removed | 4 checks fail |
| X6 | complete mirror publish | one projection field omitted from the published row | 9 checks fail |
| X7 | stored-row verification (INDP2-09 class) | verify the **intended payload** instead of the **stored row** | 2 checks fail |
| X8 | gate ratchet | one assertion traded between two gates, **total held at 460** | run-all exits 1: `miniapp-submit.test.mjs: 113 < 114` |

X8 is the check that a total-only floor cannot make: the reported total was still 460 and the
run failed anyway.

No test was weakened, rewritten or removed. `ALLOWED_LITERALS` was not widened. Working tree
verified clean after the harness.

---

## 4. Current-state invariants

| Invariant | Verified |
|---|---|
| GA4 runtime Measurement ID | `G-94L9B8WZ12` is the **only** one in any tracked html/js/json/xml/txt. Obsolete `G-94L98WZ12`: **0 runtime hits** |
| `mode` cannot reach the client | `CLIENT_RESPONSE_FIELDS` = `ok, lead_id, priority, financial_zone, submit_state`; `buildSubmitSuccess` emits no `mode`; `mode` **and** `lead_mode` in `RESPONSE_FORBIDDEN_KEYS`; `responseLeaks({mode})` → `["mode"]` |
| Reconciliation semantics | runtime exports `planReconciliation` only (legacy `reconcile` gone), returns `repair_performed: false` with an explicit zero-write block for both stores; gate asserts it; current docs describe a classifier |
| No false closure | No canonical document claims G1 or G5 is closed. (Threat model §4 *"G1 closed first"* is a canary **precondition**, not a status claim.) |

### Activation — **B.2.1-C IS NOT CLEARED**

| Blocker | State |
|---|---|
| **G1** — durable idempotency backing store / recovery adapter | **OPEN — the activation blocker** |
| **G5** — durable `initData` replay / single-use state | **OPEN** — DESIGN-ONLY, G1 infrastructure family; not closed on spec-only validation |
| **Bot_Sessions schema** — `lead_mode`, `lead_priority`, `financial_zone` | **OPEN — unmet deployment precondition**; live sheet untouched, preflight fails closed |
| **Live canaries L1–L15** | **15 UNEXECUTED** |

---

## 5. Git integrity

Working tree **clean**; `git diff` empty; HEAD unchanged at `7ad8ba8` throughout verification,
including after the mutation harness.

Unexpected-file check: **none found** — no binaries added versus `main`, no `node_modules`, no
lockfiles, no temp/editor/backup files, no unexpected artefacts. The largest tracked files are
the three pre-existing ZIP archives and the QA screenshots, all classified in
`docs/FINMENTOR_POST_REMEDIATION_HYGIENE.md` and unchanged by this branch.

---

## 6. Production safety

N8 was repository-only.

| Surface | Change |
|---|---|
| n8n | **NONE** |
| Google Sheets | **NONE** |
| Telegram | **NONE** |
| GA4 | **NONE** |
| DNS | **NONE** |
| Cloudflare | **NONE** |
| Production webhook calls | **NONE** |
| `main` | **NONE** |

No Mini App activation. No live canary started. No PR opened.
