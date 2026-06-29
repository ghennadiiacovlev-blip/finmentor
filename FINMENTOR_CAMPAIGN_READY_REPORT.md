# FINMENTOR campaign-ready intake update

Дата: 2026-06-29

## Что изменено

- `index.html`: обновлён hero под позиционирование external CFO / финансовой системы управления, добавлены CTA на диагностику, FINMENTOR Bot и блок `#industries`.
- `index.html`: добавлен блок `#industries` сразу после блока финансового хаоса: Real Estate, Retail, E-commerce, Distribution, Custom Manufacturing, Fitness.
- `index.html`: обновлён about-текст: FINMENTOR как внешний CFO и финансовый архитектор, Real Estate как флагман, остальные отрасли как адаптация единого CFO-ядра.
- `questionnaire.html`: анкета стала основным intake: быстрый финансовый рентген 0-100, светофор GREEN/YELLOW/ORANGE/RED, 3 зоны риска и расширенная анкета для Financial Health Check.
- `questionnaire.html`: добавлена поддержка `model`, `pain`, `intent`, `source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`.
- `questionnaire.html`: webhook payload расширен под Make/n8n -> Google Sheets FINMENTOR_OS -> Telegram alert.
- `main.js`: добавлен безопасный общий обработчик `data-event` / CTA events и `window.finmentorTrack`, без PII.
- `privacy.html`: уточнено, что GA4 получает только обезличенные параметры диагностики.
- `style.css`: добавлены стили блока отраслей.
- `monthly-cfo-support.html`, `README.md`: убрана формулировка `AI-автоматизация`.

## Где находится webhook constant

Файл: `questionnaire.html`

```js
var FINMENTOR_QUESTIONNAIRE_WEBHOOK_URL = "PASTE_MAKE_WEBHOOK_URL_HERE";
```

## Как вставить Make/n8n webhook URL

1. Создать production webhook в Make или n8n.
2. Скопировать HTTPS URL webhook.
3. В `questionnaire.html` заменить только значение строки:

```js
var FINMENTOR_QUESTIONNAIRE_WEBHOOK_URL = "https://hook.eu1.make.com/...";
```

4. Не менять GA4 ID `G-94L98WZ12`.
5. Не добавлять GTM.

## Что отправляется в webhook

Top-level payload:

- `source`, `site_version`, `lead_id`, `created_at`, `submitted_at`
- `source_page`, `page_url`, `referrer`
- `attribution`: `source`, `topic`, `model`, `pain`, `intent`, `utm_*`
- `client`: имя, компания, роль, email, телефон/мессенджер, Telegram, страна, город, часовой пояс, язык и формат связи
- `diagnostic`: score, traffic light, risk zones, business model, pain, urgency, scale, suggested lead status
- `intake`: профиль бизнеса, боль, финансовый контроль, отраслевой контекст, документы, цели, срочность, remote-work, commercial intent, completion, consent
- `automation`: routing hints для client brief, document request, Telegram alert, human review
- совместимые старые блоки: `lead`, `business_profile`, `main_pain`, `financial_system`, `completion`, `consent`, `tracking_safe`

## Что НЕ отправляется в GA4

- имя
- email
- телефон
- Telegram
- компания
- свободный текст
- полный JSON анкеты

GA4 events содержат только safe-параметры: `source`, `page_slug`, `completion_score`, `data_quality_hint`, `urgency_level`, `industry_category`, `desired_first_step`.

## Как протестировать

1. Открыть `questionnaire.html?model=real-estate&pain=cash-flow&intent=urgent-review&utm_source=test`.
2. Проверить, что бизнес-модель, боль и срочность предвыбраны.
3. Заполнить быстрый рентген и нажать “Показать предварительный результат”.
4. Проверить score, светофор и 3 зоны риска.
5. Нажать “Продолжить расширенную анкету для подготовки Financial Health Check”.
6. Заполнить обязательные поля и consent.
7. С production webhook URL проверить POST в Make/n8n.
8. В GA4 DebugView при `?debug_ga4=1` проверить safe-events без PII.

## После создания Make webhook

- Вставить URL в `FINMENTOR_QUESTIONNAIRE_WEBHOOK_URL`.
- В Make/n8n сохранить входящий JSON в Google Sheets `FINMENTOR_OS`.
- Настроить Telegram alert в `https://t.me/finmentor_md_bot` / внутренний FINMENTOR канал.
- Проверить сценарии: webhook success, webhook error, offline/fallback.

## QA

- Проверено в Chrome через локальный сервер:
  - desktop 1440px: главная, `#industries`, 6 карточек, JS errors нет;
  - tablet 820px: `#industries`, overflow нет;
  - mobile 390px: `questionnaire.html?model=fitness`, overflow нет;
  - `questionnaire.html?model=real-estate&pain=cash-flow&intent=urgent-review`: deep-link работает, score считается, 3 риска показываются;
  - mock webhook POST уходит, success message показывается;
  - placeholder webhook показывает fallback;
  - GA4 submit events не содержат PII.

