# FINMENTOR — Product language standard (RU / RO)

**Status:** adopted 2026-09-03 for the Production Completion Program v1.
**Scope:** customer-facing and owner-facing copy only. Technical identifiers stay English.

## 0. What never changes

`lead_id`, `request_id`, `app_session_id`, `cycle_id`, `submission_key`, every JSON field name,
every Google Sheets column name, every n8n workflow id and node name, every GA4 event name,
every API field, the internal constants `GREEN / YELLOW / ORANGE / RED / UNKNOWN`,
`HOT / WARM / COLD / INCOMPLETE`, `AI_DRAFT / OWNER_REVIEW / CLIENT_READY`, and the pipeline
stage constants. Renaming any of these is a technical change, not a copy change, and needs
its own migration.

## 1. RU principle

Professional economic Russian first. An English term may appear in parentheses on the first
meaningful occurrence in a given text, never afterwards.

Correct: «Движение денежных средств (Cash Flow) … далее — движение денежных средств».
Wrong: «Cash Flow» everywhere.

| Concept | RU (first occurrence) | RU (afterwards) |
|---|---|---|
| Financial X-Ray | Финансовый рентген бизнеса (Financial X-Ray) | Финансовый рентген |
| Financial Health | Финансовое состояние бизнеса (Financial Health) | Финансовое состояние бизнеса |
| Financial Health Check | Комплексная финансовая диагностика (Financial Health Check) | Комплексная финансовая диагностика |
| Executive Summary | Резюме для собственника (Executive Summary) | Резюме для собственника |
| Financial Maturity | Зрелость финансового управления (Financial Maturity) | Зрелость финансового управления |
| Risk Map | Карта финансовых рисков (Risk Map) | Карта финансовых рисков |
| Top Risks | Ключевые финансовые риски | — |
| Data Gaps | Недостающие данные для анализа | — |
| Cash Flow | Движение денежных средств (Cash Flow) | Движение денежных средств |
| Cash Flow Forecast | Прогноз движения денежных средств | — |
| P&L | Управленческий отчёт о прибылях и убытках (P&L) | Управленческий P&L допустим после первого раза |
| Working Capital | Оборотный капитал (Working Capital) | Оборотный капитал |
| Accounts Receivable | Дебиторская задолженность | — |
| Accounts Payable | Кредиторская задолженность | — |
| Margin | Маржинальность | — |
| Profitability | Рентабельность | — |
| Liquidity | Ликвидность | — |
| Management Reporting | Управленческая отчётность | — |
| KPI Dashboard | Панель ключевых показателей | — |
| Management Priorities | Приоритеты финансового управления | — |
| 30-Day Action Plan | План финансовых действий на 30 дней | — |
| Next Action | Следующее управленческое действие | — |
| Discovery Call | Диагностическая встреча (Discovery Call) | Диагностическая встреча |
| Follow-up | Повторный контакт | — |
| Won | Сделка заключена | — |
| Lost | Сделка не состоялась | — |
| AI Draft | Предварительный анализ ИИ | — |
| Human Review | Экспертная проверка FINMENTOR | — |
| Client Ready | Готово для клиента | — |

### RU zone labels (customer-facing)

| Code | Label | Meaning line |
|---|---|---|
| GREEN | ЗЕЛЁНАЯ ЗОНА | Устойчивый финансовый контроль |
| YELLOW | ЖЁЛТАЯ ЗОНА | Отдельные зоны требуют усиления |
| ORANGE | ОРАНЖЕВАЯ ЗОНА | Существенные пробелы в финансовом управлении |
| RED | КРАСНАЯ ЗОНА | Высокий риск потери финансового контроля |
| UNKNOWN | ЗОНА НЕ ОПРЕДЕЛЕНА | Недостаточно данных для оценки |

### RU pipeline stage labels (owner-facing)

| Constant | RU |
|---|---|
| NEW | Новое обращение |
| CONTACT | Контакт установлен |
| QUALIFIED | Квалифицирован |
| MEETING | Встреча |
| PROPOSAL | Коммерческое предложение |
| NEGOTIATION | Переговоры |
| WON | Сделка заключена |
| LOST | Сделка не состоялась |

## 2. RO principle

Natural professional Romanian, formal register (polite plural: «Începeți», «dumneavoastră»,
«dvs.»). This is the register already used across `/ro/` (audited 2026-09-03: zero informal
imperatives, 18 occurrences of «dvs.»), so it stays. Never translate the Russian mechanically.

**«Radiografia Financiară FINMENTOR» is retired as the primary product name.**

| Concept | RO |
|---|---|
| Primary product (Financial Health Test) | Test de sănătate financiară FINMENTOR |
| Quick version | Test rapid de sănătate financiară |
| Result | Evaluare financiară preliminară |
| Deep service (Financial Health Check) | Diagnostic financiar complet |
| Page headline | Cât de sănătos este sistemul financiar al afacerii dumneavoastră? |
| Financial Health | Sănătatea financiară a afacerii |
| Financial Maturity | Maturitatea managementului financiar |
| Risk Map | Harta riscurilor financiare |
| Top Risks | Riscurile financiare principale |
| Data Gaps | Date lipsă pentru analiză |
| 30-Day Action Plan | Plan de acțiune financiară pentru 30 de zile |
| Executive Summary | Rezumat pentru proprietar |
| Management Priorities | Priorități de management financiar |
| Cash Flow | Flux de numerar (Cash Flow) on first occurrence, then Flux de numerar |
| P&L | Cont managerial de profit și pierdere (P&L) |
| Accounts Receivable | Creanțe |
| Accounts Payable | Datorii către furnizori |
| Working Capital | Capital circulant |
| Liquidity | Lichiditate |
| Profitability | Rentabilitate |
| Management Reporting | Raportare managerială |
| KPI Dashboard | Panou de indicatori-cheie |
| Next Action | Următoarea acțiune |
| Discovery Call | Întâlnire de diagnostic (Discovery Call) |
| Follow-up | Contact ulterior |
| Won | Contract semnat |
| Lost | Fără rezultat |
| AI Draft | Analiză preliminară AI |
| Human Review | Verificare de specialist FINMENTOR |
| Client Ready | Pregătit pentru client |

### RO zone labels (customer-facing)

| Code | Label | Meaning line |
|---|---|---|
| GREEN | ZONA VERDE | Control financiar stabil |
| YELLOW | ZONA GALBENĂ | Anumite zone necesită consolidare |
| ORANGE | ZONA PORTOCALIE | Lacune semnificative în managementul financiar |
| RED | ZONA ROȘIE | Risc ridicat de pierdere a controlului financiar |
| UNKNOWN | ZONĂ NEDETERMINATĂ | Date insuficiente pentru evaluare |

### RO pipeline stage labels (owner-facing)

| Constant | RO |
|---|---|
| NEW | Solicitare nouă |
| CONTACT | Contact stabilit |
| QUALIFIED | Calificat |
| MEETING | Întâlnire |
| PROPOSAL | Ofertă comercială |
| NEGOTIATION | Negociere |
| WON | Contract semnat |
| LOST | Fără rezultat |

## 3. Where the standard is applied

- `n8n/src/xray-analysis/` — the AI analysis prompt and the owner/customer renderers read the
  labels from `n8n/src/xray-analysis/labels.js`, which is the machine-readable copy of §1–§2.
- `/ro/` pages, `i18n-ro.js`, `ro/runtime-strings.ro.json` — product naming (C3.6).
- Mini App result screen and Bot notifications (C3.4 / C3.5).
- Owner alerts (C1.7) and Daily Digest labels (C2.4).
