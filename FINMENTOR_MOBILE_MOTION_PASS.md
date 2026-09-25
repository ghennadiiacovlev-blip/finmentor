# FINMENTOR — Premium Mobile Motion Pass

Дата: `2026-09-24`
Статус: **IMPLEMENTED — OWNER VISUAL REVIEW (no merge, no deploy)**

| Item | Value |
|---|---|
| Branch | `design/mobile-motion` |
| Production baseline used | `ebb582b1a634b010718057fc140398c336295835` = `origin/redesign/visual-system-2` = live GitHub Pages build (contains Real Estate flow/launcher, Professional Practice refinements, experience counter, Client Voices, final consent note) |
| Scope | mobile motion only (`max-width: 860px` CSS queries and the engine's `narrow` branch); desktop rules, layouts, copy, geometry untouched |

## 1. Motion summary — what changed on a phone

Everything below applies only ≤ 860px. Desktop timing, order and photo behaviour are byte-for-byte unchanged.

| Area | Before (mobile) | After (mobile) | Why |
|---|---|---|---|
| Statement duration `--m-dur` | 620ms | **720ms** | primary reveals in the 650–900ms band; calm, not quick |
| Row duration `--m-dur-row` | 520ms | **560ms** | supporting elements in the 450–700ms band |
| Photo settle `--m-scale` | 1.012 | **1.025** | a photograph reads as settling, not as fading in |
| Batch stagger (text / rows / units / editorial) | 55 / 45 / 70 / 60–40ms | **95 / 80 / 110 / 100–70ms** | 80–120ms between siblings → one or two things moving at any moment |
| Batch spread cap | 600ms | **800ms** | the wider stagger is not squeezed back into simultaneity |
| Statement scene pause (`.fx-word`) | 200ms | **260ms** | the word, then its question |
| Hero statement lines | 70ms apart | **90ms apart** | same three-line rhythm, slightly more deliberate |
| Mandate internals (`.m-c`) | 50ms | **80ms** | index → title → description → terms → action, readable as a sequence |
| Photograph order | photo leads its batch | **headline → 160ms pause → photo → copy** | the picture arrives after the idea it illustrates (`PHOTO_PAUSE`, engine) |
| Framed photo `[data-fx="unveil"]` (About portrait, Business-models figure) | centred inset 8% → 0, img 1.06 → 1 | **uncovered top → bottom behind its rounded frame, img 1.03 → 1, 900ms** | the language PHOTO 03 already used on the homepage; no zoom |
| Editorial `[data-fx]` | 620 / 620 / 860ms, rise 16px | **720 / 720 / 900ms, rise 14px** | premium band, small travel |
| Hub photographic covers (`.rd-cover--photo`, capital stage) | static | **one 900ms settle at load: opacity 0.92 → 1, 1.025 → 1** | restrained finishing effect; painted from the first frame, so LCP unchanged |
| Real Estate cover | static | **static (excluded by `.rd-solution`)** | protected design |
| Hero first paint, intro, menu | — | **unchanged** | fast first paint; menu already 240ms / 40ms stagger |
| Reduced motion / no-JS / failsafe | complete page | **unchanged** | `m-js` absent → no clip, transform or animation |

Vocabulary stays the approved four families (text rise, image settle/unveil, line, sequence). No bounce, elastic easing,
parallax, letter or line animation, counters, scroll-linked movement or repeated replays were added.

Files: `style.css` (mobile tokens, hero/mandate steps), `editorial.css` (mobile `[data-fx]` block, unveil, cover settle),
`main.js` (`initReveal`: mobile steps, spread cap, photo order and pause), `MOTION_SYSTEM.md` (§2a mobile grammar),
`qa/mobile-motion-evidence.mjs` + `qa/lib/png-tile.mjs` (evidence harness). Generated evidence is ignored and retained in
the tagged release history rather than the current production tree.

## 2. Pages enhanced

The grammar is systemic (engine + shared CSS), so every public page with the motion system inherits it. Verified on the
priority journeys RU + RO: homepage, About / Professional Practice, Practice (cases.html), Capital Management, Real Estate
(motion of copy only; cover and flow frame untouched), Materials, Financial X-Ray (questionnaire — no motion targets).

## 3. Results — before (untouched `ebb582b`, clean worktree) vs after

### Performance (Chrome, mobile emulation, loopback server; LCP ms, CLS after a full scroll)

| Page | 390 LCP | 390 CLS | 430 LCP | 430 CLS |
|---|---|---|---|---|
| / | 456 → 448 | 0.0005 → 0.0005 | 288 → 288 | 0.0004 → 0.0004 |
| /about.html | 256 → 252 | 0.0004 → 0.0004 | 260 → 264 | 0.0003 → 0.0003 |
| /cases.html | 244 → 244 | 0.0004 → 0.0004 | 252 → 260 | 0.0003 → 0.0003 |
| /capital-management.html | 260 → 264 | 0.0004 → 0.0004 | 252 → 256 | 0.1153 → 0.1285 (*) |
| /real-estate-control-system.html | 256 → 260 | 0.0004 → 0.0004 | 248 → 244 | 0.0003 → 0.0003 |
| /materials.html | 664 → 284 | 0.0004 → 0.0004 | 324 → 272 | 0.0003 → 0.0003 |
| /questionnaire.html | 248 → 252 | 0 → 0 | 252 → 256 | 0 → 0 |
| /ro/ | 284 → 280 | 0.0005 → 0.0005 | 276 → 292 | 0.0004 → 0.0004 |
| /ro/cases.html | 244 → 240 | 0.0004 → 0.0004 | 248 → 240 | 0.0003 → 0.0003 |

Long tasks: 0ms on every surface, both phases. Stuck motion targets after the scroll: 0 everywhere.
Differences are run-to-run noise (single cold run per page); nothing moved outside it.

(*) **Pre-existing, intermittent, not motion-related.** Traced with layout-shift sources: `DIV.fx-stage__content.fx-container`
on the Capital Management cover moves 36px at ~2.9s / scrollY ≈ 1319 in roughly one run out of three, before and after
alike (sticky cover stage; `.fx-stage.is-tall` / header-height interaction). Reported for a separate follow-up; the sticky
stage is layout, not motion, and outside this pass.

### WebKit (Playwright WebKit 2359 — Safari / WKWebView engine)

- 36 surfaces (320 / 390 / 430 / 820 × 9 priority routes), full slow scroll: overflow 0, stuck targets 0, unrevealed
  targets 0 — before and after.
- Reduced motion (`prefers-reduced-motion: reduce`), 9 routes at 390: `m-js` absent, every motion target immediately
  visible with no transform, clip or animation — before and after (0 not-immediate).
- Layout regression spec `qa/production-layout-regression.spec.mjs`: **5 / 5 passed** (financial tables, photo heroes,
  real-estate flow frame, real-estate launcher, statement labels).

### Chromium responsive audit (`qa/production-responsive-visual-audit.mjs --origin local`)

- Normal motion, 320 / 375 / 390 / 393 / 430 / 768 × 8 routes = **48 surfaces, issues 0**.
- Reduced motion, same matrix: **48 surfaces, issues 0**.

### Accessibility (`qa/codex-accessibility-sweep.mjs`)

90 indexed pages, 4902 AX interactive nodes, 4025 touch targets, **0 defects**.

### Canonical QA

`node qa/run-all.mjs`: **104 / 104 gates PASS, 3722 assertions, floors PASS** on the patched tree.

## 4. Evidence for owner review

`qa-evidence/mobile-motion/after/` is the ignored regeneration target for contact sheets (2 fps, six frames per row) of
WebKit recordings of a slow scroll:
`homepage-390-mobile-motion-sheet.png`, `homepage-430-mobile-motion-sheet.png`, `practice-390-mobile-motion-sheet.png`,
`real-estate-390-mobile-motion-sheet.png`, `ro-homepage-390-mobile-motion-sheet.png`; `metrics.json` for both phases;
`before/` holds the baseline sheets and numbers when regenerated. The accepted 2026-09-24 evidence remains recoverable
from tag `production-approved-2026-09-24`. The recordings themselves (`.webm`, ~2–4 MB each) are in
`qa-artifacts/mobile-motion/{before,after}/` — untracked by repository policy; regenerate with
`node qa/mobile-motion-evidence.mjs --phase after --only record`.

A contact sheet proves sequence and the absence of blank or stuck states; the feel of the timing is judged on the
recordings or, better, on an iPhone against a local build of this branch.

## 5. Git

Commit on `design/mobile-motion` (see the branch log); working tree clean apart from the untracked `test-results/` marker left by the earlier Codex session. Not merged, not pushed, not deployed.
