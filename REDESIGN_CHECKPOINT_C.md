# FINMENTOR — VISUAL CHECKPOINT C
## Art-direction correction · 4 areas only · awaiting approval

**Branch:** `redesign/visual-system-2`
**Commits:** `be9fd3f` (A, pre-redesign) → `3598dbd` (B, editorial/light attempt) → `a2c4271` (C, this checkpoint)
**Status:** STOPPED at the checkpoint. The rest of the homepage has not been redesigned.

---

## 1. What was wrong with B, and what changed

| Criticism of B | What C does |
|---|---|
| Mechanically "light"; cream used as a substitute for composition | The light/dark formula is **deleted**. No percentage target. Each of the four areas got a composition first; the field follows it. |
| Oversized serif — magazine, not advisory | Display type moved from **Playfair Display → Manrope**, the grotesk already loaded. H1 92px → **58px** max, H2 64px → **40px** max. Emphasis now comes from weight and spacing. |
| Excessive empty space with nothing anchoring it | Hero anchored by **architecture at full viewport**. The profit/capital statement anchored by a **capital-flow diagram**. The symptom section anchored by a **two-column claim/evidence structure**. |
| SaaS cards, shadows, bordered boxes | Symptom cards → numbered editorial index on hairlines. Leftover decorations removed (gold haze, verdict glow, centred bridge rule, blue index tint on 05–08). |
| Mixed visual languages | One language across the four areas: grotesk, hairline, numeric index, one gold accent per view. |
| Lost FINMENTOR authority | Navy restored as the anchor for the hero, the capital statement and the navigation — not as a wash over everything. |

---

## 2. The four areas

### 2.1 Header / navigation
Transparent over the hero; on scroll it becomes navy at 92% with a saturating blur
and a single 7%-opacity hairline. Links dropped to 11.5px uppercase, 0.14em tracking.
One primary CTA. No borders, no elevation.

### 2.2 Hero — composition A (full-bleed architecture + restrained overlay)
The facade now **holds the whole viewport** and recedes to the right from a low angle,
so the frame carries scale instead of asking empty space to carry it. The scrim is a
100° directional ramp weighted to the lower left: the headline column is protected and
the upper-right facade stays legible as a building.

Order: gold rule + eyebrow → 58px headline → three-line statement → one-line body →
two CTAs → proof line. Gold appears exactly twice: the eyebrow rule and the primary CTA.

### 2.3 «Финансовый хаос» — composition B (claim left / evidence right)
Left column: overline, headline, lead, and the verdict «Это не проблема людей. / Это
отсутствие системы.» sitting **directly under the claim** above a gold hairline.
Right column: the eight symptoms as a numbered index on hairline separators.
The light field is here because the section is eight sentences of reading — the one
justification the correction allows.

### 2.4 «Прибыль ≠ деньги» — composition D (statement + financial visual)
Navy, because the subject is capital. Left: the statement, its question in bronze, and
the explanatory note grouped tightly. Right: **Profit → Cash → Working Capital → Capital**
as a vertical flow with a drawn gold spine, per-stage ticks and Capital resolved in gold.
The spine draws itself in on view. No card, no box, no shadow.

---

## 3. Screenshots

`qa-artifacts/checkpoint/`

| File | Frame |
|---|---|
| `hero-1440.png` / `hero-390.png` | Hero, desktop and mobile |
| `chaos-1440.png` / `chaos-390.png` | «Финансовый хаос» |
| `profit-1440.png` / `profit-390.png` | «Прибыль ≠ деньги» |

Comparison frames for A and B were captured from their own commits into the session
scratchpad (`compare/A-hero-1440.png`, `A-chaos-1440.png`, `B-hero-1440.png`, `B-chaos-1440.png`).

---

## 4. Reference comparison

| Criterion | A (pre-redesign) | B (editorial/light) | C (checkpoint) |
|---|---|---|---|
| Authority | moderate — dark, but particle field reads generic | weak — cream dominates, no anchor | **strong** — architecture at scale |
| Visual calm | busy (constellation animation) | calm but empty | **calm and occupied** |
| Photographic presence | none | none (artwork below fold) | artwork holds the hero — *still not photography* |
| Composition | centred stack | single column on cream | left/right compositions with a subject |
| Whitespace quality | tight | unanchored | bounded by content |
| Typography | Playfair 92px, magazine | Playfair 120px, more magazine | **Manrope 58px, institutional** |
| Brand identity | navy+gold, strong | navy nearly absent | navy anchors, gold as precision |
| Cards | 8 glass cards with coloured bars | rows on cream | numbered index, no cards |

C outperforms both A and B on every line except photographic presence, where it
improves on them but does not yet meet the benchmark — see §6.

---

## 5. QA at this checkpoint

| Suite | Result |
|---|---|
| `node qa/run-all.mjs` | **101/101 gates, 3654 assertions** — identical to baseline |
| `node qa/visual-evidence.mjs` | **32 passed, 1 failed** — the failure is LEGAL PAGE INTEGRITY on the privacy pages, red at baseline `be9fd3f` too and untouched by this work |
| RU/RO parity | 24/24 sections both editions |
| Preserved | content, SEO, hreflang, structured data, forms, Financial X-Ray, analytics, lead flow, internal links, intro/splash, business logic |

---

## 6. The open gap — photography

**This environment cannot generate photographs.** Every image on the page is vector
artwork I authored. The hero artwork now uses low-angle perspective, receding mullions,
floor slabs and a warm raking edge, and it does create scale — but it is a drawing, and
at close inspection it reads as a drawing.

The benchmark's authority rests overwhelmingly on real photography. Until the three
licensed images land, C is a correct *composition* carrying a stand-in *asset*.

Generation prompts and hard negative lists for all three are written and ready in
`IMAGE_ART_DIRECTION.md` §0b. The markup, `aspect-ratio`, `object-position` and scrim
are already built to the final geometry, so the swap is a file replacement plus three
`<source>` lines — no layout change.

**Recommended next step before propagating this direction:** commission or license
PHOTO 01 and drop it into `images/editorial/hero-capital.*`. The hero is where the
art direction either convinces or does not, and that judgement should be made on the
real asset.

---

## 7. Deliberately NOT done (awaiting approval)

- Sections 5–24 of the homepage are untouched by C. The mechanical light-field pass
  from B was **reverted** on pillars, difference, industries, packages and `#after`
  so an unapproved direction does not propagate.
- «Форматы работы» still uses its existing cards. The correction specifies an
  institutional mandate list (01–04, separators, understated CTA); that is queued.
- The global card/shadow audit is queued.
- Structures added during B that sit outside the four areas and were left in place:
  the three-pillar owner-control section, the capital-allocation section, and two
  full-bleed image bands. They are composition-led and dark, so they do not conflict
  with the correction — but they have **not** been reviewed at this checkpoint.

---

## 8. Acceptance question

> *Does it look like a company an owner would trust with capital allocation and
> financial control?*

Hero and capital statement: yes, subject to the photography gap.
Symptom section: yes.
The rest of the homepage: not yet — it has not been done.
