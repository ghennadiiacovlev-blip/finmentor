# FINMENTOR — Refine Proof / Practice / Flow + Automatic Experience Counter

Дата: `2026-09-24`
Статус: **IMPLEMENTED — OWNER GATE (no merge, no deploy)**

## 0. Git baseline

| Item | Value |
|---|---|
| PRODUCTION_BASELINE_HEAD | `bf3cf0c154eb3f39d24ef9c62f26ca06b296786d` (`redesign/visual-system-2`) |
| Production source (GitHub Pages API) | branch `redesign/visual-system-2`, path `/`, build type `legacy`, CNAME `www.finmentor.md`, latest Pages build `built` for `bf3cf0c` at `2026-09-23T15:24:43Z` |
| Live check | `https://www.finmentor.md/` byte-identical to local `index.html` at `bf3cf0c` (diff = 0) |
| Relationship to `main` | `main` = `origin/main` = `f5e24d3`, **44 commits behind** production; `main` is NOT the production source and was not touched |
| WORK_BRANCH | `design/refine-proof-practice-flow` |
| STARTING_HEAD | `bf3cf0c154eb3f39d24ef9c62f26ca06b296786d` |

No reset, no discard, no merge, no deploy, Pages source unchanged.

> **Concurrent edits noticed.** During this session another tool modified files this task does not
> own: `editorial.css`, `real-estate-control-system.html`, `ro/real-estate-control-system.html`,
> `qa/production-layout-regression.spec.mjs`, plus untracked `real-estate-flow-*-after.png` and
> `test-results/`. They are **not** part of this branch's commit and were left untouched in the
> working tree for their owner.

## 1. Change log — что было → что изменил → зачем

### Experience counter (index.html, ro/index.html, about.html, ro/about.html)
- Было: `15+ лет в корпоративных финансах` / `15+ ani în finanțe corporative` — ручное число, устаревшее (карьера с августа 2008 → сегодня 18 полных лет).
- Изменил: число обёрнуто в `<span data-experience-years>18+</span>` внутри той же строки; значение вычисляется `experience.js` из единственной даты `2008-08-01`; статический fallback синхронизируется скриптом и проверяется QA.
- Зачем: показатель опыта больше не поддерживается вручную; RU и RO берут одно и то же значение; без JS остаётся проверенное число.
- Дизайн: тот же `<p class="hero__trust-line">`, тот же шрифт/размер/цвет/отступы; span без стилей; никакой анимации.

### About / Professional practice (about.html, ro/about.html)
- Было: тезис «на основе многолетней практики финансового директора»; eyebrow «Кто стоит за FINMENTOR» дословно повторял h2; мозаика из 6 плиток без иерархии.
- Изменил: тезис несёт вычисляемый счётчик (`18+ лет практики в корпоративных финансах и финансовом управлении`); eyebrow → «Основатель и практика» / «Fondator și practică»; плитки переставлены и переформулированы в иерархии Financial Management → Business Control → Capital → Data → Automation/AI (01 Финансовое управление — несколько юрлиц, проектов и объектов · 02 Управленческая отчётность и бизнес-контроль · 03 Денежный поток, ликвидность и казначейство · 04 Инвестиционные решения и операционные модели · 05 Данные, BI и автоматизация — после финансовой логики · 06 Big4 / IFRS-фундамент).
- Зачем: раздел отвечает «кто стоит за FINMENTOR» через проверяемую практику, а не CV; ИИ/автоматизация остаются поддерживающим слоем; устранено дословное дублирование.
- Не сделано намеренно: никаких названий компаний, логотипов, хронологии.

### How FINMENTOR works (owner.html#steps, ro/owner.html#steps)
- Было: три шага с описанием процесса, без явного результата для собственника.
- Изменил: каждое описание открывается семантикой шага (Понять ситуацию / Построить контроль / Принять решение и контролировать исполнение), утверждённые заголовки сохранены («Диагностика», «Система контроля», «Сопровождение и контроль исполнения» — их литерал проверяет gate `commercial-polish`); добавлена строка `step-card__result` «Результат для собственника: …» (что происходит → почему → что требует решения первым · одна система контроля денег, результата и капитала · анализ заканчивается действием, а не отчётом).
- Зачем: собственник видит не только «что делаем», но и что получает на каждом шаге. Визуальная система сохранена (тот же step-card; добавлено одно CSS-правило для строки результата в inline-стилях страницы).

### Practice / Как это выглядит на практике (index.html#cases, ro/index.html#cases)
- Было: подписи «Ситуация / Контроль / Решение»; решения заканчивались инструментом или лозунгом («Платёжная дисциплина…», «…в одной картине»).
- Изменил: подписи «Ситуация / CFO-контроль / Решение собственника»; каждый блок контроля описывает, что берётся под контроль, каждое решение — что становится возможным для собственника (дефицит денег виден заранее и понятно, какие платежи безопасны; что платить сейчас / согласовать / отложить; где бизнес реально зарабатывает и где теряется маржа). Лид дополнен одной строкой логики.
- Зачем: pain-first логика сохранена, но результат сформулирован как управленческое решение, а не как «сделали Cash Flow».

### cases.html / ro/cases.html
- Было: три сценария; контекстная строка hero повторяла лид; результат для собственника заканчивался инструментом; RO содержал дефекты («Tablou de bord pentru proprietar (Dashboard) pentru proprietar», «structura tabloul de bordui»); нижний CTA-блок содержал две кнопки с одинаковой подписью «Обсудить задачу».
- Изменил: контекстная строка → логика сценария (бизнес-проблема → финансовый сигнал → вмешательство CFO → видимость для собственника → управленческое решение); в каждый сценарий добавлен «финансовый сигнал» и финальный пункт «Решение собственника»; добавлен **Сценарий 4 — Коммерческая недвижимость** в той же структуре (Ситуация / Симптомы / Что делаем / Что получает собственник / Какие данные нужны / Следующий шаг) с логикой объекты → арендаторы → аренда → NOI → вакансия → CAPEX → Cash Flow → риск → капитал → решение; RO-дефекты исправлены; вторая кнопка → «Написать в Telegram»; в связанные материалы добавлена страница управления недвижимостью.
- Зачем: сценарии читаются как управленческая логика, а не как список работ; недвижимость (флагман) представлена как анонимный сценарий. Ни клиентов, ни цифр, ни ROI, ни сроков не добавлено.

### Deliverables inside existing service sections
- CFO Advisory Session (`cfo-consultation.html` + RO): список «Что получает клиент» → сформулированный управленческий вопрос · сравнение альтернатив · ключевые риски · рекомендуемое направление · следующие действия.
- Financial Health Check (`financial-health-check.html` + RO; homepage panel 02): «Что клиент получает» → карта проблем · критические риски · приоритеты · рекомендации · план 30/60/90; на главной добавлен пункт «Приоритеты и рекомендации: что чинить первым».
- Business Control System (`business-control-system.html` + RO; homepage panel 03): «Платёжный календарь» → «Платёжный календарь и контроль платежей» (P&L, Cash Flow, KPI, план-факт, правила, отчёт собственника уже были).
- CFO Control Partner (homepage panel 04; `monthly-cfo-support.html` + RO): цикл «цифры → анализ → решение → **действие** → контроль» (было «исполнение»); та же строка добавлена на страницу сопровождения.
- Зачем: результат каждого формата назван явно, без нового раздела. Объём продуктов и цены не изменены.

### QA / tooling
- `experience.js` — единственный источник даты и расчёта (browser + CommonJS).
- `qa/experience-counter.test.mjs` — новый gate (35 проверок), зарегистрирован в `qa/run-all.mjs` и `qa/assertion-baseline.json` (floor 35, total 3667 → 3702).
- `scripts/sync-experience-fallback.mjs` — генерация/проверка статического fallback из того же helper'а.
- `qa/content-migration.check.mjs` — утверждённые замены формулировок (значение опыта берётся из helper'а, не типизируется).
- `FINMENTOR_VISUAL_SYSTEM_2.md` — примечание о вычисляемой proof-line.

## 2. Proof register — FACT → SOURCE → STATUS → PUBLIC WORDING

LinkedIn (`https://www.linkedin.com/in/ghennadi-iacovlev-791ba831/`) was **not machine-readable in this
session**: both fetch paths returned HTTP 999 (LinkedIn's anti-automation response). Verification
therefore rests on (a) the owner's brief for this task and (b) copy already published on
www.finmentor.md and approved in earlier owner gates. Nothing new was asserted beyond those two
sources; every row marked *owner-confirm* should be re-read by the owner against LinkedIn before deploy.

| # | FACT | SOURCE | STATUS | PUBLIC WORDING |
|---|---|---|---|---|
| 1 | Finance career started August 2008 | Owner brief §4 (`2008-08-01`) | **OWNER-STATED** — canonical date in `experience.js`; owner-confirm against LinkedIn | «18+ лет в корпоративных финансах» / «18+ ani în finanțe corporative» (computed) |
| 2 | Practice of a financial director / CFO function | Published (about.html thesis, hero), brief §3 | PUBLISHED, retained | «практики финансового директора», «Финансовое управление» |
| 3 | Financial management across several legal entities, projects and objects | Published (about mosaic tile 06, formerly) | PUBLISHED, retained (moved to tile 01) | «несколько юрлиц, проектов и объектов» |
| 4 | Management reporting / business control | Published («Управленческая отчётность»), brief §3 (Management P&L, Business Control) | PUBLISHED + brief | «Управленческая отчётность и бизнес-контроль» |
| 5 | Cash flow, liquidity, treasury | Published («Управление денежным потоком и казначейством»), brief §3 | PUBLISHED + brief | «Денежный поток, ликвидность и казначейство» |
| 6 | Investment decisions and operating models | Published («Инвестиционные и операционные модели»), brief §3 (Investment Decisions) | PUBLISHED + brief | «Инвестиционные решения и операционные модели» |
| 7 | Data / BI / automation as supporting tools | Published (methodology «Power BI и данные из 1С», «ИИ после фундамента»), brief §3 hierarchy | PUBLISHED + brief | «Данные, BI и автоматизация — после финансовой логики» |
| 8 | Big4 / IFRS foundation | Published (about mosaic, treasury.html legacy) | PUBLISHED, retained — **owner-confirm** (not verifiable here) | «Big4 / IFRS-фундамент» |
| 9 | Budgeting / Forecasting, Financial Analytics as distinct proven domains | Brief §3 (listed as *possible*) | **NOT PUBLISHED** — no independent verification available; not added | — |
| 10 | Education, professional development, employer names, years per role | Brief §3 / §14 | **NOT PUBLISHED** by design (no CV, no employer wall, no chronology) | — |

## 3. Experience counter register

| Item | Value |
|---|---|
| Canonical career start | `FINANCE_CAREER_START_DATE = '2008-08-01'` in `experience.js` (the only shipped file containing that date or the year 2008 — enforced by QA) |
| Helper | `experience.js` → `window.FMExperience` / `module.exports`: `getFinanceExperienceYears(date)`, `formatExperienceYears(date)`, `apply(document)` |
| Rule | completed years = year − 2008, minus 1 if the calendar date is before 1 August; local calendar components, never milliseconds, never UTC parse |
| Pages using it | `index.html` (hero trust line), `ro/index.html` (hero trust line), `about.html` (thesis), `ro/about.html` (thesis) — `experience.js` is loaded before `lang.js`/`main.js` |
| Old hard-coded values found | `index.html:416` «15+ лет …» (A); `ro/index.html:446` «15+ ani …» (A); docs `FINMENTOR_VISUAL_SYSTEM_2.md`, `REDESIGN_QA_REPORT.md`, `FINMENTOR_CONTENT_RESTORATION_REPORT.md`, `YELLOWTREE_TO_FINMENTOR_PATTERN_MAP.md` mention «15+» (C — historical reports, left as history except the visual-system spec note); `treasury.html` legacy English page has no number (B); no other public page carried a number |
| Old values removed/replaced | both category-A occurrences replaced by the computed span; category-C left as historical record |
| Fallback | static `18+` inside the span, generated by `node scripts/sync-experience-fallback.mjs`, verified by `qa/experience-counter.test.mjs` (fails the build if stale); JS replaces text only when it differs → no layout shift; no-JS shows the verified value; invalid dates never blank the node |
| Time zone | calendar-date rule documented in `experience.js` header and tested (23:59:59 on 31 Jul → 17, 00:00:00 on 1 Aug → 18, local) |
| Test dates | 2026-07-31 → 17 · 2026-08-01 → 18 · 2026-09-24 → 18 · 2027-07-31 → 18 · 2027-08-01 → 19 — all PASS (ISO and local-Date forms) |

## 4. QA

| Check | Result |
|---|---|
| `node qa/run-all.mjs` (canonical, offline) | **103/103 gates PASS**, **3702 assertions**, assertion floors PASS |
| `node qa/experience-counter.test.mjs` | **35 passed, 0 failed** |
| `node qa/content-migration.check.mjs` | 221 text blocks, 62 internal links from `392efde` — **nothing lost** |
| `node scripts/sync-experience-fallback.mjs --check` | all four pages already `18+` |
| `node qa/commercial-polish.test.mjs` | 51 passed (approved step titles retained) |
| Screenshots (Chrome CDP, reduced motion) | 12 pages × 4 widths (1440 / 1280 / 820 / 390) before and after; horizontal overflow 0 on every surface; see §5 |

First run of the suite flagged one real contract (`commercial-polish` Q3 requires the literal
step-3 title); the titles were restored and the suite re-run green. No test contract was loosened.

## 5. Visual evidence

The accepted before/after clips of the touched sections at 1440 / 1280 / 820 / 390 are
recoverable from tag `production-approved-2026-09-24`. The ignored regeneration target is
`qa-evidence/refine-proof-practice-flow/`.

## 6. Unresolved / owner decisions

1. Confirm the career-start date (August 2008) and the Big4 / IFRS line against LinkedIn — not verifiable by automation.
2. Budgeting/Forecasting and Financial Analytics were **not** added to the practice tiles (no verification source beyond the brief's "possible" list). Say the word and they go into tile 02/04 wording.
3. Practice labels on the homepage now read «CFO-контроль» / «Решение собственника» (was «Контроль» / «Решение»); revert is a two-string change if the shorter labels are preferred.
4. The concurrent real-estate-flow edits in the working tree belong to another tool and are not in this branch's commit.

---

## 7. Merge-readiness report (owner candidate, 2026-09-24)

Owner confirmed: finance career start **August 2008**, canonical technical date **`2008-08-01`**.
The counter is kept exactly as implemented. No redesign, no new content, no deploy.

### 7.1 Git state

| Item | Value |
|---|---|
| Production baseline HEAD | `bf3cf0c154eb3f39d24ef9c62f26ca06b296786d` = `origin/redesign/visual-system-2` = current GitHub Pages source |
| Refinement branch | `design/refine-proof-practice-flow` (local only, not pushed) |
| Refinement HEAD | `e29d1b64ddf3116802cba4eec8cbd1e0522262f6` — exactly one commit on top of the baseline |
| Relationship | fast-forward onto `redesign/visual-system-2` (ahead 1 / behind 0, merge-base = baseline) |
| `git status` | 4 tracked files modified, 10 untracked PNGs + `test-results/` — **all belong to the concurrent Real Estate work, none to the refinement** |

### 7.2 Files outside the refinement commit (concurrent Real Estate work)

| File | State | What it is |
|---|---|---|
| `editorial.css` | modified, uncommitted | new `.doc-hero__flow` outline rule for the real-estate decision chain (+29 lines) |
| `real-estate-control-system.html` | modified, uncommitted | adds class `doc-hero__flow` to the hero context line (1 line) |
| `ro/real-estate-control-system.html` | modified, uncommitted | same, Romanian (1 line) |
| `qa/production-layout-regression.spec.mjs` | modified, uncommitted | Chrome executable lookup + `REAL_ESTATE_FLOWS` + new Playwright test «real-estate flow text stays inside its content-driven frame» (+92 lines) |
| `real-estate-flow-{1440,390}-{RU,RO}-after.png` (4 files) | untracked | evidence renders written to the repository root (3.1 MB) |
| `real-estate-launcher-{1440,430,390}-{RU,RO}-before.png` (6 files) | untracked | further evidence renders, appeared 07:52–07:53 while this report was being written |
| `test-results/` (`.last-run.json`) | untracked | Playwright run marker, 07:53 |

Verification performed:
- `git grep` for `doc-hero__flow` and `REAL_ESTATE_FLOWS` across **every local and remote ref**: no hit — these changes are **not part of any commit anywhere**; they exist only in this working tree.
- Not in any stash (the single stash predates this work).
- **The concurrent job was still active at 07:53** (spec file grew from +92 to +104 lines, new PNGs and `test-results/` appeared after the refinement commits). The inventory above is a snapshot at 07:54; re-run `git status` before acting on it.
- Zero file overlap with the refinement commit (`git diff-tree` of `e29d1b6` ∩ `git diff --name-only` = ∅), so the two pieces of work are cleanly separable.
- **They need their own commit before any merge.** Recommended: their owner commits them on a separate branch cut from `bf3cf0c` (e.g. `fix/real-estate-flow-frame`); whether the four root-level PNGs are committed is the owner's call (they would ship in the Pages payload). Nothing was discarded, overwritten or staged.

### 7.3 Automatic experience counter

| Item | Value |
|---|---|
| Source file | `experience.js` (single canonical date, calendar-anniversary rule, browser + CommonJS) |
| Canonical start date | `FINANCE_CAREER_START_DATE = '2008-08-01'` — owner-confirmed |
| Public locations | `index.html` hero trust line · `ro/index.html` hero trust line · `about.html` thesis · `ro/about.html` thesis (each `<span data-experience-years>`, `experience.js` loaded before `lang.js`/`main.js`) |
| Fallback | static `18+` generated by `scripts/sync-experience-fallback.mjs`, verified by `qa/experience-counter.test.mjs` |

### 7.4 Big4 / IFRS wording — review outcome

Exact public wording (unchanged from production): RU `Big4 / IFRS-фундамент` (about.html, tile 06), RO `Fundament Big4 / IFRS` (ro/about.html, tile 06).

Source trace in the repository:
- present in the owner's own initial site upload (`c3d2143`, `105f93b`, 2026-06-20/21, committed under the owner's git identity);
- published continuously since (the v1.1 rendered-text evidence is retained at tag `production-approved-2026-09-24`);
- reviewed in the owner-gated terminology register of 2026-09-07 (`docs/TERMINOLOGY_REVIEW_REGISTER_2026-09-07.*`) as an approved compound term.

Decision: **kept as is** — it is an owner-provided, already-published source; the refinement neither expanded nor reworded it. It has never been independently verified (LinkedIn not machine-readable), so the exact wording above is **flagged for explicit owner confirmation**, not asserted as proven.

### 7.5 Remaining unverified public claims

| Claim | Where | Status |
|---|---|---|
| `Big4 / IFRS-фундамент` / `Fundament Big4 / IFRS` | about.html, ro/about.html tile 06 | owner-provided, published; **owner to confirm exact wording** |
| Everything else in the proof register (§2) | about, hero | owner-confirmed (start date) or already-published copy retained; no new claim introduced |

### 7.6 QA summary

| Check | Working tree (with concurrent files present) | Clean checkout of `e29d1b6` alone |
|---|---|---|
| `node qa/run-all.mjs` | 103/103 gates, 3702 assertions, floors PASS | **103/103 gates, 3702 assertions, floors PASS** |
| `qa/experience-counter.test.mjs` | 35/35 | **35/35** |
| `qa/content-migration.check.mjs` | 221 blocks, 62 links, nothing lost | **221 blocks, 62 links, nothing lost** |
| `scripts/sync-experience-fallback.mjs --check` | all four pages `18+` | **all four pages `18+`; every root `*.js` parses** |
| Rendered surfaces | 48 before / 48 after, overflow 0 | — |

Clean-checkout run: `git worktree add --detach <tmp> e29d1b6` (status empty), then the same commands. The commit is
self-sufficient — the green result does not depend on the concurrent working-tree files.

### 7.7 Verdict

**SAFE TO MERGE once the concurrent Real Estate changes are isolated** (committed on their own branch or
deliberately set aside by their owner). The refinement commit fast-forwards onto
`redesign/visual-system-2`, touches none of the concurrent files, passes the full canonical QA both with
and without them present, and introduces no new public claim beyond the owner-confirmed start date.
Not merged, not pushed, not deployed.
