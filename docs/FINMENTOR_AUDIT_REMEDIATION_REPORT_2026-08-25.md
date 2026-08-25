# FINMENTOR — Audit Remediation Report

Date: 2026-08-25
Branch: `fix/finmentor-audit-remediation-2026-08-25`
Base: `6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010` (production main)
Severity base: second independent audit (P0=1, P1=5, P2=16, P3=6)

---

## EXECUTIVE RESULT

All five P1 findings are closed and verified. The single P0 is **contained** — the
exploitable path is dead and returns 404 — but not yet **closed**, because publishing the
secure replacement was blocked by this environment's safety classifier and requires one
owner action.

Two facts contradicted the briefing and were corrected against the live tenant before any
work began:

1. **The unsafe Command Center was still ACTIVE.** The briefing stated it was already
   unpublished. `Ukn1cprWiXzBHojl` was live with `active=true`, so the P0 was exploitable at
   the moment work started. It was deactivated as the first action.
2. **The Daily Digest was already INACTIVE.** Both audits recorded it as active. It is off,
   so its 7/7 failures had stopped by being disabled rather than fixed.

Also corrected: the secure candidate's real id is `qF9tonlHHIxc8MDd` (lowercase L). The
pre-existing patcher script hardcoded `qF9tonIHHIxc8MDd` (capital i) and would have 404'd.
It was never applied — the "SECURE CANDIDATE" was an unmodified clone of the unsafe
workflow, still carrying the generic public webhook.

**Nothing about the public website regressed. All five active production workflows remain
active. No real lead row was read, written or mutated at any point.**

---

## P0 — CONTAINED, NOT CLOSED

### INDP0-01 — Command Center trusts caller-controlled Telegram identity

**Status: CONTAINED. Closure needs one owner action (publish + read-only canary).**

The workflow authorised on a Telegram-shaped HTTP body posted to a generic public webhook.
It accepted `from.id` **OR** `chat.id` against the allowlist, then always replied to the
caller-controlled `chat.id`. Knowing one allowed id was enough to read canonical Pipeline
rows and have the CRM contact data delivered to an attacker-controlled chat. It also had a
fail-open branch: an empty allowlist authorised everyone.

Containment applied and verified:

| Check | Result |
|---|---|
| `Ukn1cprWiXzBHojl` active | **false** |
| `POST /webhook/finmentor-lead-command-center` | **HTTP 404** |
| `GET` same path | **HTTP 404** |
| `POST /webhook-test/...` | **HTTP 404** |
| Graph vs pre-change snapshot | byte-identical (valid rollback point) |

Secure replacement built in `qF9tonlHHIxc8MDd` and verified by independent re-read:

- the generic Webhook node is **removed outright** — there is no HTTP entry left
- entry is a Telegram Trigger on the internal **Leads Bot** credential, which n8n registers
  with a `secret_token` and validates before the update reaches the graph
- a fail-closed identity gate runs **ahead of Settings and every Pipeline node**, so a
  rejected update performs zero Sheets reads, zero CRM writes and emits nothing
- the gate requires numeric ids, a non-bot sender, a private chat, and `chat.id == from.id`,
  which collapses authorisation identity and reply destination into one value — this is what
  removes the confused-deputy split
- authorisation matches the Settings allowlist exactly; the hardcoded owner fallback is gone,
  so an unset allowlist now denies everyone
- Telegram Trigger collision check: 0 (the only other active trigger uses the Client
  Concierge bot, a different token)

| Acceptance criterion | Status |
|---|---|
| AUTH BOUNDARY | **PASS** |
| SPOOF TEST (forged body has no entry path) | **PASS** |
| PII EXFILTRATION CLOSED | **YES** |
| PIPELINE GID | **PASS** (1883973304) |
| Negative matrix (15 cases) | **PASS** |
| Owner read-only canary | **NOT RUN — blocked** |

**Blocker:** activating a workflow was refused by this environment's safety classifier. The
candidate is correct and verified but unpublished, so the owner currently has no Command
Center at all. See "Owner actions required".

---

## P1 — 5 of 5 CLOSED

### INDP1-01 — GA4 forwards arbitrary query after consent — **CLOSED**

`page_view` sent `page_location: location.href` and `page_path: pathname + search`, so any
query string reached GA once consent was given. Both are now rebuilt from
`origin + pathname +` a whitelist (`tool`, `utm_*`, `topic/model/pain/intent/source`, `lang`,
`debug_ga4`). Each surviving value must be a plain token and is run through the email/phone
scrubbers first, so a PII-bearing value is dropped even under a whitelisted key. The fragment
is never forwarded. Verified by 9 assertions covering email, phone, name, company, free text,
`lead_id`, Telegram id, unknown keys and PII smuggled inside `utm_campaign`.

### INDP1-02 — Public intake selects rows by caller `lead_id` — **CLOSED**

`Normalize + Score Lead` used `pick(incoming.lead_id, generated)`, so a caller value became
canonical identity, and `Dedup Guard` used that same value as its strong matching tier. A
public request naming a known `lead_id` therefore selected that Pipeline row and merged into
it, escalating priority and zone and rewriting `next_action`, `status`, `priority_reason`,
`critical_flags`, stage and SLA state on someone else's row.

Canonical identity is now server-owned. A caller value is retained only as
`submission_lead_id` for correlation. It is honoured as identity solely when the request
presents the shared key held in Settings as `internal_intake_key`, and the strong dedup tier
is gated on that same proven provenance. While the key is unset — today — nobody is trusted
and the public path is safe by default; the Concierge keeps working via its Telegram
identity on the medium tier. Escalation additionally can no longer fire from a weak
company+name match, and still only ever raises priority or zone. Won/Lost rows still refuse
to absorb new submissions.

| Aspect | Status |
|---|---|
| TRUST BOUNDARY | **CLOSED** |
| IDEMPOTENCY | **PARTIAL** — see INDP2-02 |
| CONCURRENCY | **OPEN** — see INDP2-02 |

### INDP1-03 — OpenAI receives contact PII and full raw payload — **CLOSED**

The prompt sent name, company, email, phone, Telegram handle, `lead_id` and
`JSON.stringify(raw)` — the whole client payload, including the submission page URL with its
query, `ga_client_id`, `ga_session_id`, consent metadata, referrer and every free-text answer.

`AI_SAFE_PROJECTION` now governs the branch, with three independent layers: an allowlist of
business fields and raw sections (`lead` and `meta` excluded wholesale), a key denylist
applied at every depth, and value scrubbing that strips emails, phone runs, `@handles` and
URLs from surviving strings — which catches PII a client pasted into a free-text answer.
The serialised projection is then re-inspected and the branch **emits nothing** if anything
identifying survived. The lead is already committed by that point, so failing closed costs an
internal convenience, never the lead.

| Aspect | Status |
|---|---|
| SAFE PROJECTION | **PASS** |
| PII CHECK | **PASS** — 25 absence assertions |

Disclosures corrected in both locales: section 8 described live n8n/Sheets automation as a
future possibility and never named OpenAI. It now describes the actual path (n8n, Google
Sheets, Telegram, OpenAI) and states exactly what OpenAI does and does not receive — now a
verifiable claim. Both pages also named **Cloudflare**, which live headers disprove; removed.

`LEGAL_REVIEW_REQUIRED`: lawful basis, processor agreements, retention periods and transfer
mechanisms are unchanged and unassessed. The technical minimisation was completed regardless.

### INDP1-04 — mini_scan missing from generate_lead; tool-only dedup — **CLOSED**

`mini_scan` redirected to thank-you but never emitted `generate_lead`, so those conversions
were never counted; all three tools now share one `LEAD_TOOLS` table. Dedup keyed on the tool
name suppressed every later conversion from that tool for the whole tab session; it now keys
on the submission id carried as `thank-you.html?sid=`, falling back to the tool name only
when no id is present.

### INDP1-05 — Command Center write locator uses unresolved GID — **CLOSED**

Resolved definitively, and the cause was broader than either audit found. `Update Pipeline
Row`, `Save Status_Log` and `Save Activity` all carried `cachedResultUrl` pointing at a
**different spreadsheet** (`16Eepil...`), and the two append nodes passed sheet **names**
where n8n expects a numeric gid. GID `1997367085` belongs to that superseded document.

All corrected to canonical: Pipeline `1883973304`, Status_Log `1810362432`, Activities
`623316892`. Estate-wide verification: zero name-mode locators and zero stale-spreadsheet
references in any active workflow. Remaining occurrences are in archived Concierge revisions
and in `Ukn1cprWiXzBHojl`, preserved byte-identical as the rollback point.

---

## P2 — 6 CLOSED, 2 PARTIAL, 1 BLOCKED, 7 OPEN

| ID | Finding | Status |
|---|---|---|
| INDP2-01 | Clients accept any 2xx | **CLOSED** |
| INDP2-02 | Dedup is not atomic idempotency | **PARTIAL** |
| INDP2-03 | Mini App zero-write resume | OPEN |
| INDP2-04 | No Error Trigger / errorWorkflow | OPEN |
| INDP2-05 | GA fields raw-only, merge/retry lifecycle | OPEN |
| INDP2-06 | UTM first-touch continuity | OPEN |
| INDP2-07 | Server-side GA4 lifecycle sender | **BLOCKED_EXTERNAL_SECRET** |
| INDP2-08 | Event taxonomy; pre-submit lead_submit | **CLOSED** |
| INDP2-09 | PR #10 stored-row projection | OPEN |
| INDP2-10 | PR #10 authority/fallback matrix | OPEN |
| INDP2-11 | Sheets resume latency | OPEN |
| INDP2-12 | RO mini-scan Russian strings | OPEN |
| INDP2-13 | 60 x-default conflicts | **CLOSED** |
| INDP2-14 | Security headers absent | **PARTIAL / PLATFORM_BLOCKER** |
| INDP2-15 | Bootstrap canary has no assertions | **CLOSED** |
| INDP2-16 | Daily Digest fails Activities append | **CLOSED** (needs re-activation) |

### INDP2-01 — website success contract — CLOSED

All five submitters treated any 2xx as success and never read the body. `lead-transport.js`
is now the single implementation: success requires HTTP 2xx **AND** a JSON body **AND**
`body.ok === true`. Failures are classified (`http_<status>`, `invalid_response`, `rejected`,
`timeout`, `network`) rather than collapsing into one opaque error. Verified against
`ok:false`, a missing `ok`, a non-JSON proxy page, an empty 204, a 503 and a network failure.

### INDP2-02 — atomic idempotency — PARTIAL

The client half shipped: one `request_id` per submission travels in `payload.meta.request_id`
and `X-FINMENTOR-Request-Id`, is reused when the same payload is retried, and now flows
through Normalize and Dedup Guard.

The server half is **not closed**. Pipeline has no `request_id` column and no free slot, so
the read-then-append race remains. Closing it needs an owner-approved CRM schema change
(one new column plus a conditional-append guard). Deriving the canonical `lead_id` from a
hash of `request_id` was considered and rejected: without a strong keyed hash it would let an
attacker construct a colliding id and re-open exactly the row-selection hole just closed.

### INDP2-14 — security headers — PARTIAL, PLATFORM_BLOCKER

Verified live: the site is GitHub Pages behind Fastly, and all six headers are absent on the
production 200. The repo's `_headers` file is Netlify/Cloudflare Pages syntax that GitHub
Pages does not read, so it does nothing — claiming these fixed because that file exists would
be a fictitious pass.

Applied what genuinely works: `<meta name="referrer" content="strict-origin-when-cross-origin">`
on **all 87 pages**, a true browser-honoured equivalent. CSP was deliberately not shipped as a
meta tag: meta CSP is enforcing with no report-only mode, the pages need `'unsafe-inline'` for
scripts and styles anyway, `frame-ancestors` is ignored in meta form, and no browser was
available to validate a policy before publish. Shipping an unvalidated enforcing CSP would
trade a documented gap for an undiagnosable outage.

The remaining five are documented in `docs/FINMENTOR_SECURITY_HEADERS_PLATFORM_BLOCKER.md`.
Smallest complete fix: **Cloudflare in front of the existing Pages origin** — a DNS-only
change, no repository or deploy change. **No hosting migration was performed.**

### INDP2-16 — Daily Digest — CLOSED, awaiting re-activation

Root cause was the sheet-name locator (see INDP1-05), confirmed from retained executions:
Telegram delivery succeeded, then `Save Activity` threw `Sheet with ID Activities not found`
and the whole run was marked error. A third run also showed a Google 503 on `Read Settings`
with no retry configured.

Locator repaired to gid `623316892`; Google Sheets nodes in the Digest, SLA and Followup
workflows now retry transient failures (3 tries, 2s apart).

**Beyond both audits:** the same latent defect existed in two active workflows whose affected
nodes had simply never executed in retained history — `SLA Lead Watch → Save Activity` and
`Followup Sequence → Save New Followups`. Both would have failed on the first real SLA breach
or newly created followup. Both repaired.

### INDP2-07 — server-side GA4 lifecycle — BLOCKED_EXTERNAL_SECRET

A GA4 Measurement Protocol `api_secret` is required and is not available in this environment.
None was invented and none was placed in the repository. No workflow was created for it.

---

## P3 — 2 CLOSED, 4 OPEN

| ID | Finding | Status |
|---|---|---|
| INDP3-01 | 22 legacy alias pages | OPEN |
| INDP3-02 | Obsolete GA id in archives | OPEN |
| INDP3-03 | Inactive QA workflow retention | OPEN |
| INDP3-04 | GitHub ↔ n8n versioning drift | **CLOSED** |
| INDP3-05 | Canary resolves relative to cwd | **CLOSED** |
| INDP3-06 | Retained browser/GA regression suite | Partially addressed |

---

## PRODUCTION WORKFLOWS

Structural hashes exclude node ids, positions and timestamps, so editor moves are not drift.

| ID | Name | Active | Hash (first 16) |
|---|---|---|---|
| QmIyEW2ZEqKregmN | Lead Intake PREMIUM FINAL | **true** | `a22cc201a8f37737` |
| mppzthlkSJFr6Kle | Telegram Client Concierge AI GUARDED | **true** | see manifest |
| ShcmmJeLSE8LYVBk | Telegram Client Transport | **true** | `c62f998b5686…` |
| LZ2mvKXbBikmeVTn | SLA Lead Watch PREMIUM FINAL | **true** | `148e1096d92d10e2` |
| zeLOCuf0K1bkaKl2 | Followup Sequence PREMIUM v2 | **true** | `353435b5d8cb15a3` |
| imeJIDeNyaWDyXzh | Daily Lead Digest PREMIUM FINAL | false | `3035ec6c558d38cc` |
| Ukn1cprWiXzBHojl | Lead Command Center PREMIUM FINAL | **false (contained)** | `3409d1984d24d23c` |
| qF9tonlHHIxc8MDd | Lead Command Center SECURE CANDIDATE | false (awaiting publish) | `96938c3f3c0c4894` |

Full redacted exports and manifest: `n8n/production/`.

**GITHUB ↔ N8N DRIFT: MEASURABLE.** Previously unmeasurable — main carried no export of any
active workflow.

---

## TESTS

`node qa/run-all.mjs` — offline, no credentials, no network, no browser, cwd-independent.

| Gate | Assertions | Result |
|---|---|---|
| Command Center authorisation | 43 | **PASS** |
| Lead Intake trust boundary | 15 | **PASS** |
| AI safe projection | 52 | **PASS** |
| n8n export hygiene | 64 | **PASS** |
| Website contract | 57 | **FAIL** (2 — RO Cyrillic strings) |

**Total 231 assertions, 229 passing.** The two failures are INDP2-12, deliberately left
visible rather than suppressed.

---

## OWNER ACTIONS REQUIRED

1. **Publish the secure Command Center** (`qF9tonlHHIxc8MDd`), then send one harmless read
   command (`/pipeline`) from the owner's private chat. Until this happens there is no
   Command Center at all. Verified safe to publish: negative matrix passes, no trigger
   collision, unsafe original stays off.
2. **Re-activate the Daily Digest** (`imeJIDeNyaWDyXzh`) — its defect is repaired.
3. **Add `internal_intake_key`** to the Settings sheet with a long random value. Until then
   the Concierge loses only the strong dedup tier; the public path is already safe.
4. **Decide on the edge layer** for the five remaining security headers.
5. **Decide on the Pipeline `request_id` column** to close atomic idempotency.
6. **Revoke the temporary audit/fix API keys** (`N8N_API_KEY`, `N8N_FIX_API_KEY`) once this
   phase is accepted.

---

## RESIDUAL RISKS

- The Command Center secure candidate has passed structural and negative testing but has
  never processed a real Telegram update. The owner canary is the remaining proof.
- Lead Intake concurrency: two simultaneous first-time submissions from the same contact can
  still create two rows.
- Mini App / PR #10 defects are entirely untouched; the path remains inactive, so this is a
  release blocker, not a live exposure.
- RO mini-scan and questionnaire still render Russian strings to Romanian visitors.
- No browser-based verification was possible, so consent-banner behaviour, layout and GA4
  DebugView remain unverified by observation.

---

## FINAL

| Item | Verdict |
|---|---|
| CURRENT SITE | **KEEP RUNNING** |
| NEW RELEASE | **NO-GO** |
| PR #10 | **BLOCKED** |
| MINI APP | **BLOCKED** |
| P0 | **CONTAINED** — closes on owner publish + canary |
| P1 | **5 / 5 CLOSED** |
