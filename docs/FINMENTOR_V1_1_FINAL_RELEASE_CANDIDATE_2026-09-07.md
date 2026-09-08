# FINMENTOR v1.1 — FINAL RELEASE CANDIDATE

**READY FOR ONE FINAL INDEPENDENT RELEASE AUDIT**

This record is written by the engineer who did the work. It is **not** an independent approval,
and it does not claim one. Nothing has been deployed, merged or activated.

---

## 1. Identity — and how this record names it

The previous edition of this file named `7f05741` as the "final source SHA" while the branch head
was already two commits past it. That was the third open blocker, and it is closed here by a
convention that cannot go stale.

| | |
| --- | --- |
| Branch | `release/v1.1-final-integration` |
| **Final audited source + harness SHA** | **`91ce8537ef4a5237492130987f66e15166ed8d5d`** |
| **Release sealing commit** | **THIS COMMIT** — the commit that carries this file |
| **Branch HEAD after the seal** | **the sealing commit**, i.e. `git rev-parse HEAD` |
| Audited base (the commit this run started from) | `d9b54657683e78c4f074ac4dcc000b74d5e90ad1` |
| Parent (authorised start of v1.1) | `9f62e6f542a361163358aaa96b1d8ba1f2187dd6` |
| Production `main` baseline | `b57ac259847ca77e249ec133e41bcb6435f8e031` — **unchanged during this run** |

**Why it is written this way.** A commit cannot contain its own hash, so no honest document can
print the SHA of the commit that carries it. What it can do is identify itself by provenance, and
this one does:

* `91ce853` carries the source, the harness and nothing else. It is the SHA the visual evidence
  records as `candidate_sha` on all 26 retained images, so the screenshots are demonstrably of it.
* The sealing commit — the one you are reading — adds **only** `qa-evidence/` and this file. That
  is checkable, not asserted:

  ```bash
  git diff 91ce8537ef4a5237492130987f66e15166ed8d5d HEAD -- . ':!qa-evidence' ':!docs'   # EMPTY
  ```

* **No commit follows this one.** The sealing commit is the tip of the branch, so
  `git rev-parse HEAD` and the release candidate are the same thing by construction, and this file
  cannot name a stale head.

**The release candidate is the branch head.** The source it ships is `91ce853`'s tree, byte for
byte, because the sealing commit changes no file outside `qa-evidence/` and `docs/`.

### Commits in this run

```
<sealing>  docs(release)+evidence(release): seal v1.1 on the audited head
91ce853    fix(copy)+test(qa): close the last three release blockers at their root
```

### Files changed by `91ce853` (9)

```
index.html                   |  14 +-      questionnaire.html           |   6 +-
monthly-cfo-support.html     |  10 +-      ro/index.html                |  22 +-
ro/monthly-cfo-support.html  |   8 +-      ro/questionnaire.html        |  10 +-
qa/assertion-baseline.json   |   4 +-      qa/visual-evidence.mjs       | 549 ++-
qa/website-contract.test.mjs | 281 ++
```

`n8n/`, `gateway/`, `db/`, `app-premium/`, `app/`, `analytics.js`, `lead-transport.js`, `main.js`,
`assistant.js`, `i18n-ro.js`, `lang.css` and `style.css` are **untouched by this run**. No
production workflow, no schema, no credential and no shipped application script was changed.

---

## 2. The three blocker classes, closed

### P1-A — the primary journey still failed a human read

**The method changed, because the method was the problem.** Previous passes declared PASS from a
glossary sweep and a list of known examples. This run did not start by editing.

1. **An exhaustive inventory first.** A tokenizer walked all eight primary-journey files and
   emitted **every** customer-visible string — headings, paragraphs, list items, cards, labels,
   legends, buttons, links, FAQ questions and answers, placeholders, helper text, success copy,
   package descriptions, visible spans, and the `alt` / `aria-label` / `title` a screen reader
   speaks — each with its file, line, DOM context and full sentence. Script source, CSS, machine
   values, `data-*`, JSON keys and developer comments were excluded by construction.

   | | |
   | --- | --- |
   | RU strings extracted and reviewed | **1231** |
   | RO strings extracted and reviewed | **1222** |

2. **Three independent reads.** Pass 2 re-extracted the modified tree and read it again from
   scratch, trying to reject pass 1 rather than confirm it. Pass 3 read the two editions **aligned
   side by side**, paired string by string over an LCS of their DOM paths.

   That alignment is what found most of pass 2, and it is the technique worth keeping: where one
   language says a thing cleanly and the other does not, the untidy one is the defect. «реестр
   ДЗ/КЗ» looks like ordinary Russian until the Romanian line beside it reads «registrul
   creanțelor/datoriilor»; «Slab» looks like an answer until you see the Russian scale it came
   from is broken too.

| | RU | RO |
| --- | --- | --- |
| Pass 1 defects | 8 classes, 13 strings | 11 classes, 27 strings |
| Pass 2 NEW defects | 6 | 4 |
| Pass 3 NEW defects | **0** | **0** |
| Final clean pass | **YES** | **YES** |

**50 corrected strings.** No fourth pass was needed; three was the ceiling.

#### Russian

* `index.html` — a bare English **`mix`** standing as a noun in «цена, количество, mix,
  себестоимость, промо», beside a clipped «промо» on a page that writes «промоакция» five times.
* `index.html` — **«реестр ДЗ/КЗ»**, an accountant's shorthand four lines above the page's own
  «Анализ дебиторской и кредиторской задолженности по срокам».
* `index.html` — **«период оборачиваемости запасов, дней»**, a spreadsheet column header's unit
  suffix left in a sentence, between two parallel terms that carry none.
* `index.html` — **«Много Excel»**, where the X-Ray on the same journey says «Excel-файлы».
* `index.html` — **«после понимания объёма»**: объёма ЧЕГО. The page's own answer, two sections
  above, is «согласования объёма работ».
* `index.html` — **«помесячного»** where the whole site says «ежемесячный».
* `index.html`, `questionnaire.html` — the only **English quotation marks** in documents that
  quote with « » four and two times respectively.
* `questionnaire.html` — **«1 объект-точка» / «2–5 объектов-точек»**: a term welded to its own
  gloss into a compound that inflects on both halves, which no Russian compound does.
* `questionnaire.html` — **«Насколько данные достоверны?» → «Низко · Средне · Хорошо»**: two
  degree adverbs and a quality adverb, three points that are not on one scale.
* `monthly-cfo-support.html` — **«Еженедельный регулярный»**, which states the cadence twice.
* `monthly-cfo-support.html` — **«на удалёнке»**, slang in the lead paragraph of a premium service
  page whose own FAQ asks «Можно ли работать удалённо?».
* `monthly-cfo-support.html` — **«Высокововлечённый»**, which is not a Russian word.
* `monthly-cfo-support.html` — **«финансовый уровень контроля»**, a noun pile with no meaning. The
  Romanian edition of the same answer says what was intended: control at CFO level.

#### Romanian

* `ro/index.html` — **«În comerț cu amănuntul», «În comerț cu ridicata», «În comerț online»**.
  A bare «în comerț» would be right: Romanian drops the article after most prepositions. It does
  not drop it when the noun carries a determinative complement, and «cu amănuntul», «cu ridicata»
  and «online» are exactly that.
* `ro/index.html` — **`mix`**, mirroring the Russian.
* `ro/index.html` — **«Panoul»** twice for an artefact this edition names «tablou de bord» six
  times, once two lines under its own «Tablou de bord pentru proprietar în Power BI».
* `ro/index.html`, `ro/monthly-cfo-support.html` — **`P&L-ului`**, the abbreviation the
  terminology pass exists to remove, on pages that spell it out everywhere else.
* `ro/index.html` — **«banii nu ajung — banii rămâneau»**, the subject repeated in one sentence.
* `ro/index.html` — **«Mult Excel»**, a transposition of «Много Excel»; «mult» cannot quantify a
  proper noun.
* `ro/index.html` — **«deficit temporar de lichiditate»** for the concept this edition calls «gol
  de numerar» five other times.
* `ro/index.html` — **«Control financiar regulat (Monthly)»**, an English parenthesis that glosses
  nothing and that the Russian line it mirrors does not carry.
* `ro/index.html` — **«crescută dintr-un ciclu … într-un business real»**, which reads "grown FROM
  X INTO Y"; the Russian says the cycle ran IN a real business.
* `ro/index.html` — **«după înțelegerea volumului»**, mirroring the Russian noun pile.
* `ro/questionnaire.html` — **«1 imobil-punct» / «2–5 imobile-puncte»**, and **«imobile»** used for
  a site a business operates in an X-Ray asked of retail, e-commerce, fitness and manufacturing
  alike. `imobil` is a building — the real-estate reading of a generic word.
* `ro/questionnaire.html` — **«Cât de fiabile sunt datele?» → «Slab · Mediu · Bine»**, which does
  not agree with the plural-feminine question it answers.
* `ro/monthly-cfo-support.html` — **«Analiză financiară periodică săptămânală»**, the same
  pleonasm as the Russian, and **«periodică»** where this page's own term is «regulată».
* `ro/monthly-cfo-support.html` — **«Prin ce diferă de angajarea…»**, a comparison missing one of
  its two terms; the Russian question carries its «это».

#### What was deliberately NOT changed, and why

An audit that changes everything it notices is as untrustworthy as one that changes nothing. These
were examined and left:

* **`IA Economics`** is a FINMENTOR product name across the Romanian site — `IA Economics Control
  System` on `ro/ai-agent-economics.html`, `ro/capacity-released.html`, `ro/materials.html` — not
  a half-translation. Renaming it on the home page alone would break a branded title.
* **`flagship`** and **`format light`** are ordinary Romanian business usage. The internal
  inconsistency with «emblematică» is a style preference, not a defect.
* **«Mai multe persoane juridice, proiecte și imobile»** is in the founder's credentials, where
  real-estate objects are the plausible reading. Deciding otherwise is a claim about his CV.
* **`webhook` / `GA4`** on the thank-you pages are technical terms inside a privacy disclosure,
  identical in both editions.
* **`Discovery Call`** reads as an owner-approved journey-step name with its own analytics event.

#### Machine values were not touched

Every corrected Romanian and Russian radio label sits beside a `value="…"` that is still the
Russian CRM string. This is not cosmetic: `questionnaire.html` and `ro/questionnaire.html` both
route a lead to **VIP** by comparing against `'€2M+ / 6+ объектов-точек'` — the exact string whose
*visible* half was repaired. The values are byte-identical; only the text after `/>` changed.

#### Eight new gates, each proven able to fail

`qa/website-contract.test.mjs` gained eight checks, each naming the **shape** of the damage rather
than the strings found: a welded gloss compound in an X-Ray answer set; the wrong quotation marks
for an edition; a restated recurrence; an unarticulated head noun before a determinative
complement; a term hidden behind an abbreviation or a bare English noun; a second name for one
artefact; an answer set that does not grade the axis its question asks about; and Russian slang or
a non-word.

**All eight fail on the pre-fix tree at `d9b5465`.** Seven of them count **37 findings** between
them; the eighth stops at the first answer that does not grade its own axis. A gate that cannot
fail is not a gate.

And every rule inside them proves, on every run, that it still flags the broken strings and still
passes the corrected ones. That is not ceremony. `\b` and `\w` are ASCII-only in JavaScript, so
`\bна удалёнке\b` matches **nothing at all** and `еженедель\w*` stops dead at the first Cyrillic
letter — the first draft of four of these rules were no-ops that reported PASS, and the
discrimination cases are what caught them. It is the same trap that made the `există` rule
decoration last cycle.

---

### P1-B — the visual harness did not enforce what it claimed

Three claims were audited to their root, not to their report.

#### Painted text, not the element box

`getBoundingClientRect()` returns the box the layout gave an element. It is not where the glyphs
are: a block is as wide as its container whatever its text does, so a line overflowing to the
right still reports a rect ending neatly at the container edge.

Line boxes now come from a **Range over each text node** — one rect per line box actually laid
out, the real ink — and each is measured against the viewport, against the element's own box when
the element hides its overflow, and against the nearest clipping ancestor's padding box.

**Proven by mutation.** A block was injected whose rect is exactly its clipping parent's content
box, painting a nowrap line 112px past it, with the ink still inside the viewport so no other gate
could claim the catch:

```
PASS  CLIPPED TEXT = 0            (the element-box check — sees nothing)
FAIL  PAINTED TEXT CLIPPING = 0   ink 24,81,336,92 past .DIV 24,81,224,94
```

The sweep also proves it did the work: it must return at least one line box for every text-bearing
element the box sweep graded. That invariant holds with room to spare across the audited set —
1.05× on the densest surface, 1.77× on the airiest.

| | |
| --- | --- |
| **PAINTED TEXT CLIPPING** | **0** |
| **PAINTED TEXT OUTSIDE VIEWPORT** | **0** |

#### The mobile language switch, opened rather than assumed

The old gate accepted a language link that merely **existed** inside the mobile drawer as
"reachable", without ever opening it. `qa-evidence/v1.1-final/drawer-probes.json` records what that
was worth: on every burger page, **both** language options measure unpainted and untappable —
in the bar and in the drawer alike — until the burger is pressed.

So the run presses it: a real `Input.dispatchMouseEvent` at the burger's own centre, which goes
through the browser's hit-testing, rather than `element.click()`, which would pass on a burger
sitting under an overlay. It then re-measures and grades each option **painted AND hit-testable** —
a tap at its centre has to land on that control and not on something covering it — checks that the
page's own edition is current and only that one, that the other edition is offered and has a
destination, that the options do not collide, and finally closes the drawer through its own close
control and requires the bar back in its starting state.

**Proven by mutation.** Point the tap at nothing and 10 surfaces report "tapping the burger opened
nothing", and the language gate reports **20** defects — the RU and RO controls unreachable on
every one of them. That is the finding the old harness reported as PASS.

The probe runs **after** both screenshots are already in hand, so nothing it taps can move a pixel
of the retained evidence.

| | |
| --- | --- |
| **MOBILE LANGUAGE SWITCH REACHABLE** | **PASS** (10 surfaces probed through the real UI) |
| **RU ACTIVE STATE / RO ACTIVE STATE** | **PASS / PASS** |
| **LANGUAGE CONTROL WRONG STATE** | **0** |
| Bar restored after the drawer closed | **PASS** on all 10 |

The two X-Ray questionnaire pages carry no burger; their controls are painted in the bar, and the
gate requires exactly that of a page with no drawer to hide behind.

#### Mini App states, proven rather than requested

`goto()` returning without throwing says the call was made, not that the app arrived: a router can
decline a transition, land on a guard screen, or route on again the moment a draft turns out to be
incomplete, and every one of those returns quietly.

Each surface now declares the state it is evidence **of**, and the run asserts it twice — against
the app's own `current()`, and against DOM markers only that screen builds.

| state | proven by |
| --- | --- |
| `APP_PROBLEM` (populated) | 6 option cards, **1 already chosen** from the resumed draft, under its objective kicker |
| `APP_REVIEW` | the `.dossier` memo, a named company, **7** memo sections, the readiness block |
| `APP_EDIT_SELECTOR` (edit) | **11** edit rows, every one labelled, **11** rendering the content they edit, **8–9** reachable by a tap |
| `APP_SUCCESS` | the confirmation mark, the status line, 3 next steps, no back affordance |
| `APP_SESSION_EXPIRED`, `APP_BOOT_FAILURE` | a terminal screen with copy and exactly one way out |
| `APP_RESULT` (X-Ray RU / RO) | the promoted analysis rendered, not a shell |

**Proven by mutation.** File the edit screenshot as evidence of `APP_REVIEW` and the run fails:
*"requested APP_REVIEW, the app is in APP_EDIT_SELECTOR"*.

`application_state` in the manifest now records the state the app was actually in, read from the
app — `APP_EDIT_SELECTOR (as requested)` — instead of `2 driven step(s)`, which said how hard the
harness tried rather than where it ended up.

| | |
| --- | --- |
| **MINI APP POPULATED / REVIEW / EDIT / SUCCESS STATE PROVEN** | **PASS / PASS / PASS / PASS** |
| `APP_SESSION_EXPIRED` / `APP_BOOT_FAILURE` / `APP_RESULT` | **PASS / PASS / PASS** |

#### Package titles

`Control Partner` was in the locator but missing from the list of titles the run **required**, so
a protected tier sat outside the contract while the gate reported PASS.

Two changes. The protected list is now asserted itself — all six of `Control Light`,
`Control Partner`, `CFO Control Partner`, `CFO AI Control`, `Monthly CFO Support`,
`Financial Health Check` must be in the locator, and dropping one fails the run. And coverage is
**derived from the page sources** rather than declared: every protected title that stands as its
own heading in an audited surface's HTML must have been located and measured there.

That is honest about `Control Partner`, which appears nowhere except inside `CFO Control Partner`
and is therefore correctly not required — and the day a card is added for it, it becomes required
without anyone remembering to edit a list.

Each located title is asserted painted, not clipped by its own box, **its ink inside the box
drawing it**, inside the viewport, not escaping its card, and on exactly one line at both widths —
with the line count measured over the *title's own characters*, so «Control Light · базовый
формат» wrapping after the separator on a phone is read as the design rather than a defect.

**Proven by mutation.** Drop `Control Partner` from the locator: *"the locator no longer protects
the title Control Partner"*.

| | |
| --- | --- |
| **PACKAGE TITLE CONTRACT** | **ALL APPROVED TITLES COVERED** |
| Package title failures | **0** |

#### Determinism, unchanged

Seeded `Math.random` (mulberry32, seed `20260907`), emulated `prefers-reduced-motion`, the
self-rescheduling-frame gate, `document.fonts.ready` plus a settled-geometry and painted-anchor
wait, run-A/run-B digests and the cold-run manifest comparison are all as they were. The new
probes were placed after the captures precisely so they could not disturb any of it.

---

## 3. Results

### Canonical QA

| | |
| --- | --- |
| Gates | **85 / 85 PASS** |
| Assertions | **2974** (floor raised 2966 → 2974; never lowered) |
| Assertion floors | PASS |
| Fresh / cold run, no warm-up | PASS |
| QA file mutation | **0** — the worktree is byte-identical after a full run |

The count rose because `website-contract.test.mjs` gained eight checks (99 → 107) and
`qa/assertion-baseline.json` was raised to match, exactly as `qa/run-all.mjs` instructed. No test
was weakened, no floor lowered, no file excluded.

### Visual — 27 / 27 checks

| | |
| --- | --- |
| 390px / 1440px | **PASS / PASS** |
| Clipped text (element box) | **0** |
| **Painted text clipping (Range)** | **0** |
| **Painted text outside viewport** | **0** |
| Visible text outside viewport | **0** |
| Document horizontal overflow | **0** |
| Header collision | **0** |
| CTA overflow | **0** |
| Zero-height text | **0** |
| Package title failures | **0** |
| Language control missing / wrong state / collision | **0 / 0 / 0** |
| **Mobile language switch reachable** | **PASS** |
| **Mini App states proven** | **PASS** |
| Navy/gold contract | **PASS** |
| RU/RO visual parity | **PASS** |

### Screenshot reproducibility

| | |
| --- | --- |
| Run A vs Run B, same session | **26 / 26 identical** |
| Cold run, `qa-artifacts/` deleted | **26 / 26 identical** |
| Cold run **across the commit boundary** (`d9b5465` → `91ce853`) | **26 / 26 identical** |
| **SCREENSHOT HASH DRIFT** | **0** |
| Font / paint determinism | **PASS** — all 26 `font_status = loaded`, `layout_stable = true` |
| Random seed | `20260907`, recorded on every entry |

**Two of the 26 retained images differ from the previous candidate's evidence**, and the cause was
measured rather than assumed. `ru-questionnaire-1440.png` and `ro-packages-1440.png` differ on
0.54% and 1.25% of their pixels, and **every differing pixel differs by exactly one 8-bit level in
one channel** (`28,32,31` → `28,32,32`) on flat card backgrounds. That is the dither boundary of a
subtle gradient moving because the card got shorter — Q12's answers and the Romanian package
card's next-step line both lost characters. No text moved; the other 24 images are byte-identical.

### Visual evidence manifest

`qa-evidence/v1.1-final/` — 26 PNGs, `manifest.json`, `measurements.json` (all 43 audited
surfaces), `capture-determinism.json`, `rendered-text.json`, **`state-proofs.json`**,
**`drawer-probes.json`**, `README.md`.

Every entry carries `candidate_sha`, `branch`, `capture_timestamp`, `viewport`, `surface_id`,
`language`, `application_state`, `screenshot_filename`, `sha256`, `bytes`, `random_seed`,
`reduced_motion`, `font_status`, `layout_stable`, `frozen_reschedules`, `text_clipping_count`,
`overflow_count`, `header_collision_count`, `ab_reproducible`. The run asserts all of it, including
that `candidate_sha` is the commit being audited.

**All 26 entries carry `candidate_sha = 91ce8537ef4a5237492130987f66e15166ed8d5d`.** Totals across
the retained set: text clipping **0**, overflow **0**, header collisions **0**, `ab_reproducible`
true on all 26.

### Required coverage — 26 images, nothing substituted

**390px** — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO packages,
inner page (`ru-real-estate`), thank-you, Mini App populated, Mini App review, Mini App edit, Mini
App success, X-Ray RU, X-Ray RO.

**1440px** — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO
packages, Mini App populated, Mini App review, Mini App edit, Mini App success, X-Ray RU, X-Ray RO.

All Mini App and X-Ray surfaces are driven from local fixtures through the app's own `FM_APP.set()`
and `FM_APP.goto()`, and each now proves the state it reached. The Gateway is answered by a stub
inside the page; every endpoint points at `preview.invalid`, which does not resolve. **No production
API or service was called.**

### Machine contract — frozen

| | |
| --- | --- |
| **MACHINE VALUE DRIFT vs `9f62e6f` (authorised start)** | **0** |
| **MACHINE VALUE DRIFT vs `d9b5465` (audited base)** | **0** |
| Files compared | **269 shipped** (HTML / JS / MJS / JSON) |
| Distinct contract tokens compared | **6061**, as multisets, per file |
| Scoring | UNCHANGED |
| CRM | UNCHANGED |
| `callback_data` | UNCHANGED |
| Workflow routing | UNCHANGED |
| CLIENT_READY | UNCHANGED |
| HOT / WARM / COLD | UNCHANGED |
| Lead identity | NO REGRESSION |
| Package pricing | UNCHANGED (750 / 1 500 / 3 500 €, 1 500 €, 5 000 €) |
| Database schemas | UNCHANGED |

Form `value`, field `name`, `id`, analytics and CTA `data-*` tokens, `href`, `callback_data`,
JSON-LD `@id` / `url` / `@type`, prices, the HOT/WARM/COLD and CLIENT_READY tokens, the `APP_*`
state enum and CRM stage strings were extracted from every shipped file at both revisions and
compared as multisets. `qa/`, `scripts/`, `docs/` and `.github/` are excluded because they are not
served — and this run deliberately added state names and regex fragments to two of them.

### Previous P1 regression battery — re-run, still green

| | |
| --- | --- |
| RO origin + Telegram RU → RO | PASS |
| RO origin + `ro-MD` → RO | PASS |
| RU origin + Telegram RO → RU | PASS |
| No origin + `ro-MD` → RO | PASS |
| No origin + RU → RU | PASS |
| Non-owner Concierge | PASS |
| **OWNER PRIVILEGE LEAK** | **0** |
| Copied Treasury JSON-LD | **0** |
| Unsupported FAQ claims | **0** |
| JSON-LD parse errors | **0** |
| Partially translated package titles | **0** |
| `CFO AI Control` corruption | **0** |
| Real Estate page identity, RU / RO | PASS / PASS |

---

## 4. Status

| | |
| --- | --- |
| **P0 remaining** | **0** |
| **P1 remaining** | **0** |
| P2 remaining | 0 |
| P3 remaining | 4 (deferred, listed below) |
| Worktree | clean |
| `HEAD == origin/release/v1.1-final-integration` | yes |
| **PRODUCTION MUTATED** | **NO** |
| **DEPLOYED** | **NO** |
| **MERGED TO MAIN** | **NO** |

### POST_GO — deferred, not release-blocking

1. **Secondary bars have no horizontal gutter at 390px.** `.q-bar__row { padding: 16px 0 }` and
   `.doc-bar__row { padding: 14px 0 }` use the shorthand, which zeroes the `padding-inline` their
   `.container` sets. **Both rules are byte-identical to production `main` and are live today.**
   Nothing is clipped, nothing overflows, no collision.
2. **The same language-defect classes survive on Tier 2/3 specialist pages**, which were outside
   the authorised primary-journey scope. The repaired vocabulary is available to apply.
3. **A developer comment in `ro/questionnaire.html`** was hit by the global substitution. Invisible
   to customers, inside `<!-- -->`. The new gates read painted copy with comments stripped, so this
   is documented rather than silently matched.
4. **The Romanian home page omits the "write to the bot directly" ghost CTA** that the Russian one
   carries in three places. Found by the RU/RO alignment. It is a content difference, not a
   language defect, and adding a call to action is a product decision outside this run's mandate.

---

## 5. What a re-auditor should re-run

```bash
git rev-parse HEAD                              # the release candidate: this sealing commit
git status --porcelain                          # EMPTY
git diff 91ce8537ef4a5237492130987f66e15166ed8d5d HEAD -- . ':!qa-evidence' ':!docs'   # EMPTY

node qa/run-all.mjs                             # 85/85, 2974 assertions, floors PASS
git status --porcelain                          # still EMPTY — canonical QA mutates nothing

rm -rf qa-artifacts
node qa/visual-evidence.mjs --keep qa-evidence/v1.1-final     # 27/27, hash drift 0
```

**One expected diff, and only one.** Re-running with `--keep` rewrites `manifest.json`, because
`capture_timestamp` and `candidate_sha` are required evidence and are volatile by construction —
and after the sealing commit, `candidate_sha` becomes the sealing commit rather than `91ce853`,
which is correct: the tree is identical, so the screenshots are evidence of both. **No `sha256`
changes and no PNG changes**; that is what the hash-drift gate asserts before writing. Confirm:

```bash
git diff qa-evidence/v1.1-final/manifest.json \
  | grep -E '^[+-]' | grep -v '^[+-][+-]' \
  | grep -vE 'capture_timestamp|candidate_sha|generated_at'    # must print nothing
```

Then `git checkout -- qa-evidence/v1.1-final/manifest.json` to return to a clean tree.

To disprove the results independently, without reading a single PNG:

* `qa-evidence/v1.1-final/rendered-text.json` — the copy every audited surface actually painted.
* `qa-evidence/v1.1-final/state-proofs.json` — which Mini App screen each shot is evidence of.
* `qa-evidence/v1.1-final/drawer-probes.json` — what the burger did, before and after, per surface.

And to check that the gates are gates rather than decoration, revert any of the six copy files to
`d9b5465` and re-run `node qa/website-contract.test.mjs`: all eight checks fail, 37 counted
findings between the seven that count.

---

**RELEASE STATUS: READY FOR ONE FINAL INDEPENDENT CODEX AUDIT.**

Production deployment still requires owner authorisation. Nothing in this run deployed, merged,
activated, published or mutated any production system.
