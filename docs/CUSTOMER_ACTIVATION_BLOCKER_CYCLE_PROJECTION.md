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

## 7. Resolution — C3.1, 2026-09-03

```
RU OWNER UAT        = READY
CUSTOMER PRODUCTION = CYCLE PROJECTION LIVE
```

The limitation in §1 is closed. The architecture in §4 was implemented as written, and the four
open questions are answered below.

### What was built

| piece | where | what |
|---|---|---|
| projection store | n8n Data Table `MiniApp_Cycle_Projection` (`bHJRv1oR6jdSULYj`) | `telegram_user_id`, `cycle_id`, `cycle_reset`, `projected_at` — one row per user, upserted |
| writer | Concierge `mppzthlkSJFr6Kle`: `Build Session Row → Project Cycle → Cycle Projection Guard → Save Bot Session` | written on EVERY turn, BEFORE the session is persisted (`scripts/deploy-c3-concierge-cycle.mjs`) |
| reader | Gateway `nTZHLbv2KFggdhh5`: `IF Claim Won → Read Cycle Projection → Build App Session → IF Cycle Resolved` | one point read, no credential (`scripts/build-miniapp-gateway.mjs`, `scripts/deploy-c3-gateway-cycle.mjs`) |
| rotation fix | Concierge `Get Bot Session (Premium)` | the premium machine's two CONFIRMED rotations (`p|new_y`, `p|restart_y`) are now explicit resets through the issuer; before C3.1 the response node cleared the cycle in its output and `Build Session Row` re-attached the old one, so the rotation the customer confirmed was never persisted |
| gates | `qa/c3-cycle-projection.test.mjs`, `qa/miniapp-gateway.test.mjs`, `qa/premium-ux-resume.test.mjs` | executed against the shipped code |

### The open questions, answered

- **Which store.** The n8n Data Table. It needs no credential and no grant on either side, and the
  Gateway's credential boundary (exactly one credential, on the G5 claim) is unchanged. Item 5 of
  the gate is therefore decided as the *bounded orphan-row design*: deterministic arbitration stays,
  the loser row is inert and expires with its TTL, and no cleanup job is added. This is recorded as
  a decision, not a constraint.
- **Write ordering.** Projection first, session second. On a rotation turn a failed projection write
  aborts the turn (`Cycle Projection Guard` throws, the Error Monitor alerts, `Bot_Sessions` keeps
  the previous cycle, which is also what the projection still holds). On any other turn a failed
  write is tolerated: the cycle did not move, and a missing projection makes the Gateway refuse.
  The Gateway therefore sees the new cycle or nothing — never the old one after a rotation.
- **Missing or unreadable projection.** `409 CYCLE_UNRESOLVED`, `retryable: false`. Nothing is
  minted and nothing is resumed; the Gateway never invents a cycle and never falls back to `''`.
  The Mini App tells the customer to return to the bot chat, whose next turn projects the cycle.
- **Identity in the store.** Keyed by the plain `telegram_user_id`, the same identity the same
  store already holds in `MiniApp_App_Sessions`. A digest would have added a second derivation to
  keep in step on both sides for no gain in this store.

### The customer-activation gate, re-read

| # | requirement | status |
|---|---|---|
| 1 | projection reachable without Sheets authority | Data Table, no credential — **met** |
| 2 | cycle resolved server-side | `Build App Session` reads the projection — **met** |
| 3 | resume key is genuinely (user, cycle) | `''` is now excluded from the key space on both sides — **met** |
| 4 | an old-cycle draft can never win after an explicit rotation | proven executed (`CASE C2`) — **met** |
| 5 | concurrency posture decided | bounded orphan-row design, no cleanup — **decided** |
| 6 | full regression | G5 / resume / terminal gates re-run green; live proof recorded in `docs/C3_PREMIUM_MINIAPP_COMPLETION.md` — **met** |

With the gate met, the owner-only UAT lock on the Session and Submit endpoints is retired in the
same checkpoint (`scripts/deploy-c3-customer-activation.mjs`).

One consequence to know: sessions minted before C3.1 carry `cycle_id ''` and are unreachable
after the Gateway deploy. They were owner-only UAT sessions; they expire with their TTL.
