# YELLOWTREE → FINMENTOR — PATTERN MAP

Each useful reference mechanism (measured in `YELLOWTREE_VISUAL_REVERSE_ENGINEERING.md`)
translated into a clean FINMENTOR primitive. Nothing is copied: no vendor markup, wording,
imagery, icons, colours or exact geometry. FINMENTOR keeps:
- its brand: the canonical silver + gold wordmark, deep navy, warm ivory, stone and restrained gold;
- its font: Manrope;
- its content.

All primitives live in `editorial.css` / `main.js`, and pages compose them differently. The
per-page choice (background scene → foreground scene → overlap → reveal order → mobile
fallback) is recorded in `SITE_PAGE_INVENTORY.md` and accepted in `PAGE_BY_PAGE_ACCEPTANCE.md`.

---

## P1. Photo stage + editorial sheet ("the sheet closes the photo")

**Reference principle.** A sticky hero section stays pinned while the next section, later in
DOM order, rises over it. The next section's rounded top edge is a separate painted cap
(radius 40px at 1440 → 12–24px on phones). This is plain CSS: no JS, no negative margin.

**FINMENTOR implementation.**
```html
<section class="fx-stage fx-stage--photo">      <!-- position: sticky; top: 0; height: min(86svh, 860px) -->
  <picture class="fx-stage__media">…</picture>  <!-- cover; FINMENTOR photography only -->
  <div class="fx-stage__content">…</div>       <!-- mixed-weight statement -->
</section>
<section class="fx-sheet">                      <!-- position: relative; z-index: 1;
                                                     border-radius: var(--fx-r) var(--fx-r) 0 0;
                                                     margin-top: calc(var(--fx-r) * -1); -->
  …
</section>
```

The sheet is one element with its own rounded top, not a separate cap. That is simpler and
equivalent: the reference needed a cap only because its builder cannot round a section.

The `margin-top` overlap equals the radius (restrained: 32–56px desktop, 24–32px mobile), so the
corners sit *over* the photo. The pinned stage ends where its parent ends. FINMENTOR wraps
`stage + first sheet` in a `.fx-scene` block so the pin never leaks into later content.

**Where.**
- Photo-led heroes: Home (PHOTO 01), Capital Management (PHOTO 02), Business Models (PHOTO 03).
- Dark-thesis heroes (a navy field instead of a photo) on Owner, About, Contact and the flagship
  solution pages.
- Selected article covers.

**Mobile.**
- The stage stays pinned only where it is a photo, and only for its own height.
- On heroes taller than the viewport, or on reading pages, the stage becomes a normal band and
  only the rounded sheet overlap remains (`@media (max-width: 860px)` sets `position: relative`).
- Radius 24px.

**Fallback.**
- `prefers-reduced-motion`: keep the overlap, drop the pin (`position: relative`). Nothing moves.
- No-JS: identical (pure CSS).
- Printing: stage relative, no overlap.
- Performance: sticky is compositor-cheap; no scroll listeners.

## P2. Stacked sheets (deck of cards)

**Reference principle.** Consecutive sticky sections; each later one covers the one before.

**FINMENTOR implementation.**
- `.fx-deck > .fx-card` — each card is `position: sticky; top: calc(var(--header-h) + 16px)`
  with an increasing `top` offset per card (`+ n × 12px`), so a thin edge of each covered card
  stays visible like a stack.
- Radius on top corners.
- Heights limited to ≤ 80svh so a card never traps the reader.

**Where.**
- Capital Management: the capital sequence (source → allocation → return → risk → release →
  reallocation).
- Budgeting: the plan → cash → P&L → scenarios → plan/fact → rolling forecast chain.
- Business Models: the model scenes.

These are sequences where "one stage replaces the previous" *is* the argument.

**Mobile.** Pinning is disabled below 860px; cards stack with a 12px overlap and rounded tops. This
keeps the deck look without trapping touch scroll.

**Fallback.** Reduced motion: no pin. No-JS: identical. The content order is the reading order.

## P3. Photo hold (chapter break)

**Reference principle.** Full-bleed media sticky inside an oversized container that starts one
viewport above its section. The photo is uncovered by the leaving section, holds, then is
covered by the next.

**FINMENTOR implementation.**
```html
<section class="fx-hold">                  <!-- height: 100svh + statement; overflow: clip -->
  <div class="fx-hold__media">…</div>     <!-- position: sticky; top: 0; height: 100svh -->
  <div class="fx-hold__statement">…</div> <!-- centred, over a controlled scrim -->
</section>
```

- FINMENTOR keeps the container equal to its own section, which is simpler.
- The "uncover" feeling comes from the *previous* section being a rounded-bottom sheet
  (`.fx-sheet--end`), so its bottom corners lift off the photo.

**Where.** One hold per page at most, and only where a real photograph exists:
- Home (PHOTO 02 statement);
- Capital Management (PHOTO 02);
- Business Models (PHOTO 03).

**Mobile.** 70svh band, not pinned; statement below 24px.

**Fallback.** Reduced motion: normal band. The image is lazy-loaded (not the LCP).

## P4. Sticky side label inside a large field

**Reference principle.** Inside a large panel, the label column sticks under the header while
the content column scrolls.

**FINMENTOR implementation.**
- `.fx-field` is a large navy or stone panel with radius 40px. `.fx-field__label` is sticky at
  `top: calc(var(--header-h) + 24px)` and `.fx-field__body` flows.
- The index, eyebrow and short thesis stay visible while the reader works through the columns.

**Where.**
- Owner: the three control contours.
- Capital Management: allocation architecture.
- Long articles: the running section index (`.article-index`) on desktop.

**Mobile.** Label becomes a normal heading above the body.

**Fallback.** Sticky is progressive: without it the label simply scrolls.

## P5. Large principle panels (panel within a panel)

**Reference principle.** Colour used as a whole panel, radius 40–46px, sometimes holding an
inset panel. Colour is never used as a stripe.

**FINMENTOR implementation.**
- `.fx-panel` has four tones:
  - `--navy`: deep navy, light type;
  - `--stone`: warm stone, navy type;
  - `--gold`: restrained gold field with navy type, *one per page at most*;
  - `--paper`: white.
- `.fx-panel__inset` is a slightly different tone inside a navy panel (for example navy-800
  inside navy-900).
- Icons appear only when they carry meaning: monoline, gold, 24px.

**Where.**
- Owner (Money / Result / Capital).
- Capital (the objective field).
- Solutions (engagement scope).
- Offers (deliverables).

**Mobile.** Full-width panels, radius 24px, 20px padding; triplets stack. Carousels are not used
for primary content.

**Fallback.** Static; entrance by opacity only under reduced motion (none).

## P6. Split photo / text scene

**Reference principle.** Two equal halves, one a colour panel with the argument and the other a
photograph. Only the outer top corners are rounded. The next split reverses the order.

**FINMENTOR implementation.**
- `.fx-split` uses `--reverse` and `--gold|--navy|--paper` for the text half.
- The photo half uses the same `<picture>` system (AVIF/WebP/JPG, lazy).
- Without an approved photo, the second half is a **financial figure** (a chart-like sequence,
  a formula field or a large number), not a stock photo.

**Where.** Business Models (each model), Capital Management, About (approach vs founder).

**Mobile.** Stacked; text first when the argument leads, photo first when the image leads. The
order is chosen per page.

**Fallback.** Static.

## P7. Mixed-weight statements

**Reference principle.** Weight contrast inside one statement: the light base carries the
sentence and bold carries the nouns of meaning. At most one phrase is in the brand colour.

**FINMENTOR implementation.**
- `.fx-statement` sets Manrope 300 as the base; `<strong>` is 700–800, `<em class="fx-gold">`
  is the gold phrase.
- A real light weight (300), not synthetic bold.
- Rules:
  - emphasis marks *meaning* (money, profit, capital, the owner's decision), never decoration;
  - no more than 3 strong phrases per statement;
  - one gold phrase at most;
  - no all-caps paragraphs (FINMENTOR uses sentence case; uppercase only for small eyebrows).

**Where.** Page covers and chapter statements on Home, Owner, Capital, Business Models, About,
Materials, Contact, solution pages and selected article covers. Not in body text.

**Mobile.** Same markup, smaller scale (see `FINMENTOR_TYPE_SCALE.md`), manual line breaks
removed.

**Fallback.** Semantic `<strong>` and `<em>` remain meaningful without CSS.

## P8. Entrance motion

**Reference principle.** Time-based, triggered once on entry, 1200ms, sine/cubic in-out, rise
≈ 50px or a lateral glide. Only whole blocks animate.

**FINMENTOR implementation.**
- The existing reveal engine (`initReveal`, IntersectionObserver, `html.m-js` gate) is extended
  site-wide with `data-fx` families:
  - `rise`: statement and blocks, opacity + 24px, 820ms;
  - `glide`: panels, translateX 32px + opacity, 900ms;
  - `unveil`: image tiles, clip-path inset 8% → 0 plus scale 1.025 → 1, 1150ms;
  - `line`: rules and sequence spines, scaleX.
- FINMENTOR is quieter than the reference: shorter travel, no large lateral glides, no spin.
- Easing `cubic-bezier(.2,.7,.12,1)`; runs once.

**Where.** Hero content, statements, panels, split halves, sequence stages, image tiles.
**Never:** paragraphs, table rows, list items, buttons, small labels.

**Mobile.** Durations × 0.75, travel × 0.6.

**Fallback.**
- `prefers-reduced-motion` and no-JS: everything is visible on first paint, because the hidden
  state exists only under `html.m-js`.
- LCP elements start at opacity 0.01, not 0.

## P9. Closing statement (footer signature)

**Reference principle.** A large rounded statement bar opens the footer, before the navigation
columns.

**FINMENTOR implementation.**
- `.fx-closing` sits on navy: the three-line brand statement «Видеть деньги. Понимать прибыль.
  Управлять капиталом.» (RO: «Să vedeți banii. Să înțelegeți profitul. Să gestionați
  capitalul.») in mixed weight, with the canonical wordmark and a hairline gold rule.
- It is not a pill: it is a full-width band inside the footer's top edge, with a large top radius
  where the footer meets a light page (the footer itself becomes the last sheet).

**Where.** Every page (in the shared footer).

**Mobile.** Statement at 28px, three lines, wordmark above.

**Fallback.** Static text.

## P10. Mosaic of presence / facts

**Reference principle.** A gap-less grid of equal tiles mixing colour tiles, photo tiles and a
logo tile, read as one block.

**FINMENTOR implementation.** `.fx-mosaic`, used sparingly:
- Contact: channels (Telegram / e-mail / LinkedIn / meeting in Chișinău), plus a wordmark tile;
- About: facts about the practice. **No invented numbers:** only facts that already exist in
  the content (15+ years of corporate finance, Big4 / IFRS foundation).

**Mobile.** Single column, alternating tones.

**Fallback.** Static.

---

## Performance and accessibility rules (all primitives)

- No new JS library; the only additions are CSS plus about 60 lines of JS: reveal families and
  one IntersectionObserver.
- No scroll listeners or scroll-jacking; sticky positioning does the depth.
- Images: AVIF/WebP/JPG `<picture>`; lazy except the LCP; no upscaling.
- `prefers-reduced-motion`: pins off, entrances off, everything visible.
- Headings stay semantic (one H1; the statement markup keeps `<strong>`/`<em>`). Contrast is
  measured on the rendered composite, AA at minimum.
