# FINMENTOR — n8n workflow retention plan

Date: 2026-08-25
Finding: INDP3-03 — inactive QA/benchmark workflows, archived revisions and temporary
definitions need a controlled retention decision
Status: **CLASSIFIED — nothing deleted**

Tenant: `ghennadi.app.n8n.cloud` — 35 workflows, 8 active, 7 archived.

**Nothing in this plan has been executed.** Every workflow below still exists. Deletion is a
separate, explicit owner decision, and several of these are the only surviving evidence for
claims made in PR #10 — destroying them while that PR is still open would remove the audit
trail before it has been reviewed.

---

## 1. ACTIVE — production (8)

| ID | Workflow | Note |
|---|---|---|
| `QmIyEW2ZEqKregmN` | Lead Intake PREMIUM FINAL | Revenue path |
| `mppzthlkSJFr6Kle` | Telegram Client Concierge AI GUARDED | |
| `ShcmmJeLSE8LYVBk` | Telegram Client Transport | |
| `LZ2mvKXbBikmeVTn` | SLA Lead Watch PREMIUM FINAL | |
| `zeLOCuf0K1bkaKl2` | Followup Sequence PREMIUM v2 | |
| `imeJIDeNyaWDyXzh` | Daily Lead Digest PREMIUM FINAL | Reactivated after locator proof |
| `qF9tonlHHIxc8MDd` | Lead Command Center SECURE CANDIDATE | Replaces the unsafe original |
| `RBiFLhVjizMkAzrK` | Error Monitor PREMIUM | New; errorWorkflow for all of the above |

**KEEP.** All are exported to `n8n/production/` with structural hashes.

---

## 2. KEEP — inactive but load-bearing (1)

| ID | Workflow | Reason |
|---|---|---|
| `Ukn1cprWiXzBHojl` | Lead Command Center PREMIUM FINAL (unsafe original) | **P0 rollback point.** Nodes and connections are byte-identical to the pre-containment snapshot. Do not delete, do not activate. |

Only `settings.availableInMCP` was changed on it, so it could not be reached as an MCP tool
while inactive. Its nodes and connections are untouched.

---

## 3. ARCHIVE — PR #10 / Phase B.2.1 evidence (13)

These are the executable evidence behind PR #10's claims. The independent audit found that
several of those claims are weaker than the PR states — the "race" is caller-injected rather
than an authoritative commit, and Conditional Publish omits four projection fields. **That
disagreement is unresolved, so the evidence must survive it.**

| ID | Workflow |
|---|---|
| `AWQ0Telk7T9ynBlR` | B.2.1-A Mini App Bootstrap |
| `1Yw9LF6EJNCAYkQx` | B.2.1-A Canary Launcher |
| `hGQAfPWBK75xeWco` | B.2.1-A Canary Page |
| `sioGhZwhbs6JKpCd` | B.2.1-A Bot ID Tamper Control |
| `kKVHHE5LNHuJUuNR` | [TEST] B.2.1-A Ed25519 Runtime Capability Probe |
| `aGTlNJ1vihi6rGqY` | [TEST] B.2.1-A Telegram Format + Verify-Only Probe |
| `03DcHoJ5XxJYUZQ4` | B.2.1-B CAS Gate |
| `NMC4aZWtxGz3J24L` | B.2.1-B Data Table Live Proof |
| `zOSBbpIpvRyAIljp` | B.2.1-B Data Table Proof |
| `UEnjDvZGjMqsNdAI` | B.2.1-B Race Runner |
| `NlIHfmuBQ4mS70G6` | B.2.1-B Resume Test Harness |
| `OwLC7SANtHo69SKo` | Session Read Model Sync QA |
| `XT1B6u8dHgOzItKN` | B.1 F7C Candidate Path |

**Disposition: ARCHIVE (n8n archive flag), do not delete.** Archiving removes them from the
working list while keeping them retrievable.

**Precondition for any deletion: PR #10 is closed or merged AND Phase 10 re-verification has
produced its own evidence.** Not before.

---

## 4. DELETE_CANDIDATE — benchmarks superseded by a decision (5)

Performance benchmarks whose conclusion is already recorded in
`docs/PHASE_B2_1B_PERFORMANCE_DECISION.md` and `PHASE_B2_1B_LOW_RATE_STAGE_TIMING.md`.
The decision outlives the measurement.

| ID | Workflow |
|---|---|
| `IzCDJFcCrprkwKOv` | B.1 Read Benchmark |
| `rHSRlwV6JkQzxWy1` | B.2.1-B Direct Sheets REST Benchmark |
| `D8TnxS6mqqM1RO9v` | B.2.1-B Lookup Benchmark |
| `AYa6BeKRlgaDQa7d` | B.2.1-B Payload Width Benchmark |
| `iZPvZ7Fc6O3kim5U` | B.2.1-B Sheets Read Benchmark |

**Still not deleted.** Phase 10 will re-run the latency question against a corrected
projection, and having the original harnesses to compare against is worth more than the
tenant tidiness. Revisit after Phase 10.

---

## 5. ARCHIVED — superseded Concierge revisions (7)

`1bpUACOrbOWFnIrU`, `CmCrvFJJzFVoDwk9`, `Hgzy6pVqAxIVuARQ`, `S6iTke2T3OpaRMGz`,
`UEOJm1um3Vi9Qp5g`, `XaALTuPO7KMrajsX`, `sr7RMpUHexvbW44y`

Already archived. **KEEP ARCHIVED.**

Note: these still contain the name-mode sheet locators and the stale spreadsheet reference
that were repaired in the active estate. That is expected and correct — they are historical
snapshots, not deployable. They must never be reactivated as-is; the locator repair would
have to be applied first. The export gate deliberately exempts only the P0 rollback copy
from the stale-reference check, and these are excluded from export entirely.

---

## 6. Not FINMENTOR (1)

| ID | Workflow | Disposition |
|---|---|---|
| `m5kaG1baUg6sQ7Xb` | Бот Ракурс (шаблон для импорта) | Unrelated import template. Owner decision; outside this remediation's scope. |

---

## 7. Summary

| Disposition | Count |
|---|---|
| ACTIVE (production) | 8 |
| KEEP (rollback point) | 1 |
| ARCHIVE (PR #10 evidence) | 13 |
| DELETE_CANDIDATE (superseded benchmarks) | 5 |
| ARCHIVED (Concierge revisions) | 7 |
| Out of scope | 1 |
| **Total** | **35** |

Active test/canary exposure is **0**: no QA workflow is active, and no QA webhook is
reachable. The two temporary QA clones created during this phase (digest locator proof,
error monitor proof) were deleted in `finally` blocks and verified gone.
