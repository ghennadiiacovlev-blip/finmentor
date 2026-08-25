# FINMENTOR — Attribution policy, CRM schema change, and server-side GA lifecycle

Date: 2026-08-25
Covers: INDP2-05, INDP2-06 (attribution), INDP2-02 (idempotency), INDP2-07 (GA lifecycle)
Status: client half **DONE**; server half **BLOCKED — needs one owner-approved schema change**

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
| Retry (same submission, <2 min) | Unchanged | Unchanged | A retry is not a new touch |
| Field absent on a later submit | Keep existing | Keep existing | Never overwrite a known value with a blank |

---

## 2. REQUIRED: CRM schema change

**This is the single blocker for three findings.** It needs the owner to add columns to the
`Pipeline` tab, because the Lead Intake `Save to Pipeline` node maps columns explicitly
(`defineBelow`) and will fail on a column the sheet does not have.

Current `Pipeline` schema is 52 columns ending at `days_in_stage`. It carries `utm_source`,
`utm_medium` and `utm_campaign` but has no field for consent, GA identifiers, first touch, or
a request key.

### 2.1 Columns to add

Append these to the **end** of the `Pipeline` header row, in this order. Appending at the end
does not shift any existing column, so no formula, filter or Dashboard view that references
the current layout is affected.

| # | Column | Purpose | Finding |
|---|---|---|---|
| 53 | `request_id` | Server-owned idempotency key, one per submission | INDP2-02 |
| 54 | `analytics_consent` | Whether analytics consent was accepted at submit | INDP2-05 |
| 55 | `ga_client_id` | GA4 client id, only when consent accepted | INDP2-05 |
| 56 | `ga_session_id` | GA4 session id, only when consent accepted | INDP2-05 |
| 57 | `utm_source_first` | First-touch source | INDP2-06 |
| 58 | `utm_medium_first` | First-touch medium | INDP2-06 |
| 59 | `utm_campaign_first` | First-touch campaign | INDP2-06 |
| 60 | `first_touch_at` | When the first touch was captured | INDP2-06 |

The existing `utm_source` / `utm_medium` / `utm_campaign` become explicitly **last-touch**.

### 2.2 Why this was not done automatically

Adding columns is a schema mutation of the production CRM. It is reversible, but it is the
owner's data model: hidden formulas, pivot ranges, filter views or external Looker/Power BI
bindings can depend on the exact shape, and none of that is visible from the n8n API. A
remediation phase should not silently reshape the system of record.

### 2.3 After the columns exist

Run:

```
pwsh scripts/deploy-attribution-columns.ps1            # dry run, verifies the header first
pwsh scripts/deploy-attribution-columns.ps1 -Apply
```

The script refuses to run unless it reads the live `Pipeline` header and finds all eight
columns present, so it cannot half-apply.

### 2.4 What this then closes

- **INDP2-02** — `request_id` becomes a real idempotency key. `Dedup Guard` gains a
  strong-tier match on it, and concurrent duplicates become detectable and repairable.
  Note this still does not make the append *atomic*: Google Sheets offers no
  conditional-append, so a true fix requires either a lock row or moving the ledger to a
  store with compare-and-set. The column makes the race **detectable and reconcilable**,
  which is the achievable improvement here.
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

**Settings keys to add** (Settings tab, same sheet):

| Key | Value |
|---|---|
| `ga4_measurement_id` | `G-94L9B8WZ12` |
| `ga4_api_secret` | from the GA4 UI — **store in Settings, never in git** |

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
| Structured CRM attribution columns | **BLOCKED** — owner schema change, section 2 |
| Atomic idempotency | **PARTIAL** — client key shipped; see 2.4 |
| Server-side GA4 lifecycle | **BLOCKED_EXTERNAL_SECRET** — section 3 |
