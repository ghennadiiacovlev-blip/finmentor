# FINMENTOR — REDESIGN QA REPORT
## Visual System 2.0 · premium editorial pass

**Date:** 2026-09-21
**Baseline HEAD:** `be9fd3f25249d59c8a61619b22d49ffdb0251b8f`
**Working tree:** uncommitted (3 modified, 4 added)

---

## 1. Baseline vs. result

| Suite | Baseline (`be9fd3f`) | After redesign | Verdict |
|---|---|---|---|
| `node qa/run-all.mjs` | **101/101** gates, 3654 assertions | **101/101** gates, 3654 assertions | ✅ no gate lost |
| `node qa/visual-evidence.mjs --keep` | 32 passed, **1 failed** | 32 passed, **1 failed** | ✅ identical |
| Assertion floors | PASS | PASS | ✅ |

The single failure is **pre-existing and unrelated** — see WATCH-01.
Assertion total is unchanged at 3654: nothing was silently dropped.

---

## 2. Rendered verification

`qa/visual-evidence.mjs` drives local Chrome over CDP and **measures painted ink**,
not source. Every gate below passed at **320 / 390 / 768 / 1024 / 1440** on both
language editions:

| Gate | Result |
|---|---|
| DOCUMENT HORIZONTAL OVERFLOW | 0 |
| VISIBLE TEXT OUTSIDE VIEWPORT | 0 |
| CLIPPED TEXT | 0 |
| PAINTED TEXT CLIPPING | 0 |
| PAINTED TEXT OUTSIDE VIEWPORT | 0 |
| ZERO-HEIGHT TEXT | 0 |
| CTA OVERFLOW / CTA WRAPPING | 0 / PASS |
| CRITICAL INLINE ADJACENCY | 0 |
| HEADER COLLISION @390 | 0 |
| RU/RO VISUAL PARITY | PASS |
| NAVY/GOLD VISUAL CONTRACT | PASS |
| SCREENSHOT DETERMINISM (run A vs B) | byte-identical |
| FONT / PAINT INCOMPLETE CAPTURES | 0 |

98 screenshots retained in `qa-artifacts/visual-v2/`.

---

## 3. Structural integrity

| Check | Value |
|---|---|
| Sections, RU / RO | 23 / 23 — parity held |
| `<h1>` per page | 1 / 1 |
| RO Telegram links | 7 (contract requires exactly 7) |
| RO primary diagnostic CTA label | 3 occurrences (contract requires ≥ 3) |
| Console errors | none observed |

---

## 4. Files changed

```
 index.html     |  88 +++++---     hero rebuilt, capital chain, pillars section, preload, body.home
 ro/index.html  |  88 +++++---     identical structural mirror
 style.css      | 564 +++++++++    appended VISUAL SYSTEM 2.0 layer
 3 files changed, 694 insertions(+), 46 deletions(-)
```

Added:
```
FINMENTOR_VISUAL_SYSTEM_2.md
IMAGE_ART_DIRECTION.md
REDESIGN_IMPLEMENTATION_PLAN.md
REDESIGN_QA_REPORT.md
images/editorial/hero-capital.svg
images/editorial/decision-environment.svg
images/editorial/real-estate-investment.svg
```

No file deleted. No URL changed. No route, form, webhook, tracking attribute,
price, or methodology string altered.

---

## 5. Visual changes by section

| Section | Before | After |
|---|---|---|
| **Header** | static border | transparent over hero, solid + hairline on scroll |
| **Hero** | `<canvas>` particle field + 3 blurred mesh blobs + grain; 24-word H1; 48-word subtitle; 2 CTAs + inline link + trust line | photographic architectural field + navy scrim; 4-word H1 at 40–92px; three-line display statement; one-line body; 2 CTAs; proof line |
| **Symptoms** | 8 rotated glass cards, backdrop-blur, coloured risk bars | two-column editorial index, hairline separators, single gold counter rail |
| **Signature statement** | keyword + question | same copy, larger (44–120px), plus `PROFIT → CASH → WORKING CAPITAL → CAPITAL` chain and a short capital note |
| **Owner control model** | *did not exist* | new: three pillars — 01 ДЕНЬГИ / 02 РЕЗУЛЬТАТ / 03 КАПИТАЛ, each with three terms |
| **Business models** | 6 heavy gradient cards with glow and lift | editorial rows: sticky name column + single prose column, flagship marked by a gold rail |
| **Light sections** | unchanged tokens | inherited larger type scale and section rhythm |
| **All sections** | flat 128px padding | fluid `clamp(80px, 8.5vw, 168px)`; statement sections `clamp(112px, 12vw, 232px)` |

### Card density
Rendered card surfaces on the homepage: **28 → 14 (−50%)**, exceeding the 30–40% target.

Cards retired as rendered objects: 8 symptom cards, 6 business-model cards.
Cards retained: 4 sample, 4 material, 3 step, 3 result.

> The class names `chaos-card` / `industry-card` remain in the markup. The conversion
> is **CSS-led by design**: it keeps RU/RO structurally identical for the parity gate,
> touches no copy under commercial contract, and keeps every string painted. The
> objects no longer *render* as cards.

---

## 6. Components introduced / removed

**Introduced (CSS):** `.hero--editorial`, `.hero__media`, `.hero__scrim`,
`.hero__statement`, `.capital-chain`, `.capital-chain__node`,
`.statement-screen__note`, `.pillars__grid`, `.pillar`, `.pillar__index`,
`.pillar__title`, `.pillar__terms`, `.container--editorial`, `.sec--pivot`, `body.home`.

**Introduced (tokens):** `--fs-statement/h1/h2/h3/lead/body/label`, `--sp-section`,
`--sp-section-lg`, `--sp-11`, `--sp-12`, `--measure-prose`, `--measure-lead`,
`--container-editorial`, `--ease-editorial`, `--dur-image`.

**Removed from markup:** `.hero__canvas`, `.hero__mesh`, `.hero__blob` ×3,
`.hero__grain`, `.hero__secondary` link.
Their CSS and the `blobFloat` keyframes remain in `style.css` (unused, harmless) so
no other page that may reference them regresses.

**No JS change.** `initCanvases()` and `initParallax()` in `main.js` were already
null-guarded, so removing the hero canvas and mesh is a no-op for them — verified
by reading both functions before the change.

---

## 7. Image asset requirements

Three placeholders ship at final geometry. **All three need licensed photography**
before this is a finished premium site — see `IMAGE_ART_DIRECTION.md` for full specs.

| Slot | File | Final asset needed |
|---|---|---|
| 01 Hero | `images/editorial/hero-capital.svg` | contemporary business architecture, glass/stone/metal, 2560×1440, **left 45% tonally flat** |
| 02 Decision | `images/editorial/decision-environment.svg` | premium dark desk, financial documents, 1920×1280 |
| 03 Real estate | `images/editorial/real-estate-investment.svg` | high-end commercial architecture detail, 1920×2400 |

Placeholders are generated tonal SVG fields, deliberately non-representational —
**not** low-quality stock. Swapping is a file replacement plus three `<source>` lines;
the `aspect-ratio`, `object-position` and scrim CSS need no change.

**Slots 02 and 03 are authored but not yet placed on the homepage.** The hero uses
slot 01. Placing 02 and 03 is the natural next step once real photography exists —
committing two more large placeholder fields to the live page would have added
weight without adding meaning.

---

## 8. Accessibility

| Item | Result |
|---|---|
| Hero text contrast | measured against the **scrimmed composite**; body `rgba(255,255,255,0.72)` and white display type on ≥ `rgba(8,17,31,0.88)` — passes AA |
| Gold on ivory | unchanged — existing `.sec--light` bronze `#8C6A1A` / `#765814` overrides retained; both ≥ 4.5:1 gates still pass |
| Heading order | one `<h1>`; new section uses `<h2>` then `<h3>`; no orphan `<h3>` (`financial-map.qa.mjs` green) |
| Hero image | decorative — `alt=""`, scrim `aria-hidden` |
| Capital chain | semantic `<ol>` of four items with `aria-label`; arrows are CSS pseudo-elements, so they are never announced |
| Reduced motion | honoured — hero image animation, reveals and row transitions all disabled; canonical hover-displacement block verified last in `style.css` |
| Touch targets | unchanged; CTA buttons keep `btn--lg` sizing |
| Focus states | untouched |

---

## 9. Performance

| Item | Result |
|---|---|
| Hero `<canvas>` particle field | **removed** — one fewer `requestAnimationFrame` loop and pointer listener on the critical path |
| 3 blurred mesh blobs (`filter: blur(90px)`, infinite animation) | **removed** — three continuously animating large-radius blur layers gone |
| Hero image | `<link rel="preload" as="image" fetchpriority="high">` + `fetchpriority="high"` on the `<img>` |
| CLS | explicit `width`/`height` on the hero image |
| Animation libraries | none added |
| Autoplay video | none |
| CSS | +564 lines appended (~13 KB unminified) to an existing 216 KB file |

**Not done:** AVIF/WebP `srcset` is specified but cannot ship until real photography
exists — an SVG placeholder has no raster variants. Below-fold `loading="lazy"`
applies to slots 02/03, which are not yet placed.

**Not measured:** no Lighthouse or Core Web Vitals run was performed. The changes are
directionally positive (three animated layers and a canvas loop removed, one preloaded
image added), but this report does not claim a measured score.

---

## 10. WATCH items

**WATCH-01 — pre-existing visual-evidence failure (not introduced here).**
`LEGAL PAGE INTEGRITY` fails on `ru-privacy` and `ro-privacy` at all five widths with
`note=false`. Present at baseline `be9fd3f`, identical after the redesign. The privacy
pages were not touched by this pass. Needs its own fix.

**WATCH-02 — signature statement copy preserved, not replaced.**
The brief proposed «ПРИБЫЛЬ ЕЩЁ НЕ ОЗНАЧАЕТ ДЕНЬГИ.» The existing site says
«прибыль. / а если это ещё не деньги?» — semantically equivalent and arguably stronger
as a question. Existing copy was kept per the preserve-if-uncertain rule. Owner decision.

**WATCH-03 — business-model hover insight not implemented.**
The brief asked for contextual insight revealed on hover. Collapsing that copy would
render it at zero height, which trips the `ZERO-HEIGHT TEXT = 0` gate, and hiding
keyword-dense text carries SEO risk. All copy stays painted; density was reduced by
typography instead. Revisit if the copy is shortened.

**WATCH-04 — hero CTA priority was inverted.**
Per brief §7, primary is now «Обсудить задачу» (Telegram) and secondary is the
Financial X-Ray questionnaire — previously the reverse. Both CTAs, destinations and
all tracking attributes are unchanged. **This changes which lead route gets visual
priority and may move questionnaire conversion.** Watch analytics; reverting is a
two-class swap.

**WATCH-05 — `.reveal` node count not reduced.** 138 → 146. Motion was calmed by
retiming, not by removing nodes. Rationale in `FINMENTOR_VISUAL_SYSTEM_2.md` §8.

**WATCH-06 — entry animation depends on the language gate.**
On a first visit all 146 `.reveal` elements sit at `opacity: 0` until the language
overlay is dismissed. This is **pre-existing** behaviour, confirmed on the current
build. It is invisible to the QA gates because they emulate `prefers-reduced-motion`,
where reveals are forced visible. Worth a robustness review — a failed observer leaves
sections blank for motion-enabled users.

**WATCH-07 — window resize unavailable during live review.**
Mobile was verified through the 320/390/768/1024/1440 painted-ink gates and the 390px
hero screenshot, all green. A hands-on aesthetic pass over the new pillars and
business-model rows at 390px has not been done by eye.

---

## 11. Claims discipline

No new marketing claim introduced. No fabricated client count, ROI, revenue figure,
testimonial, case-study number or certification. No pricing or service scope changed.
The published proof line (`15+ лет в корпоративных финансах`) is unchanged, and the
expert-verification caveat was **retained** rather than dropped for brevity.

---

## 12. Definition of done

- [x] `run-all` 101/101, 3654 assertions
- [x] `visual-evidence` no new failure vs baseline
- [x] zero horizontal scroll at every audited width
- [x] no new console errors
- [x] RU and RO structurally identical (23/23 sections)
- [x] no founder photograph in hero
- [x] no fabricated claim
- [x] four deliverable documents written
- [ ] licensed photography for all three editorial slots — **blocked on assets**
- [ ] Core Web Vitals measured — **not run**
