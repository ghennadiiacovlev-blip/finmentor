# Mobile Motion Pass 2 — owner review evidence

Branch `design/mobile-motion-pass-2`, baseline `fa83d0e` (live GitHub Pages build of `redesign/visual-system-2`).
Both labels were recorded with the same harness, viewport, scroll pace (~525 px/s measured), start point,
WebKit build (Playwright WebKit 2359) and content state; `before` from a clean worktree of `fa83d0e`,
`pass2` from this branch.

**Video is the source of truth.** The twelve `.webm` recordings live in `qa-artifacts/mobile-motion-pass-2/`
(untracked by repository policy). Regenerate with
`node qa/mobile-motion-evidence.mjs --only record2 --label pass2 --out qa-artifacts/mobile-motion-pass-2`
(and `--label before` from a checkout of `fa83d0e`):

| id | page | width |
|---|---|---|
| 01_homepage_390 | / | 390 |
| 02_homepage_430 | / | 430 |
| 03_about_390 | /about.html | 390 |
| 04_practice_390 | /cases.html | 390 |
| 05_real-estate_390 | /real-estate-control-system.html | 390 |
| 06_materials_390 | /materials.html | 390 |

Tracked here for convenience:

- `*-stages.png` — key stages around the first editorial photograph, cut at the measured scroll pace:
  initial → entering → reveal → settled (before and pass2). Pages without a photograph after the first
  viewport (practice, real-estate, materials) have no strip: their motion is text only.
- `*_compare.png` — fine comparison, 0.2 s apart: row 1 before, row 2 pass2 (homepage 390/430, About 390).
- full 2 fps contact sheets (`*-sheet.png`) stay beside the recordings in `qa-artifacts/mobile-motion-pass-2/` (untracked, ~2 MB each).
- `evidence_record2_*.json` — manifests (photo position, page height, measured scroll time).
