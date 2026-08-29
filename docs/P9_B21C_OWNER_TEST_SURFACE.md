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

## 8a. P9-R1 — the 500 defect, found by the three-shot run

The three-shot run on 2026-08-29 returned **A: 500, B: 500, C: 401 PASS**. C is the freshness
gate and it is now live-proven with a genuine Telegram signature gone stale — the gate P9 §2/§3
recorded as unproven. A and B are a real defect.

### Root cause

`options.responseCode` on three of the four respond nodes was the string `'=200'` / `'=409'` /
`'=503'`. In n8n a leading `=` marks a value as an **expression**, but those bodies contain no
`{{ }}`, so each evaluates to a **string**. The HTTP layer then throws while writing the
response — *after* the graph has already finished. n8n records the execution as a **success**
and the caller receives a bare `500`.

`Respond Rejected` was the only node whose code was a real expression,
`={{ $json.statusCode }}`, which evaluates to a number. That is precisely and only why C
answered correctly, and why every negative-battery code in P9 §2/§3 (400/401/403) looked fine:
**every one of them went through `Respond Rejected`.** `200`, `409` and `503` had never once
been exercised live.

### Proven, not inferred

An isolated credential-free probe workflow, one webhook and one respond node, same graph three
times:

| `responseCode` | result |
|---|---|
| `'=409'` (expression marker, no `{{ }}`) | **HTTP 500** |
| `'={{ 409 }}'` | HTTP 409 |
| `409` (plain number) | HTTP 409 |

No Telegram material, no credentials, no production node involved.

### What the ledger says about A and B

    rows before the three-shot run : 1
    rows after A                    : 2   <- A CLAIMED A NEW KEY
    rows after B                    : 2   <- B correctly won nothing
    rows after C                    : 2   <- C never reached the claim
    MiniApp_App_Sessions after A    : 2   <- A MINTED A SESSION

So **A was a valid ACCEPT candidate and the Gateway did the whole job correctly** — fresh
signature verified, new key claimed, high-entropy session minted — and then failed to *tell the
caller*. The defect is entirely in the response layer, downstream of every security decision.
B likewise reached `Respond Replay Refused` and failed the same way, which is why the zero-row
path looked broken when it was not: `G5 Replay Claim` already carries `alwaysOutputData`, so the
conflict emits an item, `Claim Verdict` runs, and `claim_won: 0` routes correctly.

**Nothing about G5 was changed.** The atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING`
stands, there is no `SELECT`-before-`INSERT`, the schema is untouched, and fail-closed routing
is unchanged.

### The minimal change

Three values, and nothing else. A field-level diff of the fixed candidate against the live graph
before redeploy returned **exactly three differences**:

    Respond Bootstrap OK      "=200" -> 200
    Respond Replay Refused    "=409" -> 409
    Respond Store Unavailable "=503" -> 503

`Respond Rejected` keeps `={{ $json.statusCode }}`, because the validator chooses that code.

Redeployed to `nTZHLbv2KFggdhh5`, still active, 13 nodes, one credential on `G5 Replay Claim`,
`alwaysOutputData` intact, retention still `none`. The negative battery was re-run live
afterwards with no regression: `TG_INITDATA_MISSING` 400, `CLIENT_VERSION_UNSUPPORTED` 400,
`BAD_REQUEST` 400 (locale and content-type), `TG_INITDATA_INVALID` 401 (forged and duplicate
key). Ledger unchanged at 2 throughout.

### Two guards so it cannot come back

- `verifyGateway` now **refuses to emit** a graph where any `responseCode` is neither a number
  nor a `{{ }}` expression, and `respond()` throws on the broken form at build time.
- `qa/miniapp-gateway.test.mjs` asserts the four codes explicitly and includes a mutation check
  that flips one back to `'=409'` and requires the verifier to reject it.

The old assertion `/503/.test(JSON.stringify(resp.parameters))` passed for **both** the broken
and the fixed form. That is why a substring test was not enough, and why the new gate compares
the typed value.

### Orphans left in place, deliberately

Two app sessions (`05:58:10`, `06:08:47`) and their two ledger rows are legitimately claimed
work whose response never reached the client. They are **not** deleted — deleting a claimed
replay row to make a test look clean is exactly the thing that must never become a habit. Both
sessions expire on their own 1800s TTL.

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

## 11. The next press is trimmed to A + B (owner decision, 2026-08-29)

`C · STALE FRESHNESS` is **banked as a LIVE PASS** and must not be repeated: the 2026-08-29
three-shot run answered `401 TG_INITDATA_EXPIRED` on a genuine Telegram signature gone stale,
which is exactly the gate P9 §2/§3 had recorded as unproven. Re-running it would cost sixteen
minutes of held signed context to re-prove a result already in the ledger.

The page at `EU91nSsmqQqIeD8w` was therefore **replaced in place again** — same workflow, same
route `/webhook/b21c/gateway-test`, same Telegram button already in the owner's chat, so **no
second button was sent and no second signed context was issued.**

| shot | when | required |
|---|---|---|
| A · ACCEPT | immediately | `200`, `ok:true`, non-empty high-entropy `app_session_id`, ledger **+1** |
| B · EXACT REPLAY | right after A | `409 REPLAY_REFUSED`, ledger **+0**, **no** second app session |

One `fetch` call site and one request body built once and reused, so B is provably the same
signed bytes as A. The 940s timer is gone — the page now carries **no scheduler of any kind**,
and both shots complete in one uninterrupted run.

### The gate was inverted, not loosened

The v2 gate *required* shot C, exactly one `setInterval`, a latch, and a `STALE_DELAY_MS` past
900s. Those assertions are now **prohibitions**, so a re-run of the banked shot cannot reach the
wire by accident:

    C · STALE FRESHNESS present            -> refuse
    TG_INITDATA_EXPIRED asserted           -> refuse
    setInterval / setTimeout / rAF / rIC   -> refuse
    STALE_DELAY_MS declared                -> refuse
    more or fewer than two chained send()  -> refuse
    B not asserting REPLAY_REFUSED         -> refuse
    B not asserting "no second session"    -> refuse

Every one of the eleven mutations in the probe — re-adding a timer, re-adding shot C, firing a
third shot, dropping B's no-second-session assertion, adding a second `fetch`, rebuilding the
body, pointing at a write-side route, persisting the context — was rejected. The unmutated page
was accepted. A gate that cannot reject the form it replaced is not a gate; that is the lesson
P9-R1 §8a paid for.

### Pre-press state, verified before the owner was asked to press

    Gateway nTZHLbv2KFggdhh5      active, 13 nodes
    live graph vs HEAD candidate  field-level diff: IDENTICAL (commit 32d8458)
    Respond Bootstrap OK          200   numeric
    Respond Replay Refused        409   numeric
    Respond Store Unavailable     503   numeric
    Respond Rejected              ={{ $json.statusCode }}   dynamic numeric expression
    Gateway structural hash       1cf43ea9a92838c52b836e336ffe5f49656ec75923a4c57f818edcd045500385
    telegram_initdata_replays     2 rows
    MiniApp_App_Sessions          2 rows
    Gateway retained executions   0
    page retained executions      0
    sender 2e8iMFQYVIwufhUy       INACTIVE, not run
    driver gbeozU4lyy3YDv0M       INACTIVE, not run
    live page == reviewed source  true
    repo QA                       31/31 gates, 1398 assertions

The three numeric codes are the P9-R1 fix. They are read back as JSON numbers from the live
graph, not matched as substrings — `'=200'` and `200` are indistinguishable to a substring test
and that is precisely how the defect survived the first gate.

`Store Failure = 503` remains **unproven live** and the overall Gateway gate stays open until an
isolated, credential-safe store-failure harness proves it without touching production Supabase.

## 12. A + B — LIVE PASS (2026-08-29 07:05:55Z)

One owner press, two shots from one genuine Telegram-signed context, one body built once.

| | client-visible | server-side |
|---|---|---|
| A · ACCEPT | `200`, `ok:true`, `app_session_id` present, `session_id_len` 67, `leak_fields []` | ledger **2 → 3**, sessions **2 → 3** |
| B · EXACT REPLAY | `409`, `ok:false`, `REPLAY_REFUSED`, `retryable:false`, `leak_fields []` | ledger **+0**, sessions **+0** |

### The two halves are one request

The new ledger row and the new app session carry the **same `replay_key`**, compared by MD5
fingerprint so the digest itself is never printed:

    ledger  replay_key fingerprint : 43d97d41209a4abb92b0705c3018d8a3
    session replay_key fingerprint : 43d97d41209a4abb92b0705c3018d8a3   -> same request

    ledger first_seen_at           : 2026-08-29 07:05:55.493966+00
    ledger expires_at              : 2026-08-29 07:20:52+00
    implied auth_date              : 2026-08-29 07:05:52+00
    payload age at claim           : 3.49 s   -> a genuinely fresh signature, not a stale one
    replay_key shape               : 64 lowercase hex
    app_session_id shape           : AS- + 64 lowercase hex, all 16 hex digits present
                                     = 32 bytes from crypto.randomBytes
    session TTL                    : 1800 s
    cycle_id / draft_json / state  : "" / "" / draft

**On the intermediate read.** A and B run back to back inside one uninterrupted browser run, so
there was no moment at which the ledger could be sampled *between* them; the recorded sequence
is baseline 2, then 3 after the pair. That the delta is **+1 and not +2** — one new ledger row
and exactly one new session, with B answering `409 REPLAY_REFUSED` and carrying no
`app_session_id` — is what establishes that B claimed nothing. Claiming that three separate
reads were taken would be a nicer-looking sentence and a false one.

### Retention and privacy

    Gateway retained executions : 0
    page    retained executions : 0
    Gateway settings            : saveDataSuccessExecution / saveDataErrorExecution = none,
                                  saveManualExecutions / saveExecutionProgress = false

`telegram_initdata_replays` still has exactly four columns — `replay_key`, `first_seen_at`,
`expires_at`, `correlation_id` — and holds no PII: the key is a one-way digest and the
correlation id is a random UUID. A scan of the whole new session row for `query_id=`,
`auth_date=`, `user=`, `hash=`, `signature=`, a bot-token shape, an email and a phone shape
returned **nothing**. `leak_fields` was empty on both shots.

### Reconfirmed

    only Gateway Postgres credential : FINMENTOR Supabase G5 (B6wRirWfjqoASXU3), on G5 Replay Claim
    second postgres credential        : "Postgres account" — NOT referenced by the Gateway
    G5 schema                         : unchanged, 4 columns
    live drift vs n8n/production/manifest.json : 9 tracked workflows, 0 drifted
                                        (Concierge, Lead Intake, Command Center, Digest,
                                         Followup, SLA Watch, Error Monitor, Transport)
    Gateway node types                : webhook, code, if, postgres, dataTable, respondToWebhook
                                        — no googleSheets, no httpRequest, no executeWorkflow
    Pipeline write                    : impossible; the only "Pipeline" string in the graph is
                                        the self-reported counter pipeline_writes: 0
    submit route                      : absent
    F17 / Neon                        : untouched
    merge / activation                : neither

## 13. P9-R2 — STORE FAILURE: **ISOLATED FAIL**. The 503 path is unreachable.

An isolated harness was built rather than breaking production Supabase: a copy of the deployed
graph with a gated four-item divergence allowlist (route, trust anchor, claim node, session
write). Every other node and the entire connection map are byte-identical to the Gateway
candidate, **all four respond nodes are copied verbatim**, and `qa/gateway-store-failure-harness.test.mjs`
refuses to emit a harness that breaks any of that — 61 checks, including 20 mutations that each
re-introduce a way the harness could stop mirroring production.

The trust anchor is swapped for a keypair generated at run time so a synthetic context can reach
the claim node with no Telegram material and no production credential. That cut both ways and
was verified live: **a harness-signed context is rejected `401 TG_INITDATA_INVALID` by the
production Gateway and minted nothing**, so the harness key cannot be turned against the real
endpoint.

### What the wire said

    H1 store DOWN     (code stand-in throws)      -> HTTP 409  REPLAY_REFUSED  retryable:false
    H1 store WON      (control)                   -> HTTP 200  ok:true, AS-<64 hex>
    H1 store LOST     (control)                   -> HTTP 409  REPLAY_REFUSED
    H1 mode UNSET     (fail-closed control)       -> HTTP 409  REPLAY_REFUSED
    H2 REAL postgres node, dead store             -> HTTP 409  REPLAY_REFUSED  retryable:false

Expected on the two outage shots: `503 REPLAY_STORE_UNAVAILABLE retryable:true`. The controls
passed, which is what makes this a finding rather than a broken harness — the same graph answers
`200` on a won claim and `409` on a lost one.

### Root cause, observed rather than inferred

A diagnostic copy with retention enabled shows the node-by-node truth of a real store outage:

    G5 Replay Claim            outputs=[1, 1]      <- ONE item on SUCCESS, ONE on ERROR
    Claim Verdict              outputs=[1]
    IF Claim Won               outputs=[0, 1]
    Respond Replay Refused     outputs=[1]         <- this one answered the caller
    Respond Store Unavailable  outputs=[1]         <- ran, but the response was already sent
    lastNodeExecuted: Respond Store Unavailable
    execution status: success

`G5 Replay Claim` carries **`alwaysOutputData: true`**. On error, `onError: continueErrorOutput`
puts the error item on output 1 — and `alwaysOutputData` *also* puts an empty item on output 0.
Both branches then run. The empty success item reaches `Claim Verdict`, which filters on
`replay_key !== ''`, finds none, and emits `claim_won: 0` — which is **exactly what a genuine
ON CONFLICT conflict looks like**. `Respond Replay Refused` commits the 409 first, and the 503
that follows is a no-op.

So a total store outage is reported to the caller as *"you have already used this context, do
not retry"*, and the execution is recorded as a **success**.

`alwaysOutputData` is not a stray flag: P9-R1 §8a relied on it, correctly, to make the
zero-row conflict path emit an item. The same flag is what makes the outage path indistinguishable
from that conflict.

### Severity, stated fairly

Fail-closed **on side effects** — and that part holds:

    no app session minted        Build App Session and Create App Session never ran
    no ledger row written        ledger 3 -> 3 across the entire harness run
    no fallback to ACCEPT        no 200 on either outage shot
    no secret exposure           body is the static 3-key contract; no host, user, database,
                                 ECONNREFUSED, password or stack text in the response

Not fail-closed **on the contract**: the documented `503 REPLAY_STORE_UNAVAILABLE retryable:true`
is unreachable, and `retryable:false` tells a correct client never to retry. Under a Supabase
outage every user would be told their context was already used, with no signal to come back.
That is a replay-semantics weakening in the one direction the ledger cannot detect.

### The minimal fix — APPLIED IN THE REPO, NOT YET PROVEN LIVE

Applied to the tracked builder and candidate. **Nothing has been deployed and nothing has been
re-run on the wire**, so `STORE FAILURE` is still an ISOLATED FAIL below: the fix is a change
that should close it, not evidence that it did.

Three things changed in `scripts/build-miniapp-gateway.mjs`, and a field-level diff of the new
candidate against the previous one shows exactly those three and nothing else — same 13 nodes,
same single credential on the same node, all four respond nodes untouched, connection map
untouched, retention still `none`.

**1. The claim query wraps the INSERT in a data-modifying CTE, so it always returns one row.**

    with ins as (
      insert into public.telegram_initdata_replays (replay_key, expires_at, correlation_id)
      values ($1, $2::timestamptz, nullif($3, ''))
      on conflict (replay_key) do nothing
      returning replay_key
    )
    select (select count(*) from ins)::int as claimed

    won      -> one row, claimed = 1
    conflict -> one row, claimed = 0
    outage   -> the node errors, so there is NO success item at all

A data-modifying `WITH` runs exactly once and always to completion whether or not the outer
query reads it, so the INSERT is not conditional on the SELECT. The `::int` cast is deliberate:
`count(*)` is a `bigint`, and node-postgres hands `int8` back as a string.

G5's semantics are unchanged — one atomic `INSERT ... ON CONFLICT DO NOTHING`, no
`SELECT`-before-`INSERT`, no schema change, fail-closed routing as it was.

**2. `Claim Verdict` reads the stated value instead of counting rows.**

`claim_won` is 1 only on an explicit `claimed = 1`. No row, several rows, a missing column, an
unparseable one — all refuse, because refusing mints no session.

**3. `alwaysOutputData` comes off `G5 Replay Claim`.**

That flag was the other half of the defect, and the CTE is what makes it unnecessary: a conflict
now returns a row on its own, so the zero-row success case it existed to paper over is gone.
Without it, an error produces only the error item, and the error output is the only path left.

### The two halves are gated as one

Either half alone re-opens the defect — with the flag, an error still emits an empty success item;
without the CTE, an empty success item is still indistinguishable from a conflict. So
`verifyGateway` now **refuses to emit** a Gateway whose claim node carries `alwaysOutputData`,
whose claim query has no `claimed` verdict column, that lost its `ON CONFLICT DO NOTHING`, that
`SELECT`s before it `INSERT`s, or whose verdict never reads the column.

`qa/miniapp-gateway.test.mjs` executes the real verdict code against the row shapes Postgres can
actually produce, and carries the regression assertion that matters: **one row carrying a
`replay_key` and no verdict column — the exact shape the old verdict read as a win — must now
lose.** Four mutations re-add the flag, revert the query, revert the verdict to counting rows, and
smuggle a `SELECT` ahead of the `INSERT`; all four are rejected, and the unmutated build is
accepted. A gate that cannot reject the form it replaced is not a gate — the lesson of §8a.

### The harness follows production, in both directions

The harness exists to mirror the Gateway, so it mirrors this too, and its own gate was inverted
rather than relaxed. `H1`'s claim stand-in now returns **one row for a lost claim as well as a
won one** (`claimed: 0` / `claimed: 1`), because that is what the CTE does; a stand-in still
returning zero rows on "lost" would be mirroring a query that no longer exists, and the conflict
and outage paths would look alike inside the harness and nowhere else.

The gate compares the flag against **whatever production holds**, so the two cannot drift apart,
and it refuses an H1 whose stand-in cannot state `claimed = 1`, cannot state `claimed = 0`, or
returns an empty array at all. Two mutations were added and one was inverted: re-adding
`alwaysOutputData` is now the regression, and so is making a lost claim return no row.

A new executed check runs the H1 stand-in and feeds its output to the **real** `Claim Verdict`
code, so the mirror is exercised rather than asserted: won → 1, lost → 0, down → throws, unset →
throws.

Repo QA after the change: **32/32 gates, 1462 assertions** (gateway 22 → 23, harness 61 → 63).

### What is still owed before this can be called fixed

    1. deploy the rebuilt candidate to nTZHLbv2KFggdhh5, field-level diff before and after
    2. re-run the isolated harness: both outage shots must answer 503 REPLAY_STORE_UNAVAILABLE
       retryable:true, and the three controls must still answer 200 / 409 / 409
    3. re-run A + B live on one genuine owner press, to show the accept and replay paths are
       unregressed by the query change
    4. re-run the negative battery, since Respond Rejected is the shared path

Steps 1–3 touch the live Gateway or need a real Telegram context, so none of them has been taken.

### The same defect class elsewhere: Lead Intake's dedup read

Found by sweeping every tracked workflow for the combination that caused this one —
`alwaysOutputData: true` **together with** `onError: continueErrorOutput`. Twenty-eight
workflows scanned; the Gateway was the only Mini App hit, and one other node carries the pair:

    QmIyEW2ZEqKregmN  FINMENTOR Lead Intake PREMIUM FINAL
    Read Pipeline (Dedup)   googleSheets   onError: continueErrorOutput + alwaysOutputData: true

        main[0] -> Dedup Guard  -> ... -> IF Is New -> Build Pipeline Row -> Save to Pipeline
        main[1] -> IF Internal (Infra) -> Respond Infra Failed -> Stop: CRM Unavailable

`Dedup Guard` opens with `filter(r => String(r.lead_id || '').trim() !== '')` — it discards
items with no `lead_id`, which is exactly what the old `Claim Verdict` did with `replay_key`.
So on a Sheets read outage the empty success item survives to `Dedup Guard`, is filtered away,
and **"the store is unreachable" becomes "no duplicate was found"** — the branch that ends in a
Pipeline **write**, while the error branch separately answers CRM-unavailable.

This is a repo-level observation from reading the graph, **not** a live finding: no outage was
simulated against Lead Intake and nothing here was changed. It is written down because it is the
same root cause, one `filter` away, and because the direction is worse — the Gateway failed
closed on side effects, whereas this path leads to a write. Two things plausibly mask it in
practice and neither is a design: a Sheets read outage will usually take the write down too, and
the error branch is far shorter, so it likely commits the HTTP response first. Worth its own
diagnosis before anyone relies on either.


### Second, minor observation

While diagnosing, a synthetic context missing the 64-hex `hash` field made `Derive Replay Key`
throw `G5_HASH_MISSING`, and the caller received an **empty HTTP 200** — n8n's behaviour when a
`responseNode` webhook finishes without reaching a respond node. Practically unreachable in
production: a genuine Telegram context always carries `hash`, and a forged one cannot pass
Ed25519 first. Recorded because an empty 200 on an internal throw is a poor default, not because
it is currently exploitable.

### Isolation held

    production ledger rows      3 -> 3       (newest row is still shot A at 07:05:55Z)
    production app sessions     3 -> 3
    Gateway retained executions 0
    Gateway graph               unchanged, still active, 13 nodes
    Gateway credential          FINMENTOR Supabase G5, unchanged and never used by the harness
    harness workflows           created, exercised, deleted, confirmed gone (404 on readback)
    disposable credential       created, deleted; its password was generated in-process,
                                never printed and never written to disk
    Neon                        untouched

Repo QA after the run: **32/32 gates, 1459 assertions**.

## 14. Gateway verdict

    VALID ACCEPT    = LIVE PASS
    EXACT REPLAY    = LIVE PASS
    STALE FRESHNESS = LIVE PASS   (banked 2026-08-29)
    STORE FAILURE   = ISOLATED FAIL   (fix applied in-repo, NOT yet re-run live)

**GATEWAY: NO-GO**, on the store-failure contract alone. Three of the four gates are live-proven.
The fourth is not a gap in evidence any more — it is a defect the evidence found, and the fix
above is now written and gated in the repo. It stays a FAIL until the harness answers 503 on the
wire: a fix that has not been run is a hypothesis, and this document does not bank hypotheses.
