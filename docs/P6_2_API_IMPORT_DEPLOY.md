# FINMENTOR — P6.2 REST-API deployment of the B21C receipt canary

**Phase:** B.2.1-C live prerequisites, P6.2
**Audience:** the repository owner
**Status:** repo-only. Nothing in this document has been executed against live n8n. No
credential has been sought, read, printed or used.

---

## Why this exists

P6 has been blocked at one step — deploying the audited 100-node candidate — since 2026-08-26.
The MCP surface cannot do it:

| Path | Why it fails |
|---|---|
| `create_workflow_from_code` | takes **SDK source**, not workflow JSON |
| `update_workflow` + `addNode` | **no bulk-JSON operation**, and a hard cap of **100 operations per call** against the ~210 this graph needs — so it cannot even be applied atomically |
| JSON import | **no such tool on the MCP surface** |

Both surviving paths mean re-expressing **98,890 characters of production Code bodies** through
a transcription step. That is precisely the fidelity risk the deterministic generator exists to
eliminate, and a single silent character difference in a Code body is not detectable by any
check available here. So it was not done.

**The n8n public REST API has the capability the MCP surface lacks.** `POST /api/v1/workflows`
accepts a workflow JSON body, so the file can be sent **verbatim from disk** — the graph never
passes through a transcription step at all. This is strictly safer than the UI import as well:
no human has to eyeball five properties correctly at the moment of the write, because the
script asserts them before *and* after.

---

## What you need to do

### 1. Issue a fresh API key

`scripts/n8n-lib.ps1` is explicit, and it governs here: the two historical keys are scheduled
for revocation, and **B.2.1-C live work requires a freshly issued key, scoped as narrowly as
the task allows, revoked again afterwards.** Do not reinstate an old key to make this run.

The key needs **workflow write** scope. Nothing else.

### 2. Set the environment — this session only

```powershell
$env:N8N_BASE_URL    = 'https://ghennadi.app.n8n.cloud'
$env:N8N_FIX_API_KEY = '<the fresh key>'
```

No key value is stored in this repository, and none may ever be. These are read from the
environment only, and the scripts never print them.

### 3. Dry run first — it writes nothing

```powershell
pwsh scripts/deploy-b21c-canary.ps1 -DryRun
```

Every preflight runs, including the reads against live n8n, and the script exits before the
POST. Confirm it reaches `DRY RUN — preflight passed, nothing was written.`

### 4. Deploy

```powershell
pwsh scripts/deploy-b21c-canary.ps1 -Deploy
```

On success it prints the new workflow id. **Give that id to Claude to resume P6 at step 4.**

### 5. Revoke the key

As soon as P6 finishes. The key is not needed between runs.

---

## What the script refuses to do

It aborts, before writing anything, if:

- the offline gate `qa/api-import.test.mjs` does not pass — it will not deploy an unverified artifact
- the artifact contains the production workflow id or the production webhook path
- the artifact does not carry exactly the four API-accepted top-level fields
- the node count is not 100, the name is not the canary name, or `availableInMCP` is not false
- **a workflow with the canary name already exists** — it will not create a second
- write credentials are absent

It **never** activates the workflow, **never** enables `availableInMCP`, **never** touches the
production Lead Intake workflow, and **never** posts the canonical audited candidate.

---

## The one guarantee the artifact cannot carry

This is the part worth reading slowly.

The UI wrapper says `active: false` explicitly. The API projection **cannot**: the endpoint
rejects `active` as an additional property. So inactivity stops being a property of the file
and becomes a property of **the server's default for newly created workflows** — something this
repository cannot assert offline and must not assume.

That is not hand-waved. It is converted into an obligation the script discharges **after** the
write, by reading the created workflow back:

| # | Post-deploy assertion | Why it cannot be checked offline |
|---|---|---|
| 1 | `active === false` | the artifact cannot carry `active` |
| 2 | `name` is the canary name | confirms the server stored what was sent |
| 3 | `nodes.length === 100` | confirms nothing was dropped in transit |
| 4 | the `Webhook` node is `disabled: true` | confirms the server preserved node-level state |
| 5 | the `Webhook` path is `__disabled_b21c_internal_candidate` | — |
| 6 | `finmentor-lead-intake` absent from the stored definition | the endpoint must not have re-derived a path |
| 7 | `settings.availableInMCP === false` | confirms the server accepted the setting |

**If the workflow comes back ACTIVE, the script deactivates it immediately, re-reads to confirm,
and still exits non-zero.** Reporting a problem while leaving an active workflow behind would be
the worst possible outcome, so "detect" and "remediate" are not separated here. If deactivation
itself fails, the script says `DEACTIVATE IT BY HAND NOW` with the id.

It also fingerprints the production Lead Intake workflow before and after the run and fails if
the structural hash changed.

---

## What the projection drops, and why each drop is safe

The wrapper carries eleven top-level fields; the endpoint accepts four. The seven dropped
fields are asserted, by value, not merely by name — dropping `tags: []` costs nothing, but
dropping a *populated* `tags` would silently lose state.

| Dropped | Value in the wrapper | Consequence |
|---|---|---|
| `description` | `null` | none |
| `isArchived` | `false` | none |
| `nodeGroups` | `[]` | none |
| `staticData` | `null` | none |
| `tags` | `[]` | none |
| `active` | `false` | **not inert** — enforced post-deploy, above |
| `meta` | provenance markers | **real loss**, below |

### The one real loss: `meta`

The wrapper's provenance markers — `finmentor_import_safe`, `finmentor_generated_by`, the
source-export filename — do not survive the projection. **The deployed workflow therefore
carries no in-band provenance.** The operative identifier is the **name**, which does survive
and is asserted both offline and post-deploy.

This is stated rather than engineered around because the alternative — smuggling provenance
into `settings`, the one accepted field that would hold it — would be a semantic change to a
graph that is supposed to stay byte-faithful.

### And what is deliberately NOT changed

`settings.errorWorkflow` is still `RBiFLhVjizMkAzrK`, the live **FINMENTOR Error Monitor**,
preserved verbatim for the same reason as in P6.1.

**Consequence:** if a canary run *fails*, the production Error Monitor fires and you get a
Telegram alert. That is an owner-facing alert on your own monitoring channel, not a
customer-facing message — but it will look like a production incident, so expect it.

---

## If the POST returns HTTP 400

That means the endpoint rejected a field, and the likely cause is a `settings` key this n8n
version does not accept (`binaryMode`, `availableInMCP`, `errorWorkflow`). The script prints the
exact message and creates nothing.

**Do not strip settings keys to force it through.** `availableInMCP: false` is a safety
property, and `errorWorkflow` is preserved deliberately. Report the message instead — the fix
is a decision, not a retry.

---

## Appendix — what the gate proves

`qa/api-import.test.mjs`, 48 checks, run by `node qa/run-all.mjs`.

**The projection is a faithful subset** — `nodes`, `connections` and `settings` byte-identical
to the wrapper; all 44 Code bodies byte-identical and asserted non-trivial (>90,000 chars, so
an empty-bodies regression cannot pass); every credential reference unchanged. Closed by an
exhaustive residual diff: the *complete* set of differing paths must equal the seven dropped
fields exactly.

**Every drop was inert** — each dropped field's value pinned, not just its name. Plus the
reverse check: the wrapper must still *carry* all seven, so "absent from the projection" cannot
pass vacuously because upstream stopped emitting them.

**The inherited safety survived** — production id and production path absent from the whole
file; exactly one webhook, disabled, inert-pathed, no `webhookId`; 100 nodes; `availableInMCP`
false; internal trigger present. The branch-aware internal-route walk is **re-run on the
projection** rather than inherited by assumption, since this is the artifact that actually gets
deployed: `Internal Auth Entry` reachable, and **no** responder and **no** Telegram node
reachable.

**The `active` obligation is real** — the gate asserts the deploy script reads the workflow back,
inspects `active`, has a deactivation path, references the API-IMPORT artifact and *not* the
canonical candidate, and contains no activate call.

**The verifier can fail** — fifteen mutation tests, each a deliberately corrupted projection
that must be rejected: production id restored; `active` smuggled back; a rejected field left in
place; an unknown extra field; production path restored; webhook re-enabled; `webhookId`
restored; one byte of a Code body changed; one connection changed; a node deleted; a Telegram
node added; `availableInMCP` enabled; renamed; internal trigger removed; **and the canonical
candidate offered as the input wrapper** — the single mistake that would put the production
identity and the live endpoint into a create call. Plus a control asserting the real artifact
is accepted, so the battery cannot pass by rejecting everything.

---

## Appendix — regenerating

```
node scripts/build-lead-intake-receipt-candidate.mjs     # canonical, must be zero-diff
node scripts/build-lead-intake-receipt-import-safe.mjs   # the UI wrapper
node scripts/build-lead-intake-receipt-api-import.mjs    # the API projection
node qa/run-all.mjs                                      # 13 gates
```

The generator refuses to write unless the output verifies, refuses to build at all unless its
input really is the IMPORT-SAFE wrapper, and re-reads that wrapper from disk afterwards to
prove it was not modified. Verification does **not** work by re-running the transform — that
would only prove determinism, and a wrong transform would pass its own check.

---

## The UI route is still available

`docs/P6_MANUAL_IMPORT_SAFE_INSTRUCTIONS.md` remains valid and needs no credential. Use it if
you would rather not issue a key. Import the **wrapper**
(`lead-intake-internal-receipt-IMPORT-SAFE.json`), not the API projection — the projection has
no `active: false` field, and the UI would not show you the five eyeball checks the wrapper is
built for.
