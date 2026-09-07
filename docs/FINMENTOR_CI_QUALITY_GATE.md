# FINMENTOR — canonical CI quality gate

Date: 2026-08-25
Workflow: `.github/workflows/finmentor-quality-gates.yml`
Status: **ACTIVE on pull_request, push to main, and workflow_dispatch**

---

## 1. Why this exists

The repository already had three GitHub Actions workflows, and all three are path-scoped to
their own Mini App phase:

| Workflow | Triggers on |
|---|---|
| `miniapp-b20-qa.yml` | Mini App B.2.0 paths |
| `miniapp-b21-gateway-qa.yml` | `gateway/**` and the gateway contract |
| `miniapp-b21a-bootstrap-qa.yml` | `gateway/n8n/**` and the bootstrap canary doc |

None of them runs the eight gates that guard the remediated production behaviour. The
consequence was concrete: the remediation merge to `main` — which reshaped Lead Intake
identity handling, the CRM write path and the Mini App read model — carried **no mandatory
status check over any of it**. All 340 assertions *that existed at the time of that merge*
were run by hand. (The suite has since grown to **460** across eight gates; 340 is the
historical figure for the merge described here, not a current total. Current counts live in
the gate table below and in `qa/assertion-baseline.json`.)

This workflow closes that. It is the repository's general CI; the three above stay as they
are, scoped to their phases.

---

## 2. What runs

One job, `quality-gates`, on `ubuntu-latest`, Node **22** pinned via `actions/setup-node@v4`.
There is no `package.json` and no dependency install: the gates are plain Node with no
third-party code, which is deliberate — a supply chain is a thing that can break a gate.

| Step | Purpose |
|---|---|
| Syntax check | `node --check` over every gate, `qa/run-all.mjs`, `scripts/*.mjs`, all 14 `n8n/src` modules and the gateway sources. A Code-node source that does not parse cannot be deployed to n8n |
| Canonical quality gates | `node qa/run-all.mjs` — the exact command used locally |
| Assertion baseline | fails if the total **falls** below `ASSERTION_BASELINE` (a second net; the per-gate floors in `qa/assertion-baseline.json` are the primary one and run locally too) |
| cwd independence | runs the suite again from `/` and requires **N/N** — the runner is the only authority on how many gates there are. This step used to carry a literal count, which went stale at 9 gates and failed the step for the number rather than for cwd dependence |
| Secret scan | `node scripts/secret-scan.mjs` over every tracked file, **plus** the `.mcp.json` project-scope guard (`scripts/mcp-config-guard.js`) in the same step. The scan finds credential-shaped *literals*; the guard refuses a *structure* — a `headers`/`env` block, an extra query parameter, a repointed `project_ref`, a widened feature scope — none of which has to look like a secret to be one |
| Summary | writes the gate table and assertion total to the job summary |

### The canonical gates

| # | Gate | File | Assertions |
|---|---|---|---|
| 1 | Command Center authorisation | `qa/command-center-auth.test.mjs` | 43 |
| 2 | Lead Intake trust boundary | `qa/lead-intake-trust.test.mjs` | 43 |
| 3 | AI safe projection | `qa/ai-safe-projection.test.mjs` | 52 |
| 4 | Error Monitor alert | `qa/error-alert.test.mjs` | 22 |
| 5 | Website contract | `qa/website-contract.test.mjs` | 75 |
| 6 | n8n export hygiene | `qa/n8n-manifest-drift.test.mjs` | 70 |
| 7 | Mini App read-model consistency | `qa/miniapp-readmodel.test.mjs` | 42 |
| 8 | Mini App consent and submit | `qa/miniapp-submit.test.mjs` | 113 |
| 9 | G1 durable idempotency receipt | `qa/idempotency-receipt.test.mjs` | 35 |
| | **Baseline** | | **495** |

`qa/run-all.mjs` now prints each gate's assertion count and a `TOTAL ASSERTIONS:` line, so
the number is read from the run rather than transcribed. It also **fails when a gate's tally
cannot be parsed**, so a gate that silently stops asserting cannot pass as green.

### The assertion baseline is one-directional

`ASSERTION_BASELINE` fails the build when the total **drops**. Growth only prints a note
asking you to raise it. Lowering the baseline to make a red build green is the one edit that
defeats the point of having it — if coverage genuinely moved, say so in the commit message
and raise the number in the same change.

### Per-gate floors — `qa/assertion-baseline.json`

Added in N6.2, and added because the claim already existed in prose while the code did not
have it. The B.2.1-C closure stated that the runner "fails when a single gate's tally drops,
so the eight gates cannot silently trade assertions between them". Only the **total** floor
was ever implemented, and only in CI. A total floor cannot see one gate losing ten checks
while another gains ten — which is exactly how coverage drifts out of the place that needed
it, with the number that is supposed to notice staying perfectly still.

`qa/run-all.mjs` now reads `qa/assertion-baseline.json` and fails when:

- any gate's tally falls below its recorded floor — **even if the total is unchanged**;
- a gate listed in the baseline has disappeared from the runner (an empty gate and a deleted
  gate must be equally loud);
- a gate in the runner has no floor recorded, so a new gate cannot be added unratcheted;
- the file itself is missing or unparseable.

Growth is one-directional here too: it prints the numbers to raise and passes. Because the
check lives in the runner rather than in the workflow, it now fails **locally**, before a
push, which is where a coverage regression is cheapest to notice.

The CI `ASSERTION_BASELINE` on the total is kept as a second net rather than deleted: it
guards the case where the baseline file and the gates are edited together in one change.

---

## 3. What is offline, and what that means

Everything. No secrets are referenced (`secrets.` appears nowhere in the workflow), no
network call is made, and nothing touches n8n, Google Sheets, GA4, Telegram or DNS.
`permissions: contents: read` only; no write scope is granted anywhere.

The gates are offline by construction, not by convention:

- the n8n Code-node sources are executed as text through a small harness, against fixtures;
- the website contract gate reads the committed HTML/JS, it does not fetch the live site;
- the n8n hygiene gate reads the committed redacted exports, it does not call the tenant;
- the Mini App gate runs the real projection module against injected Data Table and
  `Bot_Sessions` doubles.

---

## 4. What this deliberately does NOT check

Being explicit here matters more than the list of what passes. A green build means the
repository is internally consistent. It does **not** mean production is correct.

| Not checked | Why, and what covers it instead |
|---|---|
| Live n8n workflow state | needs tenant credentials. Covered by `qa/n8n-manifest-drift.test.mjs` against committed exports, plus a manual re-export after any deploy |
| Live Pipeline / Sheets schema | needs Google credentials. Covered by the deploy script's own live precondition |
| Real HTTP response headers | the origin cannot set them; see `docs/FINMENTOR_EDGE_SECURITY_HEADERS_DECISION.md`. **No offline test can prove edge delivery** |
| Browser behaviour | consent banner, layout, GA4 DebugView — never verified by observation in this project |
| Romanian copy quality | machine-translation review is a human judgement; see `docs/FINMENTOR_RO_LANGUAGE_REVIEW_2026-08-25.md` |
| Telegram `initData` end-to-end | the Ed25519 primitive is proven with synthetic signatures; a real canary against the production key is still outstanding |
| Secrets outside git | the scan covers tracked files only, by design |

The secret scan is honest about its own reach: it finds credential-shaped literals, using the
**same five patterns** as the n8n hygiene gate rather than a second, subtly different set. It
will not find a secret that looks like prose, and it is not a substitute for a secret store.
It was verified by planting four fake credentials in a tracked file — all four were caught,
the one allowlisted test fixture was correctly ignored, and matched values are never echoed
into the log.

---

## 5. Future recommendation — branch protection

**Not configured tonight**, and deliberately so: enabling a required check is a repository
administration change with the power to block merges, and it should be a conscious decision
rather than a side effect of adding CI.

When the owner is ready, on `main`:

1. Settings → Branches → add a rule for `main`.
2. Require a pull request before merging.
3. Require status checks to pass → select **`quality-gates`**.
4. Require branches to be up to date before merging.
5. Leave force-push and deletion disabled.

Worth knowing before enabling it: the remediation reached `main` through a direct merge, not
a PR. With the rule above that route closes, and every future change needs a PR. That is the
intent, but it changes the workflow the owner has been using, so it should be turned on when
convenient rather than in the middle of an incident.
