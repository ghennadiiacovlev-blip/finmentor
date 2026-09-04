# FINDING — the X-Ray questionnaire reported three required fields the visitor could not fill

**Reported:** 2026-09-04, owner. **Severity:** customer-blocking (the form could not be submitted).
**Fixed in the repo, NOT deployed.** `RELEASE_MODE` untouched; CUSTOMER not released.

## Where it actually is

Not the Mini App. The live Mini App host page (`KBD7Q94QQnlzgYKJ`, fetched fresh) contains none of
the reported strings and no `<input>` at all. The copy «Чтобы подготовить качественную
предварительную диагностику, заполните ещё несколько обязательных пунктов.» exists in exactly one
place in the repo: the public website questionnaire `questionnaire.html`, mirrored in
`ro/questionnaire.html`.

## Root cause

`REQUIRED` (questionnaire.html) lists eighteen fields. Three of them —

| key | canonical input | read by |
|---|---|---|
| `name` | `q_name` | `client.name` |
| `company` | `q_company` | `client.company` |
| `contact` | `q_email` / `q_telegram` | `client.email` / `client.telegram` |

— live inside `<section class="q-block" id="extendedIntake" hidden>` ("Контакт и формат
коммуникации", block 1 of 11). **That section is the only one on the page that ships `hidden`**, and
the only thing that opens it is `#dxContinue`, the «continue» button that appears after the quick
diagnostic is calculated.

The other seven question blocks are visible from page load. So a visitor who scrolled past the
quick diagnostic, answered everything visible and pressed «Отправить финансовый рентген» hit:

1. `validate()` → the three identity specs are unfilled → `showSummary(missing)` renders them as
   chips, `qValidate` opens;
2. clicking a chip → `scrollToSpec(spec)` → `container(spec.name)` → `.closest('.q')`, an element
   inside a `hidden` section → `scrollIntoView()` moves nothing and `focus()` reaches nothing;
3. submit stays blocked by `validate()` and again by the `completion().required_completed !== true`
   safety guard.

The chips were therefore exactly what the owner described: indicators pointing at controls that
could not be reached, with no path to completion.

## The correction (smallest safe)

**1. A collapsed block is opened, not silently scrolled to.** `revealBlock()` opens any
`.q-block[hidden]` ancestor before `scrollToSpec` scrolls and focuses. This alone makes the chips
work and the intake block reachable.

**2. The three required identity fields are editable where they are reported missing.** The notice
now carries a real form above the chip list: **Имя \***, **Компания \***, **Контакт \*** with
placeholder «Email или @Telegram» (RO: Nume / Companie / Contact, «Email sau @Telegram»).

**One source of truth, unchanged.** The panel controls hold no state and carry **no `name`
attribute**, so they cannot be serialised. Every keystroke writes THROUGH to the canonical input —
`q_name`, `q_company`, and `q_email` or `q_telegram` chosen by the shape of what was typed — and the
panel reads back from them. `collectAnswersJson()`, `isFilled()`, `completion()`, the progress bar
and the Lead Intake payload keep reading exactly what they read before. The panel never clears a
contact field it did not itself write (`vfOwned`), so a value typed in block 1 cannot be destroyed.

Also: identity is a field here and never also a chip; errors are specific and visible
(`aria-invalid` + red border + message); values survive a failed validation; the notice and the
panel clear as soon as nothing is missing (`vfRecheck` → `quietMissing`); pressing submit with
something missing focuses the first missing control; the submit button is never disabled outside
the in-flight lock.

**Unchanged:** routing, scoring, the diagnostic, questionnaire answers, the Lead Intake payload
shape, consent semantics, CLIENT_READY, Telegram routing, callback contracts, owner alerts.

## Proof

**Targeted, in a real browser** (headless Chrome, both pages, the questionnaire loaded in a 390 px
iframe with `FMLeadTransport.postLead` stubbed so nothing reaches the network) —
**32 checks passed, 0 failed on RU and 32/0 on RO**:

| owner scenario | result |
|---|---|
| empty identity | blocked, 0 posts, notice open, three editable fields visible, three specific errors, submit not disabled |
| name only | blocked; name error cleared, company + contact still flagged; `q_name` written through |
| name + company | blocked on contact only; `q_company` written through |
| malformed contact (`ivan@`) | blocked with «Проверьте формат: email или @Telegram» |
| valid email | eligible; `q_email` written through; errors clear live; identity leaves the notice |
| valid `@telegram` | eligible; normalised into `q_telegram`; the other field not clobbered |
| answers survive a failure | chosen radio still checked, typed identity preserved |
| complete form | **exactly one** post, `client.name/company/email` carry the panel's values, payload keys unchanged, completion score 100 |
| second press | no second post; lead identity stable in-session |
| RU / RO, 390 / 430 px | both pages, both widths, single-column panel, no horizontal scroll |

Cross-refresh de-duplication is unchanged and remains server-side (`FMLeadTransport` request
identity + the Lead Intake dedup/replay gates); this fix does not touch it.

**Offline gate:** `qa/questionnaire-identity-panel.test.mjs` (27 checks, in `run-all`) holds the
structure — one canonical input per field, the panel inside the notice above the chips, no `name`
attributes, write-through, live recheck, reveal-before-scroll, focus-first-missing, required marks
and placeholder, mobile-first single column, no raw hex, RO copy free of Cyrillic.

**Canonical:** `node qa/run-all.mjs` → **77/77 gates, 2689 assertions, floors PASS**.

## Not done

Deployment. `questionnaire.html` and `ro/questionnaire.html` are static site files; publishing them
is the owner's deploy step, and nothing here was pushed to the tenant.
