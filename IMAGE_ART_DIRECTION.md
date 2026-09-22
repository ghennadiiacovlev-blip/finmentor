# FINMENTOR — IMAGE ART DIRECTION
## Editorial photography specification

**Scope:** exactly **three** photographic assets on the homepage. No fourth.
**Location:** `/images/editorial/`
**Rule:** production never hotlinks third-party imagery. Assets are exported locally
and committed. The three final photographs are project-specific AI-generated assets —
origin, derivatives and use are recorded in `ASSET_PROVENANCE.md`.

---

## AMENDMENT — editorial convergence pass (2026-09-22)

**This amendment supersedes the rows of the canonical table below where they differ.**
The masters actually in production are 1586 × 992 (PHOTO 01, 02) and 1122 × 1402 (PHOTO 03).

| | PHOTO 01 `hero-capital` | PHOTO 02 `capital-decision` | PHOTO 03 `real-assets` |
|---|---|---|---|
| Desktop render | full-bleed; the copy sits on a paper panel (`rgba(247,244,238,.9)`, blur 10px), not under a dark overlay | right 56% of the scene (`left: 44%`), height `min(100%, 62vw)`; fades into navy on the left and at the bottom | 5fr / 7fr grid column, height `clamp(520px, 80vh, 880px)` (≥ 901px), radius 4px, caption beneath |
| Mobile render (≤ 860 / 900px) | a relative photographic band `56svh` (min 340px); the panel overlaps its lower edge by 64px | a relative band, 300px, fading into navy at the bottom | static, full width, height `clamp(280px, 76vw, 400px)` |
| Scrim | top `rgba(8,17,31,.55)` → 0 at 22%; bottom `.28` → 0 at 26%; mobile top `.6` → 0 at 32% | `90deg` navy → 0 at 34% of the photo, plus bottom navy → 0 at 32% | none |

Text contrast is measured on the rendered composite (panel over photo for PHOTO 01; navy
field for PHOTO 02) — see `FINAL_VISUAL_QA_REPORT.md`.

---

## CANONICAL ASSET CONTRACT

**The values in this section are the only production source of truth.
Any historical values elsewhere in this document are superseded.**

Every value below was read from `style.css` / `index.html` / `ro/index.html` at
`8676f31` (the last cascade rule that applies wins; D1 overrides included). A replacement
photograph that respects this table drops in with **no CSS and no layout change**. One that
does not will crop badly — the contract is the brief.

Operational swap steps live in `PHOTO_ASSET_INTEGRATION_CHECKLIST.md`.

| | PHOTO 01 `hero-capital` | PHOTO 02 `capital-decision` | PHOTO 03 `real-assets` |
|---|---|---|---|
| Used by | Hero (`#top`) | Управление капиталом (`#capital-allocation`) | Бизнес-модели (`#industries`) |
| Container | `picture.hero__media` | `picture.capital-management__media` | `figure.industries__figure` |
| Master | **2400 × 1500 minimum (≈16:10)** | 1920 × 1280 (3:2) | 1920 × 2400 (4:5) |
| Desktop render | full-bleed behind copy, `object-fit: cover` | full-bleed behind copy, `object-fit: cover` | sticky column, height `clamp(420px, 66vh, 820px)`, `object-fit: cover` |
| Desktop `object-position` | **`68% 42%`** | **`50% 45%`** | **`50% 60%`** |
| Mobile breakpoint | `max-width: 860px` | `max-width: 900px` | `max-width: 900px` |
| Mobile render | full-bleed, section `min-height: 88svh` | full-bleed, single-column copy | static, full width, height `clamp(190px, 44vw, 280px)` |
| Mobile `object-position` | **`64% 42%`** | **`50% 50%`** | **`50% 55%`** |
| Protected zone | **left 40–45% tonally flat** — headline sits there | left ~38% under a 0.86–0.95 navy scrim | top ~20% calm for the overline |
| Scrim applied | desktop: 100° directional + vertical; mobile: vertical only | 95° directional + vertical, all widths | none — image reads at full value on ivory |
| Loading | `fetchpriority="high"`, preloaded in `<head>` | `loading="lazy"` | `loading="lazy"` |
| Responsive sources | `<source media>` already wired at 1440 / 1024 / 768 / ≤767 | none yet (single `<img>`) | none yet (single `<img>`, no `<picture>`) |

### Scrims as implemented

**PHOTO 01, desktop (> 860px)** — mid stop and top fade tuned against the final photograph
```
linear-gradient(100deg, rgba(8,17,31,.94) 0%, rgba(8,17,31,.88) 26%, rgba(8,17,31,.62) 50%,
                        rgba(8,17,31,.14) 64%, rgba(8,17,31,0) 82%),
linear-gradient(to bottom, rgba(8,17,31,.58) 0%, rgba(8,17,31,0) 30%,
                           rgba(8,17,31,0) 64%, rgba(8,17,31,.62) 100%)
```
**PHOTO 01, mobile (≤ 860px)**
```
linear-gradient(to bottom, rgba(8,17,31,.86) 0%, rgba(8,17,31,.74) 42%, rgba(8,17,31,.92) 100%)
```
**PHOTO 02, all widths** (the §31 override is the active rule)
```
linear-gradient(95deg, rgba(8,17,31,.95) 0%, rgba(8,17,31,.86) 34%,
                       rgba(8,17,31,.56) 62%, rgba(8,17,31,.34) 100%),
linear-gradient(to bottom, rgba(8,17,31,.66) 0%, rgba(8,17,31,.18) 34%, rgba(8,17,31,.70) 100%)
```
**PHOTO 03:** no scrim.

Text contrast is measured **against the scrimmed composite**, never the raw photograph.

### Hero `<source>` geometry (as wired)

| `media` | `width × height` attributes |
|---|---|
| `(min-width: 1440px)` | 2400 × 1500 |
| `(min-width: 1024px)` | 1600 × 1100 |
| `(min-width: 768px)` | 1200 × 1000 |
| `(max-width: 767px)` | 780 × 975 (4:5) |

### Not part of the contract
The `.editorial-band*` rules in `style.css` (e.g. `.editorial-band--asset img
{ object-position: 50% 60% }`) are not used by any page and do not govern any slot.

**What each slot must emotionally communicate, in one line each:**

- **PHOTO 01** — *scale and permanence.* An institution that was here before you and will
  be here after. Perspective, not a flat elevation.
- **PHOTO 02** — *judgement.* The moment before a capital decision, shown through materials
  and light rather than through a person.
- **PHOTO 03** — *real assets.* Something built, owned and measurable. Structure and
  materiality, never a skyline postcard.

**What all three must avoid:** smiling people, handshakes, laptops with charts, holograms,
neural-network motifs, glowing dashboards, city skylines, visible branding, drone hero
shots, anything that reads as a stock library thumbnail.

---

## 0. Status of assets

| Slot | File | Status |
|---|---|---|
| 01 Hero | `hero-capital.*` | **FINAL SHIPPED (v2).** AVIF/WebP/JPG from `hero-capital-final.png`, 1586×992 (≈16:10, below the 2400×1500 target). SVG kept as rollback. Licence record pending |
| 02 Decision environment | `capital-decision.*` | **FINAL SHIPPED.** AVIF/WebP/JPG from `capital-decision-final.png`, 1586×992 (below 1920×1280). A dusk terrace view rather than the brief's desk still-life. Text contrast through the scrim was verified. SVG kept as rollback. Licence record pending |
| 03 Real estate / investment | `real-assets.*` | **FINAL SHIPPED.** AVIF/WebP/JPG from `real-assets-final.png`, 1122×1402 (4:5, below 1920×2400). SVG kept as rollback. Licence record pending |

The shipped placeholders are **generated SVG fields**, not stock photography.
They are deliberately non-representational: a deep navy/graphite tonal field with
a restrained geometric structure and a single warm highlight. They are rendered with
`object-fit: cover` under the contract's `object-position` values, so swapping in the
licensed photograph is a **file replacement with no CSS change**.

A low-quality stock photograph would be worse than the placeholder — it would ship a
cliché into production and set the wrong perceived value. The placeholder is honest.

Shipped placeholder files (placeholder canvas sizes — **not** the master targets; the
masters are in the canonical contract above):

```
images/editorial/hero-capital.svg      2560 × 1440 canvas
images/editorial/capital-decision.svg  1920 × 1280 canvas
images/editorial/real-assets.svg       1920 × 2400 canvas
```

The placeholders stay in the repository until the licensed rasters are integrated and
verified. The swap procedure is `PHOTO_ASSET_INTEGRATION_CHECKLIST.md`.

---

## 0b. Generation / sourcing prompts for the three final assets

This environment can author **vector editorial artwork**, which is what ships today.
It cannot produce photographic raster images. The three prompts below are written to be
pasted directly into an image-generation model or handed to a photo researcher or a
commissioned photographer. Each is paired with a hard negative list.

> **Never substitute a generic stock photograph to close this out.** A cliché in the
> hero costs more perceived value than the current restrained artwork does.

### PROMPT 01 — `hero-capital` (2400×1500 minimum, ≈16:10)

> Architectural photograph of a contemporary European business building, shot from a
> low three-quarter angle. Facade of dark glazing set into pale limestone with slim
> metal mullions; strong vertical rhythm, off-centre composition. Late-afternoon
> directional sunlight rakes one vertical edge, leaving a single warm highlight against
> cool graphite and muted blue shadows. Deep, calm, institutional. Large uninterrupted
> area of flat sky and shadow across the left 45% of the frame with no structural
> detail. Shot on a medium-format camera with a tilt-shift lens, verticals corrected,
> natural light only, high dynamic range, no artificial colour grading.

**Negative:** skyline, cityscape panorama, skyscraper cluster, people, cars, signage,
brand marks, logos, lens flare, HDR halos, neon, blue-hour glow, drone view, reflections
of a photographer, holographic overlays, charts, any digital UI.

### PROMPT 02 — `capital-decision` (1920×1280, 3:2)

> Editorial still-life on a dark stone desk surface. A small stack of printed financial
> documents and a folded architectural drawing, a closed leather notebook, a single
> matte pen laid at an angle, a plain glass of water catching one highlight. Single
> soft directional light from the upper left, long quiet shadows, shallow depth of
> field. Muted palette of graphite, stone, warm paper and a single restrained brass
> note. Feels like the desk of someone who has just made a decision, not someone
> working. Shot on medium format, 100mm macro, natural window light.

**Negative:** hands, people, laptop, keyboard, phone, calculator, coffee cup, sticky
notes, printed bar charts or pie charts, trading screens, Bloomberg terminal, stock
tickers, visible logos or legible brand text, flat overhead flat-lay styling, bright
white office.

### PROMPT 03 — `real-assets` (1920×2400, 4:5 portrait)

> Vertical architectural detail of a high-end contemporary mixed-use building in
> Europe. A repeating colonnade or facade bay system in pale stone and bronze-toned
> metal, photographed straight on to emphasise geometry and material quality. Soft
> morning light, restrained contrast, calm and permanent in feeling. Composition leaves
> the top fifth of the frame quiet.

**Negative:** full skyline, whole-building hero shot, sky-dominant composition, people,
cars, retail signage, construction equipment, real-estate-listing aesthetics,
wide-angle distortion, oversaturated blue sky.

### Acceptance test for any candidate image
1. Place it behind the real headline at 1440 and 390 and measure contrast **through the
   scrim** — body text must clear 4.5:1.
2. Cover the logo. The frame must still read as *capital* rather than *office*.
3. If it could plausibly illustrate a generic consulting or SaaS landing page, reject it.

---

## 0c. Crop contract

Moved to **CANONICAL ASSET CONTRACT** at the top of this document.

---

## 1. Global standards

| Property | Requirement |
|---|---|
| Colour | deep blue / graphite / warm neutral. Cool shadows, warm highlights. |
| Highlight temperature | must sit beside `--gold-500 #C9A227` without clashing |
| Light | directional, morning or late afternoon, long shadows |
| Contrast | mid-to-high, but **never** crushed blacks behind text |
| People | never the primary subject; no faces; no founder |
| Branding | no legible logos, signage, or product marks |
| Prohibited | fake charts, dashboards, tickers, calculators, handshakes, AI-generated artefacts, city-skyline cliché, drone hero shots |
| Format | AVIF primary, WebP fallback, JPG last resort (the `<img src>`) |
| Colour profile | sRGB, 8-bit |
| Compression target | AVIF q≈50, WebP q≈78 |

### Text legibility contract
Any image that sits behind type carries a **navy scrim** — the exact gradients are the
ones listed under *Scrims as implemented* in the canonical contract. Text contrast is
measured **against the scrimmed result**, not the raw photograph.

---

## 2. IMAGE 01 — HERO · `hero-capital`

Geometry, crop, scrim and loading: **see CANONICAL ASSET CONTRACT.**

**Purpose.** Establish institutional authority in the first 5 seconds. The image must
say *capital, stability, scale, discipline, permanence* before a single word is read.

| Property | Value |
|---|---|
| Subject | contemporary business architecture — glass, stone, metal |
| Character | restrained European; sophisticated geometric lines; no ornament |
| Treatment | architectural detail or facade rhythm, **not** a skyline |
| Focal point | right third, upper-middle (sits under `68% 42%` / `64% 42%`) |
| **Negative space** | **left 40–45% must be tonally flat and uninterrupted** — the headline sits there. No structural edge, no bright element, no high-frequency detail in that band. |
| Alt text | `""` (decorative — the H1 carries the meaning) |

**Direction note.** The strongest version of this frame is a low-angle or straight-on
view of a facade where glazing meets stone, with one plane catching warm directional
light. Avoid symmetry — an off-centre vertical rhythm reads as considered rather than
corporate.

---

## 3. IMAGE 02 — DECISION ENVIRONMENT · `capital-decision`

Geometry, crop, scrim and loading: **see CANONICAL ASSET CONTRACT.**

**Purpose.** Support the capital/decision sections. Communicates *decision making,
capital discipline, analytical precision* — the human judgement behind the system,
without showing a human.

| Property | Value |
|---|---|
| Subject | premium dark desk surface; financial or investment documents, or architectural plans |
| Props | restrained notebook, pen, folded document, glass, metal, stone texture |
| Shot | editorial close-up or medium, shallow depth of field |
| Light | single directional source, soft falloff, visible warm highlight |
| Focal point | centre to centre-right; the left ~38% sits under the heaviest scrim |
| Alt text RU (as shipped) | `Рабочая среда принятия решений о капитале` |
| Alt text RO (as shipped) | `Mediul de lucru pentru deciziile de capital` |

**Prohibited specifically here:** hands typing on a laptop, smiling executives, a
calculator, a fake Bloomberg terminal, a printed bar chart, coffee-cup styling.

---

## 4. IMAGE 03 — REAL ESTATE / INVESTMENT · `real-assets`

Geometry, crop and loading: **see CANONICAL ASSET CONTRACT.**

**Purpose.** Supporting visual for real estate, investment and capital allocation.
Signals asset quality and permanence.

| Property | Value |
|---|---|
| Subject | high-end commercial or mixed-use architecture |
| Treatment | **architectural detail over generic skyline** — a corner, a colonnade, a facade rhythm |
| Character | strong geometry, premium materials, contemporary European |
| People | not required; if present, incidental and unidentifiable |
| Focal point | lower-centre (sits under `50% 60%` / `50% 55%`); must survive a wide mobile band |
| Negative space | top ~20% calm for section overline |
| Alt text RU (as shipped) | `Коммерческая недвижимость как объект управления капиталом` |
| Alt text RO (as shipped) | `Imobiliare comerciale ca obiect al managementului de capital` |

---

## 5. Founder portrait — existing asset, relocated

`portrait*.{jpg,webp}` already exists in the repository at four sizes and is **kept**.

- It appears **only** in the "Кто стоит за FINMENTOR" / About section.
- It must **not** appear in the hero, nor in the first two sections.
- Treatment: single column, editorial, no glow, no gold ring, no circular crop.
- Existing responsive sources and alt text are preserved unchanged.

---

## 6. Delivery checklist

The per-asset operational checklist is `PHOTO_ASSET_INTEGRATION_CHECKLIST.md`. Summary:

- [ ] All three assets licensed for commercial web use, licence recorded
- [ ] Exported AVIF + WebP + JPG at every width listed in the integration checklist
- [ ] Hero left 40–45% verified tonally flat against the real headline
- [ ] Text contrast measured against the scrimmed composite, ≥ 4.5:1
- [ ] `width`/`height` attributes kept on every `<img>`/`<source>` → zero CLS
- [ ] Hero preload points at the asset the browser actually selects
- [ ] `node qa/visual-evidence.mjs` green at 390 and 1440
