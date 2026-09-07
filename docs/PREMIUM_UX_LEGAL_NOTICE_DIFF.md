# Premium UX — legal-content diff: current public notice vs Premium UX target

**Date: 2026-08-29. Analysis only. Nothing customer-facing was modified.**

`privacy.html` and `ro/privacy.html` are UNCHANGED. This document compares what they say today
against what the Premium UX notice would say, so the owner and a lawyer can decide what to do about
each difference. It claims no legal approval and makes no recommendation that requires one.

Sources compared:

| Side | Source |
|------|--------|
| CURRENT | `privacy.html` (RU, «Обновлено: 22 июня 2026 г.»), `ro/privacy.html` |
| TARGET | `n8n/src/premium-ux/privacy-notice.js`, rendered to `docs/legal/DRAFT_RU_PRIVACY_NOTICE.md` and `DRAFT_RO_PRIVACY_NOTICE.md` |

Both drafts are marked **DRAFT — NOT LEGALLY APPROVED** and are generated from the gated module, so
the text a lawyer reviews is the text the product renders.

---

## 0. The one conflict that must be resolved before activation

**The current notice says the legal basis is CONSENT. The Premium UX model says it is a
pre-contractual request at the data subject's own initiative.**

They are not interchangeable. Consent is withdrawable at any time and its withdrawal must stop
processing; pre-contractual necessity is not withdrawable in the same way, and the rights section
differs accordingly. Publishing the Premium notice while `privacy.html` says the opposite would
leave two contradictory statements live at the same time about the same processing.

This is a legal decision, not an engineering one. It is listed first because every other row below
is small next to it.

---

## 1. Controller identity

| | |
|---|---|
| **CURRENT** | «Оператор данных — Геннадий Яковлев (FINMENTOR), г. Кишинёв, Молдова.» Named natural person, city only, no street address, no registration number. `index.html` JSON-LD additionally declares an `Organization` named FINMENTOR with `founder` Ghennadi Iacovlev. |
| **TARGET** | Same natural person, taken from the same source, but held in a **template slot** rather than hard-coded. Adds an explicit statement that no separate FINMENTOR legal entity exists: «Отдельного юридического лица FINMENTOR не существует; FINMENTOR — наименование проекта.» |
| **DIFFERENCE** | The target says out loud what the current notice leaves ambiguous. The JSON-LD `Organization` block arguably implies a company where there is none. |
| **STATUS** | **OWNER CONFIRMATION REQUIRED.** Owner decision D6 set `OWNER_INPUT_REQUIRED`; the repository search then found a published identity. The drafts use it and flag it on every page. It has not been adopted as a decision. |

## 2. Controller contact

| | |
|---|---|
| **CURRENT** | `cfo@finmentor.md` for both general contact and data-subject rights. |
| **TARGET** | A template slot, filled in the drafts with the same address. |
| **DIFFERENCE** | None in value. `cfo@finmentor.md` is a business address serving double duty as the privacy contact — workable, but a deliberate choice rather than a default. |
| **STATUS** | Owner confirmation. Also: **`RESIDENTIAL / POSTAL ADDRESS DISCLOSURE = LEGAL REVIEW REQUIRED`** — neither notice publishes a postal address, and whether a natural-person controller must is a question for a lawyer. No address has been invented. |

## 3. Purposes

| | |
|---|---|
| **CURRENT** | Three: contact and consultation; prepare a services proposal; improve the site from anonymised analytics. |
| **TARGET** | Three, narrower and specific to the brief: examine the request; prepare the consultant for the meeting; contact the client about that request. Adds two explicit negatives — not used for advertising, and not used for automated decisions with legal effect. |
| **DIFFERENCE** | The target drops "prepare a services proposal" as a separate purpose and adds the negatives. |
| **STATUS** | Owner decision — is proposal preparation a distinct purpose worth naming? |

## 4. Legal basis

| | |
|---|---|
| **CURRENT** | «Обработка осуществляется на основании вашего согласия… Согласие можно отозвать в любой момент.» |
| **TARGET** | «Обработка необходима для действий, предпринимаемых по вашему запросу до заключения договора.» Stated as substance, with **no article citation** — citing `art. 6(1)(b)` would be a legal claim review has not made. |
| **DIFFERENCE** | See §0. Different basis, different withdrawal rights. |
| **STATUS** | **BLOCKING for activation.** Technical enum stays `PENDING_LEGAL_REVIEW`; the candidate `pre_contractual_request` is server-side only and never rendered. |

## 5. Recipients and processors

| | |
|---|---|
| **CURRENT** | Names them individually and in useful detail: GitHub Pages (hosting), Google (analytics, fonts), an email provider, **n8n**, **Google Sheets** (described as the CRM), **Telegram**, **OpenAI** — with an explicit list of what does and does not reach OpenAI. |
| **TARGET** | Describes processors **by role** — database hosting, automation platform, spreadsheet service, Telegram as delivery — without naming vendors. |
| **DIFFERENCE** | The current notice is **more specific than the target here.** That is a regression in the target, not an improvement. |
| **GAP** | **Supabase is named in neither.** It now holds the G5 replay ledger and the privacy acknowledgement store. It is an unnamed processor in the live notice today, which is a present-tense gap independent of this work. |
| **STATUS** | Recommend the target adopt the current notice's naming discipline and add Supabase. Owner/legal decision on whether to name vendors in a customer notice at all. |

## 6. International transfers

| | |
|---|---|
| **CURRENT** | **Absent.** No transfer section. The named processors are all outside Moldova. |
| **TARGET** | Explicit: infrastructure sits outside the Republic of Moldova, including in the EU and the USA; this constitutes a cross-border transfer. |
| **DIFFERENCE** | The target adds a disclosure the current notice omits entirely. |
| **GAP** | Neither states a **transfer mechanism**. Disclosure and lawfulness are different obligations. |
| **STATUS** | Legal review. The disclosure itself is a strict improvement and is factually true. |

## 7. Retention

| | |
|---|---|
| **CURRENT** | «Мы храним данные ровно столько, сколько необходимо для целей выше, после чего удаляем их. По вашему запросу данные удаляются раньше.» Qualitative only. |
| **TARGET** | An unfinished brief is deleted automatically after **72 hours** — a concrete period matching the TTL actually deployed. A submitted request is kept as long as needed for the work and for evidencing obligations. The acknowledgement record is kept separately as evidence and contains none of the request's content. |
| **DIFFERENCE** | One concrete period where there were none. |
| **GAP** | Retention for a **submitted** request is still qualitative in both. |
| **STATUS** | Legal review for the submitted-request period. The 72-hour statement is already true of the deployed system. |

## 8. Data-subject rights

| | |
|---|---|
| **CURRENT** | Four: information/access, rectification, erasure, withdrawal of consent. |
| **TARGET** | Six: access, rectification, erasure, restriction of processing, objection, portability. No withdrawal-of-consent right, because the target's basis is not consent. |
| **DIFFERENCE** | Restriction, objection and portability added; withdrawal removed. **The removal is a direct consequence of §4 and cannot be decided separately from it.** |
| **STATUS** | Follows the legal-basis decision. |

## 9. Complaint to CNPDCP

| | |
|---|---|
| **CURRENT** | **Absent.** No supervisory authority is named. |
| **TARGET** | «Вы вправе подать жалобу в Национальный центр по защите персональных данных Республики Молдова.» / «Centrul Național pentru Protecția Datelor cu Caracter Personal al Republicii Moldova.» |
| **DIFFERENCE** | The target adds a required element the current notice omits. |
| **STATUS** | Improvement. Legal review on whether the authority's address or contact details must also appear. |

## 10. Required vs optional data

| | |
|---|---|
| **CURRENT** | **Absent** as a statement, though the mini-scan section notes some fields are optional. |
| **TARGET** | Explicit section: providing data is voluntary; without it the request cannot be examined — «консультанту нечего готовить и некуда ответить»; refusal has no other consequence. |
| **DIFFERENCE** | The target adds a required element and states the consequence honestly rather than implying a penalty. |
| **STATUS** | Improvement. |

## 11. Automated processing

| | |
|---|---|
| **CURRENT** | Describes the site's «Финансовый навигатор» as rule-based, collecting no personal data and giving no individual financial recommendations. Describes OpenAI use for an internal analysis plan, on anonymised data only. |
| **TARGET** | States processing is not used for automated decisions producing legal effects for the client. |
| **DIFFERENCE** | The current notice is **more concrete about the AI actually in use**; the target makes the legal statement the current one lacks. Neither is complete alone. |
| **NEW SURFACE** | Premium UX adds **context extraction** from free text. Everything it proposes is `ai_inferred`, cannot skip a question, and is shown for confirmation before use — but no notice currently mentions it. |
| **STATUS** | The target must gain a sentence about extraction before activation. Recorded here rather than written silently. |

## 12. Marketing consent separation

| | |
|---|---|
| **CURRENT** | No marketing consent is requested; no separation is stated. |
| **TARGET** | Explicitly states data is not used for advertising. Marketing consent is **not collected in v1**, and the privacy store has **no column for it** — a column that is always null is a worse record than no column. |
| **DIFFERENCE** | The target states the negative rather than leaving it unsaid. |
| **STATUS** | Consistent. If marketing consent is ever collected it must be a separate, optional, independently-recorded act — never bundled into the acknowledgement. |

---

## Summary

| # | Item | Target vs current | Blocks activation |
|---|------|-------------------|-------------------|
| 1 | Controller identity | clearer, templated | owner confirmation |
| 2 | Controller contact | same value, slot | owner confirmation + address review |
| 3 | Purposes | narrower, adds negatives | no |
| 4 | **Legal basis** | **conflicts** | **YES** |
| 5 | Recipients | **target is weaker**; Supabase unnamed in both | legal review |
| 6 | Transfers | target adds; mechanism missing in both | legal review |
| 7 | Retention | target adds 72 h; submitted period vague in both | legal review |
| 8 | Rights | follows §4 | with §4 |
| 9 | CNPDCP | target adds | no |
| 10 | Required/optional | target adds | no |
| 11 | Automated processing | both partial; extraction undisclosed | **YES**, before activation |
| 12 | Marketing separation | consistent | no |

**Two items must be closed before customer activation: the legal basis (§4) and a disclosure of
context extraction (§11).** One item is a regression to fix in the target before review: processor
naming (§5). Everything else is an improvement or a pre-existing gap.

**Nothing in this document has been applied to `privacy.html` or `ro/privacy.html`.**
