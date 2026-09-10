# FINMENTOR Lead Intelligence v1 — Niagara evidence

These deterministic, local-only HTML renders use the Niagara UAT fixture. They do not call production services and contain no production token or credential.

- `niagara-telegram-alert.html` — 390 px Telegram entry-point render.
- `niagara-owner-brief-desktop.html` — full owner memo for desktop.
- `niagara-owner-brief-mobile.html` — the same owner memo constrained to 390 px.
- `niagara-client-result-editor.html` — owner edit surface.
- `niagara-client-result-preview.html` — exact client-safe preview.

Run `node scripts/build-lead-intelligence-evidence.mjs` to regenerate all pages from the deterministic fixture.
