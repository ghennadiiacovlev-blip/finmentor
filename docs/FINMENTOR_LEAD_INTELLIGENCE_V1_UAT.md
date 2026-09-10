# FINMENTOR Lead Intelligence v1 — exact 5-minute owner UAT

Fixture: Niagara club, rebuilt from the live-derived sanitized semantics in `qa/fixtures/lead-intelligence-fixtures.mjs`. Identifiers and PII are synthetic. Leads and Pipeline intentionally have different synthetic Lead IDs and one shared request ID. Use the deterministic files in `qa-evidence/lead-intelligence-v1/`. Do not open Raw JSON during the test.

## 00:00–00:30 — Telegram entry point

1. Open `niagara-telegram-alert.html` at a 390 px viewport.
2. Confirm it can be read in 10–15 seconds.
3. Confirm it shows Niagara club, Александр · CEO, the main pain, one FINMENTOR observation, contact truth and one next action.
4. Confirm the contact block says `Предпочтительно: Telegram`, warns `Telegram-контакт не подключён`, and still shows phone and email.
5. Confirm the only primary actions are `Разбор клиента` and `Связаться`.

Pass condition: the alert answers “should I open this client now?” and contains no Lead ID, raw enum, score dump or technical state.

## 00:30–02:45 — Owner Brief

1. Open `niagara-owner-brief-desktop.html` at 1440 px.
2. Read the executive path first: pain → FINMENTOR insight → verify → conversation → solution → next action. Then scan sections 01–09; do not expand source answers.
3. Say aloud:
   - client: Niagara club, Александр, CEO, `Fitness`, 1–5M EUR, 100+ employees; `Услуги / консалтинг` is secondary source context, not the primary descriptor;
   - client pain: exact Pipeline wording `Платежи хаотично / кассовые разрывы`;
   - client-selected first step: `Построить систему контроля`;
   - FINMENTOR view: quick diagnostic says AR/AP `Частично`, expanded intake says AR/AP `Да`; the disagreement must be verified;
   - unknowns: the AR/AP source disagreement, forecast horizon/quality, payment governance, CAPEX, debt cost and discipline;
   - economic pain: liquidity, working capital and cost of capital;
   - opening: use the quick-diagnostic versus expanded-intake contradiction;
   - solution: a hypothesis, conditional on diagnosis;
   - next action: contact Alexander and confirm the source of the gaps.
4. Confirm `82 / 100` and GREEN are visible but visually secondary to the contradiction.
5. Confirm the labels `КЛИЕНТ ГОВОРИТ`, `FINMENTOR ВИДИТ`, `НУЖНО ПРОВЕРИТЬ` are unambiguous.

Pass condition: all ten owner acceptance questions can be answered within 2–3 minutes without Raw JSON.

## 02:45–03:20 — Mobile Brief

1. Open `niagara-owner-brief-mobile.html` (the evidence page is constrained to 390 px).
2. Scroll from header through section 09.
3. Confirm single-column reading, no horizontal scrolling, no tiny text, and exactly two sticky primary actions (`Разбор`, `Связаться`). Customer-result actions must not appear for Niagara.

Pass condition: the factual, diagnostic and decision hierarchy remains intact on mobile.

## 03:20–04:05 — Source and customer-promise boundary

1. Open `niagara-client-result-editor.html`.
2. Confirm the direct route says `Клиентский результат не предусмотрен` and contains no edit form.
3. Open `niagara-client-result-preview.html`.
4. Confirm the direct route says `Предпросмотр недоступен` and contains no approval action.
5. Confirm the owner memo shows no invented goal or document fact. `Пока только самооценка` is not displayed as a first step; `Построить систему контроля` is explicitly labelled `Первый шаг, выбранный клиентом`.

Pass condition: Niagara selected `Пока только самооценка` for review intent and independently selected `Построить систему контроля` as the requested first step; website origin alone never enables a customer result.

## 04:05–04:40 — Pairing and state truth

1. Run the deterministic source-pair test: Niagara must pair through exactly one `request_id`, never through its mismatched Lead IDs.
2. Add a second sanitized Leads row with that request ID: expected `REQUEST_ID_COLLISION`, no AI prompt, and an owner audit finding.
3. Replace Raw JSON with `{}`: expected `RAW_JSON_EMPTY`, no AI prompt, and an owner audit finding.
4. Confirm object-shaped risk zones reach the AI input as bounded `key/label/answer/score_percent` records and no `[object Object]` text exists.
5. Confirm the legacy-analysis upgrade keeps its `analysis_id`, review status, review token, client draft and version ledger.
6. Confirm a successful upgrade is excluded on the next sweep, emits no duplicate alert and never republishes a customer result.

Pass condition: unsafe source pairing and empty source facts always fail closed; backfill is bounded and idempotent.

## 04:40–05:00 — After-call capture and audit

1. Select one outcome.
2. Enter exactly three fields: `Что подтвердилось?`, `Что оказалось иначе?`, and `Следующий шаг + дата` (for example, `Получить ageing дебиторки — 15.09.2026`).
3. Save.
4. Confirm the owner brief version increments, the prior version remains in audit history, CFO diagnosis/unknowns/discovery questions/solution hypothesis refresh, next action/date project to Pipeline, and an Activities event is appended.
5. Confirm the original client fact list is byte-identical before and after save.

Pass condition: capture takes under 60 seconds, refreshes the derived intelligence layer, and changes only owner-derived intelligence plus narrow operational fields.
