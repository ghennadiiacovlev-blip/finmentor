# NEW LEAD owner alert — post-settlement dispatch. DESIGN ONLY, NOT DEPLOYED.

**Date:** 2026-08-30
**Status:** candidate architecture and exact diff. **Nothing built, nothing deployed.**
**Depends on:** the measured n8n return semantics recorded in
`docs/POST_E2E_PIPELINE_PROJECTION_AND_ALERT_AUTHORITY.md` §Defect 2.

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

Seven nodes move. **No builder is duplicated, no approved copy or `callback_data` is edited**, and
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
