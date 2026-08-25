# FINMENTOR — Independent Review

Дата проверки: 2026-08-25  
Роль: второй независимый reviewer  
Ветка: audit/finmentor-independent-review  
Audit HEAD до создания этого отчёта: bd4ca11e0f17129e8f86c7ac85856b0025d1aa4a  
Проверяемый production main: 6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010  
Base evidence commit: b4f01fc266777f1f5127d86f15259c5da4203889  
Режим: READ-ONLY; production POST, workflow execution, активация, credential read, CRM mutation, merge, commit и push не выполнялись

## 1. Executive verdict

Итог: **NO-GO для нового integration release и PR #10; текущий публичный сайт не откатывать**.

Первый аудит имеет сильную фактическую основу, но итоговая оценка качества — **MIXED**: inventory, graph mechanics, GA/OpenAI/attribution и PR-блокеры в основном воспроизведены, однако два из трёх P0 были завышены, browser limitation была посчитана как product finding, не была проверена retained execution health активных schedule-workflow, а реальный impact Command Center шире описанного — он включает не только mutation attempt, но и canonical Pipeline read/PII exfiltration.

Независимая severity:

- P0: 1
- P1: 5
- P2: 16
- P3: 6

Ключевой P0 — active Lead Command Center. Generic public webhook принимает caller-controlled Telegram-shaped from/chat IDs, не проверяет Telegram secret/signature и допускает смешение identity и reply destination. При знании allowed Telegram ID запрос к canonical Pipeline можно направить в другой, контролируемый атакующим Telegram chat.

GA4 query-механизм и Lead Intake existing-row merge подтверждены, но оба понижены с P0 до P1 из-за обязательных предпосылок и ограниченного доказанного impact. Ни исторические GA4 PII hits, ни фактическая эксплуатация webhook, ни corruption canonical Pipeline через Command Center не доказаны.

Текущий сайт следует оставить работающим: rollback к более старой версии не устраняет Command Center и может вернуть прежние GA4/consent defects. Нужна отдельная owner-approved controlled fix phase, начиная с containment Command Center.

## 2. Evidence reproduced

### 2.1 Evidence basis

Проверены независимо:

- docs/FINMENTOR_INDEPENDENT_REVIEW_TASK.md полностью;
- первый аудит как набор утверждений для challenge, а не как источник истины;
- tracked tree и origin/main; текущая audit-ветка до отчёта отличалась от origin/main только тремя audit/task Markdown-файлами;
- live n8n public API только GET, включая cursor pagination, 33 workflow graphs, selected execution structure/status/error evidence и PR QA workflow topology;
- значения N8N_API_KEY и credential secrets не выводились и не сохранялись;
- execution evidence сводилось к status/timing/node/error/boolean configuration; contact payloads, CRM rows, raw initData и secret values в отчёт не переносились;
- публичные HTTP HEAD/GET для FINMENTOR; формы и webhook не отправлялись;
- GitHub REST, git refs и PR #10 diff/metadata; merge/comment/review не выполнялись;
- локальные syntax/tests: analytics.js, main.js и app/app.js проходят node --check; Telegram validator — 14/14; bootstrap canary проходит только из gateway/n8n и не содержит assertions;
- tracked-secret scan на HEAD, origin/main и PR head без печати match values;
- Browser skill bootstrap по обязательной процедуре.

### 2.2 Reproduced facts

| Evidence | Independent result |
|---|---|
| Main | 6b8fefc; current runtime code audit-ветки идентичен origin/main |
| Public root / canonical forms | HTTP 200 |
| Unknown public path | HTTP 404 |
| GA4 runtime ID | G-94L9B8WZ12 |
| Obsolete GA4 ID | отсутствует в runtime; остаётся в historical reports и двух ZIP |
| n8n pagination | 10/10/10/3 = 33 unique |
| n8n state | 7 active, 26 inactive, из них 7 archived |
| Active topology | 4 event-driven + 3 scheduled |
| Active test/canary | 0 |
| Webhook definitions | 12 total, 2 active; duplicate method+path groups = 0 |
| Telegram Trigger | 8 definitions, ровно 1 active |
| pinData | non-empty = 0 из 33 |
| Active Data Table nodes | 0 |
| Error Trigger / errorWorkflow | 0 / 0 |
| Server-side GA4 lifecycle sender | absent |
| PR #10 | OPEN, DRAFT, docs-only, unmerged, BLOCKED |
| Production changes | NONE |

Browser selection вернул “No browser is available”; обязательный troubleshooting завершился agent.browsers.list() = []. Поэтому visual 390/430/desktop, console, consent Network и GA4 DebugView не выполнены. Это evidence limitation, а не самостоятельно доказанный product defect.

## 3. Findings from first audit CONFIRMED

| First-audit claim | Independent disposition |
|---|---|
| P0-02 Command Center has spoofable Telegram-shaped identity | CONFIRMED; P0 сохранён и impact расширен до canonical read/PII exfiltration |
| P1-04 OpenAI/privacy mismatch | CONFIRMED как P1 technical data-minimization/disclosure risk; юридический вывод не делается |
| P1-05 GA conversion undercount/over-dedup | CONFIRMED как P1, с caveat: GA property conversion configuration недоступна |
| P2-01 structured six-field GA attribution fails | CONFIRMED |
| P2-02 UTM continuity/mini-scan enrichment incomplete | CONFIRMED |
| P2-03 server-side lifecycle sender absent | CONFIRMED |
| P2-04 event dispatch/taxonomy gaps | CONFIRMED и уточнено: consultation legacy lead_submit вызывается до backend acknowledgement |
| P2-05/P2-06 PR stored-row/fallback proof incomplete | CONFIRMED; live QA evidence слабее некоторых wording в PR |
| P2-07 authoritative Sheets resume is slow | CONFIRMED только как documented/live-QA claim; payload measurements не воспроизводились |
| P2-08 RO mini-scan Russian strings | CONFIRMED |
| P2-09 x-default drift | CONFIRMED: 60 non-home sitemap language URLs конфликтуют |
| P2-10 production security headers absent | CONFIRMED для 200 root response |
| P2-12 bootstrap canary is not an assertion gate | CONFIRMED |
| P3 legacy/ZIP/QA/drift/cwd/regression debt | CONFIRMED с уточнениями ниже |
| 33/7/26/7, no duplicates, one active Telegram Trigger, empty pinData, no active Data Table | CONFIRMED |

## 4. Findings DOWNGRADED

| First finding | Independent severity | Reason |
|---|---|---|
| P0-01 GA4 full query | P1 | Mechanism deterministic after consent, но canonical first-party PII URL producer не найден; нужны PII-bearing external/arbitrary query и accepted/stored consent |
| P0-03 Lead Intake client merge/state | P1 | Selection/mutation real, но требуется known/matched active identity, >2-minute window; merge не downgrades, не deletes, не absorbs Won/Lost и сохраняет non-empty contact |
| P1-01 2xx before secondary writes | P2 | Все live 200 body сейчас ok:true и следуют после canonical Pipeline commit; fragility и возможная потеря secondary detail реальны, false canonical success не доказан |
| P1-02 non-atomic idempotency | P2 | Business dedup substantial; atomic race remains, но production duplicate incident не доказан |
| P1-03 Mini App cycle/draft conflict | P2 | Release blocker для ещё не активированного integration path, не текущая production mutation |
| P1-06 zero global monitoring | P2 | Observability defect confirmed; node-level retry exists в Intake/Concierge/Transport, а отсутствие global monitor само по себе не доказывает lead loss |

## 5. Findings REJECTED / FALSE POSITIVES

Полностью ложного core mechanism среди трёх P0 не найдено; два P0 именно downgraded, не rejected. Следующие более сильные интерпретации отвергнуты:

1. **“Current first-party PII URL flow exists” — REJECTED.** Canonical producers используют query для topic/model/pain/source/intent, UTM, tool и debug_ga4. Email/phone/name/company/free text/lead_id query producer не найден.
2. **“GID split proves data corruption” — REJECTED.** Split доказан, target semantics нет. Zero-row unauthenticated Google metadata checks получили 401 для обоих GID; CRM data не читались.
3. **“Browser unavailable” как самостоятельный P2 product defect — REJECTED.** Это audit limitation. Отсутствие retained regression coverage остаётся P3 process debt.
4. **Tracked Telegram token-shaped match = production secret — REJECTED.** Единственный match в gateway/telegram-initdata.test.mjs:19 — isolated synthetic HMAC fixture; Bot API/network use отсутствует. Secret value не воспроизводится.
5. **Active Data Table authority, active QA endpoints, duplicate active webhooks или multiple active Telegram Trigger — NOT FINDINGS.** Все соответствующие проверки чистые.

## 6. New findings missed by first audit

### NEW-P0 impact — Command Center from/chat identity split exfiltrates CRM reads

Первый аудит описал spoofable mutation, но не выделил confused-deputy read path. Authorization допускает allowed from_id **или** chat_id, тогда как Telegram reply всегда направляется в caller-controlled chat_id. Query commands читают canonical Pipeline GID 1883973304:

- /lead возвращает company, name, phone, Telegram, email, priority/zone, stage, pain, next action, follow-up, SLA и AI-ready;
- /today и /hot возвращают до 15 lead summaries и lead_id;
- /pipeline возвращает aggregation.

Предпосылка — знание allowed owner ID и Telegram chat, доступного bot. Allowed ID является identifier, не криптографическим proof. Upstream WAF/allowlist вне workflow не виден и не предполагается ни существующим, ни отсутствующим.

### NEW-P2 — Daily Digest каждый retained run помечен error

У active imeJIDeNyaWDyXzh доступны семь trigger executions за 2026-08-19…2026-08-25; все семь status=error. В проверенном latest run Telegram Daily Digest успел выполниться, затем Save Activity завершился ошибкой “Sheet with ID Activities not found”. Поэтому:

- Telegram delivery для inspected run состоялась;
- Activities journal запись не состоялась;
- весь schedule execution помечается failed;
- retry/error route/global alert отсутствуют.

Это P2 journal/observability defect, а не доказанный outage самого Telegram digest. SLA retained metadata также содержит отдельные transient trigger errors, что усиливает monitoring gap, но не доказывает систематическую потерю SLA action.

### NEW PR evidence nuance — live race is overlapping, но authority is simulated

Inactive UEnjDvZGjMqsNdAI действительно имеет overlapping execution intervals, но:

- имеет 0 Google Sheets, Execute Workflow и HTTP nodes;
- “Authoritative Commit Duration” — Wait;
- projection получает caller-injected body.authoritative;
- Race Report не читает stored Data Table row;
- Conditional Publish пропускает session_id, urgency, consent_at и lead_intake_ok.

Следовательно доказаны overlap, conditional token CAS и simulated ordering, но не actual Bot_Sessions commit → authoritative re-read → stored-row convergence. Это входит в final P2 PR release-assurance findings.

## 7. P0 deep verification

### A. GA4 query exposure

analytics.js:204-216 устанавливает send_page_view:false и затем отправляет explicit page_view:

- page_location = location.href;
- page_path = location.pathname + location.search.

safeBusinessParams к page_view не применяется. Consent gate воспроизведён статически: Google script и explicit page_view запускаются только после stored/user accept; deny не загружает Google script. Arbitrary external query сохраняется в обоих GA fields после consent.

Canonical first-party query usage:

- analytics.js:88 — tool;
- analytics.js:200 — debug_ga4;
- questionnaire.html:707-715 и RO analog — topic/model/pain/intent/source/utm_*;
- main.js:43-60 и mini-scan — utm_*;
- thank-you redirects — tool.

PII query producer не найден; формы передают PII в JSON POST. Исторические GA hits и external campaign-link discipline недоступны.

**MECHANISM EXISTS: YES**

**CURRENT FIRST-PARTY PII URL FLOW EXISTS: NO**

**INDEPENDENT SEVERITY: P1**

Основание P1, не P0: deterministic privacy disclosure возникает только при PII-bearing URL и analytics consent; normal first-party PII URL flow и historical material impact не доказаны.

### B. Lead Command Center authentication

Workflow Ukn1cprWiXzBHojl:

- active, 21 nodes / 20 edges;
- trigger: n8n Webhook v2.1;
- method/path: POST finmentor-lead-command-center;
- authentication unset, options empty;
- no Telegram secret-token header, signature, HMAC, credential or pre-mutation validation;
- two retained webhook executions confirm registered/live use; no forged request sent.

Identity parsing:

- message.chat.id and message.from.id;
- callback_query.message.chat.id and callback_query.from.id;
- authorization passes when either chatId or fromId appears in non-empty allowlist;
- headers/query do not establish identity;
- unauthorized result is only a Telegram “Нет доступа” reply, not cryptographic verification.

Reachable commands:

- reads: today, overdue, hot, pipeline, lead;
- mutations: done, snooze, stage, meeting, docs, proposal, nurture, won, lost, note;
- mutable fields include deal_stage, SLA state/snooze, follow-up, meeting/doc/proposal timestamps, deal estimate, close reason, owner_note, updated_at and last_activity_at;
- successful update then appends Status_Log for stage changes and Activities for every update.

**UNAUTHENTICATED SPOOF PATH: CONFIRMED**

**CANONICAL CRM MUTATION REACHABLE: YES — configured mutation graph is reachable; actual canonical Pipeline-tab mutation is NOT PROVEN because write GID differs**

**INDEPENDENT SEVERITY: P0**

P0 не зависит от GID write semantics: canonical Pipeline read and PII exfiltration через from_id/chat_id split уже подтверждены статическим active graph. Prerequisite — allowed Telegram ID; его значение намеренно не воспроизводится.

### C. Lead Intake client-controlled merge/state

Workflow QmIyEW2ZEqKregmN:

- active, 57 nodes / 64 edges;
- POST finmentor-lead-intake, no webhook auth, responseMode=responseNode;
- body size/depth/key/honeypot/meaningful-content guards присутствуют;
- lead_id только trim + regex A-Za-z0-9_- длиной 4…80; provenance/auth отсутствуют;
- tool или x-finmentor-source может client-side маркировать source как telegram_client_concierge.

Dedup precedence:

1. case-insensitive lead_id — strong;
2. normalized email;
3. normalized phone;
4. normalized Telegram;
5. company+name только open row младше 48 часов.

Выбирается newest open match. Won/Lost не absorb новый submit. Match младше двух минут получает retry response и не обновляет Pipeline.

После окна retry existing match проходит canonical update GID 1883973304. Неэскалированный merge меняет timestamps/comment и может заполнить только пустые contact/business fields. Эскалация из client-derived diagnostics может:

- повысить priority и financial_zone;
- заменить next_action, status, priority_reason и critical_flags;
- перевести пустой/New/Incomplete/Nurture stage в Qualified/New;
- реактивировать Done/Nurture/Snoozed SLA;
- заменить next_follow_up_at и sla_hours.

Server применяет собственные scoring rules, но исходные risk label/diagnostic score/urgency/critical flags и commercial signals приходят от клиента. Channel restrictions на existing-row selection нет.

**CLIENT-CONTROLLED EXISTING-ROW SELECTION: YES**

**CANONICAL STATE MUTATION AFTER SELECTION: YES — кроме <2-minute retry и Won/Lost protection**

**AUTHORIZATION BOUNDARY MISSING: YES для existing-row merge; public new-lead intake сам по себе не требует user authentication**

**INDEPENDENT SEVERITY: P1**

### D. Pipeline GID split

Независимо подтверждено:

- Command Center Query и Update reads: GID 1883973304, cached name Pipeline;
- все другие active canonical Pipeline operations также используют 1883973304;
- Update Pipeline Row: GID 1997367085, cached name Pipeline;
- GID 1997367085 встречается ровно один раз во всех 33 workflow;
- sheet locator содержит stale cached provenance, расходящуюся с current document locator;
- retained Command Center executions не достигали update node.

Вывод: **split exists; 1997367085 is most consistent with stale/accidental locator, but its actual current tab semantics are impossible to resolve from available read-only evidence**. Нельзя называть его valid second Pipeline, deleted tab или confirmed corruption без Google Sheet metadata/controlled test.

Independent severity: **P1 configuration/state-integrity risk**.

## 8. n8n topology reconciliation

### 8.1 Active inventory

| ID | Workflow | Trigger | Nodes / edges |
|---|---|---|---:|
| QmIyEW2ZEqKregmN | Lead Intake PREMIUM FINAL | POST finmentor-lead-intake | 57 / 64 |
| mppzthlkSJFr6Kle | Telegram Client Concierge AI GUARDED | Telegram Trigger | 33 / 36 |
| ShcmmJeLSE8LYVBk | Telegram Client Transport | Execute Workflow Trigger | 20 / 33 |
| Ukn1cprWiXzBHojl | Lead Command Center PREMIUM FINAL | POST finmentor-lead-command-center | 21 / 20 |
| LZ2mvKXbBikmeVTn | SLA Lead Watch PREMIUM FINAL | hourly | 10 / 9 |
| zeLOCuf0K1bkaKl2 | Followup Sequence PREMIUM v2 | hourly | 15 / 14 |
| imeJIDeNyaWDyXzh | Daily Lead Digest PREMIUM FINAL | daily 08:30 | 9 / 8 |

Workflow timezone overrides у трёх schedules отсутствуют; observed Digest trigger соответствует 05:30 UTC / 08:30 Europe/Chisinau на дату проверки.

### 8.2 Inactive/archive/exposure

- 18 inactive FINMENTOR test/canary/benchmark/proof/race/QA workflows;
- 7 inactive archived Concierge revisions;
- 1 inactive unrelated Rakurs template;
- 9 FINMENTOR temporary/QA webhook definitions, все inactive;
- active test/canary exposure = 0;
- active Mini App bootstrap/resume = 0;
- active Data Table nodes = 0;
- duplicate webhook method+path groups = 0;
- active Telegram Trigger = 1; archived definitions = 7;
- all 33 pinData empty.

### 8.3 Error handling

Global:

- Error Trigger nodes = 0;
- settings.errorWorkflow = 0;
- central production error monitor = absent.

Node-level:

- Lead Intake: 13 retryOnFail, 5 continueErrorOutput;
- Concierge: 4 retryOnFail, 3 continueRegularOutput;
- Transport: 14 retryOnFail, 14 continueRegularOutput;
- SLA, Followup, Digest и Command Center: 0 retry/onError nodes.

Отсутствие global monitoring подтверждено как P2, отдельно от node retry. Daily Digest Activities failure делает этот gap фактическим, а не только теоретическим.

### 8.4 GitHub ↔ n8n

Live inventory доступен и непротиворечив, но reproducibility — ISSUES:

- origin/main не содержит export ни одного из 7 active workflows;
- inactive AWQ0 bootstrap live code отличается от gateway/n8n/bootstrap-canary.js в empty-pair, content-type и auth_date strictness;
- live QA graphs не привязаны к commit/hash manifest;
- Data Table/Race/CAS evidence существует только в inactive mutable live graphs и docs.

## 9. GA4/privacy reconciliation

### 9.1 Runtime stream and URL

- analytics.js:4 и live asset: G-94L9B8WZ12;
- G-94L98WZ12 не найден в current runtime;
- old ID остаётся в четырёх historical reports и 27 entries каждого из двух tracked premium ZIP; finmentor_production_v1.zip old ID не содержит;
- query exposure verdict: mechanism YES, first-party PII URL flow NO, severity P1.

### 9.2 Conversion events

analytics.js:74-104:

- generate_lead разрешает только contact и xray_extended;
- mini_scan после accepted 2xx перенаправляет на thank-you?tool=mini_scan, но generate_lead не испускается;
- dedup key содержит только tool, поэтому второй legitimate same-tool conversion в той же tab session подавляется;
- direct thank-you и cross-origin referrer защищены;
- GA property conversion marking и DebugView недоступны.

Дополнительно legacy lead_submit у consultation вызывается до POST, тогда как canonical generate_lead — после same-origin thank-you. Это event taxonomy/semantics drift.

### 9.3 Six-field attribution

| Field | Producer | Lead Intake structured | New Pipeline | Merge | Retry |
|---|---|---|---|---|---|
| analytics_consent | consultation/X-Ray only | no | no | Raw JSON only | lost |
| ga_client_id | consented consultation/X-Ray | no | no | Raw JSON only | lost |
| ga_session_id | consented consultation/X-Ray | no | no | Raw JSON only | lost |
| utm_source | current URL/session fallback varies | yes | yes | Leads archive; Pipeline unchanged | lost except activity source |
| utm_medium | same | yes | yes | Leads archive; Pipeline unchanged | lost |
| utm_campaign | same | yes | yes | Leads archive; Pipeline unchanged | lost |

Leads archive дополнительно сохраняет UTM content/term и Raw JSON на new/merge. Mini-scan не вызывает FMAnalytics enrichment. Consultation utmMeta запускается лишь при submit; переход с UTM landing на X-Ray/mini-scan до submit не создаёт общую first-touch continuity.

Server-side Measurement Protocol lifecycle sender отсутствует во всех active graphs: qualify_lead, Won/Lost lifecycle и GA identifier merge не реализованы.

### 9.4 OpenAI and privacy

Active AI Gate:

- HOT = enabled unless setting explicitly false;
- WARM = enabled when setting true; live setting true;
- COLD/INCOMPLETE = off;
- recognized contact + privacy consent нужны косвенно через priority, но отдельного AI/processor consent нет.

Prompt отправляет lead_id, company, name, role, email, phone, Telegram, business/financial/risk fields и полный parsed Raw JSON. Поэтому туда могут войти analytics IDs, consent fields, page URL/query, comments и все ответы.

privacy.html:102,126-128 и ro/privacy.html:107,131-133 структурно согласованы между собой, но описывают n8n/Sheets как future/conditional и не называют OpenAI, хотя live mini-scan/Lead Intake processing уже существует. Это P1 technical minimization/disclosure risk; legal basis, DPA и adequacy не оценивались.

### 9.5 Locale/SEO/headers

- RO mini-scan содержит русские runtime result/error/share strings: P2.
- HTML x-default ведёт на root, sitemap — на per-page RU; 60 non-home conflicts: P2.
- root 200 response не содержит CSP, HSTS, X-Frame-Options, Referrer-Policy, X-Content-Type-Options, Permissions-Policy; tracked _headers задаёт только Content-Type: P2 hardening.
- GitHub default 404 имеет собственный CSP, что не закрывает header gap на production 200 pages.

## 10. Website → Lead Intake contract

### 10.1 Client submitters

| Submitter | lead_id | Attribution | Success rule |
|---|---|---|---|
| Consultation, main.js | stable ID absent | landing UTM fallback + GA enrichment | res.ok only; body not parsed |
| RU X-Ray | generated once per page load | current query + GA enrichment | r.ok only |
| RO X-Ray | generated once per page load | current query + GA enrichment | r.ok only |
| RU/RO mini-scan | stable ID absent | current UTM only; no GA enrichment | r.ok only |

Все abort timeout около 12 s; automatic transport retry не найден.

### 10.2 Server response placement

Invalid → 400 ok:false. Settings/Pipeline infrastructure → 503 ok:false. Pipeline append/merge failure → 503 ok:false.

New:

Pipeline append success → 200 ok:true → Leads archive, Lead_Answers, Activities, Dashboard, alerts, AI.

Merge:

Pipeline update success → 200 ok:true → Dashboard mirror, Leads archive, answers, activity, optional escalation alert.

Retry:

200 ok:true → Activity only; нет Pipeline/Leads/answers/AI.

Выводы:

- canonical Pipeline commit success: **YES перед 200** для new/merge;
- response body contract: текущие 2xx все ok:true;
- archive/answers/activity/alert/AI completion: **NO, 200 их не подтверждает**;
- user-visible success: любой 2xx;
- GA canonical generate_lead: thank-you only для contact/X-Ray; mini_scan отсутствует;
- independent severity: P2 contract durability/secondary-loss risk.

### 10.3 Idempotency

- business dedup: YES, tiered;
- transport retry handling: client automatic retry NO; backend <2-minute retry suppression YES;
- true atomic idempotency: NO;
- concurrent read-before-append race: exists statically;
- stable client request key: consultation/mini-scan NO; X-Ray only per page load;
- real production duplicate incident: NOT PROVEN.

Independent severity: P2.

## 11. PR #10 independent verdict

GitHub evidence:

- PR: https://github.com/ghennadiiacovlev-blip/finmentor/pull/10
- OPEN, DRAFT, unmerged;
- head 80e1019642a36c08b5b7d52b9de10bfbeeddf4e6;
- base main; merge-base 31cae1963f2b62a729d3fa4ce1b5c683ab50218a;
- 24 commits;
- 6 added Markdown files, +759/-0;
- workflow/code export: 0;
- checks/statuses/reviews/comments/requested reviewers: 0;
- body прямо требует Do not merge.

Independent correctness:

1. session_id omission и intended-payload hash defect признаны самим PR.
2. Live Conditional Publish также пропускает urgency, consent_at и lead_intake_ok.
3. Race Report не читает stored row.
4. CAS Gate limit-2 read проверяет static version marker; hash exercise остаётся in-memory, не stored projection.
5. Real execution overlap доказан, но “authority” симулирован caller body + Wait, без Bot_Sessions commit/re-read.
6. NMC4 performance proof использует limit=1, не проверяет duplicate/cache_valid/hash/malformed row и не имеет Bot_Sessions fallback.
7. OwLC sync QA основан на прежнем cycle_id|updated_at, частичной equality и непроверенной invalidation.
8. Duplicate/MISS/outage/timeout/malformed-row/strong invalidation/backfill/reconciliation matrix открыта.
9. PHASE_B2_1B_CONSISTENCY_QA_CAS говорит reversed-order PASS, тогда как READMODEL_SYNC_DESIGN всё ещё считает его OPEN.
10. Старый gateway contract допускает cycle creation, PR требует zero-write resume; canonical contract не унифицирован.

PR-specific P0/P1 нет, потому что active production Data Table path = 0. Defects — P2/P3 release assurance.

**PR #10: BLOCKED**

## 12. Final severity table

### P0 — 1

| ID | Finding | First-audit mapping |
|---|---|---|
| INDP0-01 | Active Command Center trusts caller Telegram IDs; from/chat split enables canonical Pipeline PII exfiltration and reaches mutation graph | P0-02 CONFIRMED/expanded |

### P1 — 5

| ID | Finding | First-audit mapping |
|---|---|---|
| INDP1-01 | Explicit GA page_view forwards arbitrary query after consent; no current first-party PII URL flow | P0-01 DOWNGRADED |
| INDP1-02 | Public Lead Intake can select an active row by caller lead_id/contact and perform constrained escalation/state merge | P0-03 DOWNGRADED |
| INDP1-03 | OpenAI branch sends contact PII + full Raw JSON while RU/RO disclosure does not describe current processor flow | P1-04 CONFIRMED |
| INDP1-04 | mini_scan missing from generate_lead and tool-only session dedup suppresses legitimate repeated conversions | P1-05 CONFIRMED |
| INDP1-05 | Command Center reads Pipeline GID 1883973304 but unique write locator uses unresolved GID 1997367085 | separately isolated from P0-02 |

### P2 — 16

| ID | Finding | First-audit mapping |
|---|---|---|
| INDP2-01 | Clients accept any 2xx and canonical response precedes secondary archive/answers/activity/dashboard/alert/AI | P1-01 DOWNGRADED |
| INDP2-02 | Tiered business dedup is not atomic idempotency under concurrency/timeouts | P1-02 DOWNGRADED |
| INDP2-03 | Mini App zero-write resume absent active; old/new cycle contracts conflict | P1-03 DOWNGRADED |
| INDP2-04 | No Error Trigger/errorWorkflow; scheduled/management paths lack retry and retained errors have no central alert | P1-06 DOWNGRADED |
| INDP2-05 | analytics_consent, ga_client_id, ga_session_id are raw-only and merge/retry lifecycle is incomplete | P2-01 |
| INDP2-06 | UTM first-touch continuity and mini-scan GA enrichment incomplete | P2-02 |
| INDP2-07 | Server-side GA4 lifecycle sender absent | P2-03 |
| INDP2-08 | GA event taxonomy/dispatch inconsistent; consultation legacy submit precedes backend success | P2-04 |
| INDP2-09 | PR #10 full stored-row projection/equality not proven; four required fields omitted live | P2-05 |
| INDP2-10 | PR #10 authority convergence and failure/fallback matrix lack production-like executable proof | P2-06 expanded |
| INDP2-11 | Authoritative Google Sheets resume latency is unsuitable for synchronous Mini App path | P2-07 |
| INDP2-12 | RO mini-scan has Russian runtime strings | P2-08 |
| INDP2-13 | 60 non-home x-default conflicts | P2-09 |
| INDP2-14 | Security response headers absent on production 200 pages | P2-10 |
| INDP2-15 | Bootstrap canary is a cwd-sensitive log harness without assertions/fail verdict | P2-12 |
| INDP2-16 | Daily Digest sends Telegram then fails Activities append; 7/7 retained executions marked error | NEW |

### P3 — 6

| ID | Finding | First-audit mapping |
|---|---|---|
| INDP3-01 | 22 legacy/alias HTML files remain deployable outside sitemap | P3-01 |
| INDP3-02 | Obsolete GA ID remains in historical docs and two ZIP archives | P3-02 |
| INDP3-03 | Inactive QA/benchmark workflows, archived revisions and temporary definitions need controlled retention/cleanup | P3-03 |
| INDP3-04 | PR/live QA/docs and GitHub↔n8n versioning drift; no active workflow exports | P3-04 |
| INDP3-05 | bootstrap-canary.test.js resolves relative to cwd | P3-05 |
| INDP3-06 | Retained browser/GA regression suite and custom 404 are absent | P3-06 |

Totals are root findings, not every symptom/sub-impact counted separately.

## 13. Release GO/NO-GO

| Scope | Verdict | Reason |
|---|---|---|
| Live n8n inventory | PASS | full 33-workflow pagination and state reconciliation |
| Current public website | KEEP RUNNING | rollback does not close backend P0 and may reintroduce older defects |
| Command Center | P0 CONTAINMENT REQUIRED | body identity spoof + PII read exfiltration |
| Lead Intake | FIX REQUIRED | P1 trust/state boundary; canonical intake still operational |
| GA4/privacy | FIX REQUIRED | P1 query and OpenAI disclosure/minimization |
| Mini App/Data Table integration | NO-GO | inactive path and unclosed authority/fallback proof |
| PR #10 | BLOCKED | draft/docs-only/known correctness gaps |
| New integration release | NO-GO | one P0, unresolved GID, PR/fallback gaps |
| Controlled fix phase | YES | independent review complete; requires separate explicit production authorization |

“KEEP RUNNING” не означает оставить P0 без реакции. Это означает не выполнять необоснованный website rollback; Command Center containment должен быть первым отдельно разрешённым production change.

## 14. Minimal ordered fix plan

Ни один шаг ниже в ходе аудита не выполнялся.

1. Закрыть Command Center P0: real authenticated Telegram boundary/secret verification, bind validated sender and reply chat as one identity, deny generic body claims, add rate/error controls.
2. Через owner-authorized Google metadata/isolated test разрешить GID 1997367085; привести Command Center к canonical 1883973304 и отдельно проверить historical write effects.
3. Убрать caller lead_id как authorization/canonical selection capability; ввести server-owned request identity, constrained merge policy и atomic idempotency/unique ledger.
4. Исправить GA page_location/page_path query scrubbing; проверить consent + DebugView в non-production GA property.
5. Зафиксировать conversion semantics: mini_scan, success-only dispatch, request/conversion dedup granularity.
6. Минимизировать OpenAI payload, убрать unnecessary contact/raw/query/analytics fields; согласовать processor disclosure/legal basis/DPA на RU/RO.
7. Сделать six-field attribution structured, определить first-touch/last-touch merge и retry behavior; server lifecycle проектировать отдельно без PII.
8. Исправить Daily Digest Activities locator; добавить Error Workflow/global alert, retry/read-back для critical schedules и post-response sinks.
9. Усилить website response contract: parse ok:true и документировать canonical-vs-secondary durable success.
10. Для PR #10 исправить complete projection, actual stored-row read-back/hash, limit-2 duplicate detection, authoritative Bot_Sessions re-read и весь MISS/outage/malformed/invalidation matrix.
11. Version-control redacted n8n exports/hashes; превратить canary в assertion gate; затем controlled cleanup.
12. Провести independent browser/Telegram/GA/CRM test-data re-audit; только после этого новый GO/NO-GO.

## 15. Items still requiring owner/browser/external-system evidence

1. Наличие/отсутствие upstream WAF, allowlist, reverse-proxy auth или secret-token enforcement перед Command Center; workflow этого не показывает.
2. Google Sheet metadata для GID 1997367085 и audit trail возможных historical Command Center writes.
3. Owner confirmation Daily Digest delivery/history и expected Activities journal semantics; production payload не публиковался.
4. GA4 property conversion configuration, historical PII-bearing page_location hits, DebugView и non-production query scrub verification.
5. Real browser QA: consent accept/deny network, console, 390/430/desktop layout, accessibility interaction, redirect/referrer/session dedup.
6. Legal/owner evidence: OpenAI processor role, DPA/retention/region, privacy disclosure, lawful basis and separate AI minimization decision.
7. n8n execution-retention policy, credential scope/rotation, platform edge body/rate/CORS controls; secret values не запрашивались.
8. Actual Bot_Sessions → helper → Data Table stored-row equality with isolated test identities and no production mutation.
9. Duplicate/MISS/outage/timeout/malformed/cache invalidation/backfill/reconciliation executable evidence for PR #10.
10. Full git-history secret scan и external secret stores; текущая проверка покрывает tracked snapshots, не удалённую историю.
11. Post-fix independent verification before PR merge or Mini App activation.

FINMENTOR INDEPENDENT REVIEW — FINAL

FIRST AUDIT OVERALL QUALITY:
MIXED

P0 CONFIRMED:
P0-02 — Lead Command Center unauthenticated Telegram-shaped identity; expanded to canonical Pipeline PII exfiltration

P0 DOWNGRADED:
P0-01 -> P1; P0-03 -> P1

P0 REJECTED:
NONE

FINAL P0 COUNT:
1

FINAL P1 COUNT:
5

FINAL P2 COUNT:
16

FINAL P3 COUNT:
6

LIVE N8N INVENTORY:
PASS

GITHUB ↔ N8N DRIFT:
ISSUES

PR #10:
BLOCKED

CURRENT PRODUCTION SITE:
KEEP RUNNING

NEW INTEGRATION RELEASE:
NO-GO

SAFE TO START CONTROLLED FIX PHASE:
YES

PRODUCTION CHANGES MADE:
NONE

STOP.
