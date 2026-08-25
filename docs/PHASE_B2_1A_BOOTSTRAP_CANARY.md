# FINMENTOR Phase B.2.1-A — Bootstrap Canary Gate

Status: **NO-RETENTION PASS / REAL TELEGRAM CANARY PENDING**
Branch: `feat/phase-b2.1a-bootstrap`
Issue: #4

## Current evidence

Isolated n8n workflow: `AWQ0Telk7T9ynBlR`.

Confirmed:
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

Workflow settings were changed before any real Telegram sample is allowed:

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

The older executions `3278` and `3279` contain synthetic-only test bodies. They should be purged when convenient, but they do not contain genuine Telegram initData and do not block the real canary after the no-save proof.

## Public bot ID

The validator remains fail-closed while:

```text
BOT_ID = SET_BOT_ID_BEFORE_CANARY
```

Do not extract or reveal the bot token.

A dedicated native Telegram `sendMessage` operation can solve two remaining setup needs in one controlled action:

1. send the owner-only Web App button;
2. read the outgoing Telegram Message response `from.id`, which is the bot's public numeric ID.

Only the numeric bot ID may be copied into canary configuration. The token must stay inside the existing Telegram credential.

## Owner launch context

The current FINMENTOR Client Concierge already has an owner chat ID in its existing settings/configuration. The canary launcher should reuse that value rather than ask the owner to copy Telegram identifiers manually.

Production Client Concierge flow must remain unchanged. Use a separate temporary launcher workflow with the existing `FINMENTOR Client Concierge Bot` credential.

## Canary page hosting

GitHub deployment is not required for the one-off canary.

Preferred isolated path:

1. create a temporary n8n page workflow with an HTTPS GET Webhook + Respond to Webhook HTML;
2. serve the reviewed template from `gateway/n8n/canary-page.html`;
3. replace `__BOOTSTRAP_ENDPOINT__` only inside the temporary runtime response;
4. activate the page workflow only for the canary window;
5. activate `AWQ0Telk7T9ynBlR` only for the canary window, with no-retention settings already proven;
6. send one owner-only Telegram inline Web App button to the page URL;
7. page sends `Telegram.WebApp.initData` directly to the isolated bootstrap endpoint;
8. deactivate both temporary workflows after evidence is collected.

The page template:
- never renders raw `initData`;
- never logs raw `initData`;
- never puts it in URL/query/cookies/localStorage/sessionStorage;
- POSTs it directly as JSON;
- shows only safe PASS/FAIL output.

## Real initData handling

Do **not** paste a real `Telegram.WebApp.initData` into chat, GitHub, Sheets, workflow notes or fixtures.

The real payload must travel directly:

```text
Telegram WebView -> isolated n8n bootstrap canary
```

## Real canary closure criteria

B.2.1-A closes only when a genuine Telegram-generated payload proves:

- production Ed25519 verification: PASS;
- validated Telegram user identity: PASS;
- tampered signed field: REJECT;
- changed bot ID: REJECT;
- response contains no raw initData/signature/hash;
- post-request execution retention remains NONE;
- zero Lead Intake / Pipeline / consent / Sheets / Bot_Sessions side effects.

A real future-auth-date test is not required because Telegram will not issue a genuine future `auth_date`; the +60/+61 second rule remains covered by runtime/unit tests.

A genuine stale replay after >900 seconds is optional only if it can be performed without persisting the bearer-grade sample. Do not weaken no-retention controls for the sake of this test.

## Repository implementation

- `gateway/n8n/bootstrap-canary.js`
- `gateway/n8n/bootstrap-canary.test.js`
- `gateway/n8n/canary-page.html`

Hardening already included:
- reject empty query pairs and empty decoded keys;
- strict `application/json` media type;
- validate base64url signature character set before decode;
- require digit-only safe-integer `auth_date`;
- one-pass percent decoding;
- preserve raw `+`;
- duplicate decoded-key rejection;
- deterministic code-unit sorting.

## Next action

1. Create temporary no-save n8n page workflow from `canary-page.html`.
2. Create temporary no-save Telegram launcher workflow.
3. Send one Web App button to the existing owner chat using the current client-bot credential.
4. Capture outgoing Message `from.id` as the public numeric bot ID and configure only that ID in `AWQ0Telk7T9ynBlR`.
5. Activate the isolated page + bootstrap workflows for the shortest canary window.
6. Open the button in Telegram and run the genuine initData validation.
7. Verify no execution record remains.
8. Stop and report; do not connect Bot_Sessions or Lead Intake yet.
