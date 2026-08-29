# FINDING — Lead Intake dedup read: a Sheets outage may read as "no duplicate"

**Status: CONFIRMED 2026-08-29 on an isolated harness. STILL NOT REMEDIATED.**

> **UPDATE — P9-R3.** Everything below was written as a *reading of the deployed graph*, and it
> has now been driven. The hypothesis is **confirmed**: on a dedup-read outage the success branch
> reaches `Save to Pipeline`. See **`P9_R3_LEAD_INTAKE_DEDUP_OUTAGE_PROOF.md`** for the harness,
> the five shots and the per-node `runData`.
>
> **One prediction below is WRONG and is corrected there.** The "two things that may mask it"
> section argues that the shorter error branch very probably answers the caller first. It does
> not. Both respond nodes fire, `Respond New Lead` wins, and the caller is told
> `{"ok":true, "mode":"new"}` with a fresh `lead_id` at **HTTP 200**. The outage is invisible from
> the caller's side as well as from the sheet's, so the defect is *worse* than recorded here, not
> merely confirmed.
>
> Nothing in Lead Intake was changed. Remediation remains a separate cycle needing owner approval.

Originally recorded 2026-08-29 during the P9-R2 Gateway cycle and deliberately left alone — the
owner scoped that cycle to the Gateway. The text below is preserved as written, so that what was
inferred can be compared against what was later measured.

This was a **reading of the deployed graph**, not a live finding. No outage was simulated against
Lead Intake, no request was sent to it, and nothing in it was changed. Everything below is
falsifiable by driving one real failure through a retention-enabled copy, which is what P9-R2
did for the Gateway and what had *not* been done here at the time of writing.

## How it was found

Not by review of Lead Intake — by sweeping every tracked workflow for the flag pair that caused
P9-R2, after that root cause was understood:

    alwaysOutputData: true   AND   onError: 'continueErrorOutput'

on the same node. In n8n that combination makes a failing node emit on **both** outputs: the
error item on output 1, and an empty item on output 0 from `alwaysOutputData`. Both branches then
execute, and whichever `Respond to Webhook` runs first commits the HTTP response. n8n records the
execution as a **success**.

28 workflow artifacts were scanned. Two distinct sites carry the pair. One was the Gateway's
`G5 Replay Claim`, now fixed (see `P9_B21C_OWNER_TEST_SURFACE.md` §13–15). The other is:

    QmIyEW2ZEqKregmN   FINMENTOR Lead Intake PREMIUM FINAL
    Read Pipeline (Dedup)   n8n-nodes-base.googleSheets
      onError: continueErrorOutput   +   alwaysOutputData: true

## Why the pair is load-bearing here, and why that is the problem

`alwaysOutputData` is on that node for a good reason — the same good reason it was on the
Gateway's claim node. A dedup read that legitimately matches **nothing** returns zero rows, and
without the flag the success branch would emit no item and the graph would stall. The flag makes
"no match" produce an item.

It cannot distinguish *"empty because nothing matched"* from *"empty because the node threw."*

## The wiring

    Read Pipeline (Dedup)
      main[0] -> Dedup Guard -> Receipt Gate -> ... -> IF Is New
                                                        -> Build Pipeline Row -> Save to Pipeline
      main[1] -> IF Internal (Infra) -> Respond Infra Failed -> Stop: CRM Unavailable

`Dedup Guard` opens with:

    const rows = $input.all().map(i => i.json)
      .filter(r => r && String(r.lead_id || '').trim() !== '');

That `filter` is the same shape as the pre-P9-R2 `Claim Verdict`, which filtered on `replay_key`
and read the survivors' **count** as its verdict. It discards the synthetic empty item — so on a
Sheets read failure `rows` is `[]`, which is indistinguishable from a genuine "no existing lead
matched."

## The consequence, stated as a hypothesis

On a Google Sheets read outage at that node, the expected behaviour is that *both* branches run:

- the error branch answers the caller **CRM unavailable** and stops, and
- the success branch proceeds as though **no duplicate exists** — down the path that ends in
  `Save to Pipeline`, **a write.**

If that is what happens, the direction is worse than the Gateway's was. The Gateway failed closed
on side effects: an outage minted no session and wrote no ledger row, and only the *response
contract* was wrong. Here the ambiguous branch leads to a write, so a read outage could create a
duplicate lead — precisely the thing the dedup read exists to prevent.

## Two things that may mask it, neither of which is a design

1. **A Sheets read outage will usually take the write down too.** If the API is unreachable for
   the read it is likely unreachable for `Save to Pipeline`, which would then fail on its own.
   That is luck about a shared dependency, not a control.
2. **The error branch is much shorter.** `IF Internal (Infra) -> Respond Infra Failed` is two
   nodes; the success branch runs through `Dedup Guard`, `Receipt Gate`, `IF Receipt Fault`,
   `IF Receipt Required`, `IF Is New` and `Build Pipeline Row` first. So the caller very probably
   receives the correct CRM-unavailable response. That is a race being won, not a race being
   avoided, and it says nothing about whether the write is attempted.

Neither is a reason to leave it. Both are reasons the defect could sit unnoticed indefinitely,
exactly as the Gateway's did — P9 §2/§3 recorded the 503 as merely *unproven* for weeks before a
harness showed it was unreachable.

## What would settle it

The P9-R2 method transfers directly, and no part of it needs production Sheets to break:

1. Copy the deployed graph to a disposable workflow with a gated divergence allowlist, so
   everything outside the allowlist is byte-identical to production.
2. Swap the Sheets read for a credential-free code stand-in that can throw on demand, and the
   Pipeline write for a non-writing passthrough that records whether it was reached.
3. Drive one request with the stand-in throwing. Read `runData` per node with retention enabled —
   `outputs=[1, 1]` on the read node is the signature, and whether `Build Pipeline Row` ran is the
   answer.
4. Keep controls: a genuine duplicate must still merge, and a genuine new lead must still write.
   Without them a harness that fails everything looks like a pass.

## The fix, if it is confirmed

Same shape as P9-R2, and it does not need the flag removed blindly — the flag is needed for the
real zero-match case. Make the **success item carry its own verdict** so an empty item cannot
impersonate a legitimate result:

- have the read emit an explicit "read succeeded, matched N rows" marker, and have `Dedup Guard`
  refuse to proceed on an item lacking it, rather than inferring from a filtered count; or
- route the error output to a terminal respond/stop that runs **before** any write, so the
  success branch cannot reach `Save to Pipeline` on a failed read.

Do not simply delete `alwaysOutputData` here without replacing what it does — unlike the Gateway,
there is no CTE to make a legitimately-empty read produce a row on its own.

## Scope

Recorded only. **No change was made to Lead Intake PREMIUM FINAL, its candidate, its builder or
its QA.** Remediation is a separate cycle and needs its own owner approval.

---

## Outcome (P9-R3, 2026-08-29)

Settled by exactly the method sketched in "What would settle it" above, with one addition: a
fourth mode in which the read **succeeds and matches nothing**, so that the outage could be shown
to be indistinguishable from the legitimate empty case rather than merely asserted to be.

    down   dedup outputs [1,1]   Dedup Guard: new         Save to Pipeline: REACHED
    none   dedup outputs [1,0]   Dedup Guard: new         Save to Pipeline: REACHED
    dup    dedup outputs [1,0]   Dedup Guard: duplicate   Save to Pipeline: not reached   (control)
    new    dedup outputs [1,0]   Dedup Guard: new         Save to Pipeline: REACHED       (control)

`Dedup Guard` emitted a byte-identical verdict for `down` and `none`. The real Google Sheets node
against a dead credential behaved identically to the credential-free stand-in.

The fix proposed above stands unchanged, with one requirement the finding could not have known:
it must also settle the **response**, not only the write. Fixing the write alone would leave a
caller being told `ok:true` while the execution errors.

Full record: `P9_R3_LEAD_INTAKE_DEDUP_OUTAGE_PROOF.md`.
