# FINMENTOR Phase B.2 — Premium Telegram Mini App

Status: DESIGN / RELEASE SPEC
Branch: `feat/phase-b2-premium-miniapp`
Base: `main@ca0b9ecee07b63632f68646f54955b89537df946`
Production backend status at spec time: Phase B + B.1 GO. Existing Concierge / Lead Intake / Transport semantics are frozen for this phase unless a separate backend change is explicitly approved.

## 1. Product goal

Build a premium FINMENTOR client experience inside Telegram that feels like a compact executive financial product rather than a questionnaire.

The Mini App is a **presentation + guided-intake layer** over the existing FINMENTOR backend. It must not become a second CRM, a second source of lead truth, or a second consent model.

Primary outcomes:

1. Make the first interaction feel premium, fast and trustworthy.
2. Make diagnostics easier to complete than a long chat flow.
3. Preserve the existing canonical Lead Intake / Pipeline / consent / cycle contracts.
4. Give the client a useful visual result before expert contact.
5. Keep Telegram bot as concierge, fallback channel and notification surface.

## 2. Non-negotiable architecture principles

- `Pipeline` remains the canonical current lead state.
- Existing Lead Intake remains the only canonical lead submission endpoint.
- Existing Concierge cycle / consent semantics remain authoritative.
- Mini App never writes directly to Google Sheets.
- Mini App never receives or stores bot tokens, Google credentials or n8n credentials.
- Telegram `initData` must be treated as untrusted in the browser and validated server-side before any privileged write.
- Mini App may cache draft answers locally for UX, but not treat browser storage as a business record.
- A successful business submission exists only after backend returns `ok === true` and canonical `lead_id`.
- Consent is explicit and cycle-scoped. Opening the Mini App is not consent to submit a lead.
- AI may enrich or explain, but cannot become the canonical system of record.

## 3. Placement in the current FINMENTOR stack

```text
Telegram Client Bot
      │
      ├── quick navigation / alerts / fallback
      │
      └── opens FINMENTOR Mini App
                │
                ▼
        Static premium UI
        finmentor.md/app/
                │
                ▼
        n8n Mini App Gateway
        - validate Telegram initData
        - create/resume app session
        - normalize payload
        - enforce consent
        - call existing Lead Intake
                │
                ▼
         Existing Lead Intake
                │
        ┌───────┼────────┐
        ▼       ▼        ▼
     Pipeline  Leads   Activities / AI
```

The Mini App Gateway is orchestration, not a second CRM.

## 4. Front-end implementation decision

The current FINMENTOR website is a static GitHub Pages implementation using vanilla HTML/CSS/JS and an existing premium design system. Phase B.2 should therefore begin as a **build-free isolated static app** under:

```text
/app/
  index.html
  app.css
  app.js
  app-i18n.js
  README.md
```

No React/Vite dependency in the first release. A framework can be introduced later only if the UX complexity proves it necessary.

Reasons:

- matches current repository conventions;
- minimal deployment risk on GitHub Pages;
- no build pipeline dependency;
- easier parity with existing visual tokens;
- smaller client bundle inside Telegram WebView.

The Mini App must not import the full website DOM or existing `assistant.js`; it should reuse visual tokens and brand language, not page architecture.

## 5. Visual direction

Use the existing FINMENTOR visual language:

- deep navy base;
- restrained gold accent;
- graphite secondary surfaces;
- Playfair Display for selected executive/display headings;
- Manrope for UI and body;
- JetBrains Mono for financial values, labels and diagnostics;
- glass effects only where they improve hierarchy, not as decoration everywhere;
- compact mobile-first spacing;
- no generic chatbot bubbles as the primary interface.

The Mini App should feel closer to an executive control panel / private banking onboarding flow than to a survey.

### Mobile frame

- optimize first for ~390 px wide Telegram WebView;
- safe-area support;
- sticky compact top bar;
- one primary CTA per screen;
- minimum 44 px tap targets;
- no horizontal scrolling;
- reduced-motion support;
- skeleton / progress feedback for calls >300 ms.

## 6. Information architecture

### Screen 0 — Secure entry

Purpose: initialize Telegram context and establish trust.

UI:

- FINMENTOR logo;
- `Private CFO diagnostic` / localized label;
- short explanation: 3–5 minutes, no documents required now;
- privacy/consent teaser;
- CTA: `Начать`;
- secondary: `Продолжить` when an unfinished app session exists.

States:

- loading Telegram context;
- Telegram context verified;
- opened outside Telegram;
- backend temporarily unavailable.

Outside Telegram: show a graceful fallback with `Open in Telegram` / website option, not a broken form.

### Screen 1 — Business profile

Collect only high-value qualification fields:

- business type / sector;
- turnover range;
- team / scale band if needed;
- role of respondent;
- country / market only if it materially affects routing.

Use premium selectable cards, not native long selects.

### Screen 2 — Financial control scan

Core diagnostic dimensions:

1. Cash visibility
2. P&L / profitability clarity
3. Treasury / payment discipline
4. Receivables / working capital
5. Margin / unit economics
6. KPI / management control
7. Automation / reporting quality
8. Primary owner pain

Each dimension should use 3–5 concise choices or confidence scales.

No fake score precision. The UI may show progress, but should not claim an audited financial health score.

### Screen 3 — Priority / urgency

Collect:

- what hurts most now;
- urgency / decision horizon;
- what decision the owner needs to make;
- optional free-text context.

Negative statements must remain semantically negative. Example: `Нет срочности` must never be mapped to urgency keywords.

### Screen 4 — Preliminary result

Before asking for contact/consent, return value.

Show 3 blocks:

- `Что уже видно` — 2–4 descriptive observations based only on submitted answers;
- `Зона внимания` — Cash / Profit / Control / Working Capital / Reporting / Unknown;
- `Следующий разумный шаг` — e.g. Financial X-Ray, Discovery Call, data checklist.

Rules:

- clearly label result as preliminary;
- no audit language;
- no legal/tax/financial guarantee language;
- if evidence is insufficient, say `Недостаточно данных` rather than fabricate certainty.

### Screen 5 — Contact

Prefill where Telegram provides verified display data, but never assume phone/email.

Fields:

- name;
- company;
- preferred contact channel;
- phone/email/Telegram as applicable;
- optional convenient time window.

Do not force unnecessary fields if Telegram identity is enough for follow-up.

### Screen 6 — Explicit consent

Dedicated screen, no bundled ambiguity.

Required decision:

- `Да, передать эксперту FINMENTOR`
- `Пока не передавать`

Show exactly what will be sent: business answers + contact + Telegram identity needed for follow-up.

No lead submission before YES.

### Screen 7 — Submitted / handoff

Only after canonical backend success.

Show:

- confirmation;
- canonical request reference if appropriate (do not expose internal-only technical IDs if they confuse client);
- what happens next;
- expected first response window if business policy is defined;
- buttons: `Что подготовить`, `Услуги`, `Сайт`, `Закрыть`.

If backend returns merge mode, client experience should still be one clean confirmation — never say “duplicate”.

### Screen 8 — Error / recovery

Separate recoverable from terminal failures.

Recoverable:

- network timeout;
- temporary backend issue;
- Telegram validation refresh needed.

Rules:

- preserve local draft answers;
- retry must be idempotent;
- never submit a second lead if a canonical `lead_id` has already been received;
- if submission outcome is unknown, gateway must resolve idempotency before retrying.

## 7. Navigation model

Primary bottom navigation is intentionally minimal and may be hidden during linear diagnostics:

- `Главная`
- `Диагностика`
- `Результат`
- `Связаться`

During the diagnostic flow use a step header:

`1 Профиль → 2 Контроль → 3 Приоритет → 4 Результат → 5 Контакт`

Do not expose ten menu choices at once.

## 8. Telegram Bot ↔ Mini App responsibilities

### Bot remains responsible for

- `/start` and entry navigation;
- opening Mini App;
- fast lightweight questions;
- notifications and confirmations;
- fallback when Mini App cannot open;
- owner-visible conversational continuity.

### Mini App becomes responsible for

- structured multi-step diagnostic;
- premium visualization;
- draft persistence in the client;
- preliminary result presentation;
- contact and consent UI;
- submission handoff to backend.

Do not duplicate the entire bot state machine inside the Mini App.

## 9. Mini App session model

Client-side state example:

```json
{
  "app_session_id": "...",
  "cycle_id": "...",
  "telegram_user_id": "...",
  "step": "financial_control",
  "answers": {},
  "contact": {},
  "consent": "",
  "canonical_lead_id": "",
  "submit_state": "draft"
}
```

Important:

- `cycle_id` must come from / be reconciled with backend authoritative session semantics;
- the browser must not invent a trusted current cycle and override backend state;
- `canonical_lead_id` is populated only from successful backend response;
- `submit_state` transitions should be monotonic around successful submission: `draft → submitting → submitted`.

## 10. Proposed Mini App Gateway contracts

### 10.1 Bootstrap

Request:

```json
{
  "init_data": "<Telegram.WebApp.initData>",
  "client_version": "b2.0.0",
  "locale": "ru"
}
```

Response:

```json
{
  "ok": true,
  "app_session_id": "...",
  "cycle_id": "...",
  "resume": true,
  "draft": {},
  "profile": {
    "first_name": "...",
    "username": "..."
  }
}
```

### 10.2 Save draft

Used for resumability only; not a canonical lead submission.

```json
{
  "app_session_id": "...",
  "cycle_id": "...",
  "step": "priority",
  "answers": {},
  "contact": {}
}
```

Response: `{ "ok": true, "saved_at": "..." }`

### 10.3 Preview

Input: normalized answers.

Response:

```json
{
  "ok": true,
  "financial_zone": "YELLOW",
  "focus": "CASH_FLOW",
  "observations": ["..."],
  "next_step": "FINANCIAL_XRAY",
  "disclaimer": "Предварительная оценка по ответам, не аудит."
}
```

Preview must not create a Pipeline lead.

### 10.4 Submit

Request includes current cycle and explicit YES consent.

```json
{
  "app_session_id": "...",
  "cycle_id": "...",
  "consent": "yes",
  "consent_at": "...",
  "answers": {},
  "contact": {},
  "source": "telegram_miniapp"
}
```

Gateway validates Telegram context and cycle, then calls existing Lead Intake.

Success response must preserve the current canonical contract:

```json
{
  "ok": true,
  "lead_id": "<canonical>",
  "mode": "new|merged|retry",
  "priority": "...",
  "financial_zone": "..."
}
```

Client treats `new` and `merged` as successful submission. `retry` is not a second business submission.

## 11. Security requirements

1. Validate Telegram Mini App `initData` server-side before accepting privileged actions.
2. Reject expired/invalid Telegram context according to explicit gateway policy.
3. Never trust `user.id`, `chat_id`, `cycle_id`, consent or role merely because JavaScript sent them.
4. Never expose bot token, Sheets token, n8n credential or webhook secrets in static JS.
5. CORS must be limited to intended FINMENTOR origins / Telegram usage as practical.
6. Add request correlation ID and idempotency key for submit.
7. Log security failures without logging secrets or full Telegram auth payload unnecessarily.
8. Mini App source may be public because GitHub Pages is public; security must never depend on hidden frontend code.

## 12. Analytics

Analytics should describe product behavior, not leak diagnostic answers.

Allowed examples:

- `miniapp_open`
- `miniapp_bootstrap_ok`
- `miniapp_step_view`
- `miniapp_step_complete`
- `miniapp_preview_view`
- `miniapp_consent_yes`
- `miniapp_consent_no`
- `miniapp_submit_ok`
- `miniapp_submit_error`
- `miniapp_close`

Do not send phone, email, business answers, Telegram username, lead ID or free text into GA4.

## 13. Language strategy

Release sequence:

1. RU functional pilot
2. RO parity before public promotion
3. EN only if commercial need appears

Do not fork business logic by language. Text dictionaries only.

## 14. Accessibility / quality

- WCAG-oriented contrast checks;
- focus-visible state;
- keyboard operability where WebView permits;
- semantic buttons/forms;
- reduced motion;
- no important information encoded only by color;
- readable under Telegram light/dark environment changes, while preserving FINMENTOR brand.

## 15. Phase plan

### B.2.0 — Spec / prototype shell

Deliver:

- this spec;
- static shell under `/app/`;
- Telegram WebApp initialization adapter;
- screens with mock data only;
- no backend writes;
- responsive 390 / 430 / desktop preview.

Gate: UX + visual approval.

### B.2.1 — Gateway bootstrap + resume

Deliver:

- server-side initData validation;
- app session bootstrap;
- resume draft;
- safe outside-Telegram fallback.

Gate: identity / session security tests.

### B.2.2 — Diagnostic + preview

Deliver:

- profile;
- financial control scan;
- priority;
- preliminary result;
- draft persistence.

Gate: parity / no lead creation from preview.

### B.2.3 — Contact + consent + canonical Intake

Deliver:

- explicit consent;
- Lead Intake integration;
- new / merged / retry handling;
- confirmation;
- idempotent retry.

Gate: live Canary NO + YES, same rigor as Phase B.

### B.2.4 — Bot entry integration

Deliver:

- Web App button in client bot;
- resume / fallback behavior;
- Bot and Mini App do not create competing cycles.

Gate: one Telegram trigger, no duplicate submissions.

### B.2.5 — RU/RO production release

Deliver:

- RU/RO parity;
- analytics;
- QA;
- accessibility;
- production release report.

## 16. Acceptance criteria for first public release

Functional:

- Mini App opens from Telegram;
- verified Telegram context;
- existing user can resume;
- new user gets clean cycle;
- diagnostic answers persist across temporary close/reopen;
- preview does not create lead;
- consent NO creates no Intake;
- consent YES creates exactly one Intake call per submission intent;
- canonical Lead Intake response is used;
- merge does not create duplicate Pipeline row;
- successful submit survives confirmation delivery failure without second Intake.

UX:

- first useful paint <1.5 s on normal connection target;
- step transitions feel instant (<150 ms local UI target);
- no multi-second blank/spinner-only states;
- one obvious primary CTA per step;
- no horizontal overflow at 390 px;
- result is legible without scrolling through raw answers.

Security:

- server-side Telegram validation;
- zero secrets in static bundle;
- no direct Sheets access;
- no consent bypass;
- no client-controlled canonical lead ID.

## 17. Out of scope for B.2

- replacing Pipeline with a new CRM;
- client portal with accounting data;
- document upload vault;
- payment processing;
- full AI chat agent;
- Power BI embedding;
- changing existing Lead Intake dedup rules;
- cleanup of Bot_Sessions legacy fields;
- Lead Command Center for internal managers.

## 18. First implementation target

Build **B.2.0 only** first.

The first coding branch must produce a visual, navigable Mini App prototype using mock data and zero backend writes. It should reuse FINMENTOR visual tokens and demonstrate all primary screens before any n8n contract is added.

Do not wire a production webhook during B.2.0.
