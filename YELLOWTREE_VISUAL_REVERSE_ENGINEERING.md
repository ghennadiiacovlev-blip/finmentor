# YELLOWTREE — VISUAL & TECHNICAL REVERSE ENGINEERING

Reference study for the FINMENTOR site-wide rebuild. **Study, not source:** nothing here is copied
into FINMENTOR — no markup, wording, images, icons, colours or exact geometry. What is
recorded is *why* the reference feels composed, and *how* its depth and motion are built, so the
mechanics can be re-implemented cleanly for FINMENTOR (see `YELLOWTREE_TO_FINMENTOR_PATTERN_MAP.md`).

## Method

- **Live site, real browser.** Chrome (headless, CDP) on `https://www.yellowtree.com/`, 2026-09-22.
- **Pages:** `/`, `/about-us`, `/asset-investments`, `/sustainability`, `/team`, `/careers`, `/contact`.
- **Widths:** 1440×900, 1024×768, 768×1024 and 390×844 (mobile UA, touch viewport).
- **Scroll:** every page was scrolled top → bottom with real wheel input in steps of ½ viewport
  (desktop) or ~0.7 viewport (mobile). Each step took a screenshot and recorded:
  - fixed and sticky layers;
  - the stacking order at probe points (`elementsFromPoint`);
  - every visible image's natural vs box size, object-fit/position, loading mode, its offset
    inside its section, and its ancestor transform/clip/opacity chain;
  - every running Web Animation / CSS transition with timing and keyframes;
  - CDP `Animation.animationStarted` events.
- **Once per page:**
  - computed typography;
  - the box model of every top-level `section`/`header`/`footer` and their painted, rounded,
    sticky or negative-margin descendants;
  - text-column bounds;
  - `@font-face` sources, with the font files downloaded and their `name`/`fvar` tables read.
- **Mechanism probe** (1440 and 390):
  - every rounded painted layer;
  - every sticky element with its containing block (the "runway");
  - any `animation-timeline` / `view-timeline` declarations;
  - elements whose transform/opacity/clip or scroll rate changes, sampled every ⅙ viewport.
- **Hold test:** reload, jump to where an element enters, then sample it at 50 / 400 / 1700 / 3200 ms
  **without scrolling**. This separates time-based entrances from scroll-linked effects.
- **Font render test:** the reference's heading font file, registered exactly as the site registers
  it, rendered at weight 400 / 700 and at explicit `wght` values, and compared by ink coverage.

Raw data: the study JSON and 350+ step screenshots are kept in the session scratchpad and are
not part of the repository.

---

## TECHNICAL IMPLEMENTATION (how it actually works)

### T1. The "sheet closes the photo" transition — measured

This is the mechanic the owner singled out. **It is not a negative margin and not a JS scroll
effect.** It is three plain CSS facts combined:

1. **The hero `<section>` itself is `position: sticky; top: 0`**, a direct child of `<main>`:
   - height 765px at 1440×900 (85% of the viewport), 544 at 1024, 666 at 768, 670 at 390;
   - it has no z-index (`auto`);
   - its containing block is the whole `<main>`, so it stays pinned for as long as the page is
     longer than it — in practice until later content has covered it completely.
2. **The next section is later in DOM order, so it paints above** the pinned hero (same stacking
   context, both `z-index: auto`, the later sibling wins). It has a *transparent* section
   background.
3. **The rounded edge is a separate painted "cap":** an absolutely positioned white `DIV` at the
   very top of the next section:
   - 1440 × 31px, `border-radius: 40px 40px 0 0`, background `rgb(254,254,254)`;
   - below it, the section's white content blocks continue edge to edge.

   Visually a white sheet with rounded top corners rises over a photograph that does not move.

Measured on Home, About, Asset Investments, Sustainability, Careers, Contact and Team (hero)
at 1440. **Mobile differences at 390:**

- The hero stays sticky on Home, Asset Investments, Sustainability, Careers and Team.
- About and Contact switch to a normal relative hero (no pin). Contact at 390 also drops the
  rounded cap, so its mobile hero simply ends and the content follows.
- The cap keeps its `40px 40px 0 0` radius. It is measured at 390 on Asset Investments
  (390×31), so the rounded edge is proportionally *larger* on a phone.

The rest of the content still rises over the photo band.

### T2. Stacked sheets (a sequence of sticky sections)

On Asset Investments the first **two** sections are both `sticky; top: 0` (765px hero, then a
454px section). Each later section covers the one before, so the top of the page reads as a stack
of sheets rather than a scroll.

The split scenes near the end use the same rule:

- each split section (674px) is sticky, and **both halves inside it (662×616) are sticky too**;
- only the outer top corners are rounded (`40px 0 0 0` left, `0 40px 0 0` right);
- the next split section (589px) is again sticky and scrolls over the previous one.

The result is a deck of cards sliding over each other, with no JavaScript.

### T3. Photo hold ("background hold") — a sticky image in an oversized container

Used on Home, About, Asset Investments, Sustainability, Team and Careers for full-bleed photo chapter
breaks:

- The section's background-media container is much taller than the section: 2434px vs 633px
  at 1440. It starts about one viewport (900px) *above* its section.
- Inside it, a `wow-image` / `wix-video` layer is `position: sticky; top: 0; height: 100vh`
  (900px). Runway = 2434 − 900 = **1534px**.
- Effect: the previous opaque section scrolls up and *uncovers* a photograph that is already in
  place. The photo holds still while a centred statement sits over it, then the next opaque section
  scrolls over and covers it again. The photo never visibly moves, and both edges of the chapter
  are clean content edges.
- A short dark overlay (`opacity` ~0.45 on the media layer) keeps white text readable.

### T4. Sticky side label inside a large panel

In the Investment Objective field (Asset Investments) the left label column
("Financial Objectives" / "Non-Financial Objectives") is `sticky; top: 90px`, just under the fixed
header, inside a panel only ~317–347px tall. It holds for 200–280px while the right-hand columns
pass. It is a small, precise use of sticky, not a page-wide pin.

### T5. Entrance motion — time-based, triggered once on entry

**No scroll-driven animation:** no `animation-timeline`, `view-timeline` or `scroll-timeline`
rules exist. The hold test shows entrances keep progressing while the page is held still, so they
are **time-based animations started when the element enters the viewport**, and they run once
(`data-motion-enter="done"`).

| Name (Wix) | Keyframes | Duration | Delay | Easing | Used on |
|---|---|---|---|---|---|
| `motion-floatIn` | opacity 0 → 1, translateY ≈ +50–60px → 0 | 1200ms | ~0 | `cubic-bezier(.445,.05,.55,.95)` (sine in-out) | headlines, statements, card groups |
| `motion-glideIn` | translateX ≈ −430px (desktop) / −340px (390) → 0, opacity stays 1 | 1200ms | ~0 | `cubic-bezier(.645,.045,.355,1)` (cubic in-out) | panels and cards sliding in from the side |
| `motion-fadeIn` | opacity 0 → 1 | short | 0 | ease-in | small elements |
| `motion-spinIn` | scale 0 → 1, rotate −90° → 0 | 1500ms | ~0 | linear | the brand tree icon only |

The one scroll-linked effect is the fixed header's inner background layer, which fades from
1 → 0 between 300 and 600px of scroll.

### T6. Typography mechanics — measured, including the font files

- **Heading family:** one uploaded file, internally *"Montserrat Thin"*. It is a **variable
  Montserrat (`wght` 100–900, default 100)**, registered with `@font-face` **without a weight
  descriptor**. The render test shows what that does:
  - explicit `font-variation-settings: "wght" 100/300/400/700` all render identically, so the
    axis is not applied and the default instance is used;
  - at `font-weight: 400` the words render as that light default instance (ink 1239);
  - at `font-weight: 700` the browser **synthesises bold** from it (ink 2383, ≈ 1.9×).

  The famous thin/bold headline contrast is therefore *one light cut plus synthetic bold*.
  Chrome reports the two as `MontserratRoman` and `MontserratRoman-Bold`.
- **Body family:** an uploaded *Source Sans Pro Regular* (400 only), 16px, line-height 1.6,
  letter-spacing −0.48px (−0.03em).
- **Scale** (headline sizes are exactly **5vw** on desktop and tablet):

| Role | 1440 | 1024 | 768 | 390 | Weight | Line-height | Case |
|---|---|---|---|---|---|---|---|
| Hero statement (H2/H1) | 72px | 51.2px | 38.4px | 35–40px | 400 + 700 mixed | 1.4 | sentence |
| Chapter statement (H4, uppercase) | 27.7px | 20–23px | 20–23px | 16–20px | 400 + 700 mixed, brand-colour words | 1.4 | UPPER |
| Photo-scene statement (H3/H6) | 35.4px | 28px | 25–28px | 22–24px | 700, or 400 italic | 1.4 | sentence |
| Section label (H5) | 28px | ~20px | ~18px | 18px | 700 | 1.4 | Title |
| Card title (H3/H6) | 20–28px | 18–22px | — | 18–20px | 700 | 1.4 | Title / UPPER |
| Body (P) | 16px | 16px | 16px | 14–16px | 400 | 1.6 | sentence |
| Buttons | 14px | 14px | 14px | 14px | 400–700 | — | sentence |

- **Letter-spacing:** normal on headings; −0.03em on some body/labels. Uppercase is used
  only for the chapter statements and card titles, never for body.
- **Mixed-weight rule (observed in every page's statement):** weight contrast marks the *nouns
  that carry meaning*; brand colour marks at most one phrase (the company name or the thesis).
  For example, on the home chapter statement:
  `700 GLOBAL STRATEGY… (brand colour) / 400 OUR TEAM'S / 700 SUCCESS / 400 STEMS FROM OUR /
  700 COLLECTIVE EXPERTISE / 400 IN ASSET / 700 MANAGEMENT`.
- **Italic** is reserved for the photo-scene statements, the footer statement and panel
  sub-labels ("Financial Objectives").

### T7. Layout measurements

- **Outer gutter:** 58px at 1440 (panels and the footer bar start at x = 58 and are 1325px wide);
  ~28px at 1024 in panels; 12–28px at 390.
- **Editorial statement column:** inset about 250px at 1440 (a ~940px measure), about 180px at
  1024 and 88px at 768; full width minus ~25px at 390.
- **Section rhythm:** section label → statement → body → module. There are about 70–110px
  between the statement and its module at 1440, and about 40–60px at 390.
- **Panels:**
  - large panels: radius 40–46px at 1440 and about 42px at 390. The large radius survives on
    phones, where it is the main sign of the system;
  - small cards (About goals, stat tiles): 12–16px at every width;
  - some panels step to 32px at 1024 and 24px at 768;
  - card padding about 24–32px;
  - gaps between cards 16–20px.
- **Hero heights:** 765px at 1440 (85% vh), with the rounded cap overlapping the photo by its
  own 31px band as the next section rises.
- **Colour fields:**
  - brand yellow `rgb(246,201,14)`;
  - charcoal `rgb(48,56,65)` / `rgb(58,71,80)`;
  - greys `rgb(224,224,224)`, `rgb(238,238,238)`;
  - white `rgb(254,254,254)`.

  Yellow is used as a *whole panel*, never as a thin accent.

### T8. Image behaviour

- **Full-bleed:**
  - all heroes and photo holds are full width × 100vh media;
  - `object-fit: cover`, `object-position: 50% 50%`, no scale or parallax on the image itself;
  - the hero on Home is an MP4 (1920×1080) with a still fallback; sources are 1440×900 at
    1440 (served at the box size).
- **Contained tiles:**
  - the image tiles inside mosaics (Home philosophy, Contact offices) and the split scenes
    (Asset Investments) are `cover`, clipped by the tile's radius, and are the same size as
    their neighbouring colour panels;
  - photographs are treated as panels of the grid.
- **Loading:** hero media eager; everything else `loading="lazy"`.
- **Mobile crop:** the same images re-cropped by `cover` to portrait bands (390×670 hero,
  ~390×300 tiles).
- **No clip-path or mask reveals** were found on images. The only image motion is the pin (T1)
  and the hold (T3).

### T9. DOM patterns (vendor markup translated to minimal structure)

```
photo stage:      <section sticky top:0 height:85vh> <media cover> <statement> </section>
editorial sheet:  <section> <cap absolute top:0 height:~31px radius:40 40 0 0 white/> <content/> </section>
photo hold:       <section> <bg absolute top:-100vh bottom:0> <media sticky top:0 height:100vh/> </bg> <statement centred/> </section>
split scene:      <section sticky top:0> <half sticky, radius outer-top only, colour panel/> <half sticky, photo/> </section>
strategic panel:  <div radius:45 charcoal> <label sticky top:90/> <div radius:45 charcoal-2 inset> <3 columns/> </div> </div>
footer statement: <div radius:45 grey height:141> <icon/> <italic statement/> </div> + 3 columns
```

### T10. Responsive behaviour

| | 1440 | 1024 | 768 | 390 |
|---|---|---|---|---|
| Hero pin | sticky | sticky | sticky | sticky on 5 of 7 pages (not About, Contact) |
| Sheet cap radius | 40 | 32–40 | 24–40 | 40 (measured) |
| Large panel radius | 40–46 | 32–40 | 24–40 | ~42 |
| Card rows of 3 | row | row | row | **horizontal carousel with a "SLIDE →" cue** (Sustainability, Asset Investments, Home) |
| Split scenes | side by side, sticky | side by side | stacked, sticky pairs | stacked; panel then photo, alternating |
| Mosaic (Contact offices) | 3×2 grid, no gaps | same | 2 columns | single column, alternating dark/photo/yellow/grey |
| Photo holds | 100vh sticky | same | same | same (100vh, 844px) |
| Footer | rounded grey statement bar + 3 columns | same | same | rounded light logo card over a charcoal menu panel |
| Entrance glide distance | −430px | — | — | −340px |

---

## PAGE-BY-PAGE

### HOME
- **A. Structure** (10 blocks, 4726px):
  1. photo hero (sticky, video, translucent white rounded card 709×408 with the headline);
  2. rounded sheet with the mixed-weight trust statement and three short paragraphs;
  3. "Our Philosophy" mosaic in two rows: charcoal / yellow / grey tiles, then photo / charcoal /
     grey-with-icon tiles;
  4. "Our Strategic Principles" statement with a pill button;
  5. photo hold (sticky video) with the centred logo and an italic statement;
  6. "Our Expertise" statement;
  7. footer statement bar.

  The rhythm is light-dominant: white sheets between one photo hero, one photo hold, and colour
  only inside the mosaic.
- **B. Typography:**
  - H1 45px 700 (the only true H1, inside the hero card);
  - chapter statements 27.7–33.8px uppercase, mixed 400/700 with one yellow phrase;
  - photo statement 35.4px 700 plus italic body.
- **C. Spacing:**
  - hero 900px (sticky);
  - the mosaic tiles are 430×347 with 17px gaps, row 2 uses 679/455/272 widths;
  - outer gutter 58px.
- **D. Shapes:**
  - the hero card is 45px radius, white at 0.76 alpha;
  - the tiles use radius 40, with the outer tiles rounded only on their outer side
    (`0 40 40 0`, `45 0 0 45`), so the row reads as one shape.
- **E. Images:**
  - hero MP4 `cover`, still fallback;
  - the photo tile (679×343) `cover`, lazy;
  - photo hold 1440×900 sticky, 1534px runway.
- **F. Choreography:**
  - the hero pins and the sheet rises (T1);
  - the statement floats in (1200ms);
  - mosaic tiles glide in from the side (1200ms);
  - the photo hold is uncovered by the leaving section and covered by the next (T3);
  - the footer statement bar arrives last.
- **G. Page-specific:** the only page where the hero headline sits *inside a card* over the
  video, and where colour is used as a mosaic.

### ABOUT US
- **A. Structure** (12 blocks, 4792px):
  1. full-bleed architecture hero with a large mixed-weight statement (brand-colour company name)
     directly on the photo;
  2. rounded sheet, "Our Goal": a statement plus 6 quiet white cards (16px radius, small yellow line
     icons);
  3. "In Numbers": charcoal field with four stat tiles (white, grey, yellow) and a map card;
  4. "Core Values": split yellow/grey background, six white cards with *one square corner* each,
     pointing at a large white brand graphic in the middle;
  5. photo hold with an italic statement and a pill CTA;
  6. footer.
- **B. Typography:**
  - hero 72px, 400/700 mixed, brand colour on the name;
  - numbers 35px 700;
  - card titles 18px 700;
  - body 13–16px.
- **C. Spacing:**
  - goal cards 409×278 in a 3×2 grid with 20px gaps;
  - core-value cards 284–376 × 206–277.
- **D. Shapes:** 16px cards (quiet), 45px value cards with one square corner (`0 45 45 45` and
  so on), a map card with radius 16.
- **E. Images:** the hero is full-bleed `cover`; the photo hold is sticky with a 1534px runway.
- **F. Choreography:**
  - hero pin + sheet;
  - the goal cards float up in a stagger (hold test: +49px → 0, 1200ms, all three triggered
    together);
  - the numbers panel keeps a sticky 295px block for 310px;
  - value cards appear around the graphic;
  - the photo hold closes the page before the footer.
- **G. Page-specific:** content *types* get different treatments — a statement for vision, quiet
  cards for goals, a dark data field for numbers, a colour split for values, a photo for belief.
  The page is a sequence of content types, not a sequence of identical blocks.

### ASSET INVESTMENTS
- **A. Structure** (14 blocks, 5913px):
  1. hero;
  2. sticky "Core Activities" sheet with statement and pill CTA;
  3. three large panels (charcoal / yellow / charcoal, 382×407, radius 45) with line icons;
  4. "Investment Objective":
     - a huge charcoal field (radius 45) holding a sticky side label and an inset charcoal panel
       with three columns;
     - repeated for Non-Financial Objectives;
  5. photo hold;
  6. "Property Acquisition" statement;
  7. two stacked split scenes:
     - a yellow panel with bullets beside a photo;
     - then a photo beside a white panel;
     - both over a full-width grey band that extends beyond the modules;
  8. footer.
- **B. Typography:**
  - hero 72px 700 (no thin words here);
  - panel titles 20px 700 uppercase;
  - sub-labels italic 22.5px;
  - column heads 20px in brand colour.
- **C. Spacing:**
  - panels 382×407 with 30px gaps;
  - the objective field ~1200px wide with 45px radius and an 817×254 inset;
  - split halves 662px each, meeting at the centre line.
- **D. Shapes:**
  - a large field containing a smaller field (a panel within a panel);
  - split halves rounded only at their outer top corner.
- **E. Images:** split photos `cover` inside the halves; `overflow: hidden` on the photo half.
- **F. Choreography:**
  - two stacked sticky sections at the top (T2);
  - panels glide in;
  - objective labels pin at `top: 90px` (T4);
  - the photo hold follows (T3);
  - the split scenes stack over each other (T2).
- **G. Page-specific:** the most architectural page. Colour fields are *containers of
  arguments*, and the split scenes behave like physical cards.

### SUSTAINABILITY
- **A. Structure** (11 blocks, 5329px):
  1. washed, low-contrast photo hero (light overlay) with a **dark** mixed-weight headline;
  2. rounded sheet with the ESG statement;
  3. three panels (charcoal / yellow / charcoal) with icons;
  4. photo hold ("Embrace Our Vision" plus pill);
  5. rounded sheet over the hold with "Our Code of Conduct": statement, italic lead, long bulleted
     policy text;
  6. "Compliance System": statement plus three panels;
  7. "Responsible Operations" statement;
  8. footer.
- **B. Typography:** hero 72px 400/700 in charcoal on the washed photo; long-form bullets at 13–14px
  with bold lead-ins.
- **D. Shapes:** the same 40–46px panels. The sheet after the photo hold is again rounded, so the
  sheet mechanic is also used *mid-page*, not only after the hero.
- **E. Images:** the hero is washed out by a light overlay to carry dark type; the photo hold is a
  facade texture.
- **F. Choreography:** hero pin + sheet; panels glide; photo hold uncovered, then covered by a
  rounded sheet; long text is not animated.
- **G. Page-specific:** a *light* hero (dark type on a pale photo), and long policy text set
  calmly inside the white sheet with no decoration. It is proof that the system carries long-form
  reading.

### TEAM
- **A. Structure** (19 blocks, 11029px, the longest):
  1. dark team-photo hero with a brand-colour headline;
  2. rounded sheet;
  3. three panels;
  4. repeated **photo-hold chapter breaks** ("Meet our Top Management", "Local Directors",
     "Management Team"), each followed by a portrait grid:
     - 3 columns for executives, 5 for directors, 4 for management;
     - portraits `cover`, grey studio backgrounds, name / role / short bio / "Read More";
  5. a charcoal "balance" field with white/yellow cards around a brand graphic;
  6. an "Organisational Structure" statement;
  7. an "Advisors and Partners" statement;
  8. split scenes: yellow text panels beside black-and-white photos;
  9. footer.
- **F. Choreography:** nine sticky sections. Each chapter photo holds while its title shows, then
  the grid rises over it. The long page is paced by chapters, not by scroll length.
- **G. Page-specific:** people are the images; photography is portrait-led and repeated in a
  strict grid, with photo holds as chapter titles.

### CAREERS
- **A. Structure** (9 blocks, 4583px):
  1. photo hero (sticky video) with a 400/700 headline;
  2. rounded sheet with the team statement;
  3. a photo band with an italic statement plus a pill button linking out;
  4. a "Join us" statement plus email CTA;
  5. a charcoal "Perks and Benefits" field with the brand graphic on the left and a 3-column grid of
     12 white cards with small yellow icons;
  6. a "Diversity and Inclusion" statement;
  7. footer.
- **G. Page-specific:** one large dark field carrying many small cards. The density is made
  calm by putting them *inside* one architectural field rather than floating on white.

### CONTACT
- **A. Structure** (8 blocks, 3327px):
  1. dark photo hero with a 400/700 headline and the name in brand colour;
  2. rounded sheet with the statement and email CTA;
  3. "Our Global Presence": a gap-less 3×2 mosaic (charcoal office tile / photo / yellow office tile /
     logo tile / grey office tile) with centred line icons;
  4. map beside a grey form panel (First name, Last name, Email, Message, consent, yellow submit);
  5. footer.
- **B. Typography:** hero 72px mixed; office names 20px 700 underlined; addresses 16px.
- **D. Shapes:** mosaic tiles are square-cornered and touch each other, the one place without
  radius. It reads as a single block, a map of presence.
- **F. Choreography:** hero pin + sheet (desktop only; at 390 the hero is not pinned); tiles float
  in; the form is static.
- **G. Page-specific:** the final brand scene. It combines statement, presence, map and form, and
  the form is small and quiet at the end.

---

## WHAT MAKES IT FEEL PREMIUM (principles, not features)

1. **Scenes, not sections.** Every page alternates *photo scene → white editorial sheet → colour
   field → photo hold → sheet*. The pin (T1) and the hold (T3) turn a scroll into a sequence of
   entrances and exits.
2. **One strong idea per scene.** Each block has one statement in large mixed-weight type, then its
   evidence (cards, numbers, bullets, map). Body copy is small and secondary.
3. **Colour as architecture.** Yellow and charcoal appear as *whole panels* with large radii, often
   with a panel inside a panel. Colour is never used as a decorative stripe.
4. **Photography as structure.** Photos are full-bleed stages or grid tiles of the same size as
   the colour panels. Photos are never decorative insets.
5. **Selective motion.** Only whole blocks enter (1200ms, sine/cubic in-out, once). Paragraphs,
   rows and small labels don't animate separately. Depth comes from sticky positioning, not from
   animation.
6. **Mobile is re-composed:** triplets become carousels, splits stack with alternating order, and
   the footer becomes a card. Pins remain where they help (photo pages) and are dropped where they
   don't (About, Contact).

## WHAT FINMENTOR SHOULD NOT TAKE

- Synthetic bold from a single light cut. FINMENTOR uses real weights of its own family.
- Long `SLIDE →` carousels for key content. FINMENTOR's arguments must stay readable without
  swiping; a carousel is acceptable only for secondary examples.
- The very long portrait grids and the heavy stacked-sticky choreography on phones.
- The yellow. Its role maps to FINMENTOR's restrained gold, used as a whole panel only where
  meaning justifies it.
