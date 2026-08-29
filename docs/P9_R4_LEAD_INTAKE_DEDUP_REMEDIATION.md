# P9-R4 — Lead Intake dedup fail-open: REMEDIATED, DEPLOYED, PROVEN

**Status: FIXED and live on `QmIyEW2ZEqKregmN` as of 2026-08-29. Lead Intake = GO.**

Owner-approved remediation of the defect confirmed in `P9_R3_LEAD_INTAKE_DEDUP_OUTAGE_PROOF.md`.
Scope was `Read Pipeline (Dedup)`, `Dedup Guard`, and the response/error settlement required to
make a dedup-read outage fail closed. Nothing else was touched.

## 1. Root cause, exactly

`Read Pipeline (Dedup)` carried **`alwaysOutputData: true`** together with
**`onError: 'continueErrorOutput'`**.

In n8n that pair makes a failing node emit on **both** outputs — the error item on output 1, and a
*synthetic empty item* on output 0. `Dedup Guard` v2 opened with

    const rows = $input.all().map(i => i.json)
      .filter(r => r && String(r.lead_id || '').trim() !== '');

and read the survivors' **count** as its verdict. The synthetic item was filtered away, `rows`
became `[]`, and the verdict was `new`. The execution then ran the entire success branch —
`Build Pipeline Row` → `Save to Pipeline`, **a write** — and `Respond New Lead` committed the
HTTP response before `Respond Infra Failed` ever ran.

The root cause is therefore not "the flag is wrong". `alwaysOutputData` is **required**: the read
returns zero items when the Pipeline sheet is empty, and without the flag that branch would stall.
The root cause is that **the flag's synthetic item was indistinguishable from a real result**, and
the guard inferred success from an absence rather than requiring proof of it.

## 2. Why the obvious fixes were inadmissible

Two facts were measured before any code was written, because P9-R1 established that reading
configuration is precisely how this class of defect gets missed.

**Fact 1 — the items are byte-identical.** From the P9-R3 harness, output 0 on a failure versus on
a legitimately empty read:

    OUTAGE  out0 = {"json":{},"pairedItem":[{"item":0,"input":0}]}
    EMPTY   out0 = {"json":{},"pairedItem":[{"item":0,"input":0}]}

So **no check on `Dedup Guard`'s input could tell them apart** while the error lived on a separate
output. This is exactly the constraint the owner set: *do not rely on item shape that can be
identical in those two cases.*

**Fact 2 — the success branch runs first, completely.** Node execution order on an outage:

    … Read Pipeline (Dedup)[9] → Dedup Guard[10] → … → Build Pipeline Row[15] →
    Save to Pipeline[16] → … → Respond New Lead[18] → … → IF Internal (Infra)[31] →
    Respond Infra Failed[32] → Stop: CRM Unavailable[33]

So **no cross-branch lookup and no "the stop node gets there first" argument could work either.**
`Stop: CRM Unavailable` did run — it just ran twenty nodes too late.

Together these eliminate: shape detection, `$('…')` cross-branch probes, reordering, and relying
on the terminal stop. The success branch had to be prevented from *starting*.

## 3. The measured basis for the fix

`scripts/probe-n8n-error-output-semantics.mjs` — a four-node disposable workflow — measured what
n8n actually delivers under each `onError` mode, with `alwaysOutputData: true` in both:

    onError                  throw → outputs   output 0 receives
    continueErrorOutput      [1, 1]            {}                     ← indistinguishable
    continueRegularOutput    [1]               { error: <message> }   ← distinguishable

Under `continueRegularOutput` the error item **replaces** the synthetic one — `alwaysOutputData`
cannot manufacture an anonymous item on a failure, because there is no separate success output for
it to appear on. And there is only **one branch**, so there is no race, no second responder and no
parallel write path — structurally, not by ordering luck.

The empty-sheet case is unaffected: a successful zero-row read still yields `{}` on that same
output, which is why the flag stays.

## 4. The minimal delta

Five field changes across two nodes. **100 of 102 nodes untouched**, and the entire error contract
is production's own.

    Read Pipeline (Dedup)   onError            continueErrorOutput → continueRegularOutput
                            alwaysOutputData   unchanged (true — still required)
                            parameters         unchanged
    Dedup Guard             parameters.jsCode  v2 → v3 (the read verdict prologue)
                            onError            (absent) → continueErrorOutput
                            alwaysOutputData   unchanged (absent — a throw must yield no item)
    connections             Read Pipeline (Dedup) main[1] → IF Internal (Infra)   REMOVED
                            Dedup Guard          main[1] → IF Internal (Infra)   ADDED

`Dedup Guard` v3 refuses to proceed unless **every** item is positively classifiable:

    {} with no keys                          → the empty-sheet marker. Under continueRegularOutput
                                               this can only arise from a SUCCESSFUL read.
    ≥1 recognised Pipeline field             → a row.
    an `error` key and no recognised field   → n8n's failure item → THROW.
    anything else                            → a shape it cannot vouch for → THROW.

It carries `onError: continueErrorOutput` and **no** `alwaysOutputData`, so a throw emits nothing
on output 0 — the write path cannot start — and output 1 carries the pre-existing contract.

Recognition deliberately wins over the error key: n8n's failure item carries *only* `error`, so a
Pipeline row that happened to have an `error` column must not take intake down. (`Build Pipeline
Row` emits no such column today; this is defence, not a live concern.)

**The response contract was not changed.** `IF Internal (Infra)`, `Respond Infra Failed`
(numeric **503**, `{ok:false, error_code:'CRM_UNAVAILABLE', retryable:true}`),
`Internal Result (Infra)` and `Stop: CRM Unavailable` are byte-identical to before. The fix routes
to the contract that already existed and had never once run alone.

## 5. Proof — before deploy, and again after

Same isolated harness that found the defect, rebuilt from the remediated graph. 23 declared
divergences, 79 nodes byte-identical, connection map identical. H2 uses the **real Google Sheets
node** against a disposable credential that cannot authenticate.

    case                              HTTP  exec     read out  Dedup Guard   Build Row  Save to Pipeline  responders
    A  successful EMPTY read          200   success  [1]       new           RAN        REACHED           [Respond New Lead]
    B  successful DUPLICATE read      200   success  [1]       duplicate     no         not reached       [Respond Retry]
       control: genuine new lead      200   success  [1]       new           RAN        REACHED           [Respond New Lead]
    C  synthetic read OUTAGE          503   error    [1]       THREW         no         not reached       [Respond Infra Failed]
    D  REAL Sheets dead credential    503   error    [1]       THREW         no         not reached       [Respond Infra Failed]
    E  ambiguous read output          503   error    [1]       THREW         no         not reached       [Respond Infra Failed]

Every failure case answered exactly:

    {"ok":false,"error_code":"CRM_UNAVAILABLE","retryable":true}     HTTP 503

Graded assertions, all passing:

- no failure case answered `{"ok":true,"mode":"new"}`
- **exactly one** respond node fired per failure case
- no failure case reached `Save to Pipeline`
- an outage and a legitimately empty read are now distinguishable — **200 vs 503**

Before deploy: PROVEN against the candidate. After deploy: **re-run against the deployed
structure, identical results.**

## 6. Deployment

Applied with the repo's three-way discipline (`n8n/src/deploy-guard/materializer.js`), because
P7.5 deployed a workflow generated from a tracked export and took every field it did not mean to
change along for the ride.

    1. L == A on every executable field          0 differences — no unrelated drift
    2. C_live = remediate(L)                     the delta applied to the LIVE graph, not a document
    3. diff(L, C_live) == the 5 declared changes exactly, and all of them
    4. C_live satisfies absolute invariants      flag pair absent graph-wide; 503 contract intact
    5. readback == C_live                        every executable field

Rollback point: `n8n/history/QmIyEW2ZEqKregmN.pre-p9r4-dedup-fix.json`, written before the PUT.

    deployed workflow : QmIyEW2ZEqKregmN  FINMENTOR Lead Intake PREMIUM FINAL
    status            : active = true, 102 nodes
    structural hash   : adf3ad0b…3991  →  0003fe02…5beb

## 7. Verification after deploy

- **Zero drift across all 9 tracked production workflows** (`Get-WorkflowStructuralHash`); only
  Lead Intake changed, and its manifest hash was updated to match.
- Gateway, G5, Supabase, Neon, F17/Bot_Sessions, Concierge, Pipeline schema, Premium UX — all
  untouched. The Gateway remains CLOSED at FINAL GO.
- Production credentials intact: 12 Google Sheets nodes referencing **1 distinct** credential id,
  4 Telegram nodes with credentials present.
- **No production data written during the failure tests.** Neither harness contains a Sheets,
  Telegram, data-table or OpenAI node — except H2's single dedup read on a dead credential — and
  `Save to Pipeline` was a non-writing stand-in in both. The newest retained production Lead Intake
  execution is from 08-28 20:13, before the 08-29 09:32 deploy: no production intake ran during
  this cycle.
- Execution isolation complete: every disposable workflow and credential deleted, absence verified
  by **re-reading** rather than assumed from the DELETE.
- QA **34/34 gates, 1536 assertions**, green from a foreign working directory. Secret scan clean.

## 8. Regression protection

Two gates, 74 assertions between them.

`qa/lead-intake-dedup-remediation.test.mjs` (32) uses the real pre-fix graph from `n8n/history/`
as its "before" and proves: the transform is exactly five fields across two nodes; every other node
is byte-identical; **the transform result is what is deployed today**; the guard source is
byte-identical to the live node; the write path and the 503 contract are untouched. It then mutates
each invariant and requires the verifier to refuse — eleven rejections, plus two on the diff
checker. Finally it **executes the deployed classification prologue directly** against the exact
item shapes measured from n8n, so cases A/C/E are covered offline without a live deploy.

`qa/lead-intake-dedup-harness.test.mjs` (42) flipped from "the defect is present so the harness has
something to find" to "the defect is gone and cannot come back": no node anywhere carries the flag
pair, the read has exactly one output, and the guard routes its error output.

## 9. Scope discipline

Nothing outside the approved scope was changed, and no further findings were investigated. The
pre-existing disposable workflows on the tenant from earlier phases were left alone.

## 10. Verdict

    VALID NEW LEAD          LIVE PASS   200 ok:true mode:new, write reached
    DUPLICATE               LIVE PASS   200 ok:true mode:retry, no write
    READ OUTAGE             LIVE PASS   503 CRM_UNAVAILABLE retryable:true, no write
    REAL SHEETS FAILURE     LIVE PASS   503 CRM_UNAVAILABLE retryable:true, no write
    AMBIGUOUS READ          LIVE PASS   503 CRM_UNAVAILABLE retryable:true, no write
    SINGLE RESPONSE         LIVE PASS   exactly one respond node per failure case

**LEAD INTAKE = GO.**

A dedup-read failure can no longer create a lead, and can no longer tell the caller it succeeded.
