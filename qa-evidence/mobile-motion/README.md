# Mobile motion pass — evidence

Branch `design/mobile-motion`, production baseline `ebb582b` (GitHub Pages source `redesign/visual-system-2`).
Produced by `node qa/mobile-motion-evidence.mjs --phase before|after` (WebKit for behaviour and
recordings, the installed Chrome for web-vitals numbers), served from the checkout on a loopback port.

| Folder | Content |
|---|---|
| `before/` | `metrics.json` measured on the untouched baseline (`ebb582b`, clean worktree) + contact sheets of the baseline recordings |
| `after/` | the same on the mobile-motion tree |

Contact sheets: WebKit recording of a slow human-paced scroll (~640 px/s) at 390 or 430 wide, sampled at
2 frames per second, six frames per row, read left → right, top → bottom. The `.webm` recordings themselves
live in `qa-artifacts/mobile-motion/<phase>/` (untracked by repository policy; regenerate with the command above):

- `homepage-390-mobile-motion` · `homepage-430-mobile-motion` (RU)
- `practice-390-mobile-motion` (cases.html, RU)
- `real-estate-390-mobile-motion` (RU)
- `ro-homepage-390-mobile-motion` (RO, technical parity)

`metrics.json` per phase: `perf` (LCP, CLS after load and after the scroll, long tasks, stuck motion targets —
Chrome, 390 and 430), `webkit` (overflow, stuck or unrevealed targets after a full scroll at 320 / 390 / 430 / 820),
`reduced` (WebKit `prefers-reduced-motion: reduce`: `m-js` absent, targets not immediately visible = 0).
