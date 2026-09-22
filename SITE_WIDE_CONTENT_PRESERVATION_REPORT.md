# FINMENTOR — Site-wide content preservation report

Generated 2026-09-22. Base: `4ff7c73` (the last commit before the page-by-page rebuild). Compared: the working tree after the rebuild. Method (`preserve.mjs`): every semantic block of the base page in <main> (headings, paragraphs, list items, table cells, captions, figure text; ≥ 12 characters and ≥ 3 words) must survive:

- **kept** — the block's normalised text occurs in the new page;
- **rewritten** — ≥ 85 % of its content tokens occur in one new block, or ≥ 92 % across the page (a block split or re-set with emphasis);
- **lost** — otherwise.

## Totals

| Pages | Blocks | Kept | Rewritten | Lost |
|---|---|---|---|---|
| 90 | 6393 | 6295 | 77 | 21 |

Every one of the 21 "lost" blocks is a recorded language correction (the old machine-glossary string is gone and its corrected form is on the page). No sentence, figure, table row, list item or link was removed.

## The corrections

| Page | Block | Before (base) | Now on the page |
|---|---|---|---|
| ai-dlya-cfo.html | p | База знаний · искусственный интеллект (AI) Automation | База знаний · Искусственный интеллект и автоматизация |
| ai-dlya-cfo.html | p | Обсудите финансовый директор ИИ Transformation или пройдите финансовый рентген — на его основе готовится план  | Обсудите ИИ-трансформацию финансовой функции или пройдите финансовый рентген — на его основе готовится план автоматизации. |
| capacity-released.html | p | FINMENTOR · Геннадий Яковлев · профессиональный журнал финансовый директор | FINMENTOR · Геннадий Яковлев · профессиональный журнал финансового директора |
| cases.html | li | Нет единого вида отчёт о прибыли и убытках (P&L), денежный поток, дебиторки, платежей и ключевые показатели би | Нет единого вида отчёта о прибыли и убытках (P&L), денежного потока, дебиторки, платежей и ключевых показателей бизнеса (KPI). |
| fcf-postavshiki.html | h2 | Как это выглядит в управленческой таблице (FCF by товарная позиция · Панель собственника (Dashboard)) | Как это выглядит в управленческой таблице (FCF by SKU · панель собственника) |
| margin-factor-analysis-flags.html | td | Есть ли ошибки, пропуски, некорректные товарная позиция | Есть ли ошибки, пропуски, некорректные товарные позиции |
| margin-factor-analysis-flags.html | td | Перед решением проверить справочники и товарная позиция | Перед решением проверить справочник товарных позиций |
| margin-factor-analysis-flags.html | li | Склад. Закрывать stock-out по ходовым товарная позиция, чтобы не терять объём и маржу. | Склад. Закрывать stock-out по ходовым товарным позициям, чтобы не терять объём и маржу. |
| margin-factor-analysis-flags.html | td | Товарная позиция, категории, поставщики, сезонность, каналы продаж | Товарные позиции, категории, поставщики, сезонность, каналы продаж |
| margin-factor-analysis-flags.html | td | Товарная позиция Drill-down | SKU Drill-down |
| materials.html | h2 | Финансовый директор Notes | Заметки финансового директора |
| pribyl-vs-cash.html | p | FINMENTOR · Геннадий Яковлев · профессиональный журнал финансовый директор | FINMENTOR · Геннадий Яковлев · профессиональный журнал финансового директора |
| renewal-revenue-at-risk.html | p | FINMENTOR · Геннадий Яковлев · профессиональный журнал финансовый директор | FINMENTOR · Геннадий Яковлев · профессиональный журнал финансового директора |
| retail-margin-engine.html | h2 | Target Marja → Space → Category → товарная позиция → Supplier → Decision | Target Margin → Space → Category → SKU → Supplier → Decision |
| ro/materials.html | h2 | Director financiar Notes | Notele directorului financiar |
| supplier-rating-purchasing-priorities.html | li | Ассортимент. Для каждого ключевого товарная позиция (SKU) фиксировать предпочтительного поставщика и резервног | Ассортимент. Для каждой ключевой товарной позиции (SKU) фиксировать предпочтительного поставщика и резервного. |
| templates.html | h3 | Прибыль и убытки template | Шаблон отчёта о прибылях и убытках |
| templates.html | h3 | Ключевые показатели бизнеса (KPI) панель собственника (Dashboard) | Панель ключевых показателей (KPI Dashboard) |
| templates.html | h3 | Working Capital панель собственника | Панель оборотного капитала (Working Capital) |
| treasury-waterfall.html | td | Owner оптовая торговля / дистрибуция Fund | Owner Distribution Fund |
| treasury-waterfall.html | td | Owner оптовая торговля / дистрибуция Gate | Owner Distribution Gate |

## Per page

| Page | Base blocks | Kept | Rewritten | Lost |
|---|---|---|---|---|
| about.html | 13 | 13 | 0 | 0 |
| ai-agent-economics.html | 41 | 39 | 2 | 0 |
| ai-dlya-cfo.html | 28 | 25 | 1 | 2 |
| budgeting-forecasting.html | 14 | 13 | 1 | 0 |
| business-control-system.html | 41 | 41 | 0 | 0 |
| business-models.html | 52 | 52 | 0 | 0 |
| capacity-released.html | 18 | 15 | 2 | 1 |
| capex-hurdle-rate.html | 121 | 121 | 0 | 0 |
| capital-allocation-value.html | 127 | 127 | 0 | 0 |
| capital-management.html | 41 | 41 | 0 | 0 |
| capital-preservation.html | 35 | 35 | 0 | 0 |
| cases.html | 59 | 56 | 2 | 1 |
| cash-flow.html | 48 | 46 | 2 | 0 |
| cfo-consultation.html | 25 | 25 | 0 | 0 |
| client-base-control-system.html | 61 | 60 | 1 | 0 |
| closed-won-to-cash.html | 108 | 108 | 0 | 0 |
| deal-economics.html | 126 | 126 | 0 | 0 |
| fcf-postavshiki.html | 143 | 128 | 14 | 1 |
| financial-health-check.html | 34 | 32 | 2 | 0 |
| index.html | 91 | 91 | 0 | 0 |
| kaznacheystvo.html | 42 | 42 | 0 | 0 |
| margin-factor-analysis-flags.html | 203 | 194 | 4 | 5 |
| materials.html | 239 | 238 | 0 | 1 |
| methodology.html | 41 | 40 | 1 | 0 |
| monthly-cfo-support.html | 46 | 46 | 0 | 0 |
| owner.html | 80 | 80 | 0 | 0 |
| pipeline-to-cash.html | 112 | 112 | 0 | 0 |
| platezhnyy-kalendar.html | 31 | 31 | 0 | 0 |
| power-bi-dlya-sobstvennika.html | 49 | 47 | 2 | 0 |
| pribyl-vs-cash.html | 23 | 22 | 0 | 1 |
| price-leakage.html | 110 | 110 | 0 | 0 |
| privacy.html | 44 | 44 | 0 | 0 |
| questionnaire.html | 29 | 29 | 0 | 0 |
| real-estate-control-system.html | 24 | 18 | 6 | 0 |
| renewal-revenue-at-risk.html | 35 | 34 | 0 | 1 |
| retail-margin-engine.html | 73 | 64 | 8 | 1 |
| revenue-quality.html | 126 | 126 | 0 | 0 |
| ro/about.html | 13 | 13 | 0 | 0 |
| ro/ai-agent-economics.html | 41 | 41 | 0 | 0 |
| ro/ai-dlya-cfo.html | 28 | 28 | 0 | 0 |
| ro/budgeting-forecasting.html | 15 | 15 | 0 | 0 |
| ro/business-control-system.html | 41 | 41 | 0 | 0 |
| ro/business-models.html | 57 | 57 | 0 | 0 |
| ro/capacity-released.html | 18 | 18 | 0 | 0 |
| ro/capex-hurdle-rate.html | 124 | 124 | 0 | 0 |
| ro/capital-allocation-value.html | 129 | 129 | 0 | 0 |
| ro/capital-management.html | 41 | 41 | 0 | 0 |
| ro/capital-preservation.html | 35 | 35 | 0 | 0 |
| ro/cases.html | 59 | 59 | 0 | 0 |
| ro/cash-flow.html | 48 | 48 | 0 | 0 |
| ro/cfo-consultation.html | 25 | 25 | 0 | 0 |
| ro/client-base-control-system.html | 62 | 62 | 0 | 0 |
| ro/closed-won-to-cash.html | 107 | 107 | 0 | 0 |
| ro/deal-economics.html | 132 | 132 | 0 | 0 |
| ro/fcf-postavshiki.html | 151 | 151 | 0 | 0 |
| ro/financial-health-check.html | 34 | 34 | 0 | 0 |
| ro/index.html | 99 | 99 | 0 | 0 |
| ro/kaznacheystvo.html | 43 | 43 | 0 | 0 |
| ro/margin-factor-analysis-flags.html | 214 | 210 | 4 | 0 |
| ro/materials.html | 246 | 245 | 0 | 1 |
| ro/methodology.html | 41 | 41 | 0 | 0 |
| ro/monthly-cfo-support.html | 47 | 47 | 0 | 0 |
| ro/owner.html | 87 | 87 | 0 | 0 |
| ro/pipeline-to-cash.html | 114 | 114 | 0 | 0 |
| ro/platezhnyy-kalendar.html | 31 | 31 | 0 | 0 |
| ro/power-bi-dlya-sobstvennika.html | 49 | 49 | 0 | 0 |
| ro/pribyl-vs-cash.html | 23 | 23 | 0 | 0 |
| ro/price-leakage.html | 117 | 117 | 0 | 0 |
| ro/privacy.html | 44 | 44 | 0 | 0 |
| ro/questionnaire.html | 29 | 29 | 0 | 0 |
| ro/real-estate-control-system.html | 24 | 24 | 0 | 0 |
| ro/renewal-revenue-at-risk.html | 35 | 35 | 0 | 0 |
| ro/retail-margin-engine.html | 77 | 77 | 0 | 0 |
| ro/revenue-quality.html | 131 | 131 | 0 | 0 |
| ro/supplier-rating-purchasing-priorities.html | 122 | 122 | 0 | 0 |
| ro/supplier-shelf-credit.html | 18 | 18 | 0 | 0 |
| ro/templates.html | 43 | 43 | 0 | 0 |
| ro/terms.html | 28 | 28 | 0 | 0 |
| ro/treasury-waterfall.html | 281 | 281 | 0 | 0 |
| ro/upravlencheskiy-pl.html | 33 | 33 | 0 | 0 |
| ro/working-capital-scan.html | 26 | 26 | 0 | 0 |
| ro/working-capital.html | 93 | 93 | 0 | 0 |
| supplier-rating-purchasing-priorities.html | 114 | 110 | 3 | 1 |
| supplier-shelf-credit.html | 18 | 18 | 0 | 0 |
| templates.html | 42 | 38 | 1 | 3 |
| terms.html | 27 | 27 | 0 | 0 |
| treasury-waterfall.html | 269 | 254 | 13 | 2 |
| upravlencheskiy-pl.html | 33 | 27 | 6 | 0 |
| working-capital-scan.html | 17 | 17 | 0 | 0 |
| working-capital.html | 85 | 83 | 2 | 0 |

## Other preservation gates

- `qa/content-migration.check.mjs` — the homepage/hub migration contract ("nothing lost").
- `qa/financial-map.qa.mjs` — the Financial Map: 24 stages, 4 chapters + foundation, 10 principles, 34 library items, per language.
- Form machine-control signatures (`qa/premium-typography.test.mjs`, `qa/editorial-production.test.mjs`) — the X-Ray questionnaire's 409 controls are byte-identical.
- SEO — per page in PAGE_BY_PAGE_ACCEPTANCE.md (title, description, canonical, hreflang, robots, JSON-LD identical to the base).
