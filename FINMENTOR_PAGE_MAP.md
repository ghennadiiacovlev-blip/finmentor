# FINMENTOR — HOMEPAGE PAGE MAP
## STEP 1 of the production pass · one system, decided before any code

**Baseline:** `f536413` (renders identically to code checkpoint `a2c4271`)
**Rule applied throughout:** message → composition → hierarchy → visual anchor → *then* background.

---

## 0. The three visual registers

The page uses exactly three treatments. Nothing else is invented per section.

| Register | When it is used | Surface |
|---|---|---|
| **A — Image-led** | The section's claim is about scale, assets or capital reality. The photograph *is* the argument. | Photograph + navy scrim |
| **B — Navy structural** | The section defines a framework, a decision or a commitment. Navy carries institutional weight. | `--navy-900` |
| **C — Paper editorial** | The section is for reading, comparison or diagnosis. Warm ivory aids comprehension. | `--ivory-200` / `--ivory-100` |

Gold appears at most **once per viewport**, as: a hairline, an index number, one emphasised
word, an active state, or one CTA. Never a surface.

---

## 1. Section-by-section map

| # | Section | Purpose | Composition | Register + rationale | Visual anchor | Density |
|---|---|---|---|---|---|---|
| 01 | **Hero** `#top` | Establish authority in 5s | Copy left 42% / architecture right 58% | **A** — scale must be *shown*, not claimed | PHOTO 01 | Very low — 6 elements |
| 02 | **Финансовый хаос** `#chaos` | Diagnosis: name the owner's reality | Claim + verdict left / 01–08 index right | **C** — eight sentences of reading | Numbered index | Medium |
| 03 | **Прибыль ≠ деньги** `#profit-question` | Pivot from accounting result to capital | Statement left / vertical capital spine right | **B** — conceptual, strategic | Capital flow spine | Low |
| 04 | **Три контура** `#owner-control` | Explain the control architecture | Three indexed columns, thin rules | **C** — structural explanation, comparative reading | 01/02/03 numerals | Medium |
| 05 | **Прибыль и капитал** `#profit-capital` | Contrast growth-without-cash vs control | Two-column comparison | **C** — a comparison must be read side by side | Hairline compare table | Medium |
| 06 | **Отличие** `#difference` | Position against accounting / BI / consulting | Three editorial rows | **C** — continues the reading block | Row rules | Low |
| 07 | **Бизнес-модели** `#industries` | Prove FINMENTOR understands different economics | PHOTO 03 left / indexed 01–06 list right | **A** — real assets need a real asset | PHOTO 03 | Low visible, full detail in disclosure |
| 08 | **Управление капиталом** `#capital-allocation` | Signature moment: beyond reporting | Question + allocation framework over image | **A** — capital discipline made physical | PHOTO 02 | Low |
| 09 | **Логика CFO / Карта капитала** `#capital-logic` | Define management capital | Definition + capital map | **B** — continues the capital block | Map structure | Medium |
| 10 | **Для кого** `#audience` | Qualify the reader | Two-column checklist | **C** — self-identification is reading | Check rules | Medium |
| 11 | **Как работаем** `#steps` | Process, 01–05 | Indexed timeline, thin line | **C** — sequence is read | Numbered sequence | Low |
| 12 | **Форматы работы** `#solutions` | Advisory mandates, not plans | Indexed mandate rows 01–04 | **C** — price/scope comparison | Index + flagship rule | Medium |
| 13 | **Решения** `#modules` | Solution groups | Five editorial rows | **B** — separates the two reading blocks | Row index | Low |
| 14 | **Retail Margin Engine** `#flagship` | Depth proof | Text + restrained figure | **B** | Existing | Medium |
| 15 | **ИИ-экономика** `#ai-economics-teaser` | Technology *inside* financial logic | Text-led, subordinate | **B** — never AI-visual language | Typography only | Low |
| 16 | **Практика** `#cases` | Anonymous scenarios | Situation → Control → Decision, ×3 | **C** — narrative reading | Three-step rule | Medium |
| 17 | **Кто стоит за FINMENTOR** `#about` | Founder credibility, text-only | Compact institutional block | **C** | Typography | Low |
| 18 | **Мини-скан** `#mini-scan` | Low-friction entry | Single band | **B** | CTA | Very low |
| 19 | **Материалы** `#knowledge` | Insights library | Editorial list | **C** — a library is read | List rules | Low |
| 20 | **После** `#after` | What changes | Short editorial | **C** | Typography | Low |
| 21 | **Final CTA** `#consult` | Convert | Headline + form/CTA | **B** — commitment | Navy field | Low |
| 22 | **Footer** `#contacts` | Navigate, legal | Columns | **B** | — | Medium |

**Register sequence (emergent, not designed):**
`A · C C · B · C C C · A A B · C C C · B B B · C C C · B · B`

That is not an alternation formula. It is three reading blocks (02–06, 10–12, 16–20), two
capital/asset blocks (07–09), and navy at the three commitment points (03, 21, 22).

---

## 2. Photography contracts

Final assets are supplied separately. Slots, geometry and crops are frozen now so the swap
is a file replacement.

| Slot | Path contract | Used by | Desktop | Mobile | Focal |
|---|---|---|---|---|---|
| PHOTO 01 | `images/editorial/hero-capital.*` | §01 Hero | 2400×1500+ | 4:5 | right-of-centre mass, left negative space |
| PHOTO 02 | `images/editorial/capital-decision.*` | §08 Capital management | 1920×1280 (3:2) | 3:2 | centre-left |
| PHOTO 03 | `images/editorial/real-assets.*` | §07 Business models | 1920×2400 (4:5) | 3:2 | lower-centre |

**Renames required** (current → contract):
`decision-environment.svg` → `capital-decision.svg`
`real-estate-investment.svg` → `real-assets.svg`

Responsive crops declared for **1440+ / 1024 / 768 / 390**. `<picture>` carries the media
breakpoints now; `<source type="image/avif|webp">` lines are added when rasters exist.
Preload applies to PHOTO 01 only.

All three remain **temporary vector placeholders**, clearly marked in-file and in the report.
Compositions are built to the photographic geometry, never to the placeholder's drawing.

---

## 3. Card audit (§28) — decision per component

| Component | Verdict |
|---|---|
| `chaos-card` ×8 | **Not a card** → indexed rows (done at C) |
| `industry-card` ×6 | **Not a card** → indexed rows + disclosure |
| `package` ×4 (Форматы работы) | **Not a card** → indexed mandate rows; class hooks retained (QA contract) |
| `step-card` ×3 | **Not a card** → indexed timeline |
| `result-card` ×3 (Практика) | **Not a card** → Situation→Control→Decision rows |
| `material-card` ×4 | **Not a card** → editorial list |
| `sample-card` ×4 | **Keep as bounded object** — each is a discrete artefact sample |
| `capital-map` | Keep — a map is a bounded object |

Target: 28 rendered cards → **4**.

---

## 4. Content-preservation decisions (§35 freeze)

**§18 asks that full methodology leave the homepage.** Three of six business models
(e-commerce, distribution, project manufacturing) have **no dedicated page** — their CTAs go
to the questionnaire. Deleting their copy would remove it from the site entirely, which is an
SEO change the freeze forbids.

**Resolution:** each industry shows one concise control line; the existing methodology moves
into a native `<details>` disclosure, closed by default. The text stays in the DOM and
indexable, the homepage shows one line, and closed `<details>` content is correctly skipped by
the `ZERO-HEIGHT TEXT` gate (verified against `checkVisibility`). Recorded as **WATCH-A**.

**Copy under QA contract that must survive verbatim:** all strings asserted by
`commercial-polish.test.mjs`, `premium-typography.test.mjs`, `editorial-production.test.mjs`.
Structural hooks that must survive: `class="packages__expert"`, `package package--flagship`,
`class="packages" id="solutions"`, `.package__term` grid CSS, narrative order
asset-logic < `#capital-logic` < `#audience` < `#solutions`.

**New copy introduced** (specified by the master direction, no new claims):
- §03 flow labels RU: ПРИБЫЛЬ / ДЕНЬГИ / ОБОРОТНЫЙ КАПИТАЛ / КАПИТАЛ (+ RO equivalents)
- §03 closing: «ПРИБЫЛЬ ПОКАЗЫВАЕТ РЕЗУЛЬТАТ. КАПИТАЛ ПОКАЗЫВАЕТ, ЧТО ДЕЛАТЬ ДАЛЬШЕ.»
- §08 capital framework stages: Источник → Размещение → Отдача → Риск → Высвобождение → Перераспределение

No metric, client count, ROI or credential is invented anywhere.

---

## 5. Coherence check against the master direction (STEP 2)

| Master rule | Map compliance |
|---|---|
| §3 no colour formula | Register follows function; sequence is emergent |
| §4 gold = precision | One gold event per viewport, never a surface |
| §5 Manrope, no serif | Already done at C; applied page-wide here |
| §6 max 3 photos | Exactly 3, each structural |
| §10 intro untouched | Not in scope; no constellation in content |
| §11 header | C direction preserved |
| §12 hero | C composition kept, PHOTO 01 wired |
| §16 pillars not cards | Indexed columns |
| §22 AI subordinate | Register B, typography only |
| §23 no founder photo | Text-only block |
| §28 card audit | 28 → 4 |
| §31 every viewport anchored | Each row above names an anchor |
| §35 functional freeze | No route, form, tracking, schema or price touched |

---

## 6. Known risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | RU/RO structural drift | Every markup edit applied to both files in the same step; parity gate re-run each pass |
| R2 | Disclosure trips a visibility gate | Native `<details>`, verified against `checkVisibility` semantics; re-run visual gates after |
| R3 | Larger type overflows at 390 | Painted-ink gate at 390 after every pass |
| R4 | Offer-section restyle breaks `package__term` CSS contract | Contract CSS preserved; restyle is additive |
| R5 | Placeholder geometry ≠ final photo geometry | Aspect ratios and focal points frozen in §2 above |
