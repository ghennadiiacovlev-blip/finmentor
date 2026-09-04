# FINMENTOR Production v1 — feature freeze and final GO plan

**Authority:** owner decision, 2026-09-04T11:50Z · **Branch:** `feat/miniapp-b21c-live-prereqs` · **HEAD:** `7a0d484`
**Status:** FEATURE FREEZE IN FORCE · **CUSTOMER RELEASE = NOT AUTHORIZED**

This is the single authoritative plan for finishing Production v1. It replaces intuition about
"how close we are" with a gate count, and it replaces open-ended polish with a closed list. Every
status below was fresh-read from the repository and the live tenant while writing it, not carried
forward from an earlier record.

---

## 0. Scoreboard

    CURRENT PRODUCTION V1 COMPLETION = 14%   (1 of the 7 gates that precede release)

    GATE 0  Telegram Premium Button Colors ....... PASS
    GATE 1  Privacy / Legal ...................... BLOCKED (1 P1 + 4 owner decisions)
    GATE 2  C2 CRM Lifecycle Owner UAT ........... OPEN
    GATE 3  RO Content ........................... OPEN
    GATE 4  GA4 UAT .............................. OPEN
    GATE 5  Final Integrated E2E (RU + RO) ....... OPEN
    GATE 6  Independent Codex Release Audit ...... OPEN
    GATE 7  CUSTOMER RELEASE ..................... BLOCKED

    OPEN P0 = 0
    OPEN P1 = 1
    POST_GO ITEMS = 11

**NEXT SINGLE CHECKPOINT = GATE 1 — Privacy / Legal.**

Read the percentage for what it is: a count of *release gates*, which is what was asked for. It
deliberately does not measure engineering completeness, and it should not be read as "14% of the
product exists". The build is far along — the customer path, the Gateway, the endpoints, the X-Ray
authority, the owner console and 79 offline gates are live and proven. What the number says is that
six of the seven **acceptance** gates have not yet been signed, and most of them cannot be signed by
this session at all: they need the owner's Telegram, the owner's browser, or a legal decision. That
is the honest shape of the remaining work.

---

## 1. Change policy under freeze

**Allowed** before CUSTOMER release, and nothing else:

1. P0 / P1 functional defect
2. security defect
3. privacy / legal blocker
4. data loss or duplicate risk
5. incorrect lifecycle / release-state behaviour
6. broken RU / RO customer path
7. broken analytics required for launch
8. regression caused by an already-approved checkpoint

**Not allowed:** visual redesign · new features · new CRM capabilities · new questionnaires ·
additional automations · architecture improvement without a proven release blocker · copy polish not
required for correctness or privacy · analytics events beyond the approved launch contract ·
refactoring for elegance.

Anything that is merely better goes to §5 POST_GO_HARDENING and is **not implemented now**. If a
proposed change cannot be named as one of the eight allowed categories, the answer is no.

---

## 2. Release definition

Production v1 is READY when all of the following hold:

- the customer path works in RU and RO;
- a lead reaches the owner exactly once under the approved contract;
- the owner can review and manage the lead;
- CLIENT_READY is explicit and deterministic;
- the customer receives only the curated result;
- no PII leakage;
- no known P0 / P1;
- the privacy / legal release gate is approved;
- GA4 launch events are proven;
- the final integrated UAT passes;
- the independent Codex audit has no open P0 / P1;
- the CUSTOMER release command is the only remaining mutation.

No further release gates may be added without first proving the addition is itself P0 or P1.

---

## 3. The gates

### GATE 0 — Telegram Premium Button Colors · **PASS, FROZEN**

Owner approved the semantic hierarchy on the iPhone client. Exact hues are client- and
theme-controlled and are explicitly not chased. Deployed as commit `7a0d484`: eleven `style` keys
across five live workflows, and nothing else anywhere.

Proven live against the pre-deploy captures: everything except `style` keys byte-identical; every
label, callback_data, url, row and position unchanged; all five workflows still active; triggers,
credentials, chat routing, every Code node and every Sheets operation untouched.

| surface | live styles |
|---|---|
| NEW LEAD (Lead Intake) | Discovery = primary |
| SLA KB221, FOLLOW-UP KB221, Edit KB221 | Обработано = success, Discovery = primary |
| SLA KB22, FOLLOW-UP KB22 | Обработано = success |
| X-RAY REVIEW | Проверить = success, Карточка = primary |
| X-RAY APPROVED | no keyboard (unchanged) |

Three slots stay deliberately neutral because the action landing in them varies by lead state. That
verdict is enumerated over 207 reachable states by `n8n/src/lead-alerts/style-slots.js` and frozen by
`qa/telegram-button-style-slots.test.mjs` (33 checks). Full record:
`docs/TELEGRAM_BUTTON_STYLES_2026-09-04.md` §7–§8.

**Frozen.** No further button, colour, label or layout change before GO.

### GATE 1 — Privacy / Legal · **BLOCKED** — audited 2026-09-04, see `docs/GATE1_PRIVACY_LEGAL_2026-09-04.md`

Audited 2026-09-04 against the shipped files and the live tenant. Full record and the thirteen-row
surface inventory: `docs/GATE1_PRIVACY_LEGAL_2026-09-04.md`.

**OPEN P0 = 0 · OPEN P1 = 1 · OWNER DECISIONS = 4 · LEGAL REVIEW = 1.**

Proven PASS: contact consent gating on the public questionnaire in both languages (required,
non-prefilled, blocks submit, payload built only after the guard); privacy and terms links present
twice before anything is sent; no PII in GA4 (closed eight-key allow-list, unlisted keys dropped,
e-mail/phone redaction); CLIENT_READY minimisation; owner/client data boundaries.

**The P1:** in the Mini App — the surface that collects role, company, scale, task, contact channel
and Telegram id — no privacy information is reachable. The submit screen renders its links as
`a.href = '#'`, and the entry affordance is not a link at all. A person is asked to acknowledge
information they cannot open. Not fixed here because the fix requires choosing what those links
open (public policy pages, or the in-app layer-2 notice, which cannot render until the controller
identity exists) — an owner decision about which document a customer is sent to.

**Corrected in this gate:** the notice claimed an automatic 72-hour deletion that no code performs.
The TTL expires a session, it does not delete the row, and no deletion job exists anywhere. The text
now states the expiry that is real and keeps deletion as a right; two checks prevent the false claim
returning.

**The four owner decisions:** controller full name · controller privacy e-mail · the Supabase (EU)
processor and human-review paragraph (final RU and RO text in the record) · the Mini App link target.
**Legal review:** whether `pre_contractual_request` is the correct basis, or consent is required.

No customer is exposed today: Session and Submit are both `OWNER_ONLY`.

### GATE 2 — C2 CRM Lifecycle Owner UAT · **OPEN**

Evidence: `docs/C2_CRM_WORKFLOW_COMPLETION.md` — **"C2 = PASS (audit + mapping), lifecycle tap
sequence pending owner or API access."** The stage vocabulary, the compatibility mapping and the
Command Center authorisation are proven offline; what is missing is real owner taps.

Required: NEW · Discovery / active progression · Nurture · Won · Lost · reopen and terminal-state
protection · owner-only semantics confirmed to still hold. Real owner evidence is required wherever
the contract requires an owner tap — those are Telegram messages from the owner's chat to the Leads
bot and cannot be synthesised by this session.

### GATE 3 — RO Content · **OPEN**

Evidence: `docs/C3_OWNER_RUNBOOK.md` lists *"RO questionnaire copy for the Mini App and the
Concierge"* as owner-approval work: the content gate binds every client-visible string to an
approved spec, so RO copy needs the same approval RU already has.

Required: questionnaire, Concierge, Mini App customer result; no RU/RO mixing; no retired
terminology; functionally identical contract to RU. The rule already proven in the owner console —
Romanian free text never leaks into the Russian console, and translation is deterministic with no AI
call — must hold in the customer direction too.

### GATE 4 — GA4 UAT · **OPEN**

Evidence: `analytics.js` is live and carries the event surface (`generate_lead`, `financial_xray`,
`contact_click`, consent handling, first/last attribution). The runbook records GA4 C4 UAT as needing
the public site and the owner's browser.

Required: approved events only, conversion points, no PII, no secrets, deterministic event naming,
verified in real browser behaviour. New events beyond the approved launch contract are **not**
allowed under freeze.

### GATE 5 — Final Integrated E2E · **OPEN**

RU and RO, each end to end: customer entry → Concierge / Financial X-Ray → settled lead → FINMENTOR
Lead Alert → owner review → CLIENT_READY → customer result → CRM lifecycle. Plus the required
negative cases: replay, duplicate, and store-outage behaviour.

Much of this is already proven in isolation — Gateway cycle rotation, Session/Submit persistence and
outages, X-Ray v2 review authority, the curated CLIENT_READY contract, dedup and idempotency
harnesses. This gate is the first time they are proven **as one path**, twice.

### GATE 6 — Independent Codex Release Audit · **OPEN**

Mandate limited to: P0/P1 · security · privacy · data loss · duplication · authorization · lifecycle
correctness · release-state correctness · deployment drift. Codex **must not** redesign the product
or invent requirements.

Every finding is classified: **P0** blocks release · **P1** blocks release · **P2** →
POST_GO_HARDENING · **P3** → POST_GO_BACKLOG. Only P0/P1 may reopen development before GO.

### GATE 7 — CUSTOMER RELEASE · **BLOCKED**

Fresh-read live state confirms the system is correctly still owner-only:

- Session `Hxje3Kel6nLLod5B` — `RELEASE_MODE = "OWNER_ONLY"`
- Submit `ELiPdw4mdxQbBaan` — `RELEASE_MODE = "OWNER_ONLY"`
- Mini App host `KBD7Q94QQnlzgYKJ` — named `[UAT] … (owner-only)`

The single remaining mutation, only after Gates 1–6 PASS:

```
! node scripts/deploy-c3-endpoints.mjs --confirm --release=CUSTOMER
```

---

## 4. Live production state at the time of writing

15 active workflows of 111 on the tenant. The release-relevant set:

| id | workflow | role |
|---|---|---|
| `QmIyEW2ZEqKregmN` | Lead Intake PREMIUM FINAL | settlement, NEW LEAD alert |
| `LZ2mvKXbBikmeVTn` | SLA Lead Watch | priority alerts |
| `zeLOCuf0K1bkaKl2` | Followup Sequence v2 | follow-up alerts |
| `qF9tonlHHIxc8MDd` | Lead Command Center | owner taps, edits |
| `tNSMRoKlFB52vjge` | X-Ray Analysis | review authority, CLIENT_READY publisher |
| `nTZHLbv2KFggdhh5` | Mini App Gateway | cycle authority |
| `Hxje3Kel6nLLod5B` / `ELiPdw4mdxQbBaan` | Session / Submit | OWNER_ONLY |
| `KBD7Q94QQnlzgYKJ` | Mini App host | owner-only UAT |
| `mppzthlkSJFr6Kle` | Telegram Client Concierge | customer conversation |
| `ID700kTo6EXffwry` / `RBiFLhVjizMkAzrK` | SYSTEM ALERT / Error Monitor | operational safety |

Offline quality: **79/79 gates, 2738 assertions, floors PASS.**

---

## 5. POST_GO_HARDENING — recorded, not implemented

Kept out of the v1 GO path unless independently proven P0/P1:

1. durable NEW LEAD Outbox relay / Cloud Run
2. Graph / Microsoft 365 email delivery
3. deeper retention automation
4. HMAC fingerprint v2
5. additional BI / analytics
6. UI polish
7. additional automations
8. broader architecture refactoring

Discovered during the work and deferred here under the same rule:

9. **Button emphasis is absent on the re-rendered alert** for Command Center shapes KB22 and KB21.
   Cause: those edit nodes serve both alert kinds, so one slot can hold either the primary or the
   success verb, and a literal there would emphasise the wrong action. Emphasis is present on the
   alert the owner acts *from*. Cosmetic, safe by construction; closing it needs node-splitting,
   which is architecture work.
10. **No `.gitattributes`.** With `core.autocrlf=true`, a branch switch rewrites tracked files to
    CRLF while the generators emit LF. This has broken byte-comparison gates twice and produces a
    600-file phantom diff. A one-line `* text=auto eol=lf` ends it. Tooling only, no runtime effect.
11. **`scripts/deploy-lead-alert-keyboards.mjs` is not idempotent** — it re-adds Stage-1 nodes that
    are already live (verified: SLA 13→16, Follow-up 18→21). Documented and superseded by targeted
    scripts; the hazard is that someone re-runs it. Guard rather than rewrite, after GO.

**POST_GO ITEMS = 11.**

---

## 6. Open defects

**OPEN P0 = 0 · OPEN P1 = 0.**

No P0 or P1 defect is currently known or open. The most recent blocker — Financial X-Ray required
identity fields not being editable — was closed in production via PR #20 and is not to be revisited.
Gates 1–6 are *acceptance* gates, not defect reports: they are open because they have not been
performed, not because something is known to be broken.

This count is only as good as the gates that have run. Gates 2–6 exist precisely to convert
"nothing known" into "nothing found by looking".

---

## 7. Sequencing rule

One gate per checkpoint. Do not begin a gate before the previous one is recorded PASS, and do not
start the following gate automatically. Each gate closes with its evidence written into this file or
a dedicated record, and with canonical QA re-run.

**NEXT SINGLE CHECKPOINT = GATE 1 — Privacy / Legal.**

CUSTOMER RELEASE remains NOT AUTHORIZED.
