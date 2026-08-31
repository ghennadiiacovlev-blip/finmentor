# The global NEW-event identity contract — measured, built, and half-deployed

**Date:** 2026-08-31
**Status:** **SERVER DEPLOYED AND VERIFIED LIVE. CLIENT NOT IN PRODUCTION — GitHub Pages serves
`main`, and the client exists only on the feature branch. A focused release candidate is cut from
`main` and awaits review; see §8.1–8.2.** The global contract is therefore **NOT
PASS**: one side is live. No DDL applied. No Alert Outbox. `lead_id` untouched. Pipeline schema
untouched. No historical row backfilled. No lead created to prove any of it.

Supersedes, precisely:

| document | what this replaces |
|---|---|
| `NEW_LEAD_EVENT_IDENTITY_AUDIT.md` | §1 (the cause of the five blanks, the Dedup Guard reading), §3 (the two-line fix), §7 (the dispatch key precondition) |
| `NEW_LEAD_ALERT_ROUTE_AUTHORITY_MATRIX.md` | §3 and §4 — the dispatch key |
| `NEW_LEAD_ALERT_OUTBOX_SCHEMA_PROPOSAL.md` | §6 line 101, §7 and §9 — the dispatch key |

Everything else in those three documents stands.

Gates: `qa/lead-intake-request-identity.test.mjs` — **73 assertions**, registered in `qa/run-all.mjs`
(**60/60 gates, 2149 assertions**). Live read-back: `scripts/verify-request-identity-live.mjs` —
read-only, executes the deployed bodies and the published client.

---

## 1. The corrections that made this necessary

The owner's rejection of the proposed two-line fix was right, and the deployed defect was one step
earlier than the audit found.

**The public client minted a NEW identity on every ATTEMPT, not every SUBMISSION.** `postLead`
reused an id already on the payload — but all four submitters build their payload *inside* the
submit handler (`main.js:633`, `questionnaire.html:1580`, `ro/questionnaire.html:1630`,
`working-capital-scan.html:511`), so a visitor who pressed send again after a timeout arrived with
a fresh object and got a fresh id. If the first request committed and its response was lost, the
retry was — to the server — a different request. Proven by executing the pre-identity file, frozen
at `qa/fixtures/lead-transport.pre-identity.js` so the case survives the fix (gate **B-0**).

**The five blank rows have a different cause than recorded.** Pipeline column AZ and its writer did
not exist until commit `3d4d219` at 2026-08-25 22:58:59 +03. All five blanks predate it, the latest
by 16 minutes. No public lead has landed blank since the column shipped. The blank *path* was real
(gate **H-0**) but latent.

**Dedup Guard did not do what the audit said, and the truth was worse.** A matching identity is
honoured only when a server-derived contact identity corroborates it — correct, and untouched here.
But an *uncorroborated* match was not suppressed, it was **ignored**, so a reused identity with
different contact data fell through to contact matching and produced **two settled Pipeline rows
carrying one `request_id`** (gate **E-2**). That is the one state a `NEW_LEAD:<request_id>` outbox
cannot survive. A third defect in the same family: a public caller could plant `sub_<32 hex>` in
column AZ (gate **I-2**).

## 2. The public token lifecycle — exact

> **ONE LOGICAL SUBMISSION = ONE `request_id`**
> **TWO SUCCESSIVE GENUINE SUBMISSIONS = TWO DISTINCT `request_id` VALUES**

The slot is one record per tool in `sessionStorage`:
`{ t: <active token>, d: <retired token>, s: 'idle' | 'active' | 'conflict' }`.

| | event | behaviour | gate |
|---|---|---|---|
| **A** | first POST of a logical submission | mint `fmr_<32 lc hex>` from a CSPRNG, persist under the tool's slot | M |
| **B** | retry after timeout / lost response / transport failure | reuse **exactly** the same token | N, N-1 |
| **C** | page reload before terminal success | reuse **exactly** the same token | O |
| **D** | validation error before settlement | reuse the same token — a rejected payload is still the same logical submission | D |
| **E** | `IDEMPOTENCY_CONFLICT` (409) | slot marked **CONFLICT**. Token **retained**. A further `postLead` on that slot is refused **before the network call**. No automatic retry, no automatic new identity | T |
| **F** | authoritative settlement | token retired to the slot's tombstone; the next genuine submission mints a new one | P, Q, Q-1 |
| **G** | explicit "new request" action | `beginNewSubmission()` retires it the same way, and is the **only** exit from CONFLICT | U, U-1 |
| **H** | back / forward navigation | a retired token can never be re-offered: reuse requires `t !== ''` **and** `t !== d`, and the retirement is written to `sessionStorage` **and** the in-memory fallback, so a bfcache restore of the closure cannot resurrect it | H |

**Content is deliberately NOT part of the slot.** An earlier draft re-minted on a payload
fingerprint change. It was rejected: that makes editing-then-resending a *silent identity rotation*,
which is exactly what (E) forbids. If the first attempt never settled there is no row to conflict
with and the edit simply lands; if it did settle, the edit is a genuinely new intent and must be a
deliberate new submission.

**The conflict is terminal in the client, not just in the server.** A sealed slot refuses to send at
all, so a caller that re-arms its submit button cannot turn a conflict into an automatic retry
(gate **T**: no second request is issued). All five submitters detect it through
`FMLeadTransport.isIdentityConflict(err)`, show one short line, and render the single
`newRequestControl` button — the only thing that mints again (gate **CG-3**).

**One deliberate behaviour regression.** `newRequestId()` no longer falls back to `Date.now()` +
`Math.random()`. A token that cannot be minted with a CSPRNG is not collision-resistant, and
shipping one under an idempotency contract is a lie the server cannot detect. The transport rejects
with `identity_unavailable` and each caller's existing failure copy is shown. That path needs a
browser with no Web Crypto at all (gate **B-7**).

## 3. Success is server-authoritative

HTTP 2xx does not retire a token. The business contract does. Lead Intake answers a settled
submission from exactly three responders — `Respond New Lead` (`mode: new`), `Respond Retry`
(`mode: retry`), `Respond Merged` (`mode: merged`) — and all three carry `ok: true` **and** a
non-empty canonical `lead_id`. That pair is the proof, and nothing weaker is:

| response | token | gate |
|---|---|---|
| HTTP 200 + `ok:false` | **retained** — an edge error page and a proxy read the same as a 2xx | R |
| HTTP 200 + `ok:true`, no `lead_id` | **retained** — not a canonical settlement result | R-1 |
| HTTP 400 `INVALID_PAYLOAD` | **retained** — still the same logical submission | D |
| timeout after the server settled | **retained**; the retry carries it, the server resolves the same canonical lead, and *that* response retires it | S |
| HTTP 409 `IDEMPOTENCY_CONFLICT` | **retained and sealed** | T |

## 4. `IDEMPOTENCY_CONFLICT` = HTTP 409, terminal

```
HTTP 409
{ "ok": false, "error_code": "IDEMPOTENCY_CONFLICT", "retryable": false }
```

Four nodes were added rather than reusing the existing 400 refusal, and the reason is not tidiness.
A conflict is **not** a malformed request: the caller's identity and payload are both well formed
and the refusal is about **state**. A client cannot distinguish *"your request was malformed, fix
and resend"* from *"this identity is spent, start a new submission"* by reading a 400, and those two
demand opposite client behaviour.

```
Dedup Guard ─0─► Identity Conflict? ─true──► IF Internal (Conflict) ─internal─► Internal Result (Conflict)
                        │                              └─public───► Respond Identity Conflict  (409)
                        └─false─► Receipt Gate  (unchanged)
```

Both endpoints are terminal — neither has an outgoing connection — and no Google Sheets node is
reachable from either (gate **C-409-3**). So a conflict creates no lead, overwrites nothing, and
never enters the receipt critical section.

The response **names no column**. Telling a caller which field differs is an oracle for someone who
had to present a valid identity to reach that response; the field list rides on the item as
`identity_conflict_fields` for the operator instead (gate **F-1**).

## 5. The canonical equivalence predicate — frozen

Two requests carrying **one** identity are the **same submission** unless they differ materially.

### The exact sixteen fields, in order

```
name, company, email, phone, telegram,
business_model, industry_category, turnover_range, employees_range,
main_pain, selected_problems, selected_goals, work_interest,
documents_status, selected_documents, preferred_meeting_format
```

Pinned by gate **EQ-1**, which fails on any drift in membership or order. Gate **EQ-2** additionally
requires every one of them to be a real mapped Pipeline column — that is the whole reason this set
was chosen: **the comparison must be recomputable from a Pipeline row alone**, with no schema change
and no execution history, months later, by a reconciler.

`selected_problems`, `selected_goals`, `work_interest` and `selected_documents` are comma-joined
multi-selects and are **set-compared**: re-ordering the same answers is not a different submission.
Scalars are lowercased, `ё`-folded and whitespace-collapsed.

### The exact predicate

> **MATERIALLY DIFFERENT** = at least one field where **both sides are non-empty** and the
> normalised values differ. A blank on either side is a **fill**, not a conflict.

Subsumption, not equality. That is not leniency — it is what keeps the rule stable under repeated
merge. `Build Merge Update.fill()` only ever writes into a blank, so a row legitimately gains fields
from a retry it already absorbed; under an equality rule the third attempt at one submission would
conflict with the row its own second attempt filled in.

### Excluded, and why

`raw_json` is forbidden by instruction and would make **every** retry a conflict — the meta block
alone carries a fresh timestamp per attempt. Also excluded: `created_at`/`updated_at` (a retry
legitimately carries a later clock); `utm_*`, `ga_*`, `analytics_consent`, `source_page`
(attribution and consent describe the visit, not the request); every server-derived score, zone,
priority and reason (including them would break the rule whenever the scorer is tuned); `lead_id`
and `request_id` (identity, not content). Gate **EQ-4** asserts none of them can produce a conflict.

### The required cases, measured

| case | result | gate |
|---|---|---|
| same identity + identical canonical content | retry → resolves to the same lead | EQ-5 |
| same identity + a field **omitted** on the retry | retry. *Rationale:* a blank incoming value is a fill, exactly what the merge already performs. Under equality, a partial retry — a restored form, a client that trims empties — would be indistinguishable from a different submission | EQ-6 |
| same identity + changed **company** | **409** | E |
| same identity + changed **contact identity** (`email`, `name`) | **409.** Contact fields are inside the canonical submission identity by choice: a different person is not a retry, whatever the token says | E-3 |
| same identity + changed **task / problem** | **409** on `main_pain` | F |
| same identity + changed **source / UTM metadata only** | **no conflict** — attribution is outside the identity and must not manufacture a business conflict | EQ-7 |
| different identities, identical content | never a conflict | EQ-8 |

## 6. Canonicalisation, and route crossing

| route | canonical shape | minted by |
|---|---|---|
| **PUBLIC** | `fmr_<32 lowercase hex>` | the browser, once per logical submission |
| **CONCIERGE** | `C-<chat_id>-<epoch ms>` | `Get Bot Session`, one per application cycle |
| **MINI APP** | `sub_<32 lowercase hex>` | the cycle issuer; `Build Intake Payload` sets `correlationId: v.submission_key` |

The prefixes already existed and are **adopted, not replaced**: `sub_` is the key the idempotency
receipt claims on and `C-` is the cycle `Bot_Sessions` stores, so re-minting either would break
`Correlation Guard`, which asserts byte-equality between `Normalize`'s value and
`Internal Auth Entry.__correlation_id`. Canonicalisation is normalisation and **validation only**.
The dashed `randomUUID` spelling folds to the same 32 hex characters, so the value the browser
sends, the value in Pipeline AZ and the value in the thank-you `sid` are one string.

Route crossing is refused in **both** directions, and enforced in `Validate Payload`, whose
provenance comes from the graph (`$('Internal Auth Entry')` throws on the public path) and never
from the body.

`IDENTITY_MISSING`, `IDENTITY_MALFORMED` and `IDENTITY_ROUTE_FORBIDDEN` are answered **400** through
the refusal path that already existed — a malformed identity *is* a malformed request, so no new
responder was needed for it.

**The public token is an idempotency token, not an authority credential**, and nothing here treats
it as one. Provenance is still established by the route n8n authenticates. A caller-supplied
identity still cannot select a row: `Dedup Guard`'s corroboration rule survives verbatim, asserted
before the write and again on the tenant afterwards.

## 7. Immutability — by omission

`Update Pipeline (Merge)` maps with `autoMapInputData`, so **a key absent from the update object is
a column the update does not touch.** Strict immutability was achieved by deleting one line.

The complete census of writers that can reach Pipeline `request_id` (gate **V-2**, re-proved live):

| writer | operation | mapping | can it touch the identity? |
|---|---|---|---|
| `Save to Pipeline` | append | `defineBelow`, maps `request_id` | **yes — once, at NEW settlement** |
| `Update Pipeline (Merge)` | update | `autoMapInputData` ← `Build Merge Update` | **no** — the key is not emitted |
| `Update Pipeline AI Ready` | update | `autoMapInputData` ← `Mark AI Ready` | no — that node emits four keys, none of them the identity |

Every other Sheets writer targets a different tab.

**The defect (gate V-0):** `advance()` fired on a *genuine* (non-retry) merge, so the same contact
returning six weeks later with their own new identity **rotated the original row onto it** — handing
a future reconciler an identity the original alert was never keyed on.

**`keepFirst()` was the tempting alternative** — fill a blank, never overwrite — and was rejected
deliberately: the five legacy rows would acquire an identity from an unrelated later merge, and a
reconciler would then mint a NEW_LEAD intent for a lead settled days earlier. A blank legacy row
must stay blank (gate **V-4**).

## 8. Deployment — order, state, rollback

**Server first.** Measured, not assumed: every official client has emitted a shape-valid `fmr_`
identity since 2026-08-25, and both spellings the deployed transport produced canonicalise cleanly.
So the shape gate could not refuse traffic that was already in flight, and the two deploys are
independent in either order. Server-first additionally closes the blank and foreign-identity paths
immediately.

| | what | how | evidence |
|---|---|---|---|
| 1 | **SERVER** — `QmIyEW2ZEqKregmN`, 102 → 106 nodes | `scripts/deploy-lead-intake-request-identity.mjs --confirm`. It applies the **same transform functions** the candidate generator uses, to the **live body**, so what is gated offline and what is deployed cannot diverge. Four `jsCode` fields changed, four nodes appended, one connection rewired, two added; settings byte-identical; Gateway, submit endpoint and Concierge re-hashed before and after and unmoved | `.uat/QmIyEW2ZEqKregmN.post-request-identity.json` |
| 2 | **CLIENT** — `lead-transport.js` plus the five submitters | on the feature branch as `016bba3`, and cut into the focused candidate `release/public-request-identity` (`e1da4d3`) from `main`. **NOT IN PRODUCTION** — Pages serves `main`; see §8.1–8.2 | `scripts/verify-request-identity-live.mjs` fetches the published bytes; it reports the mismatch and SKIPS the lifecycle cases rather than executing a client that has none of the functions they call |

**The contract is PASS only with both sides live.** The server alone validates, canonicalises,
refuses and detects conflict but cannot make a retry carry the same identity; the client alone
carries one identity per submission into a server that would still advance it on merge. **Today
only the server is live, so `GLOBAL NEW-EVENT IDENTITY CONTRACT = FAIL (deployed).**

The two are independent and the half that is live is strictly an improvement: identities are now
validated, canonicalised, route-scoped, immutable on merge, and conflicting reuse is refused. What
the missing half costs is retry *stability* — a public visitor who retries after a lost response
still sends a fresh identity, exactly as before, so the lost-response case is no better than it was.
Nothing is worse than it was.

### 8.1 The client is not in production because Pages serves `main` — CORRECTED

**An earlier revision of this section claimed the site had "not published since 2026-08-26" and
guessed at a failing Jekyll build. That was wrong, and the error was mine: I compared the live site
against a STALE LOCAL `main` (`cab2328`, 2026-08-25) and never fetched. `origin/main` had moved to
`d69e2e8` on 2026-08-26 and I did not have it.** The Jekyll hypothesis is **DISPROVEN** and no
`.nojekyll` was added.

Measured with authenticated access to the repository's Pages configuration:

| | |
|---|---|
| `build_type` | `legacy` |
| `source.branch` / `source.path` | **`main`** / `/` |
| `cname` / `https_enforced` | `www.finmentor.md` / `true` |
| `status` | `built` |
| latest build | `d69e2e8`, **status `built`**, created `2026-08-26T08:09:24Z`, finished `08:10:01Z`, 37.4 s, **no error** |
| last ten builds | nine `built`; the one `errored` is `de76ec9a` from 2026-08-25, superseded by a successful build 22 seconds later |
| deployments | every one `ref=main` |

The site's uniform `last-modified` of `08:09:59 GMT` is simply **that successful build finishing**.
`main` has not changed since, so the site has had nothing to publish. Pages is healthy.

Content confirms it, by hash rather than by timestamp — nine public assets fetched live and compared
against both refs:

```
live == origin/main (d69e2e8)          9 / 9
live == feat/miniapp-b21c-live-prereqs 4 / 9   (the four that are identical on both refs)

discriminating assets (main != feature): 5
  lead-transport.js  main.js  questionnaire.html
  working-capital-scan.html   ro/working-capital-scan.html
  live == main: 5 / 5      live == feature: 0 / 5
```

**ROOT CAUSE: the public identity client exists only on the feature branch, which Pages does not
serve.** Not a build failure, not a cache, not an infrastructure defect.

**And the feature branch must NOT be merged to fix it.** It carries the Mini App and app-premium
owner-UAT build, the Gateway, n8n exports, Lead Alerts work and the identity design documents —
none of which is authorised for customer production. The release is instead a **focused candidate
cut from `main`**: branch `release/public-request-identity` (`e1da4d3`), **12 files**, the public
website client and its QA and nothing else. See §8.2.

### 8.2 The focused release candidate

`release/public-request-identity`, cut from `main` at `d69e2e8`. Committed locally; **not pushed, not
merged, no PR** — that is the owner's call.

| file | why it is required |
|---|---|
| `lead-transport.js` | the lifecycle itself |
| `main.js`, `questionnaire.html`, `working-capital-scan.html`, `ro/questionnaire.html`, `ro/working-capital-scan.html` | the five submitters that can actually post a lead. Without their conflict branch a 409 shows the generic failure copy and the visitor has **no exit** — the slot is sealed and pressing send does nothing |
| `qa/website-contract.test.mjs` | **mandatory**: main's existing gate asserts the old success contract and goes red against the new transport, so CI on `main` would break without it |
| `qa/fixtures/lead-transport.pre-identity.js` | the frozen pre-identity file the defect proof executes |
| `qa/public-identity-lifecycle.test.mjs` | new, 25 assertions, client-only — **no n8n dependency**, so it can live on `main` |
| `qa/run-all.mjs`, `qa/assertion-baseline.json` | register the gate and raise the floor |
| `.github/workflows/finmentor-quality-gates.yml` | `ASSERTION_BASELINE` 460 → 485, and the cwd-independence step hardcoded `8/8 gates passed` — it would have failed on the ninth gate |

**Deliberately excluded**, and each was checked rather than assumed: every n8n artifact
(candidate JSON, `n8n/src/`, the build/deploy/verify scripts), all four identity design documents,
`app-premium/`, the Gateway, Lead Alerts, the Alert Outbox, cycle projection, and `i18n-ro.js` —
whose only new keys feed `main.js`'s conflict branch on `ro/index.html`, a page that cannot submit
at all (§9), so they are unreachable. Excluding it leaves `main.js` falling back to its Russian
default on that one unreachable path.

Verified on the candidate exactly as CI runs it: **9/9 gates, 485 assertions**, cwd-independent,
46 tracked JavaScript sources parse, secret-scan self-test 17/17 and the scan itself clean over
210 tracked files.

**GLOBAL NEW-EVENT IDENTITY CONTRACT = FAIL** until that candidate is merged to `main` and the
resulting Pages build publishes. Nothing else blocks it: the server half is live and verified, and
`scripts/verify-request-identity-live.mjs` goes green with no further change the moment the client
is served.

**ROLLBACK.**
Server: `PUT /api/v1/workflows/QmIyEW2ZEqKregmN` with
`.uat/QmIyEW2ZEqKregmN.pre-request-identity.json` — the exact pre-image, captured before the write.
`.uat/` is gitignored, so that body lives only on the owner's machine: it is the unredacted live
export and carries the production spreadsheet URL, which is precisely why it is not committed.
Client: nothing to roll back — it is not in production. Once the focused candidate is merged,
`git revert` it on `main` and the next Pages build follows.
The two are independent: reverting either alone leaves a coherent system, degraded to the
pre-identity behaviour on that side.

### The tracked export is deliberately NOT advanced

`n8n/production/QmIyEW2ZEqKregmN.*.json` still describes the **pre-identity** 102-node graph. Seven
gates read it, one of them as the base this candidate is transformed from, and `n8n/history/README.md`
records exactly what happens when a moving reference is also used as a phase fixture. It was already
one deploy stale (the BP/BQ/BR projection fix, `d264642`); it is now two. Gate **0-5** asserts the
staleness explicitly, so a later seal that advances it fails with an instruction rather than with
arithmetic that merely looks broken.

## 9. Found on the way, and NOT fixed here

**`ro/index.html` cannot submit a lead, and never could.** It carries `#consultForm` and loads
`../main.js`, so `initForm()` binds to it — but it does **not** load `../lead-transport.js`.
`postLeadPayload()` therefore rejects with `transport_unavailable` on every submit, and the Romanian
home page has never delivered a lead to the CRM. It fails visibly and closed: the visitor gets the
Telegram/email fallback copy.

It is one `<script src>` away from working. That one line would turn a page which has never produced
leads into one that does — a customer-facing behaviour change, which is not what an identity deploy
is for. It is pinned by gate **CG-1b**, which goes **red if someone fixes it**, forcing the fix to be
a deliberate, documented act rather than a drive-by. **Owner decision.**

## 10. What this unblocks, and what it does not

`dispatch_key = 'NEW_LEAD:' || <persisted Pipeline request_id>` is now sound: no two settled NEW rows
can share an identity (gate **OB-1**), and every settled row yields a key while a legacy row yields
none (gate **OB-2**). `canonical_lead_id` stays a payload and reference field.

**The outbox is still NOT built and its DDL is still NOT approved.** Nothing in this pass created a
table, applied a migration, or issued SQL.

**Still open, and untouched:**

- **`LEAD_ID` UNIQUE AUTHORITY = OPEN.** `FIN-${Date.now()}-${Math.floor(Math.random()*1000)}`, no
  unique index in any store, 1e-3 same-millisecond collision. Gate **0-4** and the deploy script
  both assert the generator is byte-identical to what was there before.
- **SYSTEM ALERT COVERAGE GAP = OPEN.**
- **AUTHORITATIVE CYCLE PROJECTION = OPEN.**
- **`ro/index.html` transport = OPEN** (§9).
- **PUBLIC CLIENT RELEASE = AWAITING OWNER REVIEW** (§8.2). `release/public-request-identity` is
  cut from `main`, gated, and local. Merging it is what moves the contract to PASS.
- **CUSTOMER PRODUCTION = BLOCKED.**

## 11. Artifacts

| path | what it is |
|---|---|
| `lead-transport.js` | the deployed client. One source of truth — there is no separate candidate copy to drift |
| `qa/fixtures/lead-transport.pre-identity.js` | the pre-identity transport, frozen so gate B-0 keeps proving the defect after the fix shipped |
| `n8n/src/lead-intake/identity-candidate/request-identity.js` | the canonical identity module, spliced into `Validate Payload` and `Dedup Guard` so the two cannot drift |
| `scripts/build-lead-intake-request-identity.mjs` | the generator. Repo-only; refuses to write unless every invariant holds |
| `scripts/deploy-lead-intake-request-identity.mjs` | the deploy. Same transforms, live body, dry-run first, read-back verified |
| `scripts/verify-request-identity-live.mjs` | read-only live proof: executes the deployed nodes and the published client |
| `n8n/candidate/lead-intake-request-identity-candidate.json` | the 106-node candidate graph |
| `qa/lead-intake-request-identity.test.mjs` | 73 assertions, offline, no production writes |
