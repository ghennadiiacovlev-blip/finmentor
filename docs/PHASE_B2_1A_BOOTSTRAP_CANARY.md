# FINMENTOR Phase B.2.1-A — Bootstrap Canary Gate

Status: **REAL TELEGRAM CRYPTO CANARY PASS / FINAL RETENTION + SIDE-EFFECT CLOSURE PENDING**
Branch: `feat/phase-b2.1a-bootstrap`
Issue: #4

## Current evidence

Isolated n8n workflow: `AWQ0Telk7T9ynBlR`.

Confirmed before the genuine Telegram launch:
- request guards fail closed;
- production Ed25519 public key imports;
- proven Telegram canonicalization path is reused;
- response/log object emitted by the Code node does not contain raw `init_data`, signature or hash;
- Lead Intake calls = 0;
- Pipeline writes = 0;
- consent writes = 0;
- Sheets writes = 0;
- Bot_Sessions writes = 0.

## No-retention gate — PASS

Workflow settings were changed before any real Telegram sample was allowed:

- successful production executions: `none`;
- failed production executions: `none`;
- manual executions: `false`;
- execution progress: `false`;
- workflow `pinData`: none.

Synthetic proof:

- marker request executed as n8n execution `3280`;
- subsequent fetch returned `Execution '3280' not found`;
- workflow execution list contained only the older pre-setting synthetic executions `3278` and `3279`.

Conclusion: the canary workflow no longer retains new execution records. Workflow redaction may still be enabled as defense in depth, but it is not relied on as the storage control.

The older executions `3278` and `3279` contain synthetic-only test bodies. They are cleanup debt only.

## Real Telegram canary — visual proof received

An owner-operated Telegram Mini App launch produced the expected three visible canary results:

### A. Genuine baseline — PASS

- HTTP 200;
- validation method: `telegram_ed25519`;
- safe Telegram user identity returned and matched the owner launch context;
- locale/language data returned through the safe response shape;
- a real Telegram `auth_date` was present.

This proves that genuine `Telegram.WebApp.initData` verified successfully against the Telegram production Ed25519 path with the configured public numeric bot ID.

### B. Tampered signed field — REJECT

- HTTP 401;
- `error_code = TG_INITDATA_INVALID`.

This proves that modification of signed Telegram data invalidates the signature and is rejected fail-closed.

### C. Wrong bot ID — REJECT

- HTTP 401;
- `error_code = TG_INITDATA_INVALID`;
- `stage = ED25519_VERIFY`.

This proves that the genuine payload is cryptographically bound to the correct bot ID and cannot be replayed against a different bot ID.

### Privacy note

The screenshot used as visual evidence is intentionally **not committed to the public repository**, because it visibly contains owner Telegram identifiers. Repository evidence records only the security result, not the personal identifiers.

## What is now proven

- genuine Telegram-generated `initData`: PASS;
- Telegram production Ed25519 verification: PASS;
- validated owner identity: PASS;
- signed-field tamper: REJECT;
- wrong bot ID: REJECT at `ED25519_VERIFY`;
- response shape exposes only safe fields;
- no browser-side display/storage/logging of raw `initData` by the reviewed canary page.

## Final closure still required

The screenshot proves the cryptographic canary, but B.2.1-A should not be marked fully closed until the runtime report confirms after the genuine request:

1. **Real execution retention = NONE**
   - no retained success/failure/manual execution containing genuine `initData`;
   - no pinData;
   - no raw initData in workflow-visible execution history.

2. **Zero side effects remain true**
   - Lead Intake calls = 0;
   - Pipeline writes = 0;
   - consent writes = 0;
   - Sheets writes = 0;
   - Bot_Sessions writes = 0.

3. **Temporary canary workflows are inactive after the test**
   - Bootstrap inactive;
   - Canary Page inactive;
   - Launcher inactive or removed.

A genuine stale replay after >900 seconds remains optional only if it can be done without persisting bearer-grade initData. The +60/+61 second future-date boundary remains a unit/runtime test because Telegram does not issue a genuine future `auth_date`.

## Repository implementation

- `gateway/n8n/bootstrap-canary.js`
- `gateway/n8n/bootstrap-canary.test.js`
- `gateway/n8n/canary-page.html`

Hardening included:
- reject empty query pairs and empty decoded keys;
- strict `application/json` media type;
- validate base64url signature character set before decode;
- require digit-only safe-integer `auth_date`;
- one-pass percent decoding;
- preserve raw `+`;
- duplicate decoded-key rejection;
- deterministic code-unit sorting.

## Next action

Produce the final runtime closure report only:

1. prove the genuine canary execution was not retained;
2. confirm zero CRM/Sheets/Bot_Sessions side effects;
3. deactivate all temporary canary workflows;
4. stop.

Do **not** connect Bot_Sessions read/resume or Lead Intake until this final closure report is accepted.
