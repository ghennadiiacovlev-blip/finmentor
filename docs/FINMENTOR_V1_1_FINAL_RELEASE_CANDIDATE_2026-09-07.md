# FINMENTOR v1.1 — FINAL RELEASE CANDIDATE

**READY FOR INDEPENDENT RELEASE RE-AUDIT**

This record is written by the engineer who did the work. It is **not** an independent approval,
and it does not claim one. Nothing has been deployed, merged or activated.

---

## 1. Identity

| | |
| --- | --- |
| Branch | `release/v1.1-final-integration` |
| Final source SHA | `7f0574182cf78227aa58c148549105d1b98e6566` |
| Branch HEAD at sealing | `1908038343ddab9782cacb00fbb6dc24c257cf4e` (this record; documentation only) |
| Parent (authorised start) | `9f62e6f542a361163358aaa96b1d8ba1f2187dd6` |
| Production `main` baseline | `b57ac259847ca77e249ec133e41bcb6435f8e031` |
| `origin/main` at sealing | `b57ac259847ca77e249ec133e41bcb6435f8e031` — **unchanged during this run** |

**On the two SHAs.** The visual evidence records `candidate_sha = 7f05741`, the last commit that
changes anything a browser renders. `65750ac` is the commit that stores that evidence, and
`git diff 7f05741 65750ac -- . ':!qa-evidence'` is **empty** — it adds the manifest and the
rendered-copy file and touches nothing else. The evidence is therefore evidence of the source tree
at HEAD. The release-record commit that carries this file adds documentation only, by the same
rule.

### Commits

```
65750ac evidence(release): refresh manifest to the audited commit, retain rendered copy
7f05741 test(qa): prove the repaired copy reaches the customer's screen, and retain it
1df2f1c fix(copy): three more Romanian sentences of the class the audit already closed
d020048 evidence(release): reproducible v1.1 visual evidence, full required set
e33f636 fix(qa): make release visual evidence deterministic, and close the defects it found
0a5f62b test(copy): gate the five grammar defect classes closed in this release
a7f2a1a fix(copy): repair final primary journey RU/RO grammar
```

### Files changed (10, excluding evidence)

```
index.html                   |  20 +-      questionnaire.html           |  10 +-
monthly-cfo-support.html     |  18 +-      ro/index.html                |  34 +-
ro/monthly-cfo-support.html  |  18 +-      ro/questionnaire.html        |  20 +-
lang.css                     |  14 +-      qa/assertion-baseline.json   |   4 +-
qa/visual-evidence.mjs       | 461 ++-      qa/website-contract.test.mjs | 124 +-
```

`n8n/`, `gateway/`, `db/`, `app-premium/`, `app/`, `analytics.js`, `lead-transport.js`, `main.js`,
`assistant.js` and `i18n-ro.js` are **byte-identical to `9f62e6f`**. No production workflow, no
schema, no credential and no shipped application script was touched.

---

## 2. The two open release classes, closed

### P1-A — primary-journey RU/RO sentence corruption

Closed by reading the eight primary-journey files sentence by sentence, not by a replacement
script. 50 repairs in six files, plus 13 in the metadata that mirrors them.

**Russian.** The known defect — «На **Первичный финансовый разбор** обсуждаем» → «На **первичном
финансовом разборе** обсуждаем» — and every other instance of the classes around it: a list opened
after a colon or semicolon that kept the capital its English term used to carry while the rest of
the list is lowercase; a noun pile where the parallel «какие … какие —» belongs; «ключевых
показателей … ключевых показателей» stacked twice; two cards missing the comma before «но»; and
the English nouns a founder without English cannot read — `Aging`, `Cash gap`, `cash flow`,
`summary`, `deliverables`, `Power BI monitoring`, `Make / n8n сценарии`, `Telegram / email alerts`.

**Romanian.** All six named defects, repaired in their own context rather than by pasting the
suggested forms: «La **Discuție financiară inițială**» → «La **discuția financiară inițială**»;
«Profit există, dar bani nu» → «Există profit, dar nu sunt bani»; «Nu ajunge flux de numerar» →
«Fluxul de numerar nu este suficient»; «trebuie pusă ordinea» → «trebuie pusă ordine»; «Planific
pentru perspectivă» → «Planific pe termen lung»; «inteligența artificială dvs.» → «inteligența
artificială pe care o folosiți»; «Inteligență artificială (AI) și automatizarea» → «Inteligența
artificială (AI) și automatizarea».

The adversarial pass then found **three more sentences of the same class** that the first gate had
missed, and the reason it missed them is recorded: the rule ended in `\b`, and «există» ends in ă,
which is not an ASCII word character, so that `\b` could never match and the rule was decoration.
With it corrected: «Contabilitate există» → «Contabilitatea există», «Comenzi există» → «Există
comenzi», «Bani „există”» → «Banii „există”».

**Machine values were not touched.** Every corrected Romanian radio and checkbox label sits beside
a `value="…"` that is still the Russian CRM string, deliberately.

### P1-B — release-grade visual evidence determinism and completeness

The previous evidence measured clean and could not be reproduced — identical geometry, different
pixels. Root cause confirmed: the hero constellation lays its particles out with `Math.random()`
and then advances them every frame.

1. **Seeded random.** A mulberry32 PRNG seeded from `20260907` is installed by
   `Page.addScriptToEvaluateOnNewDocument` before the document runs. The seed is recorded on every
   evidence entry. Production keeps the real `Math.random`.
2. **Reduced motion.** A seed fixes where particles start, not that they move. `main.js` already
   gates the canvases, the intro overlay, the cursor loop, the reveal pass and the count-up numbers
   on `prefers-reduced-motion`, so the run emulates that mode — the site's own switch, a mode real
   customers browse in, zero production change. It also improves the evidence: the counters snap to
   their final values instead of being caught mid-tween.
3. **A self-rescheduling-frame gate** behind both, as insurance against a future decorative loop
   that forgets to honour reduced motion. It has not had to act (`frozen_reschedules = 0`).

No customer UI is hidden and no application state is altered.

---

## 3. Results

### Canonical QA

| | |
| --- | --- |
| Gates | **85 / 85 PASS** |
| Assertions | **2966** (floor 2961; the floor was **raised**, never lowered) |
| Assertion floors | PASS |
| Fresh / cold run, no warm-up | PASS |
| QA file mutation | **0** — the worktree is byte-identical after a full run |

The assertion count rose because `website-contract.test.mjs` gained six checks (94 → 99) and
`qa/assertion-baseline.json` was raised to match, exactly as `qa/run-all.mjs` instructed. No test
was weakened, no floor lowered, no file excluded.

### Language

| | |
| --- | --- |
| RU primary journey, natural language | **PASS** |
| RO primary journey, natural language | **PASS** |
| RU obvious grammar defects | **0** |
| RO obvious grammar defects | **0** |

Six new gates hold these closed, each naming the *shape* of the damage rather than the strings
found. Every one was run against the pre-fix tree at `9f62e6f`, where all six fail with 47
findings; a gate that cannot fail is not a gate. The bare-noun rule is additionally verified over
eight discrimination cases — it flags all three broken forms and passes all three corrections plus
«Nu există o sursă» and «Profitul există pe hârtie».

The corrected copy is proven **on the painted page**, not only in source: 27 corrected strings must
appear in the rendered text of the six primary-journey surfaces and 15 defect strings must appear
on no surface in either language. Verified by reverting `ro/index.html` to `9f62e6f`, where that
gate fails with 28 findings.

### Visual — 22 / 22 checks

| | |
| --- | --- |
| 390px | **PASS** |
| 1440px | **PASS** |
| Clipped text | **0** |
| Visible text outside viewport | **0** |
| Document horizontal overflow | **0** |
| Header collision | **0** |
| CTA overflow | **0** |
| Zero-height text | **0** |
| Package title failures | **0** |
| Language control missing / wrong state / collision | **0 / 0 / 0** |
| Navy/gold contract | **PASS** |
| RU/RO visual parity | **PASS** |

### Screenshot reproducibility

| | |
| --- | --- |
| Run A vs Run B, same session | **26 / 26 identical** |
| Cold run, `qa-artifacts/` deleted | **26 / 26 identical** |
| Cold runs performed | **8**, across 4 source commits |
| **SCREENSHOT HASH DRIFT** | **0** |
| Font / paint determinism | **PASS** — all 26 `font_status = loaded`, `layout_stable = true` |
| Random seed | `20260907`, recorded on every entry |

### Visual evidence manifest

`qa-evidence/v1.1-final/` — 26 PNGs, `manifest.json`, `measurements.json` (all 43 audited
surfaces), `capture-determinism.json`, `rendered-text.json`, `README.md`.

Every entry carries `candidate_sha`, `branch`, `capture_timestamp`, `viewport`, `surface_id`,
`language`, `application_state`, `screenshot_filename`, `sha256`, `bytes`, `random_seed`,
`reduced_motion`, `font_status`, `layout_stable`, `frozen_reschedules`, `text_clipping_count`,
`overflow_count`, `header_collision_count`, `ab_reproducible`. The run asserts all of it, including
that `candidate_sha` is the commit being audited — a screenshot carrying an earlier SHA is not
accepted as proof of this candidate.

Totals across the retained set: text clipping **0**, overflow **0**, header collisions **0**.

### Required coverage — 26 images, nothing substituted

**390px** — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO packages,
inner page (`ru-real-estate`), thank-you, Mini App populated, Mini App review, Mini App edit, Mini
App success, X-Ray RU, X-Ray RO.

**1440px** — RU homepage, RO homepage, RU questionnaire, RO questionnaire, RU packages, RO
packages, Mini App populated, Mini App review, Mini App edit, Mini App success, X-Ray RU, X-Ray RO.

Retained set grew from 19 to 26. The Romanian X-Ray result, the Mini App edit and success screens
and the Romanian questionnaire and packages at 1440 were being rendered but never kept.

| | |
| --- | --- |
| Mini App populated / review / edit / success | **PASS / PASS / PASS / PASS** |
| X-Ray RU / X-Ray RO | **PASS / PASS** |

All Mini App and X-Ray surfaces are driven from local fixtures through the app's own `FM_APP.set()`
and `FM_APP.goto()`. The Gateway is answered by a stub inside the page; every endpoint points at
`preview.invalid`, which does not resolve. **No production API or service was called.**

### Machine contract

| | |
| --- | --- |
| **MACHINE VALUE DRIFT** | **0** — 272 shipped files compared against `9f62e6f` |
| Scoring | UNCHANGED |
| CRM | UNCHANGED |
| callback_data | UNCHANGED |
| Workflow routing | UNCHANGED |
| CLIENT_READY | UNCHANGED |
| HOT / WARM / COLD | UNCHANGED |
| Lead identity | NO REGRESSION |
| Package pricing | UNCHANGED (750 / 1 500 / 3 500 €, 1 500 €, 5 000 €) |
| Database schemas | UNCHANGED |

Form `value`, field `name`, `id`, analytics and CTA `data-*` tokens, `href`, `callback_data`,
JSON-LD `@id` / `url` / `@type`, prices and the HOT/WARM/COLD tokens were extracted from every
shipped HTML, JS, MJS and JSON file at `9f62e6f` and at HEAD and compared as multisets.

### Previous P1 regression battery

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

## 4. Defects found and fixed during this run

Beyond the two named classes, the new gates found two defects that had never been asserted before.

**LANGUAGE CONTROL MISSING at 390px on the X-Ray questionnaire, both editions.** `lang.css` did
`display: none` on `.q-bar .lang` and `.legal-bar .lang` below 640px. Unlike `.header`, neither bar
carries a burger and neither opens a drawer, so the rule did not move the control anywhere — it
removed it. A Russian customer on the page the entire funnel points at had no way to reach the
Romanian edition, and vice versa. The pill is kept and compacted to fit the row. Now asserted:
painted or drawer-reachable, both codes offered, the page's own language current and only that one,
no collision.

**Package titles were asserted by class name, which proved nothing.** The home page prices them in
`.package__name` cards; the monthly page heads each tier with an `h2`. They are now located by
their own text and asserted painted, unclipped, inside the viewport, not escaping the card, and on
exactly one line at both widths — with the line count measured over the *title's own characters*,
so «Control Light · базовый формат» wrapping after the separator on a phone is correctly read as
the design rather than a defect.

---

## 5. Status

| | |
| --- | --- |
| **P0 remaining** | **0** |
| **P1 remaining** | **0** |
| P2 remaining | 0 |
| P3 remaining | 3 (deferred, listed below) |
| Autonomous correction cycles used | 2 of 3 |
| Worktree | clean |
| `HEAD == origin/release/v1.1-final-integration` | yes |
| **PRODUCTION MUTATED** | **NO** |
| **DEPLOYED** | **NO** |
| **MERGED TO MAIN** | **NO** |

### POST_GO — deferred, not release-blocking

1. **Secondary bars have no horizontal gutter at 390px.** `.q-bar__row { padding: 16px 0 }` and
   `.doc-bar__row { padding: 14px 0 }` use the shorthand, which zeroes the `padding-inline` their
   `.container` sets, so the logo sits flush to the viewport edge on the questionnaire, thank-you
   and all doc-bar pages. **Both rules are byte-identical to production `main` (`b57ac25`) and are
   live today.** Nothing is clipped, nothing overflows, no collision. Fixing it changes the layout
   of every doc-bar page on the site, which is a design decision, not release repair.
2. **The same defect class survives on Tier 2/3 specialist pages.** «Profit există, bani nu» is
   still on eight Romanian specialist pages, and `Aging` / `Cash gap` / `deliverables` on six
   pages. These were outside the authorised primary-journey scope and outside the files touched
   here. The repaired vocabulary is available to apply.
3. **A developer comment in `ro/questionnaire.html` was hit by the global substitution** — the
   AI-agent schema block is Russian prose containing «indicatori-cheie» and «IA agent». Invisible
   to customers, inside `<!-- -->`. Cosmetic.

Also noted, not deferred as a defect: `Discovery Call` is untranslated in the monthly page header
and across many specialist pages, with its own `data-ga="click_discovery_call"` event and section
heading. It reads as an owner-approved journey-step name, so it was left alone; renaming it would
be a product decision.

---

## 6. What a re-auditor should re-run

```bash
git rev-parse HEAD                              # worktree clean
node qa/run-all.mjs                             # 85/85, 2966 assertions, floors PASS
git status --porcelain                          # EMPTY — canonical QA mutates nothing
rm -rf qa-artifacts
node qa/visual-evidence.mjs --keep qa-evidence/v1.1-final   # 22/22, hash drift 0
git diff --stat qa-evidence/v1.1-final          # manifest.json only, volatile fields only
```

The last command re-renders every surface and compares each retained image against the digest
already committed in `manifest.json`. If any pixel moved, it fails and names the file.

**One expected diff, and only one.** Re-running with `--keep` rewrites `manifest.json`, because
`capture_timestamp` and `candidate_sha` are required evidence and are volatile by construction —
26 timestamps and 26 SHAs. **No `sha256` changes and no PNG changes**; that is exactly what the
hash-drift gate asserts before writing. Confirm with:

```bash
git diff qa-evidence/v1.1-final/manifest.json \
  | grep -E '^[+-]' | grep -v '^[+-][+-]' \
  | grep -vE 'capture_timestamp|candidate_sha|generated_at'    # must print nothing
```

Then `git checkout -- qa-evidence/v1.1-final/manifest.json` to return to a clean tree. The PNGs
themselves are never rewritten with different bytes — that is the whole claim.

To disprove the language result independently, `qa-evidence/v1.1-final/rendered-text.json` holds
the copy every audited surface actually painted — greppable, no PNG reading required.

---

**RELEASE STATUS: READY FOR INDEPENDENT RELEASE RE-AUDIT.**

Production deployment still requires owner authorisation. Nothing in this run deployed, merged,
activated, published or mutated any production system.
