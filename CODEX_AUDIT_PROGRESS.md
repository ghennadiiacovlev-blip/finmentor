# FINMENTOR Audit Progress

Audit baseline: `921c74702bf45b0f881bea68d9541fb510667152` on `redesign/visual-system-2`.

## CHECKPOINT 01 — Repository state + full site inventory

- Timestamp: `2026-09-23T07:08:10+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: repository verification and full filesystem/site inventory
- Pages checked: all 124 tracked HTML files were enumerated and metadata-classified
- Tests checked: canonical runner structure, gate inventory, assertion baseline, sitemap/robots inventory
- Repository verification: expected working directory, branch and HEAD match; starting tree was clean with no staged, unstaged or untracked files
- Inventory: 919 tracked files; 124 HTML; 5 CSS; 98 JS; 293 MJS; 99 JSON; 95 raster/vector images; no locally hosted font files
- Public HTML: 115 files (69 root, 46 under `ro/`)
- Indexed public pages: 90 total, exactly 45 RU and 45 RO; sitemap has 90 unique URLs
- Public noindex: 25 files, comprising two thank-you pages and 22 identified legacy/duplicate aliases plus `404.html`
- Other HTML surfaces: `app/` (1), `app-premium/` (1), gateway (2), QA evidence (5)
- Public forms: 4 forms across RU/RO homepages and RU/RO questionnaires
- Public shared assets: 5 CSS and 6 JS files (`analytics.js`, `assistant.js`, `i18n-ro.js`, `lang.js`, `lead-transport.js`, `main.js`)
- Analytics/tracking: `analytics.js` is referenced across the public HTML inventory; detailed consent/event verification is pending
- Special application finding: `app-premium/` is `noindex,nofollow`, contains one serif reference, has no public-site inbound reference, and is documented as byte-sealed by the C2 closure gate
- Defects found: none yet confirmed in this discovery phase
- Severity: none assigned
- Fixes applied: none (only the two required audit checkpoint artifacts were created)
- Unresolved items: browser CLI `agent-browser` is not installed; actual browser coverage will use the repository's Chrome/CDP harness or another safe local alternative. A combined discovery command returned exit code 1 on a no-match search; it was safely split and rerun.
- Next phase: execute and inspect existing QA, including assertion floors, content migration, motion and visual evidence

## CHECKPOINT 02 — Existing QA / test integrity

- Timestamp: `2026-09-23T07:22:00+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: existing QA discovery, structural integrity review, canonical execution, content-migration execution, independent link/SEO gate, and rendered Chrome evidence
- Pages checked: 90 indexed pages statically; 62 pages / 4,895 internal links in the Financial Map gate; representative RU/RO public, legal, questionnaire, offer, article, thank-you, Mini App and X-Ray surfaces rendered across 320–1600px by the Chrome/CDP evidence harness
- Tests discovered: 102 canonical offline gates in `qa/run-all.mjs`; 110 root `qa/*.mjs` scripts plus the gateway validator; 9 root scripts are intentionally outside the canonical runner (orchestrator, content, visual, financial-map, legacy browser, live/UAT scripts)
- Tests executed: canonical 102-gate suite; content migration; Financial Map QA; visual evidence; standalone live-derived C1 closure test
- PASS: canonical `102/102`, exactly `3,659` assertions, assertion floors PASS; content migration `221` text blocks + `62` internal links, nothing lost; Financial Map `19 PASS / 0 WARN / 0 ERROR`; visual evidence `30 PASS`
- FAIL: visual evidence `1 FAIL` caused only by the obsolete `.legal__note` requirement; standalone C1 live-derived closure emitted `31 FAIL` because its required transient `.uat/c1-final-closure` pre/candidate artifacts are absent (4 artifact-independent assertions passed)
- WARN/SKIP: production GA4, live public journey, and production smoke were not executed because they require external production access/credentials; legacy Playwright Mini App script was not used because Playwright is not installed and the current Chrome/CDP visual gate covers the Mini App states
- Test-integrity evidence: all 102 referenced files exist; assertion baseline has 102 gate keys totaling 3,659; assertion-floor mutation gate passed; no canonical `test.skip` / `describe.skip` / `it.skip` directives found; visual harness asserts painted ink, real mobile-drawer interaction, deterministic captures, reduced motion, overflow, clipping, CTA fit and representative archetypes
- Content-migration contract: verified exactly one RU and one RO approved CFO Advisory Session split; each whole must equal its two exact parts joined with one space and every part must exist; no broad split exemption exists
- Defects found: `QA-LOW-01` — stale visual evidence contract still requires `.legal__note` on RU/RO privacy although commit `b0a4cc2` deliberately removed the draft/legal-review disclaimer while publishing the C4.11 privacy policy
- Severity: LOW (test reliability/noise; current privacy implementation is protected by 35 privacy-policy assertions and 66 data-governance assertions)
- Fixes applied: none yet; narrow safe test correction queued for CHECKPOINT 08
- Unresolved items: historical 76-check motion harness is documented but not present as an executable repository script; equivalent current motion/reduced-motion/browser checks will be performed independently. Live/UAT scripts remain production-validation items.
- Next phase: navigation, complete internal links, forms and functional behavior

## CHECKPOINT 03 — Navigation + links + functional behavior + forms

- Timestamp: `2026-09-23T07:34:33+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: complete internal-link crawl, URL hygiene, navigation and interaction walkthrough, homepage form and Financial X-Ray functional audit
- Pages checked: all 115 public HTML files statically; 14 representative routes in real local Chrome including RU/RO home, About, Capital Management, Business Models, Materials, article, offer, RU/RO questionnaire, privacy, terms, thank-you and 404
- Tests checked: 6,770 internal links; 452 external HTTP links inventoried; mobile menu open/close/Escape; format disclosure; browser back/forward; homepage and X-Ray empty validation; stubbed success and failure paths; RU/RO form parity; console/exceptions/local requests
- PASS: 90 indexed pages have inbound links; 0 indexed orphans; 0 dead anchors; 0 path-case defects; no localhost/dev/file-system URL in public HTML/JS/CSS; no unsafe `_blank` links found; browser routes `14/14`; local request failures `0`; uncaught exceptions `0`; relevant console errors `0`
- Forms: all four public forms were identified. Empty submissions expose recoverable validation; valid local/stubbed submissions call transport once; failure states expose Telegram/e-mail fallback and re-enable submission; RU and RO flows passed without sending real production data
- Financial X-Ray: entry, empty error summary, required controls, success route, failure fallback, RU/RO parity and submit-button recovery were exercised locally. External delivery was deliberately stubbed; real delivery remains a production check.
- Defects found: `FUNC-LOW-02` — eight missing language-switch destinations exist inside noindex legacy aliases (`/en/*` routes removed long ago plus three obsolete RO slugs); `SEO-LOW-03` — 17 numbered legacy duplicate files contain both `noindex,follow` and a second `index, follow` meta robots tag
- Severity: LOW for both because every affected file is absent from the sitemap and has no indexed-page inbound dependency, but both are objective hygiene/reachability defects
- Fixes applied: added a dependency-free local Chrome/CDP audit harness at `qa/codex-browser-functional-audit.mjs`; no production behavior changed yet
- Unresolved items: narrow legacy-link and duplicate-robots corrections queued for CHECKPOINT 08; real form delivery and external integrations require production validation
- Next phase: responsive matrix and RU/RO parity/wording audit

## CHECKPOINT 04 — Responsive + RU/RO

- Timestamp: `2026-09-23T07:43:18+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: all-indexed-page responsive sweep at every required width and full indexed RU/RO metadata/routing/language audit
- Pages checked: all 90 indexed pages (45 RU + 45 RO) at `320 / 390 / 430 / 768 / 1024 / 1280 / 1440 / 1728` = 720 rendered surfaces
- Tests checked: document overflow, painted non-scroll text bounds, CTA/button/summary bounds, image loading, H1 count, reduced-motion visibility, page-pair existence, language switch resolution, canonical/hreflang, `html lang`, OG/Twitter metadata, JSON-LD parseability, duplicate metadata, duplicate IDs and visible Cyrillic in RO
- PASS: `720/720` responsive surfaces; `0` responsive defects after intentional horizontal table scrollers were correctly distinguished from page overflow; `45/45` RU and `45/45` RO parity; `0` indexed i18n/SEO defects; `0` heading hierarchy warnings
- Required narrow checks: Business Control System, Financial Health Check, the homepage CFO Control Partner panel and long Romanian headings all remain within 320px; Engagement Formats was covered at 320/390/430/1440/1728; homepage Practice and Materials mobile stacks had no off-screen content or broken action bounds
- Defects found: none objective in responsive behavior or RU/RO routing/parity
- Severity: none assigned
- Fixes applied: responsive sweep detector was narrowed to exempt only ancestors that are genuinely horizontally scrollable (`overflow-x: auto|scroll` and `scrollWidth > clientWidth`); no site CSS/content changed
- Unresolved items: `NATIVE_RO_REVIEW` for the approved homepage phrases “Plățile se fac. Priorități nu există.” and “Rapoarte sunt multe. O imagine unică nu există.” because their idiom may sound machine-like; they are protected by the approved content-migration contract and were not changed
- Next phase: accessibility plus motion/interactions

## CHECKPOINT 05 — Accessibility + motion/interactions

- Timestamp: `2026-09-23T08:02:26+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: browser accessibility-tree sweep of all indexed pages, static semantic/form audit, mobile touch-target sweep, keyboard navigation checks and reduced-motion/runtime interaction verification
- Pages checked: all 90 indexed pages in Chrome accessibility trees at 1440px and all 90 at 390px; representative desktop and mobile interaction routes; both complete Financial X-Ray forms
- Tests checked: 4,899 exposed interactive accessibility nodes; 4,022 rendered mobile interactive elements; accessible names; `main`/`navigation` landmarks; ARIA references; hidden focusables; table scrollers; target dimensions; focus styles; mobile and desktop menu keyboards; disclosure; reduced motion; animation fallback
- PASS: no missing `main`; no broken ARIA references; no visible focusables inside `aria-hidden`; no unnamed buttons/links/selects/radios; desktop ArrowDown opens a disclosure menu and moves focus, Escape closes and restores focus; mobile menu opens/closes and responds to Escape; disclosures are keyboard-native; global and form focus indicators are visible; reduced-motion content remains visible on all 720 responsive surfaces and the representative runtime check
- Motion: reveal content is synchronously exposed for reduced-motion/no-observer cases; decorative canvas/custom-cursor loops do not start under reduced motion; counters resolve to final values; approved motion remains intact for normal preferences; no endless content-blocking animation or runtime exception was reproduced
- Defects found: `A11Y-MED-04` — 42 RU/RO questionnaire text inputs/textareas use visual `<span>` labels without a programmatic association (11 currently exposed unnamed textboxes per language in the AX tree, plus conditional fields found statically); `A11Y-LOW-05` — 54 focusable horizontal table wrappers across 14 RU/RO knowledge pages have no accessible region name; `A11Y-LOW-06` — RU/RO questionnaire, privacy and terms headers expose navigation links without a `navigation` landmark; `A11Y-MED-07` — the shared mobile menu control renders at 28×22px and several distinct homepage disclosure/action targets are below 24px, while questionnaire/legal back links are only 16–20px high; `I18N-LOW-08` — eight RO runtime menu buttons are announced in Russian because seven pages omit `i18n-ro.js` and `ro/cfo-consultation.html` loads it after `main.js`
- Severity: 2 MEDIUM, 3 LOW; no BLOCKER/HIGH
- Contrast: the canonical token contrast gate independently passed both dark-surface gold and light-surface bronze at WCAG-readable thresholds; no visual/readability regression was reproduced
- Fixes applied: added independent accessibility-tree/touch audit harness `qa/codex-accessibility-sweep.mjs`; extended the functional harness with desktop disclosure-navigation keyboard coverage; production fixes are queued for CHECKPOINT 08
- Unresolved items: historical “76/76 motion harness” is documented in prior reports but is not present as an executable file; current static gates, 720 reduced-motion surfaces and independent runtime behavior were used instead
- Next phase: SEO, sitemap, robots, legacy aliases and privacy contract

## CHECKPOINT 06 — SEO + sitemap + robots + legacy + privacy

- Timestamp: `2026-09-23T08:06:09+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: full indexed technical-SEO audit, sitemap/robots validation, noindex/legacy reachability review, privacy 30/31 investigation and app-premium scope/integrity assessment
- Pages checked: all 90 sitemap/indexed URLs; all 25 public noindex files; every canonical/hreflang pair; all 22 legacy aliases; RU/RO privacy and terms; `app-premium/`
- Tests checked: `qa/codex-i18n-seo-audit.mjs`; `qa/financial-map.qa.mjs`; sitemap URL/duplicate/date/origin validation; public-reference resolution including `a`, `link`, `script`, `img` and `source`; git history for privacy release intent; canonical C2 source-tree integrity gate
- PASS: 90 unique sitemap URLs, 90 valid last-modified dates and no non-canonical origin; exact 45 RU / 45 RO indexed pairs; indexed titles/descriptions/canonicals/hreflang/html-lang/robots/OG/Twitter/JSON-LD/H1 passed; zero indexed orphan pages; `robots.txt` permits crawling and advertises the HTTPS canonical sitemap; no noindex page is in the sitemap
- Legacy state: 22 aliases are publicly requestable but absent from sitemap and have no indexed-page inbound link. Five named aliases carry one `noindex,follow`; 17 numbered copies carry contradictory `noindex,follow` plus `index, follow`. A full element-reference crawl found 25 broken legacy references: eight visible language-switch anchors and 17 obsolete `hreflang` links, all targeting removed `/en/` routes or obsolete RO slugs. Two named aliases (`power-bi-for-owner.html`, `treasury.html`) also self-canonicalize although their preserved content/alternate targets correspond to current questionnaire/home pages.
- Privacy 30/31 finding: implementation is not proven wrong. Commit `b0a4cc2` deliberately removed the draft/legal-review `.legal__note` while publishing the versioned C4.11 policy; current pages expose `data-privacy-notice-version="pn-2026-09-11.v1"`; 35 privacy-release and 66 data-governance assertions pass. The visual test alone retained the removed selector, so `QA-LOW-01` is a stale test contract and will be corrected narrowly without restoring or inventing legal text.
- app-premium / Playfair: `app-premium/index.html` is `noindex,nofollow`, absent from sitemap and has no public FINMENTOR inbound link. Playfair is deliberately scoped to this Telegram Mini App, which is not part of the sans-only public website. The canonical C2 gate byte-hashes the protected source tree and passed; live/build integrity additionally requires n8n credentials. No protected file was changed or resealed.
- Defects found: existing `FUNC-LOW-02` is expanded to all 25 broken legacy element references; existing `SEO-LOW-03` confirmed on 17 files; `SEO-LOW-09` — two noindex named aliases retain misleading self-canonicals instead of their demonstrable current content target
- Severity: LOW; no indexed-page SEO defect, blocker or high-risk privacy implementation defect found
- Fixes applied: none in this phase; narrow legacy/test corrections queued for CHECKPOINT 08
- Unresolved items: `LEGACY_WATCH` — aliases remain publicly reachable by direct historical URL and should be retained or redirected only with owner/traffic evidence; production crawl/index status still requires Search Console or equivalent. `app-premium` live byte equality requires credentialed read-only verification and its typography should change only through the separately gated Mini App release process.
- Next phase: CSS, JavaScript, performance, assets and security/repository hygiene

## CHECKPOINT 07 — CSS + JavaScript + performance + assets + security hygiene

- Timestamp: `2026-09-23T08:26:12+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: CSS/JS/runtime review, local rendered performance/resource audit, asset and brand audit, analytics/privacy behavior audit and non-invasive repository security scan
- Pages checked: all 115 public HTML sources; 16 representative rendered performance surfaces (8 routes × 390/1440 at DPR2); all public images/styles/scripts; both gateway test pages; public forms and analytics transport
- Tests checked: secret-scanner 24-case self-test; repository secret scan; website contract; Chrome resource/CLS/LCP/DOM/image audit; JS syntax/console/network; DOM sinks; source maps; insecure URLs; target-blank protection; manifest parse; image dimensions/ratios; logo usage/recoloring; CSS serif/important/repeated-selector inventory
- PASS: secret scanner self-test `24/24`; 830 tracked text files scanned against five high-confidence credential patterns with zero candidate secret; `.mcp.json` is pinned/project-scoped/credential-free; website contract `107/107`; no source maps; no HTTP application URLs; no unsafe `_blank`; all 115 pages carry one referrer policy; HTTPS form transport omits credentials and has timeout/retry identity controls; analytics loads Google only after consent and scrubs identifiers from URLs; no representative local request failure, console error, duplicate application asset, image distortion or measured layout shift (`CLS 0.000` on all 16 local surfaces)
- Performance facts: common public CSS is 493,925 raw bytes / about 92,902 gzip bytes (`style.css`, `editorial.css`, `lang.css`); common main/assistant/analytics JS is about 32,117 gzip bytes before optional form/i18n scripts. The largest DOM observed was Materials at 1,674 elements, followed by Financial X-Ray at 1,252. These are local facts, not production CWV.
- Images/brand: all 220 public `<img>` instances have `alt`, `width` and `height`; browser sweeps found zero broken images. LCP candidates use approved AVIF where supported. The canonical silver/white + gold wordmark is used without CSS recoloring/filter and no duplicate local logo request was observed. Six capital-photo instances declare a 1920×1280 ratio while the approved source is 1586×992 (6.2% ratio mismatch), an objective intrinsic-sizing defect queued for correction.
- Quality watches: DPR2 inspection identified source-resolution softness risk for the homepage hero at 1440, About portrait at 390/1440 and Capital Management hero at 1440. No higher-resolution approved photo exists; no replacement was invented. Nine unreferenced image masters/old logo variants total 10,840,561 bytes in the repository but are not downloaded by public pages; deletion is not demonstrably safe.
- CSS/JS: public typography lock contains no serif declaration; the only Playfair reference remains the separately sealed app-premium. `style.css` has 293 repeated selector names and 50 `!important` occurrences across its layered historical cascade; `editorial.css` has 101 repeated selector names. Rendered regression is clean, so this is maintainability/performance WATCH rather than authority for a broad refactor. Runtime initialization guards, observers and event handlers produced no duplicate behavior or exception; user-derived innerHTML paths are either closed-map values or escaped.
- Security headers: repository contracts honestly preserve five unresolved response headers (`CSP`, `HSTS`, `X-Frame-Options`, `nosniff`, `Permissions-Policy`) because GitHub Pages does not honor `_headers`; the staged policy is not claimed live. This requires real-host verification and an owner hosting/edge decision. `gateway/n8n/canary-page.html` is a tracked diagnostic surface with no sitemap/inbound link and safe no-store/referrer handling, but unlike the second gateway test page it lacks `noindex,nofollow`.
- Defects found: `PERF-LOW-10` — six approved capital-photo instances have incorrect intrinsic aspect-ratio attributes; `SEO-LOW-11` — the standalone gateway canary lacks a robots exclusion meta
- Severity: LOW for both; no secret, runtime blocker, failed local resource or verified high-risk DOM injection found
- Fixes applied: added `qa/codex-performance-audit.mjs`; production corrections queued for CHECKPOINT 08
- Unresolved items: `QUALITY_WATCH` for approved DPR2-limited photos; CSS/DOM reduction needs a separate measured optimization project; real PageSpeed/RUM/CWV, CDN compression/cache headers, live response security headers, analytics delivery and endpoint delivery require production validation
- Next phase: apply smallest safe fixes, run affected checks, then full regression

## CHECKPOINT 08 — Safe fixes + full regression

- Timestamp: `2026-09-23T09:10:10+03:00`
- Baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Current HEAD: `921c74702bf45b0f881bea68d9541fb510667152` (working tree intentionally contains the audited patch; no commit was created)
- Phase completed: all confirmed MEDIUM/LOW findings were corrected with narrow production or test-contract changes, followed by targeted and full regression
- Accessibility fixes: associated all 42 RU/RO Financial X-Ray text controls through wrapping labels while preserving byte-locked form-control signatures; named all 54 focusable table scrollers from their captions; added six missing navigation landmarks; enlarged the shared burger, legal/questionnaire back links and distinct homepage action/disclosure targets
- I18n fix: loaded `i18n-ro.js` before `main.js` on the eight affected Romanian pages so runtime navigation controls are announced in Romanian
- Legacy/SEO fixes: made the legacy normalizer root-scoped and idempotent; normalized all 22 aliases to one `noindex,follow`; removed misleading canonicals; repaired or removed all 25 broken alias element references; the repeat dry run reports zero changes and the public element-reference crawl reports `8,769` references / `0` broken
- Test/privacy fix: changed the legal visual gate to validate privacy notice version `pn-2026-09-11.v1` on privacy pages while retaining the `.legal__note` requirement on terms pages; no released legal copy was altered
- Asset/gateway fixes: corrected all six `capital-decision` intrinsic dimensions to the approved `1586×992`; added `noindex,nofollow` to `gateway/n8n/canary-page.html`
- Canonical regression: `102/102` gates, exactly `3,659` assertions, assertion floors PASS; protected questionnaire machine signatures PASS; website contract `107/107`; content migration `221` text blocks + `62` internal links, nothing lost
- Browser regression: functionality PASS across 14 routes; accessibility PASS across all 90 indexed pages (`4,899` AX controls, `4,022` mobile controls, `0` defects); responsive `720/720` at 320–1728px with `0` defects; local performance/resource sweep `16/16`, `CLS 0.000`, `0` defects
- SEO/map regression: indexed RU/RO `45/45`, `0` i18n/SEO defects; Financial Map `19 PASS / 0 WARN / 0 ERROR`; sitemap `90` URLs
- Visual regression: `31/31` visual-evidence checks PASS, including deterministic A/B hashes, zero overflow/clipping/collision defects, legal integrity, package titles, RU/RO parity, Mini App states and X-Ray result states
- Defects remaining: no confirmed BLOCKER, HIGH, MEDIUM or LOW repository defect remains from this audit
- Watches remaining: five approved low-resolution/DPR2 image-source watches; production CWV/RUM, live response headers, GA4 and real endpoint delivery require production access; C1 live-derived closure needs transient `.uat/c1-final-closure` artifacts; direct legacy-alias retention/redirect decisions require owner traffic evidence; native Romanian review remains advisable for two owner-approved homepage phrases; app-premium live/build equality remains credential-gated
- Audit status: COMPLETE

## CHECKPOINT 09 - Fable confirmation + final release record

- Timestamp: `2026-09-23T09:38:21.6933652+03:00`
- Audit baseline HEAD: `921c74702bf45b0f881bea68d9541fb510667152`
- Phase completed: targeted confirmation of both independent Fable must-fix items, smallest safe correction, affected regression, canonical regression, complete diff review and final release documentation
- Initial Fable confirmation: both requested items were objectively unresolved before the final correction. Cover copy marked with `data-fx` could remain at `opacity: 0.01` until scrolling, and several long cover titles pushed first-viewport content below the fold.
- Smallest safe correction: one cover-scoped CSS change synchronously exposes cover copy, provides responsive long-title sizing and tightens offer-cover vertical spacing. No HTML, approved copy, offer facts or page structure was removed or rewritten.
- Fable MUST-FIX #1: PASS on CFO Advisory Session, Financial Health Check, Business Control System and Monthly CFO Support in RU and RO at `320x844`, `390x844`, `430x932` and `1440x900`. All 32 offer surfaces loaded at `scrollY=0`; lead and commercial terms opacity was `1`; the terms strip remained inside the first viewport; no first-viewport copy depended on a scroll-triggered reveal.
- Fable MUST-FIX #2: PASS on Financial Health Check, Treasury Waterfall and equivalent long RU/RO cover titles at the same four viewport sizes. The fallback kept tested titles within the first viewport, including six-line mobile titles; no copy was removed. Romanian was verified independently at every width as the longer-language risk case.
- Combined Fable evidence: `40/40` unique page/viewport surfaces, `0` objective failures.
- Scope review: all 47 previously modified tracked paths plus the audit artifacts were reviewed. Changes are limited to objective accessibility, i18n, legacy-link/SEO, privacy-test, intrinsic-image, gateway-indexing and Fable-cover corrections plus their audit harnesses/reports. No subjective redesign entered the patch.
- Content preservation: baseline-to-working-tree visible-text comparison across all 19 modified indexed HTML pages returned `VISIBLE_TEXT_IDENTICAL=TRUE`; content migration passed `221` protected text blocks plus `62` internal links with nothing lost. Removed links were stale references confined to noindex legacy aliases, not approved indexed content.
- Affected regressions: editorial production `34/34`; premium typography `17/17`; commercial polish `51/51`.
- Canonical regression after the Fable correction: `102/102` gates, exactly `3,659` assertions and assertion floors PASS.
- Responsive: `720/720` indexed surfaces, `0` defects.
- Accessibility: all 90 indexed pages, `4,899` accessibility-tree controls, `4,022` mobile controls and `0` defects.
- Visual evidence: `31/31` PASS with deterministic A/B hashes and no overflow, clipping or collision defect.
- Public references: `8,769` public element references, `0` broken.
- Performance: `16/16` representative surfaces, `CLS 0.000`, `0` defects; five approved DPR2 source-softness watches remain.
- Final correction count: `13` (`11` audit corrections plus the two Fable must-fix corrections).
- Release assessment: `CONDITIONAL GO`. Repository evidence is green. Production-only checks remain for live CWV/RUM, live response security headers, GA4 delivery, real form/endpoint delivery, production smoke/public journeys, the transient C1 closure artifacts and credentialed app-premium live/build equality.
- Local commit: to be created once with message `fix: final production audit corrections`; the authoritative final SHA is the post-commit value of `git rev-parse HEAD` and cannot be embedded inside the commit that defines it.
- Finalization status: READY FOR LOCAL COMMIT; no push, deploy or merge authorized.
