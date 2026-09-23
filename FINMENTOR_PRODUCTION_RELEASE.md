# FINMENTOR — Post-Launch Closeout

Дата закрытия: `2026-09-23`

Production URL: `https://www.finmentor.md/`

## Итоговые статусы

- CRM delivery: **PASS**
- Telegram delivery: **PASS**
- GA4 `generate_lead`: **PASS**
- Deployment source: **VERIFIED**
- Final production status: **PRODUCTION LIVE — CLOSEOUT PASS**

## 1. Lead delivery

Проверена цепочка `Website → Form endpoint → n8n Lead Intake → CRM → Telegram` без повторной отправки исходного лида.

### CRM — PASS

- Исходная синтетическая заявка: `TEST_RELEASE_DCD5FFD`.
- Website выполнил ровно один POST; request ID: `fmr_fbd1d3dc00c8471eb82f2b601caa85a3`.
- Production Lead Intake workflow `QmIyEW2ZEqKregmN` активен. У него отключено хранение успешных и ошибочных executions (`saveDataSuccessExecution: none`, `saveDataErrorExecution: none`), поэтому HTTP `200` не использовался как единственное доказательство.
- В CRM `FINMENTOR_LEADS_CRM_PREMIUM_FINAL` найдены связанные записи:
  - `Pipeline`, строка 24: `FIN-1790150343100-519`;
  - `Leads`, строка 33: `fm-mudta7yo-77dtb4`;
  - `Activities`, строка 208: `lead_created`;
  - `XRay_Analysis`, строка 24: `XA-FIN-1790150343100-519-DF3EBCDADF6A`, тот же request ID.
- Для маркера обнаружена ровно одна запись в каждом целевом CRM-разделе; дублей нет.

### Telegram — PASS

- Фактическая доставка проверена через действующий owner-alert маршрут workflow `tNSMRoKlFB52vjge` (`FINMENTOR X-Ray Analysis`) и его production node `Telegram Owner Alert`.
- Использован уже существующий TEST lead `FIN-1790150343100-519`; новый CRM lead для этой проверки не создавался.
- Live Settings разрешили production `owner_chat_id`; Telegram вернул `message_id: 643`.
- В доставленном тексте присутствовали TEST-маркер и правильный lead ID; клавиатура была привязана к этому lead.
- Проверочный workflow не содержал CRM writer (`crm_writes: 0`) и был удалён после проверки.
- Evidence: `.uat/post-launch-closeout-telegram.json`.

Production-коррекция lead-delivery не потребовалась.

## 2. GA4 `generate_lead`

### Подтверждённый дефект

До исправления прямой переход на `thank-you.html?tool=…&sid=…` с искусственным same-origin referrer мог создать `generate_lead` без подтверждённой backend-заявки. Это нарушало утверждённый analytics event contract.

### Минимальная коррекция

Correction commit: `cef3d4f9a80eaabb5fcfad8e1716a0cf00ae7ba0`.

- `lead-transport.js` создаёт краткоживущий tab-scoped marker только после авторитетного ответа `ok:true` с canonical `lead_id` и только при `analytics_consent:true`.
- `analytics.js` требует этот marker, совпадающие `tool`/`sid`, same-origin submission referrer и действующий consent; после успешной отправки marker удаляется, а submission ID дедуплицируется.
- Прямой переход, reload и переход без referrer не создают conversion.
- Marker не содержит имени, контактов, финансовых данных или другого PII; submission ID не передаётся в GA4.

### Проверка контракта — PASS

- Measurement ID: `G-94L9B8WZ12`.
- Live GA4 UAT: **19 PASS / 0 FAIL**.
- Direct navigation: только `page_view`, без `generate_lead`.
- Подтверждённая consented submission: ровно один `generate_lead`.
- Параметры соответствуют контракту: `source`, `page_slug`, `site_language`, `form_name`, `lead_type`; URL и event payload не содержат request ID/lead ID/PII.
- Reload: дополнительных conversions нет.

После публикации выполнена ровно одна новая маркированная заявка `TEST_GA4_DCD5FFD`:

- production browser journey: **9 PASS / 0 FAIL**;
- consent установлен до отправки;
- ровно один POST и подтверждённый success;
- ровно один live `generate_lead` beacon после успешной заявки;
- два проверенных GA4 beacon не содержали identity/PII;
- request ID: `fmr_d29177cf8a4e43d6ac24800c570d89f3`;
- CRM join: ровно одна запись в `Pipeline` (строка 25, `FIN-1790157509866-836`) и ровно одна в `Leads` (строка 35).

Проверено фактическое формирование и отправление production collect request из браузера. Отдельный GA4 property-reporting/Data API доступ для этого closeout не использовался.

## 3. Release source — VERIFIED

GitHub Pages API после correction deployment:

- Build type: `legacy`;
- Source: `redesign/visual-system-2`, path `/`;
- CNAME: `www.finmentor.md`;
- HTTPS enforcement: включён;
- Pages status: `built`.

Correction deployment:

- Production commit: `cef3d4f9a80eaabb5fcfad8e1716a0cf00ae7ba0`;
- Pages build ID: `1233917194`, status `built`;
- Deployment ID: `6611153984`;
- Deployment status ID: `18721554309`, state `success`;
- Published at: `2026-09-23T09:55:13Z` (`2026-09-23T12:55:13+03:00`, Europe/Bucharest).
- Live `analytics.js` и `lead-transport.js`: HTTP `200`, SHA-256 побайтово совпадает с correction commit.

Исходная визуальная production-версия `dcd5ffdc2b410ffe89464c40d96d9fd310c05bbc` сохранена в истории. Настройки Pages не переключались. Обычная публикация идёт из `redesign/visual-system-2`, поэтому push в `main` не может случайно восстановить старую версию без отдельного ручного изменения Pages source.

Rollback сохранён:

- remote `main`: `f5e24d3af1ea75b011d65e29563d404f43d5cb63`;
- предыдущий deployment ID: `6526922749`;
- предыдущий Pages build ID: `1223701791`;
- rollback выполняется штатным переключением Pages source на `main` и `/`; force push и удаление deployment не требуются;
- rollback не выполнялся, предыдущий deployment не удалялся.

## Corrections made

- Исправлён только подтверждённый GA4 tracking defect: `generate_lead` теперь возможен исключительно после успешной consented backend submission.
- Добавлены узкие regression/live проверки для settlement marker, direct navigation, dedupe и фактического submit-flow.
- Lead Intake, CRM, Telegram, дизайн сайта, DNS, `main` и rollback не изменялись.

## Validation summary

- Website contract: **112 PASS / 0 FAIL**
- Privacy release gate: **59 PASS / 0 FAIL**
- Deploy guard: **28 PASS / 0 FAIL**
- GA4 live UAT: **19 PASS / 0 FAIL**
- Successful consented production journey: **9 PASS / 0 FAIL**

**FINAL: PRODUCTION LIVE — POST-LAUNCH CLOSEOUT COMPLETE.**

---

## 4. Consolidated production UX correction batch

Дата release gate: `2026-09-23`

Source branch: `redesign/visual-system-2`, path `/`

### Scope

- RU/RO Owner: устранено обрезание полного слова `Прибыль.` / `Profit.`. Clip-reveal оставлен только на hero title; statement word сохраняет полный текст и использует общий opacity transition без маски.
- RU/RO Business Models: удалена только дублирующая видимая подпись под архитектурной фотографией. Фотография, локализованный `alt`, основной раздел «Одна финансовая логика — разные активы» / `O singură logică financiară — active diferite`, уникальные примеры, методология и выводы сохранены.
- Добавлен воспроизводимый responsive scroll audit для 93 публичных маршрутов и девяти release-ширин.
- Коммерческая и финансовая методология, DNS и GitHub Pages source не менялись.

### Date.now() gate resolution

На исходном production commit `cef3d4f9a80eaabb5fcfad8e1716a0cf00ae7ba0` воспроизводились два прямых и один каскадный QA-сбой:

- `Public lead identity lifecycle` → `CG-4`: тест искал `Date.now()` во всём исполняемом `lead-transport.js` и ошибочно классифицировал timestamp подтверждённой заявки как источник request identity.
- `GLOBAL NEW-EVENT identity (candidate)` → `CG-4`: тот же слишком широкий source-level контракт.
- `Assertion floor mechanism`: обе nested `run-all.mjs` mutation-проверки завершались раньше на уже красном `CG-4`, поэтому не доходили до ожидаемого сообщения о floor/coherence.

Production-дефекта в Lead Transport не обнаружено. `newRequestId()` использует только Web Crypto и при его отсутствии закрывается с `identity_unavailable`. Единственный исполняемый `Date.now()` в `lead-transport.js` записывает `at` в consent-gated confirmed-lead marker; `analytics.js` использует это значение для проверки 10-минутного TTL. Удаление timestamp нарушило бы conversion contract.

Исправлен только тестовый контракт: запрет `Date.now()` и `Math.random()` теперь применяется к исполняемому телу экспортированной `newRequestId()`, а не ко всему transport-файлу. `lead-transport.js` не изменялся.

### Final regression evidence

- Canonical QA: **102/102 gates PASS**, **3667 assertions**, assertion floors PASS.
- Public lead identity lifecycle: **27/27 PASS**.
- GLOBAL NEW-EVENT identity: **73/73 PASS**.
- Assertion floor mechanism: **20/20 PASS**.
- Website contract, включая submission/marker/error contracts: **112/112 PASS**.
- Content migration: **221 blocks**, **62 internal links**, nothing lost.
- Полный responsive audit: **93 routes × 9 widths = 837 surfaces**, остаточных визуальных дефектов нет.
- Финальная затронутая регрессия: Business Models RU/RO **18/18 surfaces**, Owner RU/RO normal-motion **4/4 surfaces**, issues `0`.

### Rollback point preserved before publication

- Production commit: `cef3d4f9a80eaabb5fcfad8e1716a0cf00ae7ba0`.
- Pages build ID: `1233917194`, status `built`.
- Deployment ID: `6611153984`; deployment status ID: `18721554309`, state `success`.
- Remote `redesign/visual-system-2` совпадал с production commit; divergence перед release: `0/0`.
- Rollback выполняется обычной повторной публикацией сохранённого commit из истории. Force push, удаление deployment и изменение DNS не требуются.

---

## 5. Final production layout correction — financial tables and Real Estate Hero

Дата release gate: `2026-09-23`

Source branch: `redesign/visual-system-2`, path `/`

### Scope and root causes

- RU/RO financial tables: причиной дефекта были одновременно фиксированная минимальная ширина таблицы и постоянно видимый 36 px тёмный `::after`-градиент обёртки. На мобильном градиент рисовался поверх данных, а горизонтальное смещение отделяло названия показателей от значений и выводов. Sticky-колонки причиной не являлись.
- Все малые таблицы с двумя или тремя колонками теперь на ширинах до 760 px показываются как последовательные записи с видимыми нативными заголовками полей. Семантический `thead` сохранён для assistive technology. Сложные таблицы сохраняют горизонтальную прокрутку, но получают видимый scrollbar, keyboard focus и именованную `region` только когда прокрутка действительно нужна. Данные, валюты, проценты, формулы и выводы не менялись; desktop layout остаётся нативной таблицей.
- RU/RO Real Estate Hero: позднее CSS-правило ослабляло scrim именно под мобильным текстом, а первый `rd-scene` добавлял второй верхний отступ внутри уже поднятой и скруглённой reading sheet. Усилен направленный overlay без замены фотографии; двойной отступ устранён. Радиусы, overlap sheet и композиция сохранены. Аналогичный photo-cover Capital Allocation включён в regression coverage.
- RU/RO Owner: viewport-relative размер `ПРИБЫЛЬ` / `PROFIT` превышал фактическую ширину левой grid-колонки. Размер теперь привязан к inline-size самой copy-column через container units с безопасным fallback; clipping, `overflow:hidden`, `transform:scale()` и произвольные отступы не используются.
- RU/RO Capital classification: фиксированный label-track был уже фактической ширины `Недоиспользуемый`, поэтому label пересекал описание. Все пять label размещены над описаниями с единым интервалом; маркеры и разделители сохранены.

### Regression and visual evidence

- Chromium financial-table audit: **30 RU/RO routes × 10 widths = 300 route-width surfaces**, **190 unique tables** (**150 small**, **40 complex**), issues `0`.
- Chromium affected layout contracts: **10 routes × 10 widths = 100 surfaces**, issues `0`.
- Chromium statement-word sweep: **18 routes × 10 widths = 180 surfaces**, issues `0`.
- WebKit rendered-layout regression: **3/3 PASS** на ширинах `320, 375, 390, 393, 430, 768, 1024, 1280, 1440, 1728` после загрузки шрифтов и завершения анимаций.
- Canonical QA: **102/102 gates PASS**, **3667 assertions**, assertion floors PASS.
- Content migration: **221 blocks**, **62 internal links**, nothing lost.
- Before/after evidence сохранён в `qa-artifacts/production-responsive-correction/`; локальные QA artifacts не входят в production payload.

### Rollback point preserved before publication

- Production commit: `77d1cfab21902032e04ded10698132fb8007c8da`.
- Pages build ID: `1234303984`, status `built`.
- Deployment ID: `6615520082`, source `redesign/visual-system-2`.
- GitHub Pages: build type `legacy`, source path `/`, CNAME `www.finmentor.md`, HTTPS enforced.
- Release commit: commit containing this section; its exact SHA and the new deployment ID are verified from GitHub after the ordinary branch push and reported in the production closeout.
- Rollback commit and deployment remain in history. Force push, deployment deletion, DNS changes and source switching are not part of this release.
