# FINMENTOR — edge security headers: decision pack

Date: 2026-08-25
Finding: INDP2-14 — the last five security response headers
Status: **DESIGN READY.** Live header delivery is **NOT** verified and cannot be tonight.

This pack closes everything that can be closed without touching DNS, Cloudflare or
production. Nothing in it has been executed. The runbook in section 6 is for the owner.

---

## 1. Current hosting path — verified, not assumed

```
browser
  → www.finmentor.md            (CNAME in the repository root)
  → Fastly edge                 (Via: 1.1 varnish, X-Fastly-Request-ID, x-github-edge-region: fra)
  → GitHub Pages origin         (Server: GitHub.com)
  → static files from `main`
```

Two facts that shaped every option below:

- **GitHub Pages cannot set custom response headers.** Not through a config file, not
  through repository settings, not by any other mechanism. This is a platform property, not
  a configuration gap.
- **Cloudflare is not currently in the path.** The privacy policy once claimed it was; that
  was wrong and has already been corrected. Do not read the earlier claim as evidence that
  an account or zone exists.

---

## 2. The five unresolved headers

Derived from the remediation report and `docs/FINMENTOR_SECURITY_HEADERS_PLATFORM_BLOCKER.md`.
The audit found six missing; one is already closed, so five remain.

| # | Header | Intended value | Why it is still open |
|---|---|---|---|
| 1 | `Content-Security-Policy` | see `qa/fixtures/expected-security-headers.json` | meta form is enforcing with no report-only mode, and ignores `frame-ancestors` |
| 2 | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | header-only by specification |
| 3 | `X-Frame-Options` | `DENY` | header-only; no meta equivalent exists |
| 4 | `X-Content-Type-Options` | `nosniff` | header-only by specification |
| 5 | `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | header-only; the old `Feature-Policy` meta form is dead |

**Already closed:** `Referrer-Policy: strict-origin-when-cross-origin`, delivered as
`<meta name="referrer">` on all 88 pages. It is the only one of the six with a
browser-honoured HTML equivalent, and the website gate asserts it on every page.

---

## 3. Why the repository `_headers` file cannot close this

`_headers` is the **Netlify / Cloudflare Pages** convention. GitHub Pages does not read it.
The file is present, complete and correct, and it is **inert**.

It is kept deliberately so a future edge inherits a working policy rather than a blank one,
and it carries a prominent warning at the top so nobody mistakes its presence for evidence.
The website gate asserts that warning is still there, and now also asserts the file agrees
with `qa/fixtures/expected-security-headers.json` field by field — so the staged policy and
the documented expectation cannot silently drift apart.

None of that proves delivery. It proves the repository is internally consistent about a
policy that is not being served.

---

## 4. Options compared

**A — stay on GitHub Pages only.** No change; accept the residual risk.
**B — Cloudflare in front of the current origin.** DNS-only; GitHub Pages stays the origin.
**C — move hosting** (Cloudflare Pages / Netlify / Vercel). New deploy target.

| Criterion | A — stay | B — Cloudflare in front | C — move host |
|---|---|---|---|
| Can set all five headers | **No** — 0 of 5 | **Yes** — 5 of 5 | **Yes** — 5 of 5 |
| Security outcome | unchanged | full | full |
| Implementation complexity | none | **low** — one DNS change, one rule set | medium — new build/deploy, new domain wiring |
| Cost | £0 | **£0** (free tier is sufficient) | £0 on free tiers |
| Repository change required | none | **none** | yes — build config, possibly `_headers` semantics |
| Rollback | n/a | **fast** — unproxy the record, DNS-only | slow — repoint DNS, re-verify build |
| SEO risk | none | **very low** — same origin, same URLs, same content | low-medium — new infra, redirect/canonical risk during cutover |
| Downtime risk | none | **low** — DNS propagation, mitigated by ordering | medium — build parity must be proven before cutover |
| Ongoing maintenance | none | low — one rule set to review | medium — a second platform to keep current |
| Keeps GitHub Pages + custom domain | yes | **yes** | no |
| Keeps current deploy flow | yes | **yes** | no |

### Recommendation — **B, Cloudflare in front of GitHub Pages**

It is the only option that closes all five while changing nothing about the build, the
repository or the deploy flow. The change is one DNS record's proxy status plus a header
rule set, and it reverses in a minute by turning the proxy off.

Option C is not justified on this finding alone. Migrating hosting to obtain headers is a
disproportionate change with a real cutover risk, and it would mean maintaining a second
platform for a problem an edge layer solves without touching the origin.

Option A remains defensible **only** as a conscious acceptance. The honest statement of that
risk: pages can be framed, so clickjacking against the consultation form is possible, and an
injected script would run unconstrained. Both are mitigated in practice — the site is static
with no user-generated content and no server-side rendering — but neither is mitigated by
anything the repository can do.

---

## 5. What must be true before this is called closed

Two different claims, and they must not be conflated:

| Claim | Status tonight | How it becomes true |
|---|---|---|
| **DESIGN READY** | **PASS** | policy defined, staged in `_headers`, machine-readable fixture, gate asserts they agree, runbook written |
| **LIVE HEADER DELIVERY VERIFIED** | **NOT PASS** | owner runs the runbook, then the `curl` in 6.7 returns all five on a real request |

INDP2-14 stays **PARTIAL / PLATFORM_BLOCKER** until the second row is true. No offline test
will ever move it, and none in this repository claims to.

---

## 6. OWNER RUNBOOK — not executed

Prerequisites: access to the `finmentor.md` DNS zone and a Cloudflare account. **No
credentials appear in this repository and none are needed to read this.**

### 6.1 Before touching anything

Record the current state so rollback is mechanical rather than reconstructed:

```bash
dig +short www.finmentor.md
dig +short finmentor.md
curl -sI https://www.finmentor.md/ | head -20
```

Confirm GitHub Pages' custom domain is `www.finmentor.md` and that HTTPS is already working.

### 6.2 Add the zone, DNS-only first

1. Add `finmentor.md` to Cloudflare; let it import the existing records.
2. **Verify every imported record** against 6.1 before changing nameservers — an import that
   silently drops MX would break email, which has nothing to do with this change.
3. Set the `www` record to **DNS-only** (grey cloud) initially.
4. Change nameservers at the registrar. Wait for Cloudflare to report the zone active.
5. Re-run 6.1. The site must behave exactly as before, because nothing is proxied yet.

Stopping here is a safe resting point. Nothing has changed for visitors.

### 6.3 SSL/TLS mode — get this right before proxying

Set SSL/TLS to **Full (strict)**. GitHub Pages serves a valid certificate for the custom
domain, so strict works and validates the origin.

Do **not** use Flexible. Flexible sends plaintext to the origin, GitHub Pages redirects HTTP
to HTTPS, and the result is a redirect loop — this is the single most common way this
migration breaks.

Leave "Always Use HTTPS" **on**.

### 6.4 Turn on the proxy

Set the `www` record to **Proxied** (orange cloud). Verify:

```bash
curl -sI https://www.finmentor.md/ | grep -iE 'server|cf-ray'
```

`cf-ray` should now be present. The page must still render correctly.

If anything is wrong, go straight to 6.8 — it is one click.

### 6.5 Add the header rules

Rules → **Transform Rules → Modify Response Header**, one rule, "All incoming requests",
five static headers set to the values in `qa/fixtures/expected-security-headers.json`:

```
X-Content-Type-Options:    nosniff
X-Frame-Options:           DENY
Permissions-Policy:        camera=(), microphone=(), geolocation=(), interest-cohort=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

`Referrer-Policy` may be added as a header too; it is harmless alongside the existing meta
tag, and the values match.

### 6.6 CSP — Report-Only first, and only then enforce

Add CSP as a **sixth** header, initially as `Content-Security-Policy-Report-Only` with the
policy value from the fixture.

Leave it in report-only for **at least a week of real traffic**, then read the reports before
switching the header name to `Content-Security-Policy`. The pages use inline scripts, inline
styles, Google Tag Manager and Google Fonts; the staged policy already allows for that with
`'unsafe-inline'`, but a missed third-party origin will break analytics or fonts silently, and
report-only is how you find it without an outage.

Two things to know about the policy as written:

- `'unsafe-inline'` for scripts and styles removes much of CSP's injection protection. It is
  currently unavoidable. Removing it is a separate piece of work — moving inline handlers out
  and adopting nonces — and should not gate this rollout.
- `frame-ancestors 'none'` is what actually delivers the clickjacking control at the edge;
  `X-Frame-Options: DENY` is the legacy belt alongside it.

### 6.7 Validation

```bash
curl -sI https://www.finmentor.md/ | grep -iE 'content-security|strict-transport|x-frame|referrer|x-content-type|permissions'
curl -sI https://www.finmentor.md/ro/index.html | grep -i x-frame
curl -sI https://www.finmentor.md/style.css | grep -i x-content-type
```

Expect all five (plus referrer) on the HTML responses. Then check by hand:

- a page renders with no console CSP violations;
- the consent banner still appears and still gates analytics;
- a test form submission still reaches n8n — `connect-src` must allow
  `https://ghennadi.app.n8n.cloud`, and it does in the staged policy;
- Google Fonts still load.

### 6.8 Rollback

| Problem | Action | Time |
|---|---|---|
| Headers wrong or breaking a page | disable the Transform Rule | seconds |
| CSP breaking something | switch back to `-Report-Only`, or disable the rule | seconds |
| Proxy itself causing trouble | set `www` back to **DNS-only** (grey cloud) | seconds, no DNS wait |
| Cloudflare must be removed entirely | restore the original nameservers at the registrar | up to 24–48h propagation |

The first three are the realistic cases and all are immediate. Only full removal is slow,
which is the main argument for doing 6.2 as a separate, verified step.

### 6.9 Cache

The default Cloudflare cache is safe for this site: static assets cached, HTML respecting
origin headers. No custom cache rules are needed for the header work, and adding them would
increase the blast radius for no benefit here.

One caveat worth stating: if caching is later tightened, remember that a cached response
carries whatever headers were attached when it was cached. Purge the cache after changing a
header rule, or you will spend an afternoon debugging a response that no longer exists in the
rule set.

### 6.10 Do not

- Do not enable HSTS **preload** yet. Preload is a browser-baked commitment that is slow and
  painful to reverse; run plain HSTS first.
- Do not enable Cloudflare features beyond the header rules as part of this change — Rocket
  Loader, Auto Minify and Email Obfuscation all rewrite content and can break inline scripts.
  One variable at a time.
- Do not remove the `<meta name="referrer">` tags. They cost nothing and keep the one
  currently-working control working if the proxy is ever turned off.

---

## 7. Verdict

```
DESIGN READY:                    PASS
LIVE HEADER DELIVERY VERIFIED:   NOT PASS  (requires the owner runbook; DNS untouched)
RECOMMENDED EDGE:                Cloudflare in front of GitHub Pages, DNS-only change
INDP2-14:                        PARTIAL / PLATFORM_BLOCKER — unchanged tonight
```

No DNS record, Cloudflare setting, hosting configuration or production file was modified in
producing this document.
