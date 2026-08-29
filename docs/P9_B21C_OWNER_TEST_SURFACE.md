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

## 7. The positive live proof — PASS (2026-08-29 05:58:10Z)

One real owner Mini App open. Pre-press baseline was `telegram_initdata_replays = 0`.

**Genuine Telegram-signed initData was accepted.** The evidence is the pair of writes the
accept path is the only way to reach, and they agree:

| | |
|---|---|
| replay ledger rows | 0 → **1** |
| `replay_key` | 64 lowercase hex (SHA-256 over the domain-separated canonical string + hash) |
| ledger `first_seen_at` | `2026-08-29 05:58:10.200818+00` |
| ledger `expires_at` | `2026-08-29 06:13:07+00` |
| implied `auth_date` | `05:58:07Z` — `expires_at` is `auth_date + 900`, so the payload was **~3 seconds old** |
| `MiniApp_App_Sessions` rows | 0 → **1** |
| `app_session_id` | `AS-` + **64 hex characters** = 32 bytes from `crypto.randomBytes` |
| session `replay_key` | **identical** to the ledger row — same request, both halves |
| session `cycle_id` | `""` — bootstrap minted no cycle, as §5.1 requires |
| session `state` / `draft_json` | `draft` / empty |
| session TTL | 1800s (`05:58:10.235Z` → `06:28:10.235Z`) |

A forged payload cannot produce this row: `Derive Replay Key` sits downstream of `IF Verified`,
so reaching the `INSERT` at all means the Ed25519 signature verified against Telegram's
production key, and the ~3-second age means it verified against a genuinely fresh one.

**Persistence and retention.**

    Gateway executions retained     : 0   (after a real ACCEPTED request)
    page workflow executions        : 0
    Gateway settings                : saveDataSuccessExecution/saveDataErrorExecution = none,
                                      saveManualExecutions/saveExecutionProgress = false
    Gateway structural hash          : f60866711b08f5b6924e947a072453b48d799c8dc74ca7fcc42edb79e58f1cf0
                                      (identical to the post-deploy capture — unchanged)

The zero-retained figure is the load-bearing one: the Gateway processed a genuine accepted
request and kept no execution record of it, so no raw `initData` can be recovered from n8n.

Neither store holds `initData`, a signature or a hash. `telegram_initdata_replays` has exactly
four columns — `replay_key`, `first_seen_at`, `expires_at`, `correlation_id` — and the key is a
one-way digest. `MiniApp_App_Sessions` holds the owner's own `telegram_user_id`/`chat_id`, which
is the session binding the contract requires (§6, "bound to exactly one Telegram user"), and no
contact data, no lead, no free text.

## 8. What the accept proof does NOT cover, and why the page changed

**The exact replay could not be performed from here.** Refusing it is the point: the replay must
present the *same* signed bytes, and this session neither holds that value nor may fabricate
one. The replay row proves the context was used; it is a digest and cannot reconstruct it.

Re-pressing the delivered v1 button was rejected as the method, because its outcome is
ambiguous — if Telegram issues a fresh context the request is *accepted*, consuming a second key
and proving nothing about replay.

So the page was replaced in place (same workflow, same route, same delivered button — no second
button, therefore no second signed context) with a **three-shot** proof driven from one genuine
context held only in browser memory:

| shot | when | required |
|---|---|---|
| A · ACCEPT | immediately | `200`, `ok:true`, `app_session_id` issued, ledger **+1** |
| B · EXACT REPLAY | right after A | `409 REPLAY_REFUSED`, ledger **unchanged** |
| C · STALE FRESHNESS | A + 940s | `401 TG_INITDATA_EXPIRED`, ledger **unchanged**, G5 never reached |

One `fetch` call site and one request body built once and reused, so B and C are provably the
same bytes as A — the builder gate asserts both, plus a single latched timer for C.

Shot C is the gate P9 recorded as unproven. The Gateway verifies the signature **before**
freshness and claims the replay key only after both pass, so a genuine-but-stale context fails
with the signature still valid. `TG_INITDATA_EXPIRED` is emitted at exactly one place in the
verifier, so observing that code *is* the proof that `Derive Replay Key` was never reached.

The delay is measured from shot A rather than from `auth_date`, so the page never parses the
signed context and never touches `initDataUnsafe`. `auth_date` is always at or before shot A, so
A + 940s always clears the 900s window; only clock rate matters, not the browser's clock offset.

The context lives in one page-local variable for ~16 minutes and dies when the page closes. It
is never written to n8n, GitHub, Sheets or any store, and no human reads it.

## 9. Still pending after the three-shot press

- **Store-failure fail-closed, live.** Deliberately breaking production Supabase is refused.
  This needs an isolated disposable Gateway harness pointed at a throwaway store. Proven
  structurally on the deployed graph and offline in `qa/g5-replay-claim.test.mjs`.
- **Concurrent duplicate submission at the Gateway**, as opposed to the ledger-level race
  already measured in P9 §5.

## 10. Cleanup debt

`gbeozU4lyy3YDv0M` is kept only so a second button can be sent if a fresh signed context is
needed. It is `availableInMCP: true` — the narrowest form of the exposure, on a credential-free
two-node driver — and should be archived once the three-shot proof is recorded.
