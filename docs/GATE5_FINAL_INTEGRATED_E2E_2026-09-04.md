# GATE 5 — Final Integrated E2E: RU and RO, proven as one path on production

**Date:** 2026-09-04 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Plan:** `FINAL_PRODUCTION_V1_GO_PLAN.md`
**Verdict: GATE 5 = PASS** — one P1 found live and fixed, one P2 and two P3 recorded.
**CUSTOMER RELEASE = NOT AUTHORIZED.**

Everything below was read from the live production system after the fact — executions, sheet rows,
data-table rows and real network responses. Where the contract requires an owner tap, the owner
tapped; nothing in this gate simulated owner authority.

---

## 1. What was actually run

Three synthetic journeys, driven through the real public site with headless Chrome over the
DevTools Protocol (`qa/e2e-live-journey.mjs`), each ending in a real lead, a real owner review and
a real customer-visible result.

| lead | locale | owner approved | curated row |
|---|---|---|---|
| `FIN-1788533727401-299` | ru | 15:09:44.898Z | 3 |
| `FIN-1788535445294-279` | ro | 15:36:10.609Z | 4 |
| `FIN-1788536862472-722` | ro (post-fix) | 15:55:29.047Z | 5 |

Identities are synthetic and marked: company names carry `UAT`, contact addresses end `@uat.invalid`.
No real customer lead was created or mutated by this gate.

**`FIN-1788113619104-582` (Mega Parc SRL) was not touched.** Its `updated_at` and `last_activity_at`
both read `2026-09-04T05:12:02.542Z`, matching its own `reviewed_at` — the owner's earlier approval,
reconstructed in the previous checkpoint. Every action in this gate happened at 15:09Z or later, and
the row has not moved since.

---

## 2. The P1: canonical RO product name, found in live output

The RO customer result published `Test de sănătate financiară FINMENTOR` — the name retired by the
Gate 3 owner decision in favour of **Radiografia Financiară FINMENTOR**. The string was live in two
X-Ray nodes, and `qa/xray-analysis.test.mjs` *asserted the retired name as canonical*, which is
precisely why it shipped: the gate was defending the defect.

Fixed under explicit owner authorization, in exactly the two proven occurrences:

- `n8n/src/xray-analysis/build-client-result.js:22` — the customer-facing label
- `n8n/src/xray-analysis/build-input.js:113` — the product name given to the model

and the two test assertions inverted, with a comment recording the supersession so the next reader
sees why the expectation flipped.

**The required proof was a newly generated result, not a source-code grep.** A fresh synthetic RO
lead was run end to end and approved once by the owner:

    labels.product = "Radiografia Financiară FINMENTOR"     ← curated row 5, generated 15:55:30.505Z

with `locale: "ro"`, the twelve approved keys exactly, zero Cyrillic characters and 175 Romanian
diacritics in the customer-facing text, `zone_label: "Zonă verde"`, and no forbidden key anywhere in
`result_json`.

The two pre-fix curated rows (1 and 4) still carry the retired name. They are historical records of
what was published before the fix; the owner instructed that they not be mutated, and they were not.

---

## 3. Cross-system exactly-once identity

Read across all three stores, for all four leads including the real one:

| store | rows | duplicate `lead_id` |
|---|---|---|
| Pipeline (Google Sheets, 77 columns) | 16 | **none** |
| `XRay_Analysis` (Google Sheets) | 7 | **none** |
| `XRay_Client_Results` (n8n Data Table) | 5 | **none** |

Each of the four leads holds exactly one row in each store. Each curated row was written once —
`createdAt == updatedAt` on rows 2, 3, 4 and 5. Each approval produced exactly one REVIEW POST
execution; for the RO-B lead, 5640 was the GET that renders the review page and 5641 the POST that
published it.

The publisher is an upsert matched on `lead_id`, so exactly-once here is structural rather than
lucky — but it is also now observed.

**Duplicate approval is refused by removal, not by an error.** Once a result is published the owner
UI withdraws the control entirely and shows «Уже готово». That is a stronger fail-safe than the
`ALREADY_READY` rejection this gate expected to find, and it was left exactly as it is.

---

## 4. Negative E2E

### 4.1 Public endpoints, probed live

| probe | result |
|---|---|
| Lead Intake — empty JSON body | **400** `EMPTY_PAYLOAD`, `retryable:false` |
| Lead Intake — junk keys, no identity | **400** `EMPTY_PAYLOAD` |
| Lead Intake — name only, no contact channel | **400** `IDENTITY_MISSING` |
| Lead Intake — malformed JSON | **422**, parse refused |
| Lead Intake — GET on a POST route | **404**, not registered |
| X-Ray review — GET, no token | **403** |
| X-Ray review — GET, invalid token | **403** |
| X-Ray review — POST, invalid token | **403** |

Every one fails closed. Not one reached a write.

### 4.2 Mini App Gateway — the approved negative battery, re-run live

`scripts/run-gateway-negative-battery.mjs`: **93 PASS, 1 FAIL** — the single failure is a stale
baseline in the script, not a production fault (§6).

    non-JSON content-type                 -> 400 BAD_REQUEST
    unsupported client_version            -> 400 CLIENT_VERSION_UNSUPPORTED
    unsupported locale                    -> 400 BAD_REQUEST
    init_data absent / empty              -> 400 TG_INITDATA_MISSING
    forged signature, fresh auth_date     -> 401 TG_INITDATA_INVALID
    forged signature, STALE auth_date     -> 401 TG_INITDATA_INVALID
    forged signature, FUTURE auth_date    -> 401 TG_INITDATA_INVALID
    signature field absent                -> 401 TG_INITDATA_INVALID
    malformed initData / percent-encoding -> 401 TG_INITDATA_INVALID
    duplicate key                         -> 401 TG_INITDATA_INVALID

Each rejection body is exactly the three-key contract, leaks nothing from the leak needles, and mints
no `app_session_id`. After the battery: no app session created, Gateway retained executions still
zero, the graph unchanged, still active, still the single expected Postgres credential.

A first pass at these probes returned `CLIENT_VERSION_UNSUPPORTED` for every Gateway case, which
would have proven only that a version guard sits in front of the auth guard. The battery above sends
a supported `client_version` and a forged signature, so the 401s are genuine evidence that Ed25519
verification is enforced — not an artifact of failing earlier.

### 4.3 Remaining negative cases

- **Unknown CRM stage** — `toBusinessStage('something odd') === 'UNKNOWN'`, never terminal, and
  `canAutomatedTransition` refuses to guess. Fail-safe, covered by `qa/crm-stage-map.test.mjs`.
- **Analytics failure never blocks the customer** — established in Gate 4; every sender is wrapped,
  `trackBusiness` returns `false` rather than throwing, nothing in the submit path awaits it.
- **Duplicate submit** — `idempotency-receipt` (72), `premium-ux-submit-idempotency` (28),
  `lead-intake-dedup-harness` (42), `lead-intake-committed-replay` (19), plus the zero duplicates
  observed in §3.

---

## 5. UX sanity — live, both languages

Eight customer-facing pages loaded on production: **8/8 clean.**

| page | HTTP | `lang` | console errors | failed sub-resources | placeholder/`undefined` tokens |
|---|---|---|---|---|---|
| RU landing, questionnaire, thank-you, privacy | 200 | `ru` | 0 | none | none |
| RO landing, questionnaire, thank-you, privacy | 200 | `ro` | 0 | none | none |

**Zero Cyrillic characters in any RO customer page.** RO titles read `Radiografia Financiară a
afacerii`, `Solicitare primită`, `Politica de confidențialitate` — consistent with the canonical
name. Privacy links resolve within their own language (`privacy.html` from `/ro/` reaches
`/ro/privacy.html`); the one `../privacy.html` on the RO privacy page is the RU language switcher,
which is correct.

---

## 6. Data hygiene

16 Pipeline rows: **5 synthetic, 11 real.** The synthetic rows are the three from this gate plus two
from the earlier CRM lifecycle gate, and all five carry a `UAT` prefix in the company name.

**Consent gating is honoured in storage, not only in the browser.** The synthetic RO lead consented,
and its row carries `analytics_consent: true` with a GA client and session id. Mega Parc did not, and
its row carries `analytics_consent: false` with both GA fields **empty**. Gate 4 proved no lead
identifier flows *to* GA4; this is the reverse direction, and it also holds.

### Findings recorded, not fixed under freeze

**P2 — five live-verification scripts pin the Gateway at 13 nodes; it has 32.**
`run-gateway-negative-battery.mjs`, `collect-b21c-ab-proof.mjs`, `preflight-b21c-ab-press.mjs` and
`deploy-miniapp-gateway.mjs` (twice) all assert `nodes.length === 13`. The live Gateway
`nTZHLbv2KFggdhh5` is active with 32 coherent nodes — the cycle-projection, session-store and
`Attach Client Result` paths added since that baseline was written. Every *downstream* assertion in
the battery passes, including the one that reads `G5 Replay Claim`, so this is stale tooling and not
production drift. Two consequences worth naming: a healthy Gateway now reports FAIL on these
scripts, and `deploy-miniapp-gateway.mjs` would refuse to deploy at all, so it is no longer the
authoritative deploy path for that workflow. Not corrected here — changing a deploy guard's expected
shape is not a Gate 5 minimal correction.

**P3 — the Pipeline sheet has no `language` column.** Across 77 columns there is none, so an RO lead
is identifiable in the CRM only via `source_page` (`.../ro/questionnaire.html`). Language is carried
through the request payload, which is why the RO analysis produced correct Romanian output. The owner
console is Russian by design (Gate 3 decision), so this is not a v1 defect.

**P3 — `xray_score` is structurally empty.** It is fed from `Leads."Diagnostic Score"` or
`raw.diagnostic.score`, neither of which is populated for these leads, so the column is empty on both
the real and the synthetic rows. This is the anti-fabrication path working: the model receives
`deterministic_score_0_100: 'INSUFFICIENT DATA'` and `scored_by_xray_questionnaire: false` rather
than an invented number, and the empty column is truthful. `financial_zone` and `priority`, which
drive routing, are populated normally.

**Observation — the substitution left a grammatical seam in the RO system prompt.**
`build-input.js` now reads `rezultatul unui Radiografia Financiară FINMENTOR`; the article does not
agree with the feminine articulated noun (`unei Radiografii Financiare`, or simply `rezultatul
Radiografiei Financiare`). The owner authorized the terminology substitution only, so the
surrounding words were left alone. Impact is confined to the prompt the model reads — it is not
customer-facing text, and the live RO output it produced was verified clean. A one-word correction,
if the owner wants it.

**Observation — the two older synthetic leads use `@finmentor.md` addresses**, not the `@uat.invalid`
convention this gate adopted. Both are terminal (Won / Lost). They are identifiable by their `UAT`
company prefix, but less obviously test data than the newer rows.

---

## 7. Regression

    82/82 gates passed
    TOTAL ASSERTIONS: 2848
    assertion floors: PASS

No floor decreased. `xray-analysis` holds at its floor of 143 with the two corrected assertions.

One documentation correction: `docs/GATE4_GA4_UAT_2026-09-04.md` cited `website-contract 79`. The
gate is 75, the recorded floor is 75, and a standalone run gives 75 — the 79 was a transcription
error in that document. Coverage never fell.

Alerting is quiet and was not triggered by anything in this gate: the most recent tenant failure is
execution 5215 on 2026-09-03T10:44Z, and Error Monitor and SYSTEM ALERT last ran successfully on
2026-08-31.

---

## 8. Verdict

    GATE 5 — FINAL INTEGRATED E2E = PASS

    RU JOURNEY END TO END = PASS          RO JOURNEY END TO END = PASS
    RO CANONICAL TERMINOLOGY LIVE = PASS
    CROSS-SYSTEM EXACTLY-ONCE IDENTITY = PASS
    NEGATIVE E2E = PASS                   UX SANITY = PASS (8/8)
    DATA HYGIENE = PASS
    REAL CUSTOMER LEAD MUTATED = NO

    OPEN P0 = 0   OPEN P1 = 0   (one P1 found live, fixed, re-proven live)
    NEW P2 = 1    NEW P3 = 2    -> POST_GO
    LIVE EVIDENCE = gateway-negative-battery 93/94 (one stale-baseline FAIL, §6)
                    UX sweep 8/8 · endpoint probes 8/8 fail-closed
    CANONICAL QA  = 82/82 gates, 2848 assertions, floors PASS

**CUSTOMER RELEASE = NOT AUTHORIZED.**
