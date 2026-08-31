# NEW LEAD alert — the three routes, measured separately

**Date:** 2026-08-30
**Status:** closes §1–§5 of the owner's review. **No DDL applied. Nothing deployed.**
Supersedes the reconciler and contact sections of `NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md`.

Everything below is read from the deployed graph and the persisted stores. No route is generalised
from another.

> ### CORRECTED 2026-08-31 — the dispatch key changed; §1, §2 and §5–§9 stand
> ### The identity contract the new key rests on is DEPLOYED; the outbox itself is not built.
>
> **§3 and §4 propose `dispatch_key = 'NEW_LEAD:' || canonical_lead_id`. That is superseded** by
> `NEW_LEAD_GLOBAL_IDENTITY_CONTRACT.md`, which keys on the persisted Pipeline `request_id` under
> the corrected identity contract and demotes `canonical_lead_id` to a payload and reference field.
>
> §3's own verdict is why: the `lead_id` generator is a millisecond plus three random digits with
> no unique index in any store, so its "distinct for genuinely separate leads" row is **FAIL**, and
> that finding remains **OPEN and unchanged** — `lead_id` is not touched by the candidate.
>
> §4's reconciler predicate is otherwise correct and survives intact: **a NEW lead is a row
> APPENDED to the Pipeline**, identically on all three routes. Only the key it inserts changes,
> plus one rule §4 does not yet state — a row with **no** canonical request identity (the five
> legacy blanks) yields **no** intent and is reported `LEGACY_IDENTITY_MISSING`.
>
> With this correction the document no longer contradicts the identity candidate. §3 and §4 are
> left standing as the measurement that produced the `lead_id` uniqueness finding, which is what
> disqualified that key in the first place.

---

## 1. The route matrix

| | **A — PUBLIC WEBHOOK** | **B — TELEGRAM CONCIERGE** | **C — PREMIUM MINI APP** |
|---|---|---|---|
| entry | `Webhook` | `Internal Subworkflow Trigger` | `Internal Subworkflow Trigger` |
| internal provenance | not proven | proven by the graph | proven by the graph |
| **Submission_Receipt exists** | **NO** | **YES** | **YES** |
| why | `Receipt Gate`: `receiptRequired = trusted && keyValid && correlationId !== ''`. A public caller that *sends* a key is ignored, deliberately — an error that fires only for real keys is an existence oracle | `Send Lead to Intake (Internal)` + `Receipt Preallocate` | submit endpoint preallocates; proven live on `sub_37643f…` |
| canonical settlement authority | the **Pipeline append** (`Save to Pipeline`) | receipt `READY→COMMITTED`, `lead_mode='new'` | receipt `READY→COMMITTED`, `lead_mode='new'` |
| `canonical_lead_id` authoritative from | `Normalize + Score Lead` (generated) | same, or the caller's `submission_lead_id` when internal provenance is proven | same |
| durably persisted in | Pipeline, CRM, Dashboard_Feed, Activity, Lead_Answers | **Pipeline + receipt** | **Pipeline + receipt** (+ the 72 h session, which is not authority) |
| replay resolves to the same identity | n/a — a repeat is deduped to a **merge**, not a new lead | YES — `Internal Result (Committed Replay)` returns the receipt's `canonical_lead_id` | YES |
| **preferred contact durably recoverable** | **YES** — `Save Lead to CRM`.`Raw JSON` | **NO** | **NO** |

The last row is the asymmetry that decides §4: `Save Lead to CRM` is reached **only from the public
branch**. Measured:

```
                                public  internal
Save to Pipeline                  (upstream of the split — both)
Save Lead to CRM                   YES      no
Save Answers to Lead_Answers       YES      no
Save Activity                      YES      no
Append Dashboard_Feed              YES      no
```

## 2. A receipt-only reconciler is NOT sufficient — and the fix is not a new machine

Public NEW has no receipt, so scanning receipts would leave **one of the three routes permanently
unrecoverable**. The minimum authority common to all three is already in production:

> **A NEW lead is a row APPENDED to the Pipeline.**

- present on all three routes — `Save to Pipeline` is upstream of the internal/public split, and
  `reach('Save to Pipeline') ∋ 'Receipt Commit (New)'` is asserted;
- **distinguishes NEW from merge** — the merge writer is `update`, never `append`, and
  `Build Merge Update` **does not write `created_at`** (measured), so a merged row keeps its
  original creation time while `updated_at` moves. A recent `created_at` therefore means *this row
  was created now*, on any route;
- **distinguishes NEW from refusal** — a refused or unresolved intake never reaches
  `Save to Pipeline`, so no row exists;
- **stable across replay** — a committed replay appends nothing; a public repeat is deduped into a
  merge, which appends nothing.

This is **not a second settlement machine.** It is the existing canonical record of a lead, read
through the Sheets node the workflow already uses (`Read Pipeline (Dedup)`), so **no closed surface
is widened and no gate is weakened.** The receipt remains the settlement authority for the internal
routes; the Pipeline append is the *reconciliation* authority, and on the internal routes the two
agree by construction because the append happens before the commit.

## 3. The dispatch key, against all six required properties

`dispatch_key = 'NEW_LEAD:' || canonical_lead_id`

| property | verdict | evidence |
|---|---|---|
| authoritative | **PASS** | assigned in `Normalize + Score Lead`, written to the Pipeline row, the receipt's `canonical_lead_id`, and the Mini App session's `lead_id` |
| immutable | **PASS** | nothing rewrites a new lead's id; `Build Merge Update` carries the *existing* lead's id on a merge |
| available on PUBLIC / CONCIERGE / MINI APP | **PASS** | every route appends a Pipeline row carrying it |
| stable across replay | **PASS** | the committed-replay result returns the receipt's `canonical_lead_id`; a public repeat merges |
| unavailable for failed/refused intake | **PASS** | proven unreachable — a refusal never reaches `Save to Pipeline` or `Receipt Commit (New)` |
| **distinct for genuinely separate leads** | **FAIL — reported, not patched** | see below |

### The missing authority

```js
const leadId = (provenanceTrusted && submissionLeadId)
  ? submissionLeadId
  : `FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
```

Millisecond plus a three-digit random. **No store constrains it**: the Pipeline is a Google Sheet
with no unique index, the receipt table is an n8n Data Table with no unique index, and nothing
else asserts it. Two leads created in the same millisecond collide with probability 1e-3.

Consequence for this design, stated plainly: in that case the second lead's intent is swallowed by
`ON CONFLICT DO NOTHING` and **one lead goes unannounced**. No composite key was invented, as
instructed — a composite of `lead_id` and `created_at` would not help, because a same-millisecond
collision shares both.

**The missing authority is a uniqueness constraint on `canonical_lead_id` itself.** It is a
system-wide property, not an alerting one: today nothing would notice two leads sharing an id. The
minimum fix is more entropy at generation (a `crypto.randomUUID()` suffix), which is a change to a
fenced node in Lead Intake and would not repair historical rows. **Not proposed here.**

## 4. Commit → enqueue recovery, proven per route

The reconciler reads recent Pipeline rows and inserts the deterministic intent:

```
rows := Read Pipeline (Sheets node, same credential and tab already in use)
        filtered in code to created_at >= now() - 24h
for each row:
    key := 'NEW_LEAD:' || row.lead_id
    INSERT INTO alerts.new_lead_outbox (dispatch_key, payload_json, ...)
    VALUES (key, <model built from the row>, ...)
    ON CONFLICT (dispatch_key) DO NOTHING
```

| route | recoverable? | how |
|---|---|---|
| **PUBLIC** | **PASS** | the Pipeline row exists whether or not anything else ran |
| **CONCIERGE** | **PASS** | same row, appended before the receipt commits |
| **MINI APP** | **PASS** | same row; proven on the real lead — the row existed at 18:13:38, the receipt settled at 18:13:41 |

Race safety: two reconcilers running together both issue the same insert; the PRIMARY KEY makes the
second affect zero rows. One outbox row, always. It creates intents and nothing else — **no lead,
no receipt change, no Pipeline write, no Lead Intake re-run, no client call.**

## 5. Preferred contact — inference by presence is rejected

| route | outcome | why |
|---|---|---|
| **PUBLIC** | **A — durably available** | `Save Lead to CRM`.`Raw JSON` holds the payload, including the client's stated `preferred_contact` |
| **CONCIERGE** | **B — not durably recoverable** | the internal branch never reaches `Save Lead to CRM`; the Pipeline has `email`, `phone`, `telegram` values but **no column for the client's choice** (`preferred_meeting_format` is a meeting format, not a contact channel) |
| **MINI APP** | **B — not durably recoverable** | same. The draft does carry `contact_channel`, but it lives in the 72 h Mini App session, which the reconciler is forbidden to depend on and which expires |

**Rule adopted:** the *normal* path snapshots the stated preference into `payload_json` at enqueue,
so a normally-dispatched alert always renders the approved «Связь» line exactly as the client chose.
A *reconciled* alert on an internal route **omits the «Связь» line entirely** rather than guessing.
Presence-based inference is forbidden: it can contradict the client's choice, and telling the owner
to phone someone who asked to be reached on Telegram is worse than telling them nothing.

**Option C, proposed and NOT applied:** one column, `preferred_contact`, on the Pipeline row would
make it recoverable on all three routes and would let a reconciled alert render the line faithfully.
It is a Pipeline schema change, and new Pipeline columns were explicitly unauthorised in the
previous pass, so it is recorded here as a decision for the owner and nothing more.

## 6. `payload_json` — the exact contract

Every field is required by `renderNewLead(model)` in the gated `n8n/src/lead-alerts/presenter.js`.
Nothing else is stored.

| field | source of truth | why the renderer needs it | nullable | retention |
|---|---|---|---|---|
| `company` | Pipeline `company` / payload `client.company` | the identity line, bold at the top | no — renders `—` | 30 d, then deleted |
| `role` | Pipeline `role` | the second identity line; omitted when absent | yes | 30 d |
| `objective` | `work_interest` | the «Задача» card | yes | 30 d |
| `situation` | `main_pain` | the «Ситуация» card | yes | 30 d |
| `priority` | receipt `lead_priority` / Pipeline `priority` | the «Приоритет» label | yes | 30 d |
| `zone` | receipt `financial_zone` | the second dimension, labelled so it cannot read as the first | yes | 30 d |
| `nextAction` | Pipeline `next_action` | the «Следующий шаг» card | yes | 30 d |
| `contactChannel` | the client's stated preference at settlement | selects the ONE approved contact line | yes — omitted when unknown (§5) | 30 d |
| `contactValue` | the value for that channel only | the line is useless without it; **personal data, and the only such field** | yes | 30 d, and the reason the retention rule exists |
| `source` | `tool` / `source_page` | the «Источник» line | yes | 30 d |
| `leadId` | `canonical_lead_id` | the `<code>` footer the Command Center acts on | no | 30 d |

Excluded, by measurement rather than by assertion: **no `raw_json` in any form**, no Telegram
`initData`, no `hash`/`auth_date`/signature material, no Mini App draft envelope, **no alternate
contacts** (one channel, one value, maximum), no scores, no diagnostics, no debug payload.

## 7. State machine — exact transitions

```
                    ┌──────────────────────── claim (atomic) ───────────────────────┐
                    ▼                                                               │
   [PENDING] ───────┴──► [CLAIMED] ──confirmed 2xx──────────────► [SENT]  ■ terminal
        ▲                    │                                    (+ sent_at, telegram_message_id)
        │                    ├──confirmed pre-send / API error──► [RETRYABLE] ──┐
        │                    │                                                  │
        │                    └──ambiguous transport failure─────► [DELIVERY_UNKNOWN] ■ manual
        │                                                                       │
        └───────────────────── backoff: next_attempt_at ────────────────────────┘

   [RETRYABLE] ──attempt_count > max──► [DEAD] ■ manual review
```

Allowed: `PENDING→CLAIMED`, `RETRYABLE→CLAIMED`, `CLAIMED→SENT`, `CLAIMED→RETRYABLE`,
`CLAIMED→DELIVERY_UNKNOWN`, `RETRYABLE→DEAD`.

**Forbidden, and enforced by the claim predicate rather than by convention:** the claim matches
only `status IN ('PENDING','RETRYABLE')`. `SENT`, `DELIVERY_UNKNOWN` and `DEAD` are therefore
unclaimable — **`SENT` can never be sent again, and `DELIVERY_UNKNOWN` can never be blindly
resent.** Both leave the state machine only by a human decision.

## 8. The atomic claim

```sql
update alerts.new_lead_outbox
   set status = 'CLAIMED', claimed_at = now(), attempt_count = attempt_count + 1
 where dispatch_key = $1
   and status in ('PENDING','RETRYABLE')
   and next_attempt_at <= now()
returning dispatch_key, payload_json, attempt_count;
```

**Winner:** one row — `dispatch_key`, `payload_json`, `attempt_count`. That row IS the authority to
send. **Loser:** zero rows, and zero rows is zero authority; it does nothing and does not retry.
Under `READ COMMITTED` the second worker blocks on the row lock, re-reads the committed row, sees
`CLAIMED`, and its `WHERE` no longer matches. One statement, no `SELECT`-then-`UPDATE` anywhere.

## 9. What remains unapproved

The DDL, indexes, roles, grants, RLS decision, retention and rollback are unchanged from
`NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md` §4, §5, §7, §10, with one correction folded in from §5
above: the reconciler needs `SELECT` on the outbox only, and needs nothing new anywhere else.

**Nothing has been applied. Nothing has been deployed.**
