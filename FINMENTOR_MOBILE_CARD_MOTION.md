# FINMENTOR — Mobile Card Motion (Pass 3): cards and panels land

Дата: `2026-09-24`
Статус: **IMPLEMENTED — OWNER VISUAL REVIEW (no merge, no deploy)**

| Item | Value |
|---|---|
| Branch | `design/mobile-card-motion` (own git worktree) |
| Baseline | `a9400af8847b1a11f198f0de2d6f3b8dc47dc0ba` = `origin/redesign/visual-system-2` = live GitHub Pages build (the owner's brief quoted the SHA with one character dropped; resolved by prefix and verified against the Pages API) |
| Baseline contents preserved | approved design, Pass 2 photography, Cases frame hotfix, Real Estate flow-frame and launcher, Client Voices, counter |
| Scope | mobile motion only: `max-width: 860px` CSS and the engine's `narrow` branch. Card geometry, radius, colours, copy, spacing, grids, desktop rules untouched |

## 1. Card arrival grammar (≤ 860px only)

The card is the animation unit. Only `transform` and `opacity` animate; every card's geometry is reserved from the
first frame (no width/height/margin/padding animation), so CLS stays 0. Easing is the site's
`cubic-bezier(0.2, 0.7, 0.12, 1)`; no bounce, spring, rotation or blur.

| Unit | Initial → final | Duration | Members |
|---|---|---|---|
| **Card** | translateY 24px (even siblings 28px) → 0, scale 0.99 → 1, opacity 0 → 1 | 760 ms | pillars, industry cards, step and sample cards, material rows, audience items, capital principles, after-steps, client voices; editorial decks, related cards, mosaic tiles and principle panels (`[data-fx]`, opacity 0.01 → 1) |
| **Feature panel** | translateY 32px → 0, scale 0.99 → 1, opacity 0 → 1 | 900 ms | engagement-format mandates, practice panels, working contour, asset callout, flagship columns, capital map and flow, system map, compare band, consult form |
| **Small card / row** | translateY 16px → 0, scale 0.995 → 1, opacity 0 → 1 | 600 ms | symptom cards, capital-cycle stages, method / diff / topic rows |

- **One idea per unit.** The practice panels and the format mandates land as a whole on a phone; their inner parts
  (index, situation, control, decision) ride with the panel instead of unfolding separately. Desktop keeps the
  approved inner unfold.
- **Alternating rhythm.** Even siblings travel 4 px further (28 vs 24 px). No horizontal component.
- **Cards with photography.** None on the audited pages contain a photograph; the Pass 2 photo grammar is unchanged
  and photographs still lead their scene (headline → 120 ms → photograph → cards).
- **Financial tables** are not animated; KPI-style sample cards get the panel-level settle only.
- **Client Voices** remains hidden in production; when populated its quotes inherit the card settle (760 ms, 24 px).
- **Menu, intro, launcher, hero** untouched.

## 2. Observer and stagger

| Item | Before | Pass 3 |
|---|---|---|
| Card trigger line (phone) | shared observer, 88 % of the viewport | **own observer, 80 %** (`rootMargin 0 0 -20%`) — a fifth of the viewport has taken the card in before it lands |
| Photo trigger line | 75 % (Pass 2) | 75 % (unchanged) |
| Text trigger line | 88 % | 88 % (unchanged) |
| Batch stagger | units 110 ms, rows 80 ms, mosaics 100 ms | unchanged — inside the 80–130 ms band; document order, so the composition's first card (e.g. the flagship) arrives first |
| Once-only, settled on the way back | yes | yes; scrolling back never replays |

## 3. Pages enhanced

Homepage (symptom cards, three pillars, industry cards, format mandates, practice panels, material rows, consult form),
Business Models (industry cards, flagship columns, asset callout), Capital Management (principle panels, capital map,
capital flow, cycle stages), About (practice mosaic tiles, method rows), Owner hub (step, sample and audience cards,
working contour). Practice / Cases, Materials and Financial X-Ray carry no card motion targets and were deliberately
left alone: no decorative animation was added to reading pages or to the form.

## 4. Performance — production `a9400af` (clean worktree) vs Pass 3, Chrome mobile emulation

| Page | 390 LCP ms | 390 CLS | 430 LCP ms | 430 CLS |
|---|---|---|---|---|
| / | 480 → 340 | 0.0005 → 0.0005 | 344 → 352 | 0.0004 → 0.0004 |
| /about.html | 260 → 256 | 0.0004 → 0.0004 | 292 → 268 | 0.0003 → 0.0003 |
| /cases.html | 260 → 264 | 0.0004 → 0.0004 | 272 → 264 | 0.0003 → 0.0003 |
| /capital-management.html | 268 → 272 | 0.0004 → 0.0004 | 304 → 272 | 0.1287 → 0.1129 |
| /real-estate-control-system.html | 256 → 276 | 0.0004 → 0.0004 | 296 → 280 | 0.0003 → 0.0003 |
| /materials.html | 292 → 320 | 0.0004 → 0.0004 | 344 → 292 | 0.0003 → 0.0003 |
| /questionnaire.html | 288 → 252 | 0 → 0 | 268 → 260 | 0 → 0 |
| /ro/ | 304 → 308 | 0.0005 → 0.0005 | 288 → 324 | 0.0004 → 0.0004 |
| /ro/cases.html | 240 → 256 | 0.0004 → 0.0004 | 264 → 268 | 0.0003 → 0.0003 |

Long tasks 0 ms on every surface, both labels; stuck motion targets 0. Differences are single-run noise (no trend).
The Capital Management 430 value of ~0.12 is the pre-existing, intermittent sticky-cover shift (present on the
untouched baseline in the same run) — layout, not motion, reported since Pass 1.

## 5. WebKit (Playwright WebKit 2359 — Safari / WKWebView engine)

- Reveal completeness after a full scroll, 36 surfaces (320 / 390 / 430 / 820 × 9 routes): overflow 0, stuck cards 0,
  unrevealed 0.
- Hidden states verified live at 390: pillar `translateY(24px) scale(0.99)`, its even sibling 28 px, industry card 24 px,
  format mandate and practice panel `32px / 0.99` at 900 ms, practice panel parts immediate inside the panel, symptom
  card `16px / 0.995` at 600 ms; all settle to `none / 1`.
- Layout regression spec: **6 / 6 passed** — financial tables, photo heroes, **Cases logic frame**, **real-estate flow
  frame**, **real-estate launcher**, statement labels.
- Reduced motion (9 routes, 390): `m-js` absent, targets not immediately visible: 0; no transform, clip or animation.

## 6. Desktop freeze (1024 / 1280 / 1440 / 1728 × homepage, About, Business models, Capital Management)

Computed motion declarations (transition durations, delays, easing, clip-path, animation) identical on all 16 surfaces
before vs after: 0 differences. Settled full-page screenshots pixel-identical on 12 / 16 surfaces; the homepage differs
by 0.02 % at each width, confined to the anti-aliasing of the practice panels' index digits (01 / 02 / 03) — crops
show identical content; a compositing-layer difference of glyph rendering, not a layout or motion change.

## 7. QA

| Gate | Result |
|---|---|
| `node qa/run-all.mjs` (canonical, incl. website contract and the Client Voices gate) | 104 / 104 gates, 3722 assertions, floors PASS |
| Layout regression spec (Cases frame, Real Estate, WebKit) | 6 / 6 |
| Accessibility sweep | 90 pages, 0 defects |
| Responsive audit, normal motion, 320 / 375 / 390 / 393 / 430 / 768 × 11 routes | 60 surfaces, issues 0 |
| Responsive audit, reduced motion, same matrix | 60 surfaces, issues 0 |
| `git diff --check` | clean |

Status line for the owner: DESIGN CHANGED: NO · DESKTOP CHANGED: NO · PASS 2 PHOTO MOTION PRESERVED: YES ·
CASES HOTFIX PRESERVED: YES · REAL ESTATE FIX PRESERVED: YES · CARD MOTION VISIBLY PREMIUM: YES (see the comparison
strips and recordings) · READY FOR OWNER REVIEW: YES.

## 8. Evidence

`qa-evidence/mobile-card-motion/`: key-stage strips and 0.2 s comparisons (before vs after) for homepage, Business
Models and Capital Management, manifests and this comparison's numbers. Recordings (source of truth):
`qa-artifacts/mobile-card-motion/` (untracked) — homepage-390-cards, business-models-390-cards, practice-390-cards,
capital-390-cards, materials-390-cards, each as `-before.webm` and `-after.webm`, identical WebKit build, viewport,
start point, pace (~525 px/s measured) and content state.
