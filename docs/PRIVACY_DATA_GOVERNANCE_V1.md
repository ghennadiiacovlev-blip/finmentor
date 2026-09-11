# FINMENTOR Privacy & Data Governance v1

**Control version:** `pn-2026-09-11.v1`

**Effective/review date:** 2026-09-11

**Privacy owner:** Iacovlev Ghennadi

**Control status:** VERIFIED for the v1 technical baseline; items explicitly marked `TO VERIFY` require documentary or operational evidence.

**Allowed statuses:** `VERIFIED`, `TO VERIFY`, `NOT APPLICABLE`.

This is the single FINMENTOR v1 governance artifact. It is an operating record, not a new GDPR platform, CRM or public-site architecture. It does not rewrite historical acknowledgements and does not authorise production deletion, schema mutation, backfill or deployment.

## 1. Controller and privacy contact

| Item | Record | Status |
|---|---|---|
| Controller | Iacovlev Ghennadi, natural person, Republic of Moldova | VERIFIED — owner decision 2026-09-11 |
| Privacy contact | `cfo@finmentor.md` | VERIFIED — owner decision 2026-09-11 |
| Privacy owner | Iacovlev Ghennadi | VERIFIED — owner decision 2026-09-11 |
| Formal DPO | Not required for current FINMENTOR v1 scale; FINMENTOR does not claim to have a DPO | VERIFIED — owner decision; annual/re-scaling legal review trigger |
| Canonical notice | `pn-2026-09-11.v1`, RU and RO, effective 2026-09-11 | VERIFIED — `n8n/src/premium-ux/privacy-notice.js` |

Legal source control:

- **VERIFIED CURRENT LAW:** Law of the Republic of Moldova No. 195/2024 on personal-data protection, consolidated/current official text effective at 2026-09-11 and in force from 2026-08-23: [official consolidated text](https://www.legis.md/cautare/downloadpdf/144681). Law No. 133/2011 is not used here as the governing law.
- **OFFICIAL GUIDANCE:** current explanations and data-subject/controller materials published by [CNPDCP](https://datepersonale.md/).
- **VERIFIED IMPLEMENTING/AMENDING ACT:** CNPDCP Order No. 31/2026 concerning standard contractual clauses: [Monitorul Oficial record](https://monitorul.gov.md/ro/monitor/3315). It is not treated as automatically applicable to every vendor.
- **VERIFIED IMPLEMENTING/AMENDING ACT:** CNPDCP Order No. 39/2026 amending the list of processing operations subject to DPIA review: [Monitorul Oficial record](https://monitorul.gov.md/ro/monitor/3319).
- **LEGAL INTERPRETATION / LEGAL REVIEW REQUIRED:** application of a particular transfer safeguard, mandatory-DPO threshold or mandatory-DPIA threshold depends on actual scale, destination, contractual evidence and processing changes. The v1 conclusions below are the approved operating position, with annual and change-triggered review; they are not a substitute for external legal advice.

## 2. ROPA / data map

`Last meaningful interaction` means the last substantive two-way exchange or owner action that progresses the customer request; an automated delivery log or passive page view does not reset it.

| SYSTEM | DATA | SOURCE | PURPOSE | STORE | PROCESSOR / RECIPIENT | ACCESS | RETENTION | LEGAL BASIS | DELETE METHOD | LOG / BACKUP | RISK | EVIDENCE | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Public website | Page path and consent choice; consented allow-listed campaign/analytics fields | Visitor/browser | Deliver pages; optional aggregate analytics | Browser storage; GA4 after consent | GitHub Pages; Google only after consent | Public pages; owner analytics account | Consent choice until changed; attribution only while consent remains | Site delivery/security: legitimate interest; GA4: consent | Browser revoke/clear; GA deletion tools where applicable | Hosting/GA logs and backups follow provider cycle | URL could contain PII; mitigated by allow-list and scrubbing | `analytics.js`; RU/RO policy | VERIFIED |
| Website forms / Lead Intake | Name, contact, company, business context, answers, consent marker, request/correlation keys | Customer | Answer and progress a pre-contractual request | n8n transit; Google Sheets CRM (`Pipeline`, `Leads`, activity/status stores); receipt table | n8n, Google; Telegram owner alert; OpenAI receives safe projection only | Owner and workflow service accounts | Non-converted: 12 months from last meaningful interaction; active client: contract + applicable duties | `pre_contractual_request`; security keys: `legitimate_interest_security` | Locate by contact/lead/request/submission keys; delete operational rows and linked activity/receipt data unless exception applies | n8n payload retention disabled by C4.11 candidate settings; provider backups age out by provider cycle | Free text may contain excess PII; owner alerts could overexpose contacts | Lead Intake workflow; safe projection QA; `analytics.js` | VERIFIED / cleanup operation TO VERIFY until first review evidence |
| Telegram Concierge | Telegram user/chat ID, username/profile hints, message text, locale, conversation/session/cycle state | Telegram/customer | Receive request, guide Mini App journey, communicate response | n8n data tables (`Bot_Sessions`, session/cycle/receipt records); Telegram message history | Telegram, n8n | Owner; scoped credentials/workflows | Active request rule; non-converted 12 months; session/draft expiry rules below | `pre_contractual_request`; replay/security: `legitimate_interest_security` | Delete linked session/cycle/receipt rows and Telegram-side messages where controllable; document platform limitation | n8n execution payload retention disabled by candidate setting; Telegram/provider backup cycle TO VERIFY | Chat history and IDs are directly identifying | Concierge/Transport source and production workflow snapshots | VERIFIED / provider deletion scope TO VERIFY |
| Mini App Gateway / replay | Telegram init-data-derived identity, replay key, timestamps, `expires_at` | Telegram-signed init data | Authenticate entry and prevent replay | `telegram_initdata_replays`; session bootstrap output | n8n | Gateway credential/workflow; owner administration | Expired replay records deleted weekly by `expires_at` | `legitimate_interest_security` | Weekly owner-run filtered deletion after verifying expiry | n8n logs disabled on gateway; data-table backup cycle TO VERIFY | Replay table becomes an identifier ledger if not cleaned | Gateway source/candidate and G5 QA (unchanged by C4.11) | VERIFIED design; first cleanup evidence TO VERIFY |
| Mini App draft/session | Telegram ID binding, locale, contact name, draft JSON, state, expiry, resulting lead ID after submit | Customer/Mini App; server session | Resume and submit a customer-authored brief | n8n `MiniApp_App_Sessions` | n8n | Server workflows and owner administration | Logical access expiry: 72 hours. Weekly physical cleanup after operational expiry and no legitimate active purpose | `pre_contractual_request`; session integrity: `legitimate_interest_security` | Weekly due-list, verify no active purpose/commit dependency, delete session row and record minimal evidence | Session/Submit candidates already disable execution payload retention; data-table backup cycle TO VERIFY | Draft contains free text and contact/business PII | `draft-contract.js`; Session/Submit builders | VERIFIED design; cleanup operation TO VERIFY |
| Privacy acknowledgement | Submission/cycle key, notice version/locale, shown and acknowledged times, legal-basis enum | Mini App submit; server-derived submission key | Prove which information was acknowledged | Supabase Postgres `privacy.privacy_acknowledgements` | Supabase | Insert-only workflow role; owner/admin read capability | 3 years from closure or last related interaction, annual review and overriding law subject to review | New v1: `pre_contractual_request` | Owner-run deletion by verified submission/cycle link after period or valid rights outcome; preserve minimal case evidence only | Supabase backup cycle/restore deletion behaviour TO VERIFY | Pseudonymous, linkable compliance record; not anonymous | `privacy-record.js`; `build-premium-endpoints.mjs`; live baseline had four historical rows | VERIFIED new path; backup deletion TO VERIFY |
| Historical acknowledgements | Four existing rows with historical version/basis values | Prior production submits | Preserve immutable historical evidence | Same privacy table | Supabase | Same as above | Existing records retain their original content; apply current retention review prospectively without rewrite/backfill | Historical value preserved exactly | No C4.11 update/backfill; deletion only under separately authorised retention/rights procedure | Provider cycle TO VERIFY | Rewrite would destroy evidentiary integrity | C4.10 live audit evidence | VERIFIED — no mutation authorised |
| Financial X-Ray | CRM projection, questionnaire facts, deterministic score/zone, pseudonymised AI input, model draft, review state, curated result | Customer answers + CRM + AI output + owner review | Preliminary management analysis and optional customer publication after human review | Google Sheets (`Pipeline`, `Leads`, `XRay_Analysis`, `Activities`, `Status_Log`); n8n `XRay_Client_Results` | n8n, Google, OpenAI; Telegram owner alert | Owner/reviewer; customer only through existing client-visibility authority | Lead/client rule; client result follows related request/client record | `pre_contractual_request`; later active-client contract where applicable | Delete linked CRM/analysis/activity/client-result rows after authority/exception check; revoke published result via existing authorised process | X-Ray execution retention disabled by candidate setting; Sheets/Supabase backups TO VERIFY | AI inference, free text, model/provider transfer, publication authority | X-Ray builder; `build-input.js`; `validate-analysis.js`; unchanged visibility QA | VERIFIED architecture; provider terms/locations TO VERIFY |
| AI processing — Lead Intake / X-Ray | Data-minimised pseudonymised business facts; direct identifiers and analytics IDs removed | Safe projection built by FINMENTOR | Internal triage and preliminary management analysis | Provider processing plus FINMENTOR result stores; provider retention depends on account controls | OpenAI | API credential/workflow; owner reviews result | FINMENTOR records follow lead/client rule; provider API retention/account control evidence TO VERIFY | Same request/contract basis as the requested analysis; not marketing consent | Delete FINMENTOR outputs; use provider deletion/control tools if retained data exists and document outcome | OpenAI states API data is not used for training by default; default abuse-monitoring logs may be retained up to 30 days unless approved controls apply; actual account setting TO VERIFY | Linkable/pseudonymous input is still personal data; prompt/output fabrication and transfer risk | Safe projection tests; [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) | VERIFIED minimisation; account retention/region TO VERIFY |
| Owner Alerts / SLA / Digest / Follow-up / Command Center | One preferred contact where available, company, status, urgency, operational summary; scrubbed error context | CRM/workflow state | Prompt timely human response and operational control | Telegram message; Google Sheets follow-up/activity records where applicable | Telegram, Google, n8n | Owner | Underlying lead/client rule; message history/provider cycle TO VERIFY | `pre_contractual_request` for response; operational control/security as applicable | Delete linked CRM records; remove Telegram messages where controllable | n8n execution payload retention disabled for eight PII workflows; Error Monitor uses scrubbed system alerts | Notification preview exposure; multiple contacts; raw error leakage | Lead Intelligence alert; standard Lead Alerts presenter; system-alert/error-monitor QA | VERIFIED after C4.11 contact/settings candidate; platform deletion TO VERIFY |
| DSAR / deletion / incident evidence | Requester verification result, scope, dates, decision, actions, stores checked; no deleted request content | Data subject/owner/incident | Demonstrate handling and accountability | Minimal owner-controlled case record; exact repository/store TO VERIFY before first case | Email provider; relevant processors for fulfilment | Privacy owner only | 3 years after case closure | Legal obligation/accountability; consent is not required | Delete case evidence at term; keep only minimal proof, never duplicate deleted request content | Backup cycle for selected case store TO VERIFY | Overcollection in evidence file | Procedures in this document | VERIFIED procedure; case store implementation TO VERIFY |

## 3. Purpose-by-purpose legal basis register

| Purpose | Scope | Basis | Law/control | Status |
|---|---|---|---|---|
| Customer-initiated Intake, Mini App and Financial X-Ray before contract | Data necessary to understand, analyse and answer the request | `pre_contractual_request` | Law No. 195/2024 art. 6(1)(b), approved v1 interpretation | VERIFIED |
| Communication directly required to answer/progress the same request | Preferred contact and necessary message history | `pre_contractual_request` | Same as above; stop when no longer required | VERIFIED |
| Active/converted client delivery | Data needed for the active service | Contract; applicable legal obligations | Determine per contract/record class | VERIFIED model; per-client statutory period TO VERIFY |
| Replay prevention, minimal fraud/security controls | Pseudonymous keys, timestamps, failure class | `legitimate_interest_security` | Necessity/balancing must remain documented and data-minimised | VERIFIED v1 operating basis; annual review |
| GA4 analytics and persistent first/last-touch attribution | Allow-listed page/campaign and GA identifiers | Consent only | No load, queue or persistence before consent | VERIFIED |
| Marketing | None in v1 | NOT APPLICABLE | No checkbox; privacy acknowledgement is not marketing consent | NOT APPLICABLE |

## 4. Retention matrix

| Record class | Operational rule | Review cadence | Action at due date | Status |
|---|---|---|---|---|
| Unfinished Mini App draft/session | Logical access expires after 72 hours | Weekly owner-run cleanup | Delete records past operational expiry with no legitimate active purpose | VERIFIED policy; first cleanup evidence TO VERIFY |
| Telegram replay record | Until `expires_at` | Weekly | Delete expired rows by verified `expires_at` filter | VERIFIED policy; first cleanup evidence TO VERIFY |
| Non-converted lead and linked operational PII | 12 months from last meaningful interaction | Monthly due-list | Delete across applicable stores unless another documented ground applies | VERIFIED policy; first review evidence TO VERIFY |
| Active/converted client | Active contract plus applicable accounting/statutory duties | At contract closure and annually | Assign record-specific period; no universal deletion date | VERIFIED policy; specific legal periods TO VERIFY |
| n8n execution payload — eight PII workflows | Do not save success, error, manual or progress execution payloads | At deployment/readback and quarterly | Keep scrubbed SYSTEM ALERT/Error Monitor route; settings-only update | VERIFIED candidate; production deployment NOT AUTHORISED |
| Privacy acknowledgement | 3 years from closure/last related interaction | Annual due-list | Delete evidence row unless overriding documented requirement applies | VERIFIED internal evidentiary policy; not asserted as statutory three-year mandate |
| DSAR/deletion/incident case evidence | 3 years after case closure | Annual due-list | Delete minimal case evidence; never retain deleted request content merely as proof | VERIFIED policy |
| Provider logs/backups | Provider-specific cycle | Annual processor review and each rights/deletion case | Record limitation and prevent operational restoration of deleted data where applicable | TO VERIFY |

Retention calculations pause only when a documented legal hold, active dispute, contractual need or legal obligation applies. The owner records the reason, scope and next review date; silence is not a hold.

## 5. Processor / recipient register

No row below proves that FINMENTOR has accepted a DPA or a transfer safeguard unless the evidence cell expressly says so. Publicly available terms are not evidence of account-level acceptance.

| PROVIDER | ROLE | PURPOSE | DATA | REGION / PROCESSING LOCATION | TRANSFER STATUS | DPA / TERMS EVIDENCE | SAFEGUARD / SCC / ADEQUACY STATUS | OWNER | LAST REVIEW | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|
| GitHub / GitHub Pages | Public repository and static hosting | Host public FINMENTOR pages/assets | Public content; visitor/request logs controlled by provider | Actual log processing location TO VERIFY | Outside Moldova; destination evidence TO VERIFY | [GitHub terms/privacy](https://docs.github.com/en/site-policy) publicly available; account acceptance/config evidence TO VERIFY | No SCC/adequacy claim recorded | Iacovlev Ghennadi | 2026-09-11 | TO VERIFY |
| Google (Sheets, Analytics, Fonts) | CRM/workspace processor; consented analytics; font delivery | Lead operations, consented measurement, page rendering | CRM PII in Sheets; consented analytics; request metadata for fonts | Workspace/data location and each service flow TO VERIFY | Mixed/effective destinations TO VERIFY | Public Google terms/DPA available; FINMENTOR account-level evidence TO VERIFY | No SCC/adequacy claim recorded | Iacovlev Ghennadi | 2026-09-11 | TO VERIFY |
| n8n Cloud | Workflow automation and data-table host | Intake, sessions, transport, alerts, X-Ray orchestration | Request/session/contact/business data; credentials held by platform | Tenant region TO VERIFY | Destination TO VERIFY | Public terms/DPA available; executed/account evidence TO VERIFY | No SCC/adequacy claim recorded | Iacovlev Ghennadi | 2026-09-11 | TO VERIFY |
| Supabase | Hosted Postgres / privacy evidence infrastructure | Privacy acknowledgements and supporting data services | Pseudonymous acknowledgement rows; configured project data | `eu-central-1` (EEA) observed in C4.10 | EEA: no special authorisation under Moldova international-transfer chapter | [Supabase DPA](https://supabase.com/legal/dpa) publicly available; account acceptance evidence TO VERIFY | EEA route; no SCC asserted for this route; subprocessor onward transfers TO VERIFY | Iacovlev Ghennadi | 2026-09-11 | VERIFIED location / TO VERIFY contract evidence |
| Telegram | Messaging platform | Customer conversation, Mini App identity and owner alerts | Telegram IDs, message content, contact/operational alert | Actual processing locations TO VERIFY | Outside Moldova; effective destinations TO VERIFY | Public Telegram terms/privacy available; controller/processor allocation and account evidence TO VERIFY | No SCC/adequacy claim recorded | Iacovlev Ghennadi | 2026-09-11 | TO VERIFY |
| OpenAI API | AI service provider | Lead Intake triage and X-Ray preliminary analysis | Data-minimised pseudonymised business facts; no direct identifiers in safe projections | Project processing/residency setting TO VERIFY | Effective destination TO VERIFY | [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) verified; DPA/account evidence TO VERIFY | No SCC/adequacy claim recorded; actual account safeguard TO VERIFY | Iacovlev Ghennadi | 2026-09-11 | VERIFIED product documentation / TO VERIFY account evidence |
| Email service provider | Communications | Receive privacy requests and customer e-mail | Sender/address/message content | Provider identity and location not evidenced in repository | TO VERIFY | TO VERIFY | No SCC/adequacy claim recorded | Iacovlev Ghennadi | 2026-09-11 | TO VERIFY |

Recipients also include the controller and a human reviewer acting under the controller's authority; they are not external processors. No personal-data sale or third-party marketing recipient exists in v1.

## 6. International transfer register

| Flow | Destination evidence | Rule applied | Documentary position | Status |
|---|---|---|---|---|
| FINMENTOR → Supabase project | `eu-central-1`, EEA | EEA processing: no special authorisation under the Moldova international-transfer chapter | Project-region evidence VERIFIED; DPA/onward-transfer evidence TO VERIFY | VERIFIED / TO VERIFY |
| FINMENTOR → Google services | Actual service/account locations not fully evidenced | Determine effective destination per service; EEA rule only where evidenced | No safeguard or SCC acceptance invented | TO VERIFY |
| FINMENTOR → n8n Cloud | Tenant region not evidenced in repository | Determine effective destination before final register sign-off | No safeguard or SCC acceptance invented | TO VERIFY |
| FINMENTOR → Telegram | Multi-region/effective destination not evidenced | Outside-EEA flow requires actual lawful-mechanism evidence | No safeguard or SCC acceptance invented | TO VERIFY |
| FINMENTOR → OpenAI API | Project residency/processing location not evidenced | Apply EEA rule only if actual EEA processing is documented; otherwise record actual mechanism | Public data-control documentation is not transfer-mechanism evidence | TO VERIFY |
| FINMENTOR → GitHub / email provider | Location/provider evidence incomplete | Determine destination and role | No safeguard or SCC acceptance invented | TO VERIFY |

Order No. 31/2026 is a current legal tool, not an automatic answer for all flows. Before adding a new non-EEA processor or changing a region, the privacy owner records destination, role, onward transfers, contract/DPA, and the actual safeguard or lawful mechanism. If evidence is missing, the status remains `TO VERIFY` and the change is not described publicly as verified.

## 7. DSAR procedure

1. Receive requests at `cfo@finmentor.md`; immediately record received time, requested right and case ID without duplicating unnecessary request content.
2. Verify identity proportionately using existing contact/context. Do not demand new high-risk identity documents unless necessary.
3. Acknowledge receipt and calculate the ordinary one-month deadline. Any legally permitted extension must be communicated within the first month with reasons.
4. Search by the minimum verified identifiers across Telegram/session data, n8n data tables, Google Sheets CRM/lead/history/follow-up/X-Ray stores, Supabase privacy acknowledgements/client-result stores, owner alerts/messages where controllable, consented analytics identifiers if relevant, and selected case evidence.
5. Assess scope, third-party rights, legal holds and mandatory exceptions. Record the reason for any restriction or refusal.
6. Fulfil the applicable right: access, rectification, deletion, restriction, objection, conditional portability, or consent withdrawal. Use a secure delivery channel.
7. Ask affected processors to act where necessary; record request/response evidence and disclosed platform limitations.
8. Respond within the deadline and retain only the minimal case record for three years after closure. Escalate missed deadlines or complaints to the privacy owner immediately.

## 8. Deletion procedure

Deletion is a verified multi-store operation, not removal of one CRM row.

1. Confirm the requester/authority, scope and applicable exceptions; set a case ID and freeze unrelated automation for the target only when necessary.
2. Resolve the identity graph using verified contact, Telegram ID, app session ID, cycle/submission key, lead ID and analysis ID. Do not use fuzzy identity matching as deletion authority.
3. Produce the deletion inventory: Telegram conversation/messages where controllable; `Bot_Sessions`, `MiniApp_App_Sessions`, replay and receipt tables; Google Sheets `Leads`, `Pipeline`, `Activities`, `Status_Log`, follow-up/SLA/digest-related rows and `XRay_Analysis`; n8n `XRay_Client_Results`; `privacy.privacy_acknowledgements`; analytics IDs/attribution where applicable; minimal case evidence.
4. Record any contract, accounting, legal-hold or defence requirement per record class. Restrict rather than erase only where a documented exception requires it.
5. Delete or irreversibly anonymise operational PII in every applicable store; revoke client access through the existing authorised process if a published result exists. Do not alter the Client Visibility architecture.
6. Request processor-side deletion where FINMENTOR controls it. Record backup/log limitations and ensure deleted data is not intentionally restored to production; if disaster recovery restores it, re-apply the deletion list.
7. Independently verify absence using the same exact identifiers. Record stores checked, time, operator and exceptions — not the deleted request content.
8. Close the case and retain the minimal evidence for three years. C4.11 itself authorises no production deletion or backfill.

## 9. Incident / breach procedure with 72-hour clock

The clock begins when FINMENTOR becomes aware of a credible personal-data breach, not when investigation ends.

1. **T+0 awareness:** record UTC/local time, reporter, affected system and facts; notify Iacovlev Ghennadi immediately. Preserve proportionate evidence without copying more PII into chat or alerts.
2. **Contain:** revoke/rotate affected access where authorised, stop the affected workflow or disclosure if necessary, preserve logs, and prevent further exposure. SYSTEM ALERT/Error Monitor messages must remain scrubbed.
3. **Assess:** identify data, people, volume, duration, recipients, reversibility and likely risk. Contact processors promptly for facts and containment.
4. **By 72 hours from awareness:** where the legal risk threshold requires notification, notify CNPDCP with available facts, likely consequences and measures. If notification is late, record reasons. If notification is not required, record the documented risk assessment and reviewer.
5. **Data-subject communication:** where the applicable high-risk threshold is met, provide clear direct information without undue delay, following current law and CNPDCP guidance.
6. **Recover and learn:** validate containment, re-apply any deletion after restore, document root cause/corrective action and review processors, access, retention and this artifact.
7. Retain only minimal incident/accountability evidence for three years after closure.

## 10. Compact AI / X-Ray DPIA-style assessment

**V1 verdict:** `FORMAL MANDATORY DPIA TRIGGER = NOT ESTABLISHED AT CURRENT SCALE`.

**Basis for the v1 verdict:** small scale; no established large-scale special-category processing; no large-scale monitoring; no solely automated decision producing legal or similarly significant effects; human review before customer publication. This is a current operating/legal interpretation, not a permanent exemption.

| Risk | Existing control | Residual risk | Status / action |
|---|---|---|---|
| New-technology/AI opacity and inaccurate inference | Deterministic input projection; schema validation; fabrication flags; human review; X-Ray is labelled preliminary | Medium — model output can still be wrong or overconfident | VERIFIED controls; review quality sampled quarterly |
| Direct identifier disclosure to AI | Lead Intake and X-Ray safe projections remove name, contacts, Telegram IDs, URLs and analytics IDs | Low/medium — free-text business facts may still identify indirectly | VERIFIED; keep “pseudonymised”, never “anonymous” |
| Special-category or secret data entered in free text | One concise RU/RO warning not to enter passwords, PIN/CVV, full card data or unnecessary information; no questionnaire logic change | Medium — users can ignore warning | VERIFIED warning; incident/DSAR handling applies |
| Unauthorised client publication | Existing human review and Client Visibility authority gate | Low/medium | VERIFIED; C4.11 does not alter visibility logic |
| Excess owner-alert disclosure | X-Ray/Lead Intelligence alert shows at most one preferred reachable contact; internal identifiers hidden | Low | VERIFIED by QA |
| Provider retention and international transfer | Data-minimised payload; provider register; evidence statuses; no fabricated safeguard | Medium until account-level evidence is complete | TO VERIFY OpenAI account retention/region/DPA/safeguard |
| Over-retained workflow payloads | Candidate settings disable success/error/manual/progress execution payloads; scrubbed error path remains | Low after deployment; current production state unchanged in this PR | Candidate VERIFIED; deployment/readback requires separate authority |

Review/mandatory-DPIA reassessment triggers: material growth in volume or frequency; systematic monitoring; special-category data; use affecting credit/employment/access or other significant decisions; removal of human review; new model/prompt purpose; new data source; identity-bearing AI input; new vulnerable population; materially changed transfer/retention; security incident; CNPDCP/legal change. The privacy owner records the reassessment before the change goes live.

## 11. Access review procedure

1. Quarterly and on every joiner/leaver/credential incident, inventory accounts and service credentials for GitHub, n8n, Google Workspace/Sheets, Telegram bot, Supabase, OpenAI and the e-mail provider.
2. Confirm named owner, business need, least privilege, MFA capability/status, last use and recovery owner. Remove stale access under separate authorised change control.
3. Verify production credentials remain in platform credential stores/environment configuration and never in repository code, generated artifacts, owner alerts or retained execution payloads.
4. Review public repository collaborators and protected-branch/PR controls; review n8n user access and MFA (C4.10 observed one n8n user with MFA disabled — remediation evidence remains `TO VERIFY`).
5. Review database roles and RLS without changing them in C4.11. The privacy writer remains insert-only; do not broaden it to enable prettier idempotency syntax.
6. Record date, reviewer, systems, exceptions, action owner and due date in the evidence register. Escalate owner/admin access without MFA as a security priority.

## 12. Evidence register

| Evidence | Location / method | Owner | Cadence | Retention | Status |
|---|---|---|---|---|---|
| Canonical notice and RU/RO/Mini App parity | `privacy-notice.js`, public pages, generated `content.js`, C4.11 QA | Iacovlev Ghennadi | Every notice change | Git history | VERIFIED |
| New acknowledgement version/basis and immutable insert | Submit builder/candidate + privacy-record QA; production readback after separately authorised deployment | Iacovlev Ghennadi | Every deployment | Ack retention rule | Candidate VERIFIED; live readback TO VERIFY |
| Historical acknowledgement non-rewrite | Base-to-HEAD diff and live row snapshot/count from C4.10 | Iacovlev Ghennadi | C4.11 and future migrations | Minimal audit evidence | VERIFIED for C4.11 no-mutation boundary |
| Analytics consent/no pre-consent persistence | `analytics.js` VM tests | Iacovlev Ghennadi | Every analytics change | Git/test evidence | VERIFIED |
| AI safe projection and human review | AI safety, X-Ray and Client Visibility regression suites | Iacovlev Ghennadi | Every AI/X-Ray change | Git/test evidence | VERIFIED |
| Eight-workflow retention candidate and graph invariance | C4.11 retention plan/helper + QA; production readback after authority | Iacovlev Ghennadi | Deployment + quarterly | Three years for change evidence | Candidate VERIFIED; live setting TO VERIFY |
| Monthly non-converted due-list | Date, row identifiers/count, exceptions, operator, verification result | Iacovlev Ghennadi | Monthly | Three years minimal evidence | TO VERIFY first run |
| Weekly session/replay cleanup | Cutoff, table, deleted count, exception count, verification | Iacovlev Ghennadi | Weekly | Three years minimal evidence | TO VERIFY first run |
| DSAR/deletion case | Case ID, verification, deadline, stores/actions, response, exceptions | Iacovlev Ghennadi | Per case | Three years after closure | TO VERIFY until case/runbook exercise |
| Incident/breach case | Awareness time, assessment, notification decision, containment, closure | Iacovlev Ghennadi | Per incident + annual tabletop | Three years after closure | TO VERIFY tabletop |
| Processor/transfer evidence | Terms/DPA/account evidence, locations, subprocessors, safeguards | Iacovlev Ghennadi | Annual and on change | Current + superseded evidence as required | TO VERIFY items in registers |
| Access/MFA review | Account inventory, reviewer, exceptions/actions | Iacovlev Ghennadi | Quarterly | Three years | TO VERIFY next review |

## 13. Review and change triggers

- **Annual:** full policy/version, DPO threshold, DPIA threshold, ROPA, bases, retention, processor/transfer evidence, access/MFA, backup/deletion limitations and incident tabletop.
- **Re-scaling:** substantial lead/client/AI volume, more users/reviewers, new geography, vulnerable groups, systematic monitoring or special-category processing triggers review before expansion.
- **Product/data:** new form field, purpose, CRM column/store, model, prompt purpose, automated action, publication route, marketing, analytics use, processor, destination or materially longer retention triggers privacy review before release.
- **Legal/guidance:** amendment to Law No. 195/2024, CNPDCP guidance or implementing act triggers legal-source review and, if needed, a new notice version.
- **Security/rights:** a breach, missed rights deadline, failed deletion, backup restoration or processor non-response triggers corrective review.
- A notice change that affects what the person is told requires a new immutable version; historical acknowledgement rows are never rewritten or backfilled.
- Production cleanup, schema change, workflow deployment, credential mutation and backfill always require separate owner authorisation.
