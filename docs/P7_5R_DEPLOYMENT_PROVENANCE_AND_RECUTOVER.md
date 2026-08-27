# FINMENTOR — P7.5R: deployment provenance, and the recutover that held

**Phase:** B.2.1-C P7.5R — three-way live materialization, then the controlled recutover.
**Status:** **PASS.** Model B is **deployed in production**. The transport expressions are intact,
the Telegram identity is unchanged, and no tracked artifact was deployed — the deployed object was
materialized from the live workflow with the tracked candidate supplying only a patch.
**Mini App: still inactive. Lead Intake: unchanged. No `setWebhook`. `origin/main` untouched.**

---

## 0. Preconditions

| | |
|---|---|
| HEAD | `a2aba3f` as specified, tree clean |
| `origin/main` | `d69e2e8` — untouched |
| QA before | 21/21 gates, 1090 assertions |
| Production | matched the P7.5 rollback-restored baseline: `versionId 2b98eba9…`, 33 nodes, `active true`, **0** `submission_key` refs |

---

## 1. §2 — the redactor could not tell code from data

The old rule redacted by **field name**:

```
(?<="(?:chat_?[Ii]d|chatId|…)"\s*:\s*")[^"]*   ->   <REDACTED_CHAT_ID>
```

It replaced the value of any chat-id-named field whatever the value was, so `={{ $json.chat_id }}`
— a template containing no identity at all — became a marker in every tracked export. That is the
whole of the P7.5 failure.

`n8n/src/deploy-guard/redactor.js` is the canonical replacement. It decides by **value**, walking
the parsed object rather than regexing serialized text:

| input | result |
|---|---|
| `={{ $json.chat_id }}` | **preserved byte-for-byte** |
| `={{ $('Node').item.json.chat_id }}` | preserved |
| `={{ $json.token }}` | preserved — the variable's *name* is not a secret |
| `"123456789"` under a chat field | **redacted** |
| `123456789` as a number | **redacted** |
| `1234567890:AAH…` bot token | **redacted**, anywhere it appears |
| `sk-…` / `AIza…` | **redacted** |
| `={{ "1234567890:AAH…" }}` | token removed, **expression kept** |
| `'1584265787'` in a Code body | preserved — a canonical sheet gid, not an identity |
| `'123456789'` in a Code body | redacted — the hardcoded-owner shape |

The PowerShell `ConvertTo-Redacted` was corrected to match for the snapshots it writes; a gate
asserts the corrected rule is present there and is honest that this is a structural check, not a
claim of behavioural equivalence.

---

## 2. §1 — the tracked artifacts, classified

`n8n/artifact-classification.json`, generated and gated.

**The policy is stronger than the brief's minimum, on purpose:**

> **NO TRACKED ARTIFACT IS PRODUCTION-DEPLOYABLE.** Not the redacted ones, and not the clean ones
> either.

P7.5 was not someone deploying a file marked unsafe. It was a file nobody had marked at all
turning out to be unsafe for a reason no gate was looking for. Narrowing the ban to "the ones we
know are bad" reproduces exactly that failure mode.

| | |
|---|---|
| artifacts classified | **20** |
| `REDACTED_REFERENCE_ONLY` | **17** — every production export, both candidate chains, both harnesses |
| `INSTRUMENT` | 3 — disposables, deployable only as their own workflow |
| **production-deployable** | **0** |

Historical evidence is kept, never deleted: the redacted export is precisely the audit baseline
the materializer compares the live workflow against.

---

## 3. §4 — the re-baseline, and why it is not a silent one

Every tracked reference was produced by the *old* redactor, so `R(L) == A` could not hold until
they were rebuilt. `scripts/rebaseline-production-reference.mjs` does not overwrite `A` with
`R(L)`. It diffs them to the **leaf** and requires every difference to be one of two kinds:

| kind | count |
|---|---|
| `EXPRESSION_RESTORED` — marker in old-A, n8n expression in `R(L)` | **3** |
| `OTHER` (genuine drift) | **0** |

```
+ nodes[Send Client Message].parameters.workflowInputs.value.chat_id
+ nodes[Send Intake Confirmation].parameters.workflowInputs.value.chat_id
+ nodes[Send Recovery Message].parameters.workflowInputs.value.chat_id
```

Exactly the three nodes P7.5 destroyed, and nothing else. The first version of this classifier
masked whole fields instead of leaves and reported three parameter *blocks* as drift when one leaf
differed — recorded because a blunt comparison is what caused this phase in the first place.

`pinData: {}` arrived with the live read and joined the import-safe strip list: pin data is
test-run state, and the API declines to store it on write, so carrying it would be a field that
silently does nothing.

---

## 4. §3 — the three-way materializer

`n8n/src/deploy-guard/materializer.js`. Generic; it knows nothing about the Concierge.

```
A  tracked REDACTED reference        B  tracked desired candidate        L  fresh LIVE workflow

1. R(L) == A ?                    else BASELINE_DRIFT, stop
2. delta = B - A, every op policy-approved
3. C_live = apply(delta, L)       only approved paths come from B
4. C_live - L == the approved delta, exactly
5. C_live satisfies the ABSOLUTE invariants, alone
```

**Step 3 is the one that matters.** `Send Client Message` is not in the delta, so its parameters
are never read from `B` — they come from `L`, real expression and all. The redaction cannot reach
the deployed object because the redacted document is not a source for anything the delta does not
name. `copy all of B over L` is exactly what this replaces.

**Step 5 is what P7.5 lacked.** Steps 1–4 are comparative, and a comparative check cannot see a
defect present on both sides. The absolute invariants look only at `C_live`.

One difference between A and B is a property of the review candidate rather than a desired
production change: the candidate's name. It is declared `topLevelFromLive` and **recorded as
retained**, not silently dropped and not wrongly applied.

---

## 5. §13/§14 — the recutover

Evidence, all safe to print. No raw workflow JSON appears in this document.

| | |
|---|---|
| `A` tracked redacted sha256 | `47cdd12e3489d4e8ee4194cdbde6a5ba1f630dfaa49eed116dd589454869136e` |
| `B` desired candidate sha256 | `420af53eeb5a63d6c91ea13a6e8dc1af57e691ab63b628ae70003e1a1ca565c0` |
| `L` live baseline sha256 | `6b6e625e0c0d6a88e0aa37729671024a56f414acd7fc82507fb0f53ef8caaea3` |
| `R(L)` sha256 | `47cdd12e…9136e` — **identical to A** |
| **`R(L) == A`** | **YES** |
| approved delta | **31 ops** — add 12, setField 5, rewire 14, topLevel 0, remove 0 |
| retained from live | `name` |
| `C_live` sha256 | `a6d2f8aac394f0d9efd2c7817e5fd6824bac8345354cf9a44cf9b253bbbaac0e` |
| `L → C_live` matches delta | **YES** |
| absolute invariants | **PASS** |
| rollback anchor sha256 | `a769572f886d6ad221daf78e7d4d3af800019faec957704ff8f006eec9de4307` (33 nodes, from LIVE) |

`C_live` was built in memory, PUT from memory, and read back into memory. **It was never written
to disk.**

### Post-recutover proof (independent read)

| | |
|---|---|
| workflow id | `mppzthlkSJFr6Kle` — **unchanged** |
| `active` | **true** |
| nodes | **45** |
| `triggerCount` / telegramTriggers | 1 / 1 |
| trigger | **enabled**, `webhookId fa4cd08a…` unchanged, credential `2JnVm0BIX0Z8tvBf` unchanged |
| `availableInMCP` | **false** |
| `errorWorkflow` | `RBiFLhVjizMkAzrK` — unchanged |
| **redaction markers** | **0** |
| executable drift vs `C_live` | **NONE** |
| `submission_key` references | 0 → **102** |
| Model-B issuance nodes | **8/8** present |
| `Send Client Message` `chat_id` | `={{ $json.chat_id }}` **PASS** |
| `Send Intake Confirmation` `chat_id` | `={{ $json.chat_id }}` **PASS** |
| `Send Recovery Message` `chat_id` | `={{ $json.chat_id }}` **PASS** |

`versionId`: `2b98eba9…` → **`ff6c8103-6823-4666-86fd-c50d4ec89a01`**.

No `setWebhook` by anything. No workflow created. No activate/deactivate. `active` is not in the
update schema, so the write could not have changed it.

---

## 6. §12 — the mutation battery

`qa/materializer.test.mjs`, 31 checks. Every mandatory mutation refuses at the right stage:

| # | mutation | stage |
|---|---|---|
| 1 | a marker shared by A and B, deployed directly | `ABSOLUTE_INVARIANTS` |
| 2 | live drifted from the tracked reference | `BASELINE_DRIFT` |
| 3 | the candidate changes an unapproved node | `POLICY` |
| 4 | an approved delta overwriting the chat expression | `POLICY` |
| 5 | an approved node whose new body carries a marker | `ABSOLUTE_INVARIANTS` |
| 6 | the Telegram credential changes | `POLICY` |
| 7 | the trigger `webhookId` changes | `POLICY` |
| 8 | a second trigger added | `POLICY` |
| 9 | a Code body changes outside the approved set | `POLICY` |
| 10 | a live literal reaching the evidence | asserted absent |
| 11 | a tracked redacted artifact supplied as `L` | `INPUT` |
| — | a node removal | `POLICY` — never approvable |
| — | an added node carrying an unapproved credential | `ABSOLUTE_INVARIANTS` |
| — | an introduced literal chat identity | refused |
| 13 | unknown Bot_Sessions write key | see §7 |
| 14 | an empty extra sheet column after cleanup | see §8 |

Plus controls, so the battery cannot pass vacuously.

---

## 7. §10 — the Bot_Sessions writer contract, proven at RUNTIME

Static scanning is not enough, and the brief says so. `qa/cutover.test.mjs` **executes** the
deployed `Build Session Row` body with `__debug`, `__do_write`, `key` and `p71_absent_column`
planted on the session object, and requires the emitted row to be a projection over the declared
columns:

```
stray keys reaching the writer input : 0
emitted row keys                     : exactly the declared COLS
```

The body already worked this way — `for (const c of COLS) row[c] = …` is a whitelist projection,
not a spread — which is why the *production* writers never widened the sheet. What widened it was
P7.4's state tool, whose feeder had no COLS at all. That case is rejected by the structural guard,
which requires every `autoMapInputData` writer to be fed by a declared row builder.

---

## 8. §9 — the schema footprint guard

`n8n/src/deploy-guard/schema-footprint.js`. Row residue and **schema** residue are different
things, and P7.4 checked only the first.

The guard also refuses the shortcut that hid the problem: `footprintFromRows()` throws, because
the Sheets node omits keys for empty cells and an all-empty column is invisible in row objects. A
footprint may only be built from **the header row read as data**.

| check | |
|---|---|
| an appended **empty** `__debug` column after cleanup | **FAILS** |
| the three columns P7.4 actually left (`__do_write`, `__mode`, `__before`) | **FAIL** against the pre-P7.4 footprint |
| a column disappearing unauthorised | **FAILS** |
| an **authorised** removal — how F17 will close | **PASSES** |

---

## 9. §11 — F17: OWNER CLEANUP PENDING

Live tail, measured 2026-08-27 by reading the header row as data:

```
AV submission_key   AZ key                        BF __do_write
AW lead_mode        BA __rows_seen                BG __mode
AX lead_priority    BB __advance                  BH __before
AY financial_zone   BC __reason
                    BD __verified_submission_key
                    BE p71_absent_column
```

**Nine** dead trailing columns, all empty on all 27 customer rows, `A:AY` intact.

**Not executed, and the credential control was not weakened.** `p71b-column-sweep.ps1` needs the
Sheets credential in an HTTP Request node; that credential forbids it, P7.1 called the control
sound, and the brief forbids relaxing it. The Sheets *node* cannot express a column range —
`startIndex`/`numberToDelete` are declared only for `toDelete: "rows"` at v4.7 — so deleting
columns through it means guessing undeclared parameters against a live customer sheet.

**Runbook to close it** (one owner action, outside this session):

1. In the n8n UI, temporarily permit the Sheets credential for `sheets.googleapis.com` in HTTP
   Request nodes — or use a separate one-time admin credential scoped to that host.
2. Widen the sweep's range from `AZ:BE` to **`AZ:BH`** (six → nine columns).
3. `pwsh scripts/p71b-column-sweep.ps1 -Mode AUDIT`, then `-Mode SWEEP`. Its nine internal proofs
   already include the post-delete `A:AY` cell-for-cell comparison.
4. Re-restrict the credential. `-Teardown`.
5. Record the authorised removal against the schema-footprint guard.

**F17 does not block the recutover:** the runtime schema contract uses header names, no code
references `AZ:BH`, the footprint guard is live, and the writer contract prevents further columns.
**F17 must close before general Mini App activation.**

---

## 10. §6 — ephemeral handling

`L`, `C_live` and the rollback body are sensitive. `C_live` never touched disk at all. The live
export and the rollback body lived in an ACL-restricted directory **outside** the repository,
were hashed, and were deleted with deletion verified:

| file | sha256 | fate |
|---|---|---|
| `L-live.json` | `3fc752a9…9371` | deleted |
| `rollback-body.json` | `a769572f…4307` | deleted |
| `post-cutover.json` | `9c418b53…1097` | deleted |

The P7.5 scratchpad snapshots were purged in the same pass. Sensitive files inside the repo: **0**.
This document contains hashes, counts and path names only.

---

## 11. §16 — status

| | |
|---|---|
| **MODEL-B CONCIERGE** | **PRODUCTION DEPLOYED** |
| **P1-L11** | **PASS** — production issues `submission_key` |
| P1-L2 | RETIRED · P1-L2′ **PASS** · P1-L3 **PASS** |
| P1-L4 | PARTIAL — tenant restart still not tested |
| P1-L5 | post-P6.4 ruling stands · P1-L8 **OPEN** (retention duration) |
| P1-L9 | live NEW/MERGE evidence stands · P1-L10 **PASS** |
| F10 / F11 / F13 | LIVE CLOSED |
| F16 | **GUARDED** — writer contract + runtime projection + footprint guard |
| F17 | **OWNER CLEANUP PENDING** |
| G5 | **OPEN** separately |
| **GENERAL MINI APP ACTIVATION** | **NOT CLEARED** |

Redacted-artifact provenance is **no longer a blocker**: the three-way materializer is built,
gated by 31 checks, and was the thing that actually performed this deployment.

---

## 12. What P7.5R does NOT claim

| | |
|---|---|
| A live Telegram turn was observed | **NO** — passive observation only; no approved synthetic identity, so no smoke test |
| F17 closed | **NO** |
| Mini App activation | **NOT CLEARED** |
| The reread↔Intake window closed | **NO** — narrowed at P7.2, unchanged |
| Lead Intake deployed | **NO** — the architecture now covers it, but nothing was deployed |
| PS and JS redactors are behaviourally identical | **NO** — the PS check is structural and says so |

---

## 13. Next

1. **F17**, via the runbook in §9.
2. **G5**, and gateway / Mini App activation readiness.
3. The first real customer turn through Model B is worth watching for `Bot_Events` rows carrying
   `authority_stale` or `ISSUANCE_FAULT` — both are designed outcomes, and neither has yet been
   seen in production traffic.
