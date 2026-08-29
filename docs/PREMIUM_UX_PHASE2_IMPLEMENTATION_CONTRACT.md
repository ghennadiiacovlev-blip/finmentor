# Premium UX — Phase 2: owner decisions and implementation contract candidate

**CANDIDATE. Nothing was deployed, no live sheet was altered, nothing was merged or activated.**

Phase 1: `docs/PREMIUM_UX_PHASE1_CONTRACT_MAPPING.md`, commit `6b99bdd`.
Design authority: `PREMIUM_UX_FINAL_RU_SPEC.md`, closure `fcfd56e`.
Closed gates preserved as read-only facts: Gateway bootstrap = FINAL GO, Lead Intake = GO,
F17 = CLOSED, `Bot_Sessions` ends at `AZ`, G5 replay semantics closed.

---

## 0. Owner decisions, as applied

| # | Decision | Effect on this contract |
|---|---|---|
| 1 | Binary upload **deferred** | Documents step records **availability categories only**, into the existing `documents_status` / `selected_documents`. **No file store, no new columns, no upload endpoint.** |
| 2 | Privacy audit → **dedicated append-only store** | Proposed as a new Supabase table (§3). Not Pipeline, not `Bot_Sessions`. |
| 3 | `/start` terminal rule | Replaces the unconditional reset with a three-way branch (§4). |
| 4 | Post-submit append | Belongs to the committed request; lands as an **Activities row** (§5). |
| 5 | Pipeline conservatism | **Three** new columns proposed, each justified; all kept off the auto-map merge path (§2). |

---

## 1. One thing that needs owner copy before implementation

The nine Telegram states are approved as *states*, but only two carry approved *copy* — the
terminal screen from Decision 3 («Последнее обращение уже передано FINMENTOR» / «Добавить к
обращению» / «Начать новый вопрос») and the resume choice («Продолжить» / «Начать заново»).

`PREMIUM_UX_FINAL_RU_SPEC.md` covers the Mini App only. **Copy is not yet approved for:**
`TG_ENTRY`, `TG_FREEFORM_PROBLEM`, `TG_CONFIRM_CONTEXT`, `TG_OPEN_BRIEF`, `TG_APPEND_MESSAGE`
(prompt + acknowledgement), `TG_NEW_REQUEST_CONFIRM`, `TG_INFRA_FAILURE`.

No UX was invented. The state table below marks each as `COPY REQUIRED`. This is not a blocker for
offline implementation of the Mini App and the endpoints, but it blocks the Concierge slice.

**No new visible state was added.** The nineteen Mini App states map onto the fourteen approved
screens (§6.2); three pairs share a screen exactly as the approved design renders them.

---

## 2. Proposed Pipeline columns — exactly three

Physical header today is `A:BO`, 67 columns; `Save to Pipeline` writes 59 with
`mappingMode: defineBelow`. New columns append at **BP, BQ, BR**.

Rejected as unnecessary, per Decision 5: `desired_outcome` (→ existing `selected_goals`),
`desired_outcome_free_text` (→ appended into `selected_goals`), `documents_refs` (→ Decision 1
defers upload), `contact_channel` (→ derivable from which of email/phone/telegram is populated),
`role`, `business_activity`, `objective`, `problem` (→ all have existing homes).

### BP · `current_setup`

- **Product field:** `current_setup[]` (spec §10, eleven-item multi-select).
- **Why no existing column works:** the three multi-value columns are all occupied by different
  concepts — `selected_problems` = problem, `selected_goals` = desired outcome,
  `selected_documents` = **now taken by Decision 1** for document availability. Folding financial
  maturity into any of them creates exactly the silent ambiguity Decision 5 forbids.
- **Why `raw_json` is insufficient:** it is the consultant's *first* preparation input — «на что уже
  можно опереться» decides whether the first meeting is a build or a repair — and it must be
  filterable ("show me leads with no CFO and no budget"). `raw_json` is a 45 000-char blob that no
  sheet filter or read-model can query.
- **Type / vocabulary:** text, `'; '`-joined, canonical spec §10 order (never client order, so
  values are comparable across rows).
- **Writer:** `Build Pipeline Row` → `Save to Pipeline` (`columns.value` + `columns.schema`).
- **Reader:** meeting-brief projection; consultant filtering.
- **Merge behaviour:** **not** emitted by `Build Merge Update` → cannot reach the auto-map path.
- **Historical rows:** remain valid; empty means *not collected*, never *nothing available*.

### BQ · `decision_horizon`

- **Product field:** `decision_horizon` (spec §11, five locked options).
- **Why no existing column works:** there is none. `urgency` is computed by `Normalize + Score Lead`
  and consumed by scoring, but `Build Pipeline Row` emits no such key and the header has no column —
  Phase 1 §A row 11. It is lost from the CRM today.
- **Why `raw_json` is insufficient:** it drives SLA triage and the consultant's calendar. It must sit
  beside `next_follow_up_at` and `sla_hours` to be actionable.
- **Type / vocabulary:** text, exactly one of the five spec §11 labels.
- **Writer / reader / merge / history:** as BP.
- **Guard:** promoting it to a column must not change the scoring input. «Жёсткого срока нет» must
  stay non-urgent through the existing negation guard — the same defect class as the retired
  «Нет срочности», and it needs its own regression assertion.

### BR · `important_context`

- **Product field:** `important_context` (spec §14, optional).
- **Why no existing column works:** `free_text_request` (Bot_Sessions `X`) is occupied by
  `problem_free_text`. `comment` (Pipeline `AI`) is an operator field written as `''`; repurposing a
  human column for client input would collide the moment an operator types in it.
- **Why `raw_json` is insufficient:** it is the one field whose entire purpose is to be read *before*
  the meeting («через месяц встреча с банком»). A brief that requires parsing a blob to find the
  deadline defeats the field.
- **Type:** text, ≤ 500 chars (existing `MAX_FREE_TEXT`).
- **Writer / reader / merge / history:** as BP. **Omitted entirely from the brief when empty**
  (spec §14) — the column is empty, not `'—'`.

### F16 containment

`Update Pipeline (Merge)` uses `autoMapInputData` with an empty stored schema, so any unrecognised
key reaching it appends a column permanently. **Chosen mitigation: keep the three new keys off that
path entirely** — `Build Merge Update` does not emit them. Zero risk, zero change to a closed path.

Consequence, stated: on a dedup merge the three columns keep their original values. Acceptable —
under the terminal rule a Mini App submission cannot requalify into a merge without an explicit new
request, which mints a new cycle. Promoting the merge node to `defineBelow` is the alternative and
is **not** proposed for v1; it would touch a closed write path for no v1 benefit.

`Save Activity` also uses `autoMapInputData` (schema 0). The append builder in §5 emits exactly the
seven existing Activities keys and nothing else, so it carries the same exposure and the same
containment: an exact-key regression assertion.

---

## 3. Privacy audit store

**Proposal: a new table `public.privacy_acknowledgements` in the existing FINMENTOR Supabase
project**, reached with the existing credential `FINMENTOR Supabase G5` (`B6wRirWfjqoASXU3`).

    create table public.privacy_acknowledgements (
      id                              bigint generated always as identity primary key,
      submission_key                  text        not null,           -- opaque, from the cycle issuer
      cycle_id                        text,
      privacy_notice_version          text        not null,
      privacy_locale                  text        not null,
      privacy_notice_shown_at         timestamptz not null,
      privacy_notice_acknowledged_at  timestamptz not null,
      privacy_legal_basis             text        not null,           -- value subject to legal review
      marketing_consent               boolean,                        -- null = never asked
      marketing_consent_at            timestamptz,
      recorded_at                     timestamptz not null default now()
    );
    create unique index on public.privacy_acknowledgements (submission_key);

**Append-only is enforced, not intended:** grant `INSERT, SELECT` only to the n8n role; no `UPDATE`,
no `DELETE`. A correction is a new row against a new `submission_key`, never an edit.

**What it must never contain**, and the schema structurally cannot: raw `initData`, any Telegram
signature or hash, `telegram_user_id`, name, company, contact details, the client's free-text
problem, documents, or any copy of the CRM payload. The only linkage is the opaque
`submission_key` already minted by the cycle issuer — the same identity `Submission_Receipts` uses.

**Why this beats Pipeline columns**

1. **Append-only is real.** A Google Sheet is editable by anyone with sheet access and has no
   constraint layer; legal evidence that an operator can silently overwrite is not evidence.
2. **An acknowledgement can exist without a lead.** The notice is shown at Submit; if the submission
   then fails, the acknowledgement still happened. Pipeline rows exist only for committed leads, so
   a Pipeline column can only record acknowledgements that succeeded — precisely the wrong subset.
3. **Different retention.** CRM records and legal audit records have different lifecycles and
   different deletion obligations. Co-locating them forces the stricter rule onto both.
4. **No CRM surface widening.** Seven privacy columns on Pipeline are visible to every sheet
   consumer, every export and every Command Center read.
5. **F16 exposure.** Every new Pipeline column widens a sheet that has already been widened twice by
   accident.
6. **Zero new infrastructure.** The credential, the project and the Postgres node type are already in
   production for G5; this is a sibling table, and it does **not** touch G5 semantics.

Alternative if the owner prefers no new Postgres table: an n8n Data Table
`Privacy_Acknowledgements` (same shape). It is simpler but has no constraint layer and no
append-only enforcement — acceptable only if enforcement is accepted as procedural.

`privacy_notice_version` and both link URLs come from the **Settings** sheet (`key`/`value`/`note`),
the existing configuration surface, so a notice revision is a config change, not a deploy.

**Legal-basis value and notice wording remain subject to owner/legal review before activation.**

---

## 4. `/start` transition model

Current: `Get Bot Session` does `if (text === '/start') reset = 'start'` unconditionally.

Target — a three-way branch evaluated **before** any reset:

    resolve authoritative cycle for chat_id
      ├─ no cycle, or cycle with no answers and no lead
      │     → TG_ENTRY                      normal entry, no reset
      │
      ├─ cycle with a draft, no committed lead        (draft_state = in_progress)
      │     → TG_RESUME_DRAFT               «Продолжить» | «Начать заново»
      │         Продолжить      → TG_OPEN_BRIEF, same cycle, no reset
      │         Начать заново   → TG_NEW_REQUEST_CONFIRM → explicit rotate
      │
      └─ latest cycle committed             (lead_id present AND lead_cycle_id = cycle_id)
            → TG_SUBMITTED                  «Последнее обращение уже передано FINMENTOR.»
                Добавить к обращению  → TG_APPEND_MESSAGE   same cycle, no reset, no consent
                Начать новый вопрос   → TG_NEW_REQUEST_CONFIRM → explicit rotate

Only `TG_NEW_REQUEST_CONFIRM` may call the existing rotate path (`archiveLead()` + new `cycle_id`).
The rotate **mechanism is unchanged** — Phase 1 proved it correct; only its *trigger* moves from
`/start` to an explicit action.

**Hard invariant, restated as a test:** for every input other than the explicit new-request action,
if `lead_id` is present and belongs to the current cycle, the resulting state must be in
`{TG_SUBMITTED, TG_APPEND_MESSAGE, TG_NEW_REQUEST_CONFIRM}` — never any qualification state and
never `APP_*`. This is the P9-R2/R4 harness pattern: an isolated copy, real inputs, `runData` read
per node, with controls proving a *legitimate* new request still rotates.

Unchanged and still true: `m|diag` on a finished cycle already means restart, plain navigation never
resets, and consent/lead from another cycle are already invalidated at read time.

---

## 5. Post-submit append

**Destination: one row in the existing `Activities` sheet.** Seven columns
(`activity_id, ts, lead_id, actor, channel, action, detail`), append-only by design, keyed by
`lead_id`, already written by Lead Intake. **Zero schema change.**

    activity_id : `${lead_id}-${Date.now()}`
    ts          : now (ISO)
    lead_id     : the committed lead_id, read from Bot_Sessions authority — never from the client
    actor       : 'client:telegram'
    channel     : 'telegram'
    action      : 'client_append'
    detail      : the client's message, sanitised, ≤ 500 chars

It must not create a lead, rerun qualification, rerun consent, rotate the cycle, or touch Pipeline.
The consultant sees it in the lead's activity trail beside the intake row.

Guard: the builder emits exactly those seven keys — `Save Activity` is `autoMapInputData`, so an
extra key would widen the Activities sheet (F16). One exact-key assertion covers it.

---

## 6. State machine contract

### 6.1 Telegram — 9 states

| State | Allowed inputs | Copy | Writes → destination | Provenance | Skip | Next | Back/edit | Recovery | Terminal |
|---|---|---|---|---|---|---|---|---|---|
| `TG_ENTRY` | `/start`, menu tap, free text | **COPY REQUIRED** | none | — | skipped when a draft or committed cycle exists (§4) | `TG_FREEFORM_PROBLEM` \| `TG_OPEN_BRIEF` | — | re-render | no |
| `TG_FREEFORM_PROBLEM` | free text ≤500 | **COPY REQUIRED** | `free_text_request` → BS `X` | `user_explicit` | skipped if already captured | `TG_CONFIRM_CONTEXT` | re-enter | re-ask | no |
| `TG_CONFIRM_CONTEXT` | confirm / correct name + role | **COPY REQUIRED** | `contact_name` → BS `V`; `role` → draft | name `telegram_carried`→`user_confirmed`; role `user_confirmed` | skipped when both already `user_confirmed` this cycle | `TG_OPEN_BRIEF` | re-enter | re-ask | no |
| `TG_OPEN_BRIEF` | tap → Mini App | **COPY REQUIRED** | none | — | never | `APP_BOOTSTRAP` | — | re-render | no |
| `TG_RESUME_DRAFT` | «Продолжить» \| «Начать заново» | **approved** (Decision 3) | none | — | only when a draft exists | `TG_OPEN_BRIEF` \| `TG_NEW_REQUEST_CONFIRM` | — | re-render | no |
| `TG_SUBMITTED` | «Добавить к обращению» \| «Начать новый вопрос» | **approved** (Decision 3) | none | — | only when committed | `TG_APPEND_MESSAGE` \| `TG_NEW_REQUEST_CONFIRM` | — | re-render | **yes** |
| `TG_APPEND_MESSAGE` | free text ≤500 | **COPY REQUIRED** | Activities row (§5) | `user_explicit` | — | `TG_SUBMITTED` | — | re-ask; append is idempotent per message id | **yes** |
| `TG_NEW_REQUEST_CONFIRM` | explicit confirm \| cancel | **COPY REQUIRED** | `archiveLead()` + new `cycle_id` → BS | — | never skipped — the only rotate trigger | `TG_ENTRY` \| back | cancel returns | — | no |
| `TG_INFRA_FAILURE` | retry | **COPY REQUIRED** | none | — | — | previous state | — | retry is idempotent | no |

### 6.2 Mini App — 19 states over the 14 approved screens

No new visible state. Three pairs share a screen exactly as the approved design renders them:
`APP_COMPANY`+`APP_ROLE`+`APP_SCALE` → screen 02; `APP_CONTACT`+`APP_IMPORTANT_CONTEXT` → screen 09;
`APP_PRIVACY`+`APP_SUBMITTING` → screen 12.

| State | Screen | Allowed inputs | Copy ref | Writes | Destination | Provenance | Skip when | Next | Back/edit | Recovery | Terminal |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `APP_BOOTSTRAP` | 01 | `init_data` | §spec 01 | app session | AS (insert) | — | never | `APP_COMPANY` \| resume target | — | 401/409/503 per Gateway §4 | no |
| `APP_COMPANY` | 02 | name, activity | §9 | `company_name`, `business_activity` | AS `draft_json` | `user_explicit` | value `confirmed` this cycle | `APP_ROLE` | re-enter | draft retained | no |
| `APP_ROLE` | 02 | confirm / change | §9 | `role` | AS `draft_json` | `user_confirmed` \| `telegram_carried` | carried **and** confirmed | `APP_SCALE` | re-enter | " | no |
| `APP_SCALE` | 02 | 1 of 6 | §9 | `turnover_band` | AS `draft_json` | `user_explicit` | confirmed | `APP_OBJECTIVE` | re-enter | " | no |
| `APP_OBJECTIVE` | 03 | 1 of 8 | §4 | `objective` | AS `draft_json` | `user_explicit` | **never** | `APP_PROBLEM` | re-enter | " | no |
| `APP_PROBLEM` | 04 | 1 card \| free text | §5, §7, §8 | `problem`, `problem_free_text` | AS `draft_json` | `user_explicit` | **never** | `APP_DESIRED_OUTCOME` | re-enter | " | no |
| `APP_DESIRED_OUTCOME` | 05 | 1 of set | §6 | `desired_outcome`, `desired_outcome_free_text` | AS `draft_json` | `user_explicit` | **never** | `APP_CURRENT_SETUP` | re-enter | " | no |
| `APP_CURRENT_SETUP` | 06 | multi-select | §10 | `current_setup[]` | AS `draft_json` | `user_explicit` | **never** | `APP_DECISION_HORIZON` | re-enter | " | no |
| `APP_DECISION_HORIZON` | 07 | 1 of 5 | §11 | `decision_horizon` | AS `draft_json` | `user_explicit` | **never** | `APP_DOCUMENTS` | re-enter | " | no |
| `APP_DOCUMENTS` | 08 | categories \| continue without | §12 + Decision 1 | `documents_status`, `selected_documents[]` | AS `draft_json` | `user_explicit` | optional — may be empty | `APP_CONTACT` | re-enter | " | no |
| `APP_CONTACT` | 09 | 1 of 3 channels | §13 | `contact_channel`, `contact_value` | AS `draft_json` | `user_explicit` \| `telegram_carried` | channel carried **and** confirmed | `APP_IMPORTANT_CONTEXT` | re-enter | " | no |
| `APP_IMPORTANT_CONTEXT` | 09 | free text \| skip | §14 | `important_context` | AS `draft_json` | `user_explicit` | optional | `APP_REVIEW` | re-enter | " | no |
| `APP_REVIEW` | 10 | передать \| изменить \| добавить важное | §16 | none | — | — | never | `APP_PRIVACY` \| `APP_EDIT_SELECTOR` \| `APP_IMPORTANT_CONTEXT` | — | re-render from draft | no |
| `APP_EDIT_SELECTOR` | 11 | pick 1 of 11 | §19 | none | — | — | — | `APP_EDIT_FIELD` | `APP_REVIEW` | re-render | no |
| `APP_EDIT_FIELD` | 02–09 (owning screen) | that field only | its own §ref | that field | AS `draft_json` | `user_explicit` | — | **`APP_REVIEW`** — always, never the ladder | `APP_REVIEW` | draft retained | no |
| `APP_PRIVACY` | 12 | primary CTA | §18 | `notice_version`, `shown_at`, `acknowledged_at`, `locale`, `legal_basis` | privacy store (§3) at submit | `user_explicit` | **never** | `APP_SUBMITTING` | `APP_REVIEW` | re-render | no |
| `APP_SUBMITTING` | 12 (busy) | none | — | consent stamp → BS; Lead Intake ×1; `lead_id` → BS | BS then AS `state` | — | — | `APP_SUCCESS` \| `APP_FAILURE` | blocked | `SUBMIT_UNRESOLVED` → recovery adapter | no |
| `APP_SUCCESS` | 13 | «Вернуться в Telegram» | §21 | `state = submitted` | AS | — | — | `TG_SUBMITTED` | **blocked** | — | **yes** |
| `APP_FAILURE` | 14 | повторить \| к резюме | §22 | none | — | — | — | `APP_SUBMITTING` \| `APP_REVIEW` | allowed | idempotent retry, draft preserved | no |

**Count: 9 Telegram + 19 Mini App = 28 states, 14 approved screens, 0 new visible states.**

---

## 7. Provenance model (`draft_json`)

Stored in `MiniApp_App_Sessions.draft_json` — an unconstrained string, **no schema change**.

    {
      "v": 1,
      "cycle_id": "C-<chat>-<ts>",
      "step": "APP_DECISION_HORIZON",
      "updated_at": "2026-08-29T09:41:12.004Z",
      "fields": {
        "company_name":   { "value": "…",                 "source": "user_explicit",    "confirmed": true,  "at": "…" },
        "business_activity": { "value": "…",              "source": "user_explicit",    "confirmed": true,  "at": "…" },
        "role":           { "value": "Собственник",        "source": "user_confirmed",   "confirmed": true,  "at": "…" },
        "turnover_band":  { "value": "€2–10 млн",          "source": "user_explicit",    "confirmed": true,  "at": "…" },
        "objective":      { "value": "Денежный поток",     "source": "user_explicit",    "confirmed": true,  "at": "…" },
        "problem":        { "value": "…",                  "source": "user_explicit",    "confirmed": true,  "at": "…" },
        "current_setup":  { "value": ["Бухгалтерский учёт","1C / ERP"],
                                                           "source": "user_explicit",    "confirmed": true,  "at": "…" },
        "decision_horizon": { "value": null,               "source": null,               "confirmed": false, "at": null },
        "contact_channel": { "value": "telegram",          "source": "telegram_carried", "confirmed": false, "at": null },
        "locale":         { "value": "ru",                 "source": "telegram_carried", "confirmed": true,  "at": "…" }
      }
    }

**Source vocabulary (closed):** `user_explicit` · `user_confirmed` · `telegram_carried` ·
`ai_inferred`.

**Skip rule, exactly:**

    skip(field) = field.confirmed === true
                  AND ( field.source === 'user_explicit'
                     OR field.source === 'user_confirmed'
                     OR ( field.source === 'telegram_carried'
                          AND field.name ∈ APPROVED_CARRIED ) )

    APPROVED_CARRIED = { contact_name, locale, contact_channel }

`ai_inferred` **never** satisfies a skip, alone or combined — an inferred value may be *offered* as
a prefill, but the field stays `confirmed: false` until the client acts, and an unconfirmed field is
always asked. Nothing in the stack infers today, so this is a forward guard, not a migration.

**Clarification worth owner review:** the approved Entry screen renders «Геннадий · Собственник» as
one carried line, but Telegram supplies only the *name*. **Role** is `user_confirmed` from
`TG_CONFIRM_CONTEXT`, not `telegram_carried` — and is therefore not in `APPROVED_CARRIED`. The line
may still render as designed; the provenance differs per half.

Validation on write: `v` must be `1`; unknown field names rejected; `source` in the closed set;
`confirmed` boolean; total ≤ 16 KB; free text ≤ 500 chars; values stored as data, never expressions.

---

## 8. Endpoint wiring contract

Both endpoints wire the **existing, unmodified** modules in `n8n/src/miniapp-submit/`. Bootstrap
semantics are untouched: the four respond nodes, the G5 claim and `Build App Session` are not edited.

### `PUT /miniapp/session` — draft

    Request  { app_session_id, step, fields }        ≤ 16 KB
    Nodes    Webhook(PUT) → Resolve App Session (dataTable get by app_session_id)
             → Session Verdict (code)               TTL, state, existence
             → IF Session Valid
                 → Resolve Authoritative Cycle (Bot_Sessions read)
                 → Cycle Verdict (code)             bind on first write; 409 if superseded
                 → IF Cycle Current
                     → Validate Draft (code)        size + whitelist + provenance (§7)
                     → Update App Session (dataTable update: draft_json, cycle_id, updated_at)
                     → Respond Draft OK             200 { ok:true, expires_at }
    Guarantees
      · opaque app_session_id is the only authority; no init_data after bootstrap
      · TTL enforced; expired → 401 SESSION_EXPIRED
      · state 'submitted' is terminal → 409, draft refused
      · no consent semantics, no CRM write, no Lead Intake call
      · errors: 400 BAD_REQUEST · 401 SESSION_* · 409 CYCLE_SUPERSEDED · 503 TEMPORARY_BACKEND_ERROR
    Flags     every node: onError continueRegularOutput or an explicit error branch;
              NO node carries alwaysOutputData + continueErrorOutput (P9-R2/R4 rule)

### `POST /miniapp/submit`

    Request  { app_session_id, privacy_ack: { notice_version, locale, shown_at, acknowledged_at } }
             answers come from the stored draft, NOT from the body
    Nodes    Webhook(POST) → Resolve App Session → Session Verdict → IF Valid
             → Resolve Authoritative Cycle → Cycle Verdict → IF Current
             → Load Draft + Validate (submit-contract.js)
             → Stamp Consent (Bot_Sessions: consent, consent_cycle_id, consent_at)
             → Write Privacy Acknowledgement (Supabase §3)      ← before the irreversible call
             → Build Lead Intake Payload (submit-contract.js)
             → Call Lead Intake (internal route, exactly once)
             → Parse Result (ok === true only)
             → Persist canonical lead_id + lead_cycle_id → Bot_Sessions
             → Update App Session state = 'submitted'
             → Respond Submit OK   { ok, lead_id, priority, financial_zone, submit_state }
    Guarantees
      · answers read server-side from the draft → the browser cannot steer the payload
      · idempotency on the authoritative submission_key; retry resolves server state first and
        returns the prior canonical success — never a second Lead Intake call
      · `mode` / `lead_mode` refused by responseLeaks at any depth (N6.2, unchanged)
      · no direct Pipeline write — Lead Intake owns the CRM
      · 'submitted' terminal; nothing returns it to 'draft'
      · ambiguous outcome → SUBMIT_UNRESOLVED + recovery adapter (G1), never a silent success

`privacy_ack` is written **before** the irreversible Lead Intake call, so an acknowledgement is
never lost to a failed submission — which is the whole point of §3 reason 2.

---

## 9. Meeting brief projection

Assembled in `n8n/src/miniapp-readmodel/projection.js` (existing module, existing pattern:
authority-first, `mirror-helper.js`). **No new store, no second CRM.**

    CLIENT FACTS            ← Pipeline row, one column each
      company               ← L company            business activity ← S industry_category
      role                  ← N role               scale             ← T turnover_range
      objective             ← Y work_interest      problem           ← V main_pain + W selected_problems
      desired outcome       ← X selected_goals     current setup     ← BP current_setup
      decision horizon      ← BQ decision_horizon  available materials ← Z documents_status + AA selected_documents
      important context     ← BR important_context contact preference ← derived from O/P/Q

    FINMENTOR PREPARATION   ← constant lookup, spec §17
      focus_of_first_meeting = FOCUS_MAP[objective]     8 keys × 3 lines, frozen table
      disclaimer             = "Финальный объём анализа консультант определит после изучения материалов."

`FOCUS_MAP` is a frozen constant with exactly the eight spec §17 keys. An objective outside the map
renders **no** focus block rather than a guess. No model call, no inference, ever — the two halves
are assembled from different sources and must never be merged in code or in the rendered brief.

The consultant reads it in the existing read-model surface; nothing new is built to display it.

---

## 10. Change manifest

### A · Repository code

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| A1 | `submit-contract.js`: replace `ANSWER_SCHEMA`, `REQUIRED_ANSWERS`, RU maps, `buildLeadIntakePayload` | yes | spec frozen | git revert | `qa/miniapp-submit.test.mjs` rewritten | 1 |
| A2 | New `n8n/src/miniapp-draft/draft-contract.js` — §7 validation | yes | A1 | git revert | new gate | 1 |
| A3 | New `n8n/src/miniapp-readmodel/meeting-brief.js` + frozen `FOCUS_MAP` | yes | — | git revert | new gate | 7 |
| A4 | New `n8n/src/privacy/privacy-record.js` — §3 record builder + forbidden-key refusal | yes | — | git revert | new gate | 8 |
| A5 | Mini App: rebuild `app/` to the approved design | yes | A1, A2 | git revert | browser QA | 3 |

### B · Concierge workflow (`mppzthlkSJFr6Kle`)

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| B1 | `Get Bot Session`: reset trigger → explicit only (§4) | **live-risk** | isolated harness proof | `n8n/history/` snapshot + PUT | P9-R2/R4 harness, controls both ways | 6 |
| B2 | New TG entry / resume / submitted / append screens | **live-risk** | **owner copy (§1)** | snapshot | harness | 6 |
| B3 | Append builder → Activities, exact 7 keys | **live-risk** | B2 | snapshot | exact-key assertion | 6 |

### C · Gateway endpoints (`nTZHLbv2KFggdhh5` or a sibling)

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| C1 | `PUT /miniapp/session` nodes | yes — additive | A2 | delete nodes | isolated harness | 4 |
| C2 | `POST /miniapp/submit` nodes | yes — additive | A1, C1, G1 | delete nodes | isolated harness + idempotency proof | 5 |
| C3 | Bootstrap path | **NO CHANGE** | — | — | drift hash unchanged | — |

### D · Mini App — see A5. Offline until C1/C2 exist.

### E · Lead Intake (`QmIyEW2ZEqKregmN`)

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| E1 | `Build Pipeline Row`: +3 keys | **live-risk** | F1 done first | snapshot + PUT | harness; A/B/C/D/E dedup cases re-run | 9 |
| E2 | `Save to Pipeline`: +3 in `columns.value` and `columns.schema` | **live-risk** | E1 | snapshot | as E1 | 9 |
| E3 | `Build Merge Update` | **NO CHANGE** — containment | — | — | assertion that it emits none of the 3 | 9 |
| E4 | Receiving new fields | **NO CHANGE** | — | — | — | — |

### F · Pipeline schema

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| F1 | Add `BP current_setup`, `BQ decision_horizon`, `BR important_context` | **IRREVERSIBLE** | owner approval; snapshot copy of the workbook | delete columns by hand (data loss) | header re-read + physical position assertion | 9 |

Owner UI action, header first, then E1/E2. Never programmatic — the F17 rule.

### G · Privacy audit store

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| G1 | `create table public.privacy_acknowledgements` + INSERT/SELECT-only grants | yes (drop) | owner + legal sign-off on `privacy_legal_basis` | drop table | write/read proof on a disposable row | 8 |

### H · QA / UAT

| # | Change | Reversible | Precondition | Rollback | Gate | Order |
|---|---|---|---|---|---|---|
| H1 | Rewrite `qa/miniapp-submit.test.mjs` to the new vocabulary | yes | A1 | git revert | itself | 1 |
| H2 | New gates: draft contract, provenance/skip, meeting brief, privacy record, `/start` terminal | yes | A2–A4, B1 | git revert | themselves | 1–8 |
| H3 | Raise `qa/assertion-baseline.json` deliberately | yes | H1, H2 | git revert | assertion-floor gate | each |
| H4 | Integrated RU UAT on isolated harnesses | yes | C1, C2 | — | full matrix | 10 |

---

## 11. Implementation order

Matches the preferred direction, with the two dependencies that must not be inverted.

    1  contracts + state machine            A1, H1                     offline
    2  draft + provenance model             A2, H2                     offline
    3  Mini App offline                     A5                         offline, mock endpoints
    4  session endpoint                     C1                         isolated workflow
    5  submit endpoint                      C2                         isolated workflow
    6  Concierge entry / resume / append    B1, B2, B3   ← needs §1 copy
    7  meeting brief projection             A3                         offline
    8  privacy audit store                  G1, A4       ← needs legal sign-off
    9  Pipeline migration                   F1 → E1, E2  ← owner approval; header BEFORE writer
    10 integrated RU UAT                    H4                         isolated harnesses
    11 RO adaptation                        —                          not started
    12 production deployment                —                          separate owner gate

**G1 before C2** — the submit endpoint writes the acknowledgement before the irreversible call, so
the store must exist first. **F1 before E1/E2** — a writer emitting a key with no column is
silently dropped under `defineBelow`, which would look like success while losing data.

---

## 12. Risks

1. **F1 is the only irreversible step.** Three columns on a live CRM sheet. Snapshot the workbook
   first (the F17 runbook pattern), add the header by hand, verify physical positions BP/BQ/BR by a
   fresh authoritative read, then deploy the writer.
2. **B1 touches a closed-gate workflow.** The Concierge's cycle semantics carry consent validity and
   one-lead-per-cycle. Only the reset *trigger* moves, but it must be proven on an isolated
   retention-enabled copy with controls in both directions: a committed cycle must not requalify,
   and an explicit new request must still rotate.
3. **Telegram copy is missing (§1).** Seven states have no approved wording. Implementing them means
   inventing UX, which the handoff forbids.
4. **Draft TTL is 1800 s.** «Продолжить» after an hour finds no session. Either extend the TTL — which
   lengthens the window a binding stays valid, and must not weaken the cycle-supersede check — or
   accept that resume is a within-session affordance and say so in the Telegram copy.
5. **`legal_basis` is unresolved.** `privacy_legal_basis` has no approved value; the store can be
   built but not populated with a final value until legal review.
6. **Vocabulary cutover.** Existing rows carry old `work_interest` / `main_pain` values. The new
   labels do not collide, but any report spanning the boundary needs a stated cutover date.
7. **Negation guard regression.** «Жёсткого срока нет» must remain non-urgent through scoring when
   `decision_horizon` becomes a column — same defect class as the retired «Нет срочности».
8. **Two `autoMapInputData` nodes remain in the blast radius** (`Update Pipeline (Merge)`,
   `Save Activity`). Containment is by exact-key discipline plus assertions, not by node change.

---

## 13. Verdict

Every Phase 2 decision resolves without redesigning closed infrastructure. Bootstrap, G5, the
Lead Intake dedup remediation and `Bot_Sessions A:AZ` are all untouched by this contract. Three
Pipeline columns, one new Supabase table, two additive endpoints, one trigger change in the
Concierge, and no file-storage subsystem at all.

# OFFLINE IMPLEMENTATION READINESS = GO

Steps 1–5, 7 and the whole QA track may begin with no further approval.

**Blocked pending owner input:**

- **Step 6** (Concierge) — approved Russian copy for the seven Telegram states (§1).
- **Step 8** (privacy store) — legal sign-off on `privacy_legal_basis` and the notice wording.
- **Step 9** (Pipeline) — explicit approval of `BP current_setup`, `BQ decision_horizon`,
  `BR important_context`, and a workbook snapshot before the header edit.
