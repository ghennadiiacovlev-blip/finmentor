# FINMENTOR — PREMIUM WEBSITE 2.0 · FINAL VISUAL QA REPORT

Branch `redesign/visual-system-2`. Companion documents: `HOMEPAGE_CONTENT_MIGRATION_MAP.md`,
`SITE_INFORMATION_ARCHITECTURE.md`, `MOTION_SYSTEM.md`, `IMAGE_ART_DIRECTION.md`.

## 1–4. Heads, branch, commits

| | |
|---|---|
| Documented start | `7726be4` |
| **Actual start** | `fb661dd` (hero photography, one commit later) plus an **uncommitted** motion engine. It was verified and committed first so no work was lost |
| Final HEAD | the docs commit that adds this report, on top of `90992aa` |
| Branch | `redesign/visual-system-2`. No reset, rebase or history rewrite |

| Commit | Content |
|---|---|
| `392efde` feat: implement FINMENTOR motion system | the engine, four families, intro handover, no-JS/reduced-motion guarantees, LCP fix |
| `985d7fc` refactor: restructure homepage into nine scenes with four hub pages | IA, hub pages, navigation, SEO, test retargets, content-migration proof |
| `90992aa` style: final premium production polish | fixes from the art-director scene review |
| docs | this report, the migration map, the IA and motion documents |

> Correction: the `985d7fc` message quotes "72/72" motion checks, a figure combined from
> several runs. A single complete run gives **74/74**, plus 2/2 for the back-button scenario
> added afterwards.

## 5. Files

- **Homepage:** `index.html`, `ro/index.html`
- **New hub pages:** `owner.html`, `capital-management.html`, `business-models.html`,
  `about.html`, each with a `ro/` edition
- **Shared code and data:** `style.css`, `main.js`, `sitemap.xml`
- **QA:** `qa/content-migration.check.mjs` (new). Retargeted: `commercial-polish`,
  `premium-typography`, `editorial-production`, `privacy-policy-release`, `website-contract`,
  `financial-map`, `visual-evidence`
- **Docs:** the four `.md` files above

## 6. URLs

| New | Reused (unchanged) |
|---|---|
| `owner.html`, `capital-management.html`, `business-models.html`, `about.html` (+ `ro/`) | `index.html`, `methodology.html`, `cases.html`, `materials.html`, `questionnaire.html`, and all topic pages linked from the nav |

Each new URL exists because substantial homepage content moved to it and no equivalent page
existed. Before creating them I checked all 45 existing pages.

## 7. Homepage before / after

| | Before (`392efde`) | After |
|---|---|---|
| Top-level sections | 21 (24 blocks incl. nested) | **9 scenes** |
| Words in `<main>` (RU) | 3,889 | **1,263 (−68%)** |
| HTML (RU / RO) | 137.7 KB / 113.2 KB | **78.0 KB / 67.2 KB** |
| `#consult` position at 1440 | y ≈ 27,400 | **y ≈ 11,600** |

Scenes: Hero → Problem → Owner control system → Capital → Business models → Formats →
Practice → Materials → Final CTA. Each answers one question (see IA §2).

## 8. Where the removed content went

See `HOMEPAGE_CONTENT_MIGRATION_MAP.md`, section by section. **Proof:**
`node qa/content-migration.check.mjs` checks all **221 text blocks** (12+ words) and all
**62 internal links** of the baseline homepage, RU and RO. It confirms each still exists on the
homepage, a hub page or the Materials library. Result: **nothing lost.** Every deliberate
wording change is declared there with its replacement.

## 9. Navigation

О FINMENTOR · Для собственника ▾ · Решения ▾ · Управление капиталом · Материалы · Контакты ·
RU/RO · [ФИНАНСОВЫЙ РЕНТГЕН]. "Финансовый рентген" appears once, as the CTA. The full map and
behaviour are in IA §3.

## 10. RU copy review

- **Owner-supplied wording** is applied: symptoms 03 and 05, pillar terms (Денежный поток,
  Управленческий P&L, Рентабельность, Капитальные вложения…), and the models headline and
  KPI lines.
- **Practice** is relabelled Ситуация → Контроль → Решение.
- **Anglicisms** are normalised: "План действий (Roadmap)" → "План действий", "due diligence"
  → "комплексная проверка (due diligence)", "development" → "девелопмент".
- **Deliberately unchanged:**
  - Approved product names (CFO Advisory Session, Financial Health Check, Business Control
    System, CFO Control Partner). They are commercial names protected by QA contracts.
  - Test-locked commercial wording ("Cash Flow" and "Ключевые финансовые KPI" in the
    Business Control System scope).
  - KPI abbreviations (NOI, CAPEX, CAC, LTV, ROAS) and brand names.
- **No new claims.** Every new sentence is derived from existing copy.

## 11. RO parity

- The builder generates RU and RO from the same composition, so section order, ids,
  components and destinations are identical.
- RO keeps its own professional wording. Every new RO string is an adaptation, not a
  transliteration.
- QA: the RU/RO visual-parity check now also covers the 4 hub pairs.
- **One intentional difference:** the RO bar hands over to the drawer below 1360px (RU:
  1280px), because the RO labels are longer.

## 12. Photography

| Slot | Status |
|---|---|
| PHOTO 01 hero | **Final raster shipped** (AVIF 95 KB / WebP / JPG). **WATCH:** the master is 1536×1024, below the 2400×1500 contract. Its content (skyline, sun in the protected zone) departs from the art direction; readability was restored with a minimal scrim change |
| PHOTO 02 capital-decision | SVG placeholder (official). Awaiting licensed asset |
| PHOTO 03 real-assets | SVG placeholder (official). Awaiting licensed asset |
| Founder portrait | Now §5-compliant: no gold ring, no glow, no rounded frame; only on `about.html` |

No stock photography was added.

## 13. Motion

See `MOTION_SYSTEM.md`. There are four families, one IntersectionObserver with batch stagger,
the hero held behind the intro, the capital question shown before its photograph, and
everything plays once.

## 14. Responsive verification

| Check | Coverage |
|---|---|
| Header fit (no overlap, nothing outside the bar, no wrapped link, ≥ 40px air) | 320, 390, 768, 1024, 1279, 1280, 1300, 1359, 1360, 1366, 1440, 1728 · RU + RO |
| visual-evidence (overflow, clipping, CTA fit, header, drawer, language) | homepage 320/390/768/1024/1440; hubs 390/1440 |
| Motion scroll audit (0 hidden, CLS, overflow) | homepage 1728/1440/1024/768/430/390; hubs 1440/390 · RU + RO |

Evidence (not committed; `qa-artifacts/` is gitignored) is in `qa-artifacts/final/`:
- per-scene screenshots of all 5 pages at 1440 and 390;
- full-page homepage captures (RU and RO, 1440 and 390);
- the open dropdowns and the drawer;
- **`motion-1440-hero-to-cta.mp4`** (43 s: intro → hero → every scene → final CTA);
- **`motion-390-sample.mp4`** (16 s).

## 15. Accessibility

- **Navigation:**
  - The parent label is a link; the chevron is a `<button aria-expanded aria-controls>`
    with a visually hidden name.
  - Enter/Space/click open it; ArrowDown enters the panel; Esc closes and returns focus;
    focus leaving the panel and outside clicks close it; hover works on fine pointers.
  - Verified in Chrome with real focus events.
  - Without JS the panels open on hover and `:focus-within`.
- **Drawer:** native `<details>`, with 44px targets.
- **Page structure:** `aria-current="page"` on the active hub; a visible breadcrumb inside
  `<nav>`; the heading order is page H1 → section H2.
- **Reduced motion and no JS:** content is complete on first paint.
- **Floating help:** a 36px dot tucked into the gutter on mobile.

## 16. Performance (lab, headless Chrome)

| Metric | Result |
|---|---|
| LCP | **30–110ms** on every page at 390 and 1440 (the element is the H1 or PHOTO 02) |
| CLS | ≤ 0.0004 on every page and width |
| Long tasks | 0 |
| Scroll handlers | no continuous handler; only transform, opacity and clip-path animate |
| Page weight | HTML −43% (RU) / −41% (RO); hero AVIF 95 KB, preloaded with `fetchpriority=high`; PHOTO 02/03 lazy |

## 17. SEO

- **Homepage:** title, description, canonical, hreflang, OG and JSON-LD unchanged.
- **Hub pages:** each has its own title, description, canonical, `hreflang` ru/ro/x-default,
  OG, and a `WebPage` + `BreadcrumbList` graph. The site-wide JSON-LD, hreflang and breadcrumb
  contracts pass on them.
- **Sitemap:** 80 → 88 URLs.
- **Links:** the moved methodology keeps every internal link, verified by the content check.
  Link integrity (`financial-map.qa.mjs`) covers the homepage, all hubs and the touched
  articles: 19 PASS, 0 WARN, 0 ERROR.

## 18. Full QA (final build)

| Suite | Result |
|---|---|
| `node qa/run-all.mjs` | **101/101 gates, 3654 assertions, floors PASS**. No check removed; no floor changed |
| `node qa/visual-evidence.mjs` | **30 passed / 1 failed**. The one failure is pre-existing (below). Now includes 8 hub surfaces |
| `node qa/content-migration.check.mjs` | 221 + 62 checked; nothing lost |
| `node qa/financial-map.qa.mjs` | 19 PASS / 0 WARN / 0 ERROR |
| Motion + navigation harness | **74/74** in one run, then back button **2/2**. Covers the intro handover, hero order, 5 pages × RU/RO scroll audit, fling, anchor jump, refresh mid-page, reduced motion, no JS, blocked `main.js`, slow network, `<details>`, keyboard and hover disclosures, and header fit 320–1728 |

**Tests retargeted, never weakened.** Each check follows its sentence or structure to the
page it now lives on. Details are in the `985d7fc` message.

## 19. Pre-existing failures (not introduced here, not hidden)

- **visual-evidence › LEGAL PAGE INTEGRITY:** the privacy pages' `note` element (RU and RO,
  12 surface × width combinations). It fails identically on a clean checkout of the baseline.
- **Stale visual-evidence baseline figure:** the figure recorded in `8676f31` ("32 passed") does
  not match the harness. On an unmodified checkout it reports 30 passed / 1 failed, with the
  same check set.

## 20. WATCH

1. **PHOTO 01.** Replace it with a ≥ 2400px master that respects the protected zone (no
   skyline, no bright element in the left 45%). Record the licence.
2. **PHOTO 02 and PHOTO 03** are still the official placeholders. `PHOTO_ASSET_INTEGRATION_CHECKLIST.md`
   is ready for the swap.
3. **Budgeting and forecasting** has no dedicated page. The nav item points to
   `treasury-waterfall.html` (fund planning).
4. **Article pages** keep their reading header (`doc-bar`), which is test-covered. Moving them
   onto the new nav is a separate change.
5. **The Materials page** was not restyled in this pass (brief §19, "insights library"). It
   already links everything the homepage featured.
6. **New RO strings** (nav notes, hub leads, breadcrumbs) would benefit from a native-speaker
   read.
7. **The Formats scene** is the longest at 4,127px at 1440. Its density comes from
   test-locked commercial terms (scope, terms, next steps). Shortening it is a commercial
   decision.

## Art-director self-review

1. **Is the homepage visibly shorter?** Yes. It has 68% fewer words, and the contact form
   moved from y≈27,400 to y≈11,600 at 1440.
2. **Was any meaningful content lost?** No. This is proven block by block, not estimated.
3. **Does each scene have one idea?** Yes (IA §2). Formats is the densest, for the reason in
   WATCH 7.
4. **Does it read as one story?** Yes. Symptom → system → capital → fit → how we work →
   evidence → thinking → next step, and every scene has one route to its full page.
5. **Anything template-like?** The review removed the ones it found: the boxed asset callout,
   the SaaS "Для кого" boxes, and the pill facts.
6. **Too many cards?** The remaining cards are deliberate: the contact form, the report
   samples (they stand for documents), and the hairline material links.
7. **Random empty areas?** One found and fixed: the Business models closing blocks.
8. **Does motion support the content?** Yes. The divider draws before the evidence, the
   verdict follows it, the capital question precedes its photograph, the spine reveals each
   stage as it reaches it, and each mandate unfolds from index to action.
9. **Is gold precision, not decoration?** Yes: rules, indices, the active state and one
   solid CTA in the hero.
10. **Would it still read as a capital-advisory firm with the logo covered?** In structure,
    typography and argument, yes. The weakest element is photography: two placeholders and a
    hero photo that departs from the brief. The final photographs are what completes the
    brief's "scale and permanence".
