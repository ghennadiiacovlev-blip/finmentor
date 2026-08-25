# FINMENTOR — Audit Remediation Report

Date: 2026-08-25
Branch: `fix/finmentor-audit-remediation-2026-08-25`
Base: `6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010` (production main)
Severity base: second independent audit (P0=1, P1=5, P2=16, P3=6)

---

## EXECUTIVE RESULT

**P0 CLOSED. All five P1 CLOSED. Eleven of sixteen P2 CLOSED, the other five owner- or
platform-gated with their implementable half applied. Five of six P3 CLOSED, the sixth
deliberately CLASSIFIED. All four newly discovered findings closed.**

**Phase 10 is COMPLETE and LIVE-PROVEN** — see
`docs/FINMENTOR_PHASE10_MINIAPP_READMODEL_CLOSURE.md`. Nothing remains open on design,
implementation or proof. Everything outstanding needs an input only the owner can supply: the
Pipeline schema change, a GA4 secret, the intake key, an edge-layer decision, and a native
Romanian review.

Four facts contradicted the briefing and were corrected against the live tenant:

1. **The unsafe Command Center was still ACTIVE** when work began — the briefing said it was
   already unpublished. The P0 was live and exploitable. Contained first.
2. **The Daily Digest was already INACTIVE** — both audits recorded it active. Its 7/7
   failures had stopped by being switched off, not fixed.
3. **The secure candidate's real id is `qF9tonlHHIxc8MDd`** (lowercase L). The pre-existing
   patcher hardcoded `qF9tonIHHIxc8MDd` and had never run, so "SECURE CANDIDATE" was an
   unmodified clone of the unsafe workflow, generic public webhook and all.
4. **`_headers` does nothing.** It is Netlify syntax; the site is GitHub Pages on Fastly.

**Two new vulnerabilities were found that neither audit reported**, both by live QA rather
than code reading. See section "New findings".

The public website did not regress. All eight production workflows are active and healthy.
No real lead row was read, written or mutated at any point.

---

## P0 — CLOSED

### INDP0-01 — Command Center trusts caller-controlled Telegram identity

| Verification (live, re-checked after owner publish) | Result |
|---|---|
| Unsafe original `Ukn1cprWiXzBHojl` active | **false** |
| SECURE CANDIDATE `qF9tonlHHIxc8MDd` active | **true** |
| Generic webhook nodes in the secure candidate | **0** |
| Telegram Trigger nodes | **1**, on `FINMENTOR Leads Bot FINAL` |
| Active Telegram Triggers on that credential, tenant-wide | **exactly 1** |
| `POST` / `GET` on `/webhook/finmentor-lead-command-center` | **404** (both, plus `-test`) |
| Secure candidate Pipeline GID | **1883973304** |
| Stale GID `1997367085` present | **false** |
| Owner read canary `/pipeline` | **PASS** — correct funnel summary returned |
| CRM mutation nodes executed during canary | **NONE** |

Canary execution path, from retained execution data:
`Telegram Command Trigger → Verify Telegram Identity → Read Settings → Settings to Object →
Parse Lead Command v2 → Route Command Mode → Get Pipeline (Query) → Build Query Reply →
Telegram Query Reply`. `Update Pipeline Row`, `Save Status_Log` and `Save Activity` did not
run.

```
P0 COMMAND CENTER:      CLOSED
AUTHENTICATED TRANSPORT: PASS
OWNER READ CANARY:       PASS
UNSAFE ORIGINAL:         OFF
PII EXFILTRATION PATH:   CLOSED
```

The unsafe original is retained inactive as the rollback point, nodes and connections
byte-identical to its pre-containment snapshot.

---

## New findings — not in either audit

### NEW-1 — Any digit-bearing email became a phone identity  *(severity: P1-class)*

`phoneRaw` falls back to `lead.contact`, which on the consultation form is usually an email.
`normPhone` stripped every non-digit and accepted any 6–15 digit run, so
`qa-20260825-202641@example.com` normalised to the phone identity `20260825202641`, which
`Dedup Guard` then matched against the `phone` column.

**Exploit:** register an address whose digit run equals a victim's phone —
`x37360123456@evil.example` against `+373 60 123 456` — and the submission merges into that
victim's Pipeline row, reaching the same escalation and state-rewrite surface as INDP1-02.
Unlike INDP1-02 this needs no knowledge of any `lead_id`.

Surfaced when QA step 3 returned the victim's `lead_id` even though the caller `lead_id` had
been correctly quarantined: the two synthetic identities shared a date stamp, so their emails
produced identical phone identities. The trust boundary had held; a second path had not.

**Fixed.** A phone identity is derived only from phone-shaped input: values containing `@`,
Telegram handles and `t.me` links are rejected, and the leading segment must be digits and
phone punctuation only. `+373 60 123 456 (Viber)` still normalises. 7 regression cases.

### NEW-2 — Every production workflow was exposed as an MCP tool

All seven carried `settings.availableInMCP = true`. These append to Pipeline, Leads and
Activities and send owner Telegram messages; exposing them as callable tools widens the
trigger surface beyond their intended entry points — the same class of problem as the
Command Center's generic webhook. **All set to false**, nodes and connections asserted
byte-identical across the write.

### NEW-3 — Two latent locator failures that had never executed

`SLA Lead Watch → Save Activity` and `Followup Sequence → Save New Followups` carried the
same name-as-gid defect that broke the Digest. Retained history shows those nodes have
**never executed**, so both would have failed on the first real SLA breach or new followup.
Both repaired.

### NEW-4 — MCP exposure was closed on production but not on QA  *(severity: P2-class)*

Found during Phase 10. NEW-2 set `availableInMCP = false` on the seven production workflows
and on the retained unsafe Command Center. It did not extend to the QA, benchmark and canary
workflows, and **19 of them are still exposed as callable MCP tools**.

All are inactive, but MCP exposure is a trigger surface independent of the active flag — which
is precisely the argument NEW-2 rested on. The set includes `NlIHfmuBQ4mS70G6`, whose own
description says publishing it "would be an identity bypass" because it injects synthetic
identities with no Telegram validation; `1Yw9LF6EJNCAYkQx`, which sends owner Telegram
messages using the Client Concierge Bot credential; four benchmarks that read `Bot_Sessions`
directly; and the five read-model QA workflows that write the QA Data Table.

**CLOSED.** `scripts/harden-mcp-exposure.ps1 -Apply` was run over all 19, each write verified
read-after-write with nodes and connections byte-identical and the active state unchanged. A
tenant-wide re-read confirms **0 of 35 workflows are exposed via MCP**, with the expected 8
production workflows still active. Full inventory in
`docs/FINMENTOR_PHASE10_MINIAPP_READMODEL_CLOSURE.md` §10.2.

---

## P1 — 5 of 5 CLOSED

| ID | Finding | Status |
|---|---|---|
| INDP1-01 | GA4 forwards arbitrary query after consent | **CLOSED** |
| INDP1-02 | Public intake selects rows by caller `lead_id` | **CLOSED** |
| INDP1-03 | OpenAI receives contact PII + full raw payload | **CLOSED** |
| INDP1-04 | `mini_scan` missing from `generate_lead`; tool-only dedup | **CLOSED** |
| INDP1-05 | Command Center write locator unresolved | **CLOSED** |

**INDP1-01** — `page_location` / `page_path` rebuilt from `origin + pathname +` a whitelist;
values must be plain tokens and pass email/phone scrubbers first, so PII is dropped even
under a whitelisted key. Fragment never forwarded.

**INDP1-02** — canonical identity is server-owned; a caller value survives only as
`submission_lead_id`, honoured as identity solely when the request presents Settings'
`internal_intake_key`. **Proven live:** a forged `lead_id` from a different contact produced
`mode=new` with a different server-minted id and selected nothing.

**INDP1-03** — `AI_SAFE_PROJECTION` with allowlist + depth-wise key denylist + value
scrubbing, then a post-build leak check that emits nothing rather than send. Disclosures in
both locales now describe the real path (n8n, Sheets, Telegram, OpenAI); the false Cloudflare
claim removed.

**INDP1-05** — root cause was broader than reported: three write nodes pointed at a
*different spreadsheet* (`16Eepil...`) and two append nodes passed sheet **names** where n8n
expects a gid. Canonical now: Pipeline `1883973304`, Status_Log `1810362432`,
Activities `623316892`. Zero name-mode locators remain in any active workflow.

---

## P2 — 11 of 16 CLOSED, 5 owner- or platform-gated

Of the five that are not closed, none is open on design or implementation. INDP2-02 and
INDP2-06 shipped their client half and wait on the Pipeline columns; INDP2-05 waits on the
same columns; INDP2-07 waits on a GA4 secret that does not exist in this environment;
INDP2-14 shipped the one header the platform allows and waits on an edge-layer decision.

| ID | Finding | Status |
|---|---|---|
| INDP2-01 | Clients accept any 2xx | **CLOSED** |
| INDP2-02 | Dedup is not atomic idempotency | **PARTIAL** — schema-blocked |
| INDP2-03 | Mini App zero-write resume | **CLOSED** — Phase 10 |
| INDP2-04 | No Error Trigger / errorWorkflow | **CLOSED** |
| INDP2-05 | GA fields raw-only | **BLOCKED** — schema |
| INDP2-06 | UTM first-touch continuity | **CLOSED** (client); structured half schema-blocked |
| INDP2-07 | Server-side GA4 lifecycle sender | **BLOCKED_EXTERNAL_SECRET** |
| INDP2-08 | Event taxonomy; pre-submit `lead_submit` | **CLOSED** |
| INDP2-09 | PR #10 stored-row projection | **CLOSED** — live-proven, execution 3400 |
| INDP2-10 | PR #10 authority / fallback matrix | **CLOSED** — live-proven, execution 3400 |
| INDP2-11 | Sheets resume latency | **CLOSED** — decision recorded, Phase 10 §6 |
| INDP2-12 | RO mini-scan Russian strings | **CLOSED** |
| INDP2-13 | 60 x-default conflicts | **CLOSED** |
| INDP2-14 | Security headers absent | **PARTIAL / PLATFORM_BLOCKER** |
| INDP2-15 | Bootstrap canary has no assertions | **CLOSED** |
| INDP2-16 | Daily Digest fails Activities append | **CLOSED** |

**INDP2-04 — Error Monitor.** `RBiFLhVjizMkAzrK`, active, wired as `errorWorkflow` on all
eight production workflows. Alerts carry workflow id/name, node, error class, timestamp and
execution id; never the payload. Live QA drove a deliberate failure with synthetic contact
data and caught two defects in the alert builder itself: n8n splits a thrown error at the
first `": "` (head → `error.description`, tail → `error.message`), so reading only `message`
gave a meaningless fragment while `description` held the contact text; and the URL rule only
matched `https?://`, letting the decapitated `//host/path` remnant through. Both fixed;
13/13 live assertions pass.

**INDP2-16 — Digest.** Proven by execution before reactivation: a clone ran with its Telegram
node disabled, and `Save Activity` appended against gid `623316892` with no error. Proving no
delivery occurred required care — a disabled n8n node still appears in `runData` as a
pass-through, so its output shape was checked instead (`digest_message, stats`, not a Bot API
response). Production Digest is **active again**.

**INDP2-14 — headers.** Verified live: GitHub Pages on Fastly, all six absent, `_headers` is
Netlify syntax and inert. Applied the one true equivalent — `<meta name="referrer">` on all
88 pages. CSP deliberately not shipped as meta: enforcing with no report-only mode, needs
`'unsafe-inline'` anyway, `frame-ancestors` ignored in meta, and no browser was available to
validate before publish. Remaining five documented as PLATFORM_BLOCKER; smallest complete fix
is Cloudflare in front of the existing Pages origin, a DNS-only change. **No migration
performed.**

---

## P3 — 5 of 6 CLOSED, 1 CLASSIFIED

Corrected count: an earlier revision of this report said "4 of 6" while its own table below
listed five CLOSED. INDP3-03 is CLASSIFIED rather than closed because the resolution was a
deliberate decision to retain, not to delete — that is an outcome, not an omission.

| ID | Finding | Status |
|---|---|---|
| INDP3-01 | 22 legacy alias pages | **CLOSED** |
| INDP3-02 | Obsolete GA ID in archives | **CLOSED** (marked, not rewritten) |
| INDP3-03 | Inactive QA workflow retention | **CLASSIFIED** — nothing deleted |
| INDP3-04 | GitHub ↔ n8n versioning drift | **CLOSED** |
| INDP3-05 | Canary resolves relative to cwd | **CLOSED** |
| INDP3-06 | Retained regression suite, custom 404 | **CLOSED** |

**INDP3-01** was worse than recorded: all 22 return HTTP 200 while declaring canonicals to
unrelated pages or to `/en/...` paths that 404. Now `noindex,follow` with the broken canonical
removed — not deleted, since inbound links may exist.

---

## PRODUCTION WORKFLOWS

| ID | Name | Active | Hash (16) |
|---|---|---|---|
| `QmIyEW2ZEqKregmN` | Lead Intake PREMIUM FINAL | **true** | `9c08a4456ab07a2f` |
| `mppzthlkSJFr6Kle` | Telegram Client Concierge AI GUARDED | **true** | see manifest |
| `ShcmmJeLSE8LYVBk` | Telegram Client Transport | **true** | see manifest |
| `LZ2mvKXbBikmeVTn` | SLA Lead Watch PREMIUM FINAL | **true** | `148e1096d92d10e2` |
| `zeLOCuf0K1bkaKl2` | Followup Sequence PREMIUM v2 | **true** | `353435b5d8cb15a3` |
| `imeJIDeNyaWDyXzh` | Daily Lead Digest PREMIUM FINAL | **true** | `3035ec6c558d38cc` |
| `qF9tonlHHIxc8MDd` | Lead Command Center SECURE CANDIDATE | **true** | `96938c3f3c0c4894` |
| `RBiFLhVjizMkAzrK` | Error Monitor PREMIUM | **true** | see manifest |
| `Ukn1cprWiXzBHojl` | Command Center (unsafe original) | **false** — rollback point | `3409d1984d24d23c` |

**GITHUB ↔ N8N DRIFT: MEASURABLE.** Nine redacted exports plus manifest in `n8n/production/`.
Redaction needed a second pass: the owner's Telegram id is hardcoded inside node `jsCode`
where key-based rules cannot see it, and a blanket rule on 9–10 digit numbers was impossible
because canonical sheet gids are the same shape. Quoted 6–12 digit literals are now redacted
against a gid allowlist. Verified: zero occurrences of the owner id, all gids intact.

---

## TESTS

`node qa/run-all.mjs` — offline, no credentials, no network, no browser, cwd-independent.

| Gate | Assertions | Result |
|---|---|---|
| Command Center authorisation | 43 | **PASS** |
| Lead Intake trust boundary | 22 | **PASS** |
| AI safe projection | 52 | **PASS** |
| Error Monitor alert | 22 | **PASS** |
| Website contract | 69 | **PASS** |
| n8n export hygiene | 70 | **PASS** |
| Mini App read-model consistency | 41 | **PASS** |

**7/7 gates, 319 assertions, all passing.**

Correction to the earlier revision of this report: the website contract and n8n export gates
were recorded as 70 and 72, giving a total of 281. Re-running them reports 69 and 70. Neither
file has changed since; the earlier figures were miscounted, not regressed. The counts above
are what `node qa/run-all.mjs` emits today.

Live QA (not part of the offline suite):

| Suite | Result |
|---|---|
| Lead Intake trust boundary + locators, 3 synthetic submissions | **17/17 PASS** |
| Digest locator proof (isolated clone, Telegram disabled) | **PASS** |
| Error Monitor fire + scrub proof | **13/13 PASS** |
| Mini App read-model CAS + stored-row equality, execution 3400 | **PASS** (all 10 verdict fields) |
| Independent re-derivation of execution 3400 from the raw stored row | **22/22 PASS** |

**Execution 3400** (2026-08-25, manual, success) closed INDP2-09 and INDP2-10. It reproduced
the historical defect against the real Data Table and caught it: after a publish set that
omitted `session_id`, the stored row still read `S-OLD` where `S-NEW` was intended — the old
intended-payload verifier accepted that row, the corrected stored-row verifier rejected it and
named `session_id`. The subsequent complete publish converged the row to `S-NEW` with
`cache_valid = true`, a limit-2 read returning exactly one row, no missing fields and no
differing fields. A superseded `sync_token` updated zero rows; the current one updated one.

The verdict was not taken on trust. `scripts/verify-live-cas-execution.mjs` re-derives
everything from the raw retained execution using the repository's own `projection.js` and
passes 22/22, including reproducing the tenant's stored `projection_version` exactly. The
deployed n8n Code node and the repository implementation are therefore behaviourally
identical, which is what makes the offline gate a real guard on the live system.

The executed graph contained zero Google Sheets, HTTP Request or Execute Workflow nodes, so no
authoritative write was structurally possible. Identity was the synthetic `990000001`.

All QA used synthetic identities on the RFC 2606 reserved `.invalid` TLD, so no real address
could be contacted. Evidence rows are QA-marked and deliberately retained.

---

## OWNER ACTIONS REQUIRED

1. **Add `internal_intake_key`** to the Settings sheet (long random value). The Concierge
   already sends it. Until then it loses only the strong dedup tier; the public path is
   already safe.
2. **Add eight Pipeline columns** — `docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md` §2.1.
   Unblocks INDP2-02, INDP2-05 and INDP2-06's structured half. Then run
   `scripts/deploy-attribution-columns.ps1`, which refuses to run until they exist.
3. **Create a GA4 Measurement Protocol `api_secret`** to unblock INDP2-07.
4. **Decide on the edge layer** for the five remaining security headers.
5. **Native Romanian review** of the translated mini-scan copy before promotion.
6. **Revoke `N8N_API_KEY` and `N8N_FIX_API_KEY`** once this phase is accepted.

Completed since the previous revision: the `availableInMCP` sweep (NEW-4) and the live CAS
gate run (execution 3400). Neither remains an owner action.

---

## RESIDUAL RISKS

- Lead Intake concurrency: two simultaneous first-time submissions from the same contact can
  still create two rows. Google Sheets has no conditional append; the schema change makes the
  race **detectable and reconcilable**, not impossible.
- The Mini App read-model contract is now proven, but nothing is deployed behind it: no
  production mirror exists, the Client Concierge writers are unmodified, no backfill has run
  and reconciliation is not activated. The QA race runner `UEnjDvZGjMqsNdAI` and mirror helper
  `OwLC7SANtHo69SKo` still carry the old verifier and must not be cited as evidence unless
  they are rebuilt on `projection.js` first.
- B.2.1-A still lacks its final gate: a real Telegram-generated `initData` canary against the
  production Ed25519 public key. The runtime primitive and canonicalisation are proven with
  synthetic signatures; the end-to-end signature path is not.
- No browser-based verification was possible: consent-banner behaviour, layout and GA4
  DebugView remain unverified by observation.
- The RO translation is machine-produced. It is a strict improvement on serving Russian to
  Romanian visitors, but it is customer-facing advisory copy.

---

## FINAL

### Severity ledger

| Severity | Total | Closed | Remaining | Nature of the remainder |
|---|---|---|---|---|
| P0 | 1 | **1** | 0 | — |
| P1 | 5 | **5** | 0 | — |
| P2 | 16 | **11** | 5 | 3 owner-schema, 1 external secret, 1 platform |
| P3 | 6 | **5** | 1 | INDP3-03 CLASSIFIED — deliberate retention |
| NEW | 4 | **4** | 0 | — |

**Nothing remains open on design, implementation or proof.** Every remaining item needs an
input that only the owner can supply.

### Remaining external / platform blockers

| # | Blocker | Blocks | Owner action |
|---|---|---|---|
| 1 | Eight Pipeline columns not present | INDP2-02 strong tier, INDP2-05, INDP2-06 structured half | add columns, then run `deploy-attribution-columns.ps1` |
| 2 | GA4 Measurement Protocol `api_secret` does not exist here | INDP2-07 | create in GA4 admin, store in Settings |
| 3 | `internal_intake_key` absent from Settings | strong dedup tier only | add a long random value |
| 4 | GitHub Pages/Fastly cannot set response headers | INDP2-14, five headers | decide on an edge layer (Cloudflare, DNS-only) |
| 5 | RO mini-scan copy is machine-translated | customer-facing quality | native Romanian review |

### GO / NO-GO by scope

| Scope | Verdict | Basis |
|---|---|---|
| Current production website | **GO — keep running** | no regression; 69/69 website contract. Unverified by observation: consent-banner behaviour, layout, GA4 DebugView. RO copy is machine-translated |
| Current CRM / Telegram production | **GO — keep running** | P0 closed and live-verified, 5/5 P1 closed, Error Monitor active on all 8, Digest restored, locators canonical, MCP exposure 0/35 |
| New integration release (attribution, idempotency, server-side GA4) | **NO-GO** | blockers 1 and 2. No code work remains; the deploy script refuses to half-apply |
| Mini App activation | **NO-GO** | B.2.1-C never started, by design. Contract is proven but nothing is deployed behind it, and B.2.1-A still needs a real `initData` canary |
| PR #10 | **DO NOT MERGE — recommend closing** | docs-only, superseded where it mattered, and its reversed-order "PASS" overstated equality. Close it in favour of the Phase 10 document |
| Merge remediation branch to `main` | **CONDITIONAL GO — owner's call** | technically mergeable: 7/7 gates, 319 offline assertions, 22 independent live checks. Recommend holding for the native Romanian review first, since that copy is customer-facing advisory content |

**Not merged. No QA workflow published. The CAS gate was not re-run. No production change was
made while producing this status** — the tenant was read only: 35 workflows, 0 exposed via
MCP, 8 active, `03DcHoJ5XxJYUZQ4` inactive with `availableInMCP: false`.
