# Is there already a durable NEW-event identity? Measured answer: no.

**Date:** 2026-08-30
**Status:** **REPORT ONLY. No DDL applied, no dispatcher built, `lead_id` untouched, Pipeline schema
untouched.**
Closes §1–§3, §6 and §8 of the owner's review. Approves §5 as instructed.

> ### CORRECTED 2026-08-31 — read `NEW_LEAD_GLOBAL_IDENTITY_CONTRACT.md` first
> ### The identity contract described there is now DEPLOYED on both the server and the client.
>
> The headline verdict below stands: **REQUEST_ID AS GLOBAL NEW EVENT IDENTITY = FAIL.** Four
> specific claims underneath it do not, and each was corrected by measurement rather than by
> re-reading:
>
> 1. **§1, the cause of the five blanks.** This document reads them as the public route producing
>    blank identities. It is not. Pipeline column AZ and its writer did not exist until
>    2026-08-25 22:58:59 +03 (commit `3d4d219`); **all five blank rows predate that commit**, the
>    latest by sixteen minutes. No public lead has landed blank since the column shipped. The
>    blank *path* is real — `''` is still accepted and persisted — but it is latent, not observed.
> 2. **§1, "stable across retry — client-dependent on public".** Too generous. The deployed
>    `lead-transport.js` mints one identity per **attempt**, because all four submitters build
>    their payload inside the submit handler. A retry after a lost response is a different request.
>    This is the defect the owner predicted and it is worse than "client-dependent".
> 3. **§1, "Dedup Guard treats a matching `request_id` as evidence of the same submission".**
>    Only when corroborated by a server-derived contact identity. An **uncorroborated** match is
>    ignored, not suppressed — so a reused identity with different contact data produces **two
>    settled Pipeline rows sharing one `request_id`**. That, not the blanks, is the state the
>    dispatch key cannot survive.
> 4. **§3, the two-line fix.** Insufficient, as the owner said, and for a second reason: a
>    server-minted fallback cannot be recovered by a retry. Superseded in full.
>
> §1's Mini App row is **correct** — the deployed submit endpoint sets `request_id` to the
> `submission_key`. Note that the non-deployed `n8n/src/miniapp-submit/submit-handler.js` declares
> the opposite (`stable_across_attempts: false`); see the corrected document before touching either.
>
> §7's `dispatch_key` becomes sound only under the tested candidate, not under §3.
>
> The superseded text below is left standing rather than rewritten: it is the record of what was
> measured on 2026-08-30, and this block is the record of why four of its claims were wrong. With
> this correction the document no longer contradicts the identity candidate.

---

## 1. `request_id` — audited on all three routes

### Origin and rule

```js
// Normalize + Score Lead
// "request_id is generated in the BROWSER (lead-transport.js) and a caller may also supply
//  their own via payload.meta.request_id. It is a correlation and retry key, never proof of…"
const requestId = String(meta.request_id ?? incoming.request_id ?? '').trim().slice(0, 80);
```

| | **PUBLIC** | **CONCIERGE** | **MINI APP** |
|---|---|---|---|
| origin | minted in the browser by `lead-transport.js`, or supplied by the caller | `meta.request_id` set by the Concierge to its correlation id (`C-<user>-<ts>`) | `meta.request_id` set by the submit endpoint to the derived `submission_key` |
| generation rule | client-side, **not server-controlled** | server-side, deterministic | server-side, deterministic (`sub_` + sha256 of the session) |
| exists before `Save to Pipeline` | only if the caller sent one | yes | yes |
| always persisted | **no** — `''` is a permitted value | yes | yes |
| retry reuses it | if the client resends it | yes | yes — same session ⇒ same key |
| merge reuses/changes it | **CHANGES IT**: `upd.request_id = advance(ex.request_id, item.request_id)` | same | same |
| a refusal can persist it | no — a refusal never reaches `Save to Pipeline` | no | no |
| two separate NEW requests can share it | **yes** — caller-controlled, and `Dedup Guard` treats a matching `request_id` as evidence of the *same* submission | no in practice | no in practice |
| blank possible | **YES** | no | no |

### Measured against production data

Read structurally through a disposable Sheets reader (created, read, deleted — deletion verified;
nothing written):

```
total rows                  = 11
non-empty request_id rows   = 6
blank request_id rows       = 5
duplicate request_id groups = 0
maximum duplicate count     = 0
duplicate lead_id groups    = 0
```

**All five blanks are public website leads** — `https://www.finmentor.md/…` — which is precisely the
route this identity was supposed to cover:

```
FIN-1787647511532-911   (blank)   https://www.finmentor.md/
FIN-1787678806037-388   (blank)   …?utm_source=qa_remediation
FIN-1787678964034-677   (blank)   …?utm_source=qa_remediation
FIN-1787678982297-787   (blank)   …?utm_source=qa_remediation
FIN-1787686944609-617   (blank)   …?utm_source=qa_schema
```

The six non-blank values are four different shapes — a Concierge correlation id, three ad-hoc
`fmr_*` strings from QA and provisioning runs, one synthetic proof row, and one Mini App
`submission_key`. There is no single minting authority.

### Verdict against the eight required properties

| # | property | verdict |
|---|---|---|
| 1 | durable on the canonical Pipeline NEW row | **FAIL** — 5 of 11 rows are blank |
| 2 | available on PUBLIC / CONCIERGE / MINI APP | **FAIL** — the public route produced blanks in production |
| 3 | stable across retry/replay | pass on the internal routes; client-dependent on public |
| 4 | distinct across genuinely separate NEW requests | **FAIL** — caller-controlled, and a shared value is *deliberately* read as the same submission |
| 5 | absent from failed/refused non-settlements | pass |
| 6 | recoverable later without execution history | pass where present |
| 7 | independent of row number / sheet ordering | pass |
| 8 | cannot be changed by merge/update | **FAIL** — `Build Merge Update` advances it |

**REQUEST_ID AS GLOBAL NEW EVENT IDENTITY = FAIL** on four of eight.

## 2. The other existing candidates

| candidate | verdict |
|---|---|
| `submission_key` | **FAIL property 2.** `Receipt Gate` makes it structurally impossible on the public route: `receiptRequired = trusted && keyValid && correlationId !== ''`, and `trusted` is proven by the graph. A public caller that sends one is ignored by design |
| `correlation_id` | **FAIL property 1.** Derived from `meta.request_id` (so it inherits every defect above) and is a *receipt* column — it is not persisted on the Pipeline row at all |
| any other Pipeline column | none is an event identity. `ga_client_id`, `ga_session_id`, `first_touch_at`, `utm_*` are attribution; `sla_*` are workflow state |

No composite was invented, and none of the forbidden substitutes (row number, `created_at` alone,
`lead_id + created_at`, a content hash, the Telegram user id, `app_session_id`) was considered as an
identity.

> **NO EXISTING GLOBAL NEW-EVENT IDENTITY = TRUE**

## 3. The minimum system-wide correction — proposed, NOT implemented

The cheapest correction does **not** touch `lead_id`, does **not** add a Pipeline column, and does
**not** add a store. It makes the column that already exists actually mean something:

1. **Mint `request_id` server-side when the caller does not supply one.** In
   `Normalize + Score Lead`, replace the `?? ''` fallback with a generated identity
   (`crypto.randomUUID()`), so the column is never blank on any route.
2. **Freeze it on the NEW row.** In `Build Merge Update`, stop advancing `request_id` — a merge
   advances the lead, not the identity of the request that created it.

Both are one-line changes to two nodes. Dedup is unaffected: `Dedup Guard` already ignores blank
`request_id` when corroborating (`filter(r => r.request_id !== '' && …)`), so a server-minted value
where there was previously a blank cannot make two unrelated rows look like the same submission —
it can only stop them being compared, which is what a blank did anyway.

It does not repair the five historical blanks. It does not need to: they predate this work and no
alert is owed for them.

**Not implemented in this pass.** It is a change to Lead Intake's scoring node and its merge
builder, and it is the owner's call whether that lands before or with the outbox.

## 4. `lead_id` — the finding stays open, and the outbox must not inherit it

```
LEAD_ID UNIQUE AUTHORITY = OPEN
current generator: FIN-${Date.now()}-${Math.floor(Math.random() * 1000)}
no storage layer enforces uniqueness: the Pipeline is a Google Sheet, Submission_Receipts is an
n8n Data Table, neither has a unique index
```

Empirically it is currently clean — **0 duplicate `lead_id` groups across all 11 rows** — and it is
non-blank everywhere, which is more than `request_id` can say. It is nonetheless excluded as the
outbox primary key by instruction, and that instruction is right: an identity with a 1e-3
same-millisecond collision probability and no constraint anywhere should not become a new
system's uniqueness authority. **Not changed in this pass.**

## 5. Preferred contact — approved behaviour, recorded

- **normal first-settlement enqueue:** snapshot the authoritative preferred channel and its one
  value into `payload_json`; render the already-approved «Связь» line;
- **reconciliation after a lost enqueue:** use the authoritative preference if it is durably
  recoverable (public only, via `Save Lead to CRM`.`Raw JSON`); otherwise **omit the «Связь» line**;
- **inference by presence is FORBIDDEN** — never Telegram because Telegram exists;
- maximum one channel and one value; no Pipeline column authorised in this phase.

## 6. The reconciler predicate

The discriminators are structural, not temporal. `created_at` is used only to bound the scan.

| what | how it is distinguished | durable field |
|---|---|---|
| **NEW append** | `Save to Pipeline` is `operation: append` — a new lead is a **new row** | the row's existence |
| **MERGE / update** | `Update Pipeline (Merge)` is `operation: update` — it **never appends**, and `Build Merge Update` does not write `created_at` | no new row appears; `created_at` unchanged while `updated_at` moves |
| **REFUSAL** | proven unreachable: no refusal path reaches `Save to Pipeline` | no row exists |
| **audit / digest rows** | they are in **different tabs** — `Dashboard_Feed` (gid 1289462207), `Activity` (gid 623316892) — and the reconciler reads only the Pipeline tab (gid 1883973304) | the tab id |

So the predicate is not a classifier over rows. **Every row in the Pipeline tab is exactly one
settled lead**, and the reconciler's job is only: *does this lead have an outbox intent?*

```
for each row r in Pipeline(gid 1883973304) where r.lead_id <> ''
    and r.created_at >= now() - 24h                    -- a cost bound, not a correctness bound
  INSERT INTO alerts.new_lead_outbox (dispatch_key, request_id, canonical_lead_id, payload_json)
  VALUES ('NEW_LEAD:' || r.request_id, r.request_id, r.lead_id, <model built from r>)
  ON CONFLICT (dispatch_key) DO NOTHING;
```

Identical for PUBLIC, CONCIERGE and MINI APP — that is the point of using the append. Race-safe by
the primary key: two reconcilers issue the same insert and the second affects zero rows.

**It is blocked on §1.** With `request_id` blank on public rows the key cannot be formed, so this
predicate is correct but not yet executable. It becomes executable the moment §3 lands.

## 7. Outbox schema — the one change, and why both ids are stored

Unchanged from `NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md` §4–§10 except the identity columns:

```sql
  dispatch_key       text primary key,   -- 'NEW_LEAD:' || request_id   <- the ONLY dedup authority
  request_id         text not null,      -- the event identity, stored plainly so the key is checkable
  canonical_lead_id  text not null,      -- reference only: NOT a uniqueness authority
```

**Why both.** `request_id` is what the dedup key is derived from, and storing it unhashed means an
operator can verify the key rather than trust it. `canonical_lead_id` is what a human and the
Command Center actually act on — it is the `<code>` footer of the alert, the join back to the
Pipeline row and the receipt, and the handle for resolving a `DELIVERY_UNKNOWN`. Neither can do the
other's job: the lead id is not unique enough to dedup on, and the request id is not what anyone
types into a CRM.

**DDL is NOT applied, and cannot be until §3 lands** — a primary key derived from a column that is
blank on five of eleven production rows would fail on the first public lead.
