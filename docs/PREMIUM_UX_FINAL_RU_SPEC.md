# FINMENTOR Premium Mini App — FINAL RU UX & CONTENT SPECIFICATION

**Status: DESIGN = FINAL APPROVED. Content locked 2026-08-29.**

This document is the authoritative design and content contract for the Premium Telegram Mini App.
It preserves the approved canvas so that implementation does not depend on it. Where this document
and the canvas differ, this document wins. Implementation MUST NOT invent, consolidate, rename or
remove copy, options or branches beyond what is written here.

Approved canvas (reference only): https://claude.ai/code/artifact/329af337-2f23-4230-bd83-019657eca301

Sample content used on the canvas for layout proof — company names, quoted problems, file names,
the bank-meeting note — is illustrative and is **not** a product requirement.

---

## 1. Product principles

- The client is preparing a **confidential brief for a consultant**, not filling in a form.
- Target feeling: private banking, investment advisory, executive board material.
- FINMENTOR asks only what it does not already know (§15).
- One dominant primary action per screen.
- Value is carried by hierarchy, whitespace, typography and what the firm already understands —
  never by decoration, gamification or fake precision.
- No emoji, no chat bubbles as the primary interface, no audit / legal / guarantee language, no
  automatically generated diagnosis.
- Russian is the client-facing language. `CONFIDENTIAL BRIEF` may remain only as a very small
  brand micro-label. Prefer *бриф*, *консультант*, *подготовка к встрече* over English product
  terms in normal copy. Established financial terms (Cash Flow, P&L, IRR, DCF) are used as-is.

## 2. Telegram Concierge vs Mini App

    Telegram Concierge → Premium Mini App Confidential Brief → Review → explicit submit
                       → committed Success → Telegram continuation

- The Concierge remains the conversational entry and the channel for continuation.
- The Mini App owns qualification, the brief, review, edit, explicit submit, and the success /
  failure presentation.
- Identity and role known from Telegram / the Concierge are carried into the Mini App and are not
  asked again (§15).
- Submission reaches Lead Intake through the existing Gateway contract; the Mini App introduces no
  new backend contract. See `PREMIUM_UX_IMPLEMENTATION_HANDOFF.md`.

## 3. Approved visual-system contract

Brand continuity from `app/app.css` (navy ground, Playfair Display / Manrope / JetBrains Mono,
gold), elevated as follows. This is the approved system and is not to be redesigned.

| Token | Value | Use |
|---|---|---|
| Navy (ground) | `#08111F` | page background, flat — no gradients |
| Surface | `#0D1B2E` | cards, fields — solid, no glass, no blur |
| Selected surface | `#11223A` | chosen card / row |
| Ivory | `#F2EEE4` | primary text; 70% / 50% / 36% / 22% alphas for hierarchy |
| Hairline | ivory 8% | card borders; 18% strong; 46% selected border |
| Gold | `#C9A227` | **primary CTA only** — never a fill, never a gradient |
| Champagne | `#D9C58C` | active stage, brief rule lines, carry-forward check, selective details |
| Amber | `#D5A65B` | failure icon ring only |
| Display | Playfair Display 500 | one title per screen, 32–36px, −.02em; italic 17px for the client's quoted words |
| Body / UI | Manrope | 15.5px / 1.6 body; 17px 600 card titles; 13.5px card lines |
| Mono | JetBrains Mono 500 | 10–10.5px, .16em, uppercase: labels, stages, file names |

Rules: selection is ivory, not gold; no left-border accents; no consumer-fintech / SaaS styling;
one calm reveal motion (opacity + 8px rise, ~360ms) with `prefers-reduced-motion` respected.

## 4. Exact 8-objective taxonomy

Screen title: **Что сейчас важнее всего?** Lead: *Один пункт. Остальное консультант уточнит в
разговоре.* Rendered as advisory cards (title + one explanatory line). Scrolling is acceptable;
categories are never compressed to fit one viewport. Exactly eight, in this order:

1. **Финансовое управление** — Отчётность, бюджетирование, контроль, финансовая функция
2. **Прибыль и эффективность** — Маржа, расходы, себестоимость, экономика бизнеса
3. **Денежный поток** — Cash Flow, кассовые разрывы, ликвидность
4. **Инвестиция / новый проект** — Финмодель, доходность, сценарии, риски
5. **Недвижимость / сделка** — Покупка, продажа, аренда, инвестиционная оценка
6. **Финансирование** — Банк, инвестор, структура капитала
7. **Нужен независимый взгляд** — Помочь определить, где находится основная проблема
8. **Другая задача** — Если задача не подходит под категории выше

CFO-сопровождение is **not** a top-level objective.

Every standard branch runs: Objective → Problem → Desired Outcome → Current Setup → Decision
Horizon → Documents → Contact / Important Context → Review. Only Problem, Desired Outcome and
Focus of First Meeting differ per branch.

## 5. Exact Problem sets

Card branches list options as **Title — explanatory line** (or title only where the spec gives no
line). *Опишу ситуацию своими словами* is always the last option and opens a free-text field.

### 5.1 Финансовое управление — «Где сейчас основная сложность?»
- Нет своевременной управленческой отчётности — Цифры появляются слишком поздно для принятия решений
- Не доверяем данным — Отчёты есть, но цифры расходятся или вызывают вопросы
- Нет бюджета и план-факта — Сложно контролировать отклонения и заранее видеть результат
- Финансы зависят от ручной работы — Много Excel, сверок и процессов, завязанных на отдельных людей
- Нет полноценной финансовой функции — Нужно выстроить роль CFO, ответственность и систему управления
- Система есть, но хотим её улучшить — Нужно повысить качество, скорость и управляемость
- Опишу ситуацию своими словами

### 5.2 Прибыль и эффективность — «Где сейчас теряется экономический результат?»
- Не понимаем реальную прибыль — Бухгалтерский результат не даёт полной управленческой картины
- Снижается маржа — Выручка есть, но прибыльность бизнеса ухудшается
- Расходы растут быстрее бизнеса — Нужно определить причины и точки контроля
- Не видим прибыль по направлениям — Непонятно, какие продукты, объекты или подразделения создают результат
- Не уверены в себестоимости — Нужно правильно распределить затраты и определить экономику продукта
- Нужно пересмотреть цены — Нет уверенности, что текущая цена обеспечивает нужную доходность
- Опишу ситуацию своими словами

### 5.3 Денежный поток — «Что именно происходит с деньгами?»
- Прибыль есть, денег не хватает — Продажи идут, но на счёте постоянно тесно
- Нет ясного прогноза — Непонятно, что будет с деньгами через 2–3 месяца
- Кассовые разрывы повторяются — Приходится закрывать их срочно и дорого
- Платежи идут хаотично — Нет календаря и приоритетов по оплатам
- Проблемы с дебиторкой — Деньги слишком долго остаются у клиентов
- Опишу ситуацию своими словами

### 5.4 Инвестиция / новый проект — «Какое решение нужно принять по проекту?»
- Стоит ли инвестировать — Нужно объективно оценить экономическую целесообразность
- Неясна реальная доходность — Нужно проверить возврат капитала и денежные потоки
- Слишком много неопределённости — Нужно сравнить сценарии и ключевые риски
- Есть предложение партнёра — Нужно проверить экономику и условия сделки
- Нужно определить объём инвестиций — CAPEX и будущая потребность в финансировании пока неясны
- Есть финансовая модель, но ей не доверяем — Нужна независимая проверка
- Опишу ситуацию своими словами

### 5.5 Недвижимость / сделка — «Какое решение рассматриваете?»
- Покупка объекта
- Продажа объекта
- Оставить объект и сдавать в аренду
- Нужно определить справедливую стоимость
- Реконструкция / redevelopment
- Нужно проверить доходность объекта
- Есть риск по арендатору или договору
- Опишу ситуацию своими словами

### 5.6 Финансирование — «Что сейчас требует решения?»
- Нужно банковское финансирование
- Нужно привлечь инвестора
- Не устраивает текущая долговая нагрузка
- Нужно рефинансирование
- Нужно финансирование нового проекта
- Нужно подготовиться к переговорам с банком
- Неясно, сколько долга бизнес может безопасно обслуживать
- Опишу ситуацию своими словами

### 5.7 Нужен независимый взгляд — free text only (§7)

### 5.8 Другая задача — free text only (§8)

## 6. Exact Desired Outcome sets

Rendered as advisory cards. Single selection: "в первую очередь".

### 6.1 Финансовое управление — «Какой результат вам нужен в первую очередь?»
- Получать управленческую отчётность вовремя — P&L, Cash Flow, Balance и ключевые показатели
- Настроить бюджетирование и план-факт — Планировать результат и контролировать отклонения
- Создать понятную систему финансового контроля — Ответственность, правила, сроки и контрольные точки
- Выстроить финансовую функцию / CFO — Определить процессы, роли и формат управления
- Автоматизировать финансовую отчётность — Снизить ручную работу и зависимость от Excel
- Провести диагностику существующей системы — Понять, что работает, а что необходимо перестроить

### 6.2 Прибыль и эффективность — «Что хотите получить на выходе?»
- Понять реальную прибыльность бизнеса
- Найти источники потерь и лишних расходов
- Посчитать прибыль по направлениям / продуктам
- Определить корректную себестоимость
- Пересмотреть цены и маржинальность
- Создать систему постоянного контроля эффективности

### 6.3 Денежный поток — «Какой результат вам нужен в первую очередь?»
- Понять причины кассовых разрывов — Найти, где именно теряется ликвидность
- Получить прогноз движения денег — Понимать cash position на несколько месяцев вперёд
- Настроить платежи и контроль — Платёжный календарь, приоритеты, ответственность
- Подготовиться к банку / финансированию — Показать понятный прогноз и способность обслуживать обязательства
- Построить систему управления Cash Flow — Не разовый расчёт, а работающий процесс
- Нужна рекомендация, с чего начать — Сначала определить правильный формат решения

### 6.4 Инвестиция / новый проект — «Какой результат вам нужен?»
- GO / NO-GO по инвестиции
- Профессиональная финансовая модель
- Расчёт IRR / NPV / Payback / MOIC
- Сравнение нескольких сценариев
- Оптимальная структура финансирования
- Независимая проверка проекта или предложения партнёра

### 6.5 Недвижимость / сделка — «Что нужно получить для принятия решения?»
- Оценить инвестиционную привлекательность
- Определить максимальную цену покупки
- Определить минимальную цену продажи
- Посчитать доходность владения
- Сравнить: продать или оставить
- Построить DCF / сценарную модель
- Оценить риски арендаторов и денежных потоков

### 6.6 Финансирование — «Какого результата ожидаете?»
- Определить необходимый объём финансирования
- Подготовить финансовую модель для банка
- Определить безопасную долговую нагрузку
- Сравнить варианты финансирования
- Подготовить материалы для инвестора
- Выстроить структуру капитала

### 6.7 Нужен независимый взгляд — «Чем FINMENTOR должен помочь в первую очередь?»
- Разобраться, где находится основная проблема
- Определить приоритеты
- Получить независимую оценку ситуации
- Понять, какие цифры нужно начать контролировать
- Подготовить варианты решения
- Сначала обсудить ситуацию с консультантом

### 6.8 Другая задача — «Какой результат был бы для вас полезен?»
- Получить расчёт
- Получить финансовую модель
- Сравнить варианты
- Проверить существующий расчёт / предложение
- Получить независимую рекомендацию
- Обсудить задачу с консультантом
- Опишу ожидаемый результат сам

## 7. Independent View — free-text behaviour

There are **no** diagnostic Problem cards. The Problem screen is free text only.

- Title: **Какое решение сейчас сложно принять?**
- Copy: *Опишите ситуацию своими словами.*
  *Особенно полезно понять, какое решение вы откладываете или где вам не хватает финансовой информации.*
- Placeholder: *Например: бизнес растёт, но я не понимаю, почему денег становится меньше и могу ли сейчас открывать ещё одну точку.*
- FINMENTOR does **not** automatically diagnose the client from this text.
- Desired Outcome: §6.7. Focus: §17.

## 8. Other Task — free-text behaviour

The client selects the **Другая задача** advisory card on the Objective screen; free text does
**not** live on the Objective screen. The next (Problem) screen is free text.

- Title: **Расскажите о задаче**
- Copy: *Опишите ситуацию так, как рассказали бы её консультанту на первой встрече.*
- Placeholder: *Что происходит, какое решение нужно принять и что сейчас мешает его принять?*
- Desired Outcome: §6.8 (the universal set). Focus: §17.

## 9. Company / role / scale rules

Screen title **Компания**, lead *Только то, что меняет подготовку консультанта.*

- **Роль** — carried forward from Telegram / the Concierge when known; shown as a confirmed item
  with *Изменить*, never re-asked (§15).
- **Название** — free text.
- **Чем занимается** — one free-text line (activity / sphere).
- **Масштаб · годовой оборот** — single select, exactly:
  - до €500 тыс.
  - €500 тыс. – €2 млн
  - €2–10 млн
  - €10–50 млн
  - €50 млн+
  - Предпочитаю не указывать

Nothing above €10 млн is collapsed into one band.

## 10. Current Setup — multi-select

- Title: **На что уже можно опереться?**
- Copy: *Выберите всё, что действительно используется сегодня.*
- Options (multiple allowed), exactly: Бухгалтерский учёт · 1C / ERP · Excel / ручные отчёты ·
  Управленческий P&L · Cash Flow · Бюджет · План-факт · BI / dashboards · CFO / финансовая команда ·
  Финансовая модель · Система есть, но требует улучшения
- The UI makes no mutually-contradictory assumptions. Consistency rules (e.g. deriving
  *CFO отсутствует* from *CFO / финансовая команда* not being selected) may be applied by
  implementation later and are not a UI concern.

## 11. Decision Horizon — locked

Title: **Когда решение должно начать работать?** Single select, exactly five:

- В течение недели — Есть конкретная ситуация или решение
- 2–4 недели — Результат нужен в ближайший месяц
- 1–3 месяца — Можно провести полноценный цикл анализа
- Сначала хочу обсудить подход — Пока уточняем задачу и формат работы
- Жёсткого срока нет

## 12. Documents — copy and data minimisation

- Title: **Материалы для подготовки**
- Copy: *Если у вас уже есть документы по задаче, они помогут консультанту быстрее войти в контекст.*
  *Специально готовить материалы сейчас не требуется.*
- Primary CTA: **Добавить материалы**
- Secondary: **Продолжить без материалов**
- Data-minimisation copy (visually secondary, calm, not alarming):
  *Загружайте только материалы, необходимые для рассмотрения задачи.*
  *По возможности не включайте персональные данные сотрудников, клиентов или других третьих лиц, если они не нужны для анализа.*
- Attached files are listed by name in JetBrains Mono.

## 13. Contact rules

- Title: **Как удобнее продолжить?**
- Options, exactly: **Здесь, в Telegram** · **По телефону** · **По email**
- If Telegram is chosen: do **not** ask for phone or email (*В Telegram номер телефона не нужен.*).
- Followed on the same screen by Important Context (§14).
- Primary CTA: **Сформировать бриф**.

## 14. Important Context — optional

- Field label: **Есть ли что-то, что особенно важно знать до разговора?**
- Optional.
- Placeholder: *Например: через месяц встреча с банком; решение нужно принять до определённой даты; есть предложение партнёра, которое необходимо проверить.*
- **If empty, the entire «Важно до встречи» section is omitted from Review.** Never show
  `Важно до встречи: —`; never show the placeholder as final content.

## 15. Smart-skip rules

FINMENTOR asks only what it does not already know.

- Information may be skipped **only** when it was explicitly provided by the user or explicitly
  confirmed by the user. AI inference alone is **not** enough to skip a question.
- Known information is carried forward and shown as a confirmed item (champagne check, source note
  such as *из Telegram*, an *Изменить* affordance). Never ask the client to repeat it.
- The **smart context strip** appears once enough context exists (from Decision Horizon onward):

      УЖЕ ПОНЯТНО
      Retail · €2–10 млн · Собственник
      Cash Flow
      1C + бухгалтерия
      Осталось уточнить срок и материалы.

  It restates what is understood and names only what is left. It is not a progress score.
- Three states are distinguished by treatment, never by technical labels: explicitly provided
  (plain), confirmed (check + source), not yet known (named in *Осталось уточнить…*).

## 16. Review structure

Review is an executive consultant brief, not a form summary.

- Header micro-labels: `FINMENTOR` · `CONFIDENTIAL BRIEF` (rule line in champagne).
- Title: **Бриф для консультанта**. Lead: *Проверьте, правильно ли FINMENTOR понял ситуацию.*
- Body, in this order, each section rendered **only where available**:
  1. Компания (display serif) · Деятельность · Роль · Масштаб
  2. **ЗАДАЧА** — see §26
  3. **ПРОБЛЕМА** — the selected Problem, or the client's entered text quoted in italic serif
  4. **ОЖИДАЕМЫЙ РЕЗУЛЬТАТ** — the selected / entered Desired Outcome
  5. **ТЕКУЩАЯ СИСТЕМА** — the selected Current Setup items
  6. **ГОРИЗОНТ**
  7. **МАТЕРИАЛЫ** — file names, mono; omitted when none
  8. **ВАЖНО ДО ВСТРЕЧИ** — omitted when empty (§14)
- **ФОКУС ПЕРВОЙ ВСТРЕЧИ** — three lines from the controlled map (§17), followed by the small
  disclaimer *Финальный объём анализа консультант определит после изучения материалов.*
- **ПОДГОТОВКА К ВСТРЕЧЕ** — Контекст компании — готов · Задача — готова · Материалы — see §27
- Copy: *Этого достаточно, чтобы консультант подготовился к первому разговору.*
- Actions: primary **Передать консультанту** · secondary **Изменить** · tertiary **Добавить важное**

The four concepts ЗАДАЧА / ПРОБЛЕМА / ОЖИДАЕМЫЙ РЕЗУЛЬТАТ / ФОКУС ПЕРВОЙ ВСТРЕЧИ are distinct and
must never be collapsed.

## 17. Focus of First Meeting — controlled map

This is **not** an unrestricted AI diagnosis. It is a controlled advisory preparation map keyed by
the selected top-level objective, exactly:

| Objective | Фокус первой встречи |
|---|---|
| Финансовое управление | Качество управленческой информации · Планирование и контроль · Организация финансовой функции |
| Прибыль и эффективность | Факторы прибыли и маржи · Себестоимость и структура расходов · Экономика направлений / продуктов |
| Денежный поток | Ликвидность и причины cash gap · Оборотный капитал · Прогноз движения денежных средств |
| Инвестиция / новый проект | Экономика проекта и исходные допущения · Доходность и чувствительность сценариев · Структура инвестиций и ключевые риски |
| Недвижимость / сделка | Денежный поток объекта · Доходность и стоимость капитала · Сценарии владения / продажи |
| Финансирование | Потребность в капитале · Способность обслуживать обязательства · Структура финансирования |
| Нужен независимый взгляд | Управленческое решение, которое нужно принять · Качество доступной финансовой информации · Приоритеты для дальнейшего анализа |
| Другая задача | Контекст задачи · Решение, которое требуется принять · Каких данных не хватает для следующего шага |

Disclaimer under the block: *Финальный объём анализа консультант определит после изучения материалов.*

## 18. Privacy treatment

No mandatory legal checkbox. Marketing consent is absent; if ever added it must be separate,
optional and off by default, and visually distinct from this acknowledgement.

- Entry screen carries a small trust link with a lock icon: **Конфиденциальность и данные**.
- At Submit, discreet but readable, directly above the CTA:
  *FINMENTOR использует указанные вами данные для рассмотрения обращения, подготовки консультанта и связи с вами.*
  *Передавая brief, вы подтверждаете, что ознакомились с информацией об обработке персональных данных.*
  *Результаты Финансового рентгена бизнеса (Financial X-Ray) и план действий на 30 дней готовятся автоматизированно с участием искусственного интеллекта на основе обезличенных ответов и являются предварительным управленческим анализом, а не аудитом и не индивидуальной финансовой консультацией. Итоговые экспертные рекомендации FINMENTOR формируются после проверки человеком. Технические записи об обработке (без персональных данных) хранятся в Supabase (ЕС).*
  <!-- Third line added under GATE 1, owner-approved 2026-09-04. It is the only place on this screen
       that states the analysis is AI-assisted, preliminary and human-reviewed before release, and
       that the technical processing records carry no personal data. -->
- Links: **Как мы обрабатываем данные** · **Политика конфиденциальности** — both open the public
  Privacy Policy for the session locale (RU `/privacy.html`, RO `/ro/privacy.html`). Under GATE 1
  these were `href="#"`; there is no in-app privacy modal and no second privacy system.
- The entry-screen trust link opens the same page.
- Primary CTA remains **Передать консультанту**.
- No unsupported claims ("military-grade encryption", "100% secure" or similar) anywhere.

## 19. Edit behaviour

- From Review, **Изменить** opens the Edit Selector: title **Что хотите изменить?**, lead
  *Поправим один пункт и вернёмся к брифу.*
- Rows, each showing its current value: Компания · Роль · Масштаб · Задача · Проблема ·
  Ожидаемый результат · Текущая система · Срок · Материалы · Контакт · Важный контекст
- Editing one item returns **directly to Review**. The questionnaire is never restarted.
- Secondary action: **Вернуться к брифу**.

## 20. Submit behaviour

- Title: **Передать бриф консультанту?**
- Compact brief card: company · objective · horizon · attachment count · reply channel.
- Privacy copy and links (§18).
- Primary **Передать консультанту** · tertiary **Вернуться к брифу**.
- Submission calls Lead Intake through the existing Gateway contract exactly once per cycle;
  success is defined **only** by the canonical `ok === true` response. See §23.

## 21. Success copy

Shown **only** after actual committed success. No public request / reference number in v1; no
internal IDs exposed. Exactly:

    Принято

    {Компания} · {Задача}             ← the actual company name and selected objective label
    Статус: Передано консультанту

    Контекст передан команде FINMENTOR.

    ← the materials sentence, chosen by the draft (§21.1)

    Повторять всё сначала не потребуется.

    Что дальше
    1. FINMENTOR изучит бриф.
    2. При необходимости уточним детали.
    3. Согласуем следующий контакт.

    [ Вернуться в Telegram ]

No further questionnaire is offered on this screen.

### 21.1 The materials sentence is chosen by the draft, not written into the copy

v1 records **availability**, never an upload (OWNER DECISION A, §26). The screen may say what the
consultant will SEE. It may never say that anything was attached. Two sentences, and the draft
decides which one appears:

Materials were declared (`documents` holds one or more values):

    Консультант увидит информацию о компании, вашу задачу и какие материалы доступны
    до первого разговора.

No materials were declared:

    Консультант увидит информацию о компании и вашу задачу до первого разговора.

There is no third variant. An empty «материалы» concept is never rendered — the sentence is
replaced, not emptied.

Wording such as **приложенные материалы**, **приложенные файлы**, **файлы приложены** or
**документы загружены** is FORBIDDEN on every customer-facing screen for as long as the product
has no uploaded-file artifacts. Only an authoritative uploaded-file artifact may license it, and
the sentence would then have to be added here first.

### 21.2 «Вернуться в Telegram» closes the Mini App and does nothing else

The CTA calls the Telegram Web App close, through the client's single Telegram integration point.
It performs no request, mutates no session, opens no new cycle and starts no new request. If the
Telegram client does not act on the close, the screen states how to leave rather than leaving a
control that appears dead:

    Если окно не закрылось, закройте его в верхней части экрана Telegram.

That line is shown only after a close that did not happen. It is never part of the screen as
first rendered.

## 22. Failure copy

Clearly distinct from Success. Calm professional styling: amber icon ring, no full-screen red, no
reassuring language implying acceptance. Exactly:

    Заявка пока не отправлена

    Возникла техническая ошибка при передаче.
    Ваше обращение не считается принятым.
    Повторно проходить вопросы не нужно.

    [ Повторить отправку ]
    [ Вернуться к резюме ]

## 23. Terminal / no-requalification UX rule

- After committed success the cycle is terminal: no requalification without an explicit new
  request. Success offers only **Вернуться в Telegram**.
- Retry after failure is idempotent and never creates a second lead once a canonical `lead_id`
  exists; local draft answers are preserved.
- Review and Edit operate on the same cycle; only an explicit new request starts a new one.
- Success is shown only on canonical `ok === true`; HTTP 2xx, a parseable body or the absence of
  an exception are not success. A response of `ok:false, retryable:true` shows the Failure screen.

## 24. Approved visual component rules

- **Advisory card**: title 17px/600 + optional 13.5px explanatory line; 18–20px padding; radius
  16; hairline border; selected = ivory 46% border + selected surface + ivory check. A card
  without an explanatory line is the same component with the second row omitted.
- **Row**: 58px min height, 16×18 padding, radius 14; single- and multi-select share the
  treatment; selected rows show the check.
- **Free-text field**: 12px radius, surface fill, hairline; placeholder in ivory 36%.
- **Known / carried-forward item**: champagne border and check, value, source note, *Изменить*.
- **Smart context strip**: champagne top rule, mono `УЖЕ ПОНЯТНО`, ivory lines, muted remainder.
- **Primary CTA**: 56px, gold fill, ink text, radius 12 — once per screen.
- **Secondary**: 52px outlined ivory. **Tertiary**: 44px text.
- **Stages**: four mono labels **Контекст · Задача · Подготовка · Проверка**; active in
  champagne with a hairline underline; no percentages, no step counts.
- **Review memo**: mono uppercase section labels in ivory 36%; values 15.5px ivory; the client's
  words in italic serif 17px; status rows with check (ivory) or dot (muted).

## 25. 390px mobile fit constraints

- Primary target: 390px Telegram WebView; content width 346px (22px side padding).
- Tap targets ≥ 44px; controls 56–58px.
- Verified longest strings at 390px: card title 53 chars → 2 lines; card explanatory line
  65 chars → 2 lines; row 34 chars → 1 line; screen title 45 chars → 3 lines at 32px.
- Screens may scroll (Objective with eight cards, Review). Nothing is compressed to fit one
  viewport.
- No horizontal scrolling; safe-area insets respected; no fake status bar or keyboard.

## 26. Review task-label rule

The Review field **ЗАДАЧА** must **always** display the exact user-selected top-level Objective
label — e.g. *Денежный поток*, *Инвестиция / новый проект*, *Недвижимость / сделка*,
*Финансовое управление*. Never derive a new label (e.g. "Управление Cash Flow").

    ЗАДАЧА               = selected top-level Objective
    ПРОБЛЕМА             = selected / entered Problem
    ОЖИДАЕМЫЙ РЕЗУЛЬТАТ  = selected / entered Desired Outcome
    ФОКУС ПЕРВОЙ ВСТРЕЧИ = controlled advisory map (§17)

Four distinct concepts; never collapsed.

## 27. Factual materials-status rule

Document completeness is never inferred. The **ПОДГОТОВКА К ВСТРЕЧЕ** block uses factual states
only:

- **Материалы — указаны**
- **Материалы — не указаны**

Subjective states such as *частично* or *готовы* are not used. Completeness is never claimed
unless a future explicit completeness rule exists.

The states say what the client DECLARED, because that is the only thing the product knows. They
said *приложены* / *не приложены* until 2026-08-30, which claimed an attachment that cannot exist
in v1 — the same false claim §21.1 forbids on the success screen, in the one place a consultant
would read it as a fact about files. The underlying field and its selected values are unchanged:
`documents` still carries «Бюджет», «Cash Flow» and the rest into the brief, and still means
*the client says this is available*.
