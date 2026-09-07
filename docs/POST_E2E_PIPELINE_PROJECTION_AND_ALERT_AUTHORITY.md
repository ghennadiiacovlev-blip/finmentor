# Post-E2E remediation — the Pipeline projection, and who is told about a new lead

**Date:** 2026-08-30 (night pass)
**Branch:** `feat/miniapp-b21c-live-prereqs`
**Status:** Defect 1 — candidate built, executed, gated. **Not deployed.**
Defect 2 — analysed and proven. **Not implemented, by finding.**
**Nothing was written to any production workflow, sheet, table or store in this pass.**

RU END-TO-END SUBMIT = PASS, banked. No submission was replayed and no lead was created.

---

## DEFECT 1 — the projection had a consumer and no producer

### Per field, read from the live artifacts

| | BP `current_setup` | BQ `decision_horizon` | BR `important_context` |
|---|---|---|---|
| **source path** | `body.premium.current_setup` | `body.premium.decision_horizon` | `body.premium.important_context` |
| **normalised value** | `Excel / ручные отчёты; План-факт; CFO / финансовая команда` | `2–4 недели` | `""` |
| **Build Pipeline Row output** | `""` | `""` | `""` |
| **target column** | Pipeline BP | Pipeline BQ | Pipeline BR |
| **actual Pipeline value** | *(empty)* | *(empty)* | *(empty)* |
| **root cause** | read from a field nobody sets | read from a field nobody sets | *(empty at source — legitimate)* |

BR is **not** a defect: the client left «Важно до встречи» blank. The session draft records
`important_context: {value: null, confirmed: false}` and the payload carried `""`. Only BP and BQ
lost a non-empty authoritative value.

### ROOT CAUSE — one sentence

> **The BP/BQ/BR contract was built in two halves and only the consumer half was written.**
> `Build Pipeline Row` reads `item.current_setup`, `item.decision_horizon`, `item.important_context`
> — and `Normalize + Score Lead` never lifts `payload.premium.*` onto the item. The string
> `premium` does not occur in that node at all. So all three reads are `undefined`, `pick()`
> normalises them to `''`, and three empty cells are written on every lead that has ever run.

The values were never lost in transit. They arrived, and they are still here: normalize preserves
the whole payload verbatim in `raw_json`, which is on the same item.

### Why the old gate was green while production was empty

`qa/premium-ux-projection-candidate.test.mjs` proves the three columns are emitted, and it passed
throughout. Its fixture puts the values on the item:

```js
buildRow({ ...BASE_LEAD, current_setup: 'Excel + 1С', decision_horizon: 'В этом квартале', ... })
```

Nothing produces that item. The gate tested the consumer against a shape the producer never emits —
the same failure mode as a QA fake that models an n8n error as a bare string. The new gate builds
every fixture the way the live workflow does, and its first assertion is that the fixture does
**not** carry the fields on the item.

### THE FIX — one node, and the source it already had in its hand

`Build Pipeline Row` **already** parses `item.raw_json`, defensively, in one line, to recover the
attribution `meta`. `premium` sits in the same blob. The parse is hoisted once and read twice:

```js
const __payload  = (function () { try { return JSON.parse(item.raw_json || '{}'); } catch (e) { return {}; } })();
const __meta     = (__payload.meta && typeof __payload.meta === 'object') ? __payload.meta : {};
const __premium  = (__payload.premium && typeof __payload.premium === 'object') ? __payload.premium : {};
...
current_setup:     pick(__premium.current_setup,     item.current_setup),
decision_horizon:  pick(__premium.decision_horizon,  item.decision_horizon),
important_context: pick(__premium.important_context, item.important_context)
```

The alternative was to teach `Normalize + Score Lead` to lift three fields. That is an 18 KB node
feeding dedup, scoring, routing, every alert and the AI plan — every consumer in the workflow.
Reading a value that is already present, in the node that already parses the blob it is present in,
changes one node and can affect nothing else. `item.*` is kept as a second source so a normalize
that lifts them later still wins, and so a non-premium lead writes `''` rather than a hole.

**Exactly one node differs from the deployed workflow.** Connections, settings and the other 101
nodes are byte-identical, asserted on the output rather than on intent.

### 1B — the merge path cannot be touched by this

| | new-lead path | merge path |
|---|---|---|
| builder | `Build Pipeline Row` | `Build Merge Update` |
| writer | `Save to Pipeline` | `Update Pipeline (Merge)` |
| operation | `append` | `update` |
| mapping | **`defineBelow`**, 62 named columns | **`autoMapInputData`** |
| the three keys | mapped, with schema entries | **absent from the builder's output** |

**Why the rules differ, and why that is correct.** A new lead appends a whole row, so the writer
names every column — and `defineBelow` physically cannot append a header, which is the F16
containment. A merge updates an existing row, so it must write only the fields it carries and leave
the rest alone; `autoMapInputData` is what gives it that, at the cost of appending a header for any
unknown key it is handed. That is why the three keys must never enter `Build Merge Update`: if they
did, **every merge would write those columns, and a merge that did not carry a value would erase
one that was there.**

Gated permanently: the merge builder must not mention the three names; the merge writer must stay
`autoMapInputData`; the new-lead writer must stay `append` + `defineBelow` with exactly 62 keys; no
other Sheets writer may map them; and `Build Pipeline Row` must remain reachable only from
`IF Is New`. The builder refuses to emit a candidate that breaks any of them.

### 1C — the real UAT row can be repaired without inference

**REPAIR POSSIBLE = YES. SOURCE AUTHORITATIVE = YES. NOT EXECUTED.**

Two independent persisted sources agree, neither of them a reconstruction:

| source | `current_setup` | `decision_horizon` |
|---|---|---|
| Lead Intake execution **4837** (retained), `body.premium` | `Excel / ручные отчёты; План-факт; CFO / финансовая команда` | `2–4 недели` |
| `MiniApp_App_Sessions` `draft_json`, still `state=submitted`, `lead_id=FIN-1788113619104-582` | `["Excel / ручные отчёты","План-факт","CFO / финансовая команда"]`, `user_explicit`, `confirmed:true` | `2–4 недели`, `user_explicit`, `confirmed:true` |

The array joins with `'; '` under the Premium UX contract's own canonicalisation, giving the string
in row 1 exactly. `important_context` is empty in both and must stay empty.

**Proposed repair, for authorisation — one row, two cells:**

```
target   Pipeline, the row where lead_id = FIN-1788113619104-582   (verified: exactly 1 such row)
write    BP current_setup    = Excel / ручные отчёты; План-факт; CFO / финансовая команда
         BQ decision_horizon = 2–4 недели
leave    BR important_context untouched (legitimately empty)
mechanism  a disposable Google Sheets `update` node, matching on lead_id, mappingMode defineBelow
           with THREE keys only — lead_id, current_setup, decision_horizon. Never autoMapInputData:
           the production credential is domain-restricted so the Sheets node is the only path, and
           defineBelow is what stops the write touching any other column.
before/after  the row is read and hashed before and after; every other cell must be byte-identical
rollback   the pre-image of the row, captured to .uat/ before the write
```

Not executed. Awaiting explicit authorisation.

---

## DEFECT 2 — the alert authority is the HTTP responder, and the fix is not one edge

### The routing, proven from the live graph

```
IF Internal (New)
  ├ TRUE  (internal: Mini App, Concierge) → Receipt Commit (New) → Commit Verdict (New)
  │                                       → IF Committed (New) → Internal Result (New)   ■ TERMINAL
  └ FALSE (public webhook)                → Respond New Lead → Restore Lead Context
                                              ├→ Save Lead to CRM
                                              ├→ Explode Answers
                                              ├→ Build Intake Activity
                                              ├→ Build Dashboard Row
                                              ├→ AI Gate
                                              └→ Route by Lead Priority → Build Premium Telegram Brief
                                                                        → Telegram Lead Alert
```

Confirmed against execution 4837: 32 nodes ran, ending at `Internal Result (New)`. No Telegram node
executed.

**The reported defect is real and it is wider than reported.** The internal route does not merely
skip the alert — it skips the entire post-response fan-out: **the CRM sheet, Lead_Answers, the
activity log, Dashboard_Feed, the AI work plan and all three alerts.** Every lead that has ever
arrived through the Mini App or the Telegram Concierge exists in the Pipeline and the receipt store
and nowhere else. Recorded here; not fixed, because fixing it is a different decision from fixing
the alert.

### Why "connect the Telegram node to the other branch" is not available

Measured on the tenant with disposable probe workflows — created, run four times each, and deleted:

| sub-workflow shape (`waitForSubWorkflow: true`) | what the caller received |
|---|---|
| `Result` listed first, `Side` second — both depth 1 | `SIDE` |
| `Side` listed first, `Result` second — both depth 1 | `RESULT` |
| `Result` first, **4-deep** side branch second | `SIDE4-deepest` |
| **4-deep** side branch first, `Result` second | `SIDE4-deepest` |

**A sub-workflow returns the output of the last node to finish, and depth beats connection order.**

The alert chain is four nodes deep (`Restore → Route → Build → Telegram`). `Internal Result (New)`
is one. So hanging the alert beside it — in either order — hands the submit endpoint the Telegram
node's output instead of `{ok, lead_id, mode, priority, financial_zone}`, and a committed lead is
reported to the client as an unresolved submission. The owner's instruction not to connect the node
before analysing side effects was exactly right.

Converging the alert chain back into `Internal Result (New)` is worse: it would make the client's
answer depend on Telegram being reachable, and `Route by Lead Priority`'s COLD output goes nowhere,
so a COLD internal lead would return nothing at all.

### What a correct fix has to satisfy — gated now, so it cannot be forgotten

`qa/lead-intake-new-lead-alert-routing.test.mjs` pins thirteen facts. Four are constraints:

- the three alert builders read `$json` only — **no hard node references** — so any feeder can drive
  them and the approved presentation and `callback_data` can be reused untouched;
- `Restore Lead Context` is pure context and reads `$('Dedup Guard')`, which **both routes execute**,
  so an identical internal restorer would work;
- but it **fans out to six consumers**, so feeding the internal route into it does not add an alert —
  it adds a CRM write, an answers explode, an activity row, a dashboard row and an AI plan;
- `Internal Result (New)` **ignores its input** (it reads `$('Dedup Guard')`), so it is safe as a
  convergence point — if the COLD hole and the Telegram-dependency are answered first.

Three assertions describe the OPEN defect and are expected to be **inverted** by the pass that fixes
it, so that pass has to come to this file and say so.

### The design that follows from the measurement

The alert must leave the response execution. The shape that satisfies every stated invariant is a
**shared post-settlement dispatch**: one alert entry that both routes call, reached from canonical
settlement (`IF Committed (New)` TRUE for internal, the existing `Restore Lead Context` for public),
invoked fire-and-forget at depth 1 and listed before the result node, so the response contract is
untouched and a Telegram outage cannot affect a client.

That means extracting the existing presentation into a shared path rather than copying it — which
is what §2B prefers, and which changes the public path's execution shape even though it cannot
change the public *response* (that is already sent by `Respond New Lead` before the alert chain
runs). **It is more than a routing change, so it is presented rather than performed.**

---

## Regression

```
node qa/run-all.mjs
59/59 gates, 2076 assertions, assertion floors PASS
```

Covering, unchanged: privacy exactly once, receipt exactly once, Lead Intake exactly once, Pipeline
exactly once, session terminal state, committed replay, the owner gate, G5, the Gateway, the 72 h
resume, the Premium Telegram copy, the Mini App success screen and materials semantics, the Lead
Alerts presentation, and the legacy public path.

**No production lead was created. No workflow was written. The probe workflows were disposable and
are deleted.** Stores re-read after the pass: `privacy_acknowledgements` 1 row (1 distinct key),
the session still `submitted` with its canonical lead, `Submission_Receipts` unchanged.

## Still open, deliberately

| | |
|---|---|
| SYSTEM ALERT COVERAGE GAP | **OPEN** — `docs/SYSTEM_ALERT_COVERAGE_GAP.md`. Now with a confirmed business-terminal failure that alerted nobody. Not mixed into this pass |
| AUTHORITATIVE CYCLE PROJECTION | **OPEN** — `docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md`. No Sheets access was added to the Gateway; `cycle_id` semantics untouched |
| the internal route's other five side effects | recorded above; a separate decision |
