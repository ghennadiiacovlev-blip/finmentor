# FINMENTOR — P7.0: the issuer half, preflight

**Phase:** B.2.1-C P7 — the half of Model B that has never existed.
**Status:** **PREFLIGHT COMPLETE, ISSUER NOT DEPLOYED.** The mint primitive is settled by live
measurement, the issuance decision is written and gated, and **two structural blockers were
found in the live Concierge** that must be closed before any issuer can work at all.
**Production mutations: none.** Two credential-free probes were created, run and archived.

---

## 0. Where this sits

G1 closed at P6.4: the receipt substrate is proven live end to end. P6.4 §6 recorded the gap it
could not close, and this is that gap —

> The live Concierge contains **zero** nodes referencing `submission_key`: it does not yet mint
> or persist one at cycle issuance… `P1-L11` is `PASS` on the substrate, but the **issuer half
> is not built**.

The consumer is finished and proven. The producer does not exist.

---

## 1. §2 first — the primitive, measured before a line of issuer code was written

P3 §3 specifies the mint as `crypto.randomBytes(16)`. Writing that literally would have shipped
an outage, and writing the modern reflex — `crypto.getRandomValues` — would have shipped the
same one.

**Probe, execution `3651`**, workflow `hBzJMVsCCu2xrccG`, 2 nodes, no credential, no I/O:

| Expression | Result |
|---|---|
| `typeof crypto` | **`"undefined"`** |
| `crypto.randomUUID()` | `ERR: crypto is not defined` |
| `crypto.getRandomValues(new Uint8Array(16))` | `ERR: crypto is not defined` |
| `crypto.randomBytes(16)` | `ERR: crypto is not defined` |
| **`require('crypto').randomBytes(16)`** | **`e0156e8ea8c81ca8f39b002155c76550`** |
| `typeof Buffer` | `function` |
| `typeof require` | `function` |
| `process.version` | `ERR: process is not defined` |

**There is no `crypto` global in an n8n Code node on this tenant.** That matters more here than
it would almost anywhere else in this system: the mint runs inside `Get Bot Session`, which is
on the path of **every** Telegram update. A `ReferenceError` there is not a failed submission
and not a degraded Mini App — it is a bot that stops answering `/start`, for every user, on the
first message after deployment.

Recorded plainly: **the specification was unimplementable as written, and one 2-node probe was
the difference between knowing that and finding out in production.**

### 1.1 Quality, not just availability

"It did not throw" is the same non-evidence here that "the node did not error" was for the
receipt insert at P5. A stub returning a constant, a counter or a time-derived value passes
that bar. So the surviving primitive was measured — **execution `3652`**, workflow
`JRprsVgF1elD03Xz`:

| Measure | Result |
|---|---|
| Draws | 10,000 |
| Distinct | **10,000** |
| Collisions | **0** |
| Malformed against `^sub_[0-9a-f]{32}$` | **0** |
| Distinct byte values observed | **256 of 256** |
| Common prefix between two draws | **0** hex chars |
| Two mints inside one millisecond — **measured to occur** | **`true`** |
| …and distinct | **`true`** |

The same-millisecond row is the one that earns its place. `cycle_id` is
`'C-' + chat_id + '-' + Date.now()`, which P3 §2 flagged as *"not a tail risk; it is a collision
by construction"* for two issuers in one millisecond. The probe **measured that the two mints
really did land in the same millisecond** — so the check was not vacuous — and the two keys were
different. The key survives the exact case the cycle id cannot.

Both probe workflows are **archived**.

---

## 2. §3 — what was built

### `n8n/src/concierge-issuer/mint-submission-key.js`

Step 1 of `ISSUANCE_ORDER`, and nothing that already exists. Steps 2–4 are
`buildPreallocation` and `verifyPreallocationReadback` in the receipt module and are already
gated; this module does not re-implement them, it is checked against them.

`randomBytes` is **injected**, not required at module scope, so the gate can drive the mint with
a hostile stub. The minted value is validated before it is returned — a short draw, a non-byte,
a missing primitive and a malformed result are each refused. Minting is the one place where a
silent weakening is invisible downstream: every consumer sees a well-formed string either way.

### The rule that carries the safety: **NEVER_BACKFILL**

Every `Bot_Sessions` row alive today has a `cycle_id` and no `submission_key`. The obvious
repair — *a current cycle must have a key, so mint one for it* — **creates a duplicate lead**.

A legacy cycle may already have submitted. `lead_id` is set, the CRM row exists, the work is
done. Backfilling preallocates a receipt in `READY`, and `READY` is **positive evidence that no
handoff began**. The gateway reads it, concludes the submission never happened, and releases
exactly one attempt for a lead that is already in the pipeline.

So the issuer never backfills. A legacy cycle keeps no key and stays unsubmittable; the gateway
answers `CANNOT_ANSWER` (P3 §5 fail-closed-when-missing); the user's next `/start` issues a
genuinely new cycle with a genuinely new key.

| | |
|---|---|
| Cost of refusing | one restart |
| Cost of backfilling | a duplicate lead |

The four decisions, complete:

| Input | Action | Preallocate? |
|---|---|---|
| `reset` ∈ {`start`,`restart`,`bootstrap`} | **MINT** a new key | **yes** |
| no reset, well-formed key present | **CARRY** it unchanged | no |
| no reset, malformed key present | **CARRY_MALFORMED** — unchanged, never repaired | no |
| no reset, no key | **LEGACY_NO_KEY** — never backfilled | no |

`CARRY_MALFORMED` is deliberate. Blanking a corrupt key and carrying it both end in the gateway
refusing — but blanking destroys the only evidence that the row is corrupt. **The issuer
reports; it does not launder.**

### `qa/concierge-issuer.test.mjs` — 34 executed checks

Including six mutation checks. Two are worth naming:

- **(2.5)** models a decision function that *does* backfill and proves it behaves differently
  from the real one. Without it, "the legacy row got no key" is also what a function that
  returns nothing at all would produce.
- **(3.1)** drives the **real** `verifyPreallocationReadback` — absent, duplicate, wrong key,
  already claimed, wrong state, not pristine, missing `created_at`, store error, unreadable —
  and proves the verifier itself refuses each one before proving authority does. Hand-written
  `{ok: true}` verdicts would only have proven the caller can be fooled.

**(4.4)** is the cheapest guard against the most expensive mistake available: **no tracked
workflow Code body may reference the `crypto` global.** It scans every Code node in the
Concierge, Lead Intake and the P6 candidate — 16 in the Concierge alone — after masking the
allowed `require('crypto')` form.

**(4.6)** records an honest hazard rather than hiding it. `n8n/src/lead-intake/
idempotency-receipt.js` calls `crypto.randomUUID()` in `newCorrelationId()`. That is correct in
Node — every offline gate executes it — and **fatal in a Code node**. It is not deployed today,
(4.4) proves that, and (4.6) exists so that splicing that helper into a graph is a decision
rather than an accident.

---

## 3. §4 — TWO STRUCTURAL BLOCKERS, found by tracing the live Concierge

Neither was known before P7.0. Both are pinned by the gate **in their current, known-bad state**
against the production export, so closing either one is a deliberate act that must come back to
this document and say so.

### F14 — the Concierge cannot READ `submission_key`

`Read Bot Sessions` does not read the sheet. It reads an **explicit range**:

```json
"dataLocationOnSheet": { "values": { "rangeDefinition": "specifyRange", "range": "A:AV", "headerRow": 1, "firstDataRow": 2 } }
```

`A:AV` is columns 1–48. The four B.2.1-C columns are **AW..AZ — columns 49–52**. Every session
row the Concierge loads is **truncated before the key**.

The consequence is not cosmetic. `CARRY` reads a field that never arrives, so it degrades into
`LEGACY_NO_KEY` on **every** message, and the key a `/start` minted would be invisible one
message later. An issuer deployed without widening this range would appear to work — a key is
minted, a receipt is created — and would then lose the key immediately and permanently.

**P7.1 must widen the range in the candidate.** Gate check (5.1) pins `A:AV` and carries the
column arithmetic so nobody re-derives it.

### F15 — the `submission_key` write is auto-mapped, and may be silently dropped

`Save Bot Session` uses `mappingMode: "autoMapInputData"`, matching on `chat_id`. P6R-1 proved
what that mode does with an unrecognised key: it is **silently DROPPED — no error, no warning.**

The AW..AZ headers exist with **zero data on every row** — and that is exactly the condition
under which the Sheets node has already been observed reporting a column as missing (P6-RESUME
§A1: the first schema read reported all four new columns absent, and that reading was wrong).

So whether the write lands is a **live** question and cannot be settled offline. It is recorded
as a blocker, not assumed away, and P7.1 must prove the round trip on a canary before anything
is claimed. Gate check (5.2) pins the mapping mode and the production schema.

---

## 4. What P7.0 does NOT claim

| | |
|---|---|
| Issuer deployed | **NO.** No candidate graph exists yet |
| Production Concierge modified | **NO** — gate (5.3) asserts zero `submission_key` references and that it is still `active` |
| `submission_key` written live | **NO** — F15 is open |
| `submission_key` read live | **NO** — F14 is open |
| Mini App submit gateway deployed | **NO** — unchanged, still absent |
| General Mini App activation | **NOT CLEARED** — unchanged |

## 5. P7.1, in order

1. Widen `Read Bot Sessions` to `A:AZ` **in a candidate**, and prove a live read returns the
   column (F14).
2. Prove `autoMapInputData` actually persists `submission_key` on a canary against the real
   sheet (F15). If it does not, the fix is an explicit column mapping, not a retry.
3. Splice the mint into `Get Bot Session` and the preallocation + readback pair between
   `IF Message Delivered` and `Build Session Row`, via a deterministic generator — never by
   hand-editing a live graph.
4. Add `submission_key` to all **three** row builders together. `Build Intake State Row` and
   `Build Confirmation State Row` also persist a session row, so a column added to only one of
   them is blanked by whichever runs last. Gate check (5.4) pins all three.
5. Fail-closed wiring: when the readback is unconfirmed, `Save Bot Session` must **not** run.
   The graph already tolerates a turn that persists nothing — the delivery-failure branch does
   exactly that today — so this adds no new class of harm.

## 6. Live tenant state after P7.0

| Workflow | id | State |
|---|---|---|
| P7-0 entropy probe | `hBzJMVsCCu2xrccG` | **archived** |
| P7-0b entropy quality | `JRprsVgF1elD03Xz` | **archived** |

No production workflow was created, modified, activated or executed. No sheet, Data Table or
customer row was touched. No Telegram message was sent. No credential was attached to either
probe.

---

## 7. Verification

| | |
|---|---|
| Gates | **15/15**, **803** assertions (769 → 803), floors raised deliberately |
| New gate | `concierge-issuer.test.mjs`, 34 checks, 6 mutation checks |
| Secret scan | **PASS** — 244 tracked files, 5 patterns |
