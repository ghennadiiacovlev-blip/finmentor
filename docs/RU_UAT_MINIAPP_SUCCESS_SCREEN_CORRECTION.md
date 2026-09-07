# RU Owner UAT — the first successful submission, and the two things the success screen got wrong

**Date:** 2026-08-30 (late evening pass)
**Branch:** `feat/miniapp-b21c-live-prereqs`
**Scope:** the Mini App host `KBD7Q94QQnlzgYKJ` — `Serve Page`.responseBody, and nothing else.
**Status:** deployed owner-only. Not merged. Not customer-activated.

The owner reached «Принято» for the first time. This pass verifies what the server actually did,
and then corrects the last screen the client sees. No business logic moved.

---

## 1. The submission, from the stores rather than from the screen

One brief, two attempts, one of everything. Read fresh, after the fact.

| | |
|---|---|
| `app_session_id` | `AS-6703ea8d5da844f5a05…` — the only row in `MiniApp_App_Sessions` |
| `submission_key` | `sub_37643f0937d982e1c7e8978f82264936` — derived, not stored |
| privacy rows for that key | **1** (whole table: 1 row, 1 distinct key) |
| receipt rows for that key | **1**, `COMMITTED` |
| receipt `canonical_lead_id` | `FIN-1788113619104-582` |
| Lead Intake business result | `{ok: true, lead_id: FIN-1788113619104-582, mode: new, priority: HOT}` |
| Pipeline rows for that lead | **1** (`request_id` = the submission key) |
| session `state` / `lead_id` | `submitted` / `FIN-1788113619104-582` |
| second lead / row / receipt / acknowledgement | **none of any kind** |

**RU END-TO-END SUBMIT = PASS.**

### The exactly-once property, demonstrated in production rather than modelled

The two attempts are visible in the executions, and they are the reason this is proof rather than
a lucky first run:

```
17:00:53Z  exec 4710  privacy row WRITTEN, then Lead Intake refuses at the receipt gate
                      → Internal Result (Unresolved), SUBMIT_UNRESOLVED, retryable
                      → Save to Pipeline NEVER RAN. No lead.
17:29Z     the caller-side receipt preallocation is deployed
18:13:38Z  exec 4837  the SAME session, the SAME derived key:
                      privacy insert hits the unique index → classified ALREADY RECORDED
                      receipt preallocated → claimed → Save to Pipeline → COMMITTED
                      → one lead, one Pipeline row, one receipt
18:13:41Z  session marked submitted, carrying the canonical lead id
```

The privacy row's `created_at` is **17:00:53**, an hour and twelve minutes before the lead. That is
the whole idempotency design working in the open: the acknowledgement was written once, by the
attempt that failed, and the retry recognised it instead of writing a second one. Both fixes from
the previous pass are proven live by that single line — the parameter binding (the row exists at
all) and the duplicate classifier (the retry read 23505 as ALREADY RECORDED rather than falling to
`PRIVACY_UNRESOLVED`).

### Two observations, neither actioned

**The premium NEW LEAD alert was NOT sent.** Traced on the tenant: `Telegram Lead Alert` is fed by
`Build Premium Telegram Brief` ← `Route by Lead Priority` ← `Restore Lead Context` ←
**`Respond New Lead`**, which sits on the FALSE branch of `IF Internal (New)` — the public webhook
path. The internal route ends at `Internal Result (New)` and reaches no alerting node at all. So
**every lead arriving through the Mini App or the Concierge is silent**, by construction, not by
failure. Lead Intake and Lead Alerts are fenced in this pass; this is recorded for a separate one.

**`Submission_Receipts` holds four READY orphans.** Ten rows: four `COMMITTED`, one `IN_FLIGHT`
and five `READY`, of which four carry no correlation id and no lead. They belong to submission keys
whose sessions no longer exist. They are inert — a receipt is only ever found by an exact key, and
these can never be claimed by anything — and the store is fenced, so nothing was done to them.

---

## 2. «Вернуться в Telegram» — what was actually wrong

**The handler was already correct and already deployed.** Read from the tenant, not from the repo:

```js
actions(btn(C.SUCCESS.primary, function () { if (tg && tg.close) { tg.close(); } }))
```

`btn()` binds it with `addEventListener('click', …)`; the page loads `telegram-web-app.js`; `tg`
resolves; `tg.ready()` and `tg.expand()` had already run, and the submission that produced the lead
proves `initData` was genuine. There was no missing handler to add. Whatever the owner's client did
with `web_app_close`, it did not do it — and no offline harness can prove otherwise, because the
only thing on this side of the call is the call.

So the correction is everything that CAN be made true here:

- **one Telegram close in the whole client.** `closeApp()` is the single integration point; the
  success, bootstrap-failure and session-expired screens all route through it. One place a client
  quirk can be handled, one thing for the gate to count;
- **it fails safely.** No `close` on the object, or no Telegram at all, and the tap does nothing
  worse than nothing — no throw, no state change;
- **it stops being a dead control.** If the close has not happened shortly after, the screen says
  «Если окно не закрылось, закройте его в верхней части экрана Telegram.» It is never part of the
  screen as first rendered, and it is text, not a second exit. A successful close takes the page
  first, so on a working client it is never seen.

No request, no draft write, no session write, no new cycle. Asserted, not asserted-in-passing.

---

## 3. «Приложенные материалы» was false, and the product already knew it

The client ticked «Cash Flow» to say a cash-flow report EXISTS. The server recorded exactly that:

```
documents_status  = «Указаны доступные материалы (файлы не приложены)»
selected_documents = «Cash Flow»
```

v1 has no upload control anywhere. **Only the last screen the client sees claimed a file had
crossed** — and the consultant's readiness line said the same, in the one place it would be read as
a fact about files.

### The copy is now chosen by the draft

| | |
|---|---|
| materials declared | «Консультант увидит информацию о компании, вашу задачу и какие материалы доступны до первого разговора.» |
| none declared | «Консультант увидит информацию о компании и вашу задачу до первого разговора.» |

The sentence is **replaced, not emptied** — an empty materials concept is never rendered. Spec §21
now carries both variants, §21.1 states the rule, and the forbidden wordings are named there so a
future edit has to argue with the spec rather than with a reviewer's memory.

**Readiness and the consultant brief moved with it:** «Материалы — указаны» / «Материалы — не
указаны», never «приложены». `meeting-brief.js` reads `REVIEW.materialsStatus`, so the consultant
brief followed from the one change. The DATA is untouched: `documents` still carries «Cash Flow»,
«Бюджет» and the rest, still means *the client says this is available*, still reaches the brief and
the Pipeline, and is still editable from the edit selector.

And «FINMENTOR изучит brief.» → «FINMENTOR изучит **бриф**.»

---

## 4. Gates

`qa/premium-ux-success-screen.test.mjs` — 18 assertions, driving the real `app.js` through a real
submit:

| | |
|---|---|
| `SUCCESS_TERMINAL` | one action, and it is leaving; the CTA causes no transition; no back control; no wording that offers qualification again |
| `SUCCESS_RETURN_TELEGRAM` | one tap = exactly one close; zero requests; zero draft and session mutation; repeated taps still send nothing; no `close` on the object fails safely; the hint appears only after a close that did not happen, and adds no second control; **exactly one `tg.close()` in the client**, with every terminal screen routed through `closeApp` |
| `SUCCESS_MATERIALS_COPY` | declared → the availability sentence; none → the sentence is replaced and no materials concept survives; an untouched field reads as none; neither variant contains «прилож» or «загруж»; the forbidden phrases are banned across the whole customer bundle; the declared list still reaches the brief unchanged |

`premium-ux-content` and `premium-ux-brief` now refuse «приложены» in the readiness wording and in
the consultant brief. One occurrence is deliberately left and pinned by an assertion: the privacy
consent line still reads «Передавая brief …» — consent copy this pass was told not to touch. The
gate fails if it changes, so the decision stays visible.

```
offline   57/57 gates, 2047 assertions, floors PASS
live      159 checks, nothing written
```

---

## 5. One expected drift, measured

`branches.js` is the single source of BOTH the client copy and the server taxonomy, and the submit
endpoint inlines it. A copy-only change therefore leaves the endpoint's inlined copy one revision
behind. Measured node by node against the tenant before deciding anything:

```
node sets identical        26 = 26
connections identical      yes
settings identical         yes
nodes that differ          Build Intake Payload, and only it
region that differs        between a 15 218-byte common prefix and a 29 588-byte common suffix
                           — REVIEW.materialsStatus, SUCCESS, CLOSE_HINT and their comments
```

The endpoint executes none of them: neither `draft-contract.js` nor `submit-projection.js` contains
a reference to `B.SUCCESS`, `B.REVIEW` or `B.CLOSE_HINT`. **The submit endpoint was not written to.**
It is fenced in this pass, the drift is inert, and refreshing it buys nothing that waiting does not.

`verify-miniapp-bootstrap-live.mjs` now says exactly that rather than failing on it: the client-only
blocks are cut from both sides and every remaining segment must still match **byte for byte, in
order**, with three standing guards — that each named block was actually located (so a rename cannot
silently widen the exemption), that the constants are unreachable from the projection, and that the
endpoint carries either the current copy or the copy it was deployed with. Mutation-proven: a single
added comment elsewhere in `branches.js` fails it, and renaming a client block fails it twice.

## 6. Rollback

```
.uat/KBD7Q94QQnlzgYKJ.pre-success-screen.json    the host exactly as it was before this write
```

PUT it back to `/workflows/KBD7Q94QQnlzgYKJ`. The deploy script refuses to run against a host that
has changed since that artifact was captured.

## 7. Still open

| | |
|---|---|
| the Mini App NEW LEAD alert | not sent, by construction — §1. Needs its own authorised pass |
| customer activation | BLOCKED — `docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md` |
| terminal-5xx alerting | GAP — `docs/SYSTEM_ALERT_COVERAGE_GAP.md` |
| «Передавая brief …» | the last Latin «brief» on a customer screen; consent copy, owner's call |
| `premium.current_setup` / `decision_horizon` | populated in the intake payload, **empty in the Pipeline row** — BP/BQ/BR did not receive them. Observed on `FIN-1788113619104-582`; Pipeline and Lead Intake are fenced |
