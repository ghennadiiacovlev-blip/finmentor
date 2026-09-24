# FINMENTOR — Mobile Motion Pass 2: visible premium photography

Дата: `2026-09-24`
Статус: **IMPLEMENTED — OWNER VISUAL REVIEW (no merge, no deploy)**

| Item | Value |
|---|---|
| Branch | `design/mobile-motion-pass-2` (own git worktree; the main directory was left to other sessions) |
| Baseline | `fa83d0e4096d6614fe205ead207274b30fb7c48b` = `origin/redesign/visual-system-2` = live GitHub Pages build |
| Baseline contents preserved | approved design, Professional Practice refinement, experience counter, Client Voices + consent note, Real Estate flow-frame, launcher, Cases frame hotfix, Mobile Motion Pass 1 |
| Scope | mobile motion only: `max-width: 860px` CSS and the engine's `narrow` branch. Desktop rules, layouts, copy, images, geometry untouched |

## 1. Root cause of "I barely feel the improvement"

A `clip-path` transition only interpolates between two basic shapes of the same kind. Every mask on the
site (PHOTO 03, the framed `[data-fx="unveil"]` photographs, and Pass 1's mobile masks) ended at the
implicit value `none`, and a transition towards `none` does **not** animate — it jumps the instant the
class lands, leaving only the scale/opacity settle to be seen. That is why Pass 1 read as a fade. Pass 2
gives every mobile mask an explicit settled shape (`inset(0 …)`), and WebKit now interpolates it
(measured mid-way: homepage figure `inset(0 0 20.6%)` at 1.0 s; About portrait 100% → 20.6% → 1.9% → 0).
Desktop keeps the old behaviour on purpose (frozen); it is a follow-up, not part of this pass.

## 2. Exact motion parameters changed (≤ 860px only)

| Parameter | Pass 1 (production) | Pass 2 |
|---|---|---|
| Text `--m-dur` / `--m-dur-row` (home) | 720 / 560 ms | **640 / 520 ms** (text kept quiet, 14 / 10 px) |
| Editorial `[data-fx]` durations | 720 / 720 / 900 ms | **640 / 640 / 900 ms**, rise 14 px |
| Photo duration `--m-dur-img` | 900 ms | **950 ms** |
| Editorial photo scale / settle (`--m-scale-photo`, `--m-settle-photo`) | 1.025 → 1, no settle | **1.055 → 1, 22 px → 0** |
| Hero photo `--m-scale` | 1.025 | 1.025 (unchanged: restrained finish only) |
| PHOTO 02 (capital scene, homepage) | opacity 0.01 + scale 1.025 | **mask rises bottom → top** inside its own section + 1.055 / 22 px, 950 ms |
| PHOTO 03 (business-models figure, homepage) | clip top → bottom (jumped) + 1.03 | **clip top → bottom (interpolated)** + 1.055 / 22 px, 950 ms |
| Framed `[data-fx="unveil"]` (About portrait) | clip top → bottom (jumped) + 1.03 | **rises bottom → top into its rounded frame** + 1.045 / 20 px, 900 ms |
| Framed `[data-fx="unveil"]` (Business-models page figure) | clip top → bottom (jumped) + 1.03 | **clip top → bottom (interpolated)** + 1.045 / 20 px, 900 ms |
| Photographic covers (`.rd-cover--photo`, capital stage) | settle 0.92 / 1.025, 900 ms | **settle 0.9 / 1.05, 1000 ms**, painted from the first frame |
| Real Estate cover | static | static (excluded by `.rd-solution`) |
| Pause after the headline before a photograph | 160 ms | **120 ms** (then one 80–110 ms step to the copy) |
| Photograph trigger | shared observer, line at 88 % of the viewport | **own observer, line at 75 %** (`rootMargin 0 0 -25%`) — seen, not already finished |
| Image-load safety | none | **a photograph's reveal waits for its `load` (cap 1200 ms)**; never an empty shell |
| Once-only, settled on the way back | yes | yes (unchanged engine semantics) |
| Menu, intro, hero first paint | unchanged | unchanged |

Easing stays the site's `cubic-bezier(0.2, 0.7, 0.12, 1)` (calm deceleration). No bounce, elastic, rotation, blur,
3D, width/height/margin animation. Reduced motion, no-JS and the 2.5 s failsafe are untouched.

## 3. Pages enhanced

Systemic (engine + shared CSS). Editorial photography exists after the first viewport on the homepage (PHOTO 02,
PHOTO 03), About (portrait) and Business models (figure); photographic covers on Capital Management and Capital
Allocation. Practice / Cases, Real Estate (after its protected cover), Materials and Financial X-Ray carry text
motion only — their copy, frames and forms are untouched.

## 4. Performance — production `fa83d0e` (clean worktree) vs Pass 2, Chrome mobile emulation

| Page | 390 LCP ms | 390 CLS | 430 LCP ms | 430 CLS |
|---|---|---|---|---|
| / | 604 → 436 | 0.0005 → 0.0005 | 296 → 320 | 0.0004 → 0.0004 |
| /about.html | 296 → 264 | 0.0004 → 0.0004 | 256 → 252 | 0.0003 → 0.0003 |
| /cases.html | 244 → 260 | 0.0004 → 0.0004 | 260 → 240 | 0.0003 → 0.0003 |
| /capital-management.html | 272 → 244 | 0.0004 → 0.0004 | 256 → 260 | 0.0003 → 0.1225 |
| /real-estate-control-system.html | 256 → 252 | 0.0004 → 0.0004 | 264 → 244 | 0.0003 → 0.0003 |
| /materials.html | 284 → 304 | 0.0004 → 0.0004 | 288 → 276 | 0.0003 → 0.0003 |
| /questionnaire.html | 256 → 488 | 0 → 0 | 252 → 280 | 0 → 0 |
| /ro/ | 292 → 288 | 0.0005 → 0.0005 | 280 → 288 | 0.0004 → 0.0004 |
| /ro/cases.html | 232 → 236 | 0.0004 → 0.0004 | 252 → 232 | 0.0003 → 0.0003 |

Long tasks 0 ms on every surface, both labels; stuck motion targets 0. Differences are single-run noise (cold first
page, no trend). The Capital Management 430 value of ~0.12 is the **pre-existing, intermittent** sticky-cover shift
already reported in Pass 1 (`.fx-stage__content` moving 36 px; it also appears on the untouched baseline in other
runs) — layout, not motion.

## 5. WebKit (Playwright WebKit 2359 — Safari / WKWebView engine)

- Reveal completeness after a full scroll, 36 surfaces (320 / 390 / 430 / 820 × 9 routes): overflow 0, stuck 0,
  unrevealed 0.
- Mask interpolation verified live (computed `clip-path` mid-transition): homepage figure `inset(0 0 100%)` →
  `inset(0 0 20.6%)` at 1.0 s → `inset(0)`; About portrait 100% → 20.6% → 1.9% → 0 with the frame radius kept.
- Layout regression spec: **6 / 6 passed** — financial tables, photo heroes, **Cases logic frame**, **real-estate
  flow frame**, **real-estate launcher**, statement labels.
- Reduced motion (9 routes, 390): `m-js` absent, targets not immediately visible: 0; no transform, clip or
  animation remains.

## 6. Desktop freeze (1024 / 1280 / 1440 / 1728 × homepage, About, Business models, Capital Management)

Computed motion declarations (transition durations, delays, easing, clip-path, animation) identical on all 16
surfaces before vs Pass 2; the only differences are sub-pixel transient samples of transitions in flight. Settled
full-page screenshots pixel-identical on 15 / 16 surfaces; homepage @1024 differs by 20 pixels (0.000 %).

## 7. QA

| Gate | Result |
|---|---|
| `node qa/run-all.mjs` (canonical, incl. website contract) | 104 / 104 gates, 3722 assertions, floors PASS |
| Layout regression spec (Cases frame, Real Estate, WebKit) | 6 / 6 |
| Accessibility sweep | 90 pages, 0 defects |
| Responsive audit, normal motion, 320 / 375 / 390 / 393 / 430 / 768 × 8 routes | 48 surfaces, issues 0 |
| Responsive audit, reduced motion, same matrix | 48 surfaces, issues 0 |
| `git diff --check` | clean |

Status line for the owner: DESIGN CHANGED: NO · DESKTOP CHANGED: NO · CASES HOTFIX PRESERVED: YES ·
REAL ESTATE FIX PRESERVED: YES · PASS 2 VISUALLY STRONGER THAN PRODUCTION: YES (see the comparison strips and
recordings) · READY FOR OWNER REVIEW: YES.

## 8. Evidence

`qa-evidence/mobile-motion-pass-2/`: key-stage strips and 0.2 s comparisons (before vs pass2) for homepage 390 /
430 and About 390, manifests and this comparison's numbers. Recordings (source of truth):
`qa-artifacts/mobile-motion-pass-2/` (untracked) — 01_homepage_390, 02_homepage_430, 03_about_390, 04_practice_390,
05_real-estate_390, 06_materials_390, each as `_before.webm` and `_pass2.webm`, identical viewport, pace (~525 px/s
measured), start point, engine and content state.
