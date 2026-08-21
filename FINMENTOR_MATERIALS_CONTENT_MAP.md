# FINMENTOR — MATERIALS CONTENT MAP

Инвентаризация материалов (current ↔ previous approved). В этом проходе **ни один материал не удалён**; все страницы previous-пакета присутствуют в current. Метаданные не выдуманы: дат публикаций в исходниках нет — они не добавлялись (§14G).

Позиционирование обновлено (§14B): главная — «Практика, методология и собственные разработки FINMENTOR…»; materials.html hero — «профессиональный журнал CFO, а не контент-маркетинг». Категории ниже соответствуют семьям §14C.

| Title | Current file | Category | Author/source | Status | Decision | Public value | Related solution | Proprietary risk | Final URL | Homepage featured |
|---|---|---|---|---|---|---|---|---|---|---|
| Где деньги: Cash Flow для собственника | cash-flow.html | Практика | FINMENTOR (owner) | live | KEEP | Ядро боли «прибыль есть — денег нет» | Business Control System | нет | /cash-flow.html | **Да** |
| Управленческий P&L | upravlencheskiy-pl.html | Практика | FINMENTOR | live | KEEP | Почему бухгалтерской прибыли недостаточно | Business Control System | нет | /upravlencheskiy-pl.html | **Да** |
| Платёжный календарь | platezhnyy-kalendar.html | Практика | FINMENTOR | live | KEEP | Дисциплина платежей 7/14/30 | Treasury & Payment Discipline | нет | /platezhnyy-kalendar.html | Нет (в базе) |
| Казначейство и водопад платежей | kaznacheystvo.html | Методология | FINMENTOR | live | KEEP (+ теперь цель map-строки) | Система приоритетов и покрытия | Treasury / Waterfall | нет | /kaznacheystvo.html | Нет |
| Treasury Waterfall | treasury-waterfall.html | Методология | FINMENTOR | live | KEEP (+ цель map-строки) | Остаток ≠ свободные деньги | Fund Planning & Waterfall | нет | /treasury-waterfall.html | **Да** |
| Оборотный капитал | working-capital.html | Практика | FINMENTOR | live | KEEP (+ цель map-строки) | Где заморожены деньги; мост к mini-scan | Working Capital Control | нет | /working-capital.html | **Да** |
| FCF по SKU и поставщики | fcf-postavshiki.html | Практика | FINMENTOR | live | KEEP (+ цель map-строки) | Товары-«cash destroyers» | SKU Cash Flow Analysis | нет | /fcf-postavshiki.html | **Да** |
| Рейтинг поставщиков и приоритеты закупок | supplier-rating-purchasing-priorities.html | Методология | FINMENTOR | live | KEEP (+ цель map-строки) | Закупки по финансовой логике | Supplier Rating | нет | /supplier-rating-purchasing-priorities.html | Нет |
| Факторный анализ маржи и флаги | margin-factor-analysis-flags.html | Методология | FINMENTOR | live | KEEP (+ цель map-строки) | Почему изменилась маржа | Margin Factor Analysis | нет | /margin-factor-analysis-flags.html | Нет |
| Power BI для собственника | power-bi-dlya-sobstvennika.html | Разработки / Digital | FINMENTOR | live | KEEP (+ цель map-строки) | Панель собственника как продукт мышления | Power BI Owner Dashboard | нет | /power-bi-dlya-sobstvennika.html | Нет |
| AI для CFO (Make / n8n) | ai-dlya-cfo.html | Разработки / Digital | FINMENTOR | live | KEEP (+ цель map-строки) | Автоматизация с ограничениями и рисками | n8n / Make Automation | нет | /ai-dlya-cfo.html | Нет |
| Методология FINMENTOR | methodology.html | Методология | FINMENTOR | live | KEEP | 4 опоры финансового контроля | Business Control System | концептуальный уровень — ок | /methodology.html | Нет |
| Retail Margin Engine (страница модели) | retail-margin-engine.html | Разработки (продукт-слой) | FINMENTOR | live | **REWRITE** (Excel-инвентарь → клиентская выгода) | Флагманская разработка | Retail Margin Engine | внутренние счётчики убраны из витрины | /retail-margin-engine.html | **Да** (тег «Разработка FINMENTOR · Retail») |
| Кейсы / сценарии | cases.html | Практика | FINMENTOR | live | KEEP | Proof: проблема → инсайт → решение | все | нет | /cases.html | ссылка из proof |
| Шаблоны | templates.html | Разработки | FINMENTOR | live | KEEP | Вход через инструменты | — | нет | /templates.html | кнопка блока |
| Тизер «Supplier Shelf Credit» (карточка) | был на главной (дубль URL retail-модели) | Практика | FINMENTOR | удалён ранее как дубль | KEEP REMOVED — **RECOMMEND**: развернуть в отдельную статью (тема сильная) | Кто финансирует полку | Retail Margin Engine | нет | — (нет своей страницы) | Нет |
| Тизер «Финансовая система собственника» (карточка) | вела на business-control-system.html | — (сервисная страница, не материал) | FINMENTOR | удалён ранее с витрины материалов | KEEP REMOVED (сервис живёт в лестнице) | — | Business Control System | нет | /business-control-system.html | Нет |

## Три слоя (§14H) — зафиксировано в архитектуре
Пример AI Economics: **продукт** ai-agent-economics.html (коммерческое объяснение) ≠ **разработка/методология** (SCALE/OPTIMIZE…, Human Baseline — концептуальный уровень на странице и в методологии) ≠ **материал** (будущие статьи в «Материалах»). Аналогично Retail: страница модели = продукт; счётчики/архитектура — внутренняя разработка (не публикуется); карточка в материалах = материал-слой.

## Workflow добавления материала (§14J, без CMS)
1) Создать `<slug>.html` копированием ближайшей по типу страницы (doc-шаблон уже общий: doc-bar, doc-hero, footer). 2) Заполнить title/description/canonical/OG + H1, категорию в eyebrow, тезис в lead, тело. 3) Добавить карточку в соответствующую категорию materials.html. 4) При желании — в featured-блок главной (лимит 6, вытеснив слабейшую). 5) Добавить `<url>` в sitemap.xml. Никакой пересборки архитектуры не требуется.
