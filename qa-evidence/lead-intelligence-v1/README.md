# FINMENTOR Lead Intelligence v1 — Niagara evidence

These deterministic, local-only HTML renders use the live-derived, sanitized Niagara source semantics recorded by the 2026-09-10 owner audit. Identifiers and PII are synthetic. The pages do not call production services and contain no production token or credential.

- `niagara-telegram-alert.html` — 390 px Telegram entry-point render.
- `niagara-owner-brief-desktop.html` — full owner memo for desktop.
- `niagara-owner-brief-mobile.html` — the same owner memo constrained to 390 px.
- `niagara-owner-brief-desktop.png` — reproducible 1440 × 1100 first-fold evidence.
- `niagara-owner-brief-mobile-390.png` — reproducible 390 × 844 mobile evidence.
- `niagara-client-result-editor.html` — direct-route proof that editing is blocked for self-assessment.
- `niagara-client-result-preview.html` — direct-route proof that publication is blocked for self-assessment.

Niagara intentionally has different synthetic Lead IDs in the Leads and Pipeline fixtures and one shared request ID. The generated brief is accepted only through the unique request-ID fallback. Its selected goals and documents remain empty, and `desired_first_step` is shown only as `Первый шаг, выбранный клиентом`.

Run `node scripts/build-lead-intelligence-evidence.mjs` to regenerate all pages from the deterministic fixture.
Run `node scripts/capture-lead-intelligence-evidence.mjs` to recapture the two PNGs with local headless Chrome.
