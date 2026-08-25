# FINMENTOR Phase B.2.0 — UX / Safety QA

Status: **B.2.0 RELEASE GATE PASS**
Branch: `feat/phase-b2-premium-miniapp`
Scope: static Telegram Mini App prototype only. No production n8n changes, no backend writes, no Lead Intake calls.

## 1. What was checked

### Structure
- 8 screens: entry, profile, financial control, priority, preliminary result, contact, explicit consent, submitted/declined handoff.
- Linear navigation with back support.
- Progress indicator has accessible progressbar semantics.
- Selection controls expose `aria-pressed` state.
- Tap targets are at least ~44 px in the core diagnostic controls.
- Responsive mobile rules cover the primary 390 px Telegram viewport and larger 430 px-class devices.

### Business semantics
- `Нет срочности` remains a negative urgency value (`urgency = none`) and does not raise priority.
- No lead submission is possible before a dedicated YES consent action.
- Consent NO produces an explicit `Ничего не передано` state.
- Decline state no longer reuses a success/checkmark presentation.
- Preliminary result is clearly labelled as non-audit / non-guarantee output.
- Result logic is descriptive and avoids fake numeric scoring.

### Contact fallback
- Inside Telegram, name + company are enough for the prototype because Telegram may remain the callback channel.
- Outside Telegram, a direct phone/email field becomes required before moving to consent.
- Telegram display data is used only for non-privileged prefill/presentation in B.2.0.

### Consent clarity
The consent screen shows a compact summary of what is about to be sent:
- company;
- business profile / turnover;
- urgency horizon.

Copy differs by context:
- Telegram: answers + entered contact + Telegram context needed for follow-up;
- outside Telegram: answers + entered direct contact; no Telegram-context claim.

The pre-consent visual is intentionally neutral rather than a success checkmark so the interface does not imply that consent has already been granted.

### Security / integration boundary
B.2.0 contains:
- no `fetch()` to production;
- no XMLHttpRequest;
- no webhook URL;
- no bot token;
- no Google credential;
- no direct Google Sheets access;
- no direct Lead Intake call.

The only runtime integrations in the prototype shell are the Telegram WebApp SDK, Google Fonts and ordinary user-initiated links to FINMENTOR pages.

### Code sanity
- Final `app.js` source passes `node --check` in GitHub Actions.
- Duplicate HTML IDs are checked automatically.
- Static contracts verify templates, consent actions, urgency semantics, accessibility markers and forbidden backend/network surfaces.
- Existing production website files are not modified by the Mini App prototype.

## 2. Real Chromium QA evidence

GitHub Actions workflow: `Mini App B.2.0 QA`.

Final browser run:
- run id: `32816136609`;
- head SHA: `50ac9d1f2b2a5a5061d83b7cf6b6cecd8136d7dd`;
- conclusion: **SUCCESS**;
- Chromium: Playwright headless browser on `ubuntu-latest`;
- artifact: `finmentor-b20-browser-qa`.

Validated in a real rendered browser, not only by source inspection:

- 390 px outside-Telegram entry;
- 390 px preliminary result;
- 390 px consent;
- 390 px decline state;
- 430 px Telegram-context entry;
- 430 px Telegram-context YES/submitted state;
- no horizontal overflow in tested views;
- core CTA / choice / segmented targets meet the >=44 px interaction contract;
- visible keyboard focus outline is present;
- back navigation preserves selected state;
- `urgency = none` visibly states that it does not increase priority;
- outside Telegram, direct phone/email is required;
- inside Telegram, direct phone/email may remain optional;
- consent copy explicitly names Telegram context only when Telegram context exists;
- decline state uses neutral `—`, `Передача не выполнена`, `Ничего не передано` semantics;
- YES state is still mock-only in B.2.0.

Browser network evidence:
- forbidden requests: **0**;
- console errors: **0**;
- page errors: **0**;
- observed external requests are limited to Google Fonts and the Telegram WebApp SDK/assets needed for presentation.

Forbidden runtime destinations were explicitly checked for:
- production n8n host;
- Google Sheets API;
- Telegram Bot API;
- webhook paths.

## 3. UX improvements made during QA

1. Replaced the generic `Private` status chip with context-aware `Telegram` / `Preview` status so B.2.0 does not imply server-side identity verification that does not yet exist.
2. Added explicit accessible progress semantics.
3. Added `aria-pressed` state to all selectable diagnostic buttons.
4. Enforced a direct callback contact outside Telegram.
5. Added explicit consent summary before YES / NO.
6. Kept YES and NO visually separate and unambiguous.
7. Made pre-consent and consent-decline visuals neutral; a decline no longer looks like a successful submission.
8. Added functional post-result links for materials, services and website navigation.
9. Preserved in-memory answers across back navigation and a return to the entry screen; `Начать заново` remains the explicit reset.
10. Added reduced-motion handling for screen transitions / scroll behavior.
11. Preserved the existing FINMENTOR dark navy / restrained gold visual system rather than introducing a second brand language.
12. Added repeatable GitHub Actions static + Chromium QA so later B.2 changes cannot silently regress these contracts.

## 4. Known non-blocking B.2.0 limitations

These are intentionally deferred to B.2.1+ and are not defects of the static prototype:

- Romanian UI is scaffolded but not yet fully translated.
- Telegram `initData` is not server-validated yet; therefore B.2.0 performs no privileged write.
- Draft persistence is memory-only; production resume belongs to the authoritative Gateway session model.
- No real canonical `lead_id` is displayed because no backend submission exists in B.2.0.
- No production SLA / expected response time is shown until that business rule is formally defined.
- No network recovery screen is active until there is a real Gateway call to recover from.

## 5. Release decision

**B.2.0 = READY TO MERGE**

Next phase:

**B.2.1 — Mini App Gateway Bootstrap**

Required before any real submission:
1. validate `Telegram.WebApp.initData` server-side;
2. create/resume authoritative app session;
3. reconcile authoritative `cycle_id`;
4. expose safe bootstrap/resume payload only;
5. preserve current Concierge + Lead Intake contracts;
6. keep Mini App from writing directly to Sheets;
7. implement idempotent submit semantics around canonical `lead_id`;
8. add recoverable error/retry UI.

## 6. Production safety

During B.2.0 work:
- `main` remains unchanged until PR merge;
- the active n8n Client Concierge is unchanged;
- the active Transport is unchanged;
- the active Lead Intake is unchanged;
- no production webhook or Telegram Mini App menu configuration is changed.
