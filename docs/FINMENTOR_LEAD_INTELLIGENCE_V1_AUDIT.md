# FINMENTOR Lead Intelligence v1 — system audit

Audit date: 2026-09-10
Baseline: `origin/main` at `e805e67949bb8d0316a38684c2300259541384c6`
Implementation branch: `feat/lead-intelligence-v1`

## Authority decision

Google Sheets remains the business source of truth. n8n remains orchestration. Telegram remains an alert and explicit quick-action surface. The owner Lead Intelligence Brief is a derived decision surface, not a replacement CRM.

The live n8n tenant was inspected read-only through a redacted export. No production workflow was changed. Repository `n8n/production` exports are historical and are not an authoritative build base where they differ from live.

| Concern | Authoritative current source | Writer / reader contract |
|---|---|---|
| Leads | Google Sheets `Leads`, gid `409890193` | Lead Intake writes submitted facts and immutable `Raw JSON`; X-Ray reads by server-owned Lead ID |
| Pipeline | Google Sheets `Pipeline`, gid `1883973304` | Lead Intake and Command Center write operational status, next action and narrow X-Ray projection |
| Activities | Google Sheets `Activities`, gid `623316892` | Chronological business actions: `activity_id, ts, lead_id, actor, channel, action, detail` |
| Status_Log | Google Sheets `Status_Log`, gid `1810362432` | Command Center writes actual status transitions only |
| Lead_Answers | Google Sheets `Lead_Answers`, gid `936189533` | Normalized submitted answers; Raw JSON remains the complete intake context |
| XRay_Analysis | Google Sheets `XRay_Analysis` | Full analytical draft, owner review state, derived brief, owner edits and version history |
| XRay_Client_Results | n8n Data Table `XRay_Client_Results` | Curated client result only; upsert by `lead_id`; Mini App Gateway reads it |
| MiniApp_App_Sessions | n8n Data Table `MiniApp_App_Sessions` | Server-side draft/session state with the existing session and initData trust boundary |
| Telegram Lead Alerts | live Lead Intake `QmIyEW2ZEqKregmN`; X-Ray Analysis `tNSMRoKlFB52vjge` | Owner alert only; the new X-Ray alert is the short Lead Intelligence entry point |
| Telegram Client Transport | live `ShcmmJeLSE8LYVBk` | Internal Execute Workflow contract; confirmed output includes `ok, chat_id, message_id, correlation_id, error_code, retryable` |
| X-Ray review | live X-Ray Analysis `tNSMRoKlFB52vjge` | Bounded per-analysis token; GET read-only; POST performs explicit owner action |
| Mini App submit | live `ELiPdw4mdxQbBaan` | Existing qualification and commercial logic stays unchanged |
| Mini App gateway/result | live `nTZHLbv2KFggdhh5` | Verifies Telegram initData, binds server session, reads only curated ready result |

## Live-to-repository drift

| Live workflow | Live state compared with tracked artifacts | Decision |
|---|---|---|
| Lead Intake `QmIyEW2ZEqKregmN` | Behaviour matches the latest candidate/UAT export, not the older production folder | Preserve live contract; candidate-only Lead Intelligence change |
| Command Center `qF9tonlHHIxc8MDd` | Matches the terminal-close UAT candidate | Preserve |
| X-Ray Analysis `tNSMRoKlFB52vjge` | Matches the C3 deployed candidate before this feature | Use as graph baseline; generate a new candidate, do not deploy |
| Mini App Gateway `nTZHLbv2KFggdhh5` | Matches C3 cycle candidate | Preserve; no qualification redesign |
| Mini App Session `Hxje3Kel6nLLod5B` | Live includes later release/system-alert nodes than older repo candidates | Treat live as authoritative; untouched |
| Mini App Submit `ELiPdw4mdxQbBaan` | Live includes later release/system-alert nodes than older repo candidates | Treat live as authoritative; untouched |
| Concierge `mppzthlkSJFr6Kle` | Live is newer than both `n8n/production` and the latest UAT export | Material drift; untouched |
| Client Transport `ShcmmJeLSE8LYVBk` | Live has 24 nodes; tracked production export has 20 | Material drift; call the live contract by workflow ID, never rebuild it from stale export |

No destructive assumption was made from a stale workflow export. The new candidate is generated from the currently deployed X-Ray graph contract and the verified live Client Transport interface.

## Security boundaries preserved

- Lead identity remains server-owned.
- Original client facts and Raw JSON are never overwritten by owner or AI output.
- AI prompt remains PII-scrubbed; contact details travel only to the owner surface.
- Review token remains per-analysis, random, time-bounded and constant-time compared.
- Review GET remains read-only; every mutation is an explicit authenticated POST.
- Mini App initData, replay, cycle and app-session controls are unchanged.
- Customer result remains a curated allow-list in `XRay_Client_Results`; owner brief, notes, sales hypothesis, tokens and raw data are excluded.
- Telegram reachability requires evidence. A stated channel preference is stored and rendered separately.
- Successful customer contact is logged only after Client Transport returns `ok: true`.
- No credentials or secrets are added to the repository.

## Sales qualification finding

The current HOT/WARM/COLD/INCOMPLETE priority calculation combines multiple dimensions: financial risk, urgency, contactability and commercial signals. Financial zone, ICP fit, commercial intent, urgency, contactability and sales priority are therefore not fully independent in the current qualification projection. This task does not change the scoring or the qualification algorithm.

## Sales pipeline debt

Current stage semantics mix operational milestones with sales stages. In particular, `documents requested/received` and `analysis in progress` can map into `QUALIFIED`, while the `docs` command can write `deal_stage = Documents Requested`. No migration is performed here. Stage normalization requires a separate owner decision and production migration plan.

## Scope proof

- HOT/WARM/COLD rules: unchanged.
- Financial-zone calculation: unchanged.
- X-Ray deterministic score: unchanged.
- Lead identity: unchanged.
- Public website and public questionnaire: unchanged.
- No production deployment or live write was performed.

## PR #24 OWNER/CFO/CRM/Sales audit remediation — 2026-09-10

| Blocker | Resolution | Proof |
|---|---|---|
| P0-1 source pairing | Leads is read as one snapshot. A unique canonical Lead ID wins; otherwise exactly one shared request ID is required. Lead-ID collisions, request-ID collisions/misses, read errors, invalid JSON and empty JSON bypass AI and emit an owner audit finding. | `qa/xray-analysis.test.mjs` pairing and audit-finding cases |
| P0-2 Niagara facts | The deterministic case is rebuilt from a live-derived sanitized source snapshot with synthetic identifiers/PII. Selected goals and documents remain empty. `desired_first_step` is a separate `Первый шаг, выбранный клиентом` fact. | `qa/fixtures/lead-intelligence-fixtures.mjs`; regenerated HTML and PNG evidence |
| P0-3 customer eligibility | Source channel never grants publication. Only an explicit allow-listed journey response grants the ledger flag; false/missing ledger authority overrides any legacy brief claim. Niagara self-assessment is false. | eligibility, GET, POST and notification gates |
| P0-4 existing analyses | One bounded legacy row is reserved per sweep by default. It is upserted by existing `analysis_id`, preserves review/customer state, suppresses duplicate success alerts and is sealed COMPLETE/FAILED against reruns. | select/validate/upstream-failure idempotency cases |
| P1-1 after-call refresh | Owner-confirmed facts and notes retain separate provenance. Each capture versions the prior brief and refreshes diagnosis, unknowns, discovery questions and solution hypothesis without changing `client_facts`. | after-call reconciliation assertions |
| P1-2 premium owner UX | The hero prioritises identity, pain, insight, reachability and next action. A restrained six-step executive path carries pain → insight → verify → conversation → solution → action. Mobile has two primary sticky actions plus bounded overflow for eligible journeys. | desktop 1440×1100 and mobile 390×844 PNG evidence |

Repository correction only. The public website is unchanged. Production deployment and PR merge remain prohibited until separate owner approval.
