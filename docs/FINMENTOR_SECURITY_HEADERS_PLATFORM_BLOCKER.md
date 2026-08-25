# FINMENTOR — Security response headers: PLATFORM_BLOCKER

Date: 2026-08-25
Finding: INDP2-14 — security response headers absent on production 200 pages
Status: **PARTIALLY CLOSED — remainder is a platform blocker, owner decision required**

## 1. Verified current state

Live `HEAD https://www.finmentor.md/` returns HTTP 200 with:

```
Server: GitHub.com
Via: 1.1 varnish
X-Fastly-Request-ID: ...
x-github-edge-region: fra
```

The site is served by **GitHub Pages** behind Fastly. Two consequences, both verified rather
than assumed:

1. All six audited headers are absent on the production 200 response:
   `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`,
   `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`.
2. **Cloudflare is not in the path.** The privacy policy previously named Cloudflare as a
   CDN/protection provider. That was factually wrong and has been corrected.

## 2. Why `_headers` does not close this

The repository contains a `_headers` file. That is the **Netlify / Cloudflare Pages**
convention. GitHub Pages does not read it, and offers no other mechanism for custom
response headers on a Pages site. The file has no effect on production today.

Declaring these headers "fixed" because `_headers` exists would be a fictitious PASS. The
file has been completed with the correct policy and clearly relabelled as inert, so a future
edge migration inherits a working configuration, but it is not evidence of anything live.

Verification command, which must be run against the real host rather than the repository:

```
curl -sI https://www.finmentor.md/ | grep -i -E 'content-security|strict-transport|x-frame|referrer|x-content-type|permissions'
```

## 3. What was actually applied

Exactly one of the six has a browser-honoured HTML equivalent on the current host.

| Header | HTML equivalent | Applied | Note |
|---|---|---|---|
| `Referrer-Policy` | `<meta name="referrer">` | **YES — 87 pages** | Fully equivalent; browsers honour it |
| `Content-Security-Policy` | `<meta http-equiv="Content-Security-Policy">` | NO — see 3.1 | Partial only; cannot express `frame-ancestors` |
| `X-Frame-Options` | none | NO | Meta equivalent does not exist |
| `X-Content-Type-Options` | none | NO | Header-only by specification |
| `Permissions-Policy` | none | NO | Header-only; the old `Feature-Policy` meta is dead |
| `Strict-Transport-Security` | none | NO | Header-only by specification |

### 3.1 Why CSP was not shipped as a meta tag

A meta CSP is enforcing and has no report-only mode, so a wrong policy breaks the live site
on publish rather than warning first. The current pages use inline scripts, inline styles,
Google Tag Manager and Google Fonts, so any workable policy needs `'unsafe-inline'` for both
scripts and styles, which removes most of the injection protection that motivates CSP.
`frame-ancestors` — the clickjacking control that would substitute for `X-Frame-Options` —
is explicitly ignored in meta form.

The remit for this phase was to harden without breaking a working site, and the audit had no
browser available to validate a policy before publish. Shipping an unvalidated enforcing CSP
against that constraint trades a documented gap for an undiagnosable outage. The candidate
policy is therefore staged in `_headers` and left for a validated rollout.

## 4. PLATFORM_BLOCKER — options for the remaining five

Requires an owner decision. **No hosting migration has been performed.**

| Option | Effort | Effect | Notes |
|---|---|---|---|
| **Cloudflare in front of GitHub Pages** (recommended) | Low | All six headers | DNS-only change: point `finmentor.md` at Cloudflare, keep GitHub Pages as origin. Headers via Transform Rules or a Worker. No repository or content change. Free tier is sufficient. |
| **Cloudflare Pages** | Medium | All six headers | Native `_headers` support — the file in this repo would start working as written. Requires moving the deploy target. |
| **Netlify** | Medium | All six headers | Native `_headers` support, same as above. |
| **Vercel** | Medium | All six headers | Headers via `vercel.json` rather than `_headers`. |
| **Stay on GitHub Pages** | None | Referrer-Policy only | Accepts the residual risk documented in section 5. |

The first option is the smallest change that closes the finding completely, because it keeps
the current build, repository and deploy flow untouched and only inserts an edge layer.

## 5. Residual risk while unmitigated

- **No CSP**: an injected script would run unconstrained. Mitigated in practice by the site
  being static with no user-generated content and no server-side rendering.
- **No `X-Frame-Options` / `frame-ancestors`**: pages can be framed, so clickjacking against
  the consultation form is possible.
- **No HSTS**: a first visit over `http://` is downgradeable before the redirect. GitHub
  Pages does redirect to HTTPS, so the window is one request.
- **No `nosniff`**: low impact; all content types are served correctly.
- **No `Permissions-Policy`**: low impact; the site requests no camera, microphone or
  geolocation.

## 6. Regression coverage

`qa/website-contract.test.mjs` asserts the referrer meta is present on every page and that
`_headers` still carries its inert-on-GitHub-Pages warning, so a future reader cannot mistake
the file for live configuration.

Re-verify the live headers with the `curl` command in section 2 after any hosting change.
