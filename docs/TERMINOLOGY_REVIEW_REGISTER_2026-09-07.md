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
| A | MUST_LOCALIZE | 736 |
| B | LOCALIZE_WITH_ENGLISH_ONCE | 71 |
| E | OWNER_DECISION_REQUIRED | 43 |
| C | APPROVED_PROPER_NAME | 6 |
| D | TECHNICAL_INTERNAL_ONLY | 2 |

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
| P&L | RO | LOCALIZE_WITH_ENGLISH_ONCE | 114 | CRITICAL | Отчёт о прибыли и убытках | Cont de profit și pierdere | YES | NO |
| P&L | RU | LOCALIZE_WITH_ENGLISH_ONCE | 63 | CRITICAL | Отчёт о прибыли и убытках | Cont de profit și pierdere | YES | NO |
| Cash Flow | RU | LOCALIZE_WITH_ENGLISH_ONCE | 53 | CRITICAL | Денежный поток | Flux de numerar | YES | NO |
| Cash Flow | RO | LOCALIZE_WITH_ENGLISH_ONCE | 53 | CRITICAL | Денежный поток | Flux de numerar | YES | NO |
| Discovery Call | RU | LOCALIZE_WITH_ENGLISH_ONCE | 39 | CRITICAL | Первичный финансовый разбор | Discuție financiară inițială | YES | NO |
| Discovery Call | RO | LOCALIZE_WITH_ENGLISH_ONCE | 39 | CRITICAL | Первичный финансовый разбор | Discuție financiară inițială | YES | NO |
| CFO | RO | MUST_LOCALIZE | 29 | CRITICAL | Финансовый директор | Director financiar | NO | NO |
| Business Control System | RU | OWNER_DECISION_REQUIRED | 26 | CRITICAL | Система управления бизнесом | Sistem de management al afacerii | YES | YES |
| Business Control System | RO | OWNER_DECISION_REQUIRED | 26 | CRITICAL | Система управления бизнесом | Sistem de management al afacerii | YES | YES |
| CFO | RU | MUST_LOCALIZE | 19 | CRITICAL | Финансовый директор | Director financiar | NO | NO |
| KPI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 15 | CRITICAL | Ключевые показатели бизнеса | Indicatori-cheie de performanță | YES | NO |
| KPI | RO | LOCALIZE_WITH_ENGLISH_ONCE | 15 | CRITICAL | Ключевые показатели бизнеса | Indicatori-cheie de performanță | YES | NO |
| Financial Health Check | RU | LOCALIZE_WITH_ENGLISH_ONCE | 13 | CRITICAL | Экспертная финансовая диагностика | Diagnostic financiar | YES | NO |
| Financial Health Check | RO | LOCALIZE_WITH_ENGLISH_ONCE | 13 | CRITICAL | Экспертная финансовая диагностика | Diagnostic financiar | YES | NO |
| Control Light | RU | OWNER_DECISION_REQUIRED | 11 | CRITICAL | Лёгкий контроль | Control simplificat | YES | YES |
| AI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | CRITICAL | Искусственный интеллект | Inteligență artificială | YES | NO |
| DPO | RU | LOCALIZE_WITH_ENGLISH_ONCE | 45 | HIGH | Срок оплаты поставщикам | Termenul de plată la furnizori | YES | NO |
| DPO | RO | LOCALIZE_WITH_ENGLISH_ONCE | 45 | HIGH | Срок оплаты поставщикам | Termenul de plată la furnizori | YES | NO |
| Email | RU | MUST_LOCALIZE | 34 | HIGH | Электронная почта | E-mail | NO | NO |
| Email | RO | MUST_LOCALIZE | 34 | HIGH | Электронная почта | E-mail | NO | NO |
| FCF | RO | LOCALIZE_WITH_ENGLISH_ONCE | 34 | HIGH | Свободный денежный поток | Flux de numerar liber | YES | NO |
| FCF | RU | LOCALIZE_WITH_ENGLISH_ONCE | 33 | HIGH | Свободный денежный поток | Flux de numerar liber | YES | NO |
| DSO | RU | LOCALIZE_WITH_ENGLISH_ONCE | 26 | HIGH | Срок оплаты от клиентов | Termenul de încasare de la clienți | YES | NO |
| DSO | RO | LOCALIZE_WITH_ENGLISH_ONCE | 26 | HIGH | Срок оплаты от клиентов | Termenul de încasare de la clienți | YES | NO |
| promo | RU | MUST_LOCALIZE | 21 | HIGH | промоакция | promoție | NO | NO |
| Sheets | RO | APPROVED_PROPER_NAME | 19 | HIGH | Google Sheets | Google Sheets | NO | NO |
| Cash | RU | MUST_LOCALIZE | 18 | HIGH | Деньги | Numerar | NO | NO |
| Cash | RO | MUST_LOCALIZE | 18 | HIGH | Деньги | Numerar | NO | NO |
| Make | RU | TECHNICAL_INTERNAL_ONLY | 17 | HIGH | автоматизация | automatizare | NO | NO |
| retrobonus | RU | MUST_LOCALIZE | 17 | HIGH | ретробонус | retrobonus | NO | NO |
| Make | RO | TECHNICAL_INTERNAL_ONLY | 17 | HIGH | автоматизация | automatizare | NO | NO |
| Cash Saving | RU | LOCALIZE_WITH_ENGLISH_ONCE | 16 | HIGH | Денежная экономия | Economie în numerar | YES | NO |
| cash flow | RU | LOCALIZE_WITH_ENGLISH_ONCE | 16 | HIGH | денежный поток | flux de numerar | YES | NO |
| Cash Saving | RO | LOCALIZE_WITH_ENGLISH_ONCE | 16 | HIGH | Денежная экономия | Economie în numerar | YES | NO |
| Client Base Control System | RU | OWNER_DECISION_REQUIRED | 15 | HIGH | Система управления клиентской базой | Sistem de management al bazei de clienți | YES | YES |
| Funding Gap | RU | OWNER_DECISION_REQUIRED | 13 | HIGH | Дефицит финансирования | Deficit de finanțare | YES | YES |
| Funding Gap | RO | OWNER_DECISION_REQUIRED | 13 | HIGH | Дефицит финансирования | Deficit de finanțare | YES | YES |
| Light | RO | OWNER_DECISION_REQUIRED | 12 | HIGH | Лёгкий | Simplificat | NO | YES |
| Full Cost | RU | LOCALIZE_WITH_ENGLISH_ONCE | 11 | HIGH | Полная стоимость | Costul total | YES | NO |
| BI | RU | MUST_LOCALIZE | 11 | HIGH | аналитика | analiză | NO | NO |
| vacancy | RU | MUST_LOCALIZE | 11 | HIGH | вакантность | grad de neocupare | NO | NO |
| Retail | RU | MUST_LOCALIZE | 11 | HIGH | Розничная торговля | Comerț cu amănuntul | NO | NO |
| Full Cost | RO | LOCALIZE_WITH_ENGLISH_ONCE | 11 | HIGH | Полная стоимость | Costul total | YES | NO |
| Retail | RO | MUST_LOCALIZE | 11 | HIGH | Розничная торговля | Comerț cu amănuntul | NO | NO |
| CFO- | RU | MUST_LOCALIZE | 10 | HIGH | финансовый | financiar | NO | NO |
| Inventory Days | RU | LOCALIZE_WITH_ENGLISH_ONCE | 10 | HIGH | Дни запасов | Zile de stoc | YES | NO |
| cash gap | RU | MUST_LOCALIZE | 10 | HIGH | кассовый разрыв | gol de numerar | NO | NO |
| email | RU | MUST_LOCALIZE | 10 | HIGH | электронная почта | e-mail | NO | NO |
| Owner | RO | MUST_LOCALIZE | 10 | HIGH | Собственник | Proprietar | NO | NO |
| Inventory Days | RO | LOCALIZE_WITH_ENGLISH_ONCE | 10 | HIGH | Дни запасов | Zile de stoc | YES | NO |
| Owner | RU | MUST_LOCALIZE | 9 | HIGH | Собственник | Proprietar | NO | NO |
| Retail Margin Engine | RU | OWNER_DECISION_REQUIRED | 7 | MEDIUM | Система управления маржой в рознице | Sistem de management al marjei în retail | YES | YES |
| tenant rating | RU | MUST_LOCALIZE | 7 | MEDIUM | рейтинг арендаторов | ratingul chiriașilor | NO | NO |
| NOI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 7 | MEDIUM | Чистый операционный доход | Venit operațional net | YES | NO |
| rent vs market | RU | MUST_LOCALIZE | 7 | MEDIUM | аренда против рынка | chiria față de piață | NO | NO |
| Retail Margin Engine | RO | OWNER_DECISION_REQUIRED | 7 | MEDIUM | Система управления маржой в рознице | Sistem de management al marjei în retail | YES | YES |
| NOI | RO | LOCALIZE_WITH_ENGLISH_ONCE | 7 | MEDIUM | Чистый операционный доход | Venit operațional net | YES | NO |
| ERP | RU | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Учётная система | Sistem de evidență | YES | NO |
| Margin Gap | RU | OWNER_DECISION_REQUIRED | 6 | MEDIUM | Разрыв маржи | Deficit de marjă | YES | YES |
| ERP | RO | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Учётная система | Sistem de evidență | YES | NO |
| Margin Gap | RO | OWNER_DECISION_REQUIRED | 6 | MEDIUM | Разрыв маржи | Deficit de marjă | YES | YES |
| Control System | RU | OWNER_DECISION_REQUIRED | 5 | MEDIUM | Система управления | Sistem de management | YES | YES |
| Standard | RU | MUST_LOCALIZE | 4 | MEDIUM | Стандартный | Standard | NO | NO |
| ROI | RU | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Отдача от вложений | Randamentul investiției | YES | NO |
| ROI | RO | LOCALIZE_WITH_ENGLISH_ONCE | 4 | MEDIUM | Отдача от вложений | Randamentul investiției | YES | NO |
| Sheets | RU | APPROVED_PROPER_NAME | 3 | MEDIUM | Google Sheets | Google Sheets | NO | NO |
| Fitness Membership Renewal Engine | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Система продления абонементов | Sistem de reînnoire a abonamentelor | YES | YES |
| Target Marja | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Целевая маржа | Marjă țintă | NO | YES |
| Fitness | RU | MUST_LOCALIZE | 3 | MEDIUM | Фитнес / спортивный бизнес | Fitness / activități sportive | NO | NO |
| light- | RU | MUST_LOCALIZE | 3 | MEDIUM | — | — | NO | NO |
| Premium | RU | MUST_LOCALIZE | 3 | MEDIUM | Премиальный | Premium | NO | NO |
| cookies | RU | MUST_LOCALIZE | 3 | MEDIUM | файлы cookie | fișiere cookie | NO | NO |
| OpenAI | RU | APPROVED_PROPER_NAME | 3 | MEDIUM | OpenAI | OpenAI | NO | NO |
| NDA | RU | LOCALIZE_WITH_ENGLISH_ONCE | 3 | MEDIUM | Соглашение о неразглашении | Acord de confidențialitate | YES | NO |
| Monthly | RO | MUST_LOCALIZE | 3 | MEDIUM | Ежемесячно | Lunar | NO | NO |
| Fitness Membership Renewal Engine | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Система продления абонементов | Sistem de reînnoire a abonamentelor | YES | YES |
| Target Marja | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Целевая маржа | Marjă țintă | NO | YES |
| Fitness | RO | MUST_LOCALIZE | 3 | MEDIUM | Фитнес / спортивный бизнес | Fitness / activități sportive | NO | NO |
| OpenAI | RO | APPROVED_PROPER_NAME | 3 | MEDIUM | OpenAI | OpenAI | NO | NO |
| NDA | RO | LOCALIZE_WITH_ENGLISH_ONCE | 3 | MEDIUM | Соглашение о неразглашении | Acord de confidențialitate | YES | NO |
| Spend | RU | MUST_LOCALIZE | 2 | MEDIUM | Расходы | Cheltuieli | NO | NO |
| Automation | RU | MUST_LOCALIZE | 2 | MEDIUM | Автоматизация | Automatizare | NO | NO |
| Telegram- | RU | MUST_LOCALIZE | 2 | MEDIUM | — | — | NO | NO |
| Monthly owner report | RU | OWNER_DECISION_REQUIRED | 2 | MEDIUM | Ежемесячный отчёт собственника | Raportul lunar al proprietarului | YES | YES |
| Limb | RU | MUST_LOCALIZE | 2 | MEDIUM | — | — | NO | NO |
| risk traffic light | RU | MUST_LOCALIZE | 2 | MEDIUM | светофор рисков | semafor de risc | NO | NO |
| profitability | RU | MUST_LOCALIZE | 2 | MEDIUM | прибыльность | profitabilitate | NO | NO |
| Monthly | RU | MUST_LOCALIZE | 2 | MEDIUM | Ежемесячно | Lunar | NO | NO |
| action list | RU | MUST_LOCALIZE | 2 | MEDIUM | список действий | listă de acțiuni | NO | NO |
| Digital | RU | MUST_LOCALIZE | 2 | MEDIUM | Цифровой | Digital | NO | NO |
| mini-scan | RU | MUST_LOCALIZE | 2 | MEDIUM | мини-диагностика | mini-diagnostic | NO | NO |
| Zoom | RU | APPROVED_PROPER_NAME | 2 | MEDIUM | Zoom | Zoom | NO | NO |
| Spend | RO | MUST_LOCALIZE | 2 | MEDIUM | Расходы | Cheltuieli | NO | NO |
| Automation | RO | MUST_LOCALIZE | 2 | MEDIUM | Автоматизация | Automatizare | NO | NO |
| Monthly owner report | RO | OWNER_DECISION_REQUIRED | 2 | MEDIUM | Ежемесячный отчёт собственника | Raportul lunar al proprietarului | YES | YES |
| Zoom | RO | APPROVED_PROPER_NAME | 2 | MEDIUM | Zoom | Zoom | NO | NO |
| Selectarea limbii | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| ROM | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| SCROLL | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cap Rate | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Ставка капитализации | Rata de capitalizare | YES | NO |
| deposit coverage | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| payback | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| RETAIL ENGINE | RU | OWNER_DECISION_REQUIRED | 1 | MEDIUM | СИСТЕМА УПРАВЛЕНИЯ МАРЖОЙ | SISTEM DE MANAGEMENT AL MARJEI | NO | YES |
| margin per meter | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| promo economics | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Unit economics | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Юнит-экономика | Economia unitară | YES | NO |
| ROAS | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Отдача от рекламных расходов | Randamentul cheltuielilor publicitare | YES | NO |
| CAC | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Стоимость привлечения клиента | Costul de achiziție a clientului | YES | NO |
| LTV | RU | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Пожизненная ценность клиента | Valoarea pe durata de viață a clientului | YES | NO |
| e-commerce | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Manufacturing | RU | MUST_LOCALIZE | 1 | MEDIUM | Производство | Producție | NO | NO |
| Support | RU | MUST_LOCALIZE | 1 | MEDIUM | Поддержка | Suport | NO | NO |
| review | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Treasury & Payment Discipline | RU | OWNER_DECISION_REQUIRED | 1 | MEDIUM | Казначейство и платёжная дисциплина | Trezorerie și disciplina plăților | YES | YES |
| Fund Planning & Payment Waterfall | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Working Capital Control | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Analysis | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| cash destroyers | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Supplier Rating & Procurement Control | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Margin Factor Analysis | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Power BI Owner | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| DIGITAL LABOUR CONTROL | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| ChatGPT | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Copilot | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Claude | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Accepted Business Outcome | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Financial Effect | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Management Decision | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Diagnostic memo | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Risk map | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| quick wins | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Document checklist | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| structure | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Payment calendar logic | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Action plan | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| concept | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Recommendation | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Bank statements | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| AP aging | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| AR | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Owner view | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| IFRS- | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Big | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cash flow & treasury control | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| triage | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Iacovlev Ghennadi | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| questionnaire | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| working-capital-scan | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| rule-based | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Analytics | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| score | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GitHub Pages | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| email- | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Financial X-Ray | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cookies | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GMT | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Services | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Other | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Meet | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Microsoft Teams | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Telegram call | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| HoReCa | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Excel- | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Tableau | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Looker | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Zapier | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Meet | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Email summary | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Drive | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Microsoft OneDrive | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Dropbox | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| intake | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| webhook FINMENTOR | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GA | RU | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Limb | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| SCROLL | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cap Rate | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Ставка капитализации | Rata de capitalizare | YES | NO |
| RETAIL ENGINE | RO | OWNER_DECISION_REQUIRED | 1 | MEDIUM | СИСТЕМА УПРАВЛЕНИЯ МАРЖОЙ | SISTEM DE MANAGEMENT AL MARJEI | NO | YES |
| Unit economics | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Юнит-экономика | Economia unitară | YES | NO |
| ROAS | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Отдача от рекламных расходов | Randamentul cheltuielilor publicitare | YES | NO |
| CAC | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Стоимость привлечения клиента | Costul de achiziție a clientului | YES | NO |
| LTV | RO | LOCALIZE_WITH_ENGLISH_ONCE | 1 | MEDIUM | Пожизненная ценность клиента | Valoarea pe durata de viață a clientului | YES | NO |
| Manufacturing | RO | MUST_LOCALIZE | 1 | MEDIUM | Производство | Producție | NO | NO |
| Support | RO | MUST_LOCALIZE | 1 | MEDIUM | Поддержка | Suport | NO | NO |
| Treasury & Payment Discipline | RO | OWNER_DECISION_REQUIRED | 1 | MEDIUM | Казначейство и платёжная дисциплина | Trezorerie și disciplina plăților | YES | YES |
| Fund Planning & Payment Waterfall | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Working Capital Control | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Analysis | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Supplier Rating & Procurement Control | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Margin Factor Analysis | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Power BI Owner | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| ChatGPT | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Copilot | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Claude | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Accepted Business Outcome | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Financial Effect | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Management Decision | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Risk map | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Document checklist | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Payment calendar logic | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Action plan | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Recommendation | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Bank statements | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| AP aging | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Owner view | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cash flow & treasury control | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Iacovlev Ghennadi | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Analytics | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GitHub Pages | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Cookies | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| GMT | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Services | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Other | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Rom | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Meet | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Microsoft Teams | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Telegram call | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| HoReCa | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Tableau | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Looker | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Zapier | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Meet | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Email summary | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Google Drive | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Microsoft OneDrive | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |
| Dropbox | RO | MUST_LOCALIZE | 1 | MEDIUM | — | — | NO | NO |

## 6. TIER 2 — commercial specialist pages

AI economics, retail modules, investment, real estate, treasury and the other commercial
modules. Reachable, commercially meaningful, but not on the first-contact path.

| term | lang | class | occ | importance | RU proposal | RO proposal | EN once | owner decision |
|---|---|---|---|---|---|---|---|---|
| Payment Gate | RU | OWNER_DECISION_REQUIRED | 15 | HIGH | Платёжный шлюз | Poarta de plată | YES | YES |
| Payment Gate | RO | OWNER_DECISION_REQUIRED | 15 | HIGH | Платёжный шлюз | Poarta de plată | YES | YES |
| Revenue at Risk | RU | OWNER_DECISION_REQUIRED | 14 | HIGH | Выручка под риском | Venituri în risc | YES | YES |
| Revenue at Risk | RO | OWNER_DECISION_REQUIRED | 14 | HIGH | Выручка под риском | Venituri în risc | YES | YES |
| Expected Renewal Value | RU | OWNER_DECISION_REQUIRED | 13 | HIGH | Ожидаемая стоимость продлений | Valoarea așteptată a reînnoirilor | YES | YES |
| Expected Renewal Value | RO | OWNER_DECISION_REQUIRED | 13 | HIGH | Ожидаемая стоимость продлений | Valoarea așteptată a reînnoirilor | YES | YES |
| dashboard | RU | MUST_LOCALIZE | 12 | HIGH | панель собственника | tablou de bord | NO | NO |
| SKU | RU | LOCALIZE_WITH_ENGLISH_ONCE | 12 | HIGH | Товарная позиция | Articol de stoc | YES | NO |
| Supplier Shelf Credit | RU | OWNER_DECISION_REQUIRED | 12 | HIGH | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | YES | YES |
| SKU | RO | LOCALIZE_WITH_ENGLISH_ONCE | 12 | HIGH | Товарная позиция | Articol de stoc | YES | NO |
| Supplier Shelf Credit | RO | OWNER_DECISION_REQUIRED | 12 | HIGH | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | YES | YES |
| treasury briefing | RU | MUST_LOCALIZE | 11 | HIGH | — | — | NO | NO |
| funding gap | RU | MUST_LOCALIZE | 11 | HIGH | — | — | NO | NO |
| Power BI dashboard | RU | MUST_LOCALIZE | 10 | HIGH | — | — | NO | NO |
| Cost Effect | RU | MUST_LOCALIZE | 9 | MEDIUM | Эффект себестоимости | Efectul costului | NO | NO |
| retail | RU | MUST_LOCALIZE | 9 | MEDIUM | — | — | NO | NO |
| Price Effect | RU | MUST_LOCALIZE | 8 | MEDIUM | Эффект цены | Efectul prețului | NO | NO |
| CAPEX | RU | LOCALIZE_WITH_ENGLISH_ONCE | 8 | MEDIUM | Капитальные вложения | Investiții de capital | YES | NO |
| Price Effect | RO | MUST_LOCALIZE | 8 | MEDIUM | Эффект цены | Efectul prețului | NO | NO |
| CAPEX | RO | LOCALIZE_WITH_ENGLISH_ONCE | 8 | MEDIUM | Капитальные вложения | Investiții de capital | YES | NO |
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
| CFO Control Partner | RU | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Coverage | RU | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Accepted Outcome | RO | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Supplier Financing Benefit | RO | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Выгода от финансирования поставщиком | Beneficiul finanțării de la furnizor | YES | NO |
| COGS | RO | LOCALIZE_WITH_ENGLISH_ONCE | 6 | MEDIUM | Себестоимость продаж | Costul bunurilor vândute | YES | NO |
| CFO Control Partner | RO | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Coverage | RO | MUST_LOCALIZE | 6 | MEDIUM | — | — | NO | NO |
| Control Partner | RU | OWNER_DECISION_REQUIRED | 5 | MEDIUM | Постоянный финансовый партнёр | Partener financiar permanent | YES | YES |
| backtest | RU | MUST_LOCALIZE | 5 | MEDIUM | ретропроверка | testare retroactivă | NO | NO |
| Final FCF | RU | MUST_LOCALIZE | 5 | MEDIUM | — | — | NO | NO |
| roadmap | RU | MUST_LOCALIZE | 5 | MEDIUM | — | — | NO | NO |
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
| Real Estate Control System | RU | OWNER_DECISION_REQUIRED | 4 | MEDIUM | Система управления недвижимостью | Sistem de management imobiliar | YES | YES |
| retail- | RU | MUST_LOCALIZE | 4 | MEDIUM | — | — | NO | NO |
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
| Supplier-Financed | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Профинансировано поставщиком | Finanțat de furnizor | YES | YES |
| Own-Funded | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Профинансировано собственными деньгами | Finanțat din surse proprii | YES | YES |
| Purchase Gate | RU | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Контроль закупок | Poarta de achiziție | YES | YES |
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
| Supplier-Financed | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Профинансировано поставщиком | Finanțat de furnizor | YES | YES |
| Own-Funded | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Профинансировано собственными деньгами | Finanțat din surse proprii | YES | YES |
| Purchase Gate | RO | OWNER_DECISION_REQUIRED | 3 | MEDIUM | Контроль закупок | Poarta de achiziție | YES | YES |
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
| Cash gap | RU | MUST_LOCALIZE | 2 | LOW | — | — | NO | NO |
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
| Monthly Owner Report | RU | 5 | Ежемесячный отчёт собственника |
| Investment Model | RU | 5 | Инвестиционная модель |
| Due AP | RU | 5 | Кредиторская задолженность к оплате |
| Treasury Fund Planning | RO | 5 | Планирование фондов казначейства |
| Monthly Owner Report | RO | 5 | Ежемесячный отчёт собственника |
| Investment Model | RO | 5 | Инвестиционная модель |
| Due AP | RO | 5 | Кредиторская задолженность к оплате |
| KPI Dashboard | RU | 4 | — |
| JS- | RU | 4 | — |
| Recoverable VAT | RU | 4 | Возмещаемый НДС |
| KPI Dashboard | RO | 4 | — |
| Recoverable VAT | RO | 4 | Возмещаемый НДС |
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
| Business Control System | the owner's single control loop over money, profit and risk | Система управления бизнесом | Sistem de management al afacerii | YES | YES |
| Client Base Control System | control over the customer base: who renews, who churns, what it costs | Система управления клиентской базой | Sistem de management al bazei de clienți | YES | YES |
| Payment Gate | the approval step a payment must pass before it is released | Платёжный шлюз | Poarta de plată | YES | YES |
| Revenue at Risk | revenue that will be lost unless something is done | Выручка под риском | Venituri în risc | YES | YES |
| Funding Gap | the money the business will be short of, and when | Дефицит финансирования | Deficit de finanțare | YES | YES |
| Expected Renewal Value | the money expected from renewals still to come | Ожидаемая стоимость продлений | Valoarea așteptată a reînnoirilor | YES | YES |
| Supplier Shelf Credit | how much of the stock on the shelf the supplier is really financing | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | YES | YES |
| Control Light | the entry service tier | Лёгкий контроль | Control simplificat | YES | YES |
| Retail Margin Engine | how margin is made and lost per shelf, product and supplier | Система управления маржой в рознице | Sistem de management al marjei în retail | YES | YES |
| Margin Gap | the difference between the margin earned and the margin targeted | Разрыв маржи | Deficit de marjă | YES | YES |
| Control System | — | Система управления | Sistem de management | YES | YES |
| Control Partner | the ongoing partner service tier | Постоянный финансовый партнёр | Partener financiar permanent | YES | YES |
| Monthly Owner Report | the monthly report the owner actually reads | Ежемесячный отчёт собственника | Raportul lunar al proprietarului | YES | YES |
| Real Estate Control System | control over a property portfolio's income, cost and risk | Система управления недвижимостью | Sistem de management imobiliar | YES | YES |
| Recoverable VAT | VAT the business can get back rather than absorb | Возмещаемый НДС | TVA recuperabilă | YES | YES |
| Fitness Membership Renewal Engine | how memberships renew, and what a lapsed renewal costs | Система продления абонементов | Sistem de reînnoire a abonamentelor | YES | YES |
| Target Marja | — | Целевая маржа | Marjă țintă | NO | YES |
| Supplier-Financed | the part of stock effectively paid for by the supplier | Профинансировано поставщиком | Finanțat de furnizor | YES | YES |
| Own-Funded | the part of stock paid for with the company's own money | Профинансировано собственными деньгами | Finanțat din surse proprii | YES | YES |
| Purchase Gate | the approval step a purchase must pass before money leaves | Контроль закупок | Poarta de achiziție | YES | YES |
| Monthly owner report | — | Ежемесячный отчёт собственника | Raportul lunar al proprietarului | YES | YES |
| RETAIL ENGINE | — | СИСТЕМА УПРАВЛЕНИЯ МАРЖОЙ | SISTEM DE MANAGEMENT AL MARJEI | NO | YES |
| Treasury & Payment Discipline | — | Казначейство и платёжная дисциплина | Trezorerie și disciplina plăților | YES | YES |
| Light | — | Лёгкий | Simplificat | NO | YES |

## 9. TOP TIER 1 TERMS FOR OWNER APPROVAL

The commercially critical language, separated from the long tail so it can be approved first.
"Current" is what a customer reads today.

| term | current RU | proposed RU | current RO | proposed RO | EN once? | why it matters | owner decision? |
|---|---|---|---|---|---|---|---|
| P&L | P&L | Отчёт о прибыли и убытках | P&L | Cont de profit și pierdere | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| Cash Flow | Cash Flow | Денежный поток | Cash Flow | Flux de numerar | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| Discovery Call | Discovery Call | Первичный финансовый разбор | Discovery Call | Discuție financiară inițială | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| Business Control System | Business Control System | Система управления бизнесом | Business Control System | Sistem de management al afacerii | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | YES |
| CFO | CFO | Финансовый директор | CFO | Director financiar | NO | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| KPI | KPI | Ключевые показатели бизнеса | KPI | Indicatori-cheie de performanță | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| Financial Health Check | Financial Health Check | Экспертная финансовая диагностика | Financial Health Check | Diagnostic financiar | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| Control Light | Control Light | Лёгкий контроль | Control Light | Control simplificat | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | YES |
| AI | AI | Искусственный интеллект | AI | Inteligență artificială | YES | Needed to understand the offer or the next step before contacting FINMENTOR. | NO |
| DPO | DPO | Срок оплаты поставщикам | DPO | Termenul de plată la furnizori | YES | Appears in a button, card or formula where the customer decides. | NO |
| Email | Email | Электронная почта | Email | E-mail | NO | Appears in a button, card or formula where the customer decides. | NO |
| FCF | FCF | Свободный денежный поток | FCF | Flux de numerar liber | YES | Appears in a button, card or formula where the customer decides. | NO |
| DSO | DSO | Срок оплаты от клиентов | DSO | Termenul de încasare de la clienți | YES | Appears in a button, card or formula where the customer decides. | NO |
| Cash | Cash | Деньги | Cash | Numerar | NO | Appears in a button, card or formula where the customer decides. | NO |
| Make | Make | автоматизация | Make | automatizare | NO | Appears in a button, card or formula where the customer decides. | NO |
| Cash Saving | Cash Saving | Денежная экономия | Cash Saving | Economie în numerar | YES | Appears in a button, card or formula where the customer decides. | NO |
| Funding Gap | Funding Gap | Дефицит финансирования | Funding Gap | Deficit de finanțare | YES | Appears in a button, card or formula where the customer decides. | YES |
| Sheets | Sheets | Google Sheets | Sheets | Google Sheets | NO | Appears in a button, card or formula where the customer decides. | NO |
| Full Cost | Full Cost | Полная стоимость | Full Cost | Costul total | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Retail | Retail | Розничная торговля | Retail | Comerț cu amănuntul | NO | Appears in a button, card or formula where the customer decides. | NO |
| promo | promo | промоакция | promo | promoție | NO | Appears in a button, card or formula where the customer decides. | NO |
| Inventory Days | Inventory Days | Дни запасов | Inventory Days | Zile de stoc | YES | Appears in a button, card or formula where the customer decides. | NO |
| Owner | Owner | Собственник | Owner | Proprietar | NO | Appears in a button, card or formula where the customer decides. | NO |
| retrobonus | retrobonus | ретробонус | retrobonus | retrobonus | NO | Appears in a button, card or formula where the customer decides. | NO |
| cash flow | cash flow | денежный поток | cash flow | flux de numerar | YES | Appears in a button, card or formula where the customer decides. | NO |
| Client Base Control System | Client Base Control System | Система управления клиентской базой | Client Base Control System | Sistem de management al bazei de clienți | YES | Appears in a button, card or formula where the customer decides. | YES |
| Light | Light | Лёгкий | Light | Simplificat | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | YES |
| BI | BI | аналитика | BI | analiză | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| vacancy | vacancy | вакантность | vacancy | grad de neocupare | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| CFO- | CFO- | финансовый | CFO- | financiar | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| cash gap | cash gap | кассовый разрыв | cash gap | gol de numerar | NO | Appears in a button, card or formula where the customer decides. | NO |
| email | email | электронная почта | email | e-mail | NO | Appears in a button, card or formula where the customer decides. | NO |
| Retail Margin Engine | Retail Margin Engine | Система управления маржой в рознице | Retail Margin Engine | Sistem de management al marjei în retail | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | YES |
| NOI | NOI | Чистый операционный доход | NOI | Venit operațional net | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| ERP | ERP | Учётная система | ERP | Sistem de evidență | YES | Appears in a button, card or formula where the customer decides. | NO |
| Margin Gap | Margin Gap | Разрыв маржи | Margin Gap | Deficit de marjă | YES | Appears in a button, card or formula where the customer decides. | YES |
| ROI | ROI | Отдача от вложений | ROI | Randamentul investiției | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| tenant rating | tenant rating | рейтинг арендаторов | tenant rating | ratingul chiriașilor | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| rent vs market | rent vs market | аренда против рынка | rent vs market | chiria față de piață | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Fitness Membership Renewal Engine | Fitness Membership Renewal Engine | Система продления абонементов | Fitness Membership Renewal Engine | Sistem de reînnoire a abonamentelor | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | YES |
| Target Marja | Target Marja | Целевая маржа | Target Marja | Marjă țintă | NO | Appears in a button, card or formula where the customer decides. | YES |
| Fitness | Fitness | Фитнес / спортивный бизнес | Fitness | Fitness / activități sportive | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| OpenAI | OpenAI | OpenAI | OpenAI | OpenAI | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| NDA | NDA | Соглашение о неразглашении | NDA | Acord de confidențialitate | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Control System | Control System | Система управления | Control System | Sistem de management | YES | Appears in a button, card or formula where the customer decides. | YES |
| Monthly | Monthly | Ежемесячно | Monthly | Lunar | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Standard | Standard | Стандартный | Standard | Standard | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Spend | Spend | Расходы | Spend | Cheltuieli | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Automation | Automation | Автоматизация | Automation | Automatizare | NO | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | NO |
| Monthly owner report | Monthly owner report | Ежемесячный отчёт собственника | Monthly owner report | Raportul lunar al proprietarului | YES | Visible on the homepage, questionnaire, confirmation or privacy text during the journey. | YES |

## 10. Proposed RU / RO glossary

Every term with a proposal, deduplicated. Romanian is written as Romanian business language, not
as a translation of the Russian.

| English | RU | RO | class | EN once |
|---|---|---|---|---|
| P&L | Отчёт о прибыли и убытках | Cont de profit și pierdere | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Cash Flow | Денежный поток | Flux de numerar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Discovery Call | Первичный финансовый разбор | Discuție financiară inițială | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| CFO | Финансовый директор | Director financiar | MUST_LOCALIZE | NO |
| Business Control System | Система управления бизнесом | Sistem de management al afacerii | OWNER_DECISION_REQUIRED | YES |
| KPI | Ключевые показатели бизнеса | Indicatori-cheie de performanță | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Financial Health Check | Экспертная финансовая диагностика | Diagnostic financiar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Control Light | Лёгкий контроль | Control simplificat | OWNER_DECISION_REQUIRED | YES |
| AI | Искусственный интеллект | Inteligență artificială | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| DPO | Срок оплаты поставщикам | Termenul de plată la furnizori | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Email | Электронная почта | E-mail | MUST_LOCALIZE | NO |
| FCF | Свободный денежный поток | Flux de numerar liber | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| DSO | Срок оплаты от клиентов | Termenul de încasare de la clienți | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| promo | промоакция | promoție | MUST_LOCALIZE | NO |
| Sheets | Google Sheets | Google Sheets | APPROVED_PROPER_NAME | NO |
| Cash | Деньги | Numerar | MUST_LOCALIZE | NO |
| Make | автоматизация | automatizare | TECHNICAL_INTERNAL_ONLY | NO |
| retrobonus | ретробонус | retrobonus | MUST_LOCALIZE | NO |
| Cash Saving | Денежная экономия | Economie în numerar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| cash flow | денежный поток | flux de numerar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Client Base Control System | Система управления клиентской базой | Sistem de management al bazei de clienți | OWNER_DECISION_REQUIRED | YES |
| Funding Gap | Дефицит финансирования | Deficit de finanțare | OWNER_DECISION_REQUIRED | YES |
| Light | Лёгкий | Simplificat | OWNER_DECISION_REQUIRED | NO |
| Full Cost | Полная стоимость | Costul total | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| BI | аналитика | analiză | MUST_LOCALIZE | NO |
| vacancy | вакантность | grad de neocupare | MUST_LOCALIZE | NO |
| Retail | Розничная торговля | Comerț cu amănuntul | MUST_LOCALIZE | NO |
| CFO- | финансовый | financiar | MUST_LOCALIZE | NO |
| Inventory Days | Дни запасов | Zile de stoc | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| cash gap | кассовый разрыв | gol de numerar | MUST_LOCALIZE | NO |
| email | электронная почта | e-mail | MUST_LOCALIZE | NO |
| Owner | Собственник | Proprietar | MUST_LOCALIZE | NO |
| Retail Margin Engine | Система управления маржой в рознице | Sistem de management al marjei în retail | OWNER_DECISION_REQUIRED | YES |
| tenant rating | рейтинг арендаторов | ratingul chiriașilor | MUST_LOCALIZE | NO |
| NOI | Чистый операционный доход | Venit operațional net | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| rent vs market | аренда против рынка | chiria față de piață | MUST_LOCALIZE | NO |
| ERP | Учётная система | Sistem de evidență | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Margin Gap | Разрыв маржи | Deficit de marjă | OWNER_DECISION_REQUIRED | YES |
| Control System | Система управления | Sistem de management | OWNER_DECISION_REQUIRED | YES |
| Standard | Стандартный | Standard | MUST_LOCALIZE | NO |
| ROI | Отдача от вложений | Randamentul investiției | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Fitness Membership Renewal Engine | Система продления абонементов | Sistem de reînnoire a abonamentelor | OWNER_DECISION_REQUIRED | YES |
| Target Marja | Целевая маржа | Marjă țintă | OWNER_DECISION_REQUIRED | NO |
| Fitness | Фитнес / спортивный бизнес | Fitness / activități sportive | MUST_LOCALIZE | NO |
| Premium | Премиальный | Premium | MUST_LOCALIZE | NO |
| cookies | файлы cookie | fișiere cookie | MUST_LOCALIZE | NO |
| OpenAI | OpenAI | OpenAI | APPROVED_PROPER_NAME | NO |
| NDA | Соглашение о неразглашении | Acord de confidențialitate | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Monthly | Ежемесячно | Lunar | MUST_LOCALIZE | NO |
| Spend | Расходы | Cheltuieli | MUST_LOCALIZE | NO |
| Automation | Автоматизация | Automatizare | MUST_LOCALIZE | NO |
| Monthly owner report | Ежемесячный отчёт собственника | Raportul lunar al proprietarului | OWNER_DECISION_REQUIRED | YES |
| risk traffic light | светофор рисков | semafor de risc | MUST_LOCALIZE | NO |
| profitability | прибыльность | profitabilitate | MUST_LOCALIZE | NO |
| action list | список действий | listă de acțiuni | MUST_LOCALIZE | NO |
| Digital | Цифровой | Digital | MUST_LOCALIZE | NO |
| mini-scan | мини-диагностика | mini-diagnostic | MUST_LOCALIZE | NO |
| Zoom | Zoom | Zoom | APPROVED_PROPER_NAME | NO |
| Cap Rate | Ставка капитализации | Rata de capitalizare | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| RETAIL ENGINE | СИСТЕМА УПРАВЛЕНИЯ МАРЖОЙ | SISTEM DE MANAGEMENT AL MARJEI | OWNER_DECISION_REQUIRED | NO |
| Unit economics | Юнит-экономика | Economia unitară | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| ROAS | Отдача от рекламных расходов | Randamentul cheltuielilor publicitare | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| CAC | Стоимость привлечения клиента | Costul de achiziție a clientului | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| LTV | Пожизненная ценность клиента | Valoarea pe durata de viață a clientului | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Manufacturing | Производство | Producție | MUST_LOCALIZE | NO |
| Support | Поддержка | Suport | MUST_LOCALIZE | NO |
| Treasury & Payment Discipline | Казначейство и платёжная дисциплина | Trezorerie și disciplina plăților | OWNER_DECISION_REQUIRED | YES |
| Payment Gate | Платёжный шлюз | Poarta de plată | OWNER_DECISION_REQUIRED | YES |
| Revenue at Risk | Выручка под риском | Venituri în risc | OWNER_DECISION_REQUIRED | YES |
| Expected Renewal Value | Ожидаемая стоимость продлений | Valoarea așteptată a reînnoirilor | OWNER_DECISION_REQUIRED | YES |
| dashboard | панель собственника | tablou de bord | MUST_LOCALIZE | NO |
| SKU | Товарная позиция | Articol de stoc | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Supplier Shelf Credit | Финансирование товарной полки поставщиком | Finanțarea stocului de către furnizor | OWNER_DECISION_REQUIRED | YES |
| Cost Effect | Эффект себестоимости | Efectul costului | MUST_LOCALIZE | NO |
| Price Effect | Эффект цены | Efectul prețului | MUST_LOCALIZE | NO |
| CAPEX | Капитальные вложения | Investiții de capital | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| stock-out | дефицит товара | lipsă de stoc | MUST_LOCALIZE | NO |
| Available Cash | Доступные деньги | Numerar disponibil | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| governance | управление и контроль | guvernanță și control | MUST_LOCALIZE | NO |
| Supplier Financing Benefit | Выгода от финансирования поставщиком | Beneficiul finanțării de la furnizor | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| COGS | Себестоимость продаж | Costul bunurilor vândute | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Volume Effect | Эффект объёма | Efectul volumului | MUST_LOCALIZE | NO |
| Control Partner | Постоянный финансовый партнёр | Partener financiar permanent | OWNER_DECISION_REQUIRED | YES |
| backtest | ретропроверка | testare retroactivă | MUST_LOCALIZE | NO |
| Mix Effect | Эффект структуры продаж | Efectul structurii vânzărilor | MUST_LOCALIZE | NO |
| Data Model | Модель данных | Model de date | MUST_LOCALIZE | NO |
| Retention Discount Leakage | Потери на скидках удержания | Pierderi din discounturi de retenție | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Executive Summary | Краткое резюме | Rezumat executiv | MUST_LOCALIZE | NO |
| Real Estate Control System | Система управления недвижимостью | Sistem de management imobiliar | OWNER_DECISION_REQUIRED | YES |
| Supplier Rating | Рейтинг поставщиков | Ratingul furnizorilor | MUST_LOCALIZE | NO |
| Free Treasury Cash | Свободные деньги казначейства | Numerar liber de trezorerie | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Supplier-Financed | Профинансировано поставщиком | Finanțat de furnizor | OWNER_DECISION_REQUIRED | YES |
| Own-Funded | Профинансировано собственными деньгами | Finanțat din surse proprii | OWNER_DECISION_REQUIRED | YES |
| Purchase Gate | Контроль закупок | Poarta de achiziție | OWNER_DECISION_REQUIRED | YES |
| Green | Зелёная зона | Zonă verde | MUST_LOCALIZE | NO |
| Yellow | Жёлтая зона | Zonă galbenă | MUST_LOCALIZE | NO |
| Orange | Оранжевая зона | Zonă portocalie | MUST_LOCALIZE | NO |
| Red | Красная зона | Zonă roșie | MUST_LOCALIZE | NO |
| Working Capital | Оборотный капитал | Capital de lucru | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Data Quality | Качество данных | Calitatea datelor | MUST_LOCALIZE | NO |
| Dashboard | Панель собственника | Tablou de bord pentru proprietar | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| DIO | Срок оборота запасов | Durata de rotație a stocurilor | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| EBITDA | Прибыль до вычета процентов, налогов и амортизации | Profit înainte de dobânzi, impozite și amortizare | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Payment Calendar | Платёжный календарь | Calendar de plăți | MUST_LOCALIZE | NO |
| Treasury Fund Planning | Планирование фондов казначейства | Planificarea fondurilor de trezorerie | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Monthly Owner Report | Ежемесячный отчёт собственника | Raportul lunar al proprietarului | OWNER_DECISION_REQUIRED | YES |
| Investment Model | Инвестиционная модель | Model investițional | MUST_LOCALIZE | NO |
| Due AP | Кредиторская задолженность к оплате | Datorii scadente către furnizori | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| Recoverable VAT | Возмещаемый НДС | TVA recuperabilă | OWNER_DECISION_REQUIRED | YES |
| Cash Conversion Cycle | Цикл оборота денег | Ciclul de conversie a numerarului | LOCALIZE_WITH_ENGLISH_ONCE | YES |
| External CFO | Внешний финансовый директор | Director financiar extern | LOCALIZE_WITH_ENGLISH_ONCE | YES |

## 11. Terms with no wording yet

669 rows carry no proposed wording. They are the long tail — mostly one- and two-use
specialist labels on Tier 2 and Tier 3 pages. They are listed in the CSV with an empty
`ru_proposal` so a reviewer can fill them in, and none of them is on the Tier 1 approval path.

---

**Nothing here has been applied.** No customer-facing file, workflow, CRM value, scoring key,
callback or route was modified to produce this register.
