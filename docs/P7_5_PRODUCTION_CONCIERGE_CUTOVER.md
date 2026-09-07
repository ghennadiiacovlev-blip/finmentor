# FINMENTOR — P7.5: the cutover was applied, failed fidelity, and was rolled back

**Phase:** B.2.1-C P7.5 — controlled production Concierge Model-B cutover.
**Status:** **FAIL — ROLLED BACK, exact restoration proven.** The production workflow was updated
in place, the post-write readback found a defect that no offline gate could have seen, and it was
reverted within minutes. **Model B is NOT deployed.** Production is byte-identical to its
pre-cutover state.
**Customer impact: none observed.** Zero executions occurred between the write and the rollback.
**Mini App: still inactive. Lead Intake: unchanged. No `setWebhook` by anything.**

---

## 0. Preconditions

| | |
|---|---|
| HEAD | `ab0061b` as specified, tree clean, branch `feat/miniapp-b21c-live-prereqs` |
| `origin/main` | `d69e2e8` — untouched |
| QA before | **20/20 gates, 1056 assertions** — no decrease |
| Production baseline | matched P7.4 exactly: `versionId f560f7f3…`, `updatedAt 2026-08-25 17:39:02`, 33 nodes, `triggerCount 1`, `webhookId fa4cd08a…`, credential `2JnVm0BIX0Z8tvBf`, **0** `submission_key` refs |
| Structural hash | `a0ce72c3c702be36cf326ca0f8c262953408d5990e72cea0b02f3941747e9e29` |

No drift. Cleared to proceed.

---

## 1. §1 — F17 AZ:BE: **NOT EXECUTED**, and the premise turned out to be wrong

Two independent reasons, either of which alone is decisive.

### 1.1 The tooling is blocked by a control that should stay

`scripts/p71b-column-sweep.ps1` was built for exactly this and is well designed — it uses the
Sheets v4 `deleteDimension` API through an HTTP Request node, because that takes an explicit
0-based half-open range that cannot be off by one silently, and because it is one atomic request
rather than six.

It cannot run:

```
NodeOperationError: This credential is configured to prevent use within an HTTP Request
or GraphQL node
```

The Google Sheets credential carries a domain restriction forbidding HTTP-node use. P7.1 met this
already and called it *"a sound control … a blocker, not a complaint."* It fires on the **first**
node, so even the read-only AUDIT mode cannot run. **Relaxing a deliberate security control to
make a hygiene task convenient is not a trade this phase made.**

The Sheets **node** is worse, not better: at `typeVersion 4.7` its `startIndex` and
`numberToDelete` parameters are declared only for `toDelete: "rows"`. The `columns` case exposes
no index parameters at all. Deleting columns through it means guessing undeclared parameter names
against a live customer sheet, and a destructive off-by-one is not recoverable by noticing it
afterwards.

### 1.2 The premise no longer holds — there are NINE dead columns, not six

A read-only audit (`scripts/build-p75-column-audit.mjs`) measured the live header row:

```
AV submission_key      AZ key                        BF __do_write
AW lead_mode           BA __rows_seen                BG __mode
AX lead_priority       BB __advance                  BH __before
AY financial_zone      BC __reason
                       BD __verified_submission_key
                       BE p71_absent_column
```

**`BF`, `BG` and `BH` are new, and this project added them.** The P7.4 synthetic state tool's
`Tool Plan` node returned `{ __do_write, __mode, __before, …row }` straight into a node carrying
`Save Bot Session`'s `autoMapInputData` parameters. F16 again — the instrumentation built to prove
the system safe widened the live sheet in exactly the way the system was being proven safe
against. P7.4's cleanup verified **rows** and never checked **columns**.

So §1's precondition *"AZ:BE physically trailing"* is **false**: `BF:BH` follows. Per §1's own
rule — *"If any condition fails: DO NOT DELETE"* — the deletion must not proceed as specified.

**What is confirmed:** all nine are physically trailing, all nine are empty on all 27 customer
rows, `A:AY` is intact and correctly ordered, and zero synthetic `900000xxx` rows remain.

### 1.3 An audit that lied to me first

The first version of this audit reported all six columns **absent**. That was an artifact of the
method: the Sheets node returns each row keyed by header and **omits keys whose cell is empty**,
so a column blank on every row is invisible. Reading the header row *as data*
(`headerRow: 1, firstDataRow: 1`) fixes it — in that row every column carries its own name, so
nothing is empty and nothing can hide. Same class of non-evidence as *"the node did not error"*,
and it is recorded because it nearly became the phase's answer.

### 1.4 To close F17

One owner action: temporarily permit the Sheets credential for `sheets.googleapis.com` in an HTTP
node, run `p71b-column-sweep.ps1 -Mode SWEEP` **with its range widened from AZ:BE to AZ:BH**, then
re-restrict the credential. Its nine internal proofs are already written and its post-delete
`A:AY` cell-for-cell comparison is the right check.

---

## 2. §2/§3 — the cutover artifact and its classification

`scripts/build-concierge-cutover.mjs`. Not the canary wrapper — a cutover **updates in place**, so
identity is preserved rather than neutralised:

| | |
|---|---|
| workflow id | not in the body at all — it is the URL of the PUT |
| `active` | not in the body at all — the update schema accepts only `{name, nodes, connections, settings}`, so the live lifecycle is preserved **by construction** |
| Telegram trigger | carried verbatim from production — same credential, same `webhookId`, still enabled |
| name | taken from **production**, not the candidate, because renaming the live workflow is a visible change Model B does not require |

Classification of every difference:

| | |
|---|---|
| `MODEL_B_REQUIRED` | **31** — 12 added issuance/authority nodes, 5 declared Code-body changes, 14 rewired edge sources |
| `GENERATED_METADATA_ONLY` | 0 |
| `UNEXPECTED` | **0** |

Settings identical. Zero production nodes removed. The five modified inherited nodes changed
`parameters` only — a credential or type change on even a declared node is classified UNEXPECTED.

**And it was all true, and it was not enough.** See §3.1.

---

## 3. §6/§7 — the write, and the defect the readback found

The PUT succeeded. The immediate readback was, on every axis §7 names, correct:

| | |
|---|---|
| workflow id | `mppzthlkSJFr6Kle` — unchanged |
| `active` | **True** — preserved |
| nodes | 45 |
| `triggerCount` / telegramTriggers | 1 / 1 |
| trigger | enabled, `webhookId fa4cd08a…`, credential `2JnVm0BIX0Z8tvBf` — all unchanged |
| settings | identical, `availableInMCP: false` |
| executable fingerprint | **artifact and live matched exactly** — `ccef253d…761b` |
| Code bodies | all 21 byte-exact |
| `submission_key` refs | 0 → **102** |

Every stated post-cutover check passed. The cutover was, by every gate this project had, correct.

### 3.1 THE DEFECT — the repo's production exports are redacted, and every generator inherited it

`ConvertTo-Redacted` in `scripts/n8n-lib.ps1` strips bot tokens, API keys and Telegram chat ids
before an export reaches git. That is right and must stay.

But **every generator builds from that redacted export.** So the candidate — and therefore the
wrapper, the API projection and this cutover artifact — carried `<REDACTED_CHAT_ID>` where
production has `={{ $json.chat_id }}`:

| node | production | what was deployed |
|---|---|---|
| `Send Client Message` | `={{ $json.chat_id }}` | `<REDACTED_CHAT_ID>` |
| `Send Intake Confirmation` | `={{ $json.chat_id }}` | `<REDACTED_CHAT_ID>` |
| `Send Recovery Message` | `={{ $json.chat_id }}` | `<REDACTED_CHAT_ID>` |

**Consequence:** the bot would have kept running, kept issuing keys, kept writing authority rows —
and been unable to reply to anyone, because every reply was addressed to a literal string.

**Why nothing caught it.** Every fidelity check in the chain compared a derivative against the
**same redacted source**, or against another derivative of it. *A marker present on both sides of
a diff is invisible to that diff.* The checks were not weak; they were pointed at the wrong
baseline. The live readback matched the artifact perfectly — because the artifact was wrong.

It was found by asking a question no gate asked: *can the committed export serve as the rollback
body?* It cannot, and the reason it cannot is the same reason the cutover was broken.

### 3.2 Blast radius: every deployable artifact in the repo

| artifact | markers |
|---|---|
| `production/mppzthlkSJFr6Kle.*.json` | 8 |
| `candidate/concierge-issuer-candidate.json` | 4 |
| `candidate/concierge-issuer-IMPORT-SAFE.json` | 4 |
| `candidate/concierge-issuer-API-IMPORT.json` | 4 |
| `candidate/lead-intake-internal-receipt-candidate.json` | 8 |
| `candidate/lead-intake-internal-receipt-IMPORT-SAFE.json` | 4 |
| `candidate/lead-intake-internal-receipt-API-IMPORT.json` | 4 |
| both harnesses | 1 each |

**No artifact generated from a tracked export has ever been deployable.** P6.1's Lead Intake
wrapper and P6.2's API projection carry the same defect; they were never deployed, so it stayed
latent until a real cutover.

The **live evidence from P7.3 and P7.4 stands**: the harnesses exclude all three transport nodes,
so nothing those phases proved depended on the redacted values.

---

## 4. §4/§7 — rollback

The rollback body was prepared and verified **before** the write, from the unredacted live
pre-cutover export — deliberately not from the repo, which turned out to be the whole point.

| | |
|---|---|
| `PRE_CUTOVER_VERSION_ID` | `f560f7f3-ffb3-4877-9b2b-fa9b25364e35` |
| `PRE_CUTOVER_UPDATED_AT` | `2026-08-25 17:39:02` |
| `PRE_CUTOVER_STRUCTURAL_HASH` | `a0ce72c3…9e29` |
| post-cutover versionId | `25283215-ce19-455d-a861-1bd2534d6940` |
| post-rollback versionId | `2b98eba9-8404-42a1-82cd-9ee0b0cae2f6` |

### Exact restoration, proven

| | |
|---|---|
| pre-cutover executable fingerprint | `2120395409c8fd00ba68c2e696ef787e6b4cebca63610a79d4ac58411c07e5a8` |
| post-rollback executable fingerprint | **identical** |
| executable field drift | **NONE** across all 33 nodes |
| Code bodies | all **16** byte-exact |
| connections / settings | identical |
| `active` | `true` → `true` |
| Telegram trigger | byte-identical |
| `<REDACTED_CHAT_ID>` in production | **0** |
| `submission_key` in production | back to **0** |
| `Send Client Message` `chat_id` | `={{ $json.chat_id }}` — restored |

---

## 5. §5 — Telegram safety

No `setWebhook` was called by anything. The existing workflow id was updated in place; no second
Telegram-trigger workflow was created; no workflow carrying the bot credential was POSTed.

One trigger before, one after, both writes. Same credential, same `webhookId`, same enabled
semantics, `active: true` throughout. `active` is not accepted by the update schema, so neither
write could have changed it.

---

## 6. §9 — observation

Passive only; no synthetic identity is within an approved policy, so **no smoke test was run** and
no Telegram message was sent.

The last production execution was `3704` at **18:32:16**, before the cutover at **18:56:09**. No
execution occurred between the write and the rollback, so **no customer traffic met the defective
graph**. The single `error` execution on record is `3368` from 25.08 — two days earlier and
unrelated.

---

## 7. §10 — the Bot_Sessions write guard

`n8n/src/deploy-guard/bot-sessions-schema.js`, enforced by `qa/cutover.test.mjs`. The F16 finding
is now pinned as a check rather than a convention:

1. Every `Bot_Sessions` `autoMapInputData` writer must be fed by a **declared row builder**. A
   writer fed by anything else is emitting an object nobody reviewed — the P7.4 defect exactly,
   and there is a check that reconstructs that shape and requires rejection.
2. Every declared row builder must carry an explicit `COLS` whitelist containing **no**
   `__`-prefixed key and no known-dead column.
3. The nine dead trailing columns are recorded by name, so the count cannot grow again without
   someone editing the list on purpose.

Also added: the cutover generator now **refuses to write** any artifact containing a redaction
marker, checked **absolutely** rather than comparatively.

---

## 8. §11 — G1 status (Model B only; retired Model-A items not carried)

| | |
|---|---|
| P1-L2 | **RETIRED** |
| P1-L2′ | **PASS** |
| P1-L3 | **PASS** |
| P1-L4 | **PARTIAL** — tenant restart still not tested |
| P1-L5 | post-P6.4 ruling stands |
| P1-L8 | **OPEN** — owner retention duration |
| P1-L9 | live NEW/MERGE evidence stands |
| P1-L10 | **PASS** — internal route live and fidelity-valid |
| P1-L11 | **FAIL** — production Concierge does **not** issue `submission_key`; the cutover was rolled back |
| F10 / F11 / F13 | **LIVE CLOSED** |
| F16 | **OPEN** — now guarded in the repo, nine live columns still present |
| F17 | **OPEN** — scope grew from six columns to nine |
| G5 | **OPEN** separately |

**One current blocker, named singly:** the deployable artifacts are generated from redacted
exports. Until a cutover artifact is generated from an unredacted live export, P1-L11 cannot pass.

---

## 9. What P7.5 does NOT claim

| | |
|---|---|
| Model B in production | **NO** — applied, then rolled back |
| The cutover mechanism is unsafe | **NO.** The PUT preserved id, `active`, trigger, credential and `webhookId` exactly, and the rollback restored byte-for-byte. The **mechanism** worked; the **artifact** was wrong |
| F17 closed | **NO** — not executed, and now nine columns |
| Mini App activation | **NOT CLEARED** |
| Lead Intake | **UNCHANGED** |

---

## 10. Next, in order

1. **Regenerate the candidate chain from an unredacted live export**, fetched at build time and
   never committed. This is one change to `build-concierge-issuer-candidate.mjs`'s input, plus a
   rule that the unredacted source is a build-time artifact only.
2. **Re-attempt the cutover.** Everything else in this phase — classification, rollback anchor,
   fidelity proof, Telegram invariants — worked and can be reused as-is.
3. **F17**, with the widened AZ:BH range and one owner credential action.
