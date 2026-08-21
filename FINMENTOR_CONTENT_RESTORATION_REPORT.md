# FINMENTOR — CONTENT RESTORATION REPORT

Сравнение: **PREVIOUS APPROVED** (`finmentor_ai_economics_release_a_photo_updated.zip`) ↔ **CURRENT** (`finmentor_premium_final_candidate.zip`).
Классификация: RESTORE / KEEP REMOVED / MERGE / REWRITE. Ни одна дополнительная секция в этом проходе не удалена.

| # | Секция | Previous state | Fable-refined state | Final decision | Restored? | Why |
|---|--------|----------------|--------------------|----------------|-----------|-----|
| 1 | Hero: 3-я кнопка «Решения ↓» | Полноразмерная кнопка | Тихая текст-ссылка | KEEP (refined) | — | Улучшение CTA-иерархии подтверждено владельцем («keep good refinement») |
| 2 | Hero: счётчики «15+ / 5 опор / 10 кейсов» | Анимированный stats-блок | Одна строка доверия | KEEP REMOVED | Нет | «5 опор» / «10 кейсов» — внутренний жаргон, SaaS-паттерн; факты сохранены в строке доверия |
| 3 | Полоса различий Учёт/BI/FINMENTOR | Отсутствовала | Добавлена (институциональная формулировка) | KEEP (refined) | — | Прямо названа владельцем как improvement |
| 4 | Industry-карточки: строки «Расчётная методология» (Real Estate, Retail) | Присутствовали | Удалены | **RESTORE (REWRITE)** | **Да** | Полезная продуктовая глубина; восстановлены из previous-формулировок, у Retail — без счётчиков Excel |
| 5 | Грид «Расчётные методологии» (6 карточек: метрики + решения) | Присутствовал | Удалён | **MERGE** | Частично | ~90% дублировал industry-карточки; уникальная ценность (метрики/решения) возвращается через п. 4 и обогащённые строки system map; сам грид не возвращается (card fatigue) |
| 6 | Callout «Одна CFO-логика — разные активы» | Присутствовал | Сохранён + note | REWRITE | — | Из note убрана ссылка на «v1.2» (не продаём Excel) |
| 7 | Audience: финальный primary-CTA | Присутствовал (3-й подряд) | Заменён текстовым мостиком | KEEP REMOVED | Нет | CTA-инфляция; primary-путь стал ценнее |
| 8 | Модули: 9 карточек (desc + 4 буллета + CTA) | Присутствовали | Сжаты до 1 строки боли | **RESTORE (MERGE + REWRITE)** | **Да** | Ключевая жалоба владельца: описания потеряны. Каждая строка map обогащается: боль + что получает собственник (из буллетов previous), «Подробнее →» |
| 9 | Таблица «Как выбрать» (боль → модуль) | Присутствовала | Слита в строки map | KEEP REMOVED (MERGE) | — | Формулировки болей уже живут в строках map |
| 10 | **Ссылки модулей → questionnaire?topic=** | Так было и в previous | Сохранено | **REWRITE (FIX)** | — | Подтверждённый дефект journey: все 9 решений теперь ведут на **свои страницы** (см. Links Audit ниже); Financial X-Ray остаётся диагностическим входом, а не подменой описания |
| 11 | Флагманская подача Retail Margin Engine | Карточка с «19 листов, 4 900+ формул, QA 19/19, v1.2» | Строка в map с тем же тегом | **REWRITE (RESTORE depth, remove Excel-selling)** | **Да** | Новый editorial-блок «Флагманская модель» по стандарту §7: боль → риск → что строит → что видит → решения → deliverable → для кого → как начинаем → CTA; все счётчики Excel переведены в клиентскую выгоду |
| 12 | Proof: deliverables 8 боксов | Card-grid | Лёгкий список | KEEP (refined) | — | Контент полностью сохранён, сменилась только форма |
| 13 | Proof: ссылка «Смотреть все сценарии» | Отсутствовала | Добавлена | KEEP (refined) | — | Закрыт dead-end |
| 14 | Mini-scan: два конкурирующих блока | H2-блок + band, 2 CTA | Один band, 1 CTA + текст-ссылка | KEEP (refined, MERGE) | — | Контент сохранён, устранена конкуренция диагностик |
| 15 | Материалы: 8 → 6 карточек | 8 (2 дубля: Supplier Shelf Credit → тот же URL; «Финансовая система собственника» → сервисная страница) | 6 уникальных | KEEP REMOVED + REWRITE | Нет | Дубли URL подрывали доверие; обе целевые страницы живы и залинкованы из map/лестницы. Блок перепозиционирован как интеллектуальный капитал (см. 14A-задание) |
| 16 | Materials-теги «Retail Margin Engine v1.2» | v1.2 в теге и описании | Так же | REWRITE | — | Версии/счётчики убраны из клиентской витрины |
| 17 | Intro 4400 мс | 4400 мс (approved) | 1300 мс | **RESTORE** | **Да** | Точные значения восстановлены из previous package: INTRO_MS 4400; буквы 0.7s / 0.3+0.09i; shimmer 1.1s @1.35s; tagline 0.9s @2.1s |
| 18 | Мобильное меню | Гигантская serif-типографика, по центру, без скролла — присутствовало и в previous | То же (не трогалось) | **REWRITE (P0 FIX)** | — | Подтверждённый дефект обеих версий: перестроена только презентация (типографика, компоновка, скролл, safe-area, scroll-lock); IA и логика JS не тронуты |
| 19 | Cookie-баннер: логика + компакт-мобайл | Логика approved | Логика та же + компактный мобайл | KEEP (refined) | — | Названо владельцем как fix to preserve |
| 20 | AI Economics (страница + тизер) | Approved | Не тронуты | KEEP | — |ざ пределами задачи; сохранены |
| 21 | Пакеты / цены / кейсы / методология / X-Ray логика / webhook / GA4 / consent | Approved | Не тронуты | KEEP | — | §6 предыдущего задания и §11 текущего |
| 22 | Публичный пакет без _archive | Junk деплоился | Чистый пакет | KEEP (refined) | — | Repository hygiene подтверждена владельцем |

## Links Audit (§17) — решения system map

| Решение | CURRENT destination | CORRECT destination | WHY |
|---|---|---|---|
| Treasury & Payment Discipline | questionnaire.html?topic=treasury | **kaznacheystvo.html** | Существующая страница казначейства объясняет систему до конверсии |
| Fund Planning & Payment Waterfall | questionnaire.html?topic=treasury | **treasury-waterfall.html** | Специальная страница водопада платежей |
| Working Capital Control | questionnaire.html?topic=working-capital | **working-capital.html** | Страница оборотного капитала + mini-scan уже внутри journey |
| SKU Cash Flow Analysis | questionnaire.html?topic=fcf-sku | **fcf-postavshiki.html** | Материал FCF-по-SKU — фактическое описание решения |
| Retail Margin Engine | retail-margin-engine.html | retail-margin-engine.html | Уже верно; убран Excel-тег |
| Supplier Rating & Procurement | questionnaire.html?topic=supplier-rating | **supplier-rating-purchasing-priorities.html** | Существующая страница рейтинга поставщиков |
| Margin Factor Analysis | questionnaire.html?topic=margin | **margin-factor-analysis-flags.html** | Существующая страница факторного анализа |
| Power BI Owner Dashboard | questionnaire.html?topic=power-bi | **power-bi-dlya-sobstvennika.html** | Существующая страница dashboard собственника |
| n8n / Make CFO Automation | questionnaire.html?topic=automation | **ai-dlya-cfo.html** | Страница «AI для CFO» описывает Make/n8n-автоматизацию, alerts и ограничения |

Все целевые страницы существуют и входят в sitemap. Диагностические CTA (`questionnaire?model=` в industry-карточках с явным лейблом «Пройти рентген…», hero, лестница пакетов) — сохранены: это осознанный диагностический вход, а не клик по продукту.

## Intro Report (§25)

| Этап | Значение |
|---|---|
| Previous approved | **INTRO_MS = 4400**; introLetter 0.7s, delay 0.3s + i×0.09s; introShimmer 1.1s @1.35s; introTagline 0.9s @2.1s |
| Shortened (передыдущие проходы) | 2600 → 1300; сжатая хореография |
| **Final restored** | **Точные previous-значения** (взяты из пакета, не по памяти) |
