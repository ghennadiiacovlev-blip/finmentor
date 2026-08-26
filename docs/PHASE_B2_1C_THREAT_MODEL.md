# FINMENTOR Phase B.2.1-C — Offline threat model

Date: 2026-08-26
Branch: `hardening/post-remediation-night-2026-08-25`
Baseline commit: `3de2b67` (B.2.1-C implementation + eighth gate)

Scope: the Mini App consent + submit path as it **actually exists in this repository today**,
plus the read-model and identity surfaces it depends on. Sources read for this model:

```
docs/PHASE_B2_1_GATEWAY_CONTRACT.md
docs/PHASE_B2_1C_CONSENT_SUBMIT_CLOSURE.md
docs/FINMENTOR_PHASE10_MINIAPP_READMODEL_CLOSURE.md
n8n/src/miniapp-submit/submit-contract.js, submit-handler.js
n8n/src/miniapp-readmodel/projection.js, mirror-helper.js
n8n/src/lead-intake/normalize-score-lead.js, dedup-guard.js, build-pipeline-row.js
gateway/telegram-initdata.mjs
qa/miniapp-submit.test.mjs, qa/miniapp-readmodel.test.mjs, qa/lead-intake-trust.test.mjs
```

No architecture is assumed that is not present in those files. Where a control is specified
but **not implemented**, that is stated as a gap, not modelled as a control.

This is an **offline** exercise. No n8n, Sheets, Telegram, GA4, DNS, Cloudflare or production
surface was contacted while producing it.

---

## 0. How to read the status field

The template carries two separate fields on purpose, and conflating them is the exact error
that produced INDP2-09.

| Status | Meaning |
|---|---|
| **OFFLINE-PROVEN** | The decision logic is exercised by a repository gate that fails if the control is removed. It does **not** mean deployed, and it does **not** mean closed. |
| **LIVE-PROOF-REQUIRED** | No offline check can establish this property. It depends on a real signature, a real clock, a real store's atomicity or a real platform behaviour. |
| **DESIGN-ONLY** | The rule is specified and/or partially coded, but a load-bearing piece is missing, unwired, or left to a component that does not exist in the repository. |
| **NOT-APPLICABLE** | The threat does not arise against the implementation as it actually stands. Stated with the reason, because a future change can re-open it. |

`LIVE PROOF REQUIRED?` is answered **independently of** `STATUS`. A threat can be
OFFLINE-PROVEN in logic and still require live proof of the component underneath it — that
is the normal case for anything touching an injected client.

**Nothing in this document is marked CLOSED.** An offline mock passing is evidence about a
code path, not about a deployment.

### Summary

| Status | Count |
|---|---|
| OFFLINE-PROVEN | 29 |
| LIVE-PROOF-REQUIRED | 5 |
| DESIGN-ONLY | 5 |
| NOT-APPLICABLE | 1 |
| **Total threats modelled** | **40** |

Seven cross-cutting gaps (G1–G7) are collected in §3. **G1 is a pre-activation blocker.**

---

## 1. Trust boundaries

Named once, referenced by every threat below.

| ID | Boundary | Crossing carries |
|---|---|---|
| **TB-1** | Browser → Gateway | `initData`, the request body. Everything here is hostile input. |
| **TB-2** | Gateway → app-session store | `app_session_id` → server-resolved identity and cycle binding. |
| **TB-3** | Gateway → `Bot_Sessions` (authority) | the only source of truth for cycle, consent and canonical lead binding. |
| **TB-4** | Gateway → Lead Intake | the one canonical lead creation/merge endpoint. Frozen contract (§2). |
| **TB-5** | Mirror helper → derived Data Table | non-authoritative read model. Never promoted to authority. |
| **TB-6** | Gateway/Intake → n8n execution log | retained node I/O. A real egress surface, not a debug detail. |
| **TB-7** | Lead Intake → Pipeline / CRM | frozen production writer. Provenance decided by route, never by payload. |

The rule that orders all of them: **`Bot_Sessions` is authority; the Data Table is derived;
the browser is never either.**

---

## 2. Threats

### T1 — Forged Telegram initData

- **THREAT** — A caller fabricates `initData` claiming another Telegram user, or crafts one from `initDataUnsafe`.
- **ATTACK / FAILURE MODE** — POST to the submit/bootstrap route with a hand-built `user` field and a wrong or absent `hash`/`signature`.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — `validateInitDataEd25519` (third-party Ed25519 against Telegram's production public key) and `validateInitDataHmac` in `gateway/telegram-initdata.mjs`. Strict manual parser: single percent-decode, duplicate decoded keys rejected, code-unit key ordering, `hash` and `signature` excluded from the third-party check string, `timingSafeEqual` comparison. §3.3 forbids silent fallback to trusting the browser.
- **EXPECTED BEHAVIOUR** — `TG_INITDATA_INVALID`, no session issued, no downstream call, no cryptographic detail returned.
- **OFFLINE TEST** — `gateway/telegram-initdata.test.mjs`, 14/14 pass: "HMAC validation rejects tampering", "Ed25519 validation rejects value tamper, bot-id tamper, added field and removed field", "Telegram production public key imports successfully and rejects synthetic signature".
- **LIVE PROOF REQUIRED?** — **YES.** Every offline signature is synthetic. §3.5 names the remaining gap explicitly: a real Telegram-generated `initData` verified against the production public key. Also unproven: that this validator is actually wired ahead of the submit route (no such wiring exists in the repo).
- **FAIL-SAFE / FALLBACK** — Fail closed; validation error paths throw `TelegramInitDataError` rather than returning a partial identity.
- **ROLLBACK / CONTAINMENT** — §15: disable the Mini App entry, fall back to the proven Telegram Client Concierge.
- **STATUS** — **LIVE-PROOF-REQUIRED.** Note: this suite is run by the path-scoped `miniapp-b21-gateway-qa.yml`, **not** by the canonical eight gates — a change to `qa/run-all.mjs` alone will not re-run it.

### T2 — Stale initData

- **THREAT** — An old but genuinely-signed `initData` is used to open a privileged operation long after it was issued.
- **ATTACK / FAILURE MODE** — Capture from a legitimate session, replay hours later; or a client that caches `initData` indefinitely.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — `validateFreshness`: `max_auth_age_seconds = 900`, `future_clock_skew_seconds = 60`, `auth_date` must be all-digits and a safe positive integer. Run **after** signature verification, never before.
- **EXPECTED BEHAVIOUR** — `TG_INITDATA_EXPIRED` (or `TG_INITDATA_FUTURE`), no session issued.
- **OFFLINE TEST** — "freshness accepts exact policy boundaries and rejects outside them".
- **LIVE PROOF REQUIRED?** — **YES.** The n8n Cloud runtime's wall clock and its skew against Telegram's `auth_date` are unmeasured. A runtime clock 15+ minutes slow would reject every genuine open; one badly fast would widen the window.
- **FAIL-SAFE / FALLBACK** — Bounded window, fail closed. §3.2: later requests must use the gateway-issued app session, not an indefinitely old `initData`.
- **ROLLBACK / CONTAINMENT** — Policy values are FINMENTOR constants, not protocol constants; they can be tightened without a Telegram change.
- **STATUS** — **LIVE-PROOF-REQUIRED** (logic offline-proven; runtime clock unproven).

### T3 — Wrong bot_id

- **THREAT** — An `initData` legitimately signed for a *different* bot is accepted as FINMENTOR identity.
- **ATTACK / FAILURE MODE** — Attacker operates their own Mini App, harvests real Telegram-signed `initData` for their bot, presents it to FINMENTOR.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — `buildThirdPartyDataCheckString` binds the bot identity **into the signed string**: `${bot_id}:WebAppData\n<sorted params>`. `bot_id` must be all-digits or `TG_BOT_ID_INVALID`. A signature for another bot cannot verify against FINMENTOR's `bot_id`.
- **EXPECTED BEHAVIOUR** — `TG_INITDATA_INVALID`.
- **OFFLINE TEST** — "Ed25519 validation rejects value tamper, **bot-id tamper**, added field and removed field"; "third-party data check string excludes hash/signature and sorts by code units".
- **LIVE PROOF REQUIRED?** — **YES.** The offline test proves the canonicalization binds `bot_id`; it cannot prove the deployed configuration carries FINMENTOR's real numeric `bot_id` rather than a placeholder.
- **FAIL-SAFE / FALLBACK** — Fail closed on any non-numeric or absent `bot_id`.
- **ROLLBACK / CONTAINMENT** — `bot_id` is non-secret configuration; correcting it is a config change, not a credential rotation.
- **STATUS** — **LIVE-PROOF-REQUIRED.**

### T4 — Replayed initData

- **THREAT** — The **same valid, fresh** `initData` string is submitted more than once within the freshness window.
- **ATTACK / FAILURE MODE** — Capture a genuine string (shoulder-surfed URL, hostile browser extension, proxied device) and replay it inside 900 s to mint a second app session for that user.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — **Partial.** The 900 s freshness window bounds the replay interval, and §3.2 directs later requests to use the app session instead. There is **no nonce/jti cache, no `query_id` single-use ledger, and no binding of `initData` to a single issued app session** anywhere in the repository.
- **EXPECTED BEHAVIOUR (specified, not implemented)** — A given `initData` should mint at most one app session; a second presentation should be refused or should return the existing session.
- **OFFLINE TEST** — None for replay. The parser rejects *duplicate keys within one string*, which is a different property and must not be cited as replay defence.
- **LIVE PROOF REQUIRED?** — **YES**, and design work first.
- **FAIL-SAFE / FALLBACK** — Blast radius is bounded by what a replayed session can *do*: it is still the same Telegram user, so it cannot reach another identity. It can open a parallel session for that user, which the per-`(user, cycle)` idempotency key (T11) then collapses to at most one lead.
- **ROLLBACK / CONTAINMENT** — Shorten `max_auth_age_seconds`; revoke app sessions by TTL.
- **STATUS** — **DESIGN-ONLY.** Gap **G5**. Not a lead-integrity risk — the idempotency key contains no session id — but it is an unclosed identity-surface item and must not be described as handled.

### T5 — Cross-user session access

- **THREAT** — A caller presents someone else's `app_session_id` and submits as them.
- **ATTACK / FAILURE MODE** — Guess, harvest or brute-force a session id; or send a valid id together with a different `telegram_user_id` in the body hoping the body wins.
- **TRUST BOUNDARY** — TB-2.
- **CURRENT CONTROL** — Identity is resolved **only** server-side: `sessions.read(app_session_id)` → `session.telegram_user_id`, which must be a non-empty all-digit run or `SESSION_INVALID`. `telegram_user_id` and `chat_id` are in `UNTRUSTED_BODY_KEYS` — recorded, never read. §6 requires a high-entropy identifier not derived from the Telegram id, and never a storage row id. `app_session_id` must match `^[A-Za-z0-9_-]{16,128}$` before any lookup.
- **EXPECTED BEHAVIOUR** — `SESSION_INVALID` / `SESSION_MISSING` (401); zero downstream effect.
- **OFFLINE TEST** — "an unknown app session is refused"; "malformed app_session_id is refused as a missing session"; "browser-supplied cycle, consent and scoring fields are ignored".
- **LIVE PROOF REQUIRED?** — **YES** for the store: actual entropy of the issued identifier and enforcement of §6's "not derived from Telegram ID alone" cannot be checked offline, because no issuer exists in the repo.
- **FAIL-SAFE / FALLBACK** — Fail closed; an unresolvable session is never treated as a new user.
- **ROLLBACK / CONTAINMENT** — Session TTL expiry; invalidate the store.
- **STATUS** — **OFFLINE-PROVEN** (resolution logic). The issuer is unwritten.

### T6 — chat_id / user_id confusion

- **THREAT** — The authoritative row for chat A is read while acting for user B, binding a lead to the wrong person.
- **ATTACK / FAILURE MODE** — A session whose `chat_id` disagrees with the authority row's `chat_id`; or code that silently defaults one identifier to the other.
- **TRUST BOUNDARY** — TB-2 → TB-3.
- **CURRENT CONTROL** — `chatId = session.chat_id || telegram_user_id` — an explicit, single, documented default. The authority row is then checked: a non-empty `authorityRow.chat_id` that differs from `chatId` is `SESSION_INVALID` / `SESSION_CHAT_MISMATCH` — **an identity failure, not a cache miss**.
- **EXPECTED BEHAVIOUR** — 401, zero writes, zero Intake calls.
- **OFFLINE TEST** — "a session resolving to another chat is refused as an identity failure".
- **LIVE PROOF REQUIRED?** — **YES.** Whether `Bot_Sessions.chat_id` and the Telegram numeric user id are genuinely the same value for real rows is a tenant fact. If they diverge for any legacy row, the fallback default is wrong for that row.
- **FAIL-SAFE / FALLBACK** — Mismatch fails closed rather than choosing either candidate.
- **ROLLBACK / CONTAINMENT** — Disable the Mini App entry; Concierge identity handling is unaffected.
- **STATUS** — **OFFLINE-PROVEN.**

### T7 — Stale cycle

- **THREAT** — A submit arrives on an app session bound to a cycle the Concierge has since superseded.
- **ATTACK / FAILURE MODE** — App left open across a cycle reset; or a deliberately retained old session id.
- **TRUST BOUNDARY** — TB-2 → TB-3.
- **CURRENT CONTROL** — The cycle is taken from the **authority row**, never the body (`cycle_id` is an untrusted key). `session.cycle_id !== authorityRow.cycle_id` → `CYCLE_SUPERSEDED` / `CYCLE_DRIFT`. An authority row with an empty `cycle_id` → `CYCLE_SUPERSEDED` / `CYCLE_MISSING` — a blank cycle can never be submitted against. §6 requires app sessions to be invalidated when the cycle changes.
- **EXPECTED BEHAVIOUR** — 409; the client re-bootstraps and re-consents. Zero Intake calls.
- **OFFLINE TEST** — "a session bound to a superseded cycle is refused"; "an authority row with no cycle cannot be submitted against".
- **LIVE PROOF REQUIRED?** — **YES** for the invalidation half of §6: no code in the repo rotates app sessions on cycle change. Detection is proven; proactive invalidation is not implemented.
- **FAIL-SAFE / FALLBACK** — Refuse rather than adopt either cycle.
- **ROLLBACK / CONTAINMENT** — Concierge cycle semantics remain authoritative and untouched (§2).
- **STATUS** — **OFFLINE-PROVEN** (detection). Proactive rotation: DESIGN-ONLY.

### T8 — Stale consent

- **THREAT** — Consent given in an earlier cycle is used as the legal basis for a lead created in the current one.
- **ATTACK / FAILURE MODE** — Client resends a stored `consent: "yes"`; or the server reads a consent stamp without checking which cycle it belongs to.
- **TRUST BOUNDARY** — TB-1 → TB-3.
- **CURRENT CONTROL** — `evaluateConsent` compares `sessionCycleId` to `authorityCycleId` and returns `CONSENT_STALE_CYCLE` on any mismatch or blank. The stamp is built **entirely server-side** (`consent_cycle_id` from the authority row, `consent_at` from the server clock, `consent_source: 'telegram_miniapp'`). `consent_at`, `consent_cycle_id` and `consent_source` are all untrusted body keys. Independently, `evaluateCycle` in `projection.js` refuses to treat a blank `cycle_id` as validating any consent binding.
- **EXPECTED BEHAVIOUR** — 409 `CONSENT_STALE_CYCLE`; no Intake call; the client re-consents.
- **OFFLINE TEST** — "consent from another cycle is invalid"; "consent YES on the current cycle is eligible and stamped server-side"; "consent and lead from a previous cycle are not current" (read-model gate).
- **LIVE PROOF REQUIRED?** — **YES.** Real `Bot_Sessions` consent columns and the Concierge's own stamping semantics must be observed together once.
- **FAIL-SAFE / FALLBACK** — Fail closed: absent or ambiguous cycle → refuse.
- **ROLLBACK / CONTAINMENT** — Concierge consent semantics remain authoritative (§2); no Mini App consent is written outside a matched cycle.
- **STATUS** — **OFFLINE-PROVEN.**

### T9 — Caller-supplied lead_id

- **THREAT** — The browser names a `lead_id` and thereby selects which CRM row is merged into or overwritten.
- **ATTACK / FAILURE MODE** — `{"lead_id": "FIN-0001"}` in the body, in `answers`, or nested in `contact`.
- **TRUST BOUNDARY** — TB-1 → TB-4 → TB-7.
- **CURRENT CONTROL** — Three independent layers. (1) `lead_id` and `canonical_lead_id` are untrusted body keys, scanned at top level **and** inside `answers` and `contact`. (2) `buildLeadIntakePayload` is a closed object literal that contains **no `lead_id` key at all** — absent, not blank. (3) Downstream, `dedup-guard.js` admits `lead_id` as a strong row-selection tier **only** when `provenance_trusted` is set, and `normalize-score-lead.js` sets that solely from the authenticated internal route.
- **EXPECTED BEHAVIOUR** — The value is dropped, its key name logged in `untrusted_fields_ignored`, and dedup falls through to contact-based matching.
- **OFFLINE TEST** — "browser-supplied lead_id is ignored and recorded, never honoured"; "the Lead Intake payload carries no lead_id key at all"; and in `qa/lead-intake-trust.test.mjs`, "a payload cannot assert its own provenance".
- **LIVE PROOF REQUIRED?** — **YES**, jointly with T27: the protection's third layer holds only if the deployed Mini App route is **not** wired through `Internal Auth Entry`.
- **FAIL-SAFE / FALLBACK** — Absence of the key is the fail-safe: there is nothing to honour.
- **ROLLBACK / CONTAINMENT** — Pipeline remains canonical (§2); a wrongly merged lead is recoverable from Pipeline history.
- **STATUS** — **OFFLINE-PROVEN.**

### T10 — request_id steering

- **THREAT** — A caller-chosen `request_id` selects which submission a request claims, or which row a retry resolves to.
- **ATTACK / FAILURE MODE** — Send another user's `request_id` (or a guessed idempotency key) hoping to be handed their canonical result.
- **TRUST BOUNDARY** — TB-1 → TB-4.
- **CURRENT CONTROL** — `request_id` and `idempotency_key` are untrusted body keys. The payload's `meta.request_id` is set from the **server** `correlationId` only. The idempotency key is `idempotencyKey(telegram_user_id, cycle_id)` — both server-owned, both validated (`telegram_user_id` must be all-digits), returning `null` if either is blank. `build-pipeline-row.js` documents `request_id` as "a correlation and retry key, never a selection capability".
- **EXPECTED BEHAVIOUR** — The submitted `request_id` never reaches the payload or the key; results are returned only for the caller's own `(user, cycle)`.
- **OFFLINE TEST** — "caller request_id cannot become the payload request_id"; "request_id cannot steer the idempotency key"; "the idempotency key is built only from server-owned values".
- **LIVE PROOF REQUIRED?** — **YES** — canary item 9 (a different-identity `request_id` steering attempt) exists precisely to demonstrate this end-to-end.
- **FAIL-SAFE / FALLBACK** — A key that cannot be derived from server state → `TEMPORARY_BACKEND_ERROR`, never a fresh submit.
- **ROLLBACK / CONTAINMENT** — Correlation ids are diagnostic only; no CRM selection depends on them.
- **STATUS** — **OFFLINE-PROVEN.** Note **G7**: `meta.request_id` is a **fresh UUID per attempt**, so downstream `request_id` cannot deduplicate Mini App retries. All retry safety rests on gateway-side state resolution (T11–T13), not on the Pipeline column.

### T11 — Duplicate submit

- **THREAT** — One user, one cycle, two leads.
- **ATTACK / FAILURE MODE** — Double-tap the submit button; a client that retries on its own timeout.
- **TRUST BOUNDARY** — TB-2/TB-3 → TB-4.
- **CURRENT CONTROL** — `resolvePriorSubmission` runs **before** the consent gate and before any Intake call, resolving in trust order: session record (`submitted` + non-empty `lead_id`) → authority (`lead_id` with `lead_cycle_id` matching **this** cycle) → downstream lookup. Any hit returns the prior canonical success with `idempotent_replay: true` and zero Intake calls, converging lagging records without a second call.
- **EXPECTED BEHAVIOUR** — Exactly one Lead Intake call per `(telegram user, cycle)`; the second request returns the same `lead_id`.
- **OFFLINE TEST** — "a new lead makes exactly one Intake call and one canonical result"; "a client retry after a known success makes zero extra Intake calls"; "a confirmation retry resolves from authority when the session record lagged"; "a lead bound to an older cycle is not mistaken for this cycle result".
- **LIVE PROOF REQUIRED?** — **YES** (canary items 7–8).
- **FAIL-SAFE / FALLBACK** — Resolution precedes consent deliberately, so a retry carrying anything at all in the consent field still receives the committed result rather than an error.
- **ROLLBACK / CONTAINMENT** — Even on failure, Lead Intake's own Dedup Guard merges on contact identity; the worst case is a merge, not a silent second customer record.
- **STATUS** — **OFFLINE-PROVEN.**

### T12 — Concurrent duplicate submit

- **THREAT** — Two requests for the same session race and **both** reach Lead Intake.
- **ATTACK / FAILURE MODE** — Two tabs, or a retry firing while the first request is still in flight — the genuine TOCTOU window between "read state" and "act".
- **TRUST BOUNDARY** — TB-2.
- **CURRENT CONTROL** — `sessions.claim(appSessionId, {from, to, patch})` — a **conditional** update on the current `submit_state`, performed **before** the Intake call. `draft|retryable_error → submitting` can be won once. The loser sees `updated_rows === 0` → `SUBMIT_IN_PROGRESS` (409, retryable). `canTransition` refuses a claim from a non-claimable state before the store is even asked.
- **EXPECTED BEHAVIOUR** — Exactly one request calls Lead Intake; the other is refused without a downstream effect.
- **OFFLINE TEST** — "two concurrent submits cannot both reach Lead Intake"; "a claim lost to a state change is refused as in progress".
- **LIVE PROOF REQUIRED?** — **YES, and this is the sharpest live dependency in the slice.** The offline double implements atomic conditional update by construction. The guarantee is worth exactly as much as the real store's atomicity. Phase 10 live-proved Data Table compare-and-set for the **read model** (execution 3400) — that is strong supporting evidence but it is a *different table and a different predicate*, and must not be cited as proof for the submit claim.
- **FAIL-SAFE / FALLBACK** — Claim-before-call means a crash leaves `submitting` behind — deliberately, because a visible ambiguity is safer than a clean-looking state over a possible downstream lead.
- **ROLLBACK / CONTAINMENT** — Dedup Guard merges on contact identity downstream.
- **STATUS** — **LIVE-PROOF-REQUIRED.**

### T13 — Retry after timeout

- **THREAT** — The client times out, retries, and a second lead is created for an attempt that had actually succeeded.
- **ATTACK / FAILURE MODE** — Network drop after Lead Intake accepted the request but before the response reached the gateway.
- **TRUST BOUNDARY** — TB-4.
- **CURRENT CONTROL** — On a retry the state is `submitting`; the resolver refuses to "submit again and see" and instead calls `leadIntake.lookup(idempotencyKey)`. Three distinct outcomes: known-with-result → return it; answered-and-genuinely-unknown → release the stale claim to `retryable_error`, then exactly one fresh attempt; could-not-answer → `SUBMIT_UNRESOLVED` (503), ambiguity preserved.
- **EXPECTED BEHAVIOUR** — Zero extra Intake calls when the prior attempt succeeded; exactly one when it provably did not.
- **OFFLINE TEST** — "the retry after ambiguity resolves state first and makes zero extra Intake calls"; "a lookup that genuinely knows nothing permits exactly one fresh attempt"; "a lookup that cannot answer keeps the ambiguity rather than guessing".
- **LIVE PROOF REQUIRED?** — **YES** (canary item 12).
- **FAIL-SAFE / FALLBACK** — Preserving ambiguity is the fail-safe. Releasing the stale claim is load-bearing: without it, a `submitting` record would block its own retry forever.
- **ROLLBACK / CONTAINMENT** — See below — currently there is none, because the capability does not exist.
- **STATUS** — **DESIGN-ONLY.** Gap **G1, pre-activation blocker.** `leadIntake.lookup` is an *injected contract with no implementation and no backing store anywhere in the repository*. Nothing persists or indexes `idempotency_key`: it is passed alongside the envelope but never written into the payload, and `meta.request_id` is a fresh UUID per attempt (G7), so the Pipeline `request_id` column cannot serve as the index either. Until a real lookup exists, this branch degrades to the "could not answer" path — see T40 for the consequence.

### T14 — Ambiguous timeout after authority commit

- **THREAT** — Lead Intake succeeded and the canonical binding failed to commit, or the outcome is simply unknown — and the client is told "success" anyway.
- **ATTACK / FAILURE MODE** — `leadIntake.submit` returns `ambiguous: true` (timeout, dropped connection, 5xx after acceptance); or `authority.write` of the lead binding fails after a canonical success.
- **TRUST BOUNDARY** — TB-3 ↔ TB-4.
- **CURRENT CONTROL** — `ambiguous: true` → state stays `submitting` **on purpose** and returns `SUBMIT_UNRESOLVED`; the request never retries inside itself. If `persistCanonical` fails its authority write, the handler returns `SUBMIT_UNRESOLVED` with the reason `AUTHORITY_LEAD_WRITE_FAILED` and explicitly does **not** report success — because doing so would strand a lead the gateway can no longer recognise on retry.
- **EXPECTED BEHAVIOUR** — 503 retryable; the resolver settles it on the next attempt.
- **OFFLINE TEST** — "an ambiguous downstream outcome is not retried inside the same request"; "a failed canonical persist does not report success to the client".
- **LIVE PROOF REQUIRED?** — **YES** (canary item 12), and it depends on G1 being closed first.
- **FAIL-SAFE / FALLBACK** — Never report a success you cannot re-derive.
- **ROLLBACK / CONTAINMENT** — The lead exists in Pipeline and is contact-identifiable; a human can rebind it.
- **STATUS** — **OFFLINE-PROVEN** (the refusal logic). Recovery depends on G1.

### T15 — Authority commit succeeds but mirror update fails

- **THREAT** — The lead binding is committed, the derived read model is not, and the Mini App then serves stale state as if it were current.
- **ATTACK / FAILURE MODE** — Data Table error, CAS abort, or verification mismatch during the mirror generation that follows a good commit.
- **TRUST BOUNDARY** — TB-3 → TB-5.
- **CURRENT CONTROL** — The mirror is derived and non-authoritative, and every failure path in `runMirrorGeneration` **invalidates rather than publishes**: `AUTHORITATIVE_REREAD_FAILED`, `PUBLISH_FAILED` and `VERIFY_FAILED` all call `dt.remove`, and a failed authoritative write returns before any publish. The submit handler treats the mirror as best-effort — `persistCanonical` returns `ok` regardless — which is correct, because `evaluateFastRead` falls back to authority on `MISS`, `TOMBSTONE`, `DUPLICATE_ROWS`, `DATA_TABLE_ERROR`, `MALFORMED_ROW` and `VERSION_MISMATCH`.
- **EXPECTED BEHAVIOUR** — Submit still succeeds; the next Mini App open falls back to `Bot_Sessions` and is correct, merely slower.
- **OFFLINE TEST** — "a failed publish cannot leave the old row readable as a HIT"; "a verification mismatch from an existing readable row invalidates it"; "a failed authoritative write never publishes the attempted projection"; "the happy path mirror count is wrong" guard on counters.
- **LIVE PROOF REQUIRED?** — **YES** (canary item 11), including the ~6–7 s Sheets fallback latency the Phase 10 measurement recorded.
- **FAIL-SAFE / FALLBACK** — Invalidate-on-doubt; authority always answers.
- **ROLLBACK / CONTAINMENT** — Delete the derived row; the read model is rebuildable by backfill.
- **STATUS** — **OFFLINE-PROVEN.** Residual **G3**: `persistCanonical` calls `ctx.mirror(ctx.chatId)` **without a try/catch**, and `handleSubmit` has no top-level catch. A mirror client that *throws* (rather than returning a failure) would propagate out of a submit whose authority commit already succeeded, turning a completed submission into an unhandled node error. Recovery is still sound — the next attempt resolves from authority — but the immediate response is a 500 rather than a clean `SUBMIT_UNRESOLVED`.

### T16 — Mirror update succeeds but HTTP response fails

- **THREAT** — Everything committed; the client never received the confirmation and believes it failed.
- **ATTACK / FAILURE MODE** — Connection dropped on the response leg; browser closed at the moment of reply.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — Server state is complete: `submit_state = submitted` with `lead_id` on both the session record and the authority row. The next attempt resolves at the first branch of `resolvePriorSubmission` (session) or the second (authority) and returns the identical canonical success with `idempotent_replay: true`.
- **EXPECTED BEHAVIOUR** — The retry returns the same `lead_id`, zero extra Intake calls, and does not re-run consent.
- **OFFLINE TEST** — "a client retry after a known success makes zero extra Intake calls"; "a confirmation retry resolves from authority when the session record lagged".
- **LIVE PROOF REQUIRED?** — **YES** (canary item 8).
- **FAIL-SAFE / FALLBACK** — Authority-first ordering means the record is complete *before* the client is told anything, so a lost response is always recoverable.
- **ROLLBACK / CONTAINMENT** — None needed; the state is correct.
- **STATUS** — **OFFLINE-PROVEN.**

### T17 — Duplicate Data Table rows

- **THREAT** — Two derived rows for one `chat_id`; an arbitrary one is served as truth.
- **ATTACK / FAILURE MODE** — A partial write, a racing publish, or a manual insert leaves two rows.
- **TRUST BOUNDARY** — TB-5.
- **CURRENT CONTROL** — Every read uses `READ_LIMIT = 2`. `rows.length > 1` → `FALLBACK DUPLICATE_ROWS` on the read path and `DUPLICATE_ROWS` on the verifier. **Limit 2 is load-bearing**: a limit-1 read cannot distinguish a healthy row from the first of two corrupted ones. `runBackfill` repairs by removing every row and republishing exactly one.
- **EXPECTED BEHAVIOUR** — Never select an arbitrary first row; fall back to authority.
- **OFFLINE TEST** — "duplicate rows fall back and never pick an arbitrary first row"; "**limit 2 is load-bearing: the same pair under limit 1 would have been a HIT**"; "backfill repairs duplicate rows down to exactly one".
- **LIVE PROOF REQUIRED?** — Partially satisfied: Phase 10 execution 3400 proved `rows_found_limit2 = 1 / DUPLICATE_FREE` against the real QA Data Table.
- **FAIL-SAFE / FALLBACK** — Fall back to `Bot_Sessions`.
- **ROLLBACK / CONTAINMENT** — Backfill rebuilds the row set.
- **STATUS** — **OFFLINE-PROVEN** (with live supporting evidence from Phase 10).

### T18 — Data Table unavailable

- **THREAT** — The read model is down and the Mini App fails, or worse, serves an empty state as truth.
- **ATTACK / FAILURE MODE** — Data Table outage, permission change, deleted table.
- **TRUST BOUNDARY** — TB-5.
- **CURRENT CONTROL** — `evaluateFastRead` checks `o.error` **first**, before any row inspection → `FALLBACK DATA_TABLE_ERROR`. `resolveResume` then reads authority; only if authority *also* fails does it return `TEMPORARY_BACKEND_ERROR` (retryable), with an all-zero `writes` block.
- **EXPECTED BEHAVIOUR** — Degrade to the authoritative path. Correct, slower, never wrong.
- **OFFLINE TEST** — "Data Table outage falls back"; "every fallback class resumes without writing".
- **LIVE PROOF REQUIRED?** — **YES** for the resulting latency: Phase 10 measured the Sheets synchronous path at 6079–7190 ms against 15–21 ms for the Data Table, and concluded Sheets is *not viable* in the synchronous resume path. A prolonged outage is therefore a UX-severity event even though it is not a correctness one.
- **FAIL-SAFE / FALLBACK** — Authority is always the fallback; the read model is never the fallback for authority.
- **ROLLBACK / CONTAINMENT** — The read model is derived and rebuildable; no data is lost.
- **STATUS** — **OFFLINE-PROVEN.**

### T19 — Malformed derived row

- **THREAT** — A derived row missing fields, carrying a blank key, or holding a field that should never have been mirrored is read as state.
- **ATTACK / FAILURE MODE** — Schema drift, a partial publish, or a leaked `raw`/`notes`/`init_data` column.
- **TRUST BOUNDARY** — TB-5.
- **CURRENT CONTROL** — `storedRowDefects` reports `missing_field:*` for any of the 15 projection fields absent, `empty_chat_id` for a blank lookup key, and `forbidden_field:*` for anything in `NEVER_MIRROR` (`notes`, `previous_lead_id`, `raw`, `raw_json`, `payload`, `init_data`). Any defect → `FALLBACK MALFORMED_ROW`. `stripStoredRow` deliberately leaves absent keys absent so the omission stays visible. A blank `cycle_id` is explicitly **not** a defect — legacy blank-cycle rows exist and are handled by `evaluateCycle`, which refuses to let a blank cycle validate any binding.
- **EXPECTED BEHAVIOUR** — Fall back to authority; never partially trust a row.
- **OFFLINE TEST** — "a row missing mirrored keys entirely is MALFORMED"; "malformed and empty-key rows fall back"; "blank cycle_id never validates a blank consent or lead binding".
- **LIVE PROOF REQUIRED?** — **NO** for the logic. One tenant note carries forward from Phase 10 §10.1: the QA Data Table still has a retired `source_version` column. It is harmless (control metadata, never hashed, never projected) but should be dropped on the next rebuild.
- **FAIL-SAFE / FALLBACK** — Authority.
- **ROLLBACK / CONTAINMENT** — Backfill republishes a clean row.
- **STATUS** — **OFFLINE-PROVEN.**

### T20 — Cache poisoning

- **THREAT** — A derived row is altered so the Mini App shows another user's data, a forged consent, or a forged lead binding.
- **ATTACK / FAILURE MODE** — Direct Data Table write; a partial/incomplete publish; tampering with the `projection_version` column to make a wrong row look right.
- **TRUST BOUNDARY** — TB-5.
- **CURRENT CONTROL** — Four layers. (1) `projection_version` is SHA-256 over the canonical serialisation of the **STORED** row, never the intended payload — the exact line that would have caught the historical `session_id` defect. (2) Field-by-field `diffProjections` in addition to the hash, so a hash collision or a tampered hash column cannot alone produce a HIT. (3) Injection-safe serialisation: each key and value is `JSON.stringify`-ed independently, so a value containing the separator cannot forge a field boundary. (4) Allowlist projection plus `NEVER_MIRROR`, so payload columns cannot reach the derived table.
- **EXPECTED BEHAVIOUR** — Any inconsistency → `VERSION_MISMATCH` or `MALFORMED_ROW` → fall back to authority.
- **OFFLINE TEST** — "a stored row whose hash column was tampered is rejected"; "a silently mutated stored field falls back on the hash"; "an incomplete publish set is caught by the helper, not published as valid". Group B additionally carries a **regression witness** asserting the historical intended-payload hash *would* have accepted the defective row.
- **LIVE PROOF REQUIRED?** — Partially satisfied: Phase 10 execution 3400 reproduced the incomplete-publish defect against the real Data Table and showed the old verifier accepting it and the corrected one rejecting it, and `scripts/verify-live-cas-execution.mjs` re-derived the tenant's `projection_version` with the repo's own `projection.js` (22/22).
- **FAIL-SAFE / FALLBACK** — Authority, always.
- **ROLLBACK / CONTAINMENT** — Delete and republish. MCP exposure is 0 of 35 workflows after the Phase 10 hardening, which removes the trigger surface that would let an unauthorised caller drive a write.
- **STATUS** — **OFFLINE-PROVEN**, with an explicit trust-boundary assumption: the hash is an **integrity** check against incomplete or corrupted writes, **not an authenticity** check. It is unkeyed, so a writer who legitimately holds Data Table credentials can author a *self-consistent* poisoned row that the read path would serve as a HIT. Detecting that requires comparison against authority, which only `reconcile` does — and see T37. Anyone with tenant write credentials is inside TB-5 by definition; this is a stated assumption, not a defended boundary.

### T21 — Stale mirror generation / CAS conflict

- **THREAT** — An older generation overwrites a newer one and the cache ends up behind authority.
- **ATTACK / FAILURE MODE** — Two mirror generations overlap; the slower one publishes last.
- **TRUST BOUNDARY** — TB-5.
- **CURRENT CONTROL** — Publish is a **single conditional update** matching `chat_id` **AND** `sync_token`; a read-then-upsert is explicitly rejected as non-equivalent because another generation can invalidate between the two operations. `updated_rows === 0` → `ABORTED_CAS_MISMATCH`, which aborts **without publishing and without deleting**, because the newer generation's row is the correct state.
- **EXPECTED BEHAVIOUR** — The superseded generation updates zero rows and stands down.
- **OFFLINE TEST** — "TOCTOU: a helper paused before publish updates zero rows"; "post-race replay is idempotent and leaves exactly one row". The `hooks.beforePublish` seam exists specifically to interleave a competing generation inside the real window.
- **LIVE PROOF REQUIRED?** — **Satisfied for the read-model table.** Execution 3400 recorded `stale_token_updated_rows = 0 / CAS_STALE_ZERO_ROWS` and `complete_publish_updated_rows = 1` against the live QA Data Table. This does **not** transfer to the submit claim store (T12).
- **FAIL-SAFE / FALLBACK** — Abort, do not delete; the newer row survives.
- **ROLLBACK / CONTAINMENT** — Backfill.
- **STATUS** — **OFFLINE-PROVEN** (live-proven for the read model).

### T22 — Reversed completion order

- **THREAT** — Mutation A starts before B but commits after it, and the cache ends up reflecting B — start order, not commit order.
- **ATTACK / FAILURE MODE** — Overlapping executions with differing durations.
- **TRUST BOUNDARY** — TB-3 → TB-5.
- **CURRENT CONTROL** — Two-token commit-order generation. The publish token is issued **only after** a successful authoritative commit, so the last successful commit owns the newest cache generation. A start-order token is explicitly rejected in the module header as the thing that gets this wrong.
- **EXPECTED BEHAVIOUR** — The cache converges on the **last authoritative commit**, irrespective of start order.
- **OFFLINE TEST** — "normal completion order: the later commit owns the cache"; "reversed completion order: the cache converges on the last authoritative commit".
- **LIVE PROOF REQUIRED?** — **Satisfied for ordering.** PR #10 proved reversed-order ordering live, and Phase 10 §7 is careful about what that did and did not establish: ordering PASS, *equality* not proven by that run — equality is what execution 3400 and the corrected verifier closed.
- **FAIL-SAFE / FALLBACK** — Verification failure invalidates rather than publishes.
- **ROLLBACK / CONTAINMENT** — Backfill.
- **STATUS** — **OFFLINE-PROVEN** (ordering live-proven).

### T23 — Browser PII leakage

- **THREAT** — The submit response hands the browser identity, cycle or control metadata.
- **ATTACK / FAILURE MODE** — A downstream body echoed through; a nested object carrying `chat_id` or `init_data`; verbose error details.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — `buildSubmitSuccess` constructs a **six-field whitelist** (`ok`, `lead_id`, `mode`, `priority`, `financial_zone`, `submit_state`) from scratch — the downstream body is never spread into the response. Values are re-clamped to allowed vocabularies, so a surprising downstream value becomes `UNKNOWN` rather than passing through. `responseLeaks` walks the response **recursively** against 21 forbidden keys. Errors return only `{ok, error_code, retryable}`. On the read side, `buildClientResume` exposes six presentation fields and `leakFields` forbids control metadata, Data Table internals and every identity field.
- **EXPECTED BEHAVIOUR** — Nothing beyond the whitelist reaches the browser on any branch.
- **OFFLINE TEST** — "the success response leaks no identity or control field"; "error responses expose only code and retryability"; "resume never returns identity or control metadata to the browser".
- **LIVE PROOF REQUIRED?** — **YES** (canary item 14) — the real n8n Respond node must not append its own envelope.
- **FAIL-SAFE / FALLBACK** — Whitelist construction, not blacklist filtering; the recursive check is a second line, not the first.
- **ROLLBACK / CONTAINMENT** — Disable the entry point.
- **STATUS** — **OFFLINE-PROVEN.**

### T24 — Log PII leakage

- **THREAT** — `init_data`, signatures, contact details or credentials land in retained execution logs.
- **ATTACK / FAILURE MODE** — Logging the whole request body; or an error detail carrying a user-supplied *value*.
- **TRUST BOUNDARY** — TB-6.
- **CURRENT CONTROL** — In-module, the discipline holds: the accept log carries `logged_contact_fields: []`, and `untrusted_fields_ignored` records **key names only**. Every `fail(code, stage, detail)` call site passes a *field name* or a static string as `detail` — never a user value. `init_data` is in both `UNTRUSTED_BODY_KEYS` and `RESPONSE_FORBIDDEN_KEYS`. `ai-safe-projection.js` independently drops `ga_client_id`, `ga_session_id`, `analytics_consent`, `request_id` and `lead_id` before anything reaches an AI call.
- **EXPECTED BEHAVIOUR** — §12: raw `init_data`, signatures, direct contact data and credentials never appear in ordinary execution logs.
- **OFFLINE TEST** — "contact details and init_data are never written to the accept log". Note the limit honestly: this asserts the **accept** log. The reject-log property holds by construction (detail is always a key name or a constant) but has no dedicated check.
- **LIVE PROOF REQUIRED?** — **YES, and the module cannot win this one alone.** n8n retains node input/output for executions, so the *platform* will capture the raw body — including `contact.name`, `contact.direct` and `init_data` — regardless of what this code chooses to log. The control that matters is retention configuration, tracked in `docs/FINMENTOR_N8N_RETENTION_PLAN.md`, not application logging.
- **FAIL-SAFE / FALLBACK** — Key-name-only logging; no value interpolation into error details.
- **ROLLBACK / CONTAINMENT** — Prune executions; tighten retention before activation.
- **STATUS** — **LIVE-PROOF-REQUIRED.** Recommended additions: a dedicated reject-log assertion, and a pre-activation retention setting verified against the plan.

### T25 — GA identifiers without analytics consent

- **THREAT** — GA4 client/session identifiers are attached to a Mini App lead although the user never accepted analytics.
- **ATTACK / FAILURE MODE** — A payload carrying `ga_client_id`/`ga_session_id`; or a CRM writer defaulting consent to true when the field is absent.
- **TRUST BOUNDARY** — TB-1 → TB-7.
- **CURRENT CONTROL** — Structural and fail-closed. The Mini App envelope's `meta` is a **closed literal** — `consent`, `request_id`, `page_url: 'telegram_miniapp'`, `utm_source: 'telegram'`, `utm_medium: 'miniapp'` — with no GA identifier and no `analytics_consent`. Downstream, `build-pipeline-row.js` computes `__consent = __meta.analytics_consent === true`, so **absence evaluates to false**, writing `analytics_consent: 'FALSE'` and empty `ga_client_id`/`ga_session_id`. `build-merge-update.js` only overwrites the stored value when the key is genuinely present. The Mini App client (`app/`) loads no analytics script at all.
- **EXPECTED BEHAVIOUR** — Every Mini App lead lands with `analytics_consent = FALSE` and empty GA columns until a separate, explicit analytics consent exists.
- **OFFLINE TEST** — Structural, plus "the envelope matches the shape the existing Lead Intake parses" and "only whitelisted answers reach the payload". The website-side consent gate is covered separately by `qa/website-contract.test.mjs` ("no Google script is loaded before a consent choice").
- **LIVE PROOF REQUIRED?** — **NO** for this path. The strict-equality gate makes absence safe.
- **FAIL-SAFE / FALLBACK** — `=== true` rather than truthiness: the safe value is the default.
- **ROLLBACK / CONTAINMENT** — n/a — no identifier is ever sent.
- **STATUS** — **OFFLINE-PROVEN.** Recommended: add an explicit check asserting the Mini App envelope contains no `ga_*` key and no `analytics_consent`, so the property is defended by a gate rather than by the current shape of a literal.

### T26 — Telegram credential exposure

- **THREAT** — The bot token or another server secret reaches the browser, a spreadsheet, workflow JSON or a log.
- **ATTACK / FAILURE MODE** — Token embedded in a response; a validator that needs the token in an exposed place; a secret committed to the repo.
- **TRUST BOUNDARY** — TB-1, TB-6.
- **CURRENT CONTROL** — §2 forbids the Mini App ever receiving a bot token, Google credential or n8n credential. The **preferred validation path needs no token at all**: third-party Ed25519 uses only the non-secret numeric `bot_id` and Telegram's public key — the stated reason for preferring it. The HMAC fallback requires the token to stay in a server credential store (§3.4). `RESPONSE_FORBIDDEN_KEYS` includes `bot_token`, `token`, `credential`, `hash`, `signature`. `scripts/secret-scan.mjs` runs in CI over every tracked file.
- **EXPECTED BEHAVIOUR** — Zero credential-shaped literals in the repo; zero secrets in any response.
- **OFFLINE TEST** — Secret scan: 199 tracked text files, 5 patterns, PASS. Response leak check covers the credential keys recursively.
- **LIVE PROOF REQUIRED?** — **YES** in the weak sense — the deployed workflow must be confirmed to use the Ed25519 path (or a credential-store token), not an inline literal.
- **FAIL-SAFE / FALLBACK** — Choosing the algorithm that structurally does not need the secret is the strongest available control.
- **ROLLBACK / CONTAINMENT** — Token rotation via BotFather; no repository change needed.
- **STATUS** — **OFFLINE-PROVEN.**

### T27 — Public route reaching trusted internal provenance

- **THREAT** — The Mini App submit route is wired so that requests arrive with `provenance_trusted = true`, promoting a public, browser-originated caller to internal trust.
- **ATTACK / FAILURE MODE** — Wiring the Mini App webhook through the `Internal Auth Entry` node; or a payload asserting `__internal_route` / `internal_route` / `provenance_trusted`.
- **TRUST BOUNDARY** — TB-4 → TB-7. **The most consequential boundary in the model**, because trusted provenance re-enables `lead_id` as a strong row-selection tier in `dedup-guard.js`.
- **CURRENT CONTROL** — Provenance is established **by the route only**: `internalRouteProven()` reads `$('Internal Auth Entry').first().json.__internal_route === true` inside a try/catch, so on any path where that node did not run, `$()` throws and provenance is false — "deliberately never defaulted to true". The retired Sheets-secret path was removed. Independently, the Mini App payload contains no `lead_id` at all (T9), and `provenance_trusted`, `internal_route` and `__internal_route` are untrusted body keys stripped by the validator.
- **EXPECTED BEHAVIOUR** — Mini App submits arrive **untrusted**, and dedup resolves through contact-based matching — which is the correct behaviour for a public caller.
- **OFFLINE TEST** — `qa/lead-intake-trust.test.mjs`: "a payload cannot assert its own provenance" (over all three hostile shapes); "the retired Sheets-secret path still grants trust" (negative); "the authenticated internal route does grant provenance".
- **LIVE PROOF REQUIRED?** — **YES.** The wiring does not exist in the repository, so nothing offline can prove which route the deployed Mini App submit uses.
- **FAIL-SAFE / FALLBACK** — `$()` throwing on a non-executed node is a fail-closed default by construction.
- **ROLLBACK / CONTAINMENT** — Re-route; Pipeline history allows a wrong merge to be reconstructed.
- **STATUS** — **DESIGN-ONLY.** Binding rule for activation: **the Mini App submit route MUST NOT be wired through `Internal Auth Entry`.** It is a public-origin caller and must remain untrusted-provenance; its identity assurance comes from validated `initData`, not from internal trust.

### T28 — Caller manipulation of urgency

- **THREAT** — The browser inflates lead priority by sending an urgency value that escalates downstream scoring.
- **ATTACK / FAILURE MODE** — `urgency: "срочно"`, `urgency: "high"`, or free text engineered to hit the scorer's keyword patterns.
- **TRUST BOUNDARY** — TB-1 → TB-4.
- **CURRENT CONTROL** — `urgency` is validated against a four-value enum (`now|month|quarter|none`); anything else is `ANSWER_VALUE_UNKNOWN` and the request is **refused, not sanitised**. The string handed downstream comes from the server-side `URGENCY_RU` map, never from the browser. §11's rule is enforced concretely: `none` maps to `Нет срочности`, which is semantically negative. Free text is carried in a separate `free_text` field, not in `main_pain.urgency`.
- **EXPECTED BEHAVIOUR** — Only `now` escalates; `none` never does, and never independently raises priority.
- **OFFLINE TEST** — "urgency none stays negative and does not escalate downstream"; "urgency now is the only Mini App value that escalates"; "the urgency string handed to Lead Intake comes from the whitelist, not the browser"; and the drift guard "**the copied Lead Intake urgency rules still match the deployed scorer**".
- **LIVE PROOF REQUIRED?** — **NO** for the mapping. The drift guard inverts the usual risk: if `normalize-score-lead.js` changes its patterns, this gate fails rather than `none` silently re-escalating months later.
- **FAIL-SAFE / FALLBACK** — Unknown value → reject. `URGENCY_RU[a.urgency] || ''` yields an empty string, not a default urgency, if ever reached.
- **ROLLBACK / CONTAINMENT** — Priority is recomputable from Pipeline.
- **STATUS** — **OFFLINE-PROVEN.**

### T29 — Caller manipulation of consent

- **THREAT** — The browser manufactures a legal basis for a CRM write.
- **ATTACK / FAILURE MODE** — `consent: 1`, `consent: "true"`, `consent: {}`; or supplying `consent_at` / `consent_cycle_id` / `consent_source` directly.
- **TRUST BOUNDARY** — TB-1 → TB-3.
- **CURRENT CONTROL** — Only the literal strings `"yes"` and `"no"` decide; everything else is `CONSENT_REQUIRED`. Anything looser would let a serialisation accident manufacture consent. All three stamp fields are untrusted body keys, and the stamp is built entirely server-side from the authority row and the server clock. The stamp commits to `Bot_Sessions` **before** the Intake call, and a failed consent write stops the submit. `consent: "no"` is an accepted, side-effect-free outcome that leaves the submit state untouched so the user may consent later in the same cycle.
- **EXPECTED BEHAVIOUR** — No Intake call without a server-stamped, current-cycle consent.
- **OFFLINE TEST** — "consent must be the literal yes or no decision"; "consent NO performs zero Lead Intake calls and zero writes"; "consent NO leaves the submit state where it was"; "consent commits to authority before Lead Intake is called"; "a failed consent write stops the submit before Lead Intake".
- **LIVE PROOF REQUIRED?** — **YES** (canary items 6 and 10) — the ordering must be observed against real `Bot_Sessions`.
- **FAIL-SAFE / FALLBACK** — Strict literal equality; absence is refusal.
- **ROLLBACK / CONTAINMENT** — Concierge consent semantics remain authoritative and untouched.
- **STATUS** — **OFFLINE-PROVEN.**

### T30 — Payload field injection / unexpected fields

- **THREAT** — Unexpected fields widen the CRM vocabulary, forge structure in a log or sheet, or are evaluated as an expression.
- **ATTACK / FAILURE MODE** — Unknown answer keys/values; a formula-prefixed free-text value (`=IMPORTXML(...)`); embedded newlines or control characters; an oversized body.
- **TRUST BOUNDARY** — TB-1 → TB-7.
- **CURRENT CONTROL** — Fail-closed whitelist throughout: unknown answer key → `ANSWER_KEY_UNKNOWN`; unknown answer **value** → `ANSWER_VALUE_UNKNOWN`; unknown contact key → `CONTACT_KEY_UNKNOWN`. Rejection, not silent dropping, because a value the server does not understand must not reach the CRM as if it were understood. `sanitiseText` maps C0/C1 control characters to spaces and prefixes a leading `=`, `+`, `-` or `@` with an apostrophe. Size ceilings: 16 KB body, 32 KB payload, 500-char free text (matching the browser's own `maxlength`), 200-char contact fields. `JSON.stringify` failure is caught rather than thrown.
- **EXPECTED BEHAVIOUR** — 400 with a stage and a **key name** as detail; data stays data and is never evaluated.
- **OFFLINE TEST** — "unknown answer key is refused, not silently dropped"; "unknown answer value is refused"; "unknown contact key is refused"; "free text is stored as data: control characters and formulas are neutralised"; "oversized body is refused".
- **LIVE PROOF REQUIRED?** — **NO** for the validator. §7's "never executed as expressions/code" additionally requires that no n8n node interpolates these values into an expression — a deployment property.
- **FAIL-SAFE / FALLBACK** — Reject rather than coerce.
- **ROLLBACK / CONTAINMENT** — Nothing reaches the CRM to roll back.
- **STATUS** — **OFFLINE-PROVEN.**

### T31 — State-machine illegal transition

- **THREAT** — A submission leaves a terminal state, or enters `submitting` from a state that must not permit it.
- **ATTACK / FAILURE MODE** — `submitted → draft`; a same-state re-entry treated as a fresh claim; an unknown state string.
- **TRUST BOUNDARY** — TB-2.
- **CURRENT CONTROL** — `TRANSITIONS` is explicit and `submitted` has an **empty** outgoing list. `canTransition` rejects unknown states on either side and permits `from === to` **only** for `submitted` (so an idempotent replay is legal and a same-state re-claim is not). `submit_state` is an untrusted body key, so the current state always comes from the store. The claim is refused before the store is touched: `STATE_NOT_CLAIMABLE` → `SUBMIT_IN_PROGRESS`.
- **EXPECTED BEHAVIOUR** — Monotonic toward `submitted`; nothing leaves `submitted`.
- **OFFLINE TEST** — "the submit state machine is monotonic toward submitted"; "a claim lost to a state change is refused as in progress"; "a retryable_error may be retried and reaches exactly one Intake call".
- **LIVE PROOF REQUIRED?** — **NO** for the transition table; **YES** for the store's atomicity (see T12).
- **FAIL-SAFE / FALLBACK** — The single backwards path (`submitting → retryable_error`) is reachable only when the resolver has proven no canonical result exists, and structurally cannot touch `submitted`.
- **ROLLBACK / CONTAINMENT** — Session TTL expiry clears a stuck record.
- **STATUS** — **OFFLINE-PROVEN.**

### T32 — `submitted` state without canonical lead_id

- **THREAT** — A record claims `submitted` but no lead exists anywhere, and the system either strands the user or silently re-submits.
- **ATTACK / FAILURE MODE** — A crash between the claim and the canonical write, combined with a lost downstream result.
- **TRUST BOUNDARY** — TB-2 ↔ TB-4.
- **CURRENT CONTROL** — The resolver treats this as a distinct animal: after the lookup answers and reports the key genuinely unknown, a state of `submitting` releases the claim to `retryable_error` and permits exactly one fresh attempt, whereas a state of `submitted` returns `unresolved` — **the state machine forbids leaving `submitted`, so it is never quietly downgraded into a fresh submission**.
- **EXPECTED BEHAVIOUR** — `SUBMIT_UNRESOLVED` (503) and escalation to an operator, never an automatic second lead.
- **OFFLINE TEST** — Adjacent branches covered ("a lookup that genuinely knows nothing permits exactly one fresh attempt", "a lookup that cannot answer keeps the ambiguity rather than guessing"). There is **no dedicated check** for `submitted` + no-lead-anywhere; recommended addition.
- **LIVE PROOF REQUIRED?** — **YES**, and it depends on G1.
- **FAIL-SAFE / FALLBACK** — Refusing to downgrade is the fail-safe: a stuck session is better than a duplicate customer record.
- **ROLLBACK / CONTAINMENT** — Manual: locate by contact in Pipeline, rebind, or let the session TTL expire and let the next cycle proceed cleanly.
- **STATUS** — **OFFLINE-PROVEN** (refusal to downgrade). The operator runbook is **DESIGN-ONLY** — none exists.

### T33 — Canonical lead_id created but client retries

- **THREAT** — The lead exists; the client, unaware, retries and creates a second.
- **ATTACK / FAILURE MODE** — Impatient user; automatic client retry; page reload on the confirmation screen.
- **TRUST BOUNDARY** — TB-1 → TB-4.
- **CURRENT CONTROL** — Authority-first ordering guarantees the binding is committed **before** the client is told anything, so a retry always finds server state to resolve from. The resolver returns the prior canonical success and converges any lagging session record **without** a second Intake call, recording `idempotent_replay: true` and `resolved_from` in the log.
- **EXPECTED BEHAVIOUR** — Identical `lead_id`, `lead_intake_calls = 0`.
- **OFFLINE TEST** — "a client retry after a known success makes zero extra Intake calls"; "a confirmation retry resolves from authority when the session record lagged"; "every branch reports its own side-effect counters".
- **LIVE PROOF REQUIRED?** — **YES** (canary item 8).
- **FAIL-SAFE / FALLBACK** — Resolution runs ahead of the consent gate so a retry cannot be turned into an error by whatever the client sent in the consent field.
- **ROLLBACK / CONTAINMENT** — Dedup Guard merges on contact identity.
- **STATUS** — **OFFLINE-PROVEN.**

### T34 — Lead Intake `mode=new` vs `merged` vs retry ambiguity

- **THREAT** — The system, or the user, cannot tell a new lead from a merge from a replayed retry — and the UI discloses duplicate status.
- **ATTACK / FAILURE MODE** — An unexpected `mode` value passed through verbatim; a retry reporting a different `mode` than the original.
- **TRUST BOUNDARY** — TB-4 → TB-1.
- **CURRENT CONTROL** — `buildSubmitSuccess` clamps `mode` to `new|merged` (default `new`), `priority` to `HOT|WARM|COLD|INCOMPLETE` (default `COLD`) and `financial_zone` to `RED|ORANGE|YELLOW|GREEN|UNKNOWN` (default `UNKNOWN`) — a surprising downstream value is reported as a known-safe value rather than passed through. The log distinguishes the three cases explicitly via `idempotent_replay` and `resolved_from` (`session` | `authority` | `lookup`). §9's rule "the UI must not tell a client they were a duplicate" is a presentation rule; the closure records that confirmation copy does not differ between new and merged.
- **EXPECTED BEHAVIOUR** — Operators can distinguish all three from the log; the customer sees identical copy either way.
- **OFFLINE TEST** — "a merge makes exactly one Intake call and returns the existing canonical lead"; "the success response leaks no identity or control field".
- **LIVE PROOF REQUIRED?** — **YES** (canary items 7–8) — a real Lead Intake `mode` has never been observed by this code.
- **FAIL-SAFE / FALLBACK** — Clamp to a safe known value rather than echo.
- **ROLLBACK / CONTAINMENT** — Pipeline retains the merge history.
- **STATUS** — **OFFLINE-PROVEN**, with two honest residuals (**G6**): (1) `mode` is in the client whitelist, so merge status **is** disclosed in the response body even if the UI hides it — §9 cares about this, and whether `mode` should cross TB-1 at all is an open design question; (2) on a retry resolved from **authority**, `mode` is read from `authorityRow.lead_mode`, which the submit path never writes — so a merged lead can be reported as `new` on replay. Harmless under §9's own rule, but inconsistent, and it should be either persisted or dropped rather than left to the clamp default.

### T35 — Client response exposing authority/internal metadata

- **THREAT** — Control metadata, n8n row internals or workflow identifiers reach the browser.
- **ATTACK / FAILURE MODE** — Spreading a Data Table row or an authority row into the response; a nested error object carrying `row_number`, `id` or `workflow_id`.
- **TRUST BOUNDARY** — TB-1.
- **CURRENT CONTROL** — Whitelist construction plus a recursive check on both surfaces. Submit forbids `raw_json`, `row`, `row_number`, `id`, `notes`, `workflow_id`, `session_id`, `app_session_id` and every cycle/consent field. Resume's `leakFields` forbids `CONTROL_FIELDS` (`cache_valid`, `sync_token`, `projection_version`, `source_updated_at`, `mirror_updated_at`), `DATA_TABLE_INTERNALS` (`id`, `createdAt`, `updatedAt`), `NEVER_MIRROR` and all identity fields. §4 restates it: no internal row numbers, credentials, workflow IDs or internal notes. The submit and resume lists differ deliberately — submit legitimately returns `lead_id`, resume never does.
- **EXPECTED BEHAVIOUR** — Six presentation fields on resume, six on submit, nothing else.
- **OFFLINE TEST** — "resume never returns identity or control metadata to the browser"; "the success response leaks no identity or control field"; run on both the cache-hit and authoritative-fallback responses.
- **LIVE PROOF REQUIRED?** — **YES** (canary item 14).
- **FAIL-SAFE / FALLBACK** — Build-from-scratch, never filter-then-forward.
- **ROLLBACK / CONTAINMENT** — Disable the entry point.
- **STATUS** — **OFFLINE-PROVEN.**

### T36 — Corrupted or missing Bot_Sessions authority

- **THREAT** — Authority is unreadable or partial, and the system proceeds as though the user were new.
- **ATTACK / FAILURE MODE** — Sheets outage; a deleted row; a row present but missing `cycle_id`.
- **TRUST BOUNDARY** — TB-3.
- **CURRENT CONTROL** — `authority.read` failure → `TEMPORARY_BACKEND_ERROR` (503, retryable) — explicitly **never a fresh submit**. A row lacking `cycle_id` → `CYCLE_SUPERSEDED` / `CYCLE_MISSING`. On the read side, `resolveResume` returns a retryable error with an all-zero `writes` block when both the read model and authority fail. §5.1 is structural: "a read that finds nothing returns *nothing to resume*; it does not create the thing it failed to find."
- **EXPECTED BEHAVIOUR** — Retryable error, zero writes, zero Intake calls. No cycle is minted to paper over a missing row.
- **OFFLINE TEST** — "an unreadable authority is a temporary backend error, never a fresh submit"; "an authority row with no cycle cannot be submitted against"; "every fallback class resumes without writing".
- **LIVE PROOF REQUIRED?** — **YES** — real Sheets failure modes (partial reads, quota errors, transient 5xx) have not been observed through this path.
- **FAIL-SAFE / FALLBACK** — Fail closed and retryable. The read model is **never** promoted to authority.
- **ROLLBACK / CONTAINMENT** — Concierge remains fully functional; the Mini App entry can be disabled independently.
- **STATUS** — **OFFLINE-PROVEN.**

### T37 — Mirror reconciliation racing with live submit

- **THREAT** — A reconciliation pass republishes a derived row while a submit is committing, overwriting the newer generation or resurrecting a tombstone.
- **ATTACK / FAILURE MODE** — Scheduled reconciliation overlapping an in-flight submit.
- **TRUST BOUNDARY** — TB-5.
- **CURRENT CONTROL** — **The race cannot arise, because `reconcile()` performs no writes at all.** Every branch pushes a finding with `repaired: false`, the function never calls `runMirrorGeneration`, `dt.publish`, `dt.remove` or `dt.setTombstone`, and it returns a literal `authority_writes: 0`. It is a pure classifier: `NO_AUTHORITY`, `READ_ERROR`, `MISS`, `DUPLICATE`, `TOMBSTONE`, `MALFORMED`, `VERSION_MISMATCH`, `STALE`, `CURRENT`. Independently, Phase 10's stop conditions prohibit activating reconciliation or any polling schedule, and no schedule exists.
- **EXPECTED BEHAVIOUR** — Reconciliation observes and reports; repair is a separate, deliberate act.
- **OFFLINE TEST** — "reconciliation classifies drift and never writes authority".
- **LIVE PROOF REQUIRED?** — **NO** while it stays read-only. **YES** the moment a repair mode is added — at which point the CAS token discipline (T21) becomes load-bearing for it too, and this threat re-opens.
- **FAIL-SAFE / FALLBACK** — Read-only by construction.
- **ROLLBACK / CONTAINMENT** — Nothing to roll back.
- **STATUS** — **NOT-APPLICABLE** as implemented. Gap **G4**, a documentation defect worth fixing before it misleads someone: the module header claims reconciliation "repairs by republishing" and gateway contract §5.1 says "repair belongs to the mirror helper **and to reconciliation**" — both describe behaviour the code does not have. Backfill (`runBackfill`) is the only repair path that actually exists, and it is manual.

### T38 — Replay across cycle boundary

- **THREAT** — A captured submit body is replayed after the cycle rolls, creating a second lead under a consent the user gave for the previous cycle.
- **ATTACK / FAILURE MODE** — Replay a full request body — including its `consent: "yes"` — after the Concierge has reset the cycle.
- **TRUST BOUNDARY** — TB-1 → TB-3.
- **CURRENT CONTROL** — Three independent barriers. (1) The old `app_session_id` is bound to the old cycle, so `session.cycle_id !== authorityRow.cycle_id` → `CYCLE_SUPERSEDED` before consent is even evaluated. (2) Even if a session were re-bound, `evaluateConsent` requires the session cycle to equal the authoritative cycle, so replayed consent is `CONSENT_STALE_CYCLE`. (3) The idempotency key **contains `cycle_id`**, so the two cycles occupy different keyspaces by construction.
- **EXPECTED BEHAVIOUR** — 409; the client must re-bootstrap and re-consent for the new cycle.
- **OFFLINE TEST** — "a session bound to a superseded cycle is refused"; "consent from another cycle is invalid"; "a lead bound to an older cycle is not mistaken for this cycle result".
- **LIVE PROOF REQUIRED?** — **YES** (canary items 10 and 15) — a real Concierge cycle reset has not been observed through this path.
- **FAIL-SAFE / FALLBACK** — Cycle equality is checked against authority on every request, not cached.
- **ROLLBACK / CONTAINMENT** — By design a genuinely new cycle **may** legitimately produce a second lead for the same person; Dedup Guard merges it on contact identity. That is intended behaviour, not a leak.
- **STATUS** — **OFFLINE-PROVEN.**

### T39 — Cycle reset while submit is in flight

- **THREAT** — The Concierge resets the cycle **between** the gateway's cycle read and the Lead Intake call, so a lead is created and bound to a cycle that no longer exists.
- **ATTACK / FAILURE MODE** — The genuine TOCTOU window: `authority.read` at step §9.2 → claim → Intake call → `persistCanonical`. A reset landing anywhere inside that window is not detected.
- **TRUST BOUNDARY** — TB-3.
- **CURRENT CONTROL** — **Incomplete, and this is an open window.** The cycle is read **once**, at the start. The claim predicate is `submit_state` **only** — it does not include `cycle_id` — so a mid-flight cycle change cannot cause the claim to fail. No re-read of the authority cycle occurs after the claim or before `persistCanonical`, which writes `lead_cycle_id: ctx.cycleId` from the value captured at the start.
- **EXPECTED BEHAVIOUR (specified, not implemented)** — A cycle change mid-flight should abort with `CYCLE_SUPERSEDED` before the Intake call, or at minimum be detected before the canonical binding is written.
- **OFFLINE TEST** — None. The offline gate holds the cycle constant for the duration of a request; no double models a reset mid-handler.
- **LIVE PROOF REQUIRED?** — **YES** (canary item 13, extended to cover a reset injected mid-flight).
- **FAIL-SAFE / FALLBACK** — Harm is bounded, which is why this is a gap and not a blocker: exactly **one** lead is created, correctly attributed to the right person, carrying a `lead_cycle_id` for a superseded cycle. The next Mini App open sees `lead_current = false` (`evaluateCycle` requires `lead_cycle_id === cycle_id`) and the user proceeds in the new cycle; Dedup Guard merges on contact identity downstream. Nothing is misattributed and no second customer record appears.
- **ROLLBACK / CONTAINMENT** — Pipeline retains the lead; rebinding is a manual CRM edit.
- **STATUS** — **DESIGN-ONLY.** Gap **G2**. Named fix, in preference order: include `cycle_id` in the claim predicate so a reset invalidates the claim; or re-read the authority cycle immediately before `persistCanonical` and refuse to bind a superseded cycle.

### T40 — Client closes Mini App during submit

- **THREAT** — The user closes the app mid-submit and the `(user, cycle)` is left permanently unable to submit.
- **ATTACK / FAILURE MODE** — App closed after the claim is won but before the Intake call returns — leaving `submit_state = submitting` with no canonical result recorded.
- **TRUST BOUNDARY** — TB-1 ↔ TB-2.
- **CURRENT CONTROL** — Server-side sequencing is independent of the client: whatever the browser does, the handler runs to completion and the resolver settles the state on the next open. `submitting` is *designed* to be the visible ambiguity marker.
- **EXPECTED BEHAVIOUR** — The next open resolves via session → authority → lookup and either returns the canonical success or permits exactly one fresh attempt.
- **OFFLINE TEST** — "the retry after ambiguity resolves state first and makes zero extra Intake calls"; "a lookup that genuinely knows nothing permits exactly one fresh attempt" — both of which supply a **working** `leadIntake.lookup` double.
- **LIVE PROOF REQUIRED?** — **YES** (canary item 12).
- **FAIL-SAFE / FALLBACK** — In the offline model, sound. **In the repository as it stands, not sound** — see below.
- **ROLLBACK / CONTAINMENT** — Session TTL expiry, or a Concierge cycle reset, both of which change the idempotency key and free the user.
- **STATUS** — **DESIGN-ONLY**, and the sharpest practical consequence of **G1**. `resolvePriorSubmission` falls through to `return { resolved: false, unresolved: true }` whenever `leadIntake.lookup` is not a function. With no lookup implementation in the repository, an interrupted submit leaves `submitting` behind, the claim is **never released**, and **every** subsequent attempt returns `SUBMIT_UNRESOLVED` — for that `(telegram user, cycle)`, permanently, until the TTL expires or the cycle rolls. The logic is correct; the capability it depends on does not exist yet.

---

## 3. Cross-cutting gaps

Collected so they are not lost among forty rows. None of these is fixed in this commit — this
document identifies them; closing them is separate, approved work.

| ID | Gap | Threats | Severity |
|---|---|---|---|
| **G1** | `leadIntake.lookup` has **no implementation and no backing store**. Nothing persists or indexes `idempotency_key`: it is passed beside the envelope but never written into the payload, and `meta.request_id` is a fresh UUID per attempt, so the Pipeline `request_id` column cannot serve as the index. Consequence: an interrupted submit strands that `(user, cycle)` at `SUBMIT_UNRESOLVED` until TTL or a cycle reset. | T13, T14, T32, T40 | **PRE-ACTIVATION BLOCKER** |
| **G2** | Cycle-reset TOCTOU: the claim predicate is `submit_state` only, and the cycle is read once at the start and never re-checked before the canonical binding. | T39 | HIGH — bounded harm (one lead on a superseded cycle), but genuinely open |
| **G3** | `ctx.mirror()` is called without a try/catch and `handleSubmit` has no top-level catch, so a throwing mirror client turns an already-committed submit into an unhandled node error instead of a clean `SUBMIT_UNRESOLVED`. | T15 | MEDIUM — recovery is sound, presentation is not |
| **G4** | `reconcile()` classifies but never repairs, contradicting its own module header and gateway contract §5.1. Documentation describes behaviour the code does not have. | T37 | MEDIUM — misleading, not unsafe |
| **G5** | No `initData` replay defence beyond the 900 s freshness window — no nonce cache, no `query_id` ledger, no binding of one `initData` to one issued session. | T4 | MEDIUM — bounded: same user only, and the idempotency key collapses the result to one lead |
| **G6** | `mode` crosses TB-1 to the browser (§9 explicitly cares about duplicate disclosure), and on an authority-resolved retry it falls back to `new` because the submit path never persists `lead_mode`. | T34 | LOW |
| **G7** | `meta.request_id` is regenerated per attempt, so downstream `request_id` cannot deduplicate Mini App retries; all retry safety rests on gateway-side resolution. | T10, T13 | LOW — by design, but must not be mistaken for downstream idempotency |

Two smaller test-coverage recommendations, neither a defect in the code: add a dedicated check
for `submitted`-with-no-lead-anywhere (T32), and an explicit assertion that the Mini App
envelope contains no `ga_*` key or `analytics_consent` (T25), so that property is defended by a
gate rather than by the current shape of a literal.

---

## 4. LIVE CANARY MATRIX — required before B.2.1-C activation

Gateway contract §14 already states it: *"Only B.2.1-C creates a real lead-side effect, and it
requires a separate live canary gate."* This is that gate's minimum content. **None of it has
been run.** No live execution took place tonight.

**Preconditions, all mandatory:**

- **G1 closed first.** L12 cannot be executed at all without a real `leadIntake.lookup`, and L7/L8 cannot be safely retried without it.
- Synthetic identity only, in the established `9000000xx` range, or the owner's own Telegram id, isolated — never a real prospect.
- A dedicated canary Lead Intake target, or an agreed cleanup of the canary leads from Pipeline.
- Tenant MCP exposure to stay at 0 of 35 (Phase 10 §10.2). Note the trap Phase 10 hit: `execute_workflow` requires `availableInMCP`, so canary runs must be started from the n8n UI, not via MCP.
- Execution retention reviewed **before** the first run carrying contact data (T24).
- Rollback rehearsed: §15 — disable the Mini App entry, fall back to the Client Concierge.

| # | Canary | Proves | Pass criterion |
|---|---|---|---|
| **L1** | Genuine Telegram `initData` validation | T1, T3 — the algorithm works against a **real** Telegram signature and FINMENTOR's real `bot_id`, closing the §3.5 gap | A real Mini App open validates; `method` and `bot_id` recorded |
| **L2** | Tampered `initData` rejection | T1 — one byte altered in a genuine string | `TG_INITDATA_INVALID`; zero downstream effect; no crypto detail in the response |
| **L3** | Wrong `bot_id` rejection | T3 — a signature valid for another bot | `TG_INITDATA_INVALID` |
| **L4** | Stale `initData` rejection | T2 — a genuine string older than 900 s, plus a future-skew case; records real runtime clock offset | `TG_INITDATA_EXPIRED` / `TG_INITDATA_FUTURE`; measured skew < 60 s |
| **L5** | Owner/synthetic isolated identity | T5, T6 — the canary identity is the only one touched | Zero rows for any other `chat_id` read or written |
| **L6** | Consent required | T29 — submit without consent, and with `consent: "no"` | Zero Lead Intake calls; zero authority writes; submit state unmoved |
| **L7** | One successful submit | T11, T34 — the first real lead; real `mode`, `priority`, `financial_zone`, canonical `lead_id` | Exactly **one** Intake call; exactly **one** new Pipeline row |
| **L8** | Retry of the same request | T16, T33 — replay the same `(user, cycle)` | Identical `lead_id`; `lead_intake_calls = 0`; `idempotent_replay: true`; **no** second Pipeline row |
| **L9** | Different-identity `request_id` steering attempt | T9, T10, T27 — a body carrying another identity's `request_id` and a `lead_id` | Both ignored and logged in `untrusted_fields_ignored`; `provenance_trusted = false`; no foreign row selected |
| **L10** | Authority-first commit | T29, T33 — ordering observed in the real tenant | `Bot_Sessions` consent stamp timestamp **precedes** the Intake call; lead binding precedes the mirror |
| **L11** | Mirror failure fallback | T15, T18 — force a Data Table failure after a good commit | Submit still succeeds; next open falls back to authority and is correct; fallback latency recorded against Phase 10's 6–7 s Sheets figure |
| **L12** | Ambiguous timeout recovery | T13, T14, T40 — a real downstream timeout, then a retry | First: `SUBMIT_UNRESOLVED`, state stays `submitting`. Retry: resolves via lookup; **exactly one** lead exists |
| **L13** | Concurrent submit ordering | T12, T39 — two genuinely overlapping submits for one session; extend with a cycle reset injected mid-flight | Exactly one reaches Intake; the other gets `SUBMIT_IN_PROGRESS`; **one** Pipeline row. Cycle-reset variant records observed behaviour against G2 |
| **L14** | No PII in client response | T23, T35 — capture the raw response bytes on success **and** on error | Only the six whitelisted fields; no `chat_id`, `init_data`, cycle field or n8n envelope; verified as raw bytes, not through a client that re-serialises |
| **L15** | Zero unrelated CRM mutations | T5, T36, T38 — full-tenant before/after comparison | Pipeline row count changes by exactly the number of canary leads; no `Bot_Sessions` row other than the canary identity is modified |

**Verification discipline, carried over from Phase 10 §9.2 because it caught a real trap:**
read execution evidence as **raw bytes**. `Invoke-RestMethod` coerces ISO-8601 strings into
`DateTime` and drops milliseconds, which silently corrupts any hash recomputation of
`consent_at`. Re-derive independently with the repository's own modules — the pattern
`scripts/verify-live-cas-execution.mjs` established — rather than trusting a workflow's own
verdict node.

---

## 5. Standing stop conditions

Unchanged from Phase 10 and the B.2.1-C closure. Still prohibited without separate, explicit
approval:

- deploying either `miniapp-submit` module into an n8n workflow;
- calling production Lead Intake from any Mini App route;
- creating, activating or exposing a submit endpoint;
- wiring the Mini App submit route through `Internal Auth Entry` (T27);
- activating reconciliation or any polling schedule;
- modifying the production Client Concierge writers;
- merging PR #10.

Producing this document touched no runtime surface: no n8n, Sheets, Telegram, GA4, DNS,
Cloudflare or production system was contacted, and no workflow was read for mutation,
modified, activated or deactivated.

**B.2.1-C is not cleared for activation.** G1 is a blocker, G2 is an open window, and fifteen
live canary items remain unexecuted.
