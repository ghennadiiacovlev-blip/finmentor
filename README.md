# FINMENTOR — сайт (MVP)

Премиальный одностраничный сайт на чистом HTML / CSS / JS. Без сборки, без npm, без зависимостей.

## Структура файлов

```
finmentor/
├── index.html            одна страница со всеми секциями
├── questionnaire.html    анкета-диагностика перед встречей
├── privacy.html          политика конфиденциальности
├── style.css             дизайн-система + все стили
├── main.js               интро, частицы, курсор, меню, кейсы, форма, анкета
├── favicon.svg           иконка вкладки
├── icon-192.png          иконка PWA / Android
├── icon-512.png          иконка PWA (maskable)
├── apple-touch-icon.png  иконка для iOS
│   └── og-image.png        картинка для соцсетей (1200×630)
├── manifest.json         PWA-манифест
├── robots.txt            для поисковиков
├── sitemap.xml           карта сайта
├── CNAME                 домен для GitHub Pages (www.finmentor.md)
└── README.md             этот файл
```

## Как открыть локально

Самый простой способ — двойной клик по `index.html` (откроется в браузере; нужен интернет, чтобы один раз подгрузить шрифты Google Fonts).

Для корректной работы всех путей лучше поднять локальный сервер:

```bash
cd finmentor
python3 -m http.server 8000
# затем откройте http://localhost:8000
```

Интро-анимация проигрывается один раз за сессию. Чтобы пересмотреть — откройте в новой вкладке или приватном окне.

## Как опубликовать на GitHub Pages

1. Создайте репозиторий на GitHub (например, `finmentor-site`).
2. Загрузите в него **содержимое** папки `finmentor/` (чтобы `index.html` лежал в корне репозитория).
   ```bash
   cd finmentor
   git init
   git add .
   git commit -m "Finmentor MVP"
   git branch -M main
   git remote add origin https://github.com/ВАШ-ЛОГИН/finmentor-site.git
   git push -u origin main
   ```
3. В репозитории: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   ветка `main`, папка `/ (root)` → **Save**.
4. Через 1–2 минуты сайт будет доступен по адресу `https://ВАШ-ЛОГИН.github.io/finmentor-site/`.

Файл `CNAME` уже добавлен — GitHub Pages подхватит его для домена `www.finmentor.md`.

## Как подключить домен www.finmentor.md

1. В настройках GitHub Pages в поле **Custom domain** укажите `www.finmentor.md` → Save
   (файл `CNAME` это уже задаёт, но проверьте, что поле заполнено).
2. В панели управления доменом (там, где куплен `finmentor.md`) добавьте DNS-записи:
   - **CNAME**: имя `www` → значение `ВАШ-ЛОГИН.github.io`
   - Для корневого `finmentor.md` (без www) добавьте **A-записи** на IP GitHub Pages:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
     (и/или **ALIAS/ANAME** на `ВАШ-ЛОГИН.github.io`, если провайдер поддерживает).
3. Дождитесь обновления DNS (от 10 минут до 24 часов).
4. В GitHub Pages включите **Enforce HTTPS** (появится после проверки домена).

> Если хостинг не GitHub Pages, а обычный (cPanel/Netlify/Cloudflare Pages) — просто загрузите
> содержимое папки в корень сайта. Файл `CNAME` нужен только для GitHub Pages.

## Что заполнить перед запуском

Уже сделано в этой версии: реальное фото в секции «О Геннадии», рабочие контакты в подвале
(email, телефон, Telegram, WhatsApp, LinkedIn), реальные данные в schema.org (JSON-LD).

Осталось вручную:

- **Подключить отправку формы** — инструкция прямо в коде: `main.js`, функция `initForm`.
  Готовы два варианта: A) Formspree (вставить endpoint), B) Telegram Bot (вставить TOKEN и CHAT_ID).
- **Подключить анкету** (`questionnaire.html`) к Make/n8n webhook — TODO в `main.js`, функция `initQuestionnaire`
  (questionnaire submit → webhook → Telegram + Gmail + Google Sheets / CRM).
- **Проверить текст `privacy.html` с юристом** и привести в соответствие с законодательством МД / GDPR.
- **Заменить текстовый логотип на SVG**, когда будет готов (опционально).
- **Поставить веб-аналитику** (GA4 / Plausible) для замера конверсии (опционально, но желательно).


## AI-Agent Output Schema (анкета → план работы)

Анкета `questionnaire.html` — это diagnostic intake. Ответы (кнопка «Скопировать ответы»
или будущий webhook) подаются AI-агенту, который формирует план работы с клиентом.
Имена полей начинаются с `q_` (`q_name`, `q_country`, `q_pain`, `q_f1..q_f16`, `q_systems`,
`q_doc`, `q_goal`, `q_remote_*`, `q_consent`, …); сбор ответов — `collectAnswers()` в `main.js`.

Агент должен возвращать:

1. **Client Summary** — country, industry, business_size, group_structure, key_contact, work_format, communication_language.
2. **Pain Map** — main / finance / operational / system pains, data-reporting problems, remote_concerns.
3. **Finance Maturity Score (1–5)** — 1 = хаос; 2 = базовые отчёты без регулярного контроля; 3 = P&L/CF/бюджет частично; 4 = управленческий контур + KPI; 5 = BI/automation/регулярный контроль.
4. **Risk Map** — cash_flow, profitability, reporting, debt, tax/compliance, data_quality, governance, remote_work.
5. **Urgency Level** — Low / Medium / High / Critical.
6. **Recommended First Step** — Health Check / Business Control System / Monthly Support / CFO AI Transformation / request documents first / discovery call first.
7. **Meeting Agenda** — 5–7 пунктов для первой встречи.
8. **Document Request List** — какие документы запросить до / после встречи.
9. **30/60/90-Day Roadmap** — first_30_days, 60_days, 90_days.
10. **Commercial Fit** — suitable_package, potential_monthly_support, possible_next_steps.
11. **Remote Work Plan** — communication_format, meeting_frequency, channels, quality_control, document_exchange, как снять страхи клиента.

**TODO:** questionnaire submit → webhook → AI agent → Telegram + Gmail + Google Sheets / CRM
(точка подключения — `main.js`, функция `initQuestionnaire`).

## v4 — Lead Generation & SEO Engine

Сайт превращён из презентационной страницы в лидогенерационную SEO-систему:
SEO-страницы привлекают органический трафик, дают пользу собственнику и ведут в анкету,
заявку или контакт. Структура остаётся плоской — все страницы в корне репозитория.

### Все страницы (в корне)
- `index.html` — главная (секции + lead-gen hub «База знаний»).
- `questionnaire.html` — диагностическая анкета (11 блоков, intake под AI-агента).
- `privacy.html` — политика конфиденциальности.
- **SEO-статьи:** `cash-flow.html`, `upravlencheskiy-pl.html`, `platezhnyy-kalendar.html`,
  `kaznacheystvo.html`, `power-bi-dlya-sobstvennika.html`, `ai-dlya-cfo.html`.
- **Шаблоны:** `templates.html`.
- **Страницы услуг:** `financial-health-check.html`, `business-control-system.html`, `monthly-cfo-support.html`.

### Назначение SEO-страниц
Каждая страница покрывает один поисковый запрос собственника, объясняет тему простым языком,
даёт чеклист и мини-пример (без персональных данных), FAQ и CTA в середине и в конце
(Заполнить анкету / Запросить шаблон / Получить диагностику / Обсудить внедрение / Telegram).
Внутренние ссылки связывают статьи и услуги между собой и с анкетой.

### Как добавить новую статью
1. Скопируйте любой из файлов статей (например, `cash-flow.html`) в корень под новым именем `тема.html`.
2. Замените `<title>`, `meta description`, `canonical`, Open Graph / Twitter, `<h1>`, контент, FAQ и JSON-LD.
3. Оставьте один `<h1>`, используйте `<h2>/<h3>` для структуры, добавьте внутренние ссылки и CTA.
4. Добавьте ссылку на статью в блок «База знаний» в `index.html` и в `sitemap.xml`.
5. Все пути — корневые (`style.css`, `favicon.svg`, `og-image.png`), без папок.

### Как обновлять sitemap.xml
Добавьте `<url><loc>https://www.finmentor.md/новая-страница.html</loc><lastmod>ГГГГ-ММ-ДД</lastmod>…</url>`
и обновите `lastmod` актуальной датой. `robots.txt` уже разрешает обход и указывает на sitemap.

### Будущая автоматизация
`questionnaire.html` (и формы) готовятся под подключение:
**questionnaire → Make / n8n → AI agent → Telegram + Gmail + Google Sheets / CRM**.
Точки подключения и AI-agent output schema описаны в `main.js` (`initQuestionnaire`),
в HTML-комментарии `questionnaire.html` и в разделе «AI-Agent Output Schema» выше.

## v5 — Focus & Positioning

Позиционирование сфокусировано вокруг одного ядра:
**FINMENTOR — внешний CFO и система финансового управления для собственников растущего бизнеса.**
Power BI, AI и Make/n8n поданы как технологический слой автоматизации **после** построения
финансового фундамента, а не как главное обещание. Capital / Investment вынесены из центрального
блока в отдельную секцию «Стратегические финансовые задачи собственника» (#strategic) — ниже
основного позиционирования.

Изменено на главной: hero (H1 «Внешний CFO для растущего бизнеса» + уточнение про BI/AI),
title/description/OG/Twitter, JSON-LD (serviceType с External CFO во главе), 5 опор
(External CFO · Management Reporting · Cash Flow & Treasury · Business Control System · BI / AI
Automation), блок «Для кого FINMENTOR» (описание клиента + 8 признаков + CTA), «О проекте»
(авторская CFO-практика), пакеты как продуктовая лестница (Диагностика → Внедрение → Регулярный
CFO-контроль → BI/AI-автоматизация), навигация (добавлено «Для кого»). SEO-страницы не удалялись:
к каждой добавлена строка-контекст, привязывающая тему к CFO-системе; статьи не переписаны.
Анкета, monthly support, remote work, SEO hub и lead-generation сохранены.

## v6 — Treasury Waterfall, Technology Budget, 1С → Power BI & AI Scenarios

Добавлен методологический и технологический слой (позиционирование v5 сохранено: внешний CFO →
система → автоматизация; AI/Power BI — инструменты после фундамента).

Новые блоки на главной (id): `#treasury` (фондовое планирование, метафонды, водопад приоритетов),
`#payment-discipline` (статусы + Purchase/AP/Payment Gate), `#coverage` (7/14/30 дней),
`#working-capital` (оборотный капитал, DSO/DPO/DIO, CCC), `#treasury-tech` (Treasury + Power BI/AI),
`#data-integration` (1С → Power BI, роль программиста-интегратора), `#tech-budget`
(технологический бюджет — суммы «ориентировочно»), `#scenarios` (4 архитектурных сценария).
Premium contact strip (Telegram/WhatsApp/Email/LinkedIn, inline SVG) — в блоке консультации и подвале.

Новые SEO-страницы: `treasury-waterfall.html`, `working-capital.html` (добавлены в sitemap.xml и в
перелинковку). Обновлены: `power-bi-dlya-sobstvennika.html` (1С-интеграция, Data Model, роль
интегратора, ошибки 1С→PBI, FAQ), `kaznacheystvo.html` (фонды, водопад, gates, 7/14/30, PBI, AI),
`cash-flow.html` / `business-control-system.html` / `monthly-cfo-support.html` / `templates.html`
(оборотный капитал и шаблоны).

GA4 сохранён на всех страницах (включая новые). В `main.js` добавлен `initGA` — делегированные
gtag-события (click_telegram/whatsapp/email/questionnaire/template_request/business_audit/
powerbi_integration/treasury_waterfall), защищённые `typeof gtag === 'function'` (если gtag не
загружен — сайт и навигация не ломаются). Суммы по подпискам помечены «ориентир»; работа
программиста-интегратора по 1С — оценивается отдельно после диагностики источников.

## v6 (Focus v2, Trust & Entry) — пересмотр

После стратегического аудита направление v6 изменено: **не перегружать главную методологией**, а
сфокусировать её, усилить доверие и вход. С главной **снято** ~8 тяжёлых методологических секций
(метафонды, водопад, gates, 7/14/30, DSO/DPO/DIO, подробный 1С→Power BI, построчный техбюджет,
длинные AI-сценарии). Они перенесены на отдельные страницы (`methodology.html`, `working-capital.html`,
`treasury-waterfall.html`, `kaznacheystvo.html`, `power-bi-dlya-sobstvennika.html`).

Добавлено на главную: **Discovery Call** (главный вход, 20–30 мин), блок **сравнения**
(CFO vs бухгалтер / консультант / BI-разработчик), **trust-блок** «Кто стоит за FINMENTOR»
(Big4/IFRS-фундамент, аккуратно), **«Удалённая работа, конфиденциальность и безопасность данных»**
(5 принципов), **методология как тизер** (4 опоры + ссылка), **оборотный капитал** как короткий
ROI-хук. Продуктовая лестница упрощена до 3 уровней (Health Check → Business Control System →
Monthly CFO Support); «CFO AI Transformation» убран как отдельный tier — BI/AI/Treasury/Working
Capital/1С-интеграция вынесены в блок **«Дополнительные модули»** с фразой про согласование стека
(без таблицы цен на главной). Добавлена ROI-рамка к ценам.

Новая страница `methodology.html` (в sitemap, перелинкована). GA4 сохранён на всех 16 страницах;
события обновлены: click_discovery_call, click_methodology, click_working_capital, click_questionnaire,
click_telegram/whatsapp/email, click_template_request, click_powerbi_integration (guarded
`typeof gtag === 'function'`).

## v7 — Proof, Cases & Lead Magnet

Не расширение методологии, а усиление доказательности, доверия и конверсии (поверх v6 Focus v2).

Добавлено на главную: блок **«Доказательства подхода»** (`#proof`) — 3 анонимные кейс-карточки
(оборотный капитал / казначейство / dashboard) с формулировками «Анонимный сценарий», «Типовая
ситуация», «Пример управленческого эффекта», без раскрытия клиентов и без гарантий, + ссылка на
`cases.html`. **Mini-scan** добавлен как вторичный CTA рядом с Discovery Call (Discovery Call
остаётся главным): «Проверить оборотный капитал за 3 минуты» → `working-capital-scan.html`.

Новые страницы: **`working-capital-scan.html`** — Working Capital Quick Scan (7 вопросов, без
backend, 3 уровня результата low/medium/high, кнопки «Скопировать результат» и «Отправить в
Telegram» через `t.me/share/url`, необязательные поля имя/компания/контакт/комментарий — форма
работает и без них, дисклеймер «не является финансовым заключением»); **`cases.html`** — анонимные
сценарии (ситуация / симптомы / что делаем / что получает собственник / какие данные нужны /
следующий шаг) + дисклеймер «не публичные кейсы и не гарантии».

Обновлено: `methodology.html` (блок «Что мы обещаем и чего не обещаем»), `working-capital.html` и
`templates.html` (CTA на мини-скан), `business-control-system.html` (ссылка на сценарии); CTA в
шапке SEO-страниц → Discovery Call. Перелинковка: главная → cases + scan; working-capital →
scan + cases; methodology/business-control-system → cases; templates → scan.

GA4 сохранён на всех 18 страницах. Новые события (guarded `typeof gtag === 'function'`, без
персональных данных; из скана уходит только уровень результата `low_risk/medium_risk/high_risk`):
click_cases, click_working_capital_scan, start_working_capital_scan, complete_working_capital_scan,
copy_working_capital_scan_result (+ click_discovery_call / click_questionnaire / click_telegram /
click_whatsapp / click_email). Тяжёлая методология на главную не возвращалась.

## v7.1 — Mobile Layout Fix (CSS only)

Точечный фикс мобильной вёрстки (только style.css; HTML, JS, GA4, sitemap, robots не тронуты).

Причина переполнения: у `.btn` стоял `white-space: nowrap`, поэтому длинные CTA («Пройти мини-скан
оборотного капитала», «Записаться на Discovery Call») не переносились и вылезали за пределы кнопки и
карточки. Исправлено:
- на ≤768px ряды CTA (`.cta-band__row`, `.hero__actions`, `.scan__actions`, `.packages__cta`,
  `.discovery-band .cta-band__row`) стают в колонку, кнопки — на всю ширину, текст переносится
  (`white-space: normal; overflow-wrap: anywhere`), padding/шрифт уменьшены;
- на ≤480px уменьшены paddings карточек, размеры заголовков/цен, контакт-кнопки на всю ширину;
- grid/flex-children получили `min-width: 0`, кнопки — `max-width: 100%`; длинные строки
  переносятся (`overflow-wrap: anywhere`).

Порядок пакетов: убран `.package--flagship { order: -1 }` в `@media (max-width:1024px)`, из-за которого
Business Control System поднимался наверх. Теперь и на desktop, и на mobile строго по DOM:
1) Financial Health Check → 2) Business Control System (акцент сохранён) → 3) Monthly CFO Support.

## v8 — Website Lead Assistant + Icon Fix

**Lead Assistant.** Добавлен аккуратный rule-based навигатор (без backend, внешних API, AI-чата и
сбора персональных данных). Реализован в самодостаточном `assistant.js` (плоский файл, без папок),
подключён на всех 18 HTML-страницах ровно один раз (в шаблоне генератора + 4 рукотворные страницы).
Плавающая premium-кнопка справа снизу («Нужна подсказка?» / на мобильном «Помочь выбрать шаг»)
открывает панель «Финансовый навигатор FINMENTOR» с одним вопросом и 5 сценариями:
1) оборотный капитал → mini-scan, 2) хаотичные платежи → казначейство/методология,
3) нет P&L/Cash Flow → диагностика/Health Check, 4) Power BI → страница Power BI/1С,
5) подходит ли FINMENTOR → Discovery Call/кейсы/Telegram. Discovery Call динамически ведёт на
`#consult` (главная) или `index.html#consult` (внутренние страницы). Доступность: `role="dialog"`,
`aria-expanded`, focus-visible, возврат фокуса, закрытие по X, ESC и клику вне окна. Дисклеймер:
«Ассистент помогает выбрать первый шаг. Это не финансовое заключение и не индивидуальная
рекомендация.» Не даёт финансовых советов, не просит доступы/документы, не собирает персональные
данные.

GA4-события (guarded `typeof gtag === 'function'`, без персональных данных): open/close_finmentor_assistant,
assistant_choose_working_capital/treasury/reporting/powerbi/fit,
assistant_click_discovery_call/mini_scan/telegram.

**Favicon / иконки.** Значок переработан в premium-стиль: тёмно-navy (#08111F) скруглённый квадрат
с тонкой золотой рамкой и монограммой **F** — золотая верхняя планка (бренд-акцент) + серебряный
стержень и средняя планка. Минималистично, читается на 16/32/192/512. Обновлены `favicon.svg`,
`icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (из той же концепции). `og-image.png` не
менялся (чтобы не рисковать брендом). Имена файлов прежние — ссылки на всех страницах и в
`manifest.json` остаются валидными. Favicon агрессивно кэшируется: после деплоя нужен hard refresh
(Ctrl/Cmd+Shift+R) и/или очистка кэша браузера и Cloudflare.

## v8.1 — OG / Social Preview Fix

Обновлён social-preview, чтобы при отправке ссылки `https://www.finmentor.md/` в Viber / Telegram /
WhatsApp / LinkedIn показывался новый premium-превью, согласованный с сайтом v8 и новым favicon.

Создан новый **`og-image.png`** (1200×630): тёмно-navy (#08111F) фон с лёгкой глубиной, тонкая
золотая рамка, F-монограмма-бейдж (как в favicon: золотая верхняя планка + серебряный стержень),
двухцветный вордмарк **finmentor** (fin — серебро/белое, mentor — золото), подзаголовок «Внешний CFO
для растущего бизнеса», золотая строка «Деньги · прибыль · риски · контроль», строка
«www.finmentor.md» и едва заметная financial-network сеть на фоне. Без синего, без стоковых картинок,
без SaaS-баннера. `og-image.png` сгенерирован локально (Pillow), внешних изображений не используется.

OG/Twitter-метатеги обновлены на **всех 18 HTML-страницах** с cache-bust **`?v=81`**:
`og:image`, `og:image:secure_url`, `og:image:type=image/png`, `og:image:width=1200`,
`og:image:height=630`, `twitter:card=summary_large_image`, `twitter:image`. Per-page `og:url`,
`og:title`, `og:description` сохранены. Шаблон генератора обновлён для согласованности.

### Деплой social preview
1. Загрузить `og-image.png` и обновлённые HTML-файлы в корень репозитория.
2. Дождаться сборки GitHub Pages.
3. Cloudflare → Caching → **Purge Everything**.
4. Проверить:
   - открыть `https://www.finmentor.md/og-image.png?v=81` (картинка должна отдаваться, 1200×630);
   - Facebook Sharing Debugger (Scrape Again);
   - LinkedIn Post Inspector;
   - отправить ссылку в Viber / Telegram / WhatsApp.
5. Если Viber всё ещё показывает старую карточку — это внутренний кэш Viber; параметр `?v=81` в
   метатегах помогает его сбросить (при необходимости попробовать чуть позже / с другого устройства).

## v8.2 — Page-Specific Social Previews

Для ключевых страниц созданы отдельные premium OG-изображения (1200×630, единая бренд-система:
тёмно-navy, золотая рамка, F-бейдж, eyebrow FINMENTOR, заголовок страницы, золотая нижняя строка,
едва заметная financial-network), чтобы при шеринге конкретных ссылок превью было точнее и
коммерчески сильнее. Все изображения сгенерированы локально (Pillow), без внешних картинок и
библиотек.

Новые файлы и страницы:
- `og-working-capital-scan.png` → `working-capital-scan.html` («Мини-скан оборотного капитала»).
- `og-cases.png` → `cases.html` («Анонимные сценарии финансового контроля»).
- `og-methodology.png` → `methodology.html` («Методология FINMENTOR»).
- `og-power-bi.png` → `power-bi-dlya-sobstvennika.html` («Power BI для собственника»).

На этих 4 страницах `og:image`, `og:image:secure_url`, `twitter:image` (и `image` в JSON-LD)
указывают на персональное изображение с cache-bust **`?v=82`**; `og:image:type/width/height`,
per-page `og:url`/`og:title`/`og:description` и Twitter Card сохранены, дублей `og:image` нет.
Все остальные страницы остаются на общем `og-image.png?v=81`. Шаблон генератора обновлён
(per-page override), чтобы регенерация оставалась согласованной.

### Проверка page-specific previews после деплоя
1. Загрузить новые OG-файлы и обновлённые HTML в корень.
2. Дождаться GitHub Pages.
3. Cloudflare → Caching → Purge Everything.
4. Открыть прямые ссылки (должны отдаваться, 1200×630):
   - `https://www.finmentor.md/og-working-capital-scan.png?v=82`
   - `https://www.finmentor.md/og-cases.png?v=82`
   - `https://www.finmentor.md/og-methodology.png?v=82`
   - `https://www.finmentor.md/og-power-bi.png?v=82`
5. Прогнать страницы в Facebook Sharing Debugger (Scrape Again) и LinkedIn Post Inspector, затем
   отправить в Viber / Telegram / WhatsApp:
   - `https://www.finmentor.md/working-capital-scan.html`
   - `https://www.finmentor.md/cases.html`
   - `https://www.finmentor.md/methodology.html`
   - `https://www.finmentor.md/power-bi-dlya-sobstvennika.html`

## v8.3 — Privacy Policy Update + Form Consent

Короткая Политика конфиденциальности заменена на профессиональную версию, учитывающую текущую
структуру сайта v8: веб-аналитику (GA4), мини-скан оборотного капитала, диагностическую анкету,
финансовый навигатор (assistant), каналы связи (Telegram / WhatsApp / email), возможную будущую
автоматизацию заявок (Make / n8n, Google Sheets, email), удалённую работу и конфиденциальность,
NDA по запросу, и явное указание, что персональные данные не передаются в GA4-события (из мини-скана
уходит только обобщённый уровень результата). Дизайн `privacy.html` (premium dark, классы `.legal*`),
GA4-тег, `assistant.js`, favicon и OG-теги сохранены. В конце страницы — юридическое уточнение, что
текст носит общий характер и должен быть согласован с юристом перед публичным использованием.

Рядом со всеми формами (контактная форма на главной `#consultForm`, диагностическая анкета
`questionnaire.html`, мини-скан `working-capital-scan.html`) добавлен короткий текст согласия со
ссылкой на `privacy.html`: «Отправляя форму, я подтверждаю, что ознакомился с Политикой
конфиденциальности и согласен на обработку данных для связи со мной и рассмотрения моего запроса.»
Добавлен класс `.form-consent` в `style.css`. Sitemap/robots/CNAME/manifest и остальные страницы не
менялись.

## v8.4 — Contact Privacy & Bot Intake

Личный телефон и WhatsApp убраны из всех публичных блоков сайта. Основной канал приёма входящих
сообщений — **FINMENTOR Bot** в Telegram. Бот собирает базовую информацию о запросе и передаёт её
для ответа. Сайт остаётся только на русском (без RO/EN).

Что сделано:
- Убран личный номер `+373 69 307 087` (включая `tel:`-ссылку) из футера, контактных блоков и
  карточек контактов.
- Убрана публичная WhatsApp-ссылка `https://wa.me/37369307087` из футеров, contact strip,
  CTA-блоков, анкеты и mini-scan; убрана из контактной логики privacy.
- Личные Telegram-ссылки (`t.me/Yakovlev_Ghennadi`) в публичных блоках заменены на **FINMENTOR Bot**
  (`https://t.me/finmentor_md_bot`): футеры, contact strip, CTA-кнопки, mini-scan, анкета, assistant.
- Email `cfo@finmentor.md` и LinkedIn сохранены.
- В `assistant.js` CTA «Написать в Telegram» заменён на «Оставить сообщение в FINMENTOR Bot»
  (ссылка на бота), добавлено GA4-событие `assistant_click_bot`; остальные события не изменены.
- В mini-scan кнопка результата ведёт в FINMENTOR Bot («Отправить результат в FINMENTOR Bot»);
  логика расчёта и GA4-события (start/complete/copy_working_capital_scan, result_level) не изменены.
- В анкете убраны телефон/WhatsApp из контактного блока и из клиентских опций; добавлен FINMENTOR
  Bot; согласие по-прежнему ведёт на `privacy.html`.
- В privacy добавлен FINMENTOR Bot как основной канал и формулировка: «При обращении через FINMENTOR
  Bot или Telegram ваши данные также могут обрабатываться платформой Telegram в соответствии с её
  правилами.»

**Реальный Telegram-бот:** username `finmentor_md_bot`, ссылка `https://t.me/finmentor_md_bot`.
Прежняя placeholder-ссылка на бота заменена на реальную (`https://t.me/finmentor_md_bot`) во всех
местах проекта; placeholder-токен нигде не используется. После любых изменений username проверить
все ссылки `t.me/finmentor_md_bot` на сайте.

## v8.5 — Premium AI-ready Questionnaire

Анкета `questionnaire.html` переработана из обычной формы в premium diagnostic intake. Изменён ТОЛЬКО
`questionnaire.html` (стили — в его inline `<style>`; `main.js`, `assistant.js`, `style.css` не
тронуты). Сайт остаётся RU-only; GA4, assistant.js, FINMENTOR Bot, privacy consent — без изменений.

Что сделано:
- **Убраны все нативные `<select>`** (плохо читались на тёмном фоне — белый системный список). 7
  селектов (язык, формат встречи, формат работы, годовой оборот, достоверность данных, главное
  ограничение) заменены на premium choice-элементы.
- **Choice cards / segmented buttons** на нативных `radio` (доступны с клавиатуры, без JS-состояния):
  тёмный фон, тонкая граница, gold-border и подсветка при выборе, hover, focus-ring, mobile-friendly.
  Карточки (`.q__cards`) для «Примерный годовой оборот» (до 500k / 500k–1M / 1–5M / 5–10M / 10M+ /
  Предпочитаю обсудить лично), «Срочность» и «Основной запрос»; segmented-пилюли (`.q__choices`) для
  остальных коротких выборов.
- **Текстовое поле «финансовый директор/команда»** переведено в choice (Нет / Бухгалтер совмещает /
  Есть финансист / Внешний CFO).
- **Добавлены AI-важные вопросы:** «Срочность запроса» (Обычная / Повышенная / Высокая — кассовый
  разрыв / Кризис) и «Что хотите от FINMENTOR в первую очередь?» (диагностика / система контроля /
  ежемесячное сопровождение / Power BI / казначейство / оборотный капитал / финансирование / нужна
  консультация).
- Значение каждого выбора хранится в нативном `radio` (submit и `collectAnswers()` читают его без
  изменений). Данные собираются в структурированный размеченный список «Поле: значение», пригодный
  для будущей передачи в Make / n8n → AI-агенты (Client Card, Risk Map, Package Recommendation, Document
  Checklist, Work Plan, Proposal Draft) и Google Sheets.
- Persональные данные в GA4 не отправляются; backend и внешние библиотеки/CDN не используются;
  телефон/WhatsApp не возвращены; ссылок на `/ro/`/`/en/` нет.

AI-маппинг полей анкеты (для будущей интеграции): industry←q_industry; scale←q_turnover;
entities/group←q_companies; main_pain←q_pain/q_pain_text; urgency←q_urgency; request/package←q_request;
P&L/CF/treasury status←q_f1/q_f2/q_f3…; data_quality←q_reliability; financial director←q_finteam;
data sources←q_systems; documents←q_doc; contact←q_email/q_telegram.

## v8.6 — Questionnaire Validation + JSON Payload & AI Automation Bridge

Анкета `questionnaire.html` превращена из premium-формы в полноценный AI-ready diagnostic intake с
валидацией и JSON-мостом. Изменены только `questionnaire.html` и `README.md`. Премиум choice-cards из
v8.5 сохранены; `main.js` / `assistant.js` / `style.css` не тронуты. Чтобы не трогать общий
`main.js`, форма переименована (`id="qFormV86"`) — старый обработчик в `main.js` делает ранний выход,
а вся логика v8.6 живёт в инлайн-скрипте самой анкеты (там же находится webhook-заготовка).

1. **Обязательные поля.** Без них анкета не отправляется: имя, компания, контакт (email **или**
   Telegram), сфера деятельности, годовой оборот, главная финансовая боль, срочность, желаемый первый
   шаг, наличие управленческого P&L, Cash Flow, платёжного календаря, достоверность данных, статус
   документов, согласие с политикой конфиденциальности.
2. **Почему форма не уходит без них.** Кастомная валидация (не `native required`) проверяет каждое
   обязательное поле/группу. Если чего-то нет — submit отменяется, JSON не формируется, webhook не
   вызывается, success не показывается, клиент возвращается к заполнению.
3. **Контакт (email/Telegram).** Достаточно одного канала. Email проверяется простым форматом.
   Telegram принимается в форматах `@username`, `username`, `t.me/username`, `https://t.me/username`
   и нормализуется в `@username`. Если оба пустые/некорректные — подсветка контактного блока и
   сообщение «Укажите email или Telegram, чтобы FINMENTOR мог ответить». Телефон не требуется,
   WhatsApp не возвращён.
4. **Premium error block.** Вместо браузерного alert — тёмная карточка с gold/accent вверху формы с
   текстом «Чтобы подготовить качественную предварительную диагностику, заполните ещё несколько
   обязательных пунктов» и кликабельным списком пропущенных пунктов (клик — прокрутка к полю).
   Каждое поле с ошибкой получает subtle red/gold border и инлайн-сообщение «Выберите один вариант» /
   «Заполните поле». Введённые ответы не теряются; ошибка исчезает автоматически при заполнении.
5. **«Не знаю / обсудить лично» / «Нет данных».** Добавлены к: оборот, качество данных, P&L, Cash
   Flow, платёжный календарь, документы, финдиректор, кредиты/инвесторы, CAPEX/проекты. Такой ответ
   засчитывается как заполненный (не блокирует), но помечается в `uncertainty_fields` и влияет на
   `data_quality_hint`. «не знаю» = низкая прозрачность; «нет данных» = data quality risk; «обсудить
   лично» = сигнал к Discovery.
6. **completion_score.** `(заполненные обязательные / всего обязательных) × 100`. Если все обязательные
   заполнены — 100% и `required_completed=true`. `data_quality_hint`: 0 неопределённостей → `high`,
   1–2 → `medium`, 3+ → `low`.
7. **Human-readable текст.** `collectAnswersText()` формирует аккуратный сгруппированный текст («Поле:
   значение» по секциям Контакт / Профиль / Боль / Финансовая система / Документы) для копирования,
   Telegram или email. `collectAnswers()` оставлен как обёртка.
8. **JSON payload.** `collectAnswersJson()` собирает валидный объект с секциями `source`,
   `site_version` (`v8.6`), `submitted_at`, `lead`, `business_profile`, `main_pain`,
   `financial_system`, `documents`, `ai_ready_fields`, `completion`, `consent`. Персональные данные не
   логируются в консоль.
9. **Webhook по умолчанию пуст.** `const FINMENTOR_QUESTIONNAIRE_WEBHOOK_URL = "";`. Пока URL пустой —
   форма работает как сейчас: показывает success и предлагает FINMENTOR Bot / email, ничего не
   отправляя наружу.
10. **Реальный Make / n8n webhook** вставляется в эту константу только после готовности сценария. Тогда при
    submit (после успешной валидации) отправляется `POST` с `Content-Type: application/json`; при
    ошибке — честный fallback «Заявка подготовлена. Если отправка не прошла, отправьте её через
    FINMENTOR Bot или email».
11. **GA4 без персональных данных.** На submit отправляется только безличное событие
    `questionnaire_submit` с флагом `delivered` (0/1) — никаких полей анкеты в GA4.
12. **AI drafts → human review.** Возле согласия добавлена строка о том, что ответы могут
    использоваться для подготовки предварительной диагностики, списка документов, карты рисков и
    предложения по формату, а финальные выводы подтверждает человек. Preliminary hints
    (`maturity_level_hint`, `risk_level_hint`, `recommended_package_hint`, `pricing_complexity_hint`)
    считаются на фронте без AI и являются только черновыми сигналами.
13. **Назначение данных (FINMENTOR_OS).** Поля анкеты подготовлены под вкладки операционной системы:
    Leads, Client_Cards, AI_Classification, Document_Checklist, Risk_Map, Pricing, Work_Plan,
    Proposal_Log. Стабильные `data-key` (name, company, email, telegram, industry, annual_turnover,
    primary_problem, urgency, desired_first_step, has_management_pl, has_cash_flow,
    has_payment_calendar, data_reliability, financial_director_or_team, documents_status и др.)
    позволяют Make / n8n / AI читать ключи, а не русские подписи.

## v8.7 — FCF Supplier Financing Article

Добавлена профессиональная SEO-статья `fcf-postavshiki.html` («Финансирование бизнеса за счёт
поставщиков: какие товары реально создают Cash Flow») в фирменном стиле FINMENTOR — не standalone-
дизайн, а общий шаблон сайта (`doc-bar`, `doc-hero`, `article.doc`, `cta-band`, `related`,
`doc-foot`, `style.css`, assistant.js). Тема: анализ FCF по SKU, операционный цикл, DPO/DSO,
распределение фиксированных затрат, Supplier Financing Benefit, классификация SKU и управленческий
dashboard.

- **Дизайн адаптирован под бренд:** premium dark, gold/silver/navy. Standalone orange-стиль исходника
  не использован. Добавлен только компактный page-scoped `<style>` (префикс `.fcf-`) для таблиц
  (responsive wrapper с горизонтальной прокруткой внутри таблицы), KPI-лестницы, формул, блока
  CFO-аудита, funding-gap-баров и четырёх цветных статус-карточек SKU. Глобальный `style.css` и другие
  страницы не изменялись.
- **SEO:** title, meta description, canonical, OG (`og:type=article`, `og:locale=ru_RU`, og:image
  `og-image.png?v=81`), Twitter summary_large_image, `article:author` (Геннадий Яковлев),
  `article:section` (Cash Flow / Working Capital), JSON-LD (Article + BreadcrumbList).
- **Добавлена в `sitemap.xml`** (priority 0.8); XML валиден.
- **Internal links:** карточка в блоке материалов на `index.html` (Практические статьи) + как
  related-материал на `working-capital.html`, `cash-flow.html`, `methodology.html`, `templates.html`.
- **GA4 `G-94L98WZ12` сохранён**; персональные данные в GA4 не отправляются. На CTA добавлены
  безопасные события `click_fcf_article_questionnaire`, `click_fcf_article_bot`,
  `click_fcf_article_working_capital_scan` (инлайн gtag, без отдельного JS).
- **CTA ведут на:** `questionnaire.html`, FINMENTOR Bot `https://t.me/finmentor_md_bot`,
  `working-capital-scan.html`, Discovery (`index.html#consult`).
- **Contact privacy:** телефон и WhatsApp не возвращались; в footer — email `cfo@finmentor.md` и
  FINMENTOR Bot, как на остальных страницах. RU-only сохранён, ссылок на `/ro/` и `/en/` нет.

## v8.9 — Deep Working Capital Scan (CFO triage)

Мини-скан `working-capital-scan.html` переработан из общего теста в персонализированный CFO-triage.
Чтобы не трогать общий `main.js`, контейнер переименован в `#wcScanV88` — старый `initWcScan` делает
ранний выход (ждёт `#wcScan`), а вся новая логика живёт в инлайн-скрипте страницы. Без регистрации,
без персональных данных, без автоматической отправки наружу; 9 вопросов, результат сразу на странице.

- **Scoring по категориям:** каждый ответ через `data-cat` начисляет баллы в несколько категорий —
  `ar_score`, `inventory_score`, `ap_score`, `treasury_score`, `reporting_score`, `growth_score`,
  `urgency_score`, плюс `total_risk_score` и owner-dependency. Общего «одного балла» больше нет.
- **7 result profiles:** AR Risk / Debtor Trap, Inventory Trap, Supplier Pressure / AP Risk, Treasury
  Discipline Risk, Reporting Blind Zone, Growth Cash Gap, Mixed Risk / CFO Review. `primary_profile` —
  это доминирующая категория; если несколько категорий набирают высокий риск и идут вплотную → Mixed.
- **Персонализированный результат** из блоков: Risk Level (Низкий/Средний/Высокий/Критический),
  Primary Diagnosis, Why this matters, Where money may be stuck, What to check first, First CFO
  actions, Recommended FINMENTOR route, CTA. Тексты разные для каждого профиля; тон спокойный
  («предварительно видно», «вероятная зона риска», «стоит проверить»), без гарантий и драматизации.
- **Внутренний объект результата** (`scan_type`, `risk_level`, `primary_profile`, `scores{}`,
  `diagnosis`, `documents_to_check[]`, `first_actions[]`, `recommended_route`, `related_article`,
  `human_review_required:true`) формируется на странице и используется для copy/share. Наружу не
  отправляется.
- **Copy result** копирует персонализированный текст: уровень риска, профиль, диагноз, что проверить,
  рекомендуемый маршрут, следующий шаг — чтобы отправить в FINMENTOR Bot.
- **Контекстные статьи «Разобраться глубже»:** после результата показывается 1–3 материала,
  релевантных профилю (Inventory/AP/Mixed → статья про FCF по SKU `fcf-postavshiki.html`; Reporting →
  Cash Flow + P&L; Treasury → платёжный календарь + казначейство; AR/Growth → анкета + Cash Flow).
  Ссылки только на существующие страницы; битых ссылок нет.
- **GA4 safe events** (без персональных данных): `start_working_capital_scan`,
  `complete_working_capital_scan`, `copy_working_capital_scan_result`, `click_questionnaire_from_scan`,
  `click_bot_from_scan`, `click_related_article_from_scan` с параметрами `risk_level`,
  `primary_profile`, `recommended_route` / `article_slug`. Ответы пользователя как текст не уходят.

## v8.9 — Structured Questionnaire Fields for AI Agents

Чтобы анкета лучше ложилась в FINMENTOR_OS (Client Card, Risk Map, Package Recommendation, Document
Checklist, Pricing, Work Plan, Proposal Draft), часть свободных текстовых полей заменена на
структурированные premium choice-варианты с «Другое / свой ответ» и опциональным уточнением.
Изменён только `questionnaire.html`; v8.6-валидация, `collectAnswersText()`, `collectAnswersJson()`,
`completion_score`, `uncertainty_fields`, `data_quality_hint`, `data-key` и premium-карточки сохранены.

- **Заменены на выбор:** сфера деятельности (cards + уточнение), компаний в группе, сотрудников,
  филиалов/объектов/направлений (+ уточнение), кто готовит отчёты (+ уточнение), частота отчётности,
  время подготовки отчётов; основные статьи расходов — multi-choice (несколько вариантов) +
  комментарий; финансовый директор/команда — уточнённые варианты. Native select не используется.
- **Свободным текстом осознанно оставлены** второстепенные поля: имя, компания, контакт, описание
  главной проблемы своими словами, комментарии и уточнения — где формулировка клиента важнее
  структуры.
- **Помощь AI-классификации:** «кто готовит отчёты» и «финансовый директор/команда» → maturity level и
  accounting/owner-dependency risk; «частота отчётности» и «время подготовки отчётов» → reactive
  management / process risk; «сфера», «компаний в группе», «сотрудников», «направления», «оборот» →
  pricing complexity; статьи расходов → структура затрат для риск-карты. Стабильные `data-key`
  позволяют Make / n8n / AI читать ключи, а не русские подписи.
- **«Другое / свой ответ»** не блокирует отправку (если основной выбор сделан) и сохраняется в
  соответствующем `*_comment`. **«Не знаю / нужно обсудить»** считается заполненным, но попадает в
  `uncertainty_fields` и снижает `data_quality_hint`.
- **«Личная встреча в Кишинёве»** добавлена в блок «Формат встречи» (premium choice), под блоком —
  note о согласовании после квалификации. Значение попадает в UI, в human-readable text и в JSON как
  `lead.preferred_meeting_format`. Телефон/WhatsApp не возвращались, RU-only сохранён.

## v9.0 — Supplier Rating + Margin Factor Analysis (series)

Добавлены две связанные экспертные статьи-страницы FINMENTOR (продолжение серии после FCF по SKU),
в общем брендовом шаблоне (doc-bar / doc-hero / article.doc / cta-band / related / doc-foot, общий
style.css, assistant.js, GA4). У каждой — компактный page-scoped `<style>` с префиксом `.art-`
(таблицы с responsive-обёрткой, KPI-карточки, блоки формул, цветные флаги-точки). Глобальные стили и
другие страницы не менялись.

- **`supplier-rating-purchasing-priorities.html`** — «Справочник коэффициентов рейтинга поставщиков:
  как выбрать, у кого купить одинаковый товар». Формула рейтинга, справочник коэффициентов
  (финансирование, рентабельность, возврат, НДС), 5 приоритетов компании (Cash Flow, маржа, наличие,
  складской риск, импорт/НДС) с таблицами и формулами (Effective Purchase Cost, Cash Impact of VAT),
  Decision Matrix, Supplier Decision Score, уровни решения, dashboard.
- **`margin-factor-analysis-flags.html`** — «Факторный анализ маржи с флагами». Факторный мост (Δ
  Margin = Volume + Mix + Cost + Price), 6 флагов, диагностические признаки (маркетинг, наличие
  товара, сезонность, доп. факторы), расширенный dashboard, 4 комбинации флагов, связка с FCF и
  рейтингом поставщиков.
- **Серийная перелинковка:** обе статьи ссылаются друг на друга и на FCF по SKU; добавлены в блок
  материалов `index.html` и в related-сетки `fcf-postavshiki.html`, `working-capital.html`,
  `cash-flow.html`, `methodology.html`, `templates.html`. Обе добавлены в `sitemap.xml` (priority
  0.8); XML валиден (21 URL).
- **SEO:** title/description/canonical, OG (article, ru_RU, og-image.png?v=81), Twitter
  summary_large_image, article:author/section, JSON-LD (Article + BreadcrumbList).
- **GA4 `G-94L98WZ12`** сохранён; на CTA — безопасные inline-события (`click_supplier_rating_*`,
  `click_margin_factor_*`), без персональных данных. CTA ведут на Discovery (`index.html#consult`),
  `working-capital-scan.html`, FINMENTOR Bot. Телефон/WhatsApp не возвращались, RU-only сохранён.

## v9.1 — Treasury Waterfall / Fund Planning (страница обновлена)

`treasury-waterfall.html` обновлена «на месте» из компактного объяснителя в полноценную
институциональную статью «Фондовое планирование и водопад платежей: как расставить приоритеты, когда
денег на всё не хватает» — в общем брендовом шаблоне серии (doc-bar / doc-hero / article.doc /
cta-band / related / doc-foot, page-scoped `.art-` CSS, GA4, assistant.js). URL и canonical
(`/treasury-waterfall.html`) сохранены, поэтому новых записей в `sitemap.xml` не добавлялось (остаётся
21 URL), а вся существующая перелинковка на страницу осталась рабочей. Это сознательно сделано на
месте, чтобы не плодить второй URL на ту же тему (SEO-каннибализация).

- **Содержание:** Executive Summary + KPI; почему платежи идут хаотично и чем это опасно (risk-табл.);
  фонды и метафонды (табл.); чем фондовое планирование сильнее платёжного календаря; водопад P0–P5;
  три фильтра (Purchase / AP / Payment Gate); правило 7/14/30 + формула Cash Coverage с цветными
  флагами (green/yellow/orange/red); формулы Available Cash, Free Treasury Cash, Owner Distribution
  Allowed, Funding Gap; scoring-модель платежа; статусы очереди; причины блокировки; практический
  водопад (демо-распределение 1 000 000 → Free 280 000); dashboard из 3 блоков (Cash Position /
  Coverage / Payment Queue); 5 ошибок внедрения; 5 шагов внедрения со справочниками фондов; финальный
  вывод; FAQ + JSON-LD FAQPage.
- **Конфиденциальность.** Загруженный внутренний файл-модель (`MEGA_PARK_Казначейство_*.xlsx`) НЕ
  парсился и НЕ раскрывался: статья построена только на методологии, структуре фондов, приоритетах и
  dashboard; реальные суммы, названия компаний, поставщиков, банков, сотрудников и объектов не
  использованы. Все числовые примеры демонстрационные и обезличенные.
- **SEO/GA:** title/description/canonical, OG (article, ru_RU, og-image.png?v=81), Twitter, JSON-LD
  Article + BreadcrumbList + FAQPage; GA4 `G-94L98WZ12` сохранён, на CTA — безопасные inline-события
  `click_treasury_waterfall_*` без персональных данных. CTA: Discovery (`index.html#consult`),
  «Построить систему казначейства» (`kaznacheystvo.html`), FINMENTOR Bot. Related: платёжный календарь,
  казначейство, Cash Flow, FCF по SKU, мини-скан. Телефон/WhatsApp не возвращались, RU-only сохранён.

## v9.2 — Topic-aware CTA + Premium FAQ + Automation blocks

Точечная доработка экспертных статей и анкеты: релевантные CTA, premium-кнопки, premium-FAQ и блок
автоматизации n8n / Make / Power BI. Глобальный `style.css`, `main.js`, `assistant.js`, `sitemap.xml`
и формы/меню/футер не менялись; правки локальны в страницах статей и инлайн-логике анкеты.

- **`?topic=` в анкете (`questionnaire.html`).** Инлайн-логика читает query-параметр `topic`
  (`treasury` / `margin` / `supplier-rating` / `fcf-sku` / `working-capital`); при валидном значении
  показывает premium-баннер темы вверху формы и кладёт тему в JSON как `lead.source_topic` +
  `lead.source_topic_label`, а также строкой «Тема обращения: …» в human-readable text. Если параметра
  нет или он неизвестен — анкета работает строго как раньше (без баннера, без `null`). Валидация,
  `collectAnswersText()`, `collectAnswersJson()`, `completion_score`, `uncertainty_fields`,
  `data_quality_hint` и data-key не затронуты (проверено Node-тестом).
- **Тематические CTA в 4 статьях.** Каждая статья ведёт на релевантное действие, а не на общий тест
  оборотного капитала: казначейство → `questionnaire.html?topic=treasury`; маржа → `?topic=margin`;
  поставщики → `?topic=supplier-rating`; FCF по SKU → `?topic=fcf-sku`; вторая кнопка — `index.html#consult`.
  Кнопки в hero и в финальном CTA-блоке заменены; ни одна CTA-кнопка статьи про казначейство больше не
  ведёт на working-capital-scan.
- **Premium-кнопки.** Новый компонент `.cta-btn` (page-scoped): компактнее (min-height 52px, радиус
  14px), primary — gold fill, secondary — outline, стрелка справа, hover-подъём и свечение,
  focus-visible; на мобильном (≤640px) — full-width, не «огромные овалы». Глобальный `.btn` не тронут.
- **Premium-FAQ (казначейство).** Тяжёлые тёмные карточки заменены на аккуратный accordion
  (`<details>/<summary>`): номер (01–04), вопрос, иконка «+» с поворотом в «×», тонкая gold-граница,
  hover, плавная анимация раскрытия, mobile-вид. JSON-LD FAQPage сохранён.
- **Блок автоматизации в каждой статье** — управленческий, не для программистов: «Как автоматизировать
  …» с двумя таблицами (что делает n8n / Make и что показывает Power BI dashboard) и «Главным выводом».
  Темы: казначейство (заявки, статусы, approval, funding gap, 7/14/30, treasury dashboard); маржа
  (продажи, COGS, stock-out, маркетинг, флаги, margin bridge); поставщики (цены, DPO, НДС, возвраты,
  supplier score, alerts, supplier dashboard); FCF по SKU (продажи, себестоимость, маркетинг, склад,
  DPO/DSO, fixed costs, cash destroyers, FCF dashboard). GA4 `G-94L98WZ12` сохранён; на CTA — события
  `click_<topic>_questionnaire` / `click_<topic>_discovery`. Телефон/WhatsApp/RO-EN не возвращались.

## v9.3 — Packages ↔ Expert Modules (commercial alignment)

Экспертные направления из статей встроены в коммерческое предложение, без перегруза и с сохранением
premium-структуры. Изменены только `index.html` (секция услуг) и `questionnaire.html` (темы); статьи,
`style.css`, `main.js`, `assistant.js`, `sitemap.xml` и формы/меню/футер не тронуты.

- **Темы анкеты расширены до 9** (`questionnaire.html`): добавлены `financial-diagnostic`,
  `cfo-system`, `power-bi`, `automation` к существующим `treasury` / `margin` / `supplier-rating` /
  `fcf-sku` / `working-capital`. Каждая валидная тема показывает баннер и попадает в JSON
  (`lead.source_topic` + `lead.source_topic_label`) и в текст; без темы — анкета как раньше.
- **Секция «Экспертные модули FINMENTOR»** (бывшие 6 простых карточек без CTA → 8 premium-карточек с
  переходами): Treasury &amp; Payment Discipline, Fund Planning &amp; Payment Waterfall, SKU Cash Flow
  Analysis, Supplier Rating &amp; Procurement Control, Margin Factor Analysis, Working Capital Control,
  Power BI Owner Dashboard, n8n / Make CFO Automation. У каждой — номер, заголовок, outcome-описание,
  3–4 ключевых пункта и тематический CTA на `questionnaire.html?topic=…`. Формулировки — про результат
  для собственника, не «таблички Excel».
- **Пакеты (product ladder) связаны с темами:** Financial Health Check → `?topic=financial-diagnostic`
  («Пройти финансовую диагностику»); Business Control System → `?topic=cfo-system` («Построить
  CFO-систему»); нижний CTA блока — тоже на диагностику. Monthly CFO Support и тарифы Monthly не
  тронуты.
- **Гайд «Как выбрать, с чего начать»** — таблица «задача → модуль» (7 строк) со ссылками на нужную
  тему (диагностика, казначейство, FCF по SKU, поставщики, маржа, Power BI, автоматизация).
- **Premium-дизайн** (отдельный `<style>` в index, глобальный `style.css` не тронут): сетка
  auto-fit 280px, лёгкие карточки с hover-подъёмом и gold-границей, маркеры-точки, CTA со стрелкой и
  «раздвижением» по hover, responsive-таблица гайда. GA4 `G-94L98WZ12` сохранён; на карточках —
  `data-ga="click_module_<topic>"`. Телефон/WhatsApp/RO-EN не возвращались.

## v9.4 — Working Capital Quality section

В статью `working-capital.html` добавлен сильный аналитический раздел «Качество оборотного капитала:
почему не все активы являются свободными деньгами» (после Cash Conversion Cycle, перед связкой с Cash
Flow). Развивает мысль, что свободные средства нельзя считать по общей сумме оборотных активов —
нужна корректировка на качество активов и срок обязательств. Изменён только `working-capital.html`
(+ README); остальное не тронуто (sitemap без изменений, 21 URL).

- **Четыре блока качества:** товарные остатки (свежие / slow-moving / залежавшиеся / dead stock,
  уценка/возврат/списание), дебиторка (текущая и просрочка 1–30/31–60/61–90/90+, собираемость,
  stop-credit, резерв по сомнительным), кредиторка (в сроке = supplier financing; Due AP и просрочка —
  не свободные деньги), НДС (Recoverable VAT с учётом сроков заморозки).
- **Формула** `Quality-Adjusted Working Capital = Available Cash + Collectible AR + Liquid Inventory +
  Recoverable VAT − Due AP − Mandatory Liabilities − Minimum Reserve` с пояснением против балансовой
  `Net Working Capital = Current Assets − Current Liabilities`.
- **Таблицы:** Inventory Aging, AR Aging, AP Pressure, пример корректировки балансового WC до реального
  свободного ресурса (демо: ~1,2 млн на балансе → ~400 000 свободно), dashboard «что должен видеть
  собственник». Все суммы демонстрационные.
- **Оформление:** в страницу (ранее без inline-стиля) добавлен page-scoped `<style>` с
  `.art-table-wrap` / `.art-formula` / `.art-dot` (green/amber/orange/red) в общем брендовом стиле;
  глобальный `style.css` не тронут. Таблицы responsive (скролл внутри блока), mobile-safe. GA4
  сохранён; телефон/WhatsApp/RO-EN не возвращались.

## v10 — Lean Premium Website (homepage rebuild)

Главная пересобрана из ~22 секций (1135 строк) в **10 сильных секций** (730 строк) по логике Lean
Premium. Ценный контент не удалён — перенесён в статьи/материалы/методологию или сжат. Изменён только
`index.html` (+ README); рабочие системы не тронуты (questionnaire, working-capital-scan, bot, GA4,
privacy, assistant.js, main.js, style.css, sitemap — без изменений; sitemap 21 URL).

**Новая структура главной:** 1) Hero (оффер + разграничитель «не бухгалтерия / не BI / не AI» + 1
primary CTA = mini-scan, secondary = Bot) · 2) Для кого · 3) Как работает FINMENTOR — 3 шага
(диагностика → система → сопровождение/автоматизация) · 4) Пакеты (3) + экспертные модули вторично
(«после диагностики») · 5) Доказательства: 3 анонимных кейса + «что вы получаете» (8 deliverables) +
«пример результата» (4 обезличенных sample-output) · 6) Кто стоит за FINMENTOR + trust-links
(Bot/email/LinkedIn/личная встреча) · 7) Mini-scan как лёгкий вход (9 вопросов, «первый CFO-triage»,
честно «не полноценная диагностика») · 8) Избранные материалы (4 карточки) · 9) Что происходит после
заявки (5 шагов + «финальные выводы подтверждает человек») · 10) Discovery-форма + footer.

**Убрано с главной (контент жив на отдельных страницах/в материалах):** chaos, compare, system,
proof, deliverables, process, discovery, monthly, remote, methodology-teaser, strategic, pre-meeting,
интерактивный блок кейсов (заменён статичными кейсами; cases.html сохранён; main.js initCases
guarded).

**Главный путь клиента:** Главная → mini-scan / Bot → короткая квалификация → Discovery → документы →
диагностика → план/пакет/стоимость. Главный CTA — mini-scan; вторичный — FINMENTOR Bot.

**Доверие:** trust-links, sample-outputs (обезличенные образцы, без реальных данных), 3 анонимных
кейса без выдуманных цифр, «что после заявки». **AI-логика без перегруза:** AI/автоматизация — только
в «как мы работаем» и «после заявки» как внутренний инструмент с human-review; не основной оффер.

**CSS:** новые секции стилизованы в inline `<style>` index (глобальный `style.css` не тронут).
Premium dark/gold сохранён, mobile-first (auto-fit сетки, ≤600px паддинги). Телефон/WhatsApp/RO-EN/CDN
не добавлялись; GA4 `G-94L98WZ12` сохранён, data-ga события без персональных данных.

## Automation platform note

Current MVP may be implemented in Make for speed and simplicity. The architecture should remain
platform-neutral and compatible with n8n, so FINMENTOR_OS is not dependent on a single automation
vendor. In strategic texts the automation layer is referred to as **Make / n8n**; in concrete
technical instructions for the already-built scenario, Make may be named as the current MVP
implementation (миграция/расширение в n8n архитектурно допускается).


## Monthly CFO Support pricing clarified

€750/month is a limited light-support entry point, not unlimited CFO outsourcing. Standard and Premium
formats depend on meeting frequency, monthly hours, number of entities, reporting complexity and scope
of deliverables. On the homepage the Monthly card now describes the light base (1 CFO meeting/month,
60–90 min, review of key figures, short action list) and states that extended support, extra meetings,
Cash Flow / P&L / payment control and dashboard-review are priced separately after diagnostics. The
dedicated page lists three formats (Light / Standard / Premium) with explicit meetings, monthly hours
and an explicit scope boundary ("not an unlimited finance department"). No acquiring / "Pay" button.
