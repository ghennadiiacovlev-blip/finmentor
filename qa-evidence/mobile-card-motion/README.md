# Mobile Card Motion (Pass 3) — owner review evidence

Branch `design/mobile-card-motion`, baseline `a9400af` (live GitHub Pages build of `redesign/visual-system-2`).
Both labels recorded with the same harness, WebKit build (Playwright WebKit 2359), viewport 390 × 844, start point,
scroll pace (~525 px/s measured) and content state; `before` from a clean worktree of `a9400af`, `after` from this branch.

**Video is the source of truth.** The ten `.webm` recordings live in `qa-artifacts/mobile-card-motion/` (untracked by
repository policy). Regenerate with
`node qa/mobile-motion-evidence.mjs --set cards --only record2 --label after --out qa-artifacts/mobile-card-motion`
(and `--label before` from a checkout of `a9400af`):

| id | page |
|---|---|
| homepage-390-cards | / |
| business-models-390-cards | /business-models.html |
| practice-390-cards | /cases.html (no card motion targets on this page — text motion only) |
| capital-390-cards | /capital-management.html |
| materials-390-cards | /materials.html (no card motion targets — the editorial reading rhythm is left as is) |

Tracked here:

- `*-stages.png` — key stages around the first card group, cut at the measured pace: initial → entering → landing → settled.
- `*_compare.png` — fine comparison, 0.2 s apart: row 1 before, row 2 after (homepage, business models, capital).
- `evidence_record2_*.json` — manifests; `metrics_after.json` / `metrics_before_a9400af.json` — Chrome vitals, WebKit
  completeness and reduced-motion audit; `desktop_*.json` — desktop computed-style freeze proof.
