# FINMENTOR Questionnaire Webhook Ready Report

## Webhook constant

Webhook URL is configured in `questionnaire.html`:

```js
var FINMENTOR_QUESTIONNAIRE_WEBHOOK_URL = "PASTE_MAKE_WEBHOOK_URL_HERE";
```

Replace only this value with the approved Make / n8n production webhook URL. The placeholder is inert and does not trigger a network request.

## Webhook payload

On valid submit, `questionnaire.html` sends a JSON POST with:

- `source`, `site_version`, `submitted_at`
- `lead`: name, company, contact, email, telegram
- `business_profile`: industry, company size, employees, turnover, branches
- `main_pain`: problem, urgency, desired first step, meeting format
- `financial_system`: P&L, Cash Flow, payment calendar, data reliability, documents status
- `completion`: completion score, data quality hint, uncertainty fields
- `consent`: privacy and terms acceptance
- `tracking_safe`: page slug and submit source topic

## GA4 safety

GA4 receives only the safe event `submit_questionnaire`.

Allowed GA4 parameters used:

- `source`
- `page_slug`
- `completion_score`
- `data_quality_hint`
- `urgency_level`
- `industry_category`
- `desired_first_step`

Not sent to GA4:

- name
- email
- phone / contact
- Telegram
- company
- free text comments
- full questionnaire JSON

GA4 ID remains `G-94L98WZ12`. GTM is not added.

## User states

- If required fields or consent are missing, submit is blocked and the validation summary is shown.
- If webhook is configured and returns 2xx, the user sees the success message.
- If webhook is missing, offline, timed out, or returns an error, the user sees fallback instructions.
- Fallback CTAs remain available: FINMENTOR Bot, copy answers, and email.

## Test checklist

1. Open `questionnaire.html`.
2. Submit empty form: validation must appear; no webhook POST and no GA4 `submit_questionnaire`.
3. Fill required fields and submit with placeholder URL: fallback message appears; no webhook POST; GA4 receives safe `submit_questionnaire`.
4. Replace webhook constant with a Make / n8n test webhook and submit: webhook receives JSON; success message appears.
5. Check GA4 DebugView with `?debug_ga4=1`: `page_view`, `ga4_debug_ping`, and safe `submit_questionnaire` can appear after a valid submit.

