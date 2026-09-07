# Gate 7 — FINMENTOR Production v1 customer release

**Status:** LIVE · **Release date:** 2026-09-07
**Branch:** `feat/miniapp-b21c-live-prereqs`
**Gate 6 audit commit:** `b3b62093911cd157a4f018461966a3d2fd99cb23`
**Gate 6 — independent Codex release audit:** PASS
**Gate 7 — owner customer release decision:** GO

This record states what was executed against production, what was verified immediately afterwards,
and what deliberately remains open. Every value below comes from the release run itself or from a
fresh read-only verification performed against the live tenant after the write. No timestamp, count
or verdict here is inferred or carried forward from an earlier record.

**No credential, token, API key, base URL, bot token or owner identity is stored in this record.**

---

## 1. The release action

One command, the only mutation authorised by the plan and the owner runbook:

    node scripts/deploy-c3-endpoints.mjs --confirm --release=CUSTOMER

It was preceded by the mandatory `--dry-run --release=CUSTOMER`, which was inspected in full before
the write. The action resolves the `__MINIAPP_RELEASE_MODE__` placeholder from `OWNER_ONLY` to
`CUSTOMER` in the release gate of each endpoint. It writes two n8n workflow definitions and nothing
else.

## 2. Post-release verification

Read back independently from the live tenant after the write — not from the deploy script's own
artifact.

| Property | Session `Hxje3Kel6nLLod5B` | Submit `ELiPdw4mdxQbBaan` |
|---|---|---|
| `RELEASE_MODE` | **CUSTOMER** | **CUSTOMER** |
| active | **YES** | **YES** |
| node count | **17** | **32** |
| nodes added / removed | none / none | none / none |
| webhook routes changed | **NO** | **NO** |
| settings changed | **NO** | **NO** |
| credential authority changed | **NO** | **NO** |
| connections changed | **NO** | **NO** |
| written at | `2026-09-07T06:44:53.110Z` | `2026-09-07T06:44:53.602Z` |

    CUSTOMER DATA MUTATED BY RELEASE = NO

The release performed two workflow-definition writes. No store, sheet, data table or customer row
was written by it. No other workflow on the tenant was modified: the Mini App Gateway, Mini App
host, Concierge, X-Ray Analysis, Lead Command Center, Lead Intake, SLA Lead Watch, Followup
Sequence, SYSTEM ALERT and Error Monitor all retain their pre-release write timestamps.

## 3. The one authorised delta beyond the release gate

The dry-run showed a second Submit node rewritten alongside the release gate, and the release was
held until the owner classified it. Recording it here so it is never an unexplained change:

- `Session Verdict` and `Submit State` are the release gates — a single string literal each.
- `Build Intake Payload` carries the `__PREMIUM_SUBMIT_PROJECTION__` marker, which
  `scripts/build-premium-endpoints.mjs` regenerates at deploy time by inlining
  `n8n/src/premium-ux/branches.js`, `draft-contract.js` and `submit-projection.js` verbatim.
- Two of those three modules were unchanged since the live OWNER_ONLY deploy. `branches.js` changed
  once, at commit `d0572c9` — the Gate 1 privacy fix.
- The complete delta is the Gate 1 owner-approved privacy disclosure line added to `PRIVACY.lines`,
  its four-line explanatory comment, and whitespace. No logic, contract, field, route, connection,
  setting or credential change.
- That copy is gate-bound: `qa/premium-ux-content.test.mjs` requires every `PRIVACY.lines` string to
  appear verbatim in the approved spec, and `qa/premium-ux-privacy-notice.test.mjs` covers the
  notice. Both are inside the canonical suite Gate 6 verified at this baseline.

The owner reviewed this delta and authorised the release including it. It converges the Submit
endpoint to the Gate 1 privacy wording already published on the Mini App host and the public policy
pages.

## 4. First fifteen minutes

| Check | Result |
|---|---|
| Both endpoints read back, active, correct node counts | PASS |
| Release gate resolved to CUSTOMER on both | PASS |
| Routes / settings / credential authority unchanged | PASS |
| SYSTEM ALERT fired | **NO** |
| Error Monitor fired | **NO** |
| New `error` / `crashed` / `canceled` / `unknown` executions | **NONE** — tenant total remained the single pre-existing execution `5215` (manual, 2026-09-03), unchanged before and after the release |
| Non-owner Mini App entry | **PASS** — observed by the owner; the customer path opens correctly and is no longer refused with `403 NOT_AUTHORISED` |

One supplementary refusal-only endpoint probe was not performed: it was blocked by the session's
permission classifier and was not worked around. It was redundant — the "no 5xx on Session or
Submit" condition it would have checked is covered by the zero-error execution history above.

## 5. Open severity register

    OPEN P0 = 0
    OPEN P1 = 0
    OPEN P2 = 7
    OPEN P3 = 13

Exactly as classified by the independent Gate 6 audit
(`docs/GATE6_INDEPENDENT_CODEX_RELEASE_AUDIT_2026-09-07.md` §6). No item was reopened,
reclassified, or fixed. None is on the customer release mutation path.

**POST_GO work was not started.** The twenty P2 and P3 items remain the frozen POST_GO backlog and
are not to be implemented as a side effect of this release.

Accepted v1 scope boundary, owner-decided in Gate 3 and unchanged: the Romanian public site,
questionnaire and CLIENT_READY result are complete, while the Concierge conversation and the Mini
App brief remain Russian. Full RO parity is POST_GO. This is a recorded scope decision, not a
defect, and it is not counted in the register above.

## 6. Rollback

    ROLLBACK READY = YES

- **Primary — restores the gate:** `node scripts/deploy-c3-endpoints.mjs --confirm`
  (`--release` defaults to `OWNER_ONLY`). Note that this regenerates the projection from source, so
  it restores `OWNER_ONLY` but leaves the Gate 1 privacy line in place. It is not a byte-symmetric
  revert.
- **Exact full revert:** `PUT /api/v1/workflows/<id>` with `.uat/<id>.pre-c3-endpoints.json`.
  Captured from live immediately before the release and verified unchanged through it:
  session 17 nodes `sha 04a00a8406f2`, submit 32 nodes `sha cbde809794e5`, both `active=true`.
  This is the only path that also restores the pre-Gate-1 privacy text.

`.uat/` is machine-local and gitignored by design; it holds resolved values and must never be
committed. Before using any file-based rollback, confirm the artifact reports 17 nodes (session) and
32 nodes (submit) — a 14/28-node artifact is the pre-C3 workflow and restoring it would revert far
more than this release.

## 7. Verdict

    GATE 7 — OWNER CUSTOMER RELEASE = GO
    CUSTOMER RELEASE = LIVE AND CONFIRMED

    SESSION RELEASE = CUSTOMER
    SUBMIT RELEASE  = CUSTOMER
    SESSION ACTIVE  = YES
    SUBMIT ACTIVE   = YES
    SESSION NODES   = 17
    SUBMIT NODES    = 32

    ROUTES CHANGED               = NO
    SETTINGS CHANGED             = NO
    CREDENTIAL AUTHORITY CHANGED = NO
    CUSTOMER DATA MUTATED        = NO

    SYSTEM ALERT (first 15 min)  = NO
    ERROR MONITOR (first 15 min) = NO
    NON-OWNER MINI APP ENTRY     = PASS

    OPEN P0 = 0
    OPEN P1 = 0
    OPEN P2 = 7
    OPEN P3 = 13

    ROLLBACK READY = YES
    PRODUCTION V1 STATUS = LIVE

Gates 0 through 7 are complete. This record closes Gate 7. It does not merge to `main`, start
POST_GO work, or authorise any further production change.
