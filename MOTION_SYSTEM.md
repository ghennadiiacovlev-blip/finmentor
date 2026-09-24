# FINMENTOR — MOTION SYSTEM

Motion explains the financial logic; it never decorates. The page unfolds as a sequence of
controlled scenes: nothing arrives fully formed before the reader reaches it, and nothing
moves twice.

## 1. Vocabulary: four families, nothing else

| Family | Movement | Used for |
|---|---|---|
| **A · Text** | opacity 0 → 1, rise 26px (eyebrows 12px) | headings, leads, notes, CTAs |
| **B · Image** | full-bleed photos **settle**: opacity + scale 1.025 → 1. The framed photo is **unveiled**: clip top → bottom + scale 1.03 → 1 | PHOTO 01, PHOTO 02 (settle); PHOTO 03 (unveil) |
| **C · Line** | scaleX / scaleY from the origin | chaos divider, gold spine of Прибыль → Капитал, gold rule of the capital cycle |
| **D · Sequence** | rows rise 16px and finish sooner; units (pillars, mandates) arrive one after another; mandates unfold inside (index → title → description → terms → action) | symptoms, cycle stages, business models, pillars, formats |

No bounce, rotation, 3D, blur, parallax, looping or scroll-linked movement.

## 2. Tokens (`style.css`, `.home`)

| Token | Desktop | ≤ 860px |
|---|---|---|
| `--m-ease` | `cubic-bezier(0.2, 0.7, 0.12, 1)`: long, quiet deceleration | same |
| `--m-ease-line` | `cubic-bezier(0.42, 0.08, 0.28, 1)`: near-even, so a spine reads as progress | same |
| `--m-dur` (text) | 820ms | 640ms |
| `--m-dur-row` | 700ms | 520ms |
| `--m-dur-img` | 1150ms | 950ms |
| `--m-rise` / `-row` / `-small` | 26 / 16 / 12px | 14 / 10 / 8px |
| `--m-scale` (hero) / `--m-scale-photo` | 1.025 / — | 1.025 / 1.055 (+ 22px settle) |
| Stagger step (text / rows / units) | 90 / 80 / 120ms | 95 / 80 / 110ms |

### 2a. Mobile grammar (≤ 860px) — the mobile motion pass

One viewport, one idea, one controlled sequence. Desktop is untouched; every rule below is
inside a `max-width: 860px` query or behind the engine's `narrow` check.

- **Quiet text, further apart.** Text 640ms, rows 520ms; the batch stagger widens to
  80–110ms (statement scene 260ms) and a batch may spread to 800ms, so one or two elements
  move at any moment instead of a group arriving together. Travel stays at 8–14px.
- **The photograph never leads on a phone.** The headline enters, a 160ms pause, then the
  picture, then the supporting copy (`PHOTO_PAUSE` in `initReveal`; on desktop PHOTO 03 still
  leads its batch).
- **Framed photographs are uncovered, not popped.** `[data-fx="unveil"]` (About portrait,
  Business-models figure) clips top → bottom behind its own rounded frame and settles from
  1.03 — the language PHOTO 03 already used. Full-bleed photographs settle from 1.025.
- **Covers settle once at load.** A photographic hub cover (`.rd-cover--photo`, the capital
  stage) runs a 900ms opacity 0.92 → 1 / 1.025 → 1 keyframe; it is painted from the first
  frame, so LCP is unchanged. The Real Estate cover (`.rd-solution`) is deliberately excluded.
- **Hero:** unchanged apart from the wider statement step (90ms); first paint stays immediate.
- **Menu:** unchanged (240ms, 40ms item stagger already reads as fast and confident).
- Reduced motion, no-JS and the failsafe behave exactly as before: `m-js` absent → complete
  page, no clip, no transform, no animation.

### 2b. Pass 2 — photography is the event (≤ 860px)

Owner feedback on Pass 1: technically right, visually too subtle. Pass 2 keeps the text quiet
(640ms, 14px) and makes the photographs clearly perceptible, still calm:

- **Composed into the page, not popped.** Editorial photographs settle from **1.055 and 22px**
  over **950ms** (PHOTO 02, PHOTO 03); framed photographs from **1.045 and 20px** over 900ms;
  photographic covers from **1.05 / opacity 0.9** over 1000ms at load. Nothing flies, bounces or blurs.
- **Real masks, direction by composition.** PHOTO 02 (the capital scene) rises from the bottom
  edge of its own section; PHOTO 03 and the Business-models figure are uncovered top → bottom;
  the founder portrait rises bottom → top into its rounded frame. The container already holds
  its final size — only `clip-path` and `transform` animate, so CLS stays ≈ 0.
- **Seen, not already finished.** Photographs use their own IntersectionObserver on a phone
  with the trigger line at **75%** of the viewport (text keeps 88%), and a picture starts only
  after the headline plus a **120ms** pause; the copy follows one step (80–110ms) later.
- **Never an empty shell.** If the image is still loading when its turn comes, the reveal waits
  for `load` (capped at 1200ms) so the mask never opens on nothing.
- Once only, settled on the way back, no replay; desktop rules untouched; reduced motion,
  no-JS and the failsafe unchanged.

### 2c. Pass 3 — cards and panels land (≤ 860px)

The card is the animation unit. Only transform and opacity move; geometry is reserved from the first
frame, so CLS stays 0. Desktop is untouched.

| Unit | Rise → 0 | Scale → 1 | Duration | Members |
|---|---|---|---|---|
| Card | 24px (even siblings 28px) | 0.99 | 760ms | pillars, industry cards, step and sample cards, material rows, audience items, capital principles, after-steps, client voices; editorial decks, related cards, mosaic tiles and principle panels (`[data-fx]`) |
| Feature panel | 32px | 0.99 | 900ms | engagement-format mandates, practice panels, working contour, asset callout, flagship columns, capital map and flow, system map, compare band, the consult form |
| Small card / row | 16px | 0.995 | 600ms | symptom cards, capital-cycle stages, method, diff and topic rows |

- The practice panels and the format mandates are one unit on a phone: the panel lands and its parts
  ride with it (no inner unfold competing with the landing).
- Cards get their own observer on a phone with the trigger line at 80% of the viewport (photographs
  75%, text 88%); the batch stagger stays 80–130ms in document order, so the most important card —
  first in the composition — arrives first and no more than one or two are moving at once.
- Financial tables are never animated; the intro, menu, launcher and the Real Estate and Cases frames
  are untouched.
- **Why Pass 1 read as a fade (root cause found in Pass 2).** A clip-path only animates between
  two basic shapes of the same kind. Every mask so far ended at the implicit value none, and a
  transition towards none does not interpolate — it jumps the moment the class lands, leaving
  only the scale to be seen. On a phone the settled state is now an explicit inset(0 …), so the
  mask actually opens over its 900–950ms (verified in WebKit: 100% → 20% → 2% → 0). Desktop still
  carries the old behaviour on purpose (frozen); it is noted as a follow-up, not changed here.

## 3. Engine (`main.js › initReveal`)

- **One IntersectionObserver** (`threshold 0`, trigger line at 88% of the viewport), so an
  element taller than the viewport still triggers.
- **Batch stagger.** Whatever enters in the same frame is staggered in document order, with
  photographs first. Whatever enters alone starts at once, so a reader scrolling slowly never
  waits. A batch never spreads over more than 900ms (600ms mobile), and a new batch never
  waits more than 600ms for the previous one.
- **Dependencies:** the chaos verdict follows the last symptom by ≥ 260ms; the
  "Прибыль показывает результат…" close follows the spine by ≥ 1300ms.
- **Hero is held behind the intro** and released on `fm:intro-done`, so the photograph settles
  while the brand signature fades: no black frame, no reset. 12s safety release.
- **The hero is one scene:** whichever hero element triggers first, the whole choreography
  runs. (On a short phone the trust line sat just below the trigger and was left behind.)
- **Capital shows the question first:** PHOTO 02 settles 220ms after its headline starts.
  Every other photograph leads its batch.
- **Plays once.** Every element is unobserved when it starts.
- **Passed-over content is shown without motion:** anchor jumps, refresh mid-page and fast
  flings are swept on `load`, `pageshow`, `hashchange` and `scrollend` (`m-instant` for
  transitions, `m-still` so a skipped entry keyframe never starts later).
- **No continuous scroll handler.** Only transform, opacity and clip-path animate.
- After each entry the delay resets, so hover and focus transitions never wait.

## 4. Choreography

| Scene | Sequence |
|---|---|
| Hero | PHOTO 01 settles (0.92 → 1, 1.025 → 1) → eyebrow 240ms → H1 clip rise 360ms → Видеть деньги / Понимать прибыль / Управлять капиталом 500ms + 110ms steps → supporting copy 760 → CTAs 880 → trust line 1000. All readable by ~1.2s (mobile ×0.7) |
| Problem | label → headline → copy → divider draws → symptoms 80ms apart → verdict last |
| Owner system | title → 01 Деньги → 02 Результат → 03 Капитал, each pillar one unit (left → right on desktop, top → bottom on mobile) |
| Capital | label → headline → PHOTO 02 settles behind it → lead → gold rule draws (1.4s) while the six stages follow 110ms apart |
| Прибыль → Капитал (owner page) | statement → spine draws (1.2s) → each stage enters as the spine reaches it (80 / 440 / 800 / 1160ms) → close after the spine |
| Business models | PHOTO 03 unveiled → heading → rows. `<details>` animate only when opened (opacity + 4px, 360ms) |
| Formats | each mandate unfolds inside: index → title → description → terms → CTA, 80ms apart |
| Final CTA | label → headline → copy → points → form (the form is never held more than one step) |
| Hub pages | breadcrumb, overline → H1 → lead; then each moved section keeps the choreography it had on the homepage |
| Navigation | disclosure panels: opacity + translateY 10px, 240ms; drawer items stagger 40ms as before |

## 5. Guarantees

| Condition | Behaviour | Verified |
|---|---|---|
| No JavaScript | `m-js` is never set; every hidden state is scoped to it, so the page renders complete | homepage: 77 motion targets, 0 hidden |
| `main.js` fails or is blocked | pre-paint failsafe withdraws `m-js` after 2.5s | 0 hidden |
| Slow network (`main.js` +6s) | content visible by 3.4s without motion | 0 hidden |
| `prefers-reduced-motion` | `m-js` is not set; explicit overrides remove every transition, scale, clip and line draw | 0 hidden, 60ms after load |
| Anchor jump / refresh mid-page / fast fling | passed-over content is shown without motion | 0 hidden, RU + RO |
| LCP | The first-viewport LCP candidates (hero H1, hub H1s, PHOTO 02 on the capital page) start at opacity 0.01: painted, invisible. At opacity 0, Chrome records them only on a later repaint (~3s) | LCP ≈ 30–110ms on every page, 390 and 1440 |
| CLS | transforms only | ≤ 0.0004 at all 6 widths |
