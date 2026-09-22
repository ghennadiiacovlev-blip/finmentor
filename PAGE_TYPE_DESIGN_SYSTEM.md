# FINMENTOR — Page-type design system

How every FINMENTOR page is composed. This document defines the page types (families), the scene grammar every page follows, and the primitives that implement them. Implementation: `editorial.css` (sections 0–23), opt-in, loaded after `style.css`; `main.js` (`initFx`, `initReveal`). Type tokens: [FINMENTOR_TYPE_SCALE.md](FINMENTOR_TYPE_SCALE.md). Reference translation: [YELLOWTREE_TO_FINMENTOR_PATTERN_MAP.md](YELLOWTREE_TO_FINMENTOR_PATTERN_MAP.md). Per-page application: [PAGE_BY_PAGE_ACCEPTANCE.md](PAGE_BY_PAGE_ACCEPTANCE.md).

## 1. The scene grammar (every page)

Every page is defined in five steps, recorded per URL in the acceptance document:

1. **BACKGROUND SCENE** — a stage: a photograph, the navy thesis field (hairline architectural drawing, no stock image), or a stone light field. `.fx-stage` is `position: sticky; top: 0` **inside its own `.fx-scene`**, so the pin never outlives the sheet that covers it.
2. **FOREGROUND SCENE** — a sheet (`.fx-sheet`) later in the DOM that paints over the stage: ivory, paper, stone or navy, with a top radius equal to its overlap (`--fx-r`, 28–52px, smaller on phones). This is the mechanism measured on the reference, not a negative margin on a card.
3. **OVERLAP BEHAVIOUR** — the sheet rises over the pinned stage by one radius. A stage taller than the viewport would hide its own lower part while pinned, so `initFx` marks it `.is-tall` and it scrolls normally. Pages with forms never pin over the form.
4. **REVEAL ORDER** — time-based entrances that run once when the element enters the viewport (IntersectionObserver). Families: `rise`, `glide`, `unveil`, `line` (`data-fx`). The hidden state exists only under `html.m-js`, so without JavaScript the page is complete. No scroll-driven animation and no scroll-jacking.
5. **MOBILE FALLBACK** — same order and same scenes in one column; stages stay pinned only while they fit; decks pin only when every card fits (`--pin`); panels bleed to 8px from the gutter.

Reduced motion and print: nothing is hidden and nothing is pinned (section 12).

## 2. Headline rule

Mixed weight: light (300) + bold (700–800) for one concept, and at most one restrained gold emphasis (`.fx-gold`). The words are always the page's own; builders compare the plain text before and after and refuse any change. Sans-serif only (typography lock: Manrope; JetBrains Mono for indices and figures). Uppercase only for eyebrows.

## 3. Page types

| Family | Pages | Background | Foreground | Signature moments |
|---|---|---|---|---|
| **Home** | index | photo hero with the glass brand card (transparent header → navy on scroll) | ivory chaos scene with a rounded cap; alternating bands | nine scenes, mixed-weight scene titles, capital scene on a photo field, contact scene |
| **Hub · flagship** | capital-management | photo stage | ivory sheet, then a navy CFO-logic sheet | capital cycle on a spine, panel-within-panel map, principle deck, value-rule gold panel |
| **Hub** | owner, business-models, budgeting-forecasting | thesis stage or photo stage | ivory / navy / stone sheets each rising over the previous band | tonal principle panels, mirrored model scenes, seven-stage plan → decision deck |
| **Hub · founder-led** | about | thesis stage | ivory thesis sheet, founder split | real founder portrait, no invented team or metrics |
| **Library index** | materials | stone library cover with a numbered index | navy map sheet, then ivory library sheet | chain instrument panel, sticky section nav, index cards |
| **Offer** | cfo-consultation, financial-health-check, business-control-system, monthly-cfo-support | thesis cover with the terms as one strip | ivory reading sheet | pricing as facts, fit, deliverables, FAQ |
| **Solution** | real-estate, client-base, retail-margin-engine, ai-agent-economics | photo, split or thesis cover | ivory reading sheet | heading rail + text column for prose; wider column for exhibits |
| **Article** | the 17 article pages (cases + 16 long-form articles) | thesis cover (photo for capital-allocation-value) | ivory reading sheet | numbered sections, stone mechanism field, navy formulas, premium tables, owner's takeaway panel, «what the owner sees» navy field |
| **Knowledge** | cash-flow, kaznacheystvo, methodology, templates … | light stone cover | ivory reading sheet | callouts, checklists, formulas and tables as designed moments |
| **Tool** | working-capital-scan | light short cover | ivory sheet | the scan itself (behaviour unchanged) |
| **Product UX** | questionnaire (Financial X-Ray) | dark entry (not pinned) | light working sheet | paper fields, quick-diagnostic panel, navy result moment; form controls hash-locked |
| **Legal** | privacy, terms | navy legal field | one reading column | restrained: eyebrow, H1, date, numbered sections |
| **Closing / utility** | thank-you, 404 | thesis field | text and actions | the next step as the primary action |

Every page ends on the footer closing statement (`.fx-closing`): «Видеть **деньги**. Понимать **прибыль**. Управлять _капиталом_.», and in RO the same line with the same emphasis.

## 4. Covers of the reading system (`.rd-cover--*`)

| Cover | Use | Composition |
|---|---|---|
| `thesis` | articles | navy field, crumbs, eyebrow, mixed-weight H1 (22ch), lead, context under a hairline |
| `light` | knowledge base, methodology, templates, tool | stone field, navy type, gold eyebrow |
| `split` | solutions with a chain or key thesis | headline left (7fr), thesis panel right (5fr); stacked below 860px |
| `offer` | paid formats | thesis field + the commercial terms as a pill strip of facts |
| `photo` | real-estate (real-assets), capital-allocation-value (capital-decision) | photograph + directional scrim |
| `short` (modifier) | titles of ≤ 4 words | display XL, 14ch |

## 5. Designed moments inside the reading sheet

Marked from each article's **own headings**, never by position:

- conclusion headings (Управленческий вывод / Concluzia managerială …) → `.rd-takeaway`: a gold-ruled paper panel with larger text;
- «Что должен увидеть собственник» / «Ce trebuie să vadă proprietarul» → `.rd-owner`: a navy field;
- `.article-section--financial` → a stone field that leaves the column;
- formulas (`.art-formula`, `.fcf-formula`, `.cb-example .f`) → navy calculation fields in mono;
- tables (every table family) → one premium treatment, horizontally scrollable on phones, wide tables leave the column on desktop;
- callouts and checklists → stone and navy panels.

## 6. Primitives (editorial.css)

| Primitive | Section | Role |
|---|---|---|
| `--t-*` type roles | 1 | display-xl, display-l, h1–h3, lead, body-l, body, small, eyebrow, meta, index, figure |
| `.fx-scene` / `.fx-stage` / `.fx-sheet` | 2 | the stage-and-sheet mechanism (`--thesis`, `--light`, `--compact`, `.is-tall`; `--paper`, `--stone`, `--navy`, `--lift`) |
| `.fx-hold` | 3 | photo hold: a sticky media layer inside an oversized runway |
| `.fx-panel`, `.fx-field`, `.fx-split`, `.fx-mosaic` | 4 | tonal panels, fields, splits, mosaics |
| `.fx-deck` | 5 | stacked cards; pinned only when every card fits |
| `.fx-sequence` | 6 | stages on a drawn spine |
| `.fx-rows` | 7 | indexed editorial rows instead of card grids |
| `.fx-head` | 8 | eyebrow · statement · lead |
| `.fx-closing`, `.fx-cta` | 9 | closing statement and CTA scene |
| `.fx-callout`, `.fx-takeaway`, `.fx-calc`, `.fx-table`, `.fx-related` | 10 | article system |
| `data-fx` motion | 11 | rise, glide, unveil, line |
| reduced motion / print | 12 | the complete page, nothing pinned |

## 7. Contracts the design system respects

- One canonical wordmark (`images/brand/finmentor-wordmark-on-dark*.png`), never recoloured; the on-light variant is not used in the UI.
- Internal pages: solid navy header; homepage: transparent over the hero, navy once scrolled; dark mobile drawer.
- Body markers asserted by QA stay exact (for example `materials-page fm-shell`), so page scopes use inner classes.
- Machine-control signatures of the questionnaire are hash-locked; design changes stop at the form boundary.
- `app-premium/` is byte-sealed and is not touched.
