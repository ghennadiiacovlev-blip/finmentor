# FINMENTOR Phase B.2.1-C — Consent + Submit closure

Date: 2026-08-26
Branch: `hardening/post-remediation-night-2026-08-25`
Implements: `docs/PHASE_B2_1_GATEWAY_CONTRACT.md` §14 "B.2.1-C — Consent + Submit", against
§8 (consent), §9 (submit sequence), §10 (idempotency), §11 (urgency semantic guard),
§12 (HTTP/security controls) and the §13 QA matrix.

Status: **implementation CLOSED, offline-proven. Deployment NOT done. Live canary OPEN.
ACTIVATION BLOCKED on G1 — see §8.1.**

Amended 2026-08-26 (N6.1) to record the closure of gaps G1, G2 and G4 raised by
`docs/PHASE_B2_1C_THREAT_MODEL.md`. §8.1 carries their exact state.

B.2.1-C is the first slice in the whole Mini App programme that creates a real lead-side
effect. §14 requires a separate live canary gate for exactly that reason, and this document
does not claim one. What is closed here is the logic and its proof; what is open is stated
in §7 and §8.1 and must not be summarised away.

---

## 1. Scope, and the two things deliberately not built

Two modules, both under `n8n/src/miniapp-submit/`, both written as n8n Code-node sources
under the sandbox constraints B.2.1-A proved and §3.5 records (`require('crypto')` is
available; WebCrypto and `URLSearchParams` are not — neither is needed here):

| Module | Role |
|---|---|
| `submit-contract.js` | pure decision logic: schema validation, consent evaluation, the Lead Intake payload projection, the submit state machine, the response whitelist. No I/O whatsoever. |
| `submit-handler.js` | the §9 orchestration sequence over **injected** clients. No imports of live clients, so the same code path runs offline and in the tenant. |

Not built, on purpose:

- **No new Lead Intake.** The slice projects onto the payload shape the *existing* Lead
  Intake already parses at its Validate Payload node. The production writer is untouched.
- **No deployment.** No workflow was created, modified, activated or deactivated. The
  modules are repository sources awaiting the canary gate §7 describes.

The dependency-injection choice is the same one the read model made, and for the same
reason: it is what makes the slice provable with no tenant, no credential and no network,
while keeping the code under test identical to the code that would deploy.

---

## 2. The caller cannot steer identity

This is the security core of the slice, so it is stated as a rule rather than left implicit
in the code.

`UNTRUSTED_BODY_KEYS` — the keys the browser may not assert: `telegram_user_id`, `chat_id`,
`lead_id`, `canonical_lead_id`, `cycle_id`, `consent_cycle_id`, `consent_at`,
`consent_source`, `lead_cycle_id`, `priority`, `lead_priority`, `financial_zone`,
`risk_zone`, `score_zone`, `submit_state`, `idempotency_key`, `request_id`,
`provenance_trusted`, `internal_route`, `__internal_route`, `init_data`.

Presence is **recorded, never read**. A stale client that still sends one is not failed —
the value is dropped and the key names are logged as `untrusted_fields_ignored`. The rule
is scanned at the top level and inside both `answers` and `contact`, so nesting is not an
escape.

Three consequences the gate proves rather than asserts:

1. **The Lead Intake payload carries no `lead_id` key at all.** Not an empty one — absent.
   Downstream Dedup Guard uses `lead_id` to select a merge target, and the gateway is a
   caller; a caller-supplied lead id must never become canonical identity.
2. **No provenance marker is placed in the body.** Provenance is established by the route
   n8n authenticates, which is the rule commit `a224aa2` deployed to Lead Intake. A field
   in a body is not provenance.
3. **The idempotency key is built only from server-owned values** —
   `miniapp:<telegram_user_id>:<cycle_id>`, where `telegram_user_id` comes from the
   server-resolved app session and `cycle_id` from the authoritative `Bot_Sessions` row. A
   caller `request_id` cannot reach it, so it cannot steer which submission a request
   claims. `request_id` in the payload is set from the server correlation id and is a
   correlation reference, never an identity selector.

### Validation is fail-closed, whitelist-only

Unknown answer keys and unknown answer **values** are refused, not dropped. A value the
server does not understand must not reach the CRM as though it were understood — dropping
would let the browser widen the CRM vocabulary by omission. The eight answer keys and their
exact option values are taken from the shipped B.2.0 client's `data-value` attributes.

Free text is length-limited to the browser's own `maxlength="500"`, then sanitised: C0 and
C1 control characters become spaces so a value cannot forge a line boundary in an execution
log, a Telegram message or a spreadsheet cell, and a leading `=`, `+`, `-` or `@` is
neutralised with an apostrophe so a downstream spreadsheet treats it as text rather than
evaluating it as a formula. Data stays data; nothing here is ever evaluated.

### Nothing leaks back

`CLIENT_RESPONSE_FIELDS` is a six-field whitelist: `ok`, `lead_id`, `mode`, `priority`,
`financial_zone`, `submit_state`. `lead_id` is deliberately present — §9 returns the
canonical lead id. `RESPONSE_FORBIDDEN_KEYS` is checked **recursively**, so a nested object
cannot smuggle `init_data`, a signature, a bot token, `chat_id`, any cycle field, the
idempotency key or an n8n row internal.

Errors are narrower still: the browser sees `{ ok: false, error_code, retryable }` and
nothing else. Stage and detail exist only in the execution log, which is §12's
"redact/restrict error details" applied literally.

---

## 3. Consent — §8

Consent is a dedicated explicit decision, evaluated against the **authoritative** cycle,
never the browser's claim and never the app session's binding alone.

Only the literal strings `"yes"` and `"no"` decide. A truthy object, the number `1` and the
string `"true"` are **not** consent — they are `CONSENT_REQUIRED`. Anything looser would let
a serialisation accident manufacture a legal basis for a CRM write.

| Case | Outcome |
|---|---|
| `no` | accepted, zero Lead Intake calls, zero writes, submit state unmoved |
| `yes`, session cycle == authoritative cycle | eligible; server-built stamp |
| `yes`, session cycle != authoritative cycle | `CONSENT_STALE_CYCLE` (409) |
| `yes`, authority carries no cycle | `CYCLE_SUPERSEDED` (409) |

`no` is an **accepted outcome, not an error**, and it deliberately does not move the submit
state — the client may still consent later in the same cycle.

The stamp is built entirely server-side: `consent: 'yes'`, `consent_cycle_id` from the
authoritative row, `consent_at` from the server clock, `consent_source: 'telegram_miniapp'`.
Nothing in it comes from the request body, which is what makes "consent from another cycle
is invalid" enforceable rather than merely stated.

The consent stamp commits to `Bot_Sessions` **before** Lead Intake is called, and a failed
consent write stops the submit. A lead created without a committed legal basis is the
failure mode this ordering exists to prevent.

---

## 4. Urgency semantic guard — §11

`urgency = none` means no urgency. §11 requires that it is never normalised to an urgent
keyword and never independently escalates priority. This is not hypothetical: it is a case
B.2.0 QA already recorded.

The four Mini App values map to fixed Russian strings, and `none` maps to
`Нет срочности` — semantically negative by construction.

The guard is proven, not assumed. `LEAD_INTAKE_URGENT_PATTERNS` and
`LEAD_INTAKE_NEGATION` are copied verbatim from
`n8n/src/lead-intake/normalize-score-lead.js`, and the gate asserts the copies still match
the Intake source. That inverts the usual drift risk: if the downstream scorer's rules
change, **this gate fails** rather than `urgency = none` silently re-escalating months
later.

`wouldEscalateInLeadIntake` mirrors Intake's `hits()` including its negation-cancels-positive
rule, so the slice can prove offline what the downstream scorer will do with the exact
string it is handed. Of the four Mini App urgency values, `now` is the only one that
escalates.

---

## 5. Idempotency and the submit state machine — §10

The guarantee: **exactly one Lead Intake call per (telegram user, cycle).**

States are monotonic toward `submitted`:

```
draft ──────────────> submitting ──┬──> submitted   (terminal, no outgoing transition)
                                   └──> retryable_error
retryable_error ────> submitting
```

`submitted` is terminal. The single path that moves a state backwards —
`submitting → retryable_error` — is reachable only when the resolver has **proven** no
canonical result exists, and it can never touch `submitted`.

### Claim before call

The claim is a conditional update on the current `submit_state`
(`draft|retryable_error → submitting`), performed **before** the Intake call, never after.
Two concurrent submits for one session cannot both win the transition, so only one ever
reaches Lead Intake; the loser gets `SUBMIT_IN_PROGRESS` (409, retryable).

Claiming before the call means a mid-flight crash leaves `submitting` behind. That is
intentional — it is precisely the ambiguity the resolver is built to settle, and it is
strictly safer than a state that looks clean while a lead may exist downstream.

### Resolution runs before consent, on purpose

`resolvePriorSubmission` is called **ahead of** the consent gate. A client retrying after a
success it never saw may send anything at all in the consent field, and the
already-committed canonical result is the correct answer regardless. Re-running the consent
gate first would let a retry turn a completed submission into an error.

Resolution order, most trustworthy first:

1. **Session record** — `submit_state = submitted` with a non-empty `lead_id`.
2. **Authority** — `Bot_Sessions` may know the lead when the session record does not (a
   crash between the authoritative commit and the session update). Authority wins, and only
   when `lead_cycle_id` matches **this** cycle: a lead bound to an older cycle is not this
   cycle's result.
3. **Downstream lookup by idempotency key** — the only safe way to learn what an interrupted
   attempt did. Never "submit again and see."

The lookup has three outcomes, and each is distinct:

| Lookup outcome | Action |
|---|---|
| known, with a canonical result | return the prior success, zero extra Intake calls |
| answered, key genuinely unknown | nothing was created — release the stale claim to `retryable_error`, then one fresh attempt |
| could not answer | `SUBMIT_UNRESOLVED` (503, retryable) — ambiguity is preserved, not gambled on |

Releasing the stale claim is load-bearing: without it a `submitting` record would block its
own retry forever. A `submitted` record with no canonical lead anywhere is treated
differently — the state machine forbids leaving `submitted`, so it stays unresolved for an
operator rather than being quietly downgraded into a fresh submission.

### Ambiguity is never retried inside one request

`leadIntake.submit` returning `ambiguous: true` — a timeout, a dropped connection, a 5xx
after the request was accepted — leaves the state at `submitting` and returns
`SUBMIT_UNRESOLVED`. The next attempt resolves through lookup. Retrying inside the same
request is the one action guaranteed to create the duplicate lead §10 exists to prevent.

### What counts as success

§9.8, enforced literally: a canonical success requires `body.ok === true` **and** a
non-empty `lead_id`. An `ok: true` response with no lead id is a failure, not a success with
a blank field. Failure drops the state to `retryable_error` and returns
`TEMPORARY_BACKEND_ERROR`.

---

## 6. Authority-first ordering — §9.9

The commit order is the contract:

```
consent stamp → Bot_Sessions           (before any Intake call)
Lead Intake call                       (exactly once)
canonical lead binding → Bot_Sessions  (authority first)
app session record update
derived read-model mirror              (last)
```

The mirror runs **only after** an authoritative commit. A mirror that ran first would
publish a projection of state that does not yet exist — which is defect class INDP2-09,
closed in the read model in Phase 10 and not reintroduced here.

If the canonical persist fails after Lead Intake succeeded, the client is **not** told
success. The lead exists downstream but the binding did not commit; reporting success would
strand a lead the gateway can no longer recognise on retry. The state stays `submitting` for
the resolver to settle, and the client gets `SUBMIT_UNRESOLVED`.

Every branch returns a zero-effect counter block — `lead_intake_calls`,
`lead_intake_lookups`, `authority_writes`, `session_writes`, `mirror_runs`. The gate asserts
against it, so a branch that quietly gains a side effect fails rather than passing
unnoticed.

---

## 7. Executable proof — and what it does NOT prove

`qa/miniapp-submit.test.mjs`, registered as the **eighth** gate in `qa/run-all.mjs`.
**84 checks, 84 PASS, 0 failed** (59 at the original closure, plus 25 added by N6.1 for G1/G2).
Offline: no tenant, no credential, no webhook, no network.
Paths resolve from the test file, not from cwd.

| Group | Contract | Covers | Checks |
|---|---|---|---|
| A | §12 | transport and schema guards: content type, body size, rate limit, client version, session shape, unknown answer key/value, missing answer, unknown contact key, free-text limit, sanitisation, literal consent | 12 |
| B | §12 | the caller cannot steer identity: browser `lead_id` ignored, no `lead_id` key in the payload, `request_id` cannot become the payload id or steer the key, server-owned key derivation, cycle/consent/scoring fields ignored | 6 |
| C | §12 | no leakage: success response, error response, accept log | 3 |
| D | §13 | session and cycle: unknown session, expired session, chat mismatch, unreadable authority, superseded cycle, missing cycle | 6 |
| E | §8 | consent: NO is zero-effect, NO leaves state, YES current cycle stamped server-side, stale cycle invalid, authority-before-Intake ordering, failed consent write stops the submit | 6 |
| F | §11 | urgency: `none` stays negative, `now` is the only escalating value, the string comes from the whitelist, **the copied Intake rules still match the deployed scorer** | 4 |
| G | §9 | payload projection: envelope shape Intake parses, whitelisted answers mapped to CRM vocabulary, sanitised free text | 3 |
| H | §10 | idempotency and state: monotonicity, new lead, merge, retry after known success, resolve-from-authority, older-cycle lead rejected, ambiguity not retried, retry-after-ambiguity, lookup-unknown permits one attempt, lookup-cannot-answer preserves ambiguity, concurrent claim, lost claim | 12 |
| I | §9 | error recovery: no `ok:true`, `ok:true` without lead id, failed persist, retryable_error retry | 4 |
| J | §9.9 | authority-first ordering: commit precedes mirror, full happy-path effect order, per-branch counters | 3 |
| K | G1 | recovery adapter state machine: cases (a)-(i), structural blocker, consent-NO exemption, declared contract | 14 |
| L | G2 | cycle-reset guard: unchanged cycle, reset, re-bind, claim takeover, illegal state, consent withdrawn, no-write-on-refusal, reversed order, new-cycle recovery, guard coverage | 11 |
| | | **Total** | **84** |

The doubles implement the same conditional-update and canonical-response semantics as the
live components, and the clients are injected rather than imported — so the code under test
is the code that would deploy.

### LIVE PROOF REQUIRED — the honest boundary

§14 says only B.2.1-C creates a real lead-side effect and it requires a separate live canary
gate. That gate has **not** been run. The following are OPEN and no offline check can close
them:

| Property | Status |
|---|---|
| Real Telegram `initData` validation on the submit route | **LIVE PROOF REQUIRED** |
| A real Lead Intake response — actual `mode`, `priority`, `financial_zone`, canonical `lead_id` | **LIVE PROOF REQUIRED** |
| Real conditional-update semantics under genuine execution overlap on the claim | **LIVE PROOF REQUIRED** |
| A real downstream timeout producing `ambiguous`, and the lookup that settles it | **LIVE PROOF REQUIRED** |
| Deployment of either module into an n8n workflow | **NOT DONE** |
| Rate limiting at the edge (the handler consumes a `rateLimited` decision; it does not implement one) | **NOT IMPLEMENTED** |
| CORS, HTTPS-only, `Cache-Control: no-store` — §12 transport controls owned by the edge | **NOT IMPLEMENTED HERE** |

This gate proves the logic. It does not claim the deployment. The distinction is the same
one Phase 10 §9 was written to make, and it is repeated here because the failure to make it
is what produced the original INDP2-09 finding.

---

## 8. CI registration

The canonical workflow now runs **eight** gates:

| Change | Value |
|---|---|
| `qa/run-all.mjs` | gate 8, "Mini App consent and submit" |
| `ASSERTION_BASELINE` | 346 → 405 (+59) → **431** after N6.1 (+26) |
| cwd-independence check | requires `8/8 gates passed` |
| syntax check | now covers **14** `n8n/src` modules (was 12) |
| `docs/FINMENTOR_CI_QUALITY_GATE.md` | gate table and prose updated to eight |

The baseline is a floor, not a target: it fails when the total **falls**, because a falling
count means coverage was removed. `run-all.mjs` also fails when a single gate's tally drops,
so the eight gates cannot silently trade assertions between them.

---

## 8.1 PRE-ACTIVATION BLOCKERS AFTER N6.1

Three gaps from the threat model were addressed on 2026-08-26. Their state is recorded here
in full, because the distinction between "the logic is closed" and "the system is safe to
activate" is the whole point of this document.

### G1 — durable idempotency recovery

| Field | State |
|---|---|
| **IMPLEMENTATION** | Closed at the state-machine level, not at the durability level. The adapter is now a **declared contract** (`RECOVERY_ADAPTER_CONTRACT` in `submit-contract.js`) rather than an implicit injected function. Its absence is a distinct condition, `PRE_ACTIVATION_BLOCKED` (503, retryable), never confused with a transient downstream failure. Two behaviours changed: (1) a fresh submit is **refused outright** when no adapter is deployed — no consent stamp, no claim, no Lead Intake call — so an unrecoverable submission can no longer be *started*; (2) a `known: true` lookup whose body yields no canonical lead id is now treated as ambiguity and **never releases the claim**, where it previously fell through to a fresh attempt. |
| **OFFLINE PROOF** | 25 new checks in `qa/miniapp-submit.test.mjs`, covering all nine required cases (a–i) plus the structural blocker, the consent-NO exemption and the contract declaration. Mutation-verified: removing the blocker fails exactly 4 checks. |
| **LIVE PROOF REQUIRED** | **YES — and more than proof: an implementation.** No durable store keyed by the stable idempotency key exists anywhere in the repository or the tenant. A precondition nobody had noticed is now recorded in the contract: **the stable key does not currently reach any downstream record at all** — the outbound envelope carries no idempotency key, so no row can be indexed by it. Building the adapter requires solving that first. |
| **ACTIVATION BLOCKING?** | **YES. This is the blocker.** |
| **OWNER ACTION REQUIRED?** | **YES.** Decide where the durable record lives and how the stable key reaches it. That decision touches the frozen Lead Intake contract (§2) and is therefore an approval, not an implementation detail. |

**Status: PRE-ACTIVATION-BLOCKED-LIVE-ADAPTER.** The handler's behaviour around the missing
capability is deterministic, fail-safe and proven. The capability itself does not exist, and
no offline test can make it exist.

### G2 — cycle reset racing an in-flight submit

| Field | State |
|---|---|
| **IMPLEMENTATION** | **Closed in the repository.** `assertHandoffGuard` re-reads authority and the app session immediately before the irreversible Lead Intake call and proves eight conditions: authority readable, same chat identity, same `cycle_id`, consent still `yes` for **this** cycle, session readable, session not re-bound to a newer cycle, `submit_state` still `submitting`, and the claim still owned by **this operation**. Ownership needed a new token: the idempotency key cannot serve, because two concurrent submits for one `(user, cycle)` share it by construction — so the claim now carries `claim_owner`, the server correlation id. On failure the guard writes **nothing at all**: no Intake call, no lead binding, no session mutation, and specifically no release of a claim that may now belong to someone else. |
| **OFFLINE PROOF** | 11 new checks covering all seven required scenarios plus illegal-state and consent-withdrawn-at-handoff. Mutation-verified: replacing the guard with an unconditional pass fails exactly those 11 checks and nothing else. |
| **LIVE PROOF REQUIRED** | **YES.** The guard narrows the window to (guard read → Intake call); it does not eliminate it. Without a distributed transaction across `Bot_Sessions`, the session store and Lead Intake, no gateway-side check can. Real conditional-update semantics under genuine overlap remain canary item L13. |
| **ACTIVATION BLOCKING?** | No — but it does not clear activation on its own either, since G1 still blocks. |
| **OWNER ACTION REQUIRED?** | No. |

**Status: repository logic CLOSED, LIVE PROOF REQUIRED.**

### G4 — reconciliation semantics

| Field | State |
|---|---|
| **IMPLEMENTATION** | **Closed by correcting the documentation to match the code, not by adding writes.** `reconcile` is renamed `planReconciliation`; the misleading `repaired: false` flag is gone; each finding now carries `repair_action` naming the operation a repair *would* perform (`REPUBLISH`, `REMOVE_THEN_REPUBLISH`, `NONE`, …); the return value states `repair_performed: false` and `writes: { authority_writes: 0, data_table_writes: 0 }` explicitly. Option B — implementing real repair — was rejected deliberately: an unattended repairer writing to the derived table is exactly what Phase 10's stop conditions prohibit, and it would re-open the reconciliation/submit race (T37). `runBackfill` remains the only repair path, and it is manual and authority-first. |
| **OFFLINE PROOF** | The existing check was strengthened (it asserted only that authority was untouched; it now asserts the Data Table is untouched too — which is how the false "repairs by republishing" comment survived) and one check added for the named actions. |
| **LIVE PROOF REQUIRED** | **NO** while the function stays read-only. **YES** the moment any repair mode is added, at which point T37 re-opens. |
| **ACTIVATION BLOCKING?** | No. |
| **OWNER ACTION REQUIRED?** | No. |

**Status: OFFLINE-CLOSED.**

---

## 9. Stop conditions — unchanged and extended

Nothing in B.2.1-C relaxes any prior boundary. Still prohibited without separate explicit
approval:

- deploying either module into an n8n workflow;
- calling the production Lead Intake from any Mini App route;
- creating, activating or exposing a submit endpoint;
- modifying the production Client Concierge writers;
- merging PR #10.

No production workflow was read for mutation, modified, activated or deactivated. No lead,
Pipeline row or `Bot_Sessions` row was read, written or mutated. No n8n, Google Sheets, GA4,
Telegram, DNS or production surface was accessed during this phase. Every fixture in the
gate is synthetic.

The next step is **not** more implementation. It is the live canary gate §7 requires, scoped
and approved on its own terms — because the first real lead this slice creates is the first
thing in the programme that cannot be rolled back by deleting a file.
