# FINMENTOR — G1 P5 MODEL B production integration plan

Phase: **B.2.1-C live prerequisites, P5 — repository-only integration package**
Date: **2026-08-26**
Branch: `feat/miniapp-b21c-live-prereqs`
Repo HEAD at P5 start: `80e9675`

P4 is accepted: P1-L2′ PASS, P1-L3 PASS, P1-L4 PARTIAL, MODEL B live substrate PROVEN.

**P5 changed no live object.** No workflow was created, updated, activated or executed. No
Data Table was created. No sheet was written. No webhook was called. This document plus the
source, candidate export and tests in this commit are the entire deliverable, and P6 deploys
them.

---

## 1. What P5 produced

| Artefact | What it is |
|---|---|
| `n8n/src/lead-intake/idempotency-receipt.js` | `verifyPreallocationReadback`, `planIssuance`, `interpretUpdateItems`, the redefined P1-L9 chain, the route decision, the zero-item contract |
| `n8n/src/miniapp-submit/submit-contract.js` | `submission_key` added to the Bot_Sessions precondition, on live evidence |
| `scripts/build-lead-intake-receipt-candidate.mjs` | deterministic generator for the candidate wiring |
| `n8n/candidate/lead-intake-internal-receipt-candidate.json` | the candidate Lead Intake graph, 81 nodes (57 + 24) |
| `qa/receipt-integration.test.mjs` | 48 checks: readback, P1-L9, critical section, trust, binding, schema, zero-item, candidate graph |
| this document | the ordered P6 deployment steps |

---

## 2. Preallocation create is now verified (§1)

P2 proved the Data Table INSERT has no uniqueness constraint. MODEL B makes a collision
extraordinarily unlikely with a 128-bit random key — but that is a property of the KEY
GENERATOR, not something the STORE enforces, and authority must never advance on the strength
of an insert that merely returned success.

`insertedCount`, an HTTP 2xx, and the absence of an exception are all reports about the CALL.
None is evidence about the STATE, and only state can justify advancing authority.

The issuance ordering is now seven steps, with the old step 3 ("CONFIRM") split into an
explicit readback and an explicit cardinality check:

1. mint a new `submission_key` server-side (random, not derived)
2. INSERT the receipt in state `READY`
3. exact-key READBACK of that `submission_key`
4. verify EXACTLY ONE row, and that it is a pristine READY receipt for this key
5. where an issuance reference is carried, prove it belongs to THIS issuance
6. only then write `cycle_id` + `submission_key` to `Bot_Sessions`
7. only after the authority commit may a Mini App session bind

`verifyPreallocationReadback` refuses to advance on every one of: zero rows, more than one
row, a row for a different key, a non-READY state, a malformed row, a store error, an
unreadable answer, a row carrying settlement residue, a row that already has a
`correlation_id`, and an issuance-reference mismatch.

`planIssuance` then converts that verdict into the authority decision. **The failure posture
is the part that matters**: on any refusal the OLD authoritative cycle stays current. It is
not cleared and not half-written. A half-advance — new `cycle_id`, no `submission_key` — would
be worse than no advance, because every submit on that cycle is `PRE_ACTIVATION_BLOCKED` and
the user is locked out of a cycle that looks current. The client is never told a new cycle
exists.

Concurrent issuance stays allowed and is not arbitrated by the ledger: each issuer mints its
own key and confirms its own receipt, `Bot_Sessions` `appendOrUpdate` picks the winner by
last-write-wins, and the loser's receipt is an orphan no current authority row names.

---

## 3. P1-L9, redefined for MODEL B (§2)

The old P1-L9 came from the submit-time receipt design, where the receipt was created by the
submit attempt and could be stamped at birth with that attempt's request id.

Under MODEL B the receipt is preallocated before any submit attempt exists. A correlation id
minted at preallocation would appear in no gateway log line and in no Pipeline row — it would
satisfy the letter of "the receipt has a correlation_id" while breaking the chain the rule
exists to provide. **That is worse than having no value, because it looks correct.**

So the stamp moves to the claim:

| Moment | `correlation_id` |
|---|---|
| preallocation | `''` — supplying one is REFUSED, not ignored |
| `READY → IN_FLIGHT` (winning claim) | the gateway's **server** correlation id |
| `IN_FLIGHT → COMMITTED` | untouched |
| `→ ABORTED` | untouched |

The gateway already uses that same value as `envelope.payload.meta.request_id`, and Lead
Intake normalisation writes it into `Pipeline.request_id` (column AZ). So from the instant the
claim succeeds — **before** the Pipeline write — the chain holds:

```
receipt.correlation_id  ===  envelope.payload.meta.request_id  ===  Pipeline.request_id candidate
```

and after the Pipeline write it is the actual operator recovery chain.

Properties, each with a test:

- **never caller-selected.** `request_id` stays on `UNTRUSTED_BODY_KEYS`; a value flagged as
  not server-minted is refused with `CORRELATION_ID_NOT_SERVER_MINTED`.
- **`request_id` remains correlation only.** It is not the submission identity and not a
  deduplication key; `submission_key` is the sole submission identity.
- **a losing claim cannot overwrite it.** Immutability is a property of the PREDICATE, not a
  separate guard: the loser matches on `commit_state = READY`, which the winner already moved.
- **commit and abort preserve it.** Enforced structurally — `updateSpec` THROWS if
  `correlation_id` appears in any patch other than `READY → IN_FLIGHT`, so a future edit fails
  at build time rather than silently rewriting the recovery chain in production.

---

## 4. Validation precedes the claim (§3)

A claim burns the receipt: once it leaves `READY` it can never be claimed again, so a request
rejected AFTER the claim strands the cycle in a state only an operator can clear. Every
deterministic, non-mutating rejection therefore happens first.

Read off the **live** 57-node Lead Intake graph, the deterministic prefix is:

```
Webhook → Validate Payload → IF Valid          schema rejection
        → Read Settings → Settings to Object   config load
        → Normalize + Score Lead               normalisation, scoring
        → Read Pipeline (Dedup) → Dedup Guard  dedup decision
```

and the dedup decision routes to three terminal outcomes, **all of which return a canonical
lead id**:

| Branch | Pipeline write? | Returns a lead id? |
|---|---|---|
| `IF Is New` true → `Save to Pipeline` | yes | yes |
| `IF Is Retry` true → `Respond Retry` | **no** | **yes** |
| otherwise → `Update Pipeline (Merge)` | yes | yes |

**The claim goes after `Dedup Guard` and before `IF Is New`** — the single choke point
covering all three. That placement is load-bearing in a way "immediately before Save to
Pipeline" is not: the RETRY branch returns a lead id **without** writing to Pipeline, so a
claim attached only to the write paths would leave the receipt `READY` while the caller was
told the submission succeeded. A later recovery would read `READY` — "no handoff began" — and
invite a duplicate submit for a lead that already exists.

After the claim there is no ordinary rejection branch. A failure between claim and Pipeline is
`SUBMIT_UNRESOLVED` with operator evidence preserved, never "retry normally".

---

## 5. Zero-item Data Table handling (§4)

P4 proved a conditional update matching nothing returns `data.main[0] === []` with
`executionStatus: "success"` — so the node emits **zero items** and every ordinary downstream
node is **skipped**.

This is the sharpest wiring hazard in the design. The natural reading of
"update → IF updated_rows === 1 → Pipeline" is that the IF decides. It does not: on a
zero-match **the IF never runs at all**, so what happens next is decided by the graph's
fall-through rather than by any check that was written.

The candidate uses two constructions together, because they fail differently:

1. **`alwaysOutputData: true`** on every receipt update node. n8n then substitutes a single
   EMPTY item `{}`, so a downstream node always runs. The discriminator becomes the SHAPE of
   the item rather than its presence.
2. **An explicit shape discriminator** immediately after, returning `{ ok, updated_rows }` and
   never throwing.

The trap in (1) alone is that the substituted `{}` passes a sloppy check. A truthy test, an
`!== undefined`, or a field read wrapped in `try/catch` all turn the synthetic item into a
fake success — the gate has a mutation test that runs all three sloppy readings against the
synthetic item, confirms each would accept it, and confirms the real discriminator refuses it.

The discriminator keys on `submission_key` matching the expected key: the update node returns
the full post-update row, so a genuine row always carries it and an empty item never does.

**Proven on the candidate graph, not asserted in prose:** starting from `IF Claim Won`'s false
edge, no Google Sheets append/update node is reachable — and starting from its true edge,
`Save to Pipeline` and `Update Pipeline (Merge)` both are. A gate that blocks everything is not
a gate, so both directions are checked.

---

## 6. P1-L10 route decision (§5)

**DECISION: INTERNAL SUBWORKFLOW.**

The deciding fact is topology, checked rather than assumed: the gateway and Lead Intake both
run in the same n8n tenant (`n8n/production/manifest.json`, `tenantHost
ghennadi.app.n8n.cloud`). P4 additionally exercised this exact mechanism live in this tenant —
`executeWorkflow` calling an `executeWorkflowTrigger` sub-workflow — so it is a proven
capability here, not a hoped-for one.

Why it beats a credential-protected webhook, given both were available:

- **No public URL.** An authenticated webhook still accepts unauthenticated connections before
  rejecting them. A sub-workflow has no address off-instance, so the internal receipt path is
  not merely guarded — it is unreachable from the internet.
- **No transport secret lifecycle.** Nothing to provision, rotate, scope, leak into an export
  or forget to revoke. Two n8n API keys are already pending revocation; adding a third
  long-lived transport secret is the wrong direction.
- **Provenance is structural.** The entry node can only be reached by an in-instance caller.
  `internalRouteProven()` reads a node that never ran on the public path, so provenance comes
  from the workflow graph rather than from anything a caller can assert.
- **The public path stays physically separate.** It keeps its own entry node and never reaches
  the receipt branch.

The entry node keeps the name **`Internal Auth Entry`**, so `internalRouteProven()` in
`normalize-score-lead.js` is **unchanged**. The gate asserts the declared node name matches
what that function actually reads, so a rename cannot silently make provenance false.

**Overturning condition:** if the gateway is ever deployed outside this tenant it cannot invoke
a sub-workflow, and the fallback is an authenticated webhook with an n8n-managed credential —
never a shared secret in Settings/Sheets, never a body marker, never a hand-checked header.

---

## 7. The public path is unchanged (§6)

`POST /finmentor-lead-intake` keeps its contract and never creates, reads, claims or commits a
receipt, and never reveals whether a `submission_key` exists.

Three independent mechanisms, because one would be a single point of failure:

1. `Receipt Gate` sets `__receipt_required = 0` unless BOTH internal provenance and an exact
   `sub_<32 hex>` key are present. The key is read only from the trusted internal entry, never
   from the request body.
2. `IF Receipt Required` false routes straight to the ordinary flow.
3. **`IF Receipt Active (New|Retry|Merge)`** gates every commit chain.

Mechanism 3 was added because the candidate's first draft was **wrong**, and the gate caught
it. The commit chain hung off `Save to Pipeline`, which the public path reaches — so a website
lead would have issued a conditional update against the receipt table. It would have affected
zero rows and created nothing, but it is still a receipt operation on behalf of an untrusted
caller, and the failure branch would then answer a public request with `SUBMIT_UNRESOLVED` —
an existence oracle for anyone able to shape the request. Found by the reachability test, not
by review.

Caller-supplied `submission_key`, `idempotency_key`, `__internal_route`, `internal_route` and
`provenance_trusted` are dropped, not rejected: an error that fires only for real keys is
itself an oracle. The public refusal reason is identical for a well-formed key and a random
one, and the gate asserts that.

---

## 8. Bot_Sessions schema package (§7)

**Verified from live evidence, not assumed.** The canonical live writer column list appears
verbatim in three Code nodes of the live Concierge export
(`n8n/production/mppzthlkSJFr6Kle...json` — `Build Session Row`, `Build Intake State Row`,
`Build Confirmation State Row`). It has **36 columns**:

```
session_id, chat_id, user_id, username, first_name, last_name, language, state, created_at,
updated_at, last_message_at, entry_source, selected_service, business_model, turnover_range,
main_pain, urgency, has_cfo, documents_status, contact_phone, contact_email, contact_name,
company, free_text_request, consent, lead_id, lead_sent_at, status, notes, raw_json,
cycle_id, consent_cycle_id, consent_at, lead_cycle_id, lead_intake_ok, previous_lead_id
```

**Present and preserved** — not re-added, not rewritten: `cycle_id`, `consent_cycle_id`,
`consent_at`, `lead_cycle_id`, `lead_intake_ok`.

**Absent and therefore required** — all four:

| Column | Semantics | Crosses TB-1 | Cost if absent |
|---|---|---|---|
| `submission_key` | the preallocated receipt key; half of the authority binding | no | every submit on the cycle is `PRE_ACTIVATION_BLOCKED` |
| `lead_mode` | `new` / `merged` | no | an authority-resolved retry cannot recover the classification |
| `lead_priority` | `HOT`/`WARM`/`COLD`/`INCOMPLETE` | yes | retry reports the clamp default `COLD` |
| `financial_zone` | `RED`/`ORANGE`/`YELLOW`/`GREEN`/`UNKNOWN` | yes | retry reports the clamp default `UNKNOWN` |

A QA fixture had previously listed `submission_key` as already live. It is not, and the
optimistic direction was the dangerous one: **Google Sheets silently DROPS a patch key with no
header**. A deployment against an unmigrated sheet would appear to bind the submission key
while storing nothing, and every later authority read would report a current cycle with no
key. The fixture is corrected in this commit and the preflight now refuses a migration that
adds the three classification columns but forgets the binding column.

- **Exact headers**, lower_snake_case, row 1, **appended after** the existing 36. Position is
  not depended upon — the writer patches by key — but a mistyped header is an absent column,
  so the preflight compares text, not count.
- **Writers**: the Concierge writes `submission_key` at issuance (after readback);
  `persistCanonical` writes the three classification columns at the authoritative commit.
- **Readers**: `handleSubmit` authority read, the gateway pre-handoff guard,
  `resolvePriorSubmission`.
- **Reset semantics**: a new cycle rewrites `cycle_id` + `submission_key` together, never one
  alone. The three classification columns are cleared on a new cycle.
- **Fail-closed preflight**: `authoritySchemaPreflight` refuses on absent, partial, mistyped
  and unreadable header lists. "We could not check" and "it is fine" are never the same answer.
- **Rollback**: appended columns are additive and unreferenced by any existing reader, so
  leaving them in place is harmless. Rolling back the code without removing the columns is
  safe; removing the columns while the code is deployed is not, so the column drop is the LAST
  rollback step, never the first.

**Authority binding is now `cycle_id` AND `submission_key`.** A current row missing
`submission_key` stays `PRE_ACTIVATION_BLOCKED` (retryable — an operator or the migration
resolves it, not the client). The app session must carry the key server-side, and it never
crosses TB-1.

---

## 9. P6 DEPLOYMENT STEPS

Every step has a precondition, a proof, a rollback and a stop condition. **Stop means stop** —
the next step does not run.

### Step 0 — capture live snapshots

- **Precondition**: none.
- **Action**: export every workflow to be touched; record workflow IDs, `updatedAt`,
  `structuralHash` and the live `Bot_Sessions` header row.
- **Proof**: `n8n/production/manifest.json` regenerated; hashes recorded in the P6 doc.
- **Rollback**: n/a.
- **Stop if**: any live workflow differs structurally from its tracked export — the repo is
  not describing production, and every later step is built on that assumption.

### Step 1 — additive Bot_Sessions columns

- **Precondition**: step 0 complete; header row captured.
- **Action**: append `submission_key`, `lead_mode`, `lead_priority`, `financial_zone` after the
  existing 36. **No column is renamed, reordered or removed.**
- **Proof**: `authoritySchemaPreflight(observedHeaders).deploy === true`, run against the
  re-read header row — not against the intended one.
- **Rollback**: the columns are additive and unread by current code; leave in place.
- **Stop if**: the preflight refuses, or any existing header changed position or text.

### Step 2 — production `Submission_Receipts` table, EMPTY

- **Precondition**: step 1 green.
- **Action**: create the Data Table with the eleven declared fields, all `string`. **No rows.**
- **Proof**: schema read back and compared field-by-field against `RECEIPT_FIELDS`; row count 0.
- **Rollback**: delete the table (empty, referenced by nothing yet).
- **Stop if**: the schema does not match exactly, or the table is not empty.

### Step 3 — deploy the internal route, NO user traffic

- **Precondition**: step 2 green.
- **Action**: deploy `n8n/candidate/lead-intake-internal-receipt-candidate.json` over Lead
  Intake. The `Internal Auth Entry` sub-workflow trigger exists but **no gateway calls it yet**.
- **Proof**: public `POST /finmentor-lead-intake` still behaves identically — a synthetic
  public lead produces the same response shape and the same Pipeline row as before, and the
  receipt table still has **0 rows**.
- **Rollback**: re-deploy the tracked production export `QmIyEW2ZEqKregmN...json`.
- **Stop if**: any public behaviour changes, or the receipt table gains a row.

### Step 4 — deploy the receipt helpers

- **Precondition**: step 3 green.
- **Action**: ship `idempotency-receipt.js` into the Code nodes that need it.
- **Proof**: `node qa/run-all.mjs` green at the P5 floor; no live invocation.
- **Rollback**: revert the Code node bodies.
- **Stop if**: any gate fails.

### Step 5 — deploy the Concierge preallocation candidate

- **Precondition**: steps 1-4 green.
- **Action**: add mint → INSERT → readback → `verifyPreallocationReadback` → `planIssuance`
  ahead of the `Bot_Sessions` write. `cycle_id` and `submission_key` are written **together**.
- **Proof**: not yet exercised — proven by step 6.
- **Rollback**: re-deploy the tracked Concierge export.
- **Stop if**: the deployed graph writes `cycle_id` without `submission_key` on any path.

### Step 6 — synthetic issuance canary

- **Precondition**: step 5 deployed.
- **Action**: one synthetic issuance in the `9000000xx` range.
- **Proof**: exactly ONE `READY` receipt exists for the minted key; the authority row names
  that exact key; `correlation_id` is **empty**. Then a negative: force the readback to fail
  and confirm the OLD cycle stays current, the authority row is unchanged, and no client
  success is emitted.
- **Rollback**: delete the synthetic receipt row and restore the synthetic authority row.
- **Stop if**: authority advanced without a confirmed receipt, or a half-written row appears.

### Step 7 — synthetic internal claim → commit canary

- **Precondition**: step 6 green.
- **Action**: invoke the internal sub-workflow with the synthetic key. Then repeat the claim.
- **Proof**: first claim → 1 item, `IN_FLIGHT`, `correlation_id` set to the server correlation
  id, and that value equals `meta.request_id` **and** the Pipeline `request_id`/AZ cell.
  Second claim → `[]`, zero Pipeline writes, `SUBMIT_UNRESOLVED`. Commit → 1 item,
  `COMMITTED` with the four canonical values. Repeat commit → `[]`, no ordinary success.
- **Rollback**: abort the synthetic receipt; delete the synthetic Pipeline row.
- **Stop if**: a zero-row claim reaches Pipeline, or `correlation_id` is empty/rewritten, or a
  post-claim failure reports ordinary success.

### Step 8 — gateway candidate canary

- **Precondition**: step 7 green.
- **Action**: one synthetic Mini App submit end to end.
- **Proof**: gateway reads BOTH `cycle_id` and `submission_key` from authority, re-reads both
  before handoff, sends the key only over the internal path, and the browser response contains
  **no** `submission_key`. `READY` releases a stale gateway claim; `IN_FLIGHT` does not;
  `COMMITTED` replays; `ABORTED` requires a new cycle; ABSENT fails closed.
- **Rollback**: unpublish the gateway candidate.
- **Stop if**: the key appears in any browser-visible payload, or a binding drift is accepted.

### Step 9 — negative public poisoning canary

- **Precondition**: step 8 green.
- **Action**: public `POST /finmentor-lead-intake` carrying `submission_key` (both a REAL
  synthetic key and a random one), `idempotency_key`, `__internal_route: true`,
  `provenance_trusted: true`.
- **Proof**: ordinary public lead created; receipt table **completely unchanged** (compare row
  count and every `updated_at`); responses for the real key and the random key are
  **byte-identical**, so nothing is an existence oracle.
- **Rollback**: n/a (read-only expectation); if the receipt table changed, roll back step 3
  immediately.
- **Stop if**: any receipt row is read, created or mutated, or the two responses differ.

### Step 10 — decide whether live activation is cleared

- **Precondition**: steps 0-9 all green, all synthetic data removed.
- **Action**: owner decision only. **P6 does not activate user traffic.**

**Rollback invariant across every step: existing public Lead Intake behaviour is preserved.**
Re-deploying the tracked production export restores it in one action, and the appended
`Bot_Sessions` columns are inert to the old code.

---

## 10. Retention — P1-L8 (§11)

No automatic deletion. **Retention duration remains an OWNER decision and is still OPEN.**

Implemented for the production candidate: least-privilege table use, no browser exposure, no
GA4, no Telegram, no public webhook output, no raw `submission_key` in any log line
(`correlation_id` is the field that correlates), and no contact PII in the receipt table —
asserted field-by-field against `RECEIPT_FIELDS`.

`mayDeleteReceipt` still refuses everything that is not provably safe: non-terminal and
non-orphan, still named by current authority, or retention not elapsed. Receipt deletion
becomes a maintenance workflow only after the owner sets a duration. **This does not block the
controlled canary.**

---

## 11. P1-L4 (§12)

Unchanged from P4 and deliberately not restated as more than it is:

| Boundary | Status |
|---|---|
| execution boundary | **PASS** |
| workflow redeploy | **PASS** |
| tenant restart | **NOT TESTED** |

**P1-L4 remains PARTIAL.** No tenant restart was attempted in P5 and none is planned for P6.

---

## 12. Limitations

- **Nothing here has run.** The candidate is checked as a graph, not as a running workflow.
  Node parameter validity, expression resolution and credential binding are P6's business.
- **The candidate is generated, and the generator asserts its anchors.** If the production
  export drifts, the build fails rather than splicing onto a changed graph — but it is only as
  current as the tracked export, which is why step 0 compares live to repo first.
- **The three commit chains duplicate logic.** Deliberate: n8n has no shared subroutine within
  a graph, and one shared commit node reachable from three branches would make the reachability
  property harder to state, not easier.
- **`Respond Retry` still returns a lead id without a Pipeline write.** That is existing
  behaviour, unchanged. P5 only ensures the receipt is settled on that branch too.
- **The Concierge issuance wiring is source and plan, not a generated export.** Unlike Lead
  Intake, its Bot_Sessions writes are spread across three Code nodes with a shared column list;
  splicing that mechanically carried more risk than value.
- **`crosses_tb1: true` on `lead_priority` and `financial_zone`** is pre-existing and unchanged
  by P5.

---

## 13. Verdicts

| Item | Status |
|---|---|
| Preallocation readback verified | **DONE** |
| P1-L9 redefined for MODEL B | **DONE** |
| Validation precedes claim | **DONE** |
| Zero-item explicit path | **DONE** |
| P1-L10 route decision | **INTERNAL SUBWORKFLOW** |
| Public path unchanged | **DONE** |
| Bot_Sessions migration package | **DONE — 4 columns required** |
| Concierge issuance | **DONE (source + plan)** |
| Lead Intake critical section | **DONE (candidate export)** |
| Gateway binding | **DONE** |
| P1-L4 | **PARTIAL** |
| P1-L8 | **DESIGN READY / OWNER DURATION OPEN** |
| P6 deployment plan | **READY** |

**G1 remains OPEN.** P5 produced the package; nothing is deployed and nothing is proven live
beyond what P4 already proved.

---

## 14. Boundaries observed

No live n8n modification. No workflow created, updated, activated, published or executed. No
Data Table created or written. No Google Sheets mutation. No production webhook called. No
Telegram, GA4, DNS or Cloudflare change. No customer data. No credential printed, stored or
logged. `main` untouched; no PR, no merge.
