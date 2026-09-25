# FINMENTOR repository cleanup — Stage 2A

Started: 2026-09-24 (Europe/Bucharest)

Verification completed: 2026-09-25

Status: isolated cleanup branch; no production deployment or branch pruning in this stage.

## Safety boundary

- Baseline: `caba2141e5e630852e1835d6cbbd881c189b2342`.
- Recovery tag: `production-approved-2026-09-24` at the exact baseline above.
- Pre-card-motion rollback: `rollback-pre-cleanup-2026-09-24` at
  `5f00b8e2201a3ed09dacf609f0f0f33f2bce52c2`.
- Cleanup branch: `chore/repository-cleanup-stage-2a`.
- Production, `main`, Pages settings, remote branches, linked worktrees, and Git history
  were not modified.

## Removed from the current tree

| Category | Files | Bytes | Reason |
|---|---:|---:|---|
| Generated `qa-evidence/` | 219 | 58,699,743 | Reproducible QA output; keep outside source Git |
| Root review PNGs and release ZIPs | 23 | 9,345,029 | Point-in-time review artifacts, already retained by the recovery tag |
| Numbered noindex HTML uploads | 17 | 164,783 | Unlinked duplicates absent from the sitemap |
| **Total** | **259** | **68,209,555** | Approximately 65.05 MiB removed from the checked-out production snapshot |

The 20 root PNGs are the numbered review captures from
`01a-mobile-menu-390-CURRENT-defect.png` through `19-v11-miniapp-1440.png`.
The three ZIPs are:

- `finmentor_premium_final_candidate_APPROVED.zip`
- `finmentor_premium_restored_owner_review.zip`
- `finmentor_production_v1.zip`

The 17 HTML duplicates were the files named `<canonical page> (n).html`. Canonical RU
and RO pages remain unchanged.

## Repository policy changes

- `qa-evidence/` is ignored and regenerated on demand.
- `test-results/` is ignored as Playwright state.
- QA scripts, fixtures, deterministic baselines, production imagery, runtime pages,
  integrations, and current operational documents remain tracked.
- Documentation now distinguishes ignored regeneration targets from evidence preserved
  in the recovery tag.

## Verification

- `node qa/run-all.mjs`: **104/104 gates passed**, 3,725 assertions; assertion floors passed.
- Website contract, typography lock, privacy release, and Client Voices gates passed within
  the canonical suite.
- `qa/production-layout-regression.spec.mjs`: **6/6 passed**, including Cases containment,
  Real Estate flow/launcher, financial tables, photo heroes, and statement labels.
- Accessibility sweep: **90 indexed pages**, 4,902 AX interactive nodes, 4,025 touch
  targets, **0 defects**.
- WebKit normal-motion sweep: **36/36 priority surfaces**, zero overflow, stuck targets,
  or unrevealed targets.
- WebKit reduced-motion sweep: **9/9 priority routes**, `m-js` absent and zero targets
  left transformed, clipped, or delayed.
- `git diff --check`: passed.

## Recovery

No history rewrite was performed. Any removed file can be inspected or restored from:

```text
production-approved-2026-09-24
```

Do not restore the obsolete ZIP bundles for deployment.
