# FINMENTOR — Full System Audit

Дата аудита: 2026-08-25
Ветка аудита: audit/finmentor-full-system
Audit HEAD до создания отчёта: a44aa72fb14a9c8c7f1474bf99e8fdbfc0fa774b
Текущий main: 6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010
Режим: read-only audit; production changes, merge и fixes не выполнялись

## Evidence basis and limitations

Проверены tracked-файлы репозитория, история Git/GitHub PR, публичные HTTP GET/HEAD-ответы, статические HTML/CSS/JS-контракты, содержимое tracked ZIP без распаковки в рабочее дерево, локальные JS syntax/unit tests и документы B.2.1. Production POST-запросы, отправка реальных лидов и мутации внешних систем намеренно не выполнялись.

Публичные GET-проверки 2026-08-25 подтвердили HTTP 200 для /, /ro/, /app/, RU/RO financial health check, questionnaire, thank-you, privacy и analytics.js; неизвестный URL вернул HTTP 404. Публичный analytics.js содержит правильный Measurement ID.

Существенные ограничения:

- Browser runtime был инициализирован по обязательной процедуре, но список доступных browser instances оказался пуст. Поэтому live visual QA 390/430 px, DevTools console/network, GA4 DebugView и интерактивное consent accept/deny не выполнены.
- Live n8n API доступ подтверждён: health/readiness и authenticated public API v1 GET вернули HTTP 200. Cursor pagination проверена отдельным проходом 10/10/10/3; получены 33 уникальных workflow, включая inactive и archived. Значение API key, credential secrets, `pinData` contents и execution payloads не выводились.
- Проверка оставалась строго read-only: использовались только GET; production webhooks не вызывались, executions не запускались, workflow/credentials/active states не изменялись. Execution API опрашивался только с `includeData=false`.

Authenticated live n8n inventory завершён в пределах public API: metadata, nodes, connections, settings, tags, credential references, write paths, external calls и error/retry configuration получены. Содержимое retained executions намеренно не извлекалось; наличие пяти последних Lead Intake execution records подтверждено только по metadata.

# 1. Executive Summary

Итоговый вердикт: **NO-GO** для нового integration release, Mini App submit/resume, merge PR #10 и Data Table production mirror. Этот вердикт не требует остановки или отката текущего публичного сайта: существующий production следует оставить без изменений до отдельного owner-approved fix scope и последующей независимой проверки.

| Контур | Итог | Ключевой вывод |
|---|---|---|
| Public website RU/RO | ISSUES | Canonical sitemap-пути доступны, но live visual/network QA не завершён; есть RO mini-scan localization, x-default и legacy-indexation drift |
| GA4 | ISSUES | Runtime ID правильный и consent gate статически корректен; полный URL/query создаёт PII exposure path, а event dedup/coverage неполны |
| Live n8n API | PASS / SYSTEM ISSUES | 33 workflow получены полной pagination: 7 active, 26 inactive, включая 7 archived; API access закрыт, но topology выявила P0/P1 issues |
| Website → n8n | ISSUES | Live Lead Intake имеет explicit 200/400/503, но отвечает после Pipeline checkpoint до secondary writes; canonical idempotency остаётся неатомарной |
| Lead Intake | CRITICAL ISSUES | Active QmIyEW2ZEqKregmN; validation/dedup/writes подтверждены, но browser-controlled lead/state может merge/escalate canonical row, GA IDs не нормализуются, HOT по умолчанию может отправлять PII/raw payload в OpenAI |
| CRM | CRITICAL ISSUES | Pipeline является live dedup/source path, но Command Center auth bypass позволяет forged state changes; его update node также использует иной Pipeline GID, чем reads и остальные production writers |
| Telegram | CRITICAL ISSUES | Один active Concierge trigger; Transport active. Active Command Center использует generic unauthenticated webhook и доверяет spoofable Telegram-shaped IDs |
| Mini App | BLOCKED | Текущий /app/ — B2.0 mock без production submit; resume contract PR #10 не доказан |
| PR #10 | BLOCKED | Draft, docs-only, без checks/reviews; stored-row equality и session_id projection имеют известный дефект |
| Data Table | DERIVED ONLY | Может быть только ускоряющим read-model; Bot_Sessions остаётся authority |
| Privacy | ISSUES | GA4 URL-query exposure сохраняется; Lead Intake условно отправляет в OpenAI contact PII и полный raw payload; все 33 pinData пусты, но Lead Intake execution metadata retained |

Подтверждённые severity totals:

- P0: 3
- P1: 6
- P2: 12
- P3: 6

Updated P0 включает исходный GA4 URL/query exposure path и два live n8n trust-boundary findings: spoofable Command Center и browser-controlled Lead Intake merge/state. Наличие исторических GA4 PII hits или фактически совершённой эксплуатации webhook-ов не утверждается; POST/exploit validation не выполнялась.

# 2. Current Architecture

Текущий web lead flow:

    RU/RO static website
      → local consent decision
      → GA4 loader/events, только после analytics consent
      → consultation / X-Ray / working-capital mini-scan
      → public n8n webhook finmentor-lead-intake
      → Lead Intake QmIyEW2ZEqKregmN [active]
      → Pipeline current state + Leads archive + Lead_Answers + Activities
      → Telegram alerting / OpenAI work-plan branch
      → server-side GA4 lifecycle [absent]

Текущий Telegram/Mini App target flow:

    Telegram client
      → Mini App /app/
      → raw signed initData
      → server-side Telegram HMAC validation
      → authoritative Bot_Sessions lookup
      → optional derived Data Table HIT
      → any uncertainty = MISS
      → authoritative Bot_Sessions fallback
      → safe response whitelist

Установленные границы:

- Pipeline — canonical current lead state.
- Leads — stable intake archive, не конкурент Pipeline.
- Activities — event/action journal.
- Bot_Sessions — authoritative Telegram client-session state.
- n8n Data Table — derived read-model only, никогда не source of truth.
- Telegram initDataUnsafe — presentation/prefill only; privileged identity должна происходить только из server-validated initData.

Физическая архитектура сайта: GitHub Pages, CNAME www.finmentor.md, static HTML/CSS/JS. В sitemap 62 URL, то есть 31 физическая RU/RO пара.

# 3. Production Inventory

## 3.1 Website and analytics

| Компонент | Production evidence | Состояние |
|---|---|---|
| GitHub Pages website | Live GET, Server: GitHub.com, CNAME www.finmentor.md | ACTIVE PRODUCTION |
| GA4 web stream | analytics.js, ID G-94L9B8WZ12 | ACTIVE PRODUCTION |
| Old GA4 stream | G-94L98WZ12 только в historical reports/archives | LEGACY; запрещён к восстановлению |
| Mini App /app/ | Live 200; static B2.0 mock, без backend submit | ACTIVE UI / INTEGRATION BLOCKED |

## 3.2 n8n workflow inventory

**LIVE INVENTORY STATUS: PASS (access) / ISSUES (deployment).** `GET /api/v1/workflows` прошёл cursor pagination 10/10/10/3 и дал 33 unique rows. Default list включает inactive и archived; контрольный `active=false` дал 26 rows, включая все 7 archived. `isArchived`/`archived` filters API не поддержал, поэтому archive coverage доказана по unfiltered rows и `isArchived` каждого workflow. Все 33 `tags=[]`; все 33 `pinData` пусты. Credential objects читались только как type + reference `id/name`; secret values не запрашивались.

Сводка без пересечения: 4 active event-driven production + 3 active scheduled + 18 inactive QA/benchmark + 7 archived Concierge revisions + 1 inactive unrelated template = 33.

| Класс | ID / name | active / archived | updatedAt UTC | Trigger | Nodes / connection edges |
|---|---|---|---|---|---:|
| PROD event | QmIyEW2ZEqKregmN — FINMENTOR Lead Intake PREMIUM FINAL | true / false | 2026-08-24T19:15:38.909Z | POST `finmentor-lead-intake` | 57 / 64 |
| PROD event | mppzthlkSJFr6Kle — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | true / false | 2026-08-25T05:15:27.426Z | Telegram Trigger | 33 / 36 |
| PROD event | ShcmmJeLSE8LYVBk — FINMENTOR Telegram Client Transport | true / false | 2026-08-25T02:38:56.282Z | Execute Workflow Trigger | 20 / 33 |
| PROD event / unexpected exposure | Ukn1cprWiXzBHojl — FINMENTOR Lead Command Center PREMIUM FINAL | true / false | 2026-08-24T14:30:22.418Z | POST `finmentor-lead-command-center` | 21 / 20 |
| PROD schedule | LZ2mvKXbBikmeVTn — FINMENTOR SLA Lead Watch PREMIUM FINAL | true / false | 2026-08-24T14:30:22.418Z | every hour | 10 / 9 |
| PROD schedule | zeLOCuf0K1bkaKl2 — FINMENTOR Followup Sequence PREMIUM v2 | true / false | 2026-08-24T14:30:22.418Z | every hour | 15 / 14 |
| PROD schedule | imeJIDeNyaWDyXzh — FINMENTOR Daily Lead Digest PREMIUM FINAL | true / false | 2026-08-24T14:30:22.418Z | daily 08:30, workflow timezone override absent | 9 / 8 |
| QA | kKVHHE5LNHuJUuNR — [TEST] B.2.1-A Ed25519 Runtime Capability Probe | false / false | 2026-08-25T06:45:55.573Z | manual | 3 / 1 |
| QA | aGTlNJ1vihi6rGqY — [TEST] B.2.1-A Telegram Format + Verify-Only Probe | false / false | 2026-08-25T06:55:53.467Z | manual | 3 / 1 |
| QA | XT1B6u8dHgOzItKN — FINMENTOR B.1 F7C Candidate Path | false / false | 2026-08-25T05:09:24.835Z | daily 03:00 schedule definition | 13 / 12 |
| QA | IzCDJFcCrprkwKOv — FINMENTOR B.1 Read Benchmark | false / false | 2026-08-25T04:59:30.300Z | daily 03:00 schedule definition | 44 / 43 |
| QA | sioGhZwhbs6JKpCd — FINMENTOR B.2.1-A Bot ID Tamper Control | false / false | 2026-08-25T07:58:52.496Z | POST `miniapp/botid-control` | 4 / 2 |
| QA | 1Yw9LF6EJNCAYkQx — FINMENTOR B.2.1-A Canary Launcher | false / false | 2026-08-25T07:59:25.481Z | manual | 4 / 2 |
| QA | hGQAfPWBK75xeWco — FINMENTOR B.2.1-A Canary Page | false / false | 2026-08-25T09:38:33.071Z | GET `canary/b21a` | 3 / 1 |
| QA | AWQ0Telk7T9ynBlR — FINMENTOR B.2.1-A Mini App Bootstrap | false / false | 2026-08-25T08:01:43.121Z | POST `miniapp/bootstrap` | 4 / 2 |
| QA | 03DcHoJ5XxJYUZQ4 — FINMENTOR B.2.1-B CAS Gate | false / false | 2026-08-25T10:08:45.806Z | manual | 8 / 6 |
| QA | NMC4aZWtxGz3J24L — FINMENTOR B.2.1-B Data Table Live Proof | false / false | 2026-08-25T09:38:57.766Z | POST `miniapp/resume` | 11 / 9 |
| QA | zOSBbpIpvRyAIljp — FINMENTOR B.2.1-B Data Table Proof | false / false | 2026-08-25T11:14:58.244Z | manual | 15 / 13 |
| QA | rHSRlwV6JkQzxWy1 — FINMENTOR B.2.1-B Direct Sheets REST Benchmark | false / false | 2026-08-25T09:29:00.991Z | manual | 26 / 24 |
| QA | D8TnxS6mqqM1RO9v — FINMENTOR B.2.1-B Lookup Benchmark | false / false | 2026-08-25T08:42:50.508Z | POST `b21b/lookup-bench-never-active` | 13 / 11 |
| QA | AYa6BeKRlgaDQa7d — FINMENTOR B.2.1-B Payload Width Benchmark | false / false | 2026-08-25T08:54:05.842Z | POST `b21b/width-bench-never-active` | 13 / 11 |
| QA | UEnjDvZGjMqsNdAI — FINMENTOR B.2.1-B Race Runner | false / false | 2026-08-25T10:14:06.179Z | POST `b21b/race-never-active` | 10 / 8 |
| QA | NlIHfmuBQ4mS70G6 — FINMENTOR B.2.1-B Resume Test Harness | false / false | 2026-08-25T08:28:06.715Z | POST `b21b/harness-never-active` | 8 / 6 |
| QA | iZPvZ7Fc6O3kim5U — FINMENTOR B.2.1-B Sheets Read Benchmark | false / false | 2026-08-25T08:36:35.995Z | manual | 11 / 9 |
| QA | OwLC7SANtHo69SKo — FINMENTOR Session Read Model Sync QA | false / false | 2026-08-25T09:59:37.662Z | POST `b21b/sync-qa-never-active` | 11 / 10 |
| ARCHIVED | XaALTuPO7KMrajsX — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | false / true | 2026-07-01T09:31:53Z | Telegram Trigger definition | 17 / 16 |
| ARCHIVED | S6iTke2T3OpaRMGz — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | false / true | 2026-07-01T10:15:54Z | Telegram Trigger definition | 19 / 17 |
| ARCHIVED | Hgzy6pVqAxIVuARQ — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | false / true | 2026-07-01T10:00:04Z | Telegram Trigger definition | 19 / 17 |
| ARCHIVED | CmCrvFJJzFVoDwk9 — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | false / true | 2026-07-01T11:58:49Z | Telegram Trigger definition | 19 / 18 |
| ARCHIVED | 1bpUACOrbOWFnIrU — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | false / true | 2026-07-01T10:39:25Z | Telegram Trigger definition | 19 / 17 |
| ARCHIVED | UEOJm1um3Vi9Qp5g — FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED | false / true | 2026-07-01T11:32:36Z | Telegram Trigger definition, credential ref absent | 21 / 21 |
| ARCHIVED | sr7RMpUHexvbW44y — FINMENTOR Telegram Client Concierge PREMIUM v2 | false / true | 2026-07-01T09:03:24Z | Telegram Trigger definition | 16 / 16 |
| OTHER inactive | m5kaG1baUg6sQ7Xb — Бот Ракурс (шаблон для импорта) | false / false | 2026-08-24T14:30:22.418Z | POST `rakurs-vk-bot` | 11 / 5 |

### Active relevant workflow detail

| Workflow | Nodes / connections | Settings, tags, pinData | Credential references | Write paths and external calls | Error / retry |
|---|---|---|---|---|---|
| Lead Intake QmIy… | code 24, Sheets 12, IF 4, Respond 7, StopAndError 3, Telegram 4, OpenAI 1, Webhook 1; 43 connection sources / 64 edges | `executionOrder=v1`, `binaryMode=separate`, `availableInMCP=true`; tags none; pinData none | Google Sheets `PzVC…`, Leads Bot `Mj41…`, OpenAI `MC2u…` | Current CRM doc: Pipeline append/update/read; Leads, Lead_Answers, Activities, Dashboard_Feed, AI_Plans writes; Telegram alerts; OpenAI call | Sheets writes retry 3×/2s; OpenAI 2×/3s; primary Pipeline failures have error output + 503/StopAndError. 200 is returned before secondary writes, whose terminal failures have no global monitor |
| Client Concierge mpp… | code 16, Sheets 6, ExecuteWorkflow 3, IF 5, HTTP 1, Telegram send 1, Telegram Trigger 1; 31 sources / 36 edges | `executionOrder=v1`, `binaryMode=separate`, `availableInMCP=true`; tags/pinData none | Google Sheets `PzVC…`, Client Bot `2JnV…` | Bot_Sessions appendOrUpdate at exactly Save Bot Session / Save Intake State / Save Confirmation State by `chat_id`; Bot_Events append; HTTP POST node Send Lead to Intake; three calls to Transport | Intake HTTP 2×/2s; two state saves 3×/2s; selected branches continue on error; no global error workflow |
| Transport Shc… | Telegram 14, code 3, IF/Switch, ExecuteWorkflow Trigger; 18 sources / 33 edges | `executionOrder=v1`, `availableInMCP=true`; tags/pinData none | Client Bot `2JnV…` | Telegram sends only | Each of 14 render/send nodes retry 2×/1.5s and continues regular output; no global error workflow |
| Command Center Ukn… | code 6, Sheets 6, Telegram 5, IF 2, Switch, generic Webhook; 14 sources / 20 edges | `executionOrder=v1`, `binaryMode=separate`, `availableInMCP=true`; tags/pinData none; webhook auth/credential/options absent | Google Sheets `PzVC…`, Leads Bot `Mj41…` | Reads Pipeline GID 1883973304 but Update Pipeline Row targets different GID 1997367085; appends Status_Log and Activities; Telegram replies | Sheets/Telegram update path has zero retry; only callback answer has continue-on-fail; no signature/header verification and no global monitor |
| SLA LZ… | code 4, Sheets 4, Schedule, Telegram; 8 sources / 9 edges | v1, separate, MCP true; tags/pinData none | Sheets `PzVC…`, Leads Bot `Mj41…` | Pipeline GID 1883973304 update; Activities append; Telegram | zero retry/onError; no global monitor |
| Followup ze… | code 5, Sheets 7, Schedule, Switch, Telegram; 13 sources / 14 edges | v1, separate, MCP true; tags/pinData none | Sheets `PzVC…`, Leads Bot `Mj41…` | Followups append/update; Activities append; Pipeline/Settings reads; Telegram | zero retry/onError; no global monitor |
| Digest ime… | code 3, Sheets 4, Schedule, Telegram; 8 sources / 8 edges | v1, separate, MCP true; tags/pinData none | Sheets `PzVC…`, Leads Bot `Mj41…` | Activities append; Pipeline/AI_Plans/Settings reads; Telegram | zero retry/onError; no global monitor |

Credential references выше намеренно сокращены, а значения credentials не запрашивались. Во всём inventory встречаются три credential types: Google Sheets OAuth2, Telegram API (два named references: Leads Bot и Client Concierge Bot) и OpenAI API.

### Known IDs, QA/read-model and exposure checks

| ID | Live result |
|---|---|
| kKVHHE5LNHuJUuNR | 200; inactive/non-archived; manual; 3 nodes/1 edge; no credentials/writes/retry/pinData |
| aGTlNJ1vihi6rGqY | 200; inactive/non-archived; manual; 3/1; no credentials/writes/retry/pinData |
| AWQ0Telk7T9ynBlR | 200; inactive/non-archived; POST bootstrap definition; 4/2; no credentials/writes/pinData; success/error/manual execution saves explicitly `none/false` |
| NlIHfmuBQ4mS70G6 | 200; inactive/non-archived; never-active webhook definition; 8/6; Sheets read only; one retry node; no pinData |
| iZPvZ7Fc6O3kim5U | 200; inactive/non-archived; manual; 11/9; nine retrying Sheets reads; no writes/pinData |
| D8TnxS6mqqM1RO9v | 200; inactive/non-archived; never-active webhook definition; 13/11; Sheets read only; no pinData |
| AYa6BeKRlgaDQa7d | 200; inactive/non-archived; never-active webhook definition; 13/11; Sheets read only; no pinData |
| OwLC7SANtHo69SKo | 200; inactive/non-archived; never-active sync webhook definition; 11/10; QA Data Table upsert/read/delete; error outputs on write nodes; no pinData |

Additional QA Data Table/CAS/race writes exist only in inactive workflows 03Dc…, UEnj… and OwLC… against the same QA table reference. Active workflows contain zero Data Table nodes, so Data Table is not a live second source of truth. NMC4… provides an inactive `miniapp/resume` read endpoint definition; active Client Concierge performs its own authoritative Bot_Sessions read, but there is no active Mini App/Gateway/Resume public workflow.

Webhook inventory: 12 method+path definitions, only two active production paths. Duplicate method+path groups: **0**; duplicate Lead Intake paths/workflows: **0**. Девять FINMENTOR temporary/QA webhook definitions существуют, но все inactive, следовательно active temporary public endpoints = **0**. Active test/canary workflows = **0**.

Telegram Trigger inventory: 8 definitions, из них active только mppz…. Один Client Concierge credential reference используется active workflow и шестью archived revisions; ещё один archived trigger не имеет credential ref. Одновременной коллизии нескольких active Telegram Trigger на одном credential нет.

Error Monitor не найден: 0 Error Trigger nodes и 0 non-empty `settings.errorWorkflow` во всех 33. Все 7 active workflows не имеют global failure route; SLA, Followup и Digest дополнительно имеют 0 retry nodes и 0 node error routes.

## 3.3 GitHub ↔ n8n drift

Вердикт по drift: **ISSUES**.

- Live deployment измерим, но в tracked tree по-прежнему нет ни одного n8n workflow JSON export; единственные tracked JSON — web manifests. Все 7 active production graphs не имеют versioned field-by-field baseline или commit binding.
- Main документирует как active только роли Client Concierge, Transport и Lead Intake, без deployed IDs/versions. Live SLA, Followup, Digest и Command Center не имеют main active-deployment inventory; Command Center дополнительно оказался P0 exposure.
- PR #14 producer fields можно сравнить с live receiver: UTM поддержан частично, а `analytics_consent`, `ga_client_id`, `ga_session_id` отсутствуют в structured Lead Intake model. Это фактический contract drift.
- PR #10 остаётся docs-only. Live Concierge writer inventory совпадает с тремя описанными Bot_Sessions nodes, но Data Table/resume production path отсутствует; QA implementations inactive.
- Единственный прямой code comparison — tracked `gateway/n8n/bootstrap-canary.js` против AWQ0… Code node после redaction/normalization BOT_ID — не совпал: 256 live lines против 261 repo lines и разные hashes. Среди различий live parser пропускает empty pair, слабее проверяет content type и `auth_date`; workflow inactive, поэтому это drift/security QA issue, не active exploit.
- Все восемь заданных QA IDs удовлетворяют ключевому state contract inactive/non-archived; `pinData` отсутствует. Это PASS по state, но не устраняет отсутствие deployable exports.

Итог requested status: `GITHUB ↔ N8N DRIFT = ISSUES`.

## 3.4 Relevant merged PR history

GitHub metadata проверены read-only. PR #4 и #10 не входят в заданный minimum merged history; #10 разобран отдельно.

| PR | Head → merge | Результат для текущего состояния |
|---:|---|---|
| #1 | 6321174 → 3e7d525 | Исправлена RU/RO deploy structure |
| #2 | 6ae8246 → ca0b9ec | Добавлены/fixed RO portrait assets |
| #3 | 73b90d7 → d3c46ac | Добавлен B2.0 Mini App mock |
| #5 | 8aea3b1 → 1115af5 | Consent-aware GA loader |
| #6 | 80b6f1e → ea71528 | Telegram validator foundation |
| #7 | baa1160 → dcbc5d7 | Legacy GA consent reconciliation |
| #8 | 8d14d81 → 31cae19 | Real initData canary evidence/closure merge |
| #9 | 5cb612f → db4a560 | GA ID change |
| #11 | 13d5a50 → 83715f5 | GA business conversions |
| #12 | 2c7eaac → f6ee315 | Contrast fix |
| #13 | 4115928 → 67b90d5 | Вновь внесён неверный G-94L98WZ12 из старого release assumption |
| #14 | 49f9e7b → e477e5c | Frontend attribution payload |
| #15 | a70b019 → 6b8fefc | Production возвращён на G-94L9B8WZ12 |

# 4. Website QA

## 4.1 Canonical public surface

| Проверка | Результат | Evidence / limitation |
|---|---|---|
| RU root и physical /ro/ | PASS с issues | Оба live 200; структура и локальные assets присутствуют |
| Sitemap files | PASS | 62/62 URL имеют физический файл; 31 RU/RO pair |
| Audited RU/RO HTML surface | STATIC PASS | 62 sitemap URLs + 2 noindex thank-you pages = 64; все live 200, без broken local href/src и duplicate IDs |
| Canonical and hreflang presence | PASS | На canonical sitemap pages отсутствующих tags не найдено |
| x-default consistency | ISSUE | 60 внутренних HTML pages указывают x-default на homepage, тогда как sitemap указывает RU counterpart |
| Internal links/fragments | PASS для sitemap surface | Missing local targets и broken fragments: 0 |
| Navigation/CTA | STATIC PASS | Canonical links разрешаются; интерактивный browser click-through недоступен |
| Consultation form | STATIC PASS / CONTRACT ISSUE | Payload строится; backend result проверяется недостаточно |
| Financial X-Ray RU/RO | STATIC PASS / CONTRACT ISSUE | Payload/validation присутствуют; live 200/400/503 semantics подтверждены, но client ignores body и backend idempotency неатомарна |
| Working-capital mini-scan | ISSUE | Отправляет production webhook; RO result/error/share strings частично русские |
| Thank-you pages | STATIC PASS | Direct visit защищён referrer/tool gate от generate_lead |
| Contact links | PASS | Canonical external targets: t.me/finmentor_md_bot и mailto:cfo@finmentor.md |
| Downloads | PASS / latent code | Публичных внутренних download targets нет; resource_download listener остаётся latent |
| Privacy/cookie UI | ISSUE | Consent UI есть; privacy disclosure не полностью совпадает с фактической server-side отправкой |
| Unknown route | PASS на edge behavior | Live unknown URL вернул 404; собственного tracked 404.html нет |
| Host/protocol redirects | PASS | http/apex/www варианты дают 301 на https://www.finmentor.md/ |
| /app/ | STATIC PASS / INTEGRATION BLOCKED | Live 200, templates/IDs/syntax intact, production submit отсутствует |
| RO portrait regression | STATIC PASS | portrait-mobile/medium/large assets существуют; aspect/object-fit/object-position rules сохранены |
| 390/430 mobile и desktop visuals | UNVERIFIED | Browser runtime setup выполнен, но browser registry пуст |
| Console/network errors | UNVERIFIED | Browser instance отсутствует; static/HTTP checks не заменяют DevTools |

Live GET samples:

- / — 200, 102,947 bytes.
- /ro/ — 200, 88,471 bytes.
- /app/ — 200, 13,595 bytes.
- RU questionnaire — 200, 153,460 bytes.
- RO questionnaire — 200, 142,037 bytes.
- RU/RO working-capital scan — 200, 50,467 / 48,195 bytes.
- RU/RO health check, thank-you и privacy — 200.
- analytics.js — 200, 13,213 bytes и правильный Measurement ID.
- Заведомо неизвестный path — 404 со стандартной GitHub Pages page.

RU/RO producer parity статически подтверждена по именам/IDs полей: consultation 5/5, questionnaire 400/400, mini-scan 26/26. Это не подтверждает backend semantics.

## 4.2 Website issues

1. В ro/working-capital-scan.html остаются русские result labels, validation/error и share messages. Это нарушает RU/RO parity, хотя сам route и submission работают статически.
2. HTML и sitemap расходятся по x-default для 60 внутренних language URLs. Это SEO/canonical drift, а не missing-tag defect.
3. В tracked tree остаются 22 indexable legacy/alias HTML files вне sitemap: 17 numbered copies и 5 language/route aliases. Часть использует старые mailto flows, расходящиеся canonical и относительные ../ paths.
4. Собственного 404.html и retained automated web/GA browser QA нет.
5. Browser-based mobile, accessibility interaction, consent network и console QA остаются обязательным independent gate.

# 5. GA4 QA

## 5.1 Stream and consent

Production runtime stream: **G-94L9B8WZ12**.

- analytics.js:4 содержит правильный ID.
- Неверный G-94L98WZ12 не найден в текущем production runtime code.
- Старый ID найден в четырёх historical reports и в двух из трёх tracked ZIP archives. Это classified legacy evidence, не active runtime.
- analytics.js не создаёт Google script до stored/user accept.
- Deny оставляет analytics noop и удаляет/не загружает Google script.
- Accepted path устанавливает send_page_view: false и отправляет один explicit page_view.
- Isolated VM contract-тест подтвердил no-load/no-business-events до consent, deny cleanup, accepted configure/enrichment и direct thank-you guard.
- Runtime network behavior до/после accept не подтверждён browser/DebugView в этом аудите.

## 5.2 Business events

| Event | Статическая реализация | Вывод |
|---|---|---|
| generate_lead | thank-you + allowed tool + same-origin referrer + sessionStorage key | Direct visit не срабатывает; mini_scan исключён; dedup слишком широкий |
| lead_form_start | form interaction + sessionStorage dedup | Key ставится до consent; событие может безвозвратно потеряться |
| contact_click | delegated click tracking | Реализовано; live DebugView не проверен |
| resource_download | delegated download tracking | Реализовано, но canonical site сейчас не содержит download target |

Подтверждённые дефекты:

- analytics.js:211-216 отправляет page_location: location.href и page_path вместе с location.search. Business-event allowlist это не очищает. Если URL содержит email, phone, company или free text, они попадут в GA4 после consent. Это P0 exposure path; наличие реальных исторических PII hits не доказано.
- generate_lead dedup key содержит только tool. Второй законный same-tool lead в той же tab session будет подавлен.
- mini_scan не входит в allowlist generate_lead и не использует общий standard lead_form_start.
- lead_form_start session key ставится до успешной analytics dispatch; interaction до accept может быть потерян после accept.
- Старые и новые event families сосуществуют: FMAnalytics business events и legacy custom click/submit events. Loader обычно не дублируется, но taxonomy drift повышает риск двойного/несогласованного измерения.

## 5.3 Attribution fields

FMAnalytics.enrichLeadPayload добавляет:

- analytics_consent всегда;
- ga_client_id и ga_session_id только после consent и если identifiers доступны.

Consultation form, RU X-Ray и RO X-Ray вызывают enrichment. Mini-scan его не вызывает. RU X-Ray также не добавляет site_language в meta, тогда как RO добавляет. Live acceptance/storage/merge result приведён ниже.

Live receiver trace меняет последний вывод на **GA ATTRIBUTION THROUGH N8N: FAIL**:

| Field | Где принимается | Где нормализуется | Где сохраняется | Dedup / merge result |
|---|---|---|---|---|
| `analytics_consent` | Generic Webhook/Validate Payload сохраняет входной body | Нигде: Normalize читает `meta.consent` как privacy consent, но не `meta.analytics_consent` | Только косвенно внутри `Leads.Raw JSON`; dedicated column/Pipeline field отсутствует | Не входит в canonical merge; retry branch не архивирует повтор |
| `ga_client_id` | Generic body | Нигде | Только `Leads.Raw JSON`, если producer его прислал | Не входит в Pipeline/dedup/merge |
| `ga_session_id` | Generic body | Нигде | Только `Leads.Raw JSON`, если producer его прислал | Не входит в Pipeline/dedup/merge |
| `utm_source` | `meta` или root `attribution` | Normalize + Score Lead | New lead: Pipeline, Leads, Dashboard_Feed и Raw JSON | Existing Pipeline first-touch value сохраняется, но новый merge touch не обновляет canonical UTM; 2-minute retry touch не архивируется |
| `utm_medium` | То же | То же | То же | То же |
| `utm_campaign` | То же | То же | То же | То же |

Таким образом, UTM new-lead path существует и empty merge не затирает существующие Pipeline UTM, но incoming merge/retry attribution не становится canonical. Три GA/consent fields не нормализуются и операционно теряются вне raw archive. Mini-scan не отправляет их уже на producer side.

# 6. Website → n8n Contract

Public endpoint, найденный во всех producer paths:

    https://ghennadi.app.n8n.cloud/webhook/finmentor-lead-intake

Production POST не выполнялся.

| Producer | Identity/idempotency | Consent/attribution | Client success rule | Риск |
|---|---|---|---|---|
| Consultation, main.js | Стабильный lead_id отсутствует | meta.consent + UTM session storage + GA enrichment | Любой HTTP 2xx/res.ok | Duplicate после timeout; false thank-you |
| RU X-Ray | Client fm-time-random один раз на page load | Повторяющиеся consent blocks + current-page UTM + GA enrichment | Любой HTTP 2xx/res.ok | Refresh меняет ID; response body не проверен |
| RO X-Ray | То же | То же | Любой HTTP 2xx/res.ok | То же |
| RU/RO mini-scan | Стабильный lead_id отсутствует | Не вызывает GA enrichment; отдельная payload shape | Любой HTTP 2xx/res.ok | Duplicate, attribution loss, false success |

Live response contract частично закрывает клиентскую слабость: `Respond New Lead`, `Respond Retry` и `Respond Merged` дают HTTP 200 с `ok:true` и `lead_id`; invalid payload даёт 400, Pipeline/merge/infrastructure failure — 503 с `ok:false`. Однако browser по-прежнему проверяет только HTTP 2xx, а 200 отправляется сразу после canonical Pipeline append/update **до** Leads, Lead_Answers, Activities, Dashboard_Feed, alerts и AI branches. Secondary failure поэтому может быть показан как полный success и остаётся без global Error Monitor.

Timeout/manual retry:

- Producers abort-ят клиентский fetch примерно через 12 секунд; автоматического retry в просмотренном коде нет.
- После неоднозначного timeout пользовательский повтор/перезагрузка остаётся возможным и может повторить уже принятую backend заявку.
- Consultation/mini-scan не имеют стабильного idempotency key.
- X-Ray client ID меняется после refresh/new load.
- Server-side dedup существует: strong `lead_id`, medium normalized email/phone/Telegram, weak company+name в пределах 48h; Won/Lost не absorb-ят новый submit, а repeat до 2 минут получает retry response. Но это read-Pipeline-then-append/update без atomic lock/unique ledger, поэтому concurrent race и user-controlled `lead_id` остаются.

UTM:

- Consultation сохраняет landing UTM в sessionStorage.
- X-Ray читает текущий URL; переход landing → questionnaire может потерять UTM.
- Language switching также не гарантирует полное сохранение query.
- Mini-scan не передаёт общий GA enrichment.

Payload vocabulary, live result:

- X-Ray вычисляет GREEN/YELLOW/ORANGE/RED и suggested statuses VIP/Hot/Qualified/Meeting Needed/Not Fit/New.
- Gateway target contract использует priority HOT/WARM/COLD и zone RED/YELLOW/GREEN/UNKNOWN.
- Live normalizer пересчитывает priority в HOT/WARM/COLD/INCOMPLETE, но принимает browser diagnostic/risk labels и сохраняет также ORANGE, тогда как documented server target перечислял RED/YELLOW/GREEN/UNKNOWN. Privacy consent берётся из нескольких client-controlled locations. Это подтверждённый contract issue, а не unknown.
- Webhook-level authentication/options отсутствуют. Validator ограничивает body примерно 64 KiB, depth 8, key count 2000, обрезает oversized strings/arrays, проверяет honeypot/meaningful data/ID shape; visible rate/origin protection в graph отсутствует, platform-edge limits не измерялись.

# 7. CRM Contract

## 7.1 Canonical boundaries

| Store | Допустимая роль | Audit result |
|---|---|---|
| Pipeline | Canonical current lead state | LIVE: Lead Intake dedup/read + append/update on GID 1883973304; SLA writes same. Command Center reads this GID but update targets different GID 1997367085 — split/misdirected production write path |
| Leads | Stable intake archive | LIVE append after Pipeline response; includes structured UTM/privacy consent and full Raw JSON |
| Lead_Answers | Structured answer detail | LIVE append after response; 12-column answer projection |
| Activities | Event/action journal | LIVE writes from Intake, SLA, Followup, Digest, Command Center |
| Bot_Sessions | Authoritative Telegram session state | LIVE Concierge reads it and has exactly three appendOrUpdate-by-chat_id writers; no active Data Table consumer |
| Data Table | Derived read-model/cache only | LIVE production nodes = 0; QA read/write/CAS/race workflows all inactive |

## 7.2 Lead Intake checklist

Live Lead Intake: `QmIyEW2ZEqKregmN`, active, 57 nodes / 64 edges.

- PASS: payload validation, 64 KiB/depth/key/shape guards, honeypot, explicit 400/503/200 responses.
- PASS WITH ISSUE: Pipeline append/update является hard checkpoint перед 200; Sheets retry 3×/2s. Read-back после write отсутствует.
- ISSUE: client `lead_id` не заменяется server-owned ID и используется как strongest dedup key; contact matches также приводят к merge. Browser diagnostic/risk input может escalate canonical priority/zone/status/SLA/next action.
- ISSUE: dedup read/append неатомарен; stable idempotency ledger/unique constraint отсутствует.
- ISSUE: 200 отдаётся до Leads/Lead_Answers/Activities/Dashboard/alerts/AI; secondary failure не меняет client result.
- PASS: AI ветка находится после Pipeline checkpoint, OpenAI имеет retry/error output и не блокирует canonical write.
- PRIVACY ISSUE: HOT leads идут в AI по умолчанию; prompt включает lead ID, company, name, role, email, phone, Telegram, diagnostics и полный `raw_json`. Privacy RU/RO не раскрывает OpenAI.
- ISSUE: никакого global Error Monitor/errorWorkflow; workflow-level execution save override отсутствует. Five recent Lead Intake execution records видны по metadata; data намеренно не извлекались. `pinData` пуст.
- FAIL: `analytics_consent`, `ga_client_id`, `ga_session_id` отсутствуют в structured model/merge; только raw archive. UTM поддержан лишь частично, как описано выше.

## 7.3 Lifecycle attribution

В tracked repo и полном live inventory не найден server-side GA4 Measurement Protocol lifecycle. Scan всех node parameters/code по `google-analytics.com`, `/mp/collect`, `measurement_id`, `api_secret`, GA identifiers и lifecycle event names не нашёл sender-а. Единственный `lead_created` match — внутреннее имя Activities action, не GA call.

- Qualified → `qualify_lead`: ABSENT.
- Won/Lost → server-side lifecycle event: ABSENT.
- GA identifiers surviving CRM merge/dedup: FAIL.

Итог: **SERVER-SIDE GA LIFECYCLE: ABSENT**; P2 GAP подтверждён, ничего не создавалось.

# 8. Telegram / Mini App Contract

## 8.1 Positive evidence

- Telegram initData validator соответствует официальной HMAC validation sequence; 14/14 unit tests passed.
- /app/ имеет zero duplicate element IDs, требуемые templates, consent/urgency/accessibility states, 390-class CSS и reduced-motion rules.
- /app/app.js использует initDataUnsafe только для presentation/prefill/inTelegram display. Direct network submit, Telegram Bot API, n8n, XHR/fetch/beacon/WebSocket отсутствуют.
- Gateway bootstrap canary harness при запуске из gateway/n8n отработал guard/redaction/freshness examples; основной validator suite прошёл 14/14 assertions.
- Target design сохраняет Bot_Sessions authority и Data Table derived-only.
- Документированный Client Concierge mppzthlkSJFr6Kle имеет три Bot_Sessions writer-а appendOrUpdate by chat_id: Save Bot Session, Save Intake State, Save Confirmation State. Первые два меняют mirrored projection; третий меняет только updated_at/notes.

## 8.2 Blocking gaps

- Production Mini App backend integration отсутствует: B2.0 UI — mock.
- Separate live Mini App bootstrap/resume endpoints не deployed: AWQ0… bootstrap и NMC4… resume definitions inactive. Поэтому production Mini App server validation/identity routing отсутствует, а не «не проверено».
- Active Concierge подтверждает Bot_Sessions read и три documented writers, но это Telegram bot flow, не zero-write Mini App open. Zero-write resume/no cycle reset contract не реализован active public workflow.
- Concierge Get Bot Session может mint cycle при пустом cycle_id; это допустимо для Concierge bootstrap, но этот path нельзя переиспользовать для Mini App read-only open.
- Старый PHASE_B2_1_GATEWAY_CONTRACT допускает создание нового cycle при отсутствии session и B2.1-B draft/session writes. PR #10 требует строго read-only resume. Canonical contract не унифицирован.
- B2.1-A docs одновременно содержат merge/closure claims и pending identity/privacy/side-effect closure wording.
- bootstrap-canary.test.js является log harness без assertions/process exit contract и зависит от current working directory. Он может завершиться exit 0 при неверной строке evidence; поэтому CI не является надёжным regression gate.
- Data Table proof/CAS/race/sync graphs существуют, но все inactive QA; production behavior остаётся не deployed.
- Strict response whitelist реализован только в inactive proof/bootstrap graphs, не active Mini App flow.
- Все live `pinData` пусты; AWQ0… save success/error/manual settings explicitly disabled. Raw initData execution payload contents намеренно не извлекались, но dangerous NlIH… harness подтверждён inactive.

Правило release: raw initData используется только как request credential на server validator boundary, никогда как stored CRM/session field. Любая cache uncertainty должна давать MISS и authoritative Bot_Sessions fallback, никогда stale HIT.

# 9. Cross-System Field Matrix

Legend:

- Live assertions ниже относятся к полученным 2026-08-25 workflow graphs; `RAW ARCHIVE ONLY` не означает operational attribution support.
- STALE RISK не даёт authority.
- GA4 AUTHORITATIVE означает только analytics identity/event context, не CRM truth.
- Telegram identity является authoritative только после server-side validation подписанного initData.

| FIELD | WEBSITE | LEAD INTAKE | PIPELINE | LEADS | BOT_SESSION | DATA_TABLE | GA4 | TELEGRAM | NOTES |
|---|---|---|---|---|---|---|---|---|---|
| lead_id | OPTIONAL / CLIENT-CONTROLLED | TRUSTED OR GENERATED | CANONICAL KEY | ARCHIVED | OPTIONAL | DERIVED / INACTIVE | MISSING | MISSING | Client ID используется как strong dedup key; это P0 trust-boundary issue |
| chat_id | FORBIDDEN | NOT STRUCTURED | MISSING | RAW ARCHIVE ONLY IF SENT | AUTHORITATIVE | DERIVED / INACTIVE | FORBIDDEN | AUTHORITATIVE | Только validated Telegram flow может быть authority |
| telegram_user_id | FORBIDDEN | NOT STRUCTURED | MISSING | RAW ARCHIVE ONLY IF SENT | AUTHORITATIVE | MISSING | FORBIDDEN | AUTHORITATIVE | initDataUnsafe не authority |
| cycle_id | FORBIDDEN | NOT STRUCTURED | MISSING | RAW ARCHIVE ONLY IF SENT | AUTHORITATIVE | DERIVED / INACTIVE | FORBIDDEN | DERIVED | Active Mini App open отсутствует |
| consent | AUTHORITATIVE PRODUCER | NORMALIZED FROM MULTIPLE CLIENT FIELDS | MISSING | STRUCTURED PRIVACY CONSENT | AUTHORITATIVE | DERIVED / INACTIVE | OPTIONAL | OPTIONAL | Не путать с analytics_consent |
| consent_cycle_id | FORBIDDEN | NOT STRUCTURED | MISSING | RAW ARCHIVE ONLY IF SENT | AUTHORITATIVE | DERIVED / INACTIVE | FORBIDDEN | MISSING | Server-owned cycle-scoped consent |
| lead_cycle_id | FORBIDDEN | NOT STRUCTURED | MISSING | RAW ARCHIVE ONLY IF SENT | AUTHORITATIVE | DERIVED / INACTIVE | FORBIDDEN | MISSING | Нельзя брать из browser-controlled state |
| priority | DERIVED | RECALCULATED, BUT CLIENT SIGNALS TRUSTED | CANONICAL | ARCHIVED | OPTIONAL | MISSING | OPTIONAL | DERIVED | HOT/WARM/COLD/INCOMPLETE |
| financial_zone | DERIVED | RECALCULATED FROM CLIENT DIAGNOSTIC | CANONICAL | ARCHIVED | OPTIONAL | MISSING | OPTIONAL | DERIVED | Live поддерживает ORANGE вопреки documented target |
| source | OPTIONAL | NORMALIZED | `source_page`/UTM | ARCHIVED | OPTIONAL | MISSING | OPTIONAL | DERIVED | Server allowlist не видна |
| utm_source | OPTIONAL / STALE RISK | NORMALIZED | NEW/FIRST TOUCH; MERGE DOES NOT UPDATE | STRUCTURED + RAW | MISSING | MISSING | AUTHORITATIVE | MISSING | Retry touch not archived |
| utm_medium | OPTIONAL / STALE RISK | NORMALIZED | NEW/FIRST TOUCH | STRUCTURED + RAW | MISSING | MISSING | AUTHORITATIVE | MISSING | Incoming merge value non-canonical |
| utm_campaign | OPTIONAL / STALE RISK | NORMALIZED | NEW/FIRST TOUCH | STRUCTURED + RAW | MISSING | MISSING | AUTHORITATIVE | MISSING | Incoming merge value non-canonical |
| ga_client_id | OPTIONAL | DROPPED FROM STRUCTURED MODEL | MISSING | RAW ARCHIVE ONLY | FORBIDDEN | FORBIDDEN | AUTHORITATIVE | FORBIDDEN | FAIL |
| ga_session_id | OPTIONAL | DROPPED FROM STRUCTURED MODEL | MISSING | RAW ARCHIVE ONLY | FORBIDDEN | FORBIDDEN | AUTHORITATIVE | FORBIDDEN | FAIL |
| analytics_consent | AUTHORITATIVE PRODUCER | NOT NORMALIZED | MISSING | RAW ARCHIVE ONLY | FORBIDDEN | FORBIDDEN | AUTHORITATIVE | FORBIDDEN | FAIL |
| status | DERIVED | RECALCULATED/MERGED | CANONICAL | ARCHIVED | AUTHORITATIVE | DERIVED / INACTIVE | MISSING | DERIVED | Lead/session namespaces separate |
| created_at | OPTIONAL | ACCEPTED OR GENERATED | CANONICAL | ARCHIVED | AUTHORITATIVE | DERIVED / INACTIVE | AUTHORITATIVE | MISSING | Incoming timestamp may be trusted |
| updated_at | FORBIDDEN | GENERATED ON MERGE | CANONICAL | OPTIONAL | AUTHORITATIVE | DERIVED / INACTIVE | AUTHORITATIVE | MISSING | Data Table inactive |

Матрица теперь показывает подтверждённые проблемы: client-controlled lead/state достигает canonical merge, vocabulary расходится, а GA IDs/analytics consent не входят в structured CRM attribution.

# 10. Privacy / Security

## 10.1 Confirmed

- P0 exposure path: GA4 page_view получает полный location.href и pathname + location.search без PII scrub. Произвольный URL query с email/phone/name/company/free text будет отправлен после consent.
- Tracked text scan не обнаружил реальных bot tokens, api_secret, private keys или иных production credentials.
- Единственный token-shaped match — явно fake TEST_ONLY fixture в gateway/telegram-initdata.test.mjs; in-memory scan трёх tracked ZIP также не выявил token-shaped secret.
- Lead Intake webhook public/unauthenticated; body guards присутствуют, но visible rate/origin controls отсутствуют. Он может вызвать CRM writes, alerts и для HOT lead OpenAI cost/PII transfer.
- P0: active Command Center generic webhook не имеет authentication/credential/options и не проверяет Telegram secret header/signature. Parser доверяет caller-supplied `message/callback chat.id` или `from.id`; подделка allowed ID открывает `won/lost/stage/note` и другие canonical CRM writes. Hardcoded fallback ID в отчёте не раскрывается.
- Privacy RU/RO тексты описывают n8n/Sheets как future/conditional processing, тогда как mini-scan уже отправляет данные на production webhook. Формулировки не совпадают с фактическим flow и требуют legal/owner review.
- GA identifiers не найдены в Telegram Mini App client flow.
- Active Lead Intake OpenAI prompt условно передаёт contact PII и полный raw payload; OpenAI отсутствует в RU/RO disclosure.
- Repo canary не сохраняет raw initData в URL/storage/cookie/DOM/console; все live pinData пусты, а bootstrap save settings выключены.

## 10.2 Live retention / credentials

- Credential references получены как type/id/name без secret values; credentials endpoints/values не запрашивались.
- `pinData` пуст у всех 33. NlIHfmuBQ4mS70G6 inactive/non-archived. Active test/canary = 0.
- Lead Intake не отключает execution saving на workflow level; пять recent records видны по metadata. `includeData=false` исключил payload из ответа, поэтому фактический content/PII retention не инспектировался.
- Genuine raw Telegram initData в execution payloads не извлекался. Separate bootstrap/resume workflows inactive; AWQ0… explicitly disables success/error/manual save.

## 10.3 Edge headers

Live root response вернул GitHub Pages/Fastly headers и Cache-Control: max-age=600, но не содержал Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, Referrer-Policy, X-Content-Type-Options или Permissions-Policy. Tracked _headers задаёт только Content-Type и не является доказанно применяемым GitHub Pages security policy.

## 10.4 Immediate P0 escalation conditions

Следующие условия не подтверждены в этом аудите и не входят в P0 count. Если independent verifier найдёт любое из них, оно немедленно становится дополнительным P0:

1. NlIHfmuBQ4mS70G6 либо другой identity-injecting harness active/published — **не сработало: inactive**.
2. Raw genuine initData сохраняется в Data Table, CRM, execution history/pinData сверх строго необходимого retention — **pinData/Data Table не подтверждают; execution payload не читался**.
3. Browser-controlled identity/cycle/lead fields принимаются без server validation — **СРАБОТАЛО для Lead Intake `lead_id`/merge state; добавлен P0-03**.
4. Data Table используется как authority или stale HIT возвращается при uncertainty — **не сработало: active Data Table nodes = 0**.

Отдельно обнаружен новый P0-02: spoofable unauthenticated Command Center management identity/write path.

# 11. Performance

## 11.1 Website

| Asset/page | Approximate size |
|---|---:|
| questionnaire.html | 151.5 KiB local / 153,460 B live |
| ro/questionnaire.html | 140.4 KiB local / 142,037 B live |
| style.css | 132.1 KiB |
| index.html | 101.6 KiB local / 102,947 B live |
| ro/index.html | 87.5 KiB local / 88,471 B live |
| main.js | 54.6 KiB |
| /app/ | 13,595 B live |

HTTP cache max-age составляет 600 секунд. Browser timing, Core Web Vitals, image decode и 390/430 rendering не измерены из-за отсутствия browser runtime.

## 11.2 Telegram resume evidence

Документированные PR #10 measurements:

- Bot_Sessions exact Google Sheets read median: 6,659 ms; browser-observed около 8,320 ms.
- QA Data Table lookup: P50 16 ms, P95 21 ms.
- QA server total: P50 38 ms.
- Browser total: P50 1,893 ms, P95 1,971 ms.

Data Table benchmark доказывает потенциальное ускорение, но не correctness/authority. QA table была manually seeded и может stale. Bot_Sessions raw technical columns AD:AO составляют значительную часть payload; документированная оценка — около 40% bytes. Performance work не должно менять authority boundary.

# 12. PR #10 Status

PR #10 feat/phase-b2.1b-cycle-resume:

- State: OPEN, DRAFT, unmerged.
- Head: 80e1019642a36c08b5b7d52b9de10bfbeeddf4e6.
- Base ref: main; merge-base с текущей историей: 31cae19.
- Current main: 6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010.
- GitHub API: mergeable=true/clean, 24 commits, 0 requested reviewers, 0 comments/review comments.
- Diff: 6 documentation files, +759/-0; workflow/code export и executable CAS/read-back tests отсутствуют.
- Check runs: 0.
- Commit statuses: 0 / combined pending.
- Reviews/comments: 0.
- PR body прямо указывает не merge.

Известный correctness defect:

- race publisher не включил session_id в full projection;
- сохранённая Data Table row удержала stale S-CAS;
- один verifier хэшировал intended payload, а не actual stored row read back;
- ordering/concurrency evidence есть, full stored-row equality — нет.

Минимум до READY:

1. Включить session_id в publish projection.
2. Прочитать actual stored row с детерминированным limit 2/duplicate detection.
3. Сравнить каждое whitelisted field с expected projection.
4. Хэшировать stored projection, не intended input.
5. Доказать duplicate, MISS, outage, timeout, malformed row и strong invalidation.
6. Для любой uncertainty вернуть MISS и прочитать Bot_Sessions.
7. Доказать zero writes, no cycle create/reset и no draft persistence на Mini App open.
8. Проверить strict response whitelist и отсутствие Data Table internals.
9. Сверить deployed n8n nodes/connections/settings, retention и pinData.
10. Добавить independent review и executable checks.

Вердикт: **PR #10 BLOCKED**. Merge запрещён.

# 13. Duplicate Logic / Drift

| Domain | Canonical implementation | Duplicate/conflict | Risk |
|---|---|---|---|
| Consent | Live normalizer derives privacy consent | `analytics_consent` ignored as separate field; several client privacy-consent shapes | Analytics/privacy conflation and raw-only storage |
| Priority | Live HOT/WARM/COLD/INCOMPLETE | Browser diagnostics/signals feed calculation; website suggested vocab differs | Canonical state manipulation/noise |
| financial_zone | Live RED/YELLOW/ORANGE/GREEN/UNKNOWN | Documented server target omitted ORANGE; client diagnostic label trusted | Wrong routing/aggregation |
| Lead dedup | Live tiered match | User-controlled lead_id + contact/weak matching; read-then-write without atomic ledger | Concurrent duplicates or unauthorized merge/escalation |
| Cycle reset | Bot_Sessions server state | Old gateway contract allows create/write; PR #10 requires read-only | Wrong cycle/draft state |
| Lead state | Pipeline GID 1883973304 current state | Command Center reads canonical GID but updates GID 1997367085 | Misdirected/second Pipeline write path |
| GA conversion | FMAnalytics business events | Legacy custom click/submit events; tool-only session dedup | Missing/double/inconsistent conversions |
| Thank-you confirmation | Live 200 = ok:true + lead_id after Pipeline checkpoint | Client treats any 2xx as full success; secondary writes happen later | Partial archive/answers/activity/alert loss hidden |
| Resume state | Bot_Sessions authority | Data Table candidates all inactive | No active second authority; Mini App resume absent |
| Attribution | Landing UTM + consented GA IDs expected | GA IDs/analytics consent raw-only; merge/retry touch incomplete | Confirmed attribution loss |
| Telegram management identity | Telegram-authenticated owner expected | Generic webhook trusts spoofable body chat/from IDs | P0 CRM state corruption |
| Failure routing | Central Error Monitor expected | 0 Error Trigger, 0 errorWorkflow; schedules have no retry/onError | Silent SLA/followup/digest failure |

Duplicate checks: exact workflow/path duplicates for Lead Intake = 0; duplicate webhook method+path groups = 0. Telegram Trigger definitions = 8, active = 1; shared credential refs exist only across one active + archived copies, so no multiple-active collision. Undocumented/unversioned active roles: SLA, Followup, Digest, Command Center; Command Center считается `UNEXPECTED ACTIVE` из-за необъявленного unsafe public management exposure.

# 14. P0 / P1 / P2 / P3 Findings

## P0 — 3

### P0-01 — Unsanitized URL/query can send PII to GA4

analytics.js page_view uses full location.href and location.search outside the business-event allowlist. An accepted-consent visit with PII in query deterministically sends it to GA4. No evidence was available to quantify historical occurrences.

### P0-02 — Unauthenticated Command Center trusts spoofable Telegram identity

Active Ukn1cprWiXzBHojl exposes POST `finmentor-lead-command-center` via generic Webhook with empty authentication/options and no credential. Its parser takes caller-supplied Telegram-shaped `message`/`callback_query` chat/from IDs and compares them with an allowlist; no Telegram secret header, HMAC or API verification exists. A forged allowed ID can reach `won`, `lost`, `stage`, `note`, SLA and other CRM mutations plus Status_Log/Activities. The fallback owner ID is hardcoded but intentionally not reproduced here. Its Pipeline update also targets a different GID from its reads.

### P0-03 — Browser-controlled Lead Intake identity/state reaches canonical merge

Active QmIyEW2ZEqKregmN accepts incoming `lead_id` after shape validation and uses it as the strongest dedup key; email/phone/Telegram can also select an existing open row. Browser-provided diagnostic/risk signals determine priority/financial zone, and escalation can modify canonical priority, zone, status, next action and SLA. This triggers the audit's predeclared P0 gate for untrusted lead/state reaching canonical writes; no exploit POST was sent.

## P1 — 6

### P1-01 — Client success precedes required secondary writes

Live 200 bodies are well formed and follow Pipeline append/update, but they are emitted before Leads archive, Lead_Answers, Activities, Dashboard_Feed, alerts and AI work. Those branches can exhaust retries/fail after the client already shows thank-you and possibly measures a conversion.

### P1-02 — Dedup exists but is not atomic idempotency

Tiered lead_id/contact/company matching and a two-minute retry branch are present, but read-Pipeline then append/update has no lock/unique ledger. Concurrent submissions can both observe no row, while caller-controlled lead_id/contact can select an existing record.

### P1-03 — Cycle/draft semantics conflict and active Mini App resume is absent

The older gateway contract permits cycle creation/draft writes where PR #10 requires read-only resume. Bootstrap and resume proof workflows are inactive; no active production Mini App backend resolves the conflict.

### P1-04 — Privacy disclosure omits actual n8n/OpenAI processing

RU/RO privacy text treats n8n/Sheets processing as future/conditional while mini-scan already writes live. For HOT leads, the active OpenAI branch sends identifiers, contact PII, diagnostics and full raw payload; OpenAI is not disclosed. Owner/legal/data-minimization review is required.

### P1-05 — Material GA conversion undercount / over-dedup

A successful mini_scan redirects to thank-you but is excluded from generate_lead. For contact/X-Ray, the dedup key contains only tool, so a second legitimate same-tool lead in one tab session is suppressed. This is materially wrong conversion accounting.

### P1-06 — Production failure monitoring is absent

Across all 33 workflows there are no Error Trigger nodes or configured `errorWorkflow`. SLA, Followup and Digest have zero retry/error-route nodes; Command Center writes also lack retry. Missed scheduled executions or post-response Intake failures have no central production alert/monitor path.

## P2 — 12

### P2-01 — GA attribution through Lead Intake fails the six-field contract

UTM is normalized/stored for new leads but incoming merge/retry touches are not canonical. `analytics_consent`, `ga_client_id`, `ga_session_id` are absent from structured CRM and survive, when sent, only inside Leads.Raw JSON. Result: FAIL.

### P2-02 — UTM continuity and mini-scan analytics enrichment are incomplete

X-Ray may lose landing UTM across navigation/language changes; mini-scan does not use FMAnalytics enrichment.

### P2-03 — Server-side GA4 lifecycle is absent live

All 33 live graphs were scanned; no Measurement Protocol endpoint/config/identifier mapping or lifecycle sender exists. Internal Activities action text is not a GA call.

### P2-04 — GA event dispatch/taxonomy has gaps

lead_form_start may be consumed before consent, and shared business events coexist with legacy bespoke click/submit families, creating incomplete or inconsistent event taxonomy.

### P2-05 — PR #10 full stored-row equality is not proven

session_id was omitted and the verifier hashed intended rather than actual stored projection.

### P2-06 — PR #10 cache failure and response safety remain narrative-only

Duplicate/MISS/outage/error invalidation, CAS conditions and whitelist have no deployable export/executable fixture in the PR.

### P2-07 — Authoritative Sheets resume is slow and carries legacy payload

Documented median is 6.659 seconds; raw technical columns inflate reads. Data Table can optimize only as derived cache.

### P2-08 — RO mini-scan contains Russian user-facing strings

Results, errors and share text break language parity.

### P2-09 — x-default differs between HTML and sitemap

60 internal language URLs send conflicting x-default signals.

### P2-10 — Security response headers are absent from the captured live root response

CSP, HSTS, X-Frame-Options, Referrer-Policy, XCTO and Permissions-Policy were not returned.

### P2-11 — Live browser release assurance is incomplete

Consent network/DebugView, console, accessibility interactions and 390/430 visual behavior were not executable in the audit environment.

### P2-12 — Bootstrap canary CI is log-only

bootstrap-canary.test.js contains no assertions/fail contract and is cwd-sensitive. It can finish exit 0 while only printing a wrong evidence row, so the CI job is not a reliable security regression gate.

## P3 — 6

### P3-01 — Indexable legacy HTML remains deployable

22 files outside sitemap retain alternate flows/canonical/path behavior.

### P3-02 — Historical GA drift can be resurrected

Two tracked ZIPs and four historical reports retain G-94L98WZ12; ZIPs also retain pre-consent analytics/webhook-era copies.

### P3-03 — Temporary n8n QA assets need controlled cleanup

18 inactive QA/benchmark workflows, 9 inactive temporary webhook definitions, 7 archived Concierge revisions, QA Data Table/CAS/race helpers and synthetic executions require controlled evidence retention/cleanup. None was changed.

### P3-04 — B2.1/PR #10 documentation and QA status drift

Closure/pending statements conflict; PR has no checks/reviews. Git has zero n8n exports for 7 active workflows, and normalized live AWQ0… bootstrap code differs materially from the tracked canary source.

### P3-05 — Bootstrap canary test harness is cwd-sensitive

Combined root run fails because bootstrap-canary.test.js resolves a sibling script from current working directory; the intended gateway/n8n run passes.

### P3-06 — Retained website regression automation and custom 404 are absent

No durable browser/GA consent regression suite or tracked 404.html protects the audited surface.

# 15. Dead / Legacy Cleanup Candidates

Не удалять в рамках этого аудита. После evidence snapshot и owner approval:

1. 22 legacy/indexable HTML aliases вне sitemap.
2. finmentor_premium_final_candidate_APPROVED.zip и finmentor_premium_restored_owner_review.zip с obsolete GA/pre-consent copies; отдельно подтвердить retention need для finmentor_production_v1.zip.
3. Historical reports с неверным GA ID — либо пометить immutable historical context, либо добавить явное superseded warning.
4. 18 confirmed inactive QA/benchmark workflows, включая kKV…, aGT…, AWQ…, NlIH…, iZPv…, D8…, AYa…, OwLC…; сначала сохранить redacted manifest/dependency evidence.
5. 7 confirmed archived Concierge revisions; проверить retention/legal need, затем owner-approved cleanup.
6. 9 inactive temporary webhook definitions и QA Data Table/CAS/race assets; они не active/public сейчас.
7. Unrelated inactive Rakurs template — определить owner/retention отдельно, поскольку он содержит Anthropic/VK HTTP call definitions.
8. Synthetic executions 3278/3279 и другие QA records — только по отдельной retention policy; в этом аудите не удалялись.
9. Bot_Sessions legacy/raw columns только после schema/consumer inventory; authority и audit trail должны сохраниться.

# 16. Proposed Execution Order

Это integration plan для отдельной, явно разрешённой fix phase; в ходе аудита ни один шаг не выполнялся.

1. Отдельным authorized fix scope немедленно закрыть P0 Command Center authentication и P0 Lead Intake trust boundary; до этого не вызывать endpoints для теста.
2. Исправить GA URL-query PII path и выполнить consent/DebugView verification в non-production property.
3. Сделать Pipeline write target единым; добавить server-owned lead identity, atomic idempotency и read-back/durable response boundary.
4. Добавить Error Monitor/global failure routing и retry policy для SLA/Followup/Digest/Command Center; secondary Intake failures должны быть observable.
5. Зафиксировать canonical consent/priority/zone/source vocabulary и documented OpenAI data-minimization/legal basis.
6. Спроектировать structured six-field attribution storage/merge и отдельно одобрить backend GA lifecycle events без PII.
7. Исправить website analytics/privacy/localization/x-default issues с regression tests.
8. Унифицировать B.2.1 contracts; затем исправить PR #10 session_id/stored-row verifier и доказать all failure/fallback/zero-write cases.
9. Version-control redacted n8n definitions/hashes; провести controlled legacy/QA cleanup только после evidence snapshot.
10. Выполнить независимый end-to-end re-audit на 390/430/desktop, GA DebugView и isolated n8n/CRM test data; только затем новый GO/NO-GO.

# 17. GO / NO-GO

## Final status

- MAIN SHA: 6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010
- GA4 STREAM: G-94L9B8WZ12
- LIVE N8N INVENTORY: PASS — authenticated GET, 33 total / 7 active / 26 inactive including 7 archived
- GITHUB↔N8N DRIFT: ISSUES — live measurable, but no versioned exports; attribution and bootstrap code drift confirmed
- PUBLIC SITE: ISSUES
- GA4: ISSUES
- WEBSITE→N8N: ISSUES
- LEAD INTAKE: CRITICAL ISSUES
- CRM: CRITICAL ISSUES
- TELEGRAM: CRITICAL ISSUES
- MINI APP: BLOCKED
- PR #10: BLOCKED
- DATA TABLE: DERIVED ONLY
- PRIVACY: ISSUES
- P0: P0-01, P0-02, P0-03
- P1: P1-01, P1-02, P1-03, P1-04, P1-05, P1-06
- P2: P2-01, P2-02, P2-03, P2-04, P2-05, P2-06, P2-07, P2-08, P2-09, P2-10, P2-11, P2-12
- P3: P3-01, P3-02, P3-03, P3-04, P3-05, P3-06
- PRODUCTION CHANGES MADE: NONE
- RECOMMENDED INTEGRATION PLAN: contain P0 auth/trust paths → canonical Pipeline/idempotency/error routing → attribution/lifecycle/privacy design → website fixes → PR #10 correctness proof → versioned n8n baseline → cleanup → independent end-to-end re-audit
- SAFE TO START FIX PHASE: NO

NO означает: live evidence уже достаточно для release block. Нужны owner-approved fixes и затем independent verifier; текущий audit ничего не менял, main не менять, PR #10 не merge.

## Mandatory independent verification checklist

1. COMPLETED READ-ONLY: paginated 33-workflow inventory, all 8 requested IDs, active/inactive/archived, nodes/connections/settings/tags/pinData/credential refs/write/error paths.
2. COMPLETED READ-ONLY: Lead Intake responses, validation, dedup/merge, write order, attribution and OpenAI branch traced.
3. COMPLETED READ-ONLY: duplicate webhooks/Lead Intake, shared Telegram Trigger refs, active QA, temporary endpoints, Data Table authority and Error Monitor checked.
4. COMPLETED READ-ONLY: server-side GA lifecycle confirmed absent; Git↔n8n status changed to ISSUES.
5. REMAINING AFTER FIXES: verify Command Center authentication and canonical Pipeline target with isolated non-production test data.
6. REMAINING AFTER FIXES: prove server-owned Lead ID, atomic idempotency, six-field attribution and no secondary-write false success.
7. REMAINING: browser 390/430/desktop, consent Network/DebugView, PII-query canary in non-production GA property, mini_scan coverage and same-tool dedup.
8. REMAINING: Telegram Mini App server identity, zero-write resume, no cycle reset/create, response whitelist and raw initData retention.
9. REMAINING: PR #10 full stored-row/CAS/fallback proof including session_id and actual read-back.
10. Любая следующая verification/fix phase требует отдельного разрешения; этот audit не выполнял POST или production mutation.

После этого требуется новый письменный GO/NO-GO. До него Mini App integration, PR #10 и fix phase заблокированы.

## Required live n8n closeout

LIVE N8N ACCESS:
PASS

TOTAL WORKFLOWS:
33

ACTIVE PRODUCTION:
4 event-driven; 7 active total including scheduled

ACTIVE SCHEDULED:
3

INACTIVE QA/BENCHMARK:
18

UNEXPECTED ACTIVE:
1 — Lead Command Center unsafe/undocumented public management exposure; active test/canary = 0

TEMP PUBLIC ENDPOINTS:
0 active; 9 inactive temporary webhook definitions

DUPLICATE WEBHOOKS:
0

GITHUB ↔ N8N DRIFT:
ISSUES

GA ATTRIBUTION THROUGH N8N:
FAIL

SERVER-SIDE GA LIFECYCLE:
ABSENT

UPDATED P0:
3

UPDATED P1:
6

UPDATED P2:
12

UPDATED P3:
6

FINAL GO / NO-GO:
NO-GO

PRODUCTION CHANGES:
NONE
