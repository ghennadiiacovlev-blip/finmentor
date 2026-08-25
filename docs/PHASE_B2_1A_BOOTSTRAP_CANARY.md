# FINMENTOR Phase B.2.1-A — Bootstrap Canary Gate

Status: **CODE READY / REAL TELEGRAM INITDATA BLOCKED BY SAFE-INGRESS GATE**
Branch: `feat/phase-b2.1a-bootstrap`
Issue: #4

## Evidence received

Isolated n8n workflow `AWQ0Telk7T9ynBlR` was created inactive with no credentials and no production side effects.

Confirmed before a real Telegram canary:
- request guards fail closed;
- production Ed25519 public key imports;
- proven Telegram canonicalization path is reused;
- response/log payload emitted by the Code node is redacted from raw `init_data`, signature and hash;
- Lead Intake calls = 0;
- Pipeline writes = 0;
- consent writes = 0;
- Sheets writes = 0.

## Critical finding: execution persistence

The inbound Webhook node persisted the raw `init_data` in n8n execution data (and test `pinData`) before the validator Code node could redact anything.

This is a release blocker for a real Telegram sample.

### Important distinction

n8n execution-data **redaction alone is not sufficient as a storage control**. n8n documentation states that redaction is applied when execution data is served/read and that stored database data remains unchanged. Therefore the B.2.1-A canary must not rely only on the redaction UI as proof that raw `init_data` is not persisted.

Before a genuine Telegram request is sent, the isolated canary workflow must be configured so sensitive execution payloads are not retained:

- Save successful production executions: **Do not save**
- Save failed production executions: **Do not save**
- Save manual executions: **Do not save** for any real-data manual test
- Save execution progress: **Do not save**
- clear all `pinData` from the Webhook and downstream nodes
- if the n8n plan exposes workflow redaction, also enable production + manual redaction as defense in depth

A real request must not be sent until this no-retention configuration is verified on a non-sensitive synthetic request.

## Bot ID

The validator remains fail-closed while `BOT_ID = SET_BOT_ID_BEFORE_CANARY`.

Do not derive or expose the bot token in code. Resolve the public numeric bot ID through a server-side/native Telegram credential operation (for example a controlled `getMe` call) and persist only the numeric bot ID as non-secret configuration.

## Real initData handling

Do **not** paste a real `Telegram.WebApp.initData` into chat, GitHub, Sheets, workflow notes or test fixtures.

The real sample should travel directly from a Telegram Mini App WebView to the isolated canary endpoint after no-retention is proven. Treat it as short-lived bearer-grade data.

## Canary closure criteria

B.2.1-A is closed only when a genuine Telegram-generated payload proves:

- production Ed25519 verification PASS;
- validated Telegram user identity PASS;
- tampered copy REJECT;
- changed bot ID REJECT;
- stale replay after >900 seconds returns EXPIRED;
- response contains no raw initData/signature/hash;
- execution retention test proves raw initData is not available after completion;
- zero Lead Intake / Pipeline / consent / Sheets side effects.

The +61 second future-auth-date case remains a unit/runtime policy test because Telegram will not issue a genuinely signed future `auth_date` for a live canary.

## Repository implementation

Runtime-specific source:
- `gateway/n8n/bootstrap-canary.js`
- `gateway/n8n/bootstrap-canary.test.js`

Hardening added during repository review beyond the uploaded draft:
- reject empty query pairs and empty decoded keys;
- strict `application/json` media type instead of substring matching;
- validate base64url signature character set before decode;
- require decimal-digit, safe-integer `auth_date`;
- preserve the already-proven one-pass percent decoding, raw `+`, duplicate-key rejection and code-unit sorting semantics.

## Next action

1. Verify no-retention settings using synthetic data.
2. Resolve public bot ID without exposing the token.
3. Create an owner-only temporary Telegram Web App launch path without changing the production Concierge flow.
4. POST `Telegram.WebApp.initData` directly from the WebView to the isolated canary endpoint.
5. Stop after the real validation report; do not connect Bot_Sessions or Lead Intake yet.
