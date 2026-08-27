# FINMENTOR — P6.3: two live-found defects on the internal route

**Phase:** B.2.1-C live prerequisites, P6.3
**Severity:** F10 — total functional failure of the internal route. F11 — every internal
failure path collapsed onto the public route and threw at the caller. Both contained to a
disabled canary; production was never touched.

| | Defect | Found | State |
|---|---|---|---|
| **F10** | `Internal Envelope Unwrap` emitted a shape `Validate Payload` cannot read, so **no lead could be accepted at all** | live, exec `3583` | **fixed, and CLOSED LIVE** — proven by driver exec `3585` case F (§6) |
| **F11** | three `IF Internal (*)` gates read the internal-ness flag off `$json` while fed from an **error output**, making three internal terminals **unreachable** | live, driver exec `3585` case F | **fixed and gated offline — NOT yet deployed** (§7) |

**Status:** the candidate is corrected for both and gated offline. The live canary
`S24se5SYf5CJ0FIQ` carries F10's fix but **not** F11's, so it must be superseded once more —
runbook in §7.

---

## 1. What happened — F10

P6.2 deployed the audited 100-node candidate through the REST API and ran it for the first
time. Every internal submission carrying a **perfectly valid lead** came back:

```
INVALID_PAYLOAD — "Body must be a JSON object"
```

Not an edge case. The internal route could not accept **any** lead, so `NEW`, `MERGE` and
`RETRY` were not merely untested — they were **unreachable in every case**.

## 2. The F10 cause, in two lines

| Node | |
|---|---|
| `Internal Envelope Unwrap` (generated) | emitted `{ source, payload }` |
| `Validate Payload` (**inherited production**) | reads `raw.body` / `raw.headers` |

`Validate Payload` looked for a body, found none, and correctly rejected the request. The
graph was wired exactly as designed; the design was built on a false statement about a node
nobody here wrote.

## 3. Where the F10 false statement lived

`n8n/src/miniapp-submit/submit-contract.js` said the gateway projects onto

> the payload shape the EXISTING Lead Intake already parses (`{ source, payload }`, read by
> its Validate Payload node)

Half of that is true and half of it is the defect. `{ source, payload }` **is** a real
contract — between the gateway and `Internal Auth Entry`. It is **not** what `Validate
Payload` parses. That node is inherited production and parses the **webhook request shape**.
The comment conflated two seams, the unwrap was built to satisfy the conflation, and the
conflation was then repeated in `docs/PHASE_B2_1C_CONSENT_SUBMIT_CLOSURE.md`.

Both statements are corrected in this change. Correcting the code without correcting the
sentence that produced it would leave the defect available to be rebuilt.

## 4. Why 732 offline assertions did not catch F10

This is the part worth keeping.

`qa/receipt-integration.test.mjs` asserted that `Internal Envelope Unwrap` is **wired to**
`Validate Payload`, and that its body contained the string `source: env.source, payload:
env.payload`. Both assertions passed. Both were assertions about **topology and text**.

> A topology assertion cannot see a shape mismatch, and a string assertion cannot see a data
> contract — it can only confirm that the code still says what it said when the belief was
> written down. The old gate did not merely miss the defect. **It encoded it**, and would
> have failed if the defect were fixed.

At a seam between a node **we generate** and a node **we inherit**, the contract has to be
**executed**, not diagrammed.

## 5. What changed for F10

### 5.1 The fix — `scripts/build-lead-intake-receipt-candidate.mjs`

`Internal Envelope Unwrap` now emits the request shape:

```js
return [{ json: {
  headers: { 'x-finmentor-source': 'telegram_miniapp' },
  body: env.payload
} }];
```

Two properties of that, deliberate:

- **The header is a server-side literal, not `env.source`.** `Internal Auth Entry` has
  already hard-required `envelope.source === 'telegram_miniapp'` before this node runs, so
  the literal is exactly as truthful as the variable and **cannot be steered by a caller**.
  Provenance is established by the route, never by a field in a body.
- **`submission_key` still never enters the body.** It is a receipt control, not lead data.
  The receipt nodes read it from `$('Internal Auth Entry')` by node reference, as before.

No inherited production node was touched. The candidate is still 100 nodes.

### 5.2 The new gate — `qa/internal-route-contract.test.mjs` (13 checks for F10; 8 more added for F11 in §6.3)

It **executes** the two real `Code` bodies, read from the tracked candidate, against each
other in a minimal `$input` / `$()` harness. It proves:

| | |
|---|---|
| the premise | `Validate Payload` is byte-identical to the production node, and reads `raw.body`/`raw.headers` |
| **the seam** | a valid internal envelope **passes** `Validate Payload` — the assertion whose absence let this reach deployment |
| the data | name, email and `meta.request_id` survive the seam; `submission_key` does not leak into it |
| attribution | an internal lead scores `website`, **never** `telegram_client_concierge` |
| fails closed | empty payload → `EMPTY_PAYLOAD`; non-object → rejected; honeypot → `SPAM_SUSPECTED` |
| not steerable | a caller-supplied `headers` key in the body cannot forge attribution |
| **the regression** | the pre-F10 body, reproduced verbatim, must still produce `INVALID_PAYLOAD` / "Body must be a JSON object" — if it ever passes, this gate has stopped being able to detect the defect |
| control | the harness is running the real bodies, not a paraphrase |

### 5.3 The corrected gate — `qa/receipt-integration.test.mjs`

The assertion that required `{ source, payload }` is replaced by one that requires
`body: env.payload` **and explicitly forbids the old shape from returning**. The shape
contract itself now lives in the executing gate; this one keeps only the structural
properties it owns.

### 5.4 A better pin — `qa/import-safe.test.mjs`

The single `98,890` total Code-body pin is split, because one number conflated two things
with opposite meanings:

| | Pinned | Meaning if it moves |
|---|---|---|
| inherited (24 nodes) | `85,602` | **production drift** — never acceptable |
| generated | `14,230` | a receipt design change — acceptable, deliberately |

Inherited bodies are now additionally asserted **byte-identical to the production export**,
node by node. Under the old single pin, the only way to accept the F10 fix would have been to
edit the number — which would have silently widened the tolerance for inherited drift too.

### 5.5 Deploy-script hardening — `scripts/deploy-b21c-canary.ps1`

Three defects found while preparing the redeploy, all in the **verification** path:

1. **A false pass on the most important assertion.** With strict mode off, `$live.active -eq
   $true` on an *absent* property yields false and printed `active === false` — reporting a
   workflow inert on the strength of a property the server never sent. Absence is now its own
   outcome and is recorded as a **problem**. Same fix for `webhook.disabled`, `webhook.path`
   and `settings.availableInMCP`.
2. **A strict-mode crash mid-verification**, from the shared library reading `.disabled` on
   production nodes that lack it. Strict mode is relaxed for that **call only**, rather than
   editing library code other scripts depend on.
3. **Archived workflows counted as duplicates**, so the only way to redeploy a corrected
   candidate was to permanently delete the superseded one. Archived workflows cannot run and
   cannot serve; they are now noted and allowed. A **live** same-name workflow still aborts.

### 5.6 A live fidelity proof — `scripts/verify-live-canary-fidelity.mjs`

The deploy script proves the deployed workflow is **inert** (7 properties). It does not prove
it is **the artifact** — and that claim is the entire reason the REST route was chosen over
hand transcription. This script settles it against a definition fetched from live: all `Code`
bodies **byte-identical** (with the first divergent offset reported on failure), every node
type, typeVersion, parameter block, credential reference and the connection graph, plus the
safety properties re-checked on the live object. It is offline and holds no credential — the
fetch is the caller's job.

---
## 6. Live state — F10 is CLOSED, and the same run exposed F11

The live check was run after the fix was written, and it changed the picture. What follows is
observed, not planned.

| Workflow | id | State |
|---|---|---|
| P6.2 canary — carried the F10 defect | `UBfNGfli8E0UfiNa` | **archived** (confirmed: MCP refuses it as archived) |
| Current canary | `S24se5SYf5CJ0FIQ` | live, `active: false`, `availableInMCP: false`, created 04:48:54Z, never updated since |
| `[TEMP] P6.2 canary driver` | `Z8Ai31yxfkyTSRO8` | live, inactive; `Call Canary` **already rewired** to `S24se5SYf5CJ0FIQ` |

So the archive-and-redeploy this document was originally going to ask for **had already
happened**. The current canary carries the F10 fix, and driver execution **3585**
(04:49:21Z, 7 pinned cases) proves it:

| Case | Input | Result |
|---|---|---|
| A | key not hex | `SUBMISSION_KEY_INVALID` |
| B | key absent | `SUBMISSION_KEY_INVALID` |
| C | no correlation id | `CORRELATION_ID_MISSING` |
| D | envelope not an object | `ENVELOPE_MISSING` |
| E | `source: website` | `ENVELOPE_SOURCE_INVALID` |
| **F** | **the only well-formed lead** | **cleared `Validate Payload`** — reached the CRM read |
| G | forged `__internal_route`, `provenanceTrusted`, `authenticated`, bad key | `SUBMISSION_KEY_INVALID` |

**Case F is the F10 proof.** It is the same shape that returned `INVALID_PAYLOAD` at exec
3583; it now travels the full internal route as far as the CRM. **Case G is the F1 proof,**
live: caller-supplied trust flags established nothing.

### 6.1 What case F actually returned — F11

Case F did not return a structured result. It returned a **raw thrown error**:

```
Lead Intake: CRM read unavailable, lead NOT persisted. Caller got 503 retryable.
Error: Service unavailable - try again later
```

The CRM being unavailable is infrastructure, and the graph is *supposed* to have a terminal
for exactly that — `Internal Result (Infra)`, returning `{ ok: false, error_code:
'CRM_UNAVAILABLE', retryable: true }`. It never fired. The wiring explains why:

```
Read Settings ──out[0]──> Settings to Object
              └─out[1]──> IF Internal (Infra) ──true──> Internal Result (Infra)
                 ERROR                         └─false─> Respond Infra Failed
                 OUTPUT                                  └─> Stop: CRM Unavailable  (THROWS)
```

`IF Internal (Infra)` read `{{ $json.__internal }}`. **An n8n error output does not carry the
failing node's input json** — it emits an error item. So the flag was `undefined`,
`undefined === 1` is false, and the internal execution took the **public** branch: into a
`RespondToWebhook` that has nothing to respond to inside a sub-workflow, and then into a
`Stop` node that threw at the internal caller.

Three gates had this, all and only the ones fed from an error output:

| Gate | Fed from | Terminal it could never reach |
|---|---|---|
| `IF Internal (Infra)` | `Read Settings` / `Read Pipeline (Dedup)` error output | `Internal Result (Infra)` |
| `IF Internal (PipelineFailed)` | `Save to Pipeline` error output | `Internal Result (PipelineFailed)` |
| `IF Internal (MergeFailed)` | `Update Pipeline (Merge)` error output | `Internal Result (MergeFailed)` |

**Three declared terminals of the internal contract were unreachable.** Every internal
failure collapsed onto the public route and surfaced as a throw.

The success-path gates were never affected — they already read the flag by **node
reference** (`$('Receipt Gate').first().json.__internal`), which survives anything.

### 6.2 The F11 fix

All four `IF Internal (*)` terminal gates now read

```
{{ $('Internal Flag').first().json.__internal }}
```

`Internal Flag` is the single authority on internal-ness — that is what it exists for — and it
runs on **both** routes before all four gates, so the reference can never throw:

```
public  : Webhook                     -> Validate Payload -> Internal Flag -> IF Valid -> …
internal: Internal Subworkflow Trigger -> Internal Auth Entry -> … -> Validate Payload -> Internal Flag -> IF Valid -> …
```

`IF Internal (Invalid)` was not broken — it is fed from an ordinary branch, so `$json`
survived there — but it is moved to the same form. One rule, uniformly applied, is worth more
than three correct gates and one that happens to be fed differently.

### 6.3 The F11 gate — 8 checks added to `qa/internal-route-contract.test.mjs`

Verified by mutation: reverting the four gates to `$json.__internal` fails this gate with
three named failures.

| | |
|---|---|
| the premise | the three gates *are* fed only from error outputs — asserted, so the section cannot quietly stop testing anything |
| **the rule** | **no** `IF Internal` gate reads internal-ness off `$json` |
| | every gate reads it by **node reference** |
| reachability | every referenced node runs on **both** routes and is upstream of its gate, so the reference cannot throw |
| the terminals | `Infra`, `PipelineFailed`, `MergeFailed` are reachable from the internal entry |
| the routing | TRUE → an internal terminal, FALSE → the public responder, for all four |
| F4 restated | no internal terminal is a `RespondToWebhook` |
| the regression | an error item carries no `__internal`, so the `$json` form provably cannot take the internal branch |

---

## 7. What the owner has to do now

The canary must be redeployed **again** — `S24se5SYf5CJ0FIQ` carries F10's fix but not F11's.

```powershell
# 1. Archive S24se5SYf5CJ0FIQ in the n8n UI (archive, do NOT delete).

# 2. Fresh, narrowly scoped key; this session only; revoked afterwards.
$env:N8N_BASE_URL    = 'https://ghennadi.app.n8n.cloud'
$env:N8N_FIX_API_KEY = '<the fresh key>'

# 3. Dry run — writes nothing. It should report BOTH archived canaries as retained
#    and pass the "no LIVE workflow with the canary name" check.
pwsh scripts/deploy-b21c-canary.ps1 -DryRun

# 4. Deploy.
pwsh scripts/deploy-b21c-canary.ps1 -Deploy      # prints the new workflow id

# 5. Prove the deployed graph IS the artifact — fetch the definition, then:
node scripts/verify-live-canary-fidelity.mjs <live-definition.json>

# 6. Repoint the driver Z8Ai31yxfkyTSRO8 → 'Call Canary' → the new id.
#    (Its DESCRIPTION still names UBfNGfli8E0UfiNa and is stale; the wire is what matters.)

# 7. Re-run the driver and confirm case F now returns a STRUCTURED result.
# 8. Revoke the key.
```

**What to expect from case F on the next run.** F11 is fixed, but the CRM was genuinely
unavailable at 04:49Z. If it still is, case F should now return

```json
{ "ok": false, "error_code": "CRM_UNAVAILABLE", "retryable": true }
```

**instead of throwing.** That is the F11 proof. If the CRM has recovered, case F should
instead run to a receipt terminal (`NEW`) — which would be the first end-to-end internal
success and unblocks P6 step 4. Either outcome is a pass for F11; only a **throw** is a
failure.

---

## 8. Gate status

```
14/14 gates passed
TOTAL ASSERTIONS: 753        (732 + 21)
assertion floors: PASS
```

Both projections (`IMPORT-SAFE`, `API-IMPORT`) were regenerated from the corrected candidate
and reproduce byte-for-byte on rebuild.

---

## 9. The lesson, twice

**Wiring is not a contract.** F10 was an assumption about the *shape* crossing a seam. F11 was
an assumption about what survives an *error output* — the same mistake one layer down, and it
had been sitting behind three unreachable terminals that every offline gate reported as
present and correctly wired.

Both were found by **executing** the route, not by reading it. Presence is not reachability,
and reachability is not reached. Every seam where generated code meets inherited production
behaviour now has to be proven by execution offline — because the alternative, as P6.2 and
P6.3 both demonstrated, is that a live run discovers it.
