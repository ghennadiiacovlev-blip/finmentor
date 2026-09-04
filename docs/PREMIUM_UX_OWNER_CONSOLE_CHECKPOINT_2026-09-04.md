# Premium UX checkpoint — Owner Command Center + Client X-Ray Result (2026-09-04)

**Status:** OWNER VISUAL APPROVAL = APPROVED (2026-09-04, as rendered after the correction and the copy polish). NOT DEPLOYED — awaiting owner deployment authorization. `RELEASE_MODE` stays `OWNER_ONLY`. Canonical QA at freeze: 75/75 gates, 2653 assertions, floors PASS.

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

## Not done / owner decisions

1. Deploy of the X-Ray candidate (`deploy-c3-xray.mjs --confirm`) and the Lead Alerts candidates — after approval.
2. AI BRIEF mute — owner runs `node scripts/mute-lead-intake-ai-brief.mjs --dry-run`, then decides.
3. Lead Alerts keyboard labels («🗂 В Nurture», «📞 Discovery») left as they are (callback surface); a
   label-only relabel to «В наблюдение» / «Встреча» is possible in a separate keyboard deploy.
4. RO leads: the model's risk/priority free text is Romanian inside the Russian card (no RU rendering
   exists for model output); metadata line marks «Клиент: RO».
