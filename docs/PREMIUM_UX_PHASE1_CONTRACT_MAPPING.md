# Premium UX — Phase 1: contract mapping and gap analysis

**READ-ONLY. Nothing was implemented, deployed or modified.**

Design authority: `PREMIUM_UX_FINAL_RU_SPEC.md`, `PREMIUM_UX_IMPLEMENTATION_HANDOFF.md`, closure
commit `fcfd56e`. Infrastructure gates preserved as read-only facts: Gateway = FINAL GO,
Lead Intake = GO, F17 = CLOSED, `Bot_Sessions` ends at `AZ = financial_zone`, G5 semantics closed.

Everything below was read fresh from the deployed artifacts, the live `MiniApp_App_Sessions` data
table and the live CRM workbook export.

---

## 0. The finding that shapes everything else

**The deployed Gateway is bootstrap-only.** `nTZHLbv2KFggdhh5` is 13 nodes behind one endpoint,
`POST /webhook/finmentor-miniapp-gateway`:

    Gateway Webhook → Verify InitData → IF Verified → Derive Replay Key → G5 Replay Claim
                    → Claim Verdict → IF Claim Won → Build App Session → Create App Session
                    → Respond Bootstrap OK | Rejected | Replay Refused | Store Unavailable

There is **no** `PUT /miniapp/session` (draft) and **no** `POST /miniapp/submit` deployed. Both are
specified in the Gateway contract (§7, §9) and both exist as **proven offline logic** in
`n8n/src/miniapp-submit/` (`submit-contract.js` 819 lines, `submit-handler.js`,
`recovery-adapter.js`), gated by `qa/miniapp-submit.test.mjs` at 137 assertions, with every
dependency injected rather than imported.

So the Mini App today can authenticate and mint a session, and can do nothing else. This is the
largest work item — and it is **G3 (wire proven modules), not G5**, because the logic is written,
tested and injection-shaped precisely so it can be dropped into nodes.

---

## A. Approved UX → current contract matrix

Legend for *source of truth*: **BS** = `Bot_Sessions` (authority), **AS** = `MiniApp_App_Sessions`
(binding + draft, TTL 1800 s), **PL** = Pipeline (CRM read surface), **RJ** = `raw_json`
(durable capture, not queryable).

| # | Product field | Current physical field | Source of truth | Durability | Supported today | Normalisation | Loss / overwrite risk | Schema change required |
|---|---|---|---|---|---|---|---|---|
| 1 | `company_name` | BS `W=company` · PL `L=company` | BS | durable | **yes** | `company_norm` in Dedup Guard | none | **no** |
| 2 | `business_activity` | PL `S=industry_category` (via `intake.company_profile.industry_category`) | PL | durable | **yes** | none | none | **no** |
| 3 | `role` | PL `N=role` (via `client.role`) | PL | durable | **partly** — Lead Intake and Pipeline carry it; **no** `Bot_Sessions` column; the Mini App projection never sends it | none | dropped by the current Mini App projection | **no** (wiring only) |
| 4 | `turnover_band` | BS `O=turnover_range` · PL `T=turnover_range` | BS + PL | durable | **yes** | none | none | **no** — but the *vocabulary* changes (6 new bands) |
| 5 | `objective` | BS `M=selected_service` · PL `Y=work_interest` | BS + PL | durable | **yes** | none | none | **no** — vocabulary changes (8 labels) |
| 6 | `problem` | BS `P=main_pain` · PL `V=main_pain`, `W=selected_problems` | BS + PL | durable | **yes** | negation guard (`isNegative`) | none | **no** |
| 7 | `problem_free_text` | BS `X=free_text_request` · RJ | BS | durable | **yes** | 500-char cap | none | **no** |
| 8 | `desired_outcome` | PL `X=selected_goals` — semantically correct and **currently unused** by the Mini App path | PL | durable | **adaptable** | `joinArray` | none if mapped | **no** (reuse `selected_goals`) |
| 9 | `desired_outcome_free_text` | RJ only (Другая задача → *Опишу ожидаемый результат сам*) | RJ | durable, not queryable | **no first-class** | none | readable only by parsing `raw_json` | **1 column, or append into `selected_goals`** |
| 10 | `current_setup[]` | **none.** RJ captures it | RJ | durable, not queryable | **no first-class** | `joinArray` pattern exists | not lost; invisible to the CRM and the brief | **1 column recommended** |
| 11 | `decision_horizon` | BS `Q=urgency` · **not written to Pipeline at all** | BS | durable in BS, **absent from the CRM row** | **partly** | negation guard | **lost from the CRM row** — `Build Pipeline Row` emits no `urgency` key and the Pipeline header has no such column | **1 column** |
| 12 | `documents` | PL `Z=documents_status`, `AA=selected_documents`, `AL=documents_requested_at` — **text descriptors only** | PL | durable (text) | **no file capability anywhere in the stack** | none | files cannot be stored at all | **file store + reference column(s)** |
| 13 | `contact_channel` | **none.** Inferable from which of phone/email/telegram is populated; `AB=preferred_meeting_format` is the nearest existing column | — | — | **derivable** | none | none if derived | **no** (derive) or 1 column |
| 14 | `contact_value` | BS `T=contact_phone`, `U=contact_email` · PL `O=email`, `P=phone`, `Q=telegram` | BS + PL | durable | **yes** | `normEmail` / `normPhone` / `normTelegram` | none | **no** |
| 15 | `important_context` | **none.** `X=free_text_request` is taken by `problem_free_text`. RJ captures it | RJ | durable, not queryable | **no first-class** | none | not lost; absent from the brief without parsing `raw_json` | **1 column** |
| 16 | `locale` | BS `G=language` · Lead Intake `client.language` → `language` · Gateway bootstrap already returns `locale` | BS | durable | **yes** | defaults `ru` | none | **no** |

### Layer-by-layer

- **A. Telegram / `Bot_Sessions`** — 52 columns `A:AZ`, authority for identity, cycle, consent and
  canonical `lead_id`. Frozen by F17: **no column may be added.** It has no home for
  `desired_outcome`, `current_setup[]`, `important_context` or per-field provenance.
- **B. `MiniApp_App_Sessions`** — live, 10 columns: `app_session_id`, `telegram_user_id`, `chat_id`,
  `cycle_id`, `replay_key`, `state`, `created_at`, `expires_at`, `updated_at`, **`draft_json`**.
  `draft_json` is an unconstrained string and is the natural home for the whole draft *and* its
  provenance with **zero schema change**. TTL is 1800 s.
- **C. Gateway bootstrap** — returns `{ ok, app_session_id, expires_at, locale }`. Unchanged and
  sufficient. `cycle_id` is deliberately empty at bootstrap and resolved server-side at submit.
- **D. Mini App draft** — contract §7 exists; **not deployed**.
- **E. Submit contract** — `submit-contract.js` whitelists a *strict* answer vocabulary
  (`sector/turnover/cash/profit/treasury/kpi/pain/urgency` with fixed values) and projects into a
  Lead Intake envelope. The new UX vocabulary is entirely different, so the schema constant and
  the projection change; the mechanism does not.
- **F. Lead Intake transport** — `Normalize + Score Lead` reads a wide set of nested paths
  (`client`, `answers`, `intake.*`, `business_profile`, `financial_system`, `main_pain`, `meta`)
  and captures the whole incoming payload into `raw_json` (45 000 chars). **No Lead Intake change
  is required to *receive* the new fields**; only to surface them in the CRM row.
- **G. Pipeline / CRM** — 67 physical columns `A:BO`. `Save to Pipeline` writes **59** of them with
  `mappingMode: defineBelow`, so the new-lead path cannot append a column by accident. The merge
  path (`Update Pipeline (Merge)`) uses `autoMapInputData` and **is** exposed to F16 column-append
  if a new key reaches it.

---

## B. State-machine mapping

Existing model: `Get Bot Session` (Concierge) owns cycle semantics; the Gateway owns the app
session; `submit-handler.js` owns the submit state machine (`draft → submitting → submitted`,
`submitted` terminal).

| State | Allowed input | Write / update | Next state | Skip rule | Recovery | Terminal |
|---|---|---|---|---|---|---|
| `TG_ENTRY` | `/start`, menu tap, free text | none (read) | `TG_CHOICE` | — | re-render | no |
| `TG_FREE_TEXT` | free text | BS `free_text_request` | `MA_BOOTSTRAP` | carried into Problem | re-ask | no |
| `MA_BOOTSTRAP` | `init_data` | G5 claim + AS insert | `CTX_COMPANY` or `RESUME` | — | 401/409/503 per contract | no |
| `RESUME` | resume / new request | none | `<first unanswered>` \| `NEW_REQUEST` | resumes at the first gap | bootstrap again | no |
| `NEW_REQUEST` | explicit action | BS cycle rotate + `archiveLead()` | `CTX_COMPANY` | clears qualification, keeps identity/contact | — | no |
| `CTX_COMPANY` | name, activity, scale | AS `draft_json` | `OBJECTIVE` | role skipped when carried from Telegram | re-enter | no |
| `OBJECTIVE` | 1 of 8 | AS `draft_json` | `PROBLEM` | never skipped | re-enter | no |
| `PROBLEM` | card \| free text | AS `draft_json` | `OUTCOME` | never skipped | re-enter | no |
| `OUTCOME` | 1 of set | AS `draft_json` | `SETUP` | never skipped | re-enter | no |
| `SETUP` | multi-select | AS `draft_json` | `HORIZON` | never skipped | re-enter | no |
| `HORIZON` | 1 of 5 | AS `draft_json` | `DOCUMENTS` | never skipped | re-enter | no |
| `DOCUMENTS` | attach \| continue without | AS `draft_json` (+ file refs) | `CONTACT` | optional | re-enter | no |
| `CONTACT` | channel + optional context | AS `draft_json` | `REVIEW` | channel skipped when Telegram is the known channel | re-enter | no |
| `REVIEW` | передать \| изменить \| добавить | none | `SUBMIT` \| `EDIT` | — | re-render | no |
| `EDIT` | pick one item | AS `draft_json` | **`REVIEW`** | returns directly; never restarts | re-render | no |
| `SUBMIT` | primary CTA | BS consent stamp → Lead Intake → BS `lead_id` | `SUCCESS` \| `FAILURE` | — | `SUBMIT_UNRESOLVED` → recovery adapter | no |
| `SUCCESS` | «Вернуться в Telegram» | AS `state = submitted` | `TG_COMMITTED` | — | — | **yes** |
| `FAILURE` | retry \| back to review | none | `SUBMIT` \| `REVIEW` | draft preserved | idempotent retry | no |
| `TG_COMMITTED` | append info \| explicit new request | append → committed request; new → `NEW_REQUEST` | `TG_COMMITTED` \| `NEW_REQUEST` | no requalification | — | **yes until explicit new request** |

### The five proofs

1. **`/start` must not silently create a new cycle after successful submission — FAILS TODAY.**
   `Get Bot Session` reads `const isStart = text === '/start'; if (isStart) reset = 'start';`
   unconditionally. A `/start` after a committed lead archives `lead_id`, clears consent and all
   qualification, and shows the menu — silently. This is a **direct contradiction** with the new
   rule and is the one genuine state-machine gap (**G2**).
2. **Unfinished draft can resume — PARTIAL.** `draft_json` exists but nothing writes it (no draft
   endpoint), and the app session expires after **1800 s**. Resume beyond 30 minutes has no store.
3. **Explicit New Request rotates the cycle — HOLDS.** `isRestart` (a finished cycle) and
   `hasNoCycle` already mint a new `cycle_id` and call `archiveLead()`. The mechanism is correct;
   only its *trigger* must become explicit rather than `/start`.
4. **Edit returns directly to Review — NEW, no conflict.** Purely a Mini App concern; no server
   state involved (**G1/G2**).
5. **Retry does not create a second lead — HOLDS.** Enforced twice: `IF Lead Already Sent` in the
   Concierge, and `submit-handler.js` resolving server state before any second Lead Intake call,
   with `submitted` terminal and `NEVER_BACKFILL`.
6. **Post-submit append belongs to the committed request — NOT SUPPORTED.** Nothing can attach
   information to a committed lead today. Pipeline has `comment` and `owner_note`, both operator
   fields, and the only update path is `Update Pipeline (Merge)` on the dedup-merge branch.

---

## C. Storage / source-of-truth map

    identity, cycle, consent, canonical lead_id   → Bot_Sessions        (authority, frozen A:AZ)
    app session binding + draft + provenance      → MiniApp_App_Sessions (TTL 1800 s, draft_json)
    full submitted payload                        → Pipeline raw_json via Lead Intake (45 000 chars)
    consultant-readable brief fields              → Pipeline columns     (67 physical, 59 written)
    replay key                                    → Supabase G5          (closed, untouched)

Bot_Sessions remains the authority; the app-session store must not become a second CRM.

---

## D. Smart-skip / provenance model

The rule needs three things per field: **value**, **source**, **confirmation status**.

- **Nothing today records source or confirmation for any field.** Bot_Sessions stores values only;
  the nearest existing provenance concept is `provenance_trusted` — a whole-request boolean for the
  authenticated internal route, not per-field.
- **`draft_json` can carry all three with no schema change**, e.g.
  `{ "field": { "value": …, "source": "telegram|user|carried", "confirmed_at": … } }`. It is an
  unconstrained string, already in the live table, already contract-bound to be
  "size-limited and schema-whitelisted" (§7).
- **Post-submit, provenance survives in `raw_json`** (the whole incoming payload is captured), so
  nothing is lost — but it is not queryable and does not reach the brief.
- **Minimum gap:** a declared provenance sub-schema inside `draft_json`, plus the decision whether
  provenance must survive into the CRM. If it must, that is one column (JSON) or nothing at all if
  `raw_json` is accepted as the audit surface. **G3** either way.

Inference must never skip a question — nothing in the current stack infers field values, so there
is no existing behaviour to remove.

---

## E. Privacy audit-trail gap

Today: BS `Y=consent`, `AR=consent_cycle_id`, `AS=consent_at`; PL `BA=analytics_consent` (GA only,
already correctly separate); submit sends `intake.consent.privacy_accepted: true` and
`meta.consent: true`.

| Required | Exists | Note |
|---|---|---|
| `privacy_notice_version` | no | must be pinned at acknowledgement time |
| `privacy_notice_shown_at` | no | |
| `privacy_notice_acknowledged_at` | **partly** — `consent_at` is the nearest | today's `consent_at` conflates decision time with notice acknowledgement |
| `privacy_locale` | **derivable** — BS `G=language` | |
| `privacy_legal_basis` | no | |
| `marketing_consent` | no | **must not** be required for submission |
| `marketing_consent_at` | no | |

`Bot_Sessions` cannot take new columns (F17). Options: a new dedicated store, Pipeline columns, or
`raw_json`. For an audit trail that must survive and be produced on request, `raw_json` is not
adequate. **G4**, and the two categories must stay structurally distinct — never one flag.

Notice / policy link source: currently hard-coded `website_url` in the Settings sheet. The links
should come from the same configuration surface, versioned alongside `privacy_notice_version`.

---

## F. Document handling map

- **Upload does not exist anywhere.** A sweep of every production workflow for
  document/file/photo/binary parameters on Telegram or HTTP nodes returns nothing. Pipeline's
  `documents_status` / `selected_documents` / `documents_requested_at` are text descriptors.
- Only references/metadata should reach the CRM — consistent with the existing text columns.
- Upload can be supported **without persisting raw `initData`**: the browser holds `app_session_id`
  only, and the Gateway already resolves identity server-side from it.
- The third-party minimisation copy is **advisory**; no technical enforcement is required in v1
  (and none is feasible without content inspection, which would itself process third-party data).
- No size / count / type limits exist because no upload path exists. `MAX_BODY_BYTES` (16 KB) and
  `MAX_PAYLOAD_BYTES` (32 KB) are JSON ceilings and are unrelated to files.
- Feasible without touching closed infrastructure: an additive endpoint plus a store (the Google
  credential and the Supabase project both already exist). **G4, not a blocker** — and the spec's
  own «Продолжить без материалов» makes a deferred-upload v1 legitimate if the owner prefers it.

---

## G. Meeting Brief map

The brief separates cleanly, and the separation is already structural:

- **CLIENT FACTS** — user-provided / confirmed values, all of which resolve to Pipeline columns
  (existing or the small number proposed below), plus `raw_json` for anything not promoted.
- **FINMENTOR PREPARATION** — *Фокус первой встречи*, a pure deterministic lookup on the selected
  objective (spec §17, eight keys, three lines each). It is a constant table, not a model call, and
  must never become one.

Where it should live: the brief is a **projection**, not a new store. The repo already has the
pattern — `n8n/src/miniapp-readmodel/projection.js` with `mirror-helper.js`, authority-first
(Bot_Sessions commits before the derived read model is touched). The consultant brief belongs
there, rendered from Pipeline + the objective→focus constant. No new architecture.

---

## H. Current-Setup multi-select

- Pipeline already carries multi-value text columns written from arrays via `joinArray`:
  `selected_problems`, `selected_goals`, `selected_documents`. The pattern is proven and
  deterministic (`'; '`-joined).
- There is **no** semantically correct existing column for *current setup*. Flattening it into
  `selected_documents` or `work_interest` would be exactly the silent ambiguity to avoid.
- **Minimal compatible representation:** one new Pipeline column `current_setup`, written from the
  existing `joinArray` pattern with the eleven canonical labels. Order canonical (spec §10 order),
  never client order, so the value is comparable across leads.

---

## I. Branch coverage

The mapping is vocabulary-only: `objective` → BS `selected_service` / PL `work_interest`, both
free-text columns with no enum constraint at the storage layer. All eight map with **no
consolidation, no new branch, no deleted branch**:

| # | Objective | Storage value | Problem source | Outcome source | Focus |
|---|---|---|---|---|---|
| 1 | Финансовое управление | `work_interest` | 6 cards + free text | 6 cards | §17 row 1 |
| 2 | Прибыль и эффективность | `work_interest` | 6 cards + free text | 6 cards | §17 row 2 |
| 3 | Денежный поток | `work_interest` | 5 cards + free text | 6 cards | §17 row 3 |
| 4 | Инвестиция / новый проект | `work_interest` | 6 cards + free text | 6 cards | §17 row 4 |
| 5 | Недвижимость / сделка | `work_interest` | 7 cards + free text | 7 cards | §17 row 5 |
| 6 | Финансирование | `work_interest` | 7 cards + free text | 6 cards | §17 row 6 |
| 7 | Нужен независимый взгляд | `work_interest` | **free text only** | 6 cards | §17 row 7 |
| 8 | Другая задача | `work_interest` | **free text only** | 7 cards | §17 row 8 |

The only constraint is in `submit-contract.js`, whose `ANSWER_SCHEMA` is a strict value whitelist —
by design, so the browser cannot widen the CRM vocabulary. It must be replaced with the new one.

---

## J. Gap classification

| ID | Gap | Class | Note |
|---|---|---|---|
| 1 | Company, activity, turnover, objective, problem, problem free text, contact value, locale | **G0** | already durable end to end; only the vocabulary changes |
| 2 | Lead Intake receives new fields | **G0** | `Normalize` reads nested paths and captures everything to `raw_json`; no change to receive |
| 3 | Retry / one-lead-per-cycle / terminal `submitted` | **G0** | already enforced twice |
| 4 | All screen copy, cards, stages, review layout | **G1** | Mini App only |
| 5 | Edit → returns directly to Review | **G1/G2** | client state only |
| 6 | `/start` silently rotates the cycle after a committed lead | **G2** | contradicts the new rule; `Get Bot Session` reset trigger must become explicit |
| 7 | Telegram entry offering resume / new request | **G2** | new Concierge screen; the cycle mechanism already exists |
| 8 | Draft + submit endpoints not deployed | **G3** | logic written, gated at 137 assertions, injection-shaped |
| 9 | `submit-contract.js` answer vocabulary | **G3** | replace `ANSWER_SCHEMA` / `REQUIRED_ANSWERS` / RU maps + the projection |
| 10 | `role` not sent by the Mini App projection | **G3** | Lead Intake and Pipeline already carry it |
| 11 | `desired_outcome` → `selected_goals` | **G3** | existing column, correct semantics, currently unused |
| 12 | Provenance (value/source/confirmed) | **G3** | fits `draft_json`; declare a sub-schema |
| 13 | Draft survives beyond the 1800 s TTL | **G3/G4** | G3 if a longer TTL is acceptable; G4 if resume must cross days |
| 14 | `decision_horizon` absent from the CRM row | **G4** | 1 Pipeline column |
| 15 | `current_setup[]` has no column | **G4** | 1 Pipeline column, `joinArray` pattern |
| 16 | `important_context` has no column | **G4** | 1 Pipeline column |
| 17 | `desired_outcome_free_text` | **G4** | 1 column, or appended into `selected_goals` |
| 18 | Privacy audit trail (7 fields, two categories) | **G4** | cannot go in `Bot_Sessions` (F17) |
| 19 | Document upload + storage + references | **G4** | no path exists; additive, feasible with existing credentials |
| 20 | Post-submit append to a committed request | **G4** | no mechanism today |
| 21 | Architecture blockers | **G5** | **none found** |

---

## I·2 Minimum proposed change set

**Every proposed change is listed. None was made.**

### Schema
1. Pipeline: add up to **five** columns after `BO` — `decision_horizon`, `current_setup`,
   `important_context`, `desired_outcome_free_text` (or fold into `selected_goals`),
   `documents_refs`. Header edit **plus** `Save to Pipeline` `columns.value` and `columns.schema`
   (mode is `defineBelow`, so an unmapped key is silently dropped rather than appended).
2. Privacy audit trail: a new store or Pipeline columns for the seven fields. **Not** `Bot_Sessions`.
3. `MiniApp_App_Sessions`: **no column change** — `draft_json` absorbs draft and provenance. Only
   the TTL may need review.
4. `Bot_Sessions`: **no change.** F17 stands.

### Workflow
5. Gateway: add `PUT /miniapp/session` and `POST /miniapp/submit` as **new nodes on the existing
   workflow or a sibling workflow**, wiring the existing `submit-contract.js` / `submit-handler.js`
   / `recovery-adapter.js`. The bootstrap path and the G5 claim are **not touched**.
6. Concierge `Get Bot Session`: make the cycle reset trigger explicit rather than `/start`
   (gap 6). This is the only change to a closed-gate workflow, and it is additive to the guard,
   not a redesign of cycle semantics.
7. Concierge: a new Telegram entry screen offering resume / new request.
8. Lead Intake: **no change** to receive. Only `Build Pipeline Row` + `Save to Pipeline` gain the
   new keys — and only if the owner approves the new columns.
9. `Update Pipeline (Merge)` uses `autoMapInputData`: any new key reaching the merge path would
   append a column (F16). Either promote it to `defineBelow` or keep new keys off that path.

### Contract
10. `submit-contract.js`: replace `ANSWER_SCHEMA`, `REQUIRED_ANSWERS`, the RU label maps and
    `buildLeadIntakePayload`. `UNTRUSTED_BODY_KEYS`, `CLIENT_RESPONSE_FIELDS` and
    `RESPONSE_FORBIDDEN_KEYS` stay as they are.
11. Gateway contract doc §7/§9: update the draft and submit examples to the new vocabulary.

### QA
12. `qa/miniapp-submit.test.mjs` (137) rewrites against the new vocabulary; `miniapp-gateway` (23),
    `miniapp-readmodel` (42), `receipt-integration` (70), `lead-intake-trust` (43) are re-run and
    are expected to hold. Raise `qa/assertion-baseline.json` deliberately.

---

## J. Risks

1. **Pipeline column additions are the only irreversible step.** F16 proved a stray key permanently
   widens a sheet. `Save to Pipeline` is `defineBelow` so the new-lead path is safe; the merge path
   is not. Add columns deliberately, header first, and keep new keys off `autoMapInputData` nodes.
2. **Changing the `/start` reset touches a closed-gate workflow.** The Concierge is production and
   its cycle semantics are load-bearing for consent and one-lead-per-cycle. Any change needs the
   P9-R2/R4 method: isolated harness, drive the real cases, prove no requalification path opens.
3. **Draft TTL.** 1800 s is short for "resume later". Extending it lengthens the window in which a
   binding is valid; it must not weaken the cycle-supersede check.
4. **Documents are the largest single item** and the only one with no existing scaffolding.
   Deferring upload to v1.1 is legitimate under the approved copy.
5. **Vocabulary migration.** Existing CRM rows carry the old `work_interest` / `main_pain` values.
   The new labels do not collide, but reporting across the boundary needs a stated cutover date.
6. **`urgency` is scored, not stored.** Promoting `decision_horizon` to a column must not change
   the scoring input — the negation guard («Жёсткого срока нет» must stay non-urgent) is the same
   defect class as the retired «Нет срочности».

---

## K. Verdict

No gap requires redesigning closed infrastructure. G5 count is **zero**. The Gateway bootstrap, the
G5 replay semantics, the Lead Intake dedup remediation and `Bot_Sessions A:AZ` are all preserved
untouched by the proposed change set. The largest item — draft and submit endpoints — is wiring
already-written, already-gated logic.

# PREMIUM UX IMPLEMENTATION READINESS = GO

Two owner decisions should be settled before Phase 2 begins:

1. **Documents in v1** — full upload, or ship «Продолжить без материалов» and defer upload to v1.1?
2. **Privacy audit trail location** — new dedicated store, or Pipeline columns? (`Bot_Sessions` is
   excluded by F17.)

A third is smaller: whether field-level provenance must survive into the CRM, or whether
`raw_json` is an acceptable audit surface for it.
