# FINMENTOR — RESTORATION QA REPORT

Объект: `finmentor_premium_restored_owner_review.zip` · Метод: Playwright (Chromium) + статический аудит + node --check.
403 на fonts/gtag — блокировка сети песочницы, не сайта.

## Матрица §26

| Проверка | Результат |
|---|---|
| Desktop 1440 / mobile 390-430-360 | ✅ отрендерены; horizontal overflow 0 px на index, retail, questionnaire |
| **Мобильное меню (P0)** | ✅ 360/390/430 @660px высоты: первый пункт полностью виден (top 84px, под шапкой), шрифт 17.6px (Manrope), CTA 48px, scroll-lock активен, cookie-баннер скрыт, Esc/клик-по-ссылке/клик-вне закрывают, overflow 0 |
| Internal links | ✅ 26/26 страниц, 0 битых; все якоря index существуют |
| **Product links (journey)** | ✅ 9/9 строк system map ведут на существующие страницы решений (клик-тест: Treasury → kaznacheystvo.html, H1 корректен); 0 ссылок map в questionnaire |
| Questionnaire smoke | ✅ 12 ответов → результат → intake; deep-links ?model/?topic живы |
| Financial X-Ray позиция | ✅ hero/лестница/mini-scan — явные диагностические CTA; из описаний решений — только после объяснения |
| CTA / forms | ✅ consult-форма: submit без ошибок, success/fallback; логика webhook не тронута |
| Telegram | ✅ 9 ссылок на бот на index; бот-CTA в меню и футере |
| GA4 | ✅ делегированный трекинг покрывает новые ссылки; data-event=cta_click/destination обновлены на map-строках; consent-гейтинг не тронут |
| Consent | ✅ выбор сохраняется, после reload баннер не показывается; при открытом меню скрыт |
| Sitemap | ✅ валидный XML, 25 URL существуют |
| H1 / duplicate IDs | ✅ 26/26 один H1; 0 дублей id |
| JS syntax | ✅ node --check main.js, assistant.js; 0 pageerror во всех сценариях |
| **Intro (restored)** | ✅ INTRO_MS 4400 из previous-пакета; на 3.0s ещё виден, к ~5.2s чисто скрыт; skip/sessionStorage/reduced-motion сохранены |

## Регрессия
Webhook/n8n, скоринг анкеты, Telegram, GA4-события, UTM, consent, thank-you, AI Economics, кейсы, цены, навигационная архитектура — не изменялись. Регрессий не выявлено → **PASS**.
