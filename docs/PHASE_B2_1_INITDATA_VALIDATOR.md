# FINMENTOR Phase B.2.1 — Telegram initData Validator Evidence

Status: **RUNTIME + FORMAT PROBES PASS / LIVE TELEGRAM INITDATA STILL PENDING**
Branch: `feat/phase-b2.1-miniapp-gateway`
Issue: #4

## 1. Purpose

This note records the two isolated n8n Cloud probes used to de-risk Telegram Mini App `initData` validation before any production Gateway is activated.

Neither probe changed production workflows, Telegram configuration, Google Sheets, Lead Intake, Client Concierge, Transport or BotFather settings.

## 2. Probe 1 — Ed25519 runtime capability

Workflow: `kKVHHE5LNHuJUuNR`
State: inactive / unpublished test workflow

Observed runtime characteristics:

- `process` unavailable in Code-node sandbox;
- `globalThis.crypto` / WebCrypto unavailable;
- `require()` available;
- `Buffer` available;
- `node:crypto` Ed25519 verification available.

Results:

- generated Ed25519 signature verifies: PASS;
- one-character tamper rejects: PASS;
- raw 32-byte Ed25519 public key + SPKI prefix import: PASS;
- base64url 64-byte signature round-trip: PASS.

Conclusion: the target n8n Cloud runtime can perform the required Ed25519 primitive through `node:crypto`.

The approximately 1.4 s Code-node duration observed in this probe is not treated as validator latency because the probe included key generation and sandbox cold-start work.

## 3. Probe 2 — Telegram canonicalization and verify-only path

Workflow: `aGTlNJ1vihi6rGqY`
State: inactive / unpublished test workflow

This probe used one reusable validator path and exercised the exact third-party Telegram data-check-string shape:

```text
<bot_id>:WebAppData\n
<sorted key=value fields excluding hash and signature>
```

### Canonicalization results

- Telegram-style header: PASS;
- LF separator `0x0A`: PASS;
- excludes `hash`: PASS;
- excludes `signature`: PASS;
- deterministic alphabetical/code-unit ordering: PASS;
- raw query reordering normalizes to the same canonical string: PASS;
- duplicate decoded keys reject before verification: PASS.

### URL decoding decision

The n8n sandbox does not expose `URLSearchParams`, so the Gateway validator must use a manual parser.

The proven parser behavior is:

1. split the raw query on `&`;
2. split each pair on the first `=`;
3. percent-decode key and value exactly once with strict decoding;
4. do **not** translate raw `+` to a space;
5. reject malformed percent escapes;
6. reject duplicate decoded keys.

Probe evidence:

```text
deep%2541link%20with%20space%2Fslash%2Bplus
→ deep%41link with space/slash+plus
```

A second decode would incorrectly change `%41` into `A`; that path is rejected by design.

The raw `+` decision is locked for the B.2.1 implementation because it is the path proven in the target n8n sandbox. A live Telegram `initData` canary remains mandatory before production activation; if live Telegram data demonstrates a different transport encoding, this decision must be revisited from evidence rather than silently changed.

### Sorting decision

Do not use `localeCompare` for signature canonicalization.

Use deterministic code-unit ordering (`a < b`, `a > b`) because:

- Telegram keys are currently lowercase ASCII/underscore;
- locale-sensitive ordering is unnecessary and can vary by runtime/locale;
- the n8n probe passed with deterministic code-unit ordering.

### Security cases

All exercised through the same validator path:

- valid synthetic signature: PASS;
- changed value: rejected;
- changed bot ID: rejected;
- reordered raw query: accepted after canonical sorting;
- added field with old signature: rejected;
- removed field with old signature: rejected;
- wrong public key: rejected;
- changed `hash` alone: accepted for Ed25519, proving `hash` is excluded from the signed body.

Telegram production public key import:

```text
e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d
```

Result: PASS as an Ed25519 public key. A synthetic signature correctly fails against it.

## 4. Freshness policy proven in runtime

FINMENTOR policy:

- max age: 900 seconds;
- allowed future clock skew: 60 seconds.

Cases:

- current / fresh: PASS;
- `now - 899 s`: PASS;
- `now - 901 s`: EXPIRED;
- `now + 60 s`: PASS;
- `now + 61 s`: FUTURE_REJECTED.

Signature validity and freshness are independent gates. A stale payload may remain cryptographically authentic but is still rejected by policy.

## 5. Verify-only benchmark

Measured in target n8n Cloud runtime after warm-up and without key generation in the measured path:

| Stage | Result |
|---|---:|
| Parse + canonicalize | ~0.010 ms |
| Public-key import | ~0.055 ms |
| Ed25519 verify-only | min 0.115 / median 0.120 / max 0.125 ms |
| Total validator | min 0.130 / median 0.135 / max 0.140 ms |

Conclusion: cryptographic validation itself is negligible relative to the current client-response budget. Future performance work should focus on storage/network orchestration, not Ed25519 verification.

## 6. Repository implementation consequence

The reference implementation in `gateway/telegram-initdata.mjs` now mirrors the proven target-runtime behavior:

- no dependency on `URLSearchParams`;
- one-pass strict percent decoding;
- raw `+` preserved;
- duplicate decoded keys rejected;
- deterministic code-unit sorting;
- Ed25519 data-check-string excludes `hash` and `signature`;
- freshness enforced after signature validity.

Tests in `gateway/telegram-initdata.test.mjs` cover these rules, including malformed percent escapes, duplicate decoded keys, strict one-pass decoding, raw-plus behavior, canonical order independence, bot-ID tamper, added/removed fields, behavioral hash exclusion and Telegram production-key import.

The GitHub Actions validator gate passed after these runtime-alignment changes.

## 7. Remaining gap

No real Telegram-generated `initData` signature has yet been verified end-to-end against Telegram's production public key.

Therefore the validator is **implementation-ready but not yet production-proven**.

The next release gate is B.2.1-A Bootstrap on an inactive endpoint with real Telegram `initData`, still with:

- no Lead Intake call;
- no CRM lead side effect;
- no consent write;
- no BotFather production menu switch.

Only after a real Telegram initData canary passes may the Bootstrap slice be considered live-validation ready.

## 8. Test workflow retention

Keep both isolated workflows until B.2.1-A live initData validation is closed:

- `kKVHHE5LNHuJUuNR` — primitive/runtime evidence;
- `aGTlNJ1vihi6rGqY` — canonicalization/latency evidence.

Requirements while retained:

- remain inactive;
- remain unpublished;
- zero credentials;
- zero webhook/trigger exposure;
- zero production connections.

After B.2.1-A live validation is accepted and the evidence is recorded in the repository, both probe workflows may be deleted as temporary test infrastructure.
