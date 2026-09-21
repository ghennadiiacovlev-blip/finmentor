# FINMENTOR — HOMEPAGE CONTENT MIGRATION MAP

**Baseline:** branch `redesign/visual-system-2`, HEAD `fb661dd` (hero photography) plus the
uncommitted motion engine, committed first as its own change. The brief documented `7726be4`;
the actual HEAD is one commit later.

**Rule:** less content *at once*, not less content. Every block below either (A) stays on the
homepage, (B) moves whole to an internal page, or (C) becomes a teaser plus an internal link.
Nothing is deleted. RO follows RU one-to-one: same section, same destination, `ro/` prefix.

**Homepage before:** 21 top-level sections, plus 3 nested inside `#capital-logic` = 24 blocks,
roughly 3,900 words. **After:** 9 scenes.

## Destinations

| Code | Page | URL | Status |
|---|---|---|---|
| HOME | Homepage | `index.html` | existing |
| OWNER | Для собственника | `owner.html` | **new** — no equivalent page existed; receives ~1,100 words of homepage methodology |
| CAPITAL | Управление капиталом | `capital-management.html` | **new** — no equivalent hub; articles on capital exist and are linked from it |
| MODELS | Бизнес-модели | `business-models.html` | **new** — only per-model pages existed (real estate, retail, subscription) |
| ABOUT | О FINMENTOR | `about.html` | **new** — founder and experience content existed only on the homepage; `methodology.html` stays the methodology page and is linked from it |
| CASES | Практика | `cases.html` | **reused** |
| MATERIALS | Материалы | `materials.html` | **reused** — already links every material the homepage featured |

## Section by section

| # | Current section | Topic | Decision | Destination | SEO action | Existing internal links (kept) | Must not be lost |
|---|---|---|---|---|---|---|---|
| 01 | `#top` hero | Positioning, H1, signature statement | **KEEP** | HOME scene 01 | H1 unchanged; supporting copy in Russian ("Внешний финансовый директор…") | `questionnaire.html` | H1, three-line statement, both CTAs and their `data-cta-id`s, PHOTO 01, trust line |
| 02 | `#chaos` | 8 symptoms + verdict | **KEEP 5 / MOVE 8** | HOME scene 02 (5) → OWNER `#chaos` (all 8) | Homepage adds "Все признаки финансового хаоса →" | — | All 8 symptom sentences (full set on OWNER), verdict "Это не проблема людей. Это отсутствие системы." |
| 03 | `#profit-question` | Прибыль ≠ деньги, spine Прибыль → Деньги → Оборотный капитал → Капитал | **MOVE** | OWNER `#profit-question` | Owner dropdown "Прибыль ≠ деньги"; OWNER links `pribyl-vs-cash.html` | — | Statement, 4-stage spine, closing line |
| 04 | `#owner-control` | Three control contours | **KEEP** | HOME scene 03; full section with lead on OWNER `#owner-control` | Terms normalised to Russian | — | 3 pillars × title, descriptor, 3 terms |
| 05 | `#profit-capital` | Profit is a result, capital control is management (two flows) | **MOVE** | OWNER `#profit-capital` (after the statement) | — | — | Both flows and both notes |
| 06 | `#difference` | FINMENTOR vs accounting vs analytics | **MOVE** | OWNER `#difference` | — | — | All 3 rows |
| 07 | `#industries` | 6 business models, full methodology in `<details>` | **KEEP 4 / MOVE 6** | HOME scene 05 (4 teasers) → MODELS (all 6, full detail) | "Все бизнес-модели →"; MODELS links every per-model page | `real-estate-control-system.html`, `retail-margin-engine.html`, `client-base-control-system.html`, `questionnaire.html?model=…` | All 6 models, every `<details>` body, the asset callout, the final CTA, `data-business-model` hooks |
| 08 | `#capital-allocation` | "Где следующий 1 EUR…", 6-stage cycle, PHOTO 02 | **KEEP (preview)** | HOME scene 04; the same framework opens CAPITAL | "Подробнее об управлении капиталом →" | — | Headline, lead, 6 stages, routes line, PHOTO 02 |
| 09 | `#capital-logic` | Капитал должен работать: definition, capital map | **MOVE** | CAPITAL §01 | Hub page with its own title, description, canonical, breadcrumb | `capital-preservation.html` | Lead, definition, map intro |
| 09a | `.capital-source` (nested) | Sources of capital + structure | **MOVE** | CAPITAL §02 | — | — | 3 sources, capital structure note |
| 09b | `.capital-dimension` location (nested) | Where capital sits (5) | **MOVE** | CAPITAL §03 | — | — | 5 locations |
| 09c | `.capital-dimension` state (nested) | How capital works (5 states) + full logic line | **MOVE** | CAPITAL §04 | — | — | 5 states, 7-step capital flow |
| 09d | `.capital-risk`, principles, mechanisms | Risk layer, 4 CFO principles, value-creation mechanism | **MOVE** | CAPITAL §05–§07 | — | — | Risk note, 4 principles (QA contract: four `capital-principle reveal`), mechanisms paragraph, the CFO's main question |
| 10 | `#audience` | Who FINMENTOR is for (7) | **MOVE** | OWNER `#audience` | — | — | All 7 items + note |
| 11 | `#steps` | How FINMENTOR works: 3 steps + joint working contour | **MOVE** | OWNER `#steps` | Owner dropdown "Как работает FINMENTOR" | — | 3 steps, working contour (remote, capacity) |
| 12 | `#solutions` | Formats of work: 4 mandates | **KEEP** | HOME scene 06 | — | `cfo-consultation.html`, `questionnaire.html?topic=…`, `monthly-cfo-support.html` | Names, prices, terms, CTAs, `data-cta-id`s, QA package-title contract |
| 13 | `#modules` | System modules map (links to 9 module pages) | **MOVE** | OWNER `#modules`; the same pages also form the "Решения" dropdown | Links preserved on OWNER and in the nav on every hub page | `kaznacheystvo`, `treasury-waterfall`, `working-capital`, `fcf-postavshiki`, `retail-margin-engine`, `supplier-rating-purchasing-priorities`, `margin-factor-analysis-flags`, `power-bi-dlya-sobstvennika`, `ai-dlya-cfo` | Every module row and its description |
| 14 | `#flagship` | Retail margin system | **MOVE** | MODELS, retail row | Also listed under Разработки on MATERIALS (already) | `retail-margin-engine.html` | Pain, what FINMENTOR builds, what the owner sees, decisions |
| 15 | `#ai-economics-teaser` | AI economics teaser | **MOVE** | OWNER `#modules` (after the map) | Also listed on MATERIALS (already) | `ai-agent-economics.html`, `…#methodology` | Pain grid, flow, both CTAs, analytics `data-ai-economics-view` hook |
| 16 | `#cases` | Practice: 3 result cards, deliverables, report samples | **KEEP 3 / MOVE rest** | HOME scene 07 (3 scenarios, relabelled Ситуация → Контроль → Решение); deliverables + samples → OWNER `#deliverables` (they need the homepage component styles) | "Посмотреть подход FINMENTOR →" | `cases.html` | 3 scenarios, deliverables list, 4 sample reports + note |
| 17 | `#about` | Founder, experience, contacts | **MOVE** | ABOUT (`about.html#about`) | Portrait stays out of every hero | — | Portrait, lead, 4 paragraphs, anchor list, trust links (email, LinkedIn) |
| 18 | `#mini-scan` | Working-capital express scan | **MOVE** | CAPITAL §08 | — | `working-capital-scan.html`, `working-capital.html` | Both links |
| 19 | `#knowledge` | Materials | **KEEP (3)** | HOME scene 08 | — | `pribyl-vs-cash.html`, `materials.html`; the other 5 links already live on MATERIALS | 3 featured materials, "Все материалы" |
| 20 | `#after` | What happens after the request | **MOVE** | OWNER `#after` | — | — | 5 steps + callout |
| 21 | `#consult` | Final CTA + form | **KEEP** | HOME scene 09 | — | `privacy.html` | Form, consent, email, Telegram/contacts, `data-cta-id`s, lead transport |

## Verification (run after migration)

`node qa/content-migration.check.mjs` extracts every text block of 12+ words and every internal
`href` from the **baseline** homepage (`392efde`, RU and RO) and proves each one exists on the new
homepage or a destination page. Owner-approved wording changes are declared in the script with
their replacement, and the replacement must be present. Homepage material teasers are proven by
their link reaching `materials.html`.

**Result:** 221 text blocks and 62 internal links checked. Nothing lost.
