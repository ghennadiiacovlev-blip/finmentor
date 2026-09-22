# FINMENTOR — ASSET PROVENANCE

Record of the photographic assets used on the website: where they come from, where they
are used and which files are derived from them.

**Origin of all three final photographs:** project-specific AI-generated assets, created
for FINMENTOR's editorial art direction (`IMAGE_ART_DIRECTION.md`). They are not
third-party stock photographs and depict no real, identifiable person, building owner or
brand.

**Rules**
- Production serves only the local derivatives below; nothing is hotlinked.
- Derivatives are downscaled or re-encoded only. None is upscaled beyond its master.
- A replacement photograph gets a new row here before it is committed.

---

## Final photographs

| | PHOTO 01 | PHOTO 02 | PHOTO 03 |
|---|---|---|---|
| Master file | `images/editorial/hero-capital-final.png` | `images/editorial/capital-decision-final.png` | `images/editorial/real-assets-final.png` |
| Original dimensions | 1586 × 992 | 1586 × 992 | 1122 × 1402 |
| Purpose | Hero: capital, control, a view over the city at dusk | Capital management: where the next capital goes | Business models: physical economic scale (built, owned, measurable assets) |
| Origin | project-specific AI-generated asset | project-specific AI-generated asset | project-specific AI-generated asset |
| Date added | 2026-09-21 | 2026-09-21 | 2026-09-21 |
| Derivatives | `hero-capital.avif`, `hero-capital.webp`, `hero-capital.jpg` | `capital-decision.avif`, `capital-decision.webp`, `capital-decision.jpg` | `real-assets.avif`, `real-assets.webp`, `real-assets.jpg` |
| Used on | `index.html`, `ro/index.html` (`#top`, preloaded, `fetchpriority="high"`) | `index.html`, `ro/index.html` (`#capital-allocation`, lazy); `capital-management.html`, `ro/capital-management.html` | `index.html`, `ro/index.html` (`#industries`, lazy); `business-models.html`, `ro/business-models.html` |

PHOTO 03 carries a caption on the homepage stating that the building is one kind of asset
among several (shelf, warehouse and receivables, channel and order). The image is a symbol
of physical economic scale, not a claim that FINMENTOR serves real estate only.

## Brand mark (canonical, added 2026-09-22)

Source and rules: `images/brand/README_FINMENTOR_BRAND_ASSETS.md`. The wordmark is never set in
HTML text or a substitute font, never recoloured with CSS filters, and always sized by height
with `width: auto`.

| File | Dimensions | Origin | Used on |
|---|---|---|---|
| `images/brand/FINMENTOR-master-reference.png` | 1254 × 1254, opaque | original project reference, recovered from the owner's library | canonical visual reference only; not served by any page |
| `images/brand/finmentor-wordmark-on-dark.png` | 915 × 185, transparent | derived from the master, geometry unchanged (silver `fin`, gold `mentor`) | intro wordmark (homepage RU/RO, rendered 44–88px high) |
| `images/brand/finmentor-wordmark-on-light.png` | 915 × 185, transparent | derived from the master, geometry unchanged (`fin` in FINMENTOR navy, `mentor` gold) | master of the on-light web derivative |
| `images/brand/finmentor-wordmark-on-dark-h108.png` | 534 × 108 | web derivative of the on-dark wordmark: proportional downscale (Lanczos), lossless PNG | header over the hero (homepage), footer (86 pages), legacy dark bars (doc-bar, legal-bar, questionnaire bar), language gate |
| `images/brand/finmentor-wordmark-on-light-h108.png` | 534 × 108 | web derivative of the on-light wordmark: proportional downscale (Lanczos), lossless PNG | light header states (scrolled, solid hub and reading pages, drawer open) and the legacy drawer |
| `images/brand/finmentor-lockup-on-dark.png` | 940 × 915, transparent | derived from the master (emblem + wordmark + tagline) | not used: no surface currently needs the full lockup |
| `images/brand/finmentor-lockup-on-light.png` | 940 × 915, transparent | derived from the master, navy for the silver parts | not used |

The web derivatives are 108px high: 3.5× the 31px mobile header render and 3.7× the 29px desktop
render, so the mark stays sharp at DPR 2 and DPR 3. The header carries both variants;
CSS shows the one that matches the bar (no filters, no recolouring).

## Earlier assets kept in the repository

| File | Dimensions | Status |
|---|---|---|
| `images/editorial/hero-capital.png` | 1536 × 1024 | Earlier hero photograph (integrated in `fb661dd`), superseded by `hero-capital-final.png` on 2026-09-21. Project-specific AI-generated asset. Not referenced by any page. |
| `images/editorial/hero-capital.svg`, `capital-decision.svg`, `real-assets.svg` | vector | Placeholder compositions from the art-direction stage; drawn in the project, not photographs. Kept as rollback placeholders (named in HTML comments only; no page loads them). |

## Rendered size (sharpness record, 2026-09-22)

| Asset | Viewport | Rendered box (CSS px) | Scale vs master at DPR 1 |
|---|---|---|---|
| PHOTO 01 | 1440 × 900 | 1425 × 900 | 0.91 |
| PHOTO 01 | 1728 × 1117 | 1713 × 1117 | 1.13 — WATCH |
| PHOTO 02 | 1440 × 900 | 818 × 915 | 0.92 |
| PHOTO 02 | 1728 × 1117 | 983 × 1098 | 1.11 — WATCH |
| PHOTO 03 | 1440 × 900 | 457 × 742 | 0.53 |

On DPR 2 screens every desktop render above is below native density; PHOTO 01 and 02 are
the softest (~1.8–2.2× at 1440–1728). A higher-resolution master of the same image
(≥ 2400 px wide) removes the WATCH with no CSS change.
