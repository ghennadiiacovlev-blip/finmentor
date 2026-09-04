# Premium UX checkpoint — Owner Command Center + Client X-Ray Result (2026-09-04)

**Status:** OWNER VISUAL APPROVAL = APPROVED and **DEPLOYED LIVE 2026-09-04 09:47–09:55 UTC** (owner ran the five `--confirm` commands in order; every step fresh-read and verified below). `RELEASE_MODE` stays `OWNER_ONLY`. Canonical QA at freeze: 76/76 gates, 2662 assertions, floors PASS.

Presentation only. Nothing in this checkpoint changes lead routing, triggers, Telegram credentials,
HOT/WARM/COLD or zone semantics, CRM stages, callback_data, X-Ray scoring or the AI contract,
CLIENT_READY semantics, Session/Submit/Gateway/Concierge authority, or System Alert routing.

## A. FINMENTOR Lead Alerts — owner cards (RU owner UI)

Source: `n8n/src/lead-alerts/presenter.js` (module, inlined by `scripts/build-lead-alerts-presentation.mjs`
into the 7 builder nodes of 5 workflows; 6 candidates rebuilt incl. `system-alert-workflow.json`).

- Eight header types renamed to Russian with ONE leading icon: 📋 Утренний бриф, 🔔 Новый лид,
  ⏳ Требует внимания, 🔁 Напоминание, ⚠️ Неполные данные, 🛠 Системное уведомление,
  ✅ Система восстановлена, 🧾 Целостность данных. Header contract in the presentation gate updated
  accordingly; emoji allowed only in header first position and as the single priority/zone icon.
- NEW LEAD: company (falls back to contact name), `role · Источник: …` (+ «Клиент: RO» only for RO),
  `Приоритет: 🔥/🕒/⚪/❔ …`, `Финансовая зона: 🔴/🟠/🟡/🟢 …` (owner vocabularies unchanged),
  «Запрос», «Контекст» (classified situation line + `Связь: …` — the 2026-08-30 one-channel decision
  kept), «Следующий шаг». No `<code>Lead ID</code>` in any body (NEW LEAD, PRIORITY, FOLLOW-UP,
  LEAD INCOMPLETE).
- PRIORITY: `Просрочено: N дней` / `Срок: сегодня|завтра|date`, «Причина», «Следующий шаг»,
  `Приоритет:` (from the SLA Select prefix). Keyboards, callback_data, chatId, credentials byte-identical.
- Builder models: `language: item.language`, `contactName: item.name` (NEW LEAD / WARM), `priority` (SLA).
- Decision record appended to `docs/LEAD_ALERTS_OWNER_PRESENTATION.md`.

## A′. X-Ray owner cards

Source: `n8n/src/xray-analysis/owner-cards.js` (new; inlined into `Validate + Store Rows`,
`Review POST Verdict`, `Analysis Failed Row` via `scripts/build-xray-analysis-workflow.mjs`).

- 📊 Финансовый рентген — company, `context · Клиент: RU|RO` (industry · turnover · employees,
  user-explicit questionnaire labels from `build-input.js` `company_context`), `47 / 100 · 🟠
  Существенные пробелы` or `⚪ Недостаточно данных для оценки` (once), `Зрелость …: n/5`,
  «Ключевой риск», «Управленческие приоритеты» ①②③, «Рекомендация FINMENTOR» (RU owner label, never
  the client-locale label), optional `⚠️ Требуется проверка исходных данных` (fabrication flags or
  LOW confidence; the raw flag never renders), `Статус: ожидает проверки консультанта`.
  Zone wording: RED Критическая зона · ORANGE Существенные пробелы · YELLOW Требует внимания ·
  GREEN Устойчивое управление · UNKNOWN Недостаточно данных для оценки.
- Buttons: «✅ Проверить анализ» (review GET) · «📊 Карточка лида» (CRM, Pipeline row anchor when known).
- ✅ Анализ подтверждён — NEW node `Telegram Analysis Approved` after `Respond Review Done`, gated by
  `IF First Promotion` (`notify_owner` = verdict PROMOTE only; ALREADY_READY sends nothing).
  The ledger row now carries `company` (autoMap appends the column) so the notice can name it.
- ❌ Анализ не сформирован — validation failure and OpenAI failure notices restyled (cause in Russian,
  no Lead ID, no raw class).
- Deploy dry-run (`deploy-c3-xray.mjs --dry-run`, 05:41Z): 37 → 39 nodes; added `IF First Promotion`,
  `Telegram Analysis Approved`; rewritten `Build Analysis Input`, `Analysis Failed Row`,
  `Validate + Store Rows`, `Telegram Owner Alert`, `Review POST Verdict`. NOT confirmed.
- A5 duplicate AI BRIEF: `scripts/mute-lead-intake-ai-brief.mjs` prepared (disables ONLY the
  `Telegram AI Work Plan` node of Lead Intake; AI_Plans keeps being written). Its `--dry-run` was
  blocked by the session's permission classifier — owner to run `--dry-run` then decide.

## B. Client X-Ray result screen

`app-premium/app.js` (`scrResult`, `UI.*.result`), `app-premium/app.css` (`.xr-*` block only),
host candidate rebuilt (`scripts/build-miniapp-host.mjs`). Contract untouched: `net.js` RESULT_KEYS,
Gateway allow-list and publisher keys still equal (61-check gate).

- Hero: product label kicker, «Результат анализа», score `47 / 100` or «Оценка не рассчитана» +
  «Недостаточно исходных данных для количественной оценки.» (zone line omitted, «Без оценки» never
  printed), «Финансовое состояние: …», «Зрелость финансового управления: n/5».
- Sections: Резюме · maturity · risks (priority tag, evidence) · priorities · plan as
  «Этап 1 · Дни 1–7» … «Этап 4 · Дни 22–30» (max 3 actions, expected output muted) · next actions ·
  recommendation. Disclaimer A (score) / B (no score, honest wording). RO equivalents.
- Preview: `node scripts/build-result-preview.mjs` → `.uat/result-preview.html?case=ru-score|ru-noscore|ro-score|ro-noscore`.
  Captured at true 390/430 CSS px (iframe inside a 600-px headless window; Chrome refuses narrower
  windows) and 1280: no horizontal overflow, one 56-px CTA, safe-area padding kept.

## QA (all offline, deterministic)

| gate | checks |
|---|---|
| `qa/owner-cards-golden.test.mjs` (new) | 16 |
| `qa/xray-owner-cards-golden.test.mjs` (new) | 24 |
| `qa/premium-ux-result-render.test.mjs` (new, fixtures `qa/fixtures/client-result-fixtures.mjs`) | 10 |
| `qa/lead-alerts-presentation.test.mjs` | 36 (was 32: +4 for icon table, no lead id, company fallback/RO marker, PRIORITY date lines) |
| `qa/premium-ux-result-screen.test.mjs` | 10 (was 9: + no-score variant) |
| `qa/xray-analysis.test.mjs` | 143 (was 138: +5 for the card, the warning line, the approved branch) |
| `qa/lead-alerts-candidates`, `-actions`, `-ack-expression`, `-edit-noop`, `system-alert`, `premium-ux-tg-presentation` | 18 · 56 · 23 · 17 · 43 · 23 (unchanged counts; assertions retargeted to the new copy) |
| `node qa/run-all.mjs` | **73/73 gates, 2629 assertions, floors PASS** (baseline raised only where checks were added) |

Tooling fixed on the way: `build-lead-alerts-presentation.mjs`, `build-system-alert.mjs` read sources as LF
(core.autocrlf checkouts).

## Owner correction (same day) — RO free text, button label, AI-brief suppression proof

1. **No Romanian free text on the Russian console.** Deterministic rule in both presenters
   (`ownerSafe`): Cyrillic passes; Latin passes only when nothing but allow-listed product/finance
   terms, units, digits and punctuation remains; any Romanian diacritic fails. Lead Alerts NEW LEAD
   (RO lead): role/next step/RO classified labels omitted, the request becomes «См. карточку лида в
   CRM», units survive, «Клиент: RO» is the only trace; a RO lead whose fields are already Russian
   (the RO questionnaire posts canonical Russian values) renders normally. X-Ray card (RO client):
   the model's risk/priority text is never rendered; the questionnaire's canonical risk-zone codes
   map to Russian (`cash_flow → Денежный поток (Cash Flow)`, `management_pl`, `payments`,
   `receivables_payables`, `margin`, `kpi_dashboard`, `data_systems`) as «Ключевой риск» + «Зоны
   риска по анкете»; with no codes the card says «См. подробный анализ клиента». The customer's own
   Romanian result is untouched (contract gate 61 still green). Goldens: `owner-cards-golden` 17,
   `xray-owner-cards-golden` 26 (RO leak regexes on both).
2. **«🗂 В наблюдение».** `actions.js` LABEL only; callback_data grammar byte-identical
   (`nurture|<id>` etc., gate `lead-alerts-actions` 57). The module is inlined into four live
   workflows, so `scripts/refresh-lead-alert-labels.mjs` re-inlines the current module (and the
   presenter/tz blocks where present) by splitting each node at fixed markers and keeping the tail
   byte-for-byte: Command Center `Find & Build Update` + `Verify Mutation`, SLA `Build SLA Alert
   Keyboard`, Follow-up `Build Followup Alert Keyboard`, Lead Intake `Telegram Lead Alert` (one
   literal button text). `--dry-run` PASSED against live (04 Sep 09:2xZ): candidates
   `lead-command-center-labels-candidate.json` + the three `*.alert-keyboards-candidate.json`;
   rollbacks `.uat/<id>.pre-labels.json`. Gate `lead-alert-labels-refresh` (10) proves the delta,
   idempotence and refusals; `lead-alerts-edit-noop` now drives the labels candidate (17).
   Historical candidates (`stage2`, `ack-fix`, `edit-noop`, `system-alert-caller-lead-intake`) keep
   the old label as records of past deploys and as the gate's live stand-in.
3. **AI-brief suppression proof.** Live Lead Intake fresh-read: four Telegram nodes; `Telegram AI
   Work Plan` is fed only by `Build Short AI Telegram` and has no downstream edge; the AI_Plans
   sheet write is a sibling branch (`Parse AI Plan → Build AI Plan Row → Save AI Plan`). Gate
   `ai-brief-suppression` (9) executes `muteCandidate`/`verifyDelta` on the tracked Lead Intake
   candidate: exactly one node changes (disabled flag), NEW LEAD HOT/WARM/INCOMPLETE untouched,
   X-Ray notices live in the X-Ray workflow, no edge/setting/credential/trigger/Sheets node changes,
   wider deltas refused.

Canonical suite after the correction: **75/75 gates, 2652 assertions, floors PASS** (raised only
where checks were added: owner-cards-golden 16→17, xray-owner-cards-golden 24→26,
lead-alerts-actions 56→57; new gates 9 + 10).

## Final copy polish (same day, owner instruction)

1. Company scale in one owner format: `scaleLabel()` in both presenters («1–5M €» → «1–5 млн EUR»,
   «€500 тыс. – €2 млн» → «500 тыс. – 2 млн EUR», unknown shapes untouched); a bare head-count
   range in the NEW LEAD situation line gets «сотрудников» (`employeesLabel()`); the X-Ray card
   already did. Example: «1–5 млн EUR · 50–100 сотрудников».
2. RO NEW LEAD neutral pointer: «Запрос клиента доступен в карточке лида CRM».
3. One canonical zone vocabulary on every owner card — RED 🔴 Критическая зона · ORANGE 🟠
   Существенные пробелы · YELLOW 🟡 Требует внимания · GREEN 🟢 Устойчивое управление · UNKNOWN ⚪
   Недостаточно данных. «Повышенный риск», «Есть зоны риска», «Устойчиво», «… для оценки» retired.
   The Lead Alerts card now also renders an UNKNOWN zone line. The presentation gate's old
   "no shared word between priority and zone vocabularies" rule is replaced by the labelled-line
   rule («Приоритет:» / «Финансовая зона:» prefixes), because the owner's canonical vocabulary
   deliberately reuses «Требует внимания» for YELLOW.

Gates after the polish: owner-cards-golden 17, xray-owner-cards-golden 27 (+ scale test),
lead-alerts-presentation 36, candidates 18, actions 57, edit-noop 17, labels-refresh 10,
xray-analysis 143; canonical **75/75 gates, 2653 assertions, floors PASS**. Candidates rebuilt
(presentation, system-alert, X-Ray SDK, label refresh dry-run).

## Deployment mapping (Phase 2, fresh-read 2026-09-04 09:40 UTC) and dry runs (Phase 3)

Frozen at commit `03da6f1` on `feat/miniapp-b21c-live-prereqs` (canonical 75/75, 2653 at freeze).

| # | live workflow (fresh-read) | id | nodes | scope | script | dry-run |
|---|---|---|---|---|---|---|
| 1 | FINMENTOR Daily Lead Digest PREMIUM FINAL | `imeJIDeNyaWDyXzh` | 9 | A presenter block in `Build Daily Digest` | `refresh-lead-alerts-presenter.mjs` | PASS |
| 1 | FINMENTOR SLA Lead Watch PREMIUM FINAL | `LZ2mvKXbBikmeVTn` | 13 | A presenter block in `SLA Select` | same | PASS |
| 1 | FINMENTOR Followup Sequence PREMIUM v2 | `zeLOCuf0K1bkaKl2` | 18 | A presenter block in `Build Followup Plan` | same | PASS |
| 1 | FINMENTOR Error Monitor PREMIUM | `RBiFLhVjizMkAzrK` | 5 | A presenter block in `Build Error Alert` | same | PASS |
| 1 | FINMENTOR Lead Intake PREMIUM FINAL | `QmIyEW2ZEqKregmN` | 109 | A presenter block in the 3 brief builders | same | PASS |
| 1 | FINMENTOR SYSTEM ALERT | `ID700kTo6EXffwry` | 8 | A presenter block in `Build System Alert` (header «🛠 Системное уведомление»; routing untouched) | same | PASS |
| 2 | FINMENTOR Lead Command Center SECURE CANDIDATE | `qF9tonlHHIxc8MDd` | 33 | D module blocks in `Find & Build Update`, `Verify Mutation` | `refresh-lead-alert-labels.mjs` | PASS |
| 2 | SLA Lead Watch / Followup Sequence | above | | D module block in `Build SLA Alert Keyboard` / `Build Followup Alert Keyboard` | same | PASS |
| 2 | Lead Intake | above | | D one button text in `Telegram Lead Alert` (callback_data identical) | same | PASS |
| 3 | Lead Intake | above | | C `Telegram AI Work Plan` → `disabled: true`, nothing else | `mute-lead-intake-ai-brief.mjs` | PASS |
| 4 | FINMENTOR X-Ray Analysis | `tNSMRoKlFB52vjge` | 37→39 | B `Validate + Store Rows`, `Analysis Failed Row`, `Review POST Verdict`, `Build Analysis Input`, `Telegram Owner Alert` rewritten; `IF First Promotion`, `Telegram Analysis Approved` added | `deploy-c3-xray.mjs` | PASS (32 live nodes byte-identical) |
| 5 | [UAT] FINMENTOR Premium Mini App host (owner-only) | `KBD7Q94QQnlzgYKJ` | 2 | E `Serve Page.responseBody` only; `6d3afe66… → 0f40b50b…` | `deploy-c3-miniapp-host.mjs` | PASS |

Why a refresh and not `deploy-lead-alerts-presentation.mjs`: that script refuses unless live equals its
pre-presentation snapshot or its last deployed record, and SLA / Follow-up / Lead Intake moved after
those records (keyboards Stage 1, Lead Intake fixes). `refresh-lead-alerts-presenter.mjs` replaces
only the inlined module block at the head of each builder node (gate `lead-alerts-presenter-refresh`,
9 checks, drives it against the tracked deployed records and proves block-only deltas, executed
headers, idempotence, refusals). The host deploy guard now requires the approved RO title
«Rezultatul analizei» and the stage labels instead of the retired «Rezultatul este gata».

Not touched by any command above: Session `Hxje3Kel6nLLod5B`, Submit `ELiPdw4mdxQbBaan`, Gateway
`nTZHLbv2KFggdhh5`, Concierge, routing, triggers, credentials, callback_data, CRM writes, scoring,
CLIENT_READY semantics; `RELEASE_MODE` stays `OWNER_ONLY` (Session/Submit untouched).

Rollbacks written by the dry runs (`.uat/`): `<id>.pre-presenter-refresh.json` (6), `<id>.pre-labels.json`
(4, captured before any confirm and KEPT by `keepRollback`), `QmIyEW2ZEqKregmN.pre-mute-ai-brief.json`,
`tNSMRoKlFB52vjge.pre-c3-xray.live-<ts>.json` (the live 37-node v2), `KBD7Q94QQnlzgYKJ.pre-c3-host.live-<ts>.json`.

Execution order of the confirms (each script fresh-reads live, so the three scripts that touch Lead
Intake / SLA / Follow-up compose): presenter refresh → label refresh → AI-brief mute → X-Ray → host.

## LIVE DEPLOYMENT RECORD — 2026-09-04 09:47–09:55 UTC (owner `--confirm` ×5, fresh-read after each)

| # | command | live result | verification |
|---|---|---|---|
| 1 | `refresh-lead-alerts-presenter.mjs --confirm` (09:47:50–09:47:52) | 6 workflows written and read back, all active | every declared node's presenter block = the current module; Telegram nodes, credentials, edges, settings byte-equal to the pre-image; **unexpected delta 0** on all six. Executed from the deployed Lead Intake node: «🔔 FINMENTOR · Новый лид», «🟠 Существенные пробелы», «5–10 млн EUR · 50–100 сотрудников»; RO render = NO LEAK, «Запрос клиента доступен в карточке лида CRM»; `validate()` clean |
| 2 | `refresh-lead-alert-labels.mjs --confirm` (09:49:56–09:49:57) | 4 workflows written and read back, all active | old label gone / new label present on all four; step 1 presenter still CURRENT on the three shared workflows; edges/settings unchanged; **unexpected delta 0**. Live NEW LEAD keyboard: `📞 Discovery→stage\|…\|Discovery Scheduled`, `📄 Документы→docs\|…`, `⏰ На 24 часа→snooze\|…\|24`, `🗂 В наблюдение→nurture\|…`. Deployed Command Center executed: same five callbacks, `won` still not emitted |
| 3 | `mute-lead-intake-ai-brief.mjs --confirm` (09:51:37) | Lead Intake written and read back, active | exactly ONE of 109 nodes changed: `Telegram AI Work Plan` `disabled: true`. The three NEW LEAD senders enabled; 12 Google Sheets nodes byte-equal; `Parse AI Plan → Build AI Plan Row → Save AI Plan` intact; edges, settings, credentials unchanged |
| 4 | `deploy-c3-xray.mjs --confirm` (09:52:48) | 37 → 39 nodes, active, versionId `3b29b91a…`, validator xray-v2 | `Respond Review Done → IF First Promotion → Telegram Analysis Approved`, gate reads `notify_owner`, same owner chat + bot credential; owner-alert buttons «✅ Проверить анализ» / «📊 Карточка лида», chatId + credentials unchanged; GET review chain unchanged; curated publisher, client-result builder and the whole sweep/selection path (incl. scoring and the model node) byte-equal; 16 credential bindings unchanged. Executed from the deployed node: RO review card in Russian, NO LEAK; approved and failure cards as approved. Two extra changed nodes vs the declared five differ **only by `webhookId`** (n8n regenerates it on save for non-trigger Telegram nodes; inert) |
| 5 | `deploy-c3-miniapp-host.mjs --confirm` (09:55:03) | 2 nodes, active; `Serve Page` only | page `6d3afe66…` → `0f40b50b…` (122 620 → 132 778 bytes); other Serve Page params, `Open Mini App`, edges, settings unchanged; live GET returns 200 `text/html` byte-identical to the stored page; approved copy present («Результат анализа», «Rezultatul analizei», «Этап 1 · Дни 1–7» … «Этап 4 · Дни 22–30», «Etapa 1 · Zilele 1–7», «Оценка не рассчитана», «Scorul nu a fost calculat», pending note); retired copy absent («Результат готов», «Rezultatul este gata»); `days_1_7` / `zone_label` / `CLIENT_READY` appear in code only, never rendered |

Untouched and fresh-read after all five: Session `Hxje3Kel6nLLod5B` (17 nodes, `RELEASE_MODE = "OWNER_ONLY"`), Submit `ELiPdw4mdxQbBaan` (32, `"OWNER_ONLY"`), Gateway `nTZHLbv2KFggdhh5` (32, client-result allow-list still the 12 curated keys), Concierge `mppzthlkSJFr6Kle` (60) — none updated since before 09:40Z. Error Monitor last execution 5056 (08-31), SYSTEM ALERT 5076 (08-31). Tenant executions 09:40–09:56Z: 3 (5517–5519), 0 non-success.

**Rollback artefacts — use the timestamped asides, not the named files** (the named ones predate this session's earlier deploys):

| workflow | rollback file |
|---|---|
| the six presenter workflows | `.uat/<id>.pre-presenter-refresh.json` (exact) |
| Command Center | `.uat/qF9tonlHHIxc8MDd.pre-labels.json` (exact) |
| SLA / Followup / Lead Intake (labels) | `.uat/<id>.pre-labels.live-2026-09-04T09-49-55-*.json` — **not** `pre-labels.json`, which predates step 1 |
| Lead Intake (mute) | `.uat/QmIyEW2ZEqKregmN.pre-mute-ai-brief.live-2026-09-04T09-51-37-154Z.json` |
| X-Ray | `.uat/tNSMRoKlFB52vjge.pre-c3-xray.live-2026-09-04T09-52-48-262Z.json` — **not** `pre-c3-xray.json` (04:08Z capture) |
| Mini App host | `.uat/KBD7Q94QQnlzgYKJ.pre-c3-host.live-2026-09-04T09-55-03-546Z.json` |

Still owner-only to observe on the next real lead/analysis: a NEW LEAD card in the bot, an X-Ray review card and its «✅ Анализ подтверждён» follow-up after a confirmation, and the absence of the second «FINMENTOR AI BRIEF» message.

## Not done / owner decisions

1. Deploy of the X-Ray candidate (`deploy-c3-xray.mjs --confirm`) and the Lead Alerts candidates — after approval.
2. AI BRIEF mute — owner runs `node scripts/mute-lead-intake-ai-brief.mjs --dry-run`, then decides.
3. Lead Alerts keyboard labels («🗂 В Nurture», «📞 Discovery») left as they are (callback surface); a
   label-only relabel to «В наблюдение» / «Встреча» is possible in a separate keyboard deploy.
4. RO leads: the model's risk/priority free text is Romanian inside the Russian card (no RU rendering
   exists for model output); metadata line marks «Клиент: RO».
