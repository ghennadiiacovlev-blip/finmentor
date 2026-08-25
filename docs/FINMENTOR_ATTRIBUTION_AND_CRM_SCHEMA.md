# FINMENTOR — Attribution policy, CRM schema change, and server-side GA lifecycle

Date: 2026-08-25
Covers: INDP2-05, INDP2-06 (attribution), INDP2-02 (idempotency), INDP2-07 (GA lifecycle)
Status: **DEPLOYED AND LIVE-VERIFIED 2026-08-25.** Columns AZ:BG added by the owner; Lead Intake patched; 53/53 live checks on synthetic identities.

---

## 1. Attribution policy

### 1.1 Definitions

| Touch | Meaning | Written | Overwritten |
|---|---|---|---|
| **first_touch** | What introduced this lead | On the first page load that carries any `utm_*` | **Never** |
| **last_touch** | What converted this lead | On every page load that carries any `utm_*` | Yes, by each later campaign arrival |

Both are stored in `localStorage` as `finmentor_attr_first` / `finmentor_attr_last`, each holding
the `utm_*` values present plus `captured_at` and `landing_page`.

A visitor with a single campaign visit reports the same touch as both first and last. A
visitor who arrives with no campaign reports `null` for both — attribution is never invented.

### 1.2 What changed and why

Capture previously happened **only at submit time**, reading only the submitted page's own
URL, with a `sessionStorage` fallback that was itself only written at submit. A visitor who
landed on a campaign link and navigated once before converting lost their attribution
entirely — the common case for the X-Ray and mini-scan, which are reached from other pages.

Capture now runs on **every page load**, in `analytics.js`, which is loaded in `<head>` on
every page.

### 1.3 Consent interaction

Campaign metadata and GA identifiers are treated differently, deliberately:

- `utm_*` capture is **not** gated on analytics consent. It is first-party campaign
  metadata about how an enquiry arrived, recorded because the visitor chooses to submit a
  form, and it contains no personal data. Gating it would silently destroy attribution for
  every visitor who declines analytics cookies.
- `ga_client_id` and `ga_session_id` **are** gated. They are only read after accepted
  consent, and any stale value is deleted from the payload before each submit.

The regression gate asserts that stored attribution never contains an email, name or phone
even when those appear in the URL alongside the `utm_*` parameters.

### 1.4 Coverage

All five submitters now run `FMAnalytics.enrichLeadPayload` before posting. The mini-scan
previously did not, so its leads reached the CRM with no consent flag, no GA identifiers and
no attribution at all — unlike every other form.

Enrichment attaches to `payload.meta`:

```
analytics_consent          boolean
ga_client_id               only when consent accepted
ga_session_id              only when consent accepted
attribution_first_touch    { utm_*, captured_at, landing_page } | null
attribution_last_touch     { utm_*, captured_at, landing_page } | null
request_id                 stable per submission (from lead-transport.js)
```

### 1.5 Merge and retry policy

| Case | first_touch | last_touch | Rationale |
|---|---|---|---|
| New lead | Store as received | Store as received | — |
| Merge into an existing row | **Keep the row's existing value** | Overwrite with the newer value | The lead was introduced once; that fact does not change |
| Retry (same submission) | Unchanged | Unchanged | A retry is not a new touch |
| Field absent on a later submit | Keep existing | Keep existing | Never overwrite a known value with a blank |

#### Per-field merge policy, as implemented

Implemented in `n8n/src/lead-intake/build-merge-update.js`. Until v3 that node wrote **no
attribution whatsoever** — not even the pre-existing last-touch `utm_*` columns — so every
rule in this section was unimplemented on the only path where merges actually occur. The
deploy script patched three nodes and silently skipped this one.

A retry is defined by `Dedup Guard`: either a match inside the two-minute window, or a
`request_id` corroborated by a server-derived identity (2.5). On a retry every rule below is
a no-op.

| Column | On a genuine later submission | On a retry | Never |
|---|---|---|---|
| `request_id` | take the new value when non-empty | unchanged | — |
| `analytics_consent` | take the new value when the key is present, **including `false`** | unchanged | — |
| `ga_client_id`, `ga_session_id` | write only when the new submission's consent is `true` **and** the value is non-empty | unchanged | never erased by a blank or by a later refusal |
| `utm_source_first`, `utm_medium_first`, `utm_campaign_first`, `first_touch_at` | keep the stored value; populate only if it is blank (legacy rows) | unchanged | never overwritten once known |
| `utm_source`, `utm_medium`, `utm_campaign` (last touch) | overwrite when the new value is non-empty | unchanged | never erased by a blank |

**When a later submission carries `consent = false`,** explicitly: `analytics_consent` is
updated to `FALSE`, no new GA identifiers are written, and any GA identifier already stored
is **retained**. The identifiers were collected lawfully under the consent in force at the
time, and a form submission is not a withdrawal request. Because the server-side GA4 sender
in section 3 is gated on `analytics_consent = true`, recording the `FALSE` is what actually
stops downstream analytics for that lead. Withdrawal and erasure are a separate process and
are deliberately **not** implemented here.

`Update Pipeline (Merge)` uses `autoMapInputData`, so these keys reach the sheet as soon as
the columns exist — which is also why the deploy script refuses to run before then.

---

## 2. REQUIRED: CRM schema change

**APPLIED 2026-08-25.** This was the single blocker for three findings. It needed the owner to add columns to the
`Pipeline` tab, because the Lead Intake `Save to Pipeline` node maps columns explicitly
(`defineBelow`) and will fail on a column the sheet does not have.

The `Pipeline` schema **was 51 columns, A:AY**, ending at `days_in_stage` — verified against the
live header and corroborated by the 51 columns `Save to Pipeline` mapped. It carried
`utm_source`, `utm_medium` and `utm_campaign` but no field for consent, GA identifiers, first
touch, or a request key.

**It is now 59 columns, A:BG.** The owner appended AZ:BG on 2026-08-25; the first 51 were
verified byte-for-byte unchanged, with no duplicates and no gap column.

### 2.1 Columns added

Appended to the **end** of the `Pipeline` header row, in this order. Appending at the end
shifts no existing column, so no formula, filter or Dashboard view that references the
previous layout was affected.

| # | Col | Column | Purpose | Finding |
|---|---|---|---|---|
| 52 | AZ | `request_id` | Client-minted correlation / retry key — **not** server-owned, see 2.5 | INDP2-02 |
| 53 | BA | `analytics_consent` | Whether analytics consent was accepted at submit | INDP2-05 |
| 54 | BB | `ga_client_id` | GA4 client id, only when consent accepted | INDP2-05 |
| 55 | BC | `ga_session_id` | GA4 session id, only when consent accepted | INDP2-05 |
| 56 | BD | `utm_source_first` | First-touch source | INDP2-06 |
| 57 | BE | `utm_medium_first` | First-touch medium | INDP2-06 |
| 58 | BF | `utm_campaign_first` | First-touch campaign | INDP2-06 |
| 59 | BG | `first_touch_at` | When the first touch was captured | INDP2-06 |

The existing `utm_source` / `utm_medium` / `utm_campaign` become explicitly **last-touch**.

### 2.2 Why this was not done automatically

Adding columns is a schema mutation of the production CRM. It is reversible, but it is the
owner's data model: hidden formulas, pivot ranges, filter views or external Looker/Power BI
bindings can depend on the exact shape, and none of that is visible from the n8n API. A
remediation phase should not silently reshape the system of record.

### 2.3 After the columns exist — DONE

Run:

```
pwsh scripts/deploy-attribution-columns.ps1            # dry run, verifies the header first
pwsh scripts/deploy-attribution-columns.ps1 -Apply
```

The script refuses to run unless it reads the live `Pipeline` header and finds all eight
columns present, so it cannot half-apply.

### 2.4 What this then closes

- **INDP2-02** — `request_id` becomes a **corroborated** retry key; see 2.5 for why it can
  never be a standalone tier. Concurrent duplicates become detectable and repairable.
  Note this still does not make the append *atomic*: Google Sheets offers no
  conditional-append, so a true fix requires either a lock row or moving the ledger to a
  store with compare-and-set. The column makes the race **detectable and reconcilable**,
  which is the achievable improvement here.

### 2.5 `request_id` is NOT server-owned — trust rules

An earlier revision of this document called `request_id` a "server-owned idempotency key"
and the deploy script gave `Dedup Guard` a standalone strong tier on it. Both were wrong.

`lead-transport.js` mints the value **in the browser**, and the same function accepts one
supplied by the caller:

```js
var requestId = String(payload.meta.request_id || options.requestId || '') || newRequestId();
```

A standalone strong tier on an attacker-controllable field hands back exactly the capability
INDP1-02 removed: anyone who learned a `request_id` could name the row it belongs to and
merge into it. It would have been the caller-`lead_id` defect wearing a different field name.

**Rules now enforced in `dedup-guard.js`:**

| Caller | Rule |
|---|---|
| Public / untrusted | A `request_id` match selects a row **only when that same row is also reached by a server-derived identity** — normalised `email`, `phone` or `telegram`. The combination means "this submission is arriving again", so it is treated as a same-submission retry: no escalation, no attribution change. |
| Public / untrusted | `request_id` **alone never selects any row.** It falls through to the ordinary contact tiers, and an unmatched submission becomes a new lead. |
| Authenticated internal | The trusted `lead_id` path remains the strong canonical tier, and is reached only via the authenticated internal route in section 5. |

Calling it "server-owned" would only become accurate if minting moved to the server. That is
a larger change, is not proposed here, and until it happens the field must be described as
what it is: a client-supplied correlation and retry key.
- **INDP2-05** — consent and GA identifiers become structured CRM fields instead of living
  only inside Raw JSON in the `Leads` archive.
- **INDP2-06** — first-touch is preserved through merges as a distinct dimension.

---

## 3. Server-side GA4 lifecycle — BLOCKED_EXTERNAL_SECRET

### 3.1 Blocker

Sending `qualify_lead`, `won` and `lost` to GA4 requires a **Measurement Protocol
`api_secret`**, created in the GA4 UI under Admin → Data Streams → Measurement Protocol API
secrets. That value does not exist in this environment.

**No secret was invented, and none was placed in this repository.** No workflow was created,
because a workflow that cannot authenticate would sit in the tenant looking functional while
silently doing nothing — the same failure mode as the Digest.

### 3.2 Design, ready to implement once the secret exists

**Configuration and secret placement — CORRECTED:**

| Value | Where it belongs | Why |
|---|---|---|
| `ga4_measurement_id` = `G-94L9B8WZ12` | ordinary configuration — Settings tab is fine | it is public; it ships in the page source already |
| GA4 Measurement Protocol `api_secret` | **n8n Credentials / secret storage only** | it is an authentication secret |

An earlier revision of this document said to store the `api_secret` in the Settings sheet.
That was wrong and is retracted. **A Google Sheet is not a secret store:** the tab is visible
to everyone the spreadsheet is shared with, it is copied into every export, download and
backup, it is readable by every workflow that reads Settings for any other reason, and it has
no rotation, scoping or audit trail. The same reasoning retires `internal_intake_key` in
section 5.

The secret must not appear in this repository, in Google Sheets, in workflow JSON exports, in
node parameters, or in execution logs.

**Trigger**: the Command Center mutation path already writes stage changes to `Status_Log`.
A lifecycle sender hangs off that same write, so GA lifecycle events and the CRM audit trail
cannot diverge.

**Taxonomy**:

| CRM transition | GA4 event |
|---|---|
| stage → Qualified | `qualify_lead` |
| stage → Won | `won` |
| stage → Lost | `lost` |

**Payload rules — ZERO PII:**

```
client_id     required by GA4; send ONLY the stored ga_client_id, and ONLY when
              analytics_consent is true for that lead. If either is missing, do not send.
events[].params:
  lead_priority, financial_zone, business_model, industry_category, turnover_range
  utm_source / utm_medium / utm_campaign   (last touch)
```

Never sent: `lead_id`, name, company, email, phone, Telegram, page URL, free text, or any
`request_id`. `user_id` is never set, because it would be a durable link to a real person.

**Consent gate**: a lead with `analytics_consent = false` produces no server-side event at
all. There is no fallback to a synthesised `client_id`, because inventing one would create a
GA identity for a visitor who declined analytics.

This design depends on section 2 being applied first: without `ga_client_id` and
`analytics_consent` as structured columns, the sender has nothing to read.

---

## 4. Status

| Item | Status |
|---|---|
| Every-page-load attribution capture | **DONE** |
| First-touch / last-touch model and policy | **DONE** |
| Mini-scan enrichment parity | **DONE** |
| GA identifiers gated on consent | **DONE** (verified) |
| Attribution stored without PII | **DONE** (verified) |
| Merge-path attribution policy | **DONE** — `build-merge-update.js` v3, gated |
| `request_id` corroborated trust rules | **DONE** — `dedup-guard.js`, gated |
| Structured CRM attribution columns | **DONE** — AZ:BG live, deployed and verified |
| Atomic idempotency | **PARTIAL** — corroborated retry key live; true atomicity needs a store with compare-and-set |
| Internal provenance without a Sheets secret | **DESIGNED** — section 5, needs the n8n credential |
| Server-side GA4 lifecycle | **BLOCKED_EXTERNAL_SECRET** — section 3 |

---

## 5. Internal provenance — no secret in Google Sheets

### 5.1 What was wrong

`Normalize + Score Lead` proved internal provenance by comparing an
`x-finmentor-internal-key` request header against `internal_intake_key` read from the
**Settings sheet**. Two independent defects:

1. **A spreadsheet is not a secret store**, for all the reasons in section 3.
2. **It never worked.** Neither `Settings to Object` implementation — the Lead Intake node or
   `n8n/src/command-center/settings-to-object.js` — exposes `internal_intake_key` in its
   whitelist, so the lookup always returned empty and `provenance_trusted` was permanently
   `false`. The branch was dead code.

The second point is why simply adding a Settings row would not have been enough, and why
doing so would have been actively harmful: it would have put a live authentication secret
into the spreadsheet and switched on a trust path that had never once executed.

The saving grace is that the failure was closed: with `provenance_trusted` false, a caller
`lead_id` is never honoured. **That safe default is preserved.**

### 5.2 The design

Provenance is established by the **route**, not by a shared secret:

- the public Website Lead Intake webhook stays publicly callable and is unchanged;
- internal callers (the Telegram Concierge) reach a **dedicated internal entry** whose
  credential n8n enforces itself — a Header Auth credential on a separate webhook path, or an
  Execute Workflow sub-workflow call, where provenance is structural and needs no secret;
- the credential lives only in n8n Credentials, never in Sheets, the repo, node parameters,
  exports or logs.

`normalize-score-lead.js` now reads a marker set by the workflow graph:

```js
function internalRouteProven() {
  try { return $('Internal Auth Entry').first().json.__internal_route === true; } catch (e) { return false; }
}
```

This fails closed by construction. On the public path that node never ran, `$()` throws, and
provenance is `false`. The marker is deliberately never read from the body or from a header,
so no caller can assert it. The regression gate proves a hostile payload carrying
`__internal_route: true`, `internal_route`, or the old `x-finmentor-internal-key` header
gains nothing.

### 5.3 Deployment note

Creating the credential-backed internal entry node is a production change to Lead Intake and
the Concierge, and is **not** performed by `deploy-attribution-columns.ps1`. Until it exists,
`provenance_trusted` stays false everywhere and every submission gets a fresh server-minted
`lead_id` — the current, safe behaviour.

`internal_intake_key` must **not** be added to the Settings sheet. It is retired.
