# FINMENTOR — Production Completion Program v1: actual-state baseline

**Recorded:** 2026-09-03, before any change. Every fact below was read live (git, n8n tenant,
Google Sheets CRM, Supabase, public site), not recalled from earlier reports.

## GIT

| item | value |
|---|---|
| branch | `feat/miniapp-b21c-live-prereqs` (tracks origin, clean tree) |
| HEAD | `782d8de` |
| main / origin/main | `71e4751` |
| divergence | branch is 126 commits ahead of main; main has 4 commits not on the branch (PR #18 request identity, PR #19 RO home page lead submit) |
| open PRs | none |
| production tree | GitHub Pages serves `main`; verified byte-identical for `analytics.js`, `index.html`, `questionnaire.html`, `ro/index.html` |
| public web delta main→branch | only `ro/index.html` (one line, the PR #19 fix is on main, not on the branch) |

## N8N (tenant `ghennadi.app.n8n.cloud`, 41 workflows)

Active (13): SYSTEM ALERT `ID700kTo6EXffwry`, Concierge `mppzthlkSJFr6Kle`, Lead Intake
`QmIyEW2ZEqKregmN`, Mini App Gateway `nTZHLbv2KFggdhh5`, Mini App Session `Hxje3Kel6nLLod5B`,
Mini App Submit `ELiPdw4mdxQbBaan`, Command Center SECURE CANDIDATE `qF9tonlHHIxc8MDd`,
Followup v2 `zeLOCuf0K1bkaKl2`, SLA Watch `LZ2mvKXbBikmeVTn`, Mini App host (owner-only)
`KBD7Q94QQnlzgYKJ`, Error Monitor `RBiFLhVjizMkAzrK`, Daily Digest `imeJIDeNyaWDyXzh`,
Telegram Client Transport `ShcmmJeLSE8LYVBk`, B.2.1-C Gateway Test Page `EU91nSsmqQqIeD8w`
(test surface, still active). The old Command Center `Ukn1cprWiXzBHojl` is inactive.

Credentials by name: FINMENTOR Client Concierge Bot (telegram), FINMENTOR Leads Bot FINAL
(telegram), Google Sheets OAuth2 API, OpenAI account, OpenRouter account (unused), FINMENTOR
Supabase G5, FINMENTOR Privacy Audit Writer, FINMENTOR Alerts Writer / Dispatcher (deferred
Outbox), Postgres account (legacy Neon, must not be used).

Data Tables: `MiniApp_App_Sessions`, `Submission_Receipts`, `FINMENTOR_B21B_SESSION_READMODEL_QA`.

**Access constraint found:** none of the production workflows has `availableInMCP` enabled and
no `N8N_API_KEY` is present in this session, so production workflows can be read only from the
tracked exports in `n8n/production/` and cannot be mutated from this session. New workflows can
be created through the MCP connector. See §"Blockers".

## CRM (Google Sheets `FINMENTOR_LEADS_CRM_PREMIUM_FINAL`, 16 tabs)

- Pipeline: 70 header columns. A:BG designed (59), BH:BO accidental Command Center residue
  (`_found`, `from_stage`, `to_stage`, `stage_changed`, `command`, `chat_id`,
  `callback_query_id`, `reply_text`), BP:BR premium fields (`current_setup`,
  `decision_horizon`, `important_context`). 12 live rows.
- `status` values live: New, Nurture, Incomplete lead, Qualified. `deal_stage` vocabulary in code:
  New, Qualified, Nurture, Incomplete, Discovery Scheduled, Documents Requested, Proposal Sent,
  Won, Lost. `priority`: HOT/WARM/COLD/INCOMPLETE. `financial_zone`: GREEN/YELLOW/ORANGE/RED/UNKNOWN.
- Follow-up: `next_follow_up_at` on Pipeline, `Followups` tab (0 rows), hourly Followup v2 and
  SLA Watch, Daily Digest 08:30 Europe/Chisinau. All owner-facing, none customer-facing.
- Existing AI lane inside Lead Intake: `AI Gate` (HOT only by default) → `AI Client Work Plan`
  (OpenAI `gpt-4.1-mini`, 26-field internal work plan with a 7-day plan) → `AI_Plans` tab
  (1 row) → `ai_plan_ready` flag → owner "AI BRIEF". No 30-day plan, no locale, no review state,
  no customer-facing output. **No XRay_Analysis store exists.**
- Settings tab keys: owner_chat_id, manager_chat_id, allowed_chat_ids, timezone,
  default_responsible, sla_*, ai_model, ai_enabled_for_hot/warm/cold, follow_up_*, etc.

## PUBLIC

RU root and `/ro/` live (200): home, questionnaire (Financial X-Ray), thank-you, privacy.
GA4 Measurement ID `G-94L9B8WZ12` is the single runtime ID (obsolete `G-94L98WZ12` survives only
in retracted markdown, CI-asserted absent). Consent gate: `finmentor_cookie_consent`, gtag loads
only after accept. Attribution first/last touch in `localStorage`, consent-independent.
Events: page_view, generate_lead (thank-you only, deduped), lead_form_start, contact_click,
resource_download, diagnostic_start, diagnostic_complete, intake_submit, meeting_requested,
lead_submit. Server-side GA4 lifecycle: designed, **not implemented** (BLOCKED_EXTERNAL_SECRET).
RO surface: 184 occurrences of "Radiografia Financiară" across 34 files; formal register.

## MINI APP / BOT

- `app-premium/` b3.1.0, RU-only string table, 22 screens, endpoints
  `/webhook/finmentor-miniapp-{gateway,session,submit}`, host `KBD7Q94QQnlzgYKJ` owner-only.
- Gateway: Ed25519 initData validation, G5 replay ledger in Supabase
  (`public.telegram_initdata_replays`), app session in `MiniApp_App_Sessions` with
  **`cycle_id: ''`**, 72 h TTL. Owner gate `OWNER_TELEGRAM_ID` on Session and Submit.
- Submit: derives `submission_key`, privacy ack → `privacy.privacy_acknowledgements`, receipt →
  `Submission_Receipts`, Lead Intake via Execute Workflow (internal route), `state=submitted`.
- Concierge: RU only, deterministic (no AI node despite the name), mints `cycle_id` +
  `submission_key` on `/start` and rotation, writes `Bot_Sessions` A:AZ.
- Known open: cycle projection absent (customer activation blocked), premium NEW LEAD alert never
  fires for Mini App / Concierge leads (internal route ends before alerting), 4 orphan READY
  receipts, F13 SUBMIT_UNRESOLVED terminal.

## SUPABASE (`finmentor-prod`, PostgreSQL 17)

`public.telegram_initdata_replays` (G5), `privacy.privacy_acknowledgements`, `alerts.*` (Outbox,
deferred, 0 rows). Migrations 0001–0003 applied. Login roles: alerts_*_rt, privacy_audit_writer.

## PRIVACY

`privacy.html` §8 names n8n, Google Sheets, Telegram, OpenAI (anonymised only). No human-review
sentence in privacy (it is in `terms.html` §5/§6). "Not a statutory audit" only on questionnaire
pages. Supabase not named. Draft RU/RO notices in `docs/legal/` remain unapproved.

## Blockers recorded at baseline

1. Production n8n workflows are not reachable for mutation from this session (no API key,
   MCP access disabled per workflow). Needed by C1.5 (review action in Command Center), C2,
   C3 (Gateway/Session/Submit/Concierge), C4.6.
2. Owner chat id lives only in the Settings tab (correct) — every new alert must read it there.
