# RU Owner UAT — Mini App defects A1–A3

**Date:** 2026-08-30
**Branch:** `feat/miniapp-b21c-live-prereqs`
**Surfaces read:** the deployed Mini App host `KBD7Q94QQnlzgYKJ`, the Gateway `nTZHLbv2KFggdhh5`,
the session endpoint `Hxje3Kel6nLLod5B`, the submit endpoint `ELiPdw4mdxQbBaan`, the
`MiniApp_App_Sessions` Data Table, `privacy.privacy_acknowledgements`, and
`public.telegram_initdata_replays`.

Nothing in this document is inferred from a mockup. Every claim names the artifact it came from.

---

## 0. The deployed page is the repo page

The host serves one inlined HTML document from `Serve Page`. Extracted and compared against a fresh
`node scripts/build-miniapp-host.mjs`, the two are **byte-identical once the three endpoint
placeholders are substituted** — 83 111 bytes live against 82 988 in the candidate, the difference
being exactly the three injected URLs.

That matters for everything below: reading `app-premium/` is reading production.

---

## A3. ROOT CAUSE — one sentence

> **The Mini App never calls `FM_NET.bootstrap()`, so it holds no `app_session_id`; `submit()`
> therefore fails its own first guard locally with `SESSION_INVALID, retryable:false`, which is
> both why the submission failed and why the retry button is absent.**

### The proof, in four independent pieces

**1. The client only ever makes one of its three network calls.**
`app-premium/app.js` references `window.FM_NET` exactly twice — `configured()` at line 727 and
`submit()` at line 733. `bootstrap()` and `saveDraft()` are exported by `net.js` and called by
nothing. There is no code path in the deployed page that mints a session or persists an answer.

**2. `submit()` therefore short-circuits before any HTTP request.**

```js
// app-premium/net.js
function submit(ack) {
  if (!session.id) { return Promise.resolve(fail(CODES.SESSION_INVALID, false)); }
```

`session.id` is only ever assigned inside `bootstrap()`. It is `''`.

**3. `retryable:false` is what removes the button.**

```js
// app-premium/app.js — scrFailure()
var canRetry = !lastFailure || lastFailure.retryable !== false;
...
if (canRetry) { s.appendChild(actions(retry, back)); } else { s.appendChild(actions(back)); }
```

The failure screen the owner saw — «Заявка пока не отправлена» with only «Вернуться к резюме» — is
the `else` branch. The retry button is already written, already correct, and correctly suppressed.

**4. The stores agree that no request was ever made.**

| store | expected if bootstrap had run | actual |
|---|---|---|
| `MiniApp_App_Sessions` (Data Table `LRme88caqxFzTLqW`) | one row per Mini App open | **0 rows** |
| `privacy.privacy_acknowledgements` | one row per submit attempt | **0 rows** |
| `public.telegram_initdata_replays` | a claim per bootstrap | 4 rows, newest `2026-08-29 08:23 UTC` |

The host workflow was deployed at `2026-08-29 18:02 UTC` and has served the page seven times since
(executions 4476–4478, 4500–4502). Every replay-ledger row predates the host's existence — they are
the B.2.1-C Gateway Test Page canary from that morning. Not one Mini App session has ever been
minted.

Note that the Gateway, session and submit workflows all carry
`saveDataSuccessExecution: "none"` and `saveDataErrorExecution: "none"`, so the absence of
executions for them proves nothing on its own. The three stores do.

---

## A2. SUBMIT FAILURE — the answers the brief asked for

| question | answer |
|---|---|
| exact failed endpoint / node | **None.** No endpoint was reached. The failure is client-side, in `net.js submit()`. |
| exact response code / error code | `SESSION_INVALID`, `retryable: false`, produced locally. No HTTP status exists. |
| before or after privacy acknowledgement? | **After.** `submitAck` is stamped in `submit()` before `FM_NET.submit()` is called, so the client believes consent was given. Nothing was transmitted. |
| was Lead Intake called? | **No.** |
| was a lead created? | **No.** |
| does a privacy acknowledgement exist? | **No.** `privacy.privacy_acknowledgements` is empty. |
| is retry safe and idempotent? | **NO — see below.** |
| why is «Повторить отправку» absent? | `retryable:false` on `SESSION_INVALID`. The button exists and is deliberately suppressed for a refusal that would refuse again. |

### RETRY IDEMPOTENCY = **FAIL**

The brief says: *if retry is NOT safe, STOP and report the idempotency defect instead of exposing
the button.* Retry is not safe. Five defects in the deployed submit endpoint, any one of which is
disqualifying.

**D3 — `Build Intake Payload` is a literal placeholder.**

```js
// ELiPdw4mdxQbBaan / Build Intake Payload — deployed
return [{ json: { placeholder: "built from $('Submit State').first().json.draft" } }];
```

`Call Lead Intake` would be invoked with that object. The endpoint is a scaffold, not an
implementation.

**D4 — `submission_key` is never computed, so every submission shares one key.**
`Build Privacy Record` reads `v.submission_key` from `Submit State`. `Submit State` never emits it.
The value written is `''`. `privacy.privacy_acknowledgements` carries
`privacy_ack_submission_key_uidx UNIQUE (submission_key)`, so the first submission of any session
writes `''` and **every subsequent submission of every session raises 23505**.

**D5 — the privacy write cannot dedupe, and its failure is swallowed.**
The insert has no `ON CONFLICT` clause, and it cannot acquire one:
`scripts/deploy-premium-uat.mjs` deliberately refuses to deploy an endpoint whose privacy insert
uses `ON CONFLICT`, because the `FINMENTOR Privacy Audit Writer` credential cannot execute it. The
node carries `onError: continueRegularOutput`, so a duplicate-key failure **does not stop the
flow** — it continues into `Build Intake Payload` and `Call Lead Intake`. A lead can therefore be
created with no privacy acknowledgement row, which is the one thing the separate privacy store
exists to make impossible.

**D6 — the session table has no `lead_id` column.**
`Submit State` returns `lead_id: String(s.lead_id || '')` on the `ALREADY_SUBMITTED` path.
`MiniApp_App_Sessions` has ten columns and `lead_id` is not among them. A retry after a committed
submission cannot return the canonical lead id, so "return the prior canonical success" is not
implementable against this schema.

**D7 — a committed submission, retried, shows the client a failure.**
`Respond Submit Session Invalid` answers `{ok:false, error_code:"ALREADY_SUBMITTED"}` with HTTP
200. Client-side, `verdict()` sees `ok !== true`, finds `ALREADY_SUBMITTED` is not in `net.js`'s
`CODES`, and downgrades it to `BAD_RESPONSE` with `retryable:false`. The client renders «Заявка
пока не отправлена» over a submission the server has committed — the same class of defect as
showing «Обращение передано» over a failed write, inverted.

### What must be true before the retry button is exposed

1. `Build Intake Payload` builds the real payload from the stored draft.
2. `Submit State` derives and emits a `submission_key` from `app_session_id` — stable across
   retries, distinct across sessions.
3. The privacy write becomes idempotent **without** `ON CONFLICT` (read-before-write under the
   existing credential), and a failed privacy write **stops** the flow rather than continuing into
   Lead Intake.
4. `MiniApp_App_Sessions` gains `lead_id`, and `Mark Submitted` writes it.
5. `ALREADY_SUBMITTED` becomes a client-visible **success** — added to `net.js CODES` and mapped to
   `APP_SUCCESS` with the stored lead id — not a `BAD_RESPONSE`.
6. Only then: wire `bootstrap()` and `saveDraft()` into `app.js`.

Items 1–5 are business-logic and schema changes. This pass does not make them.

---

## A1. CONTACT CHANNEL

### State semantics — proven, not assumed

**Single-select.** Every artifact agrees:

- `app.js scrContact()` calls `set('contact_channel', o.id, …)`, which **replaces**; there is no
  array path, unlike `documents` and `current_setup` which push and splice.
- `requiredFor('APP_CONTACT')` returns `['contact_channel']` — one field.
- `editValue('contact_channel')` maps one id to one label.
- `docs/PREMIUM_UX_PHASE2_IMPLEMENTATION_CONTRACT.md` §APP_CONTACT: *"1 of 3 channels"*.
- The stored shape is a provenance envelope:
  `{ value: 'telegram'|'phone'|'email', source: 'user_explicit', confirmed: true, at: <iso> }`.

**Which row is actually selected:** the last one tapped. `is-selected` and `aria-pressed="true"`
were being applied correctly all along.

**Server-side stored value: none.** `saveDraft()` is never called (D1), so
`MiniApp_App_Sessions.draft_json` is empty for every session — of which there are none.

**CONTACT CHANNEL STATE = PASS** (semantics), with the persistence gap recorded as D1.

### Why all three rows showed a check mark

```js
// app-premium/app.js — BEFORE
function icon(name) { var s = el('span'); s.innerHTML = ICON[name]; s.style.display = 'flex'; return s; }
```

```css
/* app-premium/app.css */
.row .tick            { display: none; }
.row.is-selected .tick{ display: flex; }
```

An **inline style outranks every selector**. `.row .tick { display: none }` never applied, so the
check rendered on all three rows regardless of selection, and the loudest signal on the screen
carried no information. It was not being used as a row affordance by design — it became one by
cascade. The same defect affected `.card .tick`, so every card screen (scale, objective, problem,
outcome, horizon) and both multi-select screens showed checks on every option too.

### Four defects found, four fixed

| # | defect | fix |
|---|---|---|
| 1 | inline `display:flex` on every tick outranks `.row .tick{display:none}` | `icon(name, cls)` emits class `ic`; `.ic { display: flex }` loses to `.row .tick` (1 class vs 2) and to `.row.is-selected .tick` (3) |
| 2 | switching phone → email **kept** the typed phone as the authoritative email | any change of channel calls `clearContactValue()`, not only `telegram` |
| 3 | no validation at all — `"abc"` was an acceptable email | `contactValid()`: Moldovan national `0`+8 digits, or E.164 `+`+8–15; email shape + 254-char bound |
| 4 | **on phone and email, «Продолжить» could never enable.** The disabled state was computed once at render, and typing does not re-render — both branches were dead ends | an `input` listener on the field re-evaluates `contactReady()` |

Defect 4 is the one that would have stopped the UAT run outright, and no amount of visual work
would have surfaced it.

Selection was additionally reinforced with `box-shadow: inset 0 0 0 1px var(--line-selected)` on
`.row.is-selected` and `.card.is-selected` — the existing ivory token, doubled in weight, no new
colour and no layout shift. The approved visual system is otherwise untouched: selection stays
ivory, gold stays on the primary action only.

Copy added: two input placeholders, `+373 60 000 000` and `name@company.md`. Nothing in
`branches.js` was touched, so the gated contract is unchanged.

### Validation results

| case | before | after |
|---|---|---|
| Telegram selected | Continue enabled, no field | unchanged |
| Phone `069123456` | Continue **never enabled** | enabled |
| Phone `+373 69 123 456` | never enabled | enabled |
| Phone `06912345` (short) | never enabled | correctly disabled |
| Email `cfo@finmentor.md` | never enabled | enabled |
| Email `abc` | never enabled | correctly disabled |
| phone → email after typing a number | number retained, Continue **would have** enabled on a phone-as-email | value discarded, Continue disabled |
| all six transitions | only `→telegram` cleared | all six clear |
| hidden/browser-controlled mode | none | none — no `<select>`, no hidden input, no native radio, no form `name` |

**CONTACT CHANNEL VISUAL SELECTION = PASS** — deployed and verified on the tenant.

---

## Gate

`qa/premium-ux-contact-channel.test.mjs` — **17 assertions**, registered in `qa/run-all.mjs`,
floor recorded in `qa/assertion-baseline.json`.

It renders the real `app-premium/app.js` in a DOM shim and, among other things, exhausts every
sequence of up to three taps (39 sequences) requiring that at most one row is ever selected.

**It was run against the build that is live right now and fails 6 of its 17 checks**, naming all
four defects. A gate that passes on the broken code is not a gate.

---

## Deployment status

`scripts/deploy-miniapp-contact-fix.mjs` touches **one** workflow — the Mini App host — and nothing
else. It captures a rollback, reads the three endpoint URLs back out of the live page so the
redeploy cannot repoint the app, refuses to proceed if anything but the page body differs, and
verifies the deployed bytes from the tenant afterwards.

**DEPLOYED 2026-08-30 on owner authorisation.**

```
STEP 1  live page read: 83 111 bytes, sha256 55c9e4e402484555
        expected pre-hash matches: 0209d0a871b2ca1022341c855100b84c
        rollback written: .uat/KBD7Q94QQnlzgYKJ.pre-contact-fix.json
STEP 2  gateway / session / submit read back out of the LIVE page — unchanged
STEP 3  candidate page: 87 012 bytes, sha256 e3bf5ba09fd1997d; five fix markers present
STEP 4  route, response headers and graph identical; only the page body changes
STEP 5  PUT /workflows/KBD7Q94QQnlzgYKJ
STEP 6  deployed sha matches the candidate; active unchanged (true);
        the inline display is gone from the tenant
```

The pre-hash guard is not decorative: the script compares the live workflow against the rollback
captured at the dry run and refuses to write if anything moved in between, because this candidate
would silently revert whatever that change was.

### Verified on the tenant, not in the working tree

`scripts/verify-miniapp-contact-live.mjs` pulls the served page back down and extracts `app.js`
and `app.css` out of it. Both are byte-identical to the repo files — which is what makes
`qa/premium-ux-contact-channel.test.mjs`, all 17 assertions of it, a statement about the tenant
rather than about this checkout. It then re-checks the owner's acceptance list directly against
the served bytes: **24 checks, all passing.**

| owner acceptance item | evidence in the served page |
|---|---|
| CONTACT CHANNEL = SINGLE SELECT | `set('contact_channel', o.id, …)` assigns by replacement; nothing appends; the screen requires one field |
| selected row — surface/border | `.row.is-selected` carries `border-color`, `box-shadow: inset 0 0 0 1px`, `background: var(--surface-2)` |
| selected row — exactly one check | `.row.is-selected .tick { display: flex }` |
| unselected rows — no check | `.row .tick { display: none }`, `.card .tick { display: none }`, `.ic { display: flex }`, and **no inline display anywhere** |
| Telegram → no field | the note renders; no `fieldInput` call on that branch |
| Phone → phone field only | `type="tel"`, `inputmode="tel"` |
| Email → email field only | `type="email"`, `inputmode="email"` |
| switching updates the authoritative channel | `if (get('contact_channel') !== o.id) { clearContactValue(); }` |
| no stale contact survives | the telegram-only reset is gone; all six transitions clear |

Rollback artifact: `.uat/KBD7Q94QQnlzgYKJ.pre-contact-fix.json`. To revert, PUT it back to
`/workflows/KBD7Q94QQnlzgYKJ`.

---

## A4 — safety

Not modified, and verified not modified: G5 semantics, Telegram initData verification, the owner
gate (`OWNER_TELEGRAM_ID` in both endpoints), the 72 h session TTL, the Premium Telegram copy,
Lead Intake dedup fail-closed behaviour, the Pipeline schema, privacy append-only guarantees, and
the non-owner legacy Concierge path.

Full offline suite after the change: **51/51 gates, 1906 assertions, floors PASS.**

---

## Verdicts

```
CONTACT CHANNEL STATE          = PASS   (single-select proven; not persisted server-side — D1)
CONTACT CHANNEL VISUAL SELECTION = PASS   (DEPLOYED and verified on the tenant, 24 checks)
SUBMIT FAILURE ROOT CAUSE      = the Mini App never calls bootstrap(), so submit() fails its own
                                 SESSION_INVALID guard locally with retryable:false
RETRY IDEMPOTENCY              = FAIL   (D3–D7)
RETRY CTA                      = CORRECTLY SUPPRESSED — not exposed, per the brief
NO DUPLICATE LEAD              = PASS   (zero leads exist)
NO DUPLICATE PRIVACY ROW       = PASS   (zero rows exist)
RU MINI APP UAT                = NOT READY
```
