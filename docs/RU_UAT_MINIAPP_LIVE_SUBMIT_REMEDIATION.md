# RU Owner UAT — the two real submits, and the three defects only they could find

**Date:** 2026-08-30 (evening pass)
**Branch:** `feat/miniapp-b21c-live-prereqs`
**Scope:** the submit endpoint `ELiPdw4mdxQbBaan` and the Mini App host `KBD7Q94QQnlzgYKJ`.
Lead Intake, the Gateway, the session endpoint, the Concierge and Lead Alerts are not touched.
**Status:** deployed to the owner-only workflows. Not merged. Not customer-activated.

This continues `docs/RU_UAT_MINIAPP_BOOTSTRAP_AND_IDEMPOTENCY.md`, which ends at the 17:25 state.
Everything below was found by the owner pressing «Отправить» on a real device, twice.

---

## 0. Why an offline suite of 2 000 assertions did not see any of this

Each defect lives in a place a model of the system cannot reach:

| defect | where it lives | why the suite could not see it |
|---|---|---|
| the privacy binding | the Postgres node's **parameter resolution** | the runner models the store, not the node |
| the duplicate classifier | the **shape of an n8n error envelope** | the QA fake emitted a bare string on `error`, which any grep matches |
| the missing receipt row | a **contract between two workflows** | the caller was gated alone, against a store that was never asked |

All three are now gated, and the fake reproduces the real envelope.

---

## 1. 14:42 — the first submit, and four hours of silence

The submission failed and stayed failed. **No SYSTEM ALERT fired and no n8n execution record
existed.** It was recovered only because Supabase keeps its own Postgres logs, which still held
two `there is no parameter $1` lines. Why nothing alerted is a separate finding, recorded in
`docs/SYSTEM_ALERT_COVERAGE_GAP.md` and deliberately not fixed in this pass.

### ROOT CAUSE — one sentence

> **`Write Privacy Acknowledgement` declared `$1..$7` and carried `options: {}`, so Postgres
> refused the statement with 42P02 before the transaction began — and the acknowledgement is
> written before the irreversible call, so every submission died there.**

The endpoint then did exactly what it was designed to do: `continueRegularOutput` turned the node
failure into an ordinary item, `Privacy Verdict` refused to claim an unproven acknowledgement, and
the client was answered `503 SUBMIT_UNRESOLVED retryable:true`. **Fail-closed worked. Nothing was
written, and nothing was claimed that had not happened.**

### The second defect, which the first one was hiding

Until the binding was fixed the privacy INSERT had **never once reached the unique index**, so the
duplicate path had never run against a real node. Measured on a disposable table with the same node
type and typeVersion, a unique violation arrives as:

```
json.message = 'duplicate key value violates unique constraint "..."'
json.error   = NodeOperationError — own keys: level, shouldReport, description, tags,
               timestamp, context, functionality, name, node, messages
```

No `23505`, no `duplicate key`, no index name **anywhere in `json.error`** — and the verdict tested
`json.error` alone. A genuine duplicate would therefore have scored `created=0 already=0` and fallen
through to `PRIVACY_UNRESOLVED`, which is the retry path. Shipping the binding without this would
have made the FIRST retry work and stranded every later one.

Both went out in one deploy — `scripts/deploy-privacy-binding-fix.mjs`, two nodes, nothing else.

### One tap = one POST

The same submit produced **two** privacy statements 4.4 s apart. On a disposable probe with the same
node type and typeVersion, one POST produces exactly one node run and one statement, so the second
statement was a second POST, not a server-side double-fire. The client could not easily have made
it — `net.js` has no retry, and `submit()` replaces the screen with one that carries no button — but
that lock was **incidental**, a property of the current rendering rather than a guarantee, and what
a duplicate tap buys is a second irreversible privacy write against the same derived key. Backend
idempotency is not an answer to a client that asks twice. The lock is now explicit and held by
`qa/premium-ux-submit-lock.test.mjs`, which drives the real `app.js` and counts what left.

---

## 2. The second submit — `RECEIPT_ABSENT_INVARIANT_BROKEN`

With privacy writing correctly, the submission reached Lead Intake's receipt gate and was refused.

**Lead Intake has no INSERT into `Submission_Receipts`.** All four of its receipt writes — Receipt
Claim, Receipt Commit (New), Receipt Commit (Merge), Receipt Retry Settlement — are UPDATEs filtered
on `submission_key` plus a `commit_state`, and `Receipt Read Verdict` says so plainly: *a missing row
is a broken invariant, not permission to proceed.*

The Telegram Concierge satisfies that contract with `Receipt Preallocate`. **The Mini App never
did.** Lead Intake is correct and stays fail-closed; the caller is what changed.

### The fix — seven nodes on the caller, one rewired edge

```
IF Privacy Recorded  T→ Receipt Probe          exact-key read of Submission_Receipts
                      → Receipt Probe Verdict  preallocate ONLY on a clean read of zero rows
                      → IF Receipt Needed
                      → Preallocate Receipt    the Concierge row, field for field, commit_state READY
                      → Receipt Readback       a fresh read is the only thing that may authorise
                      → Receipt Verdict        exactly one row, exact raw key, non-empty state
                      → IF Receipt Present  T→ Build Intake Payload → Call Lead Intake
```

`Submission_Receipts` is an n8n Data Table with **no unique constraint and no conditional insert**:
two inserts of one key both succeed and neither errors. So the probe is not decoration — it is the
only thing standing between a retry and a duplicate row. `Receipt Verdict` fails closed on
`DUPLICATE_RECEIPTS` rather than picking one.

`Build Intake Payload` is reachable from **exactly one** node, `IF Receipt Present` — asserted by
walking the deployed connections, not by reading the canvas.

Deployed by `scripts/deploy-receipt-preallocation.mjs`, which refuses to write unless the offline
suite passes in full, exactly the seven declared nodes are added, every pre-existing node is
byte-identical, and only the one declared edge changes. It re-hashes Lead Intake, the Concierge and
the Gateway after the write and fails if any of them moved.

---

## 3. The binding now has a standing gate — offline and live

The defect that took production down had **no gate anywhere**. The builder held the correct string;
nothing asserted it. `options: {}` would have shipped again, green.

`qa/premium-ux-submit-idempotency.test.mjs` now reads the built node and asserts, as one property:

- `queryReplacement` is non-empty;
- the number of segments equals the number of distinct `$n` the statement declares, and the highest
  `$n` is within it;
- every segment carries **its own leading `=`** — n8n splits this field on commas *before* resolving
  each segment, which is also why a comma inside a resolved value cannot shift the binding;
- `$n` binds the column the INSERT names in position `n` — a transposition would put the
  acknowledged-at timestamp in the shown-at column and never fail;
- and the order equals what `privacy-record.insertParams()` supplies, so the node and the module
  cannot drift apart.

**Proven negative, not just positive.** Against the candidate: an emptied binding fails on
`options.queryReplacement is empty`; a binding one segment short fails on `got 6, want 7`; a
transposition of positions 1 and 4 fails on `position 1 binds the wrong field (got "privacy_locale",
want "submission_key")`. The candidate was restored byte-exact after each, checked by sha256.

`scripts/verify-miniapp-bootstrap-live.mjs` asserts the same three properties **off the tenant**,
where a hand-edit in the n8n UI is the way this comes back.

---

## 4. Proof

```
offline   node qa/run-all.mjs
          56/56 gates, 2029 assertions, assertion floors PASS

live      node scripts/verify-miniapp-bootstrap-live.mjs
          156 checks passed. Nothing was written by the script.
```

On the tenant after this pass: the submit endpoint holds **26 nodes**, all seven receipt nodes
present; the served page contains `app.js`, `net.js`, `content.js` and `app.css` **byte-for-byte**
from `app-premium/`; the privacy binding reads back with all seven segments in column order; the
G5 replay claim, the Telegram production key, `MAX_AUTH_AGE_SECONDS`, the 72 h TTL, the owner gates
and zero execution retention are all unchanged.

## 5. Rollback

```
.uat/ELiPdw4mdxQbBaan.pre-binding-fix.json        before the binding + classifier fix
.uat/ELiPdw4mdxQbBaan.pre-receipt-contract.json   before the seven receipt nodes
.uat/KBD7Q94QQnlzgYKJ.pre-contact-fix.json        before the A1 page redeploy
```

Each is the workflow exactly as it was before that write, and none is overwritten by a redeploy.

## 6. Still open

| | |
|---|---|
| **a successful end-to-end submission** | not yet proven — it needs genuine Telegram-signed initData, which only the owner opening the Mini App can produce |
| **customer activation** | BLOCKED — `docs/CUSTOMER_ACTIVATION_BLOCKER_CYCLE_PROJECTION.md` |
| **terminal-5xx alerting** | GAP, recorded deliberately — `docs/SYSTEM_ALERT_COVERAGE_GAP.md` |
