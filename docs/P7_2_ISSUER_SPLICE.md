# FINMENTOR — P7.2: the issuer, built

**Phase:** B.2.1-C P7 — the issuer half.
**Status:** **CANDIDATE BUILT AND GATED. NOT DEPLOYED.** The three steps P7.1 left standing are
done, and a **fourth was added that the plan did not ask for** — a post-authority reread — because
without it the lead handoff could run under a key that was no longer authoritative. One real
safety defect, **F18**, was found and fixed inside this phase.
**Production mutations: none. No live workflow was created, modified, activated or executed.**

---

## 0. What was outstanding

`docs/P7_1_LIVE_COLUMN_PROOF.md` §8 left three steps. P7.0's original five had already lost two
to live measurement — F14 refuted, F15 closed — and what remained was:

1. splice the mint into `Get Bot Session` via a deterministic generator, never by hand-editing a
   live graph;
2. add `submission_key` to **all three** row builders together;
3. fail-closed wiring: when the readback is unconfirmed, `Save Bot Session` must not run.

All three are done. The artifact is `n8n/candidate/concierge-issuer-candidate.json`, produced by
`scripts/build-concierge-issuer-candidate.mjs`, and gated by
`qa/concierge-issuer-candidate.test.mjs` — **65 checks, all executing the deployed bodies rather
than reading them.**

---

## 1. The issuance sites, found mechanically rather than remembered

The splice is only complete if every place that issues or persists an authoritative cycle was
covered. That was answered by scanning every tracked graph, not by recalling the shape:

| | Sites | Where |
|---|---|---|
| Nodes that **create** a `cycle_id` | **1** | `Get Bot Session` |
| Nodes that **write** the Bot_Sessions authority row | **3** | `Save Bot Session`, `Save Intake State`, `Save Confirmation State` |

Gate check **(2.1)** pins the first at exactly one and **(2.2)** pins the second at exactly
three, each with the builder that feeds it. The three-writer fact is the whole reason P7.0 §5
step 4 said *together*: all three persist a full session row through `autoMapInputData`, so a
builder that omits the column writes `''` over a key the previous save wrote. Check **(4.3)**
proves that by mutation — a builder with the column removed emits no `submission_key` at all,
which is exactly the blanking the rule exists to prevent.

---

## 2. The shape

Existing nodes in `[]`, new nodes in `<>`. Twelve nodes added, two production edges rewired,
nothing else touched.

```
[IF Message Delivered] true  -> <Issuance Gate> -> <IF Issuance Fault>
                                   true  -> <Build Issuance Failure Event> -> [Save Bot Event]
                                   false -> <IF Preallocation Required>
                                              false -> [Build Session Row]
                                              true  -> <Receipt Preallocate>
                                                         -> <Receipt Readback>
                                                         -> <Issuance Verdict>
                                                         -> <IF Authority May Advance>
                                                              true  -> [Build Session Row]
                                                              false -> <Build Issuance Failure Event>
                      false -> [Build Delivery Failure Event]              (unchanged)

[IF Lead Ready]       true  -> <Authority Reread> -> <Authority Verdict> -> <IF Authority Current>
                                   true  -> [IF Lead Already Sent]
                                   false -> <Build Stale Authority Event> -> [Save Bot Event]
                      false -> [Build Bot Event]                           (unchanged)
```

**The fail-closed property, walked rather than drawn.** Check **(5.2)** enumerates every path
from `Issuance Gate` to `Save Bot Session` and finds **exactly two**: one that mints and one that
does not. The minting path is required to visit `Receipt Preallocate → Receipt Readback →
Issuance Verdict → IF Authority May Advance` **in that order** — ISSUANCE_ORDER as a graph
property. Check **(5.4)** proves the fault branch has **zero** paths to `Save Bot Session` or
`Save Intake State`, and **(5.5)** proves `Build Session Row` has exactly two inbound edges and
they are the declared ones.

**The non-minting path is not a hole.** It is `CARRY`, `CARRY_MALFORMED` and `LEGACY_NO_KEY` —
none of which creates a receipt, so there is nothing new to confirm. `authorityAdvanceAllowed()`
says exactly that, and it is the only reason that edge is allowed to exist.

---

## 3. F18 — **NEW, and it was a real fail-open**

Found while writing the test for the reread, and it is worth being precise that this was **not a
test bug that got argued into a source bug.**

The `Authority Verdict` node tells a concurrent winner apart from a lagging read by the
timestamp inside `cycle_id`, which is `'C-' + chat_id + '-' + Date.now()`. The first form of that
parser took the trailing run of digits and required **ten or more** of them:

```js
const m = /-(\d{10,})$/.exec(String(cid));      // NaN for anything else
...
if (finite(held) && finite(current) && current > held) return SUPERSEDED;
return LAGGED;                                   // <- the fall-through, which PROCEEDS
```

Anything that failed to parse stamped as `NaN`, fell past the guard, and landed on
`AUTHORITY_READ_LAGGED` — which **proceeds to the lead handoff.** The default turned *"I cannot
compare these"* into *"carry on"*.

**The unparseable values are not hypothetical, and two of them are written by this repository's
own tooling:**

| Value | Written by | Shape |
|---|---|---|
| `C-900000701-P71` | `scripts/p71-sheet-probe.ps1` — **into the real `Bot_Sessions` sheet during P7.1** | non-numeric stamp |
| `C-900` | `scripts/build-cas-gate-workflow.mjs` | no stamp segment at all |

Either sitting in the authority row while this turn held a genuine minted cycle would have been
read as a lagging read, and **a losing turn would have handed its lead to Intake under a key
Bot_Sessions no longer named** — a CRM lead bound to a dead cycle, behind a receipt the gateway
can never claim, because the gateway reads the *current* authority row and finds a different key.

**The fix is in the candidate, not in the test.** Two changes:

1. The parser matches the **exact minted shape** — `/^C-\d+-(\d+)$/` — instead of a loose tail
   with an arbitrary width threshold. The threshold was the thing that could misclassify, so it
   is gone rather than lowered; check **(7.7)** proves a short-but-well-formed stamp now compares
   correctly.
2. **Uncomparable is not lagged.** Proceeding now requires *positive* evidence of lag — a
   strictly older stamp, which needs both sides to parse. When either does not, the verdict is
   `AUTHORITY_CYCLE_UNCOMPARABLE` and it **refuses**, landing where `AUTHORITY_ROW_ABSENT` and
   `READBACK_STORE_ERROR` already land.

The asymmetry is what settles it. A false refusal costs the user one restart. A false proceed
costs a lead in the CRM that no cycle names, and the user cannot fix that by doing anything at
all.

Check **(7.6)** drives the probe's own `C-900000701-P71` through the deployed body and requires a
refusal. Check **(7.7)** models the old algorithm alongside it and proves it **would have
proceeded** — so the fix is measured against the defect rather than asserted over it.

---

## 4. The mint, executed

Everything below ran the byte-exact `Get Bot Session` body out of the candidate, with `require`
injected so the primitive could be replaced with a hostile one.

| Check | Result |
|---|---|
| 2,000 draws through the deployed body | **0 collisions, 0 malformed** |
| Two issuances inside **one millisecond**, measured to occur | identical `cycle_id`, **different keys** |
| `/start`, restart, bootstrap | **MINT**, `preallocate: true` |
| unchanged cycle | **CARRY**, key byte-identical, `preallocate: false` |
| malformed key | **CARRY_MALFORMED** — unchanged, never blanked, never repaired |
| legacy cycle, no key | **LEGACY_NO_KEY** — never backfilled, `lead_id` undisturbed |
| agreement with `decideIssuance()` over the whole case table | **exact**, on action, reason and preallocate |

The same-millisecond row is the one that earns its place: the check loops until an identical
`cycle_id` pair is actually observed before it asserts anything, so it cannot pass vacuously.
`cycle_id` collides there by construction; the key does not.

**The mint cannot kill the bot.** `Get Bot Session` runs *before* the reply is composed, so an
exception in it is not a failed submission — it is a user who gets no message. The mint is
wrapped, and checks **(3.9)** and **(3.10)** drive it with a short draw, a non-byte draw, and a
`require` that throws outright. All three degrade to `MINT_FAILED` with an empty key and a fault
flag, the turn still returns a session, and it is the **graph** that refuses to persist the
half-advanced cycle — `planIssuance()`'s posture, wired rather than described.

---

## 5. The readback, executed

`Issuance Verdict` is the deployed form of `verifyPreallocationReadback()`. Check **(6.11)** runs
both over ten cases and requires the same `advance` and the same `reason` from each.

What refuses: absent, duplicate, wrong key, **padded** key, non-string key, every non-`READY`
state, each of the seven pristine fields **alone**, an already-claimed row, a missing or
unparseable `created_at`, and a store error. What is explicitly **not** confirmation: an insert
that returned an id — check **(6.10)** hands the verdict a successful insert alongside an empty
readback and requires `READBACK_ABSENT`.

**The zero-item discriminator.** `alwaysOutputData` is load-bearing — without it a zero match
returns `main[0] === []` and skips every downstream node, so the fail-closed branch could never
run. The cost is that "no match" arrives as **one empty item**. Check **(6.3)** proves the
premise it defends against: `Boolean({})` is `true`, so a truthiness test would have accepted it.
The discriminator is key count, never truthiness and never `try/catch`.

**F7 binding.** Check **(4.6)** hands `Build Session Row` a verdict naming one key and a gate
naming another, and requires the **verified** key to be written. The authority write consumes the
verifier's output, so "authority advanced without a confirmed receipt" is a data dependency
rather than a rule someone has to remember about the wiring.

---

## 6. Old-session compatibility

Check **(4.5)** runs a legacy row end to end: gate → all three builders. It takes the
`LEGACY_NO_KEY` path, all three builders write `submission_key: ''`, the legacy `cycle_id` is
undisturbed, and `lead_id` survives. `Find Session`'s canonical empty session now names the
column explicitly instead of leaving it inferred from an absent property.

The reread does not disturb legacy traffic either. A lead-ready turn never mints — a reset clears
consent, and `lead_ready` requires a current-cycle consent — so on that turn the held cycle *is*
the row's cycle and the comparison short-circuits on string equality before any stamp is parsed.
Check **(7.9)** pins both halves: a legacy turn where someone else minted is refused, and a
legacy turn where nobody did is allowed through.

---

## 7. Fidelity — what the splice did not touch

Section 1 diffs the candidate against production **independently**. It does not re-run the
transform, so a bug in the generator cannot pass its own check.

| | |
|---|---|
| Production nodes surviving, by name and type | **all 33** |
| Inherited nodes modified | **exactly 5**, all Code nodes, all declared |
| Inherited **credential-bearing** nodes modified | **zero** — parameters and credential refs byte-identical |
| Production edges rewired | **exactly 2** — `IF Message Delivered`, `IF Lead Ready` |
| Both rewired IFs' FALSE branches | **byte-identical to production** |
| `Save Bot Session` | untouched — `autoMapInputData`, `chat_id`, the 40-entry schema, still no `submission_key` in it |
| `Read Bot Sessions` | untouched — still `A:AV`, the range F14 was refuted about |
| `Authority Reread` | a **verbatim** copy of `Read Bot Sessions`, so the two reads cannot disagree about the sheet |
| Regeneration | **byte-identical** — check (9.3) reruns the generator and diffs |

Two credential-bearing nodes are **added** — the two Data Table nodes — and one Sheets read. That
is a different statement from "modified", and it is made separately rather than folded in.

**Operational cost:** one extra `Bot_Sessions` read per **lead-ready** turn, not per message. The
reread sits after `IF Lead Ready` for that reason, and for a second one that decided it: on a
minting turn the lead path is not taken at all, so a refusal placed after `Save Bot Session`
would have had nothing left to refuse.

---

## 8. TB-1

| | |
|---|---|
| `submission_key` in `CLIENT_RESPONSE_FIELDS` | **no** — check (8.1) |
| Any client-facing Concierge node referencing it | **none** of the nine — check (8.2) |
| The key value written to `Bot_Events` | **never** — checks (8.3), (8.4) |

The key is a capability: whoever holds it can claim the receipt, and `Bot_Events` is a
spreadsheet with wider read access than the Data Table. Both new event builders record only
whether a key was **present**, and check (8.4) drives them with a real key and requires it to be
absent from the entire emitted row. Both emit **exactly** the twelve Bot_Events columns — under
F16 a thirteenth key would not be dropped, it would permanently widen the live sheet.

---

## 9. What P7.2 does NOT claim

| | |
|---|---|
| Issuer **deployed** | **NO.** The candidate exists; nothing was imported |
| Production Concierge modified | **NO** — gate (1.9) still asserts zero `submission_key` references and `active: true` |
| Candidate **import-safe** | **NO.** It carries production id `mppzthlkSJFr6Kle`, `active: true` and the live Telegram trigger. Hand-importing it **overwrites the running bot** |
| A key minted by the candidate, live | **NO** — every measurement in this document is offline, against the byte-exact bodies |
| The concurrency window **closed** | **NO.** Narrowed. Between the reread and the Intake call another execution can still win; closing it needs a compare-and-set the Sheets node does not offer |
| The `CARRY`-path lost update | **NOT ADDRESSED.** `appendOrUpdate` is last-write-wins and always was; P7.2 inherits it and does not make it worse |
| Mini App submit gateway | **unchanged, still absent** |
| General Mini App activation | **NOT CLEARED** — unchanged |

---

## 10. P7.3, in order

1. **The import-safe wrapper.** P6.1 did this for Lead Intake and the hazards are the same ones,
   plus one the Concierge adds: `activeVersion` is stripped by this generator already, but the
   production id, `active: true` and the live `telegramTrigger` are all still in the file. That
   wrapper is what gets imported, never this artifact.
2. **A live canary against a synthetic chat**, in the reserved `900000xxx` range: prove one MINT
   turn end to end — receipt created READY, readback confirmed, authority row carrying both
   `cycle_id` and `submission_key` — and prove a fault turn persists nothing.
3. **Then, and only then, the cutover decision.** The Concierge is on the path of every Telegram
   update; the deployment risk is the same one P7.1 declined to take for a defect that did not
   exist.

`p71b` (F17, the `AZ:BE` sweep) is still open for the owner and still blocks nothing.
