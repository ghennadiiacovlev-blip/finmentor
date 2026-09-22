# FINMENTOR — TYPE SCALE

One family, **Manrope** (Google Fonts, weights 300–800), plus **JetBrains Mono** for indices and
figures. No serif. Tokens live in `editorial.css` (`:root`). Every page that has been designed
page-by-page (`body.fx-page`) uses only these roles, so there are no one-off heading sizes.

**Principle taken from the reference study:** contrast *inside* a statement. The base of a
statement is set in a true light weight (300) and the words that carry the argument are bold
(700–800). At most one phrase is in gold (`.fx-gold`). Weight marks meaning — money, profit,
capital, risk, the owner's decision — and never decoration.

The reference achieved its contrast with one light cut plus synthetic bold. FINMENTOR uses real
weights.

Sizes are fluid between the phone (390) and desktop (1440) values, via `clamp()` with a vw
middle term. Tablet (1024) values are the resolved middle.

| Token | Role | Desktop 1440 | Tablet 1024 | Mobile 390 | Weight | Line-height | Letter-spacing | Max width |
|---|---|---|---|---|---|---|---|---|
| `--t-display-xl` | page cover statement (photo / thesis heroes) | 76px | 62px | 40px | 300 base · 800 strong | 1.02 | −0.035em | 15ch |
| `--t-display-l` | chapter statement inside a page | 54px | 45px | 31px | 300 base · 700 strong | 1.08 | −0.03em | 20ch |
| `--t-h1` | H1 of reading pages (articles, offers) | 60px | 50px | 34px | 700 | 1.06 | −0.03em | 20ch |
| `--t-h2` | section heading | 40px | 34.5px | 26px | 700 | 1.14 | −0.022em | 26ch |
| `--t-h3` | sub-heading, panel title | 24px | 22px | 19px | 700 | 1.3 | −0.01em | 34ch |
| `--t-lead` | lead paragraph under a heading | 23px | 21.4px | 19px | 400 | 1.5 | −0.005em | 58ch |
| `--t-body-l` | article body | 19px | 18.4px | 17.5px | 400 | 1.72 | 0 | 66ch |
| `--t-body` | interface body, panels | 17px | 16.6px | 16px | 400 | 1.65 | 0 | 62ch |
| `--t-small` | captions, notes, table cells | 14.5px | 14.5px | 14px | 400–500 | 1.55 | 0 | — |
| `--t-eyebrow` | eyebrow above a heading | 12.5px | 12.5px | 12px | 700 | 1.3 | 0.12em, UPPERCASE | — |
| `--t-meta` | metadata (author, reading time, date) | 13.5px | 13.5px | 13px | 500 | 1.45 | 0.01em | — |
| `--t-index` | stage / list index (mono) | 13px | 13px | 12px | 500 (Mono) | 1 | 0.08em | — |
| `--t-figure` | large figure / numeral in panels | 64px | 54.5px | 40px | 300 | 1 | −0.04em | — |

## Rules

- **Uppercase** is used only for `--t-eyebrow`: no uppercase headings or paragraphs. This reduces
  the tracked small caps the owner asked to cut.
- **One H1 per page.** On pages with a display cover the H1 *is* the display statement (same
  element, `--t-display-xl`). On reading pages the H1 uses `--t-h1`.
- **Statements** (`.fx-statement`) may use a forced line break (`<br class="fx-br">`) on desktop
  only; `.fx-br` is ignored below 860px so Russian and Romanian words re-flow.
- **Long-form reading** uses `--t-body-l` at 66ch, with paragraph spacing of 1.1em and H2
  spacing of 2.4em above and 0.7em below.
- **Tables** use `--t-small` with tabular figures (`font-variant-numeric: tabular-nums`).
- **Gold text** (`--ed-gold`, #7E5F16) is ≥ 4.5:1 on ivory, paper and stone. On navy the gold is
  `--gold-400` (#D8B450).
- **Romanian** runs about 10–15% longer than Russian; display tokens stay the same and
  statements rely on re-flow, not on smaller sizes.

## Weights loaded

`Manrope:wght@300;400;500;600;700;800` and `JetBrains+Mono:wght@400;500;600`. Playfair Display is
kept in the font link for legacy pages until they are migrated, and is not used by any `fx-page`.
