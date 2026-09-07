# FINMENTOR v1.1 — release-grade visual evidence

Retained output of `node qa/visual-evidence.mjs --keep qa-evidence/v1.1-final`, run on the
`release/v1.1-final-integration` head that carries this directory.

Regenerate with:

    node qa/visual-evidence.mjs --keep qa-evidence/v1.1-final

## What is in here

| file | what it is |
| --- | --- |
| `*.png` | the retained release set — the required 390px and 1440px surfaces |
| `manifest.json` | sha256 and byte length of every retained PNG, plus the Chrome build that drew them |
| `measurements.json` | the rendered box model of all 41 audited surfaces, not only the retained ones |
| `capture-determinism.json` | per-surface proof that fonts, layout and paint had settled before the shot |

`qa-artifacts/` (the full render set and the browser profile) is git-ignored working output; this
directory is the committed evidence.

## The required set

390px — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO packages,
one inner content page (`ru-real-estate`), thank-you, Mini App populated, Mini App review,
Mini App success, X-Ray populated result.

1440px — RU homepage, RO homepage, RU questionnaire, RU packages, Mini App populated,
Mini App review, X-Ray populated result.

The harness renders more than it retains: `measurements.json` also covers the RO thank-you page,
both monthly-pricing pages, the RO inner content page, the legacy `app/` shell, the Mini App entry,
edit-selector, session-expired and boot-failure screens, and the Romanian X-Ray result.

## Mini App and X-Ray states

Nothing here contacts a production service. Each Mini App surface is opened with the Gateway
answered by a stub **inside the page** carrying a local fixture — the resumed-draft shape the
Gateway returns, and for the result screens the CLIENT_READY fixtures from
`qa/fixtures/client-result-fixtures.mjs` that `qa/premium-ux-result-render.test.mjs` already holds.
Every endpoint points at `preview.invalid`, which does not resolve. The screens are then driven
through the app's own `FM_APP.set()` / `FM_APP.goto()`, so the states shown are states the app can
actually reach.

## Determinism

Each capture waits for `document.fonts.ready` **and** `document.fonts.status === 'loaded'` with no
face still loading, then samples the document's geometry until two consecutive reads agree, then
waits two animation frames, and finally requires the page's heading or logo to have non-zero
painted bounds. Animations, transitions and smooth scrolling are switched off by a stylesheet
injected before the document runs. `capture-determinism.json` records all of it per surface, and
the run fails if any of it did not hold.
