# FINMENTOR v1.1 — release-grade visual evidence

Retained output of `node qa/visual-evidence.mjs --keep qa-evidence/v1.1-final`, run on the
`release/v1.1-final-integration` head recorded as `candidate_sha` in `manifest.json`.

Regenerate with:

    node qa/visual-evidence.mjs --keep qa-evidence/v1.1-final

## What is in here

| file | what it is |
| --- | --- |
| `*.png` | the retained release set — every required 390px and 1440px surface |
| `manifest.json` | the full evidence record for each retained image (see below) |
| `measurements.json` | the rendered box model of all 43 audited surfaces, not only the retained ones |
| `capture-determinism.json` | per-surface proof that fonts, layout and paint had settled before the shot |

`qa-artifacts/` (the full render set and the browser profile) is git-ignored working output; this
directory is the committed evidence.

## The required set

**390px** — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO packages,
one inner content page (`ru-real-estate`), thank-you, Mini App populated, Mini App review,
Mini App edit, Mini App success, X-Ray RU result, X-Ray RO result.

**1440px** — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO packages,
Mini App populated, Mini App review, Mini App edit, Mini App success, X-Ray RU result,
X-Ray RO result.

26 images. The harness renders more than it retains: `measurements.json` also covers both
monthly-pricing pages, the RO inner content page, the RO thank-you page, the legacy `app/` shell,
the Mini App entry, session-expired and boot-failure screens.

Nothing is substituted. The Mini App review is the review memo, not an empty shell; the success
screen is the app's own success state, not an offline page; and the X-Ray is retained in **both**
languages, because a Russian result does not certify what a Romanian customer reads.

## Determinism

The earlier evidence measured clean and could not be reproduced — identical geometry, different
pixels — so it could not be certified. Three things are pinned.

1. **Seeded random.** The constellation behind the hero lays its particles out with
   `Math.random()`, so every run drew a different starfield. A mulberry32 PRNG seeded from one
   fixed number — `random_seed` in the manifest — is installed before the document runs, so the
   first draw already comes off the seed. Production keeps the real `Math.random`.
2. **Reduced motion.** A seed fixes where the particles start, not that they move. The site
   already ships the switch: `main.js` gates the canvases, the intro overlay, the cursor loop, the
   reveal pass and the count-up numbers on `prefers-reduced-motion`, so the run emulates that mode
   rather than fighting the animation frame by frame. It is a mode real customers browse in, and
   it makes the evidence better — the counters snap to their final values instead of being caught
   mid-tween.
3. **A self-rescheduling-frame gate**, behind both as insurance: a callback that asks for another
   frame for itself is delivered once and then dropped, so a future decorative loop that forgets
   to honour reduced motion cannot put the capture back on a moving page. `frozen_reschedules`
   records whether it ever had to act.

On top of that, each capture waits for `document.fonts.ready` **and**
`document.fonts.status === 'loaded'` with no face still loading, samples the document's geometry
until two consecutive reads agree, waits two animation frames, and requires the page's heading or
logo to have non-zero painted bounds. `capture-determinism.json` records all of it per surface and
the run fails if any of it did not hold.

### How reproducibility is proven, not asserted

* **Run A / Run B** — every surface is captured twice in the same session, same viewport, same
  state, same seed. The two digests must be identical (`ab_reproducible`).
* **Cold run** — `--keep` compares against the manifest already in this directory. Delete
  `qa-artifacts/` and run again: any retained image whose pixels moved fails the run by name.

Both hold. The retained set has been reproduced byte-for-byte across four cold runs, two of them
across a source-commit boundary. Only `sha256` is compared — `capture_timestamp` is required
evidence and is volatile by definition.

## The evidence record

Every entry in `manifest.json` carries:

`candidate_sha`, `branch`, `capture_timestamp`, `viewport`, `surface_id`, `language`,
`application_state`, `screenshot_filename`, `sha256`, `bytes`, `random_seed`, `reduced_motion`,
`font_status`, `layout_stable`, `frozen_reschedules`, `text_clipping_count`, `overflow_count`,
`header_collision_count`, `ab_reproducible`.

The run itself asserts that every one of those is present, that `candidate_sha` is the commit
being audited, that `layout_stable` and `ab_reproducible` are true, and that `random_seed` is the
declared seed. A screenshot carrying an earlier `candidate_sha` is a picture of a different
candidate and is not accepted as proof of this one.

## Mini App and X-Ray states

Nothing here contacts a production service. Each Mini App surface is opened with the Gateway
answered by a stub **inside the page** carrying a local fixture — the resumed-draft shape the
Gateway returns, and for the result screens the CLIENT_READY fixtures from
`qa/fixtures/client-result-fixtures.mjs` that `qa/premium-ux-result-render.test.mjs` already holds.
Every endpoint points at `preview.invalid`, which does not resolve. The screens are then driven
through the app's own `FM_APP.set()` / `FM_APP.goto()`, so the states shown are states the app can
actually reach.
