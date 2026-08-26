# FINMENTOR — Romanian customer-facing language review

Date: 2026-08-26 (night shift of 2026-08-25)
Scope: repository-only. No production, n8n, Sheets or DNS access.
Reviewer: automated pass, **not** a substitute for a native Romanian reviewer.

---

## 1. What was reviewed

| Surface | Extent |
|---|---|
| `ro/*.html` | 37 pages |
| `ro/runtime-strings.ro.json` | 132 RU→RO runtime translations |
| `i18n-ro.js`, `lang.js` | RO runtime string plumbing |
| RO metadata | `<title>`, description, Open Graph, JSON-LD on all 37 pages |
| RO privacy / terms | customer-facing legal copy |
| Mini-scan, questionnaire | visible labels, CTAs, result text, validation/error/success messages |

Method: every Cyrillic occurrence in the RO surface was mechanically classified as
`VISIBLE_TO_RO_USER` or `HIDDEN_CANONICAL_DATA` **before** any edit, because the two look
identical in a grep and only one of them is safe to touch.

---

## 2. Headline result

The Romanian is **better than the "machine-translated" label suggests**. Terminology is
consistent with the static RO pages, diacritics are correct throughout, and punctuation is
clean. Two genuine defects were found and fixed; both were structural rather than stylistic.

| Check | Result |
|---|---|
| Wrong-cedilla diacritics (`ş`/`ţ` instead of `ș`/`ț`) | **0** — all 174 are the correct comma-below forms |
| Double spaces / space before punctuation | **0** |
| Cyrillic in RO `<title>` / description / Open Graph | **0** |
| RO pages missing title or description | **0** |
| RO pages not declaring `lang="ro"` | **0** |
| Cyrillic visible in RO page body text | **0** |

---

## 3. Category A — fixed

### A1 · `ro/index.html` — the Romanian page described itself in Russian

The JSON-LD `knowsAbout` array was an untranslated copy of the Russian page's array. Every
crawler reading the Romanian page saw its expertise topics declared in Russian, while the
`jobTitle` and `description` beside them were already Romanian.

```diff
-  "Внешний CFO", "Финансовое управление", "Управленческий учёт",
-  "Управленческая отчётность", "Казначейство", "Cash Flow", "KPI",
-  "Финансовое моделирование", "Power BI", "AI Automation", "Инвестиционный анализ"
+  "CFO extern", "Management financiar", "Contabilitate managerială",
+  "Raportare managerială", "Trezorerie", "Cash Flow", "KPI",
+  "Modelare financiară", "Power BI", "AI Automation", "Analiză investițională"
```

Terms were not invented. Five of the seven translated terms are **already used on the RO
site** — `CFO extern` (24×), `trezorerie` (68×), `raportare managerială` (6×),
`management financiar` (6×), `contabilitate managerială` (4×) — and `investițional` appears
in four inflected forms. `Modelare financiară` is the only term with no prior use on the
site; it is the standard Romanian equivalent and unambiguous. The four language-neutral
entries (`Cash Flow`, `KPI`, `Power BI`, `AI Automation`) were left exactly as they were,
matching how the RO pages already treat English financial terms.

### A2 · `ro/working-capital-scan.html` — a Russian word order calque on every result

The risk band was built level-first:

```js
risk + ' risc · zonă preliminară de atenție'      // "Scăzut risc · …"
```

`Низкий риск` is correct Russian. Romanian puts the adjective **after** the noun, so this
rendered **"Scăzut risc"**, **"Ridicat risc"** and **"Critic risc"** to every Romanian
visitor who completed the mini-scan — on the single most prominent line of the result.

```js
'Risc ' + risk.toLowerCase() + ' · zonă preliminară de atenție'   // "Risc scăzut · …"
```

All four levels verified: `Risc scăzut`, `Risc mediu`, `Risc ridicat`, `Risc critic`.
`ro/runtime-strings.ro.json` was updated so the recorded translation matches what the page
now emits.

This is the only defect found that was visible to a customer in the page body.

---

## 4. Category B — recommended, deliberately NOT applied

### B1 · `diagnoză` vs `diagnostic` (2 strings)

`ro/working-capital-scan.html`, the mixed-risk profile:

```
title:     "Riscuri mixte — este necesară o diagnoză CFO"
diagnosis: "… ci de o diagnoză a întregului sistem financiar."
```

The site uses **`diagnostic`** 146 times against 9 for the `diagnoz` root, so these two are
terminologically inconsistent with everything around them, and `diagnostic financiar` is the
usual business collocation.

**Not applied, for a reason worth stating.** The `diagnoz` root is *not* foreign to this
site: all nine occurrences are `autodiagnoză`, used deliberately and consistently for the
self-service scan, including in JSON-LD descriptions. `diagnoză` is not ungrammatical, and
the change is not mechanical — it flips grammatical gender and drags agreement with it:

```
este necesară o diagnoză CFO        →  este necesar un diagnostic CFO
ci de o diagnoză a întregului …     →  ci de un diagnostic al întregului …
```

That is a brand-voice decision about customer-facing advisory copy, which section 6 reserves
for a native reviewer. The rewrite above is ready to apply verbatim if they agree.

### B2 · `Preliminar se observă` repetition

Opens five of the six risk profiles. Defensible as a deliberate parallel structure; a native
reviewer may prefer to vary it. No correctness issue.

---

## 5. Category C — left alone by policy

| Item | Why untouched |
|---|---|
| `Limbă · Язык` in the RO mobile menu | **Not a defect.** The RU page mirrors it as `Язык · Limbă` — a deliberate bilingual switcher, own language first. Checked before assuming |
| `ro/privacy.html`, `ro/terms.html` Russian `<!-- NB -->` comments | Developer notes saying a lawyer must review before publication. Not rendered, and their content is a live instruction that should stay |
| Russian section comments in `ro/questionnaire.html` (`<!-- Блок 1 -->`) | Not rendered. Structural markers shared with the RU questionnaire; renaming them helps nobody and desynchronises the two files |
| Legal wording in privacy / terms | Requires a lawyer, not a translator |

---

## 6. Taxonomy preservation — evidence

**Nothing in the canonical CRM taxonomy was altered.** This was the primary risk in the task
and it was treated as a hard boundary.

| Protected surface | Count | Status |
|---|---|---|
| `value="…"` Russian attributes in `ro/questionnaire.html` | 144 | untouched |
| `industry:` / `intake:` map values feeding deep-link prefill | 15 | untouched |
| `docHas()` substring matchers (`Дебиторская`, `Кредиторская`) | 2 | untouched |
| Canonical `да` / `нет` values written to `has_ar` / `has_ap` | 2 | untouched |
| `setRadioByValue` / `setCheckboxByValue` lookup strings | all | untouched |
| Regex matchers over Russian answer text (scoring) | all | untouched |

Both edits were made outside these surfaces entirely: one in a JSON-LD metadata array, one in
a display-only string concatenation. Neither touches scoring, `data-cat`, payload shape,
consent semantics, analytics event names, or routes.

Evidence that the boundary held: the pre-existing parity gate — which fails if a Cyrillic
display literal appears, and separately fails if any `industry:`/`intake:` value stops
matching an HTML `value` attribute — still passes unchanged.

---

## 7. Regression coverage added

Two guards, so neither defect can return silently:

| Check | Fails when |
|---|---|
| `the RO risk band reads as Romanian, not as a Russian word order calque` | the level-first concatenation reappears |
| `RO structured data does not describe the page in Russian` | Cyrillic returns to the RO `knowsAbout` array |

Both were mutation-tested: reverting A2 fails the first check with the message
`renders "Scăzut risc"`. Website contract gate 73 → **75**; suite total 344 → **346**.

---

## 8. Still requires a native Romanian speaker — YES

This pass was mechanical and conservative. It can prove that diacritics are correct, that no
Russian is visible, and that a word order is a calque. It cannot judge register, warmth, or
whether the copy sounds like a Moldovan CFO talking to a business owner.

Specifically outstanding:

1. **B1** — the `diagnoză` / `diagnostic` decision, rewrite prepared.
2. **Register and politeness consistency** across ~132 result strings. The copy uses the
   plural-polite imperative (`Construiți`, `Calculați`, `Verificați`) consistently, which
   reads correctly, but consistency is not the same as the right voice.
3. **`ro/privacy.html` and `ro/terms.html`** — still carry a note saying they are templates
   pending legal review. That note is accurate and the review has not happened.
4. **Financial terminology sign-off**: `creanțe`, `datorii către furnizori`, `capital de
   lucru`, `flux de numerar` / `Cash Flow`, `decalaj de numerar` / `cash gap`. Usage is
   internally consistent and matches the static pages; a practitioner should confirm it
   matches how Moldovan finance professionals actually speak.

The honest summary: the Romanian is safe to keep serving and is a clear improvement over
serving Russian to Romanian visitors. It is not yet signed off as brand-quality copy.
