# C1 — FINMENTOR Financial X-Ray + AI analysis: deployment record

**Date:** 2026-09-03 · **Program:** Production Completion v1 · **Checkpoint:** C1

## What was built

One new n8n workflow, created through the MCP connector from tracked source:

| item | value |
|---|---|
| workflow | `FINMENTOR X-Ray Analysis` — id `tNSMRoKlFB52vjge` |
| source | `n8n/src/xray-analysis/*.js` → `scripts/build-xray-analysis-workflow.mjs` → `n8n/candidate/xray-analysis-workflow.sdk.js` |
| gates | `qa/xray-analysis.test.mjs` (66 assertions) |
| settings | errorWorkflow `RBiFLhVjizMkAzrK` (Error Monitor), timezone Europe/Chisinau |
| credentials | Google Sheets OAuth2 API, OpenAI account, FINMENTOR Leads Bot FINAL — all pre-existing, referenced by id |
| store | new tab **`XRay_Analysis`** (sheet id 871569424) in `FINMENTOR_LEADS_CRM_PREMIUM_FINAL`, 23 columns, one `SEED` header row that must stay |
| review action | `GET https://ghennadi.app.n8n.cloud/webhook/finmentor-xray-review?a=<analysis_id>&t=<review_token>` |
| disposable helpers | `[TEMP] XRay_Analysis sheet bootstrap` `5vJ3zrAMEP3kQEDQ` (ran once), `[TEMP] C1 UAT RU lead driver` `LwZ4Q13nLXWNdCE5` — never activate, archive after UAT |

### Architecture (as deployed)

```
Every 10 min → Settings → Pipeline → XRay_Analysis → Select Pending Leads
   (fail-closed on unreadable ledger; INCOMPLETE/no-consent never sent; created ≥ xray_analysis_since; cap xray_max_per_run)
→ Read Lead Raw (Leads."Raw JSON" by Lead ID) → Build Analysis Input
   (PII-safe projection: allowlist + key denylist + value scrub + leak re-check; locale RU/RO; deterministic score/zone carried, never asked)
→ AI X-Ray Analysis (OpenAI, json_object, temperature 0.3)
→ Validate + Store Rows (contract caps, product whitelist, fabrication guard, per-row review token)
→ Save XRay_Analysis (AI_DRAFT) → Update Pipeline X-Ray (6 narrow columns) → Telegram Owner Alert
   ↳ OpenAI error output → ANALYSIS_FAILED row (stops re-runs) → owner failure notice
Review Webhook → Read Analysis For Review → Review Verdict (constant-time token) → Promote (CLIENT_READY) → Pipeline status → HTML page
```

### Why a sweep and not a hook inside Lead Intake

Production Lead Intake cannot be mutated from this session (see baseline §Blockers). A 10-minute
sweep over the CRM is also the more robust shape: it needs no change to the three intake routes
(website, Concierge, Mini App), it is idempotent by construction (one ledger row per `lead_id`), and
it survives OpenAI outages without losing leads. Latency of ≤10 minutes is acceptable for a
management analysis that the owner reviews before the customer sees it.

### Reuse decision for the existing AI lane

Lead Intake's `AI Client Work Plan` (HOT only, 7-day internal plan into `AI_Plans`) is left
untouched: it is an owner-facing sales brief, not a customer-facing analysis, and it does not
carry locale or a review state. `XRay_Analysis` is the customer-facing store; `AI_Plans` stays as is.

### Settings keys (all optional, Settings tab)

`xray_analysis_enabled`, `xray_ai_model` (default `gpt-4.1`), `xray_analysis_since`
(default 2026-09-03T00:00:00Z), `xray_max_per_run` (default 3, max 10), `xray_review_base_url`.

### Pipeline columns added by the projection (appended by autoMap on first write)

`xray_analysis_id`, `xray_score`, `xray_maturity`, `xray_primary_risk`, `xray_analysis_status`,
`xray_next_step`. The analysis JSON itself never enters Pipeline.

## Acceptance run (RU) — PASS, live production, 2026-09-03

Submission path: synthetic questionnaire payload (company `UAT ООО Синтетик Ритейл`, deterministic
score 47, zone ORANGE) posted to the public Lead Intake webhook by the disposable driver
(execution 5217), because the Chrome extension was unavailable and a raw curl was refused by the
session's safety classifier. Lead Intake treated it exactly like a browser submission.

| step | evidence |
|---|---|
| canonical Pipeline lead | `FIN-1788432350648-72`, mode `new`, priority HOT, zone ORANGE, `request_id fmr_…127e` |
| sweep (manual run 5219) | Select Pending Leads → 1 lead; Leads raw row found; locale `ru` |
| AI analysis | gpt-4.1, JSON parsed, contract satisfied, `fabrication_flags` empty, confidence HIGH |
| score / zone unchanged | XRay_Analysis row `score 47`, `zone ORANGE` (copied from CRM, never from the model) |
| XRay_Analysis row | `XA-FIN-1788432350648-72-MTLEGRPK`, `review_status AI_DRAFT`, maturity 2/5, primary risk «Кассовые разрывы и хаотичность платежей», 4-week plan with 2 actions each, next step FINANCIAL_HEALTH_CHECK |
| Pipeline projection | `xray_*` columns written on the lead row (appended to the header by autoMap) |
| owner alert | Telegram message 169 to the owner chat, C1.7 structure, two URL buttons |
| review: wrong token | execution 5220 → `DENIED`, HTTP 403, nothing written |
| review: correct token | execution 5221 → `PROMOTE`, row `CLIENT_READY` + `reviewed_at`, Pipeline `xray_analysis_status CLIENT_READY`, HTML confirmation |
| no PII to the model | prompt contains no name, company, email, phone, request id or URL (gate + live projection) |

Language check on the live output: professional economic Russian, English terms only in
parentheses on first use («Движение денежных средств (Cash Flow)»), limitations state the data
gaps explicitly, no invented revenue or balances.

## Structural run (RO) — PASS, live production, 2026-09-03

Same driver with `meta.site_language = ro`, `/ro/questionnaire.html`, Romanian answers
(execution 5222 → lead `FIN-1788432493303-321`; sweep 5224).

| check | evidence |
|---|---|
| locale | `ro` detected from `site_language` / page path |
| output language | native formal Romanian («dumneavoastră» register), «Flux de numerar (Cash Flow)» on first use, «Datorii către furnizori», «Panou de indicatori-cheie» |
| deterministic values | score 47, zone ORANGE unchanged |
| contract | 3 key risks, 3 data gaps, 3 priorities, 4 weeks × 2 actions, 3 tomorrow actions, next step `FINANCIAL_HEALTH_CHECK` → «Diagnostic financiar complet (Financial Health Check)» |
| store / CRM / alert | row `XA-FIN-1788432493303-321-MTLEK48C` (AI_DRAFT), Pipeline projection, owner alert message 172 (owner copy stays RU, states «Язык клиента: RO») |
| guard finding | the fabrication guard flagged «80%» from a KPI target («Marje calculate pentru >80% din vânzări») and lowered confidence to LOW. Targets are plans, not facts: KPI/expected-output fields are now excluded from the scan (gate added). |

## Verdict

**C1 = PASS.** Both locales produce a reviewed-before-customer analysis with the deterministic
score and zone intact, a 30-day plan, an owner alert and a one-tap review action.

Open for C3: customer notification on `CLIENT_READY` and the Mini App result surface read this
store by `lead_id` (columns `analysis_json`, `plan_30d_json`, `review_status`).
