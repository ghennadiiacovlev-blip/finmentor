# FINMENTOR — Site-wide final QA report

Premium site rebuild: page-by-page art direction, every page, RU + RO. Branch `redesign/visual-system-2`, from `4ff7c73` (reference study) to the final commit of this pass. Dated 2026-09-22.

Companion documents: [SITE_PAGE_INVENTORY.md](SITE_PAGE_INVENTORY.md) · [PAGE_TYPE_DESIGN_SYSTEM.md](PAGE_TYPE_DESIGN_SYSTEM.md) · [PAGE_BY_PAGE_ACCEPTANCE.md](PAGE_BY_PAGE_ACCEPTANCE.md) · [SITE_WIDE_CONTENT_PRESERVATION_REPORT.md](SITE_WIDE_CONTENT_PRESERVATION_REPORT.md) · [FINMENTOR_TYPE_SCALE.md](FINMENTOR_TYPE_SCALE.md) · [YELLOWTREE_VISUAL_REVERSE_ENGINEERING.md](YELLOWTREE_VISUAL_REVERSE_ENGINEERING.md) · [YELLOWTREE_TO_FINMENTOR_PATTERN_MAP.md](YELLOWTREE_TO_FINMENTOR_PATTERN_MAP.md).

## 1. Result

| | |
|---|---|
| Indexed URLs rebuilt with their own art direction | **90 / 90** (45 RU + 45 RO) |
| Noindex brand pages rebuilt | thank-you (RU + RO), 404 |
| Page-by-page acceptance | **93 / 93 ACCEPTED** (90 indexed + 3 noindex), every column decided by evidence |
| Content | 6 393 base blocks: 6 295 kept, 77 re-set, 21 changed = recorded RU/RO copy corrections; **0 lost** |
| SEO | title, description, canonical, hreflang, robots and JSON-LD identical to the base on every indexed page |
| Internal links | 0 broken |

## 2. Gates

| Gate | Result |
|---|---|
| `qa/run-all.mjs` | **102 / 102 gates, 3 659 assertions, floors PASS** (no test removed or weakened; floor unchanged) |
| `qa/visual-evidence.mjs` | **30 passed, 1 failed** — the one failure is pre-existing and by owner decision (§5.1) |
| `qa/content-migration.check.mjs` | nothing lost (221 blocks, 62 links) |
| `qa/financial-map.qa.mjs` | 19 PASS / 0 WARN / 0 ERROR (24 stages, 5 chapter blocks, 10 principles, 34 items per language) |
| `qa/typography-lock.test.mjs` (new in this pass) | 5 / 5 — no serif declaration, webfont or inline serif on the website |
| Motion harness (76 checks: reveal families, stage release, deck pin, reduced motion, back/forward) | **76 / 76** |
| Questionnaire machine-control signatures | RU and RO byte-identical (409 controls each) |

## 3. Automated visual scan

| Scan | Scope | Result |
|---|---|---|
| Overflow / escaping elements | 90 indexed pages × 9 widths (320, 390, 430, 768, 1024, 1280, 1360, 1440, 1728) = 810 surfaces | **0 defects** (detector verified by injecting a 400px element at 320px, which registered) |
| Contrast (WCAG AA, every text element in <main> against its effective, gradient-aware background) | 90 pages at 1440 | **0 failing keys** (6 found on the homepage formats in this pass and fixed) |
| Capture scan (header, logo, font load, hero, collisions) | 90 pages × 1440 + 390 | 180 captures, **0 issues** |
| Rendered-font scan | 119 tracked HTML files × 2 widths | **0 website pages** with a serif face; the only one is `app-premium/index.html` (§5.2) |
| RU/RO structural parity (sections, headings, tables, forms, motion hooks) | 45 pairs | identical |
| Pre-existing defect: budgeting-forecasting at 320px was 344px wide | | now 320px |

## 4. Evidence on disk (`qa-artifacts/site-wide-final/`, git-ignored)

- `desktop/` — 90 screenshots at 1440 × 900; `mobile/` — 90 at 390 × 844.
- `full-desktop/`, `full-mobile/` — full-page captures of the key families (home, owner, capital-management, business-models, budgeting, about, materials, X-Ray, a photo article, a photo solution, an offer, a knowledge page, legal; RO home, capital, materials, an RO article).
- `motion/` — real screencast recordings at 30 fps: `home-1440.mp4`, `owner-1440.mp4`, `capital-management-1440.mp4`, `business-models-1440.mp4`, `article-capital-allocation-value-1440.mp4`, `materials-1440.mp4`, `home-390.mp4`, `article-pribyl-vs-cash-390.mp4`.
- `scan.json` — the capture scan.

## 5. Open items that need an owner decision

1. **Privacy page legal note.** The visual-evidence legal gate expects a `.legal__note` on privacy. The owner removed that note (a "draft, to be agreed with a lawyer" disclaimer) in the C4.11 privacy release (`b0a4cc2`). Released legal text was not changed here, so the check stays red. To close it, either restore a note approved by the owner, or change the gate to match the released policy. Both are owner decisions.
2. **`app-premium/index.html` renders Playfair Display** in its H1. It is the sealed product app: noindex/nofollow, not linked from any website page, and byte-sealed by the C2 final-closure hash gate. It is documented as an exception in `qa/typography-lock.test.mjs`. Bringing it under the sans lock means changing a sealed file and re-sealing the C2 hash. That is an owner decision.
3. **RO questionnaire H1** («Cât de sănătos este sistemul financiar al afacerii dumneavoastră?») differs in substance from RU («Финансовый рентген FINMENTOR»). It is kept as written and flagged for the native RO editorial review, together with the rest of the RO copy.
4. **Legacy RO pages** (`capital-circulant`, `power-bi-for-owner`, `power-bi-pentru-proprietar`, `treasury`, `trezorerie`) and the 17 tracked `… (n).html` duplicates are noindex and outside the indexed scope. They were left unchanged, not deleted.

## 6. Performance, accessibility, SEO

- Motion is CSS transitions and one IntersectionObserver; stages are `position: sticky` inside their scene. There is no scroll-jacking, no scroll-driven animation and no animation library. `initFx` runs on load and resize only.
- LCP measured locally (no throttling), 3 runs each: home 40–56 ms (1440, hero title) / 44–256 ms (390, hero image); capital-management 40–56 / 44–136 ms; materials 48–52 / 44–144 ms; capital-allocation-value 32–52 / 44–120 ms.
- Reduced motion and print: nothing hidden, nothing pinned. Without JavaScript the hidden reveal state is never applied (`html.m-js` gate).
- One H1 per page; heading order kept; alt text on every new image; the questionnaire keeps its labels, states (hover, focus, checked, error, disabled) and live regions.

## 7. Commits of this pass

```
4ff7c73 docs: reverse engineer reference art direction
af153e2 style: build site-wide editorial primitives
183806a fix: lock sans-serif typography site-wide
ae56d8f style: rebuild owner and business-model experiences
b414ebc style: rebuild budgeting and about experiences
a3b70ca style: rebuild solution experiences and article system part 1
a5a77cb style: rebuild materials as a research library
d559268 style: refine homepage scene titles with mixed-weight statements
ceb715e style: rebuild supporting pages
6c63b04 fix: resolve site-wide responsive and contrast defects
be3b773 fix: place split cover columns explicitly
        docs: record page-by-page final acceptance (this report and its companions)
```

## 8. Final scale and choreography correction

Goal: one screen = one primary idea. The information architecture is unchanged, no content was removed, and no new photographs were added.

| Area | Change |
|---|---|
| Articles (31 pages × RU/RO) | 2–3 of each article's own sections elevated into scenes: a thesis band (stone) and a dark scene (navy), both full bleed, with a rounded rise and an ivory cap closing them. The statement heading is set at display scale with its payoff clause bold; the conclusion is at statement scale. Body text stays in the reading column. |
| Statement scene (new primitive `.fx-word`) | One financial word in very large Manrope 800 with a gold full stop, and the article's own thesis heading beneath it as the question. Used on 8 articles as their opening transition (Деньги, Капитал ×2, Маржа, Выручка, Платежи, Цена, Прогноз; RO equivalents). Owner's «Прибыль. А если это ещё не деньги?» is at the same scale. |
| Covers | Reading-page H1s at display scale; photo covers take the first screen (capped at 1000px). |
| Photography | Business Models: PHOTO 03 holds the right half of the first screen. About: the portrait fills its half and is served from the 780w source (it was served at 420w). |
| Materials | Featured material (one navy lead + a ruled list) → collection scenes (display titles, ruled editorial index, no boxes) → full library. |
| About | Philosophy statement at display scale with «авторская финансовая система» bold; founder heading and lead at display scale. |
| Homepage | Nine scenes unchanged. The capital cycle is set as display rows; the industries thesis at statement scale. |
| Mobile | Covers and statements scale down under 400px; the word never exceeds the frame. |

Gates after the correction: run-all **102/102, 3 659 assertions, floors PASS** · visual evidence **30/31** (privacy note only, §5.1) · motion **76/76** · contrast **0 failing keys / 90 pages** · overflow **0 / 810 surfaces** · a new ink-level text audit (every text line box inside the viewport) **0 defects** across 90 pages at 7 widths · preservation unchanged (6 393 blocks, 0 lost) · 93/93 acceptance rows.

One harness change: the capture tool's full-page mode previously capped the capture at 16 000px, which duplicated imagery on long pages. It now stitches real scroll positions. Screenshots are in `qa-artifacts/scale-final/` (`desktop/`, `mobile/`, `full-desktop/`, `full-mobile/`: home, capital-management, business-models, materials, about, cash-flow, capital-allocation-value, deal-economics, owner, X-Ray).
