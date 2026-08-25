# FINMENTOR Phase 10 — Mini App read-model closure

Date: 2026-08-25
Branch: `fix/finmentor-audit-remediation-2026-08-25`
Covers: INDP2-03, INDP2-09, INDP2-10, INDP2-11 — all CLOSED, live-proven by execution 3400
Supersedes, for the items below, the six B.2.1-B design documents on PR #10.

PR #10 is **not merged** and remains draft. Its documents were read for context only. This
file is the canonical statement of the corrected design; where it disagrees with a PR #10
document, this file wins.

---

## 1. Why the live QA runs passed while the design was still broken

The PR #10 evidence proved the right things about the wrong artefact. The Data Table
compare-and-set primitive, real execution overlap, the TOCTOU window and reversed
authoritative completion order were all exercised against the live tenant and all behaved
correctly. What was never correct was the **verifier**, and a verifier that is wrong cannot
be rescued by a correct primitive underneath it.

Two defects, one root cause — the helper checked its own intentions instead of the stored row:

1. **Incomplete publish set.** The conditional publish omitted mirrored fields. On the
   reversed-order run the omitted field was `session_id`, so the derived row kept the stale
   `S-CAS` while the generation intended `S-GEN-A2`. The live Conditional Publish also
   omitted `urgency`, `consent_at` and `lead_intake_ok`.
2. **Hash computed from the intended payload.** `projection_version` was recomputed from the
   payload the helper *meant* to write, so the column matched perfectly while the row it
   described did not exist. This is what let defect 1 pass verification.

The consequence for the audit's language matters: "final cache matches final authority" was
never proven field-by-field. Only ordering, and only for the fields that happened to be in
the publish set.

---

## 2. Canonical projection

Implemented in `n8n/src/miniapp-readmodel/projection.js` and deployed into both the mirror
helper and the fast read node.

`PROJECTION_FIELDS` — 15 fields, this order, which is also the hash order:

```
chat_id, session_id, state, status, selected_service, business_model, main_pain,
urgency, consent, lead_id, cycle_id, consent_cycle_id, consent_at, lead_cycle_id,
lead_intake_ok
```

`CONTROL_FIELDS` — cache metadata, never hashed, never returned to the browser:

```
cache_valid, sync_token, projection_version, source_updated_at, mirror_updated_at
```

Rules that are now enforced in code rather than asserted in prose:

- **The complete set is always published.** A publish that omits any mirrored field fails
  verification and the row is invalidated.
- **`projection_version` is SHA-256 over the canonical serialisation of the STORED row**,
  never over the intended payload. Equality is additionally checked field-by-field, so a hash
  collision or a tampered hash column cannot produce a false HIT on its own.
- **Values are normalised before hashing.** Google Sheets returns strings; the Data Table
  round-trips `cache_valid` and `lead_intake_ok` as real booleans. Without normalisation the
  boolean `true` and the string `"true"` hash differently and every mirrored row would appear
  to drift. This is not hypothetical — the live QA table types both columns as `boolean`.
- **Serialisation is injection-safe.** Each key and value is `JSON.stringify`-ed
  independently, so a value containing the field separator cannot forge a field boundary.
- **Allowlist only.** `raw`, `notes`, `previous_lead_id` and any payload column cannot reach
  the derived table, and a derived row that somehow carries one is treated as malformed.

---

## 3. Commit-order generation, unchanged in design, corrected in execution

The two-token commit-order sequence from the PR #10 design was correct and is retained
verbatim in `n8n/src/miniapp-readmodel/mirror-helper.js`: pre-write invalidation, the
authoritative write, a commit token issued **after** the successful commit, an authoritative
re-read, a conditional publish matching `chat_id` AND `sync_token` in a single operation, and
read-back verification.

Two things changed:

- the publish set is now the complete projection plus control metadata;
- verification reads the row back with **limit 2** and hashes what it found.

`skipAuthoritativeWrite` was added for backfill and reconciliation, which mirror a commit that
has already happened. Neither may ever write to `Bot_Sessions`, and the gate asserts zero
authority writes on both paths.

---

## 4. Fallback matrix

The Mini App fast read accepts exactly one row with `cache_valid = true` that is well-formed
and whose stored hash matches. Everything else falls back to authoritative `Bot_Sessions`:

| Condition | Result |
|---|---|
| exactly one valid row | HIT |
| zero rows | FALLBACK `MISS` |
| `cache_valid = false` | FALLBACK `TOMBSTONE` |
| two or more rows | FALLBACK `DUPLICATE_ROWS` |
| Data Table error | FALLBACK `DATA_TABLE_ERROR` |
| any mirrored key absent, empty `chat_id`, or a forbidden field present | FALLBACK `MALFORMED_ROW` |
| stored hash ≠ `projection_version` column | FALLBACK `VERSION_MISMATCH` |

Limit 2 is load-bearing and the gate proves it rather than asserting it: the same duplicated
pair returns HIT under a limit-1 read and FALLBACK under limit 2. A limit-1 lookup cannot
distinguish a healthy row from the first of two corrupted ones.

An arbitrary first row is never selected, and a tombstone is never read as state.

---

## 5. Zero-write resume — INDP2-03

`docs/PHASE_B2_1_GATEWAY_CONTRACT.md` §5 previously told the Gateway to mint a cycle when no
valid session existed, while B.2.1-B required zero-write resume. That conflict is resolved in
favour of zero-write, and §5.1 of that document now states the canonical rule.

`resolveResume` returns `cycle_created: false`, `cycle_reset: 'none'` and an all-zero `writes`
block on every branch. Repair of a stale or duplicated derived row is explicitly not the read
path's job — it belongs to the mirror helper and to reconciliation — so that serving a Mini App
open can never become a write.

The client response is a strict whitelist of six presentation fields. A recursive leak check
rejects control metadata, n8n row internals and every identity field, and the gate runs it on
both the cache-hit and the authoritative-fallback response.

---

## 6. Latency decision — INDP2-11

Recorded canonically so it survives PR #10 remaining unmerged.

The production Google Sheets node is the synchronous critical path: at a deliberately low
request rate, five real owner requests spaced 15 seconds apart spent 6079–7190 ms inside the
Sheets read, median ~6659 ms, against a ~12 ms pre-Sheets stage and a ~12 ms post-Sheets
stage. Burst pressure was excluded as the cause. The same path against a Data Table read model
measured 15–21 ms, P50 16 ms.

**Decision: `Bot_Sessions` on Google Sheets is not viable in the synchronous Mini App resume
path, and the derived Data Table read model is the accepted read-path technology.** Direct
Google Sheets REST was not available because the existing OAuth credential deliberately blocks
generic HTTP Request use, and that restriction was preserved rather than weakened.

`Bot_Sessions` remains the sole source of truth. The read model is derived, non-authoritative,
minimal, and always falls back to authority rather than serving a doubtful row.

---

## 7. Contradiction between PR #10 documents — resolved

`PHASE_B2_1B_CONSISTENCY_QA_CAS.md` recorded reversed commit order as PASS while
`PHASE_B2_1B_READMODEL_SYNC_DESIGN.md` still listed it as the highest-priority open test. Both
were partly right, which is why the contradiction survived review.

Canonical resolution:

- **Ordering** under reversed authoritative completion order was genuinely proven live: the
  final cache followed the last authoritative commit, not workflow start order. PASS.
- **Equality** was not proven, because the run that proved ordering is the same run whose
  publish set omitted `session_id`. OPEN at the time of that document.
- Equality is now proven for the corrected implementation by
  `qa/miniapp-readmodel.test.mjs`, field-by-field, from the stored row.

---

## 8. Executable proof

`qa/miniapp-readmodel.test.mjs`, registered as the seventh gate in `qa/run-all.mjs`.
41 checks, offline, no credentials, no network, cwd-independent.

| Group | Covers | Checks |
|---|---|---|
| A | canonical projection, hash stability, type normalisation, injection, per-field sensitivity | 8 |
| B | stored-row verification and every rejection reason | 6 |
| C | fast read fallback matrix, limit-2 proof | 8 |
| D | zero-write resume, leak check, identity steering | 4 |
| E | read-only cycle evaluation, blank-cycle safety | 3 |
| F | normal order, TOCTOU, reversed order, incomplete publish, idempotent replay | 5 |
| G | failure invalidation from an existing valid row | 3 |
| H | backfill idempotence, duplicate repair, reconciliation classification | 4 |

The gate is verified load-bearing by mutation rather than assumed to be. Reintroducing the
historical defect — hashing `expected` instead of `stored`, and dropping the field-by-field
diff — fails exactly three checks:

```
FAIL  the stored-row verifier rejects the omitted session_id
FAIL  an incomplete publish set is caught by the helper, not published as valid
FAIL  a verification mismatch from an existing readable row invalidates it
```

Group B carries an explicit **regression witness**: it asserts that the historical scenario
would have satisfied the old intended-payload hash, so the test proves the defect was real
rather than merely testing that today's code agrees with itself.

The Data Table and `Bot_Sessions` doubles implement the same conditional-update semantics the
live CAS proof observed, and the code under test is the code that deploys — the clients are
injected, not imported.

---

## 9. What is proven where

Being precise about this is the whole point of the finding, so it is stated plainly.

| Property | Proven by | Status |
|---|---|---|
| Data Table CAS primitive, single conditional update on `chat_id` + `sync_token` | live tenant, PR #10 | PASS |
| Real overlapping execution and the TOCTOU window | live tenant, PR #10 | PASS |
| Ordering follows authoritative commit completion | live tenant, PR #10 | PASS |
| Read latency 15–21 ms vs 6–7 s | live tenant, PR #10 | PASS |
| Complete publish set including `session_id` | Phase 10 gate | PASS |
| Stored-row equality, field-by-field | Phase 10 gate | PASS |
| Hash computed from the stored row | Phase 10 gate | PASS |
| Duplicate / MISS / outage / tombstone / malformed / version-mismatch fallback | Phase 10 gate | PASS |
| Strong invalidation from an existing `cache_valid=true` row | Phase 10 gate | PASS |
| Zero-write resume on every branch | Phase 10 gate | PASS |
| Idempotent backfill, duplicate repair, reconciliation classification | Phase 10 gate | PASS |
| Complete publish set and stored-row equality **in the tenant** | live execution 3400 | **PASS** |
| The historical defect reproduced and caught **in the tenant** | live execution 3400 | **PASS** |

**Phase 10 is LIVE-PROVEN.** Nothing in the matrix is outstanding.

### 9.1 The corrected live gate — deployed, awaiting one Execute

QA-only workflow `03DcHoJ5XxJYUZQ4` ("FINMENTOR B.2.1-B CAS Gate") has been rebuilt. It is
**inactive**, carries `availableInMCP: false`, and is reproducible from
`scripts/build-cas-gate-workflow.mjs`, which regenerates the deployed payload byte-for-byte.

The gate it replaces is the one the review faulted in defect 4: its limit-2 read only checked
the static marker string `PV_WRITTEN_BY_CORRECT_HELPER`, and its hash exercise ran entirely in
memory over objects that never touched the Data Table. It could not have detected the
incomplete publish set that shipped.

Twelve nodes, executing against the real QA Data Table `dk2oK5tL1P2bKLhK`:

| Step | Proves |
|---|---|
| Seed Row | a complete, valid, readable `cache_valid=true` row — the strong precondition |
| Install Commit Token | post-commit generation token; mirrored fields deliberately survive |
| Stale Publish Attempt → Count Stale | a superseded token updates **zero** rows |
| Incomplete Publish | the historical defect, live: `session_id` omitted, hash written from intent |
| Read Back A → Verdict A | **negative control** — the old verifier accepts this row, the corrected one rejects it |
| Complete Publish | the corrected publish: all 15 fields |
| Read Back B → Final Verdict | limit-2 read, no missing fields, field-by-field equality, SHA-256 recomputed from the stored row |

Static verification of the deployed graph, done from this session:

- `Seed Row` writes 15/15 projection fields;
- `Incomplete Publish` writes 14/15, omitting exactly `session_id` — the deliberate control;
- `Complete Publish` writes 15/15;
- all four Code nodes parse under `node --check`.

### 9.2 Live result — execution 3400, 2026-08-25, manual, success

The owner ran it. All twelve nodes executed; `Final Verdict` reported:

```
GATE                        PASS
stale_token_updated_rows    0        CAS_STALE_ZERO_ROWS      PASS
complete_publish_updated_rows 1      CAS_VALID_ONE_ROW        PASS
rows_found_limit2           1        DUPLICATE_FREE           PASS
missing_fields              []       COMPLETE_PUBLISH_SET     PASS
diff_fields                 []       STORED_ROW_EQUALITY      PASS
                                     HASH_FROM_STORED_ROW     PASS
                                     HASH_MATCHES_AUTHORITY   PASS
                                     CACHE_VALID_TRUE         PASS
NEGATIVE_CONTROL            PASS
```

The negative control is the result that matters, because it demonstrates the defect was real
rather than hypothetical. After the incomplete publish, against the real Data Table:

```
stored_session_id  S-OLD          intended_session_id  S-NEW
old_verifier_accepted_incomplete_row   true
new_verifier_accepted_incomplete_row   false
```

The historical verifier accepted a row that had kept the previous generation's `session_id`.
The corrected verifier rejected it, naming `session_id` as the sole differing field. After the
complete publish the stored row converged to `S-NEW` with `projection_version`
`ec9cae65456c9e8b…` and `cache_valid = true`.

**Independent re-derivation.** The verdict was not taken on trust.
`scripts/verify-live-cas-execution.mjs` pulls the raw stored row out of the retained execution
and recomputes everything with the repo's own `projection.js` — **22/22 PASS**, including that
the repo module reproduces the tenant's `projection_version` exactly. The deployed Code node
and the repository implementation are therefore behaviourally identical, which is the property
that makes the offline gate meaningful as a guard on the live system.

That check also caught a trap worth recording: `Invoke-RestMethod` coerces ISO-8601 strings
into `DateTime` and drops milliseconds, so `consent_at` read back through PowerShell appears
as `…18:00:00Z` rather than `…18:00:00.000Z`. Hashing that would have produced a spurious
mismatch. Verification must read the execution as raw bytes.

**No authority write was structurally possible.** The executed graph is 1 manual trigger,
4 Code nodes and 7 Data Table nodes — zero Google Sheets, HTTP Request or Execute Workflow
nodes. `Bot_Sessions` could not have been touched. Identity throughout was the synthetic
`990000001`.

The identity is the synthetic QA chat id `990000001`. The previous gate seeded the owner's
real Telegram id; that row was left untouched. `Bot_Sessions` is never read or written — this
gate tests the derived-row contract, not the authority.

The race runner `UEnjDvZGjMqsNdAI` and the mirror helper `OwLC7SANtHo69SKo` still carry the
defective verifier and were **not** modified, and must not be cited as evidence. Ordering was
already proven live and is PASS; equality is established by the rebuilt gate. Rebuilding those
two is optional hygiene, not a gap — but if either is ever re-run, its verdict is unsound
until it adopts `projection.js`.

---

## 10. Live tenant observations made during Phase 10

Two facts recorded from a read-only tenant inspection. Neither was in either audit.

### 10.1 The QA Data Table carries a retired column

`FINMENTOR_B21B_SESSION_READMODEL_QA` (`dk2oK5tL1P2bKLhK`) has 21 columns: the 15 canonical
projection fields, the 5 control fields, and **`source_version`** — a leftover from the
`cycle_id | updated_at` versioning scheme that Decision 2 explicitly retired in favour of
`projection_version`.

It is harmless today because it is control metadata that is never projected to the client and
never hashed. It should be dropped when the QA table is next rebuilt, so that a future reader
cannot mistake it for a live version signal. The canonical derived schema is 20 columns.

The same inspection confirmed the table types `cache_valid` and `lead_intake_ok` as real
booleans, which is what makes the normalisation rule in §2 load-bearing rather than defensive.

### 10.2 `availableInMCP` is still true on every non-production workflow

The NEW-2 remediation set `availableInMCP = false` on the seven production workflows and on
the retained unsafe Command Center. It did not extend to the QA, benchmark and canary
workflows, and **19 of them are still exposed as callable MCP tools**.

All are inactive, but MCP exposure is a trigger surface independent of the active flag — which
was the whole basis of the NEW-2 finding. The ones that matter:

| ID | Workflow | Why it matters |
|---|---|---|
| `NlIHfmuBQ4mS70G6` | B.2.1-B Resume Test Harness | its own description says publishing it "would be an identity bypass"; injects synthetic identities with no Telegram validation |
| `1Yw9LF6EJNCAYkQx` | B.2.1-A Canary Launcher | sends owner Telegram messages using the Client Concierge Bot credential |
| `AWQ0Telk7T9ynBlR` | B.2.1-A Mini App Bootstrap | the bootstrap endpoint itself |
| `sioGhZwhbs6JKpCd` | B.2.1-A Bot ID Tamper Control | validator control endpoint |
| `hGQAfPWBK75xeWco` | B.2.1-A Canary Page | serves the canary page over HTTPS |
| `rHSRlwV6JkQzxWy1`, `iZPvZ7Fc6O3kim5U`, `D8TnxS6mqqM1RO9v`, `AYa6BeKRlgaDQa7d` | Sheets benchmarks | read `Bot_Sessions` directly |
| `OwLC7SANtHo69SKo`, `UEnjDvZGjMqsNdAI`, `03DcHoJ5XxJYUZQ4`, `zOSBbpIpvRyAIljp`, `NMC4aZWtxGz3J24L` | read-model QA set | write the QA Data Table |

**APPLIED 2026-08-25, owner-authorised.** `scripts/harden-mcp-exposure.ps1` was run over all
19 with `-Apply`. Each write was verified read-after-write: `availableInMCP` false, active
state unchanged, nodes and connections byte-identical. A tenant-wide re-read then confirmed:

```
total workflows:        35
still exposed via MCP:   0
active workflows:        8   (the expected production set, unchanged)
```

One temporary exception was attempted and refused: `execute_workflow` requires
`availableInMCP`, so running the rebuilt CAS gate would have needed exposure re-enabled on
`03DcHoJ5XxJYUZQ4`. The classifier declined that write. The gate was therefore run by the
owner from the n8n UI instead (§9.2), and `03DcHoJ5XxJYUZQ4` remains at
`availableInMCP: false` and inactive. Tenant exposure is still 0 of 35.

---

## 11. Stop conditions — unchanged

Nothing in Phase 10 relaxes the B.2.1-B boundary. Still prohibited without a separate,
explicitly approved gate:

- modifying the production Client Concierge writers;
- creating or backfilling a production Data Table;
- activating reconciliation or any polling schedule;
- merging PR #10;
- starting B.2.1-C.

No production workflow was read for mutation, modified, activated or deactivated during
Phase 10. No lead, Pipeline row or `Bot_Sessions` row was read, written or mutated. All
fixtures are synthetic: chat ids in the `9000000xx` range and `FIN-QA-xxxx` lead ids.
