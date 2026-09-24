# Refine proof / practice / flow — visual evidence

Branch `design/refine-proof-practice-flow`, baseline `bf3cf0c`. Chrome (CDP, reduced motion, external hosts blackholed), 12 pages × 4 widths (1440 / 1280 / 820 / 390). `manifest.json` records full-page height and horizontal overflow (0 on all 48 surfaces, before and after). Clips: hero (trust line / counter), homepage practice + formats, About founder + practice tiles, Owner steps + deliverables — RU and RO. Full-page renders were reviewed but not retained (78 MB per phase); the same script reproduces them.

## Hero trust line — pixel diff before vs after (counter 15+ → 18+)

```
index @1440: 732x684 differing=53 (0.011%) bbox=x70-114 y7-583
index @1280: 732x633 differing=64 (0.014%) bbox=x16-109 y0-536
index @820: 820x511 differing=76 (0.018%) bbox=x77-444 y418-427
index @390: 390x593 differing=49 (0.021%) bbox=x77-84 y501-510
ro_index @1440: 732x664 differing=53 (0.011%) bbox=x86-716 y1-582
ro_index @1280: 732x613 differing=47 (0.010%) bbox=x102-109 y526-535
ro_index @820: 820x490 differing=79 (0.020%) bbox=x77-299 y418-427
ro_index @390: 390x593 differing=517 (0.224%) bbox=x32-357 y371-510
```

Clip dimensions identical at every width; the differing pixels are the digit glyphs (plus background-photo noise at the pixel threshold). No layout shift.
