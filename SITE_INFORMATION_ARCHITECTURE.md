# FINMENTOR — SITE INFORMATION ARCHITECTURE

Positioning: **private CFO advisory × financial control × capital management × owner decision
system.** The homepage tells one story in nine scenes; methodology lives on hub pages; every
hub page links down into the existing topic pages, which keep their URLs.

## 1. Page tree

```
index.html                         Главная (9 scenes)
├── owner.html                     Для собственника            NEW hub
├── capital-management.html        Управление капиталом         NEW hub
├── business-models.html           Бизнес-модели                NEW hub
│   ├── real-estate-control-system.html
│   ├── retail-margin-engine.html
│   └── client-base-control-system.html
├── budgeting-forecasting.html     Бюджетирование и прогнозирование  NEW topic page
├── about.html                     О FINMENTOR (founder, experience)   NEW hub
│   └── methodology.html           Методология FINMENTOR        reused, linked from about.html
├── cases.html                     Практика                     reused
├── materials.html                 Материалы                    reused
├── questionnaire.html             Финансовый рентген (CTA)     reused
└── topic pages (unchanged URLs)   cash-flow, kaznacheystvo, upravlencheskiy-pl, working-capital,
                                   capex-hurdle-rate, capital-allocation-value, power-bi-dlya-sobstvennika,
                                   ai-dlya-cfo, monthly-cfo-support, cfo-consultation, financial-health-check …
ro/…                               identical tree, same filenames
```

New URLs exist only where no equivalent indexable page existed **and** the page receives
substantial content moved off the homepage (no thin pages, no duplicates).

## 2. Homepage scenes — one question each

| # | Scene | Section id | The one question it answers |
|---|---|---|---|
| 01 | Hero | `#top` | Who is this for, and what does it give me? |
| 02 | Problem | `#chaos` | Does this describe my business? |
| 03 | Owner control system | `#owner-control` | What exactly gets controlled? |
| 04 | Capital management | `#capital-allocation` | Where should the next euro of capital go? |
| 05 | Business models | `#industries` | Does it fit the economics of my business? |
| 06 | Formats of work | `#solutions` | How can we work together, and at what cost? |
| 07 | Practice | `#cases` | What does the work look like? |
| 08 | Materials | `#knowledge` | Can I see how they think? |
| 09 | Final CTA | `#consult` | What do I do next? |

## 3. Navigation (homepage and hub pages)

```
[finmentor]  О FINMENTOR · Для собственника ▾ · Решения ▾ · Управление капиталом · Материалы · Контакты    RU|RO   [ФИНАНСОВЫЙ РЕНТГЕН]
```

**Для собственника ▾** → `owner.html`
| Item | Target |
|---|---|
| Финансовый хаос | `owner.html#chaos` |
| Прибыль ≠ деньги | `owner.html#profit-question` |
| Три контура управления | `owner.html#owner-control` |
| Как работает FINMENTOR | `owner.html#steps` |
| Бизнес-модели | `business-models.html` |

**Решения ▾** → `index.html#solutions`
| Item | Target (existing page) |
|---|---|
| Финансовый контроль | `business-control-system.html` |
| Денежный поток и казначейство | `kaznacheystvo.html` |
| Управленческий P&L | `upravlencheskiy-pl.html` |
| Оборотный капитал | `working-capital.html` |
| Бюджетирование и прогнозирование | `budgeting-forecasting.html`. It is built only from existing pages: forecast → cash flow → payment calendar → fund planning → treasury → P&L → plan-vs-actual → CAPEX, each row the linked page's own H1 and visible lead |
| Капитальные вложения и инвестиции | `capex-hurdle-rate.html` |
| Управленческая отчётность | `power-bi-dlya-sobstvennika.html` |
| Автоматизация и BI | `ai-dlya-cfo.html` |
| Регулярный CFO-контроль | `monthly-cfo-support.html` |

"Финансовый рентген" is the CTA only; it is not repeated as a nav item.

**Behaviour:** the parent label is a real link (works without JS). The ▾ is a separate
`<button aria-expanded aria-controls>`; hover opens on fine pointers, click and Enter/Space
open everywhere, Esc closes and returns focus, Tab moves through the items, and focus leaving
the panel closes it; ArrowDown on the chevron moves into the first item. Motion is opacity +
translateY 10px, 240ms. The full bar shows from 1280px (RU) and from 1360px (RO, whose labels are
longer); below that the drawer takes over, with the two groups as native `<details>`
disclosures (no JavaScript required).

**Every reading page is on the site shell.** Materials, the articles and the offer pages (37 + 37) share
the same header, drawer and footer (`body.fm-shell`, solid header state), and their headings share the
same grotesk. Only the questionnaire (app shell), the legal pages (legal shell) and five legacy root
files outside the sitemap keep their own headers.

## 4. Hub page anatomy

Each hub page uses the homepage shell (`body.home`, same header, footer, motion engine and
section components), so moved sections render exactly as they did on the homepage:

1. Breadcrumb (visible) + `BreadcrumbList` JSON-LD
2. Page head: overline, H1, lead (from existing copy)
3. Moved sections, verbatim, re-ordered into the page's argument
4. Links down into the related topic pages
5. Closing CTA → `index.html#consult` and the Financial X-Ray

## 5. SEO

- Homepage keeps its title, description, canonical, hreflang, OG and structured data.
- New pages get their own title, description, canonical, `hreflang` ru/ro/x-default, OG, and
  a `BreadcrumbList`; they are added to `sitemap.xml`.
- Every block removed from the homepage leaves a teaser plus a link, or a nav entry, pointing
  at its new location, so internal link equity to the topic pages is preserved.

## 6. WATCH

- **Budgeting:** resolved by `budgeting-forecasting.html`. It is a topic page composed of existing content;
  a longer methodology article on budgeting is still a content decision for the owner.
- **Article headers:** resolved in the finalization pass.
