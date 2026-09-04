# GATE 1 — Privacy / Legal: fresh-read audit, corrections, and the verdict

**Date:** 2026-09-04 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Plan:** `FINAL_PRODUCTION_V1_GO_PLAN.md`
**Verdict: GATE 1 = BLOCKED** — one P1, plus owner wording approval. **CUSTOMER RELEASE = NOT AUTHORIZED.**

Everything below was read from the current files and the live tenant. `C4_PRIVACY_RELEASE_GATE.md`
is treated as the release-gate reference, but no approval in it is assumed to still hold: each row
was re-verified against the code that ships.

---

## 1. Inventory of customer-facing privacy / consent statements

| # | Surface | Current wording | Lang | Consent required? | Data submitted? | Linked privacy notice? | Status |
|---|---|---|---|---|---|---|---|
| 1 | `questionnaire.html` consent row | «Я согласен с [Политикой конфиденциальности], [Условиями использования материалов] и обработкой данных для подготовки консультации.» | RU | **Yes** — `q_consent` is in `REQUIRED`; submit returns early without it | Yes: name, company, e-mail, Telegram, preferred channel, answers | Yes — `privacy.html` + `terms.html`, inside the consent row | **PASS** |
| 2 | `questionnaire.html` submit line | «Отправляя форму, я подтверждаю, что ознакомился с [Политикой конфиденциальности]…» | RU | reinforces #1 | — | Yes | **PASS** |
| 3 | `questionnaire.html` AI notice | «Ответы… используются FINMENTOR для подготовки предварительного разбора… Финальные выводы… после анализа данных и экспертной проверки.» | RU | no | — | n/a | **PASS** |
| 4 | `ro/questionnaire.html` consent row | «Sunt de acord cu [Politica de confidențialitate], [Condițiile de utilizare]… pentru pregătirea consultației.» | RO | **Yes** — same `q_consent` gate | Same as #1 | Yes — `privacy.html` + `terms.html` (resolve inside `/ro/`) | **PASS** |
| 5 | `ro/questionnaire.html` submit line + AI notice | Romanian equivalents of #2 and #3 | RO | as above | — | Yes | **PASS** |
| 6 | `privacy.html` §2 purposes, §4 analytics, §8 processors + automation | Purpose «для подготовки консультации»; analytics separately consent-gated; n8n / Google Sheets / Telegram / OpenAI named, anonymised data only | RU | n/a (policy) | n/a | is the notice | **PASS** — but does not name Supabase, and does not state human review (see §3) |
| 7 | `ro/privacy.html` | Romanian policy, same structure | RO | n/a | n/a | is the notice | **PASS** — same two gaps |
| 8 | Mini App submit screen (`app-premium/content.js` `PRIVACY`) | «FINMENTOR использует указанные вами данные для рассмотрения обращения, подготовки консультанта и связи с вами.» + «Передавая brief, вы подтверждаете, что ознакомились с информацией об обработке персональных данных.» | RU only | No checkbox — the submit action **is** the acknowledgement (spec §18) | Yes: role, company, scale, task, context, contact channel + value, Telegram id | **Links exist but go nowhere** — `a.href = '#'` (`app-premium/app.js:947`) | **DEFECT — P1** |
| 9 | Mini App entry screen privacy affordance | «Конфиденциальность и данные» with a lock icon | RU only | no | no | **Not a link at all** — a `div`/`span` with no handler (`app.js:446-449`) | **DEFECT — P1** (same defect) |
| 10 | Layered notice module `n8n/src/premium-ux/privacy-notice.js` (layer 1 concise + layer 2, ten Law 195/2024 elements) | Full RU + RO text | RU + RO | n/a | n/a | is the notice | **OWNER DECISION** — cannot render: `controller_full_name` and `controller_privacy_email` are `OWNER_INPUT_REQUIRED`, and the module is **not inlined into any live workflow** |
| 11 | Concierge privacy lines (`n8n/src/premium-ux/branches.js` `PRIVACY`) | «FINMENTOR использует указанные вами данные…» + acknowledgement line | **RU only** — `branches.js` has no locale handling at all | acknowledgement by action | Yes (brief) | Link labels only | **OWNER DECISION** — RO absent; owned by **Gate 3**, recorded here as a release dependency, not corrected in this gate |
| 12 | Customer result screen (CLIENT_READY) | Curated result only — 12 keys | RU / RO labels | n/a | no new collection | n/a | **PASS** — minimisation proven, `client-result-contract` 61 checks |
| 13 | Cookie / analytics banner (`analytics.js`, `finmentor_cookie_consent`) | accept / deny, no Google script before a choice | RU + RO | **Yes**, separate from lead consent | analytics only | `privacy.html` §4 | **PASS** |

---

## 2. Minimum v1 privacy contract

| | Question | Answer as built |
|---|---|---|
| A | Data collected **before** contact consent? | None transmitted. The questionnaire builds its payload only after `validate()` passes, and consent is a required entry in that table. Analytics is separately gated and loads no Google script before a choice. |
| B | Data collected **after** consent? | Name, company, e-mail, Telegram handle, preferred channel and language; questionnaire answers (turnover band, employees band, systems, pains, goal, timeline); Telegram user id in the Mini App path. |
| C | Optional vs required? | Required: contact identity (name, company, one channel), the financial-maturity radios, and consent. Optional: the multi-select pain/expense lists, free-text context, the two secondary acknowledgements (`q_consent_docs`, `q_consent_plan`). |
| D | Stated purpose? | Review the request, prepare the consultant, contact the person, and produce the preliminary analysis. Consistent across site, questionnaire and Mini App. |
| E | Affirmative and unambiguous? | Site: yes — an unchecked, non-prefilled checkbox that blocks submission. Mini App: acknowledgement by deliberate submit action, which is affirmative, but see the P1 — the information being acknowledged is unreachable. |
| F | Privacy link visible before contact data is sent? | Site: **yes**, twice (consent row and submit line), both languages. Mini App: **no — this is the P1.** |
| G | Diagnostic usable without consenting to contact? | By contract the Financial X-Ray is a lead-generating diagnostic: contact is part of it, and there is no anonymous-result surface. No surface transmits anything before consent, so there is nothing that fails here. |
| H | Analytics separate from lead-contact consent? | Yes. Different storage key, different mechanism, and `analytics.js` never reads `q_consent`. Proven by the new gate. |
| I | Sensitive or unnecessary data collected? | No special-category data. Financial answers are banded ranges, not statements. The questionnaire explicitly tells people **not** to send confidential documents at this stage. |
| J | RU / RO semantics equivalent? | Site and questionnaire: **yes**, verified field-by-field by the new gate. Mini App and Concierge: **no** — Concierge copy is RU-only. Owned by Gate 3. |

---

## 3. Owner wording decisions

### 3.1 The paragraph that still needs approval (carried from `C4_PRIVACY_RELEASE_GATE.md`, re-verified)

Appears in three places: end of `privacy.html` §8, end of `ro/privacy.html` §8, and as a third line
of the Mini App privacy screen (`privacy-notice.js`, both locales).

Both facts in it were re-checked against the code and are accurate: the Supabase privacy record
carries only `submission_key`, `cycle_id`, `privacy_notice_version`, `privacy_locale` and timestamps
— no personal data (`privacy-record.js`); and nothing reaches a customer before the owner's review
tap (`xray-analysis` review authority, 143 checks).

**RU FINAL**

> Результаты Финансового рентгена бизнеса (Financial X-Ray) и план действий на 30 дней готовятся
> автоматизированно с участием искусственного интеллекта на основе обезличенных ответов и являются
> предварительным управленческим анализом, а не аудитом и не индивидуальной финансовой
> консультацией. Итоговые экспертные рекомендации FINMENTOR формируются после проверки человеком.
> Технические записи об обработке (без персональных данных) хранятся в Supabase (ЕС).

**RO FINAL**

> Rezultatele Testului de sănătate financiară FINMENTOR și planul de acțiune pentru 30 de zile sunt
> pregătite automatizat, cu ajutorul inteligenței artificiale, pe baza răspunsurilor anonimizate și
> reprezintă o evaluare managerială preliminară, nu un audit și nu o consultanță financiară
> individuală. Recomandările finale ale experților FINMENTOR sunt formulate după verificare umană.
> Înregistrările tehnice privind prelucrarea (fără date cu caracter personal) sunt stocate în
> Supabase (UE).

### 3.2 Controller identity — two values only

`privacy-notice.js` refuses to render while these are placeholders, so the product cannot show a
customer a notice with `OWNER_INPUT_REQUIRED` in it even by accident. The controller is a natural
person in the Republic of Moldova (owner decision, 2026-08-29); the name and address were left open.

    controller_full_name     = OWNER INPUT REQUIRED
    controller_privacy_email = OWNER INPUT REQUIRED

Nothing here can be inferred: inventing a company name, a registration number or an address would be
a fabricated legal record.

### 3.3 Retention period — one owner decision

`idempotency-receipt.js` records it plainly: *"OWNER INPUT — no canonical FINMENTOR retention policy
defines one."* The corrected notice (§4) therefore states only what is true and does not name a
period. If the owner wants a period stated to customers, it must be a number the owner will keep.

### 3.4 LEGAL REVIEW REQUIRED — one question

> Is `pre_contractual_request` (Law 195/2024 art. 6(1)(b) — a step taken at the data subject's own
> request before a contract exists) the correct legal basis for processing a consultation brief, or
> must the basis be consent?

Until answered, records carry `PENDING_LEGAL_REVIEW`. The value is server-side only: it is never
sent to the client and never named in any text a customer reads, which is why this question does not
by itself block the wording above.

---

## 4. Correction made in this gate

**The notice claimed a deletion that does not happen.** The retention paragraph said an unfinished
brief «удаляется автоматически через 72 часа» / «se șterge automat după 72 de ore», and that a
transmitted request is deleted after the working period.

Neither mechanism exists. The 72-hour TTL **expires** a session — an expired brief can no longer be
opened, edited or submitted (`premium-ux-ttl`, 11 checks) — and no deletion job exists anywhere in
the stack; no retention period is even defined. A privacy notice describing a deletion that never
runs is the one failure mode such a document must not have, so the text now states the expiry that is
real and keeps deletion as a **right the person can exercise**, which the controller can honour by
hand today.

Two checks were added to `premium-ux-privacy-notice.test.mjs` (24 → 26) so the false claim cannot
return. No live workflow was touched: the notice module is not inlined into any live workflow, and
the corrected text will ship with whatever deploy fills the controller identity.

---

## 5. Data / retention check

| Item | Where it actually lives | Classification |
|---|---|---|
| Identity / contact fields | Google Sheets Pipeline row (CRM); repeated in the owner's Telegram alert | **RELEASE ACCEPTABLE** — disclosed in `privacy.html` §8; owner-only destinations |
| Questionnaire answers | Pipeline row; anonymised subset into the AI prompt; `XRay_Analysis` tab | **RELEASE ACCEPTABLE** — disclosed; no special-category data |
| Raw `request_id` | Pipeline / idempotency receipts, internal only | **RELEASE ACCEPTABLE** — proven excluded from the customer contract (`client-result-contract` FORBIDDEN list) |
| X-Ray analysis | `XRay_Analysis` tab: `analysis_json`, review token, confidence, fabrication flags | **RELEASE ACCEPTABLE** — only the 12 curated keys can reach a customer |
| Telegram owner alerts | Name, company, scale band, contact channel, zone; no raw AI, no token, no prompt | **RELEASE ACCEPTABLE** — owner-only chat, minimised, proven by the owner-card gates |
| Privacy acknowledgement record (Supabase) | `submission_key`, `cycle_id`, notice version, locale, timestamps | **RELEASE ACCEPTABLE** — carries no personal data by construction |
| 72-hour session TTL | Expiry of usability; the row is **not** deleted | **RELEASE ACCEPTABLE** — now stated accurately (§4) |
| Automated deletion / retention enforcement | **Not implemented anywhere** | **POST_GO_HARDENING** — with the period itself an **OWNER DECISION** (§3.3) |

Outbox / Cloud Run / HMAC v2 / Graph email were not implemented and remain post-GO; nothing in this
gate proved any of them P1.

---

## 6. Security / privacy negative checks

| Invariant | Proof | Result |
|---|---|---|
| No secrets exposed to customer | `miniapp-gateway` 30, `website-contract` 75 | PASS |
| No internal prompt / model / review token exposed | `client-result-contract` 61 (explicit FORBIDDEN list) | PASS |
| No raw internal analysis in CLIENT_READY | same, plus `xray-analysis` 143 | PASS |
| RU owner / client data boundary | `ai-safe-projection` 52, `lead-intake-trust` 43, `command-center-auth` 43 | PASS |
| RO owner / client data boundary | same modules, locale-independent; owner console proven to carry no RO free text | PASS |
| No contact data sent without explicit consent | **new** `privacy-release-gate` — consent in `REQUIRED`, unchecked box unfilled, submit returns early, payload built only after the guard, both languages | PASS |
| Diagnostic usable where contact consent is optional by contract | no such surface exists; nothing transmits pre-consent | PASS |
| No PII in GA4 payloads | **new** `privacy-release-gate` — closed 8-key allow-list, unlisted keys dropped, e-mail/phone redaction, 100-char cap, no unfiltered `gtag` call | PASS |

Two release-critical invariants had **no test at all** before this gate: consent gating and the
analytics allow-list. Either could have been deleted in one line with the whole suite staying green.
`qa/privacy-release-gate.test.mjs` (25 checks) closes both, reading the shipped files rather than
restating them.

---

## 7. Verdict

    GATE 1 — PRIVACY / LEGAL = BLOCKED

    OPEN P0 = 0
    OPEN P1 = 1
    OWNER DECISIONS REQUIRED = 4
    LEGAL REVIEW REQUIRED = 1

**The single P1.** In the Mini App — the surface that collects role, company, scale, task, contact
channel and Telegram id — no privacy information is reachable. The submit screen renders its two
links as `a.href = '#'`, and the entry-screen affordance «Конфиденциальность и данные» is not a link
at all. The layered notice exists and is complete in both languages, but it is not wired into the app
and not inlined into any live workflow. A person is therefore asked to acknowledge information they
cannot open.

Not fixed in this gate on purpose: the fix requires choosing what those links open — the public
policy pages, or the in-app layer-2 notice, which cannot render until the controller identity exists.
That is a decision about which document a customer is sent to, which is the owner's to make, not the
engineer's. It is small work once decided.

No customer is exposed today: Session and Submit are both `RELEASE_MODE = "OWNER_ONLY"` and the Mini
App host is still the owner-only UAT build.

**The four owner decisions:** controller full name · controller privacy e-mail · the §3.1 paragraph
(Supabase (EU) processor wording and the human-review commitment) · the Mini App privacy link target.

**Gate 1 closes when** those four are answered, the link is wired, and this file records the proof.
