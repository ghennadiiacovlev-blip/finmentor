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
