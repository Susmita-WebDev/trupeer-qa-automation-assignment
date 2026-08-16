# Part 1 - Security Review (beyond the user session)

This is a short, **passive** security review of `app.trupeer.ai`, additional to the
functional bug report in [`bugs.md`](bugs.md). It goes past the 30-minute
"as a real user" exploration into the technical hygiene a QA engineer should also
check, while staying strictly non-destructive.

## Scope and method

| | |
| :--- | :--- |
| **Target** | `https://app.trupeer.ai` (hosting: Vercel; framework: Next.js) |
| **Date** | 2026-08-16 |
| **Method** | Read-only. Inspected response **headers**, and the **JavaScript the server already ships to every visitor**. |
| **Not done** | No authentication bypass, no injection, no data modification, no access to other accounts, no load/stress testing. Nothing that a normal browser session would not also request. |
| **Reproducible** | The header checks are codified in [`qa-system/src/checks/security.js`](../qa-system/src/checks/security.js) and run with `npm run security` in `qa-system/`. |

Findings are reported for remediation, never exploited. Where something looked
alarming (a captcha "test mode" flag), it was **verified before being claimed** -
see the passed checks below.

## Findings

| ID | Finding | Severity |
| :--- | :--- | :--- |
| SEC-1 | Content-Security-Policy does not restrict script sources | Medium |
| SEC-2 | `X-Powered-By: Next.js` discloses the stack | Low |
| SEC-3 | Deprecated `X-XSS-Protection` header left enabled | Low / Info |
| SEC-4 | `Permissions-Policy` grants microphone to all origins (`microphone=*`) | Info |

### SEC-1 (Medium) - CSP present but does not mitigate XSS

The response carries a Content-Security-Policy, but its only directive is
`frame-ancestors 'self'`:

```
Content-Security-Policy: frame-ancestors 'self'
```

`frame-ancestors` only controls who may frame the page (clickjacking, which is
also covered here by `X-Frame-Options: SAMEORIGIN`). There is **no `script-src`
and no `default-src`**, so the CSP places no restriction on where scripts may load
or execute from. Its primary job - reducing the impact of cross-site scripting and
injection - is not being done. A "present" CSP here can give a false sense of
coverage.

**Recommendation:** add a real `default-src 'self'` baseline and an explicit
`script-src` (nonce- or hash-based for inline scripts), then tighten from report-only
to enforced.

### SEC-2 (Low) - Framework disclosure via X-Powered-By

```
X-Powered-By: Next.js
```

This advertises the framework to anyone, which helps an attacker narrow down
framework-specific attacks and known CVEs. **Recommendation:** remove the header
(`poweredByHeader: false` in `next.config.js`).

### SEC-3 (Low / Info) - Deprecated X-XSS-Protection

```
X-Xss-Protection: 1; mode=block
```

This header is deprecated. Modern browsers ignore it, and the filtering mode has
historically **introduced** vulnerabilities in some legacy engines. Current
guidance is to set it to `0` and rely on a real CSP (see SEC-1).
**Recommendation:** set `X-XSS-Protection: 0`.

### SEC-4 (Info) - Broad microphone permission

```
Permissions-Policy: camera=(), microphone=*, geolocation=()
```

Camera and geolocation are correctly disabled, but microphone is granted to **all**
origins (`*`) rather than `self`. The product needs the microphone for recording,
so `microphone=(self)` would be the tighter, equivalent grant and would stop
cross-origin iframes from requesting it. **Recommendation:** scope it to `self`.

## Passed checks (checked, and correct)

Reporting these matters as much as the findings: they show what was tested and
that Trupeer got it right.

| Check | Result |
| :--- | :--- |
| **Secret exposure** - scanned all 56 production JS bundles (3.4 MB) for API keys, tokens, private keys | **No server-side secrets found.** |
| **Source maps** in production | **Not exposed** (all `.map` requests 404, no `sourceMappingURL`). |
| **HSTS** | Present and strong: `max-age=31536000; includeSubDomains; preload`. |
| **Clickjacking** | `X-Frame-Options: SAMEORIGIN` plus CSP `frame-ancestors 'self'`. |
| **MIME sniffing** | `X-Content-Type-Options: nosniff`. |
| **Referrer leakage** | `Referrer-Policy: strict-origin-when-cross-origin`. |
| **reCAPTCHA** | Enforced on sign-up with the real site key. A `NEXT_PUBLIC_FORCE_CAPTCHA_TEST_MODE` toggle exists in the bundle, but it is **not enabled in production** (the value is unset, so the test-mode branch is dead), so captcha is **not** bypassable. |

That last row is the point of a careful review: the test-mode flag looked like a
captcha bypass at first glance, but reading the code (`x = "true" === env.NEXT_PUBLIC_FORCE_CAPTCHA_TEST_MODE`)
and confirming the value is unset showed it is a non-issue. It is noted here only
as a latent risk to keep out of production builds.

## Note for the interview

None of this is required by the assignment, and it is deliberately kept separate
from the functional bug report. It is included to show the security-aware side of
QA - and, just as importantly, the judgment to test responsibly (read-only, own
account, no exploitation) and to verify a finding before reporting it. For any
issue that genuinely warranted it (for example, a real leaked secret - there were
none here), the right channel is private responsible disclosure to Trupeer, not a
public repository.

## References

- OWASP Web Security Testing Guide (headers, CSP, information exposure)
- MDN: Content-Security-Policy, Permissions-Policy, X-XSS-Protection (deprecation)
- Next.js docs: `poweredByHeader`, security headers, `productionBrowserSourceMaps`
