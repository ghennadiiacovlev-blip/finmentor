# Terminology review register — customer-visible English in RU and RO

**Date:** 2026-09-07 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Baseline:** `43b1f2a`
**Status:** EXTRACTION AND PROPOSALS ONLY — nothing in this register has been applied to any
customer-facing file. No production change, no deployment.

---

## 1. Executive summary

This is a human-review input, not another automatic replacement pass. The previous attempt to
close this gap mechanically produced half-translated copy — `Business Система`,
`Monthly Собственник Отчёт`, `at Риск` — and was reverted. The failure mode was always the
same: a generic one-word rule firing inside a longer English phrase that was not itself in the
glossary. **The translation unit has to be the complete economic expression**, which is a
judgement a person makes once and a machine then applies safely.

What this register does is make that review finite. Of 858 distinct term/language rows,
**140 distinct terms sit on the primary customer journey** and the owner-approval table in §9
reduces the commercially critical decisions to 50 rows.

    DISTINCT ROWS        = 858   (RU 522 · RO 336)
    TOTAL OCCURRENCES    = 2766
    TIER 1 (customer core)      = 226 rows · 140 distinct terms · 1459 occurrences
    TIER 2 (commercial pages)   = 552 rows · 1118 occurrences
    TIER 3 (knowledge long tail) = 80 rows · 189 occurrences

**Excluded by rule and never counted:** code, filenames, URLs, slugs, ids, analytics event
names, callback data, machine enums, workflow states and schema keys. `og:type`, `twitter:card`
and every URL-bearing meta tag are machine values, not customer language. The one approved
English parenthetical already shipped in `43b1f2a` is also not counted as a residual.

## 2. Counts by language

| language | distinct rows | occurrences |
|---|---|---|
| RU | 522 | 1580 |
| RO | 336 | 1186 |

## 3. Counts by surface

| surface | distinct rows |
|---|---|
| PROSE | 593 |
| CARD | 344 |
| JSON_LD | 88 |
| OPEN_GRAPH | 86 |
| TWITTER | 85 |
| META | 81 |
| CTA | 23 |
| TITLE | 14 |
| BUTTON | 13 |
| ARIA | 11 |
| FORMULA | 10 |

## 4. Counts by classification

| class | meaning | rows |
|---|---|---|
| A | MUST_LOCALIZE | 698 |
| B | LOCALIZE_WITH_ENGLISH_ONCE | 69 |
| E | OWNER_DECISION_REQUIRED | 41 |
| C | APPROVED_PROPER_NAME | 36 |
| F | BRANDED_PACKAGE_NAME | 8 |
| H | DETECTOR_FALSE_POSITIVE | 4 |
| G | APPROVED_SOFTWARE_PRODUCT | 2 |

`APPROVED_PROPER_NAME` currently contains **Power BI only**. No FINMENTOR module name has been
placed in that class: every one is an explicit owner decision in §8.

## 5. TIER 1 — customer core

Strict definition, per the owner: homepage, main navigation, primary CTAs, questionnaire and its
confirmation, the Concierge and Mini App customer paths, the X-Ray customer result, the main
service blocks linked from the homepage, the contact path, the privacy text shown during the
journey, and the SEO/social title and description for those pages. **JSON-LD alone never confers
Tier 1.**

| term | lang | class | occ | importance | RU proposal | RO proposal | EN once | owner decision |
|---|---|---|---|---|---|---|---|---|
| P&L | RO | LOCALIZE_WITH_ENGLISH_ONCE | 114 | CRITICAL | Отчёт о прибыли и убытках | Cont de profit și pierdere | YES | APPROVED |
| P&L | RU | LOCALIZE_WITH_ENGLISH_ONCE | 63 | CRITICAL | Отчёт о прибыли и убытках | Cont de profit și pierdere | YES | APPROVED |
| Cash Flow | RU | LOCALIZE_WITH_ENGLISH_ONCE | 53 | CRITICAL | Денежный поток | Flux de numerar | YES | APPROVED |
| Cash Flow | RO | LOCALIZE_WITH_ENGLISH_ONCE | 53 | CRITICAL | Денежный поток | Flux de numerar | YES | APPROVED |
| Discovery Call | RU | LOCALIZE_WITH_ENGLISH_ONCE | 39 | CRITICAL | Первичный финансовый разбор | Discuție financiară inițială | NO | APPROVED |
| Discovery Call | RO | LOCALIZE_WITH_ENGLISH_ONCE | 39 | CRITICAL | Первичный финансовый разбор | Discuție financiară inițială | NO | APPROVED |
| CFO | RO | MUST_LOCALIZE | 29 | CRITICAL | Финансовый директор | Director financiar | NO | APPROVED |
| Business Control System | RU | OWNER_DECISION_REQUIRED | 26 | CRITICAL | Система финансового управления бизнесом | Sistem de management financiar al afacerii | YES | APPROVED |
| Business Control System | RO | OWNER_DECISION_REQUIRED | 26 | CRITICAL | Система финансового управления бизнесом | Sistem de management financiar al afacerii | YES | APPROVED |
| CFO | RU | MUST_LOCALIZE | 19 | CRITICAL | Финансовый директор | Director financiar | NO | APPROVED |
| KPI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 15 | CRITICAL | Ключевые показатели бизнеса | Indicatori-cheie de performanță | YES | APPROVED |
| KPI | RO | LOCALIZE_WITH_ENGLISH_ONCE | 15 | CRITICAL | Ключевые показатели бизнеса | Indicatori-cheie de performanță | YES | APPROVED |
| Financial Health Check | RU | BRANDED_PACKAGE_NAME | 13 | CRITICAL | Financial Health Check | Financial Health Check | NO | BRANDED_PACKAGE_NAME |
| Financial Health Check | RO | BRANDED_PACKAGE_NAME | 13 | CRITICAL | Financial Health Check | Financial Health Check | NO | BRANDED_PACKAGE_NAME |
| Control Light | RU | BRANDED_PACKAGE_NAME | 11 | CRITICAL | Control Light | Control Light | NO | BRANDED_PACKAGE_NAME |
| AI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | CRITICAL | Искусственный интеллект | Inteligență artificială | YES | APPROVED |
| DPO | RU | LOCALIZE_WITH_ENGLISH_ONCE | 45 | HIGH | Средний срок оплаты поставщикам | Termenul mediu de plată către furnizori | YES | APPROVED |
| DPO | RO | LOCALIZE_WITH_ENGLISH_ONCE | 45 | HIGH | Средний срок оплаты поставщикам | Termenul mediu de plată către furnizori | YES | APPROVED |
| Email | RU | MUST_LOCALIZE | 34 | HIGH | E-mail | E-mail | NO | APPROVED |
| Email | RO | MUST_LOCALIZE | 34 | HIGH | E-mail | E-mail | NO | APPROVED |
| FCF | RO | LOCALIZE_WITH_ENGLISH_ONCE | 34 | HIGH | Свободный денежный поток | Flux de numerar liber | YES | APPROVED |
| FCF | RU | LOCALIZE_WITH_ENGLISH_ONCE | 33 | HIGH | Свободный денежный поток | Flux de numerar liber | YES | APPROVED |
| DSO | RU | LOCALIZE_WITH_ENGLISH_ONCE | 26 | HIGH | Средний срок оплаты от клиентов | Termenul mediu de încasare de la clienți | YES | APPROVED |
| DSO | RO | LOCALIZE_WITH_ENGLISH_ONCE | 26 | HIGH | Средний срок оплаты от клиентов | Termenul mediu de încasare de la clienți | YES | APPROVED |
| promo | RU | MUST_LOCALIZE | 21 | HIGH | промоакция | promoție | NO | APPROVED |
| Sheets | RO | APPROVED_PROPER_NAME | 19 | HIGH | Google Sheets | Google Sheets | NO | APPROVED |
| Cash | RU | MUST_LOCALIZE | 18 | HIGH | Денежные средства | Disponibilități bănești | NO | APPROVED |
| Cash | RO | MUST_LOCALIZE | 18 | HIGH | Денежные средства | Disponibilități bănești | NO | APPROVED |
| Make | RU | APPROVED_SOFTWARE_PRODUCT | 17 | HIGH | Make | Make | NO | APPROVED_SOFTWARE_PRODUCT |
| retrobonus | RU | MUST_LOCALIZE | 17 | HIGH | ретробонус | bonus retroactiv | NO | APPROVED |
| Make | RO | APPROVED_SOFTWARE_PRODUCT | 17 | HIGH | Make | Make | NO | APPROVED_SOFTWARE_PRODUCT |
| Cash Saving | RU | LOCALIZE_WITH_ENGLISH_ONCE | 16 | HIGH | Фактическая экономия денежных средств | Economie efectivă de numerar | YES | APPROVED |
| cash flow | RU | LOCALIZE_WITH_ENGLISH_ONCE | 16 | HIGH | денежный поток | flux de numerar | YES | AUTO_RESOLVED |
| Cash Saving | RO | LOCALIZE_WITH_ENGLISH_ONCE | 16 | HIGH | Фактическая экономия денежных средств | Economie efectivă de numerar | YES | APPROVED |
| Client Base Control System | RU | OWNER_DECISION_REQUIRED | 15 | HIGH | Система управления клиентской базой | Sistem de management al bazei de clienți | YES | APPROVED |
| Funding Gap | RU | OWNER_DECISION_REQUIRED | 13 | HIGH | Дефицит финансирования | Deficit de finanțare | YES | APPROVED |
| Funding Gap | RO | OWNER_DECISION_REQUIRED | 13 | HIGH | Дефицит финансирования | Deficit de finanțare | YES | APPROVED |
| Light | RO | OWNER_DECISION_REQUIRED | 12 | HIGH | — | — | NO | NOT_STANDALONE |
| Full Cost | RU | LOCALIZE_WITH_ENGLISH_ONCE | 11 | HIGH | Полная стоимость | Cost total | YES | APPROVED |
| BI | RU | MUST_LOCALIZE | 11 | HIGH | Управленческая аналитика | Analiză managerială | NO | APPROVED |
| vacancy | RU | MUST_LOCALIZE | 11 | HIGH | Доля свободных площадей | Grad de neocupare | NO | APPROVED |
| Retail | RU | MUST_LOCALIZE | 11 | HIGH | Розничная торговля | Comerț cu amănuntul | NO | APPROVED |
| Full Cost | RO | LOCALIZE_WITH_ENGLISH_ONCE | 11 | HIGH | Полная стоимость | Cost total | YES | APPROVED |
| Retail | RO | MUST_LOCALIZE | 11 | HIGH | Розничная торговля | Comerț cu amănuntul | NO | APPROVED |
| CFO- | RU | MUST_LOCALIZE | 10 | HIGH | — | — | NO | NOT_STANDALONE |
| Inventory Days | RU | LOCALIZE_WITH_ENGLISH_ONCE | 10 | HIGH | Период оборачиваемости запасов, дней | Durata de rotație a stocurilor | YES | APPROVED |
| cash gap | RU | MUST_LOCALIZE | 10 | HIGH | Кассовый разрыв | Deficit temporar de lichiditate | NO | APPROVED |
| email | RU | MUST_LOCALIZE | 10 | HIGH | E-mail | E-mail | NO | APPROVED |
| Owner | RO | MUST_LOCALIZE | 10 | HIGH | Собственник | Proprietar | NO | APPROVED |
| Inventory Days | RO | LOCALIZE_WITH_ENGLISH_ONCE | 10 | HIGH | Период оборачиваемости запасов, дней | Durata de rotație a stocurilor | YES | APPROVED |
| Owner | RU | MUST_LOCALIZE | 9 | HIGH | Собственник | Proprietar | NO | APPROVED |
| Retail Margin Engine | RU | OWNER_DECISION_REQUIRED | 7 | MEDIUM | Система управления маржой в рознице | Sistem de management al marjei în retail | YES | APPROVED |
| tenant rating | RU | MUST_LOCALIZE | 7 | MEDIUM | Рейтинг надёжности арендаторов | Evaluarea fiabilității chiriașilor | NO | APPROVED |
| NOI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 7 | MEDIUM | Чистый операционный доход | Venit operațional net | YES | APPROVED |
| rent vs market | RU | MUST_LOCALIZE | 7 | MEDIUM | Арендная ставка относительно рынка | Chiria raportată la nivelul pieței | NO | APPROVED |
| Retail Margin Engine | RO | OWNER_DECISION_REQUIRED | 7 | MEDIUM | Система управления маржой в рознице | Sistem de management al marjei în retail | YES | APPROVED |
| NOI | RO | LOCALIZE_WITH_ENGLISH_ONCE | 7 | MEDIUM | Чистый операционный доход | Venit operațional net | YES | APPROVED |
| ERP | RU | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Корпоративная учётная система | Sistem integrat de gestiune | YES | APPROVED |
| Margin Gap | RU | OWNER_DECISION_REQUIRED | 6 | MEDIUM | Отклонение маржи от целевой | Abaterea marjei față de țintă | YES | APPROVED |
| ERP | RO | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Корпоративная учётная система | Sistem integrat de gestiune | YES | APPROVED |
| Margin Gap | RO | OWNER_DECISION_REQUIRED | 6 | MEDIUM | Отклонение маржи от целевой | Abaterea marjei față de țintă | YES | APPROVED |
| Control System | RU | OWNER_DECISION_REQUIRED | 5 | MEDIUM | Система финансового контроля | Sistem de control financiar | YES | APPROVED |
| Standard | RU | BRANDED_PACKAGE_NAME | 4 | MEDIUM | Standard | Standard | NO | BRANDED_PACKAGE_NAME |
| ROI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Рентабельность инвестиций | Rentabilitatea investiției | YES | APPROVED |
| ROI | RO | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Рентабельность инвестиций | Rentabilitatea investiției | YES | APPROVED |
| Sheets | RU | APPROVED_PROPER_NAME | 3 | MEDIUM | Google Sheets | Google Sheets | NO | APPROVED |
| Fitness Membership Renewal Engine | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Система продления абонементов | Sistem de reînnoire a abonamentelor | YES | APPROVED |
| Target Marja | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Целевая маржа | Marjă țintă | NO | APPROVED |
| Fitness | RU | MUST_LOCALIZE | 3 | MEDIUM | Фитнес / спортивный бизнес | Fitness / activități sportive | NO | APPROVED |
| light- | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Premium | RU | BRANDED_PACKAGE_NAME | 3 | MEDIUM | Premium | Premium | NO | BRANDED_PACKAGE_NAME |
| cookies | RU | MUST_LOCALIZE | 3 | MEDIUM | файлы cookie | fișiere cookie | NO | APPROVED |
| OpenAI | RU | APPROVED_PROPER_NAME | 3 | MEDIUM | OpenAI | OpenAI | NO | BRAND |
| NDA | RU | LOCALIZE_WITH_ENGLISH_ONCE | 3 | MEDIUM | Соглашение о конфиденциальности | Acord de confidențialitate | YES | APPROVED |
| Monthly | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Fitness Membership Renewal Engine | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Система продления абонементов | Sistem de reînnoire a abonamentelor | YES | APPROVED |
| Target Marja | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Целевая маржа | Marjă țintă | NO | APPROVED |
| Fitness | RO | MUST_LOCALIZE | 3 | MEDIUM | Фитнес / спортивный бизнес | Fitness / activități sportive | NO | APPROVED |
| OpenAI | RO | APPROVED_PROPER_NAME | 3 | MEDIUM | OpenAI | OpenAI | NO | BRAND |
| NDA | RO | LOCALIZE_WITH_ENGLISH_ONCE | 3 | MEDIUM | Соглашение о конфиденциальности | Acord de confidențialitate | YES | APPROVED |
| Spend | RU | MUST_LOCALIZE | 2 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Automation | RU | MUST_LOCALIZE | 2 | MEDIUM | Автоматизация | Automatizare | NO | APPROVED |
| Telegram- | RU | MUST_LOCALIZE | 2 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Monthly owner report | RU | OWNER_DECISION_REQUIRED | 2 | MEDIUM | Ежемесячный отчёт для собственника | Raport lunar pentru proprietar | YES | APPROVED |
| Limb | RU | DETECTOR_FALSE_POSITIVE | 2 | MEDIUM | — | — | NO | FALSE_POSITIVE |
| risk traffic light | RU | MUST_LOCALIZE | 2 | MEDIUM | Индикатор риска | Indicator de risc | NO | APPROVED |
| profitability | RU | MUST_LOCALIZE | 2 | MEDIUM | Прибыльность товарной позиции | Profitabilitatea pe produs | NO | APPROVED |
| Monthly | RU | MUST_LOCALIZE | 2 | MEDIUM | — | — | NO | NOT_STANDALONE |
| action list | RU | MUST_LOCALIZE | 2 | MEDIUM | План действий | Plan de acțiune | NO | APPROVED |
| Digital | RU | MUST_LOCALIZE | 2 | MEDIUM | Цифровые решения | Soluții digitale | NO | APPROVED |
| mini-scan | RU | MUST_LOCALIZE | 2 | MEDIUM | Экспресс-диагностика | Diagnostic rapid | NO | APPROVED |
| Zoom | RU | APPROVED_PROPER_NAME | 2 | MEDIUM | Zoom | Zoom | NO | BRAND |
| Spend | RO | MUST_LOCALIZE | 2 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Automation | RO | MUST_LOCALIZE | 2 | MEDIUM | Автоматизация | Automatizare | NO | APPROVED |
| Monthly owner report | RO | OWNER_DECISION_REQUIRED | 2 | MEDIUM | Ежемесячный отчёт для собственника | Raport lunar pentru proprietar | YES | APPROVED |
| Zoom | RO | APPROVED_PROPER_NAME | 2 | MEDIUM | Zoom | Zoom | NO | BRAND |
| Selectarea limbii | RU | DETECTOR_FALSE_POSITIVE | 1 | MEDIUM | — | — | NO | FALSE_POSITIVE |
| ROM | RU | DETECTOR_FALSE_POSITIVE | 1 | MEDIUM | — | — | NO | FALSE_POSITIVE |
| SCROLL | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Cap Rate | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Ставка капитализации | Rata de capitalizare | YES | APPROVED |
| deposit coverage | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| payback | RU | MUST_LOCALIZE | 1 | MEDIUM | срок окупаемости | perioada de recuperare a investiției | YES | AUTO_RESOLVED |
| RETAIL ENGINE | RU | OWNER_DECISION_REQUIRED | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| margin per meter | RU | MUST_LOCALIZE | 1 | MEDIUM | Маржа на 1 м² | Marjă pe m² | NO | APPROVED |
| promo economics | RU | MUST_LOCALIZE | 1 | MEDIUM | Эффективность промоакции | Eficiența promoției | NO | APPROVED |
| Unit economics | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Экономика единицы продукта | Economia pe unitate | YES | APPROVED |
| ROAS | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Рентабельность рекламных расходов | Rentabilitatea cheltuielilor de publicitate | YES | APPROVED |
| CAC | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Стоимость привлечения клиента | Costul de achiziție a clientului | YES | APPROVED |
| LTV | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Ценность клиента за весь период сотрудничества | Valoarea clientului pe durata relației | YES | APPROVED |
| e-commerce | RU | MUST_LOCALIZE | 1 | MEDIUM | интернет-торговля | comerț online | NO | AUTO_RESOLVED |
| Manufacturing | RU | MUST_LOCALIZE | 1 | MEDIUM | Производство | Producție | NO | APPROVED |
| Support | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| review | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Treasury & Payment Discipline | RU | OWNER_DECISION_REQUIRED | 1 | MEDIUM | — | — | YES | NOT_STANDALONE |
| Fund Planning & Payment Waterfall | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Working Capital Control | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Analysis | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| cash destroyers | RU | MUST_LOCALIZE | 1 | MEDIUM | Товарные позиции, поглощающие денежные средства | Produse care consumă numerar | NO | APPROVED |
| Supplier Rating & Procurement Control | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Margin Factor Analysis | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Power BI Owner | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| DIGITAL LABOUR CONTROL | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| ChatGPT | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | ChatGPT | ChatGPT | NO | BRAND |
| Copilot | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Copilot | Copilot | NO | BRAND |
| Claude | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Claude | Claude | NO | BRAND |
| Accepted Business Outcome | RU | MUST_LOCALIZE | 1 | MEDIUM | Результат, принятый бизнесом | Rezultat acceptat de companie | NO | APPROVED |
| Financial Effect | RU | MUST_LOCALIZE | 1 | MEDIUM | Финансовый эффект | Impact financiar | NO | APPROVED |
| Management Decision | RU | MUST_LOCALIZE | 1 | MEDIUM | Управленческое решение | Decizie managerială | NO | APPROVED |
| Diagnostic memo | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Risk map | RU | MUST_LOCALIZE | 1 | MEDIUM | Карта финансовых рисков | Harta riscurilor financiare | NO | APPROVED |
| quick wins | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Document checklist | RU | MUST_LOCALIZE | 1 | MEDIUM | Список необходимых документов | Lista documentelor necesare | NO | APPROVED |
| structure | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Payment calendar logic | RU | MUST_LOCALIZE | 1 | MEDIUM | Логика платёжного календаря | Logica calendarului de plăți | NO | APPROVED |
| Action plan | RU | MUST_LOCALIZE | 1 | MEDIUM | План действий | Plan de acțiune | NO | APPROVED |
| concept | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Recommendation | RU | MUST_LOCALIZE | 1 | MEDIUM | Рекомендация FINMENTOR | Recomandarea FINMENTOR | NO | APPROVED |
| Bank statements | RU | MUST_LOCALIZE | 1 | MEDIUM | Банковские выписки | Extrase bancare | NO | APPROVED |
| AP aging | RU | MUST_LOCALIZE | 1 | MEDIUM | Анализ кредиторской задолженности по срокам | Analiza datoriilor către furnizori pe scadențe | NO | APPROVED |
| AR | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Owner view | RU | MUST_LOCALIZE | 1 | MEDIUM | Взгляд собственника | Perspectiva proprietarului | NO | APPROVED |
| IFRS- | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Big | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cash flow & treasury control | RU | MUST_LOCALIZE | 1 | MEDIUM | Управление денежным потоком и казначейством | Gestionarea fluxului de numerar și a trezoreriei | NO | APPROVED |
| triage | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Iacovlev Ghennadi | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Iacovlev Ghennadi | Iacovlev Ghennadi | NO | BRAND |
| questionnaire | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| working-capital-scan | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| rule-based | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Analytics | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Google Analytics | Google Analytics | NO | BRAND |
| score | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GitHub Pages | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | GitHub Pages | GitHub Pages | NO | BRAND |
| email- | RU | MUST_LOCALIZE | 1 | MEDIUM | e-mail | e-mail | NO | AUTO_RESOLVED |
| Financial X-Ray | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cookies | RU | MUST_LOCALIZE | 1 | MEDIUM | Файлы cookie | Fișiere cookie | NO | APPROVED |
| GMT | RU | MUST_LOCALIZE | 1 | MEDIUM | GMT | GMT | NO | APPROVED |
| Services | RU | MUST_LOCALIZE | 1 | MEDIUM | Услуги | Servicii | NO | APPROVED |
| Other | RU | MUST_LOCALIZE | 1 | MEDIUM | Другое | Altele | NO | APPROVED |
| Google Meet | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Google Meet | Google Meet | NO | BRAND |
| Microsoft Teams | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Microsoft Teams | Microsoft Teams | NO | BRAND |
| Telegram call | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Telegram call | Telegram call | NO | BRAND |
| HoReCa | RU | MUST_LOCALIZE | 1 | MEDIUM | HoReCa | HoReCa | NO | APPROVED |
| Excel- | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Tableau | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Tableau | Tableau | NO | BRAND |
| Looker | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Looker | Looker | NO | BRAND |
| Zapier | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Zapier | Zapier | NO | BRAND |
| Meet | RU | MUST_LOCALIZE | 1 | MEDIUM | встреча | întâlnire | NO | APPROVED |
| Email summary | RU | MUST_LOCALIZE | 1 | MEDIUM | Итоги встречи по e-mail | Sinteza întâlnirii prin e-mail | NO | APPROVED |
| Google Drive | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Google Drive | Google Drive | NO | BRAND |
| Microsoft OneDrive | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Microsoft OneDrive | Microsoft OneDrive | NO | BRAND |
| Dropbox | RU | APPROVED_PROPER_NAME | 1 | MEDIUM | Dropbox | Dropbox | NO | BRAND |
| intake | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| webhook FINMENTOR | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GA | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Limb | RO | DETECTOR_FALSE_POSITIVE | 1 | MEDIUM | — | — | NO | FALSE_POSITIVE |
| SCROLL | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Cap Rate | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Ставка капитализации | Rata de capitalizare | YES | APPROVED |
| RETAIL ENGINE | RO | OWNER_DECISION_REQUIRED | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Unit economics | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Экономика единицы продукта | Economia pe unitate | YES | APPROVED |
| ROAS | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Рентабельность рекламных расходов | Rentabilitatea cheltuielilor de publicitate | YES | APPROVED |
| CAC | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Стоимость привлечения клиента | Costul de achiziție a clientului | YES | APPROVED |
| LTV | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Ценность клиента за весь период сотрудничества | Valoarea clientului pe durata relației | YES | APPROVED |
| Manufacturing | RO | MUST_LOCALIZE | 1 | MEDIUM | Производство | Producție | NO | APPROVED |
| Support | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Treasury & Payment Discipline | RO | OWNER_DECISION_REQUIRED | 1 | MEDIUM | — | — | YES | NOT_STANDALONE |
| Fund Planning & Payment Waterfall | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Working Capital Control | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Analysis | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Supplier Rating & Procurement Control | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Margin Factor Analysis | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| Power BI Owner | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NOT_STANDALONE |
| ChatGPT | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | ChatGPT | ChatGPT | NO | BRAND |
| Copilot | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Copilot | Copilot | NO | BRAND |
| Claude | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Claude | Claude | NO | BRAND |
| Accepted Business Outcome | RO | MUST_LOCALIZE | 1 | MEDIUM | Результат, принятый бизнесом | Rezultat acceptat de companie | NO | APPROVED |
| Financial Effect | RO | MUST_LOCALIZE | 1 | MEDIUM | Финансовый эффект | Impact financiar | NO | APPROVED |
| Management Decision | RO | MUST_LOCALIZE | 1 | MEDIUM | Управленческое решение | Decizie managerială | NO | APPROVED |
| Risk map | RO | MUST_LOCALIZE | 1 | MEDIUM | Карта финансовых рисков | Harta riscurilor financiare | NO | APPROVED |
| Document checklist | RO | MUST_LOCALIZE | 1 | MEDIUM | Список необходимых документов | Lista documentelor necesare | NO | APPROVED |
| Payment calendar logic | RO | MUST_LOCALIZE | 1 | MEDIUM | Логика платёжного календаря | Logica calendarului de plăți | NO | APPROVED |
| Action plan | RO | MUST_LOCALIZE | 1 | MEDIUM | План действий | Plan de acțiune | NO | APPROVED |
| Recommendation | RO | MUST_LOCALIZE | 1 | MEDIUM | Рекомендация FINMENTOR | Recomandarea FINMENTOR | NO | APPROVED |
| Bank statements | RO | MUST_LOCALIZE | 1 | MEDIUM | Банковские выписки | Extrase bancare | NO | APPROVED |
| AP aging | RO | MUST_LOCALIZE | 1 | MEDIUM | Анализ кредиторской задолженности по срокам | Analiza datoriilor către furnizori pe scadențe | NO | APPROVED |
| Owner view | RO | MUST_LOCALIZE | 1 | MEDIUM | Взгляд собственника | Perspectiva proprietarului | NO | APPROVED |
| Cash flow & treasury control | RO | MUST_LOCALIZE | 1 | MEDIUM | Управление денежным потоком и казначейством | Gestionarea fluxului de numerar și a trezoreriei | NO | APPROVED |
| Iacovlev Ghennadi | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Iacovlev Ghennadi | Iacovlev Ghennadi | NO | BRAND |
| Google Analytics | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Google Analytics | Google Analytics | NO | BRAND |
| GitHub Pages | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | GitHub Pages | GitHub Pages | NO | BRAND |
| Cookies | RO | MUST_LOCALIZE | 1 | MEDIUM | Файлы cookie | Fișiere cookie | NO | APPROVED |
| GMT | RO | MUST_LOCALIZE | 1 | MEDIUM | GMT | GMT | NO | APPROVED |
| Services | RO | MUST_LOCALIZE | 1 | MEDIUM | Услуги | Servicii | NO | APPROVED |
| Other | RO | MUST_LOCALIZE | 1 | MEDIUM | Другое | Altele | NO | APPROVED |
| Rom | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Meet | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Google Meet | Google Meet | NO | BRAND |
| Microsoft Teams | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Microsoft Teams | Microsoft Teams | NO | BRAND |
| Telegram call | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Telegram call | Telegram call | NO | BRAND |
| HoReCa | RO | MUST_LOCALIZE | 1 | MEDIUM | HoReCa | HoReCa | NO | APPROVED |
| Tableau | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Tableau | Tableau | NO | BRAND |
| Looker | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Looker | Looker | NO | BRAND |
| Zapier | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Zapier | Zapier | NO | BRAND |
| Meet | RO | MUST_LOCALIZE | 1 | MEDIUM | встреча | întâlnire | NO | APPROVED |
| Email summary | RO | MUST_LOCALIZE | 1 | MEDIUM | Итоги встречи по e-mail | Sinteza întâlnirii prin e-mail | NO | APPROVED |
| Google Drive | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Google Drive | Google Drive | NO | BRAND |
| Microsoft OneDrive | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Microsoft OneDrive | Microsoft OneDrive | NO | BRAND |
| Dropbox | RO | APPROVED_PROPER_NAME | 1 | MEDIUM | Dropbox | Dropbox | NO | BRAND |

## 6. TIER 2 — commercial specialist pages

AI economics, retail modules, investment, real estate, treasury and the other commercial
modules. Reachable, commercially meaningful, but not on the first-contact path.

| term | lang | class | occ | importance | RU proposal | RO proposal | EN once | owner decision |
|---|---|---|---|---|---|---|---|---|
| Payment Gate | RU | OWNER_DECISION_REQUIRED | 15 | HIGH | Контроль платежей | Controlul plăților | YES | APPROVED |
| Payment Gate | RO | OWNER_DECISION_REQUIRED | 15 | HIGH | Контроль платежей | Controlul plăților | YES | APPROVED |
| Revenue at Risk | RU | OWNER_DECISION_REQUIRED | 14 | HIGH | Выручка под риском | Venituri expuse riscului | YES | APPROVED |
| Revenue at Risk | RO | OWNER_DECISION_REQUIRED | 14 | HIGH | Выручка под риском | Venituri expuse riscului | YES | APPROVED |
| Expected Renewal Value | RU | OWNER_DECISION_REQUIRED | 13 | HIGH | Ожидаемая выручка от продлений | Venituri așteptate din reînnoiri | YES | APPROVED |
| Expected Renewal Value | RO | OWNER_DECISION_REQUIRED | 13 | HIGH | Ожидаемая выручка от продлений | Venituri așteptate din reînnoiri | YES | APPROVED |
| dashboard | RU | MUST_LOCALIZE | 12 | HIGH | панель собственника | tablou de bord | NO | APPROVED |
| SKU | RU | LOCALIZE_WITH_ENGLISH_ONCE | 12 | HIGH | Товарная позиция | Articol de stoc | YES | NO |
| Supplier Shelf Credit | RU | OWNER_DECISION_REQUIRED | 12 | HIGH | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | YES | APPROVED |
| SKU | RO | LOCALIZE_WITH_ENGLISH_ONCE | 12 | HIGH | Товарная позиция | Articol de stoc | YES | NO |
| Supplier Shelf Credit | RO | OWNER_DECISION_REQUIRED | 12 | HIGH | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | YES | APPROVED |
| treasury briefing | RU | MUST_LOCALIZE | 11 | HIGH | — | — | NO | NO |
| funding gap | RU | MUST_LOCALIZE | 11 | HIGH | дефицит финансирования | deficit de finanțare | YES | AUTO_RESOLVED |
| Power BI dashboard | RU | MUST_LOCALIZE | 10 | HIGH | — | — | NO | NO |
| Cost Effect | RU | MUST_LOCALIZE | 9 | MEDIUM | Эффект себестоимости | Efectul costului | NO | NO |
| retail | RU | MUST_LOCALIZE | 9 | MEDIUM | розничная торговля | comerț cu amănuntul | NO | APPROVED |
| Price Effect | RU | MUST_LOCALIZE | 8 | MEDIUM | Эффект цены | Efectul prețului | NO | NO |
| CAPEX | RU | LOCALIZE_WITH_ENGLISH_ONCE | 8 | MEDIUM | Капитальные вложения | Investiții de capital | YES | APPROVED |
| Price Effect | RO | MUST_LOCALIZE | 8 | MEDIUM | Эффект цены | Efectul prețului | NO | NO |
| CAPEX | RO | LOCALIZE_WITH_ENGLISH_ONCE | 8 | MEDIUM | Капитальные вложения | Investiții de capital | YES | APPROVED |
| stock-out | RU | MUST_LOCALIZE | 7 | MEDIUM | дефицит товара | lipsă de stoc | NO | NO |
| FINMENTOR Retail Margin Engine | RU | MUST_LOCALIZE | 7 | MEDIUM | — | — | NO | NO |
| Available Cash | RU | LOCALIZE_WITH_ENGLISH_ONCE | 7 | MEDIUM | Доступные деньги | Numerar disponibil | YES | NO |
| FINMENTOR Retail Margin Engine | RO | MUST_LOCALIZE | 7 | MEDIUM | — | — | NO | NO |
| Available Cash | RO | LOCALIZE_WITH_ENGLISH_ONCE | 7 | MEDIUM | Доступные деньги | Numerar disponibil | YES | NO |
| governance | RU | MUST_LOCALIZE | 6 | MEDIUM | управление и контроль | guvernanță și control | NO | NO |
| Accepted Outcome | RU | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Direct CFSKU | RU | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Supplier Financing Benefit | RU | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Выгода от финансирования поставщиком | Beneficiul finanțării de la furnizor | YES | NO |
| COGS | RU | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Себестоимость продаж | Costul bunurilor vândute | YES | NO |
| Volume Effect | RU | MUST_LOCALIZE | 6 | MEDIUM | Эффект объёма | Efectul volumului | NO | NO |
| CFO Control Partner | RU | BRANDED_PACKAGE_NAME | 6 | MEDIUM | CFO Control Partner | CFO Control Partner | NO | BRANDED_PACKAGE_NAME |
| Coverage | RU | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Accepted Outcome | RO | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Supplier Financing Benefit | RO | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Выгода от финансирования поставщиком | Beneficiul finanțării de la furnizor | YES | NO |
| COGS | RO | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Себестоимость продаж | Costul bunurilor vândute | YES | NO |
| CFO Control Partner | RO | BRANDED_PACKAGE_NAME | 6 | MEDIUM | CFO Control Partner | CFO Control Partner | NO | BRANDED_PACKAGE_NAME |
| Coverage | RO | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Control Partner | RU | BRANDED_PACKAGE_NAME | 5 | MEDIUM | Control Partner | Control Partner | NO | BRANDED_PACKAGE_NAME |
| backtest | RU | MUST_LOCALIZE | 5 | MEDIUM | ретропроверка | testare retroactivă | NO | NO |
| Final FCF | RU | MUST_LOCALIZE | 5 | MEDIUM | — | — | NO | NO |
| roadmap | RU | MUST_LOCALIZE | 5 | MEDIUM | план действий | plan de acțiune | YES | AUTO_RESOLVED |
| Mix Effect | RU | MUST_LOCALIZE | 5 | MEDIUM | Эффект структуры продаж | Efectul structurii vânzărilor | NO | NO |
| Data Model | RU | MUST_LOCALIZE | 5 | MEDIUM | Модель данных | Model de date | NO | NO |
| Final FCF | RO | MUST_LOCALIZE | 5 | MEDIUM | — | — | NO | NO |
| Mix Effect | RO | MUST_LOCALIZE | 5 | MEDIUM | Эффект структуры продаж | Efectul structurii vânzărilor | NO | NO |
| Telegram alerts | RU | MUST_LOCALIZE | 4 | MEDIUM | — | — | NO | NO |
| Client Base Control System FINMENTOR | RU | MUST_LOCALIZE | 4 | MEDIUM | — | — | NO | NO |
| Retention Discount Leakage | RU | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Потери на скидках удержания | Pierderi din discounturi de retenție | YES | NO |
| Executive Summary | RU | MUST_LOCALIZE | 4 | MEDIUM | Краткое резюме | Rezumat executiv | NO | NO |
| Mix | RU | MUST_LOCALIZE | 4 | MEDIUM | — | — | NO | NO |
| Real Estate Control System FINMENTOR | RU | MUST_LOCALIZE | 4 | MEDIUM | — | — | NO | NO |
| Real Estate Control System | RU | OWNER_DECISION_REQUIRED | 4 | MEDIUM | Система финансового управления недвижимостью | Sistem de management financiar al activelor imobiliare | YES | APPROVED |
| retail- | RU | MUST_LOCALIZE | 4 | MEDIUM | розничная торговля | comerț cu amănuntul | NO | AUTO_RESOLVED |
| Supplier Rating | RU | MUST_LOCALIZE | 4 | MEDIUM | Рейтинг поставщиков | Ratingul furnizorilor | NO | NO |
| Free Treasury Cash | RU | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Свободные деньги казначейства | Numerar liber de trezorerie | YES | NO |
| Quality | RO | MUST_LOCALIZE | 4 | MEDIUM | — | — | NO | NO |
| Retention Discount Leakage | RO | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Потери на скидках удержания | Pierderi din discounturi de retenție | YES | NO |
| Executive Summary | RO | MUST_LOCALIZE | 4 | MEDIUM | Краткое резюме | Rezumat executiv | NO | NO |
| Supplier Rating | RO | MUST_LOCALIZE | 4 | MEDIUM | Рейтинг поставщиков | Ratingul furnizorilor | NO | NO |
| Free Treasury Cash | RO | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Свободные деньги казначейства | Numerar liber de trezorerie | YES | NO |
| Decision | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Cost | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| out-of-time | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Funding Gap Days | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Financing Cost | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Supplier-Financed | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Финансируется поставщиком | Finanțat de furnizor | YES | APPROVED |
| Own-Funded | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | За счёт собственных средств | Din surse proprii | YES | APPROVED |
| Purchase Gate | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Контроль закупок | Controlul achizițiilor | YES | APPROVED |
| AP Gate | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Green | RU | MUST_LOCALIZE | 3 | MEDIUM | Зелёная зона | Zonă verde | NO | NO |
| Yellow | RU | MUST_LOCALIZE | 3 | MEDIUM | Жёлтая зона | Zonă galbenă | NO | NO |
| Orange | RU | MUST_LOCALIZE | 3 | MEDIUM | Оранжевая зона | Zonă portocalie | NO | NO |
| Red | RU | MUST_LOCALIZE | 3 | MEDIUM | Красная зона | Zonă roșie | NO | NO |
| Control | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Category | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Space | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| supplier credit | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Conditional | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Confirmed Inflows | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Minimum Reserve | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Bank Balance | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Decision | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Transformation | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Funding Gap Days | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Financing Cost | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Supplier-Financed | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Финансируется поставщиком | Finanțat de furnizor | YES | APPROVED |
| Own-Funded | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | За счёт собственных средств | Din surse proprii | YES | APPROVED |
| Purchase Gate | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Контроль закупок | Controlul achizițiilor | YES | APPROVED |
| AP Gate | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Mix | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Green | RO | MUST_LOCALIZE | 3 | MEDIUM | Зелёная зона | Zonă verde | NO | NO |
| Yellow | RO | MUST_LOCALIZE | 3 | MEDIUM | Жёлтая зона | Zonă galbenă | NO | NO |
| Orange | RO | MUST_LOCALIZE | 3 | MEDIUM | Оранжевая зона | Zonă portocalie | NO | NO |
| Red | RO | MUST_LOCALIZE | 3 | MEDIUM | Красная зона | Zonă roșie | NO | NO |
| Category | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Space | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Conditional | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Confirmed Inflows | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Minimum Reserve | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Bank Balance | RO | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Governance | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| PASS | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Volume | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Forecast | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| email alerts | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Treasury | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Cash gap | RU | MUST_LOCALIZE | 2 | LOW | Кассовый разрыв | Deficit temporar de lichiditate | NO | AUTO_RESOLVED |
| tenure | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| recency | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Indicative Revenue at Risk | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| B- | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Working Capital | RU | LOCALIZE_WITH_ENGLISH_ONCE | 2 | LOW | Оборотный капитал | Capital de lucru | YES | NO |
| Generator | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| CFSKU after Fixed Costs | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| lines | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Operating Cycle Days | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Own-Funded Gap Days | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| MAX | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
| Supplier-Funded Days | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |

_432 further Tier 2 rows are in the CSV._

## 7. TIER 3 — knowledge / materials / long tail

80 rows, 189 occurrences, on low-traffic knowledge and materials pages. Full detail in the CSV.
These do not block a release: a reader who reaches them has already converted or is researching
deeply. They should be localised as the content is next revised rather than in a single sweep.

| term | lang | occ | RU proposal |
|---|---|---|---|
| cash conversion cycle | RU | 9 | — |
| DIO | RU | 9 | Срок оборота запасов |
| DIO | RO | 9 | Срок оборота запасов |
| EBITDA | RU | 7 | Прибыль до вычета процентов, налогов и амортизации |
| EBITDA | RO | 7 | Прибыль до вычета процентов, налогов и амортизации |
| Payment Calendar | RU | 6 | Платёжный календарь |
| Payment Calendar | RO | 6 | Платёжный календарь |
| Treasury Fund Planning | RU | 5 | Планирование фондов казначейства |
| Monthly Owner Report | RU | 5 | Ежемесячный отчёт для собственника |
| Investment Model | RU | 5 | Инвестиционная модель |
| Due AP | RU | 5 | Кредиторская задолженность к оплате |
| Treasury Fund Planning | RO | 5 | Планирование фондов казначейства |
| Monthly Owner Report | RO | 5 | Ежемесячный отчёт для собственника |
| Investment Model | RO | 5 | Инвестиционная модель |
| Due AP | RO | 5 | Кредиторская задолженность к оплате |
| KPI Dashboard | RU | 4 | — |
| JS- | RU | 4 | — |
| Recoverable VAT | RU | 4 | НДС к возмещению |
| KPI Dashboard | RO | 4 | — |
| Recoverable VAT | RO | 4 | НДС к возмещению |
| template | RU | 3 | — |
| Collectible AR | RU | 3 | — |
| Collectible AR | RO | 3 | — |
| Cash Conversion Cycle | RU | 2 | Цикл оборота денег |
| slow-moving | RU | 2 | — |
| dead stock | RU | 2 | — |
| Net Working Capital | RU | 2 | — |
| Quality-Adjusted Working Capital | RU | 2 | — |
| Liquid Inventory | RU | 2 | — |
| Cash Conversion Cycle | RO | 2 | Цикл оборота денег |
| Net Working Capital | RO | 2 | — |
| Quality-Adjusted Working Capital | RO | 2 | — |
| Liquid Inventory | RO | 2 | — |
| Rom | RU | 1 | — |
| FINMENTOR CFO- | RU | 1 | — |
| treasury- | RU | 1 | — |
| Notes | RU | 1 | — |
| External CFO | RU | 1 | Внешний финансовый директор |
| Payment Calendar Pro | RU | 1 | — |
| AR Aging Template | RU | 1 | — |

## 8. FINMENTOR module and product names — owner decisions

None of these is assumed to be an approved English product name. Power BI is the only name
currently in that class.

| current name | what it means in plain business language | RU proposal | RO proposal | keep EN in parentheses? | owner decision |
|---|---|---|---|---|---|
| Business Control System | the owner's single control loop over money, profit and risk | Система финансового управления бизнесом | Sistem de management financiar al afacerii | YES | YES |
| Client Base Control System | control over the customer base: who renews, who churns, what it costs | Система управления клиентской базой | Sistem de management al bazei de clienți | YES | YES |
| Payment Gate | the approval step a payment must pass before it is released | Контроль платежей | Controlul plăților | YES | YES |
| Revenue at Risk | revenue that will be lost unless something is done | Выручка под риском | Venituri expuse riscului | YES | YES |
| Funding Gap | the money the business will be short of, and when | Дефицит финансирования | Deficit de finanțare | YES | YES |
| Expected Renewal Value | the money expected from renewals still to come | Ожидаемая выручка от продлений | Venituri așteptate din reînnoiri | YES | YES |
| Supplier Shelf Credit | how much of the stock on the shelf the supplier is really financing | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | YES | YES |
| Retail Margin Engine | how margin is made and lost per shelf, product and supplier | Система управления маржой в рознице | Sistem de management al marjei în retail | YES | YES |
| Margin Gap | the difference between the margin earned and the margin targeted | Отклонение маржи от целевой | Abaterea marjei față de țintă | YES | YES |
| Control System | — | Система финансового контроля | Sistem de control financiar | YES | YES |
| Monthly Owner Report | the monthly report the owner actually reads | Ежемесячный отчёт для собственника | Raport lunar pentru proprietar | YES | YES |
| Real Estate Control System | control over a property portfolio's income, cost and risk | Система финансового управления недвижимостью | Sistem de management financiar al activelor imobiliare | YES | YES |
| Recoverable VAT | VAT the business can get back rather than absorb | НДС к возмещению | TVA de recuperat | YES | YES |
| Fitness Membership Renewal Engine | how memberships renew, and what a lapsed renewal costs | Система продления абонементов | Sistem de reînnoire a abonamentelor | YES | YES |
| Target Marja | — | Целевая маржа | Marjă țintă | NO | YES |
| Supplier-Financed | the part of stock effectively paid for by the supplier | Финансируется поставщиком | Finanțat de furnizor | YES | YES |
| Own-Funded | the part of stock paid for with the company's own money | За счёт собственных средств | Din surse proprii | YES | YES |
| Purchase Gate | the approval step a purchase must pass before money leaves | Контроль закупок | Controlul achizițiilor | YES | YES |
| Monthly owner report | — | Ежемесячный отчёт для собственника | Raport lunar pentru proprietar | YES | YES |
| RETAIL ENGINE | — | — | — | NO | YES |
| Treasury & Payment Discipline | — | — | — | YES | YES |
| Light | — | — | — | NO | YES |

## 9. TOP TIER 1 TERMS FOR OWNER APPROVAL

The commercially critical language, separated from the long tail so it can be approved first.
"Current" is what a customer reads today.

| term | current RU | proposed RU | current RO | proposed RO | EN once? | why it matters | owner decision? |
|---|---|---|---|---|---|---|---|
| P&L | P&L | Отчёт о прибыли и убытках | P&L | Cont de profit și pierdere | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| Cash Flow | Cash Flow | Денежный поток | Cash Flow | Flux de numerar | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| Discovery Call | Discovery Call | Первичный финансовый разбор | Discovery Call | Discuție financiară inițială | NO | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| Business Control System | Business Control System | Система финансового управления бизнесом | Business Control System | Sistem de management financiar al afacerii | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| CFO | CFO | Финансовый директор | CFO | Director financiar | NO | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| KPI | KPI | Ключевые показатели бизнеса | KPI | Indicatori-cheie de performanță | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| Financial Health Check | Financial Health Check | Financial Health Check | Financial Health Check | Financial Health Check | NO | Needed to understand the offer or the next step before contacting FINMENTOR. | BRANDED_PACKAGE_NAME |
| Control Light | Control Light | Control Light | Control Light | Control Light | NO | Needed to understand the offer or the next step before contacting FINMENTOR. | BRANDED_PACKAGE_NAME |
| AI | AI | Искусственный интеллект | AI | Inteligență artificială | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | APPROVED |
| DPO | DPO | Средний срок оплаты поставщикам | DPO | Termenul mediu de plată către furnizori | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Email | Email | E-mail | Email | E-mail | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| FCF | FCF | Свободный денежный поток | FCF | Flux de numerar liber | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| DSO | DSO | Средний срок оплаты от клиентов | DSO | Termenul mediu de încasare de la clienți | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Cash | Cash | Денежные средства | Cash | Disponibilități bănești | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| Make | Make | Make | Make | Make | NO | Appears in a button, card or formula where the customer decides. | APPROVED_SOFTWARE_PRODUCT |
| Cash Saving | Cash Saving | Фактическая экономия денежных средств | Cash Saving | Economie efectivă de numerar | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Funding Gap | Funding Gap | Дефицит финансирования | Funding Gap | Deficit de finanțare | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Sheets | Sheets | Google Sheets | Sheets | Google Sheets | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| Full Cost | Full Cost | Полная стоимость | Full Cost | Cost total | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| Retail | Retail | Розничная торговля | Retail | Comerț cu amănuntul | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| promo | promo | промоакция | promo | promoție | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| Inventory Days | Inventory Days | Период оборачиваемости запасов, дней | Inventory Days | Durata de rotație a stocurilor | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Owner | Owner | Собственник | Owner | Proprietar | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| retrobonus | retrobonus | ретробонус | retrobonus | bonus retroactiv | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| cash flow | cash flow | денежный поток | cash flow | flux de numerar | YES | Appears in a button, card or formula where the customer decides. | AUTO_RESOLVED |
| Client Base Control System | Client Base Control System | Система управления клиентской базой | Client Base Control System | Sistem de management al bazei de clienți | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Light | Light | **needs wording** | Light | **needs wording** | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NOT_STANDALONE |
| BI | BI | Управленческая аналитика | BI | Analiză managerială | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| vacancy | vacancy | Доля свободных площадей | vacancy | Grad de neocupare | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| CFO- | CFO- | **needs wording** | CFO- | **needs wording** | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NOT_STANDALONE |
| cash gap | cash gap | Кассовый разрыв | cash gap | Deficit temporar de lichiditate | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| email | email | E-mail | email | E-mail | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| Retail Margin Engine | Retail Margin Engine | Система управления маржой в рознице | Retail Margin Engine | Sistem de management al marjei în retail | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| NOI | NOI | Чистый операционный доход | NOI | Venit operațional net | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| ERP | ERP | Корпоративная учётная система | ERP | Sistem integrat de gestiune | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Margin Gap | Margin Gap | Отклонение маржи от целевой | Margin Gap | Abaterea marjei față de țintă | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| ROI | ROI | Рентабельность инвестиций | ROI | Rentabilitatea investiției | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| tenant rating | tenant rating | Рейтинг надёжности арендаторов | tenant rating | Evaluarea fiabilității chiriașilor | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| rent vs market | rent vs market | Арендная ставка относительно рынка | rent vs market | Chiria raportată la nivelul pieței | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| Fitness Membership Renewal Engine | Fitness Membership Renewal Engine | Система продления абонементов | Fitness Membership Renewal Engine | Sistem de reînnoire a abonamentelor | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| Target Marja | Target Marja | Целевая маржа | Target Marja | Marjă țintă | NO | Appears in a button, card or formula where the customer decides. | APPROVED |
| Fitness | Fitness | Фитнес / спортивный бизнес | Fitness | Fitness / activități sportive | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| OpenAI | OpenAI | OpenAI | OpenAI | OpenAI | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | BRAND |
| NDA | NDA | Соглашение о конфиденциальности | NDA | Acord de confidențialitate | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| Control System | Control System | Система финансового контроля | Control System | Sistem de control financiar | YES | Appears in a button, card or formula where the customer decides. | APPROVED |
| Monthly | Monthly | **needs wording** | Monthly | **needs wording** | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NOT_STANDALONE |
| Standard | Standard | Standard | Standard | Standard | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | BRANDED_PACKAGE_NAME |
| Spend | Spend | **needs wording** | Spend | **needs wording** | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NOT_STANDALONE |
| Automation | Automation | Автоматизация | Automation | Automatizare | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |
| Monthly owner report | Monthly owner report | Ежемесячный отчёт для собственника | Monthly owner report | Raport lunar pentru proprietar | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | APPROVED |

## 10. Proposed RU / RO glossary

Every term with a proposal, deduplicated. Romanian is written as Romanian business language, not
as a translation of the Russian.

| English | RU | RO | class | EN once |
|---|---|---|---|---|
| P&L | Отчёт о прибыли и убытках | Cont de profit și pierdere | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Cash Flow | Денежный поток | Flux de numerar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Discovery Call | Первичный финансовый разбор | Discuție financiară inițială | LOCALIZE_WITH_ENGLISH_ONCE | NO |
| CFO | Финансовый директор | Director financiar | MUST_LOCALIZE | NO |
| Business Control System | Система финансового управления бизнесом | Sistem de management financiar al afacerii | OWNER_DECISION_REQUIRED | YES |
| KPI | Ключевые показатели бизнеса | Indicatori-cheie de performanță | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Financial Health Check | Financial Health Check | Financial Health Check | BRANDED_PACKAGE_NAME | NO |
| Control Light | Control Light | Control Light | BRANDED_PACKAGE_NAME | NO |
| AI | Искусственный интеллект | Inteligență artificială | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| DPO | Средний срок оплаты поставщикам | Termenul mediu de plată către furnizori | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Email | E-mail | E-mail | MUST_LOCALIZE | NO |
| FCF | Свободный денежный поток | Flux de numerar liber | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| DSO | Средний срок оплаты от клиентов | Termenul mediu de încasare de la clienți | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| promo | промоакция | promoție | MUST_LOCALIZE | NO |
| Sheets | Google Sheets | Google Sheets | APPROVED_PROPER_NAME | NO |
| Cash | Денежные средства | Disponibilități bănești | MUST_LOCALIZE | NO |
| Make | Make | Make | APPROVED_SOFTWARE_PRODUCT | NO |
| retrobonus | ретробонус | bonus retroactiv | MUST_LOCALIZE | NO |
| Cash Saving | Фактическая экономия денежных средств | Economie efectivă de numerar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| cash flow | денежный поток | flux de numerar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Client Base Control System | Система управления клиентской базой | Sistem de management al bazei de clienți | OWNER_DECISION_REQUIRED | YES |
| Funding Gap | Дефицит финансирования | Deficit de finanțare | OWNER_DECISION_REQUIRED | YES |
| Full Cost | Полная стоимость | Cost total | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| BI | Управленческая аналитика | Analiză managerială | MUST_LOCALIZE | NO |
| vacancy | Доля свободных площадей | Grad de neocupare | MUST_LOCALIZE | NO |
| Retail | Розничная торговля | Comerț cu amănuntul | MUST_LOCALIZE | NO |
| Inventory Days | Период оборачиваемости запасов, дней | Durata de rotație a stocurilor | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| cash gap | Кассовый разрыв | Deficit temporar de lichiditate | MUST_LOCALIZE | NO |
| email | E-mail | E-mail | MUST_LOCALIZE | NO |
| Owner | Собственник | Proprietar | MUST_LOCALIZE | NO |
| Retail Margin Engine | Система управления маржой в рознице | Sistem de management al marjei în retail | OWNER_DECISION_REQUIRED | YES |
| tenant rating | Рейтинг надёжности арендаторов | Evaluarea fiabilității chiriașilor | MUST_LOCALIZE | NO |
| NOI | Чистый операционный доход | Venit operațional net | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| rent vs market | Арендная ставка относительно рынка | Chiria raportată la nivelul pieței | MUST_LOCALIZE | NO |
| ERP | Корпоративная учётная система | Sistem integrat de gestiune | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Margin Gap | Отклонение маржи от целевой | Abaterea marjei față de țintă | OWNER_DECISION_REQUIRED | YES |
| Control System | Система финансового контроля | Sistem de control financiar | OWNER_DECISION_REQUIRED | YES |
| Standard | Standard | Standard | BRANDED_PACKAGE_NAME | NO |
| ROI | Рентабельность инвестиций | Rentabilitatea investiției | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Fitness Membership Renewal Engine | Система продления абонементов | Sistem de reînnoire a abonamentelor | OWNER_DECISION_REQUIRED | YES |
| Target Marja | Целевая маржа | Marjă țintă | OWNER_DECISION_REQUIRED | NO |
| Fitness | Фитнес / спортивный бизнес | Fitness / activități sportive | MUST_LOCALIZE | NO |
| Premium | Premium | Premium | BRANDED_PACKAGE_NAME | NO |
| cookies | файлы cookie | fișiere cookie | MUST_LOCALIZE | NO |
| OpenAI | OpenAI | OpenAI | APPROVED_PROPER_NAME | NO |
| NDA | Соглашение о конфиденциальности | Acord de confidențialitate | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Automation | Автоматизация | Automatizare | MUST_LOCALIZE | NO |
| Monthly owner report | Ежемесячный отчёт для собственника | Raport lunar pentru proprietar | OWNER_DECISION_REQUIRED | YES |
| risk traffic light | Индикатор риска | Indicator de risc | MUST_LOCALIZE | NO |
| profitability | Прибыльность товарной позиции | Profitabilitatea pe produs | MUST_LOCALIZE | NO |
| action list | План действий | Plan de acțiune | MUST_LOCALIZE | NO |
| Digital | Цифровые решения | Soluții digitale | MUST_LOCALIZE | NO |
| mini-scan | Экспресс-диагностика | Diagnostic rapid | MUST_LOCALIZE | NO |
| Zoom | Zoom | Zoom | APPROVED_PROPER_NAME | NO |
| Cap Rate | Ставка капитализации | Rata de capitalizare | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| payback | срок окупаемости | perioada de recuperare a investiției | MUST_LOCALIZE | YES |
| margin per meter | Маржа на 1 м² | Marjă pe m² | MUST_LOCALIZE | NO |
| promo economics | Эффективность промоакции | Eficiența promoției | MUST_LOCALIZE | NO |
| Unit economics | Экономика единицы продукта | Economia pe unitate | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| ROAS | Рентабельность рекламных расходов | Rentabilitatea cheltuielilor de publicitate | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| CAC | Стоимость привлечения клиента | Costul de achiziție a clientului | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| LTV | Ценность клиента за весь период сотрудничества | Valoarea clientului pe durata relației | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| e-commerce | интернет-торговля | comerț online | MUST_LOCALIZE | NO |
| Manufacturing | Производство | Producție | MUST_LOCALIZE | NO |
| cash destroyers | Товарные позиции, поглощающие денежные средства | Produse care consumă numerar | MUST_LOCALIZE | NO |
| ChatGPT | ChatGPT | ChatGPT | APPROVED_PROPER_NAME | NO |
| Copilot | Copilot | Copilot | APPROVED_PROPER_NAME | NO |
| Claude | Claude | Claude | APPROVED_PROPER_NAME | NO |
| Accepted Business Outcome | Результат, принятый бизнесом | Rezultat acceptat de companie | MUST_LOCALIZE | NO |
| Financial Effect | Финансовый эффект | Impact financiar | MUST_LOCALIZE | NO |
| Management Decision | Управленческое решение | Decizie managerială | MUST_LOCALIZE | NO |
| Risk map | Карта финансовых рисков | Harta riscurilor financiare | MUST_LOCALIZE | NO |
| Document checklist | Список необходимых документов | Lista documentelor necesare | MUST_LOCALIZE | NO |
| Payment calendar logic | Логика платёжного календаря | Logica calendarului de plăți | MUST_LOCALIZE | NO |
| Action plan | План действий | Plan de acțiune | MUST_LOCALIZE | NO |
| Recommendation | Рекомендация FINMENTOR | Recomandarea FINMENTOR | MUST_LOCALIZE | NO |
| Bank statements | Банковские выписки | Extrase bancare | MUST_LOCALIZE | NO |
| AP aging | Анализ кредиторской задолженности по срокам | Analiza datoriilor către furnizori pe scadențe | MUST_LOCALIZE | NO |
| Owner view | Взгляд собственника | Perspectiva proprietarului | MUST_LOCALIZE | NO |
| Cash flow & treasury control | Управление денежным потоком и казначейством | Gestionarea fluxului de numerar și a trezoreriei | MUST_LOCALIZE | NO |
| Iacovlev Ghennadi | Iacovlev Ghennadi | Iacovlev Ghennadi | APPROVED_PROPER_NAME | NO |
| Google Analytics | Google Analytics | Google Analytics | APPROVED_PROPER_NAME | NO |
| GitHub Pages | GitHub Pages | GitHub Pages | APPROVED_PROPER_NAME | NO |
| email- | e-mail | e-mail | MUST_LOCALIZE | NO |
| Cookies | Файлы cookie | Fișiere cookie | MUST_LOCALIZE | NO |
| GMT | GMT | GMT | MUST_LOCALIZE | NO |
| Services | Услуги | Servicii | MUST_LOCALIZE | NO |
| Other | Другое | Altele | MUST_LOCALIZE | NO |
| Google Meet | Google Meet | Google Meet | APPROVED_PROPER_NAME | NO |
| Microsoft Teams | Microsoft Teams | Microsoft Teams | APPROVED_PROPER_NAME | NO |
| Telegram call | Telegram call | Telegram call | APPROVED_PROPER_NAME | NO |
| HoReCa | HoReCa | HoReCa | MUST_LOCALIZE | NO |
| Tableau | Tableau | Tableau | APPROVED_PROPER_NAME | NO |
| Looker | Looker | Looker | APPROVED_PROPER_NAME | NO |
| Zapier | Zapier | Zapier | APPROVED_PROPER_NAME | NO |
| Meet | встреча | întâlnire | MUST_LOCALIZE | NO |
| Email summary | Итоги встречи по e-mail | Sinteza întâlnirii prin e-mail | MUST_LOCALIZE | NO |
| Google Drive | Google Drive | Google Drive | APPROVED_PROPER_NAME | NO |
| Microsoft OneDrive | Microsoft OneDrive | Microsoft OneDrive | APPROVED_PROPER_NAME | NO |
| Dropbox | Dropbox | Dropbox | APPROVED_PROPER_NAME | NO |
| Payment Gate | Контроль платежей | Controlul plăților | OWNER_DECISION_REQUIRED | YES |
| Revenue at Risk | Выручка под риском | Venituri expuse riscului | OWNER_DECISION_REQUIRED | YES |
| Expected Renewal Value | Ожидаемая выручка от продлений | Venituri așteptate din reînnoiri | OWNER_DECISION_REQUIRED | YES |
| dashboard | панель собственника | tablou de bord | MUST_LOCALIZE | NO |
| SKU | Товарная позиция | Articol de stoc | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Supplier Shelf Credit | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | OWNER_DECISION_REQUIRED | YES |
| funding gap | дефицит финансирования | deficit de finanțare | MUST_LOCALIZE | YES |
| Cost Effect | Эффект себестоимости | Efectul costului | MUST_LOCALIZE | NO |
| retail | розничная торговля | comerț cu amănuntul | MUST_LOCALIZE | NO |
| Price Effect | Эффект цены | Efectul prețului | MUST_LOCALIZE | NO |
| CAPEX | Капитальные вложения | Investiții de capital | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| stock-out | дефицит товара | lipsă de stoc | MUST_LOCALIZE | NO |
| Available Cash | Доступные деньги | Numerar disponibil | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| governance | управление и контроль | guvernanță și control | MUST_LOCALIZE | NO |
| Supplier Financing Benefit | Выгода от финансирования поставщиком | Beneficiul finanțării de la furnizor | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| COGS | Себестоимость продаж | Costul bunurilor vândute | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Volume Effect | Эффект объёма | Efectul volumului | MUST_LOCALIZE | NO |
| CFO Control Partner | CFO Control Partner | CFO Control Partner | BRANDED_PACKAGE_NAME | NO |
| Control Partner | Control Partner | Control Partner | BRANDED_PACKAGE_NAME | NO |
| backtest | ретропроверка | testare retroactivă | MUST_LOCALIZE | NO |
| roadmap | план действий | plan de acțiune | MUST_LOCALIZE | YES |
| Mix Effect | Эффект структуры продаж | Efectul structurii vânzărilor | MUST_LOCALIZE | NO |
| Data Model | Модель данных | Model de date | MUST_LOCALIZE | NO |
| Retention Discount Leakage | Потери на скидках удержания | Pierderi din discounturi de retenție | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Executive Summary | Краткое резюме | Rezumat executiv | MUST_LOCALIZE | NO |
| Real Estate Control System | Система финансового управления недвижимостью | Sistem de management financiar al activelor imobiliare | OWNER_DECISION_REQUIRED | YES |
| retail- | розничная торговля | comerț cu amănuntul | MUST_LOCALIZE | NO |
| Supplier Rating | Рейтинг поставщиков | Ratingul furnizorilor | MUST_LOCALIZE | NO |
| Free Treasury Cash | Свободные деньги казначейства | Numerar liber de trezorerie | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Supplier-Financed | Финансируется поставщиком | Finanțat de furnizor | OWNER_DECISION_REQUIRED | YES |
| Own-Funded | За счёт собственных средств | Din surse proprii | OWNER_DECISION_REQUIRED | YES |
| Purchase Gate | Контроль закупок | Controlul achizițiilor | OWNER_DECISION_REQUIRED | YES |
| Green | Зелёная зона | Zonă verde | MUST_LOCALIZE | NO |
| Yellow | Жёлтая зона | Zonă galbenă | MUST_LOCALIZE | NO |
| Orange | Оранжевая зона | Zonă portocalie | MUST_LOCALIZE | NO |
| Red | Красная зона | Zonă roșie | MUST_LOCALIZE | NO |
| Cash gap | Кассовый разрыв | Deficit temporar de lichiditate | MUST_LOCALIZE | NO |
| Working Capital | Оборотный капитал | Capital de lucru | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Cash Destroyers | Товарные позиции, поглощающие денежные средства | Produse care consumă numerar | MUST_LOCALIZE | NO |
| Data Quality | Качество данных | Calitatea datelor | MUST_LOCALIZE | NO |
| Retrobonus | ретробонус | bonus retroactiv | MUST_LOCALIZE | NO |
| Promo | промоакция | promoție | MUST_LOCALIZE | NO |
| Cash flow | Денежный поток | Flux de numerar | MUST_LOCALIZE | YES |
| Dashboard | Панель собственника | Tablou de bord pentru proprietar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| inventory days | период оборачиваемости запасов, дней | durata de rotație a stocurilor | MUST_LOCALIZE | YES |
| FCF- | Свободный денежный поток | Flux de numerar liber | MUST_LOCALIZE | YES |
| Promo economics | Эффективность промоакции | Eficiența promoției | MUST_LOCALIZE | NO |
| DIO | Срок оборота запасов | Durata de rotație a stocurilor | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| EBITDA | Прибыль до вычета процентов, налогов и амортизации | Profit înainte de dobânzi, impozite și amortizare | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Payment Calendar | Платёжный календарь | Calendar de plăți | MUST_LOCALIZE | NO |
| Treasury Fund Planning | Планирование фондов казначейства | Planificarea fondurilor de trezorerie | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Monthly Owner Report | Ежемесячный отчёт для собственника | Raport lunar pentru proprietar | OWNER_DECISION_REQUIRED | YES |
| Investment Model | Инвестиционная модель | Model investițional | MUST_LOCALIZE | NO |
| Due AP | Кредиторская задолженность к оплате | Datorii scadente către furnizori | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Recoverable VAT | НДС к возмещению | TVA de recuperat | OWNER_DECISION_REQUIRED | YES |
| Cash Conversion Cycle | Цикл оборота денег | Ciclul de conversie a numerarului | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| External CFO | Внешний финансовый директор | Director financiar extern | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| AR Aging | Анализ дебиторской задолженности по срокам | Analiza creanțelor pe scadențe | MUST_LOCALIZE | NO |

## 11. Terms with no wording yet

588 rows carry no proposed wording. They are the long tail — mostly one- and two-use
specialist labels on Tier 2 and Tier 3 pages. They are listed in the CSV with an empty
`ru_proposal` so a reviewer can fill them in, and none of them is on the Tier 1 approval path.

---

**Nothing here has been applied.** No customer-facing file, workflow, CRM value, scoring key,
callback or route was modified to produce this register.
