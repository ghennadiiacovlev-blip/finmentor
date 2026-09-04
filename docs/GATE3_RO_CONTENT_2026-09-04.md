# GATE 3 — RO customer content: fresh-read audit and two owner decisions

**Date:** 2026-09-04 · **Branch:** `feat/miniapp-b21c-live-prereqs` · **Plan:** `FINAL_PRODUCTION_V1_GO_PLAN.md`
**Verdict: GATE 3 = PASS** — both owner decisions received, both corrections deployed and verified live (section 7).
**CUSTOMER RELEASE = NOT AUTHORIZED.**

Read from the repository, the live public site and the live tenant. Owner-facing Lead Alerts are
out of scope by instruction and were not examined.

---

## 1. Inventory

| # | Surface | Language state | Issue | Severity | Action |
|---|---|---|---|---|---|
| 1 | `ro/questionnaire.html` | Romanian | **zero** visible Cyrillic; 533 ă / 141 ș / 233 ț — diacritics intact | PASS | none |
| 2 | `ro/index.html` | Romanian | zero visible Cyrillic except the language switcher (below) | PASS | none |
| 3 | `ro/privacy.html` | Romanian | one sentence uses the non-canonical product name | **MINOR CONSISTENCY** | decision 1 |
| 4 | `ro/thank-you.html`, `ro/terms.html`, `ro/financial-health-check.html` | Romanian | zero visible Cyrillic | PASS | none |
| 5 | Language switcher `Limbă · Язык` | bilingual by design | mirrored on the RU page as `Язык · Limbă` so either reader can find the switch | PASS | none |
| 6 | `ro/runtime-strings.ro.json` | RU→RO mapping table | its 157 Cyrillic runs are the **source** side of a translation table; nothing loads it at runtime (only `scripts/apply-ro-translations.mjs` and two docs reference it) | PASS | none |
| 7 | Mini App **result** screen (`UI.ro` in `app-premium/app.js`) | **Romanian, complete** | covers result with score, without score, pending, cycle-unresolved, outage; correct diacritics; «Etapa N · Zilele …» matches the approved vocabulary | PASS | none |
| 8 | CLIENT_READY result labels (`XRAY_LABELS.ro`) | **Romanian, complete** | zones, products, review states, week labels; `Financial Health Check` retained inside Romanian context, as the rule allows | PASS | none |
| 9 | Mini App **brief / questionnaire** (`app-premium/content.js`) | **Russian only** | 291 Russian strings; no locale key anywhere | **P1 CONTENT DEFECT** | decision 2 |
| 10 | **Concierge** conversation (`n8n/src/premium-ux/branches.js`) | **Russian only** | 339 Russian strings, **0 locale keys** — the module has no locale mechanism at all | **P1 CONTENT DEFECT** | decision 2 |
| 11 | Mini App shell strings in `app-premium/app.js` outside the locale table | Russian only | «Изменить», «Открываем форму…», «Осталось проверить бриф.», «Подготовка к встрече» and similar | **P1 CONTENT DEFECT** | decision 2 |

Machine contract confirmed correct and untouched: the RO questionnaire keeps **299 Russian
`value="…"` attributes**, which are the answer values the backend scores on. Those are deliberately
identical to the RU form and must stay byte-equivalent; the visible label beside each is Romanian.
Example: `value="Кассовые разрывы"` renders as «Goluri de numerar».

---

## 2. Decision 1 — the canonical Romanian product name

The instruction names **Radiografia Financiară FINMENTOR** as canonical and says
«Testul de sănătate financiară» must not alternate with it.

That reverses a documented product decision. Commit `05463e5` (2026-09-03,
*"feat(ro): adopt «Test de sănătate financiară» as the Romanian product name"*) records:

> C3.6 of the Production Completion Program. "Radiografia Financiară" is retired on the whole
> Romanian surface (34 files, 184 occurrences): titles, meta descriptions, OpenGraph/Twitter cards,
> JSON-LD names, FAQ, navigation, CTAs, i18n string table, runtime RO strings and the 404 page.

**Where each name actually is right now:**

| | «Radiografia Financiară» | «Testul de sănătate financiară» |
|---|---|---|
| LIVE site (`main`) — RO questionnaire | 24 | 0 |
| LIVE site — RO landing | 15 | 0 |
| LIVE site — RO privacy | 4 | **1** ← the Gate 1 paragraph |
| feature branch — every RO file | 0 | ~50 across 34 files |

The live site already matches the canonical name the instruction asks for, because `05463e5` was
never published to `main`. The **only** live inconsistency is one sentence, published by Gate 1:

**BEFORE** (live, `ro/privacy.html` §8):

> Rezultatele **Testului de sănătate financiară FINMENTOR** și planul de acțiune pentru 30 de zile
> sunt pregătite automatizat, cu ajutorul inteligenței artificiale…

**AFTER** (if canonical is confirmed):

> Rezultatele **Radiografiei Financiare FINMENTOR** și planul de acțiune pentru 30 de zile sunt
> pregătite automatizat, cu ajutorul inteligenței artificiale…

**The decision.** Confirming canonical means either (a) fix that one live sentence and leave the
branch's C3.6 rename permanently unpublished — one line, live consistency achieved — or (b) also
revert C3.6 across 34 files so the branch matches. I will not reverse a documented
184-occurrence product-naming decision without an explicit instruction, and the replacement wording
is yours to approve.

---

## 3. Decision 2 — is RO Concierge and RO brief in scope for v1?

This is the substantive finding, and it is not a wording problem.

`branches.js` is the single source for both the Concierge conversation and — via
`scripts/build-premium-app-content.mjs` — the Mini App brief. It contains **339 Russian strings and
zero locale keys**: there is no locale mechanism to branch on. `content.js`, generated from it,
carries **291 Russian strings**. Further Russian strings are hardcoded in `app.js` outside the `UI`
locale table.

An RO customer entering the Concierge today would hold a Russian conversation and fill in a Russian
brief, then receive a correctly Romanian result. Both ends are localised; the middle is not.

**Why this is not a "minimum fix".** Closing it requires introducing a locale mechanism into a
module that has none, translating roughly 600 customer-facing strings, regenerating the content
bundle, and lifting the hardcoded shell strings into the locale table. That is new architecture plus
a large content project — explicitly outside the minimum-fix policy and outside the freeze.

**The options:**

- **A — v1 RO is the public site plus the result.** The RO public questionnaire, landing, privacy
  and the RO CLIENT_READY result are complete and correct today. Ship RO on those; the Concierge and
  Mini App brief stay Russian for v1, and their RO localisation becomes a POST_GO item. Gate 3 then
  passes on its actual v1 scope.
- **B — full RO parity before GO.** Localise the Concierge and the Mini App brief. A separate work
  package, not a Gate 3 correction, and it will not fit under the current freeze.

Option A is the one consistent with the freeze policy as written. It needs confirmation because it
narrows what "the RO customer path works" means for v1.

---

## 4. What is already proven

- **RU leakage on the RO public surface: NO.** Zero visible Cyrillic in the rendered body of every
  RO page checked. The only Cyrillic is machine values, script internals, the deliberate bilingual
  switcher, and a non-runtime translation table.
- **Diacritics: PASS.** ă / î / ș / ț / â present in the hundreds per page; no stripped or
  Latin-substituted forms found.
- **Unapproved English leakage: NO.** English survives only as named products
  (`Financial Health Check`, `Business Control System`, `Monthly CFO Support`, `Cash Flow`,
  `Discovery Call`) inside Romanian sentences, which the rule permits.
- **Functional contract: UNCHANGED.** Nothing was edited in this gate. Question ids, answer values,
  payload keys, callback data, session and cycle logic, the CLIENT_READY 12-key contract, consent
  and privacy contracts, owner alert routing, dedup and X-Ray model logic are all untouched.
- **Canonical QA: 81/81 gates, 2820 assertions, floors PASS**, with a clean working tree.

---

## 5. Verdict

    GATE 3 — RO CONTENT = BLOCKED

    RO QUESTIONNAIRE            = PASS
    RO CLIENT_READY RESULT      = PASS
    RO MINI APP (result screen) = PASS
    RO MINI APP (brief flow)    = FAIL — Russian only
    RO CONCIERGE                = FAIL — Russian only, no locale mechanism
    RO PRIVACY WORDING CONSISTENCY = FAIL — one sentence, decision 1
    RU LEAKAGE (public RO surface) = NO
    UNAPPROVED EN LEAKAGE       = NO
    CANONICAL TERMINOLOGY       = BLOCKED ON DECISION 1
    DIACRITICS                  = PASS
    ROUTING / SCORING / CLIENT_READY CONTRACT CHANGED = NO

    OPEN P0 = 0
    OPEN P1 = 1   (RO Concierge + Mini App brief are Russian-only; scope decision 2)
    CANONICAL QA = 81/81 gates, 2820 assertions, floors PASS

**CUSTOMER RELEASE = NOT AUTHORIZED.**

---

## 6. Owner decisions received, and the reachability finding (2026-09-04, second pass)

**Decision 1 recorded and accepted:**

    C3.6 MASS TERMINOLOGY CHANGE = SUPERSEDED / DO NOT PUBLISH
    CANONICAL RO PRODUCT NAME    = Radiografia Financiară FINMENTOR

The live RO surface already uses the canonical name; the branch's C3.6 rename stays unpublished.
The single live inconsistency is the Gate 1 sentence in `ro/privacy.html`, whose approved
replacement is in section 2 above. It is a one-line change and is **not yet applied**, because it
ships in the same release as the reachability correction below, and that correction is blocked.

**Decision 2 recorded and accepted:** v1 RO scope is the public site, questionnaire, identity and
consent, lead generation, CLIENT_READY and the Mini App result screen. Full RO Concierge and RO
brief parity are POST_GO.

### 6.1 Reachability — the gate that decides Gate 3

| # | Surface | CTA | Destination | RO customer can reach a RU-only flow |
|---|---|---|---|---|
| 1 | Mini App **brief** | «Открыть бриф» inside the Concierge | premium brief | **NO** — `Premium Owner Gate` compares `chat_id` to `owner_chat_id`; non-owners take the legacy branch. Session and Submit are also `RELEASE_MODE = "OWNER_ONLY"` |
| 2 | **Concierge conversation** | 25 links across 8 live RO pages, all `t.me/finmentor_md_bot` | legacy Concierge | **YES** |

The bot behind every RO CTA is the **Client Concierge** bot: workflow `mppzthlkSJFr6Kle` and its
transport both authenticate with the `FINMENTOR Client Concierge Bot` credential, and it is the only
client-facing Telegram trigger on the tenant.

Its non-owner branch answers from `Build Bot Response` — 40,472 characters carrying **6,247 Cyrillic
characters, zero Romanian diacritics, and 67 distinct Russian sendable strings**, including a full
Russian menu («Вернёмся в главное меню, где можно выбрать диагностику, встречу или свободно описать
запрос»). It tracks a `language` field on the session and never uses it for output;
`default_language` in Settings is `ru`.

So an RO customer following the site's own CTA holds a fully Russian menu-driven conversation. By
the owner's own definition this is **P1**.

### 6.2 Why neither prescribed fix is small here

The preferred correction — retarget the RO CTA to the RO questionnaire — is wrong in most of these
contexts, because the bot is not an alternative entry to the diagnostic. It is the site's contact
and fallback channel:

- three CTAs read «Mai simplu: scrieți direct → FINMENTOR Bot» and sit **immediately beside** an
  existing «Începeți Radiografia Financiară» button — retargeting would duplicate the button above;
- «Dacă formularul nu a funcționat, scrieți direct: FINMENTOR Bot · Email» is the **form-failure
  fallback** — pointing it back at the form that just failed is not a fix;
- «Mulțumim! … Pentru un răspuns rapid, scrieți direct: FINMENTOR Bot · Email» is the **post-submit**
  channel, after the questionnaire is already done;
- `ro/questionnaire.html` offers the bot as the **manual submission route** when auto-submit is
  unavailable;
- two contact strips and the footer list the bot as a **contact method** beside the email.

The fallback correction — hide the RO bot CTA — is also not small, and it collides with a Gate 1
constraint. Beyond the 25 links there are roughly fifteen further RO references in prose, JSON-LD
and page JavaScript, and the **approved RO privacy policy itself** names the bot as the primary
channel: «Canalul principal al solicitărilor — FINMENTOR Bot în Telegram: botul adună informația de
bază despre solicitare și o transmite pentru răspuns.» Removing the bot from the RO journey means
editing that approved privacy text, which this gate forbids
(*"Do not otherwise rewrite the Gate 1 policy"*).

One fact makes removal safer than it sounds, and it is worth recording: **every one of the 25 links
already sits beside a working alternative** — `mailto:cfo@finmentor.md` in the contact strips,
fallbacks, form-success block and footer, and the primary questionnaire button beside the three
hero and package CTAs. No RO page would be left without a route.

### 6.3 The options, honestly costed

- **A — remove the bot from the RO journey.** 25 links plus roughly 15 prose, JSON-LD and JS
  references across 8+ RO pages, **and** an edit to the approved RO privacy policy so it stops
  naming a channel the RO customer is no longer offered. Fully removes the P1. Collides with the
  Gate 1 preservation rule and is a substantial customer-facing copy change.
- **B — one narrow Romanian branch in `Build Bot Response`.** The instruction permits *"the minimum
  deterministic locale branch"* in a narrow presenter. A single Romanian acknowledgement — we have
  your message, a consultant will reply — for sessions whose `language` is `ro`, using the field the
  session already carries. No locale framework, no translated conversation, roughly one string. It
  does **not** fully remove the defect: if the customer keeps tapping, the menu is still Russian.
- **C — accept and record as a v1 limitation.** The bot is a shared contact channel that a human
  answers personally; the automated Russian menu is recorded as POST_GO. This leaves the P1 open by
  the owner's own definition, so it needs an explicit owner override.

**Recommendation: B, combined with A limited to the three duplicate hero and package CTAs.** Those
three add nothing — the questionnaire button is already beside them — so removing them is genuinely
small and touches no policy text; and the Romanian acknowledgement means any RO customer who still
writes to the bot is answered in Romanian rather than dropped into a Russian menu unannounced. That
keeps the contact and fallback routes intact, keeps the approved privacy wording true, and needs no
locale framework.

This is an owner decision because A rewrites approved policy text, B accepts a partial fix, and C
overrides a P1. Nothing has been changed pending it.

---

## 7. GATE 3 = PASS — corrections deployed and verified live (2026-09-04)

Owner approved option B plus a narrow slice of option A. Both shipped.

### 7.1 The Romanian first-contact branch (Concierge)

`scripts/deploy-ro-first-contact.mjs --confirm` patched one node, `Build Bot Response`, replacing
exactly two lines — the reply text and the reply markup — and nothing else. When the language the
session carries is Romanian, the reply becomes the owner-approved Romanian acknowledgement and the
keyboard becomes empty; every other language runs the original expressions untouched.

An empty keyboard is already a first-class layout downstream (`L0_NONE`, `replyMarkup: none`), so
no routing, layout or callback contract changed, and no node was added.

Not touched: the state machine, `session.state`, `leadReady`, `leadPayload`, intent classification,
consent, and all 67 Russian strings — the deploy verifies the Cyrillic character count is identical
before and after and refuses otherwise.

**Two defects my own gate caught before deployment**, both worth recording:

- the language test was a two-character prefix, so `roman` would have entered the Romanian branch.
  It is now a proper tag match, `/^ro(-|$)/`, which accepts `ro` and `ro-MD` and rejects `roman`;
- the verifier checked only that the guard *name* appeared, so replacing just the text expression
  with an unconditional Romanian reply still passed. It now asserts both full conditional
  expressions.

**A limit worth stating plainly.** The signal is Telegram's `language_code`. A Romanian speaker
whose Telegram interface is set to Russian or English is not detected and still sees the Russian
menu. That is the only language signal the update carries, and inventing another would be the second
identity system this gate forbids. Recorded as POST_GO alongside full Concierge parity.

### 7.2 The three duplicate CTAs and the canonical name (public site)

PR **#22**, five files, merged as `7e63f32`. Both CI checks green at `36aa097`.

Three ghost buttons on `ro/index.html` reading «Mai simplu: scrieți direct → FINMENTOR Bot» —
`mobile_bot`, `hero_bot` and the packages one — sat immediately beside the primary «Începeți
Radiografia Financiară» button and offered no route the reader did not already have. Removed.
Telegram was **not** removed globally: the six contact-strip, form-fallback, form-success and footer
links remain, because they are the routes the approved privacy policy names, and each sits beside
`mailto:cfo@finmentor.md`.

The canonical product name was published, and a **second occurrence of the same Gate 1 defect** was
found and fixed in §6 (Temeiul juridic) that the first pass had missed — same origin, same rule,
product name only. `ro/privacy.html` now holds zero occurrences of the superseded name, while
art. 6(1)(b), the pending-confirmation caveat, the controller and the 12-month retention are all
still present and asserted.

### 7.3 Live proof

| # | Proof | Result |
|---|---|---|
| A | every affected RO page still has a route | **PASS** — all 8 pages carry both a questionnaire link and the email |
| B | the three duplicate CTAs are gone | **PASS** — 0 «Mai simplu» ghosts; 6 contact links remain; 6 primary CTAs and 6 email links intact |
| C | RO privacy carries the canonical name | **PASS** — «Radiografiei Financiare FINMENTOR» present, superseded name 0, controller and 12-month retention intact |
| D | RO first contact receives Romanian | **PASS** — executed against the deployed node: `ro` and `ro-MD` both return the Romanian text |
| E | the same RO contact does **not** receive the Russian menu | **PASS** — both return `inline_keyboard: []` |
| F | RU Telegram behaviour unchanged | **PASS** — `ru` and an absent language both return the original Russian text with the menu, and the RU landing still carries its 9 Telegram links with no Romanian copy |

**On how D and E were proven.** No Telegram message was sent, and none could have proven this: the
owner's own chat takes the `Premium Owner Gate` TRUE branch, so an owner UAT message never reaches
the legacy path where this branch lives. Instead the deployed node's own code was read back from the
tenant and **executed** against four language values. That is stronger than a single message — it
covers `ro`, `ro-MD`, `ru` and absent in one pass — and it required no customer and no lead.

Nothing else moved: Client Transport (24 nodes), Command Center (33), Lead Intake (109), X-Ray (39),
Gateway (32) and the Mini App host (2) are all unchanged and active, and Session and Submit both
still read `RELEASE_MODE = "OWNER_ONLY"`.

### 7.4 Verdict

    GATE 3 — RO CONTENT = PASS

    CANONICAL PRODUCT NAME       = Radiografia Financiară FINMENTOR
    C3.6 MASS TERMINOLOGY CHANGE = SUPERSEDED / NOT PUBLISHED

    RO QUESTIONNAIRE = PASS      RO CLIENT_READY RESULT = PASS
    RO MINI APP RESULT = PASS    RO PRIVACY WORDING CONSISTENCY = PASS

    RO CONCIERGE FULL PARITY = POST_GO
    RO MINI APP BRIEF FULL PARITY = POST_GO

    RO TELEGRAM FIRST CONTACT = PASS
    RO -> RUSSIAN MENU = NO
    RO -> RU MINI APP BRIEF REACHABLE = NO

    DUPLICATE RO TELEGRAM CTAS REMOVED = 3
    RO CUSTOMER ROUTE PRESERVED = PASS

    RU CUSTOMER PATH CHANGED = NO
    ROUTING CHANGED = NO   SCORING CHANGED = NO   CLIENT_READY CONTRACT CHANGED = NO

    OPEN P0 = 0   OPEN P1 = 0
    CANONICAL QA = 82/82 gates, 2839 assertions, floors PASS

**CUSTOMER RELEASE = NOT AUTHORIZED.**
