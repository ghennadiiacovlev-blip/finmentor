# FINMENTOR — P8.3: Concierge hardening, and the handoff that could not be migrated

## VERDICT

**PARTIAL. The hardening candidate is built and proven offline. Nothing was deployed.**

Two blockers, and only one of them is about credentials:

1. **The structurally trusted internal Lead Intake entry does not exist in production.** The
   Concierge cannot be migrated to a route that is not there. §16 says stop and report the exact
   mismatch rather than touch Lead Intake, so that is what this document does.
2. **No n8n API key.** Both were removed in P8 at your instruction, so the fresh production
   baseline (§1) and the cutover (§16) cannot run.

The four unblocked changes — including the one fixing live customer harm — are built, verified
and ready to deploy the moment a short-lived key exists.

---

## BEFORE

| | |
|---|---|
| Concierge | `mppzthlkSJFr6Kle`, 45 nodes, Model-B issuance live since 2026-08-27 |
| `/start` reliability | **execution #3716 died at `Read Settings` in 312 ms; the customer got no reply** |
| Pre-reply external round trips | **3** — Read Settings, Read Bot Sessions, Send Client Message |
| Authority write failure | `Save Bot Session` has `onError: stopWorkflow` and no protection at all |
| Bot Event failure | aborts the execution, marking a completed customer turn as an error |
| Session read backoff | `maxTries 3 × 2000 ms` → worst case **4 s**, above the 3 s SLO ceiling on its own |
| Lead handoff | public HTTP webhook, with a broken `x-finmentor-internal-key` header |

---

## AFTER (candidate, not deployed)

`n8n/candidate/concierge-p83-candidate.json` — 51 nodes, +6, three field changes, nothing else.

| Class | Change |
|---|---|
| **HOT_PATH_CONFIG** | `Hot Path Config` (Code, zero I/O) feeds `Settings to Object` instead of `Read Settings`. Pre-reply round trips **3 → 2** |
| **AUTHORITY_FAILURE_CLASSIFICATION** | `IF Authority Write OK` → `Authority Outcome Reread` → `Authority Outcome Verdict` → `IF Authority Committed` → `Build Authority Unresolved Event` |
| **BOT_EVENT_RESILIENCE** | `Save Bot Event.onError = continueRegularOutput` |
| **SESSION_READ_LATENCY** | `Read Bot Sessions.waitBetweenTries 2000 → 750` (worst case 4 s → **1.5 s**) |

### The one design decision worth reading

`Settings to Object` is consumed by three nodes through `$('Settings to Object')`, and its body is
audited. So the change does **not** touch it, or them. It swaps what feeds it: a local Code node
emitting the same `{key, value}` rows the Sheets read produced. Every downstream reference keeps
resolving, no audited body changes, and the round trip disappears.

`Read Settings` is **kept but made unreachable**. The materializer never approves a node removal,
and an unreachable node costs nothing — so the safest expression of "remove it from the hot path"
is to stop feeding it.

The four **DEAD** keys are simply not emitted. That is the removal: `internal_intake_key`,
`owner_chat_id`, `timezone`, `client_ai_temperature`.

---

## TRUST BOUNDARY — the migration that is blocked

**Measured, not assumed:**

| | live Lead Intake | internal-route candidate |
|---|---|---|
| nodes | **57** | 100 |
| triggers | **one public `webhook`** | webhook **+ `executeWorkflowTrigger`** |
| `submission_key` references | **0** | 41 |
| Data Table (receipt) nodes | **0** | 5 |
| **gap** | | **43 nodes to add** |

The internal entry — `Internal Subworkflow Trigger`, `Internal Auth Entry`,
`Internal Envelope Unwrap`, `Receipt Exact Read` — is **absent from production**. It exists only
as the P6.1 candidate, which was never deployed.

So `INTERNAL_HANDOFF` is **reported, not built**. Migrating the Concierge requires first
deploying 43 nodes into the revenue-path workflow — its own cutover, its own three-way
materialization, its own phase.

**What the current public path actually is**, from the graph:

* Lead Intake derives `source` from `payload.tool` (a **body** field) or an `x-finmentor-source`
  header the Concierge never sends. Provenance is caller-asserted on a public endpoint.
* `source` is referenced in exactly **one** node and only in its own derivation. It never gates a
  decision. It is **attribution, not trust**.
* The `x-finmentor-internal-key` header is inert three ways: the value is never emitted by
  `Settings to Object`, the consumer expression is malformed (`\Settings to Object` rather than
  `$('Settings to Object')`), and Lead Intake never reads the header.

**Nothing privileged rests on any of it**, which is why deleting the header changes no behaviour —
and why no shared-secret header replaces it. On a public endpoint that is not authentication; it
is a password in a request anyone can send.

**Status correction, stated plainly:** the Telegram funnel is **not** end-to-end Model-B
protected. The Concierge mints a `submission_key` on every new cycle and then submits its own
leads **without it**. The key exists solely for a Mini App that is not deployed.

---

## IDEMPOTENCY

**Unchanged by this phase, and that is the point of the blocker.** The public path carries
`retryOnFail maxTries 2` with `continueOnFail` and **no receipt**, so a retried submit can create
a second lead with nothing to deduplicate it. That is the Model-A weakness G1 exists to remove.

The §11 internal-route idempotency tests (NEW, COMMITTED replay, IN_FLIGHT, stale authority,
missing receipt, invalid key, route unavailable, no re-mint) **cannot be run against a route that
does not exist.** They are not simulated here; simulating them would produce evidence about a
fixture rather than about production.

---

## AUTHORITY FAILURE

The P8.2R design is now real nodes, and the invariant is proven **at graph level**:

```
Save Bot Session (onError: continue)
  → IF Authority Write OK
       [ok]     → IF Lead Ready                    (unchanged)
       [failed] → Authority Outcome Reread         CLASSIFY ONLY
                    → Authority Outcome Verdict
                       → IF Authority Committed
                            [A] ACK_LOST_BUT_COMMITTED → IF Lead Ready
                            [B] SUPERSEDED             → Build Authority Unresolved Event
                            [C] UNRESOLVED             → Build Authority Unresolved Event
```

| | |
|---|---|
| Edges into `Save Bot Session` | **exactly one**, from `Build Session Row` — asserted on the graph, not in a comment |
| `__write_allowed` | hard-coded **false** on every branch |
| Cycle ranking | **none** — a gate fails if stamp comparison appears. Ordering would invite a future edit to treat it as permission |
| Deployed body vs module classifier | driven against **one table of five cases**; they must agree |
| On UNRESOLVED | the `READY` receipt is **preserved** as recoverable orphan evidence, and the signal records key *presence*, never a key |

---

## LATENCY

| | |
|---|---|
| SLO | trigger → `Send Client Message` **completed**. <2 s preferred, <3 s acceptable, 3–5 s degraded, >5 s fail |
| Pre-reply round trips | 3 → **2** |
| Session-read worst case | 4 s → **1.5 s** |
| Measured improvement | **none yet** — no per-node timing exists, and none is promised |

The 8.849 s you measured is **total workflow duration**. `Send Client Message` is step 11 of 25;
receipt, authority and event all run after the customer has their message. The right number to
watch is time-to-reply, and it has never been measured.

---

## ROLLBACK

Not needed — nothing was deployed. When the cutover runs, the P7.5R procedure applies unchanged:
fetch `L` fresh to an ephemeral path, hash the rollback body, deploy `C_live` from memory, read
back, and restore `L` on any fidelity failure.

**One operational consequence worth recording:** the tracked reference `A` is now **stale by
construction** — it is the 33-node pre-Model-B export, and production is 45 nodes. `R(L) == A`
will fail until `A` is re-baselined from a live read. Every cutover invalidates the reference it
used. That was true after P7.5R too and was not spelled out.

---

## LIVE EVIDENCE

| | |
|---|---|
| Fresh production baseline (§1) | **NOT TAKEN** — no API key |
| Cutover (§16) | **NOT RUN** — no API key |
| Owner `/start` smoke (§18) | **OWNER ACTION** — and worth doing now, against the *current* live graph, to get a wall-clock time-to-reply baseline before any change |
| Internal-route idempotency (§11) | **BLOCKED** — the route does not exist |
| P1-L9 merge (§12) | **PARTIAL, not faked.** No safe synthetic CRM merge target exists, and none was created |

---

## RESIDUALS

* **G1 receipt substrate: PASS.** **G1 Telegram handoff integration: OPEN** — blocked on the
  Lead Intake internal-route deployment.
* **G5: OPEN**, untouched by this phase as instructed.
* **F17**: nine dead `Bot_Sessions` columns, owner cleanup pending.
* **P1-L4**: platform restart residual.
* **Duplicate-submit exposure on the Telegram funnel** — unchanged, and now precisely documented.
* **`x-finmentor-internal-key`** still present in production until the candidate deploys. It is
  inert, but it *looks* like authentication, and that is its own small hazard.

---

## OWNER ACTIONS

1. **Deploy the Lead Intake internal-route candidate** (43 nodes) — the prerequisite for
   everything in §3/§4/§11. Its own phase.
2. **Provide a fresh short-lived n8n key pair** when you want the hardening candidate deployed.
3. **Send `/start` now** and note the wall-clock reply time — a pre-change baseline costs nothing
   and is the only latency evidence anyone has.
4. Revoke the old keys in the n8n UI if not already done.
