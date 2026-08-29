# Premium UX — production prerequisites before RU integrated UAT

**Date: 2026-08-29. Branch: `feat/miniapp-b21c-live-prereqs`.**

Nothing is merged. Nothing is customer-activated. The live Concierge and the live Mini App are
unchanged. Two live systems *were* changed under explicit owner approval — the Pipeline sheet
schema and the Supabase privacy store — and both are recorded in full below.

---

## 0. Gate status

| Gate | Status |
|------|--------|
| PIPELINE MIGRATION | **PASS** |
| PRIVACY APPEND-ONLY ROLE | **PASS** |
| PRIVACY STORE | **PASS** |
| TTL 72H CONTRACT | **PASS** |
| ENDPOINT CANDIDATES | **PASS** |
| CONCIERGE CANDIDATE | **PASS** |
| MINI APP RU | **PASS** |
| LEAD INTAKE PROJECTION | **PASS** |
| LEGAL NOTICE | **PENDING** (permitted to remain pending) |

QA: **43/43 gates, 1723 assertions, floors PASS.**

Blockers that remain are in §8. None of them is one of the eight gates.

---

## 1. Decision 1 — Pipeline BP/BQ/BR

**PASS.** Executed; full record in `PREMIUM_UX_PIPELINE_MIGRATION_RECORD.md`.

All nine preconditions were met before the production run, and verification came from a **fresh
authoritative XLSX export**, not from a re-read of anything the migration produced:

| Check | Result |
|-------|--------|
| Pipeline columns | 67 → **70** |
| `BP` / `BQ` / `BR` | `current_setup` / `decision_horizon` / `important_context` |
| `BS` | absent |
| Data cells in `BP:BR` | 0 |
| Marker / junk rows | 0 |
| Pipeline data rows | 1010, unchanged |
| Headers `A`–`BO` | byte-identical |
| Workbook tabs | 16, all unchanged |
| `Bot_Sessions` columns | 52, unchanged |

Rollback: pre-migration snapshot `1B1ZTvpVyx-de6ck8wfw7asv8Jur9eGheJJEpx__eyNQ`.

---

## 2. Decision 2 — the privacy audit store

**PASS.** Full proof in `PREMIUM_UX_PRIVACY_STORE_PROOF.md`.

`postgres` was rejected as the writer, as instructed. What exists instead:

- `privacy_audit_owner` — **NOLOGIN**, owns schema `privacy` and the table;
- `privacy_audit_writer` — LOGIN, owns nothing, `rolbypassrls = false`, `rolcreaterole = false`;
- `privacy.privacy_acknowledgements` — RLS **enabled and forced**, writer's grants = **INSERT only**.

Measured as the **real writer role** (`SET ROLE`), re-run immediately before this document:

| Operation | Result |
|-----------|--------|
| INSERT | reached the table (`23514`, refused by the opaque-key CHECK on a deliberately bad key) |
| SELECT / UPDATE / DELETE / TRUNCATE | DENIED — `42501` permission denied for table |
| ALTER / DROP / take ownership / disable RLS | DENIED — `42501` must be owner of table |
| CREATE ROLE | DENIED — `42501` permission denied to create role |

Post-conditions: **0 rows**, 9 columns intact, no `injected` column, no `escalated_by_writer` role.

**A Phase 2 claim was false and is corrected.** Phase 2 §3 said INSERT/SELECT grants made the store
append-only. Measurement showed the runtime role was `postgres`, which *owned* the table and held
UPDATE/DELETE/TRUNCATE plus `rolbypassrls`. That is why decision 2 was right to reject it.

**A Phase 2 design was also falsified.** `on conflict (submission_key) do nothing` requires SELECT,
which the writer must not have. The deployed form is a plain INSERT; idempotency is the unique index
`privacy_ack_submission_key_uidx` plus SQLSTATE `23505` read as *already recorded*. Measured: three
write attempts for one key leave exactly one row. Code and both gates were corrected to match, and
the QA gate now **refuses** `ON CONFLICT` rather than requiring it.

Append-only here means the *runtime* cannot rewrite history. An administrator acting as
`privacy_audit_owner` still can — which is required, because a data subject exercising erasure needs
someone who can delete.

---

## 3. Decision 3 — the legal basis enum

`privacy_legal_basis` candidate value: **`pre_contractual_request`**.

- **Server-side only.** It is never sent to the client and never rendered. A gate asserts the
  rendered notice, in both locales, contains neither the enum nor a specific article citation.
- **Not activated.** Until legal review confirms it, records carry `PENDING_LEGAL_REVIEW`. The two
  values are deliberately distinct constants so a sentinel cannot be mistaken for a decision.
- The customer-facing text states the *substance* — processing necessary for steps taken at the data
  subject's own request before a contract exists — which is true regardless of which article a
  lawyer ultimately points at. Citing `art. 6(1)(b)` in a customer document is a legal claim, and
  making it before review would be inventing legal detail.

---

## 4. Decision 4 — the layered privacy notice

Implemented in `n8n/src/premium-ux/privacy-notice.js`, gated by
`qa/premium-ux-privacy-notice.test.mjs` (21 assertions).

**Layer 1** — a concise notice on the first screen that collects personal data (< 400 characters,
both locales), linking to layer 2.
**Layer 2** — the full notice, with all **ten** elements required under Law 195/2024, in **RU and
RO**, acknowledged at Submit.

The ten elements: controller · purposes · legal basis · categories · recipients · transfers ·
retention · rights · complaint · voluntariness. The gate fails if either locale is missing one, or
carries an eleventh.

**One immutable row, both timestamps, no UPDATE.** `shown_at` is captured when layer 1 renders and
travels *with* the acknowledgement; no server write happens at show time, so nothing later needs an
UPDATE to become "acknowledged". That is what makes the append-only claim structural rather than a
promise. Draft rows may hold `privacy_notice_version` / `privacy_notice_shown_at`; the acknowledgement
row is written once at submit and never touched again.

Substantive disclosures that were checked rather than assumed:

- **Transfers** — the notice states that infrastructure sits outside Moldova, including in the EU and
  the USA. Saying otherwise would be false: Supabase, n8n and Google all do.
- **Retention** — states the 72-hour draft rule, matching the TTL actually deployed (§5).
- **Complaint** — names the National Center for Personal Data Protection of the Republic of Moldova.
- **No unsupportable security claims.** A gate refuses "military-grade", "bank-level", "100%",
  "encrypted" and similar.

---

## 5. Decision 5 — app-session TTL

**PASS. 1800 s → 259200 s (72 hours).**

### The stop condition did not fire

The owner instructed: *stop if the closed contract explicitly fixes 1800 seconds*. It does not.
`docs/PHASE_B2_1_GATEWAY_CONTRACT.md` §6 lists, in full:

> - server-side TTL;

No number appears anywhere in the contract. The requirement is a **bounded** lifetime, and 72 hours
is bounded. A gate asserts the contract names neither `1800` nor `259200`, so a future edit that
writes a number into the contract will fail the build rather than pass silently.

1800 s also contradicted approved copy: «У вас есть незавершённый бриф. Продолжить с того места, где
остановились?» promises a resume that a 30-minute window cannot honour.

### Properties

- **Server-authoritative.** Stamped in `Build App Session` from the server clock at mint time.
- **Fixed hard expiry, no sliding extension.** No node other than the mint node derives an expiry.
  (`expires_at` is a column name shared with the G5 replay ledger; `Derive Replay Key` and
  `G5 Replay Claim` carry *that* row's expiry. `Respond Bootstrap OK` only reads the minted value
  back. The gate checks for a *derivation*, not for the string.)
- **Client cannot influence it.** The TTL is a literal; nothing in the mint node reads request data,
  and the draft endpoint never writes `expires_at`.

### Boundaries — every point the owner named

| Point | Session |
|-------|---------|
| T0 | live |
| T+29 m | live |
| T+31 m | **live** (was dead under 1800 s) |
| T+24 h | live |
| T+48 h | live |
| just before 72 h | live |
| exactly 72 h | **expired** |
| after 72 h | expired |

Expiry is exclusive at the boundary: a session does not survive its own expiry instant. Draft write
and submit share one comparison, so neither can outlive the other.

### Security and privacy consequence — stated plainly

Lengthening the window by a factor of 144 lengthens the window in which:

1. **A leaked `app_session_id` is usable.** The id is the credential after bootstrap. A 72-hour
   window is 72 hours of usability for anyone who obtains one — from a shared device, a screenshot,
   or a Telegram account someone else can open. Mitigations that already exist: the id is 32 random
   bytes (not a row id, not derived from the Telegram user), it is bound to one user and one
   authoritative cycle, it is invalidated when the cycle moves on, `submitted` is terminal, and it is
   never accepted as proof of consent.
2. **Draft personal data sits at rest.** The draft holds business context and, once entered, contact
   details. Three days rather than thirty minutes. It is bounded, and the retention text now states
   the 72-hour rule so the disclosure matches the deployment. The mint row still carries no initData,
   no signature, no hash and no auth_date.

The **G5 replay clock is a different clock and did not move**: the replay ledger still expires at
`auth_date + 900`. It bounds how long one initData may be claimed, not how long a draft may be
resumed. Widening the session must not widen that, and a gate asserts the new TTL has not leaked
into the replay key derivation or the claim query.

The residual risk is a deliberate trade against a product promise the owner made. If it is
unacceptable, the lever is the constant plus one gate expectation — not a redesign.

---

## 6. Decision 6 + the controller decision

### What the read-only search found

**`CONTROLLER IDENTITY = FOUND IN REPOSITORY`** — this is *not* the "absent" case, and the finding
matters more than a placeholder would have.

The published site already names a controller:

| Location | Text |
|----------|------|
| `privacy.html:97` | «Оператор данных — Геннадий Яковлев (FINMENTOR), г. Кишинёв, Молдова. … cfo@finmentor.md» |
| `cash-flow (9).html:68` | "Data controller — Ghennadi Iacovlev (FINMENTOR), Chișinău, Republic of Moldova … cfo@finmentor.md" |
| `index.html` JSON-LD | `Organization` "FINMENTOR", `founder` `Ghennadi Iacovlev`, `email` `cfo@finmentor.md` |

This is consistent with the owner's decision — a natural person in Moldova, no separate legal
entity — and it supplies both values the decision left as `OWNER_INPUT_REQUIRED`. **It has not been
adopted automatically.** The owner said `OWNER_INPUT_REQUIRED`, and a name and a contact address on a
legal notice are the owner's to confirm, not an agent's to infer from another page. What is reported
is the finding; the decision stays open.

Three conflicts the owner should see before deciding:

1. **The live notice claims a different legal basis.** `privacy.html` §6: «Обработка осуществляется
   на основании вашего **согласия**» — consent. The Premium candidate uses
   `pre_contractual_request`. Two different legal bases for overlapping processing is a real
   inconsistency, not a wording difference: consent is withdrawable and pre-contractual necessity is
   not, and the rights text differs accordingly.
2. **The live notice is self-declared unfinished.** Both `privacy.html` and `terms.html` carry, in
   the source: «NB: это шаблон. Перед публикацией рекомендуется проверить текст с юристом и
   подставить реальные данные оператора», and a closing note saying the document must be reviewed by
   a lawyer and aligned with Moldovan law and GDPR. It is already published.
3. **`cfo@finmentor.md` is a business address, not a dedicated privacy contact.** Usable, but a
   deliberate choice rather than a default.

### The controller decision, as implemented

| Field | Value |
|-------|-------|
| `controller_type` | `natural_person` — fixed, and a render with any other value is refused |
| `controller_full_name` | `OWNER_INPUT_REQUIRED` |
| `controller_privacy_email` | `OWNER_INPUT_REQUIRED` |

Both are **template slots**, not constants, and not hard-coded in workflow logic. `render()`
**refuses** to produce a notice while either is unfilled or still a placeholder — so the product
cannot be activated with a placeholder notice on screen even by accident. A gate asserts no literal
name, email address, phone number, address fragment, `SRL`, `IDNO` or registration number exists
anywhere in the module.

Both locales state explicitly that the controller is a natural person and that **no separate
FINMENTOR legal entity exists** — «Отдельного юридического лица FINMENTOR не существует; FINMENTOR —
наименование проекта.»

**`RESIDENTIAL / POSTAL ADDRESS DISCLOSURE = LEGAL REVIEW REQUIRED.`** No address is published or
invented. A natural-person controller may be obliged to give a contact address; a home address is
not obviously the right one, and that is a legal question, not an engineering one.

### Gap list under Law 195/2024

| # | Gap | Blocks |
|---|-----|--------|
| 1 | Controller name and privacy contact unconfirmed | customer activation |
| 2 | Postal/residential address obligation unresolved | customer activation |
| 3 | Legal basis unconfirmed, and inconsistent with the live site's consent claim | customer activation |
| 4 | Processors not named individually in the notice (Supabase, n8n, Google, Telegram are described by role, not by name) | legal review |
| 5 | No processing agreement recorded with any processor; **Supabase is an unnamed processor holding the acknowledgement store** | legal review |
| 6 | Cross-border transfer disclosed, but no transfer mechanism recorded | legal review |
| 7 | Retention for a *submitted* request stated qualitatively, not as a period | legal review |
| 8 | The live `privacy.html` is a self-declared unreviewed template, already published | independent of this work |
| 9 | Notice version `2026-08-29.v1-draft` is a draft version string | activation |

None of gaps 1–9 blocks technical work, endpoint integration, Premium UX testing or **RU UAT**.
All of 1, 2, 3 and 9 block **customer production activation**.

---

## 7. Deployment preparation

Prepared, not deployed. Every artifact is a `[CANDIDATE]`, carries retention-off settings where it
is a new workflow, and uses deploy-time placeholders for every production identifier.

| # | Item | Nodes | Structural sha256 | File sha256 |
|---|------|-------|-------------------|-------------|
| 1 | Gateway (TTL 72 h) | 13 | `8242bceb2f2f61a2…` | `0b85be549b4fc657…` |
| 2 | PUT `/miniapp/session` | 13 | `ac026ec13bd096df…` | `32d69e9d8148161c…` |
| 3 | POST `/miniapp/submit` | 17 | `7cb785987f412f69…` | `a13b57a5e6640dbe…` |
| 4 | Premium RU Concierge | 51 | `0f0664c13f2598c3…` | `fbfee119a3314cce…` |
| 5 | Lead Intake projection | 102 | `9759f73fd2943612…` | `6cea284e9c1d5c31…` |
| 6 | Premium RU Mini App | — | bundle `4b3c9e33c7050bb9…` | — |

### 1. Gateway — the whole delta is one line

Structural hash **identical before and after** (`8242bceb…`): no node added, none removed, no edge
changed. The exact diff, in full:

```
- const TTL_SECONDS = 1800;
+ const TTL_SECONDS = 259200;
```

Rollback: revert the constant in `scripts/build-miniapp-gateway.mjs` and rebuild; the pre-change
candidate is byte-reproducible from that one line. The bootstrap path, G5 claim and thirteen-node
shape are untouched — Gateway remains FINAL GO.

### 2–3. Endpoint candidates

Both refuse to emit if the P9-R2 flag pair appears, if privacy is not recorded before intake, or —
new this phase — if the privacy insert uses `ON CONFLICT` or does not target the `privacy` schema.
The submit candidate's insert is now a plain INSERT with 7 parameters. `__LEAD_INTAKE_WORKFLOW_ID__`
and `__PRIVACY_AUDIT_CREDENTIAL_ID__` remain placeholders.

### 4. Premium Concierge — one node replaced, spine untouched

The live Concierge is 51 nodes and almost all of them are the spine: the issuance gate, receipt
preallocation and readback, authority re-read and verdict, the stale- and unresolved-authority
branches, the transport worker, the internal handoff. Every P8/P9 hardening decision lives there and
every one is closed at GO. **Exactly one node changed** — `Build Bot Response`, 996 lines of legacy
state machine → 473 lines generated from `tg-state-machine.js` and the `TG_COPY` block of
`branches.js`. Structural hash identical; connections identical; unrelated drift NONE.

The node body is **generated from the gated modules**, not retyped, so the deployed logic and the
tested logic are one artifact.

**The defect it fixes.** The deployed `Get Bot Session` does, unconditionally:

```js
const isStart = text === '/start';
if (isStart) reset = 'start';
```

so `/start` after a committed submission silently archives `lead_id`, clears consent and wipes every
qualification answer. `qa/premium-ux-concierge-candidate.test.mjs` **executes the generated node**
(27 assertions) and confirms: `/start` on a committed cycle lands on the terminal screen with
`lead_id` and `cycle_id` intact; no input in the entire vocabulary — 13 callbacks plus commands plus
free text — returns a committed cycle to qualification; a stale inline button cannot rotate one;
exactly **two** actions can rotate a cycle, both confirmed, and a rotate archives a lead only when
one exists in the current cycle.

«Открыть бриф» is the only `web_app` button, its URL is `__PREMIUM_MINIAPP_URL__`, and every other
button carries a callback within the 64-byte Telegram cap.

**Named gap in this candidate.** The context-extraction step does not exist in the Concierge spine,
so `context_extracted_json` is never populated and `TG_CONFIRM_CONTEXT` never renders. Rather than
show a screen headed «Проверьте, правильно ли FINMENTOR понял ваш контекст.» with nothing under it,
the adapter falls through to `TG_OPEN_BRIEF`. The state and its copy are implemented and tested; the
extraction that feeds them is **not built**. See §8.

### 5. Lead Intake projection — two nodes, additive only

Structural hash identical. `Build Pipeline Row` gains three fields; `Save to Pipeline` gains three
mapped values and three schema entries. 100 of 102 nodes byte-identical; connections identical.

`qa/premium-ux-projection-candidate.test.mjs` executes the patched node (12 assertions). The check
that matters: a lead which never went through the Premium Mini App writes **three empty strings**,
not `undefined` — in a `defineBelow` mapping `undefined` renders as the literal text `undefined` in
a cell, and every legacy web-form lead takes that path. The writer stays `defineBelow`;
`autoMapInputData` (F16) appears nowhere.

### 6. Premium RU Mini App

`app-premium/` — `index.html`, `app.css`, `app.js` (19 screens / 19 APP states), `content.js`
generated from the locked content contract. Not deployed; the live Mini App is unchanged.

### Regression checks across every candidate

- **P9-R2 / P9-R4 flag pair** (`alwaysOutputData` + `continueErrorOutput`): absent from all 13, 13,
  17, 51 and 102 nodes. Each builder refuses to emit if it reappears.
- **Leak keys** (`cachedResultUrl`, `cachedResultName`, `activeVersion`, `versionId`, `pinData`):
  absent. The live exports carried 48 and 26 display caches respectively — stripped from the base as
  well as the candidate, so the drift check compares like with like rather than mistaking a stripped
  cache for a change.
- **Retention**: off on new candidates; existing settings preserved on patched ones.
- **Privacy**: no candidate carries personal data, a bot token, initData, a signature or a hash.

### Rollback

| Item | Rollback |
|------|----------|
| Gateway | one-line revert + rebuild |
| Endpoints | additive on their own routes; delete the workflows |
| Concierge | re-import `n8n/history/mppzthlkSJFr6Kle.pre-premium-ux.json` (51 nodes, sha256 `809ecfc793e7f376…`); one node body to restore |
| Lead Intake | re-import `n8n/history/QmIyEW2ZEqKregmN.pre-premium-projection.json` (102 nodes, sha256 `2a65438bd1e16ee6…`) |
| Mini App | the live Mini App is untouched |
| Pipeline sheet | snapshot `1B1ZTvpVyx-de6ck8wfw7asv8Jur9eGheJJEpx__eyNQ` |
| Privacy store | admin acting as `privacy_audit_owner`; store is at 0 rows |

---

## 8. Remaining blockers

Ordered by what each one blocks.

### Blocks deployment (not the eight gates)

1. **`PRIVACY WRITER CREDENTIAL = OWNER ACTION REQUIRED.`** `privacy_audit_writer` still holds the
   placeholder password set at creation. `scripts/provision-privacy-writer-credential.mjs` rotates it
   and creates a dedicated n8n Postgres credential in one run. It is deliberately **not run
   automatically**: it mints a secret, and a secret is the owner's to hold, not something to create
   unprompted in a live tenant and then convey. It needs `PRIVACY_PG_HOST` and `PRIVACY_PG_USER`
   (the pooler username form differs between Supabase connection modes and must not be guessed), and
   prints a verification INSERT that proves the credential without leaving a row.
2. **Deploy-time placeholders**: `__LEAD_INTAKE_WORKFLOW_ID__`, `__PRIVACY_AUDIT_CREDENTIAL_ID__`,
   `__PREMIUM_MINIAPP_URL__`. None may be committed into a candidate.

### Blocks the full Premium conversational flow

3. **Context extraction is not built.** `TG_CONFIRM_CONTEXT` is implemented, gated and unreachable
   in this candidate, because nothing populates `context_extracted_json`. Free text is captured and
   stored verbatim; the client simply is not asked to confirm a summary. This is a product decision
   to make, not a defect to patch quietly: extraction means an AI step, and everything it proposes is
   `ai_inferred` — which, per the draft contract, may prefill but may never skip a question.

### Blocks customer activation (does NOT block RU UAT)

4. **`CONTROLLER IDENTITY = OWNER INPUT REQUIRED`**, notwithstanding §6's finding.
5. **`RESIDENTIAL / POSTAL ADDRESS DISCLOSURE = LEGAL REVIEW REQUIRED`.**
6. **Legal basis unconfirmed**, and inconsistent with the live site's consent claim.
7. **Notice version is a draft string** (`2026-08-29.v1-draft`).
8. Gaps 4–8 of §6 — processors unnamed, no processing agreements recorded, no transfer mechanism,
   submitted-request retention not stated as a period, and the already-published `privacy.html`
   carrying its own "not reviewed by a lawyer" note.

---

## 9. What was NOT done, deliberately

- Nothing merged. Nothing activated for customers.
- The live Concierge and live Mini App were not replaced.
- No workflow was deployed to n8n. The two live reads were reads.
- No column was deleted from `Bot_Sessions`; F17's rule that emptiness is never a deletion criterion
  still holds, and it applies to `BP:BR` too.
- No legal identity, address, registration number or article citation was invented.
- No test row was written to the privacy store. It is at zero rows, and in an append-only store a
  proof row would be permanent.
