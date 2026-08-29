# P9 — B21C owner-only Gateway test surface

**2026-08-29. The retired B.2.1-A button is obsolete; a new owner-only launch surface is
deployed and the button is delivered. The positive proof itself is still unpressed.**

## 1. Why the old button 404s

The Telegram button the owner still had pointed at `GET /canary/b21a`, served by
`hGQAfPWBK75xeWco` ("FINMENTOR B.2.1-A Canary Page"). That workflow was deactivated at the
close of B.2.1-A, so the route answers *"webhook is not registered"*. That is the retirement
working, not a Gateway defect: the Gateway lives at a different path entirely and was never
reachable from that button.

The retired page and its launcher (`1Yw9LF6EJNCAYkQx`) remain **inactive and untouched**, and
the deploy script refuses to run if either has been reactivated.

## 2. Why the new page is served from n8n and not from www.finmentor.md

The Gateway is `POST /webhook/finmentor-miniapp-gateway` and sets **no CORS headers** — by
design, and the owner's instruction was not to modify it. A page on `https://www.finmentor.md`
POSTing `Content-Type: application/json` cross-origin would force an `OPTIONS` preflight the
Gateway cannot answer, and the browser would refuse before the Gateway ever saw the request.

Serving the page from the **same n8n origin** makes the POST same-origin: no preflight, no CORS,
no Gateway change. This is also exactly what B.2.1-A and B.2.1-B did, so it is the approved
pattern rather than a new architecture.

## 3. What was deployed

| | |
|---|---|
| `EU91nSsmqQqIeD8w` | **FINMENTOR B.2.1-C Gateway Test Page** — `GET /webhook/b21c/gateway-test`, **ACTIVE** |
| `2e8iMFQYVIwufhUy` | **FINMENTOR B.2.1-C Test Button Sender** — sub-workflow, inactive, one Telegram node |
| `gbeozU4lyy3YDv0M` | `[TEMP] B21C test button driver` — credential-free, disposable, `availableInMCP: true` |

Repository sources:

    gateway/n8n/b21c-gateway-test-page.html         the reviewed page, byte-for-byte what is served
    scripts/build-b21c-test-surface.mjs             builder + self-gate
    scripts/deploy-b21c-test-surface.ps1            guarded deploy (-DryRun / -Deploy)
    n8n/candidate/b21c-test-page-candidate.json
    n8n/candidate/b21c-test-button-sender-candidate.json

The builder **refuses to emit** a page bound to `canary/b21a`, a page that does not POST to the
current Gateway, a page that touches `initDataUnsafe` or any storage/logging sink, a page that
issues more than one `fetch`, or a sender whose button points anywhere but the B21C page.

## 4. The proof chain, and where it stops

    Telegram genuine initData -> current Gateway -> Ed25519 -> G5 replay claim -> app_session_id

Nothing further. The page has **no submit**, no consent UI, no Lead Intake call, no Pipeline
write. Structurally, not by convention: neither workflow contains a Google Sheets node, an HTTP
Request node, an Execute Workflow node or a Postgres node, and the builder gate asserts each
absence.

## 5. initData handling

Raw `initData` is read into one local variable and placed straight into the request body. It is
never written to the DOM, console, `localStorage`, `sessionStorage`, cookies or the URL, and the
page workflow itself never receives it — it answers a `GET` with static bytes.

Execution retention is `none` for success, error and manual on **both** new workflows, so no
n8n execution record can accumulate one.

`app_session_id` is displayed as a **16-character prefix** of its 64 hex characters: enough to
match the open against its `MiniApp_App_Sessions` row, not enough to be used as one.

## 6. Delivery

One message, to the owner chat only.

    message_id     : 363
    chat_type      : private
    sending bot_id : 8917808598
    button label   : B21C Gateway Test
    target         : https://ghennadi.app.n8n.cloud/webhook/b21c/gateway-test

The sending bot id equals the `BOT_ID` the Gateway canonicalises against, so the button and the
verifier are bound to the same bot — a wrong-bot launch could not produce a passing signature.

## 7. Pre-press baseline

    telegram_initdata_replays rows : 0
    Gateway nTZHLbv2KFggdhh5        : active, 13 nodes, structurally unchanged by this deploy
    GET /webhook/b21c/gateway-test  : 200, text/html; charset=utf-8, cache-control: no-store

A successful press must move the replay ledger from 0 to 1. A second press of the *same*
delivered button may return `409 REPLAY_REFUSED` if Telegram reuses the signed context — that is
G5 working, and the page says so rather than showing it as a failure. A fresh signed context
requires a newly sent button.

## 8. Cleanup debt

`gbeozU4lyy3YDv0M` is kept only so a second button can be sent if a fresh signed context is
needed. It is `availableInMCP: true` — the narrowest form of the exposure, on a credential-free
two-node driver — and should be archived once the positive proof is recorded.
