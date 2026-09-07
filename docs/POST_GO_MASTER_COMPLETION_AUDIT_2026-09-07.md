# POST_GO master completion audit — closed backlog, RO full parity, RU terminology

**Date:** 2026-09-07 · **Baseline SHA:** `bd40b3e2ad9bff67388aec1c83b9daf53cd269bd`
**Branch:** `feat/miniapp-b21c-live-prereqs` · **HEAD == origin:** YES · **Worktree:** clean
**Production tag:** `production-v1-live-2026-09-07` · **Production v1:** LIVE

**AUDIT AND PLAN ONLY.** No n8n workflow, Supabase row, website file, release mode or customer route
was changed while producing this document. Every figure was re-derived from the current repository,
the current remote trees and the live public surface — not carried forward from an earlier record.

**No credential, token, API key, base URL, bot token or owner identity appears in this record.**

---

## 0. Baseline

All eight gate records verified present in the remote tree at the baseline SHA: the GO plan and
Gates 1 through 7. The production tag dereferences to the baseline SHA.

Historical gate records are immutable evidence. Neither this audit nor any sprint it defines edits
them. Where a decision is superseded, a new current record is written instead.

---

## 1. The decisive topology finding

The most important fact for the naming decision, and it was not visible from any prior record:

| branch | `Radiografia Financiar*` under `ro/` | `sanatate financiar*` under `ro/` | `Test financiar` |
|---|---|---|---|
| `origin/main` — **DEPLOYED** | **182** | 0 | 0 |
| `feat/miniapp-b21c-live-prereqs` | 0 | **180** | 0 |

**The two branches are inverted on exactly this axis, across 32 RO files.** Live verification against
the public site confirms `origin/main` is what customers reach: the RO landing serves 15 occurrences
of the Radiografia name, the questionnaire 24, the privacy page 5, and zero of the health-test name.

This is Gate 6 finding **G6-06** seen in full — and it also **resolves** it. The new owner decision
retires *both* competing names, so migrating to `Test financiar FINMENTOR` collapses the divergence
rather than forcing a merge between two retired names. G6-06 is absorbed into Sprint 1.

    OLD RADIOGRAFIA NAME CURRENTLY REACHABLE = 184
      182 across 32 RO pages served from origin/main (live-verified)
      +1 customer result label   n8n/src/xray-analysis/build-client-result.js:22
      +1 model prompt name       n8n/src/xray-analysis/build-input.js:113

    OLD HEALTH-TEST NAME CURRENTLY REACHABLE = 0
      180 occurrences exist only on the unpublished feature branch and reach no customer

    "Test financiar" occurrences anywhere today = 0

---

## 2. RO customer journey — fresh audit

| Stage | Language state today | Verdict |
|---|---|---|
| Public site: landing, nav, CTA, contact, questionnaire, thank-you, privacy, terms, 404, metadata, OG, JSON-LD | Romanian, zero visible Cyrillic, diacritics intact | **COMPLETE** except the retired product name |
| Concierge — first contact | Romanian acknowledgement, empty keyboard, guarded by `/^ro(-|$)/` on Telegram `language_code` | partial |
| Concierge — every other branch | **Russian** | **INCOMPLETE** |
| Mini App brief / questionnaire | **Russian** | **INCOMPLETE** |
| Mini App shell strings | **Russian** | **INCOMPLETE** |
| Mini App result screen (`UI.ro`) | Romanian, complete | COMPLETE |
| CLIENT_READY customer result (`XRAY_LABELS.ro`) | Romanian, complete | COMPLETE except the product label |

Fresh translation surface, counted from current source (Cyrillic-bearing string literals):

| module | strings | role |
|---|---|---|
| `n8n/src/premium-ux/branches.js` | **354** | single source for the Concierge conversation *and* the Mini App brief |
| `app-premium/content.js` | 299 | generated from `branches.js` — not additional work |
| `app-premium/app.js` outside the `UI` table | **65** | hardcoded shell strings |
| `n8n/src/premium-ux/meeting-brief.js` | 15 | owner-facing; stays Russian |

    RO translation scope = 354 + 65 = 419 customer-visible strings — a closed number.

### Locale mechanism — current state

| module | locale keys | locale references |
|---|---|---|
| `branches.js` | **0** | **0** |
| `content.js` | **0** | **0** |
| `draft-contract.js` | 0 | 2 (carries, does not render) |
| `submit-projection.js` | 0 | 2 (carries, does not render) |
| `app.js` | 3 (`UI.ru` / `UI.ro`) | 17 |
| `net.js` | 0 | 10 (transport) |

Locale exists in the **transport and result** layers and is absent from the **content** layer. That
is the entire gap in one line.

    RO LOCALE AUTHORITY = NEEDS WORK

The v1 release fix — a Telegram `language_code` prefix match on one Concierge node — was a correct,
narrow, safe release action. It is not a locale architecture, and it fails for the most likely real
Romanian customer: one whose Telegram interface is set to Russian or English.

---

## 3. Proposed locale architecture (design only)

**Authority order, first match wins, evaluated once and then persisted:**

1. **Explicit customer journey origin.** A lead entering from `/ro/` carries `locale=ro` in the
   request payload — deterministic, and already present today.
2. **Persisted session/lead locale.** Once resolved it is written with the session and the lead and
   never re-derived. A returning customer keeps their language.
3. **Telegram `language_code`** — a *hint*, used only when 1 and 2 are both absent (a cold Telegram
   first contact with no web origin).
4. **Default `ru`** — only when nothing above resolves.

**Non-negotiables carried from v1:**

- no AI or model call participates in language selection;
- one state machine, one set of business logic, no RO fork;
- machine ids, `value=` scoring attributes, callback data, CRM stage enums and the CLIENT_READY
  12-key contract are untouched;
- RU behaviour functionally unchanged;
- RU and RO content in separate dictionaries generated from one spec;
- **a missing RO translation fails QA — never a silent fallback to Russian on an RO customer path.**
  This is the single most important acceptance rule of Sprint 1;
- the owner console stays Russian.

**Shape:** introduce a locale key into `branches.js` (`{ ru, ro }` per string), regenerate
`content.js` for both locales, lift the 65 hardcoded `app.js` strings into the existing `UI` table,
add a completeness gate that fails on any missing `ro` value.

---

## 4. RO product-name migration — classification and grammar

| Class | Where | Disposition |
|---|---|---|
| 1 — customer-visible current name | 182 across 32 RO pages on `origin/main`; result label; model prompt | **MUST CHANGE** |
| 2 — ordinary Romanian prose reference | inside those pages | change with correct grammar (below) |
| 3 — historical evidence | Gate 3 / 5 / 6 / 7 records (13 + 3 + 3 + 8 hits) | **MUST NOT CHANGE** |
| 4 — machine / internal id | `value="..."` scoring attributes, callback data, CRM enums | **MUST NOT CHANGE** |
| 5 — SEO / meta / schema | titles, meta description, OG, Twitter, JSON-LD `name` | migrate with the visible copy, same release |
| 6 — prompt / model instruction | `build-input.js:113` | align — it shapes generated customer copy |
| 7 — test / spec assertion | `qa/xray-analysis.test.mjs` (3), `qa/ro-first-contact.test.mjs`, `qa/premium-ux-result-*.test.mjs` | update **only** as the governing spec changes, same commit |
| 8 — archived / legacy | superseded feature-branch rename, `docs/FINMENTOR_PRODUCT_LANGUAGE_STANDARD.md` | supersede deliberately, do not silently rewrite |

### Romanian grammatical rule (proposed, for owner review)

One brand, declined naturally. Never a second product name.

| Context | Form |
|---|---|
| Brand / title / heading / OG / JSON-LD `name` | **Test financiar FINMENTOR** |
| Nominative with article, in prose | *Testul financiar FINMENTOR* |
| Accusative after a verb (CTA) | «Incepeti **Testul financiar FINMENTOR**» |
| Genitive / possessive | «Rezultatele **Testului financiar FINMENTOR**» |
| Prepositional | «in cadrul **Testului financiar FINMENTOR**» |

Forbidden after this decision: `Radiografia Financiara`, `Radiografia Financiara FINMENTOR`,
`Testul de sanatate financiara`, `Test de sanatate financiara`. `Financial Health Check` may remain
only where it is an established English product name inside a Romanian sentence, never as a primary
heading.

### URLs and slugs — do not rename

`ro/financial-health-check.html` and every other RO slug **stay exactly as they are.** They are
English-language slugs, already stable and indexed, and unrelated to either retired name. Renaming
them would require 301 redirects that GitHub Pages cannot serve from `_headers`, so a slug change
would silently break every indexed URL and inbound link. **Slug stability is a hard constraint of
Sprint 1.** Only visible copy, metadata and structured data change.

---

## 5. RU CUSTOMER LANGUAGE & TERMINOLOGY

Fresh census across the RU customer-facing surface. 38 canonical pages audited; the `(N).html`
duplicate/legacy files are excluded from the remediation count and handled as archive.

    RU TERMINOLOGY = INCOMPLETE
    VISIBLE ENGLISH/JARGON ITEMS = 1169
    MACHINE VALUES TO PRESERVE   = 111

Core census (canonical RU pages / `app-premium` / `n8n/src`):

| term | site | app | n8n | class |
|---|---|---|---|---|
| CFO | 108 | 3 | 27 | customer-visible — MUST CHANGE |
| Cash Flow | 89 | 5 | 12 | customer-visible — MUST CHANGE |
| KPI | 59 | 0 | 5 | customer-visible — MUST CHANGE |
| dashboard / Dashboard | 57 | 2 | 8 | customer-visible — MUST CHANGE |
| Financial Health Check | 40 | 0 | 5 | customer-visible — MUST CHANGE |
| P&L | 29 | 3 | 7 | customer-visible — MUST CHANGE |
| SKU | 29 | 0 | 0 | customer-visible — MUST CHANGE |
| Supplier Shelf Credit | 29 | 0 | 0 | product name — owner decision |
| Retail Margin Engine | 28 | 0 | 1 | product name — owner decision |
| Discovery | 24 | 0 | 19 | split: label changes, enum preserved |
| promo | 23 | 3 | 19 | customer-visible — MUST CHANGE |
| Real Estate | 19 | 0 | 1 | customer-visible — MUST CHANGE |
| Retail | 18 | 0 | 4 | customer-visible — MUST CHANGE |
| External CFO | 13 | 0 | 0 | customer-visible — MUST CHANGE |
| CAPEX | 12 | 1 | 2 | customer-visible — MUST CHANGE |
| Fitness | 9 | 0 | 0 | customer-visible — MUST CHANGE |
| Distribution | 8 | 0 | 0 | customer-visible — MUST CHANGE |
| E-commerce | 8 | 0 | 1 | customer-visible — MUST CHANGE |
| Custom Manufacturing | 4 | 0 | 0 | customer-visible — MUST CHANGE |
| Balance | 3 | 2 | 2 | customer-visible — MUST CHANGE |
| CFO-review | 3 | 0 | 0 | customer-visible — MUST CHANGE |
| Roadmap | 2 | 0 | 0 | customer-visible — MUST CHANGE |
| Risk map | 1 | 0 | 0 | customer-visible — MUST CHANGE |
| **AI** | **207** | 34 | 158 | **MAY KEEP — owner decision required** |
| **Power BI** | **78** | 0 | 2 | **MAY KEEP** — product name |
| IRR / NPV / MOIC / Payback | 0 | 4 | 12 | MAY KEEP as secondary clarification |
| HOT / WARM / COLD | 0 | 0 | 41 | **machine value — PRESERVE** |
| PRIORITY | 0 | 0 | 14 | machine value; label changes |
| Nurture / Won / Lost | 1 | 0 | 20 | machine enum — PRESERVE; labels change |
| redevelopment | 0 | 1 | 1 | customer-visible — MUST CHANGE |

Verified sample — these are visible body copy, not attributes:

> «Собственник не видит KPI, риски и отклонения в одном месте.»
> «Cash Flow, P&L, KPI и платежи живут в разных таблицах»
> «Экспресс-анализ P&L / Cash Flow / долгов / платежей»

In `questionnaire.html` the split is stark and favourable: of 24 `Cash Flow` occurrences only 2 sit
in `value=` attributes; of 13 `P&L`, only 3. **The visible label and the machine value are already
separate constructs** — remediation changes the label and leaves the value byte-identical. No
scoring contract change is required anywhere.

### Occurrence classification, per the owner's five categories

1. **CUSTOMER-VISIBLE LABEL/TEXT** — 1,169 across 38 canonical RU pages, `app-premium` shell and
   the Concierge/brief content. This is the remediation scope.
2. **OWNER-VISIBLE HUMAN UI** — Telegram alert button text and stage labels. Changes to Russian;
   the underlying callback and enum do not.
3. **SEO/METADATA** — titles, meta descriptions, OG and JSON-LD on the same 38 pages. Migrates with
   the visible copy in the same release so search snippets stay consistent.
4. **MACHINE VALUE / ENUM / CALLBACK / ID** — 111 preserved items: 17 inside `value="..."` scoring
   attributes, plus `HOT`/`WARM`/`COLD` (41), `PRIORITY` (14), `Discovery`/`Nurture`/`Won`/`Lost`
   (39) in `n8n/src`. **None of these change.**
5. **INTERNAL TECHNICAL DOCUMENTATION** — `docs/`, QA and scripts. Out of scope except where a
   governing current spec must be superseded.

**Hard rule, with the concrete example.** `n8n/src/lead-alerts/actions.js:64` emits
`'stage|' + id + '|Discovery Scheduled'`. That literal is callback data *and* the value written to
the Pipeline `deal_stage` column. It is a machine value. Only the owner-visible button text changes.
The same separation applies to every scoring attribute, callback payload, CRM enum and CLIENT_READY
key name. `HOT` additionally drives SLA branch logic (`build-merge-update.js:49,51`) — renaming it
would silently change SLA routing.

### Approved target vocabulary (governing spec, from the owner decision)

`Cash Flow` → Денежный поток / Движение денежных средств · `P&L` → Управленческий отчёт о прибыли и
убытках · `Balance` → Управленческий баланс · `KPI` → Ключевые показатели бизнеса · `dashboard` →
Панель собственника · `CFO` → Финансовый директор · `External CFO` → Внешний финансовый директор ·
`CFO-review` → Регулярный финансовый разбор · `Monthly owner report` → Ежемесячный отчёт
собственника · `Roadmap` → План действий · `Financial Health Check` → Экспертная финансовая
диагностика · `Real Estate` → Недвижимость и аренда · `Retail` → Розничная торговля · `E-commerce` →
Интернет-торговля · `Distribution` → Оптовая торговля / дистрибуция · `Custom Manufacturing` →
Производство под заказ · `Fitness` → Фитнес / спортивный бизнес · `Services` → Услуги · `Other` →
Другое · `CAPEX` → Капитальные вложения · `redevelopment` → Реконструкция / перепрофилирование ·
`GO / NO-GO` → Инвестировать / не инвестировать · `PRIORITY` → Приоритет.

CRM human labels: `Discovery` → Первичный финансовый разбор · `Discovery Scheduled` → Финансовый
разбор назначен · `Won` → Клиент / сделка состоялась · `Lost` → Закрыто без сделки.

    MUST CHANGE = 1169 visible occurrences (24 term families)
    MAY KEEP WITH EXPLANATION =
      Power BI (78) — established product name
      IRR / NPV / MOIC / Payback (16) — secondary clarification only, in parentheses after a
        Russian phrase carrying the economic meaning
      AI (207) — OWNER DECISION REQUIRED: no target translation was given, and "AI" is now common
        business vocabulary. Recommendation: keep the term but never as the primary explanation of
        value; the primary phrase must state the economic benefit in Russian.
      Retail Margin Engine (28), Supplier Shelf Credit (29) — OWNER DECISION REQUIRED: treat as
        FINMENTOR product names (keep, like Power BI) or translate. Not assumed either way.
    MACHINE VALUES TO PRESERVE = 111

`Make`, `n8n` and `API` must not appear in primary customer copy; describe the benefit as
автоматизация instead.

### Russian that is still jargon

Copy that is technically Russian but reads as IT/product language rather than finance language is
counted inside the 1,169 and remediated by the same pass. Observed patterns: «контур»,
«ядро», «подключаются к финансовой логике», «настраивает контроль под метрики». The rewrite target
is the language an owner or CFO would actually use about money.

---

## 6. Master table — the closed backlog

Effort: S ≤ 1 day · M ≈ 2–4 days · L ≈ 1–2 weeks.

| ID | WORKSTREAM | ITEM | CURRENT STATE | CUSTOMER IMPACT | RISK | EFFORT | DEPENDENCIES | CLASSIFICATION | SPRINT | ACCEPTANCE TEST |
|---|---|---|---|---|---|---|---|---|---|---|
| S1-01 | RO naming | Migrate 182 live RO occurrences to `Test financiar FINMENTOR` | STILL REQUIRED | High — retired name is what customers see | Med — SEO/meta churn | M | owner grammar sign-off | **MUST_DO** | 1 | 0 retired names on any live RO page; slugs unchanged; canonical/OG/JSON-LD consistent |
| S1-02 | RO naming | X-Ray customer result label `build-client-result.js:22` | STILL REQUIRED | High — on every RO result | Low | S | S1-01 | **MUST_DO** | 1 | newly generated RO result carries the new label; 12-key contract unchanged |
| S1-03 | RO naming | X-Ray model prompt name + Romanian article seam (G6-04) | STILL REQUIRED | Indirect — shapes generated copy | Low | S | S1-02 | **MUST_DO** | 1 | prompt names the canonical brand; grammatical seam gone |
| S1-04 | RO naming | Resolve `main` ↔ feature RO divergence (G6-06) | SUPERSEDED by S1-01 | None directly | Med — a naive merge would publish a retired name | S | S1-01 | **MUST_DO** | 1 | one branch, one name, zero retired names either side |
| S1-05 | RO parity | Locale mechanism in `branches.js` (354 strings) | STILL REQUIRED | High — RO customer holds a Russian conversation | Med | L | architecture sign-off | **MUST_DO** | 1 | every key has `ro`; completeness gate fails on any gap |
| S1-06 | RO parity | Regenerate `content.js` for both locales | STILL REQUIRED | High — Russian brief for RO customer | Low | S | S1-05 | **MUST_DO** | 1 | bundle reproducible; RU byte-stable |
| S1-07 | RO parity | Lift 65 hardcoded `app.js` shell strings into `UI` | STILL REQUIRED | Med — mixed-language shell | Low | M | S1-05 | **MUST_DO** | 1 | zero Cyrillic literals outside the locale table |
| S1-08 | RO parity | Locale authority + propagation (site → Telegram → Gateway → Mini App → result) | STILL REQUIRED | High — RO customer with RU Telegram gets RU | Med | M | S1-05 | **MUST_DO** | 1 | RO web origin yields RO end to end with Telegram UI set to `ru` |
| S1-09 | RU language | Remediate 1,169 visible jargon occurrences on 38 canonical RU pages | STILL REQUIRED | High — clarity for the buyer | Med | L | owner vocabulary spec (§5) | **MUST_DO** | 1 | 0 visible must-change terms; 111 machine values byte-identical |
| S1-10 | RU language | Separate owner-visible CRM labels from stage enums | STILL REQUIRED | Owner-facing | Med — enum drift would corrupt CRM and SLA routing | M | S1-09 | **MUST_DO** | 1 | labels Russian; `deal_stage` and `priority` byte-identical; Gate 2 lifecycle re-passes |
| S1-11 | RU language | Owner decisions on `AI`, `Retail Margin Engine`, `Supplier Shelf Credit` | OPEN — not assumed | Med | Low | S | owner | **MUST_DO** | 1 | each term has a recorded keep/translate decision |
| S1-12 | RO/RU | Update governing specs + QA assertions for both renames | STILL REQUIRED | None | Med | M | S1-01, S1-09 | **MUST_DO** | 1 | canonical QA green; historical gate records untouched |
| S1-13 | RO/RU | New owner-decision record superseding the Gate 3 naming decision | STILL REQUIRED | None | Low | S | S1-01 | **MUST_DO** | 1 | record exists; Gate 3 unedited |
| S2-01 | Reliability | NEW LEAD durable outbox **relay/dispatcher** (PG-01) | PARTIAL — schema applied in prod with RLS, `DELIVERY_UNKNOWN` modelled (133 refs), **relay not built** | None today | Med — a Telegram outage drops the alert to manual recovery | L | none | **SHOULD_DO** | 2 | injected delivery failure is retried and reconciled without manual action |
| S2-02 | Reliability | `DELIVERY_UNKNOWN` runtime semantics | DESIGNED, not in runtime path | None today | Med | M | S2-01 | **SHOULD_DO** | 2 | ambiguous delivery resolves to exactly one alert, never two |
| S2-03 | Reliability | Retention automation (PG-03) | STILL REQUIRED — policy published, execution manual | None visible | **Med-High — a published 12-month promise with no job** | M | none | **MUST_DO** | 2 | scheduled job proves deletion at the published boundary |
| S2-04 | Reliability | Raw Pipeline `request_id` retention review | STILL REQUIRED | None | Low | S | S2-03 | **SHOULD_DO** | 2 | retention boundary documented and enforced |
| S2-05 | Reliability | HMAC fingerprint v2 (PG-04) | OPTIONAL — current SHA-256 + atomic claim pass | None | Low | M | none | **FUTURE** | — | — |
| S2-06 | Reliability | Backup / recovery evidence | STILL REQUIRED — never proven | None until needed | **High if ever needed** | M | none | **MUST_DO** | 2 | documented restore of Pipeline + curated results into a scratch target |
| S2-07 | Reliability | First-24h monitoring + real lead reconciliation | STILL REQUIRED | None | Med | S | none | **MUST_DO** | 2 | one reconciliation run: one row per lead per store, zero duplicates |
| S2-08 | Reliability | SYSTEM ALERT / Error Monitor coverage review | ADEQUATE — verified live, zero firings, tenant error baseline = 1 pre-existing | None | Low | S | none | **SHOULD_DO** | 2 | coverage matrix lists every failure path and its alert |
| S3-01 | Hygiene | `.gitattributes` (PG-10) | STILL REQUIRED — absent; 503-file phantom diff proven this session | None | Med — has broken byte-gates twice | S | none | **MUST_DO** | 3 | fresh clone on Windows shows a clean worktree |
| S3-02 | Hygiene | Nested-clone hazard + stale parent working copy | STILL REQUIRED — parent at `cc6a4bf`; nested clone untracked and unignored | None | **High — `git add -A` would commit a whole clone** | S | none | **MUST_DO** | 3 | nested path ignored; parent current |
| S3-03 | Hygiene | Gateway 13-node baselines vs 32 deployed (PG-12) | STILL REQUIRED — 5 tools | None | Med — healthy Gateway reports FAIL | M | none | **MUST_DO** | 3 | all five agree with the deployed graph |
| S3-04 | Hygiene | Non-idempotent Lead Alerts deployer (PG-11) | STILL REQUIRED | None | Med — a re-run corrupts two live workflows | S | none | **MUST_DO** | 3 | second run is a no-op |
| S3-05 | Hygiene | Secret-scan poison fixture red CI (G6-02) | STILL REQUIRED | None | **Med — the detector is blind while red** | S | none | **MUST_DO** | 3 | scan green; fixture still proves secret suppression |
| S3-06 | Hygiene | Authoritative deployer index | STILL REQUIRED | None | Med — superseded scripts remain runnable | S | S3-03 | **MUST_DO** | 3 | one document names the current deployer per workflow |
| S3-07 | Hygiene | Stale opening headers in append-only records (G6-05) | STILL REQUIRED | None | Low | S | none | **SHOULD_DO** | 3 | each record's status line matches its final section |
| S3-08 | Hygiene | Pipeline `language` column (PG-13) | STILL REQUIRED | None | Low — blocks RO drop-off analysis | S | S1-08 | **SHOULD_DO** | 3 | RO leads identifiable without `source_page` |
| S3-09 | Hygiene | UAT synthetic row convention (PG-14) | STILL REQUIRED | None | Low | S | none | **SHOULD_DO** | 3 | one marking convention; decision recorded |
| S4-01 | Commercial | Edge security headers (G6-01) | STILL REQUIRED — reproduced live: `Server: GitHub.com`, none of the six headers | None visible | Med, bounded — static, no auth, no cookies | M | platform move | **SHOULD_DO** | 4 | headers present, or the platform limit re-recorded as accepted |
| S4-02 | Commercial | SEO/canonical/schema consistency after both renames | STILL REQUIRED | Med — discoverability | Med | M | S1-01, S1-09 | **MUST_DO** | 4 | titles, meta, OG, JSON-LD, sitemap consistent; slugs unchanged |
| S4-03 | Commercial | GA4 contract re-proof after renames | STILL REQUIRED | None | Med — a renamed CTA can break an event | S | S4-02 | **MUST_DO** | 4 | Gate 4's 18/18 live UAT re-passes |
| S4-04 | Commercial | UTM / campaign attribution readiness | STILL REQUIRED | Med — commercial | Low | S | S4-03 | **SHOULD_DO** | 4 | attribution survives entry → lead → CRM |
| S4-05 | Commercial | Nav, CTA hierarchy, language switcher, error/loading/empty states | PARTIAL | Med | Low | M | S1-01 | **SHOULD_DO** | 4 | RU and RO reviewed at mobile and desktop widths |
| S4-06 | Commercial | Accessibility basics | STILL REQUIRED | Low-Med | Low | S | S4-05 | **SHOULD_DO** | 4 | contrast, focus order, alt text, labels |
| F-01 | Future | Graph / Microsoft 365 email delivery (PG-02) | NO LONGER RELEVANT to the v1 contract | None | Low | M | S2-01 | **FUTURE** | — | — |
| F-02 | Future | Additional BI / Power BI dashboards (PG-05) | OPTIONAL | None | Low | L | none | **FUTURE** | — | — |
| F-03 | Future | Meta / CAPI | Not an approved next commercial step | None | Low | M | S4-04 | **FUTURE** | — | — |
| F-04 | Future | Additional automations (PG-07) | OPTIONAL | None | Low | L | none | **FUTURE** | — | — |
| D-01 | Drop | Broader architecture refactoring (PG-08) | Debt only, no proven blocker | None | — | L | — | **DROP** | — | — |
| D-02 | Drop | Button emphasis on two re-rendered alert shapes (PG-09) | Cosmetic; needs node-splitting | None | — | M | — | **DROP** | — | — |
| D-03 | Drop | `xray_score` empty for non-questionnaire leads (G6-03) | Correct anti-fabrication behaviour | None | — | — | — | **DROP** | — | — |
| D-04 | Drop | Generic "UI polish" (PG-06) | Superseded by the concrete S4-05 / S4-06 | None | — | — | — | **DROP** | — | — |

    MUST_DO   = 25
    SHOULD_DO = 11
    DROP      = 4
    FUTURE    = 4
    TOTAL     = 44

All twenty Gate 6 register entries (PG-01…PG-14, G6-01…G6-06) are reconciled above. None was
silently dropped: PG-06, PG-08, PG-09 and G6-03 are explicit **DROP** decisions with a stated
reason; G6-06 is absorbed into S1-04; the rest carry forward with a fresh status.

---

## 7. The four sprints

### SPRINT 1 — RO FULL PARITY + CUSTOMER TERMINOLOGY

Closes both halves in one release: **A.** full Romanian parity and natural Romanian copy, and
**B.** understandable Russian economic terminology.

**Scope:** S1-01 … S1-13. The 419-string RO localisation, the locale authority, the RO product-name
migration, and the 1,169-occurrence RU terminology normalisation.

**Explicitly excluded:** any change to scoring `value=` attributes, callback data, CRM stage enums,
`priority` values, the CLIENT_READY 12-key contract, X-Ray review authority, RELEASE_MODE, URL
slugs, or the owner console language.

**Acceptance gates — required end state:**

    RO SITE = FULL RO · RO QUESTIONNAIRE = FULL RO · RO CONCIERGE = FULL RO
    RO MINI APP BRIEF = FULL RO · RO MINI APP SHELL = FULL RO
    RO CLIENT_READY RESULT = FULL RO · RO PRIVACY / TERMS = FULL RO
    RO PRODUCT NAME = Test financiar FINMENTOR
    RU JOURNEY REGRESSION = NONE
    SCORING CONTRACT CHANGE = NO · CRM CONTRACT CHANGE = NO
    X-RAY AUTHORITY CHANGE = NO · CUSTOMER RESULT 12-KEY CONTRACT CHANGE = NO

Plus: zero retired product names reachable; zero Cyrillic on any RO customer surface; zero Romanian
on any RU customer surface; a missing RO string fails QA rather than falling back; the 111 machine
values byte-identical; canonical QA green with no lowered assertions.

**Rollback boundary:** website via `origin/main` revert; Concierge, Mini App host and X-Ray each via
their own pre-deploy `.uat` artifact. Session/Submit are **not** touched — RELEASE_MODE stays
`CUSTOMER`. **Complexity: L. Owner UAT: REQUIRED** (RO conversation, RO brief, RO result, RU
vocabulary sign-off). **Independent audit: REQUIRED.**

### SPRINT 2 — RELIABILITY + RETENTION

**Scope:** S2-01 … S2-04, S2-06, S2-07, S2-08. **Excluded:** HMAC v2, Graph/M365, any new customer
capability. **Acceptance:** the retention job proves deletion at the published boundary; an injected
delivery failure is retried and reconciled with no duplicate lead; a documented restore succeeds into
a scratch target; one clean reconciliation run. **Rollback boundary:** additive only — the relay can
be disabled without touching the direct path. **Complexity: L. Owner UAT: not required** except the
retention boundary confirmation. **Independent audit: REQUIRED** — this touches data lifecycle.

### SPRINT 3 — ENGINEERING HYGIENE

**Scope:** S3-01 … S3-09. **Excluded:** any runtime behaviour change. **Acceptance:** a fresh clone
on Windows shows a clean worktree; canonical QA runs without an LF-archive workaround; the secret
scan is green; all five Gateway tools agree with the 32-node deployed graph; the legacy deployer is
a no-op on re-run; one document names the current deployer per workflow. **Rollback boundary:**
repository-only, nothing deployed. **Complexity: M. Owner UAT: no. Independent audit: no.**

### SPRINT 4 — COMMERCIAL POLISH

**Scope:** S4-01 … S4-06. **Excluded:** redesign, Meta/CAPI, new BI. **Acceptance:** Gate 4's live
GA4 UAT re-passes at 18/18 after the renames; metadata consistent in both languages with slugs
unchanged; attribution survives end to end; nav, CTA and switcher reviewed at mobile and desktop
widths. **Rollback boundary:** website revert via `origin/main`. **Complexity: M. Owner UAT:
REQUIRED** (browser). **Independent audit: no.**

---

## 8. Sequencing and the single next checkpoint

Sprint 1 must precede Sprint 4: S4-02 and S4-03 validate metadata and analytics *after* the renames,
and running them first would only have to be redone. Sprints 2 and 3 are independent of 1 and of each
other. S3-01 (`.gitattributes`) is cheap and removes a proven source of false QA failures, so it is
worth doing first within Sprint 3 regardless of ordering.

**NEXT SINGLE CHECKPOINT = SPRINT 1 SCOPE APPROVAL** — owner sign-off on the Romanian grammatical
forms in §4, the Russian target vocabulary in §5, and the three open terminology decisions in S1-11
(`AI`, `Retail Margin Engine`, `Supplier Shelf Credit`), before any implementation begins.

This document defines a closed program: forty-four items, four sprints, and nothing outside them.
