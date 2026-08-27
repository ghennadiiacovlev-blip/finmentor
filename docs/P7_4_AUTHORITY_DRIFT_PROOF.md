# FINMENTOR — P7.4: the authority boundary, proven from the graph and then live

**Phase:** B.2.1-C P7.4 — authority drift, lead-ready multi-turn, and the guards that outlive
this session.
**Status:** **PASS.** The reread executes live and returns `AUTHORITY_CURRENT` on a genuine
lead-ready turn. A stale context holding `C1/K1` is **refused live** once the row says `C2/K2`.
The blank-key legacy session is closed. Two live hazards became repo guards with mutation tests.
**No Telegram trigger was enabled. No `setWebhook`. Production Concierge byte-identical.**
**Synthetic residue: zero, measured.**

---

## 1. §1 — is an immediate post-write reread actually required?

**Answered from the graph, not from the old sentence.**

Starting at the authority write (`Save Bot Session`), a **branch-aware** walk of the P7.2
candidate — taking `IF Lead Ready`'s FALSE output, because a minting turn cannot be lead-ready
(§1.1) — reaches exactly **three** nodes:

```
Save Bot Session → IF Lead Ready → Build Bot Event → Save Bot Event
```

Ignoring branch conditions the same walk reaches 17 nodes. The 14 it cannot reach on a mint turn
are the entire irreversible half.

| After the authority write, on that same minting turn, can the execution… | |
|---|---|
| call Lead Intake? | **NO** — `Send Lead to Intake` unreachable |
| bind an app session to `cycle_id`/`submission_key`? | **NO** — the only write is `Bot_Events`, which carries neither |
| expose `submission_key`? | **NO** — `Build Bot Event` emits exactly 12 columns and never mentions it |
| expose a Mini App credential/binding from stale local state? | **NO** — no such node exists on this path; the gateway is absent entirely |
| write canonical lead identity? | **NO** — `Parse Intake Response`, `Build Intake State Row` unreachable |
| perform an irreversible CRM handoff? | **NO** — the only `httpRequest` is unreachable |
| send a Telegram payload whose correctness depends on the minted key? | **NO** — the transport call happens **upstream** of the mint gate, and the reply is composed by `Build Bot Response` before the key exists |
| mutate `Bot_Sessions` again on stale local assumptions? | **NO** — `Save Intake State` / `Save Confirmation State` unreachable |

### Classification

> **IMMEDIATE POST-WRITE REREAD: NOT REQUIRED ON MINT TURN**
>
> **AUTHORITY REREAD REQUIRED BEFORE FIRST LEAD-READY / IRREVERSIBLE HANDOFF**

### 1.1 A mint turn can never be lead-ready

Proven three ways, not asserted:

1. `/start` and restart clear consent explicitly (`s.consent = ''`).
2. Bootstrap does not clear it — but the **independent cycle guard** immediately after does:
   `if (consent !== '' && consent_cycle_id !== cycleId) clear`. A newly minted cycle cannot match
   a stored `consent_cycle_id`, so consent is empty on **all three** reset paths.
3. Live: both mint turns (P7.3 exec 3672, P7.4 exec 3680) returned `NOT_LEAD_READY`.

### 1.2 The reread already sits at that boundary — and dominates it

Domination test: remove one node, ask what becomes unreachable from the trigger.

| Cut | Irreversible nodes still reachable |
|---|---|
| baseline | 10 / 10 |
| `Authority Reread` | **NONE** |
| `Authority Verdict` | **NONE** |
| `IF Authority Current` | **NONE** |

`Authority Reread` is a **cut vertex on every path to the CRM handoff**. There is no bypass. So
P7.2's *placement* is right and only its *wording* was wrong — corrected in place at §10, without
moving a node to satisfy a sentence.

---

## 2. §2 — the harness, extended not replaced

The P7.3 harness already carried the full lead-ready path. P7.4 added one **separate** variant.
The deployable candidate, the wrapper and the API projection were not touched — all three still
regenerate byte-identical.

| | Base | Drift |
|---|---|---|
| Nodes | 30 | 32 |
| Inherited **byte-identical** | 23 | 23, *plus every base node unchanged* |
| Telegram nodes | 0 | 0 |
| Triggers | 1 × `executeWorkflowTrigger` | same |
| Rerouted edges | — | **exactly 1** |

### 2.1 Why the drift had to be injected, and why only in one place

Seeding `C2/K2` before the run does not work: `Get Bot Session` derives what the turn *holds*
from the row it reads, so the turn would hold `C2/K2` and there would be no stale context. And
`Save Bot Session` writes the held pair back, so by the time the reread runs the row says `C1/K1`
again.

The drift therefore has exactly one place to land: **between the authority write and the
reread** — which is precisely where a real concurrent winner's write lands, and the only interval
in which the reread can observe anything other than what this turn just wrote.

Two harness nodes are spliced onto that one edge. `HARNESS Drift Compose` builds the competing
row **from `Build Session Row`'s output**, so it carries the same 40 columns the real write does
and overwrites the pair without blanking the session. `HARNESS Drift Write` uses
`Save Bot Session`'s parameters **verbatim** — a drift staged through a different mapping would
be staging a state production cannot reach.

The compose body **refuses** if no competing pair is supplied, or if it equals the held cycle. A
drift harness that quietly failed to drift would report a clean `AUTHORITY_CURRENT` and be read
as a *passing* stale-context test. That is the worst failure this artifact could have.

---

## 3. §3 — turn 1, live issuance

Fresh reserved chat **`900000741`**, driver execution `3680`.

| | |
|---|---|
| **C1** | `C-900000741-1787854870228` |
| **K1** | `sub_b8c4d6e01df3a6e21172bd2571611ac9` — matches `^sub_[0-9a-f]{32}$` |
| Receipt | `commit_state: READY`, live `Submission_Receipts` |
| Readback | exactly **1** row, `__rows_seen: 1` |
| Pristine | `canonical_lead_id`, `claimed_at`, `settled_at`, `abort_reason` all empty |
| Authority | `cycle_id` **and** `submission_key` persisted together |
| Lead Intake | **not reached** — `NOT_LEAD_READY`, as §3 requires |

---

## 4. §4 — turn 2, lead-ready under current authority

The session was seeded to a genuinely lead-ready state — consent in the **current** cycle,
contact name, company, email, service — and then driven with an ordinary `/contact` message.
`IF Lead Ready` was **not** bypassed; it evaluated the real predicate on the real session.

**A wrong turn worth recording.** The first attempt seeded `state: CONSENT_REQUESTED` and came
back `NOT_LEAD_READY` with `detail: consent_requested`, despite `consent` being exactly `"yes"`.
The dispatcher reads *any* text as a consent reply while in that state, and `/contact` is not an
agreement. Re-seeding `state: MENU` — the honest fix, not a bypass — produced the real path.

Driver execution `3688`, child `3689`:

| | |
|---|---|
| `__harness_outcome` | **`AUTHORITY_CURRENT`** |
| `authority.__current` | **`true`** |
| `__held_cycle_id` | `C-900000741-1787854870228` (**C1**) |
| `__current_cycle_id` | `C-900000741-1787854870228` (**C1**) |
| `__held_key_present` / `__current_key_present` | `true` / `true` |
| Session advanced | `state: LEAD_SENT`, `status: lead_pending` |

### Ordering, from execution data

```
14  Build Session Row
15  Save Bot Session          ← authority write
16  IF Lead Ready             ← the gate
17  Authority Reread          ← the reread
18  Authority Verdict         ← the comparison
19  IF Authority Current
20  HARNESS Result (Authority Current)
```

No safety-relevant node ran before, or in place of, the reread. Combined with the domination
result in §1.2, no node **can**.

---

## 5. §5 — AUTHORITY DRIFT / STALE CONTEXT LIVE PROOF

Same chat, same lead-ready session. The turn holds `C1/K1`; the injection writes `C2/K2` after
the authority write and before the reread.

* **C2** = `C-900000741-1787855999999` (a strictly newer stamp)
* **K2** = `sub_c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2`

Driver execution `3692`, child `3693`:

| | |
|---|---|
| `__harness_outcome` | **`STALE_AUTHORITY`** |
| `authority.__current` | **`false`** |
| `__reason` | **`AUTHORITY_CYCLE_SUPERSEDED`** |
| `__held_cycle_id` | `C-900000741-1787854870228` |
| `__current_cycle_id` | `C-900000741-1787855999999` |
| Emitted event `detail` | `authority_stale: AUTHORITY_CYCLE_SUPERSEDED` |
| Emitted event `raw_json` | `{"held_key_present":true,"current_key_present":true,"lead_handoff_suppressed":true}` |

### What the stale execution did NOT do

| | |
|---|---|
| call Lead Intake | **0** — and structurally impossible: the harness contains **zero** `httpRequest` nodes |
| claim K1 or K2 | **no** — `Receipt Preallocate`/`Readback` did not run (`CARRY`, `__preallocate: false`) |
| bind a canonical lead | **no** — `lead_id` empty, `lead_cycle_id` empty |
| expose K1 or K2 | **no** — the event records only key **presence** as booleans; neither key value appears |
| overwrite current authority back to C1/K1 | **no** — the only write was upstream of the drift |
| return ordinary success | **no** — it terminated on the stale branch |

### Ordering, from execution data

```
15  Save Bot Session
16  HARNESS Drift Compose      ← competing winner, injected
17  HARNESS Drift Write        ← row now says C2/K2
18  IF Lead Ready
19  Authority Reread           ← observes C2/K2
20  Authority Verdict          ← AUTHORITY_CYCLE_SUPERSEDED
21  IF Authority Current       ← false
22  Build Stale Authority Event
23  HARNESS Result (Stale Authority)
```

Intake/send nodes that ran: **0** of 24.

**This is not a concurrency test and is not reported as one.** What was measured is that a
process holding stale local state cannot proceed once current authority has moved. That is the
safety property; how the state became stale is not.

---

## 6. §6 — is true concurrent issuance still needed?

> **TRUE CONCURRENT CONCIERGE ISSUANCE: NOT REQUIRED FOR SAFETY**
> **Reason: random distinct keys + authority winner + pre-handoff reread.**

The reasoning, stated so it can be disputed rather than trusted:

1. **Keys cannot collide.** The mint is `require('crypto').randomBytes(16)` — 128 bits. Two
   overlapping issuers produce distinct keys, so the receipt store never has to elect a winner.
2. **Each issuer preallocates under its own key**, so there is no contention in
   `Submission_Receipts` at all.
3. **`Bot_Sessions` `appendOrUpdate` is last-write-wins**, and that *is* the election. Model B
   does not ask the receipt store to decide who won.
4. **The loser is stopped by the pre-handoff reread**, which is indifferent to how it lost — now
   proven live for `AUTHORITY_CYCLE_SUPERSEDED`.
5. **A mixed pair is not producible.** Each write is one full-row API call and Sheets serialises
   them, so no row can carry A's cycle with B's key. And even if one could, `Authority Verdict`
   compares **both** halves — same cycle with a different key yields
   `AUTHORITY_KEY_SUPERSEDED`, which is also a refusal.

**Unchanged and still open, and true concurrency would not fix it:** the window between the
reread and the Intake call. Closing that needs a compare-and-set the Sheets node does not offer.
P7.2 said so; it is still true.

---

## 7. §7 — the literal blank `submission_key`

Fresh chat **`900000742`**, seeded with a real cycle and a **literally empty** key — a row the
issuer cannot produce, because every mint writes a key. Ordinary navigation (`/menu`), Mini App
inactive. Driver execution `3696`.

| Requirement | Result |
|---|---|
| no new cycle merely because the key is blank | **PASS** — `cycle_id` unchanged at `C-900000742-1700000000000` |
| no receipt preallocation | **PASS** — `__preallocate: false`, `Receipt Preallocate` never ran |
| no `submission_key` minted | **PASS** — still `""` |
| existing Telegram funnel usable | **PASS** — turn completed, reply composed, `state: MENU` |
| no Lead Intake call | **PASS** — structurally zero |
| no browser exposure | **PASS** — no client-facing node executed |
| row does not grow unexpected columns | **PASS** — same column set; no `__`-prefixed key reached the sheet |

The decision was `LEGACY_NO_KEY` / **`LEGACY_CYCLE_NOT_BACKFILLED`** — the issuer's own name for
this case. **No receipt was fabricated for the historical cycle**, and the state tool has no code
path that could have.

A lead-ready Mini App action on such a row would fail for want of a key. That is acceptable while
the Mini App is inactive and is classified separately, not as a P7.4 failure.

---

## 8. §8 — the auto-credential guard

P7.3 found that `create_workflow_from_code` attached a live Telegram bot credential
(`FINMENTOR Leads Bot FINAL`) to a node that never requested one. That was recorded in prose and
memory. **Prose does not fail a build.**

`n8n/src/deploy-guard/auto-credential-guard.js` + `scripts/check-auto-credentials.mjs`.

**Policy: ANY auto-assigned credential is a refusal**, unless an exact, explicitly declared
allowlist says otherwise. Not a Telegram blocklist — a guard that only knew about the hazard it
was born from would have to be extended by whoever got surprised next. `HARNESS_ALLOWLIST` is
**empty**, and is a named constant so that emptiness is a stated decision.

The CLI has no `--allow` flag, and a check enforces its absence (comment-stripped, so the header
explaining *why* there is none does not trip it).

| Mutation | Verdict |
|---|---|
| the observed `telegramApi` assignment, verbatim | **FAIL** |
| unexpected Google Sheets assignment | **FAIL** |
| arbitrary unknown credential type | **FAIL** |
| empty `autoAssignedCredentials` | **PASS** |
| field absent entirely (REST path) | **PASS** |
| malformed field (string / number / object) | **FAIL** — "could not look" ≠ "nothing assigned" |
| malformed entry inside the array | **FAIL**, not skipped |
| a `{}` allowlist rule used as a wildcard | **FAIL** |
| exact allowlist rule, wrong node | **FAIL** |
| secrets in the response | never returned — asserted |

**This guard was used, not merely written:** the P7.4 driver's create response was piped through
the CLI (`AUTO_ASSIGNED_CREDENTIAL_NONE`, exit 0) before the driver was run.

---

## 9. §9 — the Telegram trigger safety contract

`n8n/src/deploy-guard/trigger-safety.js`, two roles with exact rules.

**Role `canary`** — a `telegramTrigger` carrying the production bot credential is permitted only
when it is **disabled AND** the workflow is **inactive**; otherwise deployment is refused. Both
halves are required: `active: false` alone is a flag someone can flip. The stronger artifact
property — **zero enabled triggers of any type** — is checked too, because a second entry point
added later would make the Telegram trigger's disabled flag irrelevant.

**Role `harness`** — `telegramTrigger` count must be **zero**. Not disabled: absent. Any Telegram
credential on any node is a refusal. A Code node named `Telegram Client Trigger` is permitted —
it is the substitution the audited `Parse Telegram Update` requires by name — **only** as a Code
node with no credential.

Checked against the real tracked artifacts (wrapper, API projection, both harnesses), plus
mutations: trigger enabled → FAIL; disabled but active → FAIL; `webhookId` restored → FAIL;
second enabled entry → FAIL; **harness entry changed from Code to `telegramTrigger` → FAIL**;
substitute given a credential → FAIL; `telegramTrigger` added under another name → FAIL; unknown
role → FAIL. Plus a control: a trigger bound to a *different* credential is noted, not refused —
otherwise the check would be a blanket ban dressed up as a hazard analysis.

The projection is also checked with `active: true` supplied, which is exactly
`POST_DEPLOY_ASSERTIONS` expressed as the contract: the four-field body cannot carry
`active: false`, so an unexpectedly-active create must be caught on readback.

---

## 10. §10 — the P7.2 contract wording, corrected in place

`docs/P7_2_ISSUER_SPLICE.md` now opens with a superseded-wording notice carrying the precise
contract:

> Write authority after a verified `READY` preallocation. Before any later safety-relevant
> lead-ready or irreversible handoff, reread current authority and require `cycle_id` **and**
> `submission_key` to still match the execution's context.

The concurrency rationale is kept. The invariant is **not** weakened: a stale context may never
perform Lead Intake. The historical text stands, marked.

---

## 11. §11 — cleanup

| | |
|---|---|
| `Bot_Sessions` `900000741` | **deleted**, `rows_remaining: 0`, `residue_zero: true` |
| `Bot_Sessions` `900000742` | **deleted**, `rows_remaining: 0`, `residue_zero: true` |
| `Submission_Receipts` **K1** | **deleted** — the full `READY` row was returned by the delete |
| Receipts for **K2** | none existed; **none was fabricated** |
| Pipeline / downstream writes | **ZERO** — no `httpRequest` or transport node exists in any harness |
| Telegram messages sent | **0** |
| Disposables archived | state tool, base harness, drift harness, cleanup child, driver, plus the P7.3 set |

### 11.1 A reporting flaw the cleanup found in itself

The blank-key cleanup first reported `receipts_deleted = 1` — for a row whose key was empty. The
Data Table delete node carries `alwaysOutputData: true`, so a run matching **nothing** still
emits one synthetic `{}` item, and the result node counted it.

Nothing was wrongly deleted — the raw node output was `{}`, and the K1 delete returned a full
row — but this is the same class of non-evidence as *"the node did not error."* The generator now
drops empty items before counting.

The cleanup child also gained a corrected guard: a **blank** expected key is accepted, and only
blank, because guard 3 still requires exact equality with the sheet. The original form could not
clean up a §7 legacy row at all.

---

## 12. §12 — status

| | |
|---|---|
| ISSUANCE | **LIVE PASS** |
| PREALLOCATION | **LIVE PASS** |
| AUTHORITY WRITE ORDER | **LIVE PASS** |
| AUTHORITY REREAD | **LIVE PASS** |
| STALE CONTEXT REFUSAL | **LIVE PASS** |
| LITERAL BLANK OLD SESSION | **LIVE PASS** |
| TRUE CONCURRENCY | **NOT REQUIRED FOR SAFETY** |

No already-proven G1 work was reopened.

---

## 13. What P7.4 does NOT claim

| | |
|---|---|
| The Concierge is live-ready | **NO.** This is issuance and authority-binding evidence, not a cutover decision |
| The candidate was deployed | **NO** — still not deployed |
| The reread↔Intake window is closed | **NO.** Narrowed. Needs a compare-and-set Sheets does not offer |
| A real overlapping race was run | **NO**, and §6 argues it is not required for safety |
| The Mini App path was exercised | **NO** — still inactive |
| The blank-key row works for a Mini App submit | **NO** — it would fail for want of a key; classified separately |

---

## 14. Next

1. The **cutover decision** — the evidence for issuance and authority binding is now complete.
2. The reread↔Intake window, if it is ever to be closed, needs a storage primitive with
   compare-and-set. That is a design change, not a test.

`p71b` (F17, the `AZ:BE` sweep) is still open for the owner and still blocks nothing.
