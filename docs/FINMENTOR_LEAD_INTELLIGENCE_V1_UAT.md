# FINMENTOR Lead Intelligence v1 — exact 5-minute owner UAT

Fixture: Niagara club. Use the deterministic files in `qa-evidence/lead-intelligence-v1/`. Do not open Raw JSON during the test.

## 00:00–00:30 — Telegram entry point

1. Open `niagara-telegram-alert.html` at a 390 px viewport.
2. Confirm it can be read in 10–15 seconds.
3. Confirm it shows Niagara club, Александр · CEO, the main pain, one FINMENTOR observation, contact truth and one next action.
4. Confirm the contact block says `Предпочтительно: Telegram`, warns `Telegram-контакт не подключён`, and still shows phone and email.
5. Confirm the only primary actions are `Разбор клиента` and `Связаться`.

Pass condition: the alert answers “should I open this client now?” and contains no Lead ID, raw enum, score dump or technical state.

## 00:30–02:45 — Owner Brief

1. Open `niagara-owner-brief-desktop.html` at 1440 px.
2. Read only the header and sections 01–09; do not expand source answers.
3. Say aloud:
   - client: Niagara club, Александр, CEO, fitness, 1–5M EUR, 100+ employees;
   - client pain: cash gaps / chaotic payments;
   - FINMENTOR view: control instruments exist, yet liquidity failures remain;
   - unknowns: forecast horizon/quality, payment governance, AR/AP, CAPEX, debt cost and discipline;
   - economic pain: liquidity, working capital and cost of capital;
   - opening: use the Cash Flow/budget/payment-calendar contradiction;
   - solution: a hypothesis, conditional on diagnosis;
   - next action: contact Alexander and confirm the source of the gaps.
4. Confirm `82 / 100` and GREEN are visible but visually secondary to the contradiction.
5. Confirm the labels `КЛИЕНТ ГОВОРИТ`, `FINMENTOR ВИДИТ`, `НУЖНО ПРОВЕРИТЬ` are unambiguous.

Pass condition: all ten owner acceptance questions can be answered within 2–3 minutes without Raw JSON.

## 02:45–03:20 — Mobile Brief

1. Open `niagara-owner-brief-mobile.html` (the evidence page is constrained to 390 px).
2. Scroll from header through section 09.
3. Confirm single-column reading, no horizontal scrolling, no tiny text, and usable sticky actions.

Pass condition: the factual, diagnostic and decision hierarchy remains intact on mobile.

## 03:20–04:05 — Client edit and exact preview

1. Open `niagara-client-result-editor.html`.
2. Confirm editable fields are limited to summary, maturity explanation, risks, priorities, 30-day plan, immediate actions and recommendation label/rationale.
3. Confirm score, zone, original answers and Lead ID cannot be edited.
4. Open `niagara-client-result-preview.html`.
5. Confirm the preview contains only client-safe content and exactly represents the saved client draft.
6. Confirm approval says `Утвердить и сделать доступным`; it does not claim the client was notified.

Pass condition: the owner can edit, preview and approve in 2–5 minutes, and owner-only sales intelligence never appears in the client result.

## 04:05–04:40 — State and delivery truth

1. Save an edit: expected state `OWNER_EDITED`; no client publication.
2. Approve from preview: expected state `CLIENT_READY`; curated Data Table upsert occurs.
3. Niagara has no verified Telegram route: expected owner message says automated delivery is unavailable; state stays `CLIENT_READY`.
4. Record manual notification with channel: expected `CLIENT_NOTIFIED` with timestamp and actor.
5. For a verified Mini App Telegram fixture, simulate Client Transport failure: state must stay `CLIENT_READY` and no successful activity is written.
6. Simulate `{ ok: true }`: expected `CLIENT_NOTIFIED` and one Activities row.
7. Confirm nothing infers `CLIENT_VIEWED`.

Pass condition: AVAILABLE, NOTIFIED and VIEWED are never conflated.

## 04:40–05:00 — After-call capture and audit

1. Select one outcome.
2. Enter exactly three fields: `Что подтвердилось?`, `Что оказалось иначе?`, and `Следующий шаг + дата` (for example, `Получить ageing дебиторки — 15.09.2026`).
3. Save.
4. Confirm the owner brief version increments, the prior version remains in audit history, next action/date project to Pipeline, and an Activities event is appended.
5. Confirm the original client fact list is byte-identical before and after save.

Pass condition: capture takes under 60 seconds and changes only derived owner intelligence plus narrow operational fields.
