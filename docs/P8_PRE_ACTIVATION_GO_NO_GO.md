# FINMENTOR — B.2.1-C pre-activation GO / NO-GO

**Audience:** the owner. This is a decision pack, not a history.
**Scope:** everything standing between today and switching the Mini App on for customers.

---

## EXECUTIVE VERDICT

**The Telegram funnel is in good shape. The Mini App is not — because it does not exist in
production yet.**

Model-B issuance went live on 2026-08-27 and is working: the Concierge mints a `submission_key`
on every new cycle, creates a `READY` receipt, and binds cycle and key together on the authority
row. That was the hard part, and it is done.

What blocks customer activation is not a defect in what shipped. It is that **three things have
never been built or run**:

1. **The Mini App submit gateway is not deployed.** The logic exists and is heavily tested
   offline; no live workflow implements it. There is currently no way for a browser to submit.
2. **G5 (replay protection) cannot be built on the infrastructure we have.** It needs an atomic
   "create if absent" that neither the n8n Data Table nor Google Sheets provides. This needs an
   owner decision on a store, and it is the only item here that costs money.
3. **F17** — nine dead columns on `Bot_Sessions` — must be removed, and the only safe route is a
   few clicks in the Google Sheets UI.

None of these is urgent in the sense of risk-to-production. All three are prerequisites.

> ### GENERAL MINI APP ACTIVATION: **NO-GO**

---

## PRODUCTION COMPONENTS

| Component | State | Notes |
|---|---|---|
| Website | **LIVE** | unchanged this phase; contract gate green |
| Telegram Concierge | **LIVE** | `mppzthlkSJFr6Kle`, 45 nodes, active, trigger identity unchanged |
| **Model-B issuance** | **LIVE** | mint → `READY` receipt → readback → authority write → pre-handoff reread |
| Lead Intake — public route | **LIVE, UNCHANGED** | not touched since before P7 |
| Lead Intake — internal route | **LIVE** | authenticated, structurally gated (F10/F11 closed live) |
| **Mini App gateway** | **NOT DEPLOYED** | logic exists in `n8n/src/miniapp-submit/`; no live workflow implements it |
| **Replay protection (G5)** | **NOT BUILT** | needs a store primitive we do not have — see below |
| CRM / Pipeline | **LIVE, UNCHANGED** | |
| Monitoring | **PARTIAL** | Error Monitor live; the signals in §"Observability" are not all wired |

---

## 1. Pre-activation register — rebuilt from current state

Nothing below is carried over because an old document said so.

| Item | Status | Current meaning | Evidence | Blocks activation? |
|---|---|---|---|---|
| **P1-L2** | **RETIRED** | atomic insert-if-absent — designed out of the receipt path entirely | P3 §; replaced by L2′ | no |
| **P1-L2′** | **PASS** | conditional update is atomic and reports `updated_rows` faithfully under real concurrency | P4 live | no |
| **P1-L3** | **PASS** | durable receipt read-back across executions | P4/P5 live | no |
| **P1-L4** | **PARTIAL** | durability across a **tenant restart** | see §2 | **accepted residual** |
| **P1-L5** | **SUPERSEDED** | Model B *forbids* the key in the payload; it travels out of band on the authenticated internal call | P6.4, execs 3610–3642 | no |
| **P1-L6** | **PASS** | intent write ordered before `Save to Pipeline` | P6.3 live wiring | no |
| **P1-L7** | **PASS** | commit write ordered before the respond node | P6.3 live wiring | no |
| **P1-L8** | **OPEN** | receipt retention duration | recommendation in §4 — **owner decision** | **yes, soft** |
| **P1-L9** | **PARTIAL** | Lead Intake seeds `receipt.correlation_id` from the same `meta.request_id` written to Pipeline | NEW proven live; **MERGE never exercised** — §5 | **accepted residual** |
| **P1-L10** | **PASS** | dedicated internal route live and fidelity-valid | P6.2/P6.3 | no |
| **P1-L11** | **PASS** | production Concierge issues `submission_key` correctly | P7.5R — 102 refs live, 0 before | no |
| **F10** | **LIVE CLOSED** | internal-route data contract | P6.3 | no |
| **F11** | **LIVE CLOSED** | closed by fault injection | P6.3 | no |
| **F13** | **LIVE CLOSED** | post-claim failure is `SUBMIT_UNRESOLVED`, receipt stays `IN_FLIGHT` | P6.4 | no |
| **F16** | **GUARDED** | `autoMapInputData` appends a column for any unknown key | runtime projection + writer contract + footprint guard, all gated | no |
| **F17** | **OPEN** | nine dead trailing columns `AZ:BH` | §6 runbook | **YES** |
| **G1** | **PASS** | durable idempotency receipt substrate, live end to end | P6.4 | no |
| **G5** | **OPEN — OWNER DECISION REQUIRED** | durable `initData` replay / single-use | §3 | **YES** |

---

## 2. P1-L4 — tenant restart

**Status: PARTIAL — PLATFORM RESTART NOT USER-CONTROLLABLE.**

n8n Cloud exposes no restart primitive to us. There is no API call, and asking the owner to
trigger a platform restart to satisfy a checklist would be theatre with a real outage window.

**A workflow redeploy is not a restart and is not offered as one.** P7.5R redeployed the
Concierge twice, which proves the *definition* survives — it says nothing about process memory,
because the receipt store is external to the process either way.

What is actually proven, and is the strongest available substitute:

* receipts written by one execution are read correctly by a **later, separate** execution
  (P5, P6.4 — different executions, minutes apart);
* receipts survived a **full workflow definition replacement** twice on 2026-08-27
  (33→45 nodes, then 45→33, then 33→45) with the store untouched;
* the store is a **managed n8n Data Table**, not process memory — there is no in-process cache
  between the receipt and its reader.

**Ruling: accepted platform durability residual, not a safety blocker.** The failure this
prerequisite guards against — a receipt vanishing across a restart — would require the managed
store itself to lose committed rows. If that happens we have a vendor incident, not a design
defect, and no amount of pre-activation testing on our side would prevent it.

---

## 3. G5 — durable `initData` replay protection

### 3.1 What the live path actually does today

Measured from the code, not assumed:

| Question | Answer |
|---|---|
| Where is `initData` first accepted? | **Nowhere in production.** No deployed workflow reads it |
| Is there an implementation? | Yes — `gateway/telegram-initdata.mjs`, a pure module |
| Signature verification | HMAC-SHA256 (`<bot_id>:WebAppData`) **and** Ed25519 third-party |
| Ordering | signature verified **first**, freshness **after** — correct, and tested |
| `auth_date` freshness | `validateFreshness()`, independent gate |
| `query_id` | parsed and returned by both validators |
| User identity | `parseValidatedUser()` — from the **signed** payload, never from the body |
| App-session creation order | **not implemented** — no gateway exists to create one |
| **Can one `initData` create two sessions?** | **Yes, in principle — nothing prevents it.** There is no replay ledger anywhere |

**A finding worth recording:** `gateway/telegram-initdata.test.mjs` — 14 tests over the
security-critical validator — **was not in the QA runner and had never run in CI.** P8 wired it
in. It passes.

### 3.2 Store capability: the honest answer

**No existing primitive can implement G5 safely.**

| Store we have | Atomic create-if-absent for an unseen key? |
|---|---|
| n8n Data Table | **No.** P2 proved insert-if-absent absent; P1-L2 was *retired by designing around it* |
| Google Sheets | **No.** `appendOrUpdate` is last-write-wins |

The receipt path escaped this by never needing it — two issuers mint different random keys, so
there is nothing to arbitrate. **Replay protection cannot use that trick.** The whole point is
that the second arrival must find the first one already there, which is precisely
insert-if-absent.

Emulating it with read-then-write is exactly the "read empty → write" race §2 forbids, and it
fails in the one case that matters: two tabs replaying the same `initData` simultaneously.

> **Per §3: architecture implementation is STOPPED. G5 needs a store we do not have.**

### 3.3 Owner decision pack — the store

| | A. existing infrastructure | B. Postgres / Supabase table | C. Redis-style `SET NX` |
|---|---|---|---|
| Real atomic uniqueness | **no** | **yes** — `UNIQUE` constraint | yes |
| Durable across restart | n/a | **yes**, by default | only with persistence configured |
| Backup / recovery | n/a | **managed, point-in-time** | usually snapshot-only |
| Operational burden | n/a | low — one table | a new always-on service |
| Observability | n/a | plain SQL | needs its own tooling |
| Access control | n/a | per-role | coarse |
| Cost at our volume | n/a | **free tier is ample** | free tier exists |
| Vendor lock-in | n/a | **very low — it is a table** | low |
| Failure semantics | n/a | **a SQL error; trivial to fail closed** | client-library dependent |

**Recommendation: B — a single Postgres table with a `UNIQUE` constraint on `replay_key`.**

Reasons, in order: it is the only option whose durability is correct *by default* rather than by
configuration; the failure mode is a plain constraint violation, which is the simplest possible
thing to fail closed on; and lock-in is near zero because the asset is one ordinary SQL table
that any Postgres can host. Redis `SET NX` is atomic but its default durability is a poor fit for
a **security** control that must survive a process restart — and §2 requires exactly that.

**Nothing has been provisioned.** Per §3, this is an owner decision and no production
infrastructure was created.

### 3.4 The contract, ready to implement once a store exists

```
1. verify signature        (HMAC or Ed25519)      -- fail -> reject, NOTHING is written
2. verify freshness        (auth_date window)     -- fail -> reject, NOTHING is written
3. atomic replay claim     INSERT replay_key      -- conflict -> REPLAY_REFUSED
4. create app session      only after 1-3 pass
```

```sql
CREATE TABLE initdata_replay (
  replay_key   char(64)    PRIMARY KEY,   -- SHA-256 hex, server-derived
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  correlation_id text                     -- optional, for tracing only
);
```

| Requirement | How it is met |
|---|---|
| server-derived identity | `replay_key = SHA256(canonical data-check-string of the **validated** initData)` — the same canonical string the signature was verified over |
| browser cannot choose the key | it is derived from signed bytes; changing any of them invalidates the signature at step 1 |
| durable across redeploy / restart | it is a database row |
| atomic single-use | `PRIMARY KEY` — the second insert fails |
| no read-then-write race | there is no read; the insert *is* the test |
| no unbounded raw storage | only a 64-char digest, plus two timestamps |
| raw `initData` never persisted | correct — the digest is sufficient |
| fail closed on store uncertainty | any error, including timeout, returns `REPLAY_REFUSED`; **never** degrade to freshness-only |
| a failed signature never consumes an entry | step 3 is after steps 1–2, by construction |

Expired rows are deleted by age (`expires_at`), which is safe: an expired key would be rejected
by the freshness gate at step 2 anyway.

---

## 4. P1-L8 — retention recommendation

**Recommendation: 30 days after `settled_at`, with one exception.**

| State | Policy | Why |
|---|---|---|
| `READY` orphan | delete only when **older than 7 days** AND no `Bot_Sessions` row references the `submission_key` | a `READY` receipt with no authority reference is a cycle nobody completed |
| **`IN_FLIGHT`** | **NEVER auto-delete while unresolved** | this is the F13 state — an unknown Lead Intake outcome. Deleting it destroys the only recovery evidence |
| `COMMITTED` | delete 30 days after `settled_at` | recovery and dispute window |
| `ABORTED` | delete 30 days after `settled_at` | same |

**30 days is the recommendation, and here is the reasoning rather than a shrug:** the receipt's
job is to answer "did this submission already happen?" during a retry, and retries happen within
minutes. Thirty days is far beyond operational need — it is chosen to cover a *human* dispute
("I submitted last month and heard nothing"), which is the only realistic reason to look at an
old receipt. Shorter than ~14 days starts to bite on that; longer than ~90 accumulates data with
no user.

**The deletion job must be, and none of it is built yet:** idempotent; auditable **by counts
only**, never by payload; guarded so it can never delete a key referenced by a current authority
row; dry-run capable; and **fail closed** — if the authority lookup is uncertain, delete nothing.

**Not deployed. Awaiting owner approval of the duration**, per §6.

---

## 5. P1-L9 — the MERGE path

**Still genuinely untested.** NEW correlation is proven live; MERGE is not, and no live evidence
exists either way.

A safe synthetic merge test **can** be designed — reserved `900000xxx` identity, a known
synthetic merge target, the same receipt architecture, full cleanup. But it requires a
**pre-existing synthetic CRM row to merge into**, and creating one means writing a row to the
live Pipeline that is deliberately shaped to be matched by the merge logic.

That is a heavier live mutation than anything P7.3/P7.4 did, on the CRM rather than on a session
sheet, and it needs API credentials that no longer exist.

**Ruling: leave P1-L9 PARTIAL, with the limitation stated precisely** — *the merge branch of Lead
Intake correlation has never been exercised end to end; NEW is proven.* Faking it would be worse
than the gap. It is an **accepted residual** for activation because the Mini App submit path
reaches Lead Intake through the same internal route that NEW already proved.

---

## 6. F17 — nine dead columns: OWNER ACTION

Live tail, measured 2026-08-27 by reading the header row **as data**:

```
AV submission_key   AZ key                        BF __do_write
AW lead_mode        BA __rows_seen                BG __mode
AX lead_priority    BB __advance                  BH __before
AY financial_zone   BC __reason
                    BD __verified_submission_key
                    BE p71_absent_column
```

All nine trailing, all empty on all 27 rows, `A:AY` intact. Three of them (`BF`–`BH`) were
created by our own P7.4 instrumentation; that class is now closed by the writer contract and the
footprint guard, so **no further columns can appear.**

**Route: the Google Sheets UI, by the owner.** The scripted sweep needs the production Sheets
credential inside an HTTP Request node, which that credential forbids — a control P7.1 called
sound and which must not be weakened for hygiene. The Sheets *node* cannot express a column range
at all.

### Owner runbook — 5 steps

1. **Snapshot.** In Google Sheets: *File → Make a copy* of the whole `FINMENTOR_LEADS_CRM…`
   spreadsheet. This is the rollback.
2. **Verify the tail.** On `Bot_Sessions`, confirm row 1 reads `AV submission_key`,
   `AW lead_mode`, `AX lead_priority`, `AY financial_zone`, then `AZ key` … `BH __before`, and
   that **BH is the last non-empty header**.
3. **Select `AZ:BH`.** Click the `AZ` column header, shift-click `BH` — exactly nine columns.
4. **Right-click → Delete columns AZ–BH.**
5. **Confirm.** The header now ends at `AY financial_zone`; row count unchanged; column `A`
   still `session_id`.

**Afterwards, tell the session** so the schema-footprint baseline is re-recorded as an
*authorised* removal (the guard supports this; it is not a workaround).

**Risk if skipped:** low today — nothing reads or writes those columns, and the runtime contract
is by header name, not index. But **F17 must close before general Mini App activation**, per the
standing decision.

---

## 7. Production smoke — NOT RUN

P7.5R deliberately ran none, and P8 cannot: **both temporary n8n API keys have been removed**, and
no reserved owner-controlled Telegram identity has been approved for testing.

**Owner action:** send `/start` to the FINMENTOR Client Concierge bot from an owner-controlled
Telegram account, then report what happened. Expected:

* a normal reply appears (this is the one thing the P7.5 defect would have broken);
* a new `Bot_Sessions` row for that chat carrying **both** a `cycle_id` and a
  `submission_key` matching `sub_` + 32 hex;
* a matching `READY` row in `Submission_Receipts`;
* no Lead Intake submission, no new Pipeline row;
* no new column on `Bot_Sessions`.

If the reply does **not** arrive, that is the P7.5 failure mode recurring and the rollback in
§"Rollback plan" applies immediately.

---

## 8. Observability — what we can detect, and what we cannot

| Signal | Detectable today | Threshold | Severity | First action |
|---|---|---|---|---|
| Concierge execution error | **yes** — Error Monitor `RBiFLhVjizMkAzrK` | any | **P1** | open the failed execution; if issuance-related, roll back |
| Receipt stuck `IN_FLIGHT` | **no — GAP** | any row > 15 min | **P1** | manual reconcile against Lead Intake |
| Preallocation failure | **partial** — `Build Issuance Failure Event` writes `Bot_Events` | any | **P2** | inspect `detail`; the turn refuses safely by design |
| Authority drift refusal | **partial** — `Build Stale Authority Event` → `Bot_Events`, `lead_handoff_suppressed:true` | > 1/day | **P2** | expected under concurrency; a spike means something else |
| Lead Intake unresolved | **partial** — `SUBMIT_UNRESOLVED` (F13) | any | **P1** | recovery lookup before any resubmit |
| Replay refusal | **n/a** — G5 not built | — | — | — |
| Replay store outage | **n/a** — G5 not built | — | — | — |
| Mini App gateway 5xx | **n/a** — not deployed | — | — | — |
| `Bot_Sessions` schema drift | **yes** — footprint guard, but **run manually** | any new column | **P2** | identify the writer; it is a defect, not noise |

**The two gaps that matter before activation:** a stuck-`IN_FLIGHT` alarm, and running the schema
footprint check on a schedule rather than by hand. Both are small; neither is built.

**Minimum viable:** one scheduled workflow, daily, that counts `IN_FLIGHT` receipts older than 15
minutes and compares the `Bot_Sessions` header fingerprint to a stored value. Two numbers, one
alert. No monitoring platform required.

---

## 9. Threat model — re-evaluated against what is live now

| Claim | Verdict | Basis |
|---|---|---|
| No caller-controlled identity | **HOLDS** | the key is minted server-side and read from `Bot_Sessions`; the validator drops body-supplied `lead_id`/`cycle_id`/`request_id` |
| `submission_key` never crosses TB-1 | **HOLDS** | not in `CLIENT_RESPONSE_FIELDS`; the two event builders record presence as a boolean — verified live in the P7.4 stale-authority event |
| `mode` never crosses TB-1 | **HOLDS** | `responseLeaks` refuses it rather than omitting it |
| No raw `initData` stored | **HOLDS TRIVIALLY** | nothing accepts `initData` in production |
| No secrets or redaction markers in live workflows | **HOLDS** | 0 markers in the live Concierge, verified post-cutover |
| `availableInMCP` false | **HOLDS** | verified on the live workflow |
| No temporary API credentials left | **HOLDS locally** | absent from User env and `HKCU\Environment`; **tenant-side revocation is still owner action** |
| No test workflows active | **HOLDS** | every P7.3/P7.4/P7.5 disposable archived; none was ever activated |
| No unbounded synthetic residue | **PARTIAL** | zero synthetic rows; **nine dead columns remain** (F17) |
| Tracked artifacts non-production-deployable | **HOLDS** | 20 classified, 0 deployable; the materializer refuses them |
| Rollback material ephemeral | **HOLDS** | hashed, deleted, deletion verified; 0 sensitive files in the repo |
| Lead Intake public route unchanged | **HOLDS** | untouched since before P7 |
| Internal route authenticated structurally | **HOLDS** | F10/F11 closed live |

**New risk introduced by this phase's deployment:** the Concierge now performs **one extra
`Bot_Sessions` read per lead-ready turn** (the authority reread) and **two Data Table operations
per minting turn**. Both are on the path of real users. Neither has been observed under
production load, because no customer traffic has hit the new graph yet.

---

## BLOCKERS TO GO

1. **Mini App gateway is not deployed.** Nothing can submit. *(largest, and it is build work)*
2. **G5 replay protection does not exist** and cannot be built on current infrastructure —
   **owner decision on a store required.**
3. **F17** — nine dead columns — **owner UI action required.**
4. **P1-L8 retention duration** not approved.
5. **No production smoke has been run** on the new Concierge graph.
6. **Two observability gaps**: stuck-`IN_FLIGHT` alarm, scheduled schema-footprint check.

---

## ACCEPTED RESIDUALS

* **P1-L4** — tenant restart not testable; platform residual, not a design defect.
* **P1-L9** — MERGE correlation unexercised; NEW is proven and shares the route.
* **The reread↔Intake window** — narrowed at P7.2, not closed. Closing it needs a
  compare-and-set the Sheets node does not offer. Unchanged and understood.
* **`CARRY`-path last-write-wins** on `Bot_Sessions` — inherited, not made worse.

---

## OWNER ACTIONS

| # | Action | Blocking? |
|---|---|---|
| 1 | **Revoke both n8n API keys in the n8n UI.** They are gone from this machine, but the values still authenticate until revoked | security hygiene |
| 2 | **Decide the G5 store** (recommendation: a Postgres table with `UNIQUE`) | **yes** |
| 3 | **Delete `AZ:BH`** via the 5-step runbook in §6 | **yes** |
| 4 | **Approve the retention duration** (recommendation: 30 days) | **yes** |
| 5 | **Send `/start`** from an owner Telegram account and report the result | **yes** |
| 6 | Approve building the Mini App gateway + the two monitors | **yes** |

---

## ROLLBACK PLAN

**If the Concierge misbehaves after a real customer turn:**

The pre-Model-B graph is `n8n/production/mppzthlkSJFr6Kle.*.json` at commit `a2aba3f` — but
**that file is a redacted reference and must never be PUT directly.** Rolling back uses the same
three-way materializer, in reverse:

1. Fetch the live workflow to an ephemeral path outside the repo (needs a fresh API key).
2. Run the materializer with `A` = current tracked reference, `B` = the pre-P7 candidate,
   `L` = live. The absolute invariants apply as they did going forward.
3. Verify the readback: 33 nodes, transport expressions intact, 0 markers.

**Expected blast radius of a rollback:** issuance stops; the Telegram funnel returns to exactly
its pre-2026-08-27 behaviour. No customer data is lost — receipts are additive.

**Time to roll back:** minutes, once a key exists.

---

## FIRST 24 HOURS AFTER ACTIVATION

*(activation meaning the Mini App, once the blockers clear — not today)*

| When | Do |
|---|---|
| T+0 | owner `/start` smoke; confirm reply, cycle, key, `READY` receipt |
| T+0 | confirm `Bot_Sessions` header fingerprint unchanged |
| first hour | watch Error Monitor; any Concierge execution error is **P1** |
| first hour | check for any receipt `IN_FLIGHT` > 15 min |
| T+6h | count `authority_stale` events — a handful is normal, a spike is not |
| T+24h | re-run the schema footprint check; confirm still ends at `AY` |
| T+24h | confirm no `Submission_Receipts` row is stuck `IN_FLIGHT` |
| anytime | if replies stop arriving, roll back immediately — do not debug live |

---

> ## GENERAL MINI APP ACTIVATION: **NO-GO**
>
> Model B is live and healthy. Activation is blocked on six items, four of which need an owner
> decision or a few clicks, and one of which — the gateway itself — is real build work.
