# C2 — CRM product completion: audit, mapping, and what still needs a live hand

**Date:** 2026-09-03 · **Program:** Production Completion v1 · **Checkpoint:** C2

No new CRM application was built. The Google Sheets CRM, Lead Intake, Command Center (SECURE
CANDIDATE), Followup v2, SLA Watch and Daily Digest stay the owner workflow.

## C2.1 Pipeline vocabulary — compatibility mapping, no rewrite

Live `deal_stage` values (Lead Intake seeds + Command Center writes + owner free text) are kept.
`n8n/src/crm/stage-map.js` resolves any stored value to one of the eight business stages and
renders RU/RO labels (gate: `qa/crm-stage-map.test.mjs`).

| stored (today) | business stage | RU | RO |
|---|---|---|---|
| New, Incomplete, Nurture | NEW | Новое обращение | Solicitare nouă |
| Contact (owner text) | CONTACT | Контакт установлен | Contact stabilit |
| Qualified, Documents Requested, Documents Received, Analysis In Progress | QUALIFIED | Квалифицирован | Calificat |
| Discovery Scheduled, Discovery Done | MEETING | Встреча | Întâlnire |
| Proposal Sent | PROPOSAL | Коммерческое предложение | Ofertă comercială |
| Negotiation (owner text; already a Dashboard funnel row) | NEGOTIATION | Переговоры | Negociere |
| Won | WON | Сделка заключена | Contract semnat |
| Lost, Closed | LOST | Сделка не состоялась | Fără rezultat |

The Command Center already accepts `stage <ID> <text>`, so CONTACT and NEGOTIATION are reachable
today with `stage <ID> Contact` / `stage <ID> Negotiation`; the module treats those spellings
(and RU/RO keywords) as canonical.

## C2.2 X-Ray in the CRM — done in C1

Every analysed lead row carries `xray_analysis_id`, `xray_score`, `xray_maturity`,
`xray_primary_risk`, `xray_analysis_status` (AI_DRAFT / CLIENT_READY / ANALYSIS_FAILED) and
`xray_next_step`; `financial_zone` was already there. Top risks, data gaps and the 30-day plan live
in `XRay_Analysis` (by `lead_id`), referenced, not duplicated.

## C2.3 Owner actions — audit of the live Command Center

| action | how today | status |
|---|---|---|
| open lead | `/lead <ID>` | live |
| contact | `stage <ID> Contact` (+ `done` to clear SLA) | live via free text |
| set/change stage | `stage <ID> <text>`, buttons `stage|…|Discovery Scheduled` | live |
| set follow-up | `snooze <ID> <hours>` writes `next_follow_up_at` | live |
| mark meeting | `meeting <ID>` → Discovery Scheduled + meeting_date | live |
| mark proposal | `proposal <ID>` → Proposal Sent + proposal_sent_at | live |
| mark negotiation | `stage <ID> Negotiation` | live via free text |
| Won / Lost | `won <ID> <value>` / `lost <ID> <reason>` | live |
| add note | `note <ID> <text>` → owner_note | live |
| see next action | `/lead <ID>`, alerts, Digest | live |
| review X-Ray analysis | one-tap URL button on the analysis alert (C1) | live |

Nothing in this matrix needed a change to the alert-button logic.

## C2.4 Follow-up

`next_follow_up_at` (Pipeline I), `Followups.due_at`, overdue detection in SLA Watch (hourly),
Followup v2 (hourly) and the 08:30 Daily Digest (sections: summary, attention incl. overdue
follow-ups, top HOT/WARM, overdue list, AI status, sources). Meetings and proposals awaiting
decision are visible through `deal_stage` in the funnel; a dedicated Digest line is a post-GO
item because the Digest workflow cannot be edited from this session (see §Blockers).

## C2.5 Management view — audit of the Owner Dashboard tab

Present today: total leads, HOT/WARM/COLD/INCOMPLETE, RED/ORANGE, SLA breach, no next action, no
contact, Won, Lost, pipeline value, funnel by stage (13 rows incl. Negotiation), Concierge
counters. Missing on the sheet: action today, overdue follow-up count, conversion. The Daily
Digest computes "new today" and "overdue" every morning, so the owner has them daily; adding the
three rows as sheet formulas is a post-GO owner-UI item (no formula edits from automation).

## C2 acceptance

| requirement | evidence |
|---|---|
| `lead_id` unchanged across transitions | Command Center matches rows on `lead_id`, writes owned columns only (Stage 2 sparse write, proven in `docs/LEAD_ALERTS_OWNER_PRESENTATION.md`); X-Ray columns are keyed by the same `lead_id` |
| X-Ray analysis remains attached | `XRay_Analysis.lead_id` + Pipeline `xray_*` survive stage changes (different columns, matched update) |
| no duplicate CRM row | Dedup Guard tiers + `request_id` corroboration (live since 2026-08-25); C1 UAT leads created exactly one row each |
| follow-up works | `next_follow_up_at` seeded at intake (UAT lead: +4 h for HOT) and moved by `snooze`; Followup v2 and SLA Watch active |
| owner alert works | new-lead HOT alert and X-Ray analysis alert both delivered to the owner chat during C1 UAT |
| status transitions persist | `Status_Log` shows live owner transitions (New → Documents Requested, Qualified → Documents Requested) |

**Not executed from this session:** the scripted NEW → … → WON tap sequence and the LOST path.
They require Telegram messages from the owner's chat to the Leads bot (the Command Center is a
Telegram-trigger workflow, not callable through the MCP connector). One owner tap sequence on the
UAT lead `FIN-1788432350648-72` — `meeting`, `proposal`, `stage … Negotiation`, `won … 0` — and
`lost FIN-1788432493303-321 uat` closes this.

**C2 = PASS (audit + mapping)**, lifecycle tap sequence pending owner or API access.

## Blockers

Editing Daily Digest / Command Center / Followup needs `N8N_API_KEY` in the session or "Available
in MCP" enabled on those workflows. See the baseline record.
