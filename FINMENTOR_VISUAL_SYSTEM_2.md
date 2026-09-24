# FINMENTOR — VISUAL SYSTEM 2.0
## Editorial CFO Advisory / Capital Management

**Status:** specification for the premium visual pass on the existing production site.
**Scope:** presentation layer only. No business model, methodology, pricing, routing, or lead-flow change.
**Baseline commit:** `be9fd3f` — `node qa/run-all.mjs` 101/101 gates, 3654 assertions.

---

## 0. Governing principle

> **LESS INTERFACE. MORE AUTHORITY.**

The site currently earns its density honestly — the methodology is real and the copy is
specific. The problem is not *what* is said, it is that too much of it is said
*simultaneously, at the same visual volume*. Everything is a card, every card competes,
and the eye is never told where to look first.

Visual System 2.0 changes **rank**, not **content**. Nothing of substance is deleted.

### The 5-second test
A first-time visitor must read the page as
*"these people understand capital and serious business decisions"* —
not *"this site has many financial tools."*

---

## 1. What is preserved (non-negotiable)

| Preserved | Note |
|---|---|
| FINMENTOR name, logo, brand mark | untouched |
| Deep navy primary / warm gold accent | token values unchanged |
| Tagline "Financial Strategy. Real Results." | untouched |
| Full methodology copy | re-ranked, never removed |
| RU / RO localisation and parity | every structural change mirrored in `ro/` |
| All URLs, canonical, hreflang, structured data | untouched |
| Forms, questionnaire, lead flows, tracking, analytics | untouched |
| Existing QA contracts | 101/101 must remain green |

**Copy is under test.** `qa/commercial-polish.test.mjs`, `qa/premium-typography.test.mjs`
and `qa/editorial-production.test.mjs` assert on exact RU/RO strings in `index.html`.
This is a feature, not an obstacle: it guarantees the redesign cannot quietly
erode the commercial proposition. Every string those gates name is load-bearing.

---

## 2. Diagnosis of the current homepage

Measured on `index.html` @ `be9fd3f`:

| Symptom | Measure | Consequence |
|---|---|---|
| Section count | 22 | no rest, no rhythm |
| Card instances | 28 discrete cards | everything ranks equally |
| `.reveal` animated nodes | 138 | motion is ambient noise, not emphasis |
| Hero payload | kicker + 24-word H1 + 48-word subtitle + 2 CTA + link + trust line | no single message |
| Hero background | `<canvas>` + 3 mesh blobs + grain | reads generative/SaaS, not institutional |
| Photographic assets | 0 | nothing conveys capital, permanence, scale |
| Media queries | 25 distinct, ad-hoc | responsive behaviour is incidental |
| Section padding | flat `128px` everywhere | uniform height flattens hierarchy |
| Container | `1200px` | thin at 1440/1728 |

**Root cause:** the page has no *silence*. Premium is produced by what you leave out
and by how much room you give what remains.

---

## 3. Colour system

Identity tokens are unchanged. What changes is **distribution**.

### 3.1 Fields
The page is composed as an alternation of two institutional fields, not one dark wash:

| Field | Value | Role |
|---|---|---|
| **Deep Navy** | `--navy-900 #08111F` | primary dark field — authority, capital |
| **Institutional Ivory** | `#F2EFE7` | primary light field — clarity, editorial reading |
| **Soft Graphite** | `--graphite-900 #15171C` | secondary dark, used sparingly for contrast breaks |
| **FINMENTOR Gold** | `--gold-500 #C9A227` | accent **only** |

The existing `.sec--light` token override block is already contrast-correct: it
remaps gold to bronze `#8C6A1A` on ivory. **This is retained and relied upon** —
it is why gold-on-light passes WCAG here.

### 3.2 Gold discipline
Gold is permitted on:
- fine 1px rules and separators
- a single emphasised keyword per statement
- CTA accent and hover
- small numeric / index labels (`01`, `02`, `03`)

Gold is **forbidden** on:
- large filled areas, full-width gradient bands
- more than one emphasis per viewport
- glow stacking (`--glow-gold` is reduced, not removed)

**Rule of thumb:** if two gold elements are visible at once, one of them is wrong.

### 3.3 Contrast floors (enforced by `qa/premium-typography.test.mjs`)
- dark micro-gold `--micro-label-gold #D8BA63` on `#08111F` ≥ 4.5:1
- light bronze `#765814` on `#F2EFE7` ≥ 4.5:1

---

## 4. Typography

**No new font families.** `Playfair Display` (display) + `Manrope` (UI/body) are
already loaded, already licensed, and already carry the brand. Adding a font would
cost a render-blocking request and buy nothing. What was missing is **scale and
restraint**, not a typeface.

### 4.1 Fluid editorial scale (new tokens)

| Token | Clamp | Range | Use |
|---|---|---|---|
| `--fs-statement` | `clamp(3rem, 7.2vw, 7.5rem)` | 48 → 120px | signature editorial statements |
| `--fs-h1` | `clamp(2.75rem, 5.4vw, 5.75rem)` | 44 → 92px | hero headline |
| `--fs-h2` | `clamp(2.05rem, 3.6vw, 4rem)` | 33 → 64px | section titles |
| `--fs-h3` | `clamp(1.35rem, 1.9vw, 1.9rem)` | 22 → 30px | pillar / row titles |
| `--fs-lead` | `clamp(1.15rem, 1.5vw, 1.5rem)` | 18 → 24px | section leads |
| `--fs-body` | `clamp(1.0625rem, 1.1vw, 1.25rem)` | 17 → 20px | prose |
| `--fs-label` | `clamp(0.6875rem, 0.8vw, 0.8125rem)` | 11 → 13px | overlines, indices |

Fluid `clamp()` throughout — no breakpoint-hardcoded type.

### 4.2 Rules
- **Measure:** prose capped at `62ch`; leads at `50ch`; statements at `16ch`.
- **Headings are short.** Long explanatory sentences move to the lead, not the H2.
- **Line height:** display `1.02–1.08`; body `1.7`.
- **Tracking:** display `-0.025em`; uppercase labels `+0.18em`.
- **Weights:** 400 / 500 / 700 only. No 300, no 800.
- **Uppercase** is reserved for labels ≤ 5 words.

---

## 5. Spacing

The single highest-leverage change.

```
--sp-section:      clamp(80px, 8.5vw, 168px)   /* standard section rhythm */
--sp-section-lg:   clamp(112px, 12vw, 232px)   /* statement / pivot sections */
--sp-11: 160px   --sp-12: 200px
```

- Sections **do not share a height**. Statement sections breathe more than list sections.
- Container widens `1200px → 1280px`; `--container-wide: 1440px` for editorial bleed.
- Side gutter minimum `20px` at 375px, `24px` at 390px+.
- Target: **fewer objects per viewport**, one clear focal point per screen.

---

## 6. Homepage hierarchy

Order of persuasion: **authority → positioning → desire → depth.**

| # | Section | Treatment |
|---|---|---|
| 01 | **Hero** | one message, photographic field, 2 CTAs. No cards, no dashboards. |
| 02 | **Signature statement** | «ПРИБЫЛЬ ЕЩЁ НЕ ОЗНАЧАЕТ ДЕНЬГИ.» + PROFIT→CASH→WORKING CAPITAL→CAPITAL. Typography only. |
| 03 | **Symptoms** (`chaos`) | 8 rotated cards → restrained editorial list, ivory field |
| 04 | **Profit vs capital** | retained, density reduced |
| 05 | **Owner control model** | **new rank:** three pillars — ДЕНЬГИ / РЕЗУЛЬТАТ / КАПИТАЛ |
| 06 | **Differentiation** | editorial rows, unchanged copy |
| 07 | **Business models** | 6 heavy cards → staggered editorial rows + hover insight |
| 08 | **Capital logic** | retained |
| 09 | **Solutions / packages** | curated, full catalogue stays on child pages |
| 10 | **Founder** (`about`) | portrait lives **here**, never in hero |
| … | remainder | spacing + type pass, structure preserved |

### 6.1 Hero contract
- Exactly one `<h1>` (enforced by `qa/financial-map.qa.mjs`)
- `.hero__title` selector must survive (`qa/visual-evidence.mjs`)
- **No founder photograph** anywhere in the hero or first two sections

---

## 7. Cards

Homepage card instances: **28 → target 17–19** (≈35% reduction).

Replacement vocabulary, in order of preference:
1. editorial rows with a 1px separator
2. numbered frameworks (`01 / 02 / 03`)
3. image + text composition
4. plain lists with generous leading
5. a card — only when the content is genuinely parallel and self-contained

Where cards remain:
- internal padding `+40%`
- border opacity `0.08 → 0.05`
- no decorative gradients, no glow, no rotation
- one type rank change inside the card, not three

---

## 8. Motion

Premium motion is **almost invisible**.

| Property | Value |
|---|---|
| Duration | 500–900ms (`--dur-reveal: 760ms`) |
| Easing | `cubic-bezier(0.16, 1, 0.3, 1)` — expo-out, never bounce |
| Entry | opacity 0→1 + translateY 24px→0 |
| Image | scale 1.00 → 1.025 over 1.2s on view |
| Headline | clip-path reveal, bottom-up |
| Rule | line scaleX 0→1 |

Prohibited: spin, 3D, particles, cursor effects, animated gold, looping animation,
autoplay video.

**Hard constraints**
- `prefers-reduced-motion: reduce` disables all transform/opacity entry animation.
- Motion never gates reading or CTA interaction — content is readable at frame 1.

**On `.reveal` node count — not reduced in this pass.** The intent was to cut 138
animated nodes to ≤ 60. It was not done, and the count is now 146 (the two new
sections add eight). Motion was made calmer by *retiming* — 760ms expo-out, no
displacement on hover — rather than by removing nodes.

Stripping ~86 `.reveal` classes is a mechanical edit across two language editions
where a missed element stays at `opacity: 0` forever, and the entry animation is
already near-invisible at its new timing, so the change carries real regression
risk for little perceived gain. It is recorded as WATCH-05 rather than claimed.

---

## 9. Navigation

- Mark left, limited links, one primary CTA right.
- Rest state: transparent over hero. Scrolled: solid navy + backdrop blur, height
  `76px → 64px`.
- Single hairline bottom border at `0.06` opacity, only when scrolled.
- Mobile drawer behaviour unchanged (it is under test and it works).

---

## 10. Responsive

Verified widths: **375 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1728**.

- Mobile keeps the section rhythm — it is not a compressed desktop.
- Statement typography stays large on mobile (48px floor); it is the point of the section.
- Images carry distinct mobile crops via `object-position`, never letterboxing.
- Zero horizontal scroll at every width (gate: `DOCUMENT HORIZONTAL OVERFLOW = 0`).

---

## 11. Performance

- Hero image: `preload` the actual chosen source only.
- AVIF → WebP → JPG fallback via `<picture>`; `srcset` at 768 / 1280 / 1920 / 2560.
- Below-fold images `loading="lazy" decoding="async"`.
- Explicit `width`/`height` or `aspect-ratio` on every image → no CLS.
- No animation library added. Motion is CSS + the existing IntersectionObserver.
- Hero `<canvas>` removed → one fewer rAF loop on the critical path.

---

## 12. Accessibility

- WCAG AA text contrast on both fields; gold-on-light uses bronze `#8C6A1A`.
- Visible focus ring retained on every interactive element.
- Semantic heading order, one H1, no orphan H3 (`qa/financial-map.qa.mjs`).
- Decorative imagery `aria-hidden`; meaningful imagery carries real alt text.
- Touch targets ≥ 44×44px.
- Reduced-motion honoured system-wide.

---

## 13. Anti-patterns

FINMENTOR must never look like:
accounting outsourcing · bookkeeping · a BI vendor · an AI automation agency ·
generic management consulting · startup SaaS · a fintech dashboard.

Concretely, this means **no**: stock people in suits shaking hands, fake dashboards or
invented charts in the hero, gradient-mesh backgrounds, glassmorphism stacking,
emoji iconography, badge clutter, counters of fabricated metrics.

---

## 14. Claims discipline

No new marketing claim is introduced by this pass. Specifically **not** fabricated:
client counts, ROI figures, revenue improvements, testimonials, case-study numbers,
certifications, awards.

The only proof line permitted in the hero is the one already published:
`N+ лет в корпоративных финансах`, where N is no longer typed by hand: since the
refine-proof-practice-flow branch it is computed from the single career-start date in
`experience.js` (August 2008, calendar-anniversary rule) and verified by
`qa/experience-counter.test.mjs`.

Where a content or architectural decision is uncertain, the existing implementation
is **preserved** and recorded as a WATCH item in `REDESIGN_QA_REPORT.md`.
