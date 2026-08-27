# FINMENTOR — P7.3 step 2: the issuer runs live, and the Telegram trigger was never enabled

**Phase:** B.2.1-C P7.3 step 2 — proving issuance without touching the bot.
**Status:** **ISSUANCE PROVED LIVE.** A `submission_key` was minted, a `READY` receipt was
created and read back, and an authority row carrying both `cycle_id` and `submission_key` was
written — all against the real stores, with **zero enabled Telegram triggers in existence at any
point** and **no `setWebhook` call of any kind**.
**Production Concierge: UNCHANGED**, byte-for-byte, verified before and after.
**Residue: zero**, measured rather than asserted.

---

## 0. The owner's question, answered first

> Probe whether the tenant test/execution API can supply synthetic trigger output while
> `telegramTrigger.disabled === true`.

**UNSUPPORTED.** Measured on disposable, credential-free workflow `DM4ZsMxiCqz65IIG`, three
independent ways:

| Probe | Result |
|---|---|
| `prepare_workflow_pin_data` on a graph with a disabled entry | reports `total: 3` for a **4-node** workflow. The disabled node is not counted as pinnable at all |
| `test_workflow` with `triggerNodeName: "Disabled Entry"` | hard error: **`Trigger node "Disabled Entry" not found in the workflow`** |
| `test_workflow` with pin data supplied for the disabled node, no `triggerNodeName` | **`status: success`** — and the pin was **accepted, stored, and ignored** |

The third result is the one that matters, and it is worse than the second. Execution `3671`
recorded `pinData` for `Disabled Entry` in full, ran the **control arm only**
(`Manual Control → Sentinel Manual`), and never executed `Sentinel TG`. `lastNodeExecuted` was
`Sentinel Manual`.

> A disabled node's pin data is taken silently and dropped silently. An operator who supplied a
> fixture and read `status: success` would conclude the injection worked. It did not, and
> nothing in the response says so.

The control arm ran perfectly on the same call, so the harness was not vacuous — the injection
specifically did not happen.

**§8 fallback therefore applies.** Option 1 — temporarily enabling the copied trigger — was
forbidden by the owner and was never attempted.

---

## 1. A hazard found in the first 90 seconds, before any of that

Creating the probe with `create_workflow_from_code` returned:

```
"autoAssignedCredentials": [
  { "nodeName": "TG Entry", "credentialName": "FINMENTOR Leads Bot FINAL",
    "credentialType": "telegramApi", "source": "user" } ]
```

**The tenant silently bound a live Telegram bot credential to a trigger node that was never
asked to have one.** The probe was credential-free by design and by construction; the surface
attached a credential anyway.

Nothing was activated and no registration occurred — the workflow was created inactive and
`triggerCount` read `0` throughout — but this is precisely the hazard class P7.3 exists to
prevent, arriving from a direction step 1 did not model: **not from the artifact carrying a
credential, but from the creation surface adding one.**

Response: the node was **removed entirely**, not merely disabled, so no bot credential is bound
anywhere in the probe, and it was replaced with a credential-free disabled `scheduleTrigger`.
The probe question is a *platform* question — can the test API supply output to a disabled node
— and it does not need a Telegram trigger to answer it.

**Standing consequence:** `autoAssignedCredentials` must be read on **every** create call
against this tenant. It is not decoration; it is the surface telling you what it attached.

---

## 2. What was built instead

A **non-activatable harness** running the exact issuer logic, and a credential-free driver.

```
DRIVER  QnD1lB4YBKGzGelZ   manualTrigger → Execute Workflow → Code      (no credentials)
        │  test_workflow pins the manual trigger and supplies the fixture as pin data
        ▼
HARNESS hERmxcQiubXVL1Gc   30 nodes, 23 inherited BYTE-IDENTICAL       (availableInMCP false)
```

The split is forced, not stylistic. `test_workflow` **pins** trigger nodes, credential-bearing
nodes and HTTP Request nodes *in the workflow it runs* — so a single workflow holding the Google
Sheets nodes would have reported a confident success while writing nothing. A workflow reached
as a **sub-workflow** executes for real. That is why the credentials live in the child and the
thing actually tested is the parent.

### 2.1 The one node name that could not be renamed

`Parse Telegram Update` opens, verbatim and unmodifiable:

```js
const u = $('Telegram Client Trigger').first().json;
```

n8n resolves that **by node name**. A harness that renamed the entry would not be running the
audited body — it would be running a different program that happens to look like it.

So the harness supplies a node genuinely named `Telegram Client Trigger`, **and makes it a Code
node**:

| | |
|---|---|
| holds no Telegram credential | there is nothing to register with |
| is not a trigger type | it cannot be activated into a webhook |
| emits the synthetic update where the real trigger would | every downstream body runs byte-identically and cannot tell |

That substitution is the whole trick, and the gate asserts it from both ends: the wrapper's node
**is** a `telegramTrigger`, the harness's node **is** a Code node with no credentials, and
`Parse Telegram Update` still resolves that name — so the substitution cannot silently lose its
purpose.

The second substitution, `HARNESS Delivery Stub`, stands in for `Send Client Message` +
`IF Message Delivered`, emitting that IF's TRUE-branch shape without executing any Telegram node
and without calling the live transport. `correlation_id` is carried through from
`Build Transport Request` verbatim, because `Issuance Gate` reads it off `$input`.

### 2.2 What the harness cannot do

Nine production nodes are excluded by name, and their absence is asserted: the three transport
callers, `Answer Callback Query`, `Send Lead to Intake`, and the three secondary Sheets writers.
The gate additionally requires **zero** `httpRequest` nodes, **zero** `executeWorkflow` nodes,
**zero** nodes of any Telegram type, no `telegramApi` reference anywhere in the document, and
exactly one trigger — an `executeWorkflowTrigger`, which has no URL and no bot.

`settings.errorWorkflow` is deliberately not inherited: the harness is not production and must
not page the owner.

---

## 3. Live deploy, verified on readback

`POST /api/v1/workflows`, the file posted verbatim from disk — no transcription step anywhere.

| | |
|---|---|
| `active` | `false` |
| node count | 30, matching the local artifact |
| `availableInMCP` | `false` |
| `errorWorkflow` | absent |
| Telegram node types | **0** |
| `telegramApi` reference | **absent** |
| bot credential `2JnVm0BIX0Z8tvBf` | **absent** |
| triggers | `HARNESS Entry [executeWorkflowTrigger]` |
| **all 23 inherited nodes** | **byte-identical to the audited wrapper**, parameters and credentials both |

The last row is the load-bearing one. Everything the live run proves is a proof about the code
the harness *contained*; if one Code body had drifted by a character it would be a proof about a
different program.

---

## 4. §4 — the synthetic issuance test

Reserved synthetic chat **`900000732`**. Driver execution **`3672`**.

| # | Claim | Result |
|---|---|---|
| 1 | issuer mints `sub_<32 lowercase hex>` | **PASS** — `sub_41ab6576f04387c9a6e44c4cf1cbdf94`, `__issuance_action: MINT`, reason `NEW_CYCLE_START` |
| 2 | creates a `READY` receipt | **PASS** — live `Submission_Receipts` row, `commit_state: "READY"` |
| 3 | exact readback | **PASS** — readback returned that exact key |
| 4 | cardinality exactly 1 | **PASS** — `__rows_seen: 1` |
| 5 | pristine receipt | **PASS** — `canonical_lead_id`, `claimed_at`, `settled_at`, `abort_reason` all empty |
| 6 | `verified_submission_key` matches the minted key | **PASS** — identical, `__insert_errored: false` |
| 7 | authority advances only afterward | **PASS** — `__advance: true`, `__reason: PREALLOCATION_CONFIRMED`; `Build Session Row` is downstream of `Issuance Verdict` and ran after it |
| 8 | `Bot_Sessions` receives `cycle_id` **and** `submission_key` | **PASS** — row carried `C-900000732-1787853200947` and the minted key together |
| 9 | post-authority reread occurs | **NOT EXERCISED** — see §4.1 |
| 10 | issuer continues only when stored pair matches | **NOT EXERCISED** — see §4.1 |
| 11 | no Telegram send executed | **PASS** — the harness contains no Telegram node; delivery was stubbed |
| 12 | no client output contains `submission_key` | **PASS** — no client-facing node executed at all |

### 4.1 Why 9 and 10 could not be true on this turn, and why that is the design

`Authority Reread` sits behind `IF Lead Ready`. On a **minting** turn the lead path is not taken
— a reset clears consent, and `lead_ready` requires a current-cycle consent — so the reread is
not on the executed path. The harness recorded exactly that: `__harness_outcome: NOT_LEAD_READY`,
`authority: { __absent: true }`.

This is not a harness limitation. P7.2 §6 stated it as a deliberate placement:

> on a minting turn the lead path is not taken at all, so a refusal placed there would have had
> nothing left to refuse.

Reaching the reread requires a **lead-ready** session: `contact_name`, `company`, a contact
method, `consent === "yes"` in the current cycle, and minimum lead data. That is a multi-turn
conversation, not a fixture — and it is the honest cost of testing that branch. It was not
faked, and it is listed in §8 as the next step.

---

## 5. §6 — old-session compatibility

Driver execution **`3674`**: plain navigation (`/menu`) against the row the mint had just
created.

| | |
|---|---|
| `__issuance_action` | **`CARRY`** |
| `__issuance_reason` | **`CYCLE_UNCHANGED`** |
| `__preallocate` | **`false`** |
| `Issuance Verdict` | did not run (`__absent`) |
| `Receipt Readback` | did not run (`null`) |
| `cycle_id` | unchanged |
| `submission_key` | unchanged, **not re-minted** |
| new receipt | **none** |

**Reading an existing cycle does not spontaneously create or replace a receipt.** Only an actual
new authoritative cycle issuance mints a key.

**Stated precisely:** the live row carried a *non-empty* key, so what ran live is the `CARRY`
path. The literal `submission_key = ''` legacy row was **not** seeded live, because seeding it
would have required a Sheets write outside the audited graph. The code path is the same one —
when `reset === ''` the mint block is skipped entirely, whatever the persisted key holds — and
`NEVER_BACKFILL` for the empty case is covered offline by `qa/concierge-issuer-candidate.test.mjs`.
Live coverage of the empty-key variant remains **open**.

---

## 6. §5 — the losing issuer: NOT TESTED, and why

**Not attempted, and not faked.** Two reasons, both structural:

1. The reread is unreachable without a lead-ready session (§4.1), so there was nothing to make
   stale.
2. `test_workflow` calls run **sequentially**. A genuine race needs a parent firing sub-workflows
   with `waitForSubWorkflow: false` against one shared absolute timestamp. Running two turns
   back to back does not stage a race; it stages two turns.

A deterministic alternative exists and has precedent — P6.3 closed F11 by fault injection — but
a fault-injection harness variant is a different artifact with its own fidelity argument, and
building it inside a session that had already written live rows would have risked leaving those
rows behind. It is the first item in §8.

P3 established that issuance is **not** single-writer, so this remains a real open risk, not a
formality.

---

## 7. §7 — Telegram safety

No `setWebhook` call was made, by anything, at any point. Production was inspected with
**non-mutating reads only**.

| | Before | After |
|---|---|---|
| `id` / `active` / nodes | `mppzthlkSJFr6Kle` / `true` / 33 | **identical** |
| `versionId` | `f560f7f3-ffb3-4877-9b2b-fa9b25364e35` | **identical** |
| `updatedAt` | `2026-08-25 17:39:02` | **identical** — not touched today |
| `triggerCount` | 1 | **identical** |
| trigger `disabled` | absent (enabled) | **identical** |
| trigger `webhookId` | `fa4cd08a-…-03755a0aa42d` | **identical** |
| trigger credential | `2JnVm0BIX0Z8tvBf` | **identical** |
| `submission_key` references | 0 | **identical** |

**No Telegram trigger was enabled at any point in this phase.** The harness contains none; the
probe's auto-credentialed one was deleted within seconds of being created and was never
activated; the step-1 canary was **not deployed at all** (§3 was gated on §2 passing, and it did
not).

---

## 8. A step-1 unknown, closed on the way past

Step 1 recorded its biggest open risk as `POST_DEPLOY_ASSERTIONS[0]`: the REST create endpoint
drops `active` and `meta`, leaving `nodes[0].disabled` as the only surviving guard — and whether
the endpoint *preserves* a node's `disabled` flag could not be established offline.

It can be established online, cheaply and safely. A disposable credential-free workflow with one
disabled `scheduleTrigger` was posted and read back:

| | |
|---|---|
| `node.disabled` on readback | **`true` — PRESERVED** |
| `triggerCount` | **`0`** |
| `active` | `false` |

Both halves matter. The flag survives the create, **and** n8n counts a disabled trigger as *no
trigger* — which is the interlock, confirmed at the platform level rather than assumed. The
probe was archived immediately.

This does not make the canary safe to deploy on its own; it removes the specific unknown that
made deploying it unquantifiable.

---

## 9. §9 — cleanup

Every live row written by this phase was removed by a **guarded** disposable child
(`Lum6tk8deMALYaRH`), driven through the same credential-free parent. Six guards, all of which
had to hold before an irreversible delete was authorised: reserved-range chat id, a well-formed
minted key, **exactly one** matching row, matching `session_id` **and** `cycle_id` **and**
`submission_key`, no `lead_id`, and `row_number > 1`.

| | |
|---|---|
| `Bot_Sessions` row 29 | **deleted** (`success: true`) |
| `Submission_Receipts` receipt | **deleted** — the exact `READY` row, returned in full by the delete |
| rows remaining for the chat | **0** — measured by **re-reading the sheet after the delete**, not asserted |
| `residue_zero` | **`true`** |

All four disposables archived: `DM4ZsMxiCqz65IIG` (probe), `hERmxcQiubXVL1Gc` (harness),
`QnD1lB4YBKGzGelZ` (driver), `Lum6tk8deMALYaRH` (cleanup). The `disabled`-preservation probe was
archived in the same call that created it.

---

## 10. What this phase does NOT claim

| | |
|---|---|
| The Concierge is live-ready | **NO.** The wrapper is deployable and the issuer works; neither is a cutover decision |
| The step-1 canary was deployed | **NO** — §3 was gated on §2, which returned UNSUPPORTED |
| The post-authority reread works live | **NOT TESTED** — unreachable without a lead-ready session |
| A losing issuer refuses live | **NOT TESTED** — needs a genuine concurrent writer or a fault-injection variant |
| The empty-key legacy row was exercised live | **NO** — the `CARRY` path was; the empty variant is offline-only |
| The concurrency window is closed | **NO.** Narrowed at P7.2, unchanged |
| The `CARRY`-path lost update | **NOT ADDRESSED**, unchanged |
| Mini App submit gateway | **unchanged, still absent** |
| General Mini App activation | **NOT CLEARED** |

---

## 11. Next, in order

1. **A fault-injection harness variant** for §5, with its own fidelity argument, plus a
   lead-ready session fixture for §4.9–4.10. Both need the multi-turn conversation the harness
   can now drive.
2. **The empty-key legacy row**, seeded and exercised live, closing §6's remaining half.
3. **Then the cutover decision.** Not before.

`p71b` (F17, the `AZ:BE` sweep) is still open for the owner and still blocks nothing.
