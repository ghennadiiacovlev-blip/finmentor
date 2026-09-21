# FINMENTOR — REDESIGN IMPLEMENTATION PLAN

**Baseline:** `be9fd3f` · `node qa/run-all.mjs` → 101/101 gates, 3654 assertions
**Visual baseline:** `node qa/visual-evidence.mjs` → 32 passed, **1 pre-existing failure**
(LEGAL PAGE INTEGRITY, privacy pages, `note=false`) — recorded as WATCH-01, not caused
by and not addressed by this pass.

---

## 1. Stack findings

| Question | Answer |
|---|---|
| Build system | **none** — static HTML/CSS/JS served by GitHub Pages (Jekyll passthrough) |
| Package manager | none at root; no `package.json`, no bundler |
| CSS | single `style.css`, 216 KB, hand-authored, token-driven `:root` |
| JS | `main.js` (56 KB) + `analytics.js`, `lang.js`, `i18n-ro.js`, `lead-transport.js`, `assistant.js` |
| Components | none — HTML is authored per page; **shared CSS classes are the component system** |
| Localisation | full RU tree at root, full RO tree in `ro/`, structurally mirrored (22 sections each) |
| Test entry point | `node qa/run-all.mjs` (canonical, also used by CI) |
| Visual regression | `node qa/visual-evidence.mjs` — drives local Chrome over CDP, no npm deps |

### Consequences for the redesign
1. **No component abstraction exists.** Every structural change to `index.html` must be
   mirrored by hand in `ro/index.html`. A gate (`RU/RO VISUAL PARITY`) enforces this.
2. **Copy is under contract.** Three QA suites assert exact RU/RO strings. The redesign
   is therefore **presentational**: re-rank and re-space existing copy; do not rewrite it.
3. **Hero copy is *not* under contract** — only the `.hero__title` selector must survive
   and exactly one `<h1>` per page. The hero can be rebuilt freely.
4. **CSS is additive-safe.** A `VISUAL SYSTEM 2.0` layer appended to `style.css` can
   override earlier rules by cascade order without editing 216 KB of existing CSS.

---

## 2. Strategy

**Additive CSS layer + surgical markup.**

- New tokens and overrides are appended to `style.css` under a clearly marked banner.
- Existing selectors keep working; the new layer raises type scale, spacing and
  restraint on top of them.
- Markup changes are limited to: hero rebuild, one new statement section, one new
  pillars section, and card→row conversions in two sections.
- Every markup change is applied twice: `index.html` and `ro/index.html`.

**Why not a rewrite:** 216 KB of CSS encodes contrast-corrected light/dark field
overrides, mobile drawer behaviour and package-card typography that are all under test.
Rewriting would burn the QA baseline for no design gain.

---

## 3. Work packages

### WP-1 — Design tokens (`style.css`)
Append `VISUAL SYSTEM 2.0` layer:
- fluid type scale: `--fs-statement` … `--fs-label`
- spacing: `--sp-section`, `--sp-section-lg`, `--sp-11`, `--sp-12`
- container: `1200px → 1280px`, plus `--container-wide: 1440px`
- motion: `--dur-reveal: 760ms`, `--ease-editorial`
- gold restraint: reduce `--glow-gold`

### WP-2 — Editorial assets
- create `/images/editorial/` with three placeholder SVG fields at final aspect ratios
- placeholders are tonal navy/graphite compositions, **not** stock photography

### WP-3 — Hero rebuild (`index.html`, `ro/index.html`)
- remove `<canvas>`, mesh blobs, grain
- add `<picture>` photographic field + navy scrim
- reduce to: eyebrow → short H1 → large supporting statement → short body → 2 CTAs → proof line
- preserve `.hero__title`, both CTA `data-ga` / `data-event` / `data-cta-id` attributes, exactly one `<h1>`

### WP-4 — Signature statement section
New section after hero. Typography only, no cards:
- «ПРИБЫЛЬ ЕЩЁ НЕ ОЗНАЧАЕТ ДЕНЬГИ.» at `--fs-statement`
- PROFIT → CASH → WORKING CAPITAL → CAPITAL sequence
- must carry an `<h2>` (no orphan H3 rule)

### WP-5 — Owner control model
Three pillars replacing small-card clutter: `01 ДЕНЬГИ` / `02 РЕЗУЛЬТАТ` / `03 КАПИТАЛ`,
each with its three sub-terms (Cash Flow, Liquidity, Treasury / Management P&L, Margin,
Performance / Working Capital, CAPEX, Investments).

### WP-6 — Density reduction
- `chaos`: 8 rotated cards → editorial numbered list, rotation removed
- `industries`: 6 heavy cards → staggered editorial rows with hover insight
- card instances 28 → ~18

### WP-7 — Motion discipline
- `.reveal` entry retimed to 760ms expo-out
- image scale-in 1.00 → 1.025
- headline clip reveal
- `prefers-reduced-motion` audited

### WP-8 — Navigation
- transparent over hero → solid + blur on scroll, `76px → 64px`

### WP-9 — Responsive pass
375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1728

### WP-10 — QA
`run-all` must return 101/101. `visual-evidence` must return 32 passed / 1 pre-existing
failure — no new failure, no silently dropped gate.

---

## 4. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | RU/RO structural drift breaks parity gate | apply every markup edit to both files in the same step; parity gate re-run each time |
| R2 | Copy edit trips a commercial-polish assertion | no copy rewritten; only moved and re-styled |
| R3 | Larger type causes overflow at 390px | `visual-evidence` measures painted ink at 390 — run after each markup WP |
| R4 | Removing hero canvas breaks `main.js` | locate and guard the canvas initialiser; must no-op when the element is absent |
| R5 | New images cause CLS | `aspect-ratio` on every `<img>`; preload only the selected hero source |
| R6 | Gold-on-ivory contrast regression | reuse existing `.sec--light` bronze overrides; do not introduce new gold values |
| R7 | Reduced card count removes SEO copy | copy is relocated, never deleted; verified by `commercial-polish` |

---

## 5. Definition of done

- [ ] `node qa/run-all.mjs` → 101/101, ≥ 3654 assertions
- [ ] `node qa/visual-evidence.mjs` → no **new** failure vs baseline
- [ ] zero horizontal scroll at all eight widths
- [ ] zero new console errors
- [ ] RU and RO structurally identical
- [ ] no founder photograph in hero
- [ ] no fabricated claim introduced
- [ ] screenshots captured: desktop hero, desktop mid-page, mobile hero, mobile key section
- [ ] `REDESIGN_QA_REPORT.md` written with WATCH items
