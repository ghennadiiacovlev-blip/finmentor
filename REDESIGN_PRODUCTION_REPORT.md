# FINMENTOR — PRODUCTION PASS · DELIVERY REPORT

## 1–2. Heads

| | Commit |
|---|---|
| **Previous HEAD** | `f536413` (docs wrapper over code checkpoint `a2c4271`) |
| **New HEAD** | `884d674` |
| Branch | `redesign/visual-system-2` |
| History | `be9fd3f` (A) → `3598dbd` (B) → `a2c4271` (C) → `f536413` → `b5ed07d` → `884d674` — nothing reset, nothing dropped |

## 3. Files changed

```
FINMENTOR_PAGE_MAP.md                                +155   new (STEP 1 deliverable)
images/editorial/decision-environment.svg  →  capital-decision.svg   (§8 contract)
images/editorial/real-estate-investment.svg → real-assets.svg        (§9 contract)
index.html                                   161 +/-
ro/index.html                                157 +/-   structurally identical
style.css                                   1087 +/-
6 files changed, 1231 insertions(+), 329 deletions(-)
```

## 4. QA result

| Check | Result |
|---|---|
| `node qa/run-all.mjs` | **101/101 gates, 3654 assertions** — identical to baseline |
| `node qa/visual-evidence.mjs` | **32 passed, 1 failed** — same single pre-existing failure as baseline |
| Horizontal overflow | **0** at 320 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1728 |
| Offscreen text | 0 at every width above |
| RU/RO parity | structural parity gate green; both editions 23 sections |
| Document structure | one `<h1>`, 18 `<h2>`, no orphan `<h3>` |
| Disclosure a11y | 6 `<summary>` elements, all keyboard-focusable, visible focus ring, content paints when opened |
| Images | all carry `alt`; 3 below-fold lazy; hero preloaded |
| Console | no errors observed |
| Reduced motion | every new animation inert under `prefers-reduced-motion` |
| Functional freeze | no route, form, webhook, tracking attribute, schema, URL or price touched |

**The one failure is pre-existing and unrelated:** `LEGAL PAGE INTEGRITY` on
`ru-privacy` / `ro-privacy` (`note=false`) at all five widths. It is red at baseline
`be9fd3f`, was red at every checkpoint since, and the privacy pages were not touched by
this pass. Reported, not hidden, not "fixed" by deleting the test.

## 5. WATCH items

**WATCH-A — business-model methodology moved into a disclosure, not deleted.**
§18 asks that full methodology leave the homepage. Three of the six models (e-commerce,
distribution, project manufacturing) have **no dedicated page** — their CTAs go to the
questionnaire — so deleting their copy would remove it from the site entirely, which §35
forbids. Each model now shows one concise control line; the methodology sits in a native
`<details>`, closed by default, still in the DOM and still crawlable. Owner decision
whether to build the three missing pages and then delete the disclosure.

**WATCH-B — process section still has three steps, not five.**
§25 specifies 01 Задача / 02 Диагностика / 03 Данные / 04 Формат работы / 05 Решение.
The live section has three approved steps, and one of them
(«Сопровождение и контроль исполнения») is asserted verbatim by
`commercial-polish.test.mjs`. Restyled as an indexed sequence; the step **count** was not
changed because that is a copy decision under contract, not a visual one.

**WATCH-C — all three photographs are still vector placeholders.**
See §6 below. This is the single largest remaining gap.

**WATCH-D — hero CTA priority remains inverted** (primary = Telegram, secondary =
Financial X-Ray), as instructed at checkpoint C. May move questionnaire conversion.
Reverting is a two-class swap.

**WATCH-E — entry animation depends on the language gate.** Pre-existing: all `.reveal`
elements sit at `opacity: 0` until the gate is dismissed. Invisible to the QA gates
because they emulate `prefers-reduced-motion`. Untouched per the intro freeze (§10).

**WATCH-F — `#modules` and the AI/flagship block form a long uninterrupted navy run.**
Defensible (they are catalogue sections and §3 forbids a colour formula), but it is the
one place where the page rhythm is monotonous at full-page zoom.

## 6. Image assets still pending

**All three.** This environment cannot produce photographs; every image on the page is
vector artwork authored here and marked as a placeholder in-file.

| Slot | Path (contract, frozen) | Geometry | Status |
|---|---|---|---|
| PHOTO 01 | `images/editorial/hero-capital.svg` | 2400×1500, left negative space | placeholder |
| PHOTO 02 | `images/editorial/capital-decision.svg` | 1920×1280 (3:2) | placeholder |
| PHOTO 03 | `images/editorial/real-assets.svg` | 1920×2400 (4:5) | placeholder |

The hero `<picture>` already carries the **1440 / 1024 / 768 / 390** crop contract as
`<source media=…>` entries. When the licensed rasters arrive: add
`<source type="image/avif">` and `<source type="image/webp">` beside the existing media
queries, repoint `<img src>`, update the preload href. **No CSS or layout change** —
`aspect-ratio`, `object-position` and the scrims are built to the final geometry.

Generation prompts and hard negative lists for all three: `IMAGE_ART_DIRECTION.md` §0b.

## 7. Screenshots

All in `qa-artifacts/prod/`.

**Desktop 1440:** `hero-1440.png` · `chaos-1440.png` · `profit-1440.png` ·
`owner-1440.png` · `capital-1440.png` · `models-1440.png` · `formats-1440.png` ·
`cta-1440.png`

**Mobile 390:** `hero-390.png` · `chaos-390.png` · `profit-390.png` · `owner-390.png` ·
`models-390.png` · `cta-390.png`

**Full page:** `fullpage-1440.png` · `fullpage-390.png`

---

## What changed, by section

| § | Section | Before | After |
|---|---|---|---|
| 12 | Hero | C composition | PHOTO 01 wired with the four-crop contract; architecture holds the viewport |
| 14 | Финансовый хаос | approved at C | unchanged structurally; verdict grouped under the claim |
| 15 | Прибыль ≠ деньги | English flow labels, floating in space | RU-Cyrillic labels (ПРИБЫЛЬ / ДЕНЬГИ / ОБОРОТНЫЙ КАПИТАЛ / КАПИТАЛ), vertical spine, quiet closing line, three-row grid |
| 16 | Три контура | unreviewed pillars | indexed editorial columns: large numeral, contour name, descriptor, gold rule, terms |
| 17 | Управление капиталом | four routes, no image | PHOTO 02 image-led; six-stage cycle Источник → Размещение → Отдача → Риск → Высвобождение → Перераспределение; destinations kept as one notation line |
| 18 | Бизнес-модели | six dense cards | PHOTO 03 anchor left, indexed 01–06 right, one control line each, methodology in a disclosure |
| 19 | Решения | row markup, card styling | editorial rows, gold group rules |
| 20 | Форматы работы | SaaS pricing cards | advisory mandates 01–04 via CSS counters; price/scope column; gold rule on the flagship |
| 21 | Практика | three result cards | Проблема → Что сделали → Результат, indexed, hairlines |
| 23 | Кто стоит за FINMENTOR | text-only already | unchanged; no founder photograph anywhere |
| 24 | Материалы | card wall | editorial list |
| 25 | Как работаем | three step cards | indexed sequence on a gold rule |
| 26 | Final CTA | navy + form | unchanged; form keeps its frame (a form is genuinely a bounded object) |
| 28 | Card audit | 28 rendered cards | **4** (`sample-card` ×4 retained — each is a discrete artefact the owner receives) |
| 29 | Floating help | gold-glow chat bubble | small, 72% opacity, square, no glow; 40px circle on mobile |

## Corrections I found in my own visual QA, before delivery

1. **Industries had an ivory background with dark-field text tokens** — a genuine contrast
   failure that made the heading and lead nearly invisible. Fixed by applying `sec--light`
   rather than only setting a background colour.
2. **Duplicate CTA arrow** — markup `&rarr;` plus the shared pseudo-element arrow.
3. **Flagship badge** pushed to the far right margin by flex justification.
4. **Capital section** ended in an unanchored navy band, and PHOTO 02 was scrimmed so
   heavily the environment disappeared.
5. **C8's unconditioned image heights** overrode the mobile crop, making PHOTO 03 consume
   most of a 390px screen.
6. **A superseded CSS block** (`8.2 Business models`) was still forcing the control line
   into grid column 1 below 860px, overflowing the viewport by 119px. Deleted rather than
   layered over.

## 40. The non-negotiable test

> *If the FINMENTOR logo were hidden, would this still feel like a serious private CFO /
> capital management firm?*

Hero, capital management, pillars, mandates and the profit/capital pivot: **yes** — the
composition, the grotesk hierarchy, the numeric indexing and the single-gold-event rule
carry it.

> *Would a business owner feel this company can control capital, not just prepare reports?*

The capital-management section is now the page's argument for that, and it no longer looks
like software.

**The honest qualification:** three placeholder images are doing the work of three
photographs. The compositions are correct and the geometry is frozen, but the authority
this direction depends on will only be fully present once PHOTO 01–03 are real. I have not
called the placeholders final anywhere, and I did not add stock photography.
