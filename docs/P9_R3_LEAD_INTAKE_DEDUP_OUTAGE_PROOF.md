# P9-R3 — Lead Intake dedup-read outage: CONFIRMED on an isolated harness

**Status: the finding in `FINDING_LEAD_INTAKE_DEDUP_STORE_OUTAGE.md` is CONFIRMED, and it is
worse than it was written. DIAGNOSIS ONLY — nothing in Lead Intake was changed.**

Recorded 2026-08-29. Owner scoped this cycle to diagnosing the open finding, explicitly not to
remediating it.

## 1. The question

The finding was a **reading of the deployed graph**, not a live finding. It said so plainly, and
it named exactly what would settle it: copy the graph, swap the Sheets read for a stand-in that
can throw, swap the Pipeline write for a non-writing passthrough, drive one request, and read
`runData` per node.

The question:

> On a Pipeline dedup READ failure, does the success branch reach `Save to Pipeline` — a write —
> while the error branch separately answers CRM unavailable?

## 2. Why it could not be answered by reading

`Read Pipeline (Dedup)` carries both `alwaysOutputData: true` and `onError:
'continueErrorOutput'`. That pair makes a failing node emit on **both** outputs: the error item
on output 1, and a synthetic empty item on output 0. `Dedup Guard` then opens with

    const rows = $input.all().map(i => i.json)
      .filter(r => r && String(r.lead_id || '').trim() !== '');

which discards the synthetic item, leaving `rows = []` — identical to a genuine "nothing
matched".

The wiring looks correct in exactly this case. P9-R1 is the precedent: a respond node that looked
correctly configured emitted a bare 500, and configuration inspection is the method that missed
it. So this was driven, not read.

## 3. The harness

Two disposable workflows, built by `scripts/build-lead-intake-dedup-harness.mjs`, driven and torn
down by `scripts/run-lead-intake-dedup-harness.mjs`, gated by
`qa/lead-intake-dedup-harness.test.mjs` (40 assertions).

Fidelity is enforced by a **rule**, not a hand-written exception list:

> Every node that can touch the outside world or persistent state is replaced by a
> credential-free stand-in. Every node that computes or routes is byte-identical.

The divergence allowlist is **computed from node type**, so a Sheets or Telegram node added to
production later is neutralised automatically rather than slipping past a stale list.

    102 nodes total
     23 declared divergences   12 Sheets + 4 Telegram + 5 data-table + 1 OpenAI + the webhook
     79 byte-identical         including every node whose behaviour was in question
      0 connection changes     the map is identical

`Dedup Guard`, `Receipt Gate`, `IF Receipt Fault`, `IF Receipt Required`, `IF Is New`,
`Build Pipeline Row`, `IF Internal (Infra)`, `Respond Infra Failed`, `Stop: CRM Unavailable`,
`Normalize + Score Lead` and `Correlation Guard` are all **production's own, unmodified**. The
flag pair under test is *mirrored by copying it*, not asserted, so the harness cannot accidentally
test a graph that does not have the defect.

Two divergences beyond the nodes, both deliberate and both gated:

1. **Retention is ON.** Production retains nothing, but the question is which nodes *ran*, and
   that lives only in `runData`. The retained data is a synthetic lead at `example.invalid`.
2. **`settings.errorWorkflow` is removed.** Production routes failures to the live Error Monitor
   (`RBiFLhVjizMkAzrK`). This harness fails on purpose, repeatedly, and would otherwise have
   paged production with manufactured alerts.

**H1** is entirely credential-free: no Sheets, Telegram, data-table or OpenAI node exists in it.
**H2** keeps the **real Google Sheets node** on the dedup read, pointed at a disposable credential
that cannot authenticate — so the throw comes from the real node type rather than from a Code node
standing in for it.

Preflight aborts before deploying if the live graph is not a field-level match for the tracked
export, or if production no longer carries the flag pair. Both held: live structural hash
`adf3ad0b…3991`, equal to `n8n/production/manifest.json`, zero drift.

## 4. The four modes

`harness_dedup` selects what the stand-in read does. An unrecognised or absent value throws
rather than defaulting, because a harness that quietly picks a happy path proves nothing.

    down   throw, as an unreachable Sheets API does      the hypothesis
    none   return ZERO rows — the read SUCCEEDED and     the legitimate empty case
           matched nothing
    dup    one row matching the submitted contact        control: must MERGE
    new    one NON-matching row                          control: must WRITE

`down` versus `none` is the heart of it. `dup` and `new` are the controls the finding asked for:
*"without them a harness that fails everything looks like a pass."*

## 5. Results

Five shots, each correlated to its execution by a nonce read back out of the execution's own
webhook body — never by recency.

    mode   HTTP  exec     dedup outputs  Dedup Guard  Build Pipeline Row  Save to Pipeline  error branch
    ----   ----  -------  -------------  -----------  ------------------  ----------------  ------------
    none   200   success  [1, 0]         new          RAN                 REACHED           no
    dup    200   success  [1, 0]         duplicate    no                  not reached       no
    new    200   success  [1, 0]         new          RAN                 REACHED           no
    down   200   error    [1, 1]         new          RAN                 REACHED           ran
    H2     200   error    [1, 1]         new          RAN                 REACHED           ran

H2 is the real Google Sheets node against a dead credential. It behaved **identically** to the
Code stand-in, so the stand-in was not the reason.

Both controls held: a genuine duplicate merged and did not write; a genuine new lead did write,
which is what proves the harness is capable of detecting a write at all.

## 6. Verdict

**CONFIRMED.**

- The dedup read fired **both outputs**, `[1, 1]` — the `alwaysOutputData` signature.
- The success branch reached **`Save to Pipeline`**. In production that node is a Google Sheets
  append: a *read* outage can create the duplicate the read exists to prevent.
- `Dedup Guard` emitted a **byte-identical verdict** for an outage and for a legitimately empty
  read — `{"dedup_mode":"new","dedup_match_by":"","dedup_tier":"","existing_lead_id":""}`. The
  ambiguity is not an inference about n8n's engine; it is on the record, per node.

## 7. The correction — it is worse than the finding predicted

The finding listed two things that might mask the defect, and was careful to call neither a
design. The second was:

> The error branch is much shorter … So the caller very probably receives the correct
> CRM-unavailable response. That is a race being won, not a race being avoided.

**That race is not won.** On the outage, both respond nodes fired:

    responders = ["Respond New Lead", "Respond Infra Failed"]
    caller got   {"ok":true,"lead_id":"FIN-1787994265696-27","mode":"new",
                  "priority":"INCOMPLETE","financial_zone":"UNKNOWN"}   HTTP 200

`Respond New Lead` ran **first** and committed the response; `Respond Infra Failed` became a
no-op. The caller is told the lead was accepted as new, with a fresh `lead_id`, at HTTP 200.

So a dedup-read outage is invisible from the caller's side as well as from the sheet's. n8n
records the execution as `error` — which is the only place it surfaces at all, and production
retains nothing.

The first masking argument in the finding — that a read outage will usually take the write down
too — is untouched by this run and remains true as luck about a shared dependency, not a control.

## 8. Two defects in the harness itself, found by its own controls

Kept in the record rather than quietly fixed, because both are the reason the controls exist.

**The first live run reported all four modes as identical** (`[1, 0]`, `guard=new`, write
reached) and the `dup` control failed. Two independent causes:

1. **The payload was the wrong shape.** `Normalize + Score Lead` reads
   `pick(client.email, lead.email)` — a **top-level** `email` is never seen. The lead therefore
   had an empty `email_norm`, no match was possible, and the `dup` control could never pass
   however correct the rest of the harness was.
2. **Execution correlation was racy.** Shots run back to back and executions are persisted
   asynchronously, so "the newest execution started since I fired" could legitimately be the
   *previous* shot's — silently attributing one mode's `runData` to another. Now every shot
   carries a nonce that is read back out of the execution's own webhook body.

Had the controls not been there, the first run would have reported `down` reaching the write —
the correct conclusion — from four rows that were all measuring something else. The gate refused
to issue a verdict, which is the behaviour that was wanted.

**The builder's gate also caught a real leak.** The tracked export carries an `activeVersion`
blob: an entire second copy of the production graph. Building the harness by deleting known-bad
top-level keys shipped the production spreadsheet id inside it. The builder now emits **only**
`name`, `nodes`, `connections`, `settings`, and the exact key set is asserted. A second, quieter
instance: `sheetName.cachedResultUrl` embeds the spreadsheet id in a field that looks like a
display label.

## 9. The fix, now that it is confirmed

Unchanged in shape from what the finding proposed, and it does **not** need the flag removed
blindly — the flag is genuinely needed for the real zero-match case, and unlike the Gateway there
is no CTE that can make a legitimately-empty read produce a row on its own.

Make the **success item carry its own verdict**, so an empty item cannot impersonate a legitimate
result:

- have the read emit an explicit *"read succeeded, matched N rows"* marker, and have `Dedup Guard`
  refuse to proceed on an item lacking it, rather than inferring from a filtered count; **or**
- route the error output to a terminal respond/stop that runs **before** any write, so the
  success branch cannot reach `Save to Pipeline` on a failed read.

The run adds one requirement the finding could not have known: whichever fix is chosen must also
settle the **response**. Fixing only the write would leave a caller being told `ok:true` while the
execution errors.

## 10. Isolation and residue

- Nothing was written to Lead Intake PREMIUM FINAL. It is byte-identical to the tracked export,
  zero drift, before and after.
- The production Google Sheets credential, the `FINMENTOR_LEADS_CRM_PREMIUM_FINAL` spreadsheet and
  the `Submission_Receipts` data table were never referenced by either harness.
- The production Error Monitor was never paged.
- Everything created — two workflows and one disposable credential — was deleted in a `finally`
  block, and their absence was **verified by re-reading them**, not assumed from the DELETE.
- The harness routes are `p9r3/dedup-outage-h1` and `p9r3/dedup-outage-h2`. The production Lead
  Intake route was never at risk; the gate refuses a build that carries it.

## 11. Scope

Diagnosis only. **No change was made to Lead Intake PREMIUM FINAL, its candidate, its builder or
its QA.** Remediation is a separate cycle and needs its own owner approval.

The Gateway's FINAL GO from `P9_B21C_OWNER_TEST_SURFACE.md` is untouched and unaffected — this
defect lives in Lead Intake and is structurally unreachable from the Gateway.

QA 33/33, 1502 assertions.
