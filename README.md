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
