# P8.4B — Write B live proof: the Concierge handoff, end to end

**2026-08-28. One owner-driven Telegram lead cycle, one replay. Both PASS.**

Write A (`P8_4A_*`) put an internal `executeWorkflowTrigger` on Lead Intake. Write B pointed the
Concierge at it and deleted the public HTTP submit. This is the evidence that the whole chain
works on the natural production path, with no harness in it.

## The chain, as it actually ran

| Step | Evidence |
|---|---|
| Telegram → Concierge | exec **3832**, mode `webhook`, 36 nodes |
| authoritative cycle | `Issuance Gate` → `__issuance_action: CARRY` (reuse path) |
| authoritative key | `Issuance Gate.__submission_key` — `sub_b6b9…dde4` |
| internal handoff | `Build Internal Handoff` emitted `{submission_key, envelope}`, key **identical** |
| internal call | `Send Lead to Intake (Internal)` → `QmIyEW2ZEqKregmN` |
| Lead Intake | exec **3834**, mode `integrated`, 33 nodes |
| receipt | `READY` → `IN_FLIGHT` (23:08:33.007) → `COMMITTED` (23:08:33.795) |
| Pipeline | `Update Pipeline (Merge)` — **one** write |
| customer | `Send Client Message` delivered `true`, no delivery-failure event |

`Issuance Verdict` did **not** run, and that is correct rather than a gap: it only executes when
a preallocation is required, and this cycle carried an existing key. This is exactly why the
handoff reads `Issuance Gate` and not `Issuance Verdict` — on the reuse path the latter is
unresolvable, and a handoff built on it would have failed on precisely the cycle that is most
common.

## The key, end to end

`Issuance Gate` == `Build Internal Handoff` wrapper == `Receipt Gate` inside Lead Intake ==
the `submission_key` on the settled receipt row. One value, four places, no mint at the handoff.

## Correlation — the Write A contract, on the MERGE branch

    wrapper meta.request_id        C-551662084-1787947621908
    wrapper audit.cycle_id         C-551662084-1787947621908
    Internal Auth __correlation    C-551662084-1787947621908
    Normalize request_id           C-551662084-1787947621908
    Build Merge Update.request_id  C-551662084-1787947621908
    receipt.correlation_id         C-551662084-1787947621908

All equal. The Concierge payload carries no `request_id` of its own, so the handoff injects the
`cycle_id` — server-derived and stable across retries within a cycle, which is what lets a replay
correlate to the submission it replays.

## Exactly one canonical lead

The dedup resolved `mode: duplicate` against a lead this chat already had from an earlier
session. `Save to Pipeline` did **not** run; `Update Pipeline (Merge)` did, once. The provisional
`lead_id` this cycle generated (`TG-…-1787947710469`) was never persisted — the canonical lead
stayed `TG-551662084-1787629189806`, and the receipt records that as `canonical_lead_id`.

So the strongest available reading: a second submission for a known lead produced **one Pipeline
write and zero new leads**.

## P1-L9 — closed, and closed by accident of the right kind

`P8_PRE_ACTIVATION_GO_NO_GO.md` §5 left P1-L9 PARTIAL with a precise limitation — *the merge
branch of Lead Intake correlation has never been exercised end to end; NEW is proven* — and
judged that testing it would need a synthetic CRM row **deliberately shaped to be matched by the
merge logic**, calling that a heavier live mutation than the phase could justify.

It turned out not to need one. The owner's own chat already had a prior lead, so the merge target
existed naturally, and the single approved test cycle took the MERGE branch on its own. The
correlation table above **is** the P1-L9 evidence, on the merge path, over the internal route.

**P1-L9: PASS.** No extra production mutation was made to obtain it — which is the only reason it
is claimable at all.

## Replay of the settled receipt

exec **3843**, driven through one disposable credential-free harness (created, used, deleted,
404-verified). The wrapper carried the **real** key and correlation with a **synthetic** payload:
a settled receipt resolves from the receipt, so re-injecting the customer's real lead data would
have added risk and proven nothing extra. The key was baked into the node body at creation time
so it never travelled through a tool call.

    Receipt Read Verdict : ok=0  reason="COMMITTED_SETTLED"
    terminal             : Internal Result (Committed Replay)
    returned             : {"ok":true,"lead_id":"TG-551662084-1787629189806","mode":"merged",
                            "priority":"WARM","financial_zone":"UNKNOWN","replay":true}
    Pipeline writes      : 0
    receipt writes       : 0
    public fallback      : 0

No `SUBMIT_UNRESOLVED`, no `retryable`. The receipt is unchanged after the replay — same
`commit_state`, same `canonical_lead_id`, same `settled_at`, same `correlation_id`. This is the
P8.4A-R correction doing its job on a real settled submission rather than a fixture.

## TB-1

No customer-facing node output contained the `submission_key`. The transport body fields were
`chat_id, text, keyboard_layout_id, keyboard_data, parse_mode, disable_preview, correlation_id,
layout_mapped, keyboard_signature` — no `mode`, no key.

## Production surfaces after both proofs

Concierge `5fe6142d` and Lead Intake `93139028` both still redact to their sealed references with
zero drift. `availableInMCP: false` on both. Lead Intake still has exactly one public webhook,
byte-identical to the sealed reference. The Concierge has zero HTTP nodes referencing the intake
URL and exactly one internal handoff.

Nothing tracked changed as a result of the proofs, so neither baseline needed re-sealing.

## Residue

- Receipt fixtures `…00a2`, `…00a3`, `…00c1` from the Write A proofs (keep `…00a1`, the canonical
  NEW evidence). Deletion needs `scripts/p63-residue-sweep.ps1`, which builds its own disposable
  pair; not run, per the standing instruction not to build cleanup infrastructure now.
- Synthetic Pipeline row `FIN-1787944699020-596` from the Write A NEW proof — `INCOMPLETE`,
  contactless, inert.
- The owner's test lead is a **real** merged lead on a real chat, not residue.

## Owner action

Revoke both n8n API keys. They were authorised for this cycle only and are not needed for
G5/Gateway.
