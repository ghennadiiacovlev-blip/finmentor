# RU Owner UAT — Mini App bootstrap, session hydration, and submit idempotency

**Date:** 2026-08-30
**Scope:** Telegram Web App open → Gateway bootstrap → `app_session_id` → session hydration →
submit → deterministic retry. Lead Alerts untouched.
**Status:** deployed to the three owner-only workflows. Not merged. Not customer-activated.

---

## 1. The startup trace, before

Read from the bytes the tenant was serving.

| step | status |
|---|---|
| `Telegram.WebApp.ready()` / `expand()` | **PRESENT** — at module load |
| initData acquisition | **PRESENT but unreachable** — `net.js` read `tg.initData` inside `bootstrap()`, which nothing called |
| `bootstrap()` call | **ABSENT** |
| `app_session_id` acquisition | **ABSENT** |
| draft / session load | **ABSENT** — `saveDraft()` exported, called by nothing |
| screen render | **PRESENT, WRONG ORDER** — `render()` ran at load, before any network call, so the entry screen was interactive with no session behind it |

`app.js` referenced `window.FM_NET` exactly twice: `configured()` and `submit()`.

### And a second defect behind the first

The Gateway validates the request **body** before it looks at the signature:

```js
const clientVersion = body.client_version;
if (ALLOWED_CLIENT_VERSIONS.indexOf(clientVersion) === -1) { return fail('CLIENT_VERSION_UNSUPPORTED', …); }
const locale = body.locale;
if (ALLOWED_LOCALES.indexOf(locale) === -1) { return fail('BAD_REQUEST', 'LOCALE'); }
```

`bootstrap()` sent `{ init_data }` and nothing else. **Even if it had been called it would have
returned 400 `CLIENT_VERSION_UNSUPPORTED` without verifying anything.** Confirmed live against the
deployed Gateway.

---

## 2. Two more defects found by executing rather than reading

**A field the client wrote and the server refused.** `app-premium/app.js` declared `contact_name`
and wrote it into every draft. `draft-contract.js` listed it in `APPROVED_CARRIED` — the fields that
may skip on `telegram_carried` — but omitted it from the `FIELDS` map, so `validateDraft` rejected
the draft as `UNKNOWN_FIELD:contact_name`. `assertSubmittable` runs `validateDraft`, so **every
submission would have been refused**, reporting an empty draft while naming the wrong cause.

**An envelope marker nothing accepts.** `submit-projection.js` emitted
`source: 'telegram_miniapp_premium'`. Lead Intake's `Internal Auth Entry` compares with `===`
against `'telegram_miniapp'` and refuses anything else as `ENVELOPE_SOURCE_INVALID` before reading
the payload. The Concierge sends the correct marker; this module had never been run against the
authenticator.

Both are closed, and both now have a gate: `qa/premium-ux-draft.test.mjs` holds the client's field
list against the server's field map, and `qa/premium-ux-submit-idempotency.test.mjs` pins the
marker.

---

## 3. The bootstrap contract, as deployed

```
tg.ready(); tg.expand();
  → state = APP_STARTING            (no interactive control exists)
  → FM_NET.bootstrap(locale)        ONE call, memoised in net.js
       body: { init_data, client_version: 'b2.1.0', locale: 'ru'|'ro' }
  → ok    → set('locale', <what the SERVER stored>) → APP_BOOTSTRAP (entry screen, «Начать» live)
  → fail  → APP_BOOT_FAILURE        (never the submission-failure screen)
```

The Gateway remains the sole authority on signature verification, Telegram freshness, the G5 replay
claim, session issue and the 72 h TTL. The client re-implements none of it and reads
`initDataUnsafe` only for the greeting and the locale hint — never for trust.

**Raw initData disappears after bootstrap.** The only reference lives in one local, cleared as soon
as the body is built; the body's copy is cleared once the request has been serialised. Asserted
against the module's whole public surface and against every later request.

### It cannot replay accidentally

`bootstrap()` returns a memoised promise, so the request happens once per page lifecycle whatever
calls it. Proven for: initial open, screen navigation, field edit, session save, review, submit, and
direct repeat calls — **1 request in every case.**

A failed bootstrap is **never retried with the same signed context.** A transport failure leaves it
unknowable whether G5 claimed the key, and the client cannot mint fresh initData. So the bootstrap
failure screen offers reopening from the chat, not a retry.

---

## 4. Session hydration

`flushDraft()` writes the draft to `PUT /miniapp/session` on every screen transition, against the
authoritative `app_session_id` and nothing else. One write in flight at a time; the newest state
wins; a transient failure leaves the draft dirty so the next transition rewrites it. `submit()`
awaits `draftSettled()`, so the server can never be asked to project a draft it has not been told
about.

Proven: provenance survives the write (`user_explicit`, `telegram_carried`, and `ai_inferred` stored
but still non-skippable); `contact_channel` survives; the write body is exactly
`{app_session_id, step, fields}`; no CRM write occurs anywhere on the path.

A refused session — `SESSION_EXPIRED`, `SESSION_INVALID`, `NOT_AUTHORISED`, `SUBMIT_IN_PROGRESS` —
routes to `APP_SESSION_EXPIRED`, never to the submission-failure screen and never to a Retry.

---

## 5. Three failure classes, three screens

The deployed build had one. A session that never existed produced «Заявка пока не отправлена …
Повторно проходить вопросы не нужно» — a submission-failure screen for a client who had not
submitted anything, offering a retry that could only refuse again.

| class | screen | retry? |
|---|---|---|
| bootstrap | `APP_BOOT_FAILURE` — «Не удалось открыть форму» | no; reopen from the chat |
| session | `APP_SESSION_EXPIRED` — «Время сессии истекло» | no; reopen from the chat |
| submission | `APP_FAILURE` — the approved §22 copy | **yes, when the server states retryable** |

The two new copy blocks are in `branches.js`, generated into `content.js`, and gated.

---

## 6. D3–D7 — one mechanism, not five patches

They are one defect: **nothing derived a submission identity.**

```
submission_key = "sub_" + sha256("miniapp:" + app_session_id).slice(0, 32)
```

STABLE across retries — the session does not change when the client presses Retry.
DISTINCT across sessions — the session id is 32 random bytes from the Gateway.
DERIVED, never minted and never stored — no row to lose, no counter to race, and a retry cannot
invent a second identity because there is nothing to invent from. It matches `^sub_[0-9a-f]{32}$`,
the shape **Lead Intake's own receipt machine already enforces**, so the existing idempotency
receipt does the exactly-once work rather than a second mechanism being built beside it.

| | before | after |
|---|---|---|
| **D3** | `Build Intake Payload` returned `{ placeholder: "built from …" }` | the gated `submit-projection.js` is inlined verbatim and called; the gate requires a byte match |
| **D4** | `submission_key` read and never emitted → `''` for every submission against a UNIQUE index | derived in `Submit State` |
| **D5** | plain INSERT, failure swallowed by `continueRegularOutput`, flow continued into Lead Intake | `Privacy Verdict` reads the outcome: insert ok **or** 23505 means exactly one row exists; anything else is `PRIVACY_UNRESOLVED` 503 and the flow **stops** |
| **D6** | `MiniApp_App_Sessions` had no `lead_id` | column added; `Mark Submitted` writes it |
| **D7** | a committed replay answered `{ok:false, ALREADY_SUBMITTED}`, which the client downgraded to `BAD_RESPONSE` and rendered as a failure | answers `{ok:true, already:true, lead_id}` — the truthful answer |

### The privacy store, and why the unique index is the read

`privacy_audit_writer` holds **INSERT and nothing else** — measured, not assumed:

```
grantee                privilege
privacy_audit_writer   INSERT
```

So the endpoint cannot read the store to find out whether a row exists, and cannot use
`ON CONFLICT DO UPDATE` either. What it can do is insert and read the outcome, and the unique index
on `submission_key` turns that into a complete answer. The index is the read, performed by the
database under a role that cannot read — a better place for it than any query this workflow could
run.

---

## 7. Proof

`qa/premium-ux-submit-idempotency.test.mjs` does not sample the mechanism; it **executes the
resolved graph node by node** — every Code node as written, every n8n expression as written —
against an in-memory world whose privacy table has the unique index and whose role has INSERT only.

The invariant is asserted as a property over interruption points: the submission is driven to
completion, then driven again after a failure injected at **each stage in turn**, and after every
one of them the world must hold exactly one of each.

| scenario | result |
|---|---|
| A — failure before the privacy write | retry writes exactly one row; one lead |
| B — privacy written, downstream fails | retry writes **no** second acknowledgement |
| C — Lead Intake commits, the answer is lost | retry resolves the committed lead; **no** second lead |
| D — Pipeline committed, client response lost | retry answers ok:true with the same lead |
| E — six repeated submissions | 1 privacy row, 1 receipt, 1 lead, 1 Lead Intake invocation |

---

## 8. Three more defects the LIVE probe found after deployment

Offline gates do not see what a tenant does with a template.

1. **The terminal responder returned HTTP 200 with an empty body.** A ternary inside
   `{{ JSON.stringify(… ? {…} : {…}) }}` fails silently and produces nothing. Every refusal now
   carries `__status` and `__response`, and the responder does one thing it cannot get wrong.
2. **A missing acknowledgement was flattened to `BAD_REQUEST` 400.** The shape branch ended at a
   responder that answered a hard-coded code, so a client that had not consented was told its
   request was malformed. This file already warned about that flattening; the warning had not been
   applied in that one place. Now 409 `CONSENT_REQUIRED`.
3. **An unknown session reached no responder at all.** A Data Table `get` that matches nothing
   produces no items, and *a node with no input items is not executed*. So the verdict node never
   ran and the webhook answered an empty 200 — which the client reads as `BAD_RESPONSE` with
   `retryable:true`, offering a Retry for a session that can never exist. Both endpoints were
   affected. `alwaysOutputData: true` on the two reads closes it.

On (3), the endpoint gate had a blanket ban on `alwaysOutputData`. That ban is what left the hole
open: P9-R2's hazard is the **pair** — `alwaysOutputData` together with `continueErrorOutput`, which
fires both branches on a failure. With `continueRegularOutput` there is one output. The gate now
forbids the pair rather than the flag.

---

## 9. Not touched

G5 semantics, the Telegram production key, `MAX_AUTH_AGE_SECONDS`, the 72 h TTL, the owner gate on
both endpoints, the Premium Telegram copy, Lead Alerts, the Pipeline schema, the legal notice, and
the non-owner legacy flow. All asserted after deployment.

**Stores after every probe: `privacy_acknowledgements` 0 rows; `telegram_initdata_replays` 4 rows,
all predating the Mini App host. Nothing was written.**

---

## 10. What is proven where

| | proven by |
|---|---|
| the startup sequence, the bootstrap body, one-call-per-lifecycle, initData disappearance, the three failure classes, the retry CTA | `qa/premium-ux-bootstrap.test.mjs` — 29 assertions against the real client |
| D3–D7 and scenarios A–E | `qa/premium-ux-submit-idempotency.test.mjs` — 26 assertions, executing the resolved graph |
| the deployed bytes ARE the gated sources; the Gateway body contract; every refused path | `scripts/verify-miniapp-bootstrap-live.mjs` — 73 live checks |
| the live stores behave as modelled | the unique index and the role grants were read from the live database; Lead Intake's receipt machine was proven live in P9-R4 |
| **a successful end-to-end submission** | **not yet — it needs genuine Telegram-signed initData, which only the owner can produce** |

Offline suite: **53/53 gates, 1970 assertions, floors PASS.**

---

## 11. Rollback

```
.uat/KBD7Q94QQnlzgYKJ.pre-bootstrap.json     Mini App host
.uat/ELiPdw4mdxQbBaan.pre-idempotency.json   submit endpoint
.uat/Hxje3Kel6nLLod5B.pre-empty-read.json    session endpoint
```

Each is the workflow exactly as it was before this pass. None is overwritten by a redeploy — the
deployed state is recorded separately — so the rollback keeps pointing at the pre-pass state however
many times a correction is made. To revert, PUT the body back to `/workflows/<id>`.

---

# Cross-reload draft resume (2026-08-30, second pass)

## The contradiction

The approved copy promises «У вас есть незавершённый бриф» and «Можно продолжить с того места,
где остановились — подтверждённые данные сохранены», and the app session has a 72 h TTL. The
Gateway minted a NEW session on every open, so closing the Mini App and reopening it silently
lost the brief.

A new Telegram-signed context is not a new business request. A new brief comes from an explicit
new application cycle.

## What did not move

Everything before the claim. Signature verification against the Telegram production key,
`MAX_AUTH_AGE_SECONDS = 900`, the G5 replay claim and its `ON CONFLICT (replay_key) DO NOTHING`,
the store-outage 503 branch, the single credential, the 32-random-byte session id, the 72 h TTL,
zero execution retention. **Twelve nodes byte-identical**, asserted by the deploy script before
the write and by the live verifier after it.

The change is entirely downstream of a claim that has already been won.

## The mechanism

```
IF Claim Won  T→ Build App Session      (mints a CANDIDATE, unchanged)
                → Read User Sessions    (all rows for this telegram_user_id)
                → Resolve Session       (the authoritative rule)
                → IF Create Session
                    T→ Build Session Row → Create App Session
                       → Read Back Sessions → Finalise Session → Respond Bootstrap OK
                    F→ Respond Bootstrap OK        (resumed)
```

**The authoritative rule**, applied identically by `Resolve Session` and `Finalise Session`:
rows for this `telegram_user_id` AND this `cycle_id`, not expired, in state `draft` or
`submitted`, ordered by `created_at` DESC then `app_session_id` DESC. The first is authoritative.

## §4 — the storage constraint, reported rather than assumed

**The n8n Data Table has no unique index.** First-creation therefore cannot be made atomic inside
it, and no arrangement of reads and writes changes that. The minimum constraint that would
prevent a duplicate row is a unique key on (telegram_user_id, cycle_id) for live sessions, which
the Data Table does not offer.

What CAN be made exact — and is — is which row is AUTHORITATIVE. The rule above is a **total**
order over the data, computed identically by every concurrent execution from the same rows. So:

- **Sequential** opens create zero extra sessions: the read finds the existing one.
- **Genuinely concurrent** opens can each insert once. Both then re-read the same two rows and
  both return the **same** winner. Both clients write to the same draft.
- The losing row is never handed to anyone, can never win a later evaluation, and expires with
  its TTL. It is inert, not merely unlikely.

The alternative — a Postgres pointer table with a unique index — was considered and rejected as
a second store to keep consistent for a bound this rule already holds. `SELECT`-then-create
without arbitration was never on the table.

## §5 — the race, proven

`qa/premium-ux-resume.test.mjs` executes `Resolve Session` and `Finalise Session` extracted from
the built Gateway. Two arms each win their own G5 claim, each read an empty store, each mint, and
both then evaluate the same two rows: **both return the same `app_session_id`**. Ten later opens,
in alternating order, return the same one. The rule is also asserted over **all six permutations**
of three live rows, and over identical `created_at` values, to prove the order is total rather
than an artefact of how the store happened to return the rows.

## §6 — the cases

| | |
|---|---|
| A fill and save | the draft is written on every screen transition |
| B close completely | nothing local is authority; the draft is server-side |
| C reopen with a NEW signed context | G5 accepts it, claims it, and the Gateway resolves the SAME brief; prior answers present |
| D reload | same path, same result |
| E 30 minutes later | same draft |
| F within 72 h | same draft |
| G after TTL expiry | not revived — expired rows are excluded; a fresh session is minted |
| H «Начать заново» | clears the brief in place and writes the empty draft through; same session, same TTL, no new signed context |
| I after a committed submission | reopens to APP_SUCCESS. Never back into qualification. |

## §7 — provenance

The draft is copied VERBATIM on hydration: value, `source`, `confirmed`, `at`. Rewriting `source`
would turn a value the client gave into one the system guessed, or the reverse — and the skip rule
reads exactly that field. Asserted field by field, and specifically: `user_confirmed` still
satisfies its field after a reopen; **`ai_inferred` is still non-skippable**.

A malformed stored draft is shape-checked in `net.js` and again on hydration: a field that is not
an envelope is skipped and the valid fields beside it still hydrate.

## §8 — no side effects

Resume performs no write of any kind. The only Data Table writer in the Gateway is
`Create App Session`, reachable only through `IF Create Session`'s TRUE branch — asserted by
walking the graph with that node removed. Measured after every probe: **`MiniApp_App_Sessions` 0
rows, `privacy_acknowledgements` 0 rows, replay ledger 4 rows, newest 2026-08-29 08:23 UTC**, all
predating the Mini App host.

## §10 — the client contract

The client sends `{init_data, client_version, locale}` and nothing else. It never sends a Telegram
user id or a cycle id, and the resolver reads no request body — asserted as a property access, not
as a word. The answer carries `{ok, app_session_id, expires_at, locale, state, resumed, draft}`
and no identity. **No browser storage is used for anything, let alone for authority.**

## §9 — change control

```
structural before : efd1edec8cfcd316d92f4dd97b02d946
structural after  : 2f5be399f43299a6e39ad74345974549
+6 nodes  Build Session Row, Finalise Session, IF Create Session,
          Read Back Sessions, Read User Sessions, Resolve Session
rewritten Respond Bootstrap OK
frozen    12 nodes byte-identical
route     unchanged, webhookId carried across
```

After the write, live: the forged/malformed battery — 14 cases — is still refused **before the
claim**, and none of them minted a session. Replay-409 on identical signed bytes is not reachable
from here (it needs a genuine signature, which only Telegram can produce); it stands on the
unchanged `ON CONFLICT (replay_key) DO NOTHING` plus `Claim Verdict` reading `claimed`, both
frozen and gated, and on the P9 live proof.

## What this pass did NOT close — RECORDED AS A CUSTOMER-PRODUCTION BLOCKER

```
RU OWNER UAT        = READY
CUSTOMER PRODUCTION = BLOCKED ON AUTHORITATIVE CYCLE PROJECTION
```

**`cycle_id` is `''` at bootstrap.** The Gateway cannot resolve the authoritative application
cycle: it lives in `Bot_Sessions` (Google Sheets), reachable only by the Concierge and Lead
Intake, and giving the Gateway a Sheets credential would widen the most security-critical surface
in the system for a UX behaviour.

So the resume authority in production today is effectively `telegram_user_id + ''`, not the
intended `telegram_user_id + authoritative cycle_id`. The key is already written and exercised as
the pair; what is missing is the value, not the mechanism.

Accepted for OWNER-ONLY RU UAT. The full record — consequences, the six-point customer-activation
gate, the preferred projection architecture and the open questions that come with it — is in
**`docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md`**. It is not implemented, and is not to
be implemented as part of this pass.

Two consequences worth carrying in the head while running the UAT:

- an explicit cycle rotation in the Telegram bot, followed by reopening the Mini App, can still
  resume the old unfinished draft. The escape hatch is «Начать заново» on the resume screen;
- the resolver gives one deterministic authoritative winner, but the Data Table does not enforce
  physical uniqueness, so a concurrent first-open can leave an inert orphan row that expires with
  its TTL.

What holds the line meanwhile is the owner gate, enforced server-side on both endpoints against
the identity the SERVER stored at bootstrap. `qa/premium-ux-resume.test.mjs` ties the two
together: while `cycle_id` is empty, removing that gate turns the suite red.

## Gates

- `qa/premium-ux-resume.test.mjs` — 19 assertions, executing the built Gateway's resume nodes
- `qa/premium-ux-bootstrap.test.mjs` — 38 assertions, 9 of them the resume path through the real client
- `scripts/verify-miniapp-bootstrap-live.mjs` — 139 live checks, nothing written

Three existing gates were updated rather than worked around: the store-failure harness now
neutralises **every** Data Table node (derived from the Gateway, so the next one added is covered
without anyone remembering); the TTL gate now asserts the expiry is COPIED from a stored row
rather than read from one specific node; the Gateway gate's lead-content scan tripped on the word
"answers" in a comment, which was reworded rather than the scan weakened.

Offline suite: **54/54 gates, 1998 assertions, floors PASS.**

## Rollback

```
.uat/nTZHLbv2KFggdhh5.pre-resume.json        Gateway
.uat/KBD7Q94QQnlzgYKJ.pre-bootstrap.json     Mini App host
.uat/ELiPdw4mdxQbBaan.pre-idempotency.json   submit endpoint
.uat/Hxje3Kel6nLLod5B.pre-empty-read.json    session endpoint
```
