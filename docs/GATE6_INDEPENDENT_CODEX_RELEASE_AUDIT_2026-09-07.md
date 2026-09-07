# Gate 6 — independent Codex release audit

**Verdict:** PASS

**Audit completed:** 2026-09-07T09:07:23+03:00

**Audited branch:** `feat/miniapp-b21c-live-prereqs`

**Pre-audit baseline SHA:** `cc6a4bfb3adac101744aab7df6ba727cd0f40291`

**CUSTOMER RELEASE:** NOT AUTHORIZED

This is a recovery audit. It does not inherit any local state from the lost Gate 6 machine. The
GitHub branch was refreshed first, all audit inputs were read from committed history or fresh live
read-only surfaces, and no production workflow, database row, website file, customer route, or
release mode was changed. Successful customer journeys were not re-submitted because that would
create new production leads; their server-side proof is reconstructed from the committed Gate 5
record and rechecked against the current executable contracts. All fresh HTTP checks in this audit
used refusal-only or read-only paths.

## 1. Mechanical baseline

After `git fetch origin feat/miniapp-b21c-live-prereqs`, and again immediately before this artifact
was written:

| Check | Result |
|---|---|
| worktree before audit evidence | clean |
| `HEAD` | `cc6a4bfb3adac101744aab7df6ba727cd0f40291` |
| `origin/feat/miniapp-b21c-live-prereqs` | `cc6a4bfb3adac101744aab7df6ba727cd0f40291` |
| `HEAD == origin/...` | YES |
| baseline source | current remote branch SHA, not a recovered local value |
| `git fsck --full --no-reflogs` | PASS |
| pre-evidence `git diff --check` / index check | PASS |

`FINAL_PRODUCTION_V1_GO_PLAN.md` is tracked at that SHA. It defines Gate 6 at lines 186–193 as the
independent P0/P1, security, privacy, data-loss, duplication, authorization, lifecycle,
release-state and deployment-drift audit. It also explicitly keeps Gate 7 blocked and CUSTOMER
release unauthorized.

## 2. Gates 0–5 reconstruction

The evidence commits are ancestors of the baseline and the referenced records are tracked:

| Gate | Evidence commit | Independent reconstruction |
|---|---|---|
| 0 — Telegram premium button colors | `7a0d4844e3328f517c21c718799470ef4eaeba85` | final section of `docs/TELEGRAM_BUTTON_STYLES_2026-09-04.md` records live PASS; style-slot gate is in the current canonical suite |
| 1 — privacy/legal | `7f3998d27ca031ca0c9127976853917b43207bc7` | committed Gate 1 record, live RU/RO policy readback, Mini App privacy link/readability checks and current 59-assertion privacy gate agree |
| 2 — CRM lifecycle | `4b8108f69bf4ad5a2c9c307dae8a7aaa61266766` | committed owner-command live sequence covers progression, Nurture, Won, Lost, reopen and terminal protection; current stage/terminal gates pass 29 + 25 assertions |
| 3 — RO content | `c6e5d07323d81094a2f94b234b0f2ee563a1a083` | committed live route proof plus current RO first-contact and client-result contracts pass; public RO release assets match `origin/main` byte-for-byte |
| 4 — GA4 | `77769379761b5f016d4929bd98e42dd8543260f8` | fresh headless live UAT passes 18/18, including pre-consent silence, RU/RO events, dedup and no submission id/PII in beacons |
| 5 — final integrated E2E | `86e5a39a064404d4fdabb5db6bf15a9e3c682f73` | committed immutable production joins prove RU and RO end to end, exactly once, negatives and owner lifecycle; current component contracts, live denied paths and live stores reproduce the required invariants |

The Gate 5 record was read rather than its values being copied from the recovery request. It states
and substantiates:

- RU end-to-end PASS and RO end-to-end PASS;
- the new RO curated result uses `Radiografia Financiară FINMENTOR`;
- cross-system identity and exactly-once behavior PASS;
- negative E2E PASS and data hygiene PASS;
- 82/82 gates, 2,848 assertions and assertion floors PASS;
- CUSTOMER RELEASE NOT AUTHORIZED.

The terminology correction is also present in the current X-Ray source and generated SDK. The
current 143-assertion X-Ray gate rejects the retired result label.

## 3. Independent execution evidence

### Canonical and targeted QA

The canonical runner was executed from a clean LF-preserving `git archive` of the baseline. This
avoids the already-recorded Windows `core.autocrlf=true` checkout distortion without editing the
worktree:

    82/82 gates passed
    TOTAL ASSERTIONS: 2848
    assertion floors: PASS

A separate release-critical subset was then executed from another clean archive:

    17/17 targeted test files passed
    681 targeted assertions passed

That subset independently covered Command Center authorization, privacy, RO first contact, both CRM
stage contracts, five Lead Alerts contracts, X-Ray authority, CLIENT_READY, Gateway, replay/store
failure, submit idempotency and Telegram initData validation. In addition:

- 311 tracked JavaScript files and 24 PowerShell files parse with zero failures;
- secret-scanner self-test: 24/24;
- fresh live GA4 UAT: 18/18;
- fresh public Gateway negative battery: 84/84;
- current Lead Alerts presentation verifier replayed against all five current candidates: 43/43.

### Fresh public/live checks

- The 14 release-critical website assets returned HTTP 200 and were 14/14 byte-equal to current
  `origin/main` (`b57ac259847ca77e249ec133e41bcb6435f8e031`).
- Six of those assets intentionally differ from feature HEAD: the Gate 3 C3.6 mass rename is
  committed on the feature branch but explicitly superseded/not published. This is source-topology
  debt, not production drift. No merge to `main` is part of this release action.
- The live Mini App host returned 200 and contains current `app.js`, `net.js`, `content.js` and
  `app.css` byte-for-byte. Its output contains no `review_token`, raw analysis, request id,
  confidence, fabrication, prompt or model field.
- Six Session/Submit refusal-only probes returned the exact fail-closed three-key contract:
  `BAD_REQUEST`, `CONSENT_REQUIRED`, or `SESSION_INVALID`, with no 5xx and no successful write.
- The X-Ray review GET and POST paths both returned 403 for a nonexistent analysis and synthetic
  token; the token was not reflected.
- Supabase project `finmentor-prod` was ACTIVE_HEALTHY. RLS is enabled on the replay, alert outbox,
  delivery and retention tables. `anon` and `authenticated` have no grants or policies on them; the
  four INFO `rls_enabled_no_policy` notices therefore describe deliberate deny-all public access.
- The replay table has only `replay_key`, `first_seen_at`, `expires_at`, and `correlation_id`. Across
  25 rows: zero invalid hash keys, zero invalid expiry order and zero oversized correlations. The
  public Gateway battery left the row count at 25, proving invalid inputs never reached the claim.

## 4. Release-domain verdicts

| Domain | Verdict | Evidence |
|---|---|---|
| security and authority boundaries | PASS | strict Telegram verification/freshness, atomic replay claim, fail-closed outages, constant-time X-Ray token comparison, RLS/grants, current authorization tests |
| privacy and consent | PASS | live policies/controller/contact/retention wording, explicit unprechecked consent, consent-before-write, analytics consent separation, PII-filtered analytics |
| RU journey | PASS | committed Gate 5 production join plus fresh current contracts and live asset/drift checks |
| RO journey | PASS | committed Gate 5 production join, canonical current result label, 19-assertion first-contact gate, 61-assertion client-result contract |
| CRM lifecycle and terminal states | PASS | committed owner live taps plus current 29 + 25 assertions; terminal writes remain owner-command-only |
| Lead Alerts | PASS | current candidate execution tests, presentation/action/ack/no-op contracts, current verifier 43/43; historical failures resolved below |
| X-Ray | PASS | 143 assertions; GET is read-only, POST-only promotion, bounded per-row token, constant-time compare, idempotent repair, live denied probes |
| CLIENT_READY | PASS | one curated 12-key contract across publisher, Gateway and client; drafts/failures/internal fields cannot cross |
| Mini App | PASS | live host/source equality, session/submit refusal battery, owner-only default in current server candidates, submit idempotency and outage contracts |
| Gateway negative battery | PASS | 84/84 public response assertions, no replay-row delta, 30 + 63 + 16 focused offline assertions |
| GA4 | PASS | fresh 18/18 live browser UAT; no Google load before consent, approved events exactly once, no PII/submission id |
| Owner Console / owner authority isolation | PASS | 43 authorization assertions, strict owner identity comparison, owner-command-only lifecycle, owner-only Session/Submit defaults |
| production drift | NO | website 14/14 against deployed `origin/main`, Mini App four-module equality, live endpoint behavior and Supabase schema consistent with the committed release evidence |

## 5. The three recovered observations

### 5.1 Telegram-token-shaped literal

**Classification: inert synthetic test data, not a real credential.** The literal was never printed
in this audit. It occurs once in `qa/lead-alerts-presentation.test.mjs`, inside the poison-input array
for the test that proves secrets cannot survive into an owner message. A redacted `getMe` request
returned Telegram HTTP/API 401. The current secret scan nevertheless exits 1 because the fixture is
deliberately credential-shaped. The credential conclusion is closed; the broken security-scan/CI
signal remains P2 tooling integrity debt.

### 5.2 Older Lead Alerts live-verifier failures

**Classification: historical execution evidence and superseded verifier logic, not a current
production defect.** Execution 5055 remains an immutable pre-fix failure. Execution 5062 closed the
empty-confirmation defect and exposed the distinct edit-no-op classification defect. Execution 5068
closed that defect; the corrected verifier recorded 55/55 and its negative control still fails on
5062. The current five-candidate presentation verifier passes 43/43 and the current targeted Lead
Alerts contracts pass 151 assertions across presentation, action, ack, no-op and candidate tests.

### 5.3 Gateway expected/live node-state failure

**Classification: stale verification tooling, not current runtime risk.** The failing script was
introduced before the Gateway expanded and has never been re-baselined; it still requires exactly
13 nodes. The committed live record and current graph contracts have 32 deployed nodes after cycle,
session-store and CLIENT_READY paths. Fresh public negative behavior is 84/84 with no replay-row
delta. This is the already-recorded P2 tool-baseline finding, not a Gateway defect.

## 6. Open severity register

The register includes the authoritative plan's 14 POST_GO entries and every additional Gate 6
observation. Planned enhancements are counted as P3 backlog items even where they are not defects,
so the totals do not silently omit already-approved work.

| ID | Severity | Remaining item | Why non-blocking for this release |
|---|---|---|---|
| PG-01 | P2 | durable NEW LEAD outbox relay / Cloud Run | direct approved Telegram path and SYSTEM ALERT contract pass; additional durability is POST_GO |
| PG-02 | P3 | Graph / Microsoft 365 email delivery | additional delivery channel, not the approved v1 contract |
| PG-03 | P2 | deeper retention automation | published lead retention and accountable manual process are defined; automation remains hardening |
| PG-04 | P3 | HMAC fingerprint v2 | current domain-separated SHA-256 replay key and unique atomic claim pass |
| PG-05 | P3 | additional BI / analytics | approved launch GA4 contract passes |
| PG-06 | P3 | UI polish | no customer-blocking UI defect remains |
| PG-07 | P3 | additional automations | outside the frozen v1 contract |
| PG-08 | P3 | broader architecture refactoring | debt only |
| PG-09 | P3 | no emphasis on two re-rendered alert shapes | cosmetic; active action keyboard remains correct |
| PG-10 | P3 | no `.gitattributes` | Windows checkout/tooling issue; clean LF archive and CI source pass |
| PG-11 | P2 | legacy Lead Alerts keyboard deployer is non-idempotent | superseded by targeted deployers; it is not part of the release command |
| PG-12 | P2 | five Gateway tools pin 13 nodes | stale verifier/deployer baseline; live runtime and current contracts pass |
| PG-13 | P3 | Pipeline has no `language` column | locale remains in payload/source page and RO output is correct |
| PG-14 | P3 | two early synthetic leads use `@finmentor.md` | terminal UAT rows; no routing or customer effect |
| G6-01 | P2 | GitHub Pages lacks HSTS/CSP/XCTO/frame/referrer/permissions response headers | platform limitation already documented; HTTPS redirect, referrer meta and static/no-UGC surface reduce exposure |
| G6-02 | P2 | inert token-shaped poison fixture makes the repository secret-scan/CI step red | API-invalid, test-only and not shipped; security signal should be restored POST_GO |
| G6-03 | P3 | `xray_score` can remain empty for non-questionnaire leads | truthful anti-fabrication behavior; routing fields remain populated |
| G6-04 | P3 | Romanian X-Ray system-prompt article has a grammatical seam | model-only wording; produced customer output and canonical label are correct |
| G6-05 | P3 | append-only records retain stale opening headers/counts and pre-fix verifier failures | authoritative final sections and the current plan resolve the state; documentation clarity only |
| G6-06 | P2 | feature branch contains the superseded unpublished C3.6 site rename | live/main are canonical; release requires no merge, and this audit explicitly does not merge |

    OPEN P0 = 0
    OPEN P1 = 0
    OPEN P2 = 7
    OPEN P3 = 13

No P2 or P3 is on the CUSTOMER release mutation path, changes an approved customer contract, or
demonstrates data loss, cross-customer access, privacy leakage, duplicate lead creation, authority
bypass, or lifecycle corruption.

## 7. Final Gate 6 verdict

    GATE 6 — INDEPENDENT CODEX RELEASE AUDIT = PASS

    BASELINE SHA = cc6a4bfb3adac101744aab7df6ba727cd0f40291
    HEAD == ORIGIN = YES
    WORKTREE CLEAN = YES

    GATES 0–5 RECONSTRUCTED = PASS
    SECURITY = PASS
    PRIVACY = PASS
    RU JOURNEY = PASS
    RO JOURNEY = PASS
    CRM LIFECYCLE = PASS
    LEAD ALERTS = PASS
    X-RAY = PASS
    CLIENT_READY = PASS
    MINI APP = PASS
    GATEWAY NEGATIVE BATTERY = PASS
    GA4 = PASS
    OWNER AUTHORITY ISOLATION = PASS
    PRODUCTION DRIFT = NO

    CANONICAL QA = PASS — 82/82 gates, 2,848 assertions, assertion floors PASS
    TARGETED QA = PASS — 17/17 files, 681 assertions; live Gateway 84/84; GA4 18/18; secret self-test 24/24

    OPEN P0 = 0
    OPEN P1 = 0
    OPEN P2 = 7
    OPEN P3 = 13

    TECHNICAL RELEASE READINESS = PASS

This verdict closes Gate 6 only. It does not execute Gate 7, merge to `main`, perform POST_GO work,
or authorize CUSTOMER release. **CUSTOMER RELEASE remains NOT AUTHORIZED.**
