# FINMENTOR Mini App — B.2.0 prototype

Status: **READY FOR PR / VISUAL REVIEW**

This directory is an isolated, build-free Telegram Mini App prototype. It is intentionally separated from the current production Concierge / Lead Intake backend.

## Current scope

- premium RU-first UI shell;
- Telegram WebApp initialization if opened inside Telegram;
- multi-step diagnostic flow;
- mock preliminary result;
- contact + explicit consent UI;
- submitted / declined presentation states;
- accessible progress + selectable-state semantics;
- outside-Telegram contact fallback;
- zero backend writes;
- zero secrets;
- no direct Google Sheets access;
- no Lead Intake calls.

## Files

- `index.html` — screen templates and Mini App shell
- `app.css` — isolated FINMENTOR mobile design system
- `app.js` — prototype state machine and mock result logic
- `app-i18n.js` — RU/RO language scaffold
- `../docs/PHASE_B2_PREMIUM_MINIAPP_SPEC.md` — architecture / release specification
- `../docs/PHASE_B2_B20_QA_REPORT.md` — B.2.0 QA and release-gate record

## Safety

B.2.0 does not call production n8n webhooks. The purpose of this phase is visual and interaction validation only.

Telegram `initDataUnsafe` is used solely for non-privileged display/prefill in the prototype. Production B.2.1 must validate `Telegram.WebApp.initData` server-side before any privileged action or persistence.

Opening the Mini App is not consent. Submission is represented only after a dedicated YES action; in B.2.0 even that action remains mock-only and performs no network write.

## B.2.0 QA status

Completed in the branch:

- core 390/430-class responsive layout rules reviewed;
- back-navigation/state retention reviewed;
- `Нет срочности` remains non-urgent;
- consent YES/NO are explicit;
- consent summary added;
- outside-Telegram direct callback is required;
- no production submission/network integration added;
- final `app.js` syntax checked.

## Next phase

**B.2.1 — Gateway Bootstrap + server-side Telegram validation**

Before any real lead submission:

1. validate Telegram `initData` server-side;
2. create/resume authoritative Mini App session;
3. reconcile authoritative `cycle_id` with existing Concierge semantics;
4. add idempotent canonical submission via the existing Lead Intake;
5. add recoverable error/retry UI;
6. keep Pipeline as the sole canonical current lead state.
