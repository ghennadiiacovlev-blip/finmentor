# FINMENTOR — Audit Remediation Report

> ## HISTORICAL EVIDENCE — point-in-time, 2026-08-25. Do not act on its GO/NO-GO lines.
>
> This report is the record of the 2026-08-25 remediation **as it stood that night**, and it
> is deliberately left unedited below this banner. Its findings, closures and live-verified
> evidence remain valid as history. Two things in it are **stale as guidance** and must not be
> used to make a decision today:
>
> - **"7/7 gates, 340 assertions"** (§ final verdict, and the merge recommendation table).
>   The suite is now **8 gates / 460 assertions**, with per-gate floors in
>   `qa/assertion-baseline.json`. Current state: `docs/FINMENTOR_CI_QUALITY_GATE.md`.
> - **"Merge remediation branch to `main` — CONDITIONAL GO"**. That recommendation was made
>   against the tree as it was on 2026-08-25 and predates all of B.2.1-C. It is **not** a
>   standing approval. B.2.1-C is **NOT CLEARED** for activation — G1 and G5 are open, three
>   `Bot_Sessions` columns are an unmet deployment precondition, and fifteen live canary
>   items are unexecuted. See `docs/PHASE_B2_1C_THREAT_MODEL.md` §4.1–§4.3.
>
> The **OWNER ACTIONS REQUIRED** section near the end is still live; item 6 (revoke
> `N8N_API_KEY` / `N8N_FIX_API_KEY`) remains outstanding.
>
> Hygiene classification for this file: **KEEP — historical evidence.** See
> `docs/FINMENTOR_POST_REMEDIATION_HYGIENE.md`.

Date: 2026-08-25
Branch: `fix/finmentor-audit-remediation-2026-08-25`
Base: `6b8fefcf4d4b809bf2fb431f7f18b9fb5bfae010` (production main)
Severity base: second independent audit (P0=1, P1=5, P2=16, P3=6)

---

## EXECUTIVE RESULT

**P0 CLOSED. All five P1 CLOSED. Fourteen of sixteen P2 CLOSED. Five of six P3 CLOSED, the
sixth deliberately CLASSIFIED. All four newly discovered findings closed.**

**Phase 10 is COMPLETE and LIVE-PROVEN** — see
`docs/FINMENTOR_PHASE10_MINIAPP_READMODEL_CLOSURE.md`. The Pipeline schema change was applied
by the owner on 2026-08-25 and the attribution deployment followed, closing INDP2-02,
INDP2-05 and INDP2-06 with 53/53 live checks.

Nothing remains open on design, implementation or proof. Two items are left, both needing an
input only the owner can supply: a GA4 Measurement Protocol secret (INDP2-07) and an
edge-layer decision for five HTTP headers (INDP2-14). A native Romanian review of the
machine-translated mini-scan copy is also outstanding as a quality gate.

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
workflows, and **19 of them were still exposed as callable MCP tools**.

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

## Pre-deployment review of the attribution change — five defects, all fixed

An independent review of the attribution work **before** the Pipeline schema was touched
found five defects. None had reached production, because the schema change that would have
activated them had not been made. All five were fixed in code, docs and gates **before** the
owner applied the schema change and authorised deployment.

| # | Defect | Resolution |
|---|---|---|
| 1 | Doc claimed Pipeline was 52 columns; new columns numbered 53–60 | Live header is **51, A:AY**. New columns are **52–59, AZ:BG**. Independently corroborated: `Save to Pipeline` maps exactly 51 columns, last `days_in_stage` |
| 2 | `request_id` called "server-owned" and given a **standalone strong dedup tier** | It is minted in the browser by `lead-transport.js`, which also accepts a caller-supplied value. A standalone tier would have restored the INDP1-02 capability under a new field name. Now corroborated-only |
| 3 | `Build Merge Update` implemented **no** attribution policy | The deploy script patched three nodes and silently skipped the one node on the merge path. Now versioned as `build-merge-update.js` v3 with the full policy |
| 4 | `internal_intake_key` was to be added to the **Settings sheet** | Withdrawn. A spreadsheet is not a secret store — and the key was never in either `Settings to Object` whitelist, so the branch was dead code. Replaced by route-based provenance |
| 5 | Doc told the owner to store the GA4 `api_secret` in Settings | Retracted. n8n Credentials only |

Defect 2 is the serious one. Defect 3 meant every documented merge rule was unimplemented on
the only path where merges happen. Defect 4 was inert but would have become live and harmful
the moment the owner followed the instruction.

**A structural lesson was applied, not just the five fixes.** The deploy script no longer
string-splices individual nodes — that is *why* defect 3 survived, since a patch that only
edits the nodes it names cannot notice the node it forgot. `Dedup Guard` and
`Build Merge Update` are now deployed from their versioned sources with byte-for-byte
read-after-write verification.

---

## Attribution deployment — applied and live-verified 2026-08-25

The owner added the eight columns and authorised the deployment. Sequence, in order:

| Step | Result |
|---|---|
| Live header re-read before touching anything | 51 columns, A:AY, `days_in_stage` last — precondition PASS |
| Owner appended AZ:BG | **59 columns, A:BG**; first 51 byte-for-byte unchanged; AZ:BG exact; no duplicates; no gap column |
| Synthetic lead #1 (header refresh + regression probe) | `ok:true`, `mode:new` — the 51-column append still worked against the widened sheet |
| Dry run | `live Pipeline header: 59 columns`, all eight present, **preflight PASS**, no workflow change |
| `-Apply` | **apply PASS**, **read-after-write PASS**, active unchanged |
| Post-deploy verification (independent of the script) | Lead Intake active; `Save to Pipeline` maps 59 columns, all eight present; Build Pipeline Row, Dedup Guard and Build Merge Update each byte-for-byte equal to their versioned source |
| Live synthetic QA, 5 submissions | **53/53 checks PASS**, re-derived from raw retained execution data |
| Production regression | **NONE** — 0 non-success executions tenant-wide; 8 active workflows; 0 MCP-exposed |

**A sixth defect surfaced during the dry run.** The `Build Pipeline Row` patch asserted the
node declared a `row` variable and appended `row.request_id = …` before the final `return`.
The node has no such variable — it builds its object inline inside the return statement — so
the splice could never have worked. The guard refused and nothing was written. The node is
now versioned as `build-pipeline-row.js` v2 and deployed from file like the others, which is
the same structural fix already applied after defect 3. Two of the six defects in this change
were caused by string-splicing deploys; none remain.

### Live QA evidence

Five submissions on synthetic `.invalid` identities, verified from raw execution data rather
than from the webhook responses:

| Case | Expected | Observed |
|---|---|---|
| A1 — new lead, consent true | all eight columns written | `request_id`, `analytics_consent=TRUE`, both GA ids, first touch and `first_touch_at` all present and correct |
| A2 — same `request_id`, same identity | retry, nothing changes | matched `request_id+identity`, `dedup_is_retry=true`, no escalation, **no merge write at all** |
| **B — A1's `request_id`, different identity** | **must not merge** | **`mode:new`**, no row selected, not corroborated, its own canonical `lead_id`, no GA ids without consent |
| A3 — genuine later submission | last touch advances, first touch preserved | `utm_source` → `qa_last_3`, `utm_source_first` still `qa_first_src`, `first_touch_at` unchanged |
| A4 — later submission, consent false | records FALSE, writes no new GA ids | `analytics_consent=FALSE`, offered `GA1.1.MUSTNOTWRITE` rejected, previously consented ids retained |
| Duplicates | one row per identity | identity A: 1 row; identity B: 1 row; distinct; no extra rows under the QA stamp |

Case B is the one that matters: it is the adversarial scenario the pre-deployment review
demanded, executed against production with the real Dedup Guard, and it did not merge.

**Repo and tenant are fully in sync for Lead Intake.** `build-pipeline-row.js`,
`dedup-guard.js`, `build-merge-update.js` and `normalize-score-lead.js` all match the
deployed nodes byte-for-byte; `n8n/production/` and the manifest were re-exported.

### Provenance node deployed — 2026-08-25

`Normalize + Score Lead` was the last module still deliberately ahead of the tenant. The
owner authorised deploying it to remove the dormant Settings-secret read, and it went out as
a single-node change.

Preflight: live GET, rollback snapshot, active confirmed, exactly one node differing, and the
source statically confirmed to reference `Internal Auth Entry` while reading neither
`settings.internal_intake_key` nor `x-finmentor-internal-key` nor any body/header field.

Read-after-write: node byte-for-byte equal to the source; active unchanged; 57 nodes
unchanged; connections unchanged; all 56 other nodes byte-identical; credentials unchanged;
`availableInMCP` unchanged.

One synthetic submission proved the public path in production, deliberately hostile: it
carried a forged `lead_id` of `FIN-FORGED-TARGET-0001` **and** the retired
`x-finmentor-internal-key` header. Result — `ok:true`, `mode:new`, `provenance_trusted=false`,
the forged id kept only as `submission_lead_id`, a server-minted canonical id, no existing
row selected, and all eight attribution columns still written. 14/14 checks re-derived from
the raw execution.

**Behaviour is unchanged and intentionally so.** Both the old and new code yield
`provenance_trusted = false` today, because `Internal Auth Entry` does not exist yet. What
changed is that the trust path can no longer be switched on by adding a row to a spreadsheet.
Creating that node remains future work and is not authorised here.

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
`submission_lead_id`, honoured as identity solely when the request arrived through the
authenticated internal route (schema doc §5; the original Settings-key design is retired). **Proven live:** a forged `lead_id` from a different contact produced
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

## P2 — 14 of 16 CLOSED, 2 externally blocked

The Pipeline schema change was applied by the owner on 2026-08-25 and the attribution
deployment ran, closing INDP2-02, INDP2-05 and INDP2-06. Two remain: INDP2-07 waits on a GA4
secret that does not exist in this environment, and INDP2-14 shipped the one header the
platform allows and waits on an edge-layer decision. Neither is open on design or code.

INDP2-02 is closed to its achievable scope. Google Sheets has no conditional append, so the
write is still not atomic; the `request_id` column makes a concurrent duplicate **detectable
and reconcilable**, which is the improvement available without moving the ledger to a store
with compare-and-set. The residual is retained below.

| ID | Finding | Status |
|---|---|---|
| INDP2-01 | Clients accept any 2xx | **CLOSED** |
| INDP2-02 | Dedup is not atomic idempotency | **CLOSED** (achievable scope) — live-verified |
| INDP2-03 | Mini App zero-write resume | **CLOSED** — Phase 10 |
| INDP2-04 | No Error Trigger / errorWorkflow | **CLOSED** |
| INDP2-05 | GA fields raw-only | **CLOSED** — live-verified |
| INDP2-06 | UTM first-touch continuity | **CLOSED** — client and structured halves, live-verified |
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
| Lead Intake trust boundary | 43 | **PASS** |
| AI safe projection | 52 | **PASS** |
| Error Monitor alert | 22 | **PASS** |
| Website contract | 69 | **PASS** |
| n8n export hygiene | 70 | **PASS** |
| Mini App read-model consistency | 41 | **PASS** |

**7/7 gates, 340 assertions, all passing.**

Correction to the earlier revision of this report: the website contract and n8n export gates
were recorded as 70 and 72, giving a total of 281. Re-running them reports 69 and 70. Neither
file has changed since; the earlier figures were miscounted, not regressed. The counts above
are what `node qa/run-all.mjs` emits today.

Live QA (not part of the offline suite):

| Suite | Result |
|---|---|
| Lead Intake trust boundary + locators, 3 synthetic submissions | **17/17 PASS** |
| Attribution deployment, 5 synthetic submissions, re-derived from raw executions | **53/53 PASS** |
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

1. ~~Add `internal_intake_key` to the Settings sheet.~~ **WITHDRAWN — do not do this.** An
   independent pre-deployment review found the instruction was wrong twice over. A Google
   Sheet is not a secret store, and neither `Settings to Object` implementation ever exposed
   the key, so `provenance_trusted` has always been `false` and the branch was dead code —
   adding the row would have planted a live secret in a shared spreadsheet *and* switched on
   a trust path that had never executed. Replaced by route-based provenance:
   `docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md` §5. The safe default is unchanged and the
   public path was never at risk.
2. ~~Add eight Pipeline columns~~ **DONE 2026-08-25** — AZ:BG added by the owner, deployment applied and live-verified. Original instruction retained below for the record.

   **Add eight Pipeline columns** — `docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md` §2.1.
   The live header is **51 columns, A:AY**, ending at `days_in_stage`, so the new columns are
   **52–59, AZ:BG**. (An earlier revision said 52 existing columns and numbered the new ones
   53–60; that was wrong and is corrected.) Unblocks INDP2-02, INDP2-05 and INDP2-06's
   structured half. Then run `scripts/deploy-attribution-columns.ps1`, which refuses to run
   until they exist.
3. **Create a GA4 Measurement Protocol `api_secret`** to unblock INDP2-07, and store it in
   **n8n Credentials, not the Settings sheet**. An earlier revision of the schema document
   said Settings; that is retracted. The measurement id `G-94L9B8WZ12` is public and may stay
   as ordinary configuration.
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
| P2 | 16 | **14** | 2 | 1 external secret, 1 platform |
| P3 | 6 | **5** | 1 | INDP3-03 CLASSIFIED — deliberate retention |
| NEW | 4 | **4** | 0 | — |

**Nothing remains open on design, implementation or proof.** Every remaining item needs an
input that only the owner can supply.

### Remaining external / platform blockers

| # | Blocker | Blocks | Owner action |
|---|---|---|---|
| 1 | GA4 Measurement Protocol `api_secret` does not exist in this environment | INDP2-07 | create it in GA4 admin and store it in **n8n Credentials — not the Settings sheet** |
| 2 | GitHub Pages / Fastly cannot set response headers | INDP2-14, five headers | decide on an edge layer (Cloudflare in front of the existing origin, DNS-only) |
| 3 | RO mini-scan copy is machine-translated | customer-facing quality, not a finding | native Romanian review before promotion |

Cleared since the previous revision: the eight Pipeline columns (applied and deployed
2026-08-25) and `internal_intake_key` (withdrawn — a spreadsheet is not a secret store; see
the pre-deployment review and schema doc section 5).

### GO / NO-GO by scope

| Scope | Verdict | Basis |
|---|---|---|
| Current production website | **GO — keep running** | no regression; 69/69 website contract. Unverified by observation: consent-banner behaviour, layout, GA4 DebugView. RO copy is machine-translated |
| Current CRM / Telegram production | **GO — keep running** | P0 closed and live-verified, 5/5 P1 closed, Error Monitor active on all 8, Digest restored, locators canonical, MCP exposure 0/35, attribution deployed with zero regression |
| Attribution + idempotency release | **SHIPPED** | schema applied, deployed, 53/53 live checks, zero regression |
| Server-side GA4 lifecycle release | **NO-GO** | needs the Measurement Protocol secret (INDP2-07). No code work remains |
| Mini App activation | **NO-GO** | B.2.1-C never started, by design. Contract is proven but nothing is deployed behind it, and B.2.1-A still needs a real `initData` canary |
| PR #10 | **DO NOT MERGE — recommend closing** | docs-only, superseded where it mattered, and its reversed-order "PASS" overstated equality. Close it in favour of the Phase 10 document |
| Merge remediation branch to `main` | **CONDITIONAL GO — owner's call** | technically mergeable: 7/7 gates, 340 offline assertions, 22 independent live checks. Recommend holding for the native Romanian review first, since that copy is customer-facing advisory content |

**Final tenant state:** 35 workflows, 8 active (the expected production set), 0 exposed via
MCP, `03DcHoJ5XxJYUZQ4` inactive and unexposed, unsafe Command Center retained OFF as the
rollback point. Repo and tenant are in sync for every Lead Intake module. Nothing merged, no
PR opened, no QA workflow published, Mini App not activated.
