# NEW LEAD owner alert — post-settlement dispatch. DESIGN ONLY, NOT DEPLOYED.

**Date:** 2026-08-30 (§0 added on the implementation attempt, same day)
**Status:** **STOPPED at the durability boundary — see §0.** Architecture and diff below stand;
nothing built, nothing deployed.
**Depends on:** the measured n8n return semantics recorded in
`docs/POST_E2E_PIPELINE_PROJECTION_AND_ALERT_AUTHORITY.md` §Defect 2.

---

## 0. STOPPED — a durable retry needs a payload store, and that needs a decision

Implementation was authorised and begun. It stops here, at the point the authorising instruction
named: *"If a new durable store/schema is actually required, STOP before creating it and report
why."* It is required. This is why.

### What CAN be done with no new store

The durable **intent** needs no new store and no schema change. `Submission_Receipts` already
provides the exact primitive, proven in production:

```
Receipt Claim   update WHERE submission_key = X AND commit_state = 'READY'  SET 'IN_FLIGHT'
Claim Verdict   reads the UPDATED ROW COUNT — 1 means this executor won
```

That is a real compare-and-set on an n8n Data Table. A notification intent can live in the same
table under a **disjoint key namespace** — `NEW_LEAD:<lead_id>` — because `Receipt Gate` pins the
lead-receipt namespace to `^sub_[0-9a-f]{32}$`, so the two can never collide, and the lead-receipt
machine reads only by exact key. Claim/settle/abort reuse the columns already there:
`commit_state`, `claimed_at`, `settled_at`, `abort_reason`, `correlation_id`, `canonical_lead_id`.

So: one intent per first settlement, an atomic claim, at most one successful send. **No new store,
no new column, no second settlement authority.**

### What CANNOT

A retry has to render the approved message again, and **the content is not durably anywhere.**
Measured on the live workflow:

```
Build Premium Telegram Brief reads 29 item fields.
The Pipeline row carries 62 columns.
NINE of the renderer's fields are not among them:
    city, country, diagnostic_score, lead_temperature, raw_json, risk_zone, score_zone, tool, urgency
```

`raw_json` is the important one — the renderer reads the original payload out of it. A retry
rebuilt from the Pipeline row would send a **degraded message**, which is altering the approved
NEW LEAD presentation by the back door. And `Save Lead to CRM` (which does carry a payload) is on
the public branch only: **the internal route never reaches it**, so for exactly the Mini App and
Concierge leads this whole change exists to serve, no second copy of the payload exists at all.

Retained n8n executions hold the payload, but retention on the endpoints is deliberately OFF and
Lead Intake's retention is not a contract — it is a setting, and building recovery on it would make
owner notification depend on a debugging convenience.

### The decision required

| option | what it costs | what it buys |
|---|---|---|
| **A — ship without automatic retry** | on an extended Telegram outage the intent stays `READY` and visible, and re-sending is an operator action driven from the retained execution (the method used for the UAT row repair) | no new store; one intent; atomic claim; at most one successful send; client fully independent; transient failures covered by `retryOnFail` on the Telegram node |
| **B — add the minimum dispatch ledger** | ONE new n8n Data Table, e.g. `Alert_Dispatch` — `dispatch_key`, `state`, `payload_json`, `claimed_at`, `settled_at`, `attempts`, `last_error` — holding the renderer's input verbatim | everything in A, plus a faithful automatic retry: the approved message is re-rendered from the same bytes that would have produced it the first time |

**B is what the stated invariant actually asks for.** A satisfies every clause except automatic
recovery, which the instruction lists explicitly. A new store is not being proposed for
convenience: it is the only place the *content* can live, and without content there is no faithful
retry.

Not built. Awaiting the choice.

### Also found while attempting it, and folded into the design below

All three Telegram nodes resolve the owner's chat id through **`$('Settings to Object')`** — a hard
node reference. Moving them into any new workflow breaks it silently unless that workflow also
carries `Read Settings` + `Settings to Object`. The §4 diff below is corrected accordingly: nine
nodes, not seven.

---

## 1. Root cause — CONFIRMED

The alert is not missing a connection. It hangs off the **public HTTP responder**:

```
Respond New Lead → Restore Lead Context → Route by Lead Priority → Build Premium Telegram Brief
                                                                 → Telegram Lead Alert
```

`Respond New Lead` is the FALSE branch of `IF Internal (New)`. So *"was the owner told"* is decided
by **which responder ran**, not by whether a lead was canonically settled. Every internal-route
lead — Premium Mini App and Telegram Concierge — terminates at `Internal Result (New)` and reaches
no alerting node at all. Confirmed on execution 4837: 32 nodes ran, no Telegram node among them.

## 2. The constraint that rules out the obvious fix

Measured on the tenant with disposable probes (created, run, deleted): a sub-workflow returns
**the output of the last node to finish, and depth beats connection order.**

| shape (`waitForSubWorkflow: true`) | caller received |
|---|---|
| `Result` first, `Side` second — equal depth | `SIDE` |
| `Side` first, `Result` second — equal depth | `RESULT` |
| `Result` first, **4-deep** side branch second | `SIDE4-deepest` |
| **4-deep** side branch first, `Result` second | `SIDE4-deepest` |

The alert chain is four nodes deep; `Internal Result (New)` is one. Hanging the chain beside it —
in either order — hands the submit endpoint the Telegram node's output instead of
`{ok, lead_id, mode, priority, financial_zone}`, and a committed lead is reported to the client as
an unresolved submission. Converging the chain back into the result node is worse: it would make
the client's answer depend on Telegram being reachable, and the switch's COLD output goes nowhere,
so a COLD internal lead would return nothing at all.

**Therefore the alert must leave the response execution.** Everything below follows from that.

## 3. The design

### 3.1 Authority

```
FIRST canonical NEW-lead settlement  →  exactly one NEW LEAD notification REQUESTED
```

The authority is the receipt, which already exists and is already exactly-once:

- `Receipt Commit (New)` transitions the receipt to `COMMITTED` and reports
  `__commit_updated_rows`. `IF Committed (New)` TRUE **is** first settlement;
- a replay of a committed submission never reaches it — `IF Receipt Settled` diverts to
  `Internal Result (Committed Replay)` far upstream;
- a refusal never reaches it — every `Internal Result (…)` refusal terminates earlier;
- a merge never reaches it — it is on the `IF Internal (Merge)` path.

**No second settlement authority is created, and no second CRM.** The notification is explicitly
NOT authoritative for business success: nothing downstream reads it, and the client's result stays
the canonical Lead Intake result whatever Telegram does.

### 3.2 Shape — extract, do not copy

A new workflow holds the alert presentation, **moved** out of Lead Intake rather than duplicated:

```
FINMENTOR NEW LEAD Alert Dispatch            (new workflow, executeWorkflowTrigger)
  Dispatch Trigger
    → Route by Lead Priority                 MOVED from Lead Intake, unchanged
        ├ HOT       → Build Premium Telegram Brief   MOVED, byte-identical, copy untouched
        │             → Telegram Lead Alert          MOVED, callback_data untouched
        ├ WARM      → Build Warm Telegram Alert      MOVED → Telegram Warm Alert
        ├ COLD      → (no output — unchanged)
        └ INCOMPLETE→ Build Incomplete Telegram Alert MOVED → Telegram Incomplete Alert
```

Seven nodes move; two more (Read Settings, Settings to Object) are COPIED, because the Telegram
nodes resolve the owner chat id through $('Settings to Object') and that reference must resolve in
the new host. They are config plumbing, not the alert builder, and Lead Intake keeps its own. **No builder is duplicated, no approved copy or `callback_data` is edited**, and
the three builders read `$json` only — no hard node references — so they work unchanged behind a
new trigger. That is asserted today by `qa/lead-intake-new-lead-alert-routing.test.mjs`.

### 3.3 Calling it — depth 1, fire-and-forget, listed first

Both routes call the dispatch through one node type: `executeWorkflow` with
**`waitForSubWorkflow: false`** and `onError: 'continueRegularOutput'`.

```
INTERNAL   IF Committed (New) [true] → [ Dispatch NEW LEAD , Internal Result (New) ]
                                          ^^^ listed FIRST, depth 1

PUBLIC     Restore Lead Context → … five existing consumers …
                                → Dispatch NEW LEAD        (replaces the edge to Route by Lead Priority)

MERGE      IF Escalated [true]  → Dispatch NEW LEAD        (preserves today's escalation alert)
```

Two proven properties make this safe, and they are the two the probe measured:

- **depth 1** — the dispatch node finishes immediately (it does not wait), so it can never be the
  last node to finish while `Internal Result (New)` is still to run;
- **listed first** — at equal depth the last-listed branch wins, so `Internal Result (New)` is
  listed second and its output is what the caller receives.

`waitForSubWorkflow: false` also means a Telegram outage, a slow Telegram API, an API error or a
rendering failure cannot delay or alter the Mini App submit response. `continueRegularOutput` means
a dispatch that cannot even be started is an ordinary item, not a thrown execution.

The dispatch payload is the restored lead context and nothing more, plus one field:

```
alert_reason: 'new_lead' | 'escalated_merge'
```

so a merge escalation can never render as a NEW LEAD claim. Today both share `Route by Lead
Priority` with no such marker; this is the one semantic addition.

## 4. Exact implementation diff

**New workflow** — `FINMENTOR NEW LEAD Alert Dispatch`
```
+ Dispatch Trigger                 executeWorkflowTrigger
+ Read Settings                    COPIED from Lead Intake — the three Telegram nodes resolve
+ Settings to Object               COPIED — owner_chat_id through $('Settings to Object'), a hard
                                   reference that breaks silently in a new host without these two
~ Route by Lead Priority           moved from Lead Intake, parameters byte-identical
~ Build Premium Telegram Brief     moved, jsCode byte-identical
~ Build Warm Telegram Alert        moved, jsCode byte-identical
~ Build Incomplete Telegram Alert  moved, jsCode byte-identical
~ Telegram Lead Alert              moved, parameters + credentials byte-identical
~ Telegram Warm Alert              moved, byte-identical
~ Telegram Incomplete Alert        moved, byte-identical
  connections: Dispatch Trigger → Route by Lead Priority, then the existing four edges verbatim
```

**`QmIyEW2ZEqKregmN` FINMENTOR Lead Intake PREMIUM FINAL** — 102 → 96 nodes
```
+ Dispatch NEW LEAD                executeWorkflow, waitForSubWorkflow:false,
                                   onError:'continueRegularOutput'
- Route by Lead Priority           moved out
- Build Premium Telegram Brief     moved out
- Build Warm Telegram Alert        moved out
- Build Incomplete Telegram Alert  moved out
- Telegram Lead Alert              moved out
- Telegram Warm Alert              moved out
- Telegram Incomplete Alert        moved out

connections
~ IF Committed (New)      b0: [Internal Result (New)]
                          →   [Dispatch NEW LEAD, Internal Result (New)]      ORDER IS LOAD-BEARING
~ Restore Lead Context    b0: [… , Route by Lead Priority]
                          →   [… , Dispatch NEW LEAD]
~ IF Escalated            b0: [Route by Lead Priority] → [Dispatch NEW LEAD]

unchanged: every other node, every other edge, all settings, the webhook route, every credential,
           Respond New Lead and the whole public response contract, the receipt machine,
           submission_key, the dedup guard, the AI path, and all six Sheets writers
```

## 5. What must be proven before it ships

| | |
|---|---|
| A | public NEW lead → response byte-identical to today, **1** NEW LEAD alert |
| B | Concierge NEW lead → **1** alert |
| C | Mini App NEW lead → **1** alert, and the caller still receives `{ok, lead_id, mode, priority, financial_zone}` — asserted on the returned payload, not on the graph |
| D | exact replay of a committed submission → canonical success response, **0** additional alerts |
| E | merge / update → **0** NEW LEAD alerts (`alert_reason` never `new_lead`) |
| F | Lead Intake refusal → **0** alerts |
| G | Pipeline write failure → **0** false-success alerts |
| H | **Telegram unreachable → the Mini App submit response is unchanged and still `ok:true`** |
| I | the dispatch node is depth 1 and listed FIRST on `IF Committed (New)` — a structural assertion, because this is the property the whole design rests on |

A–G offline against the resolved graphs, plus a disposable-probe re-run of the return-semantics
measurement against the real shape before the write. H is the one that cannot be faked: it needs an
injected dispatch failure, which the offline runner can do.

Three assertions in `qa/lead-intake-new-lead-alert-routing.test.mjs` describe the open defect and
must be **inverted** by that pass, deliberately, so the change has to come back to that file.

## 6. Not in this design

Restoring the other five side effects the internal route skips — the CRM sheet, Lead_Answers, the
activity log, Dashboard_Feed and the AI work plan. They are bypassed by exactly the same edge, and
`Restore Lead Context` fans out to all six, so the temptation to "just connect the internal branch
to the restorer" would restore all of them at once. That is a separate decision with a much larger
blast radius, and it is not what was asked for here.
