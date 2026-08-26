# FINMENTOR — Post-Remediation Repository Hygiene Review

Date: 2026-08-26
Scope: **N7 — repository only.** No n8n, Sheets, production webhook, Telegram, GA4, DNS or
Cloudflare surface was accessed. No Mini App was activated. `main` was not modified and no PR
was opened.
Branch: `hardening/post-remediation-night-2026-08-25`
Reviewed at: `2b26b6a`
Files reviewed: **240 tracked** (plus a check for untracked debris — there is none).

---

## 0. How to read this document

The default action is **classify and document**, not delete. Nothing was deleted in N7.

Historical material is not a defect merely because it records old state. This repository's
audit trail is load-bearing: rewriting past reports so they appear to have always known the
final answer would destroy the explanation of *why* each correction was needed. So historical
files are labelled, and — where a stale line could be mistaken for live guidance — given a
banner that says so, with the body left intact underneath.

Runtime code outranks prose. Where a document and the code disagree, the code is correct and
the document is the finding.

| Category | Meaning | Count |
|---|---|---|
| **KEEP** | Correct as it stands, or intentionally historical and correctly labelled | 218 |
| **ARCHIVE** | Historical/point-in-time; retained deliberately, must never be deployed or cited as current | 17 |
| **DELETE_CANDIDATE** | Debris whose removal is provably harmless | **0** |
| **FIX_REFERENCE** | A current document carried a stale or ambiguous reference; corrected in N7 | 4 |
| **SECURITY_FIX** | A security weakness needing repair | **0** |
| **TEST_FIX** | A gate defect or coverage weakness | **0** |

Five files were modified. Four are `FIX_REFERENCE`; the fifth is an `ARCHIVE` banner.

---

## 1. Findings

### 1.1 FIX_REFERENCE — `docs/FINMENTOR_CI_QUALITY_GATE.md`

| Field | Value |
|---|---|
| **PATH** | `docs/FINMENTOR_CI_QUALITY_GATE.md` (§1) |
| **CATEGORY** | FIX_REFERENCE |
| **WHY** | The sentence "None of them runs **the eight gates** … Every one of **those 340 assertions** was run by hand" bound a current subject to a historical number. 340 was the count at the 2026-08-25 remediation merge; the eight gates now carry **460**. A reader taking the current gate table and this sentence together got two different totals from the same canonical document. |
| **RUNTIME IMPACT** | None. Prose only; the enforced numbers live in `qa/assertion-baseline.json` and the workflow's `ASSERTION_BASELINE`, both already at 460. |
| **HISTORICAL VALUE** | High — the point of the paragraph is that the remediation merge carried no mandatory status check, and "340, by hand" is the evidence for it. The number had to be kept, not replaced. |
| **ACTION RECOMMENDED** | Keep 340, mark it explicitly as the figure *at that merge*, and point to the current source of truth. Done. |
| **SAFE TO DO NOW?** | Yes — repository-only, no behaviour touched. **Done in N7.** |
| **OWNER/LIVE DEPENDENCY?** | None. |

### 1.2 FIX_REFERENCE — `docs/PHASE_B2_PREMIUM_MINIAPP_SPEC.md`

| Field | Value |
|---|---|
| **PATH** | `docs/PHASE_B2_PREMIUM_MINIAPP_SPEC.md` (§ consent/confirmation) |
| **CATEGORY** | FIX_REFERENCE |
| **WHY** | "If backend returns merge mode, client experience should still be one clean confirmation" presumes the backend returns `mode` to the client. Since N6.2 it does not: `mode` is out of `CLIENT_RESPONSE_FIELDS` and is actively refused by `responseLeaks`. Left alone, this is the one remaining document that implies merge status still reaches the browser. |
| **RUNTIME IMPACT** | None — the runtime already enforces the stricter rule, proven by 6 dedicated gate checks. The risk was a future implementer reading the spec and reinstating the field. |
| **HISTORICAL VALUE** | Moderate — it records the original intent, which the owner decision then strengthened rather than reversed. |
| **ACTION RECOMMENDED** | Add a scoped "superseded in part" note; leave the requirement, which still holds. Done. |
| **SAFE TO DO NOW?** | Yes. **Done in N7.** |
| **OWNER/LIVE DEPENDENCY?** | None — the owner decision is already recorded and implemented. |

### 1.3 FIX_REFERENCE — `docs/PHASE_B2_1C_THREAT_MODEL.md` §2

| Field | Value |
|---|---|
| **PATH** | `docs/PHASE_B2_1C_THREAT_MODEL.md` (§2 header) |
| **CATEGORY** | FIX_REFERENCE |
| **WHY** | §3's gap table already carried a "superseded, read as history" notice; §2's forty threat rows did not. Two rows quote code that no longer exists: **T40**'s `STATUS` quotes the pre-N6.1 `return { resolved: false, unresolved: true }` fall-through, now a distinct `blocked: true` / `PRE_ACTIVATION_BLOCKED` branch; **T37**'s `CURRENT CONTROL` names `reconcile()` and `repaired: false`, both renamed in N6.1. Each has an adjacent `AMENDED (N6.1)` bullet, so neither is unguarded — but nothing told a reader that convention existed. |
| **RUNTIME IMPACT** | None. The code is correct; the rows are the finding. |
| **HISTORICAL VALUE** | High. Rewriting the rows would have been the wrong fix — it would make the document read as though it always knew, which is exactly what rule 2 forbids. |
| **ACTION RECOMMENDED** | Add a reading notice at §2 naming the convention, stating that §4.1–§4.3 are authoritative, and flagging T37 and T40 by name. Rows untouched. Done. |
| **SAFE TO DO NOW?** | Yes. **Done in N7.** |
| **OWNER/LIVE DEPENDENCY?** | None. |

### 1.4 FIX_REFERENCE — `scripts/n8n-lib.ps1`

| Field | Value |
|---|---|
| **PATH** | `scripts/n8n-lib.ps1` (header) — governs every PowerShell script in `scripts/` |
| **CATEGORY** | FIX_REFERENCE |
| **WHY** | The library documents `N8N_API_KEY` and `N8N_FIX_API_KEY` as live credentials. Both are scheduled for **revocation** (audit report, OWNER ACTIONS REQUIRED item 6), and nothing in `scripts/` said so. The failure mode is specific: a revoked key returns an ordinary HTTP 401, indistinguishable here from a key that was never set, so an operator would debug the wrong thing — or, worse, reinstate an old key to make a script run. |
| **RUNTIME IMPACT** | None in this repository — nothing in the offline gates touches n8n. Impact is on **future live work**: the B.2.1-C canaries all need tenant access. |
| **HISTORICAL VALUE** | None; this is operational documentation, not evidence. |
| **ACTION RECOMMENDED** | Header note: both keys are scheduled for revocation, a 401 should be read as revocation first, and future live work needs **fresh** narrowly-scoped credentials issued at that time and revoked after — never an old key reinstated. Done. |
| **SAFE TO DO NOW?** | Yes — comment only, no executable line changed. **Done in N7.** |
| **OWNER/LIVE DEPENDENCY?** | **Yes, owner.** The revocation itself is an owner action and remains outstanding. Issuing fresh credentials is an owner action too. |

### 1.5 ARCHIVE (banner added) — `docs/FINMENTOR_AUDIT_REMEDIATION_REPORT_2026-08-25.md`

| Field | Value |
|---|---|
| **PATH** | `docs/FINMENTOR_AUDIT_REMEDIATION_REPORT_2026-08-25.md` |
| **CATEGORY** | ARCHIVE |
| **WHY** | Genuine historical evidence — and the only stale file that could actually cause harm if acted on. It states "**7/7 gates, 340 assertions**" and carries a merge recommendation reading "**Merge remediation branch to `main` — CONDITIONAL GO — owner's call**". That recommendation was made against the 2026-08-25 tree and **predates all of B.2.1-C**. Read today it looks like standing approval to merge, when B.2.1-C is NOT CLEARED. |
| **RUNTIME IMPACT** | None directly — but a merge decision taken on it would be taken on stale evidence, which is the highest-consequence hygiene risk found in this review. |
| **HISTORICAL VALUE** | **Very high.** It is the primary record of the P0/P1/P2/P3 closures and the live-verified evidence behind them. Not rewritable. |
| **ACTION RECOMMENDED** | Body left **completely unedited**. A banner above it marks the file historical, names the two stale-as-guidance lines (gate/assertion counts; the CONDITIONAL GO), states the current counts and the NOT CLEARED verdict, and notes that OWNER ACTIONS REQUIRED item 6 is still live. Done. |
| **SAFE TO DO NOW?** | Yes — additive banner only, permitted precisely because it prevents misuse. **Done in N7.** |
| **OWNER/LIVE DEPENDENCY?** | **Yes.** The merge decision and the key revocation are the owner's. |

---

## 2. Classified, unchanged

### 2.1 The seventeen `(n).html` root files — **KEEP**

`cases (13).html`, `cases (5).html`, `cases (6).html`, `cash-flow (9).html`, `index (11).html`,
`index (3).html`, `methodology (14).html`, `methodology (6).html`, `methodology (7).html`,
`privacy (15).html`, `privacy (7).html`, `privacy (8).html`, `questionnaire (12).html`,
`questionnaire (4).html`, `questionnaire (5).html`, `working-capital (4).html`,
`working-capital-scan (2).html`

| Field | Value |
|---|---|
| **CATEGORY** | KEEP |
| **WHY** | They look exactly like browser-download debris, which is why they are documented here: they are not. They are **live legacy alias URLs**, deliberately retained and marked `noindex,follow` by `scripts/noindex-legacy-aliases.mjs` (INDP3-01). Every one of the seventeen carries the `noindex` tag; none of their canonical counterparts does. The script's own header states the reasoning: *"They are NOT deleted. Any of them may still have live inbound links, and deleting would turn those into 404s."* |
| **RUNTIME IMPACT** | Live at HTTP 200, absent from `sitemap.xml`, unreferenced by any `href` in the tree. Deleting them would 404 any inbound link — a real SEO and user-facing regression. |
| **HISTORICAL VALUE** | Low as documents; high as URLs. |
| **ACTION RECOMMENDED** | **Do not delete.** Recorded here because no document previously explained them, and their filenames invite exactly the wrong conclusion. |
| **SAFE TO DO NOW?** | N/A — no action. |
| **OWNER/LIVE DEPENDENCY?** | Removal would be a live SEO decision, not a repository one. |

### 2.2 Obsolete GA4 measurement ID — **KEEP (0 runtime hits)**

The obsolete `G-94L98WZ12` (production is `G-94L9B8WZ12`, note the `B`) appears **nowhere in
runtime code** — verified across every tracked `.html`, `.js`, `.json`, `.txt` and `.xml`.

| Location | Kind | Category |
|---|---|---|
| `CHANGELOG_FINANCIAL_RENTGEN_MOBILE_MENU.md` | historical evidence | KEEP |
| `FINMENTOR_CAMPAIGN_READY_REPORT.md` | historical evidence | KEEP |
| `FINMENTOR_UPDATE_REPORT.md` | historical evidence | KEEP |
| `QUESTIONNAIRE_WEBHOOK_READY_REPORT.md` | historical evidence | KEEP |
| `ARCHIVES_LEGACY_NOTICE.md` | the notice that classifies all of the above | KEEP |
| `qa/website-contract.test.mjs:360` | **the guard** — asserts the obsolete id is absent from `analytics.js`, `main.js`, `lead-transport.js` | KEEP |

The distinction the review was asked to draw resolves cleanly: **zero runtime/config defects,
six historical or protective occurrences.** `ARCHIVES_LEGACY_NOTICE.md` already documents this
and is current and accurate. No change needed.

### 2.3 The three ZIP archives — **ARCHIVE, already correctly labelled**

`finmentor_premium_final_candidate_APPROVED.zip`, `finmentor_premium_restored_owner_review.zip`,
`finmentor_production_v1.zip`.

Classified in `ARCHIVES_LEGACY_NOTICE.md` as **LEGACY ARCHIVE — never deploy**, with the
reasons enumerated (85 occurrences each of the obsolete GA id, submitters treating any 2xx as
success, `page_view` forwarding the full query string, pre-remediation trust boundaries).
Point-in-time provenance snapshots. **KEEP as ARCHIVE; do not deploy; do not delete.**

### 2.4 QA harnesses — **KEEP, all three are active in CI**

Checked specifically because rule 6 warns against deleting inactive harnesses. None is
inactive:

| Harness | Run by |
|---|---|
| `qa/miniapp_b20_browser_qa_v2.mjs` | `.github/workflows/miniapp-b20-qa.yml` |
| `gateway/telegram-initdata.test.mjs` | `.github/workflows/miniapp-b21-gateway-qa.yml` |
| `gateway/n8n/bootstrap-canary.test.js` | `.github/workflows/miniapp-b21a-bootstrap-qa.yml` |

The eight canonical gates run from `.github/workflows/finmentor-quality-gates.yml` via
`qa/run-all.mjs`. Nothing in `qa/` or `gateway/` is orphaned.

### 2.5 The fake Telegram bot token — **KEEP (required by the security tests)**

`gateway/telegram-initdata.test.mjs:19` — `123456789:TEST_ONLY_TOKEN_NOT_A_REAL_SECRET`.

Deliberately named to be unmistakable, and the **only** allowlisted literal in
`scripts/secret-scan.mjs` (`ALLOWED_LITERALS`). It is load-bearing: the HMAC derivation tests
cannot run without a token value. Rule 7 applies — **KEEP**, and removing it would be a
`SECURITY_FIX` regression, not a cleanup.

### 2.6 PR #10 evidence and references — **KEEP (rule 5)**

Nothing deleted. All references are accurate about PR #10's status:

- `docs/FINMENTOR_PHASE10_MINIAPP_READMODEL_CLOSURE.md` — states PR #10 is **not merged and
  remains draft**, read for context only, and that this file is canonical where they disagree.
- `docs/FINMENTOR_N8N_RETENTION_PLAN.md` — 13 archived executions held **because** PR #10 is
  open; deletion precondition is explicitly "PR #10 closed or merged AND Phase 10
  re-verification". Correct and current.
- `docs/FINMENTOR_AUDIT_REMEDIATION_REPORT_2026-08-25.md` — recommends closing PR #10. Now
  under the historical banner (§1.5).

### 2.7 Commit SHAs and branch names — **KEEP, all verified**

Every commit SHA cited in `docs/` resolves to a real object in this repository:
`a224aa2`, `3de2b67`, `d3c46acf…`, `50ac9d1f…`, `ca0b9ece…`, `6b8fefcf…`. The remaining long
hex strings are content/structural hashes in evidence tables, not commit references. Branch
names cited (`hardening/post-remediation-night-2026-08-25`,
`fix/finmentor-audit-remediation-2026-08-25`, `feat/phase-b2.1-miniapp-gateway`) are correct
for the documents that cite them. **No stale SHA or branch reference found.**

### 2.8 n8n workflow exports and manifest — **KEEP, gate-covered**

`n8n/production/` holds nine workflow exports plus `manifest.json`. Covered by the **n8n export
hygiene** gate (70 assertions), which asserts no secret or personal identifier enters
`n8n/production/` and that the manifest stays internally consistent with the exports beside it.
The manifest is a point-in-time export record (`generatedAt: 2026-08-25T20:04:03Z`) and is
correct as such.

### 2.9 Root changelogs, content maps and restoration reports — **KEEP as historical**

`CHANGED_FILES_RESTORATION.md`, `CHANGELOG_*.md` (3), `FINMENTOR_CONTENT_RESTORATION_REPORT.md`,
`FINMENTOR_MATERIALS_CONTENT_MAP.md`, `FINMENTOR_PRODUCT_CONTENT_MAP.md`,
`FOUNDER_PHOTO_UPDATE_REPORT.md`, `RESTORATION_QA_REPORT.md`, `FINMENTOR_CAMPAIGN_READY_REPORT.md`,
`FINMENTOR_UPDATE_REPORT.md`, `QUESTIONNAIRE_WEBHOOK_READY_REPORT.md`,
`SECURITY_HEADERS_RECOMMENDATION.md`.

Point-in-time records of website content work. Four contain the obsolete GA id and are already
classified in `ARCHIVES_LEGACY_NOTICE.md` (§2.2). None is cited as current guidance by any
canonical document. **KEEP.** Not `DELETE_CANDIDATE`: they are the audit trail for the content
restoration, and no gate or runtime path depends on them being absent.

### 2.10 `reconcile()` described as a repairer — **already corrected, no finding**

Checked explicitly. The runtime is classifier-only and says so: `mirror-helper.js` carries
`planReconciliation` with an explicit note that the previous name and its "repairs by
republishing" comment were wrong, and `qa/miniapp-readmodel.test.mjs` asserts
`repair_performed: false`, zero writes to **both** stores, and that no finding carries the old
`repaired` flag. Gateway contract §240 states plainly that reconciliation has never repaired
anything. The only surviving pre-rename prose is T37's row in the threat model, which has an
adjacent `AMENDED (N6.1)` bullet and is now named in the §2 reading notice (§1.3). **No change
needed.**

### 2.11 `Bot_Sessions` schema — **no document assumes the columns exist**

Checked explicitly. Every occurrence of `lead_mode` / `lead_priority` / `financial_zone` in a
`Bot_Sessions` context is framed as a **deployment precondition** — `AUTHORITY_SCHEMA_PRECONDITION`
in `submit-contract.js`, threat model §4.3, closure §8.3. The one unrelated hit
(`FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md:249`) is the GA4 Measurement Protocol event payload,
a different surface entirely. **No document claims the migration has happened. No change needed.**

### 2.12 Untracked debris — **none**

`git status --porcelain -unormal` is empty. There is no `.gitignore`, and none is needed:
nothing untracked exists in the working tree. No temporary files, no editor backups, no
build output.

---

## 3. Current state — the lines that must not drift

Confirmed at the end of N7. Any future document contradicting this table is a finding.

| Property | Value |
|---|---|
| Gates | **8/8 passing** |
| Total assertions | **460** |
| `qa/miniapp-submit.test.mjs` | **113/113** |
| `qa/miniapp-readmodel.test.mjs` | **42/42** |
| Enforced floors | per-gate in `qa/assertion-baseline.json`, total in `ASSERTION_BASELINE` (460) |
| Secret scan | PASS — 205 tracked text files, 5 patterns, 1 named test literal allowlisted |
| B.2.1-C activation | **NOT CLEARED** |

### Open blockers — unchanged by N7

| # | Blocker | State |
|---|---|---|
| **G1** | Durable idempotency backing store / recovery adapter | **OPEN — the activation blocker.** No durable store exists, and the stable key reaches no downstream record today |
| **G5** | Durable `initData` replay / single-use state | **OPEN — DESIGN-ONLY.** Same pre-activation infrastructure family as G1. Not closed, and spec-only validation is not accepted as closure |
| **Schema** | `Bot_Sessions` needs `lead_mode`, `lead_priority`, `financial_zone` | **OPEN — unmet deployment precondition.** Live sheet deliberately untouched; `authoritySchemaPreflight()` fails closed |
| **Canaries** | Fifteen live canary items (L1–L15) | **ALL UNEXECUTED** |

---

## 4. What N7 did not do

- **Deleted nothing.** No `DELETE_CANDIDATE` was raised, because nothing found was
  unquestionably generated debris whose removal was independently provable as harmless.
- **Rewrote no historical evidence.** Two banners and one reading notice were added; not one
  historical claim was altered, softened or back-dated.
- **Weakened no test.** No assertion was removed or relaxed; the assertion floors did not
  move; `ALLOWED_LITERALS` in the secret scan was not widened.
- **Touched no live surface.** No n8n, Sheets, production webhook, Telegram, GA4, DNS or
  Cloudflare access. No Mini App activation. No canary started. `main` untouched, no PR opened.
