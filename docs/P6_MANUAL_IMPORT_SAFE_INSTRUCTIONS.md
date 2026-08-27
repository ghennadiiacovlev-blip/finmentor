# FINMENTOR — P6 manual import: the SAFE IMPORT artifact

**Phase:** B.2.1-C live prerequisites, P6.1
**Audience:** the repository owner, performing one manual import in the n8n UI
**Status:** repo-only. Nothing in this document has been executed against live n8n.

> **There are now two deployment routes.** This document is the **UI route** — no credential
> needed, five eyeball checks, you click Import. The **API route**
> (`docs/P6_2_API_IMPORT_DEPLOY.md`) posts the graph verbatim from disk over the n8n REST API
> and asserts the same properties mechanically, before *and* after the write, instead of by
> eye; it needs a freshly issued write-scoped key. Either is valid — do **one** of them, not
> both, since each refuses to create a second workflow under the canary name.

---

## ⚠️ Import the WRAPPER, not the candidate

| | |
|---|---|
| **IMPORT THIS** | `n8n/candidate/lead-intake-internal-receipt-IMPORT-SAFE.json` |
| **DO NOT IMPORT** | `n8n/candidate/lead-intake-internal-receipt-candidate.json` |

**Why the second one is dangerous.** The canonical candidate is a faithful derivative of the
live production export — that faithfulness is exactly what makes its 57 inherited nodes
auditable against production — and it therefore still carries:

- `id = QmIyEW2ZEqKregmN` — **the live Lead Intake workflow's own id**
- `active = true`
- a `Webhook` node on **`finmentor-lead-intake`**, the live public POST endpoint
- an `activeVersion` block containing a **second full copy of the graph**, including a second
  copy of that webhook, still on the production path
- a `shared` block carrying the workflow id, the project id, a creator id and the owner's name
  and email

Importing it by hand could collide with, or shadow, the live workflow and its public endpoint.
It is the audit anchor, not a deployment artifact.

The IMPORT-SAFE file is a **deployment wrapper**: the same graph, with the identity and
lifecycle stripped and the public webhook neutered. **No node parameter, no Code body, no
connection and no credential reference differs from the canonical candidate**, apart from the
public webhook's own `path`, `disabled` and `webhookId`. That is machine-checked — see
[Appendix A](#appendix-a--what-the-gate-proves).

---

## Steps

1. **Open n8n** (`https://ghennadi.app.n8n.cloud`).
2. **Create a NEW blank workflow.** Do not open, and do not overwrite, any existing workflow —
   in particular not `FINMENTOR Lead Intake PREMIUM FINAL`.
3. Use **Import from File** (workflow menu ⋯ → *Import from File…*).
4. Select:

   ```
   n8n/candidate/lead-intake-internal-receipt-IMPORT-SAFE.json
   ```

5. **BEFORE saving, verify all five by eye:**

   | # | Check | Expected |
   |---|---|---|
   | 1 | Workflow name | contains **`INTERNAL B21C RECEIPT CANARY`** |
   | 2 | Active toggle | **INACTIVE** |
   | 3 | `Webhook` node | **disabled** (greyed out, struck through) |
   | 4 | `Webhook` node path | **`__disabled_b21c_internal_candidate`** — **NOT** `finmentor-lead-intake` |
   | 5 | `Internal Subworkflow Trigger` node | **present** |

   **If any one of the five does not match, STOP and do not save.** Report which one. A
   mismatch means the wrong file was selected or the artifact is stale.

6. **Save.**
7. **DO NOT ACTIVATE THE WORKFLOW.** It must stay inactive. Nothing in P6 requires activation:
   the internal route is driven by the sub-workflow trigger, not by a schedule or a webhook.
8. **Return the newly assigned n8n workflow ID to Claude** — the `.../workflow/<ID>` segment in
   the browser address bar after saving.
9. Claude then resumes P6 at **candidate validation / step 4 onward** (node and expression
   validity, then the NEW / MERGE / RETRY canaries).

---

## What this workflow will do when it is exercised

Read this before step 9. These are the side effects of running the canaries, and they are the
reason P6 step 9 (downstream side-effect inventory) exists.

**On the internal route it WILL:**

- write to the **Pipeline** sheet — `Save to Pipeline` (append) and `Update Pipeline (Merge)`
  (update)
- read `Read Settings` and `Read Pipeline (Dedup)`
- perform five Data Table operations against the production **`Submission_Receipts`** table
  (`fV23lsh9uq8uFHox`)

**On the internal route it will NOT:**

- send any **Telegram** message — none of the four inherited Telegram nodes is reachable on the
  internal route
- make any **AI** call — the OpenAI node is not reachable on the internal route
- serve any **public HTTP endpoint** — the only webhook node is disabled and inert-pathed

Both of those lists are asserted by `qa/import-safe.test.mjs`, using a branch-aware walk of the
graph. This matters: a naive reachability check that follows *both* outputs of every `IF` gate
claims the internal route reaches all four Telegram nodes and the AI node. It does not — every
alert path sits behind an `IF Internal (*)` gate that the internal route does not take.

### One thing that is NOT neutralised, deliberately

`settings.errorWorkflow` is still **`RBiFLhVjizMkAzrK`** — the live **FINMENTOR Error Monitor**.
It was left exactly as the canonical candidate has it, because changing a setting would be a
semantic change to a graph that is supposed to stay byte-faithful.

**Consequence:** if a canary run *fails*, the production Error Monitor fires and you will get a
Telegram alert about it. That is an owner-facing alert on your own monitoring channel, not a
customer-facing message — but it will look like a production incident, so expect it.

If you would rather it did not fire, clear the **Settings → Error Workflow** field **in the n8n
UI after import**, on the imported canary only. Do not change it in the repo artifact.

---

## Appendix A — what the gate proves

`qa/import-safe.test.mjs`, 43 checks, run by `node qa/run-all.mjs`.

**The hazards are real** — it asserts the canonical candidate *still carries* the production id,
`active: true`, the live webhook path, the shadow `activeVersion` copy and the `shared` record.
If those ever disappear upstream, this wrapper's premise has changed and the gate fails loudly
rather than passing vacuously.

**The wrapper is safe** — production id absent from the entire file; every stripped top-level
field absent; `active: false`; `isArchived: false`; unique canary name; webhook disabled,
inert-pathed and stripped of its inherited `webhookId`; the production path absent from the
runtime graph; `availableInMCP: false`; no new node, no new Telegram node, no new endpoint.

**The graph is untouched** — all 44 Code bodies byte-identical (98,890 characters total);
connections byte-identical; every non-webhook node byte-identical; every credential reference
unchanged.

**Nothing else changed** — the closure check. It computes the *complete* set of paths at which
the two documents differ and requires that set to equal the approved transformation exactly. A
single altered byte anywhere in 425 KB shows up here.

**The internal route stands alone** — with the webhook node removed from the graph entirely (not
merely disabled), `Internal Auth Entry` is still reachable, all eleven `Internal Result (*)`
terminals are still reachable, and **no** `RespondToWebhook` node is. That last point is also
proven structurally: every one of the seven responders is fed *only* from the false branch of an
`IF Internal (*)` gate, so the property holds by construction and survives future edits.

**The verifier can fail** — sixteen mutation tests, each a deliberately corrupted wrapper that
must be rejected: production id restored; `active: true`; production path restored; webhook
re-enabled; one byte of a Code body changed; one connection changed; `activeVersion` restored;
`shared` restored; the id smuggled into a different top-level field; `webhookId` restored;
`availableInMCP` enabled; a credential reference swapped; a Telegram node added; a node deleted;
a responder wired in from outside a gate; the workflow renamed. Plus a control asserting the
real artifact is accepted, so the battery cannot pass by rejecting everything.

---

## Appendix B — regenerating the artifact

```
node scripts/build-lead-intake-receipt-candidate.mjs     # canonical, must be zero-diff
node scripts/build-lead-intake-receipt-import-safe.mjs   # the wrapper
node qa/run-all.mjs                                      # 12 gates
```

The generator **refuses to write** if the output does not verify, and re-reads the canonical
from disk afterwards to prove it was not modified. The gate independently checks that the
tracked wrapper is exactly what the generator produces, so a stale file cannot sit in the repo
unnoticed.

The verification does **not** work by re-running the transform and comparing — that would only
prove the transform is deterministic, and a wrong transform would pass its own check. Every
assertion reads the two documents directly.

---

## Appendix C — the exact difference

| Path | Canonical | IMPORT-SAFE |
|---|---|---|
| `id` | `QmIyEW2ZEqKregmN` | *absent* |
| `activeVersionId`, `versionId` | `7108ec2d-…` | *absent* |
| `versionCounter` | `33` | *absent* |
| `createdAt`, `updatedAt` | production timestamps | *absent* |
| `sourceWorkflowId` | `null` | *absent* |
| `triggerCount` | `1` | *absent* |
| `shared` | owner / project / creator record | *absent* |
| `activeVersion` | second full 57-node graph copy | *absent* |
| `name` | `…B21C RECEIPT CANDIDATE` | `…INTERNAL B21C RECEIPT CANARY` |
| `active` | `true` | `false` |
| `isArchived` | `false` | `false` *(set explicitly)* |
| `meta.finmentor_source_export` | `QmIyEW2ZEqKregmN.finmentor-…json` | `finmentor-…json` |
| `meta.finmentor_not_deployed` | `true` | `false` |
| `meta.finmentor_import_safe` | *absent* | `true` |
| `meta.finmentor_import_safe_generated_by` | *absent* | the generator path |
| `Webhook.disabled` | *absent* | `true` |
| `Webhook.webhookId` | `e0ce5df2-…` | *absent* |
| `Webhook.parameters.path` | `finmentor-lead-intake` | `__disabled_b21c_internal_candidate` |

**That is the complete list.** `nodes` (100), `connections`, `settings`, `nodeGroups`,
`staticData`, `tags`, `description` and every credential reference are identical.

### Two departures from the P6.1 brief, stated plainly

The brief's removal list named eight top-level fields. Reading the file first — as the brief
instructed — turned up two more identity carriers it did not name, `shared` and `activeVersion`,
plus a production id embedded in `meta`. All three are removed or rewritten here, and each extra
difference is declared in the approved-diff list and asserted exactly, so the extension is
visible rather than silent.

The brief also said to preserve `settings`. It is preserved verbatim — including the
`errorWorkflow` pointer to the live Error Monitor, whose consequence is described above rather
than quietly engineered away.
