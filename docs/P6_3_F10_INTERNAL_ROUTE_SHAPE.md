# FINMENTOR — P6.3 / F10: the internal route could not accept a lead

**Phase:** B.2.1-C live prerequisites, P6.3
**Status:** repo-only. The corrected candidate is built and gated offline. **It is not deployed.**
The live canary created in P6.2 still carries the defect and must be superseded — §6.
**Severity:** total functional failure of the internal route, contained to a disabled canary.
**Found:** live, 2026-08-27, during the first real execution of the P6.2 canary (exec `3583`).

---

## 1. What happened

P6.2 deployed the audited 100-node candidate through the REST API and ran it for the first
time. Every internal submission carrying a **perfectly valid lead** came back:

```
INVALID_PAYLOAD — "Body must be a JSON object"
```

Not an edge case. The internal route could not accept **any** lead, so `NEW`, `MERGE` and
`RETRY` were not merely untested — they were **unreachable in every case**.

## 2. The cause, in two lines

| Node | |
|---|---|
| `Internal Envelope Unwrap` (generated) | emitted `{ source, payload }` |
| `Validate Payload` (**inherited production**) | reads `raw.body` / `raw.headers` |

`Validate Payload` looked for a body, found none, and correctly rejected the request. The
graph was wired exactly as designed; the design was built on a false statement about a node
nobody here wrote.

## 3. Where the false statement lived

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

## 4. Why 732 offline assertions did not catch it

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

## 5. What changed

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

### 5.2 The new gate — `qa/internal-route-contract.test.mjs` (13 checks)

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

## 6. What the owner has to do — the live canary is still wrong

**The canary deployed in P6.2 carries the defect.** It is disabled and inert, so nothing is
at risk, but it cannot validate anything and must be superseded before P6 resumes.

```powershell
# 1. Archive the defective canary in the n8n UI (archive, do NOT delete — keep the record).

# 2. Fresh, narrowly scoped key; this session only; revoked afterwards.
$env:N8N_BASE_URL    = 'https://ghennadi.app.n8n.cloud'
$env:N8N_FIX_API_KEY = '<the fresh key>'

# 3. Dry run — writes nothing. It should now report the archived canary as retained,
#    and pass the "no LIVE workflow with the canary name" check.
pwsh scripts/deploy-b21c-canary.ps1 -DryRun

# 4. Deploy the corrected candidate.
pwsh scripts/deploy-b21c-canary.ps1 -Deploy      # prints the new workflow id

# 5. Prove the deployed graph IS the artifact — fetch the definition, then:
node scripts/verify-live-canary-fidelity.mjs <live-definition.json>

# 6. Revoke the key.
```

Then hand the new id back to resume P6 at step 4 — the first internal execution that is now
expected to **succeed**, which is what exec `3583` was supposed to be.

---

## 7. Gate status

```
14/14 gates passed
TOTAL ASSERTIONS: 745        (732 + 13)
assertion floors: PASS
```

Both projections (`IMPORT-SAFE`, `API-IMPORT`) were regenerated from the corrected candidate
and reproduce byte-for-byte on rebuild.

---

## 8. The one-line lesson

**Wiring is not a contract.** Every seam where generated code meets inherited production code
has to be proven by execution offline — because the alternative, as P6.2 demonstrated, is
that a live run discovers it.
