# FINMENTOR Phase B.2.1 — Mini App Gateway Contract

Status: **IMPLEMENTATION SPEC / NON-PRODUCTION**
Branch: `feat/phase-b2.1-miniapp-gateway`
Issue: #4
Base: B.2.0 merged to `main` at `d3c46acf259c14009a7d119473f9844c5324a2ff`.

## 1. Objective

Add the smallest safe server boundary between the FINMENTOR Telegram Mini App and the already-proven FINMENTOR lead backend.

B.2.1 does **not** replace the Client Concierge, Pipeline, Lead Intake or consent/cycle model. It adds a validated Mini App entry and an idempotent handoff path.

```text
Telegram Mini App
      │
      │ Telegram.WebApp.initData
      ▼
Mini App Gateway
      │
      ├── validate Telegram origin/auth_date
      ├── resolve Telegram user
      ├── reconcile authoritative cycle/session
      ├── enforce explicit current-cycle consent
      └── submit once/idempotently
              │
              ▼
       Existing Lead Intake
              │
              ▼
       Existing Pipeline / CRM
```

## 2. Frozen production contracts

Until a separate release gate explicitly approves a backend change:

- `Pipeline` remains canonical current lead state.
- Existing Lead Intake remains the only canonical lead creation/merge endpoint.
- Existing Client Concierge cycle semantics remain authoritative.
- Existing Client Concierge consent semantics remain authoritative.
- Existing Transport remains the Telegram message delivery component.
- Mini App must never write directly to Google Sheets.
- Mini App must never receive a bot token, Google credential, n8n credential or other server secret.

## 3. Telegram identity validation

### 3.1 Browser rule

The browser sends the raw string from:

```js
Telegram.WebApp.initData
```

The browser may use `initDataUnsafe` only for non-privileged presentation/prefill. It must never use `initDataUnsafe` as proof of identity.

### 3.2 Gateway rule

No privileged bootstrap, resume or submit operation is accepted until `initData` is validated on the server.

The validator must also reject stale `auth_date` values. B.2.1 policy starts with:

- `max_auth_age_seconds = 900` (15 minutes) for a fresh bootstrap;
- `future_clock_skew_seconds = 60` maximum;
- a later request should use a gateway-issued app session, not trust an indefinitely old `initData` string.

These are FINMENTOR policy values, not Telegram protocol constants.

### 3.3 Preferred validation method for the Gateway

Preferred for B.2.1: Telegram's **third-party Ed25519 validation** using:

- raw `initData`;
- FINMENTOR bot numeric `bot_id` (non-secret configuration);
- Telegram production public key.

Reason: the validation boundary does not need access to the bot token.

Telegram production public key currently specified by Telegram:

```text
e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d
```

Test environment public key:

```text
40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec
```

The implementation must not silently fall back to trusting the browser if signature verification is unavailable. If the chosen n8n runtime cannot perform Ed25519 verification reliably, B.2.1 remains blocked until the validator is moved to a server runtime that can.

### 3.4 HMAC fallback

A backend that legitimately has the bot token may instead use Telegram's HMAC-SHA-256 validation method. The bot token must remain in a server credential/secret store and must not be placed in Sheets, workflow JSON, frontend code or logs.

Reference implementation for both algorithms lives in:

```text
gateway/telegram-initdata.mjs
```

### 3.5 Target n8n runtime decisions proven by B.2.1-A probes

The target n8n Cloud Code-node sandbox has now been tested directly. Evidence is recorded in:

```text
docs/PHASE_B2_1_INITDATA_VALIDATOR.md
```

Implementation decisions for the n8n Gateway:

- Ed25519 verification uses `node:crypto` through `require('crypto')`;
- WebCrypto is not available in the tested sandbox and is not the planned path;
- `URLSearchParams` is not available in the tested sandbox;
- query parsing must therefore be manual and deterministic;
- percent decoding is performed exactly once;
- raw `+` is preserved as `+` in the proven parser path;
- malformed percent escapes reject;
- duplicate decoded keys reject;
- key sorting uses deterministic code-unit ordering, not `localeCompare`;
- third-party Ed25519 canonicalization excludes both `hash` and `signature`;
- `auth_date` freshness is a separate gate after signature verification.

The probes proved the runtime primitive and canonicalization logic with synthetic signatures, including import of Telegram's production public key. The remaining validation gap is a real Telegram-generated `initData` canary against the production public key before production activation.

## 4. Bootstrap contract

### Request

`POST /miniapp/bootstrap`

```json
{
  "init_data": "<Telegram.WebApp.initData>",
  "client_version": "b2.1.0",
  "locale": "ru"
}
```

### Validation

Fail closed if any of these are false:

- request body is valid JSON;
- `init_data` exists and is within size limit;
- Telegram signature is valid;
- `auth_date` is valid and fresh;
- validated Telegram user exists and is not a bot;
- client version is allowed;
- locale is allowed.

### Success response

```json
{
  "ok": true,
  "app_session_id": "AS-...",
  "cycle_id": "C-...",
  "resume": false,
  "submit_state": "draft",
  "safe_user": {
    "telegram_user_id": "551662084",
    "first_name": "...",
    "username": "..."
  },
  "draft": {},
  "canonical_lead_id": ""
}
```

Only fields needed for the Mini App are returned. Internal row numbers, credentials, workflow IDs and internal notes are not returned.

### Error response

```json
{
  "ok": false,
  "error_code": "TG_INITDATA_INVALID",
  "retryable": false
}
```

Initial error codes:

- `BAD_REQUEST`
- `TG_INITDATA_MISSING`
- `TG_INITDATA_INVALID`
- `TG_INITDATA_EXPIRED`
- `TG_USER_MISSING`
- `TG_USER_BOT`
- `CLIENT_VERSION_UNSUPPORTED`
- `RATE_LIMITED`
- `TEMPORARY_BACKEND_ERROR`

Do not return cryptographic verification details to the browser.

## 5. Authoritative cycle reconciliation

The Mini App must not invent a trusted `cycle_id` and overwrite the Concierge session.

Gateway behavior:

1. Resolve the validated Telegram user ID.
2. Read the authoritative current Bot Session for that Telegram user.
3. If a valid current cycle exists, use it.
4. If no valid session exists, return `resume: false` with an empty draft and **no `cycle_id`**. Bootstrap does not create one.
5. Return the authoritative `cycle_id` to the Mini App when, and only when, one already exists.

Opening the Mini App is navigation. It is **not** consent and, by itself, should not discard a valid unfinished cycle.

### 5.1 Bootstrap and resume are zero-write — CORRECTED 2026-08-25 (Phase 10, INDP2-03)

This section originally instructed the Gateway to "bootstrap a new cycle using the same cycle
rules as the Client Concierge" when no valid session existed. That contradicted the B.2.1-B
zero-write resume requirement, and the independent review recorded the conflict as INDP2-03:
two canonical contracts disagreeing about whether opening the Mini App may mint a cycle.

**Canonical rule: `/miniapp/bootstrap` and Mini App resume perform zero writes.** No cycle
creation, no cycle reset, no archive, no draft write, no consent stamp, no Sheets write, no
Lead Intake call. A read that finds nothing returns "nothing to resume"; it does not create
the thing it failed to find.

Cycle creation remains the Client Concierge's, under the already-approved reset semantics.
The first Mini App write of any kind is `PUT /miniapp/session` (§7), and the first
authoritative lead effect is `POST /miniapp/submit` (§9).

The read path enforces this structurally rather than by convention: `resolveResume` in
`n8n/src/miniapp-readmodel/mirror-helper.js` takes a chat id and two read-only clients, and
returns `cycle_created: false`, `cycle_reset: 'none'` and an all-zero `writes` block on every
branch, including every fallback class. `qa/miniapp-readmodel.test.mjs` asserts zero writes
against both the Data Table and the authoritative store on the cache-hit path and on all five
fallback paths.

Repairing a stale or duplicated derived row is deliberately **not** the read path's job. Repair
belongs to the mirror helper and to reconciliation, so that serving a Mini App open can never
become a write.

## 6. App session

`app_session_id` is an opaque server-issued identifier used to bind later Mini App requests to the validated Telegram user and authoritative cycle.

Requirements:

- high-entropy random identifier;
- server-side TTL;
- not derived from Telegram ID alone;
- never accepted as proof of consent;
- bound to exactly one Telegram user and one authoritative cycle;
- invalidated/rotated when the authoritative cycle changes;
- never expose storage row IDs as the session identifier.

The exact temporary storage implementation is an implementation detail. It may be an n8n Data Table or another controlled server-side store, but it must not become a second CRM.

## 7. Draft contract

`PUT /miniapp/session`

Purpose: save structured draft answers for resume UX only.

Request example:

```json
{
  "app_session_id": "AS-...",
  "step": "priority",
  "answers": {
    "sector": "retail",
    "turnover": "lt100k",
    "cash": "unclear"
  },
  "contact": {}
}
```

Rules:

- server resolves user/cycle from app session, never from browser-supplied Telegram ID;
- browser may not set `canonical_lead_id`;
- browser may not set trusted consent timestamps;
- draft writes do not create a CRM lead;
- draft state must be size-limited and schema-whitelisted;
- free text must be length-limited and stored as data, never executed as expressions/code.

## 8. Consent contract

Consent remains an explicit dedicated decision:

```text
YES = Да, передать эксперту FINMENTOR
NO  = Пока не передавать
```

Opening the Mini App, completing the diagnostic, viewing a result, entering contact details or saving a draft are **not** consent.

For submission, the Gateway must record:

- `consent = yes`;
- `consent_cycle_id = authoritative cycle_id`;
- `consent_at = server timestamp`;
- source = `telegram_miniapp`.

Consent from another cycle is invalid.

NO must not call Lead Intake.

## 9. Submit contract

`POST /miniapp/submit`

Request example:

```json
{
  "app_session_id": "AS-...",
  "consent": "yes",
  "answers": {
    "sector": "retail",
    "turnover": "lt100k",
    "cash": "unclear",
    "profit": "partial",
    "treasury": "unclear",
    "kpi": "partial",
    "pain": "reporting",
    "urgency": "none",
    "context": "..."
  },
  "contact": {
    "name": "...",
    "company": "...",
    "direct": "..."
  }
}
```

### Submit sequence

1. Resolve app session server-side.
2. Confirm it belongs to current authoritative cycle.
3. Confirm submit state is not already `submitted`.
4. Require explicit `consent === yes`.
5. Stamp server-side current-cycle consent.
6. Normalize/whitelist Mini App fields into the existing Lead Intake payload.
7. Call existing Lead Intake once.
8. Treat success only as `response.ok === true`.
9. Persist returned canonical `lead_id` + cycle binding before final client success.
10. Return one clean success to the Mini App.

### Success response

```json
{
  "ok": true,
  "lead_id": "<canonical lead id>",
  "mode": "new|merged",
  "priority": "HOT|WARM|COLD",
  "financial_zone": "RED|YELLOW|GREEN|UNKNOWN",
  "submit_state": "submitted"
}
```

The UI must not tell a client they were a duplicate. `mode: merged` is an internal CRM behavior; client confirmation remains normal.

## 10. Idempotency

Idempotency key:

```text
miniapp:<telegram_user_id>:<cycle_id>
```

The Gateway must guarantee:

- no second Lead Intake after canonical success for that key;
- retries after a client/network timeout first resolve server submit state;
- if `lead_id` is already known for the key, return the prior canonical success rather than submit again;
- ambiguous downstream outcome is resolved before another Intake call.

Monotonic submit states:

```text
draft
→ submitting
→ submitted
```

Failure before canonical success may move to `retryable_error`, but `submitted` must never move back to `draft`.

## 11. Urgency semantic guard

The Mini App value:

```text
urgency = none
```

means **no urgency**.

It must not be normalized to urgent keywords and must not independently escalate priority.

This rule already exists in B.2.0 QA and must be retained in the Gateway normalization tests.

## 12. HTTP/security controls

Initial Gateway controls:

- HTTPS only;
- POST/PUT only where defined;
- strict JSON request content type;
- request body size limit;
- allow origin only from the approved FINMENTOR Mini App origin where browser CORS applies;
- rate limit bootstrap and submit;
- `Cache-Control: no-store` on identity/session responses;
- do not log raw `init_data`, signatures, direct contact data or server credentials in ordinary execution logs;
- redact/restrict error details;
- structured correlation ID for diagnostics;
- no bot token in response/body/URL;
- no browser-provided `lead_id`, `cycle_id`, priority or financial zone accepted as authoritative.

## 13. Minimum QA matrix

### Telegram validation

- valid initData → PASS;
- one-character tamper → reject;
- missing signature/hash → reject;
- stale auth_date → reject;
- future auth_date beyond skew → reject;
- malformed user JSON → reject;
- missing user → reject.

### Session/cycle

- existing current cycle → resume same cycle;
- new user → one new cycle;
- old-cycle consent → invalid;
- Mini App reopen during unfinished flow → no accidental reset.

### Consent

- NO → zero Lead Intake;
- YES current cycle → eligible;
- YES stale cycle → reject/re-consent.

### Submit/idempotency

- new lead → exactly one Intake + one canonical result;
- merge → exactly one Intake + one canonical existing lead;
- client retry after success → zero extra Intake;
- confirmation retry → zero extra Intake;
- downstream timeout/unknown → resolve state before retry.

### Security

- raw `initDataUnsafe` spoof cannot authorize;
- fake Telegram user ID cannot choose another session;
- browser cannot set canonical lead ID;
- secrets scan = 0;
- direct Google Sheets calls from browser = 0.

## 14. Release slicing

B.2.1 should ship in controlled slices:

### B.2.1-A — Validator + Bootstrap

- signature validation;
- freshness validation;
- validated safe user;
- authoritative cycle read/bootstrap;
- no lead submit.

### B.2.1-B — Session / Resume

- app session;
- safe draft persistence/resume;
- no lead submit.

### B.2.1-C — Consent + Submit

- current-cycle consent;
- idempotent existing Lead Intake call;
- canonical lead persistence;
- error recovery.

Only B.2.1-C creates a real lead-side effect, and it requires a separate live canary gate.

## 15. Rollback

Rollback for B.2.1 is to disable the Mini App Gateway/entry and fall back to the already-proven Telegram Client Concierge.

Do not roll back to known-unsafe historical Concierge versions.
