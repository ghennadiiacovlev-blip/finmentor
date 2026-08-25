# FINMENTOR Mini App — B.2.0 prototype

This directory is an isolated, build-free Telegram Mini App prototype.

## Current scope

- premium RU-first UI shell;
- Telegram WebApp initialization if opened inside Telegram;
- multi-step diagnostic flow;
- mock preliminary result;
- contact + explicit consent UI;
- submitted / declined presentation states;
- zero backend writes;
- zero secrets;
- no direct Google Sheets access;
- no Lead Intake calls.

## Files

- `index.html` — screen templates and Mini App shell
- `app.css` — isolated FINMENTOR mobile design system
- `app.js` — prototype state machine and mock result logic
- `app-i18n.js` — language scaffold

## Safety

B.2.0 must not call production n8n webhooks. The purpose of this phase is visual/interaction validation only.

Telegram `initDataUnsafe` is used solely for non-privileged display/prefill in the prototype. Production B.2.1 must validate `Telegram.WebApp.initData` server-side before any privileged action or persistence.

## Next gate

Before backend integration:

1. review at 390 px and 430 px widths;
2. verify all screens and back navigation;
3. verify `Нет срочности` remains non-urgent;
4. verify consent YES/NO are visually explicit;
5. verify outside-Telegram fallback;
6. verify no network calls other than static assets/fonts/Telegram SDK;
7. approve UX copy and visual direction.

Then proceed to B.2.1 Gateway Bootstrap + server-side Telegram validation.
