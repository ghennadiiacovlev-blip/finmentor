# GATE 2 — C2 CRM Lifecycle Owner UAT: fresh-read contract, and the blocker

**Date:** 2026-09-04 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Plan:** `FINAL_PRODUCTION_V1_GO_PLAN.md`
**Verdict: GATE 2 = PASS** — the P1 was corrected, deployed, and the whole lifecycle proven by live
owner commands (section 8). **CUSTOMER RELEASE = NOT AUTHORIZED.**

Read from the live tenant and the shipped modules. `C2_CRM_WORKFLOW_COMPLETION.md` records
*"C2 = PASS (audit + mapping), lifecycle tap sequence pending owner"*; that PASS was re-derived
here rather than trusted, and it holds for everything it covered. The blocker is something the
earlier audit did not test, because it only ever mapped stages — it never tried to reach them.

---

## 1. The stage map, generated from the live modules

`SOURCE VALUE` is the stored `deal_stage`. `OWNER ACTION ALLOWED?` is what the alert keyboard
actually offers for a lead in that state. `AUTOMATED` is `canAutomatedTransition(source → Qualified)`.

| source value | normalized | terminal? | owner actions offered | automated transition |
|---|---|---|---|---|
| `new`, `incomplete` | NEW | no | done · snooze · discovery · docs · nurture | yes |
| `nurture` | NEW | no (CRM) / **yes (alerts)** | **none — no keyboard** | yes |
| `contact`, `contacted` | CONTACT | no | all five | yes |
| `qualified`, `documents received`, `analysis in progress` | QUALIFIED | no | all five | yes |
| `documents requested` | QUALIFIED | no | four (docs hidden — already applied) | yes |
| `discovery scheduled` | MEETING | no | four (discovery hidden — already applied) | yes |
| `discovery done`, `meeting` | MEETING | no | all five | yes |
| `proposal sent`, `proposal` | PROPOSAL | no | all five | yes |
| `negotiation` | NEGOTIATION | no | all five | yes |
| `won`, `  Won  ` | WON | **YES** | **none — no keyboard** | **NO** |
| `lost` | LOST | **YES** | **none — no keyboard** | **NO** |
| `closed` (legacy) | LOST | **YES** | **none — no keyboard** | **NO** |
| `(empty)`, free text | UNKNOWN | no | all five | **NO** |

**UNKNOWN is fail-safe** in both directions for automated transitions: an unknown source refuses,
and an unknown target refuses. Owner actions remain offered on an UNKNOWN row deliberately — a
historical value the machine cannot read is exactly the row a human should be able to rescue, and
the owner path is separately authorised.

**Nurture is a parking state, not a CRM terminal**, and the two modules say so consistently:
`stage-map.js` maps it to NEW and permits a later automated advance, while `actions.js` treats it as
terminal *for alerting* — no keyboard, and SLA/Follow-up skip it. That is the intended asymmetry:
the lead stops pestering the owner without being closed.

---

## 2. Phase 2 — the prior contract re-derived, not trusted

| requirement | result |
|---|---|
| stage resolver | **PASS** — normalises stored values, trimmed and case-insensitive |
| UNKNOWN handling | **PASS** — fail-safe in both directions |
| Won terminal | **PASS** — no automated reopen, no keyboard, owner action refused `TERMINAL` |
| Lost terminal | **PASS** — same three |
| Closed legacy mapping | **PASS** — maps to LOST and inherits every terminal protection |
| automated transition restrictions | **PASS** — advances non-terminal, never reopens terminal |
| owner transition restrictions | **PASS** — `UNKNOWN_ACTION`, `ALREADY_APPLIED`, `STATE_CHANGED` all refused; a valid one allowed |

Gates re-run green: crm-stage-map 29 · lead-alerts-actions 57 · command-center-auth 43 ·
edit-noop 17 · ack-expression 23 · lead-intake-trust 43 · committed-replay 19 ·
dedup-remediation 32 · request-identity 73 · system-alert 43 · error-alert 22 — **401**.

**Canonical: 80/80 gates, 2795 assertions, floors PASS.**

---

## 3. The blocker — P1: WON and LOST cannot be reached from any owner path

The lifecycle is protected at its terminal states and cannot **enter** them.

**No button emits them.** `SET` offers `discovery, docs, snooze, nurture` for NEW LEAD and
`done, snooze, discovery, docs, nurture` for PRIORITY and FOLLOW-UP. Won and Lost are deliberately
absent (owner decision D1), which is correct — closing a deal is not a one-tap action from an alert.

**No typed command executes them either, and this is the defect.** The live parser
`Parse Lead Command v2` *accepts* them: `won` and `lost` are in its `updateCmds`, it compares
`cmd === 'won'` and `cmd === 'lost'`, and it routes them to `mode: 'update'` carrying `deal_value`
and `close_reason`. The request then reaches `Find & Build Update`, where the inlined
`actionOfCommand` maps only five verbs:

    done → done · snooze → snooze · docs → docs · nurture → nurture
    stage + "discovery scheduled" → discovery
    everything else → ''

`won` and `lost` fall through to `''`, so `refuseReason` returns `UNKNOWN_ACTION` and the handler
performs **zero writes**. Verified on the live workflow rather than inferred:
`deal_value` appears 0 times in `Find & Build Update`, `close_reason` 0 times, and the only
occurrences of `'won'` and `'lost'` are inside `TERMINAL_STAGE`, which *detects* a terminal state
and never sets one. `buildUpdate('won', …)` returns `null`, and `OWNED` has no `won` or `lost` entry.

So an owner who types `won FIN-… 0` receives a refusal, and the row stays `Qualified`.

**Why this is P1 and not cosmetic.** The release definition requires that the owner can manage the
lead, and Gate 2 requires Won and Lost coverage with at least one explicit Lost path. As built, no
lead can ever be closed: every lead remains in the active pipeline forever, continues to qualify for
SLA and follow-up chasing, and the funnel can never show a conversion or a loss. It is a
lifecycle-correctness defect — category 5 of the freeze policy — not a feature request.

**What it is not.** No data is lost, nothing is mis-written, and no unauthorised transition is
possible. The failure is fail-closed: the system refuses rather than guessing. That is why it is P1
and not P0.

### The minimal correction, if authorised

Three small additions to `n8n/src/lead-alerts/actions.js`, then one Command Center redeploy through
the established mechanism. **No new button, no new status, no routing change** — `Won` and `Lost`
already exist in `STAGE_COMPAT` and `STAGE_TO_STORED`, and the parser already carries the arguments.

1. `actionOfCommand`: map `won → 'won'` and `lost → 'lost'`.
2. `OWNED`: `won: ['deal_stage', 'sla_status', …]`, `lost: ['deal_stage', 'sla_status', …]` — the
   exact column list is an owner decision, since `deal_value` and `close_reason` may or may not be
   columns the owner wants written.
3. `buildUpdate`: write `deal_stage = 'Won'` / `'Lost'` from `STAGE_TO_STORED`, plus `sla_status`
   so the closed lead also leaves the SLA queue.

Every existing protection then applies unchanged: `refuseReason` still refuses a second close
(`TERMINAL`), the keyboard still disappears, SLA and Follow-up still skip the row, and
`verifyMutation` still reads the write back.

---

## 4. Phase 4 — terminal protection, proven

Terminal states are correctly defended; the gap is only in reaching them.

- **Deterministic storage** — `Won`/`Lost` come from `STAGE_TO_STORED`, and `toBusinessStage` folds
  case and whitespace, so `  Won  ` is WON.
- **No automatic re-entry** — `canAutomatedTransition` refuses every terminal → non-terminal move,
  including legacy `Closed`.
- **SLA and Follow-up cannot revive a closed lead** — `SLA Select` carries
  `STOP_STAGES = ['won','lost','closed','nurture','incomplete','закрыт']` and additionally skips
  `sla_status` of `done` or `nurture`. A terminal lead is never selected for chasing.
- **Legacy aliases normalise** — `Closed → LOST`, inheriting every protection.
- **The presenter offers no invalid action** — a terminal lead gets no keyboard at all.
- **Owner action on a terminal lead is refused** — `refuseReason` returns `TERMINAL` before any
  write is built.
- **Stale execution cannot overwrite** — each action writes only the columns it owns, so a late tap
  cannot carry back another column's stale value; `verifyMutation` reads the row back and reports a
  mismatch as a failed action rather than a success.
- **No duplicate canonical lead** — the live Pipeline holds 13 rows with **zero duplicate
  `lead_id`**.

**Reopen semantics: fail-closed, and that is the contract.** There is no owner path and no automated
path out of WON or LOST. No reopening rule was invented.

---

## 5. Phase 5 — negative and safety checks

| check | result |
|---|---|
| NON-OWNER lifecycle mutation | **REFUSED** — `command-center-auth`, 43 checks |
| UNKNOWN stage | **FAIL-SAFE** — automated transitions refuse in both directions |
| INVALID transition | **REFUSED** — `TERMINAL` before any write |
| DUPLICATE CALLBACK | **IDEMPOTENT** — second identical action refused `ALREADY_APPLIED`, zero second write |
| REPEATED TELEGRAM TAP | **SAFE** — a repeated «Обработано» is refused; the row is already terminal for alerts |
| STALE UPDATE | **DOES NOT WIN** — sparse per-action column ownership; read-back verification |
| WON AUTO-REVIVAL | **NO** |
| LOST AUTO-REVIVAL | **NO** |
| CRM / sheet / alert consistency | **CONSISTENT** — 13 rows, no duplicate ids, both UAT leads intact |

Error Monitor (`RBiFLhVjizMkAzrK`, 5 nodes) and SYSTEM ALERT (`ID700kTo6EXffwry`, 8 nodes) are both
active and unchanged since the Gate 0 deploy. No new regression.

---

## 6. UAT leads, fresh-read and unmutated

Both designated C2 UAT leads exist and are suitable. **Nothing was mutated in this phase.**

| lead_id | company | stage | sla | priority | X-Ray |
|---|---|---|---|---|---|
| `FIN-1788432350648-72` | UAT ООО Синтетик Ритейл | Qualified | Active | HOT | CLIENT_READY |
| `FIN-1788432493303-321` | UAT SRL Sintetic Retail | Qualified | Active | HOT | CLIENT_READY |

Both are synthetic. No real customer lead was read into this record beyond the duplicate-count scan,
and no row was written.

---

## 7. Verdict

    GATE 2 — C2 CRM LIFECYCLE OWNER UAT = BLOCKED

    NEW                        = PASS
    DISCOVERY                  = PENDING OWNER ACTION (contract PASS)
    NURTURE                    = PENDING OWNER ACTION (contract PASS)
    WON                        = FAIL — no owner execution path exists
    LOST                       = FAIL — no owner execution path exists
    TERMINAL PROTECTION        = PASS
    REOPEN SEMANTICS           = N/A — fail-closed, proven
    UNKNOWN FAIL-SAFE          = PASS
    NON-OWNER BLOCK            = PASS
    DUPLICATE PROTECTION       = PASS
    STALE UPDATE PROTECTION    = PASS
    SLA / FOLLOWUP TERMINAL SAFETY = PASS

    OPEN P0 = 0
    OPEN P1 = 1
    TARGETED QA  = 401
    CANONICAL QA = 80/80 gates, 2795 assertions, floors PASS

The owner UAT sequence was deliberately not started. Two of its four required transitions cannot
complete, and the third (Nurture) parks a lead irreversibly for alerting purposes — spending a UAT
lead on it before the Won/Lost decision would waste the only two synthetic leads available.

---

## 8. GATE 2 OWNER UAT = PASS (2026-09-04, live owner commands)

The P1 was corrected (§3), deployed to the Command Center, and the lifecycle was then driven
end-to-end by real owner commands in the Leads bot. Every row below is a fresh read of the live
execution and the live Pipeline, not a replay of intent.

### 8.1 A false start worth recording

The first two attempts produced no Command Center execution at all. I initially attributed that to
my own redeploy having dropped the Telegram webhook registration, re-registered it, and was wrong.
The execution data settled it: both messages had been delivered to the **client Concierge bot**
(executions 5553 and 5558, text `stage FIN-1788432350648-72 Discovery Scheduled`), which listens on
`updates: ["*"]` for a different bot credential and treated them as customer messages. The Command
Center listens on the Leads bot and correctly received nothing. No CRM write occurred and no lead
was touched. Sent in the correct chat, the first command worked immediately.

Two things are worth keeping from that: a lifecycle command typed at the wrong bot fails **silently
and safely** — no write, no partial state, no error — and diagnosing from execution data rather than
from a plausible theory is what found it.

### 8.2 The four transitions

| # | exec | lead | before | command | after | sla_status | columns written |
|---|---|---|---|---|---|---|---|
| A | 5561 | `FIN-1788432350648-72` | Qualified | `stage … Discovery Scheduled` | **Discovery Scheduled** | Active (unchanged) | `deal_stage` only |
| C | 5563 | `FIN-1788432350648-72` | Discovery Scheduled | `won … 0` | **Won** | **Done** | `deal_stage`, `sla_status` |
| D | 5566 | `FIN-1788432493303-321` | Qualified | `lost … uat-close-no-fit` | **Lost** | **Done** | `deal_stage`, `sla_status`, `close_reason` |
| B | 5568 | `FIN-1787944699020-596` | Incomplete | `nurture …` | **Nurture** | **Nurture** | `deal_stage`, `sla_status` |

Every execution ran `Verify Mutation` and `IF Verified`, so each write was read back and confirmed
rather than assumed. Every one wrote **only** the columns its action owns; on all three rows
`next_follow_up_at`, `last_contacted_at`, `sla_snooze_until` and `documents_requested_at` are
exactly as they were, the legacy `status` column is untouched, and the other business columns (43
on each UAT row, 13 on the synthetic one) are intact.

### 8.3 The column policy, proven rather than asserted

Lead A was closed as **Won with `deal_value: "0"` explicitly supplied** — the parser captured it,
and the row shows `deal_value` empty and `close_reason` empty. Lead B was closed as **Lost with a
reason** and shows `close_reason: uat-close-no-fit` with `deal_value` empty.

So `deal_value` is never written, because there is no such Pipeline column; `close_reason` is
written only for Lost, only when the owner supplies one, and is never required. That is the owner
policy exactly, demonstrated on live data from both directions.

### 8.4 Terminal protection, on the live rows

Derived from the deployed Command Center module against each row as it actually stands:

| lead | state | onward actions | keyboard | SLA / follow-up |
|---|---|---|---|---|
| A | Won / Done | all seven refused `TERMINAL` | NONE | removed — by `deal_stage` **and** by `sla_status` |
| B | Lost / Done | all seven refused `TERMINAL` | NONE | removed — both reasons |
| C | Nurture / Nurture | all seven refused `TERMINAL` | NONE | removed — both reasons |

`Edit Alert (0)` — the no-keyboard branch — is the node that ran for all three closes, which is the
router agreeing with the module. Automated reopen of Won and of Lost is refused.

**One asymmetry, by design and stated plainly.** `Nurture` is terminal for the *alerting* lifecycle
— no keyboard, every owner action refused, out of both queues — but `isTerminalStage('Nurture')` is
`false` and an automated advance out of it is permitted, because the CRM vocabulary maps Nurture to
`NEW`: it is a parking state, not a closed deal. Won and Lost are the only true CRM terminals. This
was recorded in section 1 before the UAT ran, and the live behaviour matches it.

### 8.5 Integrity

13 Pipeline rows, **zero duplicate `lead_id`**, one row per lead throughout. No stale write: each
lead moved only through its own commands, and the untouched control lead stayed put at every step.
The two genuine customer rows were never read into a mutation and never written. No new failed
execution anywhere on the tenant; the most recent failures are from 2026-08-31 and earlier. Error
Monitor and SYSTEM ALERT both last ran successfully.

### 8.6 Verdict

    GATE 2 — C2 CRM LIFECYCLE OWNER UAT = PASS

    NEW = PASS            DISCOVERY = PASS       NURTURE = PASS
    WON = PASS            LOST = PASS
    TERMINAL PROTECTION = PASS
    REOPEN SEMANTICS = N/A — fail-closed, proven
    UNKNOWN FAIL-SAFE = PASS       NON-OWNER BLOCK = PASS
    DUPLICATE PROTECTION = PASS    STALE UPDATE PROTECTION = PASS
    SLA / FOLLOWUP TERMINAL SAFETY = PASS

    OPEN P0 = 0   OPEN P1 = 0
    TARGETED QA  = 436
    CANONICAL QA = 81/81 gates, 2820 assertions, floors PASS

**CUSTOMER RELEASE = NOT AUTHORIZED.**
