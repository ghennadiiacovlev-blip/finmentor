# SYSTEM ALERT COVERAGE — design, deployment and live proof

**Status:** **DEPLOYED and PROVEN LIVE 2026-08-31T17:52:17Z** — owner message `152`, 64/64 gates,
2288 assertions. Closes `docs/SYSTEM_ALERT_COVERAGE_GAP.md`.

**Architecture:** owner-approved option B — one dedicated `FINMENTOR SYSTEM ALERT`
(`ID700kTo6EXffwry`), called fire-and-forget from authoritative business-terminal verdict points.

---

## Why errorTrigger could never have covered this

A healthy graph returns a terminal business failure without any node throwing:
`continueRegularOutput` converts a store failure into an ordinary item so the graph can classify
it and answer honestly. That is the P9-R2 fix and it is correct. The cost is that **nothing
throws**, so `errorTrigger` never fires — and on the three Mini App workflows retention is off and
`errorWorkflow` is unset, so there is no execution record either. On 2026-08-30 a real owner
submit failed, stayed failed, alerted nobody, and was recovered four hours later only from
Postgres logs.

**Owner decisions D1 and D2 keep it that way**: retention stays off and the Mini App trio stays
unwired, because those workflows carry initData, draft and session context. The alert authority is
the **sanitised business verdict**, never an execution dump. This deployment reduces the
dependence on retained execution data; it does not reintroduce it.

## The ten alertable operational paths (owner correction D4 — TEN, not nine)

| # | route | error_code | class | why that class |
|---|---|---|---|---|
| 1 | `miniapp-submit:Privacy Verdict` | `PRIVACY_UNRESOLVED` | **B** | the privacy INSERT was issued; its outcome is what could not be established |
| 2 | `miniapp-submit:Receipt Verdict` | `SUBMIT_UNRESOLVED` | **C** | privacy is committed before this node runs; a receipt may be preallocated |
| 3 | `miniapp-submit:Parse Intake Result` | `SUBMIT_UNRESOLVED` | **B** | privacy + receipt committed; Intake's internal contract strips the cause |
| 4 | `miniapp-session:Draft Unavailable` | `TEMPORARY_BACKEND_ERROR` | **A** | the draft write is the only write, and it failed |
| 5 | `miniapp-gateway:Claim Store` | `REPLAY_STORE_UNAVAILABLE` | **A** | the replay claim is the first write; nothing downstream ran |
| 6 | `miniapp-gateway:Session Store Verdict` | `SESSION_STORE_UNAVAILABLE` | **C** | the G5 claim was won and is durable; the session insert failed |
| 7 | `lead-intake:Pipeline Write Failed` | `PIPELINE_WRITE_FAILED` | **B** | dedup read completed; whether a partial row landed is the open question |
| 8 | `lead-intake:Pipeline Merge Failed` | `PIPELINE_MERGE_FAILED` | **C** | the merge path is only reached when dedup found a row |
| 9 | `lead-intake:CRM Unavailable` | `CRM_UNAVAILABLE` | **A** | Settings is read before any write |
| 10 | `concierge:Parse Intake Response` | `INTAKE_NOT_OK` | **C** | the session is durably marked `lead_pending` / `intake_failed_review_needed` |

**D5 is structural, not a convention.** The class is a property of the ROUTE, fixed from the
deployed graph order, and `normalise()` takes it from the route table — a caller cannot set its
own. Routes 7 and 8 carry different classes precisely because the same `error_code` family leaves
different durable state, which is what deriving from the code would have got wrong.

Class **A** is the only one permitted to say a write was not reached. No message says «Лид не
создан», «Pipeline не изменён» or «privacy-запись не создана»; a gate asserts every class against
those three strings.

## Expected client refusals — silent, by allowlist

`BAD_REQUEST` · `INVALID_PAYLOAD` · `CONSENT_REQUIRED` · `SESSION_INVALID` · `SESSION_EXPIRED` ·
`DRAFT_EMPTY` · `NOT_AUTHORISED` · `REPLAY_REFUSED` · `IDEMPOTENCY_CONFLICT`

`REPLAY_REFUSED` is the G5 replay defence **working**; `IDEMPOTENCY_CONFLICT` is the identity
contract **working**; `NOT_AUTHORISED` is the owner-only UAT gate refusing by construction.
Alerting on these would train the owner to ignore the channel.

## Client response independence

Every HTTP emit hangs off a **responder**, so the client answer is already flushed when the alert
branch starts, and every emit sets `waitForSubWorkflow: false` and `onError:
continueRegularOutput`. The pattern is not novel on this tenant — Lead Intake already chained
`Respond New Lead → Restore Lead Context` before this pass.

The Concierge has no HTTP responder, so no HTTP-shaped ordering was invented for it: its emit
follows `Save Intake State`, the Bot_Sessions mutation whose proven outcome is the thing being
reported.

Its success sentinel is an **empty** `error_code`, not a spare one: a well-formed unknown code
would pass the shape test and alert on every successful lead, so `''` is used and fails it.

## The Gateway throw, normalised (D6)

`Create App Session` threw, into a workflow with no error route, no errorWorkflow and no
retention — invisible everywhere. It now carries `onError: continueErrorOutput`, the same posture
`G5 Replay Claim` already used.

**The error output does not rejoin the success path, and that is the whole point.** `Finalise
Session` answers `found || cand` — on an empty read-back it returns the candidate, because "this
execution inserted a row a moment ago". That reasoning holds only when the insert *succeeded*.
Routing a failed insert into it would turn a hard failure into a false success and hand the client
a session id that does not exist. The error output is a separate branch ending in a fail-closed
`503 SESSION_STORE_UNAVAILABLE`, and it never rejoins.

**No approved security invariant changed.** Verified byte-identical after deploy by fresh GET:
`G5 Replay Claim`, `Verify InitData`, `Derive Replay Key`, `Claim Verdict`, `Finalise Session`,
`Read Back Sessions`, `Respond Bootstrap OK`. `Create App Session` changed **only** its `onError`,
and output `[0]` still goes to `Read Back Sessions`.

Not changed, and reported rather than fixed: `Read Back Sessions` is `continueRegularOutput` +
`alwaysOutputData`, so a read-back outage still yields the candidate and a 200. That is the
existing documented semantic and it was out of scope for this pass.

## Event model — strict allowlist

Nine fields and nothing else survives `normalise()`: `alert_key`, `occurred_at`, `workflow_key`,
`workflow_label`, `operation`, `stage`, `error_code`, `retryable`, `side_effect_class`,
`route_identity`.

It is a **whitelist**, because a blacklist protects against the fields someone thought of and the
field that leaks is always the one added later. A second gate refuses any event carrying a
forbidden key at any depth — `init_data`, `hash`, `auth_date`, `raw_json`, `draft_json`, `phone`,
`email`, `stack`, `token`, `dsn` and the rest — and `route_identity` must match a known
server-derived shape or it is dropped, so client free text cannot ride in on the one open field.

## Alert key, and what it is not

```
alert_key = sa_ + sha256(workflow_key + stage + operation + error_code + route_identity)[0..32]
```

No `Date.now`, no `Math.random`, no Telegram `message_id`, and deliberately not the NEW LEAD
`dispatch_key` — that identity means "a lead exists", the opposite of what most of these events
assert. Same route + same identity + same verdict ⇒ same key; a different operation, verdict or
identity ⇒ a different key. All four are gated.

**D3 / D7 — this is an identity, not a delivery guarantee.** There is no persistent store in this
phase, so **duplicate SYSTEM ALERT delivery across executions is possible and is accepted**.
Nothing is named or documented as dedup, no node claims durable state, and a gate fails if any
node name or shipped string claims exactly-once. The durable Alert Outbox must adopt this same
identity contract. A duplicate operational alert is preferable to a silent production failure.

## Recursion protection

1. the alert workflow has **zero** outbound `executeWorkflow` nodes (exact type — the
   `executeWorkflowTrigger` entry point is not a call, and an early loose regex reported it as one)
2. `errorWorkflow` is **absent**, so a failure inside it reaches nothing
3. the Telegram send is last and `continueRegularOutput` — a Telegram outage ends the execution
   quietly rather than throwing
4. callers do not wait, so an alert failure is not observable upstream

Net: an alert delivery failure produces zero alerts and no loop.

## Premium copy

`LA.renderSystemAlert()` gained two optional fields — `operation` and `sideEffectClass` — plus
three optional technical lines. **Absent, it renders byte-identically**, so every existing
errorTrigger alert is unchanged; a gate asserts that on the legacy model. The Lead Alerts
candidates were regenerated from the module (repo-only, **not deployed**) so the drift gate stays
honest; the deployed Lead Alerts workflows were not touched, and their `updatedAt` proves it.

What the owner received, live:

```
FINMENTOR · SYSTEM ALERT

Не удалось запустить Mini App.

Влияние
Операция не завершена.
Сбой на этапе «Проверка запуска».

Данные
Необратимая бизнес-запись не была достигнута.

Статус
Требует проверки

Технические данные
Workflow: Mini App Gateway
Node: Проверка запуска
Код: REPLAY_STORE_UNAVAILABLE
Повтор: возможен
Идентификатор: abcdef0123456789
```

## Live proof, and what it deliberately did not do

A disposable owner-only harness produced one sanitised class-A verdict and invoked the **deployed**
workflow through the **same** event contract. Nothing was broken to produce it: no Supabase, G5,
Sheets or Telegram outage was induced. **No lead, no Pipeline write, no privacy write, no
Bot_Sessions mutation, no production outage.** The harness was deleted after the run.

Execution `5075` → alert execution `5076` → Telegram message **`152`** to the owner's private chat.
Sensitive-data scan on the rendered HTML: clean.

Two live failures on the way, both worth recording:

* execution `5071` — `LA is not defined`. The presenter was inlined raw, leaving `module.exports`
  in a Code node. The gate asserted the module was inlined byte-for-byte and that assertion
  **passed**, because inlining the raw source does match byte-for-byte. Proving the module is
  present proves nothing about whether the node runs. The gate now **executes** the candidate's
  build node — the same both-halves rule 5055 and 5062 established.
* the first `--apply` — n8n **persisted** the PUT and still refused to publish it, because the
  sub-workflow was not yet published. A re-run would have appended a second copy, and the
  "pre-image" it froze would have contained the first attempt. The deploy now strips this pass's
  own nodes from the fresh read before anything else, so it converges and the frozen pre-image is
  a real rollback body.

## Rollback

`.uat/<id>.pre-system-alert.json` for all five callers, frozen with this pass's nodes stripped —
PUT one back to undo it. Deleting or deactivating `ID700kTo6EXffwry` makes every emit a no-op,
because no caller waits on it.

---

# PERMANENT ENGINEERING RECORD — two implementation incidents

Recorded in full, at owner instruction, because both were caught by production rather than by a
gate, and both produced a permanent rule. Neither is softened here.

## INCIDENT A — execution `5071`: the build node failed with «LA is not defined»

**What happened.** The first live invocation of the deployed SYSTEM ALERT workflow failed inside
`Build System Alert`. `n8n/src/lead-alerts/presenter.js` is a CommonJS module ending in
`module.exports = {…}`; it was inlined into the Code node **raw**. A Code node has no `module`, so
the const `LA` was never defined and the node threw on the first line that used it.

**Root cause — the assertion was source-presence, not execution.** The gate asserted that the
candidate contained the module byte-for-byte. That assertion **passed**, and was worthless:
inlining the raw source *does* match byte-for-byte. The correct inline is an IIFE — everything up
to `module.exports`, wrapped and returning the exported object, which is what
`scripts/build-lead-alerts-presentation.mjs` had always done and what this pass failed to copy.

A byte-comparison proves the shipped copy equals the tested copy. It proves **nothing** about
whether the node runs. This is the same blind spot that let executions `5055` and `5062` through,
found for a third time.

**Permanent gate added.** `qa/system-alert.test.mjs` — *"the candidate BUILD node actually runs and
renders the alert"* — executes the candidate's own `Build System Alert` source with a shimmed `$`
and `require`, and asserts the rendered HTML carries the approved chrome, the operation headline,
the class-A statement and the alert key. It fails on the graph that produced `5071`.

**The rule:** *a candidate node is proven by executing it, never by comparing its source.*

## INCIDENT B — the first `--apply`: n8n persisted a PUT whose publish step failed

**What happened.** The first `--apply` created the SYSTEM ALERT workflow (unpublished), then PUT
the first caller. n8n returned **HTTP 400** — *"Cannot publish workflow: Node "Emit System Alert
(Submit)" references workflow ID700kTo6EXffwry which is not published"* — and the script stopped.

**The 400 was not a rejection of the write.** n8n had already **persisted** the nodes: Mini App
Submit went from 26 to 28 nodes and stayed active. The error was raised by the publish step, after
the save. The remaining four callers were untouched, verified by fresh read.

**Two failures followed from treating the error as "nothing happened".** The re-run appended a
second copy of the same nodes and was rejected for duplicate node names. Worse, the re-run had
already re-frozen its "pre-image" **from the modified tenant** — a rollback body containing the
first attempt's nodes, which does not roll back.

**Permanent deploy invariant.** Deployment must be **convergent**:

```
fresh-read production
  → strip this pass's own already-applied nodes and edges
  → reconstruct the desired candidate from the stripped original
  → apply
  → fresh read-back
  → prove exactly one intended instance
```

`scripts/deploy-system-alert.mjs` implements this in `stripSystemAlert()`, which runs before the
pre-image is frozen. Running the deploy twice now produces exactly the same tenant as running it
once, and the frozen pre-image is a real rollback body.

**The rule:** *an n8n API error does not mean the write did not land. Re-read before re-applying,
and make every deploy idempotent rather than assuming it runs once.*

---

# LEAD ALERT CANDIDATES — state note

Owner decision: **keep the regenerated candidates.** They are honest derivatives of the current
presenter source, which changed intentionally.

```
LEAD ALERT CANDIDATES
  SOURCE-CURRENT                  = YES   regenerated from n8n/src/lead-alerts/presenter.js
  TENANT-BYTE-EQUAL               = NO    the live workflows carry the pre-delta inline
  BEHAVIOURAL LEGACY OUTPUT       = EQUIVALENT PASS   asserted in qa/system-alert.test.mjs —
                                          a model without operation/sideEffectClass renders
                                          byte-identically, including the legacy «Данные» card
  DEPLOYED IN SYSTEM ALERT PHASE  = NO    no Lead Alerts production deploy occurred
```

**A future Lead Alert deployment must treat this presenter delta as an explicit part of its
candidate diff.** It may not assume tenant parity: the diff will show the two new optional model
fields and three optional technical lines in every rewritten builder node, and that is expected,
intended, and behaviourally inert for the existing models. Reviewing it as an unexplained
difference — or worse, regenerating around it — would be the wrong reading.
