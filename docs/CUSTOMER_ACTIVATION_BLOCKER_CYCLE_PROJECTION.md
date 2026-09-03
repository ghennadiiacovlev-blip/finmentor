# CUSTOMER PRODUCTION — BLOCKED ON AUTHORITATIVE CYCLE PROJECTION

**Recorded:** 2026-08-30
**Status:** `RU OWNER UAT = READY` · `CUSTOMER PRODUCTION = BLOCKED ON AUTHORITATIVE CYCLE PROJECTION`
**Owner decision:** accepted for owner-only RU UAT. **Not to be implemented now.** No Gateway
change, no Concierge change, no merge, no customer activation.

This document exists so the limitation is a recorded decision rather than a thing someone
rediscovers after activation.

---

## 1. The limitation

The Gateway bootstrap receives **no authoritative application `cycle_id`**.

Verified against the live tenant on the date above, not recalled:

| fact | evidence |
|---|---|
| `Build App Session` stamps `cycle_id: ''` | the node's own source, live |
| `Resolve Session` filters on `cycle_id` | live; the key is written as (user, cycle) and behaves as such |
| no Gateway node ever writes a non-empty `cycle_id` | scanned across the whole live workflow |
| the Gateway has no Google Sheets access | no `googleSheets` node, one credential, on `G5 Replay Claim` |

So the resume authority in production today is effectively:

```
telegram_user_id + ''
```

and not the intended:

```
telegram_user_id + authoritative application cycle_id
```

The key is already **written and exercised as the pair**, in the resolver and in
`qa/premium-ux-resume.test.mjs`. It becomes correct the day a cycle is resolvable; nothing about
the resolver has to change for that. What is missing is the value, not the mechanism.

### Why the cycle is not reachable from the Gateway

The authoritative cycle lives in `Bot_Sessions` (Google Sheets), reachable only by the Concierge
and Lead Intake. The Gateway holds exactly one credential — Supabase, on `G5 Replay Claim` — and
that narrowness is a deliberate security property, gated by
`qa/miniapp-gateway.test.mjs`. Handing it a Sheets credential would widen the most
security-critical surface in the system in order to deliver a UX behaviour.

---

## 2. Consequences, stated precisely

**Supported today:**

- Normal close / reopen / reload of one unfinished owner brief. A new signed Telegram context is
  verified, freshness-checked and G5-claimed as before, and then resolves to the same brief.
- Committed terminal behaviour. A submitted session reopens to its result and never drops the
  client back into qualification.

**Not supported today:**

- **Explicit cycle rotation while an old unfinished Mini App draft exists can still cause the old
  draft to be resumed.** If the cycle is rotated in the Telegram bot and the Mini App is then
  reopened, the resolver — which cannot see the rotation — returns the previous brief.
  The escape hatch is «Начать заново» on the resume screen, which clears the brief in place.

**And one property that is a rule, not a constraint:**

- The Data Table resolver provides **one deterministic authoritative winner** — a total order over
  the user's live rows, computed identically by every concurrent execution. But **the store itself
  does not enforce physical uniqueness.** Two genuinely concurrent first-opens can each insert a
  row; both then resolve to the same winner, and the loser is never handed to anyone and expires
  with its TTL. It is inert. It is not prevented.

---

## 3. The customer-activation gate

All six must hold before the Mini App is exposed to customers.

| # | requirement | today |
|---|---|---|
| 1 | An authoritative cycle projection reachable by the Gateway **without** giving the Gateway Google Sheets authority | absent |
| 2 | The Gateway resolves the current cycle **server-side** | absent — `cycle_id` is `''` |
| 3 | The resume key is genuinely `telegram_user_id + cycle_id` | the key is written as the pair; the cycle value is empty |
| 4 | An old-cycle draft can **never** win after an explicit new-request rotation | not satisfiable while (2) is absent |
| 5 | Concurrent first-open behaviour is either backed by true uniqueness/arbitration, **or** explicitly accepted as a bounded orphan-row design with cleanup | deterministic arbitration is in place; the orphan has **no cleanup** and relies on TTL expiry. Neither branch has been formally chosen. |
| 6 | Full regression of G5 / resume / terminal behaviour | the gates exist and pass; they must be re-run against whatever (1)–(5) change |

Item 5 is the one that is closest to done and still genuinely open: the arbitration is proven, but
"bounded orphan-row design with cleanup" has not been *decided*, and there is no cleanup. Either
decide it, or replace the rule with a real uniqueness constraint.

---

## 4. Preferred architecture, to evaluate later

```
Concierge
  → on cycle rotation, writes a minimal READ-ONLY projection:
        telegram_user_id → authoritative cycle_id

Gateway
  → reads ONLY that narrow projection
```

**The Gateway must not be given broad `Bot_Sessions` or Google Sheets access.** The projection is
two columns and one row per user; the Gateway needs a point read on it and nothing else.

Open questions to settle when this is picked up, recorded now so they are not rediscovered:

- **Which store.** The Gateway already reaches an n8n Data Table (no credential) and Supabase
  (one credential, on the claim node). A Data Table projection needs no new credential and no new
  grant; a Supabase projection could carry a real unique index and would close item 5 at the same
  time. That is a trade between narrowness and strength, and it is a decision, not a detail.
- **Write ordering.** If the Concierge writes the projection *after* rotating, there is a window in
  which the Gateway sees the old cycle. The rotation and the projection write need to be ordered so
  that the Gateway either sees the new cycle or sees nothing — never the old one.
- **What the Gateway does when the projection is missing or unreadable.** It must fail in the
  direction that does not resume: an unresolvable cycle should mint a new session, not silently
  fall back to `''` and resume the previous brief. Fail-closed here means "start fresh".
- **Identity in the store.** The G5 ledger deliberately holds a digest and never a Telegram
  identity. A projection keyed by `telegram_user_id` would put identity into whichever store it
  uses; keying it by a digest of the id preserves that property at no cost.

---

## 5. What holds the line until then

The Mini App is owner-only, and that is enforced **server-side on every endpoint** — never by the
URL. Verified live on the date above: both the session and the submit endpoint carry
`NOT_AUTHORISED` and compare the identity the SERVER stored at bootstrap
(`s.telegram_user_id`) against a deploy-time constant. A session id pasted into any other browser
reaches nothing.

That gate is what makes this limitation acceptable for UAT: the only person who can reach a Mini
App session is the owner, and the owner knows about the rotation case and has «Начать заново».

`qa/premium-ux-resume.test.mjs` carries an assertion that ties the two together: while `cycle_id`
is empty at bootstrap, the owner gate must still be present on both endpoints. Removing the owner
gate for customer activation without first resolving the cycle turns the gate red.

---

## 6. Status

```
RU OWNER UAT       = READY
CUSTOMER PRODUCTION = BLOCKED ON AUTHORITATIVE CYCLE PROJECTION
```

See also `docs/RU_UAT_MINIAPP_BOOTSTRAP_AND_IDEMPOTENCY.md` for the resume mechanism itself and the
proofs behind it.

---

## 7. Status — C3.1, corrected 2026-09-03 (this section replaces a WIP note that overstated the state)

```
RU OWNER UAT        = READY
CUSTOMER PRODUCTION = CYCLE PROJECTION: CONCIERGE LIVE (v1) · GATEWAY READER PENDING DEPLOY
```

The WIP checkpoint `4232076` appended a "Resolution" here that described the Gateway reader, a
completion record and a customer-activation script as done. Fresh-read on 2026-09-03: the
Concierge writer was live, the Gateway reader was not, and neither file existed. This section
records what is true, and what the corrected design is.

### What is live (fresh-read)

| piece | where | state |
|---|---|---|
| projection store | n8n Data Table `MiniApp_Cycle_Projection` (`bHJRv1oR6jdSULYj`, created 11:17Z) | `telegram_user_id, cycle_id, cycle_reset, projected_at` — one row per user (first generation) |
| writer | Concierge `mppzthlkSJFr6Kle` (updated 11:33Z): `Build Session Row → Project Cycle → Cycle Projection Guard → Save Bot Session` | live, first generation |
| rotation fix | Concierge `Get Bot Session (Premium)` | the two CONFIRMED premium rotations (`p|new_y`, `p|restart_y`) are explicit resets through the issuer — live |
| reader | Gateway `nTZHLbv2KFggdhh5` (updated 08-31) | **not deployed** — still stamps `cycle_id ''` |
| customer result store | n8n Data Table `XRay_Client_Results` (`MmYtlv9Q66xC3WIE`, created 11:17Z) | exists, **no writer live** |

### The corrected design (see `docs/C3_CODEX_CORRECTION_REVIEW.md`)

The architecture of §4 stands, with one correction taken from the Codex review: the projection
is **one immutable row per (user, cycle)**, keyed by `authority_key = telegram_user_id|cycle_id`
and carrying the numeric `cycle_sequence` minted into the cycle id. A delayed Concierge turn that
started before a rotation can therefore only touch its own row, and the Gateway resolves the
highest sequence: a stale turn can never overwrite a newer authoritative cycle. The first
generation (one row per user) could.

The four open questions of §4, answered:

- **Which store.** The n8n Data Table. No credential on either side; the Gateway keeps exactly one
  credential, on the G5 claim. A Supabase first-open authority table was proposed and rejected
  (identity in Supabase, a second credential node, and item 5 of the gate re-opened). Item 5 is
  therefore DECIDED as the bounded orphan-row design: deterministic arbitration, an inert loser
  row that expires with its TTL, no cleanup job.
- **Write ordering.** Projection first, session second. A rotation turn whose projection write
  fails aborts (guard throws, Error Monitor alerts, `Bot_Sessions` keeps the previous cycle,
  which is also what the projection holds). An ordinary turn tolerates a failed write: the row
  for its cycle already exists. The Gateway sees the new cycle or nothing — never the old one.
- **Missing or unreadable projection.** Two different answers, deliberately: a MISSING projection
  is `409 CYCLE_UNRESOLVED` (not retryable; the customer returns to the bot chat, whose next turn
  projects the cycle); an UNREADABLE store is `503 APPLICATION_STORE_UNAVAILABLE` (retryable).
  Nothing is minted and nothing is resumed in either case; `''` is never a cycle.
- **Identity in the store.** The plain `telegram_user_id`, the same identity the same store already
  holds in `MiniApp_App_Sessions`.

### The customer-activation gate, re-read against the corrected design

| # | requirement | status |
|---|---|---|
| 1 | projection reachable without Sheets authority | Data Table, no credential — met in source; live writer v1 |
| 2 | cycle resolved server-side | Gateway `Build App Session` reads the projection — source ready, **deploy pending** |
| 3 | resume key is genuinely (user, cycle) | `''` excluded on both sides — source ready |
| 4 | an old-cycle draft can never win after an explicit rotation, nor after a stale turn | per-cycle authority row + highest-sequence resolution — gated (`c3-cycle-projection`, `miniapp-gateway`), **deploy pending** (Concierge upgrade + Gateway) |
| 5 | concurrency posture decided | bounded orphan-row design — **decided** |
| 6 | full regression | gates green on the integrated tree; live proof pending the deploys |

The owner-only UAT lock on the Session and Submit endpoints stays until the deploys above are
live and proven; the tracked candidates resolve to `OWNER_ONLY` and the customer release is one
explicit substitution (`releaseMode: 'CUSTOMER'`) in one reviewed deployment.
