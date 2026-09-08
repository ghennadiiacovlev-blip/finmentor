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
| `rendered-text.json` | the copy each audited surface actually painted — greppable, no PNG reading |
| `state-proofs.json` | which Mini App screen each shot is evidence OF, proven from the app's own state and that screen's DOM markers |
| `drawer-probes.json` | what pressing the burger at 390px actually did, and what became reachable inside the drawer |

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

**And the state each shot claims is now PROVEN, not assumed.** `goto()` returning without throwing
says the call was made, not that the app arrived: a router can decline a transition, land on a
guard screen, or route on again the moment a draft turns out to be incomplete, and every one of
those returns quietly. So each surface declares the state it is evidence of, and the run asserts
it twice — against the app's own `current()`, and against DOM markers only that screen builds:

| state | what the DOM has to show |
| --- | --- |
| `APP_PROBLEM` (populated) | option cards, at least one already chosen from the resumed draft, under its objective kicker |
| `APP_REVIEW` | the `.dossier` memo, a named company, three or more memo sections, the readiness block |
| `APP_EDIT_SELECTOR` (edit) | three or more edit rows, every row labelled, at least two rendering the content they edit, at least one reachable by a tap |
| `APP_SUCCESS` | the confirmation mark, the status line, the next steps, and no back affordance on a terminal screen |
| `APP_SESSION_EXPIRED`, `APP_BOOT_FAILURE` | a terminal screen with copy and exactly one way out |
| `APP_RESULT` (X-Ray) | the promoted analysis, rendered, not a shell |

`application_state` in the manifest now records the state the app was actually in, read from the
app, instead of how many steps the harness drove.

## The mobile language switch, opened rather than assumed

A DOM node inside a closed drawer is not a control a customer can reach. The previous harness
accepted one as reachable without ever opening the drawer — and `drawer-probes.json` shows why
that was worth nothing: on every burger page, **both** language options measure unpainted and
untappable before the burger is pressed, in the bar and in the drawer alike.

So the run presses it. A real `Input.dispatchMouseEvent` at the burger's own centre — not
`element.click()`, which skips hit-testing and would pass on a burger sitting under an overlay —
then re-measures. Each option is graded painted **and** hit-testable: a tap at its centre has to
land on that control and not on something covering it. Then the drawer is closed through its own
close control, and the bar has to return to the state it started in.

The probe runs **after** both screenshots of the surface are already in hand, so nothing it taps
can move a pixel of the retained evidence.

## Painted text, not the element box

`getBoundingClientRect()` is the box the layout gave an element. It is not where the glyphs are: a
block is as wide as its container whatever its text does, so a line overflowing to the right still
reports a rect ending neatly at the container edge. A Range over each text node returns one rect
per line box actually laid out — the real ink — and that is what is measured against the viewport,
the element's own box and the nearest clipping ancestor. `PAINTED TEXT CLIPPING` and `PAINTED TEXT
OUTSIDE VIEWPORT` are both **0** across the audited set, and the sweep proves it did the work: it
must return at least one line box for every text-bearing element the box sweep graded.
