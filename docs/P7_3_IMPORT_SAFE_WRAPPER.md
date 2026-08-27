# FINMENTOR — P7.3 step 1: the import-safe wrapper, and what the endpoint takes away

**Phase:** B.2.1-C P7.3 — making the P7.2 issuer candidate deployable without deploying it.
**Status:** **WRAPPER BUILT AND PROVEN OFFLINE. NOTHING DEPLOYED.** Two artifacts exist that
did not before: a UI-import wrapper and the REST-API projection of it. The live Concierge
`mppzthlkSJFr6Kle` is untouched, still `active: true`, still 33 nodes, still with zero
references to `submission_key`.
**Production mutations: none.** No tenant call was made in this step at all.

---

## 0. Where this sits

P7.2 built the issuer and said plainly what it had not done:

> **NOT DEPLOYED, and the artifact says so:** it still carries production id
> `mppzthlkSJFr6Kle`, `active:true` and the live Telegram trigger. The import-safe wrapper is
> P7.3.

`docs/P7_2_ISSUER_SPLICE.md` §10 then ordered the remaining work: **1.** the wrapper, **2.** a live canary against a
synthetic chat, **3.** the cutover decision. This document is **step 1 only**. Step 2 has not
started, and §8 explains why step 1 changed what step 2 has to do first.

---

## 1. The hazard is not the one P6.1 solved

P6.1 built exactly this kind of wrapper for Lead Intake. The shapes rhyme — same tenant, same
export format, same `shared`/`activeVersion`/lifecycle strip list — but **the thing being
neutralised is different in kind**, and treating it as the same problem would have produced a
wrapper that looked right and was not.

| | **Lead Intake (P6.1)** | **Concierge (P7.3)** |
|---|---|---|
| Public surface | `Webhook` node on a **path** | `telegramTrigger` bound to a **bot credential** |
| Two copies claiming it | n8n's path uniqueness refuses one | Telegram accepts the second and **silently drops the first** |
| Failure mode if wrong | activation error, loud | **every client message diverts, with no error anywhere** |
| Neutralisation available | rewrite the path to an inert one | there is no path to rewrite |

The candidate's trigger carries credential `2JnVm0BIX0Z8tvBf` — *"FINMENTOR Client Concierge
Bot"*. That is not similar to the live trigger's credential; it is **byte-identical to it**, and
the gate proves that against `n8n/production/mppzthlkSJFr6Kle.*.json` rather than asserting it
in prose (check *"THE TAKEOVER PREMISE"*). Telegram permits one registered webhook per bot
token, and `setWebhook` replaces rather than rejects. So an imported copy that could be
activated is one click from taking every client message, leaving the production Concierge
running, healthy, and receiving nothing. The error monitor cannot see an absence of updates.

The candidate also inherits the **production registration id** `fa4cd08a-…-03755a0aa42d`,
verbatim from the live trigger. That is stripped.

**"Test workflow" is the same hazard.** An enabled `telegramTrigger` in test mode registers a
temporary listener against the same token. There is no safe way to point-and-click at this file
while its trigger is enabled.

---

## 2. The interlock

The wrapper's guard is **not** a neutered endpoint — there isn't one to neuter. It is a
property of the whole artifact:

> `Telegram Client Trigger` is the workflow's **only** trigger node. It is `disabled: true`.
> The wrapper therefore contains **zero enabled trigger nodes**, and a workflow with no enabled
> trigger is not an activatable workflow.

That is what `verifyImportSafe()` proves, and it is stated as *"zero enabled triggers"* rather
than *"the Telegram trigger is off"* on purpose: the property has to survive someone adding a
second entry point, not just someone flipping this one back on. Four mutation cases attack it
directly — `disabled` deleted, `disabled: false`, a second `scheduleTrigger` added, a `webhook`
node added as an alternate entry — and all four are rejected.

### 2.1 A gap in the trigger heuristic, and the check that closes it

`isTriggerType()` recognises a trigger by its type string: the `…Trigger` suffix, plus an
enumerated list of n8n trigger types whose names do **not** end that way (`webhook`, `cron`,
`interval`, `start`, `emailReadImap`, the langchain `chatTrigger`). The suffix rule alone would
have missed every one of those — a `cron` node is a trigger and reads nothing like one.

**No offline heuristic can enumerate every trigger type n8n ships or will ship.** That limit is
stated in the module rather than papered over, and it is closed for *this artifact* by a
different check: the wrapper's **per-type node census must be byte-identical** to the
candidate's, so a node of any unrecognised type cannot be added to the wrapper at all. The
heuristic guards the shape; the census guards the contents. Two mutations pin both halves — a
legacy `cron` node is caught by the interlock, and a deliberately unrecognisable type is caught
by the census. The second mutation carries an assertion that it is **not** recognised by the
heuristic, so it cannot quietly become a duplicate of the first.

---

## 3. What the wrapper does, exactly

Nineteen paths. Not "about nineteen" — the gate pins the list literally, so widening
`APPROVED_DIFF_PATHS` cannot silently widen what is accepted without a second, hand-written
edit in the test.

| Change | Paths | Why |
|---|---|---|
| Identity and lifecycle stripped | `id`, `activeVersionId`, `versionId`, `versionCounter`, `createdAt`, `updatedAt`, `sourceWorkflowId`, `triggerCount` | the P6.1 list; the tenant emits the same shape for every workflow |
| Sharing record stripped | `shared` | carries `workflowId`, `projectId`, a `creatorId` UUID and the owner's name and email |
| Distinct name, inert lifecycle | `name`, `active` | `isArchived` is set explicitly, but was already `false`, so it is not a diff |
| Provenance rewritten | `meta.finmentor_source_export`, `meta.finmentor_not_deployed`, `meta.finmentor_import_hazard`, `+3 new meta keys` | the source-export filename embeds the production id; the candidate's "NOT IMPORT-SAFE" warning must not ride on the file that **is** |
| **The trigger neutralised** | `nodes[0].disabled`, `nodes[0].webhookId` | the interlock |

`activeVersion` is in the strip list and is **not** a diff path: the candidate generator already
removed the shadow graph copy. The gate asserts it is absent from the candidate **and present in
production**, so a future re-export that reintroduced it would fail loudly rather than pass
through a strip list nobody re-read.

### 3.1 One guarantee stronger than P6.1's

P6.1 had to rewrite the webhook's `path` parameter. **This wrapper rewrites no node parameter at
all** — not one, including the trigger's own. That is asserted node-by-node in its own right
rather than left implicit in the residual diff, because it is a stronger claim and should not be
lost quietly. The only per-node paths that differ are `disabled` and `webhookId` on node 0.

---

## 4. Three things deliberately NOT done

Declared here rather than discovered later.

**1. The trigger keeps its bot credential.** Stripping it would add a second interlock, and
would break the property that makes this wrapper auditable: credentials byte-identical, node for
node, so a reader can diff wrapper against candidate and find nothing but the neutralisation. It
buys little — the only route to activation runs through a deliberate re-enable, and anyone doing
that would re-attach a credential too. **The guard is `disabled`, and it is proven; it is not the
credential's absence.** A mutation asserts this: stripping the trigger credential is *rejected*,
so the decision is enforced rather than merely explained.

**2. No live-effect surface is neutralised.** All of these still point at production, on purpose
— a wrapper that pointed them at fixtures would make the step-2 canary prove nothing:

| Surface | Count | Still points at |
|---|---|---|
| Google Sheets | 7 | `1CyZJPh…jpN5A` — live `Settings`, `Bot_Sessions`, `Bot_Events` |
| Data Table | 2 | live `Submission_Receipts` |
| `Send Lead to Intake` | 1 | the live intake endpoint, URL read from the live `Settings` sheet |
| `executeWorkflow` | 3 | live transport `ShcmmJeLSE8LYVBk` — **sends real Telegram messages** |
| `settings.errorWorkflow` | — | live Error Monitor `RBiFLhVjizMkAzrK` — **a canary fault raises a real alert** |

A check pins every one of those targets, so "unchanged" is a measured fact and not an assumption.

**3. `Answer Callback Query` keeps its inherited `webhookId`.** It is a telegram **action** node;
n8n binds no webhook for it. P6.1 made the same call for Lead Intake's four Telegram alert nodes.
The exception is not left to trust: the gate requires the set of `webhookId`-bearing nodes to be
**exactly** `["Answer Callback Query"]` and asserts that node is not a trigger type, so the
exception cannot silently grow.

---

## 5. The REST-API projection — and the part that matters

P6.2 established that the MCP surface cannot deploy a graph this size, and that
`POST /api/v1/workflows` can, but accepts only four top-level fields. The Concierge projection is
the same transform, built **from the wrapper** so it inherits the wrapper's proven properties
rather than re-deriving them from the dangerous canonical.

Seven fields are dropped. Five are inert and pinned by value (`description: null`,
`isArchived: false`, `nodeGroups: []`, `staticData: null`, `tags: []`). **Two are not.**

> ### The endpoint removes both of the wrapper's out-of-graph guards.
>
> | Guard | Fate |
> |---|---|
> | `active: false` | **DROPPED.** Inactivity becomes a property of the server's default, which this repo cannot see. |
> | `meta.finmentor_activation_hazard` — the DO-NOT-ACTIVATE warning | **DROPPED.** The deployed object carries no warning at all. |
> | `nodes[0].disabled === true` | **CARRIED**, inside `nodes`. **The only surviving guard.** |

P6.2 already recorded the `active` drop for Lead Intake. What P7.3 adds is that **its blast
radius changed**. For Lead Intake, an unexpectedly-active copy collides on a webhook path and
n8n's uniqueness constraint answers. For the Concierge, an unexpectedly-active copy takes the
bot. And the Concierge loses a second guard Lead Intake never had to think about, because the
Concierge is the first artifact whose `meta` was carrying a safety warning rather than only
provenance.

So the entire post-deploy safety story rests on one assumption this repository **cannot verify
offline**: that `POST /api/v1/workflows` preserves a node's `disabled` flag rather than
normalising it away. It is not assumed. It is the **first** entry in `POST_DEPLOY_ASSERTIONS`,
ordered first on purpose, and it carries its own instruction:

> the returned definition has ZERO enabled trigger nodes — **THE INTERLOCK. Check this FIRST.**
> if it did not, **DELETE the created workflow immediately**: it is one activation away from
> taking every client message from the production bot, silently.

The gate asserts that ordering, so a later edit cannot demote it into the middle of a list.

---

## 6. The artifacts

| File | Bytes | Role |
|---|---|---|
| `n8n/candidate/concierge-issuer-candidate.json` | 157,001 | **the audit anchor. NEVER import this.** Unchanged by this phase; the generator re-reads it after writing and proves it byte-identical |
| `n8n/candidate/concierge-issuer-IMPORT-SAFE.json` | 156,422 | the **UI** import artifact |
| `n8n/candidate/concierge-issuer-API-IMPORT.json` | 155,120 | the **REST** create body, posted verbatim |

45 nodes, 21 Code nodes totalling 87,667 characters, 9 credential-bearing nodes — none of which
this phase modified. Both generators **refuse to write** unless verification passes: an artifact
whose whole value is "you may import this without re-auditing 156 KB by hand" is worth nothing
if the check did not run.

---

## 7. What was measured

**87 checks**, `qa/concierge-import-safe.test.mjs`, registered in `qa/run-all.mjs` with a
per-gate floor of 87. Full suite: **17/17 gates, 956 assertions.**

| | |
|---|---|
| The hazards are still real | 8 checks, including the takeover premise proven against the **production export** |
| Artifact freshness | regeneration byte-identical for both wrapper and projection |
| Identity gone | production id, production `webhookId`, `creatorId` and owner email absent from the whole document |
| The interlock | zero enabled triggers; trigger parameters and credential byte-identical |
| Graph fidelity | 45 nodes, per-type census, all 21 Code bodies, all credentials, **all parameters**, `connections`, `settings` |
| The issuer survived | all 13 issuer nodes, both Data Tables still on `Submission_Receipts`, `submission_key` count preserved, mint still on a path to `Save Bot Session` |
| Residual diff | exactly 19 paths, pinned literally |
| Mutation battery | **28** corrupted wrappers + **7** corrupted projections + the canonical fed to the projection as if it were the wrapper — all rejected, each for the *expected* reason |
| Control | the unmutated artifacts are accepted, so neither battery is vacuous |

Verification never re-runs its own transform. Both verifiers read the two documents directly, so
a bug in a generator cannot pass its own check.

---

## 8. What P7.3 step 1 does NOT claim

| | |
|---|---|
| Anything deployed | **NO.** No tenant call was made in this step |
| Production Concierge modified | **NO** — still `mppzthlkSJFr6Kle`, `active: true`, 33 nodes, zero `submission_key` |
| The server preserves `disabled` | **UNPROVEN.** Offline-unverifiable, and the reason `POST_DEPLOY_ASSERTIONS[0]` exists |
| The server defaults new workflows to inactive | **UNPROVEN**, and no longer load-bearing — the interlock does not depend on it |
| A key minted live by this artifact | **NO** — that is step 2 |
| The concurrency window closed | **NO.** Narrowed at P7.2, unchanged here |
| The `CARRY`-path lost update | **NOT ADDRESSED**, unchanged |
| Mini App submit gateway | **unchanged, still absent** |
| General Mini App activation | **NOT CLEARED** — unchanged |

### 8.1 The step-2 problem this step created, stated now rather than hit later

The interlock has a cost, and it lands squarely on the next step. **A workflow with no enabled
trigger cannot be executed** — not activated, and not run manually either. The Concierge, unlike
Lead Intake, has no `executeWorkflowTrigger` to drive it from; P6's canary had a second, internal
entry point and this one does not.

So step 2 cannot begin by running the canary. It has to begin by deciding **how** to drive it,
and every option costs something:

1. **Re-enable the trigger with pinned data.** Pinned data short-circuits the node, so the bot
   should never be contacted — but "should" is doing real work in that sentence, and the window
   between enabling the trigger and pinning the data is a window in which one click on *Test
   workflow* takes the live bot.
2. **Add an `executeWorkflowTrigger` to the canary only.** Deliberately breaks the byte-fidelity
   the wrapper exists to preserve, and would have to be its own declared, verified diff.
3. **Drive it through the tenant's test/execute API** with the trigger left disabled, if that
   surface can supply trigger output — unproven on this tenant and worth a probe before a plan.

That is a genuine decision, it belongs to step 2, and it is written down here because it was
found in step 1. Deciding it inside a phase that had already started running things is exactly
how the trigger gets enabled "just for a moment".

Two further consequences of §4.2 that step 2 must plan around, not discover: a canary turn that
reaches `Answer Callback Query` calls the **live** Telegram API with the production bot token
(harmless — `onError: continueRegularOutput` swallows the rejected query id — but real), and a
canary fault raises a **real** Error Monitor alert.

---

## 9. Housekeeping noticed, not changed

`.github/workflows/finmentor-quality-gates.yml` pins `ASSERTION_BASELINE: '544'` against a live
total of **956**. The per-gate floors in `qa/assertion-baseline.json` are the real net and were
raised; CI's total-only second net has been stale for several phases and currently catches
nothing. Left alone because changing CI is not P7.3's job, but it should be raised deliberately
by someone, not drift further.

---

## 10. P7.3, remaining

1. **Decide the canary drive mechanism** (§8.1) — probe first, then plan. Nothing else in step 2
   can start until this is settled.
2. **Deploy the projection**, checking `POST_DEPLOY_ASSERTIONS` in order, the interlock first,
   and deleting the created workflow on the spot if it does not hold.
3. **The live canary** in the reserved `900000xxx` range: one MINT turn end to end — receipt
   created `READY`, readback confirmed, authority row carrying both `cycle_id` and
   `submission_key` — and one fault turn that persists nothing.
4. **Then, and only then, the cutover decision.**

`p71b` (F17, the `AZ:BE` sweep) is still open for the owner and still blocks nothing.
