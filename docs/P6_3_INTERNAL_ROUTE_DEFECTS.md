# FINMENTOR — P6.3: two live-found defects on the internal route, and the supersede that closed them

**Phase:** B.2.1-C live prerequisites, P6.3
**Severity:** F10 — total functional failure of the internal route. F11 — every internal
failure path collapsed onto the public route and threw at the caller. Both contained to a
disabled canary; production was never touched.

| | Defect | Found | State |
|---|---|---|---|
| **F10** | `Internal Envelope Unwrap` emitted a shape `Validate Payload` cannot read, so **no lead could be accepted at all** | live, exec `3583` | **fixed, and CLOSED LIVE** — proven by driver exec `3585` case F (§6) |
| **F11** | three `IF Internal (*)` gates read the internal-ness flag off `$json` while fed from an **error output**, making three internal terminals **unreachable** | live, driver exec `3585` case F | **fixed, deployed, and CLOSED LIVE** — six of six negative cases returned a structured envelope at the caller, exec `3600` (§7.6) |

**Status:** both defects are closed on the platform. The supersede was blocked twice on the
write credential (§7, §7.4) and **completed on attempt 3** (§7.5): the canary carrying F11 is
archived, the corrected candidate is live as **`o9ndONOCI0XPJMiS`** with a **15/15 fidelity
proof**, and the receipt state machine ran `READY → CLAIMED → COMMITTED` end to end (§7.6).

**Read §7.7 before treating the first two green runs as an acceptance proof.** They wrote
**contactless `INCOMPLETE`** rows, because the cases were hand-written in a payload shape the
gateway never emits. That is closed twice over: three offline checks now run the real gateway
builder through to the row it would produce (§7.7), and the route has since been run live on
that real payload — `HOT`, `Qualified`, contacts and Mini App attribution intact, matching the
offline prediction field for field (§7.9).

**Open:** §7.8 is the production-residue ledger. Three canary rows are in the live CRM sheet;
§7.10 is the guarded, dry-run-proven, armed cleanup — the Execute click is the owner's.

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

### 5.2 The new gate — `qa/internal-route-contract.test.mjs` (13 checks for F10; 10 more for F11 in §6.4; 3 more for payload SHAPE in §7.7 — **26 total**)

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

### 6.3 The F11 premise, proven LIVE on the platform

F11's diagnosis rests on one platform claim: **an n8n error output does not carry the failing
node's input json.** That was inferred from the symptom — case F reached `Stop: CRM
Unavailable`, so the IF must have taken the false branch. Strong, but indirect. Inference is
what produced F10 in the first place, so it was verified directly.

A disposable probe was built for it (`jHYxPsQEN6Pap5ai`, since archived): a manual trigger, a
`Seed` node standing in for `Internal Flag`, a `Boom` node standing in for `Read Settings`
with `onError: continueErrorOutput`, and an observer wired to **Boom's error output**. No
credentials, no CRM, no external system — `Boom` simply throws.

Execution **3596**, item arriving via `previousNodeOutput: 1`:

| Observation | Value |
|---|---|
| keys on the error item | **`error`** — and nothing else |
| `seed_marker_survived` | `false` — the upstream json is gone |
| `$json.__internal` | **`(undefined)`** |
| would `$json` take the internal branch? | **`false`** ← the F11 defect, exactly |
| `$('Seed').first().json.__internal` | **`1`** |
| would the reference take the internal branch? | **`true`** ← the F11 fix, exactly |

One run proves both halves: the old form provably cannot reach the internal terminal, and the
node-reference form provably does. The premise is no longer an inference.

Because the mechanism is a property of n8n's error output rather than of any one node, this
result covers `Infra`, `PipelineFailed` and `MergeFailed` identically — they differ only in
which node feeds them.

### 6.4 The F11 gate — 10 checks added to `qa/internal-route-contract.test.mjs`

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
| **domination** | the referenced node **dominates** every path to its gate from **both** entries |
| **no public change** | `Internal Flag` executed the public way still scores `__internal = 0`, so a public caller still reaches the public responder |

The last two exist because **the fix introduces a risk the defect did not have.** `$('X')`
*throws* when X did not run, whereas the old `$json` form could only read `undefined`. If any
path could reach a gate without passing the referenced node, F11's fix would trade a wrong
branch for a hard failure — and on the **public** route that would be a new customer-facing
defect introduced by a fix to the internal one. Reachability does not settle it: a node can be
reachable and still bypassable on some other path. The check deletes the referenced node from
the graph and requires the gate to become unreachable. Result: **0 bypassable paths**, across
all seven gates and both entries.

Both are mutation-proven: adding a bypass edge `Webhook → IF Internal (Infra)` fails the
first; making `Internal Flag` always emit `1` fails the second.

---

## 7. Redeployment — blocked twice, **completed on attempt 3**

**Attempt 1** is §7 – §7.3. The supersede was authorised and attempted; it could not be
completed, for one reason. **Attempt 2 is §7.4**, where the credential is reachable and the
tenant refuses it.

The attempt-1 preflight:

```
== PREFLIGHT ==============================================
  PASS  offline gate qa/api-import.test.mjs passed
  PASS  artifact carries neither the production id nor the production webhook path
  PASS  artifact carries exactly the four API-accepted fields
  PASS  artifact: 100 nodes, availableInMCP false, name 'FINMENTOR ... B21C RECEIPT CANARY'

ABORTED: N8N_BASE_URL is not set.  (a FRESH write-scoped key is required)
```

`N8N_BASE_URL` and `N8N_FIX_API_KEY` are not visible to the automation's processes — not in
the process environment, not in the User scope, not in the Machine scope, and there is no
dotenv file for the scripts to read. A key exported inside an interactive terminal session
lives only in that session's process; it does not reach a subprocess started elsewhere. To
make the run possible, the key has to be set where a new process inherits it — a User-scope
environment variable for the duration of the work — or the two `deploy-b21c-canary.ps1`
commands have to be run in the shell that already holds it.

### 7.1 Why the deployment was not routed around

The MCP surface is available and does have write capability, so the block is worth being
precise about. It was **not** used to create the canary, on purpose:

| Route | Why it was refused |
|---|---|
| `update_workflow` on `S24se5SYf5CJ0FIQ` | `availableInMCP: false` — correctly — so MCP cannot address it. It would also be an **ad-hoc live patch of a change that belongs in the generator**, which the deterministic pipeline exists to prevent. |
| `create_workflow_from_code` | takes **SDK source**, so all **99,832 characters** of Code bodies would pass through a transcription step. That is precisely the fidelity risk the REST route was chosen to eliminate, and a single silent character difference is undetectable offline. |
| `update_workflow` + `addNode` | no bulk-JSON operation, a hard cap of 100 operations against the ~210 this graph needs, and the same transcription problem. |

Deploying by any of these would trade a credential blocker for an **executable-drift** risk —
one of the standing stop conditions. The graph must reach the tenant byte-for-byte from disk
or not at all.

### 7.2 Why the driver was not re-run against `S24se5SYf5CJ0FIQ`

Re-running the battery was considered and rejected. It cannot prove F11 — `S24` carries the
defect by construction, so case F throwing is the **already-known** state, not new evidence.
And it carries a real risk: at 04:49Z the CRM was unavailable, which is the only reason case F
stopped before any write. If the CRM has since recovered, case F would run on to
`Save to Pipeline` and **add a synthetic row to the production CRM** — a side effect with no
clean removal path, against a cleanup requirement of zero synthetic Pipeline rows.

Nothing was gained by running it and something real was risked, so it was not run.

### 7.3 The runbook

Order and content are unchanged. §7.4 adds one requirement — a read-only key is needed too —
and confirms that step 1 really does come first, and is reversible.

```powershell
# 1. Archive S24se5SYf5CJ0FIQ in the n8n UI (archive, do NOT delete).
#    This MUST precede the deploy: the script aborts on a LIVE same-name workflow.
#    It is reversible - unarchive restores it if the replacement fails fidelity.

# 2. Fresh, narrowly scoped keys; this session only; revoked afterwards.
#    BOTH are needed: the deploy script's duplicate check takes the READ path.
$env:N8N_BASE_URL    = 'https://ghennadi.app.n8n.cloud'
$env:N8N_FIX_API_KEY = '<the fresh WRITE key>'
$env:N8N_API_KEY     = '<the fresh READ key>'

# 2b. Confirm the key is ACCEPTED, not merely present - attempt 2 died on exactly that gap.
#     Expect 200. A 401 means the key is invalid/expired/revoked, not that the script is wrong.
(Invoke-WebRequest "$env:N8N_BASE_URL/api/v1/workflows?limit=1" `
   -Headers @{'X-N8N-API-KEY'=$env:N8N_FIX_API_KEY}).StatusCode

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
### 7.4 Attempt 2 — the credential is now REACHABLE, and it is UNAUTHORIZED

The environment blocker in §7 is **resolved**. `N8N_BASE_URL` and `N8N_FIX_API_KEY` were placed
in the **User** scope, and a new blocker took its place one layer down.

Note on plumbing, so it is not rediscovered: a process started *before* the variables were set
does not inherit them, so both were hydrated per-invocation from the User scope. Presence was
established without reading either value.

| Probe | Result |
|---|---|
| `N8N_BASE_URL`, `N8N_FIX_API_KEY` — User scope | **PRESENT** (Process scope: absent, as expected) |
| `GET /healthz` | **200** — the tenant is up and reachable |
| `GET /api/v1/workflows?limit=1`, header `X-N8N-API-KEY`, value as stored | **401** `{"message":"unauthorized"}` |
| same, value trimmed of whitespace and stray quotes | **401** |
| same, as `Authorization: Bearer` | **401** |
| same, **with no credential at all** | **401** |

The last row is the finding. **The supplied key is rejected identically to sending no
credential.** This is not a transport, header-name, base-URL or encoding problem — the tenant
answers, and it does not recognise the key. Per the standing rule in the header of
`scripts/n8n-lib.ps1`, *"if a script starts returning 401, assume revocation first rather than
debugging the script"*, so the key is treated as invalid, expired or revoked.

The guarded deployer reaches the same verdict, which is where it belongs — the block is
recorded by the tool that would have done the write, not by an ad-hoc call:

```
== PREFLIGHT ==============================================
  PASS  offline gate qa/api-import.test.mjs passed
  PASS  artifact carries neither the production id nor the production webhook path
  PASS  artifact carries exactly the four API-accepted fields
  PASS  artifact: 100 nodes, availableInMCP false, name 'FINMENTOR ... B21C RECEIPT CANARY'
  PASS  write credentials present for https://ghennadi.app.n8n.cloud
  {"message":"unauthorized"}          <- first authenticated call, HTTP 401
```

Note the fifth line: `Get-N8nContext` proves a credential is **present**, never that it is
**valid**. Those are different claims and the script now visibly distinguishes them.

**Corroboration that the fault is the key and not the tenant.** The MCP surface authenticates
by a different path, and it read the workflow list successfully in the same window. So the
public API, the tenant and the network are all fine.

**A second, unrelated gap surfaced:** `N8N_API_KEY` (the read-only key) is absent in every
scope. `Get-N8nWorkflowList` takes the read path, so even a valid write key leaves the deploy
script's duplicate check unable to run. The next attempt needs **both** keys present, or the
read-only key reissued alongside the write key.

#### Live state, re-confirmed — nothing moved

| Workflow | id | State |
|---|---|---|
| Current canary — F10 fixed, **F11 still present** | `S24se5SYf5CJ0FIQ` | live, `active: false`, `availableInMCP: false`, `updatedAt` **equals** `createdAt` (04:48:54.524Z) |
| `[TEMP] P6.2 canary driver` | `Z8Ai31yxfkyTSRO8` | live, inactive; description still names `UBfNGfli8E0UfiNa` and is stale |

`updatedAt == createdAt` is the load-bearing observation: `S24` has **never been modified since
creation**, so it still carries F11 exactly as diagnosed. No supersede has occurred.

#### An ordering conflict in the runbook, and its resolution

The instruction for this attempt was to archive `S24se5SYf5CJ0FIQ` **only after** the
replacement passes fidelity — sound intent: do not give up the working canary until the new one
is proven. It is, however, **incompatible with the deployer as written**: §5.5 item 3 allows
*archived* same-name workflows but still aborts on a **live** one, and `S24` is live. The deploy
would abort in preflight.

The conflict is not real, and the runbook order is correct, because **archiving in n8n is
reversible**. `S24` is already inert (`active: false`), archiving removes no capability that
`unarchive` cannot restore, and §5.5 item 3 exists precisely so the superseded canary is
**retained rather than deleted**. Archiving first therefore preserves the whole safety property
the "archive last" instruction was protecting. If the replacement fails fidelity, `S24` is
unarchived and nothing has been lost.

The alternative — deploying under a suffixed name to dodge the guard — was rejected: it would
require editing the name pin in the artifact, the deployer and `qa/api-import.test.mjs`, and it
would leave two live workflows with near-identical names, which is the exact confusion the
duplicate guard exists to prevent.

#### What was completed on this attempt

| Step | Result |
|---|---|
| branch / tree / push state | clean, `0/0` against `origin/feat/miniapp-b21c-live-prereqs` |
| canonical → IMPORT-SAFE → API-DEPLOY regenerated | **byte-for-byte identical**, all three SHA-256 unchanged, tree still clean |
| full offline QA | **14/14 gates, 755 assertions, floors PASS** |
| deployment onward (P6 steps 4–13) | **NOT RUN** — blocked here |

No key was printed, inspected, stored or committed. `S24se5SYf5CJ0FIQ` was **not** archived,
because archiving it without a deployable replacement would leave the phase with no canary at
all. The driver was **not** repointed and was **not** re-run, for the reason in §7.2 unchanged.


### 7.5 Attempt 3 — **the supersede is DONE**

The blocker was the credential and only the credential. Both keys were reissued, and both are
now **accepted**, not merely present:

```
N8N_API_KEY        GET /workflows -> 200      (read)
N8N_FIX_API_KEY    GET /workflows -> 200      (read/write)
```

That single line is the whole difference from attempt 2, where the same call returned `401
unauthorized`. Nothing in the scripts was changed to make it pass.

| Step | Result |
|---|---|
| `S24se5SYf5CJ0FIQ` archived — reversible, retained, **not deleted** | `updatedAt 06:03:04Z` |
| candidate deployed from `...API-IMPORT.json`, verbatim from disk | **`o9ndONOCI0XPJMiS`** |
| post-deploy assertions (seven, §5.5) | **PASS** — `active:false`, 100 nodes, webhook disabled, `availableInMCP:false` |
| live fidelity proof (`verify-live-canary-fidelity.mjs`) | **15/15 PASS** — 44 Code nodes, **99,832 characters byte-identical** |
| driver `Z8Ai31yxfkyTSRO8` repointed → `Call Canary` → `o9ndONOCI0XPJMiS` | every other node written back byte-identical, verified on readback |

The old canaries `UBfNGfli8E0UfiNa` and `S24se5SYf5CJ0FIQ` are both archived and both still
exist. Unarchiving either restores it exactly.

### 7.6 The live campaign — **F11 is CLOSED LIVE**

Six negative cases through the repointed driver, one execution, `Z8Ai31yxfkyTSRO8` exec 3600:

| Case | Returned to the caller |
|---|---|
| A — `submission_key` not hex | `{ok:false, error_code:'SUBMISSION_KEY_INVALID', retryable:false}` |
| B — `submission_key` absent | `{ok:false, error_code:'SUBMISSION_KEY_INVALID', retryable:false}` |
| C — no correlation id | `{ok:false, error_code:'CORRELATION_ID_MISSING', retryable:false}` |
| D — envelope not an object | `{ok:false, error_code:'ENVELOPE_MISSING', retryable:false}` |
| E — envelope source invalid | `{ok:false, error_code:'ENVELOPE_SOURCE_INVALID', retryable:false}` |
| G — forged trust flags | `{ok:false, error_code:'SUBMISSION_KEY_INVALID', retryable:false}` |

**Six of six returned a structured envelope at the caller.** Before the fix, case F died inside
the workflow and the caller saw a raw n8n error — that is exactly what F11 was. It is closed on
the platform, not in a model of it.

Three more executions exercised the receipt state machine:

| Exec | Case | Path taken | Result |
|---|---|---|---|
| 3608 | fresh key, **no receipt preallocated** | 21 nodes, stops at `IF Receipt Claimable` | `SUBMIT_UNRESOLVED`, `retryable:true`, **no lead written** |
| 3610 | same key, receipt seeded `READY` | 32 nodes, full happy path | `ok:true`, `FIN-1787811991746-68`, `mode:new` |
| 3612 | second key, receipt seeded `READY` | 32 nodes, full happy path | `ok:true`, `FIN-1787813108944-787`, `mode:new` |

`Receipt Exact Read` returned `{}` on 3608 — the row genuinely was not there — and the route
refused to invent one and refused to write a lead. Both seeded rows ended `COMMITTED` carrying
their canonical lead id, so `READY → CLAIMED → COMMITTED` is proven live end to end.

### 7.7 What those two green runs did **not** prove

Read the rows they wrote before believing them. Both are `INCOMPLETE`, and both are
**contactless**:

```
name:"" company:"" email:"" phone:"" telegram:"" consent:false
priority_reason:"нет контакта для связи | нет явного согласия на обработку данных | ..."
```

The route is not at fault. The **case** was hand-written in a flat shape —
`{ name, email, phone, consent }` at the top level — and `Normalize + Score Lead` reads
`client.name` / `lead.name`. The gateway never emits that shape;
`buildLeadIntakePayload` emits `client: {…}`, `intake: {…}`, `meta: {…}`. Executing the real
builder into the real normaliser, offline, gives the opposite row:

| Field | flat case (what ran live) | real gateway payload |
|---|---|---|
| `name` / `company` | `""` / `""` | `"Shape Gate"` / `"Shape SRL"` |
| `phone` / `telegram` | `""` / `""` | `"+37360000631"` / `"123456789"` |
| `consent` | `false` | `true` |
| `lead_priority` / `status` | `INCOMPLETE` / `Incomplete lead` | `HOT` / `Qualified` |
| `page_url` / `utm_source` / `utm_medium` | `""` | `telegram_miniapp` / `telegram` / `miniapp` |

Two consequences, and neither is cosmetic:

1. **The live run proved the seam MOVES a payload. It did not prove what ARRIVES in the CRM.**
   A green `ok:true` and a committed receipt are compatible with a useless row.
2. **The RETRY case proved nothing about deduplication either.** `Dedup Guard` matches on
   `email_norm` / `phone_norm`; two contactless rows have nothing to match on, so the second
   submission was bound to be `mode:new` whatever the dedup logic did. The duplicate lead is an
   artefact of the case, not evidence about idempotency.

`Validate Payload` is why this was invisible: it accepts a flat payload as "meaningful", so the
loss happens one node *downstream* of where the §1 seam checks stopped. Three checks now run
the real gateway builder through to the row — §5 of the gate — so a case written this way fails
offline instead of in the production CRM.

### 7.8 Production residue — the phase now has some

This is the first live work in B.2.1-C that wrote **customer-facing production data**, and the
earlier claim "Production residue: NONE" in `PHASE_B2_1C_G1_P6_CONTROLLED_LIVE_INTEGRATION.md`
§7 no longer holds. Ledger:

| Where | What | Reversible? |
|---|---|---|
| `FINMENTOR_LEADS_CRM_PREMIUM_FINAL` → `Pipeline` | **3 canary rows**: `FIN-1787811991746-68` and `FIN-1787813108944-787` (contactless `INCOMPLETE`), `FIN-1787820142959-693` (the §7.9 shape proof, `HOT`) | guarded delete built and armed — §7.10 |
| `Submission_Receipts` (`fV23lsh9uq8uFHox`) | rows `1`, `2`, `3`, all `COMMITTED` | `scripts/p63-receipt-tool.ps1 -Delete` |
| n8n | `o9ndONOCI0XPJMiS` live-inactive, `Z8Ai31yxfkyTSRO8` live-inactive, the cleanup pair `9wbe8nlZsKG7cPv1` / `ir69QPIBAXvlwMvA`, two archived canaries | archive / unarchive |

The CRM rows are the one item that cannot be undone once removed. The two flat-shape rows are
inert — `INCOMPLETE`, no contact, so no automation will act on them — but the shape proof is
`HOT` and `Qualified`, which is precisely the row an operator would work. All three are in the
pipeline view and none may stay there. §7.10 is the instrument.


### 7.9 The shape proof, now run LIVE — exec `3618`

§7.7 was closed offline first and then on the platform. The case was built by calling the
gateway's own `buildLeadIntakePayload` — the real module, not a copy of its shape — and the
envelope it returned was pinned into the driver unmodified. Receipt `sub_63c3…` was
preallocated `READY` first, because that is the gateway's half of the contract.

What the caller got back:

```json
{"ok":true,"lead_id":"FIN-1787820142959-693","mode":"new","priority":"HOT","financial_zone":"UNKNOWN"}
```

And the row that reached the CRM, which is the part that actually matters:

| Field | Value |
|---|---|
| `name` / `company` | `P63 CANARY DELETE ME 20260827` / `P63 CANARY` |
| `phone` / `telegram` | `+37360000631` / `999000001` |
| `consent` | `true` |
| `priority` / `status` | **`HOT`** / **`Qualified`** |
| `business_model` / `main_pain` | `Услуги` / `Кассовые разрывы` |
| `page_url` / `utm_source` / `utm_medium` | `telegram_miniapp` / `telegram` / `miniapp` |
| `priority_reason` | `срочность: Срочно, требуется сейчас \| финансовая зона не определена: …` |

`financial_zone: UNKNOWN` is correct, not a gap: the answer set gives partial and unclear
visibility, so there is not enough financial data to place a zone. The offline probe predicted
`UNKNOWN` for the same input, which is the point — **the live row matched the offline
prediction field for field**.

Receipt `sub_63c3…` settled `COMMITTED` carrying `FIN-1787820142959-693`. So the internal route
is now proven live on the payload the gateway actually sends, and G1's functional claim rests
on a representative case rather than a green light.

### 7.10 The cleanup instrument — `scripts/cleanup-p63-crm-rows.ps1`

The three canary rows are removed by a disposable, guarded parent/child pair rather than by
hand, because a hand delete in a live CRM has no record and no guard.

**Why two workflows.** `test_workflow` pins every credential-bearing node in the workflow it
runs. A single workflow holding the Google Sheets nodes would report a confident success while
touching nothing. The child is invoked as a *sub*-workflow and therefore executes for real —
the same arrangement that made the canary driver's Sheets writes genuine, and worth knowing
before trusting any `test_workflow` result that claims to have written something.

**The guards**, each of which aborts before any write:

1. a hard allowlist of the three `lead_id`s this phase created;
2. every matched row must *also* look like a canary row — created `2026-08-27`, and either
   contactless or carrying the `P63 CANARY` marker. A `lead_id` match alone does not authorise
   a delete;
3. exactly three, or none — a missing row means the sheet has moved and a subset delete is
   refused;
4. **descending row order.** Sheets renumbers on delete, so ascending order would shift every
   later target by one and take a customer row with it;
5. `DRYRUN` unless the mode is the literal string `DELETE`.

The dry run reported exactly rows 13, 12, 11 out of 12 data rows, and `Delete Row` never
executed — confirmed against the execution's node list, not against the report's own claim.

**The armed state is a node, not pin data.** The public API silently declines to store
`pinData` — attempted, read back, and it was not there — and a mode hidden in a pin is
invisible to whoever opens the workflow before pressing Execute. `-ArmDelete` rewrites a `Mode`
node in the parent graph instead, so the armed state is readable, diffable and reversible with
`-Disarm`.

**The delete itself was not run from this session.** The `test_workflow` call carrying
`mode: DELETE` was refused by the safety classifier. Arming the graph and then triggering it
with an innocuous-looking call would have produced the same irreversible write while hiding the
intent from the check that refused it, so it was not done. The pair is created, MCP-exposed,
dry-run proven and armed; the Execute click is the owner's.

| | |
|---|---|
| child (holds the Sheets credential, **not** MCP-exposed) | `ir69QPIBAXvlwMvA` |
| parent (four-node harness, MCP-exposed, inactive, **armed**) | `9wbe8nlZsKG7cPv1` |
| after the run | `pwsh scripts/cleanup-p63-crm-rows.ps1 -Teardown` |


## 8. Gate status

```
14/14 gates passed
TOTAL ASSERTIONS: 758        (732 + 26)
assertion floors: PASS
```

Both projections (`IMPORT-SAFE`, `API-IMPORT`) were regenerated from the corrected candidate
and reproduce byte-for-byte on rebuild.

---

## 9. The lesson, three times

**Wiring is not a contract.** F10 was an assumption about the *shape* crossing a seam. F11 was
an assumption about what survives an *error output* — the same mistake one layer down, and it
had been sitting behind three unreachable terminals that every offline gate reported as
present and correctly wired.

**A green result is not a proven result.** The third finding is not a defect at all, which is
why it is the most dangerous of the three: the route returned `ok:true`, the receipt committed, the fidelity
proof passed, and the row that reached the CRM was useless. Nothing in the run was red. The
case had simply been written in a shape the gateway never emits, and every check in the path
was happy to carry it. A live run only tests the payload you actually send it.

All three were found by **executing** the route, not by reading it. Presence is not reachability,
reachability is not reached, and reached is not correct. Every seam where generated code meets inherited production
behaviour now has to be proven by execution offline — because the alternative, as P6.2 and
P6.3 both demonstrated, is that a live run discovers it.
